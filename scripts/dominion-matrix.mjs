// The Dominion entry decision, as a matrix: calendar age varied independently of everything else, so
// the claim "campaign day is not an opportunity score" is evidence rather than an assertion in a
// comment. Every row authors a strategic state and asks dominionOpportunity() for the decision; the
// table is printed in full so a reviewer can read the reasons, and the invariants below are checked.
// [17SEP spec §8, §9]
import assert from 'node:assert/strict';
import * as C from '../src/campaign-strategy.mjs';
import { makeWorld, run, station } from './campaign-world-fixture.mjs';

const AGES = [200, 800, 2000];

// Histories, authored rather than waited for. Each one leaves the galaxy in a named strategic state.
const HISTORIES = {
  'quiet': (book, world) => {},
  'fought-not-worn': (book) => {
    const w = C.warRecord(book, 'terran', 'klingon'); w.engagements = 20; w.firstDay = 2; w.lastDay = 100;
    w.losses.terran = 30; w.losses.klingon = 30;
  },
  'worn-stalemate': (book, world, day) => {
    HISTORIES['fought-not-worn'](book, world, day);
    for (const id of ['terran', 'klingon']) wreck(book, id, 0.3);
  },
  'front-moving': (book, world, day) => {
    HISTORIES['worn-stalemate'](book, world, day);
    const w = C.warRecord(book, 'terran', 'klingon'); w.captures.klingon = 9; w.captures.terran = 1;
  },
  'strong-victor': (book, world, day) => {
    const w = C.warRecord(book, 'terran', 'klingon'); w.engagements = 20; w.firstDay = 2; w.lastDay = 100;
    book.resolutions = { 'terran:klingon': { day: 100, loser: 'klingon', winner: 'terran', reason: 'fixture' } };
    wreck(book, 'klingon', 0);
  },
  'weak-victor': (book, world, day) => {
    HISTORIES['strong-victor'](book, world, day);
    wreck(book, 'terran', 0.35);
  },
};

// Third parties whose presence should change the decision on its own.
const POWERS = {
  'none': () => {},
  'player-empire': (book, world) => {
    const p = C.ensurePolity(book, 'player');
    for (let i = 0; i < 100; i++) p.hulls.push(hull(`pl${i}`, 12, 0));
    p.readinessPeak = C.polityReadiness(book, world, 'player').strength;
  },
};

const CORRIDORS = { 'open': () => ({}), 'fortified': () => ({ stations: { 6: fortify(12) } }) };

function hull(id, shipId, systemIndex) { return { id, shipId, hull: 1400, maxHull: 1400, crew: 1, systemIndex, status: 'ready', opId: null }; }
function fortify(n) { const out = []; for (let i = 0; i < n; i++) out.push(station(`baj-fort${i}`, 87, 'bajoran')); return out; }
function wreck(book, id, keep) {
  const p = C.getPolity(book, id);
  const living = p.hulls.filter((h) => h.status !== 'lost');
  const survivors = keep <= 0 ? 0 : Math.max(1, Math.round(living.length * keep));
  for (const h of living.slice(survivors)) h.status = 'lost';
}

function row(age, historyKey, corridorKey, powerKey) {
  const { world } = makeWorld(CORRIDORS[corridorKey]());
  const book = C.createCampaignBook(`matrix:${historyKey}:${corridorKey}:${powerKey}`, 1);
  C.initializeCampaign(book, world);
  // A short settled run so every polity has a real capacity reference, then the authored history. The
  // age is applied to the decision only: nothing about the galaxy depends on how long the captain took.
  run(book, world, 2, 60);
  HISTORIES[historyKey](book, world, age);
  POWERS[powerKey](book, world);
  const o = C.dominionOpportunity(book, world, age);
  return { age, history: historyKey, corridor: corridorKey, power: powerKey,
    open: o.open, balance: o.balance || '-', engagements: o.engagements,
    corridorOpen: o.corridorOpen, challengeable: o.challengeable,
    strongestNear: o.strongestNear, reason: o.reasons[0] || '' };
}

const rows = [];
for (const age of AGES) for (const h of Object.keys(HISTORIES)) for (const c of Object.keys(CORRIDORS)) for (const p of Object.keys(POWERS)) rows.push(row(age, h, c, p));

const pad = (v, n) => String(v).padEnd(n).slice(0, n);
console.log(`${pad('age', 6)}${pad('history', 18)}${pad('corridor', 11)}${pad('power', 14)}${pad('entry', 7)}${pad('balance', 17)}${pad('near', 7)}reason`);
for (const r of rows) console.log(`${pad(r.age, 6)}${pad(r.history, 18)}${pad(r.corridor, 11)}${pad(r.power, 14)}${pad(r.open ? 'OPEN' : 'closed', 7)}${pad(r.balance, 17)}${pad(r.strongestNear, 7)}${r.reason}`);

let checks = 0;
const check = (name, fn) => { fn(); checks++; console.log('PASS', name); };
const find = (age, history, corridor = 'open', power = 'none') => rows.find((r) => r.age === age && r.history === history && r.corridor === corridor && r.power === power);

check('calendar age is not an input: the same history decides the same way at 200, 800 and 2,000 days', () => {
  for (const h of Object.keys(HISTORIES)) for (const c of Object.keys(CORRIDORS)) for (const p of Object.keys(POWERS)) {
    const decisions = AGES.map((age) => find(age, h, c, p).open);
    assert.equal(new Set(decisions).size, 1,
      `history "${h}" (corridor ${c}, power ${p}) decided ${decisions.join('/')} at ${AGES.join('/')} days`);
  }
});

check('a quiet galaxy never opens, however old it gets', () => {
  for (const age of AGES) {
    const r = find(age, 'quiet');
    assert.equal(r.open, false, `a galaxy that has fought nobody opened at day ${age}`);
    assert.match(r.reason, /consequential engagement/);
  }
});

check('fighting without cost is not an opening; fighting that wore both sides down is', () => {
  assert.equal(find(800, 'fought-not-worn').open, false, 'twenty engagements that cost nobody their capacity opened the door');
  assert.equal(find(800, 'worn-stalemate').open, true, `a worn-down stalemate did not: ${find(800, 'worn-stalemate').reason}`);
  assert.equal(find(800, 'worn-stalemate').balance, 'stalemate');
});

check('a front that is still moving is not a stalemate', () => {
  const r = find(800, 'front-moving');
  assert.equal(r.open, false, 'a side taking worlds nine to one read as a costly stalemate');
  assert.match(r.reason, /front is moving/);
});

check('a victor that is still standing closes the opening; a wrecked one presents it', () => {
  assert.equal(find(800, 'strong-victor').open, false, 'an intact victor presented an opening');
  assert.match(find(800, 'strong-victor').reason, /still holds/);
  assert.equal(find(800, 'weak-victor').open, true, `a wrecked victor did not: ${find(800, 'weak-victor').reason}`);
  assert.equal(find(800, 'weak-victor').balance, 'weakened-victor');
});

check('a fortified entry closes the corridor whatever the war did', () => {
  for (const h of Object.keys(HISTORIES)) for (const age of AGES) {
    assert.equal(find(age, h, 'fortified').open, false, `history "${h}" crossed a fortified corridor at day ${age}`);
    assert.equal(find(age, h, 'fortified').corridorOpen, false);
  }
});

check('a player empire that has become the strongest power here delays the opening', () => {
  const without = find(800, 'worn-stalemate', 'open', 'none');
  const with_ = find(800, 'worn-stalemate', 'open', 'player-empire');
  assert.equal(without.open, true, 'precondition: the same galaxy without the player empire is an opening');
  assert.equal(with_.open, false, `a player empire fielding ${with_.strongestNear} did not delay it`);
  assert.equal(with_.challengeable, false);
  assert.match(with_.reason, /the near side still fields/);
});

console.log(`${checks}/${checks} entry-decision invariants hold across ${rows.length} matrix rows.`);
