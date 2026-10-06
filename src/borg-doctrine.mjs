// BORG ASSIMILATION + TRANSWARP (docs/doctrine/BORG-ASSIMILATION-TRANSWARP.md): the pure rules. No state, no
// world: what a target is worth to the Collective from what the Collective has seen, whether a target may be
// assimilated now, how an assimilation advances, what happens to a crew, and whether a move goes by transwarp.
// The campaign layer (borg-campaign.mjs) owns the records, the knowledge, the journeys and the encounters.

// An assimilation objective's phases, in order. `withdraw` is the force leaving after the outcome.
export const BORG_PHASES = Object.freeze(['evaluate', 'approach', 'intercept', 'disable', 'assimilate', 'withdraw', 'resolved']);

// Bounded defaults (the config's `borg` block may override any of them per campaign).
export const BORG_DEFAULTS = Object.freeze({
  // ---- target value (0..1 each, from what was observed) ----
  techWeight: 0.5, crewWeight: 0.25, strategicWeight: 0.25,
  techPriceFloor: 20000, techPriceSpan: 50,   // tech tier: log(price/floor)/log(span), clamped 0..1
  unusualTechBonus: 0.25,                      // an observed cloak (or other unusual fitting the class shows)
  rareBonus: 0.1,                              // the only class of its kind the Collective has seen
  unusualTechTier: 0.5,                        // the tech tier at or above which a class is "unusual technology"
  // World value: observed population, industry and installations.
  worldPopulationSpan: 5000, worldIndustryPerYard: 0.5, worldTechPerInstallation: 0.15,
  // ---- feasibility ----
  maxShipRatio: 0.9,          // a ship stronger than this share of the Borg force is not taken on (it is fought only in self-defence)
  minWorldRatio: 1.5,         // the Borg force must be at least this many times the world's defence
  minScore: 0.3,              // below this, no objective
  sourceConfidence: Object.freeze({ direct: 1, border: 0.85, departure: 0.9, report: 0.7, contact: 1 }),
  // ---- knowledge and budgets (campaign days; stretched on a chart of longer legs) ----
  trackDays: 1, staleDays: 12, pursuitDays: 40, searchDays: 10, maxReachDays: 60, worldBudgetDays: 120,
  targetCooldownDays: 60, worldCooldownDays: 120,
  // ---- the force ----
  readyThreshold: 0.6, repairThreshold: 0.35, groupMax: 2, maxActive: 1, evaluateEveryDays: 5,
  // ---- contact (strategic resolver) ----
  escapeBase: 0.15, escapeSpeedWeight: 0.6, escapeCloakBonus: 0.15, escapeMin: 0.03, escapeMax: 0.8,
  strikeShare: 0.6,           // share of the target's max hull one Borg engagement removes at parity
  returnShare: 0.15,          // share of the Borg's max hull the target returns at parity
  overkillChance: 0.12,       // a disable that goes too far: the target is destroyed
  selfDefenseRatio: 0.6,      // a target at least this strong forces the Borg to fight to kill (overkill ×3)
  maxEngagements: 3,
  // ---- assimilation ----
  shipAssimilateDays: 2,      // days a subdued ship takes, an assimilator present throughout
  survivorChance: 0.3,        // some of a ship's crew get off before it is taken
  survivorShare: 0.3,
  worldSuppressDays: 6,       // days to suppress a world's defence at parity
  worldAssimilateDays: 20,    // days of uninterrupted presence to assimilate a world at parity
  worldDecayPerDay: 0.04,     // progress lost per day with no Borg force present
  worldAbandonDays: 15,       // a world objective interrupted this long ends (its progress record stays, decaying)
  // ---- transwarp ----
  transwarpDays: 2,           // aperture to exit, whatever the distance (one bounded direct jump)
  transwarpCooldownDays: 30,  // per hull, from its exit
  transwarpMinSavingDays: 3,  // not worth opening an aperture to save less than this
  transwarpMinScore: 0.5,     // only a significant objective opens an aperture
  transwarpMinCondition: 0.6, // a hull below this share of its hull cannot hold a conduit
  // ---- the captain as prey (CAPTAIN-BORG-ASSIMILATION: a failure state, never a faction transfer) ----
  captainAssimilateSeconds: 60, // scene seconds a subdued captain takes, an assimilator present throughout
  captainStages: Object.freeze([0.35, 0.7, 0.9]), // "Assimilation 35%", "70%", "imminent"
  captainLethalBelow: 0.5,    // the Borg drop disabling fire (self-defence) once their vessel is under this share of its hull
  // ---- hulk recovery and regeneration (BORG-HULK-REGENERATION) ----
  recoveryDutyShare: 0.5,      // a recovery vessel spends at most this share of its days on recoveries (it rests after one)
  recoveryMaxActive: 2,        // recovery missions under way at once (per power); every hulk has its own objective
  recoveryMaxAttempts: 2,      // tow missions sent for one hulk before the Collective abandons it
  recoveryPendingDays: 120,    // a hulk waiting this long for a vessel and a reachable node is abandoned
  recoveryMaxTowDays: 40,      // a recovery (outbound + tow home) longer than this is not sent; a node whose tow alone is longer is out of reach
  recoveryCooldownDays: 30,    // after a failed attempt, before the next is sent
  recoveryTranswarp: true,     // the objective permits a conduit to the casualty (the tow home never)
  nodeStabilizeDays: 30,       // an assimilated world becomes a regeneration node this long after completion
  regenSharePerDay: 0.02,      // hull a node regenerates per day (share of the class's max hull)
  regenTargetShare: 0.6,       // the operating threshold: back in service at this share (= readyThreshold)
});

const clamp = (x, a, b) => Math.max(a, Math.min(b, x));
const r2 = (x) => Math.round(x * 100) / 100;

// The chart the day budgets above are written for: a typical leg of this many days.
export const BORG_REFERENCE_LEG_DAYS = 6;
const SCALED_KEYS = ['staleDays', 'pursuitDays', 'searchDays', 'maxReachDays', 'worldBudgetDays', 'targetCooldownDays', 'worldCooldownDays', 'transwarpCooldownDays', 'worldAbandonDays',
  'recoveryPendingDays', 'recoveryMaxTowDays', 'recoveryCooldownDays', 'nodeStabilizeDays'];
// The same budgets on a chart whose typical leg is `scale` times longer (≥ 1). Transwarp's own duration is not
// scaled: it does not depend on the chart's distances.
export function scaledBorgConfig(cfg, scale = 1) {
  const k = Math.max(1, Number(scale) || 1);
  if (k === 1) return cfg;
  const out = { ...cfg, scale: k };
  for (const key of SCALED_KEYS) out[key] = Math.round(Number(cfg[key]) * k);
  return out;
}

// The tech tier of a class from its observed price: 0 for a shuttle, ~1 for the most advanced hulls.
export function techTier(price, cfg = BORG_DEFAULTS) {
  const k = { ...BORG_DEFAULTS, ...cfg };
  const p = Math.max(1, Number(price) || 0);
  return r2(clamp(Math.log(p / k.techPriceFloor) / Math.log(k.techPriceSpan), 0, 1));
}

// A ship target's value from what the Collective saw: `c` = { price, mass, category, cloak, rare, count }.
export function shipValue(c, cfg = BORG_DEFAULTS) {
  const k = { ...BORG_DEFAULTS, ...cfg };
  const tech = techTier(c.price, k);
  const unusual = Boolean(c.cloak) || tech >= k.unusualTechTier;
  const crew = clamp((Number(c.mass) || 1) / 10, 0, 1);
  const strategic = c.category === 'battleship' ? 1 : c.category === 'cruiser' ? 0.7 : ['cargoShuttle', 'shuttle'].includes(c.category) ? 0.1 : 0.4;
  const bonus = (c.cloak ? k.unusualTechBonus : 0) + (c.rare ? k.rareBonus : 0);
  const value = k.techWeight * tech + k.crewWeight * crew + k.strategicWeight * strategic + bonus;
  return { value: r2(value), tech, crew: r2(crew), strategic, bonus: r2(bonus), unusual };
}

// A world target's value from what the Collective saw: `w` = { population, yards, installations } (each null
// when not observed — an unobserved quantity is worth nothing, never guessed).
export function worldValue(w, cfg = BORG_DEFAULTS) {
  const k = { ...BORG_DEFAULTS, ...cfg };
  const pop = w.population == null ? 0 : clamp(Number(w.population) / k.worldPopulationSpan, 0, 1);
  const industry = w.yards == null ? 0 : clamp(Number(w.yards) * k.worldIndustryPerYard, 0, 1);
  const tech = w.installations == null ? 0 : clamp(Number(w.installations) * k.worldTechPerInstallation, 0, 1);
  const value = 0.4 * pop + 0.3 * industry + 0.3 * tech;
  return { value: r2(value), population: r2(pop), industry: r2(industry), tech: r2(tech), unusual: industry > 0 || tech >= 0.3 };
}

// One candidate's score with every factor named. `c` = { kind 'ship'|'world', value (from shipValue/worldValue),
// targetStrength, borgStrength, source, ageDays, reachDays, cooldownUntil, day, duplicate }.
export function scoreTarget(c, cfg = BORG_DEFAULTS) {
  const k = { ...BORG_DEFAULTS, ...cfg };
  const out = { score: 0, ratio: null, factors: {}, verdict: 'rejected', reason: null };
  const reject = (reason) => ({ ...out, reason });
  if (c.duplicate) return reject('already an objective');
  if (c.cooldownUntil != null && Number(c.day) <= Number(c.cooldownUntil)) return reject(`cooldown until day ${c.cooldownUntil}`);
  if (c.ageDays == null || c.ageDays > k.staleDays) return reject('knowledge stale');
  if (c.reachDays == null) return reject('no route');
  if (c.reachDays > k.maxReachDays) return reject(`beyond reach (${c.reachDays} days)`);
  const ratio = Number(c.targetStrength) / Math.max(1e-9, Number(c.borgStrength));
  out.ratio = r2(ratio);
  if (c.kind === 'world') { if (ratio * k.minWorldRatio > 1) return reject('defences too strong'); }
  else if (ratio > k.maxShipRatio) return reject('too strong to take');
  const conf = (k.sourceConfidence[c.source] ?? 0.7) * (1 - 0.5 * clamp(c.ageDays / Math.max(1, k.staleDays), 0, 1));
  const reach = 1 - 0.3 * clamp(c.reachDays / Math.max(1, k.maxReachDays), 0, 1);
  const v = Number(c.value?.value ?? c.value) || 0;
  out.factors = { value: r2(v), confidence: r2(conf), reach: r2(reach) };
  out.score = Math.round(v * conf * reach * 1000) / 1000;
  if (!c.value?.unusual) return { ...out, reason: 'no technology worth acquiring' };
  if (out.score < k.minScore) return { ...out, reason: `below threshold (${k.minScore})` };
  return { ...out, verdict: 'eligible', reason: c.kind === 'world' ? 'world worth assimilating' : 'vessel worth assimilating' };
}

// Bounded eligibility for a ship assimilation now (§5). `s` = { present, subdued, assimilatorPresent,
// destroyed, escaped }. Returns { ok, reason }.
export function assimilationEligibility(s) {
  if (s.destroyed) return { ok: false, reason: 'target destroyed' };
  if (s.escaped) return { ok: false, reason: 'target escaped' };
  if (!s.present) return { ok: false, reason: 'target not present' };
  if (!s.assimilatorPresent) return { ok: false, reason: 'no assimilating vessel present' };
  if (!s.subdued) return { ok: false, reason: 'target not subdued' };
  return { ok: true, reason: 'eligible' };
}

// What happens to a crew when its ship is taken (§6). `t` = { crew (0..1 complement aboard), crewState
// ('aboard'|'rescued'|'lost'|null), roll (0..1) }. Nothing is created or deleted silently: the result says how
// much of the complement was taken, how much got off, and what the hull carries afterwards.
export function crewOutcome(t, cfg = BORG_DEFAULTS) {
  const k = { ...BORG_DEFAULTS, ...cfg };
  const aboard = t.crewState === 'rescued' || t.crewState === 'lost' ? 0 : clamp(Number(t.crew ?? 1), 0, 1);
  if (aboard <= 0) return { result: 'target_abandoned', before: 0, survivors: 0, assimilated: 0, after: 0 };
  const survivors = Number(t.roll) < k.survivorChance ? r2(aboard * k.survivorShare) : 0;
  const assimilated = r2(aboard - survivors);
  return { result: survivors > 0 ? 'partial_survivors' : 'crew_assimilated', before: r2(aboard), survivors, assimilated, after: assimilated };
}

// A ship assimilation's progress for one day (0..1), an assimilator present and the target subdued.
export function shipProgressStep(cfg = BORG_DEFAULTS) {
  const k = { ...BORG_DEFAULTS, ...cfg };
  return 1 / Math.max(1, k.shipAssimilateDays);
}

// The captain's assimilation, advanced in his scene (CAPTAIN-BORG-ASSIMILATION §4). It runs on scene time, not
// on days: he cannot travel while disabled, so no day passes for him. `s` = { progress, dtMs, subdued (his ship is
// disabled), assimilatorPresent (an assimilating Borg vessel in the scene, able), borgAlive }. Returns
// { progress, state, reason }: it advances only while he is subdued and an assimilator is present; it holds (not
// lost) while no assimilator is present, and stops where it is when no Borg vessel is left in the fight (the contact
// then ends); it starts over once he is no longer subdued (mobility restored).
export function captainProgressStep(s, cfg = BORG_DEFAULTS) {
  const k = { ...BORG_DEFAULTS, ...cfg };
  const progress = clamp(Number(s.progress) || 0, 0, 1);
  if (!s.borgAlive) return { progress, state: 'stopped', reason: 'no Borg vessel in the fight' };
  if (!s.subdued) return { progress: 0, state: 'attempting', reason: progress > 0 ? 'the captain is no longer subdued: it starts over' : 'the captain is not subdued' };
  if (!s.assimilatorPresent) return { progress, state: 'held', reason: 'no assimilating vessel present' };
  const step = Math.max(0, Number(s.dtMs) || 0) / (1000 * Math.max(1, k.captainAssimilateSeconds));
  const next = clamp(progress + step, 0, 1);
  return { progress: Math.round(next * 10000) / 10000, state: next >= 1 ? 'completed' : 'assimilating', reason: next >= 1 ? 'assimilation complete' : 'assimilating' };
}
// The concise stage the captain is told (§5): null before it begins, then begun → 35 → 70 → imminent → completed.
export function captainStage(progress, cfg = BORG_DEFAULTS) {
  const k = { ...BORG_DEFAULTS, ...cfg };
  const p = Number(progress) || 0;
  if (p >= 1) return 'completed';
  if (p >= k.captainStages[2]) return 'imminent';
  if (p >= k.captainStages[1]) return '70';
  if (p >= k.captainStages[0]) return '35';
  return p > 0 ? 'begun' : null;
}
export const CAPTAIN_STAGE_TEXT = Object.freeze({ begun: 'Assimilation in progress.', 35: 'Assimilation 35%', 70: 'Assimilation 70%', imminent: 'Assimilation imminent.' });

// ---- BORG-HULK-REGENERATION: nodes and regeneration ----
// Whether a system is a Borg regeneration node today. `w` = { controller, origin, power, assimilatedDay (the day its
// assimilation completed, or null), day, blockaded }. Only the Collective's own: its origin worlds always; an
// assimilated world only once it has stabilized (nodeStabilizeDays after completion) — never a fresh one; nothing
// else (an ordinary yard is never a node). Returns { ok, kind, reason, readyDay }.
export function nodeEligibility(w, cfg = BORG_DEFAULTS) {
  const k = { ...BORG_DEFAULTS, ...cfg };
  if (w.controller !== w.power) return { ok: false, kind: null, reason: 'not held by the Collective' };
  if (w.blockaded) return { ok: false, kind: null, reason: 'under blockade' };
  if (w.origin === w.power) return { ok: true, kind: 'origin', reason: 'a Collective world' };
  if (w.assimilatedDay == null) return { ok: false, kind: null, reason: 'no Borg infrastructure' };
  const readyDay = Number(w.assimilatedDay) + Number(k.nodeStabilizeDays);
  if (Number(w.day) < readyDay) return { ok: false, kind: 'assimilated', reason: `stabilizing until day ${readyDay}`, readyDay };
  return { ok: true, kind: 'assimilated', reason: 'a stabilized assimilated world', readyDay };
}
// One day of regeneration at a node. `r` = { hull, maxHull, atNode (the node still valid) }. Returns the new hull,
// the progress towards the operating threshold, and whether the threshold is reached.
export function regenStep(r, cfg = BORG_DEFAULTS) {
  const k = { ...BORG_DEFAULTS, ...cfg };
  const max = Math.max(1, Number(r.maxHull) || 1);
  const target = max * k.regenTargetShare;
  const hull = Math.max(0, Number(r.hull) || 0);
  if (!r.atNode) return { hull, target, reached: hull >= target, state: 'held' };
  const next = Math.min(max, hull + max * k.regenSharePerDay);
  return { hull: Math.round(next * 10) / 10, target, reached: next >= target, state: next >= target ? 'threshold' : 'regenerating' };
}

// A world's assimilation progress for one day (§8). `w` = { progress, suppressed (0..1 defence suppressed),
// borgStrength, resist (defence still standing), population, present }. Returns the new state and why.
export function worldProgressStep(w, cfg = BORG_DEFAULTS) {
  const k = { ...BORG_DEFAULTS, ...cfg };
  const progress = clamp(Number(w.progress) || 0, 0, 1);
  if (!w.present || !(Number(w.borgStrength) > 0)) return { progress: r2(Math.max(0, progress - k.worldDecayPerDay)), suppressed: Number(w.suppressed) || 0, state: 'interrupted', reason: 'no Borg force present' };
  const resist = Math.max(0, Number(w.resist) || 0);
  const s = Number(w.borgStrength);
  let suppressed = clamp(Number(w.suppressed) || 0, 0, 1);
  if (suppressed < 1) {
    suppressed = clamp(suppressed + (s / (s + resist)) / Math.max(1, k.worldSuppressDays), 0, 1);
    if (resist > s) return { progress, suppressed: r2(suppressed), state: 'contested', reason: 'the defence holds' };
    return { progress, suppressed: r2(suppressed), state: suppressed >= 1 ? 'subdued' : 'suppressing', reason: 'suppressing the defence' };
  }
  const popResist = clamp((Number(w.population) || 0) / k.worldPopulationSpan, 0, 1);
  const rate = (1 / Math.max(1, k.worldAssimilateDays)) * (1 - 0.5 * popResist);
  const next = clamp(progress + rate, 0, 1);
  return { progress: Math.round(next * 1000) / 1000, suppressed, state: next >= 1 ? 'completed' : 'assimilating', reason: next >= 1 ? 'assimilation complete' : 'assimilating' };
}

// The escape chance of a ship target at contact (faster and cloaked targets run).
export function escapeChance({ preySpeed = 1, borgSpeed = 1, cloak = false, canRun = true } = {}, cfg = BORG_DEFAULTS) {
  const k = { ...BORG_DEFAULTS, ...cfg };
  if (!canRun) return 0;
  const rel = Number(preySpeed) / Math.max(0.05, Number(borgSpeed));
  return Math.round(clamp(k.escapeBase + k.escapeSpeedWeight * (rel - 1) + (cloak ? k.escapeCloakBonus : 0), k.escapeMin, k.escapeMax) * 1000) / 1000;
}

// The movement mode for one Borg move (§11–§14). `m` = { capable (every member transwarp-capable), offCooldown,
// conditionOk, score, conventionalDays, cooldownRemaining }. Returns { mode 'transwarp'|'conventional'|'hold', transwarpDays,
// conventionalDays, reason, holdDays }.
export function chooseMovement(m, cfg = BORG_DEFAULTS) {
  const k = { ...BORG_DEFAULTS, ...cfg };
  const out = { mode: 'conventional', transwarpDays: k.transwarpDays, conventionalDays: m.conventionalDays ?? null, reason: null };
  if (!m.capable) return { ...out, transwarpDays: null, reason: 'no transwarp capability in the force' };
  if (!m.conditionOk) return { ...out, reason: 'a hull too damaged to hold a conduit' };
  if (!m.offCooldown) {
    // ETA-aware: waiting for the conduit beats a conventional route that would arrive later.
    const wait = Number(m.cooldownRemaining);
    if (Number.isFinite(wait) && wait > 0 && Number(m.score) >= k.transwarpMinScore && (m.conventionalDays == null || wait + k.transwarpDays + k.transwarpMinSavingDays <= m.conventionalDays)) {
      return { ...out, mode: 'hold', holdDays: wait, reason: `waiting ${wait} d for the conduit (ETA ${wait + k.transwarpDays} d against ${m.conventionalDays ?? '—'} d conventional)` };
    }
    return { ...out, reason: 'transwarp cooldown' };
  }
  if (Number(m.score) < k.transwarpMinScore) return { ...out, reason: `objective below the transwarp threshold (${k.transwarpMinScore})` };
  if (m.conventionalDays != null && m.conventionalDays - k.transwarpDays < k.transwarpMinSavingDays) return { ...out, reason: 'transwarp saves too little' };
  return { ...out, mode: 'transwarp', reason: m.conventionalDays == null ? 'no conventional route: transwarp' : `saves ${m.conventionalDays - k.transwarpDays} days` };
}

// The objective's own end rules (§20). `h` = { day, startDay, budgetDays, borgAlive, borgAble, targetDestroyed,
// targetGone (escaped / lost beyond the search), inaccessible, cancelled, interruptedDays }. Returns null or { result, reason }.
export function borgTermination(h, cfg = BORG_DEFAULTS) {
  const k = { ...BORG_DEFAULTS, ...cfg };
  if (h.cancelled) return { result: 'cancelled', reason: h.cancelled };
  if (!h.borgAlive) return { result: 'borg_destroyed', reason: 'the Borg force was destroyed' };
  if (!h.borgAble) return { result: 'borg_disabled', reason: 'no Borg vessel able to continue' };
  if (h.targetDestroyed) return { result: 'target_destroyed', reason: 'the target was destroyed' };
  if (h.targetGone) return { result: 'target_escaped', reason: h.targetGone };
  if (h.inaccessible) return { result: 'inaccessible', reason: h.inaccessible };
  if (h.interruptedDays != null && h.interruptedDays > k.worldAbandonDays) return { result: 'interrupted', reason: 'assimilation permanently interrupted' };
  if (Number(h.day) - Number(h.startDay) > Number(h.budgetDays)) return { result: 'abandoned', reason: 'objective budget spent' };
  return null;
}
