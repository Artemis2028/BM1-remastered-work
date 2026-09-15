import assert from 'node:assert/strict';
import * as W from '../src/faction-world.mjs';
let checks = 0;
function test(name, fn) {
  fn();
  checks++;
  console.log('PASS', name);
}
const pairs = [
  ['romulan', 'klingon'],
  ['terran', 'ferengi'],
  ['terran', 'klingon'],
];
const base = (a, b) => [a, b].includes('terran') && [a, b].includes('klingon');
test('bilateral war and peace override lore without changing faction identity', () => {
  const b = W.createDiplomacy('one');
  W.setDiplomacy(b, 'romulan', 'klingon', 'war', 1);
  assert.equal(W.relation(b, 'klingon', 'romulan').status, 'war');
  W.setDiplomacy(b, 'klingon', 'romulan', 'peace', 2);
  assert.equal(W.relation(b, 'romulan', 'klingon').status, 'peace');
});
test('crisis spike can reach war; treaty blocks fresh incidents', () => {
  const b = W.createDiplomacy('spike');
  W.setDiplomacy(b, 'romulan', 'klingon', 'crisis', 1);
  W.spikeCrisis(b, 'romulan', 'klingon', 20, 2);
  assert.equal(W.relation(b, 'romulan', 'klingon').status, 'war');
  W.setDiplomacy(b, 'romulan', 'klingon', 'peace', 3);
  W.spikeCrisis(b, 'romulan', 'klingon', 100, 4);
  assert.equal(W.relation(b, 'romulan', 'klingon').status, 'peace');
});
test('daily, multiday and JSON-reloaded progression are identical and cannot reroll', () => {
  const a = W.createDiplomacy('replay'),
    b = W.createDiplomacy('replay');
  W.advanceDiplomacy(a, 900, pairs, base);
  for (let d = 2; d <= 900; d++) W.advanceDiplomacy(b, d, pairs, base);
  assert.deepEqual(a, b);
  const copy = JSON.parse(JSON.stringify(a));
  W.advanceDiplomacy(copy, 900, pairs, base);
  assert.deepEqual(copy, a);
  W.advanceDiplomacy(copy, 1200, pairs, base);
  W.advanceDiplomacy(a, 1200, pairs, base);
  assert.deepEqual(copy, a);
});
test('natural simulation includes crises, escalation, mediation and war exhaustion', () => {
  const reasons = new Set(),
    states = new Set();
  for (let seed = 0; seed < 30; seed++) {
    const b = W.createDiplomacy(seed);
    W.advanceDiplomacy(b, 1000, pairs, base);
    for (const e of b.history) {
      reasons.add(e.reason);
      states.add(e.status);
    }
  }
  assert.ok(states.has('war') && states.has('peace') && states.has('crisis'));
  assert.ok(reasons.has('Mediation resolves the crisis'));
  assert.ok(reasons.has('War exhaustion and negotiated peace'));
});
test('Romulan trade abroad is rare while wartime deployments outweigh merchants', () => {
  assert.ok(
    W.civilianWeight('romulan', 'terran', false) <
      W.civilianWeight('ferengi', 'terran', false) / 20,
  );
  assert.equal(W.civilianWeight('romulan', 'terran', true), 0);
  assert.equal(W.civilianWeight('romulan', 'romulan', false), 2);
  assert.ok(W.FACTION_TRAFFIC.romulan.warDeployment > W.FACTION_TRAFFIC.ferengi.warDeployment);
});
test('non-diplomatic factions cannot sign treaties and invalid states fail', () => {
  const b = W.createDiplomacy('x');
  assert.throws(() => W.setDiplomacy(b, 'borg', 'romulan', 'peace', 1));
  assert.throws(() => W.setDiplomacy(b, 'romulan', 'romulan', 'war', 1));
  assert.throws(() => W.setDiplomacy(b, 'terran', 'romulan', 'invalid', 1));
});
console.log(`${checks}/${checks} world model groups passed.`);
