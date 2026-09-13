#!/usr/bin/env node
// Real browser engine acceptance: the module is injected for inspection only, not replaced.
import fs from 'node:fs';
import path from 'node:path';
import http from 'node:http';
import {fileURLToPath} from 'node:url';
import {chromium} from 'playwright';
const root=path.resolve(fileURLToPath(new URL('../',import.meta.url)));
const shim=`window.__power={state,keys,startWithFaction,applyCurrentShipStats,applyShipDefaultWeapons,
 getShipStats,getWeapon,getOriginalShipWeaponSlots,getDefaultWeaponId,getWeaponEnergyCost,
 getScaledWeaponCooldown,getActorPowerProfile,ensurePlayerPower,ensureNpcPower,getPowerMaxEnergy,getScaledWeaponDamage,
 getPowerEnginesFactor,setPowerDist,advanceActorPower,updatePowerSystems,updateShieldRegeneration,
 firePlayerWeapon,fireNpcWeapon,createNpcShip,ensureNpcCombatStats,playerWorldPosition,tick,
 getSystemIndexByName,applySystemState,saveGame,loadGame,getSaveSlotKey,captureShipPowerState,
 getPlayerEscortNpcShips,getPlayerFleetNpcShips,beginAmbientTrafficArrival,renderPowerPanel,renderTopLeftPanel,
 setPlayerCloak,loadWeaponSlot,normalizeWeaponLoadout,transferSystemControlToFaction,
 sanitizeSecurityEncountersRecord,render,
 freeze:()=>new Promise(resolve=>{const t=setTimeout(()=>resolve(false),3000);requestAnimationFrame=cb=>{if(cb.name==='loop'){clearTimeout(t);resolve(true);}return 0;};})};`;
const mime={'.html':'text/html','.js':'text/javascript','.mjs':'text/javascript','.json':'application/json','.css':'text/css','.png':'image/png','.gif':'image/gif','.webp':'image/webp'};
const server=http.createServer((req,res)=>{
 const rel=decodeURIComponent((req.url||'/').split('?')[0]).replace(/^\/+/, '')||'index.html';
 const file=path.resolve(root,rel);
 if(!file.startsWith(root+path.sep)||!fs.existsSync(file)||fs.statSync(file).isDirectory()){res.writeHead(404);res.end();return;}
 res.setHeader('Content-Type',mime[path.extname(file)]||'application/octet-stream');res.setHeader('Cache-Control','no-store');
 if(rel==='src/main.js')res.end(fs.readFileSync(file,'utf8')+shim);else fs.createReadStream(file).pipe(res);
});
await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
let browser;
try{
 browser=await chromium.launch();const page=await browser.newPage({viewport:{width:1280,height:850}}),errors=[];
 page.on('pageerror',e=>errors.push(e.message));
 await page.goto(`http://127.0.0.1:${server.address().port}/`);
 await page.waitForFunction(()=>window.__power?.state.shipCatalog&&window.__power.state.planets.length>10);
 const result=await page.evaluate(async()=>{
  const B=window.__power,s=B.state,checks=[];
  const test=(name,ok,detail)=>checks.push({name,ok:!!ok,...(!ok?{detail}: {})});
  const near=(a,b)=>Math.abs(a-b)<1e-6;
  B.startWithFaction('ferengi');test('main loop freezes for deterministic engine scenarios',await B.freeze());
  const home=s.currentPlanet,other=B.getSystemIndexByName('Vulcan');
  s.npcShips=[];s.projectiles=[];s.activeFleetAttack=null;s.nextFleetAttackAt=1e12;s.spawnProtectionUntil=0;s.docked=false;
  s.playership=326;B.applyCurrentShipStats(true);B.applyShipDefaultWeapons(326,false);s.power.dist={reserve:5,engines:5,weapons:5,shields:5};
  const mapped=Object.values(s.shipStatsById).filter(x=>x.assetType==='ship'&&x.rosterState==='active');
  test('every authored hull power profile reaches the actual engine',mapped.length===172&&mapped.every(ship=>{const profile=B.getActorPowerProfile({shipId:ship.id});return profile.reactorOutput===ship.powerProfile.reactorOutput&&profile.energyCapacity===ship.powerProfile.energyCapacity;}));
  const at=B.playerWorldPosition();
  const mk=(id,opts={})=>{const n=B.createNpcShip({id,shipId:326,faction:'pirate',role:'patrol',seed:15,from:{x:at.x+200,y:at.y},...opts});B.ensureNpcCombatStats(n);B.ensureNpcPower(n);n.lastShotAt=-1e9;return n;};
  const n=mk('power-equal');const weapon=B.getWeapon(B.getDefaultWeaponId(326,'pirate',true));
  test('player and NPC on identical hull/fit/allocations pay the same weapon cost',near(B.getWeaponEnergyCost(weapon),B.getWeaponEnergyCost(weapon,n)));
  const damageBefore=B.getScaledWeaponDamage(n.shipId,weapon,null,1,n);s.power.dist={reserve:0,engines:0,weapons:10,shields:10};
  test('player allocation cannot leak into an NPC flying the same hull',near(damageBefore,B.getScaledWeaponDamage(n.shipId,weapon,null,1,n)));
  s.power.dist={reserve:5,engines:5,weapons:5,shields:5};
  const normalCooldown=B.getScaledWeaponCooldown(326,weapon);
  const normalDamage=B.getScaledWeaponDamage(326,weapon);
  const normalCost=B.getWeaponEnergyCost(weapon);
  s.power.dist={reserve:0,engines:5,weapons:10,shields:5};
  test('weapon allocation increases actual player damage and shot cost without changing recharge',B.getScaledWeaponDamage(326,weapon)>normalDamage&&B.getWeaponEnergyCost(weapon)>normalCost&&B.getScaledWeaponCooldown(326,weapon)===normalCooldown);
  const npcDamage=B.getScaledWeaponDamage(326,weapon,null,1,n),npcCost=B.getWeaponEnergyCost(weapon,n);
  n.power.dist={...s.power.dist};
  test('NPC weapon allocation increases its own damage and shot cost',B.getScaledWeaponDamage(326,weapon,null,1,n)>npcDamage&&B.getWeaponEnergyCost(weapon,n)>npcCost);
  s.power.dist={reserve:5,engines:5,weapons:5,shields:5};n.power.dist={...s.power.dist};
  n.power.energy=0;B.fireNpcWeapon(n,at,'player',performance.now());
  test('depleted NPC emits no shot, cooldown or aggression evidence',n.lastShotAt===-1e9&&!n.lastAggressionAt&&s.projectiles.length===0);
  n.power.energy=100;const cost=B.getWeaponEnergyCost(weapon,n);B.fireNpcWeapon(n,at,'player',performance.now());
  test('successful NPC shot debits exactly once and records attribution',near(n.power.energy,100-cost)&&n.lastAggressionTargetSide==='player'&&n.lastShotAt>0);
  s.npcShips=[n];s.projectiles=[];s.combatTargetId=n.id;s.combatTargetType='ship';s.autoTarget=false;
  s.weaponLastFiredAt=[-1e9,-1e9,-1e9];s.power.energy=0;B.firePlayerWeapon(1);
  test('depleted player emits no shot and does not spend cooldown',s.weaponLastFiredAt[0]===-1e9&&s.projectiles.length===0);
  // Devices use the same atomic success gate.
  s.weaponSlots=[23,26,25];s.weaponInventory=[23,26,25];s.weaponLastFiredAt=[-1e9,-1e9,-1e9];const shotAt=s.lastPlayerShotAt;
  B.firePlayerWeapon(1);B.firePlayerWeapon(2);
  test('failed disruptive device activations do not spend cooldown or create player attack evidence',s.weaponLastFiredAt[0]===-1e9&&s.weaponLastFiredAt[1]===-1e9&&s.lastPlayerShotAt===shotAt);
  B.applyShipDefaultWeapons(326,false);
  n.combatShields=n.maxCombatShields*.5;s.shields=50;n.lastShieldHitAt=s.lastShieldHitAt=0;
  n.power.energy=s.power.energy=70;n.power.dist={reserve:5,engines:5,weapons:5,shields:5};n.power.decisionIn=3;
  n.destination={x:n.x,y:n.y};s.ship.velocity=0;s.docked=true;s.power.dist={reserve:5,engines:5,weapons:5,shields:5};
  B.advanceActorPower(null,30,100000);B.advanceActorPower(n,30,100000);
  test('equal ships recover the same shield percentage for the same energy despite legacy durability units',near(s.shields/100,n.combatShields/n.maxCombatShields)&&near(s.power.energy,n.power.energy),{player:s.shields,npc:n.combatShields/n.maxCombatShields,energy:[s.power.energy,n.power.energy]});
  const playerShields=s.shields,npcShields=n.combatShields;B.updateShieldRegeneration(60);
  test('legacy regeneration path does not refill ship shields a second time',s.shields===playerShields&&n.combatShields===npcShields);
  // Core installation is passive, occupies a real slot, and does not stack or refill reserves.
  const profile=B.getActorPowerProfile();s.power.energy=13;s.weaponInventory=[31,31,9];s.weaponSlots=[31,31,9];B.normalizeWeaponLoadout();
  const doubled=B.getActorPowerProfile();B.firePlayerWeapon(1);
  test('two fitted secondary cores double output once, never capacity or stored energy',near(doubled.reactorOutput,profile.reactorOutput*2)&&near(doubled.energyCapacity,profile.energyCapacity)&&s.power.energy===13);
  s.weaponSlots=[9,null,null];test('removing core removes output bonus immediately',near(B.getActorPowerProfile().reactorOutput,profile.reactorOutput));
  // Even a high reactor cannot sustain an unpaid cloak: force a valid huge step demand via empty pool.
  s.playership=350;B.applyCurrentShipStats(true);s.weaponSlots=[22,null,null];s.weaponInventory=[22];s.power.energy=0;B.setPlayerCloak(true,performance.now());B.advanceActorPower(null,1,performance.now());
  test('insufficient continuous power disengages the real player cloak',!s.cloak.active);
  // Player engine allocation must survive the actual flight tick.
  s.playership=326;B.applyCurrentShipStats(true);B.applyShipDefaultWeapons(326,false);s.docked=false;s.npcShips=[];s.stations=[];s.ship.velocity=0;B.keys.add('w');
  s.power.dist={reserve:10,engines:0,weapons:5,shields:5};B.tick(1);const stopped=s.ship.velocity;
  s.power.dist={reserve:5,engines:5,weapons:5,shields:5};B.tick(1);B.keys.clear();
  test('real flight tick respects engine allocation and accelerates only with supplied propulsion',stopped===0&&s.ship.velocity>0);
  // Sustained identical fights: actual fireNpcWeapon and power updates, four profiles.
  const encounters={};const target={id:'power-dummy',shipId:347,combatHull:1e9,maxCombatHull:1e9,combatShields:1e9,maxCombatShields:1e9,x:at.x+400,y:at.y,faction:'neutral'};
  for(const skill of ['inexperienced','regular','veteran','elite']){
    const fighter=mk(`crew-${skill}`,{shipId:55,crewSkill:skill,crewTemperament:'disciplined'});fighter.power.combat=true;fighter.combatShields=fighter.maxCombatShields*.15;fighter.lastShieldHitAt=0;
    let min=1,shots=0,low=0,recovered=false;
    for(let i=0;i<1800;i++){
      const now=100000+i*100;B.advanceActorPower(fighter,6,now);const before=fighter.lastShotAt;B.fireNpcWeapon(fighter,target,'ship',now);
      if(fighter.lastShotAt!==before)shots++;
      const ratio=fighter.power.energy/B.getActorPowerProfile(fighter).energyCapacity;min=Math.min(min,ratio);if(ratio<.1)low++;
      if(fighter.power.recovering)recovered=true;
    }
    encounters[skill]={min,shots,low,recovered};
  }
  test('all four crew profiles fight through the real weapon path',Object.values(encounters).every(x=>x.shots>0),encounters);
  test('veteran and elite crews preserve more reserve and spend less time near exhaustion than inexperienced crews',encounters.veteran.min>encounters.inexperienced.min&&encounters.elite.min>encounters.veteran.min&&encounters.inexperienced.low>encounters.elite.low,encounters);
  // Persistent fleets: travel and save must not grant fresh reserves or reroll skill.
  s.playerFleet=[{id:'power-fleet',shipId:326,faction:'terran',seed:415,assignment:'escort',name:'Power test escort',crewSkill:'elite',crewTemperament:'reckless',power:{energy:7,dist:{reserve:8,engines:4,weapons:4,shields:4}}}];
  s.npcShips=B.getPlayerEscortNpcShips();const escort=s.npcShips.find(x=>x.fleetId==='power-fleet');
  test('fleet creation restores energy and independently assigned skill/temperament',escort&&escort.power.energy===7&&escort.crewSkill==='elite'&&escort.crewTemperament==='reckless');
  const enter=i=>{s.currentPlanet=i;s.myplanet=i+1;B.applySystemState(i);};
  enter(other);let live=s.npcShips.find(x=>x.fleetId==='power-fleet');
  test('escort energy and crew survive system travel',live?.power.energy===7&&live.crewSkill==='elite');
  // Ordinary cached visitor keeps depleted power through return and new holder.
  const visitor=s.npcShips.find(x=>!x.fleetId&&!x.destroyed);visitor.power.energy=4;visitor.crewSkill='veteran';visitor.crewTemperament='cautious';const vid=visitor.id;
  enter(home);B.transferSystemControlToFaction(other,'romulan');enter(other);const again=s.npcShips.find(x=>x.id===vid);
  test('cached foreign ship keeps energy and crew across return and change of holder',again?.power.energy===4&&again.crewSkill==='veteran'&&again.crewTemperament==='cautious');
  // Slot reuse must not retain power or crew overrides from a different vessel.
  again.power.energy=1;again.crewSkill='bad-marker';again.crewTemperament='bad-marker';const seed=again.seed;B.beginAmbientTrafficArrival(again,performance.now());
  test('ambient replacement gets its own full initial power and valid crew, with a different seed',again.seed!==seed&&again.power.energy===B.getActorPowerProfile(again).energyCapacity&&again.crewSkill!=='bad-marker'&&again.crewTemperament!=='bad-marker');
  s.power.energy=9;s.power.dist={reserve:8,engines:4,weapons:4,shields:4};B.saveGame(7);
  live=s.npcShips.find(x=>x.fleetId==='power-fleet');live.power.energy=90;s.power.energy=90;
  B.loadGame(7);live=s.npcShips.find(x=>x.fleetId==='power-fleet');
  test('save/reload preserves player and fleet energy without stale live state overwriting the save',s.power.energy===9&&live?.power.energy===7&&live.crewSkill==='elite'&&live.crewTemperament==='reckless',{player:s.power.energy,escort:live?.power});
  // Active checkpoint participant sanitization carries the new fields.
  const saved=B.sanitizeSecurityEncountersRecord({version:1,systems:{[home]:{participants:{v999:{npcId:'p',shipId:326,seed:99,x:100,y:100,crewSkill:'elite',crewTemperament:'cautious',power:{energy:2,dist:{reserve:10,engines:3,weapons:3,shields:4}}}}}}});
  const snap=saved.systems[home].participants.v999;
  test('checkpoint snapshot sanitation preserves power and crew fields',snap.power.energy===2&&snap.crewSkill==='elite'&&snap.crewTemperament==='cautious');
  const html=B.renderPowerPanel();test('OPS displays generation, demand, reserves and recovery/drain label',html.includes('EU/s')&&html.includes('Reactor')&&html.includes('Draw')&&html.includes('Energy'));
  test('OPS has three functional sliders and a read-only unused-allocation count',!html.includes('data-power-tank="reserve"')&&(html.match(/data-power-tank=/g)||[]).length===3&&html.includes('data-power-unused'));
  s.power.dist={reserve:5,engines:5,weapons:5,shields:5};B.setPowerDist('engines',8);
  test('raising a system spends spare points before reducing other systems',s.power.dist.engines===8&&s.power.dist.weapons===5&&s.power.dist.shields===5&&B.renderPowerPanel().includes('Unused allocation: 2 points'));
  B.setPowerDist('weapons',10);
  test('a full allocation budget redistributes without exceeding twenty points',s.power.dist.weapons===10&&s.power.dist.engines+s.power.dist.weapons+s.power.dist.shields===20);
  B.setPowerDist('engines',0);B.setPowerDist('weapons',0);B.setPowerDist('shields',0);
  const zeroed=JSON.stringify(s.power.dist);B.setPowerDist('reserve',10);
  test('all twenty points can be unused and the removed reserve control cannot change allocation',B.renderPowerPanel().includes('Unused allocation: 20 points')&&JSON.stringify(s.power.dist)===zeroed);
  s.power.dist={reserve:5,engines:5,weapons:5,shields:5};
  s.topLeftPanelOpen=true;s.topLeftTab='power';s.power.energy=80;B.updatePowerSystems(1);B.renderTopLeftPanel();B.render();
  return {checks,encounters};
 });
 for(const r of result.checks)console.log(`${r.ok?'PASS':'FAIL'} ${r.name}${r.ok?'':' '+JSON.stringify(r.detail)}`);
 console.log(JSON.stringify({encounters:result.encounters}));
 console.log(`${result.checks.filter(x=>x.ok).length}/${result.checks.length} live power checks passed`);
 if(errors.length)console.log('Page errors: '+errors.join(' | '));
 const screenshot=process.argv.indexOf('--screenshot');if(screenshot>=0)await page.screenshot({path:process.argv[screenshot+1]});
 if(errors.length||result.checks.some(r=>!r.ok))process.exitCode=1;
}finally{if(browser)await browser.close();await new Promise(resolve=>server.close(resolve));}
