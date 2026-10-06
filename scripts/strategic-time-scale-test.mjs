// Pure regressions for STRATEGIC-TIME-SCALE-CORRECTION (docs/movement/STRATEGIC-TIME-SCALE-CORRECTION.md).
// f34542d made every strategic movement fly its real legs (a median hop of 12 days). This round corrects the
// systems that still planned as if a hop were a day: doctrine deadlines, rescue and investigation reach,
// war planning, front accounting, evacuation planning and cadence, patrol cadence and Dominion arrival.
// Travel stays ship-independent: every estimate here is the route the journey itself flies, each leg its
// real length (world.legDays) — there is no planning-only speed. Checks are tagged:
//   [baseline-defect] reproduces a one-hop-era assumption present at f34542d that must not exist now;
//   [new-feature]     behaviour this round adds;
//   [preservation]    behaviour that must be unchanged.
// BM1_TIMESCALE_ROOT points the suite at another tree's src/ (run against f34542d, the baseline-defect
// checks fail there on their own assertions).
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(process.env.BM1_TIMESCALE_ROOT || path.join(here, '..'));
const imp = (rel) => import(pathToFileURL(path.join(root, rel)).href);
const C = await imp('src/campaign-strategy.mjs');
const D = await imp('src/doctrine-runtime.mjs');
const DC = await imp('src/doctrine-campaign.mjs');
const G = await import(pathToFileURL(path.join(root, 'scripts/doctrine-galaxy-fixture.mjs')).href);
const { IDX, run, P, ready, reload } = G;
const read = (f) => JSON.parse(fs.readFileSync(path.join(root, f), 'utf8'));
const doctrine = D.loadDoctrine(read('docs/doctrine/bm1-faction-doctrine.v0.2.1.json'), read('docs/doctrine/bm1-faction-doctrine.schema.json'));
const out = process.env.BM1_TEST_OUTPUT || null;

const results = [];
const log = {};
const test = (tag, name, fn) => {
  try { fn(); results.push({ tag, name, ok: true }); console.log('PASS', `[${tag}]`, name); }
  catch (e) { results.push({ tag, name, ok: false, error: String(e?.message || e).split('\n')[0] }); console.log('FAIL', `[${tag}]`, name, '\n      ', String(e?.stack || e).split('\n').slice(0, 8).join('\n       ')); }
};

// ---- worlds ----------------------------------------------------------------------------------------
// The doctrine galaxy (scripts/doctrine-galaxy-fixture.mjs):
//   Earth(0) ─ Vega(1) ─ Border(2) ─ Qonos(3);  Vega ─ Romulus(4);  Border ─ Cardassia(5) ─ Bajora(6) ⇄ Dominica(7);
//   Vega ─ Minor(8);  Romulus ─ Aldnas(11) ─ Delpi(9) ─ Vulcan(10) ─ Vega;  Aldnas ─ Border;  Ferenginar(12) ─ Aldnas;
//   Ferenginar ─ Ganalda(13) ─ Rigel(17) ─ Delpi;  Tholia(14) ─ Veil(15) ─ Deep(16) ─ Vulcan.
// Legs at the default game's scale (a median hop of 12 days), as the engine's chart gives them.
const BASE_LEGS = { '4:11': 12, '11:9': 14, '9:10': 5, '10:1': 12, '1:0': 9, '1:2': 10, '2:3': 5, '1:4': 11, '2:5': 12, '5:6': 10, '6:7': 1, '1:8': 6, '11:2': 13, '12:11': 12, '12:13': 8, '13:17': 8, '17:9': 8, '14:15': 12, '15:16': 12, '16:10': 12 };
function galaxy(seed, { legs = {}, doctrineOn = true, relations = {}, reliefShips = {}, patrols = {}, planning = false } = {}) {
  const env = G.galaxy(seed, { relations, planning });
  const L = { ...BASE_LEGS, ...legs };
  env.world.legDays = (a, b) => L[`${a}:${b}`] ?? L[`${b}:${a}`] ?? 1;
  env.legs = L;
  if (doctrineOn) env.world.doctrineStep = (b, w, d, fx) => DC.advanceDoctrineDay(b, w, d, fx, doctrine);
  const db = DC.doctrineBook(env.book);
  db.config = { ...db.config, patrols, explorers: {}, reliefShips, merchants: {}, projects: {}, patrolAreas: {} };
  return { ...env, db };
}
const legOf = (env, a, b) => env.world.legDays(a, b);
const incidentsOf = (db, polity) => Object.values(db.incidents).filter((i) => i.polity === polity);
const distressOf = (db) => Object.values(db.incidents).filter((i) => i.eventType === 'distress');
const evalOf = (db, obs, inc) => db.lastEval[`${obs}|${inc}`];
const lose = (book, world, id, day, mode = 'destroyed') => DC.loseAssignmentHullUnwitnessed(book, world, id, day, mode, { silent: true });
const vidOf = (h) => h?.identity?.vid || h?.vid || h?.id;
const hullById = (book, polity, id) => P(book, polity).hulls.find((h) => h.id === id);
function runUntil(env, pred, max = 400) {
  for (let i = 0; i < max; i++) { const d = env.book.settled + 1; run(env.book, env.world, d, d); if (pred(d)) return d; }
  return null;
}
// A Romulan patrol lost, unwitnessed, on station at `where`.
function romulanPatrolLostAt(env, where, mode = 'destroyed') {
  const { world, book } = env;
  const h = ready(book, 'romulan', IDX.Romulus)[0];
  const r = DC.issuePatrol(book, world, 'romulan', h.id, where, 1, []);
  assert.ok(r.ok, r.reason);
  const arrive = r.assignment.milestones.find((m) => m.kind === 'arrival').dueDay;
  run(book, world, 2, arrive);
  assert.equal(Number(h.systemIndex), where, `the patrol is not at ${where} on its arrival day ${arrive}`);
  const lost = lose(book, world, r.assignment.id, arrive, mode);
  assert.ok(lost.ok, lost.reason);
  const ci = r.assignment.milestones.at(-1);
  return { hull: h, assignment: r.assignment, lostDay: arrive, detectDay: ci.dueDay + ci.grace + 1 };
}

// ===================================================================================================
// Doctrine deadlines (items 1–3)
// ===================================================================================================
test('baseline-defect', '1. an investigation two legs away (Romulus→Aldnas→Delpi, 12 + 14 days) gets a deadline it can meet: travel + on station + slack', () => {
  const env = galaxy('TS-1');
  const x = romulanPatrolLostAt(env, IDX.Delpi);
  run(env.book, env.world, x.lostDay + 1, x.detectDay);
  const [inc] = incidentsOf(env.db, 'romulan');
  assert.ok(inc, 'no incident');
  const o = env.db.objectives.find((y) => y.incidentId === inc.id && y.response === 'investigate');
  assert.ok(o, `no investigation: ${JSON.stringify(evalOf(env.db, 'command:romulan', inc.id))}`);
  const travel = legOf(env, IDX.Romulus, IDX.Aldnas) + legOf(env, IDX.Aldnas, IDX.Delpi);
  assert.ok(o.plan, 'the objective carries no plan');
  assert.equal(o.plan.etaDays, travel, `planned ETA ${o.plan.etaDays}, route ${travel} days`);
  assert.ok(o.deadline.value >= o.plan.arriveDay + o.plan.onStationDays, `deadline day ${o.deadline.value} is before arrival ${o.plan.arriveDay} + ${o.plan.onStationDays} on station`);
  assert.ok(o.deadline.value > o.createdDay + 14, 'still the one-hop-era 14-day clock');
  assert.ok(o.deadline.value <= o.plan.arriveDay + o.plan.onStationDays + env.db.config.investigationSlackDays, 'the budget is not bounded');
  const done = runUntil(env, () => o.status !== 'active', 200);
  assert.ok(done != null, 'never closed');
  assert.equal(o.status, 'completed', JSON.stringify(o.resolution));
  assert.ok(o.arrivedDay != null && o.arrivedDay <= o.plan.arriveDay + 1, `arrived day ${o.arrivedDay}, planned ${o.plan.arriveDay}`);
  log.investigation = { created: o.createdDay, plan: o.plan, deadline: o.deadline.value, arrived: o.arrivedDay, closed: done, status: o.status };
});
test('new-feature', '2. an investigation still expires — at its travel + search budget, not before, not open-ended', () => {
  const env = galaxy('TS-2');
  const x = romulanPatrolLostAt(env, IDX.Delpi);
  run(env.book, env.world, x.lostDay + 1, x.detectDay);
  const o = env.db.objectives.find((y) => y.response === 'investigate');
  assert.ok(o);
  // The investigator is lost on the way, unseen: the command does not know, so the objective runs on to its
  // own deadline (DOCTRINE-RUNTIME rule) — which is now the real budget.
  run(env.book, env.world, env.book.settled + 1, env.book.settled + 3);
  assert.ok(lose(env.book, env.world, o.assignmentId, env.book.settled).ok);
  const closed = runUntil(env, () => o.status !== 'active', 200);
  assert.ok(['expired', 'aborted'].includes(o.status) && o.resolution.reasons.includes('objective_deadline_reached'), JSON.stringify(o.resolution));
  assert.ok(closed >= o.deadline.value, `expired day ${closed} before its deadline ${o.deadline.value}`);
  assert.ok(closed <= o.deadline.value + 1, `expired day ${closed}, deadline ${o.deadline.value}: open-ended`);
  assert.ok(closed > o.plan.arriveDay + o.plan.onStationDays - 1, 'expired before travel plus search');
  log.investigationExpired = { deadline: o.deadline.value, closed, plan: o.plan };
});
test('new-feature', '3. a rescue is refused when the survivors will not last until the relief can get there (ETA past the window)', () => {
  const env = galaxy('TS-3');
  const h = ready(env.book, 'vulcan', IDX.Vulcan)[0];
  // Vulcan → Delpi → Aldnas: 5 + 14 = 19 days. Survivors observed on day 1 with 10 days left.
  const cap = DC.responseCapacity(env.book, env.world, env.db, `hull:${h.id}`, 'rescue', { systemIndex: IDX.Aldnas, survivorsUntil: 11 }, 1, { incidentId: 'ts3' });
  assert.equal(cap.ok, false, JSON.stringify(cap));
  assert.equal(cap.failedByDistance, true);
  assert.equal(cap.etaDays, 19);
  assert.match(cap.reason, /cannot reach the survivors in time/);
  assert.equal(env.db.stats.etaRescueFailedByDistance, 1);
  log.rescueRefused = cap;
});
test('new-feature', '4. a rescue inside the survival window succeeds on arrival (Vulcan relief, Vulcan→Delpi→Aldnas; survivors live 20 days)', () => {
  const env = galaxy('TS-4', { reliefShips: { vulcan: 1 }, legs: { '11:9': 6 } });
  const x = romulanPatrolLostAt(env, IDX.Aldnas, 'disabled');
  run(env.book, env.world, x.lostDay + 1, x.lostDay + 1);
  const relief = Object.keys(env.db.designations.vulcan)[0];
  assert.ok(relief, 'no relief ship designated');
  // A Delpin explorer on station finds the survivors and tells the relief ship.
  const dh = ready(env.book, 'delpin', IDX.Delpi)[0];
  const day0 = env.book.settled;
  DC.issueAssignment(env.book, env.world, { polity: 'delpin', hullId: dh.id, kind: 'exploration', doctrineRole: 'explorer', stops: [{ systemIndex: IDX.Aldnas, dwell: 4, milestone: 'arrival' }, { systemIndex: IDX.Delpi, milestone: 'check_in' }] }, day0, []);
  runUntil(env, () => distressOf(env.db).length > 0, 30);
  const [dist] = distressOf(env.db);
  assert.ok(dist, 'no survivors found');
  DC.relayReport(env.book, env.world, dist.id, `hull:${dh.id}`, `hull:${relief}`, env.book.settled, { include: 'survivor_report' });
  runUntil(env, () => env.db.objectives.some((y) => y.actor === `hull:${relief}` && y.status !== 'active'), 60);
  const o = env.db.objectives.find((y) => y.actor === `hull:${relief}`);
  assert.ok(o, JSON.stringify(evalOf(env.db, `hull:${relief}`, dist.id)));
  assert.equal(o.response, 'rescue');
  assert.ok(o.plan.arriveDay <= o.plan.survivorsUntil, JSON.stringify(o.plan));
  assert.equal(o.status, 'completed', JSON.stringify(o.resolution));
  assert.equal(dist.resolution?.status, 'survivors_rescued');
  log.rescue = { plan: o.plan, deadline: o.deadline.value, arrived: o.arrivedDay, status: o.status };
});
test('baseline-defect', '5. near relief succeeds where distant relief cannot: same survivors, two ships, the ETA decides', () => {
  const env = galaxy('TS-5');
  const [near, far] = ready(env.book, 'vulcan', IDX.Vulcan);
  far.systemIndex = IDX.Tholia; // Tholia → Veil → Deep → Vulcan → Delpi → Aldnas: 12+12+12+5+14 = 55 days
  near.systemIndex = IDX.Delpi; // Delpi → Aldnas: 14 days
  const target = { systemIndex: IDX.Aldnas, survivorsUntil: 1 + 20 };
  const a = DC.responseCapacity(env.book, env.world, env.db, `hull:${near.id}`, 'rescue', target, 1, { incidentId: 'ts5' });
  const b = DC.responseCapacity(env.book, env.world, env.db, `hull:${far.id}`, 'rescue', target, 1, { incidentId: 'ts5' });
  assert.equal(a.ok, true, a.reason); assert.equal(a.etaDays, 14);
  assert.equal(b.ok, false); assert.equal(b.failedByDistance, true); assert.equal(b.etaDays, 55);
  log.nearFar = { near: { eta: a.etaDays, ok: a.ok }, far: { eta: b.etaDays, ok: b.ok, reason: b.reason } };
});

// ===================================================================================================
// War planning and front accounting (items 4, 5, 8)
// ===================================================================================================
// The Klingons plan from Qonos: Vega (Terran, pop 3000) is Qonos→Border→Vega, 5 + 10 = 15 days; Earth
// (pop 5700) is past Vega; Cardassia (pop 7000) is Border→Cardassia.
function warWorld(seed, legs = {}) {
  const env = galaxy(seed, { doctrineOn: false, legs, planning: true });
  const { book } = env;
  for (const [id, p] of Object.entries(book.polities)) if (id !== 'klingon') p.lastPlanDay = 1e12;
  book.config.planningIntervalDays = 1;
  book.config.aiStrategicOps = false;
  // Every Terran ship home at Earth, every Cardassian at Cardassia: defences are what the test puts there.
  for (const h of P(book, 'terran').hulls) h.systemIndex = IDX.Earth;
  for (const h of P(book, 'klingon').hulls) h.systemIndex = IDX.Qonos;
  return env;
}
test('baseline-defect', '6. the operation planner uses the real ETA: op.plan.etaDays is the journey\'s own arrival, and the force engages that day', () => {
  const env = warWorld('TS-6');
  const { book, world } = env;
  run(book, world, 2, 2);
  const op = book.operations.find((o) => o.faction === 'klingon');
  assert.ok(op, `no operation: ${JSON.stringify(P(book, 'klingon').lastPlan)}`);
  assert.ok(op.plan, 'no plan on the operation');
  const js = book.journeys.filter((j) => j.ref === op.id && j.kind === 'operation');
  const eta = Math.max(...js.map((j) => j.etaDay));
  assert.equal(op.plan.arriveDay, eta, `planned day ${op.plan.arriveDay}, journeys arrive ${eta}`);
  assert.equal(op.arriveDay, eta);
  assert.equal(op.plan.etaDays, eta - op.createdDay);
  const route = C.plotJourney(world, IDX.Qonos, op.targetSystem, 'klingon');
  assert.equal(op.plan.etaDays, route.legDays.reduce((n, d) => n + d, 0));
  runUntil(env, () => op.engagedDay != null || op.status === 'resolved', 60);
  assert.equal(op.engagedDay, op.plan.arriveDay, `engaged day ${op.engagedDay}, planned ${op.plan.arriveDay}`);
  log.opPlan = { target: op.targetSystem, plan: op.plan, engaged: op.engagedDay, lastPlan: P(book, 'klingon').lastPlan };
});
test('new-feature', '7. a force in transit is not counted as standing at its destination (it is incoming, with its ETA)', () => {
  const env = warWorld('TS-7');
  const { book, world } = env;
  const hs = P(book, 'terran').hulls.filter((h) => h.status === 'ready').slice(0, 3);
  const before = C.localDefenseStrength(book, world, IDX.Vega);
  const r = C.startJourney(book, world, { kind: 'return', ref: 'ts7', sponsor: 'terran', hulls: hs, destination: IDX.Vega, purpose: 'reinforce', authority: { kind: 'test', ref: 'ts7' } }, 1, []);
  assert.ok(r.ok && !r.arrived, r.reason);
  const f = C.forceAccount(book, world, IDX.Vega, Infinity, 'klingon');
  assert.equal(C.localDefenseStrength(book, world, IDX.Vega), before, 'the ships in warp are counted at Vega');
  assert.equal(f.standing, Math.round(before));
  assert.equal(f.incoming.length, 1); assert.equal(f.incoming[0].eta, 1 + legOf(env, IDX.Earth, IDX.Vega));
  assert.ok(f.incomingStrength > 0);
  // Traffic that will not stand in the defence when it gets there (a freighter's delivery, an assault) is
  // not incoming defence.
  const fr = P(book, 'terran').hulls.filter((h) => h.status === 'ready' && !h.transit).slice(0, 1);
  const d = DC.issueAssignment(book, world, { polity: 'terran', hullId: fr[0].id, kind: 'delivery', doctrineRole: 'civilian', stops: [{ systemIndex: IDX.Vega, dwell: 1, milestone: 'arrival' }] }, 1, []);
  assert.ok(d.ok, d.reason);
  const f2 = C.forceAccount(book, world, IDX.Vega, Infinity, 'klingon');
  assert.equal(f2.incoming.length, 1, `a delivery counted as incoming defence: ${JSON.stringify(f2.incoming)}`);
});
test('preservation', '8. a force in transit is not available at its origin: not its defence, not picked for a new operation', () => {
  const env = warWorld('TS-8');
  const { book, world } = env;
  const hs = P(book, 'klingon').hulls.filter((h) => h.status === 'ready');
  const leaving = hs.slice(0, 4);
  const before = C.localDefenseStrength(book, world, IDX.Qonos);
  const r = C.startJourney(book, world, { kind: 'return', ref: 'ts8', sponsor: 'klingon', hulls: leaving, destination: IDX.Border, purpose: 'reinforce', authority: { kind: 'test', ref: 'ts8' } }, 1, []);
  assert.ok(r.ok && !r.arrived);
  run(book, world, 2, 2); // departs
  const after = C.localDefenseStrength(book, world, IDX.Qonos);
  assert.ok(after < before, `Qonos defence ${after} still counts the ships in warp (${before})`);
  for (const op of book.operations) for (const id of op.hullIds) assert.ok(!leaving.some((h) => h.id === id && h.transit), 'a ship in warp was picked for an operation');
});
test('new-feature', '9. an incoming reinforcement is recognised separately from what stands there, and only if it arrives first', () => {
  const env = warWorld('TS-9');
  const { book, world } = env;
  const hs = P(book, 'terran').hulls.filter((h) => h.status === 'ready').slice(0, 2);
  C.startJourney(book, world, { kind: 'return', ref: 'ts9', sponsor: 'terran', hulls: hs, destination: IDX.Vega, purpose: 'reinforce', authority: { kind: 'test', ref: 'ts9' } }, 1, []);
  const etaV = 1 + legOf(env, IDX.Earth, IDX.Vega);
  const early = C.forceAccount(book, world, IDX.Vega, etaV - 1, 'klingon');
  const late = C.forceAccount(book, world, IDX.Vega, etaV + 5, 'klingon');
  assert.equal(early.incoming.length, 0); assert.equal(early.later.length, 1);
  assert.equal(late.incoming.length, 1); assert.equal(late.later.length, 0);
  assert.equal(late.atEta, late.standing + late.incomingStrength);
  assert.equal(early.atEta, early.standing, 'a reinforcement arriving after the attacker is counted as if it were there');
});
test('new-feature', 'ETA-AWARE-WAR-PLANNING. a near moderate target is taken over a distant attractive one; a defence already on its way to the near one turns the plan elsewhere; a distant target is not rejected merely for being distant', () => {
  // Vega: Terran, pop 3000, lightly held, 15 days from Qonos. Minor: Terran, pop 6000 here (worth twice
  // Vega), undefended, but 15 + 60 = 75 days away. Worth over distance: Vega.
  const setup = (seed) => { const env = warWorld(seed, { '1:8': 60 }); env.world.systems[IDX.Minor].population = 6000; for (const h of P(env.book, 'terran').hulls) h.systemIndex = IDX.Earth; return env; };
  const a = setup('TS-WP-a');
  run(a.book, a.world, 2, 2);
  const rowsA = P(a.book, 'klingon').lastPlan.considered;
  const opA = a.book.operations.find((o) => o.faction === 'klingon');
  assert.ok(opA, JSON.stringify(rowsA));
  assert.equal(opA.targetSystem, IDX.Vega, `picked ${opA.targetSystem}: ${JSON.stringify(rowsA)}`);
  const minorA = rowsA.find((r) => r.index === IDX.Minor);
  assert.ok(minorA && minorA.etaDays === 75 && minorA.score != null && !minorA.skip, `the distant target was rejected outright: ${JSON.stringify(minorA)}`);
  assert.ok(rowsA.find((r) => r.index === IDX.Vega).score > minorA.score);
  // The same, with every Terran ship already on its way to Vega and arriving before the Klingons: the
  // defence on arrival decides, and the plan turns to the distant target (not to nothing).
  const b = setup('TS-WP-b');
  const hs = P(b.book, 'terran').hulls.filter((h) => h.status === 'ready');
  C.startJourney(b.book, b.world, { kind: 'return', ref: 'ts-wp', sponsor: 'terran', hulls: hs, destination: IDX.Vega, purpose: 'reinforce', authority: { kind: 'test', ref: 'ts-wp' } }, 1, []);
  const acc = C.forceAccount(b.book, b.world, IDX.Vega, 17, 'klingon');
  assert.equal(acc.standing, Math.round(C.localDefenseStrength(b.book, b.world, IDX.Vega)), 'the ships in warp are standing at Vega');
  assert.ok(acc.incomingStrength > 0);
  run(b.book, b.world, 2, 2);
  const rowsB = P(b.book, 'klingon').lastPlan.considered;
  const vega = rowsB.find((r) => r.index === IDX.Vega);
  assert.ok(vega.incomingDefense > 0, JSON.stringify(vega));
  assert.match(vega.skip || '', /defence on arrival/);
  const opB = b.book.operations.find((o) => o.faction === 'klingon');
  assert.ok(opB, JSON.stringify(rowsB));
  assert.equal(opB.targetSystem, IDX.Minor, JSON.stringify(rowsB));
  assert.equal(opB.plan.etaDays, 75);
  log.warPlanning = { a: { chosen: opA.targetSystem, plan: opA.plan, considered: rowsA }, b: { chosen: opB.targetSystem, plan: opB.plan, considered: rowsB } };
});

// ===================================================================================================
// Evacuation (items 6, 7)
// ===================================================================================================
// Terran refuges from Vega: Earth (9 days, far from the front: Earth's only neighbour is Vega), Minor
// (6 days) and Border (Klingon: hostile). The fixture's Vega borders Border, so Vega itself is frontline.
function evacWorld(seed, legs = {}) {
  const env = galaxy(seed, { doctrineOn: false, legs });
  const { book } = env;
  book.config.planningIntervalDays = 1e9; book.config.aiStrategicOps = false;
  return env;
}
test('new-feature', '10. evacuation prefers a substantially nearer refuge: Minor (6 days) over Earth (40 days) — both safe', () => {
  const env = evacWorld('TS-10', { '1:0': 40, '1:8': 6 });
  env.world.systems[IDX.Minor].population = 6000; // big enough to receive them
  const ds = C.evacuationDestinations(env.book, env.world, 'terran', IDX.Vega);
  assert.ok(ds.length >= 2, JSON.stringify(ds));
  assert.equal(ds[0].index, IDX.Minor, JSON.stringify(ds.map((d) => [d.name, d.days, d.score])));
  assert.equal(ds[0].days, 6);
  log.evacDestinations = ds.map((d) => ({ name: d.name, days: d.days, danger: d.danger, crowded: d.crowded, score: d.score }));
});
test('new-feature', '11. evacuation never picks a hostile or inaccessible world because it is close; a nearer front-line world ranks behind a safe one', () => {
  const env = evacWorld('TS-11', { '1:2': 1, '1:0': 12, '1:8': 5 });
  // Border (Klingon, 1 day) is hostile; Romulus (neutral power, 11 days) will not take them; Minor (5 days) sits
  // on the front once the Klingons hold Vulcan... here: make Minor front-line by giving it a Klingon neighbour.
  env.world.routes.push([8, 3]); env.legs['8:3'] = 30;
  env.world.systems[IDX.Minor].population = 6000;
  const ds = C.evacuationDestinations(env.book, env.world, 'terran', IDX.Vega);
  assert.ok(!ds.some((d) => d.index === IDX.Border), 'the hostile world is a refuge');
  assert.ok(!ds.some((d) => d.controller !== 'terran' && !['allied', 'peace'].includes(env.world.relation('terran', d.controller))));
  const minor = ds.find((d) => d.index === IDX.Minor), earth = ds.find((d) => d.index === IDX.Earth);
  assert.ok(minor.frontline && !earth.frontline);
  const rank = (i) => ds.findIndex((d) => d.index === i);
  assert.ok(rank(IDX.Earth) < rank(IDX.Minor), `the nearer front-line Minor ranks ahead of safe Earth: ${JSON.stringify(ds.map((d) => [d.name, d.days, d.danger, d.score]))}`);
  // Inaccessible: a refuge under a heavy hostile blockade is not a refuge, however close.
  const k = ready(env.book, 'klingon'); for (const h of k) h.systemIndex = IDX.Minor;
  const bl = C.startBlockade(env.book, env.world, { power: 'klingon', target: IDX.Minor, hullIds: k.map((h) => h.id), purpose: 'isolate_world' }, 1, []);
  assert.ok(bl.ok, bl.reason);
  run(env.book, env.world, 2, 3);
  const b = env.book.blockades.find((x) => x.id === bl.record.id);
  const v = C.validateEvacuationDestination(env.book, env.world, 'terran', IDX.Vega, IDX.Minor);
  log.blockadedRefuge = { coverage: b.coverage, status: b.status, valid: v.ok, reason: v.reason };
  if (b.status === 'active' && C.blockadeTier(b.coverage) === 'heavy') assert.equal(v.ok, false, 'a heavily blockaded world is a refuge');
  const ds2 = C.evacuationDestinations(env.book, env.world, 'terran', IDX.Vega);
  const m2 = ds2.find((d) => d.index === IDX.Minor);
  assert.ok(!m2 || ds2.indexOf(m2) > 0, 'the blockaded refuge is first');
  log.hostileRefuges = ds.map((d) => ({ name: d.name, days: d.days, danger: d.danger, score: d.score }));
});
function evacRun(seed, legs, { transports = 2, target = null, minorPop = null, destination = null } = {}) {
  const env = evacWorld(seed, legs);
  const { book, world } = env;
  if (minorPop != null) world.systems[IDX.Minor].population = minorPop;
  const t = P(book, 'terran');
  const carriers = t.hulls.filter((h) => h.status === 'ready').slice(0, transports);
  for (const h of carriers) { h.systemIndex = IDX.Vega; h.shipId = 74; }
  G.HULLS[74] = G.HULLS[74] || { price: 70000, mass: 6, combatHull: 600, faction: 'terran', cargo: 60, speed: 25, combat: 0 };
  const dest = destination != null ? { index: destination, name: world.systems[destination].name, days: legOf(env, IDX.Vega, destination) } : C.evacuationDestinations(book, world, 'terran', IDX.Vega)[0];
  const r = C.startEvacuation(book, world, { sponsor: 'terran', origin: IDX.Vega, destination: dest.index, transports: carriers.map((h) => h.id), target: target ?? C.evacuationTargetFor(book, world, IDX.Vega) }, 1, []);
  assert.ok(r.ok, r.reason);
  return { ...env, e: r.record, carriers, dest };
}
test('new-feature', '12. an evacuation completes under representative default conditions (a near refuge, the default lift and target)', () => {
  const env = evacRun('TS-12', { '1:0': 40, '1:8': 6 }, { minorPop: 6000 });
  const end = runUntil(env, () => env.e.status !== 'active', 500);
  assert.equal(env.e.status, 'completed', `${env.e.status} after ${end - 1} days; moved ${env.e.moved}/${env.e.target}`);
  assert.ok(env.e.moved >= env.e.target);
  log.evacComplete = { destination: env.dest.name, days: env.dest.days, target: env.e.target, moved: env.e.moved, cycleDays: 2 * env.dest.days + env.book.config.evacLoadingDays, completedIn: env.e.endDay - env.e.startDay, trips: env.e.convoy?.trip };
});
test('baseline-defect', '13. a convoy forced back at its origin\'s blockade tries again at the next departure, not after a one-hop-era wait', () => {
  let found = null;
  for (let s = 0; s < 60 && !found; s++) {
    const env = evacRun(`TS-13-${s}`, { '1:0': 9 }, { transports: 1, destination: IDX.Earth });
    const { book, world } = env;
    for (const h of P(book, 'terran').hulls) if (!env.carriers.includes(h)) h.systemIndex = IDX.Earth;
    const k = ready(book, 'klingon'); for (const h of k) h.systemIndex = IDX.Vega;
    const bl = C.startBlockade(book, world, { power: 'klingon', target: IDX.Vega, hullIds: k.map((h) => h.id), purpose: 'stop_evacuation' }, 1, []);
    if (!bl.ok) continue;
    run(book, world, 2, 40);
    const cv = env.e.convoy || {};
    const atts = (cv.attempts || []).filter((a) => a.phase === 'loading' && Number(a.at) === IDX.Vega);
    if (cv.turnedBack > 0 && atts.length >= 2) found = { atts, i: 0, retry: env.book.config.evacRetryDays, turnedBack: cv.turnedBack };
  }
  assert.ok(found, 'no seed produced a turn-back at the origin');
  const gap = found.atts[found.i + 1].day - found.atts[found.i].day;
  assert.ok(gap <= 1, `retried after ${gap} days (rule ${found.retry}): a one-hop-era wait on a weeks-long trip`);
  assert.equal(found.retry, 1);
  // A save from before this round with the stock 3-day wait takes the new one.
  const old = C.createCampaignBook('TS-13-old', 1); old.config.evacRetryDays = 3; delete old.timeScale;
  assert.equal(C.upgradeCampaignBook(old).config.evacRetryDays, 1);
  log.evacRetry = { gap, attempts: found.atts.slice(0, 4) };
});
test('preservation', '14. people transfer only when a convoy arrives at the refuge — never before, at real leg lengths', () => {
  const env = evacRun('TS-14', { '1:8': 6 }, { minorPop: 6000 });
  const moved = [];
  runUntil(env, (d) => { moved.push({ d, moved: env.e.moved, at: env.carriers.map((h) => Number(h.systemIndex)) }); return env.e.moved > 0; }, 60);
  const first = moved.find((m) => m.moved > 0);
  assert.ok(first, 'nothing delivered');
  assert.ok(first.at.includes(env.dest.index), 'delivered while not at the refuge');
  assert.ok(first.d >= 1 + env.book.config.evacLoadingDays + env.dest.days - 1, `delivered day ${first.d}, before the ${env.dest.days}-day leg could finish`);
});
test('new-feature', 'EVACUATION-CADENCE. a distant very safe refuge, a closer safe one and a closer hostile/inaccessible one: the closer safe refuge; real legs; loading; a completed cycle', () => {
  const env = evacWorld('TS-EC', { '1:0': 45, '1:8': 7, '1:2': 2 });
  env.world.systems[IDX.Minor].population = 6000;
  const ds = C.evacuationDestinations(env.book, env.world, 'terran', IDX.Vega);
  assert.equal(ds[0].index, IDX.Minor, JSON.stringify(ds.map((d) => [d.name, d.days, d.score])));
  assert.ok(!ds.some((d) => d.index === IDX.Border));
  const e2 = evacRun('TS-EC', { '1:0': 45, '1:8': 7, '1:2': 2 }, { transports: 2, minorPop: 6000 });
  assert.equal(e2.dest.index, IDX.Minor);
  const trail = [];
  const end = runUntil(e2, (d) => { trail.push({ d, at: Number(e2.carriers[0].systemIndex), tr: e2.carriers[0].transit ? `${e2.carriers[0].transit.from}>${e2.carriers[0].transit.to}@${e2.carriers[0].transit.arrivalDay}` : null, moved: e2.e.moved, trip: e2.e.convoy?.trip }); return e2.e.status !== 'active'; }, 400);
  assert.equal(e2.e.status, 'completed', `${e2.e.status}: ${e2.e.moved}/${e2.e.target}`);
  const firstAt = trail.find((t) => t.at === IDX.Minor)?.d;
  assert.equal(firstAt, 1 + e2.book.config.evacLoadingDays + 7, `first at Minor day ${firstAt}`);
  const backHome = trail.find((t) => t.d > firstAt && t.at === IDX.Vega)?.d;
  assert.ok(backHome == null || backHome - firstAt === 7, `back at Vega day ${backHome}`);
  log.evacCadence = { destinations: ds.map((d) => ({ name: d.name, days: d.days, danger: d.danger, score: d.score })), completedIn: e2.e.endDay - e2.e.startDay, moved: e2.e.moved, target: e2.e.target, firstAtRefuge: firstAt, backHome, trips: e2.e.convoy?.trip };
});

// ===================================================================================================
// Patrol cadence, Dominion arrival, save/load (items 9, 10)
// ===================================================================================================
test('baseline-defect', '15. no duplicate patrol is sent while the existing patrol is in warp, even running late', () => {
  const env = galaxy('TS-15', { patrols: { romulan: 1 }, legs: { '4:11': 12, '1:4': 11 } });
  const { book, world, db } = env;
  run(book, world, 2, 3);
  const first = db.assignments.filter((a) => a.polity === 'romulan' && a.kind === 'patrol' && a.status === 'active');
  assert.equal(first.length, 1, 'no patrol went out');
  const a = first[0];
  const h = hullById(book, 'romulan', a.hullId);
  // Its arrival milestone is marked missed while it is still in warp (it ran late).
  runUntil(env, () => Boolean(h.transit), 5);
  assert.ok(h.transit, 'the patrol is not in warp');
  for (const m of a.milestones) if (m.kind === 'arrival') m.status = 'missed';
  const until = Number(h.transit.arrivalDay) - 1;
  run(book, world, book.settled + 1, Math.max(book.settled + 1, until));
  const live = db.assignments.filter((x) => x.polity === 'romulan' && x.kind === 'patrol' && x.status === 'active');
  assert.equal(live.length, 1, `a duplicate patrol was sent while the first is in warp: ${live.map((x) => x.hullId)}`);
  assert.ok((db.stats.patrolReplacementHeldDays || 0) > 0);
});
test('baseline-defect', '16. a Dominion reinforcement counts toward the expedition only once it has physically arrived', () => {
  const env = galaxy('TS-16', { doctrineOn: false });
  const { book, world } = env;
  const d = book.dominion; d.phase = 'invasion'; d.entrySystem = IDX.Bajora; d.stagingSystem = IDX.Dominica;
  // Two reinforcements at the staging system flying to Cardassia via Bajora (1 + 10 days).
  const p = P(book, 'dominion');
  const fresh = p.hulls.filter((h) => h.status === 'ready').slice(0, 2);
  for (const h of fresh) h.systemIndex = IDX.Bajora;
  world.systems[IDX.Cardassia].controller = 'dominion';
  const base = C.expeditionAssessment(book, world, 'dominion');
  const r = C.startJourney(book, world, { kind: 'expedition', ref: 'dominion:convoy:ts', sponsor: 'dominion', hulls: fresh, destination: IDX.Cardassia, purpose: 'reinforce', authority: { kind: 'reinforcement', ref: 'dominion:convoy:ts' } }, 1, []);
  assert.ok(r.ok && !r.arrived);
  for (const h of fresh) { h.status = 'assigned'; h.opId = r.journey.id; }
  run(book, world, 2, 2);
  assert.ok(fresh.every((h) => h.transit), 'not in warp');
  const mid = C.expeditionAssessment(book, world, 'dominion');
  assert.ok(mid.strength < base.strength, `in-warp reinforcements counted as strength (${mid.strength} vs ${base.strength})`);
  assert.ok(mid.incomingStrength > 0);
  assert.equal(C.localDefenseStrength(book, world, IDX.Cardassia) > 0 && fresh.some((h) => Number(h.systemIndex) === IDX.Cardassia), false);
  runUntil(env, () => fresh.every((h) => !h.transit), 30);
  const after = C.expeditionAssessment(book, world, 'dominion');
  assert.equal(after.incomingStrength, 0);
  assert.ok(after.strength >= base.strength - 1, `after arrival ${after.strength}, before ${base.strength}`);
  log.dominion = { base: base.strength, inWarp: { strength: mid.strength, incoming: mid.incomingStrength }, arrived: after.strength };
});
test('preservation', '17. save/load keeps ETA-aware planning state: the operation plan, the last planning record, objective and evacuation plans, and the journeys\' ETAs', () => {
  const w = warWorld('TS-17');
  run(w.book, w.world, 2, 2);
  const op = w.book.operations.find((o) => o.faction === 'klingon');
  assert.ok(op?.plan);
  const b2 = reload(w.book);
  const op2 = b2.operations.find((o) => o.id === op.id);
  assert.deepEqual(op2.plan, op.plan);
  assert.deepEqual(P(b2, 'klingon').lastPlan, P(w.book, 'klingon').lastPlan);
  assert.deepEqual(b2.journeys.map((j) => j.etaDay), w.book.journeys.map((j) => j.etaDay));
  // Continue both: the same engagement day.
  const a = { book: w.book, world: w.world }, bb = { book: b2, world: w.world };
  run(a.book, a.world, 3, 40); run(bb.book, bb.world, 3, 40);
  assert.equal(b2.operations.find((o) => o.id === op.id).engagedDay, op.engagedDay);
  // Doctrine objective plan.
  const env = galaxy('TS-17b');
  const x = romulanPatrolLostAt(env, IDX.Delpi);
  run(env.book, env.world, x.lostDay + 1, x.detectDay);
  const o = env.db.objectives.find((y) => y.response === 'investigate');
  const rb = reload(env.book);
  assert.deepEqual(DC.doctrineBook(rb).objectives.find((y) => y.id === o.id).plan, o.plan);
  assert.equal(DC.doctrineBook(rb).objectives.find((y) => y.id === o.id).deadline.value, o.deadline.value);
});
test('preservation', '18. the f34542d movement gates stay green (strategic-movement-test, run as-is)', () => {
  const r = spawnSync(process.execPath, [path.join(root, 'scripts/strategic-movement-test.mjs')], { encoding: 'utf8', env: { ...process.env, BM1_TEST_OUTPUT: '' } });
  const last = (r.stdout || '').trim().split('\n').at(-1);
  assert.equal(r.status, 0, last);
  assert.match(last, /27\/27/);
  log.movementGate = last;
});

// ===================================================================================================
// ETA-AWARE-RESCUE (integrated): nearby, distant and better-positioned relief
// ===================================================================================================
test('new-feature', 'ETA-AWARE-RESCUE. nearby relief can make it; distant relief cannot; the better-positioned ship (more jumps, fewer days) is the one sent', () => {
  // Survivors at Aldnas, 20 days of endurance from day 1. Vulcan command's spare ships:
  //  - nearby:  at Delpi, one jump, 14 days;
  //  - distant: at Tholia, five jumps, 55 days;
  //  - better-positioned: at Ganalda, two jumps (Ganalda→Ferenginar→Aldnas, 2 + 3 days) — more jumps than
  //    the nearby ship, fewer days: the soonest arrival by its real legs.
  const env = galaxy('TS-ER', { legs: { '11:9': 14, '17:9': 3, '17:13': 2, '13:12': 2, '12:11': 3, '13:17': 2, '12:13': 2 } });
  const { book, world, db } = env;
  const vs = P(book, 'vulcan').hulls.filter((h) => h.status === 'ready');
  assert.ok(vs.length >= 4, `only ${vs.length} Vulcan ships`);
  const [nearby, distant, better, keep] = vs;
  nearby.systemIndex = IDX.Delpi; distant.systemIndex = IDX.Tholia; better.systemIndex = IDX.Ganalda; keep.systemIndex = IDX.Vulcan;
  for (const h of vs.slice(4)) h.systemIndex = IDX.Vulcan;
  const target = { systemIndex: IDX.Aldnas, survivorsUntil: 21 };
  const eta = (h) => DC.vesselEta(book, world, h, IDX.Aldnas, 'vulcan', 1);
  const e = { nearby: eta(nearby), distant: eta(distant), better: eta(better) };
  assert.equal(e.nearby.hops, 1); assert.equal(e.nearby.days, 14);
  assert.ok(e.distant.days > 20);
  assert.ok(e.better.hops > e.nearby.hops && e.better.days < e.nearby.days, JSON.stringify(e));
  // Each on its own:
  const own = (h) => DC.responseCapacity(book, world, db, `hull:${h.id}`, 'rescue', target, 1, { incidentId: `er-${h.id}` });
  assert.equal(own(nearby).ok, true); assert.equal(own(distant).ok, false); assert.equal(own(better).ok, true);
  // The command sends the soonest arrival, not the fewest jumps.
  const cmd = DC.responseCapacity(book, world, db, 'command:vulcan', 'rescue', target, 1, { incidentId: 'er-cmd' });
  assert.equal(cmd.ok, true, cmd.reason);
  assert.equal(cmd.hullId, better.id, `sent ${cmd.hullId}: ${cmd.reason}`);
  assert.equal(cmd.arriveDay, 1 + e.better.days);
  // The ETA is the journey's own: fly it.
  const r = DC.issueAssignment(book, world, { polity: 'vulcan', hullId: better.id, kind: 'rescue', doctrineRole: 'relief', stops: [{ systemIndex: IDX.Aldnas, dwell: 1, milestone: 'arrival' }] }, 1, []);
  assert.ok(r.ok, r.reason);
  const arrived = runUntil(env, () => Number(better.systemIndex) === IDX.Aldnas && !better.transit, 40);
  assert.equal(arrived, cmd.arriveDay, `arrived day ${arrived}, planned ${cmd.arriveDay}`);
  assert.ok(db.stats.etaRescueProposed >= 4 && db.stats.etaRescueFeasible >= 3 && db.stats.etaRescueFailedByDistance >= 1, JSON.stringify(db.stats));
  log.etaAwareRescue = { etas: Object.fromEntries(Object.entries(e).map(([k, v]) => [k, { hops: v.hops, days: v.days, route: v.route }])), sent: cmd.hullId === better.id ? 'better-positioned' : cmd.hullId, planned: cmd.arriveDay, arrived };
});

// ---------------------------------------------------------------------------------------------------
const byTag = (t) => results.filter((r) => r.tag === t);
const summary = ['baseline-defect', 'new-feature', 'preservation'].map((t) => `${t} ${byTag(t).filter((r) => r.ok).length}/${byTag(t).length}`).join(', ');
if (out) { fs.mkdirSync(out, { recursive: true }); fs.writeFileSync(path.join(out, 'strategic-time-scale-test.json'), JSON.stringify({ root, results, log }, null, 1)); }
const failed = results.filter((r) => !r.ok);
console.log(`\nstrategic time-scale pure: ${results.length - failed.length}/${results.length} (${summary})${failed.length ? ` — FAILED: ${failed.map((r) => r.name.split('.')[0]).join(', ')}` : ''}`);
process.exit(failed.length ? 1 : 0);
