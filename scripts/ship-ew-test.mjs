import assert from 'node:assert/strict';
import {EW_MODULES,sanitizeEW,snapshotEW,stopEW,rollEW,manageEW,fundElectronics,receiverEW} from '../src/ship-ew.mjs';
import {sensorProfile,ensureSensorEquipment,SensorWorld,freshTrack} from '../src/ship-sensors.mjs';
import {stepShipPower,ensurePowerState,shipPowerProfile,managePowerCrew,crewAllowsShot,spendPower} from '../src/ship-power.mjs';
let count=0;const test=(name,f)=>{f();count++;console.log('PASS '+name);};
const near=(a,b,e=1e-7)=>assert.ok(Math.abs(a-b)<e,`${a} != ${b}`);
const obs={key:'a',side:'a',x:0,y:0,rejection:1};
const jam=(key='j',over={})=>({key,side:'b',x:300,y:0,jammerRadius:1500,jammerStrength:1.8,...over});
test('catalog uses existing 15/30/75 tiers and reviewed prices',()=>assert.deepEqual(EW_MODULES.slice(1).map(m=>[m.price,m.tier]),[[7500,'trusted'],[25000,'respected'],[60000,'strategic']]));
test('noise-free and zero receiver cases remain finite',()=>{assert.equal(receiverEW(obs,[]).quality,1);assert.equal(receiverEW({...obs,rejection:0},[jam()]).quality,0);});
test('single and stacked Fleet jammer figures, without old ceiling',()=>{for(const [n,q] of [[1,.376092],[3,.25817],[6,.19713]])near(receiverEW(obs,Array.from({length:n},(_,i)=>jam(String(i)))).quality,q,.001);});
test('fourth and subsequent emitter contribute; ordering does not change quality',()=>{const js=Array.from({length:6},(_,i)=>jam(String(i)));assert.ok(receiverEW(obs,js).quality<receiverEW(obs,js.slice(0,3)).quality);near(receiverEW(obs,js).quality,receiverEW(obs,js.reverse()).quality);});
test('friendly interference is real and attributable; cancellation is self only',()=>{const friend=jam('f',{side:'a'});const r=receiverEW(obs,[friend]);near(r.quality,receiverEW(obs,[jam()]).quality);assert.deepEqual(r.own,['f']);assert.ok(receiverEW(obs,[jam('a')]).quality>r.quality);});
test('edge and beyond have no interference',()=>{assert.equal(receiverEW(obs,[jam('j',{x:1500})]).noise,0);assert.equal(receiverEW(obs,[jam('j',{x:1600})]).quality,1);});
test('better ECCM recovers range; military platform burns through',()=>{near(1200*Math.sqrt(receiverEW({...obs,rejection:1.6},Array.from({length:3},(_,i)=>jam(String(i)))).quality),718,.6);near(1500*Math.sqrt(receiverEW({...obs,rejection:1.25},[jam()]).quality),983,1);});
function rig(over={}){const profile=shipPowerProfile({powerProfile:{reactorOutput:10,energyCapacity:200}});return {profile,p:ensurePowerState({energy:200,dist:{engines:0,weapons:0,shields:0,sensors:5}},profile),e:sanitizeEW({module:2,jammerOrder:'on',...over}),s:ensureSensorEquipment(),sp:sensorProfile()};}
function step(r,dt=.2,input={}){stepShipPower(r.p,r.profile,dt);fundElectronics(r.p,r.s,r.sp,r.e,dt,{capacity:200,nativeEfficiency:1,...input});}
test('spin-up spends energy and emits before interference',()=>{const r=rig();step(r);assert.ok(r.e.transmitting);assert.equal(r.e.strength,0);for(let i=0;i<5;i++)step(r);assert.ok(r.e.strength>0);});
test('all electronics receive the same fraction without order theft',()=>{const r=rig({eccmOrder:'boost'});r.p.energy=.8;r.p.telemetry={consumption:0,net:0,spilled:0};r.s.mode='focus';fundElectronics(r.p,r.s,r.sp,r.e,1,{capacity:200});near(r.e.funded,r.s.funded);near(r.p.energy,0);near(r.p.telemetry.electronics,.8);assert.equal(r.s.emitting,false);});
test('capacity overflow pays same-step electronics; no free generation',()=>{const r=rig();step(r,1);near(r.p.energy,200);near(r.p.telemetry.spilled,4);near(r.p.telemetry.electronics,6);});
test('frame subdivisions have equal energy and activation',()=>{const a=rig(),b=rig();a.p.energy=b.p.energy=50;step(a,1);for(let i=0;i<10;i++)step(b,.1);near(a.p.energy,b.p.energy);assert.equal(a.e.operating,b.e.operating);});
test('Off has two-second restart delay plus paid spin-up',()=>{const r=rig();step(r,1);r.e.jammerOrder='off';stopEW(r.e);assert.equal(r.e.strength,0);r.e.jammerOrder='on';step(r,1);assert.equal(r.e.transmitting,false);step(r,1);assert.equal(r.e.operating,false);step(r,1);assert.equal(r.e.operating,true);});
test('cloak/docking block forces Off, zero Sensors cannot transmit',()=>{for(const input of [{blocked:true},{cloaked:true,blocked:true}]){const r=rig();step(r,1,input);assert.equal(r.e.jammerOrder,'off');assert.equal(r.e.transmitting,false);}const r=rig();r.p.dist.sensors=0;step(r,1);assert.equal(r.e.transmitting,false);});
test('snapshot carries orders/timers but no paid live field',()=>{const r=rig();step(r,1);const s=snapshotEW(r.e);assert.equal(s.module,2);assert.equal(s.strength,undefined);assert.equal(sanitizeEW(s).strength,0);});
test('seeded equipment independent of faction skill; civilians and command start empty',()=>{assert.deepEqual(rollEW({seed:1,role:'traffic',faction:'pirate'}).module,null);assert.equal(rollEW({seed:1,role:'patrol',faction:'terran',major:true,command:true}).module,null);let n=0;for(let seed=0;seed<1000;seed++){const a=rollEW({seed,role:'patrol',faction:'pirate'});assert.deepEqual(a,rollEW({seed,role:'patrol',faction:'pirate'}));if(a.module)n++;}assert.ok(n>140&&n<260);});
test('four crew skills use power/recovery rather than hardware discounts',()=>{for(const crewSkill of ['inexperienced','regular','veteran','elite']){const r=rig({jammerOrder:'auto',eccmOrder:'auto'});manageEW(r.e,{energy:1,recovering:true}, {crewSkill},1,{combat:true,capacity:200,proposedDraw:8,externalNoise:1});assert.equal(r.e.autoJammer,crewSkill==='inexperienced');}});
test('jammed reacquisition completes after a prior local track is lost',()=>{const w=new SensorWorld();w.clear(0);const a={...obs,observer:true,visual:0,passive:1200,active:1800,signature:1},b={key:'b',side:'b',x:500,y:0,observer:false,signature:1};w.pass([a,b],1,1);assert.ok(freshTrack(w.contact('a','b'),1));b.x=1800;w.pass([a,b],1.2,.2);b.x=650;for(let t=1.4;t<5;t+=.2)w.pass([a,b,{...jam(),observer:false,signature:1}],t,.2);assert.ok(freshTrack(w.contact('a','b'),4.8));});
test('maximum interference preserves visual edges, checkpoint coverage and radio declarations',()=>{const w=new SensorWorld();w.clear(0);const a={...obs,observer:true,visual:600,coverage:1100,passive:1200,active:1800,signature:1,rejection:0};
const visual={key:'v',side:'b',x:620,y:0,radius:30,signature:1},checkpoint={key:'c',side:'b',x:1000,y:0,signature:1},radio={key:'r',side:'b',x:2200,y:0,signature:1,broadcast:true,declaration:'claimed-terran'};
w.pass([a,visual,checkpoint,radio,...Array.from({length:30},(_,i)=>({...jam(String(i)),signature:1}))],1,.2);
assert.equal(a.ewReception.quality,0);assert.ok(freshTrack(w.contact('a','v'),1));assert.ok(freshTrack(w.contact('a','c'),1));assert.equal(w.contact('a','r').declaration,'claimed-terran');assert.ok(!freshTrack(w.contact('a','r'),1));});
test('new jammer emission needs its own one-second acquisition even on a visually tracked hull',()=>{const w=new SensorWorld();w.clear(0);const a={...obs,observer:true,visual:600,passive:1200,active:1800,signature:1},b={...jam(),signature:1,jammerEmitting:false};
for(let i=0;i<10;i++)w.pass([a,b],i*.2,.2);b.jammerEmitting=true;w.pass([a,b],2,.2);assert.equal(w.contact('a','j').jammerAt,undefined);
for(let i=1;i<5;i++)w.pass([a,b],2+i*.2,.2);assert.ok(w.contact('a','j').jammerAt>=2.8-1e-8);});
test('identical paid hardware produces four distinct crew reserve traces',()=>{const traces={};for(const crewSkill of ['inexperienced','regular','veteran','elite']){
 const r=rig({module:3,jammerOrder:'auto',eccmOrder:'auto'}),crew={crewSkill,crewTemperament:'disciplined'},values=[];r.p.energy=100;
 for(let i=0;i<300;i++){managePowerCrew(r.p,r.profile,crew,{combat:true,shieldFraction:1},.2);manageEW(r.e,r.p,crew,.2,{combat:true,externalNoise:1,capacity:200,proposedDraw:13});if(i%5===0&&crewAllowsShot(r.p,r.profile,6))spendPower(r.p,6);step(r,.2);if(i%10===0)values.push(+r.p.energy.toFixed(2));}
 traces[crewSkill]=values;assert.ok(values.every(v=>v>=0&&v<=200));}
 assert.equal(new Set(Object.values(traces).map(v=>JSON.stringify(v))).size,4);assert.ok(Math.min(...traces.inexperienced)<Math.min(...traces.elite));
 console.log('crew-energy-traces '+JSON.stringify(traces));});
console.log(`${count}/${count} EW model checks passed`);
