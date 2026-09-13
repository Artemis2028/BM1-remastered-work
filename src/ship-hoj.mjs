// Private, sampled anti-emitter guidance. No entity references or global sensor writes.
export const HOJ_WEAPON_ID = 46;
export const HOJ_RULES = Object.freeze({ cadence: .2, memory: .4, reach: 2400, halfCone: 60 });
const delta = (from, to) => ((to - from + 540) % 360) - 180;
const bearing = (from, to) => Math.atan2(to.x - from.x, -(to.y - from.y)) * 180 / Math.PI;
export function createHojFlight({ key, system, x, y, aim, speed = 10, range = 1800, turnRate = 2.7 }) {
  return { guidance: 'home-on-jam', emitterKey: key, system, x, y, heading: bearing({ x, y }, aim),
    speed, turnRate, remaining: range, lifeRemaining: range / (speed * 60), elapsed: 0, sampleDue: 0,
    signal: null, signalAt: -Infinity, steering: false, dead: false };
}
const segment = { from: { x: 0, y: 0 }, to: { x: 0, y: 0 } };
// Single sample entry: advances sampleDue so a later stepHojFlight will not re-read.
export function sampleHojIfDue(shot, readSignal) {
  if (!shot || shot.dead || shot.elapsed + 1e-8 < shot.sampleDue) return false;
  const signal = readSignal(shot.emitterKey);
  const accepted = signal?.key === shot.emitterKey && signal.system === shot.system && signal.emitting
    && Math.hypot(signal.x - shot.x, signal.y - shot.y) <= HOJ_RULES.reach
    && Math.abs(delta(shot.heading, bearing(shot, signal))) <= HOJ_RULES.halfCone;
  if (accepted) {
    if (!shot.signal) shot.signal = { x: 0, y: 0 };
    shot.signal.x = signal.x; shot.signal.y = signal.y;
  } else shot.signal = null;
  shot.signalAt = shot.elapsed;
  shot.sampleDue = shot.elapsed + HOJ_RULES.cadence;
  return true;
}
export function stepHojFlight(shot, dt, readSignal) {
  segment.from.x = shot.x; segment.from.y = shot.y;
  if (shot.dead) { segment.to.x = shot.x; segment.to.y = shot.y; return segment; }
  const seconds = Math.max(0, Math.min(dt, shot.lifeRemaining, shot.remaining / (shot.speed * 60)));
  sampleHojIfDue(shot, readSignal);
  shot.steering = !!shot.signal && shot.elapsed - shot.signalAt <= HOJ_RULES.memory;
  if (shot.steering) {
    const turn = shot.turnRate * seconds * 60;
    shot.heading += Math.max(-turn, Math.min(turn, delta(shot.heading, bearing(shot, shot.signal))));
  }
  const radians = shot.heading * Math.PI / 180, distance = seconds * shot.speed * 60;
  shot.vx = Math.sin(radians) * shot.speed;
  shot.vy = -Math.cos(radians) * shot.speed;
  shot.x += Math.sin(radians) * distance;
  shot.y -= Math.cos(radians) * distance;
  shot.remaining -= distance;
  shot.lifeRemaining -= seconds;
  shot.elapsed += seconds;
  if (shot.remaining <= 1e-7 || shot.lifeRemaining <= 1e-7) shot.dead = true;
  segment.to.x = shot.x; segment.to.y = shot.y;
  return segment;
}
