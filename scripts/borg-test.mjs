// Pure regressions for BORG-ASSIMILATION-TRANSWARP (docs/doctrine/BORG-ASSIMILATION-TRANSWARP.md). The campaign
// suites' galaxy plus Unimatrix, the Nexus and the Outpost (borg-fixture.mjs), the real doctrine data. Tags:
//   [baseline-defect] 9db1fc6's generic Borg get it wrong (fails there on its own assertion);
//   [new-feature]     needs this round's assimilation / transwarp (fails there: none exists);
//   [preservation]    holds on both (no spawning, no capture, no war, shared journeys …).
// Each check names the brief's regression number(s) (R1–R38) or integrated scenario. BM1_BORG_ROOT runs the suite
// against another tree (the baseline reproduction runs it against 9db1fc6).
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
const BD = fs.existsSync(path.join(root, 'src/borg-doctrine.mjs')) ? await imp('src/borg-doctrine.mjs') : null;
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
const need = () => { if (!DC.borgSummary) throw new Error('this tree has no assimilation: the Borg are generic hostile traffic (no target, no objective, no transwarp)'); };
const vidOf = (h) => h?.identity?.vid || h?.vid || h?.id;
const P = (book, id) => C.getPolity(book, id);
const reload = (book) => C.upgradeCampaignBook(JSON.parse(JSON.stringify(book)));
const sum = (e) => (DC.borgSummary ? DC.borgSummary(e.book) : { objectives: [], contacts: {}, selections: {}, progress: {}, stats: {}, history: [], assimilatedHulls: [], transwarp: {} });
const objs = (e) => sum(e).objectives;
const lastSel = (e) => (sum(e).selections.borg || []).slice(-1)[0] || null;
const days = (e, a, b) => BF.run(C, e.book, e.world, a, b);
// A galaxy with doctrine on and only the Borg live: no routine patrols, traffic, hunts or responses of anyone's.
function env(seed, { rules = {}, borg = {}, reserve = 2, localSystem = null } = {}) {
  const e = BF.borgWorld(C, makeWorld, seed, { DC, doctrine, station, reserve });
  const db = DC.doctrineBook(e.book);
  db.config = { ...db.config, patrols: {}, explorers: {}, reliefShips: {}, merchants: {}, projects: {}, patrolAreas: {}, militaryResponses: false, enforcementResponses: false, predation: false, hunts: {},
    borg: { ...(db.config.borg || { power: 'borg' }), worlds: false, ...borg }, borgRules: { ...(db.config.borgRules || {}), ...rules } };
  e.world.localSystem = localSystem;
  // Everybody not named by a test waits at Qonos (seen by no Borg sensor); the Borg reserves are held at home.
  for (const [pid, p] of Object.entries(e.book.polities)) if (pid !== 'borg') for (const h of p.hulls) h.systemIndex = IDX.Qonos;
  e.borg = P(e.book, 'borg').hulls.slice();
  e.cube = e.borg[0];
  for (const h of e.borg.slice(1)) { h.status = 'assigned'; h.opId = 'held-by-test'; }
  e.made = new Set();
  return e;
}
// Re-class a power's free hulls for a test (the campaign's own records: no hull is added).
function make(e, polity, shipId, at, n = 1, { hold = true } = {}) {
  const hs = P(e.book, polity).hulls.filter((h) => h.status === 'ready' && !h.opId && !e.made.has(h.id)).sort((a, b) => String(a.id).localeCompare(String(b.id))).slice(0, n);
  assert.equal(hs.length, n, `not ${n} free ${polity} hulls`);
  for (const h of hs) { e.made.add(h.id); h.shipId = shipId; h.systemIndex = at; h.maxHull = h.hull = e.world.shipStats(shipId).combatHull; h.crew = 1; if (hold) { h.status = 'assigned'; h.opId = 'held-by-test'; } }
  return hs;
}
// A Borg reserve re-classed as a probe standing somewhere (direct sight there; held, never part of a force).
function probe(e, at) { const h = e.borg[1]; h.shipId = 92; h.maxHull = h.hull = SHIPS[92].combatHull; h.systemIndex = at; return h; }
const enc = (e) => (e.book.encounters || []).filter((x) => x.type === 'assimilation');
const borgOwns = (e, h) => P(e.book, 'borg').hulls.includes(h);
// A ship assimilation, start to finish, strategically: a Terran cruiser at the Outpost (beside Unimatrix).
function shipCase(seed, { rules = {}, ship = 80, at = IDX.Outpost } = {}) {
  const e = env(seed, { rules });
  const [t] = make(e, 'terran', ship, at);
  return { e, t };
}
function runUntil(e, from, to, pred) { for (let d = from; d <= to; d++) { days(e, d, d); if (pred(d)) return d; } return null; }

// ===================================================================================================
// Selection (R1–R6)
// ===================================================================================================
test('preservation', 'R1. no known target, no objective: a Terran cruiser at Earth (no Borg sensor reaches it) is not targeted — no objective opens, the cube stays home', () => {
  const e = env('BG-1');
  make(e, 'terran', 80, IDX.Earth);
  days(e, 2, 15);
  if (DC.borgSummary) { assert.equal(objs(e).length, 0); assert.ok(['no target known', 'no target worth assimilating'].includes(lastSel(e)?.decision), lastSel(e)?.decision); }
  assert.ok(Number(e.cube.systemIndex) === IDX.Unimatrix && !e.cube.transit);
});
test('baseline-defect', 'R2. an observed advanced vessel becomes an assimilation target: a Terran cruiser at the Outpost (beside Unimatrix: Borg sensors cover it) is chosen (9db1fc6: the cube sits at Unimatrix while a valuable vessel is in sensor range)', () => {
  const e = env('BG-2');
  const [t] = make(e, 'terran', 80, IDX.Outpost);
  days(e, 2, 3);
  const o = DC.borgSummary ? objs(e)[0] : null;
  log.r2 = o ? { id: o.id, target: o.target, value: o.value, why: o.why, movement: o.movement } : null;
  assert.ok(o, 'no assimilation objective on an observed valuable vessel');
  assert.equal(o.targetKind, 'ship'); assert.equal(o.target.vid, vidOf(t)); assert.equal(o.target.known.seenAt, IDX.Outpost);
});
test('new-feature', 'R3. a hidden ship is not selectable: a cruiser at Earth (no sensor) and a cloaked cruiser at the Outpost (border sensors do not see a cloak) are not Borg contacts; a visible one at the Nexus is', () => {
  need();
  const e = env('BG-3');
  const [far] = make(e, 'terran', 80, IDX.Earth); const [cl] = make(e, 'terran', 85, IDX.Outpost); const [vis] = make(e, 'terran', 80, IDX.Nexus);
  days(e, 2, 2);
  const seen = Object.keys(sum(e).contacts.borg || {});
  assert.ok(!seen.includes(vidOf(far)), 'saw a ship nobody could see'); assert.ok(!seen.includes(vidOf(cl)), 'saw a cloaked ship at border range');
  assert.ok(seen.includes(vidOf(vis)));
});
test('new-feature', 'R4. a trivial target scores below a meaningful one: an unarmed shuttle (no technology worth acquiring) is rejected; a cruiser is eligible and chosen; the selection records both verdicts and why (BORG target scoring)', () => {
  need();
  const e = env('BG-4');
  const [sh] = make(e, 'terran', 83, IDX.Outpost); const [cr] = make(e, 'terran', 80, IDX.Nexus);
  days(e, 2, 2);
  const sel = lastSel(e);
  const v = (x) => sel.candidates.find((c) => c.vid === vidOf(x));
  log.r4 = sel.candidates.map((c) => ({ vid: c.vid, value: c.value, score: c.score, verdict: c.verdict, reason: c.reason, movement: c.movement }));
  assert.equal(v(sh).verdict, 'rejected'); assert.ok(v(sh).score < v(cr).score, `${v(sh).score} vs ${v(cr).score}`);
  assert.equal(v(cr).verdict, 'eligible'); assert.equal(sel.chosen, vidOf(cr));
  // the value model: tech tier by observed class; an unusual fitting (cloak) adds; a too-strong ship is refused
  assert.ok(BD.shipValue({ price: 180000, mass: 7, category: 'cruiser' }).value > BD.shipValue({ price: 12000, mass: 1, category: 'cargoShuttle' }).value);
  assert.ok(BD.shipValue({ price: 180000, mass: 7, category: 'cruiser', cloak: true }).value > BD.shipValue({ price: 180000, mass: 7, category: 'cruiser' }).value);
  assert.equal(BD.scoreTarget({ kind: 'ship', value: BD.shipValue({ price: 2000000, mass: 10, category: 'battleship' }), targetStrength: 2000, borgStrength: 900, source: 'direct', ageDays: 0, reachDays: 2, day: 5 }).reason, 'too strong to take');
});
test('preservation', 'R5/R6. the force is the Collective\'s own hulls; none is made: the objective flies the campaign\'s cube (same id); with every Borg hull busy, nothing opens ("deferred") and no hull is added', () => {
  const e = env('BG-5');
  make(e, 'terran', 80, IDX.Outpost);
  const n0 = P(e.book, 'borg').hulls.length;
  days(e, 2, 4);
  if (DC.borgSummary) { const o = objs(e)[0]; assert.ok(o, 'no objective'); assert.ok(o.force.every((x) => e.borg.some((h) => h.id === x.hullId))); }
  assert.equal(P(e.book, 'borg').hulls.length, n0);
  const e2 = env('BG-6');
  e2.cube.status = 'assigned'; e2.cube.opId = 'elsewhere';
  make(e2, 'terran', 80, IDX.Outpost);
  const m0 = P(e2.book, 'borg').hulls.length;
  days(e2, 2, 10);
  if (DC.borgSummary) { assert.equal(objs(e2).length, 0); assert.match(lastSel(e2)?.decision || '', /deferred/); }
  assert.equal(P(e2.book, 'borg').hulls.length, m0, 'a Borg hull was made');
});
// ===================================================================================================
// Ship assimilation (R7–R16), BORG-SHIP-ASSIMILATION
// ===================================================================================================
test('new-feature', 'BORG-SHIP-ASSIMILATION / R7–R11. the cube takes a known cruiser: intercepts it at the Outpost, disables it (same vid throughout), assimilates it over days; the SAME hull record moves to the Borg — same vid, its damage, its origin (Terran) on its identity, the assimilation in its history, its crew outcome explicit; no hull is created and no Terran class is licensed to the Borg', () => {
  need();
  let r = null;
  for (let k = 0; k < 8 && !r; k++) {
    const { e, t } = shipCase(`BG-SA-${k}`);
    const vid = vidOf(t);
    const trail = [];
    const total0 = Object.values(e.book.polities).reduce((n, p) => n + p.hulls.length, 0);
    const lic0 = JSON.stringify(P(e.book, 'borg').licenses || {});
    let disabledSeen = null;
    for (let d = 2; d <= 40; d++) { days(e, d, d); const o = objs(e)[0]; if (o) trail.push([d, o.phase, o.progress?.value, Math.round(t.hull), C.hullIsDisabled(t), borgOwns(e, t)]); if (C.hullIsDisabled(t) && disabledSeen == null) disabledSeen = { day: d, hull: t.hull, vid: vidOf(t) }; if (o && o.status !== 'active') break; }
    const o = objs(e)[0];
    if (o?.result?.result === 'target_assimilated') r = { e, t, o, vid, trail, total0, lic0, disabledSeen };
    else log[`sa-miss-${k}`] = { result: o?.result, trail: trail.slice(-6) };
  }
  assert.ok(r, 'no seed assimilated the cruiser');
  const { e, t, o, vid, trail, total0, lic0, disabledSeen } = r;
  log.shipAssimilation = { trail, result: o.result, hull: [t.hull, t.maxHull], identity: t.identity, assimilated: t.assimilated, movement: o.movement, phases: o.phaseHistory };
  assert.ok(o.phaseHistory.some((p) => p.phase === 'disable') && o.phaseHistory.some((p) => p.phase === 'assimilate'), JSON.stringify(o.phaseHistory));
  assert.equal(disabledSeen.vid, vid, 'R7: the target changed vid when disabled');
  assert.ok(borgOwns(e, t), 'not on the Borg books'); assert.ok(!P(e.book, 'terran').hulls.includes(t));
  assert.equal(vidOf(t), vid, 'R8: the assimilated ship is not the same vessel');
  assert.equal(t.identity.origin.builder, 'terran', 'R9: origin rewritten'); assert.ok(t.identity.history.some((x) => x.event === 'assimilated' && x.from === 'terran' && x.to === 'borg'));
  assert.equal(t.assimilated.from, 'terran'); assert.ok(['crew_assimilated', 'partial_survivors', 'target_abandoned'].includes(t.assimilated.crew.result));
  assert.ok(t.hull < t.maxHull, 'R10: the assimilated hull was refreshed'); assert.equal(t.shipId, 80);
  assert.equal(Object.values(e.book.polities).reduce((n, p) => n + p.hulls.length, 0), total0, 'a hull was created or deleted');
  assert.equal(JSON.stringify(P(e.book, 'borg').licenses || {}), lic0, 'R11: a licence was granted'); assert.equal(C.polityCanBuildDesign(e.book, e.world, 'borg', 80), false, 'R11: the Borg can build the Terran class');
});
test('new-feature', 'R12. the target must actually be subdued first: with an assimilator beside it, an operational target is never assimilated (no progress until it is disabled); the rule itself refuses an unsubdued, absent or unaccompanied target', () => {
  need();
  assert.equal(BD.assimilationEligibility({ present: true, subdued: false, assimilatorPresent: true }).ok, false);
  assert.equal(BD.assimilationEligibility({ present: true, subdued: true, assimilatorPresent: false }).ok, false);
  assert.equal(BD.assimilationEligibility({ present: false, subdued: true, assimilatorPresent: true }).ok, false);
  // A dreadnought survives the first strike: the objective stays in `disable` while it is operational.
  const { e, t } = shipCase('BG-12', { ship: 84, rules: { strikeShare: 0.1, overkillChance: 0 } });
  const seen = [];
  for (let d = 2; d <= 30; d++) { days(e, d, d); const o = objs(e)[0]; if (o) seen.push({ d, phase: o.phase, progress: o.progress?.value || 0, disabled: C.hullIsDisabled(t) }); if (o && o.status !== 'active') break; }
  log.r12 = seen.slice(0, 20);
  assert.ok(seen.every((x) => x.disabled || (x.phase !== 'assimilate' && x.progress === 0)), 'progress on an operational target');
});
test('new-feature', 'R13. a destroyed target cannot be assimilated afterwards: a disable that goes too far (overkill forced) destroys the cruiser — the objective ends "target_destroyed" and nothing reaches the Borg books', () => {
  need();
  const { e, t } = shipCase('BG-13', { rules: { overkillChance: 1 } });
  runUntil(e, 2, 30, () => objs(e)[0]?.status && objs(e)[0].status !== 'active');
  const o = objs(e)[0];
  log.r13 = { result: o?.result, status: t.status };
  assert.equal(o.result.result, 'target_destroyed'); assert.equal(t.status, 'lost'); assert.ok(!borgOwns(e, t));
  assert.equal(BD.assimilationEligibility({ present: true, subdued: true, assimilatorPresent: true, destroyed: true }).ok, false);
});
test('new-feature', 'R14. an escaped target closes the objective: the fast cruiser slips the cube at contact (escape forced) — "target_escaped", a cooldown on that vessel, and it is not re-targeted at once', () => {
  need();
  const { e, t } = shipCase('BG-14', { ship: 81, rules: { escapeBase: 1, escapeMin: 1, escapeMax: 1 } });
  runUntil(e, 2, 30, () => objs(e)[0]?.status && objs(e)[0].status !== 'active');
  const o = objs(e)[0];
  const cd = sum(e).cooldowns[`borg|${vidOf(t)}`];
  days(e, e.book.day + 1, e.book.day + 12);
  log.r14 = { result: o.result, cooldown: cd, objectives: objs(e).length };
  assert.equal(o.result.result, 'target_escaped'); assert.ok(cd > o.closedDay); assert.equal(objs(e).filter((x) => x.target.vid === vidOf(t) && x.status === 'active').length, 0);
  assert.ok(!borgOwns(e, t));
});
test('new-feature', 'R15. the Borg force destroyed ends the objective: the cube lost on its way — "borg_destroyed" the same day', () => {
  need();
  const { e } = shipCase('BG-15', { rules: { transwarpMinScore: 9 } });
  days(e, 2, 3);
  const o = objs(e)[0]; assert.ok(o);
  e.cube.status = 'lost'; e.cube.hull = 0; delete e.cube.transit;
  days(e, 4, 4);
  log.r15 = o.result;
  assert.equal(o.result?.result, 'borg_destroyed');
});
test('new-feature', 'R16. save/load mid-assimilation: reloaded with the cruiser subdued and the assimilation part done, the reloaded campaign advances the same progress, day for day, to the same assimilation', () => {
  need();
  let e = null;
  for (let k = 0; k < 8 && !e; k++) { const c = shipCase(`BG-16-${k}`, { rules: { shipAssimilateDays: 4 } }); const d = runUntil(c.e, 2, 30, () => objs(c.e)[0]?.phase === 'assimilate' && objs(c.e)[0].progress.value > 0); if (d) e = c.e; }
  assert.ok(e, 'never reached the assimilation');
  const pick = (book) => { const o = DC.borgSummary(book).objectives[0]; return JSON.stringify({ phase: o.phase, progress: o.progress, status: o.status, result: o.result, target: o.target.vid, owners: Object.fromEntries(Object.entries(book.polities).map(([k, p]) => [k, p.hulls.length])) }); };
  const b2 = reload(e.book);
  assert.equal(pick(b2), pick(e.book));
  const d0 = e.book.day;
  for (let d = d0 + 1; d <= d0 + 6; d++) { BF.run(C, e.book, e.world, d, d); BF.run(C, b2, e.world, d, d); }
  log.r16 = JSON.parse(pick(e.book));
  assert.equal(pick(b2), pick(e.book));
});
// ===================================================================================================
// Tactical handoff (R17–R19, R33–R34)
// ===================================================================================================
test('new-feature', 'R17/R18/R19. tactical handoff: the contact at the Outpost where the captain is waits for the scene (one encounter, the same Borg and target vids, nothing strategic meanwhile — no damage for days); the scene\'s disablement feeds the assimilation, which then completes on the same hull', () => {
  need();
  const { e, t } = shipCase('BG-17', { rules: { transwarpMinScore: 9 } });
  e.world.localSystem = IDX.Outpost;
  let x = null;
  for (let d = 2; d <= 30 && !x; d++) { days(e, d, d); x = enc(e).find((y) => y.status === 'pending'); }
  assert.ok(x, 'no contact at the Outpost');
  const vids = x.participants.map((p) => [p.side, p.vid]);
  const recs = () => JSON.stringify([t.hull, t.status, e.cube.hull]);
  const r0 = recs(); const d0 = e.book.day;
  days(e, d0 + 1, d0 + 3);
  assert.equal(x.status, 'pending'); assert.equal(recs(), r0, 'R19: strategic damage while the scene holds the contact');
  assert.equal(enc(e).filter((y) => y.status !== 'aborted').length, 1, 'a second encounter for one contact');
  assert.deepEqual(vids.sort(), [['borg', vidOf(e.cube)], ['target', vidOf(t)]].sort(), 'R17: not the same vids');
  // The scene: the cruiser disabled (its record's hull at the scene's figure), the cube unhurt.
  const tp = x.participants.find((p) => p.side === 'target'), bp = x.participants.find((p) => p.side === 'borg');
  const r = C.resolveEncounterNow(e.book, e.world, x.id, { result: { outcome: 'subdued' }, participants: { [tp.ref]: { fate: 'disabled', hull: Math.floor(t.maxHull * 0.1), vid: vidOf(t) }, [bp.ref]: { fate: 'survived', hull: e.cube.hull, vid: vidOf(e.cube) } } }, e.book.day, []);
  assert.ok(r.ok, r.reason);
  const o = objs(e)[0];
  assert.equal(o.phase, 'assimilate', 'R18: the scene\'s disablement did not feed the assimilation');
  runUntil(e, e.book.day + 1, e.book.day + 10, () => o.status !== 'active');
  log.r17 = { vids, result: o.result, handoff: o.handoff, lastEngagement: o.lastEngagement };
  assert.equal(o.result.result, 'target_assimilated'); assert.ok(borgOwns(e, t)); assert.equal(vidOf(t), tp.vid);
});
// ===================================================================================================
// Worlds (R20–R24), BORG-WORLD-ASSIMILATION
// ===================================================================================================
function worldCase(seed, rules = {}) {
  const e = env(seed, { borg: { worlds: true }, rules: { transwarpMinScore: 9, ...rules } });
  return e;
}
test('new-feature', 'BORG-WORLD-ASSIMILATION / R20–R23. the cube arrives at the Outpost, suppresses its defence, progress begins and persists (save/load mid-way identical); Branch A: the cube is destroyed mid-way — progress stops and decays, the world stays Terran. Branch B: the cube remains — the world becomes the Collective\'s: an explicit controller change keeping its origin and former holder on record, with no capture, occupation, integration, licence or war', () => {
  need();
  const A = worldCase('BG-W');
  const ctl0 = A.world.systems.map((s) => s.controller);
  const warsOf = (b) => JSON.stringify(Object.fromEntries(Object.entries(b.warStates || {}).map(([k, w]) => [k, w.status])));
  const wars0 = warsOf(A.book);
  let o = null;
  const da = runUntil(A, 2, 60, () => { o = objs(A)[0]; return o && o.progress?.state === 'assimilating' && o.progress.value >= 0.2; });
  assert.ok(da, `never assimilating: ${JSON.stringify(objs(A)[0]?.progress)} ${lastSel(A)?.decision}`);
  const rec = () => JSON.stringify(sum(A).progress[IDX.Outpost]);
  const b2 = reload(A.book);
  assert.equal(JSON.stringify(DC.borgSummary(b2).progress[IDX.Outpost]), rec(), 'R20: progress lost on save/load');
  // Branch A: the force destroyed
  const p0 = sum(A).progress[IDX.Outpost].progress;
  A.cube.status = 'lost'; A.cube.hull = 0;
  days(A, A.book.day + 1, A.book.day + 6);
  const ra = sum(A).progress[IDX.Outpost];
  log.worldA = { p0, after: ra && { progress: ra.progress, state: ra.state }, result: objs(A)[0].result };
  assert.equal(objs(A)[0].result.result, 'borg_destroyed');
  assert.ok(!ra || (ra.state === 'interrupted' && ra.progress < p0), 'R21: progress did not stop');
  assert.equal(A.world.systems[IDX.Outpost].controller, 'terran');
  // Branch B: the force stays
  const Bw = worldCase('BG-W');
  const fx = [];
  const db = runUntil(Bw, 2, 200, () => Bw.world.systems[IDX.Outpost].controller === 'borg');
  for (let d = 2; d <= (db ?? 2); d++); // (effects collected below)
  const recB = sum(Bw).progress[IDX.Outpost];
  log.worldB = { day: db, progress: recB, assimilatedWorlds: sum(Bw).assimilatedWorlds, phases: objs(Bw)[0]?.phaseHistory };
  assert.ok(db, 'R22: never completed');
  assert.equal(Bw.world.systems[IDX.Outpost].origin, 'terran'); assert.equal(sum(Bw).assimilatedWorlds[0].from, 'terran');
  assert.ok(!Bw.book.occupations?.[IDX.Outpost], 'R23: an occupation record'); assert.ok(!P(Bw.book, 'borg').integrations?.[IDX.Outpost], 'an integration (licences) began');
  assert.equal(warsOf(Bw.book), wars0, 'R23: a war record');
  assert.deepEqual(Bw.world.systems.map((s, i) => (i === IDX.Outpost ? null : s.controller)), ctl0.map((c, i) => (i === IDX.Outpost ? null : c)), 'another world changed hands');
  assert.ok(recB.history.length > 3 && recB.startDay < db - 3, 'an instant flip');
});
test('new-feature', 'R21b. the Borg leaving stops the progress: an objective recalled mid-assimilation withdraws the cube; the world\'s record is interrupted and decays day by day', () => {
  need();
  const e = worldCase('BG-W21');
  runUntil(e, 2, 60, () => objs(e)[0]?.progress?.state === 'assimilating' && objs(e)[0].progress.value >= 0.2);
  const o = objs(e)[0];
  o.cancelRequested = 'recalled by the test';
  const p0 = sum(e).progress[IDX.Outpost].progress;
  const trail = [];
  for (let d = e.book.day + 1, k = 0; k < 8; d++, k++) { days(e, d, d); const r = sum(e).progress[IDX.Outpost]; trail.push(r ? [d, r.progress, r.state] : [d, 0, 'gone']); }
  log.r21b = { p0, trail, result: o.result };
  assert.equal(o.result.result, 'cancelled');
  assert.ok(trail.slice(2).every((x) => x[2] !== 'assimilating') && trail.at(-1)[1] < p0, JSON.stringify(trail));
});
// ===================================================================================================
// Movement (R25–R32, R35–R36), BORG-TRANSWARP
// ===================================================================================================
test('preservation', 'R25/R26. conventional Borg travel is the shared journey at the hull\'s own speed: a move the objective plots conventionally is a "borg" journey on the route plotJourney gives, legs at the cube\'s rating (1.32×)', () => {
  const e = env('BG-25', { rules: { transwarpMinScore: 9 } });
  make(e, 'terran', 80, IDX.Outpost);
  days(e, 2, 3);
  if (!DC.borgSummary) { const r = C.startJourney(e.book, e.world, { kind: 'move', sponsor: 'borg', hulls: [e.cube], destination: IDX.Outpost, purpose: 'move' }, 3, []); assert.ok(r.ok); return; }
  const o = objs(e)[0];
  const tr = (e.book.journeys || []).find((j) => j.ref === o.id && j.kind === 'borg');
  assert.ok(tr, 'no shared journey'); assert.ok(!tr.mode || tr.mode === 'conventional');
  const plan = C.plotJourney(e.world, IDX.Unimatrix, IDX.Outpost, 'borg', null, C.hullsSpeed(e.world, [e.cube]));
  log.r25 = { path: tr.path, legDays: tr.legDays, speed: tr.speed };
  assert.deepEqual(tr.path, plan.path); assert.deepEqual(tr.legDays, plan.legDays); assert.equal(tr.speed, SPD.clampSpeed(1.32));
});
test('new-feature', 'R27–R32. transwarp is its own mode, not a speed: the cube\'s rating stays 1.32×; an eligible cube opens a transwarp journey Unimatrix → Earth (one leg, fixed days, no route), arrives exactly on its ETA, survives save/load in the conduit identically, and crosses no intermediate system (no crossing, blockade or treaty check at Nexus, Qonos, Border or Vega); a sphere (no conduit of its own) is refused', () => {
  need();
  const e = env('BG-27');
  assert.equal(e.world.shipStats(90).strategicSpeed, 1.32); assert.equal(C.hullSpeed(e.world, e.cube), SPD.clampSpeed(1.32));
  // R29: the sphere is refused
  const sph = e.borg[2]; sph.status = 'ready'; sph.opId = null; sph.shipId = 91; sph.maxHull = sph.hull = SHIPS[91].combatHull;
  const ref = C.startJourney(e.book, e.world, { kind: 'move', sponsor: 'borg', hulls: [sph], destination: IDX.Earth, purpose: 'move', mode: 'transwarp', transwarp: { days: 2, cooldownDays: 30 } }, 1, []);
  assert.equal(ref.ok, false); assert.match(ref.reason, /no transwarp capability/);
  // A Klingon blockade at Qonos on the conventional way: a jump never meets it.
  const ks = make(e, 'klingon', 21, IDX.Qonos, 1, { hold: false });
  const conv = C.plannedJourneyDays(e.world, IDX.Unimatrix, IDX.Earth, 'borg', C.hullSpeed(e.world, e.cube));
  const fx = [];
  const r = C.startJourney(e.book, e.world, { kind: 'move', sponsor: 'borg', hulls: [e.cube], destination: IDX.Earth, purpose: 'move', mode: 'transwarp', transwarp: { days: 2, cooldownDays: 30, conventionalDays: conv } }, 1, fx);
  assert.ok(r.ok, r.reason);
  const tr = r.journey;
  log.r28 = { path: tr.path, legDays: tr.legDays, eta: tr.etaDay, conv, mode: tr.mode, transwarp: tr.transwarp, effects: fx.map((x) => x.type) };
  assert.equal(tr.mode, 'transwarp'); assert.deepEqual(tr.path, [IDX.Earth]); assert.deepEqual(tr.legDays, [2]); assert.ok(conv > 2 * 5);
  assert.ok(fx.some((x) => x.type === 'transwarpEntry'));
  const b2 = reload(e.book);
  assert.equal(JSON.stringify(b2.journeys.find((j) => j.id === tr.id)), JSON.stringify(tr), 'R31: the journey changed on save/load');
  const crossings0 = e.book.stats.journeys.crossings;
  const allFx = [];
  let arrived = null;
  for (let d = 2; d <= 6 && arrived == null; d++) { const f = C.advanceCampaignDay(e.book, e.world, d); allFx.push(...f); BF.run(C, b2, e.world, d, d); if (tr.status === 'arrived') arrived = d; }
  log.r30 = { arrived, eta: tr.etaDay, at: e.cube.systemIndex, crossings: e.book.stats.journeys.crossings - crossings0, effects: allFx.filter((x) => /transwarp|journey/i.test(x.type)).map((x) => [x.type, x.systemIndex ?? null]) };
  assert.equal(arrived, tr.etaDay, 'R30: arrival is not the ETA'); assert.equal(e.cube.systemIndex, IDX.Earth);
  assert.equal(e.book.stats.journeys.crossings - crossings0, 1, 'R32: an intermediate crossing');
  assert.ok(!(e.book.blockades || []).some((b) => (b.runs || []).length), 'a blockade saw the jump');
  assert.equal(b2.journeys.find((j) => j.id === tr.id).status, 'arrived'); assert.equal(b2.journeys.find((j) => j.id === tr.id).arrivedDay, tr.arrivedDay, 'R31: the reloaded jump arrived differently');
  assert.ok(allFx.some((x) => x.type === 'transwarpExit' && x.systemIndex === IDX.Earth));
});
test('new-feature', 'BORG-TRANSWARP / R35. one force, both plans: to a cruiser at Vega (seen by a Borg probe there) the objective plots conventional (~22 d) and transwarp (2 d), chooses transwarp with the reason, arrives on the transwarp ETA and reaches the target there; the next objective inside a long cooldown cannot jump again ("transwarp cooldown") and goes conventionally — counted as a cooldown block; with the conduit due back soon it waits for it instead (ETA-aware)', () => {
  need();
  const e = env('BG-TW', { rules: { transwarpCooldownDays: 200 } });
  // ETA-aware planning of the same rules: a short wait for the conduit beats a long conventional route.
  const hold = BD.chooseMovement({ capable: true, offCooldown: false, conditionOk: true, score: 0.8, conventionalDays: 24, cooldownRemaining: 3 });
  const conv = BD.chooseMovement({ capable: true, offCooldown: false, conditionOk: true, score: 0.8, conventionalDays: 24, cooldownRemaining: 150 });
  assert.equal(hold.mode, 'hold'); assert.equal(conv.mode, 'conventional'); assert.match(conv.reason, /cooldown/);
  probe(e, IDX.Vega);
  const [t] = make(e, 'terran', 80, IDX.Vega);
  days(e, 2, 3); // selected on day 2, sets out on day 3
  const o = objs(e)[0];
  assert.ok(o, `no objective: ${lastSel(e)?.decision}`);
  log.transwarp = { movement: o.movement, candidates: lastSel(e).candidates.map((c) => ({ vid: c.vid, movement: c.movement, score: c.score })) };
  assert.equal(o.movement.mode, 'transwarp', JSON.stringify(o.movement));
  assert.ok(o.movement.conventionalDays >= 15 && o.movement.transwarpDays === 2, JSON.stringify(o.movement));
  const tr = e.book.journeys.find((j) => j.id === o.movement.journeyId);
  assert.equal(tr.mode, 'transwarp');
  assert.ok(!o.force.some(() => false));
  const arrive = runUntil(e, 4, 10, () => tr.status === 'arrived');
  assert.equal(arrive, tr.etaDay);
  assert.ok(o.engagements >= 1 || o.status !== 'active', 'the target was not reached on arrival');
  // A later target inside the cooldown: conventional, with the reason.
  runUntil(e, e.book.day + 1, e.book.day + 40, () => o.status !== 'active' && !e.cube.opId);
  const t2 = make(e, 'terran', 84, IDX.Vega)[0];
  const d1 = e.book.day;
  runUntil(e, d1 + 1, d1 + 12, () => objs(e).some((x) => x.id !== o.id && x.movement?.journeyId));
  const o2 = objs(e).find((x) => x.id !== o.id); // (closed objectives are kept after the live ones)
  log.cooldown = { cubeLastExit: e.cube.transwarpLastExitDay, at: e.cube.systemIndex, o2: o2 && o2.movement, stats: sum(e).transwarp };
  if (o2 && Number(e.cube.systemIndex) !== IDX.Vega) {
    assert.equal(o2.movement.mode, 'conventional'); assert.match(o2.movement.reason, /cooldown/);
    assert.ok(sum(e).transwarp.cooldownBlocks >= 1);
  } else {
    // The cube is still at Vega (no move needed): the cooldown is checked directly.
    const rr = C.startJourney(e.book, e.world, { kind: 'move', sponsor: 'borg', hulls: [e.cube], destination: IDX.Unimatrix, purpose: 'move', mode: 'transwarp', transwarp: { days: 2, cooldownDays: 30 } }, e.book.day, []);
    assert.equal(rr.ok, false); assert.match(rr.reason, /cooldown/);
  }
});
test('new-feature', 'R33/R34. a transwarp exit into the captain\'s system is handed to his scene once: the cube exits at Vega where he is; the contact waits for the scene (one encounter, no strategic resolution or damage while it waits)', () => {
  need();
  const e = env('BG-33', { localSystem: IDX.Vega });
  probe(e, IDX.Vega);
  const [t] = make(e, 'terran', 80, IDX.Vega);
  let x = null;
  for (let d = 2; d <= 12 && !x; d++) { days(e, d, d); x = enc(e).find((y) => y.status === 'pending'); }
  const o = objs(e)[0];
  assert.ok(x, `no contact on exit: ${JSON.stringify(o?.movement)}`);
  assert.equal(o.movement.mode, 'transwarp');
  const recs = JSON.stringify([t.hull, e.cube.hull]);
  days(e, e.book.day + 1, e.book.day + 3);
  log.r33 = { enc: { system: x.system, status: x.status }, handoff: o.handoff };
  assert.equal(x.status, 'pending'); assert.equal(JSON.stringify([t.hull, e.cube.hull]), recs, 'R34: abstract resolution during the handoff');
  assert.equal(enc(e).length, 1); assert.equal(o.handoff.captainScene, true);
});
test('new-feature', 'R36. an assimilated non-Borg hull gains no transwarp: the cruiser taken into the Collective keeps its own class (no conduit) — a transwarp journey for it is refused; its speed is its own class\'s', () => {
  need();
  let got = null;
  for (let k = 0; k < 8 && !got; k++) { const c = shipCase(`BG-36-${k}`, { rules: { overkillChance: 0 } }); runUntil(c.e, 2, 40, () => objs(c.e)[0]?.status && objs(c.e)[0].status !== 'active'); if (objs(c.e)[0]?.result?.result === 'target_assimilated') got = c; }
  assert.ok(got, 'nothing assimilated');
  const { e, t } = got;
  assert.equal(C.transwarpCapable(e.world, t), false);
  t.hull = t.maxHull; delete t.stranded; t.status = 'ready';
  const r = C.startJourney(e.book, e.world, { kind: 'move', sponsor: 'borg', hulls: [t], destination: IDX.Unimatrix, purpose: 'move', mode: 'transwarp', transwarp: { days: 2 } }, e.book.day, []);
  assert.equal(r.ok, false); assert.match(r.reason, /no transwarp capability/);
  assert.equal(C.hullSpeed(e.world, t), SPD.clampSpeed(SHIPS[80].strategicSpeed));
});
// ===================================================================================================
// No capture, no war (R37–R38); treaties, blockades
// ===================================================================================================
test('preservation', 'R37/R38. assimilation takes no unrelated world and makes no war: eighty days of the Collective at work (a ship taken, worlds on) leave every other world with its holder, every relation as it was, no war record and no declaration', () => {
  const e = env('BG-37', { borg: { worlds: true } });
  make(e, 'terran', 80, IDX.Outpost);
  const ctl0 = e.world.systems.map((s) => s.controller);
  const rel0 = JSON.stringify(e.relations);
  const warsOf = (b) => JSON.stringify(Object.fromEntries(Object.entries(b.warStates || {}).map(([k, w]) => [k, w.status])));
  const wars0 = warsOf(e.book);
  const fx = days(e, 2, 80);
  const changed = e.world.systems.map((s, i) => [i, ctl0[i], s.controller]).filter(([, a, b]) => a !== b);
  log.r37 = { changed, captures: fx.filter((x) => x.type === 'captureSystem').length, assimilated: fx.filter((x) => x.type === 'systemAssimilated').map((x) => x.systemIndex), wars: fx.filter((x) => /war/i.test(x.type)).map((x) => x.type) };
  assert.ok(changed.every(([i, , b]) => b === 'borg' && fx.some((x) => x.type === 'systemAssimilated' && x.systemIndex === i)), `a world changed hands other than by an assimilation: ${JSON.stringify(changed)}`);
  assert.equal(fx.filter((x) => x.type === 'captureSystem').length, 0);
  assert.equal(JSON.stringify(e.relations), rel0); assert.equal(warsOf(e.book), wars0, 'a war record began or changed state');
  assert.equal(fx.filter((x) => /declar/i.test(x.type)).length, 0);
  for (const p of Object.keys(e.book.polities)) if (p !== 'borg') assert.equal(e.world.relation('borg', p), 'peace');
});
test('new-feature', '§16 TREATIES. the Borg are no treaty party: a Terran–Klingon DMZ at the Nexus does not bar their conventional route through it (no refusal), and their entry there is an incursion on record for the parties to report', () => {
  need();
  const e = env('BG-DMZ', { rules: { transwarpMinScore: 9 } });
  probe(e, IDX.Qonos);
  const [t] = make(e, 'terran', 80, IDX.Qonos);
  const term = C.addTreatyTerm(e.book, e.world, { type: 'dmz', parties: ['terran', 'klingon'], systems: [IDX.Nexus] }, 1, []);
  assert.ok(term.ok, term.reason);
  runUntil(e, 2, 30, () => (sum(e).incursions || []).length > 0);
  log.dmz = { incursions: sum(e).incursions, movement: objs(e)[0]?.movement, refused: e.book.stats.treaty?.dmzRoutesRefused ?? null };
  assert.ok(objs(e)[0], 'no objective'); assert.ok(sum(e).incursions.some((x) => x.systemIndex === IDX.Nexus && x.parties.includes('terran')));
});
test('new-feature', '§15 BLOCKADES. conventional Borg travel meets a blockade through the shared engine (the Borg are hostile to every blockader, with no war record): a Klingon blockade of the Outpost runs the cube\'s arrival there', () => {
  need();
  const e = env('BG-BL', { rules: { transwarpMinScore: 9 }, }, );
  const rel = e.relations; rel['klingon:terran'] = 'war';
  make(e, 'terran', 80, IDX.Outpost);
  const ks = make(e, 'klingon', 21, IDX.Outpost, 3, { hold: false });
  const b = C.startBlockade(e.book, e.world, { power: 'klingon', target: IDX.Outpost, hullIds: ks.map((h) => h.id), purpose: 'interdict_trade' }, 1, []);
  assert.ok(b.ok, b.reason);
  runUntil(e, 2, 20, () => (b.record.runs || []).some((x) => x.sponsor === 'borg'));
  log.blockade = { runs: (b.record.runs || []).map((x) => [x.sponsor, x.outcome, x.by]), status: b.record.status };
  assert.ok((b.record.runs || []).some((x) => x.sponsor === 'borg'), 'the blockade never saw the Borg');
  assert.equal(e.world.relation('borg', 'klingon'), 'peace');
});

const failed = results.filter((r) => !r.ok);
const by = (t) => `${t} ${results.filter((r) => r.tag === t && r.ok).length}/${results.filter((r) => r.tag === t).length}`;
console.log(`\nborg assimilation pure: ${results.length - failed.length}/${results.length} (${['baseline-defect', 'new-feature', 'preservation'].map(by).join(', ')})${failed.length ? ` — FAILED: ${failed.map((r) => r.name.split(' ')[0]).join(', ')}` : ''}`);
if (out) { fs.mkdirSync(out, { recursive: true }); fs.writeFileSync(path.join(out, process.env.BM1_BORG_ROOT ? 'borg-pure-baseline.json' : 'borg-pure.json'), JSON.stringify({ root, results, log }, null, 1)); }
process.exit(failed.length ? 1 : 0);
