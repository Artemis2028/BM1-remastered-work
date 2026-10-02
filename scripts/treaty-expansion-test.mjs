// Pure regressions for TREATY-EXPANSION (docs/diplomacy/TREATY-EXPANSION.md): DMZs, transit guarantees, basing
// rights, inspection regimes, tribute and reparations as persistent terms that act through the systems that
// already exist — routing and crossings (the shared journey), the blockade engine, the yards, the treasuries —
// with breaches as incidents that never start a war. Checks are tagged:
//   [baseline-defect] reproduces d5b50b5, where a settlement's terms are labels at most (fails on its own
//                     assertion there, or because the tree has no treaty terms at all);
//   [new-feature]     behaviour this round adds;
//   [preservation]    behaviour that must be unchanged.
// BM1_TREATY_ROOT points the suite at another tree (the baseline reproduction runs it against d5b50b5).
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(process.env.BM1_TREATY_ROOT || path.join(here, '..'));
const imp = (rel) => import(pathToFileURL(path.join(root, rel)).href);
const C = await imp('src/campaign-strategy.mjs');
let TT = null; try { TT = await imp('src/treaty-terms.mjs'); } catch { TT = null; }
let DC = null; try { DC = await imp('src/doctrine-campaign.mjs'); } catch { DC = null; }
const { makeWorld, run } = await import(pathToFileURL(path.join(root, 'scripts/campaign-world-fixture.mjs')).href);
const out = process.env.BM1_TEST_OUTPUT || null;
const skipSuites = process.env.BM1_TREATY_SKIP_SUITES === '1';

const results = [];
const log = {};
const test = (tag, name, fn) => {
  try { fn(); results.push({ tag, name, ok: true }); console.log('PASS', `[${tag}]`, name); }
  catch (e) { results.push({ tag, name, ok: false, error: String(e?.message || e).split('\n')[0] }); console.log('FAIL', `[${tag}]`, name, '\n      ', String(e?.stack || e).split('\n').slice(0, 7).join('\n       ')); }
};
const need = () => { if (!TT || !C.addTreatyTerm) throw new Error('this tree has no treaty terms: a settlement carries no DMZ, guarantee, basing, inspection or payment'); };

// ---- the fixture galaxy (treaty-fixture.mjs) ----
const FX = await import(pathToFileURL(path.join(here, 'treaty-fixture.mjs')).href);
const { IDX, SHIPS } = FX;
const treatyWorld = (seed, opts = {}) => FX.treatyWorldWith(C, makeWorld, seed, opts);
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
// Every other hull of every power home and out of the way.
function park(env) { for (const [pid, p] of Object.entries(env.book.polities)) for (const h of p.hulls) if (!madeHulls.has(h) && h.status !== 'lost') { const home = env.world.systems.find((s) => s.controller === pid && ![IDX.Border, IDX.Archanis, IDX.Vega].includes(s.index)) || env.world.systems.find((s) => s.controller === pid); if (home) h.systemIndex = home.index; } }
const addTerm = (env, spec, day = 1) => { const eff = []; const r = C.addTreatyTerm(env.book, env.world, spec, day, eff); assert.ok(r.ok, r.reason); return r.term; };
const go = (env, polity, hulls, destination, extra = {}, day = 1) => C.startJourney(env.book, env.world, { kind: 'treaty-test', sponsor: polity, hulls, destination, purpose: 'move', ...extra }, day, []);
const wars = (effects) => effects.filter((e) => e.type === 'warDeclared');
const warSnapshot = (book) => JSON.stringify(Object.values(book.warStates || {}).map((s) => [s.key, s.status, s.instance, s.warId]).sort());
// No war state became (or became again) a war, and no new instance opened: a ceasefire may still settle into peace.
const noNewWar = (book, before) => { const was = new Map(JSON.parse(before).map(([k, st, inst]) => [k, [st, inst]])); return Object.values(book.warStates || {}).every((s) => { const w = was.get(s.key); return w ? s.instance === w[1] && (s.status !== 'war' || w[0] === 'war') : s.status !== 'war'; }); };
const DMZ = (systems, extra = {}) => ({ type: 'dmz', parties: ['terran', 'klingon'], systems, ...extra });
const stats = (book) => book.stats.treaty || {};

// ===================================================================================================
// BEFORE / AFTER: a settlement's terms
// ===================================================================================================
test('baseline-defect', 'BEFORE/AFTER. a terran–klingon ceasefire settled with "add DMZ systems Border/Archanis": the DMZ must bind both sides — a terran warship sent Vega → Qonos is routed round it (via Romulus), and one sent to Border is refused (on d5b50b5 the settlement carries no terms and the warship flies Vega → Border → Qonos)', () => {
  const env = treatyWorld('TX-0');
  const eff = C.forceWarTransition(env.book, env.world, 'terran', 'klingon', 'ceasefire', 1, 'test settlement', 'directed', { treaty: ['add DMZ systems Border/Archanis'] });
  env.relations['terran:klingon'] = 'ceasefire';
  const [h] = make(env, 'terran', 91, IDX.Vega); park(env);
  const r = go(env, 'terran', [h], IDX.Qonos);
  assert.ok(r.ok, r.reason);
  log.beforeAfter = { path: r.journey.path, treatyTerms: (env.book.treatyTerms || []).map((t) => [t.type, t.systems]), effects: eff.map((e) => e.type) };
  assert.ok(!r.journey.path.includes(IDX.Border) && !r.journey.path.includes(IDX.Archanis), `the warship flies through the DMZ: ${r.journey.path}`);
  const [h2] = make(env, 'terran', 91, IDX.Vega);
  const r2 = go(env, 'terran', [h2], IDX.Border);
  assert.equal(r2.ok, false, 'a warship was sent to station inside the DMZ');
});

// ===================================================================================================
// 1–5: DMZ
// ===================================================================================================
test('preservation', '1. peace is not a DMZ: a peace settled with no terms leaves no term, and a terran warship still routes Vega → Border → Qonos', () => {
  const env = treatyWorld('TX-1');
  C.forceWarTransition(env.book, env.world, 'terran', 'klingon', 'peace', 1, 'test peace');
  env.relations['terran:klingon'] = 'peace';
  assert.equal((env.book.treatyTerms || []).length, 0);
  const [h] = make(env, 'terran', 91, IDX.Vega); park(env);
  const r = go(env, 'terran', [h], IDX.Qonos);
  assert.ok(r.ok); assert.deepEqual(r.journey.path, [IDX.Border, IDX.Qonos]);
});
test('new-feature', '2. a DMZ blocks military transit for the parties it binds: the plotted route avoids it, a destination inside it is refused (treaty), a plan a caller made through it is re-plotted, and a third power is not bound', () => {
  need();
  const env = treatyWorld('TX-2');
  addTerm(env, DMZ([IDX.Border, IDX.Archanis]));
  env.world.treatyBook = env.book;
  assert.deepEqual(C.plotJourney(env.world, IDX.Vega, IDX.Qonos, 'terran').path, [IDX.Romulus, IDX.Qonos]);
  assert.deepEqual(C.plotJourney(env.world, IDX.Qonos, IDX.Vega, 'klingon').path, [IDX.Romulus, IDX.Vega]);
  const [h] = make(env, 'terran', 91, IDX.Vega); park(env);
  const r = go(env, 'terran', [h], IDX.Border);
  assert.equal(r.ok, false); assert.equal(r.treaty, true); assert.match(r.reason, /treaty/);
  const r2 = go(env, 'terran', [h], IDX.Qonos, { plan: { path: [IDX.Border, IDX.Qonos], legDays: [10, 8] } });
  assert.ok(r2.ok); assert.deepEqual(r2.journey.path, [IDX.Romulus, IDX.Qonos]);
  assert.deepEqual(C.plotJourney(env.world, IDX.Vega, IDX.Qonos, 'romulan').path, [IDX.Border, IDX.Qonos], 'a third power was bound by a DMZ it is not party to');
  assert.ok(stats(env.book).dmzRoutesRefused >= 1);
});
test('new-feature', '3. civilian traffic is allowed where the treaty says so (an evacuation, a doctrine delivery) and refused where it says civilian traffic is prohibited', () => {
  need();
  const env = treatyWorld('TX-3');
  const t = addTerm(env, DMZ([IDX.Border]));
  env.world.treatyBook = env.book;
  assert.equal(C.trafficClassOf('evacuation', 'evacuate'), 'civilian'); assert.equal(C.trafficClassOf('doctrine', 'delivery'), 'civilian'); assert.equal(C.trafficClassOf('doctrine', 'patrol'), 'military');
  assert.deepEqual(C.plotJourney(env.world, IDX.Vega, IDX.Qonos, 'terran', null, null, { cls: 'civilian' }).path, [IDX.Border, IDX.Qonos]);
  const [h] = make(env, 'terran', 99, IDX.Vega); park(env);
  const r = C.startJourney(env.book, env.world, { kind: 'doctrine', sponsor: 'terran', hulls: [h], destination: IDX.Border, purpose: 'delivery', plan: { path: [IDX.Border], legDays: [10] } }, 1, []);
  assert.ok(r.ok, r.reason);
  t.status = 'ended';
  addTerm(env, DMZ([IDX.Border], { civilian: 'prohibited' }));
  assert.deepEqual(C.plotJourney(env.world, IDX.Vega, IDX.Qonos, 'terran', null, null, { cls: 'civilian' }).path, [IDX.Romulus, IDX.Qonos]);
});
test('new-feature', '4. compliant withdrawal: each side\'s warships standing in the zone when it starts are sent out by an ordinary journey, leave within the grace period, and are recorded withdrawn — no breach, no stationing incident after the grace', () => {
  need();
  const env = treatyWorld('TX-4');
  const [th] = make(env, 'terran', 91, IDX.Border); const [kh] = make(env, 'klingon', 97, IDX.Border); park(env);
  const t = addTerm(env, DMZ([IDX.Border], { graceDays: 10 }));
  assert.ok(th.transit && kh.transit, 'the warships in the zone were not sent out');
  assert.deepEqual(Object.values(t.withdrawal.hulls).map((w) => w.state).sort(), ['pending', 'pending']);
  run(env.book, env.world, 2, 30);
  assert.notEqual(th.systemIndex, IDX.Border); assert.notEqual(kh.systemIndex, IDX.Border);
  assert.deepEqual(Object.values(t.withdrawal.hulls).map((w) => w.state).sort(), ['withdrawn', 'withdrawn']);
  assert.equal(env.book.treatyIncidents.length, 0);
  assert.equal(stats(env.book).compliantWithdrawals, 2);
  log.withdrawal = { terran: th.systemIndex, klingon: kh.systemIndex, record: t.withdrawal };
});
test('new-feature', '5. a disabled hull in the zone is not a breach: it is listed stranded through the grace period, and a tug may go in and tow it out (recovery is not an offensive fleet)', () => {
  need();
  const env = treatyWorld('TX-5');
  const [hulk] = make(env, 'terran', 95, IDX.Border); const [tug] = make(env, 'terran', 90, IDX.Earth); park(env);
  hulk.hull = Math.max(1, Math.floor(hulk.maxHull * 0.05)); hulk.status = 'repairing';
  C.advanceStranded(env.book, env.world, 1, []);
  const t = addTerm(env, DMZ([IDX.Border], { graceDays: 5 }));
  assert.equal(t.withdrawal.hulls[hulk.id].state, 'stranded');
  run(env.book, env.world, 2, 12);
  assert.equal(env.book.treatyIncidents.length, 0, 'a stranded hulk was recorded as a breach');
  const req = C.requestHullRecovery(env.book, env.world, { sponsor: 'terran', targetHullId: hulk.id, tugHullId: tug.id }, 12, []);
  assert.ok(req.ok, req.reason);
  run(env.book, env.world, 13, 120);
  const rec = req.record;
  log.dmzTow = { state: rec.state, at: hulk.systemIndex, withdrawal: t.withdrawal.hulls[hulk.id] };
  assert.equal(rec.state, 'delivered_to_yard');
  assert.notEqual(hulk.systemIndex, IDX.Border);
  assert.ok(['withdrawn'].includes(t.withdrawal.hulls[hulk.id].state));
  assert.equal(env.book.treatyIncidents.length, 0);
});

// ===================================================================================================
// 6–10: transit guarantees and basing rights
// ===================================================================================================
test('new-feature', '6. a transit guarantee permits passage: with the DMZ on Border/Archanis, a terran warship to Khitomer goes Vega → Romulus → Qonos → Khitomer; with Klingon\'s guarantee through Archanis/Khitomer it goes Vega → Archanis → Khitomer; a doctrine authority treats the guaranteed vessel as exempt whatever the relation', () => {
  need();
  const env = treatyWorld('TX-6');
  addTerm(env, DMZ([IDX.Border, IDX.Archanis]));
  env.world.treatyBook = env.book;
  assert.deepEqual(C.plotJourney(env.world, IDX.Vega, IDX.Khitomer, 'terran').path, [IDX.Romulus, IDX.Qonos, IDX.Khitomer]);
  addTerm(env, { type: 'transit', grantor: 'klingon', beneficiary: 'terran', systems: [IDX.Archanis, IDX.Khitomer] });
  assert.deepEqual(C.plotJourney(env.world, IDX.Vega, IDX.Khitomer, 'terran').path, [IDX.Archanis, IDX.Khitomer]);
  assert.ok(!C.treatyBarred(env.book, 'terran', 'military').has(IDX.Archanis));
  assert.ok(C.treatyBarred(env.book, 'terran', 'military').has(IDX.Border));
  if (DC?.accessClassOf) {
    assert.equal(DC.accessClassOf(env.world, 'klingon', 'terran', true), 'warFlag');
    assert.equal(DC.accessClassOf(env.world, 'klingon', 'terran', true, env.book, IDX.Archanis), 'exempt');
    assert.equal(DC.accessClassOf(env.world, 'klingon', 'terran', true, env.book, IDX.Qonos), 'warFlag');
  }
});
test('new-feature', '7. a guarantee is not basing: a damaged terran warship at Qonos under a transit guarantee is not repaired by the Klingon yard (5 days), and basing at Qonos for repair repairs it', () => {
  need();
  const env = treatyWorld('TX-7');
  env.relations['terran:klingon'] = 'peace';
  const [h] = make(env, 'terran', 91, IDX.Qonos); park(env);
  h.hull = Math.round(h.maxHull * 0.7);
  addTerm(env, { type: 'transit', grantor: 'klingon', beneficiary: 'terran', systems: [IDX.Qonos] });
  run(env.book, env.world, 2, 6);
  assert.equal(h.hull, Math.round(h.maxHull * 0.7), 'a transit guarantee gave the yard to the guest');
  assert.equal(C.basingRightAt(env.book, env.world, 'terran', IDX.Qonos, 'repair'), null);
  addTerm(env, { type: 'basing', host: 'klingon', guest: 'terran', systems: [IDX.Qonos], purposes: ['repair'] }, 6);
  run(env.book, env.world, 7, 20);
  assert.ok(h.hull > Math.round(h.maxHull * 0.7), 'basing did not repair it');
  assert.ok(h.basedRepair?.termId);
});
test('new-feature', '8. basing is scoped to its purposes: resupply-only basing repairs nothing; repair basing does not make the yard a recovery yard (a stranded hulk there waits) until recovery is granted', () => {
  need();
  const env = treatyWorld('TX-8');
  env.relations['terran:klingon'] = 'peace';
  const [h] = make(env, 'terran', 91, IDX.Qonos); const [hulk] = make(env, 'terran', 95, IDX.Qonos); park(env);
  h.hull = Math.round(h.maxHull * 0.7);
  hulk.hull = Math.max(1, Math.floor(hulk.maxHull * 0.05)); hulk.status = 'repairing';
  C.advanceStranded(env.book, env.world, 1, []);
  addTerm(env, { type: 'basing', host: 'klingon', guest: 'terran', systems: [IDX.Qonos], purposes: ['resupply'] });
  run(env.book, env.world, 2, 6);
  assert.equal(h.hull, Math.round(h.maxHull * 0.7));
  addTerm(env, { type: 'basing', host: 'klingon', guest: 'terran', systems: [IDX.Qonos], purposes: ['repair'] }, 6);
  assert.equal(C.recoverStrandedHull(env.book, env.world, 'terran', hulk.id, 6).ok, false, 'repair basing made the yard a recovery yard');
  addTerm(env, { type: 'basing', host: 'klingon', guest: 'terran', systems: [IDX.Qonos], purposes: ['recovery'] }, 6);
  assert.equal(C.recoverStrandedHull(env.book, env.world, 'terran', hulk.id, 6).ok, true);
});
test('new-feature', '9. basing transfers nothing: after a basing repair, Qonos and its yard are Klingon\'s, both powers\' licences and design records are unchanged, every hull keeps its owner and identity', () => {
  need();
  const env = treatyWorld('TX-9');
  env.relations['terran:klingon'] = 'peace';
  const [h] = make(env, 'terran', 91, IDX.Qonos); park(env);
  h.hull = Math.round(h.maxHull * 0.5);
  h.status = 'assigned'; h.opId = 'hold'; // held there (it would otherwise sail for its own yard)
  const before = { controller: env.world.systems[IDX.Qonos].controller, owners: env.world.stationsBySystem(IDX.Qonos).map((s) => s.owner), lic: JSON.stringify([P(env.book, 'terran').licenses, P(env.book, 'klingon').licenses]), designs: JSON.stringify(env.book.designs), hulls: JSON.stringify(Object.fromEntries(Object.entries(env.book.polities).map(([k, p]) => [k, p.hulls.map((x) => vidOf(x)).sort()]))) };
  addTerm(env, { type: 'basing', host: 'klingon', guest: 'terran', systems: [IDX.Qonos], purposes: ['repair', 'resupply'] });
  h.status = 'ready'; h.opId = null; h.hull = Math.round(h.maxHull * 0.7);
  run(env.book, env.world, 2, 25);
  assert.ok(h.hull > Math.round(h.maxHull * 0.7));
  assert.equal(env.world.systems[IDX.Qonos].controller, before.controller);
  assert.deepEqual(env.world.stationsBySystem(IDX.Qonos).map((s) => s.owner), before.owners);
  assert.equal(JSON.stringify([P(env.book, 'terran').licenses, P(env.book, 'klingon').licenses]), before.lic);
  assert.equal(JSON.stringify(env.book.designs), before.designs);
  assert.equal(JSON.stringify(Object.fromEntries(Object.entries(env.book.polities).map(([k, p]) => [k, p.hulls.map((x) => vidOf(x)).sort()]))), before.hulls);
});
test('new-feature', '10. basing is not production: the guest\'s production account counts no yard or berth at the host\'s facility, and nothing is ever queued there', () => {
  need();
  const env = treatyWorld('TX-10');
  env.relations['terran:klingon'] = 'peace';
  const prod0 = C.politySummary(env.book, env.world, 'terran').production;
  addTerm(env, { type: 'basing', host: 'klingon', guest: 'terran', systems: [IDX.Qonos], purposes: ['repair', 'resupply', 'staging', 'docking', 'recovery'] });
  const prod1 = C.politySummary(env.book, env.world, 'terran').production;
  assert.deepEqual(prod1, prod0);
  P(env.book, 'terran').treasury = 2e6; P(env.book, 'terran').materials = 20000; P(env.book, 'terran').lastPlanDay = 0; env.book.config.planningIntervalDays = 1;
  run(env.book, env.world, 2, 30);
  assert.ok(!P(env.book, 'terran').queue.some((q) => Number(q.systemIndex) === IDX.Qonos), 'the guest queued production at the host yard');
});

// ===================================================================================================
// 11–14: inspections
// ===================================================================================================
const inspectionEnv = (seed) => {
  const env = treatyWorld(seed);
  env.relations['terran:klingon'] = 'peace';
  const t = addTerm(env, { type: 'inspection', inspector: 'klingon', inspected: 'terran', systems: [IDX.Border], traffic: ['military'], hullCategories: ['freighter'] });
  const [f] = make(env, 'terran', 99, IDX.Vega); park(env);
  return { ...env, t, f };
};
const CARGO = [{ cargoId: 'weapons', quantity: 5 }, { cargoId: 'spice', quantity: 3, concealed: true }];
test('new-feature', '11. a request reveals nothing: an inspection request the freighter cannot receive stays a request — no cargo observed, no refusal, no breach', () => {
  need();
  const env = inspectionEnv('TX-11');
  const r = C.treatyCrossing(env.book, env.world, { sponsor: 'terran', cls: 'military', at: IDX.Border, day: 3, key: 'k11', vids: [vidOf(env.f)], cargo: CARGO, categories: ['freighter'], canReceive: false }, []);
  assert.equal(r.inspections.length, 1);
  assert.equal(r.inspections[0].state, 'requested'); assert.equal(r.inspections[0].observed, null);
  assert.equal(env.book.treatyIncidents.length, 0);
});
test('new-feature', '12. an inspection reveals only what the regime allows: the declared hold (weapons ×5), never the concealed spice, never hulls or destination; a warship that is not a freighter is not inspected', () => {
  need();
  const env = inspectionEnv('TX-12');
  const r = go(env, 'terran', [env.f], IDX.Qonos, { meta: { cargo: CARGO, inspectionResponse: 'comply' }, purpose: 'move' });
  assert.ok(r.ok);
  run(env.book, env.world, 2, 12);
  const x = env.book.treatyInspections[0];
  assert.equal(x?.state, 'completed');
  assert.deepEqual(x.observed, { manifest: [{ cargoId: 'weapons', quantity: 5 }] });
  assert.deepEqual(x.history.map((h) => h.state), ['requested', 'completed']);
  const [w] = make(env, 'terran', 91, IDX.Vega);
  go(env, 'terran', [w], IDX.Qonos, {}, 12);
  run(env.book, env.world, 13, 24);
  assert.equal(env.book.treatyInspections.length, 1, 'a non-freighter was inspected');
  log.inspection = x;
});
test('new-feature', '13. a refusal is a breach incident: the freighter refuses, the inspection is recorded refused, an inspection_refused breach known to the inspector is filed, and passage is denied (turned back to Vega)', () => {
  need();
  const env = inspectionEnv('TX-13');
  go(env, 'terran', [env.f], IDX.Qonos, { meta: { cargo: CARGO, inspectionResponse: 'refuse' } });
  run(env.book, env.world, 2, 30);
  const x = env.book.treatyInspections[0];
  assert.equal(x.state, 'refused'); assert.equal(x.observed, null);
  const inc = env.book.treatyIncidents.find((y) => y.kind === 'inspection_refused');
  assert.ok(inc); assert.equal(inc.state, 'breach'); assert.equal(inc.breaching, 'terran'); assert.ok(inc.knownTo.includes('klingon'));
  assert.ok(env.t.breaches.includes(inc.id));
  assert.equal(env.f.systemIndex, IDX.Vega, 'passage was not denied');
});
test('new-feature', '14. a refusal is not war: after the refusal and 30 more days, no war is declared, no war state changes, the relation stands', () => {
  need();
  const env = inspectionEnv('TX-14');
  const before = warSnapshot(env.book);
  go(env, 'terran', [env.f], IDX.Qonos, { meta: { cargo: CARGO, inspectionResponse: 'refuse' } });
  const eff = run(env.book, env.world, 2, 45);
  assert.ok(env.book.treatyIncidents.some((y) => y.kind === 'inspection_refused'));
  assert.equal(wars(eff).length, 0); assert.equal(warSnapshot(env.book), before);
  assert.equal(env.world.relation('terran', 'klingon'), 'peace');
  assert.ok(env.book.treatyIncidents.every((y) => y.warDeclared === false));
});

// ===================================================================================================
// 15–19: tribute and reparations
// ===================================================================================================
const twin = (seed) => { const a = treatyWorld(seed), b = treatyWorld(seed); return { a, b }; };
test('new-feature', '15. a tribute payment moves exactly the amount between the treasuries on its due day (against a twin book without the term), is in the ledger and clears the installment', () => {
  need();
  const { a, b } = twin('TX-15');
  addTerm(a, { type: 'tribute', payer: 'klingon', recipient: 'terran', amount: 5000, cadenceDays: 30 });
  run(a.book, a.world, 2, 31); run(b.book, b.world, 2, 31);
  assert.equal(P(b.book, 'klingon').treasury - P(a.book, 'klingon').treasury, 5000);
  assert.equal(P(a.book, 'terran').treasury - P(b.book, 'terran').treasury, 5000);
  const t = a.book.treatyTerms[0];
  assert.equal(t.paidTotal, 5000); assert.equal(t.arrears, 0); assert.equal(t.nextDue, 61);
  assert.deepEqual(a.book.treatyLedger.map((e) => [e.day, e.amount, e.status]), [[31, 5000, 'paid']]);
});
test('new-feature', '16. a missed tribute is arrears and a breach: the payer cannot pay on the due day — 5,000 L in arrears, a payment_missed breach known to the recipient (the ledger is the evidence)', () => {
  need();
  const env = treatyWorld('TX-16');
  const t = addTerm(env, { type: 'tribute', payer: 'klingon', recipient: 'terran', amount: 5000, cadenceDays: 30 });
  run(env.book, env.world, 2, 30);
  P(env.book, 'klingon').treasury = -500000;
  run(env.book, env.world, 31, 31);
  assert.equal(t.arrears, 5000); assert.equal(t.missedCount, 1);
  const inc = env.book.treatyIncidents.find((x) => x.kind === 'payment_missed');
  assert.ok(inc); assert.equal(inc.state, 'breach'); assert.deepEqual(inc.knownTo.sort(), ['klingon', 'terran']);
  assert.deepEqual(inc.evidence.map((e) => e.type), ['ledger']);
});
test('new-feature', '17. a missed tribute is not war, and a later payment clears it: 30 days on, no war is declared; once the payer can pay, the arrears are paid first and the incident is resolved', () => {
  need();
  const env = treatyWorld('TX-17');
  const t = addTerm(env, { type: 'tribute', payer: 'klingon', recipient: 'terran', amount: 5000, cadenceDays: 30 });
  const before = warSnapshot(env.book);
  let eff = run(env.book, env.world, 2, 30);
  P(env.book, 'klingon').treasury = -500000;
  eff = eff.concat(run(env.book, env.world, 31, 40));
  assert.equal(wars(eff).length, 0); assert.equal(warSnapshot(env.book), before);
  P(env.book, 'klingon').treasury = 100000;
  run(env.book, env.world, 41, 41);
  assert.equal(t.arrears, 0);
  assert.equal(env.book.treatyIncidents.find((x) => x.kind === 'payment_missed').state, 'resolved');
  assert.deepEqual(env.book.treatyLedger.map((e) => [e.day, e.status, e.amount]), [[31, 'missed', 5000], [41, 'paid', 5000]]);
});
test('new-feature', '18. reparations decrement: 20,000 L over 4 payments every 10 days — after two payments 10,000 L remain', () => {
  need();
  const env = treatyWorld('TX-18');
  const t = addTerm(env, { type: 'reparations', payer: 'terran', recipient: 'klingon', total: 20000, payments: 4, cadenceDays: 10 });
  run(env.book, env.world, 2, 21);
  assert.equal(t.remaining, 10000); assert.equal(t.paidCount, 2); assert.equal(t.status, 'active');
});
test('new-feature', '19. reparations end: the fourth payment completes them — the term ends "paid in full", and nothing more is ever taken', () => {
  need();
  const env = treatyWorld('TX-19');
  const t = addTerm(env, { type: 'reparations', payer: 'terran', recipient: 'klingon', total: 20000, payments: 4, cadenceDays: 10 });
  run(env.book, env.world, 2, 41);
  assert.equal(t.remaining, 0); assert.equal(t.status, 'ended'); assert.equal(t.endReason, 'paid in full');
  run(env.book, env.world, 42, 90);
  assert.equal(env.book.treatyLedger.filter((e) => e.termId === t.id).length, 4);
  assert.equal(stats(env.book).reparationsCompleted, 1);
});

// ===================================================================================================
// 20–24: persistence, knowledge, boundaries
// ===================================================================================================
test('new-feature', '20. save/load keeps every term, incident and ledger entry — ids, states, arrears, withdrawal records — and a reloaded book steps to the same checksum as the one kept in memory', () => {
  need();
  const mk = () => { const e = treatyWorld('TX-20'); const [kh] = make(e, 'klingon', 97, IDX.Border); park(e); addTerm(e, DMZ([IDX.Border])); addTerm(e, { type: 'tribute', payer: 'klingon', recipient: 'terran', amount: 5000, cadenceDays: 15 }); addTerm(e, { type: 'reparations', payer: 'terran', recipient: 'klingon', total: 9000, payments: 3, cadenceDays: 20 }); return e; };
  const a = mk(), b = mk();
  run(a.book, a.world, 2, 16); run(b.book, b.world, 2, 16);
  const saved = JSON.stringify({ t: b.book.treatyTerms, i: b.book.treatyIncidents, l: b.book.treatyLedger });
  b.book = reload(b.book); C.upgradeCampaignBook(a.book); // the engine upgrades every book it touches; only the reload differs
  assert.equal(JSON.stringify({ t: b.book.treatyTerms, i: b.book.treatyIncidents, l: b.book.treatyLedger }), saved);
  run(a.book, a.world, 17, 70); run(b.book, b.world, 17, 70);
  assert.equal(C.checksum(a.book), C.checksum(b.book));
  assert.deepEqual(b.book.treatyTerms.map((t) => t.id), a.book.treatyTerms.map((t) => t.id));
});
test('new-feature', '21. a secret term stays hidden: only its parties see it, its history entry is hidden from everyone else, and using it (a terran warship passing Archanis under it, a Romulan ship watching there) files nothing a non-party can read', () => {
  need();
  const env = treatyWorld('TX-21');
  addTerm(env, DMZ([IDX.Border, IDX.Archanis]));
  const g = addTerm(env, { type: 'transit', grantor: 'klingon', beneficiary: 'terran', systems: [IDX.Archanis, IDX.Khitomer], secret: true });
  assert.ok(C.treatyViewFor(env.book, 'terran').terms.includes(g));
  assert.ok(!C.treatyViewFor(env.book, 'romulan').terms.includes(g)); assert.ok(!C.treatyViewFor(env.book, 'player').terms.includes(g));
  assert.ok(!C.visibleHistory(env.book, 'player').some((h) => h.termId === g.id));
  const [h] = make(env, 'terran', 91, IDX.Vega); const [rom] = make(env, 'romulan', 30, IDX.Archanis); park(env);
  const r = go(env, 'terran', [h], IDX.Khitomer);
  assert.ok(r.ok); assert.deepEqual(r.journey.path, [IDX.Archanis, IDX.Khitomer]);
  run(env.book, env.world, 2, 20);
  assert.equal(h.systemIndex, IDX.Khitomer);
  assert.equal(C.treatyViewFor(env.book, 'romulan').incidents.length, 0);
  assert.equal(C.treatyViewFor(env.book, 'romulan').terms.filter((t) => t.secret).length, 0);
  assert.ok(rom);
});
test('new-feature', '22. a known term is in the captain\'s view (Wars & Treaties reads treatyViewFor): a public DMZ between the empire and Klingon and a basing right for the empire, each with its status', () => {
  need();
  const env = treatyWorld('TX-22');
  C.ensurePolity(env.book, 'player');
  const d = addTerm(env, { type: 'dmz', parties: ['player', 'klingon'], systems: [IDX.Border] });
  const b = addTerm(env, { type: 'basing', host: 'klingon', guest: 'player', systems: [IDX.Qonos], purposes: ['repair'] });
  const v = C.treatyViewFor(env.book, 'player');
  assert.ok(v.terms.includes(d) && v.terms.includes(b));
  assert.equal(v.status(d), 'active');
  assert.match(TT.termHeadline(d), /DMZ — Military transit prohibited/);
});
test('new-feature', '23. a DMZ breach needs evidence: a terran warship sent through Minor in defiance with no Klingon able to see it is a breach only Terran knows of; with a Klingon ship on station there, the next one is warned (and both know)', () => {
  need();
  const env = treatyWorld('TX-23');
  const t = addTerm(env, DMZ([IDX.Minor]));
  const [h] = make(env, 'terran', 91, IDX.Vega); park(env);
  go(env, 'terran', [h], IDX.Cardassia, { treatyDefy: true, meta: { treatyResponse: 'refuse' }, plan: { path: [IDX.Minor, IDX.Cardassia], legDays: [11, 9] } });
  run(env.book, env.world, 2, 14);
  const x1 = env.book.treatyIncidents[0];
  assert.ok(x1); assert.equal(x1.kind, 'dmz_entry'); assert.deepEqual(x1.knownTo, ['terran']); assert.deepEqual(x1.evidence, []);
  assert.equal(C.treatyViewFor(env.book, 'klingon').incidents.length, 0);
  const [kh] = make(env, 'klingon', 97, IDX.Minor);
  t.withdrawal.hulls[kh.id] = { polity: 'klingon', vid: vidOf(kh), systemIndex: IDX.Minor, since: 1e9, state: 'breach' }; // its own stationing is not this check
  const [h2] = make(env, 'terran', 91, IDX.Vega);
  go(env, 'terran', [h2], IDX.Cardassia, { treatyDefy: true, meta: { treatyResponse: 'refuse' }, plan: { path: [IDX.Minor, IDX.Cardassia], legDays: [11, 9] } }, 14);
  run(env.book, env.world, 15, 28);
  const x2 = env.book.treatyIncidents.find((x) => x.assets.includes(vidOf(h2)));
  assert.ok(x2); assert.equal(x2.state, 'breach'); assert.ok(x2.knownTo.includes('klingon')); assert.deepEqual(x2.evidence.map((e) => e.by), ['klingon']);
  assert.equal(x2.responses[0].state, 'warned');
});
test('new-feature', '24. a treaty ending mid-route is met at the next boundary: the guarantee through Archanis lapses while the warship flies Earth → Vega; at Vega the rest is re-plotted round the DMZ (Romulus, Qonos), it is at Vega on the day the leg ends (no teleport) and the leg flown is untouched', () => {
  need();
  const env = treatyWorld('TX-24');
  addTerm(env, DMZ([IDX.Border, IDX.Archanis]));
  addTerm(env, { type: 'transit', grantor: 'klingon', beneficiary: 'terran', systems: [IDX.Archanis], endDay: 5 });
  const [h] = make(env, 'terran', 91, IDX.Earth); park(env);
  const r = go(env, 'terran', [h], IDX.Khitomer);
  assert.deepEqual(r.journey.path, [IDX.Vega, IDX.Archanis, IDX.Khitomer]);
  run(env.book, env.world, 2, 13);
  const first = r.journey;
  assert.equal(first.status, 'superseded');
  assert.deepEqual(first.legDays.slice(0, 1), [12]);
  assert.equal(h.systemIndex, IDX.Vega);
  const next = C.activeJourneys(env.book).find((j) => j.members.includes(h.id));
  assert.ok(next); assert.deepEqual(next.path, [IDX.Romulus, IDX.Qonos, IDX.Khitomer]); assert.equal(next.from, IDX.Vega); assert.equal(next.legDepartDay, 13);
  assert.equal(env.book.treatyIncidents.length, 0);
  log.midRoute = { first: { path: first.path, legDays: first.legDays, crossed: first.crossed }, next: { path: next.path, legDays: next.legDays } };
});

// ===================================================================================================
// 25–31: blockades, doctrine, flags, inheritance, the Dominion pact
// ===================================================================================================
test('new-feature', '25. an illegal blockade is closed, not left running: a terran blockade of Border closes the day a DMZ binding Terran covers it, a new one there is refused under treaty, and a blockade clause lifts a named one (Klingon\'s of Minor)', () => {
  need();
  const env = treatyWorld('TX-25');
  const hs = make(env, 'terran', 91, IDX.Border, 3); const ks = make(env, 'klingon', 97, IDX.Minor, 3); park(env);
  const b1 = C.startBlockade(env.book, env.world, { power: 'terran', target: IDX.Border, hullIds: hs.map((h) => h.id) }, 1, []);
  const b2 = C.startBlockade(env.book, env.world, { power: 'klingon', target: IDX.Minor, hullIds: ks.map((h) => h.id) }, 1, []);
  assert.ok(b1.ok && b2.ok); assert.equal(b1.record.status, 'active'); assert.equal(b2.record.status, 'active');
  addTerm(env, DMZ([IDX.Border]), 2);
  assert.equal(b1.record.status, 'closed'); assert.match(b1.record.endReason, /treaty/);
  const again = C.startBlockade(env.book, env.world, { power: 'terran', target: IDX.Border, hullIds: [hs[0].id] }, 3, []);
  assert.equal(again.ok, false); assert.match(again.reason, /Treaty/);
  addTerm(env, { type: 'blockade_lift', parties: ['klingon', 'terran'], blockadeIds: [b2.record.id] }, 3);
  assert.equal(b2.record.status, 'closed');
  assert.equal(stats(env.book).blockadeClosures, 2);
});
test('new-feature', '26. obstructing a guaranteed transit is a recorded breach, not silent hostility: a Klingon blockade of Vega lets the guaranteed terran convoy through; ordered to obstruct anyway, its run is a transit_obstructed breach known to Terran — and no war state changes', () => {
  need();
  const env = treatyWorld('TX-26');
  const ks = make(env, 'klingon', 97, IDX.Vega, 3); park(env);
  env.book.config.minReadinessRatioToAttack = 1e9; // the blockade holds for the length of the test (it never judges Vega weak enough)
  const b = C.startBlockade(env.book, env.world, { power: 'klingon', target: IDX.Vega, hullIds: ks.map((h) => h.id) }, 1, []);
  assert.ok(b.ok, b.reason);
  addTerm(env, { type: 'transit', grantor: 'klingon', beneficiary: 'terran', systems: [IDX.Vega] });
  const before = warSnapshot(env.book);
  const [h] = make(env, 'terran', 91, IDX.Earth);
  const r = go(env, 'terran', [h], IDX.Romulus);
  let eff = run(env.book, env.world, 2, 14);
  assert.equal(b.record.status, 'active');
  assert.equal(r.journey.encounters.length, 0, 'the guaranteed convoy was intercepted');
  b.record.treatyDefy = true;
  const [h2] = make(env, 'terran', 91, IDX.Earth);
  const r2 = go(env, 'terran', [h2], IDX.Romulus, {}, 14);
  eff = eff.concat(run(env.book, env.world, 15, 28));
  assert.equal(r2.journey.encounters.length, 1);
  const x = env.book.treatyIncidents.find((y) => y.kind === 'transit_obstructed');
  assert.ok(x); assert.equal(x.breaching, 'klingon'); assert.ok(x.knownTo.includes('terran')); assert.equal(x.state, 'breach');
  assert.equal(wars(eff).length, 0); assert.equal(warSnapshot(env.book), before);
});
test('new-feature', '27. doctrine enforces only terms it knows: a secret DMZ on Minor monitored by Cardassia (an enforcer that was not told of it) — a terran ship sent through is unobserved; told of it, Cardassia warns the next one', () => {
  need();
  const env = treatyWorld('TX-27');
  const t = addTerm(env, { type: 'dmz', parties: ['terran', 'klingon'], systems: [IDX.Minor], secret: true, enforcers: ['klingon', 'cardassian'] });
  assert.ok(!t.knownTo.includes('cardassian'));
  const [h] = make(env, 'terran', 91, IDX.Vega); park(env);
  go(env, 'terran', [h], IDX.Cardassia, { treatyDefy: true, meta: { treatyResponse: 'comply' }, plan: { path: [IDX.Minor, IDX.Cardassia], legDays: [11, 9] } });
  run(env.book, env.world, 2, 14);
  const x1 = env.book.treatyIncidents[0];
  assert.deepEqual(x1.knownTo, ['terran'], 'an enforcer acted on a term it does not know');
  t.knownTo.push('cardassian');
  const [h2] = make(env, 'terran', 91, IDX.Vega);
  go(env, 'terran', [h2], IDX.Cardassia, { treatyDefy: true, meta: { treatyResponse: 'comply' }, plan: { path: [IDX.Minor, IDX.Cardassia], legDays: [11, 9] } }, 14);
  run(env.book, env.world, 15, 40);
  const x2 = env.book.treatyIncidents.find((x) => x.assets.includes(vidOf(h2)));
  assert.equal(x2.state, 'complied'); assert.ok(x2.knownTo.includes('cardassian'));
  assert.equal(h2.systemIndex, IDX.Vega, 'the warned ship did not turn back');
});
test('new-feature', '28. static hostility does not override a guarantee: at war (the most hostile relation there is), Klingon\'s guarantee still opens Archanis to Terran, its blockade still lets the beneficiary through, and its border authority classes the vessel exempt', () => {
  need();
  const env = treatyWorld('TX-28');
  assert.equal(env.world.relation('terran', 'klingon'), 'war');
  addTerm(env, DMZ([IDX.Archanis]));
  addTerm(env, { type: 'transit', grantor: 'klingon', beneficiary: 'terran', systems: [IDX.Archanis] });
  env.world.treatyBook = env.book;
  assert.deepEqual(C.plotJourney(env.world, IDX.Vega, IDX.Khitomer, 'terran').path, [IDX.Archanis, IDX.Khitomer]);
  const ks = make(env, 'klingon', 97, IDX.Archanis, 1); park(env);
  const fake = { id: 'b-x', status: 'active', power: 'klingon', target: IDX.Vega, warKey: null };
  assert.equal(C.blockadeApplies(env.book, env.world, fake, 'terran'), true);
  addTerm(env, { type: 'transit', grantor: 'klingon', beneficiary: 'terran', systems: [IDX.Vega] });
  assert.equal(C.blockadeApplies(env.book, env.world, fake, 'terran'), false);
  if (DC?.accessClassOf) assert.equal(DC.accessClassOf(env.world, 'klingon', 'terran', true, env.book, IDX.Archanis), 'exempt');
  assert.ok(ks.length);
});
test('new-feature', '29. the same flag does not bypass a restriction: the captain\'s empire flies the Terran flag, but a guarantee to Terran does not open the DMZ to his empire, and a DMZ that names his empire binds it whatever flag he flies', () => {
  need();
  const env = treatyWorld('TX-29', { playerFaction: 'terran' });
  env.world.playerRelationSide = 'terran';
  C.ensurePolity(env.book, 'player');
  addTerm(env, { type: 'dmz', parties: ['player', 'terran', 'klingon'], restricted: ['player', 'terran', 'klingon'], systems: [IDX.Archanis] });
  addTerm(env, { type: 'transit', grantor: 'klingon', beneficiary: 'terran', systems: [IDX.Archanis] });
  assert.ok(!C.treatyBarred(env.book, 'terran', 'military').has(IDX.Archanis));
  assert.ok(C.treatyBarred(env.book, 'player', 'military').has(IDX.Archanis), 'the captain\'s empire rode on Terran\'s guarantee by flag');
});
test('new-feature', '30. the captain\'s empire inherits no obligation it is not party to: the Terran–Klingon ceasefire binds his inherited war (it becomes a ceasefire) but its DMZ and tribute bind only Terran and Klingon — his routes, treasury and view of obligations are untouched', () => {
  need();
  const env = treatyWorld('TX-30');
  C.ensurePolity(env.book, 'player');
  env.world.warPairs = () => [{ a: 'klingon', b: 'terran', status: 'war', warId: 'w-kt', warStarted: 1 }, { a: 'klingon', b: 'player', status: 'war', warId: 'w-kp', warStarted: 1, inheritedFrom: 'terran' }];
  const eff = C.forceWarTransition(env.book, env.world, 'terran', 'klingon', 'ceasefire', 1, 'test', 'directed', { treaty: [{ type: 'dmz', parties: ['terran', 'klingon'], systems: [IDX.Border] }, { type: 'tribute', payer: 'klingon', recipient: 'terran', amount: 5000, cadenceDays: 30 }] });
  const main = eff.find((e) => e.type === 'warCeasefire' && e.key === 'klingon:terran');
  assert.ok(main.alsoBinds.includes('klingon:player'), 'precondition: the captain\'s inherited war is bound');
  assert.equal(env.book.warStates['klingon:player'].status, 'ceasefire');
  assert.equal(env.book.treatyTerms.length, 2);
  assert.ok(env.book.treatyTerms.every((t) => !t.parties.includes('player')));
  assert.equal(C.treatyBarred(env.book, 'player', 'military').size, 0);
  assert.deepEqual(env.book.warStates['klingon:terran'].treatyTerms, env.book.treatyTerms.map((t) => t.id));
  assert.equal(env.book.warStates['klingon:player'].treatyTerms, undefined);
});
test('preservation', '31. the secret Dominion pact is unchanged: activating it gives the same secret record (knownTo empty), the same partners, hidden history; treaty terms neither read nor change it', () => {
  const env = treatyWorld('TX-31');
  env.relations['cardassian:dominion'] = 'peace';
  const r = C.activatePact(env.book, env.world, 'dominion', 'cardassian', 1, []);
  assert.ok(r.ok, r.reason);
  const rec = JSON.stringify(env.book.treaties);
  assert.deepEqual(C.activePacts(env.book, 'dominion'), ['cardassian']);
  assert.equal(r.record.secret, true); assert.deepEqual(r.record.knownTo, []);
  assert.equal(C.visibleHistory(env.book, 'player').filter((h) => h.secretOf).length, 0);
  if (C.addTreatyTerm) {
    addTerm(env, { type: 'dmz', parties: ['dominion', 'cardassian'], systems: [IDX.Bajora] });
    run(env.book, env.world, 2, 10);
    assert.equal(JSON.stringify(env.book.treaties), rec);
    assert.deepEqual(C.activePacts(env.book, 'dominion'), ['cardassian']);
    assert.ok(!(env.book.treatyTerms || []).some((t) => t.kind === 'pact'));
  }
});

// ===================================================================================================
// Review regressions (R1–R7)
// ===================================================================================================
test('new-feature', 'R1. a warship sent out of a DMZ whose withdrawal is re-plotted on the way is still released where it ends up (its order is the journey reference, not one journey id)', () => {
  need();
  const env = treatyWorld('TX-R1');
  const [kh] = make(env, 'klingon', 97, IDX.Border); park(env);
  addTerm(env, DMZ([IDX.Border]));
  const tr = C.activeJourneys(env.book).find((j) => j.members.includes(kh.id));
  assert.ok(tr); assert.equal(kh.opId, tr.ref);
  tr.pending = { destination: tr.destination, purpose: tr.purpose, day: 1 }; // a re-plot at its first boundary
  run(env.book, env.world, 2, 80);
  assert.equal(C.activeJourneys(env.book).filter((j) => j.members.includes(kh.id)).length, 0);
  assert.equal(kh.status, 'ready'); assert.equal(kh.opId, null);
});
test('new-feature', 'R2. a refused inspection never sets a ship bouncing for ever: going back the way it came is not inspected again, and a repeat refusal by the same ship at the same point within 30 days is the same incident', () => {
  need();
  const env = treatyWorld('TX-R2');
  env.relations['terran:klingon'] = 'peace';
  addTerm(env, { type: 'inspection', inspector: 'klingon', inspected: 'terran', systems: [IDX.Border, IDX.Qonos], traffic: ['military'] });
  const [h] = make(env, 'terran', 91, IDX.Border); park(env);
  go(env, 'terran', [h], IDX.Khitomer, { meta: { inspectionResponse: 'refuse' } });
  run(env.book, env.world, 2, 300);
  assert.ok(env.book.treatyInspections.length <= 2, `${env.book.treatyInspections.length} inspections`);
  assert.ok(env.book.treatyIncidents.length <= 2, `${env.book.treatyIncidents.length} incidents`);
  assert.equal(C.activeJourneys(env.book).filter((j) => j.members.includes(h.id)).length, 0, 'still moving after 300 days');
});
test('new-feature', 'R3. a ship that left the zone and comes back is a new presence: ordered out again and, kept there past its grace, a stationing breach', () => {
  need();
  const env = treatyWorld('TX-R3');
  const [th] = make(env, 'terran', 91, IDX.Border); park(env);
  const t = addTerm(env, DMZ([IDX.Border], { graceDays: 5 }));
  run(env.book, env.world, 2, 20);
  assert.equal(t.withdrawal.hulls[th.id].state, 'withdrawn');
  th.systemIndex = IDX.Border; th.status = 'assigned'; th.opId = 'held-there'; // put back and held there by some other order
  run(env.book, env.world, 21, 30);
  assert.equal(t.withdrawal.hulls[th.id].returned, 1);
  assert.ok(env.book.treatyIncidents.some((x) => x.kind === 'dmz_stationing' && x.assets.includes(vidOf(th))));
});
test('new-feature', 'R4. a guarantee covers only the traffic it names: a civilian-only guarantee does not open the grantor\'s blockade or its border to warships', () => {
  need();
  const env = treatyWorld('TX-R4');
  addTerm(env, { type: 'transit', grantor: 'klingon', beneficiary: 'terran', systems: [IDX.Vega], traffic: ['civilian'] });
  const fake = { id: 'b-x', status: 'active', power: 'klingon', target: IDX.Vega, warKey: null };
  assert.equal(C.blockadeApplies(env.book, env.world, fake, 'terran'), true);
  assert.equal(C.blockadeApplies(env.book, env.world, fake, 'terran', 'civilian'), false);
  if (DC?.accessClassOf) assert.equal(DC.accessClassOf(env.world, 'klingon', 'terran', true, env.book, IDX.Vega, 'military'), 'warFlag');
});
test('new-feature', 'R5. a blockade clause also forbids a new blockade at the systems it names (it is not re-laid only to be lifted the next day)', () => {
  need();
  const env = treatyWorld('TX-R5');
  const ks = make(env, 'klingon', 97, IDX.Minor, 3); park(env);
  addTerm(env, { type: 'blockade_lift', parties: ['klingon', 'terran'], systems: [IDX.Minor] });
  const r = C.startBlockade(env.book, env.world, { power: 'klingon', target: IDX.Minor, hullIds: ks.map((h) => h.id) }, 1, []);
  assert.equal(r.ok, false); assert.match(r.reason, /Treaty/);
});
test('new-feature', 'R6. a fixed run of tribute (3 × 1,000 L) takes exactly 3,000 L in all, a late-paid installment counting once', () => {
  need();
  const env = treatyWorld('TX-R6');
  const t = addTerm(env, { type: 'tribute', payer: 'klingon', recipient: 'terran', amount: 1000, cadenceDays: 10, installments: 3 });
  run(env.book, env.world, 2, 10);
  P(env.book, 'klingon').treasury = -500000;
  run(env.book, env.world, 11, 15);
  P(env.book, 'klingon').treasury = 500000;
  run(env.book, env.world, 16, 90);
  assert.equal(t.paidTotal, 3000); assert.equal(t.status, 'ended');
  assert.equal(env.book.treatyLedger.filter((e) => e.status === 'paid').reduce((n, e) => n + e.amount, 0), 3000);
});
test('new-feature', 'R7. a negotiated settlement (no winner) reads a symmetric clause (a DMZ) but refuses a bare "tribute" clause that would pick a payer by key order', () => {
  need();
  const env = treatyWorld('TX-R7');
  C.forceWarTransition(env.book, env.world, 'terran', 'klingon', 'ceasefire', 1, 'test', 'directed', { treaty: ['add DMZ systems Border', 'tribute 5000 every 30 days'] });
  assert.deepEqual(env.book.treatyTerms.map((t) => t.type), ['dmz']);
  assert.equal(stats(env.book).termsRefused, 1);
  C.forceWarTransition(env.book, env.world, 'terran', 'romulan', 'ceasefire', 1, 'test', 'directed', { treaty: [{ clause: 'tribute 5000 every 30 days', by: 'romulan', to: 'terran' }] });
  assert.equal(env.book.treatyTerms.find((t) => t.type === 'tribute')?.payer, 'romulan');
});

// ===================================================================================================
// 32–33: the existing suites
// ===================================================================================================
const suite = (name, script) => test('preservation', `${name}: ${script} green`, () => {
  if (skipSuites) return;
  const r = spawnSync(process.execPath, [path.join(root, 'scripts', script)], { cwd: root, encoding: 'utf8', timeout: 600000, env: { ...process.env, BM1_TEST_OUTPUT: '' } });
  const last = String(r.stdout || '').trim().split('\n').pop();
  (log.suites ||= {})[script] = last;
  assert.equal(r.status, 0, `${script} failed: ${last}\n${String(r.stderr || '').slice(0, 400)}`);
});
for (const s of ['war-peace-test.mjs', 'dominion-war-test.mjs', 'campaign-strategy-test.mjs']) suite('32. war/ceasefire/peace', s);
for (const s of ['strategic-movement-test.mjs', 'blockade-running-test.mjs', 'evac-blockade-test.mjs', 'formation-route-test.mjs', 'doctrine-phase4-test.mjs', 'doctrine-phase3-test.mjs', 'ship-strategic-speed-test.mjs', 'towing-salvage-test.mjs']) suite('33. movement/blockade/doctrine/towing', s);

// ===================================================================================================
// Integrated scenarios
// ===================================================================================================
function dmzSettlement(seed, response) {
  const env = treatyWorld(seed);
  const [kh] = make(env, 'klingon', 97, IDX.Border); const [th] = make(env, 'terran', 91, IDX.Border); park(env);
  const eff0 = C.forceWarTransition(env.book, env.world, 'terran', 'klingon', 'ceasefire', 1, 'the front is exhausted', 'directed', { treaty: ['add DMZ systems Border/Archanis'] });
  env.relations['terran:klingon'] = 'ceasefire';
  const before = warSnapshot(env.book);
  const t = env.book.treatyTerms[0];
  let eff = eff0.concat(run(env.book, env.world, 2, 20));
  const withdrawn = Object.values(t.withdrawal.hulls).map((w) => w.state);
  const [f] = make(env, 'terran', 91, IDX.Vega);
  const r = go(env, 'terran', [f], IDX.Qonos, { treatyDefy: true, meta: { treatyResponse: response } }, 20);
  eff = eff.concat(run(env.book, env.world, 21, 60));
  return { env, t, kh, th, f, r, withdrawn, before, eff };
}
test('new-feature', 'DMZ-SETTLEMENT (comply). war ends in a ceasefire with a Border/Archanis DMZ; both sides withdraw; a terran fleet sent through is warned at Border and complies (turned back to Vega); no breach, no war restart', () => {
  need();
  const s = dmzSettlement('TX-S1', 'comply');
  assert.deepEqual(s.withdrawn, ['withdrawn', 'withdrawn']);
  assert.ok(![IDX.Border, IDX.Archanis].includes(s.kh.systemIndex) && ![IDX.Border, IDX.Archanis].includes(s.th.systemIndex));
  const x = s.env.book.treatyIncidents.find((y) => y.kind === 'dmz_entry');
  assert.equal(x.state, 'complied'); assert.deepEqual(x.responses.map((r) => r.state), ['warned', 'complied']);
  assert.equal(s.f.systemIndex, IDX.Vega);
  assert.equal(s.t.breaches.length, 0);
  assert.equal(wars(s.eff).length, 0); assert.equal(noNewWar(s.env.book, s.before), true);
  assert.notEqual(s.env.book.warStates['klingon:terran'].status, 'war');
  log.dmzSettlementComply = { incident: x, fleetAt: s.f.systemIndex };
});
test('new-feature', 'DMZ-SETTLEMENT (refuse). the same fleet refuses the warning: a dmz_entry breach known to Klingon, the fleet goes on to Qonos, and the ceasefire stands — no war declared, no war objective reactivated, no operation launched', () => {
  need();
  const s = dmzSettlement('TX-S2', 'refuse');
  const x = s.env.book.treatyIncidents.find((y) => y.kind === 'dmz_entry');
  assert.equal(x.state, 'breach'); assert.deepEqual(x.responses.map((r) => r.state), ['warned', 'breach']); assert.ok(x.knownTo.includes('klingon'));
  assert.ok(s.t.breaches.includes(x.id));
  assert.equal(s.f.systemIndex, IDX.Qonos);
  assert.equal(wars(s.eff).length, 0); assert.equal(noNewWar(s.env.book, s.before), true);
  assert.notEqual(s.env.book.warStates['klingon:terran'].status, 'war');
  assert.equal(s.env.book.operations.filter((o) => o.status !== 'resolved').length, 0);
  log.dmzSettlementRefuse = { incident: x };
});
test('new-feature', 'TRANSIT-AND-BASING. a guarantee through Archanis/Khitomer/Qonos: the warship flies Vega → Archanis → Khitomer; damaged, the Klingon yard at Qonos will not repair it; with basing for repair it does; Qonos, its yard, licences and designs are unchanged', () => {
  need();
  const env = treatyWorld('TX-S3');
  env.relations['terran:klingon'] = 'ceasefire';
  addTerm(env, DMZ([IDX.Border, IDX.Archanis]));
  addTerm(env, { type: 'transit', grantor: 'klingon', beneficiary: 'terran', systems: [IDX.Archanis, IDX.Khitomer, IDX.Qonos] });
  const [h] = make(env, 'terran', 91, IDX.Vega); park(env);
  const r = go(env, 'terran', [h], IDX.Khitomer);
  assert.deepEqual(r.journey.path, [IDX.Archanis, IDX.Khitomer]);
  run(env.book, env.world, 2, 13);
  assert.equal(h.systemIndex, IDX.Khitomer);
  const go2 = go(env, 'terran', [h], IDX.Qonos, {}, 13);
  run(env.book, env.world, 14, 19);
  assert.equal(h.systemIndex, IDX.Qonos); assert.ok(go2.ok);
  h.hull = Math.round(h.maxHull * 0.7); h.status = 'ready'; h.opId = null;
  const frozen = { owners: env.world.stationsBySystem(IDX.Qonos).map((s) => s.owner), lic: JSON.stringify(P(env.book, 'klingon').licenses), designs: JSON.stringify(env.book.designs) };
  run(env.book, env.world, 20, 24);
  assert.equal(h.hull, Math.round(h.maxHull * 0.7), 'repaired without basing');
  addTerm(env, { type: 'basing', host: 'klingon', guest: 'terran', systems: [IDX.Qonos], purposes: ['repair', 'resupply'] }, 24);
  run(env.book, env.world, 25, 40);
  assert.equal(h.hull, h.maxHull);
  assert.equal(env.world.systems[IDX.Qonos].controller, 'klingon');
  assert.deepEqual(env.world.stationsBySystem(IDX.Qonos).map((s) => s.owner), frozen.owners);
  assert.equal(JSON.stringify(P(env.book, 'klingon').licenses), frozen.lic); assert.equal(JSON.stringify(env.book.designs), frozen.designs);
  log.transitAndBasing = { basedRepair: h.basedRepair, basingRepairDays: stats(env.book).basingRepairDays };
});
test('new-feature', 'TRIBUTE-REPARATIONS. tribute 5,000 L / 30 d (Klingon → Terran) and reparations 20,000 L over 4 payments (Terran → Klingon): payments, a save/load midway, a missed tribute (arrears + breach), a later payment clearing it, and the reparations ending — all with no war', () => {
  need();
  let env = treatyWorld('TX-S4');
  const tribute = addTerm(env, { type: 'tribute', payer: 'klingon', recipient: 'terran', amount: 5000, cadenceDays: 30 });
  addTerm(env, { type: 'reparations', payer: 'terran', recipient: 'klingon', total: 20000, payments: 4, cadenceDays: 30 });
  let eff = run(env.book, env.world, 2, 45);
  env = { ...env, book: reload(env.book) };
  const t1 = env.book.treatyTerms.find((t) => t.id === tribute.id);
  const rep = env.book.treatyTerms.find((t) => t.type === 'reparations');
  assert.equal(t1.paidCount, 1); assert.equal(rep.remaining, 15000);
  P(env.book, 'klingon').treasury = -500000;
  eff = eff.concat(run(env.book, env.world, 46, 61));
  assert.equal(t1.arrears, 5000);
  assert.equal(env.book.treatyIncidents.filter((x) => x.kind === 'payment_missed' && x.state === 'breach').length, 1);
  P(env.book, 'klingon').treasury = 200000;
  eff = eff.concat(run(env.book, env.world, 62, 130));
  assert.equal(t1.arrears, 0);
  assert.equal(env.book.treatyIncidents.find((x) => x.kind === 'payment_missed').state, 'resolved');
  assert.equal(rep.status, 'ended'); assert.equal(rep.remaining, 0);
  assert.equal(wars(eff).length, 0);
  log.tributeReparations = { ledger: env.book.treatyLedger, tribute: { paid: t1.paidTotal, arrears: t1.arrears, missed: t1.missedCount }, reparations: { remaining: rep.remaining, status: rep.status } };
});

// ---- summary ----
const by = (tag) => results.filter((r) => r.tag === tag);
const fmt = (tag) => `${tag} ${by(tag).filter((r) => r.ok).length}/${by(tag).length}`;
const failed = results.filter((r) => !r.ok);
console.log(`treaty expansion pure: ${results.length - failed.length}/${results.length} (${['baseline-defect', 'new-feature', 'preservation'].map(fmt).join(', ')})`);
if (out) { fs.mkdirSync(out, { recursive: true }); fs.writeFileSync(path.join(out, 'treaty-expansion-pure.json'), JSON.stringify({ root, results, log }, null, 1)); }
process.exit(failed.length ? 1 : 0);
