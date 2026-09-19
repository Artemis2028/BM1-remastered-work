// Explicit station roles and capabilities. Appearance (stationTypeId / model) and gameplay role are
// distinct: the type table gives every one of the 36 station types a documented job, per-instance
// exceptions override it for named installations, and runtime status (destroyed, under construction,
// abandoned, undiscovered, damaged) narrows what is actually available today.
//
// The same resolved capability object is used by the UI, the transaction code, the shared market,
// the strategic production model and the offscreen simulation, so a service the UI hides is also a
// service the engine refuses.
//
// All numeric effect values are first-pass tuning in named data (see STATION_EFFECT_UNITS).

export const STATION_ROLE_VERSION = 1;

// Units for the effect fields. Kept in one place so the campaign book and the UI agree.
export const STATION_EFFECT_UNITS = Object.freeze({
  berths: 'concurrent standard hull builds (mass <= 5)',
  heavyBerths: 'concurrent heavy hull builds (mass > 5)',
  repairCapacity: 'hull points repaired per campaign day across the owner pool',
  workforce: 'workforce units housed/employed; production needs 1 per active berth',
  housing: 'population capacity contributed to the world for integration and recovery',
  food: 'food units per day; a shortfall halves workforce growth',
  research: 'research points per day toward weapon/design work',
  morale: 'crew readiness points recovered per day at this world',
  relay: 'relay coverage: 1 = local, 2 = sector',
  defense: 'abstract defence strength used in offscreen resolution',
  mining: 'material units per day when the system has deposits',
  energy: 'energy units per day; heavy berths need 2 each',
  revenue: 'treasury income per day for the owner',
  customs: 'freight throughput bonus (%) for the system market',
});

const svc = (over = {}) => ({
  shipSales: 'none',      // 'general' | 'licensed' | 'small' | 'none'
  weaponSales: false,
  advancedWeapons: false, // guided/anti-emitter ordnance (military or science weapons service)
  refit: false,
  repair: 'none',         // 'full' | 'discount' | 'none'
  construction: 'none',   // 'heavy' | 'standard' | 'small' | 'none'
  plans: false,           // sells hull plans (licences)
  training: false,
  commodities: false,
  relay: false,
  recruit: false,
  rumors: false,
  passengers: false,
  ...over,
});
const fx = (over = {}) => ({
  berths: 0, heavyBerths: 0, repairCapacity: 0, workforce: 0, housing: 0, food: 0, research: 0, morale: 0,
  relay: 0, defense: 0, mining: 0, energy: 0, revenue: 0, customs: 0, ...over,
});

export const STATION_ROLES = Object.freeze({
  70: { name: 'Human Starbase', role: 'Fleet headquarters',
    summary: 'Full repairs, licensed reserve sales and fleet stores.',
    survival: 'Supports local readiness and defence; relief of a besieged base.',
    services: svc({ advancedWeapons: true, shipSales: 'general', weaponSales: true, refit: true, repair: 'full', plans: true, recruit: true }),
    effects: fx({ repairCapacity: 60, defense: 8, morale: 2, revenue: 120, workforce: 4 }),
    missions: ['relief', 'blockade', 'escort'] },
  71: { name: 'Human Research Lab', role: 'Weapons research',
    summary: 'Weapon development, analysis and prototype trials; no general hull sales.',
    survival: 'Rescue researchers and recover archives after attack.',
    services: svc({ advancedWeapons: true, weaponSales: true, refit: true, training: true }),
    effects: fx({ research: 6, workforce: 2 }),
    missions: ['archive', 'escort', 'recon'] },
  72: { name: 'Vulcan University', role: 'Education and mediation',
    summary: 'Officer and scientist education, training, analysis and mediation.',
    survival: 'Preserve skilled crews; evacuate students.',
    services: svc({ training: true, refit: true }),
    effects: fx({ research: 4, morale: 3, workforce: 3 }),
    missions: ['evacuation', 'archive'] },
  73: { name: 'Human Heavy Shipyard', role: 'Capital construction',
    summary: 'Capital construction, heavy overhaul and reserve commissions.',
    survival: 'Losing a berth reduces replacement capacity; escort reactor components.',
    services: svc({ advancedWeapons: true, shipSales: 'general', refit: true, repair: 'full', construction: 'heavy', plans: true, weaponSales: true }),
    effects: fx({ berths: 1, heavyBerths: 1, repairCapacity: 80, workforce: 6, energy: -2 }),
    missions: ['escort', 'repair', 'blockade'] },
  74: { name: 'Human Shipyard', role: 'Light construction',
    summary: 'Small and medium hull construction and refits.',
    survival: 'Replenishes patrols and escorts; provide hull plating.',
    services: svc({ advancedWeapons: true, shipSales: 'general', refit: true, repair: 'full', construction: 'standard', plans: true, weaponSales: true }),
    effects: fx({ berths: 2, repairCapacity: 40, workforce: 4, energy: -1 }),
    missions: ['escort', 'repair'] },
  75: { name: 'Trade Station', role: 'Freight brokerage',
    summary: 'Freight brokerage, commodities, warehousing and authorized civilian lots.',
    survival: 'Generates trade revenue and supplies; break a blockade.',
    services: svc({ shipSales: 'licensed', weaponSales: true, commodities: true, passengers: true }),
    effects: fx({ revenue: 90, customs: 10, workforce: 2 }),
    missions: ['relief', 'blockade'] },
  76: { name: 'Bar', role: 'Crew leave and contacts',
    summary: 'Crew leave, recruitment, paid rumors and underworld contacts; no normal hull shop.',
    survival: 'Recover morale or find a smuggling lead; rumors remain uncertain.',
    services: svc({ weaponSales: true, recruit: true, rumors: true }),
    effects: fx({ morale: 4, revenue: 20 }),
    missions: ['recon'] },
  77: { name: 'Delpin Waterpark', role: 'Tourism and respite',
    summary: 'Tourism, recreation, refugee respite and civilian passenger contracts.',
    survival: 'Supports revenue and morale; rescue stranded visitors.',
    services: svc({ passengers: true, commodities: true }),
    effects: fx({ morale: 3, revenue: 70, housing: 200 }),
    missions: ['evacuation', 'relief'] },
  78: { name: 'Ore Station', role: 'Mining and refining',
    summary: 'Extract and refine minerals where local deposits exist; sell feedstock.',
    survival: 'Supplies yards; repair drills or escort ore convoys.',
    services: svc({ commodities: true }),
    effects: fx({ mining: 8, workforce: 3, revenue: 30 }),
    missions: ['repair', 'escort'] },
  79: { name: 'Klingon Starbase', role: 'House fleet seat',
    summary: 'House fleet seat, warship support and licensed reserve sales.',
    survival: 'Maintains territorial defence; relieve a besieged House.',
    services: svc({ advancedWeapons: true, shipSales: 'general', weaponSales: true, refit: true, repair: 'full', plans: true, recruit: true }),
    effects: fx({ repairCapacity: 60, defense: 9, morale: 2, revenue: 100, workforce: 4 }),
    missions: ['relief', 'blockade', 'escort'] },
  80: { name: 'Klingon Shipyard', role: 'Raider construction',
    summary: 'Birds-of-Prey and other small and medium warship work.',
    survival: 'Replaces raiders; recover experienced engineers.',
    services: svc({ advancedWeapons: true, shipSales: 'general', refit: true, repair: 'full', construction: 'standard', plans: true, weaponSales: true }),
    effects: fx({ berths: 2, repairCapacity: 40, workforce: 4, energy: -1 }),
    missions: ['escort', 'repair'] },
  81: { name: 'Klingon Heavy Shipyard', role: 'Heavy warship construction',
    summary: 'Heavy warships, major repairs and House reserve commissions.',
    survival: 'Controls heavy replacement throughput; protect a keel under construction.',
    services: svc({ advancedWeapons: true, shipSales: 'general', refit: true, repair: 'full', construction: 'heavy', plans: true, weaponSales: true }),
    effects: fx({ berths: 1, heavyBerths: 1, repairCapacity: 80, workforce: 6, energy: -2 }),
    missions: ['escort', 'repair', 'blockade'] },
  82: { name: 'Dyson Sphere', role: 'Megaproject habitat',
    summary: 'Exceptional habitat, energy and industry; an authored megaproject.',
    survival: 'Large finite output with upkeep and staged repair; never unlimited strength.',
    services: svc({ commodities: true, repair: 'full', refit: true }),
    effects: fx({ housing: 5000, energy: 12, workforce: 20, revenue: 200, food: 6 }),
    missions: ['repair', 'relief'] },
  83: { name: 'Maintenance Station', role: 'Repairs and salvage',
    summary: 'Discount repairs, salvage refits, towing and explicitly licensed used small hulls.',
    survival: 'Gets damaged fleets back into service; recover a disabled ship.',
    services: svc({ shipSales: 'small', refit: true, repair: 'discount', weaponSales: true }),
    effects: fx({ repairCapacity: 50, workforce: 3 }),
    missions: ['repair', 'escort'] },
  84: { name: 'Habitat Station', role: 'Housing and workforce',
    summary: 'Housing, workforce, refugees and passenger logistics; no hull shop.',
    survival: 'Population capacity limits recovery; evacuation and relief missions.',
    services: svc({ passengers: true, recruit: true }),
    effects: fx({ housing: 800, workforce: 6, morale: 1 }),
    missions: ['evacuation', 'relief'] },
  85: { name: 'Wormhole Generator', role: 'Regulated transit',
    summary: 'Regulated transit, navigation research and gate maintenance.',
    survival: 'Strategic route with energy demand and disruption risk; stabilise the aperture.',
    services: svc({ refit: true }),
    effects: fx({ research: 2, energy: -4, workforce: 2 }),
    missions: ['repair', 'recon'] },
  86: { name: 'Defense Platform', role: 'Local defence',
    summary: 'Local beam defence and checkpoint fire support; no commerce.',
    survival: 'Protects approach routes; resupply and repair under pressure.',
    services: svc(),
    effects: fx({ defense: 5 }),
    missions: ['repair', 'blockade'] },
  87: { name: 'Advanced Defense Platform', role: 'Layered defence',
    summary: 'Heavy torpedoes and layered defence; no commerce.',
    survival: 'Defends key yards; intercept attackers before its magazines run low.',
    services: svc(),
    effects: fx({ defense: 9 }),
    missions: ['repair', 'blockade'] },
  88: { name: 'Cardassian Starbase', role: 'Sector administration',
    summary: 'Sector administration, defence and the established Galor/Keldon construction.',
    survival: 'Occupation and industry hub; sabotage or capture intact facilities.',
    services: svc({ advancedWeapons: true, shipSales: 'general', weaponSales: true, refit: true, repair: 'full', construction: 'heavy', plans: true, recruit: true }),
    effects: fx({ berths: 1, heavyBerths: 1, repairCapacity: 70, defense: 8, workforce: 6, revenue: 100, energy: -2 }),
    missions: ['relief', 'blockade', 'escort', 'repair'] },
  89: { name: 'Subspace Comm', role: 'Sector command relay',
    summary: 'Sector fleet command relay; orders, distress and intelligence subscriptions only.',
    survival: 'Cut or restore command links; no hulls, weapons or commodity shop.',
    services: svc({ relay: true }),
    effects: fx({ relay: 2, workforce: 1 }),
    missions: ['repair', 'recon', 'escort'] },
  90: { name: 'Romulan Starbase', role: 'Concealed fleet support',
    summary: 'Concealed fleet support, intelligence, repairs and authorised reserves.',
    survival: 'Local defence and covert logistics; intelligence recovery missions.',
    // The data has no separate Romulan yard type, so the starbase is the Romulan industrial site
    // (concealed construction). Without this Romulus could never replace a hull.
    services: svc({ advancedWeapons: true, shipSales: 'general', weaponSales: true, refit: true, repair: 'full', construction: 'heavy', plans: true, recruit: true }),
    effects: fx({ berths: 1, heavyBerths: 1, repairCapacity: 60, defense: 8, research: 2, revenue: 90, workforce: 5, energy: -2 }),
    missions: ['recon', 'archive', 'blockade', 'repair'] },
  106: { name: 'Tholian Starbase', role: 'Web-defence citadel',
    summary: 'Web-defence citadel and protected trade anchorage.',
    survival: 'Shields a route and yard network; rescue ships caught near a damaged lattice.',
    services: svc({ advancedWeapons: true, shipSales: 'general', weaponSales: true, refit: true, repair: 'full', plans: true, commodities: true }),
    effects: fx({ repairCapacity: 60, defense: 10, revenue: 90, workforce: 4 }),
    missions: ['relief', 'blockade', 'evacuation'] },
  107: { name: 'Tholian Light Shipyard', role: 'Light lattice construction',
    summary: 'Small lattice hulls and commercial transport construction.',
    survival: 'Sustains trade and light patrols; supply fabrication material.',
    services: svc({ advancedWeapons: true, shipSales: 'general', refit: true, repair: 'full', construction: 'standard', plans: true, weaponSales: true }),
    effects: fx({ berths: 2, repairCapacity: 40, workforce: 4, energy: -1 }),
    missions: ['escort', 'repair'] },
  108: { name: 'Tholian Heavy Shipyard', role: 'Heavy lattice construction',
    summary: 'Heavy cargo and combat lattice frames.',
    survival: 'Industrial backbone; defend a major construction berth.',
    services: svc({ advancedWeapons: true, shipSales: 'general', refit: true, repair: 'full', construction: 'heavy', plans: true, weaponSales: true }),
    effects: fx({ berths: 1, heavyBerths: 1, repairCapacity: 80, workforce: 6, energy: -2 }),
    missions: ['escort', 'repair', 'blockade'] },
  109: { name: 'Dominion Starbase', role: 'Military command',
    summary: 'Military command, supply distribution and occupation administration.',
    survival: 'Invasion coordination; destroying it disrupts an actual deployed force.',
    services: svc({ advancedWeapons: true, shipSales: 'general', weaponSales: true, refit: true, repair: 'full', plans: true, recruit: true }),
    effects: fx({ repairCapacity: 70, defense: 9, revenue: 80, workforce: 5 }),
    missions: ['blockade', 'recon', 'relief'] },
  110: { name: 'Dominion Shipyard', role: 'Jem\'Hadar assembly',
    summary: 'Jem\'Hadar and light hull assembly with crew and supply dependencies.',
    survival: 'Replacement rate depends on maintained logistics; intercept supplies.',
    services: svc({ advancedWeapons: true, shipSales: 'general', refit: true, repair: 'full', construction: 'standard', plans: true, weaponSales: true }),
    effects: fx({ berths: 2, repairCapacity: 40, workforce: 4, energy: -1 }),
    missions: ['escort', 'repair'] },
  111: { name: 'Dominion Heavy Shipyard', role: 'Capital warship construction',
    summary: 'Capital warship construction and heavy refit.',
    survival: 'Limits the scale of sustained intervention; sabotage a staging yard.',
    services: svc({ advancedWeapons: true, shipSales: 'general', refit: true, repair: 'full', construction: 'heavy', plans: true, weaponSales: true }),
    effects: fx({ berths: 1, heavyBerths: 1, repairCapacity: 80, workforce: 6, energy: -2 }),
    missions: ['escort', 'repair', 'blockade'] },
  112: { name: 'Breen Station', role: 'Cryogenic support and listening post',
    summary: 'Cryogenic support, listening post and electronic-warfare refit.',
    survival: 'Specialised crew and hull support; recover a captured signal package.',
    // Likewise the only Breen installation type: a small construction slip keeps the Breen able to build.
    services: svc({ advancedWeapons: true, shipSales: 'licensed', weaponSales: true, refit: true, repair: 'discount', construction: 'standard' }),
    effects: fx({ berths: 1, research: 3, repairCapacity: 30, relay: 1, workforce: 3, energy: -1 }),
    missions: ['recon', 'archive', 'repair'] },
  113: { name: 'Tholian Research Station', role: 'Web and shield research',
    summary: 'Web and shield research, analysis and specialist refits.',
    survival: 'Unlocks research through real work; escort an experimental module.',
    services: svc({ advancedWeapons: true, weaponSales: true, refit: true, training: true }),
    effects: fx({ research: 6, workforce: 2 }),
    missions: ['archive', 'escort'] },
  119: { name: 'Casino Station', role: 'Gambling and brokers',
    summary: 'Gambling, intelligence brokers, financing and passenger contracts.',
    survival: 'Revenue and influence; a named private lot may sell its existing authorised hulls.',
    services: svc({ shipSales: 'licensed', commodities: true, rumors: true, passengers: true }),
    effects: fx({ revenue: 140, morale: 2 }),
    missions: ['recon'] },
  200: { name: 'Command Outpost', role: 'Frontier command',
    summary: 'Frontier command, convoy routing and local fleet logistics.',
    survival: 'Maintains a small forward deployment; defend the courier route.',
    services: svc({ advancedWeapons: true, weaponSales: true, repair: 'discount', relay: true, recruit: true }),
    effects: fx({ relay: 1, defense: 4, repairCapacity: 25, workforce: 2 }),
    missions: ['escort', 'blockade', 'recon'] },
  201: { name: 'Communication Array', role: 'Regional relay',
    summary: 'Regional relay, navigation updates and contract messages.',
    survival: 'Overlaps relay coverage and improves report timeliness; no generic weapons shop.',
    services: svc({ relay: true }),
    effects: fx({ relay: 1, workforce: 1 }),
    missions: ['repair', 'recon'] },
  202: { name: 'Heavy Starbase', role: 'Sector fortress',
    summary: 'Sector fortress, capital repairs and fleet stores.',
    survival: 'Keeps a major front supplied; sustained siege and relief operations.',
    services: svc({ advancedWeapons: true, shipSales: 'general', weaponSales: true, refit: true, repair: 'full', plans: true, recruit: true }),
    effects: fx({ repairCapacity: 100, defense: 14, revenue: 120, workforce: 6, morale: 2 }),
    missions: ['relief', 'blockade', 'escort'] },
  203: { name: 'K Series Station', role: 'Modular frontier yard',
    summary: 'Modular frontier yard, patrol refit and small construction.',
    survival: 'Low-cost expansion support; deliver modules to commission a berth.',
    services: svc({ shipSales: 'small', refit: true, repair: 'discount', construction: 'small', weaponSales: true }),
    effects: fx({ berths: 1, repairCapacity: 30, workforce: 2 }),
    missions: ['relief', 'repair'] },
  204: { name: 'T19 Station', role: 'Cargo terminal',
    summary: 'Cargo terminal, transshipment, customs and convoy assembly.',
    survival: 'Trade and supply throughput; clear a backed-up convoy queue.',
    services: svc({ commodities: true, passengers: true }),
    effects: fx({ revenue: 80, customs: 25, workforce: 3 }),
    missions: ['relief', 'escort'] },
  205: { name: 'Biodome Station', role: 'Food and biology',
    summary: 'Food, agriculture, refugees and biological research.',
    survival: 'Food and workforce resilience; outbreak response and crop delivery.',
    services: svc({ commodities: true, passengers: true }),
    effects: fx({ food: 8, housing: 400, research: 2, workforce: 3 }),
    missions: ['relief', 'evacuation'] },
});

// Per-instance exceptions. `depot` keeps specific authored hull offers sellable at a station whose
// type role otherwise sells no hulls (a documented attached lot, never a generic market).
// `discovery` gates every service and offer behind an authored discovery flag on the campaign.
// `abandoned` keeps services offline until the site is restored and staffed.
export const STATION_EXCEPTIONS = Object.freeze({
  '69-200': { label: 'Personnel and clone logistics', services: { shipSales: 'none', commodities: false, passengers: true },
    depot: { name: 'Attached transport depot', hulls: [345] }, note: 'Cloning facility on a trade-station model; only its documented transport offer is sold.' },
  '30-106': { label: 'Detention and prisoner exchange', services: { recruit: false, passengers: false }, effects: { housing: 0, workforce: 0, morale: 0 },
    missions: ['extraction'], note: 'Habitat model, but no residential benefits.' },
  '11-58': { label: 'University housing', effects: { housing: 400, workforce: 3, research: 1 }, linkedTo: 'university',
    note: 'Training capacity depends on the university; bonuses do not duplicate.' },
  'egg-shipyard-vulcan-1': { label: 'Licensed surplus depot', services: { shipSales: 'licensed' }, note: 'Education-attached depot preserving its authored hull pool.' },
  'egg-shipyard-terran-1': { archive: true }, 'egg-shipyard-terran-2': { archive: true }, 'egg-shipyard-terran-3': { archive: true },
  'egg-shipyard-terran-4': { archive: true }, 'egg-shipyard-terran-5': { archive: true }, 'egg-shipyard-terran-6': { archive: true },
  'egg-shipyard-cardassian-1': { archive: true }, 'egg-shipyard-breen-1': { archive: true }, 'egg-shipyard-dominion-1': { archive: true },
  'egg-shipyard-klingon-1': { archive: true }, 'egg-shipyard-independent-1': { archive: true },
  'egg-shipyard-neutral-1': { archive: true, label: 'Independent salvage vault' }, 'egg-shipyard-neutral-2': { archive: true, label: 'Independent salvage vault' },
  '9-gorn-muster-dock': { discovery: 'gorn', label: 'Dormant Gorn installation' },
  'egg-shipyard-gorn-1': { discovery: 'gorn', label: 'Dormant Gorn installation', archive: true },
  'egg-shipyard-borg-1': { label: 'Derelict reclamation node', dormant: true, effects: { housing: 0, energy: 0, workforce: 0, revenue: 0, food: 0 },
    services: { commodities: false, repair: 'none', refit: false }, note: 'Salvage expedition until an authored activation; no Dyson habitat bonuses by model alone.' },
  'egg-shipyard-sona-1': { label: 'Private hangar', specialist: 'salvage' },
  'egg-shipyard-pirate-1': { label: 'Chop shop', specialist: 'salvage' },
  '99-hirogen-trophy-exchange': { label: 'Trophy exchange', specialist: 'hunting' },
  'egg-shipyard-hirogen-1': { label: 'Trophy dock', specialist: 'hunting' },
  '100-suliban-cell-dock': { label: 'Cell dock', specialist: 'covert' },
  'egg-shipyard-suliban-1': { label: 'Cabal slip', specialist: 'covert' },
  // Live hull offers preserved through a documented attached lot where no in-system licensed outlet
  // can legally carry them (see OFFER_MIGRATIONS for the ones that do relocate).
  '3-32': { depot: { name: 'Arboretum surplus lot', hulls: [343, 237] }, note: 'Habitat role; its two authored Vulcan hulls stay as an attached licensed lot because no Alpha Centauri outlet carries Vulcan designs.' },
  // Tholian research stations were the only purchasable outlets for their authored lattice hulls
  // (the in-system bastions and yards carry the same ids but lack an authored faction, so the trade
  // rule refuses them). The authored offers stay as attached lots; the research role itself sells nothing.
  '95-tholian-research': { depot: { name: 'Lattice research slip', hulls: [222, 223, 318, 232] } },
  '96-tholian-research': { depot: { name: 'Lattice research slip', hulls: [222, 318, 223] } },
  '99-tholian-research': { depot: { name: 'Lattice research slip', hulls: [223, 318, 222, 232] } },
  // Authored weapon offers at roles that sell no generic weapons stay as documented armory lots.
  '13-grand-nagus-casino': { weaponDepot: { name: 'House armory lot', weapons: [8] } },
  '88-lappa-casino-exchange': { weaponDepot: { name: 'House armory lot', weapons: [8] } },
  '89-hupyrian-casino-port': { weaponDepot: { name: 'House armory lot', weapons: [8] } },
  'import-204-13': { weaponDepot: { name: 'Customs armory lot', weapons: [15] } },
  '50-0': { weaponDepot: { name: 'Sphere security armory', weapons: [5] } },
  'import-205-62': { weaponDepot: { name: 'Biodome security armory', weapons: [24] } },
});

// Offer migrations required before closing general hull retail at bars/habitats/relays.
// Every source is a live vendor today; every destination is a real station in the same system whose
// role sells hulls or weapons. Shared per-system quantities are unchanged by a move: the ledger is
// keyed by system and hull, never by vendor.
export const OFFER_MIGRATIONS = Object.freeze([
  { kind: 'ship', from: '5-43', to: '5-42', hulls: [1], system: 5, reason: 'Kathy\'s Pub keeps its bar role; Swiss Miss is the authorised civilian lot.' },
  { kind: 'ship', from: '15-71', to: 'egg-shipyard-pirate-1', hulls: [11], system: 15, reason: 'Nausica Orbital keeps its bar role; the Nausican Chop Shop is the named specialist depot.' },
  { kind: 'ship', from: '54-180', to: '54-169', hulls: [33, 326, 327, 328, 64, 228], system: 54, reason: 'Nova Bar keeps its bar role; Nova Yard Beta is the licensed heavy yard.' },
  { kind: 'ship', from: '57-184', to: '57-185', hulls: [60, 48, 238], system: 57, reason: 'Brea Bar keeps its bar role; Brea Base is the authorised civilian lot.' },
  { kind: 'weapon', from: 'import-201-5', to: '5-45', weapons: [23, 24], system: 5, reason: 'Swiss Relay Array becomes relay-only; Free Swiss Exchange already sells weapons.' },
]);

// Already-inactive authored hull offers. Defence platforms have never sold ships; these stay in the
// audit as provenance and must not be activated by unioning raw data.
export const INACTIVE_AUTHORED_OFFERS = Object.freeze([
  { station: '8-47', hulls: [343] },
  { station: '54-171', hulls: [228, 227, 230, 232] },
]);

export function stationRole(typeId) {
  return STATION_ROLES[Number(typeId)] || null;
}
export function stationException(stationId) {
  return STATION_EXCEPTIONS[String(stationId)] || null;
}
export function isAbandonedName(name) {
  return /\(abandoned\)/i.test(String(name || ''));
}

// Effective authored offers for a station after migrations: {shipIds, weaponIds, provenance}.
// `definition` is the station definition (id, stockIds, weaponStockIds). Sources lose relocated ids;
// destinations gain them with provenance so the shared ledger records where an offer came from.
export function migratedOffers(definition) {
  const id = String(definition?.id || '');
  const shipIds = new Set((definition?.stockIds || []).map(Number));
  const weaponIds = new Set((definition?.weaponStockIds || []).map(Number));
  const provenance = {};
  for (const m of OFFER_MIGRATIONS) {
    if (m.from === id) {
      for (const h of m.hulls || []) shipIds.delete(Number(h));
      for (const w of m.weapons || []) weaponIds.delete(Number(w));
    }
    if (m.to === id) {
      for (const h of m.hulls || []) { shipIds.add(Number(h)); provenance[`ship:${h}`] = m.from; }
      for (const w of m.weapons || []) { weaponIds.add(Number(w)); provenance[`weapon:${w}`] = m.from; }
    }
  }
  return { shipIds: [...shipIds], weaponIds: [...weaponIds], provenance };
}

// Resolve the capability object every consumer uses.
// context: { discovered: {gorn: bool}, restored: {[stationId]: bool}, staffed: bool, conditionFraction }
export function resolveStationCapabilities(definition, stats = {}, context = {}) {
  const typeId = Number(definition?.stationTypeId ?? stats?.id);
  const base = stationRole(typeId);
  const exception = stationException(definition?.id);
  const cap = {
    stationId: definition?.id ?? null,
    typeId,
    typeName: base?.name || stats?.name || 'Station',
    role: exception?.label || base?.role || 'Installation',
    summary: exception?.note || base?.summary || '',
    survival: base?.survival || '',
    services: { ...svc(), ...(base?.services || {}), ...(exception?.services || {}) },
    effects: { ...fx(), ...(base?.effects || {}), ...(exception?.effects || {}) },
    missions: [...new Set([...(base?.missions || []), ...(exception?.missions || [])])],
    depot: exception?.depot ? { name: exception.depot.name, hulls: [...exception.depot.hulls] } : null,
    weaponDepot: exception?.weaponDepot ? { name: exception.weaponDepot.name, weapons: [...exception.weaponDepot.weapons] } : null,
    archive: Boolean(exception?.archive),
    specialist: exception?.specialist || null,
    status: 'operational',
    statusReason: null,
    known: true,
  };
  // Authored per-station/per-type service overrides (pre-existing mechanism) still win for the
  // boolean commerce flags they name.
  const authored = definition?.services || stats?.services;
  if (authored) {
    if (authored.shipSales !== undefined) cap.services.shipSales = authored.shipSales ? (authored.smallShipsOnly ? 'small' : 'general') : 'none';
    if (authored.refit !== undefined) cap.services.refit = Boolean(authored.refit);
    if (authored.shipConstruction !== undefined) cap.services.construction = authored.shipConstruction ? (cap.services.construction === 'none' ? 'standard' : cap.services.construction) : 'none';
    if (authored.training !== undefined) cap.services.training = Boolean(authored.training);
  }
  const offline = (status, reason) => {
    cap.status = status; cap.statusReason = reason;
    cap.services = svc();
    cap.effects = fx();
    cap.depot = null;
    cap.weaponDepot = null;
  };
  if (definition?.destroyed || context.destroyed) offline('destroyed', 'Installation destroyed.');
  else if (definition?.underConstruction) offline('construction', 'Under construction.');
  else if (exception?.discovery && !context.discovered?.[exception.discovery]) {
    offline('dormant', 'Dormant installation; no services until its discovery event.');
    cap.known = false;
  } else if (exception?.dormant && !context.activated?.[definition?.id]) offline('dormant', 'Derelict; salvage expedition until an authored activation.');
  else if ((isAbandonedName(definition?.name) || exception?.abandoned) && !context.restored?.[definition?.id]) offline('abandoned', 'Abandoned; services offline until restored and staffed.');
  else {
    const condition = Number.isFinite(context.conditionFraction) ? Math.max(0, Math.min(1, context.conditionFraction)) : 1;
    if (condition < 1) {
      for (const k of Object.keys(cap.effects)) if (cap.effects[k] > 0) cap.effects[k] = Math.round(cap.effects[k] * condition * 100) / 100;
      if (condition < 0.5) { cap.services.construction = 'none'; cap.status = 'damaged'; cap.statusReason = 'Heavily damaged; construction suspended.'; }
    }
    if (context.staffed === false) { cap.effects.berths = 0; cap.effects.heavyBerths = 0; cap.status = 'unstaffed'; cap.statusReason = 'No workforce available for the berths.'; }
  }
  return cap;
}

// Sale permission for a hull at this station under the resolved capabilities.
// authoredHere: whether the (migrated) authored offer list includes the hull.
export function stationSellsHull(cap, { hullId = null, mass = 1, authoredHere = false } = {}) {
  if (!cap || !['operational', 'damaged', 'unstaffed'].includes(cap.status)) return false;
  if (cap.depot && hullId != null && cap.depot.hulls.includes(Number(hullId))) return true;
  switch (cap.services.shipSales) {
    case 'general': return true;
    case 'licensed': return authoredHere;
    case 'small': return mass <= 4;
    default: return false;
  }
}

// Summaries for UI and reports.
export function describeServices(cap) {
  const s = cap.services, out = [];
  if (s.shipSales === 'general') out.push('ship sales');
  else if (s.shipSales === 'licensed') out.push('licensed hull sales');
  else if (s.shipSales === 'small') out.push('small hull sales');
  if (cap.depot) out.push(cap.depot.name.toLowerCase());
  if (s.weaponSales) out.push('weapons');
  else if (cap.weaponDepot) out.push(cap.weaponDepot.name.toLowerCase());
  if (s.repair === 'full') out.push('repairs'); else if (s.repair === 'discount') out.push('discount repairs');
  if (s.refit) out.push('refits');
  if (s.construction !== 'none') out.push(`${s.construction} construction`);
  if (s.plans) out.push('hull plans');
  if (s.training) out.push('training');
  if (s.commodities) out.push('commodities');
  if (s.relay) out.push('relay');
  if (s.recruit) out.push('recruitment');
  if (s.rumors) out.push('rumors');
  if (s.passengers) out.push('passengers');
  return out.length ? out.join(', ') : 'no commerce';
}

export function allStationTypeIds() {
  return Object.keys(STATION_ROLES).map(Number);
}
