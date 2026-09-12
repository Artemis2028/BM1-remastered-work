/** Engine-independent, side-effect-free content helpers. No global game state. */
export function createShipCatalog(manifest, sourceMap, sizeConfig) {
  const ships = manifest.ships;
  if (!Array.isArray(ships)) throw new TypeError('manifest.ships must be an array');
  const byId = new Map();
  for (const ship of ships) {
    if (!Number.isInteger(ship.id) || byId.has(ship.id)) throw new Error('Invalid or duplicate ship ID');
    byId.set(ship.id, ship);
  }
  const getShip = id => byId.get(Number(id)) || null;
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
    const explicit = ship.purchaseRequirements?.worldPrestige;
    const configured = context.tierThresholds?.[ship.purchaseTier];
    const requiredPrestige = explicit ?? configured;
    // Price and faction standing alone are not world prestige. The target must supply it.
    if (!Number.isFinite(requiredPrestige) || requiredPrestige < 0) return {allowed: false, reason: 'prestige-threshold-unconfigured'};
    if (!Number.isFinite(context.worldPrestige) || context.worldPrestige < requiredPrestige) return {allowed: false, reason: 'world-prestige', requiredPrestige};
    if (ship.rosterState !== 'active' || ship.balanceStatus === 'pending') return {allowed: false, reason: 'balance-pending', requiredPrestige};
    if (ship.shipyardEligible === false && (!ship.specialVendor || context.vendor !== ship.specialVendor)) return {allowed: false, reason: 'restricted-stock'};
    if (!regionAllows(ship, {...context, role: 'purchase'})) return {allowed: false, reason: 'region'};
    if (!Number.isFinite(ship.cost) || ship.cost <= 0) return {allowed: false, reason: 'price-unconfigured'};
    if (!Number.isFinite(context.credits) || context.credits < ship.cost) return {allowed: false, reason: 'funds'};
    return {allowed: true, reason: 'eligible', requiredPrestige, price: ship.cost};
  }
  return {ships, getShip, resolveNewShipId, fromBM2, eligibleForSpawn, spawnPool, getDrawSize, getPurchaseDecision};
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
