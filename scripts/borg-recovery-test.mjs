// Pure regressions for BORG-HULK-REGENERATION (docs/doctrine/BORG-HULK-REGENERATION.md): an assimilated hulk is
// brought in by a Borg recovery vessel on the shared tow mission (journeys, crossings, the tow penalty, the hulk let
// go where a tug is lost) to a Borg node, and regenerated there over campaign days — the same hull record throughout.
// The Borg fixture galaxy (borg-fixture.mjs): Unimatrix (9, the Collective's origin world) — Nexus (10) — Qonos (3) —
// Border (2); the Outpost (11) beside Unimatrix. The Cube (class 90) is given its recovery capability as class data
// (as the manifest gives the Assimilation Cube): `borgRecovery: true`, `recoveryCapacity: 10`. Tags:
//   [baseline-defect] e949936 leaves the hulk stranded for ever (fails there on its own assertion);
//   [new-feature]     needs this round's recovery;
//   [preservation]    holds on both.
// Each check names the brief's regression number(s) (1–26) or integrated scenario. BM1_BORG_ROOT runs the suite
// against another tree (the baseline reproduction runs it against e949936).
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(process.env.BM1_BORG_ROOT || path.join(here, '..'));
const imp = (rel) => import(pathToFileURL(path.join(root, rel)).href);
const C = await imp('src/campaign-strategy.mjs');
const DC = await imp('src/doctrine-campaign.mjs');
const D = await imp('src/doctrine-runtime.mjs');
const SPD = await imp('src/strategic-speed.mjs');
const { disableThreshold } = await imp('src/ship-fleet.mjs');
const { makeWorld, station } = await import(pathToFileURL(path.join(root, 'scripts/campaign-world-fixture.mjs')).href);
const BF = await import(pathToFileURL(path.join(here, 'borg-fixture.mjs')).href);
const doctrine = BF.loadDoctrine(D, root);
const out = process.env.BM1_TEST_OUTPUT || null;
const { IDX, SHIPS } = BF;

const results = [];
const log = {};
const test = (tag, name, fn) => {
  try { fn(); results.push({ tag, name, ok: true }); console.log('PASS', `[${tag}]`, name); }
  catch (e) { results.push({ tag, name, ok: false, error: String(e?.message || e).split('\n')[0] }); console.log('FAIL', `[${tag}]`, name, '\n      ', String(e?.stack || e).split('\n').slice(0, 7).join('\n       ')); }
};
const HAS = typeof C.registerRecoveryNodes === 'function';
const need = () => { if (!HAS) throw new Error('this tree has no Borg recovery: an assimilated hulk lies where it was taken for ever'); };
const vidOf = (h) => h?.identity?.vid || h?.vid || h?.id;
const P = (book, id) => C.getPolity(book, id);
const reload = (book) => C.upgradeCampaignBook(JSON.parse(JSON.stringify(book)));
const sum = (e) => DC.borgSummary(e.book);
const recs = (e) => sum(e).recoveries || [];
const days = (e, a, b) => BF.run(C, e.book, e.world, a, b, (x) => (e.fx ||= []).push(x));
function runUntil(e, from, to, pred) { for (let d = from; d <= to; d++) { days(e, d, d); if (pred(d)) return d; } return null; }
// The fixture's classes with the Collective's recovery capability as class data (the manifest's Assimilation Cube).
const RECOVERY_SHIPS = { 90: { ...SHIPS[90], borgRecovery: true, recoveryCapacity: 10 }, 91: { ...SHIPS[91], borgRecovery: true, recoveryCapacity: 10 } };
function env(seed, { rules = {}, borg = {}, reserve = 2, recovery = true, sphereRecovers = false } = {}) {
  const e = BF.borgWorld(C, makeWorld, seed, { DC, doctrine, station, reserve });
  const base = e.world.shipStats;
  e.world.shipStats = (id) => (recovery && Number(id) === 90 ? RECOVERY_SHIPS[90] : sphereRecovers && Number(id) === 91 ? RECOVERY_SHIPS[91] : base(id));
  const db = DC.doctrineBook(e.book);
  db.config = { ...db.config, patrols: {}, explorers: {}, reliefShips: {}, merchants: {}, projects: {}, patrolAreas: {}, militaryResponses: false, enforcementResponses: false, predation: false, hunts: {},
    borg: { ...(db.config.borg || { power: 'borg' }), worlds: false, ships: false, captain: false, ...borg }, borgRules: { ...(db.config.borgRules || {}), ...rules } };
  e.world.localSystem = null;
  // The Collective's tows are AI tows on the shared mission: the shared AI tow switch on (the Borg fixture turns it off).
  e.book.config.aiRecovery = true;
  for (const [pid, p] of Object.entries(e.book.polities)) if (pid !== 'borg') for (const h of p.hulls) h.systemIndex = IDX.Romulus;
  e.borg = P(e.book, 'borg').hulls.slice();
  e.cube = e.borg[0];
  for (const h of e.borg.slice(1)) { h.status = 'assigned'; h.opId = 'held-by-test'; }
  e.made = new Set();
  return e;
}
function make(e, polity, shipId, at, n = 1, { hold = true } = {}) {
  const hs = P(e.book, polity).hulls.filter((h) => h.status === 'ready' && !h.opId && !e.made.has(h.id)).sort((a, b) => String(a.id).localeCompare(String(b.id))).slice(0, n);
  assert.equal(hs.length, n, `not ${n} free ${polity} hulls`);
  for (const h of hs) { e.made.add(h.id); h.shipId = shipId; h.systemIndex = at; h.maxHull = h.hull = e.world.shipStats(shipId).combatHull; h.crew = 1; if (hold) { h.status = 'assigned'; h.opId = 'held-by-test'; } }
  return hs;
}
// An assimilated hulk lying at `at`: a Terran hull disabled there and taken by the Collective's own assimilation
// transfer (campaign-strategy assimilateHull: the same record moves; its crew assimilated), on day `day`.
function hulkAt(e, at, { shipId = 80, day = 1, crew = 1 } = {}) {
  const [t] = make(e, 'terran', shipId, at);
  t.hull = Math.max(1, Math.floor(disableThreshold(t.maxHull)));
  const h = C.assimilateHull(e.book, t, 'terran', 'borg', day, at, { result: crew > 0 ? 'crew_assimilated' : 'target_abandoned', before: 1, survivors: 0, assimilated: crew, after: crew });
  assert.ok(h, 'assimilateHull refused');
  return h;
}
const recFor = (e, h) => recs(e).filter((r) => r.hullId === h.id).slice(-1)[0] || null;
const missionFor = (e, r) => (r?.missionId ? C.hullRecoveryById(e.book, r.missionId) : null) || (r?.missions?.length ? C.hullRecoveryById(e.book, r.missions[r.missions.length - 1]) : null);
const allVids = (e) => { const v = [...Object.values(e.book.polities).flatMap((p) => p.hulls), ...(e.book.derelicts || [])].filter((h) => h.status !== 'lost' || h.derelict).map(vidOf); return v; };
// A full recovery from Border (three legs from Unimatrix), recording the hulk every day.
function recoveryCase(seed, opts = {}) {
  const e = env(seed, opts);
  const h = hulkAt(e, opts.at ?? IDX.Border);
  const trace = [];
  const vid0 = vidOf(h), shipId0 = h.shipId, origin0 = h.identity?.origin?.builder;
  const done = runUntil(e, 2, opts.to ?? 160, (d) => { trace.push({ d, at: h.systemIndex, transit: h.transit ? { to: h.transit.to } : null, hull: Math.round(h.hull), disabled: C.hullIsDisabled(h), status: h.status, phase: recFor(e, h)?.phase ?? null, owner: P(e.book, 'borg').hulls.includes(h) ? 'borg' : 'other' }); return opts.until ? opts.until(e, h, d) : Boolean(recFor(e, h)?.result); });
  return { e, h, trace, done, vid0, shipId0, origin0 };
}

// ===================================================================================================
// The hulk without recovery (1, 3)
// ===================================================================================================
test('preservation', '1. an assimilated disabled hull does not self-repair: with no recovery vessel among the Collective\'s classes, 60 days pass and it lies where it was taken — the same hull, still disabled, its hull unchanged', () => {
  const e = env('BR-1', { recovery: false });
  const h = hulkAt(e, IDX.Outpost);
  const hull0 = h.hull;
  days(e, 2, 61);
  assert.equal(h.systemIndex, IDX.Outpost); assert.equal(h.hull, hull0); assert.ok(C.hullIsDisabled(h)); assert.ok(P(e.book, 'borg').hulls.includes(h));
  assert.ok(!h.transit);
});
test('baseline-defect', '3. no eligible Borg recovery vessel → the hulk stays stranded (a recovery objective waits for one: "no Borg recovery vessel free"); once the Cube is recovery-capable the same hulk is brought in (e949936: it lies there for ever)', () => {
  const e = env('BR-3', { recovery: false });
  const h = hulkAt(e, IDX.Outpost);
  days(e, 2, 20);
  if (HAS) { const r = recFor(e, h); assert.ok(r, 'no recovery objective'); assert.equal(r.phase, 'recovery_pending'); assert.equal(r.waitReason, 'no Borg recovery vessel free'); }
  assert.equal(h.systemIndex, IDX.Outpost); assert.ok(C.hullIsDisabled(h));
  const f = recoveryCase('BR-3b', { at: IDX.Outpost });
  log.r3 = { result: recFor(f.e, f.h)?.result, at: f.h.systemIndex, status: f.h.status, hull: f.h.hull };
  assert.ok(!C.hullIsDisabled(f.h), 'the hulk was never brought in');
});
// ===================================================================================================
// BORG-HULK-RECOVERY (2, 4, 5, 7–9, 14–16, 18, 19, 24)
// ===================================================================================================
let main = null;
test('new-feature', 'BORG-HULK-RECOVERY / 2, 4, 5, 7, 8, 9, 14, 15, 16, 18, 19, 24. the hulk at Border is recovered: the Cube jumps by conduit to it (2 d), makes it fast only when both stand at Border, tows it home conventionally over three legs at the shared tow speed (0.70×), the hulk disabled throughout; Unimatrix takes it in and regenerates it over campaign days; at the threshold the same hull — vid, class, origin, assimilation, crew — returns to service under the Collective, with no conduit of its own and no new identity', () => {
  need();
  const c = recoveryCase('BR-MAIN');
  main = c;
  const { e, h, trace } = c;
  const r = recFor(e, h);
  const m = missionFor(e, r);
  log.main = { result: r.result, phases: r.history.map((x) => [x.day, x.phase, x.note]), movement: r.movement, outbound: m.outbound, inbound: m.inbound, attachment: m.attachment, regen: r.regen, trace: trace.filter((x, i) => i % 3 === 0 || i === trace.length - 1) };
  assert.equal(r.result.result, 'hulk_operational', JSON.stringify(r.result));
  // 2/24: the same record, the same identity
  assert.equal(vidOf(h), c.vid0); assert.equal(h.shipId, c.shipId0); assert.equal(h.identity.origin.builder, c.origin0); assert.equal(h.assimilated.from, 'terran');
  assert.ok(P(e.book, 'borg').hulls.includes(h)); const v = allVids(e); assert.equal(v.length, new Set(v).size, 'duplicate identities');
  // 4/5: out by conduit, a real journey of the Cube
  assert.equal(m.outbound.mode, 'transwarp'); assert.equal(m.outbound.eta - m.outbound.departDay, 2); assert.equal(m.tug.vid, vidOf(e.cube));
  // 7: made fast only when co-located
  const att = m.attachment.day;
  for (const x of trace.filter((t) => t.d < att)) assert.equal(x.at, IDX.Border, `the hulk moved before attachment (day ${x.d})`);
  assert.equal(m.outbound.eta, att);
  // 19/9: home conventionally, three legs, at the tow speed
  const tr = C.journeyById(e.book, m.inbound.journeyId);
  assert.ok(!tr.mode || tr.mode === 'conventional', tr.mode); assert.deepEqual(m.inbound.route, [IDX.Border, IDX.Qonos, IDX.Nexus, IDX.Unimatrix]);
  assert.equal(tr.speed, SPD.towSpeed(C.hullsSpeed(e.world, [e.cube]), e.book.config.towPenalty)); assert.equal(e.book.config.towPenalty, 0.7);
  // 8: disabled throughout the tow
  for (const x of trace.filter((t) => t.d >= att && t.d < m.inbound.eta)) assert.ok(x.disabled, `not disabled under tow on day ${x.d}`);
  // 14/15/16: regenerated at the node over time; operational only at the threshold
  const regenDays = trace.filter((t) => t.phase === 'regenerating').length;
  assert.ok(regenDays >= 20, `regenerated in ${regenDays} days`);
  for (const x of trace.filter((t) => t.phase === 'regenerating')) assert.notEqual(x.status, 'ready', `operational before the threshold (day ${x.d}, hull ${x.hull})`);
  assert.equal(h.status, 'ready'); assert.ok(h.hull >= h.maxHull * 0.6 - 1e-9); assert.equal(h.systemIndex, IDX.Unimatrix);
  // 18: no conduit of its own
  assert.equal(C.transwarpCapable(e.world, h), false);
});
test('new-feature', '6. an ineligible recovery vessel cannot use a conduit: a recovery-capable sphere (no transwarp of its own) flies out conventionally, leg by leg', () => {
  need();
  const e = env('BR-6', { sphereRecovers: true });
  e.cube.status = 'assigned'; e.cube.opId = 'held-by-test';
  const sphere = e.borg[1]; sphere.shipId = 91; sphere.maxHull = sphere.hull = SHIPS[91].combatHull; sphere.status = 'ready'; sphere.opId = null; sphere.systemIndex = IDX.Unimatrix;
  const h = hulkAt(e, IDX.Qonos);
  runUntil(e, 2, 30, () => Boolean(missionFor(e, recFor(e, h))));
  const m = missionFor(e, recFor(e, h));
  log.r6 = { movement: m.borgMovement, outbound: m.outbound };
  assert.equal(m.tug.hullId, sphere.id); assert.equal(m.outbound.mode, 'conventional'); assert.equal(m.borgMovement.reason, 'no transwarp capability in the force');
  assert.deepEqual(m.outbound.route, [IDX.Unimatrix, IDX.Nexus, IDX.Qonos]);
});
test('preservation', '19. a conduit never carries a tow: the Cube with a hulk made fast asking the shared journey system for a transwarp journey home is refused, and nothing moves; the same Cube alone may open one (e949936 refuses it on the hulk\'s own lack of a conduit; this round refuses any tow outright: "a tow cannot open a conduit")', () => {
  const e = env('BR-19');
  const h = hulkAt(e, IDX.Border);
  e.cube.systemIndex = IDX.Border;
  const tw = { days: 2, cooldownDays: 40, minCondition: 0.5, conventionalDays: 20 };
  const st0 = e.book.stats.journeys?.transwarpRefused || 0;
  const towed = C.startJourney(e.book, e.world, { kind: 'recovery', ref: 'test', sponsor: 'borg', hulls: [e.cube, h], destination: IDX.Unimatrix, purpose: 'recovery', mode: 'transwarp', transwarp: tw, tow: { targets: [h.id] } }, 1, []);
  log.r19 = { towed: { ok: towed.ok, reason: towed.reason }, refused: (e.book.stats.journeys?.transwarpRefused || 0) - st0 };
  assert.equal(towed.ok, false); if (HAS) assert.match(towed.reason, /a tow cannot open a conduit/);
  assert.equal(h.systemIndex, IDX.Border); assert.ok(!h.transit && !e.cube.transit);
  const alone = C.startJourney(e.book, e.world, { kind: 'recovery', ref: 'test', sponsor: 'borg', hulls: [e.cube], destination: IDX.Unimatrix, purpose: 'recovery', mode: 'transwarp', transwarp: tw }, 1, []);
  log.r19.alone = { ok: alone.ok, mode: alone.journey?.mode };
  assert.equal(alone.ok, true, alone.reason); assert.equal(alone.journey.mode, 'transwarp');
});
test('new-feature', '10. save/load mid-tow keeps the route and ETA: the campaign reloaded on the second leg delivers on the same day, the same journey, the same hull', () => {
  need();
  const a = recoveryCase('BR-10', { until: (e, h) => C.hullRecoveryById(e.book, recFor(e, h)?.missionId)?.state === 'towing' && h.transit && Number(h.transit.from) === IDX.Qonos });
  const m0 = missionFor(a.e, recFor(a.e, a.h));
  const before = { eta: m0.inbound.eta, route: m0.inbound.route, journey: m0.inbound.journeyId };
  a.e.book = reload(a.e.book);
  const h2 = P(a.e.book, 'borg').hulls.find((x) => x.id === a.h.id);
  const d = runUntil(a.e, a.done + 1, a.done + 40, () => missionFor(a.e, recFor(a.e, h2))?.state === 'delivered_to_yard');
  const m1 = missionFor(a.e, recFor(a.e, h2));
  log.r10 = { before, after: { eta: m1.inbound.eta, route: m1.inbound.route, journey: m1.inbound.journeyId }, deliveredDay: d };
  assert.equal(m1.inbound.journeyId, before.journey); assert.equal(m1.inbound.eta, before.eta); assert.deepEqual(m1.inbound.route, before.route); assert.equal(d, before.eta);
  assert.equal(h2.systemIndex, IDX.Unimatrix); assert.equal(vidOf(h2), a.vid0);
});
// ===================================================================================================
// BORG-RECOVERY-INTERDICTED (11, 12, 23)
// ===================================================================================================
// A Terran blockade of Qonos (the tow's first crossing). `n` blockaders of `cls`.
function blockadeQonos(e, cls, n) {
  e.relations['klingon:terran'] = 'war';
  const ts = make(e, 'terran', cls, IDX.Qonos, n, { hold: false });
  const b = C.startBlockade(e.book, e.world, { power: 'terran', target: IDX.Qonos, hullIds: ts.map((x) => x.id), purpose: 'interdict_trade' }, 1, []);
  assert.ok(b.ok, b.reason);
  return b.record;
}
function interdicted(seedBase, cls, n, want) {
  for (let k = 0; k < 40; k++) {
    const e = env(`${seedBase}-${k}`);
    const h = hulkAt(e, IDX.Border);
    const b = blockadeQonos(e, cls, n);
    const d = runUntil(e, 2, 90, () => { const r = recFor(e, h); return Boolean(r?.result) || (b.runs || []).some((x) => x.sponsor === 'borg' && x.day > 2 && h.transit == null && missionFor(e, r)?.state !== 'towing'); });
    const r = recFor(e, h), m = missionFor(e, r);
    const run = (b.runs || []).filter((x) => x.sponsor === 'borg').slice(-1)[0] || null;
    const got = r?.result?.result === 'recovery_vessel_destroyed' ? 'lost' : run && m && ['delivered_to_yard'].includes(m.state) ? 'through' : run && m?.state === 'towing' && h.systemIndex !== IDX.Border ? 'through' : null;
    if (got === want) return { e, h, b, r, m, run, k, d };
  }
  return null;
}
test('new-feature', 'BORG-RECOVERY-INTERDICTED / 11. a tow crossing a blockade is run through the shared blockade engine: one branch gets through (the tow goes on, the hulk still in tow); the run is on the blockade\'s record and on the tow journey, with the Cube as the tug and the hulk as a towed member at the tow speed', () => {
  need();
  const x = interdicted('BR-11', 86, 1, 'through');
  assert.ok(x, 'no seed got through');
  const fx = (x.e.fx || []).filter((f) => f.type === 'blockadeRun' && f.sponsor === 'borg');
  const tr = C.journeyById(x.e.book, x.m.inbound.journeyId);
  log.r11 = { seed: x.k, run: x.run, effect: fx[0] && { outcome: fx[0].outcome, kind: fx[0].kind, journeyKind: fx[0].journeyKind, hulls: fx[0].hulls.map((y) => [y.vid, y.role, y.condition]) }, journey: tr.encounters, towSpeed: tr.speed, mission: { state: x.m.state, losses: x.m.losses }, hulk: { at: x.h.systemIndex } };
  assert.equal(fx.length, 1, 'the run is not on the shared engine');
  assert.equal(fx[0].continues, true, fx[0].outcome); assert.equal(fx[0].journeyId, x.m.inbound.journeyId); assert.equal(fx[0].blockadeId, x.b.id);
  assert.ok(fx[0].hulls.some((y) => y.vid === vidOf(x.e.cube) && y.role === 'tug')); assert.ok(fx[0].hulls.some((y) => y.vid === vidOf(x.h) && y.role === 'towed' && y.condition === 'disabled'));
  assert.ok(x.run && x.run.sponsor === 'borg'); assert.equal(tr.encounters.filter((y) => y.blockadeId === x.b.id).length, 1);
  assert.equal(tr.speed, SPD.towSpeed(C.hullsSpeed(x.e.world, [x.e.cube]), 0.7));
  assert.ok(['towing', 'delivered_to_yard'].includes(x.m.state), x.m.state); assert.ok(x.m.losses.every((l) => l.hullId !== x.m.tug.hullId), 'the tug was lost');
  assert.ok(x.h.systemIndex !== IDX.Border && x.e.cube.status !== 'lost');
});
test('new-feature', 'BORG-RECOVERY-INTERDICTED / 12. the other branch loses the recovery vessel at the blockade: the Cube is destroyed at Qonos, the tow is let go there, and the hulk lies at Qonos — where it actually is — still disabled, still the Collective\'s, its recovery closed as recovery_vessel_destroyed (never teleported home)', () => {
  need();
  const x = interdicted('BR-12', 86, 6, 'lost');
  assert.ok(x, 'no seed lost the tug');
  log.r12 = { seed: x.k, run: x.run, result: x.r.result, hulk: { at: x.h.systemIndex, disabled: C.hullIsDisabled(x.h), status: x.h.status }, cube: x.e.cube.status, losses: x.m.losses };
  assert.equal(x.e.cube.status, 'lost');
  assert.equal(x.h.systemIndex, IDX.Qonos); assert.ok(C.hullIsDisabled(x.h)); assert.ok(!x.h.transit); assert.ok(P(x.e.book, 'borg').hulls.includes(x.h));
  assert.equal(x.r.result.result, 'recovery_vessel_destroyed');
});
test('new-feature', '23. the tactical handoff writes back the same hulls: with the captain at Qonos the interception is held for his scene (one encounter, the Cube as a runner, the hulk towed and not spawned); the scene\'s result lands on the same Cube record, the hulk is untouched, the tow goes on; no strategic damage beside it', () => {
  need();
  let x = null;
  for (let k = 0; k < 40 && !x; k++) {
    const e = env(`BR-23-${k}`);
    e.world.localSystem = IDX.Qonos;
    const h = hulkAt(e, IDX.Border);
    const b = blockadeQonos(e, 86, 1);
    const d = runUntil(e, 2, 60, () => (e.book.encounters || []).some((en) => en.type === 'blockade' && en.status === 'pending'));
    if (d) x = { e, h, b, d };
  }
  assert.ok(x, 'no seed held an interception for the scene');
  const { e, h, b, d } = x;
  const enc = e.book.encounters.find((en) => en.type === 'blockade' && en.status === 'pending');
  const cubeHull0 = e.cube.hull, hulkHull0 = h.hull;
  const runner = enc.participants.filter((p) => p.side === 'runner');
  log.r23 = { day: d, enc: { id: enc.id, captain: enc.captain, participants: enc.participants.map((p) => [p.side, p.vid, p.spawn, p.towed]) } };
  assert.ok(runner.some((p) => p.vid === vidOf(e.cube) && p.spawn)); assert.ok(runner.some((p) => p.vid === vidOf(h) && p.towed && !p.spawn), 'the hulk was put into the scene');
  // Days pass while it is held: nothing strategic touches the tow.
  days(e, d + 1, d + 2);
  assert.equal(e.cube.hull, cubeHull0); assert.equal(h.hull, hulkHull0);
  // The scene's result: the Cube damaged to 70%, the blockaders beaten off.
  const participants = {};
  for (const p of enc.participants) participants[p.ref] = p.side === 'runner' ? (p.towed ? null : { fate: 'damaged', hull: Math.round(e.cube.maxHull * 0.7), vid: p.vid }) : { fate: 'survived', hull: p.before?.hull, vid: p.vid };
  for (const k of Object.keys(participants)) if (!participants[k]) delete participants[k];
  const r = C.resolveEncounterNow(e.book, e.world, enc.id, { result: { outcome: 'passed' }, participants }, d + 2, []);
  assert.ok(r.ok, r.reason);
  assert.equal(e.cube.hull, Math.round(e.cube.maxHull * 0.7)); assert.equal(h.hull, hulkHull0); assert.ok(C.hullIsDisabled(h));
  assert.equal(e.book.encounters.filter((en) => en.type === 'blockade' && String(en.objective?.ref) === String(b.id)).length, 1);
  const tr = C.journeyById(e.book, missionFor(e, recFor(e, h)).inbound.journeyId);
  assert.ok(!tr.held || tr.status !== 'underway' || tr.held == null, 'still held');
  assert.ok((tr.encounters || []).filter((x2) => x2.blockadeId === b.id).length <= 1, 'run twice');
});
// ===================================================================================================
// BORG-NODE-VALIDATION (13, 14) and no yard semantics (17)
// ===================================================================================================
test('new-feature', 'BORG-NODE-VALIDATION / 13, 14. a freshly assimilated world is no node: a hulk lying at the Outpost the day it was assimilated is towed to Unimatrix instead (and the Outpost lists "stabilizing until day N"); once stabilized the Outpost is a node — a hulk lying there is taken in where it lies (no vessel, no tow) and regenerated; Unimatrix (origin) is always a node', () => {
  need();
  const e = env('BR-13', { rules: { nodeStabilizeDays: 30 } });
  e.world.systems[IDX.Outpost].controller = 'borg';
  DC.borgSummary(e.book); // book
  const bb = DC.doctrineBook(e.book).borg ||= {};
  (bb.assimilatedWorlds ||= []).push({ systemIndex: IDX.Outpost, from: 'terran', origin: 'terran', day: 1, objectiveId: 'test' });
  const h = hulkAt(e, IDX.Outpost);
  const d = runUntil(e, 2, 40, () => Boolean(missionFor(e, recFor(e, h))));
  const m = missionFor(e, recFor(e, h));
  const nodes = DC.borgDebug(e.book, e.world).hulkRecovery.nodes;
  log.r13 = { mission: { yard: m.yard, state: m.state }, nodes, day: d };
  assert.equal(m.yard, IDX.Unimatrix, 'a fresh world took the hulk');
  const op = nodes.find((n) => n.systemIndex === IDX.Outpost);
  assert.equal(op.ok, false); assert.match(op.reason, /stabilizing until day 31/);
  assert.equal(nodes.find((n) => n.systemIndex === IDX.Unimatrix).ok, true);
  // After the stabilization: a second hulk at the Outpost is taken in where it lies.
  const e2 = env('BR-13b', { rules: { nodeStabilizeDays: 30 } });
  e2.world.systems[IDX.Outpost].controller = 'borg';
  (DC.doctrineBook(e2.book).borg ||= {}).assimilatedWorlds = [{ systemIndex: IDX.Outpost, from: 'terran', origin: 'terran', day: 1, objectiveId: 'test' }];
  days(e2, 2, 31);
  const h2 = hulkAt(e2, IDX.Outpost, { day: 31 });
  e2.cube.status = 'assigned'; e2.cube.opId = 'held-by-test'; // no vessel needed: the node is where it lies
  runUntil(e2, 32, 50, () => Boolean(h2.borgRegen?.state === 'regenerating'));
  const r2 = recFor(e2, h2);
  log.r13b = { rec: { node: r2?.node, movement: r2?.movement, missions: r2?.missions, history: r2?.history }, regen: h2.borgRegen, at: h2.systemIndex };
  assert.equal(r2.node, IDX.Outpost); assert.equal(r2.missions.length, 0, 'a vessel was sent'); assert.equal(h2.systemIndex, IDX.Outpost); assert.equal(h2.borgRegen.state, 'regenerating');
});
test('new-feature', '17. no market, yard or production right comes of it: through the whole recovery no yard repairs it (no repair-day on any book), no licence or production right is granted, no world changes hands, no capture or occupation is recorded', () => {
  need();
  const e = env('BR-17');
  const lic0 = JSON.stringify(P(e.book, 'borg').licenses || {}), ctl0 = e.world.systems.map((s) => s.controller).join();
  const h = hulkAt(e, IDX.Outpost);
  let yardRepair = 0;
  runUntil(e, 2, 120, () => { for (const p of Object.values(e.book.polities)) yardRepair += Object.values(p.repairedToday || {}).reduce((n, x) => n + x, 0); return Boolean(recFor(e, h)?.result); });
  assert.equal(recFor(e, h).result.result, 'hulk_operational');
  assert.equal(yardRepair, 0, 'a yard repaired something');
  assert.equal(JSON.stringify(P(e.book, 'borg').licenses || {}), lic0); assert.equal(C.polityCanBuildDesign(e.book, e.world, 'borg', 80), false);
  assert.equal(e.world.systems.map((s) => s.controller).join(), ctl0); assert.equal(Object.keys(e.book.occupations || {}).length, 0);
  assert.equal(e.book.stats.captures || 0, 0);
});
// ===================================================================================================
// Salvage, abandonment, Hirogen (20–22)
// ===================================================================================================
test('new-feature', '20. an active Borg recovery blocks ordinary salvage: while the Cube is on its way a Terran salvage claim on the hulk is refused as already claimed; a hulk lying crewed by drones is no free salvage either', () => {
  need();
  const e = env('BR-20');
  const h = hulkAt(e, IDX.Border);
  const before = C.recoveryClaim(e.book, e.world, 'terran', h.id);
  runUntil(e, 2, 20, () => Boolean(recFor(e, h)?.missionId));
  const during = C.recoveryClaim(e.book, e.world, 'terran', h.id);
  log.r20 = { before, during };
  assert.equal(during.ok, false); assert.match(during.reason, /already claimed/);
  assert.equal(before.ok, false);
});
test('new-feature', '21. an abandoned hulk is ordinary salvage: with no node the Collective can reach (the nearest lies beyond the bounded tow) the recovery ends no_reachable_node, the Collective writes the hulk off where it lies (a derelict, ownership history kept: "abandoned"), and a Terran salvage claim on it is now allowed', () => {
  need();
  // Unimatrix three legs from Border; the bounded tow cut to 4 days: no node in reach. (A blockade cannot shut a Borg
  // node: no power is formally at war with the Collective.)
  const e = env('BR-21', { rules: { searchDays: 5, recoveryMaxTowDays: 4 } });
  const h = hulkAt(e, IDX.Border);
  const before = C.recoveryClaim(e.book, e.world, 'terran', h.id);
  runUntil(e, 2, 60, () => Boolean(recFor(e, h)?.result));
  const r = recFor(e, h);
  const d = (e.book.derelicts || []).find((x) => x.id === h.id);
  const claim = C.recoveryClaim(e.book, e.world, 'terran', h.id);
  log.r21 = { result: r.result, waits: r.history.map((x) => [x.day, x.phase, x.note]), derelict: d?.derelict, provenance: d?.identity?.history?.slice(-2), before, claim };
  assert.equal(before.ok, false, 'claimable while the Collective held it');
  assert.equal(r.result.result, 'no_reachable_node'); assert.ok(!r.missions.length, 'a tug was sent');
  assert.ok(d, 'not a derelict'); assert.equal(d.derelict.abandonedBy, 'borg'); assert.equal(d.systemIndex, IDX.Border);
  assert.equal(vidOf(d), vidOf(h)); assert.equal(d.shipId, 80);
  assert.ok((d.identity.history || []).some((p) => p.event === 'assimilated') && (d.identity.history || []).some((p) => p.event === 'abandoned'));
  assert.equal(claim.ok, true, claim.reason); assert.equal(claim.kind, 'salvage');
});
test('preservation', '22. the Hirogen still ignore an assimilated disabled wreck (and, this round, one regenerating at a node): a Klingon hunter power standing beside it never records it as a contact; once operational again it may be seen like any vessel', () => {
  const e = env('BR-22');
  DC.doctrineBook(e.book).config.hunts = { klingon: {} };
  const h = hulkAt(e, IDX.Outpost);
  make(e, 'klingon', 21, IDX.Outpost, 1);
  days(e, 2, 3);
  const seen = () => Object.values(DC.huntSummary(e.book).contacts.klingon || {}).some((c) => (c.vids || [c.vid]).includes(vidOf(h)));
  assert.equal(seen(), false, 'a hunter saw the disabled wreck');
  if (HAS) {
    runUntil(e, 4, 120, () => Boolean(h.borgRegen && h.borgRegen.state === 'regenerating' && !C.hullIsDisabled(h)));
    const d0 = e.book.day ?? 0;
    make(e, 'klingon', 21, IDX.Unimatrix, 1);
    const d1 = runUntil(e, d0 + 1, d0 + 3, () => false);
    assert.ok(h.borgRegen, 'regenerated already'); assert.ok(!C.hullIsDisabled(h));
    assert.equal(seen(), false, 'a hunter saw a hulk under regeneration');
    // Once operational it is prey again: seen like any Borg vessel.
    const d2 = runUntil(e, d0 + 4, d0 + 60, () => !h.borgRegen && h.status === 'ready' && seen());
    log.r22 = { regenFrom: d0, operationalSeen: d2 };
    assert.ok(d2, 'never seen once operational');
  }
});
// ===================================================================================================
// Preservation (25, 26) and bounded objectives
// ===================================================================================================
function stripRecovery(x) { return JSON.stringify({ ...x, recoveries: undefined, stats: Object.fromEntries(Object.entries(x.stats || {}).filter(([k]) => !/Recover|Regen|Hulks|Returned|AwaitingDrones/.test(k))) }); }
test('preservation', '25. captain assimilation is unchanged: the captain case (his contact, objective and encounter) runs identically with recovery on and off', () => {
  const run = (rec) => { const e = env('BR-25', { borg: { captain: true, recovery: rec } }); e.world.captain = { systemIndex: IDX.Outpost, moving: false, docked: false, disabled: false, vid: 'vsl:cap', cls: 'military', shipId: 80, hullFrac: 1, speed: 1, cloaked: false, escorts: [], heading: null }; e.world.localSystem = IDX.Outpost; days(e, 2, 20); return e; };
  const a = run(true), b = run(false);
  assert.equal(stripRecovery(sum(a)), stripRecovery(sum(b))); assert.equal(JSON.stringify(a.book.encounters), JSON.stringify(b.book.encounters));
});
test('preservation', '26. ship and world assimilation are unchanged: the cruiser case at the Outpost runs identically with recovery on and off up to the day the cruiser is taken; the world case identically throughout', () => {
  const ship = (rec) => { const e = env('BR-26', { borg: { ships: true, recovery: rec } }); make(e, 'terran', 80, IDX.Outpost); const d = runUntil(e, 2, 60, () => (sum(e).assimilatedHulls || []).length > 0); return { e, d }; };
  const a = ship(true), b = ship(false);
  assert.equal(a.d, b.d); assert.equal(stripRecovery(sum(a.e)), stripRecovery(sum(b.e)));
  const world = (rec) => { const e = env('BR-26w', { borg: { worlds: true, recovery: rec } }); days(e, 2, 70); return e; };
  assert.equal(stripRecovery(sum(world(true))), stripRecovery(sum(world(false))));
});
test('new-feature', 'AI-SWITCH. the shared AI tow switch governs the Collective\'s tows too: with campaign config aiRecovery off no vessel is sent (the objective waits, saying why); a hulk lying at a node is still taken in where it lies (no tow)', () => {
  need();
  const e = env('BR-SW');
  e.book.config.aiRecovery = false;
  const h = hulkAt(e, IDX.Border);
  const g = hulkAt(e, IDX.Unimatrix);
  days(e, 2, 12);
  const r = recFor(e, h);
  log.aiSwitch = { wait: r?.waitReason, missions: r?.missions, hulkAt: h.systemIndex, atNode: Boolean(g.borgRegen), recoveries: (e.book.hullRecoveries || []).length };
  assert.equal(r.phase, 'recovery_pending'); assert.match(r.waitReason, /switched off/); assert.equal(r.missions.length, 0); assert.equal((e.book.hullRecoveries || []).length, 0);
  assert.equal(h.systemIndex, IDX.Border); assert.ok(g.borgRegen, 'the node did not take in the hulk lying there');
});
test('new-feature', 'BOUNDED. no immortal objective: every hulk has its own objective and pending budget from the day it lies stranded; with the recovery vessel kept busy, each waiting longer than the budget is abandoned (written off where it lies) and its objective closed; at most two recoveries are under way at once', () => {
  need();
  const e = env('BR-B', { rules: { recoveryPendingDays: 20 } });
  e.cube.status = 'assigned'; e.cube.opId = 'held-by-test';
  const hs = [hulkAt(e, IDX.Outpost), hulkAt(e, IDX.Nexus), hulkAt(e, IDX.Border)];
  let opened = 0;
  runUntil(e, 2, 30, () => { opened = Math.max(opened, recs(e).length); return false; });
  log.bounded = { opened, results: recs(e).map((r) => [r.hullId, r.createdDay, r.result?.result, r.result?.day]) };
  assert.equal(opened, 3, 'a hulk without its own objective');
  assert.ok(recs(e).every((r) => r.result?.result === 'abandoned' && r.result.day - r.createdDay <= 22), JSON.stringify(log.bounded.results));
  assert.ok(hs.every((h) => h.status === 'lost' && h.fate === 'written_off' && h.derelict?.abandonedBy === 'borg'));
  // Under way: never more than the limit, with vessels to spare.
  const f = env('BR-B2', { sphereRecovers: true, rules: { recoveryMaxActive: 1 } });
  const sphere = f.borg[1]; sphere.shipId = 91; sphere.maxHull = sphere.hull = SHIPS[91].combatHull; sphere.status = 'ready'; sphere.opId = null; sphere.systemIndex = IDX.Unimatrix;
  hulkAt(f, IDX.Qonos); hulkAt(f, IDX.Nexus);
  let maxUnder = 0;
  runUntil(f, 2, 20, () => { maxUnder = Math.max(maxUnder, recs(f).filter((r) => !r.result && r.missionId).length); return false; });
  log.bounded.maxUnder = maxUnder; log.bounded.waits = recs(f).map((r) => r.waitReason);
  assert.equal(maxUnder, 1); assert.ok(recs(f).some((r) => /already under way/.test(r.waitReason || '')), JSON.stringify(log.bounded.waits));
});

const failed = results.filter((r) => !r.ok);
const by = (t) => `${t} ${results.filter((r) => r.tag === t && r.ok).length}/${results.filter((r) => r.tag === t).length}`;
const line = `borg hulk recovery pure: ${results.length - failed.length}/${results.length} (${['baseline-defect', 'new-feature', 'preservation'].map(by).join(', ')})`;
console.log(`\n${line}${failed.length ? ` — FAILED: ${failed.map((r) => r.name.split(' ')[0]).join(', ')}` : ''}`);
if (out) { fs.mkdirSync(out, { recursive: true }); fs.writeFileSync(path.join(out, process.env.BM1_BORG_ROOT ? 'borg-recovery-pure-baseline.json' : 'borg-recovery-pure.json'), JSON.stringify({ line, root, results, log }, null, 1)); }
process.exit(failed.length ? 1 : 0);
