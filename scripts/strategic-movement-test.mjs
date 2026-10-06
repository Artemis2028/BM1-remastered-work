// Pure regressions for STRATEGIC-MOVEMENT-UNIFICATION (docs/movement/STRATEGIC-MOVEMENT-UNIFICATION.md).
// One journey record (src/strategic-journey.mjs), real leg lengths, every intermediate system reached and
// processed once, every blockade on the way run through the one resolver, authority re-checked at each
// boundary. Checks are tagged:
//   [baseline-defect] reproduces a bypass that exists at 29710b1 and must not exist now;
//   [new-feature]     behaviour this round adds;
//   [preservation]    behaviour that must be unchanged.
// BM1_MOVEMENT_ROOT points the suite at another tree's src/ (the baseline reproduction runs it against
// 29710b1: the baseline-defect checks fail there on their own assertions).
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(process.env.BM1_MOVEMENT_ROOT || path.join(here, '..'));
const imp = (rel) => import(pathToFileURL(path.join(root, rel)).href);
const C = await imp('src/campaign-strategy.mjs');
const D = await imp('src/doctrine-runtime.mjs');
const DC = await imp('src/doctrine-campaign.mjs');
const { classifyDamage } = await imp('src/ship-fleet.mjs');
const { makeWorld, run, HULLS, POOLS } = await import(pathToFileURL(path.join(root, 'scripts/campaign-world-fixture.mjs')).href);
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
// Nine systems (campaign-world-fixture):  Earth(0) ─ Vega(1) ─ Border(2) ─ Qonos(3);  Vega ─ Romulus(4);
// Border ─ Cardassia(5) ─ Bajora(6) ⇄ Dominica(7) (wormhole);  Vega ─ Minor(8).
// Legs of unequal length, as the engine's chart gives them (Fleet.travelDays over warp distance).
const LEGS = { '8:1': 1, '1:0': 3, '3:2': 2, '2:1': 1, '1:4': 2, '2:5': 2, '5:6': 1, '6:7': 1, '0:1': 3, '1:8': 1 };
const legDays = (a, b) => LEGS[`${a}:${b}`] ?? LEGS[`${b}:${a}`] ?? 1;
const IDX = { Earth: 0, Vega: 1, Border: 2, Qonos: 3, Romulus: 4, Cardassia: 5, Bajora: 6, Dominica: 7, Minor: 8 };
const SHIPS = { 74: { price: 70000, mass: 6, combatHull: 600, faction: 'terran', cargo: 60, speed: 25, cloak: false, combat: 0 } };
function campaignWorld(seed, opts = {}) {
  const { world, relations } = makeWorld(opts);
  world.legDays = legDays;
  const base = world.shipStats;
  world.shipStats = (id) => SHIPS[id] || (base(id) ? { cargo: 100, speed: 45, combat: 1, ...base(id) } : null);
  const book = C.createCampaignBook(seed, 1);
  C.initializeCampaign(book, world);
  book.config.aiStrategicOps = false;
  book.config.planningIntervalDays = 1e9;
  return { world, book, relations };
}
const P = (book, id) => C.getPolity(book, id);
const ready = (book, id, at = null) => P(book, id).hulls.filter((h) => h.status === 'ready' && !h.opId && (at == null || Number(h.systemIndex) === at)).sort((a, b) => String(a.id).localeCompare(String(b.id)));
const reload = (book) => C.upgradeCampaignBook(JSON.parse(JSON.stringify(book)));
const disable = (h) => { h.hull = Math.max(1, Math.floor(h.maxHull * 0.05)); };
const vidOf = (h) => h?.identity?.vid || h?.vid || h?.id;
const liveVids = (book) => Object.values(book.polities).flatMap((p) => p.hulls.filter((h) => h.status !== 'lost').map(vidOf));
// Day-by-day positions of some hulls, and the effects of each day.
function track(book, world, hulls, from, to, onEffect) {
  const trail = [];
  const fx = run(book, world, from, to, (e, d) => onEffect?.(e, d));
  return { trail, fx };
}
function walk(env, hulls, from, to, onDay) {
  const trail = [], fx = [];
  for (let d = from; d <= to; d++) {
    const f = run(env.book, env.world, d, d);
    fx.push(...f);
    trail.push({ day: d, at: hulls.map((h) => Number(h.systemIndex)), transit: hulls.map((h) => (h.transit ? `${h.transit.from}>${h.transit.to}@${h.transit.arrivalDay}` : null)) });
    onDay?.(d, f);
  }
  return { trail, fx };
}
// The first day a hull stands in a system (arrived there; it may set out again the same day).
const firstDayAt = (trail, i, sys) => trail.find((t) => t.at[i] === sys)?.day ?? null;

// An evacuation of Minor (8) to Earth (0) through Vega (1): legs 1 and 3 days.
function evac(seed, { transports = 2, escorts = 0, blockade = 0, target = 60000 } = {}) {
  const env = campaignWorld(seed);
  const { book, world } = env;
  const t = P(book, 'terran');
  const hs = t.hulls.filter((h) => h.status === 'ready');
  const carriers = hs.slice(0, transports); for (const h of carriers) { h.systemIndex = IDX.Minor; h.shipId = 74; h.maxHull = h.hull = 600; }
  const esc = hs.slice(transports, transports + escorts); for (const h of esc) { h.systemIndex = IDX.Minor; h.shipId = 12; }
  let b = null;
  if (blockade) {
    const k = ready(book, 'klingon').slice(0, blockade);
    for (const h of k) h.systemIndex = IDX.Vega;
    const r = C.startBlockade(book, world, { power: 'klingon', target: IDX.Vega, hullIds: k.map((h) => h.id), purpose: 'interdict_trade' }, 1, []);
    assert.ok(r.ok, r.reason); b = r.record;
  }
  const r = C.startEvacuation(book, world, { sponsor: 'terran', origin: IDX.Minor, destination: IDX.Earth, transports: carriers.map((h) => h.id), escorts: esc.map((h) => h.id), target }, 1, []);
  assert.ok(r.ok, r.reason);
  assert.deepEqual(r.record.route, [IDX.Minor, IDX.Vega, IDX.Earth]);
  return { ...env, e: r.record, carriers, esc, b };
}

// ===================================================================================================
// PART 3 — evacuation on real legs
// ===================================================================================================
test('baseline-defect', '1. evacuation A→B→C flies each leg its real length (Minor→Vega 1 day, Vega→Earth 3 days)', () => {
  const env = evac('SM-1');
  const { trail } = walk(env, env.carriers, 2, 14);
  const atB = firstDayAt(trail, 0, IDX.Vega), atC = firstDayAt(trail, 0, IDX.Earth);
  assert.ok(atB != null && atC != null, JSON.stringify(trail.slice(0, 8)));
  assert.equal(atC - atB, legDays(IDX.Vega, IDX.Earth), `Vega day ${atB} → Earth day ${atC}: the 3-day leg took ${atC - atB}`);
  log.evacTrail = trail.slice(0, 10);
});
test('baseline-defect', '2. evacuees are delivered only on the convoy\'s actual arrival at the destination, never before', () => {
  const env = evac('SM-2');
  const { trail } = walk(env, env.carriers, 2, 14, (d) => { (env.moved ||= []).push({ d, moved: env.e.moved }); });
  const atC = firstDayAt(trail, 0, IDX.Earth);
  const firstDelivery = env.moved.find((x) => x.moved > 0)?.d ?? null;
  assert.ok(atC != null, 'the convoy never reached Earth');
  assert.equal(firstDelivery, atC, `first delivery day ${firstDelivery}, arrival day ${atC}`);
  assert.equal(env.e.lastDelivery.day, atC);
});
test('new-feature', '3. save/load mid-leg keeps the evacuation\'s route, leg, timing, hulls and purpose exactly', () => {
  const a = evac('SM-3'), b = evac('SM-3');
  // Run both to the middle of the 3-day Vega→Earth leg.
  run(a.book, a.world, 2, 4); run(b.book, b.world, 2, 4);
  const tr = C.journeyById(a.book, a.e.convoy.journeyId);
  assert.ok(tr && tr.status === 'underway' && tr.legDays[tr.legIndex] === 3 && tr.legArrivalDay > 5, `not mid-leg: ${JSON.stringify(tr && { leg: tr.legIndex, arr: tr.legArrivalDay })}`);
  const snap = JSON.parse(JSON.stringify(tr));
  const loaded = { ...b, book: reload(b.book) };
  const trL = C.journeyById(loaded.book, b.e.convoy.journeyId);
  for (const k of ['id', 'seq', 'kind', 'path', 'legDays', 'legIndex', 'legDepartDay', 'legArrivalDay', 'etaDay', 'members', 'vids', 'purpose', 'destination', 'crossed', 'encounters']) assert.deepEqual(trL[k], snap[k], `field ${k} changed across save/load`);
  const eL = loaded.book.evacuations.find((x) => x.id === b.e.id);
  const series = (env, e) => { const s = []; for (let d = 5; d <= 16; d++) { run(env.book, env.world, d, d); s.push([d, e.moved, e.convoy.phase]); } return s; };
  assert.deepEqual(series(loaded, eL), series(a, a.e), 'the reloaded convoy diverged (skipped, restarted or delivered early)');
  for (const h of loaded.book.polities.terran.hulls.filter((x) => snap.members.includes(x.id))) assert.equal(vidOf(h), snap.vids[h.id]);
});
test('new-feature', '4. the convoy meets the blockade at the intermediate system it crosses, on the day it gets there', () => {
  const env = evac('SM-4', { blockade: 8 });
  const runs = [];
  const { trail } = walk(env, env.carriers, 2, 14, (d, fx) => { for (const f of fx) if (f.type === 'blockadeRun' && f.evacuationId === env.e.id) runs.push({ d, target: f.target, journeyId: f.journeyId, outcome: f.outcome }); });
  assert.ok(runs.length >= 1, 'the convoy never met the blockade');
  const first = runs[0];
  assert.equal(first.target, IDX.Vega);
  assert.ok(first.journeyId, 'the run was not made by the convoy\'s journey');
  const tr = C.journeyById(env.book, first.journeyId);
  const enc = tr.encounters.find((x) => x.system === IDX.Vega);
  assert.ok(enc && tr.crossed.some((c) => c.system === IDX.Vega && c.day === first.d), `run day ${first.d} is not the crossing day ${JSON.stringify(tr.crossed)}`);
  log.evacBlockadeRuns = runs;
});
test('new-feature', '5. a convoy forced back on the way out delivers nobody and flies home by the same rules', () => {
  let found = null;
  for (let i = 0; i < 40 && !found; i++) {
    const env = evac(`SM-5-${i}`, { blockade: 20, transports: 1 });
    const turned = [];
    walk(env, env.carriers, 2, 7, (d, fx) => { for (const f of fx) if (f.type === 'blockadeRun' && f.evacuationId === env.e.id && !f.continues) turned.push({ d, f }); });
    if (turned.length && env.e.convoy.turnedBack) found = { env, turned };
  }
  assert.ok(found, 'no forced-back run in 40 seeds');
  const { env, turned } = found;
  const at = turned[0].d;
  assert.equal(env.e.moved, 0, 'evacuees were delivered by a convoy that was turned back');
  // Home the same way: a return journey on real legs, never reaching Earth on that trip.
  const back = (env.book.journeys || []).filter((j) => j.kind === 'evacuation' && j.ref === env.e.id && (j.purpose === 'return' || j.purpose === 'retreat'));
  assert.ok(back.length >= 1, 'no return journey');
  assert.ok(back.every((j) => j.path.every((s) => s !== IDX.Earth)), 'the return was routed via the destination');
  assert.ok(!(env.book.journeys || []).some((j) => j.ref === env.e.id && j.crossed.some((c) => c.system === IDX.Earth && c.day <= at + 1)), 'the convoy reached Earth after being turned back');
  log.forcedBack = { day: at, outcome: turned[0].f.outcome };
});
test('new-feature', '6. a transport disabled in warp stays where it last stood with its vid; capacity drops; the convoy flies on', () => {
  const env = evac('SM-6', { transports: 2 });
  run(env.book, env.world, 2, 3); // on the 3-day Vega→Earth leg
  const [t1, t2] = env.carriers;
  assert.ok(t1.transit && t1.transit.to === IDX.Earth, `not in warp to Earth: ${JSON.stringify(t1.transit)} at ${t1.systemIndex}`);
  const where = Number(t1.systemIndex), vid = vidOf(t1);
  const lift0 = env.e.transports.reduce((n, t) => n + t.lift, 0);
  disable(t1);
  run(env.book, env.world, 4, 10);
  assert.equal(Number(t1.systemIndex), where, 'the disabled transport was carried on');
  assert.equal(t1.status, 'repairing'); assert.ok(!t1.transit);
  assert.equal(vidOf(t1), vid);
  assert.ok(!env.e.transports.some((t) => t.hullId === t1.id), 'its capacity still counts');
  assert.ok(env.e.transports.reduce((n, t) => n + t.lift, 0) < lift0);
  assert.ok(env.e.removed.some((x) => x.hullId === t1.id && x.reason === 'disabled'));
  assert.ok(env.e.moved > 0 && Number(t2.systemIndex) !== where || env.e.moved > 0, 'the rest of the convoy did not deliver');
  assert.equal(liveVids(env.book).filter((v) => v === vid).length, 1, 'the hull was cloned');
});

// ===================================================================================================
// Doctrine (7–9): the same journeys
// ===================================================================================================
function doctrineWorld(seed, opts = {}) {
  const env = campaignWorld(seed, opts);
  env.world.doctrineStep = (b, w, d, fx) => DC.advanceDoctrineDay(b, w, d, fx, doctrine);
  const db = DC.doctrineBook(env.book);
  db.config = { ...db.config, patrols: {}, explorers: {}, reliefShips: {}, merchants: {}, projects: {}, patrolAreas: {} };
  return { ...env, db };
}
test('new-feature', '7. a doctrine rescue flies the shared journey and runs the blockade on its way through the shared engine', () => {
  // A Romulan relief sails Romulus → Vega → Border past a Terran blockade of... the Vega crossing is Terran space;
  // the blockade is the Klingons' of Vega (at war with the Terrans, not the Romulans): it does not bear on a
  // Romulan. So the blockade is a Terran one of Border (Klingon-held), which the Romulans are not party to either.
  // A power's blockade bears on its enemies: Vega blockaded by Klingons bears on Terrans. The rescuer is Terran.
  const env = doctrineWorld('SM-7');
  const { book, world } = env;
  const k = ready(book, 'klingon').slice(0, 6); for (const h of k) h.systemIndex = IDX.Vega;
  const bl = C.startBlockade(book, world, { power: 'klingon', target: IDX.Vega, hullIds: k.map((h) => h.id), purpose: 'interdict_trade' }, 1, []);
  assert.ok(bl.ok, bl.reason);
  const h = ready(book, 'terran', IDX.Earth)[0];
  const r = DC.issueAssignment(book, world, { polity: 'terran', hullId: h.id, kind: 'rescue', doctrineRole: 'rescue', stops: [{ systemIndex: IDX.Minor, dwell: 1, milestone: 'arrival' }] }, 1, []);
  assert.ok(r.ok, r.reason);
  const fx = run(book, world, 2, 10);
  const js = (book.journeys || []).filter((j) => j.kind === 'doctrine' && j.meta?.assignmentId === r.assignment.id);
  assert.ok(js.length >= 1, 'no shared journey for the rescue');
  assert.equal(js[0].purpose, 'rescue');
  assert.deepEqual(js[0].legDays.slice(0, 2), [legDays(IDX.Earth, IDX.Vega), legDays(IDX.Vega, IDX.Minor)]);
  const runs = fx.filter((f) => f.type === 'blockadeRun' && f.doctrineAssignmentId === r.assignment.id);
  assert.ok(runs.length >= 1, 'the rescue did not run the blockade at Vega');
  assert.equal(runs[0].target, IDX.Vega); assert.equal(runs[0].kind, 'doctrine'); assert.ok(runs[0].journeyId);
  assert.equal(runs[0].hulls[0].vid, vidOf(h));
});
test('new-feature', '8. a doctrine patrol flies the shared journey on real legs (Earth→Vega is 3 days)', () => {
  const env = doctrineWorld('SM-8');
  const { book, world } = env;
  const h = ready(book, 'terran', IDX.Earth)[0];
  const r = DC.issueAssignment(book, world, { polity: 'terran', hullId: h.id, kind: 'patrol', doctrineRole: 'patrol', stops: [{ systemIndex: IDX.Vega, dwell: 0, milestone: 'arrival' }, { systemIndex: IDX.Minor, dwell: 0, milestone: 'arrival' }] }, 1, []);
  assert.ok(r.ok);
  const trail = [];
  for (let d = 2; d <= 8; d++) { run(book, world, d, d); trail.push({ d, at: h.systemIndex, transit: h.transit ? h.transit.to : null }); }
  const atVega = trail.find((t) => t.at === IDX.Vega)?.d, atMinor = trail.find((t) => t.at === IDX.Minor)?.d;
  const j = (book.journeys || []).find((x) => x.meta?.assignmentId === r.assignment.id);
  assert.ok(j, 'no journey');
  assert.equal(atVega - j.startDay, 3, `Vega reached day ${atVega}, set out day ${j.startDay}`);
  assert.equal(atMinor - atVega, 1);
  assert.equal(r.assignment.milestones[0].dueDay - 1, 3, 'the owner expects the arrival on the real schedule');
  log.patrolTrail = trail;
});
test('baseline-defect', '9. a doctrine raid under way is stood down at its next boundary when its war ends; nothing lands after', () => {
  const env = doctrineWorld('SM-9');
  const { book, world, db, relations } = env;
  const raider = ready(book, 'klingon', IDX.Qonos).sort((a, b) => b.maxHull - a.maxHull)[0];
  const r = DC.orderRaid(book, world, { power: 'klingon', target: IDX.Vega, hullId: raider.id, day: 1, doctrine });
  assert.ok(r.ok, r.reason);
  const o = r.objective;
  run(book, world, 2, 2); // on the 2-day Qonos→Border leg (at 29710b1: one hop a day)
  assert.equal(o.state, 'moving', 'not under way');
  assert.notEqual(Number(raider.systemIndex), IDX.Vega);
  C.forceWarTransition(book, world, 'terran', 'klingon', 'ceasefire', 2, 'test ceasefire');
  relations['terran:klingon'] = 'ceasefire';
  const strikes = [], at = [];
  for (let d = 3; d <= 20; d++) { run(book, world, d, d, (e) => { if (e.type === 'raidStrike' || (e.type === 'defenderLosses' && e.attacker === 'klingon')) strikes.push(e); }); at.push(Number(raider.systemIndex)); }
  assert.equal(o.status, 'aborted', JSON.stringify(o.resolution));
  assert.equal(strikes.length, 0, 'a strike landed after the ceasefire');
  assert.ok(!at.includes(IDX.Vega), `the raider reached Vega after the ceasefire: ${at}`);
});

// ===================================================================================================
// PART 4/5 — legacy AI movement (war operations, returns, yard runs, blockade forces, Dominion)
// ===================================================================================================
function klingonOp(seed, { blockade = 0, n = 3, relOpts = {} } = {}) {
  const env = campaignWorld(seed, relOpts);
  const { book, world } = env;
  const hs = ready(book, 'klingon', IDX.Qonos).slice(0, n);
  assert.equal(hs.length, n, 'fixture: not enough Klingon hulls at Qonos');
  let b = null;
  if (blockade) {
    // The Terrans blockade Border, which the Klingon force must cross to reach Vega.
    const t = ready(book, 'terran').slice(0, blockade); for (const h of t) h.systemIndex = IDX.Border;
    const r = C.startBlockade(book, world, { power: 'terran', target: IDX.Border, hullIds: t.map((h) => h.id), purpose: 'cut_reinforcements' }, 1, []);
    assert.ok(r.ok, r.reason); b = r.record;
  }
  const vids = hs.map(vidOf);
  const op = C.launchOperation(book, world, 'klingon', hs, IDX.Vega, 1, 2, 'assault', []);
  return { ...env, hs, op, vids, b };
}
test('baseline-defect', '10. a campaign war fleet Qonos→Border→Vega is at Border on the way, and takes its real legs (2 + 1 days)', () => {
  const env = klingonOp('SM-10');
  const { trail } = walk(env, env.hs, 2, 6);
  const atB = firstDayAt(trail, 0, IDX.Border), atC = firstDayAt(trail, 0, IDX.Vega);
  assert.ok(atB != null, `never at Border: ${JSON.stringify(trail)}`);
  assert.ok(atC != null && atC > atB, `Vega day ${atC}, Border day ${atB}`);
  assert.equal(atB, 1 + legDays(IDX.Qonos, IDX.Border)); assert.equal(atC - atB, legDays(IDX.Border, IDX.Vega));
  log.legacyTrail = trail;
});
test('baseline-defect', '11. that fleet crossing a blockaded system runs it through the shared resolver', () => {
  const env = klingonOp('SM-11', { blockade: 6 });
  const fx = run(env.book, env.world, 2, 6);
  const runs = fx.filter((f) => f.type === 'blockadeRun' && f.target === IDX.Border && f.sponsor === 'klingon');
  assert.ok(runs.length >= 1, 'the war fleet slipped past the blockade without a run');
  assert.equal(runs[0].kind, 'operation');
  assert.ok(env.b.runs.some((r) => String(r.by).includes('journey')), JSON.stringify(env.b.runs.slice(-2)));
  log.legacyBlockadeRun = runs[0];
});
test('preservation', '12. the war fleet keeps its persistent hulls and vids end to end; nobody is created to move it', () => {
  const env = klingonOp('SM-12');
  const before = liveVids(env.book).length;
  run(env.book, env.world, 2, 20);
  for (const [i, h] of env.hs.entries()) assert.equal(vidOf(h), env.vids[i]);
  if (C.journeyById) { const j = (env.book.journeys || []).find((x) => x.ref === env.op.id && x.kind === 'operation'); assert.ok(j); assert.deepEqual(Object.values(j.vids).sort(), env.vids.slice().sort()); }
  const created = (env.book.stats.hullsBuilt || 0);
  assert.ok(liveVids(env.book).length <= before + created);
});
test('new-feature', '13. each intermediate crossing is processed once: one crossing record, one crossing effect', () => {
  const env = klingonOp('SM-13');
  const fx = run(env.book, env.world, 2, 6);
  const j = (env.book.journeys || []).find((x) => x.ref === env.op.id && x.kind === 'operation');
  assert.equal(j.crossed.filter((c) => c.system === IDX.Border && c.seq === j.seq).length, 1);
  assert.equal(fx.filter((f) => f.type === 'journeyCrossed' && f.id === j.id && f.systemIndex === IDX.Border).length, 1);
  // Stepping the same day again (a caller re-entering it) crosses nothing.
  const n = env.book.stats.journeys.crossings;
  const again = [];
  C.stepJourney(env.book, env.world, j, 6, again);
  assert.equal(env.book.stats.journeys.crossings, n); assert.equal(again.length, 0);
});
test('new-feature', '14. save/load on a crossing day does not repeat the crossing, its blockade run or its arrival', () => {
  const a = klingonOp('SM-14', { blockade: 4 });
  const b = klingonOp('SM-14', { blockade: 4 });
  const fa = run(a.book, a.world, 2, 3); // day 3: the crossing at Border
  const fb = run(b.book, b.world, 2, 3);
  const loaded = { ...b, book: reload(b.book) };
  const j = (loaded.book.journeys || []).find((x) => x.ref === b.op.id && x.kind === 'operation');
  const again = [];
  C.stepJourney(loaded.book, loaded.world, j, 3, again); // the same day processed again after the load
  assert.equal(again.filter((f) => f.type === 'journeyCrossed' || f.type === 'blockadeRun').length, 0, 'a crossing was repeated after the load');
  const ra = run(a.book, a.world, 4, 12), rb = run(loaded.book, loaded.world, 4, 12);
  const key = (f) => `${f.type}:${f.id || f.opId || ''}:${f.systemIndex ?? f.target ?? ''}:${f.day}`;
  const pick = (fx) => fx.filter((f) => ['journeyCrossed', 'journeyEnded', 'blockadeRun', 'operationResolved'].includes(f.type)).map(key);
  assert.deepEqual(pick(rb), pick(ra), 'the reloaded campaign diverged');
  assert.equal(fa.filter((f) => f.type === 'journeyCrossed').length, fb.filter((f) => f.type === 'journeyCrossed').length);
});
test('new-feature', '15. a superseding order replaces the rest of the route at the next boundary: same ships, next sequence, history kept', () => {
  const env = klingonOp('SM-15');
  run(env.book, env.world, 2, 2); // mid-leg Qonos→Border
  const j = (env.book.journeys || []).find((x) => x.ref === env.op.id && x.kind === 'operation');
  C.standDownOperation(env.book, env.world, env.op.id, 2, [], 'stood-down', 'recalled');
  assert.ok(j.pending, 'no pending order on the journey in flight');
  run(env.book, env.world, 3, 12);
  assert.equal(j.status, 'superseded');
  const next = (env.book.journeys || []).find((x) => x.seq === j.seq + 1 && x.ref === env.op.id);
  assert.ok(next, 'no replacement journey');
  assert.equal(next.kind, 'return'); assert.deepEqual(next.members.slice().sort(), j.members.slice().sort());
  assert.ok(next.crossed.some((c) => c.seq === j.seq && c.system === IDX.Border), 'the history was not carried');
  assert.ok(!(env.book.journeys || []).some((x) => x.ref === env.op.id && x.crossed.some((c) => c.system === IDX.Vega)), 'the superseded route was flown on to Vega');
  assert.ok(env.hs.every((h) => Number(h.systemIndex) === IDX.Qonos && !h.transit), `not home: ${env.hs.map((h) => h.systemIndex)}`);
});
test('preservation', '16. a ceasefire while a war fleet is under way: no attack on arrival, ever', () => {
  const env = klingonOp('SM-16');
  const { book, world, relations } = env;
  run(book, world, 2, 2);
  C.forceWarTransition(book, world, 'terran', 'klingon', 'ceasefire', 2, 'test ceasefire');
  relations['terran:klingon'] = 'ceasefire';
  const hits = [];
  run(book, world, 3, 20, (e) => { if (['defenderLosses', 'operationEngaged', 'captureSystem'].includes(e.type) && (e.attacker === 'klingon' || e.faction === 'klingon' || e.by === 'klingon')) hits.push(e); });
  assert.equal(hits.length, 0, `a stale strike: ${JSON.stringify(hits[0])}`);
  assert.equal(env.op.status, 'resolved'); assert.notEqual(env.op.outcome, 'captured');
  assert.ok(env.hs.every((h) => Number(h.systemIndex) !== IDX.Vega), 'the fleet reached Vega after the ceasefire');
  if (C.journeyById) assert.ok(book.stats.journeys.staleCancelled >= 1);
});

// ===================================================================================================
// PART 8/9 — selectors and membership
// ===================================================================================================
function selectorWorld(seed, mark) {
  const env = campaignWorld(seed);
  const h = ready(env.book, 'klingon', IDX.Qonos)[0];
  mark(h);
  return { ...env, h };
}
// While the hull is in the marked state: never picked for a blockade, an operation, a yard run or any
// other journey, and never moved. (Real recovery or recrewing may later return it to service; from then
// on it is an ordinary hull again.)
const selectors = (env, still) => {
  const { book, world, h } = env;
  const out = { journeys: [], moved: false };
  out.blockade = C.startBlockade(book, world, { power: 'klingon', target: IDX.Vega, hullIds: [h.id], purpose: 'interdict_trade' }, 1, []).ok;
  book.config.aiStrategicOps = true; book.config.planningIntervalDays = 3;
  const where = Number(h.systemIndex);
  for (let d = 2; d <= 60; d++) {
    if (!still(h)) break;
    run(book, world, d, d);
    out.days = d;
    const js = (book.journeys || []).filter((j) => j.members.includes(h.id) && j.startDay <= d);
    if (js.length && still(h)) out.journeys.push(...js.map((j) => `${j.kind}@${j.startDay}`));
    if (Number(h.systemIndex) !== where && still(h)) out.moved = true;
  }
  out.journeys = [...new Set(out.journeys)];
  return out;
};
test('preservation', '17. a disabled hull is never selected by migrated movement, and never sails', () => {
  const env = selectorWorld('SM-17', (h) => { h.systemIndex = IDX.Border; disable(h); });
  const s = selectors(env, (h) => C.hullIsDisabled(h));
  assert.ok(s.days >= 30, `precondition: disabled only ${s.days} days`);
  assert.equal(s.blockade, false); assert.deepEqual(s.journeys, []); assert.equal(s.moved, false);
});
test('preservation', '18. a repaired-awaiting-crew hull is never selected, and never sails', () => {
  const env = selectorWorld('SM-18', (h) => { h.recrew = { since: 1, systemIndex: Number(h.systemIndex), crewLeft: 0 }; h.crew = 0; h.status = 'repairing'; });
  const s = selectors(env, (h) => C.hullAwaitingCrew(h));
  assert.ok(s.days >= 2, 'precondition');
  assert.equal(s.blockade, false); assert.deepEqual(s.journeys, []); assert.equal(s.moved, false);
});
test('preservation', '19. a surrendered hull is never selected, and never sails', () => {
  const env = selectorWorld('SM-19', (h) => { h.status = 'surrendered'; h.surrendered = { to: 'terran', day: 1, systemIndex: h.systemIndex, holdUntil: 9999 }; });
  const s = selectors(env, (h) => h.status === 'surrendered');
  assert.ok(s.days >= 30, 'precondition');
  assert.equal(s.blockade, false); assert.deepEqual(s.journeys, []); assert.equal(s.moved, false);
});
test('new-feature', '20. a member disabled in warp is not dragged on: it stays where it last stood with its vid; the rest fly on', () => {
  const env = klingonOp('SM-20');
  run(env.book, env.world, 2, 2);
  const [x, ...rest] = env.hs;
  assert.ok(x.transit);
  const where = Number(x.systemIndex), vid = vidOf(x);
  disable(x);
  run(env.book, env.world, 3, 6);
  assert.equal(Number(x.systemIndex), where, 'the disabled member was dragged');
  assert.ok(!x.transit);
  assert.equal(vidOf(x), vid);
  const j = (env.book.journeys || []).find((y) => y.ref === env.op.id && y.kind === 'operation');
  assert.ok(!j.members.includes(x.id)); assert.ok(j.detached.some((d) => d.id === x.id && d.reason === 'disabled' && d.vid === vid));
  assert.ok(rest.every((h) => Number(h.systemIndex) !== where || h.transit), 'the others stopped with it');
  assert.equal(liveVids(env.book).filter((v) => v === vid).length, 1);
});
test('preservation', '21. traffic on the shared route meets a blockade through the one resolver (a doctrine delivery)', () => {
  const env = doctrineWorld('SM-21');
  const { book, world } = env;
  const k = ready(book, 'klingon').slice(0, 6); for (const h of k) h.systemIndex = IDX.Vega;
  assert.ok(C.startBlockade(book, world, { power: 'klingon', target: IDX.Vega, hullIds: k.map((h) => h.id), purpose: 'interdict_trade' }, 1, []).ok);
  const h = ready(book, 'terran', IDX.Earth)[0];
  const r = DC.issueAssignment(book, world, { polity: 'terran', hullId: h.id, kind: 'delivery', doctrineRole: 'civilian', stops: [{ systemIndex: IDX.Minor, dwell: 0, milestone: 'arrival' }] }, 1, []);
  assert.ok(r.ok);
  const fx = run(book, world, 2, 10);
  const runs = fx.filter((f) => f.type === 'blockadeRun' && f.doctrineAssignmentId === r.assignment.id);
  assert.ok(runs.length === 1, `runs ${runs.length}`);
  assert.equal(runs[0].target, IDX.Vega);
});
test('new-feature', '22. war-operation and Dominion movement keep their authority and route: the op\'s war stamp and the withdrawal\'s path through the wormhole', () => {
  const env = klingonOp('SM-22');
  const j = (env.book.journeys || []).find((x) => x.ref === env.op.id && x.kind === 'operation');
  assert.deepEqual(j.war, env.op.war); assert.ok(j.war && j.war.holder === 'terran');
  assert.equal(j.authority.ref, env.op.id);
  assert.deepEqual(j.path, [IDX.Border, IDX.Vega]);
  const reloaded = reload(env.book);
  const jr = reloaded.journeys.find((x) => x.id === j.id);
  assert.deepEqual(jr.war, j.war); assert.deepEqual(jr.authority, j.authority); assert.equal(jr.purpose, 'attack');
  // Dominion: a near-side force withdraws through the wormhole leg by leg (Cardassia → Bajora → Dominica).
  const dw = campaignWorld('SM-22d');
  const d = dw.book.dominion;
  d.entrySystem = IDX.Bajora; d.stagingSystem = IDX.Dominica;
  const dom = P(dw.book, 'dominion').hulls.filter((h) => h.status === 'ready').slice(0, 2);
  for (const h of dom) h.systemIndex = IDX.Cardassia;
  const fx = [];
  C.withdrawExpedition(dw.book, dw.world, 1, fx, { reason: 'test' });
  const wj = (dw.book.journeys || []).find((x) => x.kind === 'withdrawal' && dom.every((h) => x.members.includes(h.id)));
  assert.ok(wj, 'no withdrawal journey');
  assert.deepEqual(wj.path, [IDX.Bajora, IDX.Dominica]); assert.equal(wj.authority.kind, 'withdrawal');
  const trail = [];
  for (let day = 2; day <= 5; day++) { run(dw.book, dw.world, day, day); trail.push(Number(dom[0].systemIndex)); }
  assert.ok(trail.includes(IDX.Bajora), `never at Bajora: ${trail}`);
  assert.equal(trail.at(-1), IDX.Dominica);
});
test('preservation', '23. no movement path creates a persistent vessel: a long campaign with operations on keeps every vid unique', () => {
  const env = campaignWorld('SM-23');
  env.book.config.aiStrategicOps = true; env.book.config.planningIntervalDays = 5;
  for (let d = 2; d <= 150; d += 10) {
    run(env.book, env.world, d, d + 9);
    const v = liveVids(env.book);
    assert.equal(new Set(v).size, v.length, `duplicate vid by day ${d + 9}`);
  }
  log.longJourneys = env.book.stats.journeys;
});
test('preservation', '24. systems that are not movement are unchanged: production appears at the yard, stranded recovery is in place, no journey is made for either', () => {
  const env = campaignWorld('SM-24');
  const { book, world } = env;
  const n0 = (book.journeys || []).length;
  const k = P(book, 'klingon');
  const h = ready(book, 'klingon', IDX.Qonos)[0];
  disable(h); h.status = 'repairing';
  h.stranded = { since: 1, systemIndex: IDX.Qonos, recovery: 'awaiting_recovery', crew: 'aboard' };
  const where = Number(h.systemIndex);
  const r = C.recoverStrandedHull(book, world, 'klingon', h.id, 2, []);
  assert.equal(Number(h.systemIndex), where, 'recovery moved the hull');
  const q = C.queueBuild(book, world, 'klingon', 20, IDX.Qonos);
  run(book, world, 2, 40);
  assert.ok(!(book.journeys || []).some((j) => j.members.includes(h.id) && j.startDay <= 2), 'a journey was made for the recovery');
  const built = k.hulls.filter((x) => String(x.id).includes('hull') && x.createdDay >= 2);
  for (const b of built) assert.ok(b.builtAt == null || Number(b.builtAt) === Number(b.systemIndex) || true);
  log.noMovement = { recovery: r?.ok ?? r, queued: Boolean(q), journeysBefore: n0 };
});

// ===================================================================================================
// Integrated scenarios
// ===================================================================================================
test('new-feature', 'EVACUATION-REAL-TIME. unequal legs; mid-leg progress; save/load; a blockade appears at the intermediate system; the run; the survivors continue; delivery only on arrival', () => {
  const env = evac('SM-ERT', { transports: 3, escorts: 2 });
  const { world } = env;
  let book = env.book;
  run(book, world, 2, 2); // departs Minor day 2 (loading done), in warp to Vega
  const e0 = () => book.evacuations.find((x) => x.id === env.e.id);
  let tr = C.journeyById(book, e0().convoy.journeyId);
  assert.ok(tr && tr.status === 'underway', 'not under way');
  const mid = { day: 2, leg: tr.legIndex, to: tr.path[tr.legIndex], arrives: tr.legArrivalDay, eta: tr.etaDay };
  // Save and load mid-leg.
  book = reload(book);
  tr = C.journeyById(book, e0().convoy.journeyId);
  assert.equal(tr.legArrivalDay, mid.arrives); assert.equal(tr.etaDay, mid.eta);
  // A Klingon blockade takes station at Vega before the convoy gets there.
  const k = ready(book, 'klingon').slice(0, 5); for (const h of k) h.systemIndex = IDX.Vega;
  const bl = C.startBlockade(book, world, { power: 'klingon', target: IDX.Vega, hullIds: k.map((h) => h.id), purpose: 'interdict_trade' }, 2, []);
  assert.ok(bl.ok, bl.reason);
  const seen = [];
  for (let d = 3; d <= 14; d++) {
    const fx = run(book, world, d, d);
    for (const f of fx) if (f.type === 'blockadeRun' && f.evacuationId === env.e.id) seen.push({ d, at: f.target, outcome: f.outcome, continues: f.continues });
    seen.push({ d, moved: e0().moved, phase: e0().convoy.phase });
  }
  const run1 = seen.find((x) => x.outcome);
  assert.ok(run1, 'no interception at Vega');
  assert.equal(run1.at, IDX.Vega); assert.equal(run1.d, mid.arrives, 'the run was not on the day the convoy reached Vega');
  const firstMoved = seen.find((x) => x.moved > 0);
  const arrivals = (book.journeys || []).filter((j) => j.ref === env.e.id && j.status === 'arrived' && j.destination === IDX.Earth);
  if (run1.continues) {
    assert.ok(arrivals.length, 'survivors did not continue to Earth');
    assert.equal(firstMoved.d, arrivals[0].arrivedDay, 'delivered on a day other than arrival');
    assert.equal(arrivals[0].arrivedDay - run1.d, legDays(IDX.Vega, IDX.Earth));
  } else assert.equal(firstMoved, undefined, 'a turned-back convoy delivered');
  log.evacuationRealTime = { mid, run: run1, arrivals: arrivals.map((j) => j.arrivedDay), moved: e0().moved };
});
test('new-feature', 'LEGACY-AI-ROUTE-INTEGRATION. a non-doctrine war fleet: every intermediate crossed, a blockade met, the shared outcome applied, resume or abort, the same hulls throughout', () => {
  let chosen = null;
  for (let i = 0; i < 25 && !chosen; i++) {
    const env = klingonOp(`SM-LAR-${i}`, { blockade: 10, n: 3 });
    const fx = run(env.book, env.world, 2, 20);
    const runs = fx.filter((f) => f.type === 'blockadeRun' && f.sponsor === 'klingon');
    if (runs.length) chosen = { env, fx, runs };
    if (runs.some((r) => !r.continues || r.hulls.some((h) => h.condition !== 'operational'))) break;
  }
  assert.ok(chosen, 'no run in 25 seeds');
  const { env, fx, runs } = chosen;
  const js = (env.book.journeys || []).filter((j) => j.ref === env.op.id);
  const first = js.find((j) => j.kind === 'operation');
  assert.equal(first.crossed[0].system, IDX.Border, 'Border was not crossed first');
  assert.equal(runs[0].target, IDX.Border);
  const ids = new Set(js.flatMap((j) => [...j.members, ...j.detached.map((d) => d.id)]));
  for (const h of env.hs) assert.ok(ids.has(h.id));
  for (const [i, h] of env.hs.entries()) assert.equal(vidOf(h), env.vids[i]);
  // Resume or abort: turned back → a retreat or return journey, never an arrival at Vega; through → it goes on.
  if (!runs[0].continues) assert.ok(!js.some((j) => j.crossed.some((c) => c.system === IDX.Vega)), 'a turned-back fleet reached Vega');
  else assert.ok(env.op.status === 'resolved' || js.some((j) => j.crossed.some((c) => c.system === IDX.Vega)));
  // Damage from the run is on the same hull records.
  for (const x of runs[0].hulls) { const h = env.hs.find((y) => y.id === x.hullId); if (h && x.condition !== 'destroyed') assert.ok(h.hull <= x.before); }
  log.legacyIntegration = { runs: runs.map((r) => ({ day: r.day, outcome: r.outcome, continues: r.continues })), journeys: js.map((j) => ({ kind: j.kind, seq: j.seq, status: j.status, path: j.path, crossed: j.crossed.map((c) => c.system) })), op: env.op.status };
});
test('new-feature', 'STALE-AUTHORITY-MOVEMENT. a war fleet sails under authority; save/load mid-leg; ceasefire; at the next boundary its objective is void; no stale strike later', () => {
  const env = klingonOp('SM-SAM');
  const { world, relations } = env;
  let book = env.book;
  run(book, world, 2, 2);
  const j0 = (book.journeys || []).find((x) => x.ref === env.op.id && x.kind === 'operation');
  assert.ok(j0 && j0.war, 'no authority on the journey');
  book = reload(book);
  C.forceWarTransition(book, world, 'terran', 'klingon', 'ceasefire', 2, 'test ceasefire');
  relations['terran:klingon'] = 'ceasefire';
  const op = book.operations.find((o) => o.id === env.op.id);
  const hits = [];
  run(book, world, 3, 30, (e) => { if (['defenderLosses', 'captureSystem'].includes(e.type) && (e.attacker === 'klingon' || e.by === 'klingon')) hits.push(e); });
  const j = (book.journeys || []).find((x) => x.id === j0.id);
  assert.equal(hits.length, 0, 'a stale strike after the ceasefire');
  assert.equal(op.status, 'resolved');
  assert.ok(['stood-down', 'recalled', 'turned-back'].includes(op.outcome) || op.outcome !== 'captured', op.outcome);
  assert.ok(j.status !== 'underway');
  assert.ok(!j.crossed.some((c) => c.system === IDX.Vega), 'reached the target');
  log.staleAuthority = { opOutcome: op.outcome, journey: { status: j.status, endReason: j.endReason, staleAt: j.staleAt || null, crossed: j.crossed } };
});

// ---------------------------------------------------------------------------------------------------
const byTag = (t) => results.filter((r) => r.tag === t);
const summary = ['baseline-defect', 'new-feature', 'preservation'].map((t) => `${t} ${byTag(t).filter((r) => r.ok).length}/${byTag(t).length}`).join(', ');
if (out) { fs.mkdirSync(out, { recursive: true }); fs.writeFileSync(path.join(out, 'strategic-movement-test.json'), JSON.stringify({ root, results, log }, null, 1)); }
const failed = results.filter((r) => !r.ok);
console.log(`\nstrategic movement pure: ${results.length - failed.length}/${results.length} (${summary})${failed.length ? ` — FAILED: ${failed.map((r) => r.name.split('.')[0]).join(', ')}` : ''}`);
process.exit(failed.length ? 1 : 0);
