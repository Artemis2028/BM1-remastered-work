// Shared fixture for the TREATY-EXPANSION pure suite and its measurement: the campaign-world fixture galaxy,
// extended with a second road into Klingon space (Archanis, Khitomer) so a DMZ has a way round it.
// ---- the fixture galaxy, extended with a second road into Klingon space ----
// Earth(0) ─ Vega(1) ─ Border(2, K) ─ Qonos(3, K); Vega ─ Romulus(4, R) ─ Qonos; Vega ─ Archanis(9, K) ─ Khitomer(10, K) ─ Qonos;
// Border ─ Cardassia(5, C) ─ Bajora(6) ⇄ Dominica(7); Vega ─ Minor(8, T) ─ Cardassia.
export const LEGS = { '0:1': 12, '1:2': 10, '2:3': 8, '1:4': 12, '2:5': 9, '5:6': 7, '6:7': 3, '1:8': 11, '4:3': 10, '8:5': 9, '1:9': 6, '9:10': 6, '10:3': 6 };
export const legDays = (a, b) => LEGS[`${a}:${b}`] ?? LEGS[`${b}:${a}`] ?? 1;
export const IDX = { Earth: 0, Vega: 1, Border: 2, Qonos: 3, Romulus: 4, Cardassia: 5, Bajora: 6, Dominica: 7, Minor: 8, Archanis: 9, Khitomer: 10 };
export const SHIPS = {
  90: { price: 60000, mass: 3, combatHull: 700, faction: 'terran', strategicSpeed: 0.8, recoveryCapacity: 8, combat: 0.3, cargo: 200, category: 'tug' },
  91: { price: 90000, mass: 5, combatHull: 900, faction: 'terran', strategicSpeed: 1.0, recoveryCapacity: 3, combat: 1, cargo: 0, category: 'cruiser' },
  95: { price: 80000, mass: 2, combatHull: 500, faction: 'terran', strategicSpeed: 1.0, recoveryCapacity: 1, combat: 1, cargo: 0, category: 'escort' },
  97: { price: 160000, mass: 5, combatHull: 1000, faction: 'klingon', strategicSpeed: 1.0, recoveryCapacity: 3, combat: 1, cargo: 0, category: 'cruiser' },
  99: { price: 50000, mass: 3, combatHull: 400, faction: 'terran', strategicSpeed: 1.0, recoveryCapacity: 4, combat: 0.2, cargo: 500, category: 'freighter' },
};
export function treatyWorldWith(C, makeWorld, seed, opts = {}) {
  const { world, relations } = makeWorld(opts);
  world.systems.push({ index: 9, name: 'Archanis', controller: 'klingon', origin: 'klingon', population: 800 }, { index: 10, name: 'Khitomer', controller: 'klingon', origin: 'klingon', population: 900 });
  const extra = [[4, 3], [8, 5], [1, 9], [9, 10], [10, 3]];
  const baseN = world.neighbours;
  world.neighbours = (i) => [...baseN(i), ...extra.filter(([a, b]) => a === i || b === i).map(([a, b]) => (a === i ? b : a))];
  world.legDays = legDays;
  const base = world.shipStats;
  world.shipStats = (id) => SHIPS[id] || (base(id) ? { cargo: 100, combat: 1, ...base(id) } : null);
  const book = C.createCampaignBook(seed, 1);
  C.initializeCampaign(book, world);
  book.config.aiStrategicOps = false;
  book.config.planningIntervalDays = 1e9;
  book.config.aiRecovery = false;
  for (const p of Object.values(book.polities)) p.lastPlanDay = 1e12;
  C.registerJourneyKind('treaty-test', {});
  return { world, book, relations };
}
