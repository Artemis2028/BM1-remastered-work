// Pure tests for strategic evacuation and blockade (EVACUATION-BLOCKADE-RULES-261530ZSEP26).
import assert from 'node:assert/strict';
import * as C from '../src/campaign-strategy.mjs';
import { makeWorld, run } from './campaign-world-fixture.mjs';

let passed = 0;
const test = (name, fn) => { fn(); passed++; console.log('PASS', name); };
// The synthetic galaxy's hulls, each given a hold, so there is something to carry people in.
const setup = (seed) => {
  const { world } = makeWorld();
  const base = world.shipStats;
  world.shipStats = (id) => { const s = base(id); return s ? { ...s, cargo: 100 } : null; };
  const book = C.createCampaignBook(seed, 1); C.initializeCampaign(book, world);
  book.config.aiStrategicOps = false;
  const t = C.getPolity(book, 'terran'), k = C.getPolity(book, 'klingon');
  const carriers = t.hulls.filter((h) => h.status === 'ready').slice(0, 2); for (const h of carriers) h.systemIndex = 1;
  const raiders = k.hulls.filter((h) => h.status === 'ready').slice(0, 8); for (const h of raiders) h.systemIndex = 1;
  return { world, book, carriers, raiders };
};

test('an evacuation moves its transports\' lift each round trip, and nothing more', () => {
  const { world, book, carriers } = setup('EV-1');
  const r = C.startEvacuation(book, world, { sponsor: 'terran', origin: 1, destination: 0, transports: carriers.map((h) => h.id), target: 60000 }, 1, []);
  assert.ok(r.ok, r.reason);
  run(book, world, 2, 4);
  const e = r.record;
  const lift = e.transports.reduce((n, x) => n + x.lift, 0);
  // Three days of a three-day round trip: one full lift, fractions carried day to day, never invented.
  assert.ok(Math.abs(e.moved - lift) <= 1, `moved ${e.moved} for a lift of ${lift}`);
  assert.ok(carriers.every((h) => h.opId === e.id && h.status === 'assigned'));
});
test('a blockade needs a formal war and assigned hulls; its coverage scales with its force and cuts the evacuation', () => {
  const { world, book, carriers, raiders } = setup('EV-2');
  assert.equal(C.startBlockade(book, world, { power: 'romulan', target: 1, hullIds: C.getPolity(book, 'romulan').hulls.slice(0, 2).map((h) => h.id) }, 1, []).ok, false, 'blockade without a war');
  assert.equal(C.startBlockade(book, world, { power: 'klingon', target: 1, hullIds: [] }, 1, []).ok, false, 'blockade without ships');
  const e = C.startEvacuation(book, world, { sponsor: 'terran', origin: 1, destination: 0, transports: carriers.map((h) => h.id), target: 60000 }, 1, []).record;
  run(book, world, 2, 2); const clear = e.lastThroughput;
  const b = C.startBlockade(book, world, { power: 'klingon', target: 1, hullIds: raiders.map((h) => h.id), purpose: 'stop_evacuation' }, 2, []).record;
  assert.equal(b.status, 'active'); assert.ok(b.coverage > 0);
  run(book, world, 3, 3);
  assert.ok(e.lastThroughput < clear, `throughput ${clear} → ${e.lastThroughput}`);
  assert.ok(C.blockadeFlowFactor(book, 1, 1) < 1);
});
test('a ceasefire closes the war blockade through the war transition; the evacuation continues', () => {
  const { world, book, carriers, raiders } = setup('EV-3');
  const e = C.startEvacuation(book, world, { sponsor: 'terran', origin: 1, destination: 0, transports: carriers.map((h) => h.id), target: 60000 }, 1, []).record;
  const b = C.startBlockade(book, world, { power: 'klingon', target: 1, hullIds: raiders.map((h) => h.id) }, 1, []).record;
  const fx = C.forceWarTransition(book, world, 'terran', 'klingon', 'ceasefire', 2);
  assert.equal(b.status, 'closed'); assert.match(b.endReason, /ceasefire/);
  assert.ok(fx.some((x) => x.type === 'blockadeEnded'));
  assert.ok(raiders.every((h) => h.opId == null && h.status === 'ready'));
  assert.equal(e.status, 'active');
});
test('stepped and jumped advancement produce the same book with both operations running', () => {
  const a = setup('EV-4'), b = setup('EV-4');
  for (const s of [a, b]) {
    C.startEvacuation(s.book, s.world, { sponsor: 'terran', origin: 1, destination: 0, transports: s.carriers.map((h) => h.id), target: 60000 }, 1, []);
    C.startBlockade(s.book, s.world, { power: 'klingon', target: 1, hullIds: s.raiders.map((h) => h.id), purpose: 'stop_evacuation' }, 1, []);
  }
  for (let d = 2; d <= 30; d++) run(a.book, a.world, d, d);
  run(b.book, b.world, 2, 30);
  assert.equal(C.checksum(a.book), C.checksum(b.book));
});
console.log(`${passed} evacuation/blockade unit groups passed.`);
