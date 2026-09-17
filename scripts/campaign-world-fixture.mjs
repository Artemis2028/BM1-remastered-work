// Shared synthetic galaxy for the pure campaign suites. Nine systems, real station capabilities
// resolved through station-roles, a Bajoran wormhole to a far-side Dominion region, and a relation
// table the fixtures can rewrite. Both the model suite and the adversarial blocker gate use this, so
// a reproduction in one is a reproduction in the other.
import * as C from '../src/campaign-strategy.mjs';
import * as R from '../src/station-roles.mjs';

// ---- synthetic world: a small galaxy with real station capabilities ----
export const HULLS = {
  10: { price: 40000, mass: 3, combatHull: 400, faction: 'terran' }, 11: { price: 90000, mass: 5, combatHull: 800, faction: 'terran' }, 12: { price: 180000, mass: 7, combatHull: 1400, faction: 'terran' },
  20: { price: 45000, mass: 3, combatHull: 450, faction: 'klingon' }, 21: { price: 110000, mass: 6, combatHull: 950, faction: 'klingon' },
  30: { price: 60000, mass: 4, combatHull: 600, faction: 'romulan' }, 31: { price: 150000, mass: 7, combatHull: 1300, faction: 'romulan' },
  40: { price: 55000, mass: 4, combatHull: 550, faction: 'cardassian' }, 41: { price: 140000, mass: 7, combatHull: 1200, faction: 'cardassian' },
  50: { price: 70000, mass: 4, combatHull: 700, faction: 'dominion' }, 51: { price: 200000, mass: 8, combatHull: 1600, faction: 'dominion' },
  60: { price: 30000, mass: 2, combatHull: 300, faction: 'neutral' },
};
export const POOLS = { terran: [10, 11, 12], klingon: [20, 21], romulan: [30, 31], cardassian: [40, 41], dominion: [50, 51], bajoran: [60], player: [10, 60], neutral: [60] };
export function station(id, typeId, owner, extra = {}) {
  const def = { id, stationTypeId: typeId, name: extra.name || `${id}`, stockIds: extra.stockIds || [], weaponStockIds: [] };
  const cap = R.resolveStationCapabilities(def, {}, { discovered: { gorn: false }, ...(extra.ctx || {}) });
  return { id, typeId, owner, name: def.name, destroyed: Boolean(extra.destroyed), cap, offers: { shipIds: def.stockIds } };
}
export function makeWorld(opts = {}) {
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
    // Absent by default: a fixture that says nothing about what the captain has been offered must not
    // be read as saying they have been offered nothing. Suites that test the opportunity gate pass it.
    ...(opts.playerOpportunity ? { playerOpportunity: opts.playerOpportunity } : {}),
    ...(opts.journeyId ? { journeyId: opts.journeyId } : {}),
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
  };
  return { world, stationsMap, relations };
}
// apply captureSystem effects to the synthetic world so later days see the new controller
export function run(book, world, fromDay, toDay, onEffect = () => {}) {
  const all = [];
  for (let d = fromDay; d <= toDay; d++) {
    const effects = C.advanceCampaignDay(book, world, d);
    for (const e of effects) { if (e.type === 'captureSystem') world.systems[e.systemIndex].controller = e.by; onEffect(e, d); }
    all.push(...effects);
  }
  return all;
}
