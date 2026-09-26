// Pure tests for the war authority a formation's attack order rests on
// (FORMATION-ROUTE-TRAVERSAL-RULES-261700ZSEP26).
import assert from 'node:assert/strict';
import * as C from '../src/campaign-strategy.mjs';
import { makeWorld } from './campaign-world-fixture.mjs';

let passed = 0;
const test = (name, fn) => { fn(); passed++; console.log('PASS', name); };
const setup = (seed) => {
  const { world } = makeWorld();
  const book = C.createCampaignBook(seed, 1); C.initializeCampaign(book, world);
  return { world, book };
};

test('an attack order is stamped only against a world held by a power formally at war with the sender', () => {
  const { world, book } = setup('FR-1');
  const stamp = C.warAuthorityStamp(book, world, 'terran', 2);
  assert.ok(stamp); assert.equal(stamp.holder, 'klingon'); assert.equal(stamp.key, C.warKey('terran', 'klingon'));
  assert.equal(C.warAuthorityStamp(book, world, 'terran', 4), null, 'no war with the Romulans');
  assert.equal(C.warAuthorityStamp(book, world, 'terran', 1), null, 'its own world');
  assert.ok(C.warAuthorityHolds(book, world, stamp));
  assert.equal(C.warAuthorityHolds(book, world, null), false);
});
test('a ceasefire or a peace ends the authority; a later new war does not revive the old order', () => {
  const { world, book } = setup('FR-2');
  C.forceWarTransition(book, world, 'terran', 'klingon', 'war', 1, 'fixture');
  const stamp = C.warAuthorityStamp(book, world, 'terran', 2);
  assert.ok(stamp, 'precondition');
  C.forceWarTransition(book, world, 'terran', 'klingon', 'ceasefire', 2, 'fixture');
  assert.equal(C.warAuthorityHolds(book, world, stamp), false, 'held through a ceasefire');
  assert.equal(C.warAuthorityStamp(book, world, 'terran', 2), null, 'a new attack under a ceasefire');
  C.forceWarTransition(book, world, 'terran', 'klingon', 'peace', 3, 'fixture');
  const fx = [];
  C.declareFormalWar(book, world, 'terran', 'klingon', 4, fx, { reason: 'fixture' });
  const fresh = C.warAuthorityStamp(book, world, 'terran', 2);
  assert.ok(fresh, 'no authority in the new war');
  assert.equal(C.warAuthorityHolds(book, world, stamp), false, 'the old order came back with the new war');
  assert.ok(C.warAuthorityHolds(book, world, fresh));
});
test('the target changing hands ends the authority', () => {
  const { world, book } = setup('FR-3');
  const stamp = C.warAuthorityStamp(book, world, 'terran', 2);
  world.systems[2].controller = 'cardassian';
  assert.equal(C.warAuthorityHolds(book, world, stamp), false);
});

console.log(`formation-route pure: ${passed} passed`);
