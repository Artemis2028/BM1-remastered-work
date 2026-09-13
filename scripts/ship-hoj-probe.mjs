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
const root = path.resolve(fileURLToPath(new URL('../', import.meta.url)));
const shim =
  `
// Authored foreign access variants are test fixtures; all classification/order code stays real.
const probeOriginalZone=getSecurityZone;let probeForeignAccess=null;
getSecurityZone=function(...args){const z=probeOriginalZone(...args);if(z?.foreign&&probeForeignAccess){z.access={...z.access,...probeForeignAccess};z.accessSignature=JSON.stringify(z.access);}return z;};
window.__power={HOJ_WEAPON_ID,launchHoj,hasHojLaunchTrack,hojEmitterKey,liveJammerSignal,getHojPurchaseDecision,getStationWeaponStock,buyWeapon,getCurrentDockedStation,updateHojProjectile,EW_MODULES,ensureActorEW,setEWOrder,getEWUpgradeDecision,buyEWModule,renderEWPanel,stationElectronicProfile,stopEW,state,startWithFaction,applyCurrentShipStats,getShipStats,getWeapon,getDefaultWeaponId,
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
    const home=s.currentPlanet,p=B.playerWorldPosition(),stations=s.stations,weapon=B.getWeapon(B.HOJ_WEAPON_ID);
    const originalSlots=B.getShipStats(1).defaultWeaponSlots;
    const step=(n=8)=>{for(let i=0;i<n;i++){B.updatePowerSystems(12);B.updateSensorSystems(12);}};
    const reset=()=>{s.npcShips=[];s.stations=[];s.projectiles=[];s.activeFleetAttack=null;s.docked=false;s.spawnProtectionUntil=0;s.cloak.active=false;
      s.weaponInventory=[B.HOJ_WEAPON_ID];s.weaponSlots=[B.HOJ_WEAPON_ID,null,null];s.weaponLastFiredAt=[-1e9,0,0];s.combatTargetId=null;s.combatTargetType='ship';s.autoTarget=false;
      B.ensurePlayerPower().energy=200;s.power.dist={engines:0,weapons:5,shields:0,sensors:5};B.sensorWorld.clear(home);};
    const spawn=(id,x,opts={})=>{const n=B.createNpcShip({id,seed:id,shipId:1,role:'traffic',faction:'klingon',attitude:'hostile',hostile:true,ew:null,from:{x:p.x+x,y:p.y},...opts});B.ensureNpcCombatStats(n);B.ensureNpcPower(n);n.power.energy=200;n.power.dist={engines:0,weapons:5,shields:0,sensors:5};s.npcShips.push(n);return n;};
    const emitter=(id,x,opts={})=>spawn(id,x,{ew:{module:3,jammerOrder:'on'},...opts});
    const select=n=>{s.combatTargetId=n.id;s.combatTargetType=n.stationTypeId?'station':'ship';s.weaponLastFiredAt[0]=-1e9;};
    const fly=(n=180)=>{for(let i=0;i<n&&s.projectiles.length;i++)B.updateProjectiles(1);};
    const launch=(target)=>{select(target);B.firePlayerWeapon(1);return s.projectiles.at(-1);};
    reset();const target=emitter(9901,1700);step();test('paid Fleet emission produces real launch track beyond Photon range',B.hasHojLaunchTrack(s,target)&&weapon.range===1800&&1700>B.getWeapon(15).range);
    const energy=s.power.energy;const first=launch(target);test('real player fire launches in one slot and charges normal weapon energy',first?.guidance==='home-on-jam'&&s.power.energy===energy-B.getWeaponEnergyCost(weapon)&&s.weaponSlots.length===3,{first,energy,after:s.power.energy});
    const charged=s.power.energy;B.firePlayerWeapon(1);test('cooldown rejects repeat without duplicate energy charge',s.projectiles.length===1&&s.power.energy===charged);
    const before=(target.combatHull||0)+(target.combatShields||0);fly();test('standoff torpedo physically hits with player attribution and aggression evidence',target.lastDamageSource==='player'&&(target.combatHull||0)+(target.combatShields||0)<before&&B.sensorContact(target,s)?.cue,{damage:target.lastDamageSource});
    reset();const far=emitter(9902,1810);step();launch(far);test('actual launch gate rejects beyond 1800 despite fresh emission',B.hasHojLaunchTrack(s,far)&&s.projectiles.length===0);
    reset();const dark=spawn(9903,300);step();launch(dark);test('normal visual track is insufficient without a jamming emission',B.sensorCanTrack(s,dark)&&s.projectiles.length===0);
    reset();const poor=emitter(9904,1000);step();s.power.energy=0;launch(poor);test('empty reactor refuses launch with no aggression or cooldown',!s.projectiles.length&&s.weaponLastFiredAt[0]===-1e9);
    reset();const silent=emitter(9905,1700);step();const coast=launch(silent);B.stopEW(silent.ew);B.updateProjectiles(12);test('silence changes to ballistic at next sample and keeps projectile alive',coast&&!coast.steering&&!coast.dead,coast);
    const heading=coast.heading;silent.y+=500;B.updateProjectiles(12);test('ballistic flight ignores silent entity motion',coast.heading===heading);
    // Reacquire within cone from a newly funded field; do not advance projectiles during spin-up fixture.
    silent.y=p.y;silent.ew.jammerOrder='on';step(17);const life=coast.lifeRemaining;B.updateProjectiles(1);test('original incarnation reacquires without renewing lifetime',coast.steering&&coast.lifeRemaining<life,coast);
    reset();const old=emitter(9906,1700);step();const recycled=launch(old);s.npcShips=[];const replacement=emitter(9906,1600);step();B.updateProjectiles(13);test('even a reused ID and seed cannot redirect onto replacement object',B.hojEmitterKey(old)!==B.hojEmitterKey(replacement)&&!recycled.steering);
    reset();const turning=emitter(9907,1700);step();const miss=launch(turning);B.stopEW(turning.ew);turning.y+=600;fly(181);test('silent moved target survives a finite-life miss',miss.dead&&miss.elapsed<=3.000001&&!turning.lastDamageSource,miss.elapsed);
    reset();const intended=emitter(9908,1700);step();const collateral=spawn(9909,600,{faction:'ferengi',attitude:'neutral',hostile:false});const hit=launch(intended);fly();test('intervening body takes physical impact with credit on actual victim',collateral.lastDamageSource==='player'&&!intended.lastDamageSource&&hit.dead);
    reset();const innocent=emitter(9910,1000,{faction:'ferengi',hostile:false,attitude:'neutral'});const escort=spawn(9911,0,{faction:'terran',role:'playerEscort',hostile:false,attitude:'friendly',fleetId:'hoj-escort'});step();
    B.getShipStats(1).defaultWeaponSlots=[B.HOJ_WEAPON_ID,null,null];escort.lastShotAt=-1e9;B.fireNpcWeapon(escort,innocent,'ship');test('emission alone is not ROE permission for escort',!s.projectiles.length);
    innocent.hostile=true;innocent.attitude='hostile';B.fireNpcWeapon(escort,innocent,'ship');test('escort real weapon path launches against legal hostile emitter',s.projectiles[0]?.creditSource==='playerEscort');s.camera.x=p.x-400;fly();test('escort impact keeps playerEscort credit',innocent.lastDamageSource==='playerEscort');s.camera.x=p.x;
    reset();const victim=emitter(9912,1000,{faction:'ferengi'}),pirate=spawn(9913,0,{faction:'pirate',role:'patrol'});step();pirate.lastShotAt=-1e9;B.fireNpcWeapon(pirate,victim,'ship');s.camera.x=p.x-400;fly();test('foreign NPC weapon path credits NPC instead of player',victim.lastDamageSource==='npc');s.camera.x=p.x;
    reset();const stationTarget=emitter(9914,1000);const turret={...stations.find(st=>!st.destroyed&&!st.underConstruction),x:p.x,y:p.y,stationWeaponIds:[B.HOJ_WEAPON_ID],shotIndex:0,lastShotAt:-1e9};s.stations=[turret];step();B.fireStationWeapon(turret,stationTarget);test('station real weapon path launches with station credit',s.projectiles[0]?.creditSource==='station');s.camera.x=p.x-400;fly();test('station impact credits station',stationTarget.lastDamageSource==='station');s.camera.x=p.x;
    reset();const foe=spawn(9915,1100,{faction:'pirate',role:'patrol'});s.ew={module:3,jammerOrder:'on'};step();foe.lastShotAt=-1e9;B.fireNpcWeapon(foe,B.playerWorldPosition(),'player');const incoming=s.projectiles[0];B.setPlayerCloak(true,performance.now(),true);test('player cloak leaves incoming seeker projectile intact',incoming&&s.projectiles.includes(incoming));B.updateProjectiles(13);test('cloaked emitter cannot feed seeker steering',incoming&&!incoming.steering);
    reset();const shared=emitter(9916,1700);const scout=spawn(9917,900,{faction:'terran',role:'playerEscort',fleetId:'scout',hostile:false,attitude:'friendly'});s.power.dist.sensors=0;step(12);test('captain can launch from fresh direct shared emission report',B.sensorContact(s,shared)?.source==='shared'&&B.hasHojLaunchTrack(s,shared));const sharedShot=launch(shared);test('shared emission really launches',!!sharedShot);
    B.stopEW(shared.ew);step(4);s.weaponLastFiredAt[0]=-1e9;const count=s.projectiles.length;launch(shared);test('stale shared emission cannot authorize another launch',s.projectiles.length===count);
    // Give the seeker a fresh private emission while captain contact data is frozen.
    shared.ew.jammerOrder='on';step(16);const report=B.sensorContact(s,shared),position=JSON.stringify(report.position);shared.y+=100;B.updateProjectiles(13);test('seeker observations never update shooter contact reports',JSON.stringify(report.position)===position);
    B.getShipStats(1).defaultWeaponSlots=originalSlots;
    reset();s.stations=stations;s.docked=true;s.latinum=100000;const vendor=stations.find(st=>st.id==='0-3');
    test('Daystrom explicit stock contains new torpedo',!!vendor&&B.getStationWeaponStock(vendor).some(w=>w.id===B.HOJ_WEAPON_ID));
    test('authored limited stock is not silently expanded',!B.getStationWeaponStock({weaponStockIds:[15],stationTypeId:71}).some(w=>w.id===B.HOJ_WEAPON_ID));
    s.factionStanding.terran=29;test('respected boundary refuses 29 standing',!B.getHojPurchaseDecision(vendor).canBuy);
    s.factionStanding.terran=30;test('respected boundary allows 30 standing',B.getHojPurchaseDecision(vendor).canBuy,B.getHojPurchaseDecision(vendor));
    s.dockedStationId=vendor.id;s.weaponInventory=[];s.weaponSlots=[null,null,null];s.mymass=Math.max(1,s.mymass);
    const cash=s.latinum;B.buyWeapon(B.HOJ_WEAPON_ID);
    test('real store purchase charges 9000 once and loads an existing weapon slot',s.latinum===cash-9000&&s.weaponInventory.includes(B.HOJ_WEAPON_ID)&&s.weaponSlots.includes(B.HOJ_WEAPON_ID));
    s.factionStanding.terran=29;const cashDenied=s.latinum;B.buyWeapon(B.HOJ_WEAPON_ID);
    test('direct purchase handler cannot bypass standing gate',s.latinum===cashDenied);
    test('defense platform does not become a weapon shop',!B.getHojPurchaseDecision({stationTypeId:89}).canBuy);
    return {checks};
  });
  for(const c of result.checks)console.log(`${c.ok?'PASS':'FAIL'} ${c.name}${c.ok?'':' '+JSON.stringify(c.detail)}`);
  console.log(`${result.checks.filter(c=>c.ok).length}/${result.checks.length} live seeker checks passed`);
  if(errors.length||result.checks.some(c=>!c.ok))process.exitCode=1;
}finally{if(browser)await browser.close();server.close();}
