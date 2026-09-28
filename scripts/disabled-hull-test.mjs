// Disabled strategic hulls (DOCTRINE-RUNTIME-PHASE3 §1): a disabled hull stays disabled until something
// actually recovers it. This suite uses only campaign calls that exist on 6f9e499 as well, so it runs
// against the frozen tip as the baseline reproduction (categories as in the gates: baseline-defect fails
// there on its own assertion; preservation holds on both).
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import * as C from '../src/campaign-strategy.mjs';
import { classifyDamage } from '../src/ship-fleet.mjs';
import { galaxy, run, IDX, ready, hullById, reload, disable } from './doctrine-galaxy-fixture.mjs';

const out = process.env.BM1_TEST_OUTPUT || null;
const results = [];
const log = {};
const check = (category, name, fn) => {
  try { fn(); results.push({ category, name, ok: true }); console.log('PASS', `[${category}]`, name); }
  catch (e) { results.push({ category, name, ok: false, message: String(e?.message || e).split('\n').slice(0, 4).join(' ') }); console.log('FAIL', `[${category}]`, name, '\n      ', String(e?.message || e).split('\n').slice(0, 6).join('\n       ')); }
};
const cond = (h) => classifyDamage(h.hull, h.maxHull);

check('baseline-defect', 'DH-1. a disabled hull left where a battle released it (no yard there) stays there, disabled, after 1, 5, 20 and 40 days', () => {
  const { world, book } = galaxy('DH-1');
  const h = ready(book, 'romulan', IDX.Romulus)[0];
  h.systemIndex = IDX.Aldnas; disable(h); h.status = 'ready'; // as a finished operation releases its survivors
  const trail = [];
  for (const d of [1, 5, 20, 40]) { run(book, world, (trail.at(-1)?.d ?? 1) + 1, d + 1); trail.push({ d, at: h.systemIndex, hull: h.hull, cond: cond(h), status: h.status }); }
  log.dh1 = trail;
  for (const t of trail) {
    assert.equal(t.at, IDX.Aldnas, `day ${t.d}: the hulk moved (to ${t.at}) with nothing to move it`);
    assert.equal(t.cond, 'disabled', `day ${t.d}: the hulk repaired itself (${t.hull}/${h.maxHull})`);
    assert.notEqual(t.status, 'ready', `day ${t.d}: a disabled hull is listed ready`);
  }
});
check('baseline-defect', 'DH-2. a disabled survivor of an operation does not sail home: it stays where it was disabled', () => {
  const { world, book } = galaxy('DH-2');
  const hs = ready(book, 'klingon', IDX.Border).slice(0, 3);
  const op = C.launchOperation(book, world, 'klingon', hs, IDX.Vega, 1, 1, 'assault', []);
  run(book, world, 2, 2);
  disable(hs[0]);
  C.terminateOperations(book, world, 'klingon', 2, [], 'test stand-down');
  run(book, world, 3, 8);
  log.dh2 = { at: hs[0].systemIndex, status: hs[0].status, cond: cond(hs[0]), others: hs.slice(1).map((h) => h.systemIndex) };
  assert.equal(hs[0].systemIndex, IDX.Vega, `the disabled hull went home to ${hs[0].systemIndex}`);
  assert.equal(cond(hs[0]), 'disabled');
  assert.ok(hs.slice(1).every((h) => h.systemIndex === IDX.Border), 'the able survivors did not go home');
});
check('baseline-defect', 'DH-3. an own yard does not repair a hulk it cannot reach: a disabled hull at its home yard under an enemy blockade stays disabled', () => {
  const { world, book, relations } = galaxy('DH-3', { relations: { 'romulan:terran': 'war' } });
  const terr = ready(book, 'terran').slice(0, 14);
  for (const t of terr) t.systemIndex = IDX.Romulus;
  const b = C.startBlockade(book, world, { power: 'terran', target: IDX.Romulus, hullIds: terr.map((x) => x.id), purpose: 'cut_reinforcements' }, 1, []);
  assert.ok(b.ok, b.reason);
  const h = ready(book, 'romulan', IDX.Romulus)[0];
  disable(h); h.status = 'repairing';
  run(book, world, 2, 10);
  log.dh3 = { hull: h.hull, cond: cond(h), blockade: book.blockades[0].status };
  if (book.blockades[0].status === 'active') assert.equal(cond(h), 'disabled', `repaired inside an active blockade (${h.hull}/${h.maxHull})`);
});
check('preservation', 'DH-4. a real repair still works: a hulk at its own yard with nothing in the way is brought in and repaired — same record, same vid', () => {
  const { world, book } = galaxy('DH-4');
  const h = ready(book, 'romulan', IDX.Romulus)[0];
  const vid = h.identity?.vid, id = h.id, count = book.polities.romulan.hulls.length;
  disable(h); h.status = 'repairing';
  run(book, world, 2, 60);
  log.dh4 = { hull: h.hull, maxHull: h.maxHull, status: h.status, stranded: h.stranded || null };
  assert.equal(cond(h), 'operational');
  assert.equal(hullById(book, 'romulan', id), h); assert.equal(h.identity?.vid, vid);
  assert.equal(book.polities.romulan.hulls.filter((x) => x.identity?.vid === vid).length, 1, 'the vid was duplicated');
});
check('preservation', 'DH-5. a damaged but able hull still sails to a yard and is repaired (unchanged behaviour)', () => {
  const { world, book } = galaxy('DH-5');
  const h = ready(book, 'romulan', IDX.Romulus)[0];
  h.systemIndex = IDX.Aldnas; h.hull = Math.floor(h.maxHull * 0.4); h.status = 'ready';
  run(book, world, 2, 60);
  assert.equal(h.hull, h.maxHull); assert.equal(h.systemIndex, IDX.Romulus);
});
check('preservation', 'DH-6. a disabled hull survives save/load exactly as it was', () => {
  const { world, book } = galaxy('DH-6');
  const h = ready(book, 'romulan', IDX.Romulus)[0];
  h.systemIndex = IDX.Aldnas; disable(h); h.status = 'repairing';
  run(book, world, 2, 6);
  C.upgradeCampaignBook(book);
  const loaded = reload(book);
  const lh = hullById(loaded, 'romulan', h.id);
  assert.equal(lh.hull, h.hull); assert.equal(lh.systemIndex, h.systemIndex); assert.equal(lh.status, h.status);
  run(loaded, world, 7, 12); run(book, world, 7, 12);
  assert.equal(C.checksum(loaded), C.checksum(book));
});

if (out) { fs.mkdirSync(out, { recursive: true }); fs.writeFileSync(path.join(out, 'disabled-hull-log.json'), JSON.stringify({ results, log }, null, 1)); }
const by = (c) => { const r = results.filter((x) => x.category === c); return `${r.filter((x) => x.ok).length}/${r.length}`; };
console.log(`\ndisabled hulls: ${results.filter((x) => x.ok).length}/${results.length} (baseline-defect ${by('baseline-defect')}, preservation ${by('preservation')})`);
if (results.some((x) => !x.ok)) process.exit(1);
