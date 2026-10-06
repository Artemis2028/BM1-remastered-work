// HIROGEN HUNTING DOCTRINE (docs/doctrine/HIROGEN-HUNTING-DOCTRINE.md): the pure rules of a hunt. No state,
// no world: what a prey is worth to a hunter from what the hunter has seen, how likely a prey is to slip a
// hunter at contact, whether an intercept is feasible, and when a hunt is over. The campaign layer
// (doctrine-campaign.mjs) owns the records, the knowledge, the journeys and the encounters.

// A hunt's phases. A record moves forward through them; `searching` is pursuit after contact is lost.
export const HUNT_PHASES = Object.freeze(['evaluating', 'stalking', 'pursuing', 'searching', 'intercepting', 'engaged', 'disengaging', 'resolved']);

// Bounded defaults (the config's `hunt` block may override any of them per campaign).
export const HUNT_DEFAULTS = Object.freeze({
  // Desirability by force ratio (prey's observed strength ÷ the hunting group's): trivial below `trivialRatio`,
  // rising to the ideal band, best at parity, still attractive moderately stronger, rejected past `tooStrongRatio`.
  trivialRatio: 0.3, idealLow: 0.7, idealHigh: 1.5, tooStrongRatio: 2.5, recklessMaxRatio: 4,
  civilianFactor: 0.35,           // an unarmed hull is poor sport (it is still prey if nothing better is known)
  rareBonus: 0.1,                 // the only class of its kind among everything this power has seen
  escapedBonus: 0.2,              // it slipped one of this power's hunts before (only after that cooldown)
  minScore: 0.45,                 // below this, no hunt
  sourceConfidence: Object.freeze({ direct: 1, border: 0.85, crossing: 0.9, report: 0.7, contact: 1 }),
  // Knowledge: seen within `trackDays` is a live track; older is last-known; older than `staleDays` is useless.
  trackDays: 1, staleDays: 12,
  // Budgets, in campaign days: the whole hunt, the search after contact is lost, how far a hunt reaches.
  pursuitDays: 40, searchDays: 10, maxReachDays: 30, maxEngagements: 2,
  // Cooldowns before the same prey is hunted again by the same power.
  cooldownDays: 45, escapeCooldownDays: 60,
  // Hunters: a damaged hunter goes home; a hunt is a group of at most `groupMax` hulls; a power never commits
  // more than `committedShareMax` of its hunters, and runs at most `maxActive` hunts at once.
  repairThreshold: 0.5, readyThreshold: 0.7, groupMax: 2, committedShareMax: 0.67, maxActive: 1, evaluateEveryDays: 3,
  // Escape at contact: base, speed ratio weight, cloak bonus, bounds.
  escapeBase: 0.2, escapeSpeedWeight: 0.6, escapeCloakBonus: 0.15, escapeMin: 0.05, escapeMax: 0.85,
  // A strategic engagement's exchange: the share of max hull each side loses, scaled by the force ratio.
  strikeShare: 0.35, returnShare: 0.25,
});

const clamp = (x, a, b) => Math.max(a, Math.min(b, x));

// The chart the day budgets above are written for: a typical leg of this many days.
export const HUNT_REFERENCE_LEG_DAYS = 6;
const SCALED_KEYS = ['staleDays', 'pursuitDays', 'searchDays', 'maxReachDays', 'cooldownDays', 'escapeCooldownDays'];
// The same budgets on a chart whose typical leg is `scale` times longer (≥ 1): the same number of legs.
export function scaledHuntConfig(cfg, scale = 1) {
  const k = Math.max(1, Number(scale) || 1);
  if (k === 1) return cfg;
  const out = { ...cfg, scale: k };
  for (const key of SCALED_KEYS) out[key] = Math.round(Number(cfg[key]) * k);
  return out;
}

// Desirability by force ratio r = prey ÷ hunters. Returns { worth (0..1), band, rejected }.
export function worthCurve(r, cfg = HUNT_DEFAULTS, reckless = false) {
  const c = { ...HUNT_DEFAULTS, ...cfg };
  if (!Number.isFinite(r) || r <= 0) return { worth: 0, band: 'unknown', rejected: 'strength unknown' };
  if (r < c.trivialRatio) return { worth: 0.1 * (r / c.trivialRatio), band: 'trivial', rejected: null };
  if (r < c.idealLow) return { worth: 0.1 + 0.9 * ((r - c.trivialRatio) / (c.idealLow - c.trivialRatio)), band: 'lesser', rejected: null };
  if (r <= c.idealHigh) return { worth: 1, band: 'worthy', rejected: null };
  // A reckless doctrine stretches the falling side out to `recklessMaxRatio` (it still prefers parity).
  const top = reckless ? c.recklessMaxRatio : c.tooStrongRatio;
  if (r <= top) return { worth: 1 - 0.5 * ((r - c.idealHigh) / (top - c.idealHigh)), band: r <= c.tooStrongRatio ? 'dangerous' : 'reckless', rejected: null };
  return { worth: 0, band: 'overwhelming', rejected: 'too strong' };
}

// One candidate's score, every factor named. `c` = { preyStrength, hunterStrength, cls ('military'|'civilian'),
// source, ageDays, rare, escapedBefore, cooldownUntil, day, reachDays, duplicate, reckless }.
// Returns { score, ratio, worth, band, factors, verdict: 'eligible'|'rejected', reason }.
export function scorePrey(c, cfg = HUNT_DEFAULTS) {
  const k = { ...HUNT_DEFAULTS, ...cfg };
  const out = { score: 0, ratio: null, worth: 0, band: null, factors: {}, verdict: 'rejected', reason: null };
  const reject = (reason) => ({ ...out, reason });
  if (c.duplicate) return reject('already hunted');
  if (c.cooldownUntil != null && Number(c.day) <= Number(c.cooldownUntil)) return reject(`cooldown until day ${c.cooldownUntil}`);
  if (c.ageDays == null || c.ageDays > k.staleDays) return reject('knowledge stale');
  if (c.reachDays == null) return reject('no route');
  if (c.reachDays > k.maxReachDays) return reject(`beyond reach (${c.reachDays} days)`);
  const ratio = Number(c.preyStrength) / Math.max(1e-9, Number(c.hunterStrength));
  const w = worthCurve(ratio, k, Boolean(c.reckless));
  out.ratio = Math.round(ratio * 100) / 100; out.worth = Math.round(w.worth * 100) / 100; out.band = w.band;
  if (w.rejected) return reject(w.rejected);
  const cls = c.cls === 'civilian' ? k.civilianFactor : 1;
  const conf = (k.sourceConfidence[c.source] ?? 0.7) * (1 - 0.5 * clamp(c.ageDays / Math.max(1, k.staleDays), 0, 1));
  const reach = 1 - 0.3 * clamp(c.reachDays / Math.max(1, k.maxReachDays), 0, 1);
  const bonus = (c.rare ? k.rareBonus : 0) + (c.escapedBefore ? k.escapedBonus : 0);
  out.factors = { cls: Math.round(cls * 100) / 100, confidence: Math.round(conf * 100) / 100, reach: Math.round(reach * 100) / 100, bonus: Math.round(bonus * 100) / 100 };
  out.score = Math.round((w.worth * cls * conf * reach + bonus) * 1000) / 1000;
  if (out.band === 'trivial') return { ...out, reason: 'trivial prey' };
  if (out.score < k.minScore) return { ...out, reason: `below threshold (${k.minScore})` };
  return { ...out, verdict: 'eligible', reason: out.band === 'worthy' ? 'worthy prey' : out.band === 'dangerous' ? 'dangerous prey' : out.band === 'reckless' ? 'reckless hunt' : 'lesser prey' };
}

// The chance a prey slips the hunters at contact: faster prey and cloaked prey run; a prey that cannot move
// (disabled, held) does not. Speeds are strategic multipliers (1.0 = the chart's).
export function escapeChance({ preySpeed = 1, hunterSpeed = 1, cloak = false, canRun = true } = {}, cfg = HUNT_DEFAULTS) {
  const k = { ...HUNT_DEFAULTS, ...cfg };
  if (!canRun) return 0;
  const rel = Number(preySpeed) / Math.max(0.05, Number(hunterSpeed));
  return Math.round(clamp(k.escapeBase + k.escapeSpeedWeight * (rel - 1) + (cloak ? k.escapeCloakBonus : 0), k.escapeMin, k.escapeMax) * 1000) / 1000;
}

// Can the hunters be where the prey will be? `hunterDays` = the hunters' journey days to the meeting system;
// `preyWindowDays` = how long the prey is expected there (its remaining leg plus its dwell; Infinity standing
// still). Feasible when the hunters arrive within the window; the margin is the slack in days.
export function interceptEstimate({ hunterDays, preyWindowDays }) {
  if (hunterDays == null) return { feasible: false, margin: null, reason: 'no route' };
  const margin = (preyWindowDays === Infinity ? Infinity : Number(preyWindowDays)) - Number(hunterDays);
  return { feasible: margin >= 0, margin: margin === Infinity ? null : margin, reason: margin >= 0 ? 'in time' : 'too late' };
}

// The hunt's own end rules (pursuit termination). `h` = { day, startDay, lostSince, lastSeenDay, searchedAll,
// huntersAble, huntersAlive, hunterHullFrac (lowest able), forceRatio (prey ÷ hunters now), cancelled, reckless }.
// Returns null (go on) or { result, reason }.
export function huntTermination(h, cfg = HUNT_DEFAULTS) {
  const k = { ...HUNT_DEFAULTS, ...cfg };
  if (h.cancelled) return { result: 'cancelled', reason: h.cancelled };
  if (!h.huntersAlive) return { result: 'hunter_lost', reason: 'every hunter destroyed' };
  if (!h.huntersAble) return { result: 'hunter_disabled', reason: 'no hunter able to fly' };
  if (h.hunterHullFrac != null && h.hunterHullFrac < k.repairThreshold) return { result: 'abandoned', reason: 'hunters need repair' };
  if (h.forceRatio != null && h.forceRatio > (h.reckless ? k.recklessMaxRatio : k.tooStrongRatio)) return { result: 'abandoned', reason: 'hunters no longer adequate' };
  if (Number(h.day) - Number(h.startDay) > k.pursuitDays) return { result: h.lostSince != null ? 'escaped' : 'abandoned', reason: 'pursuit budget spent' };
  if (h.lastSeenDay != null && Number(h.day) - Number(h.lastSeenDay) > k.staleDays) return { result: 'escaped', reason: 'knowledge too stale' };
  if (h.lostSince != null && (Number(h.day) - Number(h.lostSince) > k.searchDays || h.searchedAll)) return { result: 'escaped', reason: h.searchedAll ? 'searched every likely system' : 'search budget spent' };
  return null;
}

// Where to look after contact is lost: the prey's last known heading first, then where it was last seen, then
// that system's neighbours (nearest first as given), each once.
export function searchPlan(lastKnown, neighbours = [], searched = []) {
  const seen = new Set(searched.map(Number));
  const plan = [];
  for (const i of [lastKnown?.heading, lastKnown?.systemIndex, ...neighbours]) {
    if (i == null || !Number.isFinite(Number(i)) || seen.has(Number(i)) || plan.includes(Number(i))) continue;
    plan.push(Number(i));
  }
  return plan;
}
