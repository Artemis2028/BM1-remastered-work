#!/usr/bin/env node
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { POWER_KEYS, CREW_SKILLS, normalizePowerDist, shipPowerProfile, ensurePowerState, powerWeaponFactor,
  powerEngineFactor, weaponPowerCost, spendPower, stepShipPower, assignPowerCrew, managePowerCrew, crewAllowsShot,
  powerSnapshot } from '../src/ship-power.mjs';
const results=[];
function check(name,fn){try{fn();results.push({name,ok:true});}catch(e){results.push({name,ok:false,error:e.stack});}}
const near=(a,b,eps=1e-7)=>assert(Math.abs(a-b)<eps,`${a} != ${b}`);
const roster=JSON.parse(fs.readFileSync(new URL('../bm-ships/ships.json',import.meta.url))).ships.filter(s=>s.rosterState==='active');
const baseline=shipPowerProfile({powerProfile:{reactorOutput:10,energyCapacity:200,engineDraw:4,shieldDraw:6,shieldRechargePct:1.25,cloakDraw:18}});
const fresh=()=>ensurePowerState(null,baseline);
check('all active hulls carry finite positive authored power values; generation is distinct from storage',()=>{
 assert.equal(roster.length,172);for(const s of roster) for(const k of ['reactorOutput','energyCapacity','engineDraw','shieldDraw','shieldRechargePct','cloakDraw'])assert(s.powerProfile[k]>0&&Number.isFinite(s.powerProfile[k]),`${s.id}:${k}`);
 const ex=roster.find(s=>s.id===347),co=roster.find(s=>s.id===60);assert(ex.powerProfile.reactorOutput>co.powerProfile.reactorOutput&&ex.powerProfile.energyCapacity<co.powerProfile.energyCapacity);
});
check('bad or over-budget allocations and malformed power are bounded without recharging zero',()=>{
 for(const raw of [{engines:Infinity,weapons:100},{sensors:0,engines:10,weapons:10,shields:10},null]){
 const d=normalizePowerDist(raw);assert(Object.values(d).reduce((a,b)=>a+b)<=20);assert(Object.values(d).every(n=>n>=0&&n<=10));}
 assert.equal(ensurePowerState({energy:0},baseline).energy,0);assert.equal(ensurePowerState({energy:-50},baseline).energy,0);
 assert.equal(ensurePowerState({energy:1e9},baseline).energy,200);
});
check('more system allocation improves damage, shield recovery or speed and increases energy demand',()=>{
 const dist=n=>({sensors:0,engines:n,weapons:0,shields:0});
 assert(powerEngineFactor(dist(10))>powerEngineFactor(dist(5)));
 near(powerWeaponFactor({sensors:0,engines:0,weapons:5,shields:0}),1);
 near(powerWeaponFactor({sensors:0,engines:0,weapons:10,shields:0}),1.4);
 const a=fresh(),b=fresh();a.energy=b.energy=100;
 a.dist={sensors:0,engines:0,weapons:0,shields:5};b.dist={...a.dist,shields:10};
 const input={shieldMissing:1,shieldReady:true};
 const normal=stepShipPower(a,baseline,1,input),boost=stepShipPower(b,baseline,1,input);
 near(boost.shieldFraction,normal.shieldFraction*2);assert(b.energy<a.energy);
});
check('idle regeneration conserves energy and caps reserves; reserve allocation does not multiply output',()=>{
 for(const reserve of [0,5,10]){const p=fresh();p.energy=20;p.dist={reserve,engines:0,weapons:0,shields:0};stepShipPower(p,baseline,1);near(p.energy,30);}
 const p=fresh();const result=stepShipPower(p,baseline,1);near(p.energy,200);near(p.telemetry.spilled,10);assert.equal(result.shieldFraction,0);
});
check('propulsion plus shield recovery uses the same budget and full shields draw nothing',()=>{
 const p=fresh();p.energy=30;const r=stepShipPower(p,baseline,1,{throttle:1,shieldMissing:.5,shieldReady:true});near(p.energy,30);near(r.shieldFraction,.0125);near(p.telemetry.consumption,10);
 const q=fresh();q.energy=30;stepShipPower(q,baseline,1,{throttle:1,shieldMissing:0,shieldReady:true});near(q.energy,36);
});
check('shield delay prevents recovery and its power cost',()=>{const p=fresh();p.energy=10;const r=stepShipPower(p,baseline,1,{shieldMissing:1,shieldReady:false});near(p.energy,20);near(r.shieldFraction,0);});
check('underpowered drives slow down; shield recovery sheds without producing unpaid shields',()=>{
 const p=fresh();p.energy=0;const r=stepShipPower(p,{...baseline,reactorOutput:1},1,{throttle:1,shieldMissing:1,shieldReady:true});near(p.engineSupply,.25);near(p.energy,0);near(r.shieldFraction,0);
});
check('low and high engine allocations affect both speed ceiling and real demand',()=>{
 const rates=[];for(const n of [0,3,5,10]){const p=fresh();p.dist={sensors:0,engines:n,weapons:0,shields:0};stepShipPower(p,baseline,1,{throttle:1});rates.push(p.telemetry.engines);}
 assert.deepEqual(rates,[0,1.44,4,6.760000000000001]);near(powerEngineFactor({engines:0}),0);near(powerEngineFactor({engines:10,sensors:0,shields:0,weapons:0}),1.3);
});
check('powered in-system warp costs more than normal cruise',()=>{const p=fresh();stepShipPower(p,baseline,1,{throttle:1,engineBoost:3});near(p.telemetry.engines,12);});
check('cloak must be sustained from the real budget and switches off if unaffordable',()=>{
 const p=fresh();p.energy=0;const r=stepShipPower(p,baseline,.1,{cloaked:true});assert(r.cloakFailed);near(p.telemetry.devices,0);
 p.energy=20;const t=stepShipPower(p,baseline,1,{cloaked:true});assert(!t.cloakFailed);near(p.energy,12);
});
check('identical fitted weapons have identical costs regardless of actor; shot debit is atomic',()=>{
 const w={name:'Type X Phaser',type:'Beam'},p=fresh();const c=weaponPowerCost(w,50,p.dist);near(c,10);p.energy=c-1;assert(!spendPower(p,c));near(p.energy,c-1);p.energy=c;assert(spendPower(p,c));near(p.energy,0);assert(!spendPower(p,-5));
});
check('weapons allocation changes output and cost together',()=>{assert(powerWeaponFactor({weapons:10,sensors:0,shields:0,engines:0})>powerWeaponFactor({weapons:1}));assert(weaponPowerCost({type:'Beam'},100,{weapons:10,sensors:0,shields:0,engines:0})>weaponPowerCost({type:'Beam'},100,{weapons:1}));});
check('secondary core doubles generation only; capacity and all energy costs stay fixed',()=>{const s=roster[0],a=shipPowerProfile(s),b=shipPowerProfile(s,true);near(b.reactorOutput,a.reactorOutput*2);near(a.energyCapacity,b.energyCapacity);near(a.engineDraw,b.engineDraw);});
check('one second and sixty small idle/continuous steps agree',()=>{const a=fresh(),b=fresh();a.energy=b.energy=30;const i={throttle:1,shieldMissing:1,shieldReady:true};stepShipPower(a,baseline,1,i);for(let j=0;j<60;j++)stepShipPower(b,baseline,1/60,i);near(a.energy,b.energy);});
check('exactly four skill levels; actor can explicitly retain skill independently of temperament',()=>{
 assert.deepEqual(Object.keys(CREW_SKILLS),['inexperienced','regular','veteran','elite']);assert.deepEqual(assignPowerCrew({seed:8,faction:'pirate',crewSkill:'elite',crewTemperament:'cautious'}),{crewSkill:'elite',crewTemperament:'cautious'});
});
check('seeded generation gives both pirate and government exceptions without per-frame rerolls',()=>{
 const counts={};for(const faction of ['pirate','terran']){counts[faction]={};for(let seed=0;seed<10000;seed++){const input={seed,faction,role:'patrol'},c=assignPowerCrew(input);assert.deepEqual(c,assignPowerCrew(input));counts[faction][c.crewSkill]=(counts[faction][c.crewSkill]||0)+1;}}
 for(const f of Object.values(counts))assert(Object.values(f).length===4);assert(counts.pirate.inexperienced>counts.terran.inexperienced*3);assert(counts.terran.veteran>counts.pirate.veteran*2);
});
check('same reserves cause a veteran to preserve energy while a novice keeps firing',()=>{
 const n=fresh(),v=fresh();n.energy=v.energy=38;const ctx={combat:true,shieldFraction:1};managePowerCrew(n,baseline,{crewSkill:'inexperienced',crewTemperament:'disciplined'},ctx,0);managePowerCrew(v,baseline,{crewSkill:'veteran',crewTemperament:'disciplined'},ctx,0);
 assert(crewAllowsShot(n,baseline,15));assert(!crewAllowsShot(v,baseline,15));assert(v.recovering);assert(!n.recovering);
});
check('skill changes reserve discipline, not the reactor or weapon cost',()=>{
 const rates=[];for(const crewSkill of Object.keys(CREW_SKILLS)){const p=fresh();p.energy=10;managePowerCrew(p,baseline,{crewSkill,crewTemperament:'disciplined'},{combat:true,shieldFraction:1},0);stepShipPower(p,baseline,.1);rates.push(p.telemetry.generation);}
 assert(rates.every(r=>r===10));
});
check('reckless elite and cautious novice remain independent combinations',()=>{
 const a=fresh(),b=fresh();const ctx={combat:true,shieldFraction:1};managePowerCrew(a,baseline,{crewSkill:'elite',crewTemperament:'reckless'},ctx,0);managePowerCrew(b,baseline,{crewSkill:'elite',crewTemperament:'cautious'},ctx,0);assert(a.reserveFraction<b.reserveFraction);
});
check('reaction latency and hysteresis avoid instantaneous repeated allocation changes',()=>{
 const p=fresh();managePowerCrew(p,baseline,{crewSkill:'regular'}, {combat:false,shieldFraction:1},0);p.energy=1;managePowerCrew(p,baseline,{crewSkill:'regular'},{combat:true,shieldFraction:.1},.1);assert(!p.recovering);managePowerCrew(p,baseline,{crewSkill:'regular'},{combat:true,shieldFraction:.1},2);assert(p.recovering);p.energy=40;managePowerCrew(p,baseline,{crewSkill:'regular'},{combat:true,shieldFraction:1},2);assert(p.recovering);p.energy=70;managePowerCrew(p,baseline,{crewSkill:'regular'},{combat:true,shieldFraction:1},2);assert(!p.recovering);
});
check('snapshot preserves depleted reserves, allocations and recovery with relative timers',()=>{
 const p=fresh();p.energy=3;p.recovering=true;p.decisionIn=.5;p.reserveFraction=.2;const q=ensurePowerState(JSON.parse(JSON.stringify(powerSnapshot(p))),baseline);near(q.energy,3);assert(q.recovering);near(q.decisionIn,.5);assert.deepEqual(q.dist,p.dist);
});
for(const r of results)console.log(`${r.ok?'PASS':'FAIL'} ${r.name}${r.ok?'':'\n'+r.error}`);
console.log(`${results.filter(r=>r.ok).length}/${results.length} power model checks passed`);
if(results.some(r=>!r.ok))process.exitCode=1;
