#!/usr/bin/env node
// Live acceptance checks: actual purchase, equipment, delivery and save paths.
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';

// BM1_TEST_ROOT selects the tree this gate serves, so it can be pointed at the built dist; without
// it the repository root is served, which is what this gate used to do unconditionally.
const ROOT = path.resolve(process.env.BM1_TEST_ROOT || path.join(path.dirname(fileURLToPath(import.meta.url)), '..'));
const shim = `
window.__economy = {state, startWithFaction, fleetBook, getShipStats, getShipyardStock,
  getCatalogPurchaseDecision, getShipPurchaseStatus, canBuyEscortShip, canBuyFleetShip,
  completeShipPurchase, getSystemIndexByName, applySystemState, transferSystemControlToPlayer,
  applyShipDefaultWeapons, normalizeWeaponLoadout, applyCurrentShipStats, buyWeapon,
  loadWeaponSlot, firePlayerWeapon, createNpcShip, fireNpcWeapon, ensureNpcCombatStats,
  playerWorldPosition, getFactionStanding, raisePlayerFlag, saveGame, loadGame,
  acceptPendingContract, deliverDestinationCargoAtCurrentPlanet, buyMarketGood, sellMarketGood,
  getNpcSideId, getStationOwner, render, openShipPurchaseModal, getShipVisualProfile,
  tick, getDefaultWeaponId, getOriginalShipWeaponSlots, getTradeStandingFaction, createCargoRunOffer,
  freeze: () => new Promise(resolve => {
    const timer = setTimeout(() => resolve(false), 3000);
    requestAnimationFrame = cb => { if (cb.name === 'loop') { clearTimeout(timer); resolve(true); } return 0; };
  })};`;
const mime = {'.html':'text/html','.js':'text/javascript','.mjs':'text/javascript','.json':'application/json','.css':'text/css','.png':'image/png','.webp':'image/webp','.gif':'image/gif'};
const server = http.createServer((req,res) => {
  const rel = decodeURIComponent((req.url || '/').split('?')[0]).replace(/^\/+/, '') || 'index.html';
  const file = path.resolve(ROOT,rel);
  if (!file.startsWith(ROOT + path.sep) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) { res.writeHead(404);res.end();return; }
  res.setHeader('Content-Type',mime[path.extname(file)] || 'application/octet-stream');
  res.setHeader('Cache-Control','no-store');
  if (rel === 'src/main.js') res.end(fs.readFileSync(file,'utf8') + shim);
  else fs.createReadStream(file).pipe(res);
});
await new Promise(resolve => server.listen(0,'127.0.0.1',resolve));
let browser;
try {
  browser = await chromium.launch();
  const page = await browser.newPage({viewport:{width:1280,height:800}});
  const errors=[];
  page.on('pageerror',e=>errors.push(e.message));
  await page.goto(`http://127.0.0.1:${server.address().port}/`,{waitUntil:'load'});
  await page.waitForFunction(()=>window.__economy?.state.shipCatalog && window.__economy.state.planets.length>10);
  const results = await page.evaluate(async()=>{
    const B=window.__economy,s=B.state,checks=[];
    const check=(name,ok,detail=null)=>checks.push({name,ok:!!ok,...(ok?{}:{detail})});
    const same=(a,b)=>JSON.stringify(a)===JSON.stringify(b);
    // Per-system shelves are finite, so buying the last unit of a hull makes every later check about
    // that hull fail with 'Out of stock' instead of testing what it is named for. restock puts the
    // shelf back to its capacity; the purchase gates under test are untouched by it.
    const restock=(id,system=s.currentPlanet)=>{const rec=B.fleetBook().stock[`${system}:${id}`];if(rec)rec.quantity=rec.capacity;return rec;};
    B.startWithFaction('terran');
    // Per-system stock capacity is seeded from the campaign id, which is a random UUID at a fresh
    // start, so an unpinned run randomly gives a hull a shelf of 1 and the purchase checks below fail
    // about a third of the time. The gate pins it: a validation gate that is a coin toss is not
    // evidence, and a real intermittent failure would be indistinguishable from the noise.
    B.fleetBook().campaignId = 'economy-gate-seed';
    check('freeze acknowledges the final game loop',await B.freeze());
    const earth=B.getSystemIndexByName('Earth'),alpha=B.getSystemIndexByName('Alpha Centauri');
    const home=s.currentPlanet;
    check('starting faction has 20 standing; another faction starts at 0',B.getFactionStanding('terran')===20 && B.getFactionStanding('ferengi')===0);
    const enter=(name,stationName=null)=>{
      const i=typeof name==='number'?name:B.getSystemIndexByName(name);
      if(i<0)throw Error(`Missing system ${name}`);
      s.currentPlanet=i;s.myplanet=i+1;s.selectedPlanet=i;B.applySystemState(i);
      s.npcShips=[];s.projectiles=[];s.activeFleetAttack=null;s.spawnProtectionUntil=0;
      s.docked=true;s.dockedPlanetIndex=i;s.dockedStationId=null;
      if(stationName){const st=s.stations.find(x=>x.name===stationName && !x.destroyed);if(!st)throw Error(`Missing station ${stationName}`);s.dockedStationId=st.id;s.dockedPlanetIndex=null;}
      return i;
    };
    check('foreign concessions retain their own trade reputation',B.getTradeStandingFaction(earth,{id:'probe-vulcan-concession',faction:'vulcan',systemIndex:earth})==='vulcan');
    enter(earth,'McKinley');
    check('McKinley keeps Steamrunner rather than a Dominion ID collision',B.getShipyardStock().some(x=>x.id===1)&&!B.getShipyardStock().some(x=>x.id===206));
    enter(earth,'Utopia Planitia');s.latinum=1e9;
    const blocked=[B.getShipPurchaseStatus(38),B.canBuyEscortShip(38),B.canBuyFleetShip(38,home)];
    check('money alone cannot buy a capital for self, escort or garrison',blocked.every(x=>!x.ok),blocked);
    s.factionStanding.terran=75; // the full roster pass puts frontline capitals at strategic standing
    const earthPermit=B.getShipPurchaseStatus(38);
    enter(alpha,'Xiang Yard');const alphaPermit=B.getShipPurchaseStatus(38);
    check('one Terran standing unlocks the same design in two regions',earthPermit.ok&&alphaPermit.ok,{earthPermit,alphaPermit});
    s.playerFlags=['terran','klingon'];const standings=JSON.stringify(s.factionStanding);B.raisePlayerFlag('klingon');
    check('changing a flag does not create or erase standing',JSON.stringify(s.factionStanding)===standings);
    B.raisePlayerFlag('terran');
    const paso=enter('Paso','X-Base');
    s.factionStanding.terran=99;s.factionStanding.ferengi=100;
    const locked=B.getShipPurchaseStatus(347);
    check('Excalibur needs 100 Terran standing, not money or Ferengi trust',!locked.ok&&locked.catalogDecision?.requiredStanding===100,locked);
    s.factionStanding.terran=100;
    check('X-Base stocks distinct Galaxy Dreadnaught and Excalibur',same(B.getShipyardStock().map(x=>x.id),[49,347]));
    const price=s.latinum;B.completeShipPurchase(347);
    check('real purchase installs Excalibur at the approved cost and stats',s.playership===347&&price-s.latinum===1500000&&s.tothull===9000&&s.totshields===12000);
    restock(347,paso);
    check('personal purchase gate also protects fleet paths',B.canBuyEscortShip(347).ok,B.canBuyEscortShip(347));
    s.cargo=0;s.cargoArray=s.cargoArray.map(x=>({...x,tons:0,item:'Nothing',destination:undefined}));
    enter('New Switzerland','Free Swiss Reserve Exchange');s.factionStanding.neutral=99;
    check('Concord uses independent trade standing',!B.getShipPurchaseStatus(60).ok);
    s.factionStanding.neutral=100;
    const concord=B.getShipPurchaseStatus(60);
    check('independent endgame vendor sells Concord, never Excalibur',concord.ok&&!B.getShipyardStock().some(x=>x.id===347),concord);
    enter('New Switzerland','Swiss Miss');
    const beforeShuttle=s.latinum;B.completeShipPurchase(350);
    check('real Basic Shuttle purchase costs 900 and selects its own hull',s.playership===350&&beforeShuttle-s.latinum===900);
    B.normalizeWeaponLoadout();B.render();B.tick(1);
    check('unarmed purchase preserves three empty slots even with weapons in inventory',same(s.weaponSlots,[null,null,null]),s.weaponSlots);
    const p=B.playerWorldPosition();
    const npc=B.createNpcShip({id:99001,shipId:350,faction:'neutral',from:{x:p.x+150,y:p.y},role:'patrol'});
    B.ensureNpcCombatStats(npc);npc.lastShotAt=-1e9;s.npcShips=[npc];
    const shots=s.projectiles.length;B.fireNpcWeapon(npc,p,'player',performance.now());
    check('authored empty NPC loadout cannot fire or manufacture aggression',npc.lastShotAt===-1e9&&!npc.lastAggressionAt&&s.projectiles.length===shots);
    s.weaponInventory=[];B.applyShipDefaultWeapons(350,false);s.combatTargetId=npc.id;s.combatTargetType='ship';
    B.firePlayerWeapon(1);
    check('firing an empty player slot creates no shot',s.projectiles.length===shots&&s.weaponInventory.length===0);
    const sameRegion=s.currentPlanet;
    const weaponStore=s.stations.find(st=>!st.destroyed&&(st.weaponStockIds||[]).includes(1));
    if(!weaponStore)throw Error('No local Type X shop fixture');
    s.docked=true;s.dockedStationId=weaponStore.id;s.latinum=1e6;
    const beforeWeapon=s.latinum;B.buyWeapon(1);
    check('unarmed shuttle can buy and equip a compatible weapon',s.weaponSlots[0]===1&&s.weaponInventory.includes(1)&&s.latinum<beforeWeapon,{slots:s.weaponSlots,inventory:s.weaponInventory});
    s.docked=false;s.weaponLastFiredAt=[-1e9,-1e9,-1e9];s.spawnProtectionUntil=0;s.power.energy=200;
    npc.x=p.x+100;npc.y=p.y;npc.destroyed=false;const hp=npc.combatHull+npc.combatShields;
    B.firePlayerWeapon(1);
    check('the newly armed shuttle damages a target with the real weapon path',npc.combatHull+npc.combatShields<hp,{before:hp,after:npc.combatHull+npc.combatShields});
    const snapshots=JSON.stringify(s.factionStanding);B.saveGame(8);B.loadGame(8);
    check('armed shuttle loadout and faction standing survive save/reload',s.playership===350&&s.weaponSlots[0]===1&&JSON.stringify(s.factionStanding)===snapshots);
    B.applyShipDefaultWeapons(350,false);B.saveGame(8);B.loadGame(8);B.normalizeWeaponLoadout();
    check('intentionally empty loadout survives save/reload',s.weaponInventory.length===0&&same(s.weaponSlots,[null,null,null]));
    // An actual accepted/delivered contract, not a direct standing mutation.
    enter('New Switzerland');s.factionStanding.neutral=20;s.factionStanding.terran=20;
    s.pendingContractOffer={id:'economy-contract',goods:'Medical Supplies',targetIndex:earth,targetName:'Earth',tons:2,payPerTon:10,originIndex:sameRegion,originName:'New Switzerland',employerName:'Contract Office',employerType:'planet'};
    B.acceptPendingContract();check('delivery fixture is accepted with cargo',s.openContracts.some(x=>x.id==='economy-contract'));
    enter(earth);const delivered=B.deliverDestinationCargoAtCurrentPlanet();
    check('completed delivery earns destination trust and issuer trust',delivered&&B.getFactionStanding('terran')===25&&B.getFactionStanding('neutral')===22,s.factionStanding);
    const once=JSON.stringify(s.factionStanding);B.deliverDestinationCargoAtCurrentPlanet();
    check('repeating delivery cannot claim the same standing twice',JSON.stringify(s.factionStanding)===once);
    s.factionStanding.terran=15;s.latinum=1e6;
    B.buyMarketGood(0);B.sellMarketGood(0);
    check('buy/sell cycling cannot buy its way to capital-ship trust',B.getFactionStanding('terran')===15);
    enter('Blender');const blender=B.getShipyardStock().filter(x=>x.faction==='dominion').map(x=>x.id);
    check('Blender purchases remain scout/fighter remnants',blender.length>0&&blender.every(id=>[206,322].includes(id)),blender);
    enter('Dominica','Dominica Check Point');s.factionStanding.dominion=100;
    const dominant=B.getShipyardStock().map(x=>x.id);
    check('Dominica stocks cruiser 216 and battlecruiser 48, never Concord 60',dominant.includes(216)&&dominant.includes(48)&&!dominant.includes(60),dominant);
    enter('Vortara','Vortara Dominion Shipyard');
    check('core-region stock permits heavy Dominion purchases away from Blender',B.getCatalogPurchaseDecision(48).allowed,B.getCatalogPurchaseDecision(48));
    // Per-hull scale is unchanged for all existing reviewed hulls; stock data never changes identity.
    const earlyKlingons=[330,351,332].map(id=>B.getShipStats(id));
    check('new Bird of Prey is between Brel and Kvort in durability and price',earlyKlingons.every((ship,i)=>i===0||(earlyKlingons[i-1].hull<ship.hull&&earlyKlingons[i-1].hull+earlyKlingons[i-1].shields<ship.hull+ship.shields&&earlyKlingons[i-1].cost<ship.cost)));
    const paso2=enter('Paso','X-Base');restock(347,paso2);s.factionStanding.terran=99;s.playership=7;B.applyCurrentShipStats(true);s.cargo=0;s.latinum=2e6;
    s.planetMenuOpen=false;B.openShipPurchaseModal(347);B.render();
    check('purchase UI shows required and current faction standing',document.getElementById('ship-purchase-modal').textContent.includes('Required standing')&&document.getElementById('ship-purchase-modal').textContent.includes('99'));
    return checks;
  });
  for(const r of results)console.log(`${r.ok?'PASS':'FAIL'} ${r.name}${r.ok?'':` ${JSON.stringify(r.detail)}`}`);
  const shot=process.argv[process.argv.indexOf('--screenshot')+1];
  if(process.argv.includes('--screenshot')&&shot){await page.screenshot({path:shot});console.log(`Screenshot: ${shot}`);}
  if(errors.length)console.error('Page errors:',errors);
  console.log(`${results.filter(r=>r.ok).length}/${results.length} live economy checks passed`);
  if(results.some(r=>!r.ok)||errors.length)process.exitCode=1;
} finally {
  if(browser)await browser.close();
  await new Promise(resolve=>server.close(resolve));
}
