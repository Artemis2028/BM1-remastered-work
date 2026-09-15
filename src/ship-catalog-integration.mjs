/**
 * First browser-game wiring for the standalone `bm-ships/` content pack.
 *
 * Adapts the reviewed pack to engine call sites. Balance is in the pack;
 * faction standing tuning is in ship-economy.mjs.
 */
import { loadShipCatalog } from '../bm-ships/catalog.mjs';

export const SHIP_CATALOG_MODULE_URL = new URL('../bm-ships/catalog.mjs', import.meta.url);
export const SHIP_CATALOG_BASE_URL = new URL('../bm-ships/', import.meta.url);

export const RETIRED_VULCAN_EXPLORER_ID = 26;
export const REPLACEMENT_VULCAN_EXPLORER_ID = 211;
export const RETIRED_VULCAN_LIFEFORM_ID = 63;
export const INDEPENDENT_CAPITAL_ID = 60;
export const EXCALIBUR_ID = 347;

/** Gamma / Dominica network the remaster already treats as wormhole-isolated. */
export const DOMINION_CORE_SYSTEM_NAMES = Object.freeze([
  'dominica',
  'vortara',
  'new bajor',
  'jemhadar relay',
  'karemma exchange',
  'founders watch',
  'dosi gate',
  't-rogoran annex',
]);

const SPAWN_ROLES = new Set(['traffic', 'patrol', 'localTraffic', 'fleetAttack', 'mission']);

export async function loadGameShipCatalog(baseUrl = SHIP_CATALOG_BASE_URL, fetcher = globalThis.fetch) {
  if (typeof fetcher !== 'function') {
    throw new Error('Ship catalog requires fetch(); serve the game over HTTP, not file://');
  }
  return loadShipCatalog(baseUrl, fetcher);
}

export function isDominionCoreSystem(systemName = '') {
  return DOMINION_CORE_SYSTEM_NAMES.includes(String(systemName || '').trim().toLowerCase());
}

export function detectPurchaseVendor({ systemName = '', stationName = '', vendor = null } = {}) {
  if (typeof vendor === 'string' && vendor.trim()) return vendor.trim();
  const system = String(systemName || '').trim().toLowerCase();
  const station = String(stationName || '').trim().toLowerCase();
  if (system === 'paso' && (station.includes('x-base') || station.includes('project x'))) {
    return 'paso-project-x';
  }
  if (system === 'remus' && (station.includes('secret') || station.includes('reman starbase'))) {
    return 'remus-secret';
  }
  if (system === 'new switzerland' && station === 'free swiss reserve exchange') return 'independent-endgame';
  return null;
}

export function buildSpawnContext({
  systemName = '',
  role = 'traffic',
  authorizedDeployment = false,
  controller = null,
  region = null,
} = {}) {
  const normalizedRole = SPAWN_ROLES.has(role) ? role : 'traffic';
  const context = {
    systemName: String(systemName || '').trim(),
    role: normalizedRole,
  };
  if (region) context.region = region;
  else if (isDominionCoreSystem(context.systemName)) context.region = 'dominion-core';
  // Only a real invasion or authored mission may set this. Ambient traffic never does.
  if (authorizedDeployment === true && (normalizedRole === 'fleetAttack' || normalizedRole === 'mission')) {
    context.authorizedDeployment = true;
  }
  if (controller) context.controller = controller;
  return context;
}

export function buildPurchaseContext({
  systemName = '',
  stationName = '',
  vendor = null,
  credits,
  standings,
  tierThresholds,
  standingFaction,
} = {}) {
  const context = {
    systemName: String(systemName || '').trim(),
    role: 'purchase',
    credits,
    standings,
  };
  if (standingFaction) context.standingFaction = standingFaction;
  if (isDominionCoreSystem(context.systemName)) context.region = 'dominion-core';
  const detectedVendor = detectPurchaseVendor({ systemName, stationName, vendor });
  if (detectedVendor) context.vendor = detectedVendor;
  // Missing thresholds must refuse. Never invent {unassigned:0} or similar.
  if (tierThresholds && typeof tierThresholds === 'object') context.tierThresholds = tierThresholds;
  return context;
}

/** Merge aliases resolve to one hull. Retired records still do not follow replacementId. */
export function resolveOwnedShipId(catalog, id) {
  const numericId = Number(id);
  if (!Number.isFinite(numericId)) return id;
  const ship = catalog?.getShip?.(numericId);
  return ship ? ship.id : numericId;
}

/** New traffic / shop references only. Retired 26 becomes 211; 63 has no replacement. */
export function resolveNewSpawnShipId(catalog, id) {
  if (!catalog?.resolveNewShipId) return Number(id);
  return catalog.resolveNewShipId(id);
}

export function isAmbiguousIndependentCapitalSave(shipId, { saveVersion = null, explicitChoice = null } = {}) {
  if (Number(shipId) !== INDEPENDENT_CAPITAL_ID) return false;
  if (explicitChoice === 'independent-capital' || explicitChoice === 'excalibur') return false;
  if (saveVersion) return false;
  return true;
}

export function pickSpawnShip(catalog, context = {}, faction = null) {
  if (!catalog?.spawnPool) return null;
  const spawnContext = buildSpawnContext(context);
  const pool = catalog.spawnPool(spawnContext, faction ?? null);
  return Array.isArray(pool) ? pool : [];
}

export function pickSeededSpawnId(pool, seedValue, salt, pickItem) {
  if (!pool?.length) return null;
  if (typeof pickItem === 'function') {
    const picked = pickItem(pool, seedValue, salt);
    return picked == null ? null : Number(picked.id ?? picked);
  }
  return Number(pool[0].id);
}

export function getCatalogDrawSize(catalog, id) {
  if (!catalog?.getDrawSize) return null;
  try {
    return catalog.getDrawSize(id);
  } catch {
    return null;
  }
}

export function catalogImageUrl(catalog, id) {
  if (!catalog?.imageUrl) return null;
  return catalog.imageUrl(id);
}

export function isUnbalancedPrototype(ship) {
  return Boolean(
    ship
    && (ship.rosterState === 'prototype' || ship.balanceStatus === 'pending')
    && (!Number.isFinite(ship.hull) || !Number.isFinite(ship.cost) || !ship.render),
  );
}

export function describePurchaseDecision(decision, ship = {}) {
  const name = ship.name || `Ship ${ship.id ?? ''}`.trim();
  switch (decision?.reason) {
    case 'eligible':
      return 'Ready to purchase.';
    case 'unavailable':
      return `${name} is not available.`;
    case 'standing-threshold-unconfigured':
      return `${name} is not currently offered for sale.`;
    case 'faction-standing':
      return `Need ${decision.requiredStanding} ${decision.requiredFaction === 'neutral' ? 'independent trade' : decision.requiredFaction} standing to buy ${name} (yours: ${decision.currentStanding}).`;
    case 'balance-pending':
      return `${name} is an unfinished prototype; price and combat stats are unset.`;
    case 'restricted-stock':
      return `${name} is restricted stock and is not sold by this vendor.`;
    case 'region':
      return `${name} is not sold in this system.`;
    case 'price-unconfigured':
      return `${name} has no configured price.`;
    case 'funds':
      return `Need ${decision.price ?? ship.cost} latinum to buy ${name}.`;
    default:
      return decision?.reason ? `${name} cannot be purchased (${decision.reason}).` : `${name} cannot be purchased.`;
  }
}

export function mergeCatalogIntoEntities(entities = [], catalog) {
  const merged = [];
  const seen = new Set();
  const catalogShips = catalog?.ships || [];

  for (const entity of entities) {
    const id = Number(entity.id);
    const catalogShip = catalog?.getShip?.(id);
    if (catalogShip && entity.assetType !== 'station' && entity.assetType !== 'pod') {
      if (seen.has(catalogShip.id)) continue;
      merged.push(overlayCatalogShip(entity, catalogShip, catalog));
      seen.add(catalogShip.id);
      continue;
    }
    merged.push({ ...entity });
    if (Number.isFinite(id)) seen.add(id);
  }

  for (const catalogShip of catalogShips) {
    if (seen.has(catalogShip.id)) continue;
    merged.push(overlayCatalogShip(null, catalogShip, catalog));
  }
  return merged;
}

function overlayCatalogShip(existing, catalogShip, catalog) {
  const image = catalog?.imageUrl?.(catalogShip.id) || catalogShip.image;
  const record = {
    ...(existing || {}),
    ...catalogShip,
    image,
    assetType: 'ship',
    fromShipCatalog: true,
    catalogKey: catalogShip.key,
  };
  // Prototypes must keep unset combat/economy fields unset.
  if (isUnbalancedPrototype(catalogShip)) {
    for (const field of ['hull', 'shields', 'cost', 'mass', 'cargoCapacity', 'topSpeed', 'turnRate', 'drawWidth', 'drawHeight', 'drawScale']) {
      if (!Object.prototype.hasOwnProperty.call(catalogShip, field) || catalogShip[field] == null) {
        delete record[field];
      }
    }
  }
  return record;
}
