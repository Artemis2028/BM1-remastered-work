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
import * as Identity from './vessel-identity.mjs';
import { evaluateWar, settlementTerms, WAR_RULES } from './war-termination.mjs';

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
  // Dominion expedition: an opportunity, never a date. Campaign days pass only when the captain warps,
  // so a calendar trigger fires on travel rather than on anything that happened — four hundred days of
  // peaceful trading weakened nobody, and the Dominion does not cross a wormhole because a number
  // rolled over. There is no earliest day and no latest day; no threshold below is a campaign day.
  // What opens the door is dominionOpportunity(): a central war that has actually cost its belligerents
  // something, an economy that shows it, a balance the expedition can exploit, a corridor nobody has
  // closed, and a captain who has been offered a game to play first. Every threshold is a share of a
  // polity's own opening or recovered capacity, so it reads the same for a small power as for a large
  // one. [17SEP spec §3.1]
  dominionMinCentralEngagements: 20,     // consequential engagements (losses or a capture) in the central war
  dominionDefenderWeakness: 0.65,        // a near-side power is weakened below this share of its own capacity
  dominionEconomicStrain: 0.75,          // ...and its revenue, yards or treasury are below this share of their own best
  // The opening is judged over a bounded rolling window, not accumulated for ever. A lifetime counter
  // that gains on eligible days and loses less on the others grows whenever the case holds more than a
  // third of the time, so a condition that merely alternates around the line reaches any threshold
  // eventually. A window cannot: alternating gives half the window, and half is not enough.
  dominionOpeningWindowDays: 90,         // days of eligibility history kept
  dominionOpeningSustainDays: 60,        // ...of which this many must be eligible before the arc unlocks
  // What replaces a calendar floor. Campaign day is not an opportunity score, so the thing that has to
  // be true before the galaxy's war can pull the captain into it is that the captain has actually been
  // offered a game: worlds to see, work to take, powers to deal with. These count chances the game put
  // in front of them, never things they achieved, so a captain who stays poor and small is protected
  // exactly as much as one who does not.
  //
  // Categories, not a total. A single additive counter is farmable by whichever of its inputs is
  // cheapest: the first version of this added every press of "request contract" to the systems visited,
  // and fifty-nine presses at one station — no travel, no time, one menu — satisfied the whole gate.
  // Each category below is a set or a capped tally of something that costs a journey, a docking or a
  // destination, and the gate needs several of them, so no single action can carry it. [review]
  dominionPlayerBeats: Object.freeze({
    systemsVisited: 10,                  // distinct worlds seen
    journeys: 25,                        // completed journeys, capped at 400 by the engine
    issuers: 6,                          // distinct stations or worlds that have offered the captain work
    contacts: 3,                         // distinct powers whose service channel the captain has opened
  }),
  dominionMinPlayerCategories: 3,        // of the four above
  dominionPhaseBeatsApart: true,         // at most one phase transition per journey: never a whole arc inside one jump
  dominionStalemateBand: 0.5,            // |a-b| / max(a,b) at or under this is a bounded strength difference
  dominionFrontStallRatio: 2,            // ...and neither side's captures may exceed the other's by more than this
  dominionFrontStallFloor: 2,            // ...below which a lead is noise rather than a front that is moving
  dominionVictorWeakness: 0.6,           // a victor still above this share of its own capacity closes the opening
  dominionPlayerPowerShare: 0.5,         // the player counts as a near-side power at this share of the strongest AI
  dominionContenderHops: 8,              // a polity holding ground this close to the entry can answer the crossing
  dominionCorridorCloseRatio: 1.2,       // entry defence at or above this multiple of the expedition's reach closes the corridor
  dominionChallengeRatio: 1.5,           // the strongest near-side power may be at most this multiple of that reach
  dominionReconDwellDays: 40,            // days in reconnaissance before staging may begin, while the opening holds
  dominionStagingDwellDays: 25,          // days in staging before the crossing, while the corridor holds
  dominionExpeditionStrengthRatio: 0.8, // expedition staged to this share of the strongest power's ready strength at staging time
  dominionExpeditionMinStrength: 3000,
  dominionExpeditionMaxHulls: 40,
  dominionReinforcementEveryDays: 12,
  dominionReinforcementHulls: 2,
  dominionBlockadeStrength: 600,   // defender strength at the entry system that interdicts reinforcement convoys (≈ a starbase plus escorts)
  dominionMaxConvoys: 8,           // reinforcement is finite: the expedition must win with what the wormhole can carry
  dominionOpportunityRatio: 0.9,   // expedition strength vs best local opposition needed to advance past the bridgehead
  // Dominion formal war (DOMINION-FORMAL-WAR-RULES-261233ZSEP26). Static hostility never declares a war;
  // these authored lists say who the storyline may deliberately attack, and only a power actually
  // attacked by a plan or an escalation is declared against.
  dominionCorridorTargets: Object.freeze(['bajoran', 'terran', 'klingon', 'vulcan', 'andorian', 'romulan', 'ferengi', 'player']), // the corridor may be forced against its holder only if it is one of these
  dominionOpeningAlsoDeclare: Object.freeze([]),   // further opening war targets the authored plan deliberately attacks
  dominionEscalationTargets: Object.freeze(['bajoran', 'terran', 'klingon', 'vulcan', 'andorian', 'romulan', 'ferengi', 'player']),
  dominionEscalationEveryDays: 30,  // at most one deliberate escalation against a new power per this many days
  dominionPactPartners: Object.freeze(['cardassian', 'breen']), // pacts activated at the crossing with whichever of these is aligned then
  dominionAccessDeniedDays: 60,     // the wormhole held against Central and convoys interdicted this long: access is permanently denied
  // Expeditionary sides: a power fighting on this side of a wormhole is judged by whether the expedition
  // can sustain the war, not by its home realm. [DOMINION-FORMAL-WAR-RULES §5]
  expeditionarySides: Object.freeze({ dominion: Object.freeze({ wormhole: 'bajora-dominica-wormhole' }) }),
  expeditionCollapseShare: 0.35,    // at or below this share of the expedition's best, with no way to replace losses, it cannot sustain the war
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
  maxHullsPerPolity: 120,          // standing hulls, not hulls ever built: losses free capacity
  maxLiveRecoveries: 40,           // open recovery contracts; the bound is enforced at creation, not by deleting offers
  maxLiveMissions: 60,             // open (offered or active) contracts; likewise enforced at creation
  maxOrders: 40,                   // acknowledged order history kept; an order still queued is never evicted
  maxQueuedOrders: 500,            // orders waiting for a link: beyond this a NEW one is refused, never an old one dropped
  // A power can exist without ruling anything: an isolated garrison holding an outpost in somebody
  // else's sky. It has no worlds, so the opening pass that builds forces from controlled worlds gives
  // it nothing; these are its authored hulls and where they stand. It rules no ground, so the world
  // economy gives it nothing either: `revenuePerDay` and `materialsPerDay` are the authored raiding
  // and salvage take that keeps it standing, paid only while it still holds a live station at
  // `systemIndex` — take the outpost and the take stops. `supply` is what one outpost sustains, short
  // of a supplied power's 1. `replaceDays` is the whole of its production: it owns no yard, so a lost
  // hull comes back no faster than this, never past `hulls`, and only if it can pay for one.
  openingGarrisons: {
    dominion_remnant: { systemIndex: 28, hulls: 4, revenuePerDay: 120, materialsPerDay: 1, supply: 0.6, replaceDays: 60 },
  },
  maxCatchUpDays: 2000,            // days a single advancement call will step; beyond this the remainder is recorded as unobserved
  foreignDesignShare: 0.35,        // share of AI build orders drawn from licensed foreign designs when any are held
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
    warStates: {},       // warKey → the current war instance between a pair (BILATERAL-WAR-PEACE-RULES §2)
    territory: {},       // systemIndex → { status: occupied|retained|returned|disputed, holder, claimant, warKey, day }
    stats: { battlesResolved: 0, captures: 0, hullsBuilt: 0, hullsLost: 0, missionsOffered: 0 },
  };
}
export function nextCampaignId(book, type) { return `${book.seed}:${type}:${++book.counter}`; }

// A book is persisted with its config inline, and the version is only bumped when the book must be
// rebuilt. So a save written by an older build arrives with that build's rule set and none of the keys
// added since — which silently removed four bounds and two repairs. Backfill anything missing from the
// current rules, leaving every value the save already carries untouched, and make sure the collections
// later code indexes into exist. Idempotent; safe to call on every access.
export function upgradeCampaignBook(book) {
  if (!book || typeof book !== 'object') return book;
  book.config = { ...CAMPAIGN_RULES, ...(book.config || {}) };
  book.discoveries ||= { gorn: false };
  for (const key of ['polities', 'designs', 'incomeLedger', 'restoredStations', 'activatedStations', 'unstaffedStations', 'occupations', 'wars', 'warStates', 'territory']) book[key] ||= {};
  for (const key of ['operations', 'recoveries', 'missions', 'orders', 'history']) if (!Array.isArray(book[key])) book[key] = [];
  book.dominion ||= { phase: 'dormant', phaseDay: null, warnings: [], entrySystem: null, stagingSystem: null, expeditionOpId: null, reinforcementCut: false, convoys: 0, lastConvoyDay: null };
  book.stats ||= { battlesResolved: 0, captures: 0, hullsBuilt: 0, hullsLost: 0, missionsOffered: 0 };
  book.stats.missionsOffered ??= 0;
  migrateHullIdentities(book);
  return book;
}

function polity(book, id) {
  return (book.polities[id] ||= {
    id, kind: id === 'player' ? 'player' : 'faction', active: true,
    treasury: 0, materials: 0, revenueLastDay: 0, expenseLastDay: 0, supply: 1,
    hulls: [], queue: [], integrations: {}, licenses: {}, readinessBaseline: null,
    readinessPeak: 0, revenuePeak: 0, treasuryPeak: 0, berthsPeak: 0,
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
// Installations a polity may actually draw on: its own, plus unowned infrastructure in the system.
// Holding the space a foreign or private station sits in does not hand its berths, workforce, repair
// slips or takings to the holder — a Klingon yard inside Earth orbit is still a Klingon yard. Taxing a
// foreign installation is a separate question and is deliberately left to the economy pass.
function stationEffects(world, index, ownerId = null) {
  const total = {};
  for (const st of systemStations(world, index)) {
    if (!isOperationalStation(st)) continue;
    if (ownerId != null && st.owner != null && st.owner !== ownerId) continue;
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
// Readiness the way an observer adds it up: only hulls standing at systems the caller says have been
// seen, and no supply factor, because a captain counting warships through a telescope does not know
// how well fed they are. The per-hull formula is polityReadiness's own, so an estimate built from
// observations and the truth behind it differ only in what was observed. [playtest candidate]
export function observedReadiness(book, world, id, seen) {
  const p = polity(book, id);
  const within = (h) => seen.has(Number(h.systemIndex));
  const ready = p.hulls.filter((h) => (h.status === 'ready' || h.status === 'assigned') && within(h));
  const strength = ready.reduce((n, h) => n + hullStrength(book, world, h), 0);
  return { hulls: p.hulls.filter((h) => h.status !== 'lost' && within(h)).length, ready: ready.length,
    strength: Math.round(strength * 10) / 10 };
}
export function polityProduction(book, world, id) {
  let berths = 0, heavyBerths = 0, workforce = 0, energy = 0, repair = 0, yards = 0;
  for (const sys of controlled(world, id)) {
    const fx = stationEffects(world, sys.index, id);
    const occupation = book.occupations[sys.index];
    const factor = occupation ? occupationFactor(book, occupation) : 1;
    berths += (fx.berths || 0) * factor; heavyBerths += (fx.heavyBerths || 0) * factor;
    workforce += (fx.workforce || 0) * factor; energy += (fx.energy || 0); repair += (fx.repairCapacity || 0) * factor;
    yards += systemStations(world, sys.index).filter((s) => isOperationalStation(s) && s.cap.services.construction !== 'none' && (s.owner == null || s.owner === id)).length;
  }
  const p = polity(book, id);
  const busy = p.queue.filter((q) => q.status === 'building' || q.status === 'awaiting-commission').length;
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
  // A campaign that first runs on a save already 200 days old still gets the whole expedition arc.
  // The Dominion phase days are offsets from the first campaign day, not from day 1 of a fresh game,
  // so a migrated save cannot emit the warnings and the invasion in the same week.
  if (book.day > 1 && book.dominion.anchorDay == null) {
    const shift = book.day - 1;
    // Nothing in the expedition's rules is a campaign day any more, so a save that first runs the
    // campaign on day 400 has nothing to re-anchor: the opening is judged from the war, the economy,
    // the corridor and what the captain has been offered, none of which is dated.
    book.dominion.lateStartShift = shift;
  }
  book.dominion.anchorDay ??= book.day;
  const c = book.config;
  const factions = new Set(world.systems.map((s) => s.controller).filter((id) => id && id !== 'player' && world.isFaction(id)));
  for (const id of Object.keys(c.openingGarrisons || {})) if (world.isFaction(id)) factions.add(id);
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
    // A garrison is raised where it was authored to stand, whether or not its holder rules the ground
    // under it. Same draw as an opening force, just not per world.
    const garrison = c.openingGarrisons?.[id];
    if (garrison && Number.isFinite(Number(garrison.systemIndex))) {
      const at = Number(garrison.systemIndex);
      for (let i = 0; i < Math.max(0, Math.floor(garrison.hulls) || 0); i++) {
        const pick = world.pickHull(id, seededUnit(book.seed, `garrison:${id}:${at}:${i}`));
        if (pick == null) break;
        if (!addHull(book, world, id, at, `garrison:${id}:${at}:${i}`, pick)) break;
      }
      // The clock on replacements starts at the opening, so the first loss is not made good overnight.
      p.garrisonRebuiltDay = book.day;
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
  // Wars already under way when the campaign begins start their instance here, with the opening
  // position as the baseline, so "the worlds it held at the start" means the start of the war.
  for (const pair of warPairsInView(book, world)) openWarInstance(book, world, pair, book.day);
  return book;
}
function livingHulls(p) { return p.hulls.filter((h) => h.status !== 'lost'); }
// Destroyed hulls are kept only while an unresolved operation still names them, then cleared. Without
// this the fleet cap counts the dead and a polity that has fought a war can never build again.
function pruneLostHulls(book) {
  for (const id of Object.keys(book.polities)) {
    const p = book.polities[id];
    if (!p.hulls.some((h) => h.status === 'lost')) continue;
    const referenced = new Set();
    for (const op of book.operations) if (op.status !== 'resolved' && op.faction === id) for (const hid of op.hullIds) referenced.add(hid);
    const kept = [];
    for (const h of p.hulls) {
      if (h.status !== 'lost' || referenced.has(h.id)) { kept.push(h); continue; }
      // Leaving the books destroyed: its identity is retired, never reused. A hull taken by the captain
      // is not retired — it lives on under the same vid in the captain's fleet. [identity]
      if (h.identity && h.fate !== 'captured') Identity.retireVessel(book, h.identity, { day: book.settled ?? null, cause: 'destroyed', holder: id, systemIndex: h.systemIndex });
    }
    p.hulls = kept;
  }
}
function addHull(book, world, polityId, systemIndex, seedKey, shipId = null) {
  const p = polity(book, polityId);
  if (livingHulls(p).length >= book.config.maxHullsPerPolity) return null;
  const id = shipId ?? world.pickHull(polityId, seededUnit(book.seed, seedKey));
  if (id == null) return null;
  const stats = world.shipStats(id) || {};
  const maxHull = Math.max(1, Number(stats.combatHull) || 100);
  const hull = { id: nextCampaignId(book, 'hull'), shipId: Number(id), hull: maxHull, maxHull, crew: 1, systemIndex: Number(systemIndex), status: 'ready', opId: null };
  // The hull is a strategic vessel from the day it enters the books. Its id is its vid; how it came
  // to exist is read off the key that created it. No random draw is taken, so no book changes shape.
  hull.identity = Identity.makeIdentity({ vid: hull.id, shipId: hull.shipId, seed: Identity.vesselHash(`${book.seed}:${hull.id}`),
    builder: polityId, via: hullOriginVia(seedKey), day: book.settled ?? null, systemIndex: hull.systemIndex });
  p.hulls.push(hull);
  return hull;
}
function hullOriginVia(seedKey) {
  const k = String(seedKey || '').split(':')[0];
  return { opening: 'initial', garrison: 'initial', reserve: 'initial', 'garrison-replace': 'built', build: 'built', recon: 'expedition', expedition: 'expedition', convoy: 'expedition' }[k] || 'built';
}
// A save written before identities existed: every hull gets one, deterministically from the book's
// seed and the hull's own id, so migrating the same save twice gives the same vessels. [identity]
export function migrateHullIdentities(book) {
  if (book.identityVersion === Identity.IDENTITY_VERSION) return 0; // every hull made since carries one
  let migrated = 0;
  for (const [polityId, p] of Object.entries(book.polities || {})) {
    if (polityId === 'player') continue; // the captain's hulls are mirrors, rebuilt from the fleet each day
    for (const h of p.hulls || []) {
      if (h.identity?.vid === h.id) continue;
      h.identity = Identity.normalizeIdentity(h.identity) && h.identity.vid === h.id ? Identity.normalizeIdentity(h.identity)
        : Identity.makeIdentity({ vid: h.id, shipId: h.shipId, seed: Identity.vesselHash(`${book.seed}:${h.id}`), builder: polityId, via: 'legacy', day: null, systemIndex: h.systemIndex, legacy: true });
      migrated++;
    }
  }
  Identity.ensureRegistry(book);
  book.identityVersion = Identity.IDENTITY_VERSION;
  return migrated;
}
// A hull that leaves its polity's books alive: taken by the captain. It stops being that polity's
// hull at once — an operation reconciling afterwards must not count it as a survivor or a loss — and
// its identity leaves with it; the caller puts the same identity on the vessel's new record. Returns
// that identity, or null if there is no such living hull.
export function transferHullOut(book, hullId, { day = null, to = 'player', systemIndex = null } = {}) {
  for (const [polityId, p] of Object.entries(book.polities || {})) {
    if (polityId === 'player') continue;
    const h = (p.hulls || []).find((x) => x.id === hullId);
    if (!h || h.status === 'lost') continue;
    h.identity ||= Identity.makeIdentity({ vid: h.id, shipId: h.shipId, seed: Identity.vesselHash(`${book.seed}:${h.id}`), builder: polityId, via: 'legacy', systemIndex: h.systemIndex, legacy: true });
    Identity.recordProvenance(h.identity, { day, event: 'captured', from: polityId, to, systemIndex });
    h.status = 'lost';
    h.fate = 'captured';
    h.hull = 0;
    p.lostHulls = (p.lostHulls || 0) + 1;
    book.stats.hullsCaptured = (book.stats.hullsCaptured || 0) + 1;
    return { polityId, identity: Identity.normalizeIdentity(h.identity) };
  }
  return null;
}

// ---------- the bulk shadow ----------
// A private, mutable view of the world for a multi-day call. Controllers, installation ownership,
// individual station records and relations can all be overridden without touching the caller's
// snapshot; everything else delegates to it.
function shadowWorld(world) {
  const overrides = { stationOwners: new Map(), stationRecords: new Map(), relations: new Map() };
  const baseStations = world.stationsBySystem;
  const baseRelation = world.relation;
  return {
    ...world,
    systems: world.systems.map((s) => ({ ...s })),
    shadow: overrides,
    stationsBySystem: (index) => baseStations(index).map((st) => {
      const record = overrides.stationRecords.get(st.id) || st;
      if (!overrides.stationOwners.has(st.id)) return record;
      const owner = overrides.stationOwners.get(st.id);
      return owner === record.owner ? record : { ...record, owner };
    }),
    relation: (a, b) => overrides.relations.get(`${a}:${b}`) ?? overrides.relations.get(`${b}:${a}`) ?? baseRelation(a, b),
  };
}
// Reduce one day's conquests into the shadow before the next day runs. This part is the model's own
// rule: the displaced government's installations change hands with the world, and foreign or private
// owners keep theirs. Everything an engine has to interpret is settled separately, through the
// per-internal-day hook below.
function reduceIntoShadow(shadow, world, effects) {
  for (const e of effects) {
    if (e.type !== 'captureSystem') continue;
    const index = Number(e.systemIndex);
    const sys = shadow.systems[index];
    if (sys) sys.controller = e.by;
    if (e.from == null) continue;
    for (const st of world.stationsBySystem(index)) {
      const current = shadow.shadow.stationOwners.get(st.id) ?? st.owner;
      if (current === e.from) shadow.shadow.stationOwners.set(st.id, e.by);
    }
  }
}

// ---------- advancement ----------
// Settles every day up to and including `day`. Returns effects for the engine to apply. Idempotent:
// a day at or before book.settled is a no-op, so replays cannot double-settle. A caller that jumps —
// a long warp, a debug skip, a migrated save — gets the book a caller that stepped would get, for any
// gap up to maxCatchUpDays; that is the bound, and past it the remainder is deliberately recorded as
// unobserved time rather than stepped, so two callers whose gap exceeds it do NOT agree. Non-finite
// and absurd inputs are refused rather than trusted.
export function advanceCampaignDay(book, world, day) {
  const effects = [];
  if (!book.initialized) initializeCampaign(book, world);
  const target = Math.floor(Number(day));
  if (!Number.isFinite(target) || target <= book.settled) return effects;
  const limit = Math.max(1, Math.floor(book.config.maxCatchUpDays) || 1);
  const last = Math.min(target, book.settled + limit);
  // Every call steps against a private shadow of the world, into which each day's effects are reduced
  // before the next day runs. The engine only applies those effects to the real world after the call
  // returns, so without this the days after a capture still see the old holder and the old yard
  // owners: the same world is taken again and again and the book diverges from the one daily stepping
  // produces. The caller's snapshot is never touched. A single-day call takes the same path on
  // purpose, so that what the engine is handed on the day it settles does not depend on how many days
  // the caller asked for — the day's own conquests are reduced before the engine settles that day,
  // whether it is day one of two hundred or the only one.
  const stepWorld = shadowWorld(world);
  // The model's own settlements are authoritative for the war instance they settled, even before the
  // engine has applied them (and always, in a world with no engine behind it).
  for (const st of Object.values(book.warStates || {})) {
    if (st.status !== 'ceasefire' && st.status !== 'peace' && !(st.declared && st.status === 'war')) continue;
    const current = warPairsInView(book, world, true).find((p) => warKey(p.a, p.b) === st.key);
    if (current && current.warId === st.warId) stepWorld.shadow.relations.set(`${relSide(world, st.a)}:${relSide(world, st.b)}`, st.status);
  }
  for (let d = book.settled + 1; d <= last; d++) {
    const mark = effects.length;
    settleCampaignDay(book, stepWorld, d, effects);
    const dayEffects = effects.slice(mark);
    if (dayEffects.length) reduceIntoShadow(stepWorld, world, dayEffects);
    // The consequences only an engine can settle are settled here, once per internal day, whether the
    // caller stepped one day or jumped two hundred: what a damaged installation's capabilities become,
    // how much of that damage its owner's repair capacity heals before the next day runs, what a
    // settlement does to a relation. A hook that runs once per CALL rather than once per day is the
    // whole defect this exists to prevent — a day of damage and a day of repair have to land in the
    // same order at the same rate either way. Engines may decline to provide it; what nobody settles
    // is the documented limit of bulk equivalence, not a silent one.
    world.settleDay?.(stepWorld, d, dayEffects);
  }
  if (target > last) {
    addHistory(book, target, 'calendar', `${target - last} days passed unobserved; the strategic record resumes on day ${target}.`);
    book.day = target; book.settled = target;
  }
  return effects;
}
function settleCampaignDay(book, world, day, effects) {
  book.day = day;
  settleEconomy(book, world, day, effects);
  advanceProduction(book, world, day, effects);
  advanceGarrisons(book, world, day);
  advanceRepairs(book, world, day);
  advanceIntegrations(book, world, day, effects);
  enforceRelations(book, world, day, effects);
  planOperations(book, world, day, effects);
  advanceOperations(book, world, day, effects);
  advanceDominion(book, world, day, effects);
  evaluateWars(book, world, day, effects);
  advanceRecoveries(book, world, day, effects);
  expireMissions(book, day, effects);
  pruneLostHulls(book);
  book.settled = day;
}

// A garrison that loses a hull is not finished. While it still holds its outpost it makes one loss good
// at a time, paying the yard price out of its own treasury, no faster than `replaceDays` apart and never
// past its authored strength. This is the whole of its production: owning no world, it can queue nothing
// through `advanceProduction`, so without this a garrison only ever shrinks.
function advanceGarrisons(book, world, day) {
  const c = book.config;
  for (const [id, garrison] of Object.entries(c.openingGarrisons || {})) {
    if (!book.polities[id] || !world.isFaction(id)) continue;
    if (controlled(world, id).length) continue;        // it rules ground now; ordinary production applies
    if (!garrisonOutpostHeld(world, id, garrison)) continue;
    const p = polity(book, id);
    const want = Math.max(0, Math.floor(garrison.hulls) || 0);
    if (livingHulls(p).length >= want) continue;
    const wait = Math.max(0, Number(garrison.replaceDays) || 0);
    if (day - (p.garrisonRebuiltDay ?? book.day) < wait) continue;
    const at = Number(garrison.systemIndex);
    const pick = world.pickHull(id, seededUnit(book.seed, `garrison-replace:${id}:${day}`));
    if (pick == null) continue;
    const price = Math.max(1000, Number((world.shipStats(pick) || {}).price) || 0);
    if (p.treasury < price) continue;
    const hull = addHull(book, world, id, at, `garrison-replace:${id}:${day}`, pick);
    if (!hull) continue;
    p.treasury = bounded(p.treasury - price, -c.treasuryCap, c.treasuryCap);
    p.garrisonRebuiltDay = day;
    addHistory(book, day, 'garrison', `${world.factionName(id)} makes good a hull at its outpost.`);
  }
}

// A garrison holds its ground through a station, not a flag: the outpost is what pays it and what it
// rebuilds from. Destroyed or taken from it, the garrison is on its own.
function garrisonOutpostHeld(world, polityId, garrison) {
  const at = Number(garrison?.systemIndex);
  if (!Number.isFinite(at)) return false;
  return world.stationsBySystem(at).some((st) => st && st.owner === polityId && !st.destroyed);
}

function settleEconomy(book, world, day, effects) {
  const c = book.config;
  for (const id of Object.keys(book.polities)) {
    const p = polity(book, id);
    const worlds = controlled(world, id);
    let revenue = 0, materials = 0, food = 0, housing = 0;
    for (const sys of worlds) {
      const fx = stationEffects(world, sys.index, id);
      const factor = book.occupations[sys.index] ? occupationFactor(book, book.occupations[sys.index]) : 1;
      revenue += (c.worldRevenueBase + c.worldRevenuePerPopulation * (sys.population || 0) + (fx.revenue || 0)) * factor * (1 + (fx.customs || 0) / 100);
      materials += (c.materialsPerWorld + (fx.mining || 0)) * factor;
      food += fx.food || 0; housing += fx.housing || 0;
    }
    // A garrison polity rules no ground, so the world loop above gave it nothing. Its authored take is
    // paid only while it still holds a live station where it stands: lose the outpost, lose the income.
    const garrison = c.openingGarrisons?.[id];
    const holdsOutpost = !worlds.length && garrison ? garrisonOutpostHeld(world, id, garrison) : false;
    if (holdsOutpost) {
      revenue += Math.max(0, Number(garrison.revenuePerDay) || 0);
      materials += Math.max(0, Number(garrison.materialsPerDay) || 0);
    }
    // Supply: a polity with no controlled world has none, save a garrison still on its outpost, which
    // runs on what that one station can sustain; blockaded worlds (an enemy op holding) reduce it.
    const blockaded = worlds.filter((s) => book.operations.some((o) => o.targetSystem === s.index && o.status === 'engaged' && o.faction !== id)).length;
    p.supply = worlds.length
      ? bounded(1 - blockaded / worlds.length * 0.6, c.supplyFloor, 1)
      : (holdsOutpost ? bounded(Number(garrison.supply) || c.supplyFloor, c.supplyFloor, 1) : c.supplyFloor);
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
    // High-water marks: what this polity could field, earn, bank and build at its best. Opening capacity
    // is the baseline for a power that starts with a fleet; a player empire starts with nothing, so its
    // capacity is what it has built. Both are needed to say "down to a third of what it could field"
    // without naming a faction. Revenue, treasury and berths are the same idea for the war economy: a
    // power whose worlds and yards are gone earns and builds a fraction of what it once did, and that
    // is the difference between a war that has cost something and a war that has merely been long.
    p.readinessPeak = Math.max(p.readinessPeak || 0, polityReadiness(book, world, id).strength);
    p.revenuePeak = Math.max(p.revenuePeak || 0, revenue);
    p.treasuryPeak = Math.max(p.treasuryPeak || 0, p.treasury);
    p.berthsPeak = Math.max(p.berthsPeak || 0, polityProduction(book, world, id).berths);
    // crew recovery at worlds with morale
    // Morale is a place, not an asset: shore leave at any operational station in the system counts.
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
  // Ordering and building must agree: production capacity is only ever gathered from systems the
  // polity controls, so a yard it owns inside someone else's space cannot accept a keel either.
  if (!controlled(world, polityId).some((s) => s.index === Number(systemIndex))) return { ok: false, reason: 'That system is not held' };
  const yards = systemStations(world, systemIndex).filter((s) => isOperationalStation(s) && s.owner === polityId && s.cap.services.construction !== 'none');
  if (!yards.length) return { ok: false, reason: 'No owned operational yard in that system' };
  const heavy = (Number(stats.mass) || 1) >= c.heavyMass;
  if (heavy && !yards.some((s) => s.cap.services.construction === 'heavy')) return { ok: false, reason: 'Heavy design needs a heavy berth' };
  if (!polityCanBuildDesign(book, world, polityId, shipId)) return { ok: false, reason: 'No licence for that design, or it is not produced in general yards' };
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
function factionOf(world, polityId) { return polityId === 'player' ? world.playerFaction : polityId; }
// Who a polity is for the purposes of war and peace. The player's empire is its own party when the
// engine says so (world.playerRelationSide = 'player'): its wars are its own records, not whatever its
// current flag's government is fighting. A world built without that (the pure tests) keeps the old
// reading, so a relation question is still answered. Culture — which designs are native — is a
// different question and stays with factionOf.
function relSide(world, polityId) { return polityId === 'player' ? (world.playerRelationSide || world.playerFaction) : polityId; }
// Whether a design may be laid down at all: a captured licence grants access to a catalogue, never an
// exemption from the rules that keep special-vendor, non-shipyard and secret hulls out of general
// production. The engine owns that judgement; the model only refuses to bypass it.
function designEligible(world, shipId, polityId) {
  return world.designEligible ? Boolean(world.designEligible(Number(shipId), polityId)) : true;
}
// Whether a captured yard's own catalogue can keep being built once the industry is integrated. This
// is a different question from whether a general yard stocks the hull by default: taking a culture's
// major world is supposed to give you that culture's ships, apart from the named exceptions the
// campaign rules list. The engine owns the exception list.
function designIndustrial(world, shipId) {
  return world.designIndustrial ? Boolean(world.designIndustrial(Number(shipId))) : designEligible(world, shipId, null);
}
function polityCanBuildDesign(book, world, polityId, shipId) {
  const p = polity(book, polityId);
  const stats = world.shipStats(shipId) || {};
  const native = !stats.faction || stats.faction === 'neutral' || stats.faction === factionOf(world, polityId);
  // A licence is a captured yard and its drawings: what that yard could build, it can go on building,
  // subject only to the named exceptions. A design the polity has no licence for has to clear the
  // ordinary general-production rule instead.
  if (p.licenses[shipId]) return designIndustrial(world, shipId);
  if (!native) return false;
  return designEligible(world, shipId, polityId);
}
// Licensed foreign designs a polity can pay for today, in a stable order so the draw is deterministic.
export function licensedDesigns(book, world, polityId) {
  const p = polity(book, polityId), c = book.config;
  return Object.keys(p.licenses).map(Number).filter((id) => {
    if (!Number.isFinite(id)) return false;
    if (!polityCanBuildDesign(book, world, polityId, id)) return false;
    const stats = world.shipStats(id);
    if (!stats) return false;
    const r = buildRecipe(c, stats);
    return p.treasury >= r.latinum && p.materials >= r.materials;
  }).sort((a, b) => a - b);
}
// The native pool keeps its lore weighting; a share of orders is drawn from the captured catalogue,
// which is the entire point of taking a shipyard.
function pickBuildDesign(book, world, polityId, day, u) {
  const native = world.pickHull(polityId, u);
  const licensed = licensedDesigns(book, world, polityId);
  if (!licensed.length) return native;
  const pickForeign = () => licensed[Math.floor(seededUnit(book.seed, 'foreign-pick', polityId, day) * licensed.length) % licensed.length];
  if (native == null) return pickForeign();
  return seededUnit(book.seed, 'foreign-share', polityId, day) < book.config.foreignDesignShare ? pickForeign() : native;
}
function advanceProduction(book, world, day, effects) {
  const c = book.config;
  for (const id of Object.keys(book.polities)) {
    const p = polity(book, id);
    // AI replacement policy: keep at least the opening hull count, one order per planning interval.
    if (id !== 'player' && day % c.planningIntervalDays === 0) {
      const alive = p.hulls.filter((h) => h.status !== 'lost').length;
      const active = p.queue.filter((q) => q.status !== 'delivered' && q.status !== 'lost').length;
      // Never order a hull there is no standing-fleet room to commission: the yard would finish her and
      // the order would wait for ever while the treasury paid for the next one, and the next.
      const room = Math.max(0, c.maxHullsPerPolity - alive - active);
      const target = Math.min(Math.max(4, Math.round((p.readinessBaselineHulls ||= alive))), c.maxHullsPerPolity);
      // Replace losses toward the opening count; with a full war chest, grow beyond it (one order per interval).
      if (room > 0 && (alive + active < target || (p.treasury > c.aiWarChest && active < 2))) {
        const yardSystems = controlled(world, id).filter((s) => systemStations(world, s.index).some((st) => isOperationalStation(st) && st.owner === id && st.cap.services.construction !== 'none'));
        if (yardSystems.length) {
          const sys = yardSystems[Math.floor(seededUnit(book.seed, 'build-site', id, day) * yardSystems.length)];
          const shipId = pickBuildDesign(book, world, id, day, seededUnit(book.seed, 'build-hull', id, day));
          if (shipId != null) queueBuild(book, world, id, shipId, sys.index, day);
        }
      }
    }
    // Capacity: per system, berths minus those consumed by repairs.
    const capacity = {};
    for (const sys of controlled(world, id)) {
      const fx = stationEffects(world, sys.index, id);
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
      if (item.remainingDays > 0) item.remainingDays -= cap.supply;
      if (item.remainingDays <= 0 && !item.deliveredHullId) {
        const hull = addHull(book, world, id, item.systemIndex, `build:${item.id}`, item.shipId);
        if (!hull) {
          // The yard finished her; the polity has no standing-fleet capacity left to commission her.
          // The order holds at completion and is retried. It is never marked delivered, never counted
          // as a built hull, and the latinum and materials it already consumed are never charged twice.
          // Announced once for the life of the order. The status cannot carry that fact: a day with no
          // free berth sends the item back to 'queued' before this runs, which is what made the earlier
          // guard log every few days and evict the whole campaign history.
          if (item.awaitingSince == null) {
            item.awaitingSince = day;
            addHistory(book, day, 'production', `${world.factionName(id)} completed a hull at ${world.systems[item.systemIndex]?.name} with no fleet capacity to commission her; the order waits.`, { polityId: id, systemIndex: item.systemIndex });
          }
          item.status = 'awaiting-commission'; item.remainingDays = 0;
          continue;
        }
        item.status = 'delivered'; item.deliveredDay = day; item.deliveredHullId = hull.id; item.awaitingSince = null;
        p.builtHulls++; book.stats.hullsBuilt++;
        effects.push({ type: 'hullBuilt', polityId: id, systemIndex: item.systemIndex, shipId: item.shipId, hullId: hull.id, day });
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
    for (const sys of controlled(world, id)) budget[sys.index] = stationEffects(world, sys.index, id).repairCapacity || 0;
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
  // Territory taken from somebody is occupied until a settlement says otherwise; a ceasefire does not.
  book.territory ||= {};
  if (fromPolity && fromPolity !== byPolity) {
    book.territory[systemIndex] = { status: 'occupied', holder: byPolity, claimant: fromPolity, warKey: warKey(byPolity, fromPolity), day };
    const w = warRecord(book, byPolity, fromPolity);
    w.front ||= [];
    w.front.push({ day, by: byPolity, from: fromPolity, systemIndex });
    if (w.front.length > 40) w.front = w.front.slice(-40);
  } else delete book.territory[systemIndex];
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
      // A foreign-owned yard in a captured system is not the conqueror's to retool. Same ownership rule
      // as production capacity: your own installations, plus unowned infrastructure.
      const yard = systemStations(world, sysIndex).some((s) => isOperationalStation(s) && s.cap.services.construction !== 'none' && (s.owner == null || s.owner === id));
      integ.progress += yard ? 1 : 0.5; // retooling needs a working yard; population alone integrates at half speed
      if (integ.progress >= c.integrationDays) {
        integ.completedDay = day;
        integ.designs = (world.nativeDesigns(integ.sourceFaction, sysIndex) || []).filter((shipId) => designIndustrial(world, shipId));
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
    const enemy = world.relation(id, relSide(world, sys.controller)) === 'war';
    if (!enemy) continue;
    const hops = world.routeHops(mine, sys.index, id);
    if (hops == null) continue;
    out.push({ index: sys.index, hops, controller: sys.controller });
  }
  return out.sort((a, b) => a.hops - b.hops);
}
// Everyone whose forces actually stand between an attacker and this world: the controller and any
// polity allied to it, the attacker excluded. The same list decides how strong the defence is and who
// takes the losses, so nothing can raise a defence it is never asked to pay for. The player's empire
// is one of these polities — its hulls are the real fleet vessels synchronised by the engine — which
// is why there is no second, lossless "extra defence" term.
export function defendingPolityIds(book, world, systemIndex, attackerId = null) {
  const controller = world.systems[systemIndex]?.controller;
  if (!controller) return [];
  const out = [];
  for (const id of Object.keys(book.polities)) {
    if (id === attackerId) continue;
    if (id === controller) { out.push(id); continue; }
    const relation = world.relation(relSide(world, id), relSide(world, controller));
    if (relation === 'allied') { out.push(id); continue; }
    // The captain's own vessels stand with any holder they are not at war with — their own worlds,
    // allies, and neutral hosts such as Bajora against the Dominion. That is the rule the removed
    // extraDefense hook encoded and it is kept here, except that now those ships can also be lost.
    // Whether an AI third power joins someone else's defence is a planning question, not a repair.
    if (id === 'player' && relation !== 'war') out.push(id);
  }
  return out;
}
export function localDefenseStrength(book, world, systemIndex) {
  const sys = world.systems[systemIndex];
  // Only installations owned by the controller (or a side not at war with it) defend the world.
  let defense = 0;
  for (const st of systemStations(world, systemIndex)) {
    if (!isOperationalStation(st)) continue;
    const owner = st.owner;
    const hostileToController = sys?.controller && owner && owner !== sys.controller && world.relation(relSide(world, owner), relSide(world, sys.controller)) === 'war';
    if (hostileToController) continue;
    defense += st.cap.effects.defense || 0;
  }
  let strength = defense * book.config.garrisonStrengthPerDefense;
  for (const id of defendingPolityIds(book, world, systemIndex)) {
    for (const h of polity(book, id).hulls) if (h.status === 'ready' && h.systemIndex === systemIndex) strength += hullStrength(book, world, h);
  }
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
    let targets = reachableEnemyTargets(book, world, id);
    if (id === 'dominion' && book.dominion.phase !== 'invasion') continue; // the expedition opens hostilities, never a routine raid
    // The Dominion's targets are only powers it is formally at war with; with none left in reach it may
    // deliberately escalate against a new one (below). Everyone else plans only against its wars.
    if (!targets.length && id !== 'dominion') continue;
    const ready = p.hulls.filter((h) => h.status === 'ready');
    // A home garrison stays behind at every held world: an offensive never strips a world of its last defenders.
    const perSystem = {};
    for (const h of ready) perSystem[h.systemIndex] = (perSystem[h.systemIndex] || 0) + 1;
    const held = new Set(controlled(world, id).map((s) => s.index));
    let spare = ready.filter((h) => { if (!held.has(h.systemIndex)) return true; if (perSystem[h.systemIndex] > c.homeGarrisonPerWorld) { perSystem[h.systemIndex]--; return true; } return false; });
    if (id === 'dominion') {
      const bound = dominionPlanningBounds(book, world, targets, spare);
      if (!bound) continue;
      targets = bound.targets; spare = bound.spare;
      if (!targets.length) { dominionEscalate(book, world, day, spare, effects); continue; }
    }
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
// Systems reachable from the wormhole's near terminus without transiting the wormhole. The expedition's
// entry constraint lives in the map, so nothing can satisfy it by naming a faction.
export function nearSideSystems(world, entrySystem) {
  const isWormholeEdge = (a, b) => world.wormholes.some((w) => (w.from === a && w.to === b) || (w.to === a && w.from === b));
  const seen = new Set([Number(entrySystem)]);
  const queue = [Number(entrySystem)];
  while (queue.length) {
    const cur = queue.shift();
    for (const n of world.neighbours(cur)) { if (isWormholeEdge(cur, n) || seen.has(Number(n))) continue; seen.add(Number(n)); queue.push(Number(n)); }
  }
  return seen;
}
// Until the Dominion holds ground on this side of the wormhole, the bridgehead is its only objective
// and the force has to come through the wormhole to reach it. Once it holds ground, operations are
// mounted from that ground — never from the far side of the galaxy, and never from the home region
// straight past an entry it does not control.
// The near-side ground the expedition operates from: worlds it holds, and the partner-held terminus it
// crossed into under the pact.
function dominionGround(book, world, near) {
  const d = book.dominion;
  const ground = controlled(world, 'dominion').map((s) => s.index).filter((i) => near.has(Number(i)));
  const entryHolder = world.systems[d.entrySystem]?.controller ?? null;
  if (d.plan?.partnerCorridor && entryHolder && entryHolder !== 'dominion' && world.relation('dominion', relSide(world, entryHolder)) === 'allied' && !ground.includes(Number(d.entrySystem))) ground.push(Number(d.entrySystem));
  return ground;
}
function dominionPlanningBounds(book, world, targets, spare) {
  const d = book.dominion;
  if (d.entrySystem == null) return null;
  const near = nearSideSystems(world, d.entrySystem);
  const heldNear = dominionGround(book, world, near);
  if (!heldNear.length) return { targets: targets.filter((t) => Number(t.index) === Number(d.entrySystem)), spare: spare.filter((h) => !near.has(Number(h.systemIndex))) };
  const staging = new Set([...heldNear.map(Number), Number(d.stagingSystem)]);
  return { targets: targets.filter((t) => near.has(Number(t.index))), spare: spare.filter((h) => staging.has(Number(h.systemIndex))) };
}
export function launchOperation(book, world, factionId, hulls, targetSystem, day, hops, kind = 'assault', effects = []) {
  if (book.operations.length >= book.config.maxOperations) book.operations = book.operations.filter((o) => o.status !== 'resolved').concat(book.operations.filter((o) => o.status === 'resolved').slice(-20));
  // A raid can be drawn from more than one nearby system. Each hull remembers its own departure point
  // so survivors are not all returned to the first one's, which silently relocated ships between
  // neighbouring systems after every mixed-origin raid.
  const originSystem = hulls[0]?.systemIndex ?? null;
  for (const h of hulls) h.originSystem = h.systemIndex;
  const op = { id: nextCampaignId(book, 'op'), faction: factionId, kind, targetSystem: Number(targetSystem), originSystem,
    // Who this was launched against, recorded now: by the time it resolves the world may have changed
    // hands, and a war's ledger has to know which war the engagement belonged to.
    defender: world.systems[Number(targetSystem)]?.controller ?? null,
    hullIds: hulls.map((h) => h.id), committed: hulls.length,
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
// Terminating a faction's live operations deliberately — a settlement applied by the engine, or a
// debug control winding the Dominion back. Hulls are released the ordinary way; an operation record
// that is simply deleted leaves its hulls assigned to an opId that no longer exists.
export function terminateOperations(book, world, factionId, day, effects = [], note = null) {
  const ended = [];
  for (const op of book.operations) {
    if (op.status === 'resolved' || op.faction !== factionId) continue;
    op.standDownPending = false;
    op.resolvedBy = null;
    finishOperation(book, world, op, day, 'stood-down', effects, 'diplomacy',
      note || `${world.factionName(factionId)} recalled its forces from ${world.systems[op.targetSystem]?.name || `system ${op.targetSystem}`}.`);
    ended.push(op.id);
  }
  return ended;
}
// An operation outlives the war that authorised it unless something ends it. Every day, before new
// plans are made, each live operation is re-checked against the relationship it was launched under: a
// settlement, an alliance, or the objective changing hands to a power the attacker is not at war with
// all make the operation illegal, and it stands down the same day. An operation the loaded scene has
// claimed is left alone, so a battle in progress is never yanked out from under the player;
// releaseOperationFromScene clears resolvedBy and the next day's pass stands it down for the same
// reason it could not this day. standDownPending records that pending state for the engine and the
// gates to read; it is not what drives the stand-down.
export function operationIsAuthorised(book, world, op) {
  if (!op || op.status === 'resolved') return true;
  const owner = world.systems[op.targetSystem]?.controller ?? null;
  if (owner == null) return true;                 // an unheld objective is nobody's peace to break
  if (owner === op.faction) return true;          // already ours; advanceOperations absorbs it
  return world.relation(relSide(world, op.faction), relSide(world, owner)) === 'war';
}
function enforceRelations(book, world, day, effects) {
  for (const op of book.operations) {
    if (op.status === 'resolved') continue;
    if (operationIsAuthorised(book, world, op)) { op.standDownPending = false; continue; }
    if (op.resolvedBy === 'local') { op.standDownPending = true; continue; }
    const target = world.systems[op.targetSystem]?.name || `system ${op.targetSystem}`;
    const note = `${world.factionName(op.faction)} broke off the operation at ${target}: the objective is no longer a legal target.`;
    op.standDownPending = false;
    // One terminal effect, whatever ended the operation. A second, purpose-built effect alongside the
    // generic one meant peace produced two reports, and the panel picked the generic "Fleet defeat"
    // with the raw outcome string in its text.
    finishOperation(book, world, op, day, 'stood-down', effects, 'diplomacy', note);
  }
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
  for (const id of defendingPolityIds(book, world, systemIndex, op.faction)) {
    const p = polity(book, id);
    const local = p.hulls.filter((h) => h.status === 'ready' && h.systemIndex === systemIndex);
    if (!local.length) continue;
    let budget = local.reduce((n, h) => n + h.maxHull, 0) * fraction, i = 0;
    const report = [];
    for (const h of local) {
      if (budget <= 0) break;
      const dmg = Math.min(h.hull, budget * (0.5 + seededUnit(book.seed, 'ddmg', op.id, day, id, i++)));
      h.hull -= dmg; budget -= dmg;
      if (h.hull <= 0) { h.hull = 0; h.status = 'lost'; op.defenderLosses++; p.lostHulls++; book.stats.hullsLost++; }
      report.push({ hullId: h.id, shipId: h.shipId, hull: h.hull, maxHull: h.maxHull, destroyed: h.status === 'lost' });
    }
    // The engine owns the player's vessels; it is told exactly which of them paid, so a fleet left at
    // a world that is attacked while the captain is elsewhere is really damaged, never notionally.
    if (report.length) effects.push({ type: 'defenderLosses', polityId: id, systemIndex, opId: op.id, day, attacker: op.faction, hulls: report });
  }
  // Station damage: fraction of the day's attack lands on the strongest defence installation.
  if (fraction > 0.12) {
    const stations = systemStations(world, systemIndex).filter((s) => isOperationalStation(s) && (s.cap.effects.defense || 0) > 0);
    if (stations.length) { const target = stations[Math.floor(seededUnit(book.seed, 'station', op.id, day) * stations.length)]; effects.push({ type: 'stationDamaged', stationId: target.id, systemIndex, fraction: Math.min(0.5, fraction), opId: op.id, day }); }
  }
}
// What a war has actually cost, kept per unordered pair. The operation list is trimmed — sixty live and
// the last twenty resolved — so a campaign six hundred days old cannot count its engagements by reading
// it. This ledger is what "consequential engagements" and "losses relative to opening strength" are read
// from, by the Dominion opportunity and by anything later that has to judge a war rather than date it.
export function warKey(a, b) { return [String(a), String(b)].sort().join(':'); }
export function warRecord(book, a, b) {
  book.wars ||= {};
  const key = warKey(a, b);
  return (book.wars[key] ||= { key, engagements: 0, firstDay: null, lastDay: null, losses: {}, captures: {} });
}
export function warHistory(book, a, b) { return book.wars?.[warKey(a, b)] || null; }
function recordWarEngagement(book, op, day) {
  const attacker = op.faction, defender = op.defender;
  if (!attacker || !defender || attacker === defender) return;
  // Consequential means somebody paid for it. A raid that arrived, found nothing and went home is not
  // evidence that a war is grinding its belligerents down.
  const consequential = (op.losses || 0) + (op.defenderLosses || 0) > 0 || op.outcome === 'captured';
  if (!consequential) return;
  const w = warRecord(book, attacker, defender);
  w.engagements++;
  w.firstDay ??= day;
  w.lastDay = day;
  w.losses[attacker] = (w.losses[attacker] || 0) + (op.losses || 0);
  w.losses[defender] = (w.losses[defender] || 0) + (op.defenderLosses || 0);
  if (op.outcome === 'captured') w.captures[attacker] = (w.captures[attacker] || 0) + 1;
}
function finishOperation(book, world, op, day, outcome, effects, resolvedBy, note = null) {
  op.status = 'resolved'; op.resolvedDay = day; op.outcome = outcome; op.resolvedBy = op.resolvedBy || resolvedBy;
  recordWarEngagement(book, op, day);
  book.stats.battlesResolved++;
  const survivors = operationHulls(book, op);
  for (const h of survivors) {
    h.opId = null; h.status = 'ready';
    if (outcome !== 'captured') h.systemIndex = h.originSystem ?? op.originSystem ?? h.systemIndex;
    h.originSystem = null;
  }
  addHistory(book, day, 'battle', note || `${world.factionName(op.faction)} operation at ${world.systems[op.targetSystem]?.name}: ${outcome} (${op.losses} lost, ${op.defenderLosses} defenders lost).`, { opId: op.id, systemIndex: op.targetSystem, outcome, faction: op.faction });
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
// Is there an opening? Not "is it late enough", which is what a date asks. The near side has to have
// been worn down by its own war, the result of that war has to be something an expedition can exploit,
// and the way in has to still be open. Every number is a share of a polity's own capacity, never a hull
// count or a treasury figure, so the same rule reads correctly for a minor power, a great one and a
// player empire. Nothing here can be satisfied by the calendar alone, and nothing here expires.
// [17SEP spec §3.1]
export function dominionOpportunity(book, world, day) {
  const c = book.config;
  const [wa, wb] = c.centralWar || [];
  const entry = world.wormholes.find((w) => w.id === 'bajora-dominica-wormhole') || null;
  const entrySystem = book.dominion?.entrySystem ?? entry?.from ?? null;
  const reasons = [];
  // Capacity: what a polity could field at its best, whether that is what it started with or what it
  // has since built. A player empire opens with nothing, so its baseline alone would read as ruin.
  const capacityOf = (id) => {
    const p = book.polities[id];
    if (!p) return 0;
    return Math.max(Number(p.readinessBaseline) || 0, Number(p.readinessPeak) || 0);
  };
  const shareOf = (id) => {
    const cap = capacityOf(id);
    if (!(cap > 0)) return null;                       // never fielded anything: not evidence of anything
    return polityReadiness(book, world, id).strength / cap;
  };
  const strongestAi = Math.max(...Object.keys(book.polities)
    .filter((id) => id !== 'dominion' && id !== 'player')
    .map((id) => polityReadiness(book, world, id).strength), 0);
  // Who would actually have to meet the expedition. Not a hand-picked list of the powers the author
  // happened to think of — a great power eight jumps from the entry can send a fleet to Bajora, and a
  // model that ignored it because its name was not on the list would call a galaxy defenceless while a
  // strong Romulan navy sat one region away. Membership is reach: any polity holding ground within
  // `dominionContenderHops` route-hops of the entry system can respond, and the central belligerents
  // are in regardless because the war that made the opening is theirs. The player joins on the same
  // terms as anybody else, plus the weight test below.
  const nearSide = new Set([wa, wb].filter(Boolean));
  const reachable = new Set();
  if (entrySystem != null) {
    for (const sys of world.systems) {
      const holder = sys.controller;
      if (!holder || holder === 'dominion') continue;
      if (reachable.has(holder)) continue;
      const hops = world.routeHops([sys.index], entrySystem, holder);
      if (hops != null && hops <= (c.dominionContenderHops || 0)) reachable.add(holder);
    }
  }
  for (const id of reachable) nearSide.add(id);
  const playerShare = strongestAi > 0 ? polityReadiness(book, world, 'player').strength / strongestAi : 0;
  const playerCounts = playerShare >= c.dominionPlayerPowerShare;
  if (playerCounts) nearSide.add('player');
  const defenders = [...nearSide].filter((id) => book.polities[id]).map((id) => ({ id, share: shareOf(id) }));

  // 1. The central war has to have cost somebody something. Days are not engagements.
  const ledger = warHistory(book, wa, wb);
  const engagements = ledger?.engagements || 0;
  const foughtEnough = engagements >= c.dominionMinCentralEngagements;
  if (!foughtEnough) reasons.push(`the central war has produced ${engagements} consequential engagement(s), short of ${c.dominionMinCentralEngagements}`);

  // 2. Somebody who would have to meet the expedition is materially down on their own capacity.
  const weakened = defenders.filter((x) => x.share != null && x.share <= c.dominionDefenderWeakness);
  if (!weakened.length) reasons.push('no near-side power is materially below its own capacity');
  // 2a. A war that cost hulls but nothing else is a war somebody can still fight. The near side has to
  //     be strained where wars are actually won: what it earns, what it has banked, and what it can
  //     build. Any one of the three being materially below that polity's own best counts, because a
  //     power can be broke, or blockaded out of its revenue, or have lost its yards, and each of those
  //     is a different way of being unable to replace what the expedition will take off it.
  const economyOf = (id) => {
    const p = book.polities[id];
    if (!p) return null;
    const bits = [];
    if ((p.revenuePeak || 0) > 0) bits.push({ what: 'revenue', share: (p.revenueLastDay || 0) / p.revenuePeak });
    if ((p.treasuryPeak || 0) > 0) bits.push({ what: 'treasury', share: Math.max(0, p.treasury) / p.treasuryPeak });
    if ((p.berthsPeak || 0) > 0) bits.push({ what: 'yards', share: polityProduction(book, world, id).berths / p.berthsPeak });
    if (!bits.length) return null;
    return bits.reduce((lo, x) => (x.share < lo.share ? x : lo));
  };
  const strainOf = (id) => economyOf(id);
  const strained = weakened.map((x) => ({ id: x.id, worst: strainOf(x.id) }))
    .filter((x) => x.worst && x.worst.share <= c.dominionEconomicStrain);
  if (weakened.length && !strained.length) {
    reasons.push(`no worn-down power is economically strained: ${weakened.map((x) => { const e = strainOf(x.id); return `${x.id} ${e ? `${e.what} ${Math.round(e.share * 100)}%` : 'unmeasured'}`; }).join(', ')}`);
  }

  // 2b. And nobody on this side may still be standing tall enough to make the crossing pointless. A tired
  //     pair of belligerents is no opportunity if a third power — an untouched neighbour, or a player
  //     empire that has become the strongest thing here — can meet the expedition on its own. This is
  //     how a strong player realm delays the opening: by being that power, not by a special case.
  const reach = Math.max(c.dominionExpeditionMinStrength, polityReadiness(book, world, 'dominion').strength);
  const strongestNear = Math.max(...defenders.map((x) => polityReadiness(book, world, x.id).strength), 0);
  const challengeable = strongestNear <= reach * c.dominionChallengeRatio;
  if (!challengeable) reasons.push(`the near side still fields ${Math.round(strongestNear)} against a reach of ${Math.round(reach)}`);
  // Recovery is the opposite of the opening and is what stands a started arc down: not a flicker in the
  // numbers, but every near-side power back above the line it fell below. A player who rebuilds the
  // near side, or defends it well enough that nobody stays down, sends the expedition home.
  const recovered = defenders.length > 0 && !weakened.length;

  // 3. The result has to be exploitable: a costly stalemate, or a victor too weakened to hold the door.
  const sa = wa ? polityReadiness(book, world, wa).strength : 0;
  const sb = wb ? polityReadiness(book, world, wb).strength : 0;
  const shareA = wa ? shareOf(wa) : null, shareB = wb ? shareOf(wb) : null;
  const both = shareA != null && shareB != null;
  const gap = Math.max(sa, sb) > 0 ? Math.abs(sa - sb) / Math.max(sa, sb) : 1;
  // A stalemate is three things at once, not elapsed time: both sides worn down against their own
  // capacity, a bounded strength difference between them, and a front that has stopped moving. A side
  // taking worlds off the other at better than the stall ratio is winning, however tired it is.
  const capA = ledger?.captures?.[wa] || 0, capB = ledger?.captures?.[wb] || 0;
  // One world taken in a long war is not a front moving; a lead has to be both proportionally and
  // absolutely real before it disqualifies a stalemate.
  const lead = Math.max(capA, capB), trail = Math.min(capA, capB);
  const frontStalled = lead <= Math.max(c.dominionFrontStallFloor || 0, trail * c.dominionFrontStallRatio);
  const stalemate = both && shareA <= c.dominionDefenderWeakness && shareB <= c.dominionDefenderWeakness
    && gap <= c.dominionStalemateBand && frontStalled;
  const resolution = book.resolutions?.[`${wa}:${wb}`] || null;
  const victor = resolution ? resolution.winner : null;
  const victorShare = victor ? shareOf(victor) : null;
  const weakVictor = Boolean(victor) && victorShare != null && victorShare <= c.dominionVictorWeakness;
  const balance = stalemate ? 'stalemate' : weakVictor ? 'weakened-victor' : null;
  if (!balance) {
    if (both && shareA <= c.dominionDefenderWeakness && shareB <= c.dominionDefenderWeakness && !frontStalled) {
      reasons.push(`the front is moving: ${lead} captures to ${trail}`);
    }
    reasons.push(resolution
      ? `${world.factionName(victor)} won the central war and still holds ${victorShare == null ? 'its' : `${Math.round(victorShare * 100)}% of its`} capacity`
      : 'the central war has not produced an exploitable balance');
  }

  // 4. The way in has to still be open. "Prohibitively expensive" is measured against what the Dominion
  //    can actually bring — its own ready strength, or the authored expedition floor, whichever is
  //    larger — and never against the defender's own size. Measuring it against the strongest power
  //    would let a garrison at the entry inflate the yardstick it is being judged by, so the bigger the
  //    fleet a player parked at Bajora, the more open the corridor would read. A player or an ally who
  //    garrisons the entry closes it, and it stays closed while they hold it.
  const target = Math.max(c.dominionExpeditionMinStrength, strongestAi * c.dominionExpeditionStrengthRatio);
  const entryDefence = entrySystem == null ? Infinity : localDefenseStrength(book, world, entrySystem);
  const corridorOpen = entrySystem != null && entryDefence < reach * c.dominionCorridorCloseRatio;
  if (!corridorOpen) reasons.push(entrySystem == null
    ? 'there is no wormhole corridor'
    : `the corridor at ${world.systems[entrySystem]?.name} is held at ${Math.round(entryDefence)} against a reach of ${Math.round(reach)}`);

  // 5. And the captain has to have been offered a game before the galaxy's war comes to collect them.
  //    This is what a calendar floor was standing in for, done honestly: a count of chances the game
  //    put in front of the player — systems it showed them, work it offered, word it sent — never a
  //    count of what they made of those chances. A captain who takes none of it is protected exactly as
  //    much as one who takes all of it, and a captain who spends four hundred days crossing empty space
  //    accumulates almost nothing, because travel is not an opportunity.
  //    Every count comes from the engine's view and is a thing only the player does, which cannot
  //    happen mid-jump, so a snapshot of them is right and a jump decides as the same days stepped do.
  //    Nothing the campaign itself increments is counted: station missions, for instance, are offered
  //    by the engine in reaction to a day's effects, which lands before the next day when stepping and
  //    after all of them when jumping, so counting them would make the same sixteen days decide
  //    differently depending on how they were advanced. (The mission counter is kept as evidence.)
  const chances = world.playerOpportunity || null;
  const beats = c.dominionPlayerBeats || {};
  const progress = chances
    ? Object.keys(beats).map((k) => ({ beat: k, has: Number(chances[k]) || 0, needs: beats[k] }))
    : null;
  const metBeats = progress ? progress.filter((x) => x.has >= x.needs) : null;
  const played = progress == null || metBeats.length >= (c.dominionMinPlayerCategories || 0);
  if (!played) {
    reasons.push(`the captain has had ${metBeats.length} of ${c.dominionMinPlayerCategories} kinds of chance: `
      + progress.map((x) => `${x.beat} ${x.has}/${x.needs}`).join(', '));
  }

  return { open: Boolean(foughtEnough && weakened.length && strained.length && challengeable && balance && corridorOpen && played),
    day, engagements, balance, corridorOpen, recovered, challengeable, frontStalled,
    played, beats: progress, beatsMet: metBeats ? metBeats.length : null, strained: strained.map((x) => ({ id: x.id, what: x.worst.what, share: Number(x.worst.share.toFixed(3)) })),
    strongestNear: Math.round(strongestNear), strengthGap: Number(gap.toFixed(3)),
    entrySystem, entryDefence: entryDefence === Infinity ? null : Math.round(entryDefence),
    expeditionReach: Math.round(reach), expeditionTarget: Math.round(target),
    playerCounts, playerShare: Number(playerShare.toFixed(3)),
    defenders: defenders.map((x) => ({ id: x.id, share: x.share == null ? null : Number(x.share.toFixed(3)) })),
    reasons };
}

function advanceDominion(book, world, day, effects) {
  const c = book.config, d = book.dominion;
  const entry = world.wormholes.find((w) => w.id === 'bajora-dominica-wormhole');
  if (!entry) return;
  d.entrySystem ??= entry.from; d.stagingSystem ??= entry.to;
  const dominion = polity(book, 'dominion');
  const warn = (id, text, systemIndex) => { if (d.warnings.some((w) => w.id === id)) return; d.warnings.push({ id, day, text, systemIndex }); effects.push({ type: 'dominionWarning', id, text, systemIndex, day }); };
  // The stages are events, not dates. Each one opens when the strategic condition behind it holds, and
  // stalls — it does not expire, and it is not forced through — while it does not. [17SEP spec §3.1]
  //
  // And each one has to reach the captain separately. A single long warp settles sixty campaign days in
  // one call, which is how missing patrols, staging signatures and the crossing itself all arrived in
  // the same mid-jump briefing with nothing the player could do between them. A phase may become
  // eligible at any point during that jump, but only one may commit per beat — a journey when the
  // engine is running one, otherwise the day itself, which keeps stepped and bulk advancement
  // identical. The rest wait for the next beat, so every stage costs the captain a journey and can be
  // answered before the next arrives.
  const beat = world.journeyId != null ? `journey:${world.journeyId}` : `day:${day}`;
  // Re-read after every commit, not once for the day: a constant captured before the first transition
  // would let all three cascade inside the same call, which is the whole defect this exists to close.
  const beatFree = () => !c.dominionPhaseBeatsApart || d.lastPhaseBeat !== beat;
  const commitPhase = (to) => { d.phase = to; d.phaseDay = day; d.lastPhaseBeat = beat; };
  const opportunity = dominionOpportunity(book, world, day);
  const windowDays = Math.max(1, c.dominionOpeningWindowDays || 1);
  d.openWindow = `${d.openWindow || ''}${opportunity.open ? '1' : '0'}`.slice(-windowDays);
  const eligibleDays = (d.openWindow.match(/1/g) || []).length;
  // Nothing about the decision is persisted beyond what the arc itself needs. An earlier version kept a
  // `lastOpportunity` record here for diagnostics, including the maturity progress, and that made the
  // book differ between forty one-day journeys and one forty-day journey — the counts are per journey,
  // so they legitimately differ, and persisting them put a player-facing pacing detail inside a digest
  // that is supposed to depend only on which days were settled. dominionOpportunity() is pure and cheap;
  // anything that wants to show the current reasons calls it rather than reading a stored copy.
  // An opening has to hold. A war's numbers move every day and one of those days will always happen to
  // clear every line at once; that is a coincidence, not an opportunity, and the expedition does not
  // sail on it. Consecutive days would be the wrong test — one good day for one belligerent would reset
  // it — but so is a lifetime counter that gains more than it loses, because that grows on any
  // condition true more than a third of the time and so a case that merely wobbles around the line
  // reaches any threshold if you wait. This is a bounded rolling window of the last
  // `dominionOpeningWindowDays` days, of which `dominionOpeningSustainDays` must have been eligible.
  // Alternating gives exactly half the window and half is not enough; only a case that holds most days
  // of a season unlocks the arc, and a near side that recovers walks the count back down as the good
  // days age out.
  if (d.phase === 'dormant' && beatFree() && opportunity.open && eligibleDays >= (c.dominionOpeningSustainDays || 0)) {
    commitPhase('reconnaissance'); d.openedDay = day;
    addHistory(book, day, 'dominion', `An opening on the near side: ${opportunity.balance === 'stalemate' ? 'a costly stalemate' : 'a weakened victor'} after ${opportunity.engagements} engagements.`);
    warn('missing-patrols', `Patrols near ${world.systems[d.entrySystem]?.name} have stopped reporting on schedule.`, d.entrySystem);
    // real reconnaissance: two hulls staged at the far terminus
    for (let i = 0; i < 2; i++) addHull(book, world, 'dominion', d.stagingSystem, `recon:${i}`);
    addHistory(book, day, 'dominion', 'Dominion reconnaissance phase began.');
  }
  // Reconnaissance dwells, then stages — but only while the opening is still there. A near side that
  // recovers, or a corridor somebody closes, stalls the arc where it stands.
  // Once the arc has opened it continues on its own dwells. What stops it is not the opening flickering
  // — a war's numbers move every day — but one of the two things a defender can actually do: hold the
  // corridor, or put the near side back on its feet. Either stands the expedition down where it is.
  if ((d.phase === 'reconnaissance' || d.phase === 'staging')
    && (opportunity.recovered || !opportunity.corridorOpen || !opportunity.challengeable)) {
    const why = opportunity.recovered ? 'the near side has recovered'
      : !opportunity.corridorOpen ? 'the corridor is held against it'
      : `the near side now fields ${opportunity.strongestNear} against it`;
    addHistory(book, day, 'dominion', `The Dominion expedition stands down: ${why}.`);
    effects.push({ type: 'dominionStandDown', day, from: d.phase, reason: why });
    d.phase = 'dormant'; d.phaseDay = day; d.standDownDay = day;
  }
  if (d.phase === 'reconnaissance' && beatFree() && day - (d.phaseDay ?? day) >= c.dominionReconDwellDays) {
    commitPhase('staging');
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
  if (d.phase === 'staging' && beatFree() && day - (d.phaseDay ?? day) >= c.dominionStagingDwellDays) {
    // There has to be an expedition to send and a door to send it through. Whether the near side can be
    // challenged at all was settled when the opening was taken, and it is re-tested every day since
    // through the stand-down above, so re-testing it here as well could only deadlock a staged force
    // that the opening already judged worth staging. There is no deadline that sends it anyway: a
    // corridor closed while it staged is a crossing that never happens.
    const staged = dominion.hulls.filter((h) => h.status === 'ready' && h.systemIndex === d.stagingSystem);
    // The invasion plan says, explicitly, who the opening attacks. The corridor is forced only against a
    // holder on the authored list; an unheld terminus is occupied unopposed; a holder off the list (a pact
    // partner) is not attacked and the crossing waits. Holding the entry world is never itself a war.
    const holder = world.systems[d.entrySystem]?.controller ?? null;
    const holderAtWar = holder != null && holder !== 'dominion' && formallyAtWar(world, 'dominion', holder);
    const forced = holder != null && holder !== 'dominion' && (c.dominionCorridorTargets || []).includes(holder)
      && world.relation('dominion', relSide(world, holder)) !== 'allied';
    // A corridor a pact partner holds is not forced: the expedition crosses into the partner's world under
    // the pact, unopposed, and declares on no one for it.
    const partnerCorridor = holder != null && holder !== 'dominion' && !holderAtWar && world.relation('dominion', relSide(world, holder)) === 'allied';
    const passable = holder == null || holder === 'dominion' || holderAtWar || forced || partnerCorridor;
    if (staged.length > 0 && opportunity.corridorOpen && !passable && d.corridorHeldBy !== holder) {
      d.corridorHeldBy = holder;
      addHistory(book, day, 'dominion', `The crossing waits: ${world.systems[d.entrySystem]?.name} is held by ${world.factionName(holder)}, which the invasion plan does not attack.`);
    }
    if (staged.length > 0 && opportunity.corridorOpen && passable) {
      commitPhase('invasion');
      const warTargets = [...new Set([...(forced && !holderAtWar ? [holder] : []),
        ...(c.dominionOpeningAlsoDeclare || []).filter((x) => (x === 'player' || book.polities[x]) && !formallyAtWar(world, 'dominion', x))])];
      const pacts = (c.dominionPactPartners || []).filter((x) => book.polities[x] && world.relation('dominion', relSide(world, x)) === 'allied');
      d.plan = { day, objective: Number(d.entrySystem), holder, warTargets, pacts, partnerCorridor,
        reason: forced ? `forcing the ${entry.name || 'Bajoran Wormhole'} at ${world.systems[d.entrySystem]?.name}`
          : partnerCorridor ? `an unopposed crossing into ${world.factionName(holder)}-held ${world.systems[d.entrySystem]?.name} under the pact`
          : 'an unopposed crossing' };
      for (const x of warTargets) declareFormalWar(book, world, 'dominion', x, day, effects, { reason: x === holder ? d.plan.reason : 'the invasion plan', source: 'authored', by: 'dominion' });
      if (partnerCorridor) {
        // No assault: the staged force comes through and stands at the partner's terminus.
        for (const h of staged) h.systemIndex = Number(d.entrySystem);
        d.expeditionOpId = null;
      } else {
        const op = launchOperation(book, world, 'dominion', staged, d.entrySystem, day, 1, 'invasion', effects);
        d.expeditionOpId = op.id;
      }
      warn('invasion', `A Dominion expedition is transiting the ${entry.name || 'Bajoran Wormhole'} toward ${world.systems[d.entrySystem]?.name}.`, d.entrySystem);
      addHistory(book, day, 'dominion', 'Dominion invasion launched through the Bajoran wormhole.');
    }
  }
  if (d.phase === 'invasion') {
    // Is the expedition still sustainable, and is the wormhole still open to it? Either failing is an
    // authored ending: Central orders the withdrawal, and every war it is fighting ends through the
    // ordinary bilateral transition. [DOMINION-FORMAL-WAR-RULES §6]
    const exp = expeditionAssessment(book, world, 'dominion');
    if (exp) d.expeditionPeak = Math.max(Number(d.expeditionPeak) || 0, exp.strength);
    const entryHolder = world.systems[d.entrySystem]?.controller ?? null;
    const denied = entryHolder != null && entryHolder !== 'dominion' && formallyAtWar(world, 'dominion', entryHolder) && d.reinforcementCut;
    d.accessDeniedSince = denied ? (d.accessDeniedSince ?? day) : null;
    const deniedFor = denied ? day - d.accessDeniedSince : 0;
    const why = exp?.unsustainable ? `the expedition can no longer sustain the war (${exp.reasons.join('; ')})`
      : deniedFor >= (c.dominionAccessDeniedDays ?? 60) ? `the wormhole has been held against it for ${deniedFor} days`
      : null;
    // The fighting in hand is decided first: a withdrawal is ordered between operations, never in the
    // middle of one, so an assault that is under way ends by its own result.
    const inFlight = book.operations.some((o) => o.faction === 'dominion' && o.status !== 'resolved');
    if (why && !inFlight && beatFree()) {
      d.lastPhaseBeat = beat;
      withdrawExpedition(book, world, day, effects, { reason: why, basis: 'withdrawal' });
      return;
    }
    // Reinforcement convoys through the wormhole unless the entry is interdicted by real defences.
    const entryFriendly = entryHolder === 'dominion' || (entryHolder != null && world.relation('dominion', relSide(world, entryHolder)) === 'allied');
    const blockaded = localDefenseStrength(book, world, d.entrySystem) >= c.dominionBlockadeStrength && !entryFriendly;
    d.reinforcementCut = blockaded;
    if (!blockaded && d.convoys < c.dominionMaxConvoys && (d.lastConvoyDay == null || day - d.lastConvoyDay >= c.dominionReinforcementEveryDays)) {
      d.lastConvoyDay = day; d.convoys++;
      const bridgehead = entryFriendly ? d.entrySystem : d.stagingSystem;
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
    if (liveRecoveries(book).length >= book.config.maxLiveRecoveries) {
      addHistory(book, day, 'recovery', `Sole vendor for design ${shipId} lost at ${stationId}; no recovery team is free to take the contract.`, { shipId: Number(shipId), systemIndex });
      continue;
    }
    const kinds = ['engineers', 'archive', 'broker'];
    const kind = kinds[Math.floor(seededUnit(book.seed, 'recovery', shipId, stationId) * 2)]; // engineers or archive first; broker is the last resort
    const r = { id: nextCampaignId(book, 'recovery'), shipId: Number(shipId), lostStationId: stationId, systemIndex, kind, status: 'available', createdDay: day, completedDay: null, relocatedTo: null, attempts: 0 };
    book.recoveries.push(r);
    trimRecoveries(book);
    effects.push({ type: 'recoveryOffered', recoveryId: r.id, shipId: r.shipId, kind, systemIndex, day });
    addHistory(book, day, 'recovery', `Sole vendor for design ${shipId} lost at ${stationId}; ${kind} recovery contract available.`, { shipId: Number(shipId), systemIndex });
  }
}
function liveRecoveries(book) { return book.recoveries.filter((r) => r.status === 'available' || r.status === 'active'); }
// Terminal records are archived, never the open ones: the stated bound is on contracts a player can
// still act on, and it is enforced where they are created.
function trimRecoveries(book) {
  const live = liveRecoveries(book);
  const done = book.recoveries.filter((r) => !live.includes(r));
  const keep = Math.max(0, book.config.maxLiveRecoveries - live.length);
  // slice(-0) is the whole array, not none of it, so an exhausted budget has to be handled explicitly.
  if (done.length > keep) book.recoveries = live.concat(keep > 0 ? done.slice(-keep) : []);
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
  // A recovery pursued through a mission that has since expired, failed or vanished returns to the
  // offer pool with its lapse clock still running. Without this the design stays lost for ever and the
  // contract stays 'active' with nothing working on it.
  for (const r of book.recoveries) {
    if (r.status !== 'active' || !r.missionId) continue;
    const m = book.missions.find((x) => x.id === r.missionId);
    if (m && ['offered', 'active'].includes(m.status)) continue;
    if (m && m.status === 'completed') continue;
    r.status = 'available'; r.missionId = null; r.attempts = (r.attempts || 0) + 1;
    effects.push({ type: 'recoveryReleased', recoveryId: r.id, shipId: r.shipId, kind: r.kind, systemIndex: r.systemIndex, day });
    addHistory(book, day, 'recovery', `The recovery attempt for design ${r.shipId} lapsed; the contract is open again.`, { shipId: r.shipId, systemIndex: r.systemIndex });
  }
  for (const r of book.recoveries.slice()) {
    if (r.status !== 'available' || day - r.createdDay <= book.config.recoveryOfferDays) continue;
    r.status = 'failed';
    if (r.kind === 'broker' || book.recoveries.some((x) => x.shipId === r.shipId && x.kind === 'broker')) continue;
    if (liveRecoveries(book).length >= book.config.maxLiveRecoveries) continue;
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
export function liveMissions(book) { return book.missions.filter((m) => ['offered', 'active'].includes(m.status)); }
// A caller may bring its own id. The engine does, because it offers contracts BETWEEN the days the
// model settles: taking them from the model's counter made the strategic book's ids depend on how many
// days a call happened to settle, and anything seeded from an id then diverged between a jump and a
// walk. [fifth review]
export function offerMission(book, mission, day) {
  if (book.missions.some((m) => m.key === mission.key && ['offered', 'active'].includes(m.status))) return null; // one open contract per key; finished ones may recur
  if (liveMissions(book).length >= book.config.maxLiveMissions) return null;
  const m = { id: mission.id || nextCampaignId(book, 'mission'), status: 'offered', offeredDay: day, acceptedDay: null, completedDay: null, reason: null, ...mission };
  book.missions.push(m);
  // The mission list is trimmed, so the count of chances offered is kept separately: it is evidence
  // that the captain was given a game to play, and trimming must not quietly erase that.
  book.stats.missionsOffered = (book.stats.missionsOffered || 0) + 1;
  const live = liveMissions(book);
  const done = book.missions.filter((x) => !live.includes(x));
  const keep = Math.max(0, book.config.maxLiveMissions - live.length);
  if (done.length > keep) book.missions = live.concat(keep > 0 ? done.slice(-keep) : []);
  return m;
}
export function acceptMission(book, id, day) { const m = book.missions.find((x) => x.id === id); if (!m || m.status !== 'offered') return false; m.status = 'active'; m.acceptedDay = day; return true; }
export function completeMission(book, id, day, reason = 'objective met') { const m = book.missions.find((x) => x.id === id); if (!m || m.status !== 'active') return null; m.status = 'completed'; m.completedDay = day; m.reason = reason; return m; }
export function failMission(book, id, day, reason) { const m = book.missions.find((x) => x.id === id); if (!m || !['offered', 'active'].includes(m.status)) return null; m.status = 'failed'; m.completedDay = day; m.reason = reason; return m; }
// ---------- war termination (BILATERAL-WAR-PEACE-RULES §3–§5) ----------
// Every pair at war or in ceasefire whose parties are both strategic polities is evaluated once a day.
// The evaluation is several conditions at once (war-termination.mjs); none of them is a date. A war
// between two AI powers ends when it is eligible; a war the player's empire is party to produces an
// offer the captain answers. Either way the transition goes through one path that stands down the
// pair's operations, closes war-only contracts and applies the territorial terms.
// Dominion Central and the Blender Remnant keep out of the bilateral system while nothing formal exists
// between them and the other party: static hostility is not a war. A pair of theirs with an explicit
// formal record (an authored declaration, an escalation, an independent declaration, a binding) is
// evaluated like any other. [DOMINION-FORMAL-WAR-RULES §1]
const LOCKED_WAR_PARTIES = Object.freeze(['dominion', 'dominion_remnant']);
// Parties that can be bound to follow another's wars: the captain's empire (to its government) and the
// Remnant (to Central, once subordinated). An inherited record follows its government's transitions.
function isLockedParty(id) { return LOCKED_WAR_PARTIES.includes(id); }
// Pairs the model should consider: { a, b, status, warId, warStarted, inheritedFrom, formal }. The engine
// supplies them from the diplomacy book (every one of them a formal record); a world without an engine
// is read through its relation function. Wars the model itself declared in this call are included until
// the engine has recorded them, so a jump and a step see the same wars.
function warPairsInView(book, world, includeSettled = false) {
  const statuses = includeSettled ? ['war', 'ceasefire', 'peace', 'crisis'] : ['war', 'ceasefire'];
  let out;
  if (typeof world.warPairs === 'function') out = world.warPairs().filter((p) => statuses.includes(p.status)).map((p) => ({ ...p, formal: p.formal !== false }));
  else {
    const ids = Object.keys(book.polities).filter((id) => id !== 'player' && !isLockedParty(id)).sort();
    out = [];
    for (let i = 0; i < ids.length; i++) for (let j = i + 1; j < ids.length; j++) {
      const status = world.relation(ids[i], ids[j]);
      if (statuses.includes(status)) out.push({ a: ids[i], b: ids[j], status, warId: 'static', warStarted: null, formal: false });
    }
  }
  const seen = new Set(out.map((p) => warKey(p.a, p.b)));
  for (const st of Object.values(book.warStates || {})) {
    if (!st.declared || seen.has(st.key) || !statuses.includes(st.status)) continue;
    out.push({ a: st.a, b: st.b, status: st.status, warId: st.warId, warStarted: st.startedDay, inheritedFrom: st.declared.inheritedFrom || null, formal: true });
  }
  return out;
}
function ledgerSnapshot(book, a, b) {
  const w = warHistory(book, a, b) || { engagements: 0, losses: {}, captures: {} };
  return { engagements: w.engagements || 0, losses: { [a]: w.losses?.[a] || 0, [b]: w.losses?.[b] || 0 }, captures: { [a]: w.captures?.[a] || 0, [b]: w.captures?.[b] || 0 } };
}
function openWarInstance(book, world, pair, day) {
  const key = warKey(pair.a, pair.b);
  const [a, b] = key.split(':');
  book.warStates ||= {};
  const prior = book.warStates[key];
  const st = {
    key, a, b, warId: pair.warId || 'static', instance: (prior?.instance || 0) + 1,
    status: 'war', startedDay: pair.warStarted ?? day, statusSince: pair.warStarted ?? day,
    baseline: {
      day, ledger: ledgerSnapshot(book, a, b),
      worlds: { [a]: controlled(world, a).length, [b]: controlled(world, b).length },
      hulls: { [a]: livingHulls(polity(book, a)).length, [b]: livingHulls(polity(book, b)).length },
      // An expeditionary side is judged by its ground on this side of the wormhole, not its home realm.
      bridgeheads: Object.fromEntries([a, b].map((id) => [id, expeditionAssessment(book, world, id)?.bridgeheads ?? null]).filter(([, n]) => n != null)),
    },
    offer: null, offerCooldownUntil: 0, settlement: null, lastEval: null,
    previous: prior?.settlement ? { warId: prior.warId, settlement: prior.settlement } : (prior?.previous || null),
  };
  book.warStates[key] = st;
  return st;
}
function warSides(book, world, st) {
  const c = book.config;
  const ledger = ledgerSnapshot(book, st.a, st.b);
  const out = {};
  for (const [id, other] of [[st.a, st.b], [st.b, st.a]]) {
    const p = polity(book, id);
    const strength = polityReadiness(book, world, id).strength;
    const capacity = Math.max(Number(p.readinessBaseline) || 0, Number(p.readinessPeak) || 0);
    const bits = [];
    if ((p.revenuePeak || 0) > 0) bits.push((p.revenueLastDay || 0) / p.revenuePeak);
    // Treasury is not counted: a war chest spent is what a war chest is for, and a power drawing on it is
    // not thereby unable to fight. Revenue and yards are what it cannot replace.
    if ((p.berthsPeak || 0) > 0) bits.push(polityProduction(book, world, id).berths / p.berthsPeak);
    const homeName = c.homeWorlds?.[id] || null;
    const home = homeName ? world.systems.find((s) => s.name === homeName) : null;
    const worldsLost = Object.values(book.territory || {}).filter((t) => t.status === 'occupied' && t.claimant === id && t.holder === other && t.day >= st.startedDay).length;
    out[id] = {
      name: world.factionName(id), strength, capacity, capShare: capacity > 0 ? strength / capacity : null,
      strain: bits.length ? Math.min(...bits) : null,
      worldsNow: controlled(world, id).length, worldsAtStart: st.baseline.worlds[id] || 0, worldsLost,
      // Taken by THIS enemy: a home world lost to a third power is not this war's decision.
      homeLost: Boolean(home && home.controller === other), homeName: home?.name || null,
      losses: (ledger.losses[id] || 0) - (st.baseline.ledger.losses[id] || 0),
    };
    // Expeditionary mode: the side's strength, capacity and ground are the expedition's; its home realm
    // is out of reach and cannot be lost, and what decides it is whether the expedition can go on.
    const exp = expeditionAssessment(book, world, id);
    if (exp && exp.active) Object.assign(out[id], {
      strength: exp.strength, capacity: exp.capacity, capShare: exp.share, strain: null,
      worldsNow: exp.bridgeheads, worldsAtStart: st.baseline.bridgeheads?.[id] ?? 0, homeLost: false, homeName: null,
      expedition: { unsustainable: exp.unsustainable, reasons: exp.reasons },
    });
  }
  return out;
}
function warFrontDay(book, st) {
  const front = (warHistory(book, st.a, st.b)?.front || []).filter((f) => f.day >= st.startedDay);
  return front.length ? front[front.length - 1].day : st.startedDay;
}
// Occupied worlds between the pair, with whether each is the claimant's own people.
function pairOccupations(book, world, st) {
  return Object.entries(book.territory || {})
    .filter(([, t]) => t.status === 'occupied' && [st.a, st.b].includes(t.holder) && [st.a, st.b].includes(t.claimant) && t.holder !== t.claimant)
    .filter(([i, t]) => world.systems[Number(i)]?.controller === t.holder)
    .map(([i, t]) => ({ systemIndex: Number(i), holder: t.holder, claimant: t.claimant, claimantPeople: world.systems[Number(i)]?.origin === factionOf(world, t.claimant) }));
}
export function evaluateWars(book, world, day, effects) {
  if (book.config.warTermination === false) return;
  const rules = { ...WAR_RULES, ...(book.config.warRules || {}) };
  book.warStates ||= {};
  for (const pair of warPairsInView(book, world)) {
    if ((isLockedParty(pair.a) || isLockedParty(pair.b)) && !pair.formal) continue;
    if (!book.polities[pair.a] || !book.polities[pair.b]) continue;
    // An inherited war is its government's war: it follows that war's ceasefire and settlement and is
    // not evaluated (or offered) on its own. A war the empire made its own carries no inheritance.
    if (pair.inheritedFrom) continue;
    const key = warKey(pair.a, pair.b);
    let st = book.warStates[key];
    if (!st || (st.warId !== (pair.warId || 'static')) || (st.status === 'peace')) {
      if (st && st.warId === (pair.warId || 'static') && st.status === 'peace') continue; // settled; the engine has not caught up
      st = openWarInstance(book, world, pair, day);
    }
    if (pair.status === 'ceasefire' && st.status === 'war') { st.status = 'ceasefire'; st.statusSince = day; }
    // An offer to the captain lapses unanswered.
    if (st.offer && day > st.offer.expires) {
      effects.push({ type: 'warOfferLapsed', key, offerId: st.offer.id, day });
      st.offer = null; st.offerCooldownUntil = day + rules.offerCooldownDays;
    }
    if (st.offer) continue;
    const sides = warSides(book, world, st);
    const ledger = ledgerSnapshot(book, st.a, st.b);
    const verdict = evaluateWar(st.a, st.b, sides, {
      age: day - st.startedDay, daysSinceFront: day - warFrontDay(book, st),
      engagements: ledger.engagements - st.baseline.ledger.engagements, status: st.status,
      ceasefireDays: st.status === 'ceasefire' ? day - st.statusSince : 0, quietSinceCeasefire: st.status === 'ceasefire',
    }, rules);
    st.lastEval = { day, outcome: verdict.outcome, basis: verdict.basis || null, reasons: verdict.reasons || [], sides: Object.fromEntries(Object.entries(sides).map(([id, x]) => [id, { strength: Math.round(x.strength), capShare: x.capShare == null ? null : Math.round(x.capShare * 100) / 100, strain: x.strain == null ? null : Math.round(x.strain * 100) / 100, worldsLost: x.worldsLost, losses: x.losses }])) };
    if (verdict.outcome === 'continue') continue;
    const terms = verdict.outcome === 'peace'
      ? settlementTerms(verdict.basis, verdict.winner, pairOccupations(book, world, st), Object.fromEntries(Object.entries(sides).map(([id, x]) => [id, x.strength])))
      : [];
    const transition = { to: verdict.outcome, basis: verdict.basis, winner: verdict.winner || null, loser: verdict.loser || null, reason: verdict.reason, terms };
    if (st.a === 'player' || st.b === 'player') {
      if (day < (st.offerCooldownUntil || 0)) continue;
      const from = st.a === 'player' ? st.b : st.a;
      st.offer = { id: nextCampaignId(book, 'offer'), from, ...transition, day, expires: day + rules.offerExpiryDays };
      addHistory(book, day, 'offer', `${world.factionName(from)} offers ${transition.to === 'ceasefire' ? 'a ceasefire' : 'peace'}: ${transition.reason}.`, { key });
      effects.push({ type: 'warOffer', key, a: st.a, b: st.b, from, offerId: st.offer.id, ...transition, day, expires: st.offer.expires });
      continue;
    }
    applyWarTransitionInModel(book, world, st, transition, day, effects);
  }
}
// The one path every ceasefire and settlement takes, whoever proposed it.
function applyWarTransitionInModel(book, world, st, t, day, effects, source = 'evaluation') {
  st.status = t.to; st.statusSince = day; st.offer = null;
  const closed = closePairOperations(book, world, st.a, st.b, day, effects, t.to);
  const applied = [];
  if (t.to === 'peace') {
    for (const term of t.terms || []) {
      const i = term.systemIndex;
      const status = term.term === 'returned_to_previous_controller' ? 'returned' : term.term === 'disputed' ? 'disputed' : 'retained';
      book.territory[i] = { status, holder: status === 'returned' ? term.claimant : term.holder, claimant: status === 'retained' ? null : term.claimant, warKey: st.key, day, term: term.term };
      if (status === 'returned') {
        delete book.occupations[i];
        const sys = world.systems[i];
        if (sys) sys.controller = term.claimant;
        effects.push({ type: 'territoryReturned', systemIndex: i, to: term.claimant, from: term.holder, key: st.key, day });
      }
      applied.push({ ...term, status });
    }
    st.settlement = { day, basis: t.basis, winner: t.winner, loser: t.loser, reason: t.reason, terms: applied, source };
    // The first settlement of the opening war is what the Dominion reads; later wars keep their own.
    const [wa, wb] = book.config.centralWar || [];
    if (wa && wb && warKey(wa, wb) === st.key) { book.resolutions ||= {}; book.resolutions[`${wa}:${wb}`] ||= { day, loser: t.loser, winner: t.winner, reason: t.reason, basis: t.basis }; }
    addHistory(book, day, 'resolution', `The ${world.factionName(st.a)}–${world.factionName(st.b)} war ends: ${t.reason}.`, { key: st.key, loser: t.loser, winner: t.winner, basis: t.basis });
  } else {
    st.ceasefireDay = day;
    addHistory(book, day, 'ceasefire', `Ceasefire between ${world.factionName(st.a)} and ${world.factionName(st.b)}: ${t.reason}.`, { key: st.key, basis: t.basis });
  }
  if (world.shadow) world.shadow.relations.set(`${relSide(world, st.a)}:${relSide(world, st.b)}`, t.to);
  // A war the captain's empire inherited from one of these parties follows it: the officer's empire
  // was fighting the government's war, and the government's settlement binds it, with the same
  // cleanup. A war the empire made its own (an incident, a seizure) has no inheritance and is not
  // touched; nor is anything the captain does afterwards, which is an incident like any other.
  const bound = [];
  if (source !== 'inherited') {
    for (const [side, other] of [[st.a, st.b], [st.b, st.a]]) {
      for (const inherited of warPairsInView(book, world).filter((p) => p.inheritedFrom === side && [p.a, p.b].includes(other) && ['war', 'ceasefire'].includes(p.status))) {
        const follower = inherited.a === other ? inherited.b : inherited.a;
        if (follower === side || !book.polities[follower]) continue;
        if (inherited.status === t.to) continue;
        const pkey = warKey(follower, other);
        let pst = book.warStates[pkey];
        if (!pst || pst.warId !== (inherited.warId || 'static') || pst.status === 'peace') pst = openWarInstance(book, world, inherited, day);
        // The follower's ground follows its government's settlement: on the winning side of a decisive
        // peace it keeps what it took, on the losing side it gives it back; a negotiated peace is negotiated.
        const imposed = t.basis === 'decisive' || t.basis === 'withdrawal';
        const pwinner = imposed ? (t.winner === side ? follower : other) : null;
        const pterms = t.to === 'peace'
          ? settlementTerms(imposed ? 'decisive' : 'settlement', pwinner, pairOccupations(book, world, pst), Object.fromEntries([pst.a, pst.b].map((id) => [id, polityReadiness(book, world, id).strength])))
          : [];
        const whom = follower === 'player' ? 'your empire' : world.factionName(follower);
        applyWarTransitionInModel(book, world, pst, { to: t.to, basis: 'co-belligerent', winner: pwinner, loser: pwinner ? (pwinner === follower ? other : follower) : null,
          reason: `the ${world.factionName(side)}–${world.factionName(other)} ${t.to === 'ceasefire' ? 'ceasefire' : 'settlement'} binds ${whom}`, terms: pterms, parentKey: st.key }, day, effects, 'inherited');
        bound.push(pkey);
      }
    }
  }
  effects.push({ type: t.to === 'peace' ? 'warResolved' : 'warCeasefire', key: st.key, a: st.a, b: st.b, warId: st.warId, to: t.to, basis: t.basis, winner: t.winner, loser: t.loser, reason: t.reason, terms: applied, standDown: closed, source, parentKey: t.parentKey || null, alsoBinds: bound, day });
}
// Operations between the pair stand down the same day, in any phase, in both directions. A battle the
// loaded scene owns is marked and stood down when the scene releases it. Escort and blockade contracts
// whose only threat was one of these operations fail with the reason.
function closePairOperations(book, world, a, b, day, effects, to) {
  const closed = [];
  const party = new Set([a, b]);
  for (const op of book.operations) {
    if (op.status === 'resolved' || !party.has(op.faction)) continue;
    const other = op.faction === a ? b : a;
    const owner = world.systems[op.targetSystem]?.controller ?? null;
    if (owner !== other && op.defender !== other) continue;
    if (op.resolvedBy === 'local') { op.standDownPending = true; closed.push({ opId: op.id, pending: true }); continue; }
    op.standDownPending = false;
    finishOperation(book, world, op, day, 'stood-down', effects, 'diplomacy',
      `${world.factionName(op.faction)} called off the operation at ${world.systems[op.targetSystem]?.name || `system ${op.targetSystem}`}: ${to === 'ceasefire' ? 'ceasefire' : 'peace'} with ${world.factionName(other)}.`);
    closed.push({ opId: op.id, targetSystem: op.targetSystem });
  }
  for (const c of closed) {
    if (c.pending || c.targetSystem == null) continue;
    const stillThreatened = book.operations.some((o) => o.status !== 'resolved' && o.targetSystem === c.targetSystem);
    if (stillThreatened) continue;
    for (const m of book.missions) if (['offered', 'active'].includes(m.status) && ['escort', 'blockade'].includes(m.kind) && Number(m.systemIndex) === Number(c.targetSystem)) {
      m.status = 'failed'; m.completedDay = day; m.reason = `${to === 'ceasefire' ? 'ceasefire' : 'peace'}: the operation it answered was called off`;
      effects.push({ type: 'missionClosed', missionId: m.id, reason: m.reason, day });
    }
  }
  return closed;
}
// The captain answers an offer. Accepting runs the same transition; refusing keeps the war, costs
// standing with the offering power (applied by the engine) and blocks a new offer for a while.
export function answerWarOffer(book, world, key, accept, day) {
  const st = book.warStates?.[key];
  if (!st?.offer) return { ok: false, reason: 'No offer is open.', effects: [] };
  const offer = st.offer;
  const effects = [];
  if (!accept) {
    st.offer = null; st.offerCooldownUntil = day + (book.config.warRules?.offerCooldownDays ?? WAR_RULES.offerCooldownDays);
    addHistory(book, day, 'offer', `The offer of ${offer.to === 'ceasefire' ? 'a ceasefire' : 'peace'} from ${world.factionName(offer.from)} was refused.`, { key });
    return { ok: true, refused: true, offer, effects };
  }
  // Terms are recomputed against the world as it stands: an offer's list is what was known when it
  // was made, and a world that changed hands since must not be returned to the wrong party.
  const terms = offer.to === 'peace'
    ? settlementTerms(offer.basis, offer.winner, pairOccupations(book, world, st), Object.fromEntries([st.a, st.b].map((id) => [id, polityReadiness(book, world, id).strength])))
    : [];
  applyWarTransitionInModel(book, world, st, { ...offer, terms }, day, effects, 'accepted');
  return { ok: true, accepted: true, offer, effects };
}
// A transition decided outside the evaluator (debug, an authored story beat) still takes the same path.
export function forceWarTransition(book, world, a, b, to, day, reason = 'Directed settlement', basis = 'directed') {
  const key = warKey(a, b);
  const pair = warPairsInView(book, world).find((p) => warKey(p.a, p.b) === key) || { a, b, warId: book.warStates?.[key]?.warId || 'static', warStarted: day };
  let st = book.warStates?.[key];
  if (!st || st.warId !== (pair.warId || 'static') || st.status === 'peace') st = openWarInstance(book, world, pair, day);
  const effects = [];
  const terms = to === 'peace' ? settlementTerms('negotiated', null, pairOccupations(book, world, st), Object.fromEntries([st.a, st.b].map((id) => [id, polityReadiness(book, world, id).strength]))) : [];
  applyWarTransitionInModel(book, world, st, { to, basis, winner: null, loser: null, reason, terms }, day, effects, 'directed');
  return effects;
}
// ---------- formal declarations, expeditions, withdrawal, followers (DOMINION-FORMAL-WAR-RULES) ----------
function formallyAtWar(world, a, b) { return world.relation(relSide(world, a), relSide(world, b)) === 'war'; }
function commandFollowers(book, government) {
  return Object.entries(book.commandBindings || {}).filter(([, b]) => b?.to === government).map(([id]) => id);
}
// A formal war the campaign itself declares: an authored escalation, a deliberate attack, or a follower
// bound to its government's war. The model opens the war instance at once with its own id, and the
// engine records the diplomatic side under the same id, so the two are one war. A follower bound to the
// declaring power is declared with it (inherited, no separate report).
export function declareFormalWar(book, world, a, b, day, effects, opts = {}) {
  const { reason = 'Declared', source = 'authored', by = a, opId = null, inheritedFrom = null, parentKey = null, status = 'war' } = opts;
  const key = warKey(a, b);
  const warId = `${key}#${nextCampaignId(book, 'war')}`;
  const st = openWarInstance(book, world, { a, b, warId, warStarted: day }, day);
  st.status = status; st.statusSince = day;
  st.declared = { day, by, reason, source, inheritedFrom, parentKey };
  if (world.shadow) world.shadow.relations.set(`${relSide(world, st.a)}:${relSide(world, st.b)}`, status);
  const followers = [];
  if (!inheritedFrom) {
    const target = by === a ? b : a;
    for (const f of commandFollowers(book, by)) {
      if (f === target || !book.polities[f] || formallyAtWar(world, f, target)) continue;
      followers.push(f);
    }
  }
  addHistory(book, day, 'declaration', inheritedFrom
    ? `${world.factionName(inheritedFrom === st.a ? st.b : inheritedFrom === st.b ? st.a : a)} is bound to ${world.factionName(inheritedFrom)}'s war: ${reason}.`
    : `${world.factionName(by)} declared war on ${world.factionName(by === a ? b : a)}: ${reason}.`, { key, warId, source });
  effects.push({ type: 'warDeclared', key, a: st.a, b: st.b, warId, by, reason, source, opId, inheritedFrom, parentKey, status, day,
    alsoBinds: followers.map((f) => warKey(f, by === a ? b : a)) });
  for (const f of followers) declareFormalWar(book, world, f, by === a ? b : a, day, effects, { reason: `under ${world.factionName(by)} command`, source: 'inherited', by, inheritedFrom: by, parentKey: key, status });
  return st;
}
// Can this expedition still sustain the war? Pure: reads the book and world as they stand.
export function expeditionAssessment(book, world, id) {
  const spec = book.config.expeditionarySides?.[id];
  if (!spec) return null;
  const wh = (world.wormholes || []).find((w) => w.id === spec.wormhole);
  if (!wh) return null;
  const c = book.config;
  const d = id === 'dominion' ? book.dominion : ((book.expeditions ||= {})[id] ||= {});
  const entry = Number(d.entrySystem ?? wh.from), staging = Number(d.stagingSystem ?? wh.to);
  const near = nearSideSystems(world, entry);
  const p = book.polities[id];
  if (!p) return null;
  const present = livingHulls(p).filter((h) => near.has(Number(h.systemIndex)) || Number(h.systemIndex) === staging);
  const strength = present.reduce((n, h) => n + hullStrength(book, world, h), 0);
  const capacity = Math.max(Number(p.readinessBaseline) || 0, Number(d.expeditionPeak) || 0, strength);
  const share = capacity > 0 ? strength / capacity : null;
  const bridgeheads = (id === 'dominion' ? dominionGround(book, world, near) : controlled(world, id).filter((s) => near.has(Number(s.index))).map((s) => s.index)).length;
  const entryHolder = world.systems[entry]?.controller ?? null;
  const access = entryHolder === id || (entryHolder && world.relation(id, relSide(world, entryHolder)) === 'allied') || !d.reinforcementCut;
  const convoysLeft = Math.max(0, (c.dominionMaxConvoys || 0) - (d.convoys || 0));
  const replace = Boolean(access && convoysLeft > 0);
  const enemies = warPairsInView(book, world).filter((q) => [q.a, q.b].includes(id) && q.status === 'war' && !q.inheritedFrom).map((q) => (q.a === id ? q.b : q.a));
  const partners = (d.plan?.pacts || []).filter((pid) => book.polities[pid] && controlled(world, pid).length > 0
    && enemies.some((e) => formallyAtWar(world, pid, e)));
  const remnant = Object.entries(book.commandBindings || {}).find(([, b]) => b?.to === id)?.[0] || null;
  const blender = Boolean(remnant && book.polities[remnant] && livingHulls(book.polities[remnant]).length > 0);
  const reasons = [];
  if (share != null) reasons.push(`${Math.round(share * 100)}% of its best strength on this side`);
  reasons.push(bridgeheads ? `${bridgeheads} bridgehead${bridgeheads > 1 ? 's' : ''}` : 'no bridgehead');
  reasons.push(access ? 'the wormhole open' : 'the wormhole closed to it');
  reasons.push(replace ? `${convoysLeft} convoy${convoysLeft > 1 ? 's' : ''} still to come` : 'no way to replace losses');
  if (partners.length) reasons.push(`support from ${partners.map((x) => world.factionName(x)).join(', ')}`);
  if (blender) reasons.push('the Blender front under its command');
  const collapsed = share != null && share <= (c.expeditionCollapseShare ?? 0.35) && !replace && !partners.length && !blender;
  const stranded = bridgeheads === 0 && !access && strength <= 0;
  return { id, active: ['invasion'].includes(d.phase) || id !== 'dominion', strength, capacity, share, bridgeheads, access, convoysLeft, replace,
    partners, blender, unsustainable: collapsed || stranded, reasons };
}
// Terms of an authored withdrawal: what the withdrawing side holds of the other's is abandoned (returned)
// unless the authored terms keep or contest it; what the other side took from it stays taken.
function withdrawalTerms(withdrawing, occupied, retain = [], disputed = []) {
  return occupied.map((w) => ({ systemIndex: w.systemIndex, holder: w.holder, claimant: w.claimant,
    term: w.holder !== withdrawing ? 'retained_by_occupier'
      : retain.includes(w.systemIndex) ? 'retained_by_occupier'
      : disputed.includes(w.systemIndex) ? 'disputed' : 'returned_to_previous_controller' }));
}
// withdraw_expedition: an authored ending for Central's wars (all of them, or the `scope` enemies). Each
// war ends through the ordinary transition, as a peace with basis `withdrawal`; the expedition then
// withdraws through the wormhole. Nothing is deleted, and nobody else is touched: an autonomous Remnant
// keeps its own state, a bound one follows through the ordinary follow.
export function withdrawExpedition(book, world, day, effects, opts = {}) {
  const { reason = 'the expedition is withdrawn', basis = 'withdrawal', scope = null, retain = [], disputed = [], id = 'dominion' } = opts;
  const d = id === 'dominion' ? book.dominion : ((book.expeditions ||= {})[id] ||= {});
  const rules = { ...WAR_RULES, ...(book.config.warRules || {}) };
  const wars = warPairsInView(book, world).filter((q) => [q.a, q.b].includes(id) && !q.inheritedFrom && (!scope || scope.includes(q.a === id ? q.b : q.a)));
  const settled = [], offered = [], abandoned = [];
  for (const pair of wars) {
    const key = warKey(pair.a, pair.b);
    let st = book.warStates[key];
    if (st && st.warId === (pair.warId || 'static') && st.status === 'peace') continue;
    if (!st || st.warId !== (pair.warId || 'static')) st = openWarInstance(book, world, pair, day);
    const other = st.a === id ? st.b : st.a;
    const terms = withdrawalTerms(id, pairOccupations(book, world, st), retain, disputed);
    const t = { to: 'peace', basis, winner: other, loser: id, reason, terms };
    if (other === 'player') {
      if (st.offer) continue;
      st.offer = { id: nextCampaignId(book, 'offer'), from: id, ...t, day, expires: day + rules.offerExpiryDays };
      addHistory(book, day, 'offer', `${world.factionName(id)} offers peace: ${reason}.`, { key });
      effects.push({ type: 'warOffer', key, a: st.a, b: st.b, from: id, offerId: st.offer.id, ...t, day, expires: st.offer.expires });
      offered.push(key);
      continue;
    }
    applyWarTransitionInModel(book, world, st, t, day, effects, 'authored');
    for (const term of st.settlement?.terms || []) if (term.status === 'returned' && term.holder === id) {
      abandoned.push(term.systemIndex);
      // Evacuation hook: the world was abandoned under the settlement. Nothing reads it yet.
      if (book.territory[term.systemIndex]) book.territory[term.systemIndex].evacuate = true;
    }
    settled.push(key);
  }
  // Whatever Central still has under way on this side is recalled, and the expedition withdraws to the
  // far terminus. Operations of powers other than Central and assets elsewhere are not touched.
  const ended = scope ? [] : terminateOperations(book, world, id, day, effects, `${world.factionName(id)} recalled its expedition: ${reason}.`);
  const moved = [];
  if (!scope) {
    const entry = Number(d.entrySystem), staging = Number(d.stagingSystem);
    const near = Number.isFinite(entry) ? nearSideSystems(world, entry) : new Set();
    for (const h of livingHulls(polity(book, id))) {
      if (h.status !== 'ready' || h.opId || !near.has(Number(h.systemIndex)) || !Number.isFinite(staging)) continue;
      h.systemIndex = staging; moved.push(h.id);
    }
    d.phase = 'withdrawn'; d.phaseDay = day;
  }
  d.withdrawal = { day, reason, basis, wars: settled, offered, abandoned, recalled: ended.length, moved: moved.length, scope };
  addHistory(book, day, id, `The ${world.factionName(id)} expedition withdraws: ${reason}.`, { basis });
  effects.push({ type: 'expeditionWithdrawn', polityId: id, day, reason, basis, wars: settled, offered, abandoned, moved: moved.length, recalled: ended.length, scope });
  return d.withdrawal;
}
// An authored subordination: `follower` is put under `government`'s command and inherits its current
// wars (and later declarations). One effect; the inherited records publish nothing of their own.
export function subordinateFollower(book, world, follower, government, day, effects, reason = 'returned to central command') {
  book.commandBindings ||= {};
  if (book.commandBindings[follower]?.to === government) return [];
  book.commandBindings[follower] = { to: government, day, reason };
  const joined = [];
  for (const q of warPairsInView(book, world)) {
    if (![q.a, q.b].includes(government) || q.inheritedFrom) continue;
    const other = q.a === government ? q.b : q.a;
    if (other === follower || formallyAtWar(world, follower, other)) continue;
    declareFormalWar(book, world, follower, other, day, effects, { reason: `under ${world.factionName(government)} command`, source: 'inherited', by: government, inheritedFrom: government, parentKey: warKey(q.a, q.b), status: q.status });
    joined.push({ other, status: q.status });
  }
  addHistory(book, day, 'command', `${world.factionName(follower)} ${reason}: now under ${world.factionName(government)} command.`, { follower, government });
  effects.push({ type: 'followerBound', follower, government, day, reason, joined });
  return joined;
}
// A deliberate escalation: Central has ground on this side, nothing left it is at war with inside its
// planning bounds, and force to spare. It attacks the nearest world of a power on the authored list, and
// the declaration and the operation are one step. This is the only way the war spreads.
function dominionEscalate(book, world, day, spare, effects) {
  const c = book.config, d = book.dominion;
  if (d.lastEscalationDay != null && day - d.lastEscalationDay < (c.dominionEscalationEveryDays ?? 30)) return null;
  if (spare.length < 3 || d.entrySystem == null) return null;
  const near = nearSideSystems(world, d.entrySystem);
  const heldNear = dominionGround(book, world, near);
  if (!heldNear.length) return null;
  const list = c.dominionEscalationTargets || [];
  const p = polity(book, 'dominion');
  const commit = bounded(Math.round(spare.length * c.attackCommitFraction), 3, spare.length);
  const chosen = spare.slice(0, commit);
  const strength = chosen.reduce((n, h) => n + hullStrength(book, world, h), 0) * bounded(p.supply, c.supplyFloor, 1);
  const candidates = world.systems
    .filter((sys) => near.has(Number(sys.index)) && sys.controller && sys.controller !== 'dominion' && list.includes(sys.controller)
      && (sys.controller === 'player' || book.polities[sys.controller])
      && !['war', 'allied'].includes(world.relation('dominion', relSide(world, sys.controller))))
    .map((sys) => ({ index: sys.index, controller: sys.controller, hops: world.routeHops(heldNear, sys.index, 'dominion') }))
    .filter((x) => x.hops != null)
    .sort((x, y) => x.hops - y.hops || x.index - y.index);
  const target = candidates.find((x) => strength >= localDefenseStrength(book, world, x.index) * c.minReadinessRatioToAttack);
  if (!target) return null;
  const name = world.systems[target.index]?.name || `system ${target.index}`;
  const st = declareFormalWar(book, world, 'dominion', target.controller, day, effects, { reason: `a deliberate attack on ${name}`, source: 'escalation', by: 'dominion' });
  const op = launchOperation(book, world, 'dominion', chosen, target.index, day, target.hops, 'assault', effects);
  op.declares = st.key; st.declared.opId = op.id;
  d.lastEscalationDay = day;
  return op;
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
// The order book is two things with two bounds. Orders already acknowledged are history, and only the
// newest `maxOrders` of them are kept. An order still waiting for a link is a live command: it is never
// evicted to make room, however many newer orders are created — the book used to be cut to its newest
// forty entries whatever their status, so a queued recall could vanish because forty newer orders were
// written after it. Waiting orders are bounded by refusing a new one beyond `maxQueuedOrders`, never by
// dropping an old one; in play they are bounded long before that, one per ship per kind of order and
// one per formation. [playtest]
function trimOrderHistory(book) {
  const cap = Math.max(0, Number(book.config?.maxOrders ?? CAMPAIGN_RULES.maxOrders) || 0);
  const history = book.orders.filter((o) => o.status !== 'queued');
  if (history.length <= cap) return;
  const drop = new Set(history.slice(0, history.length - cap));
  book.orders = book.orders.filter((o) => !drop.has(o));
}
export function queuedOrderCount(book) {
  return book.orders.filter((o) => o.status === 'queued').length;
}
export function queueDistantOrder(book, order, day, connected) {
  if (!connected && queuedOrderCount(book) >= Number(book.config?.maxQueuedOrders ?? CAMPAIGN_RULES.maxQueuedOrders)) return null;
  const o = { id: nextCampaignId(book, 'order'), ...order, queuedDay: day, acknowledgedDay: null, status: 'queued' };
  if (connected) { o.status = 'acknowledged'; o.acknowledgedDay = day; }
  book.orders.push(o);
  trimOrderHistory(book);
  return o;
}
// `deliverable(order)`, when given, can hold back an order whose system is connected: a command to a
// ship in warp is addressed to where her leg ends and is not received until she is there. [playtest]
export function acknowledgeQueuedOrders(book, day, connectedSystems, deliverable = null) {
  const acked = [];
  for (const o of book.orders) {
    if (o.status !== 'queued' || !connectedSystems.has(Number(o.systemIndex))) continue;
    if (deliverable && !deliverable(o)) continue;
    o.status = 'acknowledged'; o.acknowledgedDay = day; acked.push(o);
  }
  if (acked.length) trimOrderHistory(book);
  return acked;
}

// ---------- summaries ----------
export function politySummary(book, world, id) {
  return { id, name: world.factionName(id), economy: polityEconomy(book, world, id), production: polityProduction(book, world, id), readiness: polityReadiness(book, world, id),
    integrations: Object.entries(polity(book, id).integrations).map(([s, i]) => ({ systemIndex: Number(s), ...i })), licenses: Object.keys(polity(book, id).licenses).length,
    operations: book.operations.filter((o) => o.faction === id && o.status !== 'resolved').length };
}
// Key-sorted serialisation, so a book that has been through storage and a book that was stepped in
// memory hash the same whatever order their keys were created in.
function canonicalJson(value) {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  if (value && typeof value === 'object') return `{${Object.keys(value).sort().map((k) => `${JSON.stringify(k)}:${canonicalJson(value[k])}`).join(',')}}`;
  return JSON.stringify(value === undefined ? null : value);
}
export function checksum(book) {
  // The digest is the entire persisted book, not a chosen subset. An enumerated list drifts: the first
  // version of it omitted history, designs, recoveries, missions, orders and discoveries, the second
  // still omitted the seed, the war resolutions, relocated offers, assessments and the budget-migration
  // flag. Anything added to the book from now on is covered without anyone remembering to add it.
  return stableHash(canonicalJson(book));
}
