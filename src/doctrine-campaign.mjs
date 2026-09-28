// Doctrine runtime: the observer-evidence adapter, persistent incidents (asset_overdue, distress,
// asset_attack), report propagation between actual actors, the shadow evaluator and the pilot responses,
// and (phase 3) bounded patrol, defence and authorised-raid execution, on the campaign's real hulls.
// Rules: docs/doctrine/DOCTRINE-RUNTIME-PHASE1.md, -PHASE2.md and -PHASE3.md.
//
// Pure, like the campaign model it rides on: it reads a campaign book and a world snapshot, writes only
// to book.doctrine and to the hulls it actually assigns, and returns effects for the engine. Every draw
// is seeded from the campaign seed, so a reload gives the same answers.
//
// The one architectural rule: doctrine evaluates what an ACTOR knows. Three stores are kept apart:
//   book.doctrine.ground     what happened (a hull lost, where its wreck lies, who survived). Only the
//                            detection step reads it, and only for an observer physically present.
//   book.doctrine.knowledge  per observer, per incident: claims with provenance, confidence and the
//                            day they were observed/received. Facts are derived from this and nothing
//                            else, so faction membership never confers a report and an overdue ship
//                            never names an attacker.
//   book.doctrine.incidents  the persistent incident identities (one per asset/assignment/milestone)
//                            and their lifecycle. No fate, no attacker.
//
// Clock: the doctrine's `strategic_jumps` clock is the settled campaign day. Campaign days advance only
// on completed travel (by the route's days; a wormhole transit takes none), so a deadline never moves
// on a cancelled jump and never moves while the captain sits still.

import * as D from './doctrine-runtime.mjs';
import { seededUnit, applicableBlockadesAt, resolveBlockadeRun, shortestRoute, strategicAssignments, warAuthorityStamp, warAuthorityHolds, rescueStrandedCrew, hullIsDisabled, hullAwaitingCrew, localDefenseStrength, raidStrikeDay, standDownOperation, hullStrength } from './campaign-strategy.mjs';
import { classifyDamage } from './ship-fleet.mjs';

export const DOCTRINE_BOOK_VERSION = 1;
// Bumped whenever the pilot configuration changes: a book saved under an older one takes the new defaults
// (keeping only whether doctrine was switched on). Within a version, a changed config (debug, tests) stands.
export const DOCTRINE_CONFIG_VERSION = 3;
export const CLOCK = 'strategic_jumps';
// First-pass pilot tuning. Every duration is in campaign days; none is a measured value.
export const DOCTRINE_PILOT = Object.freeze({
  enabled: true,
  // The only live doctrine decisions this round. Everything else is evaluated and logged in shadow.
  live: Object.freeze([
    Object.freeze({ profile: 'romulan', role: 'commander', response: 'investigate' }),
    Object.freeze({ profile: 'delpin', role: 'explorer', response: 'investigate' }),
    Object.freeze({ profile: 'vulcan', role: 'relief', response: 'rescue' }),
    // Phase 2: commercial reroute and protection of a threatened project (as an escort of its charge).
    Object.freeze({ profile: 'ferengi', role: 'civilian', response: 'reroute' }),
    Object.freeze({ profile: 'tholian', role: 'commander', response: 'protect' }),
    // Phase 3: bounded military execution where the authority already exists.
    ...['romulan', 'klingon', 'terran'].flatMap((p) => [
      Object.freeze({ profile: p, role: 'patrol', response: 'investigate' }),
      Object.freeze({ profile: p, role: 'patrol', response: 'protect' }),
      Object.freeze({ profile: p, role: 'commander', response: 'protect' }),
      Object.freeze({ profile: p, role: 'raider', response: 'raid' }),
    ]),
  ]),
  // Routine assignments that give asset_overdue something real to be about. Per polity, how many run at once.
  patrols: Object.freeze({ romulan: 1 }),
  explorers: Object.freeze({ delpin: 1 }),
  reliefShips: Object.freeze({ vulcan: 1 }),
  merchants: Object.freeze({ ferengi: 1 }),
  projects: Object.freeze({ tholian: 1 }),
  // Phase 3: one persistent area patrol per power, on a frontier world and the systems next to it.
  patrolAreas: Object.freeze({ romulan: 1, klingon: 1, terran: 1 }),
  // Observers whose evaluations are always logged, known or not (so "knows nothing, does nothing" is on record).
  watchCommands: Object.freeze(['romulan', 'klingon', 'delpin', 'vulcan', 'cardassian', 'terran', 'dominion', 'dominion_remnant', 'ferengi', 'tholian']),
  patrolEveryDays: 10, patrolDwellDays: 3,
  exploreEveryDays: 12, exploreDwellDays: 1, exploreHops: 2,
  arrivalGraceDays: 1, checkInGraceDays: 2,
  investigationDwellDays: 2, investigationDeadlineDays: 14,
  rescueDwellDays: 1, rescueDeadlineDays: 10,
  maxResponseHops: 6, minSupply: 0.3, maxLiveObjectivesPerPolity: 1,
  evidenceLifeDays: 90, searchAreaFreshDays: 30, survivorWindowDays: 20, survivorPodChance: 0.5,
  shadowLogLimit: 120, reportLimit: 200, sightingLimit: 60, closedLimit: 40, closedAssignmentLimit: 12, incidentHistoryLimit: 20,
  // Phase 2
  tradeEveryDays: 12, tradeHops: 3, deliverySlackDays: 3, contractGraceDays: 3,
  projectEveryDays: 30, projectDeliveries: 2, projectDays: 30, closedContractLimit: 12,
  escortDeadlineDays: 20,
  networkHopsPerDay: 2, maxNetworkDelayDays: 5, messageExpiryDays: 30, messageHistoryLimit: 60,
  conflictLimit: 60, reevaluationLimit: 80,
  // Phase 3
  patrolAreaDwellDays: 2, patrolFormEveryDays: 15, patrolResponseHops: 1, closedPatrolLimit: 10,
  maxMilitaryObjectivesPerPolity: 2, defenseHops: 2, defenseDeadlineDays: 10, defenseHopelessRatio: 2,
  raidDeadlineDays: 15, raidStrikeDays: 2, raidEngageRatio: 1.0, raidMinRatio: 0.6, attackHistoryLimit: 30,
  // Witnessing attacks (and so defending against them) can be switched off for a campaign — the earlier
  // phases' gates do, so their scenarios run as they did before phase 3.
  militaryResponses: true,
});

// ---------- book ----------
export function doctrineBook(book) {
  const d = (book.doctrine ||= {});
  d.version ??= DOCTRINE_BOOK_VERSION;
  if (d.configVersion !== DOCTRINE_CONFIG_VERSION) { d.config = { enabled: d.config?.enabled ?? DOCTRINE_PILOT.enabled }; d.configVersion = DOCTRINE_CONFIG_VERSION; }
  d.config = { ...DOCTRINE_PILOT, ...(d.config || {}) };
  d.counter ??= 0;
  for (const k of ['incidents', 'knowledge', 'briefings', 'pactTasks', 'orders', 'lastEval', 'designations', 'lastRun', 'contracts', 'patrols']) d[k] ||= {};
  for (const k of ['assignments', 'objectives', 'reports', 'shadow', 'closed', 'messages', 'conflicts', 'reevaluations', 'raidOrders']) if (!Array.isArray(d[k])) d[k] = [];
  d.ground ||= {};
  d.ground.evidence ||= {};
  d.ground.fates ||= {};
  d.stats ||= { incidents: 0, objectives: 0, deferred: 0, shadowEvaluations: 0, reports: 0, blockadeRuns: 0 };
  return d;
}
// Doctrine keeps its own counter: taking numbers from the campaign's would renumber every later hull and
// operation, and the seeded draws keyed on those IDs with them.
function nid(book, db, type) { db.counter++; return `${book.seed}:doctrine-${type}:${db.counter}`; }
function bump(db, key, n = 1) { db.stats[key] = (db.stats[key] || 0) + n; }
const at = (day) => ({ clock: CLOCK, value: Math.max(0, Math.floor(day)) });
function slug(s) { return String(s || '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'unnamed'; }
// Stable location identity: the world's own name, never its index. Two worlds sharing a name are told
// apart by the later one's index.
export function locationIdFor(world, index) {
  const sys = world.systems[Number(index)];
  if (!sys) return null;
  const base = `system:${slug(sys.name)}`;
  const dup = world.systems.findIndex((s) => s !== sys && slug(s.name) === slug(sys.name));
  return dup >= 0 && dup < Number(index) ? `${base}-${index}` : base;
}
export function jurisdictionAt(world, index) {
  const c = world.systems[Number(index)]?.controller;
  return c ? `authority:${c}` : null;
}
function hullOf(book, polityId, hullId) {
  return (book.polities[polityId]?.hulls || []).find((h) => h.id === hullId) || null;
}
function liveHull(book, polityId, hullId) {
  const h = hullOf(book, polityId, hullId);
  return h && h.status !== 'lost' ? h : null;
}
function vidOf(h) { return h?.identity?.vid || h?.vid || h?.id || null; }
function relSide(world, polityId) { return polityId === 'player' ? (world.playerRelationSide || world.playerFaction) : polityId; }
function atWar(world, a, b) { return world.relation(relSide(world, a), relSide(world, b)) === 'war'; }
function routeBetween(world, from, to, polityId) {
  if (Number(from) === Number(to)) return [Number(from)];
  return shortestRoute(world, from, to, polityId);
}

// ---------- observers and their doctrine ----------
// An observer is a command (`command:<polity>`), one vessel (`hull:<hullId>`), or the captain (`player`).
// Its profile is decided by who commands it, never by the design of its hull.
export function observerPolity(observerId) {
  const [kind, rest] = String(observerId).split(/:(.+)/);
  if (kind === 'command') return rest;
  return null;
}
function hullPolity(book, hullId) {
  for (const [id, p] of Object.entries(book.polities || {})) if ((p.hulls || []).some((h) => h.id === hullId)) return id;
  return null;
}
export function dominionContext(book, polityId, db) {
  // Scenario activation: the expedition arc is running (not dormant, not withdrawn).
  const phaseActive = ['reconnaissance', 'staging', 'invasion'].includes(book.dominion?.phase);
  if (polityId === 'dominion') {
    // Central's own command: it IS the central authority; it has orders only while it is running the expedition.
    return { runtimeFaction: 'dominion', centralAuthority: true, scenarioActivated: phaseActive, ordersReceived: phaseActive && Boolean(book.dominion?.expeditionOpId || book.dominion?.phase === 'reconnaissance' || book.dominion?.phase === 'staging') };
  }
  if (polityId === 'dominion_remnant') {
    // The Blender remnant is autonomous unless explicitly subordinated; even then it needs an order.
    const bound = book.commandBindings?.dominion_remnant?.to === 'dominion';
    const orders = (db?.orders?.dominion_remnant || []).some((o) => o.from === 'dominion' && o.status === 'received');
    return { runtimeFaction: 'dominion', centralAuthority: bound, scenarioActivated: phaseActive, ordersReceived: orders };
  }
  return { runtimeFaction: polityId };
}
export function observerDoctrine(doctrine, book, db, observerId) {
  if (observerId === 'player') return { profileId: null, role: null, culture: null, profileReason: 'the captain follows player orders, not doctrine', roleReason: 'player' };
  const [kind, id] = String(observerId).split(/:(.+)/);
  if (kind === 'command') {
    const actor = { ...dominionContext(book, id, db), doctrineRole: 'commander' };
    return D.actorDoctrine(doctrine, actor);
  }
  if (kind === 'hull') {
    const polity = hullPolity(book, id);
    if (!polity || polity === 'player') return { profileId: null, role: 'deny_assignment', profileReason: 'not a doctrine vessel', roleReason: '' };
    const job = activeAssignmentFor(db, id);
    const designated = db.designations?.[polity]?.[id];
    const actor = { ...dominionContext(book, polity, db), doctrineRole: job?.doctrineRole || designated || null, nativeRole: 'patrol' };
    return D.actorDoctrine(doctrine, actor);
  }
  return { profileId: null, role: 'deny_assignment', profileReason: 'unknown observer', roleReason: '' };
}
function activeAssignmentFor(db, hullId) {
  return db.assignments.find((a) => a.hullId === hullId && a.status === 'active') || null;
}

// ---------- knowledge ----------
function knowledgeOf(db, observerId, incidentId) { return db.knowledge[observerId]?.[incidentId] || null; }
function observerStore(db, observerId) { return (db.knowledge[observerId] ||= {}); }
const CONF_RANK = { unassessed: 0, tentative: 1, corroborated: 2 };
// Adds what one source told (or showed) this observer. Claims are merged, never replaced by a weaker
// one; the sources list is how corroboration is judged.
function learn(db, observerId, incident, { provenance, confidence, day, from = null, claims = {}, observedDay = null, cause = null }) {
  const store = observerStore(db, observerId);
  const k = (store[incident.id] ||= {
    incidentId: incident.id, observerId, eventType: incident.eventType,
    locationId: incident.locationId, jurisdictionAtOccurrence: incident.jurisdictionAtOccurrence,
    observedAt: observedDay == null ? null : at(observedDay), receivedAt: at(day),
    provenance, confidence: confidence || 'unassessed', sources: [], claims: {}, evidence: {}, survivors: null,
    lastKnownArea: null, attribution: null, resolution: null, linkedLosses: [],
  });
  if (!k.sources.some((s) => s.from === from && s.provenance === provenance)) k.sources.push({ from, provenance, day });
  k.sources = k.sources.slice(-12);
  if (CONF_RANK[confidence] > CONF_RANK[k.confidence]) k.confidence = confidence;
  // Two independent sources corroborate a tentative account.
  if (k.confidence === 'tentative' && new Set(k.sources.map((s) => s.from)).size >= 2) k.confidence = 'corroborated';
  for (const [name, value] of Object.entries(claims)) {
    if (value == null) continue;
    if (name === 'cargo' && k.claims.cargo && k.claims.cargo.knowledge !== 'unknown' && value.knowledge === 'unknown') continue; // never forget a known manifest
    k.claims[name] = JSON.parse(JSON.stringify(value));
  }
  if (claims.lastKnown?.locationId) k.lastKnownArea = claims.lastKnown.locationId;
  k.updatedDay = day;
  k.version = (k.version || 0) + 1;
  k.lastChange = { day, cause: cause || (from ? `report from ${from}` : provenance) };
  return k;
}
// ---------- reports: persistent messages between actual actors ----------
// A report is an object with its own life: built from what the SENDER holds on the day it is sent (a
// snapshot, never a live reference), carried by a channel, and applied to the recipient only on the day
// it is delivered. Until then the recipient knows nothing of it and its doctrine is unaffected.
//   local     sender and recipient in the same system: delivered the same day
//   network   across the chart: a bounded delay from the hops between them; an unreachable recipient
//             leaves the report pending (retried daily) until it expires
//   broadcast a distress call heard by whoever is in range (local, or a command holding a system next
//             door, over the network)
//   override  an authored or debug relay (labelled as such where offered): delivered at once
// A payload profile decides what a report carries; it can only carry what the sender holds.
export const REPORT_PROFILES = Object.freeze({
  overdue_notice: Object.freeze(['asset', 'assignment', 'missedMilestone', 'detectedAt', 'lastKnown']),
  findings: Object.freeze(['asset', 'assignment', 'missedMilestone', 'detectedAt', 'lastKnown', 'evidence', 'resolution']),
  survivor_report: Object.freeze(['asset', 'survivors', 'hazards', 'urgency', 'lastKnown']),
  full: Object.freeze(['asset', 'assignment', 'missedMilestone', 'detectedAt', 'lastKnown', 'evidence', 'survivors', 'hazards', 'urgency', 'resolution', 'linkedLosses', 'attacker']),
  // Phase 3: an attack seen — what attacked, as identified by whoever saw it (or "unknown").
  attack_report: Object.freeze(['asset', 'lastKnown', 'attacker', 'resolution']),
});
function buildPayload(db, book, sender, from, include) {
  const p = { claims: {}, evidence: [], survivors: null, resolution: null, linkedLosses: [], pact: null };
  for (const name of ['asset', 'assignment', 'missedMilestone', 'detectedAt', 'lastKnown', 'hazards', 'urgency', 'attacker']) if (include.includes(name) && sender.claims[name] != null) p.claims[name] = JSON.parse(JSON.stringify(sender.claims[name]));
  // Hidden cargo never travels: the manifest stays with those who hold it.
  p.claims.cargo = { knowledge: 'unknown', manifest: null };
  if (include.includes('evidence')) p.evidence = Object.values(sender.evidence || {}).map((e) => JSON.parse(JSON.stringify(e)));
  if (include.includes('survivors') && sender.survivors) p.survivors = { ...sender.survivors };
  if (include.includes('resolution') && sender.resolution) p.resolution = { ...sender.resolution };
  if (include.includes('linkedLosses')) p.linkedLosses = (sender.linkedLosses || []).map((l) => ({ ...l }));
  return p;
}
function observerLocations(book, world, db, observerId) {
  const [kind, id] = String(observerId).split(/:(.+)/);
  if (kind === 'hull') { const pol = hullPolity(book, id); const h = pol && liveHull(book, pol, id); return h ? [Number(h.systemIndex)] : []; }
  if (kind === 'command') {
    const held = world.systems.filter((s) => s.controller === id).map((s) => s.index);
    if (held.length) return held;
    return [...new Set((book.polities[id]?.hulls || []).filter((h) => h.status !== 'lost').map((h) => Number(h.systemIndex)))];
  }
  if (kind === 'beacon') { const s = db.ground.evidence[id]; return s ? [s.systemIndex] : []; }
  return [];
}
function hopsBetween(world, fromList, toList, polity) {
  let best = null;
  for (const t of toList) {
    if (fromList.includes(t)) return 0;
    const h = world.routeHops(fromList, t, polity);
    if (h != null && (best == null || h < best)) best = h;
  }
  return best;
}
function deliveryPlan(book, world, db, msg, day) {
  if (msg.channel === 'override') return { deliverDay: day, reachable: true };
  const from = observerLocations(book, world, db, msg.sender), to = observerLocations(book, world, db, msg.recipient);
  if (!to.length) return { deliverDay: null, reachable: false, gone: String(msg.recipient).startsWith('hull:') };
  if (!from.length) return { deliverDay: null, reachable: false };
  const hops = hopsBetween(world, from, to, observerSide(book, msg.sender) || null);
  if (hops == null) return { deliverDay: null, reachable: false };
  if (hops === 0) return { deliverDay: day, reachable: true, hops };
  const c = db.config;
  return { deliverDay: day + Math.max(1, Math.min(c.maxNetworkDelayDays, Math.ceil(hops / c.networkHopsPerDay))), reachable: true, hops };
}
function trustOf(book, world, db, sender, from, to, payload) {
  // Trusted: an owner speaking about its own asset, one's own side, or an eyewitness account (the sender
  // saw or examined the evidence itself) from a power not at war with the recipient. Anything else
  // starts tentative and needs a second, independent source.
  const firstParty = sender.claims.asset?.factionId && observerSide(book, from) === sender.claims.asset.factionId;
  const fromSide = observerSide(book, from), toSide = observerSide(book, to);
  const sameSide = fromSide != null && fromSide === toSide;
  const eyewitness = payload.evidence.some((e) => ['direct_sensor', 'recovered_record'].includes(e.provenance)) || ['direct_sensor', 'direct_witness'].includes(payload.survivors?.provenance) || String(from).startsWith('beacon:');
  const hostile = fromSide && toSide && fromSide !== 'player' && toSide !== 'player' && atWar(world, fromSide, toSide);
  return firstParty || sameSide || (eyewitness && !hostile) ? 'corroborated' : 'tentative';
}
// Sends a report. Deduplicated on (incident, sender, recipient, kind); returns the message (or null).
export function sendReport(db, book, world, { incidentId, from, to, day, kind = 'report', include = REPORT_PROFILES.full, channel = 'network', provenance = 'received_report', confidence = null, pactKey = null }) {
  const incident = db.incidents[incidentId];
  const sender = knowledgeOf(db, from, incidentId);
  if (!incident || !sender || from === to) return null;
  const relayKey = `${from}|${to}|${kind}|v${sender.version || 0}`;
  if ((incident.relays || []).includes(relayKey)) { db.stats.duplicateReportsPrevented = (db.stats.duplicateReportsPrevented || 0) + 1; return null; }
  (incident.relays ||= []).push(relayKey);
  if (incident.relays.length > 400) incident.relays = incident.relays.slice(-400);
  if (!(incident.reportedBy ||= []).includes(from)) incident.reportedBy.push(from);
  const payload = buildPayload(db, book, sender, from, include);
  // A compartmented briefing travels only when the sender itself is briefed and chooses to send it.
  if (pactKey && briefedOn(db, book, from, pactKey)) payload.pact = { pactKey };
  const msg = { id: nid(book, db, 'msg'), incidentId, eventType: incident.eventType, kind, sender: from, recipient: to, channel, payload, provenance,
    confidence: confidence || trustOf(book, world, db, sender, from, to, payload), sentDay: day, deliverDay: null, deliveredDay: null, state: 'pending', reason: null, include: [...include] };
  const plan = deliveryPlan(book, world, db, msg, day);
  msg.deliverDay = plan.deliverDay; msg.hops = plan.hops ?? null;
  if (!plan.reachable) msg.reason = plan.gone ? 'recipient gone' : 'no route to the recipient yet';
  db.messages.push(msg);
  db.stats.reportsSent = (db.stats.reportsSent || 0) + 1;
  if (msg.deliverDay != null && msg.deliverDay <= day) deliverMessage(db, book, world, msg, day);
  return msg;
}
// Phase 1 name kept: an immediate, labelled relay (authored scenarios and the debug panel).
export function transmit(db, book, world, { incidentId, from, to, day, kind = 'report', disclose = [], confidence = null }) {
  const m = sendReport(db, book, world, { incidentId, from, to, day, kind, include: REPORT_PROFILES.full, channel: 'override', confidence });
  return m && m.state === 'delivered' ? knowledgeOf(db, to, incidentId) : null;
}
function deliverMessage(db, book, world, msg, day, effects = []) {
  const incident = db.incidents[msg.incidentId];
  if (!incident) { msg.state = 'undeliverable'; msg.reason = 'incident no longer on the books'; bump(db, 'reportsUndeliverable'); return; }
  const p = msg.payload;
  const k = learn(db, msg.recipient, incident, { provenance: msg.provenance, confidence: msg.confidence, day, from: msg.sender, claims: p.claims, cause: `report ${msg.id}` });
  for (const e of p.evidence) mergeEvidence(k, { ...e, provenance: msg.channel === 'override' ? 'received_report' : 'received_report', via: msg.sender });
  if (p.survivors) k.survivors = { ...p.survivors, provenance: 'received_report', via: msg.sender };
  for (const l of p.linkedLosses || []) if (!k.linkedLosses.some((x) => x.factionId === l.factionId && x.evidenceId === l.evidenceId)) k.linkedLosses.push({ ...l });
  if (p.resolution && !k.resolution) k.resolution = { ...p.resolution, via: msg.sender };
  if (p.pact) (db.briefings[msg.recipient] ||= []).push({ pactKey: p.pact.pactKey, day, by: msg.sender, via: msg.id });
  // An attacker named in a report is the sender's identification, received second hand; "unknown" stays unknown.
  if (p.claims.attacker?.factionId && !k.attribution) k.attribution = { factionId: p.claims.attacker.factionId, provenance: 'received_report', via: msg.sender, day };
  if (p.surrender && !k.surrender) k.surrender = { ...p.surrender, via: msg.sender };
  relinkSightings(book, world, db, msg.recipient, day);
  refreshLinks(db, msg.recipient, k);
  checkLocated(book, world, db, msg.recipient, k, day, effects);
  msg.state = 'delivered'; msg.deliveredDay = day; msg.reason = null;
  db.stats.reportsDelivered = (db.stats.reportsDelivered || 0) + 1;
}
function compactPayload(p) {
  return { claims: Object.fromEntries(Object.keys(p.claims || {}).filter((k) => k !== 'cargo' || p.claims.cargo?.knowledge !== 'unknown').map((k) => [k, true])), evidence: Array.isArray(p.evidence) ? p.evidence.length : p.evidence || 0,
    survivors: Boolean(p.survivors), resolution: p.resolution?.status || p.resolution || null, linkedLosses: (p.linkedLosses || []).map((l) => l.factionId || l), pact: p.pact || null };
}
function deliverMessages(book, world, db, day, effects = []) {
  for (const msg of db.messages) {
    if (msg.state !== 'pending') continue;
    if (msg.deliverDay == null) {
      // Retry an unreachable one; a recipient that is gone never receives it; old ones expire.
      if (day - msg.sentDay > db.config.messageExpiryDays) { msg.state = 'expired'; db.stats.reportsExpired = (db.stats.reportsExpired || 0) + 1; continue; }
      const plan = deliveryPlan(book, world, db, msg, day);
      if (plan.gone) { msg.state = 'undeliverable'; msg.reason = 'recipient gone'; bump(db, 'reportsUndeliverable'); continue; }
      if (!plan.reachable) continue;
      msg.deliverDay = plan.deliverDay; msg.hops = plan.hops;
    }
    if (msg.deliverDay <= day) {
      if (String(msg.recipient).startsWith('hull:') && !observerLocations(book, world, db, msg.recipient).length) { msg.state = 'undeliverable'; msg.reason = 'recipient gone'; bump(db, 'reportsUndeliverable'); continue; }
      deliverMessage(db, book, world, msg, day, effects);
    }
  }
  // Bounded: every pending report is kept; delivered and dead ones only as a short record.
  const live = db.messages.filter((m) => m.state === 'pending');
  const done = db.messages.filter((m) => m.state !== 'pending');
  db.messages = [...live, ...done.slice(-db.config.messageHistoryLimit)];
  // A delivered report has done its work: after a while only its outline is kept for the record.
  for (const m of db.messages) if (m.state !== 'pending' && !m.compact && day - (m.deliveredDay ?? m.sentDay) > 10) { m.payload = compactPayload(m.payload); m.compact = true; delete m.include; }
}

function observerSide(book, observerId) {
  const [kind, id] = String(observerId).split(/:(.+)/);
  if (kind === 'command') return id;
  if (kind === 'hull') return hullPolity(book, id);
  if (observerId === 'player') return 'player';
  return null;
}
function mergeEvidence(k, e) {
  const cur = k.evidence[e.evidenceId];
  if (!cur) { k.evidence[e.evidenceId] = { ...e }; return; }
  // Recovered beats seen; an identified wreck list only grows.
  cur.recovered = cur.recovered || e.recovered;
  cur.wrecks = [...new Map([...(cur.wrecks || []), ...(e.wrecks || [])].map((w) => [w.factionId, w])).values()];
  cur.observedDay = Math.max(cur.observedDay ?? 0, e.observedDay ?? 0);
}
// Links the evidence an observer holds to its incident, and to its own organisation's losses, when its
// own knowledge supports it: an identified wreck of the observer's organisation at a site inside the
// incident's known area. Proximity alone never attributes an attacker.
function refreshLinks(db, observerId, k) {
  const side = observerId.startsWith('command:') ? observerId.slice(8) : null;
  for (const e of Object.values(k.evidence || {})) {
    for (const w of e.wrecks || []) {
      if (side && w.factionId === side && !k.linkedLosses.some((x) => x.factionId === side && x.evidenceId === e.evidenceId)) {
        k.linkedLosses.push({ factionId: side, evidenceId: e.evidenceId, locationId: e.locationId, day: e.observedDay, via: e.via || e.provenance });
      }
    }
  }
}

// ---------- facts: what THIS observer knows ----------
// Every fact is derived from the observer's own knowledge record, orders and capacity. A fact that is
// not derived here is false. `live_weapon_track` is never derived from knowledge: a historical
// position is not a track.
export function deriveFacts(doctrine, book, world, db, observerId, incidentId, day, opts = {}) {
  const f = {};
  const k = knowledgeOf(db, observerId, incidentId);
  const c = db.config;
  const side = observerSide(book, observerId);
  if (!k) return { facts: { event_known: false }, trace: { event_known: 'no report received and nothing observed' } };
  const trace = {};
  const set = (name, value, why) => { if (value) f[name] = true; trace[name] = `${value ? 'true' : 'false'}: ${why}`; };
  set('event_known', true, `${k.provenance} on day ${k.receivedAt.value}`);
  set('witness_or_report_received', true, 'this observer holds a record of it');
  set('credible_report', k.confidence === 'corroborated', `confidence ${k.confidence} from ${k.sources.map((s) => s.from || 'own records').join(', ')}`);
  const resolvedKnown = Boolean(k.resolution);
  const areaDay = k.claims.lastKnown?.observedAt?.value ?? k.receivedAt.value;
  const freshArea = day - areaDay <= c.searchAreaFreshDays;
  const since = k.claims.lastKnown?.observedAt?.value ?? -1;
  const liveEvidence = Object.values(k.evidence || {}).filter((e) => !e.recovered && e.recoverable !== false && day - (e.observedDay ?? day) <= c.evidenceLifeDays && (e.observedDay ?? day) >= since);
  const survivorsOpen = Boolean(k.survivors && !k.survivors.rescued && day - (k.survivors.observedDay ?? day) <= c.survivorWindowDays);
  // Still relevant: an open question with a live lead, or people still waiting for rescue.
  set('event_actionable', (!resolvedKnown && (freshArea || liveEvidence.length > 0)) || survivorsOpen, resolvedKnown ? `known ${k.resolution.status}${survivorsOpen ? '; survivors still waiting' : ''}` : `area age ${day - areaDay}d, ${liveEvidence.length} live evidence lead(s)`);
  const assetFaction = k.claims.asset?.factionId ?? null;
  set('own_asset_affected', Boolean(side && assetFaction && assetFaction === side), `asset faction as known: ${assetFaction ?? 'unknown'}`);
  const searchArea = k.lastKnownArea || null;
  set('usable_search_area', Boolean((searchArea && freshArea) || liveEvidence.length), searchArea ? `last known ${searchArea}` : 'no known area');
  // Evidence: a recoverable lead this observer knows of; for the owner, its own asset's planned route
  // and last check-in are the place its evidence would be.
  const ownRoute = f.own_asset_affected && k.claims.assignment && searchArea && freshArea;
  set('evidence_available', liveEvidence.length > 0 || Boolean(ownRoute), liveEvidence.length ? `${liveEvidence.length} known site(s): ${liveEvidence.map((e) => e.locationId).join(', ')}` : ownRoute ? 'own assignment route and last check-in' : 'no known evidence');
  const surv = k.survivors && !k.survivors.rescued && day - (k.survivors.observedDay ?? day) <= c.survivorWindowDays ? k.survivors : null;
  set('survivors_known', Boolean(surv && surv.locationId), surv ? `survivor report at ${surv.locationId} (day ${surv.observedDay})` : 'no usable survivor report');
  set('linked_own_losses', Boolean(side && k.linkedLosses.some((l) => l.factionId === side)), k.linkedLosses.length ? `identified wrecks: ${k.linkedLosses.map((l) => l.factionId).join(', ')}` : 'no evidence links own losses');
  const identified = Object.values(k.evidence || {}).some((e) => (e.wrecks || []).length);
  set('regional_threat_supported', false, 'not derived in phase 1');
  set('identity_known', Boolean(identified), identified ? 'wreck design identified' : 'nothing identified');
  set('actor_attributed', Boolean(k.attribution), k.attribution ? `attributed to ${k.attribution.factionId}` : 'no attribution: an overdue asset names no attacker');
  // Phase 3: an attack witnessed or reported. Attribution only from an identification someone made.
  const incMil = db.incidents[incidentId];
  if (isMilitaryIncident(incMil)) {
    const where = systemIndexForLocation(db, incMil.locationId);
    const obligation = defenseObligation(book, world, db, observerId, where);
    set('attack_on_protected_verified', Boolean(k.attribution) && Boolean(obligation), k.attribution ? `attack by ${k.attribution.factionId} (${k.attribution.provenance})${obligation ? ` on ${obligation}` : ' — not a protected asset of this actor'}` : 'attacker not identified');
    set('defense_obligation_active', Boolean(obligation), obligation || 'no defence obligation there');
    set('protected_party_affected', Boolean(obligation) && !f.own_asset_affected, obligation || 'no protected party affected');
  }
  const ca = contractAffected(book, world, db, observerId, k);
  set('contract_affected', ca.affected && !resolvedKnown, resolvedKnown ? 'known resolved' : ca.why);
  // Compartmented pact knowledge: explicit receipts only.
  const pacts = activePactKeysFor(book, side);
  const briefed = pacts.filter((key) => briefedOn(db, book, observerId, key));
  set('pact_briefing_received', briefed.length > 0, briefed.length ? `briefed on ${briefed.join(', ')}` : 'no compartmented briefing received');
  const exposing = briefed.filter((key) => { const parties = book.treaties?.[key]?.parties || []; return Object.values(k.evidence || {}).some((e) => (e.wrecks || []).some((w) => parties.includes(w.factionId) && w.factionId !== side)); });
  set('pact_exposure_risk', exposing.length > 0, exposing.length ? `known evidence names a party to ${exposing.join(', ')}` : 'nothing known connects this to a pact');
  const tasked = briefed.filter((key) => (db.pactTasks[observerId] || []).some((t) => t.pactKey === key && t.status === 'assigned'));
  set('pact_task_assigned', tasked.length > 0, tasked.length ? `pact task on ${tasked.join(', ')}` : 'no pact task');
  // Transmission and supply, as far as the observer can tell.
  set('can_transmit', true, 'subspace');
  set('report_due', !(db.incidents[incidentId]?.reportedBy || []).includes(observerId), 'not yet reported by this observer');
  // Physical fire facts are never available strategically.
  trace.live_weapon_track = 'false: strategic knowledge carries no weapon track (a last-known position is history)';
  trace.contact_detected = 'false: no live contact at strategic scale';
  const pol = side && book.polities[side];
  set('supply_inadequate', Boolean(pol && Number(pol.supply ?? 1) < c.minSupply), `supply ${pol ? Number(pol.supply ?? 1).toFixed(2) : 'n/a'}`);
  if (opts.warTarget) {
    const stamp = warAuthorityStamp(book, world, side, opts.warTarget);
    set('war_order_active', Boolean(stamp && warAuthorityHolds(book, world, stamp)), 'formal war authority against the named target');
  }
  return { facts: f, trace };
}
function activePactKeysFor(book, side) {
  if (!side) return [];
  return Object.values(book.treaties || {}).filter((t) => t.kind === 'pact' && t.status === 'active' && t.parties.includes(side)).map((t) => t.key);
}
// Signatory commands know the agreement they concluded. Anyone else only by an explicit briefing receipt.
function briefedOn(db, book, observerId, pactKey) {
  const rec = book.treaties?.[pactKey];
  if (!rec || rec.status !== 'active') return false;
  if (observerId.startsWith('command:') && rec.parties.includes(observerId.slice(8))) return true;
  return (db.briefings[observerId] || []).some((b) => b.pactKey === pactKey);
}
export function briefActor(book, observerId, pactKey, day, by = 'authored') {
  const db = doctrineBook(book);
  (db.briefings[observerId] ||= []).push({ pactKey, day, by });
  return true;
}
export function assignPactTask(book, observerId, pactKey, task, day) {
  const db = doctrineBook(book);
  (db.pactTasks[observerId] ||= []).push({ pactKey, task, day, status: 'assigned' });
  return true;
}
// The asset_overdue payload as THIS observer can state it (eventContracts.asset_overdue). Unknown stays null.
export function overdueEventFor(db, observerId, incidentId) {
  const k = knowledgeOf(db, observerId, incidentId);
  const inc = db.incidents[incidentId];
  if (!k || !inc) return null;
  const c = k.claims;
  return {
    incidentId, eventType: 'asset_overdue', locationId: inc.locationId, jurisdictionAtOccurrence: inc.jurisdictionAtOccurrence,
    asset: c.asset ? { assetId: c.asset.assetId, kind: c.asset.kind, role: c.asset.role, ownerId: c.asset.ownerId ?? null, factionId: c.asset.factionId ?? null }
      : { assetId: inc.assetId, kind: 'ship', role: 'unknown', ownerId: null, factionId: null },
    assignment: c.assignment ? { assignmentId: c.assignment.assignmentId, kind: c.assignment.kind, originLocationId: c.assignment.originLocationId ?? null, destinationLocationId: c.assignment.destinationLocationId ?? null, contractId: c.assignment.contractId ?? null }
      : { assignmentId: inc.assignmentId, kind: 'unknown', originLocationId: null, destinationLocationId: null, contractId: null },
    cargo: c.cargo ? { knowledge: c.cargo.knowledge, manifest: c.cargo.manifest } : { knowledge: 'unknown', manifest: null },
    missedMilestone: c.missedMilestone,
    detectedAt: c.detectedAt,
    lastKnown: c.lastKnown || { locationId: null, position: null, observedAt: null },
  };
}

// ---------- assignments: routine jobs on real hulls, and the legs of doctrine objectives ----------
// An itinerary is a list of adjacent systems; a stop with dwell > 0 is held that many days. A milestone
// on a stop is the owner's expectation: arrival (or check-in back home) by a due day, with a grace.
function buildItinerary(world, polityId, stops) {
  const out = [];
  for (let i = 0; i < stops.length; i++) {
    const s = stops[i];
    if (i === 0) { out.push({ systemIndex: Number(s.systemIndex), dwell: s.dwell || 0, milestone: s.milestone || null }); continue; }
    const path = routeBetween(world, stops[i - 1].systemIndex, s.systemIndex, polityId);
    if (!path) return null;
    for (let j = 1; j < path.length; j++) out.push({ systemIndex: path[j], dwell: j === path.length - 1 ? (s.dwell || 0) : 0, milestone: j === path.length - 1 ? (s.milestone || null) : null });
  }
  return out;
}
export function issueAssignment(book, world, spec, day, effects = []) {
  const db = doctrineBook(book);
  const { polity, hullId, kind, doctrineRole, stops, objectiveId = null, cargo = null, contractId = null, loadDays = 0 } = spec;
  const h = liveHull(book, polity, hullId);
  if (!h) return { ok: false, reason: 'no such vessel' };
  // A cargo job starts with a day in port loading; the crew sail with their command's current notices.
  const itinerary = buildItinerary(world, polity, [{ systemIndex: h.systemIndex, dwell: loadDays }, ...stops]);
  if (!itinerary) return { ok: false, reason: 'no route' };
  const id = nid(book, db, 'asg');
  const grace = (m) => (m === 'check_in' ? db.config.checkInGraceDays : db.config.arrivalGraceDays);
  let t = day;
  const milestones = [];
  itinerary.forEach((stop, i) => {
    if (i > 0) t += 1;
    if (stop.milestone) milestones.push({ id: `${id}:m${milestones.length + 1}`, kind: stop.milestone, stopIndex: i, systemIndex: stop.systemIndex, locationId: locationIdFor(world, stop.systemIndex), dueDay: t, grace: grace(stop.milestone), status: 'pending', metDay: null });
    t += stop.dwell;
  });
  const a = { id, kind, polity, hullId, vid: vidOf(h), doctrineRole, objectiveId, itinerary, pos: 0, dwellLeft: itinerary[0].dwell, nextDay: day + 1,
    milestones, status: 'active', startDay: day, endDay: null, endReason: null,
    origin: locationIdFor(world, itinerary[0].systemIndex), destination: locationIdFor(world, itinerary.at(-1).systemIndex),
    // What the owner knows of where its vessel is: the last stop it reported from. Not the truth.
    lastReport: { systemIndex: h.systemIndex, locationId: locationIdFor(world, h.systemIndex), day },
    cargo: cargo || { knowledge: 'verified', manifest: [] }, runs: [], contractId };
  h.status = 'assigned'; h.opId = id;
  db.assignments.push(a);
  effects.push({ type: 'doctrineAssigned', id, polity, hullId, vid: a.vid, kind, from: h.systemIndex, to: itinerary.at(-1).systemIndex, day });
  return { ok: true, assignment: a };
}
function endAssignment(db, book, a, day, status, reason, releaseAt = true) {
  a.status = status; a.endDay = day; a.endReason = reason;
  const h = liveHull(book, a.polity, a.hullId);
  if (h && h.opId === a.id && releaseAt) { h.opId = null; if (h.status === 'assigned') h.status = 'ready'; }
}
const ROUTINE_KINDS = Object.freeze(['patrol', 'exploration', 'return', 'delivery', 'construction', 'transport', 'area_patrol']);
function currentSystem(a) { return a.itinerary[a.pos]?.systemIndex; }
// Runs the hull one leg: a day's jump to the next system, through every blockade that bears on it, with
// the same interception engine every other runner uses.
function stepAssignment(book, world, db, a, day, effects) {
  const h = liveHull(book, a.polity, a.hullId);
  if (!h || h.opId !== a.id) return;
  if (a.kind === 'escort' && a.joined) return; // it travels with its charge, moved in the charge's own step
  if (classifyDamage(h.hull, h.maxHull) !== 'operational') return; // disabled where it is
  if (hullAwaitingCrew(h)) return; // repaired but not yet crewed: it waits in the yard (PHASE3 §1a)
  if (h.status !== 'assigned') h.status = 'assigned'; // a repair tick does not release it
  // Disabled on arriving at a stop and repaired there: it reports in from the stop it did reach.
  const here = a.milestones.find((x) => x.stopIndex === a.pos && (x.status === 'pending' || x.status === 'missed'));
  if (here && Number(h.systemIndex) === Number(currentSystem(a))) meetMilestone(book, world, db, a, h, here, day, effects);
  if (day < a.nextDay) return;
  if (a.dwellLeft > 0) { a.dwellLeft--; a.nextDay = day + 1; if (a.dwellLeft > 0 || a.pos < a.itinerary.length - 1) return; }
  if (a.pos >= a.itinerary.length - 1) {
    // A job that ends with a stay at its last stop is done when the stay is.
    if (a.dwellLeft <= 0 && ROUTINE_KINDS.includes(a.kind) && !a.objectiveId && a.milestones.every((m) => m.status === 'met' || m.status === 'superseded')) endAssignment(db, book, a, day, 'completed', 'itinerary complete');
    return;
  }
  const next = a.itinerary[a.pos + 1];
  // Escorts that have joined this charge sail with it, and run what it runs.
  const escorts = joinedEscortsOf(book, db, a).filter((x) => Number(x.h.systemIndex) === Number(h.systemIndex));
  // A blockade at the next system bears on this sponsor's ship as it arrives.
  for (const b of applicableBlockadesAt(book, world, next.systemIndex, a.polity)) {
    const runner = { key: `${a.id}:${a.pos + 1}:${day}`, sponsor: a.polity, kind: 'doctrine', hulls: [{ hullId: h.id, vid: vidOf(h), shipId: h.shipId, hull: h.hull, maxHull: h.maxHull, crew: h.crew, role: a.doctrineRole },
      ...escorts.map((x) => ({ hullId: x.h.id, vid: vidOf(x.h), shipId: x.h.shipId, hull: x.h.hull, maxHull: x.h.maxHull, crew: x.h.crew, role: 'escort' }))] };
    const r = resolveBlockadeRun(book, world, b, runner, day, effects, { meta: { doctrineAssignmentId: a.id, objectiveId: a.objectiveId } });
    db.stats.blockadeRuns++;
    a.runs.push({ day, blockadeId: b.id, at: next.systemIndex, outcome: r.outcome });
    a.runs = a.runs.slice(-10);
    for (const e of escorts) {
      const ex = r.hulls.find((y) => y.hullId === e.h.id);
      if (ex && ex.condition === 'disabled') e.h.status = 'repairing';
    }
    const x = r.hulls.find((y) => y.hullId === h.id);
    // Fired on: the crew saw who did it.
    if (x && (x.condition !== 'operational' || Number(x.hull) < Number(x.before ?? x.hull))) interceptionWitnessed(book, world, db, a, b, day, effects);
    // Whatever the run does to the charge, its escorts were beside it: they end the day where it does.
    const escortsTo = (i) => { for (const e of escorts) if (e.h.status !== 'lost') e.h.systemIndex = Number(i); };
    if (x && x.condition === 'disabled') { h.status = 'repairing'; h.systemIndex = Number(next.systemIndex); escortsTo(next.systemIndex); a.pos += 1; a.dwellLeft = next.dwell; return; }
    if (x && x.condition === 'destroyed') { h.systemIndex = Number(next.systemIndex); escortsTo(next.systemIndex); return; }
    if (!r.continues) { a.nextDay = day + 1; return; } // turned back: tries again tomorrow from where it was
  }
  a.pos += 1;
  h.systemIndex = Number(next.systemIndex);
  a.dwellLeft = next.dwell;
  a.nextDay = day + 1;
  for (const e of escorts) if (classifyDamage(e.h.hull, e.h.maxHull) === 'operational' && e.h.status !== 'lost') e.h.systemIndex = Number(next.systemIndex);
  effects.push({ type: 'doctrineMoved', id: a.id, polity: a.polity, hullId: h.id, systemIndex: h.systemIndex, day, kind: a.kind, objectiveId: a.objectiveId });
  // Milestone: the owner hears from it when it reaches the stop.
  // A superseded expectation (the plan changed) is never met; only the current plan's milestones count.
  const m = a.milestones.find((x) => x.stopIndex === a.pos && (x.status === 'pending' || x.status === 'missed'));
  if (m) meetMilestone(book, world, db, a, h, m, day, effects);
  if (a.pos >= a.itinerary.length - 1 && a.dwellLeft <= 0 && ROUTINE_KINDS.includes(a.kind) && !a.objectiveId) endAssignment(db, book, a, day, 'completed', 'itinerary complete');
}
function meetMilestone(book, world, db, a, h, m, day, effects) {
  m.status = 'met'; m.metDay = day;
  a.lastReport = { systemIndex: h.systemIndex, locationId: locationIdFor(world, h.systemIndex), day };
  onMilestoneMet(book, world, db, a, m, day, effects);
  onContractMilestone(book, world, db, a, m, day, effects);
}
// A late check-in resolves the incident it caused: the owner has its ship back, and expects the rest of
// its itinerary from now on (so a later loss is a new miss, not one already counted).
function onMilestoneMet(book, world, db, a, m, day, effects) {
  let t = day;
  for (let i = a.pos + 1; i < a.itinerary.length; i++) {
    t += 1 + (i === a.pos + 1 ? a.itinerary[a.pos].dwell : 0) + (i > a.pos + 1 ? a.itinerary[i - 1].dwell : 0);
    const later = a.milestones.find((x) => x.stopIndex === i && x.status === 'missed');
    if (later) { later.status = 'pending'; later.dueDay = t; later.rescheduled = day; }
  }
  const inc = db.incidents[incidentIdFor(a, m)] || Object.values(db.incidents).find((i) => i.assignmentId === a.id && i.status === 'open');
  for (const other of Object.values(db.incidents)) {
    if (other.assignmentId !== a.id) continue;
    const why = `${a.vid} reported at ${locationIdFor(world, currentSystem(a))}`;
    if (other.status === 'open') resolveIncident(book, world, db, other, day, 'asset_returned', why, effects);
    else if (other.resolution?.status === 'asset_located') {
      // Found disabled, and now it has reported in under way: it is back.
      other.resolution = { status: 'asset_returned', day, reason: why, previously: other.resolution };
      const k = knowledgeOf(db, other.detectedBy, other.id);
      if (k) { k.resolution = { status: 'asset_returned', day }; k.updatedDay = day; }
    }
  }
  return inc;
}

// ---------- ground truth: what happened to a vessel on assignment ----------
// Read once a day for every live assignment: is the hull still there to report? A loss leaves a wreck
// (evidence) where it happened; a disabled hull leaves its crew aboard (survivors); a destroyed one may
// leave escape pods. Nobody is told — detection below is the only way anyone learns.
function recordFates(book, world, db, day, effects = []) {
  for (const a of db.assignments) {
    if (a.status !== 'active' || db.ground.fates[a.id]) continue;
    const h = hullOf(book, a.polity, a.hullId);
    let fate = null;
    if (!h || h.status === 'lost') fate = h?.fate === 'captured' ? 'captured' : 'destroyed';
    else if (h.opId !== a.id && classifyDamage(h.hull, h.maxHull) === 'operational') fate = 'reassigned';
    else if (classifyDamage(h.hull, h.maxHull) === 'disabled') fate = 'disabled';
    if (!fate) continue;
    const where = h ? Number(h.systemIndex) : currentSystem(a);
    db.ground.fates[a.id] = { fate, day, systemIndex: where, hullId: a.hullId, vid: a.vid };
    if (fate === 'reassigned') { endAssignment(db, book, a, day, 'superseded', 'the vessel was given other orders', false); continue; }
    if (fate === 'captured') continue; // taken whole: no wreck, no crew adrift
    const shipFaction = world.shipStats?.(h?.shipId ?? a.shipId)?.faction || a.polity;
    const pods = fate === 'disabled' || (a.pods ?? (seededUnit(book.seed, 'doctrine-pods', a.id, day) < db.config.survivorPodChance));
    // Aboard a hulk, people last as long as its life support (the campaign's crew clock); in lifeboats, the
    // survivor window.
    const until = fate === 'disabled' && h?.stranded?.crewUntil != null ? h.stranded.crewUntil : day + db.config.survivorWindowDays;
    const site = addEvidence(book, world, db, { systemIndex: where, day, wreck: { vid: a.vid, hullId: a.hullId, polity: a.polity, shipId: h?.shipId ?? null, factionId: a.polity, designFaction: shipFaction, condition: fate }, survivors: pods ? { crew: true, untilDay: until, aboard: fate === 'disabled' ? a.hullId : null } : null, sourceAssignment: a.id });
    // Survivors call for help: a disabled ship on its own comms, a destroyed one's lifeboats on their beacon.
    if (pods && !a.silent) raiseDistress(book, world, db, { site, vid: a.vid, aboard: fate === 'disabled' ? a.hullId : null, polity: a.polity, role: { patrol: 'patrol', exploration: 'explorer', delivery: 'freighter', construction: 'construction_tender', transport: 'refugee_transport' }[a.kind] || 'other', day, urgency: fate === 'disabled' ? 'critical' : 'lifeboats' }, effects);
  }
  // A disabled hulk is not a permanent wreck: if it is repaired and leaves, or is lost after all, the
  // site changes with it. (Its crew were aboard; they leave with it, or are lost with it.)
  for (const site of Object.values(db.ground.evidence)) {
    for (const w of site.wrecks) {
      if (w.condition !== 'disabled' || !w.hullId) continue;
      const hh = hullOf(book, w.polity, w.hullId);
      const gone = !hh || hh.status === 'lost';
      const away = hh && !gone && (Number(hh.systemIndex) !== site.systemIndex || classifyDamage(hh.hull, hh.maxHull) === 'operational');
      const sv = site.survivors;
      // Only this hulk's crew go with it; anyone else waiting there stays.
      const crewGone = (status) => {
        if (!sv || sv.rescued || !(sv.aboardAll || (sv.aboard ? [sv.aboard] : [])).includes(w.hullId)) return;
        sv.aboardAll = (sv.aboardAll || [sv.aboard]).filter((x) => x !== w.hullId);
        if (!sv.aboardAll.length && !sv.lifeboats) sv.untilDay = Math.min(sv.untilDay, day - 1);
        for (const d of siteDistress(db, site)) if (d.status === 'open' && (d.aboard === w.hullId || (!d.aboard && !sv.aboardAll.length && !sv.lifeboats))) resolveIncident(book, world, db, d, day, status, `${w.vid} ${status === 'vessel_under_way' ? 'is under way again' : 'was lost'}`, effects);
      };
      if (gone) { w.condition = 'destroyed'; crewGone('lost_with_vessel'); }
      else if (away) {
        w.departed = day;
        crewGone('vessel_under_way');
        // Its fate is open again: whatever happens to it next is recorded where it happens.
        for (const [aid, f] of Object.entries(db.ground.fates)) if (f.hullId === w.hullId && f.fate === 'disabled') delete db.ground.fates[aid];
      }
    }
    site.wrecks = site.wrecks.filter((w) => !w.departed);
    // Nothing left there — no wreck, nobody waiting: the site is gone. There is nothing more to see.
    if (!site.wrecks.length && !(site.survivors && !site.survivors.rescued && site.survivors.untilDay >= day)) delete db.ground.evidence[site.id];
  }
}
function siteDistress(db, site) {
  const sv = site?.survivors;
  return [...new Set([...(sv?.distressIncidents || []), ...(sv?.distressIncident ? [sv.distressIncident] : [])])].map((id) => db.incidents[id]).filter(Boolean);
}
function openSiteDistress(db, site) { return siteDistress(db, site).find((i) => i.status === 'open') || null; }
function addEvidence(book, world, db, { systemIndex, day, wreck, survivors, sourceAssignment = null }) {
  const locationId = locationIdFor(world, systemIndex);
  // One site per location: wrecks accumulate at the same place.
  let site = Object.values(db.ground.evidence).find((e) => e.locationId === locationId && e.expiresDay >= day);
  if (!site) {
    const id = `ev:${locationId}:${day}:${Object.keys(db.ground.evidence).length + 1}`;
    site = db.ground.evidence[id] = { id, locationId, systemIndex: Number(systemIndex), createdDay: day, expiresDay: day + db.config.evidenceLifeDays, kind: 'debris', wrecks: [], survivors: null, examinedBy: [], sources: [] };
  }
  site.wrecks.push(wreck);
  // People waiting at one place may be several groups: crews aboard different hulks, lifeboats. Each hulk
  // is tracked, so one repaired ship leaving takes only its own crew with it.
  if (survivors) {
    const prev = site.survivors && !site.survivors.rescued && site.survivors.untilDay >= day ? site.survivors : null;
    const aboardAll = [...new Set([...(prev?.aboardAll || []), ...(survivors.aboard ? [survivors.aboard] : [])])];
    site.survivors = { ...(prev || {}), ...survivors, aboard: survivors.aboard ?? prev?.aboard ?? null, aboardAll, lifeboats: Boolean(prev?.lifeboats) || !survivors.aboard,
      untilDay: Math.max(prev?.untilDay ?? -1, survivors.untilDay), rescued: false, distressIncidents: [...(prev?.distressIncidents || [])] };
  }
  if (sourceAssignment) site.sources.push(sourceAssignment);
  site.expiresDay = Math.max(site.expiresDay, day + db.config.evidenceLifeDays);
  return site;
}
// A forced, unwitnessed loss for authored scenarios and the debug panel: the ship simply does not come
// back. Labelled as an override wherever it is offered.
export function loseAssignmentHullUnwitnessed(book, world, assignmentId, day, mode = 'destroyed', opts = {}) {
  const db = doctrineBook(book);
  const a = db.assignments.find((x) => x.id === assignmentId && x.status === 'active');
  if (!a) return { ok: false, reason: 'no such active assignment' };
  // Unwitnessed: nobody saw it. Its crew may still call for help unless its comms went with it.
  if (opts.silent) a.silent = true;
  if (opts.pods != null) a.pods = opts.pods;
  const h = liveHull(book, a.polity, a.hullId);
  if (!h) return { ok: false, reason: 'the vessel is already gone' };
  if (mode === 'disabled') { h.hull = Math.max(1, Math.floor(h.maxHull * 0.05)); h.status = 'repairing'; }
  else { h.status = 'lost'; h.hull = 0; h.opId = null; const p = book.polities[a.polity]; if (p) p.lostHulls = (p.lostHulls || 0) + 1; book.stats.hullsLost++; }
  return { ok: true, systemIndex: h.systemIndex, mode };
}

// ---------- detection ----------
// Who is physically there to see a site: vessels on a doctrine assignment at that system (their crews
// report to their command) and the command that holds the system (its own space).
function presentObservers(book, world, db, systemIndex) {
  const out = [];
  for (const a of db.assignments) {
    if (a.status !== 'active') continue;
    const h = liveHull(book, a.polity, a.hullId);
    if (!h || Number(h.systemIndex) !== Number(systemIndex) || classifyDamage(h.hull, h.maxHull) === 'destroyed') continue;
    if (db.ground.fates[a.id] && db.ground.fates[a.id].fate !== 'disabled') continue;
    out.push({ observerId: `hull:${h.id}`, polity: a.polity, assignment: a });
  }
  const ctrl = world.systems[Number(systemIndex)]?.controller;
  if (ctrl && ctrl !== 'player' && book.polities[ctrl]) out.push({ observerId: `command:${ctrl}`, polity: ctrl, assignment: null });
  return out;
}
function detectSites(book, world, db, day, effects) {
  for (const site of Object.values(db.ground.evidence)) {
    if (site.expiresDay < day || !site.wrecks.length) continue;
    for (const o of presentObservers(book, world, db, site.systemIndex)) {
      if (o.assignment && site.sources.includes(o.assignment.id)) continue; // its own wreck
      const sight = ((db.sightings ||= {})[o.observerId] ||= {});
      const first = !sight[site.id];
      const liveSurvivors = site.survivors && !site.survivors.rescued && site.survivors.untilDay >= day;
      sight[site.id] = { evidenceId: site.id, locationId: site.locationId, systemIndex: site.systemIndex, observedDay: day, provenance: 'direct_sensor', recoverable: true,
        // Seen, not recovered: debris is there; whose it is needs recovering it.
        wrecks: sight[site.id]?.wrecks || [], survivors: liveSurvivors ? { locationId: site.locationId, observedDay: day } : null };
      const keys = Object.keys(sight);
      if (keys.length > db.config.sightingLimit) delete sight[keys.sort((x, y) => (sight[x].observedDay ?? 0) - (sight[y].observedDay ?? 0))[0]];
      if (first) effects.push({ type: 'doctrineSighting', observerId: o.observerId, polity: o.polity, systemIndex: site.systemIndex, day });
      linkSightingToIncidents(book, world, db, o.observerId, sight[site.id], day);
      // People waiting there are seen by whoever is there: that is the distress incident, first hand.
      const dinc = liveSurvivors && (openSiteDistress(db, site) || distressFoundOnSite(book, world, db, site, o.observerId, day, effects));
      const seen = dinc && knowledgeOf(db, o.observerId, dinc.id);
      if (seen?.survivors && seen.survivors.locationId === site.locationId && !seen.survivors.rescued) { seen.survivors.observedDay = day; seen.updatedDay = day; }
      else if (dinc && dinc.detectedBy !== o.observerId) {
        const dk = learn(db, o.observerId, dinc, { provenance: 'direct_sensor', confidence: 'corroborated', day, observedDay: day, cause: 'survivors seen on the spot',
          claims: { lastKnown: { locationId: site.locationId, position: null, observedAt: at(day) }, ...(knowledgeOf(db, `beacon:${site.id}`, dinc.id)?.claims.asset ? { asset: knowledgeOf(db, `beacon:${site.id}`, dinc.id).claims.asset } : {}) } });
        dk.survivors = { locationId: site.locationId, observedDay: day, count: null, provenance: 'direct_sensor', rescued: false };
      }
      // A vessel's crew tells its own command.
      if (o.observerId.startsWith('hull:')) relaySightingToCommand(book, world, db, o, sight[site.id], day);
    }
  }
}
// A sighting attaches to an incident this observer already knows when the site lies on the incident's
// known route or at its last known area.
function linkSightingToIncidents(book, world, db, observerId, s, day) {
  const store = db.knowledge[observerId] || {};
  for (const k of Object.values(store)) {
    const inc = db.incidents[k.incidentId];
    if (!inc) continue;
    const area = new Set([k.lastKnownArea, k.claims.assignment?.destinationLocationId, k.claims.assignment?.originLocationId, ...(k.claims.route || [])].filter(Boolean));
    if (!area.has(s.locationId)) continue;
    // Seen before the ship's last report cannot be a trace of what happened after it.
    if ((s.observedDay ?? 0) < (k.claims.lastKnown?.observedAt?.value ?? -1)) continue;
    if (k.eventType !== 'asset_overdue') continue;
    const fresh = !k.evidence[s.evidenceId];
    mergeEvidence(k, { evidenceId: s.evidenceId, locationId: s.locationId, kind: 'debris', observedDay: s.observedDay, recoverable: s.recoverable, recovered: false, wrecks: s.wrecks || [], provenance: s.provenance });
    k.updatedDay = Math.max(k.updatedDay ?? 0, day);
    if (fresh) { k.version = (k.version || 0) + 1; k.lastChange = { day, cause: `debris seen at ${s.locationId}${s.via ? ` (via ${s.via})` : ''}` }; }
    refreshLinks(db, observerId, k);
  }
}
// Evidence seen before the incident was known links once it is: the sightings are the observer's own.
function relinkSightings(book, world, db, observerId, day) {
  for (const s of Object.values(db.sightings?.[observerId] || {})) linkSightingToIncidents(book, world, db, observerId, s, day);
}
function relaySightingToCommand(book, world, db, o, s, day) {
  const cmd = `command:${o.polity}`;
  const plan = deliveryPlan(book, world, db, { channel: 'network', sender: o.observerId, recipient: cmd }, day);
  if (!plan.reachable || plan.deliverDay > day) {
    // Queued: one pending sighting report per (site, crew); a fresher sighting replaces it.
    db.sightingQueue ||= [];
    const same = db.sightingQueue.find((q) => q.to === cmd && q.sighting.evidenceId === s.evidenceId && q.via === o.observerId);
    if (same) { same.sighting = { ...s }; return; } // the one already on its way carries the fresher sighting
    db.sightingQueue.push({ to: cmd, via: o.observerId, sighting: { ...s }, sentDay: day, deliverDay: plan.deliverDay });
    if (db.sightingQueue.length > 60) db.sightingQueue = db.sightingQueue.slice(-60);
    return;
  }
  applySightingReport(book, world, db, cmd, o.observerId, s, day);
}
function deliverSightings(book, world, db, day) {
  const keep = [];
  for (const q of db.sightingQueue || []) {
    if (q.deliverDay == null) { const plan = deliveryPlan(book, world, db, { channel: 'network', sender: q.via, recipient: q.to }, day); if (plan.reachable) q.deliverDay = Math.max(day, plan.deliverDay); }
    if (q.deliverDay != null && q.deliverDay <= day) applySightingReport(book, world, db, q.to, q.via, q.sighting, day);
    else if (day - q.sentDay <= db.config.messageExpiryDays) keep.push(q);
  }
  db.sightingQueue = keep;
}
function applySightingReport(book, world, db, cmd, via, s, day) {
  const sight = ((db.sightings ||= {})[cmd] ||= {});
  const prev = sight[s.evidenceId];
  sight[s.evidenceId] = { ...s, provenance: 'received_report', via, observedDay: Math.max(prev?.observedDay ?? 0, s.observedDay) };
  linkSightingToIncidents(book, world, db, cmd, sight[s.evidenceId], day);
}

// ---------- incidents ----------
export function incidentIdFor(a, m) { return `inc:overdue:${a.id}:${m.id}`; }
// Owner detection: a milestone past its due day plus grace, on the same clock, that its vessel never
// met. One persistent incident per asset/assignment/milestone.
function detectOverdue(book, world, db, day, effects) {
  for (const a of db.assignments) {
    if (a.status !== 'active') continue;
    for (const m of a.milestones) {
      if (m.status !== 'pending' || day <= m.dueDay + m.grace) continue;
      m.status = 'missed';
      const id = incidentIdFor(a, m);
      if (db.incidents[id]) continue; // never recreated
      // One incident per missing asset on an assignment: a later milestone it also misses is added to
      // the incident already open (or already answered) for it, never a second search.
      // Only while the owner still has it missing (open) or has found it lost: after it came back, a new
      // miss is a new disappearance.
      const existing = Object.values(db.incidents).find((i) => i.assignmentId === a.id && (i.status === 'open' || i.resolution?.status === 'asset_located'));
      if (existing) {
        (existing.alsoMissed ||= []).push({ milestoneId: m.id, kind: m.kind, dueDay: m.dueDay, detectedDay: day });
        bump(db, 'duplicatesPrevented');
        const ok = knowledgeOf(db, `command:${a.polity}`, existing.id);
        if (ok) { ok.claims.alsoMissed = [...(ok.claims.alsoMissed || []), { milestoneId: m.id, kind: m.kind, dueAt: at(m.dueDay), grace: m.grace, detectedAt: at(day) }]; ok.updatedDay = day; }
        continue;
      }
      const inc = db.incidents[id] = {
        id, eventType: 'asset_overdue', assetId: a.vid, hullId: a.hullId, polity: a.polity, assignmentId: a.id, milestoneId: m.id, contractId: a.contractId || null,
        locationId: m.locationId, jurisdictionAtOccurrence: jurisdictionAt(world, m.systemIndex), createdDay: day, detectedBy: `command:${a.polity}`,
        status: 'open', resolution: null, objectives: [],
      };
      db.stats.incidents++; bump(db, 'incidentsCreated'); bump(db, 'incidentsOverdue');
      const assetRole = { patrol: 'patrol', exploration: 'explorer', delivery: 'freighter', construction: 'construction_tender', transport: 'refugee_transport' }[a.kind] || 'other';
      const route = [...new Set(a.itinerary.map((s) => locationIdFor(world, s.systemIndex)))];
      learn(db, `command:${a.polity}`, inc, { provenance: 'direct_witness', confidence: 'corroborated', day, from: null, observedDay: day,
        claims: {
          asset: { assetId: a.vid, kind: 'ship', role: assetRole, ownerId: `polity:${a.polity}`, factionId: a.polity },
          assignment: { assignmentId: a.id, kind: { patrol: 'patrol', exploration: 'exploration', delivery: 'delivery', construction: 'construction', transport: 'evacuation' }[a.kind] || 'other', originLocationId: a.origin, destinationLocationId: a.destination, contractId: a.contractId || null },
          cargo: a.cargo, missedMilestone: { milestoneId: m.id, kind: m.kind, dueAt: at(m.dueDay), grace: m.grace }, detectedAt: at(day),
          lastKnown: { locationId: a.lastReport.locationId, position: null, observedAt: at(a.lastReport.day) }, route,
        } });
      relinkSightings(book, world, db, `command:${a.polity}`, day);
      effects.push({ type: 'doctrineIncident', id, polity: a.polity, locationId: inc.locationId, systemIndex: m.systemIndex, day });
      // The owner's command passes it to its own vessels at work (forwardToOwnVessels, over the network).
    }
  }
}
function ownVesselObservers(book, db, polity) {
  const out = new Set();
  for (const [hid] of Object.entries(db.designations?.[polity] || {})) out.add(`hull:${hid}`);
  // Only vessels its command still believes are at work: not one whose loss it has on record, nor the
  // missing ship an incident is about (the network cannot reach a hull that is gone either way).
  for (const a of db.assignments) if (a.status === 'active' && a.polity === polity && ['exploration', 'delivery', 'construction', 'transport', 'area_patrol'].includes(a.kind) && !a.milestones.some((m) => m.status === 'missed') && liveHull(book, polity, a.hullId)) out.add(`hull:${a.hullId}`);
  return [...out].sort();
}
// A command passes what it learns to its own vessels at work — over the network, so a ship far away
// hears later — and again when what it knows changes. Only its own vessels; never another power's.
function forwardToOwnVessels(book, world, db, day) {
  for (const [obs, store] of Object.entries(db.knowledge)) {
    if (!obs.startsWith('command:')) continue;
    const polity = obs.slice(8);
    const vessels = ownVesselObservers(book, db, polity);
    if (!vessels.length) continue;
    for (const k of Object.values(store)) {
      const inc = db.incidents[k.incidentId];
      if (!inc) continue;
      // What is settled and no longer changing is not news: only open matters, or a change of record.
      if (k.resolution && (k.forwardedVersion ?? 0) >= (k.version ?? 0)) continue;
      k.forwardedVersion = k.version;
      const kind = `internal:v${k.version}`;
      for (const to of vessels) if (!(inc.relays || []).includes(`${obs}|${to}|${kind}|v${k.version || 0}`)) sendReport(db, book, world, { incidentId: k.incidentId, from: obs, to, day, kind, include: REPORT_PROFILES.full, channel: 'network' });
    }
  }
}
function resolveIncident(book, world, db, inc, day, status, reason, effects, except = null) {
  if (inc.status !== 'open') return;
  inc.status = 'resolved'; inc.resolution = { status, day, reason };
  // The owner knows at once; anyone else learns it only if told. So only the owner's own searches are
  // called off — never another power's, which has not heard, and never the search that found the answer.
  const k = knowledgeOf(db, inc.detectedBy, inc.id);
  if (k) { k.resolution = { status, day }; k.updatedDay = day; }
  for (const oid of inc.objectives) {
    const o = db.objectives.find((x) => x.id === oid && x.status === 'active');
    // A defence whose threat ended or surrendered is not called off: that is its own success condition,
    // which its termination facts report (threat_ended / surrender_accepted).
    if (o && o.kind === 'defense' && ['threat_ended', 'surrendered'].includes(status)) continue;
    if (o && o.id !== except && o.polity === inc.polity) o.cancelRequested = `incident ${status}`;
  }
  effects.push({ type: 'doctrineIncidentResolved', id: inc.id, polity: inc.polity, status, day });
}

// ---------- routine generation (pilot) ----------
function freeHulls(book, db, polity) {
  const taken = strategicAssignments(book);
  return (book.polities[polity]?.hulls || []).filter((h) => h.status === 'ready' && !h.opId && !taken.has(h.id) && classifyDamage(h.hull, h.maxHull) === 'operational');
}
// Spare: never the last defenders of a held world.
function spareHulls(book, world, db, polity, pred = () => true) {
  const free = freeHulls(book, db, polity).filter(pred);
  const held = new Set(world.systems.filter((s) => s.controller === polity).map((s) => s.index));
  const per = {};
  for (const h of freeHulls(book, db, polity)) per[h.systemIndex] = (per[h.systemIndex] || 0) + 1;
  const floor = book.config.homeGarrisonPerWorld || 0;
  return free.filter((h) => !held.has(Number(h.systemIndex)) || per[h.systemIndex] > floor).sort((x, y) => String(x.id).localeCompare(String(y.id)));
}
function generateRoutine(doctrine, book, world, db, day, effects) {
  const c = db.config;
  const gen = (polity, generator) => {
    const prof = D.resolveProfile(doctrine, dominionContext(book, polity, db)).profileId;
    return prof && D.generatorAllowed(doctrine, prof, generator, { rosterEnabled: true, assignmentExists: true, budgetExists: true, scenarioActivated: dominionContext(book, polity, db).scenarioActivated === true });
  };
  for (const [polity, n] of Object.entries(c.patrols || {})) {
    if (!book.polities[polity] || !gen(polity, 'patrol')) continue;
    const p = book.polities[polity];
    if (day - (p.doctrinePatrolDay ?? -1e9) < c.patrolEveryDays) continue;
    if (db.assignments.filter((a) => a.status === 'active' && a.polity === polity && a.kind === 'patrol' && !a.milestones.some((m) => m.status === 'missed')).length >= n) continue;
    const spare = spareHulls(book, world, db, polity, (h) => (world.shipStats(h.shipId)?.combat ?? 1) >= 0.5);
    const from = [...new Set(spare.map((h) => Number(h.systemIndex)))].filter((i) => world.systems[i]?.controller === polity);
    const frontier = [];
    for (const i of from) for (const nb of world.neighbours(i)) if (world.systems[nb]?.controller !== polity) frontier.push({ from: i, to: Number(nb) });
    if (!frontier.length) continue;
    const pick = frontier.sort((x, y) => x.to - y.to || x.from - y.from)[Math.floor(seededUnit(book.seed, 'doctrine-patrol', polity, day) * frontier.length)];
    const hull = spare.find((h) => Number(h.systemIndex) === pick.from);
    if (!hull) continue;
    const r = issueAssignment(book, world, { polity, hullId: hull.id, kind: 'patrol', doctrineRole: 'patrol',
      stops: [{ systemIndex: pick.to, dwell: c.patrolDwellDays, milestone: 'arrival' }, { systemIndex: pick.from, dwell: 0, milestone: 'check_in' }] }, day, effects);
    if (r.ok) p.doctrinePatrolDay = day;
  }
  for (const [polity, n] of Object.entries(c.explorers || {})) {
    if (!book.polities[polity] || !gen(polity, 'traffic')) continue;
    const p = book.polities[polity];
    if (day - (p.doctrineSurveyDay ?? -1e9) < c.exploreEveryDays) continue;
    if (db.assignments.filter((a) => a.status === 'active' && a.polity === polity && a.kind === 'exploration' && !a.milestones.some((m) => m.status === 'missed')).length >= n) continue;
    const hull = spareHulls(book, world, db, polity)[0];
    if (!hull) continue;
    // A seeded walk outward without revisiting, then home the way it came.
    const path = [Number(hull.systemIndex)];
    for (let i = 0; i < c.exploreHops; i++) {
      const opts = world.neighbours(path.at(-1)).map(Number).filter((x) => !path.includes(x)).sort((a, b) => a - b);
      if (!opts.length) break;
      path.push(opts[Math.floor(seededUnit(book.seed, 'doctrine-survey', polity, day, i) * opts.length)]);
    }
    if (path.length < 2) continue;
    const stops = path.slice(1).map((s, i) => ({ systemIndex: s, dwell: c.exploreDwellDays, milestone: i === path.length - 2 ? 'arrival' : null }));
    stops.push({ systemIndex: path[0], dwell: 0, milestone: 'check_in' });
    const r = issueAssignment(book, world, { polity, hullId: hull.id, kind: 'exploration', doctrineRole: 'explorer', stops }, day, effects);
    if (r.ok) p.doctrineSurveyDay = day;
  }
  // Ferengi merchants: one freighter at a time on a contract to a port a few jumps off.
  for (const [polity, n] of Object.entries(c.merchants || {})) {
    if (!book.polities[polity] || !gen(polity, 'traffic')) continue;
    const p = book.polities[polity];
    if (day - (p.doctrineTradeDay ?? -1e9) < c.tradeEveryDays) continue;
    if (Object.values(db.contracts).filter((x) => x.status === 'active' && x.holder === polity && x.kind === 'delivery').length >= n) continue;
    const hull = spareHulls(book, world, db, polity).sort((x, y) => (world.shipStats(x.shipId)?.combat ?? 1) - (world.shipStats(y.shipId)?.combat ?? 1) || String(x.id).localeCompare(String(y.id)))[0];
    if (!hull) continue;
    const ports = [];
    for (const s of world.systems) {
      if (s.index === Number(hull.systemIndex) || !s.controller || atWar(world, polity, s.controller)) continue;
      const r = routeBetween(world, hull.systemIndex, s.index, polity);
      if (r && r.length - 1 >= 2 && r.length - 1 <= c.tradeHops) ports.push(s.index);
    }
    if (!ports.length) continue;
    ports.sort((x, y) => x - y);
    const r = issueDelivery(book, world, polity, hull.id, ports[Math.floor(seededUnit(book.seed, 'doctrine-trade', polity, day) * ports.length)], day, effects);
    if (r.ok) p.doctrineTradeDay = day;
  }
  // Tholian construction: one project at a time, from a held depot to a held site next door or nearby.
  for (const [polity, n] of Object.entries(c.projects || {})) {
    if (!book.polities[polity]) continue;
    const p = book.polities[polity];
    if (day - (p.doctrineProjectDay ?? -1e9) < c.projectEveryDays) continue;
    if (Object.values(db.contracts).filter((x) => x.status === 'active' && x.holder === polity && x.kind === 'construction').length >= n) continue;
    const free = freeHulls(book, db, polity);
    const held = world.systems.filter((s) => s.controller === polity).map((s) => s.index).sort((x, y) => x - y);
    let pick = null;
    for (const depot of held) {
      if (!free.some((h) => Number(h.systemIndex) === depot)) continue;
      const sites = held.filter((x) => x !== depot).map((x) => ({ x, r: routeBetween(world, depot, x, polity) })).filter((o) => o.r && o.r.length - 1 >= 1 && o.r.length - 1 <= 3);
      if (sites.length) { pick = { depot, site: sites[Math.floor(seededUnit(book.seed, 'doctrine-project', polity, day) * sites.length)].x }; break; }
    }
    if (!pick) continue;
    const r = startProject(book, world, polity, pick.depot, pick.site, day, effects);
    if (r.ok) p.doctrineProjectDay = day;
  }
  formPatrols(doctrine, book, world, db, day, effects, gen);
  // Relief ships are a designation on a home hull: it stays in the ordinary pool (and can be taken by
  // an operation), which is exactly why capacity is checked when a rescue is wanted.
  for (const [polity, n] of Object.entries(c.reliefShips || {})) {
    if (!book.polities[polity]) continue;
    const des = (db.designations[polity] ||= {});
    for (const hid of Object.keys(des)) if (!liveHull(book, polity, hid)) delete des[hid];
    const home = world.systems.filter((s) => s.controller === polity).map((s) => s.index);
    const live = (book.polities[polity].hulls || []).filter((h) => h.status !== 'lost' && home.includes(Number(h.systemIndex))).sort((x, y) => (x.opId ? 1 : 0) - (y.opId ? 1 : 0) || String(x.id).localeCompare(String(y.id)));
    for (const h of live) { if (Object.keys(des).length >= n) break; if (!des[h.id]) des[h.id] = 'relief'; }
  }
}

// ---------- distress: a persistent incident of its own ----------
// Survivors exist only where the ground says so (a disabled ship with its crew aboard, a lifeboat
// beacon, a disabled evacuation transport). What anyone knows of them comes from the call they send or
// from being there. The call carries what its senders actually know: who they are, where, that people
// are alive, how urgent, and any hazard at hand (a blockade they are inside). Never inferred from a
// ship's class, its faction or its disappearance.
export function distressIdFor(vid, day) { return `inc:distress:${vid}:${day}`; }
function raiseDistress(book, world, db, { site, vid, aboard = null, polity, role, day, urgency }, effects) {
  // One open distress incident per caller: a second call for the same people joins it.
  const existing = Object.values(db.incidents).find((i) => i.eventType === 'distress' && i.assetId === vid && i.status === 'open');
  if (existing) { bump(db, 'duplicatesPrevented'); if (!site.survivors.distressIncidents.includes(existing.id)) site.survivors.distressIncidents.push(existing.id); return existing; }
  const id = distressIdFor(vid, day);
  const inc = db.incidents[id] = { id, eventType: 'distress', assetId: vid, aboard, polity, siteId: site.id, locationId: site.locationId, jurisdictionAtOccurrence: jurisdictionAt(world, site.systemIndex),
    createdDay: day, detectedBy: `beacon:${site.id}`, status: 'open', resolution: null, objectives: [] };
  bump(db, 'incidentsCreated'); bump(db, 'incidentsDistress');
  site.survivors.distressIncidents.push(id);
  const hazards = applicableBlockadesAt(book, world, site.systemIndex, polity).map((b) => ({ kind: 'blockade', power: b.power, locationId: site.locationId }));
  const beacon = `beacon:${site.id}`;
  const k = learn(db, beacon, inc, { provenance: 'direct_witness', confidence: 'corroborated', day, observedDay: day, cause: 'distress call',
    claims: { asset: { assetId: vid, kind: 'ship', role: role || 'unknown', ownerId: polity ? `polity:${polity}` : null, factionId: polity || null },
      lastKnown: { locationId: site.locationId, position: null, observedAt: at(day) }, urgency: urgency || 'critical', hazards } });
  k.survivors = { locationId: site.locationId, observedDay: day, count: null, provenance: 'direct_witness', rescued: false };
  // Who hears it: anyone there now; the commands holding a system next door; the ship's own command.
  const recipients = new Set(presentObservers(book, world, db, site.systemIndex).filter((o) => o.assignment?.vid !== vid).map((o) => o.observerId));
  for (const nb of world.neighbours(site.systemIndex)) { const c = world.systems[Number(nb)]?.controller; if (c && c !== 'player' && book.polities[c]) recipients.add(`command:${c}`); }
  if (polity && book.polities[polity]) recipients.add(`command:${polity}`);
  for (const to of [...recipients].sort()) sendReport(db, book, world, { incidentId: id, from: beacon, to, day, kind: 'distress_call', include: REPORT_PROFILES.survivor_report, channel: 'broadcast' });
  effects.push({ type: 'doctrineVisible', kind: 'distress-call', incidentId: id, polity, assetFaction: polity, assetRole: role || 'ship', systemIndex: site.systemIndex, day });
  return inc;
}
// The ground settles a distress call: rescued, repaired and away, lost with the hull, or the window
// closed. The beacon falls silent; anyone else learns of it only by going there or being told.
function settleDistress(book, world, db, day, effects) {
  for (const inc of Object.values(db.incidents)) {
    if (inc.eventType !== 'distress' || inc.status !== 'open') continue;
    const site = db.ground.evidence[inc.siteId];
    const sv = site?.survivors;
    let status = null;
    if (!site || !sv) status = 'call_ended';
    else if (sv.rescued) status = 'survivors_rescued';
    else if (inc.aboard && !(sv.aboardAll || []).includes(inc.aboard)) status = 'vessel_under_way';
    else if (sv.untilDay < day) status = 'window_closed';
    if (status) resolveIncident(book, world, db, inc, day, status, `beacon ${site ? site.locationId : 'gone'}`, effects);
  }
}
// People found alive by someone on the spot, where no call went out (the ship's comms went with it): the
// finder opens the distress incident, knowing only what it saw — a hulk or lifeboats and people aboard.
// Whose ship it was is known only if the wreck has been examined (its registry read).
function distressFoundOnSite(book, world, db, site, observerId, day, effects, { identified = null } = {}) {
  const open = openSiteDistress(db, site);
  if (open) return open;
  const vid = identified?.vid || null;
  const id = distressIdFor(vid || `site-${slug(site.locationId)}`, day);
  if (db.incidents[id]) return db.incidents[id];
  const inc = db.incidents[id] = { id, eventType: 'distress', assetId: vid, polity: identified?.factionId || null, siteId: site.id, locationId: site.locationId, jurisdictionAtOccurrence: jurisdictionAt(world, site.systemIndex),
    createdDay: day, detectedBy: observerId, status: 'open', resolution: null, objectives: [], foundOnSite: true, aboard: null };
  bump(db, 'incidentsCreated'); bump(db, 'incidentsDistress');
  (site.survivors.distressIncidents ||= []).push(id);
  const hazards = applicableBlockadesAt(book, world, site.systemIndex, observerSide(book, observerId)).map((b) => ({ kind: 'blockade', power: b.power, locationId: site.locationId }));
  const k = learn(db, observerId, inc, { provenance: 'direct_sensor', confidence: 'corroborated', day, observedDay: day, cause: 'survivors found on the spot',
    claims: { asset: identified ? { assetId: identified.vid, kind: 'ship', role: 'unknown', ownerId: `polity:${identified.factionId}`, factionId: identified.factionId } : { assetId: null, kind: 'ship', role: 'unknown', ownerId: null, factionId: null },
      lastKnown: { locationId: site.locationId, position: null, observedAt: at(day) }, urgency: 'critical', hazards } });
  k.survivors = { locationId: site.locationId, observedDay: day, count: null, provenance: 'direct_sensor', rescued: false };
  const side = observerSide(book, observerId);
  if (observerId.startsWith('hull:') && side) sendReport(db, book, world, { incidentId: id, from: observerId, to: `command:${side}`, day, kind: 'survivor_report', include: REPORT_PROFILES.survivor_report, channel: 'network' });
  effects.push({ type: 'doctrineDistressFound', incidentId: id, observerId, systemIndex: site.systemIndex, day });
  return inc;
}
// Refugee transports disabled on an evacuation convoy's run send a distress call from where they lie.
function detectConvoyDistress(book, world, db, day, effects) {
  db.seenConvoyRemovals ||= {};
  for (const e of book.evacuations || []) {
    for (const r of e.removed || []) {
      if (r.reason !== 'disabled' || r.role !== 'transport' || r.at == null) continue;
      const key = `${e.id}|${r.hullId}|${r.day}`;
      if (db.seenConvoyRemovals[key]) continue;
      db.seenConvoyRemovals[key] = day;
      const h = hullOf(book, e.sponsor, r.hullId);
      if (!h || h.status === 'lost') continue;
      const site = addEvidence(book, world, db, { systemIndex: r.at, day, wreck: { vid: r.vid || vidOf(h), hullId: h.id, polity: e.sponsor, shipId: h.shipId, factionId: e.sponsor, designFaction: world.shipStats?.(h.shipId)?.faction || e.sponsor, condition: 'disabled' },
        survivors: { crew: true, refugees: true, untilDay: h.stranded?.crewUntil ?? day + db.config.survivorWindowDays, aboard: h.id } });
      raiseDistress(book, world, db, { site, vid: r.vid || vidOf(h), aboard: h.id, polity: e.sponsor, role: 'refugee_transport', day, urgency: 'critical' }, effects);
    }
  }
  const keys = Object.keys(db.seenConvoyRemovals);
  if (keys.length > 200) for (const k of keys.sort((a, b) => db.seenConvoyRemovals[a] - db.seenConvoyRemovals[b]).slice(0, keys.length - 200)) delete db.seenConvoyRemovals[k];
}

// ---------- contracts and projects: the commercial pilot ----------
// A contract is a real, persistent commitment carried by real hulls: a Ferengi delivery (one freighter,
// a cargo, a destination, a due day) or a Tholian construction project (tenders carrying materials from
// a depot to a site, one after another). Contracts decide `contract_affected`; they do not pay or cost
// anything this round (economic settlement is deferred and documented).
function contractOf(db, id) { return id ? db.contracts[id] || null : null; }
function newContract(book, db, spec, day) {
  const id = nid(book, db, 'con');
  const c = db.contracts[id] = { id, status: 'active', createdDay: day, closedDay: null, closeReason: null, assignments: [], delivered: 0, ...spec };
  bump(db, 'contractsOpened');
  return c;
}
function closeContract(db, c, day, status, reason) {
  if (!c || c.status !== 'active') return;
  c.status = status; c.closedDay = day; c.closeReason = reason;
}
export function issueDelivery(book, world, polity, hullId, destination, day, effects = [], opts = {}) {
  const db = doctrineBook(book);
  const h = liveHull(book, polity, hullId);
  if (!h || h.opId || h.status !== 'ready') return { ok: false, reason: 'vessel is not free' };
  const route = routeBetween(world, h.systemIndex, destination, polity);
  if (!route) return { ok: false, reason: 'no route' };
  const cargo = opts.cargo || { knowledge: 'verified', manifest: [{ cargoId: 'trade-goods', quantity: Math.max(1, Math.round(Number(world.shipStats(h.shipId)?.cargo) || 100)) }] };
  const c = newContract(book, db, { kind: 'delivery', holder: polity, origin: Number(h.systemIndex), destination: Number(destination), originLocationId: locationIdFor(world, h.systemIndex), destinationLocationId: locationIdFor(world, destination),
    dueDay: day + 1 + (route.length - 1) + (opts.slack ?? db.config.deliverySlackDays), cargo: cargo.manifest }, day);
  const r = issueAssignment(book, world, { polity, hullId, kind: 'delivery', doctrineRole: 'civilian', contractId: c.id, cargo, loadDays: 1,
    stops: [{ systemIndex: destination, dwell: 1, milestone: 'arrival' }, { systemIndex: h.systemIndex, dwell: 0, milestone: 'check_in' }] }, day, effects);
  if (!r.ok) { delete db.contracts[c.id]; return r; }
  c.assignments.push(r.assignment.id);
  return { ok: true, contract: c, assignment: r.assignment };
}
export function startProject(book, world, polity, depot, site, day, effects = [], opts = {}) {
  const db = doctrineBook(book);
  const c = newContract(book, db, { kind: 'construction', holder: polity, origin: Number(depot), destination: Number(site), originLocationId: locationIdFor(world, depot), destinationLocationId: locationIdFor(world, site),
    deliveriesNeeded: opts.deliveries ?? db.config.projectDeliveries, dueDay: day + (opts.days ?? db.config.projectDays), cargo: [{ cargoId: 'construction-materials', quantity: null }] }, day);
  const t = issueTender(book, world, db, c, day, effects, opts.hullId);
  return { ok: true, contract: c, tender: t };
}
// The next tender of a project: an existing free hull at the depot carries the next load.
function issueTender(book, world, db, c, day, effects, hullId = null) {
  if (c.status !== 'active' || c.kind !== 'construction') return null;
  if (c.assignments.some((id) => { const a = db.assignments.find((x) => x.id === id); return a && a.status === 'active' && !a.milestones.some((m) => m.status === 'missed'); })) return null;
  const pick = hullId ? liveHull(book, c.holder, hullId) : freeHulls(book, db, c.holder).filter((h) => Number(h.systemIndex) === c.origin).sort((x, y) => (world.shipStats(x.shipId)?.combat ?? 1) - (world.shipStats(y.shipId)?.combat ?? 1) || String(x.id).localeCompare(String(y.id)))[0];
  if (!pick || pick.opId) return null;
  const r = issueAssignment(book, world, { polity: c.holder, hullId: pick.id, kind: 'construction', doctrineRole: 'civilian', contractId: c.id, cargo: { knowledge: 'verified', manifest: c.cargo }, loadDays: 1,
    stops: [{ systemIndex: c.destination, dwell: 1, milestone: 'arrival' }, { systemIndex: c.origin, dwell: 0, milestone: 'check_in' }] }, day, effects);
  if (!r.ok) return null;
  c.assignments.push(r.assignment.id);
  return r.assignment;
}
// A contract's progress is read off its assignments: a delivery arrives, a tender unloads.
function onContractMilestone(book, world, db, a, m, day, effects) {
  const c = contractOf(db, a.contractId);
  if (!c || c.status !== 'active' || m.kind !== 'arrival' || Number(m.systemIndex) !== c.destination) return;
  c.delivered = (c.delivered || 0) + 1;
  if (c.kind === 'delivery') closeContract(db, c, day, 'completed', `delivered at ${c.destinationLocationId}`);
  else if (c.delivered >= c.deliveriesNeeded) closeContract(db, c, day, 'completed', `${c.delivered} loads delivered`);
  effects.push({ type: 'doctrineContract', id: c.id, kind: c.kind, polity: c.holder, status: c.status, delivered: c.delivered, day });
}
function advanceContracts(book, world, db, day, effects) {
  for (const c of Object.values(db.contracts)) {
    if (c.status !== 'active') continue;
    if (day > c.dueDay + db.config.contractGraceDays) { closeContract(db, c, day, 'failed', 'past its due day'); effects.push({ type: 'doctrineContract', id: c.id, kind: c.kind, polity: c.holder, status: c.status, day }); continue; }
    // A project keeps a load moving: when the last tender is home, or has gone overdue, the next goes out.
    if (c.kind === 'construction') issueTender(book, world, db, c, day, effects);
  }
  // Bounded: closed contracts leave once nothing names them.
  const named = new Set([...db.assignments.map((a) => a.contractId), ...Object.values(db.incidents).map((i) => i.contractId)].filter(Boolean));
  const closed = Object.values(db.contracts).filter((c) => c.status !== 'active' && !named.has(c.id)).sort((a, b) => a.closedDay - b.closedDay);
  for (const c of closed.slice(0, Math.max(0, closed.length - db.config.closedContractLimit))) delete db.contracts[c.id];
}
// The contracts an observer holds: a command, those it issued; a vessel, the one it is carrying.
function contractsHeldBy(book, db, observerId) {
  const [kind, id] = String(observerId).split(/:(.+)/);
  if (kind === 'command') return Object.values(db.contracts).filter((c) => c.holder === id && c.status === 'active');
  if (kind === 'hull') { const a = activeAssignmentFor(db, id); const c = a && contractOf(db, a.contractId); return c && c.status === 'active' ? [c] : []; }
  return [];
}
// Where a contract still has to go, as its holder knows it: the remaining stops of its live assignments.
function contractRouteAhead(book, world, db, c, observerId) {
  const locs = new Set();
  for (const aid of c.assignments) {
    const a = db.assignments.find((x) => x.id === aid);
    if (!a || a.status !== 'active') continue;
    if (String(observerId).startsWith('hull:') && a.hullId !== observerId.slice(5)) continue;
    for (let i = a.pos + 1; i < a.itinerary.length; i++) locs.add(locationIdFor(world, a.itinerary[i].systemIndex));
  }
  locs.add(c.destinationLocationId);
  return locs;
}
// The places an incident threatens, as this observer knows them: for a missing ship, the stretch between
// where it was last heard from and where it failed to report (it went missing somewhere on that way); for a
// distress call, the place it came from.
function incidentArea(world, db, k) {
  const inc = db.incidents[k.incidentId];
  const ends = [...new Set([k.lastKnownArea, inc?.locationId].filter(Boolean))];
  if (ends.length < 2) return ends;
  const [a, b] = ends.map((l) => systemIndexForLocation(db, l));
  const owner = k.claims.asset?.factionId || null;
  const path = a != null && b != null ? routeBetween(world, a, b, owner) : null;
  return path ? [...new Set(path.map((i) => locationIdFor(world, i)))] : ends;
}
function contractAffected(book, world, db, observerId, k) {
  const held = contractsHeldBy(book, db, observerId);
  if (!held.length) return { affected: false, why: 'holds no active contract' };
  const theirs = k.claims.assignment?.contractId || null;
  for (const c of held) {
    if (theirs && c.id === theirs) return { affected: true, contract: c, why: `the missing ship carries its contract ${c.id}` };
    const ahead = contractRouteAhead(book, world, db, c, observerId);
    const hit = incidentArea(world, db, k).find((l) => ahead.has(l));
    if (hit) return { affected: true, contract: c, why: `its contract ${c.id} runs through ${hit}` };
  }
  return { affected: false, why: 'the incident is off its contracts\' routes' };
}

// ---------- military (phase 3): attacks, defence, area patrols, authorised raids ----------
// Doctrine decides how an authorised military objective is carried out; it never manufactures the
// authority. Authority comes from: formal war (a stamped war order), witnessed aggression on one's own
// assets (defence of an own world), an explicit order (a campaign raid order), an escort obligation.
// Static hostility alone creates nothing.
const MILITARY_EVENTS = Object.freeze(['asset_attack', 'border_breach']);
function isMilitaryIncident(inc) { return Boolean(inc) && MILITARY_EVENTS.includes(inc.eventType); }
function sysName(world, i) { return world.systems[Number(i)]?.name || `system ${i}`; }
// Why this observer must defend a place, or null: its own world (a command, or a vessel of that power's
// patrol whose area includes it). Same flag is not same command: only the holder's own command and its
// own patrols carry the obligation.
function defenseObligation(book, world, db, observerId, systemIndex) {
  if (systemIndex == null) return null;
  const side = observerSide(book, observerId);
  const holder = world.systems[Number(systemIndex)]?.controller;
  if (!side || holder !== side) return null;
  if (observerId.startsWith('command:')) return `own world ${sysName(world, systemIndex)}`;
  const pat = patrolOfHull(db, observerId.slice(5));
  if (pat && pat.area.includes(Number(systemIndex))) return `own world ${sysName(world, systemIndex)} in its patrol area`;
  return null;
}
function patrolOfHull(db, hullId) { return Object.values(db.patrols || {}).find((p) => p.hullId === hullId && ['patrolling', 'responding'].includes(p.status)) || null; }
// An attack is seen by whoever is there: the holder of the system (its own space) and doctrine vessels
// present. They see who attacked (the ships are identified by sensor), not why.
function witnessAttack(book, world, db, { id, source, sourceId, attackerFaction, systemIndex, day, force }, effects) {
  const holder = world.systems[Number(systemIndex)]?.controller;
  let inc = db.incidents[id];
  if (!inc) {
    if (!holder || holder === attackerFaction || !book.polities[holder]) return null;
    inc = db.incidents[id] = { id, eventType: 'asset_attack', assetId: locationIdFor(world, systemIndex), polity: holder, source, sourceId, locationId: locationIdFor(world, systemIndex),
      jurisdictionAtOccurrence: jurisdictionAt(world, systemIndex), createdDay: day, detectedBy: `command:${holder}`, status: 'open', resolution: null, objectives: [] };
    bump(db, 'incidentsCreated'); bump(db, 'incidentsAttack');
    effects.push({ type: 'doctrineIncident', id, polity: holder, locationId: inc.locationId, systemIndex: Number(systemIndex), day, eventType: 'asset_attack' });
  }
  const claims = { asset: { assetId: inc.assetId, kind: 'world', role: 'world', ownerId: `polity:${inc.polity}`, factionId: inc.polity },
    lastKnown: { locationId: inc.locationId, position: null, observedAt: at(day) }, attacker: { factionId: attackerFaction, identified: true, force, provenance: 'direct_sensor' } };
  const witnesses = new Set(presentObservers(book, world, db, systemIndex).map((o) => o.observerId));
  for (const obs of witnesses) {
    if (observerSide(book, obs) === attackerFaction) continue;
    const had = knowledgeOf(db, obs, id);
    if (had && had.updatedDay === day) continue;
    const k = learn(db, obs, inc, { provenance: 'direct_witness', confidence: 'corroborated', day, observedDay: day, claims, cause: had ? 'attack still under way' : 'attack witnessed' });
    if (!had) k.version = 1;
    k.attribution ||= { factionId: attackerFaction, provenance: 'direct_sensor', day };
  }
  inc.lastSeenDay = day;
  return inc;
}
function detectAttacks(book, world, db, day, effects) {
  if (db.config.militaryResponses === false) return;
  // A campaign operation engaged at somebody's world.
  for (const op of book.operations || []) {
    if (op.status !== 'engaged') continue;
    witnessAttack(book, world, db, { id: `inc:attack:${op.id}`, source: 'operation', sourceId: op.id, attackerFaction: op.faction, systemIndex: op.targetSystem, day, force: (op.hullIds || []).length }, effects);
  }
  // A doctrine raid on station at its target.
  for (const o of db.objectives) {
    if (o.status !== 'active' || o.kind !== 'raid' || !['engaged', 'shadowing'].includes(o.state)) continue;
    // A raid whose war authority ended today is standing down: it attacks nobody any more.
    if (o.cancelRequested || !warAuthorityHolds(book, world, o.authority?.stamp)) continue;
    witnessAttack(book, world, db, { id: `inc:attack:${o.raid.id}`, source: 'raid', sourceId: o.id, attackerFaction: o.polity, systemIndex: o.target.systemIndex, day, force: 1 }, effects);
  }
  // The attack ends: the holder sees it end in its own space (the force withdrew, was destroyed, stood
  // down, surrendered — or took the world).
  for (const inc of Object.values(db.incidents)) {
    if (!isMilitaryIncident(inc) || inc.status !== 'open') continue;
    let ended = null;
    if (inc.source === 'operation') { const op = (book.operations || []).find((x) => x.id === inc.sourceId); if (!op || op.status === 'resolved') ended = op?.outcome === 'captured' ? 'world_fell' : op?.outcome === 'surrendered' ? 'surrendered' : 'threat_ended'; }
    else if (inc.source === 'raid') { const o = db.objectives.find((x) => x.id === inc.sourceId); if (!o || o.status !== 'active' || !['engaged', 'shadowing'].includes(o.state) || o.cancelRequested || !warAuthorityHolds(book, world, o.authority?.stamp)) ended = 'threat_ended'; }
    else if (inc.source === 'interception' && day - (inc.lastSeenDay ?? inc.createdDay) >= 1) ended = 'threat_ended';
    if (!ended) continue;
    resolveIncident(book, world, db, inc, day, ended, `${inc.source} ${shortId(inc.sourceId)} ${ended.replace('_', ' ')}`, effects);
    // Everyone who is there sees it end.
    const where = systemIndexForLocation(db, inc.locationId);
    for (const o of presentObservers(book, world, db, where)) { const k = knowledgeOf(db, o.observerId, inc.id); if (k && !k.resolution) { k.resolution = { status: ended, day }; k.updatedDay = day; k.version = (k.version || 0) + 1; k.lastChange = { day, cause: `attack ${ended.replace('_', ' ')} (seen)` }; } }
  }
}
// A doctrine vessel fired on when running a blockade: its crew saw who (the blockading power).
function interceptionWitnessed(book, world, db, a, b, day, effects) {
  if (db.config.militaryResponses === false) return;
  const id = `inc:attack:${b.id}:${a.id}:${day}`;
  if (db.incidents[id]) return;
  const inc = db.incidents[id] = { id, eventType: 'asset_attack', assetId: a.vid, polity: a.polity, source: 'interception', sourceId: b.id, locationId: locationIdFor(world, b.target),
    jurisdictionAtOccurrence: jurisdictionAt(world, b.target), createdDay: day, lastSeenDay: day, detectedBy: `hull:${a.hullId}`, status: 'open', resolution: null, objectives: [] };
  bump(db, 'incidentsCreated'); bump(db, 'incidentsAttack');
  const obs = `hull:${a.hullId}`;
  const k = learn(db, obs, inc, { provenance: 'direct_witness', confidence: 'corroborated', day, observedDay: day, cause: 'fired on running a blockade',
    claims: { asset: { assetId: a.vid, kind: 'ship', role: a.doctrineRole, ownerId: `polity:${a.polity}`, factionId: a.polity }, lastKnown: { locationId: inc.locationId, position: null, observedAt: at(day) }, attacker: { factionId: b.power, identified: true, provenance: 'direct_sensor' } } });
  k.attribution = { factionId: b.power, provenance: 'direct_sensor', day };
  sendReport(db, book, world, { incidentId: id, from: obs, to: `command:${a.polity}`, day, kind: 'attack_report', include: REPORT_PROFILES.attack_report, channel: 'network' });
}
// An applicable surrender (authored or engine-reported): the attacking force stands down; those who
// accepted it know at once, and a defence objective under it closes.
export function recordSurrender(book, world, incidentId, day, { acceptedBy, effects = [] } = {}) {
  const db = doctrineBook(book);
  const inc = db.incidents[incidentId];
  if (!inc || !isMilitaryIncident(inc) || inc.status !== 'open') return { ok: false, reason: 'no open attack incident' };
  inc.surrender = { day, acceptedBy };
  if (inc.source === 'operation') standDownOperation(book, world, inc.sourceId, day, effects, 'surrendered', `The attacking force at ${inc.locationId} surrendered.`);
  for (const obs of [acceptedBy, `command:${inc.polity}`].filter(Boolean)) { const k = knowledgeOf(db, obs, incidentId); if (k) { k.surrender = { day, acceptedBy }; k.updatedDay = day; k.version = (k.version || 0) + 1; k.lastChange = { day, cause: 'surrender accepted' }; } }
  resolveIncident(book, world, db, inc, day, 'surrendered', `surrender accepted by ${acceptedBy}`, effects);
  return { ok: true };
}

// ----- area patrols -----
// A patrol is a persistent assignment of one armed vessel to a bounded area: a frontier world it holds
// and the systems next to it. It sails the area in cycles (out to one neighbour, back to its world to
// report in). It may break off for a response inside its area only, and returns to the area afterwards.
function patrolArea(world, polity, anchor) {
  return [Number(anchor), ...world.neighbours(Number(anchor)).map(Number).filter((n) => { const c = world.systems[n]?.controller; return !c || c === polity || !atWar(world, polity, c); })].filter((v, i, a) => a.indexOf(v) === i).sort((x, y) => x - y);
}
function formPatrols(doctrine, book, world, db, day, effects, gen) {
  const c = db.config;
  // Keep each standing patrol sailing — formed here or ordered — whatever this power's formation
  // settings: a cycle ended, the next begins from wherever the vessel is.
  for (const pat of Object.values(db.patrols)) {
    if (!['patrolling', 'responding'].includes(pat.status)) continue;
    const h = liveHull(book, pat.polity, pat.hullId);
    if (!h) { endPatrol(db, pat, day, 'vessel lost'); continue; }
    if (hullIsDisabled(h)) { endPatrol(db, pat, day, 'vessel disabled'); continue; }
    if (pat.status === 'patrolling' && !activeAssignmentFor(db, h.id) && !h.opId && h.status === 'ready') issuePatrolCycle(book, world, db, pat, day, effects);
  }
  for (const [polity, n] of Object.entries(c.patrolAreas || {})) {
    if (!book.polities[polity] || !gen(polity, 'patrol')) continue;
    const mine = Object.values(db.patrols).filter((p) => p.polity === polity && ['patrolling', 'responding'].includes(p.status));
    if (mine.length >= n) continue;
    const p = book.polities[polity];
    if (day - (p.doctrinePatrolAreaDay ?? -1e9) < c.patrolFormEveryDays) continue;
    const spare = spareHulls(book, world, db, polity, (h) => (world.shipStats(h.shipId)?.combat ?? 1) >= 0.5);
    const frontier = spare.map((h) => Number(h.systemIndex)).filter((i) => world.systems[i]?.controller === polity && world.neighbours(i).some((nb) => world.systems[Number(nb)]?.controller !== polity)).sort((x, y) => x - y);
    if (!frontier.length) continue;
    const anchor = frontier[Math.floor(seededUnit(book.seed, 'doctrine-patrol-area', polity, day) * frontier.length)];
    const hull = spare.find((h) => Number(h.systemIndex) === anchor);
    const id = nid(book, db, 'pat');
    const pat = db.patrols[id] = { id, polity, hullId: hull.id, vid: vidOf(hull), anchor, area: patrolArea(world, polity, anchor), status: 'patrolling', formedDay: day, cycles: 0, next: 0, responses: [], endedDay: null, endReason: null };
    p.doctrinePatrolAreaDay = day;
    bump(db, 'patrolsFormed');
    issuePatrolCycle(book, world, db, pat, day, effects);
  }
}
// An authored/debug patrol order: this vessel patrols the area around this world of its power's.
export function startAreaPatrol(book, world, polity, hullId, anchor, day, effects = []) {
  const db = doctrineBook(book);
  const h = liveHull(book, polity, hullId);
  if (!h || hullIsDisabled(h) || h.opId || h.status !== 'ready') return { ok: false, reason: 'the vessel is not free' };
  if (world.systems[Number(anchor)]?.controller !== polity) return { ok: false, reason: 'a patrol area is anchored on a world of its own power' };
  const id = nid(book, db, 'pat');
  const pat = db.patrols[id] = { id, polity, hullId: h.id, vid: vidOf(h), anchor: Number(anchor), area: patrolArea(world, polity, anchor), status: 'patrolling', formedDay: day, cycles: 0, next: 0, responses: [], endedDay: null, endReason: null };
  bump(db, 'patrolsFormed');
  const r = issuePatrolCycle(book, world, db, pat, day, effects);
  if (!r.ok) { endPatrol(db, pat, day, r.reason); return { ok: false, reason: r.reason }; }
  return { ok: true, patrol: pat };
}
function issuePatrolCycle(book, world, db, pat, day, effects) {
  const out = pat.area.filter((i) => i !== pat.anchor);
  const stops = [];
  if (out.length) { const nb = out[pat.next % out.length]; pat.next++; stops.push({ systemIndex: nb, dwell: db.config.patrolAreaDwellDays, milestone: 'arrival' }); }
  stops.push({ systemIndex: pat.anchor, dwell: db.config.patrolAreaDwellDays, milestone: 'check_in' });
  const r = issueAssignment(book, world, { polity: pat.polity, hullId: pat.hullId, kind: 'area_patrol', doctrineRole: 'patrol', patrolId: pat.id, stops }, day, effects);
  if (r.ok) { r.assignment.patrolId = pat.id; pat.cycles++; pat.assignmentId = r.assignment.id; }
  return r;
}
function endPatrol(db, pat, day, reason) {
  if (!['patrolling', 'responding'].includes(pat.status)) return;
  pat.status = 'ended'; pat.endedDay = day; pat.endReason = reason;
}
// A response that takes a patrol out of its area is not its to make.
function patrolBound(book, world, db, hullId, targetSystem) {
  const pat = patrolOfHull(db, hullId);
  if (!pat || targetSystem == null) return { ok: true, pat };
  if (pat.area.includes(Number(targetSystem))) return { ok: true, pat };
  const r = routeBetween(world, pat.anchor, targetSystem, pat.polity);
  if (r && r.length - 1 <= db.config.patrolResponseHops) return { ok: true, pat };
  return { ok: false, pat, reason: `outside its patrol area (${pat.area.map((i) => sysName(world, i)).join(', ')})` };
}

// ----- defence -----
function militaryBudget(db, polity, replacing = null) {
  return db.objectives.filter((o) => o.status === 'active' && o.polity === polity && o.military && o.id !== replacing).length;
}
function defenseCapacity(book, world, db, observerId, k, day) {
  const c = db.config;
  const out = { ok: false, response: 'protect', hullId: null, vid: null, reason: null };
  const inc = db.incidents[k?.incidentId];
  const target = systemIndexForLocation(db, inc?.locationId);
  const polity = observerSide(book, observerId);
  if (!polity || !book.polities[polity]) return { ...out, reason: 'no organisation behind this observer' };
  const obligation = defenseObligation(book, world, db, observerId, target);
  if (!obligation) return { ...out, reason: 'no defence obligation there' };
  if (k.resolution) return { ...out, reason: `the attack is known over (${k.resolution.status})` };
  if (Number(book.polities[polity].supply ?? 1) < c.minSupply) return { ...out, reason: 'supply too low' };
  let replacing = null;
  const candidates = [];
  if (observerId.startsWith('hull:')) {
    const hid = observerId.slice(5);
    const h = liveHull(book, polity, hid);
    if (!h || hullIsDisabled(h)) return { ...out, reason: 'vessel is not operational' };
    const bound = patrolBound(book, world, db, hid, target);
    if (!bound.ok) return { ...out, reason: bound.reason };
    const job = activeAssignmentFor(db, hid);
    if (job && h.opId === job.id) { const allow = commitmentAllows(db, hid, 'protect'); if (!allow.ok) return { ...out, reason: allow.reason, conflict: { committedTo: allow.com.label } }; replacing = allow.preempts?.objective?.id || null; }
    else if (h.opId || h.status !== 'ready') return { ...out, reason: `vessel committed to ${h.opId || h.status}` };
    candidates.push(h);
  } else {
    // Spare, armed, and never a world's last defenders — and never the ships already defending there.
    candidates.push(...spareHulls(book, world, db, polity, (h) => (world.shipStats(h.shipId)?.combat ?? 1) >= 0.5 && Number(h.systemIndex) !== Number(target)));
    if (!candidates.length) return { ...out, reason: 'no spare armed vessel (garrison floor kept)' };
  }
  const busy = militaryBudget(db, polity, replacing);
  if (busy >= c.maxMilitaryObjectivesPerPolity) return { ...out, reason: `military budget spent (${busy} military objectives running)` };
  // Never strip a world that is itself under attack (or being attacked from) to defend another.
  const threatened = new Set([
    ...Object.values(db.incidents).filter((i) => isMilitaryIncident(i) && i.status === 'open' && i.polity === polity && i.id !== inc.id).map((i) => systemIndexForLocation(db, i.locationId)),
    ...(book.operations || []).filter((op) => op.status !== 'resolved' && op.faction !== polity).map((op) => Number(op.targetSystem)),
  ].filter((x) => x != null).map(Number));
  let best = null;
  for (const h of candidates) {
    if (Number(h.systemIndex) !== Number(target) && threatened.has(Number(h.systemIndex))) continue;
    const route = routeBetween(world, h.systemIndex, target, polity);
    if (!route || route.length - 1 > c.defenseHops) continue;
    if (!best || route.length < best.route.length) best = { h, route };
  }
  if (!best) return { ...out, reason: `no vessel within ${c.defenseHops} jumps of ${sysName(world, target)} that is not needed where it is` };
  // A defence is sent to hold a world, not fed into a fight already lost: with the ship added, the defence
  // must stand within `defenseHopelessRatio` of the attack it faces.
  const attack = attackStrengthAt(book, world, db, inc);
  const defense = localDefenseStrength(book, world, target) + hullStrength(book, world, best.h);
  if (attack > 0 && attack > defense * c.defenseHopelessRatio) return { ...out, reason: `${sysName(world, target)} cannot be held with what is spare (attack ${Math.round(attack)} against ${Math.round(defense)})` };
  const allowed = observerId.startsWith('hull:') ? commitmentAllows(db, best.h.id, 'protect') : { ok: true };
  return { ok: true, response: 'protect', military: 'defense', hullId: best.h.id, vid: vidOf(best.h), route: best.route, hops: best.route.length - 1, target, obligation, preempts: allowed.preempts || null,
    reason: `${best.h.id} (${best.route.length - 1} jumps) to defend ${sysName(world, target)}${allowed.preempts ? ` — breaks off ${allowed.preempts.label}` : ''}` };
}
// The strength of the attack an incident is about, as the campaign counts it (the attacking hulls alive).
function attackStrengthAt(book, world, db, inc) {
  if (!inc) return 0;
  if (inc.source === 'operation') {
    const op = (book.operations || []).find((x) => x.id === inc.sourceId);
    if (!op) return 0;
    const pol = book.polities[op.faction];
    return (op.hullIds || []).map((id) => pol?.hulls.find((h) => h.id === id)).filter((h) => h && h.status !== 'lost' && !hullIsDisabled(h)).reduce((n, h) => n + hullStrength(book, world, h), 0);
  }
  if (inc.source === 'raid') {
    const o = db.objectives.find((x) => x.id === inc.sourceId);
    const h = o && liveHull(book, o.polity, o.assigned.hullId);
    return h && !hullIsDisabled(h) ? hullStrength(book, world, h) : 0;
  }
  return 0;
}
function startDefense(book, world, db, o, cap, day, effects) {
  const r = issueAssignment(book, world, { polity: o.polity, hullId: cap.hullId, kind: 'defense', doctrineRole: o.role === 'commander' ? 'defender' : o.role, objectiveId: o.id, stops: [{ systemIndex: cap.target, dwell: 0, milestone: 'arrival' }] }, day, effects);
  if (!r.ok) return r;
  o.assignmentId = r.assignment.id;
  o.kind = 'defense'; o.military = true; o.state = 'moving';
  o.target = { locationId: locationIdFor(world, cap.target), systemIndex: cap.target, area: [locationIdFor(world, cap.target)] };
  o.authority = { source: 'defense_obligation', detail: cap.obligation, jurisdiction: `authority:${world.systems[cap.target]?.controller}` };
  o.deadline = at(day + db.config.defenseDeadlineDays);
  o.fromSystem = r.assignment.itinerary[0].systemIndex;
  if (Number(o.fromSystem) === Number(cap.target)) arriveDefense(book, world, db, o, day, effects);
  effects.push({ type: 'doctrineVisible', kind: 'defense-departed', objectiveId: o.id, polity: o.polity, systemIndex: o.fromSystem, to: cap.target, day });
  return { ok: true };
}
function arriveDefense(book, world, db, o, day, effects) {
  const h = liveHull(book, o.polity, o.assigned.hullId);
  if (!h) return;
  h.defendingAt = Number(o.target.systemIndex);
  o.state = 'defending'; o.arrivedDay = day;
  o.actions.push({ day, action: 'defend', detail: `on station at ${o.target.locationId}; counts in its defence` });
  effects.push({ type: 'doctrineOnSite', id: o.id, polity: o.polity, response: 'protect', systemIndex: o.target.systemIndex, day, lead: 'defense' });
}

// ----- authorised raids -----
// The campaign's raid order: a bounded strike on one enemy world, by one named vessel, under a formal war
// with the world's holder. The order is refused without that war. Doctrine then carries it out — sails
// through the shared blockade engine, decides each day on station to engage, shadow or withdraw, and
// stops the moment the war authority ends (a ceasefire, a peace): nothing already under way strikes
// after that. The AI planner does not issue raid orders this round; the authored/debug order does.
export function orderRaid(book, world, { power, target, hullId, day, doctrine = null, by = 'campaign' }, effects = []) {
  const db = doctrineBook(book);
  const rec = { id: nid(book, db, 'raidorder'), power, target: Number(target), hullId, day, by, status: null, reason: null, objectiveId: null };
  db.raidOrders.push(rec); if (db.raidOrders.length > 30) db.raidOrders = db.raidOrders.slice(-30);
  const stamp = warAuthorityStamp(book, world, power, target);
  if (!stamp) { rec.status = 'refused'; rec.reason = `no formal war with the holder of ${sysName(world, target)}`; bump(db, 'raidOrdersRefused'); return { ok: false, reason: rec.reason, order: rec }; }
  const h = liveHull(book, power, hullId);
  if (!h || hullIsDisabled(h) || h.opId || h.status !== 'ready') { rec.status = 'refused'; rec.reason = 'the vessel is not free'; return { ok: false, reason: rec.reason, order: rec }; }
  const prof = doctrine ? D.resolveProfile(doctrine, dominionContext(book, power, db)).profileId : power;
  if (!isLive(db, prof, 'raider', 'raid')) { rec.status = 'shadow'; rec.reason = `raider execution is shadow-only for ${prof} this round`; return { ok: false, reason: rec.reason, order: rec }; }
  const id = nid(book, db, 'obj');
  const o = { id, incidentId: null, orderId: rec.id, template: 'raid', clock: CLOCK, actor: `command:${power}`, polity: power, profileId: prof, role: 'raider', response: 'raid', kind: 'raid', military: true,
    assigned: { hullId: h.id, vid: vidOf(h) }, target: { locationId: locationIdFor(world, target), systemIndex: Number(target), area: [locationIdFor(world, target)] },
    authority: { source: 'formal_war', stamp, detail: `formal war ${stamp.key} against ${stamp.holder}`, jurisdiction: `authority:${stamp.holder}` },
    createdDay: day, deadline: at(day + db.config.raidDeadlineDays), status: 'active', resolution: null, assignmentId: null, actions: [], dwellDays: 0, arrivedDay: null, workDays: 0, state: 'moving', strikeDays: 0,
    raid: { id: `${id}:raid`, faction: power, losses: 0, defenderLosses: 0 }, lead: 'raid' };
  const r = issueAssignment(book, world, { polity: power, hullId: h.id, kind: 'raid', doctrineRole: 'raider', objectiveId: id, stops: [{ systemIndex: target, dwell: 0, milestone: 'arrival' }] }, day, effects);
  if (!r.ok) { rec.status = 'refused'; rec.reason = r.reason; return { ok: false, reason: r.reason, order: rec }; }
  o.assignmentId = r.assignment.id; o.fromSystem = r.assignment.itinerary[0].systemIndex;
  o.actions.push({ day, action: 'assigned', detail: `raid on ${o.target.locationId} under ${o.authority.detail}` });
  db.objectives.push(o); db.stats.objectives++; bump(db, 'liveObjectives'); bump(db, 'militaryObjectives');
  rec.status = 'executing'; rec.objectiveId = id;
  effects.push({ type: 'doctrineObjective', id, incidentId: null, polity: power, response: 'raid', hullId: h.id, vid: o.assigned.vid, to: Number(target), day, status: 'active' });
  return { ok: true, objective: o, order: rec };
}
function advanceRaids(book, world, db, day, effects) {
  const c = db.config;
  for (const o of db.objectives) {
    if (o.status !== 'active' || o.kind !== 'raid') continue;
    // Authority first, every day: a raid whose war has ended does nothing more — not even a strike already
    // in reach.
    if (!warAuthorityHolds(book, world, o.authority.stamp)) {
      const rel = world.relation(relSide(world, o.polity), relSide(world, o.authority.stamp.holder));
      o.cancelRequested ||= `war authority ended (${o.polity}–${o.authority.stamp.holder}: ${rel})`;
      o.cancelledBy = 'authority';
      o.actions.push({ day, action: 'stand_down', detail: o.cancelRequested });
      continue;
    }
    const a = db.assignments.find((x) => x.id === o.assignmentId);
    const h = liveHull(book, o.polity, o.assigned.hullId);
    if (!a || !h || a.status !== 'active' || hullIsDisabled(h)) continue;
    if (Number(h.systemIndex) !== Number(o.target.systemIndex) || a.pos < a.itinerary.length - 1) continue;
    if (!o.arrivedDay) { o.arrivedDay = day; o.state = 'engaged'; }
    // On station: engage, shadow (hold, reassess) or withdraw — decided on what the raider sees there.
    const mine = hullStrength(book, world, h) * Math.max(0.35, Number(book.polities[o.polity]?.supply ?? 1));
    const defense = localDefenseStrength(book, world, o.target.systemIndex);
    const ratio = defense > 0 ? mine / defense : Infinity;
    if (ratio < c.raidMinRatio) { o.forceRatioPoor = true; o.state = 'withdrawing'; o.actions.push({ day, action: 'withdraw', detail: `force ratio ${ratio.toFixed(2)} < ${c.raidMinRatio}` }); continue; }
    if (ratio < c.raidEngageRatio) { o.state = 'shadowing'; o.actions.push({ day, action: 'shadow', detail: `force ratio ${ratio.toFixed(2)}: holding, not striking` }); continue; }
    o.state = 'engaged';
    const res = raidStrikeDay(book, world, o.raid, [h], o.target.systemIndex, day, effects);
    // The strike is seen where it lands, the day it lands.
    if (db.config.militaryResponses !== false) witnessAttack(book, world, db, { id: `inc:attack:${o.raid.id}`, source: 'raid', sourceId: o.id, attackerFaction: o.polity, systemIndex: o.target.systemIndex, day, force: 1 }, effects);
    o.strikeDays++;
    o.actions.push({ day, action: 'engage', detail: `strike ${o.strikeDays}/${c.raidStrikeDays}: defenders lost ${res.defenderLosses || 0}, raiders lost ${res.losses || 0}` });
    if (o.strikeDays >= c.raidStrikeDays) o.found = { complete: true };
    const hh = hullOf(book, o.polity, o.assigned.hullId);
    if (!hh || hh.status === 'lost' || hullIsDisabled(hh)) o.forceRatioPoor = true;
  }
}

// ---------- objective priority and conflict ----------
// A vessel already on a job keeps it. The job is authoritative unless an explicit rule lets the new
// response pre-empt it; otherwise the new response defers, and the conflict is recorded with its reason
// ("defer:investigate — vessel committed to escort objective 12"). Self-defence is never affected: it
// is the tactical engine's, not an objective.
export const PREEMPTION = Object.freeze({
  exploration: Object.freeze(['investigate', 'rescue']),   // a routine survey may be broken off
  patrol: Object.freeze(['investigate', 'rescue']),
  return: Object.freeze(['investigate', 'rescue', 'protect']),
  investigation: Object.freeze(['rescue']),                // lives before evidence: the one emergency rule
  area_patrol: Object.freeze(['investigate', 'protect', 'rescue']), // a patrol breaks off for a response in its own area
  rescue: Object.freeze([]), escort: Object.freeze([]), delivery: Object.freeze([]), construction: Object.freeze([]),
  defense: Object.freeze([]), raid: Object.freeze([]),
});
function commitmentOf(db, hullId) {
  const a = activeAssignmentFor(db, hullId);
  if (!a) return null;
  const o = a.objectiveId ? db.objectives.find((x) => x.id === a.objectiveId && x.status === 'active') : null;
  return { assignment: a, kind: a.kind, objective: o, label: `${o ? `${o.response === 'protect' ? 'escort' : o.response} objective ${shortId(o.id)}` : `${a.kind} ${shortId(a.id)}`}` };
}
function shortId(id) { return String(id).split(':').pop(); }
function recordConflict(db, entry) {
  db.conflicts.push(entry);
  if (db.conflicts.length > db.config.conflictLimit) db.conflicts = db.conflicts.slice(-db.config.conflictLimit);
}
// Can this committed vessel take the new response? { ok, preempts?, reason }
function commitmentAllows(db, hullId, response) {
  const com = commitmentOf(db, hullId);
  if (!com) return { ok: true };
  if ((PREEMPTION[com.kind] || []).includes(response)) return { ok: true, preempts: com };
  return { ok: false, reason: `vessel committed to ${com.label}`, com };
}

// ---------- reroute: a merchant keeps its contract away from the trouble ----------
function routeAvoiding(world, from, to, polity, avoid) {
  if (avoid.has(Number(to))) return null;
  const prev = new Map([[Number(from), null]]); const q = [Number(from)];
  while (q.length) {
    const cur = q.shift();
    if (cur === Number(to)) break;
    for (const n of world.neighbours(cur).map(Number)) if (!prev.has(n) && !avoid.has(n)) { prev.set(n, cur); q.push(n); }
  }
  if (!prev.has(Number(to))) return null;
  const path = []; for (let x = Number(to); x != null; x = prev.get(x)) path.unshift(x);
  return world.routeHops([Number(from)], Number(to), polity) == null ? null : path;
}
function rerouteCapacity(book, world, db, observerId, k, day) {
  const out = { ok: false, response: 'reroute', hullId: null, vid: null, reason: null };
  if (!String(observerId).startsWith('hull:')) return { ...out, reason: 'only the vessel carrying a contract reroutes it' };
  const hid = observerId.slice(5);
  const polity = observerSide(book, observerId);
  const h = liveHull(book, polity, hid);
  const a = activeAssignmentFor(db, hid);
  const c = a && contractOf(db, a.contractId);
  if (!h || !a || !c || c.status !== 'active' || a.kind !== 'delivery') return { ...out, reason: 'no active delivery to reroute' };
  if (classifyDamage(h.hull, h.maxHull) !== 'operational') return { ...out, reason: 'vessel is not operational' };
  if (a.objectiveId) return { ...out, reason: `delivery already rerouted (objective ${shortId(a.objectiveId)})` };
  const avoid = new Set(incidentArea(world, db, k).map((l) => systemIndexForLocation(db, l)).filter((x) => x != null));
  avoid.delete(Number(h.systemIndex));
  const deliveredYet = a.milestones.some((m) => m.kind === 'arrival' && m.status === 'met' && Number(m.systemIndex) === c.destination);
  const goal = deliveredYet ? c.origin : c.destination;
  const path = routeAvoiding(world, h.systemIndex, goal, polity, avoid);
  if (!path) return { ...out, reason: avoid.has(goal) ? `its ${deliveredYet ? 'home port' : 'destination'} is inside the trouble area` : 'no route around the trouble area' };
  const arrive = day + path.length - 1 + (a.dwellLeft || 0);
  if (!deliveredYet && arrive > c.dueDay + db.config.contractGraceDays) return { ...out, reason: `the way round arrives day ${arrive}, after the contract is due (day ${c.dueDay})` };
  return { ok: true, response: 'reroute', hullId: hid, vid: vidOf(h), route: path, avoid: [...avoid], goal, deliveredYet, reason: `${path.length - 1} jumps avoiding ${[...avoid].join(',')}` };
}
function applyReroute(book, world, db, o, cap, day, effects) {
  const a = activeAssignmentFor(db, cap.hullId);
  const c = contractOf(db, a.contractId);
  const here = a.itinerary[a.pos];
  const avoid = new Set(cap.avoid);
  const back = cap.deliveredYet ? [] : (routeAvoiding(world, c.destination, c.origin, a.polity, avoid) || routeBetween(world, c.destination, c.origin, a.polity) || [c.destination]);
  const legs = [{ systemIndex: here.systemIndex, dwell: 0, milestone: null }];
  cap.route.slice(1).forEach((s, i, arr) => legs.push({ systemIndex: s, dwell: i === arr.length - 1 && !cap.deliveredYet ? 1 : 0, milestone: i === arr.length - 1 ? (cap.deliveredYet ? 'check_in' : 'arrival') : null }));
  back.slice(1).forEach((s, i, arr) => legs.push({ systemIndex: s, dwell: 0, milestone: i === arr.length - 1 ? 'check_in' : null }));
  const oldRoute = a.itinerary.slice(a.pos).map((s) => s.systemIndex);
  // The same assignment, the same vessel, a new way: milestones still pending are re-expected on the new
  // schedule (the owner is told the new plan), so the change is not itself a missed milestone.
  // Every expectation of the old plan goes, a missed one too (its incident stays until the ship reports).
  for (const m of a.milestones) if (m.status === 'pending' || m.status === 'missed') m.status = 'superseded';
  a.itinerary = legs; a.pos = 0; a.dwellLeft = 0;
  let t = day;
  legs.forEach((stop, i) => {
    if (i > 0) t += 1;
    if (stop.milestone) a.milestones.push({ id: `${a.id}:m${a.milestones.length + 1}`, kind: stop.milestone, stopIndex: i, systemIndex: stop.systemIndex, locationId: locationIdFor(world, stop.systemIndex), dueDay: t, grace: stop.milestone === 'check_in' ? db.config.checkInGraceDays : db.config.arrivalGraceDays, status: 'pending', metDay: null, rerouted: day });
    t += stop.dwell;
  });
  a.objectiveId = o.id; a.rerouted = { day, avoid: cap.avoid, oldRoute, newRoute: legs.map((s) => s.systemIndex) };
  o.assignmentId = a.id; o.target = { locationId: locationIdFor(world, cap.goal), systemIndex: cap.goal, area: cap.avoid.map((i) => locationIdFor(world, i)) };
  o.reroute = { oldRoute, newRoute: legs.map((s) => s.systemIndex), avoid: cap.avoid };
  o.contractId = c.id;
  o.deadline = at(Math.max(c.dueDay + db.config.contractGraceDays, t));
  const inc = db.incidents[o.incidentId];
  const cause = inc?.eventType === 'asset_overdue' && inc.polity === a.polity && ['delivery', 'construction'].includes(db.assignments.find((x) => x.id === inc.assignmentId)?.kind) ? 'missed-delivery' : 'trouble';
  effects.push({ type: 'doctrineVisible', kind: 'reroute', objectiveId: o.id, polity: a.polity, systemIndex: here.systemIndex, day, cause, avoid: cap.avoid });
}

// ---------- escort: protection of a named charge ----------
// `protect` for a threatened contract is carried out as an escort of the contract's live delivery: a
// named charge (its assignment, hull and vid). The escort joins it where their routes meet, travels with
// it — the pair run any blockade together through the shared engine — and never leaves it to chase
// anything. It closes when the charge is safe, is lost, is cancelled, at the deadline, or when the
// escort can no longer do the job.
function chargeFor(book, world, db, observerId, k) {
  const aff = contractAffected(book, world, db, observerId, k);
  if (!aff.affected) return null;
  const lostHull = db.incidents[k.incidentId]?.hullId;
  for (const aid of [...aff.contract.assignments].reverse()) {
    const a = db.assignments.find((x) => x.id === aid);
    if (!a || a.status !== 'active' || a.hullId === lostHull || a.milestones.some((m) => m.status === 'missed')) continue;
    return { contract: aff.contract, assignment: a };
  }
  return { contract: aff.contract, assignment: null };
}
function escortCapacity(book, world, db, observerId, k, day) {
  const c = db.config;
  const out = { ok: false, response: 'protect', hullId: null, vid: null, reason: null };
  const polity = observerSide(book, observerId);
  if (!polity || !book.polities[polity]) return { ...out, reason: 'no organisation behind this observer' };
  const ch = chargeFor(book, world, db, observerId, k);
  if (!ch) return { ...out, reason: 'nothing of its own under threat' };
  if (!ch.assignment) return { ...out, reason: `no live delivery on contract ${shortId(ch.contract.id)} to protect` };
  if (db.objectives.some((o) => o.status === 'active' && o.response === 'protect' && o.charge?.assignmentId === ch.assignment.id)) return { ...out, reason: 'the charge already has an escort' };
  const budget = db.objectives.filter((o) => o.status === 'active' && o.polity === polity).length;
  if (budget >= c.maxLiveObjectivesPerPolity) return { ...out, reason: `operation budget spent (${budget} doctrine objective running)` };
  if (Number(book.polities[polity].supply ?? 1) < c.minSupply) return { ...out, reason: 'supply too low' };
  const chargeHull = liveHull(book, polity, ch.assignment.hullId);
  if (!chargeHull) return { ...out, reason: 'the charge is gone' };
  // Its way ahead up to the stop it must reach safely: meeting it there would protect nothing.
  const drop = ch.assignment.milestones.find((m) => m.kind === 'arrival' && m.status === 'pending');
  const all = ch.assignment.itinerary.slice(ch.assignment.pos).map((s) => Number(s.systemIndex));
  const ahead = all.slice(0, Math.max(1, drop ? all.indexOf(Number(drop.systemIndex)) : all.length - 1));
  const candidates = spareHulls(book, world, db, polity, (h) => (world.shipStats(h.shipId)?.combat ?? 1) >= 0.5 && h.id !== chargeHull.id);
  const committed = (book.polities[polity].hulls || []).filter((h) => h.status !== 'lost' && activeAssignmentFor(db, h.id)?.objectiveId).map((h) => commitmentOf(db, h.id).label);
  if (!candidates.length) return { ...out, reason: `no spare armed vessel (garrison floor kept${committed.length ? `; committed: ${committed.join(', ')}` : ''})` };
  // It must be able to meet the charge somewhere on the charge's way before the charge gets there.
  let best = null;
  for (const h of candidates) {
    for (let i = 0; i < ahead.length; i++) {
      const r = routeBetween(world, h.systemIndex, ahead[i], polity);
      if (!r || r.length - 1 > c.maxResponseHops) continue;
      if (r.length - 1 > i) continue; // would arrive after the charge has passed
      // The earliest place on the charge's way it can be there first: the charge is covered for longest.
      if (!best || i < best.i || (i === best.i && r.length - 1 < best.hops)) best = { h, meet: ahead[i], hops: r.length - 1, route: r, i };
      break;
    }
  }
  if (!best) return { ...out, reason: 'no spare vessel can meet the charge before it arrives' };
  return { ok: true, response: 'protect', hullId: best.h.id, vid: vidOf(best.h), route: best.route, hops: best.hops, meet: best.meet, charge: ch, reason: `${best.h.id} meets ${ch.assignment.hullId} at ${best.meet} (${best.hops} jumps)` };
}
function startEscort(book, world, db, o, cap, day, effects) {
  const ch = cap.charge.assignment;
  const nextDrop = ch.milestones.find((m) => m.kind === 'arrival' && m.status === 'pending');
  const dest = Number(nextDrop ? nextDrop.systemIndex : ch.itinerary.at(-1).systemIndex);
  // The escort sails to where it meets the charge; from there it travels with it.
  const r = issueAssignment(book, world, { polity: o.polity, hullId: cap.hullId, kind: 'escort', doctrineRole: 'escort', objectiveId: o.id, stops: [{ systemIndex: cap.meet, dwell: 0, milestone: 'arrival' }] }, day, effects);
  if (!r.ok) return r;
  r.assignment.follows = ch.id;
  o.assignmentId = r.assignment.id;
  o.charge = { assignmentId: ch.id, hullId: ch.hullId, vid: ch.vid, contractId: cap.charge.contract.id, destination: locationIdFor(world, dest) };
  o.target = { locationId: locationIdFor(world, dest), systemIndex: dest, area: [...new Set(ch.itinerary.slice(ch.pos).map((s) => locationIdFor(world, s.systemIndex)))] };
  o.escortState = 'joining';
  o.deadline = at(day + db.config.escortDeadlineDays);
  const eh = liveHull(book, o.polity, cap.hullId), chh = liveHull(book, o.polity, ch.hullId);
  if (eh && chh && Number(eh.systemIndex) === Number(chh.systemIndex)) joinEscort(world, o, r.assignment, eh, ch, day, effects);
  return { ok: true };
}
// Joined: from here the escort travels with its charge. The meeting point it was sailing for is no longer
// expected of it (it may have met the charge sooner), and the pair are seen sailing together.
function joinEscort(world, o, ea, eh, ca, day, effects) {
  o.escortState = 'escorting'; o.joinedDay = day; ea.joined = true;
  for (const m of ea.milestones) if (m.status === 'pending') m.status = 'superseded';
  o.actions.push({ day, action: 'escort', detail: `joined ${ca.hullId} at ${locationIdFor(world, eh.systemIndex)}` });
  effects.push({ type: 'doctrineVisible', kind: 'escort-assigned', objectiveId: o.id, polity: o.polity, chargeKind: ca.kind, systemIndex: Number(eh.systemIndex), day });
}
// Each day: an escort that has met its charge travels with it (moved in the charge's own step); one that
// has not, waits where they will meet.
function tickEscorts(book, world, db, day, effects = []) {
  for (const o of db.objectives) {
    if (o.status !== 'active' || o.response !== 'protect') continue;
    const ea = db.assignments.find((x) => x.id === o.assignmentId);
    const ca = db.assignments.find((x) => x.id === o.charge?.assignmentId);
    const eh = ea && liveHull(book, o.polity, ea.hullId), ch = ca && liveHull(book, o.polity, ca.hullId);
    if (!ea || !eh || !ca || !ch) continue;
    if (o.escortState === 'joining' && Number(eh.systemIndex) === Number(ch.systemIndex) && classifyDamage(eh.hull, eh.maxHull) === 'operational') joinEscort(world, o, ea, eh, ca, day, effects);
  }
}
function joinedEscortsOf(book, db, charge) {
  return db.objectives.filter((o) => o.status === 'active' && o.response === 'protect' && o.escortState === 'escorting' && o.charge?.assignmentId === charge.id)
    .map((o) => ({ o, a: db.assignments.find((x) => x.id === o.assignmentId) })).filter((x) => x.a && x.a.status === 'active')
    .map((x) => ({ ...x, h: liveHull(book, x.o.polity, x.a.hullId) })).filter((x) => x.h && classifyDamage(x.h.hull, x.h.maxHull) === 'operational');
}

// ---------- capacity: can_respond means something real ----------
// A suitable vessel exists, is not committed incompatibly, has a route, the supply and range to use
// it, and can reach the target before the objective's deadline. Otherwise the answer names what is
// missing and the response is deferred — nothing is ever spawned.
export function responseCapacity(book, world, db, observerId, response, target, day, k = null) {
  const c = db.config;
  if (response === 'reroute') return rerouteCapacity(book, world, db, observerId, k, day);
  if (response === 'protect') return isMilitaryIncident(db.incidents[k?.incidentId]) ? defenseCapacity(book, world, db, observerId, k, day) : escortCapacity(book, world, db, observerId, k, day);
  const polity = observerSide(book, observerId);
  const out = { ok: false, hullId: null, vid: null, route: null, reason: null, response };
  if (!polity || !book.polities[polity]) return { ...out, reason: 'no organisation behind this observer' };
  if (target?.systemIndex == null) return { ...out, reason: 'no known place to go' };
  const p = book.polities[polity];
  if (Number(p.supply ?? 1) < c.minSupply) return { ...out, reason: `supply ${Number(p.supply).toFixed(2)} below ${c.minSupply}` };
  // A vessel's own commitment is checked first: it is the more specific reason, and a job it may break
  // off does not count against the budget it would be replacing.
  let replacing = null;
  if (observerId.startsWith('hull:')) {
    const hid = observerId.slice(5);
    const h = liveHull(book, polity, hid);
    const job = h && activeAssignmentFor(db, hid);
    if (h && job && h.opId === job.id) {
      const allow = commitmentAllows(db, hid, response);
      if (!allow.ok) return { ...out, reason: allow.reason, conflict: { committedTo: allow.com.label } };
      replacing = allow.preempts?.objective?.id || null;
    }
  }
  const busy = db.objectives.filter((o) => o.status === 'active' && o.polity === polity && o.id !== replacing).length;
  if (busy >= c.maxLiveObjectivesPerPolity) return { ...out, reason: `operation budget spent (${busy} doctrine objective${busy > 1 ? 's' : ''} running)` };
  const deadlineDays = response === 'rescue' ? c.rescueDeadlineDays : c.investigationDeadlineDays;
  const dwell = response === 'rescue' ? c.rescueDwellDays : c.investigationDwellDays;
  const candidates = [];
  if (observerId.startsWith('hull:')) {
    // A vessel responds itself: free, or on a routine job it may break off (a survey, a relief standby).
    const hid = observerId.slice(5);
    const h = liveHull(book, polity, hid);
    if (!h) return { ...out, reason: 'the vessel is gone' };
    const job = activeAssignmentFor(db, hid);
    const allow = job && h.opId === job.id ? commitmentAllows(db, hid, response) : { ok: !h.opId && h.status === 'ready' };
    if (!allow.ok) return { ...out, reason: allow.reason || (h.opId ? `vessel committed to ${String(h.opId)}` : `vessel is ${h.status}`), conflict: allow.com ? { committedTo: allow.com.label } : null };
    if (classifyDamage(h.hull, h.maxHull) !== 'operational') return { ...out, reason: 'vessel is not operational' };
    const bound = patrolBound(book, world, db, hid, target.systemIndex);
    if (!bound.ok) return { ...out, reason: bound.reason };
    candidates.push(h);
  } else {
    // A command assigns one of its own spare, armed ships (never a world's last defenders).
    candidates.push(...spareHulls(book, world, db, polity, (h) => (world.shipStats(h.shipId)?.combat ?? 1) >= 0.5));
    if (!candidates.length) {
      const committed = (book.polities[polity].hulls || []).filter((h) => h.status !== 'lost' && activeAssignmentFor(db, h.id)?.objectiveId).map((h) => commitmentOf(db, h.id).label);
      return { ...out, reason: `no spare armed vessel (garrison floor kept${committed.length ? `; committed: ${committed.join(', ')}` : ''})` };
    }
  }
  let best = null;
  for (const h of candidates) {
    const route = routeBetween(world, h.systemIndex, target.systemIndex, polity);
    if (!route) continue;
    const hops = route.length - 1;
    if (hops > c.maxResponseHops) continue;
    if (!best || hops < best.route.length - 1) best = { h, route };
  }
  if (!best) return { ...out, reason: `no vessel with a route within ${c.maxResponseHops} jumps` };
  const hops = best.route.length - 1;
  const arrive = day + hops;
  if (arrive + dwell > day + deadlineDays) return { ...out, reason: `cannot finish before the deadline (${hops} jumps + ${dwell} days > ${deadlineDays})` };
  if (response === 'rescue' && target.survivorsUntil != null && arrive > target.survivorsUntil) return { ...out, reason: 'cannot reach the survivors in time' };
  const allowed = observerId.startsWith('hull:') ? commitmentAllows(db, best.h.id, response) : { ok: true };
  return { ok: true, hullId: best.h.id, vid: vidOf(best.h), route: best.route, hops, reason: `${best.h.id} (${hops} jumps)${allowed.preempts ? ` — breaks off ${allowed.preempts.label}` : ''}`, response, preempts: allowed.preempts || null };
}
function responseTarget(db, observerId, incidentId, response, day) {
  const k = knowledgeOf(db, observerId, incidentId);
  if (!k) return null;
  if (response === 'rescue') {
    const s = k.survivors;
    if (!s?.locationId) return null;
    return { locationId: s.locationId, systemIndex: systemIndexForLocation(db, s.locationId), survivorsUntil: (s.observedDay ?? day) + db.config.survivorWindowDays };
  }
  const since = k.claims.lastKnown?.observedAt?.value ?? -1;
  const ev = Object.values(k.evidence || {}).filter((e) => !e.recovered && (e.observedDay ?? day) >= since).sort((a, b) => (b.observedDay ?? 0) - (a.observedDay ?? 0))[0];
  // No lead: where the ship was last heard from, unless that is simply where it set out from, in which
  // case the place it was expected (the missed milestone's site).
  const lk = k.lastKnownArea, origin = k.claims.assignment?.originLocationId;
  const loc = ev?.locationId || (lk && lk !== origin ? lk : (db.incidents[incidentId]?.locationId || lk));
  if (!loc) return null;
  return { locationId: loc, systemIndex: systemIndexForLocation(db, loc), lead: ev ? 'evidence' : 'area' };
}
// Location ID → system index, derived from the world (never saved: it is the world's own naming).
const LOCATION_CACHE = new Map();
let currentLocations = null;
function systemIndexForLocation(db, locationId) { return currentLocations?.get(locationId) ?? null; }
function indexLocations(world, db) {
  delete db.locationIndex; delete db.locationIndexSize; // an earlier build of this round saved it
  const key = world.systems.map((s) => s.name).join('|');
  if (!LOCATION_CACHE.has(key)) { const m = new Map(); world.systems.forEach((s, i) => m.set(locationIdFor(world, i), i)); LOCATION_CACHE.clear(); LOCATION_CACHE.set(key, m); }
  currentLocations = LOCATION_CACHE.get(key);
}

// ---------- objectives ----------
function isLive(db, profileId, role, response) {
  return (db.config.live || []).some((x) => x.profile === profileId && x.role === role && x.response === response);
}
function closePreempted(db, capacity, observerId, incident, response, day, effects) {
  const old = capacity.preempts.objective;
  if (old) {
    // Ended now, under its own termination rule (cancelled), before the vessel takes the new job.
    old.cancelRequested = `pre-empted by ${response} for ${incident.id}`;
    old.status = 'aborted'; old.closedDay = day; bump(db, 'objectivesAborted');
    old.resolution = { status: 'aborted', reasons: ['objective_cancelled'], alsoSucceeded: [], day, note: old.cancelRequested };
    old.actions.push({ day, action: 'closed', detail: `aborted: ${old.cancelRequested}` });
    effects.push({ type: 'doctrineObjective', id: old.id, incidentId: old.incidentId, polity: old.polity, response: old.response, hullId: old.assigned.hullId, vid: old.assigned.vid, to: old.target?.systemIndex ?? null, day, status: old.status, reasons: old.resolution.reasons });
  }
  recordConflict(db, { day, actor: observerId, hullId: capacity.hullId, incident: incident.id, wanted: response, committedTo: capacity.preempts.label, decision: 'preempted' });
}
function createObjective(book, world, db, doctrine, { observerId, doc, incident, response, capacity, target }, day, effects) {
  // `protect` of a threatened contract is an escort of its named charge: the escort template (strategic
  // clock, closes when the charge is safe), not the tactical immediate-defence one.
  const military = response === 'protect' && isMilitaryIncident(incident);
  const tmplId = military ? 'defense' : response === 'protect' ? 'escort' : doctrine.data.responseCatalog[response].objective;
  const tmpl = doctrine.data.objectiveTemplates[tmplId];
  const polity = observerSide(book, observerId);
  const id = nid(book, db, 'obj');
  if (military) {
    // A strategic defence: the package's defence termination facts, on the strategic clock (the tactical
    // defence of a loaded scene stays with the engine).
    if (capacity.preempts) closePreempted(db, capacity, observerId, incident, response, day, effects);
    const job = activeAssignmentFor(db, capacity.hullId);
    if (job) { for (const m of job.milestones) if (m.status === 'pending') m.status = 'superseded'; endAssignment(db, book, job, day, 'diverted', `diverted to defend ${incident.locationId}`); }
    const o = { id, incidentId: incident.id, template: 'defense', clock: CLOCK, actor: observerId, polity, profileId: doc.profileId, role: doc.role, response,
      assigned: { hullId: capacity.hullId, vid: capacity.vid }, target: null, createdDay: day, deadline: at(day + db.config.defenseDeadlineDays), status: 'active', resolution: null, assignmentId: null, actions: [], dwellDays: 0, arrivedDay: null, workDays: 0, lead: 'defense' };
    const r = startDefense(book, world, db, o, capacity, day, effects);
    if (!r.ok) return { ok: false, reason: r.reason };
    if (observerId !== `hull:${capacity.hullId}`) sendReport(db, book, world, { incidentId: incident.id, from: observerId, to: `hull:${capacity.hullId}`, day, kind: `orders:${id}`, include: REPORT_PROFILES.full, channel: 'override' });
    const pat = patrolOfHull(db, capacity.hullId);
    if (pat) { pat.status = 'responding'; pat.responding = id; pat.responses.push({ day, objectiveId: id, response }); pat.responses = pat.responses.slice(-10); }
    db.objectives.push(o); incident.objectives.push(id); db.stats.objectives++; bump(db, 'liveObjectives'); bump(db, 'militaryObjectives');
    o.actions.push({ day, action: 'assigned', detail: capacity.reason });
    effects.push({ type: 'doctrineObjective', id, incidentId: incident.id, polity, response, hullId: capacity.hullId, vid: capacity.vid, to: o.target.systemIndex, day, status: 'active' });
    return { ok: true, objective: o };
  }
  if (response === 'reroute' || response === 'protect') {
    const o = { id, incidentId: incident.id, template: tmplId, clock: tmpl.clock, actor: observerId, polity, profileId: doc.profileId, role: doc.role, response,
      assigned: { hullId: capacity.hullId, vid: capacity.vid }, target: null, createdDay: day, deadline: at(day + db.config.escortDeadlineDays), status: 'active', resolution: null, assignmentId: null, actions: [], dwellDays: 0, arrivedDay: null, workDays: 0, lead: response };
    if (response === 'reroute') applyReroute(book, world, db, o, capacity, day, effects);
    else { const r = startEscort(book, world, db, o, capacity, day, effects); if (!r.ok) return { ok: false, reason: r.reason }; }
    db.objectives.push(o); incident.objectives.push(id); db.stats.objectives++; bump(db, 'liveObjectives');
    o.actions.push({ day, action: response === 'reroute' ? 'reroute' : 'escort', detail: capacity.reason });
    effects.push({ type: 'doctrineObjective', id, incidentId: incident.id, polity, response, hullId: capacity.hullId, vid: capacity.vid, to: o.target?.systemIndex ?? null, day, status: 'active' });
    return { ok: true, objective: o };
  }
  // A pre-emption the rule allows ends the vessel's current objective first, with the reason recorded.
  if (capacity.preempts) closePreempted(db, capacity, observerId, incident, response, day, effects);
  const deadlineDays = response === 'rescue' ? db.config.rescueDeadlineDays : db.config.investigationDeadlineDays;
  const dwell = response === 'rescue' ? db.config.rescueDwellDays : db.config.investigationDwellDays;
  // A diverted explorer ends its survey first; its command is told it has broken off.
  const job = activeAssignmentFor(db, capacity.hullId);
  if (job) {
    for (const m of job.milestones) if (m.status === 'pending') m.status = 'superseded';
    endAssignment(db, book, job, day, 'diverted', `diverted to ${response} ${incident.id}`);
  }
  const area = [...new Set([target.locationId])];
  const o = { id, incidentId: incident.id, template: tmplId, clock: tmpl.clock, actor: observerId, polity, profileId: doc.profileId, role: doc.role, response,
    assigned: { hullId: capacity.hullId, vid: capacity.vid }, target: { locationId: target.locationId, systemIndex: target.systemIndex, area },
    createdDay: day, deadline: at(day + deadlineDays), status: 'active', resolution: null, assignmentId: null, actions: [], dwellDays: dwell, arrivedDay: null, workDays: 0, lead: target.lead || (response === 'rescue' ? 'survivors' : 'area') };
  const r = issueAssignment(book, world, { polity, hullId: capacity.hullId, kind: response === 'rescue' ? 'rescue' : 'investigation', doctrineRole: doc.role === 'commander' ? 'patrol' : doc.role, objectiveId: id,
    stops: [{ systemIndex: target.systemIndex, dwell: 0, milestone: 'arrival' }] }, day, effects);
  if (!r.ok) return { ok: false, reason: r.reason };
  { const pat = patrolOfHull(db, capacity.hullId); if (pat) { pat.status = 'responding'; pat.responding = id; pat.responses.push({ day, objectiveId: id, response }); pat.responses = pat.responses.slice(-10); } }
  o.assignmentId = r.assignment.id;
  o.fromSystem = r.assignment.itinerary[0].systemIndex;
  // Orders carry the command's picture of the incident to the crew it sends.
  if (observerId !== `hull:${capacity.hullId}`) sendReport(db, book, world, { incidentId: incident.id, from: observerId, to: `hull:${capacity.hullId}`, day, kind: `orders:${id}`, include: REPORT_PROFILES.full, channel: 'override' });
  db.objectives.push(o);
  incident.objectives.push(id);
  db.stats.objectives++; bump(db, 'liveObjectives');
  o.actions.push({ day, action: 'assigned', detail: `${capacity.hullId} → ${target.locationId}` });
  if (response === 'rescue') effects.push({ type: 'doctrineVisible', kind: 'rescue-departed', objectiveId: id, polity, systemIndex: o.fromSystem, day });
  effects.push({ type: 'doctrineObjective', id, incidentId: incident.id, polity, response, hullId: capacity.hullId, vid: capacity.vid, from: r.assignment.itinerary[0].systemIndex, to: target.systemIndex, day, status: 'active' });
  return { ok: true, objective: o };
}
// The objective's facts are its own state: arrived, worked, found; the incident resolved elsewhere or
// the vessel gone is a cancellation; the deadline is on the objective's clock.
function objectiveFacts(book, world, db, o, day) {
  const f = {};
  // Cancellation is something the command KNOWS: the incident resolved (its ship came home), or it gave
  // the vessel other orders. A vessel silently lost is not a cancellation — the command does not know;
  // the objective runs to its deadline and the vessel's own missed arrival becomes an incident.
  const h = hullOf(book, o.polity, o.assigned.hullId);
  const reassigned = h && h.status !== 'lost' && h.opId && h.opId !== o.assignmentId;
  if (o.cancelRequested || reassigned) f.objective_cancelled = true;
  if (day >= o.deadline.value) f.objective_deadline_reached = true;
  const pol = book.polities[o.polity];
  if (pol && Number(pol.supply ?? 1) < db.config.minSupply) f.supply_inadequate = true;
  if (o.found?.evidenceRecovered) f.evidence_recovered = true;
  if (o.found?.complete) f.objective_complete = true;
  if (o.kind === 'defense') Object.assign(f, defenseFacts(book, world, db, o, day));
  else if (o.kind === 'raid') { if (o.forceRatioPoor) f.force_ratio_poor = true; if (o.cancelRequested) f.objective_cancelled = true; }
  else if (o.response === 'protect') Object.assign(f, escortFacts(book, world, db, o));
  if (o.response === 'reroute') {
    const c = contractOf(db, o.contractId);
    const a = db.assignments.find((x) => x.id === o.assignmentId);
    if (c && (c.status === 'completed' || (a && a.milestones.some((m) => m.kind === 'arrival' && m.status === 'met' && Number(m.systemIndex) === c.destination)))) f.objective_complete = true;
    else if (!c || c.status !== 'active' || !a || a.status !== 'active') f.objective_cancelled = true;
  }
  // No longer viable: the vessel cannot finish before the deadline from where it is (a blockade turned it
  // back once too often, say). Ended now rather than sailed out to the day.
  if (['investigate', 'rescue'].includes(o.response) && !o.arrivedDay) {
    const a = db.assignments.find((x) => x.id === o.assignmentId);
    if (a && a.status === 'active' && day + (a.itinerary.length - 1 - a.pos) + o.dwellDays > o.deadline.value) { f.objective_cancelled = true; o.cancelRequested ||= 'can no longer finish before its deadline'; }
  }
  return f;
}
// A defence ends when its actor knows the threat is over (seen in its own space, or reported), a
// surrender it accepted, the world lost, the deadline, or the defender no longer able to defend.
function defenseFacts(book, world, db, o, day) {
  const f = {};
  const k = knowledgeOf(db, o.actor, o.incidentId);
  const crew = knowledgeOf(db, `hull:${o.assigned.hullId}`, o.incidentId);
  const known = [k, crew].filter(Boolean);
  if (known.some((x) => x.surrender)) f.surrender_accepted = true;
  else if (known.some((x) => x.resolution && ['threat_ended', 'surrendered'].includes(x.resolution.status))) f.threat_ended = true;
  if (known.some((x) => x.resolution?.status === 'world_fell') || world.systems[o.target.systemIndex]?.controller !== o.polity) { f.objective_cancelled = true; o.cancelRequested ||= 'the protected world was lost'; }
  const h = hullOf(book, o.polity, o.assigned.hullId);
  if (!h || h.status === 'lost' || hullIsDisabled(h)) { f.objective_cancelled = true; o.cancelRequested ||= 'the defender can no longer defend'; }
  return f;
}
function escortFacts(book, world, db, o) {
  const f = {};
  const ca = db.assignments.find((x) => x.id === o.charge?.assignmentId);
  const ea = db.assignments.find((x) => x.id === o.assignmentId);
  const c = contractOf(db, o.charge?.contractId);
  const eh = hullOf(book, o.polity, o.assigned.hullId);
  // Safe: the charge has reached its destination (its arrival there is on record).
  if (ca && ca.milestones.some((m) => m.status === 'met' && m.metDay >= o.createdDay && locationIdFor(world, m.systemIndex) === o.charge.destination)) f.charge_safe = true;
  // Lost or cancelled, as the escort's command knows it: its escort saw it go, or the job was ended.
  const chargeHull = ca && hullOf(book, o.polity, ca.hullId);
  if (o.escortState === 'escorting' && (!chargeHull || chargeHull.status === 'lost')) { f.objective_cancelled = true; o.cancelRequested ||= 'the charge was lost'; }
  if (ca && ca.status !== 'active' && !f.charge_safe) { f.objective_cancelled = true; o.cancelRequested ||= `the charge's job ended (${ca.endReason || ca.status})`; }
  if (c && c.status !== 'active' && !f.charge_safe) { f.objective_cancelled = true; o.cancelRequested ||= `contract ${c.status}`; }
  // The escort itself can no longer do it.
  if (!eh || eh.status === 'lost' || classifyDamage(eh.hull, eh.maxHull) !== 'operational' || (ea && ea.status !== 'active')) { f.objective_cancelled = true; o.cancelRequested ||= 'the escort lost the capacity to protect'; }
  return f;
}
function workObjective(book, world, db, o, day, effects) {
  if (o.kind === 'defense') {
    const a = db.assignments.find((x) => x.id === o.assignmentId);
    const h = liveHull(book, o.polity, o.assigned.hullId);
    if (o.state === 'moving' && a && h && a.status === 'active' && Number(h.systemIndex) === Number(o.target.systemIndex) && a.pos >= a.itinerary.length - 1 && !hullIsDisabled(h)) arriveDefense(book, world, db, o, day, effects);
    return;
  }
  if (o.kind === 'raid' || o.response === 'protect' || o.response === 'reroute') return;
  const a = db.assignments.find((x) => x.id === o.assignmentId);
  const h = liveHull(book, o.polity, o.assigned.hullId);
  if (!a || !h || a.status !== 'active' || h.opId !== a.id) return;
  if (Number(h.systemIndex) !== Number(o.target.systemIndex) || a.pos < a.itinerary.length - 1) return;
  if (classifyDamage(h.hull, h.maxHull) !== 'operational') return;
  if (!o.arrivedDay) {
    o.arrivedDay = day;
    o.actions.push({ day, action: o.response === 'rescue' ? 'rescue' : 'investigate', detail: `on site at ${o.target.locationId}` });
    effects.push({ type: 'doctrineOnSite', id: o.id, polity: o.polity, response: o.response, systemIndex: o.target.systemIndex, day, lead: o.lead });
  }
  o.workDays++;
  if (o.workDays < o.dwellDays) return;
  const site = Object.values(db.ground.evidence).find((e) => e.locationId === o.target.locationId && e.expiresDay >= day);
  if (o.response === 'rescue') {
    if (site?.survivors && !site.survivors.rescued && site.survivors.untilDay >= day) {
      site.survivors.rescued = true; site.survivors.rescuedBy = o.actor; site.survivors.rescuedDay = day;
      // The people are taken off; every hulk they were aboard stays exactly where and as it is.
      for (const w of site.wrecks) if (w.hullId && (site.survivors.aboardAll || []).includes(w.hullId)) rescueStrandedCrew(book, w.polity, w.hullId, day, o.actor);
      o.found = { complete: true, rescued: true };
      for (const d of siteDistress(db, site)) if (d.status === 'open') resolveIncident(book, world, db, d, day, 'survivors_rescued', `by ${o.actor}`, effects, o.id);
    } else { o.found = { searched: true, nobody: true }; o.cancelRequested ||= 'nobody left to rescue on site'; }
  } else if (site && site.wrecks.length) {
    // Recovery: the wreckage is examined, each design identified and each registry read (a vessel's
    // registry is its vid). Identification is not attribution: nothing here says who did it. Debris
    // stays until it decays, so another power's crew can examine the same site.
    site.examinedBy.push({ by: o.actor, day });
    o.found = { evidenceRecovered: true, complete: true, evidenceId: site.id, wrecks: site.wrecks.map((w) => ({ factionId: w.factionId, designFaction: w.designFaction, vid: w.vid, condition: w.condition || 'destroyed', identified: true })), survivors: site.survivors && !site.survivors.rescued && site.survivors.untilDay >= day ? { locationId: site.locationId, observedDay: day } : null };
  } else o.found = { searched: true };
  if (o.found) recordFindings(book, world, db, o, day, effects);
}
// What the crew found goes into the actor's knowledge and is reported to its own command. What they
// did not find stays unknown: an empty search is not a finding of destruction.
function recordFindings(book, world, db, o, day, effects) {
  const inc = db.incidents[o.incidentId];
  const hullObs = `hull:${o.assigned.hullId}`;
  const cmd = `command:${o.polity}`;
  // The crew know at once; their command hears it by report (over the network, so later if far away).
  const crew = knowledgeOf(db, hullObs, o.incidentId);
  if (o.found?.evidenceRecovered && crew) {
    mergeEvidence(crew, { evidenceId: o.found.evidenceId, locationId: o.target.locationId, kind: 'debris', observedDay: day, recoverable: true, recovered: true, wrecks: o.found.wrecks, provenance: 'recovered_record' });
    crew.updatedDay = day; crew.version = (crew.version || 0) + 1; crew.lastChange = { day, cause: 'wreckage examined' };
    refreshLinks(db, hullObs, crew);
    checkLocated(book, world, db, hullObs, crew, day, effects, o.id);
    // People found alive at the site: the crew learn the distress incident first hand.
    const site = db.ground.evidence[o.found.evidenceId];
    // Whose people they are: the hulk they are aboard, or the one wreck their lifeboats came from.
    const src = site && (site.wrecks.find((w) => w.hullId && w.hullId === site.survivors?.aboard) || (site.wrecks.length === 1 ? site.wrecks[0] : null));
    const mine = src ? { vid: src.vid, factionId: src.factionId } : null;
    const dinc = o.found.survivors && site && (openSiteDistress(db, site) || distressFoundOnSite(book, world, db, site, hullObs, day, effects, { identified: mine }));
    if (dinc && dinc.detectedBy !== hullObs) {
      const dk = learn(db, hullObs, dinc, { provenance: 'direct_sensor', confidence: 'corroborated', day, observedDay: day, cause: 'survivors found on site', claims: { lastKnown: { locationId: o.target.locationId, position: null, observedAt: at(day) }, ...(knowledgeOf(db, `beacon:${site.id}`, dinc.id)?.claims.asset ? { asset: knowledgeOf(db, `beacon:${site.id}`, dinc.id).claims.asset } : {}) } });
      dk.survivors = { locationId: o.target.locationId, observedDay: day, count: null, provenance: 'direct_sensor', rescued: false };
      sendReport(db, book, world, { incidentId: dinc.id, from: hullObs, to: cmd, day, kind: 'survivor_report', include: REPORT_PROFILES.survivor_report, channel: 'network' });
    }
    effects.push({ type: 'doctrineEvidenceRecovered', id: o.id, polity: o.polity, systemIndex: o.target.systemIndex, day, wrecks: o.found.wrecks.map((w) => w.designFaction) });
  }
  if (o.found?.rescued && crew?.survivors) crew.survivors.rescued = true;
  if (o.found?.rescued) effects.push({ type: 'doctrineRescued', id: o.id, polity: o.polity, systemIndex: o.target.systemIndex, day });
  if ((o.found?.evidenceRecovered || o.found?.rescued) && crew) sendReport(db, book, world, { incidentId: o.incidentId, from: hullObs, to: cmd, day, kind: `findings:${o.id}`, include: REPORT_PROFILES.full, channel: 'network' });
}
// The missing ship's own registry in the wreckage locates it — for whoever knew which ship was missing.
// Its owner's command settles the incident when the finding reaches it.
function checkLocated(book, world, db, obs, k, day, effects, exceptObjective = null) {
  const inc = db.incidents[k.incidentId];
  if (!inc || inc.eventType !== 'asset_overdue' || !k.claims.asset?.assetId) return;
  for (const e of Object.values(k.evidence || {})) {
    const mine = (e.wrecks || []).find((w) => w.vid === k.claims.asset.assetId);
    if (!mine || !e.recovered) continue;
    k.located = { vid: mine.vid, locationId: e.locationId, condition: mine.condition, day };
    if (!k.resolution) k.resolution = { status: 'asset_located', day };
    if (obs === inc.detectedBy) for (const other of Object.values(db.incidents)) if (other.assignmentId === inc.assignmentId) resolveIncident(book, world, db, other, day, 'asset_located', `${mine.vid} found ${mine.condition} at ${e.locationId}`, effects, exceptObjective);
    return;
  }
}
function closeObjectives(doctrine, book, world, db, day, effects) {
  for (const o of db.objectives) {
    if (o.status !== 'active') continue;
    const facts = objectiveFacts(book, world, db, o, day);
    const st = D.objectiveStatus(doctrine, o.template, facts);
    if (st.status === 'open') continue;
    o.status = st.status; o.closedDay = day;
    bump(db, { completed: 'objectivesCompleted', aborted: 'objectivesAborted', expired: 'objectivesExpired' }[st.status] || 'objectivesClosedOther');
    if (o.response === 'protect' && !o.military) o.escortState = 'closed';
    if (o.military) {
      bump(db, 'militaryClosed');
      if (o.kind === 'raid' && o.cancelledBy === 'authority') bump(db, 'militaryCancelledByAuthority');
      if (st.reasons.includes('objective_deadline_reached')) bump(db, 'militaryExpired');
      o.state = 'closed';
      const dh = hullOf(book, o.polity, o.assigned.hullId); if (dh) delete dh.defendingAt;
      const order = db.raidOrders.find((r) => r.objectiveId === o.id); if (order) order.status = st.status;
    }
    o.resolution = { status: st.status, reasons: st.reasons, alsoSucceeded: st.alsoSucceeded || [], day, note: o.cancelRequested || null };
    o.actions.push({ day, action: 'closed', detail: `${st.status}: ${st.reasons.join(', ')}` });
    const a = db.assignments.find((x) => x.id === o.assignmentId);
    if (a && a.status === 'active') { for (const m of a.milestones) if (m.status === 'pending') m.status = 'superseded'; endAssignment(db, book, a, day, st.status === 'completed' ? 'completed' : 'ended', `objective ${st.status}`); }
    // Home under a separate return order: nothing more happens under the closed objective. A patrol goes
    // back to its area and resumes its cycles.
    const h = liveHull(book, o.polity, o.assigned.hullId);
    const pat = h && Object.values(db.patrols).find((p) => p.hullId === h.id && p.status === 'responding' && p.responding === o.id);
    if (pat && h && !h.opId && h.status === 'ready' && !hullIsDisabled(h)) {
      pat.status = 'patrolling'; pat.responding = null; pat.returnedDay = day;
      bump(db, 'patrolsReturned');
      issuePatrolCycle(book, world, db, pat, day, effects);
    } else if (pat) { endPatrol(db, pat, day, h && hullIsDisabled(h) ? 'vessel disabled' : 'vessel unavailable after its response'); }
    else if (h && !h.opId && h.status === 'ready' && classifyDamage(h.hull, h.maxHull) === 'operational') {
      const home = nearestHeld(world, o.polity, h.systemIndex);
      if (home != null && home !== Number(h.systemIndex)) issueAssignment(book, world, { polity: o.polity, hullId: h.id, kind: 'return', doctrineRole: o.role === 'commander' ? 'patrol' : o.role, stops: [{ systemIndex: home, dwell: 0, milestone: null }] }, day, effects);
    }
    effects.push({ type: 'doctrineObjective', id: o.id, incidentId: o.incidentId, polity: o.polity, response: o.response, hullId: o.assigned.hullId, vid: o.assigned.vid, to: o.target?.systemIndex ?? null, day, status: o.status, reasons: st.reasons, kind: o.kind || null, cancelledBy: o.cancelledBy || null });
    const inc = db.incidents[o.incidentId];
    if (inc && inc.status === 'open' && st.status === 'completed' && o.response === 'rescue') { /* rescue saves crews; the incident stays for whoever still seeks the ship */ }
  }
}
function nearestHeld(world, polity, from) {
  let best = null;
  for (const s of world.systems) {
    if (s.controller !== polity) continue;
    const r = routeBetween(world, from, s.index, polity);
    if (r && (!best || r.length < best.len)) best = { i: s.index, len: r.length };
  }
  return best?.i ?? null;
}
// Closed objectives stay for the record, bounded.
function trimClosed(db, book) {
  const live = db.objectives.filter((o) => o.status === 'active');
  const done = db.objectives.filter((o) => o.status !== 'active');
  db.objectives = [...live, ...done.slice(-db.config.closedLimit)];
  // Finished routine jobs are kept only while an incident or objective names them, plus a short tail
  // for the debug record, and without their itineraries: a long game must not grow its save by a
  // kilobyte a patrol.
  const named = new Set([...Object.values(db.incidents).map((i) => i.assignmentId), ...db.objectives.map((o) => o.assignmentId)]);
  const liveA = db.assignments.filter((a) => a.status === 'active');
  const doneA = db.assignments.filter((a) => a.status !== 'active');
  const keep = new Set([...doneA.filter((a) => named.has(a.id)), ...doneA.slice(-db.config.closedAssignmentLimit)]);
  for (const a of keep) if (a.itinerary.length > 2) { a.itinerary = [a.itinerary[0], a.itinerary.at(-1)]; a.pos = Math.min(a.pos, 1); }
  db.assignments = [...liveA, ...doneA.filter((a) => keep.has(a))];
  // Old resolved incidents leave the books with their knowledge and evaluations once past the bound.
  const day = db.lastDay ?? 0;
  const settledForAll = (i) => Object.values(db.knowledge).every((st) => !st[i.id] || st[i.id].resolution || day - (st[i.id].updatedDay ?? st[i.id].receivedAt.value) > db.config.evidenceLifeDays);
  const resolved = Object.values(db.incidents).filter((i) => i.status !== 'open' && settledForAll(i) && !db.objectives.some((o) => o.incidentId === i.id && o.status === 'active')).sort((a, b) => (a.resolution?.day ?? 0) - (b.resolution?.day ?? 0));
  const excess = Object.keys(db.incidents).length - db.config.incidentHistoryLimit;
  for (const inc of resolved.slice(0, Math.max(0, excess))) {
    delete db.incidents[inc.id];
    for (const st of Object.values(db.knowledge)) delete st[inc.id];
    for (const k of Object.keys(db.lastEval)) if (k.endsWith(`|${inc.id}`)) { delete db.lastEval[k]; delete db.lastRun[k]; }
  }
  for (const [obs, st] of Object.entries(db.knowledge)) if (!Object.keys(st).length) delete db.knowledge[obs];
  // Per-fact traces are kept for incidents still in play; a settled one keeps its verdicts only.
  // (Phase 3: at once — a war's witnessed attacks settle quickly and in numbers.)
  for (const [k, e] of Object.entries(db.lastEval)) { const inc = db.incidents[e.incident]; if (e.trace && inc && inc.status !== 'open' && (inc.eventType === 'asset_attack' || (db.lastDay ?? 0) - (inc.resolution?.day ?? 0) > 30)) delete e.trace; }
  // A verdict not renewed for two months belongs to the shadow log, not the live table.
  for (const [k, e] of Object.entries(db.lastEval)) if (day - (e.day ?? day) > 60) { delete db.lastEval[k]; delete db.lastRun[k]; }
  // A verdict signature with no verdict or no incident behind it any more is dropped with them.
  for (const k of Object.keys(db.lastRun)) if (!db.lastEval[k] || !db.incidents[k.slice(k.lastIndexOf('|') + 1)]) delete db.lastRun[k];
  // A lost vessel's crew knows nothing any more.
  const gone = (obs) => { if (!obs.startsWith('hull:')) return false; const pol = hullPolity(book, obs.slice(5)); return !pol || !liveHull(book, pol, obs.slice(5)); };
  for (const obs of Object.keys(db.knowledge)) if (gone(obs)) delete db.knowledge[obs];
  for (const obs of Object.keys(db.sightings || {})) if (gone(obs)) delete db.sightings[obs];
  // Expired wreck sites nobody's record still points at go too, with the sightings of them, the fates of
  // jobs no longer on the books, and any compartment receipt for a pact that is no longer active.
  for (const [id, e] of Object.entries(db.ground.evidence)) if (e.expiresDay < day - db.config.evidenceLifeDays) delete db.ground.evidence[id];
  for (const [obs, st] of Object.entries(db.sightings || {})) {
    for (const [id, x] of Object.entries(st)) if (!db.ground.evidence[id] || day - (x.observedDay ?? 0) > db.config.evidenceLifeDays) delete st[id];
    if (!Object.keys(st).length) delete db.sightings[obs];
  }
  const onBooks = new Set(db.assignments.map((a) => a.id));
  for (const id of Object.keys(db.ground.fates)) if (!onBooks.has(id)) delete db.ground.fates[id];
  for (const map of [db.briefings, db.pactTasks]) for (const [obs, list] of Object.entries(map)) { map[obs] = list.filter((b) => db.activePactKeys?.includes(b.pactKey)).slice(-10); if (!map[obs].length) delete map[obs]; }
  for (const [to, list] of Object.entries(db.orders)) db.orders[to] = list.slice(-10);
  const endedPatrols = Object.values(db.patrols || {}).filter((p) => p.status === 'ended').sort((x, y) => x.endedDay - y.endedDay);
  for (const p of endedPatrols.slice(0, Math.max(0, endedPatrols.length - db.config.closedPatrolLimit))) delete db.patrols[p.id];
}

// ---------- evaluation ----------
// Which observers are evaluated for an incident: everyone who knows of it, plus the watched commands
// and the pilot vessels (so "knows nothing, does nothing" is on record).
function observersFor(book, db, incidentId) {
  const out = new Set();
  for (const [obs, store] of Object.entries(db.knowledge)) if (store[incidentId] && !obs.startsWith('beacon:')) out.add(obs);
  if (db.incidents[incidentId]?.status !== 'open') { out.delete('player'); return [...out].sort(); }
  for (const p of db.config.watchCommands || []) if (book.polities[p]) out.add(`command:${p}`);
  for (const [polity, des] of Object.entries(db.designations || {})) for (const hid of Object.keys(des)) if (liveHull(book, polity, hid)) out.add(`hull:${hid}`);
  for (const a of db.assignments) if (a.status === 'active' && ['exploration', 'delivery', 'construction', 'transport', 'area_patrol'].includes(a.kind) && liveHull(book, a.polity, a.hullId)) out.add(`hull:${a.hullId}`);
  out.delete('player');
  return [...out].sort();
}
function existingActivity(book, world, observerId) {
  const side = observerSide(book, observerId);
  if (observerId.startsWith('command:')) {
    const ops = (book.operations || []).filter((o) => o.faction === side && o.status !== 'resolved').length;
    const blk = (book.blockades || []).filter((b) => b.power === side && ['forming', 'active'].includes(b.status)).length;
    const evac = (book.evacuations || []).filter((e) => e.sponsor === side && e.status === 'active').length;
    return `no incident handler; ${ops} operation(s), ${blk} blockade(s), ${evac} evacuation(s) under way`;
  }
  const h = liveHull(book, side, observerId.slice(5));
  return h ? `no incident handler; vessel ${h.status}${h.opId ? ` on ${h.opId}` : ''}` : 'vessel gone';
}
export function evaluateObserver(doctrine, book, world, db, observerId, incidentId, day) {
  const doc = observerDoctrine(doctrine, book, db, observerId);
  const inc = db.incidents[incidentId];
  const { facts, trace } = deriveFacts(doctrine, book, world, db, observerId, incidentId, day);
  let capacity = null, target = null;
  const res = doc.profileId ? D.react(doctrine, { profileId: doc.profileId, role: doc.role, culture: doc.culture, eventType: inc.eventType, facts,
    scenarioActivated: dominionContext(book, observerSide(book, observerId), db).scenarioActivated === true,
    capacityFor: (response) => { target = responseTarget(db, observerId, incidentId, response, day); capacity = responseCapacity(book, world, db, observerId, response, target, day, knowledgeOf(db, observerId, incidentId)); return capacity; } })
    : { result: 'record_only', reason: doc.profileReason, matchedRule: null, response: null, deferred: false, failed: [] };
  return { day, observerId, incidentId, profileId: doc.profileId, role: doc.role, culture: doc.culture, profileReason: doc.profileReason, roleReason: doc.roleReason,
    knownFacts: Object.keys(facts).filter((k) => facts[k]).sort(), trace, result: res.result, matchedRule: res.matchedRule, response: res.response,
    deferred: Boolean(res.deferred), failed: res.failed || [], reason: res.reason, capacity, target };
}
function evaluateAll(doctrine, book, world, db, day, effects) {
  for (const inc of Object.values(db.incidents)) {
    // A resolved incident stays under evaluation while someone's knowledge of it is still changing (a
    // report that has just reached them) or survivors are still waiting — no longer.
    const records = Object.values(db.knowledge).map((st) => st[inc.id]).filter(Boolean);
    const fresh = records.some((k) => (k.updatedDay ?? -1e9) >= day - 1);
    const waiting = records.some((k) => k.survivors && !k.survivors.rescued && day - (k.survivors.observedDay ?? day) <= db.config.survivorWindowDays);
    // Each observer judges by its own record: an incident the owner has settled is still open for anyone
    // who has not heard, while their knowledge is still in date.
    const unresolvedElsewhere = records.some((k) => !k.resolution && day - (k.updatedDay ?? k.receivedAt.value) <= db.config.evidenceLifeDays);
    if (inc.status !== 'open' && !fresh && !waiting && !unresolvedElsewhere) continue;
    for (const obs of observersFor(book, db, inc.id)) {
      const ev = evaluateObserver(doctrine, book, world, db, obs, inc.id, day);
      db.stats.shadowEvaluations++;
      const live = ev.profileId && ev.response && !ev.deferred && ev.result === ev.response && isLive(db, ev.profileId, ev.role, ev.response);
      const okey = `${obs}|${ev.response}`;
      const existing = (inc.objectiveKeys || []).includes(okey) ? (db.objectives.find((o) => o.incidentId === inc.id && o.actor === obs && o.response === ev.response) || { id: inc.objectiveIds?.[okey] || 'closed', status: 'closed' }) : null;
      let acted = null, notActing = null;
      // An actor already running an objective on this incident is doing it: that is not a new deferral.
      const running = db.objectives.find((o) => o.status === 'active' && o.actor === obs && o.incidentId === inc.id);
      // Only the same response, or a deferral because of that very objective, is "already doing it"; a
      // different response deferred for another reason is a genuine deferral.
      const busyHere = Boolean(running && ((ev.deferred && (running.response === ev.response || String(ev.capacity?.reason || '').includes(`objective ${shortId(running.id)}`))) || (live && existing)));
      // Another actor of the same power already on it (its command, or one of its patrols): one response each.
      const handled = live && !existing && db.objectives.find((o) => o.status === 'active' && o.incidentId === inc.id && o.polity === observerSide(book, obs) && o.response === ev.response && o.actor !== obs);
      if (busyHere) { notActing = `objective ${shortId(running.id)} running on this incident`; if (live) bump(db, 'repeatPrevented'); }
      else if (live && existing) { notActing = `objective ${shortId(existing.id)} already ${existing.status}`; bump(db, 'repeatPrevented'); }
      else if (handled) { notActing = `already handled by ${handled.actor} (objective ${shortId(handled.id)})`; bump(db, 'repeatPrevented'); }
      else if (live) {
        const r = createObjective(book, world, db, doctrine, { observerId: obs, doc: { profileId: ev.profileId, role: ev.role }, incident: inc, response: ev.response, capacity: ev.capacity, target: ev.target }, day, effects);
        acted = r.ok ? r.objective.id : null;
        if (r.ok) { (inc.objectiveKeys ||= []).push(okey); (inc.objectiveIds ||= {})[okey] = r.objective.id; }
        if (!r.ok) notActing = r.reason;
      } else if (ev.deferred) notActing = `defer:${ev.response} — ${ev.capacity && !ev.capacity.ok ? ev.capacity.reason : ev.failed.join(', ')}`;
      else if (ev.response && ev.result === ev.response) notActing = 'shadow only: this profile/role/response is not enabled live this round';
      else notActing = ev.result === 'ignore_unknown' ? 'not known to this observer' : ev.result === 'record_only' ? 'recorded; no interest rule matched' : ev.result;
      const entry = { day, actor: obs, incident: inc.id, profile: ev.profileId, role: ev.role, culture: ev.culture, knownFacts: ev.knownFacts, matchedRule: ev.matchedRule?.id || null,
        proposal: ev.result, response: ev.response, failed: ev.failed, capacity: ev.capacity ? { ok: ev.capacity.ok, reason: ev.capacity.reason, hullId: ev.capacity.hullId } : null,
        live: Boolean(live), objective: acted || existing?.id || null, notActing: acted ? null : notActing, existing: existingActivity(book, world, obs) };
      const key = `${obs}|${inc.id}`;
      // An observer that has not heard of the incident has nothing to explain beyond that: its verdict is
      // kept in a compact form (a long war produces many incidents and many such observers).
      const unknown = ev.result === 'ignore_unknown' && !entry.knownFacts.length && !entry.objective;
      // A witnessed attack is known to its witnesses and whoever they tell; the rest of the galaxy's
      // observers are not listed against it at all (a war makes many of these).
      if (unknown && inc.eventType === 'asset_attack') { delete db.lastEval[key]; delete db.lastRun[key]; continue; }
      db.lastEval[key] = unknown ? { day, actor: obs, incident: inc.id, profile: ev.profileId, role: ev.role, knownFacts: [], proposal: ev.result, response: null, failed: [], live: false, objective: null, notActing }
        // The per-fact trace is kept for the facts that decided it: those that hold and those the verdict
        // names as missing. (The rest are false and carry nothing a reader needs; a long war would pay a
        // kilobyte per observer per incident for them.)
        : { ...entry, trace: Object.fromEntries(Object.entries(ev.trace || {}).filter(([f]) => entry.knownFacts.includes(f) || (entry.failed || []).includes(f))), reason: ev.reason, profileReason: ev.profileReason, roleReason: ev.roleReason };
      const sig = unknown ? 'unknown' : JSON.stringify([entry.proposal, entry.response, entry.failed, entry.matchedRule, entry.objective, entry.capacity?.ok, entry.knownFacts]);
      if (db.lastRun[key] !== sig) {
        // A changed verdict on the same incident is a reevaluation: what changed in this observer's own
        // record (a report delivered, evidence seen) or in its capacity (a vessel back, a job finished).
        const prev = db.shadow.slice().reverse().find((x) => x.actor === obs && x.incident === inc.id);
        if (db.lastRun[key] != null && prev) {
          const k = knowledgeOf(db, obs, inc.id);
          const was = prev.objective ? `live:${prev.response}` : prev.notActing?.startsWith('defer:') ? `defer:${prev.response}` : prev.proposal;
          const now = entry.objective ? `live:${entry.response}` : entry.notActing?.startsWith('defer:') ? `defer:${entry.response}` : entry.proposal;
          const gained = entry.knownFacts.filter((f) => !prev.knownFacts.includes(f)), lost = prev.knownFacts.filter((f) => !entry.knownFacts.includes(f));
          // Both kinds of change are named: what this observer learned, and what it can now do.
          const parts = [];
          if (gained.length || lost.length) parts.push(`${k?.lastChange?.cause || 'record changed'}${gained.length ? ` (+${gained.join(', +')})` : ''}${lost.length ? ` (-${lost.join(', -')})` : ''}`);
          if (prev.capacity?.ok !== entry.capacity?.ok) parts.push(`capacity: ${entry.capacity?.reason || 'changed'}`);
          const cause = parts.join('; ') || 'verdict changed';
          if (was !== now) {
            db.reevaluations.push({ day, actor: obs, incident: inc.id, from: was, to: now, cause, objective: entry.objective });
            if (db.reevaluations.length > db.config.reevaluationLimit) db.reevaluations = db.reevaluations.slice(-db.config.reevaluationLimit);
            bump(db, 'reevaluations');
          }
        }
        if (!acted && ev.deferred && !busyHere) {
          db.stats.deferred++;
          if (/vessel committed to|committed: /.test(ev.capacity?.reason || '')) recordConflict(db, { day, actor: obs, hullId: ev.capacity?.hullId || (obs.startsWith('hull:') ? obs.slice(5) : null), incident: inc.id, wanted: ev.response, committedTo: ev.capacity.reason, decision: 'deferred' });
        }
        db.lastRun[key] = sig;
        db.shadow.push(entry);
        if (db.shadow.length > db.config.shadowLogLimit) db.shadow = db.shadow.slice(-db.config.shadowLogLimit);
      }
    }
  }
}

// ---------- visible traces for the captain ----------
// The engine publishes these only through the captain's actual sources. Nothing here carries a reason,
// a profile or an attribution.
function searchHails(book, world, db, day, effects) {
  for (const o of db.objectives) {
    if (o.status !== 'active' || o.response !== 'investigate') continue;
    const a = db.assignments.find((x) => x.id === o.assignmentId);
    const h = a && liveHull(book, o.polity, a.hullId);
    if (!h) continue;
    const here = Number(h.systemIndex);
    o.hailed ||= [];
    if (o.hailed.includes(here)) continue;
    o.hailed.push(here);
    const inc = db.incidents[o.incidentId];
    const ownK = knowledgeOf(db, `command:${o.polity}`, o.incidentId);
    const ownAsset = inc && inc.polity === o.polity;
    if (!ownAsset) continue; // only a search for one's own missing ship hails for it
    if (ownK) {
      // A search hails for its missing ship along the way: anyone present hears it.
      for (const obs of presentObservers(book, world, db, here)) if (obs.polity !== o.polity) sendReport(db, book, world, { incidentId: o.incidentId, from: `command:${o.polity}`, to: obs.observerId, day, kind: `hail:${here}`, include: REPORT_PROFILES.overdue_notice, channel: 'override', provenance: 'received_report' });
    }
    effects.push({ type: 'doctrineVisible', kind: here === o.fromSystem ? 'search-departed' : 'search-hail', objectiveId: o.id, polity: o.polity, assetFaction: ownAsset ? inc.polity : null, assetRole: { patrol: 'patrol', explorer: 'explorer' }[ownK?.claims.asset?.role] || 'ship', systemIndex: here, day, response: o.response, first: o.hailed.length === 1 });
  }
}

// ---------- the day ----------
export function advanceDoctrineDay(book, world, day, effects, doctrine) {
  if (!doctrine) { if (book.doctrine) releaseDoctrineHulls(book, day, 'doctrine runtime unavailable', effects); return; }
  const db = doctrineBook(book);
  if (!db.config.enabled) { releaseDoctrineHulls(book, day, 'doctrine switched off', effects); return; }
  db.lastDay = day;
  db.activePactKeys = Object.values(book.treaties || {}).filter((t) => t.kind === 'pact' && t.status === 'active').map((t) => t.key).sort();
  indexLocations(world, db);
  generateRoutine(doctrine, book, world, db, day, effects);
  advanceContracts(book, world, db, day, effects);
  for (const a of db.assignments) if (a.status === 'active') stepAssignment(book, world, db, a, day, effects);
  tickEscorts(book, world, db, day, effects);
  recordFates(book, world, db, day, effects);
  detectConvoyDistress(book, world, db, day, effects);
  settleDistress(book, world, db, day, effects);
  detectOverdue(book, world, db, day, effects);
  deliverMessages(book, world, db, day, effects);
  deliverSightings(book, world, db, day);
  forwardToOwnVessels(book, world, db, day);
  detectSites(book, world, db, day, effects);
  detectAttacks(book, world, db, day, effects);
  for (const o of db.objectives) if (o.status === 'active') workObjective(book, world, db, o, day, effects);
  advanceRaids(book, world, db, day, effects);
  closeObjectives(doctrine, book, world, db, day, effects);
  evaluateAll(doctrine, book, world, db, day, effects);
  searchHails(book, world, db, day, effects);
  for (const a of db.assignments) if (a.status === 'active' && a.kind === 'return' && a.pos >= a.itinerary.length - 1) endAssignment(db, book, a, day, 'completed', 'home');
  // An owner writes off a vessel it has not heard from for a long time: the assignment ends (a wreck,
  // if any, stays where it is; a disabled hull keeps its record). The incident is not deleted.
  for (const a of db.assignments) {
    if (a.status !== 'active') continue;
    const missed = a.milestones.filter((m) => m.status === 'missed');
    if (missed.length && day - Math.min(...missed.map((m) => m.dueDay + m.grace)) > db.config.evidenceLifeDays) {
      endAssignment(db, book, a, day, 'written_off', 'no word from the vessel');
      // The owner closes its books on it: the question stays unanswered, but it is no longer pursued.
      for (const inc of Object.values(db.incidents)) if (inc.assignmentId === a.id && inc.status === 'open') resolveIncident(book, world, db, inc, day, 'written_off', `no word from ${a.vid} for ${db.config.evidenceLifeDays} days`, effects);
    }
  }
  trimClosed(db, book);
}

// With doctrine off (or not loaded), nothing may stay parked on a doctrine job: every assignment ends,
// every live objective is called off, and the hulls go back to their powers where they stand.
export function releaseDoctrineHulls(book, day, reason = 'doctrine switched off', effects = []) {
  const db = book.doctrine;
  if (!db || !Array.isArray(db.assignments)) return 0;
  let n = 0;
  for (const o of db.objectives || []) if (o.status === 'active') { o.status = 'aborted'; o.closedDay = day; bump(db, 'objectivesAborted'); o.resolution = { status: 'aborted', reasons: ['objective_cancelled'], day, note: reason }; if (o.response === 'protect') o.escortState = 'closed'; }
  for (const c of Object.values(db.contracts || {})) if (c.status === 'active') { c.status = 'cancelled'; c.closedDay = day; c.closeReason = reason; }
  for (const pat of Object.values(db.patrols || {})) endPatrol(db, pat, day, reason);
  for (const o of db.objectives || []) if (o.military) { o.state = 'closed'; const h = hullOf(book, o.polity, o.assigned.hullId); if (h) delete h.defendingAt; }
  for (const a of db.assignments) if (a.status === 'active') {
    for (const m of a.milestones) if (m.status === 'pending') m.status = 'superseded';
    endAssignment(db, book, a, day, 'ended', reason); n++;
    effects.push({ type: 'doctrineReleased', id: a.id, polity: a.polity, hullId: a.hullId, day });
  }
  return n;
}
// ---------- authored / debug entry points (each labelled as such where offered) ----------
export function issuePatrol(book, world, polity, hullId, target, day, effects = [], opts = {}) {
  const db = doctrineBook(book);
  const h = liveHull(book, polity, hullId);
  if (!h) return { ok: false, reason: 'no such vessel' };
  if (h.opId || h.status !== 'ready') return { ok: false, reason: 'vessel is committed' };
  return issueAssignment(book, world, { polity, hullId, kind: opts.kind || 'patrol', doctrineRole: opts.doctrineRole || 'patrol', cargo: opts.cargo || null,
    stops: [{ systemIndex: target, dwell: opts.dwell ?? db.config.patrolDwellDays, milestone: 'arrival' }, { systemIndex: h.systemIndex, dwell: 0, milestone: 'check_in' }] }, day, effects);
}
// A report handed from one observer to another by an authored event (or the debug panel).
export function relayReport(book, world, incidentId, from, to, day, opts = {}) {
  const db = doctrineBook(book);
  const include = Array.isArray(opts.include) ? opts.include : REPORT_PROFILES[opts.include || 'full'] || REPORT_PROFILES.full;
  const m = sendReport(db, book, world, { incidentId, from, to, day, kind: opts.kind || 'relay', include, channel: opts.channel || 'override', confidence: opts.confidence || null, pactKey: opts.pactKey || null });
  if (opts.channel && opts.channel !== 'override') return m;
  return m && m.state === 'delivered' ? knowledgeOf(db, to, incidentId) : null;
}
export function designate(book, polity, hullId, role = 'relief') {
  const db = doctrineBook(book);
  (db.designations[polity] ||= {})[hullId] = role;
  return true;
}
export function issueCentralOrder(book, to, from = 'dominion', day = 0) {
  const db = doctrineBook(book);
  (db.orders[to] ||= []).push({ from, day, status: 'received' });
  return true;
}
// Debug summary: the incidents and what each observer knows and proposes. Never shown to the player
// outside Cheats & Debug.
export { settleDistress as _settleDistress, raiseDistress as _raiseDistress };
// The chain for a military objective, as debug shows it: known target → objective → authority →
// physical gates. Strategic: the physical gates are the tactical engine's and are never claimed here.
function militaryChain(doctrine, book, world, db, o) {
  const k = o.incidentId ? knowledgeOf(db, o.actor, o.incidentId) : null;
  const facts = {};
  if (o.status === 'active') facts.engagement_objective_active = true;
  if (o.kind === 'defense') {
    if (k?.attribution) facts.attack_on_protected_verified = true;
    facts.defense_obligation_active = true;
  }
  if (o.kind === 'raid' && world && warAuthorityHolds(book, world, o.authority.stamp)) { facts.war_target_verified = true; facts.war_order_active = true; }
  let fire = null;
  if (doctrine && o.profileId) { try { fire = D.fireDecision(doctrine, { profileId: o.profileId, role: o.kind === 'defense' ? 'defender' : o.role, facts }); } catch { fire = null; } }
  const target = o.kind === 'defense' ? `attack at ${o.target?.locationId}${k?.attribution ? ` by ${k.attribution.factionId} (${k.attribution.provenance})` : ' (attacker unidentified)'}` : `${o.target?.locationId} (${world?.systems[o.target?.systemIndex]?.controller || 'unheld'})`;
  return { target, objective: `${o.kind} ${shortId(o.id)} ${o.status}`, authority: fire ? (fire.modes.length ? `modes ${fire.modes.join(', ')}${fire.failed.includes('engagement_authorized') ? ' — not authorised' : ' — engagement authorised'}` : 'no engagement mode applies') : Object.keys(facts).join(', '),
    physical: `physical gates (live track, weapon usable/ready, in equipped range, target actionable) belong to the tactical engine; offscreen the fight is the campaign's attrition model${fire ? ` · unmet now: ${fire.failed.filter((x) => x !== 'engagement_authorized').join(', ')}` : ''}` };
}
export function debugSummary(book, observerFilter = null, doctrine = null, world = null) {
  const db = doctrineBook(book);
  const tmpl = (id) => doctrine?.data?.objectiveTemplates?.[id];
  const factsOf = (p) => { const out = []; const walk = (x) => { if (!x || typeof x !== 'object') return; if (x.fact) out.push(x.fact); for (const v of [...(x.any || []), ...(x.all || [])]) walk(v); }; walk(p); return out; };
  return {
    military: db.objectives.filter((o) => o.military).slice(-20).map((o) => {
      const k = o.incidentId ? knowledgeOf(db, o.actor, o.incidentId) : null;
      let holding = [];
      if (o.status === 'active' && world) { try { holding = Object.keys(objectiveFacts(book, world, db, o, db.lastDay ?? 0)).filter(Boolean); } catch { holding = []; } }
      return { id: o.id, kind: o.kind, actor: o.actor, vid: o.assigned.vid, hullId: o.assigned.hullId, authority: o.authority, target: o.target?.locationId, state: o.state, status: o.status, resolution: o.resolution, deadline: o.deadline.value,
        lastAction: o.actions.at(-1) || null, knowledge: k ? `${k.attribution ? `attacker ${k.attribution.factionId} (${k.attribution.provenance})` : 'attacker unknown'} · ${k.provenance} · ${k.confidence}${k.resolution ? ` · known ${k.resolution.status}` : ''}` : o.kind === 'raid' ? 'ordered target; seen on arrival' : null,
        termination: { success: factsOf(tmpl(o.template)?.successWhen), abort: factsOf(tmpl(o.template)?.abortWhen), holding }, fireChain: militaryChain(doctrine, book, world, db, o) };
    }),
    patrols: Object.values(db.patrols || {}).map((p) => ({ ...p, at: liveHull(book, p.polity, p.hullId)?.systemIndex ?? null })),
    stranded: Object.entries(book.polities || {}).flatMap(([pid, pol]) => (pol.hulls || []).filter((h) => h.stranded && h.status !== 'lost').map((h) => ({ polity: pid, hullId: h.id, vid: vidOf(h), systemIndex: h.systemIndex, hull: Math.round(h.hull), maxHull: h.maxHull, since: h.stranded.since, days: (db.lastDay ?? book.settled ?? 0) - h.stranded.since, crew: h.stranded.crew, crewUntil: h.stranded.crewUntil, crewEndDay: h.stranded.crewEndDay, recovery: h.stranded.recovery, recoveredBy: h.stranded.recoveredBy, opId: h.opId || null })))
      // Repaired, waiting for a crew (§1a): listed with the stranded until it is recommissioned.
      .concat(Object.entries(book.polities || {}).flatMap(([pid, pol]) => (pol.hulls || []).filter((h) => h.recrew && h.status !== 'lost').map((h) => ({ polity: pid, hullId: h.id, vid: vidOf(h), systemIndex: h.systemIndex, hull: Math.round(h.hull), maxHull: h.maxHull, since: h.recrew.since, days: (db.lastDay ?? book.settled ?? 0) - h.recrew.since, crew: `${h.recrew.crewLeft}; complement ${Math.round((h.crew ?? 0) * 100)}% of ${Math.round((book.config.minOperatingCrew ?? 0.5) * 100)}% needed`, crewUntil: null, crewEndDay: null, recovery: 'repaired_awaiting_crew', recoveredBy: null, opId: h.opId || null })))),
    raidOrders: db.raidOrders.slice(),
    incidents: Object.values(db.incidents).map((i) => ({ ...i, observers: Object.entries(db.knowledge).filter(([, s]) => s[i.id]).map(([o, s]) => ({ observerId: o, provenance: s[i.id].provenance, confidence: s[i.id].confidence, receivedDay: s[i.id].receivedAt.value, evidence: Object.keys(s[i.id].evidence).length, survivors: Boolean(s[i.id].survivors), linkedLosses: s[i.id].linkedLosses.map((l) => l.factionId), resolution: s[i.id].resolution?.status || null })) })),
    evaluations: Object.values(db.lastEval).filter((e) => !observerFilter || e.actor === observerFilter),
    objectives: db.objectives.map((o) => ({ id: o.id, incidentId: o.incidentId, actor: o.actor, response: o.response, template: o.template, hullId: o.assigned.hullId, vid: o.assigned.vid, target: o.target?.locationId ?? null, createdDay: o.createdDay, deadline: o.deadline, status: o.status, resolution: o.resolution,
      charge: o.charge || null, escortState: o.escortState || null, reroute: o.reroute || null, arrivedDay: o.arrivedDay })),
    messages: db.messages.map((m) => ({ id: m.id, incidentId: m.incidentId, kind: m.kind, sender: m.sender, recipient: m.recipient, channel: m.channel, provenance: m.provenance, confidence: m.confidence, sentDay: m.sentDay, deliverDay: m.deliverDay, deliveredDay: m.deliveredDay, state: m.state, reason: m.reason, hops: m.hops,
      ...(({ claims, evidence, survivors, resolution, linkedLosses, pact }) => ({ claims: Object.keys(claims), evidence, survivors, resolution, linkedLosses, pact: pact?.pactKey || null }))(m.compact ? m.payload : compactPayload(m.payload)) })),
    reevaluations: db.reevaluations.slice(),
    conflicts: db.conflicts.slice(),
    contracts: Object.values(db.contracts).map((c) => ({ ...c })),
    assignments: db.assignments.filter((a) => a.status === 'active').map((a) => ({ id: a.id, kind: a.kind, polity: a.polity, hullId: a.hullId, vid: a.vid, at: a.itinerary[a.pos]?.systemIndex, milestones: a.milestones.map((m) => `${m.kind}@${m.locationId} due ${m.dueDay}+${m.grace} ${m.status}`) })),
    shadowTail: db.shadow.slice(-40),
    stats: db.stats,
  };
}
