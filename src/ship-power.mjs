import { migrateSensorDistribution } from './ship-sensors.mjs';
// Shared, deterministic ship power accounting. Units are game energy (EU), not watts.
// No owner, faction, target or crew-dependent discounts enter these functions.
export const POWER_KEYS = Object.freeze(['engines', 'weapons', 'shields', 'sensors']);
export const CREW_SKILLS = Object.freeze({
  inexperienced: Object.freeze({ reaction: 3.0, reserve: 0.01, recover: 0.10, forecast: 0 }),
  regular: Object.freeze({ reaction: 1.6, reserve: 0.12, recover: 0.30, forecast: 0.5 }),
  veteran: Object.freeze({ reaction: 0.8, reserve: 0.22, recover: 0.48, forecast: 1.5 }),
  elite: Object.freeze({ reaction: 0.35, reserve: 0.30, recover: 0.60, forecast: 2.5 }),
});
export const CREW_TEMPERAMENTS = Object.freeze({
  reckless: -0.10, disciplined: 0, cautious: 0.10, desperate: -0.18,
});
const finite = (v, fallback) => typeof v === 'number' && Number.isFinite(v) ? v : fallback;
const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
export function normalizePowerDist(raw = {}) { return migrateSensorDistribution(raw); }
export function shipPowerProfile(stats = {}, secondaryCore = false) {
  const authored = stats.powerProfile || {};
  const mass = clamp(finite(stats.mass, 1), 1, 20);
  const get = (key, fallback, min, max) => clamp(finite(authored[key], fallback), min, max);
  return {
    reactorOutput: get('reactorOutput', 6 + mass, 1, 200) * (secondaryCore ? 2 : 1),
    energyCapacity: get('energyCapacity', 100 + mass * 25, 30, 5000),
    engineDraw: get('engineDraw', 1 + mass * 0.3, 0.1, 100),
    shieldDraw: get('shieldDraw', 2 + mass * 0.4, 0.1, 100),
    shieldRechargePct: get('shieldRechargePct', 1.25, 0.1, 5),
    cloakDraw: get('cloakDraw', 6 + mass * 0.6, 1, 200),
  };
}
export function ensurePowerState(raw, profile) {
  const p = raw && typeof raw === 'object' && !Array.isArray(raw) ? raw : {};
  p.energy = clamp(finite(p.energy, profile.energyCapacity), 0, profile.energyCapacity);
  p.dist = normalizePowerDist(p.dist);
  p.engineSupply = clamp(finite(p.engineSupply, p.energy > 0 ? 1 : 0), 0, 1);
  p.recovering = Boolean(p.recovering);
  p.decisionIn = clamp(finite(p.decisionIn, 0), 0, 3);
  return p;
}
export function powerWeaponFactor(dist) { return 0.6 + 0.08 * normalizePowerDist(dist).weapons; }
export function powerEngineFactor(dist) { const n = normalizePowerDist(dist).engines; return n <= 5 ? n / 5 : 1 + (n - 5) * 0.06; }
export function weaponPowerCost(weapon, baseHullDamage, dist) {
  if (weapon?.passiveEffect === 'secondary-reactor') return 0;
  const name = String(weapon?.name || '').toLowerCase();
  if (name.includes('cloak')) return 25;
  if (name.includes('thaleron')) return 30;
  if (name.includes('engine disruptor')) return 18;
  if (name.includes('tractor')) return 12;
  if (String(weapon?.type).toLowerCase() === 'device') return 15;
  return Math.max(3, Math.round(Math.max(0, finite(baseHullDamage, 0)) * powerWeaponFactor(dist) / 5));
}
export function spendPower(p, cost) {
  if (!Number.isFinite(cost) || cost < 0 || p.energy + 1e-9 < cost) return false;
  p.energy = Math.max(0, p.energy - cost);
  p.shotEnergy = finite(p.shotEnergy, 0) + cost;
  return true;
}
// Runs once per simulation step. Reactor output is constant; the RESERVE allocation
// leaves points uncommitted, it does not conjure extra generation. Shed shield recovery
// before propulsion. A cloak that cannot be sustained switches off; no unpaid effect.
export function stepShipPower(p, profile, seconds, input = {}) {
  const dt = clamp(finite(seconds, 0), 0, 1);
  if (!dt) return { shieldFraction: 0, cloakFailed: false };
  const d = normalizePowerDist(p.dist);
  const generated = profile.reactorOutput * dt;
  let available = p.energy + generated;
  let deviceSpent = 0;
  let cloakFailed = false;
  if (input.cloaked) {
    const demand = profile.cloakDraw * dt;
    if (available + 1e-9 >= demand) { deviceSpent += demand; available -= demand; }
    else cloakFailed = true;
  }
  const throttle = clamp(finite(input.throttle, 0), 0, 1);
  const engineDemand = profile.engineDraw * throttle * clamp(finite(input.engineBoost, 1), 1, 4) * Math.pow(powerEngineFactor(d), 2) * dt;
  const engineSpent = Math.min(available, engineDemand);
  available -= engineSpent;
  p.engineSupply = engineDemand > 0 ? engineSpent / engineDemand : (available > 0 ? 1 : 0);
  const missing = clamp(finite(input.shieldMissing, 0), 0, 1);
  const requestedFraction = input.shieldReady ? Math.min(missing, profile.shieldRechargePct / 100 * d.shields / 5 * dt) : 0;
  const shieldDemand = requestedFraction / (profile.shieldRechargePct / 100) * profile.shieldDraw;
  const shieldSpent = Math.min(available, shieldDemand);
  available -= shieldSpent;
  const shieldFraction = shieldDemand > 0 ? requestedFraction * shieldSpent / shieldDemand : 0;
  const overflow = Math.max(0, available - profile.energyCapacity);
  p.energy = clamp(available, 0, profile.energyCapacity);
  const continuousDraw = (engineSpent + shieldSpent + deviceSpent) / dt;
  p.weaponDraw = finite(p.weaponDraw, 0) * Math.exp(-dt) + finite(p.shotEnergy, 0) * (1 - Math.exp(-dt)) / dt;
  p.shotEnergy = 0;
  p.telemetry = { generation: profile.reactorOutput, engines: engineSpent / dt, shields: shieldSpent / dt,
    devices: deviceSpent / dt, weapons: p.weaponDraw, consumption: continuousDraw + p.weaponDraw,
    net: profile.reactorOutput - continuousDraw - p.weaponDraw, spilled: overflow / dt };
  return { shieldFraction, cloakFailed };
}
function seededUnit(seed) {
  let h = 2166136261;
  for (const c of String(seed)) { h ^= c.charCodeAt(0); h = Math.imul(h, 16777619); }
  return (h >>> 0) / 4294967296;
}
export function assignPowerCrew({ seed, faction, role, crewSkill, crewTemperament } = {}) {
  const roll = seededUnit(`${seed}:power-skill`);
  const military = ['patrol','fleetAttack','occupationFleet','playerEscort','playerFleet'].includes(role);
  const weights = faction === 'pirate' ? [0.50,0.36,0.12,0.02]
    : military && faction && faction !== 'neutral' ? [0.08,0.52,0.35,0.05] : [0.30,0.55,0.14,0.01];
  let sum = 0;
  const skill = Object.keys(CREW_SKILLS).find((_, i) => (sum += weights[i]) > roll) || 'regular';
  const temperRoll = seededUnit(`${seed}:power-temperament`);
  const temperament = temperRoll < (faction === 'pirate' ? 0.55 : 0.15) ? 'reckless'
    : temperRoll > 0.80 ? 'cautious' : 'disciplined';
  return { crewSkill: Object.hasOwn(CREW_SKILLS, crewSkill) ? crewSkill : skill,
    crewTemperament: Object.hasOwn(CREW_TEMPERAMENTS, crewTemperament) ? crewTemperament : temperament };
}
// Only own reserves, own damage and an already-observed engagement enter AI planning.
// No target loadout, energy, concealed contact or faction standing is read here.
export function managePowerCrew(p, profile, crew, input, seconds) {
  p.decisionIn = Math.max(0, finite(p.decisionIn, 0) - Math.max(0, seconds));
  if (p.decisionIn > 0) return;
  const skill = CREW_SKILLS[crew.crewSkill] || CREW_SKILLS.regular;
  const risk = CREW_TEMPERAMENTS[crew.crewTemperament] ?? 0;
  const reserve = clamp(skill.reserve + risk, 0, 0.60);
  const recover = clamp(skill.recover + risk, reserve + 0.06, 0.85);
  const ratio = p.energy / profile.energyCapacity;
  if (p.recovering) p.recovering = ratio < recover;
  else p.recovering = ratio < reserve;
  p.reserveFraction = reserve;
  p.forecastSeconds = skill.forecast;
  p.decisionIn = skill.reaction;
  if (p.recovering) p.dist = { engines: 3, weapons: 1, shields: 3, sensors: 2 };
  else if (input.searching) p.dist = { engines: 5, weapons: 2, shields: 3, sensors: 8 };
  else if (!input.combat) p.dist = { engines: 5, weapons: 2, shields: 5, sensors: 5 };
  else if (input.shieldFraction < 0.30 && crew.crewSkill !== 'inexperienced') p.dist = { engines: 4, weapons: 4, shields: 9, sensors: 3 };
  else p.dist = { engines: 5, weapons: 7, shields: 5, sensors: 3 };
}
export function crewAllowsShot(p, profile, cost) {
  if (p.recovering) return false;
  const netDrain = Math.max(0, finite(p.telemetry?.consumption, 0) - profile.reactorOutput);
  return p.energy - cost >= profile.energyCapacity * finite(p.reserveFraction, 0) + netDrain * finite(p.forecastSeconds, 0);
}
export function powerSnapshot(p) {
  return { energy: p.energy, dist: { ...p.dist }, recovering: Boolean(p.recovering),
    decisionIn: finite(p.decisionIn, 0), reserveFraction: finite(p.reserveFraction, 0), forecastSeconds: finite(p.forecastSeconds, 0) };
}
