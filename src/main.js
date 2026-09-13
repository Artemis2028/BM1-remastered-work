import { HOJ_WEAPON_ID, createHojFlight, stepHojFlight } from './ship-hoj.mjs';
import { EW_MODULES, sanitizeEW, snapshotEW, stopEW, rollEW, manageEW, fundElectronics } from './ship-ew.mjs';
import { SENSOR_RULES, SENSOR_SUITES, SensorWorld, sensorProfile, ensureSensorEquipment, defaultTransponder, fundSensors, sensorDistance, visualReach, freshTrack, receivedDeclaration, pointImpact } from './ship-sensors.mjs';
import {
  loadGameShipCatalog,
  mergeCatalogIntoEntities,
  buildSpawnContext,
  buildPurchaseContext,
  resolveOwnedShipId,
  pickSpawnShip,
  pickSeededSpawnId,
  getCatalogDrawSize,
  catalogImageUrl,
  isUnbalancedPrototype,
  describePurchaseDecision,
} from './ship-catalog-integration.mjs';
import { HOME_FACTION_STANDING, PURCHASE_TIER_STANDING } from './ship-economy.mjs';
import {
  POWER_KEYS, normalizePowerDist, shipPowerProfile, ensurePowerState,
  powerWeaponFactor, powerEngineFactor, weaponPowerCost, spendPower, stepShipPower,
  assignPowerCrew, managePowerCrew, crewAllowsShot, powerSnapshot,
} from './ship-power.mjs';

const canvas = document.getElementById('game');
const gameCtx = canvas.getContext('2d');
let ctx = gameCtx;
const minimapCanvas = document.getElementById('minimap');
const minimapCtx = minimapCanvas?.getContext('2d');
const minimapPanelEl = document.getElementById('minimap-panel');
const interstellarMapCanvas = document.getElementById('interstellar-map-canvas');
const interstellarMapCtx = interstellarMapCanvas?.getContext('2d');
const interstellarMapFrameEl = document.getElementById('interstellar-map-frame');
const closeMapBtn = document.getElementById('btn-close-map');

if (window.location.search) {
  window.history.replaceState(null, '', `${window.location.pathname}${window.location.hash}`);
}

const BASE_W = 960;
const BASE_H = 540;
const SYSTEM_W = 2600;
const SYSTEM_H = 1800;
const FLIGHT_PLANET_POSITION = { x: SYSTEM_W * 0.5, y: SYSTEM_H * 0.42 };
const MIN_FLIGHT_PLANET_DRAW_SIZE = 170;
const MAX_FLIGHT_PLANET_DRAW_SIZE = 315;
const MAP_PLANET_DRAW_SIZE = 46;
const SYSTEM_STAR_CORE_RADIUS = 96;
const SYSTEM_STAR_GLOW_RADIUS = 520;
const PLANET_MODEL_ASSET_VERSION = '20260616-tholian-expansion';
const ENTITY_SPRITE_ASSET_VERSION = '20260708-delivery-continues';
const ENTITY_MANIFEST_DATA_VERSION = '20260713-station-visual-live-v2';
const SHIP_SIZE_CONFIG_VERSION = '20260911-ship-sizing-v3';
const SOURCE_DATA_VERSION = '20260913-approved-hull-merges-v1';
const AUDIO_ASSET_VERSION = '20260713-intro-audio-v1';
const AUDIO_MANIFEST_SRC = `data/audio_manifest.json?v=${AUDIO_ASSET_VERSION}`;
const AUDIO_BASE_PATH = 'assets/game/audio/';
const WEAPON_ICON_ASSET_VERSION = '20260710-weapon-icons-godtest';
const ASTEROID_SPRITE_ASSET_VERSION = '20260602-photoasteroids';
const NEBULA_BACKGROUND_ASSET_VERSION = '20260602-photonebula';
const WARP_BACKGROUND_ASSET_VERSION = '20260614-slow-warp-stars';
const STARFIELD_BACKGROUND_ASSET_VERSION = '20260606-photostarfield';
const EFFECT_SPRITE_ASSET_VERSION = '20260607-photofx';
const FACTION_EMBLEM_ASSET_VERSION = '20260707-faction-emblems-romulan-ferengi-colors';
const ASTEROID_SPRITE_COUNT = 12;
const SHIPYARD_STOCK_SIZE = 8;
const PLANET_CLICK_RADIUS = 108;
const PLANET_DOCK_DISTANCE = 126;
const WARP_DURATION_MS = 1800;
const STAR_CHART_COORD_SCALE = 2.35;
const STAR_CHART_DEFAULT_ZOOM = 1.55;
const STAR_CHART_FOCUSED_ZOOM = 2.35;
const WARP_RANGE_PER_ANTIMATTER = 95;
const CANVAS_UI_FONT_STACK = '"Rajdhani", "Antonio", "Eurostile", "Bank Gothic", "Agency FB", "Avenir Next", "Helvetica Neue", Arial, sans-serif';
const IN_SYSTEM_WARP_HOLD_DELAY_MS = 520;
const IN_SYSTEM_WARP_MIN_INTENSITY = 0.06;
const IN_SYSTEM_WARP_EFFECT_STREAKS = 96;
const ROUTE_RANGE_MULTIPLIERS = {
  lane: 1,
  corridor: 1.2,
  shortcut: 0.62,
};
const SHIP_WARP_CLASS_RANGES = Object.freeze({
  shuttle: { min: 145, max: 245 },
  escort: { min: 285, max: 445 },
  lightCruiser: { min: 455, max: 650 },
  cruiser: { min: 690, max: 925 },
  capital: { min: 1000, max: 1325 },
  battleship: { min: 1330, max: 1780 },
});
const WORMHOLE_STATION_TYPE_ID = 85;
const WORMHOLE_ORIGIN_SYSTEM_NAME = 'Bajora';
const WORMHOLE_DOMINION_SYSTEM_NAME = 'Dominica';
const WORMHOLE_ISOLATED_SYSTEM_NAMES = new Set([
  WORMHOLE_DOMINION_SYSTEM_NAME.toLowerCase(),
  'vortara',
  'new bajor',
  'jemhadar relay',
  'karemma exchange',
  'founders watch',
  'dosi gate',
  't-rogoran annex',
]);

function canvasUiFont(size, weight = '') {
  return `${weight ? `${weight} ` : ''}${size}px ${CANVAS_UI_FONT_STACK}`;
}
const WORMHOLE_USE_RANGE = 170;
const WORMHOLE_TRANSIT_DURATION_MS = 1150;
const WORMHOLE_TRANSIT_SWITCH_AT = 0.46;
const SHIP_HAIL_RANGE = 760;
const PLAYER_WEAPON_RANGE = 820;
const PLAYER_WEAPON_COOLDOWN_MS = 330;
const PLAYER_WEAPON_DAMAGE = 26;
const SHIP_WEAPON_DAMAGE_FACTORS = {
  shuttle: 0.72,
  escort: 1,
  lightCruiser: 1.25,
  cruiser: 1.34,
  capital: 1.42,
  battleship: 1.78,
};
const SHIP_WEAPON_RELOAD_FACTORS = {
  shuttle: 1.18,
  escort: 1,
  lightCruiser: 0.86,
  cruiser: 0.84,
  capital: 0.82,
  battleship: 0.72,
};
const NPC_WEAPON_RANGE = 680;
const NPC_WEAPON_COOLDOWN_MS = 1550;
const NPC_WEAPON_DAMAGE = 8;
const NPC_WEAPON_DAMAGE_SCALE = 0.26;
const NPC_STATION_DAMAGE_SCALE = 0.68;
const NPC_WEAPON_COOLDOWN_SCALE = 1.85;
const NPC_WEAPON_FLOOR_SCALE = 5.2;
const NPC_PLAYER_AGGRO_MS = 12000;
const NPC_PLAYER_INTERVENTION_RANGE = 460;
const NPC_COMBAT_MANEUVER_MIN_MS = 1500;
const NPC_COMBAT_MANEUVER_MAX_MS = 3600;
const NPC_COMBAT_MIN_STANDOFF = 170;
const NPC_COMBAT_MAX_STANDOFF = 520;
const NPC_SYSTEM_DEFENSE_RANGE = 980;
const NPC_AGGRESSION_MEMORY_MS = 15000;
// Player security policy (Phase 2). Only `roe` changes behavior in this phase; `access` and
// `alerts` are reserved fields for the holding-zone and alert patches and have no UI yet.
const SECURITY_ROE_VALUES = Object.freeze(['return-fire', 'defend']);
const SECURITY_ACCESS_VALUES = Object.freeze(['open', 'challenge', 'closed']);
const SECURITY_ALERT_VALUES = Object.freeze(['all', 'incidents', 'silent']);
const DEFAULT_SECURITY_POLICY = Object.freeze({
  roe: 'defend',
  access: Object.freeze({ warFlag: 'open', independent: 'open', unknown: 'open', other: 'open' }),
  alerts: 'incidents',
});
// Phase 3: holding zones and compliance. A zone is centred on the system's planet (planets orbit on
// PLANET_ORBIT_BASE_MS, hours per revolution, so planet-relative markers are effectively stable);
// its radius is derived from the authority's own planet-anchored installations. All durations are
// on the local simulation clock (frameScale * 16.667 ms per tick), never on performance.now().
const SECURITY_ZONE_MIN_RADIUS = 560;
const SECURITY_ZONE_MAX_RADIUS = 1100;
const SECURITY_ZONE_RADIUS_MARGIN = 260; // beyond the authority's farthest planet-anchored installation
const SECURITY_HOLD_FRACTION = 0.8; // holding point sits at this fraction of the radius, on the visitor's approach bearing
const SECURITY_HOLD_TOLERANCE = 60;
const SECURITY_DWELL_MS = 5000;
const SECURITY_MIN_ALLOWANCE_MS = 45000;
const SECURITY_EXIT_MARGIN = 80; // withdrawal is complete beyond radius + this
const SECURITY_REENTRY_MARGIN = 140; // a visitor must get beyond radius + this before a later inward crossing is a new episode
const SECURITY_ARRIVAL_MARGIN = 220; // an arriving player is placed this far outside an active foreign zone
const SECURITY_HISTORY_CAP = 32;
const SECURITY_MAX_ACTIVE_ORDERS = 6;
const SECURITY_OUTCOME_DISPLAY_MS = 9000;
const SECURITY_ACCESS_ORDER = Object.freeze({ open: 0, challenge: 1, closed: 2 });
const SECURITY_ACCESS_CLASSES = Object.freeze(['warFlag', 'independent', 'unknown', 'other']);
// The one authored foreign checkpoint. Active only while the named authority holds the system and
// owns a live, planet-anchored installation from the preference list. No dependency on the player.
const SECURITY_AUTHORED_CHECKPOINTS = Object.freeze([
  Object.freeze({
    systemName: 'Vulcan',
    authority: 'vulcan',
    label: 'Vulcan Orbital Authority',
    anchorNames: Object.freeze(["J'lin Center", 'U of Vulcan', "V'Pek Tar"]),
    access: Object.freeze({ warFlag: 'closed', independent: 'challenge', other: 'challenge', unknown: 'open' }),
  }),
]);
const PLAYER_ESCORT_DEFENSE_RANGE = 980;
const PLAYER_ESCORT_ORDER_MS = 18000;
const MAX_PLAYER_ESCORT_SHIPS = 6;
const MAX_PLAYER_SHIELD_DAMAGE_PER_HIT = 22;
const MAX_PLAYER_HULL_DAMAGE_PER_HIT = 12;
const STATION_DEFENSE_RANGE = 700;
const STATION_WEAPON_COOLDOWN_MS = 1250;
const STATION_WEAPON_DAMAGE = 8;
const STATION_PLAYER_DAMAGE_SCALE = 0.42;
const STATION_PLAYER_COOLDOWN_SCALE = 1.7;
const STATION_PLAYER_MIN_COOLDOWN_MS = 950;
const STATION_MIN_WEAPON_COOLDOWN_MS = 420;
const STATION_MAX_DEFENSE_POWER = 8000;
const MAX_PLAYER_BUILT_STATIONS_PER_SYSTEM = 6;
const STATION_CONSTRUCTION_DAYS = 5;
const STATION_BUILD_REMOTE_MARGIN = 12000;
const STATION_DRAW_W = 100;
const STATION_DRAW_H = 84;
const STATION_DEBRIS_MIN_PIECES = 18;
const STATION_DEBRIS_MAX_PIECES = 34;
const ASTEROID_TRANSPORT_RANGE = 190;
const ASTEROID_BASE_DRIFT = 0.18;
const PLANET_ORBIT_BASE_MS = 18500000;
const MOON_ORBIT_BASE_MS = 85000;
const STATION_ORBIT_BASE_MS = 1280000;
const PLANET_LOCAL_ORBIT_CAPTURE_DISTANCE = 340;
const SHIELD_REGEN_DELAY_MS = 4200;
const PLAYER_SHIELD_REGEN_PER_SEC = 1.25;
const NPC_SHIELD_REGEN_PER_SEC = 0.85;
const STATION_SHIELD_REGEN_PER_SEC = 1.8;
const DEFAULT_WEAPON_ID = 1;
const DEFAULT_WEAPON_INVENTORY_LIMIT = 9;
const CUTTING_BEAM_WEAPON_ID = 5;
const CUTTING_BEAM_COLOR = '#39ff3f';
const GOD_MODE_LATINUM = 9999999;
const GOD_MODE_DURANIUM = 999999;
const GOD_MODE_FUEL_CAP = 9999;
const GOD_MODE_CARGO_CAP = 9999;
const SAVE_SLOT_COUNT = 3;
const LEGACY_SAVE_KEY = 'bm2_html_save';
const SAVE_SLOT_PREFIX = 'bm2_html_save_slot_';
const SYSTEM_CLAIM_LATINUM_COST = 2500;
const SYSTEM_CLAIM_DURANIUM_COST = 30;
const FACTION_SYSTEM_CLAIM_COST_MULTIPLIER = 2;
const FLEET_SHIP_PRICE_MULTIPLIER = 0.82;
const MAX_PLAYER_FLEET_SHIPS_PER_SYSTEM = 8;
const FLEET_ATTACK_MIN_INTERVAL_MS = 90000;
const FLEET_ATTACK_MAX_INTERVAL_MS = 165000;
const FLEET_ATTACK_CONTROL_DELAY_MS = 9000;
const AMBIENT_TRAFFIC_WARP_OUT_MS = 820;
const AMBIENT_TRAFFIC_WARP_IN_MS = 950;
const AMBIENT_TRAFFIC_WARP_AWAY_MIN_MS = 3200;
const AMBIENT_TRAFFIC_WARP_AWAY_MAX_MS = 6800;
const AMBIENT_TRAFFIC_WARP_NEXT_MIN_MS = 12000;
const AMBIENT_TRAFFIC_WARP_NEXT_MAX_MS = 28000;
const CLOAK_DEVICE_WEAPON_ID = 22;
const CLOAK_DURATION_MS = 12000;
const CLOAK_FADE_MS = 900;
const ENGINE_DISRUPTOR_WEAPON_ID = 23;
const ENGINE_DISRUPTOR_DISABLE_MS = 30000;
const ENGINE_DISRUPTOR_WAVE_MS = 3000;
const ENGINE_DISRUPTOR_COLOR = '#b46cff';
const THALERON_GENERATOR_WEAPON_ID = 26;
const THALERON_CLOUD_MS = 5600;
const THALERON_CLOUD_COLOR = '#80ff73';
const TRACTOR_BEAM_WEAPON_ID = 25;
const TRACTOR_BEAM_HOLD_MS = 1350;
const TRACTOR_BEAM_RANGE_GRACE = 1.22;
const TRACTOR_BEAM_TOW_FACTOR = 0.92;
const TRACTOR_BEAM_ANCHOR_STRENGTH = 0.16;
const TRACTOR_BEAM_COLOR = '#5df2ff';
const TRACTOR_BEAM_SOURCE_HALF_WIDTH = 4;
const TRACTOR_BEAM_TARGET_HALF_WIDTH = 34;
const GAME_OPTIONS_KEY = 'bm2_html_options';
const DEFAULT_GAME_OPTIONS = Object.freeze({
  muted: false,
  performanceMode: false,
  reducedEffects: false,
});
const MOD_DATA_STORAGE_KEY = 'bm2_json_editor_overrides';
const EDITOR_DATA_VERSION = '20260713-station-prune-v1';
const DEFAULT_ITEM_SETTINGS = Object.freeze({
  weaponInventoryLimit: DEFAULT_WEAPON_INVENTORY_LIMIT,
  weaponCooldowns: Object.freeze({
    powerReductionCap: 0.08,
    classFactorMin: 0.68,
    classFactorMax: 1.25,
    typeFactors: Object.freeze({
      default: 1,
      beam: 1,
      cannon: 1.04,
      turret: 1.08,
      torpedo: 1.18,
      heavy: 1.25,
    }),
    minimumsMs: Object.freeze({
      default: 300,
      beam: 360,
      cannon: 360,
      turret: 360,
      torpedo: 760,
      heavy: 1400,
      device: 900,
    }),
  }),
  factionFlags: Object.freeze({
    basePrice: 1800,
    marketMultiplier: 175,
    blockedFactions: Object.freeze(['pirate', 'borg']),
  }),
  devices: Object.freeze({
    cloak: Object.freeze({
      durationMs: CLOAK_DURATION_MS,
      fadeMs: CLOAK_FADE_MS,
    }),
    engineDisruptor: Object.freeze({
      disableMs: ENGINE_DISRUPTOR_DISABLE_MS,
      waveMs: ENGINE_DISRUPTOR_WAVE_MS,
    }),
    thaleronGenerator: Object.freeze({
      cloudMs: THALERON_CLOUD_MS,
    }),
    tractorBeam: Object.freeze({
      holdMs: TRACTOR_BEAM_HOLD_MS,
      rangeGrace: TRACTOR_BEAM_RANGE_GRACE,
      towFactor: TRACTOR_BEAM_TOW_FACTOR,
      anchorStrength: TRACTOR_BEAM_ANCHOR_STRENGTH,
      sourceHalfWidth: TRACTOR_BEAM_SOURCE_HALF_WIDTH,
      targetHalfWidth: TRACTOR_BEAM_TARGET_HALF_WIDTH,
    }),
  }),
});

function cloneDefaultDeviceSettings() {
  return {
    cloak: { ...DEFAULT_ITEM_SETTINGS.devices.cloak },
    engineDisruptor: { ...DEFAULT_ITEM_SETTINGS.devices.engineDisruptor },
    thaleronGenerator: { ...DEFAULT_ITEM_SETTINGS.devices.thaleronGenerator },
    tractorBeam: { ...DEFAULT_ITEM_SETTINGS.devices.tractorBeam },
  };
}

let itemSettings = {
  weaponInventoryLimit: DEFAULT_ITEM_SETTINGS.weaponInventoryLimit,
  weaponCooldowns: {
    powerReductionCap: DEFAULT_ITEM_SETTINGS.weaponCooldowns.powerReductionCap,
    classFactorMin: DEFAULT_ITEM_SETTINGS.weaponCooldowns.classFactorMin,
    classFactorMax: DEFAULT_ITEM_SETTINGS.weaponCooldowns.classFactorMax,
    typeFactors: { ...DEFAULT_ITEM_SETTINGS.weaponCooldowns.typeFactors },
    minimumsMs: { ...DEFAULT_ITEM_SETTINGS.weaponCooldowns.minimumsMs },
  },
  factionFlags: {
    basePrice: DEFAULT_ITEM_SETTINGS.factionFlags.basePrice,
    marketMultiplier: DEFAULT_ITEM_SETTINGS.factionFlags.marketMultiplier,
    blockedFactions: [...DEFAULT_ITEM_SETTINGS.factionFlags.blockedFactions],
  },
  devices: cloneDefaultDeviceSettings(),
};
const ORIGINAL_INTRO_STORY_HTML = `
  <h2>FlashTrek: Broken Mirror</h2>
  <h3>Episode 1, The Imperial War</h3>
  <p>There was no greater triumph in the history of mankind than the founding of the Earth Empire in 2125. This was no less than 50 years after the emergence of the human race into the galaxy, with their primitive warp ships and unwavering determination. When they aligned with the Vulcans and took advantage of all the advanced technologies they had to offer, the humans truly came into their own.</p>
  <p>But their thirst for power and conquest would lead them on a two-hundred-year enterprise of destruction and enslavement. Within 20 years of the birth of the Empire over a dozen races had been annexed and set to work building the Imperial Regime. The most formidable slaves became the Klingons, whose weapons and ship technology was the basis for the Empire's fleet.</p>
  <p>The Earth Empire seemed unstoppable. Its territory spanned the galaxy, its power infinite, and its influence without boundaries. But all of this would soon come to an end. Reforms in the Vulcan culture, ones that spoke of peace and equality among all species, were beginning to influence the highest levels of the human government.</p>
  <p>After several laws that freed many species from enslavement, including the end of the Cardassian occupation of Bajor, the cruel nature of the human citizens themselves turned against the now softening government. A new faction launched a rebellion and overthrew the Earth Empire. The New Earth Empire was formed, with a new found thirst for expansion.</p>
  <p>But the damage had been done. The Empire was now noticeably weakened, especially with the expulsion of the reformed Vulcan society. Many other governments began a secret arms race to launch an attack against the Empire. For fifty years the Klingons and Cardassians amassed ships and weapons, until the Cardassians bowed out of the race, giving the Klingons a clear field.</p>
  <p>It was clear after the first attack that the humans were in no condition to defend against an invasion. Their outer territory fell and their empire collapsed. The humans banded together, taking up arms to collectively drive out the Klingons.</p>
  <p>So is the condition of the galaxy as you are born into it in 2369 on New Switzerland. An ongoing war with the humans slowly losing, while everyone else can only sit and wait for the outcome. After owning a small trade depot where you were born in relative peace, you have finally saved enough money to buy a small Danube runabout. In 2398, launching from New Switzerland, you are eager to face the challenges of the unknown and make your mark on the galaxy. A world of opportunity awaits you.</p>
`;
const DEFAULT_WEAPON_CATALOG = Object.freeze([
  { id: 1, name: 'Type X Phaser', type: 'Beam', damage: 33, cooldown: 520, range: 820, speed: 18, price: 3000, minMass: 1, color: '#ff9a3d', icon: 'typex.gif', stockFactions: ['terran', 'neutral'] },
  { id: 15, name: 'Photon Torpedo', type: 'Torpedo', damage: 33, cooldown: 1200, range: 980, speed: 10, price: 2500, minMass: 1, color: '#ffffff', icon: 'tachyon.gif', stockFactions: ['terran', 'neutral'] },
  { id: 22, name: 'Cloaking Device', type: 'Device', damage: 0, cooldown: 1800, range: 620, speed: 16, price: 13500, minMass: 2, color: '#9fb2d0', icon: 'enginedis.gif', stockFactions: ['romulan', 'klingon'] },
  { id: 23, name: 'Engine Disruptor', type: 'Device', damage: 0, cooldown: 3600, range: 1800, speed: 16, price: 5000, minMass: 1, color: ENGINE_DISRUPTOR_COLOR, icon: 'enginedis.gif', stockFactions: ['ferengi', 'pirate'] },
  { id: 25, name: 'Tractor Beam', type: 'Device', damage: 0, cooldown: 1100, range: 700, speed: 18, price: 3400, minMass: 1, color: TRACTOR_BEAM_COLOR, icon: 'enginedis.gif', stockFactions: ['terran', 'ferengi'] },
  { id: 26, name: 'Thaleron Generator', type: 'Heavy', damage: 112, cooldown: 3600, range: 980, speed: 8.5, price: 15500, minMass: 4, color: THALERON_CLOUD_COLOR, icon: 'thaleron.gif', stockFactions: ['romulan', 'reman'] },
]);
let WEAPON_CATALOG = [...DEFAULT_WEAPON_CATALOG];
const DEFAULT_TRADE_GOODS = Object.freeze([
  'Medical Supplies',
  'Food Stuffs',
  'Warp Coils',
  'Dilithium',
  'Raw Latinum',
]);
const FALLBACK_NPC_SHIP_IDS = [
  1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20,
  21, 22, 23, 24, 25, 26, 27, 28, 29, 30, 31, 32, 33, 34, 35, 36, 37, 38,
  39, 40, 41, 42, 43, 44, 45, 46, 47, 48, 49, 50, 51, 52, 53, 54, 55, 56,
  57, 58, 59, 60, 61, 62, 63, 64, 65, 66,
];
const LEGACY_SHIP_ID_REPLACEMENTS = {};
const DEFAULT_SHIP_SIZE_CONFIG = {
  // These class scales are the baseline the manifest's per-hull drawScale values were authored
  // against (getShipVisualScale keeps each hull's proportion to its class). The ladder the game
  // actually ships with is data/ship_size_config.json; change sizes there, not here.
  classScales: {
    shuttle: 0.5,
    escort: 0.72,
    lightCruiser: 1.15,
    cruiser: 1.85,
    capital: 3,
    battleship: 4,
  },
  classTurnRates: {
    shuttle: 24,
    escort: 18,
    lightCruiser: 13.5,
    cruiser: 9.5,
    capital: 6.2,
    battleship: 4.4,
  },
  classSystemWarpMultipliers: {
    shuttle: 4.4,
    escort: 4,
    lightCruiser: 3.45,
    cruiser: 3,
    capital: 2.45,
    battleship: 2.05,
  },
  trafficScaleVariance: {
    min: 0.9,
    max: 1.06,
  },
  shipClassOverrides: {},
  shipScaleOverrides: {},
};
const NON_TRAFFIC_SHIP_TERMS = [
  'starbase', 'station', 'shipyard', 'lab', 'university', 'waterpark', 'bar',
  'dyson', 'platform', 'generator', 'subspace comm', 'starbridge', 'escape pod',
];
const statsEl = document.getElementById('stats');
const panelEl = document.getElementById('panel');
const topLeftMenuEl = document.getElementById('top-left-menu');
const topLeftPanelEl = document.getElementById('top-left-panel');
const targetWindowEl = document.getElementById('target-window');
const bottomDockEl = document.getElementById('bottom-dock');
const planetMenuEl = document.getElementById('planet-menu');
const securityOrderPanelEl = document.getElementById('security-order-panel');
const contractModalEl = document.getElementById('contract-modal');
const missionCompleteModalEl = document.getElementById('mission-complete-modal');
const shipPurchaseModalEl = document.getElementById('ship-purchase-modal');
const fleetPurchaseModalEl = document.getElementById('fleet-purchase-modal');
const stationBuildModalEl = document.getElementById('station-build-modal');
const wormholeModalEl = document.getElementById('wormhole-modal');
const logEl = document.getElementById('log');
const startMenuEl = document.getElementById('start-menu');
const introStoryEl = document.getElementById('intro-story');
const introSkipBtn = document.getElementById('intro-skip');
const introStoryTextEl = document.getElementById('intro-story-text');
const factionDescEl = document.getElementById('faction-desc');
const hudEl = document.getElementById('hud');
const gameOverMenuEl = document.getElementById('gameover-menu');
const gameOverTitleEl = document.getElementById('gameover-title');
const gameOverDescEl = document.getElementById('gameover-desc');
const restartGameBtn = document.getElementById('btn-restart-game');
const escapePodBtn = document.getElementById('btn-escape-pod');
const weaponsBtn = document.getElementById('btn-weapons');

const spriteAssets = {
  asteroid: 'assets/game/sprites/asteroid.png',
  explosions: `assets/game/effects/photoreal-explosions.png?v=${EFFECT_SPRITE_ASSET_VERSION}`,
  nebula: `assets/game/backgrounds/nebula-photorealistic.png?v=${NEBULA_BACKGROUND_ASSET_VERSION}`,
  starfield: `assets/game/backgrounds/starfield-photorealistic.png?v=${STARFIELD_BACKGROUND_ASSET_VERSION}`,
  stationDebris: `assets/game/effects/photoreal-station-debris.png?v=${EFFECT_SPRITE_ASSET_VERSION}`,
  sun: 'assets/game/sprites/sun-photorealistic.png',
  warp: `assets/game/backgrounds/warp-photorealistic.png?v=${WARP_BACKGROUND_ASSET_VERSION}`,
  wormhole: 'assets/game/sprites/wormhole.png',
  wormholestation: 'assets/game/sprites/wormholestation.png',
};

const factionEmblemAssets = {
  terran: 'assets/game/factions/terran.png',
  ferengi: 'assets/game/factions/ferengi.png',
  vulcan: 'assets/game/factions/vulcan.png',
  romulan: 'assets/game/factions/romulan.png',
  cardassian: 'assets/game/factions/cardassian.png',
  klingon: 'assets/game/factions/klingon.png',
  dominion: 'assets/game/factions/dominion.png',
  breen: 'assets/game/factions/breen.png',
  tholian: 'assets/game/factions/tholian.png',
  bajoran: 'assets/game/factions/bajoran.png',
  sona: 'assets/game/factions/sona.png',
  delpin: 'assets/game/factions/delpin.png',
  tarellian: 'assets/game/factions/tarellian.png',
  promelli: 'assets/game/factions/promelli.png',
  andorian: 'assets/game/factions/andorian.png',
  gorn: 'assets/game/factions/gorn.png',
  hirogen: 'assets/game/factions/hirogen.png',
  suliban: 'assets/game/factions/suliban.png',
  borg: 'assets/game/factions/borg.png',
  pirate: 'assets/game/factions/pirate.png',
  neutral: 'assets/game/factions/neutral.png',
};

const sprites = {};
for (const [key, src] of Object.entries(spriteAssets)) {
  const img = new Image();
  img.src = src;
  sprites[key] = img;
}

const factionEmblemSprites = {};
for (const [key, src] of Object.entries(factionEmblemAssets)) {
  const img = new Image();
  img.src = `${src}?v=${FACTION_EMBLEM_ASSET_VERSION}`;
  factionEmblemSprites[key] = img;
}

sprites.asteroidVariants = Array.from({ length: ASTEROID_SPRITE_COUNT }, (_, i) => {
  const img = new Image();
  img.src = `assets/game/asteroids/${i + 1}.png?v=${ASTEROID_SPRITE_ASSET_VERSION}`;
  return img;
});
const originalWeaponSprites = {};
const tintCanvas = document.createElement('canvas');
const tintCtx = tintCanvas.getContext('2d');
const chartNebulaCanvas = document.createElement('canvas');
const chartNebulaCtx = chartNebulaCanvas.getContext('2d');
const shieldOutlineCache = new Map();
const SHIELD_BUBBLE_COLOR = '#56c8ff';
const SHIELD_BUBBLE_CORE_COLOR = '#d7f7ff';
const SHIELD_FLARE_TTL_MS = 320;
const MAX_ACTIVE_SHIELD_FLARES = 10;
const imageAlphaBoundsCache = new WeakMap();
const imageAlphaMaskCache = new WeakMap();
const imageAlphaSampleCache = new WeakMap();

const state = {
  ship: {
    x: 480,
    y: 270,
    velocity: 0,
    rotation: 0,
    turnVelocity: 0,
    maxSpeed: 3.5,
    acceleration: 0.18,
    brake: 0.26,
    turnAcceleration: 0.36,
    turnDamping: 0.09,
    maxTurnSpeed: 1.6,
    baseMaxSpeed: 3.5,
    forwardThrustStartedAt: 0,
    systemWarpIntensity: 0,
    systemWarpMultiplier: 3,
    systemWarpTurnPenalty: 0.24,
    warpThreshold: 6.25,
    drawScale: 1,
  },
  camera: {
    x: FLIGHT_PLANET_POSITION.x + 56,
    y: FLIGHT_PLANET_POSITION.y + 34,
  },
  stars: Array.from({ length: 140 }, () => ({
    x: Math.random() * BASE_W,
    y: Math.random() * BASE_H,
    z: Math.random() * 1 + 0.3,
  })),
  planets: [
    { name: 'Sol', x: 220, y: 160, color: '#6ec5ff', market: 8 },
    { name: 'Orion', x: 740, y: 180, color: '#a6ff7b', market: 11 },
    { name: 'Draco', x: 650, y: 390, color: '#ffb870', market: 14 },
    { name: 'Cygnus', x: 280, y: 380, color: '#ff7bc0', market: 10 },
  ],
  systemData: [],
  systemStates: {},
  systemFaction: 'neutral',
  systemAttitude: 'neutral',
  systemHasNebula: false,
  systemNebulaColor: 'rgba(137, 97, 255, 0.34)',
  systemStar: { x: SYSTEM_W * 0.5, y: SYSTEM_H * 0.5 },
  systemBodies: [],
  wormhole: null,
  station: { x: 480, y: 470 },
  stations: [],
  stationDefinitions: [],
  playerBuiltStations: [],
  playerWormholes: [],
  stationPlans: [],
  playerFleet: [],
  controlledSystems: [],
  stationOwners: {},
  securityPolicies: { default: null, systems: {} },
  securityZones: { version: 1, nextVisitorInstance: 1, systems: {}, epochs: {} },
  securityEncounters: { version: 1, systems: {} },
  securityLiveSystemIndex: null, // which system's NPCs are live in state.npcShips (for participant capture)
  securityOutcomeNotice: null, // last player-visitor outcome, shown briefly in the order panel
  visitedSystems: [],
  factionSystemOverrides: {},
  factionStanding: {},
  feats: {},
  power: { energy: 200, dist: { reserve: 5, engines: 5, weapons: 5, shields: 5 } },
  destroyedStations: {},
  npcShips: [],
  nextFleetAttackAt: 0,
  activeFleetAttack: null,
  fleetAttackControlSince: 0,
  trafficWarpCooldownUntil: 0,
  trafficDestinations: [],
  systemPlanet: { ...FLIGHT_PLANET_POSITION },
  asteroids: Array.from({ length: 8 }, () => ({
    x: 100 + Math.random() * 760,
    y: 90 + Math.random() * 360,
    r: 16 + Math.random() * 14,
  })),
  depletedAsteroids: {},
  tradeGoodsArray: [...DEFAULT_TRADE_GOODS],
  planetMarkets: {},
  travelRoutes: [],
  currentPlanet: 0,
  myplanet: 1,
  cargo: 0,
  cargoCap: 20,
  mycargo: 0,
  totcargo: 20,
  cargoArray: Array.from({ length: 10 }, () => ({ tons: 0, item: 'Nothing', destination: undefined, payout: 0 })),
  latinum: 100,
  mylatinum: 100,
  shipPurchaseTierThresholds: { ...PURCHASE_TIER_STANDING },
  shipCatalog: null,
  duranium: 0,
  myduranium: 0,
  antimatter: 6,
  myantimatter: 6,
  playership: 18,
  playerFaction: 'ferengi',
  playerFlags: [],
  captainName: '',
  shipName: '',
  mytech: [undefined, 52],
  mymass: 1,
  antimatteruse: 3,
  tothull: 5,
  totshields: 5,
  totspeed: 15,
  totturn: 10,
  mymenu: 0,
  cargopanel: 0,
  fuel: 80,
  fuelCap: 100,
  hull: 100,
  shields: 100,
  lastShieldHitAt: 0,
  day: 1,
  missionCargoGoal: 12,
  missionDeadline: 28,
  deliveredCargo: 0,
  tradeLaneRestored: false,
  mapOpen: false,
  gameStarted: false,
  introActive: false,
  docked: false,
  dockedPlanetIndex: null,
  dockedStationId: null,
  dockMenuTab: 'services',
  dockPanelScrollByTab: {},
  topLeftPanelScrollByTab: {},
  fleetPurchaseShipId: null,
  topLeftTab: 'inventory',
  autoTarget: true,
  fleetStance: 'follow',
  auxLaunched: false,
  spawnProtectionUntil: 0,
  topLeftPanelOpen: false,
  startMenuView: 'main',
  startSetupFaction: null,
  currentSaveSlot: 1,
  godMode: false,
  gameOptions: loadGameOptions(),
  planetMenuOpen: false,
  selectedPlanet: 1,
  starChart: {
    panX: 0,
    panY: 0,
    zoom: STAR_CHART_DEFAULT_ZOOM,
    dragging: false,
    dragMoved: 0,
    suppressClick: false,
    openedAt: 0,
  },
  activeContract: null,
  pendingContractOffer: null,
  missionCompleteNotice: null,
  pendingShipPurchase: null,
  pendingFleetPurchase: null,
  pendingStationBuild: null,
  pendingWormholeBuild: null,
  openContracts: [],
  expneg: 0,
  gameOver: false,
  victory: false,
  warp: {
    active: false,
    from: null,
    to: null,
    route: null,
    startedAt: 0,
    duration: WARP_DURATION_MS,
    message: '',
  },
  wormholeTransit: {
    active: false,
    from: null,
    to: null,
    name: '',
    startedAt: 0,
    duration: WORMHOLE_TRANSIT_DURATION_MS,
    switched: false,
  },
  log: 'Ready.',
  flaHints: null,
  planetManifest: null,
  planetModelSprites: {},
  planetRingSprites: {},
  shipStatsById: {},
  shipImageById: {},
  shipImageCandidatesById: {},
  shipImageBoundsById: {},
  shipSpriteCandidateIndex: {},
  shipSprites: {},
  shipSizeConfig: DEFAULT_SHIP_SIZE_CONFIG,
  originalShipWeaponSlots: {},
  originalStationWeaponSlots: {},
  weaponInventory: [DEFAULT_WEAPON_ID],
  equippedWeaponId: DEFAULT_WEAPON_ID,
  weaponSlots: [DEFAULT_WEAPON_ID, null, null],
  weaponLastFiredAt: [0, 0, 0],
  cloak: {
    active: false,
    startedAt: 0,
    duration: finiteNumber(getCloakItemSettings().durationMs, CLOAK_DURATION_MS),
  },
  lastPlayerShotAt: 0,
  lastPlayerAggressionAt: 0,
  lastPlayerAggressionSystemIndex: null,
  lastPlayerAggressionTargetSide: null,
  npcShipIds: FALLBACK_NPC_SHIP_IDS,
  projectiles: [],
  weaponEffects: [],
  tractorBeams: [],
  combatTargetId: null,
  combatTargetType: 'ship',
  worldPops: [],
  planetCallout: null,
};

const editorRuntime = {
  loaded: false,
  loading: false,
  dataset: 'ships',
  selectedIndexByDataset: {},
  rawOpen: false,
  rawText: '',
  status: 'Editor ready.',
  data: {},
};

const audioRuntime = {
  manifest: {
    basePath: AUDIO_BASE_PATH,
    defaults: { musicVolume: 0.34, sfxVolume: 0.74, uiVolume: 0.58 },
    sounds: {},
    weaponSounds: {},
  },
  loaded: false,
  loading: false,
  unlocked: false,
  context: null,
  loops: new Map(),
  recent: new Map(),
  pendingLoops: new Set(),
};

async function loadAudioManifest() {
  if (audioRuntime.loaded || audioRuntime.loading) return audioRuntime.manifest;
  audioRuntime.loading = true;
  try {
    const response = await fetch(AUDIO_MANIFEST_SRC, { cache: 'no-store' });
    if (response?.ok) {
      const data = await response.json();
      audioRuntime.manifest = {
        ...audioRuntime.manifest,
        ...data,
        defaults: {
          ...audioRuntime.manifest.defaults,
          ...(data.defaults || {}),
        },
        sounds: data.sounds && typeof data.sounds === 'object' ? data.sounds : {},
        weaponSounds: data.weaponSounds && typeof data.weaponSounds === 'object' ? data.weaponSounds : {},
      };
    }
  } catch {
    audioRuntime.manifest = { ...audioRuntime.manifest };
  } finally {
    audioRuntime.loaded = true;
    audioRuntime.loading = false;
    playPendingAudioLoops();
    syncBackgroundAudio();
  }
  return audioRuntime.manifest;
}

function isGameAudioMuted() {
  return Boolean(state.gameOptions?.muted);
}

function getAudioSoundEntry(key) {
  const entry = audioRuntime.manifest?.sounds?.[key];
  if (!entry) return null;
  return typeof entry === 'string' ? { file: entry } : entry;
}

function getAudioSource(entry) {
  if (!entry?.file) return '';
  if (/^(https?:)?\/\//.test(entry.file) || entry.file.startsWith('data:')) return entry.file;
  const basePath = String(audioRuntime.manifest?.basePath || AUDIO_BASE_PATH).replace(/\/?$/, '/');
  return `${basePath}${entry.file}?v=${AUDIO_ASSET_VERSION}`;
}

function getAudioCategoryVolume(entry = {}) {
  const defaults = audioRuntime.manifest?.defaults || {};
  const category = entry.category || 'sfx';
  const base = category === 'music'
    ? finiteNumber(defaults.musicVolume, 0.34)
    : category === 'ui'
      ? finiteNumber(defaults.uiVolume, 0.58)
      : finiteNumber(defaults.sfxVolume, 0.74);
  return clamp(base * finiteNumber(entry.volume, 1), 0, 1);
}

function playPendingAudioLoops() {
  if (!audioRuntime.unlocked || !audioRuntime.loaded || isGameAudioMuted()) return;
  const pending = [...audioRuntime.pendingLoops];
  audioRuntime.pendingLoops.clear();
  for (const key of pending) startGameAudioLoop(key);
}

function unlockGameAudio() {
  if (audioRuntime.unlocked) return true;
  audioRuntime.unlocked = true;
  try {
    const AudioContextClass = window.AudioContext || window.webkitAudioContext;
    if (AudioContextClass && !audioRuntime.context) audioRuntime.context = new AudioContextClass();
    audioRuntime.context?.resume?.();
  } catch {
    audioRuntime.context = null;
  }
  playPendingAudioLoops();
  syncBackgroundAudio();
  return true;
}

function playGameSound(key, options = {}) {
  if (!key || isGameAudioMuted() || !audioRuntime.unlocked) return null;
  const entry = getAudioSoundEntry(key);
  const source = getAudioSource(entry);
  if (!entry || !source) return null;
  const now = performance.now();
  const cooldownKey = options.cooldownKey || key;
  const cooldownMs = Math.max(0, finiteNumber(options.cooldownMs, entry.cooldownMs || 0));
  if (cooldownMs > 0 && now - finiteNumber(audioRuntime.recent.get(cooldownKey), 0) < cooldownMs) {
    return null;
  }
  audioRuntime.recent.set(cooldownKey, now);
  try {
    const audio = new Audio(source);
    audio.preload = 'auto';
    audio.volume = clamp(getAudioCategoryVolume(entry) * finiteNumber(options.volume, 1), 0, 1);
    const jitter = finiteNumber(options.rateJitter, 0);
    if (jitter > 0) audio.playbackRate = clamp(1 + (Math.random() - 0.5) * jitter, 0.72, 1.28);
    audio.play()?.catch?.(() => {});
    return audio;
  } catch {
    return null;
  }
}

function startGameAudioLoop(key) {
  if (!key || isGameAudioMuted()) return null;
  if (!audioRuntime.unlocked || !audioRuntime.loaded) {
    audioRuntime.pendingLoops.add(key);
    if (!audioRuntime.loaded && !audioRuntime.loading) loadAudioManifest();
    return null;
  }
  const entry = getAudioSoundEntry(key);
  const source = getAudioSource(entry);
  if (!entry || !source) {
    audioRuntime.pendingLoops.add(key);
    return null;
  }
  audioRuntime.pendingLoops.delete(key);
  const existing = audioRuntime.loops.get(key);
  if (existing) {
    existing.volume = getAudioCategoryVolume(entry);
    return existing;
  }
  try {
    const audio = new Audio(source);
    audio.loop = entry.loop !== false;
    audio.preload = 'auto';
    audio.volume = getAudioCategoryVolume(entry);
    audio.play()?.catch?.(() => {
      audioRuntime.loops.delete(key);
    });
    audioRuntime.loops.set(key, audio);
    return audio;
  } catch {
    return null;
  }
}

function stopGameAudioLoop(key) {
  audioRuntime.pendingLoops.delete(key);
  const audio = audioRuntime.loops.get(key);
  if (!audio) return;
  audio.pause();
  try {
    audio.currentTime = 0;
  } catch {}
  audioRuntime.loops.delete(key);
}

function stopAllGameAudioLoops() {
  audioRuntime.pendingLoops.clear();
  for (const key of [...audioRuntime.loops.keys()]) stopGameAudioLoop(key);
}

function refreshGameAudioLoops() {
  for (const [key, audio] of audioRuntime.loops.entries()) {
    const entry = getAudioSoundEntry(key);
    if (!entry || isGameAudioMuted()) {
      stopGameAudioLoop(key);
    } else {
      audio.volume = getAudioCategoryVolume(entry);
    }
  }
}

function syncBackgroundAudio() {
  if (!audioRuntime.unlocked) return;
  if (isGameAudioMuted() || state.gameStarted) {
    stopAllGameAudioLoops();
    return;
  }
  if (state.introActive) {
    stopGameAudioLoop('menuMusic');
    startGameAudioLoop('introMusic');
    return;
  }
  stopGameAudioLoop('introMusic');
  startGameAudioLoop('menuMusic');
}

function refreshAudioForOptions() {
  if (isGameAudioMuted()) {
    stopAllGameAudioLoops();
    return;
  }
  refreshGameAudioLoops();
  syncBackgroundAudio();
}

function getWeaponAudioKey(weapon = getWeapon()) {
  const mapped = audioRuntime.manifest?.weaponSounds?.[String(weapon?.id)];
  if (mapped) return mapped;
  const name = String(weapon?.name || '').toLowerCase();
  const type = String(weapon?.type || '').toLowerCase();
  if (isCloakingDevice(weapon)) return 'cloak';
  if (isTractorBeamWeapon(weapon)) return 'tractorBeam';
  if (isEngineDisruptorWeapon(weapon) || isThaleronGeneratorWeapon(weapon)) return 'energyWave';
  if (isCuttingBeamWeapon(weapon)) return 'cuttingBeam';
  if (type === 'torpedo' || type === 'heavy') {
    if (name.includes('quantum') || name.includes('tachyon') || name.includes('transphasic')) return 'quantumTorpedo';
    if (name.includes('romulan') || name.includes('plasma')) return 'romulanTorpedo';
    return 'torpedo';
  }
  if (type === 'cannon' || type === 'turret') return name.includes('disruptor') ? 'disruptor' : 'pulse';
  if (name.includes('polaron')) return 'polaronBeam';
  if (name.includes('dominion') || name.includes('bio')) return 'dominionPhaser';
  return type === 'beam' ? 'phaser' : 'beam';
}

function playWeaponSound(weapon = getWeapon(), options = {}) {
  const key = getWeaponAudioKey(weapon);
  return playGameSound(key, {
    cooldownKey: options.cooldownKey || `weapon:${key}:${options.sourceId || 'global'}`,
    rateJitter: options.rateJitter ?? 0.08,
    volume: options.volume ?? 1,
  });
}

function playImpactSound(result = {}, options = {}) {
  if (result.hullDamage > 0) {
    playGameSound('hullHit', {
      cooldownKey: options.cooldownKey || 'impact:hull',
      volume: options.volume || 1,
      rateJitter: 0.1,
    });
    return;
  }
}

function initGameAudio() {
  loadAudioManifest();
  document.addEventListener('pointerdown', (e) => {
    unlockGameAudio();
    if (e.target?.closest?.('button, [role="button"], select, input[type="button"], input[type="submit"]')) {
      playGameSound('uiClick', { cooldownKey: 'ui:click' });
    }
  }, { capture: true });
  window.addEventListener('keydown', unlockGameAudio, { capture: true });
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) stopAllGameAudioLoops();
    else syncBackgroundAudio();
  });
}

const EDITOR_DATASETS = {
  ships: {
    label: 'Unit Stats',
    file: 'starship_manifest.json',
    source: () => `data/starship_manifest.json?v=${ENTITY_MANIFEST_DATA_VERSION}`,
    collectionPath: ['ships'],
    preview: 'ship',
    fields: [
      { path: 'name', label: 'Name of Class', type: 'text' },
      { path: 'description', label: 'Class Description', type: 'textarea' },
      { path: 'shipClass', label: 'Ship Class', type: 'select', options: ['shuttle', 'escort', 'lightCruiser', 'cruiser', 'capital', 'battleship'] },
      { path: 'mass', label: 'Mass', type: 'number' },
      { path: 'antimatterUse', label: 'Antimatter Use', type: 'number' },
      { path: 'cargoCapacity', label: 'Cargo Size', type: 'number' },
      { path: 'hull', label: 'Hull Strength', type: 'number' },
      { path: 'shields', label: 'Shield Strength', type: 'number' },
      { path: 'topSpeed', label: 'Top Speed', type: 'number' },
      { path: 'turnRate', label: 'Turn Rate', type: 'number' },
      { path: 'cost', label: 'MSRP Cost', type: 'number' },
      { path: 'drawWidth', label: 'Draw Width', type: 'number' },
      { path: 'drawHeight', label: 'Draw Height', type: 'number' },
      { path: 'drawScale', label: 'Draw Scale', type: 'number', step: '0.01' },
      { path: 'image', label: 'Sprite Path', type: 'text' },
    ],
  },
  stations: {
    label: 'Station Stats',
    file: 'station_manifest.json',
    source: () => `data/station_manifest.json?v=${ENTITY_MANIFEST_DATA_VERSION}`,
    collectionPath: ['stations'],
    preview: 'station',
    fields: [
      { path: 'name', label: 'Station Name', type: 'text' },
      { path: 'description', label: 'Description', type: 'textarea' },
      { path: 'sizeClass', label: 'Size Class', type: 'text' },
      { path: 'mass', label: 'Mass', type: 'number' },
      { path: 'cargoCapacity', label: 'Cargo Size', type: 'number' },
      { path: 'hull', label: 'Hull Strength', type: 'number' },
      { path: 'shields', label: 'Shield Strength', type: 'number' },
      { path: 'topSpeed', label: 'Top Speed', type: 'number' },
      { path: 'turnRate', label: 'Turn Rate', type: 'number' },
      { path: 'cost', label: 'MSRP Cost', type: 'number' },
      { path: 'drawWidth', label: 'Draw Width', type: 'number' },
      { path: 'drawHeight', label: 'Draw Height', type: 'number' },
      { path: 'drawScale', label: 'Draw Scale', type: 'number', step: '0.01' },
      { path: 'stationWeaponIds', label: 'Station Weapons', type: 'csvNumbers' },
      { path: 'image', label: 'Sprite Path', type: 'text' },
    ],
  },
  systems: {
    label: 'System Editor',
    file: 'planetData.json',
    source: () => `data/planetData.json?v=${SOURCE_DATA_VERSION}`,
    collectionPath: ['planets'],
    preview: 'planet',
    fields: [
      { path: 'name', label: 'Planet Name', type: 'text' },
      { path: 'governmentId', label: "Default Gov't", type: 'number' },
      { path: 'population', label: 'Default Strength', type: 'number' },
      { path: 'surfaceType', label: 'Surface Image #', type: 'number' },
      { path: 'market', label: 'Price Variance', type: 'number' },
      { path: 'description', label: 'Planet Description', type: 'textarea' },
      { path: 'planetScale', label: 'Planet Size (%)', type: 'number' },
      { path: 'shipStockIds', label: 'Sell Ships', type: 'csvNumbers' },
      { path: 'hasNebula', label: 'Nebula Present', type: 'checkbox' },
      { path: 'hasAsteroids', label: 'Asteroids Present', type: 'checkbox' },
      { path: 'ring.type', label: 'Ring Type', type: 'number' },
      { path: 'ring.rotation', label: 'Ring Angle', type: 'number' },
      { path: 'map.x', label: 'Map X Coordinate', type: 'number' },
      { path: 'map.y', label: 'Map Y Coordinate', type: 'number' },
    ],
  },
  map: {
    label: 'Map / Stations',
    file: 'stationData.json',
    source: () => `data/stationData.json?v=${SOURCE_DATA_VERSION}`,
    collectionPath: ['stations'],
    preview: 'stationPlacement',
    fields: [
      { path: 'name', label: 'Station Name', type: 'text' },
      { path: 'systemIndex', label: 'System Index', type: 'number' },
      { path: 'stationTypeId', label: 'Station Type', type: 'number' },
      { path: 'condition', label: 'Condition', type: 'number' },
      { path: 'offset.x', label: 'Offset X', type: 'number' },
      { path: 'offset.y', label: 'Offset Y', type: 'number' },
      { path: 'rotation', label: 'Rotation', type: 'number' },
      { path: 'drawWidth', label: 'Draw Width Override', type: 'number' },
      { path: 'drawHeight', label: 'Draw Height Override', type: 'number' },
      { path: 'drawScale', label: 'Draw Scale Override', type: 'number', step: '0.01' },
      { path: 'stock.shipIds', label: 'Stock Ships', type: 'csvNumbers' },
      { path: 'stock.weaponIds', label: 'Stock Weapons', type: 'csvNumbers' },
    ],
  },
  weapons: {
    label: 'Weapons / Tech',
    file: 'game_items.json',
    source: () => `data/game_items.json?v=${SOURCE_DATA_VERSION}`,
    collectionPath: ['weapons'],
    preview: 'weapon',
    fields: [
      { path: 'name', label: 'Weapon Name', type: 'text' },
      { path: 'type', label: 'Weapon Type', type: 'select', options: ['Beam', 'Cannon', 'Turret', 'Torpedo', 'Heavy', 'Device', 'Utility', 'Mine'] },
      { path: 'damage', label: 'Base Power', type: 'number' },
      { path: 'cooldown', label: 'Recharge Rate (ms)', type: 'number' },
      { path: 'range', label: 'Range', type: 'number' },
      { path: 'speed', label: 'Projectile Speed', type: 'number', step: '0.1' },
      { path: 'price', label: 'MSRP Cost', type: 'number' },
      { path: 'minMass', label: 'Mass Requirement', type: 'number' },
      { path: 'color', label: 'Effect Colour', type: 'colorText' },
      { path: 'icon', label: 'Graphic', type: 'text' },
      { path: 'stockFactions', label: 'Stock Factions', type: 'csvStrings' },
    ],
  },
  items: {
    label: 'Items / Economy',
    file: 'game_items.json',
    source: () => `data/game_items.json?v=${SOURCE_DATA_VERSION}`,
    preview: 'items',
    fields: [
      { type: 'section', label: 'Manifest' },
      { path: 'schema', label: 'Schema', type: 'text' },
      { path: 'version', label: 'Manifest Version', type: 'text' },
      { type: 'section', label: 'Inventory' },
      { path: 'settings.weaponInventoryLimit', label: 'Weapon Locker Limit', type: 'number' },
      { type: 'section', label: 'Faction Flags' },
      { path: 'settings.factionFlags.basePrice', label: 'Flag Base Price', type: 'number' },
      { path: 'settings.factionFlags.marketMultiplier', label: 'Flag Market Multiplier', type: 'number' },
      { path: 'settings.factionFlags.blockedFactions', label: 'Blocked Flag Factions', type: 'csvStrings' },
      { type: 'section', label: 'Weapon Cooldown Scaling' },
      { path: 'settings.weaponCooldowns.classFactorMin', label: 'Reload Factor Min', type: 'number', step: '0.01' },
      { path: 'settings.weaponCooldowns.classFactorMax', label: 'Reload Factor Max', type: 'number', step: '0.01' },
      { path: 'settings.weaponCooldowns.powerReductionCap', label: 'Power Reduction Cap', type: 'number', step: '0.01' },
      { path: 'settings.weaponCooldowns.typeFactors.default', label: 'Default Type Factor', type: 'number', step: '0.01' },
      { path: 'settings.weaponCooldowns.typeFactors.beam', label: 'Beam Type Factor', type: 'number', step: '0.01' },
      { path: 'settings.weaponCooldowns.typeFactors.cannon', label: 'Cannon Type Factor', type: 'number', step: '0.01' },
      { path: 'settings.weaponCooldowns.typeFactors.turret', label: 'Turret Type Factor', type: 'number', step: '0.01' },
      { path: 'settings.weaponCooldowns.typeFactors.torpedo', label: 'Torpedo Type Factor', type: 'number', step: '0.01' },
      { path: 'settings.weaponCooldowns.typeFactors.heavy', label: 'Heavy Type Factor', type: 'number', step: '0.01' },
      { type: 'section', label: 'Minimum Cooldowns' },
      { path: 'settings.weaponCooldowns.minimumsMs.default', label: 'Default Min Cooldown', type: 'number' },
      { path: 'settings.weaponCooldowns.minimumsMs.beam', label: 'Beam Min Cooldown', type: 'number' },
      { path: 'settings.weaponCooldowns.minimumsMs.cannon', label: 'Cannon Min Cooldown', type: 'number' },
      { path: 'settings.weaponCooldowns.minimumsMs.turret', label: 'Turret Min Cooldown', type: 'number' },
      { path: 'settings.weaponCooldowns.minimumsMs.torpedo', label: 'Torpedo Min Cooldown', type: 'number' },
      { path: 'settings.weaponCooldowns.minimumsMs.heavy', label: 'Heavy Min Cooldown', type: 'number' },
      { path: 'settings.weaponCooldowns.minimumsMs.device', label: 'Device Min Cooldown', type: 'number' },
      { type: 'section', label: 'Special Device Rules' },
      { path: 'settings.devices.cloak.durationMs', label: 'Cloak Duration (ms)', type: 'number' },
      { path: 'settings.devices.cloak.fadeMs', label: 'Cloak Fade (ms)', type: 'number' },
      { path: 'settings.devices.engineDisruptor.disableMs', label: 'Disruptor Disable (ms)', type: 'number' },
      { path: 'settings.devices.engineDisruptor.waveMs', label: 'Disruptor Wave (ms)', type: 'number' },
      { path: 'settings.devices.thaleronGenerator.cloudMs', label: 'Thaleron Cloud (ms)', type: 'number' },
      { path: 'settings.devices.tractorBeam.holdMs', label: 'Tractor Hold (ms)', type: 'number' },
      { path: 'settings.devices.tractorBeam.rangeGrace', label: 'Tractor Range Grace', type: 'number', step: '0.01' },
      { path: 'settings.devices.tractorBeam.towFactor', label: 'Tractor Tow Factor', type: 'number', step: '0.01' },
      { path: 'settings.devices.tractorBeam.anchorStrength', label: 'Tractor Anchor Strength', type: 'number', step: '0.01' },
      { path: 'settings.devices.tractorBeam.sourceHalfWidth', label: 'Tractor Source Width', type: 'number', step: '0.1' },
      { path: 'settings.devices.tractorBeam.targetHalfWidth', label: 'Tractor Target Width', type: 'number', step: '0.1' },
      { type: 'section', label: 'Trade Goods' },
      { path: 'tradeGoods', label: 'Trade Goods', type: 'lines', help: 'One trade good per line.' },
    ],
  },
  sizes: {
    label: 'Size Rules',
    file: 'ship_size_config.json',
    source: () => `data/ship_size_config.json?v=${SHIP_SIZE_CONFIG_VERSION}`,
    preview: 'rules',
    fields: [
      { path: 'classScales.shuttle', label: 'Shuttle Scale', type: 'number', step: '0.01' },
      { path: 'classScales.escort', label: 'Escort Scale', type: 'number', step: '0.01' },
      { path: 'classScales.lightCruiser', label: 'Light Cruiser Scale', type: 'number', step: '0.01' },
      { path: 'classScales.cruiser', label: 'Cruiser Scale', type: 'number', step: '0.01' },
      { path: 'classScales.capital', label: 'Capital Scale', type: 'number', step: '0.01' },
      { path: 'classScales.battleship', label: 'Battleship Scale', type: 'number', step: '0.01' },
      { path: 'classTurnRates.shuttle', label: 'Shuttle Turn Rate', type: 'number', step: '0.1' },
      { path: 'classTurnRates.escort', label: 'Escort Turn Rate', type: 'number', step: '0.1' },
      { path: 'classTurnRates.capital', label: 'Capital Turn Rate', type: 'number', step: '0.1' },
      { path: 'classTurnRates.battleship', label: 'Battleship Turn Rate', type: 'number', step: '0.1' },
    ],
  },
};

const factionUiThemes = {
  terran: 'terran',
  human: 'terran',
  federation: 'terran',
  klingon: 'klingon',
  romulan: 'romulan',
  ferengi: 'ferengi',
  cardassian: 'cardassian',
  dominion: 'dominion',
  breen: 'breen',
  tholian: 'tholian',
  vulcan: 'vulcan',
  sona: 'sona',
  delpin: 'delpin',
  tarellian: 'tarellian',
  promelli: 'promelli',
  pirate: 'pirate',
};
const factionUiThemeClasses = [...new Set(Object.values(factionUiThemes))].map((theme) => `ui-theme-${theme}`);

function getFactionUiTheme(faction = state.playerFaction) {
  return factionUiThemes[String(faction || '').toLowerCase()] || 'neutral';
}

function applyFactionUiTheme() {
  if (!document.body) return;
  document.body.classList.remove(...factionUiThemeClasses, 'ui-theme-neutral');
  if (!state.gameStarted) {
    document.body.removeAttribute('data-ui-faction');
    return;
  }
  const theme = getFactionUiTheme();
  document.body.classList.add(`ui-theme-${theme}`);
  document.body.dataset.uiFaction = theme;
}

function resizeCanvasDisplay() {
  canvas.style.width = '100vw';
  canvas.style.height = '100vh';
  canvas.width = Math.max(320, window.innerWidth);
  canvas.height = Math.max(220, window.innerHeight);
  if (interstellarMapCanvas) {
    interstellarMapCanvas.style.width = '100vw';
    interstellarMapCanvas.style.height = '100vh';
    interstellarMapCanvas.width = canvas.width;
    interstellarMapCanvas.height = canvas.height;
  }
  state.ship.x = canvas.width * 0.5;
  state.ship.y = canvas.height * 0.5;
}

window.addEventListener('resize', resizeCanvasDisplay);

let hudAutoHideTimer = null;
let lastTargetWindowRenderAt = 0;
let targetWindowForceRender = false;
let targetWindowInteractionLockUntil = 0;
let lastTargetWindowActionAt = 0;
function openHudTemporarily(ms = 1800) {
  if (!hudEl) return;
  hudEl.classList.add('hud-open');
  if (hudAutoHideTimer) clearTimeout(hudAutoHideTimer);
  hudAutoHideTimer = setTimeout(() => {
    hudEl.classList.remove('hud-open');
  }, ms);
}

window.addEventListener('mousemove', (e) => {
  if (e.clientY >= window.innerHeight - 56) openHudTemporarily(2200);
});
window.addEventListener('wheel', (e) => {
  if (e.deltaY < 0 || e.clientY >= window.innerHeight - 72) openHudTemporarily(2200);
}, { passive: true });
window.addEventListener('touchstart', (e) => {
  const t = e.touches?.[0];
  if (t && t.clientY >= window.innerHeight - 72) openHudTemporarily(2400);
}, { passive: true });

function seeded(n) {
  let x = Math.sin(n * 999.91) * 10000;
  return x - Math.floor(x);
}

function hashString(value = '') {
  let hash = 0;
  const text = String(value);
  for (let i = 0; i < text.length; i++) {
    hash = ((hash << 5) - hash + text.charCodeAt(i)) | 0;
  }
  return hash;
}

function pickSeededPoolItem(pool = [], seedValue = 1, salt = 'pool') {
  if (!pool.length) return null;
  let selected = pool[0];
  let selectedScore = Infinity;
  for (const item of pool) {
    const key = typeof item === 'object'
      ? item.id ?? item.name ?? JSON.stringify(item)
      : item;
    const score = seeded(hashString(`${salt}:${seedValue}:${key}`));
    if (score < selectedScore) {
      selected = item;
      selectedScore = score;
    }
  }
  return selected;
}

function getCurrentSystemName(systemIndex = state.currentPlanet) {
  return String(state.planets?.[systemIndex]?.name || '').trim();
}

function getConfiguredPurchaseTierThresholds() {
  const configured = state.shipPurchaseTierThresholds;
  return { ...PURCHASE_TIER_STANDING, ...(configured && typeof configured === 'object' ? configured : {}) };
}

function getTradeStandingFaction(systemIndex = state.currentPlanet, station = null) {
  const control = getSystemControl(systemIndex);
  const side = station ? getStationOwner(station, systemIndex) : control.controller;
  if (side === PLAYER_SIDE) return control.origin === 'neutral' || isRecognizedFactionKey(control.origin) ? control.origin : null;
  if (String(side || '').startsWith('private:')) return 'neutral';
  return side === 'neutral' || isRecognizedFactionKey(side) ? side : null;
}

function getCurrentPurchaseVendor(station = getCurrentDockedStation()) {
  const stationStats = station ? getShipStats(station.stationTypeId) : null;
  return {
    systemName: getCurrentSystemName(),
    stationName: String(station?.name || stationStats?.name || ''),
    vendor: station?.shipVendor || null,
  };
}

function getCatalogSpawnContext(role = 'traffic', systemIndex = state.currentPlanet) {
  const authorized = role === 'fleetAttack' || role === 'mission';
  return buildSpawnContext({
    systemName: getCurrentSystemName(systemIndex),
    role,
    authorizedDeployment: authorized,
    controller: getSystemControl(systemIndex).controller,
  });
}

function pickCatalogSpawnId(role, faction, seedValue, systemIndex = state.currentPlanet) {
  const catalog = state.shipCatalog;
  if (!catalog) return null;
  const pool = pickSpawnShip(catalog, getCatalogSpawnContext(role, systemIndex), faction ?? null);
  // Empty legal pools stay empty. Never fall back to a forbidden hull.
  return pickSeededSpawnId(pool, seedValue, `catalog-spawn:${role}:${faction || '*'}`, pickSeededPoolItem);
}

function getNpcShipId(seedValue, role = 'traffic') {
  if (state.shipCatalog) return pickCatalogSpawnId(role, null, seedValue);
  const pool = state.npcShipIds?.length ? state.npcShipIds : FALLBACK_NPC_SHIP_IDS;
  return pickSeededPoolItem(pool, seedValue, 'npc-any-ship') || pool[0];
}

function getNpcShipIdForFaction(faction = 'neutral', seedValue = 1, role = 'patrol') {
  if (state.shipCatalog) return pickCatalogSpawnId(role, faction, seedValue);
  const pool = state.npcShipIds?.length ? state.npcShipIds : FALLBACK_NPC_SHIP_IDS;
  const exact = pool.filter((id) => getShipFaction(id) === faction);
  const aligned = exact.length ? exact : pool.filter((id) => areFactionsAligned(getShipFaction(id), faction));
  const candidates = aligned.length ? aligned : pool;
  return pickSeededPoolItem(candidates, seedValue, `npc-faction-ship:${faction}`) || candidates[0];
}

const factionShipNamePrefixes = {
  terran: 'ISS',
  vulcan: 'VSS',
  romulan: 'RIS',
  cardassian: 'CDS',
  klingon: 'IKS',
  dominion: 'DVS',
  breen: 'BWS',
  ferengi: 'FMS',
  tholian: 'TAS',
  sona: 'SCS',
  delpin: 'DCS',
  tarellian: 'TSS',
  promelli: 'PCS',
  andorian: 'AGS',
  gorn: 'GCS',
  hirogen: 'HHS',
  suliban: 'SHS',
  borg: 'Borg',
  pirate: 'Raider',
  neutral: 'SS',
};

const fallbackShipNameRoots = [
  'Aegis', 'Agamemnon', 'Akagi', 'Aldebaran', 'Archer', 'Argonaut', 'Bellerophon',
  'Centaur', 'Challenger', 'Concord', 'Dauntless', 'Endeavour', 'Exeter', 'Fearless',
  'Horizon', 'Intrepid', 'Majestic', 'Meridian', 'Odyssey', 'Reliant', 'Resolute',
  'Saratoga', 'Sentinel', 'Triumph', 'Valiant', 'Venture', 'Victory', 'Voyager',
  'Courageous', 'Enduring', 'Fidelity', 'Fortitude', 'Heritage', 'Invictus',
  'Liberty', 'Pathfinder', 'Pioneer', 'Protector', 'Ranger', 'Stalwart',
];

const factionShipNameRoots = {
  terran: ['Avenger', 'Conqueror', 'Defiant', 'Empress', 'Executor', 'Imperator', 'Praetorian', 'Tyrant', 'Vengeance', 'Iron Will', 'Dominance', 'Black Banner'],
  vulcan: ['Dkir', 'Kolinahr', 'Seleya', 'Shirkar', 'Surak', 'Vokaya', 'T Plana', 'T Pau', 'Logic', 'Kal If Fee', 'T Kon', 'Soval'],
  romulan: ['Aelahl', 'Dhael', 'D Vex', 'Narviat', 'Sienae', 'T Met', 'Vorta Vor', 'Neral', 'Tal Shiar', 'Sela', 'Praetor', 'Shadow Wing'],
  cardassian: ['Damar', 'Dukat', 'Keldon', 'Obsidian', 'Oralian', 'Tarlak', 'Terok', 'Central Command', 'Legate', 'Kanril', 'Rakal', 'Vigilance'],
  klingon: ['Gorkon', 'Gowron', 'Kahless', 'Martok', 'Qapla', 'Rotarran', 'Blood Oath', 'Duras', 'Sword of Honor', 'Vor Kang', 'Kargan', 'Fire Blade'],
  dominion: ['Founders Watch', 'Jem Hadar', 'Relay', 'Vorta', 'White', 'Yadera', 'Order', 'Victory Is Life', 'Gamma Spear', 'First Clutch', 'Kar Takin', 'Obedience'],
  breen: ['Cold Star', 'Gorath', 'Ice Fang', 'Mask', 'Rime', 'Thot', 'Winter', 'Zero Signal', 'Frost Line', 'Silent Helm', 'Frozen Debt', 'Pale Wake'],
  ferengi: ['Acquisition', 'Brunt', 'Contract', 'Dividend', 'Grand Nagus', 'Ledger', 'Profit', 'Rule 34', 'Margin', 'Opportunity', 'Risk Premium', 'Golden Clause'],
  tholian: ['Crystal', 'Facet', 'Lattice', 'Prism', 'Tholia', 'Webspinner'],
  sona: ['Briar', 'Goralis', 'Iritum', 'Sonata', 'Subspace', 'Violet Wake'],
  delpin: ['Blue Wake', 'Delpi', 'Deep Current', 'Foamrunner', 'Pearl', 'Undertow'],
  tarellian: ['Flux', 'Long Reach', 'Quantum Drift', 'Tarellia', 'Wayfinder'],
  promelli: ['Ancient Signal', 'Bioforge', 'Drift', 'Promelus', 'Vortex'],
  andorian: ['Aenar Watch', 'Blue Guard', 'Ice Spear', 'Kethni', 'Kumari', 'Thaan', 'Ushaan', 'White Ridge'],
  gorn: ['Claw', 'Cold Blood', 'Fang', 'Hegemony', 'Molt', 'Scale Guard', 'Sskath', 'Talon'],
  hirogen: ['Alpha Trophy', 'Blood Track', 'Deep Quarry', 'Hunter Prime', 'Long Pursuit', 'Prey Mark', 'Relic Spear', 'Trophy Wake'],
  suliban: ['Broken Cell', 'Helix', 'Listening Post', 'Quiet Vector', 'Shadow Coil', 'Suliban Drift', 'Unseen Hand', 'Viral Path'],
  borg: ['Collective', 'Unimatrix', 'Assimilator', 'Conduit', 'Node'],
  pirate: ['Black Ledger', 'Corsair', 'Cutpurse', 'Freeblade', 'Haven', 'Last Chance'],
  neutral: ['Beacon', 'Free Trader', 'Long Haul', 'Meridian', 'Prospect', 'Wayfarer'],
};

function cleanShipNameRoot(name = '') {
  return String(name)
    .replace(/\s+/g, ' ')
    .replace(/[^A-Za-z0-9' -]/g, '')
    .trim();
}

function getShipNameRootsForFaction(faction = 'neutral') {
  const factionRoots = factionShipNameRoots[faction];
  if (faction === 'neutral' || !factionRoots?.length) {
    return [
      ...(factionRoots || []),
      ...fallbackShipNameRoots,
    ];
  }
  return factionRoots;
}

function getShipNameRootFromDisplayName(name = '') {
  const text = cleanShipNameRoot(name);
  if (!text) return '';
  const prefixPattern = Object.values(factionShipNamePrefixes)
    .filter((prefix) => prefix !== 'Raider')
    .map((prefix) => prefix.toLowerCase())
    .join('|');
  return text
    .replace(new RegExp(`^(${prefixPattern})\\s+`, 'i'), '')
    .replace(/\s+raider$/i, '')
    .trim();
}

function isSystemDerivedShipName(name = '') {
  const withoutPrefix = getShipNameRootFromDisplayName(name).toLowerCase();
  if (!withoutPrefix) return false;
  return (state.planets || []).some((planet) => cleanShipNameRoot(planet.name).toLowerCase() === withoutPrefix);
}

function isCrossFactionShipName(name = '', faction = 'neutral') {
  if (!name || faction === 'neutral') return false;
  const expectedPrefix = factionShipNamePrefixes[faction] || factionShipNamePrefixes.neutral;
  const normalized = cleanShipNameRoot(name).toLowerCase();
  if (expectedPrefix === 'Raider') {
    if (!normalized.endsWith(' raider')) return true;
  } else if (!normalized.startsWith(`${expectedPrefix.toLowerCase()} `)) {
    return true;
  }
  const root = getShipNameRootFromDisplayName(name).toLowerCase();
  const allowedRoots = new Set(getShipNameRootsForFaction(faction).map((entry) => cleanShipNameRoot(entry).toLowerCase()));
  return Boolean(root) && !allowedRoots.has(root);
}

function generateShipName({ shipId = 0, faction = 'neutral', seed = 1, role = 'traffic', id = '' } = {}) {
  const normalizedFaction = factionShipNamePrefixes[faction] ? faction : getShipFaction(shipId);
  const roots = getShipNameRootsForFaction(normalizedFaction);
  const seedValue = hashString(`${normalizedFaction}:${shipId}:${seed}:${role}:${id}`);
  const root = roots[Math.floor(seeded(seedValue || 1) * roots.length) % roots.length] || getShipStats(shipId).name || 'Vessel';
  const prefix = factionShipNamePrefixes[normalizedFaction] || factionShipNamePrefixes.neutral;
  if (prefix === 'Raider') return `${root} ${prefix}`;
  return `${prefix} ${root}`;
}

function getShipDisplayName(ship) {
  if (!ship) return 'Ship';
  return ship.displayName || ship.name || generateShipName({
    shipId: ship.shipId,
    faction: ship.faction || getShipFaction(ship.shipId),
    seed: ship.seed || hashString(ship.id || ship.shipId || 'ship'),
    role: ship.role || 'traffic',
    id: ship.id || '',
  });
}

function createNpcShip({
  id,
  shipId,
  faction = 'neutral',
  attitude = 'neutral',
  hostile = false,
  seed = 1,
  from = null,
  destination = null,
  destinationName = 'patrol',
  role = 'traffic',
  fleetId = null,
  attackId = null,
  name = null,
  sideId = null,
  crewSkill = null,
  crewTemperament = null,
  ew = undefined, sensors = null, broadcastSource = null, broadcastFaction = null,
} = {}) {
  const spawn = from || {
    x: state.systemStar.x + (seeded(seed + 1) - 0.5) * 1400,
    y: state.systemStar.y + (seeded(seed + 2) - 0.5) * 1000,
  };
  const target = destination || {
    x: state.systemPlanet.x + (seeded(seed + 3) - 0.5) * 520,
    y: state.systemPlanet.y + (seeded(seed + 4) - 0.5) * 420,
  };
  shipId = resolveShipId(shipId);
  const flight = getNpcFlightProfile(shipId, seed);
  return {
    id,
    x: spawn.x,
    y: spawn.y,
    destination: { ...target },
    destinationName,
    waitUntil: 0,
    heading: seeded(seed + 6) * 360,
    speed: flight.speed,
    turnRate: flight.turnRate,
    systemWarpIntensity: 0,
    systemWarpMultiplier: flight.systemWarpMultiplier,
    seed,
    leg: 0,
    shipId: Number(shipId),
    faction,
    name: name || generateShipName({ shipId, faction, seed, role, id }),
    attitude,
    hostile: Boolean(hostile),
    combatHull: null,
    maxCombatHull: null,
    combatShields: null,
    maxCombatShields: null,
    lastShieldHitAt: 0,
    lastShotAt: performance.now() + 700 + seeded(seed + 13) * 1500,
    destroyed: false,
    scale: getNpcSpriteScale(shipId, seed + 11),
    role,
    fleetId,
    attackId,
    sideId: sideId || deriveNpcSideId(faction, id),
    ...assignPowerCrew({ seed, faction, role, crewSkill, crewTemperament }),
    sensors: ensureSensorEquipment(sensors, defaultTransponder({ faction, side: sideId || faction, role, broadcastSource, broadcastFaction, command: role === "playerEscort" || role === "playerFleet", flag: getPlayerFlag() })),
    ew: ew === undefined ? rollEW({seed,role,faction,major:isRecognizedFactionKey(faction)&&!['neutral','pirate','borg'].includes(faction),command:!!fleetId||role==='playerEscort'||role==='playerFleet'}) : sanitizeEW(ew),
    broadcastSource, broadcastFaction,
    identityLocked: true, // an explicitly constructed ship is never re-fitted on restoration
  };
}

function getTrafficScaleMultiplier(seedValue) {
  const variance = state.shipSizeConfig?.trafficScaleVariance || DEFAULT_SHIP_SIZE_CONFIG.trafficScaleVariance;
  const min = finiteNumber(variance.min, DEFAULT_SHIP_SIZE_CONFIG.trafficScaleVariance.min);
  const max = finiteNumber(variance.max, DEFAULT_SHIP_SIZE_CONFIG.trafficScaleVariance.max);
  return min + seeded(seedValue) * Math.max(0, max - min);
}

function getSystemOrbit(row, base) {
  const mapX = Number(row?.[23]);
  const mapY = Number(row?.[24]);
  const surfaceType = Number(row?.[4] || 1);
  const market = Number(row?.[6] || 0);
  const planetScale = Number(row?.[8] || 50);
  const population = Number(row?.[2] || 0);
  const hasMapVector = Number.isFinite(mapX) && Number.isFinite(mapY) && (mapX !== 0 || mapY !== 0);
  const angle = hasMapVector
    ? Math.atan2(mapY, mapX)
    : seeded(base + 25) * Math.PI * 2;
  const scaleInfluence = Math.max(0, Math.min(220, (100 - planetScale) * 2.2));
  const populationInfluence = population <= 0 ? 180 : Math.max(0, Math.min(180, Math.log10(population + 1) * 28));
  const typeInfluence = ((surfaceType * 37 + market * 19 + base * 11) % 260);
  return {
    angle,
    distance: 780 + seeded(base + 26) * 460 + scaleInfluence + populationInfluence + typeInfluence,
  };
}

function getGeneratedBodyColor(base, surfaceType, alpha = 0.9) {
  const hue = Math.round((base * 37 + surfaceType * 19) % 360);
  const saturation = 44 + Math.round(seeded(base * 17 + surfaceType) * 26);
  const lightness = 42 + Math.round(seeded(base * 23 + surfaceType) * 24);
  return `hsla(${hue}, ${saturation}%, ${lightness}%, ${alpha})`;
}

function pickFixedPlanetSurfaceType(pool, systemIndex, slot, offset = 0) {
  return pool[(systemIndex * 5 + slot * 3 + offset) % pool.length] || 2;
}

function getPlanetMassFactor(planet = state.planets[state.currentPlanet], drawSize = null) {
  const size = finiteNumber(drawSize, getPlanetVisualSize(planet));
  const scale = clamp(finiteNumber(planet?.planetScale, 50), 20, 100);
  return Math.max(0.35, Math.pow(size / 170, 2) * (0.72 + scale / 120));
}

function getStationMassFactor(station = {}) {
  const stats = getShipStats(station.stationTypeId);
  const defenseMass = Math.max(1, finiteNumber(stats.hull, 50) + finiteNumber(stats.shields, 50));
  const visual = getStationVisualProfile(station);
  return Math.max(0.35, Math.log10(defenseMass + 25) * 0.5 + visual.scale * 0.32);
}

function getPlanetLocalOrbitCaptureDistance(planet = state.planets[state.currentPlanet], object = {}) {
  const visualSize = getPlanetVisualSize(planet);
  const objectRadius = object.assetType === 'station' || object.stationTypeId
    ? getStationScreenRadius(object) * 0.45
    : finiteNumber(object.drawSize, 0) * 0.5;
  return clamp(PLANET_LOCAL_ORBIT_CAPTURE_DISTANCE + visualSize * 0.32 + objectRadius * 0.55, 340, 620);
}

function isInsidePlanetLocalOrbit(point, planetPoint, planet, object = {}) {
  if (!point || !planetPoint) return false;
  const distance = Math.hypot(point.x - planetPoint.x, point.y - planetPoint.y);
  return distance <= getPlanetLocalOrbitCaptureDistance(planet, object);
}

function getOrbitPeriodMs(distance, anchorMass = 1, seedValue = 1, kind = 'planet') {
  const base = kind === 'moon' ? MOON_ORBIT_BASE_MS : kind === 'station' ? STATION_ORBIT_BASE_MS : PLANET_ORBIT_BASE_MS;
  const reference = kind === 'moon' ? 170 : kind === 'station' ? 360 : 900;
  const distanceFactor = Math.pow(Math.max(0.28, finiteNumber(distance, reference) / reference), 1.45);
  const massFactor = Math.sqrt(Math.max(0.45, anchorMass));
  const variance = 0.82 + seeded(seedValue) * 0.36;
  const minPeriod = kind === 'moon' ? 42000 : 260000;
  const maxPeriod = kind === 'moon' ? 520000 : 5400000;
  return Math.round(clamp(base * distanceFactor * variance / massFactor, minPeriod, maxPeriod));
}

function getOrbitalPosition(anchor, orbit, now = performance.now()) {
  if (!anchor || !orbit) return null;
  const period = Math.max(1000, finiteNumber(orbit.orbitPeriod, PLANET_ORBIT_BASE_MS));
  const direction = finiteNumber(orbit.orbitDirection, 1) >= 0 ? 1 : -1;
  const angle = finiteNumber(orbit.orbitAngle, 0) + (now / period) * Math.PI * 2 * direction;
  const distance = finiteNumber(orbit.orbitDistance, 0);
  return {
    x: anchor.x + Math.cos(angle) * distance,
    y: anchor.y + Math.sin(angle) * distance,
    orbitAngleCurrent: angle,
  };
}

function hasExplicitStationOrbit(station = {}) {
  return (station.orbitAnchor === 'planet' || station.orbitAnchor === 'star')
    && Number.isFinite(Number(station.orbitDistance))
    && Number.isFinite(Number(station.orbitAngle));
}

function getStationDefinitionWorldPoint(station, star, planet, now = performance.now()) {
  if (hasExplicitStationOrbit(station)) {
    const anchor = station.orbitAnchor === 'planet' ? planet : star;
    const position = getOrbitalPosition(anchor, station, now);
    if (position) return { x: position.x, y: position.y };
  }
  return {
    x: planet.x + finiteNumber(station.offsetX, 0),
    y: planet.y + finiteNumber(station.offsetY, 0),
  };
}

function withStationOrbit(station, star, planet, base, index = 0) {
  const planetMass = getPlanetMassFactor(state.planets[station.systemIndex] || state.planets[state.currentPlanet]);
  const planetDef = state.planets[station.systemIndex] || state.planets[state.currentPlanet];
  const explicitOrbit = hasExplicitStationOrbit(station);
  const planetDistance = Math.hypot(station.x - planet.x, station.y - planet.y);
  const starDistance = Math.hypot(station.x - star.x, station.y - star.y);
  const captureDistance = getPlanetLocalOrbitCaptureDistance(planetDef, station);
  const anchor = explicitOrbit ? station.orbitAnchor : planetDistance <= captureDistance || planetDistance < starDistance * 0.32 ? 'planet' : 'star';
  const anchorPoint = anchor === 'planet' ? planet : star;
  const distance = explicitOrbit
    ? Math.max(anchor === 'planet' ? 115 : 430, finiteNumber(station.orbitDistance, 0))
    : Math.max(anchor === 'planet' ? 115 : 430, Math.hypot(station.x - anchorPoint.x, station.y - anchorPoint.y));
  const angle = explicitOrbit
    ? finiteNumber(station.orbitAngle, 0)
    : Math.atan2(station.y - anchorPoint.y, station.x - anchorPoint.x);
  const anchorMass = anchor === 'planet' ? planetMass : 16;
  const fallbackDirection = seeded(base * 263 + index) > 0.5 ? 1 : -1;
  return {
    ...station,
    orbitAnchor: anchor,
    orbitDistance: distance,
    orbitAngle: angle,
    orbitPeriod: Math.max(1000, finiteNumber(station.orbitPeriod, getOrbitPeriodMs(distance, anchorMass, base * 257 + index * 17, 'station'))),
    orbitDirection: finiteNumber(station.orbitDirection, fallbackDirection) >= 0 ? 1 : -1,
  };
}

function getTrafficDestinations(stations, planet, star, wormhole, base = 1) {
  const activeStations = (Array.isArray(stations) ? stations : [stations])
    .filter((station) => station && !station.destroyed && !station.underConstruction);
  const laneAngle = Math.atan2(planet.y - star.y, planet.x - star.x);
  const point = (x, y) => ({
    x: clamp(x, 130, SYSTEM_W - 130),
    y: clamp(y, 130, SYSTEM_H - 130),
  });
  const destinations = [
    { name: 'planet transfer', point: point(planet.x + Math.cos(laneAngle + Math.PI / 2) * 430, planet.y + Math.sin(laneAngle + Math.PI / 2) * 430), spread: 160 },
    { name: 'outer orbital lane', point: point(planet.x + Math.cos(laneAngle + Math.PI) * (640 + seeded(base + 21) * 240), planet.y + Math.sin(laneAngle + Math.PI) * (640 + seeded(base + 21) * 240)), spread: 190 },
    { name: 'inner beacon', point: point(star.x + Math.cos(laneAngle) * 420, star.y + Math.sin(laneAngle) * 420), spread: 130 },
    { name: 'solar transfer north', point: point(star.x + Math.cos(laneAngle + Math.PI / 2) * 760, star.y + Math.sin(laneAngle + Math.PI / 2) * 760), spread: 210 },
    { name: 'solar transfer south', point: point(star.x + Math.cos(laneAngle - Math.PI / 2) * 760, star.y + Math.sin(laneAngle - Math.PI / 2) * 760), spread: 210 },
    { name: 'deep-space inbound', point: point(star.x + Math.cos(laneAngle + 2.35) * 1240, star.y + Math.sin(laneAngle + 2.35) * 1240), spread: 250 },
    { name: 'deep-space outbound', point: point(star.x + Math.cos(laneAngle - 2.15) * 1240, star.y + Math.sin(laneAngle - 2.15) * 1240), spread: 250 },
  ];
  activeStations.forEach((station, index) => {
    const approachAngle = seeded(base * 41 + index * 17) * Math.PI * 2;
    const approachDistance = 190 + seeded(base * 43 + index * 19) * 150;
    destinations.push({
      name: `${station.name || 'station'} approach`,
      point: point(
        station.x + Math.cos(approachAngle) * approachDistance,
        station.y + Math.sin(approachAngle) * approachDistance,
      ),
      spread: 115,
    });
  });
  if (wormhole) destinations.push({ name: 'wormhole approach', point: point(wormhole.x + 180, wormhole.y + 120), spread: 130 });
  return destinations;
}

function getSystemTrafficCount(stations = [], base = 1) {
  const activeStations = stations.filter((station) => !station.destroyed && !station.underConstruction).length;
  const baselineTraffic = 3;
  const stationTraffic = Math.min(16, Math.max(0, activeStations - 1));
  const variation = Math.floor(seeded(base + 15) * 2);
  return Math.min(20, baselineTraffic + stationTraffic + variation);
}

function getStationDefinitionFaction(systemIndex, stationTypeId, name = '') {
  const normalizedName = String(name || '').trim().toLowerCase();
  if (systemIndex === 5 && normalizedName === 'free swiss exchange') return 'neutral';
  return null;
}

function parseLegacyStationText(text = '') {
  const fields = text.replace(/\r?\n/g, '').split(',').map((field) => field.trim());
  const stations = [];
  for (let i = 0; i + 13 < fields.length; i += 14) {
    const systemIndex = Math.round(finiteNumber(fields[i], 0)) - 1;
    const stationTypeId = Math.round(finiteNumber(fields[i + 1], 0));
    const condition = clamp(finiteNumber(fields[i + 2], 100), 0, 100);
    const offsetX = finiteNumber(fields[i + 3], 0);
    const offsetY = finiteNumber(fields[i + 4], 0);
    const rotation = finiteNumber(fields[i + 6], 0);
    const rawStockIds = fields.slice(i + 7, i + 13)
      .map((value) => Math.round(finiteNumber(value, 0)))
      .filter((value) => value > 0 && value !== 100);
    const stockIds = rawStockIds.filter((value) => value < 100);
    const weaponStockIds = rawStockIds
      .filter((value) => value >= 106)
      .map((value) => value - 105)
      .filter((value) => hasWeaponDefinition(value));
    const name = fields[i + 13] || `Station ${stations.length + 1}`;
    if (systemIndex < 0 || !stationTypeId || !name) continue;
    const faction = getStationDefinitionFaction(systemIndex, stationTypeId, name);
    stations.push({
      id: `${systemIndex}-${stations.length}`,
      systemIndex,
      stationTypeId,
      ...(faction ? { faction } : {}),
      condition,
      offsetX,
      offsetY,
      rotation,
      rawStockIds,
      stockIds,
      weaponStockIds,
      name,
    });
  }
  return stations;
}

function normalizeExplicitShipStockIds(stock = {}) {
  return (stock.shipIds || stock.stockIds || [])
    .map((value) => Math.round(finiteNumber(value, 0)))
    .filter((value, index, arr) => value > 0 && arr.indexOf(value) === index);
}

function normalizeExplicitWeaponStockIds(stock = {}) {
  return (stock.weaponIds || [])
    .map((value) => Math.round(finiteNumber(value, 0)))
    .filter((value, index, arr) => value > 0 && arr.indexOf(value) === index);
}

function normalizeStockIds(stock = {}) {
  const shipIds = normalizeExplicitShipStockIds(stock);
  const weaponIds = normalizeExplicitWeaponStockIds(stock);
  if (shipIds.length || weaponIds.length) {
    return [
      ...shipIds,
      ...weaponIds.map((weaponId) => weaponId + 105),
    ];
  }
  return (stock.rawIds || [])
    .map((value) => Math.round(finiteNumber(value, 0)))
    .filter((value) => value > 0 && value !== 100);
}

function parseStationData(data = {}) {
  if (typeof data === 'string') return parseLegacyStationText(data);
  const entries = Array.isArray(data) ? data : data.stations || [];
  return entries
    .map((station, index) => {
      const systemIndex = Number.isFinite(Number(station.systemIndex))
        ? Math.round(Number(station.systemIndex))
        : Math.round(finiteNumber(station.systemNumber, 0)) - 1;
      const stationTypeId = Math.round(finiteNumber(station.stationTypeId, 0));
      const condition = clamp(finiteNumber(station.condition, 100), 0, 100);
      const offsetX = finiteNumber(station.offset?.x ?? station.offsetX, 0);
      const offsetY = finiteNumber(station.offset?.y ?? station.offsetY, 0);
      const rotation = finiteNumber(station.rotation, 0);
      const drawWidth = finiteNumber(station.drawWidth, NaN);
      const drawHeight = finiteNumber(station.drawHeight, NaN);
      const drawScale = finiteNumber(station.drawScale ?? station.scale, NaN);
      const visualMaxSize = finiteNumber(station.visualMaxSize, NaN);
      const visualOverrides = {
        ...(Number.isFinite(drawWidth) && drawWidth > 0 ? { drawWidth } : {}),
        ...(Number.isFinite(drawHeight) && drawHeight > 0 ? { drawHeight } : {}),
        ...(Number.isFinite(drawScale) && drawScale > 0 ? { drawScale } : {}),
      };
      const stockSource = station.stock || station;
      const rawStockIds = normalizeStockIds(stockSource);
      const hasExplicitShipIds = Array.isArray(stockSource.shipIds) || Array.isArray(stockSource.stockIds);
      const hasExplicitWeaponIds = Array.isArray(stockSource.weaponIds);
      const stockIds = hasExplicitShipIds ? normalizeExplicitShipStockIds(stockSource) : rawStockIds.filter((value) => value < 100);
      const weaponStockIds = (hasExplicitWeaponIds
        ? normalizeExplicitWeaponStockIds(stockSource)
        : rawStockIds
          .filter((value) => value >= 106)
          .map((value) => value - 105))
        .filter((value) => hasWeaponDefinition(value));
      const name = station.name || `Station ${index + 1}`;
      if (systemIndex < 0 || !stationTypeId || !name) return null;
      const faction = station.faction || getStationDefinitionFaction(systemIndex, stationTypeId, name);
      return {
        id: station.id || `${systemIndex}-${index}`,
        systemIndex,
        stationTypeId,
        ...(faction ? { faction } : {}),
        condition,
        offsetX,
        offsetY,
        rotation,
        ...(Number.isFinite(drawWidth) && drawWidth > 0 ? { drawWidth } : {}),
        ...(Number.isFinite(drawHeight) && drawHeight > 0 ? { drawHeight } : {}),
        ...(Number.isFinite(drawScale) && drawScale > 0 ? { drawScale } : {}),
        ...(Object.keys(visualOverrides).length ? { visualOverrides } : {}),
        ...(Number.isFinite(visualMaxSize) && visualMaxSize > 0 ? { visualMaxSize } : {}),
        rawStockIds,
        stockIds,
        weaponStockIds,
        shipVendor: station.shipVendor || null,
        name,
      };
    })
    .filter(Boolean);
}

function pickTrafficDestination(destinations, seedValue, avoidName = '') {
  const candidates = destinations.filter((dest) => dest.name !== avoidName);
  const pool = candidates.length ? candidates : destinations;
  const destination = pool[Math.floor(seeded(seedValue) * pool.length) % pool.length];
  const scatterAngle = seeded(seedValue + 811) * Math.PI * 2;
  const scatterDistance = Math.sqrt(seeded(seedValue + 829)) * finiteNumber(destination.spread, 90);
  return {
    ...destination,
    point: {
      x: clamp(destination.point.x + Math.cos(scatterAngle) * scatterDistance, 100, SYSTEM_W - 100),
      y: clamp(destination.point.y + Math.sin(scatterAngle) * scatterDistance, 100, SYSTEM_H - 100),
    },
  };
}

function routeKey(a, b) {
  return a < b ? `${a}:${b}` : `${b}:${a}`;
}

function getConventionalRouteRegion(planet) {
  const name = String(planet?.name || '').trim().toLowerCase();
  return WORMHOLE_ISOLATED_SYSTEM_NAMES.has(name) ? 'dominion-wormhole-space' : 'primary-space';
}

function canBuildConventionalRoute(planets, from, to) {
  return getConventionalRouteRegion(planets[from]) === getConventionalRouteRegion(planets[to]);
}

function getSystemIndexByName(name) {
  const needle = String(name || '').trim().toLowerCase();
  if (!needle) return -1;
  return state.planets.findIndex((planet) => String(planet?.name || '').trim().toLowerCase() === needle);
}

function normalizeWormholeLink(link) {
  const from = Number(link?.from);
  const to = Number(link?.to);
  if (!Number.isFinite(from) || !Number.isFinite(to) || from === to) return null;
  if (!state.planets[from] || !state.planets[to]) return null;
  const builtByPlayer = Boolean(link.builtByPlayer);
  const fallbackName = builtByPlayer
    ? `${state.planets[from].name} Wormhole`
    : 'Bajoran Wormhole';
  return {
    id: String(link.id || `${from}-${to}-wormhole`),
    from,
    to,
    name: String(link.name || fallbackName),
    faction: link.faction || (builtByPlayer ? state.playerFaction : 'neutral'),
    builtByPlayer,
  };
}

function getFixedWormholeLinks() {
  const from = getSystemIndexByName(WORMHOLE_ORIGIN_SYSTEM_NAME);
  const to = getSystemIndexByName(WORMHOLE_DOMINION_SYSTEM_NAME);
  const link = normalizeWormholeLink({
    id: 'bajora-dominica-wormhole',
    from,
    to,
    name: 'Bajoran Wormhole',
    builtByPlayer: false,
    faction: 'neutral',
  });
  return link ? [link] : [];
}

function getPlayerWormholeLinks() {
  return (state.playerWormholes || [])
    .map(normalizeWormholeLink)
    .filter(Boolean);
}

function getAllWormholeLinks() {
  const seen = new Set();
  return [...getFixedWormholeLinks(), ...getPlayerWormholeLinks()].filter((link) => {
    const key = routeKey(link.from, link.to);
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function getSystemWormholeLinks(systemIndex = state.currentPlanet) {
  const index = Number(systemIndex);
  if (!Number.isFinite(index)) return [];
  return getAllWormholeLinks().filter((link) => link.from === index || link.to === index);
}

function getWormholeDestinationIndex(link, systemIndex = state.currentPlanet) {
  if (!link) return null;
  if (Number(link.from) === Number(systemIndex)) return Number(link.to);
  if (Number(link.to) === Number(systemIndex)) return Number(link.from);
  return null;
}

function createSystemWormhole(link, systemIndex, star, orbit) {
  const destinationIndex = getWormholeDestinationIndex(link, systemIndex);
  if (destinationIndex === null || !state.planets[destinationIndex]) return null;
  const base = systemIndex + 1;
  const variation = (seeded(base * 401 + destinationIndex * 17) - 0.5) * 0.22;
  const angle = orbit.angle + Math.PI + variation;
  const distance = orbit.distance + 680 + (link.builtByPlayer ? seeded(base * 409 + destinationIndex) * 90 : 0);
  return {
    ...link,
    linkId: link.id,
    targetIndex: destinationIndex,
    x: star.x + Math.cos(angle) * distance,
    y: star.y + Math.sin(angle) * distance,
  };
}

function buildTravelRoutes(planets = state.planets) {
  const routes = [];
  const seen = new Set();
  const addRoute = (from, to, type = 'lane', extra = {}) => {
    if (from < 0 || to < 0 || from >= planets.length || to >= planets.length || from === to) return;
    const key = routeKey(from, to);
    if (seen.has(key)) return;
    seen.add(key);
    const a = planets[from];
    const b = planets[to];
    routes.push({
      from,
      to,
      type,
      distance: Math.max(1, Math.round(Math.hypot(a.x - b.x, a.y - b.y))),
      ...extra,
    });
  };

  const pairs = [];
  for (let i = 0; i < planets.length; i++) {
    for (let j = i + 1; j < planets.length; j++) {
      if (!canBuildConventionalRoute(planets, i, j)) continue;
      pairs.push({
        from: i,
        to: j,
        distance: Math.hypot(planets[i].x - planets[j].x, planets[i].y - planets[j].y),
      });
    }
  }
  pairs.sort((a, b) => a.distance - b.distance);

  const parent = Array.from({ length: planets.length }, (_, i) => i);
  const find = (i) => {
    while (parent[i] !== i) {
      parent[i] = parent[parent[i]];
      i = parent[i];
    }
    return i;
  };
  const unite = (a, b) => {
    const pa = find(a);
    const pb = find(b);
    if (pa === pb) return false;
    parent[pb] = pa;
    return true;
  };

  for (const pair of pairs) {
    if (unite(pair.from, pair.to)) addRoute(pair.from, pair.to, 'lane');
  }

  for (let i = 0; i < planets.length; i++) {
    const nearest = pairs
      .filter((pair) => pair.from === i || pair.to === i)
      .slice(0, 3 + Math.floor(seeded(i + 90) * 2));
    for (const pair of nearest) addRoute(pair.from, pair.to, pair.distance > 260 ? 'corridor' : 'lane');
  }

  const longRoutes = pairs
    .filter((pair) => pair.distance > 260 && pair.distance < 620 && seeded((pair.from + 1) * 41 + pair.to * 13) > 0.72)
    .slice(0, Math.max(4, Math.round(planets.length / 9)));
  for (const pair of longRoutes) {
    addRoute(pair.from, pair.to, 'shortcut');
  }

  return routes;
}

function rebuildTravelRoutes() {
  state.travelRoutes = buildTravelRoutes();
}

function getTravelRoute(from, to) {
  return state.travelRoutes.find((route) => (
    (route.from === from && route.to === to) || (route.from === to && route.to === from)
  ));
}

function hasTravelRoute(from, to) {
  return Boolean(getTravelRoute(from, to));
}

function getRouteNeighbors(index = state.currentPlanet) {
  return state.travelRoutes
    .filter((route) => route.from === index || route.to === index)
    .map((route) => (route.from === index ? route.to : route.from))
    .sort((a, b) => a - b);
}

function selectRouteNeighbor(direction = 1) {
  const neighbors = getRouteNeighbors();
  if (!neighbors.length) return;
  const current = neighbors.indexOf(state.selectedPlanet);
  const next = current === -1
    ? (direction > 0 ? 0 : neighbors.length - 1)
    : (current + direction + neighbors.length) % neighbors.length;
  state.selectedPlanet = neighbors[next];
  setLog(`Route target: ${state.planets[state.selectedPlanet].name}`);
  updateStats();
}

function getNebulaColor(base = 1, alpha = 0.34) {
  const palette = [
    [105, 140, 255],
    [160, 98, 255],
    [255, 116, 198],
    [88, 210, 222],
    [126, 255, 186],
  ];
  const rgb = palette[Math.floor(seeded(base + 74) * palette.length) % palette.length];
  return `rgba(${rgb[0]}, ${rgb[1]}, ${rgb[2]}, ${alpha})`;
}

function drawImageCover(img, x, y, width, height) {
  if (!img?.complete || img.naturalWidth === 0 || width <= 0 || height <= 0) return false;
  const sourceRatio = img.naturalWidth / img.naturalHeight;
  const targetRatio = width / height;
  let sx = 0;
  let sy = 0;
  let sw = img.naturalWidth;
  let sh = img.naturalHeight;
  if (sourceRatio > targetRatio) {
    sw = img.naturalHeight * targetRatio;
    sx = (img.naturalWidth - sw) * 0.5;
  } else {
    sh = img.naturalWidth / targetRatio;
    sy = (img.naturalHeight - sh) * 0.5;
  }
  ctx.drawImage(img, sx, sy, sw, sh, x, y, width, height);
  return true;
}

function drawImageCoverTo(targetCtx, img, x, y, width, height, sourceBiasX = 0, sourceBiasY = 0) {
  if (!img?.complete || img.naturalWidth === 0 || width <= 0 || height <= 0) return false;
  const sourceRatio = img.naturalWidth / img.naturalHeight;
  const targetRatio = width / height;
  let sx = 0;
  let sy = 0;
  let sw = img.naturalWidth;
  let sh = img.naturalHeight;
  if (sourceRatio > targetRatio) {
    sw = img.naturalHeight * targetRatio;
    const extra = img.naturalWidth - sw;
    sx = clamp(extra * (0.5 + sourceBiasX * 0.38), 0, extra);
  } else {
    sh = img.naturalWidth / targetRatio;
    const extra = img.naturalHeight - sh;
    sy = clamp(extra * (0.5 + sourceBiasY * 0.38), 0, extra);
  }
  targetCtx.drawImage(img, sx, sy, sw, sh, x, y, width, height);
  return true;
}

function getNebulaSprite() {
  const img = sprites.nebula;
  return img?.complete && img.naturalWidth > 0 ? img : null;
}

function getWarpSprite() {
  const img = sprites.warp;
  return img?.complete && img.naturalWidth > 0 ? img : null;
}

function drawFeatheredChartNebula(nebula, x, y, width, height, rotation, alpha, seedValue) {
  const pad = Math.ceil(Math.max(width, height) * 0.16);
  const patchW = Math.max(4, Math.ceil(width + pad * 2));
  const patchH = Math.max(4, Math.ceil(height + pad * 2));
  if (chartNebulaCanvas.width !== patchW || chartNebulaCanvas.height !== patchH) {
    chartNebulaCanvas.width = patchW;
    chartNebulaCanvas.height = patchH;
  }
  chartNebulaCtx.clearRect(0, 0, patchW, patchH);
  chartNebulaCtx.save();
  chartNebulaCtx.imageSmoothingEnabled = true;
  chartNebulaCtx.imageSmoothingQuality = 'high';
  drawImageCoverTo(
    chartNebulaCtx,
    nebula,
    0,
    0,
    patchW,
    patchH,
    seeded(seedValue + 17) * 2 - 1,
    seeded(seedValue + 19) * 2 - 1,
  );

  chartNebulaCtx.globalCompositeOperation = 'destination-in';
  chartNebulaCtx.save();
  chartNebulaCtx.translate(patchW * 0.5, patchH * 0.5);
  chartNebulaCtx.scale(width / patchW, height / patchH);
  const mask = chartNebulaCtx.createRadialGradient(0, 0, 0, 0, 0, Math.max(patchW, patchH) * 0.54);
  mask.addColorStop(0, 'rgba(255, 255, 255, 0.88)');
  mask.addColorStop(0.46, 'rgba(255, 255, 255, 0.68)');
  mask.addColorStop(0.73, 'rgba(255, 255, 255, 0.20)');
  mask.addColorStop(1, 'rgba(255, 255, 255, 0)');
  chartNebulaCtx.fillStyle = mask;
  chartNebulaCtx.beginPath();
  chartNebulaCtx.arc(0, 0, Math.max(patchW, patchH) * 0.54, 0, Math.PI * 2);
  chartNebulaCtx.fill();
  chartNebulaCtx.restore();

  chartNebulaCtx.globalCompositeOperation = 'destination-out';
  for (let i = 0; i < 7; i++) {
    const angle = seeded(seedValue + i * 23) * Math.PI * 2;
    const distance = 0.37 + seeded(seedValue + i * 29) * 0.26;
    const cx = patchW * 0.5 + Math.cos(angle) * width * distance;
    const cy = patchH * 0.5 + Math.sin(angle) * height * distance;
    const bite = Math.max(width, height) * (0.10 + seeded(seedValue + i * 31) * 0.16);
    const grad = chartNebulaCtx.createRadialGradient(cx, cy, 0, cx, cy, bite);
    grad.addColorStop(0, 'rgba(0, 0, 0, 0.34)');
    grad.addColorStop(1, 'rgba(0, 0, 0, 0)');
    chartNebulaCtx.fillStyle = grad;
    chartNebulaCtx.beginPath();
    chartNebulaCtx.arc(cx, cy, bite, 0, Math.PI * 2);
    chartNebulaCtx.fill();
  }
  chartNebulaCtx.restore();

  ctx.save();
  ctx.globalAlpha = alpha;
  ctx.translate(x, y);
  ctx.rotate(rotation);
  ctx.drawImage(chartNebulaCanvas, -patchW * 0.5, -patchH * 0.5);
  ctx.restore();
}

function getStationVisualProfile(station = {}) {
  const stats = station.assetType === 'station' && !station.stationTypeId
    ? station
    : getShipStats(station.stationTypeId ?? station.id);
  const hull = Math.max(0, finiteNumber(stats.hull, 100));
  const shields = Math.max(0, finiteNumber(stats.shields, 100));
  const autoScale = Math.max(1.18, Math.min(2.65, 0.86 + Math.log10(hull + shields + 20) * 0.45));
  // Runtime stations retain a visual snapshot for effects, but their type manifest stays authoritative.
  const overrides = station.visualOverrides || (station.visualSnapshot ? {} : station);
  const width = Math.round(clamp(finiteNumber(overrides.drawWidth, finiteNumber(stats.drawWidth, finiteNumber(station.drawWidth, STATION_DRAW_W))), 24, 520));
  const height = Math.round(clamp(finiteNumber(overrides.drawHeight, finiteNumber(stats.drawHeight, finiteNumber(station.drawHeight, STATION_DRAW_H))), 24, 520));
  const scale = clamp(finiteNumber(overrides.drawScale ?? overrides.scale, finiteNumber(stats.drawScale, finiteNumber(station.scale, autoScale))), 0.2, 8);
  return {
    width,
    height,
    scale,
  };
}

function getStationScreenRadius(station = {}) {
  const visual = getStationVisualProfile(station);
  return Math.max(36, Math.max(visual.width, visual.height) * visual.scale * 0.48);
}

function getStationTypeId(station = {}) {
  const stationTypeId = Number(station.stationTypeId);
  if (stationTypeId === 91) return 75;
  const stats = state.shipStatsById[stationTypeId];
  if (stats && stats.assetType !== 'station') return 75;
  return stationTypeId || 75;
}

function getSystemExtraBodies(systemIndex, star, mainPlanet, orbit) {
  const base = systemIndex + 1;
  const bodies = [];
  if (systemIndex === 0) {
    const marsDistance = clamp(orbit.distance + 430, 760, 1680);
    const marsAngle = orbit.angle + 0.82;
    bodies.push({
      id: 'sol-mars',
      name: 'Mars',
      kind: 'planet',
      orbitAnchor: 'star',
      x: star.x + Math.cos(marsAngle) * marsDistance,
      y: star.y + Math.sin(marsAngle) * marsDistance,
      orbitDistance: marsDistance,
      orbitAngle: marsAngle,
      orbitPeriod: getOrbitPeriodMs(marsDistance, 16, 1007, 'planet'),
      orbitDirection: 1,
      drawSize: 78,
      spinPeriod: 210000,
      spinDirection: 1,
      surfaceType: 4,
      color: 'rgba(190, 110, 76, 0.9)',
      ringType: 0,
    });
    const lunaDistance = getPlanetVisualSize(state.planets[systemIndex]) * 0.66 + 86;
    const lunaAngle = orbit.angle - 0.72;
    bodies.push({
      id: 'sol-luna',
      name: 'Luna',
      kind: 'moon',
      parent: 'main',
      orbitAnchor: 'planet',
      x: mainPlanet.x + Math.cos(lunaAngle) * lunaDistance,
      y: mainPlanet.y + Math.sin(lunaAngle) * lunaDistance,
      orbitDistance: lunaDistance,
      orbitAngle: lunaAngle,
      orbitPeriod: getOrbitPeriodMs(lunaDistance, getPlanetMassFactor(state.planets[systemIndex]), 1013, 'moon'),
      orbitDirection: 1,
      drawSize: 24,
      spinPeriod: 180000,
      spinDirection: 1,
      surfaceType: 18,
      color: 'rgba(190, 196, 204, 0.9)',
      ringType: 0,
    });
  }
  const planetCount = 1 + Math.floor(seeded(base * 163 + 9) * 4);
  const extraPlanetSurfaceTypes = [2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 25, 26, 27, 28, 29, 30, 31, 32, 33, 34, 35, 36];
  const extraMoonSurfaceTypes = [13, 14, 15, 16, 17, 18, 19, 20, 21, 22, 23, 24, 26, 31, 34, 36];
  for (let i = 0; i < planetCount; i++) {
    const lane = i < 2 ? i + 1 : i + 2;
    const distance = orbit.distance + (lane - 1.5) * 360 + (seeded(base * 173 + i) - 0.5) * 180;
    const safeDistance = clamp(distance, 520, 1680);
    const angle = orbit.angle + (i + 1) * 1.28 + (seeded(base * 179 + i) - 0.5) * 0.7;
    const x = star.x + Math.cos(angle) * safeDistance;
    const y = star.y + Math.sin(angle) * safeDistance;
    if (Math.hypot(x - mainPlanet.x, y - mainPlanet.y) < 230) continue;
    const drawSize = 46 + seeded(base * 191 + i) * 84;
    const localPoint = { x, y };
    const capturedByPlanet = isInsidePlanetLocalOrbit(localPoint, mainPlanet, state.planets[systemIndex], { drawSize });
    const anchorPoint = capturedByPlanet ? mainPlanet : star;
    const bodyDistance = Math.hypot(x - anchorPoint.x, y - anchorPoint.y);
    const bodyAngle = Math.atan2(y - anchorPoint.y, x - anchorPoint.x);
    const surfaceType = capturedByPlanet
      ? pickFixedPlanetSurfaceType(extraMoonSurfaceTypes, systemIndex, i, 2)
      : pickFixedPlanetSurfaceType(extraPlanetSurfaceTypes, systemIndex, i, 5);
    bodies.push({
      id: `${systemIndex}-planet-${i}`,
      kind: capturedByPlanet ? 'moon' : 'planet',
      parent: capturedByPlanet ? 'main' : undefined,
      orbitAnchor: capturedByPlanet ? 'planet' : 'star',
      x,
      y,
      orbitDistance: bodyDistance,
      orbitAngle: bodyAngle,
      orbitPeriod: getOrbitPeriodMs(bodyDistance, capturedByPlanet ? getPlanetMassFactor(state.planets[systemIndex]) : 16, base * 281 + i, capturedByPlanet ? 'moon' : 'planet'),
      orbitDirection: seeded(base * 283 + i) > 0.5 ? 1 : -1,
      drawSize,
      spinPeriod: 160000 + seeded(base * 307 + i) * 260000,
      spinDirection: seeded(base * 311 + i) > 0.5 ? 1 : -1,
      surfaceType,
      color: getGeneratedBodyColor(base * 13 + i, surfaceType),
      ringType: seeded(base * 193 + i) > 0.74 ? 1 + Math.floor(seeded(base * 197 + i) * 4) : 0,
      ringRotation: seeded(base * 199 + i) * 180,
    });
  }

  const moonCount = 1 + Math.floor(seeded(base * 211) * 4);
  for (let i = 0; i < moonCount; i++) {
    const angle = orbit.angle + 0.7 + i * (Math.PI * 2 / Math.max(1, moonCount)) + (seeded(base * 223 + i) - 0.5) * 0.6;
    const distance = getPlanetVisualSize(state.planets[systemIndex]) * 0.74 + 100 + i * 42 + seeded(base * 227 + i) * 80;
    bodies.push({
      id: `${systemIndex}-moon-${i}`,
      kind: 'moon',
      parent: 'main',
      orbitAnchor: 'planet',
      x: mainPlanet.x + Math.cos(angle) * distance,
      y: mainPlanet.y + Math.sin(angle) * distance,
      orbitDistance: distance,
      orbitAngle: angle,
      orbitPeriod: getOrbitPeriodMs(distance, getPlanetMassFactor(state.planets[systemIndex]), base * 293 + i, 'moon'),
      orbitDirection: seeded(base * 317 + i) > 0.5 ? 1 : -1,
      drawSize: 18 + seeded(base * 229 + i) * 24,
      spinPeriod: 90000 + seeded(base * 331 + i) * 160000,
      spinDirection: seeded(base * 337 + i) > 0.5 ? 1 : -1,
      surfaceType: pickFixedPlanetSurfaceType(extraMoonSurfaceTypes, systemIndex, i, 7),
      color: 'rgba(180, 190, 204, 0.9)',
      ringType: 0,
    });
  }
  return bodies;
}

function ensureSystemState(systemIndex) {
  if (state.systemStates[systemIndex]) return state.systemStates[systemIndex];
  const row = state.systemData[systemIndex] || null;
  const base = systemIndex + 1;
  const hasAsteroids = row ? Number(row[17] || 0) === 1 : seeded(base) > 0.45;
  const dataNebula = row ? Number(row[16] || 0) === 1 : false;
  const hasNebula = row ? dataNebula : seeded(base + 1) > 0.9;
  const wormholeLink = getSystemWormholeLinks(systemIndex)[0] || null;
  const count = hasAsteroids ? 6 + Math.floor(seeded(base + 2) * 8) : 2;
  const star = {
    x: SYSTEM_W * 0.5 + (seeded(base + 11) - 0.5) * 220,
    y: SYSTEM_H * 0.5 + (seeded(base + 12) - 0.5) * 180,
  };
  const orbit = getSystemOrbit(row, base);
  const planetMass = getPlanetMassFactor(state.planets[systemIndex]);
  const planet = {
    x: star.x + Math.cos(orbit.angle) * orbit.distance,
    y: star.y + Math.sin(orbit.angle) * orbit.distance,
    orbitAnchor: 'star',
    orbitDistance: orbit.distance,
    orbitAngle: orbit.angle,
    orbitPeriod: getOrbitPeriodMs(orbit.distance, 16, base * 269, 'planet'),
    orbitDirection: seeded(base * 271) > 0.5 ? 1 : -1,
    spinPeriod: 220000 + seeded(base * 277) * 360000,
    spinDirection: seeded(base * 279) > 0.5 ? 1 : -1,
    massFactor: planetMass,
  };
  const bodies = getSystemExtraBodies(systemIndex, star, planet, orbit);
  const asteroids = Array.from({ length: count }, (_, i) => {
    const angle = orbit.angle + seeded(base * 31 + i) * Math.PI * 2;
    const distance = 520 + seeded(base * 37 + i) * 940;
    const x = star.x + Math.cos(angle) * distance;
    const y = star.y + Math.sin(angle) * distance;
    const driftAngle = seeded(base * 67 + i) * Math.PI * 2;
    const radius = 12 + seeded(base * 47 + i) * 16;
    const id = `${systemIndex}-${i}`;
    return {
      id,
      x,
      y,
      originX: x,
      originY: y,
      vx: Math.cos(driftAngle) * (ASTEROID_BASE_DRIFT + seeded(base * 71 + i) * 0.16),
      vy: Math.sin(driftAngle) * (ASTEROID_BASE_DRIFT + seeded(base * 73 + i) * 0.16),
      r: radius,
      spriteIndex: Math.floor(seeded(base * 107 + i) * ASTEROID_SPRITE_COUNT),
      rotation: seeded(base * 79 + i) * 360,
      spin: (seeded(base * 83 + i) - 0.5) * 0.9,
      driftSeed: base * 101 + i * 17,
      roamRadius: 210 + seeded(base * 89 + i) * 260,
      duranium: Math.round(8 + radius * 0.75 + seeded(base * 97 + i) * 14),
      depleted: Boolean(state.depletedAsteroids[id]),
    };
  });
  const wormhole = wormholeLink ? createSystemWormhole(wormholeLink, systemIndex, star, orbit) : null;
  const stationDefs = state.stationDefinitions.filter((station) => station.systemIndex === systemIndex);
  const stations = stationDefs.map((station, i) => {
    const stationTypeId = getStationTypeId(station);
    const typedStation = { ...station, stationTypeId };
    const visual = getStationVisualProfile(typedStation);
    const defenseProfile = getStationDefenseProfile(typedStation);
    // Owner comes from records/data, never from who controls the system; the flag follows the owner.
    typedStation.dataFaction = station.dataFaction !== undefined ? station.dataFaction : (station.builtByPlayer ? undefined : station.faction);
    const ownerId = getStationOwner(typedStation, systemIndex);
    const owned = ownerId === PLAYER_SIDE;
    const stationFaction = getStationFlagForOwner(ownerId);
    const destroyed = Boolean(state.destroyedStations[typedStation.id]);
    const stationPoint = getStationDefinitionWorldPoint(typedStation, star, planet);
    const runtimeStation = {
      ...typedStation,
      x: stationPoint.x,
      y: stationPoint.y,
      faction: stationFaction,
      ownerId,
      ownedByPlayer: owned,
      attitude: destroyed ? 'destroyed' : owned ? 'friendly' : getFactionAttitude(stationFaction),
      hostile: false,
      destroyed,
      combatHull: null,
      maxCombatHull: null,
      combatShields: null,
      maxCombatShields: null,
      lastShieldHitAt: 0,
      drawWidth: visual.width,
      drawHeight: visual.height,
      scale: visual.scale,
      visualSnapshot: { ...visual },
      defenseRange: defenseProfile.range,
      defenseDamage: defenseProfile.damage,
      defenseCooldown: defenseProfile.cooldown,
      stationWeaponIds: typedStation.underConstruction ? [] : defenseProfile.weaponIds,
      shotIndex: 0,
      lastShotAt: seeded(base * 61 + i) * 1000,
    };
    return withStationOrbit(runtimeStation, star, planet, base, i);
  });
  const primaryStation = stations[0] || null;
  const destinations = getTrafficDestinations(stations, planet, star, wormhole, base);
  const npcCount = getSystemTrafficCount(stations, base);
  const localFaction = getSystemFaction(systemIndex);
  const localPatrolCount = localFaction === 'neutral' ? 0 : Math.min(2, npcCount);
  const localTrafficCount = localFaction === 'neutral'
    ? 0
    : Math.min(npcCount, Math.max(localPatrolCount, Math.ceil(npcCount * 0.65)));
  const npcShips = Array.from({ length: npcCount }, (_, i) => {
    const shipSeed = base * 97 + i * 31;
    const from = pickTrafficDestination(destinations, shipSeed + 1);
    const destination = pickTrafficDestination(destinations, shipSeed + 2, from.name);
    const offset = 40 + seeded(shipSeed + 3) * 120;
    const angle = seeded(shipSeed + 4) * Math.PI * 2;
    const role = i < localPatrolCount ? 'patrol' : i < localTrafficCount ? 'localTraffic' : 'traffic';
    const shipId = i < localTrafficCount
      ? getNpcShipIdForFaction(localFaction, shipSeed + 10, role)
      : getNpcShipId(shipSeed + 10, role);
    if (shipId == null) return null;
    const faction = getShipFaction(shipId);
    const flight = getNpcFlightProfile(shipId, shipSeed);
    return {
      id: `${systemIndex}-${i}`,
      x: from.point.x + Math.cos(angle) * offset,
      y: from.point.y + Math.sin(angle) * offset,
      destination: { ...destination.point },
      destinationName: destination.name,
      waitUntil: 0,
      heading: seeded(shipSeed + 6) * 360,
      speed: flight.speed,
      turnRate: flight.turnRate,
      systemWarpIntensity: 0,
      systemWarpMultiplier: flight.systemWarpMultiplier,
      seed: shipSeed,
      leg: 0,
      shipId,
      name: generateShipName({ shipId, faction, seed: shipSeed, role, id: `${systemIndex}-${i}` }),
      role,
      faction: 'neutral',
      attitude: 'neutral',
      hostile: false,
      combatHull: null,
      maxCombatHull: null,
      combatShields: null,
      maxCombatShields: null,
      lastShieldHitAt: 0,
      lastShotAt: 0,
      destroyed: false,
      scale: getNpcSpriteScale(shipId, shipSeed + 11),
    };
  }).filter(Boolean);
  state.systemStates[systemIndex] = {
    hasNebula,
    nebulaColor: getNebulaColor(base),
    hasAsteroids,
    star,
    planet,
    bodies,
    asteroids,
    wormhole,
    station: primaryStation,
    stations,
    trafficDestinations: destinations.map((dest) => ({ name: dest.name, point: { ...dest.point }, spread: dest.spread })),
    npcShips,
  };
  return state.systemStates[systemIndex];
}

function applySystemState(systemIndex) {
  // The NPCs currently live belong to securityLiveSystemIndex; snapshot the participants of that
  // system's active orders before they are discarded (travel, reload, or a same-system regeneration).
  captureShipPowerState();
  captureSecurityParticipants(state.securityLiveSystemIndex);
  const s = ensureSystemState(systemIndex);
  const now = performance.now();
  state.systemStar = { ...s.star };
  state.systemPlanet = { ...s.planet };
  state.systemBodies = (s.bodies || []).map((body) => ({ ...body }));
  state.systemFaction = getSystemFaction(systemIndex);
  state.systemAttitude = getSystemAttitude(systemIndex);
  state.systemHasNebula = Boolean(s.hasNebula);
  state.systemNebulaColor = s.nebulaColor || getNebulaColor(systemIndex + 1);
  state.asteroids = s.asteroids;
  state.wormhole = s.wormhole ? { ...s.wormhole } : null;
  state.station = s.station ? { ...s.station } : null;
  state.stations = (s.stations || []).map((station) => {
    // Owner, flag and attitude are re-derived from current records on every entry, so a snapshot
    // built under an earlier flag or holder cannot carry stale allegiance into the scene.
    const ownerId = getStationOwner(station, systemIndex);
    const destroyed = Boolean(station.destroyed);
    const faction = getStationFlagForOwner(ownerId);
    const attitude = destroyed ? 'destroyed' : ownerId === PLAYER_SIDE ? 'friendly' : getFactionAttitude(faction);
    return { ...station, ownerId, ownedByPlayer: ownerId === PLAYER_SIDE, faction, attitude, hostile: Boolean(station.hostile), destroyed };
  });
  const control = getSystemControl(systemIndex);
  const trafficShips = s.npcShips.map((ship, index) => {
    // A ship that already has an identity keeps it (hull, faction, side) whoever holds the system
    // now. Only a ship restored for the first time is fitted out for the current holder, and that
    // identity is then written back to the snapshot so later entries cannot change it.
    const locked = Boolean(ship.identityLocked) || (typeof ship.sideId === 'string' && ship.sideId.length > 0);
    const patrolShipId = !locked && state.systemFaction !== 'neutral' && ship.role === 'patrol' && !ship.destroyed
      ? (getNpcShipIdForFaction(state.systemFaction, ship.seed + 10, 'patrol') ?? ship.shipId)
      : ship.shipId;
    const faction = locked ? ship.faction : getShipFaction(patrolShipId);
    const sideId = locked && ship.sideId
      ? ship.sideId
      : (isRecognizedFactionKey(control.controller) || control.controller === PLAYER_SIDE || control.controller === 'neutral' || !control.controller
        ? deriveNpcSideId(faction, ship.id)
        : (ship.role === 'patrol' ? control.polityId : deriveNpcSideId(faction, ship.id)));
    if (!locked) Object.assign(ship, { shipId: patrolShipId, faction, sideId, identityLocked: true });
    const attitude = getFactionAttitude(faction);
    return {
      ...ship,
      shipId: patrolShipId,
      name: ship.name
        && Number(ship.shipId) === Number(patrolShipId)
        && !isSystemDerivedShipName(ship.name)
        && !isCrossFactionShipName(ship.name, faction)
        ? ship.name
        : generateShipName({ shipId: patrolShipId, faction, seed: ship.seed, role: ship.role || (index < 2 ? 'patrol' : 'traffic'), id: ship.id }),
      faction,
      sideId,
      attitude,
      hostile: state.systemAttitude === 'hostile' && attitude !== 'friendly',
      scale: getNpcSpriteScale(patrolShipId, ship.seed + 11),
      lastShotAt: now + 700 + seeded(ship.seed + 13) * 1500,
    };
  });
  state.npcShips = [
    ...trafficShips,
    ...getPlayerFleetNpcShips(systemIndex, now),
    ...getPlayerEscortNpcShips(now),
  ];
  state.trafficWarpCooldownUntil = now + 4000;
  for (const npc of trafficShips) {
    npc.trafficWarp = null;
    npc.ambientWarpAt = now + 7000 + seeded(npc.seed + systemIndex * 71 + 29) * 16000;
  }
  state.activeFleetAttack = null;
  state.fleetAttackControlSince = 0;
  state.trafficDestinations = s.trafficDestinations.map((dest) => ({ name: dest.name, point: { ...dest.point }, spread: dest.spread }));
  updateSystemOrbits(now);
  state.projectiles = [];
  state.weaponEffects = [];
  state.tractorBeams = [];
  state.combatTargetId = null;
  state.combatTargetType = 'ship';
  state.securityLiveSystemIndex = Number(systemIndex);
  reconcileSecurityParticipants(systemIndex);
  for (const npc of state.npcShips) ensureNpcPower(npc);
}

function updateSystemOrbits(now = performance.now()) {
  const previousDockPoint = state.docked
    ? state.dockedStationId
      ? state.stations.find((station) => station.id === state.dockedStationId)
      : state.systemPlanet
    : null;
  const previousDockX = previousDockPoint?.x;
  const previousDockY = previousDockPoint?.y;

  const planetPosition = getOrbitalPosition(state.systemStar, state.systemPlanet, now);
  if (planetPosition) {
    state.systemPlanet.x = planetPosition.x;
    state.systemPlanet.y = planetPosition.y;
    state.systemPlanet.orbitAngleCurrent = planetPosition.orbitAngleCurrent;
  }

  for (const body of state.systemBodies || []) {
    const anchor = body.orbitAnchor === 'planet' || body.parent === 'main' ? state.systemPlanet : state.systemStar;
    const position = getOrbitalPosition(anchor, body, now);
    if (!position) continue;
    body.x = position.x;
    body.y = position.y;
    body.orbitAngleCurrent = position.orbitAngleCurrent;
  }

  for (const station of state.stations || []) {
    const anchor = station.orbitAnchor === 'planet' ? state.systemPlanet : state.systemStar;
    const position = getOrbitalPosition(anchor, station, now);
    if (!position) continue;
    station.x = position.x;
    station.y = position.y;
    station.orbitAngleCurrent = position.orbitAngleCurrent;
    station.rotation = (position.orbitAngleCurrent * 180 / Math.PI + 90) % 360;
  }

  const primaryStation = state.stations.find((station) => !station.destroyed && !station.underConstruction) || state.stations.find((station) => !station.destroyed) || state.stations[0] || null;
  state.station = primaryStation ? { ...primaryStation } : null;
  state.trafficDestinations = getTrafficDestinations(state.stations, state.systemPlanet, state.systemStar, state.wormhole, state.currentPlanet + 1)
    .map((dest) => ({ name: dest.name, point: { ...dest.point } }));

  const currentDockPoint = state.docked
    ? state.dockedStationId
      ? state.stations.find((station) => station.id === state.dockedStationId)
      : state.systemPlanet
    : null;
  if (currentDockPoint && Number.isFinite(previousDockX) && Number.isFinite(previousDockY)) {
    state.camera.x += currentDockPoint.x - previousDockX;
    state.camera.y += currentDockPoint.y - previousDockY;
  }
}

function setCamera(x, y) {
  state.camera.x = x;
  state.camera.y = y;
}

function setCameraNearPlanet() {
  const size = getPlanetVisualSize();
  setCamera(state.systemPlanet.x + size * 0.56, state.systemPlanet.y + size * 0.34);
}

function worldToScreen(point, parallax = 1) {
  return {
    x: canvas.width * 0.5 + (point.x - state.camera.x) * parallax,
    y: canvas.height * 0.5 + (point.y - state.camera.y) * parallax,
  };
}

function playerWorldPosition() {
  return { x: state.camera.x, y: state.camera.y };
}

function getMapCoordinate(row, index, axis) {
  const value = Number(row?.[axis === 'x' ? 23 : 24]);
  const other = Number(row?.[axis === 'x' ? 24 : 23]);
  if (Number.isFinite(value) && (value !== 0 || Number.isFinite(other) && other !== 0)) return value * STAR_CHART_COORD_SCALE;
  const angle = seeded(index * 31 + (axis === 'x' ? 5 : 13)) * Math.PI * 2;
  const radius = 160 + seeded(index * 47 + 17) * 520;
  return (axis === 'x' ? Math.cos(angle) : Math.sin(angle)) * radius;
}

function normalizeMapNames(data = {}, rows = []) {
  if (typeof data === 'string') {
    const names = data.replace(/\r?\n/g, '').split(',').filter(Boolean);
    if (names[0]?.toLowerCase() === 'error') names.shift();
    return names;
  }
  const names = Array.isArray(data) ? data : data.names || [];
  return rows.map((row, index) => names[index] || row?.[0] || `System ${index + 1}`);
}

function planetRowFromJson(planet = {}, index = 0) {
  const stockIds = Array.isArray(planet.shipStockIds) ? planet.shipStockIds : [];
  const legacyFlags = Array.isArray(planet.legacyFlags) ? planet.legacyFlags : [];
  return [
    planet.name || `System ${index + 1}`,
    planet.governmentId ?? 0,
    planet.population ?? 0,
    planet.legacyStat3 ?? 0,
    planet.surfaceType ?? 1,
    planet.legacyStat5 ?? 0,
    planet.market ?? 0,
    planet.description || '',
    planet.planetScale ?? 50,
    planet.legacyStat9 ?? 0,
    ...Array.from({ length: 6 }, (_, slot) => stockIds[slot] ?? 100),
    planet.hasNebula ? 1 : 0,
    planet.hasAsteroids ? 1 : 0,
    planet.ring?.type ?? 0,
    planet.ring?.rotation ?? 0,
    legacyFlags[0] ?? 0,
    legacyFlags[1] ?? 0,
    legacyFlags[2] ?? 0,
    planet.map?.x ?? 0,
    planet.map?.y ?? 0,
  ];
}

function normalizePlanetRows(data = {}) {
  if (typeof data === 'string') {
    return data.replace(/\r?\n/g, '').split(':').filter(Boolean).map((row) => row.split(';'));
  }
  const planets = Array.isArray(data) ? data : data.planets || [];
  return planets.map((planet, index) => planetRowFromJson(planet, index));
}

function itemRowsFromJson(data = {}) {
  if (typeof data === 'string') {
    return data.replace(/\r?\n/g, '').split(';');
  }
  const items = Array.isArray(data) ? data : data.items || [];
  const fields = [];
  for (const item of items) {
    fields.push(
      item.legacyFlag ?? 0,
      item.name || `Item ${item.id || fields.length / 16 + 1}`,
      item.description || '',
      item.mass ?? 0,
      item.antimatterUse ?? 0,
      item.cargoCapacity ?? 0,
      item.hull ?? 0,
      item.shields ?? 0,
      item.topSpeed ?? 0,
      item.turnRate ?? 0,
      item.cost ?? 0,
      ...Array.from({ length: 4 }, (_, slot) => item.weaponSlots?.[slot] ?? 0),
      item.legacyTail ?? 0,
    );
  }
  if (Array.isArray(data.trailingFields)) fields.push(...data.trailingFields);
  return fields;
}

function parseOriginalShipWeaponSlots(data = '') {
  const fields = itemRowsFromJson(data);
  const slotsByShip = {};
  for (let i = 0; i + 15 < fields.length; i += 16) {
    const shipId = Math.floor(i / 16) + 1;
    const slots = [fields[i + 11], fields[i + 12], fields[i + 13]]
      .map((value) => Math.round(finiteNumber(value, 0)))
      .map((weaponId) => (weaponId > 0 && hasWeaponDefinition(weaponId) ? weaponId : null));
    if (slots.some(Boolean)) slotsByShip[shipId] = slots;
  }
  return slotsByShip;
}

function parseOriginalStationWeaponSlots(data = '') {
  const fields = itemRowsFromJson(data);
  const slotsByStation = {};
  for (let i = 0; i + 15 < fields.length; i += 16) {
    const stationId = Math.floor(i / 16) + 1;
    const slots = [fields[i + 11], fields[i + 12], fields[i + 13], fields[i + 14]]
      .map((value) => Math.round(finiteNumber(value, 0)))
      .filter((weaponId, index, arr) => (
        weaponId > 0
        && hasWeaponDefinition(weaponId)
        && arr.indexOf(weaponId) === index
      ));
    if (slots.length) slotsByStation[stationId] = slots;
  }
  return slotsByStation;
}

function cloneDefaultItemSettings() {
  return {
    weaponInventoryLimit: DEFAULT_ITEM_SETTINGS.weaponInventoryLimit,
    weaponCooldowns: {
      powerReductionCap: DEFAULT_ITEM_SETTINGS.weaponCooldowns.powerReductionCap,
      classFactorMin: DEFAULT_ITEM_SETTINGS.weaponCooldowns.classFactorMin,
      classFactorMax: DEFAULT_ITEM_SETTINGS.weaponCooldowns.classFactorMax,
      typeFactors: { ...DEFAULT_ITEM_SETTINGS.weaponCooldowns.typeFactors },
      minimumsMs: { ...DEFAULT_ITEM_SETTINGS.weaponCooldowns.minimumsMs },
    },
    factionFlags: {
      basePrice: DEFAULT_ITEM_SETTINGS.factionFlags.basePrice,
      marketMultiplier: DEFAULT_ITEM_SETTINGS.factionFlags.marketMultiplier,
      blockedFactions: [...DEFAULT_ITEM_SETTINGS.factionFlags.blockedFactions],
    },
    devices: cloneDefaultDeviceSettings(),
  };
}

function normalizeDeviceNumber(value, fallback, min = 0, max = 60000) {
  return clamp(finiteNumber(value, fallback), min, max);
}

function normalizeItemSettings(settings = {}) {
  const normalized = cloneDefaultItemSettings();
  const weaponInventoryLimit = Math.round(finiteNumber(settings.weaponInventoryLimit, normalized.weaponInventoryLimit));
  if (weaponInventoryLimit > 0) normalized.weaponInventoryLimit = clamp(weaponInventoryLimit, 1, 99);

  const cooldowns = settings.weaponCooldowns || {};
  const powerReductionCap = finiteNumber(cooldowns.powerReductionCap, normalized.weaponCooldowns.powerReductionCap);
  const classFactorMin = finiteNumber(cooldowns.classFactorMin, normalized.weaponCooldowns.classFactorMin);
  const classFactorMax = finiteNumber(cooldowns.classFactorMax, normalized.weaponCooldowns.classFactorMax);
  normalized.weaponCooldowns.powerReductionCap = clamp(powerReductionCap, 0, 0.5);
  normalized.weaponCooldowns.classFactorMin = clamp(classFactorMin, 0.25, 1.5);
  normalized.weaponCooldowns.classFactorMax = clamp(classFactorMax, normalized.weaponCooldowns.classFactorMin, 2);
  for (const [type, factor] of Object.entries(cooldowns.typeFactors || {})) {
    const key = String(type || '').trim().toLowerCase();
    const numericFactor = finiteNumber(factor, NaN);
    if (key && Number.isFinite(numericFactor) && numericFactor > 0) {
      normalized.weaponCooldowns.typeFactors[key] = clamp(numericFactor, 0.2, 4);
    }
  }
  for (const [type, minimum] of Object.entries(cooldowns.minimumsMs || {})) {
    const key = String(type || '').trim().toLowerCase();
    const numericMinimum = Math.round(finiteNumber(minimum, NaN));
    if (key && Number.isFinite(numericMinimum) && numericMinimum >= 0) {
      normalized.weaponCooldowns.minimumsMs[key] = clamp(numericMinimum, 0, 10000);
    }
  }

  const factionFlags = settings.factionFlags || {};
  const basePrice = Math.round(finiteNumber(factionFlags.basePrice, normalized.factionFlags.basePrice));
  const marketMultiplier = Math.round(finiteNumber(factionFlags.marketMultiplier, normalized.factionFlags.marketMultiplier));
  if (basePrice >= 0) normalized.factionFlags.basePrice = basePrice;
  if (marketMultiplier >= 0) normalized.factionFlags.marketMultiplier = marketMultiplier;
  if (Array.isArray(factionFlags.blockedFactions)) {
    normalized.factionFlags.blockedFactions = [...new Set(
      factionFlags.blockedFactions
        .map((faction) => String(faction || '').trim().toLowerCase())
        .filter(Boolean),
    )];
  }

  const devices = settings.devices || {};
  const cloak = devices.cloak || {};
  normalized.devices.cloak.durationMs = normalizeDeviceNumber(cloak.durationMs, normalized.devices.cloak.durationMs, 1000, 120000);
  normalized.devices.cloak.fadeMs = normalizeDeviceNumber(cloak.fadeMs, normalized.devices.cloak.fadeMs, 0, 10000);

  const engineDisruptor = devices.engineDisruptor || {};
  normalized.devices.engineDisruptor.disableMs = normalizeDeviceNumber(engineDisruptor.disableMs, normalized.devices.engineDisruptor.disableMs, 1000, 120000);
  normalized.devices.engineDisruptor.waveMs = normalizeDeviceNumber(engineDisruptor.waveMs, normalized.devices.engineDisruptor.waveMs, 250, 30000);

  const thaleronGenerator = devices.thaleronGenerator || {};
  normalized.devices.thaleronGenerator.cloudMs = normalizeDeviceNumber(thaleronGenerator.cloudMs, normalized.devices.thaleronGenerator.cloudMs, 250, 30000);

  const tractorBeam = devices.tractorBeam || {};
  normalized.devices.tractorBeam.holdMs = normalizeDeviceNumber(tractorBeam.holdMs, normalized.devices.tractorBeam.holdMs, 200, 30000);
  normalized.devices.tractorBeam.rangeGrace = normalizeDeviceNumber(tractorBeam.rangeGrace, normalized.devices.tractorBeam.rangeGrace, 0.5, 5);
  normalized.devices.tractorBeam.towFactor = normalizeDeviceNumber(tractorBeam.towFactor, normalized.devices.tractorBeam.towFactor, 0, 3);
  normalized.devices.tractorBeam.anchorStrength = normalizeDeviceNumber(tractorBeam.anchorStrength, normalized.devices.tractorBeam.anchorStrength, 0, 1);
  normalized.devices.tractorBeam.sourceHalfWidth = normalizeDeviceNumber(tractorBeam.sourceHalfWidth, normalized.devices.tractorBeam.sourceHalfWidth, 0.5, 80);
  normalized.devices.tractorBeam.targetHalfWidth = normalizeDeviceNumber(tractorBeam.targetHalfWidth, normalized.devices.tractorBeam.targetHalfWidth, 1, 160);
  return normalized;
}

function getWeaponInventoryLimit() {
  return Math.max(1, Math.round(finiteNumber(itemSettings.weaponInventoryLimit, DEFAULT_WEAPON_INVENTORY_LIMIT)));
}

function getWeaponCooldownSettings() {
  return itemSettings.weaponCooldowns || cloneDefaultItemSettings().weaponCooldowns;
}

function getFactionFlagSettings() {
  return itemSettings.factionFlags || cloneDefaultItemSettings().factionFlags;
}

function getDeviceItemSettings(kind = '') {
  return itemSettings.devices?.[kind] || cloneDefaultItemSettings().devices[kind] || {};
}

function getCloakItemSettings() {
  return getDeviceItemSettings('cloak');
}

function getEngineDisruptorItemSettings() {
  return getDeviceItemSettings('engineDisruptor');
}

function getThaleronItemSettings() {
  return getDeviceItemSettings('thaleronGenerator');
}

function getTractorBeamItemSettings() {
  return getDeviceItemSettings('tractorBeam');
}

function isFactionFlagBlocked(faction = 'neutral') {
  return new Set(getFactionFlagSettings().blockedFactions || []).has(normalizeFactionKey(faction));
}

function normalizeWeaponDefinition(entry = {}) {
  const id = Math.round(finiteNumber(entry.id, NaN));
  if (!Number.isFinite(id) || id <= 0) return null;
  const name = String(entry.name || '').trim();
  if (!name) return null;
  const stockFactions = Array.isArray(entry.stockFactions)
    ? [...new Set(entry.stockFactions.map((faction) => String(faction || '').trim().toLowerCase()).filter(Boolean))]
    : [];
  return {
    ...entry,
    id,
    name,
    type: String(entry.type || 'Beam').trim() || 'Beam',
    damage: Math.max(0, finiteNumber(entry.damage, 0)),
    cooldown: Math.max(80, finiteNumber(entry.cooldown, PLAYER_WEAPON_COOLDOWN_MS)),
    range: Math.max(1, finiteNumber(entry.range, PLAYER_WEAPON_RANGE)),
    speed: Math.max(0, finiteNumber(entry.speed, 0)),
    price: Math.max(0, Math.round(finiteNumber(entry.price, 0))),
    minMass: Math.max(0, Math.round(finiteNumber(entry.minMass, 0))),
    color: String(entry.color || '#ffffff'),
    icon: String(entry.icon || ''),
    stockFactions,
  };
}

function normalizeWeaponCatalog(data = {}) {
  const source = Array.isArray(data) ? data : data.weapons;
  const seen = new Set();
  const weapons = (Array.isArray(source) ? source : [])
    .map(normalizeWeaponDefinition)
    .filter((weapon) => {
      if (!weapon || seen.has(weapon.id)) return false;
      seen.add(weapon.id);
      return true;
    });
  if (!weapons.length) return [...DEFAULT_WEAPON_CATALOG];
  if (!weapons.some((weapon) => weapon.id === DEFAULT_WEAPON_ID)) weapons.unshift(DEFAULT_WEAPON_CATALOG[0]);
  return weapons;
}

function normalizeTradeGoods(data = {}) {
  const goods = (Array.isArray(data.tradeGoods) ? data.tradeGoods : [])
    .map((good) => String(good || '').trim())
    .filter(Boolean);
  return goods.length ? [...new Set(goods)] : [...DEFAULT_TRADE_GOODS];
}

async function loadGameItemsData() {
  const data = await fetchModdableJson('game_items.json', `data/game_items.json?v=${SOURCE_DATA_VERSION}`);
  if (!data) {
    WEAPON_CATALOG = [...DEFAULT_WEAPON_CATALOG];
    itemSettings = cloneDefaultItemSettings();
    state.tradeGoodsArray = [...DEFAULT_TRADE_GOODS];
    return;
  }
  WEAPON_CATALOG = normalizeWeaponCatalog(data);
  itemSettings = normalizeItemSettings(data.settings || {});
  state.tradeGoodsArray = normalizeTradeGoods(data);
}

async function loadSourceData() {
  try {
    await loadGameItemsData();
    const [mapData, planetData, stationData, itemData] = await Promise.all([
      fetchModdableJson('mapnames.json', `data/mapnames.json?v=${SOURCE_DATA_VERSION}`),
      fetchModdableJson('planetData.json', `data/planetData.json?v=${SOURCE_DATA_VERSION}`),
      fetchModdableJson('stationData.json', `data/stationData.json?v=${SOURCE_DATA_VERSION}`, { stations: [] }),
      fetchModdableJson('itemtext.json', `data/itemtext.json?v=${SOURCE_DATA_VERSION}`, { items: [] }),
    ]);
    const rows = normalizePlanetRows(planetData);
    const names = normalizeMapNames(mapData, rows);
    state.systemData = rows;
    state.stationDefinitions = parseStationData(stationData);
    state.originalShipWeaponSlots = parseOriginalShipWeaponSlots(itemData);
    state.originalStationWeaponSlots = parseOriginalStationWeaponSlots(itemData);
    if (state.playerBuiltStations.length) syncPlayerBuiltStationDefinitions();
    state.systemStates = {};
    const max = Math.min(names.length, rows.length || names.length);
    state.planets = Array.from({ length: max }, (_, i) => ({
      name: names[i] || `System ${i + 1}`,
      x: getMapCoordinate(rows[i], i, 'x'),
      y: getMapCoordinate(rows[i], i, 'y'),
      mapX: Number(rows[i]?.[23]),
      mapY: Number(rows[i]?.[24]),
      ringType: Math.max(0, Math.round(finiteNumber(rows[i]?.[18], 0))),
      ringRotation: finiteNumber(rows[i]?.[19], 0),
      color: `hsl(${(i * 43) % 360} 70% 65%)`,
      description: rows[i]?.[7] || '',
      surfaceType: Math.max(1, finiteNumber(rows[i]?.[4], 1)),
      planetScale: clamp(finiteNumber(rows[i]?.[8], 50), 20, 100),
      market: Math.max(4, Math.min(18, Number(rows[i]?.[6] || 10) + 8)),
    }));
    rebuildTravelRoutes();
    state.selectedPlanet = Math.min(state.selectedPlanet, state.planets.length - 1);
    state.currentPlanet = Math.min(state.currentPlanet, state.planets.length - 1);
    applySystemState(state.currentPlanet);
    updateStats();
  } catch {
    rebuildTravelRoutes();
    setLog('Using fallback data tables.');
  }
}

async function loadFlaHints() {
  try {
    const hints = await fetch('data/fla_actions_index.json').then((r) => r.json());
    state.flaHints = hints;
  } catch {
    state.flaHints = null;
  }
}

async function loadPlanetModels() {
  try {
    const manifest = await fetchModdableJson('planet_manifest.json', `data/planet_manifest.json?v=${PLANET_MODEL_ASSET_VERSION}`);
    state.planetManifest = manifest || null;
    for (const model of manifest?.models || []) {
      if (!model.id || !model.image) continue;
      const img = new Image();
      img.src = `${model.image}?v=${PLANET_MODEL_ASSET_VERSION}`;
      state.planetModelSprites[Number(model.id)] = img;
    }
    for (const planet of manifest?.planets || []) {
      const runtimePlanet = state.planets[planet.index - 1];
      if (runtimePlanet) runtimePlanet.surfaceType = Math.max(1, finiteNumber(planet.surfaceType, runtimePlanet.surfaceType || 1));
    }
  } catch {
    state.planetManifest = null;
  }
}

function finiteNumber(value, fallback = 0) {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

function getPlanetVisualSize(planet = state.planets[state.currentPlanet]) {
  const scale = clamp(finiteNumber(planet?.planetScale, 50), 20, 100);
  const surfaceType = Math.max(1, Math.round(finiteNumber(planet?.surfaceType, 1)));
  const surfaceVariation = ((surfaceType * 17) % 23) - 11;
  return Math.round(clamp(145 + scale * 1.7 + surfaceVariation, MIN_FLIGHT_PLANET_DRAW_SIZE, MAX_FLIGHT_PLANET_DRAW_SIZE));
}

function getPlanetClickRadius(planet = state.planets[state.currentPlanet]) {
  return Math.max(PLANET_CLICK_RADIUS, getPlanetVisualSize(planet) * 0.48);
}

function getPlanetDockDistance(planet = state.planets[state.currentPlanet]) {
  return Math.max(PLANET_DOCK_DISTANCE, getPlanetVisualSize(planet) * 0.78);
}

function showPlanetCallout(index = state.currentPlanet) {
  state.planetCallout = {
    index,
    born: performance.now(),
    ttl: 4500,
  };
}

function resolveShipId(playership = state.playership) {
  const requestedId = Number(playership) || playership;
  // Owned/display identity. Catalog replacementId is only for new references.
  if (state.shipCatalog?.getShip(requestedId)) return resolveOwnedShipId(state.shipCatalog, requestedId);
  const legacyId = Number(LEGACY_SHIP_ID_REPLACEMENTS[requestedId]);
  const currentId = Number.isFinite(legacyId) && state.shipStatsById[legacyId] ? legacyId : requestedId;
  const stats = state.shipStatsById[currentId];
  const replacementId = Number(stats?.deprecated ? stats.replacedBy : NaN);
  if (Number.isFinite(replacementId) && state.shipStatsById[replacementId]) {
    return replacementId;
  }
  return currentId;
}

function getShipStats(playership = state.playership) {
  const requestedId = Number(playership) || playership;
  const resolvedId = resolveShipId(requestedId);
  const catalogShip = state.shipCatalog?.getShip(resolvedId);
  const stats = state.shipStatsById[resolvedId] || catalogShip;
  if (stats) return stats;
  return {
    id: requestedId,
    name: `Ship ${requestedId}`,
    mass: 1,
    antimatterUse: 3,
    cargoCapacity: 50,
    hull: 5,
    shields: 5,
    topSpeed: 15,
    turnRate: 10,
  };
}

function getShipVisualClass(playership = state.playership) {
  const stats = getShipStats(playership);
  const configuredClass = state.shipSizeConfig?.shipClassOverrides?.[Number(playership)];
  if (configuredClass && state.shipSizeConfig?.classScales?.[configuredClass]) return configuredClass;
  const manifestClass = stats.shipClass;
  if (manifestClass && state.shipSizeConfig?.classScales?.[manifestClass]) return manifestClass;
  const name = String(stats.name || '').toLowerCase();
  const mass = Math.max(1, finiteNumber(stats.mass, 1));
  const cargo = Math.max(0, finiteNumber(stats.cargoCapacity, 0));
  const hull = Math.max(0, finiteNumber(stats.hull, 0));
  const shields = Math.max(0, finiteNumber(stats.shields, 0));
  const durability = hull + shields;

  if (
    name.includes('shuttle')
    || name.includes('runabout')
    || name.includes('danube')
    || name.includes('yacht')
    || name.includes('escape pod')
  ) return 'shuttle';

  if (
    name.includes('borg cube')
    || name.includes('cube')
    || name.includes('dominion battleship')
    || name.includes("neg'var")
    || name.includes('negvar')
    || name.includes('negh')
    || name.includes('dreadnaught')
    || name.includes('dreadnought')
    || name.includes('battleship')
  ) return 'battleship';

  if (
    name.includes('galaxy')
    || name.includes('sovereign')
    || name.includes('warbird')
    || name.includes("der'idex")
    || name.includes('keldon')
    || name.includes('vulcan explorer')
    || name.includes('luxury liner')
    || name.includes('battlecruiser')
    || name.includes('battle cruiser')
  ) return 'capital';

  if (
    name.includes('cruiser') && !name.includes('light cruiser')
    || name.includes('nebula')
    || name.includes('ambassador')
    || name.includes('galor')
    || name.includes('vorcha')
    || name.includes("vor'cha")
    || name.includes('marauder')
    || name.includes('norexan')
    || name.includes('prometheus')
    || name.includes('akira')
    || name.includes('excelsior')
    || name.includes('tamarian warship')
    || name.includes('breen warship')
    || name.includes("son'a warship")
    || name.includes('azuki')
    || name.includes("c'thia")
    || name.includes('manticore')
    || name.includes('isaac')
  ) return 'cruiser';

  if (
    name.includes('intrepid')
    || name.includes("k'tinga")
    || name.includes('ktinga')
    || name.includes("jem'hadar fighter")
    || name.includes('jemhadar fighter')
  ) return 'lightCruiser';

  if (
    name.includes('nova')
    || name.includes('defiant')
    || name.includes('escort')
    || name.includes('science')
    || name.includes('saber')
    || name.includes('miranda')
    || name.includes('bird of prey')
  ) return 'escort';

  if (mass >= 9 || durability >= 1500) return 'battleship';
  if (mass >= 7 || cargo >= 700 || durability >= 1200) return 'capital';
  if (mass >= 5 || cargo >= 500 || durability >= 760) return 'cruiser';
  if (mass >= 4 || cargo >= 360 || durability >= 520) return 'lightCruiser';
  if (mass >= 2 || cargo >= 110 || durability >= 160) return 'escort';

  return 'shuttle';
}

function formatShipClass(shipClass = '') {
  const normalized = String(shipClass || '').trim();
  const labels = {
    shuttle: 'Shuttle',
    escort: 'Escort',
    science: 'Science Ship',
    lightCruiser: 'Light Cruiser',
    cruiser: 'Cruiser',
    capital: 'Capital Ship',
    battleship: 'Battleship',
    station: 'Station',
  };
  if (labels[normalized]) return labels[normalized];
  return normalized
    .replace(/([a-z])([A-Z])/g, '$1 $2')
    .replace(/\b\w/g, (letter) => letter.toUpperCase());
}

function getShipWeaponDamageFactor(shipId = state.playership, powerOwner = undefined) {
  const shipClass = getShipVisualClass(shipId);
  const stats = getShipStats(shipId);
  const mass = Math.max(1, finiteNumber(stats.mass, 1));
  const durability = Math.max(0, finiteNumber(stats.hull, 0) + finiteNumber(stats.shields, 0));
  const classFactor = SHIP_WEAPON_DAMAGE_FACTORS[shipClass] || 1;
  const massBonus = Math.max(0, mass - 1) * 0.024;
  const durabilityBonus = Math.min(0.18, durability / 6200);
  const clamped = clamp(classFactor + massBonus + durabilityBonus, 0.65, 2.15);
  if (powerOwner) return clamped * powerWeaponFactor(ensureNpcPower(powerOwner).dist);
  if (powerOwner === undefined && Number(shipId) === Number(state.playership)) return clamped * getPowerWeaponsFactor();
  return clamped;
}

function getScaledWeaponDamage(shipId = state.playership, weapon = getWeapon(), baseDamage = null, ownerScale = 1, powerOwner = undefined) {
  const base = Math.max(0, finiteNumber(baseDamage ?? weapon?.damage ?? PLAYER_WEAPON_DAMAGE, PLAYER_WEAPON_DAMAGE));
  if (base <= 0 || weapon?.type === 'Device') return 0;
  const type = String(weapon?.type || '').toLowerCase();
  const typeFactor = type === 'torpedo' ? 1.08 : type === 'heavy' ? 1.16 : type === 'turret' ? 0.94 : type === 'cannon' ? 0.9 : 1;
  return Math.max(1, Math.round(base * getShipWeaponDamageFactor(shipId, powerOwner) * typeFactor * ownerScale));
}

function getScaledWeaponCooldown(shipId = state.playership, weapon = getWeapon(), ownerScale = 1, floorScale = 1) {
  const base = Math.max(80, finiteNumber(weapon?.cooldown, PLAYER_WEAPON_COOLDOWN_MS));
  const type = String(weapon?.type || '').toLowerCase();
  const cooldownSettings = getWeaponCooldownSettings();
  const minimumsMs = cooldownSettings.minimumsMs || {};
  const typeFactors = cooldownSettings.typeFactors || {};
  const typeMinimum = finiteNumber(minimumsMs[type], finiteNumber(minimumsMs.default, 160));
  if (type === 'device') return Math.max(Math.round(typeMinimum * floorScale), Math.round(base * ownerScale));
  const stats = getShipStats(shipId);
  const shipClass = getShipVisualClass(shipId);
  const mass = Math.max(1, finiteNumber(stats.mass, 1));
  const durability = Math.max(0, finiteNumber(stats.hull, 0) + finiteNumber(stats.shields, 0));
  const classFactor = SHIP_WEAPON_RELOAD_FACTORS[shipClass] || 1;
  const powerReductionCap = finiteNumber(cooldownSettings.powerReductionCap, 0.08);
  const classFactorMin = finiteNumber(cooldownSettings.classFactorMin, 0.68);
  const classFactorMax = finiteNumber(cooldownSettings.classFactorMax, 1.25);
  const powerReduction = Math.min(powerReductionCap, Math.max(0, mass - 1) * 0.01 + durability / 14000);
  const typeFactor = finiteNumber(typeFactors[type], finiteNumber(typeFactors.default, 1));
  const cooldown = base * clamp(classFactor - powerReduction, classFactorMin, classFactorMax) * typeFactor * ownerScale;
  return Math.max(Math.round(typeMinimum * floorScale), Math.round(cooldown));
}

function getShipClassScale(playership = state.playership) {
  const stats = getShipStats(playership);
  const configuredScale = finiteNumber(state.shipSizeConfig?.shipScaleOverrides?.[Number(playership)], NaN);
  if (Number.isFinite(configuredScale) && configuredScale > 0) return configuredScale;

  const scaleByClass = state.shipSizeConfig?.classScales || DEFAULT_SHIP_SIZE_CONFIG.classScales;
  const shipClass = getShipVisualClass(playership);
  const classScale = scaleByClass[shipClass] || scaleByClass.shuttle || DEFAULT_SHIP_SIZE_CONFIG.classScales.shuttle;
  const manifestScale = finiteNumber(stats.drawScale, NaN);
  if (!Number.isFinite(manifestScale) || manifestScale <= 0) return classScale;

  // Preserve each hull's intended proportion while letting Size Rules control the class-wide scale.
  const manifestClass = stats.shipClass;
  const manifestClassScale = DEFAULT_SHIP_SIZE_CONFIG.classScales[manifestClass]
    || DEFAULT_SHIP_SIZE_CONFIG.classScales[shipClass]
    || DEFAULT_SHIP_SIZE_CONFIG.classScales.shuttle;
  return manifestScale * (classScale / manifestClassScale);
}

function getShipVisualScale(playership = state.playership) {
  // Pack draw sizes already include the class envelope. Do not multiply class scale again.
  if (getCatalogDrawSize(state.shipCatalog, playership)) return 1;
  return getShipClassScale(playership);
}

function getNpcSpriteScale(shipId, seedValue) {
  return getShipVisualScale(shipId) * getTrafficScaleMultiplier(seedValue);
}

function getShipVisualProfile(playership = state.playership) {
  const catalogSize = getCatalogDrawSize(state.shipCatalog, playership);
  if (catalogSize) {
    return {
      width: Math.round(clamp(catalogSize.width, 18, 520)),
      height: Math.round(clamp(catalogSize.height, 18, 520)),
      scale: 1,
    };
  }
  const catalogShip = state.shipCatalog?.getShip(Number(playership));
  if (catalogShip && !catalogShip.render) {
    // Prototype / unset size: do not invent a game envelope.
    return { width: 0, height: 0, scale: 1 };
  }
  const stats = getShipStats(playership);
  return {
    width: Math.round(clamp(finiteNumber(stats.drawWidth, 74), 18, 520)),
    height: Math.round(clamp(finiteNumber(stats.drawHeight, 74), 18, 520)),
    scale: getShipVisualScale(playership),
  };
}

function getShipScreenRadius(playership = state.playership, scale = undefined) {
  const visual = getShipVisualProfile(playership);
  const drawScale = finiteNumber(scale, visual.scale);
  return Math.max(18, Math.max(visual.width, visual.height) * drawScale * 0.46);
}

function getShipTargetFrameRadius(playership = state.playership, scale = undefined) {
  const visual = getShipVisualProfile(playership);
  const drawScale = finiteNumber(scale, visual.scale);
  const halfDiagonal = Math.hypot(visual.width * drawScale, visual.height * drawScale) * 0.5;
  return Math.max(32, halfDiagonal * 0.82);
}

function getStationTargetFrameRadius(station = {}) {
  const visual = getStationVisualProfile(station);
  const halfDiagonal = Math.hypot(visual.width * visual.scale, visual.height * visual.scale) * 0.5;
  return Math.max(48, halfDiagonal * 0.82);
}

function getShipHandlingProfile(playership = state.playership) {
  const stats = getShipStats(playership);
  const shipClass = getShipVisualClass(playership);
  const visualScale = getShipClassScale(playership);
  const mass = Math.max(1, finiteNumber(stats.mass, 1));
  const manifestTurnRate = Math.max(1, finiteNumber(stats.turnRate, DEFAULT_SHIP_SIZE_CONFIG.classTurnRates[shipClass] || 8));
  const classTurnRate = Math.max(
    1,
    finiteNumber(
      state.shipSizeConfig?.classTurnRates?.[shipClass],
      DEFAULT_SHIP_SIZE_CONFIG.classTurnRates[shipClass] || manifestTurnRate,
    ),
  );
  const classWarpMultiplier = Math.max(
    1,
    finiteNumber(
      state.shipSizeConfig?.classSystemWarpMultipliers?.[shipClass],
      DEFAULT_SHIP_SIZE_CONFIG.classSystemWarpMultipliers[shipClass] || 3,
    ),
  );
  const sizePenalty = clamp(
    1 - Math.max(0, visualScale - 1) * 0.035 - Math.max(0, mass - 1) * 0.015,
    0.72,
    1.08,
  );
  const legacyTurnBase = manifestTurnRate < classTurnRate
    ? manifestTurnRate * 0.55 + classTurnRate * 0.45
    : classTurnRate;
  // Reviewed hull handling is deliberate; old records keep the class-based fallback.
  const turnBase = Math.max(1, finiteNumber(stats.handlingTurnRate, legacyTurnBase));
  const turnRate = clamp(turnBase * sizePenalty, 2.8, 22);
  const maxTurnSpeed = clamp(turnRate * 0.31, 0.82, 4.9);
  const turnAcceleration = clamp(turnRate * 0.22, 0.5, 3.35);
  return {
    shipClass,
    manifestTurnRate,
    turnRate,
    maxTurnSpeed,
    turnAcceleration,
    turnDamping: Math.max(0.1, turnAcceleration * 0.24),
    systemWarpMultiplier: clamp(classWarpMultiplier, 1.4, 5),
    systemWarpTurnPenalty: clamp(0.48 - Math.max(0, visualScale - 1) * 0.026, 0.28, 0.5),
  };
}

function getNpcFlightProfile(shipId, seed = 1) {
  const stats = getShipStats(shipId);
  const handling = getShipHandlingProfile(shipId);
  const topSpeed = Math.max(1, finiteNumber(stats.topSpeed, 15));
  const speed = clamp(0.36 + topSpeed / 105 + seeded(seed + 7) * 0.34, 0.48, 1.85);
  return {
    speed,
    turnRate: clamp(handling.maxTurnSpeed * (0.36 + seeded(seed + 8) * 0.24), 0.24, 1.65),
    systemWarpMultiplier: clamp(1 + (handling.systemWarpMultiplier - 1) * 0.58, 1.25, 2.85),
  };
}

function getShipWarpRange(playership = state.playership) {
  const stats = getShipStats(playership);
  const configuredRange = finiteNumber(stats.warpRange, NaN);
  if (Number.isFinite(configuredRange) && configuredRange > 0) {
    return Math.round(configuredRange);
  }
  const shipClass = getShipVisualClass(playership);
  const classRange = SHIP_WARP_CLASS_RANGES[shipClass] || SHIP_WARP_CLASS_RANGES.escort;
  const mass = Math.max(1, finiteNumber(stats.mass, 1));
  const cargo = Math.max(0, finiteNumber(stats.cargoCapacity, 0));
  const hull = Math.max(0, finiteNumber(stats.hull, 0));
  const shields = Math.max(0, finiteNumber(stats.shields, 0));
  const topSpeed = Math.max(1, finiteNumber(stats.topSpeed, 15));
  const antimatterUse = Math.max(1, finiteNumber(stats.antimatterUse, 3));
  const cost = Math.max(0, finiteNumber(stats.cost, 0));
  const massScore = clamp((mass - 1) / 9, 0, 1);
  const cargoScore = clamp(Math.log10(cargo + 10) / Math.log10(2510), 0, 1);
  const durabilityScore = clamp(Math.sqrt(hull + shields) / Math.sqrt(2200), 0, 1);
  const valueScore = clamp(Math.log10(cost + 10) / Math.log10(350010), 0, 1);
  const driveScore = clamp((Math.min(antimatterUse, 12) - 1) / 11, 0, 1);
  const speedScore = clamp((topSpeed - 15) / 65, 0, 1);
  const classScore = clamp(
    0.1
      + massScore * 0.16
      + cargoScore * 0.1
      + durabilityScore * 0.19
      + valueScore * 0.18
      + driveScore * 0.18
      + speedScore * 0.09,
    0,
    1,
  );
  return Math.round(classRange.min + (classRange.max - classRange.min) * classScore);
}

function getRouteWarpDistance(route) {
  if (!route) return Infinity;
  const multiplier = ROUTE_RANGE_MULTIPLIERS[route.type] || 1;
  return Math.max(1, Math.round(route.distance * multiplier));
}

function getAntimatterWarpRange(antimatter = state.antimatter) {
  return Math.max(0, Math.floor(antimatter) * WARP_RANGE_PER_ANTIMATTER);
}

function getRouteRangeStatus(route) {
  const distance = getRouteWarpDistance(route);
  const shipRange = getShipWarpRange();
  const fuelRange = getAntimatterWarpRange();
  return {
    distance,
    shipRange,
    fuelRange,
    effectiveRange: Math.min(shipRange, fuelRange),
    hasShipRange: distance <= shipRange,
    hasFuelRange: distance <= fuelRange,
    canTravel: distance <= shipRange && distance <= fuelRange,
  };
}

function getAsteroidKey(asteroid) {
  return asteroid?.id || `${state.currentPlanet}:${Math.round(asteroid?.originX || asteroid?.x || 0)}:${Math.round(asteroid?.originY || asteroid?.y || 0)}`;
}

function isAsteroidAvailable(asteroid) {
  return asteroid && !asteroid.depleted && !state.depletedAsteroids[getAsteroidKey(asteroid)];
}

function getAsteroidSprite(asteroid) {
  const variants = sprites.asteroidVariants || [];
  const fallback = sprites.asteroid;
  if (!variants.length) return fallback;
  const seedValue = finiteNumber(asteroid?.driftSeed, finiteNumber(asteroid?.r, 1) * 37);
  const index = clamp(
    Math.round(finiteNumber(asteroid?.spriteIndex, Math.floor(seeded(seedValue) * variants.length))),
    0,
    variants.length - 1,
  );
  const sprite = variants[index];
  return sprite?.complete && sprite.naturalWidth > 0 ? sprite : fallback;
}

function getAsteroidTransportDistance(asteroid) {
  return ASTEROID_TRANSPORT_RANGE + Math.max(0, finiteNumber(asteroid?.r, 16));
}

function getNearestTransportAsteroid(range = ASTEROID_TRANSPORT_RANGE) {
  let nearest = null;
  let nearestDistance = Infinity;
  for (const asteroid of state.asteroids || []) {
    if (!isAsteroidAvailable(asteroid)) continue;
    const distance = distanceToPlayer(asteroid);
    const harvestRange = range + Math.max(0, finiteNumber(asteroid.r, 16));
    if (distance <= harvestRange && distance < nearestDistance) {
      nearest = asteroid;
      nearestDistance = distance;
    }
  }
  return nearest ? { asteroid: nearest, distance: nearestDistance } : null;
}

function findAsteroidAtScreen(x, y) {
  let best = null;
  let bestDistance = Infinity;
  for (const asteroid of state.asteroids || []) {
    if (!isAsteroidAvailable(asteroid)) continue;
    const p = worldToScreen(asteroid);
    const radius = Math.max(14, finiteNumber(asteroid.r, 16) * 1.4);
    const distance = Math.hypot(x - p.x, y - p.y);
    if (distance <= radius && distance < bestDistance) {
      best = asteroid;
      bestDistance = distance;
    }
  }
  return best;
}

function findWormholeAtScreen(x, y) {
  if (!state.wormhole) return null;
  const p = worldToScreen(state.wormhole);
  const distance = Math.hypot(x - p.x, y - p.y);
  return distance <= 38 ? state.wormhole : null;
}

function isWormholeTransitActive() {
  return Boolean(state.wormholeTransit?.active);
}

function completeWormholeTransit(targetIndex, wormhole = state.wormhole, options = {}) {
  const target = state.planets[targetIndex];
  if (!target) return false;
  const wormholeName = wormhole?.name || 'wormhole';
  state.mapOpen = false;
  closePlanetMenu();
  state.docked = false;
  state.dockedPlanetIndex = null;
  state.dockedStationId = null;
  closePlayerSecurityOrders(state.currentPlanet, 'departed', 'left the system'); // a completed transit is an actual departure
  state.currentPlanet = targetIndex;
  state.myplanet = state.currentPlanet + 1;
  markSystemVisited(state.currentPlanet);
  state.selectedPlanet = state.currentPlanet;
  state.planetCallout = null;
  state.warp.active = false;
  state.projectiles = [];
  state.weaponEffects = [];
  state.tractorBeams = [];
  state.combatTargetId = null;
  state.combatTargetType = 'ship';
  applySystemState(state.currentPlanet);
  calmHomeSystem();
  scheduleNextFleetAttack(performance.now() + 45000);
  if (state.wormhole) {
    setCamera(state.wormhole.x + 90, state.wormhole.y + 60);
  } else {
    setCameraNearPlanet();
    placePlayerAtSecurityApproach();
  }
  state.ship.velocity = 0;
  state.ship.turnVelocity = 0;
  state.ship.forwardThrustStartedAt = 0;
  state.ship.systemWarpIntensity = 0;
  if (!options.silent) setLog(`Exited ${wormholeName} at ${target.name}.`);
  syncLegacyState();
  updateStats();
  return true;
}

function startWormholeTransit(targetIndex, wormhole = state.wormhole) {
  const target = state.planets[targetIndex];
  if (!target) return false;
  const wormholeName = wormhole?.name || 'wormhole';
  closePlanetMenu();
  state.mapOpen = false;
  state.docked = false;
  state.dockedPlanetIndex = null;
  state.dockedStationId = null;
  state.ship.velocity = 0;
  state.ship.turnVelocity = 0;
  state.ship.forwardThrustStartedAt = 0;
  state.ship.systemWarpIntensity = 0;
  state.wormholeTransit = {
    active: true,
    from: state.currentPlanet,
    to: targetIndex,
    name: wormholeName,
    startedAt: performance.now(),
    duration: WORMHOLE_TRANSIT_DURATION_MS,
    switched: false,
  };
  playGameSound('wormholeOpen', { cooldownKey: 'wormhole:open' });
  setLog(`Entering ${wormholeName}...`);
  updateStats();
  return true;
}

function updateWormholeTransit(now = performance.now()) {
  const transit = state.wormholeTransit;
  if (!transit?.active) return;
  const progress = clamp((now - transit.startedAt) / Math.max(1, transit.duration), 0, 1);
  if (!transit.switched && progress >= WORMHOLE_TRANSIT_SWITCH_AT) {
    transit.switched = true;
    completeWormholeTransit(transit.to, { name: transit.name }, { silent: true });
    state.wormholeTransit = transit;
  }
  if (progress >= 1) {
    const target = state.planets[transit.to];
    state.wormholeTransit = {
      active: false,
      from: null,
      to: null,
      name: '',
      startedAt: 0,
      duration: WORMHOLE_TRANSIT_DURATION_MS,
      switched: false,
    };
    playGameSound('warpDrop', { cooldownKey: 'wormhole:exit', volume: 0.65 });
    setLog(`Exited ${transit.name || 'wormhole'} at ${target?.name || 'destination system'}.`);
    updateStats();
  }
}

function clearWormholeTransit() {
  state.wormholeTransit = {
    active: false,
    from: null,
    to: null,
    name: '',
    startedAt: 0,
    duration: WORMHOLE_TRANSIT_DURATION_MS,
    switched: false,
  };
}

function tryEnterWormhole(wormhole = state.wormhole) {
  if (!wormhole || state.warp.active || isWormholeTransitActive()) return false;
  const targetIndex = Number(wormhole.targetIndex);
  if (!Number.isFinite(targetIndex) || !state.planets[targetIndex]) {
    setLog('This wormhole is unstable.');
    return false;
  }
  const distance = distanceToPlayer(wormhole);
  if (distance > WORMHOLE_USE_RANGE) {
    setLog(`Move closer to ${wormhole.name || 'the wormhole'} to enter.`);
    addWorldPop(wormhole.x, wormhole.y - 36, 'Too far');
    return false;
  }
  return startWormholeTransit(targetIndex, wormhole);
}

function isWormholeGeneratorStation(station) {
  return Number(station?.stationTypeId) === WORMHOLE_STATION_TYPE_ID;
}

function getWormholeTransitForStation(station) {
  if (!isWormholeGeneratorStation(station)) return null;
  const link = getSystemWormholeLinks(state.currentPlanet)[0] || null;
  const targetIndex = getWormholeDestinationIndex(link, state.currentPlanet);
  if (!link || targetIndex === null || !state.planets[targetIndex]) return null;
  return {
    ...(state.wormhole || {}),
    ...link,
    linkId: link.id,
    targetIndex,
    x: station.x,
    y: station.y,
    name: link.name || station.name || 'Wormhole Generator',
  };
}

function tryEnterWormholeStation(station) {
  if (!isWormholeGeneratorStation(station)) return false;
  if (station.destroyed) {
    setLog(`${station.name || 'Wormhole Generator'} is destroyed.`);
    return true;
  }
  if (station.hostile || station.attitude === 'hostile') {
    setLog(`${station.name || 'Wormhole Generator'} is hostile. Target locked.`);
    return false;
  }
  const wormhole = getWormholeTransitForStation(station);
  if (!wormhole) {
    setLog(`${station.name || 'Wormhole Generator'} has no stable destination.`);
    return true;
  }
  tryEnterWormhole(wormhole);
  return true;
}

function getRouteCostForDistance(distance) {
  if (Number(distance) <= 0) return 0;
  return Math.max(1, Math.ceil(Math.max(1, distance) / WARP_RANGE_PER_ANTIMATTER));
}

function getRouteOtherEnd(route, index) {
  if (route.from === index) return route.to;
  if (route.to === index) return route.from;
  return null;
}

function getPlottedRoute(from = state.currentPlanet, to = state.selectedPlanet) {
  if (from === to) {
    return { from, to, legs: [], systems: [from], distance: 0, antimatter: 0 };
  }
  if (!state.travelRoutes.length) rebuildTravelRoutes();
  const count = state.planets.length;
  const distance = Array(count).fill(Infinity);
  const previous = Array(count).fill(null);
  const visited = new Set();
  distance[from] = 0;

  while (visited.size < count) {
    let current = -1;
    let best = Infinity;
    for (let i = 0; i < count; i++) {
      if (!visited.has(i) && distance[i] < best) {
        current = i;
        best = distance[i];
      }
    }
    if (current === -1 || current === to) break;
    visited.add(current);
    for (const route of state.travelRoutes) {
      const next = getRouteOtherEnd(route, current);
      if (next === null || visited.has(next)) continue;
      const candidate = distance[current] + getRouteWarpDistance(route);
      if (candidate < distance[next]) {
        distance[next] = candidate;
        previous[next] = { system: current, route };
      }
    }
  }

  if (!Number.isFinite(distance[to])) return null;
  const legs = [];
  const systems = [to];
  let cursor = to;
  while (cursor !== from) {
    const step = previous[cursor];
    if (!step) return null;
    legs.unshift(step.route);
    cursor = step.system;
    systems.unshift(cursor);
  }
  return {
    from,
    to,
    legs,
    systems,
    distance: Math.round(distance[to]),
    antimatter: getRouteCostForDistance(distance[to]),
  };
}

function getPlottedRouteStatus(plan) {
  if (!plan) return null;
  const shipRange = getShipWarpRange();
  const fuelRange = getAntimatterWarpRange();
  return {
    distance: plan.distance,
    shipRange,
    fuelRange,
    antimatter: plan.antimatter,
    hasShipRange: plan.distance <= shipRange,
    hasFuelRange: plan.distance <= fuelRange,
    canTravel: plan.distance <= shipRange && plan.distance <= fuelRange,
  };
}

function getNpcCombatDurability(shipId) {
  const stats = getShipStats(shipId);
  const hull = Math.max(1, finiteNumber(stats.hull, 5));
  const shields = Math.max(0, finiteNumber(stats.shields, 0));
  const mass = Math.max(1, finiteNumber(stats.mass, 1));
  return {
    hull: Math.round(34 + hull * 5 + mass * 5),
    shields: Math.round(shields > 0 ? 12 + shields * 4 + mass * 2 : 0),
  };
}

function getStationCombatDurability(station) {
  const stats = getShipStats(station.stationTypeId);
  const tier = getStationDefenseTier(stats);
  const hull = Math.min(4500, Math.max(40, finiteNumber(stats.hull, 90)));
  const shields = Math.min(4500, Math.max(0, finiteNumber(stats.shields, 70)));
  const condition = clamp(finiteNumber(station.condition, 100), 25, 130) / 100;
  const combatScale = clamp(Math.sqrt(Math.max(0.8, getStationVisualProfile(station).scale)), 0.9, 1.6);
  return {
    hull: Math.round(clamp((120 + hull * (1.1 + tier * 0.42)) * condition * combatScale, 120, 8500)),
    shields: Math.round(clamp((shields > 0 ? 80 + shields * (0.95 + tier * 0.32) : 0) * condition * combatScale, 0, 8500)),
  };
}

function ensureNpcCombatStats(npc) {
  const durability = getNpcCombatDurability(npc.shipId);
  if (!Number.isFinite(npc.maxCombatHull) || npc.maxCombatHull <= 0) {
    npc.maxCombatHull = durability.hull;
  }
  if (!Number.isFinite(npc.combatHull) || npc.combatHull <= 0) {
    npc.combatHull = npc.maxCombatHull;
  }
  if (!Number.isFinite(npc.maxCombatShields) || npc.maxCombatShields < 0) {
    npc.maxCombatShields = durability.shields;
  }
  if (!Number.isFinite(npc.combatShields) || npc.combatShields < 0) {
    npc.combatShields = npc.maxCombatShields;
  }
}

function ensureStationCombatStats(station) {
  const durability = getStationCombatDurability(station);
  if (!Number.isFinite(station.maxCombatHull) || station.maxCombatHull <= 0) {
    station.maxCombatHull = durability.hull;
  }
  if (!Number.isFinite(station.combatHull) || station.combatHull <= 0) {
    station.combatHull = station.maxCombatHull;
  }
  if (!Number.isFinite(station.maxCombatShields) || station.maxCombatShields < 0) {
    station.maxCombatShields = durability.shields;
  }
  if (!Number.isFinite(station.combatShields) || station.combatShields < 0) {
    station.combatShields = station.maxCombatShields;
  }
}

function regenerateShieldPool(entity, maxShield, regenPerSecond, frameScale = 1, now = performance.now()) {
  if (!Number.isFinite(maxShield) || maxShield <= 0) return false;
  const shieldKey = Object.prototype.hasOwnProperty.call(entity, 'combatShields') ? 'combatShields' : 'shields';
  const current = clamp(finiteNumber(entity[shieldKey], maxShield), 0, maxShield);
  if (current >= maxShield) return false;
  if (now - (entity.lastShieldHitAt || 0) < SHIELD_REGEN_DELAY_MS) return false;
  const regenerated = Math.min(maxShield, current + regenPerSecond * (frameScale / 60));
  entity[shieldKey] = regenerated;
  return Math.floor(regenerated) !== Math.floor(current);
}

function updateShieldRegeneration(frameScale = 1) {
  const now = performance.now();
  // Ships recover through the shared energy budget in updatePowerSystems.
  for (const station of state.stations) {
    if (station.destroyed) continue;
    ensureStationCombatStats(station);
    regenerateShieldPool(station, station.maxCombatShields, STATION_SHIELD_REGEN_PER_SEC, frameScale, now);
  }
}

function applyCurrentShipStats(resetCondition = false) {
  const stats = getShipStats();
  const mass = Math.max(1, finiteNumber(stats.mass, 1));
  const topSpeed = Math.max(1, finiteNumber(stats.topSpeed, 15));
  const handling = getShipHandlingProfile(state.playership);
  const turnRate = handling.turnRate;

  state.mymass = mass;
  state.antimatteruse = finiteNumber(stats.antimatterUse, 3);
  state.tothull = finiteNumber(stats.hull, state.tothull);
  state.totshields = finiteNumber(stats.shields, state.totshields);
  state.totspeed = topSpeed;
  state.totturn = turnRate;
  state.cargoCap = Math.max(state.cargo, finiteNumber(stats.cargoCapacity, state.cargoCap));
  state.totcargo = state.cargoCap;

  const flashTurnRate = Math.max(1, Math.round(8 - mass));
  const flashThrust = 2 / Math.max(0.5, (8 - flashTurnRate) / 2);
  // Most imported topSpeed values exceeded the old /4 cap. An explicit impulse
  // value preserves the difference between a fast scout and a slow freighter.
  const baseMaxSpeed = clamp(finiteNumber(stats.impulseSpeed, topSpeed / 4), 2.5, 8.5);
  state.ship.baseMaxSpeed = baseMaxSpeed;
  state.ship.maxSpeed = baseMaxSpeed * getPowerEnginesFactor();
  state.ship.acceleration = Math.max(0.18, Math.min(1.15, flashThrust / 4));
  state.ship.brake = state.ship.acceleration;
  state.ship.turnAcceleration = handling.turnAcceleration;
  state.ship.turnDamping = handling.turnDamping;
  state.ship.maxTurnSpeed = handling.maxTurnSpeed;
  state.ship.systemWarpMultiplier = handling.systemWarpMultiplier;
  state.ship.systemWarpTurnPenalty = handling.systemWarpTurnPenalty;
  state.ship.systemWarpIntensity = clamp(finiteNumber(state.ship.systemWarpIntensity, 0), 0, 1);
  state.ship.warpThreshold = baseMaxSpeed * 1.6;
  const visual = getShipVisualProfile(state.playership);
  state.ship.drawWidth = visual.width;
  state.ship.drawHeight = visual.height;
  state.ship.drawScale = visual.scale;
  state.ship.velocity = Math.max(0, Math.min(state.ship.velocity || 0, state.ship.maxSpeed));

  if (resetCondition) {
    state.hull = 100;
    state.shields = 100;
    state.lastShieldHitAt = 0;
    if (!state.power || typeof state.power !== 'object') state.power = { energy: 0, dist: {} };
    state.power.energy = getPowerMaxEnergy();
    state.fuelCap = Math.max(80, Math.round(finiteNumber(stats.fuelCapacity, state.antimatteruse * 30)));
  }
  syncFuelToAntimatter();
}

async function fetchJsonOrNull(src) {
  try {
    const response = await fetch(src);
    if (!response.ok) throw new Error(`Unable to load ${src}`);
    return await response.json();
  } catch {
    return null;
  }
}

function cloneJson(value) {
  if (value === undefined || value === null) return value;
  return JSON.parse(JSON.stringify(value));
}

function loadModDataOverrides() {
  try {
    const raw = localStorage.getItem(MOD_DATA_STORAGE_KEY);
    const parsed = raw ? JSON.parse(raw) : {};
    return parsed && typeof parsed === 'object' ? parsed : {};
  } catch {
    return {};
  }
}

function saveModDataOverrides(overrides = {}) {
  localStorage.setItem(MOD_DATA_STORAGE_KEY, JSON.stringify(overrides));
}

function getModDataOverride(file) {
  const overrides = loadModDataOverrides();
  return overrides[file]?.data ? cloneJson(overrides[file].data) : null;
}

function setModDataOverride(file, data) {
  const overrides = loadModDataOverrides();
  overrides[file] = {
    version: EDITOR_DATA_VERSION,
    savedAt: new Date().toISOString(),
    data: cloneJson(data),
  };
  saveModDataOverrides(overrides);
}

function clearModDataOverride(file) {
  const overrides = loadModDataOverrides();
  delete overrides[file];
  saveModDataOverrides(overrides);
}

function hasModDataOverride(file) {
  const overrides = loadModDataOverrides();
  return Boolean(overrides[file]?.data);
}

async function fetchModdableJson(file, src, fallback = null) {
  const override = getModDataOverride(file);
  if (override) return override;
  const data = await fetchJsonOrNull(src);
  return data ?? cloneJson(fallback);
}

function normalizeShipSizeConfig(config = {}) {
  const classScales = { ...DEFAULT_SHIP_SIZE_CONFIG.classScales };
  for (const [shipClass, scale] of Object.entries(config.classScales || {})) {
    const numericScale = finiteNumber(scale, NaN);
    if (Number.isFinite(numericScale) && numericScale > 0) classScales[shipClass] = numericScale;
  }

  const classTurnRates = { ...DEFAULT_SHIP_SIZE_CONFIG.classTurnRates };
  for (const [shipClass, turnRate] of Object.entries(config.classTurnRates || {})) {
    const numericTurnRate = finiteNumber(turnRate, NaN);
    if (Object.prototype.hasOwnProperty.call(classScales, shipClass) && Number.isFinite(numericTurnRate) && numericTurnRate > 0) {
      classTurnRates[shipClass] = numericTurnRate;
    }
  }

  const classSystemWarpMultipliers = { ...DEFAULT_SHIP_SIZE_CONFIG.classSystemWarpMultipliers };
  for (const [shipClass, multiplier] of Object.entries(config.classSystemWarpMultipliers || {})) {
    const numericMultiplier = finiteNumber(multiplier, NaN);
    if (Object.prototype.hasOwnProperty.call(classScales, shipClass) && Number.isFinite(numericMultiplier) && numericMultiplier >= 1) {
      classSystemWarpMultipliers[shipClass] = numericMultiplier;
    }
  }

  const trafficScaleVariance = { ...DEFAULT_SHIP_SIZE_CONFIG.trafficScaleVariance };
  const min = finiteNumber(config.trafficScaleVariance?.min, trafficScaleVariance.min);
  const max = finiteNumber(config.trafficScaleVariance?.max, trafficScaleVariance.max);
  if (Number.isFinite(min) && min > 0) trafficScaleVariance.min = min;
  if (Number.isFinite(max) && max >= trafficScaleVariance.min) trafficScaleVariance.max = max;

  const validClasses = new Set(Object.keys(classScales));
  const shipClassOverrides = {};
  for (const [shipId, shipClass] of Object.entries(config.shipClassOverrides || {})) {
    if (validClasses.has(shipClass)) shipClassOverrides[shipId] = shipClass;
  }

  const shipScaleOverrides = {};
  for (const [shipId, scale] of Object.entries(config.shipScaleOverrides || {})) {
    const numericScale = finiteNumber(scale, NaN);
    if (Number.isFinite(numericScale) && numericScale > 0) shipScaleOverrides[shipId] = numericScale;
  }

  return {
    classScales,
    classTurnRates,
    classSystemWarpMultipliers,
    trafficScaleVariance,
    shipClassOverrides,
    shipScaleOverrides,
  };
}

async function loadShipSizeConfig() {
  const config = await fetchModdableJson('ship_size_config.json', `data/ship_size_config.json?v=${SHIP_SIZE_CONFIG_VERSION}`);
  state.shipSizeConfig = normalizeShipSizeConfig(config || DEFAULT_SHIP_SIZE_CONFIG);
}

function imageCandidatesForEntity(entity) {
  return [entity.image]
    .filter(Boolean)
    .map((src) => `${src}?v=${ENTITY_SPRITE_ASSET_VERSION}`)
    .filter((src, index, list) => list.indexOf(src) === index);
}

async function loadEntityManifests() {
  const [starshipManifest, stationManifest, podManifest] = await Promise.all([
    fetchModdableJson('starship_manifest.json', `data/starship_manifest.json?v=${ENTITY_MANIFEST_DATA_VERSION}`),
    fetchModdableJson('station_manifest.json', `data/station_manifest.json?v=${ENTITY_MANIFEST_DATA_VERSION}`),
    fetchModdableJson('pod_manifest.json', 'data/pod_manifest.json'),
  ]);
  const starships = (starshipManifest?.ships || []).map((entity) => ({ ...entity, assetType: 'ship' }));
  const stations = (stationManifest?.stations || []).map((entity) => ({ ...entity, assetType: 'station' }));
  const pods = (podManifest?.pods || []).map((entity) => ({ ...entity, assetType: 'pod' }));
  return [...starships, ...stations, ...pods];
}

async function loadShipManifest() {
  try {
    const [entities, , catalog] = await Promise.all([
      loadEntityManifests(),
      loadShipSizeConfig(),
      loadGameShipCatalog().catch((error) => {
        console.warn('[bm-ships] catalog failed to load; remaster manifest remains in use.', error);
        return null;
      }),
    ]);
    state.shipCatalog = catalog;
    const merged = mergeCatalogIntoEntities(entities, catalog);
    state.shipStatsById = Object.fromEntries(merged.map((ship) => [Number(ship.id), ship]));
    state.shipImageCandidatesById = Object.fromEntries(
      merged.map((ship) => {
        const catalogSrc = catalogImageUrl(catalog, ship.id);
        const candidates = catalogSrc ? [catalogSrc] : imageCandidatesForEntity(ship);
        return [Number(ship.id), candidates];
      }),
    );
    state.shipImageBoundsById = Object.fromEntries(
      merged
        .filter((ship) => ship.trimBounds)
        .map((ship) => [Number(ship.id), ship.trimBounds]),
    );
    state.shipSpriteCandidateIndex = {};
    state.shipSprites = {};
    state.shipImageById = Object.fromEntries(
      merged
        .map((ship) => [Number(ship.id), (state.shipImageCandidatesById[Number(ship.id)] || [])[0]])
        .filter(([, src]) => src),
    );
    const trafficIds = merged
      .filter((ship) => {
        if (ship.assetType !== 'ship') return false;
        if (ship.rosterState === 'retired' || ship.rosterState === 'prototype') return false;
        if (Object.prototype.hasOwnProperty.call(ship, 'trafficEligible')) return ship.trafficEligible;
        return !NON_TRAFFIC_SHIP_TERMS.some((term) => String(ship.name || '').toLowerCase().includes(term));
      })
      .map((ship) => Number(ship.id))
      .filter((id) => Number.isFinite(id));
    state.npcShipIds = trafficIds.length ? trafficIds : FALLBACK_NPC_SHIP_IDS;
    state.systemStates = {};
    applySystemState(state.currentPlanet);
    applyCurrentShipStats(false);
    updateStats();
  } catch {
    state.npcShipIds = FALLBACK_NPC_SHIP_IDS;
    applyCurrentShipStats(false);
  }
}

function getShipImageCandidates(id) {
  const numericId = Number(id);
  const imageId = resolveShipId(numericId);
  const catalogSrc = catalogImageUrl(state.shipCatalog, imageId);
  if (catalogSrc) return [catalogSrc];
  const configured = state.shipImageCandidatesById[imageId];
  if (configured?.length) return configured;
  return [
    `assets/game/ships/${imageId}.png`,
    `assets/game/stations/${imageId}.png`,
    `assets/game/pods/${imageId}.png`,
  ];
}

function getShipImageSrc(id) {
  const numericId = Number(id);
  const imageId = resolveShipId(numericId);
  const candidates = getShipImageCandidates(imageId);
  const index = Math.max(0, Math.min(state.shipSpriteCandidateIndex[imageId] || 0, candidates.length - 1));
  return candidates[index] || state.shipImageById[imageId] || `assets/game/ships/${imageId}.png`;
}

function getShipSprite(playership = state.playership) {
  const id = resolveShipId(Number(playership) || 18);
  const candidates = getShipImageCandidates(id);
  const src = getShipImageSrc(id);
  if (!state.shipSprites[id] || state.shipSprites[id].bm2Src !== src) {
    const img = new Image();
    img.bm2Src = src;
    img.bm2TrimBounds = state.shipImageBoundsById[id] || null;
    img.onerror = () => {
      const currentIndex = state.shipSpriteCandidateIndex[id] || 0;
      if (currentIndex < candidates.length - 1) {
        state.shipSpriteCandidateIndex[id] = currentIndex + 1;
        delete state.shipSprites[id];
      }
    };
    img.src = src;
    state.shipSprites[id] = img;
  }
  return state.shipSprites[id];
}

function getFactionHint(playership) {
  const symbols = state.flaHints?.symbols || [];
  const token = `if (_root.playership == ${playership}`;
  for (const s of symbols) {
    for (const m of s.matches || []) {
      if (m.includes(token)) return `${s.symbol}: ${m.slice(0, 120)}`;
    }
  }
  return null;
}

const factionNames = {
  terran: 'Terran',
  ferengi: 'Ferengi',
  vulcan: 'Vulcan',
  romulan: 'Romulan',
  cardassian: 'Cardassian',
  klingon: 'Klingon',
  dominion: 'Dominion',
  breen: 'Breen',
  tholian: 'Tholian',
  bajoran: 'Bajoran',
  sona: "Son'a",
  delpin: 'Delpin',
  tarellian: 'Tarellian',
  promelli: 'Promelli',
  andorian: 'Andorian',
  gorn: 'Gorn',
  hirogen: 'Hirogen',
  suliban: 'Suliban',
  borg: 'Borg',
  pirate: 'Pirate',
  neutral: 'Independent',
};

const factionRelations = {
  terran: { friendly: ['vulcan', 'andorian', 'bajoran'], hostile: ['dominion', 'cardassian', 'klingon', 'romulan', 'gorn', 'hirogen', 'suliban', 'borg'] },
  vulcan: { friendly: ['terran', 'andorian', 'bajoran'], hostile: ['dominion', 'cardassian', 'klingon', 'hirogen', 'borg'] },
  romulan: { friendly: ['klingon'], hostile: ['dominion', 'cardassian', 'terran', 'vulcan', 'andorian', 'borg'] },
  cardassian: { friendly: ['dominion'], hostile: ['terran', 'romulan', 'klingon', 'vulcan', 'andorian', 'bajoran', 'borg'] },
  klingon: { friendly: ['romulan'], hostile: ['dominion', 'cardassian', 'terran', 'vulcan', 'andorian', 'gorn', 'borg'] },
  dominion: { friendly: ['cardassian'], hostile: ['terran', 'romulan', 'klingon', 'vulcan', 'ferengi', 'andorian', 'bajoran', 'hirogen', 'borg'] },
  breen: { friendly: [], hostile: ['terran', 'romulan', 'klingon', 'vulcan', 'ferengi', 'andorian', 'borg'] },
  tholian: { friendly: [], hostile: ['dominion', 'cardassian', 'klingon', 'terran', 'pirate', 'gorn', 'suliban', 'borg'] },
  bajoran: { friendly: ['terran', 'vulcan', 'andorian'], hostile: ['dominion', 'cardassian', 'pirate', 'borg'] },
  ferengi: { friendly: [], hostile: ['dominion'] },
  andorian: { friendly: ['terran', 'vulcan'], hostile: ['dominion', 'cardassian', 'romulan', 'gorn', 'borg'] },
  gorn: { friendly: [], hostile: ['terran', 'andorian', 'klingon', 'borg'] },
  hirogen: { friendly: [], hostile: ['terran', 'dominion', 'vulcan', 'borg'] },
  suliban: { friendly: [], hostile: ['terran', 'tholian', 'borg'] },
  pirate: { friendly: [], hostile: ['terran', 'ferengi', 'vulcan', 'romulan', 'cardassian', 'klingon', 'dominion', 'tholian', 'andorian', 'gorn', 'hirogen', 'suliban'] },
  borg: { friendly: [], hostile: ['terran', 'ferengi', 'vulcan', 'romulan', 'cardassian', 'klingon', 'dominion', 'tholian', 'bajoran', 'breen', 'sona', 'delpin', 'tarellian', 'promelli', 'andorian', 'gorn', 'hirogen', 'suliban', 'neutral', 'pirate'] },
  // Phase 1 relationship contract: explicit empty lists mean "no declared alliance or enmity",
  // not immunity, a ceasefire, or shared organization (neutral is a status, not a faction).
  delpin: { friendly: [], hostile: [] },
  promelli: { friendly: [], hostile: [] },
  sona: { friendly: [], hostile: [] },
  tarellian: { friendly: [], hostile: [] },
  neutral: { friendly: [], hostile: [] },
};

const EMPTY_FACTION_RELATIONS = Object.freeze({ friendly: Object.freeze([]), hostile: Object.freeze([]) });
const warnedRelationKeys = new Set();
// Single accessor for the relation table. Unknown keys resolve to no declared relationship and
// warn once, so a new faction key cannot silently inherit or lose behavior.
function getFactionRelations(faction) {
  const raw = String(faction || '').trim().toLowerCase();
  if (!raw) return EMPTY_FACTION_RELATIONS;
  if (Object.prototype.hasOwnProperty.call(factionRelations, raw)) return factionRelations[raw];
  if (!warnedRelationKeys.has(raw)) {
    warnedRelationKeys.add(raw);
    console.warn(`[relations] no factionRelations entry for "${raw}"; treating as no declared relationships.`);
  }
  return EMPTY_FACTION_RELATIONS;
}

const shipHailLines = {
  friendly: [
    'Signal clear. We can spare a few holds if you are trading.',
    'Good to see a friendly transponder. What do you need?',
    'We are passing through with room to barter.',
    'Keep your shields steady and your manifest honest.',
  ],
  neutral: [
    'Unidentified vessel, state your business.',
    'We are listening. Trade quickly and keep your weapons cold.',
    'Our cargo master has a short list. Make it worth the delay.',
    'No trouble intended. We may have something useful aboard.',
  ],
  hostile: [
    'This channel is not for negotiation.',
    'Your hail is logged. Your weapons are being watched.',
    'Stand down or leave our course.',
    'No trade. No parley.',
  ],
};

const terranShipNames = [
  'excelsior', 'miranda', 'nebula', 'nova', 'saber', 'danube', 'deforest', 'vega',
  'aries', 'mozart', 'centaur', 'ambassador', 'venture', 'sydney', 'akira',
  'defiant', 'galaxy', 'intrepid', 'prometheus', 'sovereign', 'freedom',
  'new orleans', 'oberth', 'constitution', 'constellation', 'olympic', 'peregrin',
  'human', 'tug class', 'astrid', 'austin', 'avon', 'beijing', 'belfast', 'drayton',
  'eisenhower', 'ford', 'california', 'crossfield', 'diana', 'nx', 'onyx',
  'parliament', 'terra class', 'type 7', 'type 11', 'speeder',
];

function getShipFaction(shipId) {
  const stats = getShipStats(shipId);
  if (stats.faction) return stats.faction;
  const name = String(stats.name || '').toLowerCase();
  if (name.includes('dominion') || name.includes("jem'hadar")) return 'dominion';
  if (name.includes('ferengi') || name.includes('vagabond')) return 'ferengi';
  if (name.includes('vulcan') || name.includes("c'thia")) return 'vulcan';
  if (name.includes('bajoran')) return 'bajoran';
  if (name.includes('romulan') || name.includes('reman') || name.includes("der'idex") || name.includes('norexan')) return 'romulan';
  if (name.includes('cardassian') || name.includes('galor') || name.includes('keldon') || name.includes('hideki')) return 'cardassian';
  if (name.includes('klingon') || name.includes("b'rel") || name.includes("k'tinga") || name.includes("k'vort") || name.includes("neg'var") || name.includes('vorcha') || name.includes('bird of prey')) return 'klingon';
  if (name.includes('breen')) return 'breen';
  if (name.includes('tholian')) return 'tholian';
  if (name.includes('borg')) return 'borg';
  if (name.includes("son'a")) return 'sona';
  if (name.includes('delpin')) return 'delpin';
  if (name.includes('tarellian')) return 'tarellian';
  if (name.includes('promelli')) return 'promelli';
  if (name.includes('andorian')) return 'andorian';
  if (name.includes('gorn')) return 'gorn';
  if (name.includes('hirogen')) return 'hirogen';
  if (name.includes('suliban')) return 'suliban';
  if (terranShipNames.some((term) => name.includes(term))) return 'terran';
  return 'neutral';
}

function getFactionAttitude(faction = 'neutral') {
  if (!faction || faction === 'neutral') return 'neutral';
  if (faction === 'borg') return state.playerFaction === 'borg' ? 'friendly' : 'hostile';
  if (faction === 'pirate') return 'hostile';
  if (faction === state.playerFaction) return 'friendly';
  const relation = getFactionRelations(state.playerFaction);
  if (relation.friendly?.includes(faction)) return 'friendly';
  if (relation.hostile?.includes(faction)) return 'hostile';
  return 'neutral';
}

function formatFaction(faction = 'neutral') {
  return factionNames[faction] || factionNames.neutral;
}

function normalizeFactionKey(faction = 'neutral') {
  const key = String(faction || 'neutral').toLowerCase();
  return factionNames[key] ? key : 'neutral';
}

function isPurchasableFactionFlag(faction = 'neutral') {
  const key = normalizeFactionKey(faction);
  return Boolean(factionNames[key] && !isFactionFlagBlocked(key));
}

function normalizePlayerFlags() {
  const flags = new Set((Array.isArray(state.playerFlags) ? state.playerFlags : [])
    .map(normalizeFactionKey)
    .filter(isPurchasableFactionFlag));
  if (isPurchasableFactionFlag(state.playerFaction)) flags.add(normalizeFactionKey(state.playerFaction));
  state.playerFlags = [...flags].sort((a, b) => formatFaction(a).localeCompare(formatFaction(b)));
  return state.playerFlags;
}

function hasPlayerFlag(faction = state.playerFaction) {
  return normalizePlayerFlags().includes(normalizeFactionKey(faction));
}

const STANDING_MIN = -100;
const STANDING_MAX = 100;
const STANDING_HOSTILE_AT = -25;
const STANDING_FRIENDLY_AT = 25;
function getFactionStanding(faction = 'neutral') {
  const key = normalizeFactionKey(faction);
  const store = state.factionStanding && typeof state.factionStanding === 'object' ? state.factionStanding : {};
  return clamp(Math.round(finiteNumber(store[key], 0)), STANDING_MIN, STANDING_MAX);
}
function adjustFactionStanding(faction, delta, opts = {}) {
  const key = normalizeFactionKey(faction);
  if (!state.factionStanding || typeof state.factionStanding !== 'object') state.factionStanding = {};
  const before = getFactionStanding(key);
  const after = clamp(before + Math.round(finiteNumber(delta, 0)), STANDING_MIN, STANDING_MAX);
  state.factionStanding[key] = after;
  if (!opts.silent) {
    if (before > STANDING_HOSTILE_AT && after <= STANDING_HOSTILE_AT) setLog(`${formatFaction(key)} now treats you as hostile.`);
    else if (before < STANDING_FRIENDLY_AT && after >= STANDING_FRIENDLY_AT) setLog(`${formatFaction(key)} now regards you as a friend.`);
  }
  return after;
}
function applyKillStanding(victimFaction, baseDelta) {
  const victim = normalizeFactionKey(victimFaction);
  adjustFactionStanding(victim, baseDelta);
  for (const key of Object.keys(factionRelations)) {
    if (key === victim) continue;
    const rel = getFactionRelations(key);
    if ((rel.hostile || []).includes(victim)) adjustFactionStanding(key, Math.ceil(Math.abs(baseDelta) / 2), { silent: true });
    else if ((rel.friendly || []).includes(victim)) adjustFactionStanding(key, -1, { silent: true });
  }
}
function getEffectiveAttitude(faction = 'neutral') {
  const key = normalizeFactionKey(faction);
  const base = getFactionAttitude(faction);
  const standing = getFactionStanding(key);
  if (standing <= STANDING_HOSTILE_AT && (base !== 'friendly' || standing <= -50)) return 'hostile';
  return base;
}
function isUnlockedFaction(faction = 'neutral') {
  const key = normalizeFactionKey(faction);
  const feats = state.feats && typeof state.feats === 'object' ? state.feats : {};
  if (key === 'cardassian' && !feats.bajoranFleetDown && getFactionStanding('cardassian') < 50) return false;
  if (key === 'romulan' && !feats.vexBorgDown && getFactionStanding('romulan') < 50) return false;
  return true;
}
function serviceRefusal(faction = 'neutral') {
  const key = normalizeFactionKey(faction);
  if (getEffectiveAttitude(key) === 'hostile') return `${formatFaction(key)} ports refuse you. Standing ${getFactionStanding(key)}. Repair it by trading elsewhere.`;
  if (!isUnlockedFaction(key)) {
    if (key === 'cardassian') return 'The Cardassian Order will only deal with whoever destroys the Bajoran system defenses.';
    if (key === 'romulan') return 'The Romulans will only deal with whoever destroys the Borg in the Vex system.';
  }
  return null;
}
function getPlantableFlags(systemIndex = state.currentPlanet) {
  if (isSystemControlled(systemIndex)) return [];
  const sovereign = getSystemFaction(systemIndex);
  return normalizePlayerFlags().filter((f) => f !== sovereign && f !== 'neutral');
}
function plantFlagForEmpire(faction) {
  if (state.gameOver || !state.gameStarted) return;
  if (!requireDocked()) return;
  const key = normalizeFactionKey(faction);
  if (!hasPlayerFlag(key)) {
    setLog(`You do not own the ${formatFaction(key)} flag.`);
    return;
  }
  if (isSystemControlled(state.currentPlanet)) {
    setLog('This system is already under your control.');
    return;
  }
  const planet = state.planets[state.currentPlanet];
  const sovereign = getSystemFaction(state.currentPlanet);
  if (sovereign === key) {
    setLog(`${planet?.name || 'This system'} already flies the ${formatFaction(key)} flag.`);
    return;
  }
  state.playerFlags = normalizePlayerFlags().filter((f) => f !== key);
  transferSystemControlToFaction(state.currentPlanet, key);
  if (sovereign !== 'neutral') adjustFactionStanding(sovereign, -8);
  adjustFactionStanding(key, 12);
  applySystemState(state.currentPlanet);
  playGameSound('uiConfirm', { cooldownKey: `plant-flag:${key}` });
  setLog(`Raised the ${formatFaction(key)} flag over ${planet?.name || 'this system'}. It now counts as ${formatFaction(key)} space.`);
  syncLegacyState();
  updateStats();
  renderPlanetMenu();
}
// Sensor integration: simulation time and observer knowledge stay separate from rendering.
const sensorWorld = new SensorWorld();
let sensorEventSequence = 0;
let sensorClock = 0,
  sensorAccumulator = 0;
let sensorActors = new Map();
const sensorHullCache = new Map();

function sensorHullInfo(a, e) {
  const id = a === state ? state.playership : a.shipId || a.stationTypeId,
    scale = a === state ? state.ship.drawScale : a.scale || 1,
    key = `${id}:${scale}:${e.suite}:${canvas.width}:${canvas.height}`;
  if (!sensorHullCache.has(key)) {
    const radius = a.stationTypeId ? getStationScreenRadius(a) : getShipScreenRadius(id, scale);
    sensorHullCache.set(key, {
      profile: sensorProfile(getShipStats(id), e.suite),
      radius,
      visual: visualReach(canvas.width, canvas.height)
    });
  }
  return sensorHullCache.get(key);
}

function sensorEntity(entity) {
  return !entity || entity === 'player' || entity === state ? state : entity;
}

function sensorSide(entity) {
  const a = sensorEntity(entity);
  return a === state ? PLAYER_SIDE : a.stationTypeId ? getStationOwner(a) : getNpcSideId(a);
}

function sensorKey(entity, systemIndex = state.currentPlanet) {
  const a = sensorEntity(entity);
  return a === state ? 'player' : a.stationTypeId ? `station:${systemIndex}:${a.id}` :
    `ship:${systemIndex}:${a.id}:${a.seed}:${a.fleetId||''}`;
}

function ensureActorSensors(entity = null) {
  const a = sensorEntity(entity),
    command = a === state || isPlayerSideNpc(a);
  if (!a.sensors || a.sensors.version !== 1) a.sensors = ensureSensorEquipment(a.sensors, defaultTransponder({
    ...a,
    side: sensorSide(a),
    command,
    flag: getPlayerFlag(),
    role: a === state ? 'player' : a.role
  }));
  if (a.sensors.commandDefault) a.sensors.declaration = getPlayerFlag();
  return a.sensors;
}

function sensorPosition(entity) {
  return sensorEntity(entity) === state ? playerWorldPosition() : entity;
}

function ensureActorEW(entity = state) {
  const a=sensorEntity(entity), side=sensorSide(a);
  if(!a.ew || a.ew.version!==1) a.ew=sanitizeEW(a.ew);
  if(a.ew.owner && a.ew.owner!==side){stopEW(a.ew,true);a.ew.eccmOrder='off';}
  if(a===state&&a.ew.system!==undefined&&a.ew.system!==state.currentPlanet)stopEW(a.ew,true);
  a.ew.system=state.currentPlanet;
  a.ew.owner=side;
  return a.ew;
}
function stationElectronicProfile(station) {
  const type=getShipStats(station.stationTypeId);
  const enhanced=/defen[sc]e.*platform|weapons platform|shipyard|science|university|maintenance|starbase/i.test(type.name||'');
  return {passive:enhanced?1500:1200,processing:enhanced?1.25:1};
}
function setEWOrder(entity,dimension,value) {
  const a=sensorEntity(entity);
  if(a!==state&&(!state.npcShips.includes(a)||!isPlayerSideNpc(a)||a.destroyed||sensorDistance(playerWorldPosition(),a)>2400))return false;
  const e=ensureActorEW(a), jammer=dimension==='jammer';
  if(!['off',jammer?'on':'boost','auto'].includes(value))return false;
  if(jammer&&value!=='off'&&(!e.module||(a===state?state.docked||isPlayerCloaked():a.cloaked||a.cloak?.active)))return false;
  e[jammer?'jammerOrder':'eccmOrder']=value;
  if(jammer&&value==='off')stopEW(e);
  captureShipPowerState();renderTopLeftPanel();return true;
}
function getEWUpgradeDecision(id,entity=state) {
  const u=EW_MODULES[id],a=sensorEntity(entity),st=getCurrentDockedStation();
  const owner=st?getStationOwner(st):getSystemFaction(state.currentPlanet)||'neutral';
  const faction=owner===PLAYER_SIDE?getPlayerFlag():owner.startsWith('private:')?'neutral':owner;
  const requirement=getConfiguredPurchaseTierThresholds()?.[u?.tier]??PURCHASE_TIER_STANDING[u?.tier]??0;
  const standing=getFactionStanding(faction),blocked=getSecurityDockingBlock(owner);
  const service=!st||(!st.destroyed&&!st.underConstruction&&/shipyard|science|university|maintenance|starbase/i.test(getShipStats(st.stationTypeId).name||st.name||''));
  const reason=!u?'Unknown module':!state.docked?'Dock for refit':blocked?String(blocked):!service?'No electronic refit service':
    a!==state&&(!state.npcShips.includes(a)||!isPlayerSideNpc(a)||a.destroyed||a.trafficWarp?.phase==='away'||sensorDistance(playerWorldPosition(),a)>2400)?'Ship is not locally commanded':
    ensureActorEW(a).module===id?'Already installed':standing<requirement?`Requires ${requirement} ${formatFaction(faction)} standing; yours ${standing}`:state.latinum<u.price?'Insufficient latinum':null;
  return {canBuy:!reason,reason,requirement,standing,faction,price:u?.price||0};
}
function buyEWModule(id,entity=state) {
  const a=sensorEntity(entity),d=getEWUpgradeDecision(id,a);if(!d.canBuy){setLog(d.reason);return false;}
  state.latinum-=d.price;stopEW(ensureActorEW(a),true);a.ew.module=id;
  captureShipPowerState();updateStats();renderTopLeftPanel();return true;
}
function renderEWPanel() {
  const controls=a=>{
    const e=ensureActorEW(a),key=sensorKey(a),m=EW_MODULES[e.module];
    const buttons=(dim,values)=>values.map(v=>`<button data-ew-order="${dim}:${v}" data-ew-ship="${escapeHtml(key)}" class="${e[dim==='jammer'?'jammerOrder':'eccmOrder']===v?'active':''}">${dim==='jammer'?'Jammer':'ECCM'} ${v}</button>`).join('');
    return `<div class="meta">${a===state?'Captain’s ship':escapeHtml(getTargetName(a))} · ${m?escapeHtml(m.name):'EW slot empty'} · ${e.operating?'Operating':e.transmitting?'Spinning up':e.cooldownRemaining>0?'Cooling down':'Off'}${e.funded<.99&&e.transmitting?' · Power limited':''}</div><div class="sensor-actions">${buttons('jammer',['off','on','auto'])}${buttons('eccm',['off','boost','auto'])}</div>`;
  };
  const refit=a=>EW_MODULES.slice(1).map(m=>{const d=getEWUpgradeDecision(m.id,a);return `<button data-ew-buy="${m.id}" data-ew-ship="${escapeHtml(sensorKey(a))}" ${d.canBuy?'':'disabled'}>${escapeHtml(m.name)} · ${m.price} L</button><div class="meta">${escapeHtml(d.reason||'Available')}</div>`;}).join('');
  const q=state.ewReception||{quality:1,noise:0,own:[]},t=state.power?.telemetry||{};
  const names=(q.own||[]).map(k=>sensorActors.get(k)?.entity).filter(n=>n&&isPlayerSideNpc(n)&&sensorDistance(playerWorldPosition(),n)<=2400).map(n=>getTargetName(n));
  const own=names.length>0,self=q.selfNoise>0,foreign=q.noise**2>(q.ownNoise||0)**2+(q.selfNoise||0)**2+1e-8;
  const label=q.noise===0?'Clear':own?`Own fleet jammer${foreign?' + other/unattributed':''}: ${names.join(', ')}`:self?`Own jammer${foreign?' + other/unattributed':''}`:'Other/unattributed';
  return `<details data-sensor-details="ew"><summary>Electronic warfare</summary>${controls(state)}<div class="meta">Interference: ${escapeHtml(label)} · RF range ${(Math.sqrt(q.quality)*100).toFixed(0)}% · Scan rate ${(q.quality*100).toFixed(0)}%</div><div class="meta">Electronics ${(t.electronics||0).toFixed(1)} EU/s · Jammer ${(t.jammer||0).toFixed(1)} · ECCM ${(t.eccm||0).toFixed(1)}. Fleet jammer: detectable around 3,000 units by standard sensors at 5 points. Nearby friendly receivers are affected.</div>${state.docked?refit(state):''}${state.npcShips.filter(n=>!n.destroyed&&isPlayerSideNpc(n)&&sensorDistance(playerWorldPosition(),n)<=2400).map(n=>controls(n)+(state.docked?refit(n):'')).join('')}</details>`;
}

function sensorSnapshotActor(entity, zone = null) {
  const a = sensorEntity(entity),
    e = ensureActorSensors(a),
    p = sensorPosition(a),
    station = !!a.stationTypeId;
  const {
    profile,
    visual,
    radius
  } = sensorHullInfo(a, e);
  const points = station ? 5 : normalizePowerDist(a.power?.dist).sensors;
  const powered = station ? 1 : e.funded || 0,
    mult = points > 0 ? (.5 + .1 * points) * powered : 0;
  const base = station ? stationElectronicProfile(a).passive : profile.passive;
  const ew=ensureActorEW(a);
  if(a.destroyed||a.underConstruction||(a===state&&(state.docked||state.warp.active||isPlayerCloaked()))||a.cloaked||a.cloak?.active||a.trafficWarp?.phase==='away')stopEW(ew,true);
  const issuer = zone && String(zone.anchorStationId) === String(a.id);
  const cloaked = a === state ? isPlayerCloaked() : !!(a.cloaked || a.cloak?.active);
  const boost = (a === state ? state.ship.systemWarpIntensity : a.systemWarpIntensity) || 0;
  return {
    key: sensorKey(a),
    jammerStrength: ew.strength, jammerRadius: ew.radius, jammerEmitting: ew.transmitting,
    rejection: (station?stationElectronicProfile(a).processing:profile.processing)*mult*(1+ew.boost),
    entity: a,
    side: sensorSide(a),
    x: p.x,
    y: p.y,
    observer: !a.destroyed && !a.underConstruction,
    visual,
    radius,
    passive: base * mult,
    active: profile.active * mult,
    signature: clamp(profile.signature + .2 * boost + (sensorClock - (a.sensorLastFireAt ?? -100) < 2 ? .5 : 0), .35,
      2.5),
    coverage: issuer ? Math.max(base, Math.hypot(p.x - zone.centre.x, p.y - zone.centre.y) + zone.radius + 200) : 0,
    broadcast: e.transponder,
    declaration: e.declaration,
    cloaked,
    emitting: e.emitting,
    station
  };
}

function sensorContact(observer, target) {
  return sensorWorld.contact(sensorKey(observer), sensorKey(target));
}

function sensorDirectVisual(observer, target) {
  const a = sensorEntity(observer),
    b = sensorEntity(target);
  if (a === b) return true;
  if (b.destroyed || b.trafficWarp?.phase === 'away' || (b === state ? isPlayerCloaked() : b.cloaked || b.cloak
      ?.active)) return false;
  const radius = b.stationTypeId ? getStationScreenRadius(b) : getShipScreenRadius(b === state ? state.playership : b
    .shipId, b === state ? state.ship.drawScale : b.scale || 1);
  return sensorDistance(sensorPosition(a), sensorPosition(b)) <= visualReach(canvas.width, canvas.height) + radius;
}

function sensorCanTrack(observer, target) {
  if (!target) return false;
  if (sensorDirectVisual(observer, target)) return true;
  if (sensorEntity(target) === state ? isPlayerCloaked() : target.cloaked || target.cloak?.active) return false;
  return freshTrack(sensorContact(observer, target), sensorClock);
}

function sensorKnownPosition(observer, target) {
  if (sensorDirectVisual(observer, target)) return {
    ...sensorPosition(sensorEntity(target))
  };
  const c = sensorContact(observer, target);
  return freshTrack(c, sensorClock) ? {
    ...c.position
  } : null;
}

function sensorVisibleToPlayer(target) {
  return sensorCanTrack(state, target);
}

function sensorDisplayContact(target) {
  const own = sensorSide(target) === PLAYER_SIDE && sensorDistance(playerWorldPosition(), sensorPosition(target)) <=
    2400,
    c = sensorContact(state, target);
  return {
    own,
    identified: own || !!c?.report?.hull,
    report: c?.report || null,
    declaration: receivedDeclaration(c, sensorClock),
    track: sensorCanTrack(state, target)
  };
}

function playerContactLabel(target) {
  const k = sensorDisplayContact(target);
  if (k.own) return getTargetName(target);
  return `${k.report?.hull||(target.stationTypeId?'Unidentified installation':'Unidentified ship')}${k.declaration?' (declared '+k.declaration+')':''}`;
}

function sensorCheckpointIssuer(zone = getSecurityZone()) {
  return zone && state.stations.find(st => String(st.id) === String(zone.anchorStationId));
}

function sensorCheckpointBroadcast(entity, zone = getSecurityZone()) {
  const issuer = sensorCheckpointIssuer(zone);
  if (!issuer) return {
    source: 'none',
    faction: null
  };
  const a = sensorEntity(entity),
    e = ensureActorSensors(a);
  const c = sensorContact(issuer, a);
  // Direct communications can be received before the next 5 Hz pass, but never refresh a dark sender.
  if (e.transponder && !(a === state ? isPlayerCloaked() : a.cloaked || a.cloak?.active) && sensorDistance(issuer,
      sensorPosition(a)) <= 2400) {
    const o = sensorSnapshotActor(issuer),
      t = sensorSnapshotActor(a);
    let r = sensorWorld.contact(o.key, t.key);
    if (!r) {
      sensorWorld.map(o.key).set(t.key, {
        key: t.key,
        declaredAt: -100,
        observedAt: -100,
        valid: false
      });
      r = sensorWorld.contact(o.key, t.key);
    }
    if (sensorClock - r.declaredAt >= 1) {
      r.declaration = e.declaration;
      r.declaredAt = sensorClock;
    }
  }
  const declaration = receivedDeclaration(sensorContact(issuer, a), sensorClock);
  return declaration ? {
    source: 'declared',
    faction: declaration
  } : {
    source: 'none',
    faction: null
  };
}

function sensorCheckpointTrack(entity, zone) {
  const issuer = sensorCheckpointIssuer(zone);
  if (!issuer) return false;
  const target = sensorEntity(entity);
  if (target === state ? isPlayerCloaked() : target.cloaked || target.cloak?.active) return false;
  if (issuer.destroyed || issuer.underConstruction) return false;
  const reach = sensorSnapshotActor(issuer, zone).coverage;
  return sensorDistance(issuer, sensorPosition(target)) <= reach || sensorCanTrack(issuer, target);
}

function advanceSensorScan(entity, dt) {
  const a = sensorEntity(entity),
    e = ensureActorSensors(a);
  if (e.mode === 'passive') return;
  if (a === state ? isPlayerCloaked() : a.cloaked || a.cloak?.active) {
    e.mode = 'passive';
    e.emitting = false;
    return;
  }
  const profile = sensorProfile(getShipStats(a === state ? state.playership : a.shipId), e.suite),
    points = normalizePowerDist(a.power?.dist).sensors;
  const rate = points / 5 * e.funded * profile.processing * (a.ewReception?.quality ?? 1);
  if (e.mode === 'sweep') {
    if (e.emitting) e.progress += dt;
    if (e.progress >= 2) {
      e.mode = 'passive';
      e.progress = 0;
    }
    return;
  }
  const t = sensorActors.get(e.target),
    c = t && sensorContact(a, t.entity);
  if (!t || !sensorCanTrack(a, t.entity) || sensorDistance(sensorPosition(a), t) > profile.active * (points > 0 ? .5 +
      .1 * points : 0)) {
    e.untracked += dt;
    if (e.untracked >= 5) {
      e.mode = 'passive';
      e.target = null;
    }
    return;
  }
  e.untracked = 0;
  if (!e.emitting) return;
  e.progress = Math.min(8, e.progress + dt * rate);
  const rec = c || sensorWorld.observe(sensorSnapshotActor(a), t, sensorClock, 'visual');
  if (e.progress >= 2) {
    rec.report = {
      ...rec.report,
      hull: getShipStats(t.entity.shipId || t.entity.stationTypeId).name,
      assessedAt: sensorClock
    };
  }
  if (e.progress >= 8) {
    const target = t.entity;
    const slots = getInstalledPowerSlots(target);
    const hullFraction = target === state ? state.hull / 100 : target.combatHull / Math.max(1, target.maxCombatHull);
    const output = target.stationTypeId ? null : getActorPowerProfile(target === state ? null : target).reactorOutput;
    rec.report = {
      ...rec.report,
      weapons: slots.filter(Boolean).map(id => getWeapon(id).name),
      condition: hullFraction > .7 ? 'Light damage' : hullFraction > .3 ? 'Damaged' : 'Critical',
      reactor: output === null ? 'Station supply' : output < 8 ? 'Compact reactor' : output < 20 ?
        'Standard reactor' : 'High-output reactor',
      ewModule: EW_MODULES[ensureActorEW(target).module]?.name || 'None',
      cargo: 'Cargo manifest unavailable',
      crew: sensorSide(a) === sensorSide(target) ? (target.crewSkill || 'Captain-directed') + ' (command telemetry)' :
        sensorCrewEstimate(rec),
      assessedAt: sensorClock
    };
    e.mode = 'passive';
    e.progress = 0;
  }
}

function sensorCrewEstimate(record) {
  const obs = record?.behavior || [];
  if (obs.length < 4) return 'Unknown — insufficient behavior observed';
  const gaps = obs.slice(1).map((n, i) => n - obs[i]);
  const mean = gaps.reduce((a, b) => a + b, 0) / gaps.length;
  const variance = gaps.reduce((n, x) => n + (x - mean) ** 2, 0) / gaps.length;
  return variance < mean * mean * .2 ? 'Regular–veteran estimate; low confidence (consistent observed fire pacing)' :
    'Inconclusive proficiency; low confidence (variable observed fire pacing)';
}

function sensorAgeReports(records, elapsed) {
  return (records || []).map(r => ({
    ...r,
    age: r.age + elapsed,
    declarationAge: r.declarationAge + elapsed,
    report: r.report ? {
      ...r.report,
      assessedAge: (r.report.assessedAge || 0) + elapsed
    } : null
  }));
}

function snapshotSensorArchives() {
  return Object.fromEntries(Object.entries(state.sensorArchives || {}).map(([system, a]) => [system, {
    records: sensorAgeReports(a.records, Math.max(0, sensorClock - a.at))
  }]));
}

function restoreSensorArchives(raw) {
  return Object.fromEntries(Object.entries(raw || {}).filter(([key, a]) => Number.isFinite(Number(key)) && Array
    .isArray(a?.records)).map(([key, a]) => [key, {
    at: sensorClock,
    records: a.records
  }]));
}

function sensorPursuitPoint(npc, target, type = 'ship') {
  const actual = type === 'player' ? state : target;
  const position = sensorKnownPosition(npc, actual);
  return position ? {
    x: position.x,
    y: position.y,
    id: target?.id,
    name: target?.name
  } : null;
}

function updateSensorSystems(frameScale = 1) {
  const sensorUpdateStart=performance.now();
  const dt = clamp(frameScale / 60, 0, 1);
  sensorClock += dt;
  sensorAccumulator += dt;
  if (sensorWorld.system !== state.currentPlanet) {
    state.sensorArchives ||= {};
    if (sensorWorld.system !== null) state.sensorArchives[sensorWorld.system] = {
      at: sensorClock,
      records: sensorWorld.snapshot('player', sensorClock)
    };
    sensorWorld.clear(state.currentPlanet);
    sensorAccumulator = .2;
    const saved = state.sensorArchives[state.currentPlanet];
    if (saved && !state.sensorReports) state.sensorReports = sensorAgeReports(saved.records, Math.max(0, sensorClock -
      saved.at));
  }
  if (sensorAccumulator + .000001 >= .2) {
    const start = performance.now(),
      elapsed = Math.min(sensorAccumulator, 1);
    sensorAccumulator = 0;
    const zone = getSecurityZone(),
      entities = [state, ...state.npcShips.filter(n => !n.destroyed && n.trafficWarp?.phase !== 'away'), ...state
        .stations.filter(n => !n.destroyed && !n.underConstruction)
      ];
    const actors = entities.map(a => sensorSnapshotActor(a, zone));
    sensorActors = new Map(actors.map(a => [a.key, a]));
    for (const a of actors)
      if (a.entity.sensorReports) {
        sensorWorld.restore(a.key, a.entity.sensorReports, sensorClock);
        delete a.entity.sensorReports;
      }
    sensorWorld.pass(actors, sensorClock, elapsed);
    for(const a of actors) a.entity.ewReception=a.ewReception;
    for (const a of actors) {
      const equip = ensureActorSensors(a.entity);
      if (a.entity !== state && !a.station) {
        let memory=null;for(const c of sensorWorld.map(a.key).values())if(c.position&&!freshTrack(c,sensorClock)&&sensorClock-c.observedAt<10){memory=c;break;}
        a.entity.power.searching = !!memory;
        if (memory && !a.entity.power.combat && !a.entity.power.recovering && equip.mode === 'passive' && (a.entity
            .sensorNextDecision ?? 0) <= sensorClock) {
          equip.mode = 'sweep';
          equip.progress = 0;
          a.entity.sensorNextDecision = sensorClock + ({
            inexperienced: 3,
            regular: 6,
            veteran: 10,
            elite: 12
          } [a.entity.crewSkill] || 6);
        }
      }
    }
    sensorWorld.metrics.elapsedMs = performance.now() - start;
  }
  for (const a of sensorActors.values())
    if (!a.station) advanceSensorScan(a.entity, dt);
  sensorWorld.metrics.elapsedMs=performance.now()-sensorUpdateStart;
}

function snapshotActorSensors(entity, systemIndex = state.currentPlanet) {
  const a = sensorEntity(entity);
  return {
    sensors: {
      ...ensureActorSensors(a),
      funded: 0,
      emitting: false
    },
    ew: snapshotEW(ensureActorEW(a)),
    sensorReports: sensorWorld.snapshot(sensorKey(a, systemIndex), sensorClock)
  };
}

function startSensorAction(action) {
  const e = ensureActorSensors();
  if (action === 'toggle') {
    e.transponder = !e.transponder;
    setLog(`Transponder ${e.transponder?'on':'off — running dark'}.`);
  } else if (action === 'cancel') {
    e.mode = 'passive';
    e.target = null;
    e.progress = 0;
  } else if (action === 'sweep' || action === 'focus') {
    if (isPlayerCloaked()) {
      setLog('Decloak before transmitting an active scan.');
      return false;
    }
    if (action === 'focus') {
      const target = getSelectedCombatTarget();
      if (!target || !sensorCanTrack(state, target)) {
        setLog('Select a tracked contact first.');
        return false;
      }
      e.target = sensorKey(target);
    }
    e.mode = action;
    e.progress = 0;
    e.untracked = 0;
  }
  renderTopLeftPanel();
  return true;
}

function getSensorUpgradeDecision(id, entity = state) {
  const u = SENSOR_SUITES[id],
    a = sensorEntity(entity),
    st = getCurrentDockedStation();
  const faction = String(st ? getStationOwner(st) : getSystemFaction(state.currentPlanet) || 'neutral'),
    gateFaction = faction === PLAYER_SIDE ? getPlayerFlag() : faction.startsWith('private:') ? 'neutral' : faction;
  const requirement = getConfiguredPurchaseTierThresholds()?.[u?.tier] ?? PURCHASE_TIER_STANDING[u?.tier] ?? 0;
  const standing = getFactionStanding(gateFaction),
    blocked = getSecurityDockingBlock(faction);
  const service = !st || (!st.destroyed && !st.underConstruction && /shipyard|science|university|maintenance|starbase/i
    .test(st.name || getShipStats(st.stationTypeId).name || ''));
  const reason = !u ? 'Unknown suite' : !state.docked ? 'Dock for refit' : blocked ? String(blocked) : !service ?
    'No sensor refit service' : a !== state && (a.destroyed || a.trafficWarp?.phase === 'away' || sensorDistance(
      playerWorldPosition(), a) > 2400 || !state.npcShips.some(n => n === a && isPlayerSideNpc(n))) ?
    'Ship is not locally commanded' : id <= ensureActorSensors(a).suite ? 'Already fitted or better' : standing <
    requirement ? `Requires ${requirement} ${formatFaction(gateFaction)} standing; yours ${standing}` : state.latinum <
    u.price ? 'Insufficient latinum' : null;
  return {
    canBuy: !reason,
    reason,
    requirement,
    standing,
    faction: gateFaction,
    price: u?.price || 0
  };
}

function buySensorSuite(id, entity = state) {
  const a = sensorEntity(entity),
    d = getSensorUpgradeDecision(id, a);
  if (!d.canBuy) {
    setLog(d.reason);
    return false;
  }
  state.latinum -= d.price;
  ensureActorSensors(a).suite = id;
  captureShipPowerState();
  setLog(`${SENSOR_SUITES[id].name} sensor suite installed.`);
  updateStats();
  renderTopLeftPanel();
  return true;
}

function renderSensorPanelMarkup() {
  const e = ensureActorSensors(),
    power = ensurePlayerPower(),
    profile = sensorProfile(getShipStats(state.playership), e.suite);
  const localFleet = state.npcShips.filter(n => !n.destroyed && isPlayerSideNpc(n) && n.trafficWarp?.phase !== 'away' &&
    sensorDistance(playerWorldPosition(), n) <= 2400);
  const refit = (a) => SENSOR_SUITES.slice(1).map(u => {
    const d = getSensorUpgradeDecision(u.id, a);
    return `<button data-sensor-buy="${u.id}" data-sensor-ship="${a===state?'player':escapeHtml(sensorKey(a))}" ${d.canBuy?'':'disabled'}>${escapeHtml(u.name)} · ${u.price} L</button><div class="meta">${escapeHtml(d.reason||'Available')}</div>`;
  }).join('');
  const reports = [...sensorWorld.map('player').values()].filter(c => c.report || c.position || receivedDeclaration(c,
    sensorClock) || c.cue?.expiresAt >= sensorClock);
  return `<div class="panel-head">Sensors & communications</div><div class="meta">${escapeHtml(SENSOR_SUITES[e.suite].name)} suite · ${e.mode==='passive'?'Passive reception':escapeHtml(e.mode)+' '+e.progress.toFixed(1)+'s'} · ${power.dist.sensors===0?'Suite offline':e.funded<.99?'Sensor power limited':'Sensors powered'}</div>
 <div class="meta">Rated passive ${Math.round(profile.passive)} / active ${Math.round(profile.active)} units at 5 points. Active transmissions reveal your presence.</div>
 <div class="sensor-actions"><button data-sensor-action="toggle">Transponder: ${e.transponder?'On':'Off'}</button><button data-sensor-action="sweep">Active sweep</button><button data-sensor-action="focus">Focused scan</button><button data-sensor-action="cancel">Cancel scan</button></div>
 <div class="meta">Declared: ${escapeHtml(e.declaration)} · ${isPlayerCloaked()?'Suppressed by cloak':e.transponder?'Transmitting':'Running dark'}</div>
 <details class="sensor-contact-list" data-sensor-details="contacts"><summary>Contact reports (${reports.length})</summary>${reports.slice(-12).map(c=>`<div class="meta">${escapeHtml(c.report?.hull||receivedDeclaration(c,sensorClock)||'Unidentified contact')}${sensorClock-(c.jammerAt??-Infinity)<=.400001?' · Jamming emission':''} — ${freshTrack(c,sensorClock)?'Tracked':c.cue?.expiresAt>=sensorClock?'Attack origin':c.position?'Last known position':'Broadcast only'} · ${Math.max(0,sensorClock-(c.report?.assessedAt??(c.cue?.expiresAt>=sensorClock?c.cue.launchedAt:c.position?c.observedAt:c.declaredAt))).toFixed(1)}s old${c.report?.weapons?'<br>Weapons: '+escapeHtml(c.report.weapons.join(', ')||'None')+'<br>'+escapeHtml(c.report.condition)+' · EW: '+escapeHtml(c.report.ewModule||'Unknown')+' · '+escapeHtml(c.report.reactor||'Reactor unknown')+' · '+escapeHtml(c.report.crew)+'<br>'+escapeHtml(c.report.cargo):''}</div>`).join('')}</details>
 ${localFleet.length?'<details data-sensor-details="fleet"><summary>Local fleet sensors & crew</summary>'+localFleet.map(n=>`<div class="meta">${escapeHtml(getTargetName(n))} — ${escapeHtml(n.crewSkill)} / ${escapeHtml(n.crewTemperament)} · ${escapeHtml(SENSOR_SUITES[ensureActorSensors(n).suite].name)}${state.docked?refit(n):''}</div>`).join('')+'</details>':''}
 ${state.docked?'<details data-sensor-details="refit"><summary>Sensor refit — captain’s ship</summary>'+refit(state)+'</details>':''}`;
}

function sensorAttackSnapshot(source) {
  const a = sensorEntity(source),
    p = sensorPosition(a);
  a.sensorLastFireAt = sensorClock;
  for (const map of sensorWorld.contacts.values()) {
    const c = map.get(sensorKey(a));
    if (freshTrack(c, sensorClock) && c.behavior?.at(-1) !== sensorClock) c.behavior = [...(c.behavior || []),
      sensorClock
    ].slice(-10);
  }
  return {
    key: sensorKey(a),
    side: sensorSide(a),
    system: state.currentPlanet,
    x: p.x,
    y: p.y,
    time: sensorClock,
    eventId: `${sensorKey(a)}:${++sensorEventSequence}`
  };
}

function recordSensorHit(target, attack) {
  if (!attack) return;
  const a = sensorEntity(target);
  sensorWorld.hit(sensorKey(a), attack, sensorClock);
  const source = sensorActors.get(attack.key)?.entity;
  if (source && attack.system === state.currentPlanet) {
    if (source === state) recordPlayerAggressionAgainst(a);
    else {
      source.lastAggressionAt = performance.now();
      source.lastAggressionSystemIndex = state.currentPlanet;
      source.lastAggressionTargetSide = sensorSide(a);
    }
  }
}

function getCounterfireCue(entity) {
  return [...sensorWorld.map(sensorKey(entity)).values()].map(c => c.cue).filter(c => c && c.system === state
    .currentPlanet && c.expiresAt >= sensorClock && c.sourceSide !== sensorSide(entity)).sort((a, b) => b.impactAt - a
    .impactAt)[0] || null;
}

const collisionBodyPool=[];
function sensorCollisionTargets(sourceKey) {
  const bodies=collisionBodyPool;
  let n=0;
  const take=a=>{
    if(a.destroyed||a.underConstruction)return;
    const key=sensorKey(a);if(key===sourceKey)return;
    const p=sensorPosition(a),info=sensorHullInfo(a,ensureActorSensors(a));
    const body=bodies[n]||(bodies[n]={});
    body.x=p.x;body.y=p.y;body.key=key;body.entity=a;body.radius=info.radius*(a.stationTypeId?.58:1);
    n++;
  };
  take(state);
  for(const a of state.npcShips)take(a);
  for(const a of state.stations)take(a);
  bodies.length=n;
  return bodies;
}

function applyPointImpact(hit, shot) {
  const a = hit.target.entity;
  recordSensorHit(a, shot.attack);
  const scale = shot.creditSource === 'station' ? (a === state ? STATION_PLAYER_DAMAGE_SCALE : 1) : shot
    .creditSource === 'player' ? 1 : a === state ? NPC_WEAPON_DAMAGE_SCALE : NPC_STATION_DAMAGE_SCALE;
  const damage = Math.max(1, Math.round(shot.damage * scale));
  if (a === state) applyPlayerDamage(damage, shot.color, {
    impactPoint: hit
  });
  else damageCombatTarget(a, damage, shot.creditSource, shot.color, hit);
}

// Local incarnation keys never survive a new object or a replacement hull/power state.
const hojIncarnations=new WeakMap();let hojIncarnationSequence=0;const hojActorMap=new Map();
function hojEmitterKey(entity){const a=sensorEntity(entity),object=a===state?ensurePlayerPower():a;
  let rec=hojIncarnations.get(object);
  const hull=a===state?state.playership:a.shipId||a.stationTypeId,system=state.currentPlanet;
  if(!rec){rec={n:++hojIncarnationSequence,hull,system,key:''};hojIncarnations.set(object,rec);}
  if(rec.key&&rec.hull===hull&&rec.system===system)return rec.key;
  rec.hull=hull;rec.system=system;rec.key=`${sensorKey(a)}:inc:${rec.n}:hull:${hull}`;
  return rec.key;
}
const liveJammerScratch={key:'',system:0,x:0,y:0,emitting:true};
// An emission is a targeting opportunity, never permission to attack.
function liveJammerSignal(entity) {
  const a=sensorEntity(entity);
  if(a.destroyed||a.underConstruction||a.trafficWarp?.phase==='away'||
    (a===state ? state.docked||state.warp.active||isPlayerCloaked() : a.cloaked||a.cloak?.active))return null;
  const e=ensureActorEW(a);
  if(!(e.transmitting&&e.funded>0&&e.radius>0))return null;
  const p=sensorPosition(a);
  liveJammerScratch.key=hojEmitterKey(a);liveJammerScratch.system=state.currentPlanet;
  liveJammerScratch.x=p.x;liveJammerScratch.y=p.y;liveJammerScratch.emitting=true;
  return liveJammerScratch;
}
function hasHojLaunchTrack(source,target) {
  const c=sensorContact(source,target);
  return !!liveJammerSignal(target)&&freshTrack(c,sensorClock)&&Number.isFinite(c.jammerAt)&&sensorClock-c.jammerAt<=.400001;
}
function hojEngagementAllowed(source,target,explicit=false) {
  const a=sensorEntity(source),b=sensorEntity(target);
  if(a===b||sensorSide(a)===sensorSide(b))return false;
  if(a===state)return explicit||(b.stationTypeId?isPlayerEscortStationTarget(b):isPlayerEscortShipTarget(b));
  if(isPlayerSideNpc(a))return b.stationTypeId?isPlayerEscortStationTarget(b):isPlayerEscortShipTarget(b);
  if(b===state)return !!a.hostile||a.attitude==='hostile'||hasRecentAggressionAgainst(state,sensorSide(a))||sidesOpposed(sensorSide(a),getPlayerFlag());
  if(b.stationTypeId)return hasRecentAggressionAgainst(b,sensorSide(a))||sidesOpposed(sensorSide(a),sensorSide(b))||
    (isRaidingHere(a)&&sidesAligned(getDefendingSideId(),sensorSide(b)));
  return isNpcSystemAttacker(b,a);
}
function launchHoj(source,target,weapon,now=performance.now(),slot=0,explicit=false) {
  const a=sensorEntity(source),b=sensorEntity(target),station=!!a.stationTypeId;
  if(!target||a.destroyed||a.underConstruction||a.trafficWarp?.phase==='away'||
    (a===state&&(state.docked||state.warp.active))||!hasHojLaunchTrack(a,b)||!hojEngagementAllowed(a,b,explicit))return false;
  const origin=sensorPosition(a),track=sensorContact(a,b),range=weapon.range;
  if(sensorDistance(origin,track.position)>range||sensorDistance(origin,sensorPosition(b))>range)return false;
  const cooldown=station?(b===state?Math.max(STATION_PLAYER_MIN_COOLDOWN_MS,Math.round((a.defenseCooldown||STATION_WEAPON_COOLDOWN_MS)*STATION_PLAYER_COOLDOWN_SCALE)):a.defenseCooldown||STATION_WEAPON_COOLDOWN_MS):
    getScaledWeaponCooldown(a===state?state.playership:a.shipId,weapon,a===state?1:NPC_WEAPON_COOLDOWN_SCALE,a===state?1:NPC_WEAPON_FLOOR_SCALE);
  if(now-(a===state?state.weaponLastFiredAt[slot]||0:a.lastShotAt||0)<cooldown)return false;
  if(!station){const power=a===state?ensurePlayerPower():ensureNpcPower(a),cost=getWeaponEnergyCost(weapon,a===state?null:a);
    if(a!==state&&!crewAllowsShot(power,getActorPowerProfile(a),cost)||!spendPower(power,cost))return false;}
  if(a===state){if(isPlayerCloaked(now))setPlayerCloak(false,now,true);state.weaponLastFiredAt[slot]=now;state.lastPlayerShotAt=now;
    recordPlayerAggressionAgainst(b,now);markPlayerEscortAttackOrder(b,now);b.hostile=true;b.attitude='hostile';}
  else {a.lastShotAt=now;a.lastAggressionAt=now;a.lastAggressionSystemIndex=state.currentPlanet;a.lastAggressionTargetSide=sensorSide(b);}
  const credit=a===state?'player':station?'station':isPlayerEscortNpc(a)?'playerEscort':'npc';
  const shot={...createHojFlight({key:hojEmitterKey(b),system:state.currentPlanet,...origin,aim:track.position,speed:weapon.speed,range,turnRate:getProjectileTurnRate(weapon,station?'station':a===state?'player':'npc')}),
    attack:sensorAttackSnapshot(a),creditSource:credit,owner:a===state?'player':station?'station':'npc',
    damage:station?(a.defenseDamage||weapon.damage):getScaledWeaponDamage(a===state?state.playership:a.shipId,weapon,weapon.damage,1,a===state?null:a),
    weaponId:weapon.id,kind:'torpedo',color:getWeaponShotColor(a===state?getPlayerFlag():a.faction,weapon),born:now,ttl:range/weapon.speed*1000/60};
  state.projectiles.push(shot);playWeaponSound(weapon,{sourceId:`hoj:${sensorKey(a)}`,volume:.8});return true;
}
function updateHojProjectile(shot,frameScale,bodies=null,readSignal=null) {
  if(shot.system!==state.currentPlanet){shot.dead=true;return;}
  // Sample only the requested incarnation. Flight samples are private to this projectile.
  const read=readSignal||(key=>{
    const a=[state,...state.npcShips,...state.stations].find(a=>hojEmitterKey(a)===key);
    return a?liveJammerSignal(a):null;
  });
  let frames=Math.max(0,frameScale);
  while(frames>1e-7&&!shot.dead){const step=Math.min(1,frames),segment=stepHojFlight(shot,step/60,read);
    const hit=pointImpact(segment.from,segment.to,bodies||sensorCollisionTargets(shot.attack.key),shot.attack.key);
    if(hit){shot.x=hit.x;shot.y=hit.y;applyPointImpact(hit,shot);shot.dead=true;
      addWeaponEffect({kind:'burst',x:hit.x,y:hit.y,color:shot.color,radius:54,ttl:260});
      const prof=globalThis.__ewSeekProf;if(prof){const k=hit.target.entity===state?'player':hit.target.entity.stationTypeId?'station':'ship';prof[k]=(prof[k]||0)+1;}}
    frames-=step;
  }
}

function fireCounterfirePoint(entity, cue, weapon, now = performance.now(), slot = 0) {
  const a = sensorEntity(entity);
  if (weapon.guidance === 'home-on-jam' || a.destroyed || a.underConstruction || !cue || cue.expiresAt < sensorClock || cue.system !== state.currentPlanet ||
    cue.sourceSide === sensorSide(a) || !isCombatWeapon(weapon)) return false;
  const trackedSource = sensorActors.get(cue.sourceKey);
  if (trackedSource && (sensorSide(trackedSource.entity) === sensorSide(a) || sensorCanTrack(a, trackedSource.entity)))
    return false;
  const origin = sensorPosition(a),
    range = weapon.range || 680;
  if (sensorDistance(origin, cue) > range) return false;
  const heading = Math.atan2(cue.x - origin.x, -(cue.y - origin.y)) * 180 / Math.PI;
  if (!['beam', 'torpedo'].includes(getWeaponVisualKind(weapon)) && !isTrackingProjectileWeapon(weapon) && Math.abs(
      angleDelta(a === state ? state.ship.rotation : a.heading || heading, heading)) > 25) return false;
  const station = !!a.stationTypeId,
    last = a === state ? state.weaponLastFiredAt[slot] || 0 : a.lastShotAt || 0;
  const stationCooldown = a.defenseCooldown || STATION_WEAPON_COOLDOWN_MS;
  const cooldown = station ? (cue.sourceKey === 'player' ? Math.max(STATION_PLAYER_MIN_COOLDOWN_MS, Math.round(
    stationCooldown * STATION_PLAYER_COOLDOWN_SCALE)) : stationCooldown) : getScaledWeaponCooldown(a === state ? state
    .playership : a.shipId, weapon, a === state ? 1 : NPC_WEAPON_COOLDOWN_SCALE, a === state ? 1 :
    NPC_WEAPON_FLOOR_SCALE);
  if (now - last < cooldown) return false;
  if (!station) {
    const power = a === state ? ensurePlayerPower() : ensureNpcPower(a),
      cost = getWeaponEnergyCost(weapon, a === state ? null : a);
    if (a !== state && !crewAllowsShot(power, getActorPowerProfile(a), cost)) return false;
    if (!spendPower(power, cost)) return false;
  }
  if (a === state && isPlayerCloaked(now)) setPlayerCloak(false, now, true);
  if (a === state) {
    state.weaponLastFiredAt[slot] = now;
    state.lastPlayerShotAt = now;
  } else a.lastShotAt = now;
  if (a === state) {
    state.lastAggressionAt = now;
    state.lastAggressionSystemIndex = state.currentPlanet;
    state.lastAggressionTargetSide = cue.sourceSide;
  } else {
    a.lastAggressionAt = now;
    a.lastAggressionSystemIndex = state.currentPlanet;
    a.lastAggressionTargetSide = cue.sourceSide;
  }
  const shot = {
    attack: sensorAttackSnapshot(a),
    creditSource: a === state ? 'player' : station ? 'station' : isPlayerEscortNpc(a) ? 'playerEscort' : 'npc',
    damage: station ? a.defenseDamage || weapon.damage : getScaledWeaponDamage(a === state ? state.playership : a
      .shipId, weapon, null, 1, a === state ? undefined : a),
    color: getWeaponShotColor(a === state ? getPlayerFlag() : a.faction, weapon)
  };
  if (getWeaponVisualKind(weapon) === 'beam') {
    const hit = pointImpact(origin, cue, sensorCollisionTargets(shot.attack.key));
    addWeaponEffect({
      kind: 'beam',
      from: {
        ...origin
      },
      to: hit || {
        x: cue.x,
        y: cue.y
      },
      color: shot.color,
      width: 3,
      ttl: 170
    });
    if (hit) applyPointImpact(hit, shot);
  } else {
    const len = sensorDistance(origin, cue),
      speed = weapon.speed || 10;
    state.projectiles.push({
      ...shot,
      pointAim: true,
      heading,
      speed,
      x: origin.x,
      y: origin.y,
      vx: (cue.x - origin.x) / Math.max(1, len) * speed,
      vy: (cue.y - origin.y) / Math.max(1, len) * speed,
      remaining: Math.min(range, len),
      kind: 'torpedo',
      owner: shot.creditSource === 'playerEscort' ? 'npc' : shot.creditSource,
      turnRate: 0,
      weaponId: weapon.id,
      born: now,
      ttl: Math.ceil(range / speed * 1000 / 60) + 100
    });
  }
  playWeaponSound(weapon, {
    sourceId: shot.attack.key
  });
  return true;
}

const POWER_DIST_KEYS = POWER_KEYS;
function getInstalledPowerSlots(npc = null) {
  return npc ? (npc.stationTypeId ? getStationWeaponIds(npc) : Array.isArray(npc.weaponSlots) ? npc.weaponSlots : getOriginalShipWeaponSlots(npc.shipId)) : (state.weaponSlots || []);
}
function getActorPowerProfile(npc = null) {
  const secondaryCore = getInstalledPowerSlots(npc).some(id => id && getWeapon(id).passiveEffect === 'secondary-reactor');
  return shipPowerProfile(getShipStats(npc ? npc.shipId : state.playership), secondaryCore);
}
function ensureNpcPower(npc) {
  Object.assign(npc, assignPowerCrew(npc));
  npc.power = ensurePowerState(npc.power, getActorPowerProfile(npc));
  return npc.power;
}
function ensurePlayerPower() {
  state.power = ensurePowerState(state.power, getActorPowerProfile());
  return state.power;
}
function getPowerDist(key) { return normalizePowerDist(state.power?.dist)[key] ?? 0; }
function getPowerMaxEnergy() { return getActorPowerProfile().energyCapacity; }
function getPowerWeaponsFactor() { return powerWeaponFactor(state.power?.dist); }
function getPowerEnginesFactor() { return powerEngineFactor(state.power?.dist) * (state.power?.engineSupply ?? 1); }
function getPowerShieldsFactor() { return getPowerDist('shields') / 5; }
function getPowerReserveFactor() { return 1; } // compatibility: reserve points no longer multiply generation
function getWeaponEnergyCost(weapon, npc = null) {
  const shipId = npc ? npc.shipId : state.playership;
  const power = npc ? ensureNpcPower(npc) : ensurePlayerPower();
  // Use the hull's unallocated damage, independent of the player's selected hull
  // and of the legacy target-dependent NPC difficulty damage scale.
  return weaponPowerCost(weapon, getScaledWeaponDamage(shipId, weapon, null, 1, null), power.dist);
}
function consumeWeaponEnergy(cost) {
  if (spendPower(ensurePlayerPower(), cost)) return true;
  setLog('Insufficient energy. Reduce demand or allow reserves to recover.');
  return false;
}
// Capture only actual surviving vessels; a new ambient occupant gets fresh power/crew.
function captureShipPowerState(systemIndex = state.securityLiveSystemIndex) {
  for (const npc of state.npcShips || []) {
    if (npc.destroyed) continue;
    const power = powerSnapshot(ensureNpcPower(npc));
    const fields = { ...snapshotActorSensors(npc,systemIndex), power, crewSkill: npc.crewSkill, crewTemperament: npc.crewTemperament };
    const fleet = npc.fleetId && state.playerFleet.find(f => f.id === npc.fleetId);
    if (fleet) Object.assign(fleet, fields);
    const cached = state.systemStates?.[systemIndex]?.npcShips?.find(n => n.id === npc.id && n.seed === npc.seed);
    if (cached) Object.assign(cached, fields);
  }
}
function restoreFleetPower(ship, fleetShip) {
  ship.ew = sanitizeEW(fleetShip.ew);
  ship.sensors = fleetShip.sensors ? ensureSensorEquipment(fleetShip.sensors) : null;
  ship.sensorReports = fleetShip.sensorReports || [];
  ship.power = fleetShip.power ? cloneJson(fleetShip.power) : null;
  ship.crewSkill = fleetShip.crewSkill;
  ship.crewTemperament = fleetShip.crewTemperament;
  ensureNpcPower(ship);
  Object.assign(fleetShip, { power: ship.power, crewSkill: ship.crewSkill, crewTemperament: ship.crewTemperament });
}
const POWER_DIST_BUDGET = 20;
function setPowerDist(key, value) {
  const systems = POWER_DIST_KEYS;
  if (!systems.includes(key)) return; // unused allocation is a readout, not a control
  const power = ensurePlayerPower();
  const dist = power.dist;
  dist[key] = clamp(Math.round(finiteNumber(value, 5)), 0, 10);
  let excess = Math.max(0, systems.reduce((sum, k) => sum + dist[k], 0) - POWER_DIST_BUDGET);
  // Consume spare allocation first. Only reduce another system when the actual
  // engines/weapons/shields budget is full; preserve the slider being adjusted.
  for (const other of systems.filter(k => k !== key).sort((a, b) => dist[b] - dist[a])) {
    const take = Math.min(excess, dist[other]);
    dist[other] -= take;
    excess -= take;
  }

}
function adjustPowerDist(key, dir) {
  if (key === 'reserve' || !POWER_DIST_KEYS.includes(key)) return;
  if (!state.power || typeof state.power !== 'object') state.power = { energy: 200, dist: {} };
  if (!state.power.dist || typeof state.power.dist !== 'object') state.power.dist = {};
  setPowerDist(key, clamp(Math.round(finiteNumber(state.power?.dist?.[key], 5)), 0, 10) + (dir > 0 ? 1 : -1));
  playGameSound('uiConfirm', { cooldownKey: `power:${key}` });
  updateStats();
  renderTopLeftPanel();
}
function powerDistBarColor(value) {
  if (value <= 3) return '#35f06d';
  if (value <= 6) return '#ffd66e';
  return '#ff5b5b';
}
function renderPowerPanel() {
  const power = ensurePlayerPower();
  const profile = getActorPowerProfile();
  const telemetry = power.telemetry || { generation: profile.reactorOutput, consumption: 0, net: profile.reactorOutput };
  const max = getPowerMaxEnergy();
  const energy = Math.round(clamp(finiteNumber(state.power?.energy, max), 0, max));
  const pct = Math.round((energy / Math.max(1, max)) * 100);
  const defs = [
    ['engines', 'ENGINES'],
    ['weapons', 'WEAPONS'],
    ['shields', 'SHIELDS'],
    ['sensors', 'SENSORS'],
  ];
  const tanks = defs.map(([key, label]) => {
    const value = getPowerDist(key);
    return `<div class="power-tank-col"><div class="power-tank" data-power-tank="${key}" title="${label} ${value}/10">`
      + `<div class="power-tank-fill" style="height:${value * 10}%"></div>`
      + `<div class="power-tank-cursor" style="bottom:calc(${value * 10}% - 5px)"></div>`
      + `</div><div class="power-tank-label">${label}</div>`
      + `<div class="power-tank-val">${value}</div></div>`;
  }).join('');
  const allocated = defs.reduce((sum, [key]) => sum + getPowerDist(key), 0);
  return `<div class="panel-head">Power Distribution (OPS) Control</div>`
    + `<div class="meta">Energy ${energy}/${max} (${pct}%) | Allocated ${allocated}/${POWER_DIST_BUDGET} | Drag a system slider</div>`
    + `<div class="meta" data-power-readout>Reactor ${profile.reactorOutput.toFixed(1)} EU/s · Draw ${telemetry.consumption.toFixed(1)} EU/s · ${telemetry.net >= 0 ? (energy >= max ? 'Surplus' : 'Recovering') : 'Draining'} ${Math.abs(telemetry.net).toFixed(1)} EU/s</div>`
    + `<div class="meta">Weapon draw is averaged over one second. Lower system settings reduce demand; reactor output stays fixed.</div>`
    + `<div class="meta" data-power-unused>Unused allocation: ${POWER_DIST_BUDGET - allocated} points. Stored energy is shown above.</div>`
    + `<div class="power-tanks">${tanks}</div>`
    + `<div class="meta" data-power-effects>Impulse ${(powerEngineFactor(power.dist) * 100).toFixed(0)}% · Weapon damage ${(powerWeaponFactor(power.dist) * 100).toFixed(0)}% · Shield recovery ${(getPowerDist('shields') / 5 * 100).toFixed(0)}%</div>`
    + `<div class="meta">Relative to normal allocation (5 points). Stronger shots cost more energy; stronger engines and faster shield recovery draw more power. Weapon recharge stays unchanged. Recent shield hits and available energy still limit recovery.</div>`
    + renderSensorPanelMarkup() + renderEWPanel()
    + `<div class="ship-actions"><button data-top-action="close-panel">Close</button></div>`;
}
function advanceActorPower(npc, frameScale, now) {
  const power = npc ? ensureNpcPower(npc) : ensurePlayerPower();
  const profile = getActorPowerProfile(npc);
  const dt = clamp(finiteNumber(frameScale, 1) / 60, 0, 1);
  const maximum = npc ? npc.maxCombatShields : 100;
  const current = npc ? npc.combatShields : state.shields;
  const shieldFraction = maximum > 0 ? clamp(current / maximum, 0, 1) : 1;
  if (npc) managePowerCrew(power, profile, npc, { combat: Boolean(power.combat), searching: Boolean(power.searching), shieldFraction }, dt);
  const stopped = npc ? (npc.waitUntil > now || isNpcTractorHeld(npc, now) || isNpcEngineDisabled(npc, now)
    || npc.trafficWarp?.phase === 'away' || npc.securityObjective?.holding)
    : state.docked;
  const moving = npc ? !!npc.destination && Math.hypot(npc.destination.x - npc.x, npc.destination.y - npc.y) >= 34
    : state.ship.velocity > 0 || keys.has('w') || keys.has('arrowup');
  const result = stepShipPower(power, profile, dt, {
    throttle: !stopped && moving ? 1 : 0,
    engineBoost: 1 + clamp(finiteNumber((npc || state.ship).systemWarpIntensity, 0), 0, 1) * 2,
    shieldMissing: 1 - shieldFraction,
    shieldReady: now - ((npc || state).lastShieldHitAt || 0) >= SHIELD_REGEN_DELAY_MS,
    cloaked: !npc && Boolean(state.cloak?.active),
  });
  const actor=npc||state, ew=ensureActorEW(actor), sensors=ensureActorSensors(actor);
  const electronics=sensorHullInfo(actor,sensors).profile;
  const raw=getShipStats(npc?npc.shipId:state.playership).sensorProfile||{};
  manageEW(ew,power,npc||{crewSkill:'regular'},dt,{combat:power.combat||(!npc&&now-state.lastPlayerShotAt<5000),searching:power.searching,
    externalNoise:actor.ewReception?.externalNoise||0,capacity:profile.energyCapacity,proposedDraw:(EW_MODULES[ew.module]?.draw||0)+electronics.draw*4});
  const cloaked=npc?!!(npc.cloaked||npc.cloak?.active):isPlayerCloaked(now);
  fundElectronics(power,sensors,electronics,ew,dt,{capacity:profile.energyCapacity,nativeEfficiency:raw.efficiency||1,cloaked,
    blocked:actor.destroyed||cloaked||(!npc&&(state.docked||state.warp.active))||npc?.trafficWarp?.phase==='away'});
  if (npc) npc.combatShields = Math.min(maximum, current + maximum * result.shieldFraction);
  else {
    state.shields = Math.min(100, current + 100 * result.shieldFraction);
    if (result.cloakFailed) {
      setPlayerCloak(false, now);
      setLog('Cloak disengaged: insufficient reactor power and reserves.');
    }
  }
}
function updatePowerSystems(frameScale = 1) {
  if (state.gameOver || !state.gameStarted) return;
  const now = performance.now();
  const previousShieldPercent = Math.floor(state.shields);
  advanceActorPower(null, frameScale, now);
  if (Math.floor(state.shields) !== previousShieldPercent) updateStats();
  for (const npc of state.npcShips || []) {
    if (npc.destroyed) continue;
    ensureNpcCombatStats(npc);
    advanceActorPower(npc, frameScale, now);
  }
  // Fleet records own their power snapshot even if another action wipes scene caches.
  for (const npc of state.npcShips || []) {
    const fleet = !npc.destroyed && npc.fleetId && state.playerFleet.find(f => f.id === npc.fleetId);
    if (fleet) Object.assign(fleet, { ew: snapshotEW(ensureActorEW(npc)), sensors: npc.sensors, power: npc.power, crewSkill: npc.crewSkill, crewTemperament: npc.crewTemperament });
  }
  if (state.topLeftPanelOpen && state.topLeftTab === 'power' && now - (state.lastPowerUiAt || 0) >= 250) {
    state.lastPowerUiAt = now;
    renderTopLeftPanel();
  }
}
function checkSystemFeatUnlocks() {
  if (!state.feats || typeof state.feats !== 'object') state.feats = {};
  const planet = state.planets[state.currentPlanet];
  const name = String(planet?.name || '').toLowerCase();
  if (name === 'bajora' && !state.feats.bajoranFleetDown) {
    const sys = state.systemStates[state.currentPlanet];
    const live = ((sys && sys.stations) || state.stations || []).filter((s) => !s.destroyed && !s.builtByPlayer);
    if (!live.length) {
      state.feats.bajoranFleetDown = true;
      adjustFactionStanding('cardassian', 15);
      setLog('Bajoran system defenses destroyed. The Cardassian Order will now deal with you.');
    }
  }
}

function getFlagPrice(faction = state.systemFaction, systemIndex = state.currentPlanet) {
  const key = normalizeFactionKey(faction);
  const planet = state.planets[systemIndex] || {};
  const market = clamp(finiteNumber(planet.market, 8), 4, 22);
  const factionPremium = key === 'neutral' ? 0 : 650;
  return 1000;
}

function getLocalFlagOffer(systemIndex = state.currentPlanet) {
  if (getCurrentDockedStation()) return null;
  const faction = normalizeFactionKey(getSystemFaction(systemIndex));
  if (!isPurchasableFactionFlag(faction)) return null;
  return {
    faction,
    price: getFlagPrice(faction, systemIndex),
    systemIndex,
  };
}

function renderFactionFlagEmblem(faction = 'neutral', className = 'flag-emblem') {
  const key = normalizeFactionKey(faction);
  const src = factionEmblemAssets[key] || factionEmblemAssets.neutral;
  return `<img class="${escapeHtml(className)}" src="${escapeHtml(src)}?v=${FACTION_EMBLEM_ASSET_VERSION}" alt="">`;
}

function renderPlayerFlagsPanel() {
  const flags = normalizePlayerFlags();
  const rows = flags.map((faction) => {
    const current = normalizeFactionKey(state.playerFaction) === faction;
    return `<span class="flag-inventory-item ${current ? 'current' : ''}">
      ${renderFactionFlagEmblem(faction, 'flag-mini-emblem')}
      <span>${escapeHtml(formatFaction(faction))}</span>
      <button data-flag-raise="${escapeHtml(faction)}" ${current ? 'disabled' : ''}>${current ? 'Raised' : 'Raise'}</button>
    </span>`;
  }).join('');
  return `<div class="flag-inventory">
    <div class="panel-head">Flags</div>
    ${rows || '<div class="meta">No flags owned.</div>'}
  </div>`;
}

function renderFlagMarket() {
  const offer = getLocalFlagOffer();
  if (!offer) {
    return `<div class="panel-head">Flags</div>
      <div class="meta">No faction flag is sold here. Flags are only sold by planets owned by that faction.</div>`;
  }
  const { faction, price } = offer;
  const owned = hasPlayerFlag(faction);
  const current = normalizeFactionKey(state.playerFaction) === faction;
  const canBuy = !owned && state.latinum >= price;
  const buyLabel = owned ? 'Owned' : state.latinum >= price ? 'Buy Flag' : 'Need Latinum';
  return `<div class="panel-head">Faction Flags</div>
    <div class="meta">This planet is controlled by ${escapeHtml(formatFaction(faction))}. Only ${escapeHtml(formatFaction(faction))} planets can sell this flag.</div>
    <div class="shipyard flag-market">
      <div class="ship-card flag-card ${current ? 'current' : ''}">
        <div class="ship-card-head flag-card-head">
          ${renderFactionFlagEmblem(faction)}
          <div class="ship-card-title">
            <div class="name">${escapeHtml(formatFaction(faction))} Flag</div>
            <div class="ship-faction">${current ? 'Current allegiance' : owned ? 'Owned flag' : 'Allegiance charter'}</div>
          </div>
        </div>
        <div class="stats icon-row">
          ${iconStat('latinum', `${price}L`, 'Latinum')}
          <span>Changes allegiance to ${escapeHtml(formatFaction(faction))}</span>
        </div>
        <div class="ship-actions">
          <button data-flag-buy="${escapeHtml(faction)}" ${canBuy ? '' : 'disabled'}>${buyLabel}</button>
          <button data-flag-raise="${escapeHtml(faction)}" ${owned && !current ? '' : 'disabled'}>${current ? 'Raised' : 'Raise Flag'}</button>
        </div>
      </div>
    </div>`;
}

function getShieldColorForFaction(faction = 'neutral') {
  const group = {
    terran: '#56c8ff',
    vulcan: '#56c8ff',
    ferengi: '#56c8ff',
    andorian: '#56c8ff',
    delpin: '#56c8ff',
    promelli: '#56c8ff',
    neutral: '#56c8ff',
    romulan: '#58ff9a',
    klingon: '#58ff9a',
    gorn: '#58ff9a',
    cardassian: '#58ff9a',
    sona: '#58ff9a',
    suliban: '#58ff9a',
    tholian: '#ff6666',
    dominion: '#ff6666',
    breen: '#ff6666',
    hirogen: '#ff6666',
    pirate: '#ff6666',
    tarellian: '#ff6666',
  };
  return group[faction] || group.neutral;
}

function getFactionEnergyColor(faction = 'neutral') {
  const colors = {
    terran: '#5fc8ff',
    ferengi: '#ffcf5a',
    vulcan: '#59ffd0',
    romulan: '#48ff75',
    cardassian: '#ffb347',
    klingon: '#63ff5f',
    dominion: '#b45cff',
    breen: '#6be8ff',
    tholian: '#ff6e4a',
    bajoran: '#ffa544',
    sona: '#54f0ff',
    delpin: '#7bd7ff',
    tarellian: '#ff667c',
    promelli: '#c58cff',
    andorian: '#69d7ff',
    gorn: '#8fff58',
    hirogen: '#ff8a45',
    suliban: '#50ffb4',
    borg: '#80ff73',
    pirate: '#ff4e4e',
    neutral: '#dfeaff',
  };
  return colors[faction] || colors.neutral;
}

function getWeaponShotColor(faction = 'neutral', weapon = null) {
  if (isCuttingBeamWeapon(weapon)) return CUTTING_BEAM_COLOR;
  if (weapon?.color) return weapon.color;
  const name = String(weapon?.name || '').toLowerCase();
  if (name.includes('polaron torpedo') || name.includes('vortex')) return '#b979ff';
  if (name.includes('polaron')) return '#d95b5b';
  if (name.includes('plasma') || name.includes('biobeam') || name.includes('thaleron')) return '#51e85a';
  if (name.includes('disruptor')) return '#ff9a64';
  if (name.includes('quantum') || name.includes('tachyon') || name.includes('tesla')) return '#8ffff2';
  if (name.includes('photon') || name.includes('transphasic') || name.includes('magnetorp')) return '#ffffff';
  if (name.includes('pulse')) return '#ffc254';
  if (name.includes('phaser')) return '#ff9a3d';
  if (name.includes('particle')) return '#9ce8ff';
  return getFactionEnergyColor(faction);
}

function getMapFactionProfile(faction = 'neutral') {
  const profiles = {
    terran: { primary: '#38bfff', secondary: '#f6f8ff', dash: [] },
    ferengi: { primary: '#ffbf32', secondary: '#7aefe5', dash: [10, 4] },
    vulcan: { primary: '#4dffd2', secondary: '#ff9e5d', dash: [5, 5] },
    romulan: { primary: '#35f06d', secondary: '#aaff7d', dash: [12, 5] },
    cardassian: { primary: '#ff9e3d', secondary: '#d7c28b', dash: [7, 4, 2, 4] },
    klingon: { primary: '#c20b0b', secondary: '#ff3b30', dash: [14, 5] },
    dominion: { primary: '#aa62ff', secondary: '#ff76d7', dash: [4, 3] },
    breen: { primary: '#78eaff', secondary: '#e7f7ff', dash: [11, 3, 3, 3] },
    tholian: { primary: '#ff6848', secondary: '#ffe86a', dash: [2, 3] },
    bajoran: { primary: '#ff9b35', secondary: '#ffe15f', dash: [8, 3] },
    sona: { primary: '#41f2ff', secondary: '#ffd777', dash: [9, 3, 2, 3] },
    delpin: { primary: '#7fb8ff', secondary: '#ffffff', dash: [6, 4] },
    tarellian: { primary: '#ff6175', secondary: '#5df2ff', dash: [8, 5] },
    promelli: { primary: '#ce8aff', secondary: '#ffe26d', dash: [3, 3, 10, 3] },
    andorian: { primary: '#55d9ff', secondary: '#ffffff', dash: [6, 2, 2, 2] },
    gorn: { primary: '#83d244', secondary: '#e6ff70', dash: [10, 5, 3, 5] },
    hirogen: { primary: '#ff7a35', secondary: '#ffd39b', dash: [12, 3] },
    suliban: { primary: '#3dffb1', secondary: '#ffe1a6', dash: [5, 4, 12, 4] },
    pirate: { primary: '#ff3535', secondary: '#222222', dash: [5, 2] },
    neutral: { primary: '#8aa0bd', secondary: '#dfeaff', dash: [3, 5] },
  };
  return profiles[faction] || profiles.neutral;
}

function getMapFactionColor(faction = 'neutral') {
  return getMapFactionProfile(faction).primary;
}

function getFactionEmblemSprite(faction = 'neutral') {
  const sprite = factionEmblemSprites[faction] || factionEmblemSprites.neutral;
  return sprite?.complete && sprite.naturalWidth > 0 ? sprite : null;
}

const BM1_GOVERNMENT_FACTIONS = {
  0: 'neutral', 1: 'terran', 2: 'klingon', 3: 'cardassian', 4: 'bajoran',
  5: 'vulcan', 6: 'romulan', 7: 'ferengi', 8: 'andorian', 9: 'delpin',
  10: 'neutral', 11: 'tholian', 12: 'neutral', 13: 'neutral', 14: 'borg', 15: 'pirate', 16: 'dominion',
};
function getBaseSystemFaction(index = state.currentPlanet) {
  return getBaseSystemOrigin(index).faction ?? 'neutral';
}

// Name/description heuristics for worlds without a mapped government ID. Returns null, never
// a default, so an unrecognized world stays unknown instead of quietly becoming independent.
function matchSystemFactionByName(index = state.currentPlanet) {
  const planet = state.planets[index] || {};
  const row = state.systemData[index] || [];
  const name = String(planet.name || row[0] || '').toLowerCase();
  const desc = String(row[7] || '').toLowerCase();
  const text = `${name} ${desc}`;

  if (name.includes('pirates haven') || text.includes('pirate')) return 'pirate';
  if (name.includes('terra nova') || name.includes('andreas') || name.includes('new switzerland') || name.includes('mars') || name.includes('luna') || name.includes('proxima') || name.includes('tellar') || text.includes('human colony') || text.includes('terran')) return 'terran';
  if (name.includes('andoria')) return 'andorian';
  if (name.includes('ferenginar') || name.includes('lappa') || name.includes('hupyrian') || text.includes('ferengi')) return 'ferengi';
  if (name.includes('vulcan') || name.includes("p'jem") || name.includes("t'khut") || name.includes("ni'var") || text.includes('vulcan')) return 'vulcan';
  if (name === 'bajora' || (text.includes('bajoran') && !text.includes('dominion'))) return 'bajoran';
  if (text.includes('andorian')) return 'andorian';
  if (name.includes('gorn') || text.includes('gorn')) return 'gorn';
  if (name.includes('hirogen') || text.includes('hirogen')) return 'hirogen';
  if (name.includes('suliban') || text.includes('suliban')) return 'suliban';
  if (name.includes('romulus') || name.includes('remus') || name.includes('rator') || name.includes('virinat') || name.includes('chaltok') || text.includes('romulan') || text.includes('reman')) return 'romulan';
  if (name.includes('cardassia') || name.includes('lakarian') || name.includes('arawath') || name.includes('monac') || text.includes('cardassian')) return 'cardassian';
  if (name.includes('qonos') || name.includes('worf') || name.includes('kah') || name.includes('boreth') || name.includes("ty'gokor") || name.includes('narendra') || text.includes('klingon')) return 'klingon';
  if (name.includes('breen') || name.includes('brea') || text.includes('breen')) return 'breen';
  if (name.includes('sonata') || name.includes('iritum') || name.includes('goralis') || text.includes("son'a") || text.includes('briar patch')) return 'sona';
  if (name.includes('dominica') || name.includes('vortara') || text.includes('dominion') || text.includes("jem'hadar") || text.includes("jem'haddar") || text.includes('vorta') || text.includes('founder') || text.includes('karemma') || text.includes('dosi') || text.includes('t-rogoran')) return 'dominion';
  if (name.includes('thol') || text.includes('tholian')) return 'tholian';
  if (name.includes('delpi')) return 'delpin';
  if (name.includes('tarellia')) return 'tarellian';
  if (name.includes('promel')) return 'promelli';
  return null;
}

// The player's side is a stable political identity. The raised flag (state.playerFaction) is
// the side's current broadcast allegiance and can change; the side does not.
const PLAYER_SIDE = 'player';
function getPlayerSide() { return PLAYER_SIDE; }
function getPlayerFlag() { return normalizeFactionKey(state.playerFaction || 'neutral'); }

// Original political identity of a system: a mapped government ID (an explicit 'neutral' there is
// independence recorded in the data), else a name match, else unknown (null). Nothing here
// invents ownership; gameplay fallbacks to 'neutral' happen only in getSystemFaction.
function getBaseSystemOrigin(index = state.currentPlanet) {
  const planet = state.planets[index] || {};
  const row = state.systemData[index] || [];
  const gov = Number(planet.governmentId ?? row[1]);
  if (Number.isFinite(gov) && BM1_GOVERNMENT_FACTIONS[gov] !== undefined) {
    return { faction: BM1_GOVERNMENT_FACTIONS[gov], source: 'government' };
  }
  const named = matchSystemFactionByName(index);
  if (named) return { faction: named, source: 'name' };
  return { faction: null, source: 'unknown' };
}

function isRecognizedFactionKey(key) {
  return typeof key === 'string' && key !== 'neutral' && Boolean(factionNames[key]);
}
// Canonical polity identity: recognized faction keys and 'neutral' are lowercase; any other
// (custom) ID is kept exactly as written, apart from surrounding whitespace.
function canonicalPolityId(value) {
  const raw = String(value ?? '').trim();
  if (!raw) return null;
  const lower = raw.toLowerCase();
  if (lower === 'neutral' || isRecognizedFactionKey(lower) || lower === 'pirate' || lower === 'borg') return lower;
  return raw;
}

// Resolves who holds a system, keeping the questions apart:
//   origin      original political identity from data, or null when unknown
//   controller  who holds it now: PLAYER_SIDE, a recognized faction key, 'neutral' for explicit
//               independence, or a custom polity ID in canonical form (canonicalPolityId: kept
//               exactly as written apart from surrounding whitespace; never folded to 'neutral')
//   polityId    the distinct identity of the holding organization: the faction key, 'player', the
//               custom ID, or polity:<index> so two independent worlds are never one owner
//   allegiance  the flag flown there for gameplay: the player's flag when player-held, the faction
//               key when a faction holds it, otherwise 'neutral'
// Asset ownership is NOT derived here; see getStationOwner.
function getSystemControl(index = state.currentPlanet) {
  const i = Number(index);
  const origin = getBaseSystemOrigin(i);
  const playerControlled = (state.controlledSystems || []).some((entry) => Number(entry) === i);
  const overrides = state.factionSystemOverrides || {};
  const rawOverride = Object.prototype.hasOwnProperty.call(overrides, i) ? overrides[i] : undefined;
  const hasOverride = rawOverride !== undefined && rawOverride !== null && String(rawOverride).trim() !== '';
  let controller;
  let controlSource;
  if (playerControlled) {
    controller = PLAYER_SIDE;
    controlSource = 'player';
  } else if (hasOverride) {
    controller = canonicalPolityId(rawOverride);
    controlSource = 'override';
  } else {
    controller = origin.faction;
    controlSource = origin.source;
  }
  let polityId;
  if (controller === PLAYER_SIDE) polityId = PLAYER_SIDE;
  else if (isRecognizedFactionKey(controller)) polityId = controller;
  else if (controller === 'neutral') polityId = `polity:${i}`;
  else if (controller) polityId = controller;
  else polityId = null;
  let allegiance;
  if (controller === PLAYER_SIDE) allegiance = getPlayerFlag();
  else if (isRecognizedFactionKey(controller)) allegiance = controller;
  else allegiance = 'neutral';
  return { index: i, origin: origin.faction, originSource: origin.source, controller, controlSource, polityId, allegiance, playerControlled };
}

function isPlayerSideNpc(npc) {
  return Boolean(npc && !npc.destroyed && (isPlayerEscortNpc(npc) || npc.role === 'playerFleet'));
}

// ---- Sides: who owns or commands a thing. 'neutral' is a status, never a side. ----
// Ships: the player's side, else an explicit side/command identity carried by the ship (sideId,
// set at construction and preserved through snapshots), else derived: a recognized faction, or a
// per-ship identity for an independent ship.
function deriveNpcSideId(faction, id) {
  const key = canonicalPolityId(faction);
  if (isRecognizedFactionKey(key) || key === 'pirate' || key === 'borg') return key;
  return `ship:${id}`;
}
function getNpcSideId(npc) {
  if (!npc) return null;
  if (isPlayerSideNpc(npc)) return PLAYER_SIDE;
  if (typeof npc.sideId === 'string' && npc.sideId) return npc.sideId;
  return deriveNpcSideId(npc.faction, npc.id);
}
function sameSide(a, b) { return Boolean(a) && Boolean(b) && a === b; }
function sidesAligned(a, b) {
  if (sameSide(a, b)) return true;
  return isRecognizedFactionKey(a) && isRecognizedFactionKey(b) && areFactionsAligned(a, b);
}
function sidesOpposed(a, b) {
  return isRecognizedFactionKey(a) && isRecognizedFactionKey(b) && areFactionsOpposed(a, b);
}

// Owner identity of a station. Explicit records (capture, claim, construction) win; otherwise a
// station with an explicit owner in the data keeps it (a 'neutral' data owner is a private
// concession with its own identity); otherwise it is a government installation of the system's
// original polity. Controlling a system does NOT make its installations yours; conquest transfers
// eligible government installations explicitly (see transferSystemInstallations).
function getStationDataOwner(station) {
  if (!station) return null;
  // Runtime stations carry dataFaction (captured at build); a bare definition carries its data
  // faction in `faction`; a legacy runtime station without dataFaction is looked up by id.
  const definition = station.dataFaction !== undefined
    ? station
    : ((state.stationDefinitions || []).find((entry) => entry.id === station.id) || station);
  const dataFaction = definition.dataFaction !== undefined ? definition.dataFaction : definition.faction;
  if (station.builtByPlayer) return null;
  if (dataFaction === undefined || dataFaction === null || dataFaction === '') return null;
  const key = canonicalPolityId(dataFaction);
  if (isRecognizedFactionKey(key)) return key;
  if (key === 'neutral') return `private:${station.id}`;
  return key; // custom owner id, canonical form (kept exactly as written)
}
function getSystemGovernmentOwnerId(systemIndex) {
  const origin = getBaseSystemOrigin(systemIndex);
  if (isRecognizedFactionKey(origin.faction)) return origin.faction;
  if (origin.faction === 'neutral') return `polity:${Number(systemIndex)}`;
  return null; // unknown origin: unowned, nobody's side
}
function getStationOwner(station, systemIndex = station?.systemIndex ?? state.currentPlanet) {
  if (!station) return null;
  const recorded = state.stationOwners?.[station.id];
  if (recorded !== undefined && recorded !== null) return recorded;
  if (station.builtByPlayer) return PLAYER_SIDE;
  const dataOwner = getStationDataOwner(station);
  if (dataOwner) return dataOwner;
  return getSystemGovernmentOwnerId(systemIndex);
}
function isPlayerOwnedStation(station, systemIndex = station?.systemIndex ?? state.currentPlanet) {
  return getStationOwner(station, systemIndex) === PLAYER_SIDE;
}
function getStationFlagForOwner(ownerId) {
  if (ownerId === PLAYER_SIDE) return getPlayerFlag();
  if (isRecognizedFactionKey(ownerId)) return ownerId;
  return 'neutral';
}
// Re-derives owner, flag and attitude of a station from current records.
function deriveStationOwnership(station, systemIndex) {
  const ownerId = getStationOwner(station, systemIndex);
  const owned = ownerId === PLAYER_SIDE;
  const faction = getStationFlagForOwner(ownerId);
  const attitude = station.destroyed ? 'destroyed' : owned ? 'friendly' : getFactionAttitude(faction);
  return { ...station, ownerId, ownedByPlayer: owned, faction, attitude, hostile: owned ? false : Boolean(station.hostile) };
}
function refreshStationOwnership(systemIndex = state.currentPlanet) {
  state.stations = (state.stations || []).map((station) => (station ? deriveStationOwnership(station, systemIndex) : station));
}
function refreshCachedStationOwnership(systemIndex = state.currentPlanet) {
  const cached = state.systemStates?.[Number(systemIndex)];
  if (!cached?.stations) return;
  cached.stations = cached.stations.map((station) => (station ? deriveStationOwnership(station, systemIndex) : station));
}
// ---- Security policies: how the player's holdings respond. Side-bound, not flag-bound. ----
function sanitizeSecurityPolicy(partial) {
  const out = {};
  if (!partial || typeof partial !== 'object') return out;
  if (SECURITY_ROE_VALUES.includes(partial.roe)) out.roe = partial.roe;
  if (partial.access && typeof partial.access === 'object') {
    const access = {};
    for (const key of Object.keys(DEFAULT_SECURITY_POLICY.access)) {
      if (SECURITY_ACCESS_VALUES.includes(partial.access[key])) access[key] = partial.access[key];
    }
    if (Object.keys(access).length) out.access = access;
  }
  if (SECURITY_ALERT_VALUES.includes(partial.alerts)) out.alerts = partial.alerts;
  return out;
}
// Overlay by dimension: a partial override of access.warFlag leaves every other access default intact.
function mergeSecurityPolicy(base, override) {
  const b = base || DEFAULT_SECURITY_POLICY;
  const o = override || {};
  return {
    roe: o.roe || b.roe,
    access: { ...DEFAULT_SECURITY_POLICY.access, ...(b.access || {}), ...(o.access || {}) },
    alerts: o.alerts || b.alerts,
  };
}
function ensureSecurityPolicies() {
  if (!state.securityPolicies || typeof state.securityPolicies !== 'object') state.securityPolicies = { default: null, systems: {} };
  if (!state.securityPolicies.systems || typeof state.securityPolicies.systems !== 'object') state.securityPolicies.systems = {};
  return state.securityPolicies;
}
function getSecurityPolicyDefault() {
  return mergeSecurityPolicy(DEFAULT_SECURITY_POLICY, ensureSecurityPolicies().default);
}
function getSecurityPolicyOverride(systemIndex = state.currentPlanet) {
  const override = ensureSecurityPolicies().systems[Number(systemIndex)];
  return override && Object.keys(override).length ? override : null;
}
// The policy in force where the player's side has authority; null elsewhere. A local override is
// kept while the holding is lost (inactive) and applies again on reclamation.
function getEffectiveSecurityPolicy(systemIndex = state.currentPlanet) {
  if (!getSystemControl(systemIndex).playerControlled) return null;
  return mergeSecurityPolicy(getSecurityPolicyDefault(), getSecurityPolicyOverride(systemIndex));
}
// Rules of engagement for the player's forces at a system: the effective policy in a holding, the
// empire default as standing orders anywhere else.
function getPlayerRoeAt(systemIndex = state.currentPlanet) {
  return (getEffectiveSecurityPolicy(systemIndex) || getSecurityPolicyDefault()).roe;
}
function setSecurityPolicyDefault(partial) {
  const policies = ensureSecurityPolicies();
  policies.default = mergeSecurityPolicy(getSecurityPolicyDefault(), sanitizeSecurityPolicy(partial));
  return getSecurityPolicyDefault();
}
function setSecurityPolicyOverride(systemIndex, partial) {
  if (!getSystemControl(systemIndex).playerControlled) return null; // no authority, no override
  const policies = ensureSecurityPolicies();
  const key = Number(systemIndex);
  const current = policies.systems[key] || {};
  const next = sanitizeSecurityPolicy(partial);
  const merged = { ...current, ...next };
  if (current.access || next.access) merged.access = { ...(current.access || {}), ...(next.access || {}) };
  policies.systems[key] = sanitizeSecurityPolicy(merged); // canonical shape, so saved and live forms agree
  return getEffectiveSecurityPolicy(key);
}
function clearSecurityPolicyOverride(systemIndex) {
  delete ensureSecurityPolicies().systems[Number(systemIndex)];
}

// ---- Phase 3: holding zones and compliance ----
// Records. Zones: the player's checkpoint configuration per system plus an authority epoch per
// system (bumped on every actual holder change, so old orders and clearances never reactivate).
// Encounters: per system, a local clock, visitor boundary state by physical instance, orders, the
// bounded participant snapshots needed to resume them, and a short event history. Saved with the
// game, independently of the systemStates cache (which is wiped by loads, builds and rebuilds).
function ensureSecurityZones() {
  if (!state.securityZones || typeof state.securityZones !== 'object') state.securityZones = { version: 1, nextVisitorInstance: 1, systems: {}, epochs: {} };
  const zones = state.securityZones;
  if (!zones.systems || typeof zones.systems !== 'object') zones.systems = {};
  if (!zones.epochs || typeof zones.epochs !== 'object') zones.epochs = {};
  if (!Number.isFinite(zones.nextVisitorInstance) || zones.nextVisitorInstance < 1) zones.nextVisitorInstance = 1;
  return zones;
}
function ensureSecurityEncounters() {
  if (!state.securityEncounters || typeof state.securityEncounters !== 'object') state.securityEncounters = { version: 1, systems: {} };
  if (!state.securityEncounters.systems || typeof state.securityEncounters.systems !== 'object') state.securityEncounters.systems = {};
  return state.securityEncounters;
}
function getSecurityLedger(systemIndex = state.currentPlanet) {
  return ensureSecurityEncounters().systems[Number(systemIndex)] || null;
}
function ensureSecurityLedger(systemIndex = state.currentPlanet) {
  const systems = ensureSecurityEncounters().systems;
  const key = Number(systemIndex);
  if (!systems[key] || typeof systems[key] !== 'object') {
    systems[key] = { localElapsedMs: 0, nextOrder: 1, visitors: {}, orders: {}, participants: {}, recentEvents: [] };
  }
  const ledger = systems[key];
  if (!Number.isFinite(ledger.localElapsedMs)) ledger.localElapsedMs = 0;
  if (!Number.isFinite(ledger.nextOrder) || ledger.nextOrder < 1) ledger.nextOrder = 1;
  if (typeof ledger.accessSignature !== 'string') ledger.accessSignature = '';
  for (const field of ['visitors', 'orders', 'participants']) if (!ledger[field] || typeof ledger[field] !== 'object') ledger[field] = {};
  if (!Array.isArray(ledger.recentEvents)) ledger.recentEvents = [];
  return ledger;
}
// A physical visitor instance. Distinct from npc.id (a spawn slot that ambient replacement reuses)
// and from the political sideId. Assigned once per vessel and preserved through snapshots.
function nextSecurityInstanceId() {
  const zones = ensureSecurityZones();
  const id = `v${zones.nextVisitorInstance}`;
  zones.nextVisitorInstance += 1;
  return id;
}
function ensureNpcSecurityInstance(npc) {
  if (!npc) return null;
  if (typeof npc.securityInstanceId !== 'string' || !npc.securityInstanceId) npc.securityInstanceId = nextSecurityInstanceId();
  return npc.securityInstanceId;
}
function getSecurityAuthorityEpoch(systemIndex) {
  return Math.max(0, Math.round(finiteNumber(ensureSecurityZones().epochs[Number(systemIndex)], 0)));
}
function bumpSecurityAuthorityEpoch(systemIndex) {
  const zones = ensureSecurityZones();
  zones.epochs[Number(systemIndex)] = getSecurityAuthorityEpoch(systemIndex) + 1;
  return zones.epochs[Number(systemIndex)];
}
function pushSecurityEvent(ledger, text) {
  if (!ledger) return;
  ledger.recentEvents.push({ atMs: Math.round(ledger.localElapsedMs), text: String(text) });
  while (ledger.recentEvents.length > SECURITY_HISTORY_CAP) ledger.recentEvents.shift();
}

// Player checkpoint configuration. Setting it requires authority; the stored record is validated
// against current control and station ownership every time the zone is resolved.
function getPlayerCheckpointConfig(systemIndex = state.currentPlanet) {
  const config = ensureSecurityZones().systems[Number(systemIndex)];
  return config && typeof config === 'object' ? config : null;
}
function setPlayerCheckpoint(systemIndex, { enabled, anchorStationId } = {}) {
  const i = Number(systemIndex);
  if (!isSystemControlled(i)) return null; // no authority, no checkpoint
  const zones = ensureSecurityZones();
  const current = zones.systems[i] || { enabled: false, anchorStationId: null };
  const next = {
    enabled: enabled === undefined ? Boolean(current.enabled) : Boolean(enabled),
    anchorStationId: anchorStationId === undefined ? (current.anchorStationId || null) : (anchorStationId ? String(anchorStationId) : null),
  };
  if (next.anchorStationId && !getSecurityAnchorCandidates(i, PLAYER_SIDE).some((station) => station.id === next.anchorStationId)) next.anchorStationId = null;
  zones.systems[i] = next;
  return next;
}
// Installations that may issue orders for an authority in the current system: live, completed,
// owned by that side (recorded owner, never the flag) and planet-anchored. Outer stations orbit
// the star far outside every traffic lane and would see nothing.
function getSecurityAnchorCandidates(systemIndex = state.currentPlanet, authority = PLAYER_SIDE) {
  if (Number(systemIndex) !== Number(state.currentPlanet)) return [];
  return (state.stations || []).filter((station) => station && !station.destroyed && !station.underConstruction
    && station.orbitAnchor === 'planet' && getStationOwner(station, systemIndex) === authority);
}
function getSecurityZoneRadius(systemIndex, authority) {
  const own = getSecurityAnchorCandidates(systemIndex, authority);
  const farthest = own.reduce((max, station) => Math.max(max, finiteNumber(station.orbitDistance, 0)), 0);
  return Math.round(clamp(farthest + SECURITY_ZONE_RADIUS_MARGIN, SECURITY_ZONE_MIN_RADIUS, SECURITY_ZONE_MAX_RADIUS));
}
// The active zone in the current system, or null. Player authority needs control plus an enabled
// configuration with a valid anchor; foreign authority needs the authored checkpoint's faction to
// hold the world and own a listed anchor. At most one zone is active per system.
function getSecurityZone(systemIndex = state.currentPlanet) {
  const i = Number(systemIndex);
  if (i !== Number(state.currentPlanet) || !state.systemPlanet || !state.gameStarted) return null;
  const control = getSystemControl(i);
  let authority = null;
  let label = '';
  let access = null;
  let anchor = null;
  let foreign = false;
  if (control.playerControlled) {
    const config = getPlayerCheckpointConfig(i);
    if (!config?.enabled) return null;
    anchor = getSecurityAnchorCandidates(i, PLAYER_SIDE).find((station) => station.id === config.anchorStationId) || null;
    if (!anchor) return null;
    authority = PLAYER_SIDE;
    label = `${state.planets[i]?.name || 'System'} Security`;
    access = { ...getEffectiveSecurityPolicy(i).access };
  } else {
    const authored = SECURITY_AUTHORED_CHECKPOINTS.find((entry) => getSystemIndexByName(entry.systemName) === i);
    if (!authored || control.controller !== authored.authority) return null;
    const candidates = getSecurityAnchorCandidates(i, authored.authority);
    anchor = authored.anchorNames.map((name) => candidates.find((station) => station.name === name)).find(Boolean) || null;
    if (!anchor) return null;
    authority = authored.authority;
    label = authored.label;
    access = { ...DEFAULT_SECURITY_POLICY.access, ...authored.access };
    foreign = true;
  }
  const radius = getSecurityZoneRadius(i, authority);
  return {
    id: `zone:${i}:${authority}`,
    systemIndex: i,
    authority,
    label,
    foreign,
    flag: authority === PLAYER_SIDE ? getPlayerFlag() : authority,
    anchorStationId: anchor.id,
    anchorName: anchor.name,
    centre: { x: state.systemPlanet.x, y: state.systemPlanet.y },
    radius,
    holdDistance: Math.round(radius * SECURITY_HOLD_FRACTION),
    exitDistance: radius + SECURITY_EXIT_MARGIN,
    reentryDistance: radius + SECURITY_REENTRY_MARGIN,
    access,
    accessSignature: JSON.stringify(access),
    geometryKey: `${anchor.id}:${radius}`,
    epoch: getSecurityAuthorityEpoch(i),
  };
}
function resolveSecurityPoint(zone, polar) {
  if (!zone || !polar) return null;
  return { x: zone.centre.x + Math.cos(polar.angle) * polar.distance, y: zone.centre.y + Math.sin(polar.angle) * polar.distance };
}
function distanceToSecurityCentre(zone, point) {
  return Math.hypot(point.x - zone.centre.x, point.y - zone.centre.y);
}

// Contacts use received declarations, independently of physical tracking and actual side.
function getSecurityContact(entity) {
  if (entity === 'player' || entity?.kind === 'player') {
    return { kind: 'player', instanceId: 'player', side: PLAYER_SIDE, role: 'player', name: 'your ship', broadcast: sensorCheckpointBroadcast(state) };
  }
  if (!entity) return null;
  return {
    kind: 'npc',
    instanceId: ensureNpcSecurityInstance(entity),
    npcId: entity.id,
    side: getNpcSideId(entity),
    role: entity.role || 'traffic',
    name: sensorSide(entity)===getSecurityZone()?.authority?getShipDisplayName(entity):'Contact '+ensureNpcSecurityInstance(entity),
    // Defaults are explicit transmitters; radio claims never change actual ownership.
    broadcast: sensorCheckpointBroadcast(entity),
  };
}
// Own side is exempt (by side, never by flag). Otherwise: no identified broadcast is `unknown` and
// enforceable for a locally tracked visitor; a recognised faction at war with the authority's current flag is
// `warFlag`; a declared neutral identity is `independent`; everything else, same-flag foreigners and allies included, is `other`.
function getVisitorAccessDecision(zone, contact) {
  if (!zone || !contact) return null;
  if (sameSide(contact.side, zone.authority)) return { class: 'exempt', decision: 'open', enforceable: false, reason: 'own side' };
  const broadcast = contact.broadcast || { source: 'none' };
  if (broadcast.source === 'none' || !broadcast.faction) {
    return { class: 'unknown', decision: zone.access.unknown || 'open', enforceable: true, reason: 'no identified broadcast' };
  }
  const faction = broadcast.faction;
  let cls;
  if (isRecognizedFactionKey(faction) && areFactionsOpposed(faction, zone.flag)) cls = 'warFlag';
  else if (faction === 'neutral') cls = 'independent';
  else cls = 'other'; // allies, same-flag foreigners, and identified custom organizations
  return { class: cls, decision: zone.access[cls] || 'open', enforceable: true, reason: `${isRecognizedFactionKey(faction) ? formatFaction(faction) : faction} broadcast (${broadcast.source})` };
}

// Orders: one per zone, authority epoch, physical visitor and entry episode. A revised instruction
// updates the same order; nothing here creates a new incident per tick or per hail.
function getSecurityActiveOrders(ledger) {
  return ledger ? Object.values(ledger.orders).filter((order) => order && !order.outcome) : [];
}
function getSecurityOrderForVisitor(ledger, instanceId) {
  return getSecurityActiveOrders(ledger).find((order) => order.visitorInstanceId === instanceId) || null;
}
function getPlayerSecurityOrder(systemIndex = state.currentPlanet) {
  return getSecurityOrderForVisitor(getSecurityLedger(systemIndex), 'player');
}
function getSecurityVisitor(ledger, instanceId, create = false) {
  if (!ledger) return null;
  if (!ledger.visitors[instanceId] && create) {
    ledger.visitors[instanceId] = { inside: false, episode: 0, addressedEpisode: null, clearance: null, noncompliant: false, lastOutcome: null, name: '' };
  }
  return ledger.visitors[instanceId] || null;
}
function estimateSecurityTravelMs(distance, unitsPerFrame) {
  const perFrame = Math.max(0.3, finiteNumber(unitsPerFrame, 1));
  return (distance / perFrame) * 16.6667;
}
function computeSecurityAllowanceMs(distance, unitsPerFrame, kind) {
  const travel = estimateSecurityTravelMs(distance, unitsPerFrame) + 4000; // plus turning and approach
  return Math.round(Math.max(SECURITY_MIN_ALLOWANCE_MS, travel * 2 + (kind === 'challenge' ? SECURITY_DWELL_MS : 0)));
}
function describeSecurityInstruction(order, zone) {
  const authority = zone?.label || order.authorityLabel || 'Local authority';
  if (order.kind === 'withdraw') return `${authority}: this area is closed to your vessel. Withdraw beyond the marked exit.`;
  return `${authority}: hold at the marked point for an identity check. Stop within ${SECURITY_HOLD_TOLERANCE} units and hold for ${Math.round(SECURITY_DWELL_MS / 1000)} seconds.`;
}
function issueSecurityOrder(ledger, zone, contact, decision, position, unitsPerFrame) {
  const kind = decision.decision === 'closed' ? 'withdraw' : 'challenge';
  const angle = Math.atan2(position.y - zone.centre.y, position.x - zone.centre.x);
  const hold = { angle, distance: zone.holdDistance };
  const exit = { angle, distance: zone.exitDistance + 60 };
  const target = resolveSecurityPoint(zone, kind === 'withdraw' ? exit : hold);
  const distance = Math.hypot(target.x - position.x, target.y - position.y);
  const allowance = computeSecurityAllowanceMs(distance, unitsPerFrame, kind);
  const id = `o${ledger.nextOrder}`;
  ledger.nextOrder += 1;
  const order = {
    id,
    zoneId: zone.id,
    geometryKey: zone.geometryKey,
    systemIndex: zone.systemIndex,
    authority: zone.authority,
    authorityLabel: zone.label,
    epoch: zone.epoch,
    visitorInstanceId: contact.instanceId,
    visitorKind: contact.kind,
    visitorName: contact.name,
    npcId: contact.kind === 'npc' ? contact.npcId : null,
    episode: getSecurityVisitor(ledger, contact.instanceId, true).episode,
    accessClass: decision.class,
    decision: decision.decision,
    accessSignature: zone.accessSignature,
    kind,
    revision: 1,
    state: 'pending', // pending | holding | check_incomplete
    outcome: null,
    reason: '',
    hold,
    exit,
    withdrawing: false, // a challenge the visitor chose to leave instead of completing
    allowanceMs: allowance,
    remainingMs: allowance,
    dwellMs: 0,
    issuedAtMs: Math.round(ledger.localElapsedMs),
    resolvedAtMs: null,
    acknowledged: false,
    compliance: null, // { scope: 'movement_identity' | 'withdrawal' }
    noncompliant: false,
  };
  ledger.orders[id] = order;
  const visitor = getSecurityVisitor(ledger, contact.instanceId, true);
  visitor.addressedEpisode = visitor.episode;
  visitor.name = contact.name;
  pushSecurityEvent(ledger, `${zone.label} ordered ${contact.name} to ${kind === 'withdraw' ? 'withdraw' : 'hold for an identity check'} (${decision.class}).`);
  return order;
}
function reviseSecurityOrder(order, zone, position, unitsPerFrame, kind, reason) {
  order.kind = kind;
  order.revision += 1;
  order.state = 'pending';
  order.dwellMs = 0;
  order.accessSignature = zone.accessSignature;
  order.decision = kind === 'withdraw' ? 'closed' : 'challenge';
  order.withdrawing = false;
  const target = resolveSecurityPoint(zone, kind === 'withdraw' ? order.exit : order.hold);
  const distance = Math.hypot(target.x - position.x, target.y - position.y);
  order.allowanceMs = computeSecurityAllowanceMs(distance, unitsPerFrame, kind);
  order.remainingMs = order.allowanceMs;
  order.reason = reason || '';
  order.acknowledged = false;
}
const SECURITY_NONCOMPLIANT_OUTCOMES = new Set(['refused', 'expired']);
const SECURITY_CLEARING_OUTCOMES = new Set(['cleared', 'waived']);
function resolveSecurityOrder(ledger, order, outcome, reason = '', options = {}) {
  if (!order || order.outcome) return order;
  order.outcome = outcome;
  order.reason = reason;
  order.resolvedAtMs = Math.round(ledger.localElapsedMs);
  if (outcome === 'cleared') order.compliance = { scope: 'movement_identity' };
  if (outcome === 'withdrawn') order.compliance = { scope: 'withdrawal' };
  const visitor = getSecurityVisitor(ledger, order.visitorInstanceId, true);
  visitor.lastOutcome = outcome;
  if (SECURITY_NONCOMPLIANT_OUTCOMES.has(outcome)) visitor.noncompliant = true;
  if (SECURITY_CLEARING_OUTCOMES.has(outcome)) {
    visitor.clearance = { orderId: order.id, epoch: order.epoch, accessClass: order.accessClass, accessSignature: order.accessSignature, provenance: outcome === 'waived' ? 'waiver' : 'check' };
    visitor.noncompliant = false;
  }
  delete ledger.participants[order.visitorInstanceId];
  pushSecurityEvent(ledger, `${order.visitorName}: ${outcome}${reason ? ` (${reason})` : ''}.`);
  if (order.visitorKind === 'player') {
    state.securityOutcomeNotice = { outcome, reason, authorityLabel: order.authorityLabel, atMs: Math.round(ledger.localElapsedMs), systemIndex: order.systemIndex };
    if (!options.silent) setLog(describeSecurityOutcomeForPlayer(order));
  } else if (order.authority === PLAYER_SIDE && !options.silent && (SECURITY_NONCOMPLIANT_OUTCOMES.has(outcome) || outcome === 'cleared' || outcome === 'withdrawn')) {
    setLog(`${order.authorityLabel}: ${order.visitorName} ${outcome}.`);
  }
  if (order.visitorKind === 'npc' && Number(order.systemIndex) === Number(state.currentPlanet)) {
    const npc = (state.npcShips || []).find((entry) => entry && entry.securityInstanceId === order.visitorInstanceId);
    if (npc?.securityObjective?.orderId === order.id) endNpcSecurityObjective(npc, outcome);
  }
  pruneSecurityHistory(ledger);
  return order;
}
function describeSecurityOutcomeForPlayer(order) {
  const who = order.authorityLabel || 'Local authority';
  switch (order.outcome) {
    case 'cleared': return `${who}: identity check complete. You are cleared for this visit.`;
    case 'waived': return `${who}: check waived. You may proceed for this visit.`;
    case 'withdrawn': return `${who}: withdrawal acknowledged.`;
    case 'refused': return `${who}: refusal logged. Their installations will not receive you.`;
    case 'expired': return `${who}: instruction expired without compliance. Their installations will not receive you.`;
    case 'departed': return `${who}: you left the area. The instruction lapsed.`;
    case 'authority_changed': return `${who} no longer holds authority here. The instruction is void.`;
    case 'checkpoint_unavailable': return `${who}: checkpoint offline. The instruction is void.`;
    case 'policy_relaxed': return `${who}: restriction lifted. The instruction is withdrawn.`;
    case 'zone_reconfigured': return `${who}: checkpoint reconfigured. The instruction is withdrawn.`;
    case 'interrupted': return `${who}: instruction suspended by combat.`;
    case 'unable_to_comply': return `${who}: your vessel cannot manoeuvre. No fault recorded.`;
    case 'canceled': return `${who}: instruction cancelled.`;
    default: return `${who}: instruction ended (${order.outcome}).`;
  }
}
function pruneSecurityHistory(ledger) {
  const resolved = Object.values(ledger.orders).filter((order) => order?.outcome).sort((a, b) => finiteNumber(a.resolvedAtMs, 0) - finiteNumber(b.resolvedAtMs, 0));
  while (resolved.length > SECURITY_HISTORY_CAP) {
    const oldest = resolved.shift();
    delete ledger.orders[oldest.id];
  }
}
function closeSecurityOrdersForSystem(systemIndex, outcome, reason = '') {
  const ledger = getSecurityLedger(systemIndex);
  if (!ledger) return 0;
  let count = 0;
  for (const order of getSecurityActiveOrders(ledger)) {
    resolveSecurityOrder(ledger, order, outcome, reason, { silent: order.visitorKind !== 'player' });
    count += 1;
  }
  return count;
}
// A completed jump or wormhole transit is an actual departure for the player: the local demand
// closes and the visit ends. Unloading NPCs left behind is not their departure (see participants).
function closePlayerSecurityOrders(systemIndex, outcome = 'departed', reason = 'left the system') {
  const ledger = getSecurityLedger(systemIndex);
  if (!ledger) return;
  const order = getSecurityOrderForVisitor(ledger, 'player');
  if (order) resolveSecurityOrder(ledger, order, outcome, reason, { silent: true });
  const visitor = ledger.visitors.player;
  if (visitor) { visitor.inside = false; visitor.clearance = null; visitor.noncompliant = false; visitor.addressedEpisode = null; }
}
// Every actual holder change: old instructions and clearances end and can never reactivate.
function invalidateSecurityAuthority(systemIndex, reason = 'holder changed') {
  const i = Number(systemIndex);
  bumpSecurityAuthorityEpoch(i);
  closeSecurityOrdersForSystem(i, 'authority_changed', reason);
  const ledger = getSecurityLedger(i);
  if (ledger) {
    for (const visitor of Object.values(ledger.visitors)) { visitor.clearance = null; visitor.noncompliant = false; visitor.addressedEpisode = null; }
    ledger.participants = {};
  }
}

// NPC voluntary compliance. A dedicated objective, in its own field, that owns the ship's
// destination while it lasts. Role, side, fleet membership and faction are never touched.
function beginNpcSecurityObjective(npc, order) {
  npc.securityObjective = { orderId: order.id, phase: order.kind === 'withdraw' ? 'withdraw' : 'approach', holding: false };
  npc.combatManeuver = null;
}
function endNpcSecurityObjective(npc, outcome) {
  if (!npc) return;
  const objective = npc.securityObjective;
  npc.securityObjective = null;
  if (!objective || npc.destroyed) return;
  const now = performance.now();
  npc.waitUntil = 0;
  const zone = getSecurityZone(state.currentPlanet);
  const leavesArea = outcome === 'withdrawn' || outcome === 'refused' || outcome === 'expired' || outcome === 'departed';
  if (zone && leavesArea) {
    // Choose a lane outside the perimeter; the original destination inside a closed zone would be an
    // endless leave/re-enter loop. With no such lane, leave the system the ordinary way.
    const outside = (state.trafficDestinations || []).filter((dest) => distanceToSecurityCentre(zone, dest.point) > zone.reentryDistance);
    if (outside.length) {
      const pick = outside[Math.floor(seeded(npc.seed + npc.leg * 17 + 53) * outside.length) % outside.length];
      npc.destination = { ...pick.point };
      npc.destinationName = pick.name;
      npc.leg += 1;
      return;
    }
    if (isAmbientTrafficWarpEligible(npc, now)) { startAmbientTrafficDeparture(npc, now); return; }
  }
  const next = pickTrafficDestination(state.trafficDestinations, npc.seed + npc.leg * 17 + 31, npc.destinationName);
  npc.destination = { ...next.point };
  npc.destinationName = next.name;
  npc.leg += 1;
}
// Called from updateNpcShips before any combat or lane logic. Returns true when the ship is
// holding and must not move this tick; otherwise the generic movement flies it to the point set here.
function updateNpcSecurityObjective(npc, now = performance.now()) {
  const objective = npc.securityObjective;
  if (!objective) return false;
  const ledger = getSecurityLedger(state.currentPlanet);
  const order = ledger?.orders?.[objective.orderId];
  const zone = getSecurityZone(state.currentPlanet);
  if (!order || order.outcome || !zone) { npc.securityObjective = null; return false; }
  const withdrawing = order.kind === 'withdraw' || order.withdrawing;
  objective.phase = withdrawing ? 'withdraw' : 'approach';
  const target = resolveSecurityPoint(zone, withdrawing ? order.exit : order.hold);
  npc.destination = { ...target };
  npc.destinationName = withdrawing ? 'checkpoint exit' : 'checkpoint hold';
  npc.combatManeuver = null;
  if (!withdrawing && Math.hypot(target.x - npc.x, target.y - npc.y) <= SECURITY_HOLD_TOLERANCE) {
    objective.holding = true;
    npc.systemWarpIntensity = 0;
    npc.waitUntil = now + 250;
    return true;
  }
  objective.holding = false;
  return false;
}
function canNpcTakeSecurityOrders(npc, now = performance.now()) {
  if (!npc || npc.destroyed || isPlayerSideNpc(npc)) return false;
  if (npc.role !== 'traffic' && npc.role !== 'localTraffic') return false; // military and mission roles are not addressed this phase
  if (npc.hostile || npc.attackId || npc.trafficWarp || npc.fleetId) return false;
  if ((npc.playerAggroUntil && npc.playerAggroUntil > now) || (npc.playerEscortOrderUntil && npc.playerEscortOrderUntil > now)) return false;
  return true;
}
function isNpcSecurityPreempted(npc, now = performance.now()) {
  return Boolean(npc.hostile) || Boolean(npc.attackId) || Boolean(getNpcDefenseTarget(npc))
    || (Boolean(npc.playerAggroUntil) && npc.playerAggroUntil > now)
    || (Boolean(npc.playerEscortOrderUntil) && npc.playerEscortOrderUntil > now);
}

// The per-tick evaluation. Runs once per simulated local tick, after NPC movement and the player's
// own movement, with the same bounded frame delta. Nothing here writes hostility, standing,
// attackId or aggression evidence; a refusal is a record, not a target.
function updateSecurityEncounters(frameScale = 1) {
  if (!state.gameStarted || state.gameOver) return;
  const systemIndex = Number(state.currentPlanet);
  const zone = getSecurityZone(systemIndex);
  const existing = getSecurityLedger(systemIndex);
  if (!zone && !existing) return;
  const ledger = ensureSecurityLedger(systemIndex);
  const deltaMs = clamp(finiteNumber(frameScale, 1), 0, 2.5) * 16.6667;
  ledger.localElapsedMs += deltaMs;
  const now = performance.now();
  const activeOrders = getSecurityActiveOrders(ledger);

  if (!zone) {
    const control = getSystemControl(systemIndex);
    for (const order of activeOrders) {
      const authorityGone = order.authority === PLAYER_SIDE ? !control.playerControlled : control.controller !== order.authority;
      resolveSecurityOrder(ledger, order, authorityGone ? 'authority_changed' : 'checkpoint_unavailable', authorityGone ? 'holder changed' : 'no active checkpoint');
    }
    return;
  }

  // A visitor admitted while a class was open must be reconsidered if that class becomes
  // challenge or closed during the same visit. Without this reset, addressedEpisode would make
  // an open decision permanent until the vessel left the re-entry ring.
  if (ledger.accessSignature !== zone.accessSignature) {
    for (const [instanceId, visitor] of Object.entries(ledger.visitors)) {
      if (!visitor?.inside || getSecurityOrderForVisitor(ledger, instanceId)) continue;
      visitor.addressedEpisode = null;
    }
    ledger.accessSignature = zone.accessSignature;
  }

  // Pass 1: keep existing orders honest against authority, geometry and policy.
  for (const order of activeOrders) {
    if (order.authority !== zone.authority || order.epoch !== zone.epoch) { resolveSecurityOrder(ledger, order, 'authority_changed', 'holder changed'); continue; }
    if (order.geometryKey !== zone.geometryKey) { resolveSecurityOrder(ledger, order, 'zone_reconfigured', 'checkpoint reconfigured'); continue; }
    if (order.accessSignature !== zone.accessSignature) {
      const decisionNow = zone.access[order.accessClass] || 'open';
      const rankNow = SECURITY_ACCESS_ORDER[decisionNow];
      const rankThen = SECURITY_ACCESS_ORDER[order.decision];
      if (rankNow === 0) { resolveSecurityOrder(ledger, order, 'policy_relaxed', 'access opened'); continue; }
      const entity = findSecurityVisitorEntity(order);
      const position = entity ? securityEntityPosition(entity) : resolveSecurityPoint(zone, order.hold);
      const speed = entity ? securityEntitySpeed(entity) : 1;
      if (rankNow < rankThen) reviseSecurityOrder(order, zone, position, speed, 'challenge', 'access relaxed to challenge');
      else if (rankNow > rankThen) reviseSecurityOrder(order, zone, position, speed, 'withdraw', 'access closed');
      else order.accessSignature = zone.accessSignature; // an unrelated class changed
      if (rankNow !== rankThen) pushSecurityEvent(ledger, `${order.visitorName}: instruction revised (${order.kind}), revision ${order.revision}.`);
    }
  }

  // Pass 2: observe every visitor in the scene (NPCs and the player), track boundary state, issue
  // orders on inward crossings, and advance the orders that exist.
  const entities = [...(state.npcShips || []).filter((npc) => npc && !npc.destroyed && npc.trafficWarp?.phase !== 'away'), 'player'];
  const seen = new Set();
  let activeCount = getSecurityActiveOrders(ledger).length;
  for (const entity of entities) {
    if (!sensorCheckpointTrack(entity, zone)) continue;
    const contact = getSecurityContact(entity);
    if (!contact) continue;
    seen.add(contact.instanceId);
    const position = securityEntityPosition(entity);
    const distance = distanceToSecurityCentre(zone, position);
    const visitor = getSecurityVisitor(ledger, contact.instanceId, distance <= zone.radius);
    if (!visitor) continue;
    visitor.name = contact.name;
    let crossedIn = false;
    if (!visitor.inside && distance <= zone.radius) {
      visitor.inside = true;
      visitor.episode += 1;
      crossedIn = true;
    } else if (visitor.inside && distance > zone.reentryDistance) {
      visitor.inside = false;
      // The visit ends: a clearance was for this visit only, and a noncompliance record resolves
      // with the departure without becoming a second offence.
      visitor.clearance = null;
      visitor.noncompliant = false;
    }
    const order = getSecurityOrderForVisitor(ledger, contact.instanceId);
    const currentClass = getVisitorAccessDecision(zone, contact);
    if (visitor.sensorClass !== currentClass.class) {
      visitor.sensorClass = currentClass.class; visitor.addressedEpisode = null;
      if (visitor.clearance && visitor.clearance.accessClass !== currentClass.class) visitor.clearance = null;
      if (order && !order.outcome) {
        const remaining = order.remainingMs;
        order.accessClass = currentClass.class;
        if (currentClass.decision === 'open') resolveSecurityOrder(ledger, order, 'policy_relaxed', 'current declaration permitted');
        else if (currentClass.decision !== order.decision) { reviseSecurityOrder(order, zone, position, securityEntitySpeed(entity), currentClass.decision === 'closed' ? 'withdraw' : 'challenge', 'declaration changed'); order.remainingMs = Math.min(remaining, order.remainingMs); }
      }
    }
    if (visitor.clearance) {
      const clearance = visitor.clearance;
      const relevantChanged = clearance.epoch !== zone.epoch || (zone.access[clearance.accessClass] || 'open') !== accessDecisionFromSignature(clearance.accessSignature, clearance.accessClass);
      const aggression = contact.kind === 'npc'
        ? hasRecentAggressionAgainst(entity, zone.authority, now, systemIndex)
        : hasRecentPlayerAggressionAgainst(zone.authority, now, systemIndex);
      if (relevantChanged || aggression) {
        visitor.clearance = null;
        visitor.addressedEpisode = null;
        pushSecurityEvent(ledger, `${contact.name}: clearance revoked (${aggression ? 'attack on the authority' : 'policy changed'}).`);
      }
    }
    if (!order && visitor.inside && !visitor.clearance && !visitor.noncompliant && visitor.addressedEpisode !== visitor.episode) {
      const decision = getVisitorAccessDecision(zone, contact);
      if (!decision || !decision.enforceable || decision.decision === 'open') {
        visitor.addressedEpisode = visitor.episode; // open access: not inspected, no offence, nothing recorded
      } else if (contact.kind === 'npc' && !canNpcTakeSecurityOrders(entity, now)) {
        // not addressed: military and mission roles keep their missions; no order, no fault
      } else if (activeCount >= SECURITY_MAX_ACTIVE_ORDERS) {
        // at capacity: defer rather than drop and blame
      } else {
        const issued = issueSecurityOrder(ledger, zone, contact, decision, position, securityEntitySpeed(entity));
        activeCount += 1;
        if (contact.kind === 'npc') beginNpcSecurityObjective(entity, issued);
        else {
          setLog(`Incoming: ${describeSecurityInstruction(issued, zone)}`);
          playGameSound('hail', { cooldownKey: 'security:order' });
        }
      }
    }
    if (order) advanceSecurityOrder(ledger, zone, order, entity, contact, position, distance, deltaMs, now);
    if (crossedIn && !order && contact.kind === 'player' && visitor.noncompliant) setLog(`${zone.label}: your earlier refusal stands. Their installations will not receive you.`);
  }
  // Orders whose visitor is not in the scene at all.
  for (const order of getSecurityActiveOrders(ledger)) {
    if (seen.has(order.visitorInstanceId)) continue;
    const npc = (state.npcShips || []).find((entry) => entry && entry.securityInstanceId === order.visitorInstanceId);
    if (npc?.destroyed) resolveSecurityOrder(ledger, order, 'visitor_destroyed', 'vessel destroyed');
    else if (npc?.trafficWarp?.phase === 'away' || npc?.trafficWarp?.phase === 'departing') resolveSecurityOrder(ledger, order, 'departed', 'left the system');
    else resolveSecurityOrder(ledger, order, 'contact_lost', 'no contact');
  }
  // Vessels no longer in the scene with no active order are forgotten; the ledger stays bounded.
  for (const instanceId of Object.keys(ledger.visitors)) {
    if (instanceId === 'player' || seen.has(instanceId)) continue;
    if (!getSecurityOrderForVisitor(ledger, instanceId)) delete ledger.visitors[instanceId];
  }
}
function accessDecisionFromSignature(signature, accessClass) {
  try { return JSON.parse(signature || '{}')[accessClass] || 'open'; } catch { return 'open'; }
}
function findSecurityVisitorEntity(order) {
  if (order.visitorKind === 'player') return 'player';
  return (state.npcShips || []).find((npc) => npc && npc.securityInstanceId === order.visitorInstanceId) || null;
}
function securityEntityPosition(entity) {
  return entity === 'player' ? playerWorldPosition() : { x: entity.x, y: entity.y };
}
function securityEntitySpeed(entity) {
  if (entity === 'player') return Math.max(1, finiteNumber(state.ship?.baseMaxSpeed, finiteNumber(state.ship?.maxSpeed, 3.5)) * 0.6);
  return finiteNumber(entity?.speed, 1);
}
function isSecurityEntityHolding(entity, target) {
  const position = securityEntityPosition(entity);
  if (Math.hypot(target.x - position.x, target.y - position.y) > SECURITY_HOLD_TOLERANCE) return false;
  if (entity === 'player') return finiteNumber(state.ship?.velocity, 0) <= 0.25;
  return Boolean(entity.securityObjective?.holding) || (entity.waitUntil && entity.waitUntil > performance.now());
}
function advanceSecurityOrder(ledger, zone, order, entity, contact, position, distance, deltaMs, now) {
  if (order.outcome) return;
  if (contact.kind === 'npc') {
    if (entity.destroyed) { resolveSecurityOrder(ledger, order, 'visitor_destroyed', 'vessel destroyed'); return; }
    if (entity.trafficWarp?.phase === 'departing' || entity.trafficWarp?.phase === 'away') { resolveSecurityOrder(ledger, order, 'departed', 'left the system'); return; }
    if (isNpcSecurityPreempted(entity, now)) { resolveSecurityOrder(ledger, order, 'interrupted', 'combat'); return; }
    if (isNpcTractorHeld(entity, now) || isNpcEngineDisabled(entity, now)) { resolveSecurityOrder(ledger, order, 'unable_to_comply', isNpcTractorHeld(entity, now) ? 'tractor held' : 'engines disabled'); return; }
    if (!entity.securityObjective || entity.securityObjective.orderId !== order.id) beginNpcSecurityObjective(entity, order);
  }
  const withdrawing = order.kind === 'withdraw' || order.withdrawing;
  if (distance > zone.exitDistance) {
    resolveSecurityOrder(ledger, order, withdrawing ? 'withdrawn' : 'departed', withdrawing ? 'left the restricted area' : 'left the area without clearance');
    return;
  }
  if (order.state === 'check_incomplete' && contact.broadcast?.source === 'none') return;
  if (order.state === 'check_incomplete') order.state = 'pending'; // waits for the operator; the clock does not run against the visitor
  if (withdrawing) {
    order.remainingMs -= deltaMs;
    if (order.remainingMs <= 0) resolveSecurityOrder(ledger, order, 'expired', 'did not withdraw in time');
    return;
  }
  const holdPoint = resolveSecurityPoint(zone, order.hold);
  if (isSecurityEntityHolding(entity, holdPoint)) {
    order.state = 'holding';
    order.dwellMs += deltaMs;
    if (order.dwellMs >= SECURITY_DWELL_MS) {
      if (contact.broadcast?.source === 'none') { order.state = 'check_incomplete'; order.reason = 'broadcast unavailable; operator review'; return; }
      resolveSecurityOrder(ledger, order, 'cleared', `${contact.broadcast.faction === 'neutral' ? 'independent' : formatFaction(contact.broadcast.faction)} declaration received; checkpoint cleared`);
      return;
    }
  } else {
    if (order.state === 'holding') order.state = 'pending';
    order.dwellMs = 0;
  }
  order.remainingMs -= deltaMs;
  if (order.remainingMs <= 0) resolveSecurityOrder(ledger, order, 'expired', 'did not comply in time');
}

// Player as visitor: the five responses. Physical movement is still the player's own flying.
function respondToSecurityOrder(action) {
  const ledger = getSecurityLedger(state.currentPlanet);
  const order = getPlayerSecurityOrder(state.currentPlanet);
  const zone = getSecurityZone(state.currentPlanet);
  if (!ledger || !order || !zone) return false;
  switch (action) {
    case 'acknowledge':
      order.acknowledged = true;
      setLog(`${zone.label}: acknowledged. ${order.kind === 'withdraw' || order.withdrawing ? 'Exit marker set.' : 'Holding point marked.'}`);
      return true;
    case 'repeat':
      setLog(`${describeSecurityInstruction(order, zone)} ${Math.max(0, Math.ceil(order.remainingMs / 1000))} s remaining.`);
      return true;
    case 'request': {
      if (order.kind === 'withdraw' || order.withdrawing) { setLog(`${zone.label}: this area is closed to you. Withdraw beyond the marked exit.`); return true; }
      const holdPoint = resolveSecurityPoint(zone, order.hold);
      const p = playerWorldPosition();
      const away = Math.hypot(holdPoint.x - p.x, holdPoint.y - p.y);
      if (away > SECURITY_HOLD_TOLERANCE) { setLog(`${zone.label}: clearance refused. You are ${Math.round(away)} units from the holding point; stop within ${SECURITY_HOLD_TOLERANCE}.`); return true; }
      if (finiteNumber(state.ship?.velocity, 0) > 0.25) { setLog(`${zone.label}: clearance refused. Come to a full stop at the holding point.`); return true; }
      if (order.dwellMs < SECURITY_DWELL_MS) { setLog(`${zone.label}: hold position. ${Math.ceil((SECURITY_DWELL_MS - order.dwellMs) / 1000)} s of the identity check remain.`); return true; }
      resolveSecurityOrder(ledger, order, 'cleared', 'identity confirmed on request');
      return true;
    }
    case 'withdraw':
      order.withdrawing = true;
      order.acknowledged = true;
      setLog(`${zone.label}: withdrawal noted. Leave beyond the marked exit; the instruction closes when you are out.`);
      return true;
    case 'refuse':
      resolveSecurityOrder(ledger, order, 'refused', 'refused by the visitor');
      return true;
    default:
      return false;
  }
}
// Operator actions at the player's own checkpoint. Authority is checked here, not only in the UI.
function operateSecurityOrder(orderId, action) {
  const systemIndex = state.currentPlanet;
  if (!isSystemControlled(systemIndex)) return false;
  const ledger = getSecurityLedger(systemIndex);
  const zone = getSecurityZone(systemIndex);
  const order = ledger?.orders?.[orderId];
  if (!ledger || !zone || !order || order.outcome || order.authority !== PLAYER_SIDE) return false;
  const entity = findSecurityVisitorEntity(order);
  const position = entity ? securityEntityPosition(entity) : resolveSecurityPoint(zone, order.hold);
  switch (action) {
    case 'waive': resolveSecurityOrder(ledger, order, 'waived', 'waived by the operator'); return true;
    case 'withdraw': reviseSecurityOrder(order, zone, position, entity ? securityEntitySpeed(entity) : 1, 'withdraw', 'withdrawal requested by the operator'); pushSecurityEvent(ledger, `${order.visitorName}: withdrawal requested.`); return true;
    case 'cancel': resolveSecurityOrder(ledger, order, 'canceled', 'cancelled by the operator'); return true;
    default: return false;
  }
}

// Access consequence. A pending or noncompliant visitor is not received by the authority's own
// installations. Nothing else changes: concessions and private posts inside the zone still trade.
function getSecurityDockingBlock(ownerSide) {
  const zone = getSecurityZone(state.currentPlanet);
  if (!zone || zone.authority === PLAYER_SIDE || !ownerSide || ownerSide !== zone.authority) return null;
  const order = getPlayerSecurityOrder(state.currentPlanet);
  if (order) return order.kind === 'withdraw' || order.withdrawing
    ? `${zone.label}: this area is closed to you. Withdraw beyond the marked exit.`
    : `${zone.label}: hold at the marked point for clearance before docking.`;
  const visitor = getSecurityVisitor(getSecurityLedger(state.currentPlanet), 'player');
  if (visitor?.noncompliant) return `${zone.label}: you refused their instruction. Their installations will not receive you until you leave and return.`;
  return null;
}

// Persistence of participants: the bounded snapshot needed to resume an active NPC order after the
// scene is unloaded, the cache is wiped, or the game is reloaded. Captured for the live system only.
function captureSecurityParticipants(systemIndex = state.securityLiveSystemIndex) {
  if (systemIndex === null || systemIndex === undefined) return;
  const ledger = getSecurityLedger(systemIndex);
  if (!ledger) return;
  ledger.participants = {};
  for (const order of getSecurityActiveOrders(ledger)) {
    if (order.visitorKind !== 'npc') continue;
    const npc = (state.npcShips || []).find((entry) => entry && entry.securityInstanceId === order.visitorInstanceId && !entry.destroyed);
    if (!npc) continue;
    ledger.participants[order.visitorInstanceId] = {
      power: powerSnapshot(ensureNpcPower(npc)), crewSkill: npc.crewSkill, crewTemperament: npc.crewTemperament,
      instanceId: order.visitorInstanceId, npcId: npc.id, shipId: npc.shipId, seed: npc.seed, name: npc.name, faction: npc.faction, sideId: npc.sideId, role: npc.role,
      x: npc.x, y: npc.y, heading: npc.heading, speed: npc.speed, turnRate: npc.turnRate, systemWarpMultiplier: npc.systemWarpMultiplier, scale: npc.scale, leg: npc.leg,
      combatHull: npc.combatHull, maxCombatHull: npc.maxCombatHull, combatShields: npc.combatShields, maxCombatShields: npc.maxCombatShields,
      destination: npc.destination ? { ...npc.destination } : null, destinationName: npc.destinationName, objective: npc.securityObjective ? { ...npc.securityObjective } : null,
      ...snapshotActorSensors(npc),
      broadcastSource: npc.broadcastSource || null, broadcastFaction: npc.broadcastFaction || null,
    };
  }
}
// After generic scene restoration: put participants back on their spawn slots, or close their
// orders with a recovery reason. Never replaces a missing vessel with a different ship.
function reconcileSecurityParticipants(systemIndex) {
  const ledger = getSecurityLedger(systemIndex);
  const cached = state.systemStates?.[Number(systemIndex)];
  for (const npc of state.npcShips || []) {
    if (!npc || isPlayerSideNpc(npc)) continue;
    ensureNpcSecurityInstance(npc);
    const snapshot = cached?.npcShips?.find((entry) => entry.id === npc.id);
    if (snapshot && !snapshot.securityInstanceId) snapshot.securityInstanceId = npc.securityInstanceId;
  }
  if (!ledger) return;
  for (const order of getSecurityActiveOrders(ledger)) {
    if (order.visitorKind !== 'npc') continue;
    const already = (state.npcShips || []).find((npc) => npc && npc.securityInstanceId === order.visitorInstanceId && !npc.destroyed);
    if (already) { if (!already.securityObjective) beginNpcSecurityObjective(already, order); continue; }
    const snap = ledger.participants[order.visitorInstanceId];
    const npc = snap ? (state.npcShips || []).find((entry) => entry && entry.id === snap.npcId && !entry.destroyed && !isPlayerSideNpc(entry) && !getSecurityOrderForVisitor(ledger, entry.securityInstanceId)) : null;
    if (!snap || !npc) { resolveSecurityOrder(ledger, order, 'contact_lost', 'participant not restored', { silent: true }); continue; }
    Object.assign(npc, {
      power: snap.power ? cloneJson(snap.power) : null, crewSkill: snap.crewSkill, crewTemperament: snap.crewTemperament,
      securityInstanceId: snap.instanceId, identityLocked: true, shipId: snap.shipId, seed: snap.seed, name: snap.name, faction: snap.faction, sideId: snap.sideId, role: snap.role,
      x: snap.x, y: snap.y, heading: snap.heading, speed: snap.speed, turnRate: snap.turnRate, systemWarpMultiplier: snap.systemWarpMultiplier, scale: snap.scale, leg: snap.leg,
      combatHull: snap.combatHull, maxCombatHull: snap.maxCombatHull, combatShields: snap.combatShields, maxCombatShields: snap.maxCombatShields,
      destination: snap.destination ? { ...snap.destination } : npc.destination, destinationName: snap.destinationName || npc.destinationName,
      ew: sanitizeEW(snap.ew), sensors: snap.sensors ? ensureSensorEquipment(snap.sensors) : null, sensorReports: snap.sensorReports || [],
      broadcastSource: snap.broadcastSource || null, broadcastFaction: snap.broadcastFaction || null,
      attitude: getFactionAttitude(snap.faction), hostile: false, trafficWarp: null, waitUntil: 0, systemWarpIntensity: 0,
      ambientWarpAt: performance.now() + 20000,
    });
    npc.securityObjective = snap.objective ? { ...snap.objective } : null;
    if (!npc.securityObjective) beginNpcSecurityObjective(npc, order);
    syncAmbientTrafficVariant(npc);
  }
}
function sanitizeSecurityZonesRecord(raw) {
  const zones = { version: 1, nextVisitorInstance: 1, systems: {}, epochs: {} };
  if (!raw || typeof raw !== 'object') return zones;
  zones.nextVisitorInstance = Math.max(1, Math.round(finiteNumber(raw.nextVisitorInstance, 1)));
  for (const [key, value] of Object.entries(raw.systems || {})) {
    if (!Number.isFinite(Number(key)) || !value || typeof value !== 'object') continue;
    zones.systems[Number(key)] = { enabled: Boolean(value.enabled), anchorStationId: value.anchorStationId ? String(value.anchorStationId) : null };
  }
  for (const [key, value] of Object.entries(raw.epochs || {})) {
    if (Number.isFinite(Number(key)) && Number.isFinite(Number(value))) zones.epochs[Number(key)] = Math.max(0, Math.round(Number(value)));
  }
  return zones;
}
const SECURITY_OUTCOMES = new Set(['cleared', 'waived', 'withdrawn', 'refused', 'expired', 'departed', 'authority_changed', 'checkpoint_unavailable', 'visitor_destroyed', 'unable_to_comply', 'interrupted', 'contact_lost', 'canceled', 'policy_relaxed', 'zone_reconfigured']);
function sanitizeSecurityEncountersRecord(raw) {
  const out = { version: 1, systems: {} };
  if (!raw || typeof raw !== 'object') return out;
  const polar = (value) => (value && Number.isFinite(Number(value.angle)) && Number.isFinite(Number(value.distance)) ? { angle: Number(value.angle), distance: Number(value.distance) } : null);
  for (const [key, ledgerRaw] of Object.entries(raw.systems || {})) {
    if (!Number.isFinite(Number(key)) || !ledgerRaw || typeof ledgerRaw !== 'object') continue;
    const ledger = { localElapsedMs: Math.max(0, finiteNumber(ledgerRaw.localElapsedMs, 0)), nextOrder: Math.max(1, Math.round(finiteNumber(ledgerRaw.nextOrder, 1))), accessSignature: String(ledgerRaw.accessSignature || ''), visitors: {}, orders: {}, participants: {}, recentEvents: [] };
    for (const [id, visitor] of Object.entries(ledgerRaw.visitors || {})) {
      if (!visitor || typeof visitor !== 'object' || !/^(player|v\d+)$/.test(id)) continue;
      ledger.visitors[id] = {
        inside: Boolean(visitor.inside), episode: Math.max(0, Math.round(finiteNumber(visitor.episode, 0))),
        addressedEpisode: Number.isFinite(Number(visitor.addressedEpisode)) && visitor.addressedEpisode !== null ? Number(visitor.addressedEpisode) : null,
        clearance: visitor.clearance && typeof visitor.clearance === 'object' && SECURITY_ACCESS_CLASSES.includes(visitor.clearance.accessClass)
          ? { orderId: String(visitor.clearance.orderId || ''), epoch: Math.round(finiteNumber(visitor.clearance.epoch, 0)), accessClass: visitor.clearance.accessClass, accessSignature: String(visitor.clearance.accessSignature || ''), provenance: visitor.clearance.provenance === 'waiver' ? 'waiver' : 'check' }
          : null,
        noncompliant: Boolean(visitor.noncompliant), lastOutcome: SECURITY_OUTCOMES.has(visitor.lastOutcome) ? visitor.lastOutcome : null, name: String(visitor.name || ''),
      };
    }
    for (const [id, order] of Object.entries(ledgerRaw.orders || {})) {
      if (!order || typeof order !== 'object' || !/^o\d+$/.test(id)) continue;
      const hold = polar(order.hold);
      const exit = polar(order.exit);
      if (!hold || !exit || !SECURITY_ACCESS_CLASSES.includes(order.accessClass) || (order.visitorKind !== 'npc' && order.visitorKind !== 'player')) continue;
      if (!/^(player|v\d+)$/.test(String(order.visitorInstanceId || ''))) continue;
      ledger.orders[id] = {
        id, zoneId: String(order.zoneId || ''), geometryKey: String(order.geometryKey || ''), systemIndex: Number(key), authority: String(order.authority || ''), authorityLabel: String(order.authorityLabel || ''),
        epoch: Math.round(finiteNumber(order.epoch, 0)), visitorInstanceId: String(order.visitorInstanceId), visitorKind: order.visitorKind, visitorName: String(order.visitorName || ''),
        npcId: order.npcId ?? null, episode: Math.round(finiteNumber(order.episode, 0)), accessClass: order.accessClass, decision: SECURITY_ACCESS_VALUES.includes(order.decision) ? order.decision : 'challenge',
        accessSignature: String(order.accessSignature || ''), kind: order.kind === 'withdraw' ? 'withdraw' : 'challenge', revision: Math.max(1, Math.round(finiteNumber(order.revision, 1))),
        state: ['pending', 'holding', 'check_incomplete'].includes(order.state) ? order.state : 'pending', outcome: SECURITY_OUTCOMES.has(order.outcome) ? order.outcome : null, reason: String(order.reason || ''),
        hold, exit, withdrawing: Boolean(order.withdrawing), allowanceMs: Math.max(1000, finiteNumber(order.allowanceMs, SECURITY_MIN_ALLOWANCE_MS)),
        remainingMs: clamp(finiteNumber(order.remainingMs, 0), 0, 3600000), dwellMs: clamp(finiteNumber(order.dwellMs, 0), 0, SECURITY_DWELL_MS),
        issuedAtMs: Math.round(finiteNumber(order.issuedAtMs, 0)), resolvedAtMs: Number.isFinite(Number(order.resolvedAtMs)) && order.resolvedAtMs !== null ? Number(order.resolvedAtMs) : null,
        acknowledged: Boolean(order.acknowledged), compliance: order.compliance && typeof order.compliance === 'object' ? { scope: order.compliance.scope === 'withdrawal' ? 'withdrawal' : 'movement_identity' } : null,
        noncompliant: Boolean(order.noncompliant),
      };
    }
    for (const [id, snap] of Object.entries(ledgerRaw.participants || {})) {
      if (!snap || typeof snap !== 'object' || !/^v\d+$/.test(id) || !Number.isFinite(Number(snap.x)) || !Number.isFinite(Number(snap.y))) continue;
      const num = (value, fallback) => (Number.isFinite(Number(value)) ? Number(value) : fallback);
      const pool = (value) => (value === null || value === undefined ? null : num(value, null));
      ledger.participants[id] = {
        power: snap.power ? powerSnapshot(ensurePowerState(cloneJson(snap.power), shipPowerProfile(getShipStats(num(snap.shipId, 1))))) : null,
        ...assignPowerCrew({ seed: snap.seed, faction: snap.faction, role: snap.role, crewSkill: snap.crewSkill, crewTemperament: snap.crewTemperament }),
        instanceId: id, npcId: snap.npcId, shipId: num(snap.shipId, 1), seed: num(snap.seed, 1), name: String(snap.name || ''), faction: normalizeFactionKey(snap.faction || 'neutral'),
        sideId: typeof snap.sideId === 'string' ? snap.sideId : null, role: snap.role === 'localTraffic' ? 'localTraffic' : 'traffic',
        x: Number(snap.x), y: Number(snap.y), heading: num(snap.heading, 0), speed: clamp(num(snap.speed, 1), 0.3, 3), turnRate: clamp(num(snap.turnRate, 0.5), 0.1, 3), systemWarpMultiplier: clamp(num(snap.systemWarpMultiplier, 1.5), 1, 4), scale: clamp(num(snap.scale, 1), 0.2, 4), leg: num(snap.leg, 0),
        combatHull: pool(snap.combatHull), maxCombatHull: pool(snap.maxCombatHull), combatShields: pool(snap.combatShields), maxCombatShields: pool(snap.maxCombatShields),
        destination: snap.destination && Number.isFinite(Number(snap.destination.x)) && Number.isFinite(Number(snap.destination.y)) ? { x: Number(snap.destination.x), y: Number(snap.destination.y) } : null,
        destinationName: String(snap.destinationName || ''),
        objective: snap.objective && typeof snap.objective === 'object' ? { orderId: String(snap.objective.orderId || ''), phase: snap.objective.phase === 'withdraw' ? 'withdraw' : 'approach', holding: false } : null,
        ew: sanitizeEW(snap.ew), sensors: snap.sensors ? ensureSensorEquipment(snap.sensors) : null, sensorReports: Array.isArray(snap.sensorReports) ? snap.sensorReports : [],
        broadcastSource: ['declared', 'none'].includes(snap.broadcastSource) ? snap.broadcastSource : null,
        broadcastFaction: typeof snap.broadcastFaction === 'string' ? snap.broadcastFaction.slice(0, 80) : null,
      };
    }
    ledger.recentEvents = (Array.isArray(ledgerRaw.recentEvents) ? ledgerRaw.recentEvents : []).filter((event) => event && typeof event === 'object').slice(-SECURITY_HISTORY_CAP).map((event) => ({ atMs: Math.round(finiteNumber(event.atMs, 0)), text: String(event.text || '') }));
    out.systems[Number(key)] = ledger;
  }
  return out;
}
function resetSecurityRecords() {
  state.securityZones = { version: 1, nextVisitorInstance: 1, systems: {}, epochs: {} };
  state.securityEncounters = { version: 1, systems: {} };
  state.securityLiveSystemIndex = null;
  state.securityOutcomeNotice = null;
}
// An arriving player is placed at the zone's outer approach point when a foreign checkpoint is
// active, so the perimeter is seen before it is crossed. The player's own checkpoint never
// relocates the player. Called after setCameraNearPlanet.
function placePlayerAtSecurityApproach() {
  const zone = getSecurityZone(state.currentPlanet);
  if (!zone || !zone.foreign) return false;
  const star = state.systemStar || zone.centre;
  const angle = Math.atan2(star.y - zone.centre.y, star.x - zone.centre.x);
  const distance = zone.radius + SECURITY_ARRIVAL_MARGIN;
  setCamera(zone.centre.x + Math.cos(angle) * distance, zone.centre.y + Math.sin(angle) * distance);
  return true;
}

// The side that defends a system: the player when the player holds it, else the holding polity.
function getDefendingSideId(systemIndex = state.currentPlanet) {
  const control = getSystemControl(systemIndex);
  return control.playerControlled ? PLAYER_SIDE : control.polityId;
}
// Conquest transfers installations owned by one side to another; everything else keeps its owner.
function transferSystemInstallations(systemIndex, fromOwnerId, toOwnerId) {
  if (!fromOwnerId || !toOwnerId) return [];
  if (!state.stationOwners || typeof state.stationOwners !== 'object') state.stationOwners = {};
  const transferred = [];
  for (const station of state.stationDefinitions || []) {
    if (Number(station.systemIndex) !== Number(systemIndex)) continue;
    if (getStationOwner(station, systemIndex) !== fromOwnerId) continue;
    state.stationOwners[station.id] = toOwnerId;
    transferred.push(station.id);
  }
  return transferred;
}
function transferSystemControlToPlayer(systemIndex = state.currentPlanet) {
  const i = Number(systemIndex);
  const before = getSystemControl(i);
  const fromOwner = before.playerControlled ? null : before.polityId;
  if (!state.controlledSystems.some((entry) => Number(entry) === i)) state.controlledSystems.push(i);
  if (state.factionSystemOverrides) delete state.factionSystemOverrides[i];
  const transferred = fromOwner ? transferSystemInstallations(i, fromOwner, PLAYER_SIDE) : [];
  refreshCachedStationOwnership(i);
  if (i === Number(state.currentPlanet)) refreshStationOwnership(i);
  if (!before.playerControlled) invalidateSecurityAuthority(i, 'taken by the player'); // an actual holder change
  return transferred;
}
function transferSystemControlToFaction(systemIndex, faction) {
  const i = Number(systemIndex);
  const key = canonicalPolityId(faction);
  if (!key) return [];
  const before = getSystemControl(i);
  const fromOwner = before.playerControlled ? PLAYER_SIDE : before.polityId;
  state.controlledSystems = (state.controlledSystems || []).filter((entry) => Number(entry) !== i);
  if (!state.factionSystemOverrides || typeof state.factionSystemOverrides !== 'object') state.factionSystemOverrides = {};
  state.factionSystemOverrides[i] = key;
  const toOwner = getSystemControl(i).polityId;
  const transferred = (fromOwner && toOwner && fromOwner !== toOwner) ? transferSystemInstallations(i, fromOwner, toOwner) : [];
  refreshCachedStationOwnership(i);
  if (i === Number(state.currentPlanet)) refreshStationOwnership(i);
  if (fromOwner !== toOwner) invalidateSecurityAuthority(i, `taken by ${formatFaction(key)}`); // an actual holder change
  return transferred;
}
// Saves written before station ownership was recorded: installations of held systems were treated
// as the holder's. Record that once so old saves keep the same answers.
function migrateStationOwners() {
  const owners = {};
  const overrides = state.factionSystemOverrides || {};
  for (const station of state.stationDefinitions || []) {
    const i = Number(station.systemIndex);
    if (station.builtByPlayer || getStationDataOwner(station)) continue;
    if ((state.controlledSystems || []).some((entry) => Number(entry) === i)) owners[station.id] = PLAYER_SIDE;
    else if (isRecognizedFactionKey(String(overrides[i] || '').toLowerCase())) owners[station.id] = String(overrides[i]).toLowerCase();
  }
  return owners;
}

function getSystemFaction(index = state.currentPlanet) {
  return getSystemControl(index).allegiance || 'neutral';
}

function getSystemAttitude(index = state.currentPlanet) {
  const control = getSystemControl(index);
  if (control.playerControlled) return 'friendly';
  return getFactionAttitude(control.allegiance || 'neutral');
}

const factionDefs = {
  neutral: {
    label: 'Independent Captain',
    desc: 'Unaffiliated captain making a living between the Empire and the Klingon advance.',
    loreTitle: 'Independent Captain',
    profile: 'Independent captains are unaffiliated survivors, traders and scavengers living between the borders during the Imperial War.',
    lore: `The independent worlds are the residue left between empires. With the Earth Empire reeling and the Klingons advancing, dozens of small settlements survive by staying useful, quiet, or too poor to conquer.

As an independent captain launching from New Switzerland, you begin with no flag and no guaranteed allies. Your advantage is freedom: trade with almost anyone and decide for yourself whether to stay neutral or take a side in the Imperial War.`,
    faction: 'neutral',
    playership: 7,
    myplanet: 6,
    myantimatter: 6,
    mylatinum: 1400,
    mytech1: 50,
  },
  ferengi: {
    label: 'Ferengi Merchant',
    desc: 'Profit-focused trader; the Ferengi will sell anything to anyone.',
    loreTitle: 'Ferengi Merchant',
    profile: 'Ferengi: tricky, devious and obsessed with profit. Cowardly alone but predatory in groups.',
    lore: `Primary planet Ferenginar. The Ferengi are tricky, devious and obsessed with profit. Cowardly alone but predatory in groups, they will do anything for personal gain.

They stayed out of the Imperial War and will trade with any side. Interaction: will sell to anyone, anything.`,
    faction: 'ferengi',
    playership: 18,
    myplanet: 14,
    myantimatter: 2,
    mylatinum: 2800,
    mytech1: 52,
  },
  vulcan: {
    label: 'Vulcan Explorer',
    desc: 'Emissary of Vulcan logic, exiled from the Empire and disarmed.',
    loreTitle: 'Vulcan Explorer',
    profile: 'Vulcans: former co-founders of the Empire, now disarmed isolationists devoted to peace, diplomacy and education.',
    lore: `The Vulcans have long been the close allies of the humans. In 2125 they helped found the Earth Empire. But a new faction emerged that emphasized peace and passivity, and a new age was declared.

The humans, who still wanted power above all else, exiled the Vulcans from Imperial territory. The Vulcans chose to disarm completely and isolate themselves on their homeworld, devoted to diplomacy and education. They do not equip ships or stations with weapons. Interaction: will sell to anyone, but no weapons or anything of that nature.`,
    faction: 'vulcan',
    playership: 25,
    myplanet: 12,
    myantimatter: 10,
    mylatinum: 1500,
    mytech1: 50,
  },
  romulan: {
    label: 'Romulan Soldier',
    desc: 'Operative of the isolationist Romulan Star Empire, watching from afar.',
    loreTitle: 'Romulan Soldier',
    profile: 'Romulans: notoriously xenophobic isolationists since 2241, considered inconsequential, though rumors persist of massive ships.',
    lore: `The Romulans have been notoriously xenophobic since the dawn of time. They severed all ties with the Earth Empire in 2241 and kept out of the war. Generally left alone by the humans, they have no interest in how the war ends and very little in the way of ships or power.

Rumors persist of Ferengi traders who have seen massive, powerful ships in Romulan space, but no one pays serious attention to rumors. Interaction: will sell to the player only if the player destroys the Borg in the Vex system.`,
    faction: 'romulan',
    playership: 29,
    myplanet: 31,
    myantimatter: 2,
    mylatinum: 1800,
    mytech1: 51,
  },
  cardassian: {
    label: 'Cardassian Minion',
    desc: 'Agent of the Cardassian Order, a sleeping giant waiting its moment.',
    loreTitle: 'Cardassian Minion',
    profile: 'Cardassians: clever, wealthy and politically influential, staying out of the war like a sleeping giant.',
    lore: `Cardassians are a clever species who maintained a small government outside the Empire's direct control. Wealthy and politically influential, they have nothing to fear from anyone and have been preparing for years to defend themselves.

Since they bowed out of the arms race with the Klingons against the humans and stayed out of the war completely, they wait like a sleeping giant to see if the opportunity for power presents itself. Interaction: will sell to the player only if the player destroys the Bajoran system.`,
    faction: 'cardassian',
    playership: 16,
    myplanet: 50,
    myantimatter: 10,
    mylatinum: 2100,
    mytech1: 48,
  },
  terran: {
    label: 'Terran Rebel',
    desc: 'Officer of the Earth Empire, now losing the Imperial War against the Klingons.',
    loreTitle: 'Human Refugee',
    profile: 'Humans: tyrannical founders of the Earth Empire, now desperate to survive after eight years of war and half their territory lost.',
    lore: `The humans have long been a tyrannical force in the galaxy. Their unyielding thirst for planetary domination led them to conquer half the quadrant and enslave the population. New reforms and a government overthrow in 2252 weakened the Empire considerably, and their strongest member, the Vulcans, were cast out in 2307.

In 2357 the Klingons launched the first attack. With 8 years of war now behind them and half their territory lost to the Klingon Empire, the humans are utterly desperate to survive. No longer is it a matter of sustaining their imperial reign, it is now a struggle to escape total enslavement. Interaction: will sell anything so long as they are not a declared enemy, except capital ships and stations.`,
    faction: 'terran',
    playership: 3,
    myplanet: 1,
    myantimatter: 5,
    mylatinum: 900,
    mytech1: 51,
  },
  klingon: {
    label: 'Klingon Warrior',
    desc: 'Warrior of the Klingon Empire, on the offensive after centuries of enslavement.',
    loreTitle: 'Klingon Warrior',
    profile: 'Klingons: former slaves of the Earth Empire, now furious conquerors determined to eliminate every last human.',
    lore: `For centuries the Klingons were slaves to the Earth Empire, a warrior class used as a soldier force for Earth's military. In 2252, upon the overthrow of the Earth government, the Klingons seized the opportunity to secretly build an armed force for a massive rebellion.

In 2357 they launched the first attack. Most of the systems surrounding Earth were overtaken within a few years. The Klingons are dangerous, furious from their oppression and determined to eliminate every last human from the galaxy. Interaction: will sell anything so long as they have been declared an enemy of the humans.`,
    faction: 'klingon',
    playership: 39,
    myplanet: 38,
    myantimatter: 6,
    mylatinum: 1200,
    mytech1: 49,
  },
  dominion: {
    label: 'Dominion Remnant',
    desc: "Vorta commander of an isolated Jem'Hadar remnant, starting in Blender.",
    loreTitle: 'Dominion Vorta',
    profile: "Vorta: Commanders and administrators of the Dominion, relying on the discipline and strength of their Jem'Hadar crews.",
    lore: `Earth's campaigns shattered the Dominion's foothold in this region. In Blender, surviving Vorta and Jem'Hadar hold an isolated outpost while the war between Earth and the Klingons consumes the surrounding powers.

You begin in Blender commanding a small Jem'Hadar patrol with limited resources and little outside support. Find supplies, choose your allies carefully, and decide what future to pursue for the remnant.

The fate of the wider Dominion is uncertain. Rumors of distant strength offer hope, but here in Blender, survival comes first.`,
    faction: 'dominion',
    playership: 30,
    myplanet: 29,
    myantimatter: 8,
    mylatinum: 1600,
    mytech1: 48,
  },
  tholian: {
    label: 'Tholian Web Captain',
    desc: 'Holder of the Tholian Syndicate web; designers of the Isaac trader.',
    loreTitle: 'Tholian Web Captain',
    profile: 'Tholians: designers of the popular Isaac Class trade ship.',
    lore: `Tholians: designers of the popular Isaac Class trade ship. Little is known of their wider designs, but their traders are a common sight on the spacelanes.`,
    faction: 'tholian',
    playership: 20,
    myplanet: 18,
    myantimatter: 7,
    mylatinum: 1750,
    mytech1: 54,
  },
};

function loadGameOptions() {
  try {
    const stored = JSON.parse(localStorage.getItem(GAME_OPTIONS_KEY) || '{}');
    return {
      ...DEFAULT_GAME_OPTIONS,
      muted: Boolean(stored.muted),
      performanceMode: Boolean(stored.performanceMode),
      reducedEffects: Boolean(stored.reducedEffects),
    };
  } catch {
    return { ...DEFAULT_GAME_OPTIONS };
  }
}

function saveGameOptions() {
  localStorage.setItem(GAME_OPTIONS_KEY, JSON.stringify(state.gameOptions || DEFAULT_GAME_OPTIONS));
}

function applyGameOptions() {
  const options = state.gameOptions || DEFAULT_GAME_OPTIONS;
  document.body?.classList.toggle('game-muted', Boolean(options.muted));
  document.body?.classList.toggle('performance-mode', Boolean(options.performanceMode));
  document.body?.classList.toggle('reduced-effects', Boolean(options.reducedEffects || options.performanceMode));
  document.querySelectorAll('audio, video').forEach((media) => {
    media.muted = Boolean(options.muted);
  });
  refreshAudioForOptions();
}

function setGameOption(key, value) {
  state.gameOptions = { ...(state.gameOptions || DEFAULT_GAME_OPTIONS), [key]: Boolean(value) };
  saveGameOptions();
  applyGameOptions();
}

function isPerformanceMode() {
  return Boolean(state.gameOptions?.performanceMode);
}

function isReducedEffectsMode() {
  return Boolean(state.gameOptions?.reducedEffects || state.gameOptions?.performanceMode);
}

function sanitizePlayerName(value = '', fallback = 'Captain') {
  const text = String(value || '').replace(/\s+/g, ' ').trim();
  return (text || fallback).slice(0, 32);
}

function sanitizeShipName(value = '', fallback = 'Ship') {
  const text = String(value || '').replace(/\s+/g, ' ').trim();
  return (text || fallback).slice(0, 36);
}

function sanitizeStationName(value = '', fallback = 'Station') {
  const text = String(value || '').replace(/\s+/g, ' ').trim();
  return (text || fallback).slice(0, 42);
}

function getSaveSlotKey(slot = state.currentSaveSlot || 1) {
  return `${SAVE_SLOT_PREFIX}${clamp(Math.round(Number(slot) || 1), 1, SAVE_SLOT_COUNT)}`;
}

function getSaveSlotRaw(slot = state.currentSaveSlot || 1) {
  const key = getSaveSlotKey(slot);
  const raw = localStorage.getItem(key);
  if (raw) return raw;
  return Number(slot) === 1 ? localStorage.getItem(LEGACY_SAVE_KEY) : null;
}

function getSaveSlotData(slot = state.currentSaveSlot || 1) {
  const raw = getSaveSlotRaw(slot);
  if (!raw) return null;
  try {
    const data = JSON.parse(raw);
    return data && typeof data === 'object' ? data : null;
  } catch {
    return null;
  }
}

function getSaveSlotSummary(slot = state.currentSaveSlot || 1) {
  const data = getSaveSlotData(slot);
  if (!data) return null;
  const planetIndex = Math.max(0, Number(data.currentPlanet ?? (data.myplanet ? data.myplanet - 1 : 0)) || 0);
  const planetName = state.planets[planetIndex]?.name || `System ${planetIndex + 1}`;
  const shipClassName = getShipStats(data.playership || 18).name || `Ship ${data.playership || 18}`;
  const shipName = data.shipName || shipClassName;
  return {
    slot,
    faction: data.playerFaction || getShipFaction(data.playership || 18),
    captainName: data.captainName || 'Captain',
    shipName,
    shipClassName,
    planetName,
    latinum: data.latinum ?? data.mylatinum ?? 0,
    duranium: data.duranium ?? data.myduranium ?? 0,
    savedAt: data.savedAt ? new Date(data.savedAt) : null,
  };
}

function getFirstEmptySaveSlot() {
  for (let slot = 1; slot <= SAVE_SLOT_COUNT; slot++) {
    if (!getSaveSlotRaw(slot)) return slot;
  }
  return state.currentSaveSlot || 1;
}

function formatSaveTime(date) {
  if (!(date instanceof Date) || Number.isNaN(date.getTime())) return 'previous save';
  return date.toLocaleString(undefined, {
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

function renderStartSaveSlots() {
  return Array.from({ length: SAVE_SLOT_COUNT }, (_, index) => {
    const slot = index + 1;
    const summary = getSaveSlotSummary(slot);
    if (!summary) {
      return `<button class="save-slot empty" data-start-load-slot="${slot}" disabled>
        <span>Slot ${slot}</span>
        <small>Empty</small>
      </button>`;
    }
    return `<button class="save-slot" data-start-load-slot="${slot}">
      <span>Slot ${slot}: ${escapeHtml(summary.captainName)} | ${escapeHtml(summary.shipName)}</span>
      <small>${escapeHtml(formatFaction(summary.faction))} | ${escapeHtml(summary.shipClassName)} | ${escapeHtml(summary.planetName)} | ${summary.latinum}L ${summary.duranium}D | ${escapeHtml(formatSaveTime(summary.savedAt))}</small>
    </button>`;
  }).join('');
}

function renderStartFactionGrid() {
  const selectedKey = getStartSetupFaction();
  return Object.entries(factionDefs).map(([key, faction]) => (
    `<button class="faction ${key === selectedKey ? 'selected' : ''}" data-faction="${escapeHtml(key)}" aria-pressed="${key === selectedKey ? 'true' : 'false'}">
      <img src="${escapeHtml(factionEmblemAssets[faction.faction || key] || factionEmblemAssets.neutral)}?v=${FACTION_EMBLEM_ASSET_VERSION}" alt="">
      <span>${escapeHtml(faction.label)}</span>
    </button>`
  )).join('');
}

function getStartSetupFaction() {
  return factionDefs[state.startSetupFaction] ? state.startSetupFaction : 'neutral';
}

function renderFactionLorePanel(faction, extraClass = '') {
  const title = faction?.loreTitle || faction?.label || 'Faction';
  const summary = faction?.desc || '';
  const profile = faction?.profile || '';
  const lore = String(faction?.lore || faction?.desc || '').trim();
  const paragraphs = lore
    .split(/\n\s*\n/)
    .map((paragraph) => paragraph.replace(/\s+/g, ' ').trim())
    .filter(Boolean)
    .map((paragraph) => `<p>${escapeHtml(paragraph)}</p>`)
    .join('');
  return `<div class="faction-lore-panel ${extraClass}">
    <div class="faction-lore-head">
      <strong>${escapeHtml(title)}</strong>
      <span>Faction Profile</span>
    </div>
    <p class="faction-lore-summary">${escapeHtml(summary)}</p>
    ${profile ? `<p class="faction-lore-profile">${escapeHtml(profile)}</p>` : ''}
    <div class="faction-lore-body">${paragraphs}</div>
  </div>`;
}

function renderStartSetupForm() {
  const key = getStartSetupFaction();
  const faction = factionDefs[key];
  const defaultShipName = getShipStats(faction.playership).name || 'Ship';
  return `<div class="card start-card start-setup-card">
    <h2>${escapeHtml(faction.label)}</h2>
    ${renderFactionLorePanel(faction, 'setup-lore')}
    <div class="start-setup-summary">
      <img src="${escapeHtml(factionEmblemAssets[faction.faction || key] || factionEmblemAssets.neutral)}?v=${FACTION_EMBLEM_ASSET_VERSION}" alt="">
      <div>
        <strong>${escapeHtml(formatFaction(faction.faction || key))}</strong>
        <span>${escapeHtml(defaultShipName)} | ${faction.mylatinum}L | AM ${faction.myantimatter}</span>
      </div>
    </div>
    <div class="start-field-grid">
      <label>
        <span>Captain Name</span>
        <input id="start-captain-name" type="text" maxlength="32" autocomplete="off" value="${escapeHtml(state.captainName || '')}" placeholder="Captain name">
      </label>
      <label>
        <span>Ship Name</span>
        <input id="start-ship-name" type="text" maxlength="36" autocomplete="off" value="${escapeHtml(state.shipName || '')}" placeholder="${escapeHtml(defaultShipName)}">
      </label>
    </div>
    <div class="start-actions">
      <button data-start-view="factions">Back</button>
      <button data-start-game="${escapeHtml(key)}">Start Game</button>
    </div>
  </div>`;
}

const GAME_OPTION_DEFS = Object.freeze([
  ['muted', 'Mute Game Sounds', 'Silences game audio when sound hooks are active.'],
  ['performanceMode', 'High Performance', 'Reduces decorative rendering and expensive visual passes.'],
  ['reducedEffects', 'Reduced Effects', 'Softens explosions, nebula overlays, and transient visual effects.'],
]);

function renderGameOptionToggle(key, label, description, dataAttr = 'data-game-option') {
  const enabled = Boolean(state.gameOptions?.[key]);
  return `<button class="start-toggle game-option-toggle ${enabled ? 'active' : ''}" ${dataAttr}="${escapeHtml(key)}" aria-pressed="${enabled ? 'true' : 'false'}">
    <span>${escapeHtml(label)}</span>
    <strong>${enabled ? 'On' : 'Off'}</strong>
    <small>${escapeHtml(description)}</small>
  </button>`;
}

function renderGameOptionsList(dataAttr = 'data-game-option') {
  return GAME_OPTION_DEFS
    .map(([key, label, description]) => renderGameOptionToggle(key, label, description, dataAttr))
    .join('');
}

function renderStartOptionsView() {
  return `<div class="card start-card start-info-card">
    <h2>Options</h2>
    <div class="start-option-list">
      ${renderGameOptionsList('data-start-option')}
    </div>
    <div class="start-panel-grid">
      <button data-start-action="cache-offline">Cache Offline Assets</button>
      <button data-start-action="replay-intro">Replay Intro</button>
      <button data-start-action="reset-faction-choice">Reset Faction Choice</button>
    </div>
    <p id="start-action-status" class="start-status-line">Ready.</p>
    <div class="start-actions"><button data-start-view="main">Back</button></div>
  </div>`;
}

function renderStartInstructionsView() {
  return `<div class="card start-card start-info-card">
    <h2>Instructions</h2>
    <div class="start-copy-panel">
      <p>Fly with WASD or arrow keys. Keep holding forward to build into in-system warp. Use M or the Interstellar Map button to open the galactic map.</p>
      <p>Click planets, stations, ships, asteroids, and wormholes to interact. Planet and station services open when you are close enough.</p>
      <p>Weapons fire from slots 1, 2, and 3. Tab cycles targets, and clicking away clears a target.</p>
      <p>Press H to hail the selected ship. Open the Power tab to distribute energy between reserve, engines, weapons, and shields.</p>
      <p>Shift+1..8 issue fleet orders (follow, attack, seek, planet, launch/recall aux, explore, trade). Q closes windows, C opens cargo, P toggles this panel, +/- selects or clears the closest contact, tilde toggles auto-target, Left Ctrl cycles every contact in the system.</p>
      <p>Antimatter controls warp range. Larger ships can plot longer routes, while fleets and stations determine who controls a system.</p>
    </div>
    <div class="start-actions"><button data-start-view="main">Back</button></div>
  </div>`;
}

function getEditorDatasetKey() {
  return EDITOR_DATASETS[editorRuntime.dataset] ? editorRuntime.dataset : 'ships';
}

function getEditorDataset() {
  return EDITOR_DATASETS[getEditorDatasetKey()];
}

function getValueAtPath(source, path = '') {
  return String(path).split('.').filter(Boolean).reduce((value, part) => value?.[part], source);
}

function setValueAtPath(source, path = '', value) {
  const parts = String(path).split('.').filter(Boolean);
  if (!parts.length) return;
  let cursor = source;
  for (let i = 0; i < parts.length - 1; i += 1) {
    const part = parts[i];
    if (!cursor[part] || typeof cursor[part] !== 'object') cursor[part] = {};
    cursor = cursor[part];
  }
  cursor[parts[parts.length - 1]] = value;
}

function getEditorCollection(dataset = getEditorDataset()) {
  const data = editorRuntime.data[dataset.file];
  if (!dataset.collectionPath?.length) return null;
  const collection = getValueAtPath(data, dataset.collectionPath.join('.'));
  return Array.isArray(collection) ? collection : [];
}

function getEditorSelectedIndex(datasetKey = getEditorDatasetKey()) {
  const dataset = EDITOR_DATASETS[datasetKey];
  const collection = getEditorCollection(dataset);
  const max = Math.max(0, (collection?.length || 1) - 1);
  return clamp(Math.round(finiteNumber(editorRuntime.selectedIndexByDataset[datasetKey], 0)), 0, max);
}

function setEditorSelectedIndex(datasetKey, index) {
  editorRuntime.selectedIndexByDataset[datasetKey] = index;
}

function getEditorCurrentTarget(dataset = getEditorDataset()) {
  const data = editorRuntime.data[dataset.file];
  const collection = getEditorCollection(dataset);
  if (!collection) return data;
  return collection[getEditorSelectedIndex(getEditorDatasetKey())] || collection[0] || {};
}

function getEditorRecordLabel(record = {}, index = 0) {
  const id = record.id ?? record.index ?? index + 1;
  const name = record.name || record.label || `Entry ${index + 1}`;
  return `${id}: ${name}`;
}

async function ensureEditorDataLoaded(force = false) {
  if (editorRuntime.loading) return;
  if (editorRuntime.loaded && !force) return;
  editorRuntime.loading = true;
  try {
    const loaded = {};
    const uniqueDatasets = Object.values(EDITOR_DATASETS)
      .filter((dataset, index, list) => list.findIndex((candidate) => candidate.file === dataset.file) === index);
    for (const dataset of uniqueDatasets) {
      loaded[dataset.file] = await fetchModdableJson(dataset.file, dataset.source(), {});
    }
    editorRuntime.data = loaded;
    editorRuntime.loaded = true;
    editorRuntime.status = 'Editor data loaded.';
  } catch (error) {
    editorRuntime.status = `Editor load failed: ${error?.message || error}`;
  } finally {
    editorRuntime.loading = false;
    if (state.startMenuView === 'editor') renderStartMenu('editor');
  }
}

function parseEditorFieldValue(input, field) {
  if (field.type === 'checkbox') return Boolean(input.checked);
  const raw = input.value;
  if (field.type === 'number') {
    const numeric = Number(raw);
    return Number.isFinite(numeric) ? numeric : 0;
  }
  if (field.type === 'csvNumbers') {
    return raw.split(',')
      .map((value) => Number(value.trim()))
      .filter((value) => Number.isFinite(value));
  }
  if (field.type === 'csvStrings') {
    return raw.split(',')
      .map((value) => value.trim())
      .filter(Boolean);
  }
  if (field.type === 'lines') {
    return raw.split(/\r?\n/)
      .map((value) => value.trim())
      .filter(Boolean);
  }
  return raw;
}

function formatEditorFieldValue(value, field) {
  if (field.type === 'csvNumbers' || field.type === 'csvStrings') {
    return Array.isArray(value) ? value.join(', ') : '';
  }
  if (field.type === 'lines') {
    return Array.isArray(value) ? value.join('\n') : '';
  }
  if (field.type === 'checkbox') return Boolean(value);
  return value ?? '';
}

function renderEditorField(field, target = {}) {
  if (field.type === 'section') {
    return `<div class="editor-section-title">${escapeHtml(field.label || '')}</div>`;
  }
  const value = getValueAtPath(target, field.path);
  const label = escapeHtml(field.label);
  const path = escapeHtml(field.path);
  if (field.type === 'textarea' || field.type === 'lines') {
    const rows = field.type === 'lines' ? 9 : 4;
    return `<label class="editor-field editor-field-wide">
      <span>${label}${field.help ? `<small>${escapeHtml(field.help)}</small>` : ''}</span>
      <textarea data-editor-field="${path}" rows="${rows}">${escapeHtml(formatEditorFieldValue(value, field))}</textarea>
    </label>`;
  }
  if (field.type === 'select') {
    const current = String(value ?? '');
    const options = (field.options || []).map((option) => (
      `<option value="${escapeHtml(option)}" ${current === option ? 'selected' : ''}>${escapeHtml(option)}</option>`
    )).join('');
    return `<label class="editor-field">
      <span>${label}</span>
      <select data-editor-field="${path}">${options}</select>
    </label>`;
  }
  if (field.type === 'checkbox') {
    return `<label class="editor-field editor-field-check">
      <span>${label}</span>
      <input data-editor-field="${path}" type="checkbox" ${value ? 'checked' : ''}>
    </label>`;
  }
  const inputType = field.type === 'colorText' ? 'text' : 'text';
  return `<label class="editor-field">
    <span>${label}</span>
    <input data-editor-field="${path}" type="${inputType}" inputmode="${field.type === 'number' ? 'decimal' : 'text'}" step="${escapeHtml(field.step || '1')}" value="${escapeHtml(formatEditorFieldValue(value, field))}">
  </label>`;
}

function getEditorPreviewMarkup(dataset, target = {}) {
  if (!target) return '';
  if (dataset.preview === 'ship' || dataset.preview === 'station') {
    const src = target.image || getShipPreviewSrc(target.id);
    return `<div class="editor-preview media-preview"><img src="${escapeHtml(src)}?v=${ENTITY_SPRITE_ASSET_VERSION}" alt=""></div>`;
  }
  if (dataset.preview === 'stationPlacement') {
    const stationStats = (editorRuntime.data['station_manifest.json']?.stations || [])
      .find((station) => Number(station.id) === Number(target.stationTypeId));
    const src = stationStats?.image || getShipPreviewSrc(target.stationTypeId);
    return `<div class="editor-preview media-preview"><img src="${escapeHtml(src)}?v=${ENTITY_SPRITE_ASSET_VERSION}" alt=""></div>`;
  }
  if (dataset.preview === 'planet') {
    const surfaceType = Math.max(1, Math.round(finiteNumber(target.surfaceType, 1)));
    return `<div class="editor-preview planet-preview"><img src="assets/game/planet-models/${surfaceType}.png?v=${PLANET_MODEL_ASSET_VERSION}" alt=""></div>`;
  }
  if (dataset.preview === 'weapon') {
    return `<div class="editor-preview weapon-preview"><img src="${escapeHtml(getWeaponShopIconSrc(target))}" alt=""></div>`;
  }
  if (dataset.preview === 'items') {
    const data = editorRuntime.data[dataset.file] || {};
    const settings = data.settings || {};
    const cooldowns = settings.weaponCooldowns || {};
    const minimums = cooldowns.minimumsMs || {};
    const devices = settings.devices || {};
    return `<div class="editor-preview editor-summary-preview">
      <div class="editor-metric-grid">
        <span><strong>${Array.isArray(data.weapons) ? data.weapons.length : 0}</strong><small>Weapons</small></span>
        <span><strong>${Array.isArray(data.tradeGoods) ? data.tradeGoods.length : 0}</strong><small>Trade Goods</small></span>
        <span><strong>${settings.weaponInventoryLimit ?? '-'}</strong><small>Locker Slots</small></span>
        <span><strong>${settings.factionFlags?.basePrice ?? '-'}</strong><small>Flag Base</small></span>
        <span><strong>${minimums.beam ?? '-'}</strong><small>Beam Min</small></span>
        <span><strong>${minimums.torpedo ?? '-'}</strong><small>Torp Min</small></span>
        <span><strong>${devices.cloak?.durationMs ?? '-'}</strong><small>Cloak ms</small></span>
        <span><strong>${devices.tractorBeam?.holdMs ?? '-'}</strong><small>Tractor ms</small></span>
        <span><strong>${devices.engineDisruptor?.disableMs ?? '-'}</strong><small>Disrupt ms</small></span>
        <span><strong>${devices.thaleronGenerator?.cloudMs ?? '-'}</strong><small>Thaleron ms</small></span>
      </div>
    </div>`;
  }
  if (dataset.preview === 'rules') {
    const data = editorRuntime.data[dataset.file] || {};
    const scales = data.classScales || {};
    return `<div class="editor-preview editor-summary-preview">
      <div class="editor-metric-grid">
        ${Object.entries(scales).map(([name, value]) => `<span><strong>${escapeHtml(value)}</strong><small>${escapeHtml(name)}</small></span>`).join('')}
      </div>
    </div>`;
  }
  return '';
}

function renderEditorSelector(datasetKey, dataset, collection) {
  if (!collection) return `<div class="editor-selector single"><strong>${escapeHtml(dataset.label)}</strong><span>${escapeHtml(dataset.file)}</span></div>`;
  const selectedIndex = getEditorSelectedIndex(datasetKey);
  const options = collection.map((record, index) => (
    `<option value="${index}" ${index === selectedIndex ? 'selected' : ''}>${escapeHtml(getEditorRecordLabel(record, index))}</option>`
  )).join('');
  return `<div class="editor-selector">
    <button data-editor-prev aria-label="Previous entry">&lt;</button>
    <select data-editor-select>${options}</select>
    <button data-editor-next aria-label="Next entry">&gt;</button>
  </div>`;
}

function renderEditorTabs(activeKey) {
  return Object.entries(EDITOR_DATASETS).map(([key, dataset]) => (
    `<button class="${key === activeKey ? 'active' : ''}" data-editor-dataset="${escapeHtml(key)}">${escapeHtml(dataset.label)}</button>`
  )).join('');
}

function renderEditorRawPanel(dataset, data) {
  if (!editorRuntime.rawOpen) return '';
  const rawText = editorRuntime.rawText || JSON.stringify(data, null, 2);
  return `<div class="editor-raw-panel">
    <div class="editor-raw-head">
      <strong>Raw JSON: ${escapeHtml(dataset.file)}</strong>
      <span>Advanced edits apply to the whole file.</span>
    </div>
    <textarea id="editor-raw-json" spellcheck="false">${escapeHtml(rawText)}</textarea>
    <div class="editor-actions">
      <button data-editor-apply-raw>Apply Raw JSON</button>
    </div>
  </div>`;
}

function renderStartEditorView() {
  if (!editorRuntime.loaded) {
    ensureEditorDataLoaded();
    return `<div class="card start-card start-editor-card">
      <h2>Game Editor</h2>
      <div class="start-copy-panel"><p>Loading JSON manifests...</p></div>
      <div class="start-actions"><button data-start-view="main">Back</button></div>
    </div>`;
  }
  const datasetKey = getEditorDatasetKey();
  const dataset = getEditorDataset();
  const data = editorRuntime.data[dataset.file] || {};
  const collection = getEditorCollection(dataset);
  const target = getEditorCurrentTarget(dataset);
  const hasOverride = hasModDataOverride(dataset.file);
  const fields = dataset.fields.map((field) => renderEditorField(field, target)).join('');
  const rawPanel = renderEditorRawPanel(dataset, data);
  return `<div class="card start-card start-editor-card">
    <div class="editor-head">
      <div>
        <h2>Game Editor</h2>
        <p>${escapeHtml(dataset.label)} | ${escapeHtml(dataset.file)} ${hasOverride ? '| Local override active' : '| Base JSON'}</p>
      </div>
      <button class="panel-close" data-start-view="main" aria-label="Close editor">&times;</button>
    </div>
    <div class="editor-tabs">${renderEditorTabs(datasetKey)}</div>
    <div class="editor-workbench">
      <aside class="editor-side">
        ${renderEditorSelector(datasetKey, dataset, collection)}
        ${getEditorPreviewMarkup(dataset, target)}
        <div class="editor-file-note">
          <strong>${escapeHtml(dataset.file)}</strong>
          <span>Save stores a browser override. Export downloads the edited JSON.</span>
        </div>
      </aside>
      <section class="editor-main">
        <form class="editor-form">${fields}</form>
        ${rawPanel}
      </section>
    </div>
    <div class="editor-footer">
      <span id="editor-status">${escapeHtml(editorRuntime.status)}</span>
      <div class="editor-actions">
        <button data-editor-save>Save</button>
        <button data-editor-toggle-raw>${editorRuntime.rawOpen ? 'Hide Raw JSON' : 'Raw JSON'}</button>
        <button data-editor-export>Export JSON</button>
        <button data-editor-reset ${hasOverride ? '' : 'disabled'}>Reset Local</button>
        <button data-start-view="main">Home</button>
      </div>
    </div>
  </div>`;
}

async function applyEditorRuntimeData(datasetKey = getEditorDatasetKey()) {
  const dataset = EDITOR_DATASETS[datasetKey];
  if (!dataset) return;
  if (['game_items.json'].includes(dataset.file)) {
    await loadGameItemsData();
    normalizeWeaponLoadout();
  }
  if (['starship_manifest.json', 'station_manifest.json', 'pod_manifest.json', 'ship_size_config.json'].includes(dataset.file)) {
    await loadShipManifest();
    if (state.gameStarted) applyCurrentShipStats(false);
  }
  if (['planetData.json', 'stationData.json', 'mapnames.json', 'itemtext.json'].includes(dataset.file)) {
    await loadSourceData();
  }
  if (dataset.file === 'planet_manifest.json') {
    await loadPlanetModels();
  }
  syncLegacyState();
  updateStats();
}

async function saveEditorForm() {
  const datasetKey = getEditorDatasetKey();
  const dataset = getEditorDataset();
  const data = editorRuntime.data[dataset.file];
  const target = getEditorCurrentTarget(dataset);
  const form = startMenuEl?.querySelector('.editor-form');
  if (!data || !target || !form) return;
  const fieldMap = Object.fromEntries(dataset.fields.filter((field) => field.path).map((field) => [field.path, field]));
  for (const input of form.querySelectorAll('[data-editor-field]')) {
    const field = fieldMap[input.dataset.editorField];
    if (!field) continue;
    setValueAtPath(target, field.path, parseEditorFieldValue(input, field));
  }
  setModDataOverride(dataset.file, data);
  editorRuntime.status = `${dataset.label} saved locally. Export JSON to make a file copy.`;
  editorRuntime.rawText = '';
  await applyEditorRuntimeData(datasetKey);
  renderStartMenu('editor');
}

async function applyEditorRawJson() {
  const datasetKey = getEditorDatasetKey();
  const dataset = getEditorDataset();
  const textarea = document.getElementById('editor-raw-json');
  if (!textarea) return;
  try {
    const parsed = JSON.parse(textarea.value);
    editorRuntime.data[dataset.file] = parsed;
    setModDataOverride(dataset.file, parsed);
    editorRuntime.status = `${dataset.file} raw JSON saved locally.`;
    editorRuntime.rawText = JSON.stringify(parsed, null, 2);
    await applyEditorRuntimeData(datasetKey);
  } catch (error) {
    editorRuntime.status = `Raw JSON error: ${error?.message || error}`;
  }
  renderStartMenu('editor');
}

function downloadEditorDataset() {
  const dataset = getEditorDataset();
  const data = editorRuntime.data[dataset.file];
  if (!data) return;
  const blob = new Blob([`${JSON.stringify(data, null, 2)}\n`], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = dataset.file;
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
  editorRuntime.status = `${dataset.file} exported.`;
  renderStartMenu('editor');
}

async function resetEditorDataset() {
  const datasetKey = getEditorDatasetKey();
  const dataset = getEditorDataset();
  clearModDataOverride(dataset.file);
  editorRuntime.data[dataset.file] = await fetchJsonOrNull(dataset.source()) || {};
  editorRuntime.rawText = '';
  editorRuntime.status = `${dataset.file} local override removed.`;
  await applyEditorRuntimeData(datasetKey);
  renderStartMenu('editor');
}

function setEditorDataset(datasetKey) {
  if (!EDITOR_DATASETS[datasetKey]) return;
  editorRuntime.dataset = datasetKey;
  editorRuntime.rawOpen = false;
  editorRuntime.rawText = '';
  editorRuntime.status = `${EDITOR_DATASETS[datasetKey].label} selected.`;
  renderStartMenu('editor');
}

function moveEditorSelection(direction = 1) {
  const datasetKey = getEditorDatasetKey();
  const collection = getEditorCollection();
  if (!collection?.length) return;
  const next = (getEditorSelectedIndex(datasetKey) + direction + collection.length) % collection.length;
  setEditorSelectedIndex(datasetKey, next);
  editorRuntime.rawText = '';
  renderStartMenu('editor');
}

function renderStartMenu(view = state.startMenuView || 'main') {
  if (!startMenuEl) return;
  state.startMenuView = view;
  if (state.gameStarted) {
    applyFactionUiTheme();
    state.introActive = false;
    stopAllGameAudioLoops();
    introStoryEl?.classList.add('hidden');
    introStoryEl?.classList.remove('rolling');
    startMenuEl.style.display = 'none';
    startMenuEl.innerHTML = '';
    return;
  }
  applyFactionUiTheme();
  startMenuEl.style.display = 'flex';
  syncBackgroundAudio();
  const hasAnySave = Array.from({ length: SAVE_SLOT_COUNT }, (_, index) => getSaveSlotRaw(index + 1)).some(Boolean);
  if (view === 'factions') {
    const selectedFaction = factionDefs[getStartSetupFaction()] || factionDefs.neutral;
    startMenuEl.innerHTML = `<div class="card start-card start-faction-card">
      <h2>Choose Faction</h2>
      <p>Select your starting faction, then name your captain and ship.</p>
      <div class="row faction-grid">${renderStartFactionGrid()}</div>
      <div id="faction-desc" class="start-desc">${renderFactionLorePanel(selectedFaction, 'choice-lore')}</div>
      <div class="start-actions">
        <button data-start-view="main">Back</button>
        <button data-start-view="setup">Continue</button>
      </div>
    </div>`;
    return;
  }
  if (view === 'setup') {
    startMenuEl.innerHTML = renderStartSetupForm();
    return;
  }
  if (view === 'load') {
    startMenuEl.innerHTML = `<div class="card start-card">
      <h2>Load Game</h2>
      <p>Select a save slot.</p>
      <div class="save-slot-list">${renderStartSaveSlots()}</div>
      <div class="start-actions"><button data-start-view="main">Back</button></div>
    </div>`;
    return;
  }
  if (view === 'options') {
    startMenuEl.innerHTML = renderStartOptionsView();
    return;
  }
  if (view === 'instructions') {
    startMenuEl.innerHTML = renderStartInstructionsView();
    return;
  }
  if (view === 'editor') {
    startMenuEl.innerHTML = renderStartEditorView();
    return;
  }
  startMenuEl.innerHTML = `<div class="card start-card start-main-card start-command-card">
    <div class="start-title-row">
      <h2>FlashTrek: Broken Mirror 1 - Remastered</h2>
    </div>
    <div class="start-command-grid">
      <button class="start-command start-command-primary" data-start-view="factions">Play Game</button>
      <button class="start-command" data-start-view="load" ${hasAnySave ? '' : 'disabled'}>Load Saved</button>
      <button class="start-command" data-start-view="options">Options</button>
      <button class="start-command" data-start-view="instructions">Instructions</button>
      <button class="start-command" data-start-view="editor">Game Editor</button>
    </div>
  </div>`;
}

function showIntroStory() {
  if (!introStoryEl || !introStoryTextEl || state.gameStarted) {
    renderStartMenu('main');
    return;
  }
  state.introActive = true;
  introStoryTextEl.innerHTML = ORIGINAL_INTRO_STORY_HTML;
  if (startMenuEl) {
    startMenuEl.style.display = 'none';
    startMenuEl.innerHTML = '';
  }
  introStoryEl.classList.remove('hidden', 'rolling');
  introStoryEl.setAttribute('aria-hidden', 'false');
  syncBackgroundAudio();
  introStoryTextEl.getBoundingClientRect();
  requestAnimationFrame(() => {
    if (state.introActive) introStoryEl.classList.add('rolling');
  });
}

function skipIntroStory() {
  if (!state.introActive) return;
  state.introActive = false;
  introStoryEl?.classList.add('hidden');
  introStoryEl?.classList.remove('rolling');
  introStoryEl?.setAttribute('aria-hidden', 'true');
  syncBackgroundAudio();
  renderStartMenu(state.startMenuView || 'main');
}

const keys = new Set();
const flightKeys = new Set(['w', 'a', 's', 'd', 'arrowup', 'arrowdown', 'arrowleft', 'arrowright']);
const heldWeaponInputs = new Map();
function getWeaponSlotForKeyEvent(e) {
  const key = e.key.toLowerCase();
  if (e.code === 'Space') return 1;
  if (['1', '2', '3'].includes(key)) return Number(key);
  if (key === 'z') return 2;
  if (key === 'x') return 3;
  if (['Digit1', 'Numpad1'].includes(e.code)) return 1;
  if (['Digit2', 'Numpad2'].includes(e.code)) return 2;
  if (['Digit3', 'Numpad3'].includes(e.code)) return 3;
  return null;
}
function getWeaponInputToken(e, slot = getWeaponSlotForKeyEvent(e)) {
  if (!slot) return null;
  return e.code || `slot-${slot}`;
}
function getHeldWeaponSlots() {
  return [...new Set(heldWeaponInputs.values())].sort((a, b) => a - b);
}
introSkipBtn?.addEventListener('click', skipIntroStory);
introStoryEl?.addEventListener('animationend', (e) => {
  if (e.target === introStoryTextEl) skipIntroStory();
});
window.addEventListener('keydown', (e) => {
  if (!state.introActive) return;
  if (['escape', 'enter', ' '].includes(e.key.toLowerCase())) {
    e.preventDefault();
    skipIntroStory();
  }
}, { capture: true });
window.addEventListener('keydown', (e) => {
  const key = e.key.toLowerCase();
  const weaponSlot = getWeaponSlotForKeyEvent(e);
  if (state.missionCompleteNotice) {
    if (['escape', 'enter', ' '].includes(key)) closeMissionCompleteModal();
    if (state.gameStarted) e.preventDefault();
    e.stopImmediatePropagation();
    return;
  }
  if (state.pendingFleetPurchase) {
    if (key === 'escape') closeFleetPurchaseModal();
    if (state.gameStarted && (flightKeys.has(key) || weaponSlot || key === 'escape')) e.preventDefault();
    return;
  }
  if (state.pendingShipPurchase) {
    if (key === 'escape') closeShipPurchaseModal();
    if (state.gameStarted && (flightKeys.has(key) || weaponSlot || key === 'escape')) e.preventDefault();
    return;
  }
  if (state.pendingContractOffer) {
    if (key === 'escape') declinePendingContract();
    if (state.gameStarted && (flightKeys.has(key) || weaponSlot || key === 'escape')) e.preventDefault();
    return;
  }
  if (state.gameStarted && (flightKeys.has(key) || weaponSlot)) e.preventDefault();
  if (state.warp.active) return;
  if (state.gameStarted && e.shiftKey && /^Digit[1-8]$/.test(e.code || '')) {
    e.preventDefault();
    fleetOrder(Number(e.code.slice(5)));
    return;
  }
  if (state.gameStarted && weaponSlot) {
    if (e.repeat && isWeaponSlotCloakingDevice(weaponSlot)) return;
    heldWeaponInputs.set(getWeaponInputToken(e, weaponSlot), weaponSlot);
    firePlayerWeapon(weaponSlot);
    return;
  }
  if (state.gameStarted && key === 'tab') {
    e.preventDefault();
    cycleCombatTarget();
    return;
  }
  if (state.gameStarted && e.code === 'ControlLeft' && !e.repeat) {
    e.preventDefault();
    cycleAllContacts();
    return;
  }
  if (flightKeys.has(key)) keys.add(key);
});
window.addEventListener('keyup', (e) => {
  const key = e.key.toLowerCase();
  if (state.gameStarted && flightKeys.has(key)) e.preventDefault();
  const weaponSlot = getWeaponSlotForKeyEvent(e);
  const weaponToken = getWeaponInputToken(e, weaponSlot);
  if (weaponToken) heldWeaponInputs.delete(weaponToken);
  keys.delete(key);
});
window.addEventListener('blur', () => {
  keys.clear();
  heldWeaponInputs.clear();
});
let lastMotionStatsAt = 0;

function setLog(msg) {
  state.log = msg;
  if (logEl) logEl.textContent = msg;
  const messageEl = statsEl?.querySelector('.top-message');
  if (messageEl) messageEl.textContent = msg;
}

function addWorldPop(x, y, text, color = '#ffd66e') {
  state.worldPops.push({
    x,
    y,
    text,
    color,
    born: performance.now(),
    ttl: 1300,
  });
}

function syncFuelToAntimatter() {
  state.antimatter = Math.max(0, Math.min(Math.round(state.antimatter), state.fuelCap));
  state.myantimatter = state.antimatter;
  state.fuel = state.antimatter;
}

function syncLegacyState() {
  state.currentPlanet = Math.max(0, state.myplanet - 1);
  state.mylatinum = state.latinum;
  state.myduranium = state.duranium;
  syncFuelToAntimatter();
  state.shields = clamp(finiteNumber(state.shields, 100), 0, 100);
  state.mycargo = state.cargo;
  state.totcargo = state.cargoCap;
}

function recalcCargoFromPods() {
  state.cargo = state.cargoArray.reduce((sum, pod) => sum + Number(pod.tons || 0), 0);
  state.mycargo = state.cargo;
}

function normalizePlaceName(value = '') {
  return String(value || '').trim().toLowerCase();
}

function findPlanetIndexByName(name) {
  const normalized = normalizePlaceName(name);
  if (!normalized) return -1;
  return state.planets.findIndex((planet) => normalizePlaceName(planet?.name) === normalized);
}

function getCargoDestinationIndex(pod = {}) {
  const indexedValue = Number.isFinite(Number(pod.destinationIndex))
    ? Number(pod.destinationIndex)
    : Number.isFinite(Number(pod.targetIndex))
      ? Number(pod.targetIndex)
      : Number.isFinite(Number(pod.destination))
        ? Number(pod.destination)
        : -1;
  if (indexedValue >= 0 && indexedValue < state.planets.length) return indexedValue;
  return findPlanetIndexByName(pod.destination || pod.targetName);
}

function getCargoDestinationName(pod = {}) {
  const destinationIndex = getCargoDestinationIndex(pod);
  if (destinationIndex >= 0) return state.planets[destinationIndex]?.name || pod.destination || pod.targetName || '';
  return String(pod.destination || pod.targetName || '');
}

function getCargoDestinationKeyFromValues(destination = undefined, destinationIndex = undefined) {
  const numericIndex = Number(destinationIndex);
  if (Number.isFinite(numericIndex) && numericIndex >= 0 && numericIndex < state.planets.length) {
    return `index:${numericIndex}`;
  }
  if (Number.isFinite(Number(destination))) {
    return `index:${Number(destination)}`;
  }
  const resolvedIndex = findPlanetIndexByName(destination);
  if (resolvedIndex >= 0) return `index:${resolvedIndex}`;
  const normalizedName = normalizePlaceName(destination);
  return normalizedName ? `name:${normalizedName}` : 'loose';
}

function getCargoDestinationKey(pod = {}) {
  const destinationIndex = getCargoDestinationIndex(pod);
  return getCargoDestinationKeyFromValues(pod.destination || pod.targetName, destinationIndex);
}

function isCargoDueAtCurrentPlanet(pod = {}) {
  if (Number(pod.tons || 0) <= 0) return false;
  const destinationIndex = getCargoDestinationIndex(pod);
  if (destinationIndex >= 0) return destinationIndex === state.currentPlanet;
  return normalizePlaceName(pod.destination || pod.targetName) === normalizePlaceName(state.planets[state.currentPlanet]?.name);
}

function escapeHtml(value) {
  return String(value)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

const ORIGINAL_BITMAP_ROOT = 'assets/game/ui-icons';
const WEAPON_SPRITE_ROOT = 'assets/game/weapons';
const WEAPON_SHOP_ICON_ROOT = 'assets/game/weapons/shop-icons';
const RESOURCE_ICON_FILES = Object.freeze({
  latinum: 'resources/latinum.png',
  antimatter: 'resources/antimatter.png',
  duranium: 'resources/duranium.png',
  deuranium: 'resources/duranium.png',
  cargo: 'resources/cargo.png',
  shield: 'resources/shield.png',
  hull: 'resources/hull.png',
  speed: 'resources/speed.png',
  range: 'resources/range.png',
});

function getOriginalBitmapSrc(file) {
  return `${ORIGINAL_BITMAP_ROOT}/${file}`;
}

function getOriginalWeaponSprite(file) {
  if (!originalWeaponSprites[file]) {
    const img = new Image();
    img.src = getOriginalBitmapSrc(file);
    originalWeaponSprites[file] = img;
  }
  return originalWeaponSprites[file];
}

function getWeaponSpriteSrc(file) {
  return `${WEAPON_SPRITE_ROOT}/${file}`;
}

function getWeaponShopIconSrc(weapon = getWeapon()) {
  return `${WEAPON_SHOP_ICON_ROOT}/weapon-${Number(weapon.id)}.png?v=${WEAPON_ICON_ASSET_VERSION}`;
}

function getWeaponSprite(file) {
  if (!originalWeaponSprites[file]) {
    const img = new Image();
    img.src = getWeaponSpriteSrc(file);
    originalWeaponSprites[file] = img;
  }
  return originalWeaponSprites[file];
}

function drawTintedSpriteSection(img, sx, sy, sw, sh, x, y, w, h, color = '#dfeaff', tintAlpha = 0.86) {
  if (!img?.complete || img.naturalWidth <= 0) return false;
  const outW = Math.max(1, Math.ceil(Math.abs(w)));
  const outH = Math.max(1, Math.ceil(Math.abs(h)));
  tintCanvas.width = outW;
  tintCanvas.height = outH;
  tintCtx.clearRect(0, 0, outW, outH);
  tintCtx.globalCompositeOperation = 'source-over';
  tintCtx.globalAlpha = 1;
  tintCtx.imageSmoothingEnabled = true;
  tintCtx.imageSmoothingQuality = 'high';
  tintCtx.drawImage(img, sx, sy, sw, sh, 0, 0, outW, outH);
  tintCtx.globalCompositeOperation = 'source-atop';
  tintCtx.globalAlpha = tintAlpha;
  tintCtx.fillStyle = color;
  tintCtx.fillRect(0, 0, outW, outH);
  tintCtx.globalCompositeOperation = 'screen';
  tintCtx.globalAlpha = 0.22;
  tintCtx.drawImage(img, sx, sy, sw, sh, 0, 0, outW, outH);
  tintCtx.globalCompositeOperation = 'source-over';
  tintCtx.globalAlpha = 1;
  ctx.drawImage(tintCanvas, x, y, w, h);
  return true;
}

function drawTintedSprite(img, x, y, w, h, color = '#dfeaff', tintAlpha = 0.86) {
  return drawTintedSpriteSection(img, 0, 0, img?.naturalWidth || 0, img?.naturalHeight || 0, x, y, w, h, color, tintAlpha);
}

function drawBeamSprite(img, length, height, color = '#ff9a3d') {
  if (!img?.complete || img.naturalWidth <= 0 || length <= 0) return false;
  const naturalCap = clamp(Math.round(img.naturalWidth * 0.22), 18, 58);
  const capWidth = Math.min(length, naturalCap * (height / img.naturalHeight));
  if (length <= capWidth + 4) {
    return drawTintedSprite(img, 0, -height / 2, length, height, color, 0.9);
  }
  drawTintedSpriteSection(img, 0, 0, naturalCap, img.naturalHeight, 0, -height / 2, capWidth, height, color, 0.9);
  drawTintedSpriteSection(
    img,
    naturalCap,
    0,
    img.naturalWidth - naturalCap,
    img.naturalHeight,
    capWidth,
    -height / 2,
    length - capWidth,
    height,
    color,
    0.9,
  );
  return true;
}

function getResourceIconSrc(kind = 'latinum') {
  return getOriginalBitmapSrc(RESOURCE_ICON_FILES[kind] || RESOURCE_ICON_FILES.latinum);
}

function iconImg(src, label, className = 'ui-icon') {
  return `<img class="${className}" src="${escapeHtml(src)}" alt="${escapeHtml(label)}" title="${escapeHtml(label)}">`;
}

function resourceIcon(kind, label = kind) {
  return iconImg(getResourceIconSrc(kind), label, 'resource-icon');
}

function iconStat(kind, value, label = kind) {
  return `<span class="icon-stat">${resourceIcon(kind, label)}<span>${escapeHtml(value)}</span></span>`;
}

function renderMarketOffer(offer, index) {
  return `<span class="market-offer">
    <span class="market-good">${resourceIcon('cargo', 'Cargo')}${escapeHtml(offer.goods)}</span>
    ${iconStat('latinum', `${offer.price}L`, 'Latinum')}
    <span class="market-buttons"><button data-market-buy="${index}">Buy</button><button data-market-sell="${index}">Sell</button></span>
  </span>`;
}

function normalizeContract(contract) {
  if (!contract || typeof contract !== 'object') return null;
  const targetIndex = Number(contract.targetIndex);
  const targetPlanet = Number.isFinite(targetIndex) ? state.planets[targetIndex] : null;
  const tons = Math.max(1, Math.round(Number(contract.tons || 1)));
  const payPerTon = Math.max(0, Math.round(Number(contract.payPerTon || 0)));
  const targetName = contract.targetName || targetPlanet?.name;
  if (!contract.goods || !targetName) return null;
  return {
    id: String(contract.id || `contract-${Date.now().toString(36)}-${Math.floor(Math.random() * 100000).toString(36)}`),
    goods: String(contract.goods),
    targetIndex: Number.isFinite(targetIndex) ? targetIndex : findPlanetIndexByName(targetName),
    targetName: String(targetName),
    tons,
    payPerTon,
    hazardPay: Math.max(0, Math.round(Number(contract.hazardPay || 0))),
    originIndex: Number.isFinite(Number(contract.originIndex)) ? Number(contract.originIndex) : state.currentPlanet,
    originName: String(contract.originName || state.planets[state.currentPlanet]?.name || 'Local space'),
    employerName: String(contract.employerName || contract.originName || 'Contract Office'),
    employerType: String(contract.employerType || 'planet'),
    employerFaction: Object.prototype.hasOwnProperty.call(contract, 'employerFaction')
      ? contract.employerFaction
      : getTradeStandingFaction(Number(contract.originIndex)),
    negotiated: Boolean(contract.negotiated),
    createdAt: Number(contract.createdAt || Date.now()),
  };
}

function normalizeOpenContracts() {
  const source = Array.isArray(state.openContracts) ? state.openContracts : [];
  const contracts = source.map(normalizeContract).filter(Boolean);
  if (!contracts.length && state.activeContract) {
    const legacy = normalizeContract(state.activeContract);
    if (legacy) contracts.push(legacy);
  }
  state.openContracts = contracts;
  state.activeContract = contracts[0] || null;
  return contracts;
}

function getOpenContracts() {
  return normalizeOpenContracts();
}

function getContractTotal(contract) {
  return Math.max(0, Math.round(Number(contract?.payPerTon || 0) * Number(contract?.tons || 0)));
}

function getContractTargetIndex(contract = {}) {
  const targetIndex = Number(contract.targetIndex);
  if (Number.isFinite(targetIndex) && targetIndex >= 0 && targetIndex < state.planets.length) return targetIndex;
  return findPlanetIndexByName(contract.targetName);
}

function isCargoPodForContract(pod = {}, contract = {}) {
  if (Number(pod.tons || 0) <= 0) return false;
  if (contract.id && pod.contractId && String(pod.contractId) === String(contract.id)) return true;
  if (String(pod.item || '') !== String(contract.goods || '')) return false;
  const targetIndex = getContractTargetIndex(contract);
  const contractKey = getCargoDestinationKeyFromValues(contract.targetName, targetIndex);
  return getCargoDestinationKey(pod) === contractKey;
}

function cloneCargoPods(pods = state.cargoArray) {
  return Array.isArray(pods) ? pods.map((pod) => ({ ...pod })) : createEmptyCargoArray();
}

function restoreMissingContractCargo({ onlyCurrentDestination = false } = {}) {
  let restored = 0;
  for (const contract of getOpenContracts()) {
    const targetIndex = getContractTargetIndex(contract);
    const targetNameMatches = normalizePlaceName(contract.targetName) === normalizePlaceName(state.planets[state.currentPlanet]?.name);
    if (onlyCurrentDestination && targetIndex !== state.currentPlanet && !targetNameMatches) continue;
    if (state.cargoArray.some((pod) => isCargoPodForContract(pod, contract))) continue;
    const targetName = contract.targetName || state.planets[targetIndex]?.name;
    const loaded = addCargoToPods(
      contract.goods,
      contract.tons,
      targetName,
      getContractTotal(contract),
      { destinationIndex: targetIndex, contractId: contract.id },
    );
    if (loaded) restored += Number(contract.tons || 0);
  }
  return restored;
}

function renderOpenContractsPanel() {
  const contracts = getOpenContracts();
  if (!contracts.length) {
    return '<div class="contracts"><div class="panel-head">Contracts</div><div class="meta">No active contracts.</div></div>';
  }
  const rows = contracts.map((contract) => `<div class="contract-cardline">
    <div class="contract-route">${escapeHtml(contract.originName)} -> ${escapeHtml(contract.targetName)}</div>
    <div class="contract-load">${escapeHtml(contract.tons)}t ${escapeHtml(contract.goods)} | ${escapeHtml(getContractTotal(contract))}L</div>
  </div>`).join('');
  return `<div class="contracts"><div class="panel-head">Contracts</div>${rows}</div>`;
}

function updatePanel() {
  if (panelEl) panelEl.innerHTML = '';
  renderTopLeftPanel();
}

function getGodModeShips() {
  const classOrder = {
    shuttle: 1,
    escort: 2,
    science: 2,
    lightCruiser: 3,
    cruiser: 4,
    capital: 5,
    battleship: 6,
    station: 99,
  };
  return Object.values(state.shipStatsById || {})
    .filter((ship) => ship && ship.assetType === 'ship' && ship.rosterState !== 'retired' && !isUnbalancedPrototype(ship))
    .sort((a, b) => {
      const aClass = classOrder[a.shipClass] || classOrder[getShipVisualClass(a.id)] || 50;
      const bClass = classOrder[b.shipClass] || classOrder[getShipVisualClass(b.id)] || 50;
      if (aClass !== bClass) return aClass - bClass;
      return String(a.name || '').localeCompare(String(b.name || ''));
    });
}

function getGodModeShipGroups() {
  const groups = new Map();
  for (const ship of getGodModeShips()) {
    const faction = getShipFaction(ship.id);
    const key = faction || 'neutral';
    if (!groups.has(key)) {
      groups.set(key, {
        faction: key,
        label: formatFaction(key),
        ships: [],
      });
    }
    groups.get(key).ships.push(ship);
  }
  return [...groups.values()].sort((a, b) => {
    if (a.faction === state.playerFaction) return -1;
    if (b.faction === state.playerFaction) return 1;
    if (a.faction === 'neutral') return 1;
    if (b.faction === 'neutral') return -1;
    return a.label.localeCompare(b.label);
  });
}

function renderGodModeShipSwitcher() {
  const groups = getGodModeShipGroups();
  if (!groups.length) return '<div class="meta">No ship manifest entries loaded.</div>';
  return `<div class="god-ship-list">${groups.map((group) => `<section class="god-ship-race-group">
    <div class="god-ship-race-head">
      <span>${escapeHtml(group.label)}</span>
      <small>${group.ships.length} ship${group.ships.length === 1 ? '' : 's'}</small>
    </div>
    <div class="god-ship-race-list">${group.ships.map((ship) => {
      const id = Number(ship.id);
      const current = id === Number(state.playership);
      return `<div class="god-ship-card ${current ? 'current' : ''}">
      <img class="ship-preview ship-preview-${escapeHtml(getShipVisualClass(id))}" src="${escapeHtml(getShipPreviewSrc(id))}" alt="">
      <div class="god-ship-info">
        <div class="name">${escapeHtml(ship.name || `Ship ${id}`)}</div>
        <div class="meta">${escapeHtml(formatShipClass(ship.shipClass || getShipVisualClass(id)))} | Range ${getShipWarpRange(id)}</div>
      </div>
      <button data-god-ship="${id}" ${current ? 'disabled' : ''}>${current ? 'Current' : 'Fly'}</button>
    </div>`;
    }).join('')}</div>
  </section>`).join('')}</div>`;
}

function renderTopLeftPanel() {
  if (!topLeftMenuEl || !topLeftPanelEl) return;
  const sensorDetailsOpen = new Set([...topLeftPanelEl.querySelectorAll('details[data-sensor-details][open]')].map(el=>el.dataset.sensorDetails));
  const previousScrollTarget = state.topLeftTab === 'settings'
    ? topLeftPanelEl.querySelector('.god-ship-switcher')
    : topLeftPanelEl.querySelector('.top-left-panel-content');
  if (previousScrollTarget) {
    state.topLeftPanelScrollByTab[state.topLeftTab] = previousScrollTarget.scrollTop;
  }
  if (!state.gameStarted) {
    topLeftMenuEl.classList.add('hidden');
    topLeftPanelEl.classList.add('hidden');
    topLeftPanelEl.innerHTML = '';
    return;
  }
  topLeftMenuEl.classList.remove('hidden');
  normalizeWeaponLoadout();
  for (const button of topLeftMenuEl.querySelectorAll('[data-top-left-tab]')) {
    button.classList.toggle('active', state.topLeftPanelOpen && button.dataset.topLeftTab === state.topLeftTab);
  }
  if (!state.topLeftPanelOpen) {
    topLeftPanelEl.classList.add('hidden');
    topLeftPanelEl.innerHTML = '';
    return;
  }
  topLeftPanelEl.classList.remove('hidden');
  normalizePlayerFlags();
  restoreMissingContractCargo();
  const pods = state.cargoArray.map((pod, index) => {
    const tons = Number(pod.tons || 0);
    const item = tons > 0 ? pod.item : 'Empty';
    const destinationName = tons > 0 ? getCargoDestinationName(pod) : '';
    const destination = destinationName ? ` -> ${destinationName}` : '';
    const payout = destinationName ? ` (${pod.payout}L)` : '';
    return `<span class="pod ${tons > 0 ? 'filled' : 'empty'}">${index + 1}: ${tons}t ${escapeHtml(item)}${escapeHtml(destination)}${escapeHtml(payout)}</span>`;
  }).join('');
  const contract = renderOpenContractsPanel();
  const slotLine = state.weaponSlots.map((weaponId, index) => {
    const weapon = weaponId ? getWeapon(weaponId) : null;
    return `<span class="weapon-slot ${weapon ? 'filled' : 'empty'}">${weapon ? `<img class="weapon-mini-icon" src="${escapeHtml(getWeaponIconSrc(weapon))}" alt="">` : ''}<span class="weapon-name">${index + 1}: ${weapon ? escapeHtml(weapon.name) : 'Empty'}</span></span>`;
  }).join('');
  const inventoryLine = state.weaponInventory.map((weaponId) => {
    const weapon = getWeapon(weaponId);
    const slotButtons = [1, 2, 3].map((slot) => (
      `<button data-panel-weapon-slot="${slot}" data-weapon-id="${weapon.id}" ${canLoadWeaponIntoSlot(weapon.id, slot) ? '' : 'disabled'}>${slot}</button>`
    )).join('');
    return `<span class="weapon-inventory-item"><img class="weapon-mini-icon" src="${escapeHtml(getWeaponIconSrc(weapon))}" alt=""><span class="weapon-name">${escapeHtml(weapon.name)}</span><span class="weapon-slot-buttons">${slotButtons}</span></span>`;
  }).join('');
  const weaponLine = `<div class="weapon-panel"><div class="weapon-slots">${slotLine}</div><div class="weapon-inventory">${inventoryLine}</div></div>`;
  const stationPlanLine = getOwnedStationPlanTypes().map((stationStats) => (
    `<span class="station-plan-item">${escapeHtml(stationStats.name)}</span>`
  )).join('');
  const stationPlans = `<div class="station-plan-inventory"><div class="panel-head">Station Plans</div>${stationPlanLine || '<div class="meta">No station plans owned.</div>'}</div>`;
  const resources = `<div class="dock-resources">
    ${iconStat('latinum', state.latinum, 'Latinum')}
    ${iconStat('duranium', state.duranium, 'Duranium')}
    ${iconStat('antimatter', `${state.antimatter}/${state.fuelCap}`, 'Antimatter')}
    ${iconStat('cargo', `${state.cargo}/${state.cargoCap}`, 'Cargo')}
  </div>`;
  const flags = renderPlayerFlagsPanel();
  const settingsActions = `<div class="top-action-grid settings-actions">
    ${Array.from({ length: SAVE_SLOT_COUNT }, (_, index) => `<button data-save-slot="${index + 1}">Save ${index + 1}</button>`).join('')}
    ${Array.from({ length: SAVE_SLOT_COUNT }, (_, index) => `<button data-load-slot="${index + 1}" ${getSaveSlotRaw(index + 1) ? '' : 'disabled'}>Load ${index + 1}</button>`).join('')}
    <button data-top-action="god-mode">${state.godMode ? 'God Mode On' : 'God Mode'}</button>
    <button data-top-action="god-refill">Refill</button>
  </div>`;
  const gameOptions = `<div class="game-option-list in-game-option-list">${renderGameOptionsList('data-game-option')}</div>`;
  const godStatus = state.godMode
    ? `God Mode active | ${state.latinum}L | ${state.duranium}D | AM ${state.antimatter}/${state.fuelCap}`
    : 'Enable God Mode to max credits, duranium and antimatter, then switch ships instantly.';
  const powerContent = `<div class="panel-head">Power (OPS)</div>${renderPowerPanel()}`;
  const panelContent = state.topLeftTab === 'power'
    ? powerContent
    : state.topLeftTab === 'settings'
    ? `<div class="panel-head">Settings</div>${gameOptions}<div class="panel-head">Save & Debug</div>${settingsActions}<div class="meta">${escapeHtml(godStatus)}</div><div class="panel-head">God Ship Switcher</div><div class="god-ship-switcher">${renderGodModeShipSwitcher()}</div>`
    : `<div class="panel-head">Inventory</div>${resources}${flags}${stationPlans}${weaponLine}${contract}<div class="panel-head">Cargo Pods</div><div class="pods">${pods}</div>`;
  topLeftPanelEl.innerHTML = `<button class="panel-close top-left-panel-close" data-top-action="close-panel" aria-label="Close ${escapeHtml(state.topLeftTab)} panel">&times;</button><div class="top-left-panel-content">${panelContent}</div>`;
  for(const el of topLeftPanelEl.querySelectorAll('details[data-sensor-details]'))el.open=sensorDetailsOpen.has(el.dataset.sensorDetails);
  const restoredScrollTarget = state.topLeftTab === 'settings'
    ? topLeftPanelEl.querySelector('.god-ship-switcher')
    : topLeftPanelEl.querySelector('.top-left-panel-content');
  if (restoredScrollTarget) {
    restoredScrollTarget.scrollTop = state.topLeftPanelScrollByTab[state.topLeftTab] || 0;
  }
}

function getShipPrice(ship) {
  return Math.max(0, Math.round(finiteNumber(ship?.cost, 0)));
}

function getWeaponSlotId(slot = 1) {
  normalizeWeaponLoadout();
  return state.weaponSlots[slot - 1] || null;
}

function getWeapon(id = state.equippedWeaponId || state.weaponSlots?.[0] || DEFAULT_WEAPON_ID) {
  return WEAPON_CATALOG.find((weapon) => weapon.id === Number(id)) || WEAPON_CATALOG[0];
}

function getWeaponIconSrc(weapon = getWeapon()) {
  return getWeaponShopIconSrc(weapon);
}

function getWeaponTypeIconSrc(weapon = getWeapon()) {
  return getWeaponShopIconSrc(weapon);
}

function getShipPreviewSrc(shipId) {
  const numericId = Number(shipId);
  const catalogSrc = catalogImageUrl(state.shipCatalog, resolveShipId(numericId));
  if (catalogSrc) return catalogSrc;
  return state.shipImageById[numericId] || getShipImageCandidates(numericId)[0] || `assets/game/ships/${numericId}.png`;
}

function getWeaponVisualKind(weapon = getWeapon()) {
  if (weapon.type === 'Torpedo' || weapon.type === 'Heavy') return 'torpedo';
  if (weapon.type === 'Mine') return 'mine';
  if (weapon.type === 'Cannon' || weapon.type === 'Turret') return 'bolt';
  if (weapon.type === 'Beam' || weapon.type === 'Device' || weapon.name.includes('Phaser') || weapon.name.includes('Lance')) return 'beam';
  return 'bolt';
}

function isTrackingProjectileWeapon(weapon = getWeapon()) {
  return weapon?.type === 'Torpedo' || weapon?.type === 'Heavy' || weapon?.type === 'Turret';
}

function getProjectileTurnRate(weapon = getWeapon(), owner = 'player') {
  if (!isTrackingProjectileWeapon(weapon)) return 0;
  const base = owner === 'player' ? 2.7 : owner === 'station' ? 2.4 : 1.8;
  return base;
}

function isCloakingDevice(weapon = getWeapon()) {
  return Number(weapon?.id) === CLOAK_DEVICE_WEAPON_ID || String(weapon?.name || '').toLowerCase().includes('cloaking');
}

function isTractorBeamWeapon(weapon = getWeapon()) {
  return Number(weapon?.id) === TRACTOR_BEAM_WEAPON_ID || String(weapon?.name || '').toLowerCase().includes('tractor');
}

function isEngineDisruptorWeapon(weapon = getWeapon()) {
  return Number(weapon?.id) === ENGINE_DISRUPTOR_WEAPON_ID || String(weapon?.name || '').toLowerCase().includes('engine disruptor');
}

function isThaleronGeneratorWeapon(weapon = getWeapon()) {
  const name = String(weapon?.name || '').toLowerCase();
  return Number(weapon?.id) === THALERON_GENERATOR_WEAPON_ID || name.includes('thaleron') || name.includes('thalaron');
}

function isCuttingBeamWeapon(weapon = getWeapon()) {
  return Number(weapon?.id) === CUTTING_BEAM_WEAPON_ID || String(weapon?.name || '').toLowerCase().includes('cutting beam');
}

function isWeaponSlotCloakingDevice(slot = 1) {
  normalizeWeaponLoadout();
  const slotIndex = clamp(Math.round(Number(slot) || 1), 1, 3) - 1;
  const weaponId = state.weaponSlots?.[slotIndex];
  return weaponId ? isCloakingDevice(getWeapon(weaponId)) : false;
}

function getActiveTractorBeamForNpc(npc, now = performance.now()) {
  if (!npc?.id) return null;
  return (state.tractorBeams || []).find((beam) => (
    beam.targetType === 'ship'
    && beam.targetId === npc.id
    && finiteNumber(beam.expiresAt, 0) > now
  )) || null;
}

function isNpcTractorHeld(npc, now = performance.now()) {
  return Boolean(getActiveTractorBeamForNpc(npc, now));
}

function getWeaponSpriteFile(weapon = getWeapon()) {
  const name = String(weapon?.name || '').toLowerCase();
  const type = String(weapon?.type || '').toLowerCase();
  if (type === 'torpedo' || type === 'heavy') {
    if (name.includes('plasma')) return 'torpedo-plasma.png';
    if (name.includes('polaron')) return 'torpedo-polaron.png';
    if (name.includes('quantum') || name.includes('tachyon')) return 'torpedo-quantum.png';
    if (name.includes('gravimetric') || name.includes('subspace')) return 'torpedo-gravimetric.png';
    if (name.includes('photon') || name.includes('transphasic') || name.includes('magnetorp')) return 'torpedo-photon.png';
    return 'torpedo-photon.png';
  }
  if (name.includes('tractor') || name.includes('cloak') || name.includes('engine disruptor') || type === 'device') return 'tractor.png';
  if (name.includes('compression') || name.includes('wave') || name.includes('subspace') || name.includes('biobeam')) return 'compressionwave.png';
  if (name.includes('plasma')) return 'plasmaphaser.png';
  if (name.includes('polaron')) return 'polaron.png';
  if (name.includes('vortex') || name.includes('particle') || name.includes('proton')) return 'purple.png';
  if (name.includes('quantum') || name.includes('tachyon') || name.includes('transphasic') || type === 'heavy') return 'pulse3.png';
  if (name.includes('dual') || name.includes('turret')) return 'pulse2.png';
  if (type === 'cannon' || type === 'torpedo') return 'pulse1.png';
  return 'phaser.png';
}

function isPlayerCloaked(now = performance.now()) {
  return Boolean(state.cloak?.active && now - state.cloak.startedAt < state.cloak.duration);
}

function setPlayerCloak(active, now = performance.now(), silent = false) {
  if(active)stopEW(ensureActorEW(state),true);
  const cloakSettings = getCloakItemSettings();
  state.cloak.active = Boolean(active);
  state.cloak.startedAt = active ? now : 0;
  state.cloak.duration = finiteNumber(cloakSettings.durationMs, CLOAK_DURATION_MS);
  if (active) {
    state.combatTargetId = null;
    state.combatTargetType = 'ship';
    state.projectiles = state.projectiles.filter((shot) => shot.guidance === 'home-on-jam' || shot.pointAim || !(shot.targetType === 'player' || shot.owner !== 'player' && !shot.targetId));
    playGameSound('cloak', { cooldownKey: 'cloak:player' });
    if (!silent) setLog('Cloaking device engaged. Enemy sensors have lost your ship.');
  } else if (!silent) {
    playGameSound('cloak', { cooldownKey: 'cloak:player' });
    setLog('Cloaking device disengaged.');
  }
  updateStats();
}

function updateCloakState(now = performance.now()) {
  if (!state.cloak?.active) return;
  if (getPowerDist('reserve') >= 10) {
    state.cloak.startedAt = now;
    return;
  }
  if (now - state.cloak.startedAt >= state.cloak.duration) {
    setPlayerCloak(false, now);
    setLog('Cloaking field collapsed.');
  }
}

function getPlayerCloakAlpha(now = performance.now()) {
  if (!state.cloak?.active) return 1;
  const cloakSettings = getCloakItemSettings();
  const age = now - state.cloak.startedAt;
  const remaining = state.cloak.duration - age;
  const fadeMs = Math.max(1, finiteNumber(cloakSettings.fadeMs, CLOAK_FADE_MS));
  const fadeIn = clamp(age / fadeMs, 0, 1);
  const fadeOut = clamp(remaining / fadeMs, 0, 1);
  const cloakStrength = Math.min(fadeIn, fadeOut);
  return 1 - cloakStrength * 0.72;
}

function getProjectileSpriteFile(shot = {}) {
  const weapon = shot.weaponId ? getWeapon(shot.weaponId) : null;
  if (weapon) return getWeaponSpriteFile(weapon);
  if (shot.kind === 'torpedo') return 'torpedo-photon.png';
  if (shot.kind === 'bolt') return 'pulse1.png';
  return 'phaser.png';
}

function getWeaponBarrelCount(weapon = getWeapon(), projectileKind = 'bolt') {
  if (projectileKind !== 'bolt') return 1;
  const name = String(weapon.name || '').toLowerCase();
  const icon = String(weapon.icon || '').toLowerCase();
  if (name.includes('dual') || icon.includes('dual')) return 2;
  return 1;
}

function hasWeaponDefinition(id) {
  return WEAPON_CATALOG.some((weapon) => weapon.id === Number(id));
}

function isCombatWeapon(weapon = null) {
  return Boolean(weapon && finiteNumber(weapon.damage, 0) > 0 && !isCloakingDevice(weapon) && !isTractorBeamWeapon(weapon));
}

function getStationWeaponIds(station = {}) {
  const stationTypeId = Number(station.stationTypeId);
  const stats = getShipStats(stationTypeId);
  const manifestWeapons = [
    ...(Array.isArray(stats.stationWeaponIds) ? stats.stationWeaponIds : []),
    ...(Array.isArray(stats.weaponIds) ? stats.weaponIds : []),
  ]
    .map((weaponId) => Number(weaponId))
    .filter((weaponId, index, arr) => (
      weaponId > 0
      && hasWeaponDefinition(weaponId)
      && arr.indexOf(weaponId) === index
    ));
  if (manifestWeapons.length) return manifestWeapons;
  return (state.originalStationWeaponSlots?.[stationTypeId] || [])
    .filter((weaponId) => hasWeaponDefinition(weaponId));
}

function getStationDefenseTier(stationStats = {}) {
  const name = String(stationStats.name || '').toLowerCase();
  const sizeClass = String(stationStats.sizeClass || '').toLowerCase();
  if (name.includes('dyson')) return 1.65;
  if (name.includes('starbase') || sizeClass.includes('starbase')) return 1.35;
  if (name.includes('defense') || sizeClass.includes('defense')) return 1.18;
  if (name.includes('shipyard')) return 0.95;
  if (name.includes('comm') || name.includes('wormhole') || name.includes('maintenance')) return 0.82;
  if (name.includes('bar') || name.includes('waterpark') || name.includes('ore') || name.includes('habitat') || name.includes('university')) return 0.55;
  return 0.72;
}

function getStationDefenseProfile(station = {}) {
  const stats = getShipStats(station.stationTypeId);
  const hull = Math.max(0, finiteNumber(stats.hull, 0));
  const shields = Math.max(0, finiteNumber(stats.shields, 0));
  const mass = Math.max(1, finiteNumber(stats.mass, 1));
  const tier = getStationDefenseTier(stats);
  const power = Math.min(STATION_MAX_DEFENSE_POWER, hull + shields);
  const weapons = getStationWeaponIds(station)
    .map((weaponId) => getWeapon(weaponId))
    .filter((weapon) => isCombatWeapon(weapon));
  const activeWeapons = weapons.length ? weapons : [getWeapon(DEFAULT_WEAPON_ID)];
  const fastestCooldown = Math.min(...activeWeapons.map((weapon) => finiteNumber(weapon.cooldown, STATION_WEAPON_COOLDOWN_MS)));
  const longestWeaponRange = Math.max(...activeWeapons.map((weapon) => finiteNumber(weapon.range, STATION_DEFENSE_RANGE)));
  const strongestDamage = Math.max(...activeWeapons.map((weapon) => finiteNumber(weapon.damage, STATION_WEAPON_DAMAGE)));
  const multiWeaponBonus = activeWeapons.length > 1 ? 0.82 : 1.05;
  const damageMultiplier = clamp(0.55 + tier * 0.42 + Math.sqrt(power) / 240 + activeWeapons.length * 0.06, 0.58, 1.65);
  const roleDamageScale = clamp(0.62 + tier * 0.42, 0.55, 1.22);
  return {
    weaponIds: activeWeapons.map((weapon) => weapon.id),
    range: Math.round(clamp(longestWeaponRange * (0.78 + tier * 0.13) + Math.sqrt(power) * 1.2 + mass * 10, 520, 1250)),
    cooldown: Math.round(clamp(fastestCooldown * multiWeaponBonus + (0.95 - tier) * 260 - (tier - 0.7) * 60, STATION_MIN_WEAPON_COOLDOWN_MS, 1400)),
    damage: Math.max(STATION_WEAPON_DAMAGE, Math.round(strongestDamage * damageMultiplier * roleDamageScale)),
  };
}

function getWeaponPrice(weapon) {
  return Math.max(0, Math.round(finiteNumber(weapon?.price, 0)));
}

function getWeaponStockForFaction(faction = state.systemFaction) {
  const factionStock = WEAPON_CATALOG.filter((weapon) => weapon.stockFactions?.includes(faction));
  if (factionStock.length) return factionStock;
  return WEAPON_CATALOG.filter((weapon) => weapon.stockFactions?.includes('neutral') || weapon.id <= 2);
}

function getStationWeaponStock(station = getCurrentDockedStation()) {
  if (station?.weaponStockIds?.length) {
    const localStock = station.weaponStockIds
      .map((id) => getWeapon(id))
      .filter(Boolean);
    if (localStock.length) return [...new Map(localStock.map((weapon) => [weapon.id, weapon])).values()];
  }
  const stock=getWeaponStockForFaction(station?.faction || state.systemFaction).slice(0,4);
  if(station&&/shipyard|research|science|university|starbase|military/i.test(getShipStats(station.stationTypeId).name||''))stock.push(getWeapon(HOJ_WEAPON_ID));
  return stock;
}

function getHojPurchaseDecision(station=getCurrentDockedStation()) {
  const owner=station?getStationOwner(station):null;
  const faction=owner===PLAYER_SIDE?getPlayerFlag():owner?.startsWith('private:')?'neutral':owner;
  const requirement=getConfiguredPurchaseTierThresholds()?.respected??PURCHASE_TIER_STANDING.respected;
  const standing=faction?getFactionStanding(faction):0;
  const service=station&&!station.destroyed&&!station.underConstruction&&/shipyard|research|science|university|starbase|military/i.test(getShipStats(station.stationTypeId).name||'');
  const blocked=owner?getSecurityDockingBlock(owner):null;
  const reason=!state.docked?'Dock at a weapons vendor':!service?'Military or science weapons service required':blocked?String(blocked):standing<requirement?`Requires ${requirement} ${formatFaction(faction)} standing; yours ${standing}`:null;
  return {canBuy:!reason,reason,requirement,standing,faction};
}

function getAuthoredShipWeaponSlots(shipId) {
  const ship = getShipStats(shipId);
  if (Array.isArray(ship.defaultWeaponSlots)) return ship.defaultWeaponSlots;
  // BM2 item rows use source IDs, not the remaster's collision-free hull IDs.
  const sourceId = ship.sourceGame === 'BM2' ? ship.legacySourceId : ship.id;
  return state.originalShipWeaponSlots?.[Number(sourceId)];
}

function getDefaultWeaponId(shipId = state.playership, faction = getShipFaction(shipId), combatOnly = false) {
  const authored = getAuthoredShipWeaponSlots(shipId);
  const originalSlot = authored?.find((weaponId) => (
    weaponId
    && getWeapon(weaponId).minMass <= Math.max(1, finiteNumber(getShipStats(shipId).mass, 1))
    && (!combatOnly || isCombatWeapon(getWeapon(weaponId)))
  ));
  if (originalSlot) return originalSlot;
  // An explicit loadout (including three empty slots) is authoritative.
  if (Array.isArray(getShipStats(shipId).defaultWeaponSlots)) return null;
  const byFaction = {
    dominion: 11,
    romulan: 5,
    klingon: 7,
    cardassian: 9,
    breen: 16,
    vulcan: 14,
    ferengi: 10,
    tholian: 16,
    pirate: 18,
    terran: 2,
  };
  const candidate = byFaction[faction] || DEFAULT_WEAPON_ID;
  return isCombatWeapon(getWeapon(candidate))
    && getWeapon(candidate).minMass <= Math.max(1, finiteNumber(getShipStats(shipId).mass, 1))
    ? candidate
    : DEFAULT_WEAPON_ID;
}

function getOriginalShipWeaponSlots(shipId = state.playership) {
  const mass = Math.max(1, finiteNumber(getShipStats(shipId).mass, 1));
  const originalSlots = getAuthoredShipWeaponSlots(shipId) || [];
  const slots = [0, 1, 2].map((index) => {
    const weaponId = Number(originalSlots[index]);
    if (!weaponId || !hasWeaponDefinition(weaponId)) return null;
    return getWeapon(weaponId).minMass <= mass ? weaponId : null;
  });
  if (!slots.some(Boolean)) slots[0] = getDefaultWeaponId(shipId);
  return slots;
}

function applyShipDefaultWeapons(shipId = state.playership, preserveInventory = false) {
  const slots = getOriginalShipWeaponSlots(shipId);
  const defaults = slots.filter(Boolean);
  const preserved = preserveInventory ? state.weaponInventory || [] : [];
  const inventoryLimit = state.godMode ? WEAPON_CATALOG.length : getWeaponInventoryLimit();
  state.weaponInventory = [...defaults, ...preserved]
    .filter((weaponId) => hasWeaponDefinition(weaponId))
    .slice(0, inventoryLimit);
  state.weaponSlots = slots;
  state.equippedWeaponId = state.weaponSlots.find(Boolean) || null;
  normalizeWeaponLoadout();
}

function normalizeWeaponLoadout() {
  const godMode = Boolean(state.godMode);
  const inventoryLimit = godMode ? WEAPON_CATALOG.length : getWeaponInventoryLimit();
  const mass = Math.max(1, finiteNumber(getShipStats().mass, 1));
  const inventory = Array.isArray(state.weaponInventory) ? state.weaponInventory : getOriginalShipWeaponSlots().filter(Boolean);
  const valid = inventory
    .map((id) => Number(id))
    .filter((id) => hasWeaponDefinition(id));
  state.weaponInventory = valid.slice(0, inventoryLimit);
  const savedSlots = Array.isArray(state.weaponSlots) ? state.weaponSlots : getOriginalShipWeaponSlots();
  const usedCounts = {};
  state.weaponSlots = [0, 1, 2].map((index) => {
    const weaponId = Number(savedSlots[index]);
    if (!weaponId || !state.weaponInventory.includes(weaponId) || (!godMode && getWeapon(weaponId).minMass > mass)) {
      return null;
    }
    if ((usedCounts[weaponId] || 0) >= countOwnedWeapon(weaponId)) return null;
    usedCounts[weaponId] = (usedCounts[weaponId] || 0) + 1;
    return weaponId;
  });
  state.weaponLastFiredAt = Array.isArray(state.weaponLastFiredAt) ? state.weaponLastFiredAt.slice(0, 3) : [0, 0, 0];
  while (state.weaponLastFiredAt.length < 3) state.weaponLastFiredAt.push(0);
  state.equippedWeaponId = state.weaponSlots.find(Boolean) || null;
}

function countOwnedWeapon(weaponId) {
  return (state.weaponInventory || []).filter((ownedId) => Number(ownedId) === Number(weaponId)).length;
}

function countLoadedWeapon(weaponId, exceptSlotIndex = -1) {
  return (state.weaponSlots || []).filter((loadedWeaponId, index) => (
    index !== exceptSlotIndex && Number(loadedWeaponId) === Number(weaponId)
  )).length;
}

function canLoadWeaponIntoSlot(weaponId, slot = 1) {
  const weapon = getWeapon(weaponId);
  const slotIndex = clamp(Math.round(Number(slot) || 1), 1, 3) - 1;
  if (!state.godMode && state.mymass < weapon.minMass) return false;
  if (Number(state.weaponSlots[slotIndex]) === weapon.id) return false;
  return countOwnedWeapon(weapon.id) > 0;
}

function buyWeapon(weaponId) {
  if (state.gameOver || !state.gameStarted) return;
  if (!requireDocked()) return;
  if (!getCurrentDockedStation()) {
    setLog('Weapons are sold from station stores.');
    return;
  }
  const weapon = getWeapon(weaponId);
  const wStation = getCurrentDockedStation();
  if(weapon.guidance==='home-on-jam'){const decision=getHojPurchaseDecision(wStation);if(!decision.canBuy){setLog(decision.reason);return;}}
  const wRefusal = weapon.guidance==='home-on-jam' ? null : serviceRefusal((wStation && wStation.faction) || getSystemFaction(state.currentPlanet));
  if (wRefusal) {
    setLog(wRefusal);
    return;
  }
  if (!getStationWeaponStock().some((stockWeapon) => stockWeapon.id === weapon.id)) {
    setLog(`${weapon.name} is not stocked here.`);
    return;
  }
  if (!state.godMode && state.mymass < weapon.minMass) {
    setLog(`${weapon.name} needs a mass ${weapon.minMass}+ ship.`);
    return;
  }
  if (!state.godMode && state.weaponInventory.length >= getWeaponInventoryLimit()) {
    setLog('Weapon inventory is full.');
    return;
  }
  const price = getWeaponPrice(weapon);
  if (state.latinum < price) {
    setLog(`Need ${price} latinum to buy ${weapon.name}.`);
    return;
  }
  state.latinum -= price;
  state.weaponInventory.push(weapon.id);
  playGameSound('purchase', { cooldownKey: `purchase:weapon:${weapon.id}` });
  const emptySlot = state.weaponSlots.findIndex((slotWeaponId, index) => !slotWeaponId && canLoadWeaponIntoSlot(weapon.id, index + 1));
  if (emptySlot >= 0) {
    loadWeaponSlot(weapon.id, emptySlot + 1);
    setLog(`Purchased ${weapon.name} and loaded it into slot ${emptySlot + 1}.`);
  } else {
    setLog(`Purchased ${weapon.name}. Assign it from the ship inventory panel.`);
  }
  updateStats();
}

function loadWeaponSlot(weaponId, slot = 1) {
  const weapon = getWeapon(weaponId);
  if (!state.weaponInventory.includes(weapon.id)) {
    setLog(`${weapon.name} is not in your weapon inventory.`);
    return false;
  }
  if (!state.godMode && state.mymass < weapon.minMass) {
    setLog(`${weapon.name} needs a mass ${weapon.minMass}+ ship.`);
    return false;
  }
  const slotIndex = clamp(Math.round(Number(slot) || 1), 1, 3) - 1;
  if (Number(state.weaponSlots[slotIndex]) === weapon.id) {
    setLog(`${weapon.name} is already loaded in weapon slot ${slotIndex + 1}.`);
    return false;
  }
  let movedFromSlot = -1;
  if (countLoadedWeapon(weapon.id, slotIndex) >= countOwnedWeapon(weapon.id)) {
    movedFromSlot = state.weaponSlots.findIndex((loadedWeaponId, index) => (
      index !== slotIndex && Number(loadedWeaponId) === weapon.id
    ));
    if (movedFromSlot >= 0) {
      state.weaponSlots[movedFromSlot] = null;
    }
  }
  state.weaponSlots[slotIndex] = weapon.id;
  state.equippedWeaponId = state.weaponSlots[0] || weapon.id;
  playGameSound('uiConfirm', { cooldownKey: 'weapon:load' });
  setLog(movedFromSlot >= 0
    ? `${weapon.name} moved from weapon slot ${movedFromSlot + 1} to slot ${slotIndex + 1}.`
    : `${weapon.name} loaded into weapon slot ${slotIndex + 1}.`);
  updateStats();
  return true;
}

function openWeaponsLocker() {
  if (!state.gameStarted) return;
  openHudTemporarily(3200);
  state.topLeftTab = 'inventory';
  state.topLeftPanelOpen = true;
  renderTopLeftPanel();
  setLog(state.docked
    ? 'Weapon locker is in Inventory. Station weapons are sold in Market.'
    : 'Weapon locker is in Inventory. Dock at a station to buy more weapons.');
}

function getCurrentDockedStation() {
  if (!state.dockedStationId) return null;
  return state.stations.find((station) => station.id === state.dockedStationId && !station.destroyed) || null;
}

function getShipyardStockContext(station = getCurrentDockedStation()) {
  const planet = state.planets[state.currentPlanet] || {};
  const stationStats = station ? getShipStats(station.stationTypeId) : null;
  const stationName = String(stationStats?.name || station?.name || '').toLowerCase();
  const market = clamp(finiteNumber(planet.market, 8), 4, 22);
  const isHeavy = stationName.includes('heavy') || stationName.includes('starbase');
  const isShipyard = stationName.includes('shipyard') || isHeavy;
  const stationBonus = isHeavy ? 95000 : isShipyard ? 42000 : station ? 22000 : 0;
  const massBonus = isHeavy ? 4 : isShipyard ? 2 : station ? 1 : 0;
  return {
    planet,
    station,
    stationName,
    localFaction: station?.faction || state.systemFaction || getSystemFaction(state.currentPlanet),
    market,
    seedBase: (state.currentPlanet + 1) * 1009 + Math.round(finiteNumber(station?.stationTypeId, 0)) * 37 + Math.round(finiteNumber(station?.offsetX, 0)),
    maxPrice: Math.round(clamp(6500 + market * market * 520 + stationBonus, 9000, isHeavy ? 260000 : 185000)),
    maxMass: clamp(1 + Math.floor(market / 4) + massBonus, 1, isHeavy ? 10 : 8),
    stockSize: SHIPYARD_STOCK_SIZE,
  };
}

function isFactionShipStockEligible(shipFaction, localFaction) {
  if (!shipFaction || shipFaction === 'neutral') return true;
  if (!localFaction || localFaction === 'neutral') return true;
  if (shipFaction === localFaction) return true;
  const relation = getFactionRelations(localFaction);
  return Boolean(relation.friendly?.includes(shipFaction));
}

function scoreShipyardStock(ship, context) {
  const id = Number(ship.id);
  const shipFaction = getShipFaction(id);
  const price = getShipPrice(ship);
  const mass = Math.max(1, finiteNumber(ship.mass, 1));
  const factionScore = shipFaction === context.localFaction ? 0 : shipFaction === 'neutral' ? 0.42 : 0.72;
  const priceScore = Math.abs(price - context.maxPrice * 0.58) / Math.max(1, context.maxPrice);
  const massScore = Math.max(0, mass - context.maxMass) * 0.8;
  const seedScore = seeded(context.seedBase + id * 53);
  return factionScore + priceScore + massScore + seedScore * 0.92;
}

function getShipyardStock(station = getCurrentDockedStation()) {
  const purchaseContext = buildPurchaseContext(getCurrentPurchaseVendor(station));
  const stockEligible = (ship) => !state.shipCatalog || state.shipCatalog.eligibleForStock(ship.id, purchaseContext);
  const ships = Object.values(state.shipStatsById)
    .filter((ship) => ship && ship.assetType === 'ship')
    .filter((ship) => ship.rosterState !== 'retired' && ship.rosterState !== 'prototype' && !isUnbalancedPrototype(ship))
    .filter(stockEligible)
    .filter((ship) => getShipPrice(ship) > 0);
  // Blender's planetary market is the invasion-remnant inventory, not a generic
  // price-ranked shop. The catalog's regional rule limits it to scouts/fighters.
  if (!station && getCurrentSystemName().toLowerCase() === 'blender') {
    return ships.filter(ship => ship.faction === 'dominion').sort((a, b) => getShipPrice(a) - getShipPrice(b));
  }
  if (station?.stockIds?.length) {
    const localStock = station.stockIds
      .map((id) => state.shipStatsById[resolveShipId(id)])
      .filter((ship) => ship && ship.assetType === 'ship' && getShipPrice(ship) > 0)
      .filter((ship) => ship.rosterState !== 'retired' && ship.rosterState !== 'prototype' && !isUnbalancedPrototype(ship))
      .filter(stockEligible);
    return [...new Map(localStock.map(ship => [ship.id, ship])).values()].slice(0, SHIPYARD_STOCK_SIZE);
  }
  const context = getShipyardStockContext(station);
  let stock = ships
    .filter((ship) => {
      const price = getShipPrice(ship);
      const mass = Math.max(1, finiteNumber(ship.mass, 1));
      const faction = getShipFaction(ship.id);
      return price <= context.maxPrice
        && mass <= context.maxMass
        && isFactionShipStockEligible(faction, context.localFaction);
    });
  if (stock.length < 4) {
    stock = ships
      .filter((ship) => getShipPrice(ship) <= context.maxPrice * 1.25 && Math.max(1, finiteNumber(ship.mass, 1)) <= context.maxMass + 1
        && isFactionShipStockEligible(getShipFaction(ship.id), context.localFaction));
  }
  return stock
    .sort((a, b) => scoreShipyardStock(a, context) - scoreShipyardStock(b, context))
    .slice(0, context.stockSize)
    .sort((a, b) => getShipPrice(a) - getShipPrice(b));
}

// Authority: does the player's side hold this system? Flying the same flag as the holder is not
// control (see hasFactionAccessAt for the privileges a shared flag does grant).
function isSystemControlled(systemIndex = state.currentPlanet) {
  return getSystemControl(systemIndex).playerControlled;
}
// Faction privileges: a world held by the faction whose flag the player currently flies extends
// commercial/construction access (buying fleet ships, building private stations). It does not
// make the world, its installations or its forces the player's.
function hasFactionAccessAt(systemIndex = state.currentPlanet) {
  const control = getSystemControl(systemIndex);
  if (control.playerControlled) return true;
  const flag = getPlayerFlag();
  return isRecognizedFactionKey(flag) && control.controller === flag;
}

function markSystemVisited(systemIndex = state.currentPlanet) {
  const index = Number(systemIndex);
  if (!Number.isFinite(index)) return;
  if (!state.visitedSystems.includes(index)) state.visitedSystems.push(index);
}

function countPlayerBuiltStations(systemIndex = state.currentPlanet) {
  return state.playerBuiltStations.filter((station) => Number(station.systemIndex) === Number(systemIndex)).length;
}

function getStationConstructionDays(stationStats = {}) {
  const cost = getStationBuildCost(stationStats);
  const defense = finiteNumber(stationStats.hull, 0) + finiteNumber(stationStats.shields, 0);
  if (cost >= 500000 || defense >= 1200) return STATION_CONSTRUCTION_DAYS + 4;
  if (cost >= 150000 || defense >= 500) return STATION_CONSTRUCTION_DAYS + 2;
  return STATION_CONSTRUCTION_DAYS;
}

function getStationConstructionProgress(station = {}) {
  if (!station.underConstruction) return 1;
  const total = Math.max(1, finiteNumber(station.constructionDays, STATION_CONSTRUCTION_DAYS));
  const started = finiteNumber(station.constructionStartedDay, state.day);
  return clamp((state.day - started) / total, 0, 1);
}

function getStationConstructionRemaining(station = {}) {
  if (!station.underConstruction) return 0;
  const total = Math.max(1, finiteNumber(station.constructionDays, STATION_CONSTRUCTION_DAYS));
  const started = finiteNumber(station.constructionStartedDay, state.day);
  return Math.max(0, Math.ceil(total - (state.day - started)));
}

function completeDueStationConstructions(options = {}) {
  let completed = 0;
  state.playerBuiltStations = (state.playerBuiltStations || []).map((station) => {
    if (!station.underConstruction || getStationConstructionProgress(station) < 1) return station;
    completed += 1;
    return {
      ...station,
      underConstruction: false,
      condition: 100,
      completedDay: state.day,
    };
  });
  if (!completed) return 0;
  syncPlayerBuiltStationDefinitions();
  applySystemState(state.currentPlanet);
  if (!options.silent) {
    setLog(`${completed} station construction project${completed === 1 ? '' : 's'} completed while you were away.`);
  }
  return completed;
}

function getStationBuildCost(stationStats) {
  const baseCost = Math.max(0, finiteNumber(stationStats?.cost, 0));
  const defenseValue = Math.max(0, finiteNumber(stationStats?.hull, 0) + finiteNumber(stationStats?.shields, 0));
  const defenseFloor = defenseValue >= 500 ? defenseValue * 20 : 0;
  return Math.round(Math.max(5000, baseCost, defenseFloor));
}

function getStationDuraniumCost(stationStats) {
  const baseCost = Math.max(0, finiteNumber(stationStats?.cost, 0));
  const defenseValue = Math.max(0, finiteNumber(stationStats?.hull, 0) + finiteNumber(stationStats?.shields, 0));
  return Math.round(clamp(18 + baseCost / 260 + defenseValue / 55, 20, 360));
}

function getBuildableStationTypes() {
  const seen = new Set();
  return Object.values(state.shipStatsById)
    .filter((station) => station && station.assetType === 'station')
    .filter((station) => {
      const id = Number(station.id);
      if (!Number.isFinite(id) || seen.has(id)) return false;
      seen.add(id);
      return getStationBuildCost(station) > 0;
    })
    .sort((a, b) => getStationBuildCost(a) - getStationBuildCost(b));
}

function normalizeStationPlans() {
  const validPlanIds = new Set(getBuildableStationTypes().map((station) => Number(station.id)));
  state.stationPlans = [...new Set((state.stationPlans || [])
    .map((id) => Number(id))
    .filter((id) => Number.isFinite(id) && validPlanIds.has(id)))]
    .sort((a, b) => getStationBuildCost(state.shipStatsById[a]) - getStationBuildCost(state.shipStatsById[b]));
  return state.stationPlans;
}

function hasStationPlan(stationTypeId) {
  return normalizeStationPlans().includes(Number(stationTypeId));
}

function getOwnedStationPlanTypes() {
  return normalizeStationPlans()
    .map((id) => state.shipStatsById[id])
    .filter((station) => station && station.assetType === 'station');
}

function getStationPlanCost(stationStats) {
  const buildCost = getStationBuildCost(stationStats);
  const mass = Math.max(1, finiteNumber(stationStats?.mass, 1));
  return Math.round(Math.max(900, buildCost * 0.18 + mass * 120));
}

function isCommonStationPlan(stationStats) {
  const name = String(stationStats?.name || '').toLowerCase();
  const sizeClass = String(stationStats?.sizeClass || '').toLowerCase();
  return name.includes('trade')
    || name.includes('bar')
    || name.includes('ore')
    || name.includes('maintenance')
    || name.includes('habitat')
    || name.includes('defense platform')
    || sizeClass.includes('commerce')
    || sizeClass.includes('utility')
    || sizeClass.includes('habitat')
    || sizeClass.includes('defense');
}

function getStationPlanStockContext(station = getCurrentDockedStation()) {
  const shipyardContext = getShipyardStockContext(station);
  const stationName = shipyardContext.stationName || '';
  const isResearch = stationName.includes('research') || stationName.includes('university') || stationName.includes('lab');
  const isIndustrial = stationName.includes('shipyard') || stationName.includes('starbase') || stationName.includes('maintenance') || stationName.includes('ore');
  const isHeavy = stationName.includes('heavy') || stationName.includes('starbase');
  return {
    ...shipyardContext,
    maxBuildCost: Math.round(clamp(
      9000 + shipyardContext.market * shipyardContext.market * 620 + (isResearch ? 90000 : 0) + (isIndustrial ? 150000 : 0) + (isHeavy ? 500000 : 0),
      18000,
      isHeavy ? 1800000 : isIndustrial ? 850000 : 420000,
    )),
    stockSize: isHeavy ? 7 : isIndustrial ? 6 : isResearch ? 5 : 4,
    isResearch,
    isIndustrial,
    isHeavy,
  };
}

function isStationPlanStockEligible(stationStats, context) {
  const planFaction = getShipFaction(stationStats.id);
  if (isCommonStationPlan(stationStats)) return true;
  if (planFaction === state.playerFaction) return true;
  return isFactionShipStockEligible(planFaction, context.localFaction);
}

function scoreStationPlanStock(stationStats, context) {
  const id = Number(stationStats.id);
  const planFaction = getShipFaction(id);
  const buildCost = getStationBuildCost(stationStats);
  const factionScore = planFaction === context.localFaction ? 0 : planFaction === state.playerFaction ? 0.2 : planFaction === 'neutral' ? 0.38 : 0.82;
  const purposeScore = isCommonStationPlan(stationStats) ? -0.2 : 0;
  const priceScore = Math.abs(buildCost - context.maxBuildCost * 0.42) / Math.max(1, context.maxBuildCost);
  const seedScore = seeded(context.seedBase + id * 71);
  return factionScore + purposeScore + priceScore + seedScore * 0.88;
}

function isLocalFactionIndustrialPlan(stationStats, context) {
  const name = String(stationStats?.name || '').toLowerCase();
  const sizeClass = String(stationStats?.sizeClass || '').toLowerCase();
  const planFaction = getShipFaction(stationStats?.id);
  return context.isIndustrial
    && planFaction === context.localFaction
    && (
      name.includes('shipyard')
      || name.includes('starbase')
      || sizeClass.includes('shipyard')
      || sizeClass.includes('starbase')
    );
}

function getStationPlanStock(station = getCurrentDockedStation()) {
  const context = getStationPlanStockContext(station);
  let stock = getBuildableStationTypes()
    .filter((stationStats) => !hasStationPlan(stationStats.id))
    .filter((stationStats) => getStationBuildCost(stationStats) <= context.maxBuildCost)
    .filter((stationStats) => isStationPlanStockEligible(stationStats, context));
  if (stock.length < 3) {
    stock = getBuildableStationTypes()
      .filter((stationStats) => !hasStationPlan(stationStats.id))
      .filter((stationStats) => getStationBuildCost(stationStats) <= context.maxBuildCost * 1.25)
      .filter((stationStats) => isCommonStationPlan(stationStats) || getShipFaction(stationStats.id) === state.playerFaction || getShipFaction(stationStats.id) === 'neutral');
  }
  const priority = stock
    .filter((stationStats) => isLocalFactionIndustrialPlan(stationStats, context))
    .sort((a, b) => getStationBuildCost(a) - getStationBuildCost(b))
    .slice(0, context.stockSize);
  const priorityIds = new Set(priority.map((stationStats) => Number(stationStats.id)));
  const regular = stock
    .filter((stationStats) => !priorityIds.has(Number(stationStats.id)))
    .sort((a, b) => scoreStationPlanStock(a, context) - scoreStationPlanStock(b, context))
    .slice(0, Math.max(0, context.stockSize - priority.length));
  return [...priority, ...regular]
    .sort((a, b) => getStationPlanCost(a) - getStationPlanCost(b));
}

function getStationBuildOffset(systemIndex = state.currentPlanet) {
  const allInSystem = state.stationDefinitions.filter((station) => Number(station.systemIndex) === Number(systemIndex));
  const slot = allInSystem.length;
  const angle = seeded((systemIndex + 1) * 101 + slot * 17) * Math.PI * 2;
  const ring = Math.floor(slot / 6);
  const distance = 360 + ring * 135 + seeded((systemIndex + 1) * 53 + slot * 29) * 90;
  return {
    offsetX: Math.round(Math.cos(angle) * distance),
    offsetY: Math.round(Math.sin(angle) * distance),
    rotation: Math.round((angle * 180 / Math.PI + 90) % 360),
  };
}

function normalizeDegrees(value) {
  return ((value % 360) + 360) % 360;
}

function getStationBuildBounds() {
  return {
    minX: -STATION_BUILD_REMOTE_MARGIN,
    maxX: SYSTEM_W + STATION_BUILD_REMOTE_MARGIN,
    minY: -STATION_BUILD_REMOTE_MARGIN,
    maxY: SYSTEM_H + STATION_BUILD_REMOTE_MARGIN,
  };
}

function getDefaultStationBuildViewport(point = null) {
  const focus = point || state.systemPlanet || FLIGHT_PLANET_POSITION;
  return {
    centerX: finiteNumber(focus.x, SYSTEM_W * 0.5),
    centerY: finiteNumber(focus.y, SYSTEM_H * 0.5),
    spanX: SYSTEM_W,
    spanY: SYSTEM_H,
  };
}

function normalizeStationBuildViewport(viewport = null) {
  const bounds = getStationBuildBounds();
  const fallback = getDefaultStationBuildViewport();
  const spanX = clamp(finiteNumber(viewport?.spanX, fallback.spanX), 760, bounds.maxX - bounds.minX);
  const spanY = clamp(finiteNumber(viewport?.spanY, fallback.spanY), 520, bounds.maxY - bounds.minY);
  return {
    centerX: clamp(finiteNumber(viewport?.centerX, fallback.centerX), bounds.minX + spanX * 0.5, bounds.maxX - spanX * 0.5),
    centerY: clamp(finiteNumber(viewport?.centerY, fallback.centerY), bounds.minY + spanY * 0.5, bounds.maxY - spanY * 0.5),
    spanX,
    spanY,
  };
}

function getStationBuildViewportBounds() {
  const viewport = normalizeStationBuildViewport(state.pendingStationBuild?.viewport);
  if (state.pendingStationBuild) state.pendingStationBuild.viewport = viewport;
  return {
    minX: viewport.centerX - viewport.spanX * 0.5,
    maxX: viewport.centerX + viewport.spanX * 0.5,
    minY: viewport.centerY - viewport.spanY * 0.5,
    maxY: viewport.centerY + viewport.spanY * 0.5,
  };
}

function clampStationBuildPoint(point = {}) {
  const bounds = getStationBuildBounds();
  return {
    x: clamp(finiteNumber(point.x, SYSTEM_W * 0.5), bounds.minX, bounds.maxX),
    y: clamp(finiteNumber(point.y, SYSTEM_H * 0.5), bounds.minY, bounds.maxY),
  };
}

function getStationBuildPointFromMapEvent(event, mapEl) {
  const rect = mapEl.getBoundingClientRect();
  const bounds = getStationBuildDiagramBounds();
  const px = clamp((event.clientX - rect.left) / Math.max(1, rect.width), 0, 1);
  const py = clamp((event.clientY - rect.top) / Math.max(1, rect.height), 0, 1);
  return clampStationBuildPoint({
    x: Math.round(bounds.minX + px * (bounds.maxX - bounds.minX)),
    y: Math.round(bounds.minY + py * (bounds.maxY - bounds.minY)),
  });
}

function placePendingStationBuildFromMapEvent(event, mapEl) {
  if (!state.pendingStationBuild || !mapEl) return;
  state.pendingStationBuild.point = getStationBuildPointFromMapEvent(event, mapEl);
  state.pendingStationBuild.mapDrag = null;
  renderStationBuildModal();
  const status = getStationBuildValidation(state.pendingStationBuild.stationTypeId, state.pendingStationBuild);
  setLog(status.orbit ? `Station orbit calculated: ${formatStationOrbitSummary(status.orbit)}.` : status.reason);
}

function panStationBuildViewport(dxPixels, dyPixels, mapEl) {
  if (!state.pendingStationBuild || !mapEl) return;
  const rect = mapEl.getBoundingClientRect();
  const viewport = normalizeStationBuildViewport(state.pendingStationBuild.viewport);
  const worldDx = dxPixels / Math.max(1, rect.width) * viewport.spanX;
  const worldDy = dyPixels / Math.max(1, rect.height) * viewport.spanY;
  state.pendingStationBuild.viewport = normalizeStationBuildViewport({
    ...viewport,
    centerX: viewport.centerX - worldDx,
    centerY: viewport.centerY - worldDy,
  });
}

function zoomStationBuildViewport(delta, anchorEvent, mapEl) {
  if (!state.pendingStationBuild || !mapEl) return;
  const rect = mapEl.getBoundingClientRect();
  const before = getStationBuildPointFromMapEvent(anchorEvent, mapEl);
  const viewport = normalizeStationBuildViewport(state.pendingStationBuild.viewport);
  const factor = delta > 0 ? 1.16 : 0.86;
  const next = normalizeStationBuildViewport({
    ...viewport,
    spanX: viewport.spanX * factor,
    spanY: viewport.spanY * factor,
  });
  const px = clamp((anchorEvent.clientX - rect.left) / Math.max(1, rect.width), 0, 1);
  const py = clamp((anchorEvent.clientY - rect.top) / Math.max(1, rect.height), 0, 1);
  state.pendingStationBuild.viewport = normalizeStationBuildViewport({
    ...next,
    centerX: before.x - (px - 0.5) * next.spanX,
    centerY: before.y - (py - 0.5) * next.spanY,
  });
}

function getDynamicStationBuildOrbit(point, stationTypeId, now = performance.now()) {
  const selectedPoint = clampStationBuildPoint(point);
  const star = state.systemStar || { x: SYSTEM_W * 0.5, y: SYSTEM_H * 0.5 };
  const planet = state.systemPlanet || FLIGHT_PLANET_POSITION;
  const stationProbe = { stationTypeId: Number(stationTypeId), assetType: 'station' };
  const planetDef = state.planets[state.currentPlanet];
  const planetDistance = Math.hypot(selectedPoint.x - planet.x, selectedPoint.y - planet.y);
  const starDistance = Math.hypot(selectedPoint.x - star.x, selectedPoint.y - star.y);
  const captureDistance = getPlanetLocalOrbitCaptureDistance(planetDef, stationProbe);
  const anchor = planetDistance <= captureDistance || planetDistance < starDistance * 0.32 ? 'planet' : 'star';
  const anchorPoint = anchor === 'planet' ? planet : star;
  const minDistance = anchor === 'planet'
    ? Math.max(115, getPlanetVisualSize(planetDef) * 0.58)
    : Math.max(430, SYSTEM_STAR_CORE_RADIUS + 210);
  const rawDistance = Math.hypot(selectedPoint.x - anchorPoint.x, selectedPoint.y - anchorPoint.y);
  const angle = rawDistance > 0.001
    ? Math.atan2(selectedPoint.y - anchorPoint.y, selectedPoint.x - anchorPoint.x)
    : Math.atan2(planet.y - star.y, planet.x - star.x);
  const distance = Math.max(minDistance, rawDistance);
  const normalizedPoint = {
    x: anchorPoint.x + Math.cos(angle) * distance,
    y: anchorPoint.y + Math.sin(angle) * distance,
  };
  const anchorMass = anchor === 'planet'
    ? getPlanetMassFactor(state.planets[state.currentPlanet])
    : 16;
  const seedValue = Math.round((state.currentPlanet + 1) * 353 + Number(stationTypeId || 0) * 7 + selectedPoint.x * 0.37 + selectedPoint.y * 0.19);
  const direction = seeded(seedValue + 19) > 0.5 ? 1 : -1;
  const period = getOrbitPeriodMs(distance, anchorMass, seedValue, 'station');
  const currentAngle = finiteNumber(angle, 0);
  const phaseAngle = currentAngle - (now / period) * Math.PI * 2 * direction;
  return {
    anchor,
    anchorLabel: anchor === 'planet' ? 'Planet orbit' : 'Solar orbit',
    point: normalizedPoint,
    requestedPoint: selectedPoint,
    distance,
    angle: currentAngle,
    period,
    direction,
    phaseAngle,
    nearbyStations: state.stations.filter((station) => (
      !station.destroyed
      && Math.hypot(station.x - normalizedPoint.x, station.y - normalizedPoint.y) < Math.max(130, getStationScreenRadius(station) * 1.35)
    )).length,
  };
}

function getStationBuildPositionFromOrbit(orbit, stationTypeId, now = performance.now()) {
  const planet = state.systemPlanet || FLIGHT_PLANET_POSITION;
  const phaseAngle = finiteNumber(orbit.phaseAngle, orbit.angle - (now / Math.max(1000, orbit.period)) * Math.PI * 2 * orbit.direction);
  return {
    offsetX: Math.round(orbit.point.x - planet.x),
    offsetY: Math.round(orbit.point.y - planet.y),
    rotation: Math.round(normalizeDegrees(orbit.angle * 180 / Math.PI + 90)),
    orbitAnchor: orbit.anchor,
    orbitDistance: Math.round(orbit.distance),
    orbitAngle: phaseAngle,
    orbitAngleCurrent: orbit.angle,
    orbitPeriod: orbit.period,
    orbitDirection: orbit.direction,
    buildPointX: Math.round(orbit.requestedPoint.x),
    buildPointY: Math.round(orbit.requestedPoint.y),
    buildPlotId: 'custom',
    buildPlotLabel: formatStationOrbitSummary(orbit),
  };
}

function formatOrbitPeriod(ms) {
  const seconds = Math.max(1, finiteNumber(ms, 0) / 1000);
  const minutes = seconds / 60;
  if (minutes < 90) return `${Math.round(minutes)} min`;
  const hours = minutes / 60;
  if (hours < 36) return `${hours.toFixed(hours < 10 ? 1 : 0)} hr`;
  const days = hours / 24;
  return `${days.toFixed(days < 10 ? 1 : 0)} days`;
}

function formatStationOrbitSummary(orbit) {
  if (!orbit) return 'No orbit selected';
  const direction = orbit.direction >= 0 ? 'prograde' : 'retrograde';
  return `${orbit.anchorLabel} | radius ${Math.round(orbit.distance)} | ${formatOrbitPeriod(orbit.period)} ${direction}`;
}

function getStationBuildValidation(stationTypeId, pending = state.pendingStationBuild) {
  const stationStats = state.shipStatsById[Number(stationTypeId)];
  const orbit = pending?.point ? getDynamicStationBuildOrbit(pending.point, stationTypeId) : null;
  const price = pending?.price ?? getStationBuildCost(stationStats);
  const duraniumCost = pending?.duraniumCost ?? getStationDuraniumCost(stationStats);
  if (!stationStats || stationStats.assetType !== 'station') return { ok: false, reason: 'That station design is not available.', orbit };
  if (Number(stationTypeId) === WORMHOLE_STATION_TYPE_ID) return { ok: false, reason: 'Wormhole generators use the wormhole destination menu.', stationStats, orbit, price, duraniumCost };
  if (!state.docked) return { ok: false, reason: 'Dock before starting construction.', stationStats, orbit, price, duraniumCost };
  if (!canBuildStationsHere()) return { ok: false, reason: 'Stations can only be built in systems you control.', stationStats, orbit, price, duraniumCost };
  if (!hasStationPlan(stationTypeId)) return { ok: false, reason: `You need the ${stationStats.name} plan first.`, stationStats, orbit, price, duraniumCost };
  if (countPlayerBuiltStations(state.currentPlanet) >= MAX_PLAYER_BUILT_STATIONS_PER_SYSTEM) return { ok: false, reason: `This system can support ${MAX_PLAYER_BUILT_STATIONS_PER_SYSTEM} player-built stations, including work in progress.`, stationStats, orbit, price, duraniumCost };
  if (!orbit) return { ok: false, reason: 'Choose a build coordinate on the system chart.', stationStats, orbit, price, duraniumCost };
  if (state.latinum < price) return { ok: false, reason: `Need ${price} latinum to build ${stationStats.name}.`, stationStats, orbit, price, duraniumCost };
  if (state.duranium < duraniumCost) return { ok: false, reason: `Need ${duraniumCost} duranium to build ${stationStats.name}.`, stationStats, orbit, price, duraniumCost };
  return { ok: true, reason: `Ready: ${formatStationOrbitSummary(orbit)}.`, stationStats, orbit, price, duraniumCost };
}

function getStationBuildDiagramBounds() {
  return getStationBuildViewportBounds();
}

function isPointInStationDiagram(point, bounds, padPercent = 2) {
  const x = ((point.x - bounds.minX) / Math.max(1, bounds.maxX - bounds.minX)) * 100;
  const y = ((point.y - bounds.minY) / Math.max(1, bounds.maxY - bounds.minY)) * 100;
  return x >= -padPercent && x <= 100 + padPercent && y >= -padPercent && y <= 100 + padPercent;
}

function getStationBuildDiagramStyle(point, bounds) {
  const x = ((point.x - bounds.minX) / Math.max(1, bounds.maxX - bounds.minX)) * 100;
  const y = ((point.y - bounds.minY) / Math.max(1, bounds.maxY - bounds.minY)) * 100;
  return `left:${x.toFixed(2)}%;top:${y.toFixed(2)}%;`;
}

function getStationBuildDiagramCircleStyle(center, radius, bounds) {
  const x = clamp(((center.x - bounds.minX) / Math.max(1, bounds.maxX - bounds.minX)) * 100, -40, 140);
  const y = clamp(((center.y - bounds.minY) / Math.max(1, bounds.maxY - bounds.minY)) * 100, -40, 140);
  const width = clamp(radius * 2 / Math.max(1, bounds.maxX - bounds.minX) * 100, 2, 1800);
  const height = clamp(radius * 2 / Math.max(1, bounds.maxY - bounds.minY) * 100, 2, 1800);
  return `left:${x.toFixed(2)}%;top:${y.toFixed(2)}%;width:${width.toFixed(2)}%;height:${height.toFixed(2)}%;`;
}

function renderStationBuildModal() {
  if (!stationBuildModalEl) return;
  if (!state.pendingStationBuild) {
    stationBuildModalEl.classList.add('hidden');
    stationBuildModalEl.innerHTML = '';
    return;
  }
  const stationTypeId = Number(state.pendingStationBuild.stationTypeId);
  const status = getStationBuildValidation(stationTypeId, state.pendingStationBuild);
  const stationStats = status.stationStats || state.shipStatsById[stationTypeId] || {};
  const selectedOrbit = status.orbit || null;
  const currentName = state.planets[state.currentPlanet]?.name || 'Current System';
  const bounds = getStationBuildDiagramBounds();
  const viewport = normalizeStationBuildViewport(state.pendingStationBuild.viewport);
  const orbitAnchorPoint = selectedOrbit?.anchor === 'planet' ? state.systemPlanet : state.systemStar;
  const orbitPreview = selectedOrbit
    ? `<span class="station-plot-orbit station-selected-orbit" style="${getStationBuildDiagramCircleStyle(orbitAnchorPoint, selectedOrbit.distance, bounds)}"></span>`
    : '';
  const selectedMarker = selectedOrbit
    ? `<span class="station-placement-marker" style="${getStationBuildDiagramStyle(selectedOrbit.point, bounds)}"></span>`
    : '';
  const stationDots = state.stations.filter((station) => !station.destroyed).map((station) => (
    isPointInStationDiagram(station, bounds)
      ? `<span class="station-existing-dot ${station.underConstruction ? 'building' : ''}" style="${getStationBuildDiagramStyle(station, bounds)}"></span>`
      : ''
  )).join('');
  const starDot = isPointInStationDiagram(state.systemStar, bounds)
    ? `<span class="station-plot-star" style="${getStationBuildDiagramStyle(state.systemStar, bounds)}"></span>`
    : '';
  const planetDot = isPointInStationDiagram(state.systemPlanet, bounds)
    ? `<span class="station-plot-planet" style="${getStationBuildDiagramStyle(state.systemPlanet, bounds)}"></span>`
    : '';
  const orbitSummary = selectedOrbit ? formatStationOrbitSummary(selectedOrbit) : 'No coordinate selected';
  const customName = sanitizeStationName(state.pendingStationBuild.customName, stationStats.name || 'Station');
  const ownedPlans = getOwnedStationPlanTypes().filter((stationType) => Number(stationType.id) !== WORMHOLE_STATION_TYPE_ID);
  const planButtons = ownedPlans.map((stationType) => {
    const planId = Number(stationType.id);
    const price = getStationBuildCost(stationType);
    const duraniumCost = getStationDuraniumCost(stationType);
    const days = getStationConstructionDays(stationType);
    const active = planId === stationTypeId;
    const affordable = state.latinum >= price && state.duranium >= duraniumCost;
    return `<button class="station-plan-slot ${active ? 'active' : ''}" data-station-build-plan="${planId}" ${affordable ? '' : 'disabled'}>
      <img src="${escapeHtml(getShipPreviewSrc(planId))}" alt="">
      <span>${escapeHtml(stationType.name)}</span>
      <small>${price}L / ${duraniumCost}D / ${days}d</small>
    </button>`;
  }).join('');
  const constructionDays = getStationConstructionDays(stationStats);
  stationBuildModalEl.classList.remove('hidden');
  stationBuildModalEl.innerHTML = `<div class="ship-purchase-card station-build-dialog" role="dialog" aria-modal="true" aria-label="Station placement">
    <div class="ship-purchase-head">
      <span>STL-${String(stationTypeId || 0).padStart(2, '0')}</span>
      <button class="panel-close" data-station-build-action="cancel" aria-label="Close station construction">&times;</button>
    </div>
    <div class="ship-purchase-body station-build-body">
      <section class="station-plot-panel">
        <div class="station-build-title">
          <h2>${escapeHtml(currentName)}</h2>
          <span>${escapeHtml(stationStats.name || 'Station')}</span>
        </div>
        <div class="station-plot-map ${state.pendingStationBuild.mapDrag?.active ? 'dragging' : ''}" data-station-build-map role="button" tabindex="0" aria-label="Station build coordinate chart">
          ${orbitPreview}
          ${starDot}
          ${planetDot}
          ${stationDots}
          ${selectedMarker}
        </div>
        <div class="station-orbit-readout">${escapeHtml(orbitSummary)}</div>
      </section>
      <aside class="station-plan-rail" aria-label="Station plans">
        ${planButtons || '<div class="meta">No station plans owned.</div>'}
      </aside>
      <section class="station-build-details">
        <img class="ship-purchase-preview station-preview" src="${escapeHtml(getShipPreviewSrc(stationTypeId))}" alt="">
        <div class="ship-purchase-copy">
          <h2>${escapeHtml(stationStats.name || 'Station')}</h2>
          <p>${escapeHtml(stationStats.description || `Select a build coordinate in ${currentName}.`)}</p>
        </div>
        <label class="station-name-field">
          <span>Station Name</span>
          <input type="text" data-station-build-name maxlength="42" value="${escapeHtml(customName)}" autocomplete="off" spellcheck="false">
        </label>
        <div class="ship-purchase-grid">
          <span>Name</span><b>${escapeHtml(customName)}</b>
          <span>System</span><b>${escapeHtml(currentName)}</b>
          <span>Map Span</span><b>${Math.round(viewport.spanX)} x ${Math.round(viewport.spanY)}</b>
          <span>Coordinates</span><b>${selectedOrbit ? `${Math.round(selectedOrbit.point.x)}, ${Math.round(selectedOrbit.point.y)}` : 'Pending'}</b>
          <span>Computed Orbit</span><b>${escapeHtml(selectedOrbit?.anchorLabel || 'Pending')}</b>
          <span>Orbit Period</span><b>${escapeHtml(selectedOrbit ? formatOrbitPeriod(selectedOrbit.period) : 'Pending')}</b>
          <span>Build Time</span><b>${constructionDays} days</b>
          <span>Nearby Stations</span><b>${escapeHtml(selectedOrbit ? selectedOrbit.nearbyStations : '-')}</b>
          <span>Latinum</span><b>${escapeHtml(status.price ?? state.pendingStationBuild.price)} / ${escapeHtml(state.latinum)}</b>
          <span>Duranium</span><b>${escapeHtml(status.duraniumCost ?? state.pendingStationBuild.duraniumCost)} / ${escapeHtml(state.duranium)}</b>
        </div>
        <div class="ship-purchase-cost ${status.ok ? '' : 'blocked'}">${escapeHtml(status.reason)}</div>
      </section>
    </div>
    <div class="ship-purchase-actions">
      <button data-station-build-action="cancel">Cancel</button>
      <button data-station-build-action="confirm" ${status.ok ? '' : 'disabled'}>Start Build</button>
    </div>
  </div>`;
}

function openStationBuildModal(stationTypeId, buildCost = {}) {
  const stationStats = state.shipStatsById[Number(stationTypeId)];
  state.pendingStationBuild = {
    stationTypeId: Number(stationTypeId),
    price: buildCost.price ?? getStationBuildCost(stationStats),
    duraniumCost: buildCost.duraniumCost ?? getStationDuraniumCost(stationStats),
    customName: sanitizeStationName(stationStats?.name, 'Station'),
    nameTouched: false,
    point: null,
    viewport: getDefaultStationBuildViewport(),
    mapDrag: null,
  };
  renderStationBuildModal();
  const status = getStationBuildValidation(stationTypeId, state.pendingStationBuild);
  setLog(status.ok ? `Station orbit calculated: ${formatStationOrbitSummary(status.orbit)}.` : status.reason);
}

function closeStationBuildModal() {
  state.pendingStationBuild = null;
  renderStationBuildModal();
}

function confirmPendingStationBuild() {
  if (!state.pendingStationBuild) return;
  const stationTypeId = Number(state.pendingStationBuild.stationTypeId);
  const status = getStationBuildValidation(stationTypeId, state.pendingStationBuild);
  if (!status.ok) {
    setLog(status.reason);
    renderStationBuildModal();
    return;
  }
  const position = getStationBuildPositionFromOrbit(status.orbit, stationTypeId);
  const cameraBeforeBuild = { x: state.camera.x, y: state.camera.y };
  const constructionDays = getStationConstructionDays(status.stationStats);
  const stationName = sanitizeStationName(state.pendingStationBuild.customName, status.stationStats.name);
  const builtStation = {
    id: `built-${state.currentPlanet}-${Date.now()}-${state.playerBuiltStations.length}`,
    systemIndex: state.currentPlanet,
    stationTypeId,
    condition: 1,
    ...position,
    rawStockIds: [],
    stockIds: getStationStoreShipIds(stationTypeId, state.currentPlanet),
    weaponStockIds: getStationStoreWeaponIds(stationTypeId),
    name: stationName,
    builtByPlayer: true,
    underConstruction: true,
    constructionStartedDay: state.day,
    constructionDays,
    completedDay: null,
    faction: state.playerFaction,
  };
  state.latinum -= status.price;
  state.mylatinum = state.latinum;
  state.duranium -= status.duraniumCost;
  state.myduranium = state.duranium;
  state.playerBuiltStations.push(builtStation);
  if (!state.controlledSystems.includes(state.currentPlanet)) state.controlledSystems.push(state.currentPlanet);
  addBuiltStationToCurrentSystem(builtStation);
  state.camera.x = cameraBeforeBuild.x;
  state.camera.y = cameraBeforeBuild.y;
  closeStationBuildModal();
  playGameSound('stationBuild', { cooldownKey: `station-build:${stationTypeId}` });
  setLog(`Construction started: ${stationName}. ${formatStationOrbitSummary(status.orbit)} in ${state.planets[state.currentPlanet]?.name || 'this system'}; complete in ${constructionDays} in-game days.`);
  renderPlanetMenu();
  updateStats();
}

function getStationStoreShipIds(stationTypeId, systemIndex = state.currentPlanet) {
  const stationName = String(getShipStats(stationTypeId).name || '').toLowerCase();
  if (!stationName.includes('shipyard') && !stationName.includes('starbase')) return [];
  const context = getShipyardStockContext({
    stationTypeId,
    faction: state.playerFaction,
    offsetX: seeded((systemIndex + 1) * 211 + Number(stationTypeId)) * 900,
  });
  return Object.values(state.shipStatsById)
    .filter((ship) => ship && ship.assetType === 'ship' && getShipPrice(ship) > 0)
    .filter((ship) => ship.rosterState !== 'retired' && ship.rosterState !== 'prototype' && !isUnbalancedPrototype(ship))
    .filter((ship) => getShipPrice(ship) <= context.maxPrice && Math.max(1, finiteNumber(ship.mass, 1)) <= context.maxMass)
    .filter((ship) => getShipFaction(ship.id) === state.playerFaction || getShipFaction(ship.id) === 'neutral')
    .sort((a, b) => scoreShipyardStock(a, context) - scoreShipyardStock(b, context))
    .slice(0, SHIPYARD_STOCK_SIZE)
    .map((ship) => Number(ship.id));
}

function getStationStoreWeaponIds(stationTypeId) {
  const defensiveWeapons = getStationWeaponIds({ stationTypeId });
  if (defensiveWeapons.length) return defensiveWeapons;
  return getWeaponStockForFaction(state.playerFaction).slice(0, 4).map((weapon) => weapon.id);
}

function getPlayerFleetShips(systemIndex = state.currentPlanet) {
  return (state.playerFleet || []).filter((ship) => (
    Number(ship.systemIndex) === Number(systemIndex)
    && ship.assignment !== 'escort'
    && !ship.destroyed
  ));
}

function getPlayerEscortFleetShips() {
  return (state.playerFleet || []).filter((ship) => ship.assignment === 'escort' && !ship.destroyed);
}

function normalizePlayerFleetNames() {
  state.playerFleet = (Array.isArray(state.playerFleet) ? state.playerFleet : []).map((fleetShip, index) => {
    const shipId = Number(fleetShip.shipId);
    const faction = fleetShip.faction || state.playerFaction || getShipFaction(shipId);
    const seed = finiteNumber(fleetShip.seed, hashString(`${fleetShip.id || index}-${shipId}-${fleetShip.assignment || 'defense'}`));
    return {
      ...fleetShip,
      seed,
      faction,
      name: fleetShip.name && !isSystemDerivedShipName(fleetShip.name) && !isCrossFactionShipName(fleetShip.name, faction) ? fleetShip.name : generateShipName({
        shipId,
        faction,
        seed,
        role: fleetShip.assignment === 'escort' ? 'playerEscort' : 'playerFleet',
        id: fleetShip.id || `fleet-${index}`,
      }),
    };
  });
}

function getFleetShipCost(ship) {
  return Math.round(getShipPrice(ship) * FLEET_SHIP_PRICE_MULTIPLIER);
}

function canBuyFleetShip(shipId, systemIndex = state.currentPlanet) {
  shipId = resolveShipId(shipId);
  const ship = state.shipStatsById[Number(shipId)];
  if (!ship || ship.assetType !== 'ship') return { ok: false, reason: 'Unavailable' };
  if (!hasFactionAccessAt(systemIndex)) return { ok: false, reason: 'Control system' };
  if (getPlayerFleetShips(systemIndex).length >= MAX_PLAYER_FLEET_SHIPS_PER_SYSTEM) return { ok: false, reason: 'Fleet full' };
  const sale = getShipSaleStatus(shipId);
  if (!sale.ok) return sale;
  const cost = getFleetShipCost(ship);
  if (state.latinum < cost) return { ok: false, reason: 'Need latinum' };
  return { ok: true, reason: 'Fleet' };
}

function canBuyEscortShip(shipId, systemIndex = state.currentPlanet) {
  shipId = resolveShipId(shipId);
  const ship = state.shipStatsById[Number(shipId)];
  if (!ship || ship.assetType !== 'ship') return { ok: false, reason: 'Unavailable' };
  if (getPlayerEscortFleetShips().length >= MAX_PLAYER_ESCORT_SHIPS) return { ok: false, reason: 'Escort full' };
  const sale = getShipSaleStatus(shipId);
  if (!sale.ok) return sale;
  const cost = getFleetShipCost(ship);
  if (state.latinum < cost) return { ok: false, reason: 'Need latinum' };
  return { ok: true, reason: 'Escort' };
}

function getPlayerEmpireSystemIndexes() {
  const indexes = new Set();
  for (const index of state.controlledSystems || []) {
    const numeric = Number(index);
    if (Number.isFinite(numeric) && state.planets[numeric]) indexes.add(numeric);
  }
  state.planets.forEach((planet, index) => {
    if (isSystemControlled(index)) indexes.add(index);
  });
  return [...indexes].sort((a, b) => String(state.planets[a]?.name || '').localeCompare(String(state.planets[b]?.name || '')));
}

function getPlayerFleetNpcShips(systemIndex = state.currentPlanet, now = performance.now()) {
  const stationAnchor = state.stations.find((station) => !station.destroyed && (station.faction === state.playerFaction || station.builtByPlayer))
    || state.stations.find((station) => !station.destroyed)
    || state.systemPlanet;
  return getPlayerFleetShips(systemIndex).map((fleetShip, index) => {
    const seed = finiteNumber(fleetShip.seed, (systemIndex + 1) * 901 + index * 43);
    const angle = seeded(seed + 21) * Math.PI * 2;
    const distance = 160 + index * 42 + seeded(seed + 22) * 90;
    const spawn = {
      x: stationAnchor.x + Math.cos(angle) * distance,
      y: stationAnchor.y + Math.sin(angle) * distance,
    };
    const ship = createNpcShip({
      id: `fleet-${fleetShip.id}`,
      shipId: fleetShip.shipId,
      faction: state.playerFaction,
      attitude: 'friendly',
      hostile: false,
      seed,
      from: spawn,
      destination: {
        x: stationAnchor.x + Math.cos(angle + 0.9) * (distance + 120),
        y: stationAnchor.y + Math.sin(angle + 0.9) * (distance + 120),
      },
      destinationName: 'fleet patrol',
      role: 'playerFleet',
      fleetId: fleetShip.id,
      name: fleetShip.name && !isCrossFactionShipName(fleetShip.name, state.playerFaction)
        ? fleetShip.name
        : generateShipName({ shipId: fleetShip.shipId, faction: state.playerFaction, seed, role: 'playerFleet', id: fleetShip.id }),
    });
    restoreFleetPower(ship, fleetShip);
    ship.lastShotAt = now + 300 + seeded(seed + 13) * 900;
    return ship;
  });
}

function getPlayerEscortFormationPoint(index = 0, now = performance.now()) {
  const player = playerWorldPosition();
  const shipRadius = getShipScreenRadius(state.playership, state.ship.drawScale || 1);
  const ring = Math.floor(index / 4);
  const slot = index % 4;
  const baseAngles = [Math.PI * 0.72, Math.PI * 1.28, Math.PI * 0.42, Math.PI * 1.58];
  const angle = baseAngles[slot] + Math.sin(now * 0.00021 + index * 1.7) * 0.14;
  const distance = shipRadius + 155 + ring * 72;
  return {
    x: player.x + Math.cos(angle) * distance,
    y: player.y + Math.sin(angle) * distance,
  };
}

function getPlayerEscortNpcShips(now = performance.now()) {
  const player = playerWorldPosition();
  return getPlayerEscortFleetShips().map((fleetShip, index) => {
    const seed = finiteNumber(fleetShip.seed, (state.currentPlanet + 1) * 1301 + index * 67);
    const formation = getPlayerEscortFormationPoint(index, now);
    const spawnAngle = seeded(seed + 31) * Math.PI * 2;
    const spawnDistance = 150 + index * 38 + seeded(seed + 32) * 70;
    const ship = createNpcShip({
      id: `escort-${fleetShip.id}`,
      shipId: fleetShip.shipId,
      faction: state.playerFaction,
      attitude: 'friendly',
      hostile: false,
      seed,
      from: {
        x: player.x + Math.cos(spawnAngle) * spawnDistance,
        y: player.y + Math.sin(spawnAngle) * spawnDistance,
      },
      destination: getEscortDestination(fleetShip, index, formation, now),
      destinationName: 'player escort',
      role: 'playerEscort',
      fleetId: fleetShip.id,
      name: fleetShip.name && !isCrossFactionShipName(fleetShip.name, state.playerFaction)
        ? fleetShip.name
        : generateShipName({ shipId: fleetShip.shipId, faction: state.playerFaction, seed, role: 'playerEscort', id: fleetShip.id }),
    });
    restoreFleetPower(ship, fleetShip);
    ship.escortIndex = index;
    ship.lastShotAt = now + 250 + seeded(seed + 13) * 700;
    ship.speed = Math.max(ship.speed, 1.25);
    ship.turnRate = Math.max(ship.turnRate, Math.min(1.2, getNpcFlightProfile(fleetShip.shipId, seed).turnRate));
    return ship;
  });
}

function syncPlayerBuiltStationDefinitions() {
  state.stationDefinitions = state.stationDefinitions.filter((station) => !station.builtByPlayer);
  state.playerBuiltStations.forEach((station) => {
    state.stationDefinitions.push({ ...station, builtByPlayer: true, faction: station.faction || state.playerFaction });
  });
  state.systemStates = {};
}

function lockStationOrbitToCurrentPosition(station, star, planet, now = performance.now()) {
  const anchor = station.orbitAnchor === 'planet' ? planet : star;
  if (!anchor) return station;
  const period = Math.max(1000, finiteNumber(station.orbitPeriod, STATION_ORBIT_BASE_MS));
  const direction = finiteNumber(station.orbitDirection, 1) >= 0 ? 1 : -1;
  const angle = Math.atan2(station.y - anchor.y, station.x - anchor.x);
  station.orbitAngle = angle - (now / period) * Math.PI * 2 * direction;
  station.orbitAngleCurrent = angle;
  return station;
}

function createRuntimeStationFromDefinition(station, systemIndex = state.currentPlanet, index = state.stations.length, now = performance.now()) {
  const systemState = state.systemStates[systemIndex] || ensureSystemState(systemIndex);
  const star = systemIndex === state.currentPlanet ? state.systemStar : systemState.star;
  const planet = systemIndex === state.currentPlanet ? state.systemPlanet : systemState.planet;
  const base = systemIndex + 1;
  const stationTypeId = getStationTypeId(station);
  const typedStation = { ...station, stationTypeId };
  const visual = getStationVisualProfile(typedStation);
  const defenseProfile = getStationDefenseProfile(typedStation);
  const stationFaction = station.faction || getSystemFaction(systemIndex);
  const destroyed = Boolean(state.destroyedStations[typedStation.id]);
  const stationPoint = getStationDefinitionWorldPoint(typedStation, star, planet, now);
  const runtimeStation = {
    ...typedStation,
    x: stationPoint.x,
    y: stationPoint.y,
    faction: stationFaction,
    attitude: destroyed ? 'destroyed' : station.builtByPlayer ? 'friendly' : getFactionAttitude(stationFaction),
    hostile: false,
    destroyed,
    combatHull: null,
    maxCombatHull: null,
    combatShields: null,
    maxCombatShields: null,
    lastShieldHitAt: 0,
    drawWidth: visual.width,
    drawHeight: visual.height,
    scale: visual.scale,
    visualSnapshot: { ...visual },
    defenseRange: defenseProfile.range,
    defenseDamage: defenseProfile.damage,
    defenseCooldown: defenseProfile.cooldown,
    stationWeaponIds: typedStation.underConstruction ? [] : defenseProfile.weaponIds,
    shotIndex: 0,
    lastShotAt: seeded(base * 61 + index) * 1000,
  };
  return lockStationOrbitToCurrentPosition(withStationOrbit(runtimeStation, star, planet, base, index), star, planet, now);
}

function createLightweightRuntimeStation(station, systemIndex = state.currentPlanet, index = state.stations.length, now = performance.now()) {
  const star = state.systemStar || { x: SYSTEM_W * 0.5, y: SYSTEM_H * 0.5 };
  const planet = state.systemPlanet || FLIGHT_PLANET_POSITION;
  const base = systemIndex + 1;
  const stationTypeId = getStationTypeId(station);
  const typedStation = { ...station, stationTypeId };
  const visual = getStationVisualProfile(typedStation);
  const stationPoint = getStationDefinitionWorldPoint(typedStation, star, planet, now);
  return lockStationOrbitToCurrentPosition(withStationOrbit({
    ...typedStation,
    x: stationPoint.x,
    y: stationPoint.y,
    faction: station.faction || state.playerFaction,
    attitude: 'friendly',
    hostile: false,
    destroyed: false,
    combatHull: null,
    maxCombatHull: null,
    combatShields: null,
    maxCombatShields: null,
    lastShieldHitAt: 0,
    drawWidth: visual.width,
    drawHeight: visual.height,
    scale: visual.scale,
    visualSnapshot: { ...visual },
    defenseRange: 0,
    defenseDamage: 0,
    defenseCooldown: STATION_WEAPON_COOLDOWN_MS,
    stationWeaponIds: [],
    shotIndex: 0,
    lastShotAt: now + seeded(base * 61 + index) * 1000,
  }, star, planet, base, index), star, planet, now);
}

function refreshCurrentStationDestinations() {
  const primaryStation = state.stations.find((station) => !station.destroyed && !station.underConstruction) || state.stations.find((station) => !station.destroyed) || state.stations[0] || null;
  state.station = primaryStation ? { ...primaryStation } : null;
  state.trafficDestinations = getTrafficDestinations(state.stations, state.systemPlanet, state.systemStar, state.wormhole, state.currentPlanet + 1)
    .map((dest) => ({ name: dest.name, point: { ...dest.point } }));
  const systemState = state.systemStates[state.currentPlanet];
  if (systemState) {
    systemState.station = primaryStation ? { ...primaryStation } : null;
    systemState.trafficDestinations = state.trafficDestinations.map((dest) => ({ name: dest.name, point: { ...dest.point }, spread: dest.spread }));
  }
}

function addBuiltStationToCurrentSystem(builtStation) {
  if (!state.stationDefinitions.some((station) => station.id === builtStation.id)) {
    state.stationDefinitions.push({ ...builtStation, builtByPlayer: true, faction: builtStation.faction || state.playerFaction });
  }
  const systemState = state.systemStates[state.currentPlanet] || null;
  const runtimeStation = createLightweightRuntimeStation(builtStation, state.currentPlanet, state.stations.length);
  if (!state.stations.some((station) => station.id === runtimeStation.id)) {
    state.stations.push(runtimeStation);
  }
  if (systemState?.stations && !systemState.stations.some((station) => station.id === runtimeStation.id)) {
    systemState.stations.push({ ...runtimeStation });
  }
  return runtimeStation;
}

function canBuildStationsHere() {
  return state.gameStarted
    && state.docked
    && hasFactionAccessAt(state.currentPlanet)
    && state.systemAttitude !== 'hostile';
}

function getDestroyedStationRebuildTargets(systemIndex = state.currentPlanet) {
  const seen = new Set();
  return state.stations
    .filter((station) => station.destroyed && Number(station.systemIndex) === Number(systemIndex))
    .filter((station) => {
      if (seen.has(station.id)) return false;
      seen.add(station.id);
      return true;
    });
}

function getStationRebuildCost(targets = getDestroyedStationRebuildTargets()) {
  return targets.reduce((total, station) => {
    const stats = getShipStats(station.stationTypeId);
    total.latinum += Math.max(450, Math.round(getStationBuildCost(stats) * 0.28));
    total.duranium += Math.max(8, Math.round(getStationDuraniumCost(stats) * 0.55));
    return total;
  }, { latinum: 0, duranium: 0 });
}

function getRebuildSystemStationsStatus(systemIndex = state.currentPlanet) {
  const targets = getDestroyedStationRebuildTargets(systemIndex);
  const cost = getStationRebuildCost(targets);
  if (!state.docked) return { ok: false, reason: 'Dock before beginning reconstruction.', targets, cost };
  if (!isSystemControlled(systemIndex) || state.systemAttitude === 'hostile') {
    return { ok: false, reason: 'Reconstruction requires full control of this system.', targets, cost };
  }
  if (!targets.length) return { ok: false, reason: 'No station ruins in this system need rebuilding.', targets, cost };
  if (state.latinum < cost.latinum) return { ok: false, reason: `Need ${cost.latinum} latinum to rebuild these stations.`, targets, cost };
  if (state.duranium < cost.duranium) return { ok: false, reason: `Need ${cost.duranium} duranium to rebuild these stations.`, targets, cost };
  return { ok: true, reason: `Restore ${targets.length} ruined station${targets.length === 1 ? '' : 's'} under your control.`, targets, cost };
}

// Records the player as owner of specific installations (rebuilt or built by the player).
function assignStationsToPlayer(stationIds = []) {
  if (!state.stationOwners || typeof state.stationOwners !== 'object') state.stationOwners = {};
  for (const id of stationIds) state.stationOwners[id] = PLAYER_SIDE;
}

function rebuildSystemStations() {
  if (state.gameOver || !state.gameStarted) return;
  if (!requireDocked()) return;
  const status = getRebuildSystemStationsStatus(state.currentPlanet);
  if (!status.ok) {
    setLog(status.reason);
    renderPlanetMenu();
    return;
  }
  const cameraBeforeRebuild = { x: state.camera.x, y: state.camera.y };
  const rebuiltIds = new Set(status.targets.map((station) => station.id));
  for (const id of rebuiltIds) delete state.destroyedStations[id];
  assignStationsToPlayer([...rebuiltIds]);
  state.latinum -= status.cost.latinum;
  state.mylatinum = state.latinum;
  state.duranium -= status.cost.duranium;
  state.myduranium = state.duranium;
  state.systemStates = {};
  applySystemState(state.currentPlanet);
  for (const station of state.stations) {
    if (!rebuiltIds.has(station.id)) continue;
    station.faction = state.playerFaction;
    station.attitude = 'friendly';
    station.hostile = false;
    station.destroyed = false;
  }
  state.camera.x = cameraBeforeRebuild.x;
  state.camera.y = cameraBeforeRebuild.y;
  setLog(`Rebuilt ${status.targets.length} station${status.targets.length === 1 ? '' : 's'} in ${state.planets[state.currentPlanet]?.name || 'this system'} for ${status.cost.latinum} latinum and ${status.cost.duranium} duranium.`);
  renderPlanetMenu();
  updateStats();
}

function isFactionSystemClaimTarget(systemIndex = state.currentPlanet) {
  const sovereign = getSystemFaction(systemIndex);
  return sovereign !== 'neutral' && sovereign !== 'pirate' && sovereign !== state.playerFaction;
}

function getSystemClaimCost(systemIndex = state.currentPlanet) {
  const multiplier = isFactionSystemClaimTarget(systemIndex) ? FACTION_SYSTEM_CLAIM_COST_MULTIPLIER : 1;
  return {
    latinum: SYSTEM_CLAIM_LATINUM_COST * multiplier,
    duranium: SYSTEM_CLAIM_DURANIUM_COST * multiplier,
  };
}


const HOLDER_FORCE_ROLES = new Set(['patrol', 'occupationFleet', 'fleetAttack']);
// What stands between the player and a claim: the holder's surviving military forces (by side and
// role, so an occupation fleet counts and a visiting freighter does not) and installations owned
// by the holder or its allies. Foreign concessions and private posts are not blockers; installations
// hostile to the player are, whoever holds the system.
function getSystemControlBlockers(systemIndex = state.currentPlanet) {
  const control = getSystemControl(systemIndex);
  const holderSide = control.playerControlled ? null : control.polityId;
  // A world held by an organization (a recognized faction or a custom government): its own and
  // allied installations stand in the way; a third party's concession does not, even if that third
  // party dislikes the player. An independent or unknown world: whatever is hostile to the player.
  const organizationHeld = Boolean(holderSide) && control.controller !== 'neutral' && control.controller !== null;
  const stationBlockers = state.stations.filter((station) => {
    if (station.destroyed) return false;
    const owner = getStationOwner(station, systemIndex);
    if (owner === PLAYER_SIDE) return false;
    if (organizationHeld) return sidesAligned(owner, holderSide);
    return Boolean(station.hostile) || station.attitude === 'hostile';
  }).map((station) => ({ type: 'station', name: station.name, faction: station.faction || getSystemFaction(systemIndex) }));

  const forceBlockers = state.npcShips.filter((npc) => {
    if (!npc || npc.destroyed || isPlayerSideNpc(npc)) return false;
    if (!holderSide || !HOLDER_FORCE_ROLES.has(npc.role)) return false;
    return sidesAligned(getNpcSideId(npc), holderSide);
  }).map((npc) => ({ type: 'patrol ship', name: getShipDisplayName(npc), faction: npc.faction }));

  return [...stationBlockers, ...forceBlockers];
}

function getClaimSystemStatus(systemIndex = state.currentPlanet) {
  if (isSystemControlled(systemIndex)) {
    return { canClaim: false, label: 'Controlled', message: `${state.planets[systemIndex]?.name || 'This system'} is already under your control.` };
  }
  const sovereign = getSystemFaction(systemIndex);
  const factionTarget = isFactionSystemClaimTarget(systemIndex);
  const label = factionTarget ? 'Occupy System' : 'Claim System';
  const blockers = getSystemControlBlockers(systemIndex);
  if (blockers.length) {
    const stationCount = blockers.filter((blocker) => blocker.type === 'station').length;
    const patrolCount = blockers.filter((blocker) => blocker.type === 'patrol ship').length;
    const parts = [
      stationCount ? `${stationCount} station${stationCount === 1 ? '' : 's'}` : '',
      patrolCount ? `${patrolCount} patrol ship${patrolCount === 1 ? '' : 's'}` : '',
    ].filter(Boolean).join(' and ');
    return {
      canClaim: false,
      label,
      message: factionTarget
        ? `${formatFaction(sovereign)} controls this system. Neutralize ${parts} before occupation can begin.`
        : `Neutralize ${parts || `${blockers.length} hostile defense${blockers.length === 1 ? '' : 's'}`} before claiming this system.`,
    };
  }
  const cost = getSystemClaimCost(systemIndex);
  if (state.latinum < cost.latinum || state.duranium < cost.duranium) {
    return {
      canClaim: false,
      label,
      message: `Occupation charter requires ${cost.latinum} latinum and ${cost.duranium} duranium.`,
    };
  }
  return {
    canClaim: true,
    label,
    message: factionTarget
      ? `Defenses are down. Spend ${cost.latinum} latinum and ${cost.duranium} duranium to occupy this ${formatFaction(sovereign)} system.`
      : `Spend ${cost.latinum} latinum and ${cost.duranium} duranium to establish system control.`,
  };
}

function getMapSystemInfo(systemIndex = state.selectedPlanet) {
  const index = Math.max(0, Math.min(state.planets.length - 1, Number(systemIndex) || 0));
  const system = ensureSystemState(index);
  const faction = getSystemFaction(index);
  const controlledByPlayer = state.controlledSystems.includes(index);
  const visited = state.visitedSystems.includes(index) || index === state.currentPlanet;
  const stations = (system.stations || []).filter((station) => !station.destroyed);
  const basePatrols = faction !== 'neutral'
    ? (system.npcShips || []).filter((npc) => npc.role === 'patrol' && !npc.destroyed)
    : [];
  const playerFleet = getPlayerFleetShips(index);
  const escortFleet = Number(index) === Number(state.currentPlanet) ? getPlayerEscortFleetShips() : [];
  const stationPower = stations.reduce((sum, station) => {
    const durability = getStationCombatDurability(station);
    const defense = getStationDefenseProfile(station);
    return sum + durability.hull + durability.shields + defense.damage * 12 + defense.range * 0.35;
  }, 0);
  const patrolPower = basePatrols.reduce((sum, npc) => {
    const durability = getNpcCombatDurability(npc.shipId);
    return sum + durability.hull + durability.shields;
  }, 0);
  const fleetPower = [...playerFleet, ...escortFleet].reduce((sum, fleetShip) => {
    const durability = getNpcCombatDurability(fleetShip.shipId);
    return sum + durability.hull + durability.shields;
  }, 0);
  const power = Math.round(Math.max(0, (stationPower + patrolPower + fleetPower) / 100));
  const relation = controlledByPlayer
    ? 'Player controlled'
    : faction === 'neutral'
      ? 'Independent'
      : `${formatFaction(faction)} controlled`;
  return {
    faction,
    relation,
    visited,
    power,
    stations: stations.length,
    patrols: basePatrols.length,
    fleet: playerFleet.length + escortFleet.length,
  };
}

function drawFittedMapText(text, x, y, maxWidth) {
  let value = String(text || '');
  if (ctx.measureText(value).width <= maxWidth) {
    ctx.fillText(value, x, y);
    return;
  }
  while (value.length > 4 && ctx.measureText(`${value.slice(0, -1)}...`).width > maxWidth) {
    value = value.slice(0, -1);
  }
  ctx.fillText(`${value.slice(0, -1)}...`, x, y);
}

function claimCurrentSystem() {
  if (state.gameOver || !state.gameStarted) return;
  if (!requireDocked()) return;
  const status = getClaimSystemStatus(state.currentPlanet);
  if (!status.canClaim) {
    setLog(status.message);
    return;
  }
  // Claiming takes control and explicitly transfers the previous holder's government installations;
  // foreign and private stations keep their owners.
  transferSystemControlToPlayer(state.currentPlanet);
  const claimCost = getSystemClaimCost(state.currentPlanet);
  state.latinum = Math.max(0, state.latinum - claimCost.latinum);
  state.mylatinum = state.latinum;
  state.duranium = Math.max(0, state.duranium - claimCost.duranium);
  state.myduranium = state.duranium;
  // Stations (runtime and cached) follow their recorded owners; nothing is re-flagged wholesale.
  refreshStationOwnership(state.currentPlanet);
  refreshCachedStationOwnership(state.currentPlanet);
  state.systemFaction = state.playerFaction;
  state.systemAttitude = 'friendly';
  playGameSound('uiConfirm', { cooldownKey: `claim:${state.currentPlanet}` });
  setLog(`${state.planets[state.currentPlanet]?.name || 'System'} claimed for the ${formatFaction(state.playerFaction)}. Charter cost: ${claimCost.latinum} latinum, ${claimCost.duranium} duranium.`);
  renderPlanetMenu();
  updateStats();
}

function getWormholeBuildDestinationOptions() {
  return state.planets
    .map((planet, index) => {
      if (index === state.currentPlanet) return null;
      const existingWormhole = getSystemWormholeLinks(index)[0] || null;
      return {
        index,
        name: planet.name || `System ${index + 1}`,
        faction: getSystemFaction(index),
        disabled: Boolean(existingWormhole),
        reason: existingWormhole ? `${existingWormhole.name} already has a terminus here` : '',
      };
    })
    .filter(Boolean)
    .sort((a, b) => a.name.localeCompare(b.name));
}

function getDefaultWormholeDestinationIndex(options = getWormholeBuildDestinationOptions()) {
  const preferred = getSystemIndexByName(WORMHOLE_DOMINION_SYSTEM_NAME);
  const preferredOption = options.find((option) => option.index === preferred && !option.disabled);
  return preferredOption?.index ?? options.find((option) => !option.disabled)?.index ?? options[0]?.index ?? null;
}

function getWormholeBuildValidation(destinationIndex, pending = state.pendingWormholeBuild) {
  const targetIndex = Number(destinationIndex);
  const stationStats = state.shipStatsById[WORMHOLE_STATION_TYPE_ID];
  const price = pending?.price ?? getStationBuildCost(stationStats);
  const duraniumCost = pending?.duraniumCost ?? getStationDuraniumCost(stationStats);
  if (!stationStats || stationStats.assetType !== 'station') return { ok: false, reason: 'Wormhole generator design is not available.' };
  if (!canBuildStationsHere()) return { ok: false, reason: 'Wormholes can only be built in systems you control.' };
  if (!hasStationPlan(WORMHOLE_STATION_TYPE_ID)) return { ok: false, reason: 'You need the Wormhole Generator station plan first.' };
  if (getSystemWormholeLinks(state.currentPlanet).length) return { ok: false, reason: `${state.planets[state.currentPlanet]?.name || 'This system'} already has a wormhole terminus.` };
  if (!Number.isFinite(targetIndex) || !state.planets[targetIndex] || targetIndex === state.currentPlanet) return { ok: false, reason: 'Choose a valid destination system.' };
  if (getSystemWormholeLinks(targetIndex).length) return { ok: false, reason: `${state.planets[targetIndex].name} already has a wormhole terminus.` };
  if (state.latinum < price) return { ok: false, reason: `Need ${price} latinum to open a wormhole route.` };
  if (state.duranium < duraniumCost) return { ok: false, reason: `Need ${duraniumCost} duranium to stabilize the wormhole.` };
  return { ok: true, reason: 'Ready to open wormhole.', stationStats, price, duraniumCost, targetIndex };
}

function renderWormholeBuildModal() {
  if (!wormholeModalEl) return;
  if (!state.pendingWormholeBuild) {
    wormholeModalEl.classList.add('hidden');
    wormholeModalEl.innerHTML = '';
    return;
  }
  const options = getWormholeBuildDestinationOptions();
  const selected = options.some((option) => option.index === Number(state.pendingWormholeBuild.destinationIndex))
    ? Number(state.pendingWormholeBuild.destinationIndex)
    : getDefaultWormholeDestinationIndex(options);
  state.pendingWormholeBuild.destinationIndex = selected;
  const status = getWormholeBuildValidation(selected, state.pendingWormholeBuild);
  const currentName = state.planets[state.currentPlanet]?.name || 'Current System';
  const stationStats = status.stationStats || state.shipStatsById[WORMHOLE_STATION_TYPE_ID] || {};
  const description = String(stationStats.description || 'Creates a permanent wormhole route from this system to another system.').trim();
  const optionMarkup = options.map((option) => (
    `<option value="${option.index}" ${option.index === selected ? 'selected' : ''} ${option.disabled ? 'disabled' : ''}>${escapeHtml(option.name)} - ${escapeHtml(formatFaction(option.faction))}${option.disabled ? ` - ${escapeHtml(option.reason)}` : ''}</option>`
  )).join('');
  const targetName = state.planets[Number(selected)]?.name || 'destination';
  wormholeModalEl.classList.remove('hidden');
  wormholeModalEl.innerHTML = `<div class="ship-purchase-card" role="dialog" aria-modal="true" aria-label="Wormhole construction">
    <div class="ship-purchase-head">
      <span>Wormhole Generator</span>
      <button class="panel-close" data-wormhole-action="cancel" aria-label="Close wormhole construction">&times;</button>
    </div>
    <div class="ship-purchase-body">
      <img class="ship-purchase-preview station-preview" src="${escapeHtml(getShipPreviewSrc(WORMHOLE_STATION_TYPE_ID))}" alt="">
      <div class="ship-purchase-copy">
        <h2>${escapeHtml(currentName)} Terminus</h2>
        <p>${escapeHtml(description)}</p>
        <div class="fleet-assignment-field">
          <label for="wormhole-destination-select">Destination</label>
          <select id="wormhole-destination-select" data-wormhole-destination>${optionMarkup}</select>
        </div>
        <div class="ship-purchase-grid">
          <span>Route</span><b>${escapeHtml(currentName)} to ${escapeHtml(targetName)}</b>
          <span>Latinum</span><b>${escapeHtml(status.price ?? state.pendingWormholeBuild.price)} / ${escapeHtml(state.latinum)}</b>
          <span>Duranium</span><b>${escapeHtml(status.duraniumCost ?? state.pendingWormholeBuild.duraniumCost)} / ${escapeHtml(state.duranium)}</b>
          <span>Warp Cost</span><b>0 antimatter</b>
        </div>
        <div class="ship-purchase-cost ${status.ok ? '' : 'blocked'}">${escapeHtml(status.reason)}</div>
      </div>
    </div>
    <div class="ship-purchase-actions">
      <button data-wormhole-action="cancel">Cancel</button>
      <button data-wormhole-action="confirm" ${status.ok ? '' : 'disabled'}>Open Wormhole</button>
    </div>
  </div>`;
}

function openWormholeBuildModal(stationTypeId, buildCost) {
  const stationStats = state.shipStatsById[Number(stationTypeId)];
  const price = buildCost?.price ?? getStationBuildCost(stationStats);
  const duraniumCost = buildCost?.duraniumCost ?? getStationDuraniumCost(stationStats);
  const defaultDestination = getDefaultWormholeDestinationIndex();
  state.pendingWormholeBuild = {
    stationTypeId: Number(stationTypeId),
    price,
    duraniumCost,
    destinationIndex: defaultDestination,
  };
  renderWormholeBuildModal();
  const status = getWormholeBuildValidation(defaultDestination, state.pendingWormholeBuild);
  setLog(status.ok ? 'Choose a destination for the wormhole terminus.' : status.reason);
}

function closeWormholeBuildModal() {
  state.pendingWormholeBuild = null;
  renderWormholeBuildModal();
}

function confirmPendingWormholeBuild() {
  if (!state.pendingWormholeBuild) return;
  const selected = Number(wormholeModalEl?.querySelector('[data-wormhole-destination]')?.value ?? state.pendingWormholeBuild.destinationIndex);
  const status = getWormholeBuildValidation(selected, state.pendingWormholeBuild);
  if (!status.ok) {
    setLog(status.reason);
    renderWormholeBuildModal();
    return;
  }
  const from = state.currentPlanet;
  const to = status.targetIndex;
  const fromName = state.planets[from]?.name || `System ${from + 1}`;
  const toName = state.planets[to]?.name || `System ${to + 1}`;
  const cameraBeforeBuild = { x: state.camera.x, y: state.camera.y };
  state.latinum -= status.price;
  state.mylatinum = state.latinum;
  state.duranium -= status.duraniumCost;
  state.myduranium = state.duranium;
  state.playerWormholes.push({
    id: `wormhole-${from}-${to}-${Date.now()}`,
    from,
    to,
    name: `${fromName}-${toName} Wormhole`,
    faction: state.playerFaction,
    builtByPlayer: true,
  });
  state.selectedPlanet = to;
  state.systemStates = {};
  rebuildTravelRoutes();
  applySystemState(state.currentPlanet);
  state.camera.x = cameraBeforeBuild.x;
  state.camera.y = cameraBeforeBuild.y;
  closeWormholeBuildModal();
  playGameSound('wormholeOpen', { cooldownKey: `wormhole-build:${from}:${to}` });
  setLog(`Wormhole opened between ${fromName} and ${toName}. It is now available on the star chart.`);
  renderPlanetMenu();
  updateStats();
}

function buildStation(stationTypeId) {
  if (state.gameOver || !state.gameStarted) return;
  if (!requireDocked()) return;
  if (!canBuildStationsHere()) {
    setLog('Station construction is only available in systems you control.');
    return;
  }
  if (!hasStationPlan(stationTypeId)) {
    const stationName = getShipStats(stationTypeId).name || 'that station';
    setLog(`You need to buy the ${stationName} station plan before building it.`);
    return;
  }
  const stationStats = state.shipStatsById[Number(stationTypeId)];
  if (!stationStats || stationStats.assetType !== 'station') {
    setLog('That station design is not available.');
    return;
  }
  const isWormholeGenerator = Number(stationTypeId) === WORMHOLE_STATION_TYPE_ID;
  if (!isWormholeGenerator && countPlayerBuiltStations(state.currentPlanet) >= MAX_PLAYER_BUILT_STATIONS_PER_SYSTEM) {
    setLog(`This system can support ${MAX_PLAYER_BUILT_STATIONS_PER_SYSTEM} player-built stations.`);
    return;
  }
  const price = getStationBuildCost(stationStats);
  const duraniumCost = getStationDuraniumCost(stationStats);
  if (state.latinum < price) {
    setLog(`Need ${price} latinum to build ${stationStats.name}.`);
    return;
  }
  if (state.duranium < duraniumCost) {
    setLog(`Need ${duraniumCost} duranium to build ${stationStats.name}. Mine asteroids with Transport.`);
    return;
  }
  if (isWormholeGenerator) {
    openWormholeBuildModal(stationTypeId, { price, duraniumCost });
    return;
  }
  openStationBuildModal(stationTypeId, { price, duraniumCost });
}

function buyStationPlan(stationTypeId) {
  if (state.gameOver || !state.gameStarted) return;
  if (!requireDocked()) return;
  const stationStats = state.shipStatsById[Number(stationTypeId)];
  if (!stationStats || stationStats.assetType !== 'station') {
    setLog('That station plan is not available.');
    return;
  }
  if (hasStationPlan(stationTypeId)) {
    setLog(`${stationStats.name} station plan is already in your inventory.`);
    return;
  }
  const available = getStationPlanStock().some((stockPlan) => Number(stockPlan.id) === Number(stationTypeId));
  if (!available) {
    setLog(`${stationStats.name} station plan is not sold in this system.`);
    return;
  }
  const price = getStationPlanCost(stationStats);
  if (state.latinum < price) {
    setLog(`Need ${price} latinum to buy the ${stationStats.name} station plan.`);
    return;
  }
  state.latinum -= price;
  state.mylatinum = state.latinum;
  state.stationPlans.push(Number(stationTypeId));
  normalizeStationPlans();
  playGameSound('purchase', { cooldownKey: `purchase:station-plan:${stationTypeId}` });
  setLog(`Purchased station plan: ${stationStats.name}. It is now available from Build on controlled planets.`);
  renderPlanetMenu();
  renderTopLeftPanel();
  updateStats();
}

function realignPlayerAssetsToFaction(faction = state.playerFaction) {
  const key = normalizeFactionKey(faction);
  state.playerBuiltStations = (Array.isArray(state.playerBuiltStations) ? state.playerBuiltStations : [])
    .map((station) => ({ ...station, faction: key }));
  state.playerWormholes = (Array.isArray(state.playerWormholes) ? state.playerWormholes : [])
    .map((link) => (link.builtByPlayer ? { ...link, faction: key } : link));
  state.playerFleet = (Array.isArray(state.playerFleet) ? state.playerFleet : [])
    .map((fleetShip) => ({ ...fleetShip, faction: key }));
  normalizePlayerFleetNames();
  syncPlayerBuiltStationDefinitions();

  state.systemFaction = getSystemFaction(state.currentPlanet);
  state.systemAttitude = getSystemAttitude(state.currentPlanet);
  // Player-owned installations everywhere fly the new flag on entry (derived from records); the
  // current scene is refreshed here. Foreign-owned stations are untouched.
  state.stations = (state.stations || []).map((station) => {
    const ownerId = getStationOwner(station, state.currentPlanet);
    const owned = ownerId === PLAYER_SIDE;
    const stationFaction = getStationFlagForOwner(ownerId);
    const attitude = station.destroyed ? 'destroyed' : owned ? 'friendly' : getFactionAttitude(stationFaction);
    return {
      ...station,
      faction: stationFaction,
      attitude,
      hostile: attitude === 'hostile' && Boolean(station.hostile),
    };
  });
  state.station = state.stations.find((station) => !station.destroyed) || state.station;
  state.npcShips = (state.npcShips || []).map((npc) => {
    if (npc.fleetId) {
      return { ...npc, faction: key, attitude: 'friendly', hostile: false };
    }
    const attitude = getFactionAttitude(npc.faction);
    return {
      ...npc,
      attitude,
      hostile: state.systemAttitude === 'hostile' && attitude !== 'friendly',
    };
  });
}

function buyFactionFlag(faction) {
  if (state.gameOver || !state.gameStarted) return;
  if (!requireDocked()) return;
  if (getCurrentDockedStation()) {
    setLog('Faction flags are sold from planets, not stations.');
    return;
  }
  const key = normalizeFactionKey(faction);
  const flagRefusal = serviceRefusal(key);
  if (flagRefusal) {
    setLog(flagRefusal);
    return;
  }
  const offer = getLocalFlagOffer();
  if (!offer || offer.faction !== key) {
    setLog(`${formatFaction(key)} flags are only sold on ${formatFaction(key)} planets.`);
    return;
  }
  if (hasPlayerFlag(key)) {
    setLog(`${formatFaction(key)} flag is already in your inventory.`);
    return;
  }
  if (state.latinum < offer.price) {
    setLog(`Need ${offer.price} latinum to buy the ${formatFaction(key)} flag.`);
    return;
  }
  state.latinum -= offer.price;
  state.mylatinum = state.latinum;
  state.playerFlags.push(key);
  normalizePlayerFlags();
  playGameSound('purchase', { cooldownKey: `purchase:flag:${key}` });
  setLog(`Purchased ${formatFaction(key)} flag. Raise it from Market or Inventory to change allegiance.`);
  updateStats();
}

function raisePlayerFlag(faction) {
  if (state.gameOver || !state.gameStarted) return;
  const key = normalizeFactionKey(faction);
  normalizePlayerFlags();
  if (!hasPlayerFlag(key)) {
    setLog(`You do not own the ${formatFaction(key)} flag.`);
    return;
  }
  const previousFaction = normalizeFactionKey(state.playerFaction);
  if (previousFaction === key) {
    setLog(`${formatFaction(key)} flag is already raised.`);
    return;
  }
  state.playerFaction = key;
  realignPlayerAssetsToFaction(key);
  normalizePlayerFlags();
  playGameSound('uiConfirm', { cooldownKey: `raise-flag:${key}` });
  setLog(`Raised ${formatFaction(key)} flag. Allegiance changed from ${formatFaction(previousFaction)} to ${formatFaction(key)}.`);
  syncLegacyState();
  updateStats();
}

function renderPlanetMenu() {
  if (!planetMenuEl || !state.planetMenuOpen || !state.docked) {
    if (planetMenuEl) planetMenuEl.classList.add('hidden');
    return;
  }
  const previousDockPanel = planetMenuEl.querySelector('.dock-panel');
  if (previousDockPanel?.dataset?.dockTab) {
    state.dockPanelScrollByTab[previousDockPanel.dataset.dockTab] = previousDockPanel.scrollTop;
  }
  const planet = state.planets[state.currentPlanet];
  const station = getCurrentDockedStation();
  const serviceName = station?.name || planet.name;
  const serviceTitle = serviceName;
  const stationStats = station ? getShipStats(station.stationTypeId) : null;
  const stationMeta = station
    ? `${escapeHtml(stationStats.name || 'Station')} | Defense ${Math.round(station.defenseRange || 0)} | ${formatFaction(station.faction || state.systemFaction)} station`
    : `${formatFaction(state.systemFaction)} space | ${state.systemAttitude}${state.systemHasNebula ? ' | Nebula' : ''}`;
  const planetDescription = String(planet.description || state.systemData[state.currentPlanet]?.[7] || '').trim();
  const serviceDescription = !station && planetDescription
    ? `<div class="service-description">${escapeHtml(planetDescription)}</div>`
    : '';
  const market = currentMarketOffers().map(renderMarketOffer).join('');
  normalizePlayerFlags();
  const stock = getShipyardStock(station);
  const shipyardContext = getShipyardStockContext(station);
  const localFleetCount = getPlayerFleetShips(state.currentPlanet).length;
  const escortFleetCount = getPlayerEscortFleetShips().length;
  const shipCards = stock.map((ship) => {
    const id = Number(ship.id);
    const price = getShipPrice(ship);
    const current = id === Number(state.playership);
    return `<div class="ship-card ${current ? 'current' : ''}">
      <div class="ship-card-head">
        <img class="ship-preview ship-preview-${escapeHtml(getShipVisualClass(id))}" src="${escapeHtml(getShipPreviewSrc(id))}" alt="">
        <div class="ship-card-title">
          <div class="name">${escapeHtml(ship.name)}</div>
          <div class="ship-faction">${formatFaction(getShipFaction(id))}</div>
        </div>
      </div>
      <div class="stats icon-row">
        ${iconStat('latinum', `${price}L`, 'Latinum')}
        ${iconStat('cargo', Math.round(finiteNumber(ship.cargoCapacity, 0)), 'Cargo')}
        ${iconStat('speed', Math.round(finiteNumber(ship.topSpeed, 0)), 'Speed')}
        ${iconStat('hull', Math.round(finiteNumber(ship.hull, 0)), 'Hull')}
        ${iconStat('range', getShipWarpRange(id), 'Warp range')}
      </div>
      <div class="ship-actions">
        <button data-ship-buy="${id}">Buy</button>
      </div>
    </div>`;
  }).join('');
  normalizeWeaponLoadout();
  const weaponStock = station ? getStationWeaponStock(station) : [];
  const weaponCards = weaponStock.map((weapon) => {
    const ownedCount = countOwnedWeapon(weapon.id);
    const loaded = state.weaponSlots.includes(weapon.id);
    const price = getWeaponPrice(weapon);
    const compatible = state.godMode || state.mymass >= weapon.minMass;
    const inventoryFull = !state.godMode && state.weaponInventory.length >= getWeaponInventoryLimit();
    const hoj=weapon.guidance==='home-on-jam'?getHojPurchaseDecision(station):{canBuy:true};
    const canBuy = compatible && state.latinum >= price && !inventoryFull && hoj.canBuy;
    const action = !hoj.canBuy ? escapeHtml(hoj.reason) : !compatible
      ? `Mass ${weapon.minMass}+`
      : inventoryFull
        ? 'Inventory full'
        : state.latinum < price
          ? 'Need latinum'
          : ownedCount
            ? `Buy copy (${ownedCount})`
            : 'Buy';
    return `<div class="ship-card weapon-card ${loaded ? 'current' : ''}">
      <div class="weapon-title">
        <img class="weapon-main-icon" src="${escapeHtml(getWeaponIconSrc(weapon))}" alt="">
        <span class="name">${escapeHtml(weapon.name)}</span>
      </div>
      <div class="stats icon-row">
        ${iconStat('latinum', `${price}L`, 'Latinum')}
        <span class="icon-stat weapon-kind">${iconImg(getWeaponTypeIconSrc(weapon), weapon.type, 'resource-icon')}<span>${escapeHtml(weapon.type)}</span></span>
        ${ownedCount ? `<span class="icon-stat"><span>Owned ${ownedCount}</span></span>` : ''}
        <span>Damage ${weapon.damage} / Ship ${getScaledWeaponDamage(state.playership, weapon)}</span>
        <span>Range ${weapon.range}</span>
        ${weapon.guidance==='home-on-jam'?'<span>Emission lock only · coasts when jammer goes silent · respected standing</span>':''}
        <span>Cooldown ${(weapon.cooldown / 1000).toFixed(1)}s / Ship ${(getScaledWeaponCooldown(state.playership, weapon) / 1000).toFixed(1)}s</span>
        <span>Mass ${weapon.minMass}+</span>
      </div>
      <button data-weapon-buy="${weapon.id}" ${canBuy ? '' : 'disabled'}>${action}</button>
    </div>`;
  }).join('');
  const canBuildHere = canBuildStationsHere();
  const builtCount = countPlayerBuiltStations(state.currentPlanet);
  const claimStatus = getClaimSystemStatus(state.currentPlanet);
  const rebuildStatus = getRebuildSystemStationsStatus(state.currentPlanet);
  const stationPlanStock = getStationPlanStock(station);
  const ownedStationPlans = getOwnedStationPlanTypes();
  const buildStatus = canBuildHere
    ? `Controlled system | Built ${builtCount}/${MAX_PLAYER_BUILT_STATIONS_PER_SYSTEM}`
    : `${claimStatus.message} Construction requires a controlled, non-hostile system.`;
  const rebuildCards = rebuildStatus.targets.length
    ? `<div class="ship-card station-rebuild-card">
      <div class="ship-card-title">
        <div class="name">Rebuild Station Ruins</div>
        <div class="ship-faction">${escapeHtml(rebuildStatus.reason)}</div>
      </div>
      <div class="stats icon-row">
        ${iconStat('latinum', `${rebuildStatus.cost.latinum}L`, 'Latinum')}
        ${iconStat('duranium', rebuildStatus.cost.duranium, 'Duranium')}
        <span>${rebuildStatus.targets.length} station${rebuildStatus.targets.length === 1 ? '' : 's'}</span>
      </div>
      <button data-station-rebuild ${rebuildStatus.ok ? '' : 'disabled'}>${rebuildStatus.ok ? 'Rebuild' : 'Blocked'}</button>
    </div>`
    : '<div class="meta">No station ruins need rebuilding in this system.</div>';
  const stationPlanCards = stationPlanStock.map((stationType) => {
    const price = getStationPlanCost(stationType);
    const canBuy = state.latinum >= price;
    const action = canBuy ? 'Buy Plan' : 'Need latinum';
    return `<div class="ship-card station-plan-card">
      <div class="ship-card-head">
        <img class="ship-preview station-preview" src="${escapeHtml(getShipPreviewSrc(stationType.id))}" alt="">
        <div class="ship-card-title">
          <div class="name">${escapeHtml(stationType.name)} Plan</div>
          <div class="ship-faction">${formatFaction(getShipFaction(stationType.id))} design</div>
        </div>
      </div>
      <div class="stats icon-row">
        ${iconStat('latinum', `${price}L`, 'Plan cost')}
        ${iconStat('latinum', `${getStationBuildCost(stationType)}L build`, 'Build cost')}
        ${iconStat('duranium', getStationDuraniumCost(stationType), 'Build duranium')}
        ${iconStat('hull', Math.round(finiteNumber(stationType.hull, 0)), 'Hull')}
      </div>
      <button data-station-plan-buy="${stationType.id}" ${canBuy ? '' : 'disabled'}>${action}</button>
    </div>`;
  }).join('');
  const ownedBuildPlans = ownedStationPlans.filter((stationType) => Number(stationType.id) !== WORMHOLE_STATION_TYPE_ID);
  const affordableBuildPlans = ownedBuildPlans.filter((stationType) => (
    state.latinum >= getStationBuildCost(stationType)
    && state.duranium >= getStationDuraniumCost(stationType)
  ));
  const defaultBuildPlan = affordableBuildPlans[0] || ownedBuildPlans[0] || null;
  const stationLimitReached = builtCount >= MAX_PLAYER_BUILT_STATIONS_PER_SYSTEM;
  const canOpenBuildPlotter = Boolean(defaultBuildPlan && canBuildHere && affordableBuildPlans.length && !stationLimitReached);
  const buildAction = !ownedBuildPlans.length
    ? 'No plans'
    : !canBuildHere
      ? 'Not controlled'
      : stationLimitReached
        ? 'System full'
        : affordableBuildPlans.length
          ? 'Choose Plot'
          : state.latinum < Math.min(...ownedBuildPlans.map(getStationBuildCost))
            ? 'Need latinum'
            : 'Need duranium';
  const stationPlannerStatus = ownedBuildPlans.length
    ? `${ownedBuildPlans.length} owned station plan${ownedBuildPlans.length === 1 ? '' : 's'} | Built ${builtCount}/${MAX_PLAYER_BUILT_STATIONS_PER_SYSTEM} | ${buildAction}`
    : 'Buy a station plan before construction can begin.';
  const stationPlannerButton = `<div class="station-planner-footer">
    <div class="meta">${escapeHtml(stationPlannerStatus)}</div>
    <button class="station-planner-button" data-station-build="${defaultBuildPlan ? defaultBuildPlan.id : ''}" ${canOpenBuildPlotter ? '' : 'disabled'}>Station Planning Interface</button>
  </div>`;
  const tabs = [
    ...(!station ? [{ id: 'services', label: 'Services' }] : []),
    { id: 'market', label: 'Market' },
    ...(!station ? [{ id: 'ships', label: 'Shipyard' }] : []),
    ...(!station ? [{ id: 'construction', label: 'Build' }] : []),
    ...(!station && isSystemControlled(state.currentPlanet) ? [{ id: 'security', label: 'Security' }] : []),
  ];
  if (station) state.dockMenuTab = 'market';
  if (state.dockMenuTab === 'flags' || state.dockMenuTab === 'weapons') state.dockMenuTab = 'market';
  if (!tabs.some((tab) => tab.id === state.dockMenuTab)) state.dockMenuTab = station ? 'market' : 'services';
  const tabButtons = tabs.map((tab) => (
    `<button class="${state.dockMenuTab === tab.id ? 'active' : ''}" data-dock-tab="${tab.id}">${escapeHtml(tab.label)}</button>`
  )).join('');
  const dockTabsMarkup = station ? '' : `<div class="dock-tabs">${tabButtons}</div>`;
  const marketShips = station
    ? `<div class="market-section">
      <div class="panel-head">${escapeHtml(serviceName)} Ship Market</div>
      <div class="meta">${formatFaction(shipyardContext.localFaction)} stock | Market ${Math.round(shipyardContext.market)} | Limit ${shipyardContext.maxPrice}L | Defense ${localFleetCount}/${MAX_PLAYER_FLEET_SHIPS_PER_SYSTEM} | Escort ${escortFleetCount}/${MAX_PLAYER_ESCORT_SHIPS}</div>
      <div class="shipyard">${shipCards || '<div class="meta">No local ship stock available.</div>'}</div>
    </div>`
    : '';
  const marketPlans = station
    ? `<div class="market-section">
      <div class="panel-head">${escapeHtml(serviceName)} Station Plans</div>
      <div class="meta">${stationPlanStock.length ? `${stationPlanStock.length} regional station plan${stationPlanStock.length === 1 ? '' : 's'} available here. Construction is handled from planets you control.` : 'No new station plans are stocked here.'}</div>
      <div class="shipyard station-plan-market">${stationPlanCards || '<div class="meta">Visit specialist stations to find more plans.</div>'}</div>
    </div>`
    : '';
  const marketWeapons = station
    ? `<div class="market-section">
      <div class="panel-head">${escapeHtml(serviceName)} Weapons</div>
      <div class="shipyard weapon-market">${weaponCards || '<div class="meta">No weapons stocked here.</div>'}</div>
    </div>`
    : '';
  const marketFlags = !station
    ? `<div class="market-section">${renderFlagMarket()}</div>`
    : '';
  const securityMarkup = renderSecurityPanelMarkup(state.currentPlanet);
  const panels = {
    security: securityMarkup,
    services: `${serviceDescription}<div class="service-grid">
      <button data-planet-action="refuel">Antimatter</button>
      <button data-planet-action="repair">Repair</button>
      <button data-planet-action="contract">Contract</button>
      <button data-planet-action="deliver">Deliver</button>
      <button data-planet-action="claim">${escapeHtml(claimStatus.label)}</button>
      ${getPlantableFlags().map((flagFaction) => `<button data-planet-dedicate="${escapeHtml(flagFaction)}">Flag: ${escapeHtml(formatFaction(flagFaction))}</button>`).join('')}
      <button data-planet-action="construction">Build Station</button>
    </div>
    <div class="meta">${escapeHtml(claimStatus.message)}</div>`,
    market: `<div class="panel-head">Cargo Market</div>
      <div class="market">${market}</div>
      ${marketFlags}
      ${marketShips}
      ${marketPlans}
      ${marketWeapons}`,
    ships: `<div class="panel-head">${station ? `${escapeHtml(serviceName)} Stock` : 'Shipyard'}</div>
      <div class="meta">Ship access follows faction standing across regions. Complete contracts or defend faction forces to earn trust. Routine trade builds familiarity up to 15.</div>
      <div class="meta">${formatFaction(shipyardContext.localFaction)} stock | Market ${Math.round(shipyardContext.market)} | Limit ${shipyardContext.maxPrice}L | Defense ${localFleetCount}/${MAX_PLAYER_FLEET_SHIPS_PER_SYSTEM} | Escort ${escortFleetCount}/${MAX_PLAYER_ESCORT_SHIPS}</div>
      <div class="shipyard">${shipCards || '<div class="meta">No local shipyard stock available.</div>'}</div>`,
    construction: `<div class="panel-head">Station Construction</div>
      <div class="meta">${escapeHtml(buildStatus)}</div>
      <div class="panel-head">Rebuild Ruins</div>
      <div class="shipyard station-rebuild-market">${rebuildCards}</div>
      <div class="panel-head">Plans For Sale</div>
      <div class="meta">${stationPlanStock.length ? `${stationPlanStock.length} regional station plan${stationPlanStock.length === 1 ? '' : 's'} available here.` : 'No new station plans are stocked here.'}</div>
      <div class="shipyard station-plan-market">${stationPlanCards || '<div class="meta">Visit other systems or specialist stations to find more plans.</div>'}</div>
      ${stationPlannerButton}`,
  };

  planetMenuEl.classList.remove('hidden');
  planetMenuEl.classList.toggle('station-menu', Boolean(station));
  planetMenuEl.innerHTML = `<div class="planet-menu-head">
    <div>
      <h2>${escapeHtml(serviceTitle)}</h2>
      <div class="meta">${stationMeta}</div>
    </div>
    <button class="panel-close" data-planet-action="close" aria-label="Close services panel">&times;</button>
  </div>
  ${dockTabsMarkup}
  <div class="dock-panel" tabindex="0" data-dock-tab="${escapeHtml(state.dockMenuTab)}">${panels[state.dockMenuTab] || panels.services}</div>`;
  const activeDockPanel = planetMenuEl.querySelector('.dock-panel');
  const rememberedScroll = state.dockPanelScrollByTab[state.dockMenuTab] || 0;
  if (activeDockPanel && rememberedScroll > 0) {
    activeDockPanel.scrollTop = rememberedScroll;
    requestAnimationFrame(() => {
      const currentDockPanel = planetMenuEl.querySelector('.dock-panel');
      if (currentDockPanel?.dataset?.dockTab === state.dockMenuTab) {
        currentDockPanel.scrollTop = rememberedScroll;
      }
    });
  }
}

function openPlanetMenu() {
  state.planetMenuOpen = true;
  state.dockMenuTab = 'services';
  state.dockPanelScrollByTab = {};
  state.fleetPurchaseShipId = null;
  openHudTemporarily(2600);
  playGameSound('dock', { cooldownKey: `dock:planet:${state.currentPlanet}` });
  renderPlanetMenu();
}

function openStationMenu(station) {
  state.docked = true;
  state.dockedPlanetIndex = null;
  state.dockedStationId = station.id;
  state.planetMenuOpen = true;
  state.dockMenuTab = 'market';
  state.dockPanelScrollByTab = {};
  state.fleetPurchaseShipId = null;
  openHudTemporarily(2600);
  playGameSound('dock', { cooldownKey: `dock:station:${station.id}` });
  setLog(`Docked at ${station.name}. Station defenses are active.`);
  renderPlanetMenu();
  updateStats();
}

function closePlanetMenu() {
  state.planetMenuOpen = false;
  state.fleetPurchaseShipId = null;
  renderPlanetMenu();
}

function clearCargoPod(pod) {
  pod.tons = 0;
  pod.item = 'Nothing';
  pod.destination = undefined;
  delete pod.destinationIndex;
  delete pod.contractId;
  delete pod.targetIndex;
  delete pod.targetName;
  pod.payout = 0;
}

function createEmptyCargoArray() {
  return Array.from({ length: 10 }, () => ({ tons: 0, item: 'Nothing', destination: undefined, payout: 0 }));
}

function updateStats() {
  applyFactionUiTheme();
  state.mylatinum = state.latinum;
  state.myduranium = state.duranium;
  syncFuelToAntimatter();
  state.mycargo = state.cargo;
  state.totcargo = state.cargoCap;
  const mode = state.warp.active ? 'WARP' : state.mapOpen ? 'MAP' : 'FLIGHT';
  const message = state.log || (state.docked
    ? getCurrentDockedStation()?.name || state.planets[state.dockedPlanetIndex]?.name || 'Docked'
    : 'In Flight');
  statsEl.innerHTML = `<div class="top-strip">
      <div class="top-slot top-ship alert-${getAlertStatus()}">${escapeHtml(mode)} &middot; ${getAlertStatus().toUpperCase()}</div>
      <div class="top-slot top-message">${escapeHtml(message)}</div>
      <div class="top-stat"><span>AM</span>${state.antimatter}/${state.fuelCap}</div>
      <div class="top-stat"><span>SHLD</span>${Math.round(clamp(finiteNumber(state.shields, 0), 0, 100))}%</div>
      <div class="top-stat"><span>Hull</span>${Math.round(clamp(finiteNumber(state.hull, 0), 0, 100))}%</div>
      <div class="top-stat"><span>DUR</span>${state.duranium}</div>
      <div class="top-stat"><span>LAT</span>${state.latinum}</div>
      <div class="top-stat" title="${escapeHtml(formatFaction(getSystemFaction(state.currentPlanet)) + ' standing')}"><span>STD</span>${getFactionStanding(getSystemFaction(state.currentPlanet))}</div>
    </div>`;
  updatePanel();
  updateBottomDock();
  renderPlanetMenu();
  if (state.pendingContractOffer || !contractModalEl?.classList.contains('hidden')) {
    renderContractModal();
  }
  if (state.pendingShipPurchase || !shipPurchaseModalEl?.classList.contains('hidden')) {
    renderShipPurchaseModal();
  }
  if (state.pendingFleetPurchase || !fleetPurchaseModalEl?.classList.contains('hidden')) {
    renderFleetPurchaseModal();
  }
  if (state.pendingStationBuild || !stationBuildModalEl?.classList.contains('hidden')) {
    renderStationBuildModal();
  }
  if (state.pendingWormholeBuild || !wormholeModalEl?.classList.contains('hidden')) {
    renderWormholeBuildModal();
  }
}

function getFlightPlanetMarker() {
  const screen = worldToScreen(state.systemPlanet);
  const planet = state.planets[state.currentPlanet];
  const drawSize = getPlanetVisualSize(planet);
  return {
    ...planet,
    spinPeriod: state.systemPlanet.spinPeriod,
    spinDirection: state.systemPlanet.spinDirection,
    orbitAngleCurrent: state.systemPlanet.orbitAngleCurrent,
    worldX: state.systemPlanet.x,
    worldY: state.systemPlanet.y,
    drawSize,
    clickRadius: getPlanetClickRadius(planet),
    dockDistance: getPlanetDockDistance(planet),
    x: screen.x,
    y: screen.y,
  };
}

function tryDockAtPlanetIndex(i, marker = state.planets[i]) {
  const p = state.planets[i];
  const markerDx = state.ship.x - marker.x;
  const markerDy = state.ship.y - marker.y;
  const markerDistance = Math.hypot(markerDx, markerDy);
  const dockDistance = marker.dockDistance || getPlanetDockDistance(p);
  const popOffset = (marker.drawSize || getPlanetVisualSize(p)) * 0.55;
  if (markerDistance > dockDistance) {
    setLog(`Move closer to ${p.name} to dock.`);
    addWorldPop(marker.x, marker.y - popOffset, 'Too far');
    return false;
  }
  // Access consequence of a checkpoint: the holder's world does not receive a visitor with a pending
  // or refused instruction. Distance, hostility and everything else are unchanged by this.
  const securityBlock = i === Number(state.currentPlanet) ? getSecurityDockingBlock(getSystemControl(i).polityId) : null;
  if (securityBlock) {
    playGameSound('uiError', { cooldownKey: 'dock:security' });
    setLog(securityBlock);
    addWorldPop(marker.x, marker.y - popOffset, 'Not cleared', '#ff9c9c');
    return false;
  }
  state.docked = true;
  state.dockedPlanetIndex = i;
  state.dockedStationId = null;
  state.currentPlanet = i;
  state.myplanet = i + 1;
  setLog(`Docked at ${p.name}. Planet services open.`);
  addWorldPop(marker.x, marker.y - popOffset, 'Docked', '#9cffb4');
  openPlanetMenu();
  updateStats();
  return true;
}

function requireDocked() {
  if (!state.docked) {
    setLog('You must dock at a planet first (fly to planet and click it).');
    return false;
  }
  return true;
}

function getCatalogPurchaseDecision(shipId, extra = {}) {
  if (!state.shipCatalog) return null;
  const vendorInfo = getCurrentPurchaseVendor();
  return state.shipCatalog.getPurchaseDecision(shipId, buildPurchaseContext({
    ...vendorInfo,
    credits: extra.credits ?? state.latinum,
    standings: Object.fromEntries(Object.keys(factionRelations).map(key => [key, getFactionStanding(key)])),
    tierThresholds: extra.tierThresholds ?? getConfiguredPurchaseTierThresholds(),
    vendor: extra.vendor ?? vendorInfo.vendor,
  }));
}

// All purchase paths share vendor stock, service permissions, faction trust and price.
function getShipSaleStatus(shipId) {
  shipId = resolveShipId(shipId);
  const ship = state.shipStatsById[Number(shipId)];
  if (!ship || ship.assetType !== 'ship') return { ok: false, reason: 'That ship is not available.', ship: null };
  if (!state.docked) return { ok: false, reason: 'Dock at a ship seller first.', ship };
  if (!getShipyardStock().some(stockShip => Number(stockShip.id) === Number(shipId))) {
    return { ok: false, reason: `${ship.name} is not stocked here.`, ship };
  }
  const station = getCurrentDockedStation();
  const securityBlock = getSecurityDockingBlock(station ? getStationOwner(station) : getSystemControl(state.currentPlanet).polityId);
  const serviceBlock = securityBlock || serviceRefusal(station?.faction || getSystemFaction(state.currentPlanet));
  if (serviceBlock) return { ok: false, reason: serviceBlock, ship };
  const catalogDecision = getCatalogPurchaseDecision(shipId);
  const price = catalogDecision?.price ?? getShipPrice(ship);
  if (catalogDecision && !catalogDecision.allowed && catalogDecision.reason !== 'funds') {
    return { ok: false, reason: describePurchaseDecision(catalogDecision, ship), ship, price, catalogDecision };
  }
  return { ok: true, reason: 'Ready to purchase.', ship, price, catalogDecision };
}

function getShipPurchaseStatus(shipId) {
  shipId = resolveShipId(shipId);
  const sale = getShipSaleStatus(shipId);
  if (!sale.ok) return sale;
  const { ship, price } = sale;
  if (Number(shipId) === Number(state.playership)) return { ...sale, ok: false, reason: `${ship.name} is already your current ship.` };
  const cargoCapacity = finiteNumber(ship.cargoCapacity, 0);
  if (state.cargo > cargoCapacity) return { ...sale, ok: false, reason: `Cannot transfer: ${ship.name} only holds ${Math.round(cargoCapacity)} cargo.`, cargoCapacity };
  if (state.latinum < price) return { ...sale, ok: false, reason: `Need ${price} latinum to buy ${ship.name}.`, cargoCapacity };
  return { ...sale, cargoCapacity };
}

function getShipPurchaseSummary(shipId) {
  shipId = resolveShipId(shipId);
  const ship = state.shipStatsById[Number(shipId)] || {};
  const currentShip = getShipStats(state.playership) || {};
  const fields = [
    ['Role', ship.role || formatShipClass(ship.shipClass || getShipVisualClass(shipId))],
    ['Required standing', `${ship.purchaseRequirements?.factionStanding ?? getConfiguredPurchaseTierThresholds()[ship.purchaseTier] ?? 'Unavailable'} ${ship.faction === 'neutral' ? 'independent trade' : ship.faction}`],
    ['Your standing', String(getFactionStanding(ship.purchaseRequirements?.faction || ship.faction))],
    ['Reactor / reserve', `${shipPowerProfile(ship).reactorOutput} EU/s / ${shipPowerProfile(ship).energyCapacity} EU`],
    ['Equipment', Array.isArray(ship.defaultWeaponSlots) && !ship.defaultWeaponSlots.some(Boolean) ? '3 empty slots — can be armed' : '3 weapon / device slots'],
    ['Starting fit', getOriginalShipWeaponSlots(shipId).map(id => id ? getWeapon(id).name : 'Empty').join(' / ')],
    ['Class', formatShipClass(ship.shipClass || getShipVisualClass(shipId))],
    ['Faction', formatFaction(getShipFaction(shipId)).replace(/<[^>]+>/g, '')],
    ['Cargo', `${Math.round(finiteNumber(ship.cargoCapacity, 0))} vs ${Math.round(finiteNumber(currentShip.cargoCapacity, 0))}`],
    ['Speed', `${Math.round(finiteNumber(ship.topSpeed, 0))} vs ${Math.round(finiteNumber(currentShip.topSpeed, 0))}`],
    ['Hull', `${Math.round(finiteNumber(ship.hull, 0))} vs ${Math.round(finiteNumber(currentShip.hull, 0))}`],
    ['Shields', `${Math.round(finiteNumber(ship.shields, 0))} vs ${Math.round(finiteNumber(currentShip.shields, 0))}`],
    ['Warp Range', `${getShipWarpRange(shipId)} vs ${getShipWarpRange(state.playership)}`],
  ];
  return fields.map(([label, value]) => `<span>${escapeHtml(label)}</span><b>${escapeHtml(value)}</b>`).join('');
}

function getShipFleetAssignmentOptions(shipId) {
  const escortStatus = canBuyEscortShip(shipId);
  const options = [{
    value: 'escort',
    label: `Escort player (${getPlayerEscortFleetShips().length}/${MAX_PLAYER_ESCORT_SHIPS})`,
    status: escortStatus,
  }];
  for (const systemIndex of getPlayerEmpireSystemIndexes()) {
    const planet = state.planets[systemIndex];
    const status = canBuyFleetShip(shipId, systemIndex);
    options.push({
      value: `system:${systemIndex}`,
      label: `${planet?.name || `System ${systemIndex + 1}`} defense (${getPlayerFleetShips(systemIndex).length}/${MAX_PLAYER_FLEET_SHIPS_PER_SYSTEM})`,
      status,
    });
  }
  return options;
}

function getDefaultFleetAssignmentValue(options) {
  return options.find((option) => option.status?.ok)?.value || options[0]?.value || 'escort';
}

function renderShipPurchaseModal() {
  if (!shipPurchaseModalEl) return;
  const shipId = Number(state.pendingShipPurchase?.shipId);
  const status = getShipPurchaseStatus(shipId);
  if (!state.pendingShipPurchase || !status.ship) {
    shipPurchaseModalEl.classList.add('hidden');
    shipPurchaseModalEl.innerHTML = '';
    return;
  }
  const ship = status.ship;
  const price = status.price ?? getShipPrice(ship);
  const fleetPrice = getFleetShipCost(ship);
  const shipDescription = String(ship.description || '').trim()
    || 'No ship description is available for this design.';
  const assignmentOptions = getShipFleetAssignmentOptions(shipId);
  const selectedAssignment = assignmentOptions.some((option) => option.value === state.pendingShipPurchase.fleetAssignment)
    ? state.pendingShipPurchase.fleetAssignment
    : getDefaultFleetAssignmentValue(assignmentOptions);
  state.pendingShipPurchase.fleetAssignment = selectedAssignment;
  const fleetSelectionOk = assignmentOptions.some((option) => option.value === selectedAssignment && option.status?.ok);
  const optionMarkup = assignmentOptions.map((option) => (
    `<option value="${escapeHtml(option.value)}" ${option.value === selectedAssignment ? 'selected' : ''} ${option.status?.ok ? '' : 'disabled'}>${escapeHtml(option.label)}${option.status?.ok ? '' : ` - ${option.status?.reason || 'Unavailable'}`}</option>`
  )).join('');
  shipPurchaseModalEl.classList.remove('hidden');
  shipPurchaseModalEl.innerHTML = `<div class="ship-purchase-card" role="dialog" aria-modal="true" aria-label="Ship purchase">
    <div class="ship-purchase-head">
      <span>Ship Purchase</span>
      <button class="panel-close" data-ship-purchase-action="cancel" aria-label="Close ship purchase">&times;</button>
    </div>
    <div class="ship-purchase-body">
      <img class="ship-purchase-preview ship-preview-${escapeHtml(getShipVisualClass(shipId))}" src="${escapeHtml(getShipPreviewSrc(shipId))}" alt="">
      <div class="ship-purchase-copy">
        <h2>${escapeHtml(ship.name)}</h2>
        <p>${escapeHtml(shipDescription)}</p>
        <div class="ship-purchase-grid">${getShipPurchaseSummary(shipId)}</div>
        <div class="ship-purchase-cost ${status.ok ? '' : 'blocked'}">
          Personal cost ${escapeHtml(price)} latinum | Fleet cost ${escapeHtml(fleetPrice)} latinum | Balance ${escapeHtml(state.latinum)} latinum
          ${status.ok ? '' : `<br>${escapeHtml(status.reason)}`}
        </div>
        <div class="fleet-assignment-field">
          <label for="fleet-assignment-select">Fleet assignment</label>
          <select id="fleet-assignment-select" data-fleet-assignment>${optionMarkup}</select>
        </div>
      </div>
    </div>
    <div class="ship-purchase-actions">
      <button data-ship-purchase-action="cancel">Cancel</button>
      <button data-ship-purchase-action="confirm" ${status.ok ? '' : 'disabled'}>Buy For Me</button>
      <button data-ship-purchase-action="fleet" ${fleetSelectionOk ? '' : 'disabled'}>Buy For Fleet</button>
    </div>
  </div>`;
}

function openShipPurchaseModal(shipId) {
  shipId = resolveShipId(shipId);
  if (state.gameOver || !state.gameStarted) return;
  if (!requireDocked()) return;
  const status = getShipPurchaseStatus(shipId);
  if (!status.ship) {
    setLog(status.reason);
    return;
  }
  state.pendingShipPurchase = { shipId: Number(shipId) };
  renderShipPurchaseModal();
  setLog(status.ok ? `Review purchase: ${status.ship.name}.` : status.reason);
}

function closeShipPurchaseModal() {
  state.pendingShipPurchase = null;
  renderShipPurchaseModal();
}

function completeShipPurchase(shipId) {
  shipId = resolveShipId(shipId);
  if (state.gameOver || !state.gameStarted) return;
  if (!requireDocked()) return;
  const status = getShipPurchaseStatus(shipId);
  if (!status.ok) {
    setLog(status.reason);
    renderShipPurchaseModal();
    return;
  }
  const ship = status.ship;
  const price = status.price;
  state.latinum -= price;
  state.ew = sanitizeEW();
  state.playership = Number(shipId);
  state.hull = 100;
  applyCurrentShipStats(true);
  applyShipDefaultWeapons(state.playership, true);
  state.pendingShipPurchase = null;
  playGameSound('shipLaunch', { cooldownKey: `purchase:ship:${shipId}`, volume: 0.88 });
  setLog(`Purchased ${ship.name} for ${price} latinum. Warp range ${getShipWarpRange()}.`);
  updateStats();
}

function confirmPendingShipPurchase() {
  const shipId = Number(state.pendingShipPurchase?.shipId);
  if (!shipId) {
    closeShipPurchaseModal();
    return;
  }
  completeShipPurchase(shipId);
}

function confirmPendingFleetShipPurchase() {
  const shipId = Number(state.pendingShipPurchase?.shipId);
  if (!shipId) {
    closeShipPurchaseModal();
    return;
  }
  const select = shipPurchaseModalEl?.querySelector('[data-fleet-assignment]');
  const assignment = select?.value || state.pendingShipPurchase?.fleetAssignment || 'escort';
  if (assignment === 'escort') {
    const status = canBuyEscortShip(shipId);
    if (!status.ok) {
      setLog(status.reason === 'Escort full'
        ? `Your travelling escort already has ${MAX_PLAYER_ESCORT_SHIPS} ships.`
        : `Need ${getFleetShipCost(state.shipStatsById[Number(shipId)])} latinum to commission an escort.`);
      renderShipPurchaseModal();
      return;
    }
    buyEscortShip(shipId);
    state.pendingShipPurchase = null;
    renderShipPurchaseModal();
    return;
  }
  const [, rawSystemIndex] = assignment.split(':');
  const systemIndex = Number(rawSystemIndex);
  if (!Number.isFinite(systemIndex)) {
    setLog('Choose a valid fleet assignment.');
    return;
  }
  const status = canBuyFleetShip(shipId, systemIndex);
  if (!status.ok) {
    setLog(status.reason === 'Control system'
      ? 'Fleet ships can only be assigned to systems you control.'
      : status.reason === 'Fleet full'
        ? `${state.planets[systemIndex]?.name || 'That system'} already has ${MAX_PLAYER_FLEET_SHIPS_PER_SYSTEM} fleet ships.`
        : `Need ${getFleetShipCost(state.shipStatsById[Number(shipId)])} latinum to commission ${state.shipStatsById[Number(shipId)]?.name || 'that ship'}.`);
    renderShipPurchaseModal();
    return;
  }
  buyFleetShip(shipId, systemIndex);
  state.pendingShipPurchase = null;
  renderShipPurchaseModal();
}

function buyShip(shipId) {
  openShipPurchaseModal(shipId);
}

function getFleetPurchaseStatus(shipId) {
  shipId = resolveShipId(shipId);
  const ship = state.shipStatsById[Number(shipId)];
  if (!ship || ship.assetType !== 'ship') {
    return { ok: false, reason: 'That fleet ship is not available.', ship: null };
  }
  const available = getShipyardStock().some((stockShip) => Number(stockShip.id) === Number(shipId));
  if (!available) {
    return { ok: false, reason: `${ship.name} is not stocked here.`, ship };
  }
  return {
    ok: true,
    reason: 'Ready to commission.',
    ship,
    price: getFleetShipCost(ship),
    defense: canBuyFleetShip(shipId, state.currentPlanet),
    escort: canBuyEscortShip(shipId, state.currentPlanet),
  };
}

function renderFleetPurchaseModal() {
  if (!fleetPurchaseModalEl) return;
  const shipId = Number(state.pendingFleetPurchase?.shipId);
  const status = getFleetPurchaseStatus(shipId);
  if (!state.pendingFleetPurchase || !status.ship) {
    fleetPurchaseModalEl.classList.add('hidden');
    fleetPurchaseModalEl.innerHTML = '';
    return;
  }
  const ship = status.ship;
  const price = status.price ?? getFleetShipCost(ship);
  const localName = state.planets[state.currentPlanet]?.name || 'this system';
  fleetPurchaseModalEl.classList.remove('hidden');
  fleetPurchaseModalEl.innerHTML = `<div class="ship-purchase-card fleet-purchase-card" role="dialog" aria-modal="true" aria-label="Fleet commission">
    <div class="ship-purchase-head">
      <span>Fleet Commission</span>
      <button class="panel-close" data-fleet-purchase-action="cancel" aria-label="Close fleet commission">&times;</button>
    </div>
    <div class="ship-purchase-body">
      <img class="ship-purchase-preview ship-preview-${escapeHtml(getShipVisualClass(shipId))}" src="${escapeHtml(getShipPreviewSrc(shipId))}" alt="">
      <div class="ship-purchase-copy">
        <h2>${escapeHtml(ship.name)}</h2>
        <p>Commission this design into your fleet instead of replacing your command ship. Choose whether it guards ${escapeHtml(localName)} or travels with you as an escort.</p>
        <div class="ship-purchase-grid">
          <span>Cost</span><b>${escapeHtml(price)} latinum</b>
          <span>Balance</span><b>${escapeHtml(state.latinum)} latinum</b>
          <span>Local Defense</span><b>${escapeHtml(getPlayerFleetShips(state.currentPlanet).length)}/${escapeHtml(MAX_PLAYER_FLEET_SHIPS_PER_SYSTEM)}</b>
          <span>Escorts</span><b>${escapeHtml(getPlayerEscortFleetShips().length)}/${escapeHtml(MAX_PLAYER_ESCORT_SHIPS)}</b>
          <span>Warp Range</span><b>${escapeHtml(getShipWarpRange(shipId))}</b>
        </div>
        <div class="fleet-choice-grid">
          <button data-fleet-purchase-action="defense" ${status.defense.ok ? '' : 'disabled'}>
            ${status.defense.ok ? `Defend ${escapeHtml(localName)}` : escapeHtml(status.defense.reason)}
          </button>
          <button data-fleet-purchase-action="escort" ${status.escort.ok ? '' : 'disabled'}>
            ${status.escort.ok ? 'Escort Player' : escapeHtml(status.escort.reason)}
          </button>
        </div>
      </div>
    </div>
    <div class="ship-purchase-actions">
      <button data-fleet-purchase-action="cancel">Cancel</button>
      <button data-fleet-purchase-action="defense" ${status.defense.ok ? '' : 'disabled'}>Commission Defense</button>
    </div>
  </div>`;
}

function openFleetPurchaseModal(shipId) {
  shipId = resolveShipId(shipId);
  if (state.gameOver || !state.gameStarted) return;
  if (!requireDocked()) return;
  const status = getFleetPurchaseStatus(shipId);
  if (!status.ship) {
    setLog(status.reason);
    return;
  }
  state.pendingFleetPurchase = { shipId: Number(shipId) };
  renderFleetPurchaseModal();
  setLog(status.ok ? `Review fleet commission: ${status.ship.name}.` : status.reason);
}

function closeFleetPurchaseModal() {
  state.pendingFleetPurchase = null;
  renderFleetPurchaseModal();
}

function confirmFleetPurchase(assignment) {
  const shipId = Number(state.pendingFleetPurchase?.shipId);
  if (!shipId) {
    closeFleetPurchaseModal();
    return;
  }
  if (assignment === 'escort') buyEscortShip(shipId);
  else buyFleetShip(shipId);
}

function buyFleetShip(shipId, systemIndex = state.currentPlanet) {
  shipId = resolveShipId(shipId);
  if (state.gameOver || !state.gameStarted) return;
  if (!requireDocked()) return;
  const ship = state.shipStatsById[Number(shipId)];
  if (!ship || ship.assetType !== 'ship') {
    setLog('That fleet ship is not available.');
    return;
  }
  const available = getShipyardStock().some((stockShip) => Number(stockShip.id) === Number(shipId));
  if (!available) {
    setLog(`${ship.name} is not stocked here.`);
    return;
  }
  const targetSystemIndex = Number.isFinite(Number(systemIndex)) ? Number(systemIndex) : state.currentPlanet;
  const status = canBuyFleetShip(shipId, targetSystemIndex);
  if (!status.ok) {
    setLog(status.reason === 'Control system'
      ? 'Fleet ships can only be assigned to systems you control.'
      : status.reason === 'Fleet full'
        ? `${state.planets[targetSystemIndex]?.name || 'That system'} already has ${MAX_PLAYER_FLEET_SHIPS_PER_SYSTEM} fleet ships.`
        : `Need ${getFleetShipCost(ship)} latinum to commission ${ship.name}.`);
    return;
  }
  const cost = getFleetShipCost(ship);
  state.latinum -= cost;
  state.mylatinum = state.latinum;
  const id = `pf-${Date.now().toString(36)}-${Math.floor(Math.random() * 100000).toString(36)}`;
  const seed = hashString(`${id}-${targetSystemIndex}-${shipId}`);
  const fleetName = generateShipName({ shipId: Number(shipId), faction: state.playerFaction, seed, role: 'playerFleet', id });
  state.playerFleet.push({
    id,
    systemIndex: targetSystemIndex,
    shipId: Number(shipId),
    name: fleetName,
    faction: state.playerFaction,
    seed,
    builtAt: Date.now(),
  });
  if (targetSystemIndex === state.currentPlanet) {
    state.npcShips.push(...getPlayerFleetNpcShips(targetSystemIndex).filter((npc) => npc.fleetId === id));
  }
  state.fleetPurchaseShipId = null;
  state.pendingFleetPurchase = null;
  state.pendingShipPurchase = null;
  playGameSound('purchase', { cooldownKey: `purchase:fleet:${shipId}` });
  setLog(`${fleetName}, ${ship.name}, commissioned into the ${state.planets[targetSystemIndex]?.name || 'selected'} defense fleet for ${cost} latinum.`);
  renderPlanetMenu();
  updateStats();
}

function buyEscortShip(shipId) {
  shipId = resolveShipId(shipId);
  if (state.gameOver || !state.gameStarted) return;
  if (!requireDocked()) return;
  const ship = state.shipStatsById[Number(shipId)];
  if (!ship || ship.assetType !== 'ship') {
    setLog('That escort ship is not available.');
    return;
  }
  const available = getShipyardStock().some((stockShip) => Number(stockShip.id) === Number(shipId));
  if (!available) {
    setLog(`${ship.name} is not stocked here.`);
    return;
  }
  const status = canBuyEscortShip(shipId, state.currentPlanet);
  if (!status.ok) {
    setLog(status.reason === 'Control system'
      ? 'Escort ships can only be commissioned from systems you control.'
      : status.reason === 'Escort full'
        ? `Your travelling escort already has ${MAX_PLAYER_ESCORT_SHIPS} ships.`
        : `Need ${getFleetShipCost(ship)} latinum to commission ${ship.name}.`);
    return;
  }
  const cost = getFleetShipCost(ship);
  state.latinum -= cost;
  state.mylatinum = state.latinum;
  const id = `pe-${Date.now().toString(36)}-${Math.floor(Math.random() * 100000).toString(36)}`;
  const seed = hashString(`${id}-${state.currentPlanet}-${shipId}-escort`);
  const fleetName = generateShipName({ shipId: Number(shipId), faction: state.playerFaction, seed, role: 'playerEscort', id });
  state.playerFleet.push({
    id,
    systemIndex: state.currentPlanet,
    shipId: Number(shipId),
    name: fleetName,
    faction: state.playerFaction,
    assignment: 'escort',
    seed,
    builtAt: Date.now(),
  });
  state.npcShips.push(...getPlayerEscortNpcShips().filter((npc) => npc.fleetId === id));
  state.fleetPurchaseShipId = null;
  state.pendingFleetPurchase = null;
  state.pendingShipPurchase = null;
  playGameSound('purchase', { cooldownKey: `purchase:escort:${shipId}` });
  setLog(`${fleetName}, ${ship.name}, commissioned as a travelling escort for ${cost} latinum.`);
  renderPlanetMenu();
  updateStats();
}

function getGodModeWeaponInventory(shipId = state.playership) {
  const defaultWeapons = getOriginalShipWeaponSlots(shipId).filter(Boolean);
  const currentWeapons = Array.isArray(state.weaponInventory) ? state.weaponInventory : [];
  const catalogWeapons = WEAPON_CATALOG.map((weapon) => weapon.id);
  return [...defaultWeapons, ...currentWeapons, ...catalogWeapons]
    .filter((weaponId, index, list) => hasWeaponDefinition(weaponId) && list.indexOf(weaponId) === index);
}

function grantGodResources({ refresh = true, announce = true } = {}) {
  const preservedCargoArray = cloneCargoPods();
  state.godMode = true;
  state.latinum = GOD_MODE_LATINUM;
  state.mylatinum = GOD_MODE_LATINUM;
  state.duranium = GOD_MODE_DURANIUM;
  state.myduranium = GOD_MODE_DURANIUM;
  state.fuelCap = Math.max(GOD_MODE_FUEL_CAP, finiteNumber(state.fuelCap, 0));
  state.antimatter = state.fuelCap;
  state.myantimatter = state.antimatter;
  state.fuel = state.antimatter;
  state.cargoCap = Math.max(GOD_MODE_CARGO_CAP, finiteNumber(state.cargoCap, 0));
  state.totcargo = state.cargoCap;
  state.hull = 100;
  state.shields = 100;
  state.lastShieldHitAt = 0;
  state.cargoArray = preservedCargoArray;
  recalcCargoFromPods();
  restoreMissingContractCargo();
  state.weaponInventory = getGodModeWeaponInventory(state.playership);
  state.stationPlans = getBuildableStationTypes().map((station) => Number(station.id));
  const loadout = [DEFAULT_WEAPON_ID, 15, 25]
    .filter((weaponId, index, list) => hasWeaponDefinition(weaponId) && list.indexOf(weaponId) === index);
  state.weaponSlots = [loadout[0] || getDefaultWeaponId(), loadout[1] || null, loadout[2] || null];
  state.equippedWeaponId = state.weaponSlots[0] || DEFAULT_WEAPON_ID;
  normalizeWeaponLoadout();
  syncLegacyState();
  if (announce) setLog('God Mode enabled: credits, duranium, antimatter, hull, shields and all weapons unlocked.');
  if (refresh) updateStats();
}

function switchGodShip(shipId) {
  shipId = resolveShipId(shipId);
  if (state.gameOver || !state.gameStarted) return;
  const ship = state.shipStatsById[Number(shipId)];
  if (!ship || ship.assetType !== 'ship') {
    setLog('That ship is not available for God Mode.');
    return;
  }
  const preservedCargoArray = cloneCargoPods();
  state.godMode = true;
  state.playership = Number(shipId);
  state.ship.velocity = 0;
  state.ship.forwardThrustStartedAt = 0;
  state.ship.systemWarpIntensity = 0;
  state.cargoArray = preservedCargoArray;
  recalcCargoFromPods();
  applyCurrentShipStats(true);
  grantGodResources({ refresh: false, announce: false });
  setLog(`God Mode: switched to ${ship.name}. Warp range ${getShipWarpRange(shipId)}.`);
  updateStats();
}

function updateMenu(menu = state.mymenu, panel = state.cargopanel) {
  state.mymenu = menu;
  state.cargopanel = panel;
}

function saveGame(slot = state.currentSaveSlot || 1) {
  captureShipPowerState();
  syncFuelToAntimatter();
  normalizePlayerFleetNames();
  const saveSlot = clamp(Math.round(Number(slot) || 1), 1, SAVE_SLOT_COUNT);
  const payload = {
    sensorVersion: 1, ...snapshotActorSensors(state), sensorArchives: snapshotSensorArchives(),
    savedAt: new Date().toISOString(),
    saveSlot,
    ship: state.ship,
    camera: state.camera,
    currentPlanet: state.currentPlanet,
    cargo: state.cargo,
    cargoCap: state.cargoCap,
    latinum: state.latinum,
    shipPurchaseTierThresholds: getConfiguredPurchaseTierThresholds() || null,
    duranium: state.duranium,
    antimatter: state.antimatter,
    fuel: state.fuel,
    fuelCap: state.fuelCap,
    hull: state.hull,
    shields: state.shields,
    lastShieldHitAt: state.lastShieldHitAt,
    day: state.day,
    deliveredCargo: state.deliveredCargo,
    tradeLaneRestored: state.tradeLaneRestored,
    mapOpen: state.mapOpen,
    planetMenuOpen: state.planetMenuOpen,
    selectedPlanet: state.selectedPlanet,
    activeContract: state.activeContract,
    openContracts: normalizeOpenContracts(),
    expneg: state.expneg,
    myplanet: state.myplanet,
    mylatinum: state.mylatinum,
    myduranium: state.myduranium,
    myantimatter: state.myantimatter,
    mycargo: state.mycargo,
    totcargo: state.totcargo,
    cargoArray: state.cargoArray,
    playership: state.playership,
    playerFaction: state.playerFaction,
    playerFlags: normalizePlayerFlags(),
    captainName: state.captainName,
    shipName: state.shipName,
    godMode: state.godMode,
    weaponInventory: state.weaponInventory,
    equippedWeaponId: state.equippedWeaponId,
    weaponSlots: state.weaponSlots,
    weaponLastFiredAt: state.weaponLastFiredAt,
    stationPlans: state.stationPlans,
    playerBuiltStations: state.playerBuiltStations,
    playerWormholes: state.playerWormholes,
    playerFleet: state.playerFleet,
    controlledSystems: state.controlledSystems,
    stationOwners: state.stationOwners || {},
    securityPolicies: ensureSecurityPolicies(),
    securityZones: ensureSecurityZones(),
    securityEncounters: (captureSecurityParticipants(state.securityLiveSystemIndex), ensureSecurityEncounters()),
    visitedSystems: state.visitedSystems,
    factionSystemOverrides: state.factionSystemOverrides,
    destroyedStations: state.destroyedStations,
    depletedAsteroids: state.depletedAsteroids,
    mytech: state.mytech,
    mymenu: state.mymenu,
    cargopanel: state.cargopanel,
    planetMarkets: state.planetMarkets,
    factionStanding: state.factionStanding || {},
    feats: state.feats || {},
    autoTarget: state.autoTarget !== false,
    fleetStance: state.fleetStance || 'follow',
    auxLaunched: Boolean(state.auxLaunched),
    spawnProtectionUntil: 0,
    power: powerSnapshot(ensurePlayerPower()),
    gameOver: state.gameOver,
    victory: state.victory,
  };
  localStorage.setItem(getSaveSlotKey(saveSlot), JSON.stringify(payload));
  if (saveSlot === 1) localStorage.setItem(LEGACY_SAVE_KEY, JSON.stringify(payload));
  state.currentSaveSlot = saveSlot;
  setLog(`Game saved to slot ${saveSlot}.`);
  renderTopLeftPanel();
}

function loadGame(slot = state.currentSaveSlot || 1) {
  const saveSlot = clamp(Math.round(Number(slot) || 1), 1, SAVE_SLOT_COUNT);
  const raw = getSaveSlotRaw(saveSlot);
  if (!raw) return setLog(`No save found in slot ${saveSlot}.`);
  const s = JSON.parse(raw);
  state.currentSaveSlot = saveSlot;
  Object.assign(state.ship, s.ship || {});
  Object.assign(state.camera, s.camera || {});
  state.currentPlanet = s.currentPlanet ?? 0;
  state.cargo = s.cargo ?? 0;
  state.cargoCap = s.cargoCap ?? 20;
  state.latinum = s.latinum ?? 100;
  state.shipPurchaseTierThresholds = s.shipPurchaseTierThresholds && typeof s.shipPurchaseTierThresholds === 'object'
    ? s.shipPurchaseTierThresholds
    : null;
  state.duranium = s.duranium ?? s.myduranium ?? 0;
  state.fuelCap = s.fuelCap ?? 100;
  state.antimatter = s.antimatter ?? s.fuel ?? 6;
  syncFuelToAntimatter();
  state.hull = s.hull ?? 100;
  state.shields = s.shields ?? 100;
  state.lastShieldHitAt = s.lastShieldHitAt ?? 0;
  state.day = s.day ?? 1;
  state.deliveredCargo = s.deliveredCargo ?? 0;
  state.tradeLaneRestored = Boolean(s.tradeLaneRestored ?? (s.victory && state.deliveredCargo >= state.missionCargoGoal));
  state.mapOpen = false;
  state.planetMenuOpen = false;
  state.dockMenuTab = 'services';
  state.selectedPlanet = s.selectedPlanet ?? 1;
  state.activeContract = s.activeContract ?? null;
  state.openContracts = Array.isArray(s.openContracts)
    ? s.openContracts.map(normalizeContract).filter(Boolean)
    : [];
  normalizeOpenContracts();
  state.pendingContractOffer = null;
  state.missionCompleteNotice = null;
  renderMissionCompleteModal();
  state.pendingShipPurchase = null;
  state.pendingFleetPurchase = null;
  state.pendingStationBuild = null;
  state.pendingWormholeBuild = null;
  state.tractorBeams = [];
  state.expneg = s.expneg ?? 0;
  state.myplanet = s.myplanet ?? (s.currentPlanet ?? 0) + 1;
  state.mylatinum = s.mylatinum ?? (s.latinum ?? 100);
  state.myduranium = s.myduranium ?? state.duranium;
  state.myantimatter = state.antimatter;
  state.mycargo = s.mycargo ?? (s.cargo ?? 0);
  state.totcargo = s.totcargo ?? (s.cargoCap ?? 20);
  state.cargoArray = s.cargoArray ?? state.cargoArray;
  state.playership = resolveOwnedShipId(state.shipCatalog, s.playership ?? 18);
  state.playerFaction = s.playerFaction ?? getShipFaction(state.playership);
  state.playerFlags = Array.isArray(s.playerFlags) ? s.playerFlags : [state.playerFaction];
  normalizePlayerFlags();
  state.factionStanding = (s.factionStanding && typeof s.factionStanding === 'object') ? s.factionStanding : {};
  state.feats = (s.feats && typeof s.feats === 'object') ? s.feats : {};
  state.autoTarget = s.autoTarget !== false;
  state.spawnProtectionUntil = performance.now() + 8000;
  state.fleetStance = typeof s.fleetStance === 'string' ? s.fleetStance : 'follow';
  state.auxLaunched = Boolean(s.auxLaunched);
  state.power = { energy: finiteNumber(s.power?.energy, 200), dist: normalizePowerDist(s.power?.dist) };
  state.sensorArchives = s.sensorVersion === 1 ? restoreSensorArchives(s.sensorArchives) : {};
  state.sensors = s.sensorVersion === 1 ? ensureSensorEquipment(s.sensors) : null;
  state.ew = sanitizeEW(s.ew);
  state.sensorReports = s.sensorVersion === 1 ? s.sensorReports || [] : [];
  sensorWorld.clear(null); sensorActors.clear();
  state.captainName = sanitizePlayerName(s.captainName, 'Captain');
  state.shipName = sanitizeShipName(s.shipName, getShipStats(state.playership).name || 'Ship');
  state.godMode = Boolean(s.godMode);
  state.weaponInventory = s.weaponInventory ?? [getDefaultWeaponId(state.playership, state.playerFaction)];
  state.equippedWeaponId = s.equippedWeaponId ?? state.weaponInventory[0] ?? DEFAULT_WEAPON_ID;
  state.weaponSlots = s.weaponSlots ?? [state.equippedWeaponId, null, null];
  state.weaponLastFiredAt = [0, 0, 0];
  state.cloak = { active: false, startedAt: 0, duration: finiteNumber(getCloakItemSettings().durationMs, CLOAK_DURATION_MS) };
  state.stationPlans = Array.isArray(s.stationPlans) ? s.stationPlans : [];
  normalizeStationPlans();
  state.playerBuiltStations = Array.isArray(s.playerBuiltStations) ? s.playerBuiltStations : [];
  state.playerWormholes = Array.isArray(s.playerWormholes)
    ? s.playerWormholes.map(normalizeWormholeLink).filter(Boolean)
    : [];
  state.playerFleet = Array.isArray(s.playerFleet) ? s.playerFleet : [];
  normalizePlayerFleetNames();
  state.factionSystemOverrides = s.factionSystemOverrides && typeof s.factionSystemOverrides === 'object' ? s.factionSystemOverrides : {};
  state.destroyedStations = s.destroyedStations && typeof s.destroyedStations === 'object' ? s.destroyedStations : {};
  state.depletedAsteroids = s.depletedAsteroids && typeof s.depletedAsteroids === 'object' ? s.depletedAsteroids : {};
  state.stationOwners = s.stationOwners && typeof s.stationOwners === 'object' ? { ...s.stationOwners } : null;
  state.securityPolicies = { default: null, systems: {} };
  if (s.securityPolicies && typeof s.securityPolicies === 'object') {
    state.securityPolicies.default = sanitizeSecurityPolicy(s.securityPolicies.default);
    for (const [key, override] of Object.entries(s.securityPolicies.systems || {})) {
      const clean = sanitizeSecurityPolicy(override);
      if (Object.keys(clean).length && Number.isFinite(Number(key))) state.securityPolicies.systems[Number(key)] = clean;
    }
  }
  // Saves from before holding zones existed load with no player checkpoints and no active orders.
  state.securityZones = sanitizeSecurityZonesRecord(s.securityZones);
  state.securityEncounters = sanitizeSecurityEncountersRecord(s.securityEncounters);
  state.securityLiveSystemIndex = null; // the NPCs about to be discarded are not this save's participants
  state.securityOutcomeNotice = null;
  state.controlledSystems = Array.isArray(s.controlledSystems)
    ? s.controlledSystems.map((index) => Number(index)).filter(Number.isFinite)
    : [state.currentPlanet];
  state.visitedSystems = Array.isArray(s.visitedSystems)
    ? s.visitedSystems.map((index) => Number(index)).filter(Number.isFinite)
    : [state.currentPlanet];
  state.mytech = s.mytech ?? [undefined, 52];
  state.mymenu = s.mymenu ?? 0;
  state.cargopanel = s.cargopanel ?? 0;
  state.planetMarkets = s.planetMarkets ?? {};
  const legacyMissionCompleteScreen = Boolean(s.gameOver && s.victory && state.hull > 0);
  state.gameOver = legacyMissionCompleteScreen ? false : Boolean(s.gameOver);
  state.victory = false;
  state.warp.active = false;
  clearWormholeTransit();
  state.docked = false;
  state.dockedPlanetIndex = null;
  state.dockedStationId = null;
  state.systemStates = {};
  state.npcShips = [];
  state.activeFleetAttack = null;
  state.fleetAttackControlSince = 0;
  rebuildTravelRoutes();
  closePlanetMenu();
  state.currentPlanet = Math.max(0, state.myplanet - 1);
  markSystemVisited(state.currentPlanet);
  syncPlayerBuiltStationDefinitions();
  // Saves from before ownership records existed: derive them once from held systems, so the
  // answers an old save gave keep holding, then record everything explicitly from here on.
  if (!state.stationOwners) state.stationOwners = migrateStationOwners();
  applySystemState(state.currentPlanet);
  scheduleNextFleetAttack(performance.now() + 20000);
  if (!s.camera) setCameraNearPlanet();
  state.latinum = state.mylatinum;
  syncFuelToAntimatter();
  state.cargoCap = state.totcargo;
  applyCurrentShipStats(false);
  if (state.godMode) grantGodResources({ refresh: false, announce: false });
  normalizeWeaponLoadout();
  recalcCargoFromPods();
  state.gameStarted = true;
  if (startMenuEl) startMenuEl.style.display = 'none';
  stopAllGameAudioLoops();
  playGameSound('shipLaunch', { cooldownKey: 'ship:load' });
  setLog(`${state.captainName} aboard ${state.shipName}. Game loaded from slot ${saveSlot}.`);
  updateStats();
}

function closeMap() {
  if (!state.mapOpen) return;
  if (state.warp.active || isWormholeTransitActive()) return;
  state.mapOpen = false;
  syncInterstellarMapFrame();
  setLog('Closed interstellar map.');
  updateStats();
}

function syncInterstellarMapFrame() {
  const visible = Boolean(state.gameStarted && state.mapOpen && !state.warp.active && !isWormholeTransitActive());
  document.body.classList.toggle('map-open', visible);
  interstellarMapFrameEl?.classList.toggle('hidden', !visible);
  interstellarMapFrameEl?.setAttribute('aria-hidden', visible ? 'false' : 'true');
  interstellarMapCanvas?.classList.toggle('hidden', !visible);
  interstellarMapCanvas?.setAttribute('aria-hidden', visible ? 'false' : 'true');
  if (visible) {
    const panel = getStarChartPanelRect();
    const rect = canvas.getBoundingClientRect();
    const scaleX = rect.width / canvas.width;
    const scaleY = rect.height / canvas.height;
    const panelLeft = rect.left + panel.left * scaleX;
    const panelTop = rect.top + panel.top * scaleY;
    const panelRight = rect.left + panel.right * scaleX;
    const panelBottom = rect.top + panel.bottom * scaleY;
    const clipPad = 10;
    const closeSize = 26;
    const closeTop = rect.top + (panel.top + panel.headerH * 0.36) * scaleY - closeSize / 2;
    let closeLeft = panelRight - closeSize - 12 * scaleX;
    closeLeft = Math.max(panelLeft + panel.railW * scaleX + 8 * scaleX, closeLeft);
    interstellarMapFrameEl?.style.setProperty('--map-close-top', `${closeTop}px`);
    interstellarMapFrameEl?.style.setProperty('--map-close-left', `${closeLeft}px`);
    if (interstellarMapCanvas) {
      interstellarMapCanvas.style.setProperty('--map-panel-clip-top', `${Math.max(0, panelTop - clipPad)}px`);
      interstellarMapCanvas.style.setProperty('--map-panel-clip-right', `${Math.max(0, window.innerWidth - panelRight - clipPad)}px`);
      interstellarMapCanvas.style.setProperty('--map-panel-clip-bottom', `${Math.max(0, window.innerHeight - panelBottom - clipPad)}px`);
      interstellarMapCanvas.style.setProperty('--map-panel-clip-left', `${Math.max(0, panelLeft - clipPad)}px`);
    }
  } else if (interstellarMapCtx && interstellarMapCanvas) {
    interstellarMapCtx.clearRect(0, 0, interstellarMapCanvas.width, interstellarMapCanvas.height);
  }
}

function addCargoToPods(item, tons = 1, destination = undefined, payout = 0, options = {}) {
  const amount = Math.max(0, Number(tons || 0));
  if (amount <= 0) return false;
  if (state.godMode && state.cargo + amount > state.cargoCap) {
    state.cargoCap = state.cargo + amount;
    state.totcargo = state.cargoCap;
  } else if (state.cargo + amount > state.cargoCap) {
    return false;
  }
  const destinationIndex = Number.isFinite(Number(options.destinationIndex))
    ? Number(options.destinationIndex)
    : findPlanetIndexByName(destination);
  const destinationName = destination || (destinationIndex >= 0 ? state.planets[destinationIndex]?.name : undefined);
  const destinationKey = getCargoDestinationKeyFromValues(destinationName, destinationIndex);

  for (const pod of state.cargoArray) {
    if (pod.item === item && getCargoDestinationKey(pod) === destinationKey) {
      pod.tons += amount;
      pod.destination = destinationName;
      if (destinationIndex >= 0) pod.destinationIndex = destinationIndex;
      if (options.contractId) pod.contractId = String(options.contractId);
      pod.payout = Number(pod.payout || 0) + Number(payout || 0);
      recalcCargoFromPods();
      return true;
    }
  }
  for (const pod of state.cargoArray) {
    if (!pod.tons || pod.item === 'Nothing') {
      pod.tons = amount;
      pod.item = item;
      pod.destination = destinationName;
      if (destinationIndex >= 0) pod.destinationIndex = destinationIndex;
      if (options.contractId) pod.contractId = String(options.contractId);
      pod.payout = Number(payout || 0);
      recalcCargoFromPods();
      return true;
    }
  }
  if (state.godMode) {
    const pod = {
      tons: amount,
      item,
      destination: destinationName,
      payout: Number(payout || 0),
    };
    if (destinationIndex >= 0) pod.destinationIndex = destinationIndex;
    if (options.contractId) pod.contractId = String(options.contractId);
    state.cargoArray.push(pod);
    recalcCargoFromPods();
    return true;
  }
  return false;
}

function removeCargoFromPods(item, tons = 1) {
  for (const pod of state.cargoArray) {
    if (pod.item === item && pod.tons > 0 && pod.destination === undefined) {
      const take = Math.min(tons, pod.tons);
      pod.tons -= take;
      if (pod.tons <= 0) {
        clearCargoPod(pod);
      }
      recalcCargoFromPods();
      return take;
    }
  }
  return 0;
}

function deliverDestinationCargoAtCurrentPlanet() {
  const planet = state.planets[state.currentPlanet];
  restoreMissingContractCargo({ onlyCurrentDestination: true });
  let delivered = 0;
  let payout = 0;
  const goods = [];
  const deliveredCargoRows = [];
  const deliveredContractIds = new Set();
  const deliveredContractKeys = new Set();
  const deliveredContractNames = new Set();

  for (const pod of state.cargoArray) {
    if (isCargoDueAtCurrentPlanet(pod)) {
      const podTons = Number(pod.tons || 0);
      const podPayout = Number(pod.payout || 0);
      const podItem = pod.item;
      delivered += podTons;
      payout += podPayout;
      goods.push(podItem);
      deliveredCargoRows.push({ item: podItem, tons: podTons, payout: podPayout });
      if (pod.contractId) deliveredContractIds.add(String(pod.contractId));
      deliveredContractKeys.add(`${pod.item}::${state.currentPlanet}`);
      deliveredContractNames.add(`${pod.item}::${normalizePlaceName(getCargoDestinationName(pod) || planet.name)}`);
      clearCargoPod(pod);
    }
  }

  if (delivered <= 0) return false;

  const restoredBefore = Boolean(state.tradeLaneRestored);
  state.latinum += payout;
  state.deliveredCargo += delivered;
  recalcCargoFromPods();

  const completedContracts = [];
  state.openContracts = getOpenContracts().filter((contract) => {
    const targetIndex = Number.isFinite(Number(contract.targetIndex))
      ? Number(contract.targetIndex)
      : findPlanetIndexByName(contract.targetName);
    if (deliveredContractIds.has(String(contract.id))
      || deliveredContractKeys.has(`${contract.goods}::${targetIndex}`)
      || deliveredContractNames.has(`${contract.goods}::${normalizePlaceName(contract.targetName)}`)) {
      completedContracts.push(contract);
      return false;
    }
    return true;
  });
  state.activeContract = state.openContracts[0] || null;
  const standingRewards = {};
  const awardStanding = (faction, gain) => {
    if (faction !== 'neutral' && !isRecognizedFactionKey(faction)) return;
    const before = getFactionStanding(faction);
    adjustFactionStanding(faction, gain, { silent: true });
    standingRewards[faction] = (standingRewards[faction] || 0) + getFactionStanding(faction) - before;
  };
  for (const contract of completedContracts) {
    const destinationFaction = getTradeStandingFaction(state.currentPlanet);
    awardStanding(destinationFaction, 5);
    if (contract.employerFaction !== destinationFaction) awardStanding(contract.employerFaction, 2);
  }

  checkWinLose();
  playGameSound('cargo', { cooldownKey: `delivery:${state.currentPlanet}` });
  const milestone = !restoredBefore && state.tradeLaneRestored
    ? ' Trade lane restored; you can keep taking contracts and spend your latinum.'
    : '';
  setLog(`Delivered ${delivered} tons of ${goods.join(', ')} at ${planet.name} for ${payout} latinum.${milestone}`);
  showTradeMissionComplete({
    planetName: planet.name,
    delivered,
    payout,
    cargo: deliveredCargoRows,
    standingRewards,
    milestone: !restoredBefore && state.tradeLaneRestored,
  });
  updateStats();
  return true;
}

function getPlanetMarket(planetIndex = state.currentPlanet) {
  if (state.planetMarkets[planetIndex]) return state.planetMarkets[planetIndex];
  const offers = Array.from({ length: 8 }, (_, i) => {
    const goodsIndex = Math.floor(seeded((planetIndex + 1) * 97 + i * 13) * state.tradeGoodsArray.length);
    const price = 1 + Math.floor(seeded((planetIndex + 1) * 151 + i * 29) * 10);
    return {
      goods: state.tradeGoodsArray[goodsIndex],
      price,
    };
  });
  state.planetMarkets[planetIndex] = offers;
  return offers;
}

function currentMarketOffers() {
  return getPlanetMarket(state.currentPlanet);
}

function getLooseCargoPods() {
  return state.cargoArray
    .map((pod, index) => ({ ...pod, index, tons: Number(pod.tons || 0) }))
    .filter((pod) => pod.tons > 0 && pod.item && pod.item !== 'Nothing' && pod.destination === undefined);
}

function getNpcHailTone(npc) {
  if (!npc || npc.destroyed) return 'neutral';
  if (npc.hostile || npc.attitude === 'hostile') return 'hostile';
  if (npc.attitude === 'friendly' || getFactionAttitude(npc.faction) === 'friendly') return 'friendly';
  return 'neutral';
}

function getNpcHailBlockReason(npc, now = performance.now()) {
  if (!npc || npc.destroyed) return 'No signal.';
  if (npc.playerAggroUntil && npc.playerAggroUntil > now) return 'Combat channel closed. This ship is actively engaged.';
  const destinationName = String(npc.destinationName || '').toLowerCase();
  if (
    npc.attackId
    || npc.role === 'fleetAttack'
    || destinationName === 'player'
    || destinationName.startsWith('raid:')
    || destinationName.startsWith('defend:')
    || destinationName.includes('station target')
  ) return 'Combat channel closed. This ship is actively engaged.';
  if (normalizeFactionKey(npc.faction) === 'borg') return 'We are the Borg. You will be assimilated.';
  if (npc.hostile || npc.attitude === 'hostile') return 'Hostile ship. They are not accepting hails or trade.';
  return '';
}

function createShipHailSession(npc) {
  const seedBase = finiteNumber(npc?.seed, 1) + state.currentPlanet * 977 + Math.floor(performance.now() / 1500);
  const tone = getNpcHailTone(npc);
  const lines = shipHailLines[tone] || shipHailLines.neutral;
  const line = lines[Math.floor(seeded(seedBase + 11) * lines.length) % lines.length];
  const canTrade = tone !== 'hostile' && !npc?.hostile;
  const sellGood = state.tradeGoodsArray[Math.floor(seeded(seedBase + 23) * state.tradeGoodsArray.length) % state.tradeGoodsArray.length];
  const sellTons = 1 + Math.floor(seeded(seedBase + 29) * 4);
  const sellPrice = Math.round((3 + Math.floor(seeded(seedBase + 31) * 13)) * sellTons);
  const cargoPods = getLooseCargoPods();
  const wantedPod = cargoPods.length
    ? cargoPods[Math.floor(seeded(seedBase + 37) * cargoPods.length) % cargoPods.length]
    : null;
  const buyTons = wantedPod ? Math.min(wantedPod.tons, 1 + Math.floor(seeded(seedBase + 41) * 3)) : 0;
  const buyPrice = wantedPod ? Math.round((5 + Math.floor(seeded(seedBase + 43) * 16)) * buyTons) : 0;
  return {
    id: `${npc?.id || 'ship'}-${Date.now()}`,
    tone,
    line,
    sellOffer: canTrade ? { goods: sellGood, tons: sellTons, price: sellPrice, sold: false } : null,
    buyOffer: canTrade && wantedPod ? { goods: wantedPod.item, tons: buyTons, price: buyPrice, bought: false } : null,
  };
}

function getSelectedNpcTarget() {
  if (state.combatTargetType !== 'ship' || !state.combatTargetId) return null;
  return state.npcShips.find((npc) => npc.id === state.combatTargetId && !npc.destroyed) || null;
}

function getShipCombatRating(shipId) {
  const stats = getShipStats(shipId);
  const slots = getOriginalShipWeaponSlots(Number(shipId)).filter(Boolean);
  const gun = slots.length ? getScaledWeaponDamage(Number(shipId), getWeapon(slots[0])) : 0;
  const power = finiteNumber(stats.hull, 0) + finiteNumber(stats.shields, 0) + finiteNumber(stats.topSpeed, 0) * 2 + gun * 2;
  if (power < 150) return 'Harmless';
  if (power < 350) return 'Light';
  if (power < 600) return 'Decent';
  if (power < 900) return 'Above Average';
  if (power < 1400) return 'Dangerous';
  return 'Deadly';
}
function scanSelectedShip() { return startSensorAction('focus'); }

function rerenderTargetWindowNow() {
  if (targetWindowEl) targetWindowEl.dataset.renderKey = '';
  targetWindowForceRender = true;
  updateTargetWindow();
  targetWindowForceRender = false;
}

function hailSelectedShip() {
  if (state.gameOver || !state.gameStarted || state.warp.active || isWormholeTransitActive()) return;
  const npc = getSelectedNpcTarget();
  if (!npc) {
    setLog('No ship selected to hail.');
    return;
  }
  const distance = distanceToPlayer(npc);
  if (distance > SHIP_HAIL_RANGE) {
    playGameSound('uiError', { cooldownKey: 'hail:error' });
    setLog(`Move within ${SHIP_HAIL_RANGE} units to hail ${getShipDisplayName(npc)}.`);
    rerenderTargetWindowNow();
    return;
  }
  const blockReason = getNpcHailBlockReason(npc);
  if (blockReason) {
    playGameSound('uiError', { cooldownKey: 'hail:error' });
    setLog(blockReason);
    rerenderTargetWindowNow();
    return;
  }
  npc.hailSession = createShipHailSession(npc);
  playGameSound('hail', { cooldownKey: `hail:${npc.id}` });
  setLog(`${getShipDisplayName(npc)} responds: ${npc.hailSession.line}`);
  rerenderTargetWindowNow();
}

function buyCargoFromHailedShip() {
  const npc = getSelectedNpcTarget();
  const offer = npc?.hailSession?.sellOffer;
  if (!npc || !offer || offer.sold) return;
  if (distanceToPlayer(npc) > SHIP_HAIL_RANGE) {
    setLog('The trader has drifted out of hail range.');
    rerenderTargetWindowNow();
    return;
  }
  if (state.latinum < offer.price) {
    setLog(`Need ${offer.price} latinum to buy ${offer.tons} tons of ${offer.goods}.`);
    return;
  }
  if (!addCargoToPods(offer.goods, offer.tons, undefined, 0)) {
    setLog(`No cargo room for ${offer.tons} tons of ${offer.goods}.`);
    return;
  }
  state.latinum -= offer.price;
  state.mylatinum = state.latinum;
  offer.sold = true;
  playGameSound('purchase', { cooldownKey: 'hail:purchase' });
  setLog(`Bought ${offer.tons} tons of ${offer.goods} from ${getShipDisplayName(npc)} for ${offer.price} latinum.`);
  updateStats();
  rerenderTargetWindowNow();
}

function sellCargoToHailedShip() {
  const npc = getSelectedNpcTarget();
  const offer = npc?.hailSession?.buyOffer;
  if (!npc || !offer || offer.bought) return;
  if (distanceToPlayer(npc) > SHIP_HAIL_RANGE) {
    setLog('The buyer has drifted out of hail range.');
    rerenderTargetWindowNow();
    return;
  }
  const sold = removeCargoFromPods(offer.goods, offer.tons);
  if (sold <= 0) {
    setLog(`You have no loose ${offer.goods} to sell.`);
    rerenderTargetWindowNow();
    return;
  }
  const payout = Math.round(offer.price * (sold / Math.max(1, offer.tons)));
  state.latinum += payout;
  state.mylatinum = state.latinum;
  offer.bought = true;
  playGameSound('cargo', { cooldownKey: 'hail:sell' });
  setLog(`Sold ${sold} tons of ${offer.goods} to ${getShipDisplayName(npc)} for ${payout} latinum.`);
  updateStats();
  rerenderTargetWindowNow();
}

function updatePlanetMarketVariance() {
  for (const [planetIndex, offers] of Object.entries(state.planetMarkets)) {
    for (let i = 0; i < offers.length; i++) {
      const deltaSeed = seeded((Number(planetIndex) + 1) * 211 + state.day * 37 + i * 17);
      const delta = Math.floor(deltaSeed * 5) - 2;
      offers[i].price = Math.max(1, Math.min(20, offers[i].price + delta));
    }
  }
}

function createCargoRunOffer() {
  const targetIndex = (state.currentPlanet + 1 + Math.floor(Math.random() * (state.planets.length - 1))) % state.planets.length;
  const targetSystem = ensureSystemState(targetIndex);
  const goods = state.tradeGoodsArray[Math.floor(Math.random() * state.tradeGoodsArray.length)];
  const tons = 2 + Math.floor(Math.random() * 5);
  const hazardPay = targetSystem.hasAsteroids || targetSystem.hasNebula ? 1 + Math.floor(Math.random() * 10) : 0;
  const basePay = 4 + Math.floor(Math.random() * 16);
  const station = getCurrentDockedStation();
  const stationStats = station ? getShipStats(station.stationTypeId) : null;
  const origin = state.planets[state.currentPlanet];
  const hazards = [];
  if (targetSystem.hasAsteroids) hazards.push('asteroid traffic');
  if (targetSystem.hasNebula) hazards.push('nebula interference');
  return {
    id: `contract-${Date.now().toString(36)}-${Math.floor(Math.random() * 100000).toString(36)}`,
    goods,
    targetIndex,
    targetName: state.planets[targetIndex].name,
    tons,
    payPerTon: basePay + hazardPay,
    hazardPay,
    originIndex: state.currentPlanet,
    originName: origin?.name || 'Local space',
    employerName: station?.name || stationStats?.name || origin?.name || 'Contract Office',
    employerType: station ? 'station' : 'planet',
    employerFaction: getTradeStandingFaction(state.currentPlanet, station),
    hazards,
    createdAt: Date.now(),
    negotiated: false,
  };
}

function renderMissionCompleteModal() {
  if (!missionCompleteModalEl) return;
  const notice = state.missionCompleteNotice;
  if (!notice) {
    missionCompleteModalEl.classList.add('hidden');
    missionCompleteModalEl.innerHTML = '';
    return;
  }
  const standingText = Object.entries(notice.standingRewards || {}).filter(([, gain]) => gain > 0).map(([faction, gain]) => `+${gain} ${faction === 'neutral' ? 'independent trade' : faction} standing`).join(' · ');
  const cargoRows = Array.isArray(notice.cargo) && notice.cargo.length
    ? notice.cargo
    : [{ item: notice.goods || 'Cargo', tons: notice.delivered || 0, payout: notice.payout || 0 }];
  const summary = cargoRows.reduce((totals, row) => {
    const key = String(row.item || 'Cargo');
    const current = totals.get(key) || { item: key, tons: 0 };
    current.tons += Number(row.tons || 0);
    totals.set(key, current);
    return totals;
  }, new Map());
  const cargoSummary = [...summary.values()]
    .map((row) => `${row.tons}t ${row.item}`)
    .join(', ');
  const milestone = notice.milestone
    ? '<div class="mission-complete-milestone">Trade lane restored. You can keep taking contracts and spend the latinum.</div>'
    : '';
  missionCompleteModalEl.classList.remove('hidden');
  missionCompleteModalEl.innerHTML = `<div class="contract-offer mission-complete-card" role="dialog" aria-modal="true" aria-label="Trade mission complete">
    <div class="contract-offer-head">
      <span>Trade Mission Complete</span>
      <button class="panel-close" data-mission-complete-action="close" aria-label="Close trade mission complete">&times;</button>
    </div>
    <div class="contract-offer-body">
      <h2>Delivery complete at ${escapeHtml(notice.planetName || 'destination')}.</h2>
      <p>Your cargo has been accepted and payment has been transferred.</p>
      <div class="contract-mission-grid">
        <span>Delivered</span><b>${escapeHtml(cargoSummary || `${notice.delivered || 0}t Cargo`)}</b>
        <span>Payment</span><b>${escapeHtml(notice.payout || 0)} latinum</b>
        ${standingText ? `<span>Standing earned</span><b>${escapeHtml(standingText)}</b>` : ''}
        <span>Destination</span><b>${escapeHtml(notice.planetName || 'Destination')}</b>
        <span>Total Delivered</span><b>${escapeHtml(state.deliveredCargo)} tons</b>
      </div>
      ${milestone}
    </div>
    <div class="contract-offer-actions mission-complete-actions">
      <button data-mission-complete-action="close">Continue</button>
    </div>
  </div>`;
}

function showTradeMissionComplete(notice) {
  state.missionCompleteNotice = {
    planetName: notice?.planetName || state.planets[state.currentPlanet]?.name || 'destination',
    delivered: Math.max(0, Number(notice?.delivered || 0)),
    payout: Math.max(0, Number(notice?.payout || 0)),
    cargo: Array.isArray(notice?.cargo) ? notice.cargo.map((row) => ({ ...row })) : [],
    milestone: Boolean(notice?.milestone),
    standingRewards: { ...(notice?.standingRewards || {}) },
  };
  renderMissionCompleteModal();
}

function closeMissionCompleteModal() {
  state.missionCompleteNotice = null;
  renderMissionCompleteModal();
}

function renderContractModal() {
  if (!contractModalEl) return;
  const offer = normalizeContract(state.pendingContractOffer);
  if (!offer) {
    contractModalEl.classList.add('hidden');
    contractModalEl.innerHTML = '';
    return;
  }
  state.pendingContractOffer = { ...state.pendingContractOffer, ...offer };
  const targetSystem = ensureSystemState(offer.targetIndex);
  const hazards = Array.isArray(state.pendingContractOffer.hazards)
    ? state.pendingContractOffer.hazards
    : [
      targetSystem.hasAsteroids ? 'asteroid traffic' : '',
      targetSystem.hasNebula ? 'nebula interference' : '',
    ].filter(Boolean);
  const capacityLeft = Math.max(0, state.cargoCap - state.cargo);
  const canAccept = state.godMode || capacityLeft >= offer.tons;
  const totalPay = getContractTotal(offer);
  contractModalEl.classList.remove('hidden');
  contractModalEl.innerHTML = `<div class="contract-offer" role="dialog" aria-modal="true" aria-label="Contract offer">
    <div class="contract-offer-head">
      <span>${escapeHtml(offer.employerType === 'station' ? 'Station Contract' : 'Planet Contract')}</span>
      <button class="panel-close" data-contract-action="decline" aria-label="Close contract offer">&times;</button>
    </div>
    <div class="contract-offer-body">
      <h2>${escapeHtml(offer.employerName)} requests transport.</h2>
      <p>Carry ${escapeHtml(offer.tons)} tons of ${escapeHtml(offer.goods)} from ${escapeHtml(offer.originName)} to ${escapeHtml(offer.targetName)}.</p>
      <div class="contract-mission-grid">
        <span>Destination</span><b>${escapeHtml(offer.targetName)}</b>
        <span>Cargo</span><b>${escapeHtml(offer.tons)}t ${escapeHtml(offer.goods)}</b>
        <span>Payment</span><b>${escapeHtml(totalPay)} latinum</b>
        <span>Rate</span><b>${escapeHtml(offer.payPerTon)}L/t${offer.hazardPay ? `, +${escapeHtml(offer.hazardPay)} hazard` : ''}</b>
        <span>Conditions</span><b>${escapeHtml(hazards.length ? hazards.join(', ') : 'routine shipping lane')}</b>
      </div>
      <div class="contract-capacity ${canAccept ? '' : 'blocked'}">Cargo space: ${escapeHtml(capacityLeft)}/${escapeHtml(state.cargoCap)} free${state.godMode ? ' (God Mode override)' : canAccept ? '' : `, need ${escapeHtml(offer.tons)}`}</div>
    </div>
    <div class="contract-offer-actions">
      <button data-contract-action="decline">Decline</button>
      <button data-contract-action="accept" ${canAccept ? '' : 'disabled'}>Accept Contract</button>
    </div>
  </div>`;
}

function closeContractModal() {
  state.pendingContractOffer = null;
  renderContractModal();
}

function acceptPendingContract() {
  if (state.gameOver || !state.gameStarted) return;
  if (!state.docked) {
    setLog('Dock again before accepting a contract.');
    closeContractModal();
    return;
  }
  const offer = normalizeContract(state.pendingContractOffer);
  if (!offer) {
    closeContractModal();
    return;
  }
  const loaded = addCargoToPods(
    offer.goods,
    offer.tons,
    offer.targetName,
    getContractTotal(offer),
    { destinationIndex: offer.targetIndex, contractId: offer.id },
  );
  if (!loaded) {
    setLog('No cargo space available for this contract.');
    renderContractModal();
    return;
  }
  state.openContracts = [...getOpenContracts(), offer];
  state.activeContract = state.openContracts[0] || null;
  state.pendingContractOffer = null;
  playGameSound('contract', { cooldownKey: `contract:${offer.id}` });
  setLog(`Accepted contract: ${offer.tons} tons of ${offer.goods} to ${offer.targetName} for ${getContractTotal(offer)} latinum.`);
  updateStats();
}

function declinePendingContract() {
  const offer = normalizeContract(state.pendingContractOffer);
  state.pendingContractOffer = null;
  setLog(offer ? `Declined contract from ${offer.employerName}.` : 'Contract offer closed.');
  updateStats();
}

function buyMarketGood(slot = 0) {
  if (state.gameOver || !state.gameStarted) return;
  if (!requireDocked()) return;
  updateMenu(1, 3);
  const buyRefusal = serviceRefusal(getSystemFaction(state.currentPlanet));
  if (buyRefusal) {
    setLog(buyRefusal);
    updateStats();
    return;
  }
  const offer = currentMarketOffers()[slot];
  if (!offer) return;
  if (state.latinum < offer.price) {
    setLog(`Not enough latinum to buy ${offer.goods}.`);
    updateStats();
    return;
  }
  if (!addCargoToPods(offer.goods, 1, undefined, 0)) {
    setLog('You have no more cargo space for this cargo.');
    updateStats();
    return;
  }
  state.latinum -= offer.price;
  const tradeFaction = getTradeStandingFaction(state.currentPlanet, getCurrentDockedStation());
  if (tradeFaction && getFactionStanding(tradeFaction) < 15) adjustFactionStanding(tradeFaction, 1, { silent: true });
  playGameSound('purchase', { cooldownKey: `market:buy:${slot}` });
  setLog(`Bought 1 ton of ${offer.goods} for ${offer.price} latinum.`);
  updateStats();
}

function sellMarketGood(slot = 0) {
  if (state.gameOver || !state.gameStarted) return;
  if (!requireDocked()) return;
  updateMenu(1, 5);
  const sellRefusal = serviceRefusal(getSystemFaction(state.currentPlanet));
  if (sellRefusal) {
    setLog(sellRefusal);
    updateStats();
    return;
  }
  const offer = currentMarketOffers()[slot];
  if (!offer) return;
  const sold = removeCargoFromPods(offer.goods, 1);
  if (!sold) {
    setLog(`No undelivered ${offer.goods} cargo to sell.`);
    updateStats();
    return;
  }
  state.latinum += offer.price;
  const tradeFaction = getTradeStandingFaction(state.currentPlanet, getCurrentDockedStation());
  if (tradeFaction && getFactionStanding(tradeFaction) < 15) adjustFactionStanding(tradeFaction, 1, { silent: true });
  playGameSound('cargo', { cooldownKey: `market:sell:${slot}` });
  setLog(`Sold 1 ton of ${offer.goods} for ${offer.price} latinum.`);
  updateStats();
}

function openMap() {
  if (state.gameOver || !state.gameStarted) return;
  if (state.warp.active || isWormholeTransitActive()) return;
  if (!state.travelRoutes.length) rebuildTravelRoutes();
  const wasOpen = state.mapOpen;
  state.mapOpen = true;
  state.selectedPlanet = state.currentPlanet;
  if (!wasOpen) {
    state.starChart.openedAt = performance.now();
    focusStarChartOnSystem(state.currentPlanet);
  }
  syncInterstellarMapFrame();
  updateMenu(0, 0);
  setLog('Star chart open. Click a system once to plot, click it again to engage warp.');
  updateStats();
}

function transport() {
  if (state.gameOver || !state.gameStarted) return;
  if (!state.docked) {
    const target = getNearestTransportAsteroid();
    if (!target) {
      setLog(`No asteroid in transporter range. Fly within ${ASTEROID_TRANSPORT_RANGE} units and press T.`);
      return;
    }
    mineAsteroid(target.asteroid);
    return;
  }
  if (!requireDocked()) return;
  updateMenu(2, 5);
  const p = state.planets[state.currentPlanet];
  const chance = Math.random();
  if (chance < 0.45) {
    const find = 1 + Math.floor(Math.random() * 2);
    const before = state.antimatter;
    state.antimatter += find;
    syncFuelToAntimatter();
    const gained = state.antimatter - before;
    setLog(gained > 0
      ? `Transport mission on ${p.name} recovered ${gained} antimatter.`
      : 'Transport found antimatter, but your tanks are already full.');
  } else if (chance < 0.75) {
    const foundLatinum = 20 + Math.floor(Math.random() * 45);
    state.latinum += foundLatinum;
    setLog(`Transport mission completed: +${foundLatinum} latinum.`);
  } else {
    const scrape = 4 + Math.floor(Math.random() * 8);
    const result = applyPlayerDamage(scrape, getShieldColorForFaction(state.playerFaction));
    setLog(`Transport encounter turned hostile. ${formatDamageResult(result)}.`);
  }
  checkWinLose();
  updateStats();
}

function mineAsteroid(asteroid) {
  if (!isAsteroidAvailable(asteroid)) return false;
  const asteroidKey = getAsteroidKey(asteroid);
  const gained = Math.max(4, Math.round(finiteNumber(asteroid.duranium, 12)));
  asteroid.depleted = true;
  state.depletedAsteroids[asteroidKey] = true;
  state.duranium += gained;
  playGameSound('cargo', { cooldownKey: 'asteroid:transport', volume: 0.82 });
  const p = worldToScreen(asteroid);
  addWorldPop(p.x, p.y, `+${gained} duranium`, '#9fb2d0');
  addWeaponEffect({
    kind: 'burst',
    x: asteroid.x,
    y: asteroid.y,
    color: '#9fb2d0',
    radius: Math.max(34, finiteNumber(asteroid.r, 16) * 2.2),
    ttl: 340,
  });
  setLog(`Asteroid mined by transporter: +${gained} duranium.`);
  updateStats();
  return true;
}

function tryTransportClickedAsteroid(asteroid) {
  if (!isAsteroidAvailable(asteroid)) return false;
  if (state.docked) {
    setLog('Undock before mining asteroids.');
    return true;
  }
  const distance = distanceToPlayer(asteroid);
  const harvestRange = getAsteroidTransportDistance(asteroid);
  const p = worldToScreen(asteroid);
  if (distance > harvestRange) {
    setLog(`Move closer to transport this asteroid. Range ${Math.round(distance)}/${Math.round(harvestRange)}.`);
    addWorldPop(p.x, p.y, 'Too far', '#ffd66e');
    return true;
  }
  mineAsteroid(asteroid);
  return true;
}

function negotiateContract() {
  if (state.gameOver || !state.gameStarted) return;
  if (!requireDocked()) return;
  updateMenu(1, 3);
  state.pendingContractOffer = createCargoRunOffer();
  renderContractModal();
  setLog(`Contract offer from ${state.pendingContractOffer.employerName}.`);
  updateStats();
}

function deliverContractIfPossible() {
  const result = deliverDestinationCargoAtCurrentPlanet();
  return result;
}

function tradeOne() {
  if (state.gameOver || !state.gameStarted) return;
  if (!requireDocked()) return;
  buyMarketGood(0);
}

function tradeAtPlanet() {
  if (state.gameOver || !state.gameStarted) return;
  if (!requireDocked()) return;
  updateMenu(1, 5);
  if (deliverDestinationCargoAtCurrentPlanet()) return;
  const p = state.planets[state.currentPlanet];
  const demandBonus = Math.floor(Math.random() * 5);
  const openPod = state.cargoArray.find((pod) => pod.tons > 0 && pod.destination === undefined);
  if (openPod) {
    const sold = Math.min(openPod.tons, 3 + Math.floor(Math.random() * 3));
    const unitPrice = Math.max(2, p.market + demandBonus);
    const payout = sold * unitPrice;
    openPod.tons -= sold;
    if (openPod.tons <= 0) {
      openPod.tons = 0;
      openPod.item = 'Nothing';
    }
    recalcCargoFromPods();
    state.latinum += payout;
    state.deliveredCargo += sold;
    playGameSound('cargo', { cooldownKey: `trade:${state.currentPlanet}` });
    setLog(`Traded ${sold} cargo on ${p.name} for ${payout} latinum.`);
  } else {
    setLog(`No cargo to deliver at ${p.name}. Buy cargo first.`);
  }
  checkWinLose();
  updateStats();
}

function randomTravelEvent() {
  const roll = Math.random();
  if (roll < 0.2) {
    const dmg = 6 + Math.floor(Math.random() * 10);
    const result = applyPlayerDamage(dmg, getShieldColorForFaction(state.playerFaction));
    setLog(`Asteroid field hit! ${formatDamageResult(result)}.`);
  } else if (roll < 0.35) {
    const loot = 8 + Math.floor(Math.random() * 18);
    state.latinum += loot;
    setLog(`Derelict salvage recovered: +${loot} latinum.`);
  } else if (roll < 0.5) {
    const pirateLoss = Math.min(state.cargo, 1 + Math.floor(Math.random() * 2));
    if (pirateLoss > 0) {
      state.cargo -= pirateLoss;
      setLog(`Pirate raid! Lost ${pirateLoss} cargo.`);
    } else {
      setLog('Pirate scan detected, but no cargo to steal.');
    }
  } else {
    setLog('Jump completed safely.');
  }
}

function refuel() {
  if (state.gameOver || !state.gameStarted) return;
  if (!requireDocked()) return;
  syncFuelToAntimatter();
  const missing = state.fuelCap - state.antimatter;
  if (missing <= 0) {
    setLog('Antimatter already full.');
    return;
  }
  const unitPrice = 1;
  const affordable = Math.min(missing, state.latinum);
  if (affordable <= 0) {
    setLog('No latinum to refuel.');
    return;
  }
  state.antimatter += affordable;
  syncFuelToAntimatter();
  state.latinum -= affordable * unitPrice;
  playGameSound('purchase', { cooldownKey: `refuel:${state.currentPlanet}` });
  setLog(`Refilled antimatter +${affordable}.`);
  updateStats();
}

function repairHull() {
  if (state.gameOver || !state.gameStarted) return;
  if (!requireDocked()) return;
  const missingHull = Math.max(0, 100 - state.hull);
  const missingShields = Math.max(0, 100 - clamp(finiteNumber(state.shields, 0), 0, 100));
  if (missingHull <= 0 && missingShields <= 0) {
    setLog('Hull and shields already at 100%.');
    return;
  }
  const hullRepair = Math.min(missingHull, Math.floor(state.latinum / 2));
  state.hull += hullRepair;
  state.latinum -= hullRepair * 2;
  const shieldRepair = Math.min(missingShields, state.latinum);
  state.shields = Math.min(100, clamp(finiteNumber(state.shields, 0), 0, 100) + shieldRepair);
  state.latinum -= shieldRepair;
  if (hullRepair <= 0 && shieldRepair <= 0) {
    setLog('Not enough latinum for repairs.');
    return;
  }
  playGameSound('uiConfirm', { cooldownKey: `repair:${state.currentPlanet}` });
  setLog(`Repairs complete: hull +${hullRepair}%, shields +${shieldRepair}%.`);
  updateStats();
}

function checkWinLose() {
  if (state.hull <= 0) {
    state.gameOver = true;
    state.victory = false;
    setLog('Game Over: your ship was destroyed.');
    return;
  }
  if (!state.tradeLaneRestored && state.deliveredCargo >= state.missionCargoGoal) {
    state.tradeLaneRestored = true;
  }
}

function getRouteCosts(route) {
  const distance = getRouteWarpDistance(route);
  return {
    antimatter: getRouteCostForDistance(distance),
    range: distance,
  };
}

function jumpPlanet() {
  if (state.gameOver || !state.gameStarted) return;
  if (state.warp.active) return;
  if (!state.mapOpen) {
    setLog('Open the star chart first.');
    return;
  }
  const plan = getPlottedRoute(state.currentPlanet, state.selectedPlanet);
  if (!plan || !plan.legs.length) {
    const from = state.planets[state.currentPlanet]?.name || 'current system';
    const to = state.planets[state.selectedPlanet]?.name || 'that system';
    setLog(`No plotted route from ${from} to ${to}.`);
    return;
  }
  const rangeStatus = getPlottedRouteStatus(plan);
  const jumpAntiMatterCost = plan.antimatter;
  if (!rangeStatus.hasShipRange) {
    setLog(`${getShipStats().name} range ${rangeStatus.shipRange} is too short for this plotted ${rangeStatus.distance} route. Buy a longer-range ship.`);
    return;
  }
  if (!rangeStatus.hasFuelRange) {
    setLog(`Need ${jumpAntiMatterCost} antimatter for this plotted ${rangeStatus.distance} route. Current antimatter covers ${rangeStatus.fuelRange}.`);
    return;
  }
  if (state.antimatter < jumpAntiMatterCost) {
    setLog(`Need ${jumpAntiMatterCost} antimatter to travel this plotted route.`);
    return;
  }
  state.antimatter -= jumpAntiMatterCost;
  syncFuelToAntimatter();
  beginWarpTravel(state.selectedPlanet, plan);
}

function beginWarpTravel(targetIndex, plan) {
  const from = state.currentPlanet;
  const target = state.planets[targetIndex];
  state.mapOpen = false;
  syncInterstellarMapFrame();
  closePlanetMenu();
  state.docked = false;
  state.dockedPlanetIndex = null;
  state.dockedStationId = null;
  state.ship.velocity = 0;
  state.ship.turnVelocity = 0;
  state.ship.forwardThrustStartedAt = 0;
  state.ship.systemWarpIntensity = 0;
  state.warp = {
    active: true,
    from,
    to: targetIndex,
    route: plan,
    startedAt: performance.now(),
    duration: WARP_DURATION_MS,
    message: plan?.legs?.length > 1
      ? `Warp drive engaged for ${target?.name || 'target system'} over ${plan.legs.length} route legs...`
      : `Warp drive engaged for ${target?.name || 'target system'}...`,
  };
  playGameSound('warpEnter', { cooldownKey: 'warp:enter' });
  setLog(state.warp.message);
  updateStats();
}

function completeWarpTravel() {
  if (!state.warp.active) return;
  const targetIndex = state.warp.to;
  state.day += 1;
  state.currentPlanet = targetIndex;
  state.myplanet = state.currentPlanet + 1;
  markSystemVisited(state.currentPlanet);
  state.selectedPlanet = state.currentPlanet;
  state.planetCallout = null;
  state.warp.active = false;
  const p = state.planets[state.currentPlanet];
  closePlayerSecurityOrders(state.warp.from, 'departed', 'left the system'); // a completed jump is an actual departure
  applySystemState(state.currentPlanet);
  const completedBuilds = completeDueStationConstructions({ silent: true });
  scheduleNextFleetAttack(performance.now() + 30000);
  setCameraNearPlanet();
  placePlayerAtSecurityApproach();
  state.ship.velocity = 0;
  state.ship.turnVelocity = 0;
  state.ship.forwardThrustStartedAt = 0;
  state.ship.systemWarpIntensity = 0;
  randomTravelEvent();
  playGameSound('warpDrop', { cooldownKey: 'warp:drop' });
  if (!state.gameOver) {
    const buildMessage = completedBuilds
      ? ` ${completedBuilds} station construction project${completedBuilds === 1 ? '' : 's'} completed.`
      : '';
    setLog(`${state.log} Arrived at ${p.name}.${buildMessage}`);
  }
  state.planets.forEach((planet) => {
    const delta = Math.floor(Math.random() * 5) - 2;
    planet.market = Math.max(4, Math.min(18, planet.market + delta));
  });
  updatePlanetMarketVariance();
  deliverContractIfPossible();
  checkWinLose();
  syncLegacyState();
  updateStats();
}

document.getElementById('btn-map')?.addEventListener('click', openMap);
closeMapBtn?.addEventListener('click', closeMap);
weaponsBtn?.addEventListener('click', openWeaponsLocker);
restartGameBtn?.addEventListener('click', restartGame);
escapePodBtn?.addEventListener('click', restartInEscapePod);

contractModalEl?.addEventListener('click', (e) => {
  const action = e.target.closest('[data-contract-action]');
  if (!action) {
    if (e.target === contractModalEl) declinePendingContract();
    return;
  }
  if (action.dataset.contractAction === 'accept') acceptPendingContract();
  if (action.dataset.contractAction === 'decline') declinePendingContract();
});

missionCompleteModalEl?.addEventListener('click', (e) => {
  const action = e.target.closest('[data-mission-complete-action]');
  if (!action) {
    if (e.target === missionCompleteModalEl) closeMissionCompleteModal();
    return;
  }
  if (action.dataset.missionCompleteAction === 'close') closeMissionCompleteModal();
});

shipPurchaseModalEl?.addEventListener('click', (e) => {
  const action = e.target.closest('[data-ship-purchase-action]');
  if (!action) {
    if (e.target === shipPurchaseModalEl) closeShipPurchaseModal();
    return;
  }
  if (action.dataset.shipPurchaseAction === 'confirm') confirmPendingShipPurchase();
  if (action.dataset.shipPurchaseAction === 'fleet') confirmPendingFleetShipPurchase();
  if (action.dataset.shipPurchaseAction === 'cancel') closeShipPurchaseModal();
});

shipPurchaseModalEl?.addEventListener('change', (e) => {
  const assignment = e.target.closest('[data-fleet-assignment]');
  if (!assignment || !state.pendingShipPurchase) return;
  state.pendingShipPurchase.fleetAssignment = assignment.value;
  renderShipPurchaseModal();
});

fleetPurchaseModalEl?.addEventListener('click', (e) => {
  const action = e.target.closest('[data-fleet-purchase-action]');
  if (!action) {
    if (e.target === fleetPurchaseModalEl) closeFleetPurchaseModal();
    return;
  }
  if (action.dataset.fleetPurchaseAction === 'defense') confirmFleetPurchase('defense');
  if (action.dataset.fleetPurchaseAction === 'escort') confirmFleetPurchase('escort');
  if (action.dataset.fleetPurchaseAction === 'cancel') closeFleetPurchaseModal();
});

function handleTargetWindowAction(e, fromPointer = false) {
  const action = e.target.closest('[data-hail-action]');
  if (!action) return false;
  e.preventDefault();
  e.stopPropagation();
  if (action.disabled) return true;
  const now = performance.now();
  if (!fromPointer && now - lastTargetWindowActionAt < 350) return true;
  lastTargetWindowActionAt = now;
  targetWindowInteractionLockUntil = now + 700;
  const value = action.dataset.hailAction;
  if (value === 'hail') hailSelectedShip();
  if (value === 'scan') scanSelectedShip();
  if (value === 'buy-cargo') buyCargoFromHailedShip();
  if (value === 'sell-cargo') sellCargoToHailedShip();
  targetWindowInteractionLockUntil = performance.now() + 700;
  return true;
}

// Incoming-order panel for the player as visitor. Available in flight; keyed re-render each frame.
function securityOrderPanelKey(order, notice, zone) {
  if (order) return `${order.id}:${order.revision}:${order.kind}:${order.withdrawing}:${order.state}:${Math.ceil(order.remainingMs / 1000)}:${Math.ceil(order.dwellMs / 1000)}:${order.acknowledged}`;
  if (notice) return `notice:${notice.outcome}:${notice.atMs}`;
  return zone ? `zone:${zone.id}:${zone.epoch}` : 'none';
}
function updateSecurityOrderPanel() {
  if (!securityOrderPanelEl) return;
  const visible = state.gameStarted && !state.gameOver && !state.warp.active && !isWormholeTransitActive();
  const zone = visible ? getSecurityZone(state.currentPlanet) : null;
  const ledger = visible ? getSecurityLedger(state.currentPlanet) : null;
  const order = visible ? getPlayerSecurityOrder(state.currentPlanet) : null;
  let notice = state.securityOutcomeNotice;
  if (notice && (!visible || Number(notice.systemIndex) !== Number(state.currentPlanet) || !ledger || ledger.localElapsedMs - notice.atMs > SECURITY_OUTCOME_DISPLAY_MS)) {
    if (visible && ledger && Number(notice.systemIndex) === Number(state.currentPlanet)) state.securityOutcomeNotice = null;
    notice = null;
  }
  const visitor = ledger?.visitors?.player || null;
  const cleared = zone && zone.foreign && visitor?.clearance && !order;
  const show = Boolean(order || notice || (zone && zone.foreign && (cleared || visitor?.noncompliant)));
  securityOrderPanelEl.classList.toggle('hidden', !show);
  if (!show) { securityOrderPanelEl.dataset.renderKey = ''; return; }
  const key = securityOrderPanelKey(order, notice, zone) + (cleared ? ':cleared' : visitor?.noncompliant ? ':refused' : '');
  if (securityOrderPanelEl.dataset.renderKey === key) return;
  securityOrderPanelEl.dataset.renderKey = key;
  if (order) {
    const withdrawing = order.kind === 'withdraw' || order.withdrawing;
    const seconds = Math.max(0, Math.ceil(order.remainingMs / 1000));
    const holdSeconds = Math.ceil(Math.max(0, SECURITY_DWELL_MS - order.dwellMs) / 1000);
    const status = order.state === 'check_incomplete'
      ? 'Identity check incomplete; awaiting their review.'
      : withdrawing
        ? `Leave beyond the exit marker. ${seconds} s.`
        : order.state === 'holding'
          ? `Holding. Identity check completes in ${holdSeconds} s.`
          : `Stop within ${SECURITY_HOLD_TOLERANCE} units of the holding marker. ${seconds} s.`;
    securityOrderPanelEl.innerHTML = `<div class="security-order-head"><span>Incoming order</span><span>${escapeHtml(order.authorityLabel)}</span></div>
      <div class="security-order-body">
        <div class="security-order-text">${escapeHtml(describeSecurityInstruction(order, zone))}</div>
        <div class="security-order-status">${escapeHtml(status)}</div>
        <div class="security-order-buttons">
          <button data-security-response="acknowledge" ${order.acknowledged ? 'disabled' : ''}>${order.acknowledged ? 'Acknowledged' : 'Acknowledge'}</button>
          <button data-security-response="repeat">Repeat instruction</button>
          <button data-security-response="request" ${withdrawing ? 'disabled' : ''}>Request clearance</button>
          <button data-security-response="withdraw" ${withdrawing ? 'disabled' : ''}>Withdraw</button>
          <button data-security-response="refuse" class="security-refuse" title="Refusal is recorded. Their installations will not receive you for this visit. It authorizes no weapons.">Refuse</button>
        </div>
      </div>`;
    return;
  }
  if (notice) {
    securityOrderPanelEl.innerHTML = `<div class="security-order-head"><span>Checkpoint</span><span>${escapeHtml(notice.authorityLabel || '')}</span></div>
      <div class="security-order-body"><div class="security-order-text">${escapeHtml(describeSecurityOutcomeForPlayer({ outcome: notice.outcome, authorityLabel: notice.authorityLabel }))}</div></div>`;
    return;
  }
  securityOrderPanelEl.innerHTML = `<div class="security-order-head"><span>Checkpoint</span><span>${escapeHtml(zone.label)}</span></div>
    <div class="security-order-body"><div class="security-order-text">${cleared
      ? `Cleared for this visit${visitor.clearance.provenance === 'waiver' ? ' (waived)' : ''}. Leaving the area ends the clearance.`
      : 'You refused their instruction. Their installations will not receive you until you leave and return.'}</div></div>`;
}
securityOrderPanelEl?.addEventListener('click', (e) => {
  const response = e.target.closest('[data-security-response]');
  if (!response) return;
  e.preventDefault();
  if (respondToSecurityOrder(response.dataset.securityResponse)) {
    securityOrderPanelEl.dataset.renderKey = '';
    updateSecurityOrderPanel();
    updateStats();
  }
});

// World markers: the perimeter, the issuing installation, and the player's holding or exit point.
// The legal perimeter is drawn distinctly from any physical map edge.
function drawSecurityZoneMarkers(now = performance.now()) {
  const zone = getSecurityZone(state.currentPlanet);
  if (!zone) return;
  const centre = worldToScreen(zone.centre);
  const colour = zone.foreign ? '#ffb454' : '#7dc8ff';
  ctx.save();
  ctx.strokeStyle = colorToRgba(colour, 0.55);
  ctx.lineWidth = 1.5;
  ctx.setLineDash([10, 8]);
  ctx.beginPath();
  ctx.arc(centre.x, centre.y, zone.radius, 0, Math.PI * 2);
  ctx.stroke();
  ctx.setLineDash([]);
  const anchor = (state.stations || []).find((station) => station.id === zone.anchorStationId);
  if (anchor) {
    const a = worldToScreen(anchor);
    ctx.fillStyle = colorToRgba(colour, 0.9);
    ctx.font = canvasUiFont(10, '700');
    ctx.textAlign = 'center';
    ctx.fillText(`CHECKPOINT: ${zone.label.toUpperCase()}`, a.x, a.y - getStationScreenRadius(anchor) - 18);
    ctx.textAlign = 'start';
  }
  const order = getPlayerSecurityOrder(state.currentPlanet);
  if (order) {
    const withdrawing = order.kind === 'withdraw' || order.withdrawing;
    const point = worldToScreen(resolveSecurityPoint(zone, withdrawing ? order.exit : order.hold));
    const pulse = 0.65 + 0.35 * Math.sin(now / 260);
    ctx.strokeStyle = colorToRgba(withdrawing ? '#ff9c9c' : '#9cffb4', pulse);
    ctx.lineWidth = 2;
    if (withdrawing) {
      ctx.beginPath();
      ctx.moveTo(point.x - 14, point.y + 12); ctx.lineTo(point.x, point.y - 12); ctx.lineTo(point.x + 14, point.y + 12);
      ctx.stroke();
    } else {
      ctx.beginPath();
      ctx.moveTo(point.x, point.y - 16); ctx.lineTo(point.x + 16, point.y); ctx.lineTo(point.x, point.y + 16); ctx.lineTo(point.x - 16, point.y); ctx.closePath();
      ctx.stroke();
      ctx.setLineDash([4, 5]);
      ctx.beginPath();
      ctx.arc(point.x, point.y, SECURITY_HOLD_TOLERANCE, 0, Math.PI * 2);
      ctx.stroke();
      ctx.setLineDash([]);
    }
    ctx.fillStyle = colorToRgba(withdrawing ? '#ff9c9c' : '#9cffb4', 0.95);
    ctx.font = canvasUiFont(10, '700');
    ctx.textAlign = 'center';
    const p = playerWorldPosition();
    const world = resolveSecurityPoint(zone, withdrawing ? order.exit : order.hold);
    ctx.fillText(`${withdrawing ? 'EXIT' : 'HOLD'} ${Math.round(Math.hypot(world.x - p.x, world.y - p.y))}`, point.x, point.y - 22);
    ctx.textAlign = 'start';
  }
  ctx.restore();
}

targetWindowEl?.addEventListener('pointerdown', (e) => {
  handleTargetWindowAction(e, true);
});

targetWindowEl?.addEventListener('click', (e) => {
  handleTargetWindowAction(e, false);
});

wormholeModalEl?.addEventListener('click', (e) => {
  const action = e.target.closest('[data-wormhole-action]');
  if (!action) {
    if (e.target === wormholeModalEl) closeWormholeBuildModal();
    return;
  }
  if (action.dataset.wormholeAction === 'confirm') confirmPendingWormholeBuild();
  if (action.dataset.wormholeAction === 'cancel') closeWormholeBuildModal();
});

wormholeModalEl?.addEventListener('change', (e) => {
  const select = e.target.closest('[data-wormhole-destination]');
  if (!select || !state.pendingWormholeBuild) return;
  state.pendingWormholeBuild.destinationIndex = Number(select.value);
  renderWormholeBuildModal();
});

stationBuildModalEl?.addEventListener('pointerdown', (e) => {
  const map = e.target.closest('[data-station-build-map]');
  if (!map || !state.pendingStationBuild || e.button !== 0) return;
  e.preventDefault();
  state.pendingStationBuild.mapDrag = {
    active: true,
    pointerId: e.pointerId,
    lastX: e.clientX,
    lastY: e.clientY,
    moved: 0,
    startedOnMap: true,
  };
  map.setPointerCapture?.(e.pointerId);
});

window.addEventListener('pointermove', (e) => {
  const drag = state.pendingStationBuild?.mapDrag;
  if (!drag?.active || drag.pointerId !== e.pointerId) return;
  const map = stationBuildModalEl?.querySelector('[data-station-build-map]');
  if (!map) return;
  const dx = e.clientX - drag.lastX;
  const dy = e.clientY - drag.lastY;
  drag.lastX = e.clientX;
  drag.lastY = e.clientY;
  drag.moved += Math.abs(dx) + Math.abs(dy);
  panStationBuildViewport(dx, dy, map);
  renderStationBuildModal();
});

window.addEventListener('pointerup', (e) => {
  const drag = state.pendingStationBuild?.mapDrag;
  if (!drag?.active || drag.pointerId !== e.pointerId) return;
  const map = stationBuildModalEl?.querySelector('[data-station-build-map]');
  const wasClick = drag.moved <= 6;
  drag.active = false;
  if (wasClick && map) {
    placePendingStationBuildFromMapEvent(e, map);
    return;
  }
  renderStationBuildModal();
});

stationBuildModalEl?.addEventListener('wheel', (e) => {
  const map = e.target.closest('[data-station-build-map]');
  if (!map || !state.pendingStationBuild) return;
  e.preventDefault();
  zoomStationBuildViewport(e.deltaY, e, map);
  renderStationBuildModal();
}, { passive: false });

stationBuildModalEl?.addEventListener('input', (e) => {
  const input = e.target.closest('[data-station-build-name]');
  if (!input || !state.pendingStationBuild) return;
  state.pendingStationBuild.customName = input.value;
  state.pendingStationBuild.nameTouched = true;
});

stationBuildModalEl?.addEventListener('change', (e) => {
  const input = e.target.closest('[data-station-build-name]');
  if (!input || !state.pendingStationBuild) return;
  const stationStats = state.shipStatsById[Number(state.pendingStationBuild.stationTypeId)];
  state.pendingStationBuild.customName = sanitizeStationName(input.value, stationStats?.name || 'Station');
  renderStationBuildModal();
});

stationBuildModalEl?.addEventListener('click', (e) => {
  const plan = e.target.closest('[data-station-build-plan]');
  if (plan && state.pendingStationBuild) {
    const stationTypeId = Number(plan.dataset.stationBuildPlan);
    const stationStats = state.shipStatsById[stationTypeId];
    state.pendingStationBuild.stationTypeId = stationTypeId;
    state.pendingStationBuild.price = getStationBuildCost(stationStats);
    state.pendingStationBuild.duraniumCost = getStationDuraniumCost(stationStats);
    if (!state.pendingStationBuild.nameTouched) {
      state.pendingStationBuild.customName = sanitizeStationName(stationStats?.name, 'Station');
    }
    renderStationBuildModal();
    return;
  }
  const map = e.target.closest('[data-station-build-map]');
  if (map && state.pendingStationBuild) {
    e.preventDefault();
    return;
  }
  const action = e.target.closest('[data-station-build-action]');
  if (!action) {
    if (e.target === stationBuildModalEl) closeStationBuildModal();
    return;
  }
  if (action.dataset.stationBuildAction === 'confirm') confirmPendingStationBuild();
  if (action.dataset.stationBuildAction === 'cancel') closeStationBuildModal();
});

function closeTopWindow() {
  if (state.missionCompleteNotice) { closeMissionCompleteModal(); return; }
  if (state.pendingContractOffer) { declinePendingContract(); return; }
  if (state.pendingShipPurchase) { closeShipPurchaseModal(); return; }
  if (state.pendingFleetPurchase) { closeFleetPurchaseModal(); return; }
  if (state.pendingStationBuild) { closeStationBuildModal(); return; }
  if (state.pendingWormholeBuild) { closeWormholeBuildModal(); return; }
  if (state.mapOpen) { closeMap(); return; }
  if (state.topLeftPanelOpen) {
    state.topLeftPanelOpen = false;
    renderTopLeftPanel();
  }
}
function openTopLeftTab(tab) {
  state.topLeftTab = tab;
  state.topLeftPanelOpen = true;
  renderTopLeftPanel();
}
function updateBottomDock() {
  if (!bottomDockEl) return;
  const visible = Boolean(state.gameStarted && !state.gameOver && !state.introActive);
  bottomDockEl.classList.toggle('hidden', !visible);
}
let powerDragKey = null;
let powerDragRect = null;
function powerTankValueFromEvent(key, e) {
  const rect = powerDragRect;
  if (!rect || rect.height <= 0) return null;
  const y = (e.clientY ?? (rect.top + rect.height / 2)) - rect.top;
  return clamp(Math.round((1 - y / rect.height) * 10), 0, 10);
}
document.addEventListener('pointerdown', (e) => {
  const tank = e.target.closest?.('[data-power-tank]');
  if (tank && topLeftPanelEl?.contains(tank)) {
    powerDragKey = tank.dataset.powerTank;
    powerDragRect = tank.getBoundingClientRect();
    const value = powerTankValueFromEvent(powerDragKey, e);
    if (value !== null) setPowerDist(powerDragKey, value);
    updateStats();
    renderTopLeftPanel();
  }
});
document.addEventListener('pointermove', (e) => {
  if (!powerDragKey) return;
  const value = powerTankValueFromEvent(powerDragKey, e);
  if (value !== null && value !== getPowerDist(powerDragKey)) {
    setPowerDist(powerDragKey, value);
    updateStats();
    renderTopLeftPanel();
  }
});
document.addEventListener('pointerup', () => { powerDragKey = null; powerDragRect = null; });
document.addEventListener('click', (e) => {
  const dockBtn = e.target.closest?.('[data-dock-action]');
  if (dockBtn && bottomDockEl?.contains(dockBtn)) {
    const action = dockBtn.dataset.dockAction;
    if (action === 'target') cycleCombatTarget();
    else if (action === 'hail') hailSelectedShip();
    else if (action === 'map') { if (state.mapOpen) closeMap(); else openMap(); }
    else if (action === 'inventory') openTopLeftTab('inventory');
    else if (action === 'power') openTopLeftTab('power');
    else if (action === 'contract') negotiateContract();
    else if (action === 'save') saveGame();
    return;
  }
});
document.addEventListener('click', (e) => {
  const powerBtn = e.target.closest?.('[data-power-dist]');
  if (powerBtn && topLeftPanelEl?.contains(powerBtn)) {
    adjustPowerDist(powerBtn.dataset.powerDist, Number(powerBtn.dataset.powerDir || 1));
  }
});
topLeftMenuEl?.addEventListener('click', (e) => {
  const tab = e.target.closest('[data-top-left-tab]');
  if (tab) {
    const nextTab = tab.dataset.topLeftTab || 'inventory';
    state.topLeftPanelOpen = !(state.topLeftPanelOpen && state.topLeftTab === nextTab);
    state.topLeftTab = nextTab;
    renderTopLeftPanel();
    return;
  }
  const saveSlot = e.target.closest('[data-save-slot]');
  if (saveSlot) {
    saveGame(Number(saveSlot.dataset.saveSlot));
    return;
  }
  const loadSlot = e.target.closest('[data-load-slot]');
  if (loadSlot) {
    loadGame(Number(loadSlot.dataset.loadSlot));
    return;
  }
  const action = e.target.closest('[data-top-action]');
  if (action) {
    const value = action.dataset.topAction;
    if (value === 'close-panel') {
      state.topLeftPanelOpen = false;
      renderTopLeftPanel();
      return;
    }
    if (value === 'god-mode') grantGodResources();
    if (value === 'god-refill') grantGodResources();
    if (value === 'transport') transport();
    if (value === 'contract') negotiateContract();
    if (value === 'trade') tradeOne();
    if (value === 'deliver') tradeAtPlanet();
    if (value === 'refuel') refuel();
    if (value === 'repair') repairHull();
    if (value === 'weapons') openWeaponsLocker();
    if (value === 'jump') jumpPlanet();
    return;
  }
  const godShip = e.target.closest('[data-god-ship]');
  if (godShip) {
    switchGodShip(Number(godShip.dataset.godShip));
    return;
  }
  const panelWeaponSlot = e.target.closest('[data-panel-weapon-slot]');
  if (panelWeaponSlot) {
    loadWeaponSlot(Number(panelWeaponSlot.dataset.weaponId), Number(panelWeaponSlot.dataset.panelWeaponSlot));
    return;
  }
  const flagRaise = e.target.closest('[data-flag-raise]');
  if (flagRaise) {
    raisePlayerFlag(flagRaise.dataset.flagRaise);
  }
});

topLeftPanelEl?.addEventListener('click', (e) => {
  const gameOption = e.target.closest('[data-game-option]');
  if (gameOption) {
    const key = gameOption.dataset.gameOption;
    if (Object.prototype.hasOwnProperty.call(DEFAULT_GAME_OPTIONS, key)) {
      setGameOption(key, !state.gameOptions?.[key]);
      renderTopLeftPanel();
    }
    return;
  }
  const saveSlot = e.target.closest('[data-save-slot]');
  if (saveSlot) {
    saveGame(Number(saveSlot.dataset.saveSlot));
    return;
  }
  const loadSlot = e.target.closest('[data-load-slot]');
  if (loadSlot) {
    loadGame(Number(loadSlot.dataset.loadSlot));
    return;
  }
  const action = e.target.closest('[data-top-action]');
  if (action) {
    const value = action.dataset.topAction;
    if (value === 'close-panel') {
      state.topLeftPanelOpen = false;
      renderTopLeftPanel();
      return;
    }
    if (value === 'god-mode') grantGodResources();
    if (value === 'god-refill') grantGodResources();
    if (value === 'transport') transport();
    if (value === 'contract') negotiateContract();
    if (value === 'trade') tradeOne();
    if (value === 'deliver') tradeAtPlanet();
    if (value === 'refuel') refuel();
    if (value === 'repair') repairHull();
    if (value === 'weapons') openWeaponsLocker();
    if (value === 'jump') jumpPlanet();
    return;
  }
  const godShip = e.target.closest('[data-god-ship]');
  if (godShip) {
    switchGodShip(Number(godShip.dataset.godShip));
    return;
  }
  const panelWeaponSlot = e.target.closest('[data-panel-weapon-slot]');
  if (panelWeaponSlot) {
    loadWeaponSlot(Number(panelWeaponSlot.dataset.weaponId), Number(panelWeaponSlot.dataset.panelWeaponSlot));
    return;
  }
  const flagRaise = e.target.closest('[data-flag-raise]');
  if (flagRaise) {
    raisePlayerFlag(flagRaise.dataset.flagRaise);
  }
});

panelEl?.addEventListener('click', (e) => {
  const dedicate = e.target.closest('[data-planet-dedicate]');
  if (dedicate) {
    plantFlagForEmpire(dedicate.dataset.planetDedicate);
    return;
  }
  const buy = e.target.closest('[data-market-buy]');
  if (buy) {
    buyMarketGood(Number(buy.dataset.marketBuy));
    return;
  }
  const sell = e.target.closest('[data-market-sell]');
  if (sell) {
    sellMarketGood(Number(sell.dataset.marketSell));
    return;
  }
  const panelWeaponSlot = e.target.closest('[data-panel-weapon-slot]');
  if (panelWeaponSlot) {
    loadWeaponSlot(Number(panelWeaponSlot.dataset.weaponId), Number(panelWeaponSlot.dataset.panelWeaponSlot));
  }
});

// Security tab (Phase 2): rules of engagement for this holding. Shown only where the player's side
// has authority. Access and alert controls are deliberately absent until enforcement exists.
function renderSecurityPanelMarkup(systemIndex = state.currentPlanet) {
  if (!isSystemControlled(systemIndex)) return '<div class="meta">Security policy requires authority over this system.</div>';
  const effective = getEffectiveSecurityPolicy(systemIndex);
  const override = getSecurityPolicyOverride(systemIndex);
  const empire = getSecurityPolicyDefault();
  const name = state.planets[systemIndex]?.name || 'This system';
  const roeButton = (value, label) => {
    const selected = effective.roe === value;
    return `<button data-security-roe="${value}" class="${selected ? 'active' : ''}" aria-pressed="${selected}">${selected ? '&#10004; ' : ''}${escapeHtml(label)}${selected ? ' (in force)' : ''}</button>`;
  };
  const roeLabel = (value) => (value === 'return-fire' ? 'Return fire only' : 'Defend');
  const accessRow = (cls, label, note) => {
    const current = effective.access[cls] || 'open';
    const usable = true;
    const button = (value, text) => `<button data-security-access="${cls}:${value}" class="${current === value ? 'active' : ''}" aria-pressed="${current === value}" ${usable ? '' : 'disabled'}>${current === value ? '&#10004; ' : ''}${text}</button>`;
    return `<div class="security-access-row" data-security-access-row="${cls}">
      <div class="security-access-label"><strong>${escapeHtml(label)}</strong><span class="meta">${escapeHtml(note)}</span></div>
      <div class="security-access-buttons">${button('open', 'Open')}${button('challenge', 'Challenge')}${button('closed', 'Closed')}</div>
    </div>`;
  };
  const config = getPlayerCheckpointConfig(systemIndex) || { enabled: false, anchorStationId: null };
  const candidates = getSecurityAnchorCandidates(systemIndex, PLAYER_SIDE);
  const zone = getSecurityZone(systemIndex);
  const anchorOptions = candidates.length
    ? candidates.map((station) => `<button data-security-anchor="${escapeHtml(station.id)}" class="${config.anchorStationId === station.id ? 'active' : ''}" aria-pressed="${config.anchorStationId === station.id}">${config.anchorStationId === station.id ? '&#10004; ' : ''}${escapeHtml(station.name)} (${Math.round(station.orbitDistance || 0)})</button>`).join('')
    : '<div class="meta">No eligible installation: a checkpoint needs a live, completed, planet-orbit station you own here.</div>';
  const checkpointStatus = zone
    ? `Checkpoint active from ${escapeHtml(zone.anchorName)}: perimeter ${zone.radius} around ${escapeHtml(name)}, holding point at ${zone.holdDistance}.`
    : config.enabled
      ? 'Checkpoint unavailable: the selected installation is not live, completed and yours. Select another.'
      : 'Checkpoint disabled. With every access row open, an enabled checkpoint issues no orders.';
  return `<div class="market-section">
    <div class="panel-head">${escapeHtml(name)} security</div>
    <div class="meta">${override ? 'Local override in force.' : 'Using empire default.'} Empire default: ${escapeHtml(roeLabel(empire.roe))}. In force here: ${escapeHtml(roeLabel(effective.roe))}.</div>
    <div class="panel-head">Rules of engagement</div>
    <div class="service-grid">
      ${roeButton('return-fire', 'Return fire only')}
      ${roeButton('defend', 'Defend')}
    </div>
    <div class="meta"><strong>Return fire only:</strong> your ships and stations here engage only ships or stations seen attacking your side in this system, and fleets raiding this holding.</div>
    <div class="meta"><strong>Defend:</strong> as above, plus ships hostile to you and ships at war with your current flag, on sight. This is the default behavior.</div>
    <div class="meta">Explicit attack orders always apply. Foreign ships and stations keep their own owners and commanders whatever you set here.</div>
    <div class="panel-head">Access</div>
    <div class="meta">Challenge requests a movement and identity check. Closed requests withdrawal. Refusal alone does not authorize weapons; your rules of engagement still apply. Your own ships are exempt.</div>
    ${accessRow('warFlag', 'War flags', 'Recognized factions at war with your current flag.')}
    ${accessRow('independent', 'Independents', 'Vessels broadcasting no allegiance.')}
    ${accessRow('other', 'Everyone else', 'Allies, same-flag foreigners and identified organizations.')}
    ${accessRow('unknown', 'Unidentified', 'Tracked visitors without a fresh declaration; Open by default.')}
    <div class="panel-head">Checkpoint</div>
    <div class="meta">${checkpointStatus}</div>
    <div class="service-grid">
      <button data-security-checkpoint="${config.enabled ? 'disable' : 'enable'}" ${candidates.length || config.enabled ? '' : 'disabled'}>${config.enabled ? 'Disable checkpoint' : 'Enable checkpoint'}</button>
      <button data-security-action="use-default" ${override ? '' : 'disabled'}>Use empire default here</button>
      <button data-security-action="set-default">Set as empire default</button>
    </div>
    <div class="meta">Issuing installation</div>
    <div class="service-grid security-anchor-grid">${anchorOptions}</div>
    <div class="panel-head">Encounters</div>
    <div data-security-live>${renderSecurityEncounterListMarkup(systemIndex)}</div>
  </div>`;
}
function securityOrderStatusText(order) {
  if (order.outcome) return order.outcome.replace(/_/g, ' ');
  if (order.state === 'check_incomplete') return 'check incomplete';
  const kind = order.kind === 'withdraw' || order.withdrawing ? 'withdrawing' : order.state === 'holding' ? `holding ${Math.ceil(Math.max(0, SECURITY_DWELL_MS - order.dwellMs) / 1000)}s` : 'to hold';
  return `${kind}, ${Math.max(0, Math.ceil(order.remainingMs / 1000))}s`;
}
function securityEncounterListKey(systemIndex = state.currentPlanet) {
  const ledger = getSecurityLedger(systemIndex);
  if (!ledger) return 'none';
  return Object.values(ledger.orders).map((order) => `${order.id}:${securityOrderStatusText(order)}:${order.revision}`).join('|') + `#${ledger.recentEvents.length}`;
}
function renderSecurityEncounterListMarkup(systemIndex = state.currentPlanet) {
  const ledger = getSecurityLedger(systemIndex);
  const active = getSecurityActiveOrders(ledger);
  const recent = ledger ? Object.values(ledger.orders).filter((order) => order.outcome).sort((a, b) => finiteNumber(b.resolvedAtMs, 0) - finiteNumber(a.resolvedAtMs, 0)).slice(0, 6) : [];
  const classLabel = { warFlag: 'war flag', independent: 'independent', other: 'other', unknown: 'unidentified' };
  const rows = active.map((order) => `<div class="security-order-row" data-security-order-row="${escapeHtml(order.id)}">
      <div><strong>${escapeHtml(order.visitorName)}</strong> <span class="meta">${escapeHtml(classLabel[order.accessClass] || order.accessClass)} &middot; ${escapeHtml(order.kind)} &middot; rev ${order.revision}</span></div>
      <div class="meta">${escapeHtml(securityOrderStatusText(order))}${order.reason ? ` &middot; ${escapeHtml(order.reason)}` : ''}</div>
      <div class="security-order-actions">
        <button data-security-order="${escapeHtml(order.id)}" data-security-op="waive">Waive this check</button>
        <button data-security-order="${escapeHtml(order.id)}" data-security-op="withdraw" ${order.kind === 'withdraw' ? 'disabled' : ''}>Request withdrawal</button>
        <button data-security-order="${escapeHtml(order.id)}" data-security-op="cancel">Cancel instruction</button>
      </div>
    </div>`).join('');
  const history = recent.map((order) => `<div class="meta">${escapeHtml(order.visitorName)}: ${escapeHtml(securityOrderStatusText(order))}${order.reason ? ` (${escapeHtml(order.reason)})` : ''}</div>`).join('');
  return `${rows || '<div class="meta">No visitor is under instruction.</div>'}${history ? `<div class="meta security-history-head">Recent outcomes</div>${history}` : ''}`;
}
function refreshSecurityEncounterList() {
  if (!planetMenuEl || !state.planetMenuOpen || !state.docked || state.dockMenuTab !== 'security') return;
  const live = planetMenuEl.querySelector('[data-security-live]');
  if (!live) return;
  const key = securityEncounterListKey(state.currentPlanet);
  if (live.dataset.renderKey === key) return;
  live.dataset.renderKey = key;
  live.innerHTML = renderSecurityEncounterListMarkup(state.currentPlanet);
}

planetMenuEl?.addEventListener('click', (e) => {
  const securityRoe = e.target.closest('[data-security-roe]');
  if (securityRoe) {
    if (setSecurityPolicyOverride(state.currentPlanet, { roe: securityRoe.dataset.securityRoe })) {
      setLog(`${state.planets[state.currentPlanet]?.name || 'System'} rules of engagement: ${securityRoe.dataset.securityRoe === 'return-fire' ? 'return fire only' : 'defend'}.`);
    }
    renderPlanetMenu();
    return;
  }
  const securityAccess = e.target.closest('[data-security-access]');
  if (securityAccess) {
    const [cls, value] = String(securityAccess.dataset.securityAccess || '').split(':');
    if (cls && ['unknown','warFlag','independent','other'].includes(cls) && SECURITY_ACCESS_VALUES.includes(value) && setSecurityPolicyOverride(state.currentPlanet, { access: { [cls]: value } })) {
      setLog(`${state.planets[state.currentPlanet]?.name || 'System'} access for ${cls === 'warFlag' ? 'war flags' : cls === 'independent' ? 'independents' : 'everyone else'}: ${value}.`);
    }
    renderPlanetMenu();
    return;
  }
  const securityCheckpoint = e.target.closest('[data-security-checkpoint]');
  if (securityCheckpoint) {
    const enable = securityCheckpoint.dataset.securityCheckpoint === 'enable';
    const candidates = getSecurityAnchorCandidates(state.currentPlanet, PLAYER_SIDE);
    const current = getPlayerCheckpointConfig(state.currentPlanet);
    const anchor = current?.anchorStationId && candidates.some((station) => station.id === current.anchorStationId) ? current.anchorStationId : (candidates[0]?.id || null);
    if (setPlayerCheckpoint(state.currentPlanet, { enabled: enable, anchorStationId: enable ? anchor : undefined })) {
      setLog(enable ? `${state.planets[state.currentPlanet]?.name || 'System'} checkpoint enabled.` : `${state.planets[state.currentPlanet]?.name || 'System'} checkpoint disabled.`);
    }
    renderPlanetMenu();
    return;
  }
  const securityAnchor = e.target.closest('[data-security-anchor]');
  if (securityAnchor) {
    if (setPlayerCheckpoint(state.currentPlanet, { anchorStationId: securityAnchor.dataset.securityAnchor })) setLog('Checkpoint issuing installation updated.');
    renderPlanetMenu();
    return;
  }
  const securityOrder = e.target.closest('[data-security-order]');
  if (securityOrder) {
    operateSecurityOrder(securityOrder.dataset.securityOrder, securityOrder.dataset.securityOp);
    const live = planetMenuEl.querySelector('[data-security-live]');
    if (live) live.dataset.renderKey = '';
    refreshSecurityEncounterList();
    return;
  }
  const securityAction = e.target.closest('[data-security-action]');
  if (securityAction) {
    if (!isSystemControlled(state.currentPlanet)) return;
    if (securityAction.dataset.securityAction === 'use-default') {
      clearSecurityPolicyOverride(state.currentPlanet);
      setLog(`${state.planets[state.currentPlanet]?.name || 'System'} now uses the empire default security policy.`);
    } else if (securityAction.dataset.securityAction === 'set-default') {
      setSecurityPolicyDefault(getEffectiveSecurityPolicy(state.currentPlanet));
      setLog('Empire default security policy updated.');
    }
    renderPlanetMenu();
    return;
  }
  const tab = e.target.closest('.dock-tabs [data-dock-tab]');
  if (tab) {
    const panel = planetMenuEl.querySelector('.dock-panel');
    if (panel?.dataset?.dockTab) {
      state.dockPanelScrollByTab[panel.dataset.dockTab] = panel.scrollTop;
    }
    state.dockMenuTab = tab.dataset.dockTab || 'services';
    state.fleetPurchaseShipId = null;
    renderPlanetMenu();
    return;
  }
  const action = e.target.closest('[data-planet-action]');
  if (action) {
    const value = action.dataset.planetAction;
    if (value === 'close') closePlanetMenu();
    if (value === 'refuel') refuel();
    if (value === 'repair') repairHull();
    if (value === 'contract') negotiateContract();
    if (value === 'deliver') tradeAtPlanet();
    if (value === 'claim') claimCurrentSystem();
    if (value === 'claim') claimCurrentSystem();
    if (value === 'flags') {
      state.dockMenuTab = 'market';
      renderPlanetMenu();
    }
    if (value === 'construction') {
      if (getCurrentDockedStation()) {
        state.dockMenuTab = 'market';
        renderPlanetMenu();
        return;
      }
      state.dockMenuTab = 'construction';
      renderPlanetMenu();
    }
    return;
  }
  const buy = e.target.closest('[data-market-buy]');
  if (buy) {
    buyMarketGood(Number(buy.dataset.marketBuy));
    return;
  }
  const sell = e.target.closest('[data-market-sell]');
  if (sell) {
    sellMarketGood(Number(sell.dataset.marketSell));
    return;
  }
  const ship = e.target.closest('[data-ship-buy]');
  if (ship) {
    buyShip(Number(ship.dataset.shipBuy));
    return;
  }
  const fleetMenu = e.target.closest('[data-fleet-menu]');
  if (fleetMenu) {
    openFleetPurchaseModal(Number(fleetMenu.dataset.fleetMenu));
    return;
  }
  const fleetShip = e.target.closest('[data-fleet-buy]');
  if (fleetShip) {
    buyFleetShip(Number(fleetShip.dataset.fleetBuy));
    return;
  }
  const escortShip = e.target.closest('[data-escort-buy]');
  if (escortShip) {
    buyEscortShip(Number(escortShip.dataset.escortBuy));
    return;
  }
  const weaponBuy = e.target.closest('[data-weapon-buy]');
  if (weaponBuy) {
    buyWeapon(Number(weaponBuy.dataset.weaponBuy));
    return;
  }
  const stationPlanBuy = e.target.closest('[data-station-plan-buy]');
  if (stationPlanBuy) {
    buyStationPlan(Number(stationPlanBuy.dataset.stationPlanBuy));
    return;
  }
  const flagBuy = e.target.closest('[data-flag-buy]');
  if (flagBuy) {
    buyFactionFlag(flagBuy.dataset.flagBuy);
    return;
  }
  const flagRaise = e.target.closest('[data-flag-raise]');
  if (flagRaise) {
    raisePlayerFlag(flagRaise.dataset.flagRaise);
    return;
  }
  const stationRebuild = e.target.closest('[data-station-rebuild]');
  if (stationRebuild) {
    rebuildSystemStations();
    return;
  }
  const stationBuild = e.target.closest('[data-station-build]');
  if (stationBuild) {
    buildStation(Number(stationBuild.dataset.stationBuild));
  }
});

planetMenuEl?.addEventListener('wheel', (e) => {
  const panel = planetMenuEl.querySelector('.dock-panel');
  if (!panel || panel.scrollHeight <= panel.clientHeight) return;
  e.preventDefault();
  panel.scrollTop += e.deltaY;
  if (panel.dataset?.dockTab) state.dockPanelScrollByTab[panel.dataset.dockTab] = panel.scrollTop;
}, { passive: false });

window.addEventListener('keydown', (e) => {
  if (!state.gameStarted || state.warp.active || isWormholeTransitActive()) return;
  const key = e.key.toLowerCase();
  const typingInField = e.target?.matches?.('input, textarea, select, [contenteditable="true"]');
  if (state.pendingWormholeBuild) {
    if (typingInField && key !== 'escape') return;
    if (key === 'escape') closeWormholeBuildModal();
    e.preventDefault();
    return;
  }
  if (state.pendingStationBuild) {
    if (typingInField && key !== 'escape') return;
    if (key === 'escape') closeStationBuildModal();
    e.preventDefault();
    return;
  }
  if (state.pendingFleetPurchase) {
    if (key === 'escape') closeFleetPurchaseModal();
    e.preventDefault();
    return;
  }
  if (state.pendingShipPurchase) {
    if (key === 'escape') closeShipPurchaseModal();
    e.preventDefault();
    return;
  }
  if (state.pendingContractOffer) {
    if (key === 'escape') declinePendingContract();
    e.preventDefault();
    return;
  }
  if (key === 'm') {
    if (state.mapOpen) closeMap();
    else openMap();
  }
  if (key === 'h') hailSelectedShip();
  if (key === 'q') closeTopWindow();
  if (key === 'c') openTopLeftTab('inventory');
  if (key === 'p') {
    state.topLeftPanelOpen = !state.topLeftPanelOpen;
    renderTopLeftPanel();
  }
  if (key === '=' || key === '+') selectClosestContact();
  if (key === '-' || key === '_') deselectTarget();
  if (key === '`' || key === '~') toggleAutoTarget();

  if (key === 'escape') closeMap();
  if (key === 't') transport();
  if (key === 'n') negotiateContract();
  if (key === 'e') tradeAtPlanet();
  if (key === 'r') refuel();
  if (key === 'f') repairHull();
  if (key === 'l') openWeaponsLocker();
  if (key === 'arrowleft' && state.mapOpen) {
    selectRouteNeighbor(-1);
  }
  if (key === 'arrowright' && state.mapOpen) {
    selectRouteNeighbor(1);
  }
  if ((key === '+' || key === '=') && state.mapOpen) {
    zoomStarChart(1.18, canvas.width * 0.5, canvas.height * 0.5);
  }
  if ((key === '-' || key === '_') && state.mapOpen) {
    zoomStarChart(1 / 1.18, canvas.width * 0.5, canvas.height * 0.5);
  }
  if ((key === '0' || key === 'home') && state.mapOpen) {
    focusStarChartOnSystem(state.currentPlanet);
  }
});

function canvasEventPoint(e) {
  const rect = canvas.getBoundingClientRect();
  const sx = canvas.width / rect.width;
  const sy = canvas.height / rect.height;
  return {
    x: (e.clientX - rect.left) * sx,
    y: (e.clientY - rect.top) * sy,
  };
}

function handleStarChartPointerDown(e) {
  if (!state.gameStarted || state.gameOver || !state.mapOpen || state.warp.active || isWormholeTransitActive()) return;
  const point = canvasEventPoint(e);
  if (!isPointInStarChartViewport(point.x, point.y)) return;
  state.starChart.dragging = true;
  state.starChart.dragMoved = 0;
  state.starChart.lastX = e.clientX;
  state.starChart.lastY = e.clientY;
  e.currentTarget?.setPointerCapture?.(e.pointerId);
}

function handleStarChartPointerMove(e) {
  if (!state.starChart.dragging) return;
  const dx = e.clientX - state.starChart.lastX;
  const dy = e.clientY - state.starChart.lastY;
  state.starChart.panX += dx;
  state.starChart.panY += dy;
  state.starChart.dragMoved += Math.hypot(dx, dy);
  state.starChart.lastX = e.clientX;
  state.starChart.lastY = e.clientY;
}

function handleStarChartPointerUp(e) {
  if (!state.starChart.dragging) return;
  if (state.starChart.dragMoved > 6) {
    state.starChart.suppressClick = true;
    setTimeout(() => { state.starChart.suppressClick = false; }, 140);
  }
  state.starChart.dragging = false;
  e.currentTarget?.releasePointerCapture?.(e.pointerId);
}

function handleStarChartPointerCancel() {
  state.starChart.dragging = false;
}

function zoomStarChart(factor, screenX, screenY) {
  const before = screenToChart(screenX, screenY);
  const nextZoom = clamp(state.starChart.zoom * factor, 0.55, 3.2);
  if (nextZoom === state.starChart.zoom) return;
  state.starChart.zoom = nextZoom;
  const after = chartToScreen(before);
  state.starChart.panX += screenX - after.x;
  state.starChart.panY += screenY - after.y;
}

function handleStarChartWheel(e) {
  if (!state.gameStarted || state.gameOver || !state.mapOpen || state.warp.active || isWormholeTransitActive()) return;
  const point = canvasEventPoint(e);
  if (!isPointInStarChartViewport(point.x, point.y)) return;
  e.preventDefault();
  const factor = e.deltaY < 0 ? 1.14 : 1 / 1.14;
  zoomStarChart(factor, point.x, point.y);
}

function handleGameCanvasClick(e) {
  if (!state.gameStarted || state.gameOver) return;
  if (isWormholeTransitActive()) return;
  if (state.starChart.suppressClick) return;
  const { x: mx, y: my } = canvasEventPoint(e);
  if (state.mapOpen && isPointInStarChartViewport(mx, my)) {
    let closestIndex = -1;
    let closestDistance = Infinity;
    for (let i = 0; i < state.planets.length; i++) {
      const screen = getStarChartSystemScreen(i);
      const d = Math.hypot(mx - screen.x, my - screen.y);
      if (d < closestDistance) {
        closestDistance = d;
        closestIndex = i;
      }
    }
    if (closestIndex >= 0 && closestDistance <= 34) {
      const target = state.planets[closestIndex];
      if (closestIndex === state.currentPlanet) {
        state.selectedPlanet = closestIndex;
        setLog(`${target.name} is your current system.`);
      } else {
        const plan = getPlottedRoute(state.currentPlanet, closestIndex);
        if (plan) {
          if (state.selectedPlanet === closestIndex) {
            setLog(`Engaging warp to ${target.name}.`);
            jumpPlanet();
            return;
          }
          state.selectedPlanet = closestIndex;
          setLog(`Route plotted to ${target.name}: ${plan.legs.length} leg${plan.legs.length === 1 ? '' : 's'}. Click ${target.name} again to engage warp.`);
        } else {
          state.selectedPlanet = closestIndex;
          setLog(`No plotted route to ${target.name} from here.`);
        }
      }
      updateStats();
    }
    return;
  }
  if (state.mapOpen && isPointInStarChartPanel(mx, my)) return;
  const clickedNpc = findNpcAtScreen(mx, my);
  if (clickedNpc) {
    state.combatTargetId = clickedNpc.id;
    state.combatTargetType = 'ship';
    ensureNpcCombatStats(clickedNpc);
    setLog(`Target locked: ${playerContactLabel(clickedNpc)}. Press Space to fire.`);
    return;
  }
  const clickedStation = findStationAtScreen(mx, my);
  if (clickedStation) {
    if (isWormholeGeneratorStation(clickedStation)) {
      if (!tryEnterWormholeStation(clickedStation)) {
        state.combatTargetId = clickedStation.id;
        state.combatTargetType = 'station';
        ensureStationCombatStats(clickedStation);
      }
      return;
    }
    if (!tryDockAtStation(clickedStation)) {
      state.combatTargetId = clickedStation.id;
      state.combatTargetType = 'station';
      ensureStationCombatStats(clickedStation);
      setLog(`Target locked: ${playerContactLabel(clickedStation)}. Press Space to fire.`);
    }
    return;
  }
  const clickedWormhole = findWormholeAtScreen(mx, my);
  if (clickedWormhole) {
    tryEnterWormhole(clickedWormhole);
    return;
  }
  const clickedAsteroid = findAsteroidAtScreen(mx, my);
  if (clickedAsteroid && tryTransportClickedAsteroid(clickedAsteroid)) {
    return;
  }
  const p = getFlightPlanetMarker();
  const d = Math.hypot(mx - p.x, my - p.y);
  if (d <= p.clickRadius) {
    state.combatTargetId = null;
    state.combatTargetType = 'ship';
    showPlanetCallout(state.currentPlanet);
    tryDockAtPlanetIndex(state.currentPlanet, p);
  } else if (state.combatTargetId) {
    state.combatTargetId = null;
    state.combatTargetType = 'ship';
    setLog('Target cleared.');
  } else {
    setLog(`Click ${p.name} or a nearby station to dock, or press M to open the map.`);
    addWorldPop(p.x, p.y - p.drawSize * 0.55, 'Click planet');
  }
}

for (const mapInputTarget of [canvas, interstellarMapCanvas].filter(Boolean)) {
  mapInputTarget.addEventListener('pointerdown', handleStarChartPointerDown);
  mapInputTarget.addEventListener('pointermove', handleStarChartPointerMove);
  mapInputTarget.addEventListener('pointerup', handleStarChartPointerUp);
  mapInputTarget.addEventListener('pointercancel', handleStarChartPointerCancel);
  mapInputTarget.addEventListener('wheel', handleStarChartWheel, { passive: false });
  mapInputTarget.addEventListener('click', handleGameCanvasClick);
}

function clamp(n, min, max) {
  return Math.max(min, Math.min(max, n));
}

function approachZero(n, amount) {
  if (n > 0) return Math.max(0, n - amount);
  if (n < 0) return Math.min(0, n + amount);
  return 0;
}

function approachValue(current, target, amount) {
  if (current < target) return Math.min(target, current + amount);
  if (current > target) return Math.max(target, current - amount);
  return target;
}

function angleDelta(from, to) {
  return ((to - from + 540) % 360) - 180;
}

function distanceToPlayer(point) {
  return Math.hypot(point.x - state.camera.x, point.y - state.camera.y);
}

function getLivingNpcShips() {
  return state.npcShips.filter((npc) => !npc.destroyed && npc.trafficWarp?.phase !== 'away');
}

function getLivingStations() {
  return state.stations.filter((station) => !station.destroyed);
}

function getPlayerWeaponRange() {
  normalizeWeaponLoadout();
  return Math.max(...state.weaponSlots.filter(Boolean).map((weaponId) => getWeapon(weaponId).range || PLAYER_WEAPON_RANGE), PLAYER_WEAPON_RANGE);
}

function getNpcWeaponRange(npc) {
  const weaponId = getDefaultWeaponId(npc.shipId, npc.faction, true);
  if (!weaponId) return 0;
  const weapon = getWeapon(weaponId);
  return weapon.range || NPC_WEAPON_RANGE;
}

function getCombatTarget(weapon = null) {
  const weaponRange = weapon ? (weapon.range || PLAYER_WEAPON_RANGE) : getPlayerWeaponRange();
  const current = state.combatTargetType === 'station'
    ? state.stations.find((station) => station.id === state.combatTargetId && !station.destroyed && !station.underConstruction)
    : state.npcShips.find((npc) => npc.id === state.combatTargetId && !npc.destroyed);
  if (current && sensorCanTrack(state,current) && distanceToPlayer(current) <= weaponRange * 1.25) return current;
  const candidates = getLivingNpcShips().filter(n => sensorCanTrack(state,n))
    .map((npc) => ({ npc, distance: distanceToPlayer(npc) }))
    .filter((entry) => entry.distance <= weaponRange && entry.npc.attitude !== 'friendly')
    .sort((a, b) => {
      if (a.npc.hostile !== b.npc.hostile) return a.npc.hostile ? -1 : 1;
      return a.distance - b.distance;
    });
  state.combatTargetId = candidates[0]?.npc.id || null;
  state.combatTargetType = 'ship';
  return candidates[0]?.npc || null;
}

function cycleCombatTarget() {
  const weaponRange = getPlayerWeaponRange();
  const shipTargets = getLivingNpcShips().filter(n => sensorCanTrack(state,n))
    .filter((npc) => distanceToPlayer(npc) <= weaponRange)
    .map((target) => ({ target, type: 'ship', distance: distanceToPlayer(target) }));
  const stationTargets = getLivingStations().filter(n => sensorCanTrack(state,n))
    .filter((station) => !station.underConstruction)
    .filter((station) => distanceToPlayer(station) <= weaponRange)
    .map((target) => ({ target, type: 'station', distance: distanceToPlayer(target) }));
  const targets = [...shipTargets, ...stationTargets].sort((a, b) => a.distance - b.distance);
  if (!targets.length) {
    state.combatTargetId = null;
    state.combatTargetType = 'ship';
    setLog('No targets in weapons range.');
    return;
  }
  const current = targets.findIndex((entry) => (
    entry.type === state.combatTargetType && entry.target.id === state.combatTargetId
  ));
  const next = targets[(current + 1 + targets.length) % targets.length];
  state.combatTargetId = next.target.id;
  state.combatTargetType = next.type;
  const name = next.type === 'station' ? next.target.name : getShipStats(next.target.shipId).name;
  setLog(`Target locked: ${playerContactLabel(next.target)}.`);
}

function selectClosestContact() {
  const shipTargets = getLivingNpcShips().filter(n => sensorCanTrack(state,n))
    .map((npc) => ({ target: npc, type: 'ship', distance: distanceToPlayer(npc) }));
  const stationTargets = getLivingStations().filter(n => sensorCanTrack(state,n))
    .map((station) => ({ target: station, type: 'station', distance: distanceToPlayer(station) }));
  const targets = [...shipTargets, ...stationTargets].sort((a, b) => a.distance - b.distance);
  if (!targets.length) {
    setLog('No contacts in this system.');
    return;
  }
  state.combatTargetId = targets[0].target.id;
  state.combatTargetType = targets[0].type;
  const name = targets[0].type === 'station' ? (targets[0].target.name || 'Station') : getShipDisplayName(targets[0].target);
  setLog(`Closest contact: ${playerContactLabel(targets[0].target)}.`);
  rerenderTargetWindowNow();
}
function deselectTarget() {
  state.combatTargetId = null;
  state.combatTargetType = 'ship';
  setLog('Target cleared.');
  rerenderTargetWindowNow();
}
function toggleAutoTarget() {
  state.autoTarget = state.autoTarget === false;
  setLog(`Auto-target ${state.autoTarget ? 'on' : 'off'}.`);
}
function cycleAllContacts() {
  const shipTargets = getLivingNpcShips().filter(n => sensorCanTrack(state,n))
    .map((npc) => ({ target: npc, type: 'ship', distance: distanceToPlayer(npc) }));
  const stationTargets = getLivingStations().filter(n => sensorCanTrack(state,n))
    .map((station) => ({ target: station, type: 'station', distance: distanceToPlayer(station) }));
  const targets = [...shipTargets, ...stationTargets].sort((a, b) => a.distance - b.distance);
  if (!targets.length) {
    state.combatTargetId = null;
    state.combatTargetType = 'ship';
    setLog('No contacts in this system.');
    return;
  }
  const current = targets.findIndex((entry) => (
    entry.type === state.combatTargetType && entry.target.id === state.combatTargetId
  ));
  const next = targets[(current + 1 + targets.length) % targets.length];
  state.combatTargetId = next.target.id;
  state.combatTargetType = next.type;
  const name = next.type === 'station' ? (next.target.name || 'Station') : getShipDisplayName(next.target);
  setLog(`Contact: ${playerContactLabel(next.target)} (${Math.round(next.distance)}u).`);
  rerenderTargetWindowNow();
}
function findNpcAtScreen(x, y) {
  let best = null;
  let bestDistance = Infinity;
  for (const npc of getLivingNpcShips().filter(n => sensorCanTrack(state,n))) {
    const p = worldToScreen(npc);
    const radius = 26 + (npc.scale || 1) * 18;
    const distance = Math.hypot(x - p.x, y - p.y);
    if (distance <= radius && distance < bestDistance) {
      best = npc;
      bestDistance = distance;
    }
  }
  return best;
}

function findStationAtScreen(x, y) {
  let best = null;
  let bestDistance = Infinity;
  for (const station of getLivingStations().filter(n => sensorCanTrack(state,n))) {
    const p = worldToScreen(station);
    const radius = getStationScreenRadius(station);
    const distance = Math.hypot(x - p.x, y - p.y);
    if (distance <= radius && distance < bestDistance) {
      best = station;
      bestDistance = distance;
    }
  }
  return best;
}

function tryDockAtStation(station) {
  if (isWormholeGeneratorStation(station)) return tryEnterWormholeStation(station);
  if (station.underConstruction) {
    const remaining = getStationConstructionRemaining(station);
    setLog(`${station.name} is under construction. ${remaining} day${remaining === 1 ? '' : 's'} remaining.`);
    return false;
  }
  if (station.destroyed) {
    setLog(`${station.name} is destroyed.`);
    return false;
  }
  if (station.hostile || station.attitude === 'hostile') {
    setLog(`${station.name} is hostile. Target locked.`);
    return false;
  }
  const screen = worldToScreen(station);
  const distance = Math.hypot(state.ship.x - screen.x, state.ship.y - screen.y);
  const dockDistance = getStationScreenRadius(station) + 74;
  if (distance > dockDistance) {
    setLog(`Move closer to ${station.name} to dock.`);
    addWorldPop(screen.x, screen.y - 42, 'Too far');
    return false;
  }
  // The authority's own installations refuse a visitor with a pending or refused instruction;
  // concessions and private posts inside the zone are not the authority's and still receive you.
  const securityBlock = getSecurityDockingBlock(getStationOwner(station, state.currentPlanet));
  if (securityBlock) {
    playGameSound('uiError', { cooldownKey: 'dock:security' });
    setLog(securityBlock);
    addWorldPop(screen.x, screen.y - 42, 'Not cleared', '#ff9c9c');
    return false;
  }
  state.combatTargetId = null;
  state.combatTargetType = 'ship';
  openStationMenu(station);
  addWorldPop(screen.x, screen.y - 44, 'Docked', '#9cffb4');
  return true;
}

function addProjectile({
  x,
  y,
  heading,
  speed,
  owner,
  damage,
  color,
  targetId = null,
  ttl = null,
  weaponId = null,
  kind = 'bolt',
  turnRate = 0,
  hitRadius = null,
  targetType = 'ship',
  creditSource = owner, attack = null,
}) {
  const radians = heading * Math.PI / 180;
  state.projectiles.push({
    x,
    y,
    vx: Math.sin(radians) * speed,
    vy: -Math.cos(radians) * speed,
    owner,
    creditSource, attack,
    damage,
    color,
    targetId,
    targetType,
    weaponId,
    kind,
    speed,
    turnRate,
    heading,
    hitRadius,
    born: performance.now(),
    ttl: ttl ?? (owner === 'player' ? 1050 : 1250),
  });
}

function addWeaponEffect(effect) {
  state.weaponEffects.push({
    born: performance.now(),
    ttl: effect.ttl || 180,
    ...effect,
  });
}

function addShieldFlare(point, faction = 'neutral', options = {}) {
  const now = performance.now();
  const rotation = finiteNumber(options.rotation, 0);
  const impactPoint = options.impactPoint || null;
  const impactOffset = impactPoint && Number.isFinite(impactPoint.x) && Number.isFinite(impactPoint.y)
    ? worldVectorToLocal(rotation, impactPoint.x - point.x, impactPoint.y - point.y)
    : null;
  const flare = {
    kind: 'shield',
    x: point.x,
    y: point.y,
    width: options.width || 78,
    height: options.height || 78,
    shipId: options.shipId || null,
    maxWidth: options.maxWidth || 74,
    maxHeight: options.maxHeight || 74,
    scale: options.scale || 1,
    rotation,
    impactOffsetX: impactOffset?.x,
    impactOffsetY: impactOffset?.y,
    targetId: options.targetId || null,
    targetType: options.targetType || 'ship',
    trackPlayer: Boolean(options.trackPlayer),
    color: options.color || SHIELD_BUBBLE_COLOR,
    rippleSeed: Math.abs(hashString(`${options.targetType || 'ship'}:${options.targetId || point.x}:${now}`)),
    ttl: SHIELD_FLARE_TTL_MS,
  };
  const existing = state.weaponEffects.find((effect) => (
    effect.kind === 'shield'
    && effect.trackPlayer === flare.trackPlayer
    && effect.targetType === flare.targetType
    && (flare.trackPlayer || effect.targetId === flare.targetId)
  ));
  if (existing) {
    Object.assign(existing, flare, { born: now });
    return;
  }
  state.weaponEffects.push({ born: now, ...flare });
  const activeShieldFlares = state.weaponEffects
    .filter((effect) => effect.kind === 'shield')
    .sort((a, b) => b.born - a.born);
  if (activeShieldFlares.length > MAX_ACTIVE_SHIELD_FLARES) {
    const keep = new Set(activeShieldFlares.slice(0, MAX_ACTIVE_SHIELD_FLARES));
    state.weaponEffects = state.weaponEffects.filter((effect) => effect.kind !== 'shield' || keep.has(effect));
  }
}

function addHullExplosion(point, color = '#ff9c55', options = {}) {
  const scale = Math.max(0.7, finiteNumber(options.scale, 1));
  const radius = options.radius || 28 + scale * 17;
  const offsetRange = radius * 0.34;
  const offsetX = finiteNumber(options.offsetX, (Math.random() - 0.5) * offsetRange);
  const offsetY = finiteNumber(options.offsetY, (Math.random() - 0.5) * offsetRange);
  addWeaponEffect({
    kind: 'explosion',
    x: point.x + (options.trackPlayer ? 0 : offsetX),
    y: point.y + (options.trackPlayer ? 0 : offsetY),
    screenOffsetX: options.trackPlayer ? offsetX : 0,
    screenOffsetY: options.trackPlayer ? offsetY : 0,
    trackPlayer: Boolean(options.trackPlayer),
    radius,
    color,
    coreColor: options.coreColor || '#fff3b0',
    spriteIndex: Number.isFinite(options.spriteIndex) ? options.spriteIndex : Math.floor(Math.random() * 16),
    sparks: Array.from({ length: Math.round(clamp(7 + scale * 3, 7, 16)) }, () => ({
      angle: Math.random() * Math.PI * 2,
      speed: 0.55 + Math.random() * 0.95,
      length: 7 + Math.random() * 13,
      color: Math.random() > 0.45 ? '#ffcf73' : '#ff6b3a',
    })),
    ttl: options.ttl || 430,
  });
}

function createStationDebris(station) {
  const seedBase = Math.abs(hashString(`${state.currentPlanet}:${station.id}:${station.stationTypeId}`));
  const visual = getStationVisualProfile(station);
  const scale = Math.max(0.6, visual.scale);
  const radius = Math.max(64, getStationScreenRadius(station));
  const pieceCount = Math.round(clamp(
    radius / 5,
    STATION_DEBRIS_MIN_PIECES,
    STATION_DEBRIS_MAX_PIECES,
  ));
  const colors = ['#d8dde2', '#a9b1ba', '#747d86', '#4c5660', '#f1b56a', '#78d7ff'];
  return Array.from({ length: pieceCount }, (_, i) => {
    const seed = seedBase + i * 97;
    const angle = seeded(seed + 1) * Math.PI * 2;
    const spread = radius * (0.16 + seeded(seed + 2) * 0.54);
    const driftAngle = angle + (seeded(seed + 3) - 0.5) * 1.2;
    const speed = 0.04 + seeded(seed + 4) * 0.22;
    return {
      ox: Math.cos(angle) * spread,
      oy: Math.sin(angle) * spread,
      vx: Math.cos(driftAngle) * speed,
      vy: Math.sin(driftAngle) * speed,
      rotation: seeded(seed + 7) * 360,
      spin: (seeded(seed + 8) - 0.5) * 1.7,
      w: (5 + seeded(seed + 5) * 17) * scale,
      h: (3 + seeded(seed + 6) * 12) * scale,
      spriteIndex: i % 24,
      drawSize: radius * (0.16 + seeded(seed + 13) * 0.22),
      shape: seeded(seed + 9) > 0.42 ? 'plate' : 'spar',
      color: colors[Math.floor(seeded(seed + 10) * colors.length) % colors.length],
      alpha: 0.56 + seeded(seed + 11) * 0.34,
      limit: Math.max(90, Math.max(visual.width, visual.height) * scale * (0.62 + seeded(seed + 12) * 0.48)),
    };
  });
}

function ensureStationDebris(station) {
  if (!station.destroyed) return [];
  if (!Array.isArray(station.debris) || !station.debris.length) {
    station.debris = createStationDebris(station);
  }
  return station.debris;
}

function formatDamageResult(result) {
  const parts = [];
  if (result.shieldDamage > 0) parts.push(`${result.shieldDamage} shield`);
  if (result.hullDamage > 0) parts.push(`${result.hullDamage} hull`);
  return parts.join(' / ') || '0 damage';
}

function applyPlayerDamage(damage, color = '#ff7777', options = {}) {
  const amount = Math.max(0, Math.round(finiteNumber(damage, 0)));
  if (amount <= 0) return { shieldDamage: 0, hullDamage: 0 };
  if (state.godMode) {
    const visual = getShipVisualProfile(state.playership);
    state.lastShieldHitAt = performance.now();
    addShieldFlare(playerWorldPosition(), state.playerFaction, {
      shipId: state.playership,
      maxWidth: visual.width,
      maxHeight: visual.height,
      scale: state.ship.drawScale,
      rotation: state.ship.rotation,
      trackPlayer: true,
      impactPoint: options.impactPoint,
    });
    const needsRefresh = state.hull !== 100 || state.shields !== 100;
    state.hull = 100;
    state.shields = 100;
    playImpactSound({ blocked: true }, { cooldownKey: 'impact:player-shield', volume: 0.85 });
    if (needsRefresh) updateStats();
    return { shieldDamage: 0, hullDamage: 0, blocked: true };
  }
  state.shields = clamp(finiteNumber(state.shields, 0), 0, 100);
  const shieldDamage = Math.min(state.shields, amount, MAX_PLAYER_SHIELD_DAMAGE_PER_HIT);
  const hullDamage = Math.min(MAX_PLAYER_HULL_DAMAGE_PER_HIT, Math.max(0, amount - Math.min(state.shields, amount)));
  state.lastShieldHitAt = performance.now();
  if (shieldDamage > 0) {
    const visual = getShipVisualProfile(state.playership);
    state.shields = Math.max(0, state.shields - shieldDamage);
    addShieldFlare(playerWorldPosition(), state.playerFaction, {
      shipId: state.playership,
      maxWidth: visual.width,
      maxHeight: visual.height,
      scale: state.ship.drawScale,
      rotation: state.ship.rotation,
      trackPlayer: true,
      impactPoint: options.impactPoint,
    });
  }
  if (hullDamage > 0) {
    const radius = getShipScreenRadius(state.playership, state.ship.drawScale);
    const impact = options.impactPoint || null;
    const impactScreen = impact ? worldToScreen(impact) : null;
    state.hull = Math.max(0, state.hull - hullDamage);
    addHullExplosion(playerWorldPosition(), color, {
      scale: state.ship.drawScale,
      radius: radius * 0.88,
      trackPlayer: true,
      offsetX: impactScreen ? impactScreen.x - state.ship.x : undefined,
      offsetY: impactScreen ? impactScreen.y - state.ship.y : undefined,
    });
  }
  playImpactSound({ shieldDamage, hullDamage }, { cooldownKey: hullDamage > 0 ? 'impact:player-hull' : 'impact:player-shield' });
  updateStats();
  checkWinLose();
  return { shieldDamage, hullDamage };
}

function isPlayerKillCreditSource(source = '') {
  return source === 'player' || source === 'playerEscort';
}

function damageNpcShip(npc, damage, source = 'player', color = '#74d6ff', impactPoint = null) {
  ensureNpcCombatStats(npc);
  const amount = Math.max(0, Math.round(finiteNumber(damage, 0)));
  if (amount <= 0) return { shieldDamage: 0, hullDamage: 0 };
  const shieldDamage = Math.min(npc.combatShields, amount);
  const hullDamage = Math.max(0, amount - shieldDamage);
  npc.lastShieldHitAt = performance.now();
  npc.lastDamageSource = source;
  if (shieldDamage > 0) {
    const visual = getShipVisualProfile(npc.shipId);
    npc.combatShields = Math.max(0, npc.combatShields - shieldDamage);
    addShieldFlare(npc, npc.faction, {
      shipId: npc.shipId,
      maxWidth: visual.width,
      maxHeight: visual.height,
      scale: npc.scale || 1,
      rotation: npc.heading,
      targetId: npc.id,
      impactPoint,
    });
  }
  if (hullDamage > 0) {
    npc.combatHull -= hullDamage;
    addHullExplosion(impactPoint || npc, color, {
      scale: npc.scale || 1,
      radius: getShipScreenRadius(npc.shipId, npc.scale || 1) * 0.82,
    });
  }
  playImpactSound({ shieldDamage, hullDamage }, { cooldownKey: hullDamage > 0 ? `impact:ship-hull:${npc.id}` : `impact:ship-shield:${npc.id}`, volume: 0.92 });
  if (isPlayerKillCreditSource(source)) {
    const now = performance.now();
    npc.attitude = 'hostile';
    npc.hostile = true;
    npc.playerAggroUntil = now + NPC_PLAYER_AGGRO_MS;
    npc.playerEscortOrderUntil = now + PLAYER_ESCORT_ORDER_MS;
  }
  if (npc.combatHull <= 0) destroyNpcShip(npc);
  return { shieldDamage, hullDamage };
}

// The player's side attacked something: the victim's side and its allies here turn hostile to the
// player. Decided by side, never by flag: the player's own installations (recorded owners, cached
// copies included) and all player-side ships are never alerted against the player, whatever flag
// the victim flies.
function alertLocalDefenseAgainstPlayer(victimSide, attackedStation = null) {
  const now = performance.now();
  const target = typeof victimSide === 'string' && victimSide ? victimSide : getDefendingSideId(state.currentPlanet);
  if (!target || target === PLAYER_SIDE) return;
  const shouldAlert = (side) => sidesAligned(side, target);
  for (const station of state.stations || []) {
    if (!station || station.destroyed) continue;
    const owner = getStationOwner(station, state.currentPlanet);
    if (owner === PLAYER_SIDE || !shouldAlert(owner)) continue;
    station.attitude = 'hostile';
    station.hostile = true;
    station.playerAggroUntil = now + NPC_PLAYER_AGGRO_MS;
  }
  const systemStations = state.systemStates[state.currentPlanet]?.stations || [];
  for (const station of systemStations) {
    if (!station || station.destroyed) continue;
    const owner = getStationOwner(station, state.currentPlanet);
    if (owner === PLAYER_SIDE || !shouldAlert(owner)) continue;
    station.attitude = 'hostile';
    station.hostile = true;
    station.playerAggroUntil = now + NPC_PLAYER_AGGRO_MS;
  }
  for (const npc of state.npcShips || []) {
    if (!npc || npc.destroyed || isPlayerSideNpc(npc)) continue;
    if (!shouldAlert(getNpcSideId(npc))) continue;
    npc.attitude = 'hostile';
    npc.hostile = true;
    npc.playerAggroUntil = now + NPC_PLAYER_AGGRO_MS;
  }
}

function damageStation(station, damage, source = 'player', color = '#74d6ff', impactPoint = null) {
  ensureStationCombatStats(station);
  const visual = getStationVisualProfile(station);
  const amount = Math.max(0, Math.round(finiteNumber(damage, 0)));
  if (amount <= 0) return { shieldDamage: 0, hullDamage: 0 };
  const shieldDamage = Math.min(station.combatShields, amount);
  const hullDamage = Math.max(0, amount - shieldDamage);
  station.lastShieldHitAt = performance.now();
  if (shieldDamage > 0) {
    station.combatShields = Math.max(0, station.combatShields - shieldDamage);
    addShieldFlare(station, station.faction || state.systemFaction, {
      shipId: station.stationTypeId,
      maxWidth: visual.width,
      maxHeight: visual.height,
      scale: visual.scale,
      rotation: station.rotation || 0,
      targetId: station.id,
      targetType: 'station',
      impactPoint,
    });
  }
  if (hullDamage > 0) {
    station.combatHull -= hullDamage;
    addHullExplosion(impactPoint || station, color, {
      scale: visual.scale,
      radius: 42 + visual.scale * 24,
      ttl: 520,
    });
  }
  playImpactSound({ shieldDamage, hullDamage }, { cooldownKey: hullDamage > 0 ? `impact:station-hull:${station.id}` : `impact:station-shield:${station.id}`, volume: 1.05 });
  station.lastDamageSource = source;
  if (isPlayerKillCreditSource(source) && getStationOwner(station, state.currentPlanet) !== PLAYER_SIDE) {
    const now = performance.now();
    station.attitude = 'hostile';
    station.hostile = true;
    station.playerEscortOrderUntil = now + PLAYER_ESCORT_ORDER_MS;
    alertLocalDefenseAgainstPlayer(getStationOwner(station, state.currentPlanet), station);
  }
  if (station.combatHull <= 0) destroyStation(station);
  return { shieldDamage, hullDamage };
}

function getTargetName(target) {
  return target.stationTypeId ? target.name || getShipStats(target.stationTypeId).name || 'Station' : getShipDisplayName(target);
}

function ensureCombatTargetStats(target) {
  if (target.stationTypeId) ensureStationCombatStats(target);
  else ensureNpcCombatStats(target);
}

function getSelectedCombatTarget() {
  if (!state.combatTargetId) return null;
  const target = state.combatTargetType === 'station'
    ? state.stations.find((station) => station.id === state.combatTargetId && !station.destroyed)
    : state.npcShips.find((npc) => npc.id === state.combatTargetId && !npc.destroyed);
  if (!target) {
    state.combatTargetId = null;
    state.combatTargetType = 'ship';
  }
  return target && sensorCanTrack(state,target) ? target : null;
}

function formatTargetPercent(value, maxValue) {
  const max = Math.max(0, finiteNumber(maxValue, 0));
  if (max <= 0) return '0%';
  return `${Math.round(clamp(finiteNumber(value, 0) / max, 0, 1) * 100)}%`;
}

function renderTargetMeter(label, value, maxValue, color) {
  const max = Math.max(0, finiteNumber(maxValue, 0));
  const pct = max > 0 ? clamp(finiteNumber(value, 0) / max, 0, 1) : 0;
  return `<div class="target-meter">
    <div class="target-meter-head"><span>${escapeHtml(label)}</span><b>${escapeHtml(formatTargetPercent(value, maxValue))}</b></div>
    <div class="target-meter-track"><i style="width:${Math.round(pct * 100)}%;background:${escapeHtml(color)}"></i></div>
  </div>`;
}

function renderShipHailPanel(npc, distance) {
  if (!npc || npc.destroyed) return '';
  const inRange = distance <= SHIP_HAIL_RANGE;
  const blockReason = getNpcHailBlockReason(npc);
  const session = npc.hailSession;
  if (!session) {
    return `<div class="target-hail">
      <button data-hail-action="hail" ${inRange && !blockReason ? '' : 'disabled'}>${blockReason ? 'Hail Blocked' : inRange ? 'Hail Ship' : `Hail Range ${SHIP_HAIL_RANGE}`}</button>
      ${blockReason ? `<div class="target-hail-note">${escapeHtml(blockReason)}</div>` : ''}
      ${!blockReason && !inRange ? '<div class="target-hail-note">Move closer to open a channel.</div>' : ''}
    </div>`;
  }
  const sell = session.sellOffer;
  const buy = session.buyOffer;
  const sellDisabled = !sell || sell.sold || !inRange || blockReason || state.latinum < sell.price || state.cargo + sell.tons > state.cargoCap;
  const buyDisabled = !buy || buy.bought || !inRange || blockReason || !getLooseCargoPods().some((pod) => pod.item === buy.goods);
  return `<div class="target-hail open">
    <div class="target-hail-text">${escapeHtml(session.line)}</div>
    ${sell ? `<div class="target-trade-row">
      <span>Offers ${escapeHtml(sell.tons)} ${escapeHtml(sell.goods)} for ${escapeHtml(sell.price)}L</span>
      <button data-hail-action="buy-cargo" ${sellDisabled ? 'disabled' : ''}>${sell.sold ? 'Bought' : 'Buy'}</button>
    </div>` : ''}
    ${buy ? `<div class="target-trade-row">
      <span>Wants ${escapeHtml(buy.tons)} ${escapeHtml(buy.goods)} for ${escapeHtml(buy.price)}L</span>
      <button data-hail-action="sell-cargo" ${buyDisabled ? 'disabled' : ''}>${buy.bought ? 'Sold' : 'Sell'}</button>
    </div>` : '<div class="target-hail-note">They are not buying anything from your hold.</div>'}
    ${blockReason ? `<div class="target-hail-note">${escapeHtml(blockReason)}</div>` : ''}
    ${inRange ? '' : '<div class="target-hail-note">Signal fading. Move closer to trade.</div>'}
    <button data-hail-action="hail" ${blockReason ? 'disabled' : ''}>Hail Again</button>
    <button data-hail-action="scan" ${inRange && !blockReason ? '' : 'disabled'}>Scan Ship</button>
  </div>`;
}

function updateTargetWindow() {
  if (!targetWindowEl) return;
  if (!state.gameStarted || state.gameOver || state.warp.active || isWormholeTransitActive()) {
    targetWindowEl.classList.add('hidden');
    targetWindowEl.innerHTML = '';
    targetWindowEl.dataset.renderKey = '';
    return;
  }
  const target = getSelectedCombatTarget();
  if (!target) {
    targetWindowEl.classList.add('hidden');
    targetWindowEl.innerHTML = '';
    targetWindowEl.dataset.renderKey = '';
    return;
  }
  const knowledge=sensorDisplayContact(target);
  if(!knowledge.own){
    const key=`sensor:${target.id}:${Math.floor(sensorClock*5)}:${target.hailSession?.id||''}`;
    if(!targetWindowForceRender&&(!targetWindowEl.classList.contains('hidden'))&&(targetWindowEl.dataset.renderKey===key||targetWindowInteractionLockUntil>performance.now()))return;
    targetWindowEl.dataset.renderKey=key;
    targetWindowEl.classList.remove('hidden');
    targetWindowEl.innerHTML=`<div class="target-window-head"><span>CONTACT</span><b>${escapeHtml(knowledge.report?.hull||'Unidentified contact')}</b></div><div class="target-hail-note">Declared: ${escapeHtml(knowledge.declaration||'Unknown')}<br>${knowledge.report?'Assessment '+Math.max(0,sensorClock-knowledge.report.assessedAt).toFixed(1)+'s old<br>':''}${knowledge.report?.weapons?'Weapons: '+escapeHtml(knowledge.report.weapons.join(', ')||'None')+'<br>'+escapeHtml(knowledge.report.condition)+'<br>'+escapeHtml(knowledge.report.crew):'Technical assessment unavailable'}</div><button data-hail-action="scan">Focused scan</button>${!target.stationTypeId?renderShipHailPanel(target,distanceToPlayer(target)):''}`;
    return;
  }
  ensureCombatTargetStats(target);
  const isStation = Boolean(target.stationTypeId);
  const targetId = isStation ? target.stationTypeId : target.shipId;
  const stats = getShipStats(targetId);
  const name = isStation ? target.name || stats.name || 'Station' : getShipDisplayName(target);
  const typeLabel = isStation ? stats.name || 'Station' : stats.name || stats.shipClass || getShipVisualClass(targetId);
  const faction = target.faction || state.systemFaction || 'neutral';
  const shieldColor = getShieldColorForFaction(faction);
  const hullPct = target.maxCombatHull > 0 ? clamp(target.combatHull / target.maxCombatHull, 0, 1) : 0;
  const hullColor = hullPct > 0.45 ? '#9cffb4' : '#ff7777';
  const distance = Math.round(distanceToPlayer(target));
  const hailRangeState = isStation ? 'station' : distance <= SHIP_HAIL_RANGE ? 'hail-in' : 'hail-out';
  const spriteSrc = getShipImageSrc(targetId);
  const attitude = isStation ? '' : target.attitude || 'neutral';
  const now = performance.now();
  if (
    !targetWindowForceRender
    && !targetWindowEl.classList.contains('hidden')
    && targetWindowInteractionLockUntil > now
  ) {
    return;
  }
  const renderKey = [
    state.combatTargetType,
    target.id,
    Math.round(finiteNumber(target.combatShields, 0)),
    Math.round(finiteNumber(target.maxCombatShields, 0)),
    Math.round(finiteNumber(target.combatHull, 0)),
    Math.round(finiteNumber(target.maxCombatHull, 0)),
    hailRangeState,
    faction,
    attitude,
    !isStation ? target.hailSession?.id || 'no-hail' : 'station',
    !isStation && target.hailSession?.sellOffer?.sold ? 'sell-done' : 'sell-open',
    !isStation && target.hailSession?.buyOffer?.bought ? 'buy-done' : 'buy-open',
    state.cargo,
    state.latinum,
  ].join(':');
  if (!targetWindowEl.classList.contains('hidden') && targetWindowEl.dataset.renderKey === renderKey && now - lastTargetWindowRenderAt < 120) {
    return;
  }
  lastTargetWindowRenderAt = now;
  targetWindowEl.dataset.renderKey = renderKey;
  targetWindowEl.classList.remove('hidden');
  targetWindowEl.innerHTML = `<div class="target-window-head">
      <span>TARGET</span>
      <b>${escapeHtml(name)}</b>
    </div>
    <div class="target-window-body">
      <div class="target-preview">
        <img src="${escapeHtml(spriteSrc)}" alt="">
      </div>
      <div class="target-details">
        <div class="target-meta">${escapeHtml(isStation ? `${formatFaction(faction)} | ${distance}` : `${formatFaction(faction)} | ${attitude} | ${distance}`)}</div>
        <div class="target-class">${escapeHtml(typeLabel)}</div>${!isStation?`<div class="target-meta">Crew: ${escapeHtml(target.crewSkill||'Unknown')} / ${escapeHtml(target.crewTemperament||'Unknown')} (command telemetry)</div>`:''}
        ${renderTargetMeter('Shield', target.combatShields, target.maxCombatShields, shieldColor)}
        ${renderTargetMeter('Hull', target.combatHull, target.maxCombatHull, hullColor)}
      </div>
    </div>
    ${isStation ? '' : renderShipHailPanel(target, distance)}`;
}

function damageCombatTarget(target, damage, source = 'player', color = '#74d6ff', impactPoint = null) {
  return target.stationTypeId
    ? damageStation(target, damage, source, color, impactPoint)
    : damageNpcShip(target, damage, source, color, impactPoint);
}

const FLEET_STANCES = ['follow', 'attack', 'seek', 'planet', 'explore', 'trade'];
function getAlertStatus(now = performance.now()) {
  const stance = getFleetStance();
  if (stance === 'attack' || stance === 'seek') return 'red';
  if (now - finiteNumber(state.lastShieldHitAt, 0) < 6000) return 'red';
  if (stance === 'explore' || stance === 'planet' || stance === 'trade') return 'yellow';
  return 'green';
}
function getFleetStance() {
  const s = state.fleetStance;
  return FLEET_STANCES.includes(s) ? s : 'follow';
}
function getEscortAuxShips() {
  return getPlayerEscortFleetShips().filter((fleetShip) => {
    const cls = String(getShipStats(fleetShip.shipId).shipClass || '').toLowerCase();
    return cls === 'shuttle';
  });
}
function isAuxSeeker(npc) {
  return Boolean(state.auxLaunched && npc && npc.fleetId && getEscortAuxShips().some((s) => s.id === npc.fleetId));
}
function getEscortDestination(fleetShip, index, formation, now = performance.now()) {
  const stance = getFleetStance();
  const isAux = getEscortAuxShips().some((s) => s.id === fleetShip.id);
  if (state.auxLaunched && isAux) {
    const seed = finiteNumber(fleetShip.seed, index * 101 + 7);
    return {
      x: state.systemStar.x + (seeded(seed + 41) - 0.5) * 2200,
      y: state.systemStar.y + (seeded(seed + 42) - 0.5) * 1600,
    };
  }
  if (stance === 'planet' || stance === 'trade') {
    if (stance === 'trade') {
      const live = getLivingStations().filter((s) => !s.underConstruction);
      if (live.length) {
        let best = live[0];
        let bestD = Infinity;
        const player = playerWorldPosition();
        for (const s of live) {
          const d = Math.hypot(s.x - player.x, s.y - player.y);
          if (d < bestD) { bestD = d; best = s; }
        }
        return { x: best.x, y: best.y };
      }
    }
    return { x: state.systemPlanet.x, y: state.systemPlanet.y };
  }
  if (stance === 'explore') {
    const seed = finiteNumber(fleetShip.seed, index * 131 + 17);
    return {
      x: state.systemStar.x + (seeded(seed + 51) - 0.5) * 2600,
      y: state.systemStar.y + (seeded(seed + 52) - 0.5) * 1900,
    };
  }
  if (stance === 'attack') {
    const target = getSelectedCombatTarget();
    if (target) return { x: target.x, y: target.y };
  }
  return formation;
}
function retaskEscortWing() {
  const now = performance.now();
  const escorts = getPlayerEscortFleetShips();
  escorts.forEach((fleetShip, i) => {
    const npc = state.npcShips.find((n) => n.fleetId === fleetShip.id && !n.destroyed);
    if (!npc) return;
    npc.destination = getEscortDestination(fleetShip, i, getPlayerEscortFormationPoint(i, now), now);
  });
}
function fleetOrder(slot) {
  if (state.gameOver || !state.gameStarted || state.warp.active || isWormholeTransitActive()) return;
  const escorts = getPlayerEscortFleetShips();
  if (!escorts.length && slot !== 6) {
    setLog('No escort wing to order.');
    return;
  }
  const now = performance.now();
  if (slot === 1) {
    state.fleetStance = 'follow';
    retaskEscortWing();
    setLog('Fleet ordered to follow you under green alert...');
  } else if (slot === 2) {
    const target = getSelectedCombatTarget();
    if (!target) {
      setLog('No target selected for the fleet.');
      return;
    }
    state.fleetStance = 'attack';
    markPlayerEscortAttackOrder(target, now);
    retaskEscortWing();
    setLog(`Fleet ordered to attack your target: ${playerContactLabel(target)}.`);
  } else if (slot === 3) {
    state.fleetStance = 'seek';
    retaskEscortWing();
    setLog('Fleet ordered to Seek and Destroy enemy targets...');
  } else if (slot === 4) {
    state.fleetStance = 'planet';
    retaskEscortWing();
    setLog(`All escort ships ordered to gather at ${state.planets[state.currentPlanet]?.name || 'the planet'}...`);
  } else if (slot === 5) {
    const aux = getEscortAuxShips();
    if (!aux.length) {
      setLog('No auxiliary craft in escort wing.');
      return;
    }
    state.auxLaunched = true;
    retaskEscortWing();
    setLog('Launching all auxiliary craft...');
  } else if (slot === 6) {
    state.auxLaunched = false;
    retaskEscortWing();
    setLog('All nearby auxiliary craft loaded into shuttlebay...');
  } else if (slot === 7) {
    state.fleetStance = 'explore';
    retaskEscortWing();
    setLog('All escort ships ordered to explore the galaxy...');
  } else if (slot === 8) {
    state.fleetStance = 'trade';
    retaskEscortWing();
    setLog('All escort ships ordered to guard the trade lanes...');
  }
  updateStats();
}
function markPlayerEscortAttackOrder(target, now = performance.now()) {
  if (!target || target.destroyed) return;
  // No orders against the player's own installations or ships: refuse before touching the target.
  if (target.stationTypeId ? getStationOwner(target, state.currentPlanet) === PLAYER_SIDE : isPlayerSideNpc(target)) return;
  target.playerEscortOrderUntil = now + PLAYER_ESCORT_ORDER_MS;
  target.attitude = 'hostile';
  target.hostile = true;
  if (target.stationTypeId) {
    alertLocalDefenseAgainstPlayer(getStationOwner(target, state.currentPlanet), null);
  } else {
    target.playerAggroUntil = now + NPC_PLAYER_AGGRO_MS;
  }
}

function applyPlayerTractorBeam(weapon, target, slotIndex = 0, now = performance.now()) {
  if (!target || target.destroyed || target.stationTypeId) return false;
  const tractorSettings = getTractorBeamItemSettings();
  const player = playerWorldPosition();
  const targetRadius = getShipScreenRadius(target.shipId, target.scale || 1);
  const maxRange = finiteNumber(weapon.range, 700) * finiteNumber(tractorSettings.rangeGrace, TRACTOR_BEAM_RANGE_GRACE) + targetRadius;
  if (Math.hypot(target.x - player.x, target.y - player.y) > maxRange) {
    setLog(`${getTargetName(target)} is beyond tractor range.`);
    return false;
  }
  const expiresAt = now + finiteNumber(tractorSettings.holdMs, TRACTOR_BEAM_HOLD_MS);
  const existing = (state.tractorBeams || []).find((beam) => beam.owner === 'player' && beam.targetId === target.id);
  const base = existing || {
    id: `tractor-${target.id}`,
    owner: 'player',
    targetId: target.id,
    targetType: 'ship',
    weaponId: weapon.id,
    startedAt: now,
    lastPlayerX: player.x,
    lastPlayerY: player.y,
    towOffsetX: target.x - player.x,
    towOffsetY: target.y - player.y,
  };
  Object.assign(base, {
    slotIndex,
    expiresAt,
    color: weapon.color || TRACTOR_BEAM_COLOR,
    anchorX: target.x,
    anchorY: target.y,
  });
  if (!existing) state.tractorBeams.push(base);
  recordSensorHit(target, sensorAttackSnapshot(state));
  target.tractorHeldUntil = expiresAt;
  target.tractorOwner = 'player';
  target.systemWarpIntensity = 0;
  target.waitUntil = now + 120;
  target.destination = { x: target.x, y: target.y };
  setLog(`Slot ${slotIndex + 1}: tractor beam locked on ${getTargetName(target)}.`);
  return true;
}

function isNpcEngineDisabled(npc, now = performance.now()) {
  return finiteNumber(npc?.engineDisabledUntil, 0) > now;
}

function applyPlayerEngineDisruptorPulse(weapon, slotIndex = 0, now = performance.now()) {
  const disruptorSettings = getEngineDisruptorItemSettings();
  const disableMs = finiteNumber(disruptorSettings.disableMs, ENGINE_DISRUPTOR_DISABLE_MS);
  const waveMs = finiteNumber(disruptorSettings.waveMs, ENGINE_DISRUPTOR_WAVE_MS);
  const player = playerWorldPosition();
  const attack = sensorAttackSnapshot(state);
  const livingShips = (state.npcShips || []).filter((npc) => npc && !npc.destroyed);
  const farthestShipDistance = livingShips.reduce((maxDistance, npc) => Math.max(
    maxDistance,
    Math.hypot(npc.x - player.x, npc.y - player.y) + getShipScreenRadius(npc.shipId, npc.scale || 1) * 0.65,
  ), 0);
  const range = Math.max(120, finiteNumber(weapon.range, 1800), farthestShipDistance);
  const color = weapon.color || ENGINE_DISRUPTOR_COLOR;
  let affected = 0;
  for (const npc of livingShips) {
    const driftSeed = hashString(`${npc.id}:${Math.round(now / 100)}`);
    const driftHeading = finiteNumber(npc.heading, 0) * Math.PI / 180 + (seeded(driftSeed) - 0.5) * 0.42;
    const driftSpeed = clamp(finiteNumber(npc.speed, 1) * 0.28, 0.1, 0.42);
    npc.engineDisabledUntil = Math.max(finiteNumber(npc.engineDisabledUntil, 0), now + disableMs);
    npc.engineDriftX = Math.sin(driftHeading) * driftSpeed;
    npc.engineDriftY = -Math.cos(driftHeading) * driftSpeed;
    npc.systemWarpIntensity = 0;
    npc.waitUntil = now + disableMs;
    npc.destination = { x: npc.x, y: npc.y };
    npc.combatManeuver = null;
    recordSensorHit(npc, attack);
    affected += 1;
  }
  addWeaponEffect({
    kind: 'engine-disruptor-wave',
    x: player.x,
    y: player.y,
    radius: range,
    color,
    ttl: isReducedEffectsMode() ? Math.round(waveMs * 0.72) : waveMs,
  });
  setLog(`Slot ${slotIndex + 1}: engine disruptor pulse disabled ${affected} ship${affected === 1 ? '' : 's'} for ${Math.round(disableMs / 1000)} seconds.`);
  return affected;
}

function applyPlayerThaleronCloud(weapon, slotIndex = 0, now = performance.now()) {
  const thaleronSettings = getThaleronItemSettings();
  const cloudMs = finiteNumber(thaleronSettings.cloudMs, THALERON_CLOUD_MS);
  const player = playerWorldPosition();
  const attack = sensorAttackSnapshot(state);
  const range = Math.max(160, finiteNumber(weapon.range, 980));
  const color = weapon.color || THALERON_CLOUD_COLOR;
  const damage = getScaledWeaponDamage(state.playership, weapon, weapon.damage || PLAYER_WEAPON_DAMAGE);
  const targets = [
    ...(state.npcShips || [])
      .filter((npc) => npc && !npc.destroyed)
      .map((npc) => ({ target: npc, type: 'ship', radius: getShipScreenRadius(npc.shipId, npc.scale || 1) })),
    ...(state.stations || [])
      .filter((station) => station && !station.destroyed)
      .map((station) => ({ target: station, type: 'station', radius: getStationScreenRadius(station) })),
  ];
  let affected = 0;
  for (const entry of targets) {
    const target = entry.target;
    if (Math.hypot(target.x - player.x, target.y - player.y) > range + entry.radius * 0.55) continue;
    const impact = getWeaponImpactPoint(target, player, entry.type);
    recordSensorHit(target, attack);
    damageCombatTarget(target, damage, 'player', color, impact);
    affected += 1;
  }
  addWeaponEffect({
    kind: 'thaleron-cloud',
    x: player.x,
    y: player.y,
    radius: range,
    color,
    ttl: isReducedEffectsMode() ? Math.round(cloudMs * 0.7) : cloudMs,
  });
  setLog(`Slot ${slotIndex + 1}: thaleron cloud damaged ${affected} target${affected === 1 ? '' : 's'} in range.`);
  return affected;
}

function updateTractorBeams(frameScale = 1) {
  const now = performance.now();
  const player = playerWorldPosition();
  const tractorSettings = getTractorBeamItemSettings();
  const rangeGrace = finiteNumber(tractorSettings.rangeGrace, TRACTOR_BEAM_RANGE_GRACE);
  const anchorStrength = finiteNumber(tractorSettings.anchorStrength, TRACTOR_BEAM_ANCHOR_STRENGTH);
  const towFactor = finiteNumber(tractorSettings.towFactor, TRACTOR_BEAM_TOW_FACTOR);
  const active = [];
  for (const beam of state.tractorBeams || []) {
    if (finiteNumber(beam.expiresAt, 0) <= now) continue;
    const target = beam.targetType === 'ship'
      ? state.npcShips.find((npc) => npc.id === beam.targetId && !npc.destroyed)
      : null;
    if (!target) continue;
    const weapon = getWeapon(beam.weaponId || TRACTOR_BEAM_WEAPON_ID);
    const targetRadius = getShipScreenRadius(target.shipId, target.scale || 1);
    const maxRange = finiteNumber(weapon.range, 700) * rangeGrace + targetRadius;
    if (Math.hypot(target.x - player.x, target.y - player.y) > maxRange) {
      continue;
    }

    const playerDx = player.x - finiteNumber(beam.lastPlayerX, player.x);
    const playerDy = player.y - finiteNumber(beam.lastPlayerY, player.y);
    const playerDelta = Math.hypot(playerDx, playerDy);
    const followStrength = clamp(anchorStrength * frameScale, 0, 0.48);
    if (playerDelta > 0.015) {
      target.x += playerDx * towFactor;
      target.y += playerDy * towFactor;
      const desiredX = player.x + finiteNumber(beam.towOffsetX, target.x - player.x);
      const desiredY = player.y + finiteNumber(beam.towOffsetY, target.y - player.y);
      target.x += (desiredX - target.x) * followStrength;
      target.y += (desiredY - target.y) * followStrength;
      beam.anchorX = target.x;
      beam.anchorY = target.y;
    } else {
      const holdStrength = clamp(0.22 * frameScale, 0, 0.58);
      target.x += (finiteNumber(beam.anchorX, target.x) - target.x) * holdStrength;
      target.y += (finiteNumber(beam.anchorY, target.y) - target.y) * holdStrength;
    }
    target.tractorHeldUntil = beam.expiresAt;
    target.tractorOwner = beam.owner;
    target.systemWarpIntensity = 0;
    target.waitUntil = now + 140;
    target.destination = { x: target.x, y: target.y };
    beam.lastPlayerX = player.x;
    beam.lastPlayerY = player.y;
    active.push(beam);
  }
  state.tractorBeams = active;
}

function firePlayerWeapon(slot = 1) {
  if (state.gameOver || !state.gameStarted || state.warp.active) return;
  const now = performance.now();
  normalizeWeaponLoadout();
  const slotIndex = clamp(Math.round(Number(slot) || 1), 1, 3) - 1;
  const weaponId = state.weaponSlots[slotIndex];
  if (!weaponId) {
    setLog(`No weapon loaded in slot ${slotIndex + 1}.`);
    return;
  }
  const weapon = getWeapon(weaponId);
  if (weapon.passiveEffect === 'secondary-reactor') {
    setLog('Secondary Warp Core is active while fitted. Additional cores do not stack.');
    return;
  }
  const lastFiredAt = state.weaponLastFiredAt[slotIndex] || 0;
  const cooldown = getScaledWeaponCooldown(state.playership, weapon);
  if (isCloakingDevice(weapon)) {
    if (isPlayerCloaked(now)) {
      setPlayerCloak(false, now);
      state.weaponLastFiredAt[slotIndex] = now;
      return;
    }
    if (now - lastFiredAt < cooldown) return;
    if (!consumeWeaponEnergy(getWeaponEnergyCost(weapon))) return;
    state.weaponLastFiredAt[slotIndex] = now;
    setPlayerCloak(true, now);
    return;
  }
  if (now - lastFiredAt < cooldown) return;
  if (weapon.guidance === 'home-on-jam') {
    const selected=getSelectedCombatTarget();
    const target=selected||(state.autoTarget!==false?[...state.npcShips,...state.stations].find(n=>!n.destroyed&&hasHojLaunchTrack(state,n)&&hojEngagementAllowed(state,n)&&sensorDistance(playerWorldPosition(),n)<=weapon.range):null);
    if(!launchHoj(state,target,weapon,now,slotIndex,!!selected))setLog('Anti-emitter torpedo needs a fresh jamming emission in launch range.');
    return;
  }
  if (isEngineDisruptorWeapon(weapon)) {
    if (!consumeWeaponEnergy(getWeaponEnergyCost(weapon))) return;
    if (isPlayerCloaked(now)) setPlayerCloak(false, now, true);
    state.lastPlayerShotAt = now;
    state.weaponLastFiredAt[slotIndex] = now;
    playWeaponSound(weapon, { sourceId: `player:${slotIndex}`, volume: 1.02 });
    applyPlayerEngineDisruptorPulse(weapon, slotIndex, now);
    return;
  }
  if (isThaleronGeneratorWeapon(weapon)) {
    if (!consumeWeaponEnergy(getWeaponEnergyCost(weapon))) return;
    if (isPlayerCloaked(now)) setPlayerCloak(false, now, true);
    state.lastPlayerShotAt = now;
    state.weaponLastFiredAt[slotIndex] = now;
    playWeaponSound(weapon, { sourceId: `player:${slotIndex}`, volume: 1.05 });
    applyPlayerThaleronCloud(weapon, slotIndex, now);
    return;
  }
  const autoSelected = state.autoTarget === false ? getSelectedCombatTarget() : null;
  const target = state.autoTarget === false
    ? (autoSelected && distanceToPlayer(autoSelected) <= getPlayerWeaponRange() * 1.25 ? autoSelected : null)
    : getCombatTarget(weapon);
  if (!target || !sensorCanTrack(state,target)) {
    if (fireCounterfirePoint(state,getCounterfireCue(state),weapon,now,slotIndex)) return;
    if (now - lastFiredAt > 800) setLog(`No targets in range for slot ${slotIndex + 1}: ${weapon.name}.`);
    state.weaponLastFiredAt[slotIndex] = now - cooldown + 120;
    return;
  }
  ensureCombatTargetStats(target);
  if (isTractorBeamWeapon(weapon) && target.stationTypeId) {
    setLog('Tractor beams cannot lock onto station mass. Target a ship.');
    state.weaponLastFiredAt[slotIndex] = now;
    return;
  }
  if (!consumeWeaponEnergy(getWeaponEnergyCost(weapon))) return;
  if (isPlayerCloaked(now)) setPlayerCloak(false, now, true);
  if (target.attitude === 'friendly') {
    setLog(`You attacked a friendly ${formatFaction(target.faction)} ${target.stationTypeId ? 'station' : 'ship'}. They are now hostile.`);
  }
  target.attitude = 'hostile';
  target.hostile = true;
  recordPlayerAggressionAgainst(target, now);
  markPlayerEscortAttackOrder(target, now);
  state.combatTargetId = target.id;
  state.combatTargetType = target.stationTypeId ? 'station' : 'ship';
  state.lastPlayerShotAt = now;
  state.weaponLastFiredAt[slotIndex] = now;
  if (isTractorBeamWeapon(weapon)) {
    playWeaponSound(weapon, { sourceId: `player:${slotIndex}`, volume: 0.92 });
    applyPlayerTractorBeam(weapon, target, slotIndex, now);
    return;
  }
  const visualKind = getWeaponVisualKind(weapon);
  const shotColor = getWeaponShotColor(state.playerFaction, weapon);
  const tracksTarget = isTrackingProjectileWeapon(weapon);
  const targetHeading = (Math.atan2(target.x - state.camera.x, -(target.y - state.camera.y)) * 180 / Math.PI + 360) % 360;
  const heading = tracksTarget ? targetHeading : state.ship.rotation;
  const radians = heading * Math.PI / 180;
  const targetCenter = { x: target.x, y: target.y };
  const origin = visualKind === 'beam' && weapon.type === 'Beam'
    ? getPhaserEmitterPoint(null, targetCenter, weapon, hashString(`player:${weapon.id}:${slotIndex}:${Math.round(now / 90)}`), 'player')
    : {
      x: state.camera.x + Math.sin(radians) * 48,
      y: state.camera.y - Math.cos(radians) * 48,
    };

  if (visualKind === 'beam') {
    playWeaponSound(weapon, { sourceId: `player:${slotIndex}`, volume: 1 });
    const shotDamage = getScaledWeaponDamage(state.playership, weapon, weapon.damage || PLAYER_WEAPON_DAMAGE);
    const impact = getWeaponImpactPoint(target, origin, target.stationTypeId ? 'station' : 'ship');
    recordSensorHit(target, sensorAttackSnapshot(state));
    const result = damageCombatTarget(target, shotDamage, 'player', shotColor, impact);
    if (isCuttingBeamWeapon(weapon)) {
      addCuttingBeamEffects({
        weapon,
        source: null,
        sourceType: 'player',
        target,
        targetType: target.stationTypeId ? 'station' : 'ship',
        color: CUTTING_BEAM_COLOR,
        seedValue: hashString(`player-cutting:${weapon.id}:${slotIndex}:${Math.round(now / 80)}`),
        baseWidth: 2.6,
        ttl: 285,
      });
    } else {
      addWeaponEffect({
        kind: 'beam',
        weaponId: weapon.id,
        from: origin,
        to: impact,
        color: shotColor,
        width: weapon.type === 'Utility' ? 2.2 : 3.4,
        ttl: weapon.type === 'Utility' ? 240 : 170,
      });
    }
    setLog(`Slot ${slotIndex + 1}: ${weapon.name} hit ${playerContactLabel(target)}: ${formatDamageResult(result)}.`);
    return;
  }

  const projectileKind = visualKind === 'mine' ? 'mine' : visualKind === 'torpedo' ? 'torpedo' : 'bolt';
  const barrelCount = getWeaponBarrelCount(weapon, projectileKind);
  const totalDamage = getScaledWeaponDamage(state.playership, weapon, weapon.damage || PLAYER_WEAPON_DAMAGE);
  const lateral = { x: Math.cos(radians), y: Math.sin(radians) };
  const spacing = 13 * state.ship.drawScale;
  for (let i = 0; i < barrelCount; i++) {
    const offset = barrelCount === 1 ? 0 : (i === 0 ? -spacing : spacing);
    const shotDamage = barrelCount === 1
      ? totalDamage
      : Math.max(1, Math.floor(totalDamage / barrelCount) + (i < totalDamage % barrelCount ? 1 : 0));
    addProjectile({
      attack: sensorAttackSnapshot(state),
      x: origin.x + lateral.x * offset,
      y: origin.y + lateral.y * offset,
      heading: heading + (barrelCount === 1 ? 0 : (i === 0 ? -1.6 : 1.6)),
      speed: weapon.speed || 13.5,
      owner: 'player',
      damage: shotDamage,
      color: shotColor,
      targetId: target.id,
      targetType: target.stationTypeId ? 'station' : 'ship',
      weaponId: weapon.id,
      kind: projectileKind,
      turnRate: getProjectileTurnRate(weapon, 'player'),
      hitRadius: projectileKind === 'torpedo' ? 34 : projectileKind === 'mine' ? 46 : null,
      ttl: Math.max(700, Math.round((weapon.range || PLAYER_WEAPON_RANGE) / Math.max(1, weapon.speed || 13.5) * 16.6667)),
    });
  }
  playWeaponSound(weapon, { sourceId: `player:${slotIndex}`, volume: 1 });
  setLog(`Slot ${slotIndex + 1}: launched ${weapon.name} at ${playerContactLabel(target)}.`);
}

function processHeldWeaponInputs() {
  if (state.gameOver || !state.gameStarted || state.warp.active) return;
  for (const slot of getHeldWeaponSlots()) {
    if (isWeaponSlotCloakingDevice(slot)) continue;
    firePlayerWeapon(slot);
  }
}

function fireNpcWeapon(npc, target = playerWorldPosition(), targetType = 'player', now = performance.now()) {
  if (!sensorCanTrack(npc, targetType === 'player' ? state : target)) return;
  const weaponId = getDefaultWeaponId(npc.shipId, npc.faction, true);
  if (!weaponId) return;
  const weapon = getWeapon(weaponId);
  if(weapon.guidance==='home-on-jam'){launchHoj(npc,targetType==='player'?state:target,weapon,now);return;}
  const cooldown = getScaledWeaponCooldown(npc.shipId, weapon, NPC_WEAPON_COOLDOWN_SCALE, NPC_WEAPON_FLOOR_SCALE);
  if (now - (npc.lastShotAt || 0) < cooldown) return;
  const power = ensureNpcPower(npc);
  const cost = getWeaponEnergyCost(weapon, npc);
  if (!crewAllowsShot(power, getActorPowerProfile(npc), cost) || !spendPower(power, cost)) return;
  npc.lastShotAt = now;
  // Observed aggression: firing on someone makes this ship an attacker of that side for a while,
  // whatever flag it flies. Defenders classify relative to themselves (isNpcSystemAttacker).
  npc.lastAggressionAt = now;
  npc.lastAggressionSystemIndex = Number(state.currentPlanet);
  npc.lastAggressionTargetSide = targetType === 'player'
    ? PLAYER_SIDE
    : targetType === 'station' ? getStationOwner(target, state.currentPlanet) : getNpcSideId(target);
  const shotColor = getWeaponShotColor(npc.faction, weapon);
  const targetHeading = (Math.atan2(target.x - npc.x, -(target.y - npc.y)) * 180 / Math.PI + 360) % 360;
  const visualKind = getWeaponVisualKind(weapon);
  const tracksTarget = isTrackingProjectileWeapon(weapon);
  const heading = visualKind === 'beam' || tracksTarget ? targetHeading : finiteNumber(npc.heading, targetHeading);
  const radians = heading * Math.PI / 180;
  const damageScale = targetType === 'player' ? NPC_WEAPON_DAMAGE_SCALE : NPC_STATION_DAMAGE_SCALE;
  const damage = getScaledWeaponDamage(npc.shipId, weapon, weapon.damage || NPC_WEAPON_DAMAGE, damageScale, npc);
  playWeaponSound(weapon, { sourceId: `npc:${npc.id}`, volume: targetType === 'player' ? 0.82 : 0.58 });
  if (visualKind === 'beam') {
    const origin = weapon.type === 'Beam'
      ? getPhaserEmitterPoint(npc, target, weapon, hashString(`${npc.id}:${weapon.id}:${Math.round(now / 90)}`), 'ship')
      : {
        x: npc.x + Math.sin(radians) * 32,
        y: npc.y - Math.cos(radians) * 32,
      };
    const impact = getWeaponImpactPoint(targetType === 'player' ? null : target, origin, targetType);
    recordSensorHit(targetType === 'player' ? state : target, sensorAttackSnapshot(npc));
    if (targetType === 'player') applyPlayerDamage(damage, shotColor, { impactPoint: impact });
    else damageCombatTarget(target, damage, isPlayerEscortNpc(npc) ? 'playerEscort' : 'npc', shotColor, impact);
    if (isCuttingBeamWeapon(weapon)) {
      addCuttingBeamEffects({
        weapon,
        source: npc,
        sourceType: 'ship',
        target,
        targetType,
        color: CUTTING_BEAM_COLOR,
        seedValue: hashString(`${npc.id}:cutting:${weapon.id}:${Math.round(now / 80)}`),
        baseWidth: 2.35,
        ttl: 260,
      });
    } else {
      addWeaponEffect({
        kind: 'beam',
        weaponId: weapon.id,
        from: origin,
        to: impact,
        color: shotColor,
        width: 3.1,
        ttl: 165,
      });
    }
    return;
  }
  addProjectile({
    attack: sensorAttackSnapshot(npc),
    x: npc.x + Math.sin(radians) * 32,
    y: npc.y - Math.cos(radians) * 32,
    heading,
    speed: weapon.speed || 8.5,
    owner: 'npc',
    creditSource: isPlayerEscortNpc(npc) ? 'playerEscort' : 'npc',
    damage,
    color: shotColor,
    targetId: targetType === 'player' ? null : target.id || null,
    weaponId: weapon.id,
    kind: visualKind === 'torpedo' ? 'torpedo' : 'bolt',
    targetType,
    turnRate: getProjectileTurnRate(weapon, 'npc'),
    ttl: Math.max(650, Math.round((weapon.range || NPC_WEAPON_RANGE) / Math.max(1, weapon.speed || 8.5) * 16.6667)),
  });
}

function fireStationWeapon(station, target, now = performance.now()) {
  if (station.destroyed || station.underConstruction) return;
  if (!sensorCanTrack(station,target.id ? target : state)) return;
  const candidateIds=(station.stationWeaponIds?.length?station.stationWeaponIds:getStationWeaponIds(station)).filter(id=>isCombatWeapon(getWeapon(id)));
  const candidate=getWeapon(candidateIds[(station.shotIndex||0)%candidateIds.length]||DEFAULT_WEAPON_ID);
  if(candidate.guidance==='home-on-jam'){if(launchHoj(station,target.id?target:state,candidate,now))station.shotIndex=(station.shotIndex||0)+1;return;}
  const stationScale = getStationVisualProfile(station).scale;
  const targetType = target.stationTypeId ? 'station' : target.id ? 'ship' : 'player';
  const baseCooldown = station.defenseCooldown || STATION_WEAPON_COOLDOWN_MS;
  const cooldown = targetType === 'player'
    ? Math.max(STATION_PLAYER_MIN_COOLDOWN_MS, Math.round(baseCooldown * STATION_PLAYER_COOLDOWN_SCALE))
    : baseCooldown;
  if (now - (station.lastShotAt || 0) < cooldown) return;
  station.lastShotAt = now;
  // Station fire is observed aggression too, so retaliation against a station needs the same
  // attributable evidence as retaliation against a ship.
  station.lastAggressionAt = now;
  station.lastAggressionSystemIndex = Number(state.currentPlanet);
  station.lastAggressionTargetSide = targetType === 'player'
    ? PLAYER_SIDE
    : targetType === 'station' ? getStationOwner(target, state.currentPlanet) : getNpcSideId(target);
  const weaponIds = (station.stationWeaponIds?.length ? station.stationWeaponIds : getStationWeaponIds(station))
    .filter((weaponId) => isCombatWeapon(getWeapon(weaponId)));
  const weapon = getWeapon(weaponIds.length ? weaponIds[(station.shotIndex || 0) % weaponIds.length] : DEFAULT_WEAPON_ID);
  station.shotIndex = (station.shotIndex || 0) + 1;
  const visualKind = getWeaponVisualKind(weapon);
  const shotColor = getWeaponShotColor(station.faction || state.systemFaction, weapon);
  const baseDamage = station.defenseDamage || Math.max(STATION_WEAPON_DAMAGE, weapon.damage || STATION_WEAPON_DAMAGE);
  const damage = targetType === 'player'
    ? Math.max(4, Math.round(baseDamage * STATION_PLAYER_DAMAGE_SCALE))
    : baseDamage;
  const heading = (Math.atan2(target.x - station.x, -(target.y - station.y)) * 180 / Math.PI + 360) % 360;
  const radians = heading * Math.PI / 180;
  const originDistance = 44 + stationScale * 14;
  const origin = {
    x: station.x + Math.sin(radians) * originDistance,
    y: station.y - Math.cos(radians) * originDistance,
  };
  playWeaponSound(weapon, { sourceId: `station:${station.id}`, volume: targetType === 'player' ? 0.86 : 0.62 });

  if (visualKind === 'beam') {
    const beamOrigin = weapon.type === 'Beam'
      ? getPhaserEmitterPoint(station, target, weapon, hashString(`${station.id}:${weapon.id}:${Math.round(now / 90)}`), 'station')
      : origin;
    const impact = getWeaponImpactPoint(targetType === 'player' ? null : target, beamOrigin, targetType);
    recordSensorHit(targetType === 'player' ? state : target, sensorAttackSnapshot(station));
    if (targetType === 'player') applyPlayerDamage(damage, shotColor, { impactPoint: impact });
    else damageCombatTarget(target, damage, 'station', shotColor, impact);
    if (isCuttingBeamWeapon(weapon)) {
      addCuttingBeamEffects({
        weapon,
        source: station,
        sourceType: 'station',
        target,
        targetType,
        color: CUTTING_BEAM_COLOR,
        seedValue: hashString(`${station.id}:cutting:${weapon.id}:${Math.round(now / 80)}`),
        baseWidth: 2.8,
        ttl: 280,
      });
    } else {
      addWeaponEffect({
        kind: 'beam',
        weaponId: weapon.id,
        from: beamOrigin,
        to: impact,
        color: shotColor,
        width: 3.8,
        ttl: 175,
      });
    }
    return;
  }

  const projectileKind = visualKind === 'torpedo' ? 'torpedo' : 'bolt';
  const barrelCount = getWeaponBarrelCount(weapon, projectileKind);
  const lateral = { x: Math.cos(radians), y: Math.sin(radians) };
  const spacing = 12 + stationScale * 6;
  for (let i = 0; i < barrelCount; i++) {
    const offset = barrelCount === 1 ? 0 : (i === 0 ? -spacing : spacing);
    const shotDamage = barrelCount === 1
      ? damage
      : Math.max(1, Math.floor(damage / barrelCount) + (i < damage % barrelCount ? 1 : 0));
    addProjectile({
      attack: sensorAttackSnapshot(station),
      x: origin.x + lateral.x * offset,
      y: origin.y + lateral.y * offset,
      heading: heading + (barrelCount === 1 ? 0 : (i === 0 ? -1.8 : 1.8)),
      speed: weapon.speed || 10.5,
      owner: 'station',
      damage: shotDamage,
      color: shotColor,
      targetId: target.id || null,
      targetType,
      weaponId: weapon.id,
      kind: projectileKind,
      turnRate: getProjectileTurnRate(weapon, 'station'),
      hitRadius: projectileKind === 'torpedo' ? 36 : null,
      ttl: Math.max(800, Math.round((weapon.range || station.defenseRange || STATION_DEFENSE_RANGE) / Math.max(1, weapon.speed || 10.5) * 16.6667)),
    });
  }
}

function updateStationDefenses() {
  if (!state.stations.length) return;
  const now = performance.now();
  const playerCloaked = isPlayerCloaked(now);
  for (const station of state.stations) {
    if (station.destroyed || station.underConstruction) continue;
    const cue=getCounterfireCue(station);if(cue)fireCounterfirePoint(station,cue,getWeapon(getStationWeaponIds(station)[0]),now);
    const range = station.defenseRange || STATION_DEFENSE_RANGE;
    // A player-owned installation never fires on the player, whatever flags were set on it.
    if (!playerCloaked && !isSpawnProtected(now) && station.hostile && distanceToPlayer(station) <= range
      && getStationOwner(station, state.currentPlanet) !== PLAYER_SIDE) {
      fireStationWeapon(station, playerWorldPosition(), now);
      continue;
    }
    const hostiles = getLivingNpcShips().filter((npc) => sensorCanTrack(station,npc) && isNpcSystemAttacker(npc, station)); // relative to the station's own owner
    if (!hostiles.length) continue;
    const target = hostiles
      .map((npc) => ({ npc, distance: Math.hypot(npc.x - station.x, npc.y - station.y) }))
      .filter((entry) => entry.distance <= range)
      .sort((a, b) => a.distance - b.distance)[0]?.npc;
    if (target) fireStationWeapon(station, target, now);
  }
}

function destroyNpcShip(npc) {
  npc.destroyed = true;
  npc.hostile = false;
  playGameSound('explosion', { cooldownKey: `destroy:ship:${npc.id}`, volume: 0.95, rateJitter: 0.12 });
  if (state.combatTargetType === 'ship' && state.combatTargetId === npc.id) state.combatTargetId = null;
  const systemShip = state.systemStates[state.currentPlanet]?.npcShips?.find((entry) => entry.id === npc.id);
  if (systemShip) systemShip.destroyed = true;
  if (npc.fleetId) {
    const fleetShip = state.playerFleet.find((ship) => ship.id === npc.fleetId);
    if (fleetShip) fleetShip.destroyed = true;
    const isEscort = fleetShip?.assignment === 'escort' || isPlayerEscortNpc(npc);
    setLog(isEscort
      ? `${getShipDisplayName(npc)} lost from your travelling escort.`
      : `${getShipDisplayName(npc)} lost from the ${state.planets[state.currentPlanet]?.name || 'local'} defense fleet.`);
    updateStats();
    return;
  }
  const playerCredited = isPlayerKillCreditSource(npc.lastDamageSource);
  if (!playerCredited) {
    setLog(`${getShipDisplayName(npc)} destroyed.`);
    updateStats();
    return;
  }
  const reward = 18 + Math.floor(seeded(npc.seed + 99) * 35);
  state.latinum += reward;
  if (npc.faction) {
    applyKillStanding(npc.faction, npc.role === 'patrol' ? -4 : -2);
    const witnesses = new Set();
    for (const other of state.npcShips || []) {
      if (!other || other.destroyed || other === npc || isPlayerEscortNpc(other)) continue;
      if (other.role !== 'patrol') continue;
      const d = Math.hypot((other.x || 0) - (npc.x || 0), (other.y || 0) - (npc.y || 0));
      if (d <= 1600) witnesses.add(normalizeFactionKey(other.faction));
    }
    witnesses.delete(normalizeFactionKey(npc.faction));
    if (witnesses.size) {
      for (const faction of witnesses) adjustFactionStanding(faction, -2, { silent: true });
      setLog(`Kill witnessed by ${[...witnesses].map(formatFaction).join(', ')} patrol.`);
    }
    if (normalizeFactionKey(npc.faction) === 'borg') {
      if (!state.feats || typeof state.feats !== 'object') state.feats = {};
      const vexIdx = getSystemIndexByName('Vex');
      if (vexIdx >= 0 && Number(state.currentPlanet) === vexIdx && !state.feats.vexBorgDown) {
        state.feats.vexBorgKills = finiteNumber(state.feats.vexBorgKills, 0) + 1;
        if (state.feats.vexBorgKills >= 5) {
          state.feats.vexBorgDown = true;
          adjustFactionStanding('romulan', 15);
          setLog('Borg purged from the Vex system. The Romulans will now deal with you.');
        } else {
          setLog(`Borg destroyed in Vex (${Math.round(state.feats.vexBorgKills)}/5).`);
        }
      }
    }
  }
  setLog(`Destroyed ${getShipDisplayName(npc)}. Salvage recovered: ${reward} latinum.`);
  updateStats();
}

function destroyStation(station) {
  station.destroyed = true;
  station.hostile = false;
  station.attitude = 'destroyed';
  station.debris = createStationDebris(station);
  addHullExplosion(station, '#ff9c55', {
    scale: Math.max(1.2, getStationVisualProfile(station).scale * 1.4),
    radius: Math.max(120, getStationScreenRadius(station) * 1.25),
    ttl: 760,
  });
  playGameSound('explosion', { cooldownKey: `destroy:station:${station.id}`, volume: 1.12, rateJitter: 0.12 });
  state.destroyedStations[station.id] = true;
  const systemStation = state.systemStates[state.currentPlanet]?.stations?.find((entry) => entry.id === station.id);
  if (systemStation) {
    systemStation.destroyed = true;
    systemStation.hostile = false;
    systemStation.attitude = 'destroyed';
    systemStation.debris = station.debris;
  }
  if (state.combatTargetType === 'station' && state.combatTargetId === station.id) {
    state.combatTargetId = null;
    state.combatTargetType = 'ship';
  }
  if (state.dockedStationId === station.id) {
    state.docked = false;
    state.dockedStationId = null;
    closePlanetMenu();
  }
  if (!isPlayerKillCreditSource(station.lastDamageSource)) {
    // No feat check here: system feats (e.g. Bajora's defenses down) unlock only when a
    // player-credited kill (the player or a player escort) clears the last station.
    setLog(`${station.name} destroyed.`);
    updateStats();
    return;
  }
  const reward = Math.max(65, Math.round((station.maxCombatHull || 100) * 0.18));
  state.latinum += reward;
  applyKillStanding(station.faction || getSystemFaction(state.currentPlanet), -6);
  checkSystemFeatUnlocks();
  const claimStatus = getClaimSystemStatus(state.currentPlanet);
  setLog(claimStatus.canClaim
    ? `${station.name} destroyed. Salvage recovered: ${reward} latinum. Dock and claim the system.`
    : `${station.name} destroyed. Salvage recovered: ${reward} latinum.`);
  updateStats();
}

function updateProjectiles(frameScale = 1) {
  const now = performance.now();
  const player = playerWorldPosition();
  const playerCloaked = isPlayerCloaked(now);
  let collisionBodies=null,hojActorsReady=false;
  const readHojSignal=key=>{
    if(!hojActorsReady){
      hojActorMap.clear();
      hojActorMap.set(hojEmitterKey(state),state);
      for(const a of state.npcShips)hojActorMap.set(hojEmitterKey(a),a);
      for(const a of state.stations)hojActorMap.set(hojEmitterKey(a),a);
      hojActorsReady=true;
    }
    const a=hojActorMap.get(key);return a?liveJammerSignal(a):null;
  };
  for (const shot of state.projectiles) {
    if(shot.guidance==='home-on-jam'){collisionBodies ||= sensorCollisionTargets(null);updateHojProjectile(shot,frameScale,collisionBodies,readHojSignal);continue;}
    if (shot.pointAim) {
      const from={x:shot.x,y:shot.y},step=Math.min(shot.remaining,Math.hypot(shot.vx,shot.vy)*frameScale),len=Math.hypot(shot.vx,shot.vy)||1;
      const to={x:shot.x+shot.vx/len*step,y:shot.y+shot.vy/len*step};
      const hit=pointImpact(from,to,sensorCollisionTargets(shot.attack.key));
      shot.x=hit?hit.x:to.x;shot.y=hit?hit.y:to.y;shot.remaining-=step;
      if(hit){applyPointImpact(hit,shot);shot.dead=true;}else if(shot.remaining<=0||now-shot.born>shot.ttl)shot.dead=true;
      continue;
    }
    if (shot.turnRate) {
      const target = shot.targetType === 'player'
        ? (playerCloaked ? null : player)
        : shot.targetId
          ? (shot.targetType === 'station'
            ? state.stations.find((station) => station.id === shot.targetId && !station.destroyed)
            : state.npcShips.find((npc) => npc.id === shot.targetId && !npc.destroyed))
          : null;
      if (target) {
        const desired = (Math.atan2(target.x - shot.x, -(target.y - shot.y)) * 180 / Math.PI + 360) % 360;
        shot.heading = (shot.heading + clamp(angleDelta(shot.heading, desired), -shot.turnRate, shot.turnRate) * frameScale + 360) % 360;
        const radians = shot.heading * Math.PI / 180;
        shot.vx = Math.sin(radians) * shot.speed;
        shot.vy = -Math.cos(radians) * shot.speed;
      }
    }
    shot.x += shot.vx * frameScale;
    shot.y += shot.vy * frameScale;
    if (now - shot.born > shot.ttl) shot.dead = true;
    if (shot.dead) continue;

    if (shot.owner === 'player' || ((shot.owner === 'station' || shot.owner === 'npc') && shot.targetType !== 'player')) {
      const candidates = shot.targetId
        ? (shot.targetType === 'station'
          ? state.stations.filter((station) => station.id === shot.targetId && !station.destroyed)
          : state.npcShips.filter((npc) => npc.id === shot.targetId && !npc.destroyed))
        : getLivingNpcShips();
      for (const target of candidates) {
        const hitRadius = shot.hitRadius || (target.stationTypeId ? getStationScreenRadius(target) * 0.58 : getShipScreenRadius(target.shipId, target.scale || 1));
        if (Math.hypot(shot.x - target.x, shot.y - target.y) > hitRadius) continue;
        shot.dead = true;
        const impact = getWeaponImpactPoint(target, { x: shot.x, y: shot.y }, shot.targetType);
        shot.x = impact.x;
        shot.y = impact.y;
        recordSensorHit(target,shot.attack);
        damageCombatTarget(target, shot.damage, shot.creditSource || shot.owner, shot.color || '#74d6ff', impact);
        if (shot.kind === 'torpedo' || shot.kind === 'mine') {
          addWeaponEffect({
            kind: 'burst',
            x: impact.x,
            y: impact.y,
            color: shot.color || '#ffffff',
            radius: target.stationTypeId ? getStationScreenRadius(target) * 0.72 : shot.kind === 'mine' ? 72 : 54,
            ttl: 260,
          });
        }
        break;
      }
    } else if (playerCloaked && (shot.targetType === 'player' || !shot.targetId)) {
      shot.dead = true;
      addWeaponEffect({
        kind: 'cloak-ripple',
        x: player.x,
        y: player.y,
        color: '#9fb2d0',
        radius: getShipScreenRadius(state.playership, state.ship.drawScale) * 0.75,
        ttl: 220,
      });
    } else if (Math.hypot(shot.x - player.x, shot.y - player.y) <= getShipScreenRadius(state.playership, state.ship.drawScale)) {
      shot.dead = true;
      const impact = getWeaponImpactPoint(null, { x: shot.x, y: shot.y }, 'player');
      shot.x = impact.x;
      shot.y = impact.y;
      recordSensorHit(state,shot.attack);
      applyPlayerDamage(shot.damage, shot.color || '#ff7777', { impactPoint: impact });
      if (shot.kind === 'torpedo' || shot.kind === 'mine') {
        addWeaponEffect({
          kind: 'burst',
          x: impact.x,
          y: impact.y,
          color: shot.color || '#ffffff',
          radius: shot.kind === 'mine' ? 72 : 54,
          ttl: 260,
        });
      }
    }
  }
  let living=0;
  for(let i=0;i<state.projectiles.length;i++)if(!state.projectiles[i].dead)state.projectiles[living++]=state.projectiles[i];
  state.projectiles.length=living;
}

function isNpcStationTarget(npc, station) {
  if (!station || station.destroyed || station.attitude === 'destroyed') return false;
  // Own or allied installations are never targets; two unrelated independents are not "the same".
  const owner = getStationOwner(station, state.currentPlanet);
  return !sidesAligned(getNpcSideId(npc), owner);
}

function areFactionsAligned(a = 'neutral', b = 'neutral') {
  if (!a || !b || a === 'neutral' || b === 'neutral') return false;
  if (a === b) return true;
  const aRelations = getFactionRelations(a);
  const bRelations = getFactionRelations(b);
  return Boolean(aRelations.friendly?.includes(b) || bRelations.friendly?.includes(a));
}

function areFactionsOpposed(a = 'neutral', b = 'neutral') {
  if (!a || !b || a === 'neutral' || b === 'neutral') return false;
  if (a === b) return false;
  if (a === 'borg' || b === 'borg') return true;
  if (a === 'pirate' || b === 'pirate') return true;
  const aRelations = getFactionRelations(a);
  const bRelations = getFactionRelations(b);
  return Boolean(aRelations.hostile?.includes(b) || bRelations.hostile?.includes(a));
}

// Whether a ship may act as a defender in this system. Ownership and command are not changed by
// this: a visiting foreign patrol that assists stays foreign-owned and outside the player's orders.
// Whether it actually engages a given attacker is decided per attacker, relative to this ship
// (isNpcSystemAttacker), from its own relationships and observed aggression, not the local flag.
function isNpcSystemDefender(npc) {
  if (!npc || npc.destroyed) return false;
  if (isPlayerSideNpc(npc)) return true;
  const side = getNpcSideId(npc);
  if (side === 'pirate') return false;
  const defending = getDefendingSideId(state.currentPlanet);
  if (defending && sidesAligned(side, defending)) return true; // the holder's own forces and allies
  if (!isRecognizedFactionKey(side)) return false; // unrelated independents do not police other people's systems
  return npc.role === 'patrol'; // military-role visitor: MAY assist; whether it engages is relative
}

// Attacker classification relative to a defender (or, with no defender, to the side holding the
// system). Identity, relationships and observed aggression are separate inputs: own forces never
// count as attackers of themselves; allies never do; anyone else counts if it was seen attacking
// this side, is raiding the system, is at war with this side, or (for the player's side) is hostile.
// Evidence helpers. A raid counts only against the system it is actually raiding (a stale or
// unrelated attackId proves nothing here); an attack counts only where it was seen.
function isRaidingHere(entity, systemIndex = state.currentPlanet) {
  const attack = state.activeFleetAttack;
  return Boolean(entity?.attackId) && Boolean(attack) && attack.id === entity.attackId
    && Number(attack.systemIndex) === Number(systemIndex);
}
function hasRecentAggressionAgainst(entity, side, now = performance.now(), systemIndex = state.currentPlanet) {
  return Boolean(entity?.lastAggressionAt) && now - entity.lastAggressionAt < NPC_AGGRESSION_MEMORY_MS
    && Number(entity.lastAggressionSystemIndex) === Number(systemIndex)
    && sidesAligned(entity.lastAggressionTargetSide, side);
}
function hasRecentPlayerAggressionAgainst(side, now = performance.now(), systemIndex = state.currentPlanet) {
  return Boolean(state.lastPlayerAggressionAt) && now - state.lastPlayerAggressionAt < NPC_AGGRESSION_MEMORY_MS
    && Number(state.lastPlayerAggressionSystemIndex) === Number(systemIndex)
    && sidesAligned(state.lastPlayerAggressionTargetSide, side);
}
function recordPlayerAggressionAgainst(target, now = performance.now()) {
  if (!target) return;
  const side = target.stationTypeId
    ? getStationOwner(target, state.currentPlanet)
    : getNpcSideId(target);
  if (!side) return;
  state.lastPlayerAggressionAt = now;
  state.lastPlayerAggressionSystemIndex = Number(state.currentPlanet);
  state.lastPlayerAggressionTargetSide = side;
}
function resolveDefenderSide(defender) {
  if (typeof defender === 'string') return defender;
  if (!defender) return getDefendingSideId(state.currentPlanet);
  return defender.stationTypeId ? getStationOwner(defender, state.currentPlanet) : getNpcSideId(defender);
}
// Attacker classification relative to a defender (a ship, a station via its owner, a side ID, or
// with no defender the side holding the system). Identity, relationships, observed aggression and
// the player's rules of engagement are separate inputs: own forces are never attackers of
// themselves; a witnessed attack on this side, here, always counts (alliances do not excuse it);
// otherwise allies never count; a fleet raiding this system counts against its holder; and, for
// the player's side only under `defend`, ships hostile to the player or at war with the player's
// flag count on sight. Under `return-fire` nothing counts without evidence.
function isNpcSystemAttacker(npc, defender = null, now = performance.now()) {
  if (!npc || npc.destroyed) return false;
  const attackerSide = getNpcSideId(npc);
  const defenderSide = resolveDefenderSide(defender);
  if (!defenderSide) return false;
  if (sameSide(attackerSide, defenderSide)) return false;
  if (hasRecentAggressionAgainst(npc, defenderSide, now)) return true;
  if (sidesAligned(attackerSide, defenderSide)) return false;
  const systemSide = getDefendingSideId(state.currentPlanet);
  if (isRaidingHere(npc) && systemSide && sidesAligned(systemSide, defenderSide)) return true;
  if (defenderSide !== PLAYER_SIDE) return sidesOpposed(attackerSide, defenderSide);
  if (getPlayerRoeAt(state.currentPlanet) !== 'defend') return false;
  const hostileToPlayer = Boolean(npc.hostile) || npc.attitude === 'hostile'
    || (Boolean(npc.playerAggroUntil) && npc.playerAggroUntil > now);
  return hostileToPlayer || sidesOpposed(attackerSide, getPlayerFlag());
}

function getNpcDefenseTarget(defender) {
  if (!isNpcSystemDefender(defender)) return null;
  return getLivingNpcShips()
    .filter((target) => target !== defender && sensorCanTrack(defender,target) && isNpcSystemAttacker(target, defender))
    .map((target) => ({ target, distance: sensorDistance(defender,sensorKnownPosition(defender,target)) }))
    .filter((entry) => entry.distance <= NPC_SYSTEM_DEFENSE_RANGE)
    .sort((a, b) => {
      if (a.target.playerAggroUntil !== b.target.playerAggroUntil) return b.target.playerAggroUntil ? 1 : -1;
      return a.distance - b.distance;
    })[0]?.target || null;
}

function getNpcStationTarget(npc) {
  return getLivingStations()
    .filter((station) => sensorCanTrack(npc,station) && isNpcStationTarget(npc, station))
    .map((station) => ({ station, distance: sensorDistance(npc,sensorKnownPosition(npc,station)) }))
    .sort((a, b) => {
      const aFriendly = a.station.faction === state.playerFaction ? 0 : 1;
      const bFriendly = b.station.faction === state.playerFaction ? 0 : 1;
      if (aFriendly !== bFriendly) return aFriendly - bFriendly;
      return a.distance - b.distance;
    })[0] || null;
}

function isPlayerEscortNpc(npc) {
  return npc?.role === 'playerEscort' && npc.fleetId;
}

function isPlayerEscortShipTarget(npc, now = performance.now()) {
  if (!npc || npc.destroyed || isPlayerSideNpc(npc)) return false;
  if (npc.playerEscortOrderUntil && npc.playerEscortOrderUntil > now) return true; // explicit orders override ROE
  // Evidence always suffices: attacks on the player's side seen here, or a raid on this holding.
  if (isNpcSystemAttacker(npc, PLAYER_SIDE, now)) return true;
  // Under `defend` (the default) escorts also engage on sight what the system's holder would engage;
  // under `return-fire` nothing more without evidence. No same-flag or same-status immunity either way.
  return getPlayerRoeAt(state.currentPlanet) === 'defend' && isNpcSystemAttacker(npc, null, now);
}

function isPlayerEscortStationTarget(station, now = performance.now()) {
  if (!station || station.destroyed) return false;
  // The player's own installations are never targets, not even under explicit orders.
  if (getStationOwner(station, state.currentPlanet) === PLAYER_SIDE) return false;
  if (station.playerEscortOrderUntil && station.playerEscortOrderUntil > now) return true; // explicit orders override ROE
  // A station that fired on the player's side here is a target under any ROE.
  if (hasRecentAggressionAgainst(station, PLAYER_SIDE, now)) return true;
  // Under `defend`, a hostile station is a target whatever flag it flies; under `return-fire` it is
  // not until it shoots. No alliance immunity either way.
  return getPlayerRoeAt(state.currentPlanet) === 'defend' && (Boolean(station.hostile) || station.attitude === 'hostile');
}

function getPlayerEscortPriorityTarget(escort, now = performance.now()) {
  if (state.combatTargetId) {
    const activeTarget = state.combatTargetType === 'station'
      ? state.stations.find((station) => station.id === state.combatTargetId && isPlayerEscortStationTarget(station, now))
      : state.npcShips.find((npc) => npc.id === state.combatTargetId && isPlayerEscortShipTarget(npc, now));
    if (activeTarget && sensorCanTrack(escort,activeTarget)) {
      return {
        target: activeTarget,
        type: state.combatTargetType === 'station' ? 'station' : 'ship',
        distance: sensorDistance(escort,sensorKnownPosition(escort,activeTarget)),
      };
    }
  }

  // An explicit order wins over opportunistic defense targets, including another station's recent fire.
  const ordered=[...getLivingNpcShips(),...getLivingStations()].filter(target=>target!==escort
    && target.playerEscortOrderUntil>now && sensorCanTrack(escort,target)
    && (target.stationTypeId?isPlayerEscortStationTarget(target,now):isPlayerEscortShipTarget(target,now)))
    .sort((a,b)=>b.playerEscortOrderUntil-a.playerEscortOrderUntil)[0];
  if(ordered)return {target:ordered,type:ordered.stationTypeId?'station':'ship',distance:sensorDistance(escort,sensorKnownPosition(escort,ordered))};
  const stance = isAuxSeeker(escort) ? 'seek' : getFleetStance();
  if (stance === 'follow') return null;
  const player = playerWorldPosition();
  const shipTarget = getLivingNpcShips()
    .filter((npc) => npc !== escort && sensorCanTrack(escort,npc) && isPlayerEscortShipTarget(npc, now))
    .map((npc) => ({
      target: npc,
      type: 'ship',
      distance: sensorDistance(escort,sensorKnownPosition(escort,npc)),
      playerDistance: Math.hypot(npc.x - player.x, npc.y - player.y),
    }))
    .filter((entry) => entry.playerDistance <= (stance === 'seek' ? Infinity : PLAYER_ESCORT_DEFENSE_RANGE) || entry.distance <= NPC_WEAPON_RANGE * 1.15)
    .sort((a, b) => {
      if (a.target.attackId !== b.target.attackId) return a.target.attackId ? -1 : 1;
      return a.playerDistance - b.playerDistance;
    })[0];
  if (shipTarget) return shipTarget;

  return getLivingStations()
    .filter((station) => sensorCanTrack(escort,station) && isPlayerEscortStationTarget(station, now))
    .map((station) => ({
      target: station,
      type: 'station',
      distance: sensorDistance(escort,sensorKnownPosition(escort,station)),
      playerDistance: Math.hypot(station.x - player.x, station.y - player.y),
    }))
    .filter((entry) => entry.playerDistance <= (stance === 'seek' ? Infinity : PLAYER_ESCORT_DEFENSE_RANGE * 1.25) || entry.distance <= NPC_WEAPON_RANGE * 1.2)
    .sort((a, b) => a.playerDistance - b.playerDistance)[0] || null;
}

function shouldNpcTargetPlayer(npc, playerDistance, stationTarget, now = performance.now()) {
  if (!sensorCanTrack(npc,state)) return false;
  if (isPlayerCloaked(now)) return false;
  if (isSpawnProtected(now)) return false;
  if (getFactionStanding(npc.faction) <= -50) return true;
  if (normalizeFactionKey(npc.faction) === 'pirate' && (state.shields < 35 || state.hull < 50)) {
    return playerDistance <= NPC_WEAPON_RANGE * 1.5;
  }
  if (npc.playerAggroUntil && npc.playerAggroUntil > now) return playerDistance <= NPC_WEAPON_RANGE * 1.25;
  if (!stationTarget) return playerDistance <= NPC_WEAPON_RANGE;
  if (playerDistance <= NPC_PLAYER_INTERVENTION_RANGE * 0.58) return true;
  return now - (state.lastPlayerShotAt || 0) < NPC_PLAYER_AGGRO_MS
    && playerDistance <= NPC_PLAYER_INTERVENTION_RANGE;
}

function getNpcCombatStandoff(npc, targetType = 'player') {
  const shipClass = getShipVisualClass(npc.shipId);
  const classRadius = {
    shuttle: 185,
    escort: 225,
    lightCruiser: 280,
    cruiser: 320,
    capital: 360,
    battleship: 440,
  }[shipClass] || 240;
  const targetBonus = targetType === 'station' ? 70 : 0;
  const seedOffset = seeded(npc.seed + 501) * 52 - 18;
  return clamp(classRadius + targetBonus + seedOffset, NPC_COMBAT_MIN_STANDOFF, NPC_COMBAT_MAX_STANDOFF);
}

function getNpcCombatManeuverPoint(npc, target, targetType = 'player', now = performance.now()) {
  const targetKey = targetType === 'player' ? 'player' : `${targetType}:${target.id || target.name || 'target'}`;
  const distance = Math.max(1, Math.hypot(target.x - npc.x, target.y - npc.y));
  const desiredRadius = getNpcCombatStandoff(npc, targetType);
  const currentAngle = Math.atan2(npc.y - target.y, npc.x - target.x);
  const existing = npc.combatManeuver;
  if (!existing || existing.targetKey !== targetKey || now >= existing.until) {
    const maneuverSeed = npc.seed + Math.floor(now / 397) + (npc.leg || 0) * 43;
    npc.combatManeuver = {
      targetKey,
      angle: currentAngle + (seeded(maneuverSeed + 1) - 0.5) * 1.9,
      direction: seeded(maneuverSeed + 2) > 0.5 ? 1 : -1,
      radius: desiredRadius * (0.86 + seeded(maneuverSeed + 3) * 0.34),
      orbitRate: 0.00028 + seeded(maneuverSeed + 4) * 0.00036,
      until: now + NPC_COMBAT_MANEUVER_MIN_MS + seeded(maneuverSeed + 5) * (NPC_COMBAT_MANEUVER_MAX_MS - NPC_COMBAT_MANEUVER_MIN_MS),
    };
  }

  const maneuver = npc.combatManeuver;
  let angle = maneuver.angle + (now * maneuver.orbitRate * maneuver.direction);
  let radius = maneuver.radius;
  if (distance < desiredRadius * 0.62) {
    angle = currentAngle;
    radius = desiredRadius * 1.22;
  } else if (distance > NPC_WEAPON_RANGE * 0.96) {
    angle = currentAngle;
    radius = desiredRadius * 0.76;
  }

  return {
    x: target.x + Math.cos(angle) * radius,
    y: target.y + Math.sin(angle) * radius,
  };
}

function scheduleNextFleetAttack(now = performance.now()) {
  state.nextFleetAttackAt = now + FLEET_ATTACK_MIN_INTERVAL_MS
    + seeded(now * 0.017 + state.currentPlanet * 31) * (FLEET_ATTACK_MAX_INTERVAL_MS - FLEET_ATTACK_MIN_INTERVAL_MS);
}

function chooseFleetAttackFaction(systemIndex = state.currentPlanet) {
  const localFaction = getSystemFaction(systemIndex);
  const candidates = Object.keys(factionNames).filter((faction) => (
    faction !== 'neutral'
    && faction !== 'pirate'
    && faction !== 'borg'
    && faction !== localFaction
    && faction !== state.playerFaction
    && (areFactionsOpposed(faction, localFaction) || areFactionsOpposed(faction, state.playerFaction))
  ));
  if (candidates.length) {
    return candidates[Math.floor(seeded(performance.now() * 0.011 + systemIndex * 97) * candidates.length) % candidates.length];
  }
  return localFaction === 'pirate' ? 'terran' : 'pirate';
}

function getFleetRaidSize(systemIndex = state.currentPlanet) {
  const defenders = getPlayerFleetShips(systemIndex).length;
  const stations = state.stations.filter((station) => !station.destroyed && (station.faction === state.playerFaction || station.faction === state.systemFaction)).length;
  return clamp(2 + Math.ceil((defenders + stations) * 0.55), 3, 7);
}

function fleetAttackHerald(faction, systemIndex) {
  const system = state.planets[systemIndex]?.name || 'this system';
  const key = normalizeFactionKey(faction);
  if (key === 'klingon') return `Klingon battle group inbound on ${system} - Qa'pla!`;
  if (key === 'romulan') return `Romulan warbirds decloak on the ${system} frontier.`;
  if (key === 'cardassian') return `Cardassian Order fleet moving on ${system}.`;
  if (key === 'borg') return `Borg cube detected approaching ${system}. Resistance is futile.`;
  if (key === 'dominion') return `Dominion attack wing entering ${system}.`;
  if (key === 'tholian') return `Tholian web spars detected around ${system}.`;
  if (key === 'breen') return `Breen raiders running silent toward ${system}.`;
  if (key === 'ferengi') return `Ferengi privateers sniffing profit near ${system}.`;
  return `${formatFaction(key)} raiders inbound on ${system}.`;
}
function spawnFleetAttack(systemIndex = state.currentPlanet, attackerFaction = chooseFleetAttackFaction(systemIndex)) {
  if (state.activeFleetAttack || state.gameOver || !state.gameStarted || state.warp.active) return false;
  const localFaction = getSystemFaction(systemIndex);
  if (localFaction === 'neutral' && !state.controlledSystems.includes(Number(systemIndex))) return false;
  setLog(fleetAttackHerald(attackerFaction, systemIndex));
  const attackId = `raid-${systemIndex}-${Date.now().toString(36)}`;
  const size = getFleetRaidSize(systemIndex);
  const baseSeed = hashString(attackId);
  const originAngle = seeded(baseSeed + 13) * Math.PI * 2;
  const originDistance = 1150 + seeded(baseSeed + 17) * 420;
  const origin = {
    x: state.systemStar.x + Math.cos(originAngle) * originDistance,
    y: state.systemStar.y + Math.sin(originAngle) * originDistance,
  };
  const primaryTarget = state.stations.find((station) => !station.destroyed && station.faction !== attackerFaction)
    || state.systemPlanet;
  const ships = Array.from({ length: size }, (_, index) => {
    const seed = hashString(`${attackId}-${index}`);
    const spread = (index - (size - 1) / 2) * 56;
    const sideAngle = originAngle + Math.PI / 2;
    const shipId = getNpcShipIdForFaction(attackerFaction, seed + 41, 'fleetAttack');
    if (shipId == null) return null;
    return createNpcShip({
      id: `${attackId}-${index}`,
      shipId,
      faction: attackerFaction,
      attitude: 'hostile',
      hostile: true,
      seed,
      from: {
        x: origin.x + Math.cos(sideAngle) * spread,
        y: origin.y + Math.sin(sideAngle) * spread,
      },
      destination: {
        x: primaryTarget.x + (seeded(seed + 3) - 0.5) * 240,
        y: primaryTarget.y + (seeded(seed + 4) - 0.5) * 240,
      },
      destinationName: `raid: ${primaryTarget.name || 'system defense'}`,
      role: 'fleetAttack',
      attackId,
    });
  }).filter(Boolean);
  if (!ships.length) return false;
  state.npcShips.push(...ships);
  state.activeFleetAttack = {
    id: attackId,
    systemIndex,
    faction: attackerFaction,
    startedAt: performance.now(),
    size,
  };
  state.fleetAttackControlSince = 0;
  setLog(`${formatFaction(attackerFaction)} attack fleet entering ${state.planets[systemIndex]?.name || 'this system'}: ${size} ships inbound.`);
  return true;
}

function getFleetAttackDefenders(attackFaction = state.activeFleetAttack?.faction, attackers = [], now = performance.now()) {
  const control = getSystemControl(state.currentPlanet);
  const localFaction = control.allegiance || 'neutral';
  const defendingSide = getDefendingSideId(state.currentPlanet);
  const playerOwnsStationHere = state.stations.some((station) => !station.destroyed && getStationOwner(station, state.currentPlanet) === PLAYER_SIDE);
  // Only the attacker's own side is excluded outright. An ally of the attacker is excluded by the
  // relative rule unless the attackers were seen firing on it (isNpcSystemAttacker), so accounting
  // agrees with what the ships and turrets actually do.
  const opposesFleet = (defender) => attackers.length === 0 || attackers.some((attacker) => isNpcSystemAttacker(attacker, defender, now));
  const stationDefenders = state.stations.filter((station) => {
    if (station.destroyed) return false;
    const owner = getStationOwner(station, state.currentPlanet);
    if (!owner || sameSide(owner, attackFaction)) return false;
    if (attackers.length > 0) return opposesFleet(station); // a station counts iff its turrets would engage these attackers
    return !sidesAligned(owner, attackFaction)
      && (sidesAligned(owner, defendingSide) || (owner === PLAYER_SIDE && (control.playerControlled || playerOwnsStationHere)));
  });
  // "May assist" is not "is defending against this attack": a ship counts only if it has a reason
  // to oppose at least one of these attackers (relative classification), so a peaceful foreign
  // patrol cannot hold a system against a fleet it has no quarrel with.
  const shipDefenders = state.npcShips.filter((npc) => (
    !npc.destroyed
    && !sameSide(getNpcSideId(npc), attackFaction) // the raider's own side never defends against itself
    && (attackers.length > 0 || !sidesAligned(getNpcSideId(npc), attackFaction))
    && isNpcSystemDefender(npc)
    && Boolean(getDefaultWeaponId(npc.shipId, npc.faction, true))
    && opposesFleet(npc)
  ));
  // The player counts as defending its own holdings, or a recognized ally's world; independence
  // is a status, so an independent player is not automatically defending an independent world.
  const playerDefending = control.playerControlled
    || playerOwnsStationHere
    || areFactionsAligned(state.playerFaction, localFaction);
  const playerEngaged = attackers.some((npc) => distanceToPlayer(npc) <= NPC_PLAYER_INTERVENTION_RANGE * 1.8)
    || now - (state.lastPlayerShotAt || 0) < NPC_PLAYER_AGGRO_MS;
  return {
    stations: stationDefenders,
    ships: shipDefenders,
    player: playerDefending && playerEngaged && state.hull > 0,
  };
}

function updateFleetAttacks(now = performance.now()) {
  if (!state.nextFleetAttackAt) scheduleNextFleetAttack(now + 20000);
  if (!state.activeFleetAttack && now >= state.nextFleetAttackAt) {
    spawnFleetAttack(state.currentPlanet);
    scheduleNextFleetAttack(now);
  }
  const attack = state.activeFleetAttack;
  if (!attack || Number(attack.systemIndex) !== Number(state.currentPlanet)) return;
  const attackers = state.npcShips.filter((npc) => !npc.destroyed && npc.attackId === attack.id);
  if (!attackers.length) {
    setLog(`${formatFaction(attack.faction)} fleet attack repelled.`);
    state.activeFleetAttack = null;
    state.fleetAttackControlSince = 0;
    scheduleNextFleetAttack(now);
    return;
  }
  const defenders = getFleetAttackDefenders(attack.faction, attackers, now);
  if (defenders.stations.length || defenders.ships.length || defenders.player) {
    state.fleetAttackControlSince = 0;
    return;
  }
  if (!state.fleetAttackControlSince) {
    state.fleetAttackControlSince = now;
    setLog(`${formatFaction(attack.faction)} fleet has broken local defenses. Retake the field before they seize control.`);
    return;
  }
  if (now - state.fleetAttackControlSince < FLEET_ATTACK_CONTROL_DELAY_MS) return;
  transferSystemControlToFaction(state.currentPlanet, attack.faction);
  state.systemFaction = attack.faction;
  state.systemAttitude = getFactionAttitude(attack.faction);
  for (const npc of attackers) {
    npc.hostile = getFactionAttitude(npc.faction) === 'hostile';
    npc.attitude = getFactionAttitude(npc.faction);
    npc.role = 'occupationFleet';
    npc.attackId = null;
  }
  state.activeFleetAttack = null;
  state.fleetAttackControlSince = 0;
  setLog(`${formatFaction(attack.faction)} fleet has seized ${state.planets[state.currentPlanet]?.name || 'the system'}.`);
  updateStats();
}

function scheduleAmbientTrafficWarp(npc, now = performance.now()) {
  const seed = finiteNumber(npc.seed, 1) + finiteNumber(npc.leg, 0) * 73 + Math.floor(now / 1000) * 17;
  npc.ambientWarpAt = now + AMBIENT_TRAFFIC_WARP_NEXT_MIN_MS
    + seeded(seed) * (AMBIENT_TRAFFIC_WARP_NEXT_MAX_MS - AMBIENT_TRAFFIC_WARP_NEXT_MIN_MS);
}

function isAmbientTrafficWarpEligible(npc, now = performance.now()) {
  if (!npc || npc.destroyed || npc.trafficWarp) return false;
  if (npc.role !== 'traffic' && npc.role !== 'localTraffic') return false;
  if (npc.securityObjective) return false; // executing a checkpoint instruction: no ambient departure until it ends
  if (npc.hostile || npc.attackId || npc.fleetId || state.combatTargetId === npc.id) return false;
  if ((npc.playerAggroUntil && npc.playerAggroUntil > now) || (npc.playerEscortOrderUntil && npc.playerEscortOrderUntil > now)) return false;
  if (isNpcTractorHeld(npc, now) || isNpcEngineDisabled(npc, now)) return false;
  return !getNpcDefenseTarget(npc);
}

function chooseAmbientTrafficShipId(npc, seed) {
  const localFaction = state.systemFaction || getSystemFaction(state.currentPlanet);
  const localTraffic = npc.role === 'localTraffic' && localFaction !== 'neutral';
  let candidate = npc.shipId;
  for (let attempt = 0; attempt < 6; attempt += 1) {
    const trialSeed = seed + attempt * 43;
    candidate = localTraffic
      ? getNpcShipIdForFaction(localFaction, trialSeed, npc.role || 'localTraffic')
      : getNpcShipId(trialSeed, npc.role || 'traffic');
    if (candidate == null) return null;
    if (candidate !== npc.shipId) break;
  }
  return candidate;
}

function syncAmbientTrafficVariant(npc) {
  const systemShip = state.systemStates[state.currentPlanet]?.npcShips?.find((ship) => ship.id === npc.id);
  if (!systemShip) return;
  systemShip.shipId = npc.shipId;
  systemShip.seed = npc.seed;
  systemShip.name = npc.name;
  systemShip.faction = npc.faction;
  systemShip.sideId = npc.sideId;
  systemShip.identityLocked = true;
  systemShip.securityInstanceId = npc.securityInstanceId || null;
  Object.assign(systemShip, snapshotActorSensors(npc));
  systemShip.power = powerSnapshot(ensureNpcPower(npc));
  systemShip.crewSkill = npc.crewSkill;
  systemShip.crewTemperament = npc.crewTemperament;
}

function beginAmbientTrafficArrival(npc, now = performance.now()) {
  const replacementSeed = hashString(`${npc.id}:${npc.seed}:${Math.floor(now)}`);
  const shipId = chooseAmbientTrafficShipId(npc, replacementSeed);
  if (shipId == null) {
    scheduleAmbientTrafficWarp(npc, now);
    return;
  }
  npc.ew = null; npc.sensors = null; npc.sensorReports = []; npc.sensorLastFireAt = null; npc.sensorNextDecision = null; npc.sensorPursuitKey = null; npc.broadcastSource = null; npc.broadcastFaction = null;
  const faction = getShipFaction(shipId);
  const attitude = getFactionAttitude(faction);
  const destination = pickTrafficDestination(state.trafficDestinations, replacementSeed + 19, npc.destinationName);
  const approachAngle = seeded(replacementSeed + 23) * Math.PI * 2;
  const approachDistance = 680 + seeded(replacementSeed + 29) * 360;
  const x = destination.point.x + Math.cos(approachAngle) * approachDistance;
  const y = destination.point.y + Math.sin(approachAngle) * approachDistance;
  const heading = (Math.atan2(destination.point.x - x, -(destination.point.y - y)) * 180 / Math.PI + 360) % 360;
  const flight = getNpcFlightProfile(shipId, replacementSeed);

  Object.assign(npc, {
    x,
    y,
    destination: { ...destination.point },
    destinationName: destination.name,
    heading,
    speed: flight.speed,
    turnRate: flight.turnRate,
    systemWarpMultiplier: flight.systemWarpMultiplier,
    systemWarpIntensity: 1,
    seed: replacementSeed,
    leg: 0,
    shipId,
    scale: getNpcSpriteScale(shipId, replacementSeed + 11),
    faction,
    sideId: deriveNpcSideId(faction, npc.id),
    attitude,
    hostile: state.systemAttitude === 'hostile' && attitude !== 'friendly',
    name: generateShipName({ shipId, faction, seed: replacementSeed, role: npc.role, id: npc.id }),
    combatHull: null,
    maxCombatHull: null,
    combatShields: null,
    maxCombatShields: null,
    lastShieldHitAt: 0,
    lastShotAt: now + 700 + seeded(replacementSeed + 13) * 1500,
    waitUntil: 0,
    trafficWarp: {
      phase: 'arriving',
      startedAt: now,
      endsAt: now + AMBIENT_TRAFFIC_WARP_IN_MS,
    },
    power: null, crewSkill: null, crewTemperament: null,
    // A replacement is a different vessel. Nothing the previous occupant of this slot did or had
    // done to it carries over: no attack evidence, no aggro, no standing escort order, no raid
    // membership, no open hail, no damage record.
    lastAggressionAt: 0,
    lastAggressionTargetSide: null,
    lastAggressionSystemIndex: null,
    playerAggroUntil: 0,
    playerEscortOrderUntil: 0,
    attackId: null,
    hailSession: null,
    lastDamageSource: null,
    combatManeuver: null,
    securityInstanceId: nextSecurityInstanceId(), // a different vessel, so a different visitor
    securityObjective: null,
  });
  npc.ew=rollEW({seed:npc.seed,role:npc.role,faction:npc.faction,major:isRecognizedFactionKey(npc.faction),command:!!npc.fleetId});
  syncAmbientTrafficVariant(npc);
}

function startAmbientTrafficDeparture(npc, now = performance.now()) {
  const seed = hashString(`${npc.id}:${npc.seed}:${npc.leg}:${Math.floor(now)}`);
  const awayMs = AMBIENT_TRAFFIC_WARP_AWAY_MIN_MS
    + seeded(seed + 17) * (AMBIENT_TRAFFIC_WARP_AWAY_MAX_MS - AMBIENT_TRAFFIC_WARP_AWAY_MIN_MS);
  npc.trafficWarp = {
    phase: 'departing',
    startedAt: now,
    endsAt: now + AMBIENT_TRAFFIC_WARP_OUT_MS,
    returnAt: now + AMBIENT_TRAFFIC_WARP_OUT_MS + awayMs,
    heading: seeded(seed + 29) * 360,
  };
  npc.heading = npc.trafficWarp.heading;
  npc.systemWarpIntensity = 1;
  npc.waitUntil = 0;
  state.trafficWarpCooldownUntil = npc.trafficWarp.returnAt + AMBIENT_TRAFFIC_WARP_IN_MS + 1800;
}

function updateAmbientTrafficWarp(npc, now = performance.now(), frameScale = 1) {
  const warp = npc.trafficWarp;
  if (warp?.phase === 'departing') {
    const progress = clamp((now - warp.startedAt) / Math.max(1, warp.endsAt - warp.startedAt), 0, 1);
    const radians = warp.heading * Math.PI / 180;
    npc.heading = warp.heading;
    npc.systemWarpIntensity = 1;
    const speed = npc.speed * powerEngineFactor(ensureNpcPower(npc).dist) * npc.power.engineSupply * (5 + progress * 5);
    npc.x += Math.sin(radians) * speed * frameScale;
    npc.y -= Math.cos(radians) * speed * frameScale;
    if (now >= warp.endsAt) {
      npc.systemWarpIntensity = 0;
      npc.trafficWarp = { phase: 'away', returnAt: warp.returnAt };
    }
    return true;
  }

  if (warp?.phase === 'away') {
    if (now >= warp.returnAt) beginAmbientTrafficArrival(npc, now);
    return true;
  }

  if (warp?.phase === 'arriving') {
    const progress = clamp((now - warp.startedAt) / Math.max(1, warp.endsAt - warp.startedAt), 0, 1);
    const dx = npc.destination.x - npc.x;
    const dy = npc.destination.y - npc.y;
    const distance = Math.max(1, Math.hypot(dx, dy));
    npc.heading = (Math.atan2(dx, -dy) * 180 / Math.PI + 360) % 360;
    npc.systemWarpIntensity = Math.max(0.2, 1 - progress * 0.8);
    const radians = npc.heading * Math.PI / 180;
    const speed = npc.speed * powerEngineFactor(ensureNpcPower(npc).dist) * npc.power.engineSupply * (3.8 - progress * 1.8);
    npc.x += Math.sin(radians) * speed * frameScale;
    npc.y -= Math.cos(radians) * speed * frameScale;
    if (now >= warp.endsAt || distance < 36) {
      npc.trafficWarp = null;
      npc.systemWarpIntensity = 0;
      scheduleAmbientTrafficWarp(npc, now);
    }
    return true;
  }

  if (!npc.ambientWarpAt) scheduleAmbientTrafficWarp(npc, now);
  if (now < npc.ambientWarpAt || now < finiteNumber(state.trafficWarpCooldownUntil, 0)) return false;
  if (!isAmbientTrafficWarpEligible(npc, now)) {
    npc.ambientWarpAt = now + 4000 + seeded(npc.seed + Math.floor(now / 1000)) * 5000;
    return false;
  }
  startAmbientTrafficDeparture(npc, now);
  return true;
}

function updateNpcShips(frameScale = 1) {
  const now = performance.now();
  const playerCloaked = isPlayerCloaked(now);
  for (const npc of state.npcShips) {
    if (npc.destroyed) continue;
    if (updateAmbientTrafficWarp(npc, now, frameScale)) continue;
    ensureNpcCombatStats(npc);
    if (isNpcTractorHeld(npc, now)) {
      npc.systemWarpIntensity = 0;
      npc.waitUntil = now + 140;
      npc.destination = { x: npc.x, y: npc.y };
      continue;
    }
    if (isNpcEngineDisabled(npc, now)) {
      const disableMs = Math.max(1, finiteNumber(getEngineDisruptorItemSettings().disableMs, ENGINE_DISRUPTOR_DISABLE_MS));
      const remaining = clamp((finiteNumber(npc.engineDisabledUntil, now) - now) / disableMs, 0, 1);
      const driftScale = 0.22 + remaining * 0.78;
      npc.systemWarpIntensity = 0;
      npc.waitUntil = now + 140;
      npc.destination = { x: npc.x, y: npc.y };
      npc.x += finiteNumber(npc.engineDriftX, 0) * driftScale * frameScale;
      npc.y += finiteNumber(npc.engineDriftY, 0) * driftScale * frameScale;
      npc.heading = (finiteNumber(npc.heading, 0) + Math.sin(now * 0.0014 + finiteNumber(npc.seed, 1)) * 0.08 * frameScale + 360) % 360;
      continue;
    }
    // An administrative objective (checkpoint hold or withdrawal) owns the destination while it lasts.
    // Combat below still overrides the destination this frame; the encounter update then ends the
    // objective as interrupted. A holding ship does not move at all.
    if (npc.securityObjective && updateNpcSecurityObjective(npc, now)) continue;
    const playerDistance = distanceToPlayer(npc);
    const cue = getCounterfireCue(npc);
    if (cue) fireCounterfirePoint(npc,cue,getWeapon(getDefaultWeaponId(npc.shipId,npc.faction,true)),now);
    const stationTarget = npc.hostile ? getNpcStationTarget(npc) : null;
    const targetPlayer = npc.hostile && shouldNpcTargetPlayer(npc, playerDistance, stationTarget, now);
    const defenseTarget = getNpcDefenseTarget(npc);
    const escortTarget = isPlayerEscortNpc(npc) ? getPlayerEscortPriorityTarget(npc, now) : null;
    ensureNpcPower(npc).combat = Boolean(escortTarget || defenseTarget || targetPlayer || stationTarget);
    let combatActive = false;
    if (escortTarget) {
      const target = escortTarget.target;
      const known=sensorPursuitPoint(npc,target,escortTarget.type);
      const targetDistance = sensorDistance(npc,known);
      npc.sensorPursuitKey=sensorKey(target);
      const escortWeaponRange = getNpcWeaponRange(npc);
      npc.destination = getNpcCombatManeuverPoint(npc, known, escortTarget.type, now);
      npc.destinationName = `escort: ${getTargetName(target)}`;
      combatActive = true;
      if (targetDistance <= escortWeaponRange) {
        fireNpcWeapon(npc, target, escortTarget.type, now);
      }
    } else if (isPlayerEscortNpc(npc)) {
      npc.destination = getPlayerEscortFormationPoint(npc.escortIndex || 0, now);
      npc.destinationName = 'player escort';
    } else if (defenseTarget) {
      const known=sensorPursuitPoint(npc,defenseTarget);
      const targetDistance = sensorDistance(npc,known);
      npc.sensorPursuitKey=sensorKey(defenseTarget);
      const weaponRange = getNpcWeaponRange(npc);
      npc.destination = getNpcCombatManeuverPoint(npc, known, 'ship', now);
      npc.destinationName = `defend: ${getShipStats(defenseTarget.shipId).name}`;
      combatActive = true;
      if (targetDistance <= weaponRange) {
        fireNpcWeapon(npc, defenseTarget, 'ship', now);
      }
    } else if (targetPlayer && !playerCloaked) {
      const player = sensorPursuitPoint(npc,state,'player');
      npc.sensorPursuitKey='player';
      const weaponRange = getNpcWeaponRange(npc);
      npc.destination = getNpcCombatManeuverPoint(npc, player, 'player', now);
      npc.destinationName = 'player';
      combatActive = true;
      if (playerDistance <= weaponRange) {
        fireNpcWeapon(npc, player, 'player', now);
      }
    } else if (npc.hostile && stationTarget) {
      const weaponRange = getNpcWeaponRange(npc);
      npc.sensorPursuitKey=sensorKey(stationTarget.station);
      npc.destination = getNpcCombatManeuverPoint(npc, sensorPursuitPoint(npc,stationTarget.station), 'station', now);
      npc.destinationName = stationTarget.station.name || 'station target';
      combatActive = true;
      if (stationTarget.distance <= weaponRange) {
        fireNpcWeapon(npc, stationTarget.station, 'station', now);
      }
    }
    if (!combatActive && npc.sensorPursuitKey) {
      const last=sensorWorld.map(sensorKey(npc)).get(npc.sensorPursuitKey);
      const explicitEscortOrder=isPlayerEscortNpc(npc)&&getFleetStance()!=='follow';
      if(last?.position&&sensorClock-last.observedAt<10&&(!isPlayerEscortNpc(npc)||explicitEscortOrder)){
        npc.destination={...last.position};npc.destinationName='search last contact';
      }else{
        npc.sensorPursuitKey=null;
        if(!isPlayerEscortNpc(npc)){const next=pickTrafficDestination(state.trafficDestinations,npc.seed+npc.leg*17+47,npc.destinationName);npc.destination={...next.point};npc.destinationName=next.name;}
      }
    }
    if (npc.waitUntil && now < npc.waitUntil) continue;
    const dx = npc.destination.x - npc.x;
    const dy = npc.destination.y - npc.y;
    const distance = Math.hypot(dx, dy);
    if (distance < 34) {
      if (combatActive) {
        if (npc.combatManeuver) npc.combatManeuver.until = 0;
        continue;
      }
      if (npc.securityObjective) { npc.waitUntil = now + 200; continue; } // the objective, not the lane picker, decides what comes next
      const next = pickTrafficDestination(state.trafficDestinations, npc.seed + npc.leg * 17 + 31, npc.destinationName);
      npc.destination = { ...next.point };
      npc.destinationName = next.name;
      npc.waitUntil = now + 450 + seeded(npc.seed + npc.leg * 23) * 1300;
      npc.leg += 1;
      continue;
    }
    const targetHeading = (Math.atan2(dx, -dy) * 180 / Math.PI + 360) % 360;
    const warpTarget = !combatActive && distance > 760 ? clamp((distance - 760) / 1350, 0, 1) : 0;
    npc.systemWarpIntensity = approachValue(clamp(finiteNumber(npc.systemWarpIntensity, 0), 0, 1), warpTarget, (warpTarget ? 0.018 : 0.035) * frameScale);
    const warpEase = npc.systemWarpIntensity * npc.systemWarpIntensity * (3 - 2 * npc.systemWarpIntensity);
    const warpTurnPenalty = 1 - warpEase * 0.58;
    const turnLimit = Math.max(0.12, npc.turnRate * warpTurnPenalty);
    const correction = clamp(angleDelta(npc.heading, targetHeading) * 0.045, -turnLimit, turnLimit);
    const drift = Math.sin((now / 1000) * 0.8 + npc.seed) * turnLimit * 0.14;
    npc.heading = (npc.heading + (correction + drift) * frameScale + 360) % 360;
    const radians = npc.heading * Math.PI / 180;
    const combatSpeed = combatActive ? clamp(distance / 220, 0.72, 1.58) : 1;
    const cruiseWarp = 1 + (Math.max(1, finiteNumber(npc.systemWarpMultiplier, 1.8)) - 1) * warpEase;
    const powerSpeed = powerEngineFactor(npc.power.dist) * npc.power.engineSupply;
    npc.x += Math.sin(radians) * npc.speed * combatSpeed * cruiseWarp * powerSpeed * frameScale;
    npc.y -= Math.cos(radians) * npc.speed * combatSpeed * cruiseWarp * powerSpeed * frameScale;
  }
}

function updateAsteroids(frameScale = 1) {
  const now = performance.now();
  for (const asteroid of state.asteroids || []) {
    if (!asteroid || asteroid.depleted) continue;
    const seed = finiteNumber(asteroid.driftSeed, 1);
    const wanderX = Math.sin(now * 0.00027 + seed) * 0.006;
    const wanderY = Math.cos(now * 0.00023 + seed * 1.7) * 0.006;
    asteroid.vx = finiteNumber(asteroid.vx, 0) + wanderX * frameScale;
    asteroid.vy = finiteNumber(asteroid.vy, 0) + wanderY * frameScale;

    const originX = finiteNumber(asteroid.originX, asteroid.x);
    const originY = finiteNumber(asteroid.originY, asteroid.y);
    const dx = asteroid.x - originX;
    const dy = asteroid.y - originY;
    const distance = Math.hypot(dx, dy);
    const roamRadius = Math.max(80, finiteNumber(asteroid.roamRadius, 240));
    if (distance > roamRadius) {
      asteroid.vx -= (dx / distance) * 0.012 * frameScale;
      asteroid.vy -= (dy / distance) * 0.012 * frameScale;
    }

    const speed = Math.hypot(asteroid.vx, asteroid.vy);
    const maxSpeed = 0.58;
    if (speed > maxSpeed) {
      asteroid.vx = (asteroid.vx / speed) * maxSpeed;
      asteroid.vy = (asteroid.vy / speed) * maxSpeed;
    }
    asteroid.x += asteroid.vx * frameScale;
    asteroid.y += asteroid.vy * frameScale;
    asteroid.rotation = (finiteNumber(asteroid.rotation, 0) + finiteNumber(asteroid.spin, 0) * frameScale + 360) % 360;
  }
}

function updateStationDebris(frameScale = 1) {
  for (const station of state.stations || []) {
    if (!station.destroyed) continue;
    for (const piece of ensureStationDebris(station)) {
      const distance = Math.hypot(piece.ox, piece.oy);
      const limit = Math.max(70, finiteNumber(piece.limit, 140));
      if (distance > limit) {
        piece.vx -= (piece.ox / distance) * 0.014 * frameScale;
        piece.vy -= (piece.oy / distance) * 0.014 * frameScale;
      }
      const speed = Math.hypot(piece.vx, piece.vy);
      const maxSpeed = 0.42;
      if (speed > maxSpeed) {
        piece.vx = (piece.vx / speed) * maxSpeed;
        piece.vy = (piece.vy / speed) * maxSpeed;
      }
      piece.ox += piece.vx * frameScale;
      piece.oy += piece.vy * frameScale;
      piece.rotation = (finiteNumber(piece.rotation, 0) + finiteNumber(piece.spin, 0) * frameScale + 360) % 360;
    }
  }
}

function tick(frameScale = 1) {
  if (state.gameOver || !state.gameStarted) return;
  if (state.warp.active) {
    const elapsed = performance.now() - state.warp.startedAt;
    if (elapsed >= state.warp.duration) completeWarpTravel();
    return;
  }
  if (isWormholeTransitActive()) {
    updateWormholeTransit();
    return;
  }
  updateCloakState();
  updateSystemOrbits();
  updateAsteroids(frameScale);
  updateStationDebris(frameScale);
  updateFleetAttacks();
  updatePowerSystems(frameScale);
  updateSensorSystems(frameScale);
  updateNpcShips(frameScale);
  updateFleetAttacks();
  updateStationDefenses();
  updateProjectiles(frameScale);
  updateShieldRegeneration(frameScale);
  processHeldWeaponInputs();
  const s = state.ship;
  const up = keys.has('w') || keys.has('arrowup');
  const down = keys.has('s') || keys.has('arrowdown');
  const left = keys.has('a') || keys.has('arrowleft');
  const right = keys.has('d') || keys.has('arrowright');
  const turnInput = Number(right) - Number(left);
  const baseMaxSpeed = Math.max(1, finiteNumber(s.baseMaxSpeed, s.maxSpeed || 3.5));
  const movementNow = performance.now();
  if (up && !down && !state.docked) {
    if (!s.forwardThrustStartedAt) s.forwardThrustStartedAt = movementNow;
  } else {
    s.forwardThrustStartedAt = 0;
  }
  const forwardHoldMs = s.forwardThrustStartedAt ? movementNow - s.forwardThrustStartedAt : 0;
  const wantsSystemWarp = up
    && !down
    && !state.docked
    && forwardHoldMs >= IN_SYSTEM_WARP_HOLD_DELAY_MS
    && s.velocity >= baseMaxSpeed * 0.68;
  const warpApproach = (wantsSystemWarp ? 0.034 : 0.052) * frameScale;
  s.systemWarpIntensity = approachValue(clamp(finiteNumber(s.systemWarpIntensity, 0), 0, 1), wantsSystemWarp ? 1 : 0, warpApproach);
  const warpEase = s.systemWarpIntensity * s.systemWarpIntensity * (3 - 2 * s.systemWarpIntensity);
  const dynamicMaxSpeed = baseMaxSpeed * getPowerEnginesFactor() * (1 + (Math.max(1, finiteNumber(s.systemWarpMultiplier, 3)) - 1) * warpEase);
  s.maxSpeed = dynamicMaxSpeed;
  const speedRatio = clamp(s.velocity / Math.max(1, dynamicMaxSpeed), 0, 1);
  const speedTurnPenalty = clamp(1 - speedRatio * 0.3, 0.58, 1);
  const warpTurnPenalty = 1 - warpEase * (1 - clamp(finiteNumber(s.systemWarpTurnPenalty, 0.24), 0.12, 0.4));
  const fastTurnPenalty = Math.min(speedTurnPenalty, warpTurnPenalty);

  if (turnInput !== 0) {
    s.turnVelocity += turnInput * s.turnAcceleration * fastTurnPenalty * frameScale;
  }
  const maxTurn = s.maxTurnSpeed * fastTurnPenalty;
  s.turnVelocity = clamp(s.turnVelocity, -maxTurn, maxTurn);
  s.turnVelocity = approachZero(s.turnVelocity, (s.turnDamping || s.turnAcceleration * 0.25) * frameScale);
  s.rotation = (s.rotation + s.turnVelocity * frameScale + 360) % 360;

  if (up) {
    s.velocity += s.acceleration * getPowerEnginesFactor() * (1 + warpEase * 2.25) * frameScale;
  }
  if (down) {
    s.velocity -= s.brake * (1 + warpEase * 0.8) * frameScale;
  }
  if (!up && warpEase <= 0.02 && s.velocity > baseMaxSpeed) {
    s.velocity = approachValue(s.velocity, baseMaxSpeed, s.brake * 1.8 * frameScale);
  }
  s.velocity = clamp(s.velocity, 0, dynamicMaxSpeed);

  const radians = s.rotation * Math.PI / 180;
  setCamera(
    state.camera.x + Math.sin(radians) * s.velocity * frameScale,
    state.camera.y - Math.cos(radians) * s.velocity * frameScale,
  );
  s.x = canvas.width * 0.5;
  s.y = canvas.height * 0.5;
  updateTractorBeams(frameScale);
  updateSecurityEncounters(frameScale);

  const now = performance.now();
  if ((up || down || left || right || s.velocity > 0) && now - lastMotionStatsAt > 250) {
    lastMotionStatsAt = now;
    updateStats();
  }

  if (state.docked && state.dockedPlanetIndex != null) {
    const p = state.dockedPlanetIndex === state.currentPlanet ? getFlightPlanetMarker() : state.planets[state.dockedPlanetIndex];
    const d = Math.hypot(s.x - p.x, s.y - p.y);
    const undockDistance = (p.dockDistance || getPlanetDockDistance(p)) + 18;
    if (d > undockDistance) {
      state.docked = false;
      state.dockedPlanetIndex = null;
      closePlanetMenu();
      setLog('Undocked. Fly to a planet and click it to dock again.');
      updateStats();
    }
  }
  if (state.docked && state.dockedStationId) {
    const station = getCurrentDockedStation();
    if (!station) {
      state.docked = false;
      state.dockedStationId = null;
      closePlanetMenu();
      updateStats();
    } else {
      const p = worldToScreen(station);
      const d = Math.hypot(s.x - p.x, s.y - p.y);
      const undockDistance = getStationScreenRadius(station) + 88;
      if (d > undockDistance) {
        state.docked = false;
        state.dockedStationId = null;
        closePlanetMenu();
        setLog(`Undocked from ${station.name}.`);
        updateStats();
      }
    }
  }
}

function getImageAlphaBounds(img) {
  if (!img?.complete || img.naturalWidth === 0) return false;
  if (imageAlphaBoundsCache.has(img)) return imageAlphaBoundsCache.get(img);
  const fallback = { sx: 0, sy: 0, sw: img.naturalWidth, sh: img.naturalHeight };
  const trimBounds = img.bm2TrimBounds;
  if (
    trimBounds
    && Number.isFinite(trimBounds.sx)
    && Number.isFinite(trimBounds.sy)
    && Number.isFinite(trimBounds.sw)
    && Number.isFinite(trimBounds.sh)
    && trimBounds.sw > 0
    && trimBounds.sh > 0
  ) {
    const bounds = {
      sx: Math.max(0, Math.min(img.naturalWidth - 1, trimBounds.sx)),
      sy: Math.max(0, Math.min(img.naturalHeight - 1, trimBounds.sy)),
      sw: Math.max(1, Math.min(img.naturalWidth - Math.max(0, trimBounds.sx), trimBounds.sw)),
      sh: Math.max(1, Math.min(img.naturalHeight - Math.max(0, trimBounds.sy), trimBounds.sh)),
    };
    imageAlphaBoundsCache.set(img, bounds);
    return bounds;
  }
  try {
    const mask = document.createElement('canvas');
    mask.width = img.naturalWidth;
    mask.height = img.naturalHeight;
    const maskCtx = mask.getContext('2d', { willReadFrequently: true });
    maskCtx.drawImage(img, 0, 0);
    const { data, width, height } = maskCtx.getImageData(0, 0, mask.width, mask.height);
    let minX = width;
    let minY = height;
    let maxX = -1;
    let maxY = -1;
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        if (data[(y * width + x) * 4 + 3] <= 12) continue;
        minX = Math.min(minX, x);
        minY = Math.min(minY, y);
        maxX = Math.max(maxX, x);
        maxY = Math.max(maxY, y);
      }
    }
    if (maxX < minX || maxY < minY) {
      imageAlphaBoundsCache.set(img, fallback);
      return fallback;
    }
    const pad = 2;
    const bounds = {
      sx: Math.max(0, minX - pad),
      sy: Math.max(0, minY - pad),
      sw: Math.min(width, maxX + pad + 1) - Math.max(0, minX - pad),
      sh: Math.min(height, maxY + pad + 1) - Math.max(0, minY - pad),
    };
    imageAlphaBoundsCache.set(img, bounds);
    return bounds;
  } catch {
    imageAlphaBoundsCache.set(img, fallback);
    return fallback;
  }
}

function drawRotatedImage(img, x, y, maxWidth, maxHeight, rotation, scale = 1) {
  if (!img?.complete || img.naturalWidth === 0) return false;
  const bounds = getImageAlphaBounds(img);
  const fit = Math.min(maxWidth / bounds.sw, maxHeight / bounds.sh) * scale;
  const w = bounds.sw * fit;
  const h = bounds.sh * fit;
  ctx.save();
  ctx.translate(x, y);
  ctx.rotate(rotation * Math.PI / 180);
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(img, bounds.sx, bounds.sy, bounds.sw, bounds.sh, -w / 2, -h / 2, w, h);
  ctx.restore();
  return true;
}

function drawStationDebris(station) {
  const debrisSprite = sprites.stationDebris;
  const useSprite = debrisSprite?.complete && debrisSprite.naturalWidth > 0;
  for (const piece of ensureStationDebris(station)) {
    const p = worldToScreen({
      x: station.x + finiteNumber(piece.ox, 0),
      y: station.y + finiteNumber(piece.oy, 0),
    });
    const spriteDrawSize = finiteNumber(piece.drawSize, 34) * 2.55;
    const pad = useSprite ? spriteDrawSize * 0.56 : Math.max(piece.w || 8, piece.h || 6) + 16;
    if (p.x < -pad || p.x > canvas.width + pad || p.y < -pad || p.y > canvas.height + pad) continue;
    ctx.save();
    ctx.translate(p.x, p.y);
    ctx.rotate(finiteNumber(piece.rotation, 0) * Math.PI / 180);
    ctx.globalAlpha = finiteNumber(piece.alpha, 0.72);
    if (useSprite) {
      const cols = 4;
      const rows = 6;
      const index = Math.abs(Math.round(finiteNumber(piece.spriteIndex, 0))) % (cols * rows);
      const cellW = debrisSprite.naturalWidth / cols;
      const cellH = debrisSprite.naturalHeight / rows;
      const sx = (index % cols) * cellW;
      const sy = Math.floor(index / cols) * cellH;
      ctx.imageSmoothingEnabled = true;
      ctx.imageSmoothingQuality = 'high';
      ctx.drawImage(
        debrisSprite,
        sx,
        sy,
        cellW,
        cellH,
        -spriteDrawSize / 2,
        -spriteDrawSize / 2,
        spriteDrawSize,
        spriteDrawSize,
      );
      ctx.restore();
      continue;
    }
    ctx.fillStyle = piece.color || '#a9b1ba';
    ctx.strokeStyle = 'rgba(230, 238, 246, 0.28)';
    ctx.lineWidth = 1;
    const w = Math.max(2, finiteNumber(piece.w, 8));
    const h = Math.max(2, finiteNumber(piece.h, 5));
    ctx.beginPath();
    if (piece.shape === 'spar') {
      ctx.rect(-w / 2, -h / 2, w, h);
    } else {
      ctx.moveTo(-w * 0.48, -h * 0.36);
      ctx.lineTo(w * 0.42, -h * 0.5);
      ctx.lineTo(w * 0.5, h * 0.18);
      ctx.lineTo(w * 0.12, h * 0.52);
      ctx.lineTo(-w * 0.55, h * 0.32);
      ctx.closePath();
    }
    ctx.fill();
    ctx.stroke();
    if (piece.color === '#f1b56a' || piece.color === '#78d7ff') {
      ctx.globalAlpha *= 0.45;
      ctx.shadowColor = piece.color;
      ctx.shadowBlur = 9;
      ctx.fillRect(-2, -2, 4, 4);
    }
    ctx.restore();
  }
}

function shouldDrawAssetFallback(img) {
  return !img || (img.complete && img.naturalWidth === 0);
}

function getRotatedImageDrawSize(img, maxWidth, maxHeight, scale = 1) {
  if (!img?.complete || img.naturalWidth === 0) {
    return { width: maxWidth * scale, height: maxHeight * scale };
  }
  const bounds = getImageAlphaBounds(img);
  const fit = Math.min(maxWidth / bounds.sw, maxHeight / bounds.sh) * scale;
  return {
    width: bounds.sw * fit,
    height: bounds.sh * fit,
  };
}

function getImageAlphaMask(img) {
  if (!img?.complete || img.naturalWidth === 0) return null;
  if (imageAlphaMaskCache.has(img)) return imageAlphaMaskCache.get(img);
  try {
    const mask = document.createElement('canvas');
    mask.width = img.naturalWidth;
    mask.height = img.naturalHeight;
    const maskCtx = mask.getContext('2d', { willReadFrequently: true });
    maskCtx.drawImage(img, 0, 0);
    const imageData = maskCtx.getImageData(0, 0, mask.width, mask.height);
    const result = { data: imageData.data, width: imageData.width, height: imageData.height };
    imageAlphaMaskCache.set(img, result);
    return result;
  } catch {
    imageAlphaMaskCache.set(img, null);
    return null;
  }
}

function getVisibleAlphaSamples(img) {
  if (!img?.complete || img.naturalWidth === 0) return [];
  const bounds = getImageAlphaBounds(img);
  const mask = getImageAlphaMask(img);
  if (!bounds || !mask) return [];
  let cacheForImage = imageAlphaSampleCache.get(img);
  if (!cacheForImage) {
    cacheForImage = new Map();
    imageAlphaSampleCache.set(img, cacheForImage);
  }
  const key = `${bounds.sx}:${bounds.sy}:${bounds.sw}:${bounds.sh}`;
  if (cacheForImage.has(key)) return cacheForImage.get(key);
  const samples = [];
  const step = Math.max(1, Math.floor(Math.max(bounds.sw, bounds.sh) / 42));
  const densityRadius = Math.max(2, step * 2);
  const alphaAt = (x, y) => mask.data[(y * mask.width + x) * 4 + 3];
  for (let y = bounds.sy; y < bounds.sy + bounds.sh; y += step) {
    for (let x = bounds.sx; x < bounds.sx + bounds.sw; x += step) {
      if (alphaAt(x, y) <= 36) continue;
      let opaqueNeighbors = 0;
      let checkedNeighbors = 0;
      for (let dy = -densityRadius; dy <= densityRadius; dy += Math.max(1, step)) {
        for (let dx = -densityRadius; dx <= densityRadius; dx += Math.max(1, step)) {
          const nx = x + dx;
          const ny = y + dy;
          if (nx < bounds.sx || nx >= bounds.sx + bounds.sw || ny < bounds.sy || ny >= bounds.sy + bounds.sh) continue;
          checkedNeighbors += 1;
          if (alphaAt(nx, ny) > 36) opaqueNeighbors += 1;
        }
      }
      samples.push({
        nx: ((x - bounds.sx + 0.5) / bounds.sw) - 0.5,
        ny: ((y - bounds.sy + 0.5) / bounds.sh) - 0.5,
        density: checkedNeighbors > 0 ? opaqueNeighbors / checkedNeighbors : 1,
      });
    }
  }
  if (!samples.length) samples.push({ nx: 0, ny: 0, density: 1 });
  cacheForImage.set(key, samples);
  return samples;
}

function getCombatSpriteGeometry(entity = null, entityType = 'ship') {
  if (entityType === 'player') {
    const visual = getShipVisualProfile(state.playership);
    return {
      center: playerWorldPosition(),
      rotation: state.ship.rotation || 0,
      sprite: getShipSprite(state.playership),
      maxWidth: state.ship.drawWidth || visual.width,
      maxHeight: state.ship.drawHeight || visual.height,
      scale: state.ship.drawScale || visual.scale,
      shipId: state.playership,
    };
  }
  if (entityType === 'station' || entity?.stationTypeId) {
    const visual = getStationVisualProfile(entity);
    return {
      center: entity,
      rotation: entity?.rotation || 0,
      sprite: getShipSprite(entity?.stationTypeId),
      maxWidth: visual.width,
      maxHeight: visual.height,
      scale: visual.scale || 1,
      shipId: entity?.stationTypeId,
    };
  }
  const shipId = entity?.shipId || entity?.id || state.playership;
  const visual = getShipVisualProfile(shipId);
  return {
    center: entity || playerWorldPosition(),
    rotation: entity?.heading ?? entity?.rotation ?? 0,
    sprite: getShipSprite(shipId),
    maxWidth: visual.width,
    maxHeight: visual.height,
    scale: entity?.scale || visual.scale || 1,
    shipId,
  };
}

function localToWorldPoint(center, rotationDeg, lx, ly) {
  const angle = rotationDeg * Math.PI / 180;
  const cos = Math.cos(angle);
  const sin = Math.sin(angle);
  return {
    x: center.x + lx * cos - ly * sin,
    y: center.y + lx * sin + ly * cos,
  };
}

function worldVectorToLocal(rotationDeg, dx, dy) {
  const angle = rotationDeg * Math.PI / 180;
  const cos = Math.cos(angle);
  const sin = Math.sin(angle);
  return {
    x: dx * cos + dy * sin,
    y: -dx * sin + dy * cos,
  };
}

function getVisibleSpriteEdgePoint(entity, towardPoint, options = {}) {
  const geometry = getCombatSpriteGeometry(entity, options.entityType || (entity?.stationTypeId ? 'station' : 'ship'));
  const { center, rotation, sprite, maxWidth, maxHeight, scale } = geometry;
  if (!center || !towardPoint || !sprite?.complete || sprite.naturalWidth === 0) return center || towardPoint;
  const sampleFilter = typeof options.sampleFilter === 'function' ? options.sampleFilter : null;
  const rawSamples = getVisibleAlphaSamples(sprite);
  const filteredSamples = sampleFilter ? rawSamples.filter(sampleFilter) : rawSamples;
  const samples = filteredSamples.length || options.fallbackToRaw === false ? filteredSamples : rawSamples;
  if (!samples.length) return center;
  const drawSize = getRotatedImageDrawSize(sprite, maxWidth, maxHeight, scale);
  const localDir = worldVectorToLocal(rotation, towardPoint.x - center.x, towardPoint.y - center.y);
  const length = Math.hypot(localDir.x, localDir.y) || 1;
  const dirX = localDir.x / length;
  const dirY = localDir.y / length;
  const perpX = -dirY;
  const perpY = dirX;
  const seedValue = finiteNumber(options.seed, 0);
  const spread = finiteNumber(options.spread, 0);
  let best = null;
  let bestScore = -Infinity;
  const candidates = [];
  for (const sample of samples) {
    const lx = sample.nx * drawSize.width;
    const ly = sample.ny * drawSize.height;
    const projection = lx * dirX + ly * dirY;
    const lateral = lx * perpX + ly * perpY;
    const varied = spread
      ? projection + Math.sin((lateral + seedValue * 17.31) * 0.045) * spread
      : projection;
    if (varied > bestScore) {
      bestScore = varied;
      best = { lx, ly, projection };
    }
    candidates.push({ lx, ly, projection, lateral });
  }
  if (spread && candidates.length > 1) {
    const maxProjection = Math.max(...candidates.map((candidate) => candidate.projection));
    const edgeBand = Math.max(drawSize.width, drawSize.height) * 0.09;
    const edgeCandidates = candidates
      .filter((candidate) => candidate.projection >= maxProjection - edgeBand)
      .sort((a, b) => a.lateral - b.lateral);
    if (edgeCandidates.length) {
      const index = Math.floor(seeded(seedValue || edgeCandidates.length) * edgeCandidates.length);
      best = edgeCandidates[index];
    }
  }
  if (!best) return center;
  const inset = clamp(finiteNumber(options.insetFraction, 0), 0, 0.75);
  return localToWorldPoint(center, rotation, best.lx * (1 - inset), best.ly * (1 - inset));
}

function getWeaponImpactPoint(target, shooterPoint, targetType = null) {
  const entityType = targetType || (target?.stationTypeId ? 'station' : target?.id ? 'ship' : 'player');
  return getVisibleSpriteEdgePoint(target, shooterPoint, { entityType, spread: 0 });
}

function addCuttingBeamEffects({
  weapon,
  source = null,
  sourceType = 'ship',
  target = null,
  targetType = 'ship',
  color = CUTTING_BEAM_COLOR,
  seedValue = 1,
  baseWidth = 2.4,
  ttl = 260,
}) {
  const sourceEntityType = sourceType === 'player' ? 'player' : sourceType === 'station' ? 'station' : 'ship';
  const targetEntityType = targetType === 'player' ? 'player' : targetType === 'station' ? 'station' : 'ship';
  const targetCenter = targetEntityType === 'player' ? playerWorldPosition() : target;
  const count = isReducedEffectsMode() ? 3 : 5;
  for (let i = 0; i < count; i += 1) {
    const beamSeed = seedValue + i * 47 + 11;
    const from = getPhaserEmitterPoint(
      sourceEntityType === 'player' ? null : source,
      targetCenter,
      weapon,
      beamSeed,
      sourceEntityType,
    );
    const to = getVisibleSpriteEdgePoint(
      targetEntityType === 'player' ? null : target,
      from,
      {
        entityType: targetEntityType,
        seed: seedValue + i * 83 + 29,
        spread: 42,
        insetFraction: i === 0 ? 0.01 : 0.04,
      },
    ) || getWeaponImpactPoint(targetEntityType === 'player' ? null : target, from, targetEntityType);
    const primary = i === 0;
    addWeaponEffect({
      kind: 'beam',
      weaponId: weapon.id,
      from,
      to,
      color,
      width: baseWidth * (primary ? 1.35 : 0.82 + (i % 2) * 0.18),
      alphaScale: primary ? 1 : 0.76,
      ttl: ttl + (primary ? 50 : i * 12),
    });
    addWeaponEffect({
      kind: 'burst',
      x: to.x,
      y: to.y,
      color,
      radius: primary ? 14 : 9 + i,
      ttl: 190 + i * 18,
    });
  }
}

function getTractorEmitterPoint(targetPoint) {
  const center = playerWorldPosition();
  if (!targetPoint) return center;
  return getVisibleSpriteEdgePoint(null, targetPoint, {
    entityType: 'player',
    spread: 0,
    insetFraction: 0.02,
  }) || center;
}

function isLikelyPhaserEmitterSample(sample) {
  const absX = Math.abs(sample.nx);
  const y = sample.ny;
  if (sample.density < 0.58) return false;
  if (absX > 0.36) return false;
  if (y > 0.24) return false;
  if (absX > 0.28 && y > -0.18) return false;
  return true;
}

function getPhaserEmitterPoint(source, targetPoint, weapon, seedValue = 0, entityType = null) {
  if (!weapon || weapon.type !== 'Beam') {
    const center = entityType === 'player' ? playerWorldPosition() : source;
    return center || playerWorldPosition();
  }
  return getVisibleSpriteEdgePoint(source, targetPoint, {
    entityType: entityType || (source?.stationTypeId ? 'station' : source ? 'ship' : 'player'),
    seed: seedValue || weapon.id || 1,
    spread: 18,
    sampleFilter: isLikelyPhaserEmitterSample,
    fallbackToRaw: false,
    insetFraction: 0.3,
  });
}

function colorToRgb(color = '#56c8ff') {
  const hex = String(color).trim();
  if (/^#[0-9a-f]{3}$/i.test(hex)) {
    return {
      r: parseInt(hex[1] + hex[1], 16),
      g: parseInt(hex[2] + hex[2], 16),
      b: parseInt(hex[3] + hex[3], 16),
    };
  }
  if (/^#[0-9a-f]{6}$/i.test(hex)) {
    return {
      r: parseInt(hex.slice(1, 3), 16),
      g: parseInt(hex.slice(3, 5), 16),
      b: parseInt(hex.slice(5, 7), 16),
    };
  }
  return { r: 86, g: 200, b: 255 };
}

function colorToRgba(color = '#56c8ff', alpha = 1) {
  const rgb = colorToRgb(color);
  return `rgba(${rgb.r}, ${rgb.g}, ${rgb.b}, ${clamp(alpha, 0, 1)})`;
}

function getShipShieldOutline(shipId, maxWidth = 74, maxHeight = 74, scale = 1, color = '#56c8ff') {
  const img = getShipSprite(shipId);
  if (!img?.complete || img.naturalWidth === 0) return null;
  const bounds = getImageAlphaBounds(img);
  const drawSize = getRotatedImageDrawSize(img, maxWidth, maxHeight, scale);
  const drawW = Math.max(1, Math.ceil(drawSize.width));
  const drawH = Math.max(1, Math.ceil(drawSize.height));
  const pad = 6;
  const width = drawW + pad * 2;
  const height = drawH + pad * 2;
  const key = `${shipId}:${img.bm2Src || img.src}:${drawW}x${drawH}:${color}`;
  if (shieldOutlineCache.has(key)) return shieldOutlineCache.get(key);

  const mask = document.createElement('canvas');
  mask.width = width;
  mask.height = height;
  const maskCtx = mask.getContext('2d', { willReadFrequently: true });
  maskCtx.clearRect(0, 0, width, height);
  maskCtx.imageSmoothingEnabled = true;
  maskCtx.imageSmoothingQuality = 'high';
  maskCtx.drawImage(img, bounds.sx, bounds.sy, bounds.sw, bounds.sh, pad, pad, drawW, drawH);

  const source = maskCtx.getImageData(0, 0, width, height);
  const outline = maskCtx.createImageData(width, height);
  const { r, g, b } = colorToRgb(color);
  const data = source.data;
  const out = outline.data;
  const alphaAt = (x, y) => data[(y * width + x) * 4 + 3];

  for (let y = 1; y < height - 1; y++) {
    for (let x = 1; x < width - 1; x++) {
      if (alphaAt(x, y) > 28) continue;
      let nearestOpaqueDistance = Infinity;
      for (let dy = -3; dy <= 3; dy++) {
        for (let dx = -3; dx <= 3; dx++) {
          if (dx === 0 && dy === 0) continue;
          const distanceSq = dx * dx + dy * dy;
          if (distanceSq > 10) continue;
          const nx = x + dx;
          const ny = y + dy;
          if (nx < 0 || nx >= width || ny < 0 || ny >= height) continue;
          if (alphaAt(nx, ny) > 36) nearestOpaqueDistance = Math.min(nearestOpaqueDistance, distanceSq);
        }
      }
      if (!Number.isFinite(nearestOpaqueDistance)) continue;
      const index = (y * width + x) * 4;
      out[index] = r;
      out[index + 1] = g;
      out[index + 2] = b;
      out[index + 3] = nearestOpaqueDistance <= 2 ? 235 : 160;
    }
  }

  const outlineCanvas = document.createElement('canvas');
  outlineCanvas.width = width;
  outlineCanvas.height = height;
  const outlineCtx = outlineCanvas.getContext('2d');
  outlineCtx.putImageData(outline, 0, 0);
  const result = { canvas: outlineCanvas, width, height };
  shieldOutlineCache.set(key, result);
  return result;
}

function getPlanetModelSprite(p) {
  const rawType = Number(p?.surfaceType || 1);
  const availableTypes = Object.keys(state.planetModelSprites)
    .map((id) => Number(id))
    .filter(Number.isFinite);
  const manifestCount = Math.max(1, Math.round(finiteNumber(state.planetManifest?.modelCount, 24)));
  const maxType = Math.max(manifestCount, ...availableTypes, 24);
  const surfaceType = clamp(Number.isFinite(rawType) ? Math.round(rawType) : 1, 1, maxType);
  if (!state.planetModelSprites[surfaceType]) {
    const model = state.planetManifest?.models?.find((entry) => Number(entry.id) === surfaceType);
    const img = new Image();
    img.src = `${model?.image || `assets/game/planet-models/${surfaceType}.png`}?v=${PLANET_MODEL_ASSET_VERSION}`;
    state.planetModelSprites[surfaceType] = img;
  }
  return state.planetModelSprites[surfaceType];
}

function getPlanetRingSprite(ringType = 0) {
  const type = clamp(Math.round(finiteNumber(ringType, 0)), 1, 4);
  if (!state.planetRingSprites[type]) {
    state.planetRingSprites[type] = null;
  }
  return state.planetRingSprites[type];
}

function hasPlanetRings(p) {
  return finiteNumber(p?.ringType, 0) > 0;
}

function drawProceduralPlanetRings(p, x, y, size, alpha = 0.9, layer = 'full') {
  const outerX = size * 1.08;
  const outerY = size * 0.28;
  const planetRadius = size * 0.46;
  const ringColor = p.kind === 'moon' ? '210, 220, 236' : '214, 196, 150';
  ctx.save();
  ctx.translate(x, y);
  ctx.rotate(finiteNumber(p.ringRotation, 0) * Math.PI / 180);
  if (layer === 'back') {
    ctx.beginPath();
    ctx.rect(-outerX - 18, -outerY - 18, outerX * 2 + 36, outerY * 2 + 36);
    ctx.arc(0, 0, planetRadius, 0, Math.PI * 2, true);
    ctx.clip('evenodd');
  } else if (layer === 'front') {
    ctx.beginPath();
    ctx.rect(-outerX - 18, 0, outerX * 2 + 36, outerY + 18);
    ctx.clip();
  }
  ctx.globalAlpha = alpha;
  ctx.lineCap = 'round';
  const arcs = layer === 'front'
    ? [[0, Math.PI]]
    : layer === 'back'
      ? [[Math.PI, Math.PI * 2]]
      : [[0, Math.PI * 2]];
  for (const [start, end] of arcs) {
    for (let i = 0; i < 4; i++) {
      const spread = i - 1.5;
      ctx.beginPath();
      ctx.ellipse(0, 0, outerX + spread * 9, outerY + spread * 2.8, 0, start, end);
      ctx.strokeStyle = `rgba(${ringColor}, ${0.28 + i * 0.1})`;
      ctx.lineWidth = i === 1 ? 2.2 : 1.1;
      ctx.stroke();
    }
  }
  ctx.restore();
  return true;
}

function drawPlanetRings(p, x, y, size, alpha = 0.9, layer = 'full') {
  if (!hasPlanetRings(p)) return false;
  const ring = getPlanetRingSprite(p.ringType);
  if (!ring?.complete || ring.naturalWidth === 0) {
    return drawProceduralPlanetRings(p, x, y, size, alpha, layer);
  }
  const width = size * 2.28;
  const height = width * (ring.naturalHeight / ring.naturalWidth);
  ctx.save();
  ctx.translate(x, y);
  ctx.rotate(finiteNumber(p.ringRotation, 0) * Math.PI / 180);
  if (layer === 'back') {
    ctx.beginPath();
    ctx.rect(-width / 2, -height / 2, width, height / 2);
    ctx.clip();
    ctx.beginPath();
    ctx.rect(-width / 2, -height / 2, width, height);
    ctx.arc(0, 0, size * 0.51, 0, Math.PI * 2, true);
    ctx.clip('evenodd');
  } else if (layer === 'front') {
    ctx.beginPath();
    ctx.rect(-width / 2, 0, width, height / 2);
    ctx.clip();
  }
  ctx.globalAlpha = alpha;
  ctx.drawImage(ring, -width / 2, -height / 2, width, height);
  ctx.restore();
  return true;
}

function getPlanetSpinAngle(p, now = performance.now()) {
  const period = Math.max(4000, finiteNumber(p?.spinPeriod, 26000));
  const direction = finiteNumber(p?.spinDirection, 1) >= 0 ? 1 : -1;
  return (now / period) * Math.PI * 2 * direction;
}

function drawPlanetOcclusionDisk(p, x, y, size) {
  if (p?.kind === 'moon') return;
  const radius = size * 0.465;
  ctx.save();
  const shade = ctx.createRadialGradient(x - radius * 0.26, y - radius * 0.3, radius * 0.04, x, y, radius);
  shade.addColorStop(0, 'rgba(22, 30, 42, 1)');
  shade.addColorStop(0.58, 'rgba(8, 13, 20, 1)');
  shade.addColorStop(1, 'rgba(0, 0, 0, 1)');
  ctx.fillStyle = shade;
  ctx.beginPath();
  ctx.arc(x, y, radius, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();
}

function drawPlanetInnerEdgeShadow(p, x, y, size) {
  if (p?.kind === 'moon') return;
  const radius = size * 0.472;
  ctx.save();
  ctx.beginPath();
  ctx.arc(x, y, radius, 0, Math.PI * 2);
  ctx.clip();
  const rim = ctx.createRadialGradient(x, y, radius * 0.58, x, y, radius);
  rim.addColorStop(0, 'rgba(0, 0, 0, 0)');
  rim.addColorStop(0.74, 'rgba(0, 0, 0, 0.04)');
  rim.addColorStop(0.9, 'rgba(0, 0, 0, 0.28)');
  rim.addColorStop(1, 'rgba(0, 0, 0, 0.72)');
  ctx.fillStyle = rim;
  ctx.beginPath();
  ctx.arc(x, y, radius, 0, Math.PI * 2);
  ctx.fill();
  ctx.globalCompositeOperation = 'source-over';
  ctx.strokeStyle = 'rgba(0, 0, 0, 0.62)';
  ctx.lineWidth = Math.max(2.4, size * 0.026);
  ctx.beginPath();
  ctx.arc(x, y, radius * 0.985, 0, Math.PI * 2);
  ctx.stroke();
  ctx.restore();
}

function drawSpinningPlanetSprite(img, p, x, y, size, now = performance.now()) {
  if (!img?.complete || img.naturalWidth <= 0) return false;
  const spinAngle = getPlanetSpinAngle(p, now);
  const fit = Math.min(size / img.naturalWidth, size / img.naturalHeight);
  const w = img.naturalWidth * fit;
  const h = img.naturalHeight * fit;
  ctx.save();
  ctx.translate(x, y);
  ctx.rotate(spinAngle);
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(img, -w / 2, -h / 2, w, h);
  ctx.restore();
  return true;
}

function getStarChartPanelRect() {
  const width = clamp(canvas.width * 0.84, 660, canvas.width - 88);
  const height = clamp(canvas.height * 0.79, 380, canvas.height - 88);
  const left = (canvas.width - width) / 2;
  const top = Math.max(28, (canvas.height - height) / 2 - canvas.height * 0.02);
  return {
    left,
    top,
    right: left + width,
    bottom: top + height,
    headerH: Math.max(58, Math.min(82, canvas.height * 0.105)),
    railW: Math.max(54, Math.min(74, canvas.width * 0.058)),
    pad: Math.max(12, canvas.width * 0.014),
  };
}

function getStarChartViewport() {
  const panel = getStarChartPanelRect();
  return {
    left: panel.left + panel.railW + panel.pad,
    top: panel.top + panel.headerH + panel.pad,
    right: panel.right - panel.pad,
    bottom: panel.bottom - panel.pad,
  };
}

function getStarChartBounds() {
  if (!state.planets.length) return { minX: -100, maxX: 100, minY: -100, maxY: 100, cx: 0, cy: 0, width: 200, height: 200 };
  const minX = Math.min(...state.planets.map((p) => p.x));
  const maxX = Math.max(...state.planets.map((p) => p.x));
  const minY = Math.min(...state.planets.map((p) => p.y));
  const maxY = Math.max(...state.planets.map((p) => p.y));
  return {
    minX,
    maxX,
    minY,
    maxY,
    cx: (minX + maxX) / 2,
    cy: (minY + maxY) / 2,
    width: Math.max(1, maxX - minX),
    height: Math.max(1, maxY - minY),
  };
}

function getStarChartTransform() {
  const viewport = getStarChartViewport();
  const bounds = getStarChartBounds();
  const viewW = Math.max(1, viewport.right - viewport.left);
  const viewH = Math.max(1, viewport.bottom - viewport.top);
  const baseScale = Math.min(viewW / (bounds.width + 180), viewH / (bounds.height + 180));
  const scale = clamp(baseScale * state.starChart.zoom, 0.22, 2.8);
  return {
    viewport,
    bounds,
    scale,
    cx: (viewport.left + viewport.right) / 2 + state.starChart.panX,
    cy: (viewport.top + viewport.bottom) / 2 + state.starChart.panY,
  };
}

function focusStarChartOnSystem(systemIndex = state.currentPlanet, zoom = STAR_CHART_FOCUSED_ZOOM) {
  const system = state.planets[systemIndex] || state.planets[state.currentPlanet];
  if (!system) {
    state.starChart.panX = 0;
    state.starChart.panY = 0;
    state.starChart.zoom = STAR_CHART_DEFAULT_ZOOM;
    return;
  }
  state.starChart.zoom = clamp(zoom, 0.55, 3.2);
  const t = getStarChartTransform();
  state.starChart.panX = -(system.x - t.bounds.cx) * t.scale;
  state.starChart.panY = -(system.y - t.bounds.cy) * t.scale;
  state.starChart.layoutKey = '';
}

function chartToScreen(point) {
  const t = getStarChartTransform();
  return {
    x: t.cx + (point.x - t.bounds.cx) * t.scale,
    y: t.cy + (point.y - t.bounds.cy) * t.scale,
  };
}

function getStarChartLayoutKey(t = getStarChartTransform()) {
  return [
    canvas.width,
    canvas.height,
    state.planets.length,
    state.currentPlanet,
    state.selectedPlanet,
    t.scale.toFixed(4),
    t.cx.toFixed(1),
    t.cy.toFixed(1),
  ].join('|');
}

function getStarChartSystemLayout() {
  const t = getStarChartTransform();
  const key = getStarChartLayoutKey(t);
  if (state.starChart.layoutKey === key && state.starChart.layoutPositions?.length === state.planets.length) {
    return state.starChart.layoutPositions;
  }

  const positions = state.planets.map((planet, index) => {
    const raw = {
      x: t.cx + (planet.x - t.bounds.cx) * t.scale,
      y: t.cy + (planet.y - t.bounds.cy) * t.scale,
    };
    return {
      index,
      x: raw.x,
      y: raw.y,
      anchorX: raw.x,
      anchorY: raw.y,
    };
  });
  const minGap = 42;
  const strongGap = 54;

  for (let pass = 0; pass < 18; pass++) {
    for (let a = 0; a < positions.length; a++) {
      for (let b = a + 1; b < positions.length; b++) {
        const pa = positions[a];
        const pb = positions[b];
        const dx = pb.x - pa.x;
        const dy = pb.y - pa.y;
        const distance = Math.max(0.01, Math.hypot(dx, dy));
        const important = pa.index === state.currentPlanet
          || pa.index === state.selectedPlanet
          || pb.index === state.currentPlanet
          || pb.index === state.selectedPlanet;
        const wanted = important ? strongGap : minGap;
        if (distance >= wanted) continue;
        const push = (wanted - distance) * 0.48;
        const ux = dx / distance;
        const uy = dy / distance;
        const aFixed = pa.index === state.currentPlanet ? 0.35 : pa.index === state.selectedPlanet ? 0.55 : 1;
        const bFixed = pb.index === state.currentPlanet ? 0.35 : pb.index === state.selectedPlanet ? 0.55 : 1;
        const total = aFixed + bFixed;
        const aShare = bFixed / total;
        const bShare = aFixed / total;
        pa.x -= ux * push * aShare;
        pa.y -= uy * push * aShare;
        pb.x += ux * push * bShare;
        pb.y += uy * push * bShare;
      }
    }

    for (const point of positions) {
      const anchorPull = point.index === state.currentPlanet ? 0.18 : point.index === state.selectedPlanet ? 0.12 : 0.08;
      point.x += (point.anchorX - point.x) * anchorPull;
      point.y += (point.anchorY - point.y) * anchorPull;
    }
  }

  state.starChart.layoutKey = key;
  state.starChart.layoutPositions = positions.map((point) => ({ x: point.x, y: point.y }));
  return state.starChart.layoutPositions;
}

function getStarChartSystemScreen(systemIndex) {
  return getStarChartSystemLayout()[systemIndex] || chartToScreen(state.planets[systemIndex] || { x: 0, y: 0 });
}

function clipStarChartViewport() {
  const { viewport } = getStarChartTransform();
  ctx.beginPath();
  ctx.rect(
    viewport.left,
    viewport.top,
    Math.max(1, viewport.right - viewport.left),
    Math.max(1, viewport.bottom - viewport.top),
  );
  ctx.clip();
}

function isPointInStarChartViewport(x, y) {
  const { viewport } = getStarChartTransform();
  return x >= viewport.left && x <= viewport.right && y >= viewport.top && y <= viewport.bottom;
}

function isPointInStarChartPanel(x, y) {
  const panel = getStarChartPanelRect();
  return x >= panel.left && x <= panel.right && y >= panel.top && y <= panel.bottom;
}

function screenToChart(x, y) {
  const t = getStarChartTransform();
  return {
    x: (x - t.cx) / t.scale + t.bounds.cx,
    y: (y - t.cy) / t.scale + t.bounds.cy,
  };
}

function canvasCssVar(name, fallback) {
  return getComputedStyle(document.body).getPropertyValue(name).trim() || fallback;
}

function roundedRectPath(x, y, width, height, radius) {
  const r = Math.min(radius, width / 2, height / 2);
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.lineTo(x + width - r, y);
  ctx.arcTo(x + width, y, x + width, y + r, r);
  ctx.lineTo(x + width, y + height - r);
  ctx.arcTo(x + width, y + height, x + width - r, y + height, r);
  ctx.lineTo(x + r, y + height);
  ctx.arcTo(x, y + height, x, y + height - r, r);
  ctx.lineTo(x, y + r);
  ctx.arcTo(x, y, x + r, y, r);
  ctx.closePath();
}

function drawStarChartBackground() {
  const { viewport, scale } = getStarChartTransform();
  const { left, top, right, bottom } = viewport;
  const panel = getStarChartPanelRect();
  const panelW = panel.right - panel.left;
  const panelH = panel.bottom - panel.top;
  const panelColor = canvasCssVar('--lcars-panel', '#090b14');
  const orange = canvasCssVar('--lcars-orange', '#ff7a3d');
  const amber = canvasCssVar('--lcars-amber', '#ffb454');
  const purple = canvasCssVar('--lcars-purple', '#b494ff');
  const cream = canvasCssVar('--lcars-cream', '#ffd6a4');
  ctx.save();

  ctx.shadowColor = 'rgba(0, 0, 0, 0.72)';
  ctx.shadowBlur = 26;
  ctx.shadowOffsetY = 10;
  roundedRectPath(panel.left, panel.top, panelW, panelH, 28);
  ctx.fillStyle = panelColor;
  ctx.fill();
  ctx.shadowBlur = 0;
  ctx.shadowOffsetY = 0;
  ctx.lineWidth = 1;
  ctx.strokeStyle = colorToRgba(cream, 0.18);
  ctx.stroke();

  const headerY = panel.top;
  const headerH = panel.headerH;
  const railX = panel.left;
  const railW = panel.railW;
  const titleX = panel.left + railW + 20;

  // The header and side rail share the outer-panel clip so they read as one LCARS piece.
  roundedRectPath(panel.left, panel.top, panelW, panelH, 28);
  ctx.save();
  ctx.clip();
  ctx.fillStyle = amber;
  ctx.fillRect(panel.left, headerY, panelW, headerH * 0.72);
  ctx.fillStyle = colorToRgba(cream, 0.24);
  ctx.fillRect(panel.left, headerY + headerH * 0.72 - 4, panelW, 4);
  ctx.restore();

  roundedRectPath(railX, panel.top, railW, panelH, 28);
  ctx.save();
  ctx.clip();
  const railSegments = [
    { y: panel.top, h: panelH * 0.24, color: amber },
    { y: panel.top + panelH * 0.24, h: panelH * 0.32, color: colorToRgba(orange, 0.72) },
    { y: panel.top + panelH * 0.56, h: panelH * 0.28, color: colorToRgba(purple, 0.7) },
    { y: panel.top + panelH * 0.84, h: panelH * 0.16, color: amber },
  ];
  for (const segment of railSegments) {
    ctx.fillStyle = segment.color;
    ctx.fillRect(railX, segment.y, railW, segment.h);
  }
  ctx.restore();

  ctx.fillStyle = '#000';
  ctx.font = `700 22px "Antonio", "Avenir Next Condensed", "Arial Narrow", sans-serif`;
  ctx.fillText('INTERSTELLAR MAP', titleX, headerY + headerH * 0.48);

  const framePad = Math.max(8, panel.pad * 0.6);
  roundedRectPath(left - framePad, top - framePad, right - left + framePad * 2, bottom - top + framePad * 2, 14);
  ctx.save();
  ctx.clip();
  ctx.fillStyle = 'rgba(0, 0, 0, 0.78)';
  ctx.fillRect(left - framePad, top - framePad, right - left + framePad * 2, bottom - top + framePad * 2);
  ctx.fillStyle = colorToRgba(orange, 0.52);
  ctx.fillRect(left - framePad, top - framePad, 6, bottom - top + framePad * 2);
  ctx.restore();
  ctx.strokeStyle = colorToRgba(cream, 0.22);
  ctx.lineWidth = 1;
  ctx.stroke();
  roundedRectPath(left, top, right - left, bottom - top, 4);
  ctx.fillStyle = 'rgba(1, 5, 12, 0.96)';
  ctx.fill();
  ctx.save();
  ctx.clip();

  const backgroundStarCount = isPerformanceMode() ? 90 : 180;
  for (let i = 0; i < backgroundStarCount; i++) {
    const x = left + ((seeded(i * 19 + 3) * (right - left) + state.starChart.panX * 0.04) % (right - left));
    const y = top + ((seeded(i * 29 + 7) * (bottom - top) + state.starChart.panY * 0.04) % (bottom - top));
    const r = 0.6 + seeded(i * 17) * 1.3;
    ctx.beginPath();
    ctx.arc(x < left ? x + (right - left) : x, y < top ? y + (bottom - top) : y, r, 0, Math.PI * 2);
    ctx.fillStyle = `rgba(210, 230, 255, ${0.18 + seeded(i * 11) * 0.46})`;
      ctx.fill();
  }

  ctx.strokeStyle = 'rgba(116, 214, 255, 0.055)';
  ctx.lineWidth = 1;
  const gridStep = 86 * Math.max(0.72, scale);
  for (let x = left + ((state.starChart.panX * 0.05) % gridStep); x < right; x += gridStep) {
    ctx.beginPath();
    ctx.moveTo(x, top);
    ctx.lineTo(x, bottom);
    ctx.stroke();
  }
  for (let y = top + ((state.starChart.panY * 0.05) % gridStep); y < bottom; y += gridStep) {
    ctx.beginPath();
    ctx.moveTo(left, y);
    ctx.lineTo(right, y);
    ctx.stroke();
  }

  ctx.strokeStyle = 'rgba(116, 214, 255, 0.12)';
  ctx.lineWidth = 1;
  const center = chartToScreen({ x: 0, y: 0 });
  for (let r = 180 * scale; r < Math.max(canvas.width, canvas.height) * 1.1; r += 210 * scale) {
    ctx.beginPath();
    ctx.arc(center.x, center.y, r, 0, Math.PI * 2);
    ctx.stroke();
  }
  ctx.restore();

  ctx.strokeStyle = colorToRgba(cream, 0.24);
  ctx.lineWidth = 1;
  ctx.strokeRect(left, top, right - left, bottom - top);
  ctx.restore();
}

function drawStarChartNebulaRegions() {
  if (isPerformanceMode()) return;
  const nebula = getNebulaSprite();
  if (!nebula) return;
  const elapsed = performance.now() - finiteNumber(state.starChart.openedAt, performance.now());
  const baseFade = clamp(elapsed / 1050, 0, 1);
  const easedFade = 1 - Math.pow(1 - baseFade, 3);
  ctx.save();
  ctx.globalCompositeOperation = 'screen';
  for (let i = 0; i < state.planets.length; i++) {
    const system = ensureSystemState(i);
    if (!system.hasNebula) continue;
    const stagger = seeded(i + 52) * 0.22;
    const regionFade = clamp((easedFade - stagger) / Math.max(0.001, 1 - stagger), 0, 1);
    if (regionFade <= 0) continue;
    const p = getStarChartSystemScreen(i);
    const radius = 54 + seeded((i + 1) * 83) * 48;
    const width = radius * (2.3 + seeded(i + 32) * 0.7);
    const height = radius * (1.35 + seeded(i + 42) * 0.54);
    drawFeatheredChartNebula(
      nebula,
      p.x,
      p.y,
      width,
      height,
      seeded(i + 22) * Math.PI,
      0.46 * (1 - Math.pow(1 - regionFade, 2)),
      (i + 1) * 911,
    );
  }
  ctx.restore();
}

function drawTravelRoutes() {
  if (!state.travelRoutes.length) rebuildTravelRoutes();
  const selectedPlan = getPlottedRoute(state.currentPlanet, state.selectedPlanet);
  const selectedLegKeys = new Set((selectedPlan?.legs || []).map((route) => routeKey(route.from, route.to)));
  const selectedPlanStatus = getPlottedRouteStatus(selectedPlan);
  ctx.save();
  ctx.lineCap = 'round';
  for (const route of state.travelRoutes) {
    if (!state.planets[route.from] || !state.planets[route.to]) continue;
    const aScreen = getStarChartSystemScreen(route.from);
    const bScreen = getStarChartSystemScreen(route.to);
    const selected = selectedLegKeys.has(routeKey(route.from, route.to));
    const local = route.from === state.currentPlanet || route.to === state.currentPlanet;
    const rangeStatus = getRouteRangeStatus(route);
    ctx.beginPath();
    ctx.moveTo(aScreen.x, aScreen.y);
    ctx.lineTo(bScreen.x, bScreen.y);
    ctx.lineWidth = selected ? 4 : local ? 2.5 : 1.4;
    ctx.strokeStyle = selected
      ? (selectedPlanStatus?.canTravel ? 'rgba(255, 214, 110, 0.95)' : 'rgba(255, 112, 112, 0.95)')
      : local
        ? (rangeStatus.canTravel ? 'rgba(116, 214, 255, 0.8)' : 'rgba(255, 112, 112, 0.46)')
        : 'rgba(91, 130, 180, 0.42)';
    if (selected && selectedPlan?.legs?.length > 1) ctx.setLineDash([10, 5]);
    else if (!rangeStatus.canTravel) ctx.setLineDash([4, 7]);
    else if (route.type === 'shortcut') ctx.setLineDash([7, 7]);
    else ctx.setLineDash([]);
    ctx.stroke();
  }
  ctx.setLineDash([]);
  ctx.restore();
}

function getMapFactionTerritoryClusters() {
  if (!state.travelRoutes.length) rebuildTravelRoutes();
  const adjacencyByFaction = new Map();
  const ensureFactionMap = (faction) => {
    if (!adjacencyByFaction.has(faction)) adjacencyByFaction.set(faction, new Map());
    return adjacencyByFaction.get(faction);
  };
  const connect = (map, a, b) => {
    if (!map.has(a)) map.set(a, new Set());
    if (!map.has(b)) map.set(b, new Set());
    map.get(a).add(b);
    map.get(b).add(a);
  };

  for (const route of state.travelRoutes) {
    const fromFaction = getSystemFaction(route.from);
    const toFaction = getSystemFaction(route.to);
    if (fromFaction !== toFaction || fromFaction === 'neutral') continue;
    if (!state.planets[route.from] || !state.planets[route.to]) continue;
    connect(ensureFactionMap(fromFaction), route.from, route.to);
  }

  const clusters = [];
  for (const [faction, adjacency] of adjacencyByFaction.entries()) {
    const visited = new Set();
    for (const start of adjacency.keys()) {
      if (visited.has(start)) continue;
      const stack = [start];
      const systems = [];
      visited.add(start);
      while (stack.length) {
        const current = stack.pop();
        systems.push(current);
        for (const next of adjacency.get(current) || []) {
          if (visited.has(next)) continue;
          visited.add(next);
          stack.push(next);
        }
      }
      if (systems.length >= 2) clusters.push({ faction, systems });
    }
  }
  return clusters;
}

function getConvexHull(points) {
  const unique = [...new Map(points.map((p) => [`${Math.round(p.x * 10)}:${Math.round(p.y * 10)}`, p])).values()]
    .sort((a, b) => (a.x === b.x ? a.y - b.y : a.x - b.x));
  if (unique.length <= 2) return unique;
  const cross = (o, a, b) => (a.x - o.x) * (b.y - o.y) - (a.y - o.y) * (b.x - o.x);
  const lower = [];
  for (const point of unique) {
    while (lower.length >= 2 && cross(lower[lower.length - 2], lower[lower.length - 1], point) <= 0) lower.pop();
    lower.push(point);
  }
  const upper = [];
  for (let i = unique.length - 1; i >= 0; i--) {
    const point = unique[i];
    while (upper.length >= 2 && cross(upper[upper.length - 2], upper[upper.length - 1], point) <= 0) upper.pop();
    upper.push(point);
  }
  lower.pop();
  upper.pop();
  return lower.concat(upper);
}

function expandHullPoints(points, padding = 46) {
  if (points.length < 3) return points;
  const center = points.reduce((sum, p) => ({ x: sum.x + p.x, y: sum.y + p.y }), { x: 0, y: 0 });
  center.x /= points.length;
  center.y /= points.length;
  return points.map((point) => {
    const dx = point.x - center.x;
    const dy = point.y - center.y;
    const distance = Math.max(1, Math.hypot(dx, dy));
    return {
      x: point.x + (dx / distance) * padding,
      y: point.y + (dy / distance) * padding,
    };
  });
}

function isPointInPolygon(point, polygon) {
  if (!point || !polygon?.length) return false;
  let inside = false;
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
    const xi = polygon[i].x;
    const yi = polygon[i].y;
    const xj = polygon[j].x;
    const yj = polygon[j].y;
    const intersects = ((yi > point.y) !== (yj > point.y))
      && (point.x < ((xj - xi) * (point.y - yi)) / ((yj - yi) || 0.00001) + xi);
    if (intersects) inside = !inside;
  }
  return inside;
}

function getPointToSegmentDistance(point, start, end) {
  const dx = end.x - start.x;
  const dy = end.y - start.y;
  if (!dx && !dy) return Math.hypot(point.x - start.x, point.y - start.y);
  const t = clamp((((point.x - start.x) * dx) + ((point.y - start.y) * dy)) / ((dx * dx) + (dy * dy)), 0, 1);
  const px = start.x + dx * t;
  const py = start.y + dy * t;
  return Math.hypot(point.x - px, point.y - py);
}

function getTerritoryExclusionSystems(cluster, shape) {
  const memberSystems = new Set(cluster.systems.map((index) => Number(index)));
  const blockers = [];
  for (let i = 0; i < state.planets.length; i++) {
    if (memberSystems.has(i)) continue;
    const faction = getSystemFaction(i);
    if (faction === cluster.faction) continue;
    const point = getStarChartSystemScreen(i);
    let overlaps = false;
    if (shape.type === 'corridor') {
      overlaps = getPointToSegmentDistance(point, shape.a, shape.b) <= shape.radius;
    } else if (shape.type === 'hull') {
      overlaps = isPointInPolygon(point, shape.points);
    }
    if (overlaps) blockers.push({ index: i, point, faction });
  }
  return blockers;
}

function getMapSystemTerritoryClearance(systemIndex) {
  const size = MAP_PLANET_DRAW_SIZE;
  const current = Number(systemIndex) === Number(state.currentPlanet);
  const selected = Number(systemIndex) === Number(state.selectedPlanet);
  const nodeRadius = current ? size * 0.34 : selected ? size * 0.31 : size * 0.25;
  return nodeRadius + 3;
}

function carveTerritoryExclusion(point, radius = 14) {
  const gradient = ctx.createRadialGradient(point.x, point.y, radius * 0.12, point.x, point.y, radius);
  gradient.addColorStop(0, 'rgba(0, 0, 0, 1)');
  gradient.addColorStop(0.8, 'rgba(0, 0, 0, 0.92)');
  gradient.addColorStop(1, 'rgba(0, 0, 0, 0)');
  ctx.save();
  ctx.globalCompositeOperation = 'destination-out';
  ctx.fillStyle = gradient;
  ctx.beginPath();
  ctx.arc(point.x, point.y, radius, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();
}

function getPointClusterCenter(points) {
  if (!points.length) return { x: 0, y: 0 };
  return points.reduce((sum, point) => ({
    x: sum.x + point.x / points.length,
    y: sum.y + point.y / points.length,
  }), { x: 0, y: 0 });
}

function getPointClusterSpan(points) {
  if (!points.length) return 0;
  const xs = points.map((point) => point.x);
  const ys = points.map((point) => point.y);
  return Math.max(Math.max(...xs) - Math.min(...xs), Math.max(...ys) - Math.min(...ys));
}

function drawFactionEmblemPhotoOverlay(img, x, y, size, alpha = 0.4) {
  if (!img?.complete || img.naturalWidth <= 0) return false;
  const aspect = img.naturalWidth / Math.max(1, img.naturalHeight);
  const drawW = aspect >= 1 ? size : size * aspect;
  const drawH = aspect >= 1 ? size / aspect : size;
  ctx.save();
  ctx.translate(x, y);
  ctx.globalAlpha = alpha;
  ctx.shadowColor = 'rgba(0, 0, 0, 0.45)';
  ctx.shadowBlur = size * 0.08;
  ctx.drawImage(img, -drawW / 2, -drawH / 2, drawW, drawH);
  ctx.restore();
  return true;
}

function drawMapFactionEmblem(faction, x, y, size, profile, allControlled = false) {
  const s = Math.max(24, size);
  const primary = profile.primary;
  const secondary = profile.secondary;
  const emblem = getFactionEmblemSprite(faction);
  if (emblem && drawFactionEmblemPhotoOverlay(emblem, x, y, s, allControlled ? 0.42 : 0.3)) return;

  ctx.save();
  ctx.translate(x, y);
  ctx.globalAlpha = allControlled ? 0.48 : 0.34;
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  ctx.shadowColor = colorToRgba(primary, 0.5);
  ctx.shadowBlur = s * 0.14;
  ctx.strokeStyle = colorToRgba(primary, 0.84);
  ctx.fillStyle = colorToRgba(primary, 0.16);
  ctx.lineWidth = Math.max(1.5, s * 0.035);

  if (faction === 'terran') {
    ctx.beginPath();
    ctx.arc(0, 0, s * 0.28, 0, Math.PI * 2);
    ctx.stroke();
    ctx.beginPath();
    ctx.arc(-s * 0.08, -s * 0.04, s * 0.1, Math.PI * 0.9, Math.PI * 2.15);
    ctx.arc(s * 0.09, s * 0.05, s * 0.12, Math.PI * 1.12, Math.PI * 0.12, true);
    ctx.strokeStyle = colorToRgba(secondary, 0.58);
    ctx.stroke();
    ctx.rotate(-0.72);
    ctx.strokeStyle = colorToRgba(primary, 0.92);
    ctx.lineWidth = Math.max(2, s * 0.06);
    ctx.beginPath();
    ctx.moveTo(-s * 0.46, 0);
    ctx.lineTo(s * 0.34, 0);
    ctx.stroke();
    ctx.fillStyle = colorToRgba(primary, 0.8);
    ctx.beginPath();
    ctx.moveTo(s * 0.48, 0);
    ctx.lineTo(s * 0.29, -s * 0.1);
    ctx.lineTo(s * 0.31, s * 0.1);
    ctx.closePath();
    ctx.fill();
    ctx.strokeStyle = colorToRgba(secondary, 0.72);
    ctx.lineWidth = Math.max(1.4, s * 0.032);
    ctx.beginPath();
    ctx.moveTo(-s * 0.1, -s * 0.17);
    ctx.lineTo(s * 0.1, s * 0.17);
    ctx.stroke();
  } else if (faction === 'klingon') {
    ctx.strokeStyle = colorToRgba(primary, 0.92);
    ctx.lineWidth = Math.max(2, s * 0.055);
    for (const angle of [-Math.PI / 2, Math.PI * 0.17, Math.PI * 0.83]) {
      ctx.save();
      ctx.rotate(angle);
      ctx.beginPath();
      ctx.moveTo(0, -s * 0.1);
      ctx.lineTo(0, -s * 0.42);
      ctx.lineTo(s * 0.08, -s * 0.3);
      ctx.stroke();
      ctx.restore();
    }
    ctx.strokeStyle = colorToRgba(secondary, 0.78);
    ctx.lineWidth = Math.max(1.3, s * 0.028);
    ctx.beginPath();
    ctx.arc(0, 0, s * 0.2, 0, Math.PI * 2);
    ctx.stroke();
  } else if (faction === 'romulan') {
    ctx.strokeStyle = colorToRgba(primary, 0.92);
    ctx.lineWidth = Math.max(1.6, s * 0.04);
    ctx.beginPath();
    ctx.moveTo(-s * 0.42, s * 0.05);
    ctx.quadraticCurveTo(-s * 0.16, -s * 0.34, 0, -s * 0.08);
    ctx.quadraticCurveTo(s * 0.16, -s * 0.34, s * 0.42, s * 0.05);
    ctx.moveTo(-s * 0.34, s * 0.12);
    ctx.quadraticCurveTo(-s * 0.08, s * 0.3, 0, s * 0.08);
    ctx.quadraticCurveTo(s * 0.08, s * 0.3, s * 0.34, s * 0.12);
    ctx.stroke();
  } else if (faction === 'cardassian') {
    ctx.strokeStyle = colorToRgba(primary, 0.92);
    ctx.lineWidth = Math.max(1.8, s * 0.043);
    ctx.beginPath();
    ctx.moveTo(0, -s * 0.43);
    ctx.lineTo(s * 0.34, -s * 0.06);
    ctx.lineTo(s * 0.17, s * 0.36);
    ctx.lineTo(-s * 0.17, s * 0.36);
    ctx.lineTo(-s * 0.34, -s * 0.06);
    ctx.closePath();
    ctx.stroke();
    ctx.strokeStyle = colorToRgba(secondary, 0.72);
    ctx.beginPath();
    ctx.arc(0, s * 0.02, s * 0.14, 0, Math.PI * 2);
    ctx.stroke();
  } else if (faction === 'dominion') {
    ctx.strokeStyle = colorToRgba(primary, 0.94);
    ctx.lineWidth = Math.max(1.6, s * 0.04);
    for (let i = 0; i < 6; i++) {
      ctx.save();
      ctx.rotate((Math.PI * 2 * i) / 6);
      ctx.beginPath();
      ctx.moveTo(0, -s * 0.1);
      ctx.quadraticCurveTo(s * 0.12, -s * 0.28, 0, -s * 0.44);
      ctx.quadraticCurveTo(-s * 0.12, -s * 0.28, 0, -s * 0.1);
      ctx.stroke();
      ctx.restore();
    }
    ctx.strokeStyle = colorToRgba(secondary, 0.74);
    ctx.beginPath();
    ctx.arc(0, 0, s * 0.12, 0, Math.PI * 2);
    ctx.stroke();
  } else {
    ctx.strokeStyle = colorToRgba(primary, 0.86);
    ctx.lineWidth = Math.max(1.8, s * 0.04);
    ctx.beginPath();
    ctx.arc(0, 0, s * 0.28, 0, Math.PI * 2);
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(-s * 0.34, 0);
    ctx.lineTo(s * 0.34, 0);
    ctx.moveTo(0, -s * 0.34);
    ctx.lineTo(0, s * 0.34);
    ctx.stroke();
  }

  ctx.restore();
}

function drawSmoothClosedShape(points) {
  if (points.length < 3) return;
  ctx.beginPath();
  for (let i = 0; i < points.length; i++) {
    const current = points[i];
    const next = points[(i + 1) % points.length];
    const midX = (current.x + next.x) / 2;
    const midY = (current.y + next.y) / 2;
    if (i === 0) ctx.moveTo(midX, midY);
    else ctx.quadraticCurveTo(current.x, current.y, midX, midY);
  }
  const first = points[0];
  const firstNext = points[1];
  ctx.quadraticCurveTo(first.x, first.y, (first.x + firstNext.x) / 2, (first.y + firstNext.y) / 2);
  ctx.closePath();
}

function drawMapFactionTerritories() {
  if (!state.travelRoutes.length) rebuildTravelRoutes();
  ctx.save();
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  ctx.globalCompositeOperation = 'screen';

  for (const cluster of getMapFactionTerritoryClusters()) {
    const profile = getMapFactionProfile(cluster.faction);
    const points = cluster.systems.map((index) => getStarChartSystemScreen(index));
    const allControlled = cluster.systems.every((index) => state.controlledSystems.includes(Number(index)));
    ctx.setLineDash([]);
    if (points.length === 2) {
      const corridorRadius = allControlled ? 42 : 32;
      ctx.beginPath();
      ctx.moveTo(points[0].x, points[0].y);
      ctx.lineTo(points[1].x, points[1].y);
      ctx.strokeStyle = colorToRgba(profile.primary, allControlled ? 0.2 : 0.12);
      ctx.lineWidth = allControlled ? 76 : 56;
      ctx.stroke();
      ctx.beginPath();
      ctx.moveTo(points[0].x, points[0].y);
      ctx.lineTo(points[1].x, points[1].y);
      ctx.strokeStyle = colorToRgba(profile.secondary, allControlled ? 0.13 : 0.08);
      ctx.lineWidth = allControlled ? 42 : 30;
      ctx.stroke();
      for (const blocker of getTerritoryExclusionSystems(cluster, {
        type: 'corridor',
        a: points[0],
        b: points[1],
        radius: corridorRadius,
      })) {
        carveTerritoryExclusion(blocker.point, getMapSystemTerritoryClearance(blocker.index));
      }
      drawMapFactionEmblem(
        cluster.faction,
        (points[0].x + points[1].x) / 2,
        (points[0].y + points[1].y) / 2,
        clamp(Math.hypot(points[1].x - points[0].x, points[1].y - points[0].y) * 0.16, 28, 58),
        profile,
        allControlled,
      );
      continue;
    }

    const hull = expandHullPoints(getConvexHull(points), allControlled ? 58 : 44);
    if (hull.length < 3) continue;
    drawSmoothClosedShape(hull);
    ctx.fillStyle = colorToRgba(profile.primary, allControlled ? 0.18 : 0.1);
    ctx.fill();
    drawSmoothClosedShape(expandHullPoints(getConvexHull(points), allControlled ? 34 : 25));
    ctx.fillStyle = colorToRgba(profile.secondary, allControlled ? 0.08 : 0.045);
    ctx.fill();
    for (const blocker of getTerritoryExclusionSystems(cluster, { type: 'hull', points: hull })) {
      carveTerritoryExclusion(blocker.point, getMapSystemTerritoryClearance(blocker.index));
    }

    const emblemCenter = getPointClusterCenter(points);
    drawMapFactionEmblem(
      cluster.faction,
      emblemCenter.x,
      emblemCenter.y,
      clamp(getPointClusterSpan(points) * 0.18, 34, 84),
      profile,
      allControlled,
    );
  }

  ctx.restore();
}

function drawMapLegend() {
  const p = state.planets[state.currentPlanet];
  const target = state.planets[state.selectedPlanet];
  const systemInfo = getMapSystemInfo(state.selectedPlanet);
  const plan = getPlottedRoute(state.currentPlanet, state.selectedPlanet);
  const rangeStatus = plan ? getPlottedRouteStatus(plan) : null;
  const legText = plan?.legs?.length ? `${plan.legs.length} leg${plan.legs.length === 1 ? '' : 's'}` : 'No route';
  const cost = plan?.legs?.length
    ? rangeStatus.canTravel
      ? `${legText} | Range ${rangeStatus.distance}/${rangeStatus.shipRange} | Cost ${plan.antimatter} antimatter`
      : !rangeStatus.hasShipRange
        ? `Out of ship range: ${rangeStatus.distance}/${rangeStatus.shipRange}`
        : `Need ${plan.antimatter} antimatter | Current covers ${rangeStatus.fuelRange}`
    : 'No plotted route';
  const boxX = 54;
  const boxY = 76;
  const boxW = Math.min(740, Math.max(320, canvas.width - 108));
  const boxH = 68;
  ctx.save();
  ctx.fillStyle = 'rgba(4, 10, 20, 0.82)';
  ctx.fillRect(boxX, boxY, boxW, boxH);
  ctx.strokeStyle = plan?.legs?.length ? (rangeStatus?.canTravel ? '#ffd66e' : '#ff7070') : '#6f88ad';
  ctx.strokeRect(boxX, boxY, boxW, boxH);
  ctx.fillStyle = '#dfeaff';
  ctx.font = canvasUiFont(13);
  drawFittedMapText(`Current: ${p?.name || 'Unknown'}    Target: ${target?.name || 'None'}`, boxX + 14, boxY + 20, boxW - 28);
  ctx.fillStyle = getMapFactionColor(systemInfo.faction);
  ctx.font = canvasUiFont(12, 'bold');
  drawFittedMapText(
    `${systemInfo.relation} | Power ${systemInfo.power} | Stations ${systemInfo.stations} | Patrols ${systemInfo.patrols} | Fleet ${systemInfo.fleet} | ${systemInfo.visited ? 'Visited' : 'Unvisited'}`,
    boxX + 14,
    boxY + 39,
    boxW - 28,
  );
  ctx.fillStyle = plan?.legs?.length ? (rangeStatus?.canTravel ? '#ffd66e' : '#ffb0b0') : '#9fb2d0';
  ctx.font = canvasUiFont(12);
  drawFittedMapText(`${cost}    First click plots | Second click warps`, boxX + 14, boxY + 57, boxW - 28);
  ctx.restore();
}

function drawMapSystemNode(p, i, size) {
  const screen = getStarChartSystemScreen(i);
  const system = ensureSystemState(i);
  const selected = i === state.selectedPlanet;
  const current = i === state.currentPlanet;
  const visited = state.visitedSystems.includes(Number(i)) || current;
  const profile = getMapFactionProfile(getSystemFaction(i));
  const radius = current ? size * 0.34 : selected ? size * 0.31 : size * 0.25;

  ctx.save();
  ctx.beginPath();
  ctx.arc(screen.x, screen.y, radius, 0, Math.PI * 2);
  ctx.fillStyle = visited ? colorToRgba(profile.primary, current ? 0.95 : 0.58) : 'rgba(3, 8, 16, 0.88)';
  ctx.fill();

  ctx.strokeStyle = colorToRgba(profile.primary, 0.96);
  ctx.lineWidth = current ? 2.8 : 1.6;
  ctx.stroke();

  if (selected && !current) {
    ctx.strokeStyle = '#ffd66e';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(screen.x - radius - 8, screen.y - radius - 8);
    ctx.lineTo(screen.x - radius - 2, screen.y - radius - 2);
    ctx.moveTo(screen.x + radius + 8, screen.y + radius + 8);
    ctx.lineTo(screen.x + radius + 2, screen.y + radius + 2);
    ctx.stroke();
  }

  if (system.hasNebula) {
    ctx.fillStyle = 'rgba(216, 196, 255, 0.78)';
    ctx.beginPath();
    ctx.arc(screen.x + radius * 0.72, screen.y - radius * 0.72, 2.4, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.restore();
}

function drawPlanetMarker(p, i) {
  const size = state.mapOpen ? MAP_PLANET_DRAW_SIZE : (p.drawSize || getPlanetVisualSize(p));
  const radius = size * 0.42;
  if (state.mapOpen) {
    drawMapSystemNode(p, i, size);
    const routeNeighbor = hasTravelRoute(state.currentPlanet, i);
    const selectedPlan = getPlottedRoute(state.currentPlanet, state.selectedPlanet);
    const inSelectedPlan = selectedPlan?.systems?.includes(i);
    if (i === state.currentPlanet || i === state.selectedPlanet || routeNeighbor || inSelectedPlan) {
      const screen = getStarChartSystemScreen(i);
      ctx.fillStyle = i === state.selectedPlanet ? '#ffd66e' : '#dfeaff';
      ctx.font = canvasUiFont(11);
      ctx.textAlign = 'center';
      const label = p.name.length > 14 ? `${p.name.slice(0, 13)}.` : p.name;
      ctx.fillText(label, screen.x, screen.y - size / 2 - 8);
      ctx.textAlign = 'start';
    }
    return;
  }
  drawPlanetRings(p, p.x, p.y, size, 0.36, 'back');
  const pImg = getPlanetModelSprite(p);
  drawPlanetOcclusionDisk(p, p.x, p.y, size);
  if (!drawSpinningPlanetSprite(pImg, p, p.x, p.y, size)) {
    ctx.beginPath();
    ctx.arc(p.x, p.y, radius, 0, Math.PI * 2);
    ctx.fillStyle = p.color;
    ctx.fill();
  }
  drawPlanetInnerEdgeShadow(p, p.x, p.y, size);
  drawPlanetRings(p, p.x, p.y, size, 0.82, 'front');
}

function getAnimatedSystemBodyPosition(body, now = performance.now()) {
  return body;
}

function drawDecorativeSystemBody(body, now = performance.now()) {
  const screen = worldToScreen(body);
  const size = finiteNumber(body.drawSize, body.kind === 'moon' ? 26 : 72);
  const radius = size * 0.42;
  if (screen.x < -size || screen.x > canvas.width + size || screen.y < -size || screen.y > canvas.height + size) return;

  ctx.save();

  drawPlanetRings(body, screen.x, screen.y, size, 0.24, 'back');
  const img = getPlanetModelSprite(body);
  if (img?.complete && img.naturalWidth > 0) {
    drawPlanetOcclusionDisk(body, screen.x, screen.y, size);
    ctx.globalAlpha = 1;
    drawSpinningPlanetSprite(img, body, screen.x, screen.y, size, now);
    drawPlanetInnerEdgeShadow(body, screen.x, screen.y, size);
  } else {
    const grad = ctx.createRadialGradient(screen.x - radius * 0.28, screen.y - radius * 0.32, 2, screen.x, screen.y, radius);
    grad.addColorStop(0, body.kind === 'moon' ? 'rgba(230, 236, 246, 0.92)' : 'rgba(255, 255, 255, 0.82)');
    grad.addColorStop(0.5, body.color || 'rgba(120, 150, 190, 0.9)');
    grad.addColorStop(1, 'rgba(20, 28, 42, 0.96)');
    ctx.fillStyle = grad;
    ctx.beginPath();
    ctx.arc(screen.x, screen.y, radius, 0, Math.PI * 2);
    ctx.fill();
    drawPlanetInnerEdgeShadow(body, screen.x, screen.y, size);
  }
  ctx.globalAlpha = 1;
  drawPlanetRings(body, screen.x, screen.y, size, 0.68, 'front');
  ctx.restore();
}

function drawDecorativeSystemBodies(now = performance.now()) {
  if (isPerformanceMode()) return;
  for (const body of state.systemBodies || []) drawDecorativeSystemBody(body, now);
}

function drawPlanetCallout(marker, now = performance.now()) {
  const callout = state.planetCallout;
  if (!callout || callout.index !== state.currentPlanet) return;
  const age = now - callout.born;
  if (age > callout.ttl) {
    state.planetCallout = null;
    return;
  }

  const size = marker.drawSize || getPlanetVisualSize(marker);
  const radius = size * 0.42;
  const direction = marker.x < canvas.width * 0.68 ? 1 : -1;
  const startX = marker.x + direction * radius * 0.76;
  const startY = marker.y - radius * 0.28;
  const elbowX = startX + direction * 54;
  const elbowY = startY - 38;
  const endX = elbowX + direction * 112;
  const alpha = Math.min(1, age / 160) * Math.min(1, (callout.ttl - age) / 500);
  const text = marker.name || 'Planet';

  ctx.save();
  ctx.globalAlpha = alpha;
  ctx.strokeStyle = 'rgba(255, 214, 110, 0.92)';
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(startX, startY);
  ctx.lineTo(elbowX, elbowY);
  ctx.lineTo(endX, elbowY);
  ctx.stroke();

  ctx.fillStyle = '#ffd66e';
  ctx.font = canvasUiFont(14, 'bold');
  ctx.textAlign = direction > 0 ? 'left' : 'right';
  ctx.textBaseline = 'middle';
  ctx.fillText(text, endX + direction * 8, elbowY);
  ctx.restore();
}

function drawWorldPops(now = performance.now()) {
  state.worldPops = state.worldPops.filter((pop) => now - pop.born < pop.ttl);
  for (const pop of state.worldPops) {
    const age = now - pop.born;
    const t = age / pop.ttl;
    const y = pop.y - t * 22;
    const alpha = Math.max(0, 1 - t);
    ctx.save();
    ctx.globalAlpha = alpha;
    ctx.font = canvasUiFont(15, 'bold');
    ctx.textAlign = 'center';
    const width = ctx.measureText(pop.text).width + 18;
    ctx.fillStyle = 'rgba(4, 10, 20, 0.82)';
    ctx.fillRect(pop.x - width / 2, y - 20, width, 24);
    ctx.strokeStyle = pop.color;
    ctx.lineWidth = 1;
    ctx.strokeRect(pop.x - width / 2, y - 20, width, 24);
    ctx.fillStyle = pop.color;
    ctx.fillText(pop.text, pop.x, y - 4);
    ctx.restore();
  }
}

function drawWeaponEffects(now = performance.now(), layer = 'all') {
  state.weaponEffects = state.weaponEffects.filter((effect) => now - effect.born < effect.ttl);
  const effectAlphaScale = isReducedEffectsMode() ? 0.62 : 1;
  ctx.save();
  ctx.lineCap = 'round';
  ctx.globalCompositeOperation = 'screen';
  for (const effect of state.weaponEffects) {
    if (layer === 'under' && effect.kind === 'explosion') continue;
    if (layer === 'over' && effect.kind !== 'explosion') continue;
    const age = now - effect.born;
    const t = clamp(age / effect.ttl, 0, 1);
    const alpha = Math.max(0, 1 - t) * effectAlphaScale;
    ctx.globalAlpha = alpha;
    if (effect.kind === 'beam') {
      const from = worldToScreen(effect.from);
      const to = worldToScreen(effect.to);
      const beamSprite = getWeaponSprite(effect.weaponId ? getWeaponSpriteFile(getWeapon(effect.weaponId)) : 'phaser.png');
      const dx = to.x - from.x;
      const dy = to.y - from.y;
      const length = Math.hypot(dx, dy);
      const angle = Math.atan2(dy, dx);
      const beamAlpha = alpha * finiteNumber(effect.alphaScale, 1);
      ctx.strokeStyle = effect.color || '#ff9a3d';
      ctx.lineWidth = (effect.width || 3) * 3.4;
      ctx.globalAlpha = beamAlpha * 0.26;
      ctx.beginPath();
      ctx.moveTo(from.x, from.y);
      ctx.lineTo(to.x, to.y);
      ctx.stroke();
      if (beamSprite?.complete && beamSprite.naturalWidth > 0 && length > 0) {
        ctx.save();
        ctx.globalCompositeOperation = 'source-over';
        ctx.globalAlpha = beamAlpha;
        ctx.translate(from.x, from.y);
        ctx.rotate(angle);
        ctx.imageSmoothingEnabled = true;
        drawBeamSprite(
          beamSprite,
          length,
          Math.max(5, (effect.width || 3) * 1.7),
          effect.color || '#ff9a3d',
        );
        ctx.restore();
      } else {
        ctx.globalAlpha = beamAlpha;
        ctx.lineWidth = effect.width || 3;
        ctx.beginPath();
        ctx.moveTo(from.x, from.y);
        ctx.lineTo(to.x, to.y);
        ctx.stroke();
      }
    } else if (effect.kind === 'burst') {
      const p = worldToScreen(effect);
      const radius = (effect.radius || 48) * (0.35 + t * 0.9);
      ctx.strokeStyle = effect.color || '#ffffff';
      ctx.lineWidth = 2.5;
      ctx.beginPath();
      ctx.arc(p.x, p.y, radius, 0, Math.PI * 2);
      ctx.stroke();
      ctx.globalAlpha = alpha * 0.25;
      ctx.fillStyle = effect.color || '#ffffff';
      ctx.beginPath();
      ctx.arc(p.x, p.y, radius * 0.55, 0, Math.PI * 2);
      ctx.fill();
    } else if (effect.kind === 'engine-disruptor-wave') {
      const p = worldToScreen(effect);
      const maxRadius = effect.radius || 760;
      const radius = maxRadius * (0.06 + t * 0.94);
      const color = effect.color || ENGINE_DISRUPTOR_COLOR;
      const pulse = Math.sin(t * Math.PI);
      const waveGradient = ctx.createRadialGradient(p.x, p.y, Math.max(1, radius * 0.72), p.x, p.y, radius);
      waveGradient.addColorStop(0, colorToRgba(color, 0));
      waveGradient.addColorStop(0.52, colorToRgba(color, 0.04 + pulse * 0.1));
      waveGradient.addColorStop(0.82, colorToRgba(color, 0.34 + pulse * 0.28));
      waveGradient.addColorStop(1, colorToRgba(color, 0));
      ctx.globalAlpha = alpha * 0.95;
      ctx.fillStyle = waveGradient;
      ctx.beginPath();
      ctx.arc(p.x, p.y, radius, 0, Math.PI * 2);
      ctx.fill();
      const rippleCount = isReducedEffectsMode() ? 1 : 3;
      for (let i = 1; i <= rippleCount; i += 1) {
        const rippleRadius = radius * (1 - i * 0.18);
        if (rippleRadius <= 12) continue;
        ctx.lineWidth = 1.1;
        ctx.globalAlpha = alpha * (0.16 + pulse * 0.08) * (1 - i / (rippleCount + 1));
        ctx.strokeStyle = colorToRgba(color, 0.78);
        ctx.beginPath();
        ctx.arc(p.x, p.y, rippleRadius, 0, Math.PI * 2);
        ctx.stroke();
      }
    } else if (effect.kind === 'thaleron-cloud') {
      const p = worldToScreen(effect);
      const maxRadius = effect.radius || 980;
      const radius = maxRadius * (0.08 + t * 0.92);
      const color = effect.color || THALERON_CLOUD_COLOR;
      const bloom = Math.sin(t * Math.PI);
      const cloudGradient = ctx.createRadialGradient(p.x, p.y, radius * 0.08, p.x, p.y, radius);
      cloudGradient.addColorStop(0, colorToRgba('#d8ffd0', 0.26 + bloom * 0.2));
      cloudGradient.addColorStop(0.24, colorToRgba(color, 0.2 + bloom * 0.22));
      cloudGradient.addColorStop(0.58, colorToRgba('#45ff5e', 0.14 + bloom * 0.18));
      cloudGradient.addColorStop(1, colorToRgba(color, 0));
      ctx.globalAlpha = alpha * 0.95;
      ctx.fillStyle = cloudGradient;
      ctx.beginPath();
      ctx.arc(p.x, p.y, radius, 0, Math.PI * 2);
      ctx.fill();

      const cellCount = isReducedEffectsMode() ? 7 : 15;
      for (let i = 0; i < cellCount; i += 1) {
        const seed = (effect.born || 1) * 0.017 + i * 19.31;
        const angle = seeded(seed) * Math.PI * 2;
        const ring = 0.2 + seeded(seed + 3) * 0.72;
        const wobble = Math.sin(now * 0.001 + i * 1.7) * radius * 0.025;
        const cx = p.x + Math.cos(angle) * radius * ring + wobble;
        const cy = p.y + Math.sin(angle) * radius * ring - wobble * 0.4;
        const blobRadius = radius * (0.09 + seeded(seed + 7) * 0.13);
        const blob = ctx.createRadialGradient(cx, cy, 0, cx, cy, blobRadius);
        blob.addColorStop(0, colorToRgba('#baff94', 0.34));
        blob.addColorStop(0.48, colorToRgba(color, 0.16));
        blob.addColorStop(1, colorToRgba(color, 0));
        ctx.globalAlpha = alpha * (0.42 + bloom * 0.2);
        ctx.fillStyle = blob;
        ctx.beginPath();
        ctx.arc(cx, cy, blobRadius, 0, Math.PI * 2);
        ctx.fill();
      }

    } else if (effect.kind === 'cloak-ripple') {
      const p = worldToScreen(effect);
      const radius = (effect.radius || 54) * (0.72 + t * 0.7);
      ctx.strokeStyle = effect.color || '#9fb2d0';
      ctx.lineWidth = 2;
      ctx.setLineDash([4, 6]);
      ctx.beginPath();
      ctx.ellipse(p.x, p.y, radius * 1.25, radius * 0.72, now * 0.002, 0, Math.PI * 2);
      ctx.stroke();
      ctx.setLineDash([]);
    } else if (effect.kind === 'explosion') {
      const p = effect.trackPlayer
        ? { x: state.ship.x + (effect.screenOffsetX || 0), y: state.ship.y + (effect.screenOffsetY || 0) }
        : worldToScreen(effect);
      const radius = (effect.radius || 42) * (0.42 + t * 0.95);
      const explosionSprite = sprites.explosions;
      if (explosionSprite?.complete && explosionSprite.naturalWidth > 0) {
        const cols = 4;
        const rows = 4;
        const index = Math.abs(Math.round(finiteNumber(effect.spriteIndex, 0))) % (cols * rows);
        const cellW = explosionSprite.naturalWidth / cols;
        const cellH = explosionSprite.naturalHeight / rows;
        const sx = (index % cols) * cellW;
        const sy = Math.floor(index / cols) * cellH;
        const drawSize = (effect.radius || 42) * (2.15 + t * 1.55);
        ctx.save();
        ctx.translate(p.x, p.y);
        ctx.rotate((seeded(index + 33) - 0.5) * 0.55);
        ctx.globalCompositeOperation = 'screen';
        ctx.globalAlpha = alpha * (0.92 - t * 0.16);
        ctx.imageSmoothingEnabled = true;
        ctx.imageSmoothingQuality = 'high';
        ctx.drawImage(explosionSprite, sx, sy, cellW, cellH, -drawSize / 2, -drawSize / 2, drawSize, drawSize);
        ctx.restore();
        ctx.lineWidth = 1.8;
        for (const spark of effect.sparks || []) {
          const travel = (effect.radius || 42) * spark.speed * (0.35 + t * 1.15);
          const sx2 = p.x + Math.cos(spark.angle) * travel;
          const sy2 = p.y + Math.sin(spark.angle) * travel;
          ctx.globalAlpha = alpha * 0.48;
          ctx.strokeStyle = spark.color || '#ffcf73';
          ctx.beginPath();
          ctx.moveTo(sx2, sy2);
          ctx.lineTo(
            sx2 + Math.cos(spark.angle) * spark.length * (1 - t * 0.55),
            sy2 + Math.sin(spark.angle) * spark.length * (1 - t * 0.55),
          );
          ctx.stroke();
        }
        continue;
      }
      const coreRadius = radius * Math.max(0.18, 0.48 - t * 0.22);
      const pulse = Math.sin(t * Math.PI);
      const gradient = ctx.createRadialGradient(p.x, p.y, 0, p.x, p.y, radius);
      gradient.addColorStop(0, effect.coreColor || '#fff3b0');
      gradient.addColorStop(0.24, effect.color || '#ff9c55');
      gradient.addColorStop(0.62, 'rgba(255, 82, 42, 0.56)');
      gradient.addColorStop(1, 'rgba(70, 34, 24, 0)');
      ctx.globalAlpha = alpha * 0.82;
      ctx.fillStyle = gradient;
      ctx.beginPath();
      ctx.arc(p.x, p.y, radius, 0, Math.PI * 2);
      ctx.fill();
      ctx.globalAlpha = alpha * 0.95;
      ctx.fillStyle = effect.coreColor || '#fff3b0';
      ctx.beginPath();
      ctx.arc(p.x, p.y, coreRadius * (0.8 + pulse * 0.3), 0, Math.PI * 2);
      ctx.fill();
      ctx.lineWidth = 2;
      for (const spark of effect.sparks || []) {
        const travel = (effect.radius || 42) * spark.speed * (0.28 + t * 0.95);
        const sx = p.x + Math.cos(spark.angle) * travel;
        const sy = p.y + Math.sin(spark.angle) * travel;
        ctx.globalAlpha = alpha * 0.78;
        ctx.strokeStyle = spark.color || '#ffcf73';
        ctx.beginPath();
        ctx.moveTo(sx, sy);
        ctx.lineTo(
          sx + Math.cos(spark.angle) * spark.length * (1 - t * 0.45),
          sy + Math.sin(spark.angle) * spark.length * (1 - t * 0.45),
        );
        ctx.stroke();
      }
    }
  }
  ctx.restore();
}

function drawActiveTractorBeams(now = performance.now()) {
  const beams = (state.tractorBeams || []).filter((beam) => finiteNumber(beam.expiresAt, 0) > now);
  if (!beams.length) return;
  const tractorSettings = getTractorBeamItemSettings();
  const holdMs = Math.max(1, finiteNumber(tractorSettings.holdMs, TRACTOR_BEAM_HOLD_MS));
  const sourceBase = finiteNumber(tractorSettings.sourceHalfWidth, TRACTOR_BEAM_SOURCE_HALF_WIDTH);
  const targetBase = finiteNumber(tractorSettings.targetHalfWidth, TRACTOR_BEAM_TARGET_HALF_WIDTH);
  ctx.save();
  ctx.globalCompositeOperation = 'screen';
  ctx.lineCap = 'round';
  for (const beam of beams) {
    const target = beam.targetType === 'ship'
      ? state.npcShips.find((npc) => npc.id === beam.targetId && !npc.destroyed)
      : null;
    if (!target) continue;
    const fromWorld = beam.owner === 'player'
      ? getTractorEmitterPoint(target)
      : { x: finiteNumber(beam.x, target.x), y: finiteNumber(beam.y, target.y) };
    const impact = getWeaponImpactPoint(target, fromWorld, 'ship');
    const from = worldToScreen(fromWorld);
    const to = worldToScreen(impact);
    const dx = to.x - from.x;
    const dy = to.y - from.y;
    const length = Math.hypot(dx, dy);
    if (length <= 1) continue;
    const px = -dy / length;
    const py = dx / length;
    const color = beam.color || TRACTOR_BEAM_COLOR;
    const age = now - finiteNumber(beam.startedAt, now);
    const remaining = clamp((finiteNumber(beam.expiresAt, now) - now) / holdMs, 0, 1);
    const fade = clamp(remaining * 1.7, 0, 1);
    const pulse = 0.55 + Math.sin(age * 0.018) * 0.22;
    const targetRadius = getShipScreenRadius(target.shipId, target.scale || 1);
    const sourceHalf = sourceBase + pulse * 1.2;
    const targetHalf = clamp(
      targetRadius * 0.42 + pulse * 4,
      targetBase * 0.72,
      targetBase * 1.9,
    );

    ctx.shadowColor = color;
    ctx.shadowBlur = isReducedEffectsMode() ? 0 : 16;
    ctx.globalAlpha = 0.24 * fade;
    const coneGradient = ctx.createLinearGradient(from.x, from.y, to.x, to.y);
    coneGradient.addColorStop(0, colorToRgba(color, 0.1));
    coneGradient.addColorStop(0.52, colorToRgba(color, 0.26));
    coneGradient.addColorStop(0.78, colorToRgba(color, 0.28));
    coneGradient.addColorStop(1, colorToRgba(color, 0));
    ctx.fillStyle = coneGradient;
    ctx.beginPath();
    ctx.moveTo(from.x + px * sourceHalf, from.y + py * sourceHalf);
    ctx.lineTo(to.x + px * targetHalf, to.y + py * targetHalf);
    ctx.lineTo(to.x - px * targetHalf, to.y - py * targetHalf);
    ctx.lineTo(from.x - px * sourceHalf, from.y - py * sourceHalf);
    ctx.closePath();
    ctx.fill();

    ctx.globalAlpha = fade * 0.82;
    const edgeGradient = ctx.createLinearGradient(from.x, from.y, to.x, to.y);
    edgeGradient.addColorStop(0, colorToRgba(color, 0.72));
    edgeGradient.addColorStop(0.76, colorToRgba(color, 0.68));
    edgeGradient.addColorStop(1, colorToRgba(color, 0));
    ctx.strokeStyle = edgeGradient;
    ctx.lineWidth = 1.3;
    ctx.beginPath();
    ctx.moveTo(from.x + px * sourceHalf, from.y + py * sourceHalf);
    ctx.lineTo(to.x + px * targetHalf, to.y + py * targetHalf);
    ctx.moveTo(from.x - px * sourceHalf, from.y - py * sourceHalf);
    ctx.lineTo(to.x - px * targetHalf, to.y - py * targetHalf);
    ctx.stroke();

    const strands = isReducedEffectsMode() ? [-0.5, 0.5] : [-0.78, -0.36, 0, 0.36, 0.78];
    strands.forEach((strand, index) => {
      const sourceOffset = sourceHalf * strand;
      const targetOffset = targetHalf * strand + Math.sin(age * 0.018 + index * 1.9) * 2.2;
      ctx.globalAlpha = fade * (strand === 0 ? 0.92 : 0.48 + pulse * 0.18);
      const strandGradient = ctx.createLinearGradient(from.x, from.y, to.x, to.y);
      const strandColor = strand === 0 ? '#d7fbff' : color;
      strandGradient.addColorStop(0, colorToRgba(strandColor, strand === 0 ? 0.86 : 0.62));
      strandGradient.addColorStop(0.7, colorToRgba(strandColor, strand === 0 ? 0.96 : 0.72));
      strandGradient.addColorStop(1, colorToRgba(strandColor, 0));
      ctx.strokeStyle = strandGradient;
      ctx.lineWidth = strand === 0 ? 2.2 : 1.1;
      ctx.beginPath();
      ctx.moveTo(from.x + px * sourceOffset, from.y + py * sourceOffset);
      ctx.lineTo(to.x + px * targetOffset, to.y + py * targetOffset);
      ctx.stroke();
    });

    const beadCount = isReducedEffectsMode() ? 2 : 4;
    for (let i = 0; i < beadCount; i += 1) {
      const beadT = ((age * 0.00072 + i / beadCount) % 1);
      const halfAtBead = sourceHalf + (targetHalf - sourceHalf) * beadT;
      const lateral = Math.sin(age * 0.016 + i * 2.4) * halfAtBead * 0.42;
      const bx = from.x + dx * beadT;
      const by = from.y + dy * beadT;
      const targetEndFade = clamp((1 - beadT) / 0.28, 0, 1);
      if (targetEndFade <= 0.02) continue;
      ctx.globalAlpha = fade * targetEndFade * (0.3 + pulse * 0.2);
      ctx.fillStyle = colorToRgba('#d7fbff', 0.86);
      ctx.beginPath();
      ctx.arc(bx + px * lateral, by + py * lateral, 2.2 + pulse * 1.2, 0, Math.PI * 2);
      ctx.fill();
    }
  }
  ctx.restore();
}

function getShieldBubbleMetrics(effect = {}) {
  const width = Math.max(18, finiteNumber(effect.maxWidth, effect.width || 74) * finiteNumber(effect.scale, 1));
  const height = Math.max(18, finiteNumber(effect.maxHeight, effect.height || 74) * finiteNumber(effect.scale, 1));
  let rx = Math.max(26, width * 0.54 + 13);
  let ry = Math.max(26, height * 0.54 + 13);
  const aspect = rx / Math.max(1, ry);
  if (aspect > 0.82 && aspect < 1.22) {
    const radius = Math.max(rx, ry);
    rx = radius;
    ry = radius;
  }
  return { rx, ry };
}

function getShieldImpactLocal(effect = {}, rx = 32, ry = 32) {
  let hx = finiteNumber(effect.impactOffsetX, 0);
  let hy = finiteNumber(effect.impactOffsetY, -ry * 0.78);
  const normalized = Math.hypot(hx / Math.max(1, rx), hy / Math.max(1, ry));
  if (normalized > 0.96) {
    hx /= normalized / 0.96;
    hy /= normalized / 0.96;
  } else if (normalized < 0.42) {
    const angle = Math.atan2(hy, hx || 0.001);
    hx = Math.cos(angle) * rx * 0.72;
    hy = Math.sin(angle) * ry * 0.72;
  }
  return { x: hx, y: hy };
}

function drawShieldImpactRipples(effect, hit, rx, ry, alpha = 1, progress = 0, color = SHIELD_BUBBLE_COLOR) {
  const reducedEffects = isReducedEffectsMode();
  let seed = finiteNumber(effect.rippleSeed, NaN);
  if (!Number.isFinite(seed)) seed = Math.abs(hashString(`${effect.targetType || 'ship'}:${effect.targetId || effect.x}:${effect.born || 0}`));
  const baseRadius = clamp(Math.min(rx, ry) * 0.12, 5, 14);
  const maxTravel = clamp(Math.min(rx, ry) * 0.42, 18, 48);
  ctx.save();
  ctx.beginPath();
  ctx.ellipse(0, 0, rx, ry, 0, 0, Math.PI * 2);
  ctx.clip();

  ctx.lineCap = 'round';
  ctx.shadowColor = SHIELD_BUBBLE_CORE_COLOR;
  ctx.shadowBlur = reducedEffects ? 0 : 5;
  const rippleCount = reducedEffects ? 1 : 2;
  for (let i = 0; i < rippleCount; i += 1) {
    const rippleProgress = clamp(progress * 1.18 - i * 0.24, 0, 1);
    if (rippleProgress <= 0 || rippleProgress >= 1) continue;
    const radius = baseRadius + maxTravel * rippleProgress;
    const rippleAlpha = alpha * Math.pow(1 - rippleProgress, 1.65) * (0.66 - i * 0.16);
    ctx.lineWidth = clamp(2.4 - rippleProgress * 1.6, 0.7, 2.4);
    ctx.strokeStyle = colorToRgba(i === 0 ? '#ffffff' : SHIELD_BUBBLE_CORE_COLOR, rippleAlpha);
    ctx.beginPath();
    ctx.arc(hit.x, hit.y, radius, 0, Math.PI * 2);
    ctx.stroke();
  }

  if (reducedEffects) {
    ctx.restore();
    return;
  }

  ctx.shadowBlur = 0;
  const particleCount = 5;
  for (let i = 0; i < particleCount; i += 1) {
    const offset = seeded(seed + i * 37 + 11) * 0.24;
    const particleProgress = clamp(progress * 1.25 - offset, 0, 1);
    if (particleProgress <= 0 || particleProgress >= 1) continue;
    const angle = seeded(seed + i * 53 + 17) * Math.PI * 2;
    const wobble = Math.sin(progress * Math.PI * 2 + i * 1.7) * 0.08;
    const travel = maxTravel * (0.2 + seeded(seed + i * 71 + 23) * 0.68) * particleProgress;
    const px = hit.x + Math.cos(angle + wobble) * travel;
    const py = hit.y + Math.sin(angle + wobble) * travel;
    const radius = clamp(1.4 + particleProgress * 3 + seeded(seed + i * 29 + 31), 1.4, 5);
    const particleAlpha = alpha * Math.pow(1 - particleProgress, 1.9) * 0.5;
    ctx.fillStyle = colorToRgba(SHIELD_BUBBLE_CORE_COLOR, particleAlpha);
    ctx.beginPath();
    ctx.arc(px, py, radius, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.restore();
}

function drawShieldBubble(effect, p, rotation = 0, alpha = 1, progress = 0) {
  const { rx, ry } = getShieldBubbleMetrics(effect);
  const hit = getShieldImpactLocal(effect, rx, ry);
  const color = effect.color || SHIELD_BUBBLE_COLOR;
  const impactAngle = Math.atan2(hit.y / Math.max(1, ry), hit.x / Math.max(1, rx));

  ctx.save();
  ctx.translate(p.x, p.y);
  ctx.rotate((rotation || 0) * Math.PI / 180);

  ctx.beginPath();
  ctx.ellipse(0, 0, rx, ry, 0, 0, Math.PI * 2);
  const body = ctx.createRadialGradient(0, 0, 0, 0, 0, Math.max(rx, ry));
  body.addColorStop(0, colorToRgba(SHIELD_BUBBLE_CORE_COLOR, alpha * 0.05));
  body.addColorStop(0.56, colorToRgba(color, alpha * 0.08));
  body.addColorStop(0.82, colorToRgba(color, alpha * 0.18));
  body.addColorStop(1, colorToRgba(SHIELD_BUBBLE_CORE_COLOR, alpha * 0.34));
  ctx.fillStyle = body;
  ctx.fill();

  drawShieldImpactRipples(effect, hit, rx, ry, alpha, progress, color);

  ctx.lineCap = 'round';
  ctx.lineWidth = clamp(Math.max(rx, ry) * 0.035, 1.6, 4.8);
  ctx.strokeStyle = colorToRgba(color, alpha * 0.5);
  ctx.shadowColor = color;
  ctx.shadowBlur = isReducedEffectsMode() ? 0 : 6;
  ctx.beginPath();
  ctx.ellipse(0, 0, rx, ry, 0, 0, Math.PI * 2);
  ctx.stroke();

  ctx.lineWidth = clamp(Math.max(rx, ry) * 0.052, 2.2, 7);
  ctx.strokeStyle = colorToRgba(SHIELD_BUBBLE_CORE_COLOR, alpha * 0.85);
  ctx.shadowBlur = isReducedEffectsMode() ? 0 : 8;
  ctx.beginPath();
  ctx.ellipse(0, 0, rx, ry, 0, impactAngle - 0.46, impactAngle + 0.46);
  ctx.stroke();
  ctx.restore();
}

function drawShieldEffects(now = performance.now()) {
  ctx.save();
  ctx.globalCompositeOperation = 'screen';
  for (const effect of state.weaponEffects) {
    if (effect.kind !== 'shield') continue;
    const age = now - effect.born;
    const t = clamp(age / effect.ttl, 0, 1);
    const pulse = Math.sin(t * Math.PI);
    const alpha = Math.max(0, 1 - t) * (0.58 + pulse * 0.42);
    const target = effect.targetId && effect.targetType === 'station'
      ? state.stations.find((station) => station.id === effect.targetId && !station.destroyed)
      : effect.targetId
        ? state.npcShips.find((npc) => npc.id === effect.targetId && !npc.destroyed)
      : null;
    const p = effect.trackPlayer
      ? { x: state.ship.x, y: state.ship.y }
      : target
        ? worldToScreen(target)
        : worldToScreen(effect);
    const rotation = effect.trackPlayer ? state.ship.rotation : target ? target.heading ?? target.rotation : effect.rotation;
    if (p.x < -140 || p.x > canvas.width + 140 || p.y < -140 || p.y > canvas.height + 140) continue;
    drawShieldBubble(effect, p, rotation, alpha, t);
  }
  ctx.restore();
}

function drawProjectiles() {
  ctx.save();
  ctx.lineCap = 'round';
  for (const shot of state.projectiles) {
    const p = worldToScreen(shot);
    if (p.x < -80 || p.x > canvas.width + 80 || p.y < -80 || p.y > canvas.height + 80) continue;
    const tail = Math.atan2(shot.vy, shot.vx);
    const spriteFile = getProjectileSpriteFile(shot);
    const sprite = spriteFile ? getWeaponSprite(spriteFile) : null;
    if (sprite?.complete && sprite.naturalWidth > 0) {
      const isTorpedo = shot.kind === 'torpedo';
      const isMine = shot.kind === 'mine';
      const isPhotorealTorpedoSprite = isTorpedo && String(spriteFile).startsWith('torpedo-');
      const isBeamLikeSprite = sprite.naturalWidth > sprite.naturalHeight * 4;
      const maxWidth = isMine ? 30 : isBeamLikeSprite ? 46 : isTorpedo ? 42 : 14;
      const maxHeight = isMine ? 30 : isBeamLikeSprite ? 10 : isTorpedo ? 20 : 24;
      const scale = shot.owner === 'player' ? 1.08 : 0.92;
      ctx.save();
      ctx.translate(p.x, p.y);
      const spriteRotation = isMine
        ? 0
        : isPhotorealTorpedoSprite
          ? tail + Math.PI
          : isBeamLikeSprite
            ? tail
            : tail + Math.PI / 2;
      ctx.rotate(spriteRotation);
      ctx.imageSmoothingEnabled = true;
      ctx.imageSmoothingQuality = 'high';
      ctx.globalCompositeOperation = 'screen';
      ctx.globalAlpha = isPhotorealTorpedoSprite ? 0.22 : 0.45;
      ctx.fillStyle = shot.color;
      ctx.beginPath();
      ctx.arc(0, 0, isPhotorealTorpedoSprite ? 7 : isTorpedo ? 12 : isMine ? 15 : 8, 0, Math.PI * 2);
      ctx.fill();
      ctx.globalCompositeOperation = 'source-over';
      ctx.globalAlpha = 1;
      const fit = Math.min(maxWidth / sprite.naturalWidth, maxHeight / sprite.naturalHeight) * scale;
      const w = sprite.naturalWidth * fit;
      const h = sprite.naturalHeight * fit;
      drawTintedSprite(sprite, -w / 2, -h / 2, w, h, shot.color || '#dfeaff', isPhotorealTorpedoSprite ? 0.28 : 0.88);
      ctx.restore();
      if (isTorpedo && !isPhotorealTorpedoSprite) {
        ctx.strokeStyle = shot.color;
        ctx.lineWidth = 1.8;
        ctx.globalAlpha = 0.58;
        ctx.beginPath();
        ctx.moveTo(p.x, p.y);
        ctx.lineTo(p.x - Math.cos(tail) * 24, p.y - Math.sin(tail) * 24);
        ctx.stroke();
        ctx.globalAlpha = 1;
      }
      continue;
    }
    ctx.strokeStyle = shot.color;
    ctx.lineWidth = shot.owner === 'player' ? 3 : 2;
    ctx.beginPath();
    ctx.moveTo(p.x, p.y);
    ctx.lineTo(p.x - Math.cos(tail) * 18, p.y - Math.sin(tail) * 18);
    ctx.stroke();
    ctx.fillStyle = shot.color;
    ctx.beginPath();
    ctx.arc(p.x, p.y, shot.owner === 'player' ? 3.2 : 2.5, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.restore();
}

function drawPlayerCloakEffect(now = performance.now()) {
  if (!state.cloak?.active) return;
  const alpha = 1 - getPlayerCloakAlpha(now);
  const radius = getShipScreenRadius(state.playership, state.ship.drawScale);
  const pulse = 0.5 + Math.sin(now * 0.006) * 0.5;
  ctx.save();
  ctx.globalCompositeOperation = 'screen';
  ctx.globalAlpha = 0.2 + alpha * 0.35;
  ctx.strokeStyle = `rgba(159, 178, 208, ${0.36 + pulse * 0.22})`;
  ctx.lineWidth = 1.5;
  ctx.setLineDash([5, 8]);
  ctx.translate(state.ship.x, state.ship.y);
  ctx.rotate(state.ship.rotation * Math.PI / 180 + Math.sin(now * 0.0017) * 0.08);
  ctx.beginPath();
  ctx.ellipse(0, 0, radius * 0.78, radius * 0.48, 0, 0, Math.PI * 2);
  ctx.stroke();
  ctx.restore();
}

function drawThemedTargetFrame(x, y, radius, color) {
  const theme = getFactionUiTheme();
  const r = Math.max(24, radius + 8);
  const w = r;
  const h = r;

  ctx.save();
  ctx.strokeStyle = color;
  ctx.lineWidth = 1.8;
  ctx.shadowColor = color;
  ctx.shadowBlur = 8;
  ctx.translate(x, y);

  if (theme === 'ferengi') {
    const points = 6;
    ctx.beginPath();
    for (let i = 0; i < points; i++) {
      const angle = -Math.PI / 6 + (Math.PI * 2 * i) / points;
      const px = Math.cos(angle) * w;
      const py = Math.sin(angle) * h;
      if (i === 0) ctx.moveTo(px, py);
      else ctx.lineTo(px, py);
    }
    ctx.closePath();
    ctx.stroke();
    ctx.globalAlpha = 0.55;
    ctx.beginPath();
    ctx.moveTo(-w * 0.42, 0);
    ctx.lineTo(-w * 0.16, 0);
    ctx.moveTo(w * 0.16, 0);
    ctx.lineTo(w * 0.42, 0);
    ctx.moveTo(0, -h * 0.42);
    ctx.lineTo(0, -h * 0.18);
    ctx.moveTo(0, h * 0.18);
    ctx.lineTo(0, h * 0.42);
    ctx.stroke();
  } else if (theme === 'cardassian') {
    const points = [
      { x: -w * 0.6, y: -h * 0.66, prev: { x: -w * 0.79, y: 0 }, next: { x: w * 0.6, y: -h * 0.66 } },
      { x: w * 0.6, y: -h * 0.66, prev: { x: -w * 0.6, y: -h * 0.66 }, next: { x: w * 0.79, y: 0 } },
      { x: w * 0.79, y: 0, prev: { x: w * 0.6, y: -h * 0.66 }, next: { x: w * 0.6, y: h * 0.66 } },
      { x: w * 0.6, y: h * 0.66, prev: { x: w * 0.79, y: 0 }, next: { x: -w * 0.6, y: h * 0.66 } },
      { x: -w * 0.6, y: h * 0.66, prev: { x: w * 0.6, y: h * 0.66 }, next: { x: -w * 0.79, y: 0 } },
      { x: -w * 0.79, y: 0, prev: { x: -w * 0.6, y: h * 0.66 }, next: { x: -w * 0.6, y: -h * 0.66 } },
    ];
    const cornerSize = Math.max(13, r * 0.2);
    ctx.globalAlpha = 0.82;
    ctx.lineWidth = 2.2;
    ctx.lineCap = 'square';
    for (const point of points) {
      const toPrev = Math.atan2(point.prev.y - point.y, point.prev.x - point.x);
      const toNext = Math.atan2(point.next.y - point.y, point.next.x - point.x);
      ctx.beginPath();
      ctx.moveTo(point.x, point.y);
      ctx.lineTo(point.x + Math.cos(toPrev) * cornerSize, point.y + Math.sin(toPrev) * cornerSize);
      ctx.moveTo(point.x, point.y);
      ctx.lineTo(point.x + Math.cos(toNext) * cornerSize, point.y + Math.sin(toNext) * cornerSize);
      ctx.stroke();
    }
    ctx.globalAlpha = 0.5;
    ctx.lineWidth = 1.4;
    ctx.beginPath();
    ctx.moveTo(-w * 0.24, -h * 0.5);
    ctx.lineTo(w * 0.24, -h * 0.5);
    ctx.moveTo(-w * 0.24, h * 0.5);
    ctx.lineTo(w * 0.24, h * 0.5);
    ctx.stroke();
  } else if (theme === 'klingon') {
    const triangleRadius = r * 1.45;
    const points = [0, 1, 2].map((index) => {
      const angle = -Math.PI / 2 + index * (Math.PI * 2 / 3);
      return {
        x: Math.cos(angle) * triangleRadius,
        y: Math.sin(angle) * triangleRadius,
      };
    });
    ctx.globalAlpha = 0.82;
    ctx.lineWidth = 2.6;
    ctx.lineCap = 'square';
    const cornerSize = Math.max(14, triangleRadius * 0.22);
    for (let i = 0; i < points.length; i += 1) {
      const point = points[i];
      const prev = points[(i + 2) % points.length];
      const next = points[(i + 1) % points.length];
      const toPrev = Math.atan2(prev.y - point.y, prev.x - point.x);
      const toNext = Math.atan2(next.y - point.y, next.x - point.x);
      ctx.beginPath();
      ctx.moveTo(point.x, point.y);
      ctx.lineTo(point.x + Math.cos(toPrev) * cornerSize, point.y + Math.sin(toPrev) * cornerSize);
      ctx.moveTo(point.x, point.y);
      ctx.lineTo(point.x + Math.cos(toNext) * cornerSize, point.y + Math.sin(toNext) * cornerSize);
      ctx.stroke();
    }
  } else if (theme === 'romulan') {
    const rx = w * 1.18;
    const ry = h * 0.92;
    const mark = Math.max(14, r * 0.28);
    const curve = Math.max(8, r * 0.18);
    ctx.globalAlpha = 0.78;
    ctx.lineWidth = 2.2;
    ctx.lineCap = 'round';

    ctx.beginPath();
    ctx.moveTo(-rx, -ry + mark);
    ctx.lineTo(-rx, -ry);
    ctx.lineTo(-rx + mark, -ry);
    ctx.stroke();

    ctx.beginPath();
    ctx.moveTo(rx - mark, -ry);
    ctx.lineTo(rx - curve, -ry);
    ctx.arcTo(rx, -ry, rx, -ry + curve, curve);
    ctx.lineTo(rx, -ry + mark);
    ctx.stroke();

    ctx.beginPath();
    ctx.moveTo(-rx, ry - mark);
    ctx.lineTo(-rx, ry - curve);
    ctx.arcTo(-rx, ry, -rx + curve, ry, curve);
    ctx.lineTo(-rx + mark, ry);
    ctx.stroke();

    ctx.beginPath();
    ctx.moveTo(rx - mark, ry);
    ctx.lineTo(rx, ry);
    ctx.lineTo(rx, ry - mark);
    ctx.stroke();
  } else {
    const l = Math.max(12, r * 0.32);
    ctx.beginPath();
    ctx.moveTo(-w, -h + l);
    ctx.lineTo(-w, -h);
    ctx.lineTo(-w + l, -h);
    ctx.moveTo(w - l, -h);
    ctx.lineTo(w, -h);
    ctx.lineTo(w, -h + l);
    ctx.moveTo(w, h - l);
    ctx.lineTo(w, h);
    ctx.lineTo(w - l, h);
    ctx.moveTo(-w + l, h);
    ctx.lineTo(-w, h);
    ctx.lineTo(-w, h - l);
    ctx.stroke();
  }

  ctx.restore();
}

function drawCombatTarget() {
  const target = getCombatTarget();
  if (!target) return;
  ensureCombatTargetStats(target);
  const p = worldToScreen(target);
  if (p.x < -80 || p.x > canvas.width + 80 || p.y < -80 || p.y > canvas.height + 80) return;
  const radius = target.stationTypeId
    ? getStationTargetFrameRadius(target)
    : getShipTargetFrameRadius(target.shipId, target.scale || 1);
  const hullHealth = clamp(target.combatHull / target.maxCombatHull, 0, 1);
  const shieldHealth = target.maxCombatShields > 0 ? clamp(target.combatShields / target.maxCombatShields, 0, 1) : 0;
  const shieldColor = getShieldColorForFaction(target.faction);
  const targetColor = target.attitude === 'friendly' ? '#9cffb4' : target.hostile ? '#ff7777' : '#ffd66e';
  const targetName = target.stationTypeId
    ? target.name || getShipStats(target.stationTypeId).name || 'Station'
    : getShipDisplayName(target);
  const targetStatus = target.stationTypeId
    ? formatFaction(target.faction)
    : `${target.attitude} | ${formatFaction(target.faction)}`;
  const meterWidth = clamp(radius * 1.35, 74, 180);
  const meterX = p.x - meterWidth / 2;
  ctx.save();
  drawThemedTargetFrame(p.x, p.y, radius, targetColor);
  ctx.fillStyle = 'rgba(4, 10, 20, 0.78)';
  ctx.fillRect(meterX, p.y + radius + 8, meterWidth, 4);
  ctx.fillRect(meterX, p.y + radius + 14, meterWidth, 5);
  ctx.fillStyle = shieldColor;
  ctx.fillRect(meterX, p.y + radius + 8, meterWidth * shieldHealth, 4);
  ctx.fillStyle = hullHealth > 0.45 ? '#9cffb4' : '#ff7777';
  ctx.fillRect(meterX, p.y + radius + 14, meterWidth * hullHealth, 5);
  const label = targetName.length > 20 ? `${targetName.slice(0, 19)}.` : targetName;
  const labelX = p.x + radius + 16;
  const labelY = p.y - radius - 8;
  ctx.strokeStyle = colorToRgba(targetColor, 0.78);
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(p.x + radius * 0.58, p.y - radius * 0.58);
  ctx.lineTo(labelX - 6, labelY + 12);
  ctx.stroke();
  ctx.fillStyle = 'rgba(4, 10, 20, 0.72)';
  ctx.fillRect(labelX - 2, labelY - 13, Math.max(112, label.length * 7.2), 30);
  ctx.fillStyle = targetColor;
  ctx.font = canvasUiFont(11);
  ctx.textAlign = 'start';
  ctx.fillText(label, labelX + 4, labelY);
  ctx.font = canvasUiFont(9);
  ctx.fillStyle = 'rgba(223, 234, 255, 0.82)';
  ctx.fillText(targetStatus.toUpperCase(), labelX + 4, labelY + 12);
  ctx.textAlign = 'start';
  ctx.restore();
}

function drawStarField() {
  const starfield = sprites.starfield;
  if (starfield?.complete && starfield.naturalWidth > 0) {
    const scale = Math.max(canvas.width / starfield.naturalWidth, canvas.height / starfield.naturalHeight) * 1.08;
    const drawW = starfield.naturalWidth * scale;
    const drawH = starfield.naturalHeight * scale;
    const driftX = -((state.camera.x * 0.018) % Math.max(1, drawW - canvas.width));
    const driftY = -((state.camera.y * 0.014) % Math.max(1, drawH - canvas.height));
    ctx.save();
    ctx.globalAlpha = isReducedEffectsMode() ? 0.68 : 0.86;
    ctx.drawImage(starfield, driftX, driftY, drawW, drawH);
    if (driftX > canvas.width - drawW) ctx.drawImage(starfield, driftX - drawW, driftY, drawW, drawH);
    if (driftY > canvas.height - drawH) ctx.drawImage(starfield, driftX, driftY - drawH, drawW, drawH);
    if (driftX > canvas.width - drawW && driftY > canvas.height - drawH) {
      ctx.drawImage(starfield, driftX - drawW, driftY - drawH, drawW, drawH);
    }
    ctx.globalAlpha = 1;
    ctx.restore();
  }
  const layers = [
    { cell: 220, parallax: 0.08, density: 1, size: 1.1, alpha: 0.24 },
    { cell: 170, parallax: 0.16, density: 1, size: 1.45, alpha: 0.34 },
    { cell: 130, parallax: 0.28, density: 1, size: 1.9, alpha: 0.44 },
  ];
  const activeLayers = isPerformanceMode() ? layers.slice(0, 2) : layers;
  const starAlphaScale = isReducedEffectsMode() ? 0.68 : 1;
  for (let layerIndex = 0; layerIndex < activeLayers.length; layerIndex++) {
    const layer = activeLayers[layerIndex];
    const originX = state.camera.x * layer.parallax - canvas.width / 2;
    const originY = state.camera.y * layer.parallax - canvas.height / 2;
    const minCol = Math.floor(originX / layer.cell) - 1;
    const maxCol = Math.floor((originX + canvas.width) / layer.cell) + 1;
    const minRow = Math.floor(originY / layer.cell) - 1;
    const maxRow = Math.floor((originY + canvas.height) / layer.cell) + 1;
    for (let row = minRow; row <= maxRow; row++) {
      for (let col = minCol; col <= maxCol; col++) {
        for (let i = 0; i < layer.density; i++) {
          const seedBase = col * 92821 + row * 68917 + layerIndex * 173 + i * 37;
          const sx = col * layer.cell + seeded(seedBase + 1) * layer.cell;
          const sy = row * layer.cell + seeded(seedBase + 2) * layer.cell;
          const x = sx - originX;
          const y = sy - originY;
          const twinkle = 0.78 + seeded(seedBase + 3) * 0.22;
          ctx.fillStyle = `rgba(210,230,255,${layer.alpha * twinkle * starAlphaScale})`;
          ctx.fillRect(x, y, layer.size, layer.size);
        }
      }
    }
  }
}

function drawInSystemWarpStreaks(now = performance.now()) {
  const intensity = clamp(finiteNumber(state.ship.systemWarpIntensity, 0), 0, 1);
  if (intensity < IN_SYSTEM_WARP_MIN_INTENSITY) return;
  const radians = state.ship.rotation * Math.PI / 180;
  const dirX = Math.sin(radians);
  const dirY = -Math.cos(radians);
  const perpX = -dirY;
  const perpY = dirX;
  const ease = intensity * intensity * (3 - 2 * intensity);
  const streakCount = Math.round((isReducedEffectsMode() ? 48 : IN_SYSTEM_WARP_EFFECT_STREAKS) * ease);
  const loop = Math.hypot(canvas.width, canvas.height) * 1.7;
  const centerX = canvas.width * 0.5;
  const centerY = canvas.height * 0.5;
  ctx.save();
  ctx.globalCompositeOperation = 'screen';
  ctx.lineCap = 'round';
  for (let i = 0; i < streakCount; i += 1) {
    const seed = i * 107 + state.currentPlanet * 31;
    const lane = (seeded(seed + 1) - 0.5) * Math.max(canvas.width, canvas.height) * 1.65;
    const travel = ((seeded(seed + 2) * loop + now * (0.32 + seeded(seed + 3) * 0.22) * ease) % loop) - loop * 0.5;
    const x = centerX + dirX * travel + perpX * lane;
    const y = centerY + dirY * travel + perpY * lane;
    const len = (34 + seeded(seed + 4) * 96) * (0.65 + ease);
    const alpha = (0.05 + seeded(seed + 5) * 0.22) * ease;
    ctx.beginPath();
    ctx.moveTo(x - dirX * len, y - dirY * len);
    ctx.lineTo(x + dirX * len * 0.32, y + dirY * len * 0.32);
    ctx.lineWidth = 0.7 + seeded(seed + 6) * 1.8 * ease;
    ctx.strokeStyle = `rgba(190, 228, 255, ${alpha})`;
    ctx.stroke();
  }
  ctx.restore();
}

function drawShipCruiseWarpTrail(screenPoint, heading, intensity = 0, radius = 34) {
  const ease = clamp(finiteNumber(intensity, 0), 0, 1);
  if (ease < 0.14) return;
  const radians = heading * Math.PI / 180;
  const dirX = Math.sin(radians);
  const dirY = -Math.cos(radians);
  const sideX = -dirY;
  const sideY = dirX;
  const length = radius * (2.4 + ease * 2.2);
  ctx.save();
  ctx.globalCompositeOperation = 'screen';
  ctx.lineCap = 'round';
  for (let i = -1; i <= 1; i += 1) {
    const offset = i * radius * 0.2;
    ctx.beginPath();
    ctx.moveTo(screenPoint.x - dirX * radius * 0.25 + sideX * offset, screenPoint.y - dirY * radius * 0.25 + sideY * offset);
    ctx.lineTo(screenPoint.x - dirX * length + sideX * offset * 1.4, screenPoint.y - dirY * length + sideY * offset * 1.4);
    ctx.lineWidth = Math.max(1, radius * 0.035);
    ctx.strokeStyle = `rgba(116, 214, 255, ${0.14 * ease})`;
    ctx.stroke();
  }
  ctx.restore();
}

function drawAmbientTrafficWarpFlash(screenPoint, npc, radius) {
  const warp = npc.trafficWarp;
  if (!warp || (warp.phase !== 'departing' && warp.phase !== 'arriving')) return;
  const progress = clamp((performance.now() - warp.startedAt) / Math.max(1, warp.endsAt - warp.startedAt), 0, 1);
  const pulse = warp.phase === 'arriving' ? 1 - progress : progress;
  const ringRadius = radius * (1.15 + pulse * 2.1);
  const alpha = 0.16 + pulse * 0.4;
  ctx.save();
  ctx.globalCompositeOperation = 'screen';
  ctx.strokeStyle = `rgba(156, 224, 255, ${alpha})`;
  ctx.lineWidth = Math.max(1.4, radius * 0.06);
  ctx.shadowColor = '#9ce8ff';
  ctx.shadowBlur = isReducedEffectsMode() ? 0 : 12;
  ctx.beginPath();
  ctx.arc(screenPoint.x, screenPoint.y, ringRadius, 0, Math.PI * 2);
  ctx.stroke();
  ctx.fillStyle = `rgba(180, 235, 255, ${alpha * 0.2})`;
  ctx.beginPath();
  ctx.arc(screenPoint.x, screenPoint.y, ringRadius * 0.76, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();
}

function drawSystemStar(now = performance.now()) {
  const star = worldToScreen(state.systemStar);
  const pulse = 1 + Math.sin(now * 0.0011 + state.currentPlanet * 0.7) * 0.035;
  const glowRadius = SYSTEM_STAR_GLOW_RADIUS * pulse;
  const coreRadius = SYSTEM_STAR_CORE_RADIUS * (1 + Math.sin(now * 0.0018 + state.currentPlanet) * 0.025);
  const sunTexture = sprites.sun;
  const hasSunTexture = sunTexture?.complete && sunTexture.naturalWidth > 0;
  const glow = ctx.createRadialGradient(star.x, star.y, 4, star.x, star.y, glowRadius);
  glow.addColorStop(0, 'rgba(255, 245, 190, 0.95)');
  glow.addColorStop(0.18, 'rgba(255, 214, 110, 0.48)');
  glow.addColorStop(0.48, 'rgba(255, 150, 64, 0.16)');
  glow.addColorStop(1, 'rgba(255, 214, 110, 0)');
  ctx.save();
  ctx.globalCompositeOperation = 'screen';
  ctx.fillStyle = glow;
  ctx.beginPath();
  ctx.arc(star.x, star.y, glowRadius, 0, Math.PI * 2);
  ctx.fill();

  for (let i = 0; i < 8; i++) {
    const direction = i % 2 ? -1 : 1;
    const angle = seeded(state.currentPlanet * 79 + i * 13) * Math.PI * 2 + now * 0.00011 * direction;
    const inner = coreRadius * (0.78 + seeded(i * 31 + state.currentPlanet) * 0.18);
    const outer = coreRadius * (1.18 + seeded(i * 37 + state.currentPlanet) * 0.34);
    const alpha = 0.12 + seeded(i * 43 + state.currentPlanet) * 0.18;
    ctx.strokeStyle = `rgba(255, ${154 + Math.floor(seeded(i * 47) * 58)}, 76, ${alpha})`;
    ctx.lineWidth = 2 + seeded(i * 53) * 3;
    ctx.beginPath();
    ctx.moveTo(star.x + Math.cos(angle) * inner, star.y + Math.sin(angle) * inner);
    ctx.quadraticCurveTo(
      star.x + Math.cos(angle + 0.18 * direction) * outer,
      star.y + Math.sin(angle + 0.18 * direction) * outer,
      star.x + Math.cos(angle + 0.38 * direction) * inner,
      star.y + Math.sin(angle + 0.38 * direction) * inner,
    );
    ctx.stroke();
  }

  if (hasSunTexture) {
    const textureSize = coreRadius * 3.25;
    ctx.save();
    ctx.translate(star.x, star.y);
    ctx.globalCompositeOperation = 'screen';
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = 'high';
    ctx.globalAlpha = 0.96;
    ctx.rotate(now * 0.000035 + state.currentPlanet * 0.21);
    ctx.drawImage(sunTexture, -textureSize / 2, -textureSize / 2, textureSize, textureSize);
    ctx.globalAlpha = 0.24;
    ctx.rotate(-now * 0.000095);
    ctx.drawImage(sunTexture, -textureSize * 0.47, -textureSize * 0.47, textureSize * 0.94, textureSize * 0.94);
    ctx.restore();

    ctx.globalCompositeOperation = 'screen';
    ctx.globalAlpha = 0.42;
    ctx.strokeStyle = 'rgba(255, 246, 190, 0.72)';
    ctx.lineWidth = 2.4;
    ctx.beginPath();
    ctx.arc(star.x, star.y, coreRadius * 1.18, 0, Math.PI * 2);
    ctx.stroke();
    ctx.restore();
    return;
  }

  const core = ctx.createRadialGradient(star.x - coreRadius * 0.24, star.y - coreRadius * 0.28, 2, star.x, star.y, coreRadius);
  core.addColorStop(0, '#fffbe1');
  core.addColorStop(0.42, '#fff2a8');
  core.addColorStop(0.74, '#ffc75f');
  core.addColorStop(1, '#f07635');
  ctx.fillStyle = core;
  ctx.beginPath();
  ctx.arc(star.x, star.y, coreRadius, 0, Math.PI * 2);
  ctx.fill();

  ctx.globalCompositeOperation = 'source-over';
  ctx.globalAlpha = 0.42;
  ctx.strokeStyle = 'rgba(255, 255, 255, 0.62)';
  ctx.lineWidth = 1.5;
  for (let i = 0; i < 9; i++) {
    const band = coreRadius * (0.18 + i * 0.08);
    const angle = now * 0.00018 + seeded(state.currentPlanet * 113 + i) * Math.PI;
    ctx.beginPath();
    ctx.ellipse(star.x, star.y, band, band * (0.26 + seeded(i * 17) * 0.18), angle, 0.2, Math.PI * (1.1 + seeded(i * 23) * 0.6));
    ctx.stroke();
  }

  ctx.globalAlpha = 1;
  ctx.strokeStyle = 'rgba(255, 255, 255, 0.38)';
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.arc(star.x, star.y, coreRadius, 0, Math.PI * 2);
  ctx.stroke();
  ctx.restore();
}

function drawMinimap() {
  if (!minimapCanvas || !minimapCtx) return;
  const visible = state.gameStarted && !state.warp.active && !isWormholeTransitActive();
  if (minimapPanelEl) minimapPanelEl.style.display = visible ? 'block' : 'none';
  minimapCanvas.style.display = visible ? 'block' : 'none';
  if (!visible) return;

  const ctx2 = minimapCtx;
  const w = minimapCanvas.width;
  const h = minimapCanvas.height;
  const pad = 12;
  const mapW = w - pad * 2;
  const mapH = h - pad * 2;
  const bodyPoints = state.systemBodies || [];
  const importantPoints = [state.systemStar, state.systemPlanet, ...bodyPoints, ...state.stations.filter(st=>sensorVisibleToPlayer(st)), state.wormhole].filter(Boolean);
  const radarRangeX = Math.max(1200, ...importantPoints.map((point) => Math.abs(point.x - state.camera.x) * 1.15));
  const radarRangeY = Math.max(900, ...importantPoints.map((point) => Math.abs(point.y - state.camera.y) * 1.15));
  const centerX = pad + mapW / 2;
  const centerY = pad + mapH / 2;
  const toMini = (point) => {
    const dx = point.x - state.camera.x;
    const dy = point.y - state.camera.y;
    return {
      x: centerX + (dx / radarRangeX) * (mapW / 2),
      y: centerY + (dy / radarRangeY) * (mapH / 2),
      visible: Math.abs(dx) <= radarRangeX && Math.abs(dy) <= radarRangeY,
    };
  };
  const dot = (point, color, r = 3) => {
    const p = toMini(point);
    if (!p.visible) return;
    ctx2.fillStyle = color;
    ctx2.beginPath();
    ctx2.arc(p.x, p.y, r, 0, Math.PI * 2);
    ctx2.fill();
  };
  const orbitGuide = (anchor, radius, color, dash = [3, 4]) => {
    if (!anchor || radius <= 0) return;
    const p = toMini(anchor);
    const rx = (radius / radarRangeX) * (mapW / 2);
    const ry = (radius / radarRangeY) * (mapH / 2);
    if (rx < 2 || ry < 2 || rx > mapW * 1.65 || ry > mapH * 1.65) return;
    if (p.x + rx < pad || p.x - rx > pad + mapW || p.y + ry < pad || p.y - ry > pad + mapH) return;
    ctx2.strokeStyle = color;
    ctx2.lineWidth = 0.8;
    ctx2.setLineDash(dash);
    ctx2.beginPath();
    ctx2.ellipse(p.x, p.y, rx, ry, 0, 0, Math.PI * 2);
    ctx2.stroke();
    ctx2.setLineDash([]);
  };

  ctx2.clearRect(0, 0, w, h);
  ctx2.fillStyle = 'rgba(4, 10, 20, 0.92)';
  ctx2.fillRect(0, 0, w, h);
  ctx2.strokeStyle = 'rgba(116, 214, 255, 0.36)';
  ctx2.strokeRect(pad, pad, mapW, mapH);

  ctx2.save();
  ctx2.beginPath();
  ctx2.rect(pad, pad, mapW, mapH);
  ctx2.clip();
  orbitGuide(state.systemStar, finiteNumber(state.systemPlanet?.orbitDistance, 0), 'rgba(255, 214, 110, 0.18)', [4, 7]);
  for (const body of bodyPoints) {
    if (body.orbitAnchor === 'star') {
      orbitGuide(state.systemStar, finiteNumber(body.orbitDistance, 0), 'rgba(124, 176, 255, 0.13)', [4, 7]);
    }
  }
  for (const station of state.stations.filter(st=>sensorVisibleToPlayer(st))) {
    if (!station.destroyed && station.orbitAnchor === 'star') {
      orbitGuide(state.systemStar, finiteNumber(station.orbitDistance, 0), 'rgba(156, 255, 180, 0.15)', [4, 7]);
    }
  }
  for (const body of bodyPoints) {
    if (body.orbitAnchor === 'planet' || body.parent === 'main') {
      orbitGuide(state.systemPlanet, finiteNumber(body.orbitDistance, 0), 'rgba(170, 205, 235, 0.18)');
    }
  }
  for (const station of state.stations.filter(st=>sensorVisibleToPlayer(st))) {
    if (!station.destroyed && station.orbitAnchor === 'planet') {
      orbitGuide(state.systemPlanet, finiteNumber(station.orbitDistance, 0), 'rgba(156, 255, 180, 0.22)');
    }
  }
  ctx2.restore();

  for (const asteroid of state.asteroids) {
    if (!asteroid.depleted) dot(asteroid, 'rgba(160, 174, 192, 0.58)', 1.6);
  }
  dot(state.systemStar, '#fff2a8', 5);
  dot(state.systemPlanet, '#74d6ff', 4);
  for (const body of bodyPoints) {
    dot(body, body.kind === 'moon' ? 'rgba(210, 220, 236, 0.72)' : 'rgba(124, 176, 255, 0.78)', body.kind === 'moon' ? 1.7 : 2.9);
  }
  for (const station of state.stations.filter(st=>sensorVisibleToPlayer(st))) {
    if (!station.destroyed) dot(station, station.hostile ? '#ff9c9c' : '#9cffb4', 3.8);
  }
  if (state.wormhole) dot(state.wormhole, '#c59cff', 3.4);
  const securityZone = getSecurityZone(state.currentPlanet);
  if (securityZone) {
    ctx2.save();
    ctx2.beginPath();
    ctx2.rect(pad, pad, mapW, mapH);
    ctx2.clip();
    orbitGuide(securityZone.centre, securityZone.radius, securityZone.foreign ? 'rgba(255, 180, 84, 0.7)' : 'rgba(125, 200, 255, 0.7)', [5, 4]);
    ctx2.restore();
    const playerOrder = getPlayerSecurityOrder(state.currentPlanet);
    if (playerOrder) {
      const withdrawing = playerOrder.kind === 'withdraw' || playerOrder.withdrawing;
      dot(resolveSecurityPoint(securityZone, withdrawing ? playerOrder.exit : playerOrder.hold), withdrawing ? '#ff9c9c' : '#9cffb4', 3.2);
    }
  }
  for (const npc of state.npcShips) {
    if (npc.destroyed || npc.trafficWarp?.phase === 'away' || !sensorVisibleToPlayer(npc)) continue;
    const color = sensorSide(npc) === PLAYER_SIDE ? '#9cffb4' : '#dfeaff';
    const position=sensorKnownPosition(state,npc);if(position)dot(position,color,2.6);
  }

  for (const c of sensorWorld.map('player').values()) {
    if(c.position&&!freshTrack(c,sensorClock)&&sensorClock-c.observedAt<30)dot(c.position,'#667080',2);
    if(c.cue?.expiresAt>=sensorClock)dot(c.cue,'#ffb45c',3);
  }
  ctx2.save();
  ctx2.translate(centerX, centerY);
  ctx2.rotate(state.ship.rotation * Math.PI / 180);
  ctx2.fillStyle = '#ffd66e';
  ctx2.beginPath();
  ctx2.moveTo(0, -6);
  ctx2.lineTo(4, 5);
  ctx2.lineTo(0, 2);
  ctx2.lineTo(-4, 5);
  ctx2.closePath();
  ctx2.fill();
  ctx2.restore();

}

function drawFlightNebula() {
  if (!state.systemHasNebula) return;
  const nebula = getNebulaSprite();
  if (!nebula) return;
  if (isPerformanceMode()) return;
  const seed = (state.currentPlanet + 1) * 101;
  const now = performance.now();
  const anchor = state.systemStar || state.systemPlanet || { x: SYSTEM_W * 0.5, y: SYSTEM_H * 0.5 };
  const coverW = canvas.width * (1.86 + seeded(seed + 1) * 0.22);
  const coverH = canvas.height * (1.86 + seeded(seed + 2) * 0.22);
  const deepX = Math.tanh((anchor.x - state.camera.x) * 0.00055) * canvas.width * 0.055;
  const deepY = Math.tanh((anchor.y - state.camera.y) * 0.00055) * canvas.height * 0.055;
  const driftX = Math.sin(now * 0.000018 + seed * 0.13) * canvas.width * 0.004;
  const driftY = Math.cos(now * 0.000014 + seed * 0.19) * canvas.height * 0.004;
  ctx.save();
  ctx.globalCompositeOperation = 'screen';
  ctx.globalAlpha = isReducedEffectsMode() ? 0.3 : 0.52;
  ctx.translate(canvas.width * 0.5 + deepX + driftX, canvas.height * 0.5 + deepY + driftY);
  ctx.rotate((seeded(seed + 5) - 0.5) * 0.34);
  drawImageCoverTo(
    ctx,
    nebula,
    -coverW * 0.5,
    -coverH * 0.5,
    coverW,
    coverH,
    seeded(seed + 7) * 2 - 1,
    seeded(seed + 11) * 2 - 1,
  );
  ctx.globalCompositeOperation = 'source-over';
  ctx.globalAlpha = 0.13;
  ctx.fillStyle = state.systemNebulaColor || getNebulaColor(state.currentPlanet + 1, 0.16);
  ctx.fillRect(-coverW * 0.5, -coverH * 0.5, coverW, coverH);
  ctx.restore();
}

function drawWarpSplash(now = performance.now()) {
  const warp = state.warp;
  const target = state.planets[warp.to];
  const progress = clamp((now - warp.startedAt) / warp.duration, 0, 1);
  const cx = canvas.width / 2;
  const cy = canvas.height / 2;
  const shipX = cx;
  const shipY = canvas.height * 0.62;
  const time = now * 0.001;

  ctx.save();
  ctx.fillStyle = '#000';
  ctx.fillRect(0, 0, canvas.width, canvas.height);

  const travelAngle = (seeded((warp.to || 0) * 41) - 0.5) * 0.08;
  const speed = 72;
  const layers = [
    { count: 130, speed: 0.28, length: 3, width: 0.7, alpha: 0.34 },
    { count: 86, speed: 0.46, length: 6, width: 0.95, alpha: 0.5 },
    { count: 42, speed: 0.64, length: 10, width: 1.25, alpha: 0.62 },
  ];

  ctx.globalCompositeOperation = 'screen';
  ctx.save();
  ctx.translate(cx, cy);
  ctx.rotate(travelAngle);
  ctx.translate(-cx, -cy);
  for (let layerIndex = 0; layerIndex < layers.length; layerIndex += 1) {
    const layer = layers[layerIndex];
    for (let i = 0; i < layer.count; i += 1) {
      const seed = (warp.to || 0) * 503 + layerIndex * 911 + i * 37;
      const x = seeded(seed + 1) * (canvas.width + 220) - 110;
      const cycle = canvas.height + layer.length + 180;
      const y = ((seeded(seed + 2) * cycle + time * speed * layer.speed) % cycle) - layer.length - 90;
      const length = layer.length * (0.7 + seeded(seed + 3) * 0.6);
      const hue = seeded(seed + 4);
      const alpha = layer.alpha * (0.58 + seeded(seed + 5) * 0.42);
      ctx.strokeStyle = hue > 0.82
        ? `rgba(147, 214, 255, ${alpha})`
        : `rgba(232, 246, 255, ${alpha})`;
      ctx.lineWidth = layer.width * (0.72 + seeded(seed + 6) * 0.7);
      ctx.beginPath();
      ctx.moveTo(x, y);
      ctx.lineTo(x, y + length);
      ctx.stroke();
    }
  }
  ctx.restore();

  ctx.globalAlpha = 1;
  const wake = ctx.createLinearGradient(0, shipY - 260, 0, shipY + 320);
  wake.addColorStop(0, 'rgba(0, 0, 0, 0)');
  wake.addColorStop(0.45, 'rgba(74, 172, 255, 0.07)');
  wake.addColorStop(1, 'rgba(116, 214, 255, 0.18)');
  ctx.fillStyle = wake;
  ctx.fillRect(0, 0, canvas.width, canvas.height);

  const shipSprite = getShipSprite(state.playership);
  const shipVisual = getShipVisualProfile(state.playership);
  const shipScale = Math.max(0.88, state.ship.drawScale || shipVisual.scale);
  ctx.globalCompositeOperation = 'source-over';
  ctx.globalAlpha = 1;
  ctx.filter = 'none';
  ctx.save();
  ctx.globalAlpha = 0.52;
  ctx.filter = 'blur(18px)';
  const engineGlow = ctx.createRadialGradient(shipX, shipY + 52, 0, shipX, shipY + 52, 160);
  engineGlow.addColorStop(0, 'rgba(116, 214, 255, 0.64)');
  engineGlow.addColorStop(0.42, 'rgba(80, 128, 255, 0.18)');
  engineGlow.addColorStop(1, 'rgba(0, 0, 0, 0)');
  ctx.fillStyle = engineGlow;
  ctx.beginPath();
  ctx.ellipse(shipX, shipY + 56, 120, 56, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();

  if (!drawRotatedImage(shipSprite, shipX, shipY, shipVisual.width, shipVisual.height, 0, shipScale)) {
    ctx.save();
    ctx.translate(shipX, shipY);
    ctx.fillStyle = '#ffd66e';
    ctx.beginPath();
    ctx.moveTo(0, -24);
    ctx.lineTo(18, 18);
    ctx.lineTo(0, 8);
    ctx.lineTo(-18, 18);
    ctx.closePath();
    ctx.fill();
    ctx.restore();
  }

  ctx.globalCompositeOperation = 'source-over';
  const panelY = canvas.height - 74;
  const panelW = Math.min(520, canvas.width - 56);
  const panelX = cx - panelW / 2;
  ctx.fillStyle = 'rgba(0, 0, 0, 0.58)';
  ctx.fillRect(panelX, panelY, panelW, 34);
  ctx.strokeStyle = 'rgba(116, 214, 255, 0.62)';
  ctx.strokeRect(panelX, panelY, panelW, 34);
  ctx.fillStyle = 'rgba(116, 214, 255, 0.92)';
  ctx.fillRect(panelX + 3, panelY + 3, (panelW - 6) * progress, 28);
  ctx.fillStyle = '#ffffff';
  ctx.font = canvasUiFont(13, 'bold');
  ctx.textAlign = 'center';
  ctx.fillText(`WARP DRIVE  ${Math.round(progress * 100)}%  |  ${target?.name || 'planet system'}`, cx, panelY + 22);
  ctx.textAlign = 'start';
  ctx.restore();
}

function drawWormholeTransit(now = performance.now()) {
  const transit = state.wormholeTransit;
  if (!transit?.active) return;
  const progress = clamp((now - transit.startedAt) / Math.max(1, transit.duration), 0, 1);
  const pulse = Math.sin(progress * Math.PI);
  const cx = canvas.width * 0.5;
  const cy = canvas.height * 0.5;
  const maxRadius = Math.hypot(canvas.width, canvas.height) * 0.62;
  const aperture = maxRadius * (progress < WORMHOLE_TRANSIT_SWITCH_AT
    ? 1 - progress / WORMHOLE_TRANSIT_SWITCH_AT
    : (progress - WORMHOLE_TRANSIT_SWITCH_AT) / (1 - WORMHOLE_TRANSIT_SWITCH_AT));
  const twist = now * 0.004 + progress * Math.PI * 6;

  ctx.save();
  ctx.fillStyle = `rgba(0, 0, 0, ${0.32 + pulse * 0.48})`;
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.globalCompositeOperation = 'screen';

  const glow = ctx.createRadialGradient(cx, cy, 0, cx, cy, maxRadius);
  glow.addColorStop(0, `rgba(255, 255, 255, ${0.14 + pulse * 0.28})`);
  glow.addColorStop(0.18, `rgba(197, 156, 255, ${0.26 + pulse * 0.34})`);
  glow.addColorStop(0.42, `rgba(75, 220, 255, ${0.12 + pulse * 0.22})`);
  glow.addColorStop(1, 'rgba(0, 0, 0, 0)');
  ctx.fillStyle = glow;
  ctx.fillRect(0, 0, canvas.width, canvas.height);

  ctx.save();
  ctx.translate(cx, cy);
  ctx.rotate(twist * 0.22);
  for (let i = 0; i < 18; i += 1) {
    const t = i / 18;
    const radius = 34 + t * maxRadius * (0.95 + pulse * 0.12);
    const alpha = (1 - t) * (0.14 + pulse * 0.34);
    ctx.rotate(0.28);
    ctx.strokeStyle = i % 3 === 0
      ? `rgba(255, 246, 210, ${alpha})`
      : i % 2 === 0
        ? `rgba(117, 227, 255, ${alpha})`
        : `rgba(197, 156, 255, ${alpha})`;
    ctx.lineWidth = 1 + pulse * 2.4 + (1 - t) * 2;
    ctx.beginPath();
    ctx.ellipse(0, 0, radius, radius * (0.22 + t * 0.16), twist + t * Math.PI * 2, 0, Math.PI * 1.7);
    ctx.stroke();
  }
  ctx.restore();

  for (let i = 0; i < 120; i += 1) {
    const seed = i * 97 + (transit.to || 0) * 181;
    const angle = seeded(seed) * Math.PI * 2 + twist * (0.12 + seeded(seed + 1) * 0.22);
    const base = seeded(seed + 2);
    const travel = (base + progress * (0.95 + seeded(seed + 3) * 0.8)) % 1;
    const radius = aperture * 0.2 + travel * maxRadius;
    const length = 18 + pulse * 52 + seeded(seed + 4) * 42;
    const x = cx + Math.cos(angle) * radius;
    const y = cy + Math.sin(angle) * radius;
    ctx.strokeStyle = `rgba(232, 246, 255, ${0.16 + pulse * 0.54})`;
    ctx.lineWidth = 0.7 + seeded(seed + 5) * 1.8;
    ctx.beginPath();
    ctx.moveTo(x, y);
    ctx.lineTo(x - Math.cos(angle) * length, y - Math.sin(angle) * length);
    ctx.stroke();
  }

  ctx.globalCompositeOperation = 'source-over';
  const centerRadius = Math.max(18, aperture * 0.32 + pulse * 34);
  const center = ctx.createRadialGradient(cx, cy, 0, cx, cy, centerRadius * 2.4);
  center.addColorStop(0, `rgba(255, 255, 255, ${0.62 * pulse})`);
  center.addColorStop(0.28, `rgba(197, 156, 255, ${0.38 + pulse * 0.28})`);
  center.addColorStop(0.7, 'rgba(0, 0, 0, 0.82)');
  center.addColorStop(1, 'rgba(0, 0, 0, 0)');
  ctx.fillStyle = center;
  ctx.beginPath();
  ctx.arc(cx, cy, centerRadius * 2.4, 0, Math.PI * 2);
  ctx.fill();

  if (pulse > 0.84) {
    ctx.fillStyle = `rgba(255, 255, 255, ${(pulse - 0.84) * 1.45})`;
    ctx.fillRect(0, 0, canvas.width, canvas.height);
  }

  ctx.fillStyle = `rgba(197, 156, 255, ${0.24 + pulse * 0.42})`;
  ctx.font = canvasUiFont(13, 'bold');
  ctx.textAlign = 'center';
  ctx.fillText(transit.switched ? 'WORMHOLE EXIT VECTOR' : 'WORMHOLE ENTRY VECTOR', cx, canvas.height - 42);
  ctx.textAlign = 'start';
  ctx.restore();
}

function drawStationConstructionSite(station, p, stationRadius, now = performance.now()) {
  const progress = getStationConstructionProgress(station);
  const remaining = getStationConstructionRemaining(station);
  const pulse = 0.5 + Math.sin(now * 0.006) * 0.5;
  ctx.save();
  ctx.translate(p.x, p.y);
  ctx.globalCompositeOperation = 'screen';
  ctx.strokeStyle = `rgba(255, 214, 110, ${0.38 + pulse * 0.2})`;
  ctx.lineWidth = 1.5;
  ctx.setLineDash([8, 7]);
  ctx.beginPath();
  ctx.arc(0, 0, stationRadius * 0.88, now * 0.0012, now * 0.0012 + Math.PI * 1.7);
  ctx.stroke();
  ctx.setLineDash([3, 7]);
  ctx.strokeStyle = 'rgba(124, 226, 255, 0.34)';
  ctx.beginPath();
  ctx.arc(0, 0, stationRadius * 1.15, -now * 0.0009, -now * 0.0009 + Math.PI * 2);
  ctx.stroke();
  ctx.setLineDash([]);
  ctx.strokeStyle = 'rgba(156, 255, 180, 0.8)';
  ctx.lineWidth = 3;
  ctx.beginPath();
  ctx.arc(0, 0, stationRadius * 1.02, -Math.PI / 2, -Math.PI / 2 + Math.PI * 2 * progress);
  ctx.stroke();
  ctx.globalCompositeOperation = 'source-over';
  ctx.fillStyle = 'rgba(0, 0, 0, 0.62)';
  ctx.fillRect(-28, stationRadius + 10, 56, 18);
  ctx.strokeStyle = 'rgba(255, 214, 110, 0.42)';
  ctx.strokeRect(-28, stationRadius + 10, 56, 18);
  ctx.fillStyle = '#ffe0a0';
  ctx.font = canvasUiFont(11, 'bold');
  ctx.textAlign = 'center';
  ctx.fillText(`${remaining}d`, 0, stationRadius + 23);
  ctx.textAlign = 'start';
  ctx.restore();
}

function clearInterstellarMapOverlay() {
  if (!interstellarMapCtx || !interstellarMapCanvas) return;
  interstellarMapCtx.clearRect(0, 0, interstellarMapCanvas.width, interstellarMapCanvas.height);
}

function drawInterstellarMapOverlay() {
  if (!interstellarMapCtx || !interstellarMapCanvas) return false;
  clearInterstellarMapOverlay();
  const previousCtx = ctx;
  ctx = interstellarMapCtx;
  try {
    drawStarChartBackground();
    ctx.save();
    clipStarChartViewport();
    drawStarChartNebulaRegions();
    drawMapFactionTerritories();
    drawTravelRoutes();
    for (let i = 0; i < state.planets.length; i++) {
      drawPlanetMarker(state.planets[i], i);
    }
    ctx.restore();
    drawWorldPops();
  } finally {
    ctx = previousCtx;
  }
  return true;
}

function render() {
  ctx = gameCtx;
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  ctx.fillStyle = '#000';
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  drawMinimap();
  syncInterstellarMapFrame();
  updateTargetWindow();
  updateSecurityOrderPanel();
  refreshSecurityEncounterList();
  clearInterstellarMapOverlay();

  if (state.warp.active) {
    drawWarpSplash();
    return;
  }

  const renderMapPanel = state.mapOpen;
  if (renderMapPanel) state.mapOpen = false;

  drawStarField();
  const now = performance.now();
  drawInSystemWarpStreaks(now);
  drawFlightNebula();
  drawSystemStar(now);
  drawDecorativeSystemBodies(now);
  const flightPlanet = getFlightPlanetMarker();
  drawPlanetMarker(flightPlanet, state.currentPlanet);
  drawPlanetCallout(flightPlanet, now);

  const wormhole = state.wormhole ? worldToScreen(state.wormhole) : null;
  if (wormhole && sprites.wormhole?.complete) {
    ctx.drawImage(sprites.wormhole, wormhole.x - 26, wormhole.y - 26, 52, 52);
    ctx.fillStyle = '#c59cff';
    ctx.font = canvasUiFont(11);
    ctx.textAlign = 'center';
    ctx.fillText(state.wormhole.name || 'Wormhole', wormhole.x, wormhole.y - 32);
    ctx.textAlign = 'start';
  }
  drawSecurityZoneMarkers(now);
  for (const station of state.stations.filter(st=>sensorVisibleToPlayer(st))) {
    const p = worldToScreen(station);
    const stationVisual = getStationVisualProfile(station);
    const stationScale = stationVisual.scale;
    const stationDrawW = stationVisual.width;
    const stationDrawH = stationVisual.height;
    const stationRadius = getStationScreenRadius(station);
    if (p.x < -stationRadius - 60 || p.x > canvas.width + stationRadius + 60 || p.y < -stationRadius - 60 || p.y > canvas.height + stationRadius + 60) continue;
    if (station.destroyed) {
      drawStationDebris(station);
      continue;
    }
    const stationSprite = getShipSprite(station.stationTypeId);
    if (station.underConstruction) {
      drawStationConstructionSite(station, p, stationRadius);
      ctx.save();
      ctx.globalAlpha = 0.36 + getStationConstructionProgress(station) * 0.42;
      ctx.filter = 'grayscale(0.55) brightness(0.85)';
    }
    if (
      !drawRotatedImage(stationSprite, p.x, p.y, stationDrawW, stationDrawH, station.rotation || 0, stationScale)
      && shouldDrawAssetFallback(stationSprite)
    ) {
      ctx.save();
      ctx.translate(p.x, p.y);
      ctx.rotate((station.rotation || 0) * Math.PI / 180);
      ctx.fillStyle = '#9cffb4';
      ctx.fillRect(-stationDrawW * stationScale * 0.5, -stationDrawH * stationScale * 0.5, stationDrawW * stationScale, stationDrawH * stationScale);
      ctx.strokeStyle = '#dfeaff';
      ctx.strokeRect(-stationDrawW * stationScale * 0.5, -stationDrawH * stationScale * 0.5, stationDrawW * stationScale, stationDrawH * stationScale);
      ctx.restore();
    }
    if (station.underConstruction) ctx.restore();
  }

  for (const a of state.asteroids) {
    if (a.depleted) continue;
    const asteroid = worldToScreen(a);
    const asteroidSprite = getAsteroidSprite(a);
    if (asteroidSprite?.complete) {
      ctx.save();
      ctx.translate(asteroid.x, asteroid.y);
      ctx.rotate(finiteNumber(a.rotation, 0) * Math.PI / 180);
      ctx.drawImage(asteroidSprite, -a.r, -a.r, a.r * 2, a.r * 2);
      ctx.restore();
    }
  }

  for (const npc of state.npcShips) {
    if (npc.destroyed || npc.trafficWarp?.phase === 'away' || !sensorVisibleToPlayer(npc)) continue;
    const op = worldToScreen(npc);
    const npcVisual = getShipVisualProfile(npc.shipId);
    const npcRadius = getShipScreenRadius(npc.shipId, npc.scale || npcVisual.scale);
    if (op.x < -npcRadius - 40 || op.x > canvas.width + npcRadius + 40 || op.y < -npcRadius - 40 || op.y > canvas.height + npcRadius + 40) continue;
    const npcSprite = getShipSprite(npc.shipId);
    drawAmbientTrafficWarpFlash(op, npc, npcRadius);
    drawShipCruiseWarpTrail(op, npc.heading, npc.systemWarpIntensity, npcRadius);
    if (
      !drawRotatedImage(npcSprite, op.x, op.y, npcVisual.width, npcVisual.height, npc.heading, npc.scale)
      && shouldDrawAssetFallback(npcSprite)
    ) {
      ctx.save();
      ctx.translate(op.x, op.y);
      ctx.rotate(npc.heading * Math.PI / 180);
      ctx.fillStyle = '#9ce8ff';
      ctx.beginPath();
      ctx.moveTo(0, -14);
      ctx.lineTo(10, 10);
      ctx.lineTo(0, 5);
      ctx.lineTo(-10, 10);
      ctx.closePath();
      ctx.fill();
      ctx.restore();
    }
  }
  drawCombatTarget();

  const playerSprite = getShipSprite(state.playership);
  const playerVisual = getShipVisualProfile(state.playership);
  const playerAlpha = getPlayerCloakAlpha();
  drawShipCruiseWarpTrail({ x: state.ship.x, y: state.ship.y }, state.ship.rotation, state.ship.systemWarpIntensity, getShipScreenRadius(state.playership, state.ship.drawScale));
  ctx.save();
  ctx.globalAlpha = playerAlpha;
  if (
    !drawRotatedImage(playerSprite, state.ship.x, state.ship.y, playerVisual.width, playerVisual.height, state.ship.rotation, state.ship.drawScale)
    && shouldDrawAssetFallback(playerSprite)
  ) {
    ctx.save();
    ctx.translate(state.ship.x, state.ship.y);
    ctx.rotate(state.ship.rotation * Math.PI / 180);
    ctx.fillStyle = '#ffd66e';
    ctx.beginPath();
    ctx.moveTo(0, -16);
    ctx.lineTo(12, 11);
    ctx.lineTo(0, 5);
    ctx.lineTo(-12, 11);
    ctx.closePath();
    ctx.fill();
    ctx.restore();
  }
  ctx.restore();
  drawPlayerCloakEffect();
  drawProjectiles();
  drawWeaponEffects(performance.now(), 'all');
  drawActiveTractorBeams(performance.now());
  drawShieldEffects();

  drawWorldPops();
  drawWormholeTransit();

  if (renderMapPanel) {
    state.mapOpen = true;
    drawInterstellarMapOverlay();
  }

  if (state.gameOver) {
    ctx.fillStyle = 'rgba(0, 0, 0, 0.65)';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
  }

  if (!state.gameStarted) {
    ctx.fillStyle = 'rgba(0,0,0,0.55)';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
  }

  syncGameOverMenu();
}

function syncGameOverMenu() {
  if (!gameOverMenuEl) return;
  const visible = state.gameStarted && state.gameOver;
  gameOverMenuEl.classList.toggle('hidden', !visible);
  if (!visible) return;
  const title = 'Game Over';
  const description = 'Your ship has been lost. Restart cleanly, or eject and try to rebuild from an escape pod.';
  gameOverTitleEl.textContent = title;
  gameOverDescEl.textContent = description;
}

function resetRunState() {
  state.cargo = 0;
  state.mycargo = 0;
  state.cargoArray = createEmptyCargoArray();
  state.duranium = 0;
  state.myduranium = 0;
  state.activeContract = null;
  state.pendingContractOffer = null;
  state.missionCompleteNotice = null;
  renderMissionCompleteModal();
  state.pendingShipPurchase = null;
  state.pendingFleetPurchase = null;
  state.pendingStationBuild = null;
  state.pendingWormholeBuild = null;
  state.openContracts = [];
  state.day = 1;
  state.deliveredCargo = 0;
  state.tradeLaneRestored = false;
  state.expneg = 0;
  state.gameOver = false;
  state.victory = false;
  state.mapOpen = false;
  state.planetMenuOpen = false;
  state.dockMenuTab = 'services';
  state.docked = false;
  state.dockedPlanetIndex = null;
  state.dockedStationId = null;
  state.projectiles = [];
  state.weaponEffects = [];
  state.tractorBeams = [];
  state.combatTargetId = null;
  state.combatTargetType = 'ship';
  state.lastPlayerShotAt = 0;
  state.lastPlayerAggressionAt = 0;
  state.lastPlayerAggressionSystemIndex = null;
  state.lastPlayerAggressionTargetSide = null;
  state.weaponLastFiredAt = [0, 0, 0];
  state.cloak = { active: false, startedAt: 0, duration: finiteNumber(getCloakItemSettings().durationMs, CLOAK_DURATION_MS) };
  state.stationPlans = [];
  state.playerFlags = [];
  state.factionStanding = {};
  state.shipPurchaseTierThresholds = { ...PURCHASE_TIER_STANDING };
  state.feats = {};
  state.ew = sanitizeEW(); state.sensors = null; state.sensorArchives = {}; state.sensorReports = []; sensorWorld.clear(null); sensorActors.clear();
  state.power = { energy: 200, dist: { engines: 5, weapons: 5, shields: 5, sensors: 5 } };
  state.autoTarget = true;
  state.fleetStance = 'follow';
  state.auxLaunched = false;
  state.spawnProtectionUntil = 0;

  state.playerBuiltStations = [];
  state.playerWormholes = [];
  state.playerFleet = [];
  state.controlledSystems = [];
  state.stationOwners = {};
  state.securityPolicies = { default: null, systems: {} };
  resetSecurityRecords();
  state.visitedSystems = [];
  state.factionSystemOverrides = {};
  state.destroyedStations = {};
  state.depletedAsteroids = {};
  state.activeFleetAttack = null;
  state.fleetAttackControlSince = 0;
  state.nextFleetAttackAt = 0;
  state.stationDefinitions = state.stationDefinitions.filter((station) => !station.builtByPlayer);
  state.systemStates = {};
  state.travelRoutes = [];
  state.worldPops = [];
  state.planetCallout = null;
  state.mymenu = 0;
  state.cargopanel = 0;
  state.ship.velocity = 0;
  state.ship.turnVelocity = 0;
  state.ship.forwardThrustStartedAt = 0;
  state.ship.systemWarpIntensity = 0;
  state.starChart.panX = 0;
  state.starChart.panY = 0;
  state.starChart.zoom = STAR_CHART_DEFAULT_ZOOM;
  state.starChart.dragging = false;
  state.starChart.suppressClick = false;
  state.warp = {
    active: false,
    from: null,
    to: null,
    route: null,
    startedAt: 0,
    duration: WARP_DURATION_MS,
    message: '',
  };
  clearWormholeTransit();
  closePlanetMenu();
  syncGameOverMenu();
}

function restartGame() {
  resetRunState();
  state.gameStarted = false;
  state.startMenuView = 'main';
  renderStartMenu('main');
  setLog('Choose a starting faction.');
  updateStats();
  syncGameOverMenu();
}

function restartInEscapePod() {
  const currentPlanet = Math.max(0, Math.min(state.planets.length - 1, state.currentPlanet));
  const faction = state.playerFaction || 'ferengi';
  state.gameStarted = true;
  state.gameOver = false;
  state.victory = false;
  state.currentPlanet = currentPlanet;
  state.myplanet = currentPlanet + 1;
  markSystemVisited(state.currentPlanet);
  state.playerFaction = faction;
  normalizePlayerFlags();
  state.playership = 94;
  applyShipDefaultWeapons(state.playership, false);
  state.weaponLastFiredAt = [0, 0, 0];
  state.cargo = 0;
  state.mycargo = 0;
  state.cargoArray = createEmptyCargoArray();
  state.latinum = 0;
  state.mylatinum = 0;
  state.duranium = 0;
  state.myduranium = 0;
  state.antimatter = 1;
  state.myantimatter = 1;
  state.fuel = 1;
  state.hull = 100;
  state.shields = 100;
  state.lastShieldHitAt = 0;
  state.activeContract = null;
  state.pendingContractOffer = null;
  state.pendingShipPurchase = null;
  state.pendingFleetPurchase = null;
  state.pendingStationBuild = null;
  state.pendingWormholeBuild = null;
  state.openContracts = [];
  state.projectiles = [];
  state.weaponEffects = [];
  state.tractorBeams = [];
  state.worldPops = [];
  state.planetCallout = null;
  state.combatTargetId = null;
  state.combatTargetType = 'ship';
  state.lastPlayerShotAt = 0;
  state.lastPlayerAggressionAt = 0;
  state.lastPlayerAggressionSystemIndex = null;
  state.lastPlayerAggressionTargetSide = null;
  state.cloak = { active: false, startedAt: 0, duration: finiteNumber(getCloakItemSettings().durationMs, CLOAK_DURATION_MS) };
  state.mapOpen = false;
  state.planetMenuOpen = false;
  state.dockMenuTab = 'services';
  state.docked = false;
  state.dockedPlanetIndex = null;
  state.dockedStationId = null;
  state.mymenu = 0;
  state.cargopanel = 0;
  state.warp = {
    active: false,
    from: null,
    to: null,
    route: null,
    startedAt: 0,
    duration: WARP_DURATION_MS,
    message: '',
  };
  clearWormholeTransit();
  state.mytech = [undefined, 0];
  applyCurrentShipStats(true);
  state.antimatter = Math.min(1, state.fuelCap);
  syncFuelToAntimatter();
  syncPlayerBuiltStationDefinitions();
  applySystemState(state.currentPlanet);
  scheduleNextFleetAttack(performance.now() + 30000);
  setCameraNearPlanet();
  state.ship.x = canvas.width * 0.5;
  state.ship.y = canvas.height * 0.5;
  state.ship.velocity = 0;
  state.ship.turnVelocity = 0;
  state.ship.forwardThrustStartedAt = 0;
  state.ship.systemWarpIntensity = 0;
  state.ship.rotation = 0;
  startMenuEl.style.display = 'none';
  stopAllGameAudioLoops();
  playGameSound('shipLaunch', { cooldownKey: 'ship:escape-pod', volume: 0.75 });
  setLog('Escape pod launched. Find a planet or station and rebuild from scratch.');
  syncLegacyState();
  updateStats();
  syncGameOverMenu();
}

function isSpawnProtected(now = performance.now()) {
  return finiteNumber(state.spawnProtectionUntil, 0) > now;
}
// Arrival protection is personal: the player cannot be targeted for a short window (see
// isSpawnProtected, honored by NPC targeting and station defenses). It does not delete hostile
// fleets, erase their orders, change attitudes or ownership, or manufacture a ceasefire.
function calmHomeSystem() {
  state.spawnProtectionUntil = performance.now() + 20000;
}
function startWithFaction(key, options = {}) {
  const f = factionDefs[key];
  if (!f) return;
  resetRunState();
  state.currentSaveSlot = getFirstEmptySaveSlot();
  state.playership = resolveShipId(f.playership);
  state.playerFaction = f.faction || key;
  state.playerFlags = [state.playerFaction];
  state.factionStanding = {};
  state.feats = {};
  state.ew = sanitizeEW(); state.sensors = null; state.sensorArchives = {}; state.sensorReports = []; sensorWorld.clear(null); sensorActors.clear();
  state.power = { energy: 200, dist: { engines: 5, weapons: 5, shields: 5, sensors: 5 } };
  normalizePlayerFlags();
  state.captainName = sanitizePlayerName(options.captainName, 'Captain');
  state.shipName = sanitizeShipName(options.shipName, getShipStats(state.playership).name || 'Ship');
  applyShipDefaultWeapons(state.playership, false);
  state.weaponLastFiredAt = [0, 0, 0];
  state.myplanet = ((f.myplanet - 1) % state.planets.length) + 1;
  state.currentPlanet = Math.max(0, Math.min(state.planets.length - 1, state.myplanet - 1));
  adjustFactionStanding(state.playerFaction, HOME_FACTION_STANDING, { silent: true });
  markSystemVisited(state.currentPlanet);
  state.controlledSystems = [];
  state.stationOwners = {};
  state.securityPolicies = { default: null, systems: {} };
  resetSecurityRecords();
  transferSystemControlToPlayer(state.currentPlanet); // the start system's government installations are the side's
  state.myantimatter = f.myantimatter;
  state.antimatter = f.myantimatter;
  state.mylatinum = f.mylatinum;
  state.latinum = f.mylatinum;
  state.duranium = 0;
  state.myduranium = 0;
  state.mytech = [undefined, f.mytech1];
  applyCurrentShipStats(true);
  state.gameStarted = true;
  state.mapOpen = false;
  state.planetMenuOpen = false;
  state.dockMenuTab = 'services';
  state.docked = false;
  state.dockedPlanetIndex = null;
  state.dockedStationId = null;
  closePlanetMenu();
  applySystemState(state.currentPlanet);
  scheduleNextFleetAttack(performance.now() + 30000);
  setCameraNearPlanet();
  state.ship.x = canvas.width * 0.5;
  state.ship.y = canvas.height * 0.5;
  state.ship.velocity = 0;
  state.ship.turnVelocity = 0;
  state.ship.forwardThrustStartedAt = 0;
  state.ship.systemWarpIntensity = 0;
  state.ship.rotation = 0;
  renderStartMenu('main');
  playGameSound('shipLaunch', { cooldownKey: 'ship:new-game' });
  setLog(`${state.captainName} aboard ${state.shipName}. ${f.label} selected.`);
  const hint = getFactionHint(f.playership);
  if (hint) {
    setLog(`${state.captainName} aboard ${state.shipName}. FLA action hint -> ${hint}`);
  }
  syncLegacyState();
  updateStats();
}

startMenuEl?.addEventListener('mouseover', (e) => {
  const factionButton = e.target.closest('[data-faction]');
  const desc = document.getElementById('faction-desc');
  if (!factionButton || !desc) return;
  const f = factionDefs[factionButton.dataset.faction];
  if (f) desc.innerHTML = renderFactionLorePanel(f, 'choice-lore');
});

startMenuEl?.addEventListener('focusin', (e) => {
  const factionButton = e.target.closest('[data-faction]');
  const desc = document.getElementById('faction-desc');
  if (!factionButton || !desc) return;
  const f = factionDefs[factionButton.dataset.faction];
  if (f) desc.innerHTML = renderFactionLorePanel(f, 'choice-lore');
});

function cacheStartSetupInputs() {
  if (!startMenuEl || state.startMenuView !== 'setup') return;
  const captainInput = document.getElementById('start-captain-name');
  const shipInput = document.getElementById('start-ship-name');
  if (captainInput) state.captainName = captainInput.value;
  if (shipInput) state.shipName = shipInput.value;
}

startMenuEl?.addEventListener('click', async (e) => {
  const startView = e.target.closest('[data-start-view]');
  if (startView) {
    cacheStartSetupInputs();
    renderStartMenu(startView.dataset.startView || 'main');
    return;
  }
  const startGame = e.target.closest('[data-start-game]');
  if (startGame) {
    const factionKey = startGame.dataset.startGame || getStartSetupFaction();
    const faction = factionDefs[factionKey];
    if (!faction) return;
    const defaultShipName = getShipStats(faction.playership).name || 'Ship';
    const captainInput = document.getElementById('start-captain-name');
    const shipInput = document.getElementById('start-ship-name');
    startWithFaction(factionKey, {
      captainName: captainInput?.value || '',
      shipName: shipInput?.value || defaultShipName,
    });
    return;
  }
  const startOption = e.target.closest('[data-start-option]');
  if (startOption) {
    const key = startOption.dataset.startOption;
    if (Object.prototype.hasOwnProperty.call(DEFAULT_GAME_OPTIONS, key)) {
      setGameOption(key, !state.gameOptions?.[key]);
      renderStartMenu('options');
    }
    return;
  }
  const editorDataset = e.target.closest('[data-editor-dataset]');
  if (editorDataset) {
    setEditorDataset(editorDataset.dataset.editorDataset);
    return;
  }
  if (e.target.closest('[data-editor-prev]')) {
    moveEditorSelection(-1);
    return;
  }
  if (e.target.closest('[data-editor-next]')) {
    moveEditorSelection(1);
    return;
  }
  if (e.target.closest('[data-editor-save]')) {
    await saveEditorForm();
    return;
  }
  if (e.target.closest('[data-editor-toggle-raw]')) {
    const dataset = getEditorDataset();
    editorRuntime.rawOpen = !editorRuntime.rawOpen;
    editorRuntime.rawText = editorRuntime.rawOpen
      ? JSON.stringify(editorRuntime.data[dataset.file] || {}, null, 2)
      : '';
    renderStartMenu('editor');
    return;
  }
  if (e.target.closest('[data-editor-apply-raw]')) {
    await applyEditorRawJson();
    return;
  }
  if (e.target.closest('[data-editor-export]')) {
    downloadEditorDataset();
    return;
  }
  if (e.target.closest('[data-editor-reset]')) {
    await resetEditorDataset();
    return;
  }
  const startAction = e.target.closest('[data-start-action]');
  if (startAction) {
    const status = document.getElementById('start-action-status');
    const action = startAction.dataset.startAction;
    if (action === 'cache-offline') {
      navigator.serviceWorker?.controller?.postMessage({ type: 'BM2_CACHE_OFFLINE' });
      if (status) status.textContent = navigator.serviceWorker?.controller
        ? 'Offline cache refresh requested.'
        : 'Offline cache will refresh after the service worker is active.';
      return;
    }
    if (action === 'replay-intro') {
      unlockGameAudio();
      showIntroStory();
      return;
    }
    if (action === 'reset-faction-choice') {
      state.startSetupFaction = null;
      state.captainName = '';
      state.shipName = '';
      if (status) status.textContent = 'Faction choice reset.';
      return;
    }
    if (action === 'open-modding-guide') {
      window.open('MODDING.md', '_blank', 'noopener');
      return;
    }
  }
  const loadSlot = e.target.closest('[data-start-load-slot]');
  if (loadSlot && !loadSlot.disabled) {
    loadGame(Number(loadSlot.dataset.startLoadSlot));
    return;
  }
  const factionButton = e.target.closest('[data-faction]');
  if (factionButton) {
    state.startSetupFaction = factionButton.dataset.faction;
    const faction = factionDefs[state.startSetupFaction];
    state.captainName = '';
    state.shipName = faction ? getShipStats(faction.playership).name || '' : '';
    renderStartMenu('factions');
  }
});

startMenuEl?.addEventListener('change', (e) => {
  const editorSelect = e.target.closest('[data-editor-select]');
  if (editorSelect) {
    setEditorSelectedIndex(getEditorDatasetKey(), Number(editorSelect.value) || 0);
    editorRuntime.rawText = '';
    renderStartMenu('editor');
  }
});

let lastFrameTime = performance.now();
function loop(now = performance.now()) {
  const frameScale = Math.min(2.5, Math.max(0.25, (now - lastFrameTime) / 16.6667));
  lastFrameTime = now;
  tick(frameScale);
  render();
  requestAnimationFrame(loop);
}

updateStats();
setLog(state.log);
initGameAudio();
applyGameOptions();
showIntroStory();
syncLegacyState();
resizeCanvasDisplay();
loadSourceData();
loadFlaHints();
loadPlanetModels();
loadShipManifest();
loop();

document.addEventListener('click', event => {
 const ewButton=event.target.closest('[data-ew-order],[data-ew-buy]');
 if(ewButton){const a=ewButton.dataset.ewShip==='player'?state:state.npcShips.find(n=>sensorKey(n)===ewButton.dataset.ewShip);if(!a)return;
   if(ewButton.dataset.ewOrder){const [dim,value]=ewButton.dataset.ewOrder.split(':');if(!setEWOrder(a,dim,value))setLog('EW order unavailable: check equipment, command, docking or cloak.');}
   else buyEWModule(Number(ewButton.dataset.ewBuy),a);return;}
 const action=event.target.closest('[data-sensor-action]');if(action){startSensorAction(action.dataset.sensorAction);return;}
 const buy=event.target.closest('[data-sensor-buy]');if(buy){const a=buy.dataset.sensorShip==='player'?state:state.npcShips.find(n=>sensorKey(n)===buy.dataset.sensorShip);if(a)buySensorSuite(Number(buy.dataset.sensorBuy),a);}
});
