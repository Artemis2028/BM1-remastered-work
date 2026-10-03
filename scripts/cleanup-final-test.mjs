// Pure regressions for ARCHITECTURE-CLEANUP-FINAL (docs/diplomacy/BASING-SERVICE-MATRIX.md, docs/movement/
// TRADER-RECORD-AUDIT.md): commerce is its own permission that no treaty term grants; one yard's daily repair capacity
// is shared by its host and every guest; a hull that carries its own traffic class (the captain's unarmed freighter)
// is judged by it in a DMZ. Tags:
//   [baseline-defect] reproduces a defect in 79bc258 (fails on its own assertion there);
//   [new-feature]     needs this round;
//   [preservation]    holds on both.
// BM1_CLEANUP_ROOT points the suite at another tree (the baseline reproduction runs it against 79bc258).
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(process.env.BM1_CLEANUP_ROOT || path.join(here, '..'));
const imp = (rel) => import(pathToFileURL(path.join(root, rel)).href);
const C = await imp('src/campaign-strategy.mjs');
const { makeWorld, run } = await import(pathToFileURL(path.join(root, 'scripts/campaign-world-fixture.mjs')).href);
const FX = await import(pathToFileURL(path.join(here, 'treaty-fixture.mjs')).href);
const out = process.env.BM1_TEST_OUTPUT || null;
const results = [];
const log = {};
const test = (tag, name, fn) => {
  try { fn(); results.push({ tag, name, ok: true }); console.log('PASS', `[${tag}]`, name); }
  catch (e) { results.push({ tag, name, ok: false, error: String(e?.message || e).split('\n')[0] }); console.log('FAIL', `[${tag}]`, name, '\n      ', String(e?.stack || e).split('\n').slice(0, 6).join('\n       ')); }
};
const { IDX } = FX;
const world = (seed, rel = 'peace') => { const env = FX.treatyWorldWith(C, makeWorld, seed); env.relations['terran:klingon'] = rel; return env; };
const P = (book, id) => C.getPolity(book, id);
const made = new WeakSet();
function make(env, polity, shipId, at, n = 1) {
  const hs = P(env.book, polity).hulls.filter((h) => h.status === 'ready' && !h.opId && !made.has(h)).sort((a, b) => String(a.id).localeCompare(String(b.id))).slice(0, n);
  assert.equal(hs.length, n, `not ${n} free ${polity} hulls`);
  for (const h of hs) { made.add(h); h.shipId = shipId; h.systemIndex = at; h.maxHull = h.hull = FX.SHIPS[shipId]?.combatHull ?? h.maxHull; h.crew = 1; }
  return hs;
}
function park(env) { for (const [pid, p] of Object.entries(env.book.polities)) for (const h of p.hulls) if (!made.has(h) && h.status !== 'lost') { const home = env.world.systems.find((s) => s.controller === pid && ![IDX.Border, IDX.Archanis, IDX.Vega, IDX.Qonos].includes(s.index)) || env.world.systems.find((s) => s.controller === pid); if (home) h.systemIndex = home.index; } }
const addTerm = (env, spec, day = 1) => { const r = C.addTreatyTerm(env.book, env.world, spec, day, []); assert.ok(r.ok, r.reason); return r.term; };
const ACC = (env, polity, i) => C.accessAt(env.book, env.world, polity, i, 'military');

test('new-feature', 'MARKET-ACCESS. the market is its own answer: open at a foreign world at peace on ordinary terms, never "treaty" whatever basing purposes are granted (docking, repair, staging, resupply, recovery), refused at war, own at home — a docking right never stands in for it', () => {
  const env = world('CF-M');
  const a0 = ACC(env, 'terran', IDX.Qonos);
  assert.ok(a0.market, 'this tree has no market answer: commerce rides on whatever else is open');
  assert.equal(a0.market.basis, 'open');
  addTerm(env, { type: 'basing', host: 'klingon', guest: 'terran', systems: [IDX.Qonos], purposes: ['docking', 'repair', 'staging', 'resupply', 'recovery'] });
  const a1 = ACC(env, 'terran', IDX.Qonos);
  assert.equal(a1.docking.basis, 'treaty'); assert.equal(a1.market.basis, 'open'); assert.notEqual(a1.market.basis, 'treaty');
  assert.equal(a1.production.ok, false);
  assert.equal(ACC(env, 'terran', IDX.Earth).market.basis, 'own');
  const w = world('CF-Mw', 'war');
  assert.equal(ACC(w, 'terran', IDX.Qonos).market.ok, false);
  log.market = { open: a0.market, withAllBasing: a1.market };
});

// Qonos's daily repair capacity, measured: a Klingon cruiser far below full, alone in the yard for one day.
const yardDay = (seed, guest) => {
  const env = world(seed);
  if (guest) addTerm(env, { type: 'basing', host: 'klingon', guest: 'terran', systems: [IDX.Qonos], purposes: ['repair'], repairShare: 0.5 });
  const [k] = make(env, 'klingon', 97, IDX.Qonos);
  const h = guest ? make(env, 'terran', 91, IDX.Qonos)[0] : null;
  park(env);
  for (const x of [k, h].filter(Boolean)) { x.maxHull = 5000; x.hull = 2000; /* far below full, not disabled */ x.status = 'repairing'; }
  const before = { k: k.hull, h: h?.hull ?? 0 };
  run(env.book, env.world, 2, 2);
  return { host: k.hull - before.k, guest: h ? h.hull - before.h : 0 };
};
test('preservation', 'YARD-CAPACITY (host alone). with no guest, the Klingon yard at Qonos repairs its own cruiser by its full daily capacity', () => {
  const r = yardDay('CF-Y1', false);
  log.yardAlone = r;
  assert.ok(r.host > 0, 'nothing repaired');
});
test('baseline-defect', 'YARD-SHARED-CAPACITY. one yard repairs no more in a day than it can: a Klingon cruiser and a Terran guest under a repair basing right (share 0.5), both far below full at Qonos — host and guest together get back at most the yard\'s daily capacity (79bc258 gave the guest its share on top of the host\'s full capacity)', () => {
  const cap = yardDay('CF-Y1', false).host;
  const r = yardDay('CF-Y1', true);
  log.yardShared = { cap, ...r };
  assert.ok(r.guest > 0, `the guest was not repaired: ${JSON.stringify(log.yardShared)}`);
  assert.ok(r.host + r.guest <= cap, `the yard repaired ${r.host + r.guest} in one day with capacity ${cap}: ${JSON.stringify(log.yardShared)}`);
});

test('baseline-defect', 'CIVILIAN-HULL-CLASS. a Terran hull that carries trafficClass "civilian" (the captain\'s unarmed freighter, mirrored) standing in a DMZ is not a stationed warship: no presence, no breach; the same hull marked military is given the grace (79bc258 judged every standing hull military unless a doctrine job said otherwise)', () => {
  const env = world('CF-C', 'ceasefire');
  const [c, m] = make(env, 'terran', 99, IDX.Border, 2); park(env);
  c.trafficClass = 'civilian'; m.trafficClass = 'military';
  for (const x of [c, m]) { x.status = 'assigned'; x.opId = 'held'; }
  const t = addTerm(env, { type: 'dmz', parties: ['terran', 'klingon'], systems: [IDX.Border], graceDays: 4 });
  run(env.book, env.world, 2, 20);
  const rec = (h) => t.withdrawal?.hulls?.[h.id] || null;
  log.cls = { civilian: rec(c), military: rec(m) };
  assert.equal(rec(c), null, `a civilian hull was held to the stationing ban: ${JSON.stringify(rec(c))}`);
  assert.ok(rec(m), 'the military hull was not');
  assert.equal((env.book.treatyIncidents || []).filter((x) => x.kind === 'dmz_stationing' && x.assets.includes(c.vid || c.identity?.vid || c.id)).length, 0);
});

const failed = results.filter((r) => !r.ok);
const by = (t) => `${t} ${results.filter((r) => r.tag === t && r.ok).length}/${results.filter((r) => r.tag === t).length}`;
console.log(`\narchitecture cleanup final pure: ${results.length - failed.length}/${results.length} (${['baseline-defect', 'new-feature', 'preservation'].map(by).join(', ')})${failed.length ? ` — FAILED: ${failed.map((r) => r.name.split(' ')[0]).join(', ')}` : ''}`);
if (out) { fs.mkdirSync(out, { recursive: true }); fs.writeFileSync(path.join(out, process.env.BM1_CLEANUP_ROOT ? 'cleanup-final-pure-baseline.json' : 'cleanup-final-pure.json'), JSON.stringify({ root, results, log }, null, 1)); }
process.exit(failed.length ? 1 : 0);
