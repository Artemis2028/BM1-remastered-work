// Pure tests for blockade interception and running (BLOCKADE-RUNNING-RULES-270100ZSEP26).
// One engine: the same resolveBlockadeRun answers a formation, a trader and an evacuation convoy.
import assert from 'node:assert/strict';
import * as C from '../src/campaign-strategy.mjs';
import { makeWorld, run } from './campaign-world-fixture.mjs';

let passed = 0;
const stats = {};
const test = (name, fn) => { fn(); passed++; console.log('PASS', name); };
// Class facts the engine supplies in game (speed, cloak, fighting value); the fixture adds a few
// civilian and special hulls.
const EXTRA = {
  70: { price: 70000, mass: 6, combatHull: 600, faction: 'terran', cargo: 1500, strategicSpeed: 0.8, cloak: false, combat: 0 },      // slow bulk freighter
  71: { price: 70000, mass: 6, combatHull: 600, faction: 'terran', cargo: 1500, strategicSpeed: 1.3, cloak: false, combat: 0 },      // the same freighter, fast
  72: { price: 70000, mass: 6, combatHull: 600, faction: 'terran', cargo: 1500, strategicSpeed: 0.8, cloak: true, combat: 0 },       // the same freighter, cloaked
  74: { price: 70000, mass: 6, combatHull: 600, faction: 'terran', cargo: 60, strategicSpeed: 0.8, cloak: false, combat: 0 },       // a small slow transport (evacuation convoys)
  73: { price: 120000, mass: 5, combatHull: 1000, faction: 'terran', cargo: 100, strategicSpeed: 1.0, cloak: true, combat: 1 },      // a cloaked warship
};
const setup = (seed, raiders = 20) => {
  const { world } = makeWorld();
  const base = world.shipStats;
  world.shipStats = (id) => EXTRA[id] || (base(id) ? { cargo: 100, strategicSpeed: 1.0, combat: 1, ...base(id) } : null);
  const book = C.createCampaignBook(seed, 1); C.initializeCampaign(book, world);
  book.config.aiStrategicOps = false;
  const k = C.getPolity(book, 'klingon');
  const force = k.hulls.filter((h) => h.status === 'ready').slice(0, raiders);
  for (const h of force) h.systemIndex = 1;
  const r = C.startBlockade(book, world, { power: 'klingon', target: 1, hullIds: force.map((h) => h.id), purpose: 'interdict_trade' }, 1, []);
  assert.ok(r.ok, r.reason);
  return { world, book, b: r.record, force };
};
// A runner made of hypothetical hulls: the sponsor's book holds none of them, so a trial damages nothing
// but the blockade.
const runner = (key, ships) => ({ key, sponsor: 'terran', kind: 'test', hulls: ships.map(([shipId, role = 'transport', frac = 1], i) => {
  const hull = shipId >= 70 ? EXTRA[shipId].combatHull : 800;
  return { hullId: `x${i}`, vid: `vid-${i}`, shipId, hull: Math.round(hull * frac), maxHull: hull, role };
}) });
// Seeded Monte Carlo over fresh copies of the same book: the share of runs that got through.
const trials = (seed, raiders, ships, n = 300) => {
  const { world, book, b } = setup(seed, raiders);
  const snap = JSON.stringify(book);
  const out = { pass: 0, losses: 0, runnerDamage: 0, blockLosses: 0, outcomes: {} };
  for (let i = 0; i < n; i++) {
    const bk = JSON.parse(snap);
    const bb = bk.blockades.find((x) => x.id === b.id);
    const r = C.resolveBlockadeRun(bk, world, bb, runner(`t${i}`, ships), 2 + (i % 7), []);
    out.outcomes[r.outcome] = (out.outcomes[r.outcome] || 0) + 1;
    if (r.continues) out.pass++;
    if (r.hulls.some((x) => ['disabled', 'destroyed'].includes(x.condition))) out.losses++;
    out.runnerDamage += r.hulls.reduce((a, x) => a + (x.before - x.hull) / x.maxHull, 0) / r.hulls.length;
    out.blockLosses += r.blockaderLosses.lost + r.blockaderLosses.disabled;
  }
  out.pass /= n; out.losses /= n; out.runnerDamage /= n; out.blockLosses /= n;
  return out;
};
const record = (name, x) => { stats[name] = { pass: Math.round(x.pass * 1000) / 1000, losses: Math.round(x.losses * 1000) / 1000, runnerDamage: Math.round(x.runnerDamage * 1000) / 1000, blockadeLossesPerRun: Math.round(x.blockLosses * 1000) / 1000, outcomes: x.outcomes }; return x; };

test('1. a heavy blockade intercepts an unescorted slow transport more often than a light one', () => {
  const light = setup('BR-1L', 1), heavy = setup('BR-1H', 20);
  assert.equal(C.blockadeTier(light.b.coverage), 'light', `light coverage ${light.b.coverage}`);
  assert.equal(C.blockadeTier(heavy.b.coverage), 'heavy', `heavy coverage ${heavy.b.coverage}`);
  const l = record('light blockade, slow transport', trials('BR-1L', 1, [[70]]));
  const h = record('heavy blockade, slow transport', trials('BR-1H', 20, [[70]]));
  assert.ok(h.pass < l.pass - 0.2, `passage heavy ${h.pass} vs light ${l.pass}`);
  assert.ok(h.losses > l.losses, `losses heavy ${h.losses} vs light ${l.losses}`);
});
test('2. a faster runner does better than an otherwise identical slow one', () => {
  const slow = record('heavy, slow freighter', trials('BR-2', 20, [[70]]));
  const fast = record('heavy, fast freighter', trials('BR-2', 20, [[71]]));
  assert.ok(fast.pass > slow.pass + 0.1, `fast ${fast.pass} vs slow ${slow.pass}`);
  const { world, book, b } = setup('BR-2a', 20);
  const a = C.assessBlockadeRun(book, world, b, runner('a', [[70]])), f = C.assessBlockadeRun(book, world, b, runner('f', [[71]]));
  assert.ok(f.pDetect < a.pDetect && f.pCatch < a.pCatch, 'speed lowers both detection and interception');
  assert.ok(f.pPass < 1, 'speed is not automatic success');
});
test('3. a working cloak improves the odds, but is not automatic success; a wrecked cloak does nothing', () => {
  const plain = record('heavy, slow freighter (again)', trials('BR-3', 20, [[70]]));
  const cloaked = record('heavy, cloaked slow freighter', trials('BR-3', 20, [[72]]));
  assert.ok(cloaked.pass > plain.pass + 0.15, `cloaked ${cloaked.pass} vs ${plain.pass}`);
  assert.ok(cloaked.pass < 1, 'cloak made every run succeed');
  const { world, book, b } = setup('BR-3a', 20);
  const ok = C.assessBlockadeRun(book, world, b, runner('c', [[72]]));
  const wrecked = C.assessBlockadeRun(book, world, b, runner('w', [[72, 'transport', 0.4]]));
  assert.equal(ok.cloakAll, true); assert.equal(wrecked.cloakAll, false, 'a cloak on a ship at 40% hull still worked');
  assert.ok(ok.pDetect > 0.02, 'cloaked detection fell to the floor');
});
test('4. one uncloaked member denies a mixed formation the cloak: stealth is the least stealthy ship\'s', () => {
  const { world, book, b } = setup('BR-4', 20);
  const all = C.assessBlockadeRun(book, world, b, runner('all', [[72], [73, 'escort']]));
  const mixed = C.assessBlockadeRun(book, world, b, runner('mixed', [[70], [73, 'escort']]));
  assert.equal(all.cloakAll, true); assert.equal(mixed.cloakAll, false);
  assert.ok(mixed.pDetect > all.pDetect * 2, `mixed ${mixed.pDetect} vs all-cloaked ${all.pDetect}`);
  const m = record('heavy, uncloaked freighter + cloaked escort', trials('BR-4', 20, [[70], [73, 'escort']]));
  const c = record('heavy, cloaked freighter + cloaked escort', trials('BR-4', 20, [[72], [73, 'escort']]));
  assert.ok(c.pass > m.pass, `all-cloaked ${c.pass} vs mixed ${m.pass}`);
});
test('5. armed escorts improve survival and passage relative to unescorted transports', () => {
  const alone = record('heavy, 3 slow freighters', trials('BR-5', 20, [[70], [70], [70]]));
  const escorted = record('heavy, 3 slow freighters + 3 warships', trials('BR-5', 20, [[70], [70], [70], [12, 'escort'], [12, 'escort'], [12, 'escort']]));
  assert.ok(escorted.pass > alone.pass, `escorted ${escorted.pass} vs alone ${alone.pass}`);
  assert.ok(escorted.losses < alone.losses, `losses escorted ${escorted.losses} vs alone ${alone.losses}`);
  // Three warships are not three freighters.
  const { world, book, b } = setup('BR-5a', 20);
  const war = C.assessBlockadeRun(book, world, b, runner('w', [[12, 'escort'], [12, 'escort'], [12, 'escort']]));
  const civ = C.assessBlockadeRun(book, world, b, runner('c', [[70], [70], [70]]));
  assert.ok(war.E > 0 && civ.E === 0); assert.ok(war.pPass > civ.pPass);
});
test('6. a strong combat formation forces passage through a weaker blockade, and damages or breaks it', () => {
  const x = record('light blockade (2), 6 heavy warships', trials('BR-6', 2, Array.from({ length: 6 }, () => [12, 'escort'])));
  assert.ok(x.pass > 0.95, `passage ${x.pass}`);
  assert.ok((x.outcomes.fought_through || 0) + (x.outcomes.blockade_broken || 0) > 0, `outcomes ${JSON.stringify(x.outcomes)}`);
  assert.ok(x.blockLosses > 0, 'the blockade lost nothing to a superior force that fought through it');
});
test('7–8. blockade losses and disabled blockaders reduce its coverage and later interception strength', () => {
  const { world, book, b } = setup('BR-7', 20);
  const before = C.assessBlockadeRun(book, world, b, runner('p', [[70]]));
  const cov0 = b.coverage, n0 = b.hulls.length;
  // Disable three of its hulls (by the fleet damage model) and lose one outright.
  const hulls = b.hulls.map((t) => C.getPolity(book, 'klingon').hulls.find((h) => h.id === t.hullId));
  for (const h of hulls.slice(0, 3)) h.hull = Math.max(1, Math.floor(h.maxHull * 0.05));
  hulls[3].hull = 0; hulls[3].status = 'lost';
  const mid = C.assessBlockadeRun(book, world, b, runner('p', [[70]]));
  assert.ok(mid.S < before.S * 0.8, `disabled blockaders still count: ${mid.S} vs ${before.S}`);
  run(book, world, 2, 2);
  assert.ok(b.coverage < cov0, `coverage ${cov0} → ${b.coverage}`);
  assert.equal(b.hulls.length, n0 - 4, 'disabled or lost hulls still on station');
  const after = C.assessBlockadeRun(book, world, b, runner('p', [[70]]));
  assert.ok(after.pPass > before.pPass, `passage ${before.pPass} → ${after.pPass}`);
});
test('9. no blockade → the interception path never runs', () => {
  const { world } = makeWorld();
  const book = C.createCampaignBook('BR-9', 1); C.initializeCampaign(book, world); book.config.aiStrategicOps = false;
  const t = C.getPolity(book, 'terran');
  const carriers = t.hulls.filter((h) => h.status === 'ready').slice(0, 2); for (const h of carriers) h.systemIndex = 8;
  const base = world.shipStats; world.shipStats = (id) => (base(id) ? { ...base(id), cargo: 100 } : null);
  const e = C.startEvacuation(book, world, { sponsor: 'terran', origin: 8, destination: 0, transports: carriers.map((h) => h.id), target: 60000 }, 1, []).record;
  run(book, world, 2, 12);
  assert.equal(book.stats.interceptions || 0, 0);
  assert.ok(e.moved > 0);
  assert.deepEqual(C.applicableBlockadesAt(book, world, 1, 'terran'), []);
});
test('10. a weak blockade is leaked through without combat most of the time', () => {
  const x = record('light blockade (1), slow freighter', trials('BR-10', 1, [[70]]));
  const quiet = (x.outcomes.slipped_through || 0) + (x.outcomes.challenged_but_passed || 0);
  assert.ok(quiet / 300 > 0.6, `outcomes ${JSON.stringify(x.outcomes)}`);
});
test('11. the same crossing gives the same answer: seeded by the book, the blockade, the runner and the day', () => {
  const { world, book, b } = setup('BR-11', 20);
  const snap = JSON.stringify(book);
  const a = C.resolveBlockadeRun(JSON.parse(snap).blockades ? JSON.parse(snap) : book, world, JSON.parse(snap).blockades.find((x) => x.id === b.id), runner('same', [[70], [70]]), 5, []);
  const bk2 = JSON.parse(snap);
  const r2 = C.resolveBlockadeRun(bk2, world, bk2.blockades.find((x) => x.id === b.id), runner('same', [[70], [70]]), 5, []);
  assert.equal(a.outcome, r2.outcome); assert.deepEqual(a.hulls, r2.hulls);
});
test('12. a ceasefire before the crossing: the blockade is closed and does not apply', () => {
  const { world, book, b } = setup('BR-12', 20);
  assert.equal(C.blockadeApplies(book, world, b, 'terran'), true);
  C.forceWarTransition(book, world, 'terran', 'klingon', 'ceasefire', 2);
  assert.equal(b.status, 'closed');
  assert.equal(C.blockadeApplies(book, world, b, 'terran'), false);
  assert.deepEqual(C.applicableBlockadesAt(book, world, 1, 'terran'), []);
  // Neutral traffic is not fired on.
  const { world: w2, book: b2, b: bb } = setup('BR-12b', 20);
  assert.equal(C.blockadeApplies(b2, w2, bb, 'romulan'), false);
});
test('13. an evacuation convoy runs the blockade on its route through the shared engine: turned back convoys deliver nobody, losses cut capacity, escorts help', () => {
  const mk = (seed, escorts) => {
    const s = setup(seed, 8);
    const t = C.getPolity(s.book, 'terran');
    const hs = t.hulls.filter((h) => h.status === 'ready');
    const carriers = hs.slice(0, 3); for (const h of carriers) { h.systemIndex = 8; h.shipId = 74; h.maxHull = h.hull = 600; }
    const esc = hs.slice(3, 3 + escorts); for (const h of esc) { h.systemIndex = 8; h.shipId = 12; }
    const r = C.startEvacuation(s.book, s.world, { sponsor: 'terran', origin: 8, destination: 0, transports: carriers.map((h) => h.id), escorts: esc.map((h) => h.id), target: 60000 }, 1, []);
    assert.ok(r.ok, r.reason);
    const fx = run(s.book, s.world, 2, 40);
    return { ...s, e: r.record, fx };
  };
  const bare = mk('BR-13', 0), escorted = mk('BR-13', 4);
  const runs = (x) => x.fx.filter((f) => f.type === 'blockadeRun' && f.evacuationId === x.e.id);
  assert.ok(runs(bare).length > 0, 'the convoy never met the blockade at Vega');
  assert.ok(runs(bare).every((r) => r.target === 1), 'a run happened somewhere other than the blockaded system');
  const passedShare = (x) => runs(x).filter((r) => r.continues).length / Math.max(1, runs(x).length);
  stats['convoy 3 freighters (40 days)'] = { runs: runs(bare).length, passShare: passedShare(bare), moved: bare.e.moved, lost: bare.e.lost.length, removed: bare.e.removed.length, status: bare.e.status };
  stats['convoy 3 freighters + 4 escorts (40 days)'] = { runs: runs(escorted).length, passShare: passedShare(escorted), moved: escorted.e.moved, lost: escorted.e.lost.length, removed: escorted.e.removed.length, status: escorted.e.status };
  // Escorts help on the whole, not on every seed: compared over five campaigns (one seeded run is a coin).
  const seeds = ['BR-13', 'BR-13b', 'BR-13c', 'BR-13d', 'BR-13e'];
  const total = (esc) => seeds.reduce((n, sd) => n + (sd === 'BR-13' ? (esc ? escorted : bare) : mk(sd, esc)).e.moved, 0);
  const tb = total(0), te = total(4);
  stats['convoy escorts over five seeds'] = { bare: tb, escorted: te };
  assert.ok(te > tb, `moved escorted ${te} vs bare ${tb} over five seeds`);
  // Every loss is a named hull with its vid, and it no longer serves.
  for (const l of [...bare.e.lost, ...bare.e.removed]) { assert.ok(l.hullId); assert.ok(!bare.e.transports.some((t) => t.hullId === l.hullId)); }
  // No separate evacuation roll: every interdiction the convoy met is a blockadeRun.
  assert.ok(!bare.fx.some((f) => f.type === 'evacuationLoss' && !runs(bare).some((r) => r.day === f.day)), 'a transport was lost outside a run');
});
test('14. a destroyed runner is retired with its identity; a disabled one leaves with its vid', () => {
  const { world, book, b } = setup('BR-14', 20);
  const t = C.getPolity(book, 'terran');
  // Search seeds for a losing run against a real hull the book holds.
  const h = t.hulls.find((x) => x.status === 'ready'); h.shipId = 70; h.maxHull = 600; h.hull = 120; h.systemIndex = 1; h.vid = 'vid-real';
  let found = null;
  for (let i = 0; i < 200 && !found; i++) {
    const bk = JSON.parse(JSON.stringify(book));
    const r = C.resolveBlockadeRun(bk, world, bk.blockades.find((x) => x.id === b.id), { key: `k${i}`, sponsor: 'terran', kind: 'test', hulls: [{ hullId: h.id, vid: 'vid-real', shipId: 70, hull: 120, maxHull: 600 }] }, 3, []);
    if (r.hulls[0].condition !== 'operational') found = { r, bk };
  }
  assert.ok(found, 'no damaging run in 200 seeds');
  const hh = C.getPolity(found.bk, 'terran').hulls.find((x) => x.id === h.id);
  assert.equal(found.r.hulls[0].vid, 'vid-real');
  if (found.r.hulls[0].condition === 'destroyed') assert.equal(hh.status, 'lost'); else assert.equal(hh.hull, found.r.hulls[0].hull);
  assert.equal(C.getPolity(found.bk, 'terran').hulls.filter((x) => x.id === h.id).length, 1, 'the hull was duplicated');
});
test('15. what a run observes is what its crews saw: sighted, contact (a range) or engaged (a count)', () => {
  const seen = new Set();
  for (let i = 0; i < 120; i++) {
    const { world, book, b } = setup('BR-15', 20);
    const r = C.resolveBlockadeRun(book, world, b, { ...runner(`o${i}`, [[70]]), sponsor: 'player' }, 2, []);
    seen.add(r.observed.level);
    if (r.observed.level === 'sighted') assert.equal(r.observed.force, null);
    if (r.observed.level === 'contact') assert.match(r.observed.force, /–/);
    assert.deepEqual(b.sightings.player, r.observed);
  }
  assert.ok(seen.has('sighted') || seen.has('contact'));
});

console.log('\nseeded statistics (300 runs each unless noted):');
for (const [k, v] of Object.entries(stats)) console.log(`  ${k}: ${JSON.stringify(v)}`);
console.log(`\nblockade running pure: ${passed} passed`);
