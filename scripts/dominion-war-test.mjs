// Pure tests for Dominion formal-war integration (DOMINION-FORMAL-WAR-RULES-261233ZSEP26 §2, §5, §6).
import assert from 'node:assert/strict';
import * as WT from '../src/war-termination.mjs';
import * as C from '../src/campaign-strategy.mjs';
import { makeWorld } from './campaign-world-fixture.mjs';

let passed = 0;
const test = (name, fn) => { fn(); passed++; console.log('PASS', name); };
const side = (o = {}) => ({ name: o.name || 'x', strength: 1000, capacity: 1000, capShare: 0.8, strain: 0.9, worldsNow: 5, worldsAtStart: 5, worldsLost: 0, homeLost: false, losses: 3, ...o });
const war = (o = {}) => ({ age: 200, daysSinceFront: 5, engagements: 25, status: 'war', ceasefireDays: 0, quietSinceCeasefire: false, ...o });

test('an expeditionary side holding nothing is not beaten while its expedition is sustainable', () => {
  const exp = side({ name: 'Dominion', worldsNow: 0, worldsAtStart: 1, strength: 400, capShare: 0.4, expedition: { unsustainable: false, reasons: [] } });
  const v = WT.evaluateWar('dominion', 'bajoran', { dominion: exp, bajoran: side({ strength: 3000 }) }, war());
  assert.equal(v.outcome, 'continue', 'the home-world/worlds test was applied to an expedition');
});
test('an unsustainable, outmatched expedition loses decisively without its home realm being touched', () => {
  const exp = side({ name: 'Dominion', worldsNow: 0, worldsAtStart: 0, strength: 400, capShare: 0.2, expedition: { unsustainable: true, reasons: ['no way to replace losses'] } });
  const v = WT.evaluateWar('dominion', 'bajoran', { dominion: exp, bajoran: side({ strength: 3000 }) }, war());
  assert.equal(v.outcome, 'peace'); assert.equal(v.basis, 'decisive'); assert.equal(v.loser, 'dominion');
  assert.match(v.reason, /expedition can no longer sustain/);
});
test('an unsustainable expedition that is not outmatched is not a military defeat (withdrawal is the story\'s call)', () => {
  const exp = side({ strength: 1000, capShare: 0.2, expedition: { unsustainable: true, reasons: [] } });
  const v = WT.evaluateWar('dominion', 'bajoran', { dominion: exp, bajoran: side({ strength: 1200 }) }, war());
  assert.equal(v.outcome, 'continue');
});
test('a declared war is a formal war instance the model sees at once; withdrawal ends it as a normal settlement and deletes nothing', () => {
  const { world } = makeWorld();
  const book = C.createCampaignBook('seed-DW', 1); C.initializeCampaign(book, world);
  if (!book.polities.dominion || !book.polities.bajoran) { console.log('  (fixture has no dominion/bajoran polity; skipped)'); return; }
  const fx = [];
  const st = C.declareFormalWar(book, world, 'dominion', 'bajoran', 5, fx, { reason: 'test', source: 'authored', by: 'dominion' });
  assert.equal(st.status, 'war'); assert.ok(st.declared);
  assert.equal(fx.filter((e) => e.type === 'warDeclared').length, 1);
  assert.equal(fx[0].warId, st.warId);
  const hulls = book.polities.dominion.hulls.filter((h) => h.status !== 'lost').length;
  const fx2 = [];
  const w = C.withdrawExpedition(book, world, 6, fx2, { reason: 'ordered home' });
  const after = book.warStates[st.key];
  assert.equal(after.status, 'peace'); assert.equal(after.settlement.basis, 'withdrawal'); assert.equal(after.settlement.loser, 'dominion');
  assert.deepEqual(w.wars, [st.key]);
  assert.equal(book.dominion.phase, 'withdrawn');
  assert.equal(book.polities.dominion.hulls.filter((h) => h.status !== 'lost').length, hulls, 'the withdrawal deleted hulls');
  assert.ok(fx2.some((e) => e.type === 'warResolved' && e.basis === 'withdrawal'));
  assert.ok(fx2.some((e) => e.type === 'expeditionWithdrawn'));
});
test('a pact is an authored treaty record: eligibility is not a pact, only activation makes one, collapse ends it, and nobody inherits it', () => {
  const { world } = makeWorld({ relations: { 'cardassian:dominion': 'allied' } });
  const book = C.createCampaignBook('seed-PACT', 1); C.initializeCampaign(book, world);
  if (!book.polities.dominion || !book.polities.cardassian) { console.log('  (fixture has no dominion/cardassian polity; skipped)'); return; }
  assert.ok(book.config.dominionPactPartners.includes('cardassian'), 'precondition: Cardassia is eligible');
  assert.equal(C.pactActive(book, 'dominion', 'cardassian'), false, 'eligibility alone made a pact');
  assert.deepEqual(C.activePacts(book, 'dominion'), []);
  const fx = [];
  assert.equal(C.activatePact(book, world, 'dominion', 'terran', 3, fx).ok, false, 'an ineligible power was given a pact');
  assert.ok(C.activatePact(book, world, 'dominion', 'cardassian', 3, fx, 'authored').ok);
  assert.deepEqual(C.activePacts(book, 'dominion'), ['cardassian']);
  assert.deepEqual(C.activePacts(book, 'dominion_remnant'), [], 'the Remnant inherited a pact');
  assert.ok(C.endPact(book, world, 'dominion', 'cardassian', 9, fx, 'collapse').ok);
  assert.equal(C.pactActive(book, 'dominion', 'cardassian'), false);
  assert.equal(C.pactRecord(book, 'dominion', 'cardassian').status, 'collapsed');
  assert.deepEqual(fx.map((e) => `${e.type}:${e.status}`), ['pactChanged:active', 'pactChanged:collapsed']);
  assert.ok(fx.every((e) => e.secret === true));
});
test('secret history: one visibility rule; the book keeps the entries, a later revelation shows them unchanged', () => {
  const { world } = makeWorld({ relations: { 'cardassian:dominion': 'allied' } });
  const book = C.createCampaignBook('seed-SECRET', 1); C.initializeCampaign(book, world);
  if (!book.polities.dominion || !book.polities.cardassian) { console.log('  (fixture has no dominion/cardassian polity; skipped)'); return; }
  C.activatePact(book, world, 'dominion', 'cardassian', 3, [], 'authored');
  C.endPact(book, world, 'dominion', 'cardassian', 5, [], 'collapse');
  const kept = book.history.filter((h) => h.kind === 'treaty');
  assert.equal(kept.length, 2, 'the book lost a treaty event');
  assert.equal(C.visibleHistory(book, 'player').filter((h) => h.kind === 'treaty').length, 0, 'an unrevealed pact is visible');
  const texts = kept.map((h) => h.text);
  // A future intelligence round adds the captain to knownTo: the recorded history becomes visible as written.
  C.pactRecord(book, 'dominion', 'cardassian').knownTo.push('player');
  assert.deepEqual(C.visibleHistory(book, 'player').filter((h) => h.kind === 'treaty').map((h) => h.text), texts);
  assert.ok(C.historyVisibleTo(book, { kind: 'x', text: 'ordinary' }));
});
console.log(`${passed} Dominion-war unit groups passed.`);
