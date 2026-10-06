// The Dominion entry decision, as a matrix: calendar age varied independently of everything else, so
// the claim "campaign day is not an opportunity score" is evidence rather than an assertion in a
// comment. Every row authors a strategic state and asks dominionOpportunity() for the decision; the
// table is printed in full so a reviewer can read the reasons, and the invariants below are checked.
//
// The ages include 1, 119, 120 and 121 deliberately. An earlier version of this model had a day-120
// floor and a matrix that only sampled 200, 800 and 2,000 — every sample above the boundary, so the
// age-independence claim it printed was not tested where it could have failed. There is no floor now,
// and the boundary is sampled anyway.
// [17SEP spec §8, §9]
import assert from 'node:assert/strict';
import * as C from '../src/campaign-strategy.mjs';
import { makeWorld, run, station } from './campaign-world-fixture.mjs';

const AGES = [1, 119, 120, 121, 800, 2000];

// Histories, authored rather than waited for. Each one leaves the galaxy in a named strategic state.
const HISTORIES = {
  'quiet': () => {},
  'fought-not-worn': (book) => {
    const w = C.warRecord(book, 'terran', 'klingon'); w.engagements = 30; w.firstDay = 2; w.lastDay = 100;
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
  'strong-victor': (book) => {
    const w = C.warRecord(book, 'terran', 'klingon'); w.engagements = 30; w.firstDay = 2; w.lastDay = 100;
    book.resolutions = { 'terran:klingon': { day: 100, loser: 'klingon', winner: 'terran', reason: 'fixture' } };
    wreck(book, 'klingon', 0);
  },
  'weak-victor': (book, world, day) => {
    HISTORIES['strong-victor'](book, world, day);
    wreck(book, 'terran', 0.35);
  },
};

// The war economy, varied independently of the fleet. A war that cost hulls and nothing else is one
// somebody can still fight; this is the dimension an earlier version of the model did not read at all.
const ECONOMIES = {
  'solvent': () => {},
  'bankrupt': (book) => { for (const id of ['terran', 'klingon']) { const p = C.getPolity(book, id); p.treasury = 0; p.revenueLastDay = 0; } },
};

// Third parties whose presence should change the decision on its own.
const POWERS = {
  'none': () => {},
  'player-empire': (book, world) => {
    const p = C.ensurePolity(book, 'player');
    for (let i = 0; i < 100; i++) p.hulls.push(hull(`pl${i}`, 12, 0));
    p.readinessPeak = C.polityReadiness(book, world, 'player').strength;
  },
  'distant-romulan': (book, world) => {
    // Four route-hops from the entry in this fixture — Romulus, Vega, Border, Cardassia, Bajora — and
    // never on anybody's hand-written near-side list, but a navy that size can answer a crossing, and a
    // model that ignored it called the galaxy defenceless. (An earlier version of this file called it
    // "eight jumps away", which was the configured limit rather than the measured distance. The exact
    // boundary is tested below, at the hop count and one past it, rather than asserted in a label.)
    const p = C.getPolity(book, 'romulan');
    for (let i = 0; i < 100; i++) p.hulls.push(hull(`rom${i}`, 31, 4));
    p.readinessPeak = C.polityReadiness(book, world, 'romulan').strength;
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

// Enough offered chances that the opportunity gate is satisfied; the gate itself is varied in its own
// block below rather than across every row of this table.
const PLAYED = { systemsVisited: 40, journeys: 60, issuers: 12, contacts: 5 };

function build(historyKey, corridorKey, powerKey, economyKey, opportunity = PLAYED) {
  const { world } = makeWorld({ ...CORRIDORS[corridorKey](), playerOpportunity: opportunity });
  const book = C.createCampaignBook(`matrix:${historyKey}:${corridorKey}:${powerKey}:${economyKey}`, 1);
  C.initializeCampaign(book, world);
  // A short settled run so every polity has a real capacity and economic reference, then the authored
  // state. The age is applied to the decision only: nothing about the galaxy depends on how long the
  // captain took to get here.
  run(book, world, 2, 60);
  HISTORIES[historyKey](book, world, 0);
  ECONOMIES[economyKey](book, world);
  POWERS[powerKey](book, world);
  return { book, world };
}

function row(age, historyKey, corridorKey, powerKey, economyKey) {
  const { book, world } = build(historyKey, corridorKey, powerKey, economyKey);
  const o = C.dominionOpportunity(book, world, age);
  return { age, history: historyKey, corridor: corridorKey, power: powerKey, economy: economyKey,
    open: o.open, balance: o.balance || '-', engagements: o.engagements,
    corridorOpen: o.corridorOpen, challengeable: o.challengeable, strained: o.strained.length,
    strongestNear: o.strongestNear, defenders: o.defenders.map((d) => d.id).join('+'),
    reason: o.reasons[0] || '' };
}

const rows = [];
for (const age of AGES) for (const h of Object.keys(HISTORIES)) for (const c of Object.keys(CORRIDORS)) for (const p of Object.keys(POWERS)) for (const e of Object.keys(ECONOMIES)) rows.push(row(age, h, c, p, e));

const pad = (v, n) => String(v).padEnd(n).slice(0, n);
console.log(`${pad('age', 6)}${pad('history', 18)}${pad('corridor', 11)}${pad('power', 16)}${pad('economy', 10)}${pad('entry', 7)}${pad('balance', 17)}${pad('near', 8)}reason`);
for (const r of rows) console.log(`${pad(r.age, 6)}${pad(r.history, 18)}${pad(r.corridor, 11)}${pad(r.power, 16)}${pad(r.economy, 10)}${pad(r.open ? 'OPEN' : 'closed', 7)}${pad(r.balance, 17)}${pad(r.strongestNear, 8)}${r.reason}`);

let checks = 0;
const check = (name, fn) => { fn(); checks++; console.log('PASS', name); };
const find = (age, history, corridor = 'open', power = 'none', economy = 'bankrupt') =>
  rows.find((r) => r.age === age && r.history === history && r.corridor === corridor && r.power === power && r.economy === economy);

check('calendar age is not an input, at every age including where a floor used to be', () => {
  for (const h of Object.keys(HISTORIES)) for (const c of Object.keys(CORRIDORS)) for (const p of Object.keys(POWERS)) for (const e of Object.keys(ECONOMIES)) {
    const decisions = AGES.map((age) => find(age, h, c, p, e).open);
    assert.equal(new Set(decisions).size, 1,
      `history "${h}" (corridor ${c}, power ${p}, economy ${e}) decided ${decisions.join('/')} at ${AGES.join('/')} days`);
  }
  const boundary = [119, 120, 121].map((age) => find(age, 'worn-stalemate').open);
  assert.deepEqual(boundary, [true, true, true], 'the decision moved across the day-120 boundary a floor used to sit on');
  assert.equal(find(1, 'worn-stalemate').open, true, 'a galaxy already in this state on day 1 was refused for being young');
});

check('a quiet galaxy never opens, however old it gets', () => {
  for (const age of AGES) {
    const r = find(age, 'quiet');
    assert.equal(r.open, false, `a galaxy that has fought nobody opened at day ${age}`);
    assert.match(r.reason, /consequential engagement/);
  }
});

check('fighting without cost is not an opening; fighting that wore both sides down is', () => {
  assert.equal(find(800, 'fought-not-worn').open, false, 'thirty engagements that cost nobody their capacity opened the door');
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

check('a solvent war economy closes the opening that a bankrupt one presents', () => {
  const broke = find(800, 'worn-stalemate', 'open', 'none', 'bankrupt');
  const rich = find(800, 'worn-stalemate', 'open', 'none', 'solvent');
  assert.equal(broke.open, true, 'precondition: a bankrupt worn-down near side is an opening');
  assert.equal(broke.strained > 0, true);
  assert.equal(rich.open, false,
    'identical fleets and identical war history, one side broke and one side rich, produced the same decision');
  assert.match(rich.reason, /economically strained/);
});

check('a strong power several jumps away is a contender, and closes the opening', () => {
  const alone = find(800, 'worn-stalemate', 'open', 'none');
  const withRomulans = find(800, 'worn-stalemate', 'open', 'distant-romulan');
  assert.equal(alone.open, true, 'precondition: the same galaxy without a distant navy is an opening');
  assert.ok(withRomulans.defenders.includes('romulan'), `the contender set was ${withRomulans.defenders}`);
  assert.equal(withRomulans.open, false, `a navy of ${withRomulans.strongestNear} several jumps away did not close it`);
  assert.equal(withRomulans.challengeable, false);
});

check('a player empire that has become the strongest power here delays the opening', () => {
  const without = find(800, 'worn-stalemate', 'open', 'none');
  const with_ = find(800, 'worn-stalemate', 'open', 'player-empire');
  assert.equal(without.open, true, 'precondition: the same galaxy without the player empire is an opening');
  assert.equal(with_.open, false, `a player empire fielding ${with_.strongestNear} did not delay it`);
  assert.equal(with_.challengeable, false);
});

// --- contender reach, at the exact boundary rather than at a comfortable distance ---
check('contender membership is decided at the configured hop count, not near it', () => {
  // Measured, not assumed: whatever the fixture's route graph actually is, this asks it.
  const { world: probe } = makeWorld();
  const hopsOf = (w, id) => Math.min(...w.systems.filter((s) => s.controller === id)
    .map((s) => w.routeHops([s.index], 6, id)).filter((h) => h != null));
  const romulanHops = hopsOf(probe, 'romulan');
  assert.ok(Number.isFinite(romulanHops) && romulanHops > 1,
    `the fixture puts Romulus ${romulanHops} hops from the entry; this check needs it further than the entry's own neighbours`);
  const at = (hops) => {
    const { world } = makeWorld({ playerOpportunity: PLAYED });
    const book = C.createCampaignBook(`hops:${hops}`, 1, { dominionContenderHops: hops });
    C.initializeCampaign(book, world);
    run(book, world, 2, 60);
    HISTORIES['worn-stalemate'](book, world, 0);
    ECONOMIES.bankrupt(book, world);
    POWERS['distant-romulan'](book, world);
    return C.dominionOpportunity(book, world, 800);
  };
  const inside = at(romulanHops);
  const outside = at(romulanHops - 1);
  console.log(`   Romulus is ${romulanHops} route-hops from the entry; contenders at ${romulanHops}: ${inside.defenders.map((d) => d.id).join('+')}; at ${romulanHops - 1}: ${outside.defenders.map((d) => d.id).join('+')}`);
  assert.ok(inside.defenders.some((d) => d.id === 'romulan'),
    `at exactly ${romulanHops} hops the navy was not a contender: ${inside.defenders.map((d) => d.id).join('+')}`);
  assert.equal(inside.open, false, 'and it did not close the opening');
  assert.ok(!outside.defenders.some((d) => d.id === 'romulan'),
    `one hop short of it the navy was still counted: ${outside.defenders.map((d) => d.id).join('+')}`);
  assert.equal(outside.open, true, `and the opening did not return: ${outside.reasons.join(' | ')}`);
});

// The shipped limit is eight hops, and the authored galaxy is not eight hops wide, so the previous
// round could only show the comparison working at four and three. This builds a corridor of empty
// systems long enough to put a navy at exactly eight hops and at exactly nine, and tests the shipped
// value where it actually decides. [review]
check('at the shipped limit, a navy at eight hops is a contender and one at nine is not', () => {
  const LIMIT = C.CAMPAIGN_RULES.dominionContenderHops;
  const at = (hops) => {
    const { world } = makeWorld({ playerOpportunity: PLAYED });
    // Romulus is given up: the Romulan navy's only ground is one world at the far end of a corridor of
    // empty systems hanging off Earth, so its distance from the entry is exactly what this builds.
    const anchor = 0;
    const anchorHops = world.routeHops([anchor], 6, 'terran');
    assert.ok(Number.isFinite(anchorHops) && anchorHops < hops,
      `the anchor is ${anchorHops} hops out; a corridor to ${hops} cannot be built from it`);
    world.systems[4].controller = null;
    let prev = anchor;
    for (let h = anchorHops + 1; h <= hops; h++) {
      const index = world.systems.length;
      world.systems.push({ index, name: `Corridor${h}`, controller: h === hops ? 'romulan' : null, origin: null, population: 0 });
      world.routes.push([prev, index]);
      prev = index;
    }
    const book = C.createCampaignBook(`corridor:${hops}`, 1);
    C.initializeCampaign(book, world);
    run(book, world, 2, 60);
    HISTORIES['worn-stalemate'](book, world, 0);
    ECONOMIES.bankrupt(book, world);
    const p = C.getPolity(book, 'romulan');
    for (let i = 0; i < 100; i++) p.hulls.push(hull(`rom${i}`, 31, prev));
    p.readinessPeak = C.polityReadiness(book, world, 'romulan').strength;
    const measured = Math.min(...world.systems.filter((s) => s.controller === 'romulan')
      .map((s) => world.routeHops([s.index], 6, 'romulan')).filter((h) => h != null));
    return { o: C.dominionOpportunity(book, world, 800), measured };
  };
  const on = at(LIMIT);
  const past = at(LIMIT + 1);
  console.log(`   corridor built to ${on.measured} and ${past.measured} hops against a limit of ${LIMIT}; contenders: ${on.o.defenders.map((d) => d.id).join('+')} / ${past.o.defenders.map((d) => d.id).join('+')}`);
  assert.equal(on.measured, LIMIT, `the corridor put the navy at ${on.measured} hops, not ${LIMIT}`);
  assert.equal(past.measured, LIMIT + 1, `the longer corridor put it at ${past.measured} hops, not ${LIMIT + 1}`);
  assert.ok(on.o.defenders.some((d) => d.id === 'romulan'),
    `a navy at exactly ${LIMIT} hops was not a contender: ${on.o.defenders.map((d) => d.id).join('+')}`);
  assert.equal(on.o.challengeable, false, `and ${on.o.strongestNear} at ${LIMIT} hops did not make the crossing unchallengeable`);
  assert.equal(on.o.open, false, 'and the opening survived it');
  assert.ok(!past.o.defenders.some((d) => d.id === 'romulan'),
    `a navy at ${LIMIT + 1} hops was still counted: ${past.o.defenders.map((d) => d.id).join('+')}`);
  assert.equal(past.o.open, true, `and one hop past the limit the opening did not return: ${past.o.reasons.join(' | ')}`);
});

// --- the opportunity gate, which is what replaced a calendar floor ---
check('the opening waits on chances offered to the captain, and no single action can supply them', () => {
  const at = (opportunity) => {
    const { book, world } = build('worn-stalemate', 'open', 'none', 'bankrupt', opportunity);
    return C.dominionOpportunity(book, world, 2000);
  };
  const need = C.CAMPAIGN_RULES.dominionPlayerBeats;
  const kinds = C.CAMPAIGN_RULES.dominionMinPlayerCategories;

  const nothing = at({ systemsVisited: 1, journeys: 0, issuers: 0, contacts: 0 });
  assert.equal(nothing.open, false, 'a captain who has been shown nothing was pulled into the war at day 2,000');
  assert.match(nothing.reasons.join(' | '), /kinds of chance/);

  // The defect this replaced: one cheap action, repeated, satisfying the whole gate. Each category is
  // pushed far past its own threshold on its own, and on its own none of them is enough.
  for (const k of Object.keys(need)) {
    const only = { systemsVisited: 0, journeys: 0, issuers: 0, contacts: 0, [k]: need[k] * 100 };
    const r = at(only);
    assert.equal(r.open, false,
      `${k} alone, at a hundred times its threshold, opened the door: ${r.beatsMet} of ${kinds} kinds`);
    assert.equal(r.beatsMet, 1, `${k} alone counted as ${r.beatsMet} kinds of chance`);
  }

  // One short of the required number of kinds, and then exactly at it.
  const keys = Object.keys(need);
  const upTo = (n) => Object.fromEntries(keys.map((k, i) => [k, i < n ? need[k] : 0]));
  const short = at(upTo(kinds - 1));
  const enough = at(upTo(kinds));
  assert.equal(short.open, false, `${kinds - 1} kinds of chance opened it`);
  assert.equal(short.beatsMet, kinds - 1);
  assert.equal(enough.open, true, `${kinds} kinds did not: ${enough.reasons.join(' | ')}`);
  assert.equal(enough.beatsMet, kinds);

  // And it is still chances offered, not achievements: nothing here reads holdings, treasury or fleet.
  const other = at(Object.fromEntries(keys.map((k, i) => [k, i >= keys.length - kinds ? need[k] : 0])));
  assert.equal(other.open, true, 'a different set of the same number of kinds decided differently');
});

// --- the rolling window, which is what rejects a case that merely wobbles ---
check('a condition that alternates never unlocks the arc, however long it alternates', () => {
  const c = C.CAMPAIGN_RULES;
  const windowOf = (pattern, days) => {
    let w = '';
    for (let i = 0; i < days; i++) w = `${w}${pattern(i) ? '1' : '0'}`.slice(-c.dominionOpeningWindowDays);
    return (w.match(/1/g) || []).length;
  };
  const alternating = windowOf((i) => i % 2 === 0, 4000);
  const twoInThree = windowOf((i) => i % 3 !== 0, 4000);
  const holding = windowOf(() => true, 4000);
  assert.ok(alternating < c.dominionOpeningSustainDays,
    `a case eligible every other day reached ${alternating} of ${c.dominionOpeningWindowDays}, at or past the ${c.dominionOpeningSustainDays} it needs`);
  assert.ok(twoInThree >= c.dominionOpeningSustainDays,
    `a case eligible two days in three reached only ${twoInThree}`);
  assert.equal(holding, c.dominionOpeningWindowDays, 'a case that always holds did not fill its window');
  assert.ok(alternating <= c.dominionOpeningWindowDays && holding <= c.dominionOpeningWindowDays,
    'the window is not bounded: it accumulates past its own length');
});

console.log(`${checks}/${checks} entry-decision invariants hold across ${rows.length} matrix rows.`);
