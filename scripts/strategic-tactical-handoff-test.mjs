// Pure regressions for STRATEGIC-TACTICAL-HANDOFF (docs/movement/STRATEGIC-TACTICAL-HANDOFF.md): the model
// side of the strategic ↔ tactical encounter — eligibility (only where the captain is), the encounter
// record and its lifecycle, the explicit guards that keep a handed-off contact from also resolving
// abstractly, the write-back of each tactical fate onto the same persistent hull, and each family's
// strategic continuation. The scene itself (spawning, fighting, the captain's course) is the in-game
// gate's (scripts/strategic-tactical-handoff-gate.cjs). Checks are tagged:
//   [baseline-defect] reproduces c07826b resolving a contact abstractly while the captain is present;
//   [new-feature]     behaviour this round adds;
//   [preservation]    behaviour that must be unchanged.
// BM1_HANDOFF_ROOT points the suite at another tree's src/ (the baseline reproduction runs it against
// c07826b, where the baseline-defect checks fail on their own assertions).
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(process.env.BM1_HANDOFF_ROOT || path.join(here, '..'));
const imp = (rel) => import(pathToFileURL(path.join(root, rel)).href);
const C = await imp('src/campaign-strategy.mjs');
const D = await imp('src/doctrine-runtime.mjs');
const DC = await imp('src/doctrine-campaign.mjs');
let SE = null; try { SE = await imp('src/strategic-encounter.mjs'); } catch { SE = null; }
const { makeWorld, run } = await import(pathToFileURL(path.join(root, 'scripts/campaign-world-fixture.mjs')).href);
const read = (f) => JSON.parse(fs.readFileSync(path.join(root, f), 'utf8'));
const doctrine = D.loadDoctrine(read('docs/doctrine/bm1-faction-doctrine.v0.2.1.json'), read('docs/doctrine/bm1-faction-doctrine.schema.json'));
const out = process.env.BM1_TEST_OUTPUT || null;

const results = [];
const log = {};
const test = (tag, name, fn) => {
  try { fn(); results.push({ tag, name, ok: true }); console.log('PASS', `[${tag}]`, name); }
  catch (e) { results.push({ tag, name, ok: false, error: String(e?.message || e).split('\n')[0] }); console.log('FAIL', `[${tag}]`, name, '\n      ', String(e?.stack || e).split('\n').slice(0, 7).join('\n       ')); }
};
const need = () => { if (!SE || typeof C.blockadeContact !== 'function') throw new Error('this tree has no strategic ↔ tactical encounter (every contact is resolved abstractly)'); };

// ---- the fixture galaxy (campaign-world-fixture) --------------------------------------------------
// Earth(0) ─ Vega(1) ─ Border(2) ─ Qonos(3);  Vega ─ Romulus(4);  Border ─ Cardassia(5) ─ Bajora(6) ⇄ Dominica(7);  Vega ─ Minor(8).
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
const vidOf = (h) => h?.identity?.vid || h?.vid || h?.id;
const liveVids = (book) => Object.values(book.polities).flatMap((p) => p.hulls.filter((h) => h.status !== 'lost').map(vidOf));
const hullById = (book, polity, id) => P(book, polity).hulls.find((h) => h.id === id);
const encs = (book) => book.encounters || [];
const stats = (book) => book.stats?.encounters || {};
// Run days with the captain in `sys` (world.localSystem), as buildCampaignWorld sets it when he is not in warp.
function present(env, sys) { env.world.localSystem = sys; }
function absent(env) { env.world.localSystem = null; }

// An evacuation of Minor (8) to Earth (0) through Vega (1), past a Klingon blockade of Vega. The seed is
// searched for a crossing the blockade actually intercepts (seen and caught), so there is a fight to hand off.
function convoySetup(seed, blockade) {
  const env = campaignWorld(seed);
  const { book, world } = env;
  const t = P(book, 'terran');
  const hs = t.hulls.filter((h) => h.status === 'ready');
  const carriers = hs.slice(0, 2); for (const h of carriers) { h.systemIndex = IDX.Minor; h.shipId = 74; h.maxHull = h.hull = 600; }
  const k = ready(book, 'klingon').slice(0, blockade); for (const h of k) h.systemIndex = IDX.Vega;
  const b = C.startBlockade(book, world, { power: 'klingon', target: IDX.Vega, hullIds: k.map((h) => h.id), purpose: 'interdict_trade' }, 1, []);
  if (!b.ok) return null;
  const r = C.startEvacuation(book, world, { sponsor: 'terran', origin: IDX.Minor, destination: IDX.Earth, transports: carriers.map((h) => h.id), target: 60000 }, 1, []);
  if (!r.ok) return null;
  run(book, world, 2, 2);
  const tr = (book.journeys || []).find((j) => j.kind === 'evacuation' && j.ref === r.record.id && j.status === 'underway');
  if (!tr || Number(tr.path[tr.legIndex]) !== IDX.Vega) return null;
  return { env, e: r.record, carriers, b: b.record, tr, klingons: k, arriveDay: Number(tr.legArrivalDay) };
}
// The seed is searched (with the captain at Vega on a copy) for a crossing the blockade actually intercepts —
// seen and caught — so there is a fight to hand off; the returned scenario has not crossed yet.
function convoyAtBlockade(tag, { present: here = true, blockade = 12 } = {}) {
  for (let i = 0; i < 80; i++) {
    const probe = convoySetup(`${tag}-${i}`, blockade);
    if (!probe) continue;
    if (!SE) { if (!here) return probe; present(probe.env, IDX.Vega); return probe; }
    present(probe.env, IDX.Vega);
    run(probe.env.book, probe.env.world, 3, probe.arriveDay);
    if (!(probe.env.book.encounters || []).some((e) => e.type === 'blockade')) continue;
    const s = convoySetup(`${tag}-${i}`, blockade);
    if (here) present(s.env, IDX.Vega);
    return s;
  }
  throw new Error('no seed gave an intercepted crossing');
}
// A Klingon war fleet on Vega (Terran), engaged there on arrival.
function klingonAtVega(seed, n = 3) {
  const env = campaignWorld(seed);
  const { book, world } = env;
  const hs = ready(book, 'klingon', IDX.Qonos).slice(0, n);
  const op = C.launchOperation(book, world, 'klingon', hs, IDX.Vega, 1, 2, 'assault', []);
  return { ...env, hs, op };
}
function tacticalReport(enc, fn) {
  const participants = {};
  for (const p of enc.participants) { if (p.engineOwned || !p.spawn) continue; const r = fn(p); if (r) participants[p.ref] = { vid: p.vid, ...r }; }
  return participants;
}

// ===================================================================================================
// PART 1–3, 6: eligibility, the record, the guard (blockade crossing)
// ===================================================================================================
test('preservation', '1. the captain absent from a blockaded crossing: the existing strategic resolver runs, and nothing is handed off', () => {
  const s = convoyAtBlockade('TH-1', { present: false });
  const { env } = s;
  const fx = run(env.book, env.world, 3, s.arriveDay);
  const runs = fx.filter((f) => f.type === 'blockadeRun' && f.evacuationId === s.e.id);
  assert.equal(runs.length, 1, `runs ${runs.length}`);
  assert.ok(!runs[0].tactical);
  assert.equal(encs(env.book).length, 0, 'an encounter was opened with nobody there');
});
test('baseline-defect', '2. the captain present at the crossing: the interception is handed to the scene (a pending encounter), and the convoy is held there', () => {
  const s = convoyAtBlockade('TH-2');
  const { env } = s;
  const fx = run(env.book, env.world, 3, s.arriveDay);
  const runs = fx.filter((f) => f.type === 'blockadeRun' && f.evacuationId === s.e.id);
  assert.equal(runs.length, 0, `resolved abstractly while the captain was there: ${runs.map((r) => r.outcome)}`);
  need();
  const enc = encs(env.book).find((e) => e.type === 'blockade');
  assert.ok(enc, 'no encounter');
  assert.equal(enc.status, 'pending'); assert.equal(enc.system, IDX.Vega);
  assert.equal(enc.objective.kind, 'blockade'); assert.equal(enc.objective.ref, s.b.id);
  const tr = C.journeyById(env.book, s.tr.id);
  assert.equal(tr.held?.encounterId, enc.id);
  log.pending = { id: enc.id, participants: enc.participants.map((p) => [p.side, p.vid]), contact: { caught: enc.contact.caught, tier: enc.contact.tier } };
});
test('baseline-defect', '3. while the encounter owns the contact, no strategic damage lands for it — not that day, not the days after (the guard is explicit and counted)', () => {
  const s = convoyAtBlockade('TH-3');
  const { env } = s;
  const before = { runners: s.carriers.map((h) => h.hull), blockade: s.klingons.map((h) => h.hull), runs: (s.b.runs || []).length };
  const fx = run(env.book, env.world, 3, s.arriveDay + 4);
  assert.deepEqual(s.carriers.map((h) => h.hull), before.runners, 'runner damaged abstractly');
  assert.deepEqual(s.klingons.map((h) => h.hull), before.blockade, 'blockaders damaged abstractly');
  assert.equal((s.b.runs || []).length, before.runs, 'a run was recorded abstractly');
  assert.equal(fx.filter((f) => f.type === 'blockadeRun').length, 0);
  need();
  assert.ok(stats(env.book).abstractSuppressed >= 4, `suppressed ${stats(env.book).abstractSuppressed}`);
  // The held convoy's crossing is never processed again.
  assert.equal(C.journeyById(env.book, s.tr.id).crossed.filter((c) => c.system === IDX.Vega).length, 1);
});
test('new-feature', '4. the same vids are in the encounter as on the hulls, and come back to them (same-vid round trip)', () => {
  need();
  const s = convoyAtBlockade('TH-4');
  const { env } = s;
  run(env.book, env.world, 3, s.arriveDay);
  const enc = encs(env.book).find((e) => e.type === 'blockade');
  for (const p of enc.participants) {
    const h = hullById(env.book, p.polity, p.hullId);
    assert.equal(p.vid, vidOf(h), `participant ${p.ref} vid ${p.vid} ≠ hull ${vidOf(h)}`);
    assert.equal(h.encounterId, enc.id, 'the hull is not marked as in the encounter');
    assert.equal(C.hullUnavailable(h), true, 'a hull fighting in the scene is available to the strategic layer');
  }
  const r = C.resolveEncounterNow(env.book, env.world, enc.id, { result: { outcome: 'passed' }, participants: tacticalReport(enc, () => ({ fate: 'survived' })) }, s.arriveDay, []);
  assert.ok(r.ok);
  assert.equal(stats(env.book).sameVidRoundTrips, enc.participants.filter((p) => p.spawn && !p.engineOwned).length);
  for (const p of enc.participants) assert.ok(!hullById(env.book, p.polity, p.hullId).encounterId, 'the hull kept its encounter mark');
});
test('new-feature', '5/6/7. tactical damage, destruction and disablement are written onto the same hulls: damaged keeps its vid; destroyed retires it; disabled stays in the encounter system, stranded, awaiting recovery (no repair)', () => {
  need();
  const s = convoyAtBlockade('TH-5');
  const { env } = s;
  run(env.book, env.world, 3, s.arriveDay);
  const enc = encs(env.book).find((e) => e.type === 'blockade');
  const [kDamaged, kDead, kDisabled] = enc.participants.filter((p) => p.side === 'blockader');
  const vids = { dmg: kDamaged.vid, dead: kDead.vid, dis: kDisabled.vid };
  const maxOf = (p) => hullById(env.book, p.polity, p.hullId).maxHull;
  const rep = tacticalReport(enc, (p) => p === kDamaged ? { fate: 'damaged', hull: maxOf(p) * 0.6 } : p === kDead ? { fate: 'destroyed', hull: 0 } : p === kDisabled ? { fate: 'disabled', hull: maxOf(p) * 0.05 } : { fate: 'survived' });
  C.resolveEncounterNow(env.book, env.world, enc.id, { result: { outcome: 'passed' }, participants: rep }, s.arriveDay, []);
  const hD = hullById(env.book, 'klingon', kDamaged.hullId), hX = hullById(env.book, 'klingon', kDead.hullId), hS = hullById(env.book, 'klingon', kDisabled.hullId);
  assert.equal(Math.round(hD.hull), Math.round(hD.maxHull * 0.6)); assert.equal(vidOf(hD), vids.dmg); assert.notEqual(hD.status, 'lost');
  assert.equal(hX.status, 'lost'); assert.equal(hX.hull, 0); assert.equal(vidOf(hX), vids.dead);
  assert.ok(!liveVids(env.book).includes(vids.dead), 'the destroyed vid is still live');
  assert.equal(C.hullIsDisabled(hS), true); assert.equal(Number(hS.systemIndex), IDX.Vega); assert.ok(hS.stranded, 'not in the stranded model'); assert.equal(hS.stranded.recovery, 'awaiting_recovery');
  // No spontaneous repair: days pass, it stays disabled where it is (no Klingon yard at Vega).
  absent(env); run(env.book, env.world, s.arriveDay + 1, s.arriveDay + 10);
  assert.equal(C.hullIsDisabled(hS), true, 'the disabled hull was repaired by strategic days alone');
  assert.equal(Number(hS.systemIndex), IDX.Vega);
  assert.ok(!s.b.hulls.some((t) => t.hullId === kDead.hullId || t.hullId === kDisabled.hullId), 'the lost or disabled hull still holds the blockade');
});
test('new-feature', '8. a tactical surrender is the Phase 4 surrender: held, unavailable, with the same vid; never picked up at once', () => {
  need();
  const s = convoyAtBlockade('TH-8');
  const { env } = s;
  env.world.doctrineStep = (b, w, d, fx) => DC.advanceDoctrineDay(b, w, d, fx, doctrine);
  run(env.book, env.world, 3, s.arriveDay);
  const enc = encs(env.book).find((e) => e.type === 'blockade');
  const k = enc.participants.find((p) => p.side === 'blockader');
  C.resolveEncounterNow(env.book, env.world, enc.id, { result: { outcome: 'passed' }, participants: tacticalReport(enc, (p) => p === k ? { fate: 'surrendered', hull: 900, to: 'terran' } : { fate: 'survived' }) }, s.arriveDay, []);
  const h = hullById(env.book, 'klingon', k.hullId);
  assert.equal(h.status, 'surrendered'); assert.equal(h.surrendered?.to, 'terran'); assert.equal(vidOf(h), k.vid);
  assert.equal(C.hullUnavailable(h), true);
  assert.ok(!s.b.hulls.some((t) => t.hullId === k.hullId), 'a surrendered ship still holds the blockade');
});
test('new-feature', '9. a blockader destroyed in the scene lowers the blockade\'s coverage afterwards', () => {
  need();
  const s = convoyAtBlockade('TH-9');
  const { env } = s;
  run(env.book, env.world, 3, s.arriveDay);
  const cov0 = s.b.coverage;
  const enc = encs(env.book).find((e) => e.type === 'blockade');
  const dead = new Set(enc.participants.filter((p) => p.side === 'blockader').slice(0, 4).map((p) => p.ref));
  C.resolveEncounterNow(env.book, env.world, enc.id, { result: { outcome: 'passed' }, participants: tacticalReport(enc, (p) => dead.has(p.ref) ? { fate: 'destroyed', hull: 0 } : { fate: 'survived' }) }, s.arriveDay, []);
  assert.ok(s.b.coverage < cov0, `coverage ${cov0} → ${s.b.coverage}`);
  assert.equal(s.b.losses >= 4, true);
  assert.equal(s.b.runs.at(-1).tactical, true); assert.equal(s.b.runs.at(-1).encounterId, enc.id);
  log.coverage = { before: cov0, after: s.b.coverage, losses: s.b.losses };
});
test('new-feature', '10. passed in the scene: the held convoy goes on from the crossing — once — and delivers on arrival', () => {
  need();
  const s = convoyAtBlockade('TH-10');
  const { env } = s;
  run(env.book, env.world, 3, s.arriveDay);
  const enc = encs(env.book).find((e) => e.type === 'blockade');
  const fx = [];
  const leg0 = C.journeyById(env.book, s.tr.id).legIndex;
  C.resolveEncounterNow(env.book, env.world, enc.id, { result: { outcome: 'passed' }, participants: tacticalReport(enc, () => ({ fate: 'survived' })) }, s.arriveDay, fx);
  const tr = C.journeyById(env.book, s.tr.id);
  assert.ok(!tr.held);
  assert.equal(tr.encounters.filter((e) => e.system === IDX.Vega).length, 1);
  assert.equal(tr.encounters.find((e) => e.system === IDX.Vega).tactical, true);
  assert.ok(tr.legIndex > leg0 || tr.status !== 'underway', `the convoy did not go on (leg ${tr.legIndex}, ${tr.status})`);
  absent(env); run(env.book, env.world, s.arriveDay + 1, s.arriveDay + 6);
  assert.ok(s.e.moved > 0, 'nothing delivered after passing');
  assert.equal(C.journeyById(env.book, s.tr.id).crossed.filter((c) => c.system === IDX.Vega).length, 1, 'the crossing was processed twice');
  assert.equal(stats(env.book).journeysResumed, 1);
});
test('new-feature', '11. forced back in the scene: the runners turn back from the crossing to where they came from (never on to the destination)', () => {
  need();
  const s = convoyAtBlockade('TH-11');
  const { env } = s;
  run(env.book, env.world, 3, s.arriveDay);
  const enc = encs(env.book).find((e) => e.type === 'blockade');
  C.resolveEncounterNow(env.book, env.world, enc.id, { result: { outcome: 'forced_back' }, participants: tacticalReport(enc, (p) => p.side === 'runner' ? { fate: 'damaged', hull: 300 } : { fate: 'survived' }) }, s.arriveDay, []);
  const tr = C.journeyById(env.book, s.tr.id);
  assert.equal(tr.status, 'halted'); assert.equal(tr.endReason, 'forced-back');
  absent(env); run(env.book, env.world, s.arriveDay + 1, s.arriveDay + 5);
  assert.equal(s.e.moved, 0, 'people delivered by a convoy that was turned back');
  assert.ok(!(env.book.journeys || []).some((j) => j.ref === s.e.id && j.crossed.some((c) => c.system === IDX.Earth && c.day <= s.arriveDay + 3)));
  assert.equal(s.b.runs.find((r) => r.encounterId === enc.id)?.outcome, 'intercepted_forced_back');
});

// ===================================================================================================
// PART 7: war operations, defence, raids
// ===================================================================================================
test('new-feature', '12. a war operation engaging where the captain is hands off (an encounter owns it) instead of resolving offscreen day by day', () => {
  const env = klingonAtVega('TH-12');
  present(env, IDX.Vega);
  const fx = run(env.book, env.world, 2, 12);
  assert.equal(env.op.status, 'engaged', `op ${env.op.status}/${env.op.outcome}`);
  assert.equal(fx.filter((f) => f.type === 'defenderLosses' && f.opId === env.op.id).length, 0, 'offscreen battle days were fought while the captain was there');
  need();
  const enc = encs(env.book).find((e) => e.type === 'operation' && e.objective.ref === env.op.id);
  assert.ok(enc, 'no encounter');
  assert.equal(enc.status, 'pending');
  assert.deepEqual(enc.participants.filter((p) => p.side === 'attacker').map((p) => p.vid).sort(), env.hs.map(vidOf).sort());
  assert.ok(enc.participants.some((p) => p.side === 'defender'), 'the world\'s actual defenders are not in it');
  assert.equal(enc.authority.kind, 'war'); assert.deepEqual(enc.authority.stamp, env.op.war);
  assert.ok(stats(env.book).abstractSuppressed > 0);
});
test('new-feature', '13. a ceasefire before contact calls the attack off: no tactical attack, no offscreen battle, the operation stands down', () => {
  need();
  const env = klingonAtVega('TH-13');
  present(env, IDX.Vega);
  run(env.book, env.world, 2, 8);
  const enc = encs(env.book).find((e) => e.type === 'operation');
  assert.equal(enc?.status, 'pending');
  C.forceWarTransition(env.book, env.world, 'klingon', 'terran', 'ceasefire', 8, 'test ceasefire');
  env.relations['terran:klingon'] = 'ceasefire';
  const fx = run(env.book, env.world, 9, 12);
  assert.equal(enc.status, 'aborted', enc.status);
  assert.equal(env.op.status, 'resolved'); assert.equal(env.op.outcome, 'stood-down');
  assert.equal(fx.filter((f) => ['defenderLosses', 'captureSystem'].includes(f.type)).length, 0);
  assert.ok(stats(env.book).staleSuppressed >= 1);
});
test('new-feature', '14/15. after the scene decides the battle no stale abstract strike lands; the defenders\' losses in the scene come off the strategic defending force', () => {
  need();
  const env = klingonAtVega('TH-14');
  present(env, IDX.Vega);
  run(env.book, env.world, 2, 8);
  const claim = C.claimOperationForScene(env.book, env.op.id, env.world, 8);
  assert.ok(claim && claim.encounter.status === 'tactical_active');
  const def0 = C.localDefenseStrength(env.book, env.world, IDX.Vega);
  const defenders = claim.encounter.participants.filter((p) => p.side === 'defender' && !p.engineOwned);
  assert.ok(defenders.length >= 1);
  const dead = defenders[0];
  const report = [...env.hs.map((h) => ({ hullId: h.id, destroyed: true, hull: 0 })), { hullId: dead.hullId, destroyed: true, hull: 0 }];
  const fx = [];
  C.reconcileLocalOutcome(env.book, env.world, env.op.id, report, 'destroyed', 8, fx);
  assert.equal(env.op.status, 'resolved'); assert.equal(env.op.resolvedBy, 'local');
  assert.equal(hullById(env.book, dead.polity, dead.hullId).status, 'lost');
  assert.ok(C.localDefenseStrength(env.book, env.world, IDX.Vega) < def0, 'the defence did not lose the ship lost in the scene');
  assert.equal(env.op.defenderLosses, 1);
  assert.equal(fx.filter((f) => f.type === 'operationResolved').length, 1);
  assert.equal(fx.find((f) => f.type === 'operationResolved').encounterId, claim.encounter.id, 'the operation report is not tied to its encounter (it would be reported twice)');
  const later = run(env.book, env.world, 9, 20);
  assert.equal(later.filter((f) => f.opId === env.op.id && ['defenderLosses', 'operationResolved', 'captureSystem'].includes(f.type)).length, 0, 'a stale strike landed after the scene decided it');
});
function raidWorld(seed) {
  const env = campaignWorld(seed);
  env.world.doctrineStep = (b, w, d, fx) => DC.advanceDoctrineDay(b, w, d, fx, doctrine);
  const db = DC.doctrineBook(env.book);
  db.config = { ...db.config, patrols: {}, explorers: {}, reliefShips: {}, merchants: {}, projects: {}, patrolAreas: {}, militaryResponses: false, enforcementResponses: false, predation: false };
  return { ...env, db };
}
test('new-feature', '16. a raid\'s strike where the captain is is fought in the scene; its result feeds the finite raid (a strike day counted, or the raid closed when its raider is out)', () => {
  need();
  const mk = (seed) => {
    const env = raidWorld(seed);
    // Minor (Terran) left lightly held, the biggest Klingon ship at Border as the raider (the phase 3 scene).
    for (const h of P(env.book, 'terran').hulls.filter((x) => x.systemIndex === IDX.Minor)) h.systemIndex = IDX.Earth;
    const raider = ready(env.book, 'klingon', IDX.Border).sort((a, b) => b.maxHull - a.maxHull)[0];
    const r = DC.orderRaid(env.book, env.world, { power: 'klingon', target: IDX.Minor, hullId: raider.id, day: 1, doctrine }, []);
    assert.ok(r.ok, r.reason);
    present(env, IDX.Minor);
    let enc = null;
    for (let d = 2; d < 20 && !enc; d++) { run(env.book, env.world, d, d); enc = encs(env.book).find((e) => e.type === 'raid' && e.status === 'pending'); }
    assert.ok(enc, `the raid never handed off: ${JSON.stringify(r.objective.actions.slice(-4))}`);
    const o = env.db.objectives.find((x) => x.id === enc.objective.ref);
    return { env, enc, o };
  };
  // Struck: one strike day, the raid goes on (finite).
  const a = mk('TH-16a');
  const strikes0 = a.o.strikeDays;
  C.resolveEncounterNow(a.env.book, a.env.world, a.enc.id, { result: { outcome: 'struck' }, participants: tacticalReport(a.enc, () => ({ fate: 'survived' })) }, a.env.book.settled, []);
  assert.equal(a.o.strikeDays, strikes0 + 1);
  assert.equal(a.o.tacticalDay, a.env.book.settled);
  // Repelled: the raider destroyed; the raid closes on the next strategic day.
  const b = mk('TH-16b');
  const raider = b.enc.participants.find((p) => p.side === 'attacker');
  C.resolveEncounterNow(b.env.book, b.env.world, b.enc.id, { result: { outcome: 'repelled' }, participants: tacticalReport(b.enc, (p) => p === raider ? { fate: 'destroyed', hull: 0 } : { fate: 'survived' }) }, b.env.book.settled, []);
  absent(b.env); run(b.env.book, b.env.world, b.env.book.settled + 1, b.env.book.settled + 2);
  assert.notEqual(b.o.status, 'active', `raid still ${b.o.status}`);
  { const rh = hullById(b.env.book, 'klingon', raider.hullId); assert.ok(!rh || rh.status === 'lost', 'the raider destroyed in the scene is still in service'); }
  log.raid = { struck: { strikes: a.o.strikeDays }, repelled: { status: b.o.status, reasons: b.o.resolution?.reasons } };
});

// ===================================================================================================
// PART 9: pirates
// ===================================================================================================
function pirateWorld(seed) {
  const env = campaignWorld(seed, { systems: { 8: { controller: 'pirate', origin: 'pirate' } } });
  env.world.doctrineStep = (b, w, d, fx) => DC.advanceDoctrineDay(b, w, d, fx, doctrine);
  const db = DC.doctrineBook(env.book);
  db.config = { ...db.config, patrols: {}, explorers: {}, reliefShips: {}, merchants: {}, projects: {}, patrolAreas: {}, militaryResponses: false, enforcementResponses: false, predation: true, pirateHaunts: 'auto' };
  run(env.book, env.world, 2, 2);
  return { ...env, db };
}
test('new-feature', '20–23. the captain and the pirates of these waters: one demand, one objective, one encounter on the same group; paid → no battle, loot and cooldown; escaped → closed and cooled, never attacked abstractly after; destroyed → the same group is gone', () => {
  need();
  const captain = { vid: 'vsl:captain', demand: 120, observed: 'freighter', cargo: false };
  const open = (seed) => {
    const env = pirateWorld(seed);
    const g = DC.pirateGroupFor(env.book, env.world, IDX.Minor, captain.vid, 3);
    assert.ok(g, 'no pirate group in its own waters');
    const res = DC.openCaptainPredation(env.book, env.world, g.id, captain, IDX.Minor, 3, []);
    assert.ok(res?.encounter);
    return { env, g, o: res.objective, enc: res.encounter };
  };
  // Paid.
  const a = open('TH-20');
  assert.equal(a.enc.participants.find((p) => p.side === 'pirate').vid, a.g.vid, 'not the group\'s own vid');
  assert.ok(!DC.pirateGroupFor(a.env.book, a.env.world, IDX.Minor, captain.vid, 3), 'a second demand could open while one is live');
  C.resolveEncounterNow(a.env.book, a.env.world, a.enc.id, { result: { outcome: 'paid', answer: 'pay', paid: 120 }, participants: { [a.g.id]: { fate: 'survived', hull: a.g.hull, vid: a.g.vid } } }, 3, []);
  assert.equal(a.o.status, 'completed'); assert.deepEqual(a.o.resolution.reasons, ['cargo_received']);
  assert.equal(a.g.loot, 120); assert.ok(a.g.cooldowns[captain.vid] >= 3 + 29, 'no cooldown');
  assert.equal(a.g.status, 'lurking');
  assert.ok(!DC.pirateGroupFor(a.env.book, a.env.world, IDX.Minor, captain.vid, 10), 'the same crew came back inside its cooldown');
  // Escaped: closed, cooled; days later no abstract attack on the captain.
  const b = open('TH-22');
  C.resolveEncounterNow(b.env.book, b.env.world, b.enc.id, { result: { outcome: 'escaped', answer: 'run' }, participants: { [b.g.id]: { fate: 'survived', hull: b.g.hull, vid: b.g.vid } } }, 3, []);
  assert.equal(b.o.status, 'completed'); assert.deepEqual(b.o.resolution.reasons, ['target_escaped']);
  assert.ok(b.g.cooldowns[captain.vid] >= 32);
  const fx = run(b.env.book, b.env.world, 4, 12);
  assert.equal(fx.filter((f) => f.type === 'doctrinePredation' && f.event === 'attack' && f.targetVid === captain.vid).length, 0, 'an abstract attack after the tactical escape');
  // Destroyed: the same group record is lost.
  const c = open('TH-23');
  C.resolveEncounterNow(c.env.book, c.env.world, c.enc.id, { result: { outcome: 'fought', answer: 'refuse' }, participants: { [c.g.id]: { fate: 'destroyed', hull: 0, vid: c.g.vid } } }, 3, []);
  assert.equal(c.g.status, 'lost'); assert.equal(c.g.hull, 0);
  assert.equal(c.o.status, 'aborted');
  assert.ok(!DC.pirateGroupFor(c.env.book, c.env.world, IDX.Minor, 'vsl:other', 40), 'a lost group demanded again');
  log.pirates = { paid: { loot: a.g.loot, cooldown: a.g.cooldowns[captain.vid] }, escaped: { reasons: b.o.resolution.reasons }, destroyed: { status: c.g.status } };
});

// ===================================================================================================
// PART 11, 10, 12, 13: reports, knowledge, fallback, selection, persistence
// ===================================================================================================
test('new-feature', '24. one report per encounter: the resolution emits one encounterResolved, and the blockade run it records is not reported again', () => {
  need();
  const s = convoyAtBlockade('TH-24');
  run(s.env.book, s.env.world, 3, s.arriveDay);
  const enc = encs(s.env.book).find((e) => e.type === 'blockade');
  const fx = [];
  C.resolveEncounterNow(s.env.book, s.env.world, enc.id, { result: { outcome: 'passed' }, participants: tacticalReport(enc, () => ({ fate: 'survived' })) }, s.arriveDay, fx);
  assert.equal(fx.filter((f) => f.type === 'encounterResolved').length, 1);
  const runs = fx.filter((f) => f.type === 'blockadeRun');
  assert.equal(runs.length, 1); assert.equal(runs[0].engineApplied, true, 'the tactical run would be reported (and applied) a second time');
});
test('new-feature', '25. what the runner\'s crews learn is what was in the scene: a reinforcement still joining the blockade is neither in the encounter nor in the sighting', () => {
  need();
  const s = convoyAtBlockade('TH-25');
  const { env } = s;
  // One more Klingon ship on its way to join (not on station).
  const extra = ready(env.book, 'klingon')[0];
  s.b.hulls.push({ hullId: extra.id, joining: true, vid: vidOf(extra) });
  run(env.book, env.world, 3, s.arriveDay);
  const enc = encs(env.book).find((e) => e.type === 'blockade');
  assert.ok(!enc.participants.some((p) => p.hullId === extra.id), 'the joining ship is in the encounter');
  enc.spawned = enc.participants.filter((p) => p.side === 'blockader').map((p) => p.vid);
  enc.observedByPlayer = true;
  C.resolveEncounterNow(env.book, env.world, enc.id, { result: { outcome: 'passed' }, participants: tacticalReport(enc, () => ({ fate: 'survived' })) }, s.arriveDay, []);
  assert.equal(s.b.sightings.player.force, String(enc.spawned.length), `sighting ${JSON.stringify(s.b.sightings.player)}`);
  assert.equal(s.b.sightings.player.tactical, true);
});
test('new-feature', '26. a scene that cannot be made falls back to the strategic resolver exactly once: one run, the convoy settles once, and a second fallback is refused', () => {
  need();
  const s = convoyAtBlockade('TH-26');
  const { env } = s;
  run(env.book, env.world, 3, s.arriveDay);
  const enc = encs(env.book).find((e) => e.type === 'blockade');
  const fx = [];
  const r1 = C.fallbackEncounterNow(env.book, env.world, enc.id, s.arriveDay, fx, 'test: no scene');
  const r2 = C.fallbackEncounterNow(env.book, env.world, enc.id, s.arriveDay, fx, 'test: again');
  assert.equal(r1.ok, true); assert.equal(r2.ok, false);
  assert.equal(enc.status, 'fallback'); assert.equal(enc.fallback.used, true);
  assert.equal(fx.filter((f) => f.type === 'blockadeRun').length, 1, 'the strategic run did not run exactly once');
  assert.equal(stats(env.book).fallbacks, 1);
  const tr = C.journeyById(env.book, s.tr.id);
  assert.ok(!tr.held);
  assert.equal(tr.encounters.filter((e) => e.system === IDX.Vega).length, 1);
  run(env.book, env.world, s.arriveDay + 1, s.arriveDay + 5);
  assert.equal(C.journeyById(env.book, s.tr.id).encounters.filter((e) => e.system === IDX.Vega && e.seq === s.tr.seq).length, 1, 'the crossing ran again');
});
test('new-feature', '26b. a handoff the captain left before the scene took it up is settled by the model once (no held objective, no stalled crossing); a fallback holds for its own day only, and with the captain back the next day the battle is handed to the scene again', () => {
  need();
  // A blockade interception pending at Vega; the captain gone: the held crossing is released by one strategic run.
  const s = convoyAtBlockade('TH-26b');
  const { env } = s;
  run(env.book, env.world, 3, s.arriveDay);
  const benc = encs(env.book).find((e) => e.type === 'blockade');
  assert.equal(benc.status, 'pending');
  absent(env);
  run(env.book, env.world, s.arriveDay + 1, s.arriveDay + 1);
  assert.equal(benc.status, 'fallback', `the pending interception is ${benc.status} with the captain gone`);
  assert.ok(!C.journeyById(env.book, s.tr.id).held, 'the crossing is still held');
  run(env.book, env.world, s.arriveDay + 2, s.arriveDay + 4);
  assert.equal(C.journeyById(env.book, s.tr.id).encounters.filter((e) => e.system === IDX.Vega && e.seq === s.tr.seq).length, 1, 'the crossing ran again');
  // A war operation handed off, then left pending: settled once that day; the next day, captain back, a new handoff.
  const w = klingonAtVega('TH-26c', 3);
  let d = 2;
  for (; d <= 14; d++) { present(w, IDX.Vega); run(w.book, w.world, d, d); if (encs(w.book).some((e) => e.type === 'operation')) break; }
  const oenc = encs(w.book).find((e) => e.type === 'operation');
  assert.ok(oenc && oenc.status === 'pending', JSON.stringify(oenc && oenc.status));
  absent(w);
  run(w.book, w.world, d + 1, d + 1);
  assert.equal(oenc.status, 'fallback');
  assert.equal(w.op.handoffFallbackDay, d + 1);
  assert.ok(C.fellBackToday(w.op, d + 1)); assert.ok(!C.fellBackToday(w.op, d + 2));
  assert.equal(w.op.status, 'engaged', 'the one fallback battle day ended the operation (fixture no longer exercises the next-day handoff)');
  {
    present(w, IDX.Vega);
    run(w.book, w.world, d + 2, d + 2);
    const again = encs(w.book).filter((e) => e.type === 'operation');
    assert.equal(again.length, 2, 'the captain back the next day: the battle is not handed to the scene again');
    assert.equal(again[1].status, 'pending');
  }
});
test('new-feature', '26c. a held AI crossing that falls back detaches the runners the strategic run lost or disabled, as a tactical result would (none flies on with the journey)', () => {
  need();
  let checked = null;
  for (let k = 0; k < 40 && !checked; k++) {
    const s = convoyAtBlockade(`TH-26c-${k}`);
    const { env } = s;
    run(env.book, env.world, 3, s.arriveDay);
    const enc = encs(env.book).find((e) => e.type === 'blockade');
    const fx = [];
    C.fallbackEncounterNow(env.book, env.world, enc.id, s.arriveDay, fx, 'test: no scene');
    const r = fx.find((f) => f.type === 'blockadeRun');
    const hit = (r?.hulls || []).filter((x) => ['destroyed', 'disabled'].includes(x.condition));
    if (!hit.length) continue;
    const tr = C.journeyById(env.book, s.tr.id);
    checked = { seed: k, hit: hit.map((x) => [x.hullId, x.condition]) };
    for (const x of hit) {
      assert.ok(!tr.members.includes(x.hullId), `${x.condition} runner ${x.hullId} still flies with the journey`);
      const h = hullById(env.book, 'terran', x.hullId);
      if (h && x.condition === 'disabled') assert.notEqual(h.status, 'assigned', 'the disabled runner is still assigned');
    }
    assert.equal(tr.encounters.filter((e) => e.encounterId === enc.id).length, 1);
  }
  assert.ok(checked, 'no fallback run disabled or destroyed a runner in 40 fixtures');
  log.fallbackDetach = checked;
});
test('new-feature', '26d. one vessel, one engagement: a hull already in a live encounter is never a party to a second one (no second copy of it in any scene); the same contact opened twice is one record (duplicate prevented, counted)', () => {
  need();
  const s = convoyAtBlockade('TH-26d');
  const { env } = s;
  run(env.book, env.world, 3, s.arriveDay);
  const first = encs(env.book).find((e) => e.type === 'blockade');
  const held = first.participants.filter((p) => p.side === 'blockader').map((p) => p.hullId);
  assert.ok(held.length > 0);
  const b = env.book.blockades.find((x) => x.id === first.objective.ref);
  const second = C.openBlockadeEncounter(env.book, env.world, b, { key: 'captain:test', sponsor: 'player', kind: 'captain', hulls: [{ hullId: 'captain', vid: 'vsl:test', shipId: 74, hull: 100, maxHull: 100 }] }, s.arriveDay, { captain: true });
  assert.notEqual(second.id, first.id);
  const both = second.participants.filter((p) => p.side === 'blockader' && held.includes(p.hullId));
  assert.equal(both.length, 0, `${both.length} blockader(s) in two live encounters`);
  for (const id of held) assert.equal(hullById(env.book, 'klingon', id).encounterId, first.id);
  // The same contact opened again (the same runner, the same day) is the same record: counted, never a second.
  const dup0 = stats(env.book).duplicatesPrevented;
  const again = C.openBlockadeEncounter(env.book, env.world, b, { key: 'captain:test', sponsor: 'player', kind: 'captain', hulls: [{ hullId: 'captain', vid: 'vsl:test', shipId: 74, hull: 100, maxHull: 100 }] }, s.arriveDay, { captain: true });
  assert.equal(again.id, second.id);
  assert.equal(stats(env.book).duplicatesPrevented, dup0 + 1);
  assert.equal(encs(env.book).filter((e) => e.key === second.key).length, 1);
});
test('new-feature', '26e. an engagement left active with the captain known to be elsewhere (no scene holds it) is disengaged by the model on the next day: records as they stood, nothing lost, the operation goes on', () => {
  need();
  const w = klingonAtVega('TH-26e', 3);
  let d = 2;
  for (; d <= 14; d++) { present(w, IDX.Vega); run(w.book, w.world, d, d); if (encs(w.book).some((e) => e.type === 'operation')) break; }
  const claim = C.claimOperationForScene(w.book, w.op.id, w.world, d);
  assert.ok(claim && claim.encounter.status === 'tactical_active');
  const hulls0 = claim.hulls.map((h) => [h.id, h.hull]);
  present(w, IDX.Earth); // the captain is known to be elsewhere
  run(w.book, w.world, d + 1, d + 1);
  assert.equal(claim.encounter.status, 'resolved'); assert.equal(claim.encounter.result.outcome, 'disengaged');
  for (const [id] of hulls0) { const h = hullById(w.book, 'klingon', id); assert.ok(!h.encounterId, 'still marked'); assert.notEqual(h.status, 'lost'); }
  const before = stats(w.book).abstractSuppressed;
  run(w.book, w.world, d + 2, d + 4);
  assert.equal(stats(w.book).abstractSuppressed, before, 'the operation is still held by a scene nobody is in');
});
test('new-feature', '27. disabled and surrendered tactical outcomes are never picked up by strategic selection (operations, blockades, doctrine)', () => {
  need();
  const s = convoyAtBlockade('TH-27');
  const { env } = s;
  run(env.book, env.world, 3, s.arriveDay);
  const enc = encs(env.book).find((e) => e.type === 'blockade');
  const [kDis, kSur] = enc.participants.filter((p) => p.side === 'blockader');
  C.resolveEncounterNow(env.book, env.world, enc.id, { result: { outcome: 'passed' }, participants: tacticalReport(enc, (p) => p === kDis ? { fate: 'disabled', hull: 10 } : p === kSur ? { fate: 'surrendered', hull: 800, to: 'terran' } : { fate: 'survived' }) }, s.arriveDay, []);
  const hDis = hullById(env.book, 'klingon', kDis.hullId), hSur = hullById(env.book, 'klingon', kSur.hullId);
  absent(env);
  env.book.config.aiStrategicOps = true; env.book.config.planningIntervalDays = 1;
  run(env.book, env.world, s.arriveDay + 1, s.arriveDay + 2);
  for (const o of env.book.operations) assert.ok(!o.hullIds.includes(hDis.id) && !(o.hullIds.includes(hSur.id) && o.createdDay <= s.arriveDay + 1 && hSur.status === 'surrendered'), 'a disabled or surrendered hull was selected');
  assert.equal(C.hullUnavailable(hDis), true);
});
test('new-feature', '28. no cloned or resurrected vessel after handoffs: every vid unique; a destroyed one never comes back', () => {
  need();
  const s = convoyAtBlockade('TH-28');
  const { env } = s;
  run(env.book, env.world, 3, s.arriveDay);
  const enc = encs(env.book).find((e) => e.type === 'blockade');
  const dead = enc.participants.find((p) => p.side === 'blockader');
  C.resolveEncounterNow(env.book, env.world, enc.id, { result: { outcome: 'passed' }, participants: tacticalReport(enc, (p) => p === dead ? { fate: 'destroyed', hull: 0 } : { fate: 'survived' }) }, s.arriveDay, []);
  absent(env);
  env.book.config.aiStrategicOps = true; env.book.config.planningIntervalDays = 5;
  run(env.book, env.world, s.arriveDay + 1, s.arriveDay + 60);
  const vids = liveVids(env.book);
  assert.equal(new Set(vids).size, vids.length, 'duplicate vids');
  assert.ok(!vids.includes(dead.vid), 'the destroyed vessel came back');
});
test('new-feature', '13 (save/load). a pending encounter, a held journey and a tactical_active one survive save/load unchanged; nothing is re-opened or re-run', () => {
  need();
  const s = convoyAtBlockade('TH-SL');
  run(s.env.book, s.env.world, 3, s.arriveDay);
  const b2 = reload(s.env.book);
  const e1 = encs(s.env.book)[0], e2 = encs(b2)[0];
  assert.deepEqual(JSON.parse(JSON.stringify(e2)), JSON.parse(JSON.stringify(e1)));
  assert.deepEqual(C.journeyById(b2, s.tr.id).held, C.journeyById(s.env.book, s.tr.id).held);
  // Continue both: same days, same (no) abstract resolution; no second encounter for the same contact.
  const env2 = { ...s.env, book: b2 };
  run(s.env.book, s.env.world, s.arriveDay + 1, s.arriveDay + 3); run(b2, s.env.world, s.arriveDay + 1, s.arriveDay + 3);
  assert.equal(encs(b2).length, 1); assert.equal(encs(s.env.book).length, 1);
  assert.equal(JSON.stringify(C.journeyById(b2, s.tr.id)), JSON.stringify(C.journeyById(s.env.book, s.tr.id)));
  // Resolving after the reload: same result either way.
  const rep = (enc) => ({ result: { outcome: 'passed' }, participants: tacticalReport(enc, () => ({ fate: 'survived' })) });
  C.resolveEncounterNow(s.env.book, s.env.world, e1.id, rep(e1), s.arriveDay + 3, []);
  C.resolveEncounterNow(b2, env2.world, e2.id, rep(e2), s.arriveDay + 3, []);
  assert.equal(JSON.stringify(C.journeyById(b2, s.tr.id)), JSON.stringify(C.journeyById(s.env.book, s.tr.id)));
});
test('preservation', '29. with the captain absent everywhere, nothing is handed off: a long campaign opens no encounter and suppresses nothing', () => {
  const env = campaignWorld('TH-29');
  env.world.doctrineStep = (b, w, d, fx) => DC.advanceDoctrineDay(b, w, d, fx, doctrine);
  env.book.config.aiStrategicOps = true; env.book.config.planningIntervalDays = 5;
  absent(env);
  run(env.book, env.world, 2, 150);
  assert.equal(encs(env.book).length, 0);
  assert.equal(stats(env.book).abstractSuppressed || 0, 0);
  log.absent = { operations: env.book.operations.length, blockades: (env.book.blockades || []).length };
});
test('preservation', '30. the full movement and time-scale suites stay green, run as-is', () => {
  for (const script of ['scripts/strategic-movement-test.mjs', 'scripts/strategic-time-scale-test.mjs']) {
    const r = spawnSync(process.execPath, [path.join(root, script)], { encoding: 'utf8', env: { ...process.env, BM1_TEST_OUTPUT: '' } });
    const last = (r.stdout || '').trim().split('\n').at(-1);
    assert.equal(r.status, 0, `${script}: ${last}`);
    log[script] = last;
  }
});

// ===================================================================================================
// Integrated (model side)
// ===================================================================================================
test('new-feature', 'BLOCKADE-TACTICAL-HANDOFF (model). contact decided strategically; the same blockaders and runners in the encounter; one branch passes, one is forced back; damage and losses persist; no abstract duplicate', () => {
  need();
  const branch = (tag, outcome) => {
    const s = convoyAtBlockade(tag);
    run(s.env.book, s.env.world, 3, s.arriveDay);
    const enc = encs(s.env.book).find((e) => e.type === 'blockade');
    const leg0 = C.journeyById(s.env.book, s.tr.id).legIndex;
    const runnersIn = enc.participants.filter((p) => p.side === 'runner').map((p) => p.vid).sort();
    assert.deepEqual(runnersIn, s.carriers.map(vidOf).sort());
    assert.deepEqual(enc.participants.filter((p) => p.side === 'blockader').map((p) => p.hullId).sort(), s.b.hulls.filter((t) => !t.joining).map((t) => t.hullId).sort());
    const firstK = enc.participants.find((p) => p.side === 'blockader');
    C.resolveEncounterNow(s.env.book, s.env.world, enc.id, { result: { outcome }, participants: tacticalReport(enc, (p) => p === firstK ? { fate: 'destroyed', hull: 0 } : p.side === 'runner' ? { fate: 'damaged', hull: 420 } : { fate: 'survived' }) }, s.arriveDay, []);
    absent(s.env);
    const fx = run(s.env.book, s.env.world, s.arriveDay + 1, s.arriveDay + 1);
    const kh = hullById(s.env.book, 'klingon', firstK.hullId);
    return { s, enc, fx, runnerHulls: s.carriers.map((h) => h.hull), killed: !kh || kh.status === 'lost' ? 'lost' : kh.status, leg0 };
  };
  const pass = branch('TH-BTH-a', 'passed'), back = branch('TH-BTH-b', 'forced_back');
  for (const x of [pass, back]) {
    assert.equal(x.killed, 'lost');
    assert.ok(x.runnerHulls.every((h) => h === 420), `runner damage not written: ${x.runnerHulls}`);
    assert.equal(x.fx.filter((f) => f.type === 'blockadeRun' && f.evacuationId === x.s.e.id && f.target === IDX.Vega).length, 0, 'the crossing was resolved again abstractly');
  }
  const trP = C.journeyById(pass.s.env.book, pass.s.tr.id);
  assert.ok(trP.legIndex > pass.leg0 || trP.status === 'arrived', `the passing branch did not go on (leg ${trP.legIndex}, ${trP.status})`);
  assert.equal(C.journeyById(back.s.env.book, back.s.tr.id).endReason, 'forced-back');
});
test('new-feature', 'WAR-OP-TACTICAL-HANDOFF (model). an operation that flew real legs engages where the captain is and hands off; save/load around the handoff; survivors return by journey; the ceasefire branch (above, 13) lands nothing', () => {
  need();
  const env = klingonAtVega('TH-WOT', 3);
  const legsFlown = [];
  for (let d = 2; d <= 12; d++) { present(env, IDX.Vega); run(env.book, env.world, d, d); legsFlown.push(env.hs.map((h) => Number(h.systemIndex))); if (encs(env.book).some((e) => e.type === 'operation')) break; }
  assert.equal(env.op.status, 'engaged');
  assert.ok(legsFlown.some((xs) => xs.includes(IDX.Border)), 'the fleet never crossed Border on its real legs');
  const b2 = reload(env.book);
  const enc = encs(b2).find((e) => e.type === 'operation');
  assert.equal(enc.status, 'pending');
  const claim = C.claimOperationForScene(b2, env.op.id, env.world, env.book.settled);
  assert.ok(claim);
  const op2 = b2.operations.find((o) => o.id === env.op.id);
  const [dead, alive, gone] = claim.hulls;
  const report = [{ hullId: dead.id, destroyed: true, hull: 0 }, { hullId: alive.id, destroyed: false, hull: alive.maxHull * 0.5 }, { hullId: gone.id, destroyed: false, hull: gone.maxHull * 0.7, fate: 'escaped' }];
  const fx = [];
  C.reconcileLocalOutcome(b2, env.world, env.op.id, report, 'withdrew', env.book.settled, fx);
  assert.equal(op2.status, 'resolved'); assert.equal(op2.outcome, 'withdrew');
  const home = (b2.journeys || []).filter((j) => j.kind === 'return' && j.ref === env.op.id);
  assert.ok(home.length >= 1, 'survivors did not fly home by journey');
  assert.ok(home.every((j) => !j.members.includes(dead.id)));
  const hAlive = hullById(b2, 'klingon', alive.id);
  assert.equal(Math.round(hAlive.hull), Math.round(alive.maxHull * 0.5)); assert.equal(vidOf(hAlive), vidOf(alive));
  log.warOp = { engagedDay: env.op.engagedDay, outcome: op2.outcome, home: home.map((j) => ({ path: j.path, members: j.members.length })) };
});
test('new-feature', 'PIRATE-TACTICAL-HANDOFF (model, NPC prey). a pirate attack on another ship where the captain is is fought in the scene with the same group and target; the strike does not land abstractly; the result closes the same objective', () => {
  need();
  const env = pirateWorld('TH-PTH');
  const t = ready(env.book, 'terran', IDX.Vega)[0] || ready(env.book, 'terran')[0];
  t.systemIndex = IDX.Vega; t.shipId = 74; t.maxHull = t.hull = 600;
  const a = DC.issueAssignment(env.book, env.world, { polity: 'terran', hullId: t.id, kind: 'delivery', doctrineRole: 'civilian', stops: [{ systemIndex: IDX.Minor, dwell: 6, milestone: 'arrival' }, { systemIndex: IDX.Vega, milestone: 'check_in' }] }, 2, []);
  assert.ok(a.ok, a.reason);
  a.assignment.predationPlan = ['refuse'];
  present(env, IDX.Minor);
  let enc = null;
  for (let d = 3; d < 25 && !enc; d++) { run(env.book, env.world, d, d); enc = encs(env.book).find((e) => e.type === 'predation'); }
  assert.ok(enc, `no handoff: ${JSON.stringify(env.db.objectives.filter((o) => o.kind === 'predation').map((o) => [o.status, o.attack, o.response?.state]))}`);
  const g = env.db.pirates[enc.objective.group];
  assert.equal(enc.participants.find((p) => p.side === 'pirate').vid, g.vid);
  assert.equal(enc.participants.find((p) => p.side === 'target').vid, vidOf(t));
  const hull0 = t.hull;
  const fx = run(env.book, env.world, env.book.settled + 1, env.book.settled + 2);
  assert.equal(fx.filter((f) => f.type === 'doctrinePredation' && f.event === 'attack').length, 0, 'the strike landed abstractly while the scene owned it');
  assert.equal(t.hull, hull0);
  C.resolveEncounterNow(env.book, env.world, enc.id, { result: { outcome: 'fought' }, participants: tacticalReport(enc, (p) => p.side === 'pirate' ? { fate: 'damaged', hull: g.maxHull * 0.3 } : { fate: 'escaped', hull: 500 }) }, env.book.settled, []);
  const o = env.db.objectives.find((x) => x.id === enc.objective.ref);
  assert.notEqual(o.status, 'active'); assert.deepEqual(o.resolution.reasons, ['target_escaped']);
  assert.equal(g.status, 'recovering'); assert.equal(Math.round(g.hull), Math.round(g.maxHull * 0.3));
  assert.equal(t.hull, 500);
});

// ---------------------------------------------------------------------------------------------------
const byTag = (t) => results.filter((r) => r.tag === t);
const summary = ['baseline-defect', 'new-feature', 'preservation'].map((t) => `${t} ${byTag(t).filter((r) => r.ok).length}/${byTag(t).length}`).join(', ');
if (out) { fs.mkdirSync(out, { recursive: true }); fs.writeFileSync(path.join(out, 'strategic-tactical-handoff-test.json'), JSON.stringify({ root, results, log }, null, 1)); }
const failed = results.filter((r) => !r.ok);
console.log(`\nstrategic tactical handoff pure: ${results.length - failed.length}/${results.length} (${summary})${failed.length ? ` — FAILED: ${failed.map((r) => r.name.split('.')[0]).join(', ')}` : ''}`);
process.exit(failed.length ? 1 : 0);
