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
import * as Identity from './vessel-identity.mjs';

const KIND = 'assimilation';
const r2 = (x) => Math.round(x * 100) / 100;
const vidOf = (h) => h?.identity?.vid || h?.vid || h?.id || null;

export function borgBook(db) {
  const b = (db.borg ||= {});
  for (const k of ['contacts', 'worlds', 'cooldowns', 'selections', 'progress', 'evalDay', 'cover']) b[k] ||= {};
  b.history ||= []; b.assimilatedHulls ||= []; b.assimilatedWorlds ||= []; b.incursions ||= []; b.captainAssimilations ||= []; b.recoveries ||= [];
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
function coverOf(book, world, power, day) {
  const cover = new Map();
  for (const h of book.polities[power]?.hulls || []) { if (h.status === 'lost') continue; const s = standingAt(book, h, day); if (s != null) cover.set(s, 'direct'); }
  for (const s of world.systems) if (s.controller === power) for (const i of [Number(s.index), ...world.neighbours(s.index).map(Number)]) if (!cover.has(i)) cover.set(i, 'border');
  return cover;
}
// CAPTAIN-BORG-ASSIMILATION §1: the captain's personal vessel, seen exactly as any vessel is — only where a Borg
// sensor covers him, through the same contact fields and the same strength rule (his own hull; his escorts are his
// fleet, not targets). A class with a cloak is not seen at border range (the vessel rule); an active cloak hides
// him from every Borg sensor. Nothing else is read: no omniscient track, no bias. Returns the contact or null.
function recordCaptainContact(book, world, db, power, cap, at, day, source) {
  if (!cap || !cap.vid || cap.shipId == null || source == null) return null;
  const st = world.shipStats(Number(cap.shipId)) || {};
  if (cap.cloaked) return null;
  if (source === 'border' && st.cloak) return null;
  const contacts = (borgBook(db).contacts[power] ||= {});
  const prev = contacts[cap.vid];
  if (prev && prev.day > day) return prev;
  const close = source === 'direct';
  const frac = Math.max(0, Math.min(1, Number(cap.hullFrac ?? 1)));
  contacts[cap.vid] = { key: cap.vid, vid: cap.vid, kind: 'captain', hullId: null, polity: 'player', shipId: Number(cap.shipId), price: Number(st.price) || 0, mass: Number(st.mass) || 1, category: st.category || null, cloak: Boolean(st.cloak),
    strength: r2(observedStrength(book, world, cap.shipId, close ? frac : 1)), hullFrac: close ? r2(frac) : null, subdued: close ? Boolean(cap.disabled) : null, speed: Number(cap.speed) || C.hullSpeed(world, { shipId: cap.shipId }),
    systemIndex: Number(at), day, source, heading: cap.heading ?? null, firstSeenDay: prev?.firstSeenDay ?? day, sightings: (prev?.sightings || 0) + 1 };
  return contacts[cap.vid];
}
function observe(book, world, db, power, day) {
  const bb = borgBook(db);
  const cfg = cfgOf(db);
  const contacts = (bb.contacts[power] ||= {});
  const worlds = (bb.worlds[power] ||= {});
  const cover = coverOf(book, world, power, day);
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
  // The captain standing in a covered system today (in warp he stands nowhere: he is seen at his crossings instead).
  const cap = world.captain;
  if (cap && !cap.moving && cap.vid && db.config.borg?.captain !== false && cover.has(Number(cap.systemIndex))) recordCaptainContact(book, world, db, power, cap, Number(cap.systemIndex), day, cover.get(Number(cap.systemIndex)));
  // A hull now the Collective's own is no longer a contact (it is known as itself).
  for (const [k, c] of Object.entries(contacts)) if (c.hullId != null && (book.polities[power]?.hulls || []).some((h) => h.id === c.hullId)) delete contacts[k];
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
  // The captain's vessel is one more ship contact: the same value, the same score, the same rejections (§1, R4–R5).
  for (const c of contacts.filter((x) => (x.kind === 'captain' ? db.config.borg?.captain !== false : db.config.borg?.ships !== false))) {
    const value = B.shipValue({ price: c.price, mass: c.mass, category: c.category, cloak: c.cloak, rare: shipCounts[c.shipId] === 1 }, cfg);
    // One objective per target; the captain is one target whatever vessel he flies.
    const duplicate = live.some((o) => (c.kind === 'captain' ? o.targetKind === 'captain' : o.targetKind === 'ship' && o.target.vid === c.vid));
    const base = { kind: 'ship', value, targetStrength: c.strength, borgStrength: av.strength || 1, source: c.source, ageDays: day - c.day, cooldownUntil: bb.cooldowns[`${power}|${c.vid}`] ?? null, day, duplicate };
    const prelim = B.scoreTarget({ ...base, reachDays: 0 }, cfg);
    const { reachDays, movement } = reachOf(c.systemIndex, prelim.score);
    const s = B.scoreTarget({ ...base, reachDays }, cfg);
    cands.push({ kind: c.kind === 'captain' ? 'captain' : 'ship', vid: c.vid, hullId: c.hullId, polity: c.polity, shipId: c.shipId, seen: { system: c.systemIndex, day: c.day, source: c.source }, targetStrength: c.strength, value, reachDays, movement, ...s });
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
  const c = pick.kind === 'ship' || pick.kind === 'captain' ? borgBook(db).contacts[power][pick.vid] : null;
  const w = pick.kind === 'world' ? borgBook(db).worlds[power][pick.systemIndex] : null;
  const targetSystem = pick.kind === 'world' ? pick.systemIndex : c.systemIndex;
  const o = { id, kind: KIND, template: 'assimilation', clock: 'strategic_jumps', actor: `command:${power}`, polity: power, profileId: power, role, response: 'assimilate', incidentId: null,
    targetKind: pick.kind,
    target: pick.kind === 'ship' || pick.kind === 'captain'
      ? { vid: c.vid, hullId: c.hullId, polity: c.polity, shipId: c.shipId, ...(pick.kind === 'captain' ? { captain: true } : {}), known: { price: c.price, mass: c.mass, category: c.category, cloak: c.cloak, strength: c.strength, hullFrac: c.hullFrac, seenAt: c.systemIndex, seenDay: c.day, source: c.source } }
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
  bumpStat(db, 'borgObjectivesOpened'); bumpStat(db, pick.kind === 'world' ? 'borgWorldTargets' : pick.kind === 'captain' ? 'borgCaptainTargets' : 'borgShipTargets');
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
  if (o.targetKind === 'captain') return workCaptain(book, world, db, o, { alive, able, borgStrength, lead, here }, day, effects, cfg);
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
// CAPTAIN-BORG-ASSIMILATION §2: the same pursuit as any vessel — the Collective's own hulls, the same movement
// (conventional or transwarp by the accepted rules), the same knowledge budget. Contact is where the force and the
// captain stand in one system on one day: one encounter, always his scene (he is where he is). Nothing about him is
// decided off-scene: no strategic damage, no strategic assimilation.
function workCaptain(book, world, db, o, f, day, effects, cfg) {
  const bb = borgBook(db);
  const contact = bb.contacts[o.polity]?.[o.target.vid] || null;
  if (contact && contact.day > o.lastKnown.day) { o.lastKnown = { systemIndex: contact.systemIndex, day: contact.day, source: contact.source, heading: contact.heading }; o.lostSince = null; }
  const fresh = contact && day - contact.day <= cfg.trackDays;
  if (!fresh && o.lostSince == null) { o.lostSince = day; o.actions.push({ day, action: 'lost_contact', detail: `last seen at ${o.lastKnown.systemIndex} on day ${o.lastKnown.day}` }); effects.push({ type: 'borgAssimilation', event: 'contact_lost', id: o.id, polity: o.polity, captain: true, systemIndex: o.lastKnown.systemIndex, day }); }
  const targetGone = o.lostSince != null && day - o.lostSince > cfg.searchDays ? 'contact lost beyond the search budget' : (o.lastKnown && day - o.lastKnown.day > cfg.staleDays ? 'knowledge too stale' : null);
  const end = B.borgTermination({ day, startDay: o.startDay, budgetDays: o.budgetDays, borgAlive: f.alive.length > 0, borgAble: f.able.length > 0, targetDestroyed: false, targetGone,
    inaccessible: o.blocked && day - o.blocked.since > cfg.searchDays ? `no way there: ${o.blocked.reason}` : null, cancelled: o.cancelRequested || null }, cfg);
  if (end) return closeObjective(book, world, db, o, end.result, end.reason, day, effects);
  const at = Number(o.lastKnown.systemIndex);
  const cap = world.captain;
  const captainHere = Boolean(cap && !cap.moving && cap.vid === o.target.vid && Number(cap.systemIndex) === at);
  if (f.here === at && captainHere && fresh) {
    if (o.tacticalDay !== day) return engageCaptain(book, world, db, o, at, day, effects);
    return;
  }
  const dest = fresh ? (contact.heading ?? contact.systemIndex) : (o.lastKnown.heading ?? o.lastKnown.systemIndex);
  const lt = f.lead?.transit;
  setPhase(o, lt && Number(lt.to) === Number(dest) ? 'intercept' : 'approach', day);
  moveForce(book, world, db, o, dest, day, effects);
}
// The captain's contact: one encounter, his own scene (§3, R8). The force's hulls are its participants; he is not a
// model hull (the scene holds him). The assimilation itself is run by the scene (captainAssimilationTick).
function engageCaptain(book, world, db, o, at, day, effects) {
  o.engagements++; o.tacticalDay = day;
  setPhase(o, 'disable', day);
  const borg = forceHulls(book, o).filter((h) => C.hullCanTravel(h) && standingAt(book, h, day) === Number(at) && !h.encounterId);
  if (!borg.length) return null;
  const { enc } = SE.openEncounter(book, { key: `assim:${o.id}:${day}:e${o.engagements}`, system: Number(at), type: KIND, objective: { kind: KIND, ref: o.id }, authority: { kind: KIND, source: 'borg_doctrine' },
    sides: { a: o.polity, b: 'player' }, captain: true, playerHostile: true, reason: 'the Borg intercept the captain to disable his ship',
    contact: { objectiveId: o.id, targetKind: 'captain', captainVid: o.target.vid, engagement: o.engagements },
    participants: borg.map((h) => ({ hullId: h.id, polity: o.polity, side: 'borg', record: h })) }, day, C.encounterHullLookup(book));
  o.encounterId = enc.id;
  o.progress = { value: 0, startDay: null, state: 'attempting', lastDay: null };
  o.actions.push({ day, action: 'engage', detail: `contact with the captain at ${at} (engagement ${o.engagements})` });
  o.handoff = { encounterId: enc.id, status: enc.status, captainScene: true };
  effects.push({ type: 'borgAssimilation', event: 'engaged', id: o.id, polity: o.polity, targetKind: 'captain', systemIndex: Number(at), encounterId: enc.id, captainScene: true, day });
  return enc;
}
// The captain's scene, frame by frame (§4): the progress record is the objective's own, so it is saved with the
// campaign and survives a reload. `s` = { dtMs, subdued, assimilatorPresent, borgAlive }. Returns the step and the
// stage reached (for the captain's few lines).
export function captainAssimilationTick(book, objectiveId, s) {
  const db = book.doctrine; const o = db?.objectives?.find((x) => x.id === objectiveId);
  if (!o || o.status !== 'active' || o.targetKind !== 'captain') return null;
  const cfg = cfgOf(db);
  const before = Number(o.progress?.value) || 0;
  const step = B.captainProgressStep({ progress: before, dtMs: s.dtMs, subdued: s.subdued, assimilatorPresent: s.assimilatorPresent, borgAlive: s.borgAlive }, cfg);
  const day = db.lastDay ?? book.day ?? null;
  if (step.state === 'assimilating' && before === 0) { setPhase(o, 'assimilate', day); o.progress.startDay = day; o.actions.push({ day, action: 'assimilate', detail: 'the captain is subdued: assimilation begins' }); bumpStat(db, 'borgCaptainAssimilationsBegun'); }
  if (step.state === 'attempting' && before > 0) { setPhase(o, 'disable', day); o.actions.push({ day, action: 'interrupted', detail: step.reason }); bumpStat(db, 'borgCaptainAssimilationsReset'); }
  o.progress = { ...o.progress, value: step.progress, state: step.state, reason: step.reason };
  return { ...step, before, stage: B.captainStage(step.progress, cfg), stageBefore: B.captainStage(before, cfg) };
}
// The terminal result (§7): the run ends; the record says how. Nothing is transferred to anyone.
function completeCaptain(book, world, db, o, enc, day, effects) {
  const bb = borgBook(db);
  o.progress = { ...o.progress, value: 1, state: 'completed' };
  const force = enc.participants.filter((p) => p.side === 'borg').map((p) => p.vid);
  bb.captainAssimilations.push({ objectiveId: o.id, encounterId: enc.id, captainVid: o.target.vid, shipId: o.target.shipId, systemIndex: Number(enc.system), day, force, result: 'captain_assimilated' });
  if (bb.captainAssimilations.length > 10) bb.captainAssimilations = bb.captainAssimilations.slice(-10);
  bumpStat(db, 'borgCaptainAssimilations');
  effects.push({ type: 'borgAssimilation', event: 'captain_assimilated', id: o.id, polity: o.polity, captainVid: o.target.vid, shipId: o.target.shipId, systemIndex: Number(enc.system), encounterId: enc.id, force, day });
  return closeObjective(book, world, db, o, 'target_assimilated', 'the captain was assimilated', day, effects);
}
// The captain crossing a system on his course (§1, §2): a Borg power whose sensors cover it marks him there (the
// vessel rules above); a captain objective whose force stands there intercepts him — one encounter, his scene, the
// course stops. Returns the encounter or null.
export function borgAtCaptainCrossing(book, world, at, day, captain, effects = []) {
  const db = book.doctrine;
  if (!db || db.config?.enabled === false || !captain?.vid) return null;
  const powers = powersOf(book, db);
  if (!powers.length) return null;
  for (const p of powers) {
    if (db.config.borg?.captain === false) continue;
    const cover = coverOf(book, world, p, day);
    if (cover.has(Number(at))) recordCaptainContact(book, world, db, p, { ...captain, disabled: false }, Number(at), day, cover.get(Number(at)));
  }
  for (const o of db.objectives || []) {
    if (o.kind !== KIND || o.status !== 'active' || o.targetKind !== 'captain' || o.target.vid !== captain.vid || o.encounterId || o.tacticalDay === day) continue;
    const there = forceHulls(book, o).filter((h) => C.hullCanTravel(h) && standingAt(book, h, day) === Number(at));
    if (!there.length) continue;
    o.lastKnown = { systemIndex: Number(at), day, source: 'contact', heading: captain.heading ?? null }; o.lostSince = null;
    return engageCaptain(book, world, db, o, Number(at), day, effects);
  }
  return null;
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
  if (o.targetKind === 'captain') {
    const oc = result?.outcome || 'fought';
    if (oc === 'borg_beaten') return closeObjective(book, world, db, o, 'borg_disabled', 'the Borg force is out of the fight', day, effects);
    if (oc === 'captain_assimilated') return completeCaptain(book, world, db, o, enc, day, effects);
    if (oc === 'target_destroyed') return closeObjective(book, world, db, o, 'target_destroyed', 'the captain\'s ship was destroyed', day, effects);
    if (oc === 'escaped') return closeObjective(book, world, db, o, 'target_escaped', result?.note || 'the captain escaped', day, effects);
    if (oc === 'borg_withdrew') return closeObjective(book, world, db, o, 'abandoned', result?.note || 'the Borg withdrew', day, effects);
    // Not subdued in the window (or no scene could be made: nothing is fought off-scene for him): it goes on.
    o.progress = { value: 0, startDay: null, state: null, lastDay: null };
    if (o.engagements >= cfgOf(db).maxEngagements) return closeObjective(book, world, db, o, 'abandoned', 'the captain could not be subdued', day, effects);
    setPhase(o, 'approach', day);
    return { continuation: 'the captain still resists' };
  }
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
    // The captain's contact with no scene: nothing is fought, damaged or assimilated off-scene for him (R9).
    if (o.targetKind === 'captain') return applyEngagement(book, world, db, o, enc, { outcome: 'disengaged', strategic: true, note: 'no scene' }, day, effects);
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
  if (o.targetKind === 'captain') bumpStat(db, success ? 'borgCaptainClosedAssimilated' : result === 'target_escaped' ? 'borgCaptainEscapes' : result === 'borg_destroyed' || result === 'borg_disabled' ? 'borgCaptainBorgDefeats' : result === 'target_destroyed' ? 'borgCaptainDestroyed' : 'borgCaptainAbandoned');
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
  // BORG-HULK-REGENERATION: after selection, so a free cube goes after a target before it goes after a hulk.
  for (const p of powers) { advanceRegeneration(book, world, db, p, day, effects); advanceHulkRecoveries(book, world, db, p, day, effects); }
  for (const o of db.objectives) if (o.kind === KIND && o.status !== 'active' && o.phase === 'withdraw' && !forceHulls(book, o).some((h) => h.opId === o.id && h.status !== 'lost')) setPhase(o, 'resolved', day);
}
// ---------- hulk recovery and regeneration (BORG-HULK-REGENERATION) ----------
// An assimilated hulk lies where it was taken until the Collective itself brings it in. No yard: a recovery-capable
// Borg vessel (class data `borgRecovery`) flies out on the shared tow mission (campaign-strategy.mjs: real journeys,
// crossings, blockades, the tow penalty, the hulk let go where a tug is lost), tows it — conventionally, always — to
// a Borg node (an origin world, or an assimilated world once stabilized), and the node regenerates it over campaign
// days to the operating threshold. The same hull record throughout: same vid, class, origin, assimilation, damage.
// Persistent objective, one per hulk:
//   recovery_pending → recovery_en_route → under_tow → at_borg_node → regenerating → operational
// ending hulk_operational | awaiting_drones | recovery_vessel_destroyed | hulk_destroyed | cancelled |
// no_reachable_node | abandoned.
const REC_END = Object.freeze(['hulk_operational', 'awaiting_drones', 'recovery_vessel_destroyed', 'hulk_destroyed', 'cancelled', 'no_reachable_node', 'abandoned']);
export const BORG_RECOVERY_PHASES = Object.freeze(['disabled_assimilated', 'recovery_pending', 'recovery_en_route', 'under_tow', 'at_borg_node', 'regenerating', 'operational', 'awaiting_drones', 'closed']);
function recoveries(db) { return borgBook(db).recoveries; }
function openRecoveryFor(db, hullId) { return recoveries(db).find((r) => !r.result && String(r.hullId) === String(hullId)) || null; }
function isRecoveryVessel(world, h) { return (world.shipStats(h.shipId) || {}).borgRecovery === true; }
function recNote(r, day, phase, note = '') {
  if (phase && r.phase !== phase) { r.phase = phase; r.history.push({ day: Number(day), phase, note }); if (r.history.length > 24) r.history = r.history.slice(-24); }
  else if (note && r.history[r.history.length - 1]?.note !== note) { r.history.push({ day: Number(day), phase: r.phase, note }); if (r.history.length > 24) r.history = r.history.slice(-24); }
}
// The node test for a system today (B.nodeEligibility), from the campaign's own records: who holds it, its origin,
// the day its assimilation completed (the newest such record).
function nodeAt(book, world, power, i, day = book.day) {
  const sys = world.systems[Number(i)];
  if (!sys) return { ok: false, reason: 'no such system' };
  const db = book.doctrine;
  const cfg = db?.config ? cfgOf(db) : B.BORG_DEFAULTS;
  const rec = db ? borgBook(db).assimilatedWorlds.filter((w) => Number(w.systemIndex) === Number(i)).slice(-1)[0] : null;
  return B.nodeEligibility({ controller: sys.controller, origin: sys.origin, power, assimilatedDay: rec ? rec.day : null, day, blockaded: C.applicableBlockadesAt(book, world, Number(i), power).length > 0 }, cfg);
}
// The Collective's recovery-node provider for the shared tow mission.
const NODE_PROVIDER = {
  nodeOk(book, world, i) { return nodeAt(book, world, 'borg', i, book.day).ok; },
  // Delivered: the node takes her in — no yard, no market, no repair queue. She regenerates from tomorrow.
  receive(book, world, rec, h, at, day, effects) {
    if (h.stranded) { h.stranded.systemIndex = at; h.stranded.recovery = 'at_borg_node'; h.stranded.recoverySince = day; h.stranded.recoveredBy = rec.inPlace ? `node:${at}` : `tow:${rec.id}`; if (h.stranded.crewSupportedBy) h.stranded.crewSupportedBy = 'node'; }
    h.borgRegen = { node: at, since: day, state: 'at_borg_node', startHull: Number(h.hull), recoveryId: rec.id, days: 0 };
    effects.push({ type: 'borgAssimilation', event: 'hulk_at_node', polity: rec.sponsor, hullId: h.id, vid: h.identity?.vid || h.id, systemIndex: at, day });
  },
  inNode(h) { return Boolean(h?.borgRegen); },
  // Out to the casualty: by conduit when the tug itself is transwarp-capable and the usual conduit rules allow it
  // (cooldown, condition, a worthwhile saving); otherwise the ordinary journey. Recorded on the mission.
  outbound(book, world, rec, group, tug, day) {
    const db = book.doctrine;
    if (!db?.config) return null;
    const cfg = cfgOf(db);
    const conventionalDays = C.plannedJourneyDays(world, Number(tug.systemIndex), Number(rec.targetSystem), rec.sponsor, C.hullsSpeed(world, group));
    const capable = C.transwarpCapable(world, tug);
    const refusal = capable ? C.transwarpRefusal(world, [tug], day, { cooldownDays: cfg.transwarpCooldownDays, minCondition: cfg.transwarpMinCondition }) : 'no transwarp capability';
    const wait = tug.transwarpLastExitDay == null ? 0 : Number(tug.transwarpLastExitDay) + cfg.transwarpCooldownDays - Number(day);
    const m = cfg.recoveryTranswarp === false ? { mode: 'conventional', transwarpDays: null, conventionalDays, reason: 'the objective does not permit a conduit' }
      : B.chooseMovement({ capable, offCooldown: !/cooldown/.test(refusal || ''), conditionOk: !/damaged/.test(refusal || ''), score: 1, conventionalDays, cooldownRemaining: wait }, cfg);
    const mode = m.mode === 'transwarp' ? 'transwarp' : 'conventional';
    rec.borgMovement = { mode, conventionalDays, transwarpDays: capable ? cfg.transwarpDays : null, reason: m.mode === 'hold' ? `conventional (no waiting for a conduit on a recovery): ${m.reason}` : m.reason, refusal, tug: vidOf(tug), day: Number(day) };
    if (mode !== 'transwarp') return null;
    const bb = borgBook(db);
    bb.transwarp.uses++; bumpStat(db, 'borgTranswarpUses'); bumpStat(db, 'borgRecoveryTranswarps');
    bb.transwarp.log.push({ day: Number(day), objectiveId: rec.id, recovery: true, from: Number(tug.systemIndex), to: Number(rec.targetSystem), conventionalDays, transwarpDays: cfg.transwarpDays, etaDay: Number(day) + cfg.transwarpDays, hulls: [vidOf(tug)] });
    if (bb.transwarp.log.length > 30) bb.transwarp.log = bb.transwarp.log.slice(-30);
    return { hulls: [tug], spec: { mode: 'transwarp', transwarp: { days: cfg.transwarpDays, cooldownDays: cfg.transwarpCooldownDays, minCondition: cfg.transwarpMinCondition, conventionalDays } } };
  },
  // The shared record's after-delivery phases, read off the Borg lifecycle (never a yard's).
  afterPhase(book, h, rec) {
    if (!h) return 'lost_after_delivery';
    if (h.borgRegen?.state === 'awaiting_drones') return 'recrew_if_required';
    if (h.borgRegen) return h.borgRegen.state === 'regenerating' ? 'repairing' : 'in_yard';
    if (!C.hullIsDisabled(h) && h.status !== 'lost') return 'complete';
    return 'left_yard';
  },
};
C.registerRecoveryNodes('borg', NODE_PROVIDER);
// The Collective lets a hulk go (attempts or time spent, no node it can reach): written off as any owner writes one
// off — off its books, the wreck where it lies, salvageable under the ordinary rules, its identity and its
// assimilation on record.
function abandonHulk(book, power, h, day, reason, effects) {
  if (!h || h.status === 'lost') return false;
  const p = book.polities[power];
  h.status = 'lost'; h.fate = 'written_off'; h.opId = null;
  delete h.borgRegen; delete h.recoveryClaim;
  h.derelict = { since: Number(day), systemIndex: Number(h.systemIndex), abandonedBy: power, until: Number(day) + (book.config.derelictLifeDays ?? 365), reason };
  if (h.identity) Identity.recordProvenance(h.identity, { day, event: 'abandoned', from: power, to: null, systemIndex: h.systemIndex });
  if (p) p.lostHulls = (p.lostHulls || 0) + 1;
  book.stats.hullsLost = (book.stats.hullsLost || 0) + 1; book.stats.hullsWrittenOff = (book.stats.hullsWrittenOff || 0) + 1;
  effects.push({ type: 'strandedWrittenOff', polityId: power, hullId: h.id, vid: h.identity?.vid || h.id, systemIndex: Number(h.systemIndex), day, borg: true });
  return true;
}
// Regeneration: every Borg hull a node has taken in gains its share each day while it lies at a valid node; at the
// operating threshold it is back in service — or, with no crew to run it, waits for drones (none are made this round).
function advanceRegeneration(book, world, db, power, day, effects) {
  const cfg = cfgOf(db);
  for (const h of book.polities[power]?.hulls || []) {
    const g = h.borgRegen;
    if (!g || h.status === 'lost' || g.state === 'awaiting_drones' || g.lastDay === day) continue;
    const atNode = !h.transit && !h.encounterId && Number(h.systemIndex) === Number(g.node) && nodeAt(book, world, power, g.node, day).ok;
    if (g.state === 'at_borg_node' && Number(day) <= Number(g.since)) continue; // taken in today: from tomorrow
    const step = B.regenStep({ hull: h.hull, maxHull: h.maxHull, atNode }, cfg);
    g.lastDay = day;
    if (!atNode) { g.held = (g.held || 0) + 1; continue; }
    if (g.state === 'at_borg_node') { g.state = 'regenerating'; g.startDay = day; g.startHull = Number(h.hull); effects.push({ type: 'borgAssimilation', event: 'hulk_regenerating', polity: power, hullId: h.id, vid: vidOf(h), systemIndex: Number(g.node), day }); }
    h.hull = step.hull; g.days = (g.days || 0) + 1;
    if (h.status === 'ready' || h.status === 'assigned') h.status = 'repairing';
    if (!step.reached) continue;
    const min = book.config.minOperatingCrew ?? 0.5;
    if (h.recrew || Number(h.crew ?? 0) < min) { g.state = 'awaiting_drones'; g.endDay = day; bumpStat(db, 'borgHulksAwaitingDrones'); continue; }
    // Back in service under the Collective: the same hull, structurally sound enough to sail and fight.
    g.state = 'operational'; g.endDay = day;
    delete h.stranded; delete h.recrew;
    h.status = 'ready';
    h.regenerated = { day: Number(day), node: Number(g.node), days: g.days, from: g.startHull };
    delete h.borgRegen;
    bumpStat(db, 'borgHulksReturned');
    effects.push({ type: 'borgAssimilation', event: 'hulk_operational', polity: power, hullId: h.id, vid: vidOf(h), systemIndex: Number(g.node), day, regenDays: g.days });
  }
}
// The free vessels able to recover a hulk now: recovery-capable class data, whole enough, on no other job.
function freeRecoveryVessels(book, world, db, power, day) {
  const cfg = cfgOf(db);
  return (book.polities[power]?.hulls || []).filter((h) => h.status === 'ready' && !h.opId && !h.transit && !h.encounterId && C.hullCanTravel(h) && isRecoveryVessel(world, h) && h.hull >= h.maxHull * cfg.readyThreshold
    && !(h.borgRecoveryRestUntil != null && Number(day) < Number(h.borgRecoveryRestUntil)))
    .sort((a, b) => String(a.id).localeCompare(String(b.id)));
}
// The recovery vessel's duty bound: after a recovery it takes no other for as long again (× (1 − share) / share), so
// at most `recoveryDutyShare` of its days go to recoveries. Assimilation is not affected: it is free for that.
function restRecoveryVessel(book, db, r, day) {
  if (r.tugRested || !r.tug || r.dispatchDay == null) return;
  r.tugRested = true;
  const cfg = cfgOf(db);
  const tug = (book.polities[r.power]?.hulls || []).find((x) => String(x.id) === String(r.tug.hullId));
  if (!tug || tug.status === 'lost') return;
  const share = Math.min(1, Math.max(0.05, Number(cfg.recoveryDutyShare) || 0.5));
  const spent = Math.max(0, Number(day) - Number(r.dispatchDay));
  tug.borgRecoveryRestUntil = Number(day) + Math.ceil(spent * (1 - share) / share);
}
function endRecovery(book, db, r, result, reason, day, effects) {
  if (r.result) return;
  r.result = { result, reason, day: Number(day) };
  recNote(r, day, result === 'hulk_operational' ? 'operational' : result === 'awaiting_drones' ? 'awaiting_drones' : 'closed', `${result}: ${reason}`);
  bumpStat(db, { hulk_operational: 'borgRecoveriesCompleted', awaiting_drones: 'borgRecoveriesAwaitingDrones', recovery_vessel_destroyed: 'borgRecoveryVesselLosses', hulk_destroyed: 'borgRecoveryHulksDestroyed',
    cancelled: 'borgRecoveriesCancelled', no_reachable_node: 'borgRecoveriesNoNode', abandoned: 'borgRecoveriesAbandoned' }[result] || 'borgRecoveriesOther');
  effects.push({ type: 'borgAssimilation', event: 'recovery_closed', id: r.id, polity: r.power, hullId: r.hullId, vid: r.vid, result, systemIndex: r.at ?? null, day });
}
function advanceHulkRecoveries(book, world, db, power, day, effects) {
  const cfg = cfgOf(db);
  const bb = borgBook(db);
  if (db.config.borg?.recovery === false) return;
  const hulls = book.polities[power]?.hulls || [];
  // Open: every assimilated hulk lying disabled with its crew (drones) aboard, one objective each, its own pending
  // budget running from today (the missions under way are what is limited). A crewless one is
  // left as it is (no drone source this round: the ordinary write-off of a crewless hulk applies).
  for (const h of hulls) {
    if (!h.assimilated || h.status === 'lost' || !C.hullIsDisabled(h) || h.transit || h.encounterId || h.borgRegen || h.towedBy || openRecoveryFor(db, h.id)) continue;
    if (h.stranded?.crew !== 'assimilated') continue;
    if (Number(h.borgRecoveryAttempts || 0) >= cfg.recoveryMaxAttempts) continue;
    if (h.borgRecoveryCooldown != null && Number(day) < Number(h.borgRecoveryCooldown)) continue;
    const r = { id: `${book.seed}:borg-recovery:${(bb.recoveryCounter = (bb.recoveryCounter || 0) + 1)}`, power, hullId: h.id, vid: vidOf(h), shipId: Number(h.shipId), origin: h.identity?.origin?.builder ?? h.assimilated.from,
      from: h.assimilated.from, assimilatedDay: h.assimilated.day, createdDay: Number(day), pendingSince: Number(day), at: Number(h.systemIndex), phase: 'disabled_assimilated', attempts: Number(h.borgRecoveryAttempts || 0),
      missionId: null, missions: [], tug: null, movement: null, node: null, route: null, tow: null, regen: null, waitReason: null, noNodeSince: null, result: null, history: [{ day: Number(day), phase: 'disabled_assimilated', note: `stranded at ${h.systemIndex}` }] };
    recNote(r, day, 'recovery_pending', 'awaiting a recovery vessel and a node');
    recoveries(db).push(r);
    bumpStat(db, 'borgRecoveriesOpened');
  }
  for (const r of recoveries(db)) {
    if (r.result || r.power !== power) continue;
    const h = hulls.find((x) => String(x.id) === String(r.hullId)) || null;
    if (!h || h.status === 'lost') { endRecovery(book, db, r, 'hulk_destroyed', h ? `the hulk is ${h.fate || 'lost'}` : 'the hulk is no longer the Collective\'s', day, effects); continue; }
    r.at = Number(h.systemIndex);
    // Taken in by a node: the regeneration (advanceRegeneration) decides the rest.
    if (h.borgRegen) {
      restRecoveryVessel(book, db, r, day);
      const g = h.borgRegen;
      r.node = Number(g.node); r.regen = { state: g.state, since: g.since, startDay: g.startDay ?? null, startHull: g.startHull, hull: Math.round(h.hull), target: Math.round(h.maxHull * cfg.regenTargetShare), progress: r2(Math.min(1, (h.hull - g.startHull) / Math.max(1, h.maxHull * cfg.regenTargetShare - g.startHull))), days: g.days || 0 };
      recNote(r, day, g.state === 'at_borg_node' ? 'at_borg_node' : 'regenerating');
      if (g.state === 'awaiting_drones') endRecovery(book, db, r, 'awaiting_drones', 'regenerated, but no crew to run her (no drone source this round)', day, effects);
      continue;
    }
    if (h.regenerated && !C.hullIsDisabled(h)) {
      r.regen = { ...(r.regen || {}), state: 'operational', hull: Math.round(h.hull), progress: 1, days: h.regenerated.days, endDay: h.regenerated.day };
      endRecovery(book, db, r, 'hulk_operational', `back in service at ${h.regenerated.node} after ${h.regenerated.days} days of regeneration`, day, effects);
      continue;
    }
    const m = r.missionId ? C.hullRecoveryById(book, r.missionId) : null;
    if (m) {
      r.tug = m.tug ? { hullId: m.tug.hullId, vid: m.tug.vid } : null; r.node = m.yard; r.movement = m.borgMovement || r.movement;
      r.route = { outbound: m.outbound ? { route: m.outbound.route, mode: m.outbound.mode, eta: m.outbound.eta } : null, inbound: m.inbound ? { route: m.inbound.route, towSpeed: m.inbound.towSpeed, eta: m.inbound.eta } : null };
      r.tow = { state: m.state, attached: m.attachment?.day ?? null, waiting: m.waitReason || null };
      if (['requested', 'assigned', 'en_route_to_hulk'].includes(m.state)) { recNote(r, day, 'recovery_en_route'); continue; }
      if (['on_scene', 'attached', 'towing'].includes(m.state)) { recNote(r, day, 'under_tow'); continue; }
      if (m.state === 'delivered_to_yard') continue; // the node has her (borgRegen) — handled above next day
      // The mission ended without delivering her: where she lies now is where she is.
      restRecoveryVessel(book, db, r, day);
      r.missionId = null;
      const tug = m.tug ? (book.polities[power]?.hulls || []).find((x) => x.id === m.tug.hullId) : null;
      const tugLost = !tug || tug.status === 'lost' || m.losses.some((l) => String(l.hullId) === String(m.tug?.hullId) && ['destroyed', 'disabled', 'lost', 'surrendered'].includes(l.reason));
      h.borgRecoveryAttempts = Number(h.borgRecoveryAttempts || 0) + 1; r.attempts = h.borgRecoveryAttempts;
      h.borgRecoveryCooldown = Number(day) + cfg.recoveryCooldownDays;
      if (tugLost) { endRecovery(book, db, r, 'recovery_vessel_destroyed', `${m.tug?.vid || 'the recovery vessel'} was lost (${m.reason}); the hulk lies at ${h.systemIndex}`, day, effects); continue; }
      if (r.attempts >= cfg.recoveryMaxAttempts) { abandonHulk(book, power, h, day, `recovery failed ${r.attempts} times`, effects); endRecovery(book, db, r, 'abandoned', `recovery failed ${r.attempts} times (${m.reason}): the hulk is abandoned where it lies`, day, effects); continue; }
      recNote(r, day, 'recovery_pending', `attempt ${r.attempts} ended: ${m.reason}`);
      r.pendingSince = Number(day);
      continue;
    }
    // Pending: bounded.
    if (Number(day) - Number(r.pendingSince) > cfg.recoveryPendingDays) { abandonHulk(book, power, h, day, 'no recovery within the pending budget', effects); endRecovery(book, db, r, 'abandoned', `no recovery for ${cfg.recoveryPendingDays} days (${r.waitReason || 'waiting'})`, day, effects); continue; }
    if (h.borgRecoveryCooldown != null && Number(day) < Number(h.borgRecoveryCooldown)) { r.waitReason = `cooldown until day ${h.borgRecoveryCooldown}`; continue; }
    if (h.transit || h.encounterId || h.towedBy || h.opId) { r.waitReason = 'the hulk is not lying free'; continue; }
    // Lying at a valid node already: the node takes it in where it lies — no vessel, no tow.
    if (nodeAt(book, world, power, h.systemIndex, day).ok) {
      NODE_PROVIDER.receive(book, world, { id: r.id, sponsor: power, inPlace: true }, h, Number(h.systemIndex), day, effects);
      r.node = Number(h.systemIndex); r.movement = { mode: 'none', reason: 'it lies at a Borg node' }; r.waitReason = null;
      bumpStat(db, 'borgRecoveriesInPlace');
      recNote(r, day, 'at_borg_node', `taken in where it lies (node ${h.systemIndex})`);
      continue;
    }
    // The shared AI tow switch (campaign config aiRecovery) governs the Collective's tows too.
    if (book.config.aiRecovery === false) { r.waitReason = 'AI tows are switched off (aiRecovery)'; recNote(r, day, 'recovery_pending', r.waitReason); continue; }
    const underway = recoveries(db).filter((x) => !x.result && x.power === power && x.missionId).length;
    if (underway >= cfg.recoveryMaxActive) { r.waitReason = `${underway} recoveries already under way`; recNote(r, day, 'recovery_pending', r.waitReason); continue; }
    const tugs = freeRecoveryVessels(book, world, db, power, day);
    if (!tugs.length) {
      const resting = (book.polities[power]?.hulls || []).filter((x) => x.status !== 'lost' && isRecoveryVessel(world, x) && x.borgRecoveryRestUntil != null && Number(day) < Number(x.borgRecoveryRestUntil) && !x.opId && !x.transit);
      if (resting.length) { r.waitReason = `the recovery vessel rests until day ${Math.min(...resting.map((x) => Number(x.borgRecoveryRestUntil)))} (recovery duty bound)`; recNote(r, day, 'recovery_pending', 'the recovery vessel rests (duty bound)'); continue; }
    }
    if (!tugs.length) { r.waitReason = 'no Borg recovery vessel free'; recNote(r, day, 'recovery_pending', r.waitReason); continue; }
    // The nearest able vessel with a plan that reaches the hulk and a node.
    let best = null, lastWhy = null;
    for (const t of tugs) {
      const plan = C.planHullRecovery(book, world, { sponsor: power, targetHullId: h.id, tugHullId: t.id }, day);
      if (!plan.ok) { lastWhy = plan.reason; continue; }
      const twOut = C.transwarpCapable(world, t) && cfg.recoveryTranswarp !== false ? Math.min(plan.outboundDays, cfg.transwarpDays) : plan.outboundDays;
      const eta = twOut + plan.towDays;
      if (!best || eta < best.eta) best = { t, plan, eta };
    }
    if (!best) {
      r.waitReason = lastWhy || 'no plan';
      if (/no yard|no route/.test(r.waitReason)) { r.noNodeSince ??= Number(day); if (Number(day) - r.noNodeSince > cfg.searchDays) { abandonHulk(book, power, h, day, 'no reachable Borg node', effects); endRecovery(book, db, r, 'no_reachable_node', `no Borg node a tow can reach for ${cfg.searchDays} days`, day, effects); } }
      recNote(r, day, 'recovery_pending', r.waitReason);
      continue;
    }
    // A node whose tow home alone is beyond the bounded tow is no node this hulk can reach (the same search budget);
    // a tug merely far away is a wait.
    if (best.plan.towDays > cfg.recoveryMaxTowDays) {
      r.waitReason = `no node within a ${cfg.recoveryMaxTowDays}-day tow (nearest ${best.plan.towDays} days)`;
      r.noNodeSince ??= Number(day);
      if (Number(day) - r.noNodeSince > cfg.searchDays) { abandonHulk(book, power, h, day, 'no reachable Borg node', effects); endRecovery(book, db, r, 'no_reachable_node', `no Borg node within a ${cfg.recoveryMaxTowDays}-day tow for ${cfg.searchDays} days`, day, effects); continue; }
      recNote(r, day, 'recovery_pending', r.waitReason); continue;
    }
    r.noNodeSince = null;
    if (best.eta > cfg.recoveryMaxTowDays) { r.waitReason = `too far (${best.eta} days out and back)`; recNote(r, day, 'recovery_pending', r.waitReason); continue; }
    const res = C.requestHullRecovery(book, world, { sponsor: power, targetHullId: h.id, tugHullId: best.t.id, yard: best.plan.yard, requestedBy: 'borg' }, day, effects);
    if (!res.ok) { r.waitReason = res.reason; continue; }
    r.missionId = res.record.id; r.missions.push(res.record.id); r.dispatchDay = Number(day); r.tugRested = false; r.tug = { hullId: best.t.id, vid: vidOf(best.t) }; r.node = res.record.yard; r.movement = res.record.borgMovement || { mode: 'conventional', reason: 'ordinary journey' };
    r.waitReason = null;
    bumpStat(db, 'borgRecoveryMissions');
    recNote(r, day, res.record.state === 'towing' || res.record.state === 'attached' ? 'under_tow' : res.record.state === 'delivered_to_yard' ? 'at_borg_node' : 'recovery_en_route', `${r.tug.vid} sent (${r.movement.mode}); node ${r.node}`);
  }
  // Closed records are history: the newest kept.
  const closed = recoveries(db).filter((r) => r.result);
  if (closed.length > 30) { const drop = new Set(closed.slice(0, closed.length - 30)); bb.recoveries = recoveries(db).filter((r) => !drop.has(r)); }
}

// The doctrine switched off: every live objective gets its own closure record (result cancelled, history,
// cooldown); hulls standing are let go; one in warp is let go where its journey ends (the kind's own check).
export function releaseBorg(book, db, day, reason) {
  const bb = borgBook(db);
  for (const r of bb.recoveries || []) {
    if (r.result) continue;
    const m = r.missionId ? C.hullRecoveryById(book, r.missionId) : null;
    if (m) C.cancelHullRecovery(book, null, m.id, day, [], `Borg recovery cancelled: ${reason}`);
    r.result = { result: 'cancelled', reason, day: Number(day) }; r.phase = 'closed';
  }
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
  return { day, scale: bb.scale, captain: captainDebug(book, world, db), captainAssimilations: bb.captainAssimilations.slice(-5).reverse(), hulkRecovery: hulkRecoveryDebug(book, world, db), medianLegDays: bb.medianLegDays, objectives, assimilatedHulls: hulls, assimilatedWorlds: bb.assimilatedWorlds.slice(-10).reverse(), progress: Object.values(bb.progress), transwarp: { ...bb.transwarp, log: bb.transwarp.log.slice(-8).reverse() },
    selections: Object.fromEntries(Object.entries(bb.selections).map(([p, l]) => [p, l.slice(-3).reverse()])), history: bb.history.slice(-10).reverse(), incursions: bb.incursions.slice(-8).reverse(),
    rules: { transwarpDays: cfg.transwarpDays, transwarpCooldownDays: cfg.transwarpCooldownDays, transwarpMinScore: cfg.transwarpMinScore, transwarpMinSavingDays: cfg.transwarpMinSavingDays, transwarpMinCondition: cfg.transwarpMinCondition },
    stats: Object.fromEntries(Object.entries(db.stats || {}).filter(([k]) => /^borg/.test(k))) };
}
// BORG-HULK-REGENERATION §15: every assimilated hulk the Collective holds (or held under a recovery) — vid, class, hull,
// where, recovery status, vessel, movement, tow, node, regeneration, ETA, result — and the nodes as they stand.
function hulkRecoveryDebug(book, world, db) {
  const bb = borgBook(db);
  const cfg = db.config ? cfgOf(db) : B.BORG_DEFAULTS;
  const power = powersOf(book, db)[0] || 'borg';
  const day = db.lastDay ?? book.day ?? 0;
  const recs = (bb.recoveries || []);
  const rows = [];
  const seen = new Set();
  const row = (h, r) => {
    const m = r?.missionId ? C.hullRecoveryById(book, r.missionId) : null;
    const lead = m?.tug ? (book.polities[power]?.hulls || []).find((x) => x.id === m.tug.hullId) : null;
    // The ETA is the mission's own journey's (out, or the tow home) — never a later journey of the same vessel.
    const trAny = lead?.transit && m && !r?.result ? C.journeyById(book, lead.transit.journeyId) : null;
    const tr = trAny && String(trAny.ref) === String(m.id) ? trAny : null;
    return { hullId: h?.id ?? r?.hullId, vid: h ? vidOf(h) : r?.vid, shipId: h?.shipId ?? r?.shipId, hull: h ? Math.round((h.hull / Math.max(1, h.maxHull)) * 100) : null, status: h?.status ?? 'gone',
      at: h ? (h.transit ? `→${h.transit.to}` : h.systemIndex) : r?.at, disabled: h ? C.hullIsDisabled(h) : null, origin: h?.identity?.origin?.builder ?? r?.origin ?? null, assimilatedFrom: h?.assimilated?.from ?? r?.from ?? null,
      recovery: r ? { id: r.id, phase: r.phase, attempts: r.attempts, waitReason: r.waitReason, result: r.result } : { phase: h?.borgRegen ? h.borgRegen.state : h?.regenerated ? 'operational' : (C.hullIsDisabled(h) ? 'disabled_assimilated' : 'operational') },
      vessel: r?.tug?.vid ?? m?.tug?.vid ?? null, movement: r?.movement ?? m?.borgMovement ?? null, tow: m ? { state: m.state, towSpeed: m.inbound?.towSpeed ?? null, route: m.inbound?.route ?? m.outbound?.route ?? null } : null,
      node: r?.node ?? h?.borgRegen?.node ?? h?.regenerated?.node ?? null, regen: h?.borgRegen ? { state: h.borgRegen.state, days: h.borgRegen.days || 0, progress: r2(Math.min(1, (h.hull - h.borgRegen.startHull) / Math.max(1, h.maxHull * cfg.regenTargetShare - h.borgRegen.startHull))) } : r?.regen ?? null,
      eta: tr ? tr.etaDay : null };
  };
  for (const r of recs.slice().reverse()) { if (seen.has(String(r.hullId))) continue; seen.add(String(r.hullId)); const h = Object.values(book.polities).flatMap((p) => p.hulls).find((x) => String(x.id) === String(r.hullId)) || (book.derelicts || []).find((x) => String(x.id) === String(r.hullId)) || null; rows.push(row(h, r)); }
  for (const h of book.polities[power]?.hulls || []) if (h.assimilated && !seen.has(String(h.id))) { seen.add(String(h.id)); rows.push(row(h, null)); }
  const nodes = world ? world.systems.filter((s) => s.controller === power).map((s) => ({ systemIndex: Number(s.index), ...nodeAt(book, world, power, s.index, day) })) : [];
  return { rows: rows.slice(0, 16), nodes, rules: { regenSharePerDay: cfg.regenSharePerDay, regenTargetShare: cfg.regenTargetShare, nodeStabilizeDays: cfg.nodeStabilizeDays, recoveryMaxTowDays: cfg.recoveryMaxTowDays, recoveryPendingDays: cfg.recoveryPendingDays, recoveryMaxAttempts: cfg.recoveryMaxAttempts, recoveryMaxActive: cfg.recoveryMaxActive, recoveryDutyShare: cfg.recoveryDutyShare } };
}
// CAPTAIN-BORG-ASSIMILATION §12: the captain-target row — his vessel's vid, what the Collective knows of it, its
// value and score at the latest evaluation, the objective, phase, progress, force, handoff and any failure result.
function captainDebug(book, world, db) {
  const bb = borgBook(db);
  const cap = world?.captain || null;
  const power = powersOf(book, db)[0] || 'borg';
  const contacts = Object.values(bb.contacts[power] || {}).filter((c) => c.kind === 'captain');
  const known = (cap && contacts.find((c) => c.vid === cap.vid)) || contacts.sort((a, b) => b.day - a.day)[0] || null;
  const sel = (bb.selections[power] || []).slice().reverse().find((x) => x.candidates.some((c) => c.kind === 'captain')) || null;
  const cand = sel ? sel.candidates.find((c) => c.kind === 'captain') : null;
  const o = (db.objectives || []).filter((x) => x.kind === KIND && x.targetKind === 'captain').slice(-1)[0] || null;
  const fail = bb.captainAssimilations.slice(-1)[0] || null;
  return { vid: cap?.vid ?? known?.vid ?? null, shipId: cap?.shipId ?? known?.shipId ?? null,
    known: known && { system: known.systemIndex, day: known.day, source: known.source, price: known.price, category: known.category, cloak: known.cloak, strength: known.strength, hullFrac: known.hullFrac, subdued: known.subdued, heading: known.heading },
    evaluation: cand && { day: sel.day, value: cand.value, score: cand.score, verdict: cand.verdict, reason: cand.reason, chosen: sel.chosen === cand.vid },
    objective: o && { id: o.id, status: o.status, phase: o.phase, progress: o.progress, force: o.force.map((x) => x.vid), engagements: o.engagements, handoff: o.handoff, movement: o.movement, result: o.result },
    failure: fail };
}
export function borgSummary(book) {
  const db = book.doctrine || {};
  const bb = borgBook(db);
  return { objectives: (db.objectives || []).filter((o) => o.kind === KIND), contacts: bb.contacts, worlds: bb.worlds, history: bb.history, cooldowns: bb.cooldowns, selections: bb.selections, progress: bb.progress,
    assimilatedHulls: bb.assimilatedHulls, assimilatedWorlds: bb.assimilatedWorlds, captainAssimilations: bb.captainAssimilations, recoveries: bb.recoveries, transwarp: bb.transwarp, incursions: bb.incursions, stats: Object.fromEntries(Object.entries(db.stats || {}).filter(([k]) => /^borg/.test(k))) };
}
