/** Engine-independent, side-effect-free content helpers. No global game state. */
export function createShipCatalog(manifest, sourceMap, sizeConfig) {
  const ships = manifest.ships;
  if (!Array.isArray(ships)) throw new TypeError('manifest.ships must be an array');
  const byId = new Map();
  for (const ship of ships) {
    if (!Number.isInteger(ship.id) || byId.has(ship.id)) throw new Error('Invalid or duplicate ship ID');
    byId.set(ship.id, ship);
  }
  // A merged ID is a reference to one canonical hull, never a second record.
  // Retirement (26/63) remains distinct from duplicate consolidation.
  const aliases = manifest.aliases || {};
  function resolveAlias(id) {
    let current = Number(id);
    const seen = new Set();
    while (Object.prototype.hasOwnProperty.call(aliases, current)) {
      if (seen.has(current)) throw new Error('Hull alias cycle');
      seen.add(current);
      current = aliases[current];
    }
    return current;
  }
  for (const [id, target] of Object.entries(aliases)) {
    if (!Number.isInteger(Number(id)) || !Number.isInteger(target) || byId.has(Number(id)) || !byId.has(resolveAlias(id))) {
      throw new Error(`Invalid hull alias: ${id}`);
    }
  }
  const getShip = id => byId.get(resolveAlias(id)) || null;
  function resolveNewShipId(id) {
    const seen = new Set();
    let ship = getShip(id);
    while (ship?.replacementId != null) {
      if (seen.has(ship.id)) throw new Error('Replacement cycle');
      seen.add(ship.id);
      ship = getShip(ship.replacementId);
    }
    return ship?.rosterState === 'active' ? ship.id : null;
  }
  function fromBM2(sourceId) {
    const id = sourceMap.sourceToRemaster?.[String(sourceId)];
    return id == null ? null : getShip(id);
  }
  function regionAllows(ship, context = {}) {
    const region = ship.availabilityRegion || 'general';
    const name = String(context.systemName || '').trim().toLowerCase();
    const deployment = context.authorizedDeployment === true;
    const mission = context.role === 'mission' && deployment;
    const invasion = context.role === 'fleetAttack' && deployment;
    if (region === 'general') return true;
    if (region === 'reserved-gorn' || region === 'unassigned') return false;
    if (region === 'mission-only') return mission;
    if (region === 'secret-paso') return context.role === 'purchase' && name === 'paso' && context.vendor === 'paso-project-x';
    if (region === 'secret-remus') return context.role === 'purchase' && name === 'remus' && context.vendor === 'remus-secret';
    if (region === 'independent-endgame') return context.role === 'purchase' && context.vendor === 'independent-endgame';
    if (region === 'dominion-all') return name === 'blender' || name === 'dominica' || context.region === 'dominion-core' || invasion || mission;
    if (region === 'dominion-core') return name === 'dominica' || context.region === 'dominion-core' || invasion || mission;
    if (region === 'borg-core') return context.controller === 'borg' || invasion || mission;
    return false; // Unknown region must not silently authorize a spawn or sale.
  }
  function eligibleForSpawn(id, context = {}) {
    const ship = getShip(id);
    if (!ship || ship.rosterState !== 'active') return false;
    const role = context.role || 'traffic';
    if (!['traffic', 'patrol', 'localTraffic', 'fleetAttack', 'mission'].includes(role)) return false;
    // A tractor or scanner does not turn a medical/utility ship into a combatant.
    // The host derives armedByDefault from its weapon definitions, not slot count.
    if (['patrol', 'fleetAttack'].includes(role) && (ship.armedByDefault === false
      || (Array.isArray(ship.defaultWeaponSlots) && !ship.defaultWeaponSlots.some(Boolean)))) return false;
    if (role === 'fleetAttack') {
      if (!context.authorizedDeployment || ship.fleetEligible === false) return false;
    } else if (role === 'mission') {
      if (!context.authorizedDeployment) return false;
    } else if (ship.trafficEligible === false) return false;
    return regionAllows(ship, {...context, role});
  }
  function spawnPool(context = {}, faction = null) {
    // An empty legal pool stays empty. Never fall back to forbidden regions/hulls.
    return ships.filter(ship => (faction == null || ship.faction === faction) && eligibleForSpawn(ship.id, context));
  }
  function getDrawSize(id, classScales = sizeConfig.classScales) {
    const ship = getShip(id);
    if (!ship?.render) return null; // New artwork has no agreed game dimensions yet.
    const baseline = sizeConfig.classScales[ship.shipClass];
    const requested = classScales[ship.shipClass] ?? baseline;
    if (!(baseline > 0) || !Number.isFinite(requested) || requested <= 0) throw new RangeError('Invalid class scale');
    return {width: ship.render.width * requested / baseline, height: ship.render.height * requested / baseline};
  }
  function getPurchaseDecision(id, context = {}) {
    const ship = getShip(id);
    if (!ship || ship.rosterState === 'retired') return {allowed: false, reason: 'unavailable'};
    const explicit = ship.purchaseRequirements?.factionStanding;
    const configured = context.tierThresholds?.[ship.purchaseTier];
    const requiredStanding = explicit ?? configured;
    const requiredFaction = ship.purchaseRequirements?.faction || ship.faction || 'neutral';
    const currentStanding = Number.isFinite(context.standings?.[requiredFaction]) ? context.standings[requiredFaction] : 0;
    if (!Number.isFinite(requiredStanding) || requiredStanding < 0) return {allowed: false, reason: 'standing-threshold-unconfigured'};
    if (currentStanding < requiredStanding) return {allowed: false, reason: 'faction-standing', requiredStanding, requiredFaction, currentStanding};
    if (ship.rosterState !== 'active' || ship.balanceStatus === 'pending') return {allowed: false, reason: 'balance-pending', requiredStanding};
    if (ship.shipyardEligible === false && (!ship.specialVendor || context.vendor !== ship.specialVendor)) return {allowed: false, reason: 'restricted-stock'};
    if (!regionAllows(ship, {...context, role: 'purchase'})) return {allowed: false, reason: 'region'};
    if (!Number.isFinite(ship.cost) || ship.cost <= 0) return {allowed: false, reason: 'price-unconfigured'};
    if (!Number.isFinite(context.credits) || context.credits < ship.cost) return {allowed: false, reason: 'funds'};
    return {allowed: true, reason: 'eligible', requiredStanding, requiredFaction, currentStanding, price: ship.cost};
  }
  // Stock eligibility is independent of the captain's money and standing. Locked hulls
  // remain visible at their proper yard; restricted hulls do not appear at other ports.
  function eligibleForStock(id, context = {}) {
    const ship = getShip(id);
    return Boolean(ship && ship.rosterState === 'active' && ship.balanceStatus !== 'pending'
      && Number.isFinite(ship.cost) && ship.cost > 0
      && (ship.shipyardEligible !== false || (ship.specialVendor && ship.specialVendor === context.vendor))
      && regionAllows(ship, {...context, role: 'purchase'}));
  }
  return {ships, aliases, getShip, resolveNewShipId, fromBM2, eligibleForSpawn, spawnPool, getDrawSize, getPurchaseDecision, eligibleForStock};
}

export async function loadShipCatalog(baseUrl = new URL('.', import.meta.url), fetcher = globalThis.fetch) {
  const base = new URL(baseUrl);
  const load = async name => {
    const response = await fetcher(new URL(name, base));
    if (!response.ok) throw new Error(`Could not load ${name}: ${response.status}`);
    return response.json();
  };
  const [manifest, sourceMap, sizes] = await Promise.all(['ships.json', 'bm2-id-map.json', 'size-config.json'].map(load));
  const catalog = createShipCatalog(manifest, sourceMap, sizes);
  return {...catalog, imageUrl: id => {
    const ship = catalog.getShip(id);
    return ship ? new URL(ship.image, base).href : null;
  }};
}
