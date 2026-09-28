// The doctrine galaxy for the phase 3 suites: the shared synthetic nine systems, phase 1's Delpi, Vulcan
// and Aldnas, and phase 2's Ferengi and Tholian space (see scripts/doctrine-phase2-test.mjs for the map).
//   Romulus(4) ─ Aldnas(11) ─ Delpi(9) ─ Vulcan(10) ─ Vega(1)          Tholia(14) ─ Veil(15) ─ Deep(16) ─ Vulcan(10)
//                  │   │                  │
//             Border(2) Ferenginar(12) ─ Ganalda(13) ─ Rigel(17) ─ Delpi(9)        Far Reach(18): no routes
import * as C from '../src/campaign-strategy.mjs';
import { makeWorld, run, HULLS, POOLS } from './campaign-world-fixture.mjs';

Object.assign(HULLS, {
  70: { price: 30000, mass: 5, combatHull: 500, faction: 'ferengi', speed: 40, combat: 0, cargo: 500 },
  80: { price: 50000, mass: 3, combatHull: 420, faction: 'delpin', speed: 70, combat: 0.4, cargo: 40 },
  90: { price: 80000, mass: 4, combatHull: 700, faction: 'vulcan', speed: 50, combat: 1, cargo: 200 },
  91: { price: 30000, mass: 5, combatHull: 500, faction: 'cardassian', speed: 25, combat: 0, cargo: 900 },
  95: { price: 90000, mass: 6, combatHull: 900, faction: 'tholian', speed: 45, combat: 1 },
  96: { price: 30000, mass: 6, combatHull: 600, faction: 'tholian', speed: 30, combat: 0, cargo: 800 },
});
POOLS.delpin = [80]; POOLS.vulcan = [90]; POOLS.ferengi = [70]; POOLS.tholian = [95];
export const IDX = { Earth: 0, Vega: 1, Border: 2, Qonos: 3, Romulus: 4, Cardassia: 5, Bajora: 6, Dominica: 7, Minor: 8, Delpi: 9, Vulcan: 10, Aldnas: 11, Ferenginar: 12, Ganalda: 13, Tholia: 14, Veil: 15, Deep: 16, Rigel: 17, FarReach: 18 };
export function galaxy(seed, opts = {}) {
  const { world, relations, stationsMap } = makeWorld(opts);
  world.systems.push(
    { index: 9, name: 'Delpi', controller: 'delpin', origin: 'delpin', population: 3000 },
    { index: 10, name: 'Vulcan', controller: 'vulcan', origin: 'vulcan', population: 6000 },
    { index: 11, name: 'Aldnas', controller: null, origin: null, population: 0 },
    { index: 12, name: 'Ferenginar', controller: 'ferengi', origin: 'ferengi', population: 4000 },
    { index: 13, name: 'Ganalda', controller: null, origin: null, population: 0 },
    { index: 14, name: 'Tholia', controller: 'tholian', origin: 'tholian', population: 5000 },
    { index: 15, name: 'Veil', controller: 'tholian', origin: 'tholian', population: 800 },
    { index: 16, name: 'Deep', controller: 'tholian', origin: 'tholian', population: 800 },
    { index: 17, name: 'Rigel', controller: null, origin: null, population: 0 },
    { index: 18, name: 'Far Reach', controller: null, origin: null, population: 0 },
  );
  world.routes.push([4, 11], [11, 9], [9, 10], [10, 1], [11, 2], [12, 11], [12, 13], [13, 17], [17, 9], [14, 15], [15, 16], [16, 10]);
  const book = C.createCampaignBook(seed, 1);
  C.initializeCampaign(book, world);
  book.config.aiStrategicOps = false;
  book.config.planningIntervalDays = opts.planning ? book.config.planningIntervalDays : 1e9;
  if (opts.planning) book.config.aiStrategicOps = true;
  return { world, book, relations, stationsMap };
}
export { run, HULLS, POOLS };
export const P = (book, id) => C.getPolity(book, id);
export const ready = (book, id, at = null) => P(book, id).hulls.filter((h) => h.status === 'ready' && !h.opId && (at == null || h.systemIndex === at)).sort((a, b) => String(a.id).localeCompare(String(b.id)));
export const hullById = (book, polity, id) => P(book, polity).hulls.find((h) => h.id === id);
export const reload = (book) => C.upgradeCampaignBook(JSON.parse(JSON.stringify(book)));
// Knock a hull into the disabled band where it is, as a battle leaves it.
export function disable(h) { h.hull = Math.max(1, Math.floor(h.maxHull * 0.05)); }
