// Pure regressions for TOWING-SALVAGE-RECOVERY (docs/movement/TOWING-SALVAGE-RECOVERY.md): a disabled hull
// is physically recovered by a real recovery-capable vessel that flies out to it, takes it in tow and flies
// it — slower — to a yard, through the shared journey engine; or it stays where it lies. Checks are tagged:
//   [baseline-defect] reproduces 78cd8fa, where a hulk away from an own yard is never recovered (fails on its
//                     own assertion there, or because the tree has no towing at all);
//   [new-feature]     behaviour this round adds;
//   [preservation]    behaviour that must be unchanged.
// BM1_TOW_ROOT points the suite at another tree's src/ (the baseline reproduction runs it against 78cd8fa).
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(process.env.BM1_TOW_ROOT || path.join(here, '..'));
const imp = (rel) => import(pathToFileURL(path.join(root, rel)).href);
const C = await imp('src/campaign-strategy.mjs');
const J = await imp('src/strategic-journey.mjs');
let REC = null; try { REC = await imp('src/strategic-recovery.mjs'); } catch { REC = null; }
const { makeWorld, run } = await import(pathToFileURL(path.join(root, 'scripts/campaign-world-fixture.mjs')).href);
const out = process.env.BM1_TEST_OUTPUT || null;

const results = [];
const log = {};
const test = (tag, name, fn) => {
  try { fn(); results.push({ tag, name, ok: true }); console.log('PASS', `[${tag}]`, name); }
  catch (e) { results.push({ tag, name, ok: false, error: String(e?.message || e).split('\n')[0] }); console.log('FAIL', `[${tag}]`, name, '\n      ', String(e?.stack || e).split('\n').slice(0, 7).join('\n       ')); }
};
const need = () => { if (!REC || !C.requestHullRecovery) throw new Error('this tree has no towing: a hulk away from an own yard is never recovered'); };
const sum = (a) => a.reduce((n, d) => n + d, 0);

// ---- the fixture galaxy (campaign-world-fixture) at the default game's leg scale ----
// Earth(0, yards) ─ Vega(1, yard) ─ Border(2, Klingon) ─ Qonos(3); Vega ─ Romulus(4); Border ─ Cardassia(5) ─ Bajora(6) ⇄ Dominica(7) (wormhole); Vega ─ Minor(8, no yard).
const LEGS = { '0:1': 12, '1:2': 10, '2:3': 8, '1:4': 12, '2:5': 9, '5:6': 7, '6:7': 3, '1:8': 11 };
const legDays = (a, b) => LEGS[`${a}:${b}`] ?? LEGS[`${b}:${a}`] ?? 1;
const IDX = { Earth: 0, Vega: 1, Border: 2, Qonos: 3, Romulus: 4, Cardassia: 5, Bajora: 6, Dominica: 7, Minor: 8 };
// Classes as bm-ships/ships.json gives them to the engine: an explicit recoveryCapacity and strategicSpeed.
const SHIPS = {
  90: { price: 60000, mass: 3, combatHull: 700, faction: 'terran', strategicSpeed: 0.8, recoveryCapacity: 8, combat: 0.3, cargo: 200 },   // utility tug
  91: { price: 90000, mass: 5, combatHull: 900, faction: 'terran', strategicSpeed: 1.0, recoveryCapacity: 3, combat: 1, cargo: 0 },     // cruiser
  92: { price: 30000, mass: 1, combatHull: 200, faction: 'terran', strategicSpeed: 1.3, recoveryCapacity: 0, combat: 0.5, cargo: 0 },   // scout
  93: { price: 70000, mass: 2, combatHull: 600, faction: 'terran', strategicSpeed: 1.2, recoveryCapacity: 1, combat: 1, cargo: 0 },     // fast escort
  94: { price: 260000, mass: 9, combatHull: 1800, faction: 'terran', strategicSpeed: 0.85, recoveryCapacity: 6, combat: 1, cargo: 0 },  // battleship
  95: { price: 80000, mass: 2, combatHull: 500, faction: 'terran', strategicSpeed: 1.2, recoveryCapacity: 1, combat: 1, cargo: 0 },     // light escort (a hulk)
  96: { price: 90000, mass: 3, combatHull: 800, faction: 'terran', strategicSpeed: 0.8, recoveryCapacity: 10, combat: 0.3, cargo: 300 }, // heavy tug
  97: { price: 160000, mass: 5, combatHull: 1000, faction: 'klingon', strategicSpeed: 1.0, recoveryCapacity: 3, combat: 1, cargo: 0 },  // Klingon cruiser (a hulk)
  98: { price: 90000, mass: 3, combatHull: 700, faction: 'klingon', strategicSpeed: 0.8, recoveryCapacity: 8, combat: 0.3, cargo: 200 }, // Klingon tug
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
  book.config.aiRecovery = false;
  for (const p of Object.values(book.polities)) p.lastPlanDay = 1e12;
  return { world, book, relations };
}
const P = (book, id) => C.getPolity(book, id);
const reload = (book) => C.upgradeCampaignBook(JSON.parse(JSON.stringify(book)));
const vidOf = (h) => h?.identity?.vid || h?.vid || h?.id;
const madeHulls = new WeakSet();
function make(env, polity, shipId, at, n = 1) {
  const hs = P(env.book, polity).hulls.filter((h) => h.status === 'ready' && !h.opId && !madeHulls.has(h)).sort((a, b) => String(a.id).localeCompare(String(b.id))).slice(0, n);
  assert.equal(hs.length, n, `not ${n} free ${polity} hulls`);
  for (const h of hs) { madeHulls.add(h); h.shipId = shipId; h.systemIndex = at; h.maxHull = h.hull = SHIPS[shipId]?.combatHull ?? h.maxHull; }
  return hs;
}
// Every other hull of every power out of the way (at home, ready), so nothing else interferes.
function park(env) { for (const [pid, p] of Object.entries(env.book.polities)) for (const h of p.hulls) if (!madeHulls.has(h) && h.status !== 'lost') { const home = env.world.systems.find((s) => s.controller === pid); if (home) h.systemIndex = home.index; } }
// Disable a hull where it is and let the day strand it, exactly as a battle does.
function disable(env, h, day) {
  h.hull = Math.max(1, Math.floor(h.maxHull * 0.05)); h.status = 'repairing';
  C.advanceStranded(env.book, env.world, day, []);
  assert.ok(h.stranded, 'not stranded');
}
const recById = (book, id) => (book.hullRecoveries || []).find((r) => r.id === id);
const allHullIds = (book) => [...Object.values(book.polities).flatMap((p) => p.hulls.filter((h) => h.status !== 'lost').map((h) => h.id)), ...(book.derelicts || []).map((d) => d.id)];
function towScenario(seed, { hulk = 95, tug = 90, escorts = [], hulkAt = IDX.Minor, tugAt = IDX.Earth, polity = 'terran', crew = 'aboard' } = {}) {
  const env = campaignWorld(seed);
  const [t] = make(env, polity, tug, tugAt);
  const esc = escorts.map((cls) => make(env, polity, cls, tugAt)[0]);
  const [h] = make(env, polity, hulk, hulkAt);
  park(env);
  disable(env, h, 1);
  if (crew === 'rescued') C.rescueStrandedCrew(env.book, polity, h.id, 1, 'test relief');
  if (crew === 'lost') { h.stranded.crew = 'lost'; h.stranded.crewEndDay = 1; h.crew = 0; }
  return { ...env, t, esc, h };
}
const request = (env, spec, day = 1) => C.requestHullRecovery(env.book, env.world, { sponsor: 'terran', targetHullId: env.h.id, tugHullId: env.t.id, escortHullIds: env.esc.map((e) => e.id), ...spec }, day, []);

// ===================================================================================================
// The stranded hulk and the outbound tug (1–4)
// ===================================================================================================
test('preservation', '1. a disabled hull with no recovery stays exactly where it was disabled: 60 days pass, it is still at Minor, still awaiting recovery, never repaired', () => {
  const env = towScenario('TW-1');
  run(env.book, env.world, 2, 60);
  assert.equal(env.h.systemIndex, IDX.Minor); assert.equal(env.h.stranded.recovery, 'awaiting_recovery');
  assert.ok(C.hullIsDisabled(env.h));
});
test('baseline-defect', 'BEFORE/AFTER. a Terran hulk at Minor (no yard there), a Terran tug free at the Earth yard, the AI allowed to act, 200 days: the hulk must be brought in by a real tow (on 78cd8fa it lies at Minor for ever — recoverStrandedHull refuses where there is no own yard)', () => {
  const env = campaignWorld('TW-0');
  env.book.config.aiRecovery = true;
  const [h] = make(env, 'terran', 94, IDX.Minor);
  make(env, 'terran', 96, IDX.Earth);
  park(env);
  h.hull = Math.max(1, Math.floor(h.maxHull * 0.05)); h.status = 'repairing';
  C.advanceStranded(env.book, env.world, 1, []);
  const direct = C.recoverStrandedHull(env.book, env.world, 'terran', h.id, 1);
  assert.equal(direct.ok, false, 'a hulk away from a yard was recovered without a tow');
  run(env.book, env.world, 2, 200);
  log.beforeAfter = { at: h.systemIndex, recovery: h.stranded?.recovery ?? null, disabled: C.hullIsDisabled(h), missions: (env.book.hullRecoveries || []).map((r) => [r.state, r.history.length]) };
  assert.notEqual(h.systemIndex, IDX.Minor, `after 200 days the hulk still lies at Minor (${h.stranded?.recovery})`);
  assert.ok([IDX.Earth, IDX.Vega].includes(h.systemIndex));
});
test('baseline-defect', '2/4. the tug physically flies to the hulk: Earth → Vega → Minor (12 + 11 chart days) at the tug\'s 0.8× is 15 + 14 days; it is in warp until then and attaches only on arrival at Minor', () => {
  need();
  const env = towScenario('TW-2');
  const r = request(env);
  assert.ok(r.ok, r.reason);
  const rec = r.record;
  const tr = C.journeyById(env.book, rec.outbound.journeyId);
  assert.deepEqual(tr.legDays, [15, 14]);
  assert.equal(rec.state, 'en_route_to_hulk');
  run(env.book, env.world, 2, 29);
  assert.equal(rec.state, 'en_route_to_hulk', `on day 29 the mission is ${rec.state}`);
  assert.ok(env.t.transit, 'the tug is not in warp on day 29');
  assert.equal(env.h.systemIndex, IDX.Minor);
  run(env.book, env.world, 30, 30);
  assert.equal(rec.attachment?.day, 1 + 15 + 14); assert.equal(rec.attachment?.at, IDX.Minor);
  assert.ok(['towing', 'attached'].includes(rec.state));
  log.outbound = { legs: tr.legDays, attachment: rec.attachment, history: rec.history };
});
test('new-feature', '3. save/load mid-outbound-leg keeps the mission exactly: same state, same journey, same leg ETA, nothing restarted from the origin, no hulk teleported', () => {
  need();
  const env = towScenario('TW-3');
  const rec = request(env).record;
  run(env.book, env.world, 2, 20);
  const b2 = reload(env.book);
  const r2 = recById(b2, rec.id), t2 = C.journeyById(b2, rec.outbound.journeyId), t1 = C.journeyById(env.book, rec.outbound.journeyId);
  assert.deepEqual({ s: r2.state, leg: t2.legIndex, arr: t2.legArrivalDay, eta: t2.etaDay, from: t2.from }, { s: rec.state, leg: t1.legIndex, arr: t1.legArrivalDay, eta: t1.etaDay, from: t1.from });
  run(env.book, env.world, 21, 90); run(b2, env.world, 21, 90);
  assert.deepEqual(recById(b2, rec.id).history.map((x) => [x.day, x.state]), rec.history.map((x) => [x.day, x.state]));
  assert.equal(allHullIds(b2).filter((id) => id === env.h.id).length, 1);
});

// ===================================================================================================
// Attachment, tow and its speed (5–10)
// ===================================================================================================
test('new-feature', '5/6. the same hulk (same record, same vid) goes under tow; under tow it cannot be ordered anywhere, cannot evacuate, cannot fight', () => {
  need();
  const env = towScenario('TW-5');
  const vid0 = vidOf(env.h);
  const rec = request(env).record;
  run(env.book, env.world, 2, 30);
  const h = P(env.book, 'terran').hulls.find((x) => x.id === env.h.id);
  assert.equal(h, env.h, 'the hulk is not the same record');
  assert.equal(vidOf(h), vid0);
  assert.equal(h.stranded.recovery, 'under_tow'); assert.equal(h.towedBy, rec.id);
  assert.equal(C.hullUnavailable(h), true);
  const ev = C.startEvacuation(env.book, env.world, { sponsor: 'terran', origin: IDX.Minor, destination: IDX.Earth, transports: [h.id] }, 30, []);
  assert.equal(ev.ok, false);
  const j = C.startJourney(env.book, env.world, { kind: 'return', ref: 'x', sponsor: 'terran', hulls: [h], destination: IDX.Earth, purpose: 'return' }, 30, []);
  assert.equal(j.ok, false, 'the hulk was given a journey of its own');
});
test('new-feature', '7/8. a tow flies slower than the tug alone, and a fast escort does not hurry it: min(tug 0.8, hulk frame 1.2) × 0.7 = 0.56×; Minor → Vega (11) is 20 days under tow against 14 for the tug alone; with a 1.2× escort still 20', () => {
  need();
  const a = towScenario('TW-7a');
  const ra = request(a).record;
  run(a.book, a.world, 2, 30);
  const ta = C.journeyById(a.book, ra.inbound.journeyId);
  const b = towScenario('TW-7b', { escorts: [93] });
  const rb = request(b).record;
  run(b.book, b.world, 2, 30);
  const tb = C.journeyById(b.book, rb.inbound.journeyId);
  log.towSpeed = { alone: { speed: ta.speed, legs: ta.legDays, route: ra.inbound.route }, escorted: { speed: tb.speed, legs: tb.legDays } };
  assert.equal(ta.speed, 0.56); assert.deepEqual(ta.legDays, [20]);
  assert.deepEqual(ra.inbound.route, [IDX.Minor, IDX.Vega]);
  assert.ok(sum(ta.legDays) > C.legDaysBetween(a.world, IDX.Minor, IDX.Vega, 0.8), 'the tow is not slower than the tug alone');
  assert.equal(tb.speed, ta.speed); assert.deepEqual(tb.legDays, ta.legDays);
  assert.equal(REC.CATEGORY_RECOVERY.shuttle, 0);
});
test('new-feature', '9/10. capability: a scout (capacity 0) cannot tow anything, a cruiser (3) cannot tow a battleship hulk (mass 9); a heavy tug (10) can, and does', () => {
  need();
  const env = towScenario('TW-9', { hulk: 94, tug: 92 });
  const [cr] = make(env, 'terran', 91, IDX.Earth), [ht] = make(env, 'terran', 96, IDX.Earth);
  const scout = request(env);
  assert.equal(scout.ok, false); assert.match(scout.reason, /cannot take anything in tow/);
  const cruiser = request(env, { tugHullId: cr.id });
  assert.equal(cruiser.ok, false); assert.match(cruiser.reason, /can tow a hull of mass 3; this one needs 9/);
  const tug = request(env, { tugHullId: ht.id });
  assert.ok(tug.ok, tug.reason);
  run(env.book, env.world, 2, 120);
  assert.equal(tug.record.state, 'delivered_to_yard', JSON.stringify(tug.record.history));
  assert.equal(REC.canTow(SHIPS[92], SHIPS[94]).ok, false); assert.equal(REC.canTow(SHIPS[96], SHIPS[94]).ok, true); assert.equal(REC.canTow(SHIPS[91], SHIPS[95]).ok, true);
});

// ===================================================================================================
// Tug loss (11, 12, 26) and the integrated RECOVERY-TUG-LOSS
// ===================================================================================================
test('new-feature', '11/12/26/RECOVERY-TUG-LOSS. the tug lost in warp mid-tow: the hulk is let go where the tug last stood — not dragged on, not sent home — and a new recovery can be sent for it later', () => {
  need();
  const env = towScenario('TW-11', { hulkAt: IDX.Qonos, tugAt: IDX.Vega, hulk: 95 });
  env.relations['terran:klingon'] = 'peace';
  const rec = request(env).record;
  assert.ok(rec, 'not started');
  const outEnd = C.journeyById(env.book, rec.outbound.journeyId).etaDay;
  run(env.book, env.world, 2, outEnd);
  assert.equal(rec.state, 'towing');
  const tow = C.journeyById(env.book, rec.inbound.journeyId);
  log.tugLoss = { route: rec.inbound.route, legs: tow.legDays };
  // Qonos → Border → Vega: the tug is destroyed on the first leg (in warp).
  run(env.book, env.world, outEnd + 1, outEnd + 2);
  env.t.status = 'lost'; env.t.hull = 0;
  run(env.book, env.world, outEnd + 3, outEnd + 60);
  assert.equal(rec.state, 'failed'); assert.match(rec.reason, /tug was lost/);
  assert.equal(env.h.systemIndex, IDX.Qonos, `the hulk is at ${env.h.systemIndex}, not where the tug last stood`);
  assert.equal(env.h.stranded.recovery, 'awaiting_recovery'); assert.ok(!env.h.transit); assert.ok(!env.h.towedBy);
  assert.equal(C.cancelHullRecovery(env.book, env.world, rec.id, outEnd + 60, []).ok, false);
  // A new tug can be sent for the same hulk.
  const [t2] = make(env, 'terran', 96, IDX.Vega);
  const again = C.requestHullRecovery(env.book, env.world, { sponsor: 'terran', targetHullId: env.h.id, tugHullId: t2.id }, outEnd + 61, []);
  assert.ok(again.ok, again.reason);
});

test('new-feature', '12b. the tug lost with an escort still flying that cannot tow (a scout): the hulk is let go where the tug last stood — an escort does not carry her on; the escort goes free', () => {
  need();
  const env = towScenario('TW-12b', { hulkAt: IDX.Qonos, tugAt: IDX.Vega, escorts: [92] });
  env.relations['terran:klingon'] = 'peace';
  const rec = request(env).record;
  const outEnd = C.journeyById(env.book, rec.outbound.journeyId).etaDay;
  run(env.book, env.world, 2, outEnd + 2);
  assert.equal(rec.state, 'towing');
  env.t.status = 'lost'; env.t.hull = 0;
  run(env.book, env.world, outEnd + 3, outEnd + 60);
  assert.equal(rec.state, 'failed', JSON.stringify(rec.history));
  assert.equal(env.h.systemIndex, IDX.Qonos, `the hulk is at ${env.h.systemIndex}`);
  const scout = env.esc[0];
  assert.equal(scout.opId, null); assert.equal(scout.status, 'ready'); assert.ok(!scout.transit);
});
test('new-feature', '24b. the watchdog: a mission whose journey was halted by a path that tells nobody (a forced reset) does not stay open for ever — the hulk is let go where it stands and the tug goes free', () => {
  need();
  const env = towScenario('TW-24b');
  const rec = request(env).record;
  run(env.book, env.world, 2, 35);
  assert.equal(rec.state, 'towing');
  C.haltJourneysOf(env.book, 'terran', 35, 'forced override');
  run(env.book, env.world, 36, 37);
  assert.ok(['failed', 'aborted'].includes(rec.state), rec.state);
  assert.equal(env.h.stranded.recovery, 'awaiting_recovery'); assert.ok(!env.h.towedBy);
});
test('new-feature', '18b. delivered, then the yard lost before the repair: the hulk is out in the open again and her people\'s clock runs again — no immortal crew', () => {
  need();
  const { env, rec, deliveredDay } = deliverScenario('TW-18b', 'aboard');
  assert.equal(rec.state, 'delivered_to_yard');
  env.world.systems[rec.yard].controller = 'klingon';
  run(env.book, env.world, deliveredDay + 1, deliveredDay + 120);
  assert.ok(env.h.status === 'lost' || env.h.stranded?.crew !== 'aboard', `crew ${env.h.stranded?.crew}, supported by ${env.h.stranded?.crewSupportedBy}`);
});

// ===================================================================================================
// Blockade (13, 14) and the tactical handoff (15)
// ===================================================================================================
function blockadeAt(env, at, n = 8) {
  const k = P(env.book, 'klingon').hulls.filter((h) => h.status === 'ready' && !madeHulls.has(h)).slice(0, n);
  for (const h of k) { h.systemIndex = at; madeHulls.add(h); }
  const b = C.startBlockade(env.book, env.world, { power: 'klingon', target: at, hullIds: k.map((h) => h.id), purpose: 'interdict_trade' }, 1, []);
  assert.ok(b.ok, b.reason);
  return b.record;
}
test('new-feature', '13. a tow crossing a blockaded system runs it through the shared engine, once: the run is on the blockade\'s record under the tow journey, the hulk is in the runner, the tow\'s speed is the dash speed', () => {
  need();
  const env = towScenario('TW-13', { hulkAt: IDX.Minor, tugAt: IDX.Minor });
  const b = blockadeAt(env, IDX.Vega, 3);
  env.book.config.blockadeMaxDays = 400;
  const fx = [];
  const rec = C.requestHullRecovery(env.book, env.world, { sponsor: 'terran', targetHullId: env.h.id, tugHullId: env.t.id, yard: IDX.Earth }, 1, fx).record;
  assert.ok(rec, 'not started');
  const tow = C.journeyById(env.book, rec.inbound.journeyId);
  const runs = [];
  for (let d = 2; d < 80 && runs.length === 0; d++) { const e = C.advanceCampaignDay(env.book, env.world, d); runs.push(...e.filter((x) => x.type === 'blockadeRun')); }
  assert.equal(runs.length, 1, 'no run, or more than one');
  assert.ok(String(runs[0].key).includes(tow.id) || runs[0].journeyId === tow.id, JSON.stringify(runs[0]).slice(0, 300));
  assert.equal(runs[0].journeyKind, 'recovery');
  assert.ok(runs[0].hulls.some((x) => x.hullId === env.h.id), 'the hulk was not in the runner');
  assert.equal((b.runs || []).length, 1);
  log.towRun = { outcome: runs[0].outcome, odds: runs[0].odds };
});
test('new-feature', '14. the shared run odds: the same tug is easier to catch with a hulk in tow (slower dash, bigger signature); escorts in the group improve its chances', () => {
  need();
  const env = towScenario('TW-14');
  const b = blockadeAt(env, IDX.Vega, 6);
  const tug = { hullId: 't', shipId: 90, hull: 700, maxHull: 700 };
  const hulk = { hullId: 'h', shipId: 95, hull: 25, maxHull: 500, towed: true };
  const esc = [1, 2, 3].map((i) => ({ hullId: `e${i}`, shipId: 91, hull: 900, maxHull: 900 }));
  const alone = C.assessBlockadeRun(env.book, env.world, b, { key: 'a', sponsor: 'terran', hulls: [tug] });
  const towing = C.assessBlockadeRun(env.book, env.world, b, { key: 'b', sponsor: 'terran', hulls: [tug, hulk], towSpeed: 0.56 });
  const escorted = C.assessBlockadeRun(env.book, env.world, b, { key: 'c', sponsor: 'terran', hulls: [tug, hulk, ...esc], towSpeed: 0.56 });
  log.towOdds = { alone: alone.pPass, towing: towing.pPass, escorted: escorted.pPass };
  assert.ok(towing.speed < alone.speed && towing.signature > alone.signature);
  assert.ok(towing.pPass < alone.pPass, `towing ${towing.pPass} ≥ alone ${alone.pPass}`);
  assert.ok(escorted.pPass > towing.pPass, `escorted ${escorted.pPass} ≤ towing ${towing.pPass}`);
});
test('new-feature', '15. a tow intercepted where the captain is goes to the scene: the same tug and escort vids; the hulk is not spawned; the tug destroyed in the scene is written back and the hulk is let go at that system', () => {
  need();
  let done = null;
  for (let i = 0; i < 80 && !done; i++) {
    const env = towScenario(`TW-15-${i}`, { hulkAt: IDX.Minor, tugAt: IDX.Minor, escorts: [] });
    blockadeAt(env, IDX.Vega, 14);
    env.book.config.blockadeMaxDays = 400;
    env.world.localSystem = IDX.Vega;
    const rec = C.requestHullRecovery(env.book, env.world, { sponsor: 'terran', targetHullId: env.h.id, tugHullId: env.t.id, yard: IDX.Earth }, 1, []).record;
    run(env.book, env.world, 2, 21);
    const enc = (env.book.encounters || []).find((e) => e.type === 'blockade');
    if (enc) done = { env, rec, enc };
  }
  assert.ok(done, 'no seed gave an intercepted tow');
  const { env, rec, enc } = done;
  const tugP = enc.participants.find((p) => p.hullId === env.t.id), hulkP = enc.participants.find((p) => p.hullId === env.h.id);
  assert.ok(tugP && tugP.spawn !== false, 'the tug is not in the scene');
  assert.equal(tugP.vid, vidOf(env.t));
  assert.ok(hulkP && hulkP.spawn === false && hulkP.towed, 'the hulk was put in the scene');
  const participants = Object.fromEntries(enc.participants.map((p) => [p.ref, p.hullId === env.t.id ? { fate: 'destroyed', hull: 0 } : { fate: 'survived', hull: p.before?.hull ?? null }]));
  const r = C.resolveEncounterNow(env.book, env.world, enc.id, { result: { outcome: 'forced_back' }, participants }, 21, []);
  assert.ok(r.ok, r.reason);
  run(env.book, env.world, 22, 30);
  assert.equal(env.t.status, 'lost');
  assert.equal(rec.state, 'failed', JSON.stringify(rec.history));
  assert.equal(env.h.systemIndex, IDX.Vega, `the hulk is at ${env.h.systemIndex}`);
  assert.equal(env.h.stranded.recovery, 'awaiting_recovery');
  assert.equal(allHullIds(env.book).filter((id) => id === env.h.id).length, 1);
  log.tacticalTow = { encounter: enc.id, system: enc.system, history: rec.history.map((x) => `${x.day} ${x.state} ${x.note}`) };
});

// ===================================================================================================
// Delivery, repair and crew (16–19) and the integrated STRANDED-HULL-RECOVERY
// ===================================================================================================
function deliverScenario(seed, crew) {
  const env = towScenario(seed, { crew });
  const rec = request(env).record;
  let day = 2;
  for (; day < 200 && rec.state !== 'delivered_to_yard'; day++) run(env.book, env.world, day, day);
  return { env, rec, deliveredDay: day - 1 };
}
test('baseline-defect', '16. delivered to the yard is not repaired: the hulk enters the yard\'s ordinary recovery (recovering → in_yard) and then the ordinary repair takes days', () => {
  need();
  const { env, rec, deliveredDay } = deliverScenario('TW-16', 'aboard');
  assert.equal(rec.state, 'delivered_to_yard');
  assert.equal(env.h.systemIndex, rec.yard);
  assert.ok(C.hullIsDisabled(env.h), 'repaired on delivery');
  assert.equal(env.h.stranded.recovery, 'recovering');
  // The yard's ordinary recovery (strandedRecoveryDays) and then the ordinary repair, day by day.
  const states = [];
  let repairedDay = null;
  for (let d = deliveredDay + 1; d < deliveredDay + 60 && repairedDay == null; d++) { run(env.book, env.world, d, d); states.push([d, env.h.stranded?.recovery ?? null, env.h.hull]); if (!C.hullIsDisabled(env.h)) repairedDay = d; }
  assert.equal(states[0][1], 'recovering', JSON.stringify(states));
  assert.ok(repairedDay != null && repairedDay >= deliveredDay + (env.book.config.strandedRecoveryDays ?? 2), `repaired day ${repairedDay}, delivered ${deliveredDay}: ${JSON.stringify(states)}`);
  log.repairSequence = states;
  log.delivery = { delivered: deliveredDay, repaired: repairedDay, plan: rec.plan };
  assert.equal(deliveredDay, rec.plan.deliverDay, `delivered day ${deliveredDay}; the plan said day ${rec.plan.deliverDay}`);
});
test('new-feature', '17/19. a hulk whose crew were rescued is towed in empty and stays crewless: repaired, it waits in the yard for a crew (repaired-awaiting-crew), not operational', () => {
  need();
  const { env } = deliverScenario('TW-17', 'rescued');
  for (let d = 1; d < 120 && C.hullIsDisabled(env.h); d++) run(env.book, env.world, env.book.settled + 1, env.book.settled + 1);
  assert.ok(!C.hullIsDisabled(env.h), 'never repaired');
  assert.ok(env.h.recrew, 'no awaiting-crew state'); assert.equal(env.h.status, 'repairing');
  assert.equal(Number(env.h.crew ?? 0) < 0.5, true, `crew ${env.h.crew}`);
  assert.equal(C.hullAwaitingCrew(env.h), true);
});
test('new-feature', '18. a hulk with her crew aboard keeps them through a tow longer than her life support: the tug carries them, the clock stops at attachment; repaired, she is back with her own crew', () => {
  need();
  const env = towScenario('TW-18');
  env.book.config.crewSurvivalDays = 40; // the hulk's people last long enough to be reached
  env.h.stranded.crewUntil = 1 + 40;
  const rec = request(env).record;
  for (let d = 2; d < 200 && rec.state !== 'delivered_to_yard'; d++) run(env.book, env.world, d, d);
  assert.equal(rec.state, 'delivered_to_yard');
  assert.ok(env.book.settled > 41, 'the tow did not outlast her life support');
  assert.equal(env.h.stranded?.crew, 'aboard', 'her crew were lost under tow');
  for (let d = 1; d < 120 && C.hullIsDisabled(env.h); d++) run(env.book, env.world, env.book.settled + 1, env.book.settled + 1);
  run(env.book, env.world, env.book.settled + 1, env.book.settled + 1);
  assert.ok(!env.h.recrew, 'she waits for a crew she has'); assert.notEqual(env.h.status, 'lost');
});
test('baseline-defect', 'STRANDED-HULL-RECOVERY. a hull disabled several systems from home stays there with a distress crew; the crew are rescued first; later a tug flies out the real route, attaches, tows her back slower, meets a blockade on the way, reaches the yard; repair begins; repaired, she waits for a crew', () => {
  need();
  const env = towScenario('TW-SHR', { hulkAt: IDX.Qonos, tugAt: IDX.Earth });
  env.relations['terran:klingon'] = 'peace';
  // Days pass: she stays at Qonos.
  run(env.book, env.world, 2, 10);
  assert.equal(env.h.systemIndex, IDX.Qonos);
  C.rescueStrandedCrew(env.book, 'terran', env.h.id, 10, 'relief');
  // A blockade at Vega stands in the way home (by another power at war with the Terrans).
  env.relations['terran:klingon'] = 'war';
  const b = blockadeAt(env, IDX.Vega, 2);
  env.relations['terran:klingon'] = 'peace';
  env.book.config.blockadeMaxDays = 600;
  const rec = C.requestHullRecovery(env.book, env.world, { sponsor: 'terran', targetHullId: env.h.id, tugHullId: env.t.id, yard: IDX.Earth }, 11, []).record;
  assert.ok(rec, 'not started');
  for (let d = 12; d < 300 && !['delivered_to_yard', 'failed', 'aborted'].includes(rec.state); d++) run(env.book, env.world, d, d);
  const tow = C.journeyById(env.book, rec.inbound.journeyId);
  log.strandedHullRecovery = { history: rec.history.map((x) => `${x.day} ${x.state} ${x.note}`), outbound: rec.outbound, inbound: rec.inbound, encounters: tow.encounters, runs: b.runs };
  assert.equal(rec.state, 'delivered_to_yard', JSON.stringify(rec.history));
  assert.ok(rec.outbound.route.length >= 3 && rec.inbound.route.length >= 3, 'not a real multi-leg route each way');
  assert.ok(rec.inbound.towSpeed < rec.outbound.speed, 'the tow was not slower');
  assert.ok(tow.encounters.some((e) => e.system === IDX.Vega) || (b.runs || []).length > 0 || b.status !== 'active', 'the tow never met the blockade');
  for (let d = 1; d < 150 && C.hullIsDisabled(env.h); d++) run(env.book, env.world, env.book.settled + 1, env.book.settled + 1);
  assert.ok(!C.hullIsDisabled(env.h)); assert.ok(env.h.recrew, 'repaired without a crew and not waiting for one');
});

// ===================================================================================================
// Salvage and claims (20–22) and the integrated ENEMY-SALVAGE
// ===================================================================================================
function enemyHulk(seed, { at = IDX.Minor, crew = 'lost', relation = 'war' } = {}) {
  const env = campaignWorld(seed);
  env.relations['terran:klingon'] = relation;
  const [t] = make(env, 'terran', 90, IDX.Vega);
  const [k] = make(env, 'klingon', 97, at);
  park(env);
  k.hull = Math.max(1, Math.floor(k.maxHull * 0.05)); k.status = 'repairing';
  C.advanceStranded(env.book, env.world, 1, []);
  if (crew === 'lost') { k.stranded.crew = 'lost'; k.stranded.crewEndDay = 1; k.crew = 0; }
  return { ...env, t, k };
}
test('new-feature', '20/21/ENEMY-SALVAGE. a crewless Klingon hulk lying in Terran space, at war: a Terran tug flies out, the claim holds, the same hull changes hands at attachment (origin still Klingon, same vid), is towed to a Terran yard; it exists exactly once, in no stock or prize list', () => {
  need();
  const env = enemyHulk('TW-20');
  const vid0 = vidOf(env.k), origin0 = env.k.identity?.origin?.builder;
  const claim = C.recoveryClaim(env.book, env.world, 'terran', env.k.id);
  assert.equal(claim.ok, true, claim.reason); assert.equal(claim.kind, 'salvage');
  const r = C.requestHullRecovery(env.book, env.world, { sponsor: 'terran', targetHullId: env.k.id, tugHullId: env.t.id }, 1, []);
  assert.ok(r.ok, r.reason);
  for (let d = 2; d < 200 && !['delivered_to_yard', 'failed', 'aborted'].includes(r.record.state); d++) run(env.book, env.world, d, d);
  assert.equal(r.record.state, 'delivered_to_yard', JSON.stringify(r.record.history));
  const now = P(env.book, 'terran').hulls.find((h) => h.id === env.k.id);
  assert.equal(now, env.k, 'not the same record');
  assert.ok(!P(env.book, 'klingon').hulls.some((h) => h.id === env.k.id && h.status !== 'lost'), 'still on the Klingon books');
  assert.equal(vidOf(now), vid0); assert.equal(now.identity?.origin?.builder, origin0); assert.equal(now.shipId, 97);
  assert.equal(now.salvagedFrom, 'klingon');
  assert.ok((now.identity?.history || []).some((x) => x.event === 'salvaged' && x.from === 'klingon' && x.to === 'terran'), 'no salvage provenance');
  assert.equal(allHullIds(env.book).filter((id) => id === env.k.id).length, 1);
  assert.equal(env.book.stats.recovery.salvaged, 1);
  log.salvage = { history: r.record.history.map((x) => `${x.day} ${x.state} ${x.note}`), origin: now.identity?.origin, provenance: now.identity?.history };
});
test('new-feature', '22. a protected or crewed enemy hull cannot be casually salvaged: in its owner\'s space; guarded by its owner\'s ships; its crew aboard; not at war and not abandoned', () => {
  need();
  const inSpace = enemyHulk('TW-22a', { at: IDX.Border });
  assert.match(C.recoveryClaim(inSpace.book, inSpace.world, 'terran', inSpace.k.id).reason, /protected/);
  const crewed = enemyHulk('TW-22b', { crew: 'aboard' });
  assert.match(C.recoveryClaim(crewed.book, crewed.world, 'terran', crewed.k.id).reason, /crewed/);
  const peace = enemyHulk('TW-22c', { relation: 'peace' });
  assert.match(C.recoveryClaim(peace.book, peace.world, 'terran', peace.k.id).reason, /not abandoned/);
  const guarded = enemyHulk('TW-22d');
  const [g] = make(guarded, 'klingon', 97, IDX.Minor);
  assert.match(C.recoveryClaim(guarded.book, guarded.world, 'terran', guarded.k.id).reason, /guarded/);
  const r = C.requestHullRecovery(guarded.book, guarded.world, { sponsor: 'terran', targetHullId: guarded.k.id, tugHullId: guarded.t.id }, 1, []);
  assert.equal(r.ok, false); void g;
});

// ===================================================================================================
// Destination, write-off, cancel (23–25)
// ===================================================================================================
test('new-feature', '23. the destination yard changes hands mid-tow: at the next boundary the tow re-chooses a yard it can use and goes there; it never delivers into a hostile yard', () => {
  need();
  const env = towScenario('TW-23', { hulkAt: IDX.Romulus, tugAt: IDX.Romulus });
  env.relations['terran:romulan'] = 'peace';
  const rec = C.requestHullRecovery(env.book, env.world, { sponsor: 'terran', targetHullId: env.h.id, tugHullId: env.t.id, yard: IDX.Earth }, 1, []).record;
  assert.equal(rec.yard, IDX.Earth);
  run(env.book, env.world, 2, 3);
  env.world.systems[IDX.Earth].controller = 'klingon';
  for (let d = 4; d < 120 && !['delivered_to_yard', 'failed', 'aborted'].includes(rec.state); d++) run(env.book, env.world, d, d);
  log.reevaluate = rec.history.map((x) => `${x.day} ${x.state} ${x.note}`);
  assert.equal(rec.state, 'delivered_to_yard', JSON.stringify(rec.history));
  assert.equal(rec.yard, IDX.Vega); assert.equal(env.h.systemIndex, IDX.Vega);
  assert.ok(rec.history.some((x) => /re-chosen/.test(x.note)));
});
test('new-feature', '24. a recovery under way prevents the 90-day write-off of a crewless hulk; once the mission is called off, the write-off clock applies again — and the written-off wreck still lies there (a derelict), salvageable, its identity not retired', () => {
  need();
  const env = towScenario('TW-24', { crew: 'lost', hulkAt: IDX.Qonos, tugAt: IDX.Earth });
  env.relations['terran:klingon'] = 'peace';
  env.book.config.derelictWriteOffDays = 10;
  const rec = request(env).record;
  run(env.book, env.world, 2, 20);
  assert.notEqual(env.h.status, 'lost', 'written off while a tug was coming');
  C.cancelHullRecovery(env.book, env.world, rec.id, 20, []);
  run(env.book, env.world, 21, 40);
  assert.equal(env.h.fate, 'written_off');
  const d = (env.book.derelicts || []).find((x) => x.id === env.h.id);
  assert.ok(d, 'the wreck vanished'); assert.ok(d.hull > 0); assert.equal(d.systemIndex, IDX.Qonos);
  assert.ok(!(env.book.identityRegistry?.retired || []).includes?.(vidOf(env.h)));
});
test('new-feature', '25. cancelled before attachment: the tug finishes the leg it is flying (it cannot turn mid-leg) and is free where that leg ends; the hulk is untouched', () => {
  need();
  const env = towScenario('TW-25');
  const rec = request(env).record;
  run(env.book, env.world, 2, 5);
  assert.equal(C.cancelHullRecovery(env.book, env.world, rec.id, 5, []).ok, true);
  assert.equal(rec.state, 'aborted');
  run(env.book, env.world, 6, 16);
  assert.ok(!env.t.transit); assert.equal(env.t.systemIndex, IDX.Vega); assert.equal(env.t.opId, null); assert.equal(env.t.status, 'ready');
  assert.equal(env.h.systemIndex, IDX.Minor); assert.equal(env.h.stranded.recovery, 'awaiting_recovery'); assert.ok(!env.h.recoveryClaim);
});

// ===================================================================================================
// The AI (27, 28)
// ===================================================================================================
test('new-feature', '27. the AI never conjures a tug: with no recovery-capable ship, its hulk waits and no hull is created; with one, it sends that very ship', () => {
  need();
  const env = campaignWorld('TW-27');
  env.book.config.aiRecovery = true;
  const [h] = make(env, 'terran', 94, IDX.Minor);
  park(env);
  for (const x of P(env.book, 'terran').hulls) if (x !== h && x.status !== 'lost') x.shipId = 92; // scouts only: tow nothing
  disable(env, h, 1);
  const n0 = P(env.book, 'terran').hulls.length;
  run(env.book, env.world, 2, 40);
  assert.equal(P(env.book, 'terran').hulls.length, n0); assert.equal((env.book.hullRecoveries || []).length, 0);
  assert.ok(env.book.stats.recovery.skipped['no recovery-capable vessel free'] > 0);
  const [tug] = make(env, 'terran', 96, IDX.Earth);
  run(env.book, env.world, 41, 46);
  const rec = (env.book.hullRecoveries || [])[0];
  assert.ok(rec, 'the AI did not send its tug'); assert.equal(rec.tug.hullId, tug.id); assert.equal(rec.requestedBy, 'ai');
  assert.equal(P(env.book, 'terran').hulls.length, n0 + 0);
});
test('new-feature', '28. the AI weighs it: a cheap hulk, or one too far, is not worth the tug — skipped and recorded', () => {
  need();
  const env = campaignWorld('TW-28');
  env.book.config.aiRecovery = true;
  const [cheap] = make(env, 'terran', 92, IDX.Minor);
  make(env, 'terran', 96, IDX.Earth);
  park(env);
  disable(env, cheap, 1);
  run(env.book, env.world, 2, 30);
  assert.equal((env.book.hullRecoveries || []).length, 0);
  assert.ok(env.book.stats.recovery.skipped['below value threshold'] > 0);
  env.book.config.aiRecoveryMinValue = 1; env.book.config.aiRecoveryMaxDays = 20;
  run(env.book, env.world, 31, 40);
  assert.equal((env.book.hullRecoveries || []).length, 0);
  assert.ok(env.book.stats.recovery.skipped['too far'] > 0, JSON.stringify(env.book.stats.recovery.skipped));
  log.aiSkips = env.book.stats.recovery.skipped;
});

// ===================================================================================================
// ETA, save/load mid-tow, crossings, identities (29–32)
// ===================================================================================================
test('new-feature', '29. the plan is the journey: the requested ETA (outbound + tow, at the real speeds) is the day the hulk reaches the yard', () => {
  need();
  const env = towScenario('TW-29', { hulkAt: IDX.Romulus });
  env.relations['terran:romulan'] = 'peace';
  const plan = C.planHullRecovery(env.book, env.world, { sponsor: 'terran', targetHullId: env.h.id, tugHullId: env.t.id }, 1);
  assert.ok(plan.ok, plan.reason);
  const rec = request(env).record;
  for (let d = 2; d < 200 && rec.state !== 'delivered_to_yard'; d++) run(env.book, env.world, d, d);
  assert.equal(rec.endedDay, plan.deliverDay, `delivered day ${rec.endedDay}, planned day ${plan.deliverDay}`);
  assert.equal(rec.attachment.day, plan.arriveDay);
  log.eta = { plan: { outbound: plan.outboundDays, tow: plan.towDays, towSpeed: plan.towSpeed, deliver: plan.deliverDay }, delivered: rec.endedDay };
});
test('new-feature', '30/31/32. save/load mid-tow keeps the tow route, speed and timing exactly; the same day processed twice crosses nothing twice; every vessel identity is unique throughout', () => {
  need();
  const env = towScenario('TW-30', { hulkAt: IDX.Qonos, tugAt: IDX.Vega });
  env.relations['terran:klingon'] = 'peace';
  const rec = request(env).record;
  for (let d = 2; d < 200 && rec.state !== 'towing'; d++) run(env.book, env.world, d, d);
  run(env.book, env.world, env.book.settled + 1, env.book.settled + 3);
  const b2 = reload(env.book);
  const t1 = C.journeyById(env.book, rec.inbound.journeyId), t2 = C.journeyById(b2, rec.inbound.journeyId);
  assert.deepEqual({ tow: t2.tow, speed: t2.speed, legs: t2.legDays, arr: t2.legArrivalDay, eta: t2.etaDay, path: t2.path }, { tow: t1.tow, speed: t1.speed, legs: t1.legDays, arr: t1.legArrivalDay, eta: t1.etaDay, path: t1.path });
  const s = env.book.settled;
  run(env.book, env.world, s + 1, s + 80); run(b2, env.world, s + 1, s + 80);
  const r2 = recById(b2, rec.id);
  assert.equal(r2.state, rec.state); assert.equal(r2.endedDay, rec.endedDay);
  run(env.book, env.world, rec.endedDay, rec.endedDay);
  const keys = t1.crossed.map((c) => `${c.seq}:${c.leg}`);
  assert.equal(new Set(keys).size, keys.length, 'a crossing was repeated');
  const vids = Object.values(env.book.polities).flatMap((p) => p.hulls.filter((h) => h.status !== 'lost').map(vidOf));
  assert.equal(new Set(vids).size, vids.length, 'duplicated identities');
});

// ===================================================================================================
// Derelict lifecycle, the tow formula, special routes (supplementary)
// ===================================================================================================
test('new-feature', 'TOW-FORMULA and SPECIAL ROUTES. the tow formula is in towing-audit-test R7/R8 (group × 0.7, audit round); a tow is never routed through the wormhole (unavailable, not invented); legs are never 0 days', () => {
  need();
  const SPD = C.journeySpeed ? null : null; void SPD;
  const env = campaignWorld('TW-F');
  const plan = C.plotJourney(env.world, IDX.Cardassia, IDX.Dominica, 'terran', null, 0.56, { noFixed: true });
  assert.equal(plan, null, 'a tow route went through the wormhole');
  assert.ok(C.plotJourney(env.world, IDX.Cardassia, IDX.Dominica, 'terran', null, 0.56), 'precondition: the ordinary route uses it');
  assert.ok(C.legDaysBetween(env.world, IDX.Bajora, IDX.Minor ?? 8, 0.4) >= 1);
});

// ===================================================================================================
// The existing suites (33, 34)
// ===================================================================================================
test('preservation', '33/34. the disabled-hull, crew/recrew, movement, time-scale, speed and handoff suites stay green, run as-is', () => {
  for (const script of ['scripts/disabled-hull-test.mjs', 'scripts/doctrine-phase3-test.mjs', 'scripts/strategic-movement-test.mjs', 'scripts/strategic-time-scale-test.mjs', 'scripts/ship-strategic-speed-test.mjs', 'scripts/strategic-tactical-handoff-test.mjs']) {
    if (!fs.existsSync(path.join(root, script))) continue;
    const r = spawnSync(process.execPath, [path.join(root, script)], { encoding: 'utf8', env: { ...process.env, BM1_TEST_OUTPUT: '' } });
    const last = (r.stdout || '').trim().split('\n').at(-1);
    assert.equal(r.status, 0, `${script}: ${last}`);
  }
});

if (out) { fs.mkdirSync(out, { recursive: true }); fs.writeFileSync(path.join(out, 'towing-salvage-test.json'), JSON.stringify({ root, results, log }, null, 1)); }
const byTag = (t) => { const x = results.filter((y) => y.tag === t); return `${x.filter((y) => y.ok).length}/${x.length}`; };
const failed = results.filter((x) => !x.ok);
console.log(`\ntowing & salvage pure: ${results.filter((x) => x.ok).length}/${results.length} (baseline-defect ${byTag('baseline-defect')}, new-feature ${byTag('new-feature')}, preservation ${byTag('preservation')})${failed.length ? ` — FAILED: ${failed.map((x) => x.name.split(' ')[0]).join(', ')}` : ''}`);
process.exit(failed.length ? 1 : 0);
