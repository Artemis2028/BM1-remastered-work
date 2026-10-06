// Shared pure fixture for HIROGEN-HUNTING-DOCTRINE: the campaign suites' nine-system galaxy plus the Hirogen Range
// (Hirogen) linked to Romulus and Minor, Hirogen classes, a fast and a slow Terran hull of the same class, an
// unarmed shuttle, and the real doctrine data. Usable against another tree (`C`, `DC` and `makeWorld` passed in),
// so the baseline reproduction runs the same scenario on c0a5890.
import fs from 'node:fs';
import path from 'node:path';

export const IDX = { Earth: 0, Vega: 1, Border: 2, Qonos: 3, Romulus: 4, Cardassia: 5, Bajora: 6, Dominica: 7, Minor: 8, Range: 9, Drift: 10 };
// Hull classes (price → strength; combatHull; strategic speed; combat value; category).
export const SHIPS = {
  70: { price: 130000, mass: 5, combatHull: 1100, faction: 'hirogen', strategicSpeed: 1.2, combat: 1, category: 'cruiser' },     // Hirogen Hunter
  71: { price: 200000, mass: 7, combatHull: 1600, faction: 'hirogen', strategicSpeed: 1.0, combat: 1, category: 'battleship' },  // Hirogen Warship
  72: { price: 20000, mass: 1, combatHull: 200, faction: 'hirogen', strategicSpeed: 1.0, combat: 0.2, category: 'shuttle' },     // Hirogen Shuttle
  74: { price: 130000, mass: 5, combatHull: 1100, faction: 'hirogen', strategicSpeed: 0.7, combat: 1, category: 'cruiser' },     // a slow hunter (same class otherwise)
  80: { price: 180000, mass: 7, combatHull: 1400, faction: 'terran', strategicSpeed: 1.0, combat: 1, category: 'cruiser' },      // Terran cruiser
  81: { price: 180000, mass: 7, combatHull: 1400, faction: 'terran', strategicSpeed: 1.6, combat: 1, category: 'cruiser' },      // the same cruiser, fast
  82: { price: 180000, mass: 7, combatHull: 1400, faction: 'terran', strategicSpeed: 0.6, combat: 1, category: 'cruiser' },      // the same cruiser, slow
  83: { price: 12000, mass: 1, combatHull: 150, faction: 'terran', strategicSpeed: 1.0, combat: 0.1, category: 'cargoShuttle' },  // unarmed shuttle
  84: { price: 600000, mass: 9, combatHull: 4000, faction: 'terran', strategicSpeed: 1.0, combat: 1, category: 'battleship' },  // a dreadnought (too strong)
  85: { price: 180000, mass: 7, combatHull: 1400, faction: 'terran', strategicSpeed: 1.0, combat: 1, category: 'cruiser', cloak: true }, // a cloaked cruiser
};
const LEGS = { '0:1': 6, '1:2': 6, '2:3': 6, '1:4': 6, '2:5': 6, '5:6': 6, '1:8': 6, '4:9': 5, '8:9': 5, '9:10': 6 };
export const legDays = (a, b) => LEGS[`${a}:${b}`] ?? LEGS[`${b}:${a}`] ?? 1;

export function huntWorld(C, makeWorld, seed, opts = {}) {
  const { world, relations } = makeWorld({});
  world.systems.push({ index: 9, name: 'Hirogen Range', controller: 'hirogen', origin: 'hirogen', population: 600 }, { index: 10, name: 'Drift', controller: null, origin: null, population: 0 });
  const extra = [[4, 9], [8, 9], [9, 10]];
  const baseN = world.neighbours;
  world.neighbours = (i) => [...baseN(i), ...extra.filter(([a, b]) => a === i || b === i).map(([a, b]) => (a === i ? b : a))];
  world.routes = [...world.routes, ...extra];
  world.legDays = legDays;
  const base = world.shipStats;
  world.shipStats = (id) => SHIPS[id] || (base(id) ? { combat: 1, ...base(id) } : null);
  const isF = world.isFaction;
  world.isFaction = (id) => id === 'hirogen' || isF(id);
  const nd = world.nativeDesigns;
  world.nativeDesigns = (f) => (f === 'hirogen' ? [70, 71, 72] : nd(f));
  const pick = world.pickHull;
  world.pickHull = (p, u) => (p === 'hirogen' ? [70, 71][Math.floor(u * 2) % 2] : pick(p, u));
  const book = C.createCampaignBook(seed, 1);
  C.initializeCampaign(book, world);
  book.config.aiStrategicOps = false;
  book.config.planningIntervalDays = 1e9;
  book.config.aiRecovery = false;
  for (const p of Object.values(book.polities)) p.lastPlanDay = 1e12;
  if (opts.doctrine !== false && opts.DC && opts.doctrine) world.doctrineStep = (b, w, d, fx) => opts.DC.advanceDoctrineDay(b, w, d, fx, opts.doctrine);
  return { world, book, relations };
}
export function loadDoctrine(D, root) {
  const read = (f) => JSON.parse(fs.readFileSync(path.join(root, f), 'utf8'));
  return D.loadDoctrine(read('docs/doctrine/bm1-faction-doctrine.v0.2.1.json'), read('docs/doctrine/bm1-faction-doctrine.schema.json'));
}
