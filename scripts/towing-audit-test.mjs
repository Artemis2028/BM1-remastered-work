// Pure regressions for the TOWING / SALVAGE / STRANDED-HULL RECOVERY AUDIT round (docs/movement/TOWING-SALVAGE-AUDIT.md,
// docs/movement/TOWING-SALVAGE-RULES.md). Real catalogue classes (bm-ships/ships.json: mass, recoveryCapacity and
// the approved strategic-speed rating), the fixture chart at the default game's leg scale. Checks are tagged:
//   [baseline-defect] reproduces a defect found in a7e56d2's towing (fails on its own assertion there);
//   [new-feature]     behaviour this round adds (the lifecycle record, waiting requests);
//   [preservation]    behaviour a7e56d2 already had and that must hold (passes on both).
// Each check names the brief's regression number(s) (R1–R32) or integrated scenario.
// BM1_TOWAUDIT_ROOT points the suite at another tree (the baseline reproduction runs it against a7e56d2).
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(process.env.BM1_TOWAUDIT_ROOT || path.join(here, '..'));
const imp = (rel) => import(pathToFileURL(path.join(root, rel)).href);
const C = await imp('src/campaign-strategy.mjs');
const REC = await imp('src/strategic-recovery.mjs');
const { makeWorld, run } = await import(pathToFileURL(path.join(root, 'scripts/campaign-world-fixture.mjs')).href); // the tree's own fixture: its days run that tree's model
const CATALOGUE = JSON.parse(fs.readFileSync(path.join(root, 'bm-ships/ships.json'), 'utf8')).ships;
const out = process.env.BM1_TEST_OUTPUT || null;

const results = [];
const log = {};
const test = (tag, name, fn) => {
  try { fn(); results.push({ tag, name, ok: true }); console.log('PASS', `[${tag}]`, name); }
  catch (e) { results.push({ tag, name, ok: false, error: String(e?.message || e).split('\n')[0] }); console.log('FAIL', `[${tag}]`, name, '\n      ', String(e?.stack || e).split('\n').slice(0, 7).join('\n       ')); }
};
const sum = (a) => a.reduce((n, d) => n + d, 0);
const ceilDays = (base, m) => Math.max(1, Math.ceil(base / m - 1e-9));
const MULT = { 1: 0.70, 1.5: 0.74, 2: 0.78, 2.5: 0.82, 3: 0.85, 3.5: 0.89, 4: 0.92, 4.5: 0.96, 5: 1.00, 5.5: 1.04, 6: 1.08, 6.5: 1.12, 7: 1.16, 7.5: 1.20, 8: 1.24, 8.5: 1.28, 9: 1.32, 9.5: 1.36, 10: 1.40 };

// ---- real catalogue classes ----
const cls = (n) => { const s = CATALOGUE.find((x) => x.name === n); assert.ok(s, `no class ${n}`); return s; };
const K = {
  tug2: cls('Tug Class II'),               // heavy tug: capacity 10, 4/10 (0.92×)
  oberth: cls('Oberth Tug'),               // tug: capacity 8, 5/10
  defiant: cls('Defiant Escort'),          // escort: capacity 1, 8.5/10
  galaxy: cls('Galaxy Class'),             // capital: capacity 5, mass 6, 8.5/10
  sovereign: cls('Sovereign Class'),       // capital: mass 6, 9.5/10
  sailor: cls('Bajoran Solar Sailor'),     // mass 1, 1/10 (0.70×)
  danube: cls('Danube Utility Runabout'),  // mass 1, capacity 0
  shuttle: cls('Basic Shuttle'),           // capacity 0
  vorcha: cls("Vor'cha Attack Cruiser"),   // Klingon, mass 6
  qonos: cls('Klingon Qonos'),             // Klingon battleship, mass 9
};
const SHIPS = {};
for (const s of Object.values(K)) SHIPS[s.id] = { price: Number(s.cost) || 50000, mass: Number(s.mass), combatHull: Math.max(200, Number(s.hull) * 2), faction: s.faction, cargo: Number(s.cargoCapacity) || 0,
  combat: /tug/i.test(s.role || '') ? 0.3 : 1, strategicSpeedRating: s.strategicSpeedRating, strategicSpeed: s.strategicSpeed, recoveryCapacity: s.recoveryCapacity };
// A cloaked variant of the Defiant (same class numbers), for the cloak check.
SHIPS[9326] = { ...SHIPS[K.defiant.id], cloak: true, recoveryCapacity: 2 };
SHIPS[9345] = { ...SHIPS[K.sailor.id] };

// Earth(0, yards) ─ Vega(1, yard) ─ Border(2, Klingon) ─ Qonos(3); Vega ─ Romulus(4); Border ─ Cardassia(5) ─ Bajora(6) ⇄ Dominica(7); Vega ─ Minor(8, no yard).
const LEGS = { '0:1': 12, '1:2': 10, '2:3': 8, '1:4': 12, '2:5': 9, '5:6': 7, '6:7': 3, '1:8': 11 };
const legDays = (a, b) => LEGS[`${a}:${b}`] ?? LEGS[`${b}:${a}`] ?? 1;
const IDX = { Earth: 0, Vega: 1, Border: 2, Qonos: 3, Romulus: 4, Cardassia: 5, Bajora: 6, Dominica: 7, Minor: 8 };
function campaignWorld(seed) {
  const { world, relations } = makeWorld({});
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
const made = new WeakSet();
function make(env, polity, shipId, at, n = 1) {
  const hs = P(env.book, polity).hulls.filter((h) => h.status === 'ready' && !h.opId && !made.has(h)).sort((a, b) => String(a.id).localeCompare(String(b.id))).slice(0, n);
  assert.equal(hs.length, n, `not ${n} free ${polity} hulls`);
  for (const h of hs) { made.add(h); h.shipId = shipId; h.systemIndex = at; h.maxHull = h.hull = SHIPS[shipId].combatHull; h.crew = 1; }
  return hs;
}
function park(env) { for (const [pid, p] of Object.entries(env.book.polities)) for (const h of p.hulls) if (!made.has(h) && h.status !== 'lost') { const home = env.world.systems.find((s) => s.controller === pid); if (home) h.systemIndex = home.index; } }
function disable(env, h, day, polity = 'terran') {
  h.hull = Math.max(1, Math.floor(h.maxHull * 0.05)); h.status = 'repairing';
  C.advanceStranded(env.book, env.world, day, []);
  assert.ok(h.stranded, `${polity} hull not stranded`);
}
const allVids = (book) => [...Object.values(book.polities).flatMap((p) => p.hulls.filter((h) => h.status !== 'lost').map(vidOf)), ...(book.derelicts || []).map(vidOf)];
function scenario(seed, { hulk = K.danube.id, tug = K.tug2.id, escorts = [], hulkAt = IDX.Minor, tugAt = IDX.Earth, crew = 'aboard' } = {}) {
  const env = campaignWorld(seed);
  const [t] = make(env, 'terran', tug, tugAt);
  const esc = escorts.map((c) => make(env, 'terran', c, tugAt)[0]);
  const [h] = make(env, 'terran', hulk, hulkAt);
  park(env);
  disable(env, h, 1);
  if (crew === 'rescued') C.rescueStrandedCrew(env.book, 'terran', h.id, 1, 'test relief');
  if (crew === 'lost') { h.stranded.crew = 'lost'; h.stranded.crewEndDay = 1; h.crew = 0; }
  return { ...env, t, esc, h };
}
const request = (env, spec = {}, day = 1) => C.requestHullRecovery(env.book, env.world, { sponsor: 'terran', targetHullId: env.h.id, tugHullId: env.t.id, escortHullIds: env.esc.map((e) => e.id), ...spec }, day, []);
const until = (env, rec, states, from, max = 300) => { let d = from; for (; d < from + max && !states.includes(rec.state); d++) run(env.book, env.world, d, d); return d - 1; };
const ENDS = ['delivered_to_yard', 'failed', 'aborted'];
const blockadeAt = (env, at, n = 8) => {
  const k = P(env.book, 'klingon').hulls.filter((h) => h.status === 'ready' && !made.has(h)).slice(0, n);
  for (const h of k) { h.systemIndex = at; made.add(h); }
  const b = C.startBlockade(env.book, env.world, { power: 'klingon', target: at, hullIds: k.map((h) => h.id), purpose: 'interdict_trade' }, 1, []);
  assert.ok(b.ok, b.reason);
  env.book.config.blockadeMaxDays = 600;
  return b.record;
};

// ===================================================================================================
// The casualty stays put; a request moves nothing; no asset → the request waits (R1–R3)
// ===================================================================================================
test('preservation', 'R1. a disabled hull stays exactly where it was disabled: 60 days, still at Minor, still awaiting recovery, never repaired, never sailing', () => {
  const env = scenario('TA-1');
  const hull0 = env.h.hull;
  run(env.book, env.world, 2, 60);
  assert.equal(env.h.systemIndex, IDX.Minor); assert.equal(env.h.stranded.recovery, 'awaiting_recovery');
  assert.equal(env.h.hull, hull0); assert.ok(!env.h.transit); assert.ok(C.hullIsDisabled(env.h));
});
test('preservation', 'R2. requesting recovery teleports nothing: on the request day the casualty is still at Minor and the tug is in warp at Earth\'s first leg; the casualty is still at Minor the day before the tug arrives', () => {
  const env = scenario('TA-2');
  const r = request(env);
  assert.ok(r.ok, r.reason);
  assert.equal(env.h.systemIndex, IDX.Minor); assert.ok(env.t.transit, 'the tug is not in warp');
  assert.equal(env.t.systemIndex, IDX.Earth);
  const eta = r.record.outbound.eta;
  run(env.book, env.world, 2, eta - 1);
  assert.equal(env.h.systemIndex, IDX.Minor); assert.equal(r.record.state, 'en_route_to_hulk');
});
test('baseline-defect', 'R3. no eligible recovery asset: the request is KEPT, awaiting a vessel (on a7e56d2 it was refused and nothing persisted); nothing is spawned; the casualty does not move; when a tug becomes free it is assigned to the same record and flies out', () => {
  const env = campaignWorld('TA-3');
  const [scout] = make(env, 'terran', K.shuttle.id, IDX.Earth);
  const [h] = make(env, 'terran', K.danube.id, IDX.Minor);
  park(env);
  disable(env, h, 1);
  const n0 = P(env.book, 'terran').hulls.length;
  const spec = { sponsor: 'terran', targetHullId: h.id, tugHullId: null, requestedBy: 'player' };
  const r = C.requestHullRecoveryWaiting ? C.requestHullRecoveryWaiting(env.book, env.world, spec, 1, []) : C.requestHullRecovery(env.book, env.world, spec, 1, []);
  const kept = (env.book.hullRecoveries || []).find((x) => String(x.target.hullId) === String(h.id));
  assert.ok(kept, `no request kept: ${r.reason}`);
  assert.equal(kept.state, 'requested'); assert.equal(REC.recoveryPhase?.(kept), 'requested');
  run(env.book, env.world, 2, 30);
  assert.equal(kept.state, 'requested'); assert.equal(h.systemIndex, IDX.Minor); assert.equal(P(env.book, 'terran').hulls.length, n0);
  assert.equal(C.planHullRecovery(env.book, env.world, { sponsor: 'terran', targetHullId: h.id, tugHullId: scout.id, recordId: kept.id }, 30).ok, false, 'a shuttle can tow');
  const [tug] = make(env, 'terran', K.oberth.id, IDX.Earth);
  const a = C.assignHullRecoveryAsset(env.book, env.world, kept.id, { tugHullId: tug.id }, 31, []);
  assert.ok(a.ok, a.reason);
  assert.equal(kept.tug.hullId, tug.id); assert.equal(kept.state, 'en_route_to_hulk'); assert.equal(kept.waitedDays, 30);
  log.waiting = kept.history.map((x) => `${x.day} ${x.state} ${x.note}`);
});

// ===================================================================================================
// The tug flies out; attach only when co-located; the same vid (R4–R6)
// ===================================================================================================
test('preservation', 'R4/R6. the recovery vessel physically flies Earth → Vega → Minor at its own 0.92× (14 + 12 days); it attaches only on the day it is at Minor with the casualty', () => {
  const env = scenario('TA-4');
  const rec = request(env).record;
  const out1 = C.journeyById(env.book, rec.outbound.journeyId);
  assert.deepEqual(out1.legDays, [ceilDays(12, 0.92), ceilDays(11, 0.92)]);
  const trail = [];
  for (let d = 2; d <= rec.outbound.eta; d++) { run(env.book, env.world, d, d); trail.push([d, env.t.systemIndex, Boolean(env.t.transit), rec.state]); }
  assert.ok(trail.some(([, at]) => at === IDX.Vega), 'never crossed Vega');
  assert.equal(rec.attachment.day, rec.outbound.eta); assert.equal(rec.attachment.at, IDX.Minor);
  assert.ok(trail.slice(0, -1).every(([, , , s]) => s === 'en_route_to_hulk'), 'attached before arriving');
  log.outbound = { legs: out1.legDays, attachment: rec.attachment };
});
test('preservation', 'R5. the casualty is the same record with the same vid from the request through the tow, the yard, the repair and back in service', () => {
  const env = scenario('TA-5');
  const vid0 = vidOf(env.h);
  const rec = request(env).record;
  const seen = new Set();
  for (let d = 2; d < 160; d++) { run(env.book, env.world, d, d); const now = P(env.book, 'terran').hulls.find((x) => x.id === env.h.id); assert.equal(now, env.h); seen.add(vidOf(now)); if (!C.hullIsDisabled(env.h) && !env.h.recrew) break; }
  assert.deepEqual([...seen], [vid0]); assert.equal(rec.target.vid, vid0);
  assert.equal(allVids(env.book).filter((v) => v === vid0).length, 1);
});

// ===================================================================================================
// Tow timing and the tow speed rule (R7–R10)
// ===================================================================================================
test('baseline-defect', 'R7/R8/TOW-SPEED. the tow flies at the towing vessel\'s multiplier × 0.70, not limited by the dead casualty\'s own rating: Tug Class II (4/10, 0.92×) towing a Bajoran Solar Sailor (1/10) is 0.64× — Minor → Vega (11 chart days) is 18 days (on a7e56d2 0.49× and 23 days); the tug alone flies it in 12', () => {
  const env = scenario('TA-7', { hulk: K.sailor.id, hulkAt: IDX.Minor, tugAt: IDX.Minor });
  const rec = request(env, { yard: IDX.Vega }).record;
  assert.equal(rec.state, 'towing', rec.state);
  const tow = C.journeyById(env.book, rec.inbound.journeyId);
  log.towSpeed = { speed: tow.speed, legs: tow.legDays, alone: ceilDays(11, 0.92) };
  assert.equal(tow.speed, Math.round(MULT[4] * 0.7 * 100) / 100);
  assert.deepEqual(tow.legDays, [ceilDays(11, 0.64)]);
  assert.ok(sum(tow.legDays) > ceilDays(11, 0.92), 'the tow is not slower than the tug alone');
});
test('baseline-defect', 'R8b. formation towing uses the slowest effective towing element: a Defiant (8.5/10) escort does not hurry a Tug Class II tow; an escort slower than the tug slows it', () => {
  const fast = scenario('TA-8a', { hulkAt: IDX.Minor, tugAt: IDX.Minor, escorts: [K.defiant.id] });
  const rf = request(fast, { yard: IDX.Vega }).record;
  assert.equal(C.journeyById(fast.book, rf.inbound.journeyId).speed, 0.64);
  const slow = scenario('TA-8b', { hulkAt: IDX.Minor, tugAt: IDX.Minor, tug: K.oberth.id, escorts: [K.tug2.id] });
  const rs = request(slow, { yard: IDX.Vega }).record;
  assert.equal(C.journeyById(slow.book, rs.inbound.journeyId).speed, 0.64, 'the slower escort (0.92×) did not set the pace of an Oberth (1.00×) tow');
});
test('preservation', 'R9. planner tow ETA equals actual arrival: the request\'s plan (outbound + tow, real days) is the day of attachment and the day of delivery', () => {
  const env = scenario('TA-9', { hulk: K.sailor.id, hulkAt: IDX.Romulus });
  env.relations['terran:romulan'] = 'peace';
  const plan = C.planHullRecovery(env.book, env.world, { sponsor: 'terran', targetHullId: env.h.id, tugHullId: env.t.id }, 1);
  assert.ok(plan.ok, plan.reason);
  const rec = request(env).record;
  until(env, rec, ENDS, 2);
  assert.equal(rec.state, 'delivered_to_yard'); assert.equal(rec.attachment.day, plan.arriveDay); assert.equal(rec.endedDay, plan.deliverDay);
  log.eta = { plan: [plan.outboundDays, plan.towDays, plan.towSpeed, plan.deliverDay], delivered: rec.endedDay };
});
test('preservation', 'R10. save/load mid-tow keeps the exact leg, leg arrival day, ETA and tow speed; both runs then deliver on the same day', () => {
  const env = scenario('TA-10', { hulkAt: IDX.Qonos, tugAt: IDX.Qonos });
  env.relations['terran:klingon'] = 'peace';
  const rec = request(env, { yard: IDX.Earth }).record;
  run(env.book, env.world, 2, 20);
  const t1 = C.journeyById(env.book, rec.inbound.journeyId);
  const b2 = reload(env.book);
  const r2 = b2.hullRecoveries.find((x) => x.id === rec.id), t2 = C.journeyById(b2, rec.inbound.journeyId);
  assert.deepEqual([t2.legIndex, t2.legArrivalDay, t2.etaDay, t2.speed, t2.from], [t1.legIndex, t1.legArrivalDay, t1.etaDay, t1.speed, t1.from]);
  run(env.book, env.world, 21, 120); run(b2, env.world, 21, 120);
  assert.equal(r2.endedDay, rec.endedDay); assert.equal(r2.state, 'delivered_to_yard');
});

// ===================================================================================================
// Blockades and cloak (R11–R13), tow damage (R14, R15)
// ===================================================================================================
test('preservation', 'R11. a tow crossing a blockade is run once, by the shared resolver, on the blockade\'s own record, under the tow journey, with the casualty in the runner', () => {
  const env = scenario('TA-11', { hulkAt: IDX.Minor, tugAt: IDX.Minor });
  const b = blockadeAt(env, IDX.Vega, 3);
  const rec = request(env, { yard: IDX.Earth }).record;
  const tow = C.journeyById(env.book, rec.inbound.journeyId);
  const runs = [];
  for (let d = 2; d < 80 && !runs.length; d++) runs.push(...C.advanceCampaignDay(env.book, env.world, d).filter((x) => x.type === 'blockadeRun'));
  assert.equal(runs.length, 1); assert.equal(runs[0].journeyKind, 'recovery');
  assert.ok(String(runs[0].key).includes(tow.id) || runs[0].journeyId === tow.id);
  assert.ok(runs[0].hulls.some((x) => x.hullId === env.h.id && x.towed !== false));
  assert.equal((b.runs || []).length, 1);
});
test('preservation', 'R12/R13. the shared odds: a tow is easier to catch than the tug alone (its dash is the tow speed, its signature larger); escorts improve it; a cloaked towing group with an uncloaked casualty gets no cloak benefit', () => {
  const env = scenario('TA-12');
  const b = blockadeAt(env, IDX.Vega, 6);
  const tug = { hullId: 't', shipId: K.tug2.id, hull: SHIPS[K.tug2.id].combatHull, maxHull: SHIPS[K.tug2.id].combatHull };
  const hulk = { hullId: 'h', shipId: K.danube.id, hull: 5, maxHull: SHIPS[K.danube.id].combatHull, towed: true };
  const esc = [1, 2, 3].map((i) => ({ hullId: `e${i}`, shipId: K.galaxy.id, hull: SHIPS[K.galaxy.id].combatHull, maxHull: SHIPS[K.galaxy.id].combatHull }));
  const A = (k, hulls, extra = {}) => C.assessBlockadeRun(env.book, env.world, b, { key: k, sponsor: 'terran', hulls, ...extra });
  const alone = A('a', [tug]), towing = A('b', [tug, hulk], { towSpeed: 0.64 }), escorted = A('c', [tug, hulk, ...esc], { towSpeed: 0.64 });
  assert.ok(towing.speed < alone.speed && towing.signature > alone.signature && towing.pPass < alone.pPass);
  assert.ok(escorted.pPass > towing.pPass);
  const cl = { hullId: 'x', shipId: 9326, hull: SHIPS[9326].combatHull, maxHull: SHIPS[9326].combatHull };
  const cloakedAlone = A('d', [cl]), cloakedTow = A('e', [cl, { ...hulk, hullId: 'y' }], { towSpeed: 0.9 });
  assert.equal(cloakedAlone.cloakAll, true); assert.equal(cloakedTow.cloakAll, false, 'a towed hulk was cloaked with the tug');
  assert.ok(cloakedTow.pDetect > cloakedAlone.pDetect);
  log.odds = { alone: alone.pPass, towing: towing.pPass, escorted: escorted.pPass, cloakedAlone: cloakedAlone.pDetect, cloakedTow: cloakedTow.pDetect };
});
test('preservation', 'R14. the tow vessel disabled mid-route: both hulls stop at the actual system — the tow was let go there, the casualty is still disabled, the tug is stranded there in its own right, and a new recovery may later be sent', () => {
  const env = scenario('TA-14', { hulkAt: IDX.Qonos, tugAt: IDX.Qonos });
  env.relations['terran:klingon'] = 'peace';
  const rec = request(env, { yard: IDX.Earth }).record;
  const tow = C.journeyById(env.book, rec.inbound.journeyId);
  // Disabled on the first leg (Qonos → Border): it drops out where it last stood.
  run(env.book, env.world, 2, 3);
  env.t.hull = Math.max(1, Math.floor(env.t.maxHull * 0.05));
  run(env.book, env.world, 4, tow.legArrivalDay + 2);
  assert.equal(rec.state, 'failed', JSON.stringify(rec.history));
  assert.equal(env.h.systemIndex, env.t.systemIndex, `casualty at ${env.h.systemIndex}, tug at ${env.t.systemIndex}`);
  assert.ok(C.hullIsDisabled(env.h) && C.hullIsDisabled(env.t));
  assert.ok(env.t.stranded, 'the tug is not stranded'); assert.equal(env.h.stranded.recovery, 'awaiting_recovery');
  assert.ok(!env.h.transit && !env.t.transit);
  log.tugDisabled = { at: env.h.systemIndex, history: rec.history.map((x) => `${x.day} ${x.state} ${x.note}`) };
});
test('preservation', 'R15. the tow vessel destroyed: the casualty is neither destroyed nor moved on — it stays stranded where the tow last stood', () => {
  const env = scenario('TA-15', { hulkAt: IDX.Qonos, tugAt: IDX.Qonos });
  env.relations['terran:klingon'] = 'peace';
  const rec = request(env, { yard: IDX.Earth }).record;
  run(env.book, env.world, 2, 3);
  env.t.status = 'lost'; env.t.hull = 0;
  run(env.book, env.world, 4, 40);
  assert.equal(rec.state, 'failed'); assert.notEqual(env.h.status, 'lost');
  assert.equal(env.h.systemIndex, IDX.Qonos); assert.equal(env.h.stranded.recovery, 'awaiting_recovery');
});

test('baseline-defect', 'A11. a casualty in tow, in warp, is at no system: a Klingon assault that falls on the system the tow just left does not finish her off there (on a7e56d2 the defender losses took every disabled hull whose systemIndex was that system, warp or not)', () => {
  let hit = null;
  for (let i = 0; i < 12 && !hit; i++) {
    const env = scenario(`TA-A11-${i}`, { hulkAt: IDX.Minor, tugAt: IDX.Minor });
    const rec = request(env, { yard: IDX.Vega }).record;
    assert.ok(env.h.transit, 'the casualty is not in warp');
    const hull0 = env.h.hull;
    // Minor is defended (a battle, with losses on its side), so the defender losses are actually dealt.
    const def = P(env.book, 'terran').hulls.filter((h) => h.status === 'ready' && !made.has(h)).slice(0, 3);
    for (const d of def) { d.systemIndex = IDX.Minor; made.add(d); }
    const ks = P(env.book, 'klingon').hulls.filter((h) => h.status === 'ready' && !made.has(h)).slice(0, 12);
    for (const k of ks) { k.systemIndex = IDX.Vega; made.add(k); }
    const fx = [];
    C.launchOperation(env.book, env.world, 'klingon', ks, IDX.Minor, 1, 1, 'assault', fx);
    const op = env.book.operations.at(-1);
    for (let d = 2; d < 17 && op.status !== 'resolved'; d++) run(env.book, env.world, d, d);
    if (op.engagedDay != null && def.some((d) => d.hull < d.maxHull || d.status === 'lost')) hit = { env, rec, hull0, op };
  }
  assert.ok(hit, 'no assault reached Minor while the tow was in warp');
  const { env, rec, hull0, op } = hit;
  log.a11 = { op: { status: op.status, outcome: op.outcome, engaged: op.engagedDay, defenderLosses: op.defenderLosses }, hulk: { status: env.h.status, hull: env.h.hull, transit: Boolean(env.h.transit) }, rec: rec.state };
  assert.notEqual(env.h.status, 'lost', `the casualty in warp was destroyed at the system she had left (${JSON.stringify(log.a11)})`);
  assert.equal(env.h.hull, hull0);
});
test('baseline-defect', 'A12. a casualty gone from the books in mid-leg (destroyed elsewhere) ends the tow at the next crossing: the mission fails there and its tug is not flown on to the yard with nothing in tow (on a7e56d2 the tow flew on to its destination and only failed on arrival)', () => {
  const env = scenario('TA-A12', { hulkAt: IDX.Qonos, tugAt: IDX.Qonos });
  env.relations['terran:klingon'] = 'peace';
  const rec = request(env, { yard: IDX.Earth }).record;
  const tow = C.journeyById(env.book, rec.inbound.journeyId);
  const firstCross = tow.legArrivalDay;
  run(env.book, env.world, 2, 3);
  env.h.status = 'lost'; env.h.hull = 0; // destroyed somewhere the tow did not see, and taken off the books
  P(env.book, 'terran').hulls = P(env.book, 'terran').hulls.filter((h) => h !== env.h);
  run(env.book, env.world, 4, firstCross);
  log.a12 = { state: rec.state, endedDay: rec.endedDay, firstCross, eta: tow.etaDay, reason: rec.reason };
  assert.equal(rec.state, 'failed', `still ${rec.state} after the first crossing (day ${firstCross}); the tow was due at the yard day ${tow.etaDay}`);
  assert.equal(rec.endedDay, firstCross);
  run(env.book, env.world, firstCross + 1, firstCross + 30);
  assert.notEqual(env.t.systemIndex, IDX.Earth, 'the tug flew on to the yard with nothing in tow');
});

// ===================================================================================================
// Crew (R16–R18), repair only at a yard (R19, R20)
// ===================================================================================================
test('preservation', 'R16/R17. crew rescued before the recovery stay rescued: towed in empty, never re-crewed by the tow or the yard; repaired, she waits for a crew (repaired-awaiting-crew), not operational', () => {
  const env = scenario('TA-16', { crew: 'rescued' });
  const rec = request(env).record;
  for (let d = 2; d < 200 && (C.hullIsDisabled(env.h) || rec.state !== 'delivered_to_yard'); d++) { run(env.book, env.world, d, d); assert.notEqual(env.h.stranded?.crew, 'aboard'); }
  assert.ok(!C.hullIsDisabled(env.h)); assert.ok(env.h.recrew); assert.equal(C.hullAwaitingCrew(env.h), true);
  assert.ok(Number(env.h.crew) < 0.5);
});
test('preservation', 'R18. crew aboard do not disappear under tow: a tow outlasting their life support delivers them alive; repaired, she is back with her own crew', () => {
  const env = scenario('TA-18', { hulkAt: IDX.Qonos });
  env.relations['terran:klingon'] = 'peace';
  const plan = C.planHullRecovery(env.book, env.world, { sponsor: 'terran', targetHullId: env.h.id, tugHullId: env.t.id, yard: IDX.Earth }, 1);
  env.h.stranded.crewUntil = plan.arriveDay + 3; // alive when the tug arrives; the tow lasts far longer
  const rec = request(env, { yard: IDX.Earth }).record;
  until(env, rec, ENDS, 2);
  assert.equal(rec.state, 'delivered_to_yard'); assert.ok(rec.endedDay > plan.arriveDay + 3, `delivered day ${rec.endedDay}`);
  assert.equal(env.h.stranded.crew, 'aboard');
});
test('preservation', 'R19. repair starts only after reaching a valid yard: the hull figure is unchanged through the outbound, the tow and the yard\'s intake; it first rises in the yard', () => {
  const env = scenario('TA-19');
  const hull0 = env.h.hull;
  const rec = request(env).record;
  let firstRise = null, prev = null;
  for (let d = 2; d < 160 && firstRise == null; d++) { prev = env.h.stranded?.recovery; run(env.book, env.world, d, d); if (env.h.hull > hull0) firstRise = { d, state: rec.state, recovery: prev, at: env.h.systemIndex }; }
  assert.ok(firstRise, 'never repaired');
  assert.equal(firstRise.state, 'delivered_to_yard'); assert.equal(firstRise.at, rec.yard); assert.ok(['recovering', 'in_yard'].includes(firstRise.recovery), `the yard did not have her: ${firstRise.recovery}`);
  assert.ok(firstRise.d > rec.endedDay);
});
test('preservation', 'R20. a yard captured before the tow arrives is not delivered to (re-chosen at the boundary); a yard captured after delivery repairs nothing while it is lost', () => {
  const env = scenario('TA-20a', { hulkAt: IDX.Romulus, tugAt: IDX.Romulus });
  env.relations['terran:romulan'] = 'peace';
  const rec = request(env, { yard: IDX.Earth }).record;
  run(env.book, env.world, 2, 3);
  env.world.systems[IDX.Earth].controller = 'klingon';
  until(env, rec, ENDS, 4);
  assert.equal(rec.state, 'delivered_to_yard'); assert.equal(rec.yard, IDX.Vega);
  const e2 = scenario('TA-20b');
  const r2 = request(e2).record;
  const end = until(e2, r2, ENDS, 2);
  const hull0 = e2.h.hull;
  e2.world.systems[r2.yard].controller = 'klingon';
  run(e2.book, e2.world, end + 1, end + 30);
  assert.equal(e2.h.hull, hull0, 'repaired in a lost yard');
  assert.equal(e2.h.stranded.recovery, 'awaiting_recovery');
});

// ===================================================================================================
// Doctrine (R22), salvage (R23–R27)
// ===================================================================================================
test('preservation', 'R22. doctrine recovery uses the same system: a doctrine relief rescue takes the crew off and moves nothing; the AI\'s hull recovery is a book.hullRecoveries mission flown by a real tug, like the captain\'s', () => {
  const env = scenario('TA-22', { hulk: K.galaxy.id });
  const at = env.h.systemIndex;
  C.rescueStrandedCrew(env.book, 'terran', env.h.id, 2, 'doctrine:relief');
  assert.equal(env.h.stranded.crew, 'rescued'); assert.equal(env.h.systemIndex, at); assert.ok(C.hullIsDisabled(env.h));
  env.book.config.aiRecovery = true;
  run(env.book, env.world, 3, 12);
  const rec = (env.book.hullRecoveries || []).find((r) => String(r.target.hullId) === String(env.h.id));
  assert.ok(rec, 'the AI did not send a tug'); assert.equal(rec.requestedBy, 'ai'); assert.equal(rec.tug.hullId, env.t.id);
});
function enemyHulk(seed, { at = IDX.Minor, crew = 'lost', relation = 'war', hulk = K.vorcha.id } = {}) {
  const env = campaignWorld(seed);
  env.relations['terran:klingon'] = relation;
  const [t] = make(env, 'terran', K.tug2.id, IDX.Vega);
  const [k] = make(env, 'klingon', hulk, at);
  park(env);
  disable(env, k, 1, 'klingon');
  if (crew === 'lost') { k.stranded.crew = 'lost'; k.stranded.crewEndDay = 1; k.crew = 0; }
  return { ...env, t, k };
}
test('preservation', 'R23/R24/R26/SALVAGE-PRIZE-HULL. a legitimately abandoned (crewless, at war) Klingon Vor\'cha in Terran space is salvaged physically: the same record, vid, class, damage, origin and history; ownership transfer is explicit (provenance, salvagedFrom, stats, effect); it must still be towed, repaired and re-crewed before it serves', () => {
  const env = enemyHulk('TA-23');
  const before = { vid: vidOf(env.k), hull: env.k.hull, max: env.k.maxHull, shipId: env.k.shipId, origin: env.k.identity?.origin?.builder, history: (env.k.identity?.history || []).length };
  const fx = [];
  const r = C.requestHullRecovery(env.book, env.world, { sponsor: 'terran', targetHullId: env.k.id, tugHullId: env.t.id }, 1, fx);
  assert.ok(r.ok, r.reason); assert.equal(r.record.kind, 'salvage');
  const att = r.record.plan.arriveDay;
  run(env.book, env.world, 2, att, (e) => fx.push(e));
  assert.equal(env.k.hull, before.hull, 'damage changed at attachment'); assert.equal(env.k.maxHull, before.max);
  assert.ok(P(env.book, 'terran').hulls.includes(env.k)); assert.ok(!P(env.book, 'klingon').hulls.includes(env.k));
  assert.equal(env.k.salvagedFrom, 'klingon');
  assert.equal(env.k.identity.history.length, before.history + 1);
  assert.deepEqual(env.k.identity.history.at(-1), { ...env.k.identity.history.at(-1), event: 'salvaged', from: 'klingon', to: 'terran' });
  assert.ok(fx.some((e) => e.type === 'hullSalvaged' && e.from === 'klingon'));
  assert.ok(C.hullIsDisabled(env.k), 'salvage → pristine');
  until(env, r.record, ENDS, att + 1);
  for (let d = env.book.settled + 1; d < env.book.settled + 200 && C.hullIsDisabled(env.k); d++) run(env.book, env.world, d, d);
  assert.ok(!C.hullIsDisabled(env.k)); assert.ok(env.k.recrew, 'a crewless prize served without a crew');
  assert.deepEqual([vidOf(env.k), env.k.shipId, env.k.identity.origin.builder], [before.vid, before.shipId, before.origin]);
  assert.equal(allVids(env.book).filter((v) => v === before.vid).length, 1);
  log.salvage = { before, after: { hull: env.k.hull, recrew: env.k.recrew, provenance: env.k.identity.history.at(-1) } };
});
test('preservation', 'R25. salvaging one enemy hull unlocks no enemy production: the salvager\'s licences, integrations, queue and the design records are unchanged; the old owner\'s queue too', () => {
  const env = enemyHulk('TA-25');
  const snap = () => JSON.stringify({ lic: P(env.book, 'terran').licenses, integ: P(env.book, 'terran').integrations, q: P(env.book, 'terran').queue.map((x) => x.shipId), kq: P(env.book, 'klingon').queue.map((x) => x.shipId), designs: env.book.designs });
  const s0 = snap();
  const r = C.requestHullRecovery(env.book, env.world, { sponsor: 'terran', targetHullId: env.k.id, tugHullId: env.t.id }, 1, []);
  until(env, r.record, ENDS, 2);
  assert.equal(r.record.state, 'delivered_to_yard');
  assert.equal(snap(), s0);
});
test('preservation', 'R27. a disabled enemy hull is not salvaged merely because someone is nearby: a Terran ship at the same system for 60 days takes nothing; the AI, allowed to act, does not take a crewed one', () => {
  const env = enemyHulk('TA-27', { crew: 'aboard' });
  env.t.systemIndex = IDX.Minor;
  env.book.config.aiRecovery = true; env.book.config.aiSalvageMinValue = 1;
  run(env.book, env.world, 2, 15);
  assert.ok(P(env.book, 'klingon').hulls.includes(env.k)); assert.ok(!P(env.book, 'terran').hulls.includes(env.k));
  assert.match(C.recoveryClaim(env.book, env.world, 'terran', env.k.id).reason, /crewed/);
  const quiet = enemyHulk('TA-27b');
  quiet.t.systemIndex = IDX.Minor;
  run(quiet.book, quiet.world, 2, 60);
  assert.ok(P(quiet.book, 'klingon').hulls.includes(quiet.k) || quiet.k.fate === 'written_off', 'changed hands with no recovery');
  assert.equal((quiet.book.hullRecoveries || []).length, 0);
});

// ===================================================================================================
// Treaties (R28–R30)
// ===================================================================================================
test('baseline-defect', 'R28. treaty movement: a DMZ on Vega that prohibits recovery traffic holds the tow Minor → Earth (no lawful way); a Klingon transit guarantee to the Terrans for RECOVERY traffic at Vega lifts it and the tow goes through (on a7e56d2 a recovery-scoped guarantee covered nothing: A10)', () => {
  const env = scenario('TA-28', { hulkAt: IDX.Minor, tugAt: IDX.Minor });
  env.relations['terran:klingon'] = 'peace';
  const d = C.addTreatyTerm(env.book, env.world, { type: 'dmz', parties: ['terran', 'klingon'], systems: [IDX.Vega], recovery: 'prohibited' }, 1, []);
  assert.ok(d.ok, d.reason);
  const first = request(env, { yard: IDX.Earth });
  assert.equal(first.ok, false, 'a tow was planned through the DMZ'); assert.match(first.reason, /no yard|treaty|route/);
  run(env.book, env.world, 2, 4);
  assert.equal(env.h.systemIndex, IDX.Minor);
  const g = C.addTreatyTerm(env.book, env.world, { type: 'transit', grantor: 'klingon', beneficiary: 'terran', systems: [IDX.Vega], traffic: ['recovery'] }, 4, []);
  assert.ok(g.ok, g.reason);
  assert.equal(C.treatyBarredAt(env.book, 'terran', 'recovery', IDX.Vega, 4), false, 'the recovery guarantee did not lift the DMZ for recovery traffic');
  const again = C.requestHullRecovery(env.book, env.world, { sponsor: 'terran', targetHullId: env.h.id, tugHullId: env.t.id, yard: IDX.Earth }, 5, []);
  assert.ok(again.ok, again.reason); run(env.book, env.world, 6, 80);
  assert.equal(env.h.systemIndex, IDX.Earth, `the tow did not get through: at ${env.h.systemIndex}`);
});
test('baseline-defect', 'R29/R30. foreign basing: a host yard is a tow destination only with rights to take her in AND repair her (recovery-only basing left her unrepaired for ever on a7e56d2: A4); with both, she is towed there, repaired there, and stays the guest\'s — the yard and the system stay the host\'s', () => {
  const env = scenario('TA-29', { hulkAt: IDX.Border, tugAt: IDX.Border });
  env.relations['terran:klingon'] = 'peace';
  // Terran yards closed to her: Earth and Vega taken by a third party, so the only yards are foreign.
  env.world.systems[IDX.Earth].controller = 'romulan'; env.world.systems[IDX.Vega].controller = 'romulan';
  env.relations['terran:romulan'] = 'war';
  C.addTreatyTerm(env.book, env.world, { type: 'basing', host: 'klingon', guest: 'terran', systems: [IDX.Qonos], purposes: ['recovery'] }, 1, []);
  const p1 = C.planHullRecovery(env.book, env.world, { sponsor: 'terran', targetHullId: env.h.id, tugHullId: env.t.id }, 1);
  assert.equal(p1.ok, false, `recovery-only basing made Qonos a destination (yard ${p1.yard})`);
  C.addTreatyTerm(env.book, env.world, { type: 'basing', host: 'klingon', guest: 'terran', systems: [IDX.Qonos], purposes: ['repair'] }, 1, []);
  const rec = request(env).record;
  assert.ok(rec, 'not started'); assert.equal(rec.yard, IDX.Qonos);
  until(env, rec, ENDS, 2);
  for (let d = env.book.settled + 1; d < env.book.settled + 150 && C.hullIsDisabled(env.h); d++) run(env.book, env.world, d, d);
  assert.ok(!C.hullIsDisabled(env.h), 'never repaired at the host yard');
  assert.ok(P(env.book, 'terran').hulls.includes(env.h)); assert.ok(!P(env.book, 'klingon').hulls.includes(env.h));
  assert.equal(env.world.systems[IDX.Qonos].controller, 'klingon');
});

// ===================================================================================================
// Handoff (R31), duplication (R32)
// ===================================================================================================
test('preservation', 'R31. a tow intercepted where the captain is goes to the scene once: the crossing is held (no strategic run alongside), the encounter result is written back once, and the casualty is never in the scene', () => {
  let done = null;
  for (let i = 0; i < 80 && !done; i++) {
    const env = scenario(`TA-31-${i}`, { hulkAt: IDX.Minor, tugAt: IDX.Minor });
    const b = blockadeAt(env, IDX.Vega, 14);
    env.world.localSystem = IDX.Vega;
    const rec = request(env, { yard: IDX.Earth }).record;
    run(env.book, env.world, 2, 21);
    const enc = (env.book.encounters || []).find((e) => e.type === 'blockade');
    if (enc) done = { env, rec, enc, b };
  }
  assert.ok(done, 'no seed gave an intercepted tow');
  const { env, rec, enc, b } = done;
  assert.equal((b.runs || []).length, 0, 'the crossing was also run strategically');
  assert.equal(enc.participants.find((p) => p.hullId === env.h.id)?.spawn, false);
  const parts = Object.fromEntries(enc.participants.map((p) => [p.ref, { fate: 'survived', hull: p.before?.hull ?? null }]));
  const r1 = C.resolveEncounterNow(env.book, env.world, enc.id, { result: { outcome: 'passed' }, participants: parts }, 21, []);
  assert.ok(r1.ok, r1.reason);
  const r2 = C.resolveEncounterNow(env.book, env.world, enc.id, { result: { outcome: 'passed' }, participants: parts }, 21, []);
  assert.equal(r2.ok, false, 'resolved twice');
  until(env, rec, ENDS, 22);
  assert.equal(rec.state, 'delivered_to_yard'); assert.equal(env.h.systemIndex, IDX.Earth);
});
test('preservation', 'R32. no persistent vessel duplication: across a recovery, a salvage and a tug loss, every vid exists exactly once', () => {
  const a = scenario('TA-32a'); const ra = request(a).record; until(a, ra, ENDS, 2);
  const b = enemyHulk('TA-32b'); const rb = C.requestHullRecovery(b.book, b.world, { sponsor: 'terran', targetHullId: b.k.id, tugHullId: b.t.id }, 1, []).record; until(b, rb, ENDS, 2);
  for (const env of [a, b]) { const v = allVids(env.book); assert.equal(new Set(v).size, v.length, 'duplicated vid'); }
});

// ===================================================================================================
// The lifecycle record (A6)
// ===================================================================================================
test('baseline-defect', 'LIFECYCLE. one record carries the brief\'s phases from request to back in service: recovery_asset_en_route → tow_attached/towing → in_yard → repairing → recrew_if_required → complete (on a7e56d2 the record stopped at the yard gate)', () => {
  const env = scenario('TA-L', { crew: 'rescued', hulk: K.galaxy.id });
  env.book.config.crewRecoveryPerDay = 0.1;
  const rec = request(env, { yard: IDX.Earth }).record;
  const phases = [];
  const note = () => { const p = REC.recoveryPhase ? REC.recoveryPhase(rec) : rec.state; if (phases.at(-1) !== p) phases.push(p); };
  note();
  for (let d = 2; d < 260 && phases.at(-1) !== 'complete'; d++) { run(env.book, env.world, d, d); note(); }
  // The record's own phase log (a phase passed within one day is in it).
  for (const x of rec.after?.history || []) if (!phases.includes(x.phase)) phases.splice(phases.indexOf('in_yard') + 1, 0, x.phase);
  log.lifecycle = { phases, after: rec.after };
  for (const p of ['recovery_asset_en_route', 'towing', 'in_yard', 'repairing', 'recrew_if_required', 'complete']) assert.ok(phases.includes(p), `missing ${p}: ${phases.join(' → ')}`);
  assert.ok(rec.completedDay > rec.endedDay);
});

// ===================================================================================================
// Integrated: STRANDED-HULL-RECOVERY and TOW-UNDER-INTERDICTION
// ===================================================================================================
test('new-feature', 'STRANDED-HULL-RECOVERY. a Galaxy disabled at Qonos (three legs from Earth) with her crew in distress; the crew are rescued separately; days later a real tug flies out; the hull is towed over several systems; the game is saved and reloaded mid-tow; she reaches the Earth yard, is repaired, waits for a crew, is re-crewed, and the same vid returns to service', () => {
  const env = scenario('TA-SHR', { hulk: K.galaxy.id, hulkAt: IDX.Qonos, tugAt: IDX.Earth });
  env.relations['terran:klingon'] = 'peace';
  env.book.config.crewRecoveryPerDay = 0.1;
  const vid0 = vidOf(env.h);
  assert.ok(env.h.stranded.crewUntil > 1, 'no distress clock');
  run(env.book, env.world, 2, 8);
  C.rescueStrandedCrew(env.book, 'terran', env.h.id, 8, 'relief');
  run(env.book, env.world, 9, 15);
  assert.equal(env.h.systemIndex, IDX.Qonos);
  const rec0 = C.requestHullRecovery(env.book, env.world, { sponsor: 'terran', targetHullId: env.h.id, tugHullId: env.t.id, yard: IDX.Earth }, 16, []).record;
  assert.ok(rec0, 'not started');
  until(env, rec0, ['towing'], 17);
  const towDay = env.book.settled;
  run(env.book, env.world, towDay + 1, towDay + 10);
  const book = reload(env.book);
  const h = P(book, 'terran').hulls.find((x) => x.id === env.h.id);
  const rec = book.hullRecoveries.find((x) => x.id === rec0.id);
  const t1 = C.journeyById(env.book, rec0.inbound.journeyId), t2 = C.journeyById(book, rec0.inbound.journeyId);
  assert.deepEqual([t2.legIndex, t2.legArrivalDay, t2.etaDay], [t1.legIndex, t1.legArrivalDay, t1.etaDay]);
  const env2 = { ...env, book };
  until(env2, rec, ENDS, towDay + 11);
  assert.equal(rec.state, 'delivered_to_yard'); assert.equal(h.systemIndex, IDX.Earth);
  assert.ok(rec.inbound.route.length >= 4, `tow route ${rec.inbound.route}`);
  assert.ok(rec.outbound.route.length >= 4, `out route ${rec.outbound.route}`);
  let recommissioned = null;
  for (let d = book.settled + 1; d < book.settled + 200 && recommissioned == null; d++) run(book, env.world, d, d, (e) => { if (e.type === 'hullRecommissioned' && e.hullId === h.id) recommissioned = d; });
  assert.ok(recommissioned, 'never re-crewed');
  run(book, env.world, book.settled + 1, book.settled + 1);
  assert.equal(vidOf(h), vid0); assert.equal(h.stranded, undefined); assert.ok(!h.recrew); assert.ok(['ready', 'assigned'].includes(h.status), h.status);
  assert.equal(rec.after.phase, 'complete');
  log.strandedHullRecovery = { out: rec.outbound.route, tow: rec.inbound.route, towSpeed: rec.inbound.towSpeed, delivered: rec.endedDay, recommissioned, phases: rec.after.history };
});
test('new-feature', 'TOW-UNDER-INTERDICTION. a tug attaches its casualty at Minor; the route home crosses a Klingon blockade at Vega; the tow\'s lower speed makes it worse than the tug alone; with escorts it does better; one branch is forced back and one gets through; no hull is ever teleported', () => {
  let unescorted = null, escorted = null;
  for (let i = 0; i < 160 && !(unescorted && escorted); i++) {
    for (const esc of [false, true]) {
      if ((esc && escorted) || (!esc && unescorted)) continue;
      const env = scenario(`TA-TUI-${esc ? 'e' : 'u'}-${i}`, { hulkAt: IDX.Minor, tugAt: IDX.Minor, escorts: esc ? [K.galaxy.id, K.galaxy.id, K.sovereign.id] : [] });
      blockadeAt(env, IDX.Vega, 6);
      const rec = request(env, { yard: IDX.Earth }).record;
      const trail = [[1, env.h.systemIndex]];
      let forcedBack = false;
      for (let d = 2; d < 90 && !ENDS.includes(rec.state); d++) {
        const fx = C.advanceCampaignDay(env.book, env.world, d);
        if (fx.some((e) => e.type === 'blockadeRun' && /forced|turned|back/.test(String(e.outcome)))) forcedBack = true;
        if (trail.at(-1)[1] !== env.h.systemIndex) trail.push([d, env.h.systemIndex]);
        if (forcedBack && !esc) break;
      }
      // Every move of the casualty is along a charted leg.
      for (let k = 1; k < trail.length; k++) assert.ok(LEGS[`${trail[k - 1][1]}:${trail[k][1]}`] || LEGS[`${trail[k][1]}:${trail[k - 1][1]}`], `teleported ${trail[k - 1][1]} → ${trail[k][1]}`);
      if (!esc && forcedBack) unescorted = { seed: i, trail, history: rec.history.map((x) => `${x.day} ${x.state} ${x.note}`) };
      if (esc && rec.state === 'delivered_to_yard' && env.h.systemIndex === IDX.Earth) escorted = { seed: i, trail, delivered: rec.endedDay };
    }
  }
  log.towUnderInterdiction = { unescorted, escorted };
  assert.ok(unescorted, 'no unescorted tow was forced back'); assert.ok(escorted, 'no escorted tow got through');
  // The odds behind it, on the same blockade.
  const env = scenario('TA-TUI-odds');
  const b = blockadeAt(env, IDX.Vega, 6);
  const tug = { hullId: 't', shipId: K.tug2.id, hull: SHIPS[K.tug2.id].combatHull, maxHull: SHIPS[K.tug2.id].combatHull };
  const hulk = { hullId: 'h', shipId: K.danube.id, hull: 5, maxHull: SHIPS[K.danube.id].combatHull, towed: true };
  const fastTow = C.assessBlockadeRun(env.book, env.world, b, { key: 'f', sponsor: 'terran', hulls: [tug, hulk], towSpeed: 0.92 });
  const slowTow = C.assessBlockadeRun(env.book, env.world, b, { key: 's', sponsor: 'terran', hulls: [tug, hulk], towSpeed: 0.64 });
  assert.ok(slowTow.pPass < fastTow.pPass, 'the tow\'s lower speed did not matter');
  log.towUnderInterdiction.odds = { at092: fastTow.pPass, at064: slowTow.pPass };
});

const failed = results.filter((r) => !r.ok);
const by = (t) => `${t} ${results.filter((r) => r.tag === t && r.ok).length}/${results.filter((r) => r.tag === t).length}`;
const summary = `towing audit pure: ${results.length - failed.length}/${results.length} (${by('baseline-defect')}, ${by('new-feature')}, ${by('preservation')})${failed.length ? ` — FAILED: ${failed.map((f) => f.name.split(' ')[0]).join(', ')}` : ''}`;
console.log(`\n${summary}`);
if (out) { fs.mkdirSync(out, { recursive: true }); fs.writeFileSync(path.join(out, process.env.BM1_TOWAUDIT_ROOT ? 'towing-audit-pure-baseline.json' : 'towing-audit-pure.json'), JSON.stringify({ summary, results, log }, null, 2)); }
process.exit(failed.length ? 1 : 0);
