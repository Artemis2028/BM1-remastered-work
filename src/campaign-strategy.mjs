// Strategic campaign model: three separate accounts per polity (economy, production, military
// readiness), persistent finite operations, single-resolution battles, captured-industry
// integration, design licences and recovery, and the phased Dominion expedition.
//
// This module is pure. It never touches the DOM or engine state directly: main.js builds a `world`
// snapshot (systems, stations with resolved capabilities, routes, ship stats, relations) and applies
// the `effects` this module returns. Every random draw is seeded from the campaign seed, the day and
// a topic, so daily, chunked and bulk advancement produce identical books.
//
// Every number in CAMPAIGN_RULES is first-pass tuning (units documented inline), not measured balance.

import { stableHash, bounded, copy, planStanding } from './ship-fleet.mjs';

export const CAMPAIGN_VERSION = 1;

export const CAMPAIGN_RULES = Object.freeze({
  version: CAMPAIGN_VERSION,
  // Economy (latinum per day unless stated)
  worldRevenueBase: 400,           // per controlled world
  worldRevenuePerPopulation: 0.05,  // × population units from planetData (Earth ≈ 285/day on top of the base)
  materialsPerWorld: 1,            // duranium per controlled world per day (mines add more)
  hullUpkeepPerMass: 1,            // matches the personal-fleet upkeep basis (mass per day)
  treasuryCap: 2000000,
  materialsCap: 20000,
  openingTreasuryPerWorld: 15000,
  openingMaterialsPerWorld: 150,
  openingTreasuryFloor: 120000,    // the reviewed reconstruction budget floor: a faction can still rebuild a lost installation
  openingMaterialsFloor: 1200,
  // Production
  buildLatinumFactor: 0.82,        // Fleet.buildRecipe basis
  buildMaterialsPerMass: 2,
  buildDaysPerSqrtMass: 2,
  heavyMass: 6,                    // mass >= heavyMass needs a heavy berth
  workforcePerBerth: 1,
  energyPerHeavyBerth: 2,
  repairPointsPerBerthDay: 200,    // repairing this many hull points occupies one berth for a day
  // Readiness
  strengthPerPrice: 1 / 1000,      // hull strength = price × this × condition × crew × supply
  crewRecoveryPerDay: 0.02,        // crew readiness regained per day at a world with morale effects
  supplyFloor: 0.35,               // strength multiplier when a polity has no supply route
  // Opening forces (real hulls, seeded from legal pools; ratios are hypotheses to measure).
  // Each world is garrisoned up to a strength budget (price/1000 units), so a faction whose legal
  // pool is expensive gets fewer, heavier hulls rather than a bigger fleet.
  openingStrengthPerWorld: 500,
  openingMaxHullsPerWorld: 6,
  openingStrengthMultiplier: { klingon: 1.0, terran: 1.3 }, // Klingons hold more worlds; Earth's garrisons are denser, so the opening war is a grind rather than a rout
  openingReserveHulls: { klingon: 6, terran: 4 },
  homeGarrisonPerWorld: 2,         // ready hulls an AI keeps back per controlled world when planning an offensive
  // Operations
  planningIntervalDays: 6,
  minReadinessRatioToAttack: 1.6,  // attacker committed strength vs defender local strength
  attackCommitFraction: 0.45,      // share of ready hulls committed to one operation
  raidHulls: 4,
  routeUnitsPerDay: 10,            // same basis as Fleet.travelDays
  engagementDays: 3,               // days of offscreen fighting before a decision
  captureHoldDays: 4,              // attacker must hold an undefended (or suppressed) objective this long
  suppressionRatio: 4,             // attackers this many times stronger than the local defence storm it instead of grinding
  attritionPerDay: 0.15,           // share of the weaker side's hull points lost per day of even fighting (scaled by the strength ratio)
  aiWarChest: 250000,              // treasury above which an AI polity orders growth hulls beyond its opening count
  retreatFraction: 0.4,            // attackers withdraw below this share of committed strength
  garrisonStrengthPerDefense: 35,  // station defense effect × this = abstract garrison strength (a platform ≈ one escort, a starbase ≈ three)
  occupationOutputFactor: 0.5,     // output of a freshly captured world
  occupationIntegrationDays: 20,   // days until a captured world reaches full output
  // Captured-world design access
  majorWorldPopulation: 4000,      // OR
  majorWorldStations: 5,           // operational, non-abandoned, non-platform stations
  integrationDays: 30,             // retooling days before native designs become producible
  // Dominion expedition (day offsets from campaign day 1; tunable data, not fixed gates)
  dominionReconDay: 25,
  dominionStagingDay: 45,
  dominionInvasionDay: 60,
  dominionExpeditionStrengthRatio: 0.8, // expedition staged to this share of the strongest power's ready strength at staging time
  dominionExpeditionMinStrength: 3000,
  dominionExpeditionMaxHulls: 40,
  dominionReinforcementEveryDays: 12,
  dominionReinforcementHulls: 2,
  dominionBlockadeStrength: 600,   // defender strength at the entry system that interdicts reinforcement convoys (≈ a starbase plus escorts)
  dominionMaxConvoys: 8,           // reinforcement is finite: the expedition must win with what the wormhole can carry
  dominionOpportunityRatio: 0.9,   // expedition strength vs best local opposition needed to advance past the bridgehead
  // Strategic resolution of the opening war: no calendar roll ends it; it ends when one belligerent
  // loses its home world and cannot contest it, or loses every world.
  centralWar: ['terran', 'klingon'],
  homeWorlds: { terran: 'Earth', klingon: 'Qonos' },
  resolutionStrengthRatio: 0.25, // the loser's ready strength vs the winner's when the home world has fallen
  // History and bounds
  recoveryOfferDays: 400,          // an unpursued recovery contract lapses after this many days (then one broker lead)
  historyLimit: 300,
  maxOperations: 60,
  maxQueuePerPolity: 12,
  maxHullsPerPolity: 120,
});

export const STANDING_TIERS = Object.freeze([0, 15, 30, 50, 75, 100]);
export function planPrice(hullPrice) { return 4 * Math.max(0, Math.round(hullPrice)); }
export function planStandingRequired(base) { return planStanding(base); }

export function seededUnit(seed, ...parts) {
  return stableHash(`${seed}:${parts.join(':')}`) / 4294967296;
}

export function createCampaignBook(seed, day = 1, config = {}) {
  return {
    version: CAMPAIGN_VERSION,
    seed: String(seed),
    day: Number(day) || 1,
    settled: Number(day) || 1,
    initialized: false,
    config: { ...CAMPAIGN_RULES, ...config },
    discoveries: { gorn: false },
    polities: {},
    operations: [],
    dominion: { phase: 'dormant', phaseDay: null, warnings: [], entrySystem: null, stagingSystem: null, expeditionOpId: null, reinforcementCut: false, convoys: 0, lastConvoyDay: null },
    designs: {},         // shipId → { sources: [stationId], lost: [stationId], relocatedTo: stationId|null }
    recoveries: [],      // bounded recovery contracts
    missions: [],
    orders: [],          // queued distant fleet orders awaiting relay acknowledgement
    history: [],
    counter: 0,
    incomeLedger: {},    // day → true (player revenue credited once)
    restoredStations: {},
    activatedStations: {},
    unstaffedStations: {},
    occupations: {},     // systemIndex → { capturedDay, by }
    stats: { battlesResolved: 0, captures: 0, hullsBuilt: 0, hullsLost: 0 },
  };
}
export function nextCampaignId(book, type) { return `${book.seed}:${type}:${++book.counter}`; }

function polity(book, id) {
  return (book.polities[id] ||= {
    id, kind: id === 'player' ? 'player' : 'faction', active: true,
    treasury: 0, materials: 0, revenueLastDay: 0, expenseLastDay: 0, supply: 1,
    hulls: [], queue: [], integrations: {}, licenses: {}, readinessBaseline: null,
    lastPlanDay: 0, lostHulls: 0, builtHulls: 0,
  });
}
export function getPolity(book, id) { return book.polities[id] || null; }
export function ensurePolity(book, id) { return polity(book, id); }

function addHistory(book, day, kind, text, extra = {}) {
  book.history.push({ day, kind, text, ...extra });
  if (book.history.length > book.config.historyLimit) book.history = book.history.slice(-book.config.historyLimit);
}

// ---------- world helpers ----------
function controlled(world, polityId) { return world.systems.filter((s) => s.controller === polityId); }
function systemStations(world, index) { return world.stationsBySystem(index).filter((s) => !s.destroyed); }
function isOperationalStation(st) { return Boolean(st) && !st.destroyed && Boolean(st.cap) && ['operational', 'damaged', 'unstaffed'].includes(st.cap.status); }
function stationEffects(world, index, ownerId = null) {
  const total = {};
  for (const st of systemStations(world, index)) {
    if (!isOperationalStation(st)) continue;
    if (ownerId && st.owner !== ownerId) continue;
    for (const [k, v] of Object.entries(st.cap.effects)) total[k] = (total[k] || 0) + v;
  }
  return total;
}
export function hullStrength(book, world, hull) {
  const stats = world.shipStats(hull.shipId) || {};
  const price = Math.max(1000, Number(stats.price) || 0);
  const condition = hull.maxHull > 0 ? bounded(hull.hull / hull.maxHull, 0, 1) : 1;
  return price * book.config.strengthPerPrice * condition * bounded(hull.crew ?? 1, 0.2, 1);
}
export function polityReadiness(book, world, id) {
  const p = polity(book, id);
  const ready = p.hulls.filter((h) => h.status === 'ready' || h.status === 'assigned');
  const supply = bounded(p.supply, book.config.supplyFloor, 1);
  const strength = ready.reduce((n, h) => n + hullStrength(book, world, h), 0) * supply;
  return { hulls: p.hulls.filter((h) => h.status !== 'lost').length, ready: ready.length, repairing: p.hulls.filter((h) => h.status === 'repairing').length,
    strength: Math.round(strength * 10) / 10, supply, baseline: p.readinessBaseline };
}
export function polityProduction(book, world, id) {
  let berths = 0, heavyBerths = 0, workforce = 0, energy = 0, repair = 0, yards = 0;
  for (const sys of controlled(world, id)) {
    const fx = stationEffects(world, sys.index, null);
    const occupation = book.occupations[sys.index];
    const factor = occupation ? occupationFactor(book, occupation) : 1;
    berths += (fx.berths || 0) * factor; heavyBerths += (fx.heavyBerths || 0) * factor;
    workforce += (fx.workforce || 0) * factor; energy += (fx.energy || 0); repair += (fx.repairCapacity || 0) * factor;
    yards += systemStations(world, sys.index).filter((s) => isOperationalStation(s) && s.cap.services.construction !== 'none').length;
  }
  const p = polity(book, id);
  const busy = p.queue.filter((q) => q.status === 'building').length;
  return { berths: Math.round(berths), heavyBerths: Math.round(heavyBerths), workforce: Math.round(workforce), energy: Math.round(energy), repairCapacity: Math.round(repair), yards, queued: p.queue.length, building: busy };
}
export function polityEconomy(book, world, id) {
  const p = polity(book, id);
  return { treasury: Math.round(p.treasury), materials: Math.round(p.materials), revenue: Math.round(p.revenueLastDay), expense: Math.round(p.expenseLastDay), worlds: controlled(world, id).length, supply: p.supply };
}
function occupationFactor(book, occupation) {
  const days = Math.max(0, book.day - occupation.capturedDay);
  const c = book.config;
  return bounded(c.occupationOutputFactor + (1 - c.occupationOutputFactor) * days / c.occupationIntegrationDays, c.occupationOutputFactor, 1);
}

// ---------- initialisation ----------
export function initializeCampaign(book, world) {
  if (book.initialized) return book;
  const c = book.config;
  const factions = new Set(world.systems.map((s) => s.controller).filter((id) => id && id !== 'player' && world.isFaction(id)));
  for (const id of factions) {
    const p = polity(book, id);
    const worlds = controlled(world, id);
    p.treasury = Math.max(c.openingTreasuryFloor || 0, worlds.length * c.openingTreasuryPerWorld);
    p.materials = Math.max(c.openingMaterialsFloor || 0, worlds.length * c.openingMaterialsPerWorld);
    const mult = c.openingStrengthMultiplier[id] || 1;
    for (const sys of worlds) {
      const budget = c.openingStrengthPerWorld * mult;
      let strength = 0;
      for (let i = 0; i < c.openingMaxHullsPerWorld && strength < budget; i++) {
        // Three seeded draws from the legal pool; the one that best fits the remaining budget is raised.
        // Every world keeps at least one hull; a hull that would overshoot the budget by more than a
        // quarter is not raised, so expensive pools do not inflate the opening force.
        const remaining = budget - strength;
        const candidates = [0, 0.37, 0.71].map((k) => world.pickHull(id, (seededUnit(book.seed, `opening:${id}:${sys.index}:${i}`) + k) % 1)).filter((x) => x != null);
        if (!candidates.length) break;
        const strengthOf = (shipId) => Math.max(1000, Number((world.shipStats(shipId) || {}).price) || 0) * c.strengthPerPrice;
        const fits = candidates.filter((shipId) => strengthOf(shipId) <= remaining * 1.25 || i === 0);
        const pick = (fits.length ? fits : candidates).sort((a, b) => Math.abs(strengthOf(a) - remaining) - Math.abs(strengthOf(b) - remaining))[0];
        if (i > 0 && strengthOf(pick) > remaining * 1.25) break;
        const h = addHull(book, world, id, sys.index, `opening:${id}:${sys.index}:${i}`, pick);
        if (!h) break;
        strength += hullStrength(book, world, h);
      }
    }
    const reserve = c.openingReserveHulls[id] || 0;
    const home = worlds[0];
    if (home) for (let i = 0; i < reserve; i++) addHull(book, world, id, home.index, `reserve:${id}:${i}`);
    p.readinessBaseline = polityReadiness(book, world, id).strength;
    addHistory(book, book.day, 'opening', `${world.factionName(id)} opens with ${p.hulls.length} hulls across ${worlds.length} worlds.`);
  }
  const player = polity(book, 'player');
  player.readinessBaseline = 0;
  // Designs: record every authored vendor per hull so a sole-source loss is detectable.
  for (const sys of world.systems) for (const st of world.stationsBySystem(sys.index)) for (const h of st.offers?.shipIds || []) {
    const d = (book.designs[h] ||= { sources: [], lost: [], relocatedTo: null });
    if (!d.sources.includes(st.id)) d.sources.push(st.id);
  }
  book.initialized = true;
  return book;
}
function addHull(book, world, polityId, systemIndex, seedKey, shipId = null) {
  const p = polity(book, polityId);
  if (p.hulls.length >= book.config.maxHullsPerPolity) return null;
  const id = shipId ?? world.pickHull(polityId, seededUnit(book.seed, seedKey));
  if (id == null) return null;
  const stats = world.shipStats(id) || {};
  const maxHull = Math.max(1, Number(stats.combatHull) || 100);
  const hull = { id: nextCampaignId(book, 'hull'), shipId: Number(id), hull: maxHull, maxHull, crew: 1, systemIndex: Number(systemIndex), status: 'ready', opId: null };
  p.hulls.push(hull);
  return hull;
}

// ---------- daily advancement ----------
// Advances exactly one day. Returns effects for the engine to apply. Idempotent per day: calling with
// a day <= book.settled is a no-op, so replays cannot double-settle.
export function advanceCampaignDay(book, world, day) {
  const effects = [];
  if (!book.initialized) initializeCampaign(book, world);
  if (day <= book.settled) return effects;
  book.day = day;
  settleEconomy(book, world, day, effects);
  advanceProduction(book, world, day, effects);
  advanceRepairs(book, world, day);
  advanceIntegrations(book, world, day, effects);
  planOperations(book, world, day, effects);
  advanceOperations(book, world, day, effects);
  advanceDominion(book, world, day, effects);
  resolveCentralWar(book, world, day, effects);
  advanceRecoveries(book, world, day, effects);
  expireMissions(book, day, effects);
  book.settled = day;
  return effects;
}

function settleEconomy(book, world, day, effects) {
  const c = book.config;
  for (const id of Object.keys(book.polities)) {
    const p = polity(book, id);
    const worlds = controlled(world, id);
    let revenue = 0, materials = 0, food = 0, housing = 0;
    for (const sys of worlds) {
      const fx = stationEffects(world, sys.index, null);
      const factor = book.occupations[sys.index] ? occupationFactor(book, book.occupations[sys.index]) : 1;
      revenue += (c.worldRevenueBase + c.worldRevenuePerPopulation * (sys.population || 0) + (fx.revenue || 0)) * factor * (1 + (fx.customs || 0) / 100);
      materials += (c.materialsPerWorld + (fx.mining || 0)) * factor;
      food += fx.food || 0; housing += fx.housing || 0;
    }
    // Supply: a polity with no controlled world has none; blockaded worlds (an enemy op holding) reduce it.
    const blockaded = worlds.filter((s) => book.operations.some((o) => o.targetSystem === s.index && o.status === 'engaged' && o.faction !== id)).length;
    p.supply = worlds.length ? bounded(1 - blockaded / worlds.length * 0.6, c.supplyFloor, 1) : c.supplyFloor;
    const upkeep = p.hulls.filter((h) => h.status !== 'lost').reduce((n, h) => n + Math.max(0, Number((world.shipStats(h.shipId) || {}).mass) || 1) * c.hullUpkeepPerMass, 0);
    p.revenueLastDay = revenue; p.expenseLastDay = upkeep;
    if (id === 'player') {
      // The player's treasury is the captain's own latinum: credit once per day through an effect.
      if (!book.incomeLedger[day] && revenue > 0) { book.incomeLedger[day] = true; effects.push({ type: 'playerIncome', day, latinum: Math.round(revenue), materials: Math.round(materials) }); }
      const keys = Object.keys(book.incomeLedger); if (keys.length > 400) for (const k of keys.slice(0, keys.length - 400)) delete book.incomeLedger[k];
    } else {
      p.treasury = bounded(p.treasury + revenue - upkeep, -c.treasuryCap, c.treasuryCap);
      p.materials = bounded(p.materials + materials, 0, c.materialsCap);
    }
    // crew recovery at worlds with morale
    for (const h of p.hulls) if (h.status === 'ready' && (stationEffects(world, h.systemIndex, null).morale || 0) > 0) h.crew = bounded((h.crew ?? 1) + c.crewRecoveryPerDay, 0, 1);
  }
}

// Production: AI polities queue replacements when treasury and materials allow; every polity's
// queue advances by berth capacity. A hull is created exactly once per queue item.
export function queueBuild(book, world, polityId, shipId, systemIndex, day) {
  const p = polity(book, polityId), c = book.config;
  if (p.queue.filter((q) => q.status !== 'delivered' && q.status !== 'lost').length >= c.maxQueuePerPolity) return { ok: false, reason: 'Queue full' };
  const stats = world.shipStats(shipId);
  if (!stats) return { ok: false, reason: 'Unknown design' };
  const yards = systemStations(world, systemIndex).filter((s) => isOperationalStation(s) && s.owner === polityId && s.cap.services.construction !== 'none');
  if (!yards.length) return { ok: false, reason: 'No owned operational yard in that system' };
  const heavy = (Number(stats.mass) || 1) >= c.heavyMass;
  if (heavy && !yards.some((s) => s.cap.services.construction === 'heavy')) return { ok: false, reason: 'Heavy design needs a heavy berth' };
  if (!polityCanBuildDesign(book, world, polityId, shipId)) return { ok: false, reason: 'No licence for that design' };
  const recipe = buildRecipe(c, stats);
  if (polityId !== 'player') { if (p.treasury < recipe.latinum) return { ok: false, reason: 'Insufficient treasury' }; if (p.materials < recipe.materials) return { ok: false, reason: 'Insufficient materials' }; p.treasury -= recipe.latinum; p.materials -= recipe.materials; }
  const item = { id: nextCampaignId(book, 'build'), polityId, shipId: Number(shipId), systemIndex: Number(systemIndex), stationId: yards[0].id, heavy, remainingDays: recipe.days, reserved: recipe, status: 'queued', queuedDay: day, deliveredHullId: null };
  p.queue.push(item);
  return { ok: true, item, recipe };
}
export function buildRecipe(c, stats) {
  const mass = Math.max(1, Number(stats.mass) || 1), price = Math.max(0, Number(stats.price) || 0);
  return { latinum: Math.round(price * c.buildLatinumFactor), materials: Math.max(1, Math.ceil(mass * c.buildMaterialsPerMass)), days: Math.max(2, Math.ceil(Math.sqrt(mass) * c.buildDaysPerSqrtMass)) };
}
function polityCanBuildDesign(book, world, polityId, shipId) {
  const p = polity(book, polityId);
  const stats = world.shipStats(shipId) || {};
  const native = !stats.faction || stats.faction === 'neutral' || stats.faction === polityId;
  return native || Boolean(p.licenses[shipId]);
}
function advanceProduction(book, world, day, effects) {
  const c = book.config;
  for (const id of Object.keys(book.polities)) {
    const p = polity(book, id);
    // AI replacement policy: keep at least the opening hull count, one order per planning interval.
    if (id !== 'player' && day % c.planningIntervalDays === 0) {
      const alive = p.hulls.filter((h) => h.status !== 'lost').length;
      const active = p.queue.filter((q) => q.status !== 'delivered' && q.status !== 'lost').length;
      const target = Math.max(4, Math.round((p.readinessBaselineHulls ||= alive)));
      // Replace losses toward the opening count; with a full war chest, grow beyond it (one order per interval).
      if (alive + active < target || (p.treasury > c.aiWarChest && active < 2 && alive < c.maxHullsPerPolity)) {
        const yardSystems = controlled(world, id).filter((s) => systemStations(world, s.index).some((st) => isOperationalStation(st) && st.owner === id && st.cap.services.construction !== 'none'));
        if (yardSystems.length) {
          const sys = yardSystems[Math.floor(seededUnit(book.seed, 'build-site', id, day) * yardSystems.length)];
          const shipId = world.pickHull(id, seededUnit(book.seed, 'build-hull', id, day));
          if (shipId != null) queueBuild(book, world, id, shipId, sys.index, day);
        }
      }
    }
    // Capacity: per system, berths minus those consumed by repairs.
    const capacity = {};
    for (const sys of controlled(world, id)) {
      const fx = stationEffects(world, sys.index, null);
      const factor = book.occupations[sys.index] ? occupationFactor(book, book.occupations[sys.index]) : 1;
      const supply = bounded(p.supply, c.supplyFloor, 1);
      const repairBerths = Math.floor((p.repairedToday?.[sys.index] || 0) / c.repairPointsPerBerthDay);
      capacity[sys.index] = {
        standard: Math.max(0, Math.floor((fx.berths || 0) * factor) - repairBerths),
        heavy: Math.max(0, Math.floor((fx.heavyBerths || 0) * factor)),
        workforce: Math.floor((fx.workforce || 0) * factor),
        energy: fx.energy || 0,
        supply,
      };
    }
    for (const item of p.queue) {
      if (item.status === 'delivered' || item.status === 'lost') continue;
      const cap = capacity[item.systemIndex];
      const yardAlive = systemStations(world, item.systemIndex).some((s) => s.id === item.stationId && isOperationalStation(s));
      if (!cap || !yardAlive || !controlled(world, id).some((s) => s.index === item.systemIndex)) { item.status = 'lost'; addHistory(book, day, 'production', `${world.factionName(id)} lost a build order: yard gone or world lost.`); continue; }
      const slotKey = item.heavy ? 'heavy' : 'standard';
      if (cap[slotKey] <= 0 || cap.workforce < c.workforcePerBerth || (item.heavy && cap.energy < 0 && cap.energy < -c.energyPerHeavyBerth * 3)) { item.status = 'queued'; continue; }
      cap[slotKey]--; cap.workforce -= c.workforcePerBerth;
      item.status = 'building';
      item.remainingDays -= cap.supply;
      if (item.remainingDays <= 0 && !item.deliveredHullId) {
        const hull = addHull(book, world, id, item.systemIndex, `build:${item.id}`, item.shipId);
        item.status = 'delivered'; item.deliveredDay = day; item.deliveredHullId = hull?.id || null;
        p.builtHulls++; book.stats.hullsBuilt++;
        effects.push({ type: 'hullBuilt', polityId: id, systemIndex: item.systemIndex, shipId: item.shipId, hullId: hull?.id || null, day });
        if (id === 'player') effects.push({ type: 'playerHullDelivered', item: copy(item) });
      }
    }
    p.queue = p.queue.filter((q) => q.status !== 'delivered' && q.status !== 'lost').concat(p.queue.filter((q) => q.status === 'delivered' || q.status === 'lost').slice(-10));
    p.repairedToday = {};
  }
}
function advanceRepairs(book, world, day) {
  const c = book.config;
  for (const id of Object.keys(book.polities)) {
    const p = polity(book, id);
    const budget = {};
    for (const sys of controlled(world, id)) budget[sys.index] = stationEffects(world, sys.index, null).repairCapacity || 0;
    const yards = Object.keys(budget).map(Number).filter((i) => budget[i] > 0);
    p.repairedToday = {};
    for (const h of p.hulls) {
      if (h.status === 'lost' || h.hull >= h.maxHull) { if (h.status === 'repairing') h.status = 'ready'; continue; }
      // A damaged, uncommitted hull with no repair facility here sails to the nearest owned yard.
      if (h.status === 'ready' && !(budget[h.systemIndex] > 0) && h.hull < h.maxHull * 0.6 && yards.length) {
        const target = yards.map((i) => ({ i, hops: world.routeHops([h.systemIndex], i, id) })).filter((x) => x.hops != null).sort((a, b) => a.hops - b.hops)[0];
        if (target) { h.status = 'repairing'; h.arriveDay = day + Math.max(1, target.hops); h.systemIndex = target.i; }
        continue;
      }
      if (h.status === 'repairing' && h.arriveDay != null && day < h.arriveDay) continue;
      if (!(budget[h.systemIndex] > 0)) continue;
      const need = h.maxHull - h.hull, done = Math.min(need, budget[h.systemIndex]);
      h.hull += done; budget[h.systemIndex] -= done; p.repairedToday[h.systemIndex] = (p.repairedToday[h.systemIndex] || 0) + done;
      h.status = h.hull >= h.maxHull ? 'ready' : 'repairing';
    }
  }
}

// ---------- captured-world qualification and integration ----------
export function majorWorldQualification(book, world, systemIndex) {
  const c = book.config, sys = world.systems[systemIndex];
  if (!sys) return { qualifies: false, reason: 'Unknown world' };
  const operational = systemStations(world, systemIndex).filter((s) => isOperationalStation(s) && ![86, 87].includes(Number(s.typeId)) && !/\(abandoned\)/i.test(s.name || '')).length;
  const pop = Number(sys.population) || 0;
  if (pop >= c.majorWorldPopulation) return { qualifies: true, reason: `population ${pop} ≥ ${c.majorWorldPopulation}`, population: pop, stations: operational };
  if (operational >= c.majorWorldStations) return { qualifies: true, reason: `${operational} operational stations ≥ ${c.majorWorldStations}`, population: pop, stations: operational };
  return { qualifies: false, reason: `population ${pop} < ${c.majorWorldPopulation} and ${operational} operational stations < ${c.majorWorldStations}`, population: pop, stations: operational };
}
// Called by the engine when control changes hands (effect-driven, so local and offscreen captures agree).
export function recordCapture(book, world, systemIndex, byPolity, fromPolity, day) {
  book.occupations[systemIndex] = { capturedDay: day, by: byPolity, from: fromPolity };
  book.stats.captures++;
  const sys = world.systems[systemIndex];
  const origin = sys?.origin;
  const p = polity(book, byPolity);
  if (origin && world.isFaction(origin) && origin !== byPolity) {
    const q = majorWorldQualification(book, world, systemIndex);
    p.integrations[systemIndex] = { sourceFaction: origin, startedDay: day, progress: 0, completedDay: null, qualification: q, designs: [] };
  }
  addHistory(book, day, 'capture', `${world.factionName(byPolity)} took ${sys?.name || `system ${systemIndex}`}${fromPolity ? ` from ${world.factionName(fromPolity)}` : ''}.`, { systemIndex, by: byPolity, from: fromPolity });
}
function advanceIntegrations(book, world, day, effects) {
  const c = book.config;
  for (const id of Object.keys(book.polities)) {
    const p = polity(book, id);
    for (const [sysKey, integ] of Object.entries(p.integrations)) {
      const sysIndex = Number(sysKey);
      if (integ.completedDay) continue;
      const stillHeld = world.systems[sysIndex]?.controller === id;
      if (!stillHeld) { integ.progress = 0; integ.qualification = { ...integ.qualification, qualifies: false, reason: 'control lost before integration completed' }; continue; }
      integ.qualification = majorWorldQualification(book, world, sysIndex);
      if (!integ.qualification.qualifies) continue;
      const yard = systemStations(world, sysIndex).some((s) => isOperationalStation(s) && s.cap.services.construction !== 'none');
      integ.progress += yard ? 1 : 0.5; // retooling needs a working yard; population alone integrates at half speed
      if (integ.progress >= c.integrationDays) {
        integ.completedDay = day;
        integ.designs = world.nativeDesigns(integ.sourceFaction, sysIndex);
        for (const shipId of integ.designs) if (!p.licenses[shipId]) p.licenses[shipId] = { source: 'integration', from: integ.sourceFaction, systemIndex: sysIndex, acquiredDay: day };
        addHistory(book, day, 'integration', `${world.factionName(id)} integrated ${world.factionName(integ.sourceFaction)} industry at ${world.systems[sysIndex]?.name}: ${integ.designs.length} designs.`, { systemIndex: sysIndex, polityId: id });
        effects.push({ type: 'integrationComplete', polityId: id, systemIndex: sysIndex, designs: integ.designs.slice(), day });
      }
    }
  }
}

// ---------- operations ----------
function reachableEnemyTargets(book, world, id) {
  const mine = controlled(world, id).map((s) => s.index);
  const out = [];
  for (const sys of world.systems) {
    if (sys.controller === id || !sys.controller) continue;
    if (sys.controller !== 'player' && !book.polities[sys.controller]) continue; // only strategic actors are objectives; pirate havens and independents are not
    const enemy = sys.controller === 'player' ? world.relation(id, world.playerFaction) === 'war' : world.relation(id, sys.controller) === 'war';
    if (!enemy) continue;
    const hops = world.routeHops(mine, sys.index, id);
    if (hops == null) continue;
    out.push({ index: sys.index, hops, controller: sys.controller });
  }
  return out.sort((a, b) => a.hops - b.hops);
}
export function localDefenseStrength(book, world, systemIndex) {
  const sys = world.systems[systemIndex];
  // Only installations owned by the controller (or a side not at war with it) defend the world.
  let defense = 0;
  for (const st of systemStations(world, systemIndex)) {
    if (!isOperationalStation(st)) continue;
    const owner = st.owner;
    const hostileToController = sys?.controller && owner && owner !== sys.controller && world.relation(owner === 'player' ? world.playerFaction : owner, sys.controller === 'player' ? world.playerFaction : sys.controller) === 'war';
    if (hostileToController) continue;
    defense += st.cap.effects.defense || 0;
  }
  let strength = defense * book.config.garrisonStrengthPerDefense;
  for (const id of Object.keys(book.polities)) {
    if (!sys?.controller) continue;
    const allied = id === sys.controller || (world.relation(id, sys.controller === 'player' ? world.playerFaction : sys.controller) === 'allied');
    if (!allied) continue;
    for (const h of polity(book, id).hulls) if (h.status === 'ready' && h.systemIndex === systemIndex) strength += hullStrength(book, world, h);
  }
  strength += world.extraDefense?.(systemIndex) || 0; // player fleet ships stationed here, live defences
  return strength;
}
function planOperations(book, world, day, effects) {
  const c = book.config;
  for (const id of Object.keys(book.polities)) {
    if (id === 'player') continue;
    const p = polity(book, id);
    if (day - p.lastPlanDay < c.planningIntervalDays) continue;
    p.lastPlanDay = day;
    if (book.operations.filter((o) => o.faction === id && o.status !== 'resolved').length >= 2) continue;
    const targets = reachableEnemyTargets(book, world, id);
    if (!targets.length) continue;
    if (id === 'dominion' && book.dominion.phase !== 'invasion') continue; // the expedition opens hostilities, never a routine raid
    const ready = p.hulls.filter((h) => h.status === 'ready');
    // A home garrison stays behind at every held world: an offensive never strips a world of its last defenders.
    const perSystem = {};
    for (const h of ready) perSystem[h.systemIndex] = (perSystem[h.systemIndex] || 0) + 1;
    const held = new Set(controlled(world, id).map((s) => s.index));
    const spare = ready.filter((h) => { if (!held.has(h.systemIndex)) return true; if (perSystem[h.systemIndex] > c.homeGarrisonPerWorld) { perSystem[h.systemIndex]--; return true; } return false; });
    if (spare.length < 3) continue;
    const doctrine = world.doctrine?.(id) || { aggression: 1 };
    const commit = bounded(Math.round(spare.length * c.attackCommitFraction * doctrine.aggression), 3, spare.length);
    const chosen = spare.slice(0, commit);
    const strength = chosen.reduce((n, h) => n + hullStrength(book, world, h), 0) * bounded(p.supply, c.supplyFloor, 1);
    const target = targets.find((t) => strength >= localDefenseStrength(book, world, t.index) * c.minReadinessRatioToAttack) || null;
    if (!target) continue;
    launchOperation(book, world, id, chosen, target.index, day, target.hops, 'assault', effects);
  }
}
export function launchOperation(book, world, factionId, hulls, targetSystem, day, hops, kind = 'assault', effects = []) {
  if (book.operations.length >= book.config.maxOperations) book.operations = book.operations.filter((o) => o.status !== 'resolved').concat(book.operations.filter((o) => o.status === 'resolved').slice(-20));
  const originSystem = hulls[0]?.systemIndex ?? null;
  const op = { id: nextCampaignId(book, 'op'), faction: factionId, kind, targetSystem: Number(targetSystem), originSystem, hullIds: hulls.map((h) => h.id), committed: hulls.length,
    status: 'moving', createdDay: day, arriveDay: day + Math.max(1, hops), engagedDay: null, holdDays: 0, resolvedDay: null, outcome: null, resolvedBy: null, losses: 0, defenderLosses: 0 };
  for (const h of hulls) { h.status = 'assigned'; h.opId = op.id; }
  book.operations.push(op);
  addHistory(book, day, 'operation', `${world.factionName(factionId)} dispatched ${hulls.length} hulls toward ${world.systems[targetSystem]?.name} (${kind}).`, { opId: op.id, faction: factionId, systemIndex: targetSystem });
  effects.push({ type: 'operationLaunched', opId: op.id, faction: factionId, targetSystem, hulls: hulls.length, kind, day });
  return op;
}
export function operationHulls(book, op) {
  const p = polity(book, op.faction);
  return op.hullIds.map((id) => p.hulls.find((h) => h.id === id)).filter((h) => h && h.status !== 'lost');
}
function advanceOperations(book, world, day, effects) {
  const c = book.config;
  const capturedToday = new Set();
  for (const op of book.operations) {
    if (op.status === 'resolved') continue;
    // An objective that is already ours (taken by another force meanwhile) absorbs the operation: the
    // hulls become its garrison and no battle is recorded.
    if (world.systems[op.targetSystem]?.controller === op.faction && op.resolvedBy !== 'local') {
      op.status = 'resolved'; op.resolvedDay = day; op.outcome = 'absorbed'; op.resolvedBy = 'offscreen';
      for (const h of operationHulls(book, op)) { h.opId = null; h.status = 'ready'; h.systemIndex = op.targetSystem; }
      addHistory(book, day, 'operation', `${world.factionName(op.faction)} forces bound for ${world.systems[op.targetSystem]?.name} joined its garrison; the world was already held.`, { opId: op.id, systemIndex: op.targetSystem, faction: op.faction });
      continue;
    }
    if (op.status === 'moving') {
      if (day < op.arriveDay) continue;
      op.status = 'engaged'; op.engagedDay = day; op.holdDays = 0;
      for (const h of operationHulls(book, op)) h.systemIndex = op.targetSystem;
      effects.push({ type: 'operationArrived', opId: op.id, faction: op.faction, targetSystem: op.targetSystem, hulls: operationHulls(book, op).length, day });
      addHistory(book, day, 'engagement', `${world.factionName(op.faction)} forces engaged ${world.systems[op.targetSystem]?.name}.`, { opId: op.id, systemIndex: op.targetSystem, faction: op.faction });
      continue;
    }
    if (op.status !== 'engaged') continue;
    if (op.resolvedBy === 'local') continue;                 // the loaded scene owns this battle
    if (world.localSystem === op.targetSystem) continue;    // player is present: never resolve offscreen
    if (capturedToday.has(op.targetSystem)) { op.holdDays = 0; continue; } // another power took it today; contest it tomorrow
    const before = book.stats.captures;
    resolveOffscreenDay(book, world, op, day, effects);
    if (book.stats.captures > before) capturedToday.add(op.targetSystem);
  }
}
function resolveOffscreenDay(book, world, op, day, effects) {
  const c = book.config;
  const hulls = operationHulls(book, op);
  if (!hulls.length) return finishOperation(book, world, op, day, 'destroyed', effects, 'offscreen');
  const attack = hulls.reduce((n, h) => n + hullStrength(book, world, h), 0) * bounded(polity(book, op.faction).supply, c.supplyFloor, 1);
  const defense = localDefenseStrength(book, world, op.targetSystem);
  const roll = seededUnit(book.seed, 'battle', op.id, day);
  if (defense > 0 && attack < defense * c.suppressionRatio) {
    // Proportional attrition with a seeded swing: the stronger side loses less.
    const ratio = attack / (attack + defense);
    const attackerLossFraction = bounded((1 - ratio) * c.attritionPerDay * (0.7 + roll * 0.6), 0, 0.5);
    const defenderLossFraction = bounded(ratio * c.attritionPerDay * (0.7 + (1 - roll) * 0.6), 0, 0.5);
    applyLosses(book, world, hulls, attackerLossFraction, op, day);
    applyDefenderLosses(book, world, op.targetSystem, defenderLossFraction, op, day, effects);
    const remaining = operationHulls(book, op);
    const remainingStrength = remaining.reduce((n, h) => n + hullStrength(book, world, h), 0);
    if (!remaining.length) return finishOperation(book, world, op, day, 'destroyed', effects, 'offscreen');
    if (remainingStrength < attack * c.retreatFraction) return finishOperation(book, world, op, day, 'withdrew', effects, 'offscreen');
    op.holdDays = 0;
    return;
  }
  if (defense > 0) {
    // Overwhelmed defenders still exact a toll and the installations take damage while the world is stormed.
    const ratio = attack / (attack + defense);
    applyLosses(book, world, hulls, bounded((1 - ratio) * 0.2 * (0.7 + roll * 0.6), 0, 0.2), op, day);
    applyDefenderLosses(book, world, op.targetSystem, bounded(ratio * 0.5, 0.13, 0.6), op, day, effects);
    if (!operationHulls(book, op).length) return finishOperation(book, world, op, day, 'destroyed', effects, 'offscreen');
  }
  op.holdDays++;
  if (op.holdDays >= c.captureHoldDays) {
    const sys = world.systems[op.targetSystem];
    const from = sys?.controller || null;
    finishOperation(book, world, op, day, 'captured', effects, 'offscreen');
    effects.push({ type: 'captureSystem', systemIndex: op.targetSystem, by: op.faction, from, opId: op.id, day });
    recordCapture(book, world, op.targetSystem, op.faction, from, day);
    for (const h of operationHulls(book, op)) { h.status = 'ready'; h.opId = null; }
  }
}
function applyLosses(book, world, hulls, fraction, op, day) {
  let budget = hulls.reduce((n, h) => n + h.maxHull, 0) * fraction;
  let i = 0;
  for (const h of hulls) {
    if (budget <= 0) break;
    const dmg = Math.min(h.hull, budget * (0.5 + seededUnit(book.seed, 'dmg', op.id, day, i++)));
    h.hull -= dmg; budget -= dmg;
    if (h.hull <= 0) { h.hull = 0; h.status = 'lost'; op.losses++; polity(book, op.faction).lostHulls++; book.stats.hullsLost++; }
  }
}
function applyDefenderLosses(book, world, systemIndex, fraction, op, day, effects) {
  const sys = world.systems[systemIndex];
  for (const id of Object.keys(book.polities)) {
    if (id === op.faction) continue;
    const allied = id === sys?.controller;
    if (!allied) continue;
    const local = polity(book, id).hulls.filter((h) => h.status === 'ready' && h.systemIndex === systemIndex);
    let budget = local.reduce((n, h) => n + h.maxHull, 0) * fraction, i = 0;
    for (const h of local) { if (budget <= 0) break; const dmg = Math.min(h.hull, budget * (0.5 + seededUnit(book.seed, 'ddmg', op.id, day, i++))); h.hull -= dmg; budget -= dmg; if (h.hull <= 0) { h.hull = 0; h.status = 'lost'; op.defenderLosses++; polity(book, id).lostHulls++; book.stats.hullsLost++; } }
  }
  // Station damage: fraction of the day's attack lands on the strongest defence installation.
  if (fraction > 0.12) {
    const stations = systemStations(world, systemIndex).filter((s) => isOperationalStation(s) && (s.cap.effects.defense || 0) > 0);
    if (stations.length) { const target = stations[Math.floor(seededUnit(book.seed, 'station', op.id, day) * stations.length)]; effects.push({ type: 'stationDamaged', stationId: target.id, systemIndex, fraction: Math.min(0.5, fraction), opId: op.id, day }); }
  }
}
function finishOperation(book, world, op, day, outcome, effects, resolvedBy) {
  op.status = 'resolved'; op.resolvedDay = day; op.outcome = outcome; op.resolvedBy = op.resolvedBy || resolvedBy;
  book.stats.battlesResolved++;
  const survivors = operationHulls(book, op);
  for (const h of survivors) { h.opId = null; h.status = 'ready'; if (outcome !== 'captured') h.systemIndex = op.originSystem ?? h.systemIndex; }
  addHistory(book, day, 'battle', `${world.factionName(op.faction)} operation at ${world.systems[op.targetSystem]?.name}: ${outcome} (${op.losses} lost, ${op.defenderLosses} defenders lost).`, { opId: op.id, systemIndex: op.targetSystem, outcome, faction: op.faction });
  effects.push({ type: 'operationResolved', opId: op.id, faction: op.faction, targetSystem: op.targetSystem, outcome, losses: op.losses, defenderLosses: op.defenderLosses, day, resolvedBy: op.resolvedBy });
}
// Local scene reconciliation: the engine takes ownership of an engaged operation while the player is
// present, materialises exactly these hulls, and hands back survivors and an outcome once.
export function claimOperationForScene(book, opId) {
  const op = book.operations.find((o) => o.id === opId);
  if (!op || op.status !== 'engaged' || op.resolvedBy) return null;
  op.resolvedBy = 'local';
  return { op, hulls: operationHulls(book, op).map((h) => ({ ...h })) };
}
export function reconcileLocalOutcome(book, world, opId, survivorReport, outcome, day, effects = []) {
  const op = book.operations.find((o) => o.id === opId);
  if (!op || op.status === 'resolved') return false;
  const p = polity(book, op.faction);
  for (const h of operationHulls(book, op)) {
    const s = survivorReport.find((r) => r.hullId === h.id);
    if (!s || s.destroyed) { h.hull = 0; h.status = 'lost'; op.losses++; p.lostHulls++; book.stats.hullsLost++; }
    else h.hull = bounded(Number(s.hull) || h.hull, 0, h.maxHull);
  }
  finishOperation(book, world, op, day, outcome, effects, 'local');
  if (outcome === 'captured') { const from = world.systems[op.targetSystem]?.controller || null; recordCapture(book, world, op.targetSystem, op.faction, from, day); for (const h of operationHulls(book, op)) { h.status = 'ready'; h.opId = null; h.systemIndex = op.targetSystem; } }
  return true;
}
// The engine reports what it saw for operations that were mid-battle when the scene unloaded.
export function releaseOperationFromScene(book, opId, survivorReport) {
  const op = book.operations.find((o) => o.id === opId);
  if (!op || op.status !== 'engaged' || op.resolvedBy !== 'local') return false;
  const p = polity(book, op.faction);
  for (const h of operationHulls(book, op)) { const s = survivorReport.find((r) => r.hullId === h.id); if (!s || s.destroyed) { h.hull = 0; h.status = 'lost'; op.losses++; p.lostHulls++; book.stats.hullsLost++; } else h.hull = bounded(Number(s.hull) || h.hull, 0, h.maxHull); }
  op.resolvedBy = null; // offscreen resolution may continue from the persisted state
  return true;
}

// ---------- Dominion ----------
function advanceDominion(book, world, day, effects) {
  const c = book.config, d = book.dominion;
  const entry = world.wormholes.find((w) => w.id === 'bajora-dominica-wormhole');
  if (!entry) return;
  d.entrySystem ??= entry.from; d.stagingSystem ??= entry.to;
  const dominion = polity(book, 'dominion');
  const warn = (id, text, systemIndex) => { if (d.warnings.some((w) => w.id === id)) return; d.warnings.push({ id, day, text, systemIndex }); effects.push({ type: 'dominionWarning', id, text, systemIndex, day }); };
  if (d.phase === 'dormant' && day >= c.dominionReconDay) {
    d.phase = 'reconnaissance'; d.phaseDay = day;
    warn('missing-patrols', `Patrols near ${world.systems[d.entrySystem]?.name} have stopped reporting on schedule.`, d.entrySystem);
    // real reconnaissance: two hulls staged at the far terminus
    for (let i = 0; i < 2; i++) addHull(book, world, 'dominion', d.stagingSystem, `recon:${i}`);
    addHistory(book, day, 'dominion', 'Dominion reconnaissance phase began.');
  }
  if (d.phase === 'reconnaissance' && day >= c.dominionStagingDay) {
    d.phase = 'staging'; d.phaseDay = day;
    // The expedition is sized against the galaxy as it stands when staging begins; powers that keep
    // building afterwards can outmatch it, and nothing later rescales it.
    const strongest = Math.max(...Object.keys(book.polities).filter((id) => id !== 'dominion').map((id) => polityReadiness(book, world, id).strength), 1);
    const target = Math.max(c.dominionExpeditionMinStrength, strongest * c.dominionExpeditionStrengthRatio);
    for (let i = 0; i < c.dominionExpeditionMaxHulls; i++) {
      const staged = dominion.hulls.filter((h) => h.status === 'ready' && h.systemIndex === d.stagingSystem).reduce((n, h) => n + hullStrength(book, world, h), 0);
      if (staged >= target) break;
      if (!addHull(book, world, 'dominion', d.stagingSystem, `expedition:${i}`)) break;
    }
    dominion.readinessBaseline = polityReadiness(book, world, 'dominion').strength;
    warn('unfamiliar-signatures', `Unfamiliar warship signatures and unexplained supply purchases reported beyond the ${world.systems[d.entrySystem]?.name} wormhole.`, d.entrySystem);
    addHistory(book, day, 'dominion', `Dominion expedition staged at ${world.systems[d.stagingSystem]?.name}: ${dominion.hulls.length} hulls.`);
  }
  if (d.phase === 'staging' && day >= c.dominionInvasionDay) {
    // Opportunity uses everyone's strength, including the player empire; a strong player delays, never prevents.
    const strongest = Math.max(...Object.keys(book.polities).filter((id) => id !== 'dominion').map((id) => polityReadiness(book, world, id).strength), 1);
    const own = polityReadiness(book, world, 'dominion').strength;
    if (own >= strongest * c.dominionOpportunityRatio || day >= c.dominionInvasionDay + 30) {
      d.phase = 'invasion'; d.phaseDay = day;
      const hulls = dominion.hulls.filter((h) => h.status === 'ready' && h.systemIndex === d.stagingSystem);
      const op = launchOperation(book, world, 'dominion', hulls, d.entrySystem, day, 1, 'invasion', effects);
      d.expeditionOpId = op.id;
      warn('invasion', `A Dominion expedition is transiting the ${entry.name || 'Bajoran Wormhole'} toward ${world.systems[d.entrySystem]?.name}.`, d.entrySystem);
      addHistory(book, day, 'dominion', 'Dominion invasion launched through the Bajoran wormhole.');
    }
  }
  if (d.phase === 'invasion') {
    // Reinforcement convoys through the wormhole unless the entry is interdicted by real defences.
    const blockaded = localDefenseStrength(book, world, d.entrySystem) >= c.dominionBlockadeStrength && world.systems[d.entrySystem]?.controller !== 'dominion';
    d.reinforcementCut = blockaded;
    if (!blockaded && d.convoys < c.dominionMaxConvoys && (d.lastConvoyDay == null || day - d.lastConvoyDay >= c.dominionReinforcementEveryDays)) {
      d.lastConvoyDay = day; d.convoys++;
      const bridgehead = world.systems[d.entrySystem]?.controller === 'dominion' ? d.entrySystem : d.stagingSystem;
      for (let i = 0; i < c.dominionReinforcementHulls; i++) addHull(book, world, 'dominion', bridgehead, `convoy:${d.convoys}:${i}`);
      effects.push({ type: 'dominionConvoy', day, systemIndex: bridgehead, hulls: c.dominionReinforcementHulls });
    }
    // After the bridgehead, ordinary planning takes over: the Dominion plans like any other belligerent.
  }
}

// ---------- design licences and recovery ----------
export function recordStationLoss(book, world, stationId, systemIndex, day, effects = []) {
  for (const [shipId, d] of Object.entries(book.designs)) {
    if (!d.sources.includes(stationId) || d.lost.includes(stationId)) continue;
    d.lost.push(stationId);
    const survivingSources = d.sources.filter((s) => !d.lost.includes(s));
    if (survivingSources.length || d.relocatedTo) continue;
    if (book.recoveries.some((r) => r.shipId === Number(shipId) && r.status !== 'failed')) continue;
    const kinds = ['engineers', 'archive', 'broker'];
    const kind = kinds[Math.floor(seededUnit(book.seed, 'recovery', shipId, stationId) * 2)]; // engineers or archive first; broker is the last resort
    const r = { id: nextCampaignId(book, 'recovery'), shipId: Number(shipId), lostStationId: stationId, systemIndex, kind, status: 'available', createdDay: day, completedDay: null, relocatedTo: null, attempts: 0 };
    book.recoveries.push(r);
    if (book.recoveries.length > 40) book.recoveries = book.recoveries.filter((x) => x.status !== 'completed').concat(book.recoveries.filter((x) => x.status === 'completed').slice(-10));
    effects.push({ type: 'recoveryOffered', recoveryId: r.id, shipId: r.shipId, kind, systemIndex, day });
    addHistory(book, day, 'recovery', `Sole vendor for design ${shipId} lost at ${stationId}; ${kind} recovery contract available.`, { shipId: Number(shipId), systemIndex });
  }
}
export function designStatus(book, shipId) {
  const d = book.designs[shipId];
  if (!d) return { state: 'unknown', text: '' };
  const surviving = d.sources.filter((s) => !d.lost.includes(s));
  if (surviving.length || d.relocatedTo) return { state: 'available', text: '' };
  const r = book.recoveries.find((x) => x.shipId === Number(shipId) && x.status !== 'failed');
  return { state: 'lost', text: 'Original yard lost — locate engineering archive.', recovery: r || null };
}
export function completeRecovery(book, world, recoveryId, destinationStationId, day, effects = []) {
  const r = book.recoveries.find((x) => x.id === recoveryId);
  if (!r || r.status === 'completed') return { ok: false, reason: 'No such open recovery' };
  const d = book.designs[r.shipId];
  if (!d) return { ok: false, reason: 'Unknown design' };
  if (d.relocatedTo) return { ok: false, reason: 'Already relocated' };
  d.relocatedTo = destinationStationId; r.status = 'completed'; r.completedDay = day; r.relocatedTo = destinationStationId;
  effects.push({ type: 'designRelocated', shipId: r.shipId, to: destinationStationId, day });
  addHistory(book, day, 'recovery', `Design ${r.shipId} access restored at ${destinationStationId}.`, { shipId: r.shipId });
  return { ok: true };
}
// An engineers/archive contract left unpursued for 400 days lapses; a neutral broker then offers one
// last lead (once per design). After that there is no further respawn.
function advanceRecoveries(book, world, day, effects) {
  for (const r of book.recoveries.slice()) {
    if (r.status !== 'available' || day - r.createdDay <= book.config.recoveryOfferDays) continue;
    r.status = 'failed';
    if (r.kind === 'broker' || book.recoveries.some((x) => x.shipId === r.shipId && x.kind === 'broker')) continue;
    const b = { id: nextCampaignId(book, 'recovery'), shipId: r.shipId, lostStationId: r.lostStationId, systemIndex: r.systemIndex, kind: 'broker', status: 'available', createdDay: day, completedDay: null, relocatedTo: null, attempts: (r.attempts || 0) + 1 };
    book.recoveries.push(b);
    effects.push({ type: 'recoveryOffered', recoveryId: b.id, shipId: b.shipId, kind: 'broker', systemIndex: b.systemIndex, day });
    addHistory(book, day, 'recovery', `The ${r.kind} contract for design ${r.shipId} lapsed; a broker offers a last lead.`, { shipId: r.shipId, systemIndex: r.systemIndex });
  }
}
// Plan purchase pricing is pinned here so every caller agrees.
export function planQuote(hullPrice, baseStanding, alreadyOwned) {
  return { price: alreadyOwned ? 0 : planPrice(hullPrice), standing: planStandingRequired(baseStanding) };
}

// ---------- missions ----------
export const MISSION_KINDS = Object.freeze(['relief', 'escort', 'evacuation', 'repair', 'archive', 'recon', 'blockade', 'extraction']);
export function offerMission(book, mission, day) {
  if (book.missions.some((m) => m.key === mission.key && ['offered', 'active'].includes(m.status))) return null; // one open contract per key; finished ones may recur
  const m = { id: nextCampaignId(book, 'mission'), status: 'offered', offeredDay: day, acceptedDay: null, completedDay: null, reason: null, ...mission };
  book.missions.push(m);
  if (book.missions.length > 60) book.missions = book.missions.filter((x) => ['offered', 'active'].includes(x.status)).concat(book.missions.filter((x) => !['offered', 'active'].includes(x.status)).slice(-20));
  return m;
}
export function acceptMission(book, id, day) { const m = book.missions.find((x) => x.id === id); if (!m || m.status !== 'offered') return false; m.status = 'active'; m.acceptedDay = day; return true; }
export function completeMission(book, id, day, reason = 'objective met') { const m = book.missions.find((x) => x.id === id); if (!m || m.status !== 'active') return null; m.status = 'completed'; m.completedDay = day; m.reason = reason; return m; }
export function failMission(book, id, day, reason) { const m = book.missions.find((x) => x.id === id); if (!m || !['offered', 'active'].includes(m.status)) return null; m.status = 'failed'; m.completedDay = day; m.reason = reason; return m; }
// The Earth–Klingon war is never ended by a random roll. It resolves once, strategically: a
// belligerent that has lost its home world and cannot contest it (or holds no world at all) sues for
// peace. The engine applies the settlement through the ordinary diplomacy record.
function resolveCentralWar(book, world, day, effects) {
  const c = book.config;
  const [a, b] = c.centralWar || [];
  if (!a || !b || !book.polities[a] || !book.polities[b]) return;
  book.resolutions ||= {};
  const key = `${a}:${b}`;
  if (book.resolutions[key] || world.relation(a, b) !== 'war') return;
  const worldsOf = (id) => controlled(world, id);
  const homeOf = (id) => world.systems.find((s) => s.name === c.homeWorlds?.[id]);
  const strengthOf = (id) => polityReadiness(book, world, id).strength;
  const beaten = (id, other) => {
    if (!worldsOf(id).length) return `${world.factionName(id)} holds no world`;
    const home = homeOf(id);
    if (home && home.controller !== id && strengthOf(id) < strengthOf(other) * c.resolutionStrengthRatio) return `${home.name} has fallen and ${world.factionName(id)} cannot contest it`;
    return null;
  };
  const loserReason = beaten(a, b) ? [a, b, beaten(a, b)] : beaten(b, a) ? [b, a, beaten(b, a)] : null;
  if (!loserReason) return;
  const [loser, winner, reason] = loserReason;
  book.resolutions[key] = { day, loser, winner, reason };
  addHistory(book, day, 'resolution', `The ${world.factionName(a)}–${world.factionName(b)} war ends: ${reason}.`, { loser, winner });
  effects.push({ type: 'warResolved', a, b, loser, winner, reason, day });
}
function expireMissions(book, day, effects) {
  for (const m of book.missions) if (['offered', 'active'].includes(m.status) && m.deadlineDay != null && day > m.deadlineDay) { m.status = 'expired'; m.reason = 'deadline passed'; effects.push({ type: 'missionExpired', missionId: m.id, day }); }
}

// ---------- relays and orders ----------
export function relayConnectivity(world, polityId) {
  const connected = new Set();
  const sector = [];
  for (const sys of world.systems) {
    for (const st of world.stationsBySystem(sys.index)) {
      if (!isOperationalStation(st) || !st.cap.services.relay) continue;
      const allied = st.owner === polityId || (world.relation(polityId === 'player' ? world.playerFaction : polityId, st.owner === 'player' ? world.playerFaction : st.owner) !== 'war' && (sys.controller === polityId));
      if (!allied) continue;
      connected.add(sys.index);
      if ((st.cap.effects.relay || 0) >= 2) sector.push(sys.index);
    }
  }
  for (const hub of sector) for (const n of world.neighbours(hub)) connected.add(n);
  return connected;
}
export function queueDistantOrder(book, order, day, connected) {
  const o = { id: nextCampaignId(book, 'order'), ...order, queuedDay: day, acknowledgedDay: null, status: 'queued' };
  if (connected) { o.status = 'acknowledged'; o.acknowledgedDay = day; }
  book.orders.push(o);
  if (book.orders.length > 40) book.orders = book.orders.slice(-40);
  return o;
}
export function acknowledgeQueuedOrders(book, day, connectedSystems) {
  const acked = [];
  for (const o of book.orders) if (o.status === 'queued' && connectedSystems.has(Number(o.systemIndex))) { o.status = 'acknowledged'; o.acknowledgedDay = day; acked.push(o); }
  return acked;
}

// ---------- summaries ----------
export function politySummary(book, world, id) {
  return { id, name: world.factionName(id), economy: polityEconomy(book, world, id), production: polityProduction(book, world, id), readiness: polityReadiness(book, world, id),
    integrations: Object.entries(polity(book, id).integrations).map(([s, i]) => ({ systemIndex: Number(s), ...i })), licenses: Object.keys(polity(book, id).licenses).length,
    operations: book.operations.filter((o) => o.faction === id && o.status !== 'resolved').length };
}
export function checksum(book) {
  // Order-independent structural digest for replay-equivalence tests.
  return stableHash(JSON.stringify({ day: book.day, settled: book.settled, polities: book.polities, operations: book.operations, dominion: book.dominion, occupations: book.occupations, stats: book.stats, counter: book.counter }));
}
