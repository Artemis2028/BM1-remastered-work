#!/usr/bin/env node
// Roster-wide contracts plus real engine measurements. No replacement combat model.
import fs from 'node:fs';
import path from 'node:path';
import http from 'node:http';
import assert from 'node:assert/strict';
import {fileURLToPath} from 'node:url';
import {chromium} from 'playwright';
import {createShipCatalog} from '../bm-ships/catalog.mjs';
const root=fileURLToPath(new URL('../',import.meta.url));
const read=p=>JSON.parse(fs.readFileSync(path.join(root,p),'utf8'));
const manifest=read('bm-ships/ships.json'), ships=manifest.ships.filter(s=>s.rosterState==='active');
const catalog=createShipCatalog(manifest,read('bm-ships/bm2-id-map.json'),read('bm-ships/size-config.json'));
const weapons=new Map(read('data/game_items.json').weapons.map(w=>[w.id,w]));
const results=[];
const check=(name,fn)=>{fn();results.push({name,ok:true});};
check('all 172 active hulls have a role, rationale, explicit faction gate and reviewed capabilities',()=>{
 assert.equal(ships.length,172);
 for(const s of ships){
  assert(s.role && s.balanceReview.rationale && s.balanceReview.loreBasis,String(s.id));
  for(const k of ['cost','hull','cargoCapacity','mass','topSpeed','turnRate','warpRange','fuelCapacity','impulseSpeed','handlingTurnRate'])assert(Number.isFinite(s[k])&&s[k]>0,`${s.id}:${k}`);
  assert(Number.isFinite(s.shields)&&s.shields>=0);
  assert([0,15,30,50,75,100].includes(s.purchaseRequirements.factionStanding));
  assert.equal(s.purchaseRequirements.faction,s.faction);
 }
});
check('every supplied slot is explicit, defined and compatible with its hull; no obsolete ID fit leaks',()=>{
 for(const s of ships){
  assert.equal(s.defaultWeaponSlots.length,3);
  for(const id of s.defaultWeaponSlots){if(id===null)continue;assert(weapons.has(id),`${s.id}:${id}`);assert(weapons.get(id).minMass<=s.mass,`${s.id}:${id} mass`);}
  const combat=s.defaultWeaponSlots.some(id=>id&&weapons.get(id).type!=='Device');
  assert.equal(s.armedByDefault,combat);
  const equipmentCost=s.defaultWeaponSlots.reduce((sum,id)=>sum+(id?weapons.get(id).price:0),0);
  assert(equipmentCost<s.cost,`${s.id}: ship cheaper than its supplied equipment`);
 }
 assert(!catalog.getShip(2).defaultWeaponSlots.includes(5)); // no Excelsior Cutting Beam from BM2 ID collision
});
check('same-class retained variants provide deliberate upgrades or civilian/military tradeoffs',()=>{
 for(const [base,upgrade] of [[1,344],[33,325],[38,329],[42,333]]){
  const [a,b]=[base,upgrade].map(catalog.getShip);
  assert(b.cost>a.cost && b.hull+b.shields>a.hull+a.shields);
  assert(b.purchaseRequirements.factionStanding>=a.purchaseRequirements.factionStanding);
  assert.notDeepEqual(a.defaultWeaponSlots,b.defaultWeaponSlots);
 }
 assert(catalog.getShip(15).cargoCapacity>catalog.getShip(313).cargoCapacity);
 assert(catalog.getShip(313).hull+catalog.getShip(313).shields>catalog.getShip(15).hull+catalog.getShip(15).shields);
});
check('early progression and specialist tradeoffs replace the old price inversions',()=>{
 const excelsior=catalog.getShip(2),miranda=catalog.getShip(305);
 assert(excelsior.cost>miranda.cost&&excelsior.hull+excelsior.shields>miranda.hull+miranda.shields);
 assert(miranda.warpRange>excelsior.warpRange);
 const oberth=catalog.getShip(47),aero=catalog.getShip(281);
 assert(oberth.cargoCapacity>aero.cargoCapacity&&oberth.warpRange>aero.warpRange);
 assert(aero.impulseSpeed>oberth.impulseSpeed&&aero.handlingTurnRate>oberth.handlingTurnRate);
 const steam=catalog.getShip(1),thawn=catalog.getShip(301);
 assert(steam.cargoCapacity>thawn.cargoCapacity&&steam.hull+steam.shields>thawn.hull+thawn.shields);
 assert(thawn.impulseSpeed>steam.impulseSpeed&&thawn.handlingTurnRate>steam.handlingTurnRate);
 const kl=[330,351,332].map(catalog.getShip);
 for(let i=1;i<kl.length;i++)assert(kl[i].cost>kl[i-1].cost&&kl[i].hull+kl[i].shields>kl[i-1].hull+kl[i-1].shields);
});
check('all faction gates work just below and at their threshold without host tier configuration',()=>{
 for(const ship of ships){
  const requirement=ship.purchaseRequirements.factionStanding;
  const context={credits:1e9,standings:{[ship.faction]:requirement},systemName:'Earth',controller:'borg'};
  if(ship.availabilityRegion?.startsWith('dominion'))Object.assign(context,{systemName:'Dominica',region:'dominion-core'});
  if(ship.specialVendor)context.vendor=ship.specialVendor;
  if(ship.availabilityRegion==='secret-paso')context.systemName='Paso';
  if(ship.availabilityRegion==='secret-remus')context.systemName='Remus';
  const decision=catalog.getPurchaseDecision(ship.id,context);
  assert.notEqual(decision.reason,'standing-threshold-unconfigured');
  if(decision.allowed){
   assert.equal(decision.price,ship.cost);
   assert.equal(catalog.getPurchaseDecision(ship.id,{...context,credits:ship.cost-1}).reason,'funds');
  }
  if(requirement>0){
   const below=catalog.getPurchaseDecision(ship.id,{...context,standings:{[ship.faction]:requirement-1}});
   assert.equal(below.reason,'faction-standing',String(ship.id));
   assert.equal(below.requiredFaction,ship.faction);
  }
 }
});
check('supercapital gates and region restrictions survive the full balance pass',()=>{
 for(const id of [60,61,62,64,65,66,347])assert.equal(catalog.getShip(id).purchaseRequirements.factionStanding,100);
 assert.equal(catalog.getShip(347).cost,1500000);assert.equal(catalog.getShip(60).cost,1050000);
 assert.deepEqual(catalog.spawnPool({role:'patrol',systemName:'Blender'},'dominion').map(s=>s.id).sort((a,b)=>a-b),[206,322]);
 for(const id of [48,65,216,238])assert(!catalog.eligibleForSpawn(id,{role:'traffic',systemName:'Blender'}));
 for(const id of [251,252,288])assert(!catalog.eligibleForStock(id,{systemName:'Earth'}));
 assert(!catalog.eligibleForSpawn(261,{role:'traffic',systemName:'Earth'}));
 assert(catalog.eligibleForSpawn(261,{role:'mission',authorizedDeployment:true}));
});
check('empty and utility-only craft cannot be selected as armed patrols or invasion ships',()=>{
 assert.equal(catalog.getShip(342).armedByDefault,false);
 assert(catalog.getShip(342).defaultWeaponSlots.includes(25));
 for(const ship of ships.filter(s=>!s.armedByDefault)){
  assert(!catalog.eligibleForSpawn(ship.id,{role:'patrol',systemName:'Dominica',region:'dominion-core'}));
  assert(!catalog.eligibleForSpawn(ship.id,{role:'fleetAttack',authorizedDeployment:true,systemName:'Dominica'}));
 }
 for(const id of [55,61,62,64,65,66])assert(!catalog.eligibleForSpawn(id,{role:'traffic',systemName:'Dominica'}));
});
const shim=`window.__balance={state,startWithFaction,applyCurrentShipStats,applyShipDefaultWeapons,
 getShipStats,getShipHandlingProfile,getShipWarpRange,getScaledWeaponDamage,getScaledWeaponCooldown,
 getWeapon,getDefaultWeaponId,getOriginalShipWeaponSlots,getNpcFlightProfile,createNpcShip,
 fireNpcWeapon,playerWorldPosition,NPC_WEAPON_COOLDOWN_SCALE,NPC_WEAPON_FLOOR_SCALE,
 getShipPurchaseSummary,render,openShipPurchaseModal,loadWeaponSlot,
 freeze:()=>new Promise(resolve=>{const t=setTimeout(()=>resolve(false),3000);requestAnimationFrame=cb=>{if(cb.name==='loop'){clearTimeout(t);resolve(true);}return 0;};})};`;
const mime={'.html':'text/html','.js':'text/javascript','.mjs':'text/javascript','.json':'application/json','.css':'text/css','.png':'image/png','.gif':'image/gif','.webp':'image/webp'};
const server=http.createServer((req,res)=>{
 const rel=decodeURIComponent((req.url||'/').split('?')[0]).replace(/^\/+/, '')||'index.html';
 const file=path.resolve(root,rel);
 if(!file.startsWith(root)||!fs.existsSync(file)||fs.statSync(file).isDirectory()){res.writeHead(404);res.end();return;}
 res.setHeader('Content-Type',mime[path.extname(file)]||'application/octet-stream');
 if(rel==='src/main.js')res.end(fs.readFileSync(file,'utf8')+shim);else fs.createReadStream(file).pipe(res);
});
await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
let browser;
try{
 browser=await chromium.launch();
 const page=await browser.newPage({viewport:{width:1280,height:900}});
 const errors=[];page.on('pageerror',e=>errors.push(e.message));
 await page.goto(`http://127.0.0.1:${server.address().port}/`);
 await page.waitForFunction(()=>window.__balance?.state.shipCatalog&&window.__balance.state.planets.length>10);
 const live=await page.evaluate(async()=>{
  const B=window.__balance,s=B.state,checks=[],measurements=[];
  const test=(name,ok,detail=null)=>checks.push({name,ok:!!ok,...(ok?{}:{detail})});
  B.startWithFaction('ferengi');test('live game loop freezes',await B.freeze());
  s.cargo=0;s.npcShips=[];s.projectiles=[];s.activeFleetAttack=null;s.docked=false;s.spawnProtectionUntil=0;
  s.originalShipWeaponSlots=Object.fromEntries(Array.from({length:400},(_,id)=>[id,[5,5,5]])); // poison legacy rows
  const bad={fit:[],physics:[],reprice:[],npc:[],arm:[]};
  const ships=Object.values(s.shipStatsById).filter(x=>x.assetType==='ship'&&x.rosterState==='active');
  for(const ship of ships){
   s.playership=ship.id;B.applyCurrentShipStats(true);B.applyShipDefaultWeapons(ship.id,false);
   const profile=B.getShipHandlingProfile(ship.id), range=B.getShipWarpRange(ship.id);
   if(JSON.stringify(s.weaponSlots)!==JSON.stringify(ship.defaultWeaponSlots))bad.fit.push(ship.id);
   if(Math.abs(s.ship.baseMaxSpeed-ship.impulseSpeed)>1e-8||s.fuelCap!==ship.fuelCapacity||range!==ship.warpRange||s.tothull!==ship.hull||s.totshields!==ship.shields||s.cargoCap!==ship.cargoCapacity)bad.physics.push(ship.id);
   const price=ship.cost;ship.cost=price*10;
   if(B.getShipWarpRange(ship.id)!==range)bad.reprice.push(ship.id);ship.cost=price;
   const combat=ship.defaultWeaponSlots.filter(id=>id&&B.getWeapon(id).type!=='Device');
   const slots=ship.defaultWeaponSlots.map(id=>{
    if(!id)return {id:null,damage:0,cooldownMs:0,reloadLimitedDps:0};
    const w=B.getWeapon(id),damage=B.getScaledWeaponDamage(ship.id,w),cooldown=B.getScaledWeaponCooldown(ship.id,w);
    return {id,name:w.name,damage,cooldownMs:cooldown,reloadLimitedDps:w.type==='Device'?0:Math.round(damage*100000/cooldown)/100};
   });
   const npcPrimary=B.getDefaultWeaponId(ship.id,ship.faction,true);
   if(npcPrimary!==(combat[0]||null))bad.npc.push(ship.id);
   if(!ship.armedByDefault){
    const n=B.createNpcShip({id:`empty-${ship.id}`,shipId:ship.id,faction:ship.faction,from:B.playerWorldPosition(),role:'traffic'});
    n.lastShotAt=-1e9;B.fireNpcWeapon(n,B.playerWorldPosition(),'player',performance.now());
    if(n.lastShotAt!==-1e9||n.lastAggressionAt)bad.npc.push(ship.id);
    s.weaponInventory=[1];B.loadWeaponSlot(1,0);
    if(s.weaponSlots[0]!==1)bad.arm.push(ship.id);
   }
   measurements.push({id:ship.id,name:ship.name,price:ship.cost,standing:ship.purchaseRequirements.factionStanding,
    hull:ship.hull,shields:ship.shields,cargo:ship.cargoCapacity,impulseSpeed:s.ship.baseMaxSpeed,
    turnRate:profile.turnRate,maxTurnSpeed:profile.maxTurnSpeed,warpRange:range,fuelCapacity:s.fuelCap,
    npcSpeed:B.getNpcFlightProfile(ship.id,77).speed,npcPrimary,slots});
  }
  test('all 172 hulls instantiate and keep their exact three slots despite poisoned legacy item rows',ships.length===172&&bad.fit.length===0,bad.fit);
  test('all live hull, shield, cargo, impulse, fuel and range values match the authored capabilities',bad.physics.length===0,bad.physics);
  test('repricing every hull leaves its warp range unchanged',bad.reprice.length===0,bad.reprice);
  test('NPC primary weapons match supplied compatible combat equipment; empty and utility craft emit no aggression',bad.npc.length===0,bad.npc);
  test('every initially noncombat hull accepts a compatible weapon in a real equipment slot',bad.arm.length===0,bad.arm);
  const m=id=>measurements.find(x=>x.id===id);
  test('fast scout and freighter differ in actual player speed, NPC speed and turning',m(272).impulseSpeed>m(318).impulseSpeed&&m(272).npcSpeed>m(318).npcSpeed&&m(272).turnRate>m(318).turnRate);
  test('Defiant is faster and more agile than Dderidex; the warbird carries far more protection and cargo',m(326).impulseSpeed>m(320).impulseSpeed&&m(326).turnRate>m(320).turnRate&&m(320).hull+m(320).shields>m(326).hull+m(326).shields&&m(320).cargo>m(326).cargo);
  test('upgraded Akira adds real fitted damage potential and preserves both quantum launchers',m(325).slots.reduce((t,x)=>t+x.reloadLimitedDps,0)>m(33).slots.reduce((t,x)=>t+x.reloadLimitedDps,0)&&m(325).slots.filter(x=>x.id===16).length===2);
  test('survey and support fits are not hidden assault loadouts',m(306).npcPrimary===14&&m(342).npcPrimary===null&&m(264).slots.some(x=>x.id===25));
  const summary=B.getShipPurchaseSummary(326);
  test('purchase details show the role, all three supplied slots and shields',summary.includes('armored combat escort')&&summary.includes('Starting fit')&&summary.includes('Dual Pulse')&&summary.includes('Empty')&&summary.includes('Shields'),summary);
  const dominated=[];
  const devices=ship=>new Set(ship.defaultWeaponSlots.filter(id=>id&&B.getWeapon(id).type==='Device'));
  const metrics=ship=>{
   const z=m(ship.id);
   return [ship.hull,ship.shields,ship.cargoCapacity,ship.mass,z.impulseSpeed,z.turnRate,ship.warpRange,ship.fuelCapacity,z.slots.reduce((sum,x)=>sum+x.reloadLimitedDps,0)];
  };
  for(const a of ships.filter(x=>x.shipyardEligible))for(const b of ships.filter(x=>x.shipyardEligible)){
   if(a.id===b.id||a.faction!==b.faction||a.availabilityRegion!==b.availabilityRegion||a.specialVendor!==b.specialVendor||b.cost>=a.cost||b.purchaseRequirements.factionStanding>a.purchaseRequirements.factionStanding)continue;
   if(![...devices(a)].every(id=>devices(b).has(id)))continue;
   if(metrics(a).every((value,i)=>metrics(b)[i]>=value))dominated.push({overpriced:a.id,cheaper:b.id});
  }
  test('no cheaper same-faction same-market hull dominates every measured capability and included device',dominated.length===0,dominated);
  // Measurements are under the same starting power distribution. They exclude energy
  // exhaustion, miss chance, range and devices; they are not measured combat DPS.
  return {checks,measurements,powerDistribution:s.power.dist};
 });
 results.push(...live.checks);
 const report=process.argv.indexOf('--report');
 if(report>=0)fs.writeFileSync(process.argv[report+1],JSON.stringify({version:manifest.version,measurementNote:'Real engine functions at the starting power distribution. Reload-limited damage potential excludes energy, accuracy, range and device effects. NPCs use only the first compatible combat weapon.',...live},null,2)+'\n');
 for(const r of results)console.log(`${r.ok?'PASS':'FAIL'} ${r.name}${r.ok?'':` ${JSON.stringify(r.detail)}`}`);
 if(errors.length)console.error('Page errors',errors);
 console.log(`${results.filter(x=>x.ok).length}/${results.length} full-roster balance checks passed`);
 if(errors.length||results.some(x=>!x.ok))process.exitCode=1;
}finally{if(browser)await browser.close();await new Promise(resolve=>server.close(resolve));}
