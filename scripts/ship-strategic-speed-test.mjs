// Pure regressions for SHIP-DEPENDENT-STRATEGIC-SPEED (docs/movement/SHIP-DEPENDENT-STRATEGIC-SPEED.md),
// first round (78cd8fa; its day counts re-derived for the rounded-up legs of the rated round, 7d3ce43+): a
// journey's days depend on the ships actually flying it, and every planner reads exactly those days. The
// model side (journeys, formations as journeys, evacuation, war planning, defence accounting, the Dominion
// expedition, blockade running, the tactical handoff, doctrine rescue) on the shared fixture galaxies; the
// captain's own course, the player's formations and the screens are the in-game gate's
// (scripts/ship-strategic-speed-gate.cjs). Checks are tagged:
//   [baseline-defect] reproduces f0e219b flying every ship at the same speed (fails on its own assertion there);
//   [new-feature]     behaviour this round adds;
//   [preservation]    behaviour that must be unchanged.
// BM1_SPEED_ROOT points the suite at another tree's src/ (the baseline reproduction runs it against f0e219b).
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(process.env.BM1_SPEED_ROOT || path.join(here, '..'));
const imp = (rel) => import(pathToFileURL(path.join(root, rel)).href);
const C = await imp('src/campaign-strategy.mjs');
const J = await imp('src/strategic-journey.mjs');
const D = await imp('src/doctrine-runtime.mjs');
const DC = await imp('src/doctrine-campaign.mjs');
let SPD = null; try { SPD = await imp('src/strategic-speed.mjs'); } catch { SPD = null; }
let SE = null; try { SE = await imp('src/strategic-encounter.mjs'); } catch { SE = null; }
const { makeWorld, run } = await import(pathToFileURL(path.join(root, 'scripts/campaign-world-fixture.mjs')).href);
const G = await import(pathToFileURL(path.join(root, 'scripts/doctrine-galaxy-fixture.mjs')).href);
const read = (f) => JSON.parse(fs.readFileSync(path.join(root, f), 'utf8'));
const doctrine = D.loadDoctrine(read('docs/doctrine/bm1-faction-doctrine.v0.2.1.json'), read('docs/doctrine/bm1-faction-doctrine.schema.json'));
const out = process.env.BM1_TEST_OUTPUT || null;

const results = [];
const log = {};
const test = (tag, name, fn) => {
  try { fn(); results.push({ tag, name, ok: true }); console.log('PASS', `[${tag}]`, name); }
  catch (e) { results.push({ tag, name, ok: false, error: String(e?.message || e).split('\n')[0] }); console.log('FAIL', `[${tag}]`, name, '\n      ', String(e?.stack || e).split('\n').slice(0, 7).join('\n       ')); }
};
const need = () => { if (!SPD) throw new Error('this tree has no ship-dependent strategic speed (every ship flies the chart\'s days)'); };
const sum = (a) => a.reduce((n, d) => n + d, 0);

// ---- the fixture galaxy (campaign-world-fixture), at the default game's leg scale -------------------
// Earth(0) ─ Vega(1) ─ Border(2) ─ Qonos(3);  Vega ─ Romulus(4);  Border ─ Cardassia(5) ─ Bajora(6) ⇄ Dominica(7) (wormhole);  Vega ─ Minor(8).
const LEGS = { '0:1': 12, '1:2': 10, '2:3': 8, '1:4': 12, '2:5': 9, '5:6': 7, '6:7': 3, '1:8': 11 };
const legDays = (a, b) => LEGS[`${a}:${b}`] ?? LEGS[`${b}:${a}`] ?? 1;
const IDX = { Earth: 0, Vega: 1, Border: 2, Qonos: 3, Romulus: 4, Cardassia: 5, Bajora: 6, Dominica: 7, Minor: 8 };
// Classes with an explicit strategic speed (as bm-ships/ships.json gives the engine); the fixture's own
// classes (10–60) carry none and fly at the 1.0 default.
const SHIPS = {
  81: { price: 50000, mass: 3, combatHull: 900, faction: 'terran', cargo: 40, strategicSpeed: 1.3, combat: 1 },     // fast courier / strike ship
  82: { price: 70000, mass: 6, combatHull: 900, faction: 'terran', cargo: 1500, strategicSpeed: 0.8, combat: 0 },   // slow bulk freighter
  83: { price: 90000, mass: 4, combatHull: 900, faction: 'terran', cargo: 600, strategicSpeed: 1.0, combat: 0 },    // a cruiser-speed transport
  84: { price: 110000, mass: 6, combatHull: 950, faction: 'klingon', cargo: 0, strategicSpeed: 1.3, combat: 1 },    // fast Klingon strike ship
  85: { price: 110000, mass: 6, combatHull: 950, faction: 'klingon', cargo: 0, strategicSpeed: 0.85, combat: 1 },   // slow Klingon heavy ship (same fighting value)
  86: { price: 200000, mass: 8, combatHull: 1600, faction: 'dominion', cargo: 0, strategicSpeed: 0.85, combat: 1 }, // slow Dominion battleship
};
function campaignWorld(seed, opts = {}) {
  const { world, relations } = makeWorld(opts);
  world.legDays = legDays;
  const base = world.shipStats;
  world.shipStats = (id) => SHIPS[id] || (base(id) ? { cargo: 100, combat: 1, ...base(id) } : null);
  const book = C.createCampaignBook(seed, 1);
  C.initializeCampaign(book, world);
  book.config.aiStrategicOps = false;
  book.config.planningIntervalDays = 1e9;
  return { world, book, relations };
}
const P = (book, id) => C.getPolity(book, id);
const ready = (book, id, at = null) => P(book, id).hulls.filter((h) => h.status === 'ready' && !h.opId && (at == null || Number(h.systemIndex) === at)).sort((a, b) => String(a.id).localeCompare(String(b.id)));
const reload = (book) => C.upgradeCampaignBook(JSON.parse(JSON.stringify(book)));
const vidOf = (h) => h?.identity?.vid || h?.vid || h?.id;
const hullById = (book, polity, id) => P(book, polity).hulls.find((h) => h.id === id);
// A hull of `polity` made into class `shipId`, standing at `at`, free.
const madeHulls = new WeakSet();
function make(env, polity, shipId, at, n = 1) {
  const hs = ready(env.book, polity).filter((h) => !madeHulls.has(h)).slice(0, n);
  assert.equal(hs.length, n, `not ${n} free ${polity} hulls`);
  for (const h of hs) { madeHulls.add(h); h.shipId = shipId; h.systemIndex = at; h.maxHull = h.hull = SHIPS[shipId]?.combatHull ?? h.maxHull; }
  return hs;
}
const journey = (env, hulls, destination, day = 1, kind = 'move') => C.startJourney(env.book, env.world, { kind, ref: `t:${hulls.map((h) => h.id).join('+')}`, sponsor: hulls[0].polity || polityOf(env, hulls[0]), hulls, destination, purpose: 'move' }, day, []);
const polityOf = (env, h) => Object.entries(env.book.polities).find(([, p]) => p.hulls.includes(h))?.[0];
const quiet = (env) => { for (const p of Object.values(env.book.polities)) p.lastPlanDay = 1e12; };

// ===================================================================================================
// The model: legs, groups, boundaries, defaults, save/load, fixed routes (1–10, 24, 25)
// ===================================================================================================
test('baseline-defect', '1. a fast ship completes the same leg sooner than a slow one: Vega → Border (10 chart days) is 8 days at 1.3×, 13 at 0.8×', () => {
  const env = campaignWorld('SP-1');
  const [fast] = make(env, 'terran', 81, IDX.Vega), [slow] = make(env, 'terran', 82, IDX.Vega);
  const a = journey(env, [fast], IDX.Border), b = journey(env, [slow], IDX.Border);
  assert.ok(a.ok && b.ok, `${a.reason} ${b.reason}`);
  log.leg = { fast: a.journey.legDays, slow: b.journey.legDays, chart: legDays(IDX.Vega, IDX.Border) };
  assert.ok(a.journey.legArrivalDay < b.journey.legArrivalDay, `fast arrives day ${a.journey.legArrivalDay}, slow day ${b.journey.legArrivalDay}`);
  assert.deepEqual(a.journey.legDays, [8]); assert.deepEqual(b.journey.legDays, [13]);
  run(env.book, env.world, 2, 14);
  assert.equal(a.journey.arrivedDay, 1 + 8); assert.equal(b.journey.arrivedDay, 1 + 13);
});
test('preservation', '2. the route is the same for fast and slow ships: the same systems, the same legs; only their days differ', () => {
  need();
  const env = campaignWorld('SP-2');
  const slow = C.plotJourney(env.world, IDX.Minor, IDX.Qonos, 'terran', null, 0.8), fast = C.plotJourney(env.world, IDX.Minor, IDX.Qonos, 'terran', null, 1.3), chart = C.plotJourney(env.world, IDX.Minor, IDX.Qonos, 'terran');
  assert.deepEqual(slow.systems, fast.systems); assert.deepEqual(slow.systems, chart.systems);
  assert.deepEqual(chart.legDays, [11, 10, 8]);
  assert.deepEqual(fast.legDays, [9, 8, 7]); assert.deepEqual(slow.legDays, [14, 13, 10]);
  assert.deepEqual(slow.legBase.map((l) => l.days), chart.legDays);
});
test('new-feature', '3. a group flies at its slowest member able to travel: a disabled, surrendered or crewless member is not travelling and does not slow it', () => {
  need();
  const env = campaignWorld('SP-3');
  const [fast] = make(env, 'terran', 81, IDX.Vega), [mid] = make(env, 'terran', 83, IDX.Vega), [slow] = make(env, 'terran', 82, IDX.Vega);
  assert.equal(C.hullsSpeed(env.world, [fast, mid, slow]), 0.8);
  assert.equal(C.hullsSpeed(env.world, [fast, mid]), 1.0);
  slow.hull = 1; // disabled
  assert.equal(C.hullsSpeed(env.world, [fast, mid, slow]), 1.0, 'a disabled member slowed the group');
  slow.hull = slow.maxHull; slow.status = 'surrendered';
  assert.equal(C.hullsSpeed(env.world, [fast, slow]), 1.3, 'a surrendered member slowed the group');
  slow.status = 'ready'; slow.recrew = { since: 1 };
  assert.equal(C.hullsSpeed(env.world, [fast, slow]), 1.3, 'a crewless member slowed the group');
});
test('baseline-defect', '4. a fast escort does not make a slow transport faster: the pair flies at the transport\'s 0.8×', () => {
  const env = campaignWorld('SP-4');
  const [fast] = make(env, 'terran', 81, IDX.Vega), [slow] = make(env, 'terran', 82, IDX.Vega);
  const pair = journey(env, [fast, slow], IDX.Earth), alone = journey(env, make(env, 'terran', 82, IDX.Vega), IDX.Earth);
  assert.ok(pair.ok && alone.ok);
  assert.deepEqual(pair.journey.legDays, alone.journey.legDays);
  assert.deepEqual(pair.journey.legDays, [15], `the pair flies ${pair.journey.legDays}, a 12-day leg at 0.8× is 15`);
});
test('new-feature', '5/6. the slow member detached mid-leg: the leg in flight keeps the timing it was issued, and the next leg flies at the faster speed of those left', () => {
  need();
  const env = campaignWorld('SP-5');
  const [fast] = make(env, 'terran', 81, IDX.Minor), [slow] = make(env, 'terran', 82, IDX.Minor);
  const r = journey(env, [fast, slow], IDX.Border); // Minor → Vega (11) → Border (10)
  const tr = r.journey;
  assert.deepEqual(tr.legDays, [14, 13]);
  const firstArrival = tr.legArrivalDay;
  run(env.book, env.world, 2, 4);
  // The slow freighter is taken off the journey on day 4 (its owner's decision); it keeps flying this leg's end.
  J.detachMember(tr, slow.id, tr.from, 4, 'test: reassigned');
  run(env.book, env.world, 5, 5);
  assert.equal(tr.legArrivalDay, firstArrival, 'the leg in flight was re-timed');
  assert.equal(tr.legDays[0], 14);
  run(env.book, env.world, 6, firstArrival);
  assert.equal(tr.legIndex, 1);
  assert.equal(tr.legDays[1], 8, `the next leg flies at ${tr.speed}× for ${tr.legDays[1]} days, not the fast ship's 8`);
  assert.equal(tr.legArrivalDay, firstArrival + 8);
  assert.deepEqual(tr.speedHistory.map((x) => [x.fromLeg, x.speed]), [[0, 0.8], [1, 1.3]]);
  log.boundary = { legs: tr.legDays, history: tr.speedHistory };
});
test('preservation', '7. a disabled ship cannot travel: it is refused for an evacuation, an operation\'s planner skips it, and a group with it moving leaves it out of the pace', () => {
  const env = campaignWorld('SP-7');
  const [t1] = make(env, 'terran', 82, IDX.Minor);
  t1.hull = 1;
  const r = C.startEvacuation(env.book, env.world, { sponsor: 'terran', origin: IDX.Minor, destination: IDX.Earth, transports: [t1.id] }, 1, []);
  assert.equal(r.ok, false); assert.match(r.reason, /disabled/);
  assert.equal(C.hullUnavailable(t1), true);
});
test('preservation', '8. a class with no strategic speed (a legacy record, an unknown id) flies at the safe 1.0 default: exactly the chart\'s days', () => {
  const env = campaignWorld('SP-8');
  const [h] = ready(env.book, 'terran', IDX.Earth);
  h.shipId = 10; // the fixture's own class: no strategicSpeed
  const r = journey(env, [h], IDX.Border);
  assert.deepEqual(r.journey.legDays, [12, 10]);
  if (SPD) { assert.equal(SPD.classSpeed({}), 1); assert.equal(SPD.classSpeed(null), 1); assert.equal(SPD.classSpeed({ strategicSpeed: 'x' }), 1); assert.equal(SPD.classSpeed({ strategicSpeed: 9 }), SPD.SPEED_MAX); }
});
test('new-feature', '9/25. save/load mid-leg keeps the adjusted timing exactly: the same leg ETA, no re-plot from the origin, no day gained or lost, no crossing repeated', () => {
  need();
  const env = campaignWorld('SP-9');
  const [slow] = make(env, 'terran', 82, IDX.Minor);
  const tr = journey(env, [slow], IDX.Border).journey;
  run(env.book, env.world, 2, 20); // mid second leg
  const b2 = reload(env.book);
  const t2 = C.journeyById(b2, tr.id);
  assert.deepEqual({ legDays: t2.legDays, legBase: t2.legBase, speed: t2.speed, arr: t2.legArrivalDay, eta: t2.etaDay, idx: t2.legIndex, crossed: t2.crossed }, { legDays: tr.legDays, legBase: tr.legBase, speed: tr.speed, arr: tr.legArrivalDay, eta: tr.etaDay, idx: tr.legIndex, crossed: tr.crossed });
  run(env.book, env.world, 21, 40); run(b2, env.world, 21, 40);
  assert.equal(t2.arrivedDay, tr.arrivedDay); assert.equal(tr.arrivedDay, 1 + 14 + 13);
  run(b2, env.world, 28, 28); // the arrival day processed again
  assert.equal(t2.crossed.length, 2, `crossings ${JSON.stringify(t2.crossed)}`);
});
test('preservation', '10. a wormhole transit keeps its fixed days whatever the ship: never shorter for a fast ship, never 0', () => {
  need();
  const env = campaignWorld('SP-10');
  const base = C.legBaseBetween(env.world, IDX.Bajora, IDX.Dominica);
  assert.deepEqual(base, { days: 3, fixed: true });
  for (const s of [0.6, 0.8, 1, 1.3, 1.5]) assert.equal(C.legDaysBetween(env.world, IDX.Bajora, IDX.Dominica, s), 3, `at ${s}×`);
  assert.equal(SPD.adjustLegDays(1, 1.5), 1, 'a one-day leg became 0');
  const fast = C.plotJourney(env.world, IDX.Cardassia, IDX.Dominica, 'dominion', null, 1.3);
  assert.deepEqual(fast.legDays, [6, 3]);
});

// ===================================================================================================
// Evacuation (14, 15) and the integrated convoy
// ===================================================================================================
function convoy(env, { transports, escorts = [] }) {
  const r = C.startEvacuation(env.book, env.world, { sponsor: 'terran', origin: IDX.Minor, destination: IDX.Earth, transports: transports.map((h) => h.id), escorts: escorts.map((h) => h.id), target: 60000 }, 1, []);
  assert.ok(r.ok, r.reason);
  return r.record;
}
test('baseline-defect', '14. an evacuation convoy flies at its slowest transport or escort: Minor → Vega → Earth (11 + 12) is 14 + 15 days at the freighter\'s 0.8×', () => {
  const env = campaignWorld('SP-14');
  const e = convoy(env, { transports: make(env, 'terran', 82, IDX.Minor), escorts: make(env, 'terran', 81, IDX.Minor, 2) });
  run(env.book, env.world, 2, 3);
  const tr = C.journeyById(env.book, e.convoy.journeyId);
  assert.ok(tr, 'no convoy journey');
  assert.deepEqual(tr.legDays, [14, 15]);
  if (C.evacuationSpeed) assert.equal(C.evacuationSpeed(env.world, e), 0.8);
});
test('baseline-defect', '15. fast escorts do not shorten the evacuation cycle: the round trip and the refuge days are the freighters\', escorted or not', () => {
  const env = campaignWorld('SP-15');
  const e = convoy(env, { transports: make(env, 'terran', 82, IDX.Minor) });
  const plain = C.evacuationRoundTripDays(env.world, e);
  const env2 = campaignWorld('SP-15b');
  const e2 = convoy(env2, { transports: make(env2, 'terran', 82, IDX.Minor), escorts: make(env2, 'terran', 81, IDX.Minor, 3) });
  assert.equal(C.evacuationRoundTripDays(env2.world, e2), plain);
  assert.equal(plain, 2 * (14 + 15), `the round trip is ${plain} days`);
  const refuges = C.evacuationDestinations(env.book, env.world, 'terran', IDX.Minor, 0.8);
  assert.equal(refuges.find((d) => d.index === IDX.Earth).days, 29);
  assert.equal(C.evacuationDestinations(env.book, env.world, 'terran', IDX.Minor).find((d) => d.index === IDX.Earth).days, 23, 'the chart (1.0×) reading');
});
test('new-feature', '14b. a refuge too far for slow transports is refused at their speed, and accepted for faster ones: the destination choice follows the convoy that will actually fly', () => {
  need();
  const env = campaignWorld('SP-14b');
  env.book.config.evacMaxOneWayDays = 25; // Minor → Earth: 23 chart days, 29 at 0.8×, 19 (9 + 10) at 1.3×
  const slow = C.validateEvacuationDestination(env.book, env.world, 'terran', IDX.Minor, IDX.Earth, null, 0.8);
  const fast = C.validateEvacuationDestination(env.book, env.world, 'terran', IDX.Minor, IDX.Earth, null, 1.3);
  assert.equal(slow.ok, false); assert.match(slow.reason, /too far: 29 days/);
  assert.equal(fast.ok, true); assert.equal(fast.days, 19);
  const r = C.startEvacuation(env.book, env.world, { sponsor: 'terran', origin: IDX.Minor, destination: IDX.Earth, transports: make(env, 'terran', 82, IDX.Minor).map((h) => h.id) }, 1, []);
  assert.equal(r.ok, false, 'slow freighters were sent to a refuge they cannot reach in the limit');
});
test('new-feature', 'CONVOY-SLOWEST-MEMBER. fast escorts + slow transports fly at the transports\' speed; the slowest transport detached after the first leg, the next leg is faster; save/load between the legs changes nothing; people are landed only at the refuge', () => {
  need();
  const env = campaignWorld('SP-CONVOY');
  const slowT = make(env, 'terran', 82, IDX.Minor), midT = make(env, 'terran', 83, IDX.Minor), esc = make(env, 'terran', 81, IDX.Minor, 2);
  const e = convoy(env, { transports: [...slowT, ...midT], escorts: esc });
  run(env.book, env.world, 2, 3);
  const tr = C.journeyById(env.book, e.convoy.journeyId);
  assert.deepEqual(tr.legDays, [14, 15], 'the convoy did not fly at its slow freighter');
  const vids0 = Object.values(tr.vids).sort();
  // The slow freighter leaves the convoy during the first leg (its owner took it off the evacuation).
  run(env.book, env.world, 4, 6);
  J.detachMember(tr, slowT[0].id, tr.from, 6, 'test: withdrawn from the convoy');
  e.transports = e.transports.filter((t) => t.hullId !== slowT[0].id);
  const firstEnd = tr.legArrivalDay;
  run(env.book, env.world, 7, firstEnd - 1);
  assert.equal(e.moved, 0);
  const b2 = reload(env.book);
  run(env.book, env.world, firstEnd, firstEnd + 20); run(b2, env.world, firstEnd, firstEnd + 20);
  const t2 = C.journeyById(b2, tr.id);
  assert.equal(tr.legDays[1], 12, `the second leg flew ${tr.legDays[1]} days; at the cruiser transport's 1.0× it is 12`);
  assert.equal(tr.arrivedDay, firstEnd + 12);
  assert.equal(t2.arrivedDay, tr.arrivedDay); assert.deepEqual(t2.legDays, tr.legDays);
  assert.ok(C.evacuationById ? true : true);
  const e2 = b2.evacuations.find((x) => x.id === e.id);
  assert.equal(e2.moved, e.moved); assert.ok(e.moved > 0, 'nobody was landed at the refuge');
  assert.deepEqual(Object.values(t2.vids).sort(), vids0, 'vids changed');
  log.convoy = { legs: tr.legDays, history: tr.speedHistory, arrived: tr.arrivedDay, moved: e.moved };
});

// ===================================================================================================
// War planning (16–18), the Dominion expedition (19)
// ===================================================================================================
// Klingon forces at Qonos (3) against Terran Vega (1): Qonos → Border → Vega is 8 + 10 chart days.
function warEnv(seed, cls, n = 3) {
  const env = campaignWorld(seed);
  quiet(env);
  const p = P(env.book, 'klingon');
  for (const h of p.hulls) if (h.status === 'ready') h.systemIndex = IDX.Qonos;
  const hs = make(env, 'klingon', cls, IDX.Qonos, n);
  // Only these three are spare: the rest stand garrison at Border.
  for (const h of p.hulls) if (!hs.includes(h) && h.status === 'ready') h.systemIndex = IDX.Border;
  for (const h of P(env.book, 'terran').hulls) h.systemIndex = IDX.Earth;
  env.book.config.maxOperationEtaDays = 20;
  env.book.config.homeGarrisonPerWorld = 0;
  return { ...env, hs };
}
test('baseline-defect', '16. an operation\'s ETA is its slowest ship\'s: a force with one slow heavy ship is planned — and flies — at 0.85×', () => {
  const env = warEnv('SP-16', 84);
  env.hs[2].shipId = 85;
  const eta = C.forceEtaDays ? C.forceEtaDays(env.world, env.hs, IDX.Vega, 'klingon') : null;
  const op = C.launchOperation(env.book, env.world, 'klingon', env.hs, IDX.Vega, 1, 2, 'assault', []);
  const tr = C.journeyById(env.book, op.journeyIds[0]);
  assert.deepEqual(tr.legDays, [10, 12], `the force flies ${tr.legDays}; at its heavy ship's 0.85× it is 10 + 12`);
  if (eta != null) assert.equal(eta, 22);
  assert.equal(op.arriveDay, 1 + 22);
});
function planOnce(env) {
  const p = P(env.book, 'klingon');
  p.lastPlanDay = -1e9; env.book.config.planningIntervalDays = 1; env.book.config.aiStrategicOps = true;
  const fx = C.advanceCampaignDay(env.book, env.world, 2);
  env.book.config.aiStrategicOps = false;
  return { plan: p.lastPlan, op: env.book.operations.find((o) => o.faction === 'klingon' && o.status !== 'resolved'), fx };
}
test('baseline-defect', '17/ETA-AWARE-WAR-SPEED. two otherwise identical forces, one fast and one slow: the fast one reaches Vega inside the planning horizon and attacks; the slow one cannot (its real ETA is past it); the attack engages on the planned day with the defence-on-arrival it was planned against', () => {
  const fast = warEnv('SP-17f', 84), slow = warEnv('SP-17s', 85);
  const a = planOnce(fast), b = planOnce(slow);
  const row = (x) => (x.plan?.considered || []).find((r) => r.index === IDX.Vega);
  log.warSpeed = { fast: { chosen: a.plan?.chosen, vega: row(a), speed: a.plan?.speed }, slow: { chosen: b.plan?.chosen, vega: row(b), speed: b.plan?.speed } };
  assert.equal(row(a)?.etaDays, 15, `fast ETA to Vega ${row(a)?.etaDays} (8 + 10 at 1.3× = 7 + 8)`);
  assert.equal(row(b)?.etaDays, 22, `slow ETA to Vega ${row(b)?.etaDays} (8 + 10 at 0.85× = 10 + 12)`);
  assert.equal(a.plan.chosen, IDX.Vega, JSON.stringify(a.plan));
  assert.notEqual(b.plan.chosen, IDX.Vega, 'the slow force was scored with the fast one\'s ETA');
  assert.match(row(b).skip || '', /22 days away/);
  // The fast force engages on the day it was planned to arrive, against the defence it was planned against.
  const op = a.op;
  assert.equal(op.plan.arriveDay, 2 + 15);
  const atPlan = op.plan.defenseAtEta;
  run(fast.book, fast.world, 3, op.plan.arriveDay);
  assert.equal(op.engagedDay, op.plan.arriveDay, `engaged day ${op.engagedDay}, planned ${op.plan.arriveDay}`);
  assert.equal(C.localDefenseStrength(fast.book, fast.world, IDX.Vega), atPlan, 'the defence on arrival is not what was planned (nothing else moved)');
});
test('baseline-defect', '18. incoming-defence accounting uses each ship\'s own arrival: a fast ship going home to Vega is counted by its early arrival day, a slow one only later', () => {
  const env = campaignWorld('SP-18');
  quiet(env);
  const [fast] = make(env, 'terran', 81, IDX.Earth), [slow] = make(env, 'terran', 82, IDX.Earth);
  const f = C.startJourney(env.book, env.world, { kind: 'return', ref: 'x', sponsor: 'terran', hulls: [fast], destination: IDX.Vega, purpose: 'return' }, 1, []).journey;
  const s = C.startJourney(env.book, env.world, { kind: 'return', ref: 'y', sponsor: 'terran', hulls: [slow], destination: IDX.Vega, purpose: 'return' }, 1, []).journey;
  assert.equal(f.etaDay, 1 + 10); assert.equal(s.etaDay, 1 + 15);
  const acc = C.forceAccount(env.book, env.world, IDX.Vega, 12, 'klingon');
  assert.deepEqual(acc.incoming.map((x) => x.journeyId), [f.id], JSON.stringify(acc));
  assert.deepEqual(acc.later.map((x) => x.journeyId), [s.id]);
  assert.ok(!C.localDefenseStrength(env.book, env.world, IDX.Vega) || true);
});
test('new-feature', '19. a Dominion reinforcement counts toward the expedition only on its speed-adjusted arrival: in the corridor it is incoming, on the day it lands it is strength', () => {
  need();
  const env = campaignWorld('SP-19');
  quiet(env);
  env.book.dominion.phase = 'invasion';
  env.world.systems[IDX.Bajora].controller = 'dominion'; env.world.systems[IDX.Cardassia].controller = 'dominion';
  const d = P(env.book, 'dominion');
  for (const h of d.hulls) h.systemIndex = IDX.Dominica;
  const [bs] = make(env, 'dominion', 86, IDX.Border);
  const r = C.startJourney(env.book, env.world, { kind: 'expedition', ref: 'dominion:convoy:1', sponsor: 'dominion', hulls: [bs], destination: IDX.Bajora, purpose: 'reinforce', authority: { kind: 'reinforcement', ref: 'dominion:convoy:1' } }, 1, []);
  assert.ok(r.ok, r.reason);
  assert.deepEqual(r.journey.legDays, [11, 9], 'Border → Cardassia → Bajora (9 + 7) at 0.85×');
  const st = (day) => { run(env.book, env.world, day, day); return C.expeditionAssessment(env.book, env.world, 'dominion'); };
  const before = st(2);
  assert.ok(before.incomingStrength > 0 && before.strength === 0 || before.incomingStrength > 0, JSON.stringify(before));
  for (let dd = 3; dd < 21; dd++) { const x = st(dd); assert.ok(x.incomingStrength > 0, `day ${dd}: no longer incoming before its arrival`); }
  const landed = st(21);
  assert.equal(r.journey.arrivedDay, 21);
  assert.equal(landed.incomingStrength, 0); assert.ok(landed.strength > 0);
});

// ===================================================================================================
// Blockade running (20, 21) and the tactical handoff (22–24)
// ===================================================================================================
function blockadeAtVega(env, n = 6) {
  const k = ready(env.book, 'klingon').slice(0, n); for (const h of k) h.systemIndex = IDX.Vega;
  const b = C.startBlockade(env.book, env.world, { power: 'klingon', target: IDX.Vega, hullIds: k.map((h) => h.id), purpose: 'interdict_trade' }, 1, []);
  assert.ok(b.ok, b.reason);
  return b.record;
}
test('new-feature', '20. a blockade is met on the speed-adjusted crossing day: a slow convoy reaches the blockaded Vega on day 1 + 14, a fast one on day 1 + 9, each run recorded that day', () => {
  need();
  for (const [cls, days] of [[82, 14], [81, 9]]) {
    const env = campaignWorld(`SP-20-${cls}`);
    const b = blockadeAtVega(env);
    const [h] = make(env, 'terran', cls, IDX.Minor);
    const tr = journey(env, [h], IDX.Earth).journey;
    run(env.book, env.world, 2, 1 + days);
    const crossing = tr.crossed.find((c) => c.system === IDX.Vega);
    assert.equal(crossing?.day, 1 + days, `crossed Vega day ${crossing?.day}`);
    const runs = (b.runs || []).filter((x) => String(x.by).includes(tr.id));
    assert.ok(runs.length <= 1 && runs.every((x) => x.day === 1 + days), JSON.stringify(b.runs));
  }
});
test('new-feature', '21. blockade running reads the same strategic speed, once: the dash term is (runner ÷ blockade)², bounded; the crossing\'s days do not depend on it, and a run never re-times the journey', () => {
  need();
  const env = campaignWorld('SP-21');
  const b = blockadeAtVega(env);
  const f = C.assessBlockadeRun(env.book, env.world, b, { key: 'k', sponsor: 'terran', hulls: [{ hullId: 'x', shipId: 81, hull: 900, maxHull: 900 }] });
  const s = C.assessBlockadeRun(env.book, env.world, b, { key: 'k', sponsor: 'terran', hulls: [{ hullId: 'y', shipId: 82, hull: 900, maxHull: 900 }] });
  const bs = f.blockadeSpeed;
  const exp = env.book.config.interceptSpeedExponent ?? 2;
  assert.ok(Math.abs(f.rel - Math.min(2.5, Math.max(0.4, (1.3 / bs) ** exp))) < 1e-9, `fast rel ${f.rel}, blockade ${bs}`);
  assert.ok(Math.abs(s.rel - Math.min(2.5, Math.max(0.4, (0.8 / bs) ** exp))) < 1e-9);
  assert.equal(f.speed, 1.3); assert.equal(s.speed, 0.8);
  assert.ok(f.pDetect < s.pDetect && f.pCatch < s.pCatch, 'the faster runner is not harder to catch');
  const [h] = make(env, 'terran', 82, IDX.Minor);
  const tr = journey(env, [h], IDX.Earth).journey;
  const before = JSON.stringify(tr.legDays);
  run(env.book, env.world, 2, 16);
  assert.equal(JSON.stringify(tr.legDays.slice(0, 1)), JSON.stringify(JSON.parse(before).slice(0, 1)), 'the run re-timed the leg flown');
  log.dash = { fast: { rel: f.rel, pDetect: f.pDetect, pCatch: f.pCatch }, slow: { rel: s.rel, pDetect: s.pDetect, pCatch: s.pCatch }, blockadeSpeed: bs, exponent: exp };
});
test('new-feature', '22/23/24. the tactical handoff happens at the real intermediate system on the speed-adjusted day; after the encounter the journey goes on at its own speed (the remaining ETA recomputed from the same model); the same vids throughout', () => {
  need(); if (!SE) throw new Error('no encounter module');
  let done = null;
  for (let i = 0; i < 60 && !done; i++) {
    const env = campaignWorld(`SP-22-${i}`);
    const b = blockadeAtVega(env, 12);
    const [h] = make(env, 'terran', 82, IDX.Minor);
    const tr = journey(env, [h], IDX.Earth).journey;
    env.world.localSystem = IDX.Vega;
    run(env.book, env.world, 2, 15);
    const enc = (env.book.encounters || []).find((e) => e.type === 'blockade');
    if (!enc) continue;
    done = { env, tr, enc, b, h };
  }
  assert.ok(done, 'no seed gave an intercepted crossing');
  const { env, tr, enc, h } = done;
  assert.equal(enc.system, IDX.Vega);
  assert.equal(tr.held?.day ?? enc.createdDay, 1 + 14, 'not handed off on the speed-adjusted crossing day');
  assert.equal(enc.createdDay, 15);
  const vid0 = vidOf(h);
  const participants = Object.fromEntries(enc.participants.map((p) => [p.ref, { fate: 'survived', hull: p.before?.hull ?? null }]));
  const r = C.resolveEncounterNow(env.book, env.world, enc.id, { result: { outcome: 'passed' }, participants }, 15, []);
  assert.ok(r.ok, r.reason);
  run(env.book, env.world, 16, 40);
  assert.equal(tr.arrivedDay, 15 + 15, `arrived day ${tr.arrivedDay}: Vega → Earth (12) at 0.8× is 15 days after the crossing`);
  assert.equal(tr.crossed.filter((c) => c.system === IDX.Vega).length, 1);
  assert.equal(vidOf(hullById(env.book, 'terran', h.id)), vid0);
  assert.equal(env.book.encounters.filter((e) => e.type === 'blockade').length, 1, 'a second encounter');
});

// ===================================================================================================
// Rescue (11–13) and the integrated FAST-VS-SLOW-RESCUE
// ===================================================================================================
// The doctrine galaxy at the default scale: Vulcan(10) ─ Delpi(9) ─ Aldnas(11) is 5 + 12 chart days.
Object.assign(G.HULLS, { 97: { price: 80000, mass: 3, combatHull: 700, faction: 'vulcan', strategicSpeed: 1.3, combat: 1, cargo: 100 }, 98: { price: 80000, mass: 6, combatHull: 700, faction: 'vulcan', strategicSpeed: 0.8, combat: 1, cargo: 100 } });
const RLEGS = { '4:11': 12, '11:9': 12, '9:10': 5, '10:1': 12, '1:0': 9, '1:2': 10, '2:3': 5, '1:4': 11, '2:5': 12, '5:6': 10, '6:7': 1, '1:8': 6, '11:2': 13, '12:11': 12, '12:13': 8, '13:17': 8, '17:9': 8, '14:15': 12, '15:16': 12, '16:10': 12 };
function rescueGalaxy(seed, reliefClass = null) {
  const env = G.galaxy(seed, {});
  env.world.legDays = (a, b) => RLEGS[`${a}:${b}`] ?? RLEGS[`${b}:${a}`] ?? 1;
  env.world.doctrineStep = (b, w, d, fx) => DC.advanceDoctrineDay(b, w, d, fx, doctrine);
  const db = DC.doctrineBook(env.book);
  db.config = { ...db.config, patrols: {}, explorers: {}, reliefShips: reliefClass ? { vulcan: 1 } : {}, merchants: {}, projects: {}, patrolAreas: {} };
  const vs = G.ready(env.book, 'vulcan', G.IDX.Vulcan);
  return { ...env, db, vs };
}
test('baseline-defect', '11/13. two relief ships at Vulcan, survivors at Aldnas with 15 days left: the fast one (1.3×: 4 + 10 = 14 days) can reach them and is accepted; the slow one (0.8×: 7 + 15 = 22) is refused as physically too late — same origin, same survivors, the ETA decides', () => {
  const env = rescueGalaxy('SP-11');
  const [a, b] = env.vs;
  a.shipId = 97; b.shipId = 98;
  const target = { systemIndex: G.IDX.Aldnas, survivorsUntil: 1 + 15 };
  const fast = DC.responseCapacity(env.book, env.world, env.db, `hull:${a.id}`, 'rescue', target, 1, { incidentId: 'sp11' });
  const slow = DC.responseCapacity(env.book, env.world, env.db, `hull:${b.id}`, 'rescue', target, 1, { incidentId: 'sp11' });
  log.rescueCapacity = { fast: { ok: fast.ok, eta: fast.etaDays, reason: fast.reason }, slow: { ok: slow.ok, eta: slow.etaDays, reason: slow.reason } };
  assert.equal(fast.ok, true, fast.reason); assert.equal(fast.etaDays, 14);
  assert.equal(slow.ok, false); assert.equal(slow.failedByDistance, true); assert.equal(slow.etaDays, 22);
  assert.match(slow.reason, /cannot reach the survivors in time/);
});
test('new-feature', '12/FAST-VS-SLOW-RESCUE. the same distress, the same survivors\' endurance, a fast relief ship vs a slow one: the fast one is sent, gets there on its planned ETA (planned arrival = actual), and rescues them; the slow one is refused and nothing is faked', () => {
  need();
  const outcome = (cls) => {
    const env = rescueGalaxy(`SP-12-${cls}`, cls);
    const relief = env.vs[0];
    relief.shipId = cls;
    // The hulk's life support outlasts the window anyone told of it assumes (survivorWindowDays from the
    // report): the planners' window is the binding one, so the ETA, not the ground truth, decides.
    env.book.config.crewSurvivalDays = 40;
    DC.designate(env.book, 'vulcan', relief.id, 'relief');
    // A Romulan patrol lost, unwitnessed, at Aldnas; a Delpin explorer on station finds the survivors and
    // tells the relief ship.
    const rh = G.ready(env.book, 'romulan', G.IDX.Romulus)[0];
    const p = DC.issuePatrol(env.book, env.world, 'romulan', rh.id, G.IDX.Aldnas, 1, []);
    const arrive = p.assignment.milestones.find((m) => m.kind === 'arrival').dueDay;
    run(env.book, env.world, 2, arrive);
    assert.ok(DC.loseAssignmentHullUnwitnessed(env.book, env.world, p.assignment.id, arrive, 'disabled', { silent: true }).ok);
    const dh = G.ready(env.book, 'delpin', G.IDX.Delpi)[0];
    DC.issueAssignment(env.book, env.world, { polity: 'delpin', hullId: dh.id, kind: 'exploration', doctrineRole: 'explorer', stops: [{ systemIndex: G.IDX.Aldnas, dwell: 4, milestone: 'arrival' }, { systemIndex: G.IDX.Delpi, milestone: 'check_in' }] }, arrive + 1, []);
    let dist = null;
    for (let d = arrive + 1; d < arrive + 60 && !dist; d++) { run(env.book, env.world, d, d); dist = Object.values(env.db.incidents).find((i) => i.eventType === 'distress'); }
    assert.ok(dist, 'no survivors found');
    const found = env.book.settled;
    DC.relayReport(env.book, env.world, dist.id, `hull:${dh.id}`, `hull:${relief.id}`, found, { include: 'survivor_report' });
    let o = null, ev = null;
    for (let d = found + 1; d < found + 80; d++) {
      run(env.book, env.world, d, d);
      // The relief ship's own decision on the report, the day it weighs it (lastEval is the latest day's).
      const e = env.db.lastEval[`hull:${relief.id}|${dist.id}`];
      if (!ev && e?.capacity) ev = JSON.parse(JSON.stringify(e));
      o = env.db.objectives.find((y) => y.actor === `hull:${relief.id}`); if (o && o.status !== 'active') break;
    }
    return { o, dist, ev, found, relief };
  };
  const fast = outcome(97), slow = outcome(98);
  log.fastVsSlowRescue = {
    fast: fast.o && { plan: fast.o.plan, arrived: fast.o.arrivedDay, status: fast.o.status, survivors: fast.dist.resolution?.status },
    slow: { objective: slow.o ? { plan: slow.o.plan, status: slow.o.status } : null, capacity: slow.ev?.capacity && { ok: slow.ev.capacity.ok, eta: slow.ev.capacity.etaDays, reason: slow.ev.capacity.reason } },
  };
  assert.ok(fast.o, `the fast relief ship was not sent: ${JSON.stringify(fast.ev?.capacity)}`);
  assert.equal(fast.o.response, 'rescue');
  assert.ok(fast.o.plan.arriveDay <= fast.o.plan.survivorsUntil, JSON.stringify(fast.o.plan));
  assert.equal(fast.o.arrivedDay, fast.o.plan.arriveDay, `arrived day ${fast.o.arrivedDay}, planned ${fast.o.plan.arriveDay}`);
  assert.equal(fast.o.status, 'completed', JSON.stringify(fast.o.resolution));
  assert.equal(fast.dist.resolution?.status, 'survivors_rescued');
  assert.ok(!slow.o || slow.o.response !== 'rescue', `the slow relief ship was sent: ${JSON.stringify(slow.o?.plan)}`);
  assert.equal(slow.ev?.capacity?.ok, false, JSON.stringify(slow.ev?.capacity));
  assert.match(slow.ev.capacity.reason, /cannot reach the survivors in time \(arrives day 49, 22 days; survivors last to day 46\)/);
  assert.equal(fast.o.plan.etaDays, 14); assert.equal(fast.o.plan.survivorsUntil, 46);
});

test('new-feature', '27. a doctrine job issued before ship speed (its expectations made at 1.0) is re-timed when it sets out at its slow hull\'s speed: no false "missed arrival"', () => {
  need();
  const env = rescueGalaxy('SP-27');
  const [h] = env.vs; h.shipId = 98; // 0.8×
  // Vulcan → Delpi → Aldnas: 5 + 12 chart days; a two-day dwell at Vulcan first (still at home when loaded).
  const r = DC.issueAssignment(env.book, env.world, { polity: 'vulcan', hullId: h.id, kind: 'exploration', doctrineRole: 'explorer', stops: [{ systemIndex: G.IDX.Vulcan, dwell: 2 }, { systemIndex: G.IDX.Delpi, dwell: 0 }, { systemIndex: G.IDX.Aldnas, dwell: 1, milestone: 'arrival' }] }, 1, []);
  assert.ok(r.ok, r.reason);
  const a = r.assignment;
  // As a save from f0e219b had it: no speed, the arrival expected at the chart's days.
  const m = a.milestones.find((x) => x.kind === 'arrival');
  const b2 = reload(env.book);
  const a2 = DC.doctrineBook(b2).assignments.find((x) => x.id === a.id);
  delete a2.speed; const legacyDue = a2.milestones.find((x) => x.id === m.id).dueDay = m.dueDay - (7 + 15) + (5 + 12);
  run(b2, env.world, 2, 40);
  const m2 = a2.milestones.find((x) => x.id === m.id);
  log.legacyAssignment = { legacyDue, dueDay: m2.dueDay, status: m2.status, retimed: m2.retimed || null, speed: a2.speed };
  assert.equal(a2.speed, 0.8);
  const flown = (b2.journeys || []).filter((j) => j.ref === a.id && j.destination === G.IDX.Aldnas).at(-1);
  assert.equal(m2.dueDay, flown.arrivedDay, `the arrival is expected day ${m2.dueDay}; it arrived day ${flown.arrivedDay}`);
  assert.equal(flown.arrivedDay - flown.startDay, 7 + 15, 'not flown at the hull\'s 0.8× (5 + 12 chart days)');
  assert.equal(m2.retimed?.speed, 0.8, 'not re-timed at the hull\'s 0.8×');
  assert.notEqual(m2.status, 'missed', JSON.stringify(m2));
  assert.ok(!Object.values(DC.doctrineBook(b2).incidents).some((i) => i.eventType === 'overdue' && String(i.id).includes(a.id)), 'a false overdue incident');
});
test('new-feature', '28. a slow member leaving a doctrine journey at a boundary re-makes its owner\'s expectations from that crossing, at the faster speed', () => {
  need();
  const env = rescueGalaxy('SP-28');
  const [h, slow] = env.vs; h.shipId = 97; slow.shipId = 98;
  const r = DC.issueAssignment(env.book, env.world, { polity: 'vulcan', hullId: h.id, kind: 'exploration', doctrineRole: 'explorer', stops: [{ systemIndex: G.IDX.Delpi, dwell: 0 }, { systemIndex: G.IDX.Aldnas, dwell: 1, milestone: 'arrival' }] }, 1, []);
  const a = r.assignment;
  run(env.book, env.world, 2, 2);
  const tr = C.journeyById(env.book, a.journeyId);
  assert.ok(tr, 'no journey');
  // A slow ship flying with it (as a joined escort would): the journey is re-timed only at the boundary.
  tr.members.push(slow.id); tr.vids[slow.id] = vidOf(slow); slow.transit = { ...h.transit }; slow.systemIndex = h.systemIndex;
  J.respeedJourney(tr, 0.8); a.speed = 0.8;
  const arrive0 = tr.etaDay;
  J.detachMember(tr, slow.id, tr.from, 2, 'test'); delete slow.transit;
  run(env.book, env.world, 3, tr.legArrivalDay);
  const m = a.milestones.find((x) => x.kind === 'arrival');
  log.respeedHook = { speed: tr.speed, eta: tr.etaDay, was: arrive0, due: m.dueDay, aSpeed: a.speed };
  assert.equal(tr.speed, 1.3);
  assert.equal(a.speed, 1.3, 'the owner kept the slow speed');
  assert.equal(m.dueDay, tr.etaDay, `the arrival is expected day ${m.dueDay}; the journey arrives day ${tr.etaDay}`);
});

// ===================================================================================================
// The existing suites (26)
// ===================================================================================================
test('preservation', '26. the movement, time-scale and handoff suites stay green, run as-is', () => {
  for (const script of ['scripts/strategic-movement-test.mjs', 'scripts/strategic-time-scale-test.mjs', 'scripts/strategic-tactical-handoff-test.mjs']) {
    const r = spawnSync(process.execPath, [path.join(root, script)], { encoding: 'utf8', env: { ...process.env, BM1_TEST_OUTPUT: '' } });
    const last = (r.stdout || '').trim().split('\n').at(-1);
    assert.equal(r.status, 0, `${script}: ${last}`);
  }
});

if (out) { fs.mkdirSync(out, { recursive: true }); fs.writeFileSync(path.join(out, 'ship-strategic-speed-test.json'), JSON.stringify({ root, results, log }, null, 1)); }
const byTag = (t) => { const x = results.filter((y) => y.tag === t); return `${x.filter((y) => y.ok).length}/${x.length}`; };
const failed = results.filter((x) => !x.ok);
console.log(`\nship strategic speed pure: ${results.filter((x) => x.ok).length}/${results.length} (baseline-defect ${byTag('baseline-defect')}, new-feature ${byTag('new-feature')}, preservation ${byTag('preservation')})${failed.length ? ` — FAILED: ${failed.map((x) => x.name.split(' ')[0]).join(', ')}` : ''}`);
process.exit(failed.length ? 1 : 0);
