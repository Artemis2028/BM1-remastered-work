// Pure regressions for CAPTAIN-BORG-ASSIMILATION (docs/doctrine/CAPTAIN-BORG-ASSIMILATION.md): the captain's
// personal vessel as Borg prey — selected only when seen and worth it, pursued by the same Borg objective and
// movement, contacted in his own scene, assimilated only in that scene, and the run ends. The Borg fixture galaxy
// (borg-fixture.mjs) and the real doctrine data; the captain is the world's live `captain` view, as the engine
// gives it. Tags:
//   [baseline-defect] 1eceab3 never selects the captain (fails there on its own assertion);
//   [new-feature]     needs this round's captain target;
//   [preservation]    holds on both (vessel and world assimilation, transwarp, no war, no hull made).
// Each check names the brief's regression number(s) (C1–C25) or the integrated scenario. BM1_BORG_ROOT runs the
// suite against another tree (the baseline reproduction runs it against 1eceab3).
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
const SE = await imp('src/strategic-encounter.mjs');
const BD = await imp('src/borg-doctrine.mjs');
const { makeWorld, station } = await import(pathToFileURL(path.join(root, 'scripts/campaign-world-fixture.mjs')).href);
const BF = await import(pathToFileURL(path.join(here, 'borg-fixture.mjs')).href);
const doctrine = BF.loadDoctrine(D, root);
const out = process.env.BM1_TEST_OUTPUT || null;
const { IDX } = BF;

const results = [];
const log = {};
const test = (tag, name, fn) => {
  try { fn(); results.push({ tag, name, ok: true }); console.log('PASS', `[${tag}]`, name); }
  catch (e) { results.push({ tag, name, ok: false, error: String(e?.message || e).split('\n')[0] }); console.log('FAIL', `[${tag}]`, name, '\n      ', String(e?.stack || e).split('\n').slice(0, 7).join('\n       ')); }
};
const HAS = typeof DC.captainAssimilationTick === 'function';
const need = () => { if (!HAS) throw new Error('this tree has no captain target: the Borg never select the captain'); };
const vidOf = (h) => h?.identity?.vid || h?.vid || h?.id;
const P = (book, id) => C.getPolity(book, id);
const reload = (book) => C.upgradeCampaignBook(JSON.parse(JSON.stringify(book)));
const sum = (e) => DC.borgSummary(e.book);
const objs = (e) => sum(e).objectives;
const capObj = (e) => objs(e).find((o) => o.targetKind === 'captain') || null;
const lastSel = (e) => (sum(e).selections.borg || []).slice(-1)[0] || null;
const days = (e, a, b) => BF.run(C, e.book, e.world, a, b, (x) => (e.fx ||= []).push(x));
const CAPTAIN_VID = 'vsl:captain-test:personal';
// A galaxy with doctrine on and only the Borg live (as borg-test.mjs).
function env(seed, { rules = {}, borg = {}, reserve = 2 } = {}) {
  const e = BF.borgWorld(C, makeWorld, seed, { DC, doctrine, station, reserve });
  const db = DC.doctrineBook(e.book);
  db.config = { ...db.config, patrols: {}, explorers: {}, reliefShips: {}, merchants: {}, projects: {}, patrolAreas: {}, militaryResponses: false, enforcementResponses: false, predation: false, hunts: {},
    borg: { ...(db.config.borg || { power: 'borg' }), worlds: false, ...borg }, borgRules: { ...(db.config.borgRules || {}), ...rules } };
  e.world.localSystem = null;
  for (const [pid, p] of Object.entries(e.book.polities)) if (pid !== 'borg') for (const h of p.hulls) h.systemIndex = IDX.Qonos;
  e.borg = P(e.book, 'borg').hulls.slice();
  e.cube = e.borg[0];
  for (const h of e.borg.slice(1)) { h.status = 'assigned'; h.opId = 'held-by-test'; }
  e.made = new Set();
  return e;
}
// The captain where the engine would show him: standing in `at` (his scene is there), his class, his hull.
function captain(e, at, shipId = 80, extra = {}) {
  e.world.captain = { systemIndex: at, moving: false, docked: false, disabled: false, vid: CAPTAIN_VID, cls: 'military', shipId, hullFrac: 1, speed: 1, cloaked: false, escorts: [], heading: null, ...extra };
  e.world.localSystem = at;
  return e.world.captain;
}
function make(e, polity, shipId, at, n = 1) {
  const hs = P(e.book, polity).hulls.filter((h) => h.status === 'ready' && !h.opId && !e.made.has(h.id)).sort((a, b) => String(a.id).localeCompare(String(b.id))).slice(0, n);
  assert.equal(hs.length, n, `not ${n} free ${polity} hulls`);
  for (const h of hs) { e.made.add(h.id); h.shipId = shipId; h.systemIndex = at; h.maxHull = h.hull = e.world.shipStats(shipId).combatHull; h.crew = 1; h.status = 'assigned'; h.opId = 'held-by-test'; }
  return hs;
}
function probe(e, at) { const h = e.borg[1]; h.shipId = 92; h.maxHull = h.hull = BF.SHIPS[92].combatHull; h.systemIndex = at; return h; }
const encs = (e) => (e.book.encounters || []).filter((x) => x.type === 'assimilation');
const capEnc = (e) => encs(e).filter((x) => x.contact?.targetKind === 'captain');
function runUntil(e, from, to, pred) { for (let d = from; d <= to; d++) { days(e, d, d); if (pred(d)) return d; } return null; }
// The scene, as the engine reports it: every Borg participant's fate and hull.
function borgReport(enc, fate = 'survived', hullOf = null) {
  const participants = {};
  for (const p of enc.participants.filter((x) => x.side === 'borg')) participants[p.ref] = { fate, hull: hullOf ? hullOf(p) : p.before?.hull, vid: p.vid };
  return participants;
}
function resolve(e, enc, outcome, fate = 'survived', day = null) {
  const fx = [];
  const r = C.resolveEncounterNow(e.book, e.world, enc.id, { result: { outcome }, participants: borgReport(enc, fate) }, day ?? enc.createdDay, fx);
  (e.fx ||= []).push(...fx);
  return { r, fx };
}
// The captain parked at the Outpost (border cover of Unimatrix) in a cruiser: the objective, the cube's approach
// and the contact in his scene.
function contactCase(seed, opts = {}) {
  const e = env(seed, opts);
  captain(e, IDX.Outpost, opts.ship ?? 80);
  const d = runUntil(e, 2, 40, () => capEnc(e).length > 0);
  return { e, d, enc: capEnc(e)[0] || null, o: capObj(e) };
}
const tick = (e, o, s) => DC.captainAssimilationTick(e.book, o.id, { dtMs: 1000, subdued: true, assimilatorPresent: true, borgAlive: true, ...s });

// ===================================================================================================
// Selection (C1–C6)
// ===================================================================================================
test('new-feature', 'C1. a hidden captain is not selectable: at Earth (no Borg sensor) he is never a contact; at the Outpost with an active cloak he is not seen; in a cloak-capable class at border range he is not seen (the vessel rule); seen directly beside a Borg hull he is', () => {
  need();
  const far = env('CB-1a'); captain(far, IDX.Earth); days(far, 2, 20);
  assert.ok(!Object.values(sum(far).contacts.borg || {}).some((c) => c.kind === 'captain'), 'saw a captain nobody could see');
  assert.equal(capObj(far), null);
  const cl = env('CB-1b'); captain(cl, IDX.Outpost, 80, { cloaked: true }); days(cl, 2, 10);
  assert.ok(!Object.values(sum(cl).contacts.borg || {}).some((c) => c.kind === 'captain'), 'saw a cloaked captain');
  const cc = env('CB-1c'); captain(cc, IDX.Outpost, 85); days(cc, 2, 10);
  assert.ok(!Object.values(sum(cc).contacts.borg || {}).some((c) => c.kind === 'captain'), 'saw a cloak-capable class at border range');
  const dv = env('CB-1d'); captain(dv, IDX.Nexus, 85); probe(dv, IDX.Nexus); days(dv, 2, 2);
  const c = (sum(dv).contacts.borg || {})[CAPTAIN_VID];
  assert.ok(c && c.source === 'direct' && c.kind === 'captain', JSON.stringify(c));
});
test('baseline-defect', 'C2. an observed advanced captain\'s vessel can be selected: the captain in a cruiser at the Outpost (border cover) becomes the objective — target kind captain, his vid, what was seen (1eceab3: the captain is never a contact, never chosen)', () => {
  const e = env('CB-2'); captain(e, IDX.Outpost);
  days(e, 2, 3);
  const o = HAS ? capObj(e) : null;
  log.c2 = o && { id: o.id, target: o.target, value: o.value, why: o.why, movement: o.movement };
  assert.ok(o, `no objective on an observed valuable captain: ${lastSel(e)?.decision ?? 'no selection'}`);
  assert.equal(o.target.vid, CAPTAIN_VID); assert.equal(o.target.captain, true); assert.equal(o.target.known.seenAt, IDX.Outpost); assert.equal(o.target.known.source, 'border');
});
test('new-feature', 'C3. a low-value captain is rejected (a cargo shuttle: "no technology worth acquiring"), and one too strong for the force is rejected ("too strong to take") — no objective either way', () => {
  need();
  const lo = env('CB-3a'); captain(lo, IDX.Outpost, 83); days(lo, 2, 12);
  const c = lastSel(lo).candidates.find((x) => x.kind === 'captain');
  assert.equal(c.verdict, 'rejected'); assert.equal(c.reason, 'no technology worth acquiring'); assert.equal(capObj(lo), null);
  const hi = env('CB-3b'); captain(hi, IDX.Outpost, 86); days(hi, 2, 12);
  const c2 = lastSel(hi).candidates.find((x) => x.kind === 'captain');
  assert.equal(c2.verdict, 'rejected'); assert.equal(c2.reason, 'too strong to take'); assert.equal(capObj(hi), null);
  log.c3 = { lowValue: { value: c.value, score: c.score, reason: c.reason }, tooStrong: { ratio: c2.ratio, reason: c2.reason } };
});
test('new-feature', 'C4. the captain is scored as any vessel: the captain in a cruiser at the Outpost and a Terran hull of the same class at the Outpost (separate campaigns, same seed) get the same value, score, factors, verdict and movement plan', () => {
  need();
  const a = env('CB-4'); captain(a, IDX.Outpost); days(a, 2, 2);
  const b = env('CB-4'); make(b, 'terran', 80, IDX.Outpost); days(b, 2, 2);
  const ca = lastSel(a).candidates.find((x) => x.kind === 'captain');
  const cb = lastSel(b).candidates.find((x) => x.kind === 'ship');
  log.c4 = { captain: { value: ca.value, score: ca.score, factors: ca.factors, movement: ca.movement }, vessel: { value: cb.value, score: cb.score, factors: cb.factors, movement: cb.movement } };
  assert.deepEqual(ca.value, cb.value); assert.equal(ca.score, cb.score); assert.deepEqual(ca.factors, cb.factors); assert.equal(ca.verdict, cb.verdict); assert.deepEqual(ca.movement, cb.movement);
  assert.equal(ca.targetStrength, cb.targetStrength);
});
test('new-feature', 'C5. no omniscient player bias: with the captain at Earth for 40 days nothing about him is known; with the captain and a better-valued vessel both seen, the vessel is chosen (no "always the player" rule); no score factor names the captain', () => {
  need();
  const e = env('CB-5a'); captain(e, IDX.Earth); days(e, 2, 41);
  assert.equal(Object.values(sum(e).contacts.borg || {}).filter((c) => c.kind === 'captain').length, 0); assert.equal(capObj(e), null);
  const f = env('CB-5b'); captain(f, IDX.Outpost, 80); make(f, 'terran', 84, IDX.Nexus); days(f, 2, 2);
  const sel = lastSel(f);
  const cap = sel.candidates.find((x) => x.kind === 'captain'), ves = sel.candidates.find((x) => x.kind === 'ship');
  log.c5 = { chosen: sel.chosen, captain: { score: cap.score, verdict: cap.verdict }, vessel: { score: ves.score, verdict: ves.verdict } };
  assert.ok(ves.score > cap.score, `${ves.score} vs ${cap.score}`); assert.notEqual(sel.chosen, CAPTAIN_VID);
  for (const c of sel.candidates) assert.deepEqual(Object.keys(c.factors).sort(), ['confidence', 'reach', 'value']);
});
test('preservation', 'C6. the pursuit is the Collective\'s own hulls; none is made: the captain objective flies the campaign\'s cube (same id, same vid); the Borg hull count does not change', () => {
  const e = env('CB-6'); captain(e, IDX.Outpost);
  const n0 = P(e.book, 'borg').hulls.length, ids0 = P(e.book, 'borg').hulls.map((h) => h.id).join();
  days(e, 2, 12);
  if (HAS) { const o = capObj(e); assert.ok(o, 'no objective'); assert.deepEqual(o.force.map((x) => x.hullId), [e.cube.id]); assert.equal(o.force[0].vid, vidOf(e.cube)); }
  assert.equal(P(e.book, 'borg').hulls.length, n0); assert.equal(P(e.book, 'borg').hulls.map((h) => h.id).join(), ids0);
});
// ===================================================================================================
// Pursuit and contact (C7–C9)
// ===================================================================================================
test('new-feature', 'C7. the same movement rules: seen at Vega (a probe there), the captain is reached by transwarp (one 2-day leg, the cube\'s rating untouched) exactly as a vessel of his class at Vega would be; on cooldown it holds or goes conventionally by the same rule', () => {
  need();
  const a = env('CB-7'); captain(a, IDX.Vega); probe(a, IDX.Vega); days(a, 2, 3);
  const b = env('CB-7'); make(b, 'terran', 80, IDX.Vega); probe(b, IDX.Vega); days(b, 2, 3);
  const oa = capObj(a), ob = objs(b)[0];
  assert.ok(oa && ob, 'no objective');
  log.c7 = { captain: oa.movement, vessel: ob.movement };
  assert.equal(oa.movement.mode, 'transwarp'); assert.equal(oa.movement.mode, ob.movement.mode); assert.equal(oa.movement.conventionalDays, ob.movement.conventionalDays); assert.equal(oa.movement.transwarpDays, ob.movement.transwarpDays);
  const tr = (a.book.journeys || []).find((j) => j.id === oa.movement.journeyId);
  assert.equal(tr.mode, 'transwarp'); assert.deepEqual(tr.path, [IDX.Vega]); assert.equal(tr.etaDay - tr.legDepartDay, 2);
  const c = env('CB-7c'); c.cube.transwarpLastExitDay = 1; captain(c, IDX.Vega); probe(c, IDX.Vega); days(c, 2, 3);
  const oc = capObj(c);
  assert.ok(['hold', 'conventional'].includes(oc.movement.mode), oc.movement.mode); assert.match(oc.movement.reason, /cooldown|waiting/);
});
test('new-feature', 'C8. the tactical handoff happens once: when the cube stands where the captain stands, one encounter opens — captain:true, his scene, the cube as its participant (same vid), no target hull; days pass with it held and no second encounter opens', () => {
  need();
  const { e, d, enc, o } = contactCase('CB-8');
  assert.ok(enc, 'no contact');
  log.c8 = { day: d, enc: { id: enc.id, captain: enc.captain, status: enc.status, participants: enc.participants.map((p) => ({ side: p.side, vid: p.vid })) }, handoff: o.handoff };
  assert.equal(enc.captain, true); assert.equal(enc.playerHostile, true); assert.equal(enc.status, 'pending'); assert.equal(enc.system, IDX.Outpost);
  assert.deepEqual(enc.participants.map((p) => p.vid), [vidOf(e.cube)]); assert.ok(enc.participants.every((p) => p.side === 'borg'));
  assert.equal(o.handoff.captainScene, true);
  days(e, d + 1, d + 6);
  assert.equal(capEnc(e).length, 1, 'a second encounter opened'); assert.equal(capEnc(e)[0].status, 'pending');
});
test('new-feature', 'C9. no parallel strategic damage: while the contact is held nothing strategic touches the captain or the cube; a contact with no scene falls back to the model once and nothing is fought, damaged or assimilated off-scene (the objective goes on)', () => {
  need();
  const { e, d, enc } = contactCase('CB-9');
  const cubeHull = e.cube.hull;
  days(e, d + 1, d + 3);
  assert.equal(e.cube.hull, cubeHull); assert.equal(capObj(e).progress.value, 0);
  const fx = [];
  const r = C.fallbackEncounterNow(e.book, e.world, enc.id, d + 3, fx, 'no tactical scene (test)');
  assert.ok(r.ok); assert.equal(e.cube.hull, cubeHull, 'the fallback damaged the cube');
  assert.ok(!fx.some((x) => x.type === 'borgAssimilation' && x.event === 'captain_assimilated'));
  const o = capObj(e);
  assert.equal(o.status, 'active'); assert.equal(o.lastEngagement.outcome, 'disengaged'); assert.equal(o.lastEngagement.strategic, true); assert.equal(o.progress.value, 0);
});
// ===================================================================================================
// The assimilation (C10–C14)
// ===================================================================================================
test('new-feature', 'C10/C11. the captain must be subdued first; then the progress advances while an assimilator is present: not subdued → nothing; subdued without an assimilator → held; subdued with one → 1/60 per scene second, and it starts over if he is no longer subdued', () => {
  need();
  const { e, enc, o } = contactCase('CB-10');
  assert.ok(enc);
  assert.equal(tick(e, o, { subdued: false, dtMs: 30000 }).progress, 0);
  assert.equal(capObj(e).phase, 'disable');
  assert.equal(tick(e, o, { assimilatorPresent: false, dtMs: 30000 }).state, 'held');
  assert.equal(capObj(e).progress.value, 0);
  let r = null; for (let k = 0; k < 21; k++) r = tick(e, o, {});
  assert.equal(r.state, 'assimilating'); assert.ok(Math.abs(r.progress - 21 / 60) < 1e-3, String(r.progress)); assert.equal(r.stage, '35');
  assert.equal(capObj(e).phase, 'assimilate');
  assert.equal(tick(e, o, { assimilatorPresent: false, dtMs: 20000 }).progress, r.progress, 'progress lost while held');
  const back = tick(e, o, { subdued: false });
  assert.equal(back.progress, 0); assert.equal(back.state, 'attempting'); assert.equal(capObj(e).phase, 'disable');
  // the stage lines, from the rules
  assert.deepEqual([0, 0.01, 0.35, 0.7, 0.9, 1].map((p) => BD.captainStage(p)), [null, 'begun', '35', '70', 'imminent', 'completed']);
  assert.deepEqual(BD.CAPTAIN_STAGE_TEXT, { begun: 'Assimilation in progress.', 35: 'Assimilation 35%', 70: 'Assimilation 70%', imminent: 'Assimilation imminent.' });
});
test('new-feature', 'C12. destroying the Borg stops it: the scene reports the cube destroyed mid-assimilation → the objective closes borg_destroyed, the progress is interrupted, the hull is lost on its own record; no assimilation happens', () => {
  need();
  const { e, enc, o } = contactCase('CB-12');
  for (let k = 0; k < 30; k++) tick(e, o, {});
  const { fx } = resolve(e, enc, 'borg_beaten', 'destroyed');
  const c = capObj(e);
  assert.equal(c.status, 'aborted'); assert.equal(c.result.result, 'borg_destroyed'); assert.equal(c.progress.state, 'interrupted');
  assert.equal(e.cube.status, 'lost'); assert.equal(sum(e).captainAssimilations.length, 0);
  assert.ok(!fx.some((x) => x.event === 'captain_assimilated'));
});
test('new-feature', 'C13. Borg withdrawal stops it: the cube leaves the fight (its fate escaped) → the objective closes as the Borg out of the fight, progress interrupted; the cube itself is intact and turns for home', () => {
  need();
  const { e, enc, o } = contactCase('CB-13');
  for (let k = 0; k < 20; k++) tick(e, o, {});
  resolve(e, enc, 'borg_withdrew', 'escaped');
  const c = capObj(e);
  assert.equal(c.status, 'aborted'); assert.match(c.result.result, /borg_disabled|abandoned/); assert.equal(c.progress.state, 'interrupted');
  assert.notEqual(e.cube.status, 'lost'); assert.equal(sum(e).captainAssimilations.length, 0);
});
test('new-feature', 'C14. the captain\'s escape aborts it: escaped in the scene → target_escaped, a cooldown on his vessel, and no new objective on him while it lasts', () => {
  need();
  const { e, d, enc, o } = contactCase('CB-14');
  for (let k = 0; k < 10; k++) tick(e, o, { subdued: false });
  resolve(e, enc, 'escaped', 'survived', d);
  const c = capObj(e);
  assert.equal(c.result.result, 'target_escaped'); assert.equal(c.status, 'aborted');
  const cd = sum(e).cooldowns[`borg|${CAPTAIN_VID}`];
  assert.ok(cd > d, `cooldown ${cd}`);
  days(e, d + 1, d + 30);
  assert.equal(objs(e).filter((x) => x.targetKind === 'captain').length, 1, 'a new objective on him during the cooldown');
});
// ===================================================================================================
// Save/load, completion and no conversion (C17–C22)
// ===================================================================================================
test('new-feature', 'C17/C18. save/load mid-assimilation keeps the same objective, the same encounter and Borg vids, and the progress; re-entering after the reload makes no duplicate objective or encounter', () => {
  need();
  const { e, d, enc, o } = contactCase('CB-17');
  SE.activateEncounter(e.book, enc.id, d, [vidOf(e.cube)]);
  for (let k = 0; k < 27; k++) tick(e, o, {});
  const before = { o: JSON.stringify(capObj(e)), enc: JSON.stringify(capEnc(e)[0]), p: capObj(e).progress.value };
  e.book = reload(e.book);
  assert.equal(JSON.stringify(capObj(e)), before.o); assert.equal(JSON.stringify(capEnc(e)[0]), before.enc);
  assert.ok(Math.abs(capObj(e).progress.value - 0.45) < 1e-3);
  days(e, d + 1, d + 5);
  assert.equal(objs(e).filter((x) => x.targetKind === 'captain').length, 1); assert.equal(capEnc(e).length, 1); assert.equal(capEnc(e)[0].participants[0].vid, vidOf(e.cube));
  const r = tick(e, capObj(e), {});
  assert.ok(r.progress > before.p, 'the progress did not continue from where it was saved');
});
test('new-feature', 'C19/C21/C22. completion is the terminal failure exactly once, and nothing converts: at 100% the scene reports captain_assimilated → one captain_assimilated effect, the record of it (his vid, class, the force, the system, the day), the objective completed; a second resolution does nothing; no war, relation, capture, licence, player-hull or treaty change; the Borg gain no production right', () => {
  need();
  const { e, d, enc, o } = contactCase('CB-19');
  const snap = () => JSON.stringify({ war: e.book.war || null, relations: e.relations || null, occupations: e.book.occupations || {}, territory: e.book.territory || {}, treaties: e.book.treatyTerms || [], player: (P(e.book, 'player')?.hulls || []).map((h) => [h.id, h.status, h.systemIndex]), licences: JSON.stringify(P(e.book, 'borg').licenses || {}), controllers: e.world.systems.map((s) => s.controller) });
  const s0 = snap();
  let r = null; for (let k = 0; k < 61 && (!r || r.state !== 'completed'); k++) r = tick(e, o, {});
  assert.equal(r.state, 'completed'); assert.equal(capObj(e).status, 'active', 'completion is the scene\'s to report');
  const first = resolve(e, enc, 'captain_assimilated', 'survived', d);
  const second = resolve(e, enc, 'captain_assimilated', 'survived', d);
  const evs = [...first.fx, ...second.fx].filter((x) => x.type === 'borgAssimilation' && x.event === 'captain_assimilated');
  assert.equal(evs.length, 1, `${evs.length} terminal effects`); assert.equal(second.r.ok, false);
  const c = capObj(e);
  assert.equal(c.status, 'completed'); assert.equal(c.result.result, 'target_assimilated'); assert.equal(c.progress.state, 'completed');
  const rec = sum(e).captainAssimilations;
  log.c19 = { effect: evs[0], record: rec };
  assert.equal(rec.length, 1); assert.equal(rec[0].captainVid, CAPTAIN_VID); assert.equal(rec[0].shipId, 80); assert.deepEqual(rec[0].force, [vidOf(e.cube)]); assert.equal(rec[0].systemIndex, IDX.Outpost); assert.equal(rec[0].result, 'captain_assimilated');
  assert.equal(snap(), s0, 'something converted');
  assert.equal(C.polityCanBuildDesign(e.book, e.world, 'borg', 80), false);
  assert.ok(!P(e.book, 'borg').hulls.some((h) => h.shipId === 80), 'the Borg gained a hull of his class');
  assert.equal(e.world.systems.filter((s) => s.controller === 'borg').length, 1);
});
// ===================================================================================================
// Preservation (C23–C25): with the captain present but unseen, every existing Borg path is unchanged
// ===================================================================================================
function sameAsWithout(seed, setup, from, to) {
  const a = env(seed); setup(a); days(a, from, to);
  const b = env(seed); setup(b); captain(b, IDX.Earth); b.world.localSystem = null; days(b, from, to);
  const strip = (x) => JSON.stringify({ ...x, contacts: undefined, captainAssimilations: undefined });
  return { a: sum(a), b: sum(b), same: strip(sum(a)) === strip(sum(b)) && JSON.stringify(a.book.polities) === JSON.stringify(b.book.polities) };
}
test('preservation', 'C23. NPC ship assimilation is unchanged: the cruiser case at the Outpost runs identically with an unseen captain in the galaxy (same objectives, assimilation, hulls)', () => {
  const r = sameAsWithout('CB-23', (e) => make(e, 'terran', 80, IDX.Outpost), 2, 30);
  assert.ok(r.same, 'the NPC case differs with a captain present');
  if (HAS) assert.ok(r.a.stats.borgShipsAssimilated >= 1 || r.a.objectives.some((o) => o.status !== 'active'), 'the case did not run');
});
test('preservation', 'C24. world assimilation is unchanged: the Outpost case runs identically with an unseen captain present', () => {
  const r = sameAsWithout('CB-24', (e) => { DC.doctrineBook(e.book).config.borg.worlds = true; DC.doctrineBook(e.book).config.borg.ships = false; }, 2, 70);
  assert.ok(r.same, 'the world case differs with a captain present');
});
test('preservation', 'C25. transwarp is unchanged: the Vega jump runs identically with an unseen captain present (same journey record, same uses)', () => {
  const r = sameAsWithout('CB-25', (e) => { make(e, 'terran', 80, IDX.Vega); probe(e, IDX.Vega); }, 2, 12);
  assert.ok(r.same, 'the transwarp case differs with a captain present');
  if (HAS) assert.ok((r.a.transwarp.uses || 0) >= 1, 'no jump');
});

const ok = results.filter((r) => r.ok).length;
const by = (t) => `${results.filter((r) => r.tag === t && r.ok).length}/${results.filter((r) => r.tag === t).length}`;
const line = `captain borg assimilation pure: ${ok}/${results.length} (baseline-defect ${by('baseline-defect')}, new-feature ${by('new-feature')}, preservation ${by('preservation')})`;
console.log(line);
if (out) { fs.mkdirSync(out, { recursive: true }); fs.writeFileSync(path.join(out, 'borg-captain-pure.json'), JSON.stringify({ line, root, results, log }, null, 1)); }
process.exit(ok === results.length ? 0 : 1);
