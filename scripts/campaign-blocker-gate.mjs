// Adversarial gate for the fa7de12 review blockers.
//
// Every check here is a reproduction of a defect that was found in the reviewed candidate, written so
// that it FAILS on that candidate and passes only once the defect is actually repaired. It is not a
// happy-path suite: nothing in it asserts that a feature exists, only that a specific reported wrong
// behaviour no longer happens.
import assert from 'node:assert/strict';
import * as C from '../src/campaign-strategy.mjs';
import fs from 'node:fs';
import { POOLS, station, makeWorld, run } from './campaign-world-fixture.mjs';
const PARENT_BOOK = JSON.parse(fs.readFileSync(new URL('./fixtures/fa7de12-campaign-book.json', import.meta.url), 'utf8'));

// Every check runs even when an earlier one fails, so one run reports the state of every blocker
// rather than stopping at the first. The exit code is still non-zero if anything reproduced.
let checks = 0;
const failures = [];
// The gate computes its own near side and its own defender set rather than asking the module, so a
// check fails on the behaviour it is about and not merely because a helper is missing.
const nearSide = (world, entry) => {
  const isWormhole = (a, b) => world.wormholes.some((w) => (w.from === a && w.to === b) || (w.to === a && w.from === b));
  const seen = new Set([entry]); const q = [entry];
  while (q.length) { const cur = q.shift(); for (const n of world.neighbours(cur)) { if (isWormhole(cur, n) || seen.has(n)) continue; seen.add(n); q.push(n); } }
  return seen;
};
// Several of these gates are about the engine, not about what unlocks the Dominion expedition: they
// need an expedition to exist inside a short window, and waiting for a war to grind the near side down
// is not what they are checking. This override opens the arc on its own terms so the check underneath
// it stays about the thing it indicts. Anything testing the unlock itself belongs in the model suite.
const OPENS_AT_ONCE = Object.freeze({ dominionMinCentralEngagements: 0, dominionDefenderWeakness: 1.1, dominionStalemateBand: 1, dominionOpeningSustainDays: 0 });

const test = (name, fn) => {
  checks++;
  try { fn(); console.log('PASS', name); }
  catch (err) { failures.push({ name, message: err?.message || String(err) }); console.log('FAIL', name, '\n      ', (err?.message || String(err)).split('\n')[0]); }
};

// B2 — peace does not stop an operation in progress.
// Reproduction: operation launched day 1, peace signed day 3, still `engaged` on day 25 with losses.
test('B2 a settlement terminates the operations it makes illegal, the day it is signed', () => {
  const { world, relations } = makeWorld({ localSystem: null });
  const book = C.createCampaignBook('b2', 1); C.initializeCampaign(book, world);
  const t = C.getPolity(book, 'terran');
  const hulls = t.hulls.filter((h) => h.status === 'ready').slice(0, 5);
  const op = C.launchOperation(book, world, 'terran', hulls, 2, 1, 1, 'assault');
  run(book, world, 2, 3);
  assert.equal(op.status, 'engaged', 'precondition: the operation is engaged before the settlement');
  const lossesAtPeace = op.losses;
  delete relations['terran:klingon']; delete relations['klingon:terran']; // the war ends on day 4
  const effects = run(book, world, 4, 25);
  assert.equal(op.status, 'resolved', 'the operation must not survive the war that authorised it');
  assert.equal(op.outcome, 'stood-down');
  assert.equal(op.resolvedDay, 4, 'it stands down the day the relationship changes, not eventually');
  assert.equal(op.losses, lossesAtPeace, 'no further losses are taken after the settlement');
  // One terminal effect and one history entry, whatever ended it: a second purpose-built effect
  // alongside the generic one gave peace two reports and let the panel pick the generic one.
  // 'operationStoodDown' is named here deliberately: it is the effect the duplicate fix removed, and
  // this assertion is what would catch it coming back.
  const terminal = effects.filter((e) => e.opId === op.id && ['operationResolved', 'operationStoodDown'].includes(e.type));
  assert.equal(terminal.length, 1, `${terminal.length} terminal effects for one peace termination: ${terminal.map((e) => e.type).join(', ')}`);
  assert.equal(terminal[0].outcome, 'stood-down', 'and it carries the reason it ended');
  const entries = book.history.filter((h) => h.opId === op.id && h.kind === 'battle');
  assert.equal(entries.length, 1, `${entries.length} history entries for one peace termination`);
  assert.match(entries[0].text, /broke off the operation/, 'and it reads as a stand-down, not a defeat');
  for (const h of hulls) assert.equal(h.status, 'ready', 'the force is released, not stranded');
});

// B2b — a battle the loaded scene owns is never deleted under the player; it stands down on release.
test('B2 a scene-claimed battle is marked, not yanked, and stands down once the scene hands it back', () => {
  const { world, relations } = makeWorld({ localSystem: null });
  const book = C.createCampaignBook('b2b', 1); C.initializeCampaign(book, world);
  const t = C.getPolity(book, 'terran');
  const hulls = t.hulls.filter((h) => h.status === 'ready').slice(0, 5);
  const op = C.launchOperation(book, world, 'terran', hulls, 2, 1, 1, 'assault');
  run(book, world, 2, 3);
  assert.ok(C.claimOperationForScene(book, op.id), 'precondition: the scene claims the battle');
  delete relations['terran:klingon']; delete relations['klingon:terran'];
  run(book, world, 4, 6);
  assert.equal(op.status, 'engaged', 'the claimed battle is not resolved out from under the player');
  assert.equal(op.standDownPending, true, 'but it is marked');
  C.releaseOperationFromScene(book, op.id, C.operationHulls(book, op).map((h) => ({ hullId: h.id, hull: h.hull })));
  run(book, world, 7, 8);
  assert.equal(op.status, 'resolved');
  assert.equal(op.outcome, 'stood-down');
});

// B1 — the Dominion reached objectives it had no route to, from its own core, past an entry it did
// not hold. Reproduction: "Minor" captured on day 62 with Bajora still Bajoran.
test('B1 the Dominion takes nothing on this side of the wormhole until it holds the bridgehead', () => {
  // Bajora is fortified so the expedition cannot take the entry system at all.
  const { world } = makeWorld({ localSystem: null, stations: { 6: [station('baj-base', 70, 'bajoran'), station('baj-base2', 79, 'bajoran'), station('baj-plat1', 87, 'bajoran'), station('baj-plat2', 87, 'bajoran'), station('baj-plat3', 87, 'bajoran'), station('baj-plat4', 87, 'bajoran')] } });
  // The corridor rule would stop this expedition sailing at all — that is case 5 of the model suite's
  // arc test, and it is not what B1 is about. Here the expedition must sail and fail, so the corridor
  // check is lifted and the opening is authored.
  const book = C.createCampaignBook('b1', 1, { ...OPENS_AT_ONCE, dominionEarliestDay: 5, dominionCorridorCloseRatio: 99,
    dominionReconDwellDays: 10, dominionStagingDwellDays: 10 });
  C.initializeCampaign(book, world);
  const near = nearSide(world, 6);
  assert.ok(near.has(5) && near.has(0) && !near.has(7), 'precondition: the near side excludes the Dominion region');
  // The expedition is not the whole navy: once it has sailed, a deep reserve remains in the Dominion
  // core. That reserve is what reached the near side in the reviewed candidate without ever passing
  // through the entry system.
  const dom = C.getPolity(book, 'dominion');
  let reinforced = false;
  const reinforce = () => {
    if (reinforced) return; reinforced = true;
    for (let i = 0; i < 14; i++) dom.hulls.push({ id: `core-reserve-${i}`, shipId: 51, hull: 1600, maxHull: 1600, crew: 1, systemIndex: 7, status: 'ready', opId: null });
  };
  const captures = [];
  run(book, world, 2, 400, (e) => {
    if (e.type === 'operationLaunched' && e.kind === 'invasion') reinforce();
    if (e.type === 'captureSystem' && e.by === 'dominion') captures.push(e);
  });
  assert.equal(reinforced, true, 'precondition: the expedition sailed');
  assert.notEqual(world.systems[6].controller, 'dominion', 'precondition: the bridgehead never fell');
  const nearSideTaken = captures.filter((e) => near.has(Number(e.systemIndex)) && Number(e.systemIndex) !== 6);
  assert.equal(nearSideTaken.length, 0, `the Dominion took ${nearSideTaken.map((e) => world.systems[e.systemIndex].name).join(', ')} without a bridgehead`);
  const ops = book.operations.filter((o) => o.faction === 'dominion');
  const illegal = ops.filter((o) => near.has(Number(o.targetSystem)) && Number(o.targetSystem) !== 6);
  assert.equal(illegal.length, 0, 'and it never even planned past the bridgehead');
});

// B3 — the fleet cap counted destroyed hulls, so a polity that had fought could never build again,
// while the queue kept spending and marking orders delivered with deliveredHullId: null.
test('B3 the fleet cap counts standing hulls, and a finished order is never "delivered" without a hull', () => {
  const { world } = makeWorld({ localSystem: null });
  const book = C.createCampaignBook('b3', 1, { maxHullsPerPolity: 2 }); C.initializeCampaign(book, world);
  const t = C.getPolity(book, 'terran');
  t.treasury = 2000000; t.materials = 20000;
  assert.equal(t.hulls.length, 2, 'precondition: the polity is at its cap');
  const queued = C.queueBuild(book, world, 'terran', 10, 0, 1);
  assert.equal(queued.ok, true);
  const reserved = JSON.stringify(queued.item.reserved);
  const built = [];
  run(book, world, 2, 40, (e) => { if (e.type === 'hullBuilt' && e.polityId === 'terran') built.push(e); });
  const item = t.queue.find((q) => q.id === queued.item.id);
  assert.equal(item.status, 'awaiting-commission', 'a hull with no capacity to be commissioned waits');
  assert.equal(item.deliveredHullId, null);
  assert.equal(built.length, 0, 'nothing was announced as built');
  assert.equal(t.builtHulls, 0, 'and nothing was counted as built');
  assert.equal(book.stats.hullsBuilt, 0);
  assert.equal(t.queue.filter((q) => q.id === queued.item.id).length, 1, 'the order is not duplicated');
  assert.equal(JSON.stringify(item.reserved), reserved, 'and its cost is not re-reserved every day it waits');
  // A loss frees the berth: the waiting hull commissions, and the cap is not a lifetime cap.
  t.hulls[0].status = 'lost'; t.hulls[0].hull = 0;
  run(book, world, 41, 60, (e) => { if (e.type === 'hullBuilt' && e.polityId === 'terran') built.push(e); });
  assert.equal(built.length, 1);
  assert.ok(built[0].hullId, 'a build announcement must name a real hull');
  assert.equal(item.status, 'delivered', 'losses free capacity');
  assert.ok(item.deliveredHullId, 'and delivery means a real hull');
  assert.equal(t.hulls.filter((h) => h.id === item.deliveredHullId).length, 1);
  assert.equal(t.builtHulls, 1);
});

test('B3 no order is ever marked delivered without a hull over a long unattended run', () => {
  const { world } = makeWorld({ localSystem: null });
  const book = C.createCampaignBook('b3b', 1, { maxHullsPerPolity: 8 }); C.initializeCampaign(book, world);
  const announced = {};
  run(book, world, 2, 600, (e) => { if (e.type !== 'hullBuilt') return; announced[e.polityId] = (announced[e.polityId] || 0) + 1; assert.ok(e.hullId, `${e.polityId} announced a hull that does not exist`); });
  for (const id of Object.keys(book.polities)) {
    const p = C.getPolity(book, id);
    for (const q of p.queue) { if (q.status === 'delivered') assert.ok(q.deliveredHullId, `${id} recorded a delivery with no hull`); }
    assert.equal(p.builtHulls, announced[id] || 0, `${id} counted ${p.builtHulls} hulls built but produced ${announced[id] || 0}`);
  }
});

// B6 — a polity holding a foreign licence and a rich yard built only its own designs, and the
// design filter never asked whether a hull may be produced in a general yard at all.
test('B6 a captured licence is actually used, and eligibility is never bypassed by one', () => {
  const { world } = makeWorld({ localSystem: null });
  const book = C.createCampaignBook('b6', 1); C.initializeCampaign(book, world);
  const r = C.getPolity(book, 'romulan');
  r.treasury = 2000000; r.materials = 20000;
  r.licenses[11] = { source: 'integration', from: 'terran', systemIndex: 1, acquiredDay: 1 };
  run(book, world, 2, 240);
  const foreign = r.hulls.filter((h) => POOLS.terran.includes(h.shipId));
  assert.ok(foreign.length > 0, 'a licence the AI never uses is not a licence');

  const gated = makeWorld({ localSystem: null }).world;
  gated.designEligible = (shipId) => Number(shipId) !== 11;   // 11 is a special-vendor hull here
  const book2 = C.createCampaignBook('b6b', 1); C.initializeCampaign(book2, gated);
  const r2 = C.getPolity(book2, 'romulan');
  r2.treasury = 2000000; r2.materials = 20000;
  r2.licenses[11] = { source: 'integration', from: 'terran', systemIndex: 1, acquiredDay: 1 };
  assert.equal(C.queueBuild(book2, gated, 'romulan', 11, 4, 1).ok, false, 'an ineligible design cannot be ordered');
  run(book2, gated, 2, 240);
  assert.equal(r2.hulls.filter((h) => h.shipId === 11).length, 0, 'and is never produced by the planner either');
});

// B8 — defence counted forces that could never be lost: an allied fleet parked at a world raised the
// number and paid nothing, and the player's ships were counted twice at a world the player held.
test('B8 everything that defends can be lost, and nothing is counted that cannot', () => {
  const { world } = makeWorld({ localSystem: null, relations: { 'terran:romulan': 'allied' } });
  const book = C.createCampaignBook('b8', 1); C.initializeCampaign(book, world);
  const rom = C.getPolity(book, 'romulan');
  for (const h of rom.hulls.slice(0, 4)) h.systemIndex = 0;   // a Romulan squadron sits at Earth
  // The ally's presence is counted in the published defence; the check below is whether it can also
  // be made to pay for it.
  const withAlly = C.localDefenseStrength(book, world, 0);
  const parked = rom.hulls.filter((h) => h.systemIndex === 0);
  const moved = parked.map((h) => h.systemIndex);
  for (const h of parked) h.systemIndex = 4;
  const withoutAlly = C.localDefenseStrength(book, world, 0);
  parked.forEach((h, i) => { h.systemIndex = moved[i]; });
  assert.ok(withAlly > withoutAlly, 'precondition: the allied squadron raises the defence');
  const romBefore = rom.hulls.filter((h) => h.systemIndex === 0).reduce((n, h) => n + h.hull, 0);
  const k = C.getPolity(book, 'klingon');
  const strike = k.hulls.filter((h) => h.status === 'ready').slice(0, 8);
  const op = C.launchOperation(book, world, 'klingon', strike, 0, 1, 1, 'assault');
  const effects = run(book, world, 2, 20);
  const romAfter = rom.hulls.filter((h) => h.systemIndex === 0).reduce((n, h) => n + h.hull, 0);
  assert.ok(romAfter < romBefore, 'the ally that raised the defence paid for it');
  assert.ok(effects.some((e) => e.type === 'defenderLosses' && e.polityId === 'romulan'), 'and the engine is told which vessels paid');
  assert.ok(op.defenderLosses >= 0);
});

// B9 — a foreign installation inside another power's system was credited to the host: a Klingon heavy
// yard placed at Earth raised Terran berths 5 -> 6 and Terran heavy berths 1 -> 2.
test('B9 a foreign yard in your space is not your yard', () => {
  const plain = makeWorld({ localSystem: null });
  const bookA = C.createCampaignBook('b9a', 1); C.initializeCampaign(bookA, plain.world);
  const baseline = C.polityProduction(bookA, plain.world, 'terran');

  const withForeign = makeWorld({ localSystem: null, stations: { 0: [...plain.stationsMap[0], station('k-yard-at-earth', 81, 'klingon')] } });
  const bookB = C.createCampaignBook('b9b', 1); C.initializeCampaign(bookB, withForeign.world);
  const hosted = C.polityProduction(bookB, withForeign.world, 'terran');
  assert.equal(hosted.berths, baseline.berths, `the host gained ${hosted.berths - baseline.berths} berths from a yard it does not own`);
  assert.equal(hosted.heavyBerths, baseline.heavyBerths, 'and heavy berths it does not own');
  assert.equal(hosted.workforce, baseline.workforce, 'and a workforce that does not work for it');
  assert.equal(hosted.yards, baseline.yards, 'and a yard it cannot lay a keel in');
  const t = C.getPolity(bookB, 'terran'); t.treasury = 2000000; t.materials = 20000;
  const k = C.getPolity(bookB, 'klingon'); k.treasury = 2000000; k.materials = 20000;
  assert.equal(C.queueBuild(bookB, withForeign.world, 'klingon', 21, 0, 1).ok, false, 'and the owner cannot build there either while another power holds the system');
});

// Secondary — the determinism gate looped adjacent days in every "mode", so a genuine jump was never
// exercised. A single call across a gap silently skipped the days in between.
test('DET a single call across a gap settles every day in it', () => {
  const mk = (seed) => { const { world } = makeWorld({ localSystem: null }); const book = C.createCampaignBook(seed, 1); return { world, book }; };
  const a = mk('det'); const stepped = [];
  for (let d = 2; d <= 30; d++) stepped.push(...C.advanceCampaignDay(a.book, a.world, d));
  const b = mk('det'); const jumped = C.advanceCampaignDay(b.book, b.world, 30);
  assert.equal(stepped.filter((e) => e.type === 'captureSystem').length, 0, 'precondition: no capture makes the two worlds diverge');
  assert.equal(C.checksum(a.book), C.checksum(b.book), 'a jump must produce the book the steps produce');
  assert.equal(jumped.length, stepped.length, 'and the same effects, so nothing is lost in a long warp');
});

test('DET non-finite and absurd inputs are bounded, not trusted', () => {
  const { world } = makeWorld({ localSystem: null });
  const book = C.createCampaignBook('det2', 1); C.initializeCampaign(book, world);
  for (const bad of [Infinity, -Infinity, NaN, 'infinity', 1e999, null, undefined]) {
    assert.deepEqual(C.advanceCampaignDay(book, world, bad), [], `advancement accepted ${String(bad)}`);
    assert.equal(book.settled, 1);
  }
  const started = Date.now();
  C.advanceCampaignDay(book, world, 1e9);
  assert.ok(Date.now() - started < 60000, 'an absurd jump must terminate');
  assert.equal(book.settled, 1e9, 'and the calendar still agrees with the caller');
  assert.ok(book.history.some((h) => h.kind === 'calendar'), 'with the unobserved stretch recorded, not hidden');
});

// Secondary — the checksum omitted history, designs, recoveries, missions, orders and discoveries, so
// replay-equivalence proved nothing about any of them.
test('SUM the replay digest covers everything replay equivalence claims', () => {
  const { world } = makeWorld({ localSystem: null });
  const base = C.createCampaignBook('sum', 1); C.initializeCampaign(base, world);
  run(base, world, 2, 40);
  const before = C.checksum(base);
  const mutations = {
    history: (b) => b.history.push({ day: 1, kind: 'x', text: 'x' }),
    designs: (b) => { b.designs[999] = { sources: ['x'], lost: [], relocatedTo: null }; },
    recoveries: (b) => b.recoveries.push({ id: 'r', shipId: 1, status: 'available', createdDay: 1 }),
    missions: (b) => b.missions.push({ id: 'm', key: 'k', status: 'offered' }),
    orders: (b) => b.orders.push({ id: 'o', status: 'queued', systemIndex: 0 }),
    discoveries: (b) => { b.discoveries.gorn = true; },
  };
  for (const [name, mutate] of Object.entries(mutations)) {
    const copy = JSON.parse(JSON.stringify(base));
    mutate(copy);
    assert.notEqual(C.checksum(copy), before, `${name} is outside the digest`);
  }
});

// Secondary — the stated bounds were not bounds: 50 recoveries against a stated 40, 70 missions
// against a stated 60.
test('BND the stated bounds hold under pressure', () => {
  const { world } = makeWorld({ localSystem: null });
  const book = C.createCampaignBook('bnd', 1); C.initializeCampaign(book, world);
  for (let i = 0; i < 120; i++) {
    book.designs[`d${i}`] = { sources: [`st${i}`], lost: [], relocatedTo: null };
    C.recordStationLoss(book, world, `st${i}`, 0, 5);
  }
  const liveRecoveries = book.recoveries.filter((r) => r.status === 'available' || r.status === 'active');
  assert.ok(liveRecoveries.length <= book.config.maxLiveRecoveries, `${liveRecoveries.length} open recovery contracts against a stated ${book.config.maxLiveRecoveries}`);
  assert.ok(book.recoveries.length <= book.config.maxLiveRecoveries * 2);
  for (let i = 0; i < 200; i++) C.offerMission(book, { key: `k${i}`, kind: 'relief', systemIndex: 0 }, 5);
  const live = C.liveMissions(book);
  assert.ok(live.length <= book.config.maxLiveMissions, `${live.length} open missions against a stated ${book.config.maxLiveMissions}`);
});

// Secondary — a recovery pursued through a mission that expired stayed 'active' for ever and the
// design stayed permanently lost.
test('REC a recovery whose mission dies returns to the offer pool', () => {
  const { world } = makeWorld({ localSystem: null });
  const book = C.createCampaignBook('rec', 1); C.initializeCampaign(book, world);
  book.designs['77'] = { sources: ['e-yard'], lost: [], relocatedTo: null };
  C.recordStationLoss(book, world, 'e-yard', 0, 5);
  const r = book.recoveries.find((x) => x.shipId === 77);
  assert.ok(r, 'precondition: a sole-source loss offers a contract');
  const m = C.offerMission(book, { key: `recovery:${r.id}`, kind: 'archive', recoveryId: r.id, shipId: 77, systemIndex: 0, deadlineDay: 20 }, 6);
  C.acceptMission(book, m.id, 6); r.status = 'active'; r.missionId = m.id;
  run(book, world, 7, 30);
  assert.equal(book.missions.find((x) => x.id === m.id).status, 'expired');
  assert.equal(r.status, 'available', 'the contract is open again, not stuck active for ever');
  assert.equal(r.missionId, null);
  assert.equal(C.designStatus(book, 77).state, 'lost');
  assert.ok(C.designStatus(book, 77).recovery, 'and the design is still recoverable');
});

// Secondary — a book created on an already-old save emitted the warnings and the invasion together,
// collapsing the whole expedition arc into one day.
test('LATE a campaign that starts on an old save still gets the whole Dominion arc', () => {
  const { world } = makeWorld({ localSystem: null });
  // The opening is authored; what is under test is that the floor and the arc are offsets from the
  // first campaign day rather than from day 1 of a fresh game.
  const book = C.createCampaignBook('late', 200, OPENS_AT_ONCE); C.initializeCampaign(book, world);
  run(book, world, 201, 700);
  const warn = book.dominion.warnings.find((w) => w.id === 'missing-patrols');
  const invasion = book.dominion.warnings.find((w) => w.id === 'invasion');
  assert.ok(warn, 'the arc still runs');
  assert.ok(invasion, 'and still reaches an invasion');
  assert.ok(warn.day >= 200, 'the first warning is not backdated into the past');
  assert.ok(invasion.day - warn.day >= 30, `the captain had ${invasion.day - warn.day} days of warning, not the designed lead time`);
});

// Verification-round findings. These are not from the original review: they are defects the repair
// patch itself introduced or left, found by an adversarial pass over the repair, and kept here so they
// cannot come back.

// A book is persisted with its rule set inline and the version is only bumped when the book must be
// rebuilt, so a save written by an older build arrived with none of the keys added since — which
// removed four bounds and two repairs at once.
test('OLD a book written before these rules still gets them', () => {
  const { world } = makeWorld({ localSystem: null });
  const book = C.createCampaignBook('old', 1); C.initializeCampaign(book, world);
  // Exactly what an fa7de12 save looks like on load: its own config, round-tripped through storage.
  for (const key of ['maxLiveRecoveries', 'maxLiveMissions', 'maxOrders', 'maxCatchUpDays', 'foreignDesignShare']) delete book.config[key];
  const reloaded = JSON.parse(JSON.stringify(book));
  C.upgradeCampaignBook(reloaded);
  for (const key of ['maxLiveRecoveries', 'maxLiveMissions', 'maxOrders', 'maxCatchUpDays', 'foreignDesignShare']) {
    assert.equal(reloaded.config[key], C.CAMPAIGN_RULES[key], `${key} was lost on an older save`);
  }
  for (let i = 0; i < 200; i++) C.offerMission(reloaded, { key: `old${i}`, kind: 'relief', systemIndex: 0 }, 2);
  assert.ok(C.liveMissions(reloaded).length <= reloaded.config.maxLiveMissions, 'the mission bound did not survive the reload');
  for (let i = 0; i < 100; i++) C.queueDistantOrder(reloaded, { systemIndex: 0, label: `o${i}` }, 2, false);
  assert.ok(reloaded.orders.length <= reloaded.config.maxOrders, 'the order bound did not survive the reload');
  C.advanceCampaignDay(reloaded, world, 40);
  assert.equal(reloaded.settled, 40);
  assert.equal(reloaded.history.some((h) => h.kind === 'calendar'), false, 'a 39-day gap was recorded as unobserved instead of being stepped');
});

// The one-shot notice for a finished hull with nowhere to go was dead: status was overwritten eight
// lines above the test for it, so it logged every day per polity and evicted the campaign history.
test('WAIT a hull with nowhere to go is announced once, not every day', () => {
  const { world } = makeWorld({ localSystem: null });
  const book = C.createCampaignBook('wait', 1, { maxHullsPerPolity: 2 }); C.initializeCampaign(book, world);
  const t = C.getPolity(book, 'terran');
  t.treasury = 2000000; t.materials = 20000;
  C.queueBuild(book, world, 'terran', 10, 0, 1);
  run(book, world, 2, 120);
  const notices = book.history.filter((h) => h.kind === 'production' && /no fleet capacity/.test(h.text));
  assert.equal(notices.length, 1, `the waiting order was announced ${notices.length} times`);
  assert.ok(book.history.some((h) => h.kind === 'opening'), 'and the opening record was evicted by the spam');
  // Nor may the polity keep paying for hulls it has no room to commission.
  const waiting = t.queue.filter((q) => q.status === 'awaiting-commission');
  assert.equal(waiting.length, 1, `${waiting.length} orders are stacked up with nowhere to go`);
});

// Removing the lossless extraDefense term must not also remove the rule it encoded: the captain's
// ships stand with any holder they are not at war with, including a neutral host.
test('HOST the captain\'s ships still defend a neutral host, and can be lost doing it', () => {
  const { world } = makeWorld({ localSystem: null, playerFaction: 'terran' });
  const book = C.createCampaignBook('host', 1); C.initializeCampaign(book, world);
  const player = C.ensurePolity(book, 'player');
  assert.equal(world.relation('terran', 'bajoran'), 'peace', 'precondition: the host is neither ally nor enemy');
  const bare = C.localDefenseStrength(book, world, 6);
  player.hulls = [0, 1, 2, 3].map((i) => ({ id: `pf:${i}`, shipId: 11, hull: 800, maxHull: 800, crew: 1, systemIndex: 6, status: 'ready', opId: null }));
  const defended = C.localDefenseStrength(book, world, 6);
  assert.ok(defended > bare, 'a squadron at a neutral host added nothing to its defence');
  assert.ok(C.defendingPolityIds(book, world, 6).includes('player'));
  // And the same ships are at risk: a Dominion assault must be able to hurt them.
  const dom = C.getPolity(book, 'dominion');
  const strike = dom.hulls.filter((h) => h.status === 'ready').slice(0, 8);
  for (const h of strike) h.systemIndex = 6;
  const op = C.launchOperation(book, world, 'dominion', strike, 6, 1, 1, 'invasion');
  const effects = run(book, world, 2, 20);
  assert.ok(effects.some((e) => e.type === 'defenderLosses' && e.polityId === 'player'), 'and nothing could ever touch them');
  assert.ok(op.defenderLosses >= 0);
});

// Second-review findings. Each reproduces a defect an independent review found in the first repair
// pack; they are kept here so the repair of the repair cannot regress either.

// R1 — the config backfill was proved against a candidate book with keys deleted, which is not the
// same thing as a save an older build actually wrote. This loads one: a real fa7de12 book, initialized
// and advanced 60 days on that build, serialized exactly as it would be persisted.
test('PARENT a real fa7de12 save gets the rules it predates, and they work', () => {
  const { world } = makeWorld({ localSystem: null });
  const book = JSON.parse(JSON.stringify(PARENT_BOOK));
  assert.equal(book.version, C.CAMPAIGN_VERSION, 'precondition: the parent save has the same schema version, so nothing rebuilds it');
  assert.equal(book.initialized, true, 'precondition: it is an initialized campaign, not a fresh book');
  for (const key of ['maxLiveRecoveries', 'maxLiveMissions', 'maxOrders', 'maxCatchUpDays', 'foreignDesignShare']) {
    assert.equal(book.config[key], undefined, `precondition: the parent save predates ${key}`);
  }
  C.upgradeCampaignBook(book);

  // Foreign production, the repair that silently did nothing on an old save.
  const romulan = C.getPolity(book, 'romulan');
  romulan.treasury = 2000000; romulan.materials = 20000;
  romulan.licenses[11] = { source: 'integration', from: 'terran', systemIndex: 1, acquiredDay: 60 };
  run(book, world, book.settled + 1, book.settled + 240);
  assert.ok(romulan.hulls.some((h) => POOLS.terran.includes(h.shipId)), 'the licence still did nothing on a real parent save');

  // All four bounds.
  for (let i = 0; i < 200; i++) C.offerMission(book, { key: `parent-m${i}`, kind: 'relief', systemIndex: 0 }, book.settled);
  assert.ok(C.liveMissions(book).length <= book.config.maxLiveMissions, `${C.liveMissions(book).length} open missions`);
  for (let i = 0; i < 100; i++) C.queueDistantOrder(book, { systemIndex: 0, label: `parent-o${i}` }, book.settled, false);
  assert.ok(book.orders.length <= book.config.maxOrders, `${book.orders.length} queued orders`);
  for (let i = 0; i < 120; i++) { book.designs[`pd${i}`] = { sources: [`pst${i}`], lost: [], relocatedTo: null }; C.recordStationLoss(book, world, `pst${i}`, 0, book.settled); }
  const live = book.recoveries.filter((r) => r.status === 'available' || r.status === 'active');
  assert.ok(live.length <= book.config.maxLiveRecoveries, `${live.length} open recovery contracts`);

  // And a multi-day advance steps rather than writing the gap off as unobserved.
  const from = book.settled;
  C.advanceCampaignDay(book, world, from + 40);
  assert.equal(book.settled, from + 40);
  assert.equal(book.history.some((h) => h.kind === 'calendar' && h.day > from), false, 'a 40-day advance was recorded as unobserved time');
});

// R3 — the day loop ran against one immutable snapshot, so a capture on an internal day was invisible
// to the days after it: the same world was taken again and again and the book diverged from stepping.
test('GAP a jump across a capture produces the book that stepping produces', () => {
  // This gate is about the bulk path agreeing with the stepped path, so it authors an expedition that
  // opens at once rather than waiting for a war to grind the near side down: it needs captures inside
  // its window, and what unlocks the expedition is the campaign's business, not this check's.
  const EARLY = { ...OPENS_AT_ONCE, dominionEarliestDay: 5, dominionReconDwellDays: 5, dominionStagingDwellDays: 5 };
  const mk = (seed) => { const { world } = makeWorld({ localSystem: null }); return { world, book: C.createCampaignBook(seed, 1, EARLY) }; };
  const seed = 'gapcap-0';
  const a = mk(seed); const stepped = [];
  for (let d = 2; d <= 180; d++) {
    const effects = C.advanceCampaignDay(a.book, a.world, d);
    for (const e of effects) if (e.type === 'captureSystem') a.world.systems[e.systemIndex].controller = e.by;
    stepped.push(...effects);
  }
  const steppedCaptures = stepped.filter((e) => e.type === 'captureSystem');
  assert.ok(steppedCaptures.length > 0, 'precondition: this seed captures something');

  const b = mk(seed);
  const jumped = C.advanceCampaignDay(b.book, b.world, 180);
  const jumpedCaptures = jumped.filter((e) => e.type === 'captureSystem');
  assert.equal(jumpedCaptures.length, steppedCaptures.length, `one call emitted ${jumpedCaptures.length} captures where stepping emitted ${steppedCaptures.length}`);
  assert.deepEqual(jumpedCaptures.map((e) => [e.day, e.systemIndex, e.by]), steppedCaptures.map((e) => [e.day, e.systemIndex, e.by]), 'and not the same world over and over');
  assert.equal(C.checksum(b.book), C.checksum(a.book), 'the two books disagree');
});

// R4 — the digest was an enumerated subset twice over, and both times it left something out.
test('SUM every persisted field is inside the digest', () => {
  const { world } = makeWorld({ localSystem: null });
  const base = C.createCampaignBook('sum2', 1); C.initializeCampaign(base, world);
  run(base, world, 2, 40);
  base.relocatedOffers = { 'e-yard': [10] }; base.assessments = { klingon: { day: 40, strength: 100 } }; base.migratedBudgets = true;
  base.resolutions = {};
  const before = C.checksum(base);
  const touch = (value) => {
    if (Array.isArray(value)) return value.concat(['digest-probe']);
    if (value && typeof value === 'object') return { ...value, 'digest-probe': 1 };
    if (typeof value === 'number') return value + 1;
    if (typeof value === 'boolean') return !value;
    if (typeof value === 'string') return `${value}-probe`;
    return 'digest-probe';
  };
  const keys = Object.keys(base);
  assert.ok(keys.includes('seed') && keys.includes('resolutions') && keys.includes('relocatedOffers') && keys.includes('assessments') && keys.includes('migratedBudgets'),
    'precondition: the fields the review named are present to be mutated');
  for (const key of keys) {
    const copy = JSON.parse(JSON.stringify(base));
    copy[key] = touch(copy[key]);
    assert.notEqual(C.checksum(copy), before, `${key} is outside the digest`);
  }
  // And a book that has been through storage hashes the same as the one in memory.
  assert.equal(C.checksum(JSON.parse(JSON.stringify(base))), before, 'a reloaded book does not hash the same as the live one');
});

// R10 — launchOperation kept one origin for the whole force, so a raid drawn from two neighbours
// returned every survivor to the first one's system.
test('ORIGIN a raid drawn from two systems sends each survivor back where it came from', () => {
  const { world, relations } = makeWorld({ localSystem: null });
  const book = C.createCampaignBook('origin', 1); C.initializeCampaign(book, world);
  const k = C.getPolity(book, 'klingon');
  const force = k.hulls.filter((h) => h.status === 'ready').slice(0, 6);
  assert.ok(force.length >= 6, 'precondition: a force to split');
  force.slice(0, 3).forEach((h) => { h.systemIndex = 2; });
  force.slice(3).forEach((h) => { h.systemIndex = 3; });
  const home = new Map(force.map((h) => [h.id, h.systemIndex]));
  const op = C.launchOperation(book, world, 'klingon', force, 1, 1, 1, 'raid');
  // Stand the operation down before a shot is fired, so every hull survives and the only thing under
  // test is where each of them is sent home to.
  delete relations['terran:klingon']; delete relations['klingon:terran'];
  run(book, world, 2, 6);
  assert.equal(op.status, 'resolved');
  assert.equal(op.losses, 0, 'precondition: nobody was lost, so every hull should have gone home');
  for (const h of force) {
    assert.equal(h.status, 'ready');
    assert.equal(h.systemIndex, home.get(h.id), `a hull that set out from system ${home.get(h.id)} came back to system ${h.systemIndex}`);
  }
});

// R7 — "may a general yard stock this hull" and "does capturing this culture's industry let you build
// it" were answered by the same predicate, so a captured Dominion world granted nothing.
test('INDUSTRY capturing a culture\'s industry grants its ordinary designs, not the named exceptions', () => {
  const { world } = makeWorld({ localSystem: null });
  // Nothing here is stocked by a general yard; hull 51 is a named exception and 50 is ordinary.
  world.designEligible = () => false;
  world.designIndustrial = (shipId) => Number(shipId) !== 51;
  const book = C.createCampaignBook('industry', 1); C.initializeCampaign(book, world);
  const t = C.getPolity(book, 'terran');
  t.treasury = 2000000; t.materials = 20000;
  t.licenses[50] = { source: 'integration', from: 'dominion', systemIndex: 7, acquiredDay: 1 };
  t.licenses[51] = { source: 'integration', from: 'dominion', systemIndex: 7, acquiredDay: 1 };
  assert.equal(C.queueBuild(book, world, 'terran', 50, 0, 1).ok, true, 'an ordinary hull of the captured culture cannot be built');
  assert.equal(C.queueBuild(book, world, 'terran', 51, 0, 1).ok, false, 'a named exception was buildable');
  assert.deepEqual(C.licensedDesigns(book, world, 'terran'), [50], 'the AI draws on the wrong set');
  // And integration itself filters on the industrial rule, not the retail one.
  const w2 = makeWorld({ localSystem: null }).world;
  w2.designEligible = () => false;
  w2.designIndustrial = (shipId) => Number(shipId) !== 51;
  w2.systems[7].controller = 'terran';
  w2.systems[7].origin = 'dominion';
  const book2 = C.createCampaignBook('industry2', 1); C.initializeCampaign(book2, w2);
  C.recordCapture(book2, w2, 7, 'terran', 'dominion', 1);
  run(book2, w2, 2, 80);
  const integ = C.getPolity(book2, 'terran').integrations[7];
  assert.ok(integ?.completedDay, 'precondition: the captured world integrated');
  assert.ok(integ.designs.includes(50), 'integration granted none of the culture\'s ordinary designs');
  assert.ok(!integ.designs.includes(51), 'and it granted a named exception');
});

// Third-review finding. The bulk shadow updated the captured system's controller but not the
// installations that change hands with it, so a conquest of a world with a government yard gave one
// book when stepped and another when jumped: different berths, different yards, different repair
// capacity, different checksum.
test('YARD a jump across a conquest that transfers a yard produces the book that stepping produces', () => {
  // The engine's own rule, applied here so the daily reference behaves like the real caller: conquest
  // takes the displaced government's installations with the world; foreign and private owners keep theirs.
  const applyCapture = (fixture, effect) => {
    fixture.world.systems[effect.systemIndex].controller = effect.by;
    if (effect.from == null) return;
    for (const st of fixture.stationsMap[effect.systemIndex] || []) if (st.owner === effect.from) st.owner = effect.by;
  };
  const seed = 'yardcap';
  const setup = () => {
    // Vega with its Terran government yard and no defence platform, so the push actually lands.
    const fixture = makeWorld({ localSystem: null, stations: { 1: [station('v-yard', 74, 'terran')] } });
    const book = C.createCampaignBook(seed, 1);
    C.initializeCampaign(book, fixture.world);
    const k = C.getPolity(book, 'klingon');
    const force = k.hulls.filter((h) => h.status === 'ready').slice(0, 20);
    for (const h of force) h.systemIndex = 2;
    C.launchOperation(book, fixture.world, 'klingon', force, 1, 1, 1, 'assault');
    return { fixture, book };
  };

  const stepped = setup(); const steppedCaptures = [];
  for (let d = 2; d <= 80; d++) {
    for (const e of C.advanceCampaignDay(stepped.book, stepped.fixture.world, d)) {
      if (e.type !== 'captureSystem') continue;
      applyCapture(stepped.fixture, e); steppedCaptures.push([e.day, e.systemIndex, e.by]);
    }
  }
  const jumped = setup();
  const jumpedCaptures = C.advanceCampaignDay(jumped.book, jumped.fixture.world, 80).filter((e) => e.type === 'captureSystem').map((e) => [e.day, e.systemIndex, e.by]);

  assert.ok(steppedCaptures.some(([, index]) => index === 1), 'precondition: this seed takes Vega, which holds a government yard');
  assert.deepEqual(jumpedCaptures, steppedCaptures, 'the two runs did not even take the same worlds on the same days');
  // Apply the same captures to the jumped fixture so both worlds describe the same galaxy before the
  // production figures are compared.
  for (const [, index, by] of jumpedCaptures) applyCapture(jumped.fixture, { systemIndex: index, by, from: by === 'klingon' ? 'terran' : 'klingon' });
  const a = C.polityProduction(stepped.book, stepped.fixture.world, 'klingon');
  const b = C.polityProduction(jumped.book, jumped.fixture.world, 'klingon');
  assert.equal(b.berths, a.berths, `the jumped run gave the conqueror ${b.berths} berths where stepping gave ${a.berths}`);
  assert.equal(b.yards, a.yards, `and ${b.yards} yards where stepping gave ${a.yards}`);
  assert.equal(b.repairCapacity, a.repairCapacity, `and ${b.repairCapacity} repair capacity where stepping gave ${a.repairCapacity}`);
  assert.equal(C.checksum(jumped.book), C.checksum(stepped.book), 'the two books disagree');
});

// Third-review follow-up: the integration half of R8 was only shown to *finish*, which it would have
// done even if a foreign yard were still driving it. This measures the rate.
test('FOREIGNYARD a yard you do not own does not retool your captured world', () => {
  const withOwn = makeWorld({ localSystem: null, stations: { 8: [station('m-yard', 74, 'terran'), station('m-hab', 84, 'terran'), station('m-hab2', 84, 'terran'), station('m-hab3', 84, 'terran'), station('m-hab4', 84, 'terran'), station('m-hab5', 84, 'terran')] } });
  const withForeign = makeWorld({ localSystem: null, stations: { 8: [station('m-yard', 74, 'cardassian'), station('m-hab', 84, 'terran'), station('m-hab2', 84, 'terran'), station('m-hab3', 84, 'terran'), station('m-hab4', 84, 'terran'), station('m-hab5', 84, 'terran')] } });
  const progressAfter = (fixture, days) => {
    const book = C.createCampaignBook('foreignyard', 1);
    C.initializeCampaign(book, fixture.world);
    fixture.world.systems[8].controller = 'terran';
    fixture.world.systems[8].origin = 'cardassian';
    C.recordCapture(book, fixture.world, 8, 'terran', 'cardassian', 1);
    run(book, fixture.world, 2, 1 + days);
    return C.getPolity(book, 'terran').integrations[8];
  };
  const own = progressAfter(withOwn, 20);
  const foreign = progressAfter(withForeign, 20);
  assert.ok(own?.qualification?.qualifies, 'precondition: the captured world qualifies for integration');
  assert.ok(foreign?.qualification?.qualifies, 'precondition: it qualifies with the foreign yard too');
  assert.ok(own.progress > foreign.progress,
    `a yard owned by another power retooled the world just as fast as one of your own (${foreign.progress} vs ${own.progress})`);
  assert.ok(foreign.progress > 0, 'and a qualifying world with no usable yard should still integrate slowly on population alone');
});

// I3R (third review) — the engine applied station damage inside the strategic day but ran repair once
// per CALL, so a jump healed one day's worth of damage across any number of days. The repair belongs to
// the same per-internal-day path as the damage. This measures the contract rather than the engine: the
// model must settle the engine's day once per day it settles, with that day's effects and nothing else,
// so a ledger only the engine keeps ends a jump where it ends a walk.
test('DAYHOOK the engine settles once per internal day, stepped or jumped', () => {
  const build = () => {
    const fixture = makeWorld({ localSystem: null });
    // Same reason as GAP: the hook needs days on which something happens inside a forty-day window, so
    // the expedition is authored to open at once rather than left to a war it has no time to fight.
    // Reconnaissance opens on day 20 and nothing follows inside the window: the hook needs a couple of
    // eventful days among quiet ones, not an event every day.
    const book = C.createCampaignBook('dayhook', 1, { ...OPENS_AT_ONCE, dominionEarliestDay: 20,
      dominionReconDwellDays: 60, dominionStagingDwellDays: 60 });
    C.initializeCampaign(book, fixture.world);
    // A ledger of the kind only an engine can keep: a wound that heals a little every day, and days on
    // which something happened that deepens it. A hook that runs once per call gets this wrong twice —
    // too little healing, and the wrong day's damage on top of it.
    const ledger = { damage: 1, calls: 0, days: [], effects: 0, trace: [] };
    fixture.world.settleDay = (view, day, dayEffects) => {
      ledger.calls++; ledger.days.push(day); ledger.effects += dayEffects.length;
      if (dayEffects.length) ledger.trace.push(`${day}:${dayEffects.map((e) => e.type).join('+')}`);
      ledger.damage = Math.max(0, ledger.damage - 0.01);
      if (dayEffects.length) ledger.damage = Math.min(1, ledger.damage + 0.05);
      if (!view || !Array.isArray(view.systems)) throw new Error('the per-day hook was given no world view');
    };
    return { fixture, book, ledger };
  };
  const walked = build();
  let walkedEffects = 0;
  for (let d = 2; d <= 41; d++) walkedEffects += C.advanceCampaignDay(walked.book, walked.fixture.world, d).length;
  const jumped = build();
  const jumpedEffects = C.advanceCampaignDay(jumped.book, jumped.fixture.world, 41).length;
  assert.equal(walked.ledger.calls, 40, `stepping 40 days settled the engine's day ${walked.ledger.calls} time(s)`);
  assert.equal(jumped.ledger.calls, 40, `a single call across 40 days settled the engine's day ${jumped.ledger.calls} time(s)`);
  assert.deepEqual(jumped.ledger.days, walked.ledger.days, 'the two runs did not settle the same days');
  assert.deepEqual(jumped.ledger.trace, walked.ledger.trace, 'and the effects did not reach the engine on the same days');
  assert.ok(walked.ledger.trace.length >= 2, `precondition: something happened on at least two days (${walked.ledger.trace.join(', ') || 'nothing did'})`);
  assert.equal(jumped.ledger.effects, jumpedEffects, 'the jumped run did not hand the engine every effect it produced');
  assert.equal(walked.ledger.effects, walkedEffects, 'the stepped run did not hand the engine every effect it produced');
  assert.ok(walked.ledger.damage < 1 && walked.ledger.damage > 0, `precondition: the ledger moved and did not bottom out (${walked.ledger.damage})`);
  assert.equal(jumped.ledger.damage.toFixed(6), walked.ledger.damage.toFixed(6),
    `a jump left the engine's ledger at ${jumped.ledger.damage.toFixed(3)} where stepping left it at ${walked.ledger.damage.toFixed(3)}`);
  assert.equal(C.checksum(jumped.book), C.checksum(walked.book), 'and the two books disagree');
});

// I3R, second half — the hook is only worth having if what it is handed is the same either way. The
// first cut of it shadowed the world on a multi-day call and passed the caller's own snapshot on a
// single-day one, so on the day a world changed hands a jump handed the engine the new holder and a
// walk handed it the old one, and anything the engine recorded from that view diverged.
test('DAYVIEW the world the engine settles a day against already holds that day\'s conquests', () => {
  const capture = (fixture, effect) => {
    fixture.world.systems[effect.systemIndex].controller = effect.by;
    if (effect.from == null) return;
    for (const st of fixture.stationsMap[effect.systemIndex] || []) if (st.owner === effect.from) st.owner = effect.by;
  };
  const setup = () => {
    const fixture = makeWorld({ localSystem: null, stations: { 1: [station('v-yard', 74, 'terran')] } });
    const book = C.createCampaignBook('yardcap', 1);
    C.initializeCampaign(book, fixture.world);
    const force = C.getPolity(book, 'klingon').hulls.filter((h) => h.status === 'ready').slice(0, 20);
    for (const h of force) h.systemIndex = 2;
    C.launchOperation(book, fixture.world, 'klingon', force, 1, 1, 1, 'assault');
    const trace = [];
    fixture.world.settleDay = (view, day) => trace.push(`${day}:${view.systems[1].controller}:${view.stationsBySystem(1).map((st) => st.owner).join(',')}`);
    return { fixture, book, trace };
  };
  const walked = setup();
  for (let d = 2; d <= 80; d++) for (const e of C.advanceCampaignDay(walked.book, walked.fixture.world, d)) if (e.type === 'captureSystem') capture(walked.fixture, e);
  const jumped = setup();
  for (const e of C.advanceCampaignDay(jumped.book, jumped.fixture.world, 80)) if (e.type === 'captureSystem') capture(jumped.fixture, e);
  assert.equal(walked.trace.length, 79, `stepping settled the engine's day ${walked.trace.length} time(s) across 79 days`);
  const flips = walked.trace.filter((t, i) => i > 0 && t.split(':')[1] !== walked.trace[i - 1].split(':')[1]);
  assert.ok(flips.length >= 1, 'precondition: Vega changes hands during the run');
  const first = walked.trace.findIndex((t, i) => i > 0 && t.split(':')[1] !== walked.trace[i - 1].split(':')[1]);
  assert.deepEqual(jumped.trace, walked.trace,
    `the engine was handed a different galaxy on the same day: jumped "${jumped.trace[first]}" where stepping gave "${walked.trace[first]}"`);
});

// Found while gating the fifth review: the engine offers contracts BETWEEN the days the model settles,
// and took their ids from the model's own counter. A caller that jumped sixteen days therefore handed
// different ids to every hull and operation created after the first contract than a caller that
// stepped, and since ids seed rolls, battles resolved differently and the books diverged. A caller may
// now bring its own id, and bringing one must not move the model's counter.
test('IDSPACE a contract the caller brings an id for does not consume the model\'s counter', () => {
  const { world } = makeWorld({ localSystem: null });
  const book = C.createCampaignBook('idspace', 1);
  C.initializeCampaign(book, world);
  const before = book.counter;
  const theirs = C.offerMission(book, { id: 'engine-mission-1', key: 'escort:1', kind: 'escort', systemIndex: 1, text: 'escort', reward: 1000 }, 1);
  assert.ok(theirs, 'precondition: the contract was offered');
  assert.equal(theirs.id, 'engine-mission-1', 'the caller\'s own id was overwritten');
  assert.equal(book.counter, before,
    `a caller's own id still advanced the model's counter from ${before} to ${book.counter}, which shifts the id of everything the model creates afterwards`);
  const mine = C.offerMission(book, { key: 'escort:2', kind: 'escort', systemIndex: 2, text: 'escort', reward: 1000 }, 1);
  assert.ok(mine && String(mine.id).startsWith('idspace:mission:'), 'a caller that brings no id must still be given one');
  assert.equal(book.counter, before + 1, 'and that one does advance the counter');
});

console.log(`${checks - failures.length}/${checks} blocker reproductions no longer reproduce.`);
if (failures.length) { console.log(`${failures.length} still reproduce:`); for (const f of failures) console.log(`  - ${f.name}: ${f.message.split('\n')[0]}`); process.exitCode = 1; }
