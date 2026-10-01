// Ship-dependent strategic speed (SHIP-DEPENDENT-STRATEGIC-SPEED). One model, read by every journey and
// every planner: a leg's chart length (its base days, the same for every ship) divided by the strategic
// speed of whoever is actually flying it, rounded to whole campaign days, never below one day. A fixed
// traversal (a wormhole) keeps its fixed days whatever the ship.
//
//   legDays = fixed ? fixedDays : max(1, round(baseDays / speed))
//
// A ship's strategic speed is the explicit `strategicSpeed` of its class (bm-ships/ships.json), clamped to
// [SPEED_MIN, SPEED_MAX]; a class without one (a legacy record, a save from before this round, an unknown
// id) flies at SPEED_DEFAULT = 1.0, which is exactly the old ship-independent timing. A group flies at its
// slowest member able to travel; a member that cannot travel (disabled, surrendered, awaiting crew) is not
// a member of the moving group at all and contributes nothing.
//
// Nothing here reads a world, a book or the engine.

export const SPEED_DEFAULT = 1.0;
export const SPEED_MIN = 0.6;
export const SPEED_MAX = 1.5;

export function clampSpeed(v) {
  const n = Number(v);
  if (!Number.isFinite(n) || n <= 0) return SPEED_DEFAULT;
  return Math.min(SPEED_MAX, Math.max(SPEED_MIN, Math.round(n * 100) / 100));
}
// The class's strategic speed from its stats record (a catalogue entry, or a world.shipStats() result).
export function classSpeed(stats) {
  if (!stats) return SPEED_DEFAULT;
  return stats.strategicSpeed == null ? SPEED_DEFAULT : clampSpeed(stats.strategicSpeed);
}
// The group's speed: its slowest member. An empty group (nobody able to travel) has no speed.
export function groupSpeed(speeds) {
  const list = (speeds || []).map(clampSpeed);
  return list.length ? Math.min(...list) : null;
}
// One leg's days at `speed`. base: the chart's days for the hop at speed 1.0 (an integer ≥ 1).
export function adjustLegDays(baseDays, speed = SPEED_DEFAULT, fixed = false) {
  const base = Math.max(1, Math.round(Number(baseDays) || 1));
  if (fixed) return base;
  const s = speed == null ? SPEED_DEFAULT : clampSpeed(speed);
  return Math.max(1, Math.round(base / s));
}
// A whole route's legs. legBase: [{ days, fixed }].
export function legDaysAt(legBase, speed) {
  return (legBase || []).map((l) => adjustLegDays(l.days, speed, Boolean(l.fixed)));
}
// Player-facing: "1.2×".
export function speedLabel(speed) {
  const s = speed == null ? SPEED_DEFAULT : clampSpeed(speed);
  return `${s.toFixed(s * 10 === Math.round(s * 10) ? 1 : 2)}×`;
}

// ---- the authored class table (how bm-ships/ships.json's values were assigned; scripts/assign-strategic-speed.mjs) ----
// Conservative and bounded (0.8–1.3): meaningful differences, no extremes. The category comes from the
// class's own authored data — its shipClass and its role — never from tactical speed, mass or power.
export const CATEGORY_SPEED = Object.freeze({
  scout: 1.3,        // couriers, scouts, fighters, fast runabouts
  shuttle: 1.15,     // ordinary shuttles and small utility craft
  cargoShuttle: 1.0, // cargo shuttles, passenger shuttles, sail transports
  escort: 1.2,       // light escorts, frigates, raiders
  lightCruiser: 1.1,
  fastCruiser: 1.2,  // classes authored as fast ("fast", "strike", "quantum-drive", Bird of Prey)
  cruiser: 1.0,
  freighter: 0.8,    // freighters, haulers, transports, tugs, logistics and cargo frames: the slowest at warp
  capital: 0.9,
  battleship: 0.85,  // battleships and supercapitals: heavy, but built to keep station with a fleet
});
const has = (role, ...words) => words.some((w) => role.includes(w));
export function speedCategory(ship) {
  const cls = String(ship?.shipClass || '');
  const role = String(ship?.role || '').toLowerCase();
  if (cls === 'battleship') return 'battleship';
  if (cls === 'capital') return 'capital';
  const freight = has(role, 'freighter', 'hauler', 'cargo', 'transport', 'tug', 'logistics', 'liner');
  const fast = has(role, 'fast', 'strike', 'quantum-drive', 'bird of prey', 'courier', 'interceptor', 'raider', 'attack ship', 'fighter');
  if (cls === 'shuttle') {
    if (has(role, 'scout', 'courier', 'fighter', 'fast', 'patrol craft', 'runabout', 'bird of prey')) return 'scout';
    if (freight || has(role, 'passenger', 'sail')) return 'cargoShuttle';
    return 'shuttle';
  }
  // A freight word makes a freighter, unless the role says the frame is fast (a "fast frontier freighter", a
  // "courier transport") or it is a survey ship carrying logistics (the Nebula). A "quantum-drive freighter"
  // (the Tarellian hauler) stays a bulk freighter: the drive is its tactical trait, not a fast warp frame.
  if (freight && !has(role, 'fast', 'courier', 'survey')) return 'freighter';
  if (cls === 'escort') return 'escort';
  if (fast) return 'fastCruiser';
  if (cls === 'lightCruiser') return 'lightCruiser';
  return 'cruiser';
}
export function authoredSpeed(ship) { return CATEGORY_SPEED[speedCategory(ship)] ?? SPEED_DEFAULT; }
