#!/usr/bin/env node
// The approved merge decisions exercised through the real game entry points.
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import assert from 'node:assert/strict';
import {chromium} from 'playwright';
import {createShipCatalog} from '../bm-ships/catalog.mjs';
import {mergeCatalogIntoEntities} from '../src/ship-catalog-integration.mjs';

const root = fileURLToPath(new URL('../', import.meta.url));
const read = name => JSON.parse(fs.readFileSync(path.join(root, name), 'utf8'));
const manifest = read('bm-ships/ships.json');
const catalog = createShipCatalog(manifest, read('bm-ships/bm2-id-map.json'), read('bm-ships/size-config.json'));
const expected = {304:2,3:305,5:306,6:307,7:308,8:309,12:310,13:311,14:312,
 16:314,17:315,18:316,19:317,20:318,21:319,27:320,28:321,30:322,31:323,32:324,
 34:326,36:327,37:328,39:330,40:331,41:332,43:334,45:335,46:336,52:338,
 339:55,56:340,57:341,58:342,59:343,23:345,44:346,337:47};
const results=[];
function check(name, run) {run();results.push({name,ok:true});}
check('all 38 approved references resolve to one canonical hull each',()=>{
 assert.deepEqual(manifest.aliases,expected);
 for(const [old,id] of Object.entries(expected)) {
  assert.equal(catalog.getShip(old).id,id);assert.equal(catalog.resolveNewShipId(old),id);
  assert(!manifest.ships.some(s=>s.id===Number(old)));
 }
});
check('legacy-manifest entries cannot resurrect aliases or duplicate survivors',()=>{
 const entities=[...Object.keys(expected),...Object.values(expected)].map(id=>({id:Number(id),assetType:'ship',name:'old'}));
 entities.push({id:70,assetType:'station',name:'Station'},{id:94,assetType:'pod',name:'Pod'});
 const merged=mergeCatalogIntoEntities(entities,catalog);
 assert.equal(new Set(merged.map(s=>s.id)).size,merged.length);
 assert.equal(merged.filter(s=>s.assetType==='ship').length,174);
 assert.equal(merged.find(s=>s.id===70).name,'Station');assert.equal(merged.find(s=>s.id===94).name,'Pod');
});
check('alias validation rejects cycles, missing targets and IDs that still have records',()=>{
 const sizes=read('bm-ships/size-config.json');
 for(const aliases of [{900:901,901:900},{900:999},{2:305}]) assert.throws(()=>createShipCatalog({...manifest,aliases},{},sizes));
});
check('reviewed prices coexist with the approved artwork selections and Defiant anchor',()=>{
 assert.equal(catalog.getShip(2).cost,48000);assert.equal(catalog.getShip(326).cost,62500);
 assert.equal(catalog.getShip(33).cost,72000);assert.equal(catalog.getShip(325).cost,94000);
 assert.equal(catalog.getShip(55).cost,265000);assert.equal(catalog.getShip(47).cost,16000);
 assert.equal(catalog.getShip(2).artworkRecordId,304);assert.equal(catalog.getShip(309).artworkRecordId,8);
 assert.equal(catalog.getShip(55).artworkRecordId,339);assert.equal(catalog.getShip(320).artworkRecordId,320);
});
check('source IDs, regional pools and explicit station stock contain no discarded hulls',()=>{
 const bm2=read('bm-ships/bm2-id-map.json').sourceToRemaster;
 assert.equal(bm2[2],2);assert.equal(bm2[55],55);assert.equal(bm2[47],47);
 for(const id of Object.values(bm2)) assert(!Object.hasOwn(expected,id));
 for(const st of read('data/stationData.json').stations) {
  assert.equal(new Set(st.stock.shipIds).size,st.stock.shipIds.length);
  for(const id of st.stock.shipIds) assert(!Object.hasOwn(expected,id));
 }
 assert.deepEqual(catalog.spawnPool({role:'patrol',systemName:'Blender'},'dominion').map(s=>s.id).sort((a,b)=>a-b),[206,322]);
});
check('five variant pairs and the requested unique BM2 hulls remain active',()=>{
 for(const id of [15,313,33,325,38,329,42,333,1,344,207,210,212,221,216,347,351]) assert.equal(catalog.getShip(id).rosterState,'active');
 assert.equal(catalog.getShip(15).faction,'neutral');assert.equal(catalog.getShip(313).faction,'terran');
 assert.equal(catalog.getShip(15).fleetEligible,false);assert.equal(catalog.getShip(313).fleetEligible,true);
 assert(!/crumbling|dominion.*won|rare to see still/i.test(catalog.getShip(333).description));
});

const shim=`window.__merge={state,startWithFaction,createNpcShip,getNpcSideId,getShipStats,
 getShipyardStock,fleetShipStock,getShipPurchaseStatus,completeShipPurchase,canBuyEscortShip,canBuyFleetShip,
 buyEscortShip,buyFleetShip,getGodModeShips,getOriginalShipWeaponSlots,getDefaultWeaponId,
 applyShipDefaultWeapons,getWeapon,getShipVisualProfile,getScaledWeaponDamage,getScaledWeaponCooldown,
 getStationOwner,playerWorldPosition,render,renderPlanetMenu,NPC_WEAPON_COOLDOWN_SCALE,NPC_WEAPON_FLOOR_SCALE,
 freeze:()=>new Promise(resolve=>{const t=setTimeout(()=>resolve(false),3000);requestAnimationFrame=cb=>{if(cb.name==='loop'){clearTimeout(t);resolve(true);}return 0;};})};`;
const mime={'.html':'text/html','.js':'text/javascript','.mjs':'text/javascript','.json':'application/json','.css':'text/css','.png':'image/png','.gif':'image/gif','.webp':'image/webp'};
const server=http.createServer((req,res)=>{
 const rel=decodeURIComponent((req.url||'/').split('?')[0]).replace(/^\/+/, '')||'index.html';
 const file=path.resolve(root,rel);
 if(!file.startsWith(root)||!fs.existsSync(file)||fs.statSync(file).isDirectory()){res.writeHead(404);res.end();return;}
 res.setHeader('Content-Type',mime[path.extname(file)]||'application/octet-stream');res.setHeader('Cache-Control','no-store');
 if(rel==='src/main.js')res.end(fs.readFileSync(file,'utf8')+shim);else fs.createReadStream(file).pipe(res);
});
await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
let browser;
try{
 browser=await chromium.launch();
 const page=await browser.newPage({viewport:{width:1280,height:900}});
 const errors=[];page.on('pageerror',e=>errors.push(e.message));
 await page.goto(`http://127.0.0.1:${server.address().port}/`);
 await page.waitForFunction(()=>window.__merge?.state.shipCatalog&&window.__merge.state.planets.length>10);
 results.push(...await page.evaluate(async(expected)=>{
  const B=window.__merge,s=B.state,out=[];
  const test=(name,ok,detail)=>out.push({name,ok:!!ok,...(!ok?{detail}:{})});
  B.startWithFaction('ferengi');test('game loop freezes',await B.freeze());
  test('starting hull resolves Ferengi #18 to #316',s.playership===316,s.playership);
  const live=Object.values(s.shipStatsById).filter(x=>x.assetType==='ship'&&x.rosterState==='active');
  test('live roster and ship selector have exactly 172 active hulls',live.length===172&&B.getGodModeShips().length===172,[live.length,B.getGodModeShips().length]);
  test('all old IDs are absent from runtime records but resolve to selected survivors',Object.entries(expected).every(([old,id])=>!s.shipStatsById[old]&&B.getShipStats(old).id===id));
  const n=B.createNpcShip({id:'alias-fixture',shipId:27,faction:'romulan',sideId:'Council',from:B.playerWorldPosition()});
  test('NPC construction uses canonical hull while preserving political identity',n.shipId===320&&n.faction==='romulan'&&B.getNpcSideId(n)==='Council',n);
  const station=s.stations.find(st=>!st.destroyed&&B.getStationOwner(st)==='player');
  if(!station)throw Error('Missing player-owned station fixture');
  s.docked=true;s.dockedStationId=station.id;s.dockedPlanetIndex=null;s.npcShips=[];s.projectiles=[];
  s.latinum=1e7;s.cargo=0;s.playerFleet=[];s.spawnProtectionUntil=0;
  station.stockIds=[34,326,304,2,337,47];
  const ids=B.getShipyardStock().map(x=>x.id);
  test('a yard listing both old and new IDs offers each hull once',ids.length===3&&new Set(ids).size===3&&[326,2,47].every(id=>ids.includes(id)),ids);
  s.factionStanding.terran=14;
  test('old and canonical IDs share faction-standing gates in all three purchase paths',[34,326].every(id=>!B.getShipPurchaseStatus(id).ok&&!B.canBuyEscortShip(id).ok&&!B.canBuyFleetShip(id).ok));
  s.factionStanding.terran=100;
  const before=s.latinum;B.completeShipPurchase(34);
  test('buying the old Defiant reference charges 62500 and stores hull #326',s.playership===326&&before-s.latinum===62500,{ship:s.playership,paid:before-s.latinum});
  // Alias coverage needs two more units after the personal purchase; stock depletion has its own fleet fixture.
  B.fleetShipStock(34).quantity=2;
  B.buyEscortShip(34);B.buyFleetShip(34);
  test('escort and garrison commissioning store canonical IDs',s.playerFleet.length===2&&s.playerFleet.every(x=>x.shipId===326),s.playerFleet);
  test('the current ship cannot be repurchased through its old alias',!B.getShipPurchaseStatus(34).ok);
  const eq=(a,b)=>JSON.stringify(a)===JSON.stringify(b);
  test('civilian and Imperial Ambassador fits are distinct and use three slots',eq(B.getOriginalShipWeaponSlots(15),[1,null,null])&&eq(B.getOriginalShipWeaponSlots(313),[2,11,15]));
  test('upgraded Akira has a heavy beam and twin quantum fit',eq(B.getOriginalShipWeaponSlots(33),[1,15,null])&&eq(B.getOriginalShipWeaponSlots(325),[2,16,16]));
  test('Steamrunner strike frigate has its own three-weapon fit',eq(B.getOriginalShipWeaponSlots(344),[9,16,15])&&!eq(B.getOriginalShipWeaponSlots(1),B.getOriginalShipWeaponSlots(344)));
  const output=id=>{const w=B.getWeapon(B.getDefaultWeaponId(id,B.getShipStats(id).faction,true));return B.getScaledWeaponDamage(id,w)/B.getScaledWeaponCooldown(id,w,B.NPC_WEAPON_COOLDOWN_SCALE,B.NPC_WEAPON_FLOOR_SCALE);};
  test('Imperial Ambassador and strike Akira have stronger NPC starting fire than their base variants',output(313)>output(15)&&output(325)>output(33),{civilian:output(15),imperial:output(313),akira:output(33),strike:output(325)});
  test('every explicit starting weapon fits its hull mass',live.every(ship=>!Array.isArray(ship.defaultWeaponSlots)||ship.defaultWeaponSlots.every(id=>!id||B.getWeapon(id).minMass<=ship.mass)));
  test('civilian shuttles retain empty, armable three-slot layouts',[348,349,350].every(id=>eq(B.getOriginalShipWeaponSlots(id),[null,null,null])));
  const v=B.getShipVisualProfile(211);test('Vulcan Explorer uses the approved native scale rounded to screen pixels',v.width===Math.round(64.5)&&v.height===Math.round(130.5)&&v.scale===1,v);
  s.planetMenuOpen=true;s.dockMenuTab='ships';B.render();B.renderPlanetMenu();
  return out;
 },expected));
 if(process.argv.includes('--screenshot'))await page.screenshot({path:process.argv[process.argv.indexOf('--screenshot')+1]});
 if(errors.length)results.push({name:'no browser errors',ok:false,detail:errors});
}finally{if(browser)await browser.close();await new Promise(resolve=>server.close(resolve));}
for(const r of results)console.log(`${r.ok?'PASS':'FAIL'} ${r.name}${r.ok?'':' '+JSON.stringify(r.detail)}`);
console.log(`${results.filter(r=>r.ok).length}/${results.length} hull merge checks passed`);
if(results.some(r=>!r.ok))process.exitCode=1;
