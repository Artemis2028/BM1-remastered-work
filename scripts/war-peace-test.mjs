// Pure tests for bilateral war termination (BILATERAL-WAR-PEACE-RULES §3–§5).
import assert from 'node:assert/strict';
import * as WT from '../src/war-termination.mjs';
import * as C from '../src/campaign-strategy.mjs';
import { makeWorld, run } from './campaign-world-fixture.mjs';

let passed = 0;
const test = (name, fn) => { fn(); passed++; console.log('PASS', name); };
const side = (o = {}) => ({ name: o.name || 'x', strength: 1000, capacity: 1000, capShare: 0.8, strain: 0.9, worldsNow: 5, worldsAtStart: 5, worldsLost: 0, homeLost: false, losses: 3, ...o });
const war = (o = {}) => ({ age: 200, daysSinceFront: 100, engagements: 25, status: 'war', ceasefireDays: 0, quietSinceCeasefire: false, ...o });

test('a war with capacity and a moving front continues, whatever its age', () => {
  const v = WT.evaluateWar('a', 'b', { a: side(), b: side() }, war({ age: 900, daysSinceFront: 5 }));
  assert.equal(v.outcome, 'continue');
});
test('a long, costly, stalled war between capable powers becomes a ceasefire with no winner', () => {
  const v = WT.evaluateWar('a', 'b', { a: side({ capShare: 0.7 }), b: side({ capShare: 0.65, strength: 700 }) }, war());
  assert.equal(v.outcome, 'ceasefire'); assert.equal(v.basis, 'stalemate'); assert.equal(v.winner, null);
});
test('exhaustion shortens the windows but never ends a war with a moving front on its own', () => {
  const tired = { a: side({ capShare: 0.4 }), b: side({ capShare: 0.45 }) };
  assert.equal(WT.evaluateWar('a', 'b', tired, war({ age: 60, daysSinceFront: 35 })).basis, 'exhaustion');
  assert.equal(WT.evaluateWar('a', 'b', tired, war({ age: 60, daysSinceFront: 10 })).outcome, 'continue');
  assert.equal(WT.evaluateWar('a', 'b', { a: side(), b: side() }, war({ age: 60, daysSinceFront: 35 })).outcome, 'continue');
});
test('an unpaid war (no engagements, no losses) is not a stalemate however quiet', () => {
  assert.equal(WT.evaluateWar('a', 'b', { a: side({ losses: 0 }), b: side() }, war({ engagements: 2 })).outcome, 'continue');
});
test('decisive: worn down, lost ground, outmatched — without every world falling; a power that never held ground cannot lose it', () => {
  const v = WT.evaluateWar('a', 'b', { a: side({ strength: 3000 }), b: side({ strength: 300, capShare: 0.2, worldsLost: 2, worldsAtStart: 6, worldsNow: 4 }) }, war({ daysSinceFront: 1 }));
  assert.equal(v.outcome, 'peace'); assert.equal(v.basis, 'decisive'); assert.equal(v.winner, 'a');
  const none = WT.evaluateWar('a', 'b', { a: side(), b: side({ worldsNow: 0, worldsAtStart: 0 }) }, war({ daysSinceFront: 1 }));
  assert.equal(none.outcome, 'continue');
});
test('a ceasefire settles into peace only after its quiet period', () => {
  assert.equal(WT.evaluateWar('a', 'b', { a: side(), b: side() }, war({ status: 'ceasefire', ceasefireDays: 10, quietSinceCeasefire: true })).outcome, 'continue');
  assert.equal(WT.evaluateWar('a', 'b', { a: side(), b: side() }, war({ status: 'ceasefire', ceasefireDays: 30, quietSinceCeasefire: true })).outcome, 'peace');
});
test('terms: decisive keeps the winner\'s gains and returns the loser\'s; negotiated returns, disputes or retains by people and strength', () => {
  const occ = [{ systemIndex: 1, holder: 'a', claimant: 'b', claimantPeople: true }, { systemIndex: 2, holder: 'b', claimant: 'a', claimantPeople: true }, { systemIndex: 3, holder: 'a', claimant: 'b', claimantPeople: false }];
  const d = WT.settlementTerms('decisive', 'a', occ, { a: 10, b: 1 });
  assert.deepEqual(d.map((x) => x.term), ['retained_by_occupier', 'returned_to_previous_controller', 'retained_by_occupier']);
  const n = WT.settlementTerms('settlement', null, occ, { a: 10, b: 5 });
  assert.deepEqual(n.map((x) => x.term), ['disputed', 'returned_to_previous_controller', 'retained_by_occupier']);
});
test('model: a settlement is bilateral, stands down only that pair\'s operations, and is recorded once', () => {
  const { world } = makeWorld();
  const book = C.createCampaignBook('seed-P', 1); C.initializeCampaign(book, world);
  run(book, world, 2, 30);
  const other = book.operations.filter((o) => o.status !== 'resolved' && o.faction === 'cardassian').map((o) => o.id);
  const fx = C.forceWarTransition(book, world, 'terran', 'klingon', 'ceasefire', 30, 'test');
  assert.ok(book.operations.filter((o) => ['terran', 'klingon'].includes(o.faction) && o.status !== 'resolved').every((o) => ![world.systems[o.targetSystem]?.controller].includes(o.faction === 'terran' ? 'klingon' : 'terran')), 'a Terran–Klingon operation survived the ceasefire');
  assert.ok(fx.some((e) => e.type === 'warCeasefire' && e.key === 'klingon:terran'));
  assert.ok(book.operations.filter((o) => other.includes(o.id)).every((o) => o.status !== 'resolved' || o.outcome !== 'stood-down' || o.resolvedDay !== 30), 'a Cardassian operation was stood down by a Terran–Klingon ceasefire');
  assert.equal(book.warStates['klingon:terran'].status, 'ceasefire');
  assert.equal(book.warStates['cardassian:terran']?.status ?? 'war', 'war');
  const again = run(book, world, 31, 45).filter((e) => e.type === 'operationLaunched' && ['terran', 'klingon'].includes(e.faction) && [e.faction === 'terran' ? 'klingon' : 'terran'].includes(world.systems[e.targetSystem]?.controller));
  assert.equal(again.length, 0, 'the pair planned against each other during the ceasefire');
});
console.log(`${passed} war/peace unit groups passed.`);
