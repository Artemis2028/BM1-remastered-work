// Pure tests for faction doctrine runtime phase 2 (docs/doctrine/DOCTRINE-RUNTIME-PHASE2.md): persistent
// distress, commercial and escort incidents, and report propagation. The doctrine package is loaded from
// docs/doctrine/ exactly as the game loads it. The galaxy is the shared synthetic one plus Phase 1's
// Delpi, Vulcan and Aldnas, and Ferengi and Tholian space:
//
//   Romulus(4) ─ Aldnas(11) ─ Delpi(9) ─ Vulcan(10) ─ Vega(1)          Tholia(14) ─ Veil(15) ─ Deep(16) ─ Vulcan(10)
//                  │   │                  │
//             Border(2) Ferenginar(12) ─ Ganalda(13) ─ Rigel(17) ─ Delpi(9)        Far Reach(18): no routes (yet)
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
const doctrine = D.loadDoctrine(read('docs/doctrine/bm1-faction-doctrine.v0.2.1.json'), read('docs/doctrine/bm1-faction-doctrine.schema.json'));
const out = process.env.BM1_TEST_OUTPUT || null;

let passed = 0;
const failures = [];
const log = {};
const test = (name, fn) => {
  try { fn(); passed++; console.log('PASS', name); }
  catch (e) { failures.push(name); console.log('FAIL', name, '\n      ', String(e?.stack || e).split('\n').slice(0, 12).join('\n       ')); }
};

Object.assign(HULLS, {
  70: { price: 30000, mass: 5, combatHull: 500, faction: 'ferengi', speed: 40, combat: 0, cargo: 500 },
  80: { price: 50000, mass: 3, combatHull: 420, faction: 'delpin', speed: 70, combat: 0.4, cargo: 40 },
  90: { price: 80000, mass: 4, combatHull: 700, faction: 'vulcan', speed: 50, combat: 1, cargo: 200 },
  91: { price: 30000, mass: 5, combatHull: 500, faction: 'cardassian', speed: 25, combat: 0, cargo: 900 },
  95: { price: 90000, mass: 6, combatHull: 900, faction: 'tholian', speed: 45, combat: 1 },
  96: { price: 30000, mass: 6, combatHull: 600, faction: 'tholian', speed: 30, combat: 0, cargo: 800 },
});
POOLS.delpin = [80]; POOLS.vulcan = [90]; POOLS.ferengi = [70]; POOLS.tholian = [95];
const IDX = { Earth: 0, Vega: 1, Border: 2, Qonos: 3, Romulus: 4, Cardassia: 5, Delpi: 9, Vulcan: 10, Aldnas: 11, Ferenginar: 12, Ganalda: 13, Tholia: 14, Veil: 15, Deep: 16, Rigel: 17, FarReach: 18 };
function mk(seed, opts = {}) {
  const { world, relations } = makeWorld(opts);
  world.systems.push(
    { index: 9, name: 'Delpi', controller: 'delpin', origin: 'delpin', population: 3000 },
    { index: 10, name: 'Vulcan', controller: 'vulcan', origin: 'vulcan', population: 6000 },
    { index: 11, name: 'Aldnas', controller: null, origin: null, population: 0 },
    { index: 12, name: 'Ferenginar', controller: 'ferengi', origin: 'ferengi', population: 4000 },
    { index: 13, name: 'Ganalda', controller: null, origin: null, population: 0 },
    { index: 14, name: 'Tholia', controller: 'tholian', origin: 'tholian', population: 5000 },
    { index: 15, name: 'Veil', controller: 'tholian', origin: 'tholian', population: 800 },
    { index: 16, name: 'Deep', controller: 'tholian', origin: 'tholian', population: 800 },
    { index: 17, name: 'Rigel', controller: null, origin: null, population: 0 },
    { index: 18, name: 'Far Reach', controller: null, origin: null, population: 0 },
  );
  world.routes.push([4, 11], [11, 9], [9, 10], [10, 1], [11, 2], [12, 11], [12, 13], [13, 17], [17, 9], [14, 15], [15, 16], [16, 10]);
  const book = C.createCampaignBook(seed, 1);
  C.initializeCampaign(book, world);
  book.config.aiStrategicOps = false;
  book.config.planningIntervalDays = 1e9;
  world.doctrineStep = (b, w, d, fx) => DC.advanceDoctrineDay(b, w, d, fx, doctrine);
  const db = DC.doctrineBook(book);
  db.config = { ...db.config, patrols: opts.patrols || {}, explorers: opts.explorers || {}, reliefShips: opts.reliefShips || {}, merchants: opts.merchants || {}, projects: opts.projects || {}, patrolAreas: opts.patrolAreas || {} };
  return { world, book, db, relations };
}
const P = (book, id) => C.getPolity(book, id);
const ready = (book, id, at = null) => P(book, id).hulls.filter((h) => h.status === 'ready' && !h.opId && (at == null || h.systemIndex === at)).sort((a, b) => String(a.id).localeCompare(String(b.id)));
const hullById = (book, polity, id) => P(book, polity).hulls.find((h) => h.id === id);
const evalOf = (db, obs, inc) => db.lastEval[`${obs}|${inc}`];
const incidents = (db, pred = () => true) => Object.values(db.incidents).filter(pred);
const overdueOf = (db, polity) => incidents(db, (i) => i.eventType === 'asset_overdue' && i.polity === polity);
const distress = (db) => incidents(db, (i) => i.eventType === 'distress');
const hullCount = (book) => Object.values(book.polities).reduce((n, p) => n + p.hulls.filter((h) => h.status !== 'lost').length, 0) - (book.stats.hullsBuilt || 0);
const K = (db, obs, inc) => db.knowledge[obs]?.[inc] || null;
const relay = (env, inc, from, to, opts = {}) => DC.relayReport(env.book, env.world, inc, from, to, env.book.settled, opts);
const step = (env, n = 1, onEffect) => run(env.book, env.world, env.book.settled + 1, env.book.settled + n, onEffect);
// Roundtrip through JSON exactly as a save and a load do.
const reload = (book) => C.upgradeCampaignBook(JSON.parse(JSON.stringify(book)));

// A Romulan patrol Romulus → Aldnas → Romulus, lost once on station at Aldnas.
function romulanPatrolLost(env, { mode = 'destroyed', silent = true, from = 1, pods = undefined } = {}) {
  const { world, book } = env;
  const h = ready(book, 'romulan', IDX.Romulus)[0];
  const r = DC.issuePatrol(book, world, 'romulan', h.id, IDX.Aldnas, from, []);
  assert.ok(r.ok, r.reason);
  run(book, world, from + 1, from + 1);
  assert.ok(DC.loseAssignmentHullUnwitnessed(book, world, r.assignment.id, from + 1, mode, { silent, ...(pods == null ? {} : { pods }) }).ok);
  return { hull: h, assignment: r.assignment, detectDay: r.assignment.milestones.at(-1).dueDay + r.assignment.milestones.at(-1).grace + 1 };
}
// A Delpin refugee transport Delpi → Aldnas → Romulus, disabled at Aldnas with its crew and passengers
// aboard. Unless silent, it calls for help from where it lies.
function transportDisabled(env, { silent = false, from = 1 } = {}) {
  const { world, book } = env;
  const h = ready(book, 'delpin', IDX.Delpi)[0];
  const r = DC.issueAssignment(book, world, { polity: 'delpin', hullId: h.id, kind: 'transport', doctrineRole: 'civilian', stops: [{ systemIndex: IDX.Romulus, dwell: 1, milestone: 'arrival' }, { systemIndex: IDX.Delpi, milestone: 'check_in' }] }, from, []);
  assert.ok(r.ok, r.reason);
  run(book, world, from + 1, from + 1); // at Aldnas
  assert.equal(hullById(book, 'delpin', h.id).systemIndex, IDX.Aldnas);
  assert.ok(DC.loseAssignmentHullUnwitnessed(book, world, r.assignment.id, from + 1, 'disabled', { silent }).ok);
  // The next day the call goes out; the day after, it has reached the commands a jump away.
  run(book, world, from + 2, from + 3);
  return { hull: h, assignment: r.assignment };
}
const reliefOf = (db) => Object.keys(db.designations.vulcan || {})[0];

// ---------------------------------------------------------------------------------------------------
// DISTRESS / RESCUE
// ---------------------------------------------------------------------------------------------------
test('P2-1. a distress call with known survivors reaches an available Vulcan relief ship: live rescue by that ship', () => {
  const env = mk('P2-1', { reliefShips: { vulcan: 1 } });
  const { db, book } = env;
  const t = transportDisabled(env);
  const [inc] = distress(db);
  assert.ok(inc, 'no distress incident');
  assert.equal(inc.assetId, t.hull.identity.vid);
  const beacon = K(db, inc.detectedBy, inc.id);
  assert.equal(beacon.claims.asset.role, 'refugee_transport');
  assert.equal(beacon.claims.urgency, 'critical');
  const relief = reliefOf(db);
  assert.equal(K(db, `hull:${relief}`, inc.id), null, 'Vulcan heard a call it is out of range of');
  // The Delpin command heard the call; it passes the survivor report to the Vulcans.
  assert.ok(K(db, 'command:delpin', inc.id)?.survivors, 'the owner never heard its own ship');
  const before = hullCount(book);
  relay(env, inc.id, 'command:delpin', 'command:vulcan', { include: 'survivor_report', channel: 'network' });
  step(env, 2);
  const o = db.objectives.find((x) => x.incidentId === inc.id && x.response === 'rescue');
  assert.ok(o, JSON.stringify(evalOf(db, `hull:${relief}`, inc.id)));
  assert.equal(o.actor, `hull:${relief}`); assert.equal(o.profileId, 'vulcan'); assert.equal(o.role, 'relief');
  assert.equal(o.assigned.hullId, relief);
  assert.equal(o.assigned.vid, hullById(book, 'vulcan', relief).identity.vid);
  assert.equal(hullCount(book), before, 'a vessel was spawned for the rescue');
  step(env, 8);
  assert.equal(o.status, 'completed', JSON.stringify(o.resolution));
  assert.equal(inc.status, 'resolved'); assert.equal(inc.resolution.status, 'survivors_rescued');
  log.rescue = { incident: inc, objective: o };
});
test('P2-2. the same distress without survivor evidence (an overdue notice of it only) gives no rescue', () => {
  const env = mk('P2-2', { reliefShips: { vulcan: 1 } });
  transportDisabled(env);
  const [inc] = distress(env.db);
  const relief = reliefOf(env.db);
  relay(env, inc.id, 'command:delpin', `hull:${relief}`, { include: 'overdue_notice' });
  step(env, 3);
  const e = evalOf(env.db, `hull:${relief}`, inc.id);
  assert.ok(e.knownFacts.includes('event_known'));
  assert.ok(!e.knownFacts.includes('survivors_known'), JSON.stringify(e.knownFacts));
  assert.equal(e.proposal, 'record_only', JSON.stringify(e));
  assert.equal(K(env.db, `hull:${relief}`, inc.id).survivors, null, 'survivors inferred from a notice that carried none');
  assert.ok(!env.db.objectives.some((o) => o.actor === `hull:${relief}`));
});
test('P2-3. survivor evidence arriving later makes the SAME incident reevaluate to rescue; no second incident', () => {
  const env = mk('P2-3', { reliefShips: { vulcan: 1 } });
  const { db } = env;
  transportDisabled(env);
  const [inc] = distress(db);
  const relief = reliefOf(db);
  relay(env, inc.id, 'command:delpin', `hull:${relief}`, { include: 'overdue_notice' });
  step(env, 2);
  assert.equal(evalOf(db, `hull:${relief}`, inc.id).proposal, 'record_only');
  const n = Object.keys(db.incidents).length;
  const m = relay(env, inc.id, 'command:delpin', `hull:${relief}`, { include: 'survivor_report', channel: 'network', kind: 'survivor_report' });
  assert.equal(m.state, 'pending', 'a network report arrived instantly');
  step(env, 3);
  assert.equal(m.state, 'delivered');
  const o = db.objectives.find((x) => x.actor === `hull:${relief}`);
  assert.ok(o && o.incidentId === inc.id, 'the rescue is not on the same incident');
  assert.equal(Object.keys(db.incidents).length, n, 'a duplicate incident appeared');
  const rv = db.reevaluations.find((r) => r.actor === `hull:${relief}` && r.incident === inc.id && r.to === 'live:rescue');
  assert.ok(rv, JSON.stringify(db.reevaluations));
  assert.equal(rv.from, 'record_only');
  assert.match(rv.cause, new RegExp(`report .*${m.id.split(':').pop()}`));
  assert.match(rv.cause, /\+survivors_known/);
  log.reevaluationRescue = rv;
});
test('P2-4. no relief capacity: defer:rescue with the reason; nothing is spawned', () => {
  const env = mk('P2-4', { reliefShips: { vulcan: 1 } });
  const { db, book } = env;
  transportDisabled(env);
  const [inc] = distress(db);
  const relief = reliefOf(db);
  const rh = hullById(book, 'vulcan', relief);
  rh.status = 'assigned'; rh.opId = 'elsewhere';
  const before = hullCount(book);
  relay(env, inc.id, 'command:delpin', `hull:${relief}`, { include: 'survivor_report' });
  step(env, 2);
  const e = evalOf(db, `hull:${relief}`, inc.id);
  assert.equal(e.proposal, 'defer:rescue', JSON.stringify(e));
  assert.match(e.notActing, /^defer:rescue — vessel committed to elsewhere/);
  assert.equal(db.objectives.length, 0);
  assert.equal(hullCount(book), before, 'a vessel appeared');
});

// ---------------------------------------------------------------------------------------------------
// COMMERCIAL: FERENGI
// ---------------------------------------------------------------------------------------------------
// F1 sails for Border through Aldnas and is lost there; its command notices it overdue. F2 is loading
// for Delpi through Aldnas when the notice goes out.
function ferengiSetup(seed) {
  const env = mk(seed);
  const { book, world } = env;
  const [f1, f2] = ready(book, 'ferengi', IDX.Ferenginar);
  const d1 = DC.issueDelivery(book, world, 'ferengi', f1.id, IDX.Border, 1, []);
  assert.ok(d1.ok, d1.reason);
  assert.deepEqual(d1.assignment.itinerary.map((s) => s.systemIndex).slice(0, 3), [IDX.Ferenginar, IDX.Aldnas, IDX.Border]);
  run(book, world, 2, 3); // a day loading, a day's jump: at Aldnas
  assert.equal(hullById(book, 'ferengi', f1.id).systemIndex, IDX.Aldnas);
  DC.loseAssignmentHullUnwitnessed(book, world, d1.assignment.id, 3, 'destroyed', { silent: true });
  const detect = d1.assignment.milestones[0].dueDay + d1.assignment.milestones[0].grace + 1;
  run(book, world, 4, detect - 1);
  const d2 = DC.issueDelivery(book, world, 'ferengi', f2.id, IDX.Delpi, detect, []);
  assert.ok(d2.ok);
  assert.deepEqual(d2.assignment.itinerary.map((s) => s.systemIndex).slice(0, 3), [IDX.Ferenginar, IDX.Aldnas, IDX.Delpi]);
  return { ...env, f1, f2, d1, d2, detect };
}
test('P2-5. a Ferengi freighter whose active contract runs through a missed delivery\'s route reroutes (live), same vessel, same contract', () => {
  const env = ferengiSetup('P2-5');
  const { db, book, world } = env;
  const fx = run(book, world, env.detect, env.detect);
  const [inc] = overdueOf(db, 'ferengi');
  assert.ok(inc, 'no incident for the missing freighter');
  assert.equal(inc.contractId, env.d1.contract.id);
  const e = evalOf(db, `hull:${env.f2.id}`, inc.id);
  assert.ok(e.knownFacts.includes('contract_affected'), JSON.stringify(e.trace?.contract_affected || e));
  assert.equal(e.matchedRule, 'contract_risk'); assert.equal(e.proposal, 'reroute'); assert.equal(e.live, true);
  const o = db.objectives.find((x) => x.actor === `hull:${env.f2.id}`);
  assert.ok(o); assert.equal(o.response, 'reroute'); assert.equal(o.contractId, env.d2.contract.id);
  assert.ok(!o.reroute.newRoute.includes(IDX.Aldnas), JSON.stringify(o.reroute));
  assert.deepEqual(o.reroute.newRoute.slice(0, 4), [IDX.Ferenginar, IDX.Ganalda, IDX.Rigel, IDX.Delpi]);
  assert.equal(env.d2.assignment.hullId, env.f2.id); assert.equal(env.d2.assignment.vid, env.f2.identity.vid);
  assert.ok(fx.some((f) => f.type === 'doctrineVisible' && f.kind === 'reroute'));
  // The contract is delivered the long way round — at Delpi, by the ship actually being there — and the
  // objective closes as complete.
  let deliveredAt = null;
  for (let i = 0; i < 8 && db.contracts[env.d2.contract.id].status === 'active'; i++) { step(env, 1); if (db.contracts[env.d2.contract.id].status === 'completed') deliveredAt = { day: book.settled, at: hullById(book, 'ferengi', env.f2.id).systemIndex }; }
  assert.equal(db.contracts[env.d2.contract.id].status, 'completed', JSON.stringify(db.contracts[env.d2.contract.id]));
  assert.equal(deliveredAt?.at, IDX.Delpi, `delivered away from its destination: ${JSON.stringify(deliveredAt)}`);
  assert.ok(env.d2.assignment.milestones.some((m) => m.kind === 'arrival' && m.status === 'met' && m.systemIndex === IDX.Delpi && m.rerouted != null), 'the arrival met was not the re-expected one');
  assert.ok(env.d2.assignment.milestones.filter((m) => m.status === 'superseded').every((m) => m.metDay == null), 'a superseded milestone was met');
  assert.equal(o.status, 'completed', JSON.stringify(o.resolution));
  assert.ok(!db.objectives.some((x) => x.polity === 'ferengi' && x.response === 'investigate'), 'a Ferengi became an investigator');
  log.ferengiReroute = { evaluation: e, objective: o };
});
test('P2-5b. a freighter that already missed its arrival (held in port, disabled) and is then rerouted delivers only where it is due', () => {
  const env = ferengiSetup('P2-5b');
  const { db, book, world } = env;
  // F2 is disabled in port before it sails; its arrival goes missed while it is repaired.
  const h2 = hullById(book, 'ferengi', env.f2.id);
  h2.hull = Math.max(1, Math.floor(h2.maxHull * 0.05)); h2.status = 'repairing';
  const m0 = env.d2.assignment.milestones[0];
  run(book, world, env.detect, m0.dueDay + m0.grace + 1);
  assert.equal(m0.status, 'missed', 'precondition: the arrival was not missed');
  h2.hull = h2.maxHull; h2.status = 'assigned';
  const [inc] = overdueOf(db, 'ferengi').filter((i) => i.assignmentId === env.d1.assignment.id);
  relay(env, inc.id, 'command:ferengi', `hull:${env.f2.id}`, { kind: 'again' });
  let deliveredAt = null;
  for (let i = 0; i < 10 && db.contracts[env.d2.contract.id].status === 'active'; i++) { step(env, 1); if (db.contracts[env.d2.contract.id].status !== 'active') deliveredAt = h2.systemIndex; }
  const o = db.objectives.find((x) => x.actor === `hull:${env.f2.id}` && x.response === 'reroute');
  assert.ok(o, JSON.stringify(evalOf(db, `hull:${env.f2.id}`, inc.id)));
  assert.ok(o.reroute.newRoute.includes(IDX.Rigel), JSON.stringify(o.reroute));
  assert.equal(db.contracts[env.d2.contract.id].status, 'completed', JSON.stringify(db.contracts[env.d2.contract.id]));
  assert.equal(deliveredAt, IDX.Delpi, `delivered away from its destination: ${deliveredAt} (${JSON.stringify(o?.reroute)})`);
  assert.ok(env.d2.assignment.milestones.filter((m) => m.status === 'superseded').every((m) => m.metDay == null), 'an old expectation was met on the new route');
});
test('P2-9c. a tender disabled as it arrives at the site and repaired there reports in from the site: the load counts, no false overdue, the escort completes', () => {
  const env = tholianSetup('P2-9c');
  const { db, book, world } = env;
  run(book, world, 4, env.detect + 1);
  const o = db.objectives.find((x) => x.response === 'protect');
  assert.ok(o && o.escortState === 'escorting');
  const ca = db.assignments.find((a) => a.id === o.charge.assignmentId);
  const ch = hullById(book, 'tholian', ca.hullId), eh = hullById(book, 'tholian', o.assigned.hullId);
  // As the blockade engine does on a disabling run: arrived at Deep (the drop), disabled there.
  const drop = ca.itinerary.findIndex((st) => st.systemIndex === IDX.Deep);
  ca.pos = drop; ca.dwellLeft = ca.itinerary[drop].dwell; ch.systemIndex = IDX.Deep; eh.systemIndex = IDX.Deep;
  ch.hull = Math.max(1, Math.floor(ch.maxHull * 0.05)); ch.status = 'repairing';
  const n0 = overdueOf(db, 'tholian').length, loads0 = db.contracts[env.project.id].delivered || 0;
  step(env, 1);
  ch.hull = ch.maxHull; // repaired where it lies
  step(env, 2);
  const arr = ca.milestones.find((m) => m.kind === 'arrival' && m.systemIndex === IDX.Deep);
  assert.equal(arr.status, 'met', JSON.stringify(arr));
  assert.equal((db.contracts[env.project.id].delivered || 0), loads0 + 1, 'the load was not counted');
  assert.equal(overdueOf(db, 'tholian').length, n0, 'a false overdue incident');
  assert.equal(o.status, 'completed', JSON.stringify(o.resolution));
  assert.deepEqual(o.resolution.reasons, ['charge_safe']);
});
test('P2-6. an unrelated overdue Romulan patrol: the Ferengi record it and do not investigate', () => {
  const env = mk('P2-6');
  const { db, book, world } = env;
  const x = romulanPatrolLost(env);
  run(book, world, 3, x.detectDay);
  const [inc] = overdueOf(db, 'romulan');
  // A Ferengi freighter on a contract that does not go near Aldnas or Romulus.
  const f = ready(book, 'ferengi', IDX.Ferenginar)[0];
  const d = DC.issueDelivery(book, world, 'ferengi', f.id, IDX.Rigel, book.settled, []);
  assert.ok(d.ok);
  for (const to of ['command:ferengi', `hull:${f.id}`]) relay(env, inc.id, 'command:romulan', to, { include: 'overdue_notice' });
  step(env, 2);
  for (const obs of ['command:ferengi', `hull:${f.id}`]) {
    const e = evalOf(db, obs, inc.id);
    assert.equal(e.proposal, 'record_only', `${obs}: ${JSON.stringify(e)}`);
    assert.ok(!e.knownFacts.includes('contract_affected'));
  }
  assert.ok(!db.objectives.some((o) => o.polity === 'ferengi'), 'a Ferengi acted on an unrelated loss');
});

// ---------------------------------------------------------------------------------------------------
// COMMERCIAL: THOLIAN — protection of a threatened project as an escort of its named charge
// ---------------------------------------------------------------------------------------------------
// A construction project Tholia → Deep; its first tender is lost at Veil. The project keeps its loads
// moving: the next tender sails, and the command protects it.
function tholianSetup(seed, { noEscorts = false } = {}) {
  const env = mk(seed);
  const { book, world } = env;
  const tender = ready(book, 'tholian', IDX.Tholia)[0];
  tender.shipId = 96;
  if (noEscorts) {
    // Every armed Tholian ship is committed elsewhere; one unarmed hull stays at the depot to carry loads.
    const spare = ready(book, 'tholian', IDX.Tholia).filter((h) => h.id !== tender.id);
    spare[0].shipId = 96;
    for (const h of P(book, 'tholian').hulls) if (h.shipId === 95 && h.status === 'ready') { h.status = 'assigned'; h.opId = 'elsewhere'; }
  }
  const pr = DC.startProject(book, world, 'tholian', IDX.Tholia, IDX.Deep, 1, [], { hullId: tender.id });
  assert.ok(pr.ok && pr.tender, 'no first tender');
  run(book, world, 2, 3); // a day loading, a day's jump: at Veil
  DC.loseAssignmentHullUnwitnessed(book, world, pr.tender.id, 3, 'destroyed', { silent: true });
  const m = pr.tender.milestones[0];
  return { ...env, tender, project: pr.contract, t1: pr.tender, detect: m.dueDay + m.grace + 1 };
}
test('P2-7. a Tholian tender overdue on a real project: the command first defers (no live load to protect), then escorts the next tender (live)', () => {
  const env = tholianSetup('P2-7');
  const { db, book, world } = env;
  const before = hullCount(book);
  run(book, world, 4, env.detect);
  const [inc] = overdueOf(db, 'tholian');
  assert.equal(inc.contractId, env.project.id);
  let e = evalOf(db, 'command:tholian', inc.id);
  assert.equal(e.matchedRule, 'industrial_risk');
  assert.equal(e.proposal, 'defer:protect', JSON.stringify(e));
  assert.match(e.notActing, /no live delivery on contract/);
  step(env, 1); // the project sends its next load
  e = evalOf(db, 'command:tholian', inc.id);
  assert.equal(e.proposal, 'protect'); assert.equal(e.live, true, JSON.stringify(e));
  const o = db.objectives.find((x) => x.incidentId === inc.id && x.response === 'protect');
  assert.ok(o); assert.equal(o.template, 'escort'); assert.equal(o.clock, 'strategic_jumps');
  const t2 = db.assignments.find((a) => a.id === o.charge.assignmentId);
  assert.ok(t2 && t2.kind === 'construction' && t2.contractId === env.project.id && t2.hullId !== env.tender.id);
  assert.equal(o.charge.hullId, t2.hullId); assert.equal(o.charge.vid, t2.vid); assert.equal(o.charge.contractId, env.project.id);
  assert.equal(o.charge.destination, 'system:deep');
  assert.notEqual(o.assigned.hullId, t2.hullId);
  assert.equal(hullById(book, 'tholian', o.assigned.hullId).shipId, 95, 'the escort is not an armed hull');
  assert.equal(hullCount(book), before, 'a protection fleet was spawned');
  const rv = db.reevaluations.find((r) => r.actor === 'command:tholian' && r.incident === inc.id);
  assert.ok(rv && rv.from === 'defer:protect' && rv.to === 'live:protect', JSON.stringify(db.reevaluations));
  log.tholianEscort = { objective: o, reevaluation: rv };
});
test('P2-8. no Tholian escort available: defer:protect with the reason; nothing spawned', () => {
  const env = tholianSetup('P2-8', { noEscorts: true });
  const { db, book, world } = env;
  const before = hullCount(book);
  run(book, world, 4, env.detect + 2);
  const [inc] = overdueOf(db, 'tholian');
  const e = evalOf(db, 'command:tholian', inc.id);
  assert.equal(e.proposal, 'defer:protect', JSON.stringify(e));
  assert.match(e.notActing, /no spare armed vessel/);
  assert.ok(db.assignments.some((a) => a.kind === 'construction' && a.status === 'active' && a.contractId === env.project.id), 'the project stopped moving loads');
  assert.equal(db.objectives.length, 0);
  assert.equal(hullCount(book), before);
});
test('P2-9/10. the escort stays tied to its named charge, travels with it, and closes when the charge reaches safety; then goes home', () => {
  const env = tholianSetup('P2-9');
  const { db, book, world } = env;
  run(book, world, 4, env.detect + 1);
  const o = db.objectives.find((x) => x.response === 'protect');
  const charge = { ...o.charge };
  const trail = [];
  for (let i = 0; i < 6 && o.status === 'active'; i++) {
    step(env, 1);
    const eh = hullById(book, 'tholian', o.assigned.hullId), ch = hullById(book, 'tholian', charge.hullId);
    trail.push({ day: book.settled, escort: eh.systemIndex, charge: ch.systemIndex, state: o.escortState });
    assert.deepEqual(o.charge, charge, 'the charge changed');
  }
  assert.equal(o.status, 'completed', JSON.stringify({ trail, resolution: o.resolution }));
  assert.deepEqual(o.resolution.reasons, ['charge_safe']);
  assert.ok(trail.filter((t) => t.state === 'escorting').every((t) => t.escort === t.charge), JSON.stringify(trail));
  assert.equal(trail.at(-1).charge, IDX.Deep);
  const eh = hullById(book, 'tholian', o.assigned.hullId);
  const home = db.assignments.find((a) => a.hullId === eh.id && a.kind === 'return' && a.status === 'active');
  assert.ok(home || [IDX.Tholia, IDX.Veil, IDX.Deep].includes(eh.systemIndex), 'the escort neither went home nor stood in its own space');
  assert.notEqual(eh.opId, o.assignmentId, 'still on the closed escort');
  log.escortTrail = trail;
});
test('P2-11. an escort never chases: unrelated reports and contacts give it no new target; it keeps station on its charge', () => {
  const env = tholianSetup('P2-11');
  const { db, book, world } = env;
  run(book, world, 4, env.detect + 1);
  const o = db.objectives.find((x) => x.response === 'protect');
  // An unrelated Romulan loss is told to the escort's crew, and an enemy (at war) sits beside its way.
  const x = romulanPatrolLost({ ...env }, { from: book.settled });
  run(book, world, book.settled + 1, x.detectDay);
  const [rinc] = overdueOf(db, 'romulan');
  relay(env, rinc.id, 'command:romulan', `hull:${o.assigned.hullId}`);
  env.relations['klingon:tholian'] = 'war';
  const k = ready(book, 'klingon', IDX.Border)[0];
  k.systemIndex = IDX.Vulcan; // next to Deep, the charge's destination
  const trail = [];
  for (let i = 0; i < 3; i++) { step(env, 1); if (o.escortState === 'escorting' && o.status === 'active') trail.push([hullById(book, 'tholian', o.assigned.hullId).systemIndex, hullById(book, 'tholian', o.charge.hullId).systemIndex]); }
  assert.ok(trail.every(([e, c]) => e === c), `the escort left its charge: ${JSON.stringify(trail)}`);
  assert.ok(!db.assignments.some((a) => a.hullId === o.assigned.hullId && a.status === 'active' && a.itinerary.some((st) => st.systemIndex === IDX.Vulcan)), 'the escort set course for the enemy');
  assert.ok(!db.objectives.some((y) => y.assigned.hullId === o.assigned.hullId && y.id !== o.id), 'the escort took another objective');
  const e = evalOf(db, `hull:${o.assigned.hullId}`, rinc.id);
  assert.ok(['record_only', 'ignore_unknown'].includes(e.proposal), JSON.stringify(e));
  assert.equal(o.target.locationId, 'system:deep');
  assert.ok(['completed', 'active'].includes(o.status));
  if (o.status === 'active') assert.equal(hullById(book, 'tholian', o.assigned.hullId).systemIndex, hullById(book, 'tholian', o.charge.hullId).systemIndex);
  // And the escort never outlives its deadline: it is bounded by the template's own termination rules.
  run(book, world, book.settled + 1, o.deadline.value + 1);
  assert.notEqual(o.status, 'active');
});

// ---------------------------------------------------------------------------------------------------
// REPORTS
// ---------------------------------------------------------------------------------------------------
test('P2-12/13. a delivered report grants only its payload: an overdue notice gives overdue + expected place, never evidence, survivors, fate, attacker or hidden cargo', () => {
  const env = mk('P2-12');
  const { db, book, world } = env;
  const h = ready(book, 'romulan', IDX.Romulus)[0];
  const r = DC.issuePatrol(book, world, 'romulan', h.id, IDX.Aldnas, 1, [], { cargo: { knowledge: 'verified', manifest: [{ cargoId: 'hidden:design-samples', quantity: 4 }] } });
  run(book, world, 2, 2);
  DC.loseAssignmentHullUnwitnessed(book, world, r.assignment.id, 2, 'disabled'); // its crew call for help
  run(book, world, 3, r.assignment.milestones.at(-1).dueDay + 8); // the owner searches and examines the site
  const [inc] = overdueOf(db, 'romulan');
  const own = K(db, 'command:romulan', inc.id);
  assert.ok(Object.keys(own.evidence).length && own.located, 'the owner never found its ship');
  const m = relay(env, inc.id, 'command:romulan', 'command:klingon', { include: 'overdue_notice', channel: 'network' });
  assert.deepEqual(Object.keys(m.payload.claims).sort(), ['asset', 'assignment', 'cargo', 'detectedAt', 'lastKnown', 'missedMilestone']);
  step(env, 3);
  assert.equal(m.state, 'delivered');
  const kk = K(db, 'command:klingon', inc.id);
  assert.equal(kk.claims.asset.assetId, h.identity.vid);
  assert.equal(kk.claims.missedMilestone.kind, 'check_in');
  assert.equal(kk.lastKnownArea, 'system:aldnas');
  assert.deepEqual(kk.evidence, {}, 'evidence travelled in an overdue notice');
  assert.equal(kk.survivors, null); assert.equal(kk.resolution, null, 'the fate travelled in an overdue notice');
  assert.equal(kk.located, undefined);
  assert.equal(kk.attribution, null);
  assert.deepEqual(kk.claims.cargo, { knowledge: 'unknown', manifest: null });
  assert.ok(!JSON.stringify(db.knowledge['command:klingon']).includes('hidden:design-samples'));
  const e = evalOf(db, 'command:klingon', inc.id);
  for (const f of ['actor_attributed', 'identity_known', 'survivors_known', 'linked_own_losses']) assert.ok(!e.knownFacts.includes(f), `${f} from an overdue notice`);
  // Klingon command never learns the distress incident either: it was not told of it.
  const [dist] = distress(db);
  if (dist && !world.neighbours(IDX.Aldnas).map((i) => world.systems[i].controller).includes('klingon')) assert.equal(K(db, 'command:klingon', dist.id), null);
  log.overdueNotice = { message: m, recipient: kk };
});
test('P2-14/15. a report to an unreachable recipient stays pending across save/load and does not touch its doctrine; it is delivered once a way exists', () => {
  const env = mk('P2-14', { reliefShips: { vulcan: 1 } });
  const { db, book, world } = env;
  transportDisabled(env);
  const [inc] = distress(db);
  // A Vulcan ship out at Far Reach, beyond any route.
  const v = ready(book, 'vulcan', IDX.Vulcan)[1];
  v.systemIndex = IDX.FarReach;
  DC.designate(book, 'vulcan', v.id, 'relief');
  const m = relay(env, inc.id, 'command:delpin', `hull:${v.id}`, { include: 'survivor_report', channel: 'network', kind: 'far' });
  assert.equal(m.state, 'pending'); assert.equal(m.deliverDay, null); assert.match(m.reason, /no route/);
  step(env, 2);
  assert.equal(m.state, 'pending');
  assert.equal(K(db, `hull:${v.id}`, inc.id), null, 'an undelivered report reached its recipient');
  assert.equal(evalOf(db, `hull:${v.id}`, inc.id).proposal, 'ignore_unknown');
  // Save and load with it pending.
  const loaded = reload(book);
  const lm = loaded.doctrine.messages.find((x) => x.id === m.id);
  assert.ok(lm); assert.equal(lm.state, 'pending'); assert.deepEqual(lm.payload, m.payload);
  const env2 = { ...env, book: loaded, db: DC.doctrineBook(loaded) };
  world.routes.push([IDX.FarReach, IDX.Vulcan]);
  step(env2, 3);
  assert.equal(lm.state, 'delivered');
  assert.ok(K(env2.db, `hull:${v.id}`, inc.id)?.survivors, 'delivered report did not carry the survivors');
  world.routes.pop();
  log.pending = lm;
});
test('P2-16/17. a delivered report triggers reevaluation; new evidence updates the same incident; a second call for the same people joins the first', () => {
  const env = mk('P2-16');
  const { db, book, world } = env;
  const x = romulanPatrolLost(env);
  run(book, world, 3, x.detectDay);
  const [inc] = overdueOf(db, 'romulan');
  const dh = ready(book, 'delpin', IDX.Delpi)[0];
  DC.issueAssignment(book, world, { polity: 'delpin', hullId: dh.id, kind: 'exploration', doctrineRole: 'explorer', stops: [{ systemIndex: IDX.Aldnas, dwell: 8, milestone: 'arrival' }, { systemIndex: IDX.Delpi, milestone: 'check_in' }] }, book.settled, []);
  step(env, 1);
  assert.equal(evalOf(db, `hull:${dh.id}`, inc.id).proposal, 'ignore_unknown');
  const m = relay(env, inc.id, 'command:romulan', `hull:${dh.id}`, { include: 'overdue_notice', channel: 'network' });
  while (m.state === 'pending') step(env, 1);
  const k = K(db, `hull:${dh.id}`, inc.id);
  const v0 = k.version;
  const rv = db.reevaluations.find((r) => r.actor === `hull:${dh.id}` && r.incident === inc.id);
  assert.ok(rv, JSON.stringify(db.reevaluations));
  assert.equal(rv.from, 'ignore_unknown');
  assert.match(rv.cause, new RegExp(m.id.split(':').pop()));
  step(env, 4); // the explorer examines the site: the same record grows
  assert.ok(K(db, `hull:${dh.id}`, inc.id) === k && k.version > v0, 'the evidence made a new record');
  assert.equal(overdueOf(db, 'romulan').length, 1, 'a duplicate incident');
  // A second call for the same crew joins the open distress incident.
  const env3 = mk('P2-16b');
  transportDisabled(env3);
  const [d1] = distress(env3.db);
  const site = env3.db.ground.evidence[d1.siteId];
  const dup0 = env3.db.stats.duplicatesPrevented || 0;
  const again = DC._raiseDistress(env3.book, env3.world, env3.db, { site, vid: d1.assetId, polity: 'delpin', role: 'refugee_transport', day: 4, urgency: 'critical' }, []);
  assert.equal(again.id, d1.id);
  assert.equal(distress(env3.db).length, 1);
  assert.equal(env3.db.stats.duplicatesPrevented, dup0 + 1);
});

// ---------------------------------------------------------------------------------------------------
// OBJECTIVE PRIORITY
// ---------------------------------------------------------------------------------------------------
test('P2-18/19. a committed vessel is not taken for a new doctrine objective (the conflict is recorded); the deferred response acts once the vessel is free', () => {
  const env = mk('P2-18');
  const { db, book, world } = env;
  // Two Romulan losses on the same days: a patrol at Aldnas, and a scout at Border (Klingon space).
  const x1 = romulanPatrolLost(env);
  const h2 = ready(book, 'romulan', IDX.Romulus)[0];
  const r2 = DC.issueAssignment(book, world, { polity: 'romulan', hullId: h2.id, kind: 'exploration', doctrineRole: 'explorer', stops: [{ systemIndex: IDX.Border, dwell: 1, milestone: 'arrival' }, { systemIndex: IDX.Romulus, milestone: 'check_in' }] }, 2, []);
  run(book, world, 3, 4);
  assert.equal(hullById(book, 'romulan', h2.id).systemIndex, IDX.Border);
  DC.loseAssignmentHullUnwitnessed(book, world, r2.assignment.id, 4, 'destroyed', { silent: true });
  const last = r2.assignment.milestones.at(-1);
  run(book, world, 5, Math.max(x1.detectDay, last.dueDay + last.grace + 1));
  const [inc1, inc2] = overdueOf(db, 'romulan').sort((a, b) => (a.locationId === 'system:romulus' && a.assignmentId === x1.assignment.id ? -1 : 1));
  assert.ok(inc1 && inc2 && inc1.id !== inc2.id);
  // Klingon command has seen debris in its own space at Border; told of the second loss, it links it.
  relay(env, inc2.id, 'command:romulan', 'command:klingon');
  assert.ok(Object.keys(K(db, 'command:klingon', inc2.id).evidence).length, 'Klingon command saw nothing at Border');
  // The Delpin explorer takes up the first.
  const dh = ready(book, 'delpin', IDX.Delpi)[0];
  DC.issueAssignment(book, world, { polity: 'delpin', hullId: dh.id, kind: 'exploration', doctrineRole: 'explorer', stops: [{ systemIndex: IDX.Aldnas, dwell: 1, milestone: 'arrival' }, { systemIndex: IDX.Delpi, milestone: 'check_in' }] }, book.settled, []);
  relay(env, inc1.id, 'command:romulan', `hull:${dh.id}`);
  step(env, 1);
  const o1 = db.objectives.find((o) => o.actor === `hull:${dh.id}`);
  assert.ok(o1 && o1.status === 'active' && o1.incidentId === inc1.id, JSON.stringify(evalOf(db, `hull:${dh.id}`, inc1.id)));
  // Now the second, with the Border evidence, reaches the committed explorer.
  relay(env, inc2.id, 'command:klingon', `hull:${dh.id}`, { include: 'findings' });
  step(env, 1);
  const e = evalOf(db, `hull:${dh.id}`, inc2.id);
  assert.equal(e.proposal, 'defer:investigate', JSON.stringify(e));
  assert.match(e.notActing, /^defer:investigate — vessel committed to investigate objective \d+$/);
  assert.ok(db.conflicts.some((c) => c.actor === `hull:${dh.id}` && c.incident === inc2.id && c.decision === 'deferred'), JSON.stringify(db.conflicts));
  assert.equal(o1.status, 'active', 'the active objective was overwritten');
  assert.equal(hullById(book, 'delpin', dh.id).opId, o1.assignmentId);
  log.conflict = { notActing: e.notActing, conflicts: db.conflicts.slice() };
  // Once the first objective closes, the deferred one is reevaluated and acts.
  run(book, world, book.settled + 1, book.settled + 8);
  assert.notEqual(o1.status, 'active');
  const o2 = db.objectives.find((o) => o.actor === `hull:${dh.id}` && o.incidentId === inc2.id);
  assert.ok(o2, JSON.stringify(evalOf(db, `hull:${dh.id}`, inc2.id)));
  const rv = db.reevaluations.find((r) => r.actor === `hull:${dh.id}` && r.incident === inc2.id && r.to === 'live:investigate');
  assert.ok(rv && rv.from === 'defer:investigate', JSON.stringify(db.reevaluations));
  log.deferredThenLive = rv;
});
test('P2-18b. pre-emption as the table allows, recorded: a survey broken off for an investigation; and (with a test-only live rescue entry) an investigation broken off for a rescue — lives before evidence', () => {
  assert.deepEqual([...DC.PREEMPTION.investigation], ['rescue']);
  assert.deepEqual([...DC.PREEMPTION.escort], []); assert.deepEqual([...DC.PREEMPTION.rescue], []);
  const env = mk('P2-18b');
  const { db, book, world } = env;
  // Only for this test: Delpin explorers rescue live (this round only Vulcan relief does), so the one
  // emergency rule can be exercised.
  db.config = { ...db.config, live: [...db.config.live, { profile: 'delpin', role: 'explorer', response: 'rescue' }] };
  const x = romulanPatrolLost(env, { pods: false }); // nobody survived this one
  // A Delpin survey on station at Aldnas sees the debris before it hears of any incident.
  const dh = ready(book, 'delpin', IDX.Delpi)[0];
  DC.issueAssignment(book, world, { polity: 'delpin', hullId: dh.id, kind: 'exploration', doctrineRole: 'explorer', stops: [{ systemIndex: IDX.Aldnas, dwell: 12, milestone: 'arrival' }, { systemIndex: IDX.Delpi, milestone: 'check_in' }] }, 2, []);
  // A Delpin transport standing at Rigel.
  const th = ready(book, 'delpin', IDX.Delpi)[0];
  const ta = DC.issueAssignment(book, world, { polity: 'delpin', hullId: th.id, kind: 'transport', doctrineRole: 'civilian', stops: [{ systemIndex: IDX.Rigel, dwell: 30, milestone: 'arrival' }, { systemIndex: IDX.Delpi, milestone: 'check_in' }] }, 2, []);
  db.config = { ...db.config, investigationDwellDays: 5 }; // test tuning: a longer investigation, so a call can come in during it
  run(book, world, 3, x.detectDay);
  const [inc] = overdueOf(db, 'romulan');
  // The explorer hears of the Romulan loss (told, or hailed by the Romulan search) and takes it up,
  // breaking off its survey.
  relay(env, inc.id, 'command:romulan', `hull:${dh.id}`, { include: 'overdue_notice' });
  let inv = null;
  for (let i = 0; i < 6 && !inv; i++) { step(env, 1); inv = db.objectives.find((o) => o.actor === `hull:${dh.id}` && o.response === 'investigate'); }
  assert.ok(inv, JSON.stringify(evalOf(db, `hull:${dh.id}`, inc.id)));
  const c1 = db.conflicts.find((c) => c.actor === `hull:${dh.id}` && c.decision === 'preempted' && /^exploration /.test(c.committedTo));
  assert.ok(c1, `breaking off the survey was not recorded: ${JSON.stringify(db.conflicts)}`);
  // Now the transport is disabled at Rigel and calls; the call is passed to the investigating explorer.
  DC.loseAssignmentHullUnwitnessed(book, world, ta.assignment.id, book.settled, 'disabled');
  step(env, 1);
  const [dist] = distress(db);
  assert.ok(dist, 'no call');
  assert.equal(inv.status, 'active', 'precondition: the investigation already ended');
  relay(env, dist.id, dist.detectedBy, `hull:${dh.id}`, { include: 'survivor_report' });
  step(env, 1);
  const res = db.objectives.find((o) => o.actor === `hull:${dh.id}` && o.response === 'rescue');
  assert.ok(res, JSON.stringify(evalOf(db, `hull:${dh.id}`, dist.id)));
  assert.notEqual(inv.status, 'active', 'the investigation was not ended');
  assert.match(inv.resolution.note, /pre-empted by rescue/);
  assert.ok(db.conflicts.some((c) => c.actor === `hull:${dh.id}` && c.incident === dist.id && c.decision === 'preempted' && /investigate objective/.test(c.committedTo)), JSON.stringify(db.conflicts));
  log.preemption = db.conflicts.filter((c) => c.decision === 'preempted');
});
test('P2-9b. an escort stays with a charge the blockade stops: they end the day in the same system, and both ran it together', () => {
  const env = tholianSetup('P2-9b');
  const { db, book, world } = env;
  env.relations['klingon:tholian'] = 'war';
  run(book, world, 4, env.detect + 1);
  const o = db.objectives.find((x) => x.response === 'protect');
  assert.ok(o && o.escortState === 'escorting', JSON.stringify(o?.escortState));
  const kl = ready(book, 'klingon').slice(0, 14);
  for (const h of kl) h.systemIndex = IDX.Deep;
  const b = C.startBlockade(book, world, { power: 'klingon', target: IDX.Deep, hullIds: kl.map((h) => h.id), purpose: 'cut_reinforcements' }, book.settled, []);
  assert.ok(b.ok, b.reason);
  const runs = [];
  for (let i = 0; i < 6 && o.status === 'active'; i++) {
    const fx = step(env, 1);
    for (const f of fx) if (f.type === 'blockadeRun' && f.doctrineAssignmentId === o.charge.assignmentId) runs.push({ day: book.settled, hulls: f.hulls.map((h) => h.hullId) });
    const eh = hullById(book, 'tholian', o.assigned.hullId), ch = hullById(book, 'tholian', o.charge.hullId);
    if (o.status === 'active' && eh.status !== 'lost' && ch.status !== 'lost') assert.equal(eh.systemIndex, ch.systemIndex, `day ${book.settled}: escort at ${eh.systemIndex}, charge at ${ch.systemIndex}`);
  }
  assert.ok(runs.length >= 1, 'no run through the blockade');
  assert.ok(runs[0].hulls.includes(o.assigned.hullId), 'the escort did not run it with its charge');
  log.escortBlockade = { runs, status: o.status, resolution: o.resolution };
});
test('P2-17b. two hulks at one place are two crews: one repaired and gone leaves the other\'s call open and its people waiting', () => {
  const env = mk('P2-17b');
  const { db, book, world } = env;
  const [a1, a2] = ready(book, 'delpin', IDX.Delpi);
  const r1 = DC.issueAssignment(book, world, { polity: 'delpin', hullId: a1.id, kind: 'transport', doctrineRole: 'civilian', stops: [{ systemIndex: IDX.Aldnas, dwell: 5, milestone: 'arrival' }, { systemIndex: IDX.Delpi, milestone: 'check_in' }] }, 1, []);
  const r2 = DC.issueAssignment(book, world, { polity: 'delpin', hullId: a2.id, kind: 'transport', doctrineRole: 'civilian', stops: [{ systemIndex: IDX.Aldnas, dwell: 5, milestone: 'arrival' }, { systemIndex: IDX.Delpi, milestone: 'check_in' }] }, 1, []);
  run(book, world, 2, 2);
  DC.loseAssignmentHullUnwitnessed(book, world, r1.assignment.id, 2, 'disabled');
  DC.loseAssignmentHullUnwitnessed(book, world, r2.assignment.id, 2, 'disabled');
  run(book, world, 3, 4);
  const calls = distress(db);
  assert.equal(calls.length, 2, JSON.stringify(calls.map((c) => c.id)));
  const h2 = hullById(book, 'delpin', a2.id);
  // Recovered and repaired by a real recovery (phase 3: campaign days alone never do this — it stands in
  // for a tow to a yard), then gone.
  h2.hull = h2.maxHull; h2.status = 'ready'; h2.opId = null; h2.systemIndex = IDX.Delpi; delete h2.stranded;
  run(book, world, 5, 5);
  const c1 = calls.find((c) => c.assetId === a1.identity.vid), c2 = calls.find((c) => c.assetId === a2.identity.vid);
  assert.equal(c2.status, 'resolved'); assert.equal(c2.resolution.status, 'vessel_under_way');
  assert.equal(c1.status, 'open', `the first crew's call was closed by the second ship leaving: ${JSON.stringify(c1.resolution)}`);
  const site = db.ground.evidence[c1.siteId];
  assert.ok(site && site.survivors.untilDay >= 5 && site.survivors.aboardAll.includes(a1.id), JSON.stringify(site?.survivors));
});
test('P2-24b. a book saved under an older pilot configuration takes the new defaults (phase 2 pilots go live); only on/off is kept', () => {
  const env = mk('P2-24b');
  const old = JSON.parse(JSON.stringify(env.book));
  old.doctrine.config = { ...old.doctrine.config, live: old.doctrine.config.live.slice(0, 3), enabled: true };
  delete old.doctrine.configVersion;
  const loaded = reload(old);
  const db = DC.doctrineBook(loaded);
  assert.equal(db.configVersion, DC.DOCTRINE_CONFIG_VERSION);
  assert.ok(db.config.live.some((x) => x.profile === 'ferengi') && db.config.live.some((x) => x.profile === 'tholian'), JSON.stringify(db.config.live));
  const off = JSON.parse(JSON.stringify(env.book)); off.doctrine.config.enabled = false; delete off.doctrine.configVersion;
  assert.equal(DC.doctrineBook(reload(off)).config.enabled, false, 'switching doctrine off did not survive the upgrade');
});

// ---------------------------------------------------------------------------------------------------
// MOVEMENT
// ---------------------------------------------------------------------------------------------------
function blockadedRescue(seed) {
  // Vulcan and Klingon at war; Klingons blockade Delpi (at war with the Delpins too), on the relief's way.
  const env = mk(seed, { reliefShips: { vulcan: 1 }, relations: { 'klingon:delpin': 'war', 'klingon:vulcan': 'war' } });
  const { book, world } = env;
  transportDisabled(env);
  const kl = ready(book, 'klingon').slice(0, 12);
  for (const h of kl) h.systemIndex = IDX.Delpi;
  const b = C.startBlockade(book, world, { power: 'klingon', target: IDX.Delpi, hullIds: kl.map((h) => h.id), purpose: 'cut_reinforcements' }, book.settled, []);
  assert.ok(b.ok, b.reason);
  const [inc] = distress(env.db);
  return { ...env, inc, blockade: b.record };
}
test('P2-20. a rescue crossing a blockade runs it through the shared interception engine, with its own vid', () => {
  const env = blockadedRescue('P2-20');
  const { db } = env;
  relay(env, env.inc.id, 'command:delpin', 'command:vulcan', { include: 'survivor_report' });
  const fx = step(env, 3);
  const o = db.objectives.find((x) => x.response === 'rescue');
  assert.ok(o, JSON.stringify(evalOf(db, `hull:${reliefOf(db)}`, env.inc.id)));
  const runs = fx.filter((f) => f.type === 'blockadeRun' && f.doctrineAssignmentId === o.assignmentId);
  assert.ok(runs.length >= 1, 'no run through the shared engine');
  assert.equal(runs[0].kind, 'doctrine'); assert.equal(runs[0].sponsor, 'vulcan');
  assert.equal(runs[0].hulls[0].vid, o.assigned.vid);
  assert.ok(env.blockade.runs.some((r) => r.by.startsWith(o.assignmentId)));
  log.rescueBlockadeRun = runs[0];
});
test('P2-21/22. a disabled doctrine vessel stays where it lies as a repairing hull (§6) and calls for help; a destroyed one retires its vid', () => {
  const env = mk('P2-21', { reliefShips: { vulcan: 1 } });
  const { db, book, world } = env;
  transportDisabled(env);
  const [inc] = distress(db);
  relay(env, inc.id, 'command:delpin', 'command:vulcan', { include: 'survivor_report' });
  step(env, 2);
  const o = db.objectives.find((x) => x.response === 'rescue');
  assert.ok(o);
  const rh = hullById(book, 'vulcan', o.assigned.hullId);
  const where = rh.systemIndex, vid = rh.identity.vid;
  DC.loseAssignmentHullUnwitnessed(book, world, o.assignmentId, book.settled, 'disabled');
  step(env, 3);
  assert.equal(rh.status, 'repairing'); assert.equal(rh.systemIndex, where, 'a disabled hull moved');
  assert.equal(rh.identity.vid, vid);
  assert.ok(distress(db).some((d) => d.assetId === vid), 'the disabled rescuer did not call for help');
  // Destroyed: the same record is lost, its vid is retired, nothing replaces it.
  const env2 = mk('P2-22', { reliefShips: { vulcan: 1 } });
  transportDisabled(env2);
  const [inc2] = distress(env2.db);
  relay(env2, inc2.id, 'command:delpin', 'command:vulcan', { include: 'survivor_report' });
  step(env2, 2);
  const o2 = env2.db.objectives.find((x) => x.response === 'rescue');
  const h2 = hullById(env2.book, 'vulcan', o2.assigned.hullId);
  const vid2 = h2.identity.vid;
  DC.loseAssignmentHullUnwitnessed(env2.book, env2.world, o2.assignmentId, env2.book.settled, 'destroyed', { silent: true });
  run(env2.book, env2.world, env2.book.settled + 1, o2.deadline.value + 4);
  assert.equal(h2.status, 'lost');
  const withVid = Object.values(env2.book.polities).flatMap((p) => p.hulls).filter((h) => h.identity?.vid === vid2);
  // The lost record keeps its vid (the books may drop lost hulls later); no live hull ever takes it again.
  assert.equal(withVid.filter((h) => h.status !== 'lost').length, 0, 'the vid was reused');
  assert.equal(h2.identity.vid, vid2);
  assert.notEqual(o2.status, 'active');
  assert.ok(overdueOf(env2.db, 'vulcan').some((i) => i.assetId === vid2), 'the lost rescuer\'s missed arrival made no incident');
});

// ---------------------------------------------------------------------------------------------------
// COMPARTMENTS AND PERSISTENCE
// ---------------------------------------------------------------------------------------------------
test('P2-23. a secret pact never travels in a report unless a briefed sender explicitly sends it', () => {
  const env = mk('P2-23', { relations: { 'cardassian:dominion': 'peace' } });
  const { db, book, world } = env;
  const pact = C.activatePact(book, world, 'dominion', 'cardassian', 1, [], 'authored');
  assert.ok(pact.ok, pact.reason);
  const key = pact.record.key;
  const x = romulanPatrolLost(env);
  run(book, world, 3, x.detectDay);
  const [inc] = overdueOf(db, 'romulan');
  relay(env, inc.id, 'command:romulan', 'command:cardassian');
  // An unbriefed sender cannot send what it does not hold, even if it tries.
  const a = relay(env, inc.id, 'command:romulan', 'command:klingon', { pactKey: key, channel: 'network' });
  assert.equal(a.payload.pact, null);
  // The signatory sends the report WITHOUT the briefing: nothing about the pact travels.
  const b = relay(env, inc.id, 'command:cardassian', 'command:terran', { channel: 'network' });
  assert.equal(b.payload.pact, null);
  step(env, 3);
  for (const obs of ['command:klingon', 'command:terran']) assert.ok(!(db.briefings[obs] || []).length, `${obs} was briefed`);
  const merchant = ready(book, 'cardassian', IDX.Cardassia)[0];
  // The signatory explicitly sends the briefing to one of its own vessels.
  const c = relay(env, inc.id, 'command:cardassian', `hull:${merchant.id}`, { pactKey: key, kind: 'briefing', channel: 'network' });
  assert.deepEqual(c.payload.pact, { pactKey: key });
  step(env, 2);
  assert.equal(c.state, 'delivered');
  assert.ok((db.briefings[`hull:${merchant.id}`] || []).some((r) => r.pactKey === key && r.via === c.id));
  assert.equal(book.treaties[key].knownTo.length, 0, 'the pact leaked into public knowledge');
});
test('P2-24. save/load preserves report, incident, objective, contract and observer-knowledge IDs, and the continuation is identical', () => {
  const env = mk('P2-24', { reliefShips: { vulcan: 1 }, patrols: { romulan: 1 }, explorers: { delpin: 1 }, merchants: { ferengi: 1 }, projects: { tholian: 1 } });
  const { book, world } = env;
  transportDisabled(env);
  run(book, world, 3, 5);
  const [inc] = distress(env.db);
  relay(env, inc.id, 'command:delpin', 'command:vulcan', { include: 'survivor_report', channel: 'network' });
  step(env, 2);
  C.upgradeCampaignBook(book);
  const saved = JSON.parse(JSON.stringify(book));
  const ids = (b) => ({ incidents: Object.keys(b.doctrine.incidents).sort(), messages: b.doctrine.messages.map((m) => `${m.id}:${m.state}`), objectives: b.doctrine.objectives.map((o) => `${o.id}:${o.status}`), contracts: Object.keys(b.doctrine.contracts).sort(),
    knowledge: Object.entries(b.doctrine.knowledge).map(([o, s]) => `${o}=${Object.keys(s).sort().join(',')}`).sort() });
  const before = ids(book);
  assert.ok(before.messages.length && before.objectives.length && before.contracts.length, JSON.stringify(before));
  run(book, world, book.settled + 1, book.settled + 30);
  const loaded = reload(saved);
  assert.deepEqual(ids(loaded), before);
  run(loaded, world, loaded.settled + 1, loaded.settled + 30);
  assert.equal(C.checksum(loaded), C.checksum(book), 'the reloaded campaign diverged');
  assert.deepEqual(ids(loaded), ids(book));
  log.saveLoadIds = before;
});

// ---------------------------------------------------------------------------------------------------
// INTEGRATED
// ---------------------------------------------------------------------------------------------------
test('DOCTRINE-DISTRESS-INTEGRATION (model). a transport calls; one observer has only the overdue notice; another has the survivors; Vulcan acts only once the survivor report reaches it; a real ship; a blockade on the way; closes; save/load midway', () => {
  const env = blockadedRescue('P2-DDI');
  const { db, world } = env;
  let { book } = env;
  const inc = env.inc;
  const relief = reliefOf(db);
  // Who heard the call: the commands holding the systems next door, and the owner. Not Vulcan.
  const heard = Object.entries(db.knowledge).filter(([, s]) => s[inc.id]).map(([o]) => o).sort();
  assert.ok(heard.includes('command:romulan') && heard.includes('command:delpin'), heard.join(','));
  assert.ok(!heard.some((o) => o.includes('vulcan')), 'Vulcan heard a call out of its range');
  // The Delpin command notices its transport overdue and tells the Vulcans: an overdue notice only.
  run(book, world, book.settled + 1, env.inc.createdDay + 4);
  const [od] = overdueOf(db, 'delpin');
  assert.ok(od, 'no overdue incident');
  relay(env, od.id, 'command:delpin', 'command:vulcan', { include: 'overdue_notice', channel: 'network' });
  step(env, 2);
  const eOverdue = evalOf(db, `hull:${relief}`, od.id);
  assert.equal(eOverdue.proposal, 'record_only', JSON.stringify(eOverdue));
  assert.ok(!db.objectives.some((o) => o.actor === `hull:${relief}`), 'rescue on an overdue notice');
  // The Romulans heard the call itself; they pass the survivor report on to Vulcan.
  const er = evalOf(db, 'command:romulan', inc.id);
  assert.ok(er.knownFacts.includes('survivors_known') && er.proposal === 'record_only', JSON.stringify(er));
  const m = relay(env, inc.id, 'command:romulan', 'command:vulcan', { include: 'survivor_report', channel: 'network' });
  assert.equal(m.state, 'pending');
  step(env, 1);
  // Save and load midway: while the report travels, or once the relief has sailed.
  C.upgradeCampaignBook(book);
  const loaded = reload(book);
  assert.equal(JSON.stringify(loaded.doctrine.incidents), JSON.stringify(book.doctrine.incidents));
  assert.equal(JSON.stringify(loaded.doctrine.messages), JSON.stringify(book.doctrine.messages));
  book = loaded; const db2 = DC.doctrineBook(book); const env2 = { ...env, book, db: db2 };
  step(env2, 3);
  const o = db2.objectives.find((x) => x.response === 'rescue');
  assert.ok(o, JSON.stringify(evalOf(db2, `hull:${relief}`, inc.id)));
  assert.equal(o.incidentId, inc.id); assert.equal(o.assigned.hullId, relief);
  const rv = db2.reevaluations.find((r) => r.actor === `hull:${relief}` && r.incident === inc.id && r.to === 'live:rescue');
  assert.ok(rv, JSON.stringify(db2.reevaluations));
  run(book, world, book.settled + 1, o.deadline.value + 2);
  assert.notEqual(o.status, 'active');
  const dinc = db2.incidents[inc.id];
  assert.ok(o.status === 'completed' ? dinc.resolution?.status === 'survivors_rescued' : o.resolution.reasons.length, JSON.stringify({ o: o.resolution, dinc: dinc.resolution }));
  assert.equal(distress(db2).filter((d) => d.assetId === inc.assetId).length, 1, 'a duplicate distress incident');
  const runs = (book.blockades.find((b) => b.id === env.blockade.id)?.runs || []).filter((r) => String(r.by).startsWith(o.assignmentId)).length;
  assert.ok(runs >= 1, 'the relief crossed the blockaded system without running it');
  log.distressIntegration = { objective: o, incident: dinc, reevaluation: rv, heard, blockadeRunsByRescue: runs, runs: db2.assignments.find((a) => a.id === o.assignmentId)?.runs };
});
test('DOCTRINE-REPORT-REEVALUATION (model). Klingon command records a plain overdue report, then reevaluates the SAME incident to investigate on separate evidence of Klingon losses; no duplicate, no attribution', () => {
  const env = mk('P2-DRR');
  const { db, book, world } = env;
  const x = romulanPatrolLost(env);
  const kh = ready(book, 'klingon', IDX.Border)[0];
  const kr = DC.issuePatrol(book, world, 'klingon', kh.id, IDX.Aldnas, 2, []);
  run(book, world, 3, 3);
  DC.loseAssignmentHullUnwitnessed(book, world, kr.assignment.id, 3, 'destroyed', { silent: true });
  run(book, world, 4, x.detectDay);
  const [inc] = overdueOf(db, 'romulan');
  relay(env, inc.id, 'command:romulan', 'command:klingon', { include: 'overdue_notice', channel: 'network' });
  step(env, 2);
  const e1 = evalOf(db, 'command:klingon', inc.id);
  assert.equal(e1.proposal, 'record_only', JSON.stringify(e1));
  // A Delpin explorer, told of the incident, examines the site; its findings go to Klingon command.
  const dh = ready(book, 'delpin', IDX.Delpi)[0];
  DC.issueAssignment(book, world, { polity: 'delpin', hullId: dh.id, kind: 'exploration', doctrineRole: 'explorer', stops: [{ systemIndex: IDX.Aldnas, dwell: 6, milestone: 'arrival' }, { systemIndex: IDX.Delpi, milestone: 'check_in' }] }, book.settled, []);
  relay(env, inc.id, 'command:romulan', `hull:${dh.id}`, { include: 'overdue_notice' });
  step(env, 5);
  assert.ok(Object.values(K(db, `hull:${dh.id}`, inc.id).evidence).some((e) => e.recovered), 'the explorer recovered nothing');
  assert.equal(evalOf(db, 'command:klingon', inc.id).proposal, 'record_only', 'Klingon reevaluated before the evidence reached it');
  const m = relay(env, inc.id, `hull:${dh.id}`, 'command:klingon', { include: 'findings', channel: 'network' });
  assert.equal(m.state, 'pending');
  step(env, 3);
  const e2 = evalOf(db, 'command:klingon', inc.id);
  assert.ok(e2.knownFacts.includes('linked_own_losses'), JSON.stringify(e2.knownFacts));
  assert.equal(e2.matchedRule, 'shared_losses');
  assert.ok(['investigate', 'defer:investigate'].includes(e2.proposal), e2.proposal);
  assert.equal(e2.live, false, 'Klingon investigation is shadow-only');
  const rv = db.reevaluations.find((r) => r.actor === 'command:klingon' && r.incident === inc.id && r.from === 'record_only');
  assert.ok(rv, JSON.stringify(db.reevaluations));
  assert.match(rv.cause, /\+linked_own_losses/);
  assert.equal(overdueOf(db, 'romulan').length, 1, 'a duplicate incident');
  assert.ok(Object.values(db.knowledge).every((s) => Object.values(s).every((k) => k.attribution === null)), 'an attribution appeared');
  assert.ok(!e2.knownFacts.includes('actor_attributed'));
  log.reportReevaluation = { first: e1, second: e2, reevaluation: rv, message: m };
});

// ---------------------------------------------------------------------------------------------------
// MEASUREMENT: a bounded multi-hundred-day sample with every pilot generator on and regular losses
// ---------------------------------------------------------------------------------------------------
test('MEASURE. 400 days with all pilots and regular losses: counts recorded, queues and saved state bounded', () => {
  const env = mk('P2-MEASURE', { patrols: { romulan: 1 }, explorers: { delpin: 1 }, reliefShips: { vulcan: 1 }, merchants: { ferengi: 1 }, projects: { tholian: 1 } });
  const { book, world, db } = env;
  const series = [];
  const wrongPlace = [];
  for (let d = 2; d <= 400; d++) {
    const fx = run(book, world, d, d);
    for (const f of fx) if (f.type === 'doctrineContract' && f.status === 'completed') {
      const c = db.contracts[f.id];
      const a = c && db.assignments.find((x) => c.assignments.includes(x.id) && x.milestones.some((m) => m.kind === 'arrival' && m.metDay === d));
      const h = a && hullById(book, c.holder, a.hullId);
      if (!h || h.systemIndex !== c.destination) wrongPlace.push({ day: d, contract: f.id, at: h?.systemIndex, destination: c?.destination });
    }
    if (d % 17 === 0) {
      const live = db.assignments.filter((a) => a.status === 'active' && ['patrol', 'delivery', 'construction', 'exploration'].includes(a.kind) && !a.objectiveId);
      const a = live[d % Math.max(1, live.length)];
      if (a) DC.loseAssignmentHullUnwitnessed(book, world, a.id, d, d % 3 === 0 ? 'disabled' : 'destroyed', { silent: d % 2 === 0 });
    }
    if (d % 50 === 0) series.push({ day: d, bytes: JSON.stringify(book.doctrine).length, incidents: Object.keys(db.incidents).length, messages: db.messages.length, pending: db.messages.filter((m) => m.state === 'pending').length, objectives: db.objectives.length, assignments: db.assignments.length, contracts: Object.keys(db.contracts).length, shadow: db.shadow.length, conflicts: db.conflicts.length, reevaluations: db.reevaluations.length, evidence: Object.keys(db.ground.evidence).length });
  }
  const s = db.stats;
  const counts = { incidentsCreated: s.incidentsCreated || 0, overdue: s.incidentsOverdue || 0, distress: s.incidentsDistress || 0, duplicatesPrevented: s.duplicatesPrevented || 0, reportsSent: s.reportsSent || 0, reportsDelivered: s.reportsDelivered || 0, reportsExpired: s.reportsExpired || 0, reportsUndeliverable: s.reportsUndeliverable || 0,
    duplicateReportsPrevented: s.duplicateReportsPrevented || 0, reevaluations: s.reevaluations || 0, liveObjectives: s.liveObjectives || 0, deferred: s.deferred || 0, completed: s.objectivesCompleted || 0, aborted: s.objectivesAborted || 0, expired: s.objectivesExpired || 0, contractsOpened: s.contractsOpened || 0, blockadeRuns: s.blockadeRuns || 0, shadowEvaluations: s.shadowEvaluations };
  log.measurement = { counts, series };
  console.log('   counts', JSON.stringify(counts));
  console.log('   growth', JSON.stringify(series.map((x) => [x.day, x.bytes, x.incidents, x.messages, x.pending])));
  assert.deepEqual(wrongPlace, [], 'a contract was delivered away from its destination');
  assert.ok(counts.incidentsCreated > 5 && counts.reportsDelivered > 5 && counts.liveObjectives > 2, JSON.stringify(counts));
  const last = series.at(-1), mid = series[3];
  assert.ok(last.bytes < 400000, JSON.stringify(last));
  assert.ok(last.bytes < mid.bytes * 1.8, `saved state still growing: ${mid.bytes} → ${last.bytes}`);
  assert.ok(last.messages <= db.config.messageHistoryLimit + last.pending && last.pending < 60, JSON.stringify(last));
  assert.ok(last.incidents <= db.config.incidentHistoryLimit + 10, JSON.stringify(last));
});

if (out) {
  fs.mkdirSync(out, { recursive: true });
  fs.writeFileSync(path.join(out, 'doctrine-phase2-pure-log.json'), JSON.stringify(log, null, 1));
}
console.log(`\ndoctrine runtime phase 2 pure: ${passed} passed${failures.length ? `, ${failures.length} FAILED: ${failures.join(' | ')}` : ''}`);
if (failures.length) process.exit(1);
