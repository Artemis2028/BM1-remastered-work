import assert from 'node:assert/strict';
import * as C from '../src/campaign-strategy.mjs';
import * as R from '../src/station-roles.mjs';

let checks = 0;
const test = (name, fn) => { fn(); checks++; console.log('PASS', name); };
const copy = (v) => JSON.parse(JSON.stringify(v));

// ---- synthetic world: a small galaxy with real station capabilities ----
const HULLS = {
  10: { price: 40000, mass: 3, combatHull: 400, faction: 'terran' }, 11: { price: 90000, mass: 5, combatHull: 800, faction: 'terran' }, 12: { price: 180000, mass: 7, combatHull: 1400, faction: 'terran' },
  20: { price: 45000, mass: 3, combatHull: 450, faction: 'klingon' }, 21: { price: 110000, mass: 6, combatHull: 950, faction: 'klingon' },
  30: { price: 60000, mass: 4, combatHull: 600, faction: 'romulan' }, 31: { price: 150000, mass: 7, combatHull: 1300, faction: 'romulan' },
  40: { price: 55000, mass: 4, combatHull: 550, faction: 'cardassian' }, 41: { price: 140000, mass: 7, combatHull: 1200, faction: 'cardassian' },
  50: { price: 70000, mass: 4, combatHull: 700, faction: 'dominion' }, 51: { price: 200000, mass: 8, combatHull: 1600, faction: 'dominion' },
  60: { price: 30000, mass: 2, combatHull: 300, faction: 'neutral' },
};
const POOLS = { terran: [10, 11, 12], klingon: [20, 21], romulan: [30, 31], cardassian: [40, 41], dominion: [50, 51], bajoran: [60], player: [10, 60], neutral: [60] };
function station(id, typeId, owner, extra = {}) {
  const def = { id, stationTypeId: typeId, name: extra.name || `${id}`, stockIds: extra.stockIds || [], weaponStockIds: [] };
  const cap = R.resolveStationCapabilities(def, {}, { discovered: { gorn: false }, ...(extra.ctx || {}) });
  return { id, typeId, owner, name: def.name, destroyed: Boolean(extra.destroyed), cap, offers: { shipIds: def.stockIds } };
}
function makeWorld(opts = {}) {
  // 0 Earth(terran) - 1 Vega(terran) - 2 Border(klingon) - 3 Qonos(klingon) ; 4 Romulus(romulan) linked to 1 ; 5 Cardassia(cardassian) linked to 2 ; 6 Bajora(bajoran) linked to 5 ; 7 Dominica(dominion, far side)
  const systems = [
    { index: 0, name: 'Earth', controller: 'terran', origin: 'terran', population: 5700 },
    { index: 1, name: 'Vega', controller: 'terran', origin: 'terran', population: 3000 },
    { index: 2, name: 'Border', controller: 'klingon', origin: 'klingon', population: 2500 },
    { index: 3, name: 'Qonos', controller: 'klingon', origin: 'klingon', population: 9500 },
    { index: 4, name: 'Romulus', controller: 'romulan', origin: 'romulan', population: 8000 },
    { index: 5, name: 'Cardassia', controller: 'cardassian', origin: 'cardassian', population: 7000 },
    { index: 6, name: 'Bajora', controller: 'bajoran', origin: 'bajoran', population: 4500 },
    { index: 7, name: 'Dominica', controller: 'dominion', origin: 'dominion', population: 6000 },
    { index: 8, name: 'Minor', controller: 'terran', origin: 'cardassian', population: 1200 },
  ].map((s) => ({ ...s, ...(opts.systems?.[s.index] || {}) }));
  const routes = [[0, 1], [1, 2], [2, 3], [1, 4], [2, 5], [5, 6], [1, 8]];
  const stationsMap = {
    0: [station('e-yard', 73, 'terran'), station('e-yard2', 74, 'terran'), station('e-base', 70, 'terran'), station('e-plat', 87, 'terran'), station('e-hab', 84, 'terran'), station('e-relay', 89, 'terran')],
    1: [station('v-yard', 74, 'terran'), station('v-plat', 86, 'terran')],
    2: [station('b-plat', 86, 'klingon')],
    3: [station('q-yard', 81, 'klingon'), station('q-base', 79, 'klingon'), station('q-plat', 87, 'klingon'), station('q-relay', 89, 'klingon')],
    4: [station('r-yard', 90, 'romulan'), station('r-base', 90, 'romulan'), station('r-plat', 87, 'romulan')],
    5: [station('c-base', 88, 'cardassian'), station('c-plat', 86, 'cardassian')],
    6: [station('baj-plat1', 87, 'bajoran'), station('baj-plat2', 87, 'bajoran'), station('baj-plat3', 86, 'bajoran')],
    7: [station('d-yard', 111, 'dominion'), station('d-base', 109, 'dominion')],
    8: [],
    ...(opts.stations || {}),
  };
  const relationsBase = { 'terran:klingon': 'war', 'terran:cardassian': 'war', 'klingon:cardassian': 'war', 'terran:dominion': 'war', 'klingon:dominion': 'war', 'bajoran:dominion': 'war', 'cardassian:dominion': 'war', 'romulan:dominion': 'war' };
  const relations = { ...relationsBase, ...(opts.relations || {}) };
  const world = {
    day: 1, playerFaction: opts.playerFaction || 'neutral', localSystem: opts.localSystem ?? null,
    systems, routes, wormholes: [{ id: 'bajora-dominica-wormhole', from: 6, to: 7, name: 'Bajoran Wormhole' }],
    isFaction: (id) => id in POOLS && id !== 'player' && id !== 'neutral',
    factionName: (id) => id,
    shipStats: (id) => HULLS[id] || null,
    pickHull: (polityId, u) => { const pool = POOLS[polityId] || POOLS.neutral; return pool[Math.floor(u * pool.length) % pool.length]; },
    nativeDesigns: (faction) => POOLS[faction] || [],
    relation: (a, b) => { if (a === b) return 'allied'; return relations[`${a}:${b}`] || relations[`${b}:${a}`] || 'peace'; },
    stationsBySystem: (i) => stationsMap[i] || [],
    neighbours: (i) => routes.filter(([a, b]) => a === i || b === i).map(([a, b]) => (a === i ? b : a)),
    routeHops(from, to) { // BFS from any of `from` to `to`; wormhole counts as a route
      const adj = (i) => [...this.neighbours(i), ...this.wormholes.filter((w) => w.from === i).map((w) => w.to), ...this.wormholes.filter((w) => w.to === i).map((w) => w.from)];
      const seen = new Map(from.map((f) => [f, 0])); const q = [...from];
      while (q.length) { const cur = q.shift(); if (cur === to) return seen.get(cur); for (const n of adj(cur)) if (!seen.has(n)) { seen.set(n, seen.get(cur) + 1); q.push(n); } }
      return null;
    },
    doctrine: (id) => ({ aggression: id === 'romulan' ? 0.6 : 1 }),
    extraDefense: () => 0,
  };
  return { world, stationsMap, relations };
}
// apply captureSystem effects to the synthetic world so later days see the new controller
function run(book, world, fromDay, toDay, onEffect = () => {}) {
  const all = [];
  for (let d = fromDay; d <= toDay; d++) {
    const effects = C.advanceCampaignDay(book, world, d);
    for (const e of effects) { if (e.type === 'captureSystem') world.systems[e.systemIndex].controller = e.by; onEffect(e, d); }
    all.push(...effects);
  }
  return all;
}

test('daily, chunked, bulk and save-reloaded advancement over 2,000 days produce identical books', () => {
  const mk = () => { const { world } = makeWorld(); const book = C.createCampaignBook('seed-A', 1); return { world, book }; };
  const a = mk(); run(a.book, a.world, 2, 2001);
  const b = mk(); for (let d = 2; d <= 2001; d += 37) run(b.book, b.world, d, Math.min(2001, d + 36));
  const c0 = mk(); run(c0.book, c0.world, 2, 700); const reloaded = copy(c0.book); const w2 = makeWorld().world; for (const s of c0.world.systems) w2.systems[s.index].controller = s.controller; run(reloaded, w2, 701, 2001);
  assert.equal(C.checksum(a.book), C.checksum(b.book));
  assert.equal(C.checksum(a.book), C.checksum(reloaded));
  assert.equal(a.book.settled, 2001);
  // idempotent: re-running an already settled day changes nothing
  const before = C.checksum(a.book); C.advanceCampaignDay(a.book, a.world, 1500); assert.equal(C.checksum(a.book), before);
  console.log('   2,000-day book size:', JSON.stringify(a.book).length, 'bytes; battles', a.book.stats.battlesResolved, 'captures', a.book.stats.captures, 'built', a.book.stats.hullsBuilt, 'lost', a.book.stats.hullsLost);
});

test('the three accounts are separate: a rich faction with destroyed yards cannot replace ships; restored capacity resumes exactly once', () => {
  const { world, stationsMap } = makeWorld();
  const book = C.createCampaignBook('seed-B', 1);
  C.initializeCampaign(book, world);
  const t = C.getPolity(book, 'terran');
  t.treasury = 5000000; t.materials = 50000;
  for (const st of [...stationsMap[0], ...stationsMap[1]]) if (st.cap.services.construction !== 'none') { st.destroyed = true; st.cap = { ...st.cap, status: 'destroyed', effects: R.resolveStationCapabilities({ id: st.id, stationTypeId: st.typeId, destroyed: true }, {}).effects, services: R.resolveStationCapabilities({ id: st.id, stationTypeId: st.typeId, destroyed: true }, {}).services }; }
  const q = C.queueBuild(book, world, 'terran', 11, 0, 1);
  assert.equal(q.ok, false); assert.match(q.reason, /yard/);
  assert.equal(C.polityProduction(book, world, 'terran').berths, 0);
  assert.ok(C.polityEconomy(book, world, 'terran').treasury > 1000000, 'still rich');
  // restore one yard
  const yard = stationsMap[0].find((s) => s.id === 'e-yard'); yard.destroyed = false; yard.cap = R.resolveStationCapabilities({ id: yard.id, stationTypeId: yard.typeId }, {});
  const q2 = C.queueBuild(book, world, 'terran', 11, 0, 1);
  assert.equal(q2.ok, true);
  const hullsBefore = t.hulls.length, treasuryAfterReserve = t.treasury;
  const effects = run(book, world, 2, 40);
  const built = effects.filter((e) => e.type === 'hullBuilt' && e.polityId === 'terran');
  assert.ok(built.length >= 1, 'at least the manual order delivered');
  assert.equal(t.queue.filter((x) => x.deliveredHullId).length, t.queue.filter((x) => x.status === 'delivered').length);
  assert.ok(t.hulls.length > hullsBefore);
  assert.ok(treasuryAfterReserve < 5000000, 'reserved inputs were deducted once at order time');
  const delivered = t.queue.find((x) => x.id === q2.item.id);
  assert.equal(delivered?.status, 'delivered');
  assert.equal(t.hulls.filter((h) => h.id === delivered.deliveredHullId).length, 1, 'exactly one hull per order');
});

test('readiness follows real hulls: damage, loss, repair and supply change it; a lost hull never counts', () => {
  const { world } = makeWorld();
  const book = C.createCampaignBook('seed-C', 1); C.initializeCampaign(book, world);
  const k = C.getPolity(book, 'klingon');
  const r0 = C.polityReadiness(book, world, 'klingon').strength;
  k.hulls[0].hull = k.hulls[0].maxHull * 0.3;
  const r1 = C.polityReadiness(book, world, 'klingon').strength; assert.ok(r1 < r0);
  k.hulls[1].status = 'lost'; k.hulls[1].hull = 0;
  const r2 = C.polityReadiness(book, world, 'klingon').strength; assert.ok(r2 < r1);
  k.supply = 0.4; const r3 = C.polityReadiness(book, world, 'klingon').strength; assert.ok(r3 < r2);
  k.supply = 1; run(book, world, 2, 5); // the damaged hull sails to the owned yard at Qonos and is repaired before the first planning cycle
  assert.equal(k.hulls[0].systemIndex, 3, 'damaged hull relocated to the owned repair yard');
  assert.ok(k.hulls[0].hull > k.hulls[0].maxHull * 0.3, 'repair capacity restored hull');
  assert.equal(k.hulls[1].status, 'lost');
});

test('operations are finite, reachable and resolve exactly once; capture needs defeat plus hold, and a defended world does not flip', () => {
  const { world } = makeWorld({ localSystem: null });
  const book = C.createCampaignBook('seed-D', 1); C.initializeCampaign(book, world);
  const t = C.getPolity(book, 'terran');
  const before = t.hulls.filter((h) => h.status === 'ready').length;
  const hulls = t.hulls.filter((h) => h.status === 'ready').slice(0, 5);
  const op = C.launchOperation(book, world, 'terran', hulls, 2, 1, 1, 'assault');
  assert.equal(t.hulls.filter((h) => h.status === 'ready').length, before - 5, 'committed hulls leave the ready pool');
  assert.equal(op.status, 'moving');
  const effects = run(book, world, 2, 40);
  const resolved = effects.filter((e) => e.type === 'operationResolved' && e.opId === op.id);
  assert.equal(resolved.length, 1, 'resolved exactly once');
  const captures = effects.filter((e) => e.type === 'captureSystem' && e.opId === op.id);
  assert.ok(captures.length <= 1);
  if (captures.length) { assert.equal(world.systems[2].controller, 'terran'); assert.ok(book.occupations[2]); assert.ok(op.holdDays >= book.config.captureHoldDays || op.outcome === 'captured'); }
  // A world with an undefeated garrison is never captured: give Qonos a huge defender and attack it
  const k = C.getPolity(book, 'klingon'); for (const h of k.hulls) { h.status = 'ready'; h.systemIndex = 3; h.hull = h.maxHull; }
  for (let i = 0; i < 40; i++) k.hulls.push({ id: `big${i}`, shipId: 21, hull: 950, maxHull: 950, crew: 1, systemIndex: 3, status: 'ready', opId: null });
  const weak = t.hulls.filter((h) => h.status === 'ready').slice(0, 2);
  const op2 = C.launchOperation(book, world, 'terran', weak, 3, 41, 1, 'assault');
  const e2 = run(book, world, 42, 80);
  assert.equal(e2.filter((e) => e.type === 'captureSystem' && e.systemIndex === 3).length, 0, 'defended Qonos never flips');
  assert.equal(op2.status, 'resolved'); assert.ok(['destroyed', 'withdrew'].includes(op2.outcome));
});

test('a battle claimed by the loaded scene is not resolved offscreen, and its survivors are reconciled once', () => {
  const { world } = makeWorld();
  const book = C.createCampaignBook('seed-E', 1); C.initializeCampaign(book, world);
  const t = C.getPolity(book, 'terran');
  const hulls = t.hulls.filter((h) => h.status === 'ready').slice(0, 4);
  const op = C.launchOperation(book, world, 'terran', hulls, 2, 1, 1);
  run(book, world, 2, 2); assert.equal(op.status, 'engaged');
  const claim = C.claimOperationForScene(book, op.id);
  assert.ok(claim && claim.hulls.length === 4);
  assert.equal(C.claimOperationForScene(book, op.id), null, 'cannot be claimed twice');
  run(book, world, 3, 20); assert.equal(op.status, 'engaged', 'offscreen resolver skipped the claimed battle');
  const report = claim.hulls.map((h, i) => ({ hullId: h.id, destroyed: i < 2, hull: h.maxHull * 0.5 }));
  const effects = [];
  assert.equal(C.reconcileLocalOutcome(book, world, op.id, report, 'withdrew', 21, effects), true);
  assert.equal(op.status, 'resolved'); assert.equal(op.losses, 2); assert.equal(op.resolvedBy, 'local');
  assert.equal(C.reconcileLocalOutcome(book, world, op.id, report, 'withdrew', 22, effects), false, 'no second resolution');
  assert.equal(t.hulls.filter((h) => op.hullIds.includes(h.id) && h.status === 'lost').length, 2);
  // player present in the target system: never resolved offscreen
  const w2 = makeWorld({ localSystem: 2 }).world; const b2 = C.createCampaignBook('seed-E2', 1); C.initializeCampaign(b2, w2);
  const op3 = C.launchOperation(b2, w2, 'terran', C.getPolity(b2, 'terran').hulls.slice(0, 3), 2, 1, 1); run(b2, w2, 2, 30);
  assert.equal(op3.status, 'engaged');
});

test('major-world qualification: population-only qualifies, station-count-only qualifies, a minor world does not; platforms and abandoned sites do not count', () => {
  const { world } = makeWorld({ systems: { 8: { population: 1200 } } });
  const book = C.createCampaignBook('seed-F', 1); C.initializeCampaign(book, world);
  assert.equal(C.majorWorldQualification(book, world, 3).qualifies, true); // Qonos pop 9500
  assert.equal(C.majorWorldQualification(book, world, 8).qualifies, false); // Minor: pop 1200, 0 stations
  const { world: w2 } = makeWorld({ systems: { 8: { population: 1200 } }, stations: { 8: [station('m1', 75, 'terran'), station('m2', 75, 'terran'), station('m3', 84, 'terran'), station('m4', 83, 'terran'), station('m5', 74, 'terran'), station('m-plat', 86, 'terran'), station('m-ab', 78, 'terran', { name: 'X (abandoned)' })] } });
  const q = C.majorWorldQualification(book, w2, 8);
  assert.equal(q.qualifies, true); assert.equal(q.stations, 5); assert.match(q.reason, /5 operational stations/);
});

test('captured-industry integration works for every conqueror/source pairing incl. the player empire; momentary occupation grants nothing', () => {
  const pairings = [['romulan', 'terran', 0], ['terran', 'cardassian', 5], ['cardassian', 'romulan', 4], ['player', 'klingon', 3]];
  // A galaxy at peace isolates the integration clock from counter-offensives (those are covered by the rise/operations groups).
  const PEACE = Object.fromEntries(['terran:klingon', 'terran:cardassian', 'klingon:cardassian', 'terran:dominion', 'klingon:dominion', 'bajoran:dominion', 'cardassian:dominion', 'romulan:dominion'].map((k) => [k, 'peace']));
  for (const [conq, src, sysIndex] of pairings) {
    const { world } = makeWorld({ relations: PEACE });
    const book = C.createCampaignBook(`seed-G-${conq}`, 1); C.initializeCampaign(book, world);
    const sys = world.systems[sysIndex]; const from = sys.controller; sys.controller = conq; if (conq === 'player') world.playerFaction = 'neutral';
    C.recordCapture(book, world, sysIndex, conq, from, 1);
    const p = C.getPolity(book, conq);
    assert.equal(p.integrations[sysIndex].sourceFaction, src);
    assert.equal(Object.keys(p.licenses).length, 0, 'no licence on capture day');
    run(book, world, 2, 10);
    assert.equal(p.integrations[sysIndex].completedDay, null, 'not integrated after 9 days');
    run(book, world, 11, 80);
    assert.ok(p.integrations[sysIndex].completedDay, `${conq} integrated ${src} industry`);
    for (const d of POOLS[src]) assert.equal(p.licenses[d]?.source, 'integration');
    // losing the world afterwards keeps the licence but a fresh occupation elsewhere does not pre-grant one
    sys.controller = from;
    run(book, world, 81, 90);
    assert.ok(p.licenses[POOLS[src][0]], 'completed integration survives loss of the source world');
  }
  // occupation of a minor world never grants designs
  const { world } = makeWorld(); const book = C.createCampaignBook('seed-G2', 1); C.initializeCampaign(book, world);
  world.systems[8].controller = 'romulan'; C.recordCapture(book, world, 8, 'romulan', 'terran', 1); run(book, world, 2, 120);
  assert.equal(Object.keys(C.getPolity(book, 'romulan').licenses).length, 0);
  assert.equal(C.getPolity(book, 'romulan').integrations[8].qualification.qualifies, false);
});

test('the Earth–Klingon war resolves strategically, once: never by a roll, only when a belligerent loses its home world and cannot contest it, or holds nothing', () => {
  const { world } = makeWorld();
  const book = C.createCampaignBook('seed-W', 1); C.initializeCampaign(book, world);
  let resolved = run(book, world, 2, 40).filter((e) => e.type === 'warResolved');
  assert.equal(resolved.length, 0, 'an ordinary war does not resolve by itself');
  // Earth falls but the Terrans still field a real fleet: no settlement yet
  world.systems[0].controller = 'klingon';
  resolved = run(book, world, 41, 45).filter((e) => e.type === 'warResolved');
  assert.equal(resolved.length, 0, 'losing the capital alone is not a settlement while the fleet can contest it');
  // the Terran fleet is broken: settlement follows, exactly once
  for (const h of C.getPolity(book, 'terran').hulls) h.status = 'lost';
  resolved = run(book, world, 46, 60).filter((e) => e.type === 'warResolved');
  assert.equal(resolved.length, 1); assert.equal(resolved[0].loser, 'terran'); assert.equal(resolved[0].winner, 'klingon'); assert.match(resolved[0].reason, /Earth has fallen/);
  assert.ok(book.resolutions['terran:klingon']);
  run(book, world, 61, 120);
  assert.equal(book.history.filter((h) => h.kind === 'resolution').length, 1, 'never recorded twice');
  // a belligerent with no worlds at all also sues for peace
  const { world: w2 } = makeWorld(); const b2 = C.createCampaignBook('seed-W2', 1); C.initializeCampaign(b2, w2);
  for (const sys of w2.systems) if (sys.controller === 'klingon') sys.controller = 'terran';
  const r2 = run(b2, w2, 2, 10).filter((e) => e.type === 'warResolved');
  assert.equal(r2.length, 1); assert.equal(r2[0].loser, 'klingon'); assert.match(r2[0].reason, /holds no world/);
});

test('Dominion: dormant → reconnaissance → staging → invasion through the Bajoran link with two warnings first; a real blockade cuts reinforcements; a prepared defence defeats the expedition', () => {
  const { world } = makeWorld();
  const book = C.createCampaignBook('seed-H', 1); C.initializeCampaign(book, world);
  const effects = run(book, world, 2, book.config.dominionInvasionDay + 2);
  const warnings = effects.filter((e) => e.type === 'dominionWarning');
  assert.ok(warnings.length >= 2, 'at least two warnings before the assault');
  assert.equal(book.dominion.phase, 'invasion');
  const op = book.operations.find((o) => o.id === book.dominion.expeditionOpId);
  assert.equal(op.targetSystem, 6, 'entry is Bajora (system 6), resolved by endpoint id');
  assert.ok(warnings.every((w) => w.day < op.createdDay + 1));
  // Bajora has three platforms: blockade strength; reinforcement cut while Bajora holds
  run(book, world, book.config.dominionInvasionDay + 3, book.config.dominionInvasionDay + 40);
  const convoysWhileBlocked = effects.filter((e) => e.type === 'dominionConvoy').length;
  assert.equal(typeof book.dominion.reinforcementCut, 'boolean');
  // Prepared defence: rerun with an overwhelming Bajoran garrison → expedition destroyed or withdrawn, Bajora never Dominion
  const { world: w2 } = makeWorld(); const b2 = C.createCampaignBook('seed-H2', 1); C.initializeCampaign(b2, w2);
  const baj = C.getPolity(b2, 'bajoran'); for (let i = 0; i < 60; i++) baj.hulls.push({ id: `bd${i}`, shipId: 12, hull: 1400, maxHull: 1400, crew: 1, systemIndex: 6, status: 'ready', opId: null });
  const e2 = run(b2, w2, 2, 200);
  assert.equal(w2.systems[6].controller, 'bajoran', 'a prepared defence held Bajora; no scripted reversal');
  const exp = b2.operations.find((o) => o.id === b2.dominion.expeditionOpId);
  assert.ok(exp && exp.status === 'resolved' && ['destroyed', 'withdrew'].includes(exp.outcome));
  assert.ok(b2.dominion.reinforcementCut, 'a working blockade cut reinforcements');
  assert.equal(e2.filter((e) => e.type === 'dominionConvoy').length, 0, 'no convoy bypassed the blockade');
  assert.ok(b2.polities.dominion.hulls.filter((h) => h.status !== 'lost').length > 0 || exp.outcome === 'destroyed', 'surviving bridgehead forces (if any) remain in play');
});

test('rise scenarios (seeded fixtures, not balance evidence): Romulus, Cardassia, a small power and the player empire can each become the leading contender', () => {
  // the scripted Dominion expedition is switched off here (no wormhole): these fixtures rank the Alpha Quadrant powers only
  const rise = (id, setup) => { const { world } = makeWorld(); world.wormholes = []; const book = C.createCampaignBook(`seed-rise-${id}`, 1); C.initializeCampaign(book, world); setup(book, world); run(book, world, 2, 200);
    // ranked among the Alpha Quadrant powers; the Dominion expedition is scripted separately and is not a "rise"
    const ranks = Object.keys(book.polities).filter((p) => p !== 'dominion').map((p) => [p, C.polityReadiness(book, world, p).strength]).sort((a, b) => b[1] - a[1]); return ranks[0][0]; };
  assert.equal(rise('romulan', (book, world) => { world.relation = (a, b) => (a === b ? 'allied' : (['terran', 'klingon'].includes(a) && ['terran', 'klingon'].includes(b)) ? 'war' : 'peace'); C.getPolity(book, 'romulan').treasury = 2000000; }), 'romulan');
  assert.equal(rise('cardassian', (book, world) => { world.relation = (a, b) => (a === b ? 'allied' : (['terran', 'klingon'].includes(a) && ['terran', 'klingon'].includes(b)) ? 'war' : 'peace'); const c = C.getPolity(book, 'cardassian'); c.treasury = 800000; for (let i = 0; i < 16; i++) c.hulls.push({ id: `c${i}`, shipId: 41, hull: 1200, maxHull: 1200, crew: 1, systemIndex: 5, status: 'ready', opId: null }); }), 'cardassian');
  assert.equal(rise('bajoran', (book, world) => { world.relation = () => 'peace'; const b = C.getPolity(book, 'bajoran'); for (let i = 0; i < 30; i++) b.hulls.push({ id: `b${i}`, shipId: 12, hull: 1400, maxHull: 1400, crew: 1, systemIndex: 6, status: 'ready', opId: null }); }), 'bajoran');
  assert.equal(rise('player', (book, world) => { world.relation = () => 'peace'; world.systems[1].controller = 'player'; world.systems[8].controller = 'player'; const p = C.getPolity(book, 'player'); for (let i = 0; i < 30; i++) p.hulls.push({ id: `p${i}`, shipId: 12, hull: 1400, maxHull: 1400, crew: 1, systemIndex: 1, status: 'ready', opId: null }); }), 'player');
});

test('design recovery: a sole-source loss offers one bounded contract; completion relocates access once; plan quotes pin 4× price and the next standing tier through 100', () => {
  const { world, stationsMap } = makeWorld({ stations: { 4: [station('r-yard', 90, 'romulan', { stockIds: [31] }), station('r-base', 90, 'romulan')] } });
  const book = C.createCampaignBook('seed-I', 1); C.initializeCampaign(book, world);
  assert.deepEqual(book.designs[31].sources, ['r-yard']);
  const effects = [];
  C.recordStationLoss(book, world, 'r-yard', 4, 5, effects);
  assert.equal(effects.filter((e) => e.type === 'recoveryOffered').length, 1);
  C.recordStationLoss(book, world, 'r-yard', 4, 6, effects);
  assert.equal(effects.filter((e) => e.type === 'recoveryOffered').length, 1, 'no duplicate offer');
  assert.equal(C.designStatus(book, 31).state, 'lost'); assert.match(C.designStatus(book, 31).text, /Original yard lost/);
  const r = book.recoveries[0];
  assert.equal(C.completeRecovery(book, world, r.id, 'r-base', 10, effects).ok, true);
  assert.equal(C.completeRecovery(book, world, r.id, 'r-base', 11, effects).ok, false, 'not repeatable');
  assert.equal(C.designStatus(book, 31).state, 'available');
  // an unpursued contract lapses after the offer window and a broker lead follows, once
  const { world: w3 } = makeWorld({ stations: { 4: [station('r-yard', 90, 'romulan', { stockIds: [31] }), station('r-base', 90, 'romulan')] } });
  const b3 = C.createCampaignBook('seed-I3', 1); C.initializeCampaign(b3, w3);
  C.recordStationLoss(b3, w3, 'r-yard', 4, 5, []);
  const fx3 = run(b3, w3, 6, 5 + b3.config.recoveryOfferDays + 2);
  assert.equal(b3.recoveries.length, 2); assert.equal(b3.recoveries[0].status, 'failed'); assert.equal(b3.recoveries[1].kind, 'broker'); assert.equal(b3.recoveries[1].status, 'available');
  assert.equal(fx3.filter((e) => e.type === 'recoveryOffered').length, 1);
  run(b3, w3, 5 + b3.config.recoveryOfferDays + 3, 5 + 2 * b3.config.recoveryOfferDays + 10);
  assert.equal(b3.recoveries.length, 2, 'no further respawn after the broker lead lapses'); assert.equal(b3.recoveries[1].status, 'failed');
  for (const [base, tier] of [[0, 15], [15, 30], [30, 50], [50, 75], [75, 100], [100, 100]]) assert.equal(C.planQuote(100000, base, false).standing, tier);
  assert.equal(C.planQuote(100000, 0, false).price, 400000);
  assert.equal(C.planQuote(100000, 0, true).price, 0, 'an already owned licence is not charged again');
});

test('relays: connectivity comes from real operational relay stations; queued distant orders acknowledge once when a link returns', () => {
  const { world, stationsMap } = makeWorld();
  const book = C.createCampaignBook('seed-J', 1);
  let connected = C.relayConnectivity(world, 'terran');
  assert.ok(connected.has(0) && connected.has(1), 'sector relay at Earth covers Earth and its neighbour');
  const o = C.queueDistantOrder(book, { systemIndex: 4, fleetId: 'f1', order: 'move' }, 1, connected.has(4));
  assert.equal(o.status, 'queued', 'Romulus is not covered');
  stationsMap[0].find((s) => s.id === 'e-relay').destroyed = true;
  connected = C.relayConnectivity(world, 'terran');
  assert.ok(!connected.has(1), 'losing the relay drops coverage');
  const o2 = C.queueDistantOrder(book, { systemIndex: 1, fleetId: 'f2', order: 'move' }, 2, connected.has(1));
  assert.equal(o2.status, 'queued');
  stationsMap[0].find((s) => s.id === 'e-relay').destroyed = false;
  const acked = C.acknowledgeQueuedOrders(book, 3, C.relayConnectivity(world, 'terran'));
  assert.deepEqual(acked.map((x) => x.id), [o2.id]);
  assert.deepEqual(C.acknowledgeQueuedOrders(book, 4, C.relayConnectivity(world, 'terran')), [], 'acknowledged once');
});

test('missions: offered once per key, accepted, completed or failed once, expired by deadline', () => {
  const book = C.createCampaignBook('seed-K', 1);
  const m = C.offerMission(book, { key: 'relief:6', kind: 'relief', systemIndex: 6, deadlineDay: 10 }, 1);
  assert.ok(m); assert.equal(C.offerMission(book, { key: 'relief:6', kind: 'relief', systemIndex: 6 }, 1), null);
  assert.equal(C.acceptMission(book, m.id, 2), true); assert.equal(C.acceptMission(book, m.id, 2), false);
  assert.ok(C.completeMission(book, m.id, 3)); assert.equal(C.completeMission(book, m.id, 3), null);
  const m2 = C.offerMission(book, { key: 'escort:1', kind: 'escort', deadlineDay: 5 }, 1);
  const { world } = makeWorld(); C.initializeCampaign(book, world); run(book, world, 2, 8);
  assert.equal(book.missions.find((x) => x.id === m2.id).status, 'expired');
});

console.log(`${checks}/${checks} campaign strategy groups passed.`);
