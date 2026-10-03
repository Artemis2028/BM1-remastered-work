// Pure regressions for ARCHITECTURE-CLEANUP (docs/diplomacy/BASING-SERVICE-MATRIX.md, DMZ-PRESENCE-STATE-MATRIX.md,
// docs/movement/TRADER-RECORD-AUDIT.md): transit, staging, docking, repair, resupply, recovery and production are
// separate permissions; a DMZ tells passing through from staying; a staging right lets warships stay; doctrine
// patrols base only where their warships may stay; crews are not raised at enemy worlds; a doctrine delivery's cargo
// is what an inspection sees. Checks are tagged:
//   [baseline-defect] reproduces a defect in 1f2da30 (fails on its own assertion there);
//   [new-feature]     behaviour this round adds (the per-service access record, presence types);
//   [preservation]    behaviour 1f2da30 already had and that must hold (passes on both).
// Each check names the brief's regression number(s) (R1–R32) or integrated scenario.
// BM1_CLEANUP_ROOT points the suite at another tree (the baseline reproduction runs it against 1f2da30).
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(process.env.BM1_CLEANUP_ROOT || path.join(here, '..'));
const imp = (rel) => import(pathToFileURL(path.join(root, rel)).href);
const C = await imp('src/campaign-strategy.mjs');
const TT = await imp('src/treaty-terms.mjs');
const DC = await imp('src/doctrine-campaign.mjs');
const DR = await imp('src/doctrine-runtime.mjs');
const readJ = (f) => JSON.parse(fs.readFileSync(path.join(root, f), 'utf8'));
const doctrine = DR.loadDoctrine(readJ('docs/doctrine/bm1-faction-doctrine.v0.2.1.json'), readJ('docs/doctrine/bm1-faction-doctrine.schema.json'));
const { makeWorld, run } = await import(pathToFileURL(path.join(root, 'scripts/campaign-world-fixture.mjs')).href);
const FX = await import(pathToFileURL(path.join(here, 'treaty-fixture.mjs')).href);
const out = process.env.BM1_TEST_OUTPUT || null;

const results = [];
const log = {};
const test = (tag, name, fn) => {
  try { fn(); results.push({ tag, name, ok: true }); console.log('PASS', `[${tag}]`, name); }
  catch (e) { results.push({ tag, name, ok: false, error: String(e?.message || e).split('\n')[0] }); console.log('FAIL', `[${tag}]`, name, '\n      ', String(e?.stack || e).split('\n').slice(0, 7).join('\n       ')); }
};
const { IDX } = FX;
// Earth(0,T) ─ Vega(1,T) ─ Border(2,K) ─ Qonos(3,K); Vega ─ Romulus(4,R) ─ Qonos; Vega ─ Archanis(9,K) ─ Khitomer(10,K) ─ Qonos;
// Border ─ Cardassia(5,C); Vega ─ Minor(8,T) ─ Cardassia. A Terran–Klingon ceasefire unless a test says otherwise.
const world = (seed, rel = 'ceasefire') => { const env = FX.treatyWorldWith(C, makeWorld, seed); env.relations['terran:klingon'] = rel; return env; };
const P = (book, id) => C.getPolity(book, id);
const reload = (book) => C.upgradeCampaignBook(JSON.parse(JSON.stringify(book)));
const vidOf = (h) => h?.identity?.vid || h?.vid || h?.id;
const made = new WeakSet();
function make(env, polity, shipId, at, n = 1) {
  const hs = P(env.book, polity).hulls.filter((h) => h.status === 'ready' && !h.opId && !made.has(h)).sort((a, b) => String(a.id).localeCompare(String(b.id))).slice(0, n);
  assert.equal(hs.length, n, `not ${n} free ${polity} hulls`);
  for (const h of hs) { made.add(h); h.shipId = shipId; h.systemIndex = at; h.maxHull = h.hull = FX.SHIPS[shipId]?.combatHull ?? h.maxHull; h.crew = 1; }
  return hs;
}
function park(env) { for (const [pid, p] of Object.entries(env.book.polities)) for (const h of p.hulls) if (!made.has(h) && h.status !== 'lost') { const home = env.world.systems.find((s) => s.controller === pid && ![IDX.Border, IDX.Archanis, IDX.Vega].includes(s.index)) || env.world.systems.find((s) => s.controller === pid); if (home) h.systemIndex = home.index; } }
const addTerm = (env, spec, day = 1) => { const r = C.addTreatyTerm(env.book, env.world, spec, day, []); assert.ok(r.ok, r.reason); return r.term; };
const go = (env, polity, hulls, destination, extra = {}, day = 1) => C.startJourney(env.book, env.world, { kind: 'treaty-test', sponsor: polity, hulls, destination, purpose: 'move', ...extra }, day, []);
const DMZ = (systems, extra = {}) => ({ type: 'dmz', parties: ['terran', 'klingon'], systems, graceDays: 5, ...extra });
const stationing = (book) => (book.treatyIncidents || []).filter((x) => x.kind === 'dmz_stationing');
const presence = (t, h) => t.withdrawal?.hulls?.[h.id] || null;
const hold = (h, ref = 'held-there') => { h.status = 'assigned'; h.opId = ref; }; // kept there by an order of its own
const ACC = (env, polity, i, cls = 'military') => { assert.ok(C.accessAt, 'this tree has no per-service access record (one "access" answer at most)'); return C.accessAt(env.book, env.world, polity, i, cls); };

// ===================================================================================================
// Transit vs staging in a DMZ (R1–R3, R5, R14–R20)
// ===================================================================================================
test('preservation', 'R1/R14. a Klingon transit guarantee at Border lets a Terran warship pass Vega → Border → Qonos: its route crosses Border, it arrives, no breach', () => {
  const env = world('CU-1');
  addTerm(env, DMZ([IDX.Border]));
  addTerm(env, { type: 'transit', grantor: 'klingon', beneficiary: 'terran', systems: [IDX.Border], traffic: ['military'] });
  const [h] = make(env, 'terran', 91, IDX.Vega); park(env);
  const r = go(env, 'terran', [h], IDX.Qonos);
  assert.ok(r.ok, r.reason); assert.ok(r.journey.path.includes(IDX.Border), `route ${r.journey.path}`);
  run(env.book, env.world, 2, 40);
  assert.equal(h.systemIndex, IDX.Qonos); assert.equal(stationing(env.book).length, 0);
});
test('baseline-defect', 'R14b. legal transit is not a presence: a guaranteed warship passing through Border leaves no withdrawal record and is not counted a "compliant withdrawal" (1f2da30 recorded every pass through a stationing-banned zone as a presence that later withdrew)', () => {
  const env = world('CU-14b');
  const [h] = make(env, 'terran', 91, IDX.Vega); park(env); // nobody else in the zone when it begins
  const t = addTerm(env, DMZ([IDX.Border], { restrict: { transit: false } }));
  const r = go(env, 'terran', [h], IDX.Qonos);
  assert.ok(r.ok, r.reason);
  const seen = [];
  for (let d = 2; d <= 40; d++) { run(env.book, env.world, d, d); if (presence(t, h)) seen.push([d, presence(t, h).state]); }
  log.r14b = { path: r.journey.path, seen, compliant: env.book.stats.treaty?.compliantWithdrawals ?? 0 };
  assert.ok(r.journey.path.includes(IDX.Border), `a stationing-only DMZ barred transit: ${r.journey.path}`);
  assert.deepEqual(seen, [], `a pass through was recorded as a presence: ${JSON.stringify(seen)}`);
  assert.equal(env.book.stats.treaty?.compliantWithdrawals ?? 0, 0);
});
test('baseline-defect', 'R14c. a closed presence is not reopened by a later pass: a Terran warship in a stationing-only DMZ at Border when it begins withdraws within the grace (one compliant withdrawal); later it flies through Border to Qonos — transit, no new presence, still one compliant withdrawal (1f2da30 barred transit through a stationing-only zone)', () => {
  const env = world('CU-14c');
  const [h] = make(env, 'terran', 91, IDX.Border); park(env);
  const t = addTerm(env, DMZ([IDX.Border], { restrict: { transit: false } }));
  run(env.book, env.world, 2, 30); // an AI warship with no order: sent out by an ordinary journey
  assert.equal(presence(t, h)?.state, 'withdrawn');
  const n = env.book.stats.treaty?.compliantWithdrawals ?? 0;
  const r = go(env, 'terran', [h], IDX.Qonos, {}, 31); assert.ok(r.ok, r.reason); assert.ok(r.journey.path.includes(IDX.Border));
  const seen = [];
  for (let d = 31; d <= 70; d++) { run(env.book, env.world, d, d); if (presence(t, h) && presence(t, h).state !== 'withdrawn') seen.push([d, presence(t, h).state]); }
  assert.equal(h.systemIndex, IDX.Qonos);
  assert.deepEqual(seen, [], `a pass through reopened a presence: ${JSON.stringify(seen)}`);
  assert.equal(env.book.stats.treaty?.compliantWithdrawals ?? 0, n);
});
test('baseline-defect', 'R2. the same transit guarantee does not permit indefinite stationing: a Terran warship that stops at Border is given the grace, and after it is a stationing breach — once (1f2da30: a guarantee lifted the whole DMZ, so a battle fleet could park there for ever)', () => {
  const env = world('CU-2');
  const t = addTerm(env, DMZ([IDX.Border]));
  addTerm(env, { type: 'transit', grantor: 'klingon', beneficiary: 'terran', systems: [IDX.Border], traffic: ['military'] });
  const [h] = make(env, 'terran', 91, IDX.Vega); park(env);
  const r = go(env, 'terran', [h], IDX.Border);
  assert.ok(r.ok, r.reason);
  run(env.book, env.world, 2, r.journey.etaDay);
  hold(h);
  run(env.book, env.world, r.journey.etaDay + 1, r.journey.etaDay + 40);
  log.r2 = { presence: presence(t, h), incidents: stationing(env.book).map((x) => [x.day, x.state]) };
  assert.equal(h.systemIndex, IDX.Border);
  assert.equal(stationing(env.book).length, 1, `stationing breaches: ${stationing(env.book).length}`);
  assert.equal(presence(t, h)?.state, 'breach');
});
test('baseline-defect', 'R3/R20. a staging right lets the warship stay: a DMZ that bans stationing (transit allowed) at Border, a Klingon staging right there for the Terrans — the warship goes to Border, stays 40 days, its presence is "staged", no breach (1f2da30 barred transit through a stationing-only DMZ outright)', () => {
  const env = world('CU-3');
  const t = addTerm(env, DMZ([IDX.Border], { restrict: { transit: false } }));
  addTerm(env, { type: 'basing', host: 'klingon', guest: 'terran', systems: [IDX.Border], purposes: ['staging'] });
  const [h] = make(env, 'terran', 91, IDX.Vega); park(env);
  const r = go(env, 'terran', [h], IDX.Border);
  assert.ok(r.ok, `refused: ${r.reason}`);
  run(env.book, env.world, 2, r.journey.etaDay); hold(h);
  run(env.book, env.world, r.journey.etaDay + 1, r.journey.etaDay + 40);
  assert.equal(stationing(env.book).length, 0);
  assert.equal(presence(t, h)?.state, 'staged'); assert.equal(presence(t, h)?.presence, 'staged');
  assert.equal(ACC(env, 'terran', IDX.Border).staging.basis, 'treaty');
});
test('new-feature', 'R5. a docking right alone does not permit staging: same zone, a docking right (no staging) — the warship that stays is given the grace and then breaches once; the access record says docking permitted, staging prohibited', () => {
  const env = world('CU-5');
  const t = addTerm(env, DMZ([IDX.Border], { restrict: { transit: false } }));
  addTerm(env, { type: 'basing', host: 'klingon', guest: 'terran', systems: [IDX.Border], purposes: ['docking'] });
  const a = ACC(env, 'terran', IDX.Border);
  assert.equal(a.docking.ok, true); assert.equal(a.staging.ok, false); assert.equal(a.transit.ok, true);
  const [h] = make(env, 'terran', 91, IDX.Vega); park(env);
  const r = go(env, 'terran', [h], IDX.Border); assert.ok(r.ok, r.reason);
  run(env.book, env.world, 2, r.journey.etaDay); hold(h);
  run(env.book, env.world, r.journey.etaDay + 1, r.journey.etaDay + 40);
  assert.equal(stationing(env.book).length, 1); assert.equal(presence(t, h)?.state, 'breach');
});
test('preservation', 'R15/R16. stopping inside the DMZ starts a grace first (a pending presence with its due day); leaving within it is no breach', () => {
  const env = world('CU-15');
  const t = addTerm(env, DMZ([IDX.Border]));
  const [h] = make(env, 'terran', 91, IDX.Border); park(env); hold(h);
  run(env.book, env.world, 2, 3);
  assert.equal(presence(t, h)?.state, 'pending'); assert.equal(stationing(env.book).length, 0);
  h.status = 'ready'; h.opId = null;
  const r = go(env, 'terran', [h], IDX.Vega, {}, 4); assert.ok(r.ok, r.reason);
  run(env.book, env.world, 4, 40);
  assert.equal(stationing(env.book).length, 0); assert.ok(['withdrawn'].includes(presence(t, h)?.state), presence(t, h)?.state);
});
test('preservation', 'R17/R18/R19. remaining after the grace is one breach — not one a day; leaving and coming back later is a new presence and, kept past its own grace, a second, distinct breach', () => {
  const env = world('CU-17');
  const t = addTerm(env, DMZ([IDX.Border]));
  const [h] = make(env, 'terran', 91, IDX.Border); park(env); hold(h);
  run(env.book, env.world, 2, 40);
  assert.equal(stationing(env.book).length, 1);
  h.status = 'ready'; h.opId = null;
  const out1 = go(env, 'terran', [h], IDX.Vega, {}, 41); assert.ok(out1.ok, out1.reason);
  run(env.book, env.world, 41, 70);
  assert.equal(presence(t, h)?.state, 'withdrawn_late');
  h.status = 'ready'; h.opId = null; h.systemIndex = IDX.Border; hold(h); // back in the zone (defying it)
  run(env.book, env.world, 71, 100);
  const xs = stationing(env.book);
  assert.equal(xs.length, 2); assert.notEqual(xs[0].id, xs[1].id);
});
test('preservation', 'R22. a DMZ that begins with a warship already inside gives it the withdrawal grace (an AI warship with no order is sent out by an ordinary journey, not teleported)', () => {
  const env = world('CU-22');
  const [k] = make(env, 'klingon', 97, IDX.Border); park(env);
  const t = addTerm(env, DMZ([IDX.Border]), 1);
  assert.ok(presence(t, k), 'no presence on the first day');
  assert.equal(k.systemIndex, IDX.Border, 'teleported');
  run(env.book, env.world, 2, 40);
  assert.notEqual(k.systemIndex, IDX.Border); assert.equal(stationing(env.book).length, 0);
});
test('preservation', 'R23. a DMZ that ends while a warship is inside drops the restriction: no breach after the end, staging permitted again', () => {
  const env = world('CU-23');
  const t = addTerm(env, DMZ([IDX.Border]));
  const [h] = make(env, 'terran', 91, IDX.Border); park(env); hold(h);
  run(env.book, env.world, 2, 4);
  C.endTreatyTerm(env.book, env.world, t.id, 4, 'ended by agreement', []);
  run(env.book, env.world, 5, 40);
  assert.equal(stationing(env.book).length, 0);
  if (C.accessAt) assert.equal(ACC(env, 'terran', IDX.Border).staging.ok, true);
});
test('preservation', 'R24. save/load mid-grace keeps the presence, its due day and the one breach on the same day', () => {
  const env = world('CU-24');
  const t = addTerm(env, DMZ([IDX.Border]));
  const [h] = make(env, 'terran', 91, IDX.Border); park(env); hold(h);
  run(env.book, env.world, 2, 4);
  const b2 = reload(env.book);
  const t2 = b2.treatyTerms.find((x) => x.id === t.id);
  assert.deepEqual(t2.withdrawal.hulls[h.id], presence(t, h));
  run(env.book, env.world, 5, 30); run(b2, env.world, 5, 30);
  assert.deepEqual(stationing(b2).map((x) => x.day), stationing(env.book).map((x) => x.day));
  assert.equal(stationing(b2).length, 1);
});
test('baseline-defect', 'R25/R26/R27. the AI: a warship in legal transit flies on; one whose order ends inside is sent out by an ordinary withdrawal journey (assigned to it, leg by leg) to a system outside the zone; one held there by a valid order of its own stays and breaches — never teleported (1f2da30: the transit guarantee lifted the whole zone, so neither was asked to leave)', () => {
  const env = world('CU-25');
  addTerm(env, DMZ([IDX.Border]));
  addTerm(env, { type: 'transit', grantor: 'terran', beneficiary: 'klingon', systems: [IDX.Border], traffic: ['military'] });
  const [a, b] = make(env, 'klingon', 97, IDX.Qonos, 2);
  const [c] = make(env, 'klingon', 97, IDX.Border); park(env);
  const ra = go(env, 'klingon', [a], IDX.Vega); assert.ok(ra.ok, ra.reason); assert.ok(ra.journey.path.includes(IDX.Border));
  b.systemIndex = IDX.Border; // its order ended here
  hold(c, 'garrison-order');
  const trail = [];
  for (let d = 2; d <= 40; d++) { run(env.book, env.world, d, d); trail.push([d, b.systemIndex, Boolean(b.transit)]); }
  assert.equal(a.systemIndex, IDX.Vega);
  assert.notEqual(b.systemIndex, IDX.Border, 'never left');
  assert.ok(trail.some(([, , tr]) => tr), 'left without a journey (teleported)');
  assert.equal(c.systemIndex, IDX.Border); assert.ok(stationing(env.book).some((x) => x.assets.includes(vidOf(c))));
});

// ===================================================================================================
// Services: staging/docking/repair separate; ownership and production unchanged (R5, R7, R8, FOREIGN-BASE-SERVICES)
// ===================================================================================================
test('new-feature', 'FOREIGN-BASE-SERVICES (model). Klingon grants the Terrans docking, repair and staging at Qonos as three terms: each service is permitted by its own term; ending one term at a time removes exactly that service; ownership, control, licences, designs and production are unchanged throughout', () => {
  const env = world('CU-FBS', 'peace');
  const snap = () => JSON.stringify({ ctl: env.world.systems[IDX.Qonos].controller, owners: env.world.stationsBySystem(IDX.Qonos).map((s) => s.owner), lic: [P(env.book, 'terran').licenses, P(env.book, 'klingon').licenses], designs: env.book.designs, prod: C.polityProduction(env.book, env.world, 'terran') });
  const s0 = snap();
  const terms = Object.fromEntries(['docking', 'repair', 'staging'].map((svc) => [svc, addTerm(env, { type: 'basing', host: 'klingon', guest: 'terran', systems: [IDX.Qonos], purposes: [svc] })]));
  const a = ACC(env, 'terran', IDX.Qonos);
  assert.deepEqual([a.docking.termId, a.repair.termId, a.staging.termId], [terms.docking.id, terms.repair.id, terms.staging.id]);
  assert.equal(a.resupply.ok, false); assert.equal(a.production.ok, false);
  const seen = {};
  for (const svc of ['docking', 'repair', 'staging']) {
    C.endTreatyTerm(env.book, env.world, terms[svc].id, 2, 'test', []);
    const b = ACC(env, 'terran', IDX.Qonos);
    seen[svc] = { docking: b.docking.basis === 'treaty', repair: b.repair.basis === 'treaty', staging: b.staging.basis === 'treaty' };
    assert.equal(seen[svc][svc], false, `${svc} survived its own term`);
  }
  log.fbs = seen;
  assert.deepEqual(seen.docking, { docking: false, repair: true, staging: true });
  assert.deepEqual(seen.repair, { docking: false, repair: false, staging: true });
  assert.equal(snap(), s0);
});
test('new-feature', 'R7/R8. no basing right grants production or control: with repair, docking, staging, resupply and recovery all granted at Qonos, the access record says production refused, the system and its stations stay Klingon, and the Terran production berths are unchanged', () => {
  const env = world('CU-7', 'peace');
  const b0 = C.polityProduction(env.book, env.world, 'terran');
  addTerm(env, { type: 'basing', host: 'klingon', guest: 'terran', systems: [IDX.Qonos], purposes: ['repair', 'docking', 'staging', 'resupply', 'recovery'] });
  const a = ACC(env, 'terran', IDX.Qonos);
  assert.equal(a.production.ok, false); assert.equal(env.world.systems[IDX.Qonos].controller, 'klingon');
  assert.deepEqual(C.polityProduction(env.book, env.world, 'terran'), b0);
});
test('new-feature', 'R9. without a basing right, a foreign yard gives the AI nothing: repair, docking and recovery at Qonos are "not authorized" for the Terrans at peace, and refused outright at war', () => {
  const env = world('CU-9', 'peace');
  const a = ACC(env, 'terran', IDX.Qonos);
  assert.equal(a.repair.ok, false); assert.equal(a.docking.ok, false); assert.equal(a.recovery.ok, false);
  const w = world('CU-9w', 'war');
  addTerm(w, { type: 'basing', host: 'klingon', guest: 'terran', systems: [IDX.Qonos], purposes: ['repair'] });
  assert.equal(ACC(w, 'terran', IDX.Qonos).repair.ok, false, 'an enemy yard served under a basing right while at war');
});

// ===================================================================================================
// Doctrine (R28), crews at enemy worlds, delivery cargo
// ===================================================================================================
test('baseline-defect', 'R28. a doctrine patrol cannot base where its warships may not stay: anchored on its own world inside a stationing-banned DMZ it is refused; an existing patrol whose anchor is taken ends (1f2da30 accepted the anchor and never re-checked it)', () => {
  const env = world('CU-28');
  addTerm(env, DMZ([IDX.Vega], { restrict: { transit: false } }));
  const [h] = make(env, 'terran', 91, IDX.Vega); park(env);
  const r = DC.startAreaPatrol(env.book, env.world, 'terran', h.id, IDX.Vega, 1, []);
  assert.equal(r.ok, false, 'a patrol was based inside a DMZ that bans stationing');
  const e2 = world('CU-28b');
  e2.world.doctrineStep = (b, w, d, fx) => DC.advanceDoctrineDay(b, w, d, fx, doctrine);
  const db = DC.doctrineBook(e2.book);
  db.config = { ...db.config, patrols: {}, explorers: {}, reliefShips: {}, merchants: {}, projects: {}, patrolAreas: {} };
  const [h2] = make(e2, 'terran', 91, IDX.Minor); park(e2);
  const p2 = DC.startAreaPatrol(e2.book, e2.world, 'terran', h2.id, IDX.Minor, 1, []);
  assert.ok(p2.ok, p2.reason);
  e2.world.systems[IDX.Minor].controller = 'cardassian';
  for (let d = 2; d <= 90 && p2.patrol.status === 'patrolling'; d++) run(e2.book, e2.world, d, d);
  log.r28 = { status: p2.patrol.status, reason: p2.patrol.endReason, cycles: p2.patrol.cycles };
  assert.notEqual(p2.patrol.status, 'patrolling', `the patrol still bases on a world it lost: ${JSON.stringify(log.r28)}`);
});
test('baseline-defect', 'CREW-AT-ENEMY-WORLD. a crewless Terran hull at Qonos (Klingon, at war, a world with morale) is not re-crewed there; at its own Earth it is (1f2da30 raised crews at any world with morale, an enemy\'s included)', () => {
  const env = world('CU-CR', 'war');
  const [h] = make(env, 'terran', 91, IDX.Qonos); park(env);
  h.crew = 0.2;
  run(env.book, env.world, 2, 12);
  log.crew = { atQonos: h.crew };
  assert.equal(h.crew, 0.2, `crewed at an enemy world: ${h.crew}`);
  h.systemIndex = IDX.Earth;
  run(env.book, env.world, 13, 20);
  assert.ok(h.crew > 0.2);
});
test('baseline-defect', 'DELIVERY-CARGO. a doctrine delivery crossing an inspection regime is inspected with its real manifest (1f2da30 inspected every doctrine freighter with an empty one: the journey carried no cargo and the kind had no cargo hook)', () => {
  const env = world('CU-DC', 'peace');
  addTerm(env, { type: 'inspection', inspector: 'klingon', inspected: 'terran', systems: [IDX.Border], traffic: ['civilian'], hullCategories: ['freighter'] }); // a delivery is civilian traffic
  const [h] = make(env, 'terran', 99, IDX.Vega); park(env);
  const db = DC.doctrineBook(env.book);
  const a = { id: 'cu-delivery', kind: 'delivery', polity: 'terran', hullId: h.id, vid: vidOf(h), status: 'active', cargo: { knowledge: 'declared', manifest: [{ cargoId: 'trade-goods', quantity: 40 }] }, itinerary: [], milestones: [], runs: [] };
  db.assignments.push(a);
  h.status = 'assigned'; h.opId = a.id;
  const r = C.startJourney(env.book, env.world, { kind: 'doctrine', ref: a.id, sponsor: 'terran', hulls: [h], destination: IDX.Qonos, purpose: 'delivery', meta: { assignmentId: a.id } }, 1, []);
  assert.ok(r.ok, r.reason);
  for (let d = 2; d <= 30 && !(env.book.treatyInspections || []).length; d++) C.stepJourney(env.book, env.world, r.journey, d, []);
  const insp = (env.book.treatyInspections || [])[0];
  log.deliveryCargo = insp ? { state: insp.state, observed: insp.observed } : null;
  assert.ok(insp, 'never inspected');
  assert.deepEqual(insp.observed?.manifest, [{ cargoId: 'trade-goods', quantity: 40 }], `inspected as ${JSON.stringify(insp.observed)}`);
});

test('baseline-defect', 'R12/R29. strategic recovery never tows to an unauthorized or enemy yard: a Terran hulk at Border, the Terran yards closed (held by a Romulan enemy), a Klingon repair-and-recovery basing right at Qonos — at peace she is planned to Qonos; at war, with the same terms still on the books, no yard is found (1f2da30 took the basing right before it asked whether the host was at war)', () => {
  const mk = (seed, rel) => {
    const env = world(seed, rel);
    const [tug] = make(env, 'terran', 90, IDX.Border); const [h] = make(env, 'terran', 91, IDX.Border); park(env);
    env.world.systems[IDX.Earth].controller = 'romulan'; env.world.systems[IDX.Vega].controller = 'romulan'; env.relations['terran:romulan'] = 'war';
    addTerm(env, { type: 'basing', host: 'klingon', guest: 'terran', systems: [IDX.Qonos], purposes: ['repair', 'recovery'] });
    h.hull = Math.max(1, Math.floor(h.maxHull * 0.05)); h.status = 'repairing';
    C.advanceStranded(env.book, env.world, 1, []);
    assert.ok(h.stranded, 'not stranded');
    return C.planHullRecovery(env.book, env.world, { sponsor: 'terran', targetHullId: h.id, tugHullId: tug.id }, 1);
  };
  const peace = mk('CU-29p', 'peace');
  assert.ok(peace.ok, peace.reason); assert.equal(peace.yard, IDX.Qonos);
  const war = mk('CU-29w', 'war');
  log.r29 = { peace: peace.yard, war: war.ok ? war.yard : war.reason };
  assert.ok(!war.ok || war.yard !== IDX.Qonos, `towed to an enemy yard under a basing right: ${JSON.stringify(log.r29)}`);
});

// ===================================================================================================
// Integrated: DMZ-TRANSIT-VS-STAGING
// ===================================================================================================
test('baseline-defect', 'DMZ-TRANSIT-VS-STAGING. a DMZ at Border with a Klingon guarantee of military transit but no staging: fleet A flies through to Qonos legally (no presence, no breach); fleet B stops at Border and is given the grace; branch B1 leaves before its due day (withdrawn, no breach); branch B2 stays and records exactly one breach', () => {
  const branch = (stay) => {
    const env = world(`CU-TVS-${stay ? 'stay' : 'leave'}`);
    const t = addTerm(env, DMZ([IDX.Border]));
    addTerm(env, { type: 'transit', grantor: 'klingon', beneficiary: 'terran', systems: [IDX.Border], traffic: ['military'] });
    const [a] = make(env, 'terran', 91, IDX.Vega), [b] = make(env, 'terran', 91, IDX.Vega); park(env);
    const ra = go(env, 'terran', [a], IDX.Qonos), rb = go(env, 'terran', [b], IDX.Border);
    assert.ok(ra.ok && rb.ok, `${ra.reason} ${rb.reason}`);
    run(env.book, env.world, 2, rb.journey.etaDay); hold(b);
    run(env.book, env.world, rb.journey.etaDay + 1, rb.journey.etaDay + 1);
    const p = presence(t, b);
    assert.equal(p?.state, 'pending', `B has no grace: ${JSON.stringify(p)}`);
    const due = p.dueDay ?? (Number(t.withdrawal.dueDay));
    if (!stay) { b.status = 'ready'; b.opId = null; const o = go(env, 'terran', [b], IDX.Vega, {}, rb.journey.etaDay + 2); assert.ok(o.ok, o.reason); }
    run(env.book, env.world, rb.journey.etaDay + 2, rb.journey.etaDay + 60);
    return { a: { at: a.systemIndex, presence: presence(t, a) }, b: { state: presence(t, b)?.state, at: b.systemIndex }, breaches: stationing(env.book).length, due };
  };
  const leave = branch(false), stay = branch(true);
  log.transitVsStaging = { leave, stay };
  assert.equal(leave.a.at, IDX.Qonos); assert.equal(leave.a.presence, null);
  assert.equal(leave.b.state, 'withdrawn'); assert.equal(leave.breaches, 0);
  assert.equal(stay.b.state, 'breach'); assert.equal(stay.b.at, IDX.Border); assert.equal(stay.breaches, 1);
});

// ===================================================================================================
// Preservation: secret terms, identity
// ===================================================================================================
test('preservation', 'R21. a secret DMZ term does not leak: its stationing breach is known only to the breaching party and observers who know the term; the term is not visible to a third party', () => {
  const env = world('CU-21');
  const t = addTerm(env, DMZ([IDX.Border], { secret: true }));
  assert.equal(TT.termVisibleTo(t, 'romulan'), false);
  const [h] = make(env, 'terran', 91, IDX.Border); park(env); hold(h);
  run(env.book, env.world, 2, 40);
  for (const x of stationing(env.book)) assert.ok(!x.knownTo.includes('romulan'));
});
test('preservation', 'R32. no vessel is duplicated or renamed: across transit, staging, withdrawal and breach every vid exists exactly once and keeps its hull', () => {
  const env = world('CU-32');
  addTerm(env, DMZ([IDX.Border]));
  addTerm(env, { type: 'transit', grantor: 'klingon', beneficiary: 'terran', systems: [IDX.Border], traffic: ['military'] });
  const hs = make(env, 'terran', 91, IDX.Vega, 3); park(env);
  const vids = hs.map(vidOf);
  go(env, 'terran', [hs[0]], IDX.Qonos); go(env, 'terran', [hs[1]], IDX.Border);
  run(env.book, env.world, 2, 60);
  const all = Object.values(env.book.polities).flatMap((p) => p.hulls.filter((h) => h.status !== 'lost').map(vidOf));
  assert.equal(new Set(all).size, all.length);
  assert.deepEqual(hs.map(vidOf), vids);
});

const failed = results.filter((r) => !r.ok);
const by = (t) => `${t} ${results.filter((r) => r.tag === t && r.ok).length}/${results.filter((r) => r.tag === t).length}`;
const summary = `architecture cleanup pure: ${results.length - failed.length}/${results.length} (${by('baseline-defect')}, ${by('new-feature')}, ${by('preservation')})${failed.length ? ` — FAILED: ${failed.map((f) => f.name.split(' ')[0]).join(', ')}` : ''}`;
console.log(`\n${summary}`);
if (out) { fs.mkdirSync(out, { recursive: true }); fs.writeFileSync(path.join(out, process.env.BM1_CLEANUP_ROOT ? 'cleanup-pure-baseline.json' : 'cleanup-pure.json'), JSON.stringify({ summary, results, log }, null, 2)); }
process.exit(failed.length ? 1 : 0);
