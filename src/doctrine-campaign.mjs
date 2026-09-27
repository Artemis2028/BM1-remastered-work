// Doctrine runtime, phase 1: the observer-evidence adapter, persistent asset_overdue incidents, the
// shadow evaluator and three live pilot responses, on the campaign's real hulls.
// Rules: docs/doctrine/DOCTRINE-RUNTIME-PHASE1.md.
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
import { seededUnit, applicableBlockadesAt, resolveBlockadeRun, shortestRoute, strategicAssignments, warAuthorityStamp, warAuthorityHolds } from './campaign-strategy.mjs';
import { classifyDamage } from './ship-fleet.mjs';

export const DOCTRINE_BOOK_VERSION = 1;
export const CLOCK = 'strategic_jumps';
// First-pass pilot tuning. Every duration is in campaign days; none is a measured value.
export const DOCTRINE_PILOT = Object.freeze({
  enabled: true,
  // The only live doctrine decisions this round. Everything else is evaluated and logged in shadow.
  live: Object.freeze([
    Object.freeze({ profile: 'romulan', role: 'commander', response: 'investigate' }),
    Object.freeze({ profile: 'delpin', role: 'explorer', response: 'investigate' }),
    Object.freeze({ profile: 'vulcan', role: 'relief', response: 'rescue' }),
  ]),
  // Routine assignments that give asset_overdue something real to be about. Per polity, how many run at once.
  patrols: Object.freeze({ romulan: 1 }),
  explorers: Object.freeze({ delpin: 1 }),
  reliefShips: Object.freeze({ vulcan: 1 }),
  // Observers whose evaluations are always logged, known or not (so "knows nothing, does nothing" is on record).
  watchCommands: Object.freeze(['romulan', 'klingon', 'delpin', 'vulcan', 'cardassian', 'terran', 'dominion', 'dominion_remnant']),
  patrolEveryDays: 10, patrolDwellDays: 3,
  exploreEveryDays: 12, exploreDwellDays: 1, exploreHops: 2,
  arrivalGraceDays: 1, checkInGraceDays: 2,
  investigationDwellDays: 2, investigationDeadlineDays: 14,
  rescueDwellDays: 1, rescueDeadlineDays: 10,
  maxResponseHops: 6, minSupply: 0.3, maxLiveObjectivesPerPolity: 1,
  evidenceLifeDays: 90, searchAreaFreshDays: 30, survivorWindowDays: 20, survivorPodChance: 0.5,
  shadowLogLimit: 120, reportLimit: 200, sightingLimit: 60, closedLimit: 40, closedAssignmentLimit: 12, incidentHistoryLimit: 20,
});

// ---------- book ----------
export function doctrineBook(book) {
  const d = (book.doctrine ||= {});
  d.version ??= DOCTRINE_BOOK_VERSION;
  d.config = { ...DOCTRINE_PILOT, ...(d.config || {}) };
  d.counter ??= 0;
  for (const k of ['incidents', 'knowledge', 'briefings', 'pactTasks', 'orders', 'lastEval', 'designations', 'lastRun']) d[k] ||= {};
  for (const k of ['assignments', 'objectives', 'reports', 'shadow', 'closed']) if (!Array.isArray(d[k])) d[k] = [];
  d.ground ||= {};
  d.ground.evidence ||= {};
  d.ground.fates ||= {};
  d.stats ||= { incidents: 0, objectives: 0, deferred: 0, shadowEvaluations: 0, reports: 0, blockadeRuns: 0 };
  return d;
}
// Doctrine keeps its own counter: taking numbers from the campaign's would renumber every later hull and
// operation, and the seeded draws keyed on those IDs with them.
function nid(book, db, type) { db.counter++; return `${book.seed}:doctrine-${type}:${db.counter}`; }
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
function learn(db, observerId, incident, { provenance, confidence, day, from = null, claims = {}, observedDay = null }) {
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
  return k;
}
// What an observer tells another: only the claims it holds, never the hidden manifest unless the
// sender both knows it and chooses to disclose it (nobody does, this round).
function claimsToShare(k, { disclose = [] } = {}) {
  const out = {};
  for (const name of ['asset', 'assignment', 'missedMilestone', 'detectedAt', 'lastKnown']) if (k.claims[name]) out[name] = k.claims[name];
  out.cargo = disclose.includes('cargo') && k.claims.cargo ? k.claims.cargo : { knowledge: 'unknown', manifest: null };
  return out;
}
function shareEvidence(k) {
  return Object.values(k.evidence || {}).map((e) => ({ ...e }));
}
// A report sent from one observer to another. Dedupes on (incident, from, to, kind); the recipient
// learns only what the sender held on the day it was sent.
export function transmit(db, book, world, { incidentId, from, to, day, kind = 'report', provenance = 'received_report', disclose = [], confidence = null }) {
  const incident = db.incidents[incidentId];
  const sender = knowledgeOf(db, from, incidentId);
  if (!incident || !sender || from === to) return null;
  const id = `${incidentId}|${from}|${to}|${kind}`;
  if ((incident.relays || []).includes(`${from}|${to}|${kind}`)) return null;
  (incident.relays ||= []).push(`${from}|${to}|${kind}`);
  if (!(incident.reportedBy ||= []).includes(from)) incident.reportedBy.push(from);
  // Trusted: an owner speaking about its own asset, one's own side, or an eyewitness account (the sender
  // saw or examined the evidence itself) from a power not at war with the recipient. Anything else
  // starts tentative and needs a second, independent source.
  const firstParty = sender.claims.asset?.factionId && observerSide(book, from) === sender.claims.asset.factionId;
  const fromSide = observerSide(book, from), toSide = observerSide(book, to);
  const sameSide = fromSide != null && fromSide === toSide;
  const eyewitness = Object.values(sender.evidence || {}).some((e) => ['direct_sensor', 'recovered_record'].includes(e.provenance)) || ['direct_sensor', 'direct_witness'].includes(sender.survivors?.provenance);
  const hostile = fromSide && toSide && fromSide !== 'player' && toSide !== 'player' && atWar(world, fromSide, toSide);
  const conf = confidence || (firstParty || sameSide || (eyewitness && !hostile) ? 'corroborated' : 'tentative');
  const k = learn(db, to, incident, { provenance, confidence: conf, day, from, claims: claimsToShare(sender, { disclose }) });
  for (const e of shareEvidence(sender)) mergeEvidence(k, { ...e, provenance: 'received_report', via: from });
  if (sender.survivors) k.survivors = { ...sender.survivors, provenance: 'received_report', via: from };
  for (const l of sender.linkedLosses || []) if (!k.linkedLosses.some((x) => x.factionId === l.factionId && x.evidenceId === l.evidenceId)) k.linkedLosses.push({ ...l });
  if (sender.resolution && !k.resolution) k.resolution = { ...sender.resolution, via: from };
  relinkSightings(book, world, db, to, day);
  db.reports.push({ id, incidentId, from, to, day, kind, provenance, confidence: conf });
  db.reports = db.reports.slice(-db.config.reportLimit);
  db.stats.reports++;
  refreshLinks(db, to, k);
  return k;
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
  set('contract_affected', Boolean(k.claims.assignment?.contractId && side && db.orders?.[side]?.some?.((o) => o.contractId === k.claims.assignment.contractId)), 'contracts are not modelled for AI assets in phase 1');
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
  const { polity, hullId, kind, doctrineRole, stops, objectiveId = null, cargo = null } = spec;
  const h = liveHull(book, polity, hullId);
  if (!h) return { ok: false, reason: 'no such vessel' };
  const itinerary = buildItinerary(world, polity, [{ systemIndex: h.systemIndex }, ...stops]);
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
    cargo: cargo || { knowledge: 'verified', manifest: [] }, runs: [] };
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
function currentSystem(a) { return a.itinerary[a.pos]?.systemIndex; }
// Runs the hull one leg: a day's jump to the next system, through every blockade that bears on it, with
// the same interception engine every other runner uses.
function stepAssignment(book, world, db, a, day, effects) {
  const h = liveHull(book, a.polity, a.hullId);
  if (!h || h.opId !== a.id) return;
  if (classifyDamage(h.hull, h.maxHull) !== 'operational') return; // disabled where it is
  if (h.status !== 'assigned') h.status = 'assigned'; // a repair tick does not release it
  if (day < a.nextDay) return;
  if (a.dwellLeft > 0) { a.dwellLeft--; a.nextDay = day + 1; if (a.dwellLeft > 0 || a.pos < a.itinerary.length - 1) return; }
  if (a.pos >= a.itinerary.length - 1) return;
  const next = a.itinerary[a.pos + 1];
  // A blockade at the next system bears on this sponsor's ship as it arrives.
  for (const b of applicableBlockadesAt(book, world, next.systemIndex, a.polity)) {
    const runner = { key: `${a.id}:${a.pos + 1}:${day}`, sponsor: a.polity, kind: 'doctrine', hulls: [{ hullId: h.id, vid: vidOf(h), shipId: h.shipId, hull: h.hull, maxHull: h.maxHull, crew: h.crew, role: a.doctrineRole }] };
    const r = resolveBlockadeRun(book, world, b, runner, day, effects, { meta: { doctrineAssignmentId: a.id, objectiveId: a.objectiveId } });
    db.stats.blockadeRuns++;
    a.runs.push({ day, blockadeId: b.id, at: next.systemIndex, outcome: r.outcome });
    a.runs = a.runs.slice(-10);
    const x = r.hulls.find((y) => y.hullId === h.id);
    if (x && x.condition === 'disabled') { h.status = 'repairing'; h.systemIndex = Number(next.systemIndex); a.pos += 1; a.dwellLeft = next.dwell; return; }
    if (x && x.condition === 'destroyed') { h.systemIndex = Number(next.systemIndex); return; }
    if (!r.continues) { a.nextDay = day + 1; return; } // turned back: tries again tomorrow from where it was
  }
  a.pos += 1;
  h.systemIndex = Number(next.systemIndex);
  a.dwellLeft = next.dwell;
  a.nextDay = day + 1;
  effects.push({ type: 'doctrineMoved', id: a.id, polity: a.polity, hullId: h.id, systemIndex: h.systemIndex, day, kind: a.kind, objectiveId: a.objectiveId });
  // Milestone: the owner hears from it when it reaches the stop.
  const m = a.milestones.find((x) => x.stopIndex === a.pos && x.status !== 'met');
  if (m) {
    m.status = 'met'; m.metDay = day;
    a.lastReport = { systemIndex: h.systemIndex, locationId: locationIdFor(world, h.systemIndex), day };
    onMilestoneMet(book, world, db, a, m, day, effects);
  }
  if (a.pos >= a.itinerary.length - 1 && a.dwellLeft <= 0 && ['patrol', 'exploration', 'return'].includes(a.kind)) endAssignment(db, book, a, day, 'completed', 'itinerary complete');
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
function recordFates(book, world, db, day) {
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
    const pods = fate === 'disabled' || seededUnit(book.seed, 'doctrine-pods', a.id, day) < db.config.survivorPodChance;
    addEvidence(book, world, db, { systemIndex: where, day, wreck: { vid: a.vid, hullId: a.hullId, polity: a.polity, shipId: h?.shipId ?? null, factionId: a.polity, designFaction: shipFaction, condition: fate }, survivors: pods ? { crew: true, untilDay: day + db.config.survivorWindowDays, aboard: fate === 'disabled' ? a.hullId : null } : null, sourceAssignment: a.id });
  }
  // A disabled hulk is not a permanent wreck: if it is repaired and leaves, or is lost after all, the
  // site changes with it. (Its crew were aboard; they leave with it, or are lost with it.)
  for (const site of Object.values(db.ground.evidence)) {
    for (const w of site.wrecks) {
      if (w.condition !== 'disabled' || !w.hullId) continue;
      const hh = hullOf(book, w.polity, w.hullId);
      const gone = !hh || hh.status === 'lost';
      const away = hh && !gone && (Number(hh.systemIndex) !== site.systemIndex || classifyDamage(hh.hull, hh.maxHull) === 'operational');
      if (gone) { w.condition = 'destroyed'; if (site.survivors?.aboard === w.hullId) { site.survivors.untilDay = Math.min(site.survivors.untilDay, day - 1); site.survivors.lostWithHull = true; } }
      else if (away) {
        w.departed = day;
        if (site.survivors?.aboard === w.hullId && !site.survivors.rescued) { site.survivors.untilDay = Math.min(site.survivors.untilDay, day - 1); site.survivors.leftWithHull = true; }
        // Its fate is open again: whatever happens to it next is recorded where it happens.
        for (const [aid, f] of Object.entries(db.ground.fates)) if (f.hullId === w.hullId && f.fate === 'disabled') delete db.ground.fates[aid];
      }
    }
    site.wrecks = site.wrecks.filter((w) => !w.departed);
    // Nothing left there — no wreck, nobody waiting: the site is gone. There is nothing more to see.
    if (!site.wrecks.length && !(site.survivors && !site.survivors.rescued && site.survivors.untilDay >= day)) delete db.ground.evidence[site.id];
  }
}
function addEvidence(book, world, db, { systemIndex, day, wreck, survivors, sourceAssignment = null }) {
  const locationId = locationIdFor(world, systemIndex);
  // One site per location: wrecks accumulate at the same place.
  let site = Object.values(db.ground.evidence).find((e) => e.locationId === locationId && e.expiresDay >= day);
  if (!site) {
    const id = `ev:${locationId}:${day}:${Object.keys(db.ground.evidence).length + 1}`;
    site = db.ground.evidence[id] = { id, locationId, systemIndex: Number(systemIndex), createdDay: day, expiresDay: day + db.config.evidenceLifeDays, kind: 'debris', wrecks: [], survivors: null, examinedBy: [], sources: [] };
  }
  site.wrecks.push(wreck);
  if (survivors) site.survivors = { ...(site.survivors || {}), ...survivors, rescued: false };
  if (sourceAssignment) site.sources.push(sourceAssignment);
  site.expiresDay = Math.max(site.expiresDay, day + db.config.evidenceLifeDays);
  return site;
}
// A forced, unwitnessed loss for authored scenarios and the debug panel: the ship simply does not come
// back. Labelled as an override wherever it is offered.
export function loseAssignmentHullUnwitnessed(book, world, assignmentId, day, mode = 'destroyed') {
  const db = doctrineBook(book);
  const a = db.assignments.find((x) => x.id === assignmentId && x.status === 'active');
  if (!a) return { ok: false, reason: 'no such active assignment' };
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
      // A vessel's crew tells its own command at once.
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
    mergeEvidence(k, { evidenceId: s.evidenceId, locationId: s.locationId, kind: 'debris', observedDay: s.observedDay, recoverable: s.recoverable, recovered: false, wrecks: s.wrecks || [], provenance: s.provenance });
    if (s.survivors) k.survivors = { locationId: s.locationId, observedDay: s.observedDay, provenance: s.provenance, rescued: false };
    k.updatedDay = Math.max(k.updatedDay ?? 0, day);
    refreshLinks(db, observerId, k);
  }
}
// Evidence seen before the incident was known links once it is: the sightings are the observer's own.
function relinkSightings(book, world, db, observerId, day) {
  for (const s of Object.values(db.sightings?.[observerId] || {})) linkSightingToIncidents(book, world, db, observerId, s, day);
}
function relaySightingToCommand(book, world, db, o, s, day) {
  const cmd = `command:${o.polity}`;
  const sight = ((db.sightings ||= {})[cmd] ||= {});
  const prev = sight[s.evidenceId];
  sight[s.evidenceId] = { ...s, provenance: 'received_report', via: o.observerId, observedDay: Math.max(prev?.observedDay ?? 0, s.observedDay) };
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
        const ok = knowledgeOf(db, `command:${a.polity}`, existing.id);
        if (ok) { ok.claims.alsoMissed = [...(ok.claims.alsoMissed || []), { milestoneId: m.id, kind: m.kind, dueAt: at(m.dueDay), grace: m.grace, detectedAt: at(day) }]; ok.updatedDay = day; }
        continue;
      }
      const inc = db.incidents[id] = {
        id, eventType: 'asset_overdue', assetId: a.vid, hullId: a.hullId, polity: a.polity, assignmentId: a.id, milestoneId: m.id,
        locationId: m.locationId, jurisdictionAtOccurrence: jurisdictionAt(world, m.systemIndex), createdDay: day, detectedBy: `command:${a.polity}`,
        status: 'open', resolution: null, objectives: [],
      };
      db.stats.incidents++;
      const assetRole = { patrol: 'patrol', exploration: 'explorer', investigation: 'other', rescue: 'other', return: 'other' }[a.kind] || 'other';
      const route = [...new Set(a.itinerary.map((s) => locationIdFor(world, s.systemIndex)))];
      learn(db, `command:${a.polity}`, inc, { provenance: 'direct_witness', confidence: 'corroborated', day, from: null, observedDay: day,
        claims: {
          asset: { assetId: a.vid, kind: 'ship', role: assetRole, ownerId: `polity:${a.polity}`, factionId: a.polity },
          assignment: { assignmentId: a.id, kind: { patrol: 'patrol', exploration: 'exploration', investigation: 'other', rescue: 'other', return: 'other' }[a.kind] || 'other', originLocationId: a.origin, destinationLocationId: a.destination, contractId: null },
          cargo: a.cargo, missedMilestone: { milestoneId: m.id, kind: m.kind, dueAt: at(m.dueDay), grace: m.grace }, detectedAt: at(day),
          lastKnown: { locationId: a.lastReport.locationId, position: null, observedAt: at(a.lastReport.day) }, route,
        } });
      relinkSightings(book, world, db, `command:${a.polity}`, day);
      effects.push({ type: 'doctrineIncident', id, polity: a.polity, locationId: inc.locationId, systemIndex: m.systemIndex, day });
      // The owner's command hands a routine overdue notice to its own relief/explorer vessels.
      for (const obs of ownVesselObservers(db, a.polity)) transmit(db, book, world, { incidentId: id, from: `command:${a.polity}`, to: obs, day, kind: 'internal' });
    }
  }
}
function ownVesselObservers(db, polity) {
  const out = new Set();
  for (const [hid] of Object.entries(db.designations?.[polity] || {})) out.add(`hull:${hid}`);
  for (const a of db.assignments) if (a.status === 'active' && a.polity === polity && ['exploration'].includes(a.kind)) out.add(`hull:${a.hullId}`);
  return [...out];
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
  // Relief ships are a designation on a home hull: it stays in the ordinary pool (and can be taken by
  // an operation), which is exactly why capacity is checked when a rescue is wanted.
  for (const [polity, n] of Object.entries(c.reliefShips || {})) {
    if (!book.polities[polity]) continue;
    const des = (db.designations[polity] ||= {});
    for (const hid of Object.keys(des)) if (!liveHull(book, polity, hid)) delete des[hid];
    const home = world.systems.filter((s) => s.controller === polity).map((s) => s.index);
    const live = (book.polities[polity].hulls || []).filter((h) => h.status !== 'lost' && home.includes(Number(h.systemIndex))).sort((x, y) => String(x.id).localeCompare(String(y.id)));
    for (const h of live) { if (Object.keys(des).length >= n) break; if (!des[h.id]) des[h.id] = 'relief'; }
  }
}

// ---------- capacity: can_respond means something real ----------
// A suitable vessel exists, is not committed incompatibly, has a route, the supply and range to use
// it, and can reach the target before the objective's deadline. Otherwise the answer names what is
// missing and the response is deferred — nothing is ever spawned.
export function responseCapacity(book, world, db, observerId, response, target, day) {
  const c = db.config;
  const polity = observerSide(book, observerId);
  const out = { ok: false, hullId: null, vid: null, route: null, reason: null, response };
  if (!polity || !book.polities[polity]) return { ...out, reason: 'no organisation behind this observer' };
  if (target?.systemIndex == null) return { ...out, reason: 'no known place to go' };
  const p = book.polities[polity];
  if (Number(p.supply ?? 1) < c.minSupply) return { ...out, reason: `supply ${Number(p.supply).toFixed(2)} below ${c.minSupply}` };
  const busy = db.objectives.filter((o) => o.status === 'active' && o.polity === polity).length;
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
    const compatible = !h.opId ? (h.status === 'ready') : Boolean(job && ['exploration', 'patrol'].includes(job.kind) && h.opId === job.id);
    if (!compatible) return { ...out, reason: h.opId ? `committed to ${String(h.opId)}` : `vessel is ${h.status}` };
    if (classifyDamage(h.hull, h.maxHull) !== 'operational') return { ...out, reason: 'vessel is not operational' };
    candidates.push(h);
  } else {
    // A command assigns one of its own spare, armed ships (never a world's last defenders).
    candidates.push(...spareHulls(book, world, db, polity, (h) => (world.shipStats(h.shipId)?.combat ?? 1) >= 0.5));
    if (!candidates.length) return { ...out, reason: 'no spare armed vessel (garrison floor kept)' };
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
  return { ok: true, hullId: best.h.id, vid: vidOf(best.h), route: best.route, hops, reason: `${best.h.id} (${hops} jumps)`, response };
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
function createObjective(book, world, db, doctrine, { observerId, doc, incident, response, capacity, target }, day, effects) {
  const tmplId = doctrine.data.responseCatalog[response].objective;
  const tmpl = doctrine.data.objectiveTemplates[tmplId];
  const polity = observerSide(book, observerId);
  const id = nid(book, db, 'obj');
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
  o.assignmentId = r.assignment.id;
  o.fromSystem = r.assignment.itinerary[0].systemIndex;
  db.objectives.push(o);
  incident.objectives.push(id);
  db.stats.objectives++;
  o.actions.push({ day, action: 'assigned', detail: `${capacity.hullId} → ${target.locationId}` });
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
  return f;
}
function workObjective(book, world, db, o, day, effects) {
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
      o.found = { complete: true, rescued: true };
    } else o.found = { searched: true };
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
  const actorK = knowledgeOf(db, o.actor, o.incidentId);
  const targets = [...new Set([o.actor, hullObs, cmd])];
  if (o.found?.evidenceRecovered) {
    for (const obs of targets) {
      const k = knowledgeOf(db, obs, o.incidentId) || (actorK ? learn(db, obs, inc, { provenance: 'received_report', confidence: 'corroborated', day, from: o.actor, claims: claimsToShare(actorK) }) : null);
      if (!k) continue;
      mergeEvidence(k, { evidenceId: o.found.evidenceId, locationId: o.target.locationId, kind: 'debris', observedDay: day, recoverable: true, recovered: true, wrecks: o.found.wrecks, provenance: 'recovered_record' });
      if (o.found.survivors) k.survivors = { ...o.found.survivors, provenance: 'direct_sensor', rescued: false };
      k.updatedDay = day;
      refreshLinks(db, obs, k);
      // The missing ship's own registry in the wreckage locates it — for whoever knew which ship was missing.
      const mine = k.claims.asset?.assetId && o.found.wrecks.find((w) => w.vid === k.claims.asset.assetId);
      if (mine) {
        k.located = { vid: mine.vid, locationId: o.target.locationId, condition: mine.condition, day };
        if (!k.resolution) k.resolution = { status: 'asset_located', day };
        if (obs === inc.detectedBy) for (const other of Object.values(db.incidents)) if (other.assignmentId === inc.assignmentId) resolveIncident(book, world, db, other, day, 'asset_located', `${mine.vid} found ${mine.condition} at ${o.target.locationId}`, effects, o.id);
      }
    }
    effects.push({ type: 'doctrineEvidenceRecovered', id: o.id, polity: o.polity, systemIndex: o.target.systemIndex, day, wrecks: o.found.wrecks.map((w) => w.designFaction) });
  }
  if (o.found?.rescued) {
    for (const obs of targets) { const k = knowledgeOf(db, obs, o.incidentId); if (k?.survivors) k.survivors.rescued = true; }
    effects.push({ type: 'doctrineRescued', id: o.id, polity: o.polity, systemIndex: o.target.systemIndex, day });
  }
}
function closeObjectives(doctrine, book, world, db, day, effects) {
  for (const o of db.objectives) {
    if (o.status !== 'active') continue;
    const facts = objectiveFacts(book, world, db, o, day);
    const st = D.objectiveStatus(doctrine, o.template, facts);
    if (st.status === 'open') continue;
    o.status = st.status; o.closedDay = day;
    o.resolution = { status: st.status, reasons: st.reasons, alsoSucceeded: st.alsoSucceeded || [], day, note: o.cancelRequested || null };
    o.actions.push({ day, action: 'closed', detail: `${st.status}: ${st.reasons.join(', ')}` });
    const a = db.assignments.find((x) => x.id === o.assignmentId);
    if (a && a.status === 'active') { for (const m of a.milestones) if (m.status === 'pending') m.status = 'superseded'; endAssignment(db, book, a, day, st.status === 'completed' ? 'completed' : 'ended', `objective ${st.status}`); }
    // Home under a separate return order: nothing more happens under the closed objective.
    const h = liveHull(book, o.polity, o.assigned.hullId);
    if (h && !h.opId && h.status === 'ready' && classifyDamage(h.hull, h.maxHull) === 'operational') {
      const home = nearestHeld(world, o.polity, h.systemIndex);
      if (home != null && home !== Number(h.systemIndex)) issueAssignment(book, world, { polity: o.polity, hullId: h.id, kind: 'return', doctrineRole: o.role === 'commander' ? 'patrol' : o.role, stops: [{ systemIndex: home, dwell: 0, milestone: null }] }, day, effects);
    }
    effects.push({ type: 'doctrineObjective', id: o.id, incidentId: o.incidentId, polity: o.polity, response: o.response, hullId: o.assigned.hullId, vid: o.assigned.vid, to: o.target.systemIndex, day, status: o.status, reasons: st.reasons });
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
function trimClosed(db) {
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
  for (const [k, e] of Object.entries(db.lastEval)) { const inc = db.incidents[e.incident]; if (e.trace && inc && inc.status !== 'open' && (db.lastDay ?? 0) - (inc.resolution?.day ?? 0) > 30) delete e.trace; }
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
}

// ---------- evaluation ----------
// Which observers are evaluated for an incident: everyone who knows of it, plus the watched commands
// and the pilot vessels (so "knows nothing, does nothing" is on record).
function observersFor(book, db, incidentId) {
  const out = new Set();
  for (const [obs, store] of Object.entries(db.knowledge)) if (store[incidentId]) out.add(obs);
  if (db.incidents[incidentId]?.status !== 'open') { out.delete('player'); return [...out].sort(); }
  for (const p of db.config.watchCommands || []) if (book.polities[p]) out.add(`command:${p}`);
  for (const [polity, des] of Object.entries(db.designations || {})) for (const hid of Object.keys(des)) if (liveHull(book, polity, hid)) out.add(`hull:${hid}`);
  for (const a of db.assignments) if (a.status === 'active' && a.kind === 'exploration') out.add(`hull:${a.hullId}`);
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
    capacityFor: (response) => { target = responseTarget(db, observerId, incidentId, response, day); capacity = responseCapacity(book, world, db, observerId, response, target, day); return capacity; } })
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
      if (live && existing) notActing = `objective ${existing.id} already ${existing.status}`;
      else if (live) {
        const r = createObjective(book, world, db, doctrine, { observerId: obs, doc: { profileId: ev.profileId, role: ev.role }, incident: inc, response: ev.response, capacity: ev.capacity, target: ev.target }, day, effects);
        acted = r.ok ? r.objective.id : null;
        if (r.ok) { (inc.objectiveKeys ||= []).push(okey); (inc.objectiveIds ||= {})[okey] = r.objective.id; }
        if (!r.ok) notActing = r.reason;
      } else if (ev.deferred) { notActing = `defer:${ev.response} — ${ev.failed.join(', ')}${ev.capacity && !ev.capacity.ok ? ` (${ev.capacity.reason})` : ''}`; db.stats.deferred++; }
      else if (ev.response && ev.result === ev.response) notActing = 'shadow only: this profile/role/response is not enabled live this round';
      else notActing = ev.result === 'ignore_unknown' ? 'not known to this observer' : ev.result === 'record_only' ? 'recorded; no interest rule matched' : ev.result;
      const entry = { day, actor: obs, incident: inc.id, profile: ev.profileId, role: ev.role, culture: ev.culture, knownFacts: ev.knownFacts, matchedRule: ev.matchedRule?.id || null,
        proposal: ev.result, response: ev.response, failed: ev.failed, capacity: ev.capacity ? { ok: ev.capacity.ok, reason: ev.capacity.reason, hullId: ev.capacity.hullId } : null,
        live: Boolean(live), objective: acted || existing?.id || null, notActing: acted ? null : notActing, existing: existingActivity(book, world, obs) };
      const key = `${obs}|${inc.id}`;
      db.lastEval[key] = { ...entry, trace: ev.trace, reason: ev.reason, profileReason: ev.profileReason, roleReason: ev.roleReason };
      const sig = JSON.stringify([entry.proposal, entry.response, entry.failed, entry.matchedRule, entry.objective, entry.capacity?.ok, entry.knownFacts]);
      if (db.lastRun[key] !== sig) {
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
      for (const obs of presentObservers(book, world, db, here)) if (obs.polity !== o.polity) transmit(db, book, world, { incidentId: o.incidentId, from: `command:${o.polity}`, to: obs.observerId, day, kind: `hail:${here}` });
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
  for (const a of db.assignments) if (a.status === 'active') stepAssignment(book, world, db, a, day, effects);
  recordFates(book, world, db, day);
  detectOverdue(book, world, db, day, effects);
  detectSites(book, world, db, day, effects);
  for (const o of db.objectives) if (o.status === 'active') workObjective(book, world, db, o, day, effects);
  closeObjectives(doctrine, book, world, db, day, effects);
  evaluateAll(doctrine, book, world, db, day, effects);
  searchHails(book, world, db, day, effects);
  for (const a of db.assignments) if (a.status === 'active' && a.kind === 'return' && a.pos >= a.itinerary.length - 1) endAssignment(db, book, a, day, 'completed', 'home');
  // An owner writes off a vessel it has not heard from for a long time: the assignment ends (a wreck,
  // if any, stays where it is; a disabled hull keeps its record). The incident is not deleted.
  for (const a of db.assignments) {
    if (a.status !== 'active') continue;
    const missed = a.milestones.filter((m) => m.status === 'missed');
    if (missed.length && day - Math.min(...missed.map((m) => m.dueDay + m.grace)) > db.config.evidenceLifeDays) endAssignment(db, book, a, day, 'written_off', 'no word from the vessel');
  }
  trimClosed(db);
}

// With doctrine off (or not loaded), nothing may stay parked on a doctrine job: every assignment ends,
// every live objective is called off, and the hulls go back to their powers where they stand.
export function releaseDoctrineHulls(book, day, reason = 'doctrine switched off', effects = []) {
  const db = book.doctrine;
  if (!db || !Array.isArray(db.assignments)) return 0;
  let n = 0;
  for (const o of db.objectives || []) if (o.status === 'active') { o.status = 'aborted'; o.closedDay = day; o.resolution = { status: 'aborted', reasons: ['objective_cancelled'], day, note: reason }; }
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
  return transmit(db, book, world, { incidentId, from, to, day, kind: opts.kind || 'relay', confidence: opts.confidence || null, disclose: opts.disclose || [] });
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
export function debugSummary(book, observerFilter = null) {
  const db = doctrineBook(book);
  return {
    incidents: Object.values(db.incidents).map((i) => ({ ...i, observers: Object.entries(db.knowledge).filter(([, s]) => s[i.id]).map(([o, s]) => ({ observerId: o, provenance: s[i.id].provenance, confidence: s[i.id].confidence, receivedDay: s[i.id].receivedAt.value, evidence: Object.keys(s[i.id].evidence).length, survivors: Boolean(s[i.id].survivors), linkedLosses: s[i.id].linkedLosses.map((l) => l.factionId), resolution: s[i.id].resolution?.status || null })) })),
    evaluations: Object.values(db.lastEval).filter((e) => !observerFilter || e.actor === observerFilter),
    objectives: db.objectives.map((o) => ({ id: o.id, incidentId: o.incidentId, actor: o.actor, response: o.response, hullId: o.assigned.hullId, vid: o.assigned.vid, target: o.target.locationId, createdDay: o.createdDay, deadline: o.deadline, status: o.status, resolution: o.resolution })),
    assignments: db.assignments.filter((a) => a.status === 'active').map((a) => ({ id: a.id, kind: a.kind, polity: a.polity, hullId: a.hullId, vid: a.vid, at: a.itinerary[a.pos]?.systemIndex, milestones: a.milestones.map((m) => `${m.kind}@${m.locationId} due ${m.dueDay}+${m.grace} ${m.status}`) })),
    shadowTail: db.shadow.slice(-40),
    stats: db.stats,
  };
}
