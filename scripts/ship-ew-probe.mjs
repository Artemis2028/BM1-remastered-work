#!/usr/bin/env node
 // Real browser engine acceptance: the module is injected for inspection only, not replaced.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import {
  fileURLToPath
} from 'node:url';
import {
  chromium
} from 'playwright';
// BM1_TEST_ROOT selects the tree this gate serves, so it can be pointed at the built dist; without
// it the repository root is served, which is what this gate used to do unconditionally.
const root = path.resolve(process.env.BM1_TEST_ROOT || fileURLToPath(new URL('../', import.meta.url)));
const shim =
  `
// Authored foreign access variants are test fixtures; all classification/order code stays real.
const probeOriginalZone=getSecurityZone;let probeForeignAccess=null;
getSecurityZone=function(...args){const z=probeOriginalZone(...args);if(z?.foreign&&probeForeignAccess){z.access={...z.access,...probeForeignAccess};z.accessSignature=JSON.stringify(z.access);}return z;};
window.__power={EW_MODULES,ensureActorEW,setEWOrder,getEWUpgradeDecision,buyEWModule,installedJammerDiscardWarning,openShipPurchaseModal,completeShipPurchase,getShipyardStock,getShipPurchaseStatus,renderEWPanel,stationElectronicProfile,stopEW,state,startWithFaction,applyCurrentShipStats,getShipStats,getWeapon,getDefaultWeaponId,
 ensureActorSensors,ensurePlayerPower,ensureNpcPower,getActorPowerProfile,createNpcShip,ensureNpcCombatStats,playerWorldPosition,
 sensorWorld,sensorKey,sensorCanTrack,sensorContact,sensorCheckpointTrack,sensorCheckpointBroadcast,sensorSnapshotActor,
 updatePowerSystems,updateSensorSystems,startSensorAction,getSensorUpgradeDecision,buySensorSuite,renderPowerPanel,renderTopLeftPanel,render,
 getSecurityZone,getSecurityAnchorCandidates,setPlayerCheckpoint,setSecurityPolicyOverride,getVisitorAccessDecision,getSecurityContact,
 resetSecurityRecords,updateSecurityEncounters,getSecurityLedger,respondToSecurityOrder,getSecurityDockingBlock,transferSystemControlToFaction,
 transferSystemControlToPlayer,getSystemIndexByName,applySystemState,fireCounterfirePoint,getCounterfireCue,recordSensorHit,sensorAttackSnapshot,
 updateProjectiles,fireNpcWeapon,fireStationWeapon,firePlayerWeapon,saveGame,loadGame,getSaveSlotKey,setPowerDist,
 getScaledWeaponDamage,getWeaponEnergyCost,getFactionStanding,setPlayerCloak,getPlayerEscortPriorityTarget,
 setForeignProbeAccess:value=>{probeForeignAccess=value;},setCamera,resolveSecurityPoint,getPlayerSecurityOrder,
 getPlayerEscortNpcShips,restoreFleetPower,snapshotActorSensors,sensorCrewEstimate,updateNpcShips,updateStationDefenses,
 getSelectedCombatTarget,cycleCombatTarget,renderSecurityPanelMarkup,renderTargetWindow:updateTargetWindow,
 setFleetStance:()=>{state.fleetStance='attack';},sensorPursuitPoint,beginAmbientTrafficArrival,playerContactLabel,
 freeze:()=>new Promise(resolve=>{const t=setTimeout(()=>resolve(false),3000);requestAnimationFrame=cb=>{if(cb.name==='loop'){clearTimeout(t);resolve(true);}return 0;};})};`;
const mime = {
  '.html': 'text/html',
  '.js': 'text/javascript',
  '.mjs': 'text/javascript',
  '.json': 'application/json',
  '.css': 'text/css',
  '.png': 'image/png',
  '.gif': 'image/gif',
  '.webp': 'image/webp'
};
const server = http.createServer((req, res) => {
  const rel = decodeURIComponent((req.url || '/').split('?')[0]).replace(/^\/+/, '') || 'index.html';
  const file = path.resolve(root, rel);
  if (!file.startsWith(root + path.sep) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) {
    res.writeHead(404);
    res.end();
    return;
  }
  res.setHeader('Content-Type', mime[path.extname(file)] || 'application/octet-stream');
  res.setHeader('Cache-Control', 'no-store');
  if (rel === 'src/main.js') res.end(fs.readFileSync(file, 'utf8') + shim);
  else fs.createReadStream(file).pipe(res);
});
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
let browser;
try {
  browser = await chromium.launch();
  const page = await browser.newPage({
      viewport: {
        width: 1280,
        height: 850
      },
      hasTouch: true
    }),
    errors = [];
  page.on('pageerror', e => {
    errors.push(e.message);
    console.error('PAGE', e.message);
  });
  await page.goto(`http://127.0.0.1:${server.address().port}/`);
  await page.waitForFunction(() => window.__power?.state.shipCatalog && window.__power.state.planets.length > 10);
  const result=await page.evaluate(async()=>{
    const B=window.__power,s=B.state,checks=[];
    const test=(name,ok,detail)=>checks.push({name,ok:!!ok,...(!ok?{detail}:{})});
    B.startWithFaction('terran');test('real engine freezes',await B.freeze());
    const home=s.currentPlanet,p=B.playerWorldPosition(),stations=s.stations;
    s.npcShips=[];s.stations=[];s.activeFleetAttack=null;s.spawnProtectionUntil=0;
    const step=(n=12)=>{for(let i=0;i<n;i++){B.updatePowerSystems(6);B.updateSensorSystems(6);}};
    const spawn=(id,x,opts={})=>{const n=B.createNpcShip({id,seed:id,shipId:1,role:'traffic',faction:'ferengi',ew:null,from:{x:p.x+x,y:p.y},...opts});B.ensureNpcCombatStats(n);B.ensureNpcPower(n);s.npcShips.push(n);return n;};
    const empty=B.ensureActorEW();test('new captain starts empty without changing three weapon slots',empty.module===null&&s.weaponSlots.length===3);
    s.docked=true;s.latinum=1000000;
    for(const [id,threshold] of [[1,15],[2,30],[3,75]]){
      s.factionStanding.terran=threshold-1;test(`module ${id} rejects below faction standing`,!B.getEWUpgradeDecision(id).canBuy);
      s.factionStanding.terran=threshold;const cash=s.latinum;test(`module ${id} purchases at tier and charges once`,B.buyEWModule(id)&&s.latinum===cash-B.EW_MODULES[id].price);
      test(`module ${id} cannot be rebought`,!B.buyEWModule(id));
    }
    test('docked transmit order refused',!B.setEWOrder(s,'jammer','on'));
    s.docked=false;s.power.dist={engines:0,weapons:0,shields:0,sensors:5};B.ensurePlayerPower().energy=190;
    test('real jammer control enables requested module',B.setEWOrder(s,'jammer','on'));step(15);
    test('paid field begins after spin-up and consumes energy',s.ew.operating&&s.ew.strength>0&&s.power.energy<190,{ew:s.ew,power:s.power});
    const slots=JSON.stringify(s.weaponSlots),stand=JSON.stringify(s.factionStanding),cue=s.lastPlayerShotAt;
    const receiver=spawn(9801,300);step(15);
    test('foreign receiver measures paid interference',receiver.ewReception.noise>0&&receiver.ewReception.quality<1,receiver.ewReception);
    test('jamming changes no weapons, standing or attack evidence',JSON.stringify(s.weaponSlots)===slots&&JSON.stringify(s.factionStanding)===stand&&s.lastPlayerShotAt===cue&&!receiver.lastAggressionAt);
    B.setEWOrder(s,'jammer','off');step(1);test('Off removes field immediately',s.ew.strength===0&&!s.ew.transmitting);
    s.npcShips=[];
    const donor=spawn(9802,300,{role:'playerEscort',fleetId:'ew-escort',faction:'terran',ew:{module:3,jammerOrder:'on'}});
    donor.power.dist={engines:0,weapons:0,shields:0,sensors:5};donor.power.decisionIn=100;donor.power.energy=500;
    step(16);test('own fleet interference is named in real panel',B.renderEWPanel().includes('Own fleet jammer'),B.renderEWPanel());
    const before=s.ewReception.quality;B.setEWOrder(s,'eccm','boost');step(3);
    test('ECCM raises local quality and records actual draw',s.ewReception.quality>before&&s.power.telemetry.eccm>0);
    const foreign=spawn(9803,100);
    s.docked=true;s.factionStanding.terran=100;
    test('foreign refit rejected',!B.getEWUpgradeDecision(1,foreign).canBuy);
    test('local escort and garrison use same standing gate',B.getEWUpgradeDecision(2,donor).canBuy);
    donor.x=p.x+2500;test('remote commanded ship refit rejected',!B.getEWUpgradeDecision(2,donor).canBuy);donor.x=p.x+300;
    B.buyEWModule(2,donor);s.playerFleet=[{id:'ew-escort',shipId:1,faction:'terran',assignment:'escort',seed:9802}];
    s.docked=false;B.setEWOrder(donor,'jammer','auto');donor.power.energy=17;s.power.energy=19;B.saveGame(8);B.loadGame(8);
    test('save restores player module, manual ECCM and energy',s.ew.module===3&&s.ew.eccmOrder==='boost'&&s.power.energy===19,{ew:s.ew,p:s.power});
    const restored=s.npcShips.find(n=>n.fleetId==='ew-escort');
    test('fleet save restores equipment and order without refill',restored?.ew?.module===2&&restored.ew.jammerOrder==='auto'&&restored.power.energy===17,restored?.ew);
    const key=B.getSaveSlotKey(8),raw=JSON.parse(localStorage.getItem(key));delete raw.ew;for(const f of raw.playerFleet||[])delete f.ew;localStorage.setItem(key,JSON.stringify(raw));B.loadGame(8);
    test('pre-EW save gets empty captain/fleet equipment',B.ensureActorEW().module===null&&s.playerFleet.every(f=>!f.ew?.module));
    s.npcShips=[];s.stations=[];s.docked=false;
    const dark=spawn(9805,2800,{ew:{module:3,jammerOrder:'on'}});dark.power.energy=500;dark.power.decisionIn=100;dark.power.dist={engines:0,weapons:0,shields:0,sensors:5};B.ensureActorSensors(dark).transponder=false;
    B.ensureActorSensors().suite=2;s.power.energy=190;s.power.dist={engines:0,weapons:0,shields:0,sensors:5};step(30);
    test('Fleet emission is detected beyond comms without identity',B.sensorCanTrack(s,dark)&&!B.sensorContact(s,dark)?.declaration,B.sensorContact(s,dark));
    B.setPlayerCloak(true);test('cloak switches captain jammer Off',s.ew.jammerOrder==='off'&&!s.ew.transmitting);B.setPlayerCloak(false);
    const oldModule=dark.ew.module;dark.ew.owner='terran';dark.sideId='player';B.ensureActorEW(dark);
    test('capture retains module but clears former operating orders',dark.ew.module===oldModule&&dark.ew.jammerOrder==='off');
    dark.ew.module=3;B.beginAmbientTrafficArrival(dark,performance.now());test('ambient replacement drops old equipment and operating state',dark.ew.module===null&&!dark.ew.operating);
    s.stations=stations;s.npcShips=[];s.docked=false;B.ensureActorEW().module=1;
    // EW used to be printed twice — a collapsed section inside OPS and again in its own panel — so the
    // captain had two sets of the same controls and neither was where the EW button pointed. It now
    // lives only in its own panel, already expanded, which is what these three check.
    s.topLeftPanelOpen=true;s.topLeftTab='power';B.renderTopLeftPanel();
    test('OPS no longer carries a second copy of the EW controls',
      !document.querySelector('#top-left-panel [data-ew-order]'),
      document.querySelector('#top-left-panel [data-ew-order]')?.outerHTML);
    s.topLeftTab='ew';B.renderTopLeftPanel();
    const jam=document.querySelector('[data-ew-order="jammer:on"][data-ew-ship="player"]');
    test('the EW panel opens expanded, with its orders reachable without opening anything',
      Boolean(jam) && !jam.closest('details:not([open])') && jam.offsetHeight>0);
    jam?.click();
    test('actual DOM jammer order works',s.ew.jammerOrder==='on');
    document.querySelector('[data-ew-order="eccm:boost"][data-ew-ship="player"]')?.click();test('actual DOM ECCM order works',s.ew.eccmOrder==='boost');
    const platforms=Object.values(s.shipStatsById).filter(t=>/defen[sc]e.*platform/i.test(t.name||''));
    test('real station type records give military platforms enhanced arrays',platforms.length>0&&platforms.every(t=>B.stationElectronicProfile({stationTypeId:t.id}).passive===1500&&B.stationElectronicProfile({stationTypeId:t.id}).processing===1.25),platforms.map(t=>({id:t.id,name:t.name})));
    s.stations=stations;s.docked=true;s.latinum=1e6;s.factionStanding.terran=100;s.cargo=0;
    const vendor=stations.find(st=>!st.destroyed&&!st.underConstruction&&B.getShipyardStock(st).length>0);s.dockedStationId=vendor?.id||null;
    B.ensureActorEW().module=3;
    const stock=(vendor?B.getShipyardStock(vendor):[]).find(ship=>B.getShipPurchaseStatus(ship.id)?.ok);
    const warn=B.installedJammerDiscardWarning();
    if(stock)B.openShipPurchaseModal(stock.id);
    const modal=document.querySelector('.ship-purchase-card')?.innerHTML||'';
    const suite=B.ensureActorSensors().suite;
    if(stock)B.completeShipPurchase(stock.id);
    test('command-hull purchase warns, then discards the jammer without carry-over or price changes',
      !!stock&&!!warn&&warn.includes('discards the installed')&&modal.includes('discards the installed')&&
      s.ew.module===null&&B.ensureActorSensors().suite===suite&&B.EW_MODULES[3].price===60000&&B.getWeapon(46)?.price===9000,
      {warn,stock:stock?.id,playership:s.playership,module:s.ew.module,modal:modal.slice(0,280)});
    return {checks};
  });
  if(process.argv.includes('--screenshot')){
    const filename=process.argv[process.argv.indexOf('--screenshot')+1];
    const expose=()=>page.evaluate(()=>{const el=document.querySelector('[data-sensor-details="ew"]');el?.setAttribute('open','');el?.scrollIntoView({block:'start'});});
    await page.evaluate(()=>{const B=window.__power,s=B.state,p=B.playerWorldPosition();s.docked=false;
      const escort=B.createNpcShip({id:9899,seed:9899,shipId:1,faction:'terran',role:'playerEscort',fleetId:'ew-preview',from:{x:p.x+300,y:p.y},ew:{module:3,jammerOrder:'on'}});
      B.ensureNpcCombatStats(escort);B.ensureNpcPower(escort);escort.power.energy=180;escort.power.dist={engines:0,weapons:0,shields:0,sensors:5};s.npcShips.push(escort);
      for(let i=0;i<8;i++){B.updatePowerSystems(12);B.updateSensorSystems(12);}B.renderTopLeftPanel();});
    await expose();await page.screenshot({path:filename});
    await page.setViewportSize({width:1024,height:768});await expose();
    await page.locator('[data-ew-order="jammer:off"][data-ew-ship="player"]').tap();await expose();
    await page.locator('[data-ew-order="jammer:on"][data-ew-ship="player"]').tap();await expose();
    result.checks.push({name:'1024×768 touch viewport operates jammer controls',ok:await page.evaluate(()=>window.__power.state.ew.jammerOrder==='on')});
    await page.screenshot({path:filename.replace(/\.png$/, '-touch.png')});
    await page.setViewportSize({width:1280,height:850});
    await page.evaluate(()=>{const B=window.__power;B.state.docked=true;B.renderTopLeftPanel();});await expose();
    await page.screenshot({path:filename.replace(/\.png$/, '-refit.png')});
  }
  for(const c of result.checks)console.log(`${c.ok?'PASS':'FAIL'} ${c.name}${c.ok?'':' '+JSON.stringify(c.detail)}`);
  console.log(`${result.checks.filter(c=>c.ok).length}/${result.checks.length} live EW checks passed`);
  if(errors.length||result.checks.some(c=>!c.ok))process.exitCode=1;
}finally{if(browser)await browser.close();server.close();}
