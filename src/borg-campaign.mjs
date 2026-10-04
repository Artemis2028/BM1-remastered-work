// BORG ASSIMILATION + TRANSWARP (docs/doctrine/BORG-ASSIMILATION-TRANSWARP.md): the campaign layer.
//
// The Borg are not a war faction. Their doctrine is acquire → disable → assimilate → integrate, carried out by
// the Collective's own persistent hulls against targets the Collective has actually seen:
//   * an assimilation objective is a doctrine objective of kind 'assimilation' (one per target, persistent);
//   * a ship target is intercepted, disabled (the Borg prefer it intact), then assimilated over days while an
//     assimilating vessel stays with it — the SAME hull record moves to the Borg (same vid, same damage, its
//     origin kept, the crew outcome explicit; nothing is built and nothing is licensed);
//   * a world target has its defence suppressed, then a persistent assimilation progress that stops and decays
//     when the Borg force is gone; on completion the controller changes explicitly (an assimilation, never a
//     capture: no occupation record, no integration, no licences, no war);
//   * movement is the shared journey system: conventional legs at the hulls' own speed rating, or a transwarp
//     journey (one bounded direct jump, a class capability, per-hull cooldown) — never a faster speed;
//   * contact is one encounter (the captain's scene where he is, the strategic resolver elsewhere).
// No war record, peace, ceasefire, treaty right or capture path is used anywhere here.
import * as C from './campaign-strategy.mjs';
import * as SE from './strategic-encounter.mjs';
import * as TT from './treaty-terms.mjs';
import * as B from './borg-doctrine.mjs';
import { disableThreshold } from './ship-fleet.mjs';

const KIND = 'assimilation';
const r2 = (x) => Math.round(x * 100) / 100;
const vidOf = (h) => h?.identity?.vid || h?.vid || h?.id || null;

export function borgBook(db) {
  const b = (db.borg ||= {});
  for (const k of ['contacts', 'worlds', 'cooldowns', 'selections', 'progress', 'evalDay', 'cover']) b[k] ||= {};
  b.history ||= []; b.assimilatedHulls ||= []; b.assimilatedWorlds ||= []; b.incursions ||= [];
  b.transwarp ||= { uses: 0, cooldownBlocks: 0, refused: 0, log: [] };
  return b;
}
function cfgOf(db) { return B.scaledBorgConfig({ ...B.BORG_DEFAULTS, ...(db.config.borgRules || {}) }, db.borg?.scale ?? 1); }
function powersOf(book, db) { const p = db.config.borg?.power; return p && book.polities[p] ? [p] : []; }
function hullOf(book, polity, id) { return (book.polities[polity]?.hulls || []).find((h) => h.id === id && h.status !== 'lost') || null; }
function anyHull(book, polity, id) { return (book.polities[polity]?.hulls || []).find((h) => h.id === id) || null; }
// Where a hull is standing today (in no system while in warp, except on the day it set out).
function standingAt(book, h, day) {
  if (!h) return null;
  if (!h.transit) return Number(h.systemIndex);
  const tr = C.journeyById(book, h.transit.journeyId);
  if (!tr || tr.status !== 'underway') return Number(h.systemIndex);
  return day != null && Number(tr.legDepartDay) === Number(day) ? Number(h.systemIndex) : null;
}
function observedStrength(book, world, shipId, frac = 1) {
  const st = world.shipStats(shipId) || {};
  return Math.max(1000, Number(st.price) || 0) * book.config.strengthPerPrice * Math.max(0.05, Math.min(1, Number(frac) || 0));
}
function bumpStat(db, key, n = 1) { db.stats[key] = (db.stats[key] || 0) + n; }
function isAssimilator(world, h) { return (world.shipStats(h.shipId) || {}).assimilator === true; }
function setPhase(o, phase, day) { if (o.phase !== phase) { o.phase = phase; (o.phaseHistory ||= []).push({ day, phase }); if (o.phaseHistory.length > 24) o.phaseHistory = o.phaseHistory.slice(-24); } }
function forceHulls(book, o) { return o.force.map((x) => hullOf(book, o.polity, x.hullId)).filter(Boolean); }

// The chart scale (the median leg against the 6-day reference), measured once per campaign.
function borgScale(world, db) {
  const bb = borgBook(db);
  if (bb.scale != null) return bb.scale;
  const legs = [];
  for (const s of world.systems || []) for (const n of world.neighbours(Number(s.index)).map(Number)) if (n > Number(s.index)) { const d = C.plannedJourneyDays(world, Number(s.index), n, null, null); if (d != null && d > 0) legs.push(d); }
  legs.sort((a, b) => a - b);
  const median = legs.length ? legs[Math.floor(legs.length / 2)] : B.BORG_REFERENCE_LEG_DAYS;
  bb.scale = Math.max(1, Math.round((median / B.BORG_REFERENCE_LEG_DAYS) * 100) / 100);
  bb.medianLegDays = median;
  return bb.scale;
}

// ---------- knowledge (§3, §17): what the Collective itself has seen ----------
// Direct: every system a Borg hull stands in. Border: every Borg-held world and its neighbours (a cloaked hull is
// not seen at that range). A hull that left a covered system within the track window is a departure sighting
// with its heading. Ship contacts are per hull (the target of an assimilation is one vessel); world knowledge is
// per covered system: its holder, population, yards, installations and defence as they stand — nothing unseen.
function observe(book, world, db, power, day) {
  const bb = borgBook(db);
  const cfg = cfgOf(db);
  const contacts = (bb.contacts[power] ||= {});
  const worlds = (bb.worlds[power] ||= {});
  const cover = new Map();
  for (const h of book.polities[power]?.hulls || []) { if (h.status === 'lost') continue; const s = standingAt(book, h, day); if (s != null) cover.set(s, 'direct'); }
  for (const s of world.systems) if (s.controller === power) for (const i of [Number(s.index), ...world.neighbours(s.index).map(Number)]) if (!cover.has(i)) cover.set(i, 'border');
  bb.cover[power] = [...cover.keys()].sort((a, b) => a - b);
  for (const [pid, p] of Object.entries(book.polities)) {
    if (pid === power || pid === 'player') continue; // the captain's own fleet ships are not targets this round
    for (const h of p.hulls || []) {
      if (h.status === 'lost') continue;
      let s = standingAt(book, h, day), seen = day;
      if (s == null && h.transit) {
        const tr = C.journeyById(book, h.transit.journeyId);
        const dep = Number(tr?.legDepartDay);
        if (tr && Number.isFinite(dep) && day - dep <= cfg.trackDays && cover.has(Number(h.transit.from))) { s = Number(h.transit.from); seen = dep; }
      }
      if (s == null || !cover.has(s)) continue;
      const src = cover.get(s);
      const st = world.shipStats(h.shipId) || {};
      if (src === 'border' && st.cloak) continue;
      const vid = vidOf(h);
      const prev = contacts[vid];
      if (prev && prev.day > seen) continue;
      const close = src === 'direct';
      contacts[vid] = { key: vid, vid, hullId: h.id, polity: pid, shipId: Number(h.shipId), price: Number(st.price) || 0, mass: Number(st.mass) || 1, category: st.category || null, cloak: Boolean(st.cloak),
        strength: r2(observedStrength(book, world, h.shipId, close ? h.hull / Math.max(1, h.maxHull) : 1)), hullFrac: close ? r2(h.hull / Math.max(1, h.maxHull)) : null,
        subdued: close ? (C.hullIsDisabled(h) || h.status === 'surrendered') : null, speed: C.hullSpeed(world, h),
        systemIndex: s, day: seen, source: seen === day ? src : 'departure', heading: h.transit ? Number(h.transit.to) : null, firstSeenDay: prev?.firstSeenDay ?? day, sightings: (prev?.sightings || 0) + 1 };
    }
  }
  // A hull now the Collective's own is no longer a contact (it is known as itself).
  for (const [k, c] of Object.entries(contacts)) if ((book.polities[power]?.hulls || []).some((h) => h.id === c.hullId)) delete contacts[k];
  const keep = Object.values(contacts).filter((c) => day - c.day <= cfg.staleDays * 3).sort((a, b) => b.day - a.day || String(a.key).localeCompare(String(b.key))).slice(0, 60);
  bb.contacts[power] = Object.fromEntries(keep.map((c) => [c.key, c]));
  for (const [i, src] of cover) {
    const sys = world.systems[i];
    if (!sys || sys.controller === power || !sys.controller) continue;
    const stations = (world.stationsBySystem(i) || []).filter((st) => !st.destroyed && st.cap && ['operational', 'damaged', 'unstaffed'].includes(st.cap.status));
    worlds[i] = { systemIndex: i, controller: sys.controller, day, source: src, population: Number.isFinite(Number(sys.population)) ? Number(sys.population) : null,
      yards: stations.filter((st) => (st.cap.effects?.berths || 0) > 0).length, installations: stations.length,
      defense: r2(C.localDefenseStrength(book, world, i) + worldDefenders(book, world, i, power).filter((h) => src === 'direct' || !(world.shipStats(h.shipId) || {}).cloak).reduce((n, h) => n + C.hullStrength(book, world, h), 0)), firstSeenDay: worlds[i]?.firstSeenDay ?? day };
  }
  // A world now the Collective's own is no longer a target (it knows its own worlds).
  for (const k of Object.keys(worlds)) if (world.systems[Number(k)]?.controller === power) delete worlds[k];
  const wkeep = Object.values(worlds).filter((w) => day - w.day <= cfg.staleDays * 6).sort((a, b) => b.day - a.day || a.systemIndex - b.systemIndex).slice(0, 40);
  bb.worlds[power] = Object.fromEntries(wkeep.map((w) => [w.systemIndex, w]));
}
// The holder's own operational hulls standing at its world (they fight for it; the Borg's war on nobody makes no
// one else a defender).
function worldDefenders(book, world, i, power) {
  const holder = world.systems[i]?.controller;
  if (!holder || holder === power || !book.polities[holder]) return [];
  return book.polities[holder].hulls.filter((h) => h.status !== 'lost' && !h.transit && Number(h.systemIndex) === Number(i) && !C.hullIsDisabled(h) && h.status !== 'surrendered' && !h.encounterId);
}

// ---------- the force (§5, §15, §18) ----------
// Free Borg hulls, whole enough, at least one able to assimilate, grouped at the strongest assimilator's system.
// An assimilated hull is a Borg hull (its own class's speed, no transwarp unless its class has it).
function availableForce(book, world, db, power) {
  const cfg = cfgOf(db);
  const free = (book.polities[power]?.hulls || []).filter((h) => h.status === 'ready' && !h.opId && !h.transit && !h.encounterId && C.hullCanTravel(h) && h.hull >= h.maxHull * cfg.readyThreshold);
  const ass = free.filter((h) => isAssimilator(world, h)).sort((a, b) => C.hullStrength(book, world, b) - C.hullStrength(book, world, a) || String(a.id).localeCompare(String(b.id)));
  if (!ass.length) return { hulls: [], systemIndex: null, strength: 0, reason: free.length ? 'no assimilating vessel free' : 'no free Borg vessel' };
  const at = Number(ass[0].systemIndex);
  const group = free.filter((h) => Number(h.systemIndex) === at).sort((a, b) => isAssimilator(world, b) - isAssimilator(world, a) || C.hullStrength(book, world, b) - C.hullStrength(book, world, a) || String(a.id).localeCompare(String(b.id))).slice(0, cfg.groupMax);
  return { hulls: group, systemIndex: at, strength: r2(group.reduce((n, h) => n + C.hullStrength(book, world, h), 0)), reason: null };
}
// The movement mode for one move (§13): both ETAs, the mode chosen and why. `hulls` all stand at `from`.
function planMovement(book, world, db, power, hulls, from, dest, score, day) {
  const cfg = cfgOf(db);
  const speed = hulls.length ? C.hullsSpeed(world, hulls) : null;
  const conventionalDays = Number(from) === Number(dest) ? 0 : C.plannedJourneyDays(world, Number(from), Number(dest), power, speed);
  const capableHulls = hulls.filter((h) => C.transwarpCapable(world, h));
  const jumpers = capableHulls.some((h) => isAssimilator(world, h)) ? capableHulls : [];
  const refusal = jumpers.length ? C.transwarpRefusal(world, jumpers, day, { cooldownDays: cfg.transwarpCooldownDays, minCondition: cfg.transwarpMinCondition }) : 'no transwarp capability in the force';
  const cooldownRemaining = jumpers.length ? Math.max(0, ...jumpers.map((h) => (h.transwarpLastExitDay == null ? 0 : Number(h.transwarpLastExitDay) + cfg.transwarpCooldownDays - Number(day)))) : null;
  const m = B.chooseMovement({ capable: jumpers.length > 0, offCooldown: !(refusal && /cooldown/.test(refusal)), conditionOk: !(refusal && /damaged/.test(refusal)), score, conventionalDays, cooldownRemaining }, cfg);
  return { ...m, refusal, speed, jumpers: m.mode === 'transwarp' || m.mode === 'hold' ? jumpers.map((h) => h.id) : [] };
}

// ---------- selection (§2, §3) ----------
export function evaluateBorgTargets(doctrine, book, world, power, day, db) {
  const bb = borgBook(db);
  const cfg = cfgOf(db);
  const av = availableForce(book, world, db, power);
  const contacts = Object.values(bb.contacts[power] || {});
  const shipCounts = {};
  for (const c of contacts) shipCounts[c.shipId] = (shipCounts[c.shipId] || 0) + 1;
  const live = db.objectives.filter((o) => o.kind === KIND && o.status === 'active');
  const cands = [];
  const reachOf = (dest, score) => {
    if (av.systemIndex == null) return { reachDays: null, movement: null };
    const mv = planMovement(book, world, db, power, av.hulls, av.systemIndex, dest, score, day);
    return { reachDays: mv.mode === 'transwarp' ? mv.transwarpDays : mv.mode === 'hold' ? mv.holdDays + mv.transwarpDays : mv.conventionalDays, movement: { mode: mv.mode, conventionalDays: mv.conventionalDays, transwarpDays: mv.transwarpDays, holdDays: mv.holdDays ?? null, reason: mv.reason } };
  };
  for (const c of db.config.borg?.ships === false ? [] : contacts) {
    const value = B.shipValue({ price: c.price, mass: c.mass, category: c.category, cloak: c.cloak, rare: shipCounts[c.shipId] === 1 }, cfg);
    const duplicate = live.some((o) => o.targetKind === 'ship' && o.target.vid === c.vid);
    const base = { kind: 'ship', value, targetStrength: c.strength, borgStrength: av.strength || 1, source: c.source, ageDays: day - c.day, cooldownUntil: bb.cooldowns[`${power}|${c.vid}`] ?? null, day, duplicate };
    const prelim = B.scoreTarget({ ...base, reachDays: 0 }, cfg);
    const { reachDays, movement } = reachOf(c.systemIndex, prelim.score);
    const s = B.scoreTarget({ ...base, reachDays }, cfg);
    cands.push({ kind: 'ship', vid: c.vid, hullId: c.hullId, polity: c.polity, shipId: c.shipId, seen: { system: c.systemIndex, day: c.day, source: c.source }, targetStrength: c.strength, value, reachDays, movement, ...s });
  }
  if (db.config.borg?.worlds !== false) {
    for (const w of Object.values(bb.worlds[power] || {})) {
      const value = B.worldValue(w, cfg);
      const duplicate = live.some((o) => o.targetKind === 'world' && Number(o.target.systemIndex) === Number(w.systemIndex));
      const base = { kind: 'world', value, targetStrength: w.defense, borgStrength: av.strength || 1, source: w.source, ageDays: day - w.day, cooldownUntil: bb.cooldowns[`${power}|world:${w.systemIndex}`] ?? null, day, duplicate };
      const prelim = B.scoreTarget({ ...base, reachDays: 0 }, cfg);
      const { reachDays, movement } = reachOf(w.systemIndex, prelim.score);
      const s = B.scoreTarget({ ...base, reachDays }, cfg);
      cands.push({ kind: 'world', vid: `world:${w.systemIndex}`, systemIndex: w.systemIndex, polity: w.controller, seen: { system: w.systemIndex, day: w.day, source: w.source }, targetStrength: w.defense, value, reachDays, movement, ...s });
    }
  }
  cands.sort((a, b) => (b.verdict === 'eligible') - (a.verdict === 'eligible') || b.score - a.score || String(a.vid).localeCompare(String(b.vid)));
  return { power, day, force: av.hulls.map((h) => ({ hullId: h.id, vid: vidOf(h), shipId: h.shipId })), forceStrength: av.strength, forceSystem: av.systemIndex, forceReason: av.reason, candidates: cands };
}
function select(doctrine, book, world, db, power, day, effects, ctx) {
  const bb = borgBook(db);
  const cfg = cfgOf(db);
  if (db.objectives.filter((o) => o.kind === KIND && o.status === 'active' && o.polity === power).length >= cfg.maxActive) return;
  if (day - (bb.evalDay[power] ?? -1e9) < cfg.evaluateEveryDays) return;
  bb.evalDay[power] = day;
  const ev = evaluateBorgTargets(doctrine, book, world, power, day, db);
  const pick = ev.candidates.find((c) => c.verdict === 'eligible') || null;
  const sel = { day, force: ev.force, forceStrength: ev.forceStrength, forceSystem: ev.forceSystem, forceReason: ev.forceReason, chosen: pick?.vid || null, decision: null, candidates: ev.candidates.slice(0, 12) };
  for (const c of ev.candidates) { if (c.reason === 'already an objective') bumpStat(db, 'borgDuplicatesPrevented'); if (String(c.reason).startsWith('cooldown')) bumpStat(db, 'borgCooldownSkips'); }
  if (!ev.force.length) { sel.decision = `deferred: ${ev.forceReason}`; bumpStat(db, 'borgDeferredNoForce'); }
  else if (!pick) sel.decision = ev.candidates.length ? 'no target worth assimilating' : 'no target known';
  else {
    // The doctrine is the authority: Borg command assesses the technology it has itself observed; the engagement
    // mode `assimilation` (identity known, unusual technology, an active assimilation order) authorizes the force.
    const facts = { event_known: true, credible_report: true, event_actionable: true, can_respond: true, unusual_technology: Boolean(pick.value.unusual), evidence_available: true, identity_known: true };
    const react = doctrine ? ctx.D.react(doctrine, { profileId: power, role: 'commander', eventType: 'technology_discovery', facts }) : { result: 'inactive' };
    const role = pick.kind === 'world' ? 'occupier' : 'raider';
    const engage = doctrine ? ctx.D.intent(doctrine, { profileId: power, role, facts: { identity_known: true, unusual_technology: Boolean(pick.value.unusual), assimilation_order_active: true, engagement_objective_active: true } }) : { authorized: false };
    if (react.result !== 'assess_technology') sel.decision = `doctrine: ${react.result}`;
    else if (!engage.authorized) sel.decision = `doctrine: engagement not authorized (${role})`;
    else if (!ctx.isLive(db, power, 'commander', 'assess_technology')) { sel.decision = 'shadow: assimilation not live'; bumpStat(db, 'borgShadow'); }
    else { const o = openObjective(book, world, db, power, ev, pick, role, day, effects, ctx); sel.decision = o ? `objective ${o.id}` : 'could not open'; }
  }
  const list = (bb.selections[power] ||= []);
  list.push(sel);
  if (list.length > 5) bb.selections[power] = list.slice(-5);
}
function openObjective(book, world, db, power, ev, pick, role, day, effects, ctx) {
  const cfg = cfgOf(db);
  let hulls = ev.force.map((x) => hullOf(book, power, x.hullId)).filter(Boolean);
  if (!hulls.length) return null;
  // A force that will jump is the capable hulls only (an incapable hull is not carried this round).
  const plan = planMovement(book, world, db, power, hulls, ev.forceSystem, pick.kind === 'world' ? pick.systemIndex : pick.seen.system, pick.score, day);
  if (plan.mode === 'transwarp' || plan.mode === 'hold') hulls = hulls.filter((h) => plan.jumpers.includes(h.id));
  const id = ctx.nid(book, db, 'assimilation');
  const c = pick.kind === 'ship' ? borgBook(db).contacts[power][pick.vid] : null;
  const w = pick.kind === 'world' ? borgBook(db).worlds[power][pick.systemIndex] : null;
  const targetSystem = pick.kind === 'world' ? pick.systemIndex : c.systemIndex;
  const o = { id, kind: KIND, template: 'assimilation', clock: 'strategic_jumps', actor: `command:${power}`, polity: power, profileId: power, role, response: 'assimilate', incidentId: null,
    targetKind: pick.kind,
    target: pick.kind === 'ship'
      ? { vid: c.vid, hullId: c.hullId, polity: c.polity, shipId: c.shipId, known: { price: c.price, mass: c.mass, category: c.category, cloak: c.cloak, strength: c.strength, hullFrac: c.hullFrac, seenAt: c.systemIndex, seenDay: c.day, source: c.source } }
      : { vid: pick.vid, systemIndex: w.systemIndex, polity: w.controller, known: { population: w.population, yards: w.yards, installations: w.installations, defense: w.defense, seenDay: w.day, source: w.source } },
    value: pick.value, why: { score: pick.score, ratio: pick.ratio, factors: pick.factors, reason: pick.reason, forceStrength: ev.forceStrength },
    force: hulls.map((h) => ({ hullId: h.id, vid: vidOf(h), shipId: Number(h.shipId) })), assigned: { hullId: hulls[0].id, vid: vidOf(hulls[0]) },
    lastKnown: { systemIndex: targetSystem, day: pick.seen.day, source: pick.seen.source, heading: c?.heading ?? null },
    target_: undefined,
    movement: { mode: plan.mode, conventionalDays: plan.conventionalDays, transwarpDays: plan.transwarpDays, reason: plan.reason, refusal: plan.refusal, journeyId: null, etaDay: null, decidedDay: day },
    progress: { value: 0, startDay: null, state: null, lastDay: null },
    budgetDays: pick.kind === 'world' ? cfg.worldBudgetDays : cfg.pursuitDays, startDay: day, createdDay: day, deadline: ctx.at(day + (pick.kind === 'world' ? cfg.worldBudgetDays : cfg.pursuitDays)),
    target_location: { locationId: ctx.locationIdFor(world, targetSystem), systemIndex: targetSystem },
    status: 'active', resolution: null, result: null, phase: 'evaluate', phaseHistory: [{ day, phase: 'evaluate' }], lostSince: null, engagements: 0, encounterId: null, legsFlown: 0,
    handoff: null, authority: { kind: 'assimilation', doctrine: 'assess_technology', engagement: 'assimilation', role, war: false },
    actions: [{ day, action: 'select', detail: `${pick.reason}: score ${pick.score} (value ${pick.value.value}, ${plan.mode}: ${plan.reason})` }] };
  delete o.target_;
  for (const h of hulls) { h.status = 'assigned'; h.opId = id; }
  db.objectives.push(o); db.stats.objectives = (db.stats.objectives || 0) + 1;
  bumpStat(db, 'borgObjectivesOpened'); bumpStat(db, pick.kind === 'world' ? 'borgWorldTargets' : 'borgShipTargets');
  effects.push({ type: 'borgAssimilation', event: 'objective_opened', id, polity: power, targetKind: pick.kind, systemIndex: targetSystem, day });
  return o;
}

// ---------- movement (§11–§15, §25–§32) ----------
function moveForce(book, world, db, o, dest, day, effects) {
  const bb = borgBook(db);
  const cfg = cfgOf(db);
  const hs = forceHulls(book, o).filter((h) => C.hullCanTravel(h));
  if (!hs.length || dest == null) return;
  const lead = hs[0];
  if (lead.transit) {
    const tr = C.journeyById(book, lead.transit.journeyId);
    // A transwarp jump is never turned in the conduit; a conventional leg is re-plotted where it ends.
    if (tr && tr.status === 'underway' && tr.mode !== 'transwarp' && Number(tr.destination) !== Number(dest) && tr.kind === 'borg') tr.pending = { destination: Number(dest), purpose: KIND, authority: tr.authority, meta: { objectiveId: o.id } };
    return;
  }
  if (Number(lead.systemIndex) === Number(dest)) return;
  const group = hs.filter((h) => !h.transit && Number(h.systemIndex) === Number(lead.systemIndex));
  const plan = planMovement(book, world, db, o.polity, group, lead.systemIndex, dest, o.why.score, day);
  const wasHolding = o.movement?.mode === 'hold';
  o.movement = { mode: plan.mode, conventionalDays: plan.conventionalDays, transwarpDays: plan.transwarpDays, reason: plan.reason, refusal: plan.refusal, journeyId: null, etaDay: null, decidedDay: day, from: Number(lead.systemIndex), to: Number(dest), holdDays: plan.holdDays ?? null };
  if (plan.mode === 'hold') {
    // Waiting for the conduit is the quicker way there (ETA-aware); counted once per wait.
    if (!wasHolding) { bb.transwarp.cooldownBlocks++; bumpStat(db, 'borgTranswarpCooldownBlocks'); o.actions.push({ day, action: 'hold', detail: plan.reason }); }
    o.movement.etaDay = Number(day) + Number(plan.holdDays) + Number(plan.transwarpDays);
    return;
  }
  const spec = { kind: 'borg', ref: o.id, sponsor: o.polity, destination: Number(dest), purpose: KIND, authority: { kind: KIND, ref: o.id }, meta: { objectiveId: o.id }, trafficClass: 'military' };
  let r = null;
  if (plan.mode === 'transwarp') {
    const jumpers = group.filter((h) => plan.jumpers.includes(h.id));
    r = C.startJourney(book, world, { ...spec, hulls: jumpers, mode: 'transwarp', transwarp: { days: cfg.transwarpDays, cooldownDays: cfg.transwarpCooldownDays, minCondition: cfg.transwarpMinCondition, conventionalDays: plan.conventionalDays } }, day, effects);
    if (r.ok) {
      bb.transwarp.uses++; bumpStat(db, 'borgTranswarpUses');
      bb.transwarp.log.push({ day, objectiveId: o.id, from: Number(lead.systemIndex), to: Number(dest), conventionalDays: plan.conventionalDays, transwarpDays: plan.transwarpDays, etaDay: r.journey.etaDay, hulls: jumpers.map((h) => vidOf(h)) });
      if (bb.transwarp.log.length > 30) bb.transwarp.log = bb.transwarp.log.slice(-30);
      // Anyone of the force not jumping (an assimilated hull, say) is let go where it is.
      for (const h of group) if (!plan.jumpers.includes(h.id)) { h.opId = null; if (h.status === 'assigned') h.status = 'ready'; o.force = o.force.filter((x) => x.hullId !== h.id); }
    } else { bb.transwarp.refused++; o.movement.mode = 'conventional'; o.movement.reason = `transwarp refused: ${r.reason}`; r = null; }
  } else if (plan.transwarpDays != null && /cooldown/.test(plan.reason || '')) { bb.transwarp.cooldownBlocks++; bumpStat(db, 'borgTranswarpCooldownBlocks'); }
  if (!r) r = C.startJourney(book, world, { ...spec, hulls: group }, day, effects);
  if (!r.ok) { o.blocked ||= { since: day, reason: r.reason }; o.actions.push({ day, action: 'blocked', detail: r.reason }); return; }
  o.blocked = null;
  o.movement.journeyId = r.journey.id; o.movement.etaDay = r.journey.etaDay;
  o.actions.push({ day, action: 'move', detail: `${o.movement.mode} to ${dest}: ETA day ${r.journey.etaDay} (conventional ${plan.conventionalDays ?? '—'} d, transwarp ${plan.transwarpDays ?? '—'} d; ${o.movement.reason})` });
  for (const h of r.journey.members.map((id) => hullOf(book, o.polity, id)).filter(Boolean)) { h.status = 'assigned'; h.opId = o.id; }
}
function nearestBorgWorld(book, world, power, from, speed) {
  let best = null, bestDays = Infinity;
  for (const s of world.systems) {
    if (s.controller !== power) continue;
    const d = Number(s.index) === Number(from) ? 0 : C.plannedJourneyDays(world, from, s.index, power, speed);
    if (d != null && (d < bestDays || (d === bestDays && s.index < best))) { best = s.index; bestDays = d; }
  }
  return best;
}

// ---------- the objective's day ----------
function work(doctrine, book, world, db, o, day, effects) {
  const bb = borgBook(db);
  const cfg = cfgOf(db);
  if (o.encounterId) {
    const enc = SE.encounterById(book, o.encounterId);
    if (enc && day > Number(enc.createdDay ?? day)) C.settleAbandonedHandoff(book, world, enc, day, effects);
    if (enc && SE.isLive(enc)) { setPhase(o, 'disable', day); o.handoff = { encounterId: enc.id, status: enc.status, captainScene: world.localSystem != null && Number(world.localSystem) === Number(enc.system) }; return; }
    o.encounterId = null;
    if (o.status !== 'active') return;
  }
  const force = forceHulls(book, o);
  const alive = force.filter((h) => h.status !== 'lost');
  const able = alive.filter((h) => C.hullCanTravel(h));
  const borgStrength = able.reduce((n, h) => n + C.hullStrength(book, world, h), 0);
  const lead = able[0] || null;
  const here = lead ? standingAt(book, lead, day) : null;
  if (o.targetKind === 'ship') return workShip(book, world, db, o, { alive, able, borgStrength, lead, here }, day, effects, cfg);
  return workWorld(book, world, db, o, { alive, able, borgStrength, lead, here }, day, effects, cfg);
}
function workShip(book, world, db, o, f, day, effects, cfg) {
  const bb = borgBook(db);
  const contact = bb.contacts[o.polity]?.[o.target.vid] || null;
  if (contact && contact.day > o.lastKnown.day) { o.lastKnown = { systemIndex: contact.systemIndex, day: contact.day, source: contact.source, heading: contact.heading }; o.lostSince = null; }
  const fresh = contact && day - contact.day <= cfg.trackDays;
  if (!fresh && o.lostSince == null) { o.lostSince = day; o.actions.push({ day, action: 'lost_contact', detail: `last seen at ${o.lastKnown.systemIndex} on day ${o.lastKnown.day}` }); effects.push({ type: 'borgAssimilation', event: 'contact_lost', id: o.id, polity: o.polity, systemIndex: o.lastKnown.systemIndex, day }); }
  // Destroyed is known only where the Collective sees it: its own engagement, or the hull lost in a system its
  // sensors cover today. A hull gone from its owner's books for any other reason (taken, written off) is just a
  // lost contact: the search budget runs.
  const th = anyHull(book, o.target.polity, o.target.hullId);
  const targetDestroyed = o.lastEngagement?.target === 'destroyed' || Boolean(th && th.status === 'lost' && (bb.cover[o.polity] || []).includes(Number(th.systemIndex)));
  const targetGone = o.lostSince != null && day - o.lostSince > cfg.searchDays ? 'contact lost beyond the search budget' : (o.lastKnown && day - o.lastKnown.day > cfg.staleDays ? 'knowledge too stale' : null);
  const end = B.borgTermination({ day, startDay: o.startDay, budgetDays: o.budgetDays, borgAlive: f.alive.length > 0, borgAble: f.able.length > 0, targetDestroyed, targetGone: o.phase === 'assimilate' && !targetDestroyed ? null : targetGone, cancelled: o.cancelRequested || null }, cfg);
  if (end) return closeObjective(book, world, db, o, end.result, end.reason, day, effects);
  const at = Number(o.lastKnown.systemIndex);
  const targetHere = th && th.status !== 'lost' && !th.transit && standingAt(book, th, day) === at; // never one already under way (a tow, say)
  if (f.here === at && targetHere && fresh) {
    const subdued = C.hullIsDisabled(th) || th.status === 'surrendered';
    if (subdued) {
      // §5: present, subdued, an assimilating vessel present, not destroyed, not escaped — then progress.
      const assimilatorHere = f.able.some((h) => isAssimilator(world, h) && standingAt(book, h, day) === at);
      const elig = B.assimilationEligibility({ present: true, subdued, assimilatorPresent: assimilatorHere, destroyed: false, escaped: false });
      if (!elig.ok) { o.actions.push({ day, action: 'wait', detail: elig.reason }); return; }
      if (o.phase !== 'assimilate') { setPhase(o, 'assimilate', day); o.progress = { value: 0, startDay: day, state: 'assimilating', lastDay: null }; effects.push({ type: 'borgAssimilation', event: 'assimilation_begun', id: o.id, polity: o.polity, targetKind: 'ship', targetVid: o.target.vid, targetPolity: o.target.polity, systemIndex: at, day }); return; }
      if (o.progress.lastDay === day) return;
      o.progress.value = Math.min(1, Math.round((o.progress.value + B.shipProgressStep(cfg)) * 1000) / 1000); o.progress.lastDay = day;
      if (o.progress.value >= 1) return completeShip(book, world, db, o, th, at, day, effects, cfg);
      return;
    }
    if (o.phase === 'assimilate') { o.progress.state = 'interrupted'; setPhase(o, 'disable', day); }
    if (o.tacticalDay !== day) return engage(book, world, db, o, at, [th], day, effects, cfg);
    return;
  }
  if (o.phase === 'assimilate' && !targetHere) {
    // The subdued target was taken away (towed off, recovered): the assimilation is interrupted where it stood.
    o.progress.state = 'interrupted'; setPhase(o, 'approach', day);
    o.actions.push({ day, action: 'interrupted', detail: 'the target is no longer here' });
  }
  const dest = fresh ? (contact.heading ?? contact.systemIndex) : (o.lastKnown.heading ?? o.lastKnown.systemIndex);
  const lt = f.lead?.transit;
  setPhase(o, lt && Number(lt.to) === Number(dest) ? 'intercept' : 'approach', day);
  moveForce(book, world, db, o, dest, day, effects);
}
function completeShip(book, world, db, o, th, at, day, effects, cfg) {
  const bb = borgBook(db);
  const crew = B.crewOutcome({ crew: th.crew, crewState: th.stranded?.crew ?? null, roll: C.seededUnit(book.seed, 'borg-crew', o.id, day, th.id) }, cfg);
  const from = o.target.polity;
  const before = { hull: th.hull, maxHull: th.maxHull, shipId: th.shipId, vid: vidOf(th) };
  if (!C.assimilateHull(book, th, from, o.polity, day, at, crew)) return closeObjective(book, world, db, o, 'inaccessible', 'the target is no longer a living hull of its owner', day, effects);
  o.progress.state = 'completed';
  bb.assimilatedHulls.push({ vid: before.vid, hullId: th.id, shipId: th.shipId, from, origin: th.identity?.origin?.builder ?? from, day, systemIndex: at, hull: before.hull, maxHull: before.maxHull, crew: crew.result, objectiveId: o.id });
  if (bb.assimilatedHulls.length > 60) bb.assimilatedHulls = bb.assimilatedHulls.slice(-60);
  bumpStat(db, 'borgShipsAssimilated');
  effects.push({ type: 'borgAssimilation', event: 'ship_assimilated', id: o.id, polity: o.polity, targetVid: before.vid, targetPolity: from, shipId: th.shipId, crew: crew.result, systemIndex: at, day });
  return closeObjective(book, world, db, o, 'target_assimilated', `assimilated (${crew.result.replace(/_/g, ' ')})`, day, effects);
}
function workWorld(book, world, db, o, f, day, effects, cfg) {
  const bb = borgBook(db);
  const i = Number(o.target.systemIndex);
  const sys = world.systems[i];
  if (sys?.controller === o.polity && o.progress.state !== 'completed') return closeObjective(book, world, db, o, 'target_assimilated', 'already the Collective\'s', day, effects);
  const rec = bb.progress[i];
  const interruptedDays = rec && rec.state === 'interrupted' && rec.interruptedSince != null ? day - rec.interruptedSince : null;
  const end = B.borgTermination({ day, startDay: o.startDay, budgetDays: o.budgetDays, borgAlive: f.alive.length > 0, borgAble: f.able.length > 0, inaccessible: o.blocked && day - o.blocked.since > cfg.searchDays ? `no way there: ${o.blocked.reason}` : null, interruptedDays, cancelled: o.cancelRequested || null }, cfg);
  if (end) return closeObjective(book, world, db, o, end.result, end.reason, day, effects);
  if (f.here !== i) { const lt = f.lead?.transit; setPhase(o, lt && Number(lt.to) === i ? 'intercept' : 'approach', day); return moveForce(book, world, db, o, i, day, effects); }
  // On station: defenders first (one encounter a day while any stand), then suppression and assimilation.
  const defenders = worldDefenders(book, world, i, o.polity);
  // A record from an earlier, completed assimilation of a world since retaken starts again from nothing.
  if (bb.progress[i]?.state === 'completed' && day > Number(bb.progress[i].completedDay) + 1 && sys?.controller !== o.polity) delete bb.progress[i];
  const r = (bb.progress[i] ||= { systemIndex: i, objectiveId: o.id, startDay: day, progress: 0, suppressed: 0, resist: null, borgPresent: true, state: 'suppressing', from: sys?.controller ?? null, origin: sys?.origin ?? null, history: [], interruptedSince: null, lastDay: null });
  r.objectiveId = o.id;
  if (r.lastDay === day) return;
  if (defenders.length && o.tacticalDay !== day) { setPhase(o, 'disable', day); return engage(book, world, db, o, i, defenders, day, effects, cfg); }
  const resist = C.localDefenseStrength(book, world, i) * (1 - (r.suppressed || 0)) + defenders.reduce((n, h) => n + C.hullStrength(book, world, h), 0);
  const step = B.worldProgressStep({ progress: r.progress, suppressed: r.suppressed, borgStrength: f.borgStrength, resist, population: sys?.population ?? 0, present: true }, cfg);
  const was = r.state;
  Object.assign(r, { progress: step.progress, suppressed: step.suppressed, resist: r2(resist), borgPresent: true, state: step.state, lastDay: day, interruptedSince: null, borgStrength: r2(f.borgStrength) });
  r.history.push({ day, progress: step.progress, suppressed: step.suppressed, state: step.state }); if (r.history.length > 20) r.history = r.history.slice(-20);
  setPhase(o, step.state === 'assimilating' || step.state === 'completed' ? 'assimilate' : 'disable', day);
  o.progress = { value: step.progress, startDay: o.progress.startDay ?? (step.state === 'assimilating' ? day : null), state: step.state, lastDay: day };
  if (was !== 'assimilating' && step.state === 'assimilating') effects.push({ type: 'borgAssimilation', event: 'world_assimilation_begun', id: o.id, polity: o.polity, targetKind: 'world', systemIndex: i, day });
  if (step.state === 'completed') {
    r.state = 'completed'; r.completedDay = day;
    bb.assimilatedWorlds.push({ systemIndex: i, from: r.from, origin: r.origin, day, objectiveId: o.id, startDay: r.startDay });
    if (bb.assimilatedWorlds.length > 30) bb.assimilatedWorlds = bb.assimilatedWorlds.slice(-30);
    bumpStat(db, 'borgWorldsAssimilated');
    // Whatever capture record the world carried (it was itself occupied) ends here: the Borg hold it now, by
    // assimilation, which is no occupation (no claimant's war counts it, no occupation scales it).
    if (book.occupations?.[i]) delete book.occupations[i];
    if (book.territory?.[i]) delete book.territory[i];
    // An assimilation, not a capture: the engine changes the controller (keeping the origin and the former
    // holder on record) without any occupation, integration, licence or war record.
    effects.push({ type: 'systemAssimilated', systemIndex: i, by: o.polity, from: r.from, origin: r.origin, objectiveId: o.id, day });
    return closeObjective(book, world, db, o, 'target_assimilated', 'world assimilated', day, effects);
  }
}
// Every world-assimilation record with no Borg force standing there today decays and is marked interrupted.
function decayProgress(book, world, db, power, day) {
  const bb = borgBook(db);
  const cfg = cfgOf(db);
  for (const [k, r] of Object.entries(bb.progress)) {
    // (the engine applies the controller change after the day that completed it: a day's grace before judging)
    if (r.state === 'completed') { if (day > Number(r.completedDay) + 1 && world.systems[Number(r.systemIndex)]?.controller !== power) delete bb.progress[k]; continue; }
    if (r.lastDay === day) continue;
    // Present means an active objective's assimilating force standing there (a probe or a released hull is not).
    const present = db.objectives.some((o) => o.kind === KIND && o.status === 'active' && o.targetKind === 'world' && Number(o.target.systemIndex) === Number(r.systemIndex)
      && forceHulls(book, o).some((h) => C.hullCanTravel(h) && isAssimilator(world, h) && standingAt(book, h, day) === Number(r.systemIndex)));
    if (present) continue; // the objective's own day accounts for it
    const step = B.worldProgressStep({ progress: r.progress, suppressed: r.suppressed, borgStrength: 0, present: false }, cfg);
    if (r.state !== 'interrupted') { r.interruptedSince = day; r.history.push({ day, progress: r.progress, state: 'interrupted' }); }
    Object.assign(r, { progress: step.progress, borgPresent: false, state: 'interrupted', lastDay: day });
    if (r.progress <= 0 && !db.objectives.some((o) => o.id === r.objectiveId && o.status === 'active')) delete bb.progress[k];
  }
}

// ---------- contact: one encounter (§9, §10) ----------
function engage(book, world, db, o, at, targets, day, effects, cfg) {
  o.engagements++; o.tacticalDay = day;
  setPhase(o, 'disable', day);
  const borg = forceHulls(book, o).filter((h) => C.hullCanTravel(h) && standingAt(book, h, day) === Number(at) && !h.encounterId);
  const tpol = (h) => Object.entries(book.polities).find(([, p]) => p.hulls.includes(h))?.[0] || null;
  const holder = o.targetKind === 'world' ? world.systems[at]?.controller : o.target.polity;
  const { enc } = SE.openEncounter(book, { key: `assim:${o.id}:${day}:e${o.engagements}`, system: Number(at), type: KIND, objective: { kind: KIND, ref: o.id }, authority: { kind: KIND, source: 'borg_doctrine' },
    sides: { a: o.polity, b: holder }, captain: false, playerHostile: false, reason: o.targetKind === 'world' ? 'the Borg engage a world\'s defenders' : 'the Borg intercept a vessel to disable it', contact: { objectiveId: o.id, targetKind: o.targetKind, engagement: o.engagements },
    participants: [...borg.map((h) => ({ hullId: h.id, polity: o.polity, side: 'borg', record: h })), ...targets.map((h) => ({ hullId: h.id, polity: tpol(h), side: 'target', record: h }))] }, day, C.encounterHullLookup(book));
  o.encounterId = enc.id;
  o.actions.push({ day, action: 'engage', detail: `contact at ${at} (engagement ${o.engagements}, ${targets.length} target${targets.length === 1 ? '' : 's'})` });
  const captainScene = world.localSystem != null && Number(world.localSystem) === Number(at);
  o.handoff = { encounterId: enc.id, status: enc.status, captainScene };
  effects.push({ type: 'borgAssimilation', event: 'engaged', id: o.id, polity: o.polity, targetKind: o.targetKind, systemIndex: Number(at), encounterId: enc.id, captainScene, day });
  if (captainScene) return enc; // the scene fights it: nothing strategic touches it meanwhile
  const report = strategicReport(book, world, db, o, enc, day, cfg);
  SE.resolveEncounter(book, world, enc.id, report, day, effects, C.encounterHullLookup(book));
  return enc;
}
// The strategic resolver for a contact (no scene): a ship target may slip away; otherwise the Borg strike to
// disable — a disable that goes too far destroys (more likely against a target that fights back hard, §10); the
// targets return fire. Seeded: the same contact, the same result. Uses the targets' and Borg's real strength only.
function strategicReport(book, world, db, o, enc, day, cfg = cfgOf(db)) {
  const look = C.encounterHullLookup(book);
  const side = (s) => enc.participants.filter((p) => p.side === s).map((p) => ({ p, h: look(p) })).filter((x) => x.h && x.h.status !== 'lost');
  const borg = side('borg'), targets = side('target');
  const bs = borg.reduce((n, x) => n + C.hullStrength(book, world, x.h), 0) || 1;
  const ts = targets.reduce((n, x) => n + C.hullStrength(book, world, x.h), 0) || 1;
  const participants = {};
  const n = o.engagements;
  if (o.targetKind === 'ship' && targets.length) {
    const pe = B.escapeChance({ preySpeed: C.hullsSpeed(world, targets.map((x) => x.h)), borgSpeed: C.hullsSpeed(world, borg.map((x) => x.h)), cloak: targets.some((x) => world.shipStats(x.h.shipId)?.cloak), canRun: targets.every((x) => C.hullCanTravel(x.h)) }, cfg);
    if (C.seededUnit(book.seed, 'borg-escape', o.id, day, n) < pe) {
      for (const x of targets) participants[x.p.ref] = { fate: 'escaped', hull: x.h.hull, vid: x.p.vid };
      for (const x of borg) participants[x.p.ref] = { fate: 'survived', hull: x.h.hull, vid: x.p.vid };
      return { result: { outcome: 'escaped', strategic: true, escapeChance: pe }, participants };
    }
  }
  const selfDefense = ts >= cfg.selfDefenseRatio * bs;
  const overkill = cfg.overkillChance * (selfDefense ? 3 : 1);
  for (const x of targets) {
    const max = Number(x.h.maxHull) || 1;
    const share = cfg.strikeShare * Math.max(0.3, Math.min(3, bs / ts)) * (0.75 + 0.5 * C.seededUnit(book.seed, 'borg-hit', o.id, day, x.h.id));
    const after = Number(x.h.hull) - max * share;
    const line = Math.max(1, Math.floor(disableThreshold(max)));
    if (after <= line) {
      const kill = C.seededUnit(book.seed, 'borg-overkill', o.id, day, x.h.id) < overkill;
      participants[x.p.ref] = kill ? { fate: 'destroyed', hull: 0, vid: x.p.vid } : { fate: 'disabled', hull: Math.max(1, Math.min(line, Math.round(after > 0 ? after : line * 0.6))), vid: x.p.vid };
    } else participants[x.p.ref] = { fate: 'survived', hull: Math.round(after * 10) / 10, vid: x.p.vid };
  }
  for (const x of borg) {
    const max = Number(x.h.maxHull) || 1;
    const hit = cfg.returnShare * Math.max(0.1, Math.min(3, ts / bs)) * (0.75 + 0.5 * C.seededUnit(book.seed, 'borg-return', o.id, day, x.h.id)) * max;
    const hull = Math.max(0, Number(x.h.hull) - hit);
    participants[x.p.ref] = { fate: hull <= 0 ? 'destroyed' : 'survived', hull: Math.round(hull * 10) / 10, vid: x.p.vid };
  }
  return { result: { outcome: 'fought', strategic: true, selfDefense, overkill: r2(overkill) }, participants };
}
// What an engagement did to the objective (scene or strategic): one result, on the same objective.
function applyEngagement(book, world, db, o, enc, result, day, effects) {
  const fates = (s) => enc.participants.filter((p) => p.side === s).map((p) => p.fate || 'survived');
  const tf = fates('target'), bf = fates('borg');
  const out = (f) => ['destroyed', 'disabled', 'surrendered'].includes(f);
  o.lastEngagement = { day, outcome: result?.outcome || 'fought', target: tf.length === 1 ? tf[0] : tf, borg: bf, strategic: Boolean(result?.strategic), scene: !result?.strategic };
  o.handoff = o.handoff ? { ...o.handoff, status: 'resolved', outcome: result?.outcome || 'fought' } : null;
  if (bf.length && bf.every(out)) return closeObjective(book, world, db, o, bf.every((f) => f === 'destroyed') ? 'borg_destroyed' : 'borg_disabled', 'the Borg force is out of the fight', day, effects);
  if (o.targetKind === 'ship') {
    const f = tf[0] || 'survived';
    if (f === 'destroyed' || result?.outcome === 'target_destroyed') return closeObjective(book, world, db, o, 'target_destroyed', 'the target was destroyed before it could be assimilated', day, effects);
    if (f === 'escaped' || result?.outcome === 'escaped') return closeObjective(book, world, db, o, 'target_escaped', 'the target escaped', day, effects);
    if (f === 'disabled' || f === 'surrendered' || result?.outcome === 'subdued') {
      effects.push({ type: 'borgAssimilation', event: 'target_subdued', id: o.id, polity: o.polity, targetVid: o.target.vid, systemIndex: Number(enc.system), day });
      setPhase(o, 'assimilate', day);
      o.progress = { value: 0, startDay: day, state: 'assimilating', lastDay: day };
      effects.push({ type: 'borgAssimilation', event: 'assimilation_begun', id: o.id, polity: o.polity, targetKind: 'ship', targetVid: o.target.vid, targetPolity: o.target.polity, systemIndex: Number(enc.system), day });
      return { continuation: 'the target is subdued: assimilation begins' };
    }
    if (o.engagements >= cfgOf(db).maxEngagements) return closeObjective(book, world, db, o, 'abandoned', 'the target could not be subdued', day, effects);
    return { continuation: 'the target still resists' };
  }
  return { continuation: tf.every(out) ? 'the defenders are down' : 'the defence holds' };
}
SE.registerEncounterFamily(KIND, {
  resolve(book, world, enc, report, day, effects) {
    const db = book.doctrine; const o = db?.objectives?.find((x) => x.id === enc.objective.ref);
    if (!o || o.status !== 'active') return { continuation: 'the objective was already over' };
    o.encounterId = null; o.tacticalDay = day;
    return applyEngagement(book, world, db, o, enc, report.result || {}, day, effects);
  },
  // No scene could be made: the strategic resolver, once, written back exactly as a scene's report.
  fallback(book, world, enc, day, effects) {
    const db = book.doctrine; const o = db?.objectives?.find((x) => x.id === enc.objective.ref);
    if (!o || o.status !== 'active') return { continuation: 'the objective was already over' };
    o.encounterId = null; o.tacticalDay = day;
    const report = strategicReport(book, world, db, o, enc, day);
    const hook = SE.fateHooks().applyFate;
    for (const p of enc.participants) { const r = report.participants[p.ref]; if (!r) continue; p.fate = r.fate; p.after = { hull: r.hull }; if (hook && !p.engineOwned) hook(book, world, p, r, enc, day, effects); }
    enc.result = report.result;
    return applyEngagement(book, world, db, o, enc, report.result, day, effects);
  },
  abort(book, enc) { const o = book.doctrine?.objectives?.find((x) => x.id === enc.objective.ref); if (o) o.encounterId = null; },
});

// ---------- closure (§20) ----------
function closeObjective(book, world, db, o, result, reason, day, effects) {
  if (o.status !== 'active') return { continuation: 'already over' };
  const bb = borgBook(db);
  const cfg = cfgOf(db);
  const success = result === 'target_assimilated';
  o.status = success ? 'completed' : 'aborted'; o.closedDay = day;
  o.result = { result, reason, day };
  o.resolution = { status: o.status, reasons: [result], alsoSucceeded: [], day, note: reason };
  o.encounterId = null;
  if (o.progress && o.progress.state !== 'completed' && !success) o.progress.state = o.progress.value > 0 ? 'interrupted' : o.progress.state;
  setPhase(o, 'withdraw', day);
  bumpStat(db, success ? 'borgAssimilations' : result === 'target_destroyed' ? 'borgTargetsDestroyed' : result === 'target_escaped' ? 'borgTargetsEscaped' : result === 'borg_destroyed' || result === 'borg_disabled' ? 'borgForcesLost' : 'borgObjectivesAbandoned');
  bumpStat(db, success ? 'objectivesCompleted' : 'objectivesAborted');
  const key = o.targetKind === 'world' ? `${o.polity}|world:${o.target.systemIndex}` : `${o.polity}|${o.target.vid}`;
  // A failure cools the target; an assimilated world cools too (it is the Collective's — and if it is ever retaken,
  // not again at once).
  if (!success || o.targetKind === 'world') bb.cooldowns[key] = day + (o.targetKind === 'world' ? cfg.worldCooldownDays : cfg.targetCooldownDays);
  bb.history.push({ objectiveId: o.id, targetKind: o.targetKind, target: o.target.vid, targetPolity: o.target.polity, result, reason, startDay: o.startDay, endDay: day, days: day - o.startDay, engagements: o.engagements, mode: o.movement?.mode, force: o.force.map((x) => x.vid) });
  if (bb.history.length > 40) bb.history = bb.history.slice(-40);
  o.actions.push({ day, action: 'closed', detail: `${result}: ${reason}` });
  effects.push({ type: 'doctrineObjective', id: o.id, incidentId: null, polity: o.polity, response: o.response, hullId: o.assigned.hullId, vid: o.assigned.vid, to: o.target_location?.systemIndex ?? null, day, status: o.status, reasons: [result] });
  effects.push({ type: 'borgAssimilation', event: 'closed', id: o.id, polity: o.polity, result, targetKind: o.targetKind, systemIndex: o.target_location?.systemIndex ?? null, day });
  // Withdraw: every able Borg hull of the force returns (conventionally) to the nearest Collective world; one in
  // a conduit or on a leg turns there when it arrives. A hulk stays where it lies.
  for (const h of forceHulls(book, o)) {
    if (!C.hullCanTravel(h)) { if (h.opId === o.id) h.opId = null; continue; }
    const from = h.transit ? Number(h.transit.to) : Number(h.systemIndex);
    const home = nearestBorgWorld(book, world, o.polity, from, C.hullSpeed(world, h));
    if (h.transit) {
      const tr = C.journeyById(book, h.transit.journeyId);
      if (tr && tr.status === 'underway' && tr.mode !== 'transwarp') { tr.pending = { kind: 'return', destination: home ?? from, purpose: 'return', war: null, authority: { kind: 'return', ref: o.id }, meta: { home: home ?? from } }; continue; }
      if (tr && tr.status === 'underway') { tr.meta = { ...(tr.meta || {}), home: home ?? from }; continue; } // it exits first, then turns for home
    }
    if (home == null || Number(home) === Number(h.systemIndex)) { h.opId = null; if (h.status === 'assigned') h.status = 'ready'; continue; }
    const r = C.startJourney(book, world, { kind: 'return', ref: o.id, sponsor: o.polity, hulls: [h], destination: home, purpose: 'return', authority: { kind: 'return', ref: o.id }, meta: { home } }, day, effects);
    if (!r.ok || r.arrived) { h.opId = null; if (h.status === 'assigned') h.status = 'ready'; } else { h.opId = o.id; h.status = 'assigned'; }
  }
  return { continuation: `the objective closes: ${result}`, objectiveClosed: true };
}
function releaseJourneyHulls(book, tr) {
  const o = book.doctrine?.objectives?.find((x) => x.id === tr.ref);
  if (o && o.status === 'active') return;
  for (const id of tr.members || []) { const h = hullOf(book, tr.sponsor, id); if (h && h.opId === tr.ref) { h.opId = null; if (h.status === 'assigned') h.status = 'ready'; } }
}
C.registerJourneyKind('borg', {
  valid(book, world, tr) {
    const o = book.doctrine?.objectives?.find((x) => x.id === tr.ref);
    if (o && o.status === 'active') return { ok: true };
    if (tr.pending?.kind === 'return' || tr.pending?.purpose === 'return') return { ok: true };
    return { ok: false, reason: 'objective over', pending: { kind: 'return', destination: tr.meta?.home ?? tr.from, purpose: 'return', war: null, authority: { kind: 'return', ref: tr.ref }, meta: { home: tr.meta?.home ?? tr.from } } };
  },
  onCross(book, world, tr, cross, effects) {
    const o = book.doctrine?.objectives?.find((x) => x.id === tr.ref);
    if (o) o.legsFlown = (o.legsFlown || 0) + 1;
    noteIncursion(book, tr, cross.at, cross.day, effects);
  },
  onDetach(book, world, tr, h) { if (h.opId === tr.ref && (h.status === 'lost' || !C.hullCanTravel(h))) h.opId = null; },
  onArrive(book, world, tr) { releaseJourneyHulls(book, tr); },
  onHalt(book, world, tr) { releaseJourneyHulls(book, tr); },
});
// §16: the Borg are no party to any treaty and make no compliance decision; but where a Borg vessel enters (or
// exits a conduit into) a system a DMZ protects, the parties have something to report: an incursion on record.
function noteIncursion(book, tr, at, day, effects) {
  const terms = (book.treatyTerms || []).filter((t) => t.type === 'dmz' && TT.termActive(t, day) && (t.systems || []).map(Number).includes(Number(at)));
  if (!terms.length) return;
  const db = book.doctrine; if (!db) return;
  const bb = borgBook(db);
  for (const t of terms) {
    if (bb.incursions.some((x) => x.termId === t.id && x.journeyId === tr.id && x.systemIndex === Number(at))) continue;
    bb.incursions.push({ termId: t.id, parties: (t.parties || []).slice(), systemIndex: Number(at), day: Number(day), journeyId: tr.id, mode: tr.mode || 'conventional', vids: tr.members.map((id) => tr.vids?.[id] ?? id) });
    if (bb.incursions.length > 30) bb.incursions = bb.incursions.slice(-30);
    effects.push({ type: 'borgAssimilation', event: 'dmz_incursion', polity: tr.sponsor, termId: t.id, parties: (t.parties || []).slice(), systemIndex: Number(at), day });
  }
}

// ---------- the daily pass ----------
export function advanceBorg(doctrine, book, world, db, day, effects, ctx) {
  const powers = powersOf(book, db);
  if (!powers.length) return;
  borgScale(world, db);
  const bb = borgBook(db);
  for (const [k, until] of Object.entries(bb.cooldowns)) if (Number(until) < day) delete bb.cooldowns[k];
  for (const p of powers) observe(book, world, db, p, day);
  for (const o of db.objectives) if (o.kind === KIND && o.status === 'active') work(doctrine, book, world, db, o, day, effects);
  for (const p of powers) decayProgress(book, world, db, p, day);
  for (const p of powers) select(doctrine, book, world, db, p, day, effects, ctx);
  for (const o of db.objectives) if (o.kind === KIND && o.status !== 'active' && o.phase === 'withdraw' && !forceHulls(book, o).some((h) => h.opId === o.id && h.status !== 'lost')) setPhase(o, 'resolved', day);
}
// The doctrine switched off: every live objective gets its own closure record (result cancelled, history,
// cooldown); hulls standing are let go; one in warp is let go where its journey ends (the kind's own check).
export function releaseBorg(book, db, day, reason) {
  const bb = borgBook(db);
  for (const o of db.objectives || []) {
    if (o.status !== 'active' || o.kind !== KIND) continue;
    o.result = { result: 'cancelled', reason, day }; o.phase = 'resolved'; (o.phaseHistory ||= []).push({ day, phase: 'resolved' });
    bb.history.push({ objectiveId: o.id, targetKind: o.targetKind, target: o.target.vid, targetPolity: o.target.polity, result: 'cancelled', reason, startDay: o.startDay, endDay: day, days: day - o.startDay, engagements: o.engagements, mode: o.movement?.mode, force: o.force.map((x) => x.vid) });
    for (const x of o.force) { const h = hullOf(book, o.polity, x.hullId); if (h && h.opId === o.id && !h.transit) { h.opId = null; if (h.status === 'assigned') h.status = 'ready'; } }
  }
}
// The debug view (§22).
export function borgDebug(book, world) {
  const db = book.doctrine || {};
  const bb = borgBook(db);
  const cfg = db.config ? cfgOf(db) : B.BORG_DEFAULTS;
  const day = db.lastDay ?? book.day ?? 0;
  const objectives = (db.objectives || []).filter((o) => o.kind === KIND).slice(-12).reverse().map((o) => {
    const fh = forceHulls(book, o);
    const lead = fh.find((h) => h.status !== 'lost') || null;
    const trAny = lead?.transit ? C.journeyById(book, lead.transit.journeyId) : null;
    const tr = trAny && trAny.ref === o.id ? trAny : null;
    const dest = o.targetKind === 'world' ? Number(o.target.systemIndex) : Number(o.lastKnown.systemIndex);
    let conv = null, tw = null, why = null;
    if (o.status === 'active' && lead && !lead.transit) { // in a conduit or on a leg, the plan it set out on stands
      const from = lead.transit ? Number(lead.transit.to) : Number(lead.systemIndex);
      const mv = planMovement(book, world, db, o.polity, fh.filter((h) => C.hullCanTravel(h)), from, dest, o.why.score, day);
      conv = mv.conventionalDays; tw = mv.transwarpDays; why = `${mv.mode}: ${mv.reason}`;
    }
    const rec = o.targetKind === 'world' ? bb.progress[o.target.systemIndex] || null : null;
    return { id: o.id, polity: o.polity, force: fh.map((h) => ({ vid: vidOf(h), shipId: h.shipId, at: h.transit ? `→${h.transit.to}` : h.systemIndex, hull: Math.round((h.hull / Math.max(1, h.maxHull)) * 100), status: h.status, transwarp: C.transwarpCapable(world, h), lastExit: h.transwarpLastExitDay ?? null })),
      targetKind: o.targetKind, target: o.target, value: o.value, why: o.why, phase: o.phase, status: o.status, progress: o.progress, worldProgress: rec,
      movement: o.movement, plannedNow: { conventionalDays: conv, transwarpDays: tw, choice: why },
      journey: tr ? { id: tr.id, mode: tr.mode || 'conventional', path: tr.path, legIndex: tr.legIndex, etaDay: tr.etaDay, entry: tr.transwarp?.entry ?? null, exit: tr.transwarp?.exit ?? null } : null,
      handoff: o.handoff, lastEngagement: o.lastEngagement || null, result: o.result, lastKnown: o.lastKnown, actions: o.actions.slice(-6) };
  });
  const hulls = Object.entries(book.polities).flatMap(([pid, p]) => (p.hulls || []).filter((h) => h.assimilated).map((h) => ({ owner: pid, vid: vidOf(h), shipId: h.shipId, hull: Math.round(h.hull), maxHull: h.maxHull, status: h.status, at: h.systemIndex, assimilated: h.assimilated, origin: h.identity?.origin?.builder ?? null })));
  return { day, scale: bb.scale, medianLegDays: bb.medianLegDays, objectives, assimilatedHulls: hulls, assimilatedWorlds: bb.assimilatedWorlds.slice(-10).reverse(), progress: Object.values(bb.progress), transwarp: { ...bb.transwarp, log: bb.transwarp.log.slice(-8).reverse() },
    selections: Object.fromEntries(Object.entries(bb.selections).map(([p, l]) => [p, l.slice(-3).reverse()])), history: bb.history.slice(-10).reverse(), incursions: bb.incursions.slice(-8).reverse(),
    rules: { transwarpDays: cfg.transwarpDays, transwarpCooldownDays: cfg.transwarpCooldownDays, transwarpMinScore: cfg.transwarpMinScore, transwarpMinSavingDays: cfg.transwarpMinSavingDays, transwarpMinCondition: cfg.transwarpMinCondition },
    stats: Object.fromEntries(Object.entries(db.stats || {}).filter(([k]) => /^borg/.test(k))) };
}
export function borgSummary(book) {
  const db = book.doctrine || {};
  const bb = borgBook(db);
  return { objectives: (db.objectives || []).filter((o) => o.kind === KIND), contacts: bb.contacts, worlds: bb.worlds, history: bb.history, cooldowns: bb.cooldowns, selections: bb.selections, progress: bb.progress,
    assimilatedHulls: bb.assimilatedHulls, assimilatedWorlds: bb.assimilatedWorlds, transwarp: bb.transwarp, incursions: bb.incursions, stats: Object.fromEntries(Object.entries(db.stats || {}).filter(([k]) => /^borg/.test(k))) };
}
