// Pure tests for faction doctrine runtime phase 1 (docs/doctrine/DOCTRINE-RUNTIME-PHASE1.md), kept green under
// phase 2. Phase 1's losses are silent (the ship's comms went with it): no distress call goes out, so what
// anyone learns comes from the owner's records, sightings and reports, exactly as phase 1 specified.
// The doctrine package is loaded from docs/doctrine/ exactly as the game loads it; the campaign runs on
// the shared synthetic galaxy with three extra systems: Delpi, Vulcan and Aldnas, an unclaimed frontier
// between Romulan, Klingon and Delpin space.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import * as C from '../src/campaign-strategy.mjs';
import * as D from '../src/doctrine-runtime.mjs';
import * as DC from '../src/doctrine-campaign.mjs';
import { makeWorld, run, HULLS, POOLS } from './campaign-world-fixture.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (f) => JSON.parse(fs.readFileSync(path.join(root, f), 'utf8'));
const DATA = read('docs/doctrine/bm1-faction-doctrine.v0.2.1.json');
const SCHEMA = read('docs/doctrine/bm1-faction-doctrine.schema.json');
const CASES = read('docs/doctrine/doctrine-acceptance.json').cases;
const doctrine = D.loadDoctrine(DATA, SCHEMA);
const out = process.env.BM1_TEST_OUTPUT || null;

let passed = 0;
const failures = [];
const log = {};
const test = (name, fn) => {
  try { fn(); passed++; console.log('PASS', name); }
  catch (e) { failures.push(name); console.log('FAIL', name, '\n      ', String(e?.message || e).split('\n').slice(0, 10).join('\n       ')); }
};

// ---- the galaxy ----
Object.assign(HULLS, {
  80: { price: 50000, mass: 3, combatHull: 420, faction: 'delpin', speed: 70, combat: 0.4, cargo: 40 },
  90: { price: 80000, mass: 4, combatHull: 700, faction: 'vulcan', speed: 50, combat: 1, cargo: 200 },
  91: { price: 30000, mass: 5, combatHull: 500, faction: 'cardassian', speed: 25, combat: 0, cargo: 900 },
  99: { price: 90000, mass: 5, combatHull: 800, faction: 'gorn' },
});
POOLS.delpin = [80]; POOLS.vulcan = [90]; POOLS.gorn = [99];
const IDX = { Earth: 0, Vega: 1, Border: 2, Qonos: 3, Romulus: 4, Cardassia: 5, Delpi: 9, Vulcan: 10, Aldnas: 11 };
function mk(seed, opts = {}) {
  const { world, relations } = makeWorld(opts);
  world.systems.push(
    { index: 9, name: 'Delpi', controller: 'delpin', origin: 'delpin', population: 3000 },
    { index: 10, name: 'Vulcan', controller: 'vulcan', origin: 'vulcan', population: 6000 },
    { index: 11, name: 'Aldnas', controller: null, origin: null, population: 0 },
  );
  world.routes.push([4, 11], [11, 9], [9, 10], [10, 1], [11, 2]);
  if (opts.gorn) world.systems.push({ index: 12, name: 'Gorn Ruins', controller: 'gorn', origin: 'gorn', population: 10 });
  const book = C.createCampaignBook(seed, 1);
  C.initializeCampaign(book, world);
  book.config.aiStrategicOps = false;
  book.config.planningIntervalDays = 1e9; // no AI offensives: the doctrine is what moves ships here
  if (opts.doctrine !== false) world.doctrineStep = (b, w, d, fx) => DC.advanceDoctrineDay(b, w, d, fx, doctrine);
  const db = DC.doctrineBook(book);
  // Routine pilot generation off unless a test asks for it: each test issues the jobs it needs.
  db.config = { ...db.config, patrols: opts.patrols || {}, explorers: opts.explorers || {}, reliefShips: opts.reliefShips || {}, merchants: opts.merchants || {}, projects: opts.projects || {}, patrolAreas: opts.patrolAreas || {} };
  return { world, book, db, relations };
}
const P = (book, id) => C.getPolity(book, id);
const lose = (book, world, id, day, mode = 'destroyed', opts = {}) => DC.loseAssignmentHullUnwitnessed(book, world, id, day, mode, { silent: true, ...opts });
const distressOf = (db) => Object.values(db.incidents).filter((i) => i.eventType === 'distress');
const ready = (book, id, at = null) => P(book, id).hulls.filter((h) => h.status === 'ready' && !h.opId && (at == null || h.systemIndex === at)).sort((a, b) => String(a.id).localeCompare(String(b.id)));
const incidentsOf = (db, polity) => Object.values(db.incidents).filter((i) => i.polity === polity);
const evalOf = (db, obs, inc) => db.lastEval[`${obs}|${inc}`];
// Hulls in the books, net of what ordinary AI production built meanwhile: anything else is a spawn.
const hullCount = (book) => Object.values(book.polities).reduce((n, p) => n + p.hulls.filter((h) => h.status !== 'lost').length, 0) - (book.stats.hullsBuilt || 0);
// A Romulan patrol Romulus → Aldnas → Romulus, lost (unwitnessed) once it is on station at Aldnas.
function romulanPatrolLost(env, { mode = 'destroyed', from = 1 } = {}) {
  const { world, book } = env;
  const h = ready(book, 'romulan', IDX.Romulus)[0];
  const r = DC.issuePatrol(book, world, 'romulan', h.id, IDX.Aldnas, from, []);
  assert.ok(r.ok, r.reason);
  run(book, world, from + 1, from + 1);            // arrives at Aldnas: arrival milestone met
  const lost = lose(book, world, r.assignment.id, from + 1, mode);
  assert.ok(lost.ok, lost.reason);
  return { hull: h, assignment: r.assignment, checkInDue: r.assignment.milestones.at(-1).dueDay, grace: r.assignment.milestones.at(-1).grace };
}

// 1 ------------------------------------------------------------------------------------------------
test('1. the doctrine package loads and validates as runtime data; the JS evaluator reproduces the package\'s own 59/59 cases', () => {
  assert.equal(doctrine.doctrineVersion, '0.2.1-draft');
  assert.equal(Object.keys(doctrine.data.profiles).length, 22);
  assert.equal(Object.keys(doctrine.data.cultures).length, 9);
  const res = D.runAcceptance(doctrine, CASES);
  log.acceptance = res;
  const bad = res.filter((r) => !r.ok);
  assert.equal(bad.length, 0, JSON.stringify(bad));
  assert.equal(res.length, 59);
  assert.ok(Object.isFrozen(doctrine.data.profiles.romulan), 'the loaded doctrine is mutable');
});
// 2 ------------------------------------------------------------------------------------------------
test('2. malformed doctrine and unknown fact/action/profile references are rejected with a clear error; string expressions are refused; missing profile data falls back safely', () => {
  const mutate = (fn) => { const d = JSON.parse(JSON.stringify(DATA)); fn(d); return d; };
  const expectError = (d, re) => { let err = null; try { D.loadDoctrine(d, SCHEMA); } catch (e) { err = e; } assert.ok(err instanceof D.DoctrineLoadError, 'no DoctrineLoadError'); assert.match(err.message, re); return err; };
  expectError(mutate((d) => { d.profiles.romulan.interestRules[0].when = { fact: 'dominion_is_evil' }; }), /unknown fact reference dominion_is_evil/);
  expectError(mutate((d) => { d.roleTemplates.patrol.intentPriority[0].action = 'orbital_bombardment'; }), /unknown actions reference orbital_bombardment/);
  expectError(mutate((d) => { d.scenarioTreaties[0].parties = ['dominion_central', 'orion_syndicate']; }), /unknown profiles reference orion_syndicate/);
  expectError(mutate((d) => { d.actions.attack = 'engagement_authorized && true'; }), /expected exactly one schema alternative/);
  expectError(mutate((d) => { d.actions.attack = { not: { fact: 'engagement_authorized' } }; }), /expected exactly one schema alternative|unsupported predicate/);
  expectError(mutate((d) => { d.actions.attack = { all: [] }; }), /expected exactly one schema alternative|nonempty/);
  expectError(mutate((d) => { delete d.facts; }), /missing facts/);
  let err = null; try { D.loadDoctrine(null, SCHEMA); } catch (e) { err = e; } assert.ok(err instanceof D.DoctrineLoadError);
  // Adapters cannot inject unknown facts or the policy-derived authority.
  assert.throws(() => D.react(doctrine, { profileId: 'romulan', role: 'commander', eventType: 'asset_overdue', facts: { event_known: true, i_feel_like_it: true } }), /Unknown input fact/);
  assert.throws(() => D.fireDecision(doctrine, { profileId: 'klingon', role: 'raider', facts: { engagement_authorized: true } }), /cannot be injected/);
  // Safe fallbacks: a runtime faction the doctrine has no profile for is record-only; an unsupported role is denied.
  const none = D.resolveProfile(doctrine, { runtimeFaction: 'orion' });
  assert.equal(none.profileId, null);
  assert.equal(D.react(doctrine, { profileId: null, role: 'commander', eventType: 'asset_overdue', facts: { event_known: true } }).result, 'record_only');
  assert.ok(doctrine.warnings.some((w) => /orion/.test(w)));
  assert.equal(D.selectRole(doctrine, 'vulcan', 'raider'), 'deny_assignment');
  assert.equal(D.selectRole(doctrine, 'vulcan', 'someLegacyRole'), 'civilian');
});
// 3 ------------------------------------------------------------------------------------------------
test('3. an incident nobody has received produces no response: the owner knows, the others are ignore_unknown', () => {
  const env = mk('DR-3');
  const x = romulanPatrolLost(env);
  run(env.book, env.world, 3, x.checkInDue + x.grace + 1);
  const [inc] = incidentsOf(env.db, 'romulan');
  assert.ok(inc, 'no incident');
  for (const obs of ['command:klingon', 'command:delpin', 'command:vulcan', 'command:cardassian']) {
    const e = evalOf(env.db, obs, inc.id);
    assert.equal(e.proposal, 'ignore_unknown', `${obs}: ${e.proposal}`);
    assert.equal(env.db.knowledge[obs]?.[inc.id], undefined, `${obs} holds a record it never received`);
  }
  assert.equal(env.db.objectives.filter((o) => o.polity !== 'romulan').length, 0);
});
// 4 ------------------------------------------------------------------------------------------------
test('4. a credible incident without capacity is deferred with its reason; no vessel is spawned', () => {
  const env = mk('DR-4');
  const x = romulanPatrolLost(env);
  // Every other Romulan ship is committed (and the home garrison floor still applies).
  for (const h of P(env.book, 'romulan').hulls) if (h.status === 'ready' && !h.opId) { h.status = 'assigned'; h.opId = 'elsewhere'; }
  const before = hullCount(env.book);
  run(env.book, env.world, 3, x.checkInDue + x.grace + 1);
  const [inc] = incidentsOf(env.db, 'romulan');
  const e = evalOf(env.db, 'command:romulan', inc.id);
  assert.equal(e.proposal, 'defer:investigate', JSON.stringify(e));
  assert.ok(e.failed.includes('can_respond'), JSON.stringify(e.failed));
  assert.match(e.notActing, /no spare armed vessel/);
  assert.equal(env.db.objectives.length, 0);
  assert.equal(hullCount(env.book), before, 'a vessel appeared');
  log.deferred = e;
});
// 5 ------------------------------------------------------------------------------------------------
test('5. Romulan command, told by its own records that its patrol is overdue, assigns an available investigator (live)', () => {
  const env = mk('DR-5');
  const x = romulanPatrolLost(env);
  const before = hullCount(env.book);
  const fx = run(env.book, env.world, 3, x.checkInDue + x.grace + 1);
  const [inc] = incidentsOf(env.db, 'romulan');
  assert.equal(inc.createdDay, x.checkInDue + x.grace + 1, 'detected on the wrong day (must be strictly after due + grace)');
  const k = env.db.knowledge['command:romulan'][inc.id];
  assert.equal(k.provenance, 'direct_witness'); assert.equal(k.confidence, 'corroborated');
  const e = evalOf(env.db, 'command:romulan', inc.id);
  assert.equal(e.proposal, 'investigate'); assert.equal(e.matchedRule, 'overdue_our_asset'); assert.equal(e.live, true);
  const o = env.db.objectives.find((y) => y.incidentId === inc.id);
  assert.ok(o, 'no objective');
  assert.equal(o.actor, 'command:romulan'); assert.equal(o.template, 'investigation'); assert.equal(o.clock, 'strategic_jumps');
  assert.equal(o.target.locationId, 'system:aldnas'); assert.ok(o.deadline.value > o.createdDay);
  const h = P(env.book, 'romulan').hulls.find((y) => y.id === o.assigned.hullId);
  assert.ok(h && h.id !== x.hull.id, 'the investigator is not an existing, different Romulan hull');
  assert.equal(hullCount(env.book), before, 'a vessel was spawned for the investigation');
  assert.ok(fx.some((f) => f.type === 'doctrineVisible' && f.kind === 'search-departed'));
  log.romulanObjective = o;
});
// 6, 7 ---------------------------------------------------------------------------------------------
test('6/7. Klingon command told of the Romulan loss records it; evidence later linking Klingon losses makes it reevaluate', () => {
  const env = mk('DR-6');
  const { world, book, db } = env;
  const x = romulanPatrolLost(env);
  // A Klingon scout lost at the same place, unwitnessed.
  const kh = ready(book, 'klingon', IDX.Border)[0];
  const kr = DC.issuePatrol(book, world, 'klingon', kh.id, IDX.Aldnas, 2, []);
  run(book, world, 3, 3);
  lose(book, world, kr.assignment.id, 3, 'destroyed');
  run(book, world, 4, x.checkInDue + x.grace + 1);
  const [inc] = incidentsOf(db, 'romulan');
  const day = book.settled;
  DC.relayReport(book, world, inc.id, 'command:romulan', 'command:klingon', day);
  run(book, world, day + 1, day + 1);
  let e = evalOf(db, 'command:klingon', inc.id);
  assert.equal(e.proposal, 'record_only', JSON.stringify(e));
  assert.ok(!e.knownFacts.includes('actor_attributed'), 'the report attributed an attacker');
  const kk = db.knowledge['command:klingon'][inc.id];
  assert.equal(kk.provenance, 'received_report');
  assert.deepEqual(kk.claims.cargo, { knowledge: 'unknown', manifest: null });
  // A Delpin explorer examines the site and its findings reach Klingon command.
  const dh = ready(book, 'delpin', IDX.Delpi)[0];
  const dr = DC.issueAssignment(book, world, { polity: 'delpin', hullId: dh.id, kind: 'exploration', doctrineRole: 'explorer', stops: [{ systemIndex: IDX.Aldnas, dwell: 6, milestone: 'arrival' }, { systemIndex: IDX.Delpi, milestone: 'check_in' }] }, book.settled, []);
  assert.ok(dr.ok);
  DC.relayReport(book, world, inc.id, 'command:romulan', `hull:${dh.id}`, book.settled);
  run(book, world, book.settled + 1, book.settled + 5);
  const dobj = db.objectives.find((o) => o.actor === `hull:${dh.id}`);
  assert.ok(dobj, 'the explorer took no objective');
  assert.equal(dobj.status, 'completed', JSON.stringify(dobj.resolution));
  DC.relayReport(book, world, inc.id, `hull:${dh.id}`, 'command:klingon', book.settled);
  run(book, world, book.settled + 1, book.settled + 1);
  e = evalOf(db, 'command:klingon', inc.id);
  assert.ok(e.knownFacts.includes('linked_own_losses'), JSON.stringify(e.knownFacts));
  assert.equal(e.matchedRule, 'shared_losses');
  assert.ok(['investigate', 'defer:investigate'].includes(e.proposal), e.proposal);
  assert.equal(e.live, false, 'Klingon investigation is shadow-only this round');
  assert.ok(!db.objectives.some((o) => o.polity === 'klingon'), 'a shadow proposal acted');
  log.klingonReevaluation = e;
});
// 8 ------------------------------------------------------------------------------------------------
test('8. a Delpin explorer that detects recoverable evidence of an incident it has heard of investigates it (live), reports what it found, and names nobody', () => {
  const env = mk('DR-8');
  const { world, book, db } = env;
  const x = romulanPatrolLost(env);
  run(book, world, 3, 3);
  // The explorer sees the debris first (it knows nothing of any incident yet).
  const dh = ready(book, 'delpin', IDX.Delpi)[0];
  DC.issueAssignment(book, world, { polity: 'delpin', hullId: dh.id, kind: 'exploration', doctrineRole: 'explorer', stops: [{ systemIndex: IDX.Aldnas, dwell: 12, milestone: 'arrival' }, { systemIndex: IDX.Delpi, milestone: 'check_in' }] }, 3, []);
  run(book, world, 4, x.checkInDue + x.grace + 1);
  const [inc] = incidentsOf(db, 'romulan');
  assert.ok(db.sightings[`hull:${dh.id}`], 'the explorer saw nothing at Aldnas');
  assert.equal(evalOf(db, `hull:${dh.id}`, inc.id).proposal, 'ignore_unknown', 'the explorer knew of the incident before hearing of it');
  DC.relayReport(book, world, inc.id, 'command:romulan', `hull:${dh.id}`, book.settled);
  run(book, world, book.settled + 1, book.settled + 4);
  const e = evalOf(db, `hull:${dh.id}`, inc.id);
  const o = db.objectives.find((y) => y.actor === `hull:${dh.id}`);
  assert.ok(o, JSON.stringify(e));
  assert.equal(o.response, 'investigate'); assert.equal(o.role, 'explorer'); assert.equal(o.profileId, 'delpin');
  assert.equal(o.status, 'completed');
  const k = db.knowledge[`hull:${dh.id}`][inc.id];
  assert.ok(Object.values(k.evidence).some((ev) => ev.recovered && ev.wrecks.some((w) => w.factionId === 'romulan')));
  assert.equal(k.attribution, null, 'the explorer invented an attribution');
  assert.ok(db.knowledge['command:delpin']?.[inc.id], 'the explorer did not report to its own command');
  assert.equal(db.knowledge['command:delpin'][inc.id].attribution, null);
});
// 9, 10 --------------------------------------------------------------------------------------------
test('9/10. a Vulcan relief ship with a usable survivor report rescues (live); the same ship with no survivor evidence does not', () => {
  const mkV = (seed) => {
    const env = mk(seed, { reliefShips: { vulcan: 1 } });
    const x = romulanPatrolLost(env, { mode: 'disabled' }); // crew still aboard the hulk
    run(env.book, env.world, 3, x.checkInDue + x.grace + 1);
    const relief = Object.keys(env.db.designations.vulcan)[0];
    return { ...env, x, relief, inc: incidentsOf(env.db, 'romulan')[0] };
  };
  // 10: only the overdue notice — no evidence, no survivors.
  const a = mkV('DR-10');
  DC.relayReport(a.book, a.world, a.inc.id, 'command:romulan', `hull:${a.relief}`, a.book.settled);
  run(a.book, a.world, a.book.settled + 1, a.book.settled + 3);
  const e10 = evalOf(a.db, `hull:${a.relief}`, a.inc.id);
  assert.ok(!e10.knownFacts.includes('survivors_known'));
  assert.equal(e10.proposal, 'record_only', JSON.stringify(e10));
  assert.ok(!a.db.objectives.some((o) => o.actor === `hull:${a.relief}`), 'rescue without survivor evidence');
  // 9: a survivor report (from a ship that saw the beacon) reaches the relief ship.
  const b = mkV('DR-9');
  const dh = ready(b.book, 'delpin', IDX.Delpi)[0];
  DC.issueAssignment(b.book, b.world, { polity: 'delpin', hullId: dh.id, kind: 'exploration', doctrineRole: 'explorer', stops: [{ systemIndex: IDX.Aldnas, dwell: 8, milestone: 'arrival' }, { systemIndex: IDX.Delpi, milestone: 'check_in' }] }, b.book.settled, []);
  DC.relayReport(b.book, b.world, b.inc.id, 'command:romulan', `hull:${dh.id}`, b.book.settled);
  run(b.book, b.world, b.book.settled + 1, b.book.settled + 2);
  assert.ok(!b.db.knowledge[`hull:${dh.id}`][b.inc.id].survivors, 'survivors were attached to the overdue record');
  // No call went out: the survivors are a distress incident opened by the ship that found them.
  const [dist] = distressOf(b.db);
  assert.ok(dist && b.db.knowledge[`hull:${dh.id}`]?.[dist.id]?.survivors, JSON.stringify(dist));
  DC.relayReport(b.book, b.world, dist.id, `hull:${dh.id}`, `hull:${b.relief}`, b.book.settled, { include: 'survivor_report' });
  run(b.book, b.world, b.book.settled + 1, b.book.settled + 6);
  const o = b.db.objectives.find((y) => y.actor === `hull:${b.relief}`);
  assert.ok(o, JSON.stringify(evalOf(b.db, `hull:${b.relief}`, dist.id)));
  assert.equal(o.incidentId, dist.id);
  assert.equal(dist.status, 'resolved'); assert.equal(dist.resolution.status, 'survivors_rescued');
  assert.equal(o.response, 'rescue'); assert.equal(o.role, 'relief'); assert.equal(o.status, 'completed', JSON.stringify(o.resolution));
  const site = Object.values(b.db.ground.evidence)[0];
  assert.equal(site.survivors.rescued, true);
  assert.equal(o.assigned.hullId, b.relief);
});
// 11 -----------------------------------------------------------------------------------------------
test('11. unknown cargo never reveals a hidden manifest: the owner knows it, a recipient gets null, and a payload that tries to carry it is invalid', () => {
  const env = mk('DR-11');
  const { world, book, db } = env;
  const h = ready(book, 'romulan', IDX.Romulus)[0];
  const r = DC.issuePatrol(book, world, 'romulan', h.id, IDX.Aldnas, 1, [], { cargo: { knowledge: 'verified', manifest: [{ cargoId: 'hidden:design-samples', quantity: 4 }] } });
  run(book, world, 2, 2);
  lose(book, world, r.assignment.id, 2);
  run(book, world, 3, r.assignment.milestones.at(-1).dueDay + 3);
  const [inc] = incidentsOf(db, 'romulan');
  const own = DC.overdueEventFor(db, 'command:romulan', inc.id);
  assert.deepEqual(own.cargo.manifest, [{ cargoId: 'hidden:design-samples', quantity: 4 }]);
  assert.deepEqual(D.eventErrors(doctrine, own), []);
  DC.relayReport(book, world, inc.id, 'command:romulan', 'command:klingon', book.settled);
  const theirs = DC.overdueEventFor(db, 'command:klingon', inc.id);
  assert.deepEqual(theirs.cargo, { knowledge: 'unknown', manifest: null });
  assert.deepEqual(D.eventErrors(doctrine, theirs), []);
  assert.ok(!JSON.stringify(db.knowledge['command:klingon']).includes('hidden:design-samples'));
  assert.ok(D.eventErrors(doctrine, { ...theirs, cargo: { knowledge: 'unknown', manifest: [{ cargoId: 'hidden:design-samples', quantity: 4 }] } }).length > 0);
  log.overduePayload = { own, theirs };
});
// 12 -----------------------------------------------------------------------------------------------
test('12. a last-known historical position is not a live weapon track: no strategic fact supplies one, and fire is refused', () => {
  const env = mk('DR-12');
  const x = romulanPatrolLost(env);
  run(env.book, env.world, 3, x.checkInDue + x.grace + 1);
  const [inc] = incidentsOf(env.db, 'romulan');
  const k = env.db.knowledge['command:romulan'][inc.id];
  k.claims.lastKnown = { ...k.claims.lastKnown, position: { x: 1200, y: -300 } }; // even with coordinates
  const { facts, trace } = DC.deriveFacts(doctrine, env.book, env.world, env.db, 'command:romulan', inc.id, env.book.settled);
  assert.equal(facts.live_weapon_track, undefined); assert.equal(facts.contact_detected, undefined);
  assert.match(trace.live_weapon_track, /history/);
  const shot = D.fireDecision(doctrine, { profileId: 'romulan', role: 'patrol', facts: { ...facts, war_target_verified: true, war_order_active: true, engagement_objective_active: true, weapon_usable: true, weapon_ready: true, inside_equipped_range: true, target_actionable: true } });
  assert.equal(shot.allowed, false); assert.ok(shot.failed.includes('live_weapon_track'));
  assert.deepEqual(D.eventErrors(doctrine, DC.overdueEventFor(env.db, 'command:romulan', inc.id)), []);
});
// 13, 14, 15 --------------------------------------------------------------------------------------
test('13/14/15. a secret Dominion pact is known to its signatory commands only; an ordinary Cardassian merchant neither knows nor conceals; a briefed and tasked covert actor may propose concealment (shadow)', () => {
  const env = mk('DR-13', { relations: { 'cardassian:dominion': 'peace' } });
  const { world, book, db } = env;
  const pact = C.activatePact(book, world, 'dominion', 'cardassian', 1, [], 'authored');
  assert.ok(pact.ok, pact.reason);
  const key = pact.record.key;
  const [merchant, covert] = ready(book, 'cardassian', IDX.Cardassia);
  merchant.shipId = 91;
  DC.designate(book, 'cardassian', merchant.id, 'civilian');
  DC.designate(book, 'cardassian', covert.id, 'covert');
  // An incident whose recovered evidence names a Dominion wreck, known to all four observers.
  const x = romulanPatrolLost(env);
  const dh = P(book, 'dominion').hulls.find((h) => h.status === 'ready');
  dh.systemIndex = IDX.Aldnas;
  const dx = DC.issueAssignment(book, world, { polity: 'dominion', hullId: dh.id, kind: 'patrol', doctrineRole: 'patrol', stops: [{ systemIndex: IDX.Aldnas, dwell: 20 }] }, 2, []);
  lose(book, world, dx.assignment.id, 2);
  run(book, world, 3, x.checkInDue + x.grace + 1);
  const [inc] = incidentsOf(db, 'romulan');
  run(book, world, book.settled + 1, book.settled + 4); // the Romulan investigator examines the site
  assert.ok(Object.values(db.knowledge['command:romulan'][inc.id].evidence).some((e) => e.wrecks.some((w) => w.factionId === 'dominion')), 'no Dominion wreck identified');
  for (const to of [`hull:${merchant.id}`, `hull:${covert.id}`, 'command:cardassian', 'command:klingon']) DC.relayReport(book, world, inc.id, 'command:romulan', to, book.settled);
  DC.briefActor(book, `hull:${covert.id}`, key, book.settled);
  DC.assignPactTask(book, `hull:${covert.id}`, key, 'prevent exposure of the Aldnas site', book.settled);
  run(book, world, book.settled + 1, book.settled + 1);
  const f = (obs) => DC.deriveFacts(doctrine, book, world, db, obs, inc.id, book.settled).facts;
  assert.equal(f('command:klingon').pact_briefing_received, undefined, 'Klingon command knows a pact it was never told of');
  assert.equal(f(`hull:${merchant.id}`).pact_briefing_received, undefined, 'faction membership conferred the pact');
  assert.equal(f('command:cardassian').pact_briefing_received, true, 'the signatory command does not know its own pact');
  assert.equal(evalOf(db, `hull:${merchant.id}`, inc.id).proposal, 'record_only');
  assert.equal(evalOf(db, 'command:cardassian', inc.id).proposal, 'record_only', 'briefing without a task concealed');
  const cov = evalOf(db, `hull:${covert.id}`, inc.id);
  assert.equal(cov.matchedRule, 'conceal_pact', JSON.stringify(cov));
  assert.ok(['conceal', 'defer:conceal'].includes(cov.proposal), cov.proposal);
  assert.equal(cov.live, false);
  assert.ok(!db.objectives.some((o) => o.polity === 'cardassian'), 'concealment acted');
  assert.equal(book.treaties[key].knownTo.length, 0, 'the doctrine leaked the pact into its public knowledge');
  log.pact = { merchant: evalOf(db, `hull:${merchant.id}`, inc.id), command: evalOf(db, 'command:cardassian', inc.id), covert: cov };
});
// 16 -----------------------------------------------------------------------------------------------
test('16. Gorn stays dormant: no routine generation even when configured, and no reaction', () => {
  const env = mk('DR-16', { gorn: true, patrols: { gorn: 1 } });
  C.ensurePolity(env.book, 'gorn').hulls.push({ id: 'gorn-h1', shipId: 99, hull: 800, maxHull: 800, crew: 1, systemIndex: 12, status: 'ready', opId: null });
  env.world.routes.push([12, 11]);
  run(env.book, env.world, 2, 40);
  assert.equal(env.db.assignments.filter((a) => a.polity === 'gorn').length, 0);
  for (const g of ['traffic', 'patrol', 'raid', 'reinforcement', 'occupation']) assert.equal(D.generatorAllowed(doctrine, 'gorn', g, { rosterEnabled: true, assignmentExists: true, budgetExists: true }), false);
  assert.equal(D.react(doctrine, { profileId: 'gorn', role: 'commander', eventType: 'asset_overdue', facts: { event_known: true, own_asset_affected: true } }).result, 'inactive');
});
// 17, 18 -------------------------------------------------------------------------------------------
test('17/18. a Dominion hull without Central authority resolves to the Remnant; Central needs authority, activation and a received order together', () => {
  const env = mk('DR-17');
  const { book, db } = env;
  C.ensurePolity(book, 'dominion_remnant');
  const prof = (p) => D.resolveProfile(doctrine, DC.dominionContext(book, p, db)).profileId;
  assert.equal(prof('dominion_remnant'), 'dominion_remnant');
  book.dominion.phase = 'staging';
  assert.equal(prof('dominion_remnant'), 'dominion_remnant', 'scenario activation alone made it Central');
  book.commandBindings = { dominion_remnant: { to: 'dominion', day: 1 } };
  assert.equal(prof('dominion_remnant'), 'dominion_remnant', 'binding without an order made it Central');
  DC.issueCentralOrder(book, 'dominion_remnant', 'dominion', 2);
  assert.equal(prof('dominion_remnant'), 'dominion_central');
  book.dominion.phase = 'dormant';
  assert.equal(prof('dominion_remnant'), 'dominion_remnant', 'Central without activation');
  book.commandBindings = {};
  book.dominion.phase = 'staging';
  assert.equal(prof('dominion_remnant'), 'dominion_remnant', 'Central without authority');
  // Hull origin never decides: a Dominion-built hull in Romulan service is Romulan.
  const h = ready(book, 'romulan')[0]; h.shipId = 50;
  assert.equal(DC.observerDoctrine(doctrine, book, db, `hull:${h.id}`).profileId, 'romulan');
  for (const combo of [[false, true, true], [true, false, true], [true, true, false]]) assert.equal(D.resolveProfile(doctrine, { runtimeFaction: 'dominion', centralAuthority: combo[0], scenarioActivated: combo[1], ordersReceived: combo[2] }).profileId, 'dominion_remnant');
});
// 19, 20 -------------------------------------------------------------------------------------------
test('19/20. doctrine never authorises a shot outside the equipped range or without a live track, whatever the war authority', () => {
  const authority = { war_target_verified: true, war_order_active: true, engagement_objective_active: true };
  const physical = { live_weapon_track: true, weapon_usable: true, weapon_ready: true, inside_equipped_range: true, target_actionable: true };
  assert.equal(D.fireDecision(doctrine, { profileId: 'klingon', role: 'raider', facts: { ...authority, ...physical } }).allowed, true);
  const out = D.fireDecision(doctrine, { profileId: 'klingon', role: 'raider', facts: { ...authority, ...physical, inside_equipped_range: false } });
  assert.equal(out.allowed, false); assert.deepEqual(out.failed, ['inside_equipped_range']);
  const blind = D.fireDecision(doctrine, { profileId: 'klingon', role: 'raider', facts: { ...authority, ...physical, live_weapon_track: false } });
  assert.equal(blind.allowed, false); assert.deepEqual(blind.failed, ['live_weapon_track']);
  // Armed Vulcans keep self-defence and protection of a charge; no war-only attack.
  assert.equal(D.fireDecision(doctrine, { profileId: 'vulcan', role: 'relief', facts: { attack_on_self_verified: true, engagement_objective_active: true, ...physical } }).allowed, true);
  assert.equal(D.fireDecision(doctrine, { profileId: 'vulcan', role: 'defender', facts: { attack_on_protected_verified: true, defense_obligation_active: true, engagement_objective_active: true, ...physical } }).allowed, true);
  assert.equal(D.fireDecision(doctrine, { profileId: 'vulcan', role: 'patrol', facts: { ...authority, ...physical } }).allowed, false);
});
// 21 -----------------------------------------------------------------------------------------------
test('21. closing an objective stops action under it: no more movement or work, the vessel goes home under a separate order, and no new objective recycles it', () => {
  const env = mk('DR-21');
  const { world, book, db } = env;
  const x = romulanPatrolLost(env);
  run(book, world, 3, x.checkInDue + x.grace + 1);
  const o = db.objectives[0];
  assert.ok(o);
  run(book, world, book.settled + 1, o.deadline.value + 2);
  assert.notEqual(o.status, 'active');
  const asg = db.assignments.find((a) => a.id === o.assignmentId);
  assert.notEqual(asg.status, 'active', 'the objective\'s assignment kept running');
  const h = P(book, 'romulan').hulls.find((y) => y.id === o.assigned.hullId);
  assert.notEqual(h.opId, o.assignmentId);
  const moves = []; run(book, world, book.settled + 1, book.settled + 15, (e) => { if (e.objectiveId === o.id) moves.push(e); });
  assert.equal(moves.length, 0, `movement under a closed objective: ${JSON.stringify(moves[0])}`);
  assert.equal(db.objectives.filter((y) => y.incidentId === o.incidentId && y.actor === o.actor).length, 1, 'the closed objective was recycled');
  assert.ok(db.incidents[o.incidentId], 'the incident was deleted with its objective');
  log.closed = o;
});
// 22 -----------------------------------------------------------------------------------------------
test('22. save/load mid-incident preserves incident, knowledge and objective state, and the continuation is identical', () => {
  const env = mk('DR-22');
  const { world, book, db } = env;
  const x = romulanPatrolLost(env, { mode: 'disabled' });
  run(book, world, 3, x.checkInDue + x.grace + 2);
  C.upgradeCampaignBook(book);
  const saved = JSON.parse(JSON.stringify(book));
  const a = C.checksum(book);
  run(book, world, book.settled + 1, book.settled + 10);
  const loaded = C.upgradeCampaignBook(JSON.parse(JSON.stringify(saved)));
  assert.equal(C.checksum(loaded), a);
  run(loaded, world, loaded.settled + 1, loaded.settled + 10);
  assert.equal(C.checksum(loaded), C.checksum(book), 'the reloaded campaign diverged');
  assert.deepEqual(Object.keys(loaded.doctrine.incidents), Object.keys(book.doctrine.incidents));
  assert.deepEqual(loaded.doctrine.objectives.map((o) => [o.id, o.status]), book.doctrine.objectives.map((o) => [o.id, o.status]));
});
// 23 -----------------------------------------------------------------------------------------------
test('23. an ordinary completed patrol never manufactures an incident; nothing but a missed milestone does', () => {
  const env = mk('DR-23', { patrols: { romulan: 1 }, explorers: { delpin: 1 } });
  run(env.book, env.world, 2, 120);
  const done = env.db.assignments.filter((a) => a.status === 'completed');
  assert.ok(done.length >= 3, `only ${done.length} routine assignments completed`);
  assert.equal(Object.keys(env.db.incidents).length, 0, JSON.stringify(Object.values(env.db.incidents)[0]));
  assert.equal(env.db.objectives.length, 0);
});
// 24 -----------------------------------------------------------------------------------------------
test('24. a deferred response is reevaluated and acts once capacity exists', () => {
  const env = mk('DR-24');
  const { world, book, db } = env;
  const x = romulanPatrolLost(env);
  const held = [];
  for (const h of P(book, 'romulan').hulls) if (h.status === 'ready' && !h.opId) { h.status = 'assigned'; h.opId = 'elsewhere'; held.push(h); }
  run(book, world, 3, x.checkInDue + x.grace + 3);
  const [inc] = incidentsOf(db, 'romulan');
  assert.equal(evalOf(db, 'command:romulan', inc.id).proposal, 'defer:investigate');
  for (const h of held) { h.status = 'ready'; h.opId = null; }
  run(book, world, book.settled + 1, book.settled + 1);
  const e = evalOf(db, 'command:romulan', inc.id);
  assert.equal(e.proposal, 'investigate');
  assert.ok(db.objectives.some((o) => o.incidentId === inc.id));
  const trail = db.shadow.filter((s) => s.actor === 'command:romulan' && s.incident === inc.id).map((s) => s.proposal);
  assert.deepEqual([...new Set(trail)], ['defer:investigate', 'investigate']);
});
// 25 -----------------------------------------------------------------------------------------------
test('25. an assigned doctrine vessel keeps its persistent vid through assignment, travel, objective and return', () => {
  const env = mk('DR-25');
  const x = romulanPatrolLost(env);
  run(env.book, env.world, 3, x.checkInDue + x.grace + 1);
  const o = env.db.objectives[0];
  const h = P(env.book, 'romulan').hulls.find((y) => y.id === o.assigned.hullId);
  const vid = h.identity.vid;
  assert.equal(o.assigned.vid, vid);
  run(env.book, env.world, env.book.settled + 1, env.book.settled + 20);
  const after = P(env.book, 'romulan').hulls.filter((y) => y.identity?.vid === vid);
  assert.equal(after.length, 1, 'the vessel was duplicated or replaced');
  assert.equal(after[0].id, h.id);
  assert.ok(env.db.assignments.filter((a) => a.hullId === h.id).every((a) => a.vid === vid));
});
// 26 -----------------------------------------------------------------------------------------------
test('26. doctrine movement through a blockade uses the shared interception engine', () => {
  const env = mk('DR-26');
  const { world, book, db } = env;
  // Romulan–Klingon war; a heavy Klingon blockade of Chaltok-in-the-fixture: route Delpi→Aldnas→Romulus.
  const w2 = mk('DR-26', { relations: { 'klingon:romulan': 'war' } });
  const kl = ready(w2.book, 'klingon').slice(0, 10);
  for (const h of kl) h.systemIndex = IDX.Romulus;
  const b = C.startBlockade(w2.book, w2.world, { power: 'klingon', target: IDX.Romulus, hullIds: kl.map((h) => h.id), purpose: 'isolate_world' }, 1, []);
  assert.ok(b.ok, b.reason);
  const x = romulanPatrolLost(w2);
  run(w2.book, w2.world, 3, x.checkInDue + x.grace + 1);
  // The investigator sets out from Romulus into Aldnas (no blockade there); send another Romulan ship
  // INTO the blockaded Romulus from Aldnas under a doctrine order.
  const h = ready(w2.book, 'romulan', IDX.Romulus)[0] || P(w2.book, 'romulan').hulls.find((y) => y.status === 'ready');
  h.systemIndex = IDX.Aldnas;
  const r = DC.issueAssignment(w2.book, w2.world, { polity: 'romulan', hullId: h.id, kind: 'return', doctrineRole: 'patrol', stops: [{ systemIndex: IDX.Romulus }] }, w2.book.settled, []);
  const before = w2.book.stats.interceptions || 0;
  const fx = run(w2.book, w2.world, w2.book.settled + 1, w2.book.settled + 1);
  const runs = fx.filter((f) => f.type === 'blockadeRun' && f.doctrineAssignmentId === r.assignment.id);
  assert.equal(runs.length, 1, 'no run through the shared engine');
  assert.equal(runs[0].kind, 'doctrine'); assert.equal(runs[0].sponsor, 'romulan');
  assert.equal(w2.book.stats.interceptions, before + 1);
  assert.equal(runs[0].hulls[0].vid, h.identity.vid);
  assert.ok(w2.book.blockades[0].runs.some((y) => y.by.startsWith(r.assignment.id)));
  log.blockadeRun = runs[0];
});
// 27 -----------------------------------------------------------------------------------------------
test('27. doctrine cannot order a war attack once a ceasefire has removed the authority; static hostility is not a formal war', () => {
  const env = mk('DR-27');
  const { world, book, db, relations } = env;
  const x = romulanPatrolLost(env);
  run(book, world, 3, x.checkInDue + x.grace + 1);
  const [inc] = incidentsOf(db, 'romulan');
  DC.relayReport(book, world, inc.id, 'command:romulan', 'command:terran', book.settled);
  const before = DC.deriveFacts(doctrine, book, world, db, 'command:terran', inc.id, book.settled, { warTarget: IDX.Border }).facts;
  assert.equal(before.war_order_active, true, 'no war authority during the war');
  const shoot = (facts) => D.fireDecision(doctrine, { profileId: 'terran', role: 'raider', facts: { ...facts, war_target_verified: true, engagement_objective_active: true, live_weapon_track: true, weapon_usable: true, weapon_ready: true, inside_equipped_range: true, target_actionable: true } }).allowed;
  assert.equal(shoot({ war_order_active: before.war_order_active }), true);
  C.forceWarTransition(book, world, 'terran', 'klingon', 'ceasefire', book.settled, 'test ceasefire');
  relations['terran:klingon'] = 'ceasefire';
  const after = DC.deriveFacts(doctrine, book, world, db, 'command:terran', inc.id, book.settled, { warTarget: IDX.Border }).facts;
  assert.equal(after.war_order_active, undefined, 'a ceasefire left the war order standing');
  assert.equal(shoot({ war_order_active: after.war_order_active === true }), false);
  // Romulans and Klingons have no formal war here: no authority, whatever their attitudes.
  assert.equal(DC.deriveFacts(doctrine, book, world, db, 'command:romulan', inc.id, book.settled, { warTarget: IDX.Border }).facts.war_order_active, undefined);
});
// 28-32: independent review findings -----------------------------------------------------------
test('28. a ship lost before its first milestone misses both: one incident (the later miss is added to it), one search', () => {
  const env = mk('DR-28');
  const { world, book, db } = env;
  const h = ready(book, 'romulan', IDX.Romulus)[0];
  const r = DC.issuePatrol(book, world, 'romulan', h.id, IDX.Aldnas, 1, []);
  lose(book, world, r.assignment.id, 1); // lost at Romulus, before arriving anywhere
  run(book, world, 2, 30);
  const incs = incidentsOf(db, 'romulan');
  assert.equal(incs.length, 1, incs.map((i) => i.id).join(', '));
  assert.equal(incs[0].alsoMissed?.length, 1);
  assert.equal(db.objectives.filter((o) => o.actor === 'command:romulan').length, 1, 'a second search for the same ship');
});
test('29. the owner settling an incident does not settle it for an observer who has not heard: that observer is still evaluated and keeps its record', () => {
  const env = mk('DR-29');
  const { world, book, db } = env;
  const x = romulanPatrolLost(env);
  run(book, world, 3, x.checkInDue + x.grace + 1);
  const [inc] = incidentsOf(db, 'romulan');
  DC.relayReport(book, world, inc.id, 'command:romulan', 'command:delpin', book.settled);
  run(book, world, book.settled + 1, book.settled + 6);
  assert.equal(inc.status, 'resolved', 'the owner never located its ship');
  assert.equal(db.knowledge['command:delpin'][inc.id].resolution, null, 'the owner\'s resolution reached Delpin untold');
  const d0 = evalOf(db, 'command:delpin', inc.id).day;
  run(book, world, book.settled + 1, book.settled + 5);
  assert.equal(evalOf(db, 'command:delpin', inc.id).day, book.settled, `Delpin stopped being evaluated on day ${d0}`);
});
test('30. a disabled hulk that is repaired and leaves takes its crew with it: no phantom survivors to rescue, and it does not run the same blockade twice', () => {
  const env = mk('DR-30', { reliefShips: { vulcan: 1 } });
  const { world, book, db } = env;
  const x = romulanPatrolLost(env, { mode: 'disabled' });
  run(book, world, 3, 4);
  const site = Object.values(db.ground.evidence)[0];
  assert.ok(site.survivors && !site.survivors.rescued);
  const h = P(book, 'romulan').hulls.find((y) => y.id === x.hull.id);
  h.hull = h.maxHull; h.status = 'ready'; h.systemIndex = IDX.Romulus; delete h.stranded; // recovered and repaired by a real recovery (phase 3: never by days alone)
  run(book, world, 5, 5);
  assert.ok(site.survivors.untilDay < 5, 'survivors still waiting at an empty site');
  assert.equal(site.wrecks.filter((w) => w.vid === x.hull.identity.vid).length, 0, 'the departed hulk is still a wreck');
});
test('31. switching doctrine off releases every hull on a doctrine job; nothing stays parked', () => {
  const env = mk('DR-31', { patrols: { romulan: 1 }, explorers: { delpin: 1 } });
  run(env.book, env.world, 2, 12);
  assert.ok(env.db.assignments.some((a) => a.status === 'active'));
  env.db.config = { ...env.db.config, enabled: false };
  run(env.book, env.world, 13, 13);
  // STRATEGIC-MOVEMENT-UNIFICATION: a ship in warp cannot stop there; it is released at the end of the leg
  // it is flying (a day here), and nothing is left parked after that.
  const inWarp = Object.values(env.book.polities).flatMap((p) => p.hulls).filter((h) => String(h.opId || '').includes('doctrine-'));
  assert.ok(inWarp.every((h) => h.transit), 'a doctrine hull held although not in warp');
  run(env.book, env.world, 14, 16);
  const parked = Object.values(env.book.polities).flatMap((p) => p.hulls).filter((h) => String(h.opId || '').includes('doctrine-'));
  assert.equal(parked.length, 0, parked.map((h) => h.id).join(','));
  // And a book without any doctrine runtime releases them too.
  const env2 = mk('DR-31b', { patrols: { romulan: 1 } });
  run(env2.book, env2.world, 2, 12);
  delete env2.world.doctrineStep;
  env2.world.doctrineStep = (b, w, d, fx) => DC.advanceDoctrineDay(b, w, d, fx, null);
  run(env2.book, env2.world, 13, 16);
  assert.equal(Object.values(env2.book.polities).flatMap((p) => p.hulls).filter((h) => String(h.opId || '').includes('doctrine-')).length, 0);
});
test('32. saved doctrine state stays bounded over a long campaign with incidents', () => {
  const env = mk('DR-32', { patrols: { romulan: 1 }, explorers: { delpin: 1 }, reliefShips: { vulcan: 1 } });
  const { world, book, db } = env;
  for (let d = 2; d <= 400; d++) {
    run(book, world, d, d);
    if (d % 25 === 0) { const a = db.assignments.find((y) => y.status === 'active' && y.kind === 'patrol'); if (a) lose(book, world, a.id, d); }
  }
  const size = JSON.stringify(book.doctrine).length;
  log.boundedSize = { size, incidents: Object.keys(db.incidents).length, assignments: db.assignments.length, shadow: db.shadow.length, evidence: Object.keys(db.ground.evidence).length };
  assert.ok(Object.keys(db.incidents).length <= db.config.incidentHistoryLimit + 4, JSON.stringify(log.boundedSize));
  assert.ok(size < 200000, JSON.stringify(log.boundedSize));
});
test('33. a ship that came back and is then lost again is a new disappearance: a new incident, with its own wreck', () => {
  const env = mk('DR-33');
  const { world, book, db } = env;
  const h = ready(book, 'romulan', IDX.Romulus)[0];
  const r = DC.issueAssignment(book, world, { polity: 'romulan', hullId: h.id, kind: 'patrol', doctrineRole: 'patrol', stops: [{ systemIndex: IDX.Aldnas, dwell: 0, milestone: 'arrival' }, { systemIndex: IDX.Delpi, dwell: 0, milestone: 'arrival' }, { systemIndex: IDX.Romulus, milestone: 'check_in' }] }, 1, []);
  run(book, world, 2, 2); // at Aldnas
  lose(book, world, r.assignment.id, 2, 'disabled');
  run(book, world, 3, 8);
  const first = incidentsOf(db, 'romulan');
  assert.equal(first.length, 1, 'no incident for the missed Delpi arrival');
  const hh = P(book, 'romulan').hulls.find((y) => y.id === h.id);
  hh.hull = hh.maxHull; hh.status = 'assigned'; // repaired where it lies
  run(book, world, 9, 10); // sets out on day 9, flies the one-day leg, reaches Delpi late and reports in
  assert.equal(first[0].resolution?.status, 'asset_returned', JSON.stringify(first[0]));
  assert.equal(r.assignment.milestones.at(-1).status, 'pending', 'the check-in was not re-expected');
  lose(book, world, r.assignment.id, book.settled, 'destroyed'); // lost on the way home
  run(book, world, book.settled + 1, book.settled + 8);
  const all = incidentsOf(db, 'romulan');
  assert.equal(all.length, 2, 'the second loss joined the settled incident');
  assert.ok(Object.values(db.ground.evidence).some((e) => e.wrecks.some((w) => w.vid === r.assignment.vid && w.condition === 'destroyed')), 'the second loss left no wreck');
  // The search for the second loss goes where the ship was last heard from (Delpi), not to the empty old site.
  run(book, world, book.settled + 1, book.settled + 12);
  const second = all[1];
  const o = db.objectives.find((y) => y.incidentId === second.id);
  assert.ok(o, 'no search for the second loss');
  assert.equal(o.target.locationId, 'system:delpi', JSON.stringify(o.target));
  assert.ok(!db.objectives.some((y) => y.status === 'completed' && y.found?.evidenceRecovered && !(y.found.wrecks || []).length), 'an empty site counted as recovered evidence');
});
// E2E ----------------------------------------------------------------------------------------------
test('E2E (model). the whole incident: only the owner knows; reports reach chosen observers; each reacts by its own interest; no duplicate missions; no attribution', () => {
  const env = mk('DR-E2E', { reliefShips: { vulcan: 1 } });
  const { world, book, db } = env;
  const x = romulanPatrolLost(env, { mode: 'disabled' });
  const kh = ready(book, 'klingon', IDX.Border)[0];
  const kr = DC.issuePatrol(book, world, 'klingon', kh.id, IDX.Aldnas, 2, []);
  run(book, world, 3, 3);
  lose(book, world, kr.assignment.id, 3);
  const dh = ready(book, 'delpin', IDX.Delpi)[0];
  DC.issueAssignment(book, world, { polity: 'delpin', hullId: dh.id, kind: 'exploration', doctrineRole: 'explorer', stops: [{ systemIndex: IDX.Aldnas, dwell: 10, milestone: 'arrival' }, { systemIndex: IDX.Delpi, milestone: 'check_in' }] }, 3, []);
  run(book, world, 4, x.checkInDue + x.grace + 1);
  const inc = incidentsOf(db, 'romulan')[0];
  const relief = Object.keys(db.designations.vulcan)[0];
  const obs = ['command:klingon', `hull:${dh.id}`, `hull:${relief}`, 'command:delpin', 'command:vulcan'];
  for (const o of obs) assert.equal(evalOf(db, o, inc.id).proposal, 'ignore_unknown', o);
  assert.ok(db.objectives.some((o) => o.actor === 'command:romulan'), 'Romulan command did not assign an investigator');
  for (const o of ['command:klingon', `hull:${dh.id}`, `hull:${relief}`]) DC.relayReport(book, world, inc.id, 'command:romulan', o, book.settled);
  run(book, world, book.settled + 1, book.settled + 3);
  assert.equal(evalOf(db, 'command:klingon', inc.id).proposal, 'record_only');
  assert.ok(db.objectives.some((o) => o.actor === `hull:${dh.id}` && o.response === 'investigate'), 'Delpin did not investigate');
  DC.relayReport(book, world, inc.id, `hull:${dh.id}`, 'command:klingon', book.settled);
  const [dist] = distressOf(db);
  assert.ok(dist, 'the explorer found no survivors');
  DC.relayReport(book, world, dist.id, `hull:${dh.id}`, `hull:${relief}`, book.settled, { include: 'survivor_report' });
  run(book, world, book.settled + 1, book.settled + 8);
  assert.ok(evalOf(db, 'command:klingon', inc.id).knownFacts.includes('linked_own_losses'));
  assert.ok(db.objectives.some((o) => o.actor === `hull:${relief}` && o.response === 'rescue' && o.status === 'completed'), JSON.stringify(evalOf(db, `hull:${relief}`, dist.id)));
  const keys = db.objectives.map((o) => `${o.incidentId}|${o.actor}|${o.response}`);
  assert.equal(new Set(keys).size, keys.length, 'duplicate missions');
  assert.ok(Object.values(db.knowledge).every((s) => Object.values(s).every((k) => k.attribution === null)), 'an attribution appeared');
  log.e2eShadow = db.shadow;
});

if (out) {
  fs.mkdirSync(out, { recursive: true });
  fs.writeFileSync(path.join(out, 'doctrine-runtime-pure-log.json'), JSON.stringify(log, null, 1));
}
console.log(`\ndoctrine runtime pure: ${passed} passed${failures.length ? `, ${failures.length} FAILED: ${failures.join(' | ')}` : ''}`);
if (failures.length) process.exit(1);
