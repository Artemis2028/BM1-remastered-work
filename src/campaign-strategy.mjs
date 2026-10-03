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

import { stableHash, bounded, copy, planStanding, classifyDamage, disableThreshold } from './ship-fleet.mjs';
import * as Identity from './vessel-identity.mjs';
import { evaluateWar, settlementTerms, WAR_RULES } from './war-termination.mjs';
import * as J from './strategic-journey.mjs';
import * as SE from './strategic-encounter.mjs';
import * as SPD from './strategic-speed.mjs';
import * as REC from './strategic-recovery.mjs';
import * as TT from './treaty-terms.mjs';

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
  // Disabled hulls (DOCTRINE-RUNTIME-PHASE3 §1): stranded until something actually recovers them.
  crewSurvivalDays: 20,            // a disabled crew's life support; the doctrine survivor window is the same clock
  strandedRecoveryDays: 2,         // an own yard in the same system (not under blockade) takes this long to bring a hulk in
  derelictWriteOffDays: 90,        // a crewless hulk nobody recovers is written off this long after its crew were gone
  minOperatingCrew: 0.5,           // a repaired hull whose crew left sails again only with this much of a complement
  // Towing, salvage and stranded-hull recovery (TOWING-SALVAGE-RECOVERY).
  towPenalty: 0.7,                 // a tow flies at its towing group's multiplier × this (strategic-speed.mjs towSpeed)
  towSignature: 0.2,               // a blockade sees a group with a hulk in tow this much more easily (signature +)
  derelictLifeDays: 365,           // a written-off derelict stays salvageable this long, then breaks up (identity retired)
  maxDerelicts: 60,                // the oldest derelicts break up first beyond this
  recoveryMaxActive: 40,
  recoveryHistoryKept: 60,         // closed recovery missions kept on the book (the newest)           // open recovery missions, all powers; a new one beyond this is refused
  recoveryWaitDays: 20,            // a tow (or an outbound tug) with no way on waits this long, retrying daily, then gives up where it is
  aiRecoveryIntervalDays: 5,       // an AI looks for a hulk worth recovering this often
  aiRecoveryMaxPerPolity: 2,       // open recoveries an AI runs at once
  aiRecoveryMinValue: 60000,       // an AI does not send a tug for a hull worth less than this (class price)
  aiRecoveryMaxDays: 70,           // nor when outbound + tow would take longer than this
  aiRecoveryValuePerDay: 1500,     // nor when the value recovered per day of tug time is below this
  aiSalvageMinValue: 90000,        // salvage of an enemy or abandoned hulk: a higher bar
  recoveryGarrisonFloor: 1,        // a tug is never the last ready hull standing at a world its power holds
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
  dominionPactPartners: Object.freeze(['cardassian', 'breen']), // ELIGIBLE for an authored Dominion pact; eligibility is not a pact
  dominionAuthoredPacts: Object.freeze(['cardassian']), // the storyline's covert agreement, concluded when staging begins (empty: none)
  dominionAccessDeniedDays: 60,     // the wormhole held against Central and convoys interdicted this long: access is permanently denied
  // Expeditionary sides: a power fighting on this side of a wormhole is judged by whether the expedition
  // can sustain the war, not by its home realm. [DOMINION-FORMAL-WAR-RULES §5]
  expeditionarySides: Object.freeze({ dominion: Object.freeze({ wormhole: 'bajora-dominica-wormhole' }) }),
  expeditionCollapseShare: 0.35,    // at or below this share of the expedition's best, with no way to replace losses, it cannot sustain the war
  // Strategic evacuation and blockade (EVACUATION-BLOCKADE-RULES-261530ZSEP26). Both are persistent
  // operations with named participants and real hulls; none of these is a switch.
  evacPeoplePerCargo: 40,           // evacuees one unit of cargo capacity carries per trip
  evacProtectedShare: 10,           // evacuees per unit of the world's population figure an evacuation sets out to move (bounded, abstract)
  evacMinTarget: 2000, evacMaxTarget: 60000,
  evacLoadingDays: 1,               // a day in port loading at the origin; the legs each way are their real length
  evacRetryDays: 1,                 // a convoy turned back at the origin's blockade tries again at the next day's departure (TIME-SCALE: its trips are already weeks long)
  evacMaxHops: 6,                   // retained for saved configs; no longer read — reach is evacMaxOneWayDays, in real days
  evacLossRate: 0.12,               // per day, at full effective interdiction, the chance-equivalent of losing an unescorted transport
  evacAbandonLossShare: 0.5,        // an AI sponsor abandons an evacuation once it has lost this share of its transports
  evacMinPopulation: 5000,          // an AI evacuates only a world with people worth moving
  evacThreatRatio: 1.2,             // an AI evacuates when the force bound for a world outweighs its defence by this
  maxAiEvacuations: 3,
  blockadePurposes: Object.freeze(['interdict_trade', 'cut_reinforcements', 'stop_evacuation', 'isolate_world', 'prepare_invasion']),
  blockadeTrafficScale: 400,        // strength a blockade must field just to watch a system's traffic: coverage = S / (S + D + this)
  blockadeEvacImpact: 0.85,         // evacuation throughput lost at full effective coverage
  blockadeRestockImpact: 0.8,       // market restocking lost at full coverage
  blockadeRevenueImpact: 0.5,       // trade revenue lost at full coverage
  blockadeReinforcementImpact: 0.7, // production and resupply at the blockaded world lost at full coverage
  blockadeEscortWeight: 1,          // an escort's strength against the blockade's, in the effective coverage an evacuation meets
  blockadeAttrition: 0.02,          // per day, the share of the defending ships' strength (not installations) that lands on the blockade as damage
  blockadeCooldownDays: 60,         // an AI power waits this long between blockades
  blockadeMaxDays: 90,              // an AI blockade that has not achieved its purpose by then is lifted
  blockadeMinSpare: 5,              // an AI needs this many spare hulls before it commits to a blockade
  blockadeBreakRatio: 0.5,          // a blockade fielding less than this share of the local defence is broken
  blockadeStartRatio: 0.8,          // an AI blockades a world it cannot assault when it fields this share of its defence
  blockadeRetryDays: 180,           // an AI does not blockade again a world where its last blockade failed, for this long
  blockadeStallDays: 45,            // an AI turns to blockade only after this long at war without being able to mount an assault
  blockadeMinSupply: 0.3, blockadeUnsuppliedDays: 10,
  // Blockade interception and running (BLOCKADE-RUNNING-RULES-270100ZSEP26): one engine for every
  // runner — a formation, a trader's passage, an evacuation convoy.
  interceptSpeedExponent: 2,        // the relative strategic speed of runner and blockade, squared, is the interception's dash term (see assessBlockadeRun)
  interceptRefSpeed: 1.0,           // the strategic speed a blockader or runner is taken to have when its class gives none (SHIP-DEPENDENT-STRATEGIC-SPEED: the same 1.0 default every journey flies at)
  interceptCloakFactor: 0.3,        // detection multiplier when every running ship has a working cloak
  interceptCloakMinCondition: 0.5,  // a cloak works only on a ship with at least this share of her hull
  interceptBreakRatio: 2,           // runner combat strength this many times the blockade's forces the fight its way
  interceptDamageScale: 0.3,        // share of a runner's hull an intercept at full pressure costs
  interceptCoverRatio: 0.75,        // escorts fielding this share of the blockade's strength screen the convoy: it fights through
  interceptEscortWeight: 1.5,       // how much an armed ship's strength weighs against the blockade's in the engagement
  interceptBlockadeDamage: 0.25,    // share of the runner's combat strength an engagement lands on the blockade
  interceptMaxLossesPerRun: 1,      // a single crossing never destroys more than this many runners
  maxBlockadesPerPolity: 1,
  // Strategic resolution of the opening war: no calendar roll ends it; it ends when one belligerent
  // loses its home world and cannot contest it, or loses every world.
  centralWar: ['terran', 'klingon'],
  homeWorlds: { terran: 'Earth', klingon: 'Qonos' },
  resolutionStrengthRatio: 0.25, // the loser's ready strength vs the winner's when the home world has fallen
  // History and bounds
  recoveryOfferDays: 400,          // an unpursued recovery contract lapses after this many days (then one broker lead)
  historyLimit: 300,
  maxOperations: 60,
  // STRATEGIC-TIME-SCALE-CORRECTION: planning in real days of travel.
  maxOperationEtaDays: 120,        // an operation that cannot reach its objective within a season is not mounted
  operationEtaHalfValueDays: 30,   // a target this many days away is worth half as much to plan for as one at hand
  evacMaxOneWayDays: 45,           // a refuge further than this (one way, in real days) is not a viable evacuation
  evacDistancePenaltyDays: 10,     // destination score: days of travel a less safe refuge must save to be preferred
  evacAiMaxTransports: 4,
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
    journeys: [],        // every strategic movement under way (STRATEGIC-MOVEMENT-UNIFICATION): one record shape
    hullRecoveries: [],  // tow / salvage missions for disabled hulls (TOWING-SALVAGE-RECOVERY)
    derelicts: [],       // written-off hulks still lying where they were abandoned (salvageable until they break up)
    treatyTerms: [],     // treaty terms: DMZs, guarantees, basing, inspections, tribute, reparations (TREATY-EXPANSION)
    treatyIncidents: [], // breach / warning incidents under those terms
    treatyLedger: [],    // tribute and reparations payments, paid and missed
    treatyInspections: [], // inspection requests and their results
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
  // STRATEGIC-TIME-SCALE-CORRECTION retuned one inline rule. A save still carrying the one-hop-era stock
  // value takes the new one once; a value the save changed itself is left alone.
  if (!book.timeScale) { if (book.config.evacRetryDays === 3) book.config.evacRetryDays = CAMPAIGN_RULES.evacRetryDays; book.timeScale = 1; }
  // SHIP-DEPENDENT-STRATEGIC-SPEED: the blockade's relative-speed input is now the strategic speed (a
  // multiplier around 1.0), not the tactical top speed (around 45); a save's stock fallback follows, once.
  if (!book.strategicSpeed) { if (book.config.interceptRefSpeed === 45) book.config.interceptRefSpeed = CAMPAIGN_RULES.interceptRefSpeed; book.strategicSpeed = 1; }
  book.discoveries ||= { gorn: false };
  for (const key of ['polities', 'designs', 'incomeLedger', 'restoredStations', 'activatedStations', 'unstaffedStations', 'occupations', 'wars', 'warStates', 'territory']) book[key] ||= {};
  for (const key of ['operations', 'recoveries', 'missions', 'orders', 'history', 'journeys', 'hullRecoveries', 'derelicts', 'treatyTerms', 'treatyIncidents', 'treatyLedger', 'treatyInspections']) if (!Array.isArray(book[key])) book[key] = [];
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
      // A written-off hulk is abandoned, not destroyed: it leaves its owner's books but still lies where it
      // was, salvageable, with its identity intact, until it breaks up (TOWING-SALVAGE-RECOVERY §17).
      if (h.derelict && h.hull > 0) { (book.derelicts ||= []).push(h); continue; }
      // Leaving the books destroyed: its identity is retired, never reused. A hull taken by the captain
      // is not retired — it lives on under the same vid in the captain's fleet. [identity]
      if (h.identity && h.fate !== 'captured' && h.fate !== 'salvaged') Identity.retireVessel(book, h.identity, { day: book.settled ?? null, cause: 'destroyed', holder: id, systemIndex: h.systemIndex });
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
export function transferHullOut(book, hullId, { day = null, to = 'player', systemIndex = null, event = 'captured' } = {}) {
  for (const [polityId, p] of Object.entries(book.polities || {})) {
    if (polityId === 'player') continue;
    const h = (p.hulls || []).find((x) => x.id === hullId);
    if (!h || h.status === 'lost') continue;
    h.identity ||= Identity.makeIdentity({ vid: h.id, shipId: h.shipId, seed: Identity.vesselHash(`${book.seed}:${h.id}`), builder: polityId, via: 'legacy', systemIndex: h.systemIndex, legacy: true });
    Identity.recordProvenance(h.identity, { day, event, from: polityId, to, systemIndex });
    h.status = 'lost';
    h.fate = event === 'salvaged' ? 'salvaged' : 'captured';
    h.hull = 0;
    p.lostHulls = (p.lostHulls || 0) + 1;
    if (event === 'salvaged') book.stats.hullsSalvagedOut = (book.stats.hullsSalvagedOut || 0) + 1;
    else book.stats.hullsCaptured = (book.stats.hullsCaptured || 0) + 1;
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
  // Every route the model plots today reads the treaty terms in force (TREATY-EXPANSION).
  world.treatyBook = book;
  settleEconomy(book, world, day, effects);
  advanceProduction(book, world, day, effects);
  advanceGarrisons(book, world, day);
  advanceStranded(book, world, day, effects);
  advanceRepairs(book, world, day, effects);
  // Treaty terms: start and expiry, DMZ withdrawal and blockade bans, blockade clauses, tribute and reparations.
  advanceTreaties(book, world, day, effects);
  advanceIntegrations(book, world, day, effects);
  enforceRelations(book, world, day, effects);
  planOperations(book, world, day, effects);
  // Every model journey flies its legs up to today (STRATEGIC-MOVEMENT-UNIFICATION) before operations read
  // where their ships are.
  advanceJourneys(book, world, day, effects);
  advanceOperations(book, world, day, effects);
  // A defender disabled in today's battles is stranded before the Dominion or strategic ops can pick it.
  advanceStranded(book, world, day, effects);
  advanceDominion(book, world, day, effects);
  advanceStrategicOps(book, world, day, effects);
  // Anything disabled today (a battle, a blockade run) is stranded before anyone can pick it up.
  advanceStranded(book, world, day, effects);
  // Faction doctrine (DOCTRINE-RUNTIME-PHASE1): persistent incidents, per-observer knowledge, shadow
  // evaluation and the pilot responses. Supplied by the engine with the loaded doctrine; a world
  // without it (every pure fixture) runs exactly as before.
  world.doctrineStep?.(book, world, day, effects);
  evaluateWars(book, world, day, effects);
  advanceRecoveries(book, world, day, effects);
  // Tows and salvage (TOWING-SALVAGE-RECOVERY): retries, derelicts breaking up, the AI's bounded tugs. Their
  // journeys flew with every other journey above.
  advanceHullRecoveries(book, world, day, effects);
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
      revenue += (c.worldRevenueBase + c.worldRevenuePerPopulation * (sys.population || 0) + (fx.revenue || 0)) * factor * (1 + (fx.customs || 0) / 100)
        * blockadeFlowFactor(book, sys.index, c.blockadeRevenueImpact ?? 0.5);
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
    const blockaded = worlds.filter((s) => book.operations.some((o) => o.targetSystem === s.index && o.status === 'engaged' && o.faction !== id)).length
      // ...and a standing blockade weighs by how much of the world's traffic it actually stops.
      + worlds.reduce((n, s) => n + (1 - blockadeFlowFactor(book, s.index, 1)), 0);
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
    // A repaired hull waiting for a crew is recrewed the same way, where it lies in the yard (PHASE3 §1a).
    // A world held by a power it is at war with gives it no crews: a yard repair there under a host's rights is a
    // repair, not a recrewing (ARCHITECTURE-CLEANUP §3); a hostile world never was.
    const crewsAt = (i) => { const hold = world.systems[Number(i)]?.controller; return !hold || hold === id || world.relation(relSide(world, id), relSide(world, hold)) !== 'war'; };
    for (const h of p.hulls) if ((h.status === 'ready' || (h.recrew && h.status === 'repairing')) && !h.transit && crewsAt(h.systemIndex) && (stationEffects(world, h.systemIndex, null).morale || 0) > 0) h.crew = bounded((h.crew ?? 1) + c.crewRecoveryPerDay, 0, 1);
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
      const supply = bounded(p.supply, c.supplyFloor, 1) * blockadeFlowFactor(book, sys.index, c.blockadeReinforcementImpact ?? 0.7);
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
// ---------- disabled hulls: stranded until recovered (DOCTRINE-RUNTIME-PHASE3 §1) ----------
// A disabled hull does not repair itself, sail itself, or join anything. Three separate things happen to
// it, each only when something real does them:
//   crew      aboard → rescued (someone took them off) | lost (life support ran out: crewSurvivalDays)
//   recovery  awaiting_recovery → recovering → in_yard  (an own yard in the same system, not blockaded, brings
//             it in; or an explicit recovery — a tow arriving — recorded by recoverStrandedHull)
//   repair    only in_yard, by the ordinary yard repair below
// Campaign days alone change nothing but the crew clock. A crewless hulk nobody recovers is written off.
export function hullIsDisabled(h) {
  // engineDisabled: a vessel of the captain's the engine holds disabled (its mirror may carry a repaired
  // hull figure while its recovery timer still runs) — disabled until the engine says otherwise.
  return Boolean(h) && h.status !== 'lost' && ((Number(h.maxHull) > 0 && classifyDamage(h.hull, h.maxHull) === 'disabled') || h.engineDisabled === true);
}
// A structurally repaired hull whose crew were rescued or lost: it stays in the yard, unavailable, until
// the ordinary crew recovery gives it `minOperatingCrew` (PHASE3 §1a).
export function hullAwaitingCrew(h) { return Boolean(h?.recrew) && h.status !== 'lost'; }
// Cannot sail or fight as a ship: disabled, or repaired but not yet crewed.
// …or surrendered: stood down and held, inactive, until released (PHASE4 §6).
// A hull in warp between two systems (a leg of a shared journey) is nowhere anyone can pick it up.
export function hullInTransit(h) { return Boolean(h?.transit); }
// …or fighting in a live strategic ↔ tactical encounter: the scene has it, and nothing else may pick it up,
// move it, damage it or count it free until the encounter hands it back (STRATEGIC-TACTICAL-HANDOFF).
export function hullInEncounter(h) { return Boolean(h?.encounterId); }
export function hullUnavailable(h) { return hullIsDisabled(h) || hullAwaitingCrew(h) || h?.status === 'surrendered' || hullInTransit(h) || hullInEncounter(h); }
// What a hull released from a job becomes: available if it can sail, stranded if it cannot.
function releaseStatus(h) { return hullUnavailable(h) ? 'repairing' : 'ready'; }
// The moment a stranded hull's structure is repaired. With its own crew still aboard it is simply back.
// If its crew were taken off or lost, and it has less than the minimum complement, it waits in the yard
// for a crew — same hull, same vid — and is not operational until the complement is reached.
function finishStrandedRepair(book, h, polityId, day, effects) {
  if (!h.stranded || hullIsDisabled(h) || h.status === 'lost') return;
  const s = h.stranded;
  effects.push({ type: 'hullRestored', polityId, hullId: h.id, vid: h.identity?.vid || h.id, systemIndex: Number(h.systemIndex), day, strandedDays: day - s.since, crew: s.crew });
  delete h.stranded;
  const min = book.config.minOperatingCrew ?? 0.5;
  if (s.crew !== 'aboard' && Number(h.crew ?? 1) < min) {
    h.recrew = { since: day, systemIndex: Number(h.systemIndex), crewLeft: s.crew };
    h.status = 'repairing';
    effects.push({ type: 'hullAwaitingCrew', polityId, hullId: h.id, vid: h.identity?.vid || h.id, systemIndex: Number(h.systemIndex), day, crew: Number(h.crew ?? 0) });
  }
}
// A hull awaiting crew becomes operational the day its complement reaches the minimum.
function advanceRecrewing(book, h, polityId, day, effects) {
  if (!h.recrew || h.status === 'lost') return;
  if (Number(h.crew ?? 1) < (book.config.minOperatingCrew ?? 0.5)) { h.status = 'repairing'; return; }
  effects.push({ type: 'hullRecommissioned', polityId, hullId: h.id, vid: h.identity?.vid || h.id, systemIndex: Number(h.systemIndex), day, awaitedDays: day - h.recrew.since, crew: Number(h.crew) });
  delete h.recrew;
  // Back in operation; a doctrine job still holding it resumes by its own rules (§6).
  if (h.status === 'repairing') h.status = h.opId ? 'assigned' : 'ready';
}
function ownYardAt(world, polityId, systemIndex) {
  return world.systems[Number(systemIndex)]?.controller === polityId && (stationEffects(world, Number(systemIndex), polityId).repairCapacity || 0) > 0;
}
// An own yard, or a host's yard the polity may use under basing rights (TREATY-EXPANSION §4) to take a hulk in
// AND repair it there: rights for `recovery` and for `repair` both. A host yard that would take her in but may
// not repair her is no yard for her: she would lie there unrepaired for ever (TOWING-SALVAGE-AUDIT A4).
// Basing never transfers ownership: the hulk stays the guest's.
export function basingRecoveryYardAt(book, world, guest, systemIndex) {
  if (!book.treatyTerms?.length) return null;
  const t = basingRightAt(book, world, guest, systemIndex, 'recovery');
  if (!t || !basingRightAt(book, world, guest, systemIndex, 'repair')) return null;
  return (stationEffects(world, Number(systemIndex), t.host).repairCapacity || 0) > 0 ? t : null;
}
function recoveryYardAt(book, world, polityId, systemIndex) {
  return ownYardAt(world, polityId, systemIndex) || Boolean(basingRecoveryYardAt(book, world, polityId, systemIndex));
}
function strandHull(book, h, polityId, day, effects) {
  const c = book.config;
  h.stranded = { since: day, systemIndex: Number(h.systemIndex), recovery: 'awaiting_recovery', recoverySince: null, recoveredBy: null,
    crew: 'aboard', crewUntil: day + (c.crewSurvivalDays ?? 20), crewEndDay: null };
  effects.push({ type: 'hullStranded', polityId, hullId: h.id, vid: h.identity?.vid || h.vid || h.id, systemIndex: Number(h.systemIndex), day, crewUntil: h.stranded.crewUntil });
}
export function advanceStranded(book, world, day, effects = []) {
  const c = book.config;
  for (const [id, p] of Object.entries(book.polities)) {
    if (id === 'player') continue; // the engine owns the captain's vessels (§6)
    for (const h of p.hulls) {
      if (h.status === 'lost') continue;
      if (!hullIsDisabled(h)) {
        // Structurally back — only ever by a real repair; operational only with a crew.
        finishStrandedRepair(book, h, id, day, effects);
        advanceRecrewing(book, h, id, day, effects);
        continue;
      }
      if (!h.stranded) strandHull(book, h, id, day, effects);
      const s = h.stranded;
      // Never available. Whatever job still holds it (an operation mid-battle, a doctrine assignment) keeps
      // its claim and releases it by its own rules; released, it is stranded, not ready.
      if (h.status === 'ready' || (h.status === 'assigned' && !h.opId)) h.status = 'repairing';
      s.systemIndex = Number(h.systemIndex);
      // Under tow, the tug's power keeps the hulk's people alive: the clock stops at attachment and runs
      // again only if the tow is lost (TOWING-SALVAGE-RECOVERY §9).
      if (s.crew === 'aboard' && !s.crewSupportedBy && day > s.crewUntil) {
        s.crew = 'lost'; s.crewEndDay = day; h.crew = 0;
        effects.push({ type: 'strandedCrewLost', polityId: id, hullId: h.id, vid: h.identity?.vid || h.id, systemIndex: s.systemIndex, day });
      }
      const blockaded = applicableBlockadesAt(book, world, s.systemIndex, id).length > 0;
      // In tow: the tow mission owns where it is and where it goes; no yard here picks it up mid-tow.
      if (s.recovery === 'under_tow') continue;
      // Out of a yard's hands again: whatever kept her people alive there no longer does (a tow's crew support
      // ends at the yard; the clock resumes with what was left of it).
      const outOfYard = () => { if (s.crewSupportedBy) { s.crewUntil = day + (s.crewDaysLeft ?? 1); delete s.crewSupportedBy; delete s.crewDaysLeft; } };
      if (s.recovery === 'awaiting_recovery' && recoveryYardAt(book, world, id, s.systemIndex) && !blockaded) { s.recovery = 'recovering'; s.recoverySince = day; s.recoveredBy = 'yard'; }
      else if (s.recovery === 'recovering' && (blockaded || !recoveryYardAt(book, world, id, s.systemIndex))) { s.recovery = 'awaiting_recovery'; s.recoverySince = null; s.recoveredBy = null; outOfYard(); }
      // In the yard, it stays there through a later blockade (the yard has it); if the yard itself is lost —
      // the world taken, the yard destroyed — the hulk is out in the open again, awaiting recovery.
      else if (s.recovery === 'in_yard' && !recoveryYardAt(book, world, id, s.systemIndex)) { s.recovery = 'awaiting_recovery'; s.recoverySince = null; s.recoveredBy = null; outOfYard(); }
      if (s.recovery === 'recovering' && day - s.recoverySince >= (c.strandedRecoveryDays ?? 2)) {
        s.recovery = 'in_yard';
        effects.push({ type: 'hullRecovered', polityId: id, hullId: h.id, vid: h.identity?.vid || h.id, systemIndex: s.systemIndex, day, via: s.recoveredBy });
      }
      // Nobody aboard and nobody coming: the owner writes the hulk off. A hulk somebody is coming for (a live
      // recovery or salvage claim) is never written off while that mission lasts (TOWING-SALVAGE-RECOVERY §17).
      // Written off means off the owner's books — counted lost, no longer its fleet — not gone: the wreck
      // still lies where it was (book.derelicts), salvageable, its identity intact, until it breaks up.
      if (s.recovery === 'awaiting_recovery' && s.crew !== 'aboard' && !liveRecoveryClaim(book, h) && day - s.crewEndDay > (c.derelictWriteOffDays ?? 90)) {
        h.status = 'lost'; h.fate = 'written_off'; h.opId = null;
        h.derelict = { since: day, systemIndex: s.systemIndex, abandonedBy: id, until: day + (c.derelictLifeDays ?? 365) };
        p.lostHulls = (p.lostHulls || 0) + 1; book.stats.hullsLost++;
        book.stats.hullsWrittenOff = (book.stats.hullsWrittenOff || 0) + 1;
        effects.push({ type: 'strandedWrittenOff', polityId: id, hullId: h.id, vid: h.identity?.vid || h.id, systemIndex: s.systemIndex, day });
      }
    }
  }
}
// A recovery that actually happened (a tow brought it to a yard, an authored salvage): the hulk is in the
// yard and the ordinary repair takes over. Refused where there is no own yard to be in.
export function recoverStrandedHull(book, world, polityId, hullId, day, via = 'recovery') {
  const h = hullOf(book, polityId, hullId);
  if (!h || !hullIsDisabled(h)) return { ok: false, reason: 'not a disabled hull' };
  if (!recoveryYardAt(book, world, polityId, h.systemIndex)) return { ok: false, reason: 'no own yard here: it waits for a tow' };
  if (applicableBlockadesAt(book, world, h.systemIndex, polityId).length) return { ok: false, reason: 'the yard is under blockade' };
  h.stranded ||= { since: day, systemIndex: Number(h.systemIndex), crew: 'aboard', crewUntil: day + (book.config.crewSurvivalDays ?? 20), crewEndDay: null };
  h.stranded.recovery = 'in_yard'; h.stranded.recoverySince = day; h.stranded.recoveredBy = via;
  return { ok: true };
}
// People taken off a hulk: the crew are safe; the hull stays exactly where and as it is.
export function rescueStrandedCrew(book, polityId, hullId, day, by = null) {
  const h = hullOf(book, polityId, hullId);
  if (!h?.stranded || h.stranded.crew !== 'aboard') return false;
  h.stranded.crew = 'rescued'; h.stranded.crewEndDay = day; h.stranded.rescuedBy = by; h.crew = 0;
  return true;
}
function advanceRepairs(book, world, day, effects = []) {
  const c = book.config;
  for (const id of Object.keys(book.polities)) {
    const p = polity(book, id);
    const budget = {};
    for (const sys of controlled(world, id)) budget[sys.index] = stationEffects(world, sys.index, id).repairCapacity || 0;
    // Basing rights (TREATY-EXPANSION §4): a share of the host's repair capacity at the named facilities, for as
    // long as the term holds and the host holds the system. Nothing changes hands.
    const basing = {};
    for (const t of activeTreatyTerms(book, 'basing', day)) {
      if (t.guest !== id || !t.purposes.includes('repair')) continue;
      for (const i of t.systems) {
        if (budget[i] > 0 || world.systems[Number(i)]?.controller !== t.host) continue;
        const cap = stationEffects(world, Number(i), t.host).repairCapacity || 0;
        if (cap > 0) { budget[i] = Math.max(1, Math.floor(cap * t.repairShare)); basing[i] = t.id; }
      }
    }
    const yards = Object.keys(budget).map(Number).filter((i) => budget[i] > 0);
    p.repairedToday = {};
    for (const h of p.hulls) {
      if (h.status === 'surrendered') continue; // held where it surrendered; nobody repairs it there
      if (h.transit) continue; // in warp: nowhere a yard can reach it
      if (h.status === 'lost' || h.hull >= h.maxHull) { if (h.status === 'repairing' && !h.recrew && !h.stranded) h.status = 'ready'; continue; }
      // A disabled hull is repaired only once it has been recovered into a yard; it never sails anywhere.
      if (hullIsDisabled(h) && h.stranded?.recovery !== 'in_yard') continue;
      // A damaged, uncommitted hull with no repair facility here sails to the nearest owned yard.
      // The captain's ships are the engine's: their mirror is never sent anywhere by the model.
      if (id !== 'player' && h.status === 'ready' && !hullIsDisabled(h) && !(budget[h.systemIndex] > 0) && h.hull < h.maxHull * 0.6 && yards.length && !(h.repairRetryAfter > day)) {
        // Nearest by the days the journey will actually fly, not by jumps (STRATEGIC-TIME-SCALE-CORRECTION).
        const target = yards.map((i) => ({ i, days: plannedJourneyDays(world, h.systemIndex, i, id, hullSpeed(world, h)) })).filter((x) => x.days != null).sort((a, b) => a.days - b.days || a.i - b.i)[0];
        // It sails there, leg by leg, through whatever lies on the way (STRATEGIC-MOVEMENT-UNIFICATION).
        if (target) {
          const r = startJourney(book, world, { kind: 'repair', ref: h.id, sponsor: id, hulls: [h], destination: target.i, purpose: 'repair', authority: { kind: 'repair', ref: h.id } }, day, effects);
          if (r.ok) { h.status = 'repairing'; if (!r.arrived) h.opId = r.journey.id; }
        }
        continue;
      }
      if (h.status === 'repairing' && h.arriveDay != null && day < h.arriveDay) continue;
      if (!(budget[h.systemIndex] > 0)) continue;
      const need = h.maxHull - h.hull, done = Math.min(need, budget[h.systemIndex]);
      h.hull += done; budget[h.systemIndex] -= done; p.repairedToday[h.systemIndex] = (p.repairedToday[h.systemIndex] || 0) + done;
      if (basing[h.systemIndex]) { treatyStats(book).basingRepairDays++; h.basedRepair = { termId: basing[h.systemIndex], day, systemIndex: Number(h.systemIndex) }; }
      // A stranded hull repaired out of the disabled band: back with its crew, or waiting for one (§1a).
      finishStrandedRepair(book, h, id, day, effects);
      // A doctrine job keeps its hull through the repair; it resumes when the hull can sail (§6) — which a
      // hull waiting for a crew cannot.
      if (h.recrew) h.status = 'repairing';
      else if (!(h.opId && String(h.opId).includes('doctrine-') && !hullIsDisabled(h))) h.status = h.hull >= h.maxHull ? 'ready' : 'repairing';
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
// Who stands in a world's defence: its ready hulls, and hulls sent there on a defence objective
// (DOCTRINE-RUNTIME-PHASE3) once they have arrived. Never a disabled hulk.
function defendsHere(h, systemIndex) {
  // A ship in warp is at no system: it defends nothing, where it left or where it is going. [TIME-SCALE]
  return !h.transit && Number(h.systemIndex) === Number(systemIndex) && !hullIsDisabled(h)
    && (h.status === 'ready' || (h.status === 'assigned' && h.defendingAt != null && Number(h.defendingAt) === Number(systemIndex)));
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
    for (const h of polity(book, id).hulls) if (defendsHere(h, systemIndex)) strength += hullStrength(book, world, h);
  }
  return strength;
}
// The force a world can count on, told apart (STRATEGIC-TIME-SCALE-CORRECTION): what stands there now
// (localDefenseStrength — never a ship in warp), what is on its way there by `byDay` on a journey of a side
// that defends it (committed and in transit, not yet present), and what is on its way but arrives later.
// A ship in transit is counted once, at its destination and only by its arrival day — never at its origin.
function defendsOnArrival(book, tr) {
  if (tr.kind === 'return') return true;
  if (tr.kind === 'doctrine') {
    const a = (book.doctrine?.assignments || []).find((x) => x.id === tr.meta?.assignmentId);
    const o = a?.objectiveId ? (book.doctrine?.objectives || []).find((x) => x.id === a.objectiveId) : null;
    return Boolean(o && o.kind === 'defense' && o.status === 'active');
  }
  return false;
}
export function forceAccount(book, world, systemIndex, byDay = Infinity, attackerId = null) {
  const standing = localDefenseStrength(book, world, systemIndex);
  const defenders = new Set(defendingPolityIds(book, world, systemIndex, attackerId));
  const incoming = [], later = [];
  for (const tr of book.journeys || []) {
    if (tr.status !== 'underway' || !defenders.has(tr.sponsor) || Number(tr.destination) !== Number(systemIndex)) continue;
    // Only ships that will stand in the world's defence when they get there: a force going home (it is
    // ready on arrival) or a doctrine vessel sent on a defence objective. An assault, a blockade force,
    // a freighter or a patrol arriving there defends nothing.
    if (!defendsOnArrival(book, tr)) continue;
    const strength = journeyMemberHulls(book, tr).filter((h) => !hullIsDisabled(h)).reduce((n, h) => n + hullStrength(book, world, h), 0);
    (Number(tr.etaDay) <= byDay ? incoming : later).push({ journeyId: tr.id, sponsor: tr.sponsor, kind: tr.kind, eta: Number(tr.etaDay), strength: Math.round(strength) });
  }
  const sum = (l) => l.reduce((n, x) => n + x.strength, 0);
  return { standing: Math.round(standing), incoming, later, incomingStrength: sum(incoming), laterStrength: sum(later), atEta: Math.round(standing + sum(incoming)) };
}
// The days a force takes to reach a system: every group from where it stands, by the route its journey
// will fly; the slowest group sets the operation's arrival.
// Each group flies at its own slowest ship (SHIP-DEPENDENT-STRATEGIC-SPEED), exactly as its journey will.
export function forceEtaDays(world, hulls, target, polityId) {
  let worst = 0;
  for (const from of [...new Set(hulls.map((h) => Number(h.systemIndex)))]) {
    const plan = plotJourney(world, from, target, polityId, null, hullsSpeed(world, hulls.filter((h) => Number(h.systemIndex) === from)));
    if (!plan) return null;
    worst = Math.max(worst, plan.legDays.reduce((n, d) => n + d, 0));
  }
  return worst;
}
// What a target is worth planning for, before distance: its people (what an assault gains), weighted up.
function targetValue(world, systemIndex) {
  return 1 + Math.max(0, Number(world.systems[Number(systemIndex)]?.population) || 0) / 1000;
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
    const ready = p.hulls.filter((h) => h.status === 'ready' && !hullUnavailable(h));
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
    const pick = chooseOperationTarget(book, world, id, chosen, strength, targets, day);
    p.lastPlan = pick.record;
    if (!pick.target) continue;
    const op = launchOperation(book, world, id, chosen, pick.target.index, day, pick.target.hops, 'assault', effects);
    op.plan = pick.target.plan;
  }
}
// Which objective, by what the force will find when it gets there (STRATEGIC-TIME-SCALE-CORRECTION):
//  - the real days of travel from where its ships stand (never a hop count);
//  - the defence it will meet then — what stands there now plus the defenders' own ships already on their
//    way and arriving first (committed, not yet present);
//  - nothing it already has a force on the way to (that force is its commitment there);
//  - worth over distance: a target twice as far is worth planning for less, beyond a season not at all.
function chooseOperationTarget(book, world, id, chosen, strength, targets, day) {
  const c = book.config;
  const already = new Set((book.operations || []).filter((o) => o.faction === id && o.status !== 'resolved').map((o) => Number(o.targetSystem)));
  const considered = [];
  for (const t of targets) {
    const row = { index: t.index, hops: t.hops };
    considered.push(row);
    if (already.has(Number(t.index))) { row.skip = 'a force of its own is already on its way'; continue; }
    const eta = forceEtaDays(world, chosen, t.index, id);
    if (eta == null) { row.skip = 'no route'; continue; }
    row.etaDays = eta;
    if (eta > c.maxOperationEtaDays) { row.skip = `${eta} days away (limit ${c.maxOperationEtaDays})`; continue; }
    const f = forceAccount(book, world, t.index, day + eta, id);
    row.defenseNow = f.standing; row.defenseAtEta = f.atEta; row.incomingDefense = f.incomingStrength;
    if (strength < f.atEta * c.minReadinessRatioToAttack) { row.skip = `defence on arrival ${f.atEta} too strong for ${Math.round(strength)}`; continue; }
    row.score = Math.round(1000 * targetValue(world, t.index) / (1 + eta / c.operationEtaHalfValueDays)) / 1000;
  }
  const ok = considered.filter((r) => r.score != null).sort((a, b) => b.score - a.score || a.etaDays - b.etaDays || a.index - b.index);
  const best = ok[0] || null;
  // The force's pace: its slowest ship (each group flies at its own slowest; the operation arrives with the last).
  const speed = hullsSpeed(world, chosen);
  const record = { day, strength: Math.round(strength), speed, chosen: best ? best.index : null, considered: considered.slice(0, 12) };
  if (!best) return { target: null, record };
  return { target: { ...targets.find((t) => t.index === best.index), plan: { etaDays: best.etaDays, arriveDay: day + best.etaDays, defenseNow: best.defenseNow, defenseAtEta: best.defenseAtEta, incomingDefense: best.incomingDefense, strength: Math.round(strength), score: best.score, speed } }, record };
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
  if (d.plan?.partnerCorridor && entryHolder && entryHolder !== 'dominion' && pactActive(book, 'dominion', entryHolder) && !ground.includes(Number(d.entrySystem))) ground.push(Number(d.entrySystem));
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
export function launchOperation(book, world, factionId, hulls, targetSystem, day, hops, kind = 'assault', effects = [], opts = {}) {
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
  if (['assault', 'invasion'].includes(kind) && book.polities[factionId]) book.polities[factionId].lastAssaultDay = day;
  book.operations.push(op);
  // STRATEGIC-MOVEMENT-UNIFICATION: the force flies its real route, one shared journey per system it sets
  // out from, under the war it was sent to fight (the same authority stamp a formation carries). The
  // loaded scene's own immediate raid (opts.immediate) is the one exception: it is fought where it is.
  if (!opts.immediate) {
    op.war = warAuthorityStamp(book, world, factionId, Number(targetSystem));
    op.journeyIds = [];
    const groups = new Map();
    for (const h of hulls) { const k = Number(h.systemIndex); if (!groups.has(k)) groups.set(k, []); groups.get(k).push(h); }
    let eta = day;
    for (const [, group] of [...groups.entries()].sort((a, b) => a[0] - b[0])) {
      const r = startJourney(book, world, { kind: 'operation', ref: op.id, sponsor: factionId, hulls: group, destination: Number(targetSystem), purpose: 'attack', war: op.war,
        authority: { kind: 'operation', ref: op.id, opKind: kind } }, day, effects);
      if (!r.ok) {
        for (const h of group) { h.opId = null; h.status = releaseStatus(h); h.originSystem = null; }
        op.hullIds = op.hullIds.filter((id) => !group.some((h) => h.id === id));
        continue;
      }
      op.journeyIds.push(r.journey.id);
      eta = Math.max(eta, r.journey.status === 'underway' ? r.journey.etaDay : day);
    }
    op.arriveDay = Math.max(day + (op.journeyIds.length ? 0 : Math.max(1, hops)), eta);
    op.committed = op.hullIds.length;
  } else {
    // Fought where it is; its survivors still fly home by a real journey.
    op.war = warAuthorityStamp(book, world, factionId, Number(targetSystem));
    op.journeyIds = [];
  }
  addHistory(book, day, 'operation', `${world.factionName(factionId)} dispatched ${hulls.length} hulls toward ${world.systems[targetSystem]?.name} (${kind}).`, { opId: op.id, faction: factionId, systemIndex: targetSystem });
  effects.push({ type: 'operationLaunched', opId: op.id, faction: factionId, targetSystem, hulls: hulls.length, kind, day });
  return op;
}
export function operationHulls(book, op) {
  const p = polity(book, op.faction);
  return op.hullIds.map((id) => p.hulls.find((h) => h.id === id)).filter((h) => h && h.status !== 'lost');
}
// What the operation has at its objective: its hulls standing there, able to fight. A hull disabled on the
// way, or still in warp, is not part of the battle.
export function operationForce(book, op) {
  return operationHulls(book, op).filter((h) => Number(h.systemIndex) === Number(op.targetSystem) && !h.transit && !hullIsDisabled(h));
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
    if (op.resolvedBy === 'local') {
      // A battle handed to the scene but not yet fought is simply called off: the ceasefire came before
      // contact, so there is no attack at all (STRATEGIC-TACTICAL-HANDOFF). One already being fought is the
      // scene's to end (it ends it as a withdrawal).
      const enc = SE.liveEncounterFor(book, 'operation', op.id);
      if (enc?.status === 'pending') { SE.abortEncounter(book, enc.id, day, 'the war ended before contact', lookupHull(book)); SE.bumpEncounterStat(book, 'staleSuppressed'); }
      else { op.standDownPending = true; continue; }
    }
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
      // Those already there join the garrison; those still on their way fly on and join it when they
      // arrive (the journey's owner reads 'absorbed'). Nobody is set down anywhere they did not fly to.
      for (const h of operationHulls(book, op)) {
        if (h.transit) continue;
        if (!Array.isArray(op.journeyIds)) h.systemIndex = op.targetSystem; // an operation launched before shared journeys
        h.opId = null; h.status = releaseStatus(h); h.originSystem = null;
      }
      addHistory(book, day, 'operation', `${world.factionName(op.faction)} forces bound for ${world.systems[op.targetSystem]?.name} joined its garrison; the world was already held.`, { opId: op.id, systemIndex: op.targetSystem, faction: op.faction });
      continue;
    }
    if (op.status === 'moving') {
      if (Array.isArray(op.journeyIds)) {
        // It engages when every group has either arrived or ended its journey short (turned back, halted);
        // what engages is what actually reached the objective.
        if (op.journeyIds.some((id) => journeyById(book, id)?.status === 'underway')) continue;
        const present = operationForce(book, op);
        if (!present.length) { finishOperation(book, world, op, day, 'turned-back', effects, 'offscreen', `${world.factionName(op.faction)} forces bound for ${world.systems[op.targetSystem]?.name} never reached it.`); continue; }
        op.status = 'engaged'; op.engagedDay = day; op.holdDays = 0;
        effects.push({ type: 'operationArrived', opId: op.id, faction: op.faction, targetSystem: op.targetSystem, hulls: present.length, day });
        addHistory(book, day, 'engagement', `${world.factionName(op.faction)} forces engaged ${world.systems[op.targetSystem]?.name}.`, { opId: op.id, systemIndex: op.targetSystem, faction: op.faction });
        continue;
      }
      // An operation saved before shared journeys: the old arrival rule, once.
      if (day < op.arriveDay) continue;
      op.status = 'engaged'; op.engagedDay = day; op.holdDays = 0;
      for (const h of operationHulls(book, op)) h.systemIndex = op.targetSystem;
      effects.push({ type: 'operationArrived', opId: op.id, faction: op.faction, targetSystem: op.targetSystem, hulls: operationHulls(book, op).length, day });
      addHistory(book, day, 'engagement', `${world.factionName(op.faction)} forces engaged ${world.systems[op.targetSystem]?.name}.`, { opId: op.id, systemIndex: op.targetSystem, faction: op.faction });
      continue;
    }
    if (op.status !== 'engaged') continue;
    // STRATEGIC-TACTICAL-HANDOFF: an encounter owns this battle — the scene fights it, and no offscreen day is
    // resolved in parallel (an explicit guard, counted).
    const owning = SE.liveEncounterFor(book, 'operation', op.id);
    const here = world.localSystem != null && Number(world.localSystem) === Number(op.targetSystem);
    // A handoff the scene never took up, the captain gone: the model settles it, once (the fallback's day).
    if (settleAbandonedHandoff(book, world, owning, day, effects)) continue;
    if (owning) { SE.suppressAbstract(book, owning, 'offscreen battle day'); continue; }
    if (op.resolvedBy === 'local') continue;                 // the loaded scene owns this battle
    // The captain is there: the battle is handed to the scene, once a day (not again on a day it fell back).
    if (here && !fellBackToday(op, day)) { openOperationEncounter(book, world, op, day, 'the captain is in the system'); continue; }
    if (capturedToday.has(op.targetSystem)) { op.holdDays = 0; continue; } // another power took it today; contest it tomorrow
    const before = book.stats.captures;
    resolveOffscreenDay(book, world, op, day, effects);
    if (book.stats.captures > before) capturedToday.add(op.targetSystem);
  }
}
function resolveOffscreenDay(book, world, op, day, effects) {
  const c = book.config;
  const hulls = operationForce(book, op);
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
    const remaining = operationForce(book, op);
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
    if (!operationForce(book, op).length) return finishOperation(book, world, op, day, 'destroyed', effects, 'offscreen');
  }
  op.holdDays++;
  if (op.holdDays >= c.captureHoldDays) {
    const sys = world.systems[op.targetSystem];
    const from = sys?.controller || null;
    finishOperation(book, world, op, day, 'captured', effects, 'offscreen');
    effects.push({ type: 'captureSystem', systemIndex: op.targetSystem, by: op.faction, from, opId: op.id, day });
    recordCapture(book, world, op.targetSystem, op.faction, from, day);
    for (const h of operationHulls(book, op)) { h.status = releaseStatus(h); h.opId = null; }
  }
}
// One day of a bounded raid's strike (DOCTRINE-RUNTIME-PHASE3 §5), resolved by the same attrition model as
// an offscreen operation day: the raiders and the world's defenders lose hull by the strength ratio. A
// raid never captures. `raid` carries the counters an operation carries ({ id, faction, losses,
// defenderLosses }); its authority is the caller's to have checked the same day.
export function raidStrikeDay(book, world, raid, hulls, targetSystem, day, effects = []) {
  const c = book.config;
  const live = hulls.filter((h) => h && h.status !== 'lost' && !hullIsDisabled(h));
  if (!live.length) return { ok: false, reason: 'no raider can fight' };
  const attack = live.reduce((n, h) => n + hullStrength(book, world, h), 0) * bounded(polity(book, raid.faction).supply, c.supplyFloor, 1);
  const defense = localDefenseStrength(book, world, targetSystem);
  const roll = seededUnit(book.seed, 'raid', raid.id, day);
  const before = { losses: raid.losses || 0, defenderLosses: raid.defenderLosses || 0 };
  raid.losses ||= 0; raid.defenderLosses ||= 0;
  if (defense > 0) {
    const ratio = attack / (attack + defense);
    applyLosses(book, world, live, bounded((1 - ratio) * c.attritionPerDay * (0.7 + roll * 0.6), 0, 0.5), raid, day);
    applyDefenderLosses(book, world, targetSystem, bounded(ratio * c.attritionPerDay * (0.7 + (1 - roll) * 0.6), 0, 0.5), raid, day, effects);
  }
  effects.push({ type: 'raidStrike', raidId: raid.id, faction: raid.faction, targetSystem: Number(targetSystem), day, attack: Math.round(attack), defense: Math.round(defense), losses: raid.losses - before.losses, defenderLosses: raid.defenderLosses - before.defenderLosses });
  return { ok: true, attack, defense, losses: raid.losses - before.losses, defenderLosses: raid.defenderLosses - before.defenderLosses };
}
function applyLosses(book, world, hulls, fraction, op, day) {
  let budget = hulls.reduce((n, h) => n + h.maxHull, 0) * fraction;
  let i = 0;
  for (const h of hulls) {
    if (budget <= 0) break;
    if (hullInEncounter(h)) continue; // fighting in the loaded scene: the scene decides its damage
    const dmg = Math.min(h.hull, budget * (0.5 + seededUnit(book.seed, 'dmg', op.id, day, i++)));
    h.hull -= dmg; budget -= dmg;
    if (h.hull <= 0) { h.hull = 0; h.status = 'lost'; op.losses++; polity(book, op.faction).lostHulls++; book.stats.hullsLost++; }
  }
}
function applyDefenderLosses(book, world, systemIndex, fraction, op, day, effects) {
  for (const id of defendingPolityIds(book, world, systemIndex, op.faction)) {
    const p = polity(book, id);
    // Losses fall on the defenders and on any hulk lying there: a disabled hull adds nothing to the defence
    // but is not out of the fight's reach (it can be finished off where it lies). A hulk in tow, in warp, lies
    // nowhere: it is not at the system it left (TOWING-SALVAGE-AUDIT A11).
    const local = p.hulls.filter((h) => !hullInEncounter(h) && (defendsHere(h, systemIndex) || (hullIsDisabled(h) && !h.transit && Number(h.systemIndex) === Number(systemIndex) && !h.opId)));
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
  const homeward = [];
  for (const h of survivors) {
    // A disabled survivor cannot go home: it stays where it was disabled, stranded.
    // A surrendered survivor is held where it surrendered; it is flown nowhere (PHASE4 §6).
    if (h.status === 'surrendered') { h.opId = null; h.originSystem = null; continue; }
    if (outcome === 'captured' || hullIsDisabled(h) || !Array.isArray(op.journeyIds)) {
      h.opId = null; h.status = releaseStatus(h);
      if (outcome !== 'captured' && !hullIsDisabled(h) && !Array.isArray(op.journeyIds)) h.systemIndex = h.originSystem ?? op.originSystem ?? h.systemIndex; // pre-journey operation
      h.originSystem = null;
      continue;
    }
    // STRATEGIC-MOVEMENT-UNIFICATION: survivors fly home. One still in warp finishes the leg it is on and
    // turns for home there (the journey's safe boundary); one standing somewhere sets out today.
    const home = operationHome(book, world, op, h);
    if (h.transit) {
      const tr = journeyById(book, h.transit.journeyId);
      // Its operation is over: it points at no operation while it flies home (status stays 'assigned' until it
      // is set down; releaseMembersHere frees it there).
      if (tr && tr.status === 'underway') { h.opId = null; tr.pending = { kind: 'return', destination: home, purpose: 'return', war: null, authority: { kind: 'return', ref: op.id }, meta: { home, opId: op.id } }; continue; }
    }
    if (home == null || Number(h.systemIndex) === Number(home)) { h.opId = null; h.status = releaseStatus(h); h.originSystem = null; continue; }
    homeward.push({ h, home });
  }
  const byLeg = new Map();
  for (const x of homeward) { const k = `${x.h.systemIndex}>${x.home}`; if (!byLeg.has(k)) byLeg.set(k, []); byLeg.get(k).push(x); }
  for (const [, xs] of [...byLeg.entries()].sort((a, b) => a[0].localeCompare(b[0]))) {
    const r = startJourney(book, world, { kind: 'return', ref: op.id, sponsor: op.faction, hulls: xs.map((x) => x.h), destination: xs[0].home, purpose: 'return', authority: { kind: 'return', ref: op.id }, meta: { home: xs[0].home, opId: op.id } }, day, effects);
    for (const { h } of xs) h.opId = null; // the operation is over; flying home, the ship points at none
    if (!r.ok || r.arrived) for (const { h } of xs) { h.status = releaseStatus(h); h.originSystem = null; }
  }
  addHistory(book, day, 'battle', note || `${world.factionName(op.faction)} operation at ${world.systems[op.targetSystem]?.name}: ${outcome} (${op.losses} lost, ${op.defenderLosses} defenders lost).`, { opId: op.id, systemIndex: op.targetSystem, outcome, faction: op.faction });
  effects.push({ type: 'operationResolved', opId: op.id, faction: op.faction, targetSystem: op.targetSystem, outcome, losses: op.losses, defenderLosses: op.defenderLosses, day, resolvedBy: op.resolvedBy, encounterId: op.resolvedBy === 'local' ? op.encounterId || null : null });
}
// A single operation ending by something other than battle (DOCTRINE-RUNTIME-PHASE3: an accepted
// surrender). Survivors are released the ordinary way.
export function standDownOperation(book, world, opId, day, effects = [], outcome = 'stood-down', note = null) {
  const op = (book.operations || []).find((o) => o.id === opId);
  if (!op || op.status === 'resolved' || op.resolvedBy === 'local') return false;
  finishOperation(book, world, op, day, outcome, effects, 'doctrine', note);
  return true;
}
// Local scene reconciliation: the engine takes ownership of an engaged operation while the player is
// present, materialises exactly these hulls, and hands back survivors and an outcome once.
export function claimOperationForScene(book, opId, world = null, day = null) {
  const op = book.operations.find((o) => o.id === opId);
  if (!op || op.status !== 'engaged') return null;
  // An operation the model already handed off (the captain was there on the day it engaged) is claimed by
  // taking up its pending encounter; otherwise it must be free of any resolution.
  const pending = SE.liveEncounterFor(book, 'operation', op.id);
  if (op.resolvedBy && !(pending && op.resolvedBy === 'local')) return null;
  if (pending && pending.status !== 'pending') return null;
  const enc = pending || openOperationEncounter(book, world, op, day ?? op.engagedDay ?? 0, 'the scene claimed it');
  if (enc) SE.activateEncounter(book, enc.id, day ?? op.engagedDay ?? 0, []); // the engine records each ship as it actually appears
  // Only the force actually standing at the target, able to fight, is the scene's: a hull disabled on the
  // way, surrendered, or still in warp stays where it is and is not materialised.
  const ids = enc ? enc.participants.filter((p) => p.side === 'attacker').map((p) => p.hullId) : [];
  op.sceneHullIds = ids;
  const hulls = ids.map((id) => hullOf(book, op.faction, id)).filter(Boolean);
  return { op, hulls: hulls.map((h) => ({ ...h })), encounter: enc };
}
// Everyone whose forces actually stand in a world's defence against this attacker, hull by hull: the ships
// that appear in the scene as its defenders (never an abstract strength beside them). The captain's own
// vessels are the engine's and are recorded, not spawned.
export function defendingHullsAt(book, world, systemIndex, attackerId) {
  if (!world) return [];
  const out = [];
  for (const id of defendingPolityIds(book, world, systemIndex, attackerId)) {
    for (const h of polity(book, id).hulls) if (defendsHere(h, systemIndex) && !hullInEncounter(h)) out.push({ h, polity: id });
  }
  return out;
}
function lookupHull(book) { return (p) => (p.hullId != null && p.polity ? hullOf(book, p.polity, p.hullId) : null); }
export function encounterHullLookup(book) { return lookupHull(book); }
function openOperationEncounter(book, world, op, day, reason) {
  const force = Array.isArray(op.journeyIds) ? operationForce(book, op) : operationHulls(book, op);
  const defenders = defendingHullsAt(book, world, op.targetSystem, op.faction);
  op.handoffs = (op.handoffs || 0) + 1;
  const holder = world?.systems[op.targetSystem]?.controller ?? op.defender ?? null;
  const { enc, fresh } = SE.openEncounter(book, { key: `op:${op.id}:h${op.handoffs}`, system: op.targetSystem, type: 'operation', objective: { kind: 'operation', ref: op.id },
    authority: op.war ? { kind: 'war', stamp: op.war } : { kind: op.kind || 'operation' }, sides: { a: op.faction, b: holder }, journeys: op.journeyIds || [],
    playerHostile: holder === 'player' || (world ? formallyAtWar(world, op.faction, 'player') : false), reason,
    contact: { engagedDay: op.engagedDay ?? day, opKind: op.kind },
    participants: [...force.map((h) => ({ hullId: h.id, polity: op.faction, side: 'attacker', record: h })),
      ...defenders.map(({ h, polity: pid }) => ({ hullId: h.id, polity: pid, side: 'defender', record: h, engineOwned: pid === 'player', spawn: pid !== 'player' }))] }, day, lookupHull(book));
  if (fresh) op.resolvedBy = 'local';
  op.encounterId = enc.id;
  return enc;
}
// The scene's result for a claimed battle. `survivorReport` = [{ hullId, hull, destroyed?, fate? }] for the
// attackers (and, when the engine reports them, the defenders); `outcome` destroyed | withdrew | captured.
export function reconcileLocalOutcome(book, world, opId, survivorReport, outcome, day, effects = []) {
  const op = book.operations.find((o) => o.id === opId);
  if (!op || op.status === 'resolved') return false;
  const enc = SE.liveEncounterFor(book, 'operation', op.id);
  if (enc) {
    const participants = {};
    for (const p of enc.participants) {
      if (p.engineOwned) continue;
      const s = survivorReport.find((r) => String(r.hullId) === String(p.hullId));
      if (!s) { if (p.side === 'attacker') participants[p.ref] = { fate: 'destroyed', hull: 0 }; continue; }
      participants[p.ref] = { fate: s.destroyed ? 'destroyed' : s.fate || 'survived', hull: s.destroyed ? 0 : s.hull, crew: s.crew ?? null, vid: s.vid ?? null, to: s.to ?? null };
    }
    SE.resolveEncounter(book, world, enc.id, { result: { outcome }, participants }, day, effects, lookupHull(book));
    return true;
  }
  // A claim from before encounters existed (an old save mid-battle): the old reconciliation, once.
  const p = polity(book, op.faction);
  const inScene = Array.isArray(op.sceneHullIds) ? new Set(op.sceneHullIds) : null;
  for (const h of operationHulls(book, op)) {
    if (inScene && !inScene.has(h.id)) continue;
    const s = survivorReport.find((r) => r.hullId === h.id);
    if (!s || s.destroyed) { h.hull = 0; h.status = 'lost'; op.losses++; p.lostHulls++; book.stats.hullsLost++; }
    else h.hull = bounded(Number(s.hull) || h.hull, 0, h.maxHull);
  }
  finishOperation(book, world, op, day, outcome, effects, 'local');
  if (outcome === 'captured') { const from = world.systems[op.targetSystem]?.controller || null; recordCapture(book, world, op.targetSystem, op.faction, from, day); for (const h of operationHulls(book, op)) { if (inScene && !inScene.has(h.id)) continue; if (h.transit || hullIsDisabled(h) || h.status === 'surrendered') continue; h.status = releaseStatus(h); h.opId = null; h.systemIndex = op.targetSystem; } }
  return true;
}
// The captain left mid-battle: what the scene did so far is written back onto the same hulls, and the
// offscreen model carries the battle on from there (the encounter is resolved as 'disengaged').
export function releaseOperationFromScene(book, opId, survivorReport, world = null, day = null) {
  const op = book.operations.find((o) => o.id === opId);
  if (!op || op.status !== 'engaged' || op.resolvedBy !== 'local') return false;
  const enc = SE.liveEncounterFor(book, 'operation', op.id);
  if (enc) {
    const participants = {};
    for (const p of enc.participants) {
      if (p.engineOwned) continue;
      const s = survivorReport.find((r) => String(r.hullId) === String(p.hullId));
      if (!s) { if (p.side === 'attacker' && enc.status === 'tactical_active' && (enc.spawned || []).includes(p.vid)) participants[p.ref] = { fate: 'destroyed', hull: 0 }; continue; }
      participants[p.ref] = { fate: s.destroyed ? 'destroyed' : s.fate || 'survived', hull: s.destroyed ? 0 : s.hull, crew: s.crew ?? null, vid: s.vid ?? null, to: s.to ?? null };
    }
    SE.resolveEncounter(book, world, enc.id, { result: { outcome: 'disengaged' }, participants }, day ?? op.engagedDay ?? 0, [], lookupHull(book));
    return true;
  }
  const p = polity(book, op.faction);
  for (const h of operationHulls(book, op)) { const s = survivorReport.find((r) => r.hullId === h.id); if (!s || s.destroyed) { h.hull = 0; h.status = 'lost'; op.losses++; p.lostHulls++; book.stats.hullsLost++; } else h.hull = bounded(Number(s.hull) || h.hull, 0, h.maxHull); }
  op.resolvedBy = null; // offscreen resolution may continue from the persisted state
  return true;
}
// The engine's entry points: the same encounter functions, with the book's own hull lookup.
// A battle that fell back to the model is not handed to the scene again the same day (it was settled for
// that day); the next day it may be. (An older record without the day counts as today.)
// The safety net under every guard: a handoff still pending while the captain is not in its system (he left,
// or it was opened and never taken up) is settled by the model, once, instead of holding the objective.
export function settleAbandonedHandoff(book, world, enc, day, effects) {
  if (!enc || !SE.isLive(enc) || (world.localSystem != null && Number(world.localSystem) === Number(enc.system))) return false;
  if (enc.status === 'pending') { SE.fallbackEncounter(book, world, enc.id, day, effects, 'the captain was gone before the scene took it up', lookupHull(book)); return true; }
  // An engagement being fought is only given up when the captain is known to be somewhere else (in warp,
  // or in a world that does not place him, the departure itself has already handed it back).
  if (world.localSystem == null) return false;
  // A scene he is no longer in can fight nothing: the engagement is disengaged with the records as they stand
  // (the scene's damage, if any, was written when he left), and the strategic layer carries on.
  SE.resolveEncounter(book, world, enc.id, { result: { outcome: 'disengaged', note: 'no scene: the captain is elsewhere' }, participants: {} }, day, effects, lookupHull(book));
  return true;
}
export function fellBackToday(op, day) { return op?.handoff === 'fallback' && Number(op.handoffFallbackDay ?? day) === Number(day); }
export function resolveEncounterNow(book, world, id, report, day, effects = []) { return SE.resolveEncounter(book, world, id, report, day, effects, lookupHull(book)); }
export function fallbackEncounterNow(book, world, id, day, effects = [], reason = 'no tactical scene') { return SE.fallbackEncounter(book, world, id, day, effects, reason, lookupHull(book)); }
// ---- one tactical fate on one strategic hull (STRATEGIC-TACTICAL-HANDOFF §5) ----
// The same record, the same vid: destroyed retires it; disabled leaves it where it is, stranded, awaiting
// recovery (no repair); surrendered follows the Phase 4 rules (doctrine registers that hook); anything else
// writes the hull the scene left it with. The hull figure and the fate must agree: a ship reported
// "survived" at a disabled hull is disabled.
function applyEncounterFate(book, world, p, r, enc, day, effects) {
  const h = hullOf(book, p.polity, p.hullId);
  if (!h || h.status === 'lost') return null;
  const maxHull = Number(h.maxHull) || 1;
  let fate = r.fate || 'survived';
  let hull = fate === 'destroyed' ? 0 : r.hull != null ? bounded(Number(r.hull), 0, maxHull) : Number(h.hull);
  if (r.crew != null && Number.isFinite(Number(r.crew))) h.crew = bounded(Number(r.crew), 0, 1);
  const cond = classifyDamage(hull, maxHull);
  if (fate !== 'surrendered') {
    if (cond === 'destroyed') fate = 'destroyed';
    else if (cond === 'disabled') fate = 'disabled';
    else if (fate === 'disabled') hull = Math.min(hull, Math.max(1, Math.floor(disableThreshold(maxHull))));
  }
  p.fate = fate;
  if (fate === 'destroyed') {
    if (h.transit) delete h.transit;
    loseHull(book, world, p.polity, h.id, enc.system, day, effects, enc.sides?.a === p.polity ? enc.sides?.b : enc.sides?.a);
    h.fate = 'destroyed_in_action';
    return { lost: true };
  }
  h.hull = Math.round(hull * 10) / 10;
  if (fate === 'disabled') {
    // It stays in the encounter's system, off whatever job it had, in the accepted stranded model.
    if (h.transit) delete h.transit;
    h.systemIndex = Number(enc.system);
    if (h.defendingAt != null) delete h.defendingAt;
    if (!h.stranded && p.polity !== 'player') strandHull(book, h, p.polity, day, effects);
    if (h.status === 'ready' || h.status === 'assigned') h.status = 'repairing';
    return { disabled: true };
  }
  if (fate === 'surrendered') {
    const hook = SE.fateHooks().surrender;
    if (hook) hook(book, world, { polity: p.polity, hullId: h.id, to: r.to || (enc.sides?.a === p.polity ? enc.sides?.b : enc.sides?.a) || 'player', day, reason: `surrendered in the engagement at system ${enc.system}`, acceptedBy: r.acceptedBy || 'tactical', objectiveId: enc.objective?.ref ?? null }, effects);
    else { h.status = 'surrendered'; h.surrendered = { to: r.to || 'player', day, systemIndex: Number(enc.system), reason: 'surrendered in a tactical engagement' }; }
    return { surrendered: true };
  }
  return { survived: true };
}
SE.registerFateHooks({ applyFate: applyEncounterFate });
// ---- encounter families: operations ----
SE.registerEncounterFamily('operation', {
  resolve(book, world, enc, report, day, effects) {
    const op = operationById(book, enc.objective.ref);
    if (!op || op.status === 'resolved') return { continuation: 'the operation was already over' };
    const outcome = report.result?.outcome || 'destroyed';
    for (const p of enc.participants) {
      if (p.fate !== 'destroyed') continue;
      if (p.side === 'attacker') op.losses = (op.losses || 0) + 1;
      else op.defenderLosses = (op.defenderLosses || 0) + 1;
    }
    op.sceneHullIds = null;
    if (outcome === 'disengaged') {
      // What was fought is written; the rest of the battle goes back to the offscreen model.
      op.resolvedBy = null;
      return { continuation: 'the offscreen battle carries on from the scene\'s state' };
    }
    // Only a live war still authorises the outcome: a ceasefire that came during the fight ends it as a
    // withdrawal, never a capture.
    const final = outcome === 'captured' && !operationIsAuthorised(book, world, op) ? 'withdrew' : outcome;
    finishOperation(book, world, op, day, final, effects, 'local');
    if (final === 'captured') {
      const from = world.systems[op.targetSystem]?.controller || null;
      recordCapture(book, world, op.targetSystem, op.faction, from, day);
      const scene = new Set(enc.participants.filter((p) => p.side === 'attacker').map((p) => p.hullId));
      for (const h of operationHulls(book, op)) { if (!scene.has(h.id)) continue; if (h.transit || hullIsDisabled(h) || h.status === 'surrendered') continue; h.status = releaseStatus(h); h.opId = null; h.systemIndex = op.targetSystem; }
    }
    return { continuation: final === 'captured' ? 'captured: the victors hold the world' : 'survivors fly home by journey', objectiveClosed: true };
  },
  fallback(book, world, enc, day, effects) {
    const op = operationById(book, enc.objective.ref);
    if (!op || op.status !== 'engaged') return { continuation: 'nothing to resolve' };
    op.resolvedBy = null; op.handoff = 'fallback'; op.handoffFallbackDay = day; op.sceneHullIds = null;
    resolveOffscreenDay(book, world, op, day, effects);
    return { continuation: 'resolved offscreen (one battle day), then offscreen as usual' };
  },
  abort(book, enc) {
    const op = operationById(book, enc.objective.ref);
    if (op && op.resolvedBy === 'local') { op.resolvedBy = null; op.sceneHullIds = null; }
  },
});

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
    // Covert preparation includes the authored agreement: Central concludes the pacts the storyline
    // names, with partners that still hold ground and are not at war with it. The pact is a treaty
    // record from here on; nothing about it is read off friendship.
    for (const partner of c.dominionAuthoredPacts || []) {
      if (!book.polities[partner] || !controlled(world, partner).length || pactActive(book, 'dominion', partner)) continue;
      activatePact(book, world, 'dominion', partner, day, effects, 'a secret agreement concluded while the expedition prepares');
    }
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
    const staged = dominion.hulls.filter((h) => h.status === 'ready' && !hullUnavailable(h) && h.systemIndex === d.stagingSystem);
    // The invasion plan says, explicitly, who the opening attacks. The corridor is forced only against a
    // holder on the authored list; an unheld terminus is occupied unopposed; a holder off the list (a pact
    // partner) is not attacked and the crossing waits. Holding the entry world is never itself a war.
    const holder = world.systems[d.entrySystem]?.controller ?? null;
    const holderAtWar = holder != null && holder !== 'dominion' && formallyAtWar(world, 'dominion', holder);
    const forced = holder != null && holder !== 'dominion' && (c.dominionCorridorTargets || []).includes(holder)
      && world.relation('dominion', relSide(world, holder)) !== 'allied';
    // A corridor a pact partner holds is not forced: the expedition crosses into the partner's world under
    // the pact, unopposed, and declares on no one for it.
    // Only an active, authored pact opens a partner's corridor; alignment or friendship alone does not.
    const partnerCorridor = holder != null && holder !== 'dominion' && !holderAtWar && pactActive(book, 'dominion', holder);
    const passable = holder == null || holder === 'dominion' || holderAtWar || forced || partnerCorridor;
    if (staged.length > 0 && opportunity.corridorOpen && !passable && d.corridorHeldBy !== holder) {
      d.corridorHeldBy = holder;
      addHistory(book, day, 'dominion', `The crossing waits: ${world.systems[d.entrySystem]?.name} is held by ${world.factionName(holder)}, which the invasion plan does not attack.`);
    }
    if (staged.length > 0 && opportunity.corridorOpen && passable) {
      commitPhase('invasion');
      const warTargets = [...new Set([...(forced && !holderAtWar ? [holder] : []),
        ...(c.dominionOpeningAlsoDeclare || []).filter((x) => (x === 'player' || book.polities[x]) && !formallyAtWar(world, 'dominion', x))])];
      const pacts = activePacts(book, 'dominion');
      d.plan = { day, objective: Number(d.entrySystem), holder, warTargets, pacts, partnerCorridor,
        reason: forced ? `forcing the ${entry.name || 'Bajoran Wormhole'} at ${world.systems[d.entrySystem]?.name}`
          : partnerCorridor ? `an unopposed crossing into ${world.factionName(holder)}-held ${world.systems[d.entrySystem]?.name} under the pact`
          : 'an unopposed crossing' };
      for (const x of warTargets) declareFormalWar(book, world, 'dominion', x, day, effects, { reason: x === holder ? d.plan.reason : 'the invasion plan', source: 'authored', by: 'dominion' });
      if (partnerCorridor) {
        // No assault: the staged force comes through the wormhole and stands at the partner's terminus —
        // a real crossing, on the shared journey (STRATEGIC-MOVEMENT-UNIFICATION).
        for (const h of staged) h.status = 'assigned';
        const r = startJourney(book, world, { kind: 'expedition', ref: 'dominion:corridor', sponsor: 'dominion', hulls: staged, destination: Number(d.entrySystem), purpose: 'move',
          authority: { kind: 'pact', ref: pactKey('dominion', holder) } }, day, effects);
        if (r.ok && !r.arrived) for (const h of staged) h.opId = r.journey.id;
        else for (const h of staged) { h.status = releaseStatus(h); if (!r.ok) continue; }
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
    const entryFriendly = entryHolder === 'dominion' || (entryHolder != null && pactActive(book, 'dominion', entryHolder));
    const blockaded = localDefenseStrength(book, world, d.entrySystem) >= c.dominionBlockadeStrength && !entryFriendly;
    d.reinforcementCut = blockaded;
    if (!blockaded && d.convoys < c.dominionMaxConvoys && (d.lastConvoyDay == null || day - d.lastConvoyDay >= c.dominionReinforcementEveryDays)) {
      d.lastConvoyDay = day; d.convoys++;
      const bridgehead = entryFriendly ? d.entrySystem : d.stagingSystem;
      // Reinforcements come from beyond the map to the far terminus (authored); from there to a friendly
      // near-side terminus they make the crossing like anyone else.
      const fresh = [];
      for (let i = 0; i < c.dominionReinforcementHulls; i++) { const h = addHull(book, world, 'dominion', d.stagingSystem, `convoy:${d.convoys}:${i}`); if (h) fresh.push(h); }
      if (fresh.length && Number(bridgehead) !== Number(d.stagingSystem)) {
        for (const h of fresh) h.status = 'assigned';
        const r = startJourney(book, world, { kind: 'expedition', ref: `dominion:convoy:${d.convoys}`, sponsor: 'dominion', hulls: fresh, destination: Number(bridgehead), purpose: 'reinforce',
          authority: { kind: 'reinforcement', ref: `dominion:convoy:${d.convoys}` } }, day, effects);
        if (r.ok && !r.arrived) for (const h of fresh) h.opId = r.journey.id;
        else for (const h of fresh) h.status = releaseStatus(h);
      }
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
  closePairBlockades(book, world, st.a, st.b, day, effects, t.to);
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
  // Treaty terms the settlement carries (TREATY-EXPANSION §16): created here, bound to this war instance, never
  // copied to a follower's inherited war (a follower is not a party to its government's terms).
  const treatyIds = [];
  if (source !== 'inherited' && Array.isArray(t.treaty) && t.treaty.length) {
    // A clause string reads `by` (grants or pays) as the loser and `to` as the winner; a negotiated settlement
    // names them ({ clause, by, to }) or gives full term specs.
    // With no winner or loser (a negotiated settlement) a bare clause string names nobody: only a symmetric clause
    // (a DMZ, a blockade lift) is read from it; anything with a payer or a grantor must say who ({ clause, by, to }).
    const ctx = t.loser && t.winner ? { by: t.loser, to: t.winner } : { by: st.a, to: st.b, symmetric: true };
    const specs = t.treaty.map((x) => (typeof x === 'string' ? treatyClauseSpecs(world, [x], ctx)[0] : x?.clause ? treatyClauseSpecs(world, [x.clause], { by: x.by ?? ctx.by, to: x.to ?? ctx.to })[0] : x));
    for (const spec of specs) {
      const r = addTreatyTerm(book, world, spec, day, effects, { warKey: st.key, warId: st.warId, instance: st.instance ?? null, to: t.to, day });
      if (r.ok) treatyIds.push(r.term.id);
    }
    st.treatyTerms = [...(st.treatyTerms || []), ...treatyIds];
    if (st.settlement && t.to === 'peace') st.settlement.treatyTerms = treatyIds.slice();
  }
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
  effects.push({ type: t.to === 'peace' ? 'warResolved' : 'warCeasefire', key: st.key, a: st.a, b: st.b, warId: st.warId, to: t.to, basis: t.basis, winner: t.winner, loser: t.loser, reason: t.reason, terms: applied, standDown: closed, source, parentKey: t.parentKey || null, alsoBinds: bound, treatyTerms: treatyIds, day });
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
export function forceWarTransition(book, world, a, b, to, day, reason = 'Directed settlement', basis = 'directed', opts = {}) {
  const key = warKey(a, b);
  const pair = warPairsInView(book, world).find((p) => warKey(p.a, p.b) === key) || { a, b, warId: book.warStates?.[key]?.warId || 'static', warStarted: day };
  let st = book.warStates?.[key];
  if (!st || st.warId !== (pair.warId || 'static') || st.status === 'peace') st = openWarInstance(book, world, pair, day);
  const effects = [];
  const terms = to === 'peace' ? settlementTerms('negotiated', null, pairOccupations(book, world, st), Object.fromEntries([st.a, st.b].map((id) => [id, polityReadiness(book, world, id).strength]))) : [];
  applyWarTransitionInModel(book, world, st, { to, basis, winner: opts.winner ?? null, loser: opts.loser ?? null, reason, terms, treaty: opts.treaty || null }, day, effects, 'directed');
  return effects;
}
// ---------- treaties: authored pacts (DOMINION-FORMAL-WAR-RULES §2a) ----------
// A pact is an explicit treaty record, never read off static friendship or alignment. `dominionPactPartners`
// says who is eligible for an authored Dominion pact; only an authored agreement activates one, and only an
// active one grants its benefits. The record is typed, names its parties, carries its own start/end and
// knowledge state, and is persisted with the book, so later terms (corridors, guarantees) can sit alongside.
export function pactKey(a, b) { return `pact:${warKey(a, b)}`; }
export function pactRecord(book, a, b) { return book.treaties?.[pactKey(a, b)] || null; }
export function pactActive(book, a, b) { return pactRecord(book, a, b)?.status === 'active'; }
// The powers `government` holds an active pact with. Nothing is inherited: a follower bound to the
// government (the Remnant under Central command) has no pact of its own unless one is made with it.
export function activePacts(book, government) {
  return Object.values(book.treaties || {}).filter((t) => t.kind === 'pact' && t.status === 'active' && t.parties.includes(government))
    .map((t) => t.parties.find((x) => x !== government)).filter(Boolean).sort();
}
export function activatePact(book, world, government, partner, day, effects = [], reason = 'a secret agreement is concluded') {
  const eligible = government === 'dominion' ? (book.config.dominionPactPartners || []) : [];
  if (!eligible.includes(partner)) return { ok: false, reason: `${world.factionName(partner)} is not an eligible pact partner of ${world.factionName(government)}.` };
  if (!book.polities[partner] || !book.polities[government]) return { ok: false, reason: 'Unknown party.' };
  if (formallyAtWar(world, government, partner)) return { ok: false, reason: `${world.factionName(government)} and ${world.factionName(partner)} are at war.` };
  book.treaties ||= {};
  const key = pactKey(government, partner);
  const prior = book.treaties[key];
  if (prior?.status === 'active') return { ok: true, record: prior, unchanged: true };
  const record = { key, kind: 'pact', parties: [government, partner].sort(), status: 'active', since: day, endedDay: null, reason, endReason: null,
    // Knowledge: a secret agreement. Nobody is told; a later round may reveal it through intelligence.
    secret: true, knownTo: [], instance: (prior?.instance || 0) + 1 };
  book.treaties[key] = record;
  addHistory(book, day, 'treaty', `Pact concluded between ${world.factionName(government)} and ${world.factionName(partner)}: ${reason}.`, { key, secretOf: key });
  effects.push({ type: 'pactChanged', key, parties: record.parties, status: 'active', reason, day, secret: true });
  return { ok: true, record };
}
// Who may read a campaign-history entry. One rule for every player-facing view: an entry tied to a secret
// record (`secretOf`, a treaty key) is visible only once that record is no longer secret or the viewer is
// in its `knownTo`; an entry marked `secret` on its own reads its own `knownTo`. The entry itself is never
// rewritten, so a later intelligence round that adds the captain to a treaty's knownTo reveals its whole
// history as it was recorded. The book keeps everything; only what is shown is filtered.
export function historyVisibleTo(book, entry, viewer = 'player') {
  if (!entry) return false;
  // A treaty term's entry: visible to whoever may see the term (a secret one only to those who know of it).
  if (entry.secretTerm) { const t = (book.treatyTerms || []).find((x) => x.id === entry.secretTerm); return Boolean(t) && TT.termVisibleTo(t, viewer); }
  if (entry.secretOf) {
    const rec = book.treaties?.[entry.secretOf];
    if (!rec) return false;
    return !rec.secret || (rec.knownTo || []).includes(viewer);
  }
  if (entry.secret) return (entry.knownTo || []).includes(viewer);
  return true;
}
export function visibleHistory(book, viewer = 'player') {
  return (book.history || []).filter((h) => historyVisibleTo(book, h, viewer));
}
// Whether a viewer knows of a pact. Nothing reveals one yet; the knowledge state is the hook.
export function pactKnownTo(book, a, b, viewer = 'player') {
  const rec = pactRecord(book, a, b);
  return Boolean(rec && (!rec.secret || (rec.knownTo || []).includes(viewer)));
}
// A pact ends or collapses: its benefits go at once. Nothing else follows: no hostility, no war, no
// change to the ordinary diplomatic relation between the two.
export function endPact(book, world, government, partner, day, effects = [], reason = 'the agreement collapses') {
  const record = pactRecord(book, government, partner);
  if (!record || record.status !== 'active') return { ok: false, reason: 'No active pact.' };
  record.status = 'collapsed'; record.endedDay = day; record.endReason = reason;
  addHistory(book, day, 'treaty', `Pact between ${world.factionName(government)} and ${world.factionName(partner)} ended: ${reason}.`, { key: record.key, secretOf: record.key });
  effects.push({ type: 'pactChanged', key: record.key, parties: record.parties, status: 'collapsed', reason, day, secret: record.secret });
  return { ok: true, record };
}
// ---------- formal declarations, expeditions, withdrawal, followers (DOMINION-FORMAL-WAR-RULES) ----------
function formallyAtWar(world, a, b) { return world.relation(relSide(world, a), relSide(world, b)) === 'war'; }
// The authority a war order rests on, stamped when the order is given: who holds the target, which war
// between the pair, and which instance of it. An order stays good only while that same war is still a
// formal war and the target is still held by the same enemy. A ceasefire, a peace, a new war after a
// settlement, or the target changing hands each end it. [FORMATION-ROUTE-TRAVERSAL-RULES]
export function warAuthorityStamp(book, world, power, target) {
  const holder = world.systems[Number(target)]?.controller ?? null;
  if (holder == null || holder === power || !formallyAtWar(world, power, holder)) return null;
  const key = warKey(power, holder);
  const st = book.warStates?.[key];
  if (st && st.status !== 'war') return null;
  return { power, holder, target: Number(target), key, instance: st?.instance ?? 0, warId: st?.warId ?? null };
}
export function warAuthorityHolds(book, world, stamp) {
  if (!stamp) return false;
  const now = warAuthorityStamp(book, world, stamp.power, stamp.target);
  return Boolean(now && now.holder === stamp.holder && now.key === stamp.key && now.instance === stamp.instance && now.warId === stamp.warId);
}
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
  // A reinforcement counts once it has physically arrived (STRATEGIC-TIME-SCALE-CORRECTION): one still in
  // the corridor, under way to the bridgehead, is incoming, not strength.
  const inReach = livingHulls(p).filter((h) => near.has(Number(h.systemIndex)) || Number(h.systemIndex) === staging);
  // Ships moving about the theatre (an assault, a return) are its strength; a reinforcement convoy or the
  // corridor crossing still under way (kind `expedition`) is not yet.
  const arriving = (h) => Boolean(h.transit) && journeyById(book, h.transit.journeyId)?.kind === 'expedition';
  const present = inReach.filter((h) => !arriving(h));
  const strength = present.reduce((n, h) => n + hullStrength(book, world, h), 0);
  const incomingStrength = inReach.filter(arriving).reduce((n, h) => n + hullStrength(book, world, h), 0);
  const capacity = Math.max(Number(p.readinessBaseline) || 0, Number(d.expeditionPeak) || 0, strength);
  const share = capacity > 0 ? strength / capacity : null;
  const bridgeheads = (id === 'dominion' ? dominionGround(book, world, near) : controlled(world, id).filter((s) => near.has(Number(s.index))).map((s) => s.index)).length;
  const entryHolder = world.systems[entry]?.controller ?? null;
  const access = entryHolder === id || (entryHolder && pactActive(book, id, entryHolder)) || !d.reinforcementCut;
  const convoysLeft = Math.max(0, (c.dominionMaxConvoys || 0) - (d.convoys || 0));
  const replace = Boolean(access && convoysLeft > 0);
  // Partner support needs an active pact (read now, not from the plan) with a partner that still holds
  // ground and is actually supporting: fighting one of Central's enemies, or hosting the expedition at
  // its own terminus. A pact is necessary for support, not sufficient.
  const enemies = warPairsInView(book, world).filter((q) => [q.a, q.b].includes(id) && q.status === 'war' && !q.inheritedFrom).map((q) => (q.a === id ? q.b : q.a));
  const partners = activePacts(book, id).filter((pid) => book.polities[pid] && controlled(world, pid).length > 0
    && (enemies.some((e) => formallyAtWar(world, pid, e)) || (entryHolder === pid && Boolean(d.plan?.partnerCorridor))));
  const remnant = Object.entries(book.commandBindings || {}).find(([, b]) => b?.to === id)?.[0] || null;
  const blender = Boolean(remnant && book.polities[remnant] && livingHulls(book.polities[remnant]).length > 0);
  const reasons = [];
  if (share != null) reasons.push(`${Math.round(share * 100)}% of its best strength on this side`);
  reasons.push(bridgeheads ? `${bridgeheads} bridgehead${bridgeheads > 1 ? 's' : ''}` : 'no bridgehead');
  reasons.push(access ? 'the wormhole open' : 'the wormhole closed to it');
  reasons.push(replace ? `${convoysLeft} convoy${convoysLeft > 1 ? 's' : ''} still to come` : 'no way to replace losses');
  // Reasons are read by the captain (reports, the Wars & treaties front line): a secret partner he does
  // not know of is never named, and its support is not mentioned at all.
  const namedPartners = partners.filter((x) => pactKnownTo(book, id, x, 'player'));
  if (namedPartners.length) reasons.push(`support from ${namedPartners.map((x) => world.factionName(x)).join(', ')}`);
  if (blender) reasons.push('the Blender front under its command');
  if (incomingStrength > 0) reasons.push('reinforcements still in the corridor');
  // Ships still under way are not strength yet, but Central does not call the expedition collapsed while
  // they are on their way.
  const collapsed = share != null && share <= (c.expeditionCollapseShare ?? 0.35) && !replace && !partners.length && !blender && incomingStrength <= 0;
  const stranded = bridgeheads === 0 && !access && strength <= 0 && incomingStrength <= 0;
  return { id, active: ['invasion'].includes(d.phase) || id !== 'dominion', strength, incomingStrength, capacity, share, bridgeheads, access, convoysLeft, replace,
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
    // The near-side force flies back through the wormhole to the far terminus, leg by leg, one journey per
    // system it stands in (STRATEGIC-MOVEMENT-UNIFICATION).
    const groups = new Map();
    for (const h of livingHulls(polity(book, id))) {
      if (h.status !== 'ready' || h.opId || hullUnavailable(h) || !near.has(Number(h.systemIndex)) || !Number.isFinite(staging)) continue;
      const k = Number(h.systemIndex); if (!groups.has(k)) groups.set(k, []); groups.get(k).push(h);
    }
    for (const [, hs] of [...groups.entries()].sort((a, b) => a[0] - b[0])) {
      for (const h of hs) h.status = 'assigned';
      const r = startJourney(book, world, { kind: 'withdrawal', ref: `${id}:withdrawal`, sponsor: id, hulls: hs, destination: staging, purpose: 'withdraw', authority: { kind: 'withdrawal', ref: `${id}:withdrawal`, basis } }, day, effects);
      if (r.ok && !r.arrived) moved.push(...hs.map((h) => h.id));
      else for (const h of hs) h.status = releaseStatus(h);
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
    .map((sys) => ({ index: sys.index, controller: sys.controller, hops: world.routeHops(heldNear, sys.index, 'dominion'), eta: forceEtaDays(world, chosen, sys.index, 'dominion') }))
    .filter((x) => x.hops != null && x.eta != null)
    .sort((x, y) => x.eta - y.eta || x.index - y.index);
  // The soonest in real days that the force can take against the defence it will meet on arrival
  // (TIME-SCALE-CORRECTION).
  const target = candidates.find((x) => x.eta <= c.maxOperationEtaDays && strength >= forceAccount(book, world, x.index, day + x.eta, 'dominion').atEta * c.minReadinessRatioToAttack);
  if (!target) return null;
  const name = world.systems[target.index]?.name || `system ${target.index}`;
  const st = declareFormalWar(book, world, 'dominion', target.controller, day, effects, { reason: `a deliberate attack on ${name}`, source: 'escalation', by: 'dominion' });
  const op = launchOperation(book, world, 'dominion', chosen, target.index, day, target.hops, 'assault', effects);
  op.declares = st.key; st.declared.opId = op.id;
  d.lastEscalationDay = day;
  return op;
}
// ---------- the shared strategic journey (STRATEGIC-MOVEMENT-UNIFICATION) ----------
// Every model-side mover — an AI war operation and its survivors going home, a damaged hull sailing to a
// yard, a blockade force taking station, an evacuation convoy, the Dominion's corridor crossing, its
// reinforcements and its withdrawal, a doctrine vessel on its errand — flies the one journey record of
// strategic-journey.mjs: a real route, one leg at a time, each leg its real length in days
// (world.legDays; one day where a world gives none), every system on the way reached and processed once,
// every blockade there run through resolveBlockadeRun. Members carry only the leg they are on
// (h.transit), exactly as a formation's members do; the journey record is authoritative.
//
// What a kind of mover does at a crossing, on arrival, when turned back or when its reason lapses is the
// kind's (JOURNEY_KINDS below; doctrine registers its own). The physical state is shared.
function journeyBook(book) {
  if (!Array.isArray(book.journeys)) book.journeys = [];
  book.stats ||= {};
  book.stats.journeys ||= { started: 0, crossings: 0, duplicateCrossingsPrevented: 0, arrived: 0, halted: 0, forcedBack: 0, staleCancelled: 0, legDays: 0, legs: 0, blockadeRuns: {}, byKind: {} };
  return book.journeys;
}
export function journeyById(book, id) { return (book.journeys || []).find((j) => j.id === id) || null; }
export function activeJourneys(book) { return (book.journeys || []).filter((j) => j.status === 'underway'); }
// The hop from a to b as the chart has it (SHIP-DEPENDENT-STRATEGIC-SPEED): its base days at speed 1.0 (the
// engine's distance over the daily range, or one) and whether it is a fixed traversal (a wormhole), whose
// days no ship can shorten or lengthen.
export function legBaseBetween(world, a, b) {
  const d = Number(world?.legDays?.(Number(a), Number(b)));
  return { days: Math.max(1, Math.round(Number.isFinite(d) && d > 0 ? d : 1)), fixed: Boolean(world?.legFixed?.(Number(a), Number(b))) };
}
export function routeLegBase(world, systems) {
  const out = [];
  for (let i = 1; i < (systems || []).length; i++) out.push(legBaseBetween(world, systems[i - 1], systems[i]));
  return out;
}
// The length in days of the hop from a to b for a mover at `speed` (null: the default 1.0, the chart's own
// days). The one formula every journey and every planner reads (strategic-speed.mjs: adjustLegDays).
export function legDaysBetween(world, a, b, speed = null) {
  const l = legBaseBetween(world, a, b);
  return SPD.adjustLegDays(l.days, speed, l.fixed);
}
export function routeLegDaysFor(world, systems, speed = null) {
  return SPD.legDaysAt(routeLegBase(world, systems), speed);
}
// A class's strategic speed, and a group's: the slowest of those able to travel (a disabled, surrendered or
// crewless hull is not travelling and does not count; a group with none of those left flies at the
// slowest of what it has, so a timing is always defined).
export function hullSpeed(world, h) { return SPD.classSpeed(h ? world?.shipStats?.(h.shipId) : null); }
export function hullCanTravel(h) { return Boolean(h) && h.status !== 'lost' && !hullIsDisabled(h) && h.status !== 'surrendered' && !hullAwaitingCrew(h); }
export function hullsSpeed(world, hulls) {
  const list = (hulls || []).filter(Boolean);
  const able = list.filter(hullCanTravel);
  return SPD.groupSpeed((able.length ? able : list).map((h) => hullSpeed(world, h))) ?? SPD.SPEED_DEFAULT;
}
// The speed a journey's members fly at: the slowest able member, or — a group with hulks in tow
// (tr.tow) — the tow speed: the towing group's multiplier × towPenalty, bounded (TOWING-SALVAGE-RULES §5).
// Escorts are part of the towing group: they can only slow it. The towed hull's own rating does not count.
export function journeySpeed(world, book, tr, hulls) {
  if (!tr?.tow?.targets?.length) return hullsSpeed(world, hulls);
  const towed = new Set(tr.tow.targets.map(String));
  const towing = hulls.filter((h) => !towed.has(String(h.id)));
  const g = towing.length ? hullsSpeed(world, towing) : SPD.SPEED_DEFAULT;
  return SPD.towSpeed(g, tr.tow.penalty ?? book?.config?.towPenalty ?? SPD.TOW_PENALTY);
}
// The model's adjacency for a journey: the chart's routes and the wormholes (an engine may close an edge
// to a power, as the uncharted Bajoran wormhole is closed to everyone but the Dominion).
// noFixed: leave out fixed traversals (a wormhole-only edge) — a tow is not carried through one
// (TOWING-SALVAGE-RECOVERY §6: unavailable rather than invented).
function journeyNeighbours(world, i, polityId, noFixed = false) {
  const out = new Set((world.neighbours(i) || []).map(Number));
  for (const w of world.wormholes || []) { if (Number(w.from) === i) out.add(Number(w.to)); if (Number(w.to) === i) out.add(Number(w.from)); }
  return [...out].filter((n) => world.edgeOpen ? world.edgeOpen(i, n, polityId) !== false : true).filter((n) => !noFixed || !world.legFixed?.(i, n)).sort((a, b) => a - b);
}
function routeFewestJumps(world, from, to, polityId, avoid = null, noFixed = false, barred = null) {
  const prev = new Map([[Number(from), null]]); const q = [Number(from)];
  // Treaty-barred systems (a DMZ): never entered, except on the way out of the zone the mover starts in.
  const leaving = Boolean(barred?.has(Number(from)));
  while (q.length) {
    const cur = q.shift();
    if (cur === Number(to)) break;
    for (const x of journeyNeighbours(world, cur, polityId, noFixed)) {
      if (prev.has(x) || (avoid && avoid.has(x) && x !== Number(to))) continue;
      if (barred && barred.has(x) && !(leaving && barred.has(cur))) continue;
      prev.set(x, cur); q.push(x);
    }
  }
  if (!prev.has(Number(to))) return null;
  const path = []; for (let x = Number(to); x != null; x = prev.get(x)) path.unshift(x);
  return world.routeHops([Number(from)], Number(to), polityId) == null ? null : path;
}
// A route for a model mover: the fewest jumps (the model's routes have always been jump-counted and blind
// to the captain's chart), each with its real length.
// The route never depends on the ship (the same systems, the same legs); only its days do.
// Treaty terms bind it too (TREATY-EXPANSION): a polity's traffic of the class given (opts.cls, military by
// default) is routed round a DMZ that binds it and never ends inside one; opts.treaty === false is the one
// explicit exception (a mover sent through in defiance, whose crossings are then incidents).
export function plotJourney(world, from, to, polityId, avoid = null, speed = null, opts = {}) {
  if (Number(from) === Number(to)) return { systems: [Number(from)], path: [], legDays: [], legBase: [], speed: speed == null ? SPD.SPEED_DEFAULT : SPD.clampSpeed(speed) };
  const barred = opts.treaty === false ? null : treatyBarredFor(world, polityId, opts.cls || 'military');
  if (barred && barred.has(Number(to))) return null;
  const systems = routeFewestJumps(world, from, to, polityId, avoid && avoid.size ? avoid : null, Boolean(opts.noFixed), barred);
  if (!systems) return null;
  const legBase = routeLegBase(world, systems);
  return { systems, path: systems.slice(1).map(Number), legDays: SPD.legDaysAt(legBase, speed), legBase, speed: speed == null ? SPD.SPEED_DEFAULT : SPD.clampSpeed(speed) };
}
// The days a plotted route takes, leg by leg, at `speed` (what a caller planning by time should read; pass
// the speed of the ships that will actually fly it — hullsSpeed).
export function journeyDays(world, from, to, polityId, speed = null) {
  const plan = plotJourney(world, from, to, polityId, null, speed);
  return plan ? plan.legDays.reduce((n, d) => n + d, 0) : null;
}
function vidOfHull(h) { return h?.identity?.vid || h?.vid || h?.id || null; }
function journeyMemberHulls(book, tr) { return tr.members.map((id) => hullOf(book, tr.sponsor, id)).filter(Boolean); }
function putMembersOnLeg(book, tr) {
  for (const h of journeyMemberHulls(book, tr)) {
    if (h.transit && h.transit.journeyId !== tr.id) continue;
    h.transit = { journeyId: tr.id, from: Number(tr.from), to: Number(tr.path[tr.legIndex]), arrivalDay: Number(tr.legArrivalDay), leg: tr.legIndex, seq: tr.seq };
  }
}
function journeyEffect(tr, type, day, extra = {}) {
  return { type, id: tr.id, seq: tr.seq, kind: tr.kind, ref: tr.ref, sponsor: tr.sponsor, purpose: tr.purpose, origin: tr.origin, destination: tr.destination,
    hulls: tr.members.slice(), vids: tr.members.map((id) => tr.vids?.[id] ?? id), day: Number(day), ...extra };
}
const JOURNEY_KINDS = {};
export function registerJourneyKind(kind, hooks) { JOURNEY_KINDS[kind] = { ...(JOURNEY_KINDS[kind] || {}), ...hooks }; }
// Start a journey for hulls standing together in one system. spec: { kind, ref, sponsor, hulls[], destination,
// purpose, war, authority, meta, prior, avoid, plan }. A group split between systems is refused, as a
// formation's dispatch is; a destination equal to where they stand arrives at once.
export function startJourney(book, world, spec, day, effects = []) {
  const list = journeyBook(book);
  const st = book.stats.journeys;
  const hulls = (spec.hulls || []).filter((h) => h && h.status !== 'lost');
  if (!hulls.length) return { ok: false, reason: 'no vessels' };
  const from = Number(spec.from ?? hulls[0].systemIndex);
  if (hulls.some((h) => Number(h.systemIndex) !== from)) return { ok: false, reason: 'split between systems' };
  if (hulls.some((h) => h.transit)) return { ok: false, reason: 'already under way' };
  const tow = spec.tow?.targets?.length ? { targets: spec.tow.targets.map(String), penalty: spec.tow.penalty ?? book.config.towPenalty ?? SPD.TOW_PENALTY, recoveryId: spec.tow.recoveryId ?? null, need: spec.tow.need ?? null } : null;
  // Treaty terms (TREATY-EXPANSION): the route is lawful for this traffic class, or the journey is refused. A
  // plan a caller made is checked too; only a mover explicitly sent through in defiance (treatyDefy) is
  // let through, and its crossings become incidents. A retreat back the way it came is never re-routed.
  world.treatyBook = book;
  const cls = spec.trafficClass || trafficClassOf(spec.kind, spec.purpose);
  const defy = Boolean(spec.treatyDefy ?? spec.meta?.treatyDefy);
  let plan = spec.plan || plotJourney(world, from, spec.destination, spec.sponsor, spec.avoid || null, null, { noFixed: Boolean(tow), cls, treaty: !defy });
  if (plan && spec.plan && !defy && spec.purpose !== 'retreat' && book.treatyTerms?.length && treatyRouteBlocked(book, from, plan.path, spec.sponsor, cls) != null) {
    if (spec.kind === 'doctrine') { treatyStats(book).dmzRoutesRefused++; return { ok: false, treaty: true, reason: 'treaty: the route crosses a demilitarised zone' }; }
    plan = plotJourney(world, from, spec.destination, spec.sponsor, spec.avoid || null, null, { noFixed: Boolean(tow), cls });
    if (plan) treatyStats(book).treatyReplots++;
  }
  if (!plan) {
    if (!defy && book.treatyTerms?.length && plotJourney(world, from, spec.destination, spec.sponsor, spec.avoid || null, null, { noFixed: Boolean(tow), treaty: false })) {
      treatyStats(book).dmzRoutesRefused++;
      return { ok: false, treaty: true, reason: 'treaty: no lawful route (demilitarised zone)' };
    }
    return { ok: false, reason: 'no route' };
  }
  // The days are always the ships' own: the route's legs (whoever plotted it) at the speed of the hulls
  // actually flying, its slowest able member (SHIP-DEPENDENT-STRATEGIC-SPEED). A planner that asked for
  // the same hulls' journeyDays got exactly these.
  if (tow && routeLegBase(world, [from, ...plan.path.map(Number)]).some((l) => l.fixed)) return { ok: false, reason: 'a tow cannot be taken through a fixed traversal (wormhole)' };
  const speed = journeySpeed(world, book, { tow }, hulls);
  const legBase = routeLegBase(world, [from, ...plan.path.map(Number)]);
  const tr = J.createJourney({ id: nextCampaignId(book, 'journey'), kind: spec.kind, ref: spec.ref ?? null, sponsor: spec.sponsor, from, destination: Number(spec.destination),
    path: plan.path, legDays: SPD.legDaysAt(legBase, speed), day, members: hulls.map((h) => h.id), vids: Object.fromEntries(hulls.map((h) => [h.id, vidOfHull(h)])),
    purpose: spec.purpose || 'move', war: spec.war || null, authority: spec.authority || null, prior: spec.prior || null, meta: spec.meta || null });
  tr.legBase = legBase; tr.speed = speed; tr.speedHistory = [{ fromLeg: 0, speed }];
  if (tow) tr.tow = tow;
  tr.trafficClass = cls;
  if (defy) tr.treatyDefy = true;
  list.push(tr);
  st.started++; st.byKind[tr.kind] = (st.byKind[tr.kind] || 0) + 1;
  if (!tr.path.length) {
    J.arriveJourney(tr, from, day, 'already there');
    st.arrived++;
    effects.push(journeyEffect(tr, 'journeyEnded', day, { status: 'arrived', systemIndex: from }));
    return { ok: true, journey: tr, arrived: true };
  }
  J.scheduleLeg(tr, day);
  tr.plannedEtaDay = tr.etaDay; // the ETA it set out on (debug: planned vs actual arrival)
  for (const d of tr.legDays) { st.legDays += d; st.legs++; }
  putMembersOnLeg(book, tr);
  effects.push(journeyEffect(tr, 'journeyDeparted', day, { from: tr.from, to: tr.path[0], arrivalDay: tr.legArrivalDay, eta: tr.etaDay, leg: 0, legs: tr.path.length }));
  return { ok: true, journey: tr };
}
// The crossing at the end of the leg in flight: where each member is, what the crossing sees, and every
// blockade there that bears on the sponsor, run once through the shared engine. Processed once per
// (seq, leg) whatever calls it. Returns what happened for the caller (a kind hook, or doctrine) to act on.
export function crossJourneyLeg(book, world, tr, effects = [], opts = {}) {
  const st = journeyBook(book) && book.stats.journeys;
  const cross = J.markCrossed(tr);
  const out = { ...cross, runs: [], turnedBack: false, disabled: [], destroyed: [], leftEnRoute: [] };
  if (!cross.fresh) { st.duplicateCrossingsPrevented++; return out; }
  const { at, day } = cross;
  const hooks = JOURNEY_KINDS[tr.kind] || {};
  st.crossings++;
  const towed = new Set((tr.tow?.targets || []).map(String));
  const legStart = Number(tr.legIndex > 0 ? tr.path[tr.legIndex - 1] : tr.plotFrom);
  for (const id of [...tr.members]) {
    const h = hullOf(book, tr.sponsor, id);
    // Gone from its books while the leg was in flight. With a tow, it was lost somewhere on this leg: the
    // hulk it towed is let go where they last stood together, the leg's start (dropUntowed).
    if (!h) {
      J.detachMember(tr, id, at, day, 'lost');
      if (tr.tow) out.leftEnRoute.push({ id, reason: 'lost', systemIndex: legStart });
      // The casualty itself gone from the books mid-leg: the tow ends with it — it is not flown on to the yard
      // with nothing in tow (TOWING-SALVAGE-AUDIT A12).
      if (towed.has(String(id))) { tr.tow = { ...tr.tow, targets: tr.tow.targets.filter((x) => String(x) !== String(id)) }; out.destroyed.push(id); hooks.onDetach?.(book, world, tr, { id, status: 'lost' }, 'lost', legStart, day, effects); }
      continue;
    }
    // A hulk in tow is carried: it is disabled by definition and goes where the towing group goes. Lost (a
    // run finished it off), it is gone like any other.
    if (towed.has(String(id))) {
      if (h.status === 'lost') { delete h.transit; J.detachMember(tr, id, h.systemIndex, day, 'lost'); out.destroyed.push(id); out.leftEnRoute.push({ id, reason: 'lost', systemIndex: Number(h.systemIndex) }); hooks.onDetach?.(book, world, tr, h, 'lost', Number(h.systemIndex), day, effects); continue; }
      delete h.transit; h.systemIndex = at;
      continue;
    }
    if (h.transit?.journeyId === tr.id && (hullIsDisabled(h) || h.status === 'surrendered' || h.status === 'lost')) {
      // Disabled, surrendered or lost while the leg was in flight: it dropped out where it last stood (the
      // model has no position between systems) and is never carried on to the leg's end.
      delete h.transit;
      const reason = h.status === 'lost' ? 'lost' : h.status === 'surrendered' ? 'surrendered' : 'disabled';
      J.detachMember(tr, id, h.systemIndex, day, reason);
      out.leftEnRoute.push({ id, reason, systemIndex: Number(h.systemIndex) });
      if (reason === 'disabled') out.disabled.push(id); else if (reason === 'lost') out.destroyed.push(id);
      hooks.onDetach?.(book, world, tr, h, reason, Number(h.systemIndex), day, effects);
      continue;
    }
    if (h.transit?.journeyId !== tr.id) {
      // Not this journey's any more: surrendered, disabled or given an order of its own where it was. It
      // stays where that happened; it is never carried on.
      const reason = h.status === 'surrendered' ? 'surrendered' : hullIsDisabled(h) ? 'disabled' : 'reassigned';
      J.detachMember(tr, id, h.systemIndex, day, reason);
      out.leftEnRoute.push({ id, reason, systemIndex: Number(h.systemIndex) });
      hooks.onDetach?.(book, world, tr, h, reason, Number(h.systemIndex), day, effects);
      continue;
    }
    delete h.transit;
    h.systemIndex = at;
    // Its own order ended while the leg was in flight (an escort stood down in warp): it is set down here and
    // not carried on.
    if (hooks.keep && !hooks.keep(book, tr, h)) { J.detachMember(tr, id, at, day, 'released'); out.leftEnRoute.push({ id, reason: 'released', systemIndex: at }); releaseDetached(tr, h, 'released'); continue; }
    if (hullIsDisabled(h)) { J.detachMember(tr, id, at, day, 'disabled'); out.disabled.push(id); hooks.onDetach?.(book, world, tr, h, 'disabled', at, day, effects); }
  }
  dropUntowed(book, world, tr, at, day, effects, out);
  effects.push(journeyEffect(tr, 'journeyCrossed', day, { systemIndex: at, leg: tr.legIndex, legs: tr.path.length, final: !J.hasMoreLegs(tr) }));
  if (tr.members.length && opts.blockades !== false) runJourneyBlockades(book, world, tr, at, day, effects, out, opts);
  // Treaty terms met here (a DMZ warning for a mover in defiance, an inspection regime), once per crossing.
  if (!out.turnedBack && !out.held) runTreatyCrossing(book, world, tr, at, day, effects, out);
  return out;
}
// A tow whose towing ships are all gone (lost, disabled, surrendered, left): the hulk is let go where the
// towing group last stood — never dragged onward without a tug (TOWING-SALVAGE-RECOVERY §7). A towing ship
// that dropped out in warp left the hulk where it dropped out; at a crossing, it is here.
function dropUntowed(book, world, tr, at, day, effects, out) {
  if (!tr.tow?.targets?.length) return;
  const towed = new Set(tr.tow.targets.map(String));
  // Still in tow only while a member able to tow it is with it — the tug, or another operational ship whose
  // capacity covers the hulk. Escorts that cannot tow do not carry it on.
  const need = Number(tr.tow.need) || 0;
  const towing = tr.members.filter((id) => !towed.has(String(id))).map((id) => hullOf(book, tr.sponsor, id)).filter((h) => h && h.status !== 'lost' && classifyDamage(h.hull, h.maxHull) === 'operational');
  if (towing.some((h) => REC.classRecoveryCapacity(world.shipStats(h.shipId)) >= need)) return;
  const dropped = out?.leftEnRoute?.filter((x) => !towed.has(String(x.id))) || [];
  const where = dropped.length && dropped.every((x) => Number(x.systemIndex) !== Number(at)) ? Number(dropped[0].systemIndex) : Number(at);
  for (const id of [...tr.members].filter((x) => towed.has(String(x)))) {
    const h = hullOf(book, tr.sponsor, id);
    if (h) { delete h.transit; h.systemIndex = where; }
    J.detachMember(tr, id, where, day, 'tug lost');
    out?.leftEnRoute?.push({ id, reason: 'tug lost', systemIndex: where });
    (JOURNEY_KINDS[tr.kind] || {}).onTowDropped?.(book, world, tr, h, where, day, effects, Number(at));
  }
  tr.tow = { ...tr.tow, targets: [] };
}
// Every blockade at a crossing that bears on the journey's sponsor, once each. Where the captain is present
// (opts.handoff, for the model's own journeys of another sponsor) an interception is handed to the scene: the
// journey is held at this crossing until the encounter hands back a result. Returns true if turned back.
function runJourneyBlockades(book, world, tr, at, day, effects, out, opts = {}) {
  const st = book.stats.journeys;
  const hooks = JOURNEY_KINDS[tr.kind] || {};
  for (const b of applicableBlockadesAt(book, world, at, tr.sponsor, tr.trafficClass || 'military')) {
    if (opts.skip?.has(b.id)) continue;
    if (tr.encounters.some((e) => e.blockadeId === b.id && e.leg === tr.legIndex && e.seq === tr.seq)) continue;
    const towedIds = new Set((tr.tow?.targets || []).map(String));
    const ships = journeyMemberHulls(book, tr).filter((h) => !towedIds.has(String(h.id)) && classifyDamage(h.hull, h.maxHull) === 'operational');
    if (!ships.length) break;
    // A hulk in tow runs with the group (TOWING-SALVAGE-RECOVERY §8): the shared engine sees the group at its
    // tow speed and its bigger signature, and the hulk can be hit; nothing else about the run is different.
    const towedHulls = journeyMemberHulls(book, tr).filter((h) => towedIds.has(String(h.id)) && h.status !== 'lost');
    const runner = opts.runner ? opts.runner(ships) : { key: hooks.runnerKey?.(book, tr) ?? `${tr.ref != null ? `${tr.ref}:` : ''}${tr.id}:s${tr.seq}:l${tr.legIndex}`, sponsor: tr.sponsor, kind: tr.kind,
      hulls: [...ships.map((h) => ({ hullId: h.id, vid: vidOfHull(h), shipId: h.shipId, hull: h.hull, maxHull: h.maxHull, crew: h.crew, role: hooks.role?.(book, tr, h) ?? null })),
        ...towedHulls.map((h) => ({ hullId: h.id, vid: vidOfHull(h), shipId: h.shipId, hull: h.hull, maxHull: h.maxHull, crew: h.crew, role: 'towed', towed: true }))],
      ...(towedHulls.length ? { towSpeed: tr.speed } : {}), trafficClass: tr.trafficClass || 'military' };
    // STRATEGIC-TACTICAL-HANDOFF: the captain is in this system — an interception is fought in the scene.
    if (opts.handoff && tr.sponsor !== 'player' && world.localSystem != null && Number(world.localSystem) === Number(at)) {
      const contact = blockadeContact(book, world, b, runner, day);
      if (contact.caught) {
        const enc = openBlockadeEncounter(book, world, b, runner, day, { contact, journeyId: tr.id, leg: tr.legIndex, seq: tr.seq, reason: 'a runner intercepted where the captain is' });
        tr.held = { encounterId: enc.id, at: Number(at), day: Number(day), leg: tr.legIndex, seq: tr.seq, blockadeId: b.id };
        st.blockadeRuns[tr.kind] = (st.blockadeRuns[tr.kind] || 0) + 1;
        out.held = enc.id;
        return false;
      }
    }
    const r = resolveBlockadeRun(book, world, b, runner, day, effects, { meta: { journeyId: tr.id, journeyKind: tr.kind, ref: tr.ref, ...(hooks.runMeta?.(book, tr) || {}), ...(opts.meta || {}) } });
    st.blockadeRuns[tr.kind] = (st.blockadeRuns[tr.kind] || 0) + 1;
    const lost = [], disabled = [];
    for (const x of r.hulls) {
      if (!tr.members.includes(x.hullId)) continue;
      if (towedIds.has(String(x.hullId)) && x.condition !== 'destroyed') continue; // a hulk in tow stays in tow
      if (x.condition === 'destroyed') { lost.push(tr.vids[x.hullId] ?? x.hullId); J.detachMember(tr, x.hullId, at, day, 'destroyed'); out.destroyed.push(x.hullId); hooks.onDetach?.(book, world, tr, { id: x.hullId, status: 'lost' }, 'destroyed', at, day, effects); }
      else if (x.condition === 'disabled') { disabled.push(tr.vids[x.hullId] ?? x.hullId); J.detachMember(tr, x.hullId, at, day, 'disabled'); out.disabled.push(x.hullId); const h = hullOf(book, tr.sponsor, x.hullId); if (h) hooks.onDetach?.(book, world, tr, h, 'disabled', at, day, effects); }
    }
    tr.encounters.push({ system: at, day, leg: tr.legIndex, seq: tr.seq, blockadeId: b.id, power: b.power, outcome: r.outcome, estimate: r.estimate, coverage: r.observed?.tier ?? null, force: r.observed?.force ?? null, lost, disabled });
    out.runs.push(r);
    dropUntowed(book, world, tr, at, day, effects, out);
    if (!tr.members.length || tr.status !== 'underway') return false;
    if (!r.continues) { out.turnedBack = true; return true; }
  }
  return false;
}
// Default for a hull that leaves a journey disabled or reassigned: it is off the job, where it is.
function releaseDetached(tr, h, reason) {
  if (!h || h.status === 'lost') return;
  if (h.opId === tr.id) h.opId = null;
  if (reason === 'disabled' && h.status !== 'surrendered') h.status = 'repairing';
  else if (h.status === 'assigned' && !h.opId) h.status = releaseStatus(h);
}
function endJourneyEffect(book, tr, day, effects, extra = {}) {
  const st = book.stats.journeys;
  if (tr.status === 'arrived') st.arrived++; else if (tr.status === 'halted') st.halted++;
  effects.push(journeyEffect(tr, 'journeyEnded', day, { status: tr.status, reason: tr.endReason, systemIndex: tr.from, ...extra }));
}
// A new journey for a record's remaining members from where they now stand (a replot, a return, a
// retreat): the same vessels, the history carried over, the sequence up by one.
export function replotJourney(book, world, tr, spec, day, effects = []) {
  const hulls = journeyMemberHulls(book, tr).filter((h) => !h.transit);
  if (tr.status === 'underway') J.supersedeJourney(tr, day, spec.reason || 'superseded');
  return startJourney(book, world, { kind: spec.kind || tr.kind, ref: spec.ref ?? tr.ref, sponsor: tr.sponsor, hulls, destination: spec.destination, purpose: spec.purpose || tr.purpose,
    war: spec.war === undefined ? tr.war : spec.war, authority: spec.authority === undefined ? tr.authority : spec.authority, meta: spec.meta === undefined ? tr.meta : spec.meta,
    prior: tr, avoid: spec.avoid || null, plan: spec.plan || null, tow: spec.tow === undefined ? tr.tow : spec.tow }, day, effects);
}
// What happens after a crossing, in order: nobody left; turned back; the reason for the journey lapsed
// (checked here, at the boundary, never mid-leg); a pending order; the next leg; arrival.
function settleCrossing(book, world, tr, cross, effects) {
  // Held at this crossing while its interception is fought in the scene: nothing settles until the
  // encounter hands the result back (releaseHeldCrossing).
  if (cross.held) return;
  const registered = JOURNEY_KINDS[tr.kind];
  const hooks = registered || {};
  const st = book.stats.journeys;
  const { at, day } = cross;
  hooks.onCross?.(book, world, tr, cross, effects);
  if (tr.status !== 'underway') return;
  // The crossing may have changed who owns the journey (an assignment ended in warp becomes a release).
  if (JOURNEY_KINDS[tr.kind] !== registered) return settleCrossing(book, world, tr, { ...cross, recheck: true }, effects);
  if (!tr.members.length) {
    J.haltJourney(tr, at, day, 'no ships', `No ships left at system ${at}.`);
    endJourneyEffect(book, tr, day, effects);
    hooks.onHalt?.(book, world, tr, at, day, effects);
    return;
  }
  if (cross.turnedBack) {
    st.forcedBack++;
    const prev = Number(tr.legIndex > 0 ? tr.path[tr.legIndex - 1] : tr.plotFrom);
    J.haltJourney(tr, at, day, 'forced-back', `Turned back at system ${at}.`);
    endJourneyEffect(book, tr, day, effects, { forcedBack: true });
    if (hooks.onForcedBack?.(book, world, tr, at, prev, day, effects)) return;
    // By default the group goes back as one body to the system it came from, and its owner decides there.
    const back = replotJourney(book, world, tr, { purpose: 'retreat', destination: prev, war: null, meta: { ...(tr.meta || {}), retreatOf: tr.id, resume: { destination: tr.destination, purpose: tr.purpose } },
      plan: { path: [prev], legDays: [legDaysBetween(world, at, prev)] } }, day, effects);
    if (back.ok) back.journey.retreatFrom = Number(at);
    return;
  }
  const verdict = hooks.valid ? hooks.valid(book, world, tr, day, effects) : { ok: true };
  if (!verdict.ok) {
    st.staleCancelled++;
    tr.staleAt = { day, at, reason: verdict.reason || 'no longer authorised' };
    if (verdict.pending) tr.pending = { ...verdict.pending, day };
    else {
      J.haltJourney(tr, at, day, verdict.reason || 'authority', verdict.note || '');
      endJourneyEffect(book, tr, day, effects, { stale: true });
      if (hooks.onHalt) hooks.onHalt(book, world, tr, at, day, effects); else releaseMembersHere(book, tr);
      return;
    }
  }
  // A treaty that started, ended or changed while the leg was in flight: the rest of the route is re-plotted
  // lawfully from here, or the journey stops here (a doctrine job stops; its owner re-plans).
  if (!tr.pending && treatyBoundaryCheck(book, world, tr) != null) {
    if (tr.kind === 'doctrine' || tr.kind === 'evacuation') {
      treatyStats(book).treatyHalts++;
      J.haltJourney(tr, at, day, 'treaty', 'the route ahead crosses a demilitarised zone');
      endJourneyEffect(book, tr, day, effects, { treaty: true });
      if (hooks.onHalt) hooks.onHalt(book, world, tr, at, day, effects); else releaseMembersHere(book, tr);
      return;
    }
    treatyStats(book).treatyReplots++;
    const avoid = (book.blockades || []).filter((b) => blockadeApplies(book, world, b, tr.sponsor, tr.trafficClass || 'military')).map((b) => Number(b.target)).filter((i) => i !== Number(tr.destination));
    tr.pending = { destination: tr.destination, purpose: tr.purpose, day, treaty: true, ...(avoid.length ? { avoid } : {}) };
  }
  if (tr.pending) {
    const p = tr.pending; tr.pending = null;
    if (p.treaty) delete p.treaty;
    if (Array.isArray(p.avoid)) p.avoid = new Set(p.avoid);
    const next = replotJourney(book, world, tr, { ...p, reason: 'superseded' }, day, effects);
    endJourneyEffect(book, tr, day, effects, { superseded: true });
    if (!next.ok) {
      // No way to where the order says: the ships hold here, and their owner decides.
      tr.status = 'underway'; J.haltJourney(tr, at, day, 'no-route', `No route to system ${p.destination}.`);
      if (hooks.onHalt) hooks.onHalt(book, world, tr, at, day, effects); else releaseMembersHere(book, tr);
    } else if (next.arrived) (JOURNEY_KINDS[next.journey.kind] || {}).onArrive?.(book, world, next.journey, at, day, effects);
    return;
  }
  if (J.hasMoreLegs(tr)) {
    // A leg boundary: the next leg flies at the speed of those still with the journey (one detached here
    // may have been its slowest). Legs already flown are never re-timed.
    const was = tr.speed;
    J.respeedJourney(tr, journeySpeed(world, book, tr, journeyMemberHulls(book, tr)));
    if (tr.speed !== was) hooks.onRespeed?.(book, world, tr, cross, effects);
    J.advanceLeg(tr, day);
    putMembersOnLeg(book, tr);
    effects.push(journeyEffect(tr, 'journeyDeparted', day, { from: tr.from, to: tr.path[tr.legIndex], arrivalDay: tr.legArrivalDay, eta: tr.etaDay, leg: tr.legIndex, legs: tr.path.length }));
    return;
  }
  J.arriveJourney(tr, at, day, '');
  endJourneyEffect(book, tr, day, effects);
  hooks.onArrive?.(book, world, tr, at, day, effects);
}
// Every model journey, leg by leg, up to `day`. Doctrine journeys are stepped by their own assignments.
export function stepJourney(book, world, tr, day, effects = [], opts = {}) {
  if (tr.held) {
    const enc = SE.encounterById(book, tr.held.encounterId);
    if (enc && settleAbandonedHandoff(book, world, enc, day, effects)) return; // its fallback releases the crossing
    if (enc && SE.isLive(enc)) { SE.suppressAbstract(book, enc, 'held crossing'); return; }
    // The encounter is gone without releasing it (aborted: the contact vanished): the crossing completes
    // strategically, once, as if nothing had been handed off.
    const held = tr.held; delete tr.held;
    const out = { at: held.at, day: held.day, fresh: true, runs: [], turnedBack: false, disabled: [], destroyed: [], leftEnRoute: [] };
    runJourneyBlockades(book, world, tr, held.at, held.day, effects, out, {});
    settleCrossing(book, world, tr, out, effects);
  }
  let guard = 0;
  while (J.legDue(tr, day) && guard++ < 64) {
    const cross = crossJourneyLeg(book, world, tr, effects, opts);
    if (cross.held) break;
    if (!cross.fresh) break;
    settleCrossing(book, world, tr, cross, effects);
  }
}
// Forced override only (a debug reset): every journey of a sponsor ends where its ships last stood, and
// ships whose order it was are free there.
export function haltJourneysOf(book, sponsor, day, reason = 'forced override') {
  let n = 0;
  for (const tr of book.journeys || []) {
    if (tr.status !== 'underway' || tr.sponsor !== sponsor) continue;
    for (const h of journeyMemberHulls(book, tr)) {
      if (h.transit?.journeyId === tr.id) delete h.transit;
      if (h.status === 'assigned' && (!h.opId || h.opId === tr.id || h.opId === tr.ref)) { h.opId = null; h.status = releaseStatus(h); }
    }
    J.haltJourney(tr, tr.from, day, reason, '');
    n++;
  }
  return n;
}
function advanceJourneys(book, world, day, effects) {
  const list = journeyBook(book);
  for (const tr of [...list]) {
    if (tr.status !== 'underway' || tr.kind === 'doctrine') continue;
    stepJourney(book, world, tr, day, effects, { handoff: true });
  }
  // Bounded: every journey under way, and the newest finished ones for the record.
  if (list.length > 200) {
    const live = list.filter((j) => j.status === 'underway');
    const done = list.filter((j) => j.status !== 'underway');
    book.journeys = live.concat(done.slice(-120));
  }
}

// Where a war force goes when its operation is over: the world it set out from, while its own side still
// holds it; otherwise the nearest world it does hold; otherwise where it set out from all the same.
function operationHome(book, world, op, h) {
  const origin = h.originSystem ?? op.originSystem;
  // A base it may return to: a world it holds, or a host's system where a staging right in force lets its warships
  // stay (ARCHITECTURE-CLEANUP §2: a staging right makes a valid origin and return point; it transfers nothing).
  const staging = book.treatyTerms?.length ? activeTreatyTerms(book, 'basing').filter((t) => t.guest === op.faction && t.purposes.includes('staging')).flatMap((t) => t.systems.filter((i) => accessAt(book, world, op.faction, i).staging.base)) : [];
  const held = (i) => i != null && (world.systems[Number(i)]?.controller === op.faction || staging.includes(Number(i)));
  if (held(origin)) return Number(origin);
  const own = [...controlled(world, op.faction).map((x) => x.index), ...staging];
  // Nearest in the days the journey home will actually fly (STRATEGIC-TIME-SCALE-CORRECTION).
  let best = null, bestDays = Infinity;
  // A ship in warp goes home from the end of the leg it is flying (that is where its return starts).
  const from = h.transit ? Number(h.transit.to) : Number(h.systemIndex);
  for (const i of own) { const n = plannedJourneyDays(world, from, i, op.faction, hullSpeed(world, h)); if (n != null && (n < bestDays || (n === bestDays && i < best))) { best = i; bestDays = n; } }
  return best ?? (origin == null ? null : Number(origin));
}
function operationById(book, id) { return (book.operations || []).find((o) => o.id === id) || null; }
function releaseMembersHere(book, tr) {
  for (const h of journeyMemberHulls(book, tr)) { if (h.transit) continue; if (h.opId === tr.id || h.opId === tr.ref || h.opId == null) { h.opId = null; h.status = releaseStatus(h); h.originSystem = null; } }
}
// An AI war operation's force on its way to the objective.
registerJourneyKind('operation', {
  // At every system it reaches: is the operation still on, and does the war it was sent under still hold?
  valid(book, world, tr, day, effects) {
    const op = operationById(book, tr.ref);
    if (!op) return { ok: false, reason: 'order gone', pending: { kind: 'return', destination: tr.origin, purpose: 'return', war: null, authority: { kind: 'return', ref: tr.ref }, meta: { home: tr.origin } } };
    if (op.status === 'resolved') {
      if (op.outcome === 'absorbed') return { ok: true };
      const h = journeyMemberHulls(book, tr)[0];
      const home = h ? operationHome(book, world, op, h) : tr.origin;
      return { ok: false, reason: `operation ${op.outcome}`, pending: { kind: 'return', destination: home, purpose: 'return', war: null, authority: { kind: 'return', ref: op.id }, meta: { home, opId: op.id } } };
    }
    if (tr.war && !warAuthorityHolds(book, world, tr.war)) {
      // The war it was sent to fight is over (ceasefire, peace, a new war instance) or the target changed
      // hands: the operation is broken off here, at the end of the leg, and never strikes under the old order.
      op.staleAuthority = { day, at: tr.from, journeyId: tr.id };
      finishOperation(book, world, op, day, 'stood-down', effects, 'offscreen', `${world.factionName(op.faction)} broke off the operation at ${world.systems[op.targetSystem]?.name}: the war it was sent under no longer holds.`);
      return { ok: false, reason: 'war-authority', note: 'the war it was sent under no longer holds' };
    }
    return { ok: true };
  },
  onArrive(book, world, tr, at, day, effects) {
    const op = operationById(book, tr.ref);
    if (op && op.status === 'resolved' && op.outcome === 'absorbed') releaseMembersHere(book, tr);
  },
  // Turned back by a blockade: this group is out of the operation and goes back the way it came, then home.
  onForcedBack(book, world, tr, at, prev, day, effects) {
    const op = operationById(book, tr.ref);
    const hulls = journeyMemberHulls(book, tr);
    if (op) {
      op.hullIds = op.hullIds.filter((id) => !tr.members.includes(id));
      (op.turnedBack ||= []).push({ day, at, vids: tr.members.map((id) => tr.vids[id] ?? id) });
    }
    const home = op && hulls[0] ? operationHome(book, world, op, hulls[0]) : tr.origin;
    for (const h of hulls) h.opId = null;
    const back = replotJourney(book, world, tr, { kind: 'return', purpose: 'retreat', destination: prev, war: null, authority: { kind: 'return', ref: tr.ref }, meta: { home, opId: tr.ref, retreatOf: tr.id },
      plan: { path: [prev], legDays: [legDaysBetween(world, at, prev)] } }, day, effects);
    if (back.ok) back.journey.retreatFrom = Number(at);
    else for (const h of hulls) h.status = releaseStatus(h);
    return true;
  },
  onDetach(book, world, tr, h, reason) {
    // Disabled on the way: it stays where it happened, still the operation's until the operation ends
    // (then released, stranded). Reassigned: no longer the operation's at all.
    if (reason === 'reassigned') { const op = operationById(book, tr.ref); if (op) op.hullIds = op.hullIds.filter((id) => id !== h.id); }
  },
});
// Going home (an operation's survivors, a group turned back). On reaching an intermediate stop (a retreat
// to the last system) it goes on home by a route round any blockade it knows of against it; home, it is
// released. With no way round it stays where it is, released.
function returnHome(book, world, tr, at, day, effects) {
  const home = tr.meta?.home;
  if (home != null && Number(at) !== Number(home)) {
    const avoid = new Set((book.blockades || []).filter((b) => blockadeApplies(book, world, b, tr.sponsor)).map((b) => Number(b.target)));
    avoid.delete(Number(home));
    const plan = plotJourney(world, at, home, tr.sponsor, avoid);
    if (plan) {
      const r = replotJourney(book, world, tr, { kind: tr.kind, purpose: 'return', destination: home, war: null, plan }, day, effects);
      if (r.ok && !r.arrived) return;
    }
  }
  releaseMembersHere(book, tr);
}
registerJourneyKind('return', {
  onArrive: returnHome,
  onHalt(book, world, tr) { releaseMembersHere(book, tr); },
  onDetach(book, world, tr, h, reason) { releaseDetached(tr, h, reason); if (h.opId && h.opId === tr.ref) h.opId = null; },
});
// A damaged hull on its way to a yard. Turned back, it waits a few days before it tries again.
registerJourneyKind('repair', {
  // The yard's world is still its own: otherwise it stops at this system and looks for another yard.
  valid(book, world, tr) {
    return world.systems[Number(tr.destination)]?.controller === tr.sponsor || basingRightAt(book, world, tr.sponsor, tr.destination, 'repair') ? { ok: true } : { ok: false, reason: 'yard lost' };
  },
  onHalt(book, world, tr, at, day) {
    for (const h of journeyMemberHulls(book, tr)) { if (h.transit) continue; if (h.opId === tr.id) h.opId = null; if (h.status === 'repairing' && !hullUnavailable(h)) h.status = 'ready'; h.repairRetryAfter = Number(day) + 1; }
  },
  onArrive(book, world, tr, at, day) {
    for (const h of journeyMemberHulls(book, tr)) {
      if (h.transit) continue;
      if (h.opId === tr.id) h.opId = null;
      if (tr.purpose === 'retreat') { h.status = releaseStatus(h); h.repairRetryAfter = day + (book.config.repairRetryDays ?? 5); }
    }
  },
  onHalt(book, world, tr, at, day) { for (const h of journeyMemberHulls(book, tr)) { if (h.transit) continue; if (h.opId === tr.id) h.opId = null; h.status = releaseStatus(h); h.repairRetryAfter = day + (book.config.repairRetryDays ?? 5); } },
  onDetach(book, world, tr, h, reason) { releaseDetached(tr, h, reason); },
});
// A job that ended while its ship was in warp: the leg in flight is flown to its end and the ship released
// there (doctrine assignments and anything else an owner stops mid-leg).
registerJourneyKind('release', {
  onArrive(book, world, tr) { releaseMembersHere(book, tr); },
  onHalt(book, world, tr) { releaseMembersHere(book, tr); },
  onDetach(book, world, tr, h, reason) { releaseDetached(tr, h, reason); if (h.opId && h.opId === tr.ref) h.opId = null; },
});
// Ships moving under an expedition's own order (the Dominion's corridor crossing, its reinforcements, its
// withdrawal): released where they arrive or stop.
// An expedition's movement rests on the invasion still being on and its destination still being held by
// the Dominion or an active pact partner; otherwise it turns back for the staging system at the next system
// it reaches. A withdrawal is going home and has no authority to lapse.
registerJourneyKind('expedition', {
  valid(book, world, tr) {
    const d = book.dominion || {};
    const holder = world.systems[Number(tr.destination)]?.controller ?? null;
    const partners = activePacts(book, tr.sponsor) || [];
    if (d.phase === 'invasion' && (holder === tr.sponsor || partners.includes(holder))) return { ok: true };
    const staging = Number(d.stagingSystem ?? tr.origin);
    return { ok: false, reason: 'expedition order lapsed', pending: { kind: 'withdrawal', destination: staging, purpose: 'withdraw', war: null, authority: { kind: 'withdrawal', ref: `${tr.sponsor}:withdrawal`, basis: 'lapsed' } } };
  },
});
for (const kind of ['expedition', 'withdrawal']) registerJourneyKind(kind, {
  onArrive(book, world, tr) { for (const h of journeyMemberHulls(book, tr)) { if (h.transit) continue; if (h.opId === tr.id || h.opId == null) { h.opId = null; h.status = releaseStatus(h); } } },
  onHalt(book, world, tr) { for (const h of journeyMemberHulls(book, tr)) { if (h.transit) continue; if (h.opId === tr.id || h.opId == null) { h.opId = null; h.status = releaseStatus(h); } } },
  onDetach(book, world, tr, h, reason) { releaseDetached(tr, h, reason); },
});

// ---------- strategic evacuation and blockade (EVACUATION-BLOCKADE-RULES-261530ZSEP26) ----------
// Both are persistent operations: an objective, a sponsor, a place, real hulls held for them, progress,
// supply and risk, and explicit ways to end. Nothing here is a flag with no actors behind it.
export const BLOCKADE_TIERS = Object.freeze([['light', 0.25], ['moderate', 0.55], ['heavy', 1]]);
export function blockadeTier(coverage) {
  for (const [tier, max] of BLOCKADE_TIERS) if (coverage < max) return tier;
  return 'heavy';
}
function strategicBook(book) {
  book.evacuations ||= [];
  book.blockades ||= [];
  return book;
}
// Every hull held by a live evacuation or blockade, so no hull is ever in two places at once.
export function strategicAssignments(book) {
  const out = new Map();
  for (const e of book.evacuations || []) if (e.status === 'active') for (const t of [...e.transports, ...e.escorts]) out.set(t.hullId, e.id);
  for (const b of book.blockades || []) if (['forming', 'active'].includes(b.status)) for (const h of b.hulls) out.set(h.hullId, b.id);
  return out;
}
function hullOf(book, polityId, hullId) {
  return (book.polities[polityId]?.hulls || []).find((h) => h.id === hullId && h.status !== 'lost') || null;
}
// People one hull carries per trip, from its real cargo capacity. A hull with no hold carries nobody.
export function evacuationLift(book, world, hull) {
  const cargo = Math.max(0, Number((world.shipStats(hull.shipId) || {}).cargo) || 0);
  return Math.floor(cargo * book.config.evacPeoplePerCargo);
}
export function shortestRoute(world, from, to, polityId) {
  const prev = new Map([[Number(from), null]]); const q = [Number(from)];
  while (q.length) {
    const cur = q.shift();
    if (cur === Number(to)) break;
    for (const n of world.neighbours(cur)) if (!prev.has(Number(n))) { prev.set(Number(n), cur); q.push(Number(n)); }
  }
  if (!prev.has(Number(to))) return null;
  const path = []; for (let x = Number(to); x != null; x = prev.get(x)) path.unshift(x);
  // routeHops honours the chart's closed routes (the wormhole before it is charted); a path it refuses is none.
  return world.routeHops([Number(from)], Number(to), polityId) == null ? null : path;
}
// The quickest route in real days (each hop its chart length), over the same adjacency and closed routes.
// The days a journey from `from` to `to` will actually take: the route startJourney itself plots, each leg
// its real length. null when there is none.
export function plannedJourneyDays(world, from, to, polityId, speed = null) {
  if (Number(from) === Number(to)) return 0;
  const plan = plotJourney(world, Number(from), Number(to), polityId, null, speed);
  return plan ? plan.legDays.reduce((n, d) => n + d, 0) : null;
}
// Every system's quickest route from `from`, in real days (one Dijkstra over journeyNeighbours).
export function fastestRoutesFrom(world, from, polityId) {
  const dist = new Map([[Number(from), 0]]), prev = new Map([[Number(from), null]]), done = new Set();
  for (;;) {
    let cur = null, best = Infinity;
    for (const [k, v] of dist) if (!done.has(k) && (v < best || (v === best && k < cur))) { best = v; cur = k; }
    if (cur == null) break;
    done.add(cur);
    for (const n of journeyNeighbours(world, cur, polityId)) {
      const d = best + legDaysBetween(world, cur, n);
      if (d < (dist.get(n) ?? Infinity) || (d === dist.get(n) && cur < prev.get(n))) { dist.set(n, d); prev.set(n, cur); }
    }
  }
  const routeTo = (to) => {
    if (!prev.has(Number(to))) return null;
    const path = []; for (let x = Number(to); x != null; x = prev.get(x)) path.unshift(x);
    return world.routeHops([Number(from)], Number(to), polityId) == null ? null : path;
  };
  return { dist, routeTo };
}
export function fastestRoute(world, from, to, polityId) {
  return fastestRoutesFrom(world, from, polityId).routeTo(to);
}
// Political access: the sponsor's own worlds, and those of a power that will take its people. The engine
// says who that is (a friend, not merely somebody the sponsor is not formally at war with); a world
// without an engine reads alliance or peace.
function friendlyTo(world, sponsor, controller) {
  if (!controller) return false;
  if (controller === sponsor) return true;
  const rel = world.relation(relSide(world, sponsor), relSide(world, controller));
  if (rel === 'war' || rel === 'ceasefire') return false;
  if (typeof world.receivesEvacuees === 'function') return Boolean(world.receivesEvacuees(sponsor, controller));
  return rel === 'allied' || rel === 'peace';
}
function activeBlockadesAt(book, systemIndex) {
  return (book.blockades || []).filter((b) => b.status === 'active' && Number(b.target) === Number(systemIndex));
}
// Is this a place the sponsor may take its people to? Explicit, reachable, friendly, not itself besieged.
// `speed`: the convoy's (its slowest transport or escort; SHIP-DEPENDENT-STRATEGIC-SPEED). The route is the
// chart's quickest; only its days depend on who flies it.
export function validateEvacuationDestination(book, world, sponsor, origin, destination, routes = null, speed = null) {
  const c = book.config;
  const dest = world.systems[Number(destination)];
  if (!dest) return { ok: false, reason: 'No such destination.' };
  if (Number(destination) === Number(origin)) return { ok: false, reason: 'The destination is the world being evacuated.' };
  if (!dest.controller) return { ok: false, reason: `${dest.name} has no government to receive evacuees.` };
  if (!friendlyTo(world, sponsor, dest.controller)) return { ok: false, reason: `${dest.name} is held by ${world.factionName(dest.controller)}, which will not receive them.` };
  if (!(dest.population > 0)) return { ok: false, reason: `${dest.name} has no settlement to take evacuees.` };
  const hostile = activeBlockadesAt(book, destination).filter((b) => b.power !== sponsor && formallyAtWar(world, b.power, sponsor));
  if (hostile.some((b) => blockadeTier(b.coverage) === 'heavy')) return { ok: false, reason: `${dest.name} is under blockade.` };
  if (book.operations.some((o) => o.status !== 'resolved' && Number(o.targetSystem) === Number(destination) && o.faction !== sponsor && formallyAtWar(world, o.faction, dest.controller)))
    return { ok: false, reason: `${dest.name} is under attack.` };
  const route = (routes ? routes.routeTo(destination) : fastestRoute(world, origin, destination, sponsor)) || shortestRoute(world, origin, destination, sponsor);
  if (!route) return { ok: false, reason: `There is no route to ${dest.name}.` };
  // Too far in real days, not in jumps (STRATEGIC-TIME-SCALE-CORRECTION).
  const days = routeLegDaysFor(world, route, speed).reduce((n, d) => n + d, 0);
  if (days > (c.evacMaxOneWayDays ?? 45)) return { ok: false, reason: `${dest.name} is too far: ${days} days each way${speed != null && SPD.clampSpeed(speed) !== 1 ? ` at the convoy's ${SPD.ratingLabel(speed)}` : ''}.` };
  return { ok: true, route, hops: route.length - 1, days };
}
// Every refuge a sponsor may take its people to from `origin`, best first (STRATEGIC-TIME-SCALE-CORRECTION):
// valid (friendly, reachable, settled, not besieged, not under attack, within the one-way limit), scored on
// real days of travel plus a penalty for each danger — a front-line world (an enemy next door), a blockade
// on the way — so a much nearer safe refuge beats a distant one, and a close hostile or inaccessible world
// is never a refuge at all.
export function evacuationDestinations(book, world, sponsor, origin, speed = null) {
  const c = book.config;
  const out = [];
  const routes = fastestRoutesFrom(world, origin, sponsor);
  for (const sys of world.systems) {
    if (Number(sys.index) === Number(origin) || !sys.controller) continue;
    const v = validateEvacuationDestination(book, world, sponsor, origin, sys.index, routes, speed);
    if (!v.ok) continue;
    const frontline = world.neighbours(sys.index).map(Number).some((n) => { const h = world.systems[n]?.controller; return h && formallyAtWar(world, sponsor, h); });
    const blockadedOnRoute = v.route.slice(1).filter((i) => applicableBlockadesAt(book, world, i, sponsor).length).length;
    const danger = (frontline ? 1 : 0) + blockadedOnRoute;
    // Capacity: a settlement too small to take the people this evacuation sets out to move (the same
    // abstract scale as its target) is a worse refuge, by half a danger step.
    const capacity = Math.round(Math.max(0, Number(sys.population) || 0) * c.evacProtectedShare);
    const crowded = capacity < evacuationTargetFor(book, world, origin);
    out.push({ index: Number(sys.index), name: sys.name, controller: sys.controller, route: v.route, hops: v.hops, days: v.days, frontline, blockadedOnRoute, danger, capacity, crowded,
      score: v.days + danger * (c.evacDistancePenaltyDays ?? 10) + (crowded ? (c.evacDistancePenaltyDays ?? 10) / 2 : 0) });
  }
  return out.sort((a, b) => a.score - b.score || a.days - b.days || a.index - b.index);
}
export function evacuationTargetFor(book, world, origin) {
  const c = book.config;
  const pop = Math.max(0, Number(world.systems[Number(origin)]?.population) || 0);
  return Math.round(bounded(pop * c.evacProtectedShare, c.evacMinTarget, c.evacMaxTarget));
}
export function startEvacuation(book, world, spec, day, effects = []) {
  strategicBook(book);
  const { sponsor, origin, destination, transports = [], escorts = [], deadlineDay = null, reason = 'the world is threatened' } = spec;
  const o = world.systems[Number(origin)];
  if (!o || o.controller !== sponsor) return { ok: false, reason: 'Only the world\'s own government can evacuate it.' };
  if ((book.evacuations || []).some((e) => e.status === 'active' && Number(e.origin) === Number(origin) && e.sponsor === sponsor)) return { ok: false, reason: `${o.name} is already being evacuated.` };
  const convoySpeed = hullsSpeed(world, [...transports, ...escorts].map((id) => hullOf(book, sponsor, id)).filter(Boolean));
  const dest = validateEvacuationDestination(book, world, sponsor, origin, destination, null, convoySpeed);
  if (!dest.ok) return dest;
  const taken = strategicAssignments(book);
  const pick = (ids, role) => {
    const out = [];
    for (const id of ids) {
      const h = hullOf(book, sponsor, id);
      if (!h) return { error: `${id} is not a vessel of ${world.factionName(sponsor)}.` };
      if (hullUnavailable(h)) return { error: `${id} is disabled or without a crew and cannot sail.` };
      if (taken.has(h.id) || h.opId || h.status !== 'ready') return { error: `${id} is already committed elsewhere.` };
      if (Number(h.systemIndex) !== Number(origin)) return { error: `${id} is not at ${o.name}.` };
      const lift = role === 'transport' ? evacuationLift(book, world, h) : 0;
      out.push({ hullId: h.id, vid: h.vid || h.identity?.vid || null, shipId: Number(h.shipId), lift });
    }
    return { list: out };
  };
  const tp = pick(transports, 'transport'); if (tp.error) return { ok: false, reason: tp.error };
  const es = pick(escorts, 'escort'); if (es.error) return { ok: false, reason: es.error };
  if (tp.list.reduce((n, t) => n + t.lift, 0) <= 0) return { ok: false, reason: 'No transport capacity: the assigned vessels carry nobody.' };
  const target = Math.max(1, Math.round(Number(spec.target) || evacuationTargetFor(book, world, origin)));
  const rec = { id: nextCampaignId(book, 'evac'), kind: 'evacuation', sponsor, origin: Number(origin), destination: Number(destination), route: dest.route,
    target, moved: 0, transports: tp.list, escorts: es.list, startDay: day, deadlineDay, status: 'active', endDay: null, endReason: null, reason,
    lost: [], removed: [], lastThroughput: 0, lastFactor: 1, initialTransports: tp.list.length, convoy: null };
  for (const t of [...tp.list, ...es.list]) { const h = hullOf(book, sponsor, t.hullId); h.status = 'assigned'; h.opId = rec.id; }
  book.evacuations.push(rec);
  addHistory(book, day, 'evacuation', `${world.factionName(sponsor)} began evacuating ${o.name} to ${world.systems[destination].name}: ${reason}.`, { id: rec.id, systemIndex: rec.origin });
  effects.push({ type: 'evacuationStarted', id: rec.id, sponsor, origin: rec.origin, destination: rec.destination, transports: tp.list.map((t) => t.hullId), escorts: es.list.map((t) => t.hullId), target, day });
  return { ok: true, record: rec };
}
export function assignEvacuationEscorts(book, world, id, hullIds, day, effects = []) {
  const e = (book.evacuations || []).find((x) => x.id === id && x.status === 'active');
  if (!e) return { ok: false, reason: 'No such evacuation.' };
  const taken = strategicAssignments(book);
  const added = [];
  for (const hid of hullIds) {
    const h = hullOf(book, e.sponsor, hid);
    if (!h || taken.has(h.id) || h.opId || h.status !== 'ready' || hullUnavailable(h)) return { ok: false, reason: `${hid} is not free to escort.` };
    if (Number(h.systemIndex) !== e.origin) return { ok: false, reason: `${hid} is not at ${world.systems[e.origin]?.name}.` };
    added.push({ hullId: h.id, vid: h.vid || null, shipId: Number(h.shipId), lift: 0 });
  }
  // Escorts join the convoy at the origin: if it is away, they wait there for it rather than appear
  // beside it. [BLOCKADE-RUNNING-RULES]
  const away = e.convoy && !(e.convoy.phase === 'loading' && e.convoy.pos === 0);
  for (const a of added) { const h = hullOf(book, e.sponsor, a.hullId); h.status = 'assigned'; h.opId = e.id; if (away) a.joining = true; e.escorts.push(a); }
  if (added.length) effects.push({ type: 'strategicShipsAssigned', id: e.id, sponsor: e.sponsor, role: 'escort', hulls: added.map((a) => a.hullId), systemIndex: e.origin, day });
  return { ok: true, added: added.length };
}
function releaseHulls(book, polityId, list) {
  for (const t of list) {
    const h = hullOf(book, polityId, t.hullId);
    if (!h) continue;
    // In warp: it cannot turn round mid-leg. Its journey's own check stops it at the end of the leg (the
    // record it served is over) and frees it there; until then it is simply in warp.
    if (h.transit) { h.opId = null; continue; }
    h.status = releaseStatus(h); h.opId = null;
  }
}
function endEvacuation(book, world, e, day, status, reason, effects) {
  e.status = status; e.endDay = day; e.endReason = reason;
  const all = [...e.transports, ...e.escorts];
  releaseHulls(book, e.sponsor, all);
  addHistory(book, day, 'evacuation', `Evacuation of ${world.systems[e.origin]?.name} ${status}: ${Math.round(e.moved)} of ${e.target} moved${reason ? ` (${reason})` : ''}.`, { id: e.id, systemIndex: e.origin });
  effects.push({ type: 'evacuationEnded', id: e.id, sponsor: e.sponsor, origin: e.origin, destination: e.destination, status, reason, moved: Math.round(e.moved), target: e.target, released: all.map((t) => t.hullId), day });
}
export function cancelEvacuation(book, world, id, day, effects = [], reason = 'cancelled') {
  const e = (book.evacuations || []).find((x) => x.id === id && x.status === 'active');
  if (!e) return { ok: false, reason: 'No such evacuation.' };
  endEvacuation(book, world, e, day, e.moved > 0 ? 'partial' : 'cancelled', reason, effects);
  return { ok: true, record: e };
}
// What the blockade actually fields: its hulls on station that can still fight. A disabled hull adds
// nothing; a damaged one adds what its hull is worth.
function blockadeStrength(book, world, b) {
  return b.hulls.reduce((n, t) => { if (t.joining) return n; const h = hullOf(book, b.power, t.hullId); return n + (h && !hullOutOfAction(h) && !h.transit ? hullStrength(book, world, h) : 0); }, 0);
}
function hullOutOfAction(h) {
  return !h || h.status === 'lost' || !(h.hull > 0) || classifyDamage(h.hull, h.maxHull) !== 'operational';
}
// The world's own defence against a blockade of it. Escorts no longer count here: they act where they
// actually are, when their convoy runs the blockade (BLOCKADE-RUNNING-RULES).
function blockadeOpposition(book, world, b) {
  return localDefenseStrength(book, world, b.target);
}
export function startBlockade(book, world, spec, day, effects = []) {
  strategicBook(book);
  const c = book.config;
  const { power, target, hullIds = [], purpose = 'isolate_world', authority = 'war' } = spec;
  const sys = world.systems[Number(target)];
  if (!sys || !sys.controller) return { ok: false, reason: 'There is nothing there to blockade.' };
  if (sys.controller === power) return { ok: false, reason: 'A power does not blockade its own world.' };
  if (!(c.blockadePurposes || []).includes(purpose)) return { ok: false, reason: `Unknown purpose ${purpose}.` };
  // Authority: an ordinary military blockade is an act of war and needs one. (An authored or treaty
  // authority is a hook for later rounds; nothing grants one yet.)
  if (authority !== 'war' || !formallyAtWar(world, power, sys.controller)) return { ok: false, reason: `${world.factionName(power)} is not at war with ${world.factionName(sys.controller)}.` };
  // A DMZ that binds the power forbids a blockade inside it (TREATY-EXPANSION §12), whatever the war.
  const ban = treatyBlockadeBan(book, power, target, day);
  if (ban) { treatyStats(book).blockadesRefused++; return { ok: false, treaty: true, reason: ban.type === 'dmz' ? `Treaty: no blockades in the demilitarised zone (${ban.id}).` : `Treaty: blockades there are lifted by agreement (${ban.id}).` }; }
  if (activeBlockadesAt(book, target).some((b) => b.power === power) || (book.blockades || []).some((b) => b.status === 'forming' && b.power === power && Number(b.target) === Number(target)))
    return { ok: false, reason: `${world.factionName(power)} already blockades ${sys.name}.` };
  const taken = strategicAssignments(book);
  const list = [];
  const near = new Set([Number(target), ...world.neighbours(Number(target)).map(Number)]);
  for (const id of hullIds) {
    const h = hullOf(book, power, id);
    if (!h) return { ok: false, reason: `${id} is not a vessel of ${world.factionName(power)}.` };
    if (hullUnavailable(h)) return { ok: false, reason: `${id} is disabled or without a crew and cannot sail.` };
    if (taken.has(h.id) || h.opId || h.status !== 'ready') return { ok: false, reason: `${id} is already committed elsewhere.` };
    if (power === 'player' && !near.has(Number(h.systemIndex))) return { ok: false, reason: `${id} is not at or next to ${sys.name}.` };
    list.push({ hullId: h.id, vid: h.vid || null, shipId: Number(h.shipId), from: Number(h.systemIndex) });
  }
  if (!list.length) return { ok: false, reason: 'A blockade needs ships assigned to it.' };
  // A force already on station holds the blockade at once; otherwise it forms when the ships it sent have
  // actually flown there, leg by leg, through whatever lies on the way (STRATEGIC-MOVEMENT-UNIFICATION).
  const away = list.filter((t) => t.from !== Number(target));
  const rec = { id: nextCampaignId(book, 'blockade'), kind: 'blockade', power, target: Number(target), purpose, authority, warKey: warKey(power, sys.controller),
    hulls: list, startDay: day, activeDay: day, status: away.length ? 'forming' : 'active', endDay: null, endReason: null,
    strength: 0, coverage: 0, supply: 1, unsuppliedDays: 0, damageBank: 0, losses: 0, breaches: [], segments: [], lastTier: null, journeyIds: [] };
  for (const t of list) { const h = hullOf(book, power, t.hullId); h.status = 'assigned'; h.opId = rec.id; }
  book.blockades.push(rec);
  sendToBlockadeStation(book, world, rec, away, day, effects);
  if (!rec.hulls.length) { rec.status = 'withdrawn'; rec.endDay = day; rec.endReason = 'no route to the station'; return { ok: false, reason: `No route to ${sys.name}.` }; }
  addHistory(book, day, 'blockade', `${world.factionName(power)} ${rec.status === 'forming' ? 'is moving to blockade' : 'blockades'} ${sys.name} (${purpose.replace(/_/g, ' ')}).`, { id: rec.id, systemIndex: rec.target });
  effects.push({ type: 'blockadeStarted', id: rec.id, power, target: rec.target, purpose, hulls: rec.hulls.map((t) => t.hullId), day, forming: rec.status === 'forming' });
  if (rec.status === 'active') settleBlockadeDay(book, world, rec, day, effects, true);
  return { ok: true, record: rec };
}
export function reinforceBlockade(book, world, id, hullIds, day, effects = []) {
  const b = (book.blockades || []).find((x) => x.id === id && ['forming', 'active'].includes(x.status));
  if (!b) return { ok: false, reason: 'No such blockade.' };
  const taken = strategicAssignments(book);
  const near = new Set([b.target, ...world.neighbours(b.target).map(Number)]);
  const added = [];
  for (const hid of hullIds) {
    const h = hullOf(book, b.power, hid);
    if (!h || taken.has(h.id) || h.opId || h.status !== 'ready') return { ok: false, reason: `${hid} is not free.` };
    if (b.power === 'player' && !near.has(Number(h.systemIndex))) return { ok: false, reason: `${hid} is not at or next to ${world.systems[b.target]?.name}.` };
    added.push({ hullId: h.id, vid: h.vid || null, shipId: Number(h.shipId), from: Number(h.systemIndex) });
  }
  for (const a of added) { const h = hullOf(book, b.power, a.hullId); h.status = 'assigned'; h.opId = b.id; if (a.from !== b.target) a.joining = true; b.hulls.push(a); }
  // Reinforcements fly to the station and join it when they are there.
  sendToBlockadeStation(book, world, b, added.filter((a) => a.joining), day, effects);
  if (added.length) effects.push({ type: 'strategicShipsAssigned', id: b.id, sponsor: b.power, role: 'blockade', hulls: added.map((a) => a.hullId), systemIndex: null, day });
  return { ok: true, added: added.length };
}
// Ships of a blockade that are not yet on station fly there as shared journeys, one per system they set
// out from. A group that cannot be routed is released where it is.
function sendToBlockadeStation(book, world, b, entries, day, effects) {
  const groups = new Map();
  for (const t of entries) { const h = hullOf(book, b.power, t.hullId); if (!h) continue; const k = Number(h.systemIndex); if (!groups.has(k)) groups.set(k, []); groups.get(k).push(h); }
  b.journeyIds ||= [];
  for (const [, hs] of [...groups.entries()].sort((x, y) => x[0] - y[0])) {
    const r = startJourney(book, world, { kind: 'blockade', ref: b.id, sponsor: b.power, hulls: hs, destination: b.target, purpose: 'station', war: warAuthorityStamp(book, world, b.power, b.target), authority: { kind: 'blockade', ref: b.id } }, day, effects);
    if (!r.ok) { for (const h of hs) { h.status = releaseStatus(h); h.opId = null; } b.hulls = b.hulls.filter((t) => !hs.some((h) => h.id === t.hullId)); continue; }
    b.journeyIds.push(r.journey.id);
    b.activeDay = Math.max(b.activeDay ?? day, r.journey.status === 'underway' ? r.journey.etaDay : day);
    if (r.arrived) for (const t of b.hulls) if (hs.some((h) => h.id === t.hullId)) delete t.joining;
  }
}
function blockadeById(book, id) { return (book.blockades || []).find((x) => x.id === id) || null; }
// A blockade's ships on their way to its station.
registerJourneyKind('blockade', {
  valid(book, world, tr, day, effects) {
    const b = blockadeById(book, tr.ref);
    if (b && ['forming', 'active'].includes(b.status) && (!tr.war || warAuthorityHolds(book, world, tr.war))) return { ok: true };
    // The blockade is over (ceasefire, peace, broken, withdrawn) or its war no longer holds: the ships turn
    // for home here instead of taking station.
    const home = tr.origin;
    if (b && ['forming', 'active'].includes(b.status)) endBlockade(book, world, b, day, 'closed', 'the war it was laid under no longer holds', effects);
    return { ok: false, reason: 'blockade over', pending: { kind: 'return', destination: home, purpose: 'return', war: null, authority: { kind: 'return', ref: tr.ref }, meta: { home } } };
  },
  onArrive(book, world, tr) {
    const b = blockadeById(book, tr.ref);
    if (!b) return;
    for (const t of b.hulls) if (tr.members.includes(t.hullId)) delete t.joining;
  },
  onForcedBack(book, world, tr, at, prev, day, effects) {
    const b = blockadeById(book, tr.ref);
    if (b) { for (const t of b.hulls) if (tr.members.includes(t.hullId)) effects.push({ type: 'strategicShipReleased', id: b.id, sponsor: b.power, hullId: t.hullId, day, at: Number(at) }); b.hulls = b.hulls.filter((t) => !tr.members.includes(t.hullId)); }
    for (const h of journeyMemberHulls(book, tr)) if (h.opId === tr.ref) h.opId = null;
    const back = replotJourney(book, world, tr, { kind: 'return', purpose: 'retreat', destination: prev, war: null, authority: { kind: 'return', ref: tr.ref }, meta: { home: tr.origin, retreatOf: tr.id },
      plan: { path: [prev], legDays: [legDaysBetween(world, at, prev)] } }, day, effects);
    if (back.ok) back.journey.retreatFrom = Number(at);
    else for (const h of journeyMemberHulls(book, tr)) h.status = releaseStatus(h);
    return true;
  },
  onDetach(book, world, tr, h, reason, at, day, effects) {
    const b = blockadeById(book, tr.ref);
    if (b && reason !== 'reassigned' && b.hulls.some((t) => t.hullId === h.id)) { b.hulls = b.hulls.filter((t) => t.hullId !== h.id); effects?.push({ type: 'strategicShipReleased', id: b.id, sponsor: b.power, hullId: h.id, day, disabled: reason === 'disabled', at }); }
    releaseDetached(tr, h, reason);
    if (h.opId === tr.ref) h.opId = null;
  },
  onHalt(book, world, tr) { releaseMembersHere(book, tr); },
});
function endBlockade(book, world, b, day, status, reason, effects) {
  b.status = status; b.endDay = day; b.endReason = reason;
  b.segments.push({ day, coverage: 0 }); b.segments = b.segments.slice(-60);
  releaseHulls(book, b.power, b.hulls);
  // An AI power remembers when it last lifted a blockade, and where one failed.
  const p = book.polities[b.power];
  if (p && b.power !== 'player') {
    p.lastBlockadeDay = day;
    if (['broken', 'withdrawn'].includes(status)) { p.blockadeFailures ||= {}; p.blockadeFailures[b.target] = day; }
  }
  addHistory(book, day, 'blockade', `${world.factionName(b.power)} blockade of ${world.systems[b.target]?.name} ${status}: ${reason}.`, { id: b.id, systemIndex: b.target });
  effects.push({ type: 'blockadeEnded', id: b.id, power: b.power, target: b.target, status, reason, released: b.hulls.map((t) => t.hullId), losses: b.losses, day });
}
export function withdrawBlockade(book, world, id, day, effects = [], reason = 'withdrawn by command') {
  const b = (book.blockades || []).find((x) => x.id === id && ['forming', 'active'].includes(x.status));
  if (!b) return { ok: false, reason: 'No such blockade.' };
  endBlockade(book, world, b, day, 'withdrawn', reason, effects);
  return { ok: true, record: b };
}
// Ceasefire or peace between two parties ends every blockade either keeps on the other's worlds,
// through the same transition that stands their operations down.
function closePairBlockades(book, world, a, b, day, effects, to) {
  const out = [];
  for (const x of book.blockades || []) {
    if (!['forming', 'active'].includes(x.status) || ![a, b].includes(x.power)) continue;
    const other = x.power === a ? b : a;
    if (world.systems[x.target]?.controller !== other) continue;
    endBlockade(book, world, x, day, 'closed', to === 'ceasefire' ? `ceasefire with ${world.factionName(other)}` : `peace with ${world.factionName(other)}`, effects);
    out.push(x.id);
  }
  return out;
}
function loseHull(book, world, polityId, hullId, systemIndex, day, effects, by) {
  const h = hullOf(book, polityId, hullId);
  if (!h) return;
  if (polityId === 'player') {
    effects.push({ type: 'defenderLosses', polityId: 'player', systemIndex, opId: `strategic:${hullId}:${day}`, day, attacker: by, hulls: [{ hullId, hull: 0, maxHull: h.maxHull, destroyed: true }] });
  }
  h.status = 'lost'; h.hull = 0; h.opId = null;
  const p = book.polities[polityId]; if (p) p.lostHulls = (p.lostHulls || 0) + 1;
  book.stats.hullsLost++;
}
function settleBlockadeDay(book, world, b, day, effects, opening = false) {
  const c = book.config;
  const sys = world.systems[b.target];
  // End conditions: the objective taken, no war behind it, nobody left to hold it.
  if (sys?.controller === b.power) return endBlockade(book, world, b, day, 'completed', `${sys.name} is in ${world.factionName(b.power)} hands`, effects);
  if (!sys?.controller || !formallyAtWar(world, b.power, sys.controller)) return endBlockade(book, world, b, day, 'closed', `no war with ${world.factionName(sys?.controller)}`, effects);
  // A hull that is gone, or has been taken off the station, no longer holds the blockade.
  b.hulls = b.hulls.filter((t) => {
    const h = hullOf(book, b.power, t.hullId);
    if (!h) return false;
    if (t.joining && h.opId === b.id) return true; // on its way to the station
    if (h.opId !== b.id || Number(h.systemIndex) !== b.target) { effects.push({ type: 'strategicShipReleased', id: b.id, sponsor: b.power, hullId: t.hullId, day }); return false; }
    // Disabled on station: out of the blockade, and off to repair.
    if (hullOutOfAction(h)) { h.status = 'repairing'; h.opId = null; effects.push({ type: 'strategicShipReleased', id: b.id, sponsor: b.power, hullId: t.hullId, day }); return false; }
    return true;
  });
  if (!b.hulls.length) return endBlockade(book, world, b, day, 'broken', 'the blockading force is gone', effects);
  const S = blockadeStrength(book, world, b);
  const D = blockadeOpposition(book, world, b);
  // Supply: how far the nearest ground of its own is, and how well supplied the power is at all.
  const own = controlled(world, b.power).map((s) => s.index);
  const hops = own.length ? world.routeHops(own, b.target, b.power) : null;
  const base = bounded(Number(book.polities[b.power]?.supply) || c.supplyFloor, c.supplyFloor, 1);
  b.supply = hops == null ? c.supplyFloor : bounded(base * (1 - Math.max(0, hops - 1) * 0.2), 0, 1);
  b.unsuppliedDays = b.supply < c.blockadeMinSupply ? (b.unsuppliedDays || 0) + 1 : 0;
  if (b.unsuppliedDays >= c.blockadeUnsuppliedDays) return endBlockade(book, world, b, day, 'withdrawn', 'it could not be supplied', effects);
  if (D > 0 && S < D * c.blockadeBreakRatio) return endBlockade(book, world, b, day, 'broken', 'the defence outmatches it', effects);
  // Purpose: a blockade meant to stop an evacuation is done when there is none; one meant to isolate or
  // prepare a world for invasion is done when an assault has become possible. An AI blockade that has
  // achieved neither within its time is lifted. (The captain's own run until he withdraws them.)
  if (b.power !== 'player' && !opening) {
    if (b.purpose === 'stop_evacuation' && !(book.evacuations || []).some((e) => e.status === 'active' && e.origin === b.target))
      return endBlockade(book, world, b, day, 'completed', 'there is no evacuation left to stop', effects);
    if (['isolate_world', 'prepare_invasion'].includes(b.purpose) && D > 0 && S * bounded(Number(book.polities[b.power]?.supply) || 1, c.supplyFloor, 1) >= D * c.minReadinessRatioToAttack)
      return endBlockade(book, world, b, day, 'completed', 'the world is weak enough to assault', effects);
    if (day - (b.activeDay ?? b.startDay) >= (c.blockadeMaxDays ?? 90)) return endBlockade(book, world, b, day, 'withdrawn', 'it achieved nothing in its time', effects);
  }
  // Attrition: the defence wears the blockade down; the weakest hull goes first.
  // Only ships can sortie against it: installations shield the world's traffic (they count in the
  // coverage) but do not hunt the blockade down.
  const mobile = defendingPolityIds(book, world, b.target).reduce((n, pid) => n + (book.polities[pid]?.hulls || []).filter((h) => h.status === 'ready' && Number(h.systemIndex) === b.target).reduce((m, h) => m + hullStrength(book, world, h), 0), 0);
  if (!opening && mobile > 0) {
    b.damageBank += mobile * c.blockadeAttrition;
    // A blockader fighting in the scene is the scene's: the attrition picks the weakest of the others.
    const weakest = () => b.hulls.map((t) => ({ t, h: hullOf(book, b.power, t.hullId) })).filter((x) => x.h && !hullInEncounter(x.h)).sort((x, y) => hullStrength(book, world, x.h) - hullStrength(book, world, y.h) || String(x.h.id).localeCompare(String(y.h.id)))[0];
    let w = weakest();
    while (w && b.damageBank >= hullStrength(book, world, w.h)) {
      b.damageBank -= hullStrength(book, world, w.h);
      loseHull(book, world, b.power, w.h.id, b.target, day, effects, sys.controller);
      b.losses++;
      b.hulls = b.hulls.filter((t) => t.hullId !== w.h.id);
      w = weakest();
    }
    if (!b.hulls.length) return endBlockade(book, world, b, day, 'broken', 'the blockading force was destroyed', effects);
  }
  refreshBlockadeCoverage(book, world, b, day, effects);
}
// Coverage is always read off the force actually on station, the day it changes — never a label kept
// from when the blockade was stronger.
function refreshBlockadeCoverage(book, world, b, day, effects) {
  const c = book.config;
  const S2 = blockadeStrength(book, world, b);
  const D = blockadeOpposition(book, world, b);
  b.strength = Math.round(S2);
  b.coverage = Math.round(Math.min(0.95, S2 / (S2 + D + c.blockadeTrafficScale)) * 1000) / 1000;
  const tier = blockadeTier(b.coverage);
  const last = b.segments[b.segments.length - 1];
  if (!last || Math.abs(last.coverage - b.coverage) >= 0.05) { b.segments.push({ day, coverage: b.coverage }); b.segments = b.segments.slice(-60); }
  if (b.lastTier && b.lastTier !== tier) effects.push({ type: 'blockadeCoverage', id: b.id, power: b.power, target: b.target, from: b.lastTier, to: tier, day });
  b.lastTier = tier;
}
// The share of a day's normal flow a blockade lets through at a system, 1 when there is none.
export function blockadeFlowFactor(book, systemIndex, impact, day = null) {
  let f = 1;
  for (const b of book.blockades || []) {
    if (Number(b.target) !== Number(systemIndex)) continue;
    const cov = day == null ? (b.status === 'active' ? b.coverage : 0) : blockadeCoverageOn(b, day);
    f *= 1 - cov * impact;
  }
  return f;
}
// The coverage a blockade had on a given day, from its recorded segments (0 outside its life).
export function blockadeCoverageOn(b, day) {
  if (day < (b.activeDay ?? b.startDay) || (b.endDay != null && day >= b.endDay)) return 0;
  let cov = 0;
  for (const s of b.segments || []) { if (s.day <= day) cov = s.coverage; else break; }
  return cov;
}
// ---------- blockade interception and running (BLOCKADE-RUNNING-RULES-270100ZSEP26) ----------
// One engine for every ship or group that reaches a blockaded system on a route: a player formation, a
// trader's passage, an evacuation convoy, and later AI missions. It separates being seen from being
// caught, and being caught from what the fight costs; each step reads what the ships actually are.
export const BLOCKADE_RUN_OUTCOMES = Object.freeze(['slipped_through', 'challenged_but_passed', 'fought_through', 'intercepted_minor_damage', 'intercepted_forced_back', 'intercepted_losses', 'blockade_broken']);
const RUN_MINOR = 0.45, RUN_LOSSES = 0.9; // pressure thresholds: below the first, minor damage; from the second, losses
const RUN_CONTINUES = new Set(['slipped_through', 'challenged_but_passed', 'fought_through', 'intercepted_minor_damage', 'blockade_broken']);
export function blockadeRunContinues(outcome) { return RUN_CONTINUES.has(outcome); }
// Does this blockade bear on this sponsor's ships crossing its system? Only an active blockade, still
// resting on its war, and only against a power it is formally at war with. (Neutral traffic is not
// fired on: inspection regimes are a later treaty term.)
export function blockadeApplies(book, world, b, sponsor, cls = 'military') {
  if (!b || b.status !== 'active' || b.power === sponsor) return false;
  const holder = world.systems[Number(b.target)]?.controller;
  if (!holder || holder === b.power || !formallyAtWar(world, b.power, holder)) return false;
  const st = b.warKey ? book.warStates?.[b.warKey] : null;
  if (st && st.status !== 'war') return false;
  if (!formallyAtWar(world, b.power, sponsor)) return false;
  // A transit guarantee the blockading power gave this sponsor at this system is honoured (TREATY-EXPANSION
  // §12): its ships pass. Only a blockade explicitly ordered to obstruct anyway (treatyDefy) still bears on
  // them — and the run it makes is then a recorded breach, not silent hostility.
  if (book.treatyTerms?.length && !b.treatyDefy && transitGuaranteeAt(book, b.power, sponsor, b.target, book.day, cls)) return false;
  return true;
}
export function applicableBlockadesAt(book, world, systemIndex, sponsor, cls = 'military') {
  return activeBlockadesAt(book, systemIndex).filter((b) => blockadeApplies(book, world, b, sponsor, cls));
}
// The ships running it, read from their records: condition, dash speed, cloak, fighting value.
// A runner is { key, sponsor, kind, hulls: [{ hullId, vid, shipId, hull, maxHull, role }] }; class facts
// come from world.shipStats (speed, cloak, combat, mass) and a hull may override them.
function runnerProfile(book, world, runner) {
  const c = book.config;
  const members = (runner.hulls || []).map((x) => {
    const st = world.shipStats(x.shipId) || {};
    const maxHull = Number(x.maxHull) > 0 ? Number(x.maxHull) : Math.max(1, Number(st.combatHull) || 100);
    const hull = Math.max(0, Math.min(maxHull, Number(x.hull ?? maxHull)));
    const cond = classifyDamage(hull, maxHull);
    const frac = hull / maxHull;
    const cloak = Boolean(x.cloak ?? st.cloak) && cond === 'operational' && frac >= (c.interceptCloakMinCondition ?? 0.5);
    const combat = bounded(Number(x.combat ?? st.combat ?? 1), 0, 1);
    const strength = hullStrength(book, world, { shipId: x.shipId, hull, maxHull, crew: x.crew ?? 1 });
    return { ...x, hull, maxHull, cond, frac, cloak, combat, strength, speed: Number(x.speed) || (st.strategicSpeed != null ? SPD.classSpeed(st) : c.interceptRefSpeed), mass: Math.max(1, Number(st.mass) || 3) };
  }).filter((m) => m.cond !== 'destroyed');
  const active = members.filter((m) => m.cond === 'operational' && !m.towed);
  const towed = members.filter((m) => m.towed);
  const E = active.reduce((n, m) => n + m.strength * m.combat, 0);
  // A group with a hulk in tow dashes at its tow speed, not its tug's (TOWING-SALVAGE-RECOVERY §8).
  const speed = active.length ? Math.min(...active.map((m) => m.speed), ...(towed.length && runner.towSpeed ? [Number(runner.towSpeed)] : [])) : 0;
  // Stealth is the least stealthy ship's: one uncloaked freighter gives the whole group away.
  const cloakAll = active.length > 0 && active.every((m) => m.cloak);
  // A hulk in tow is seen: its mass counts, and a tow is a conspicuous thing (towSignature); it also
  // spoils any cloak.
  const signature = bounded(0.7 + 0.02 * active.length + 0.3 * Math.min(1, Math.max(...active.map((m) => m.mass), ...towed.map((m) => m.mass), 1) / 10) + (towed.length ? (c.towSignature ?? 0.2) : 0), 0.6, 1.5);
  const condition = active.length ? active.reduce((n, m) => n + m.frac, 0) / active.length : 0;
  return { members, active, towed, E, speed, cloakAll: cloakAll && !towed.length, signature, condition };
}
// The blockade's side, from the hulls actually on station and able to act.
function blockadeForce(book, world, b) {
  const c = book.config;
  const hulls = b.hulls.filter((t) => !t.joining).map((t) => hullOf(book, b.power, t.hullId)).filter((h) => h && !hullOutOfAction(h) && !h.transit && !hullInEncounter(h)); // one already fighting in the scene is not on station for another
  const S = hulls.reduce((n, h) => n + hullStrength(book, world, h), 0);
  // The same strategic speed the blockaders' journeys fly at (SHIP-DEPENDENT-STRATEGIC-SPEED §blockade running).
  const speeds = hulls.map((h) => { const st = world.shipStats(h.shipId); return st?.strategicSpeed != null ? SPD.classSpeed(st) : c.interceptRefSpeed; });
  const speed = speeds.length ? speeds.reduce((a, v) => a + v, 0) / speeds.length : c.interceptRefSpeed;
  const D = blockadeOpposition(book, world, b);
  const coverage = Math.min(0.95, S / (S + D + c.blockadeTrafficScale));
  return { hulls, S, speed, coverage, D, n: hulls.length };
}
// The odds, separated. Detection: coverage, the group's signature, its speed and (only if every ship
// has one working) cloak. Interception, once seen: coverage, relative speed, and how much fight the
// group carries. What the engagement costs: the blockade's strength against the group's, and the
// group's condition.
export function assessBlockadeRun(book, world, b, runner, force = null) {
  const c = book.config;
  const f = force || blockadeForce(book, world, b);
  const r = runnerProfile(book, world, runner);
  // Relative dash: the runner's strategic speed against the blockade's (the same values their journeys fly at).
  // Strategic speeds are deliberately compressed (0.8–1.3); the interception's sensitivity to a dash was
  // tuned on the much wider tactical spread, so the ratio is squared here (interceptSpeedExponent) — a
  // calibration of this one term, not a second speed. (Max(1, …) was the guard for the old 45-unit scale.)
  const rel = bounded(Math.pow((r.speed || f.speed) / Math.max(0.1, f.speed), c.interceptSpeedExponent ?? 2), 0.4, 2.5);
  const stealth = r.cloakAll ? (c.interceptCloakFactor ?? 0.3) * (1 + (b.cloakDetection || 0)) : 1;
  const pDetect = bounded((0.2 + 0.85 * f.coverage) * r.signature * stealth * (1.2 - 0.2 * rel), 0.02, 0.97);
  const deterrence = r.E > 0 ? f.S / (f.S + (c.interceptEscortWeight ?? 1.5) * r.E) : 1;
  const pCatch = bounded((0.25 + 0.75 * f.coverage) * (1.35 - 0.45 * rel) * deterrence, 0.03, 0.95);
  const ratio = f.S > 0 ? r.E / f.S : Infinity;
  const base = r.E + f.S > 0 ? f.S / (f.S + (c.interceptEscortWeight ?? 1.5) * r.E) : 0;
  const condFactor = 1 + 0.6 * (1 - r.condition);
  // How hard an interception presses: the balance of force, the runner's condition, and how much of the
  // blockade can be brought to bear (its coverage). pressure = k × (0.6 + 0.8u), u uniform.
  const k = base * condFactor * (0.35 + 0.65 * f.coverage);
  const pBelow = (x) => { if (k <= 0) return 1; return bounded((x / k - 0.6) / 0.8, 0, 1); };
  const forced = ratio >= (c.interceptCoverRatio ?? 0.75);
  const pMinor = forced ? 1 : pBelow(RUN_MINOR);
  const pPass = 1 - pDetect * pCatch * (1 - pMinor);
  const estimate = pPass >= 0.8 ? 'favorable' : pPass >= 0.5 ? 'risky' : 'poor';
  return { pDetect, pCatch, pMinor, pLoss: forced ? 0 : 1 - pBelow(RUN_LOSSES), pPass, estimate, rel, ratio, E: r.E, S: f.S, coverage: f.coverage, pressureScale: k, cloakAll: r.cloakAll, speed: r.speed, blockadeSpeed: f.speed, signature: r.signature, condition: r.condition, profile: r, force: f };
}
// What the runner's crews could see of the blockade, by how close they came: a group that slipped by
// saw that it was there and roughly how thick; one that was challenged saw part of it; one that fought
// it counted it. Stored as observed then, never re-read from the live force.
function runObservation(outcome, f, day, u) {
  const n = f.n;
  const tier = blockadeTier(f.coverage);
  if (outcome === 'slipped_through') return { day, level: 'sighted', tier, force: null };
  if (['fought_through', 'blockade_broken'].includes(outcome)) return { day, level: 'engaged', tier, force: String(n) };
  const lo = Math.max(1, Math.floor(n * (0.5 + 0.3 * u))), hi = Math.max(lo + 1, Math.ceil(n * (1.3 + 0.4 * u)));
  return { day, level: 'contact', tier, force: `${lo}–${hi}` };
}
// Damage on the blockade from an engagement: the weakest hull on station first, each hull classified by
// the fleet damage model — disabled hulls leave the station, destroyed ones are lost.
function damageBlockade(book, world, b, amount, day, effects, by) {
  const out = { damaged: [], disabled: [], lost: [] };
  let left = amount;
  const order = () => b.hulls.map((t) => hullOf(book, b.power, t.hullId)).filter((h) => h && !hullOutOfAction(h) && !hullInEncounter(h))
    .sort((x, y) => hullStrength(book, world, x) - hullStrength(book, world, y) || String(x.id).localeCompare(String(y.id)));
  let guard = 0;
  while (left > 0 && guard++ < 20) {
    const h = order()[0];
    if (!h) break;
    const perPoint = hullStrength(book, world, h) / Math.max(1, h.hull);
    const pts = Math.min(h.hull, left / Math.max(1e-9, perPoint));
    h.hull = Math.max(0, Math.round((h.hull - pts) * 10) / 10);
    left -= pts * perPoint;
    const cond = classifyDamage(h.hull, h.maxHull);
    if (cond === 'destroyed') { loseHull(book, world, b.power, h.id, b.target, day, effects, by); b.losses++; b.hulls = b.hulls.filter((t) => t.hullId !== h.id); out.lost.push(h.id); }
    else if (cond === 'disabled') { h.status = 'repairing'; h.opId = null; b.hulls = b.hulls.filter((t) => t.hullId !== h.id); out.disabled.push(h.id); effects.push({ type: 'strategicShipReleased', id: b.id, sponsor: b.power, hullId: h.id, day }); }
    else { out.damaged.push(h.id); break; }
  }
  return out;
}
// STRATEGIC-TACTICAL-HANDOFF §6. The strategic layer still decides whether there is contact at all — the
// same seeded draws, on the same key and day, as resolveBlockadeRun — and only an interception (a runner
// seen AND caught) becomes a fight. Where the captain is present that fight is handed to the scene; the
// runner that slipped by or was only challenged is resolved exactly as before (no damage either way).
export function blockadeContact(book, world, b, runner, day) {
  const f = blockadeForce(book, world, b);
  const a = assessBlockadeRun(book, world, b, runner, f);
  const u = (tag) => seededUnit(book.seed, 'blockade-run', b.id, runner.key, day, tag);
  const detected = u('detect') < a.pDetect;
  const caught = detected && u('catch') < a.pCatch;
  return { detected, caught, fight: caught, estimate: a.estimate, odds: { pDetect: a.pDetect, pCatch: a.pCatch, pPass: a.pPass }, force: f.n, coverage: f.coverage, tier: blockadeTier(f.coverage) };
}
// The interception handed to the scene: the blockade's hulls actually on station against the runner's.
// A runner of the captain's (his own ship, his escorts) is the engine's and is recorded, not spawned.
export function openBlockadeEncounter(book, world, b, runner, day, spec = {}) {
  const f = blockadeForce(book, world, b);
  const contact = spec.contact || blockadeContact(book, world, b, runner, day);
  const player = runner.sponsor === 'player';
  const { enc, fresh } = SE.openEncounter(book, { key: `blockade:${b.id}:${runner.key}:${day}`, system: Number(b.target), type: 'blockade', objective: { kind: 'blockade', ref: b.id },
    authority: { kind: 'war', warKey: b.warKey || null, power: b.power }, sides: { a: b.power, b: runner.sponsor }, journeys: spec.journeyId ? [spec.journeyId] : [],
    captain: Boolean(spec.captain), playerHostile: player, reason: spec.reason || 'interception where the captain is',
    contact: { ...contact, runner: { key: runner.key, sponsor: runner.sponsor, kind: runner.kind || null, hulls: runner.hulls.map((x) => ({ ...x })) }, journeyId: spec.journeyId || null, leg: spec.leg ?? null, seq: spec.seq ?? null, blockadeId: b.id, power: b.power },
    participants: [...f.hulls.map((h) => ({ hullId: h.id, polity: b.power, side: 'blockader', record: h })),
      ...runner.hulls.map((x) => ({ hullId: x.hullId, vid: x.vid ?? null, polity: runner.sponsor, side: 'runner', shipId: x.shipId, role: x.role || null, cloak: x.cloak ?? null,
        // A hulk in tow is not put into the scene (§18): its strategic record stands; if its tug is lost there,
        // it is let go where the tug fought.
        towed: Boolean(x.towed), engineOwned: player, spawn: !player && !x.towed, record: player ? null : hullOf(book, runner.sponsor, x.hullId), before: { hull: x.hull, maxHull: x.maxHull, crew: x.crew ?? null } }))] }, day, lookupHull(book));
  return enc; // counted as an interception when it is settled (tactically, or by the strategic run on fallback)
}
// What the tactical result means for the blockade, written in the blockade's own terms: the run it records,
// its losses, what the runner's crews saw (only the ships that were actually in the scene), and whether it
// still stands.
const TACTICAL_RUN_OUTCOME = Object.freeze({ passed: 'fought_through', escaped: 'fought_through', broken: 'blockade_broken', forced_back: 'intercepted_forced_back', disengaged: 'fought_through' });
function applyTacticalRun(book, world, b, enc, outcome, day, effects) {
  book.stats.interceptions = (book.stats.interceptions || 0) + 1;
  const out = { lost: [], disabled: [], surrendered: [], damaged: [] };
  for (const p of enc.participants) {
    if (p.side !== 'blockader') continue;
    if (p.fate === 'destroyed') { out.lost.push(p.hullId); b.losses = (b.losses || 0) + 1; }
    else if (p.fate === 'disabled') { out.disabled.push(p.hullId); effects.push({ type: 'strategicShipReleased', id: b.id, sponsor: b.power, hullId: p.hullId, day }); }
    else if (p.fate === 'surrendered') out.surrendered.push(p.hullId);
    else if (p.after?.hull != null && p.before && Number(p.after.hull) < Number(p.before.hull)) out.damaged.push(p.hullId);
    if (['destroyed', 'disabled', 'surrendered'].includes(p.fate)) {
      b.hulls = b.hulls.filter((t) => t.hullId !== p.hullId);
      const h = hullOf(book, b.power, p.hullId);
      if (h && h.opId === b.id && p.fate !== 'destroyed') h.opId = null;
    }
  }
  let run = TACTICAL_RUN_OUTCOME[outcome] || 'fought_through';
  let broken = false;
  if (b.status === 'active') {
    const live = blockadeForce(book, world, b);
    if (!live.n || outcome === 'broken') { endBlockade(book, world, b, day, 'broken', enc.captain ? 'its interceptors were beaten off by the captain' : 'its interceptors were beaten off in a fight', effects); broken = true; }
    else refreshBlockadeCoverage(book, world, b, day, effects);
  }
  if (broken && RUN_CONTINUES.has(run)) run = 'blockade_broken';
  const spawned = enc.participants.filter((p) => p.side === 'blockader' && p.spawn && (enc.spawned || []).includes(p.vid || p.ref)).length;
  const observed = { day, level: 'engaged', tier: blockadeTier(b.coverage ?? 0), force: String(spawned), tactical: true };
  if (enc.sides?.b === 'player' || enc.captain || enc.observedByPlayer) b.sightings = { ...(b.sightings || {}), player: observed };
  b.runs = [...(b.runs || []), { day, by: enc.contact?.runner?.key || enc.id, sponsor: enc.sides?.b, kind: enc.contact?.runner?.kind || null, outcome: run, tactical: true, encounterId: enc.id }].slice(-30);
  if (RUN_CONTINUES.has(run)) { b.breaches.push({ day, by: enc.contact?.runner?.key || enc.id, kind: enc.contact?.runner?.kind || 'run' }); b.breaches = b.breaches.slice(-30); }
  return { run, continues: RUN_CONTINUES.has(run), broken, observed, blockaderLosses: { lost: out.lost.length, disabled: out.disabled.length, surrendered: out.surrendered.length, damaged: out.damaged.length } };
}
SE.registerEncounterFamily('blockade', {
  resolve(book, world, enc, report, day, effects) {
    const b = (book.blockades || []).find((x) => x.id === enc.objective.ref);
    const outcome = report.result?.outcome || 'passed';
    const res = b ? applyTacticalRun(book, world, b, enc, outcome, day, effects) : { run: outcome === 'forced_back' ? 'intercepted_forced_back' : 'fought_through', continues: outcome !== 'forced_back', broken: false };
    enc.result = { ...enc.result, run: res.run, continues: res.continues, broken: res.broken, blockaderLosses: res.blockaderLosses || null };
    // One report line for the engine (the encounter report): never a second, abstract "blockade run" report.
    effects.push({ type: 'blockadeRun', tactical: true, engineApplied: true, encounterId: enc.id, blockadeId: enc.objective.ref, power: enc.contact?.power, target: enc.system, sponsor: enc.sides?.b, key: enc.contact?.runner?.key, kind: enc.contact?.runner?.kind || null, day, outcome: res.run,
      continues: res.continues, detected: true, intercepted: true, hulls: [], blockaderLosses: res.blockaderLosses || null, broken: res.broken, observed: res.observed || null, journeyId: enc.contact?.journeyId || null });
    const tr = enc.contact?.journeyId ? journeyById(book, enc.contact.journeyId) : null;
    if (tr && tr.held?.encounterId === enc.id) { releaseHeldCrossing(book, world, tr, enc, { outcome: res.run, continues: res.continues }, day, effects); return { continuation: res.continues ? 'the runners fly on' : 'the runners turn back', journeyResumed: true }; }
    return { continuation: enc.captain ? (res.continues ? 'the captain may resume his course' : 'the captain falls back') : (res.continues ? 'passed' : 'forced back') };
  },
  fallback(book, world, enc, day, effects) {
    const b = (book.blockades || []).find((x) => x.id === enc.objective.ref);
    const runner = enc.contact?.runner;
    if (!b || !runner || b.status !== 'active') {
      const tr = enc.contact?.journeyId ? journeyById(book, enc.contact.journeyId) : null;
      if (tr && tr.held?.encounterId === enc.id) releaseHeldCrossing(book, world, tr, enc, { outcome: 'slipped_through', continues: true }, day, effects);
      return { continuation: 'the blockade was gone: the runner goes on' };
    }
    // The ordinary strategic run, exactly once, on the contact's own key and day.
    const r = resolveBlockadeRun(book, world, b, runner, Number(enc.createdDay), effects, { meta: { encounterId: enc.id, fallback: true, journeyId: enc.contact.journeyId || null, engineApplied: false } });
    enc.fallback.run = { outcome: r.outcome, continues: r.continues };
    // The strategic run decided the runners' fates on their records: the held crossing detaches them the
    // same way a tactical result would (a lost or disabled runner never flies on with the journey).
    for (const x of r.hulls || []) {
      const p = enc.participants.find((q) => q.side === 'runner' && String(q.hullId) === String(x.hullId));
      if (p && ['destroyed', 'disabled'].includes(x.condition)) p.fate = x.condition;
    }
    enc.result = { outcome: r.continues ? 'passed' : 'forced_back', run: r.outcome, continues: r.continues, strategic: true };
    const tr = enc.contact?.journeyId ? journeyById(book, enc.contact.journeyId) : null;
    if (tr && tr.held?.encounterId === enc.id) releaseHeldCrossing(book, world, tr, enc, r, day, effects);
    return { continuation: `strategic run: ${r.outcome}`, run: r };
  },
  abort(book, enc) {
    const tr = enc.contact?.journeyId ? journeyById(book, enc.contact.journeyId) : null;
    if (tr && tr.held?.encounterId === enc.id) tr.heldAborted = true;
  },
});
// A model journey held at a crossing while its interception was fought in the scene: the rest of that
// crossing now happens — the result on its record, the ships lost or disabled there dropped out where it
// happened, any other blockade at the same system run strategically — and the journey settles exactly as
// if the run had been resolved there and then (on, back, or arrived). Never a second crossing.
function releaseHeldCrossing(book, world, tr, enc, run, day, effects) {
  const held = tr.held;
  if (!held) return;
  delete tr.held;
  const at = Number(held.at);
  const hooks = JOURNEY_KINDS[tr.kind] || {};
  const out = { at, day: Number(held.day), fresh: true, runs: [run], turnedBack: !run.continues, disabled: [], destroyed: [], leftEnRoute: [], released: true };
  const lost = [], disabled = [];
  const towedIds = new Set((tr.tow?.targets || []).map(String));
  for (const p of enc.participants) {
    if (p.side !== 'runner' || !tr.members.includes(p.hullId)) continue;
    if (towedIds.has(String(p.hullId)) && p.fate !== 'destroyed') continue; // in tow; not in the scene (§18)
    if (p.fate === 'destroyed') { lost.push(tr.vids[p.hullId] ?? p.hullId); J.detachMember(tr, p.hullId, at, day, 'destroyed'); out.destroyed.push(p.hullId); hooks.onDetach?.(book, world, tr, { id: p.hullId, status: 'lost' }, 'destroyed', at, day, effects); }
    else if (p.fate === 'disabled' || p.fate === 'surrendered') { disabled.push(tr.vids[p.hullId] ?? p.hullId); J.detachMember(tr, p.hullId, at, day, p.fate); out.disabled.push(p.hullId); const h = hullOf(book, tr.sponsor, p.hullId); if (h) hooks.onDetach?.(book, world, tr, h, p.fate, at, day, effects); }
  }
  tr.encounters.push({ system: at, day: Number(held.day), leg: held.leg, seq: held.seq, blockadeId: held.blockadeId, power: enc.contact?.power ?? null, outcome: run.outcome, tactical: !enc.fallback, encounterId: enc.id, lost, disabled });
  dropUntowed(book, world, tr, at, day, effects, out);
  if (run.continues && tr.members.length) {
    const more = runJourneyBlockades(book, world, tr, at, Number(held.day), effects, out, { skip: new Set([held.blockadeId]) });
    if (more) out.turnedBack = true;
  }
  settleCrossing(book, world, tr, out, effects);
}
// Resolve one crossing. Deterministic for a given book seed and key: the same runner reaching the same
// blockade on the same day gets the same answer after a reload. Applies everything it decides to the
// book (blockade hulls, the runner's polity hulls where the book holds them) and reports the rest in
// the result and one 'blockadeRun' effect for the engine.
export function resolveBlockadeRun(book, world, b, runner, day, effects = [], opts = {}) {
  const c = book.config;
  book.stats.interceptions = (book.stats.interceptions || 0) + 1;
  // Obstructing guaranteed transit (a blockade ordered to stop a beneficiary anyway): the run happens, and it is
  // a breach by the blockading power, known to the ships it stopped (TREATY-EXPANSION §3, §12).
  const guarantee = book.treatyTerms?.length ? transitGuaranteeAt(book, b.power, runner.sponsor, b.target, day, runner.trafficClass || 'military') : null;
  if (guarantee) {
    const key = `${guarantee.id}|obstructed|${runner.key}`;
    treatyBook(book);
    if (!book.treatyIncidents.some((x) => x.key === key)) {
      treatyStats(book).obstructions++;
      recordTreatyIncident(book, world, { key, term: guarantee, kind: 'transit_obstructed', breaching: b.power, systemIndex: Number(b.target), assets: [b.id], evidence: [{ type: 'intercepted', by: runner.sponsor, day }], knownTo: [runner.sponsor], severity: 'serious', state: 'breach', day, detail: `blockade ${b.id} stopped guaranteed transit` }, effects);
    }
  }
  const f = blockadeForce(book, world, b);
  const a = assessBlockadeRun(book, world, b, runner, f);
  const u = (tag) => seededUnit(book.seed, 'blockade-run', b.id, runner.key, day, tag);
  const detected = u('detect') < a.pDetect;
  const caught = detected && u('catch') < a.pCatch;
  let outcome, pressure = 0;
  if (!detected) outcome = 'slipped_through';
  else if (!caught) outcome = 'challenged_but_passed';
  // Escorts strong enough to screen the convoy engage the blockade and hold it off: the convoy goes on
  // while they take the fight.
  else if (a.ratio >= (c.interceptCoverRatio ?? 0.75)) outcome = 'fought_through';
  else {
    pressure = a.pressureScale * (0.6 + 0.8 * u('fight'));
    outcome = pressure < RUN_MINOR ? 'intercepted_minor_damage' : pressure < RUN_LOSSES ? 'intercepted_forced_back' : 'intercepted_losses';
  }
  // The runner's damage. Escorts and armed ships stand between the blockade and the rest: they take the
  // damage first, in proportion to the fight they carry.
  const results = a.profile.members.map((m) => ({ hullId: m.hullId, vid: m.vid ?? null, shipId: m.shipId, role: m.role || null, before: m.hull, hull: m.hull, maxHull: m.maxHull, condition: m.cond }));
  const byId = new Map(results.map((x) => [x.hullId, x]));
  const hit = (m, share) => { const x = byId.get(m.hullId); x.hull = Math.max(0, Math.round((x.hull - m.maxHull * share) * 10) / 10); x.condition = classifyDamage(x.hull, x.maxHull); };
  if (['intercepted_minor_damage', 'intercepted_forced_back', 'intercepted_losses', 'fought_through'].includes(outcome)) {
    const fightRatio = outcome === 'fought_through' ? bounded(1 / Math.max(0.5, a.ratio), 0.1, 1) : Math.min(1, pressure);
    const dmg = (c.interceptDamageScale ?? 0.3) * fightRatio;
    const fighters = a.profile.active.filter((m) => m.combat >= 0.5);
    const cover = fighters.length && a.E > 0 ? (outcome === 'fought_through' ? 0.9 : Math.min(0.85, a.E / (a.E + a.S))) : 0;
    for (const m of a.profile.active) {
      const roll = 0.5 + 0.6 * u(`hit:${m.hullId}`);
      const share = fighters.includes(m) ? dmg * roll * (cover > 0 ? 1.3 : 1) : dmg * roll * (1 - cover);
      hit(m, Math.min(0.5, share));
    }
    // A hulk in tow cannot dodge: it takes an unarmed ship's share, and it may not survive it.
    for (const m of a.profile.towed || []) hit(m, Math.min(0.5, dmg * (0.5 + 0.6 * u(`hit:${m.hullId}`)) * (1 - cover)));
    if (outcome === 'intercepted_losses') {
      // The ship that is caught: escorts put themselves in the way as often as they cover the convoy
      // (the weakest of them takes it); otherwise the most exposed — least armed, worst condition.
      const byExposure = (list) => [...list].sort((x, y) => (x.combat - y.combat) || (x.frac - y.frac) || String(x.hullId).localeCompare(String(y.hullId)));
      const screened = fighters.length && u('screen') < cover;
      const exposed = screened ? [...fighters].sort((x, y) => (x.frac - y.frac) || String(x.hullId).localeCompare(String(y.hullId)))[0] : byExposure(a.profile.active)[0];
      if (exposed) {
        const x = byId.get(exposed.hullId);
        const kill = u('kill') < 0.35 * (1 - cover);
        x.hull = kill ? 0 : Math.min(x.hull, Math.max(1, Math.floor(x.maxHull * 0.08)));
        x.condition = classifyDamage(x.hull, x.maxHull);
      }
    }
    // Bounded: never more than one runner destroyed in a single crossing.
    let kills = results.filter((x) => x.condition === 'destroyed');
    for (const x of kills.slice(c.interceptMaxLossesPerRun ?? 1)) { x.hull = Math.max(1, Math.floor(x.maxHull * 0.05)); x.condition = classifyDamage(x.hull, x.maxHull); }
  }
  // The blockade's damage: what the group's fighting ships land on it when there is a fight.
  let blockaderLosses = { damaged: [], disabled: [], lost: [] };
  if (caught) {
    const dealt = a.E * (c.interceptBlockadeDamage ?? 0.25) * (0.5 + u('return')) * (outcome === 'fought_through' ? 1.5 : 1);
    if (dealt > 0) blockaderLosses = damageBlockade(book, world, b, dealt, day, effects, runner.sponsor);
  }
  // Apply the runner's damage to the hulls the book holds for its sponsor (an AI's, or the mirror of the
  // captain's fleet, which the engine re-reads from the effect).
  for (const x of results) {
    const h = hullOf(book, runner.sponsor, x.hullId);
    if (!h) continue;
    h.hull = x.hull;
    if (x.condition === 'destroyed') { h.status = 'lost'; h.opId = null; const p = book.polities[runner.sponsor]; if (p) p.lostHulls = (p.lostHulls || 0) + 1; book.stats.hullsLost++; }
  }
  // A blockade whose force is gone, or now badly outmatched by the local defence, breaks.
  let broken = false;
  if (b.status === 'active') {
    const live = blockadeForce(book, world, b);
    if (!live.n) { endBlockade(book, world, b, day, 'broken', 'its force was beaten off by a convoy', effects); broken = true; }
    else if (a.ratio >= (c.interceptBreakRatio ?? 2) * 2 && blockaderLosses.lost.length + blockaderLosses.disabled.length > 0) { endBlockade(book, world, b, day, 'broken', 'a superior force fought through it', effects); broken = true; }
    else refreshBlockadeCoverage(book, world, b, day, effects);
  }
  if (broken && RUN_CONTINUES.has(outcome) || broken && outcome === 'fought_through') outcome = 'blockade_broken';
  const observed = runObservation(outcome, f, day, u('observe'));
  if (runner.sponsor === 'player') { b.sightings = { ...(b.sightings || {}), player: observed }; }
  b.runs = [...(b.runs || []), { day, by: runner.key, sponsor: runner.sponsor, kind: runner.kind || null, outcome }].slice(-30);
  if (RUN_CONTINUES.has(outcome)) { b.breaches.push({ day, by: runner.key, kind: runner.kind || 'run' }); b.breaches = b.breaches.slice(-30); }
  const out = { blockadeId: b.id, power: b.power, target: b.target, sponsor: runner.sponsor, key: runner.key, kind: runner.kind || null, day, outcome,
    continues: RUN_CONTINUES.has(outcome), detected, intercepted: caught, estimate: a.estimate,
    odds: { pDetect: Math.round(a.pDetect * 1000) / 1000, pCatch: Math.round(a.pCatch * 1000) / 1000, pPass: Math.round(a.pPass * 1000) / 1000 },
    hulls: results, blockaderLosses: { damaged: blockaderLosses.damaged.length, disabled: blockaderLosses.disabled.length, lost: blockaderLosses.lost.length }, broken, observed, ...(opts.meta || {}) };
  effects.push({ type: 'blockadeRun', ...out });
  return out;
}

// ---------- towing, salvage and stranded-hull recovery (TOWING-SALVAGE-RECOVERY) ----------
// A disabled hull is physically recovered or it stays where it lies. A mission is one persistent record
// (book.hullRecoveries) with a stable id; its movement is two shared journeys of kind `recovery` — the tug
// (and its escorts) out to the hulk, then the towing group with the hulk as a member back to a yard, at the
// tow speed (journeySpeed) — so every crossing, blockade run, tactical handoff, save and reload is the
// shared engine's. The hulk is the same record and the same vid throughout; salvage changes its owner,
// never its origin. Nothing here spawns a ship or moves one without a journey.
function recoveryBook(book) { return (book.hullRecoveries ||= []); }
export function hullRecoveryById(book, id) { return recoveryBook(book).find((r) => r.id === id) || null; }
export function openHullRecoveries(book) { return recoveryBook(book).filter((r) => REC.recoveryOpen(r)); }
function recoveryStats(book) {
  return (book.stats.recovery ||= { requested: 0, refused: 0, launched: 0, delivered: 0, failed: 0, aborted: 0, tugLosses: 0, hulksLostUnderTow: 0,
    salvageClaims: 0, salvaged: 0, valueRecovered: 0, outboundDays: 0, outboundN: 0, towDays: 0, towN: 0, skipped: {}, derelictsBrokenUp: 0 });
}
// The live claim on a hull: an open mission naming it as its target.
export function liveRecoveryClaim(book, h) {
  if (!h) return null;
  return recoveryBook(book).find((r) => REC.recoveryOpen(r) && String(r.target.hullId) === String(h.id)) || null;
}
// A hull wherever it is: on a polity's books (alive), or lying abandoned (a derelict).
function findHulk(book, hullId) {
  for (const [pid, p] of Object.entries(book.polities || {})) {
    const h = (p.hulls || []).find((x) => String(x.id) === String(hullId));
    if (h && h.status !== 'lost') return { h, owner: pid, derelict: false };
  }
  const d = (book.derelicts || []).find((x) => String(x.id) === String(hullId) && !x.derelict?.goneDay);
  return d ? { h: d, owner: d.derelict?.abandonedBy ?? null, derelict: true } : null;
}
export function recoveryCapacityOf(world, h) { return REC.classRecoveryCapacity(world.shipStats(h?.shipId)); }
export function towRequirementOf(world, h) { return REC.towRequirement(world.shipStats(h?.shipId)); }
function hulkValue(world, h) { return Math.max(0, Number(world.shipStats(h?.shipId)?.price) || 0); }
function hulkCrew(h, owner) { return h?.stranded?.crew ?? (owner === 'player' ? 'aboard' : 'aboard'); }
// A yard a tow may deliver to: the sponsor's own yard, or — for the captain, who buys repairs where he is
// served — a yard in a system whose holder is not at war with him. Never under an applicable blockade.
function towYardOk(book, world, sponsor, i) {
  const sys = world.systems[Number(i)];
  if (!sys || applicableBlockadesAt(book, world, i, sponsor).length) return false;
  if (sys.controller === sponsor) return (stationEffects(world, Number(i), sponsor).repairCapacity || 0) > 0;
  // An enemy's yard takes nothing in, whatever terms are on the books (ARCHITECTURE-CLEANUP §3).
  if (sys.controller && world.relation(relSide(world, sponsor), relSide(world, sys.controller)) === 'war') return false;
  // A host's yard under basing rights to take her in and repair her (TREATY-EXPANSION §4; AUDIT A4).
  if (basingRecoveryYardAt(book, world, sponsor, i)) return true;
  if (sponsor !== 'player' || !sys.controller) return false;
  // A foreign yard accepts the captain's hulk only if it would actually repair her for him: the engine's own
  // service test (a working yard, a vendor that serves him — ARCHITECTURE-CLEANUP §3, TOWING-SALVAGE-AUDIT A9).
  if (world.playerYardServes && !world.playerYardServes(Number(i))) return false;
  return (stationEffects(world, Number(i), sys.controller).repairCapacity || 0) > 0;
}
// The nearest suitable yard from `from`, by the days the tow will actually fly (never through a wormhole).
function chooseTowYard(book, world, sponsor, from, speed, avoid = null) {
  let best = null;
  for (const sys of world.systems) {
    if (!towYardOk(book, world, sponsor, sys.index)) continue;
    const plan = Number(sys.index) === Number(from) ? { path: [], legDays: [] } : plotJourney(world, from, sys.index, sponsor, avoid, speed, { noFixed: true, cls: 'recovery' });
    if (!plan) continue;
    const days = plan.legDays.reduce((n, d) => n + d, 0);
    if (!best || days < best.days || (days === best.days && sys.index < best.yard)) best = { yard: Number(sys.index), days, plan };
  }
  return best;
}
// The facts the claim rules read (strategic-recovery.mjs claimVerdict).
function claimFacts(book, world, claimant, found, at, recordId = null) {
  const { h, owner, derelict } = found;
  const other = liveRecoveryClaim(book, h);
  const atWarWithOwner = owner && claimant !== owner ? world.relation(relSide(world, claimant), relSide(world, owner)) === 'war' : false;
  const ownerHoldsSystem = owner && claimant !== owner && world.systems[Number(at)]?.controller === owner;
  const ownerGuards = owner && claimant !== owner && !derelict
    && (book.polities[owner]?.hulls || []).some((x) => x.id !== h.id && Number(x.systemIndex) === Number(at) && !x.transit && x.status !== 'lost' && classifyDamage(x.hull, x.maxHull) === 'operational');
  return { claimant, owner, abandoned: derelict, crew: hulkCrew(h, owner), surrendered: h.status === 'surrendered', atWar: atWarWithOwner,
    ownerHoldsSystem, ownerGuards, otherClaim: other && other.id !== recordId ? other.id : null, engineOwned: owner === 'player' && claimant !== 'player', claimantIsPlayer: claimant === 'player' };
}
// Whether this hulk may be taken in tow by `claimant` now, and on what authority.
export function recoveryClaim(book, world, claimant, hullId, recordId = null) {
  const found = findHulk(book, hullId);
  if (!found) return { ok: false, reason: 'no such hulk' };
  const at = Number(found.h.systemIndex);
  return { ...REC.claimVerdict(claimFacts(book, world, claimant, found, at, recordId)), owner: found.owner, derelict: found.derelict, systemIndex: at };
}
// Why a hulk cannot be the object of a recovery at all, or null.
function hulkUnfit(book, found) {
  const { h, derelict, owner } = found;
  if (derelict) return h.hull > 0 ? null : 'broken up';
  if (!hullIsDisabled(h)) return 'not disabled';
  if (h.transit || hullInEncounter(h)) return 'not lying anywhere a tug can reach (in warp or in a fight)';
  if (owner !== 'player' && ['recovering', 'in_yard'].includes(h.stranded?.recovery)) return 'already in a yard';
  if (h.opId) return 'still held by its job';
  return null;
}
// The plan for one recovery, without making it: who tows, how far each way, how fast, to which yard.
export function planHullRecovery(book, world, spec, day = book.day) {
  const sponsor = spec.sponsor;
  const found = findHulk(book, spec.targetHullId);
  if (!found) return { ok: false, reason: 'no such hulk' };
  const unfit = hulkUnfit(book, found);
  if (unfit) return { ok: false, reason: unfit };
  const target = found.h, at = Number(target.systemIndex);
  const claim = REC.claimVerdict(claimFacts(book, world, sponsor, found, at, spec.recordId ?? null));
  if (!claim.ok) return { ok: false, reason: claim.reason, claim };
  if (spec.tugHullId == null) return { ok: false, reason: 'no recovery vessel available', claimOk: true, kind: claim.kind, authority: claim.authority, owner: found.owner, derelict: found.derelict, target, at, crew: hulkCrew(target, found.owner) };
  const tug = hullOf(book, sponsor, spec.tugHullId);
  if (!tug || tug.status === 'lost') return { ok: false, reason: 'no such recovery vessel' };
  if (tug.id === target.id) return { ok: false, reason: 'a hulk cannot tow itself' };
  if (hullUnavailable(tug) || tug.opId || (tug.status !== 'ready' && sponsor !== 'player')) return { ok: false, reason: 'the recovery vessel is not free' };
  const can = REC.canTow(world.shipStats(tug.shipId), world.shipStats(target.shipId));
  if (!can.ok) return { ok: false, reason: can.reason, capacity: can.capacity, need: can.need };
  const escorts = (spec.escortHullIds || []).map((id) => hullOf(book, sponsor, id));
  if (escorts.some((e) => !e || e.status === 'lost' || hullUnavailable(e) || e.opId || Number(e.systemIndex) !== Number(tug.systemIndex))) return { ok: false, reason: 'an escort is not free or not with the recovery vessel' };
  const group = [tug, ...escorts];
  const groupSpeed = hullsSpeed(world, group);
  const outbound = Number(tug.systemIndex) === at ? { systems: [at], path: [], legDays: [] } : plotJourney(world, tug.systemIndex, at, sponsor, spec.avoid ? new Set(spec.avoid) : null, groupSpeed, { cls: 'recovery' });
  if (!outbound) return { ok: false, reason: 'no route to the hulk' };
  const tSpeed = SPD.towSpeed(groupSpeed, book.config.towPenalty);
  const yard = spec.yard != null && towYardOk(book, world, sponsor, spec.yard)
    ? { yard: Number(spec.yard), plan: Number(spec.yard) === at ? { path: [], legDays: [] } : plotJourney(world, at, spec.yard, sponsor, null, tSpeed, { noFixed: true, cls: 'recovery' }) }
    : chooseTowYard(book, world, sponsor, at, tSpeed, spec.avoid ? new Set(spec.avoid) : null);
  if (!yard || !yard.plan) return { ok: false, reason: 'no yard a tow can reach' };
  const outboundDays = outbound.legDays.reduce((n, d) => n + d, 0), towDays = yard.plan.legDays.reduce((n, d) => n + d, 0);
  return { ok: true, kind: claim.kind, authority: claim.authority, owner: found.owner, derelict: found.derelict, target, tug, escorts, at, yard: yard.yard,
    capacity: can.capacity, need: can.need, groupSpeed, towSpeed: tSpeed, outbound, outboundDays, inbound: yard.plan, towDays, etaDays: outboundDays + towDays,
    arriveDay: Number(day) + outboundDays, deliverDay: Number(day) + outboundDays + towDays, value: hulkValue(world, target), crew: hulkCrew(target, found.owner) };
}
function noteRecovery(rec, day, state, note = '') {
  rec.state = state;
  rec.history.push({ day: Number(day), state, note });
  if (rec.history.length > 24) rec.history = rec.history.slice(-24);
}
function recoveryEffect(rec, type, day, extra = {}) {
  return { type, id: rec.id, kind: rec.kind, sponsor: rec.sponsor, owner: rec.owner, targetHullId: rec.target.hullId, vid: rec.target.vid, tugHullId: rec.tug?.hullId ?? null,
    escortHullIds: rec.escorts.map((e) => e.hullId), targetSystem: rec.targetSystem, yard: rec.yard, state: rec.state, day: Number(day), ...extra };
}
// Start a recovery: the plan made real. The tug (and escorts) are committed and set out at once.
export function requestHullRecovery(book, world, spec, day, effects = []) {
  const st = recoveryStats(book);
  st.requested++;
  if (openHullRecoveries(book).length >= (book.config.recoveryMaxActive ?? 40)) { st.refused++; return { ok: false, reason: 'too many recoveries under way' }; }
  const plan = planHullRecovery(book, world, spec, day);
  if (!plan.ok) { st.refused++; return plan; }
  const { target, tug, escorts } = plan;
  const rec = { id: nextCampaignId(book, 'tow'), kind: plan.kind, sponsor: spec.sponsor, owner: plan.owner, requestedBy: spec.requestedBy || (spec.sponsor === 'player' ? 'player' : 'ai'),
    target: { hullId: target.id, vid: vidOfHull(target), shipId: target.shipId, origin: target.identity?.origin?.builder ?? plan.owner, crewAtRequest: plan.crew },
    tug: { hullId: tug.id, vid: vidOfHull(tug), shipId: tug.shipId, capacity: plan.capacity }, escorts: escorts.map((e) => ({ hullId: e.id, vid: vidOfHull(e), shipId: e.shipId })),
    need: plan.need, targetSystem: plan.at, yard: plan.yard, claim: { authority: plan.authority, kind: plan.kind, since: Number(day) }, value: plan.value,
    plan: { outboundDays: plan.outboundDays, towDays: plan.towDays, towSpeed: plan.towSpeed, groupSpeed: plan.groupSpeed, arriveDay: plan.arriveDay, deliverDay: plan.deliverDay },
    outbound: null, inbound: null, journeyIds: [], attachment: null, crew: plan.crew, createdDay: Number(day), endedDay: null, reason: null, avoid: [...(spec.avoid || [])], waitingSince: null, history: [], losses: [] };
  noteRecovery(rec, day, 'requested', `${plan.kind} of ${rec.target.vid} at ${plan.at}`);
  recoveryBook(book).push(rec);
  if (target.status !== 'lost') target.recoveryClaim = { id: rec.id, by: spec.sponsor, kind: plan.kind, since: Number(day) };
  for (const h of [tug, ...escorts]) { if (spec.sponsor !== 'player') h.status = 'assigned'; h.opId = rec.id; }
  noteRecovery(rec, day, 'assigned', `${rec.tug.vid} (capacity ${plan.capacity} ≥ ${plan.need})${escorts.length ? ` + ${escorts.length} escort(s)` : ''}`);
  if (plan.kind === 'salvage') st.salvageClaims++;
  st.launched++;
  effects.push(recoveryEffect(rec, 'hullRecoveryAssigned', day, { etaDays: plan.etaDays, outboundDays: plan.outboundDays, towDays: plan.towDays, towSpeed: plan.towSpeed }));
  if (spec.sponsor === 'player') effects.push({ type: 'strategicShipsAssigned', id: rec.id, sponsor: 'player', hulls: [tug.id, ...escorts.map((e) => e.id)], role: 'recovery', systemIndex: Number(tug.systemIndex), day });
  addHistory(book, day, 'recovery', `${spec.sponsor} sends ${rec.tug.vid} to ${plan.kind === 'salvage' ? 'salvage' : 'recover'} ${rec.target.vid} at system ${plan.at}.`, { systemIndex: plan.at });
  startOutbound(book, world, rec, day, effects);
  return { ok: true, record: rec, plan };
}
// A request with no recovery vessel free (TOWING-SALVAGE-RULES §3): kept, not refused and never answered by
// conjuring a ship. The hulk is claimed (no second mission, no write-off while it waits) and lies exactly where
// it is; a vessel is assigned when one is free (assignHullRecoveryAsset), or the request is cancelled.
export function requestHullRecoveryWaiting(book, world, spec, day, effects = []) {
  const st = recoveryStats(book);
  st.requested++;
  const p = planHullRecovery(book, world, { ...spec, tugHullId: null }, day);
  if (!p.claimOk) { st.refused++; return { ok: false, reason: p.reason }; }
  const target = p.target;
  const rec = { id: nextCampaignId(book, 'tow'), kind: p.kind, sponsor: spec.sponsor, owner: p.owner, requestedBy: spec.requestedBy || (spec.sponsor === 'player' ? 'player' : 'ai'),
    target: { hullId: target.id, vid: vidOfHull(target), shipId: target.shipId, origin: target.identity?.origin?.builder ?? p.owner, crewAtRequest: p.crew },
    tug: null, escorts: [], need: REC.towRequirement(world.shipStats(target.shipId)), targetSystem: p.at, yard: null, claim: { authority: p.authority, kind: p.kind, since: Number(day) }, value: hulkValue(world, target),
    plan: null, outbound: null, inbound: null, journeyIds: [], attachment: null, crew: p.crew, createdDay: Number(day), endedDay: null, reason: null, avoid: [...(spec.avoid || [])],
    waitingSince: null, awaitingAsset: Number(day), history: [], losses: [] };
  noteRecovery(rec, day, 'requested', `${p.kind} of ${rec.target.vid} at ${p.at}: awaiting a recovery vessel`);
  recoveryBook(book).push(rec);
  if (target.status !== 'lost') target.recoveryClaim = { id: rec.id, by: spec.sponsor, kind: p.kind, since: Number(day) };
  st.waitingRequests = (st.waitingRequests || 0) + 1;
  effects.push(recoveryEffect(rec, 'hullRecoveryAwaitingAsset', day));
  return { ok: true, record: rec, waiting: true };
}
// A waiting request gets its vessel: the same planner, the same record; it sets out at once.
export function assignHullRecoveryAsset(book, world, id, spec, day, effects = []) {
  const rec = hullRecoveryById(book, id);
  if (!rec || rec.state !== 'requested' || rec.awaitingAsset == null) return { ok: false, reason: 'no request awaiting a vessel' };
  const plan = planHullRecovery(book, world, { sponsor: rec.sponsor, targetHullId: rec.target.hullId, tugHullId: spec.tugHullId, escortHullIds: spec.escortHullIds || [], yard: spec.yard, avoid: rec.avoid, recordId: rec.id }, day);
  if (!plan.ok) return plan;
  const { tug, escorts } = plan;
  rec.tug = { hullId: tug.id, vid: vidOfHull(tug), shipId: tug.shipId, capacity: plan.capacity };
  rec.escorts = escorts.map((e) => ({ hullId: e.id, vid: vidOfHull(e), shipId: e.shipId }));
  rec.need = plan.need; rec.yard = plan.yard;
  rec.plan = { outboundDays: plan.outboundDays, towDays: plan.towDays, towSpeed: plan.towSpeed, groupSpeed: plan.groupSpeed, arriveDay: plan.arriveDay, deliverDay: plan.deliverDay };
  rec.waitedDays = Number(day) - rec.awaitingAsset;
  rec.awaitingAsset = null;
  for (const h of [tug, ...escorts]) { if (rec.sponsor !== 'player') h.status = 'assigned'; h.opId = rec.id; }
  noteRecovery(rec, day, 'assigned', `${rec.tug.vid} (capacity ${plan.capacity} ≥ ${plan.need}) after ${rec.waitedDays} day(s) waiting`);
  const st = recoveryStats(book); st.launched++; if (plan.kind === 'salvage') st.salvageClaims++;
  effects.push(recoveryEffect(rec, 'hullRecoveryAssigned', day, { etaDays: plan.etaDays, outboundDays: plan.outboundDays, towDays: plan.towDays, towSpeed: plan.towSpeed }));
  if (rec.sponsor === 'player') effects.push({ type: 'strategicShipsAssigned', id: rec.id, sponsor: 'player', hulls: [tug.id, ...escorts.map((e) => e.id)], role: 'recovery', systemIndex: Number(tug.systemIndex), day });
  startOutbound(book, world, rec, day, effects);
  return { ok: true, record: rec, plan };
}
function recoveryGroup(book, rec) { return [rec.tug, ...rec.escorts].filter(Boolean).map((x) => hullOf(book, rec.sponsor, x.hullId)).filter((h) => h && h.status !== 'lost'); }
function startOutbound(book, world, rec, day, effects) {
  const group = recoveryGroup(book, rec).filter((h) => !h.transit);
  const tug = hullOf(book, rec.sponsor, rec.tug.hullId);
  if (!tug || tug.status === 'lost' || hullIsDisabled(tug)) return failRecovery(book, world, rec, day, effects, 'the recovery vessel was lost before it reached the hulk', 'failed');
  if (Number(tug.systemIndex) === Number(rec.targetSystem)) return onRecoveryScene(book, world, rec, day, effects);
  const r = startJourney(book, world, { kind: 'recovery', ref: rec.id, sponsor: rec.sponsor, hulls: group.filter((h) => Number(h.systemIndex) === Number(tug.systemIndex)), destination: rec.targetSystem,
    purpose: 'recovery', avoid: rec.avoid.length ? new Set(rec.avoid) : null, authority: { kind: 'recovery', ref: rec.id }, meta: { recoveryId: rec.id, leg: 'outbound' } }, day, effects);
  if (!r.ok) { rec.waitingSince ??= Number(day); rec.waitReason = r.reason; return false; }
  rec.waitingSince = null;
  rec.journeyIds.push(r.journey.id);
  rec.outbound = { journeyId: r.journey.id, route: [Number(tug.systemIndex), ...r.journey.path], legDays: r.journey.legDays.slice(), speed: r.journey.speed, departDay: Number(day), eta: r.journey.etaDay };
  const st = recoveryStats(book); st.outboundDays += r.journey.legDays.reduce((n, d) => n + d, 0); st.outboundN++;
  noteRecovery(rec, day, 'en_route_to_hulk', `${rec.outbound.route.length - 1} leg(s), arrives day ${r.journey.etaDay}`);
  if (r.arrived) onRecoveryScene(book, world, rec, day, effects);
  return true;
}
// The tug is at the hulk's system: everything is checked again, here, before anything is made fast.
function onRecoveryScene(book, world, rec, day, effects) {
  if (!REC.recoveryOpen(rec)) return releaseRecoveryGroup(book, world, rec, day, effects);
  noteRecovery(rec, day, 'on_scene', `at system ${rec.targetSystem}`);
  const found = findHulk(book, rec.target.hullId);
  const tug = hullOf(book, rec.sponsor, rec.tug.hullId);
  const why = (() => {
    if (!found) {
      const anywhere = Object.values(book.polities).flatMap((p) => p.hulls).find((x) => String(x.id) === String(rec.target.hullId));
      return anywhere?.fate === 'captured' ? 'the hulk was captured before the tug arrived' : 'the hulk is gone (destroyed or broken up)';
    }
    if (Number(found.h.systemIndex) !== Number(rec.targetSystem)) return 'the hulk is no longer there';
    if (found.owner !== rec.owner && found.owner !== rec.sponsor) return 'the hulk was taken by someone else';
    if (!found.derelict && !hullIsDisabled(found.h)) return 'the hulk was already recovered';
    if (!found.derelict && found.owner !== 'player' && ['recovering', 'in_yard'].includes(found.h.stranded?.recovery)) return 'the hulk was already recovered';
    const claim = REC.claimVerdict(claimFacts(book, world, rec.sponsor, found, rec.targetSystem, rec.id));
    if (!claim.ok) return `no claim: ${claim.reason}`;
    if (!tug || tug.status === 'lost' || classifyDamage(tug.hull, tug.maxHull) !== 'operational') return 'the recovery vessel cannot take her in tow';
    if (!REC.canTow(world.shipStats(tug.shipId), world.shipStats(found.h.shipId)).ok) return 'the recovery vessel cannot take her in tow';
    return null;
  })();
  if (why) return failRecovery(book, world, rec, day, effects, why, 'aborted');
  const h = found.h;
  // Salvage: the hulk changes hands here — the same record, the same vid, the same damage and equipment; its
  // origin (who built it) never changes.
  if (rec.kind === 'salvage' && found.owner !== rec.sponsor) {
    if (rec.sponsor === 'player') {
      // The captain's books are the engine's: it adopts the very same vessel (identity, class, damage) and
      // names the record it now keeps her under; the tow sets out once it has (adoptSalvagedHull).
      // Her condition as she lies, read before she leaves the old owner's books (transferHullOut zeroes the
      // record it closes): the captain gets this damage, not a fresh hull and not 1 point (TOWING-SALVAGE-AUDIT A2).
      const hull0 = Number(h.hull), maxHull0 = Number(h.maxHull);
      const out = transferHullOut(book, h.id, { day, to: 'player', systemIndex: rec.targetSystem, event: 'salvaged' });
      const identity = out?.identity || Identity.normalizeIdentity(h.identity);
      if (found.derelict) { book.derelicts = book.derelicts.filter((x) => x !== h); h.derelict.salvagedBy = 'player'; }
      rec.awaitingAdoption = true;
      rec.attachment = { day: Number(day), at: rec.targetSystem, salvagedFrom: found.owner };
      noteRecovery(rec, day, 'attached', `salvaged from ${found.owner ?? 'nobody'}; handed to the captain's books`);
      recoveryStats(book).salvaged++;
      effects.push(recoveryEffect(rec, 'hullSalvagedToPlayer', day, { identity, shipId: h.shipId, hull: hull0, maxHull: maxHull0, crew: hulkCrew(h, found.owner), systemIndex: rec.targetSystem, from: found.owner, origin: rec.target.origin }));
      return true;
    }
    if (found.derelict) { book.derelicts = book.derelicts.filter((x) => x !== h); delete h.derelict; h.fate = null; }
    else { const op = book.polities[found.owner]; op.hulls = op.hulls.filter((x) => x !== h); op.lostHulls = (op.lostHulls || 0) + 1; }
    polity(book, rec.sponsor).hulls.push(h);
    h.status = 'repairing'; h.opId = null; h.salvagedFrom = found.owner;
    // A new owner's write-off clock starts now, not the old owner's.
    if (h.stranded && h.stranded.crew !== 'aboard') h.stranded.crewEndDay = Number(day);
    h.identity ||= Identity.makeIdentity({ vid: h.id, shipId: h.shipId, seed: Identity.vesselHash(`${book.seed}:${h.id}`), builder: found.owner, via: 'legacy', systemIndex: h.systemIndex, legacy: true });
    Identity.recordProvenance(h.identity, { day, event: 'salvaged', from: found.owner, to: rec.sponsor, systemIndex: rec.targetSystem });
    h.stranded ||= { since: Number(day), systemIndex: rec.targetSystem, recovery: 'awaiting_recovery', recoverySince: null, recoveredBy: null, crew: 'lost', crewUntil: Number(day), crewEndDay: Number(day) };
    recoveryStats(book).salvaged++;
    effects.push(recoveryEffect(rec, 'hullSalvaged', day, { from: found.owner, origin: rec.target.origin }));
  } else if (found.derelict) {
    // Its own owner reclaiming a hulk it had written off: back on its books, the same vessel.
    book.derelicts = book.derelicts.filter((x) => x !== h); delete h.derelict; h.fate = null; h.status = 'repairing'; h.opId = null;
    if (h.stranded && h.stranded.crew !== 'aboard') h.stranded.crewEndDay = Number(day);
    polity(book, rec.sponsor).hulls.push(h);
  }
  attachHulk(book, world, rec, h, day, effects);
  return startTow(book, world, rec, day, effects);
}
function attachHulk(book, world, rec, h, day, effects) {
  rec.attachment ||= { day: Number(day), at: rec.targetSystem };
  if (rec.sponsor !== 'player' && h.stranded) {
    h.stranded.recovery = 'under_tow';
    // Her people (if any are aboard) are kept alive by the tug from here on.
    if (h.stranded.crew === 'aboard') { h.stranded.crewSupportedBy = rec.id; h.stranded.crewDaysLeft = Math.max(1, Number(h.stranded.crewUntil) - Number(day)); }
  }
  h.towedBy = rec.id;
  h.recoveryClaim = { id: rec.id, by: rec.sponsor, kind: rec.kind, since: rec.claim.since };
  rec.crew = hulkCrew(h, rec.sponsor);
  noteRecovery(rec, day, 'attached', `${rec.target.vid} made fast to ${rec.tug.vid}; crew ${rec.crew}`);
  effects.push(recoveryEffect(rec, 'hullTowAttached', day, { crew: rec.crew }));
}
// The towing group, with the hulk as a member, sets out for the yard at the tow speed — never through a
// fixed traversal. With no way through (or no yard), it holds where it is and tries again each day.
function startTow(book, world, rec, day, effects) {
  const target = hullOf(book, rec.sponsor, rec.target.hullId);
  if (!target || target.status === 'lost') return failRecovery(book, world, rec, day, effects, 'the hulk was lost', 'failed');
  const group = recoveryGroup(book, rec).filter((h) => h.id !== target.id && !h.transit && Number(h.systemIndex) === Number(target.systemIndex) && classifyDamage(h.hull, h.maxHull) === 'operational');
  if (!group.some((h) => h.id === rec.tug.hullId)) return dropTowedHulk(book, world, rec, target, Number(target.systemIndex), day, effects, 'the recovery vessel is not with the hulk');
  // Escorts that are not with the hulk are not part of the tow: free where they are.
  for (const x of rec.escorts) { const e = hullOf(book, rec.sponsor, x.hullId); if (e && e.opId === rec.id && !group.includes(e) && !e.transit) { e.opId = null; if (rec.sponsor !== 'player') e.status = releaseStatus(e); } }
  const from = Number(target.systemIndex);
  const speed = SPD.towSpeed(hullsSpeed(world, group), book.config.towPenalty);
  if (!towYardOk(book, world, rec.sponsor, rec.yard)) {
    const y = chooseTowYard(book, world, rec.sponsor, from, speed, rec.avoid.length ? new Set(rec.avoid) : null);
    if (!y) { rec.waitingSince ??= Number(day); rec.waitReason = 'no yard a tow can reach'; noteRecovery(rec, day, 'towing', 'holding: no yard a tow can reach'); return false; }
    rec.history.push({ day: Number(day), state: rec.state, note: `destination re-chosen: ${rec.yard} → ${y.yard}` });
    rec.yard = y.yard;
  }
  if (from === Number(rec.yard)) return deliverHulk(book, world, rec, target, from, day, effects);
  const plan = plotJourney(world, from, rec.yard, rec.sponsor, rec.avoid.length ? new Set(rec.avoid) : null, speed, { noFixed: true, cls: 'recovery' });
  if (!plan) { rec.waitingSince ??= Number(day); rec.waitReason = 'no route a tow can take'; noteRecovery(rec, day, 'towing', 'holding: no route a tow can take'); return false; }
  const r = startJourney(book, world, { kind: 'recovery', ref: rec.id, sponsor: rec.sponsor, hulls: [...group, target], destination: rec.yard, purpose: 'tow', plan,
    tow: { targets: [target.id], recoveryId: rec.id, need: rec.need }, authority: { kind: 'recovery', ref: rec.id }, meta: { recoveryId: rec.id, leg: 'inbound' } }, day, effects);
  if (!r.ok) { rec.waitingSince ??= Number(day); rec.waitReason = r.reason; noteRecovery(rec, day, 'towing', `holding: ${r.reason}`); return false; }
  rec.waitingSince = null; rec.waitReason = null;
  rec.journeyIds.push(r.journey.id);
  rec.inbound = { journeyId: r.journey.id, route: [from, ...r.journey.path], legDays: r.journey.legDays.slice(), towSpeed: r.journey.speed, departDay: Number(day), eta: r.journey.etaDay };
  const st = recoveryStats(book); st.towDays += r.journey.legDays.reduce((n, d) => n + d, 0); st.towN++;
  noteRecovery(rec, day, 'towing', `under tow at ${r.journey.speed}× → ${rec.yard}, arrives day ${r.journey.etaDay}`);
  if (rec.sponsor === 'player') effects.push({ type: 'strategicShipsAssigned', id: rec.id, sponsor: 'player', hulls: [target.id], role: 'towed', systemIndex: from, day });
  effects.push(recoveryEffect(rec, 'hullTowStarted', day, { towSpeed: r.journey.speed, eta: r.journey.etaDay, route: rec.inbound.route }));
  if (r.arrived) deliverHulk(book, world, rec, target, rec.yard, day, effects);
  return true;
}
// At the yard: the yard's ordinary recovery takes the hulk in (strandedRecoveryDays), then the ordinary
// repair; nothing is repaired here. Her crew stay whatever they were — aboard, rescued or lost.
function deliverHulk(book, world, rec, h, at, day, effects) {
  h.systemIndex = Number(at); delete h.transit; delete h.towedBy; delete h.recoveryClaim;
  if (rec.sponsor !== 'player' && h.stranded) {
    h.stranded.systemIndex = Number(at);
    h.stranded.recovery = 'recovering'; h.stranded.recoverySince = Number(day); h.stranded.recoveredBy = `tow:${rec.id}`;
    if (h.stranded.crewSupportedBy) h.stranded.crewSupportedBy = 'yard'; // her people are ashore at the yard now
  }
  rec.endedDay = Number(day); rec.reason = 'delivered';
  rec.after = { phase: 'in_yard', day: Number(day), startHull: Number(h.hull), history: [{ day: Number(day), phase: 'in_yard' }] };
  noteRecovery(rec, day, 'delivered_to_yard', `at ${at}`);
  const st = recoveryStats(book); st.delivered++; st.valueRecovered += rec.value || 0;
  releaseRecoveryGroup(book, world, rec, day, effects);
  effects.push(recoveryEffect(rec, 'hullRecoveryDelivered', day, { systemIndex: Number(at), crew: hulkCrew(h, rec.sponsor) }));
  addHistory(book, day, 'recovery', `${rec.target.vid} towed in to system ${at}.`, { systemIndex: Number(at) });
  return true;
}
// The tow lost its tug: the hulk is let go where the towing group last stood. Never dragged on, never sent
// home: it is stranded there again, and a new recovery can be sent for it.
function dropTowedHulk(book, world, rec, h, where, day, effects, why) {
  if (h) {
    h.systemIndex = Number(where); delete h.transit; delete h.towedBy; delete h.recoveryClaim;
    if (rec.sponsor !== 'player' && h.stranded) {
      h.stranded.systemIndex = Number(where); h.stranded.recovery = 'awaiting_recovery'; h.stranded.recoverySince = null; h.stranded.recoveredBy = null;
      if (h.stranded.crewSupportedBy) { h.stranded.crewUntil = Number(day) + (h.stranded.crewDaysLeft ?? 1); delete h.stranded.crewSupportedBy; delete h.stranded.crewDaysLeft; }
      // The owner's write-off clock for a crewless hulk restarts from the failed recovery, not from before it.
      if (h.stranded.crew !== 'aboard') h.stranded.crewEndDay = Math.max(Number(h.stranded.crewEndDay ?? day), Number(day));
    }
  }
  return failRecovery(book, world, rec, day, effects, why, 'failed', { droppedAt: Number(where) });
}
function failRecovery(book, world, rec, day, effects, reason, state = 'failed', extra = {}) {
  if (!REC.recoveryOpen(rec)) return false;
  rec.endedDay = Number(day); rec.reason = reason;
  noteRecovery(rec, day, state, reason);
  const st = recoveryStats(book); if (state === 'failed') st.failed++; else st.aborted++;
  const target = findHulk(book, rec.target.hullId)?.h;
  if (target && target.recoveryClaim?.id === rec.id) delete target.recoveryClaim;
  releaseRecoveryGroup(book, world, rec, day, effects);
  effects.push(recoveryEffect(rec, state === 'failed' ? 'hullRecoveryFailed' : 'hullRecoveryAborted', day, { reason, ...extra }));
  return false;
}
// The tug and escorts go free where they are (one still in warp is freed when its leg ends).
function releaseRecoveryGroup(book, world, rec, day, effects) {
  const ids = [rec.tug, ...rec.escorts].filter(Boolean).map((x) => x.hullId);
  for (const id of ids) {
    const h = hullOf(book, rec.sponsor, id);
    if (!h || h.status === 'lost' || h.opId !== rec.id) continue;
    if (h.transit) continue;
    h.opId = null;
    if (rec.sponsor !== 'player') h.status = releaseStatus(h);
  }
  if (rec.sponsor === 'player') effects.push({ type: 'strategicShipReleased', id: rec.id, sponsor: 'player', hullIds: [...ids, rec.target.hullId], day, recovery: true });
}
// Cancel before the hulk is made fast. A tug in warp finishes its leg (it cannot turn mid-leg) and is free
// where that leg ends; the hulk is left exactly where it is.
export function cancelHullRecovery(book, world, id, day, effects = [], reason = 'cancelled') {
  const rec = hullRecoveryById(book, id);
  if (!rec) return { ok: false, reason: 'no such recovery' };
  if (!REC.RECOVERY_CANCELLABLE.includes(rec.state)) return { ok: false, reason: rec.state === 'attached' || rec.state === 'towing' ? 'already in tow: it cannot be called off now' : `already ${rec.state}` };
  const tr = rec.outbound ? journeyById(book, rec.outbound.journeyId) : null;
  failRecovery(book, world, rec, day, effects, reason, 'aborted');
  if (tr && tr.status === 'underway' && Number(tr.legDepartDay) === Number(day)) { J.haltJourney(tr, tr.from, day, 'cancelled', 'Recovery cancelled.'); for (const h of journeyMemberHulls(book, tr)) delete h.transit; releaseRecoveryGroup(book, world, rec, day, effects); }
  return { ok: true, record: rec };
}
// The engine adopted a salvaged hull into the captain's books under `newHullId` (pf:…): the tow sets out.
export function adoptSalvagedHull(book, world, id, newHullId, day, effects = []) {
  const rec = hullRecoveryById(book, id);
  if (!rec || !rec.awaitingAdoption) return { ok: false, reason: 'nothing awaiting adoption' };
  rec.awaitingAdoption = false;
  rec.target.salvagedFromHullId = rec.target.hullId;
  rec.target.hullId = String(newHullId);
  rec.owner = 'player';
  return { ok: startTow(book, world, rec, day, effects), record: rec };
}
registerJourneyKind('recovery', {
  role(book, tr, h) { const rec = hullRecoveryById(book, tr.ref); return rec && rec.tug?.hullId === h.id ? 'tug' : 'escort'; },
  valid(book, world, tr, day, effects = []) {
    const rec = hullRecoveryById(book, tr.ref);
    if (!rec || !REC.recoveryOpen(rec)) return { ok: false, reason: 'recovery called off' };
    if (tr.meta?.leg === 'outbound') {
      const found = findHulk(book, rec.target.hullId);
      if (!found || Number(found.h.systemIndex) !== Number(rec.targetSystem)) { failRecovery(book, world, rec, day, effects, 'the hulk is gone from where it lay', 'aborted'); return { ok: false, reason: 'the hulk is gone' }; }
      return { ok: true };
    }
    if (tr.meta?.leg === 'inbound' && tr.purpose !== 'retreat' && !towYardOk(book, world, rec.sponsor, rec.yard)) {
      // The yard changed hands, or is blockaded: re-chosen here, at the boundary, from where the tow is.
      const y = chooseTowYard(book, world, rec.sponsor, tr.from, tr.speed, rec.avoid.length ? new Set(rec.avoid) : null);
      rec.history.push({ day: Number(day), state: rec.state, note: y ? `yard ${rec.yard} no longer usable; re-chosen ${y.yard} at ${tr.from}` : `yard ${rec.yard} no longer usable; none reachable from ${tr.from}` });
      recoveryStats(book).yardReevaluations = (recoveryStats(book).yardReevaluations || 0) + 1;
      if (!y) return { ok: false, reason: 'no usable yard', note: 'holding with the tow' };
      rec.yard = y.yard;
      if (Number(y.yard) === Number(tr.from)) return { ok: false, reason: 'yard is here', note: 'delivering here' };
      return { ok: false, reason: 'yard re-chosen', pending: { destination: y.yard, purpose: 'tow', plan: y.plan, meta: tr.meta } };
    }
    return { ok: true };
  },
  onArrive(book, world, tr, at, day, effects) {
    const rec = hullRecoveryById(book, tr.ref);
    if (!rec) return;
    if (!REC.recoveryOpen(rec)) { releaseRecoveryGroup(book, world, rec, day, effects); return; }
    if (tr.purpose === 'retreat') {
      // Turned back by a blockade: try again from here, around it.
      if (tr.retreatFrom != null && !rec.avoid.includes(Number(tr.retreatFrom))) rec.avoid.push(Number(tr.retreatFrom));
      if (tr.meta?.leg === 'inbound') startTow(book, world, rec, day, effects); else startOutbound(book, world, rec, day, effects);
      return;
    }
    if (tr.meta?.leg === 'outbound') { onRecoveryScene(book, world, rec, day, effects); return; }
    const h = hullOf(book, rec.sponsor, rec.target.hullId);
    if (h && h.status !== 'lost') deliverHulk(book, world, rec, h, at, day, effects);
    else failRecovery(book, world, rec, day, effects, 'the hulk was lost under tow', 'failed');
  },
  onHalt(book, world, tr, at, day, effects) {
    const rec = hullRecoveryById(book, tr.ref);
    if (!rec) return;
    if (!REC.recoveryOpen(rec)) { releaseRecoveryGroup(book, world, rec, day, effects); return; }
    if (!tr.members.length) {
      // Everyone gone: a lost tug en route, or a tow whose hulk was let go (onTowDropped closed it).
      if (tr.meta?.leg === 'outbound') failRecovery(book, world, rec, day, effects, `the recovery vessel was lost on the way (at ${at})`, 'failed');
      return;
    }
    if (tr.meta?.leg === 'inbound') {
      const h = hullOf(book, rec.sponsor, rec.target.hullId);
      if (towYardOk(book, world, rec.sponsor, at) && h) { deliverHulk(book, world, rec, h, at, day, effects); return; }
      // Holding with the tow where it is; tried again each day (advanceHullRecoveries).
      for (const m of journeyMemberHulls(book, tr)) delete m.transit;
      rec.waitingSince ??= Number(day); rec.waitReason = tr.endReason || 'halted';
      noteRecovery(rec, day, 'towing', `holding at ${at}: ${rec.waitReason}`);
      return;
    }
    failRecovery(book, world, rec, day, effects, `the outbound passage ended at ${at}: ${tr.endReason || 'halted'}`, 'aborted');
  },
  onDetach(book, world, tr, h, reason, at, day, effects = []) {
    const rec = hullRecoveryById(book, tr.ref);
    if (!rec || !h) return;
    rec.losses.push({ day: Number(day), hullId: h.id, vid: tr.vids?.[h.id] ?? h.id, reason, at: Number(at) });
    // Off the mission where it dropped out (the hulk itself is the mission's own business).
    if (String(h.id) !== String(rec.target.hullId) && h.status !== 'lost' && h.opId === rec.id) { h.opId = null; if (rec.sponsor !== 'player') h.status = releaseStatus(h); if (rec.sponsor === 'player') effects.push({ type: 'strategicShipReleased', id: rec.id, sponsor: 'player', hullIds: [h.id], day, recovery: true }); }
    if (rec.losses.length > 12) rec.losses = rec.losses.slice(-12);
    if (h.id === rec.tug?.hullId && ['destroyed', 'disabled', 'lost', 'surrendered'].includes(reason)) recoveryStats(book).tugLosses++;
    if (String(h.id) === String(rec.target.hullId) && ['destroyed', 'lost'].includes(reason)) { recoveryStats(book).hulksLostUnderTow++; failRecovery(book, world, rec, day, effects, 'the hulk was destroyed under tow', 'failed'); }
  },
  onTowDropped(book, world, tr, h, where, day, effects, at = where) {
    const rec = hullRecoveryById(book, tr.ref);
    if (!rec) return;
    // The towing group's journey ends here: any escorts left stand where they are and go free.
    if (tr.status === 'underway') {
      for (const m of journeyMemberHulls(book, tr)) { delete m.transit; m.systemIndex = Number(at); }
      J.haltJourney(tr, Number(at), day, 'tug lost', `The tow was let go at system ${where}.`);
      endJourneyEffect(book, tr, day, effects, { tugLost: true });
    }
    dropTowedHulk(book, world, rec, h, where, day, effects, `the tug was lost; the hulk was let go at system ${where}`);
  },
  // Turned back by a blockade after the mission closed (the hulk lost in that run): nobody goes back as a tow.
  onForcedBack(book, world, tr, at, prev, day, effects) {
    const rec = hullRecoveryById(book, tr.ref);
    if (rec && REC.recoveryOpen(rec)) return false;
    for (const m of journeyMemberHulls(book, tr)) { delete m.transit; m.systemIndex = Number(at); }
    if (rec) releaseRecoveryGroup(book, world, rec, day, effects);
    return true;
  },
});
// Daily: retries for missions holding with no way on, the captain's salvage adoption, derelicts breaking
// up, and the AI's bounded decision to send a tug.
export function advanceHullRecoveries(book, world, day, effects = []) {
  const c = book.config;
  const st = recoveryStats(book);
  for (const rec of openHullRecoveries(book)) {
    if (rec.awaitingAdoption) continue;
    // Awaiting a recovery vessel: nothing moves. Closed if the hulk is gone, repaired or no longer claimable.
    if (rec.awaitingAsset != null) {
      const found = findHulk(book, rec.target.hullId);
      const why = !found ? 'the hulk is gone' : hulkUnfit(book, found) === 'not disabled' ? 'the hulk was already recovered' : null;
      if (why) failRecovery(book, world, rec, day, effects, why, 'aborted');
      continue;
    }
    const live = rec.journeyIds.map((id) => journeyById(book, id)).find((tr) => tr && tr.status === 'underway');
    if (live) continue;
    // Its journey ended by a path that told nobody (a forced halt): the mission ends where things lie.
    if (rec.waitingSince == null) {
      if (rec.state === 'towing') { const h = hullOf(book, rec.sponsor, rec.target.hullId); dropTowedHulk(book, world, rec, h, h?.systemIndex ?? rec.targetSystem, day, effects, 'the tow was halted; the hulk was let go where it stood'); }
      else if (['assigned', 'en_route_to_hulk'].includes(rec.state)) failRecovery(book, world, rec, day, effects, 'the outbound passage was halted', 'aborted');
      continue;
    }
    if (Number(day) - rec.waitingSince > (c.recoveryWaitDays ?? 20)) {
      if (rec.state === 'towing') { const h = hullOf(book, rec.sponsor, rec.target.hullId); dropTowedHulk(book, world, rec, h, h?.systemIndex ?? rec.targetSystem, day, effects, `no way to a yard for ${c.recoveryWaitDays ?? 20} days; the hulk was let go where the tow held`); }
      else failRecovery(book, world, rec, day, effects, `no way to the hulk for ${c.recoveryWaitDays ?? 20} days`, 'aborted');
      continue;
    }
    if (rec.state === 'towing') startTow(book, world, rec, day, effects);
    else if (['assigned', 'en_route_to_hulk'].includes(rec.state)) startOutbound(book, world, rec, day, effects);
  }
  // After delivery the record follows the same hull through the yard: in yard → repairing → (awaiting crew) →
  // back in service, or lost. It never moves or repairs anything itself; it reads the hull.
  for (const rec of recoveryBook(book)) {
    if (rec.state !== 'delivered_to_yard' || !rec.after || REC.YARD_FINAL.includes(rec.after.phase)) continue;
    const h = hullOf(book, rec.sponsor, rec.target.hullId);
    const claim = h ? liveRecoveryClaim(book, h) : null;
    // In this yard's hands: the AI's yard intake has her; the captain's vessel still lies at the yard she was
    // delivered to.
    const inYard = rec.sponsor === 'player' ? Number(h?.systemIndex) === Number(rec.yard) && !h?.transit : ['recovering', 'in_yard'].includes(h?.stranded?.recovery);
    const phase = REC.yardPhase({ lost: !h, disabled: Boolean(h) && hullIsDisabled(h), awaitingCrew: Boolean(h?.recrew), inYard, otherClaim: Boolean(claim && claim.id !== rec.id), hull: h?.hull, startHull: rec.after.startHull });
    if (phase !== rec.after.phase) {
      // Repaired out of the disabled band within one yard day: the repair still happened, that day.
      if (rec.after.phase === 'in_yard' && ['recrew_if_required', 'complete'].includes(phase)) rec.after.history.push({ day: Number(day), phase: 'repairing' });
      rec.after.phase = phase; rec.after.day = Number(day);
      rec.after.history.push({ day: Number(day), phase });
      if (rec.after.history.length > 8) rec.after.history = rec.after.history.slice(-8);
      if (phase === 'complete') { rec.completedDay = Number(day); recoveryStats(book).returnedToService = (recoveryStats(book).returnedToService || 0) + 1; effects.push(recoveryEffect(rec, 'hullRecoveryComplete', day)); }
    }
  }
  // Derelicts break up after derelictLifeDays (or the oldest, beyond maxDerelicts): only then is the vessel's
  // identity retired. One somebody is towing or coming for is not broken up.
  const derelicts = book.derelicts || [];
  const claimed = (d) => liveRecoveryClaim(book, d);
  const over = Math.max(0, derelicts.length - (c.maxDerelicts ?? 60));
  const old = [...derelicts].sort((a, b) => a.derelict.since - b.derelict.since);
  const breakUp = new Set(old.slice(0, over).filter((d) => !claimed(d)));
  for (const d of derelicts) if (Number(day) >= Number(d.derelict?.until ?? Infinity) && !claimed(d)) breakUp.add(d);
  if (breakUp.size) {
    for (const d of breakUp) { d.derelict.goneDay = Number(day); d.hull = 0; if (d.identity) Identity.retireVessel(book, d.identity, { day, cause: 'broken up', holder: d.derelict.abandonedBy, systemIndex: d.systemIndex }); st.derelictsBrokenUp++; }
    book.derelicts = derelicts.filter((d) => !breakUp.has(d));
  }
  // Closed missions are history: the newest are kept for the record, the rest are let go (open ones never are).
  // A delivered record still following its hull through the yard is not history yet.
  const closed = recoveryBook(book).filter((r) => !REC.recoveryOpen(r) && !(r.state === 'delivered_to_yard' && r.after && !REC.YARD_FINAL.includes(r.after.phase)));
  if (closed.length > (c.recoveryHistoryKept ?? 60)) { const drop = new Set(closed.slice(0, closed.length - (c.recoveryHistoryKept ?? 60))); book.hullRecoveries = recoveryBook(book).filter((r) => !drop.has(r)); }
  if (c.aiRecovery !== false) planAiRecoveries(book, world, day, effects);
}
function skip(st, why) { st.skipped[why] = (st.skipped[why] || 0) + 1; }
// The AI's bounded recovery decision. Every few days, each power with a tug free may send it for its most
// worthwhile hulk: valuable enough, near enough, a safe way there and back, a yard to deliver to, and never
// its last ship at a world it holds. It never builds or conjures a tug; with none free, the hulk waits.
function planAiRecoveries(book, world, day, effects) {
  const c = book.config;
  const every = Math.max(1, c.aiRecoveryIntervalDays ?? 5);
  if (Number(day) % every !== 0) return;
  const st = recoveryStats(book);
  for (const [pid, p] of Object.entries(book.polities)) {
    if (pid === 'player' || p.active === false) continue;
    const open = openHullRecoveries(book).filter((r) => r.sponsor === pid).length;
    if (open >= (c.aiRecoveryMaxPerPolity ?? 2)) continue;
    // Its hulks, then (a higher bar) salvage: abandoned derelicts and crewless hulks of a power it is at war with.
    const own = (p.hulls || []).filter((h) => h.status !== 'lost' && hullIsDisabled(h) && h.stranded?.recovery === 'awaiting_recovery' && !h.opId && !h.transit && !hullInEncounter(h) && !liveRecoveryClaim(book, h));
    if (!own.length && !(book.derelicts || []).length) continue;
    const ready = (p.hulls || []).filter((h) => h.status === 'ready' && !h.opId && !h.transit && !hullInEncounter(h) && !hullUnavailable(h) && recoveryCapacityOf(world, h) > 0);
    if (!ready.length) { if (own.length) skip(st, 'no recovery-capable vessel free'); continue; }
    const held = new Set(controlled(world, pid).map((s) => Number(s.index)));
    const readyAt = {}; for (const h of p.hulls) if (h.status === 'ready' && !h.transit && !h.opId) readyAt[h.systemIndex] = (readyAt[h.systemIndex] || 0) + 1;
    const tugs = ready.filter((h) => !held.has(Number(h.systemIndex)) || (readyAt[h.systemIndex] || 0) > (c.recoveryGarrisonFloor ?? 1));
    if (!tugs.length) { if (own.length) skip(st, 'every capable vessel is a world\'s last garrison'); continue; }
    const salvage = (book.derelicts || []).filter((d) => !liveRecoveryClaim(book, d))
      .concat(Object.entries(book.polities).filter(([oid]) => oid !== pid && oid !== 'player').flatMap(([, op]) => op.hulls.filter((h) => h.status !== 'lost' && hullIsDisabled(h) && h.stranded && h.stranded.crew !== 'aboard' && !h.transit && !h.opId && !hullInEncounter(h) && !liveRecoveryClaim(book, h))));
    const candidates = [...own.map((h) => ({ h, kind: 'recovery', min: c.aiRecoveryMinValue ?? 60000 })), ...salvage.map((h) => ({ h, kind: 'salvage', min: c.aiSalvageMinValue ?? 90000 }))];
    let best = null;
    for (const cand of candidates) {
      const value = hulkValue(world, cand.h);
      if (value < cand.min) { if (cand.kind === 'recovery') skip(st, 'below value threshold'); continue; }
      if (cand.kind === 'salvage' && !recoveryClaim(book, world, pid, cand.h.id).ok) continue;
      const need = towRequirementOf(world, cand.h);
      const able = tugs.filter((t) => recoveryCapacityOf(world, t) >= need);
      if (!able.length) { if (cand.kind === 'recovery') skip(st, 'no vessel able to tow it'); continue; }
      // The nearest able tug by the days it would actually fly.
      const pick = able.map((t) => ({ t, days: plannedJourneyDays(world, t.systemIndex, cand.h.systemIndex, pid, hullSpeed(world, t)) })).filter((x) => x.days != null).sort((a, b) => a.days - b.days || String(a.t.id).localeCompare(String(b.t.id)))[0];
      if (!pick) { if (cand.kind === 'recovery') skip(st, 'no route'); continue; }
      const plan = planHullRecovery(book, world, { sponsor: pid, targetHullId: cand.h.id, tugHullId: pick.t.id }, day);
      if (!plan.ok) { if (cand.kind === 'recovery') skip(st, `unplannable: ${plan.reason}`); continue; }
      if (plan.etaDays > (c.aiRecoveryMaxDays ?? 70)) { if (cand.kind === 'recovery') skip(st, 'too far'); continue; }
      if (value / Math.max(1, plan.etaDays) < (c.aiRecoveryValuePerDay ?? 1500)) { if (cand.kind === 'recovery') skip(st, 'not worth the tug\'s time'); continue; }
      // Danger: a blockade on the way out or back, or the hulk lying in a system held by an enemy.
      const route = [...plan.outbound.systems, ...(plan.inbound.path || [])];
      const sysCtl = world.systems[Number(plan.at)]?.controller;
      if (route.some((i) => applicableBlockadesAt(book, world, i, pid).length) || (sysCtl && sysCtl !== pid && world.relation(relSide(world, pid), relSide(world, sysCtl)) === 'war')) { if (cand.kind === 'recovery') skip(st, 'too dangerous'); continue; }
      const score = (cand.kind === 'recovery' ? 1 : 0.6) * value / Math.max(1, plan.etaDays);
      if (!best || score > best.score) best = { score, cand, tug: pick.t };
    }
    if (best) requestHullRecovery(book, world, { sponsor: pid, targetHullId: best.cand.h.id, tugHullId: best.tug.id, requestedBy: 'ai' }, day, effects);
  }
}

// ---------- the evacuation convoy ----------
// The transports and escorts sail the evacuation's route as one convoy, a jump a day: load at the
// origin, run every applicable blockade they meet on the way out (the origin's on departure), deliver at
// the destination, run them again coming home. People are delivered when a convoy arrives; a convoy
// turned back delivers nobody that trip. Population and capacity stay abstract.
function convoyHulls(book, e) {
  return [...e.transports.map((t) => ({ t, role: 'transport' })), ...e.escorts.filter((t) => !t.joining).map((t) => ({ t, role: 'escort' }))]
    .map(({ t, role }) => ({ h: hullOf(book, e.sponsor, t.hullId), t, role })).filter((x) => x.h);
}
function convoyRunner(book, e) {
  return { key: `${e.id}:trip${e.convoy.trip}:${e.convoy.phase}:${e.convoy.pos}`, sponsor: e.sponsor, kind: 'evacuation',
    hulls: convoyHulls(book, e).map(({ h, t, role }) => ({ hullId: h.id, vid: t.vid || h.vid || null, shipId: h.shipId, hull: h.hull, maxHull: h.maxHull, crew: h.crew, role })) };
}
// Run every applicable blockade at a system. The first result that turns the convoy back ends the attempt.
function convoyCrossing(book, world, e, sysIndex, day, effects) {
  const results = [];
  for (const b of applicableBlockadesAt(book, world, sysIndex, e.sponsor)) {
    const r = resolveBlockadeRun(book, world, b, convoyRunner(book, e), day, effects, { meta: { evacuationId: e.id, trip: e.convoy.trip, phase: e.convoy.phase } });
    results.push(r);
    // What the run cost the convoy: a disabled transport or escort drops out where it happened; a
    // destroyed one is lost (with its vid) — the operation's capacity falls with either.
    for (const x of r.hulls) {
      if (x.condition === 'destroyed') {
        e.transports = e.transports.filter((t) => { if (t.hullId !== x.hullId) return true; e.lost.push({ hullId: t.hullId, vid: t.vid, day, role: 'transport', at: sysIndex }); effects.push({ type: 'evacuationLoss', id: e.id, sponsor: e.sponsor, origin: e.origin, at: sysIndex, hullId: t.hullId, vid: t.vid, by: b.power, day }); return false; });
        e.escorts = e.escorts.filter((t) => { if (t.hullId !== x.hullId) return true; e.lost.push({ hullId: t.hullId, vid: t.vid, day, role: 'escort', at: sysIndex }); return false; });
      } else if (x.condition === 'disabled') {
        for (const list of ['transports', 'escorts']) e[list] = e[list].filter((t) => {
          if (t.hullId !== x.hullId) return true;
          const h = hullOf(book, e.sponsor, t.hullId);
          if (h) { h.status = 'repairing'; h.opId = null; h.systemIndex = Number(sysIndex); }
          e.removed.push({ hullId: t.hullId, vid: t.vid, day, role: list === 'transports' ? 'transport' : 'escort', reason: 'disabled', at: sysIndex });
          effects.push({ type: 'strategicShipReleased', id: e.id, sponsor: e.sponsor, hullId: t.hullId, day, disabled: true, at: sysIndex });
          return false;
        });
      }
    }
    if (!r.continues) break;
  }
  return results;
}
// The convoy sails the evacuation's route as one shared journey each way (STRATEGIC-MOVEMENT-UNIFICATION):
// real legs of real length, every system on the way reached and run once, deliveries only on arrival at
// the destination. It loads at the origin and runs the origin's own blockade on departure; turned back
// on the way out it returns home without delivering; turned back on the way home it falls back a system,
// holds a day and tries again.
function evacuationPlan(world, e, fromSystem, toward) {
  const route = e.route.map(Number);
  const i = route.indexOf(Number(fromSystem));
  const speed = evacuationSpeed(world, e);
  if (i < 0) return plotJourney(world, fromSystem, toward === 'destination' ? e.destination : e.origin, e.sponsor, null, speed, { cls: 'civilian' });
  const systems = toward === 'destination' ? route.slice(i) : route.slice(0, i + 1).reverse();
  return { systems, path: systems.slice(1), legDays: routeLegDaysFor(world, systems, speed) };
}
// The convoy's speed: its slowest transport or escort still with it (an escort never makes the transports
// faster; one slow freighter sets the pace). Read from the classes on the record, so every planner of
// this evacuation — the refuge, the trip count, the cycle — reads the days its journeys fly.
export function evacuationSpeed(world, e) {
  const members = [...(e?.transports || []), ...(e?.escorts || []).filter((x) => !x.joining)];
  return SPD.groupSpeed(members.map((m) => SPD.classSpeed(world?.shipStats?.(m.shipId)))) ?? SPD.SPEED_DEFAULT;
}
export function evacuationRoundTripDays(world, e) {
  const days = routeLegDaysFor(world, e.route, evacuationSpeed(world, e)).reduce((n, d) => n + d, 0);
  return 2 * days;
}
function sailConvoy(book, world, e, fromSystem, toward, purpose, day, effects) {
  const cv = e.convoy;
  const hulls = convoyHulls(book, e).map(({ h }) => h).filter((h) => !h.transit && !hullIsDisabled(h) && Number(h.systemIndex) === Number(fromSystem));
  if (!hulls.length) return null;
  const plan = evacuationPlan(world, e, fromSystem, toward);
  if (!plan) return null;
  const r = startJourney(book, world, { kind: 'evacuation', ref: e.id, sponsor: e.sponsor, hulls, destination: toward === 'destination' ? e.destination : e.origin, purpose,
    authority: { kind: 'evacuation', ref: e.id }, meta: { phase: toward === 'destination' ? 'outbound' : 'inbound', trip: cv.trip }, plan }, day, effects);
  if (!r.ok) return null;
  cv.journeys = true; // this convoy flies shared journeys (a convoy saved before them does not have this)
  cv.journeyId = r.journey.id;
  cv.eta = r.journey.status === 'underway' ? r.journey.etaDay : day;
  return r;
}
function evacuationById(book, id) { return (book.evacuations || []).find((x) => x.id === id) || null; }
function deliverEvacuees(book, world, e, day, effects) {
  const c = book.config;
  const cv = e.convoy;
  const delivered = Math.min(cv.aboard, e.target - e.moved);
  const before = e.moved;
  e.moved = Math.min(e.target, e.moved + delivered);
  const trip = Math.max(1, evacuationRoundTripDays(world, e) + (c.evacLoadingDays ?? 1));
  e.lastThroughput = Math.round(delivered / trip); e.lastFactor = cv.planned > 0 ? Math.round(Math.min(1, cv.aboard / cv.planned) * 1000) / 1000 : 0;
  e.lastDelivery = { day, trip: cv.trip, delivered };
  cv.aboard = 0;
  if (before < e.target / 2 && e.moved >= e.target / 2) effects.push({ type: 'evacuationHalfway', id: e.id, sponsor: e.sponsor, origin: e.origin, destination: e.destination, day });
}
registerJourneyKind('evacuation', {
  runMeta(book, tr) { const e = evacuationById(book, tr.ref); return { evacuationId: tr.ref, trip: e?.convoy?.trip ?? null, phase: tr.meta?.phase ?? null }; },
  role(book, tr, h) {
    const e = evacuationById(book, tr.ref);
    return e?.transports.some((t) => t.hullId === h.id) ? 'transport' : 'escort';
  },
  valid(book, world, tr) {
    const e = evacuationById(book, tr.ref);
    return e && e.status === 'active' ? { ok: true } : { ok: false, reason: 'evacuation over', note: 'the evacuation has ended' };
  },
  onCross(book, world, tr, cross, effects) {
    const e = evacuationById(book, tr.ref);
    if (!e?.convoy) return;
    const cv = e.convoy;
    cv.pos = Math.max(0, e.route.map(Number).indexOf(Number(cross.at)));
    cv.at = Number(cross.at);
    cv.aboard = Math.min(cv.aboard, e.transports.reduce((n, t) => n + t.lift, 0));
    if (cross.runs.length) { cv.attempts.push({ trip: cv.trip, phase: tr.meta?.phase || null, at: cross.at, day: cross.day, outcomes: cross.runs.map((r) => r.outcome), journeyId: tr.id, leg: tr.legIndex }); cv.attempts = cv.attempts.slice(-20); }
  },
  onDetach(book, world, tr, h, reason, at, day, effects) {
    const e = evacuationById(book, tr.ref);
    if (!e) return releaseDetached(tr, h, reason);
    for (const list of ['transports', 'escorts']) e[list] = e[list].filter((t) => {
      if (t.hullId !== h.id) return true;
      const role = list === 'transports' ? 'transport' : 'escort';
      if (reason === 'destroyed' || reason === 'lost') {
        e.lost.push({ hullId: t.hullId, vid: t.vid, day, role, at });
        if (role === 'transport') effects.push({ type: 'evacuationLoss', id: e.id, sponsor: e.sponsor, origin: e.origin, at, hullId: t.hullId, vid: t.vid, by: null, day });
      } else {
        const hh = hullOf(book, e.sponsor, t.hullId);
        if (hh) { if (reason === 'disabled') hh.status = 'repairing'; else hh.status = releaseStatus(hh); hh.opId = null; }
        e.removed.push({ hullId: t.hullId, vid: t.vid, day, role, reason, at });
        effects.push({ type: 'strategicShipReleased', id: e.id, sponsor: e.sponsor, hullId: t.hullId, day, disabled: reason === 'disabled', at });
      }
      return false;
    });
  },
  onForcedBack(book, world, tr, at, prev, day, effects) {
    const e = evacuationById(book, tr.ref);
    if (!e?.convoy) return false;
    const cv = e.convoy;
    cv.turnedBack = (cv.turnedBack || 0) + 1;
    e.lastFactor = 0;
    if (tr.meta?.phase === 'outbound') {
      // Turned back on the way out: nobody is delivered; the convoy goes home with the people it carries.
      e.lastThroughput = 0;
      cv.aboard = 0;
      cv.phase = 'inbound';
      const r = sailConvoy(book, world, e, at, 'origin', 'return', day, effects);
      if (!r) { cv.phase = 'held'; cv.nextDay = day + 1; cv.journeyId = null; }
      else if (r.arrived) { cv.phase = 'loading'; cv.trip += 1; cv.nextDay = day + (book.config.evacLoadingDays ?? 1); cv.journeyId = null; }
      return true;
    }
    // Turned back on the way home: it falls back to the system it came from, holds a day, and tries again.
    const hulls = journeyMemberHulls(book, tr);
    const r = startJourney(book, world, { kind: 'evacuation', ref: e.id, sponsor: e.sponsor, hulls, destination: prev, purpose: 'retreat', authority: tr.authority,
      meta: { phase: 'inbound', trip: cv.trip, retreatOf: tr.id }, prior: tr, plan: { path: [prev], legDays: [legDaysBetween(world, at, prev)] } }, day, effects);
    if (r.ok && !r.arrived) { r.journey.retreatFrom = Number(at); cv.journeyId = r.journey.id; }
    else { cv.phase = 'held'; cv.nextDay = day + 1; cv.journeyId = null; }
    return true;
  },
  onArrive(book, world, tr, at, day, effects) {
    const e = evacuationById(book, tr.ref);
    if (!e?.convoy || e.status !== 'active') return;
    const c = book.config;
    const cv = e.convoy;
    cv.journeyId = null;
    cv.at = Number(at);
    if (tr.purpose === 'retreat') { cv.phase = 'held'; cv.nextDay = day + 1; return; }
    if (tr.meta?.phase === 'outbound' && Number(at) === Number(e.destination)) {
      // The refuge must still take them on the day they land (it may have changed hands while they flew).
      if (!friendlyTo(world, e.sponsor, world.systems[e.destination]?.controller)) return endEvacuation(book, world, e, day, e.moved > 0 ? 'partial' : 'failed', `${world.systems[e.destination]?.name} can no longer receive them`, effects);
      deliverEvacuees(book, world, e, day, effects);
      if (e.moved >= e.target) return endEvacuation(book, world, e, day, 'completed', null, effects);
      if (e.originLostDay != null) return endEvacuation(book, world, e, day, 'partial', `${e.originLostReason}; the last convoy landed its people`, effects);
      cv.phase = 'inbound';
      const r = sailConvoy(book, world, e, at, 'origin', 'return', day, effects);
      if (!r) { cv.phase = 'held'; cv.nextDay = day + 1; }
      return;
    }
    if (Number(at) === Number(e.origin)) { cv.pos = 0; cv.phase = 'loading'; cv.trip += 1; cv.nextDay = day + (c.evacLoadingDays ?? 1); return; }
    cv.phase = 'held'; cv.nextDay = day + 1;
  },
  // The evacuation is over: its ships stop where the leg in flight ended and are free there.
  onHalt(book, world, tr) { for (const h of journeyMemberHulls(book, tr)) if (!h.transit && (!h.opId || h.opId === tr.ref) && ['repairing', 'assigned'].includes(h.status)) { h.opId = null; h.status = releaseStatus(h); } },
});
function advanceEvacuationConvoy(book, world, e, day, effects) {
  const c = book.config;
  const cv = (e.convoy ||= { trip: 1, phase: 'loading', pos: 0, nextDay: e.startDay + (c.evacLoadingDays ?? 1), aboard: 0, attempts: [] });
  const lift = () => e.transports.reduce((n, t) => n + t.lift, 0);
  // Under way: the journey flies it (advanceJourneys ran earlier today), and its owner hooks move the
  // convoy on at each end. A convoy saved mid-route before shared journeys picks up from where it is.
  if (cv.journeyId) {
    const tr = journeyById(book, cv.journeyId);
    if (tr && tr.status === 'underway') return;
    cv.journeyId = null;
  }
  if (!cv.journeyId && !cv.journeys && ['outbound', 'inbound'].includes(cv.phase)) {
    // Picked up from where its ships actually are (an older save could leave its position counter a system
    // ahead of them after a turn-back), else from its recorded position.
    const standing = convoyHulls(book, e).map(({ h }) => h).filter((h) => !h.transit && !hullIsDisabled(h));
    const at = standing.length ? Number(standing[0].systemIndex) : Number(e.route[Math.max(0, Math.min(e.route.length - 1, cv.pos || 0))]);
    cv.journeys = true; // from here on it flies shared journeys
    cv.at = at;
    const r = sailConvoy(book, world, e, at, cv.phase === 'outbound' ? 'destination' : 'origin', cv.phase === 'outbound' ? 'evacuate' : 'return', day, effects);
    if (r?.arrived) (JOURNEY_KINDS.evacuation.onArrive)(book, world, r.journey, at, day, effects);
    if (r) return;
    // Cannot sail from there as it was going: it holds, and tries for home the next day.
    cv.phase = 'held'; cv.nextDay = day + 1; return;
  }
  if (day < cv.nextDay) return;
  const note = (at, results, extra = {}) => { cv.attempts.push({ trip: cv.trip, phase: cv.phase, at, day, outcomes: results.map((r) => r.outcome), ...extra }); cv.attempts = cv.attempts.slice(-20); };
  if (cv.phase === 'loading') {
    for (const t of e.escorts) if (t.joining) delete t.joining;
    // Departure: out through the origin's own blockade, if there is one.
    const results = convoyCrossing(book, world, e, e.route[0], day, effects);
    if (results.length) note(e.route[0], results);
    if (results.some((r) => !r.continues)) { cv.nextDay = day + (c.evacRetryDays ?? 3); cv.turnedBack = (cv.turnedBack || 0) + 1; e.lastFactor = 0; return; }
    cv.phase = 'outbound'; cv.pos = 0; cv.aboard = lift(); cv.planned = cv.aboard;
    const r = sailConvoy(book, world, e, e.origin, 'destination', 'evacuate', day, effects);
    if (!r) { cv.phase = 'loading'; cv.nextDay = day + 1; return; }
    if (r.arrived) (JOURNEY_KINDS.evacuation.onArrive)(book, world, r.journey, e.origin, day, effects);
    return;
  }
  if (cv.phase === 'held') {
    // Held short after being turned back on the way home: try again from where it is.
    const at = Number(cv.at ?? e.route[cv.pos || 0]);
    cv.phase = 'inbound';
    const r = sailConvoy(book, world, e, at, 'origin', 'return', day, effects);
    if (!r) { cv.phase = 'held'; cv.nextDay = day + 1; return; }
    if (r.arrived) (JOURNEY_KINDS.evacuation.onArrive)(book, world, r.journey, at, day, effects);
  }
}
function settleEvacuationDay(book, world, e, day, effects) {
  const c = book.config;
  const o = world.systems[e.origin], dst = world.systems[e.destination];
  if (o?.controller !== e.sponsor) {
    // The world is lost, but a convoy already under way with people aboard flies on and lands them: it is
    // over only when they are delivered (or lost). [TIME-SCALE]
    const cv = e.convoy, tr = cv?.journeyId ? journeyById(book, cv.journeyId) : null;
    if (cv && cv.phase === 'outbound' && cv.aboard > 0 && tr && tr.status === 'underway') { e.originLostDay ??= day; e.originLostReason ??= `${o?.name} was lost`; return advanceEvacuationConvoy(book, world, e, day, effects); }
    return endEvacuation(book, world, e, day, e.moved > 0 ? (e.moved >= e.target ? 'completed' : 'partial') : 'failed', e.originLostReason || `${o?.name} was lost`, effects);
  }
  if (e.originLostDay != null) { e.originLostDay = null; e.originLostReason = null; } // retaken before the convoy landed
  if (!friendlyTo(world, e.sponsor, dst?.controller)) return endEvacuation(book, world, e, day, e.moved > 0 ? 'partial' : 'failed', `${dst?.name} can no longer receive them`, effects);
  if (e.deadlineDay != null && day > e.deadlineDay) return endEvacuation(book, world, e, day, e.moved > 0 ? 'partial' : 'failed', 'the deadline passed', effects);
  // Transports and escorts that are gone, or that have been taken off the route, no longer serve.
  const onRoute = new Set(e.route.map(Number));
  const keep = (list, role) => list.filter((t) => {
    const h = book.polities[e.sponsor]?.hulls.find((x) => x.id === t.hullId);
    if (!h || h.status === 'lost') { e.lost.push({ hullId: t.hullId, vid: t.vid, day, role }); return false; }
    if (h.opId !== e.id || !onRoute.has(Number(h.systemIndex))) { e.removed.push({ hullId: t.hullId, vid: t.vid, day, role }); effects.push({ type: 'strategicShipReleased', id: e.id, sponsor: e.sponsor, hullId: t.hullId, day }); return false; }
    return true;
  });
  e.transports = keep(e.transports, 'transport'); e.escorts = keep(e.escorts, 'escort');
  const lift = e.transports.reduce((n, t) => n + t.lift, 0);
  if (lift <= 0) return endEvacuation(book, world, e, day, e.moved > 0 ? 'partial' : 'failed', 'no transport capacity is left', effects);
  if (e.sponsor !== 'player' && e.initialTransports > 0 && e.lost.filter((x) => x.role === 'transport').length / e.initialTransports >= c.evacAbandonLossShare)
    return endEvacuation(book, world, e, day, e.moved > 0 ? 'partial' : 'failed', 'losses became unacceptable', effects);
  advanceEvacuationConvoy(book, world, e, day, effects);
  if (e.status === 'active' && !e.transports.reduce((n, t) => n + t.lift, 0)) return endEvacuation(book, world, e, day, e.moved > 0 ? 'partial' : 'failed', 'no transport capacity is left', effects);
}
// AI: blockade a world it cannot assault; evacuate a world that is about to fall; escort an evacuation
// that is being interdicted. Each needs a reason and the force to do it.
function aiStrategicOps(book, world, day, effects) {
  const c = book.config;
  const taken = strategicAssignments(book);
  const free = (id, at = null) => (book.polities[id]?.hulls || []).filter((h) => h.status === 'ready' && !h.opId && !hullUnavailable(h) && !taken.has(h.id) && (at == null || Number(h.systemIndex) === Number(at)));
  // Evacuations.
  const activeAi = (book.evacuations || []).filter((e) => e.status === 'active' && e.sponsor !== 'player').length;
  if (activeAi < c.maxAiEvacuations) {
    for (const op of book.operations) {
      if (op.status === 'resolved' || !['assault', 'invasion'].includes(op.kind)) continue;
      const sys = world.systems[op.targetSystem];
      const sponsor = sys?.controller;
      if (!sponsor || sponsor === 'player' || sponsor === op.faction || !book.polities[sponsor]) continue;
      if ((sys.population || 0) < c.evacMinPopulation) continue;
      if ((book.evacuations || []).some((e) => e.status === 'active' && e.origin === sys.index)) continue;
      if ((book.evacuations || []).some((e) => e.status === 'active' && e.sponsor === sponsor)) continue;
      const attack = operationHulls(book, op).reduce((n, h) => n + hullStrength(book, world, h), 0);
      if (attack < localDefenseStrength(book, world, sys.index) * c.evacThreatRatio) continue;
      const carriers = free(sponsor, sys.index).filter((h) => evacuationLift(book, world, h) > 0)
        .sort((x, y) => hullStrength(book, world, x) - hullStrength(book, world, y) || String(x.id).localeCompare(String(y.id)));
      const garrison = c.homeGarrisonPerWorld || 0;
      const transports = carriers.slice(0, Math.max(0, Math.min(c.evacAiMaxTransports ?? 4, carriers.length - garrison)));
      if (!transports.length) continue;
      // The best refuge by real travel and safety (its own worlds or a friend's), never one under attack —
      // in the days these transports will actually take (their slowest; SHIP-DEPENDENT-STRATEGIC-SPEED).
      const convoySpeed = hullsSpeed(world, transports);
      const dests = evacuationDestinations(book, world, sponsor, sys.index, convoySpeed).filter((x) => !book.operations.some((o2) => o2.status !== 'resolved' && Number(o2.targetSystem) === x.index));
      if (!dests.length) continue;
      const dest = dests[0];
      // What can really be moved before the attack arrives (STRATEGIC-TIME-SCALE-CORRECTION): every
      // departure that can leave before the attackers' arrival day, a full lift each; at least one.
      const lift = transports.reduce((n, h) => n + evacuationLift(book, world, h), 0);
      const load = c.evacLoadingDays ?? 1, cycle = 2 * dest.days + load;
      const window = Math.max(0, Number(op.arriveDay ?? day) - day);
      const trips = Math.max(1, 1 + Math.floor(Math.max(0, window - load - 1) / Math.max(1, cycle)));
      const target = Math.min(evacuationTargetFor(book, world, sys.index), trips * lift);
      const r = startEvacuation(book, world, { sponsor, origin: sys.index, destination: dest.index, transports: transports.map((h) => h.id), target, reason: `${world.factionName(op.faction)} forces are bound for it` }, day, effects);
      if (r.ok) r.record.plan = { destinationDays: dest.days, score: dest.score, danger: dest.danger, alternatives: dests.slice(1, 4).map((x) => ({ index: x.index, days: x.days, score: x.score, danger: x.danger })), threatArrivesDay: op.arriveDay ?? null, tripsBeforeThreat: trips, liftPerTrip: lift, cycleDays: cycle, convoySpeed };
      break;
    }
  }
  // Escorts for interdicted AI evacuations.
  for (const e of book.evacuations || []) {
    if (e.status !== 'active' || e.sponsor === 'player' || e.escorts.length) continue;
    if (!e.route.some((i) => applicableBlockadesAt(book, world, i, e.sponsor).length)) continue;
    const spare = free(e.sponsor, e.origin).filter((h) => !e.transports.some((t) => t.hullId === h.id)).slice(0, 3);
    if (spare.length) assignEvacuationEscorts(book, world, e.id, spare.map((h) => h.id), day, effects);
  }
  // Blockades: instead of an assault it cannot make.
  for (const id of Object.keys(book.polities)) {
    if (id === 'player' || id === 'dominion' || isLockedParty(id)) continue;
    if ((book.blockades || []).filter((b) => b.power === id && ['forming', 'active'].includes(b.status)).length >= c.maxBlockadesPerPolity) continue;
    const p = book.polities[id];
    if (day - (p.lastBlockadeDay ?? -1e9) < (c.blockadeCooldownDays ?? 60)) continue;
    const targets = reachableEnemyTargets(book, world, id);
    if (!targets.length) continue;
    // A reason, not an opportunity: a power turns to blockade when its war has stalled (no assault for a
    // season), or to stop an enemy evacuation it can reach.
    const stalledSince = Math.max(p.lastAssaultDay ?? -1e9, p.blockadeStallFrom ?? (p.blockadeStallFrom = day));
    const stalled = day - stalledSince >= (c.blockadeStallDays ?? 45);
    const evacTargets = new Set((book.evacuations || []).filter((e) => e.status === 'active' && formallyAtWar(world, id, e.sponsor)).map((e) => e.origin));
    if (!stalled && !targets.some((t) => evacTargets.has(t.index))) continue;
    const held = new Set(controlled(world, id).map((s) => s.index));
    const perSystem = {};
    const ready = free(id);
    for (const h of ready) perSystem[h.systemIndex] = (perSystem[h.systemIndex] || 0) + 1;
    const spare = ready.filter((h) => { if (!held.has(h.systemIndex)) return true; if (perSystem[h.systemIndex] > c.homeGarrisonPerWorld) { perSystem[h.systemIndex]--; return true; } return false; });
    if (spare.length < (c.blockadeMinSpare ?? 5)) continue;
    const chosen = spare.slice(0, Math.min(spare.length, 6));
    const S = chosen.reduce((n, h) => n + hullStrength(book, world, h), 0) * bounded(p.supply, c.supplyFloor, 1);
    for (const t of targets.slice(0, 3)) {
      if (!stalled && !evacTargets.has(t.index)) continue;
      const D = localDefenseStrength(book, world, t.index);
      if (S >= D * c.minReadinessRatioToAttack) break; // an assault is possible: planning mounts that instead
      if (S < D * c.blockadeStartRatio || activeBlockadesAt(book, t.index).length) continue;
      if (day - (p.blockadeFailures?.[t.index] ?? -1e9) < (c.blockadeRetryDays ?? 180)) continue;
      if (book.treatyTerms?.length && treatyBlockadeBan(book, id, t.index, day)) continue; // a DMZ that binds it: never planned
      const evacuating = (book.evacuations || []).some((e) => e.status === 'active' && e.origin === t.index);
      const r = startBlockade(book, world, { power: id, target: t.index, hullIds: chosen.map((h) => h.id), purpose: evacuating ? 'stop_evacuation' : 'isolate_world' }, day, effects);
      if (r.ok) { p.lastBlockadeDay = day; break; }
    }
  }
}
function advanceStrategicOps(book, world, day, effects) {
  if (!book.evacuations && !book.blockades && book.config.strategicOps === false) return;
  strategicBook(book);
  for (const b of book.blockades) {
    if (b.status === 'forming' && Array.isArray(b.journeyIds)) {
      // Active once every ship sent has arrived or dropped out on the way; what holds it is what is there.
      if (b.journeyIds.some((id) => journeyById(book, id)?.status === 'underway')) continue;
      b.hulls = b.hulls.filter((t) => {
        const h = hullOf(book, b.power, t.hullId); const on = h && h.opId === b.id && Number(h.systemIndex) === b.target && !h.transit;
        if (on) delete t.joining;
        else { if (h && h.opId === b.id && !h.transit) { h.opId = null; h.status = releaseStatus(h); } effects.push({ type: 'strategicShipReleased', id: b.id, sponsor: b.power, hullId: t.hullId, day }); }
        return on;
      });
      if (!b.hulls.length) { endBlockade(book, world, b, day, 'withdrawn', 'its force never reached the station', effects); continue; }
      b.status = 'active'; b.activeDay = day; effects.push({ type: 'blockadeActive', id: b.id, power: b.power, target: b.target, day });
    } else if (b.status === 'forming' && day >= b.activeDay) { b.status = 'active'; effects.push({ type: 'blockadeActive', id: b.id, power: b.power, target: b.target, day }); }
    if (b.status === 'active') settleBlockadeDay(book, world, b, day, effects);
  }
  for (const e of book.evacuations) if (e.status === 'active') settleEvacuationDay(book, world, e, day, effects);
  if (book.config.aiStrategicOps !== false) aiStrategicOps(book, world, day, effects);
  // Bounded history: finished operations are kept for the record, the newest forty of each kind.
  const trim = (list) => { const live = list.filter((x) => ['active', 'forming'].includes(x.status)); const done = list.filter((x) => !['active', 'forming'].includes(x.status)); return live.concat(done.slice(-40)); };
  book.evacuations = trim(book.evacuations); book.blockades = trim(book.blockades);
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

// =====================================================================================================
// TREATY TERMS (TREATY-EXPANSION): DMZs, transit guarantees, basing rights, inspection regimes, tribute,
// reparations and blockade clauses. The record and its pure rules are treaty-terms.mjs; here they act
// through the systems that already exist — the shared journey (routing and crossings), the blockade engine,
// the yards, the economy — never as labels and never by a second movement or combat engine. A breach is an
// incident with a response state; nothing here declares, resumes or authorises a war.
// =====================================================================================================
const TREATY_STATS = Object.freeze({ termsAdded: 0, termsEnded: 0, termsRefused: 0, termsSuspended: 0, dmzCrossings: 0, dmzWarnings: 0, dmzRoutesRefused: 0, compliantWithdrawals: 0, withdrawalsOrdered: 0, strandedInDmz: 0,
  breaches: 0, incidentsResolved: 0, inspectionsRequested: 0, inspectionsCompleted: 0, inspectionsRefused: 0, inspectionsUnreceived: 0, inspectionsUnenforced: 0,
  tributePaid: 0, tributeMissed: 0, reparationsPaid: 0, reparationsMissed: 0, reparationsCompleted: 0, arrearsCleared: 0,
  blockadeClosures: 0, blockadesRefused: 0, obstructions: 0, basingRepairDays: 0, treatyReplots: 0, treatyHalts: 0, doctrineStoodDown: 0 });
export function treatyBook(book) {
  for (const k of ['treatyTerms', 'treatyIncidents', 'treatyLedger', 'treatyInspections']) if (!Array.isArray(book[k])) book[k] = [];
  book.stats ||= {};
  book.stats.treaty = { ...TREATY_STATS, ...(book.stats.treaty || {}) };
  return book;
}
function treatyStats(book) { return treatyBook(book).stats.treaty; }
export function treatyTermById(book, id) { return (book.treatyTerms || []).find((t) => t.id === id) || null; }
export function activeTreatyTerms(book, type = null, day = book?.day) {
  return (book?.treatyTerms || []).filter((t) => (!type || t.type === type) && TT.termActive(t, day));
}
// Which traffic class a journey is (TREATY-EXPANSION §2): recovery, civilian or military. An evacuation is
// civilian whatever escorts it; a doctrine job is civilian when its work is (deliveries, transport,
// construction, exploration, rescue, investigation); a formation is civilian only on a trade passage.
const TREATY_CIVIL_PURPOSES = Object.freeze(['delivery', 'transport', 'construction', 'exploration', 'rescue', 'investigation', 'trade']);
export function trafficClassOf(kind, purpose) {
  if (kind === 'recovery') return 'recovery';
  if (kind === 'evacuation') return 'civilian';
  if (TREATY_CIVIL_PURPOSES.includes(purpose) && (kind === 'doctrine' || kind === 'formation' || kind === 'trade')) return 'civilian';
  return 'military';
}
// A standing hull's class, read off the job it is on (a doctrine assignment's kind), else military.
function hullTrafficClass(book, h) {
  if (h?.opId) { const a = (book.doctrine?.assignments || []).find((x) => x.id === h.opId); if (a && TREATY_CIVIL_PURPOSES.includes(a.kind)) return 'civilian'; }
  return 'military';
}
// A transit guarantee by one of a DMZ's own parties lifts that DMZ's TRANSIT ban for its beneficiary at the
// systems it covers. It never lifts the stationing ban: "you may pass through", not "you may park there".
function guaranteeLifting(book, dmz, polity, systemIndex, cls, day) {
  return activeTreatyTerms(book, 'transit', day).find((g) => dmz.parties.includes(g.grantor) && TT.transitCovers(g, polity, systemIndex, cls)) || null;
}
function guaranteeLifts(book, dmz, polity, systemIndex, cls, day) { return Boolean(guaranteeLifting(book, dmz, polity, systemIndex, cls, day)); }
// A staging right (basing purpose `staging`) granted by one of a DMZ's own parties, holding the system, lifts that
// DMZ's stationing ban for its guest there: its warships may stay (ARCHITECTURE-CLEANUP §2). Nothing else.
function stagingLifting(book, world, dmz, polity, systemIndex, day) {
  const t = basingRightAt(book, world, polity, systemIndex, 'staging', day);
  return t && dmz.parties.includes(t.host) ? t : null;
}
// ---- access at a system, as separate permissions (ARCHITECTURE-CLEANUP §2–§5) ----
// What a polity may do at a system, each service on its own, with the exact term that grants or denies it. There
// is no single "access" answer: transit, stationing/staging, docking, repair, resupply, recovery and production are
// separate questions, and one never implies another.
//   transit     — may it enter/cross (a DMZ transit ban, lifted only by a transit guarantee);
//   staging     — may its warships stay (a DMZ stationing ban, lifted only by a staging right); `base` says whether
//                 the system is one it may use as a base (its own world, or a staging right);
//   docking, repair, resupply, recovery — its own world's facilities, or a host's under a basing right for exactly
//                 that service; never a power it is at war with;
//   production  — its own world and yard only. Basing never grants it.
// For the captain, the engine adds its own facility checks (a yard that exists, a vendor that serves him); this is
// the treaty and ownership half, shared by both.
export function accessAt(book, world, polity, systemIndex, cls = 'military', day = book?.day) {
  const i = Number(systemIndex);
  const sys = world.systems[i];
  const holder = sys?.controller ?? null;
  const own = holder === polity;
  const atWar = holder && !own && world.relation(relSide(world, polity), relSide(world, holder)) === 'war';
  const dmzs = (book?.treatyTerms?.length ? activeTreatyTerms(book, 'dmz', day) : []).filter((t) => t.systems.includes(i));
  const out = {};
  // transit
  const tBan = dmzs.find((t) => TT.dmzRestrictsTransit(t, polity, cls));
  const tLift = tBan ? guaranteeLifting(book, tBan, polity, i, cls, day) : null;
  out.transit = tBan && !tLift ? { ok: false, termId: tBan.id, reason: 'DMZ — transit prohibited' } : tLift ? { ok: true, basis: 'treaty', termId: tLift.id } : { ok: true, basis: 'open' };
  // staging / stationing
  const sBan = dmzs.find((t) => TT.dmzRestrictsStationing(t, polity, cls));
  const stagingTerm = book?.treatyTerms?.length ? basingRightAt(book, world, polity, i, 'staging', day) : null;
  const sLift = sBan && stagingTerm && sBan.parties.includes(stagingTerm.host) ? stagingTerm : null;
  out.staging = sBan && !sLift ? { ok: false, termId: sBan.id, reason: `DMZ — ${cls === 'military' ? 'military ' : ''}stationing prohibited`, base: false }
    : own ? { ok: true, basis: 'own', base: true } : stagingTerm ? { ok: true, basis: 'treaty', termId: stagingTerm.id, base: true } : { ok: true, basis: 'open', base: false };
  // facility services
  for (const svc of ['docking', 'repair', 'resupply', 'recovery']) {
    if (own) { out[svc] = { ok: true, basis: 'own' }; continue; }
    if (atWar) { out[svc] = { ok: false, reason: 'at war with the holder' }; continue; }
    const term = book?.treatyTerms?.length ? basingRightAt(book, world, polity, i, svc, day) : null;
    out[svc] = term ? { ok: true, basis: 'treaty', termId: term.id } : { ok: false, basis: 'none', reason: `${svc} not authorized` };
  }
  // production: own world and yard only — basing rights never grant it
  out.production = own ? { ok: true, basis: 'own' } : { ok: false, reason: 'not your world: basing rights never grant production' };
  out.holder = holder; out.atWar = Boolean(atWar);
  return out;
}
// The systems a polity's traffic of this class may not enter or cross (a DMZ that binds it, less what a
// guarantee opens). Read by every route the model plots (plotJourney) and every journey it starts.
export function treatyBarred(book, polity, cls = 'military', day = book?.day) {
  const out = new Set();
  if (!book?.treatyTerms?.length) return out;
  for (const t of activeTreatyTerms(book, 'dmz', day)) {
    if (!TT.dmzRestrictsTransit(t, polity, cls)) continue;
    for (const s of t.systems) if (!guaranteeLifts(book, t, polity, s, cls, day)) out.add(Number(s));
  }
  return out;
}
export function treatyBarredAt(book, polity, cls, systemIndex, day = book?.day) { return treatyBarred(book, polity, cls, day).has(Number(systemIndex)); }
function treatyBarredFor(world, polity, cls) {
  const book = world?.treatyBook;
  if (!book?.treatyTerms?.length) return null;
  const s = treatyBarred(book, polity, cls, book.day);
  return s.size ? s : null;
}
// The first system on a route (from → path) that a treaty bars, or null. Leaving: a mover that starts inside
// a restricted zone may cross the zone's systems on its way out (the departure prefix), never re-enter one,
// and never end inside one.
export function treatyRouteBlocked(book, from, path, polity, cls, day = book?.day) {
  const barred = treatyBarred(book, polity, cls, day);
  if (!barred.size || !path?.length) return null;
  let prefix = barred.has(Number(from));
  for (let i = 0; i < path.length; i++) {
    const s = Number(path[i]);
    if (!barred.has(s)) { prefix = false; continue; }
    if (!prefix || i === path.length - 1) return s;
  }
  return null;
}
// A treaty's evidence: an enforcer of the term who knows of it and can see the system — it holds the system or
// a neighbouring one (border sensors), or has an operational ship standing there.
function treatyObservers(book, world, t, breaching, at) {
  const near = [Number(at), ...((world.neighbours?.(Number(at)) || []).map(Number))];
  return (t.enforcers || []).filter((p) => p !== breaching && TT.termKnownTo(t, p) && (
    near.some((i) => world.systems[i]?.controller === p)
    || (book.polities[p]?.hulls || []).some((h) => h.status !== 'lost' && !h.transit && Number(h.systemIndex) === Number(at) && classifyDamage(h.hull, h.maxHull) === 'operational')));
}
function presentAt(book, world, polity, at) {
  return world.systems[Number(at)]?.controller === polity || (book.polities[polity]?.hulls || []).some((h) => h.status !== 'lost' && !h.transit && Number(h.systemIndex) === Number(at) && classifyDamage(h.hull, h.maxHull) === 'operational');
}
function recordTreatyIncident(book, world, spec, effects) {
  const x = TT.makeIncident(nextCampaignId(book, 'tincident'), spec);
  if (spec.key) x.key = spec.key;
  book.treatyIncidents.push(x);
  if (x.state === 'breach') markTreatyBreach(book, spec.term, x, effects);
  addHistory(book, x.day, 'treaty', `Treaty incident: ${TT.incidentLine(x, (p) => world.factionName?.(p) || p)}.`, { incidentId: x.id, secret: true, knownTo: x.knownTo.slice() });
  effects.push({ type: 'treatyIncident', id: x.id, termId: x.termId, kind: x.kind, breaching: x.breaching, state: x.state, systemIndex: x.systemIndex, knownTo: x.knownTo.slice(), day: x.day });
  return x;
}
function markTreatyBreach(book, t, x, effects) {
  if (!t.breaches.includes(x.id)) t.breaches.push(x.id);
  if (t.breaches.length > 40) t.breaches = t.breaches.slice(-40);
  treatyStats(book).breaches++;
  // A breach is a diplomatic matter: recorded, reported to those who know, escalated only through an explicit
  // authority. It never touches a war state.
  effects?.push({ type: 'treatyBreach', id: x.id, termId: t.id, termType: t.type, breaching: x.breaching, kind: x.kind, knownTo: x.knownTo.slice(), day: x.day });
}
function escalateIncident(book, x, day, state, detail, effects) {
  const was = x.state;
  TT.noteIncident(x, day, state, detail);
  const t = treatyTermById(book, x.termId);
  if (state === 'breach' && was !== 'breach' && t) markTreatyBreach(book, t, x, effects);
  if (state === 'resolved' && was !== 'resolved') treatyStats(book).incidentsResolved++;
}
// Add a term (settlement code, an authored story beat, the debug menu, fixtures). The only way terms come into
// being: no negotiation AI invents one.
export function addTreatyTerm(book, world, spec, day, effects = [], source = null) {
  treatyBook(book);
  if (spec?.error) { treatyStats(book).termsRefused++; return { ok: false, reason: spec.error }; }
  const r = TT.makeTerm({ ...spec, settlementSource: spec?.settlementSource ?? source }, nextCampaignId(book, 'term'), day);
  if (!r.ok) { treatyStats(book).termsRefused++; return r; }
  const t = r.term;
  for (const p of [...t.parties, ...(t.enforcers || [])]) if (!book.polities[p] && !world.isFaction?.(p) && p !== 'player') { treatyStats(book).termsRefused++; return { ok: false, reason: `unknown party ${p}` }; }
  book.treatyTerms.push(t);
  treatyStats(book).termsAdded++;
  world.treatyBook = book;
  addHistory(book, day, 'treaty', `Treaty term between ${t.parties.map((p) => world.factionName?.(p) || p).join(' and ')}: ${TT.termHeadline(t, (p) => world.factionName?.(p) || p)}.`, { termId: t.id, secretTerm: t.id });
  effects.push({ type: 'treatyTermAdded', id: t.id, termType: t.type, parties: t.parties.slice(), secret: t.secret, status: t.status, day });
  if (t.status === 'active') activateTreatyTerm(book, world, t, day, effects);
  return { ok: true, term: t };
}
// Bounded authoring from settlement clauses ("add DMZ systems A/B", "tribute 5000 every 30 days", …): `by` grants
// or pays, `to` benefits or receives. Systems by name or index.
export function treatyClauseSpecs(world, clauses, ctx) {
  const system = (name) => { const s = (world.systems || []).find((x) => String(x.name || '').toLowerCase() === String(name).toLowerCase()); return s ? s.index : null; };
  return (clauses || []).map((c) => (typeof c === 'string' ? TT.parseClause(c, { ...ctx, system }) : c));
}
export function endTreatyTerm(book, world, id, day, reason = 'ended by agreement', effects = []) {
  const t = treatyTermById(book, id);
  if (!t || t.status === 'ended') return { ok: false, reason: 'no such term in force' };
  t.status = 'ended'; t.endedDay = Number(day); t.endReason = reason;
  treatyStats(book).termsEnded++;
  addHistory(book, day, 'treaty', `Treaty term ${t.type.replace('_', ' ')} ended: ${reason}.`, { termId: t.id, secretTerm: t.id });
  effects.push({ type: 'treatyTermEnded', id: t.id, termType: t.type, parties: t.parties.slice(), reason, day });
  return { ok: true, term: t };
}
function activateTreatyTerm(book, world, t, day, effects) {
  t.status = 'active'; t.activatedDay = Number(day);
  if (t.type === 'dmz') { t.withdrawal = { dueDay: Number(day) + t.graceDays, hulls: {} }; dmzDay(book, world, t, day, effects); }
  if (t.type === 'blockade_lift') liftTreatyBlockades(book, world, t, day, effects);
}
// A blockade clause: the named blockades (or a party's blockades at the named systems) are closed under treaty
// authority, through the blockade's own end.
function liftTreatyBlockades(book, world, t, day, effects) {
  for (const b of book.blockades || []) {
    if (!['forming', 'active'].includes(b.status) || !t.parties.includes(b.power)) continue;
    if (!t.blockadeIds.includes(b.id) && !t.systems.includes(Number(b.target))) continue;
    endBlockade(book, world, b, day, 'closed', `lifted under treaty (${t.id})`, effects);
    t.lifted.push(b.id); treatyStats(book).blockadeClosures++;
  }
}
// May this power lay a blockade here? A DMZ that binds it forbids one.
export function treatyBlockadeBan(book, power, target, day = book?.day) {
  return activeTreatyTerms(book, 'dmz', day).find((t) => TT.dmzBansBlockade(t, power, target))
    || activeTreatyTerms(book, 'blockade_lift', day).find((t) => t.parties.includes(power) && t.systems.includes(Number(target))) || null;
}
// An explicit order to a blockade to stop a power its own side guaranteed transit (an authored story beat or the
// debug menu; no AI gives it). Its runs are then breaches of the guarantee, recorded as such.
export function orderBlockadeObstruction(book, id, on = true) {
  const b = (book.blockades || []).find((x) => x.id === id && ['forming', 'active'].includes(x.status));
  if (!b) return { ok: false, reason: 'No such blockade.' };
  if (on) b.treatyDefy = true; else delete b.treatyDefy;
  return { ok: true, record: b };
}
// Basing rights: the host's facility at this system, for this purpose, for this guest — while the host still holds it.
// A host at war with its guest grants it nothing, whatever terms are still on the books (ARCHITECTURE-CLEANUP §3).
export function basingRightAt(book, world, guest, systemIndex, purpose, day = book?.day) {
  return activeTreatyTerms(book, 'basing', day).find((t) => TT.basingAllows(t, guest, systemIndex, purpose) && world.systems[Number(systemIndex)]?.controller === t.host
    && !(world.relation && world.relation(relSide(world, guest), relSide(world, t.host)) === 'war')) || null;
}
// A transit guarantee the grantor owes this beneficiary at this system, if one is in force.
export function transitGuaranteeAt(book, grantor, beneficiary, systemIndex, day = book?.day, cls = 'military') {
  return activeTreatyTerms(book, 'transit', day).find((t) => TT.guaranteeBinds(t, grantor, beneficiary, systemIndex, cls)) || null;
}
// What a crossing meets under treaty: a DMZ warning (for a mover sent through in defiance) and inspection
// regimes. c: { sponsor, cls, at, day, key, vids, defy, response, inspectionResponse, cargo, hulls, categories,
// canReceive }. Returns { turnedBack, complied, incidents, inspections }. One engine for the model's journeys
// and the captain's formations.
export function treatyCrossing(book, world, c, effects = []) {
  const res = { turnedBack: false, complied: null, incidents: [], inspections: [] };
  if (!book?.treatyTerms?.length) return res;
  treatyBook(book);
  const st = treatyStats(book);
  const at = Number(c.at), day = Number(c.day);
  for (const t of activeTreatyTerms(book, 'dmz', day)) {
    if (!t.systems.includes(at) || !TT.dmzRestrictsTransit(t, c.sponsor, c.cls) || guaranteeLifts(book, t, c.sponsor, at, c.cls, day)) continue;
    st.dmzCrossings++;
    // A lawful mover is here only because the treaty changed while its leg was in flight: the boundary re-plot
    // takes it out; nothing is a breach.
    if (!c.defy) continue;
    const key = `${t.id}|${c.key}`;
    if (book.treatyIncidents.some((x) => x.key === key)) continue; // one incident per term per journey
    const observers = treatyObservers(book, world, t, c.sponsor, at);
    if (!observers.length) {
      // Nobody with evidence: the breach is real but only the mover knows of it.
      res.incidents.push(recordTreatyIncident(book, world, { key, term: t, kind: 'dmz_entry', breaching: c.sponsor, systemIndex: at, assets: c.vids, evidence: [], knownTo: [], severity: 'moderate', state: 'breach', day, detail: 'unobserved: no party with evidence' }, effects));
      continue;
    }
    st.dmzWarnings++;
    const x = recordTreatyIncident(book, world, { key, term: t, kind: 'dmz_entry', breaching: c.sponsor, systemIndex: at, assets: c.vids, evidence: observers.map((p) => ({ type: 'observed', by: p, day })), knownTo: observers, severity: 'moderate', state: 'warned', day, detail: `warned by ${observers.join(', ')}: military transit prohibited` }, effects);
    res.incidents.push(x);
    const resp = c.response || t.compliance?.[c.sponsor] || 'comply';
    if (resp === 'comply') { escalateIncident(book, x, day, 'complied', 'complied: turned back and escorted out of the zone', effects); st.compliantWithdrawals++; res.turnedBack = true; res.complied = x.id; return res; }
    escalateIncident(book, x, day, 'breach', 'refused the warning and continued', effects);
  }
  for (const t of activeTreatyTerms(book, 'inspection', day)) {
    if (!TT.inspectionApplies(t, c.sponsor, at, c.cls, c.categories || [])) continue;
    const key = `${t.id}|${c.key}|${at}`;
    if (book.treatyInspections.some((x) => x.key === key)) continue;
    // Only an inspector that knows the regime and is there asks.
    if (!TT.termKnownTo(t, t.inspector) || !presentAt(book, world, t.inspector, at)) { st.inspectionsUnenforced++; continue; }
    const rec = { id: nextCampaignId(book, 'inspection'), key, termId: t.id, inspector: t.inspector, inspected: c.sponsor, systemIndex: at, day, vids: (c.vids || []).slice(),
      state: 'requested', observed: null, knownTo: [t.inspector, c.sponsor], history: [{ day, state: 'requested', detail: 'heave to for inspection (the request reveals nothing)' }] };
    book.treatyInspections.push(rec); st.inspectionsRequested++;
    res.inspections.push(rec);
    // Not heard (nobody aboard can receive it): still only a request, never a refusal.
    if (c.canReceive === false) { rec.history.push({ day, state: 'requested', detail: 'not received' }); st.inspectionsUnreceived++; continue; }
    const resp = c.inspectionResponse || t.compliance?.[c.sponsor] || 'comply';
    if (resp === 'comply') {
      rec.state = 'completed'; rec.observed = TT.inspectionObservation(t, { manifest: c.cargo || [], hulls: c.hulls || [] });
      rec.history.push({ day, state: 'completed', detail: `inspected: ${(rec.observed.manifest || []).length} declared item(s) seen` });
      st.inspectionsCompleted++;
      effects.push({ type: 'treatyInspection', id: rec.id, termId: t.id, state: rec.state, inspector: t.inspector, inspected: c.sponsor, systemIndex: at, day });
      continue;
    }
    rec.state = 'refused'; rec.history.push({ day, state: 'refused', detail: t.onRefusal === 'deny_passage' ? 'refused: passage denied, turned back' : 'refused: recorded' });
    st.inspectionsRefused++;
    effects.push({ type: 'treatyInspection', id: rec.id, termId: t.id, state: rec.state, inspector: t.inspector, inspected: c.sponsor, systemIndex: at, day });
    const repeat = book.treatyIncidents.find((y) => y.termId === t.id && y.kind === 'inspection_refused' && y.systemIndex === at && day - y.day <= 30 && (c.vids || []).every((v) => y.assets.includes(v)));
    if (repeat) { TT.noteIncident(repeat, day, repeat.state, 'refused again'); if (t.onRefusal === 'deny_passage') { res.turnedBack = true; return res; } continue; }
    res.incidents.push(recordTreatyIncident(book, world, { key, term: t, kind: 'inspection_refused', breaching: c.sponsor, systemIndex: at, assets: c.vids, evidence: [{ type: 'refusal', by: t.inspector, day }], knownTo: [t.inspector], severity: 'minor', state: 'breach', day, detail: 'refused inspection' }, effects));
    if (t.onRefusal === 'deny_passage') { res.turnedBack = true; return res; }
  }
  return res;
}
// A journey's crossing under treaty (crossJourneyLeg calls it after the blockades there).
function runTreatyCrossing(book, world, tr, at, day, effects, out) {
  if (!book.treatyTerms?.length || !tr.members.length || tr.status !== 'underway') return;
  // Going back the way it came (turned back here or elsewhere) is not a new passage: nothing is asked of it.
  if (tr.purpose === 'retreat') return;
  const hooks = JOURNEY_KINDS[tr.kind] || {};
  const hulls = journeyMemberHulls(book, tr);
  const r = treatyCrossing(book, world, { sponsor: tr.sponsor, cls: tr.trafficClass || trafficClassOf(tr.kind, tr.purpose), at, day, key: tr.id, vids: tr.members.map((id) => tr.vids?.[id] ?? id), defy: Boolean(tr.treatyDefy),
    response: tr.meta?.treatyResponse, inspectionResponse: tr.meta?.inspectionResponse, cargo: hooks.cargo?.(book, tr) ?? tr.meta?.cargo ?? [],
    hulls: hulls.map((h) => ({ vid: vidOfHull(h), shipId: h.shipId })), categories: [...new Set(hulls.map((h) => world.shipStats?.(h.shipId)?.category).filter(Boolean))],
    canReceive: hulls.some((h) => classifyDamage(h.hull, h.maxHull) === 'operational') }, effects);
  out.treaty = r;
  if (r.turnedBack) {
    out.turnedBack = true;
    tr.treatyTurnBack = r.complied ? 'dmz' : 'inspection';
    // Complying: it goes back the way it came, as any turned-back group does, and no longer defies the zone.
    if (r.complied) { tr.treatyDefy = false; tr.meta = { ...(tr.meta || {}), treatyDefy: false, treatyComplied: r.complied }; }
  }
}
// Is the rest of this journey's route still lawful? Checked at every boundary: a treaty that started, ended or
// changed while a leg was in flight is met where the leg ends (no teleport; legs flown are never touched).
function treatyBoundaryCheck(book, world, tr) {
  if (!book.treatyTerms?.length || tr.treatyDefy || tr.purpose === 'retreat' || !J.hasMoreLegs(tr)) return null;
  return treatyRouteBlocked(book, tr.from, tr.path.slice(tr.legIndex + 1), tr.sponsor, tr.trafficClass || trafficClassOf(tr.kind, tr.purpose));
}
// The DMZ's day: no blockade inside it; restricted parties' warships out within the grace period (AI ones are
// sent out by an ordinary journey; the captain's are his to move); after it, a ship kept there is a breach. A
// disabled hulk is not a breach: it is listed as stranded until it is recovered (a tow is not an offensive fleet).
function dmzDay(book, world, t, day, effects) {
  const st = treatyStats(book);
  for (const b of book.blockades || []) {
    if (!['forming', 'active'].includes(b.status) || !TT.dmzBansBlockade(t, b.power, b.target)) continue;
    endBlockade(book, world, b, day, 'closed', `closed under treaty: no blockades in the DMZ (${t.id})`, effects);
    st.blockadeClosures++;
  }
  const w = t.withdrawal ||= { dueDay: Number(t.startDay) + t.graceDays, hulls: {} };
  for (const [id, rec] of Object.entries(w.hulls)) if (id !== 'captain' && !hullOf(book, rec.polity, id) && ['withdrawn', 'withdrawn_late', 'stranded', 'staged'].includes(rec.state)) delete w.hulls[id];
  // Every ship of a restricted party, and the captain himself (world.captain: his own vessel is not a model hull,
  // but he is held to the same term — ARCHITECTURE-CLEANUP §6).
  const movers = [];
  for (const p of t.restricted) for (const h of book.polities[p]?.hulls || []) if (h.status !== 'lost') movers.push({ p, h });
  const cap = world.captain;
  if (cap && t.restricted.includes('player')) movers.push({ p: 'player', h: null, cap });
  for (const { p, h, cap: c } of movers) {
    const id = c ? 'captain' : h.id;
    const vid = c ? c.vid : vidOfHull(h);
    // The captain's ships fly their own legs (a formation's); his mirror says only where the leg ends (legTo).
    const flying = c ? Boolean(c.moving) : Boolean(h.transit) || h.legTo != null;
    const where = c ? Number(c.systemIndex) : Number(h.transit ? h.transit.to : h.legTo ?? h.systemIndex);
    const at = c ? Number(c.systemIndex) : Number(h.systemIndex);
    const inZone = t.systems.includes(where);
    const rec = w.hulls[id];
    if (!inZone) {
      if (rec && ['pending', 'stranded'].includes(rec.state)) { rec.state = 'withdrawn'; rec.day = Number(day); rec.presence = null; st.compliantWithdrawals++; }
      else if (rec && rec.state === 'breach') { rec.state = 'withdrawn_late'; rec.day = Number(day); rec.presence = null; const x = book.treatyIncidents.find((y) => y.id === rec.incidentId); if (x && x.state === 'breach') escalateIncident(book, x, day, 'resolved', 'the ship has left the zone', effects); }
      else if (rec && rec.state === 'staged') delete w.hulls[id];
      continue;
    }
    const cls = c ? c.cls : hullTrafficClass(book, h);
    // Stationing is what this check is about; a zone that bans neither transit nor stationing for it has nothing to say.
    if (cls !== 'military' || !TT.dmzRestrictsStationing(t, p, 'military')) { if (rec?.state === 'staged') delete w.hulls[id]; continue; }
    // In a tow, it is a recovery, not a warship (TOWING-SALVAGE-RECOVERY §2).
    if (h?.transit && journeyById(book, h.transit.journeyId)?.kind === 'recovery') continue;
    // Moving through and never stopped: transit, not a presence (a crossing's DMZ rules are the crossing's).
    if (flying && !rec) continue;
    // A staging right in force for this ship here: it may stay. Its presence is recorded as staged, not loitering.
    const staging = flying ? null : stagingLifting(book, world, t, p, at, day);
    if (staging) {
      if (rec?.state === 'breach') { const x = book.treatyIncidents.find((y) => y.id === rec.incidentId); if (x && x.state === 'breach') escalateIncident(book, x, day, 'resolved', 'staging granted under treaty', effects); }
      w.hulls[id] = { polity: p, vid, systemIndex: at, since: rec?.since ?? Number(day), state: 'staged', presence: 'staged', termId: staging.id, ...(c ? { captain: true } : {}) };
      continue;
    }
    let r = w.hulls[id] ||= { polity: p, vid, systemIndex: at, since: Number(day), state: 'pending', ...(c ? { captain: true } : {}) };
    // Back in the zone after leaving it — or its staging right gone — a new presence, with its own grace.
    if (['withdrawn', 'withdrawn_late', 'staged'].includes(r.state)) r = w.hulls[id] = { polity: p, vid, systemIndex: at, since: Number(day), state: 'pending', returned: (r.state === 'staged' ? r.returned || 0 : (r.returned || 0) + 1), ...(c ? { captain: true } : {}) };
    r.systemIndex = at;
    r.presence = flying ? 'transit' : c?.docked ? 'docked' : 'loitering';
    if (h && (hullIsDisabled(h) || h.status === 'surrendered')) { if (r.state === 'pending') { r.state = 'stranded'; st.strandedInDmz++; } continue; }
    if (r.state === 'stranded') r.state = 'pending'; // repaired where it lay: it must now leave
    const due = Math.max(Number(w.dueDay), Number(r.since) + t.graceDays);
    r.dueDay = due;
    if (flying) continue; // on its way (a withdrawal under way, or a leg the boundary re-plot will meet)
    // An AI warship with no other order is sent out by an ordinary journey; one kept there by a valid order of its
    // own (an operation, a doctrine job) stays and, past the grace, is a breach — never teleported out. The
    // captain's ships and the captain himself are his to move.
    if (h && p !== 'player' && h.status === 'ready' && !h.opId && r.state === 'pending' && !(r.orderedDay != null && Number(day) - r.orderedDay < 3)) {
      const dest = treatyWithdrawalTarget(book, world, p, at, t.systems);
      // Tried at most every few days, whether or not a way out was found (no daily re-planning churn).
      r.orderedDay = Number(day);
      if (dest != null) {
        const ref = `treaty:${t.id}`;
        const j = startJourney(book, world, { kind: 'return', ref, sponsor: p, hulls: [h], destination: dest, purpose: 'withdraw', authority: { kind: 'treaty', ref: t.id }, meta: { home: dest, treatyWithdrawal: t.id } }, day, effects);
        // The order is the journey's reference, as for every other mover: a re-plot (a new journey id) still releases it.
        if (j.ok) { st.withdrawalsOrdered++; r.withdrawalOrdered = Number(day); if (!j.arrived) { h.status = 'assigned'; h.opId = ref; } }
      }
    }
    // One breach per presence: recorded once, the day after the grace ends, while it is still there.
    if (Number(day) > due && r.state === 'pending') {
      const observers = treatyObservers(book, world, t, p, at);
      const x = recordTreatyIncident(book, world, { key: `${t.id}|stationed|${id}|${r.since}`, term: t, kind: 'dmz_stationing', breaching: p, systemIndex: at, assets: [vid], evidence: observers.map((o) => ({ type: 'observed', by: o, day })), knownTo: observers, severity: 'moderate', state: 'breach', day, detail: `still in the zone after the withdrawal period (due day ${due})` }, effects);
      r.state = 'breach'; r.incidentId = x.id; r.breachDay = Number(day);
      st.stationingBreaches = (st.stationingBreaches || 0) + 1;
    }
  }
}
// Where a withdrawing warship goes: the nearest world its own side holds outside the restricted zone, by a
// lawful route; else the nearest system outside it.
// The zone itself is never the way out, even where a transit guarantee leaves it open to the ship's passage.
export function treatyWithdrawalTarget(book, world, polity, from, avoid = []) {
  const barred = treatyBarred(book, polity, 'military');
  const zone = new Set((avoid || []).map(Number));
  let best = null, bestDays = Infinity;
  const consider = (i) => { if (barred.has(Number(i)) || zone.has(Number(i))) return; const plan = plotJourney(world, from, i, polity); if (!plan) return; const d = plan.legDays.reduce((n, x) => n + x, 0); if (d < bestDays || (d === bestDays && i < best)) { best = Number(i); bestDays = d; } };
  for (const s of controlled(world, polity)) consider(s.index);
  if (best == null) for (const n of journeyNeighbours(world, from, polity)) consider(n);
  return best;
}
// A payment term's day (§6, §7): the existing treasuries move; a miss is arrears and a breach, never a war.
function paymentDay(book, world, t, day, effects) {
  const st = treatyStats(book);
  const payer = book.polities[t.payer], recipient = book.polities[t.recipient];
  if (!payer || !recipient) return;
  const r = TT.settlePaymentDay(t, payer.treasury, day);
  if (!r.due && !r.arrearsPaid) return;
  const moved = r.arrearsPaid + r.paid;
  if (moved > 0) {
    payer.treasury = (Number(payer.treasury) || 0) - moved;
    recipient.treasury = t.recipient === 'player' ? (Number(recipient.treasury) || 0) + moved : bounded((Number(recipient.treasury) || 0) + moved, -book.config.treasuryCap, book.config.treasuryCap);
    book.treatyLedger.push({ day: Number(day), termId: t.id, type: t.type, payer: t.payer, recipient: t.recipient, amount: moved, arrearsPaid: r.arrearsPaid, status: 'paid' });
    effects.push({ type: 'treatyPayment', termId: t.id, termType: t.type, payer: t.payer, recipient: t.recipient, amount: moved, day: Number(day) });
    if (t.type === 'tribute') st.tributePaid++; else st.reparationsPaid++;
  }
  if (r.arrearsPaid > 0) {
    st.arrearsCleared++;
    for (const x of book.treatyIncidents) if (x.termId === t.id && x.kind === 'payment_missed' && x.state === 'breach') escalateIncident(book, x, day, 'resolved', `arrears of ${r.arrearsPaid} L paid`, effects);
  }
  if (r.missed > 0) {
    book.treatyLedger.push({ day: Number(day), termId: t.id, type: t.type, payer: t.payer, recipient: t.recipient, amount: r.missed, status: 'missed' });
    if (t.type === 'tribute') st.tributeMissed++; else st.reparationsMissed++;
    // The recipient's own books show it unpaid: that is the evidence.
    recordTreatyIncident(book, world, { key: `${t.id}|missed|${day}`, term: t, kind: 'payment_missed', breaching: t.payer, systemIndex: null, assets: [], evidence: [{ type: 'ledger', by: t.recipient, day }], knownTo: [t.recipient], severity: 'minor', state: 'breach', day, detail: `${r.missed} L due on day ${day} not paid` }, effects);
  }
  const { completed } = TT.applyPaymentDay(t, r);
  if (completed) { if (t.type === 'reparations') st.reparationsCompleted++; endTreatyTerm(book, world, t.id, day, t.type === 'reparations' ? 'paid in full' : 'all installments paid', effects); }
  if (book.treatyLedger.length > 200) book.treatyLedger = book.treatyLedger.slice(-200);
}
// The daily pass (settleCampaignDay): terms start and expire on their days; a settlement's terms are suspended if
// its war resumes (the treaty never resumes it); DMZs, blockade clauses and payments act.
function advanceTreaties(book, world, day, effects) {
  if (!book.treatyTerms?.length) return;
  treatyBook(book);
  world.treatyBook = book;
  for (const t of book.treatyTerms) {
    if (t.status === 'pending' && Number(day) >= Number(t.startDay)) activateTreatyTerm(book, world, t, day, effects);
    if (t.status === 'active' && t.endDay != null && Number(day) > Number(t.endDay)) endTreatyTerm(book, world, t.id, day, 'expired', effects);
    if (t.status === 'active' && t.settlementSource?.warKey) {
      const ws = book.warStates?.[t.settlementSource.warKey];
      if (ws && ws.status === 'war' && ((ws.instance ?? null) !== (t.settlementSource.instance ?? null) || Number(ws.statusSince ?? 0) > Number(t.settlementSource.day))) {
        t.status = 'suspended'; t.suspendedDay = Number(day); t.endReason = 'the war it settled resumed';
        treatyStats(book).termsSuspended++;
        addHistory(book, day, 'treaty', `Treaty term ${t.type.replace('_', ' ')} suspended: the war it settled resumed.`, { termId: t.id, secretTerm: t.id });
        effects.push({ type: 'treatyTermEnded', id: t.id, termType: t.type, parties: t.parties.slice(), reason: t.endReason, suspended: true, day });
      }
    }
  }
  for (const t of activeTreatyTerms(book, null, day)) {
    if (t.type === 'dmz') dmzDay(book, world, t, day, effects);
    else if (t.type === 'blockade_lift') liftTreatyBlockades(book, world, t, day, effects);
    else if (t.type === 'tribute' || t.type === 'reparations') paymentDay(book, world, t, day, effects);
  }
  if (book.treatyIncidents.length > 120) {
    const open = book.treatyIncidents.filter((x) => x.state === 'breach' || x.state === 'warned');
    book.treatyIncidents = open.concat(book.treatyIncidents.filter((x) => !open.includes(x)).slice(-60)).slice(-120);
  }
  if (book.treatyInspections.length > 60) book.treatyInspections = book.treatyInspections.slice(-60);
}
// What a viewer may see of the treaty record (Wars & Treaties): terms it knows, incidents it has evidence of,
// inspections it took part in, payments it made or received. The book keeps everything.
export function treatyViewFor(book, viewer = 'player', day = book?.day) {
  const terms = (book.treatyTerms || []).filter((t) => TT.termVisibleTo(t, viewer));
  const incidents = (book.treatyIncidents || []).filter((x) => TT.incidentVisibleTo(x, viewer));
  return { terms, incidents, inspections: (book.treatyInspections || []).filter((x) => viewer === 'debug' || x.knownTo.includes(viewer)),
    ledger: (book.treatyLedger || []).filter((e) => viewer === 'debug' || [e.payer, e.recipient].includes(viewer) || terms.some((t) => t.id === e.termId)),
    status: (t) => TT.displayStatus(t, incidents), day };
}
