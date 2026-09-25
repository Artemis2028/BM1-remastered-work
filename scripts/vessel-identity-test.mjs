// Pure tests for the vessel identity module and the campaign book's side of it.
import assert from 'node:assert/strict';
import * as Identity from '../src/vessel-identity.mjs';
import * as Campaign from '../src/campaign-strategy.mjs';

let passed = 0;
const test = (name, fn) => { fn(); passed++; console.log('PASS', name); };

test('an identity carries a vid, design, name, seed and an origin written once', () => {
  const a = Identity.makeIdentity({ vid: 'v1', shipId: 7, name: 'Kor', seed: 99, builder: 'klingon', via: 'built', day: 4, systemIndex: 2 });
  assert.deepEqual(a.origin, { builder: 'klingon', via: 'built', day: 4, systemIndex: 2, legacy: false });
  assert.equal(a.seed, 99);
  assert.throws(() => Identity.makeIdentity({ shipId: 7 }));
  // No vid, no identity: normalising never invents one.
  assert.equal(Identity.normalizeIdentity({ shipId: 7 }), null);
});

test('provenance is bounded and takenFrom reads the last capture', () => {
  const a = Identity.makeIdentity({ vid: 'v2', shipId: 1 });
  for (let i = 0; i < 40; i++) Identity.recordProvenance(a, { day: i, event: 'moved' });
  Identity.recordProvenance(a, { day: 50, event: 'captured', from: 'romulan', to: 'player' });
  assert.equal(a.history.length, Identity.HISTORY_LIMIT);
  assert.equal(Identity.takenFrom(a), 'romulan');
});

test('retirement is recorded once and bounded; ids are never reused by the registry', () => {
  const book = {};
  const a = Identity.makeIdentity({ vid: 'v3', shipId: 1, name: 'A' });
  const first = Identity.retireVessel(book, a, { day: 3, cause: 'destroyed' });
  const again = Identity.retireVessel(book, a, { day: 9, cause: 'sold' });
  assert.equal(again, first);
  assert.equal(Identity.retiredVessel(book, 'v3').cause, 'destroyed');
  for (let i = 0; i < Identity.RETIRED_LIMIT + 5; i++) Identity.retireVessel(book, Identity.makeIdentity({ vid: `x${i}`, shipId: 1 }), { cause: 'destroyed' });
  assert.equal(Object.keys(book.vesselRegistry.retired).length, Identity.RETIRED_LIMIT);
});

test('registry marks are stable and distinct for distinct vids', () => {
  assert.equal(Identity.registryMark('a:b:1'), Identity.registryMark('a:b:1'));
  assert.notEqual(Identity.registryMark('a:b:1'), Identity.registryMark('a:b:2'));
});

test('campaign hull migration is deterministic and does not touch a hull that has one', () => {
  const make = () => ({ seed: 's', counter: 0, settled: 5, polities: {
    klingon: { hulls: [{ id: 's:hull:1', shipId: 3, systemIndex: 4, status: 'ready' }, { id: 's:hull:2', shipId: 3, systemIndex: 4, status: 'ready' }] },
    player: { hulls: [{ id: 'pf:x', shipId: 1 }] } } });
  const a = make(), b = make();
  Campaign.migrateHullIdentities(a); Campaign.migrateHullIdentities(b);
  assert.deepEqual(a.polities.klingon.hulls.map((h) => h.identity), b.polities.klingon.hulls.map((h) => h.identity));
  const [h1, h2] = a.polities.klingon.hulls;
  assert.equal(h1.identity.vid, h1.id);
  assert.notEqual(h1.identity.seed, h2.identity.seed, 'two hulls of one class share a seed');
  assert.equal(h1.identity.origin.legacy, true);
  assert.equal(a.polities.player.hulls[0].identity, undefined, 'player mirrors are not given identities of their own');
  const before = JSON.stringify(h1.identity);
  a.identityVersion = undefined;
  Campaign.migrateHullIdentities(a);
  assert.equal(JSON.stringify(h1.identity), before);
});

test('a hull taken out of its books leaves with its identity and a capture entry, and is not retired', () => {
  const book = { seed: 's', counter: 0, settled: 5, stats: {}, operations: [], config: {}, polities: { romulan: { hulls: [{ id: 's:hull:7', shipId: 3, systemIndex: 4, status: 'ready' }] } } };
  Campaign.migrateHullIdentities(book);
  const out = Campaign.transferHullOut(book, 's:hull:7', { day: 12, to: 'player', systemIndex: 4 });
  assert.equal(out.identity.vid, 's:hull:7');
  assert.equal(Identity.takenFrom(out.identity), 'romulan');
  assert.equal(book.polities.romulan.hulls[0].status, 'lost');
  assert.equal(book.polities.romulan.hulls[0].fate, 'captured');
  assert.equal(Campaign.transferHullOut(book, 's:hull:7', { day: 13 }), null, 'a hull can be taken once');
});

console.log(`${passed} vessel identity unit groups passed.`);
