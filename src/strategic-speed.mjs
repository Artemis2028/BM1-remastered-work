// Ship-dependent strategic speed (SHIP-DEPENDENT-STRATEGIC-SPEED). One model, read by every journey and
// every planner: a leg's chart length (its base days, the same for every ship) divided by the strategic
// speed multiplier of whoever is actually flying it, rounded UP to whole campaign days, never below one day.
// A fixed traversal (a wormhole) keeps its fixed days whatever the ship.
//
//   legDays = fixed ? fixedDays : max(1, ceil(baseDays / multiplier))
//
// A class's strategic speed is a 1–10 rating of its sustained strategic cruise (not tactical impulse, not a
// warp factor, not size), from the approved BM1 Strategic Speed Rater, stored on the class in
// bm-ships/ships.json as `strategicSpeedRating` with its multiplier `strategicSpeed` (RATING_MULTIPLIER below),
// its confidence and its basis (scripts/assign-strategic-speed.mjs). A class without one (a legacy record, an
// unknown id) flies at SPEED_DEFAULT = 1.0 — a 5/10 — which is exactly the old ship-independent timing. A
// group flies at its slowest member able to travel; a member that cannot travel (disabled, surrendered,
// awaiting crew) is not a member of the moving group at all and contributes nothing.
//
// Nothing here reads a world, a book or the engine.

// The rater's rating → multiplier table (initial gameplay scaling; the assign script refuses to run if the
// rater's own table differs from this one).
export const RATING_MULTIPLIER = Object.freeze({
  1: 0.70, 1.5: 0.74, 2: 0.78, 2.5: 0.82, 3: 0.85, 3.5: 0.89, 4: 0.92, 4.5: 0.96,
  5: 1.00, 5.5: 1.04, 6: 1.08, 6.5: 1.12, 7: 1.16, 7.5: 1.20, 8: 1.24, 8.5: 1.28,
  9: 1.32, 9.5: 1.36, 10: 1.40,
});
// A rating → its multiplier: rounded to the nearest half step and held to 1–10; a non-number → 1.0 (5/10).
export function ratingMultiplier(rating) {
  const n = Number(rating);
  if (rating == null || rating === '' || !Number.isFinite(n)) return 1;
  const r = Math.min(10, Math.max(1, Math.round(n * 2) / 2));
  return RATING_MULTIPLIER[r] ?? 1;
}
// A multiplier → the rating it stands for (the nearest in the table), for display only.
export function multiplierRating(mult) {
  const m = Number(mult);
  if (!Number.isFinite(m)) return 5;
  let best = 5, d = Infinity;
  for (const [r, v] of Object.entries(RATING_MULTIPLIER)) { const e = Math.abs(v - m); if (e < d - 1e-9) { d = e; best = Number(r); } }
  return best;
}
export const SPEED_DEFAULT = 1.0;
export const SPEED_MIN = 0.6;       // a class's authored speed: never below this
export const SPEED_MAX = 1.5;
// A journey's speed may go lower than any class's: a group towing a disabled hull
// (TOWING-SALVAGE-RECOVERY §tow speed). Nothing else flies below SPEED_MIN.
export const JOURNEY_SPEED_MIN = 0.4;
export const TOW_PENALTY = 0.7;     // a tow flies at 70% of its towing group's multiplier
export const TOW_SPEED_MAX = 1.0;   // and never faster than the chart's own pace

export function clampSpeed(v) {
  const n = Number(v);
  if (!Number.isFinite(n) || n <= 0) return SPEED_DEFAULT;
  return Math.min(SPEED_MAX, Math.max(JOURNEY_SPEED_MIN, Math.round(n * 100) / 100));
}
// The class's strategic speed multiplier from its stats record (a catalogue entry, or a world.shipStats()
// result): the multiplier of its rating; a record carrying only a multiplier keeps it.
export function classSpeed(stats) {
  if (!stats) return SPEED_DEFAULT;
  if (stats.strategicSpeedRating != null) return Math.max(SPEED_MIN, clampSpeed(ratingMultiplier(stats.strategicSpeedRating)));
  return stats.strategicSpeed == null ? SPEED_DEFAULT : Math.max(SPEED_MIN, clampSpeed(stats.strategicSpeed));
}
// The class's rating (1–10): its own, else the rating its multiplier stands for, else 5.
export function classRating(stats) {
  if (stats?.strategicSpeedRating != null) return Math.round(Number(stats.strategicSpeedRating) * 2) / 2;
  return stats?.strategicSpeed != null ? multiplierRating(stats.strategicSpeed) : 5;
}
// A tow (TOWING-SALVAGE-RULES §5): the towing group's multiplier — its slowest able towing member, escorts
// included (they cannot hurry it) — times the tow penalty, bounded [JOURNEY_SPEED_MIN, TOW_SPEED_MAX].
//   towSpeed = clamp(towingGroupMultiplier × TOW_PENALTY, 0.4, 1.0)
// The casualty's own rating does not enter it: a disabled hull has no drive of its own; the tug carries it.
// (Before 03 Oct the casualty's rating capped it — min(group, casualty) — so a slow-rated wreck slowed a tow
// its drive took no part in: TOWING-SALVAGE-AUDIT A3.)
export function towSpeed(groupSpeedValue, penalty = TOW_PENALTY) {
  const g = groupSpeedValue == null ? SPEED_DEFAULT : Number(groupSpeedValue);
  const v = (Number.isFinite(g) ? g : SPEED_DEFAULT) * (Number(penalty) || TOW_PENALTY);
  return Math.min(TOW_SPEED_MAX, Math.max(JOURNEY_SPEED_MIN, Math.round(v * 100) / 100));
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
  // Rounded up (a part-day is a day), with a hair of tolerance so an exact quotient is not pushed a day over.
  return Math.max(1, Math.ceil(base / s - 1e-9));
}
// A whole route's legs. legBase: [{ days, fixed }].
export function legDaysAt(legBase, speed) {
  return (legBase || []).map((l) => adjustLegDays(l.days, speed, Boolean(l.fixed)));
}
// Player-facing: "1.28×".
export function speedLabel(speed) {
  const s = speed == null ? SPEED_DEFAULT : clampSpeed(speed);
  return `${s.toFixed(2)}×`;
}
// Player-facing: "8.5/10 · 1.28×" (a multiplier off the table, such as a tow's, shows only as "0.84×").
export function ratingLabel(speed) {
  const s = speed == null ? SPEED_DEFAULT : clampSpeed(speed);
  const r = multiplierRating(s);
  return Math.abs(RATING_MULTIPLIER[r] - s) < 1e-9 ? `${r.toFixed(1)}/10 · ${s.toFixed(2)}×` : `${s.toFixed(2)}×`;
}

// ---- the hull category (a class's broad kind, from its authored shipClass and role) ----
// No longer a source of speed (the rater's per-hull ratings are): it is still what other rules read — the
// recovery capacity a class is assigned, an inspection regime's hull categories, the captain's traffic class.
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
