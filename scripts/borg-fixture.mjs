// Shared pure fixture for BORG-ASSIMILATION-TRANSWARP: the campaign suites' nine-system galaxy plus Unimatrix
// (the Collective's world, far from everyone), the Nexus beyond Qonos, and the Outpost (a weak Terran world with a
// yard beside Unimatrix); Borg classes with their transwarp and assimilator capabilities as ship data; the real
// doctrine data. Usable against another tree (`C`, `DC`, `makeWorld` passed in) for the baseline reproduction.
import fs from 'node:fs';
import path from 'node:path';

export const IDX = { Earth: 0, Vega: 1, Border: 2, Qonos: 3, Romulus: 4, Cardassia: 5, Bajora: 6, Dominica: 7, Minor: 8, Unimatrix: 9, Nexus: 10, Outpost: 11 };
export const SHIPS = {
  // The Collective (BM1: 346 Borg Assimilation Cube). transwarp / assimilator are class data, as in the manifest.
  90: { price: 900000, mass: 10, combatHull: 30000, faction: 'borg', strategicSpeed: 1.32, combat: 1, category: 'battleship', assimilator: true, transwarp: { capable: true, access: 'own_conduit' } },
  91: { price: 300000, mass: 6, combatHull: 8000, faction: 'borg', strategicSpeed: 1.2, combat: 1, category: 'cruiser', assimilator: true, transwarp: { capable: false, access: 'carrier' } }, // a sphere: no conduit of its own
  92: { price: 60000, mass: 2, combatHull: 1500, faction: 'borg', strategicSpeed: 1.2, combat: 0.6, category: 'escort' },                                                              // a probe: sees, cannot assimilate
  // Prey.
  80: { price: 180000, mass: 7, combatHull: 1400, faction: 'terran', strategicSpeed: 1.0, combat: 1, category: 'cruiser' },
  81: { price: 180000, mass: 7, combatHull: 1400, faction: 'terran', strategicSpeed: 1.6, combat: 1, category: 'cruiser' },
  83: { price: 12000, mass: 1, combatHull: 150, faction: 'terran', strategicSpeed: 1.0, combat: 0.1, category: 'cargoShuttle' },
  84: { price: 600000, mass: 9, combatHull: 4000, faction: 'terran', strategicSpeed: 1.0, combat: 1, category: 'battleship' },
  85: { price: 180000, mass: 7, combatHull: 1400, faction: 'terran', strategicSpeed: 1.0, combat: 1, category: 'cruiser', cloak: true },
  86: { price: 2000000, mass: 10, combatHull: 60000, faction: 'terran', strategicSpeed: 1.0, combat: 1, category: 'battleship' }, // too strong for one cube
};
const LEGS = { '0:1': 6, '1:2': 6, '2:3': 6, '1:4': 6, '2:5': 6, '5:6': 6, '1:8': 6, '3:10': 8, '9:10': 8, '9:11': 8 };
export const legDays = (a, b) => LEGS[`${a}:${b}`] ?? LEGS[`${b}:${a}`] ?? 1;

export function borgWorld(C, makeWorld, seed, opts = {}) {
  const mw = makeWorld({});
  const { world, relations, stationsMap } = mw;
  // The Outpost's yard (berths: an industrial world worth assimilating).
  stationsMap[11] = [opts.station('o-yard', 74, 'terran')];
  world.systems.push({ index: 9, name: 'Unimatrix', controller: 'borg', origin: 'borg', population: 0 }, { index: 10, name: 'Nexus', controller: null, origin: null, population: 0 },
    { index: 11, name: 'Outpost', controller: 'terran', origin: 'terran', population: 3000 });
  const extra = [[3, 10], [9, 10], [9, 11]];
  const baseN = world.neighbours;
  world.neighbours = (i) => [...baseN(i), ...extra.filter(([a, b]) => a === i || b === i).map(([a, b]) => (a === i ? b : a))];
  world.routes = [...world.routes, ...extra];
  world.legDays = legDays;
  const base = world.shipStats;
  world.shipStats = (id) => SHIPS[id] || (base(id) ? { combat: 1, ...base(id) } : null);
  const isF = world.isFaction;
  world.isFaction = (id) => id === 'borg' || isF(id);
  const nd = world.nativeDesigns;
  world.nativeDesigns = (f) => (f === 'borg' ? [90] : nd(f));
  const pick = world.pickHull;
  world.pickHull = (p, u) => (p === 'borg' ? 90 : pick(p, u));
  const book = C.createCampaignBook(seed, 1);
  // The Collective opens with its cube at Unimatrix and two more hulls in reserve there (re-classed per test).
  book.config.openingReserveHulls = { ...(book.config.openingReserveHulls || {}), borg: opts.reserve ?? 2 };
  C.initializeCampaign(book, world);
  book.config.aiStrategicOps = false;
  book.config.planningIntervalDays = 1e9;
  book.config.aiRecovery = false;
  for (const p of Object.values(book.polities)) p.lastPlanDay = 1e12;
  if (opts.doctrine !== false && opts.DC && opts.doctrine) world.doctrineStep = (b, w, d, fx) => opts.DC.advanceDoctrineDay(b, w, d, fx, opts.doctrine);
  return { world, book, relations, stationsMap };
}
// The engine's handling of the two control effects, for the pure suites: a capture and an assimilation both
// change the controller; only a capture is a capture.
export function run(C, book, world, fromDay, toDay, onEffect = () => {}) {
  const all = [];
  for (let d = fromDay; d <= toDay; d++) {
    const effects = C.advanceCampaignDay(book, world, d);
    for (const e of effects) { if (e.type === 'captureSystem' || e.type === 'systemAssimilated') world.systems[e.systemIndex].controller = e.by; onEffect(e, d); }
    all.push(...effects);
  }
  return all;
}
export function loadDoctrine(D, root) {
  const read = (f) => JSON.parse(fs.readFileSync(path.join(root, f), 'utf8'));
  return D.loadDoctrine(read('docs/doctrine/bm1-faction-doctrine.v0.2.1.json'), read('docs/doctrine/bm1-faction-doctrine.schema.json'));
}
