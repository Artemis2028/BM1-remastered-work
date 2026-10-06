// Pure regressions for the rated round of SHIP-DEPENDENT-STRATEGIC-SPEED (docs/movement/SHIP-DEPENDENT-STRATEGIC-SPEED.md):
// every class carries the approved BM1 Strategic Speed Rater rating (1–10) and its multiplier, and every journey and
// planner reads the same model — legDays = max(1, ceil(base / multiplier)), wormholes fixed. The fixture classes
// below are REAL catalogue classes, carrying the rating bm-ships/ships.json gives them. Checks are tagged:
//   [baseline-defect] reproduces 7d3ce43 (category speeds, legs rounded to nearest; fails on its own assertion there);
//   [new-feature]     behaviour this round adds;
//   [preservation]    behaviour that must be unchanged (passes on both).
// Tests 3 and 22/23 read the catalogue's classes, so on 7d3ce43 (category speeds) they fail on their own assertion.
// BM1_RATING_ROOT points the suite at another tree (the baseline reproduction runs it against 7d3ce43).
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(process.env.BM1_RATING_ROOT || path.join(here, '..'));
const imp = (rel) => import(pathToFileURL(path.join(root, rel)).href);
const C = await imp('src/campaign-strategy.mjs');
const J = await imp('src/strategic-journey.mjs');
const SPD = await imp('src/strategic-speed.mjs');
const D = await imp('src/doctrine-runtime.mjs');
const DC = await imp('src/doctrine-campaign.mjs');
const { makeWorld, run } = await import(pathToFileURL(path.join(root, 'scripts/campaign-world-fixture.mjs')).href);
const G = await import(pathToFileURL(path.join(root, 'scripts/doctrine-galaxy-fixture.mjs')).href);
const read = (f) => JSON.parse(fs.readFileSync(path.join(root, f), 'utf8'));
const CATALOGUE = read('bm-ships/ships.json').ships;
const doctrine = D.loadDoctrine(read('docs/doctrine/bm1-faction-doctrine.v0.2.1.json'), read('docs/doctrine/bm1-faction-doctrine.schema.json'));
const out = process.env.BM1_TEST_OUTPUT || null;

const results = [];
const log = {};
const test = (tag, name, fn) => {
  try { fn(); results.push({ tag, name, ok: true }); console.log('PASS', `[${tag}]`, name); }
  catch (e) { results.push({ tag, name, ok: false, error: String(e?.message || e).split('\n')[0] }); console.log('FAIL', `[${tag}]`, name, '\n      ', String(e?.stack || e).split('\n').slice(0, 7).join('\n       ')); }
};
const sum = (a) => a.reduce((n, d) => n + d, 0);
const ceilDays = (base, m) => Math.max(1, Math.ceil(base / m - 1e-9));
// The approved rating → multiplier table, as the brief gives it (the runtime's must equal it: test 0).
const MULT = Object.freeze({ 1: 0.70, 1.5: 0.74, 2: 0.78, 2.5: 0.82, 3: 0.85, 3.5: 0.89, 4: 0.92, 4.5: 0.96, 5: 1.00, 5.5: 1.04, 6: 1.08, 6.5: 1.12, 7: 1.16, 7.5: 1.20, 8: 1.24, 8.5: 1.28, 9: 1.32, 9.5: 1.36, 10: 1.40 });
const mult = (r) => MULT[r];

// ---- real catalogue classes with their approved ratings ----
const byName = (n) => { const s = CATALOGUE.find((x) => x.name === n); assert.ok(s, `no class ${n}`); return s; };
const CLS = {
  intrepid: byName('Intrepid Explorer'),       // 10/10 · 1.40
  galaxy: byName('Galaxy Class'),              // 8.5   · 1.28
  peregrin: byName('Peregrin Fighter'),        // 5     · 1.00
  danube: byName('Danube Utility Runabout'),   // 3     · 0.85
  sailor: byName('Bajoran Solar Sailor'),      // 1     · 0.70
  isaac: byName('Tholian Isaac Freighter'),    // 4     · 0.92
  vorcha: byName("Vor'cha Attack Cruiser"),    // 8.5   · 1.28
  dombs: byName('Dominion Battleship'),        // 7     · 1.16
};
// The fixture world sees each class with its catalogue rating; the fighting numbers are kept equal so only speed differs.
const SHIPS = {};
for (const s of Object.values(CLS)) SHIPS[s.id] = { price: 90000, mass: Number(s.mass) || 4, combatHull: 900, faction: s.faction, cargo: 500, combat: 1, strategicSpeedRating: s.strategicSpeedRating, strategicSpeed: s.strategicSpeed };
// Two Klingon war classes of identical fighting value, rated 8.5 and 3 (synthetic ids; the ratings are table values).
SHIPS[901] = { price: 110000, mass: 6, combatHull: 950, faction: 'klingon', cargo: 0, combat: 1, strategicSpeedRating: 8.5, strategicSpeed: mult(8.5) };
SHIPS[902] = { price: 110000, mass: 6, combatHull: 950, faction: 'klingon', cargo: 0, combat: 1, strategicSpeedRating: 3, strategicSpeed: mult(3) };

// Earth(0) ─ Vega(1) ─ Border(2) ─ Qonos(3);  Vega ─ Romulus(4);  Border ─ Cardassia(5) ─ Bajora(6) ⇄ Dominica(7);  Vega ─ Minor(8).
const LEGS = { '0:1': 12, '1:2': 10, '2:3': 8, '1:4': 12, '2:5': 9, '5:6': 7, '6:7': 3, '1:8': 11 };
const legDays = (a, b) => LEGS[`${a}:${b}`] ?? LEGS[`${b}:${a}`] ?? 1;
const IDX = { Earth: 0, Vega: 1, Border: 2, Qonos: 3, Romulus: 4, Cardassia: 5, Bajora: 6, Dominica: 7, Minor: 8 };
function campaignWorld(seed, opts = {}) {
  const { world, relations } = makeWorld(opts);
  world.legDays = legDays;
  const base = world.shipStats;
  world.shipStats = (id) => SHIPS[id] || (base(id) ? { cargo: 100, combat: 1, ...base(id) } : null);
  const book = C.createCampaignBook(seed, 1);
  C.initializeCampaign(book, world);
  book.config.aiStrategicOps = false; book.config.planningIntervalDays = 1e9; book.config.aiRecovery = false;
  for (const p of Object.values(book.polities)) p.lastPlanDay = 1e12;
  return { world, book, relations };
}
const P = (book, id) => C.getPolity(book, id);
const vidOf = (h) => h?.identity?.vid || h?.vid || h?.id;
const reload = (book) => C.upgradeCampaignBook(JSON.parse(JSON.stringify(book)));
const made = new WeakSet();
function make(env, polity, cls, at, n = 1) {
  const id = typeof cls === 'number' ? cls : cls.id;
  const hs = P(env.book, polity).hulls.filter((h) => h.status === 'ready' && !h.opId && !made.has(h)).sort((a, b) => String(a.id).localeCompare(String(b.id))).slice(0, n);
  assert.equal(hs.length, n, `not ${n} free ${polity} hulls`);
  for (const h of hs) { made.add(h); h.shipId = id; h.systemIndex = at; h.maxHull = h.hull = SHIPS[id]?.combatHull ?? h.maxHull; }
  return hs;
}
C.registerJourneyKind('speed-test', { keep(book, tr, h) { return h.leaveAt == null || Number(h.leaveAt) !== Number(h.systemIndex); } });
const go = (env, polity, hulls, destination, day = 1) => C.startJourney(env.book, env.world, { kind: 'speed-test', ref: `t:${hulls.map((h) => h.id).join('+')}`, sponsor: polity, hulls, destination, purpose: 'move' }, day, []);

// ===================================================================================================
// 0. The data: the approved ratings, exactly as the rater gives them, with their provenance
// ===================================================================================================
test('baseline-defect', '0. every catalogue class carries its approved rating, multiplier, confidence and basis; the anchors are the rater\'s (Intrepid/Prometheus/Constitution III/Inquiry 10, Sovereign 9.5, Galaxy/Defiant/Vor\'cha 8.5, D\'deridex/Marauder 7.5, Galor 6.5, Nova 6, Danube 3, NX 2, Solar Sailor 1)', () => {
  const anchors = { 'Intrepid Explorer': 10, 'Prometheus Tactical Cruiser': 10, 'Constitution III Class': 10, 'Inquiry Class': 10, 'Sovereign Class': 9.5, 'Sovereign Command Cruiser': 9.5, 'Galaxy Class': 8.5, 'Galaxy Command Variant': 8.5, 'Defiant Escort': 8.5, "Vor'cha Attack Cruiser": 8.5, "D'deridex Warbird": 7.5, 'Ferengi Marauder Refit': 7.5, 'Galor Cruiser': 6.5, 'Nova Surveyor': 6, 'Danube Utility Runabout': 3, 'NX Class': 2, 'Bajoran Solar Sailor': 1 };
  for (const [n, r] of Object.entries(anchors)) { const s = byName(n); assert.equal(s.strategicSpeedRating, r, n); assert.equal(s.strategicSpeed, mult(r), n); assert.equal(s.strategicSpeedBasis, 'rater:table', n); }
  for (const s of CATALOGUE) {
    assert.ok(s.strategicSpeedRating >= 1 && s.strategicSpeedRating <= 10 && (s.strategicSpeedRating * 2) % 1 === 0, `${s.name} rating ${s.strategicSpeedRating}`);
    assert.equal(s.strategicSpeed, MULT[s.strategicSpeedRating], s.name);
    assert.ok(['high', 'medium', 'low'].includes(s.strategicSpeedConfidence), s.name);
    assert.ok(/^rater:(table|fallback)/.test(s.strategicSpeedBasis), s.name);
    assert.ok(typeof s.strategicSpeedNote === 'string' && s.strategicSpeedNote.length > 0, s.name);
  }
  assert.deepEqual({ ...(SPD.RATING_MULTIPLIER || {}) }, { ...MULT }, 'the runtime multiplier table is not the approved one');
  log.counts = CATALOGUE.reduce((m, s) => { const k = `${s.strategicSpeedBasis}/${s.strategicSpeedConfidence}`; m[k] = (m[k] || 0) + 1; return m; }, {});
});

// ===================================================================================================
// 1–8, 21–24: the model
// ===================================================================================================
test('baseline-defect', '1. a 10/10 ship (Intrepid) completes the same route faster than a 5/10 ship (Peregrin): Minor → Vega → Border (11 + 10) is 8 + 8 days at 1.40×, 11 + 10 at 1.00×', () => {
  const env = campaignWorld('SR-1');
  const [a] = make(env, 'terran', CLS.intrepid, IDX.Minor), [b] = make(env, 'terran', CLS.peregrin, IDX.Minor);
  const fa = go(env, 'terran', [a], IDX.Border).journey, fb = go(env, 'terran', [b], IDX.Border).journey;
  assert.deepEqual(fa.legDays, [8, 8]); assert.deepEqual(fb.legDays, [11, 10]);
  run(env.book, env.world, 2, 30);
  assert.equal(fa.arrivedDay, 1 + 16); assert.equal(fb.arrivedDay, 1 + 21);
});
test('new-feature', '2. a 1/10 ship (the Bajoran Solar Sailor) is slower than the 5/10 on the same route: 16 + 15 days at 0.70×', () => {
  const env = campaignWorld('SR-2');
  const [a] = make(env, 'terran', CLS.sailor, IDX.Minor), [b] = make(env, 'terran', CLS.peregrin, IDX.Minor);
  const fa = go(env, 'terran', [a], IDX.Border).journey, fb = go(env, 'terran', [b], IDX.Border).journey;
  assert.deepEqual(fa.legDays, [16, 15]); assert.ok(fa.etaDay > fb.etaDay);
});
test('baseline-defect', '3. a 5/10 ship reproduces the chart\'s baseline timing exactly (the same days a ship-independent journey took), and so does a class with no rating', () => {
  const env = campaignWorld('SR-3');
  const [a] = make(env, 'terran', CLS.peregrin, IDX.Earth);
  const chart = C.plotJourney(env.world, IDX.Earth, IDX.Qonos, 'terran');
  assert.deepEqual(go(env, 'terran', [a], IDX.Qonos).journey.legDays, chart.legBase.map((l) => l.days));
  assert.deepEqual(chart.legDays, [12, 10, 8]);
  assert.equal(SPD.classSpeed({}), 1); assert.equal(SPD.classRating({}), 5);
});
test('new-feature', '4. the planning ETA is exactly the actual arrival, for every rating on the table (the planner and the journey read one function)', () => {
  for (const r of Object.keys(MULT).map(Number)) {
    const env = campaignWorld(`SR-4-${r}`);
    SHIPS[990] = { ...SHIPS[CLS.peregrin.id], strategicSpeedRating: r, strategicSpeed: mult(r) };
    const [h] = make(env, 'terran', 990, IDX.Minor);
    const planned = C.plannedJourneyDays(env.world, IDX.Minor, IDX.Qonos, 'terran', C.hullSpeed(env.world, h));
    const tr = go(env, 'terran', [h], IDX.Qonos).journey;
    run(env.book, env.world, 2, 60);
    assert.equal(tr.arrivedDay - 1, planned, `rating ${r}: planned ${planned}, flew ${tr.arrivedDay - 1}`);
    assert.equal(tr.plannedEtaDay, tr.arrivedDay);
  }
});
test('baseline-defect', '5/6. a formation flies at its slowest member, and a faster escort never speeds a convoy: Intrepid + Galaxy + Danube fly at the Danube\'s 0.85×; the Danube alone flies the same days', () => {
  const env = campaignWorld('SR-5');
  const [a] = make(env, 'terran', CLS.intrepid, IDX.Vega), [b] = make(env, 'terran', CLS.galaxy, IDX.Vega), [c] = make(env, 'terran', CLS.danube, IDX.Vega), [c2] = make(env, 'terran', CLS.danube, IDX.Vega);
  assert.equal(C.hullsSpeed(env.world, [a, b, c]), 0.85);
  const group = go(env, 'terran', [a, b, c], IDX.Earth).journey, alone = go(env, 'terran', [c2], IDX.Earth).journey;
  assert.deepEqual(group.legDays, alone.legDays); assert.deepEqual(group.legDays, [ceilDays(12, 0.85)]);
});
test('new-feature', '7/8. the slowest member leaving at a system boundary speeds the later legs; the slowest lost mid-leg never re-times the leg in flight, only the legs after it', () => {
  const env = campaignWorld('SR-7');
  const [fast] = make(env, 'terran', CLS.galaxy, IDX.Minor), [slow] = make(env, 'terran', CLS.isaac, IDX.Minor);
  slow.leaveAt = IDX.Vega; // it stays at Vega when the formation gets there
  const tr = go(env, 'terran', [fast, slow], IDX.Border).journey;
  assert.deepEqual(tr.legDays, [12, 11]); // 0.92×: 11 → 12, 10 → 11
  const arrive1 = tr.legArrivalDay;
  run(env.book, env.world, 2, 5);
  // A ship ordered elsewhere while the leg is flown: the leg's arrival is unchanged.
  assert.equal(tr.legArrivalDay, arrive1);
  run(env.book, env.world, 6, 40);
  assert.equal(slow.systemIndex, IDX.Vega); assert.equal(fast.systemIndex, IDX.Border);
  assert.deepEqual(tr.legDays, [12, 8], `the next leg flies at the Galaxy's 1.28×: ${tr.legDays}`);
  assert.equal(tr.arrivedDay, 1 + 12 + 8);
  assert.deepEqual(tr.speedHistory.map((x) => [x.fromLeg, x.speed]), [[0, 0.92], [1, 1.28]]);
  log.slowestFormation = { legs: tr.legDays, history: tr.speedHistory, planned: tr.plannedEtaDay, arrived: tr.arrivedDay };
  // Mid-leg: the slow hull is destroyed while the first leg is flown. The leg in flight keeps its days and its
  // arrival; only the next leg (from the boundary) flies at the survivor's pace.
  const env2 = campaignWorld('SR-8');
  const [f2] = make(env2, 'terran', CLS.galaxy, IDX.Minor), [s2] = make(env2, 'terran', CLS.isaac, IDX.Minor);
  const t2 = go(env2, 'terran', [f2, s2], IDX.Border).journey;
  assert.deepEqual(t2.legDays, [12, 11]);
  const a2 = t2.legArrivalDay;
  run(env2.book, env2.world, 2, 4);
  s2.status = 'lost'; s2.hull = 0; // lost on day 4, mid-leg
  run(env2.book, env2.world, 5, 8);
  assert.equal(t2.legIndex, 0, 'still on the first leg');
  assert.equal(t2.legArrivalDay, a2, `the leg in flight was re-timed: due day ${a2}, now ${t2.legArrivalDay}`);
  assert.equal(t2.legDays[0], 12, 'the first leg\'s days changed mid-leg');
  run(env2.book, env2.world, 9, 40);
  assert.equal(t2.arrivedDay, 1 + 12 + 8, `arrived day ${t2.arrivedDay}: the first leg as issued (12), the next at the Galaxy's 1.28× (8)`);
  assert.deepEqual(t2.legDays, [12, 8]);
  log.midLegLoss = { legs: t2.legDays, history: t2.speedHistory, arrived: t2.arrivedDay };
});
test('new-feature', '21. save/load mid-leg keeps the adjusted arrival exactly', () => {
  const env = campaignWorld('SR-21');
  const [h] = make(env, 'terran', CLS.danube, IDX.Minor);
  const tr = go(env, 'terran', [h], IDX.Border).journey;
  run(env.book, env.world, 2, 8);
  const b2 = reload(env.book);
  const t2 = C.journeyById(b2, tr.id);
  assert.deepEqual([t2.legDays, t2.legArrivalDay, t2.etaDay, t2.speed], [tr.legDays, tr.legArrivalDay, tr.etaDay, tr.speed]);
  run(env.book, env.world, 9, 40); run(b2, env.world, 9, 40);
  assert.equal(t2.arrivedDay, tr.arrivedDay); assert.equal(tr.arrivedDay, 1 + ceilDays(11, 0.85) + ceilDays(10, 0.85));
});
test('new-feature', '22/23. a disabled, surrendered or crew-awaiting hull never sets a pace, and every vid is unchanged by the rated movement', () => {
  const env = campaignWorld('SR-22');
  const [fast] = make(env, 'terran', CLS.intrepid, IDX.Vega), [slow] = make(env, 'terran', CLS.sailor, IDX.Vega);
  const vids = [vidOf(fast), vidOf(slow)];
  slow.hull = 1; assert.equal(C.hullsSpeed(env.world, [fast, slow]), 1.4);
  slow.hull = slow.maxHull; slow.status = 'surrendered'; assert.equal(C.hullsSpeed(env.world, [fast, slow]), 1.4);
  slow.status = 'ready'; slow.recrew = { since: 1 }; assert.equal(C.hullsSpeed(env.world, [fast, slow]), 1.4);
  delete slow.recrew;
  go(env, 'terran', [fast, slow], IDX.Earth); run(env.book, env.world, 2, 30);
  assert.deepEqual([vidOf(fast), vidOf(slow)], vids);
});
test('preservation', '24. a wormhole transit keeps its fixed days for every rating, 1 to 10', () => {
  const env = campaignWorld('SR-24');
  for (const r of [1, 3, 5, 8.5, 10]) assert.equal(C.legDaysBetween(env.world, IDX.Bajora, IDX.Dominica, mult(r)), 3);
  assert.equal(SPD.adjustLegDays(1, 1.4), 1);
});

// ===================================================================================================
// 9–13, 15, 18, 19: planners and crossings
// ===================================================================================================
test('baseline-defect', '9. the evacuation ETA and cycle are the slowest transport\'s (escorts cannot hurry it): Danube transports with Intrepid escorts, Minor → Earth', () => {
  const env = campaignWorld('SR-9');
  const r = C.startEvacuation(env.book, env.world, { sponsor: 'terran', origin: IDX.Minor, destination: IDX.Earth, transports: make(env, 'terran', CLS.danube, IDX.Minor).map((h) => h.id), escorts: make(env, 'terran', CLS.intrepid, IDX.Minor, 2).map((h) => h.id), target: 60000 }, 1, []);
  assert.ok(r.ok, r.reason);
  assert.equal(C.evacuationSpeed(env.world, r.record), 0.85);
  assert.equal(C.evacuationRoundTripDays(env.world, r.record), 2 * (ceilDays(11, 0.85) + ceilDays(12, 0.85)));
});
function warEnv(seed, cls) {
  const env = campaignWorld(seed);
  const p = P(env.book, 'klingon');
  for (const h of p.hulls) if (h.status === 'ready') h.systemIndex = IDX.Qonos;
  const hs = make(env, 'klingon', cls, IDX.Qonos, 3);
  for (const h of p.hulls) if (!hs.includes(h) && h.status === 'ready') h.systemIndex = IDX.Border;
  for (const h of P(env.book, 'terran').hulls) h.systemIndex = IDX.Earth;
  env.book.config.maxOperationEtaDays = 20; env.book.config.homeGarrisonPerWorld = 0;
  return { ...env, hs };
}
function planOnce(env) {
  const p = P(env.book, 'klingon');
  p.lastPlanDay = -1e9; env.book.config.planningIntervalDays = 1; env.book.config.aiStrategicOps = true;
  C.advanceCampaignDay(env.book, env.world, 2);
  env.book.config.aiStrategicOps = false;
  return { plan: p.lastPlan, op: env.book.operations.find((o) => o.faction === 'klingon' && o.status !== 'resolved') };
}
test('baseline-defect', '11/SPEED-WAR-PLANNING. two equally strong Klingon forces rated 8.5 and 3: the fast one\'s real ETA to Vega (7 + 8 = 15) is inside the 20-day horizon and it attacks, the slow one\'s (10 + 12 = 22) is not; the fast attack engages on its planned day against the defence it was planned against', () => {
  const a = planOnce(warEnv('SR-11f', 901)), b = planOnce(warEnv('SR-11s', 902));
  const row = (x) => (x.plan?.considered || []).find((r) => r.index === IDX.Vega);
  log.warPlanning = { fast: { eta: row(a)?.etaDays, chosen: a.plan?.chosen }, slow: { eta: row(b)?.etaDays, chosen: b.plan?.chosen, skip: row(b)?.skip } };
  assert.equal(row(a)?.etaDays, 15); assert.equal(row(b)?.etaDays, 22);
  assert.equal(a.plan.chosen, IDX.Vega); assert.notEqual(b.plan.chosen, IDX.Vega);
  assert.equal(a.op.plan.arriveDay, 2 + 15);
});
test('new-feature', '12. incoming-defence accounting counts each ship on its own adjusted arrival: an Intrepid going home to Vega is incoming by day 10, a Solar Sailor only after', () => {
  const env = campaignWorld('SR-12');
  const [f] = make(env, 'terran', CLS.intrepid, IDX.Earth), [s] = make(env, 'terran', CLS.sailor, IDX.Earth);
  const ft = C.startJourney(env.book, env.world, { kind: 'return', ref: 'x', sponsor: 'terran', hulls: [f], destination: IDX.Vega, purpose: 'return' }, 1, []).journey;
  const st = C.startJourney(env.book, env.world, { kind: 'return', ref: 'y', sponsor: 'terran', hulls: [s], destination: IDX.Vega, purpose: 'return' }, 1, []).journey;
  assert.equal(ft.etaDay, 1 + 9); assert.equal(st.etaDay, 1 + 18);
  const acc = C.forceAccount(env.book, env.world, IDX.Vega, 12, 'klingon');
  assert.deepEqual(acc.incoming.map((x) => x.journeyId), [ft.id]); assert.deepEqual(acc.later.map((x) => x.journeyId), [st.id]);
});
test('new-feature', '13. a Dominion reinforcement (Dominion Battleship, 7/10) counts toward the expedition only from its speed-adjusted arrival', () => {
  const env = campaignWorld('SR-13');
  env.book.dominion.phase = 'invasion';
  // No scheduled wormhole convoys: only the reinforcement under test is ever in the corridor.
  env.book.dominion.convoys = env.book.config.dominionMaxConvoys;
  env.world.systems[IDX.Bajora].controller = 'dominion'; env.world.systems[IDX.Cardassia].controller = 'dominion';
  for (const h of P(env.book, 'dominion').hulls) h.systemIndex = IDX.Dominica;
  const [bs] = make(env, 'dominion', CLS.dombs, IDX.Border);
  const r = C.startJourney(env.book, env.world, { kind: 'expedition', ref: 'dominion:convoy:1', sponsor: 'dominion', hulls: [bs], destination: IDX.Bajora, purpose: 'reinforce', authority: { kind: 'reinforcement', ref: 'dominion:convoy:1' } }, 1, []);
  const days = ceilDays(9, 1.16) + ceilDays(7, 1.16);
  assert.deepEqual(r.journey.legDays, [ceilDays(9, 1.16), ceilDays(7, 1.16)]);
  const st = (d) => { run(env.book, env.world, d, d); return C.expeditionAssessment(env.book, env.world, 'dominion'); };
  for (let d = 2; d < 1 + days; d++) assert.ok(st(d).incomingStrength > 0, `day ${d}: no longer incoming before its arrival`);
  const landed = st(1 + days);
  assert.equal(r.journey.arrivedDay, 1 + days); assert.equal(landed.incomingStrength, 0); assert.ok(landed.strength > 0);
});
test('new-feature', '19. a blockade is met on the speed-adjusted crossing day: a Danube reaches the blockaded Vega on day 1 + 13, an Intrepid on day 1 + 8', () => {
  for (const [cls, days] of [[CLS.danube, ceilDays(11, 0.85)], [CLS.intrepid, ceilDays(11, 1.4)]]) {
    const env = campaignWorld(`SR-19-${cls.id}`);
    const k = P(env.book, 'klingon').hulls.filter((h) => h.status === 'ready').slice(0, 6); for (const h of k) h.systemIndex = IDX.Vega;
    const b = C.startBlockade(env.book, env.world, { power: 'klingon', target: IDX.Vega, hullIds: k.map((h) => h.id), purpose: 'interdict_trade' }, 1, []);
    assert.ok(b.ok, b.reason);
    const [h] = make(env, 'terran', cls, IDX.Minor);
    const tr = go(env, 'terran', [h], IDX.Earth).journey;
    run(env.book, env.world, 2, 1 + days);
    assert.equal(tr.crossed.find((c) => c.system === IDX.Vega)?.day, 1 + days);
  }
});
test('new-feature', '18. treaty routing still holds under rated speeds: a DMZ on Border refuses a 10/10 Vega → Qonos (no lawful way round), and the lawful Vega → Romulus flies at 1.40×', () => {
  const env = campaignWorld('SR-18');
  const ok = C.addTreatyTerm ? C.addTreatyTerm(env.book, env.world, { type: 'dmz', parties: ['terran', 'klingon'], systems: [IDX.Border] }, 1, []) : { ok: false };
  if (!ok.ok) throw new Error('no treaty terms in this tree');
  // Romulus — Qonos is no route in this fixture: the only way is through Border, so the destination is refused.
  const [h] = make(env, 'terran', CLS.intrepid, IDX.Vega);
  const r = go(env, 'terran', [h], IDX.Qonos);
  assert.equal(r.ok, false); assert.equal(r.treaty, true);
  const r2 = go(env, 'terran', [h], IDX.Romulus);
  assert.deepEqual(r2.journey.legDays, [ceilDays(12, 1.4)]);
});
// ---- rescue (10) and SPEED-RESCUE ----
Object.assign(G.HULLS, { [CLS.intrepid.id]: { price: 80000, mass: 4, combatHull: 700, faction: 'vulcan', strategicSpeedRating: 10, strategicSpeed: 1.4, combat: 1, cargo: 100 }, [CLS.danube.id]: { price: 80000, mass: 1, combatHull: 700, faction: 'vulcan', strategicSpeedRating: 3, strategicSpeed: 0.85, combat: 1, cargo: 100 } });
const RLEGS = { '4:11': 12, '11:9': 12, '9:10': 5, '10:1': 12, '1:0': 9, '1:2': 10, '2:3': 5, '1:4': 11, '2:5': 12, '5:6': 10, '6:7': 1, '1:8': 6, '11:2': 13, '12:11': 12, '12:13': 8, '13:17': 8, '17:9': 8, '14:15': 12, '15:16': 12, '16:10': 12 };
function rescueGalaxy(seed, relief = false) {
  const env = G.galaxy(seed, {});
  env.world.legDays = (a, b) => RLEGS[`${a}:${b}`] ?? RLEGS[`${b}:${a}`] ?? 1;
  env.world.doctrineStep = (b, w, d, fx) => DC.advanceDoctrineDay(b, w, d, fx, doctrine);
  const db = DC.doctrineBook(env.book);
  db.config = { ...db.config, patrols: {}, explorers: {}, reliefShips: relief ? { vulcan: 1 } : {}, merchants: {}, projects: {}, patrolAreas: {} };
  return { ...env, db, vs: G.ready(env.book, 'vulcan', G.IDX.Vulcan) };
}
test('baseline-defect', '10. rescue feasibility follows the relief hull: survivors at Aldnas with 15 days left — an Intrepid (4 + 9 = 13 days) is accepted, a Danube (6 + 15 = 21) refused as too late', () => {
  const env = rescueGalaxy('SR-10');
  const [a, b] = env.vs; a.shipId = CLS.intrepid.id; b.shipId = CLS.danube.id;
  const target = { systemIndex: G.IDX.Aldnas, survivorsUntil: 1 + 15 };
  const fast = DC.responseCapacity(env.book, env.world, env.db, `hull:${a.id}`, 'rescue', target, 1, { incidentId: 'sr10' });
  const slow = DC.responseCapacity(env.book, env.world, env.db, `hull:${b.id}`, 'rescue', target, 1, { incidentId: 'sr10' });
  assert.equal(fast.ok, true, fast.reason); assert.equal(fast.etaDays, 13);
  assert.equal(slow.ok, false); assert.equal(slow.failedByDistance, true); assert.equal(slow.etaDays, 21);
});
test('new-feature', 'SPEED-RESCUE. the same distress, the same origin, two relief hulls: the Danube misses the survivors\' window and is not sent; the Intrepid is sent, arrives on its planned day (planner = journey) and rescues them', () => {
  const outcome = (cls) => {
    const env = rescueGalaxy(`SR-RESCUE-${cls}`, true);
    const relief = env.vs[0]; relief.shipId = cls;
    env.book.config.crewSurvivalDays = 40;
    DC.designate(env.book, 'vulcan', relief.id, 'relief');
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
      const e = env.db.lastEval[`hull:${relief.id}|${dist.id}`];
      if (!ev && e?.capacity) ev = JSON.parse(JSON.stringify(e));
      o = env.db.objectives.find((y) => y.actor === `hull:${relief.id}`); if (o && o.status !== 'active') break;
    }
    return { o, dist, ev };
  };
  const fast = outcome(CLS.intrepid.id), slow = outcome(CLS.danube.id);
  log.speedRescue = { fast: fast.o && { plan: fast.o.plan, arrived: fast.o.arrivedDay, status: fast.o.status }, slow: slow.ev?.capacity && { ok: slow.ev.capacity.ok, eta: slow.ev.capacity.etaDays, reason: slow.ev.capacity.reason } };
  assert.ok(fast.o && fast.o.response === 'rescue', JSON.stringify(fast.ev?.capacity));
  assert.equal(fast.o.arrivedDay, fast.o.plan.arriveDay);
  assert.equal(fast.o.status, 'completed'); assert.equal(fast.dist.resolution?.status, 'survivors_rescued');
  assert.ok(!slow.o || slow.o.response !== 'rescue'); assert.equal(slow.ev?.capacity?.ok, false);
  assert.match(slow.ev.capacity.reason, /cannot reach the survivors in time/);
});
test('new-feature', '15. a patrol\'s cadence follows its hull: the same patrol order for a 10/10 and a 3/10 Vulcan ship — its arrival is due on the rated days, and each flies to that schedule', () => {
  const due = (cls) => {
    const env = rescueGalaxy(`SR-15-${cls}`);
    const [h] = env.vs; h.shipId = cls;
    const p = DC.issuePatrol(env.book, env.world, 'vulcan', h.id, G.IDX.Aldnas, 1, []);
    assert.ok(p.ok, p.reason);
    const m = p.assignment.milestones.find((x) => x.kind === 'arrival');
    run(env.book, env.world, 2, m.dueDay + 2);
    return { due: m.dueDay, status: m.status, metDay: m.metDay, speed: p.assignment.speed };
  };
  const f = due(CLS.intrepid.id), s = due(CLS.danube.id);
  log.patrolCadence = { fast: f, slow: s };
  assert.equal(f.speed, 1.4); assert.equal(s.speed, 0.85);
  assert.ok(f.due < s.due, `fast due ${f.due}, slow due ${s.due}`);
  assert.equal(f.status, 'met'); assert.equal(s.status, 'met'); assert.equal(f.metDay, f.due); assert.equal(s.metDay, s.due);
});

// ===================================================================================================
// 25. No planner reads the old ship-independent timing
// ===================================================================================================
test('preservation', '25. no planner reads raw chart days: the model takes a leg\'s length only through legBaseBetween (then the one speed function), and the engine reads Fleet.travelDays only for the chart\'s base legs', () => {
  const cs = fs.readFileSync(path.join(root, 'src/campaign-strategy.mjs'), 'utf8');
  const dc = fs.readFileSync(path.join(root, 'src/doctrine-campaign.mjs'), 'utf8');
  const main = fs.readFileSync(path.join(root, 'src/main.js'), 'utf8');
  const legDaysCalls = [...cs.matchAll(/world\.legDays\??\.?\(/g)].length + [...dc.matchAll(/world\.legDays\??\.?\(/g)].length;
  assert.ok(legDaysCalls <= 1, `${legDaysCalls} direct reads of the chart's leg days`);
  const travelDays = main.split('\n').map((l, i) => [i + 1, l]).filter(([, l]) => /Fleet\.travelDays\(/.test(l));
  const allowed = travelDays.filter(([, l]) => /function routeLegBase|const d = Math\.max\(1, Fleet\.travelDays\(getRouteWarpDistance\(r\)\)\)|travelDays: Fleet\.travelDays\(distance\)|\|\| Fleet\.travelDays\(plan\?\.distance/.test(l));
  assert.equal(travelDays.length, allowed.length, `chart days read raw at lines ${travelDays.filter((x) => !allowed.includes(x)).map(([n]) => n).join(', ')}`);
});

const by = (tag) => results.filter((r) => r.tag === tag);
const fmt = (tag) => `${tag} ${by(tag).filter((r) => r.ok).length}/${by(tag).length}`;
// ---- the design doc's per-hull table (Appendix A) is the catalogue's, with each rating's confidence and provenance ----
test('new-feature', 'DOC-TABLE the design doc\'s per-hull table equals the catalogue: every class with its rating, multiplier, confidence, provenance and the rater\'s basis', () => {
  const T = path.join(root, 'scripts/strategic-speed-table.mjs');
  assert.ok(fs.existsSync(T), 'no table generator');
  const doc = fs.readFileSync(path.join(root, 'docs/movement/SHIP-DEPENDENT-STRATEGIC-SPEED.md'), 'utf8');
  for (const s of CATALOGUE) {
    assert.ok(s.strategicSpeedConfidence && s.strategicSpeedBasis && s.strategicSpeedNote, `class ${s.id} has no provenance`);
    assert.ok(doc.includes(`| ${s.id} | ${s.name.replace(/\|/g, '\\|')} |`), `class ${s.id} ${s.name} is not in the doc's table`);
  }
});
// (The generator exists from this round on; a tree without it — the baseline — has no table to compare. A tree
// with it must import it.)
const TABLE = fs.existsSync(path.join(root, 'scripts/strategic-speed-table.mjs')) ? await import(pathToFileURL(path.join(root, 'scripts/strategic-speed-table.mjs')).href) : null;
if (TABLE) test('new-feature', 'DOC-TABLE-EXACT the generated block in the doc is byte-for-byte what the catalogue generates', () => {
  assert.equal(TABLE.docBlock(fs.readFileSync(path.join(root, 'docs/movement/SHIP-DEPENDENT-STRATEGIC-SPEED.md'), 'utf8')), TABLE.tableBlock(CATALOGUE));
});

test('new-feature', 'RATER-EXACT every class carries exactly what the approved rater recommends for it — rating, confidence and basis — run through the rater\'s own code; the runtime manifest carries the same', () => {
  const A = path.join(root, 'scripts/assign-strategic-speed.mjs');
  const html = path.join(root, 'docs/movement/sources/BM1-strategic-speed-rater.html');
  assert.ok(fs.existsSync(html), 'the approved rater is not in the tree');
  const src = fs.readFileSync(html, 'utf8');
  // The rater's own recommendation code, run as the rater runs it (not the assignment script's copy of the logic).
  const R = vm.runInNewContext(`${src.slice(src.indexOf('const multiplierByRating'), src.indexOf('let ships=[]'))}\n;({ multiplierByRating, OV, recommendation });`, {});
  for (const [k, v] of Object.entries(R.multiplierByRating)) { assert.equal(MULT[k], v, `brief's multiplier for ${k}`); assert.equal(SPD.RATING_MULTIPLIER?.[k], v, `runtime multiplier for ${k}`); }
  const off = [];
  for (const s of CATALOGUE) {
    const rec = R.recommendation(s);
    const basis = Object.prototype.hasOwnProperty.call(R.OV, s.name) ? 'rater:table' : s.rosterState === 'retired' ? 'rater:fallback (retired)' : 'rater:fallback';
    if (Number(rec.score) !== s.strategicSpeedRating || rec.confidence !== s.strategicSpeedConfidence || basis !== s.strategicSpeedBasis || rec.basis !== s.strategicSpeedNote || mult(rec.score) !== s.strategicSpeed) off.push(`${s.id} ${s.name}: rater ${rec.score}/${rec.confidence}/${basis}, catalogue ${s.strategicSpeedRating}/${s.strategicSpeedConfidence}/${s.strategicSpeedBasis}`);
  }
  assert.deepEqual(off, [], off.slice(0, 5).join('; '));
  assert.ok(fs.existsSync(A), 'no assignment script');
  const manifest = read('data/starship_manifest.json');
  const mships = manifest.ships || manifest;
  const keys = ['strategicSpeedRating', 'strategicSpeed', 'strategicSpeedConfidence', 'strategicSpeedBasis', 'strategicSpeedNote'];
  const moff = CATALOGUE.filter((s) => { const m = mships.find((x) => x.id === s.id); return !m || keys.some((k) => m[k] !== s[k]); }).map((s) => `${s.id} ${s.name}`);
  assert.deepEqual(moff, [], `the manifest differs from ships.json for ${moff.slice(0, 5).join(', ')}`);
});

const failed = results.filter((r) => !r.ok);
console.log(`strategic speed ratings pure: ${results.length - failed.length}/${results.length} (${['baseline-defect', 'new-feature', 'preservation'].map(fmt).join(', ')})${failed.length ? ` — FAILED: ${failed.map((f) => f.name.split(' ')[0]).join(', ')}` : ''}`);
if (out) { fs.mkdirSync(out, { recursive: true }); fs.writeFileSync(path.join(out, 'strategic-speed-rating-pure.json'), JSON.stringify({ root, results, log }, null, 1)); }
process.exit(failed.length ? 1 : 0);
