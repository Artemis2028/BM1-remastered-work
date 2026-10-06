// Pure tests for faction doctrine runtime phase 3 (docs/doctrine/DOCTRINE-RUNTIME-PHASE3.md): disabled
// hulls stranded until recovered, and bounded patrol, defence and authorised-raid execution. The doctrine
// package is loaded from docs/doctrine/ exactly as the game loads it; the galaxy is
// scripts/doctrine-galaxy-fixture.mjs. Fixture wars: Terran–Klingon, Terran–Cardassian,
// Klingon–Cardassian, and the Dominion with everyone; Romulans and Klingons are at peace.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import * as C from '../src/campaign-strategy.mjs';
import * as D from '../src/doctrine-runtime.mjs';
import * as DC from '../src/doctrine-campaign.mjs';
import { classifyDamage } from '../src/ship-fleet.mjs';
import { galaxy, run, IDX, P, ready, hullById, reload, disable } from './doctrine-galaxy-fixture.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (f) => JSON.parse(fs.readFileSync(path.join(root, f), 'utf8'));
const doctrine = D.loadDoctrine(read('docs/doctrine/bm1-faction-doctrine.v0.2.1.json'), read('docs/doctrine/bm1-faction-doctrine.schema.json'));
const out = process.env.BM1_TEST_OUTPUT || null;

let passed = 0;
const failures = [];
const log = {};
const test = (name, fn) => {
  try { fn(); passed++; console.log('PASS', name); }
  catch (e) { failures.push(name); console.log('FAIL', name, '\n      ', String(e?.stack || e).split('\n').slice(0, 10).join('\n       ')); }
};

function mk(seed, opts = {}) {
  const env = galaxy(seed, opts);
  env.world.doctrineStep = (b, w, d, fx) => DC.advanceDoctrineDay(b, w, d, fx, doctrine);
  const db = DC.doctrineBook(env.book);
  db.config = { ...db.config, patrols: opts.patrols || {}, explorers: opts.explorers || {}, reliefShips: opts.reliefShips || {}, merchants: opts.merchants || {}, projects: opts.projects || {}, patrolAreas: opts.patrolAreas || {} };
  return { ...env, db };
}
const cond = (h) => classifyDamage(h.hull, h.maxHull);
const evalOf = (db, obs, inc) => db.lastEval[`${obs}|${inc}`];
const incidents = (db, pred = () => true) => Object.values(db.incidents).filter(pred);
const attacks = (db, polity = null) => incidents(db, (i) => i.eventType === 'asset_attack' && (!polity || i.polity === polity));
const distress = (db) => incidents(db, (i) => i.eventType === 'distress');
const overdueOf = (db, polity) => incidents(db, (i) => i.eventType === 'asset_overdue' && i.polity === polity);
const military = (db, kind = null) => db.objectives.filter((o) => o.military && (!kind || o.kind === kind));
const hullCount = (book) => Object.values(book.polities).reduce((n, p) => n + p.hulls.filter((h) => h.status !== 'lost').length, 0) - (book.stats.hullsBuilt || 0);
const step = (env, n = 1, onEffect) => run(env.book, env.world, env.book.settled + 1, env.book.settled + n, onEffect);
const relay = (env, inc, from, to, opts = {}) => DC.relayReport(env.book, env.world, inc, from, to, env.book.settled, opts);
const K = (db, obs, inc) => db.knowledge[obs]?.[inc] || null;
// Everything but these hulls of a power sent elsewhere (committed), so a command has only what a test leaves it.
function commitAllBut(book, polity, keep = []) {
  for (const h of P(book, polity).hulls) if (h.status === 'ready' && !h.opId && !keep.includes(h.id)) { h.status = 'assigned'; h.opId = 'elsewhere'; }
}
// A Klingon assault on a Terran world, launched as campaign strategy launches one (formal war).
function klingonAssault(env, target = IDX.Vega, n = 3) {
  const hs = ready(env.book, 'klingon', IDX.Border).slice(0, n);
  const op = C.launchOperation(env.book, env.world, 'klingon', hs, target, env.book.settled, 1, 'assault', []);
  return { op, hs };
}

// ===================================================================================================
// PART 1 — disabled hulls
// ===================================================================================================
test('P3-D1/23. a disabled doctrine vessel stays disabled — 1, 5, 20 and 40 days with no help — as a stranded, persistent asset in one place', () => {
  const env = mk('P3-D1');
  const { book, world, db } = env;
  const h = ready(book, 'romulan', IDX.Romulus)[0];
  const r = DC.issuePatrol(book, world, 'romulan', h.id, IDX.Aldnas, 1, []);
  run(book, world, 2, 2);
  DC.loseAssignmentHullUnwitnessed(book, world, r.assignment.id, 2, 'disabled', { silent: true });
  const trail = [];
  for (const d of [1, 5, 20, 40]) { run(book, world, book.settled + 1, 2 + d); trail.push({ d, at: h.systemIndex, cond: cond(h), status: h.status, recovery: h.stranded?.recovery, crew: h.stranded?.crew }); }
  log.strandedTrail = trail;
  for (const t of trail) {
    assert.equal(t.at, IDX.Aldnas, `day ${t.d}: moved`); assert.equal(t.cond, 'disabled', `day ${t.d}: repaired by the passage of days`);
    assert.equal(t.status, 'repairing'); assert.equal(t.recovery, 'awaiting_recovery');
  }
  // It is the same incident's asset all along, and nothing else of that vid is operational anywhere.
  const [inc] = overdueOf(db, 'romulan');
  assert.ok(inc && inc.assetId === h.identity.vid);
  assert.equal(Object.values(book.polities).flatMap((p) => p.hulls).filter((x) => x.identity?.vid === h.identity.vid && x.status !== 'lost').length, 1);
});
test('P3-D2. save/load does not advance a disabled hull to operational', () => {
  const env = mk('P3-D2');
  const { book, world } = env;
  const h = ready(book, 'romulan', IDX.Romulus)[0];
  h.systemIndex = IDX.Aldnas; disable(h); h.status = 'ready';
  run(book, world, 2, 6);
  C.upgradeCampaignBook(book);
  const loaded = reload(book);
  const lh = hullById(loaded, 'romulan', h.id);
  assert.equal(cond(lh), 'disabled'); assert.deepEqual(lh.stranded, h.stranded);
  run(loaded, world, 7, 30);
  assert.equal(cond(lh), 'disabled'); assert.equal(lh.systemIndex, IDX.Aldnas);
});
test('P3-D3/D6. the crew clock runs on its own: life support ends on its day with the explicit crew outcome; the hull is untouched and still stranded', () => {
  const env = mk('P3-D3');
  const { book, world } = env;
  const h = ready(book, 'romulan', IDX.Romulus)[0];
  h.systemIndex = IDX.Aldnas; disable(h); h.status = 'repairing';
  const hull0 = h.hull;
  const fx = [];
  run(book, world, 2, 2 + book.config.crewSurvivalDays + 2, (e) => { if (['strandedCrewLost', 'hullStranded'].includes(e.type) && e.hullId === h.id) fx.push({ type: e.type, day: e.day }); });
  assert.equal(h.hull, hull0, 'the hull changed');
  assert.equal(h.stranded.crew, 'lost');
  assert.equal(h.stranded.crewEndDay, h.stranded.crewUntil + 1);
  assert.deepEqual(fx.map((x) => x.type), ['hullStranded', 'strandedCrewLost']);
  assert.equal(h.stranded.recovery, 'awaiting_recovery'); assert.equal(cond(h), 'disabled');
  log.crewClock = { stranded: h.stranded, effects: fx };
});
test('P3-D4/24. a rescue takes the crew off and leaves the hull disabled where it lies', () => {
  const env = mk('P3-D4', { reliefShips: { vulcan: 1 } });
  const { book, world, db } = env;
  const t = ready(book, 'delpin', IDX.Delpi)[0];
  const a = DC.issueAssignment(book, world, { polity: 'delpin', hullId: t.id, kind: 'transport', doctrineRole: 'civilian', stops: [{ systemIndex: IDX.Romulus, dwell: 1, milestone: 'arrival' }, { systemIndex: IDX.Delpi, milestone: 'check_in' }] }, 1, []);
  run(book, world, 2, 2);
  DC.loseAssignmentHullUnwitnessed(book, world, a.assignment.id, 2, 'disabled');
  run(book, world, 3, 4);
  const [dist] = distress(db);
  relay(env, dist.id, 'command:delpin', 'command:vulcan', { include: 'survivor_report' });
  run(book, world, 5, 15);
  const o = db.objectives.find((x) => x.response === 'rescue');
  assert.ok(o && o.status === 'completed', JSON.stringify(o?.resolution));
  assert.equal(dist.resolution.status, 'survivors_rescued');
  assert.equal(t.stranded.crew, 'rescued'); assert.equal(t.stranded.rescuedBy, o.actor);
  assert.equal(cond(t), 'disabled'); assert.equal(t.systemIndex, IDX.Aldnas); assert.equal(t.stranded.recovery, 'awaiting_recovery');
});
test('P3-D7/D8. a real recovery and repair restores the same hull and vid; its interrupted doctrine job resumes afterwards (§6)', () => {
  const env = mk('P3-D7');
  const { book, world, db } = env;
  const h = ready(book, 'romulan', IDX.Romulus)[0];
  const vid = h.identity.vid;
  // Out to Aldnas and back; disabled on return to its home yard world, Romulus, where nothing blocks the yard.
  const r = DC.issueAssignment(book, world, { polity: 'romulan', hullId: h.id, kind: 'patrol', doctrineRole: 'patrol', stops: [{ systemIndex: IDX.Aldnas, dwell: 0, milestone: 'arrival' }, { systemIndex: IDX.Romulus, dwell: 0, milestone: null }, { systemIndex: IDX.Aldnas, dwell: 0, milestone: 'check_in' }] }, 1, []);
  run(book, world, 2, 3);
  assert.equal(h.systemIndex, IDX.Romulus);
  DC.loseAssignmentHullUnwitnessed(book, world, r.assignment.id, 3, 'disabled', { silent: true });
  const states = [];
  const resumed = [];
  const onH = (e) => { if (e.hullId === h.id && ['hullStranded', 'hullRecovered', 'hullRestored'].includes(e.type)) states.push(`${e.type}@${e.day}`); if (e.type === 'doctrineMoved' && e.hullId === h.id) resumed.push(e.systemIndex); };
  for (let d = 4; d <= 40 && cond(h) !== 'operational'; d++) { run(book, world, d, d, onH); states.push(h.stranded?.recovery || 'restored'); }
  // Stranded, then towed in by its own yard over the recovery days, then repaired in the yard (never before).
  assert.ok(states.includes('recovering') && states.some((s) => s.startsWith('hullRecovered')) && states.some((s) => s.startsWith('hullRestored')), states.join(','));
  assert.ok(states.findIndex((s) => s.startsWith('hullRecovered')) < states.findIndex((s) => s.startsWith('hullRestored')));
  assert.equal(cond(h), 'operational'); assert.equal(h.identity.vid, vid);
  assert.equal(P(book, 'romulan').hulls.filter((x) => x.identity?.vid === vid).length, 1);
  // Its assignment was interrupted, not ended: it resumes from where it stood.
  // (It resumes as soon as the yard has it able to sail — §6 — and the ordinary repair finishes the rest.)
  for (let i = 0; i < 3; i++) step(env, 1, onH);
  assert.deepEqual(resumed, [IDX.Aldnas], 'the repaired vessel did not resume its interrupted job');
  assert.equal(r.assignment.milestones.at(-1).status, 'met'); assert.equal(r.assignment.status, 'completed');
  log.recovery = states;
});
test('P3-D10. a disabled survivor of an operation cannot turn up operational elsewhere: it stays where it was disabled, never picked for another job', () => {
  const env = mk('P3-D10', { planning: true });
  const { book, world } = env;
  const hs = ready(book, 'klingon', IDX.Border).slice(0, 3);
  C.launchOperation(book, world, 'klingon', hs, IDX.Vega, 1, 1, 'assault', []);
  run(book, world, 2, 2);
  disable(hs[0]);
  C.terminateOperations(book, world, 'klingon', 2, [], 'test stand-down');
  const seen = new Set();
  for (let d = 3; d <= 60; d++) { run(book, world, d, d); seen.add(`${hs[0].systemIndex}|${hs[0].opId || '-'}|${cond(hs[0])}`); }
  assert.deepEqual([...seen], [`${IDX.Vega}|-|disabled`]);
});

// ===================================================================================================
// PART 3 — patrols
// ===================================================================================================
function romulanPatrol(env, anchor = IDX.Romulus) {
  const h = ready(env.book, 'romulan', anchor)[0];
  const r = DC.startAreaPatrol(env.book, env.world, 'romulan', h.id, anchor, env.book.settled, []);
  assert.ok(r.ok, r.reason);
  return { h, pat: r.patrol };
}
test('P3-1. a calm patrol stays on its assignment: it sails its area in cycles and never leaves it', () => {
  const env = mk('P3-1');
  const { book, world, db } = env;
  const { h, pat } = romulanPatrol(env);
  const where = new Set();
  for (let d = 2; d <= 40; d++) { run(book, world, d, d); where.add(h.systemIndex); }
  assert.deepEqual(pat.area, [IDX.Vega, IDX.Romulus, IDX.Aldnas].sort((a, b) => a - b));
  assert.ok([...where].every((i) => pat.area.includes(i)), [...where].join(','));
  assert.ok(pat.cycles >= 4, `only ${pat.cycles} cycles`);
  assert.equal(pat.status, 'patrolling'); assert.equal(military(db).length, 0); assert.equal(db.objectives.length, 0);
  log.calmPatrol = { area: pat.area, cycles: pat.cycles, visited: [...where] };
});
test('P3-2/21. a patrol investigates a relevant, credible incident in its area (its command had no spare ship) and keeps its vid', () => {
  const env = mk('P3-2');
  const { book, world, db } = env;
  const { h, pat } = romulanPatrol(env);
  // Another Romulan ship lost at Aldnas, silently; every other Romulan ship is committed elsewhere.
  const other = ready(book, 'romulan', IDX.Romulus)[0];
  const r = DC.issuePatrol(book, world, 'romulan', other.id, IDX.Aldnas, 1, []);
  commitAllBut(book, 'romulan');
  run(book, world, 2, 2);
  DC.loseAssignmentHullUnwitnessed(book, world, r.assignment.id, 2, 'destroyed', { silent: true });
  const due = r.assignment.milestones.at(-1);
  run(book, world, 3, due.dueDay + due.grace + 3);
  const [inc] = overdueOf(db, 'romulan');
  // The command itself has nobody to send (or its budget went to the patrol's response first).
  assert.match(evalOf(db, 'command:romulan', inc.id).notActing, /no spare armed vessel|budget spent/);
  const o = db.objectives.find((x) => x.actor === `hull:${h.id}`);
  assert.ok(o, JSON.stringify(evalOf(db, `hull:${h.id}`, inc.id)));
  assert.equal(o.response, 'investigate'); assert.equal(o.role, 'patrol'); assert.equal(o.assigned.vid, h.identity.vid);
  assert.ok(pat.responses.some((x) => x.objectiveId === o.id));
  log.patrolInvestigates = { objective: o.id, eval: evalOf(db, `hull:${h.id}`, inc.id).matchedRule };
});
test('P3-3. an incident a patrol never received gets no response from it', () => {
  const env = mk('P3-3');
  const { book, world, db } = env;
  // A Klingon patrol around Qo'noS (its area: Qo'noS and Border) — never at Aldnas, where it happens.
  const kh = ready(book, 'klingon', IDX.Qonos)[0];
  const kp = DC.startAreaPatrol(book, world, 'klingon', kh.id, IDX.Qonos, 1, []);
  assert.ok(kp.ok, kp.reason);
  const rh = ready(book, 'romulan', IDX.Romulus)[0];
  const r = DC.issuePatrol(book, world, 'romulan', rh.id, IDX.Aldnas, 1, []);
  run(book, world, 2, 2);
  DC.loseAssignmentHullUnwitnessed(book, world, r.assignment.id, 2, 'destroyed', { silent: true });
  run(book, world, 3, 15);
  const [inc] = overdueOf(db, 'romulan');
  assert.equal(K(db, `hull:${kh.id}`, inc.id), null);
  assert.ok(!db.objectives.some((o) => o.actor === `hull:${kh.id}`));
  const e = evalOf(db, `hull:${kh.id}`, inc.id);
  assert.ok(!e || e.proposal === 'ignore_unknown', JSON.stringify(e));
});
test('P3-4/19. a patrol does not chase beyond its bounded objective: an incident outside its area defers; after a search ends it returns to its area and the same incident never makes a replacement objective', () => {
  const env = mk('P3-4');
  const { book, world, db } = env;
  const { h, pat } = romulanPatrol(env);
  commitAllBut(book, 'romulan', [h.id]);
  // An own ship lost far outside the area (at Rigel): told of it, the patrol defers.
  const far = P(book, 'romulan').hulls.find((x) => x.opId === 'elsewhere');
  far.status = 'ready'; far.opId = null; far.systemIndex = IDX.Delpi;
  const rf = DC.issueAssignment(book, world, { polity: 'romulan', hullId: far.id, kind: 'patrol', doctrineRole: 'patrol', stops: [{ systemIndex: IDX.Rigel, dwell: 0, milestone: 'arrival' }, { systemIndex: IDX.Delpi, milestone: 'check_in' }] }, 1, []);
  run(book, world, 2, 2);
  DC.loseAssignmentHullUnwitnessed(book, world, rf.assignment.id, 2, 'destroyed', { silent: true });
  const due = rf.assignment.milestones.at(-1);
  run(book, world, 3, due.dueDay + due.grace + 3);
  const [inc] = overdueOf(db, 'romulan');
  const e = evalOf(db, `hull:${h.id}`, inc.id);
  assert.equal(e.proposal, 'defer:investigate', JSON.stringify(e));
  assert.match(e.notActing, /outside its patrol area/);
  // A lead in its area: an empty search at Aldnas (nothing there) ends; the patrol goes back to its cycles.
  const near = P(book, 'romulan').hulls.find((x) => x.opId === 'elsewhere');
  near.status = 'ready'; near.opId = null;
  const rn = DC.issuePatrol(book, world, 'romulan', near.id, IDX.Aldnas, book.settled, []);
  commitAllBut(book, 'romulan', [h.id]);
  step(env, 1);
  near.status = 'lost'; near.hull = 0; near.opId = null; // gone without a trace: no wreck, no pods
  rn.assignment.pods = false; rn.assignment.silent = true;
  const d2 = rn.assignment.milestones.at(-1);
  run(book, world, book.settled + 1, d2.dueDay + d2.grace + 1);
  const inc2 = overdueOf(db, 'romulan').find((i) => i.assignmentId === rn.assignment.id);
  assert.ok(inc2);
  let o = null;
  for (let i = 0; i < 6 && !o; i++) { step(env, 1); o = db.objectives.find((x) => x.actor === `hull:${h.id}` && x.incidentId === inc2.id); }
  assert.ok(o, JSON.stringify(evalOf(db, `hull:${h.id}`, inc2.id)));
  run(book, world, book.settled + 1, o.deadline.value + 2);
  assert.notEqual(o.status, 'active');
  const returned = db.stats.patrolsReturned || 0;
  assert.ok(returned >= 1, 'the patrol did not return to its assignment');
  assert.equal(pat.status, 'patrolling');
  const r0 = db.stats.repeatPrevented || 0;
  const where = new Set();
  for (let d = 0; d < 20; d++) { step(env, 1); where.add(h.systemIndex); }
  assert.equal(db.objectives.filter((x) => x.actor === `hull:${h.id}` && x.incidentId === inc2.id).length, 1, 'a replacement objective on the same incident');
  assert.ok([...where].every((i) => pat.area.includes(i)), `left its area: ${[...where]}`);
  log.patrolBounded = { deferReason: e.notActing, objective: o.resolution, repeatPrevented: (db.stats.repeatPrevented || 0) - r0 };
});

// ===================================================================================================
// PART 4 — defence
// ===================================================================================================
function defenseScene(seed, opts = {}) {
  const env = mk(seed, opts);
  const { book } = env;
  // Earth has spare Terran warships one jump from Vega; Vega keeps its garrison.
  const { op, hs } = klingonAssault(env, IDX.Vega, opts.attackers ?? 3);
  return { ...env, op, attackers: hs };
}
test('P3-5/21. a defender protects its own attacked world from a verified attacker: an existing spare ship moves there and stands in its defence', () => {
  const env = defenseScene('P3-5');
  const { book, world, db, op } = env;
  const before = hullCount(book);
  run(book, world, 2, 3); // the assault arrives and engages
  assert.equal(op.status, 'engaged');
  const [inc] = attacks(db, 'terran');
  assert.ok(inc, 'the attack was not witnessed');
  const k = K(db, 'command:terran', inc.id);
  assert.equal(k.attribution.factionId, 'klingon'); assert.equal(k.attribution.provenance, 'direct_sensor');
  const e = evalOf(db, 'command:terran', inc.id);
  assert.equal(e.matchedRule, 'defend_assets'); assert.equal(e.live, true, JSON.stringify(e));
  const o = military(db, 'defense')[0];
  assert.ok(o); assert.equal(o.authority.source, 'defense_obligation'); assert.match(o.authority.detail, /own world Vega/);
  const h = hullById(book, 'terran', o.assigned.hullId);
  const vid = h.identity.vid;
  const d0 = C.localDefenseStrength(book, world, IDX.Vega);
  for (let i = 0; i < 4 && o.state !== 'defending'; i++) step(env, 1);
  assert.equal(o.state, 'defending'); assert.equal(h.systemIndex, IDX.Vega); assert.equal(h.defendingAt, IDX.Vega);
  assert.equal(h.identity.vid, vid);
  assert.equal(hullCount(book), before, 'a defence force was spawned');
  log.defense = { objective: o, strengthBeforeArrival: d0 };
});
test('P3-6/18. the defence stops when the threat ends: the objective closes, the defender leaves its post and goes home, and nothing more happens under it', () => {
  const env = defenseScene('P3-6');
  const { book, world, db } = env;
  run(book, world, 2, 6);
  const o = military(db, 'defense')[0];
  assert.ok(o && o.status === 'active');
  C.terminateOperations(book, world, 'klingon', book.settled, [], 'test withdrawal');
  step(env, 1);
  assert.equal(o.status, 'completed', JSON.stringify(o.resolution)); assert.deepEqual(o.resolution.reasons, ['threat_ended']);
  const h = hullById(book, 'terran', o.assigned.hullId);
  assert.equal(h.defendingAt, undefined);
  const moves = []; step(env, 10, (e) => { if (e.objectiveId === o.id) moves.push(e); });
  assert.equal(moves.length, 0, 'actions under a closed objective');
  assert.notEqual(h.opId, o.assignmentId);
  assert.equal(military(db, 'defense').filter((x) => x.incidentId === o.incidentId).length, 1);
});
test('P3-7. an accepted surrender ends the defence (surrender_accepted) and stands the attackers down', () => {
  const env = defenseScene('P3-7');
  const { book, world, db, op } = env;
  run(book, world, 2, 5);
  const o = military(db, 'defense')[0];
  const r = DC.recordSurrender(book, world, o.incidentId, book.settled, { acceptedBy: 'command:terran' });
  assert.ok(r.ok, r.reason);
  assert.equal(op.status, 'resolved'); assert.equal(op.outcome, 'surrendered');
  step(env, 1);
  assert.equal(o.status, 'completed'); assert.deepEqual(o.resolution.reasons, ['surrender_accepted']);
});
test('P3-20. no available military asset: defer:protect with the reason; nothing spawned', () => {
  const env = defenseScene('P3-20');
  const { book, world, db } = env;
  commitAllBut(book, 'terran', P(book, 'terran').hulls.filter((h) => h.systemIndex === IDX.Vega).map((h) => h.id));
  const before = hullCount(book);
  run(book, world, 2, 5);
  const [inc] = attacks(db, 'terran');
  const e = evalOf(db, 'command:terran', inc.id);
  assert.equal(e.proposal, 'defer:protect', JSON.stringify(e));
  assert.match(e.notActing, /no spare armed vessel/);
  assert.equal(military(db).length, 0); assert.equal(hullCount(book), before);
});

// ===================================================================================================
// PART 5 — authorised raids
// ===================================================================================================
function raidScene(seed, opts = {}) {
  const env = mk(seed, opts);
  const { book } = env;
  // Minor (Terran) left lightly held so the raid has something to decide about.
  const minorHulls = P(book, 'terran').hulls.filter((h) => h.systemIndex === IDX.Minor);
  for (const h of minorHulls.slice(1)) h.systemIndex = IDX.Earth;
  const raider = ready(book, 'klingon', IDX.Border).sort((a, b) => b.maxHull - a.maxHull)[0];
  return { ...env, raider };
}
test('P3-10. hostile but not at formal war: a raid order is refused and no raid happens', () => {
  const env = mk('P3-10', { relations: { 'romulan:klingon': 'hostile' } });
  const { book, world, db } = env;
  const rh = ready(book, 'romulan', IDX.Romulus)[0];
  const r = DC.orderRaid(book, world, { power: 'romulan', target: IDX.Border, hullId: rh.id, day: 1, doctrine });
  assert.equal(r.ok, false); assert.match(r.reason, /no formal war/);
  run(book, world, 2, 40);
  assert.equal(military(db, 'raid').length, 0);
  assert.equal(C.warAuthorityStamp(book, world, 'romulan', IDX.Border), null);
});
test('P3-11/21/22. a formal war and a campaign raid order: the raid sails (through any blockade by the shared engine), decides on station, strikes its bounded number of days, and goes home with its vid', () => {
  const env = raidScene('P3-11');
  const { book, world, db, raider } = env;
  const vid = raider.identity.vid;
  const r = DC.orderRaid(book, world, { power: 'klingon', target: IDX.Minor, hullId: raider.id, day: 1, doctrine });
  assert.ok(r.ok, r.reason);
  const o = r.objective;
  assert.equal(o.authority.source, 'formal_war'); assert.equal(o.authority.stamp.holder, 'terran');
  const strikes = [];
  run(book, world, 2, 16, (e) => { if (e.type === 'raidStrike' && e.raidId === o.raid.id) strikes.push(e); });
  assert.notEqual(o.status, 'active');
  const acts = o.actions.map((a) => a.action);
  if (o.status === 'completed') { assert.equal(strikes.length, book.doctrine.config.raidStrikeDays); assert.deepEqual(o.resolution.reasons, ['objective_complete']); }
  else assert.ok(o.resolution.reasons.includes('force_ratio_poor') || o.resolution.reasons.includes('objective_deadline_reached'), JSON.stringify(o.resolution));
  assert.ok(acts.some((a) => ['engage', 'shadow', 'withdraw'].includes(a)), acts.join(','));
  assert.equal(raider.identity.vid, vid);
  assert.ok(raider.status === 'lost' || raider.systemIndex !== IDX.Minor || classifyDamage(raider.hull, raider.maxHull) === 'disabled', 'the raider stayed on station after its raid');
  log.raid = { status: o.status, reasons: o.resolution.reasons, actions: o.actions, strikes };
});
test('P3-12/13. a ceasefire invalidates the raid at once: the one under way stops, and nothing it was sent to do lands afterwards', () => {
  const env = raidScene('P3-12');
  const { book, world, db, raider, relations } = env;
  const r = DC.orderRaid(book, world, { power: 'klingon', target: IDX.Minor, hullId: raider.id, day: 1, doctrine });
  const o = r.objective;
  run(book, world, 2, 2); // one jump out, still en route
  assert.equal(o.status, 'active'); assert.equal(o.state, 'moving');
  C.forceWarTransition(book, world, 'terran', 'klingon', 'ceasefire', 2, 'test ceasefire');
  relations['terran:klingon'] = 'ceasefire';
  const strikes = [];
  run(book, world, 3, 20, (e) => { if (e.type === 'raidStrike' || (e.type === 'defenderLosses' && e.attacker === 'klingon')) strikes.push(e); });
  assert.equal(o.status, 'aborted', JSON.stringify(o.resolution)); assert.equal(o.cancelledBy, 'authority');
  assert.match(o.resolution.note, /war authority ended/);
  assert.equal(o.resolution.day, 3, 'not stopped the day the authority ended');
  assert.equal(strikes.length, 0, 'a strike landed after the ceasefire');
  assert.ok((db.stats.militaryCancelledByAuthority || 0) >= 1);
  // And a new order under the ceasefire is refused.
  const again = DC.orderRaid(book, world, { power: 'klingon', target: IDX.Minor, hullId: ready(book, 'klingon', IDX.Border)[0].id, day: book.settled, doctrine });
  assert.equal(again.ok, false);
});

test('P3-12b. a ceasefire while the raid is on station between strikes: the next strike never lands; the attack it was ends that day', () => {
  const env = raidScene('P3-12b');
  const { book, world, db, raider, relations } = env;
  // Minor unheld by ships and no Terran spare to come to its defence: the raid strikes and would go on.
  for (const h of P(book, 'terran').hulls.filter((x) => x.systemIndex === IDX.Minor)) h.systemIndex = IDX.Earth;
  commitAllBut(book, 'terran');
  const r = DC.orderRaid(book, world, { power: 'klingon', target: IDX.Minor, hullId: raider.id, day: 1, doctrine });
  const o = r.objective;
  for (let i = 0; i < 8 && o.strikeDays < 1 && o.status === 'active'; i++) step(env, 1);
  assert.equal(o.state, 'engaged', JSON.stringify(o.actions)); assert.equal(o.strikeDays, 1);
  const cfDay = book.settled;
  C.forceWarTransition(book, world, 'terran', 'klingon', 'ceasefire', cfDay, 'test ceasefire');
  relations['terran:klingon'] = 'ceasefire';
  const strikes = [];
  step(env, 6, (e) => { if (e.type === 'raidStrike') strikes.push(e); });
  assert.equal(strikes.length, 0, 'a strike landed after the ceasefire');
  assert.equal(o.strikeDays, 1); assert.equal(o.status, 'aborted'); assert.equal(o.cancelledBy, 'authority');
  assert.equal(o.resolution.day, cfDay + 1);
  const inc = Object.values(db.incidents).find((i) => i.source === 'raid' && i.sourceId === o.id);
  assert.ok(inc, 'the raid was never a witnessed attack');
  assert.equal(inc.resolution?.status, 'threat_ended'); assert.equal(inc.resolution.day, cfDay + 1);
});

// ===================================================================================================
// PART 6 — fire authority stays with the engine's gates
// ===================================================================================================
test('P3-14/15/16/17. doctrine can never fire without a live track, in range and a ready weapon; a civilian attacked may return fire but has no war authority and adopts no pursuit', () => {
  const authority = { war_target_verified: true, war_order_active: true, engagement_objective_active: true };
  const physical = { live_weapon_track: true, weapon_usable: true, weapon_ready: true, inside_equipped_range: true, target_actionable: true };
  const f = (role, facts) => D.fireDecision(doctrine, { profileId: 'klingon', role, facts });
  assert.equal(f('patrol', { ...authority, ...physical }).allowed, true);
  for (const miss of ['live_weapon_track', 'inside_equipped_range', 'weapon_ready']) {
    const r = f('patrol', { ...authority, ...physical, [miss]: false });
    assert.equal(r.allowed, false); assert.deepEqual(r.failed, [miss]);
  }
  // A civilian: war facts give it nothing; an attack on itself lets it return fire (with the gates).
  assert.equal(D.fireDecision(doctrine, { profileId: 'ferengi', role: 'civilian', facts: { ...authority, ...physical } }).allowed, false);
  assert.equal(D.fireDecision(doctrine, { profileId: 'ferengi', role: 'civilian', facts: { attack_on_self_verified: true, engagement_objective_active: true, ...physical } }).allowed, true);
  assert.equal(D.fireDecision(doctrine, { profileId: 'ferengi', role: 'civilian', facts: { attack_on_self_verified: true, engagement_objective_active: true, ...physical, live_weapon_track: false } }).allowed, false);
  assert.equal(D.intent(doctrine, { profileId: 'ferengi', role: 'civilian', facts: { local_danger: true, can_withdraw: true } }).action, 'evade');
  // In the campaign: a Ferengi freighter fired on running a blockade records who did it, and does not pursue.
  const env = mk('P3-14', { relations: { 'klingon:ferengi': 'war', 'klingon:delpin': 'war' } });
  const { book, world, db } = env;
  const kl = ready(book, 'klingon').slice(0, 14);
  for (const h of kl) h.systemIndex = IDX.Delpi;
  assert.ok(C.startBlockade(book, world, { power: 'klingon', target: IDX.Delpi, hullIds: kl.map((h) => h.id), purpose: 'cut_reinforcements' }, 1, []).ok);
  let hit = null;
  for (let i = 0; i < 6 && !hit; i++) {
    const fh = ready(book, 'ferengi', IDX.Ferenginar)[0];
    if (!fh) break;
    DC.issueDelivery(book, world, 'ferengi', fh.id, IDX.Delpi, book.settled, [], { slack: 10 });
    for (let d = 0; d < 6 && !hit; d++) { step(env, 1); hit = attacks(db).find((x) => x.source === 'interception'); }
  }
  assert.ok(hit, 'no freighter was fired on in six runs');
  const k = K(db, hit.detectedBy, hit.id);
  assert.equal(k.attribution.factionId, 'klingon');
  step(env, 2);
  const e = evalOf(db, hit.detectedBy, hit.id);
  assert.ok(e.failed.some((x) => /role:civilian not eligible/.test(x)) || e.proposal !== 'protect', JSON.stringify(e));
  assert.ok(!db.objectives.some((o) => o.actor === hit.detectedBy && o.military), 'a civilian adopted a military pursuit');
  log.civilian = { incident: hit.id, eval: { proposal: e.proposal, failed: e.failed, notActing: e.notActing } };
});

// ===================================================================================================
// PART 8/10 — authority and knowledge stay where they belong
// ===================================================================================================
test('P3-22. a patrol cycle into a blockaded world runs the blockade through the shared interception engine', () => {
  const env = mk('P3-22', { relations: { 'romulan:terran': 'war' } });
  const { book, world } = env;
  const { h, pat } = romulanPatrol(env);
  const terr = ready(book, 'terran').slice(0, 12);
  for (const t of terr) t.systemIndex = IDX.Romulus;
  assert.ok(C.startBlockade(book, world, { power: 'terran', target: IDX.Romulus, hullIds: terr.map((x) => x.id), purpose: 'cut_reinforcements' }, 1, []).ok);
  const runs = [];
  run(book, world, 2, 14, (e) => { if (e.type === 'blockadeRun' && String(e.doctrineAssignmentId || '').length && e.hulls?.[0]?.hullId === h.id) runs.push(e); });
  assert.ok(runs.length >= 1, 'the patrol never ran the blockade');
  assert.equal(runs[0].kind, 'doctrine'); assert.equal(runs[0].hulls[0].vid, h.identity.vid);
  log.patrolBlockade = runs.slice(0, 2).map((r) => ({ day: r.day, outcome: r.outcome }));
});
test('P3-25. save/load mid-operation preserves the military objectives, their authority source and the stranded state; the continuation is identical', () => {
  const env = raidScene('P3-25', { patrolAreas: {} });
  const { book, world, db, raider } = env;
  DC.orderRaid(book, world, { power: 'klingon', target: IDX.Minor, hullId: raider.id, day: 1, doctrine });
  const h = ready(book, 'romulan', IDX.Romulus)[0]; h.systemIndex = IDX.Aldnas; disable(h); h.status = 'repairing';
  const as = klingonAssault(env, IDX.Vega, 3);
  run(book, world, 2, 4);
  C.upgradeCampaignBook(book);
  const saved = JSON.parse(JSON.stringify(book));
  const pick = (b) => JSON.stringify({ mil: b.doctrine.objectives.filter((o) => o.military).map((o) => [o.id, o.kind, o.status, o.state, o.authority]), stranded: hullById(b, 'romulan', h.id).stranded, incidents: Object.keys(b.doctrine.incidents).sort() });
  const before = pick(book);
  assert.ok(book.doctrine.objectives.some((o) => o.military), 'nothing military under way');
  run(book, world, 5, 20);
  const loaded = C.upgradeCampaignBook(JSON.parse(JSON.stringify(saved)));
  assert.equal(pick(loaded), before);
  run(loaded, world, 5, 20);
  assert.equal(C.checksum(loaded), C.checksum(book), 'the reloaded campaign diverged');
});
test('P3-26/27. a flag is not a command: the captain flying Klingon colours changes no Klingon authority; a same-flag captain\'s ship is never a Klingon asset; a hull\'s design never selects its authority', () => {
  const env = defenseScene('P3-26', { playerFaction: 'klingon' });
  const { book, world, db } = env;
  env.world.playerRelationSide = 'klingon';
  const player = C.ensurePolity(book, 'player');
  player.hulls.push({ id: 'pf:escort', shipId: 21, hull: 950, maxHull: 950, crew: 1, systemIndex: IDX.Border, status: 'ready', opId: null });
  run(book, world, 2, 6);
  // Terran defence and its authority are Terran; no Klingon command ever picks the captain's ship.
  assert.ok(!db.objectives.some((o) => o.assigned.hullId === 'pf:escort'));
  assert.equal(DC.observerDoctrine(doctrine, book, db, 'hull:pf:escort').profileId, null);
  // A Klingon order is Klingon command's; the captain's colours give the captain's ship no Klingon war order.
  const r = DC.orderRaid(book, world, { power: 'klingon', target: IDX.Minor, hullId: 'pf:escort', day: book.settled, doctrine });
  assert.equal(r.ok, false);
  // A Romulan hull of a Klingon design is still under Romulan command and authority.
  const rh = ready(book, 'romulan', IDX.Romulus)[0]; rh.shipId = 21;
  assert.equal(DC.observerDoctrine(doctrine, book, db, `hull:${rh.id}`).profileId, 'romulan');
  assert.equal(DC.orderRaid(book, world, { power: 'romulan', target: IDX.Vega, hullId: rh.id, day: book.settled, doctrine }).ok, false, 'a Klingon design gave a Romulan hull Klingon war authority');
});
test('P3-28. secret pact knowledge never reaches a patrol\'s decisions: an unbriefed patrol of a signatory holds no briefing, however the command forwards its records', () => {
  const env = mk('P3-28', { relations: { 'klingon:dominion': 'peace' } });
  const { book, world, db } = env;
  book.config.dominionPactPartners = ['cardassian', 'breen', 'klingon']; // authored scenario: the Klingons made eligible
  const pact = C.activatePact(book, world, 'dominion', 'klingon', 1, [], 'authored');
  assert.ok(pact.ok, pact.reason);
  const kh = ready(book, 'klingon', IDX.Border)[0];
  assert.ok(DC.startAreaPatrol(book, world, 'klingon', kh.id, IDX.Border, 1, []).ok);
  const { op } = klingonAssault(env, IDX.Vega, 2); // an event the Klingon command forwards to its vessels
  const other = ready(book, 'klingon', IDX.Qonos)[0];
  const ra = DC.issuePatrol(book, world, 'klingon', other.id, IDX.Aldnas, 1, []);
  run(book, world, 2, 2);
  DC.loseAssignmentHullUnwitnessed(book, world, ra.assignment.id, 2, 'destroyed', { silent: true });
  run(book, world, 3, 14);
  const [inc] = overdueOf(db, 'klingon');
  assert.ok(K(db, `hull:${kh.id}`, inc.id), 'the patrol never heard of its own side\'s loss');
  const facts = DC.deriveFacts(doctrine, book, world, db, `hull:${kh.id}`, inc.id, book.settled).facts;
  assert.equal(facts.pact_briefing_received, undefined);
  assert.equal(DC.deriveFacts(doctrine, book, world, db, 'command:klingon', inc.id, book.settled).facts.pact_briefing_received, true);
  assert.ok(!(db.briefings[`hull:${kh.id}`] || []).length);
  assert.ok(db.messages.filter((m) => m.recipient === `hull:${kh.id}`).every((m) => !m.payload.pact));
});
test('P3-K. knowledge stays with the actor: a patrol told "ship overdue" learns no attacker; a report of an unidentified attacker names nobody', () => {
  const env = mk('P3-K');
  const { book, world, db } = env;
  const { h } = romulanPatrol(env);
  const other = ready(book, 'romulan', IDX.Romulus)[0];
  const r = DC.issuePatrol(book, world, 'romulan', other.id, IDX.Aldnas, 1, []);
  run(book, world, 2, 2);
  DC.loseAssignmentHullUnwitnessed(book, world, r.assignment.id, 2, 'destroyed', { silent: true });
  run(book, world, 3, 14);
  const [inc] = overdueOf(db, 'romulan');
  const k = K(db, `hull:${h.id}`, inc.id);
  assert.ok(k); assert.equal(k.attribution, null); assert.equal(k.claims.attacker, undefined);
  // An attack incident whose witness could not identify the attacker: relayed, it stays unidentified.
  const aid = 'inc:attack:test-unknown';
  db.incidents[aid] = { id: aid, eventType: 'asset_attack', assetId: 'system:aldnas', polity: 'romulan', source: 'interception', sourceId: 'x', locationId: 'system:aldnas', createdDay: book.settled, lastSeenDay: book.settled + 5, detectedBy: 'command:romulan', status: 'open', resolution: null, objectives: [] };
  db.knowledge['command:romulan'][aid] = { incidentId: aid, observerId: 'command:romulan', eventType: 'asset_attack', locationId: 'system:aldnas', observedAt: null, receivedAt: { clock: 'strategic_jumps', value: book.settled }, provenance: 'direct_witness', confidence: 'corroborated', sources: [], claims: { attacker: { factionId: null, identified: false } }, evidence: {}, survivors: null, lastKnownArea: 'system:aldnas', attribution: null, resolution: null, linkedLosses: [], version: 1 };
  relay(env, aid, 'command:romulan', 'command:klingon', { include: 'attack_report' });
  assert.equal(K(db, 'command:klingon', aid).attribution, null);
  assert.equal(DC.deriveFacts(doctrine, book, world, db, 'command:klingon', aid, book.settled).facts.actor_attributed, undefined);
});

// ===================================================================================================
// INTEGRATED
// ===================================================================================================
test('DOCTRINE-DEFENSE-INTEGRATION (model). calm system; a credible attack; the defender learns it; a bounded defence; it fights through the existing engine; the attacker is dealt with; the objective closes; the defender goes back; no pursuit', () => {
  const env = mk('P3-DDI', { patrolAreas: {} });
  const { book, world, db } = env;
  // A Terran area patrol around Vega; a calm fortnight first.
  const th = ready(book, 'terran', IDX.Vega)[0];
  const tp = DC.startAreaPatrol(book, world, 'terran', th.id, IDX.Vega, 1, []);
  assert.ok(tp.ok, tp.reason);
  run(book, world, 2, 14);
  assert.equal(military(db).length, 0, 'calm, yet a military objective');
  const { op } = klingonAssault(env, IDX.Vega, 4);
  const trail = [];
  let o = null;
  for (let i = 0; i < 25; i++) {
    step(env, 1);
    o ||= military(db, 'defense')[0];
    trail.push({ day: book.settled, op: `${op.status}${op.outcome ? `:${op.outcome}` : ''}`, def: o ? `${o.state}/${o.status}` : '-', defense: Math.round(C.localDefenseStrength(book, world, IDX.Vega)) });
    if (o && o.status !== 'active' && op.status === 'resolved') break;
  }
  assert.ok(o, 'no defence objective');
  if (op.status !== 'resolved') { C.terminateOperations(book, world, 'klingon', book.settled, [], 'test withdrawal'); step(env, 2); }
  assert.notEqual(o.status, 'active', JSON.stringify(trail.slice(-3)));
  assert.ok(o.resolution.reasons.some((r) => ['threat_ended', 'surrender_accepted', 'objective_cancelled', 'objective_deadline_reached'].includes(r)), JSON.stringify(o.resolution));
  assert.ok(trail.some((t) => /defending/.test(t.def)), 'the defender never stood in the defence');
  // Back to its assignment; nothing more; no pursuit.
  const after = military(db).length;
  step(env, 20);
  assert.equal(military(db).length, after, 'a new military objective without a new attack');
  const dh = hullById(book, 'terran', o.assigned.hullId);
  assert.ok(dh.status === 'lost' || [IDX.Earth, IDX.Vega, IDX.Vulcan, IDX.Minor, IDX.Romulus].includes(dh.systemIndex), `the defender wandered off to ${dh.systemIndex}`);
  assert.equal(dh.defendingAt, undefined);
  log.defenseIntegration = { trail, objective: { id: o.id, actor: o.actor, resolution: o.resolution, actions: o.actions } };
});
test('DOCTRINE-WAR-AUTHORITY (model). hostile without war → no raid; formal war + raid order → executed; save/load mid-operation; ceasefire → the objective and all future strikes stop', () => {
  const env0 = mk('P3-DWA0', { relations: { 'romulan:klingon': 'hostile' } });
  assert.equal(DC.orderRaid(env0.book, env0.world, { power: 'romulan', target: IDX.Border, hullId: ready(env0.book, 'romulan', IDX.Romulus)[0].id, day: 1, doctrine }).ok, false);
  const env = raidScene('P3-DWA');
  let { book } = env;
  const { world, relations, raider } = env;
  const r = DC.orderRaid(book, world, { power: 'klingon', target: IDX.Minor, hullId: raider.id, day: 1, doctrine });
  assert.ok(r.ok, r.reason);
  run(book, world, 2, 3);
  C.upgradeCampaignBook(book);
  book = reload(book);
  const db = DC.doctrineBook(book);
  const o = db.objectives.find((x) => x.id === r.objective.id);
  assert.ok(o && o.status === 'active', 'the raid did not survive save/load');
  assert.deepEqual(o.authority, r.objective.authority);
  run(book, world, 4, 4);
  C.forceWarTransition(book, world, 'terran', 'klingon', 'ceasefire', 4, 'test ceasefire');
  relations['terran:klingon'] = 'ceasefire';
  const late = [];
  run(book, world, 5, 30, (e) => { if (e.type === 'raidStrike' || (e.type === 'defenderLosses' && e.attacker === 'klingon')) late.push(e); });
  assert.notEqual(o.status, 'active');
  if (o.status === 'aborted' && o.cancelledBy === 'authority') assert.equal(o.resolution.day, 5);
  assert.equal(late.length, 0, 'a strike landed after the ceasefire');
  log.warAuthority = { objective: { status: o.status, reasons: o.resolution.reasons, note: o.resolution.note, actions: o.actions } };
});
test('DISABLED-RESCUE-TIME (model). a hull disabled three jumps from the relief; the call; the relief sails day by day; the hull stays disabled throughout; the crew clock runs; the relief arrives in time and takes the crew off; the hull waits for recovery', () => {
  const env = mk('P3-DRT', { reliefShips: { vulcan: 1 } });
  const { book, world, db } = env;
  const t = ready(book, 'delpin', IDX.Delpi)[0];
  const a = DC.issueAssignment(book, world, { polity: 'delpin', hullId: t.id, kind: 'transport', doctrineRole: 'civilian', stops: [{ systemIndex: IDX.Ferenginar, dwell: 1, milestone: 'arrival' }, { systemIndex: IDX.Delpi, milestone: 'check_in' }] }, 1, []);
  run(book, world, 2, 3);
  assert.equal(t.systemIndex, IDX.Ferenginar);
  DC.loseAssignmentHullUnwitnessed(book, world, a.assignment.id, 3, 'disabled');
  run(book, world, 4, 5);
  const [dist] = distress(db);
  assert.ok(dist);
  relay(env, dist.id, 'command:delpin', 'command:vulcan', { include: 'survivor_report', channel: 'network' });
  const trail = [];
  let o = null;
  for (let i = 0; i < 20 && !(o && o.status !== 'active'); i++) {
    step(env, 1);
    o ||= db.objectives.find((x) => x.response === 'rescue');
    const rh = o && hullById(book, 'vulcan', o.assigned.hullId);
    trail.push({ day: book.settled, hull: `${cond(t)}@${t.systemIndex}`, crew: t.stranded.crew, crewUntil: t.stranded.crewUntil, relief: rh ? rh.systemIndex : null, rescue: o ? o.status : null });
  }
  assert.ok(o, 'no rescue');
  assert.ok(trail.every((x) => x.hull === `disabled@${IDX.Ferenginar}`), JSON.stringify(trail));
  const jumps = new Set(trail.map((x) => x.relief).filter((x) => x != null)).size - 1;
  assert.ok(jumps >= 3, `the relief made only ${jumps} jumps`);
  assert.equal(o.status, 'completed', JSON.stringify(o.resolution));
  assert.equal(t.stranded.crew, 'rescued'); assert.ok(o.resolution.day <= t.stranded.crewUntil);
  assert.equal(cond(t), 'disabled'); assert.equal(t.stranded.recovery, 'awaiting_recovery');
  step(env, 10);
  assert.equal(cond(t), 'disabled'); assert.equal(t.systemIndex, IDX.Ferenginar);
  log.disabledRescueTime = trail;
});
test('DISABLED-RESCUE-TIME (late). the same call when the relief is too far for the crew\'s life support: the relief defers, the crew are lost on their day, the hull stays disabled', () => {
  const env = mk('P3-DRTL', { reliefShips: { vulcan: 1 } });
  const { book, world, db } = env;
  book.config.crewSurvivalDays = 4; // short life support
  const t = ready(book, 'delpin', IDX.Delpi)[0];
  const a = DC.issueAssignment(book, world, { polity: 'delpin', hullId: t.id, kind: 'transport', doctrineRole: 'civilian', stops: [{ systemIndex: IDX.Ferenginar, dwell: 1, milestone: 'arrival' }, { systemIndex: IDX.Delpi, milestone: 'check_in' }] }, 1, []);
  run(book, world, 2, 3);
  DC.loseAssignmentHullUnwitnessed(book, world, a.assignment.id, 3, 'disabled');
  run(book, world, 4, 5);
  const [dist] = distress(db);
  relay(env, dist.id, 'command:delpin', 'command:vulcan', { include: 'survivor_report', channel: 'network' });
  run(book, world, 6, 20);
  const relief = Object.keys(db.designations.vulcan)[0];
  const rescue = db.objectives.find((x) => x.response === 'rescue');
  const ev = evalOf(db, `hull:${relief}`, dist.id);
  assert.ok(!rescue || rescue.status !== 'completed', 'rescued after life support ran out');
  assert.ok((ev && /cannot reach the survivors in time|defer:rescue/.test(`${ev.proposal} ${ev.notActing}`)) || rescue?.status === 'aborted', JSON.stringify(ev));
  assert.equal(t.stranded.crew, 'lost'); assert.equal(cond(t), 'disabled');
  assert.equal(dist.resolution?.status, 'window_closed');
  log.disabledRescueLate = { eval: ev && { proposal: ev.proposal, notActing: ev.notActing }, rescue: rescue && rescue.resolution, stranded: t.stranded };
});

// ===================================================================================================
// MEASUREMENT
// ===================================================================================================
function sysNameOf(world, i) { return world.systems[i]?.name || String(i); }
test('MEASURE-RESCUE. rescue success and failure by the relief\'s travel time against the crew\'s life support (sites 2 and 3 jumps from the Vulcan relief; life support 3–20 days)', () => {
  const rows = [];
  for (const [site, jumps] of [[IDX.Rigel, 2], [IDX.Ferenginar, 3]]) {
    for (const days of [3, 5, 8, 12, 20]) {
      const env = mk(`P3-MR-${site}-${days}`, { reliefShips: { vulcan: 1 } });
      const { book, world, db } = env;
      book.config.crewSurvivalDays = days;
      const t = ready(book, 'delpin', IDX.Delpi)[0];
      const a = DC.issueAssignment(book, world, { polity: 'delpin', hullId: t.id, kind: 'transport', doctrineRole: 'civilian', stops: [{ systemIndex: site, dwell: 1, milestone: 'arrival' }, { systemIndex: IDX.Delpi, milestone: 'check_in' }] }, 1, []);
      for (let i = 0; i < 6 && t.systemIndex !== site; i++) step(env, 1);
      const disabledDay = book.settled;
      DC.loseAssignmentHullUnwitnessed(book, world, a.assignment.id, disabledDay, 'disabled');
      step(env, 2);
      const [dist] = distress(db);
      if (dist) relay(env, dist.id, 'command:delpin', 'command:vulcan', { include: 'survivor_report', channel: 'network' });
      step(env, days + 8);
      const o = db.objectives.find((x) => x.response === 'rescue');
      rows.push({ site: sysNameOf(world, site), jumps, lifeSupportDays: days, crew: t.stranded?.crew, rescueObjective: o ? o.status : 'none', rescuedDay: t.stranded?.crew === 'rescued' ? t.stranded.crewEndDay - disabledDay : null, hull: cond(t) });
      assert.equal(cond(t), 'disabled');
      assert.ok(t.stranded.crew !== 'aboard');
    }
  }
  log.rescueByTravel = rows;
  console.log('   rescue by travel', JSON.stringify(rows));
  assert.ok(rows.some((r) => r.crew === 'rescued') && rows.some((r) => r.crew === 'lost'), 'the sweep did not span both outcomes');
  // A longer trip never succeeds where a shorter one with the same life support failed.
  for (const d of [3, 5, 8, 12, 20]) { const near = rows.find((r) => r.jumps === 2 && r.lifeSupportDays === d), far = rows.find((r) => r.jumps === 3 && r.lifeSupportDays === d); if (far.crew === 'rescued') assert.equal(near.crew, 'rescued'); }
});
test('MEASURE. 400 days, AI offensives on, area patrols on, a campaign raid order every 25 days under the Terran–Klingon war, a ceasefire at day 200 and war again at 260: bounded objectives, no permanent pursuit, garrisons kept', () => {
  const env = mk('P3-MEASURE', { planning: true, patrolAreas: { romulan: 1, klingon: 1, terran: 1 }, patrols: { romulan: 1 }, explorers: { delpin: 1 }, reliefShips: { vulcan: 1 } });
  const { book, world, db, relations } = env;
  const series = [];
  let strandedDays = 0, maxActiveMil = 0, maxPerPolity = 0, garrisonBreaches = 0;
  const longest = {};
  for (let d = 2; d <= 400; d++) {
    if (d === 200) { C.forceWarTransition(book, world, 'terran', 'klingon', 'ceasefire', d, 'measure ceasefire'); relations['terran:klingon'] = 'ceasefire'; }
    if (d === 260) { relations['terran:klingon'] = 'war'; C.forceWarTransition(book, world, 'terran', 'klingon', 'war', d, 'measure war resumed'); }
    if (d % 25 === 0) {
      const target = [IDX.Minor, IDX.Vega, IDX.Earth][Math.floor(d / 25) % 3];
      const kh = ready(book, 'klingon').filter((h) => classifyDamage(h.hull, h.maxHull) === 'operational').sort((a, b) => String(a.id).localeCompare(String(b.id)))[0];
      if (kh) DC.orderRaid(book, world, { power: 'klingon', target, hullId: kh.id, day: d, doctrine, by: 'measure' });
    }
    run(book, world, d, d);
    for (const p of Object.values(book.polities)) for (const h of p.hulls) if (h.stranded && h.status !== 'lost') strandedDays++;
    const act = db.objectives.filter((o) => o.status === 'active' && o.military);
    maxActiveMil = Math.max(maxActiveMil, act.length);
    const per = {}; for (const o of act) per[o.polity] = (per[o.polity] || 0) + 1;
    maxPerPolity = Math.max(maxPerPolity, ...Object.values(per), 0);
    for (const o of act) longest[o.id] = d - o.createdDay;
    for (const [pid, p] of Object.entries(book.polities)) {
      for (const s of world.systems.filter((x) => x.controller === pid)) {
        const home = p.hulls.filter((h) => Number(h.systemIndex) === s.index && h.status !== 'lost' && !hullIsDisabledLocal(h)).length;
        const any = p.hulls.some((h) => h.status !== 'lost');
        if (any && home === 0 && act.some((o) => o.polity === pid && o.kind === 'defense' && o.fromSystem === s.index)) garrisonBreaches++;
      }
    }
    if (d % 50 === 0) series.push({ day: d, bytes: JSON.stringify(book.doctrine).length, militaryActive: act.length, objectives: db.objectives.length, patrols: Object.values(db.patrols).filter((p) => p.status !== 'ended').length, stranded: Object.values(book.polities).flatMap((p) => p.hulls).filter((h) => h.stranded && h.status !== 'lost').length, incidents: Object.keys(db.incidents).length });
  }
  const s = db.stats;
  const mil = db.objectives.filter((o) => o.military);
  const rescues = db.objectives.filter((o) => o.response === 'rescue');
  const counts = { militaryCreated: s.militaryObjectives || 0, militaryClosed: s.militaryClosed || 0, completed: mil.filter((o) => o.status === 'completed').length, expired: s.militaryExpired || 0, cancelledByAuthority: s.militaryCancelledByAuthority || 0,
    deferrals: s.deferred || 0, repeatPrevented: s.repeatPrevented || 0, patrolsFormed: s.patrolsFormed || 0, patrolsReturned: s.patrolsReturned || 0, strandedHullDays: strandedDays,
    rescuesCompleted: rescues.filter((o) => o.status === 'completed').length, rescuesFailed: rescues.filter((o) => o.status !== 'completed' && o.status !== 'active').length,
    raidOrders: db.raidOrders.length, raidOrdersRefused: db.raidOrders.filter((r) => r.status === 'refused').length, attacks: s.incidentsAttack || 0, maxActiveMilitary: maxActiveMil, maxPerPolity, longestMilitaryDays: Math.max(0, ...Object.values(longest)), garrisonBreaches,
    battles: book.stats.battlesResolved, captures: book.stats.captures };
  log.measurement = { counts, series };
  console.log('   counts', JSON.stringify(counts));
  console.log('   growth', JSON.stringify(series.map((x) => [x.day, x.bytes, x.militaryActive, x.objectives, x.patrols, x.stranded, x.incidents])));
  assert.ok(counts.militaryCreated > 0, 'no military activity at all');
  assert.ok(maxPerPolity <= db.config.maxMilitaryObjectivesPerPolity + 1, `a power ran ${maxPerPolity} military objectives at once`);
  assert.ok(counts.longestMilitaryDays <= Math.max(db.config.defenseDeadlineDays, db.config.raidDeadlineDays) + 1, `an objective ran ${counts.longestMilitaryDays} days (permanent pursuit)`);
  assert.equal(garrisonBreaches, 0, 'a defence stripped a world of its last ships');
  assert.ok(series.at(-1).bytes < 450000, JSON.stringify(series.at(-1)));
});
function hullIsDisabledLocal(h) { return classifyDamage(h.hull, h.maxHull) === 'disabled'; }

if (out) { fs.mkdirSync(out, { recursive: true }); fs.writeFileSync(path.join(out, 'doctrine-phase3-pure-log.json'), JSON.stringify(log, null, 1)); }
console.log(`\ndoctrine runtime phase 3 pure: ${passed} passed${failures.length ? `, ${failures.length} FAILED: ${failures.join(' | ')}` : ''}`);
if (failures.length) process.exit(1);
