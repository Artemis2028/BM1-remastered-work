// Paid, local electronic interference. No global state, political classification or damage here.
import { fundSensors, migrateSensorDistribution } from './ship-sensors.mjs';
export const EW_MODULES = Object.freeze([
  null,
  Object.freeze({ id: 1, name: 'Compact noise jammer', price: 7500, tier: 'trusted', radius: 900, strength: .75, draw: 2.5 }),
  Object.freeze({ id: 2, name: 'Tactical noise jammer', price: 25000, tier: 'respected', radius: 1200, strength: 1.25, draw: 5 }),
  Object.freeze({ id: 3, name: 'Fleet support jammer', price: 60000, tier: 'strategic', radius: 1500, strength: 1.8, draw: 9 }),
]);
const finite = (n, fallback = 0) => Number.isFinite(n) ? n : fallback;
const clamp = (n, a, b) => Math.max(a, Math.min(b, n));
export function sanitizeEW(raw = {}) {
  raw ||= {};
  return { version: 1, module: EW_MODULES[raw.module]?.id || null,
    jammerOrder: ['off','on','auto'].includes(raw.jammerOrder) ? raw.jammerOrder : 'off',
    eccmOrder: ['off','boost','auto'].includes(raw.eccmOrder) ? raw.eccmOrder : 'off',
    spinupRemaining: clamp(finite(raw.spinupRemaining, 1), 0, 1),
    cooldownRemaining: clamp(finite(raw.cooldownRemaining), 0, 2),
    owner: typeof raw.owner === 'string' ? raw.owner : null,
    operating: !!raw.operating && raw.spinupRemaining === 0,
    funded: 0, transmitting: false, strength: 0, radius: 0, boost: 0,
    autoJammer: false, autoEccm: false, decisionIn: 0 };
}
export function snapshotEW(e) {
  const { version, module, jammerOrder, eccmOrder, spinupRemaining, cooldownRemaining, owner, operating } = e;
  return { version, module, jammerOrder, eccmOrder, spinupRemaining, cooldownRemaining, owner, operating };
}
export function stopEW(e, forceOrder = false) {
  if (e.transmitting || e.operating || e.spinupRemaining < 1) e.cooldownRemaining = 2;
  e.spinupRemaining = 1; e.operating = false; e.transmitting = false;
  e.strength = 0; e.radius = 0;
  if (forceOrder) { e.jammerOrder = 'off'; e.autoJammer = false; }
}
export function rollEW({seed, role, faction, major = false, command = false}) {
  if(command || role !== 'patrol' || !(faction === 'pirate' || major)) return sanitizeEW();
  let h=2166136261; for(const c of `${seed}:${role}:ew`) { h ^= c.charCodeAt(0); h=Math.imul(h,16777619); }
  return sanitizeEW((h>>>0)/4294967296 < .2 ? {module:faction==='pirate'?1:2,jammerOrder:'auto',eccmOrder:'auto'} : {});
}
export function manageEW(e, power, crew, dt, input = {}) {
  e.decisionIn = Math.max(0, e.decisionIn-dt);
  if(e.decisionIn>0)return;
  const skill=crew.crewSkill||'regular';
  const reaction={inexperienced:3,regular:1.6,veteran:.8,elite:.35}[skill]||1.6;
  e.decisionIn=reaction;
  const interference=input.externalNoise>.15;
  e.autoEccm=interference && (!power.recovering || skill==='inexperienced');
  e.autoJammer=!!input.combat && !power.recovering;
  if(skill==='inexperienced') e.autoJammer=!!input.combat || (e.autoJammer && power.energy>0);
  if(['veteran','elite'].includes(skill)) {
    const reserve=(power.reserveFraction||.22)*(input.capacity||1);
    const forecast=(power.forecastSeconds||1)*(input.proposedDraw||0);
    if(power.energy < reserve+forecast || (interference && input.searching)) e.autoJammer=false;
  }
}
// Called after essential loads. Recover only the current step's measured overflow,
// fund all electronics proportionally, and clamp capacity once after that demand.
export function fundElectronics(power, sensors, profile, ew, dt, input={}) {
  dt=clamp(finite(dt),0,1);if(!dt)return;
  const s=migrateSensorDistribution(power.dist).sensors, a=s>0?.5+.1*s:0;
  const transmitTime=Math.max(0,dt-ew.cooldownRemaining);
  ew.cooldownRemaining=Math.max(0,ew.cooldownRemaining-dt);
  if(input.blocked)stopEW(ew,true);
  const model=EW_MODULES[ew.module];
  const requested=ew.jammerOrder==='on'||ew.jammerOrder==='auto'&&ew.autoJammer;
  if(!requested||!model||!a)stopEW(ew);
  const canTransmit=!!(requested&&model&&a&&!input.blocked&&ew.cooldownRemaining<=0&&transmitTime>0);
  const boost=(ew.eccmOrder==='boost'||ew.eccmOrder==='auto'&&ew.autoEccm)&&a>0;
  const sensorDraw=s>0?profile.draw*s/5*(sensors.mode!=='passive'&&!input.cloaked?4:1):0;
  const jammerDraw=canTransmit?model.draw*a*(input.nativeEfficiency||1)*transmitTime/dt:0;
  const boostDraw=boost?2*a*profile.draw:0;
  const total=(sensorDraw+jammerDraw+boostDraw)*dt;
  const available=Math.max(0,power.energy)+(power.telemetry?.spilled||0)*dt;
  const f=total>0?Math.min(1,available/total):0;
  power.energy=sensorDraw*dt*f;
  fundSensors(power,sensors,profile,dt,!!input.cloaked);
  const remaining=Math.max(0,available-total*f);
  power.energy=Math.min(input.capacity||Infinity,remaining);
  ew.funded=f;ew.boost=boost?.6*f:0;ew.transmitting=canTransmit&&f>0;
  ew.radius=ew.transmitting?model.radius*Math.sqrt(a*f):0;
  if(!ew.operating)ew.spinupRemaining=f>=1-1e-9&&canTransmit?Math.max(0,ew.spinupRemaining-transmitTime):1;
  if(ew.operating&&f===0)stopEW(ew);
  if(canTransmit&&f>=1-1e-9&&ew.spinupRemaining<=1e-9)ew.operating=true;
  ew.strength=ew.operating&&ew.transmitting?model.strength*a*f:0;
  const extra=(jammerDraw+boostDraw)*f;
  power.telemetry={...power.telemetry,jammer:jammerDraw*f,eccm:boostDraw*f,
    electronics:(sensorDraw+jammerDraw+boostDraw)*f,
    consumption:(power.telemetry?.consumption||0)+extra,
    net:(power.telemetry?.net||0)-extra,
    spilled:Math.max(0,remaining-(input.capacity||Infinity))/dt};
}
export const CLEAR_RECEPTION = Object.freeze({
  noise: 0, quality: 1, externalNoise: 0,
  own: Object.freeze([]), ownNoise: 0, selfNoise: 0
});
export function receiverEW(observer, emitters) {
  let squares=0,ownSquares=0,selfSquares=0; const own=[];
  for(const j of emitters){
    if(!(j.jammerStrength>0&&j.jammerRadius>0))continue;
    const d2=(observer.x-j.x)**2+(observer.y-j.y)**2;
    if(d2>=j.jammerRadius*j.jammerRadius)continue;
    let c=j.jammerStrength*(1-d2/(j.jammerRadius*j.jammerRadius))**2;
    if(j.key===observer.key){c*=.25;selfSquares+=c*c;}
    else if(j.side===observer.side){ownSquares+=c*c;own.push(j.key);}
    squares+=c*c;
  }
  const noise=Math.sqrt(squares), e=Math.max(0,observer.rejection||0);
  return {noise,quality:noise===0?1:e/(e+noise),externalNoise:Math.sqrt(Math.max(0,squares-selfSquares)),
    own,ownNoise:Math.sqrt(ownSquares),selfNoise:Math.sqrt(selfSquares)};
}
