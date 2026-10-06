// Pure regressions for HIROGEN-HUNTING-DOCTRINE (docs/doctrine/HIROGEN-HUNTING-DOCTRINE.md). The campaign suites'
// galaxy plus the Hirogen Range (hunt-fixture.mjs), the real doctrine data. Tags:
//   [baseline-defect] c0a5890's generic Hirogen get it wrong (fails there on its own assertion);
//   [new-feature]     the hunt itself (fails there: no hunt exists);
//   [preservation]    holds on both (no spawning, no capture, no war, …).
// Each check names the brief's regression number(s) (R1–R32) or integrated scenario. BM1_HUNT_ROOT runs the
// suite against another tree (the baseline reproduction runs it against c0a5890).
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(process.env.BM1_HUNT_ROOT || path.join(here, '..'));
const imp = (rel) => import(pathToFileURL(path.join(root, rel)).href);
const C = await imp('src/campaign-strategy.mjs');
const DC = await imp('src/doctrine-campaign.mjs');
const D = await imp('src/doctrine-runtime.mjs');
const HD = fs.existsSync(path.join(root, 'src/hunt-doctrine.mjs')) ? await imp('src/hunt-doctrine.mjs') : null;
const { makeWorld, run } = await import(pathToFileURL(path.join(root, 'scripts/campaign-world-fixture.mjs')).href);
const HF = await import(pathToFileURL(path.join(here, 'hunt-fixture.mjs')).href);
const doctrine = HF.loadDoctrine(D, root);
const out = process.env.BM1_TEST_OUTPUT || null;
const { IDX, SHIPS } = HF;

const results = [];
const log = {};
const test = (tag, name, fn) => {
  try { fn(); results.push({ tag, name, ok: true }); console.log('PASS', `[${tag}]`, name); }
  catch (e) { results.push({ tag, name, ok: false, error: String(e?.message || e).split('\n')[0] }); console.log('FAIL', `[${tag}]`, name, '\n      ', String(e?.stack || e).split('\n').slice(0, 7).join('\n       ')); }
};
const need = () => { if (!DC.huntSummary) throw new Error('this tree has no hunt: Hirogen are generic hostile traffic (no prey, no pursuit, no hunt record)'); };
const vidOf = (h) => h?.identity?.vid || h?.vid || h?.id;
const P = (book, id) => C.getPolity(book, id);
const reload = (book) => C.upgradeCampaignBook(JSON.parse(JSON.stringify(book)));
// A galaxy with doctrine on and only the hunt live: no routine patrols or traffic of anyone's.
function env(seed, { hunt = {}, hunts = null, relations = {} } = {}) {
  const e = HF.huntWorld(C, makeWorld, seed, { DC, doctrine });
  Object.assign(e.relations, relations);
  const db = DC.doctrineBook(e.book);
  db.config = { ...db.config, patrols: {}, explorers: {}, reliefShips: {}, merchants: {}, projects: {}, patrolAreas: {}, hunt: { ...(db.config.hunt || {}), committedShareMax: 1, ...hunt }, ...(hunts ? { hunts } : {}) };
  // Everybody not named by a test waits at Qonos (seen by no Hirogen sensor).
  for (const [pid, p] of Object.entries(e.book.polities)) if (pid !== 'hirogen') for (const h of p.hulls) { h.systemIndex = IDX.Qonos; }
  e.made = new Set();
  return e;
}
// Re-class a power's free hulls for a test (the records the campaign made: no hull is added).
function make(e, polity, shipId, at, n = 1, { hold = true } = {}) {
  const hs = P(e.book, polity).hulls.filter((h) => h.status === 'ready' && !h.opId && !e.made.has(h.id)).sort((a, b) => String(a.id).localeCompare(String(b.id))).slice(0, n);
  assert.equal(hs.length, n, `not ${n} free ${polity} hulls`);
  for (const h of hs) { e.made.add(h.id); h.shipId = shipId; h.systemIndex = at; h.maxHull = h.hull = e.world.shipStats(shipId).combatHull; h.crew = 1; if (hold && polity !== 'hirogen') { h.status = 'assigned'; h.opId = 'held-by-test'; } }
  return hs;
}
// The Hirogen hunters: the campaign's own Hirogen hulls, re-classed (it has two).
function hunters(e, shipId = 70, at = IDX.Range, n = 2) {
  const hs = P(e.book, 'hirogen').hulls.filter((h) => h.status !== 'lost').slice(0, n);
  assert.equal(hs.length, n, `the campaign gave Hirogen ${hs.length} hulls`);
  for (const h of hs) { e.made.add(h.id); h.shipId = shipId; h.systemIndex = at; h.maxHull = h.hull = SHIPS[shipId].combatHull; h.crew = 1; h.status = 'ready'; h.opId = null; }
  return hs;
}
const summary = (e) => DC.huntSummary(e.book);
const hunts = (e) => summary(e).hunts;
const lastSel = (e, p = 'hirogen') => (summary(e).selections[p] || []).slice(-1)[0] || null;
const days = (e, a, b) => run(e.book, e.world, a, b);
// Fly a hull somewhere on its own journey (an order of its own; not a hunt).
const fly = (e, polity, hs, dest, day) => { const r = C.startJourney(e.book, e.world, { kind: 'hunt-test-move', ref: `move:${hs[0].id}`, sponsor: polity, hulls: hs, destination: dest, purpose: 'move' }, day, []); assert.ok(r.ok, r.reason); for (const h of hs) { h.status = 'assigned'; h.opId = `move:${hs[0].id}`; } return r.journey; };
C.registerJourneyKind('hunt-test-move', {});

// ===================================================================================================
// Selection: knowledge, worth, the doctrine (R1–R6, HIROGEN-HUNT-SELECTION)
// ===================================================================================================
test('preservation', 'R1. no known prey, no hunt: a Terran cruiser at Earth (no Hirogen sensor covers it) is not hunted — no hunt opens, the Hirogen hulls stay home', () => {
  const e = env('HN-1');
  const hs = hunters(e);
  make(e, 'terran', 80, IDX.Earth);
  days(e, 2, 12);
  if (DC.huntSummary) { assert.equal(hunts(e).length, 0, 'a hunt opened on prey nobody saw'); assert.ok(['no prey known', 'no worthy prey'].includes(lastSel(e)?.decision), lastSel(e)?.decision); }
  assert.ok(hs.every((h) => Number(h.systemIndex) === IDX.Range && !h.transit));
});
test('baseline-defect', 'R2. a directly observed combat ship becomes prey: a Terran cruiser at Minor (beside the Hirogen Range: its sensors cover it) is selected and hunted (c0a5890: the Hirogen sit at home while a worthy quarry is in sensor range)', () => {
  const e = env('HN-2');
  hunters(e);
  const [c] = make(e, 'terran', 80, IDX.Minor);
  days(e, 2, 3);
  const o = DC.huntSummary ? hunts(e)[0] : null;
  log.r2 = o ? { id: o.id, prey: o.prey, why: o.why } : null;
  assert.ok(o, 'no hunt on an observed worthy quarry');
  assert.equal(o.prey.vid, vidOf(c)); assert.equal(o.prey.cls, 'military'); assert.equal(o.lastKnown.systemIndex, IDX.Minor);
});
test('new-feature', 'R3. a hidden ship is not selectable: a Terran cruiser at Earth and a cloaked one at Minor (border sensors do not see a cloak) are not among the Hirogen contacts; a visible one at Minor is', () => {
  need();
  const e = env('HN-3');
  hunters(e);
  const [far] = make(e, 'terran', 80, IDX.Earth); const [cl] = make(e, 'terran', 85, IDX.Minor); const [vis] = make(e, 'terran', 80, IDX.Romulus);
  days(e, 2, 2);
  const seen = Object.keys(summary(e).contacts.hirogen || {});
  assert.ok(!seen.includes(vidOf(far)), 'saw a ship nobody could see'); assert.ok(!seen.includes(vidOf(cl)), 'saw a cloaked ship at sensor range');
  assert.ok(seen.includes(vidOf(vis)));
});
test('new-feature', 'R4/R5/R6. worth by force ratio: against two Hunters, an unarmed shuttle is trivial (rejected), a cruiser pair at parity is worthy (scores highest), a dreadnought group is too strong (rejected) — and a reckless doctrine may take it', () => {
  need();
  const W = (r, reckless = false) => HD.worthCurve(r, HD.HUNT_DEFAULTS, reckless);
  const sc = (preyStrength, cls = 'military', extra = {}) => HD.scorePrey({ preyStrength, hunterStrength: 260, cls, source: 'border', ageDays: 0, day: 5, reachDays: 5, ...extra });
  const shuttle = sc(12, 'civilian'), pair = sc(360), one = sc(180), dread = sc(1200);
  log.r456 = { shuttle, one, pair, dread, recklessDread: sc(800, 'military', { reckless: true }) };
  assert.equal(shuttle.verdict, 'rejected'); assert.equal(shuttle.reason, 'trivial prey');
  assert.equal(pair.band, 'worthy'); assert.ok(pair.score >= 0.75, `parity scored ${pair.score}`);
  assert.ok(pair.score > shuttle.score && one.score > shuttle.score);
  assert.equal(dread.verdict, 'rejected'); assert.equal(dread.reason, 'too strong');
  assert.equal(sc(800).verdict, 'rejected'); assert.equal(sc(800, 'military', { reckless: true }).verdict, 'eligible');
  // the curve: trivial < lesser < worthy, falling past parity, zero when overwhelming
  assert.ok(W(0.1).worth < W(0.5).worth && W(0.5).worth < W(1).worth && W(2).worth < W(1).worth && W(3).worth === 0);
});
test('new-feature', 'HIROGEN-HUNT-SELECTION. the Hirogen see three possible prey — an unarmed shuttle at Minor (trivial), a Terran cruiser pair at Romulus (worthy), a Romulan battle group of two dreadnought-class hulls at Romulus (too strong) — and hunt the cruiser pair; the selection records every verdict and why', () => {
  need();
  const e = env('HN-SEL');
  hunters(e);
  const [sh] = make(e, 'terran', 83, IDX.Minor); const pair = make(e, 'terran', 80, IDX.Romulus, 2);
  const roms = make(e, 'romulan', 84, IDX.Romulus, 2);
  days(e, 2, 2);
  const sel = lastSel(e);
  log.selection = sel;
  const v = (x) => sel.candidates.find((c) => c.vid === vidOf(x));
  assert.equal(sel.chosen, vidOf(pair[0]), `chose ${sel.chosen}: ${sel.decision}`);
  assert.equal(v(sh).reason, 'trivial prey'); assert.equal(v(pair[0]).verdict, 'eligible'); assert.equal(v(roms[0]).reason, 'too strong');
  assert.equal(hunts(e)[0].prey.vid, vidOf(pair[0])); assert.match(hunts(e)[0].why.reason, /worthy/);
});
// ===================================================================================================
// Hunters (R7–R10), pursuit (R11–R16), cooldowns (R17–R18)
// ===================================================================================================
test('preservation', 'R7/R8. hunters are real hulls; none is made for a hunt: the hunt flies the campaign\'s own Hirogen hulls (same ids); with every Hirogen hull busy, no hunt opens ("deferred: no free hunter") and no hull is added', () => {
  const e = env('HN-7');
  const hs = hunters(e);
  make(e, 'terran', 80, IDX.Minor);
  const n0 = P(e.book, 'hirogen').hulls.length;
  days(e, 2, 3);
  if (DC.huntSummary) { const o = hunts(e)[0]; assert.ok(o, 'no hunt'); assert.ok(o.hunters.every((x) => hs.some((h) => h.id === x.hullId))); }
  assert.equal(P(e.book, 'hirogen').hulls.length, n0);
  const e2 = env('HN-8');
  const busy = hunters(e2); for (const h of busy) { h.status = 'assigned'; h.opId = 'elsewhere'; }
  make(e2, 'terran', 80, IDX.Minor);
  const m0 = P(e2.book, 'hirogen').hulls.length;
  days(e2, 2, 8);
  if (DC.huntSummary) { assert.equal(hunts(e2).length, 0); assert.match(lastSel(e2)?.decision || '', /deferred/); }
  assert.equal(P(e2.book, 'hirogen').hulls.length, m0, 'a Hirogen hull was made');
});
// One pursuit: hunters at the Range, a cruiser at Minor; returns the env and handles.
function pursuit(seed, { preyShip = 80, hunterShip = 70, hunt = {} } = {}) {
  const e = env(seed, { hunt });
  const hs = hunters(e, hunterShip);
  const [c] = make(e, 'terran', preyShip, IDX.Minor);
  return { e, hs, c };
}
test('new-feature', 'R9/R10/R11. the hunt flies the shared journey: a hunt journey (kind hunt, the hunt as its reference) on the route the model plots, legs at the hunters\' own speed; hunters and prey keep their vids throughout', () => {
  need();
  const { e, hs, c } = pursuit('HN-9');
  const vids = [hs.map(vidOf), vidOf(c)];
  days(e, 2, 3);
  const o = hunts(e)[0];
  const tr = (e.book.journeys || []).find((j) => j.kind === 'hunt' && j.ref === o.id);
  log.r11 = tr ? { path: tr.path, legDays: tr.legDays, speed: tr.speed } : null;
  assert.ok(tr, 'no shared journey for the hunt');
  const plan = C.plotJourney(e.world, IDX.Range, IDX.Minor, 'hirogen', null, C.hullsSpeed(e.world, hs.filter((h) => o.hunters.some((x) => x.hullId === h.id))));
  assert.deepEqual(tr.path, plan.path); assert.deepEqual(tr.legDays, plan.legDays);
  days(e, 4, 30);
  assert.deepEqual([hs.map(vidOf), vidOf(c)], vids);
});
test('new-feature', 'R12. faster prey slips the hunters more often: the escape chance at contact is higher for the fast cruiser than for the slow one of the same class, and over twenty seeded contacts the fast one escapes more', () => {
  need();
  const fast = HD.escapeChance({ preySpeed: SHIPS[81].strategicSpeed, hunterSpeed: SHIPS[70].strategicSpeed }), slow = HD.escapeChance({ preySpeed: SHIPS[82].strategicSpeed, hunterSpeed: SHIPS[70].strategicSpeed });
  assert.ok(fast > slow, `${fast} vs ${slow}`);
  const escapes = (ship) => { let n = 0; for (let k = 0; k < 20; k++) { const { e } = pursuit(`HN-12-${ship}-${k}`, { preyShip: ship }); days(e, 2, 20); if (hunts(e).some((o) => o.result?.result === 'prey_escaped')) n++; } return n; };
  const nf = escapes(81), ns = escapes(82);
  log.r12 = { fast, slow, escapesFast: nf, escapesSlow: ns };
  assert.ok(nf > ns, `fast ${nf} vs slow ${ns}`);
});
test('new-feature', 'R13. a faster hunter makes the intercept feasible: to the cruiser at Vega (ten days\' window), the fast Hunter (1.2×) arrives in time and the slow one (0.7×) does not', () => {
  need();
  const e = env('HN-13');
  const fastDays = C.plannedJourneyDays(e.world, IDX.Range, IDX.Vega, 'hirogen', SHIPS[70].strategicSpeed);
  const slowDays = C.plannedJourneyDays(e.world, IDX.Range, IDX.Vega, 'hirogen', SHIPS[74].strategicSpeed);
  const f = HD.interceptEstimate({ hunterDays: fastDays, preyWindowDays: 10 }), s = HD.interceptEstimate({ hunterDays: slowDays, preyWindowDays: 10 });
  log.r13 = { fastDays, slowDays, f, s };
  assert.ok(fastDays < slowDays); assert.equal(f.feasible, true); assert.equal(s.feasible, false);
});
test('new-feature', 'R14/R15/R16. contact lost is last-known, not a live track; the search is bounded: the cruiser leaves Minor for Earth (no Hirogen sensor there); the hunt keeps where and when it was last seen, searches its heading, where it was and the neighbours, and gives up — "escaped" — within the search budget', () => {
  need();
  const { e, c } = pursuit('HN-14', { hunt: { searchDays: 8 } });
  days(e, 2, 2);
  const o = hunts(e)[0];
  assert.ok(o, 'no hunt');
  c.status = 'ready'; c.opId = null;
  fly(e, 'terran', [c], IDX.Earth, 2);
  days(e, 3, 3);
  const seen = { ...o.lastKnown };
  const trail = [];
  for (let d = 4; d <= 40 && o.status === 'active'; d++) { days(e, d, d); trail.push([d, o.phase, o.lastKnown.systemIndex, o.lastKnown.day, o.lostSince]); }
  log.r14 = { seen, trail: trail.slice(0, 20), result: o.result, searched: o.searched };
  assert.equal(seen.systemIndex, IDX.Minor); assert.equal(seen.heading, IDX.Vega, 'the heading seen as it left was not kept');
  assert.ok(trail.some((x) => x[1] === 'searching'), 'never searched');
  assert.ok(trail.every((x) => x[2] === IDX.Minor || x[2] === IDX.Vega), 'tracked a ship nobody could see');
  assert.equal(o.status, 'aborted'); assert.equal(o.result.result, 'escaped'); assert.ok(o.closedDay - o.lostSince <= 8 + 1, `searched ${o.closedDay - o.lostSince} days`);
});
test('new-feature', 'R17/R18. the escaped prey is not hunted again at once: seen again at Minor, it is rejected "cooldown until day N" (counted); the cooldown and the history survive save and load', () => {
  need();
  const { e, c } = pursuit('HN-17', { hunt: { searchDays: 6 } });
  days(e, 2, 2);
  c.status = 'ready'; c.opId = null; fly(e, 'terran', [c], IDX.Earth, 2);
  days(e, 3, 40);
  const o = hunts(e)[0];
  assert.equal(o.result?.result, 'escaped', JSON.stringify(o.result));
  // back where the Hirogen can see it
  if (c.transit) days(e, 41, 60);
  c.status = 'assigned'; c.opId = 'held-by-test'; delete c.transit; c.systemIndex = IDX.Minor;
  const b2 = reload(e.book);
  days(e, 41, 47);
  const sel = lastSel(e);
  const v = sel.candidates.find((x) => x.vid === vidOf(c));
  log.r17 = { verdict: v, cooldowns: summary(e).cooldowns, history: summary(e).history };
  assert.match(v.reason, /^cooldown until day/); assert.equal(hunts(e).filter((x) => x.status === 'active').length, 0);
  const s2 = DC.huntSummary(b2);
  assert.deepEqual(s2.cooldowns, summary(e).cooldowns); assert.deepEqual(s2.history, summary(e).history);
  assert.ok((summary(e).stats.huntCooldownSkips || 0) >= 1);
});
// ===================================================================================================
// Endings (R19–R21, R30), no capture, no war (R22–R24)
// ===================================================================================================
// Hunters and the cruiser meet at Minor; the outcome forced by the hull the cruiser carries.
function contact(seed, { preyHull = null, hunterHull = null, preyShip = 82, hunt = {} } = {}) {
  const r = pursuit(seed, { preyShip, hunt });
  if (preyHull != null) r.c.hull = preyHull;
  if (hunterHull != null) for (const h of r.hs) h.hull = hunterHull;
  return r;
}
test('new-feature', 'R19. prey destroyed: the hunters catch a crippled (still mobile: a disabled hulk is no quarry) slow cruiser at Minor; the strategic engagement destroys it; the hunt resolves "target_destroyed" and the hunters go home', () => {
  need();
  let r = null;
  for (let k = 0; k < 10 && !r; k++) { const x = contact(`HN-19-${k}`, { preyHull: 160 }); days(x.e, 2, 30); if (hunts(x.e)[0]?.result?.result === 'target_destroyed') r = x; }
  assert.ok(r, 'never destroyed');
  const o = hunts(r.e)[0];
  log.r19 = { result: o.result, phase: o.phase, hunters: r.hs.map((h) => [h.systemIndex, h.opId]) };
  assert.equal(r.c.status, 'lost'); assert.equal(o.status, 'completed');
  assert.ok(['disengaging', 'resolved'].includes(o.phase));
});
test('new-feature', 'R20. hunter lost: a Hunter destroyed (or disabled) mid-pursuit ends the hunt — "hunter_lost" / "hunter_disabled" — the same day', () => {
  need();
  const a = pursuit('HN-20a'); days(a.e, 2, 3);
  const oa = hunts(a.e)[0]; for (const x of oa.hunters) { const h = a.e.book.polities.hirogen.hulls.find((y) => y.id === x.hullId); h.status = 'lost'; h.hull = 0; delete h.transit; }
  days(a.e, 4, 4);
  const b = pursuit('HN-20b'); days(b.e, 2, 3);
  const ob = hunts(b.e)[0]; for (const x of ob.hunters) { const h = b.e.book.polities.hirogen.hulls.find((y) => y.id === x.hullId); h.hull = Math.floor(h.maxHull * 0.05); }
  days(b.e, 4, 6);
  log.r20 = { lost: oa.result, disabled: ob.result };
  assert.equal(oa.result?.result, 'hunter_lost'); assert.equal(ob.result?.result, 'hunter_disabled');
});
test('new-feature', 'R21/R30. prey surrender: the contact at Minor is fought in the captain\'s scene (he is there); the cruiser strikes — the hunt resolves "surrender_accepted" (recorded as an unsatisfying end), no further engagement is opened and no hunt journey is ordered after the closure', () => {
  need();
  const { e, c, hs } = contact('HN-21', { preyShip: 80 });
  e.world.localSystem = IDX.Minor;
  let enc = null;
  for (let d = 2; d <= 25 && !enc; d++) { days(e, d, d); enc = (e.book.encounters || []).find((x) => x.type === 'hunt' && x.status === 'pending'); }
  assert.ok(enc, 'no contact at Minor');
  const day = e.book.day;
  const prey = enc.participants.find((p) => p.side === 'prey');
  const r = C.resolveEncounterNow(e.book, e.world, enc.id, { result: { outcome: 'fought' }, participants: { [prey.ref]: { fate: 'surrendered', hull: c.hull * 0.3, vid: vidOf(c), to: 'hirogen' } } }, day, []);
  assert.ok(r.ok, r.reason);
  const o = hunts(e)[0];
  const statusAtResolution = c.status;
  const encs = (e.book.encounters || []).filter((x) => x.type === 'hunt').length;
  days(e, day + 1, day + 15);
  const later = (e.book.journeys || []).filter((j) => j.kind === 'hunt' && j.ref === o.id && j.departedDay > day);
  log.r21 = { result: o.result, cStatus: statusAtResolution, cStatusLater: c.status, encounters: encs, after: (e.book.encounters || []).filter((x) => x.type === 'hunt').length, later: later.length, hunters: hs.map((h) => [h.systemIndex, h.opId, h.transit?.to ?? null]) };
  assert.equal(o.result.result, 'surrender_accepted'); assert.match(o.result.reason, /unsatisfying/);
  assert.equal(statusAtResolution, 'surrendered');
  assert.equal((e.book.encounters || []).filter((x) => x.type === 'hunt').length, encs, 'a new engagement after the closure');
  assert.equal(later.length, 0, 'a pursuit order after the closure');
});
test('new-feature', 'R28. one encounter, never two resolutions: a contact in the captain\'s system waits for his scene (no strategic damage meanwhile); when he is gone it is settled once by the strategic resolver — the same encounter, resolved once, its result on the same hunt', () => {
  need();
  const { e, c, hs } = contact('HN-28', { preyShip: 80 });
  e.world.localSystem = IDX.Minor;
  let enc = null;
  for (let d = 2; d <= 25 && !enc; d++) { days(e, d, d); enc = (e.book.encounters || []).find((x) => x.type === 'hunt' && x.status === 'pending'); }
  assert.ok(enc, 'no contact at Minor');
  const d0 = e.book.day;
  const recs = () => JSON.stringify([c.hull, ...hs.map((h) => h.hull)]);
  const r0 = recs();
  days(e, d0 + 1, d0 + 2); // he is still there: the contact waits, nothing strategic touches it
  assert.equal(enc.status, 'pending'); assert.equal(recs(), r0, 'strategic damage while the scene holds the contact');
  e.world.localSystem = null; // he left
  days(e, d0 + 3, d0 + 3);
  const all = (e.book.encounters || []).filter((x) => x.type === 'hunt');
  log.r28 = { status: enc.status, history: enc.history?.map((x) => x.event), hunt: hunts(e)[0].lastEngagement, n: all.length };
  assert.ok(['resolved', 'fallback'].includes(enc.status), enc.status);
  assert.equal(enc.history.filter((x) => ['resolved', 'fallback'].includes(x.event)).length, 1, 'resolved more than once');
  assert.equal(hunts(e)[0].lastEngagement.day, d0 + 3);
});
test('new-feature', 'R10/R31b. the prey is its hulls, not its group: a lower-id Terran shuttle joining the hunted cruiser at Minor (changing the group\'s lead) neither loses the hunt nor opens a second one — the hunters still come to Minor and engage', () => {
  need();
  const e = env('HN-RG');
  hunters(e);
  const [sh] = make(e, 'terran', 83, IDX.Qonos); const [c] = make(e, 'terran', 80, IDX.Minor);
  days(e, 2, 2);
  const o = hunts(e)[0];
  assert.ok(o && o.prey.vid === vidOf(c), 'no hunt on the cruiser');
  sh.systemIndex = IDX.Minor; // joins it there
  for (let d = 3; d <= 30 && o.status === 'active' && !o.engagements; d++) days(e, d, d);
  log.regroup = { phase: o.phase, engagements: o.engagements, result: o.result, hunts: hunts(e).length, lostSince: o.lostSince };
  assert.ok(o.engagements >= 1, `never engaged: ${JSON.stringify(o.result)}`);
  assert.equal(hunts(e).length, 1, 'a second hunt on the same prey');
});
test('new-feature', 'R28c. no scene in warp: a contact at system 0 (Earth) while the captain is in warp (localSystem null) is settled by the strategic resolver at once, not held for a scene', () => {
  need();
  const e = env('HN-0');
  hunters(e, 70, IDX.Earth);
  make(e, 'terran', 80, IDX.Earth);
  e.world.localSystem = null;
  days(e, 2, 6);
  const encs = (e.book.encounters || []).filter((x) => x.type === 'hunt');
  log.sys0 = { encs: encs.map((x) => [x.system, x.status]), hunt: hunts(e)[0]?.lastEngagement };
  assert.ok(encs.length >= 1, 'no contact at Earth');
  assert.ok(encs.every((x) => !['pending', 'tactical_active'].includes(x.status)), JSON.stringify(log.sys0.encs));
});
test('preservation', 'R22/R23/R24. a hunt takes no world and makes no war: forty days of hunting (an existing Hirogen–Romulan war on the books) leave every system\'s holder and every relation as they were; the war with Romulus stands, no war is declared', () => {
  const e = env('HN-22', { relations: { 'hirogen:romulan': 'war' } });
  hunters(e); make(e, 'terran', 80, IDX.Minor);
  const ctl0 = JSON.stringify(e.world.systems.map((s) => s.controller));
  const rel0 = JSON.stringify(e.relations);
  const fx = days(e, 2, 40);
  log.r22 = { captures: fx.filter((x) => x.type === 'captureSystem').length, wars: fx.filter((x) => /war/i.test(x.type)).map((x) => x.type) };
  assert.equal(JSON.stringify(e.world.systems.map((s) => s.controller)), ctl0);
  assert.equal(JSON.stringify(e.relations), rel0); assert.equal(e.world.relation('hirogen', 'romulan'), 'war'); assert.equal(e.world.relation('hirogen', 'terran'), 'peace');
  assert.equal(fx.filter((x) => x.type === 'captureSystem').length, 0);
  assert.equal(fx.filter((x) => /declar/i.test(x.type)).length, 0);
});
// ===================================================================================================
// Treaties and blockades (R25–R26), duplicates (R31), save/load (R32), pursuit scenario
// ===================================================================================================
test('new-feature', 'R25. a DMZ violation is an ordinary treaty breach: with a Hirogen–Terran DMZ at Minor and no lawful way there, the hunt goes through in defiance (as its doctrine allows) and the crossing is a dmz_entry breach by the Hirogen — no war', () => {
  need();
  const { e } = pursuit('HN-25');
  const t = C.addTreatyTerm(e.book, e.world, { type: 'dmz', parties: ['hirogen', 'terran'], systems: [IDX.Minor] }, 1, []);
  assert.ok(t.ok, t.reason);
  days(e, 2, 20);
  const inc = (e.book.treatyIncidents || []).filter((x) => x.kind === 'dmz_entry' && x.breaching === 'hirogen');
  log.r25 = { incidents: inc.map((x) => [x.state, x.systemIndex]), actions: hunts(e)[0]?.actions };
  assert.ok(hunts(e)[0].actions.some((a) => a.action === 'defy_treaty'));
  assert.ok(inc.length >= 1, 'no breach recorded'); assert.equal(e.world.relation('hirogen', 'terran'), 'peace');
});
test('new-feature', 'R26. a blockade on the way is run through the shared engine: a Klingon blockade of Romulus (at war with Hirogen and Romulus) — a blockade strong enough to stand (three dreadnought-class Klingon hulls); the hunters pursuing a cruiser at Romulus run it, on the blockade\'s record under the hunt\'s key', () => {
  need();
  const e = env('HN-26', { relations: { 'klingon:hirogen': 'war', 'klingon:romulan': 'war' } });
  hunters(e); make(e, 'terran', 80, IDX.Romulus);
  const ks = make(e, 'klingon', 84, IDX.Romulus, 3, { hold: false });
  const b = C.startBlockade(e.book, e.world, { power: 'klingon', target: IDX.Romulus, hullIds: ks.map((h) => h.id), purpose: 'interdict_trade' }, 1, []);
  assert.ok(b.ok, b.reason);
  days(e, 2, 12);
  const o = hunts(e)[0];
  const runs = (b.record.runs || []).filter((x) => String(x.by).startsWith(`${o.id}:`));
  log.r26 = { runs, hunt: o?.phase };
  assert.ok(runs.length >= 1, 'the blockade never saw the hunters');
});
test('new-feature', 'R31. one hunt per prey: with room for two hunts and one hunter each, the second Hunter evaluating the same cruiser rejects it ("already hunted"); duplicates are counted', () => {
  need();
  const e = env('HN-31', { hunt: { maxActive: 2, groupMax: 1 } });
  hunters(e); make(e, 'terran', 80, IDX.Minor);
  days(e, 2, 8);
  const all = hunts(e).filter((o) => o.status === 'active' || o.closedDay);
  const sel = summary(e).selections.hirogen;
  log.r31 = { hunts: all.map((o) => [o.id, o.prey.vid, o.status]), stats: summary(e).stats };
  assert.equal(new Set(hunts(e).filter((o) => o.status === 'active').map((o) => o.prey.vid)).size, hunts(e).filter((o) => o.status === 'active').length);
  assert.ok(sel.some((s) => s.candidates.some((c) => c.reason === 'already hunted')), 'the duplicate was not considered and rejected');
  assert.ok((summary(e).stats.huntDuplicatesPrevented || 0) >= 1);
});
test('new-feature', 'R32. save/load mid-pursuit: reloaded on the day the hunters are under way, the reloaded campaign flies the same route, phase, knowledge and budget, day for day, to the same end', () => {
  need();
  const { e } = pursuit('HN-32', { preyShip: 81 });
  days(e, 2, 4);
  const b2 = reload(e.book);
  const pick = (book) => { const o = DC.huntSummary(book).hunts[0]; const tr = (book.journeys || []).filter((j) => j.ref === o.id).map((j) => [j.kind, j.path, j.legIndex, j.status]); return JSON.stringify({ phase: o.phase, lastKnown: o.lastKnown, lostSince: o.lostSince, budget: o.budget, status: o.status, result: o.result, engagements: o.engagements, tr }); };
  assert.equal(pick(b2), pick(e.book));
  const w2 = e.world; // the same world object is fine: the fixture's world carries no campaign state
  for (let d = 5; d <= 30; d++) { run(e.book, e.world, d, d); run(b2, w2, d, d); }
  log.r32 = JSON.parse(pick(e.book));
  assert.equal(pick(b2), pick(e.book));
});
test('new-feature', 'HIROGEN-PURSUIT. the cruiser flees Minor across real legs (Vega, then Border); the hunters pursue at their own speed; at Minor contact is lost and the hunt searches. Branch A: the slow cruiser stops at Vega — reacquired there and engaged. Branch B: the fast cruiser runs on out of reach — the search spends its budget and the hunt ends "escaped"', () => {
  need();
  const branch = (ship, dest, seed) => {
    const { e, c } = pursuit(seed, { preyShip: ship, hunt: { searchDays: 10 } });
    days(e, 2, 2);
    const o = hunts(e)[0];
    c.status = 'ready'; c.opId = null; fly(e, 'terran', [c], dest, 2);
    const trail = [];
    for (let d = 3; d <= 60 && o.status === 'active'; d++) { days(e, d, d); trail.push({ d, phase: o.phase, at: o.lastKnown.systemIndex, seen: o.lastKnown.day, hunters: o.hunters.map((x) => { const h = e.book.polities.hirogen.hulls.find((y) => y.id === x.hullId); return h.transit ? `→${h.transit.to}` : h.systemIndex; }) }); }
    return { o, trail, phases: [...new Set(o.phaseHistory.map((x) => x.phase))] };
  };
  const A = branch(82, IDX.Vega, 'HN-PA'), B = branch(81, IDX.Cardassia, 'HN-PB');
  log.pursuit = { A: { result: A.o.result, phases: A.phases, trail: A.trail.slice(0, 25) }, B: { result: B.o.result, phases: B.phases, trail: B.trail.slice(0, 30) } };
  assert.ok(A.phases.includes('searching') || A.phases.includes('pursuing'), `A: ${A.phases}`);
  assert.ok(A.o.engagements >= 1, `A was never re-acquired: ${JSON.stringify(A.o.result)}`);
  assert.ok(A.trail.some((x) => x.at === IDX.Vega), 'A was never seen at Vega');
  assert.ok(B.phases.includes('searching'), `B: ${B.phases}`);
  assert.equal(B.o.result?.result, 'escaped'); assert.equal(B.o.engagements, 0);
});

const failed = results.filter((r) => !r.ok);
const by = (t) => `${t} ${results.filter((r) => r.tag === t && r.ok).length}/${results.filter((r) => r.tag === t).length}`;
console.log(`\nhirogen hunt pure: ${results.length - failed.length}/${results.length} (${['baseline-defect', 'new-feature', 'preservation'].map(by).join(', ')})${failed.length ? ` — FAILED: ${failed.map((r) => r.name.split(' ')[0]).join(', ')}` : ''}`);
if (out) { fs.mkdirSync(out, { recursive: true }); fs.writeFileSync(path.join(out, process.env.BM1_HUNT_ROOT ? 'hunt-pure-baseline.json' : 'hunt-pure.json'), JSON.stringify({ root, results, log }, null, 1)); }
process.exit(failed.length ? 1 : 0);
