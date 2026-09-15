#!/usr/bin/env node
/**
 * Behavioral acceptance probe for BM1 Remastered.
 *
 * Boots the real game (index.html + src/main.js as a module) in headless Chromium,
 * starts a run, freezes the animation loop, then drives the engine's own tick()
 * as the single update path to check the handoff's acceptance scenarios:
 *
 *   S1 attribution
 *     a. NPC-only ship kill: no salvage, no standing change for any faction, no feat
 *     b. player ship kill still rewards and blames
 *     c. NPC-only station destruction: no salvage, no standing, no feat
 *     d. player-escort projectile kill (Photon Torpedo, single killing hit): the shot
 *        carries creditSource 'playerEscort', the victim records it, and the player
 *        is credited (chosen escort-credit rule)
 *     e. Bajora regression: NPCs destroy every live Bajoran station; the player gets
 *        no feat and no Cardassian standing
 *     f. positive control for e: the player's own kill clearing the last Bajoran
 *        station still unlocks the feat and the +15 Cardassian standing
 *   S3 political authority (Phase 1)
 *     a. Breen and Dominion have no declared relationship either way; the five formerly missing
 *        relation keys are present in the table as explicit empty lists; unknown keys warn once
 *     b. independent player: escort and owned station engage a raider through ticks; a hostile
 *        independent ship is a valid target and attacker; foreign-owned and private stations
 *        inside the player's system keep their owners
 *     c. visitors: a neutral trader never defends; a same-flag foreign patrol may assist a raid
 *        defense while staying foreign-owned and outside the player's command; a same-flag
 *        foreign vessel that fires on the player's station becomes an attacker and target
 *     d. raising another flag: control stays the player's, owned installations take the new flag,
 *        foreign-owned and private installations do not
 *     e. real raid capture (updateFleetAttacks) transfers control and the player's installations
 *        to the raider, not the foreign-owned station; reclaiming transfers them back
 *     f. unknown origin stays unknown, a custom polity ID is preserved verbatim, explicit
 *        independence is distinct per world and never the origin empire
 *     g. arrival protection is personal: hostile fleet, orders, factions and control survive it
 *     h. control and station owners for every planet resolve to the expected values before and
 *        after save/reload and after re-entry
 *     i. enemy defenders select and engage a player escort that attacks their installation
 *   S4 security policies (Phase 2, two-mode ROE)
 *     1 default equals Phase 1; 2 two holdings with different ROEs; 3 independent player;
 *     4 foreign-defense independence; 5 station retaliation; 6 explicit-order precedence;
 *     7 stale/unrelated raid evidence; 8 aggression scoped to the system, standing orders
 *     outside holdings; 9 partial-override inheritance; 10 flag change; 11 loss/reclaim;
 *     12 save/reload and legacy save; 13 UI authority
 *   S5.17 integration regressions: a policy tightened during an open visit takes effect,
 *        player aggression revokes clearance, and declared broadcast identity survives reload
 *   S2 pursuit vs. firing range
 *     a. a manhunt hunter (standing <= -50) keeps pursuing far beyond weapon range
 *     b. with its weapon ready, it never fires there (>2 cooldowns)
 *     c. inside range it fires and lands (beam fixture, so impact is instant)
 *
 * Fixture requirements are asserted; a missing fixture fails setup rather than
 * skipping a check. Nothing in the repository is modified: a small export shim is
 * appended to src/main.js in transit by the built-in static server.
 *
 * Usage:
 *   npm i -D playwright && npx playwright install chromium   # once
 *   npm run probe
 *   node scripts/behavior-probe.mjs --root <other-checkout> --screenshot out.png
 *
 * Exit code 0 when every check passes, 1 otherwise.
 */
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const args = process.argv.slice(2);
const argValue = (flag) => {
  const i = args.indexOf(flag);
  return i >= 0 ? args[i + 1] : null;
};
const ROOT = path.resolve(argValue('--root') || path.join(path.dirname(fileURLToPath(import.meta.url)), '..'));
const SCREENSHOT = argValue('--screenshot');
const SHOTS_DIR = argValue('--shots'); // stage the Phase 3 operator panel and the incoming player order, then capture both
const TIMEOUT_MS = Number(argValue('--timeout') || 45000);

const SHIM = `
// ---- behavior-probe export shim (injected in transit; never written to disk) ----
window.__bm1 = {
  sensorCanTrack, ensureActorSensors, startSensorAction, updateSensorSystems, ensureNpcPower, ensurePlayerPower, getActorPowerProfile,
  state, startWithFaction, createNpcShip, damageCombatTarget, tick, render,
  fireNpcWeapon, ensureStationCombatStats, ensureNpcCombatStats, getFactionStanding,
  playerWorldPosition, getNpcWeaponRange, getDefaultWeaponId, getWeapon,
  applySystemState, getSystemIndexByName,
  getSystemControl, getSystemControlBlockers, getFactionRelations, areFactionsAligned, areFactionsOpposed, factionRelations,
  isNpcSystemDefender, isNpcSystemAttacker, getPlayerEscortPriorityTarget, isPlayerEscortShipTarget, isPlayerEscortStationTarget,
  isNpcStationTarget, getNpcDefenseTarget, getStationOwner, getNpcSideId, isPlayerSideNpc,
  transferSystemControlToPlayer, transferSystemControlToFaction, updateFleetAttacks, getFleetAttackDefenders,
  raisePlayerFlag, calmHomeSystem, saveGame, loadGame, getSystemFaction, getSaveSlotKey,
  claimCurrentSystem, sidesAligned, isSystemControlled, hasFactionAccessAt, getClaimSystemStatus,
  getEffectiveSecurityPolicy, getSecurityPolicyDefault, getSecurityPolicyOverride, getPlayerRoeAt,
  setSecurityPolicyDefault, setSecurityPolicyOverride, clearSecurityPolicyOverride, fireStationWeapon,
  renderPlanetMenu, DEFAULT_SECURITY_POLICY, markPlayerEscortAttackOrder, beginAmbientTrafficArrival,
  getSecurityZone, getSecurityLedger, getPlayerSecurityOrder, setPlayerCheckpoint, getPlayerCheckpointConfig, getSecurityAnchorCandidates,
  getVisitorAccessDecision, getSecurityContact, respondToSecurityOrder, operateSecurityOrder, getSecurityDockingBlock, tryDockAtPlanetIndex,
  tryDockAtStation, getFlightPlanetMarker, setCamera, setCameraNearPlanet, placePlayerAtSecurityApproach, resetSecurityRecords, resolveSecurityPoint,
  getSecurityAuthorityEpoch, closePlayerSecurityOrders, completeWarpTravel, updateSecurityEncounters,
  // Resolves when the main loop's already-scheduled frame runs and tries to schedule the next one
  // (it calls requestAnimationFrame(loop) at the end of every frame). After that nothing is pending.
  freezeLoop(timeoutMs = 2000) {
    return new Promise((resolve) => {
      const timer = setTimeout(() => resolve(false), timeoutMs);
      window.requestAnimationFrame = (cb) => {
        if (cb && cb.name === 'loop') { clearTimeout(timer); resolve(true); }
        return 0;
      };
    });
  },
};
`;

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.webmanifest': 'application/manifest+json',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.mp3': 'audio/mpeg',
  '.ogg': 'audio/ogg',
  '.wav': 'audio/wav',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.ttf': 'font/ttf',
};

function startServer() {
  const server = http.createServer((req, res) => {
    const urlPath = decodeURIComponent((req.url || '/').split('?')[0]);
    const rel = urlPath === '/' ? 'index.html' : urlPath.replace(/^\/+/, '');
    const file = path.resolve(ROOT, rel);
    if ((!file.startsWith(ROOT + path.sep) && file !== ROOT) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) {
      res.writeHead(404); res.end('not found'); return;
    }
    const ext = path.extname(file).toLowerCase();
    res.setHeader('Content-Type', MIME[ext] || 'application/octet-stream');
    res.setHeader('Cache-Control', 'no-store');
    if (rel.replace(/\\/g, '/') === 'src/main.js') {
      res.end(fs.readFileSync(file, 'utf8') + SHIM);
      return;
    }
    fs.createReadStream(file).pipe(res);
  });
  return new Promise((resolve) => {
    server.listen(0, '127.0.0.1', () => resolve({ server, port: server.address().port }));
  });
}

async function loadPlaywright() {
  try {
    return await import('playwright');
  } catch {
    console.error('playwright is not installed. Run: npm i -D playwright && npx playwright install chromium');
    process.exit(2);
  }
}

// Runs inside the page. Must stay self-contained (no closures over Node scope).
async function scenarioRunner() {
  const out = { setup: [] };
  const B = window.__bm1;
  const s = B.state;
  async function scenarioBody() {
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const need = (cond, msg) => { if (!cond) out.setup.push(msg); return !!cond; };
  const READY = -1e9; // "weapon ready" that cannot depend on page uptime exceeding a scaled cooldown
  const snapStandings = () => JSON.stringify(s.factionStanding || {});
  const snapFeats = () => JSON.stringify(s.feats || {});
  const standing = (f) => B.getFactionStanding(f);
  const clearNpcs = () => { s.npcShips.splice(0, s.npcShips.length); };
  const clearShots = () => { if (Array.isArray(s.projectiles)) s.projectiles.splice(0, s.projectiles.length); };
  // Single update path: the engine's own tick(), N frames, with real sleeps so cooldowns elapse.
  const frames = async (n, each = null) => {
    for (let i = 0; i < n; i++) { if (each) each(i); B.tick(1); await sleep(30); }
  };

  B.startWithFaction('ferengi');
  for (let i = 0; i < 50 && !(s.stations && s.stations.length); i++) await sleep(100);
  need(await B.freezeLoop(), 'animation loop did not acknowledge its final frame');
  const startPlanet = s.currentPlanet;
  s.spawnProtectionUntil = 0;
  need(s.stations && s.stations.length > 0, 'start system has no stations');

  const spawn = (id, distance, opts = {}) => {
    const p = B.playerWorldPosition();
    const npc = B.createNpcShip({
      id, shipId: 1, faction: 'klingon', attitude: 'hostile', hostile: true, seed: id * 7,
      from: { x: p.x + distance, y: p.y }, role: 'patrol', ...opts,
    });
    B.ensureNpcCombatStats(npc);
    s.npcShips.push(npc);
    return npc;
  };

  out.stage = 'S1a';
  // ---------- S1a: NPC-only ship kill ----------
  clearNpcs(); clearShots();
  const victimOfNpc = spawn(9001, 900);
  let latinum = s.latinum, kl = standing('klingon'), stAll = snapStandings(), feats = snapFeats();
  B.damageCombatTarget(victimOfNpc, 99999, 'npc');
  out.npcShipKill = {
    destroyed: !!victimOfNpc.destroyed, latinumDelta: s.latinum - latinum,
    standingDelta: standing('klingon') - kl, anyStandingChanged: snapStandings() !== stAll, featsChanged: snapFeats() !== feats,
  };

  // ---------- S1b: player ship kill ----------
  const victimOfPlayer = spawn(9002, 900);
  latinum = s.latinum; kl = standing('klingon');
  B.damageCombatTarget(victimOfPlayer, 99999, 'player');
  out.playerShipKill = { destroyed: !!victimOfPlayer.destroyed, latinumDelta: s.latinum - latinum, standingDelta: standing('klingon') - kl };

  // ---------- S1c: NPC-only station destruction (start system) ----------
  const station = (s.stations || []).find((st) => st && !st.destroyed && !st.builtByPlayer && !st.underConstruction);
  if (need(station, 'S1c fixture: no destroyable station in start system')) {
    station.faction = 'klingon';
    B.ensureStationCombatStats(station);
    latinum = s.latinum; stAll = snapStandings(); feats = snapFeats();
    B.damageCombatTarget(station, 999999, 'npc');
    out.npcStationKill = {
      destroyed: !!station.destroyed, latinumDelta: s.latinum - latinum,
      anyStandingChanged: snapStandings() !== stAll, featsChanged: snapFeats() !== feats,
    };
  }

  out.stage = 'S1d';
  // ---------- S1d: player-escort projectile kill ----------
  clearNpcs(); clearShots();
  const target = spawn(9004, 320);
  s.originalShipWeaponSlots = s.originalShipWeaponSlots || {};
  const savedSlots2 = s.shipStatsById[2].defaultWeaponSlots;
  s.shipStatsById[2].defaultWeaponSlots = [15, null, null]; // explicit live catalog fixture: projectile credit must ride the shot
  const escort = spawn(9005, 40, { shipId: 2, faction: s.playerFaction, attitude: 'friendly', hostile: false, role: 'playerEscort', fleetId: 'probe-escort' });
  const escortWeapon = B.getWeapon(B.getDefaultWeaponId(escort.shipId, escort.faction, true));
  need(escortWeapon.type === 'Torpedo', `S1d fixture: escort weapon is ${escortWeapon.name} (${escortWeapon.type}), expected a Torpedo`);
  escort.lastShotAt = READY;
  const savedStations = s.stations;
  s.stations = []; // station defenses fire with source 'station' and would steal the last hit
  target.combatShields = 0;
  target.combatHull = 1;
  // This case tests projectile credit, not a randomly timed evasive maneuver.
  // Hold the one-hit fixture still and start its normal shield-recovery delay.
  target.waitUntil = performance.now() + 60000;
  target.lastShieldHitAt = performance.now();
  latinum = s.latinum; kl = standing('klingon');
  B.fireNpcWeapon(escort, target, 'ship', performance.now());
  const shot = (s.projectiles || []).find((p) => p.targetId === target.id);
  need(shot, 'S1d fixture: escort produced no projectile aimed at the target');
  escort.lastShotAt = performance.now() + 1e9; // one shot only; the escort AI must not fire again during flight
  // This case tests projectile credit, not evasive maneuvers. Keep the victim at
  // the launch distance; the separate S2 cases exercise moving/pursuing ships.
  const impactFixture = { x: target.x, y: target.y };
  for (let i = 0; i < 400 && !target.destroyed; i++) {
    target.x = impactFixture.x; target.y = impactFixture.y;
    B.tick(1); await sleep(16);
  }
  s.stations = savedStations;
  s.shipStatsById[2].defaultWeaponSlots = savedSlots2;
  out.escortProjectileKill = {
    shotOwner: shot?.owner, shotCredit: shot?.creditSource, lastDamageSource: target.lastDamageSource,
    destroyed: !!target.destroyed, latinumDelta: s.latinum - latinum, standingDelta: standing('klingon') - kl,
  };

  out.stage = 'S1e';
  // ---------- S1e / S1f: Bajora feat ----------
  clearNpcs(); clearShots();
  const bajora = B.getSystemIndexByName('Bajora');
  const stationIds = (list) => list.map((st) => st.id).sort().join(',');
  const enterBajora = (resetIds = []) => {
    delete s.systemStates[bajora]; // fresh snapshot
    for (const id of resetIds) delete s.destroyedStations?.[id]; // destruction persists by station ID, so reset exactly the ones we destroyed
    s.currentPlanet = bajora; s.myplanet = bajora + 1; s.selectedPlanet = bajora;
    B.applySystemState(bajora);
    s.spawnProtectionUntil = 0;
    clearNpcs(); clearShots();
    return (s.stations || []).filter((st) => st && !st.destroyed && !st.builtByPlayer);
  };
  let live = need(bajora >= 0 && s.planets[bajora]?.name === 'Bajora', 'S1e fixture: Bajora system not found') ? enterBajora() : [];
  const bajoraIds = live.map((st) => st.id);
  if (need(live.length > 0, 'S1e fixture: Bajora has no live stations') && need(!s.feats?.bajoranFleetDown, 'S1e fixture: feat already set')) {
    latinum = s.latinum; const card = standing('cardassian'); stAll = snapStandings(); feats = snapFeats();
    for (const st of live) { B.ensureStationCombatStats(st); B.damageCombatTarget(st, 999999, 'npc'); }
    out.bajoraNpcOnly = {
      stations: live.length, allDestroyed: live.every((st) => st.destroyed),
      featSet: !!s.feats?.bajoranFleetDown, cardassianDelta: standing('cardassian') - card,
      latinumDelta: s.latinum - latinum, anyStandingChanged: snapStandings() !== stAll, featsChanged: snapFeats() !== feats,
    };
    // S1f positive control: the same station set, but the player lands the final kill.
    if (s.feats) delete s.feats.bajoranFleetDown;
    live = enterBajora(bajoraIds);
    out.bajoraStationSets = { first: bajoraIds.slice().sort().join(','), second: stationIds(live) };
    if (need(live.length > 0, 'S1f fixture: Bajora has no live stations after reset')
      && need(stationIds(live) === out.bajoraStationSets.first, 'S1f fixture: station set differs from S1e')) {
      const card2 = standing('cardassian');
      for (const st of live.slice(0, -1)) { B.ensureStationCombatStats(st); B.damageCombatTarget(st, 999999, 'npc'); }
      const last = live[live.length - 1];
      B.ensureStationCombatStats(last);
      B.damageCombatTarget(last, 999999, 'player');
      out.bajoraPlayerFinal = { stations: live.length, allDestroyed: live.every((st) => st.destroyed), featSet: !!s.feats?.bajoranFleetDown, cardassianDelta: standing('cardassian') - card2 };
    }
  }

  out.stage = 'S2';
  // ---------- S2: pursuit vs. firing range ----------
  clearNpcs(); clearShots();
  s.factionStanding = s.factionStanding || {};
  s.factionStanding.klingon = -60;
  const savedSlots1 = s.shipStatsById[1].defaultWeaponSlots;
  s.shipStatsById[1].defaultWeaponSlots = [1, null, null]; // explicit beam fixture, so impact is instant
  const hunter = spawn(9003, 4000);
  B.ensureActorSensors(hunter).suite = 3; // long-range hunter fixture; tracking remains independent of weapon reach
  const hunterWeapon = B.getWeapon(B.getDefaultWeaponId(hunter.shipId, hunter.faction, true));
  need(hunterWeapon.type === 'Beam', `S2 fixture: hunter weapon is ${hunterWeapon.name} (${hunterWeapon.type}), expected a Beam`);
  const weaponRange = B.getNpcWeaponRange(hunter);
  const stationsAside = s.stations;
  s.stations = []; // keep station defenses from killing the hunter mid-phase
  const pin = (distance) => { const p = B.playerWorldPosition(); hunter.x = p.x + distance; hunter.y = p.y; hunter.combatHull = Math.max(hunter.combatHull || 1, 1); };
  const runPhase = async (distance, ms, stopWhenFired = false) => {
    hunter.lastShotAt = READY;
    const hitBefore = s.lastShieldHitAt || 0;
    const pool0 = s.shields + s.hull;
    let maxDrop = 0;
    const t0 = performance.now();
    while (performance.now() - t0 < ms) {
      pin(distance);
      // Sustained active transmissions make the far player detectable; this tests firing range, not invisible pursuit.
      if (distance > weaponRange) B.startSensorAction('sweep');
      B.tick(1);
      maxDrop = Math.max(maxDrop, pool0 - (s.shields + s.hull));
      if (stopWhenFired && hunter.lastShotAt > READY) break;
      await sleep(30);
    }
    return { fired: hunter.lastShotAt > READY, playerHitAfter: (s.lastShieldHitAt || 0) > hitBefore, maxDrop, pursuing: hunter.destinationName === 'player', alive: !hunter.destroyed, elapsedMs: Math.round(performance.now() - t0) };
  };
  B.ensurePlayerPower().energy = B.getActorPowerProfile().energyCapacity;
  B.ensureNpcPower(hunter).energy = B.getActorPowerProfile(hunter).energyCapacity;
  const previousSensorSuite = B.ensureActorSensors().suite;
  B.ensureActorSensors().suite = 3;
  const previousPowerDistribution = { ...s.power.dist };
  s.power.dist = { engines: 0, weapons: 0, shields: 0, sensors: 10 };
  const farDistance = Math.max(4000, Math.round(weaponRange * 4));
  // Detection has an acquisition delay measured in simulation time. Establish a real
  // track before timing the independent range assertion, including on a cold browser.
  for (let i = 0; i < 120 && !B.sensorCanTrack(hunter, s); i++) {
    pin(farDistance); B.startSensorAction('sweep'); B.tick(1); await sleep(16);
  }
  need(B.sensorCanTrack(hunter, s), 'S2 fixture: hunter did not acquire the actively transmitting player');
  out.far = { weaponRange, distance: farDistance, ...(await runPhase(farDistance, 4000)) };
  const nearDistance = Math.round(weaponRange * 0.5);
  out.near = { distance: nearDistance, ...(await runPhase(nearDistance, 4000, true)) };
  B.ensureActorSensors().suite = previousSensorSuite; B.startSensorAction('cancel'); s.power.dist = previousPowerDistribution;
  s.stations = stationsAside;
  s.shipStatsById[1].defaultWeaponSlots = savedSlots1;

  out.stage = 'S3';
  // ---------- S3: political authority ----------
  clearNpcs(); clearShots();
  s.factionStanding.klingon = 0;
  const warnings = [];
  const origWarn = console.warn;
  console.warn = (...args) => { warnings.push(args.join(' ')); };
  const rel = (k) => B.getFactionRelations(k);
  rel('probe_unknown_key'); rel('probe_unknown_key');
  const fiveKeys = ['delpin', 'promelli', 'sona', 'tarellian', 'neutral'];
  out.relations = {
    breenDominionAligned: B.areFactionsAligned('breen', 'dominion') || B.areFactionsAligned('dominion', 'breen'),
    breenDominionOpposed: B.areFactionsOpposed('breen', 'dominion') || B.areFactionsOpposed('dominion', 'breen'),
    breenFriendly: rel('breen').friendly.slice(), dominionFriendly: rel('dominion').friendly.slice(),
    entriesPresent: fiveKeys.every((k) => Object.prototype.hasOwnProperty.call(B.factionRelations, k)),
    explicitEmpty: fiveKeys.every((k) => B.factionRelations[k].friendly.length === 0 && B.factionRelations[k].hostile.length === 0),
    unknownKeyWarnings: warnings.filter((w) => w.includes('probe_unknown_key')).length,
  };
  console.warn = origWarn;

  // Fixtures in the start system: one foreign-owned (Vulcan) and one private (neutral) station,
  // cloned from an existing definition so they render and fight like real ones.
  const home = startPlanet;
  const govDef = s.stationDefinitions.find((d) => Number(d.systemIndex) === home && !d.builtByPlayer && (d.faction === undefined || d.faction === null) && !s.destroyedStations[d.id]);
  need(govDef, 'S3 fixture: no government station definition in start system');
  const foreignDef = { ...govDef, id: 'probe-foreign-vulcan', name: 'Vulcan Science Concession', faction: 'vulcan', offset: { ...(govDef.offset || {}), x: (govDef.offset?.x || 0) + 260 } };
  const privateDef = { ...govDef, id: 'probe-private-1', name: 'Independent Trade Post', faction: 'neutral', offset: { ...(govDef.offset || {}), x: (govDef.offset?.x || 0) - 260 } };
  const ferengiDef = { ...govDef, id: 'probe-foreign-ferengi', name: 'Ferengi Commerce Hub', faction: 'ferengi', offset: { ...(govDef.offset || {}), y: (govDef.offset?.y || 0) + 260 } };
  // Acquire the government installations before adding the foreign concessions.
  // Faction membership grants no property.
  B.transferSystemControlToPlayer(home);
  s.stationDefinitions.push(foreignDef, privateDef, ferengiDef);
  const enterHome = () => { delete s.systemStates[home]; s.currentPlanet = home; s.myplanet = home + 1; s.selectedPlanet = home; B.applySystemState(home); s.spawnProtectionUntil = 0; clearNpcs(); clearShots(); };
  const findStation = (id) => (s.stations || []).find((st) => st.id === id);
  const govId = govDef.id;
  const ownersNow = () => ({ gov: B.getStationOwner(findStation(govId), home), foreign: B.getStationOwner(findStation('probe-foreign-vulcan'), home), priv: B.getStationOwner(findStation('probe-private-1'), home) });
  const pAt = (dx, dy = 0) => { const p = B.playerWorldPosition(); return { x: p.x + dx, y: p.y + dy }; };
  const mk = (id, faction, opts, at) => { const n = B.createNpcShip({ id, shipId: 1, faction, attitude: 'neutral', hostile: false, seed: id, from: at, role: 'patrol', ...opts }); B.ensureNpcCombatStats(n); s.npcShips.push(n); return n; };

  out.stage = 'S3b';
  // S3b: independent player, owned station + escort vs a raider, driven through ticks.
  s.playerFlags = ['ferengi', 'klingon'];
  s.playerFaction = 'neutral';
  s.fleetStance = 'attack';
  enterHome();
  const gov = findStation(govId);
  const raider = mk(9301, 'klingon', { attitude: 'hostile', hostile: true }, { x: gov.x + 220, y: gov.y });
  raider.lastShotAt = READY;
  const escortI = mk(9302, s.playerFaction, { shipId: 2, attitude: 'friendly', hostile: false, role: 'playerEscort', fleetId: 'probe-escort' }, { x: gov.x + 120, y: gov.y + 60 });
  escortI.lastShotAt = READY;
  s.combatTargetId = null;
  const pool = (n) => (n.combatShields || 0) + (n.combatHull || 0);
  const prePool = pool(raider);
  for (let i = 0; i < 80 && !(raider.lastDamageSource && (pool(raider) < prePool || raider.destroyed)); i++) { B.tick(1); await sleep(30); }
  out.independent = {
    control: B.getSystemControl(home), owners: ownersNow(), govFlag: gov.faction, govOwned: !!gov.ownedByPlayer,
    foreignFlag: findStation('probe-foreign-vulcan').faction, foreignOwned: !!findStation('probe-foreign-vulcan').ownedByPlayer,
    escortIsDefender: B.isNpcSystemDefender(escortI), raiderAttacksEscortSide: B.isNpcSystemAttacker(raider, escortI),
    escortTargetsRaider: B.getPlayerEscortPriorityTarget(escortI)?.target?.id === raider.id,
    raiderDamagedBy: raider.lastDamageSource, raiderHullDropped: pool(raider) < prePool || !!raider.destroyed,
    escortFired: escortI.lastShotAt > READY, stationFired: (gov.lastShotAt || 0) > 0,
  };
  // hostile independent ship against independent player assets
  clearNpcs(); clearShots();
  const govLive = findStation(govId);
  const hostileIndependent = mk(9303, 'neutral', { attitude: 'hostile', hostile: true }, { x: govLive.x + 200, y: govLive.y });
  const escortI2 = mk(9304, s.playerFaction, { shipId: 2, attitude: 'friendly', hostile: false, role: 'playerEscort', fleetId: 'probe-escort' }, { x: govLive.x + 100, y: govLive.y });
  out.hostileNeutral = {
    escortTarget: B.isPlayerEscortShipTarget(hostileIndependent), attackerToEscort: B.isNpcSystemAttacker(hostileIndependent, escortI2),
    canTargetStation: B.isNpcStationTarget(hostileIndependent, govLive), stationState: { destroyed: !!govLive.destroyed, attitude: govLive.attitude, owner: B.getStationOwner(govLive, home) },
    sideId: B.getNpcSideId(hostileIndependent),
  };

  out.stage = 'S3c';
  // S3c: visitors under the Ferengi flag.
  s.playerFaction = 'ferengi'; enterHome();
  const trader = mk(9305, 'neutral', { attitude: 'friendly', role: 'traffic' }, pAt(400));
  const patrolF = mk(9306, 'ferengi', { attitude: 'friendly', role: 'patrol' }, pAt(500));
  const pirate = mk(9307, 'pirate', { attitude: 'hostile', hostile: true, role: 'patrol' }, pAt(700));
  pirate.attackId = 'raid-visitors';
  const merchantF = mk(9308, 'ferengi', { attitude: 'friendly', role: 'traffic' }, pAt(450, 200));
  const govNow = findStation(govId);
  merchantF.lastShotAt = READY;
  merchantF.x = govNow.x + 200; merchantF.y = govNow.y;
  B.fireNpcWeapon(merchantF, govNow, 'station', performance.now());
  const ferengiHub = findStation('probe-foreign-ferengi');
  const hubCalm = B.isPlayerEscortStationTarget(ferengiHub);
  ferengiHub.hostile = true;
  const hubHostile = B.isPlayerEscortStationTarget(ferengiHub);
  ferengiHub.hostile = false;
  out.visitors = {
    playerControlled: B.getSystemControl(home).playerControlled,
    sameFlagStation: { owner: B.getStationOwner(ferengiHub, home), flag: ferengiHub.faction, targetWhenCalm: hubCalm, targetWhenHostile: hubHostile },
    traderDefends: B.isNpcSystemDefender(trader),
    patrolMayAssist: B.isNpcSystemDefender(patrolF), patrolEngagesPirate: B.getNpcDefenseTarget(patrolF)?.id === pirate.id,
    patrolOwnerUnchanged: patrolF.faction === 'ferengi' && B.getNpcSideId(patrolF) === 'ferengi' && !B.isPlayerSideNpc(patrolF),
    merchantAttacker: B.isNpcSystemAttacker(merchantF, null), merchantEscortTarget: B.isPlayerEscortShipTarget(merchantF),
    merchantAggressionSide: merchantF.lastAggressionTargetSide,
  };

  out.stage = 'S3d';
  // S3d: raise another flag; owners must not move, only the flag on owned installations.
  B.raisePlayerFlag('klingon');
  enterHome();
  out.flagChange = {
    playerFaction: s.playerFaction, control: B.getSystemControl(home), owners: ownersNow(),
    govFlag: findStation(govId).faction, govOwned: !!findStation(govId).ownedByPlayer,
    foreignFlag: findStation('probe-foreign-vulcan').faction, foreignOwned: !!findStation('probe-foreign-vulcan').ownedByPlayer,
    privFlag: findStation('probe-private-1').faction, privOwned: !!findStation('probe-private-1').ownedByPlayer,
  };

  out.stage = 'S3e';
  // Same-flag raid: Klingon raiders against a Klingon-flagged player; the escorts (also Klingon-flagged)
  // are player-side, so they count as defenders and treat the raiders as targets.
  enterHome();
  const kRaiders = [9315, 9316].map((id, k) => { const n = mk(id, 'klingon', { attitude: 'neutral', hostile: false, role: 'fleetAttack' }, pAt(900 + k * 80)); n.attackId = 'raid-sameflag'; return n; });
  s.activeFleetAttack = { id: 'raid-sameflag', faction: 'klingon', systemIndex: home };
  const kEscort = mk(9317, s.playerFaction, { shipId: 2, attitude: 'friendly', hostile: false, role: 'playerEscort', fleetId: 'probe-escort' }, pAt(80));
  const kDef = B.getFleetAttackDefenders('klingon', kRaiders, performance.now());
  out.sameFlagRaid = {
    playerFlag: s.playerFaction, raiderFlag: kRaiders[0].faction, escortFlag: kEscort.faction, escortSide: B.getNpcSideId(kEscort),
    escortCounted: kDef.ships.some((n) => n.id === kEscort.id), raiderIsTarget: B.isPlayerEscortShipTarget(kRaiders[0]),
    raiderAttacksEscort: B.isNpcSystemAttacker(kRaiders[0], kEscort),
  };
  s.activeFleetAttack = null;

  // S3e: real raid capture through updateFleetAttacks, then reclaim.
  enterHome();
  for (const st of (s.stations || [])) { if (B.getStationOwner(st, home) === 'player' && !st.destroyed) { B.ensureStationCombatStats(st); B.damageCombatTarget(st, 999999, 'npc'); } }
  const attackers = [9311, 9312].map((id, k) => { const n = mk(id, 'romulan', { attitude: 'hostile', hostile: true, role: 'fleetAttack' }, pAt(2000 + k * 100)); n.attackId = 'raid-real'; return n; });
  // A peaceful Ferengi patrol (no quarrel with Romulans) is present the whole time; it must not
  // count as a defender against this fleet, and must survive the capture unchanged.
  const bystander = mk(9313, 'ferengi', { attitude: 'friendly', role: 'patrol' }, pAt(600, -300));
  s.activeFleetAttack = { id: 'raid-real', faction: 'romulan', systemIndex: home };
  s.nextFleetAttackAt = performance.now() + 1e9;
  s.lastPlayerShotAt = READY;
  s.fleetAttackControlSince = performance.now() - 30000;
  const defendersWithConcession = B.getFleetAttackDefenders('romulan', attackers, performance.now());
  const concessionHolds = { stations: defendersWithConcession.stations.map((st) => st.id), ships: defendersWithConcession.ships.length };
  B.updateFleetAttacks(performance.now());
  const stillPlayerWhileConcessionStands = B.getSystemControl(home).controller;
  // The Romulans reduce the Vulcan concession too (it was shooting at them); now nothing engages the fleet.
  const concessionStation = findStation('probe-foreign-vulcan');
  B.ensureStationCombatStats(concessionStation); B.damageCombatTarget(concessionStation, 999999, 'npc');
  s.fleetAttackControlSince = performance.now() - 30000;
  const defendersAtCapture = B.getFleetAttackDefenders('romulan', attackers, performance.now());
  B.updateFleetAttacks(performance.now());
  const lost = B.getSystemControl(home);
  const ownersLost = ownersNow();
  const attackersAfter = attackers.map((n) => ({ faction: n.faction, role: n.role }));
  const stationsLostRuntime = findStation(govId);
  const bystanderAfterCapture = { faction: bystander.faction, side: B.getNpcSideId(bystander), alive: !bystander.destroyed, defends: B.isNpcSystemDefender(bystander), targetsFleet: B.getNpcDefenseTarget(bystander)?.id || null };
  // The surviving occupation fleet must block reclamation; the Vulcan concession, private post and the
  // Ferengi visitor must not. Then the occupation is destroyed and the real Claim button is used.
  s.docked = true; s.latinum = 1e6; s.duranium = 1e6;
  const blockedStatus = B.getClaimSystemStatus(home);
  const blockedBy = B.getSystemControlBlockers(home);
  B.claimCurrentSystem();
  const stillLost = B.getSystemControl(home).controller;
  for (const n of attackers) B.damageCombatTarget(n, 999999, 'npc');
  const clearedStatus = B.getClaimSystemStatus(home);
  B.claimCurrentSystem();
  const reclaimed = B.getSystemControl(home);
  const cachedGov = (s.systemStates[home]?.stations || []).find((st) => st.id === govId);
  const cachedForeign = (s.systemStates[home]?.stations || []).find((st) => st.id === 'probe-foreign-vulcan');
  const claimRuntime = { govFlag: findStation(govId)?.faction, govOwner: B.getStationOwner(findStation(govId), home), foreignFlag: findStation('probe-foreign-vulcan')?.faction, foreignOwner: B.getStationOwner(findStation('probe-foreign-vulcan'), home), foreignAttitude: findStation('probe-foreign-vulcan')?.attitude };
  const claimCache = { govFlag: cachedGov?.faction, foreignFlag: cachedForeign?.faction, foreignOwned: !!cachedForeign?.ownedByPlayer };
  out.reconquest = {
    concessionHolds, stillPlayerWhileConcessionStands,
    capturePreconditions: { stations: defendersAtCapture.stations.length, ships: defendersAtCapture.ships.length, player: defendersAtCapture.player },
    lostController: lost.controller, ownersLost, govFlagLost: stationsLostRuntime?.faction, govOwnedLost: !!stationsLostRuntime?.ownedByPlayer,
    attackersAfter, bystanderAfterCapture,
    reclaimBlocked: { canClaim: blockedStatus.canClaim, blockers: blockedBy.map((b) => `${b.type}:${b.faction}`), stillLost, clearedCanClaim: clearedStatus.canClaim },
    reclaimedController: reclaimed.controller, ownersReclaimed: ownersNow(), govFlagReclaimed: findStation(govId).faction, claimRuntime, claimCache,
  };
  s.docked = false;

  out.stage = 'S3f';
  // S3f: unknown origin, custom polity, distinct independence.
  const earth = B.getSystemIndexByName('Earth');
  const vulcan = B.getSystemIndexByName('Vulcan');
  s.planets.push({ name: 'Zzyx Prime', governmentId: 99, x: 10, y: 10, index: s.planets.length + 1 });
  const zz = s.planets.length - 1;
  const unknown = B.getSystemControl(zz);
  s.factionSystemOverrides[zz] = 'Zzyx-Council';
  const custom = B.getSystemControl(zz);
  const polityShipA = B.createNpcShip({ id: 9341, shipId: 1, faction: 'neutral', seed: 1, from: pAt(300), role: 'patrol', sideId: 'Zzyx-Council' });
  const polityShipB = B.createNpcShip({ id: 9342, shipId: 3, faction: 'neutral', seed: 2, from: pAt(350), role: 'traffic', sideId: 'Zzyx-Council' });
  const loneShip = B.createNpcShip({ id: 9343, shipId: 3, faction: 'neutral', seed: 3, from: pAt(400), role: 'traffic' });
  const polityStationDef = { ...govDef, id: 'probe-zzyx-station', systemIndex: zz, faction: 'Zzyx-Council' };
  out.customPolity = {
    controller: custom.controller, polityId: custom.polityId,
    shipSides: [B.getNpcSideId(polityShipA), B.getNpcSideId(polityShipB), B.getNpcSideId(loneShip)],
    stationOwner: B.getStationOwner(polityStationDef, zz),
    shipsAligned: B.sidesAligned(B.getNpcSideId(polityShipA), B.getNpcSideId(polityShipB)),
    shipStationAligned: B.sidesAligned(B.getNpcSideId(polityShipA), B.getStationOwner(polityStationDef, zz)),
    loneAligned: B.sidesAligned(B.getNpcSideId(loneShip), B.getNpcSideId(polityShipA)),
    stationOwnedByPolity: B.getStationOwner(polityStationDef, zz) === custom.polityId,
  };
  s.factionSystemOverrides[earth] = 'neutral';
  s.factionSystemOverrides[vulcan] = 'neutral';
  const earthI = B.getSystemControl(earth); const vulcanI = B.getSystemControl(vulcan);
  out.identity = {
    unknown: { origin: unknown.origin, originSource: unknown.originSource, controller: unknown.controller, polityId: unknown.polityId },
    custom: { controller: custom.controller, polityId: custom.polityId, allegiance: custom.allegiance },
    earth: { origin: earthI.origin, controller: earthI.controller, polityId: earthI.polityId, allegiance: B.getSystemFaction(earth) },
    distinctPolities: earthI.polityId !== vulcanI.polityId && vulcanI.controller === 'neutral',
  };
  delete s.factionSystemOverrides[zz]; delete s.factionSystemOverrides[vulcan]; s.planets.pop();

  out.stage = 'S3g';
  // S3g: arrival protection is personal.
  enterHome();
  const fleet = [9321, 9322].map((id, k) => { const n = mk(id, 'romulan', { attitude: 'hostile', hostile: true, role: 'fleetAttack' }, pAt(700 + k * 80)); n.attackId = 'raid-probe'; return n; });
  const visitorBefore = mk(9323, 'vulcan', { attitude: 'neutral', role: 'traffic' }, pAt(900));
  const controlBefore = JSON.stringify(B.getSystemControl(home));
  const stationAttBefore = (s.stations || []).map((st) => st.attitude).join(',');
  B.calmHomeSystem();
  out.arrival = {
    protectionSet: s.spawnProtectionUntil > performance.now(),
    fleetSurvived: fleet.every((n) => s.npcShips.includes(n) && !n.destroyed),
    ordersKept: fleet.every((n) => n.attackId === 'raid-probe' && n.hostile === true && n.attitude === 'hostile'),
    factionsKept: fleet.every((n) => n.faction === 'romulan') && visitorBefore.faction === 'vulcan',
    controlUnchanged: JSON.stringify(B.getSystemControl(home)) === controlBefore,
    stationAttitudesUnchanged: (s.stations || []).map((st) => st.attitude).join(',') === stationAttBefore,
  };

  out.stage = 'S3h';
  // S3h: expected control and owners for every planet, across save/reload and re-entry.
  const qonos = B.getSystemIndexByName('Qonos');
  s.controlledSystems = [home, vulcan, qonos];
  s.factionSystemOverrides[bajora] = 'cardassian';
  const sweep = () => s.planets.map((_, i) => B.getSystemControl(i));
  const before = sweep();
  const beforeFlag = s.playerFaction;
  B.saveGame(9);
  B.loadGame(9);
  const after = sweep();
  const diffs = before.map((b, i) => (JSON.stringify(b) === JSON.stringify(after[i]) ? null : i)).filter((i) => i !== null);
  enterHome();
  out.persistence = {
    planets: after.length, diffs, flagKept: s.playerFaction === beforeFlag,
    expected: {
      home: after[home].controller === 'player' && after[home].allegiance === beforeFlag,
      vulcanQonos: [vulcan, qonos].every((i) => after[i].controller === 'player'),
      earth: after[earth].controller === 'neutral' && after[earth].polityId === `polity:${earth}` && after[earth].origin === 'terran',
      bajora: after[bajora].controller === 'cardassian' && after[bajora].polityId === 'cardassian' && after[bajora].origin === 'bajoran',
      untouchedOrigin: after.filter((c) => c.controlSource !== 'player' && c.controlSource !== 'override').every((c) => c.controller === c.origin),
      unknownOrigins: after.filter((c) => c.origin === null).length,
    },
    ownersAfterReload: ownersNow(),
    runtime: { govFlag: findStation(govId).faction, govOwned: !!findStation(govId).ownedByPlayer, foreignFlag: findStation('probe-foreign-vulcan').faction, foreignOwned: !!findStation('probe-foreign-vulcan').ownedByPlayer },
  };
  out.stage = 'Legacy save';
  // Legacy save (no ownership records): load it and check the migration reconstructs the expected owners.
  const slotKey = B.getSaveSlotKey(9);
  const legacy = JSON.parse(localStorage.getItem(slotKey));
  const hadRecords = legacy.stationOwners && Object.keys(legacy.stationOwners).length > 0;
  delete legacy.stationOwners;
  localStorage.setItem(slotKey, JSON.stringify(legacy));
  B.loadGame(9);
  const bajoraGovIds = s.stationDefinitions.filter((d) => Number(d.systemIndex) === bajora && !d.builtByPlayer && (d.faction === undefined || d.faction === null)).map((d) => d.id);
  out.migration = {
    hadRecords, recordsRebuilt: !!s.stationOwners && Object.keys(s.stationOwners).length > 0,
    homeGov: s.stationOwners?.[govId], foreignRecorded: s.stationOwners?.['probe-foreign-vulcan'] ?? null, foreignResolved: B.getStationOwner(foreignDef, home),
    privateResolved: B.getStationOwner(privateDef, home),
    bajoraGov: bajoraGovIds.length > 0 && bajoraGovIds.every((id) => s.stationOwners?.[id] === 'cardassian'),
  };
  delete s.factionSystemOverrides[earth];

  out.stage = 'Re-entry with the cached';
  // Re-entry with the cached snapshot kept: existing ships keep id, hull, faction and side, across a
  // leave/return and across a change of holder; only ownership-derived station fields move.
  const enterKeep = (i) => { s.currentPlanet = i; s.myplanet = i + 1; s.selectedPlanet = i; B.applySystemState(i); s.spawnProtectionUntil = 0; clearShots(); };
  enterKeep(home);
  // An explicitly constructed Zzyx-Council patrol placed in the cached snapshot: restoration must not
  // re-fit its hull, faction or side to the current holder.
  const zzShip = B.createNpcShip({ id: 'probe-zz-patrol', shipId: 305, faction: 'neutral', seed: 77, from: pAt(500), role: 'patrol', sideId: 'Zzyx-Council' });
  // Live encounter state is authoritative on re-entry, including constructed visitors.
  s.npcShips.push(zzShip);
  s.systemStates[home].npcShips.push({ ...zzShip, destination: { ...zzShip.destination }, waitUntil: 0 });
  enterKeep(home); // restore once so the baseline includes the constructed ship
  const identity = (list) => list.filter((n) => !n.destroyed && !B.isPlayerSideNpc(n)).map((n) => ({ id: n.id, shipId: n.shipId, faction: n.faction, side: B.getNpcSideId(n) }));
  const shipsBefore = identity(s.npcShips);
  enterKeep(vulcan); enterKeep(home);
  const shipsAfterReturn = identity(s.npcShips);
  B.transferSystemControlToFaction(home, 'romulan');
  enterKeep(vulcan); enterKeep(home);
  const shipsAfterCapture = identity(s.npcShips);
  const holderNow = B.getSystemControl(home).controller;
  B.transferSystemControlToPlayer(home);
  const zzAfter = s.npcShips.find((n) => n.id === 'probe-zz-patrol');
  out.cachedReentry = {
    zz: zzAfter ? { shipId: zzAfter.shipId, faction: zzAfter.faction, side: B.getNpcSideId(zzAfter) } : null,
    ships: shipsBefore.length, sameAfterReturn: JSON.stringify(shipsBefore) === JSON.stringify(shipsAfterReturn),
    sameAfterCapture: JSON.stringify(shipsBefore) === JSON.stringify(shipsAfterCapture), holderDuring: holderNow,
    govFlagUnderRomulans: null,
  };

  out.stage = 'Allied status';
  // Allied status does not excuse a witnessed attack: at Earth a Vulcan ship fires on a Terran station.
  delete s.systemStates[earth];
  enterKeep(earth); clearNpcs();
  const terranStation = (s.stations || []).find((st) => !st.destroyed && B.getStationOwner(st, earth) === 'terran');
  need(terranStation, 'S3j fixture: no Terran-owned station at Earth');
  const vulcanShip = mk(9351, 'vulcan', { attitude: 'friendly', role: 'traffic' }, { x: terranStation.x + 200, y: terranStation.y });
  const terranPatrol = mk(9352, 'terran', { attitude: 'friendly', role: 'patrol' }, { x: terranStation.x + 350, y: terranStation.y });
  const fleetCount = () => { const d = B.getFleetAttackDefenders('vulcan', [vulcanShip], performance.now()); return { patrol: d.ships.some((n) => n.id === terranPatrol.id), station: d.stations.some((st) => st.id === terranStation.id) }; };
  const alliedBefore = { aligned: B.sidesAligned('vulcan', 'terran'), attacker: B.isNpcSystemAttacker(vulcanShip, terranPatrol), turretTarget: B.isNpcSystemAttacker(vulcanShip, terranStation), fleet: fleetCount() };
  vulcanShip.lastShotAt = READY;
  B.fireNpcWeapon(vulcanShip, terranStation, 'station', performance.now());
  out.alliedAggression = {
    ...alliedBefore, firedAt: vulcanShip.lastAggressionTargetSide,
    attackerAfter: B.isNpcSystemAttacker(vulcanShip, terranPatrol), turretTargetAfter: B.isNpcSystemAttacker(vulcanShip, terranStation),
    patrolSelects: B.getNpcDefenseTarget(terranPatrol)?.id === vulcanShip.id,
    fleetAfter: fleetCount(),
  };

  out.stage = 'S3i';
  // S3f2: Vulcan handed to the Zzyx-Council: the Council's own installations block conquest, a foreign
  // concession and a private post there do not; once the Council stations are gone the claim is allowed.
  B.transferSystemControlToFaction(vulcan, 'Zzyx-Council');
  const vGov = s.stationDefinitions.find((d) => Number(d.systemIndex) === vulcan && !d.builtByPlayer && (d.faction === undefined || d.faction === null) && !s.destroyedStations[d.id]);
  need(vGov, 'S3f2 fixture: no government station definition at Vulcan');
  s.stationDefinitions.push(
    { ...vGov, id: 'probe-council-concession', name: 'Ferengi Concession', faction: 'ferengi', offset: { ...(vGov.offset || {}), x: (vGov.offset?.x || 0) + 260 } },
    { ...vGov, id: 'probe-council-private', name: 'Private Dock', faction: 'neutral', offset: { ...(vGov.offset || {}), x: (vGov.offset?.x || 0) - 260 } },
  );
  delete s.systemStates[vulcan];
  enterKeep(vulcan); clearNpcs();
  const councilOwned = (s.stations || []).filter((st) => !st.destroyed && B.getStationOwner(st, vulcan) === 'Zzyx-Council');
  const councilBlockers = B.getSystemControlBlockers(vulcan).map((b) => `${b.type}:${b.name}`);
  s.docked = true; s.latinum = 1e6; s.duranium = 1e6;
  const councilStatus = B.getClaimSystemStatus(vulcan);
  for (const st of councilOwned) { B.ensureStationCombatStats(st); B.damageCombatTarget(st, 999999, 'npc'); }
  const councilCleared = B.getClaimSystemStatus(vulcan);
  out.customConquest = {
    controller: B.getSystemControl(vulcan).controller, councilStations: councilOwned.length,
    blockers: councilBlockers, blockedCanClaim: councilStatus.canClaim, clearedCanClaim: councilCleared.canClaim,
    concessionOwner: B.getStationOwner((s.stations || []).find((st) => st.id === 'probe-council-concession'), vulcan),
    privateOwner: B.getStationOwner((s.stations || []).find((st) => st.id === 'probe-council-private'), vulcan),
  };
  s.docked = false;

  // S3l: a Klingon-held world seen by a Klingon-flagged player is not the player's, but does grant access.
  B.transferSystemControlToFaction(vulcan, 'vulcan'); delete s.factionSystemOverrides[vulcan];
  B.transferSystemControlToFaction(qonos, 'klingon'); delete s.factionSystemOverrides[qonos];
  delete s.systemStates[qonos];
  enterKeep(qonos); clearNpcs();
  out.sameFlagAuthority = {
    playerFlag: s.playerFaction, controller: B.getSystemControl(qonos).controller,
    controlled: B.isSystemControlled(qonos), claimLabel: B.getClaimSystemStatus(qonos).label, access: B.hasFactionAccessAt(qonos),
  };

  // S3i: an enemy world's defenders engage a player escort attacking their installation.
  delete s.systemStates[qonos];
  s.currentPlanet = qonos; s.myplanet = qonos + 1; s.selectedPlanet = qonos; B.applySystemState(qonos); s.spawnProtectionUntil = 0; clearNpcs(); clearShots();
  const klStation = (s.stations || []).find((st) => !st.destroyed && B.getStationOwner(st, qonos) === 'klingon');
  need(klStation, 'S3i fixture: no Klingon-owned station at Qonos');
  const escortK = mk(9331, s.playerFaction, { shipId: 2, attitude: 'friendly', hostile: false, role: 'playerEscort', fleetId: 'probe-escort' }, { x: klStation.x + 150, y: klStation.y });
  const defenderK = mk(9332, 'klingon', { attitude: 'friendly', role: 'patrol' }, { x: klStation.x + 300, y: klStation.y + 40 });
  escortK.lastShotAt = READY; defenderK.lastShotAt = READY;
  klStation.playerEscortOrderUntil = performance.now() + 60000;
  s.combatTargetId = null;
  const beforeAttack = { attacker: B.isNpcSystemAttacker(escortK, defenderK), target: B.getNpcDefenseTarget(defenderK)?.id || null };
  out.stage = 'S3i-run';
  const escortPool0 = (escortK.combatShields || 0) + (escortK.combatHull || 0);
  let defenderSelected = false;
  for (let i = 0; i < 120 && !(defenderK.lastShotAt > READY); i++) { B.tick(1); await sleep(30); if (!defenderSelected && B.getNpcDefenseTarget(defenderK)?.id === escortK.id) defenderSelected = true; }
  out.enemyDefense = {
    playerFlag: s.playerFaction, beforeAttack, escortFiredAt: escortK.lastAggressionTargetSide,
    escortIsAttacker: B.isNpcSystemAttacker(escortK, defenderK), defenderSelectsEscort: defenderSelected,
    defenderFiredAt: defenderK.lastAggressionTargetSide, defenderFired: defenderK.lastShotAt > READY,
    escortDamagedBy: escortK.lastDamageSource, escortHullDropped: ((escortK.combatShields || 0) + (escortK.combatHull || 0)) < escortPool0 || !!escortK.destroyed,
  };

  // ---------- S4: security policies ----------
  out.stage = 'S4';
  clearNpcs(); clearShots(); s.activeFleetAttack = null;
  B.transferSystemControlToPlayer(home);
  s.securityPolicies = { default: null, systems: {} };
  s.playerFlags = ['ferengi', 'klingon', 'terran'];
  s.playerFaction = 'terran'; // at war with Klingons
  s.fleetStance = 'attack';
  const enterFresh = (i) => { delete s.systemStates[i]; enterKeep(i); clearNpcs(); clearShots(); s.activeFleetAttack = null; };
  // Earlier cases (S3e, S3f2) destroyed the start-system fixtures; restore them so S4 exercises live installations.
  for (const id of [govId, 'probe-foreign-vulcan', 'probe-foreign-ferengi', 'probe-private-1']) delete s.destroyedStations[id];
  const esc = (id, at) => mk(id, s.playerFaction, { shipId: 2, attitude: 'friendly', hostile: false, role: 'playerEscort', fleetId: 'probe-escort' }, at);
  const answers = (npc) => ({ target: B.isPlayerEscortShipTarget(npc), attacker: B.isNpcSystemAttacker(npc, 'player') });
  enterFresh(home);
  const escort4 = esc(9401, pAt(80));
  // 1. default equals Phase 1
  const eff = B.getEffectiveSecurityPolicy(home);
  const raider4 = mk(9402, 'romulan', { attitude: 'hostile', hostile: true, role: 'fleetAttack' }, pAt(600)); raider4.attackId = 'raid-4'; s.activeFleetAttack = { id: 'raid-4', faction: 'romulan', systemIndex: home };
  const hostile4 = mk(9403, 'ferengi', { attitude: 'hostile', hostile: true }, pAt(650));
  const warFlag4 = mk(9404, 'klingon', { attitude: 'neutral', hostile: false, role: 'patrol' }, pAt(700));
  const calm4 = mk(9405, 'neutral', { attitude: 'friendly', role: 'traffic' }, pAt(750));
  out.policyDefault = {
    effective: eff, matchesDefault: JSON.stringify(eff) === JSON.stringify(B.DEFAULT_SECURITY_POLICY),
    raider: answers(raider4), hostile: answers(hostile4), warFlag: answers(warFlag4), calm: answers(calm4),
  };
  s.activeFleetAttack = null;
  // 2. two holdings, two ROEs
  B.transferSystemControlToPlayer(vulcan);
  B.setSecurityPolicyOverride(home, { roe: 'return-fire' });
  clearNpcs(); const escortH = esc(9411, pAt(80));
  const klH = mk(9412, 'klingon', { attitude: 'neutral', hostile: false, role: 'patrol' }, pAt(500));
  const homeCalm = answers(klH);
  klH.lastShotAt = READY; B.fireNpcWeapon(klH, escortH, 'ship', performance.now());
  const homeAfterFire = answers(klH);
  enterFresh(vulcan); esc(9413, pAt(80));
  const klV = mk(9414, 'klingon', { attitude: 'neutral', hostile: false, role: 'patrol' }, pAt(500));
  out.twoHoldings = { homeRoe: B.getPlayerRoeAt(home), vulcanRoe: B.getPlayerRoeAt(vulcan), homeCalm, homeAfterFire, vulcanCalm: answers(klV) };
  // 3. independent player
  s.playerFaction = 'neutral';
  enterFresh(home); B.clearSecurityPolicyOverride(home); const escortN = esc(9421, pAt(80));
  const klN = mk(9422, 'klingon', { attitude: 'neutral', hostile: false, role: 'patrol' }, pAt(500));
  const hostileN = mk(9423, 'ferengi', { attitude: 'hostile', hostile: true }, pAt(550));
  const indDefend = { klingon: answers(klN), hostile: answers(hostileN) };
  B.setSecurityPolicyOverride(home, { roe: 'return-fire' });
  const indReturnFire = { hostile: answers(hostileN) };
  hostileN.lastShotAt = READY; B.fireNpcWeapon(hostileN, escortN, 'ship', performance.now());
  out.independentPlayer = { flag: s.playerFaction, defend: indDefend, returnFire: indReturnFire, afterFire: answers(hostileN) };
  // 4. foreign-defense independence (both ROEs)
  const foreignDefense = {};
  for (const roe of ['defend', 'return-fire']) {
    enterFresh(home); B.setSecurityPolicyOverride(home, { roe }); esc(9431, pAt(80));
    const concession = findStation('probe-foreign-vulcan');
    const escort44 = s.npcShips.find((n) => n.id === 9431);
    const patrolF4 = mk(9432, 'ferengi', { attitude: 'friendly', role: 'patrol' }, pAt(400));
    const indRaider = mk(9433, 'neutral', { attitude: 'neutral', hostile: false }, { x: concession.x + 200, y: concession.y });
    B.ensureStationCombatStats(concession); concession.lastShotAt = 0; escort44.lastShotAt = READY;
    indRaider.lastShotAt = READY; B.fireNpcWeapon(indRaider, concession, 'station', performance.now());
    for (let i = 0; i < 80 && !(indRaider.lastDamageSource === 'station'); i++) { B.tick(1); await sleep(30); }
    foreignDefense[roe] = {
      concessionAlive: !concession.destroyed, concessionFired: (concession.lastShotAt || 0) > 0 && concession.lastAggressionTargetSide === B.getNpcSideId(indRaider),
      raiderHitBy: indRaider.lastDamageSource, escortFiredAtRaider: escort44.lastAggressionTargetSide === B.getNpcSideId(indRaider),
      raider: answers(indRaider), concessionTurret: B.isNpcSystemAttacker(indRaider, concession),
      concessionOwner: B.getStationOwner(concession, home), patrolSide: B.getNpcSideId(patrolF4), patrolCommanded: B.isPlayerSideNpc(patrolF4) || (s.playerFleet || []).some((f) => f.id === patrolF4.id),
    };
  }
  out.foreignDefense = foreignDefense;
  // 5. station retaliation, 6. explicit-order precedence
  enterFresh(home);
  const hub = findStation('probe-foreign-ferengi'); const govS = findStation(govId);
  const escortS = esc(9441, { x: hub.x + 150, y: hub.y });
  hub.hostile = true;
  B.setSecurityPolicyOverride(home, { roe: 'return-fire' });
  const hubHostileReturnFire = B.isPlayerEscortStationTarget(hub);
  B.ensureStationCombatStats(hub); hub.lastShotAt = READY; B.fireStationWeapon(hub, escortS, performance.now());
  const hubAfterFire = B.isPlayerEscortStationTarget(hub);
  B.setSecurityPolicyOverride(home, { roe: 'defend' });
  const hubHostileDefend = B.isPlayerEscortStationTarget(hub);
  hub.hostile = false; hub.lastAggressionAt = 0; hub.attitude = 'neutral';
  B.setSecurityPolicyOverride(home, { roe: 'return-fire' });
  const calmHubNoOrder = B.isPlayerEscortStationTarget(hub);
  // Ordering escorts onto the player's own government station through the real order path: the
  // order is refused (no timestamp, no hostility), it is never a target, and the escort never fires on it.
  B.ensureStationCombatStats(govS); govS.lastDamageSource = null;
  s.combatTargetId = govS.id; s.combatTargetType = 'station';
  B.markPlayerEscortAttackOrder(govS);
  const ownOrderRefused = !(govS.playerEscortOrderUntil > performance.now()) && govS.hostile === false && govS.attitude === 'friendly';
  const ownOrdered = B.isPlayerEscortStationTarget(govS);
  escortS.lastShotAt = READY; escortS.lastAggressionTargetSide = null;
  for (let i = 0; i < 40; i++) { B.tick(1); await sleep(30); }
  const ownNeverFiredOn = govS.lastDamageSource !== 'playerEscort' && escortS.lastAggressionTargetSide !== 'player';
  s.combatTargetId = null; s.combatTargetType = 'ship';
  // Ordered onto the calm foreign hub: a target under return-fire, and the escort does fire on it.
  hub.playerEscortOrderUntil = performance.now() + 60000;
  const calmHubOrdered = B.isPlayerEscortStationTarget(hub);
  escortS.lastShotAt = READY;
  escortS.power.energy = B.getActorPowerProfile(escortS).energyCapacity;
  for (let i = 0; i < 80 && hub.lastDamageSource !== 'playerEscort'; i++) { escortS.x=hub.x+150; escortS.y=hub.y; B.tick(1); await sleep(30); }
  const hubFiredOn = hub.lastDamageSource === 'playerEscort';
  hub.playerEscortOrderUntil = 0;
  out.stationRoe = { hubAlive: !hub.destroyed, govAlive: !govS.destroyed, hubOwner: B.getStationOwner(hub, home), hubFiredAt: hub.lastAggressionTargetSide, hubHostileReturnFire, hubAfterFire, hubHostileDefend, calmHubNoOrder, calmHubOrdered, hubFiredOn, ownOrderRefused, ownOrdered, ownNeverFiredOn };
  // 14. own defenses never turn on the player: escort attacks a same-flag foreign concession
  enterFresh(home); s.playerFaction = 'ferengi'; B.setSecurityPolicyOverride(home, { roe: 'defend' });
  const hubOwn = findStation('probe-foreign-ferengi'); const govOwn = findStation(govId);
  const escortOwn = esc(9471, { x: hubOwn.x + 150, y: hubOwn.y });
  const garrison = B.createNpcShip({ id: 9472, shipId: 1, faction: 'ferengi', attitude: 'friendly', hostile: false, seed: 9472, from: { x: govOwn.x + 120, y: govOwn.y }, role: 'playerFleet', fleetId: 'probe-garrison' });
  B.ensureNpcCombatStats(garrison); s.npcShips.push(garrison);
  const foreignPatrolF = mk(9473, 'ferengi', { attitude: 'friendly', role: 'patrol' }, pAt(450));
  B.ensureStationCombatStats(hubOwn); B.ensureStationCombatStats(govOwn);
  s.combatTargetId = hubOwn.id; s.combatTargetType = 'station'; // the player's selected target, as in the real flow
  B.markPlayerEscortAttackOrder(hubOwn); // then "escorts, attack this station"
  escortOwn.lastShotAt = READY;
  for (let i = 0; i < 80 && hubOwn.lastDamageSource !== 'playerEscort'; i++) { B.tick(1); await sleep(30); }
  const cachedGovOwn = (s.systemStates[home]?.stations || []).find((st) => st.id === govId);
  out.ownDefenses = {
    flag: s.playerFaction, hubOwner: B.getStationOwner(hubOwn, home), hubFlag: hubOwn.faction, hubAlive: !hubOwn.destroyed, hubHitByEscort: hubOwn.lastDamageSource === 'playerEscort',
    hubTurnedHostile: hubOwn.hostile === true,
    gov: { owner: B.getStationOwner(govOwn, home), hostile: govOwn.hostile, attitude: govOwn.attitude, firedAtPlayer: govOwn.lastAggressionTargetSide === 'player' },
    cachedGov: { hostile: !!cachedGovOwn?.hostile, attitude: cachedGovOwn?.attitude },
    garrison: { side: B.getNpcSideId(garrison), hostile: garrison.hostile, attitude: garrison.attitude, aggro: Boolean(garrison.playerAggroUntil) && garrison.playerAggroUntil > performance.now() },
    foreignPatrolAlerted: foreignPatrolF.hostile === true,
  };
  s.playerFaction = 'neutral'; s.combatTargetId = null; s.combatTargetType = 'ship';
  B.setSecurityPolicyOverride(home, { roe: 'return-fire' });
  // 15. an ambient replacement is a different vessel: it inherits no evidence, aggro, orders or raid
  // membership from the previous occupant of its slot (which kept the same npc.id).
  clearNpcs(); esc(9481, pAt(80));
  const slot = mk(9482, 'ferengi', { attitude: 'neutral', hostile: false, role: 'traffic' }, pAt(600));
  const nowR = performance.now();
  Object.assign(slot, { lastAggressionAt: nowR, lastAggressionTargetSide: 'player', lastAggressionSystemIndex: home, playerEscortOrderUntil: nowR + 60000, playerAggroUntil: nowR + 60000, attackId: 'raid-old', lastDamageSource: 'playerEscort' });
  const beforeReplacement = answers(slot);
  B.beginAmbientTrafficArrival(slot, nowR);
  out.replacementEvidence = {
    sameId: slot.id === 9482, before: beforeReplacement, after: answers(slot),
    fields: { aggressionAt: slot.lastAggressionAt, aggressionSide: slot.lastAggressionTargetSide, aggro: slot.playerAggroUntil, order: slot.playerEscortOrderUntil, attackId: slot.attackId, damage: slot.lastDamageSource },
  };
  // 7. stale / unrelated raid evidence
  clearNpcs(); const escortR = esc(9451, pAt(80));
  const stale = mk(9452, 'ferengi', { attitude: 'neutral', hostile: false, role: 'fleetAttack' }, pAt(600)); stale.attackId = 'raid-elsewhere';
  const staleNoAttack = answers(stale);
  s.activeFleetAttack = { id: 'raid-elsewhere', faction: 'ferengi', systemIndex: vulcan };
  const staleOtherSystem = answers(stale);
  s.activeFleetAttack = { id: 'raid-elsewhere', faction: 'ferengi', systemIndex: home };
  const raidHere = answers(stale);
  s.activeFleetAttack = null;
  out.raidEvidence = { roe: B.getPlayerRoeAt(home), staleNoAttack, staleOtherSystem, raidHere };
  // 8. aggression scoped to this system; standing orders outside holdings
  const remote = mk(9453, 'ferengi', { attitude: 'neutral', hostile: false }, pAt(650));
  remote.lastAggressionAt = performance.now(); remote.lastAggressionSystemIndex = vulcan; remote.lastAggressionTargetSide = 'player';
  const elsewhereAggression = answers(remote);
  remote.lastAggressionSystemIndex = home;
  const hereAggression = answers(remote);
  B.setSecurityPolicyDefault({ roe: 'return-fire' });
  B.transferSystemControlToFaction(vulcan, 'vulcan'); delete s.factionSystemOverrides[vulcan];
  enterFresh(qonos); const escortQ = esc(9461, pAt(80));
  const klQ = mk(9462, 'klingon', { attitude: 'neutral', hostile: false, role: 'patrol' }, pAt(500));
  s.playerFaction = 'terran';
  const abroadCalm = { roe: B.getPlayerRoeAt(qonos), held: B.isSystemControlled(qonos), ...answers(klQ) };
  klQ.lastShotAt = READY; B.fireNpcWeapon(klQ, escortQ, 'ship', performance.now());
  const abroadAfterFire = answers(klQ);
  B.setSecurityPolicyDefault({ roe: 'defend' });
  const abroadDefendCalm = answers(mk(9463, 'klingon', { attitude: 'neutral', hostile: false, role: 'patrol' }, pAt(700)));
  out.aggressionScope = { elsewhereAggression, hereAggression, abroadCalm, abroadAfterFire, abroadDefendCalm };
  // 9. partial-override inheritance
  s.securityPolicies = { default: null, systems: {} };
  B.setSecurityPolicyDefault({ roe: 'defend', access: { warFlag: 'challenge' } });
  B.setSecurityPolicyOverride(home, { access: { independent: 'closed' } });
  const partial1 = B.getEffectiveSecurityPolicy(home);
  B.setSecurityPolicyOverride(home, { roe: 'return-fire' });
  const partial2 = B.getEffectiveSecurityPolicy(home);
  out.partialOverride = { partial1, partial2, storedOverride: B.getSecurityPolicyOverride(home) };
  // 10. flag change
  const policiesBeforeFlag = JSON.stringify(s.securityPolicies);
  B.raisePlayerFlag('klingon');
  out.flagPolicy = { same: JSON.stringify(s.securityPolicies) === policiesBeforeFlag, roeHome: B.getPlayerRoeAt(home), flag: s.playerFaction };
  // 11. loss and reclamation
  enterFresh(home);
  B.transferSystemControlToFaction(home, 'romulan');
  const lostPolicy = { effective: B.getEffectiveSecurityPolicy(home), retained: !!B.getSecurityPolicyOverride(home), roeApplied: B.getPlayerRoeAt(home), defaultRoe: B.getSecurityPolicyDefault().roe };
  B.transferSystemControlToPlayer(home);
  out.lossReclaim = { ...lostPolicy, reclaimedRoe: B.getEffectiveSecurityPolicy(home)?.roe };
  // 12. save / reload, legacy
  const beforeSave = JSON.stringify(s.securityPolicies);
  const effBefore = JSON.stringify(B.getEffectiveSecurityPolicy(home));
  B.saveGame(7); B.loadGame(7);
  const afterLoad = { same: JSON.stringify(s.securityPolicies) === beforeSave, effSame: JSON.stringify(B.getEffectiveSecurityPolicy(home)) === effBefore };
  const key7 = B.getSaveSlotKey(7); const raw7 = JSON.parse(localStorage.getItem(key7)); delete raw7.securityPolicies; localStorage.setItem(key7, JSON.stringify(raw7));
  B.loadGame(7);
  out.persistPolicy = { ...afterLoad, legacyDefault: JSON.stringify(B.getSecurityPolicyDefault()) === JSON.stringify(B.DEFAULT_SECURITY_POLICY), legacyNoOverride: !B.getSecurityPolicyOverride(home) };
  // 13. UI authority
  enterFresh(home);
  s.docked = true; s.planetMenuOpen = true; s.dockMenuTab = 'security';
  B.renderPlanetMenu();
  const menu = document.getElementById('planet-menu');
  const tabPresent = !!menu?.querySelector('[data-dock-tab="security"]');
  menu?.querySelector('[data-security-roe="return-fire"]')?.click();
  const uiOverride = B.getSecurityPolicyOverride(home)?.roe;
  menu?.querySelector('[data-security-action="set-default"]')?.click();
  const uiDefault = B.getSecurityPolicyDefault().roe;
  menu?.querySelector('[data-security-action="use-default"]')?.click();
  const uiCleared = !B.getSecurityPolicyOverride(home);
  s.docked = false; s.planetMenuOpen = false;
  B.transferSystemControlToFaction(qonos, 'klingon'); delete s.factionSystemOverrides[qonos];
  enterFresh(qonos); s.docked = true; s.planetMenuOpen = true; s.dockMenuTab = 'services'; B.renderPlanetMenu();
  const foreignTab = !!menu?.querySelector('[data-dock-tab="security"]');
  s.docked = false; s.planetMenuOpen = false;
  out.securityUi = { flag: s.playerFaction, tabPresent, uiOverride, uiDefault, uiCleared, foreignHeldByFlagFaction: B.getSystemControl(qonos).controller, foreignTab };

  // ---------- S5: holding zones and compliance (Phase 3) ----------
  out.stage = 'S5';
  const fast = async (n, each = null) => { for (let i = 0; i < n; i++) { if (each) each(i); B.tick(2.5); await sleep(4); } };
  const tickUntil = async (cond, max = 900, scale = 2.5) => { for (let i = 0; i < max; i++) { if (cond()) return true; B.tick(scale); await sleep(4); } return cond(); };
  const ledgerOf = (i) => B.getSecurityLedger(i);
  const ordersFor = (i, instanceId) => Object.values(ledgerOf(i)?.orders || {}).filter((o) => o.visitorInstanceId === instanceId);
  const activeOrderOf = (i, npc) => Object.values(ledgerOf(i)?.orders || {}).find((o) => !o.outcome && o.visitorInstanceId === npc.securityInstanceId) || null;
  const zoneAt = (i) => B.getSecurityZone(i);
  const polar = (zone, distance, angle = 0) => ({ x: zone.centre.x + Math.cos(angle) * distance, y: zone.centre.y + Math.sin(angle) * distance });
  const traffic = (id, faction, zone, distance, angle = 0, opts = {}) => {
    const n = mk(id, faction, { shipId: 1, attitude: 'neutral', hostile: false, role: 'traffic', ...opts }, polar(zone, distance, angle));
    n.destination = polar(zone, Math.max(40, zone.holdDistance * 0.4), angle); // ordinary lane: heading inward
    n.destinationName = 'inner beacon'; n.speed = 1.2; n.identityLocked = true; n.sideId = B.getNpcSideId(n);
    return n;
  };
  const restoreHome = () => { for (const d of s.stationDefinitions) if (Number(d.systemIndex) === home) delete s.destroyedStations[d.id]; };
  // Controlled ambient participants for persistence: fresh scenes may be quiet or already
  // depleted. Use real NPC construction and live encounter save/restore; park other traffic.
  const usedSlots = new Set();
  const clearProbeNpcs = () => { for (let i = s.npcShips.length - 1; i >= 0; i--) if (Number(s.npcShips[i].id) >= 9000) s.npcShips.splice(i, 1); };
  const parkOthers = (zone, except) => {
    for (const n of s.npcShips) {
      if (!n || except.includes(n) || n.role === 'playerEscort' || n.role === 'playerFleet') continue;
      const far = { x: zone.centre.x + 3200, y: zone.centre.y + 200 };
      Object.assign(n, { x: far.x, y: far.y, destination: { ...far }, waitUntil: performance.now() + 1e9, ambientWarpAt: performance.now() + 1e9, trafficWarp: null, securityObjective: null });
    }
  };
  const slotTraffic = (zone, distance, angle, faction = 'ferengi') => {
    const n = mk(`probe-persist-${usedSlots.size}`, faction, { shipId: 1, seed: 5800 + usedSlots.size, role: 'traffic', attitude: 'neutral', hostile: false }, polar(zone, distance, angle));
    usedSlots.add(n.id);
    const p = polar(zone, distance, angle);
    Object.assign(n, { x: p.x, y: p.y, destination: polar(zone, Math.max(40, zone.holdDistance * 0.4), angle), destinationName: 'inner beacon', speed: 1.2, trafficWarp: null, ambientWarpAt: performance.now() + 120000, hostile: false, attitude: 'neutral', waitUntil: 0, securityObjective: null, faction, sideId: faction, identityLocked: true });
    const snap = (s.systemStates[home]?.npcShips || []).find((e) => e.id === n.id);
    if (snap) Object.assign(snap, { faction, sideId: faction, identityLocked: true, shipId: n.shipId, seed: n.seed, name: n.name });
    return n;
  };
  s.playerFlags = ['ferengi', 'klingon', 'terran'];
  s.playerFaction = 'terran';
  s.securityPolicies = { default: null, systems: {} };
  B.resetSecurityRecords();
  B.transferSystemControlToPlayer(home);
  restoreHome();
  enterFresh(home);
  const standingsBefore5 = snapStandings();
  const candidates5 = B.getSecurityAnchorCandidates(home, 'player');
  const anchor5 = candidates5[0] || null;
  need(anchor5, `S5 fixture: no planet-anchored player-owned station at home (${(s.stations || []).map((st) => `${st.name}:${st.orbitAnchor}:${st.ownerId}:${st.destroyed ? 'X' : ''}`).join(', ')})`);
  const foreignCandidate = (s.stations || []).find((st) => st.id === 'probe-foreign-vulcan');
  out.zoneAuthority = {
    foreignExcluded: !candidates5.some((st) => st.id === 'probe-foreign-vulcan' || st.id === 'probe-private-1'),
    foreignPresent: !!foreignCandidate && !foreignCandidate.destroyed,
    disabledByDefault: zoneAt(home) === null,
    setAtForeign: B.setPlayerCheckpoint(qonos, { enabled: true }) === null,
  };
  B.setPlayerCheckpoint(home, { enabled: true, anchorStationId: anchor5?.id });
  const zoneHome = zoneAt(home);
  need(zoneHome, 'S5 fixture: home checkpoint did not activate');
  out.zoneAuthority.enabled = !!zoneHome && zoneHome.authority === 'player' && zoneHome.anchorStationId === anchor5?.id;
  out.zoneAuthority.radius = zoneHome?.radius; out.zoneAuthority.hold = zoneHome?.holdDistance;
  // 1. open access: a visitor crosses in; no order, no fact, no offence, no standing change, no shot
  clearNpcs(); clearShots();
  const escort5 = esc(9501, polar(zoneHome, 40, Math.PI / 2)); escort5.lastShotAt = READY; escort5.lastAggressionTargetSide = null;
  const openVisitor = traffic(9502, 'ferengi', zoneHome, zoneHome.radius + 200);
  await tickUntil(() => Math.hypot(openVisitor.x - zoneHome.centre.x, openVisitor.y - zoneHome.centre.y) < zoneHome.radius - 40, 400);
  await fast(20);
  const openRecord = ledgerOf(home)?.visitors?.[openVisitor.securityInstanceId];
  out.openAccess = {
    inside: openRecord?.inside === true, orders: ordersFor(home, openVisitor.securityInstanceId).length, objective: openVisitor.securityObjective,
    hostile: openVisitor.hostile, attackId: openVisitor.attackId || null, standingsSame: snapStandings() === standingsBefore5, escortFired: escort5.lastAggressionTargetSide,
    anchorShots: (s.stations.find((st) => st.id === anchor5?.id)?.lastAggressionTargetSide) || null, noncompliant: !!openRecord?.noncompliant,
  };
  const openEpisode = openRecord?.episode;
  // An access rule tightened while a visitor is already inside must address that same visit.
  B.setSecurityPolicyOverride(home, { access: { other: 'closed' } });
  await fast(3);
  const tightenedOrder = activeOrderOf(home, openVisitor);
  out.policyTightening = {
    sameEpisode: ledgerOf(home)?.visitors?.[openVisitor.securityInstanceId]?.episode === openEpisode,
    issued: !!tightenedOrder, kind: tightenedOrder?.kind, decision: tightenedOrder?.decision,
  };
  if (tightenedOrder) B.operateSecurityOrder(tightenedOrder.id, 'cancel');
  // 2. challenge: exactly one order, approach, hold, dwell, cleared, resume
  clearNpcs(); clearShots(); esc(9503, polar(zoneHome, 40, Math.PI / 2));
  B.setSecurityPolicyOverride(home, { access: { other: 'challenge' } });
  const zoneC = zoneAt(home);
  const chal = traffic(9504, 'ferengi', zoneC, zoneC.radius + 160);
  const before2 = { role: chal.role, side: chal.sideId, fleet: chal.fleetId || null, faction: chal.faction };
  await tickUntil(() => !!activeOrderOf(home, chal), 300);
  const chalOrder = activeOrderOf(home, chal);
  await fast(1);
  const chalDest0 = chal.destinationName;
  const reached = await tickUntil(() => chalOrder && (chalOrder.state === 'holding'), 900);
  const dwellSeen = chalOrder?.dwellMs || 0;
  const clearedC = await tickUntil(() => chalOrder && chalOrder.outcome === 'cleared', 400);
  await fast(10);
  const chalRecord = ledgerOf(home)?.visitors?.[chal.securityInstanceId];
  out.challenge = {
    issued: !!chalOrder, kind: chalOrder?.kind, cls: chalOrder?.accessClass, destWhileOrdered: chalDest0, reached, dwellSeen, cleared: clearedC, outcome: chalOrder?.outcome,
    compliance: chalOrder?.compliance?.scope, orders: ordersFor(home, chal.securityInstanceId).length, clearance: chalRecord?.clearance?.provenance || null,
    resumed: !chal.securityObjective && chal.destinationName !== 'checkpoint hold', identity: { role: chal.role, side: chal.sideId, fleet: chal.fleetId || null, faction: chal.faction }, identityBefore: before2,
    stillOneOrderAfterDwell: ordersFor(home, chal.securityInstanceId).filter((o) => !o.outcome).length === 0,
  };
  // 3. closed: one withdrawal instruction; the ship leaves and takes a lane outside or departs
  clearNpcs(); clearShots(); esc(9505, polar(zoneHome, 40, Math.PI / 2));
  B.setSecurityPolicyOverride(home, { access: { other: 'closed' } });
  const zoneW = zoneAt(home);
  const closedV = traffic(9506, 'ferengi', zoneW, zoneW.radius - 60, 0.6);
  await tickUntil(() => !!activeOrderOf(home, closedV), 100);
  const wOrder = activeOrderOf(home, closedV);
  const withdrawn = await tickUntil(() => wOrder && wOrder.outcome === 'withdrawn', 900);
  await fast(5);
  const destOut = closedV.destination ? Math.hypot(closedV.destination.x - zoneW.centre.x, closedV.destination.y - zoneW.centre.y) : 0;
  out.closedAccess = {
    issued: !!wOrder, kind: wOrder?.kind, withdrawn, outcome: wOrder?.outcome, compliance: wOrder?.compliance?.scope,
    nextDestinationOutside: destOut > zoneW.reentryDistance || !!closedV.trafficWarp, objectiveCleared: !closedV.securityObjective, orders: ordersFor(home, closedV.securityInstanceId).length,
    clearance: ledgerOf(home)?.visitors?.[closedV.securityInstanceId]?.clearance || null,
  };
  // 4. refusal / expiry under return-fire: a calm war-flag visitor times out; a record, not a target
  clearNpcs(); clearShots();
  B.setSecurityPolicyOverride(home, { roe: 'return-fire', access: { other: 'open', warFlag: 'challenge' } });
  const zoneR = zoneAt(home);
  const escortR5 = esc(9507, polar(zoneR, 40, Math.PI / 2)); escortR5.lastShotAt = READY; escortR5.lastAggressionTargetSide = null;
  const anchorStation = s.stations.find((st) => st.id === anchor5?.id); if (anchorStation) { B.ensureStationCombatStats(anchorStation); anchorStation.lastShotAt = READY; anchorStation.lastAggressionTargetSide = null; }
  const kVisitor = traffic(9508, 'klingon', zoneR, zoneR.radius - 80, 2.2);
  await tickUntil(() => !!activeOrderOf(home, kVisitor), 100);
  const kOrder = activeOrderOf(home, kVisitor);
  const stBefore4 = snapStandings();
  if (kOrder) kOrder.remainingMs = 200;
  kVisitor.speed = 0.01; // it dawdles: the allowance runs out
  const expired = await tickUntil(() => kOrder && kOrder.outcome === 'expired', 100);
  await fast(40);
  const kRecord = ledgerOf(home)?.visitors?.[kVisitor.securityInstanceId];
  out.refusal = {
    issued: !!kOrder, cls: kOrder?.accessClass, expired, outcome: kOrder?.outcome, noncompliant: kRecord?.noncompliant === true,
    hostile: kVisitor.hostile, attackId: kVisitor.attackId || null, aggro: !!kVisitor.playerAggroUntil, standingsSame: snapStandings() === stBefore4,
    escortTarget: B.isPlayerEscortShipTarget(kVisitor), attacker: B.isNpcSystemAttacker(kVisitor, 'player'), escortFired: escortR5.lastAggressionTargetSide, anchorFired: anchorStation?.lastAggressionTargetSide || null,
    secondOrderForSameVisit: ordersFor(home, kVisitor.securityInstanceId).length,
  };
  // 5. real aggression still permits defence under the same policy; expired evidence does not
  kVisitor.speed = 1.0; kVisitor.lastShotAt = READY;
  B.fireNpcWeapon(kVisitor, escortR5, 'ship', performance.now());
  const afterShot = { target: B.isPlayerEscortShipTarget(kVisitor), attacker: B.isNpcSystemAttacker(kVisitor, 'player') };
  kVisitor.lastAggressionAt = performance.now() - 60000;
  out.realAggression = { afterShot, stale: { target: B.isPlayerEscortShipTarget(kVisitor), attacker: B.isNpcSystemAttacker(kVisitor, 'player') }, noClearance: !ledgerOf(home)?.visitors?.[kVisitor.securityInstanceId]?.clearance };
  // 7. classification
  clearNpcs();
  const zoneK = zoneAt(home);
  const own = esc(9511, polar(zoneK, 50, 1));
  const sameFlag = mk(9512, 'terran', { role: 'traffic' }, polar(zoneK, 60, 1.2));
  const indep = mk(9513, 'neutral', { role: 'traffic' }, polar(zoneK, 70, 1.4));
  const warF = mk(9514, 'klingon', { role: 'traffic' }, polar(zoneK, 80, 1.6));
  const customV = mk(9515, 'neutral', { role: 'traffic', sideId: 'Zzyx-Council' }, polar(zoneK, 90, 1.8)); customV.broadcastSource = 'declared'; customV.broadcastFaction = 'Zzyx-Council';
  const unknownC = mk(9516, 'ferengi', { role: 'traffic' }, polar(zoneK, 100, 2.0)); unknownC.broadcastSource = 'none'; B.ensureActorSensors(unknownC).transponder = false;
  const decide = (n) => { const d = B.getVisitorAccessDecision(zoneK, B.getSecurityContact(n)); return d ? `${d.class}:${d.decision}:${d.enforceable}` : null; };
  B.setSecurityPolicyOverride(home, { access: { warFlag: 'closed', independent: 'challenge', other: 'challenge' } });
  const zoneK2 = zoneAt(home);
  const decide2 = (n) => { const d = B.getVisitorAccessDecision(zoneK2, B.getSecurityContact(n)); return d ? `${d.class}:${d.decision}:${d.enforceable}` : null; };
  await fast(30);
  out.classification = {
    own: decide2(own), sameFlag: decide2(sameFlag), independent: decide2(indep), warFlag: decide2(warF), custom: decide2(customV), unknown: decide2(unknownC),
    player: (() => { const d = B.getVisitorAccessDecision(zoneK2, B.getSecurityContact('player')); return d ? `${d.class}:${d.decision}` : null; })(),
    unknownNotOrdered: ordersFor(home, unknownC.securityInstanceId).length === 0, ownNotOrdered: ordersFor(home, own.securityInstanceId || 'none').length === 0,
    customOrdered: ordersFor(home, customV.securityInstanceId).length === 1, customSide: customV.sideId,
  };
  // 10. time: the local clock follows the simulated delta, not the wall clock or unloaded time
  clearNpcs();
  B.setSecurityPolicyOverride(home, { access: { warFlag: 'open', independent: 'open', other: 'challenge' } });
  const ledgerH = ledgerOf(home);
  const t0 = ledgerH.localElapsedMs;
  for (let i = 0; i < 10; i++) B.tick(0.25);
  const slowDelta = ledgerH.localElapsedMs - t0;
  const t1 = ledgerH.localElapsedMs;
  await sleep(120); // wall time passes, nothing is simulated
  const idleDelta = ledgerH.localElapsedMs - t1;
  const zoneT = zoneAt(home);
  const disabledV = traffic(9521, 'ferengi', zoneT, zoneT.radius - 50, 2.6);
  await tickUntil(() => !!activeOrderOf(home, disabledV), 100);
  const dOrder = activeOrderOf(home, disabledV);
  disabledV.engineDisabledUntil = performance.now() + 60000;
  await fast(3);
  const combatV = traffic(9522, 'ferengi', zoneT, zoneT.radius - 50, 2.9);
  await tickUntil(() => !!activeOrderOf(home, combatV), 100);
  const cOrder = activeOrderOf(home, combatV);
  combatV.hostile = true; combatV.attitude = 'hostile';
  await fast(3);
  clearProbeNpcs(); enterKeep(home);
  const zoneT2 = zoneAt(home);
  const awayV = slotTraffic(zoneT2, zoneT2.radius - 50, 3.2);
  need(awayV, 'S5.10 fixture: no ambient traffic slot available');
  parkOthers(zoneT2, [awayV]);
  await tickUntil(() => !!activeOrderOf(home, awayV), 100);
  const aOrder = activeOrderOf(home, awayV);
  const t2 = ledgerH.localElapsedMs;
  enterKeep(qonos); await fast(30); // unloaded: home's clock and orders stay where they were
  const unloadedDelta = ledgerH.localElapsedMs - t2;
  const remainingWhileAway = aOrder?.remainingMs;
  enterKeep(home);
  const homeNpcAfterReturn = s.npcShips.find((n) => n.securityInstanceId === awayV.securityInstanceId);
  await fast(2);
  out.timeAndInterruptions = {
    slowDelta: Math.round(slowDelta), idleDelta, unloadedDelta, disabled: dOrder?.outcome, disabledFault: !!ledgerOf(home)?.visitors?.[disabledV.securityInstanceId]?.noncompliant,
    combat: cOrder?.outcome, combatFault: !!ledgerOf(home)?.visitors?.[combatV.securityInstanceId]?.noncompliant,
    awayOrderKeptRemaining: aOrder && Math.abs(aOrder.remainingMs - remainingWhileAway) < 200, awayRestoredSameSlot: !!homeNpcAfterReturn && homeNpcAfterReturn.id === awayV.id, awayOrderStillActive: aOrder && !aOrder.outcome,
  };
  // 11. save and reload during approach and during dwell
  clearProbeNpcs(); enterKeep(home);
  const zoneS = zoneAt(home);
  const saveV = slotTraffic(zoneS, zoneS.radius - 40, 0.2);
  need(saveV, 'S5.11 fixture: no ambient traffic slot available');
  if (saveV) { saveV.broadcastSource = 'declared'; saveV.broadcastFaction = 'Zzyx-Council'; B.ensureActorSensors(saveV).declaration = 'Zzyx-Council'; }
  parkOthers(zoneS, [saveV]);
  await tickUntil(() => !!activeOrderOf(home, saveV), 100);
  const sOrder = activeOrderOf(home, saveV);
  await fast(5);
  const remBeforeSave = sOrder?.remainingMs;
  const hullBefore = saveV.combatHull;
  B.saveGame(8); B.loadGame(8);
  const ledgerL = ledgerOf(home);
  const lOrder = ledgerL?.orders?.[sOrder?.id];
  const restoredNpc = s.npcShips.find((n) => n.securityInstanceId === sOrder?.visitorInstanceId);
  const duplicates = s.npcShips.filter((n) => n.securityInstanceId === sOrder?.visitorInstanceId).length;
  await fast(2);
  const approachReload = {
    orderKept: !!lOrder && !lOrder.outcome, remainingKept: lOrder && Math.abs(lOrder.remainingMs - remBeforeSave) < 300, restored: !!restoredNpc, sameSlot: restoredNpc?.id === saveV.id,
    duplicates, hullKept: restoredNpc?.combatHull === hullBefore, objective: restoredNpc?.securityObjective?.orderId === sOrder?.id, ordersForVisitor: ordersFor(home, sOrder?.visitorInstanceId).length, cacheWiped: true,
    broadcastKept: restoredNpc?.broadcastSource === 'declared' && restoredNpc?.broadcastFaction === 'Zzyx-Council',
  };
  // now hold and reload mid-dwell
  const restoredV = restoredNpc;
  let dwellReload = null;
  if (restoredV && lOrder) {
    await tickUntil(() => lOrder.state === 'holding' && lOrder.dwellMs > 1500, 900);
    const dwellBefore = lOrder.dwellMs;
    B.saveGame(8); B.loadGame(8);
    const lOrder2 = ledgerOf(home)?.orders?.[lOrder.id];
    const restored2 = s.npcShips.find((n) => n.securityInstanceId === lOrder.visitorInstanceId);
    const clearedAfter = await tickUntil(() => lOrder2 && lOrder2.outcome === 'cleared', 400);
    dwellReload = { dwellKept: lOrder2 && Math.abs(lOrder2.dwellMs - dwellBefore) < 300 || (lOrder2?.outcome === 'cleared'), restored: !!restored2, clearedAfter, ordersForVisitor: ordersFor(home, lOrder.visitorInstanceId).length, dwellBefore: Math.round(dwellBefore) };
  }
  out.saveReload = { approach: approachReload, dwell: dwellReload };
  // 12. replacement and boundary identity
  clearNpcs();
  const zoneB = zoneAt(home);
  const slotV = traffic(9541, 'ferengi', zoneB, zoneB.radius - 40, 1.0);
  await tickUntil(() => !!activeOrderOf(home, slotV), 100);
  const slotOrder = activeOrderOf(home, slotV);
  const oldInstance = slotV.securityInstanceId;
  B.beginAmbientTrafficArrival(slotV, performance.now());
  slotV.trafficWarp = null; slotV.x = zoneB.centre.x + zoneB.radius + 400; slotV.y = zoneB.centre.y;
  await fast(3);
  const newInstance = slotV.securityInstanceId;
  const jitterV = traffic(9542, 'ferengi', zoneB, zoneB.radius - 5, 2.0); jitterV.speed = 0; jitterV.destination = { x: jitterV.x, y: jitterV.y };
  await fast(3);
  const jOrder = activeOrderOf(home, jitterV); if (jOrder) jOrder.outcome = 'canceled'; // keep the boundary test about episodes, not orders
  const recJ = () => ledgerOf(home)?.visitors?.[jitterV.securityInstanceId];
  const ep0 = recJ()?.episode;
  const place = (d) => { const p = polar(zoneB, d, 2.0); jitterV.x = p.x; jitterV.y = p.y; jitterV.destination = { ...p }; };
  place(zoneB.radius + 10); await fast(2); place(zoneB.radius - 10); await fast(2);
  const epJitter = recJ()?.episode;
  place(zoneB.reentryDistance + 30); await fast(2); place(zoneB.radius - 10); await fast(2);
  const epReturn = recJ()?.episode;
  out.replacementIdentity = {
    orderIssued: !!slotOrder, sameNpcId: slotV.id === 9541, instanceChanged: oldInstance !== newInstance, oldOrderClosed: slotOrder?.outcome, oldOutcome: slotOrder?.outcome,
    newHasNoClearance: !ledgerOf(home)?.visitors?.[newInstance]?.clearance, newHasNoOrder: ordersFor(home, newInstance).length === 0,
    ep0, epJitter, epReturn,
  };
  // 13. capture and reclaim (the conquest transfer path that fleet capture and the Claim button use)
  clearNpcs();
  const zoneCap = zoneAt(home);
  const capV = traffic(9551, 'ferengi', zoneCap, zoneCap.radius - 40, 0.4);
  await tickUntil(() => !!activeOrderOf(home, capV), 100);
  const capOrder = activeOrderOf(home, capV);
  const epochBefore = B.getSecurityAuthorityEpoch(home);
  B.transferSystemControlToFaction(home, 'romulan');
  await fast(2);
  const lostZone = zoneAt(home);
  const configKept = !!B.getPlayerCheckpointConfig(home)?.enabled;
  const overrideKept = !!B.getSecurityPolicyOverride(home);
  const capV2 = traffic(9552, 'ferengi', zoneCap, zoneCap.radius - 40, 0.8);
  await fast(5);
  const ordersUnderOccupier = ordersFor(home, capV2.securityInstanceId).filter(o => o.authority === 'player').length;
  B.transferSystemControlToPlayer(home);
  await fast(2);
  const reclaimedZone = zoneAt(home);
  out.captureReclaim = {
    orderBefore: !!capOrder, outcome: capOrder?.outcome, epochBumped: B.getSecurityAuthorityEpoch(home) > epochBefore, lostZone: !lostZone || lostZone.authority !== 'player', configKept, overrideKept, ordersUnderOccupier,
    reclaimedActive: !!reclaimedZone && reclaimedZone.authority === 'player', reclaimedEpoch: B.getSecurityAuthorityEpoch(home), oldOrderStillClosed: !!capOrder?.outcome,
    activeAfterReclaim: Object.values(ledgerOf(home)?.orders || {}).filter((o) => !o.outcome && o.epoch < B.getSecurityAuthorityEpoch(home)).length,
  };
  // 14. operator UI through real clicks
  clearNpcs();
  // Dock at the real planet: the separated-arrival fix starts the ship outside service range.
  const dockMarker = B.getFlightPlanetMarker(home);
  B.setCamera(dockMarker.worldX, dockMarker.worldY);
  s.ship.velocity = 0; s.ship.turnVelocity = 0;
  s.docked = true; s.dockedPlanetIndex = home; s.dockedStationId = null; s.planetMenuOpen = true; s.dockMenuTab = 'security';
  B.renderPlanetMenu();
  const menu5 = document.getElementById('planet-menu');
  const click = (sel) => { const el = menu5?.querySelector(sel); if (!el) return false; el.click(); return true; };
  const clickedAccess = click('[data-security-access="other:challenge"]');
  const accessAfter = B.getEffectiveSecurityPolicy(home).access;
  const zoneUI = zoneAt(home);
  const uiV = traffic(9561, 'ferengi', zoneUI, zoneUI.radius - 40, 0.3);
  await tickUntil(() => !!activeOrderOf(home, uiV), 100);
  const uiOrder = activeOrderOf(home, uiV);
  B.render();
  const rowShown = !!menu5?.querySelector(`[data-security-order-row="${uiOrder?.id}"]`);
  const waived = click(`[data-security-order="${uiOrder?.id}"][data-security-op="waive"]`);
  await fast(2);
  const waiverProvenance = ledgerOf(home)?.visitors?.[uiV.securityInstanceId]?.clearance?.provenance || null; // a live record; later policy changes revoke it
  const uiV2 = traffic(9562, 'ferengi', zoneUI, zoneUI.radius - 40, 0.9);
  await tickUntil(() => !!activeOrderOf(home, uiV2), 100);
  const uiOrder2 = activeOrderOf(home, uiV2);
  B.render();
  const requested = click(`[data-security-order="${uiOrder2?.id}"][data-security-op="withdraw"]`);
  await fast(2);
  const afterRequest = { kind: uiOrder2?.kind, revision: uiOrder2?.revision, outcome: uiOrder2?.outcome };
  B.render();
  const cancelled = click(`[data-security-order="${uiOrder2?.id}"][data-security-op="cancel"]`);
  await fast(2);
  const uiV3 = traffic(9563, 'ferengi', zoneUI, zoneUI.radius - 40, 1.5);
  await tickUntil(() => !!activeOrderOf(home, uiV3), 100);
  const uiOrder3 = activeOrderOf(home, uiV3);
  B.renderPlanetMenu();
  const stricter = click('[data-security-access="other:closed"]');
  await fast(3);
  const afterStricter = { id: activeOrderOf(home, uiV3)?.id, kind: uiOrder3?.kind, revision: uiOrder3?.revision, outcome: uiOrder3?.outcome, count: ordersFor(home, uiV3.securityInstanceId).length };
  B.renderPlanetMenu();
  const relaxed = click('[data-security-access="other:open"]');
  await fast(3);
  const afterRelax = { outcome: uiOrder3?.outcome, noncompliant: !!ledgerOf(home)?.visitors?.[uiV3.securityInstanceId]?.noncompliant };
  B.renderPlanetMenu(); click('[data-security-access="other:challenge"]');
  const uiV4 = traffic(9564, 'ferengi', zoneUI, zoneUI.radius - 40, 2.1);
  await tickUntil(() => !!activeOrderOf(home, uiV4), 100);
  const uiOrder4 = activeOrderOf(home, uiV4);
  const otherAnchor = B.getSecurityAnchorCandidates(home, 'player').find((st) => st.id !== anchor5?.id);
  B.renderPlanetMenu();
  const reconfigured = otherAnchor ? click(`[data-security-anchor="${otherAnchor.id}"]`) : 'no second anchor';
  await fast(3);
  const afterReconfig = { outcome: uiOrder4?.outcome, noncompliant: !!ledgerOf(home)?.visitors?.[uiV4.securityInstanceId]?.noncompliant, zoneAnchor: zoneAt(home)?.anchorStationId };
  s.docked = false; s.planetMenuOpen = false; B.renderPlanetMenu();
  out.operatorUi = {
    clickedAccess, accessOther: accessAfter.other, accessWarFlagUntouched: accessAfter.warFlag, rowShown, waived, waivedOutcome: uiOrder?.outcome, waiverProvenance, waiverNotVerified: !uiOrder?.compliance,
    requested, afterRequest, cancelled, cancelledOutcome: uiOrder2?.outcome, stricter, afterStricter, relaxed, afterRelax, reconfigured, afterReconfig,
  };
  // 15. checkpoint loss and legacy / invalid saves
  clearNpcs();
  B.setPlayerCheckpoint(home, { anchorStationId: anchor5?.id });
  const zoneL = zoneAt(home);
  const lossV = traffic(9571, 'ferengi', zoneL, zoneL.radius - 40, 0.5);
  await tickUntil(() => !!activeOrderOf(home, lossV), 100);
  const lossOrder = activeOrderOf(home, lossV);
  const anchorLive = s.stations.find((st) => st.id === zoneL.anchorStationId);
  B.ensureStationCombatStats(anchorLive); B.damageCombatTarget(anchorLive, 999999, 'npc');
  await fast(3);
  const lossResult = { outcome: lossOrder?.outcome, zoneGone: zoneAt(home) === null, noFault: !ledgerOf(home)?.visitors?.[lossV.securityInstanceId]?.noncompliant, configKept: !!B.getPlayerCheckpointConfig(home)?.enabled };
  delete s.destroyedStations[anchorLive.id];
  B.saveGame(9);
  const key9 = B.getSaveSlotKey(9);
  const raw9 = JSON.parse(localStorage.getItem(key9));
  delete raw9.securityZones; delete raw9.securityEncounters;
  localStorage.setItem(key9, JSON.stringify(raw9));
  B.loadGame(9);
  const legacySave = { noZones: Object.keys(s.securityZones.systems).length === 0, noOrders: Object.values(s.securityEncounters.systems).every((l) => Object.values(l.orders).every((o) => o.outcome)), zoneNull: zoneAt(home) === null };
  const raw9b = JSON.parse(localStorage.getItem(key9));
  raw9b.securityZones = { systems: { [home]: { enabled: true, anchorStationId: 'nope' } }, epochs: { [home]: 'x' } };
  raw9b.securityEncounters = { systems: { [home]: { orders: { o1: { visitorKind: 'npc', visitorInstanceId: 'v9999', hold: 'bad', accessClass: 'warFlag' }, bad: { hold: { angle: 0, distance: 1 } } }, visitors: { 'v1': { inside: 'yes' }, 'x': {} }, participants: { v9999: { npcId: 'zz', x: 'q' } } } } };
  localStorage.setItem(key9, JSON.stringify(raw9b));
  let invalidLoadOk = true;
  try { B.loadGame(9); await fast(3); } catch (e) { invalidLoadOk = false; }
  const invalid = { ok: invalidLoadOk, noOrders: Object.values(s.securityEncounters.systems).every((l) => Object.values(l.orders).every((o) => o.outcome)), noOrphanObjective: !s.npcShips.some((n) => n.securityObjective), zoneNull: zoneAt(home) === null };
  out.checkpointLoss = { loss: lossResult, legacy: legacySave, invalid };
  // 8 / 9. the player at the authored Vulcan checkpoint
  s.playerFaction = 'neutral';
  B.transferSystemControlToFaction(vulcan, 'vulcan'); delete s.factionSystemOverrides[vulcan];
  for (const d of s.stationDefinitions) if (Number(d.systemIndex) === vulcan) delete s.destroyedStations[d.id];
  enterFresh(vulcan);
  B.setCameraNearPlanet();
  const arrivalInsideBefore = (() => { const z = zoneAt(vulcan); const p = B.playerWorldPosition(); return z ? Math.hypot(p.x - z.centre.x, p.y - z.centre.y) < z.radius : null; })();
  const placed = B.placePlayerAtSecurityApproach();
  const zoneV = zoneAt(vulcan);
  need(zoneV && zoneV.foreign && zoneV.authority === 'vulcan', 'S5 fixture: Vulcan checkpoint did not activate');
  const pv = B.playerWorldPosition();
  const arrival = { placed, inside: zoneV ? Math.hypot(pv.x - zoneV.centre.x, pv.y - zoneV.centre.y) < zoneV.radius : null, insideBefore: arrivalInsideBefore, anchor: zoneV?.anchorName, radius: zoneV?.radius };
  await fast(2);
  const noOrderOutside = !B.getPlayerSecurityOrder(vulcan);
  const bearing = Math.atan2(pv.y - zoneV.centre.y, pv.x - zoneV.centre.x);
  const goTo = (d) => { const p = polar(zoneV, d, bearing); B.setCamera(p.x, p.y); s.ship.velocity = 0; };
  goTo(zoneV.radius - 30); await fast(2);
  const pOrder = B.getPlayerSecurityOrder(vulcan);
  const markerV = B.getFlightPlanetMarker();
  const dockBlockedNear = (() => { const p = zoneV.centre; B.setCamera(p.x + 60, p.y); const ok = B.tryDockAtPlanetIndex(vulcan, B.getFlightPlanetMarker()); const log = s.log; goTo(zoneV.radius - 30); return { ok, log }; })();
  const logBefore = s.log;
  B.respondToSecurityOrder('request');
  const requestRefused = s.log;
  const rem0 = pOrder?.remainingMs;
  B.render(); const panelEl = document.getElementById('security-order-panel');
  const panelShown = panelEl && !panelEl.classList.contains('hidden');
  panelEl?.querySelector('[data-security-response="repeat"]')?.click();
  const repeatLog = s.log;
  const remAfterRepeat = pOrder?.remainingMs;
  panelEl?.querySelector('[data-security-response="acknowledge"]')?.click();
  const acknowledged = pOrder?.acknowledged;
  const holdPointV = B.resolveSecurityPoint(zoneV, pOrder.hold);
  B.setCamera(holdPointV.x + 20, holdPointV.y); s.ship.velocity = 0;
  const clearedP = await tickUntil(() => pOrder && pOrder.outcome === 'cleared', 400);
  await fast(2);
  const dockAfter = (() => { const p = zoneV.centre; B.setCamera(p.x + 60, p.y); const ok = B.tryDockAtPlanetIndex(vulcan, B.getFlightPlanetMarker()); s.docked = false; s.dockedPlanetIndex = null; s.planetMenuOpen = false; return ok; })();
  // Clearance is conditional on continued peace. Player aggression against the authority in this
  // system revokes it and produces a fresh instruction for the still-present visitor.
  s.lastPlayerAggressionAt = performance.now(); s.lastPlayerAggressionSystemIndex = vulcan; s.lastPlayerAggressionTargetSide = 'vulcan';
  await fast(2);
  const orderAfterAggression = B.getPlayerSecurityOrder(vulcan);
  const clearanceRevokedByAggression = !ledgerOf(vulcan)?.visitors?.player?.clearance && !!orderAfterAggression;
  if (orderAfterAggression) B.operateSecurityOrder(orderAfterAggression.id, 'cancel');
  s.lastPlayerAggressionAt = 0; s.lastPlayerAggressionSystemIndex = null; s.lastPlayerAggressionTargetSide = null;
  const concession = s.stations.find((st) => st.id === 'probe-council-concession' && !st.destroyed) || null;
  out.playerCompliance = {
    arrival, noOrderOutside, ordered: !!pOrder, kind: pOrder?.kind, cls: pOrder?.accessClass, dockBlockedNear, requestRefused: /units from the holding point|full stop|hold position/i.test(requestRefused) && requestRefused !== logBefore,
    panelShown, repeatKeepsTimer: remAfterRepeat === rem0 && /remaining/.test(repeatLog), acknowledged, clearedP, outcome: pOrder?.outcome, dockAfter, clearanceRevokedByAggression,
    foreignEditRejected: B.setSecurityPolicyOverride(vulcan, { access: { other: 'open' } }) === null && B.setPlayerCheckpoint(vulcan, { enabled: false }) === null,
  };
  // 9. withdraw, then refuse, on fresh episodes
  goTo(zoneV.reentryDistance + 40); await fast(3);
  goTo(zoneV.radius - 30); await fast(2);
  const wOrderP = B.getPlayerSecurityOrder(vulcan);
  B.respondToSecurityOrder('withdraw');
  const withdrawingP = wOrderP?.withdrawing;
  const stillActiveBeforeMove = wOrderP && !wOrderP.outcome;
  goTo(zoneV.exitDistance + 20); await fast(3);
  const withdrawnP = wOrderP?.outcome;
  goTo(zoneV.reentryDistance + 40); await fast(3);
  goTo(zoneV.radius - 30); await fast(2);
  const rOrderP = B.getPlayerSecurityOrder(vulcan);
  const stAllV = snapStandings();
  B.respondToSecurityOrder('refuse');
  await fast(2);
  const vrec = ledgerOf(vulcan)?.visitors?.player;
  const dockRefused = (() => { const p = zoneV.centre; B.setCamera(p.x + 60, p.y); const ok = B.tryDockAtPlanetIndex(vulcan, B.getFlightPlanetMarker()); goTo(zoneV.radius - 30); return ok; })();
  const anyHostile = s.npcShips.some((n) => n.hostile) || s.stations.some((st) => st.hostile);
  out.playerWithdrawRefuse = {
    newOrderAfterReentry: !!wOrderP && wOrderP.id !== pOrder?.id, withdrawingP, stillActiveBeforeMove, withdrawnP, clearanceAfterWithdraw: vrec?.clearance || null,
    refuseOrder: !!rOrderP && rOrderP.id !== wOrderP?.id, refusedOutcome: rOrderP?.outcome, noncompliant: vrec?.noncompliant === true, dockRefused, standingsSame: snapStandings() === stAllV, anyHostile,
    departureClears: (() => { s.warp = { active: true, from: vulcan, to: qonos, startedAt: 0, duration: 0, route: null, message: '' }; B.completeWarpTravel(); const rec = ledgerOf(vulcan)?.visitors?.player; return { outcome: rOrderP?.outcome, noncompliantAfterJump: !!rec?.noncompliant, inside: !!rec?.inside, now: s.currentPlanet === qonos }; })(),
  };
  // 16. end-state isolation: clearance touches nothing else
  enterFresh(home); B.setSecurityPolicyOverride(home, { roe: 'defend', access: { other: 'challenge' } }); // defend: hostility alone is a target (Phase 2)
  B.setPlayerCheckpoint(home, { enabled: true, anchorStationId: B.getSecurityAnchorCandidates(home, 'player')[0]?.id });
  const zoneE = zoneAt(home);
  const hostileE = mk(9581, 'klingon', { attitude: 'hostile', hostile: true, role: 'patrol' }, polar(zoneE, 80, 0.5));
  const fleetBefore = JSON.stringify(s.playerFleet || []);
  const clearedE = traffic(9582, 'ferengi', zoneE, zoneE.radius - 40, 1.0);
  await tickUntil(() => !!activeOrderOf(home, clearedE), 100);
  const eOrder = activeOrderOf(home, clearedE); if (eOrder) B.operateSecurityOrder(eOrder.id, 'waive');
  await fast(2);
  out.isolation = { hostileNotAddressed: ordersFor(home, hostileE.securityInstanceId || 'none').length === 0, hostileStillTarget: B.isPlayerEscortShipTarget(hostileE), fleetSame: JSON.stringify(s.playerFleet || []) === fleetBefore, waived: eOrder?.outcome === 'waived', hostileFlagKept: hostileE.hostile === true };
  B.render();
  }
  try {
    await scenarioBody();
  } catch (error) {
    out.setup.push(`runner error at stage "${out.stage || '?'}": ${error && error.stack ? error.stack.split('\n').slice(0, 3).join(' | ') : error}`);
  }
  return out;
}

// Stages three scenes for review screenshots; registers window.__bm1Shots[stage]() switchers.
async function shotsRunner() {
  const B = window.__bm1; const s = B.state;
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const home = B.getSystemIndexByName('Ferenginar');
  const vulcan = B.getSystemIndexByName('Vulcan');
  const out = {};
  const enter = (i) => { delete s.systemStates[i]; s.currentPlanet = i; s.myplanet = i + 1; s.selectedPlanet = i; B.applySystemState(i); s.spawnProtectionUntil = 0; s.worldPops = []; };
  const stages = {};
  stages.operator = () => {
    s.playerFaction = 'terran';
    B.transferSystemControlToPlayer(home);
    for (const d of s.stationDefinitions) if (Number(d.systemIndex) === home) delete s.destroyedStations[d.id];
    enter(home);
    const anchor = B.getSecurityAnchorCandidates(home, 'player')[0];
    B.setPlayerCheckpoint(home, { enabled: true, anchorStationId: anchor?.id });
    B.setSecurityPolicyOverride(home, { roe: 'defend', access: { warFlag: 'closed', other: 'challenge' } });
    const zone = B.getSecurityZone(home);
    const at = (d, a) => ({ x: zone.centre.x + Math.cos(a) * d, y: zone.centre.y + Math.sin(a) * d });
    for (const [id, faction, a] of [[9801, 'ferengi', 0.4], [9802, 'klingon', 2.1], [9803, 'vulcan', 4.0]]) {
      const n = B.createNpcShip({ id, shipId: 1, faction, attitude: 'neutral', hostile: false, seed: id, from: at(zone.radius - 30, a), role: 'traffic' });
      B.ensureNpcCombatStats(n); n.identityLocked = true; n.sideId = faction; n.destination = at(120, a); n.destinationName = 'inner beacon'; n.speed = 0.9;
      s.npcShips.push(n);
    }
    for (let i = 0; i < 40; i++) B.tick(1);
    s.docked = true; s.dockedPlanetIndex = home; s.dockedStationId = null; s.planetMenuOpen = true; s.dockMenuTab = 'security';
    B.setCamera(zone.centre.x + 40, zone.centre.y + 30);
    B.renderPlanetMenu(); B.render();
    const panel = document.querySelector('#planet-menu .dock-panel'); if (panel) panel.scrollTop = panel.scrollHeight;
    out.operator = { zone: !!zone, orders: Object.values(B.getSecurityLedger(home)?.orders || {}).filter((o) => !o.outcome).length };
  };
  stages['visitor-order'] = () => {
    s.docked = false; s.planetMenuOpen = false; B.renderPlanetMenu();
    s.playerFaction = 'neutral';
    B.transferSystemControlToFaction(vulcan, 'vulcan'); delete s.factionSystemOverrides[vulcan];
    for (const d of s.stationDefinitions) if (Number(d.systemIndex) === vulcan) delete s.destroyedStations[d.id];
    enter(vulcan);
    B.setCameraNearPlanet(); B.placePlayerAtSecurityApproach();
    const zone = B.getSecurityZone(vulcan);
    const p = B.playerWorldPosition();
    const bearing = Math.atan2(p.y - zone.centre.y, p.x - zone.centre.x);
    B.setCamera(zone.centre.x + Math.cos(bearing) * (zone.radius - 30), zone.centre.y + Math.sin(bearing) * (zone.radius - 30));
    s.ship.velocity = 0;
    for (let i = 0; i < 3; i++) B.tick(1);
    B.respondToSecurityOrder('acknowledge');
    B.render();
    out.visitorOrder = { order: !!B.getPlayerSecurityOrder(vulcan) };
  };
  stages['visitor-holding'] = () => {
    const zone = B.getSecurityZone(vulcan);
    const order = B.getPlayerSecurityOrder(vulcan);
    if (!zone || !order) return;
    const hold = B.resolveSecurityPoint(zone, order.hold);
    B.setCamera(hold.x + 10, hold.y); s.ship.velocity = 0;
    for (let i = 0; i < 60; i++) B.tick(1); // about a second of holding
    B.render();
    out.visitorHolding = { state: order.state, dwell: Math.round(order.dwellMs) };
  };
  window.__bm1Shots = stages;
  return out;
}

const { server, port } = await startServer();
const { chromium } = await loadPlaywright();
const browser = await chromium.launch();
let exitCode = 1;
try {
  const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
  const pageErrors = [];
  page.on('pageerror', (e) => pageErrors.push(e.message));
  await page.goto(`http://127.0.0.1:${port}/`, { waitUntil: 'load' });
  // The state starts with a 4-entry fallback planet list; wait for real planet data and the ship manifest.
  await page.waitForFunction(() => {
    const st = window.__bm1?.state;
    return st && st.planets?.length > 10 && Object.keys(st.shipStatsById || {}).length > 10;
  }, null, { timeout: TIMEOUT_MS });
  const r = await page.evaluate(scenarioRunner);
  const g = (o) => o || {};

  const checks = [
    ...r.setup.map((msg) => [`SETUP ${msg}`, false]),
    ['S1a NPC-only ship kill gives no salvage', g(r.npcShipKill).destroyed && r.npcShipKill.latinumDelta === 0],
    ['S1a NPC-only ship kill changes no standing or feat', g(r.npcShipKill).destroyed && !r.npcShipKill.anyStandingChanged && !r.npcShipKill.featsChanged],
    ['S1b player ship kill still rewards and blames', g(r.playerShipKill).destroyed && r.playerShipKill.latinumDelta > 0 && r.playerShipKill.standingDelta < 0],
    ['S1c NPC-only station destruction gives no salvage', g(r.npcStationKill).destroyed && r.npcStationKill.latinumDelta === 0],
    ['S1c NPC-only station destruction changes no standing or feat', g(r.npcStationKill).destroyed && !r.npcStationKill.anyStandingChanged && !r.npcStationKill.featsChanged],
    ['S1d escort projectile carries creditSource playerEscort', g(r.escortProjectileKill).shotOwner === 'npc' && r.escortProjectileKill.shotCredit === 'playerEscort'],
    ['S1d victim records lastDamageSource playerEscort', g(r.escortProjectileKill).destroyed && r.escortProjectileKill.lastDamageSource === 'playerEscort'],
    ['S1d escort projectile kill is credited to the player', g(r.escortProjectileKill).destroyed && r.escortProjectileKill.latinumDelta > 0 && r.escortProjectileKill.standingDelta < 0],
    ['S1e NPC-only clearing of Bajora sets no feat and no Cardassian standing', g(r.bajoraNpcOnly).allDestroyed && !r.bajoraNpcOnly.featSet && r.bajoraNpcOnly.cardassianDelta === 0],
    ['S1e NPC-only clearing of Bajora gives no salvage or other standing', g(r.bajoraNpcOnly).allDestroyed && r.bajoraNpcOnly.latinumDelta === 0 && !r.bajoraNpcOnly.anyStandingChanged && !r.bajoraNpcOnly.featsChanged],
    // The player's final station kill also applies kill standing for that station's faction, whose relationship
    // cascade can add to Cardassian standing (+3 when the last station is Bajoran, 0 when it is the neutral
    // shipyard), so require the feat's +15 as a floor rather than an exact value.
    ['S1f player final kill on Bajora still unlocks feat and >= +15 Cardassian', g(r.bajoraPlayerFinal).allDestroyed && r.bajoraPlayerFinal.featSet && r.bajoraPlayerFinal.cardassianDelta >= 15],
    ['S2a hunter keeps pursuing beyond weapon range', g(r.far).pursuing === true && r.far.alive],
    ['S2b hunter beyond weapon range never fires (weapon ready, >2 cooldowns)', g(r.far).fired === false],
    ['S2c hunter inside weapon range fires and lands (beam)', g(r.near).fired && r.near.playerHitAfter && r.near.maxDrop > 0],
    ['S3a Breen and Dominion have no declared relationship either way', g(r.relations).breenDominionAligned === false && r.relations.breenDominionOpposed === false],
    ['S3a five formerly missing keys are present in the table as empty lists', g(r.relations).entriesPresent === true && r.relations.explicitEmpty === true],
    ['S3a unknown relation key warns exactly once', g(r.relations).unknownKeyWarnings === 1],
    ['S3b foreign-owned and private stations in the player system keep their owners', g(r.independent).owners?.gov === 'player' && r.independent.owners.foreign === 'vulcan' && r.independent.owners.priv === 'private:probe-private-1' && r.independent.foreignFlag === 'vulcan' && !r.independent.foreignOwned],
    ['S3b independent escort and owned station both fire on a raider (ticks)', g(r.independent).control?.allegiance === 'neutral' && r.independent.govOwned && r.independent.escortIsDefender && r.independent.raiderAttacksEscortSide && r.independent.escortTargetsRaider && r.independent.escortFired && r.independent.stationFired && r.independent.raiderHullDropped && ['playerEscort', 'station'].includes(r.independent.raiderDamagedBy)],
    ['S3b hostile independent ship is a target and attacker; independence is no immunity', g(r.hostileNeutral).escortTarget && r.hostileNeutral.attackerToEscort && r.hostileNeutral.canTargetStation && String(r.hostileNeutral.sideId).startsWith('ship:')],
    ['S3c neutral trader never defends', g(r.visitors).playerControlled && r.visitors.traderDefends === false],
    ['S3c same-flag foreign patrol may assist a raid defense while staying foreign', g(r.visitors).patrolMayAssist && r.visitors.patrolEngagesPirate && r.visitors.patrolOwnerUnchanged],
    ['S3c a hostile station flying the player flag is an escort target; a calm one is not', g(r.visitors).sameFlagStation?.owner === 'ferengi' && r.visitors.sameFlagStation.flag === 'ferengi' && r.visitors.sameFlagStation.targetWhenCalm === false && r.visitors.sameFlagStation.targetWhenHostile === true],
    ['S3c same-flag foreign vessel that fires on the player station is an attacker and target', g(r.visitors).merchantAggressionSide === 'player' && r.visitors.merchantAttacker && r.visitors.merchantEscortTarget],
    ['S3d raising a flag re-flags owned installations only; owners unchanged', g(r.flagChange).playerFaction === 'klingon' && r.flagChange.control.controller === 'player' && r.flagChange.control.allegiance === 'klingon' && r.flagChange.govFlag === 'klingon' && r.flagChange.govOwned && r.flagChange.foreignFlag === 'vulcan' && !r.flagChange.foreignOwned && r.flagChange.privFlag === 'neutral' && !r.flagChange.privOwned && r.flagChange.owners.foreign === 'vulcan'],
    ['S3d same-flag raid: player escorts wearing the raider flag still count and engage', g(r.sameFlagRaid).playerFlag === 'klingon' && r.sameFlagRaid.raiderFlag === 'klingon' && r.sameFlagRaid.escortFlag === 'klingon' && r.sameFlagRaid.escortSide === 'player' && r.sameFlagRaid.escortCounted && r.sameFlagRaid.raiderIsTarget && r.sameFlagRaid.raiderAttacksEscort],
    ['S3e peaceful foreign patrol is not a defender against a fleet it has no quarrel with', g(r.reconquest).capturePreconditions?.ships === 0 && r.reconquest.bystanderAfterCapture?.defends === true && r.reconquest.bystanderAfterCapture.targetsFleet === null && r.reconquest.bystanderAfterCapture.alive && r.reconquest.bystanderAfterCapture.faction === 'ferengi'],
    ['S3e a foreign concession at war with the raiders counts as a defender until reduced', g(r.reconquest).concessionHolds?.stations?.length === 1 && r.reconquest.concessionHolds.stations[0] === 'probe-foreign-vulcan' && r.reconquest.concessionHolds.ships === 0 && r.reconquest.stillPlayerWhileConcessionStands === 'player'],
    ['S3e real raid capture transfers control and player installations, not the foreign station', g(r.reconquest).capturePreconditions?.stations === 0 && r.reconquest.capturePreconditions.player === false && r.reconquest.lostController === 'romulan' && r.reconquest.ownersLost.gov === 'romulan' && r.reconquest.ownersLost.foreign === 'vulcan' && r.reconquest.govFlagLost === 'romulan' && !r.reconquest.govOwnedLost && r.reconquest.attackersAfter.every((a) => a.faction === 'romulan' && a.role === 'occupationFleet')],
    ['S3e a surviving occupation fleet blocks reclamation; clearing it allows the claim', g(r.reconquest).reclaimBlocked?.canClaim === false && r.reconquest.reclaimBlocked.blockers.filter((b) => b === 'patrol ship:romulan').length === 2 && !r.reconquest.reclaimBlocked.blockers.some((b) => b.includes('vulcan') || b.includes('ferengi')) && r.reconquest.reclaimBlocked.stillLost === 'romulan' && r.reconquest.reclaimBlocked.clearedCanClaim === true],
    ['S3e the real Claim button reclaims control and installations without re-flagging the foreign station (runtime and cache)', g(r.reconquest).reclaimedController === 'player' && r.reconquest.ownersReclaimed.gov === 'player' && r.reconquest.ownersReclaimed.foreign === 'vulcan' && r.reconquest.govFlagReclaimed === 'klingon' && r.reconquest.claimRuntime?.foreignFlag === 'vulcan' && r.reconquest.claimRuntime.foreignOwner === 'vulcan' && r.reconquest.claimCache?.govFlag === 'klingon' && r.reconquest.claimCache.foreignFlag === 'vulcan' && !r.reconquest.claimCache.foreignOwned],
    ['S3f unknown origin stays unknown (no controller, no polity)', g(r.identity).unknown?.origin === null && r.identity.unknown.originSource === 'unknown' && r.identity.unknown.controller === null && r.identity.unknown.polityId === null],
    ['S3f custom polity ID is preserved exactly (case included)', g(r.identity).custom?.controller === 'Zzyx-Council' && r.identity.custom.polityId === 'Zzyx-Council' && r.identity.custom.allegiance === 'neutral'],
    ['S3f custom polity ships and station share one side; an unrelated independent does not', g(r.customPolity).shipSides?.[0] === 'Zzyx-Council' && r.customPolity.shipSides[1] === 'Zzyx-Council' && String(r.customPolity.shipSides[2]).startsWith('ship:') && r.customPolity.stationOwnedByPolity && r.customPolity.shipsAligned && r.customPolity.shipStationAligned && !r.customPolity.loneAligned],
    ['S3f explicit independence is distinct per world and never the origin empire', g(r.identity).earth?.origin === 'terran' && r.identity.earth.controller === 'neutral' && r.identity.earth.polityId !== 'terran' && r.identity.earth.allegiance === 'neutral' && r.identity.distinctPolities],
    ['S3g arrival protection is personal (fleet, orders, factions, control, stations untouched)', g(r.arrival).protectionSet && r.arrival.fleetSurvived && r.arrival.ordersKept && r.arrival.factionsKept && r.arrival.controlUnchanged && r.arrival.stationAttitudesUnchanged],
    ['S3h control for every planet is identical across save/reload', g(r.persistence).planets > 10 && r.persistence.diffs.length === 0 && r.persistence.flagKept],
    ['S3h expected holders after reload (player, independent Earth, Cardassian Bajora, untouched origins)', g(r.persistence).expected?.home && r.persistence.expected.vulcanQonos && r.persistence.expected.earth && r.persistence.expected.bajora && r.persistence.expected.untouchedOrigin && r.persistence.expected.unknownOrigins === 0],
    ['S3h station owners and flags survive reload and re-entry', g(r.persistence).ownersAfterReload?.gov === 'player' && r.persistence.ownersAfterReload.foreign === 'vulcan' && r.persistence.ownersAfterReload.priv === 'private:probe-private-1' && r.persistence.runtime?.govOwned && r.persistence.runtime.govFlag === 'klingon' && r.persistence.runtime.foreignFlag === 'vulcan' && !r.persistence.runtime.foreignOwned],
    ['S3h legacy save without ownership records migrates to the expected owners', g(r.migration).hadRecords && r.migration.recordsRebuilt && r.migration.homeGov === 'player' && r.migration.foreignRecorded === null && r.migration.foreignResolved === 'vulcan' && r.migration.privateResolved === 'private:probe-private-1' && r.migration.bajoraGov],
    ['S3k cached re-entry keeps existing ship id, hull, faction and side across return and change of holder', g(r.cachedReentry).ships > 0 && r.cachedReentry.sameAfterReturn && r.cachedReentry.sameAfterCapture && r.cachedReentry.holderDuring === 'romulan'],
    ['S3k a constructed custom-polity ship in the snapshot is not re-fitted on restoration', g(r.cachedReentry).zz?.shipId === 305 && r.cachedReentry.zz.faction === 'neutral' && r.cachedReentry.zz.side === 'Zzyx-Council'],
    ['S3l flying the holder flag is not control, but grants faction access', g(r.sameFlagAuthority).playerFlag === 'klingon' && r.sameFlagAuthority.controller === 'klingon' && r.sameFlagAuthority.controlled === false && r.sameFlagAuthority.claimLabel !== 'Controlled' && r.sameFlagAuthority.access === true],
    ['S3j an alliance does not excuse a witnessed attack (Vulcan fires on Terran station)', g(r.alliedAggression).aligned && r.alliedAggression.attacker === false && r.alliedAggression.turretTarget === false && r.alliedAggression.firedAt === 'terran' && r.alliedAggression.attackerAfter && r.alliedAggression.turretTargetAfter && r.alliedAggression.patrolSelects],
    ['S3j fleet accounting follows the same rule: allied patrol and station count only after the attack', g(r.alliedAggression).fleet?.patrol === false && r.alliedAggression.fleet.station === false && r.alliedAggression.fleetAfter?.patrol === true && r.alliedAggression.fleetAfter.station === true],
    ['S3f2 a custom government\'s own stations block conquest; its concessions do not', g(r.customConquest).controller === 'Zzyx-Council' && r.customConquest.councilStations > 0 && r.customConquest.blockers.length === r.customConquest.councilStations && !r.customConquest.blockers.some((b) => b.includes('Concession') || b.includes('Private Dock')) && r.customConquest.blockedCanClaim === false && r.customConquest.clearedCanClaim === true && r.customConquest.concessionOwner === 'ferengi' && r.customConquest.privateOwner === 'private:probe-council-private'],
    ['S4.1 with no policy set the effective policy is the default and answers match Phase 1', g(r.policyDefault).matchesDefault && r.policyDefault.raider?.target && r.policyDefault.raider.attacker && r.policyDefault.hostile?.target && r.policyDefault.warFlag?.target && r.policyDefault.warFlag.attacker && r.policyDefault.calm?.target === false && r.policyDefault.calm.attacker === false],
    ['S4.2 two holdings: return-fire at home ignores a calm war-flag patrol until it fires; defend at Vulcan engages it', g(r.twoHoldings).homeRoe === 'return-fire' && r.twoHoldings.vulcanRoe === 'defend' && r.twoHoldings.homeCalm?.target === false && r.twoHoldings.homeCalm.attacker === false && r.twoHoldings.homeAfterFire?.target === true && r.twoHoldings.homeAfterFire.attacker === true && r.twoHoldings.vulcanCalm?.target === true],
    ['S4.3 independent player: defend engages the hostile ship but not a visiting Klingon; return-fire waits for fire', g(r.independentPlayer).flag === 'neutral' && r.independentPlayer.defend?.klingon?.target === false && r.independentPlayer.defend.hostile?.target === true && r.independentPlayer.returnFire?.hostile?.target === false && r.independentPlayer.afterFire?.target === true],
    ['S4.4 foreign-defense independence: the live Vulcan concession fires on its attacker under both ROEs; the player escort does not; sides and ownership unchanged', ['defend', 'return-fire'].every((k) => g(r.foreignDefense)[k]?.concessionAlive === true && r.foreignDefense[k].concessionFired === true && r.foreignDefense[k].raiderHitBy === 'station' && r.foreignDefense[k].escortFiredAtRaider === false && r.foreignDefense[k].raider?.target === false && r.foreignDefense[k].raider.attacker === false && r.foreignDefense[k].concessionTurret === true && r.foreignDefense[k].concessionOwner === 'vulcan' && r.foreignDefense[k].patrolSide === 'ferengi' && r.foreignDefense[k].patrolCommanded === false)],
    ['S4.5 station retaliation: return-fire ignores a merely hostile station until it fires; defend does not', g(r.stationRoe).hubOwner === 'ferengi' && r.stationRoe.hubHostileReturnFire === false && r.stationRoe.hubFiredAt === 'player' && r.stationRoe.hubAfterFire === true && r.stationRoe.hubHostileDefend === true],
    ['S4.6 explicit orders override ROE (escort fires on the ordered live foreign hub); an order on a live player-owned installation is refused, leaves it friendly, and it is never fired on', g(r.stationRoe).hubAlive && r.stationRoe.govAlive && r.stationRoe.calmHubNoOrder === false && r.stationRoe.calmHubOrdered === true && r.stationRoe.hubFiredOn === true && r.stationRoe.ownOrderRefused === true && r.stationRoe.ownOrdered === false && r.stationRoe.ownNeverFiredOn === true],
    ['S4.14 attacking a same-flag foreign concession never turns player-owned stations, cached copies or the garrison against the player', g(r.ownDefenses).flag === 'ferengi' && r.ownDefenses.hubOwner === 'ferengi' && r.ownDefenses.hubFlag === 'ferengi' && r.ownDefenses.hubAlive && r.ownDefenses.hubHitByEscort && r.ownDefenses.hubTurnedHostile && r.ownDefenses.gov?.owner === 'player' && r.ownDefenses.gov.hostile === false && r.ownDefenses.gov.attitude === 'friendly' && r.ownDefenses.gov.firedAtPlayer === false && r.ownDefenses.cachedGov?.hostile === false && r.ownDefenses.garrison?.side === 'player' && r.ownDefenses.garrison.hostile === false && r.ownDefenses.garrison.attitude === 'friendly' && r.ownDefenses.garrison.aggro === false && r.ownDefenses.foreignPatrolAlerted === true],
    ['S4.15 an ambient replacement on the same slot inherits no attack evidence, aggro, escort order or raid membership', g(r.replacementEvidence).sameId === true && r.replacementEvidence.before?.target === true && r.replacementEvidence.before.attacker === true && r.replacementEvidence.after?.target === false && r.replacementEvidence.after.attacker === false && r.replacementEvidence.fields?.aggressionAt === 0 && r.replacementEvidence.fields.aggressionSide === null && r.replacementEvidence.fields.aggro === 0 && r.replacementEvidence.fields.order === 0 && r.replacementEvidence.fields.attackId === null && r.replacementEvidence.fields.damage === null],
    ['S4.7 an attackId alone is not raid evidence; only a raid on this holding counts', g(r.raidEvidence).roe === 'return-fire' && r.raidEvidence.staleNoAttack?.target === false && r.raidEvidence.staleNoAttack.attacker === false && r.raidEvidence.staleOtherSystem?.target === false && r.raidEvidence.raidHere?.target === true && r.raidEvidence.raidHere.attacker === true],
    ['S4.8 aggression counts only where it was seen; standing orders apply outside holdings', g(r.aggressionScope).elsewhereAggression?.target === false && r.aggressionScope.hereAggression?.target === true && r.aggressionScope.abroadCalm?.roe === 'return-fire' && r.aggressionScope.abroadCalm.held === false && r.aggressionScope.abroadCalm.target === false && r.aggressionScope.abroadAfterFire?.target === true && r.aggressionScope.abroadDefendCalm?.target === true],
    ['S4.9 partial overrides merge by dimension without erasing other defaults', g(r.partialOverride).partial1?.roe === 'defend' && r.partialOverride.partial1.access?.warFlag === 'challenge' && r.partialOverride.partial1.access.independent === 'closed' && r.partialOverride.partial1.access.unknown === 'open' && r.partialOverride.partial1.access.other === 'open' && r.partialOverride.partial2?.roe === 'return-fire' && r.partialOverride.partial2.access?.independent === 'closed' && r.partialOverride.partial2.access.warFlag === 'challenge' && r.partialOverride.storedOverride?.access?.warFlag === undefined],
    ['S4.10 raising another flag leaves policies untouched', g(r.flagPolicy).same === true && r.flagPolicy.flag === 'klingon' && r.flagPolicy.roeHome === 'return-fire'],
    ['S4.11 a lost holding has no effective policy, keeps its override, uses standing orders; reclaim restores it', g(r.lossReclaim).effective === null && r.lossReclaim.retained === true && r.lossReclaim.roeApplied === r.lossReclaim.defaultRoe && r.lossReclaim.reclaimedRoe === 'return-fire'],
    ['S4.12 policies survive save/reload; a legacy save loads with the default and no overrides', g(r.persistPolicy).same && r.persistPolicy.effSame && r.persistPolicy.legacyDefault && r.persistPolicy.legacyNoOverride],
    ['S4.13 Security tab only where the side has authority; its buttons set, promote and clear policy', g(r.securityUi).tabPresent === true && r.securityUi.uiOverride === 'return-fire' && r.securityUi.uiDefault === 'return-fire' && r.securityUi.uiCleared === true && r.securityUi.foreignHeldByFlagFaction === 'klingon' && r.securityUi.flag === 'klingon' && r.securityUi.foreignTab === false],
    ['S5.0 checkpoint authority: foreign and private stations are not anchors; disabled by default; a same-flag foreign world rejects configuration; enabling activates the zone', g(r.zoneAuthority).foreignExcluded === true && r.zoneAuthority.foreignPresent === true && r.zoneAuthority.disabledByDefault === true && r.zoneAuthority.setAtForeign === true && r.zoneAuthority.enabled === true && r.zoneAuthority.radius >= 560 && r.zoneAuthority.radius <= 1100],
    ['S5.1 open access: a visitor crosses an enabled open zone; no order, objective, offence, hostility, standing change or shot', g(r.openAccess).inside === true && r.openAccess.orders === 0 && !r.openAccess.objective && r.openAccess.hostile === false && r.openAccess.attackId === null && r.openAccess.standingsSame && r.openAccess.escortFired === null && r.openAccess.anchorShots === null && r.openAccess.noncompliant === false],
    ['S5.17 tightening open access while a visitor is already inside issues a withdrawal in the same visit', g(r.policyTightening).sameEpisode && r.policyTightening.issued && r.policyTightening.kind === 'withdraw' && r.policyTightening.decision === 'closed'],
    ['S5.2 challenge: one order, the civilian approaches, holds through the dwell, is cleared with scope movement_identity and resumes its route; identity untouched', g(r.challenge).issued && r.challenge.kind === 'challenge' && r.challenge.cls === 'other' && r.challenge.destWhileOrdered === 'checkpoint hold' && r.challenge.reached && r.challenge.cleared && r.challenge.outcome === 'cleared' && r.challenge.compliance === 'movement_identity' && r.challenge.orders === 1 && r.challenge.clearance === 'check' && r.challenge.resumed && JSON.stringify(r.challenge.identity) === JSON.stringify(r.challenge.identityBefore) && r.challenge.stillOneOrderAfterDwell],
    ['S5.3 closed: one withdrawal instruction; the civilian leaves, is recorded withdrawn (scope withdrawal), takes an outside lane, and gets no clearance', g(r.closedAccess).issued && r.closedAccess.kind === 'withdraw' && r.closedAccess.withdrawn && r.closedAccess.outcome === 'withdrawn' && r.closedAccess.compliance === 'withdrawal' && r.closedAccess.nextDestinationOutside && r.closedAccess.objectiveCleared && r.closedAccess.orders === 1 && r.closedAccess.clearance === null],
    ['S5.4 refusal/expiry under return-fire: a calm war-flag visitor expires; noncompliance recorded once; no hostility, raid flag, aggro or standing change; escorts and turrets do not fire', g(r.refusal).issued && r.refusal.cls === 'warFlag' && r.refusal.expired && r.refusal.outcome === 'expired' && r.refusal.noncompliant && r.refusal.hostile === false && r.refusal.attackId === null && r.refusal.aggro === false && r.refusal.standingsSame && r.refusal.escortTarget === false && r.refusal.attacker === false && r.refusal.escortFired === null && r.refusal.anchorFired === null && r.refusal.secondOrderForSameVisit === 1],
    ['S5.5 real aggression under the same policy still permits defence; stale evidence does not; no clearance is implied', g(r.realAggression).afterShot?.target === true && r.realAggression.afterShot.attacker === true && r.realAggression.stale?.target === false && r.realAggression.stale.attacker === false && r.realAggression.noClearance],
    ['S5.7 classification: own side exempt, same-flag foreigner other, unbranded hull independent, war flag, declared custom polity other, unidentified enforceable with default open', g(r.classification).own === 'exempt:open:false' && r.classification.sameFlag === 'other:challenge:true' && r.classification.independent === 'independent:challenge:true' && r.classification.warFlag === 'warFlag:closed:true' && r.classification.custom === 'other:challenge:true' && r.classification.unknown === 'unknown:open:true' && r.classification.unknownNotOrdered && r.classification.ownNotOrdered && r.classification.customOrdered && r.classification.customSide === 'Zzyx-Council'],
    ['S5.10 time: the local clock follows the simulated delta, not wall or unloaded time; engine loss and combat end orders without fault; an order in an unloaded system keeps its remaining time and resumes on the same slot', g(r.timeAndInterruptions).slowDelta === 42 && r.timeAndInterruptions.idleDelta === 0 && r.timeAndInterruptions.unloadedDelta === 0 && r.timeAndInterruptions.disabled === 'unable_to_comply' && r.timeAndInterruptions.disabledFault === false && r.timeAndInterruptions.combat === 'interrupted' && r.timeAndInterruptions.combatFault === false && r.timeAndInterruptions.awayOrderKeptRemaining && r.timeAndInterruptions.awayRestoredSameSlot && r.timeAndInterruptions.awayOrderStillActive],
    ['S5.11 save/reload during approach and during dwell: same participant, order, remaining time, declared broadcast and dwell; no duplicate, refilled hull or repeated incident; the check then completes', g(r.saveReload).approach?.orderKept && r.saveReload.approach.remainingKept && r.saveReload.approach.restored && r.saveReload.approach.sameSlot && r.saveReload.approach.duplicates === 1 && r.saveReload.approach.hullKept && r.saveReload.approach.objective && r.saveReload.approach.ordersForVisitor === 1 && r.saveReload.approach.broadcastKept && g(r.saveReload).dwell?.dwellKept && r.saveReload.dwell.restored && r.saveReload.dwell.clearedAfter && r.saveReload.dwell.ordersForVisitor === 1],
    ['S5.12 a replacement on the same slot is a new instance with no order or clearance; the old order closes; boundary jitter is not a new episode, a separated re-entry is', g(r.replacementIdentity).orderIssued && r.replacementIdentity.sameNpcId && r.replacementIdentity.instanceChanged && r.replacementIdentity.oldOrderClosed && r.replacementIdentity.newHasNoClearance && r.replacementIdentity.newHasNoOrder && r.replacementIdentity.ep0 === 1 && r.replacementIdentity.epJitter === 1 && r.replacementIdentity.epReturn === 2],
    ['S5.13 capture ends orders as authority_changed and bumps the epoch; retained configuration and override command nothing under the occupier; reclaim restores the checkpoint but no old order', g(r.captureReclaim).orderBefore && r.captureReclaim.outcome === 'authority_changed' && r.captureReclaim.epochBumped && r.captureReclaim.lostZone && r.captureReclaim.configKept && r.captureReclaim.overrideKept && r.captureReclaim.ordersUnderOccupier === 0 && r.captureReclaim.reclaimedActive && r.captureReclaim.oldOrderStillClosed && r.captureReclaim.activeAfterReclaim === 0],
    ['S5.14 operator UI: access click changes one dimension; waive (not verified), request withdrawal (revision), cancel; stricter access revises the same order, relaxation closes it without fault; reconfiguration closes without fault', g(r.operatorUi).clickedAccess && r.operatorUi.accessOther === 'challenge' && r.operatorUi.accessWarFlagUntouched === 'open' && r.operatorUi.rowShown && r.operatorUi.waived && r.operatorUi.waivedOutcome === 'waived' && r.operatorUi.waiverProvenance === 'waiver' && r.operatorUi.waiverNotVerified && r.operatorUi.requested && r.operatorUi.afterRequest?.kind === 'withdraw' && r.operatorUi.afterRequest.revision === 2 && r.operatorUi.cancelled && r.operatorUi.cancelledOutcome === 'canceled' && r.operatorUi.stricter && r.operatorUi.afterStricter?.kind === 'withdraw' && r.operatorUi.afterStricter.revision === 2 && r.operatorUi.afterStricter.count === 1 && r.operatorUi.relaxed && r.operatorUi.afterRelax?.outcome === 'policy_relaxed' && r.operatorUi.afterRelax.noncompliant === false && r.operatorUi.reconfigured === true && r.operatorUi.afterReconfig?.outcome === 'zone_reconfigured' && r.operatorUi.afterReconfig.noncompliant === false],
    ['S5.15 anchor destroyed: the order ends as checkpoint_unavailable without blame and the configuration is kept; a legacy save loads with no zones or orders; invalid records recover without crashing or orphan objectives', g(r.checkpointLoss).loss?.outcome === 'checkpoint_unavailable' && r.checkpointLoss.loss.zoneGone && r.checkpointLoss.loss.noFault && r.checkpointLoss.loss.configKept && r.checkpointLoss.legacy?.noZones && r.checkpointLoss.legacy.noOrders && r.checkpointLoss.legacy.zoneNull && r.checkpointLoss.invalid?.ok && r.checkpointLoss.invalid.noOrders && r.checkpointLoss.invalid.noOrphanObjective],
    ['S5.8 player at the Vulcan checkpoint: placed outside on arrival, ordered on crossing, refused docking while pending, clearance request refused off-marker, repeat keeps the timer, cleared after holding, then docks; aggression revokes clearance; foreign policy not editable', g(r.playerCompliance).arrival?.placed === true && r.playerCompliance.arrival.inside === false && r.playerCompliance.arrival.insideBefore === true && r.playerCompliance.noOrderOutside && r.playerCompliance.ordered && r.playerCompliance.kind === 'challenge' && r.playerCompliance.cls === 'independent' && r.playerCompliance.dockBlockedNear?.ok === false && /clearance/i.test(r.playerCompliance.dockBlockedNear.log) && r.playerCompliance.requestRefused && r.playerCompliance.panelShown && r.playerCompliance.repeatKeepsTimer && r.playerCompliance.acknowledged === true && r.playerCompliance.clearedP && r.playerCompliance.outcome === 'cleared' && r.playerCompliance.dockAfter === true && r.playerCompliance.clearanceRevokedByAggression && r.playerCompliance.foreignEditRejected],
    ['S5.9 player withdraw resolves only on physical exit and grants no clearance; refusal closes the order, is recorded, blocks docking, creates no hostility or standing change; a completed jump ends the visit', g(r.playerWithdrawRefuse).newOrderAfterReentry && r.playerWithdrawRefuse.withdrawingP === true && r.playerWithdrawRefuse.stillActiveBeforeMove && r.playerWithdrawRefuse.withdrawnP === 'withdrawn' && r.playerWithdrawRefuse.clearanceAfterWithdraw === null && r.playerWithdrawRefuse.refuseOrder && r.playerWithdrawRefuse.refusedOutcome === 'refused' && r.playerWithdrawRefuse.noncompliant && r.playerWithdrawRefuse.dockRefused === false && r.playerWithdrawRefuse.standingsSame && r.playerWithdrawRefuse.anyHostile === false && r.playerWithdrawRefuse.departureClears?.outcome === 'refused' && r.playerWithdrawRefuse.departureClears.noncompliantAfterJump === false && r.playerWithdrawRefuse.departureClears.inside === false && r.playerWithdrawRefuse.departureClears.now],
    ['S5.16 isolation: a hostile ship is never addressed and stays a target; a waiver changes no fleet orders or hostility', g(r.isolation).hostileNotAddressed && r.isolation.hostileStillTarget && r.isolation.fleetSame && r.isolation.waived && r.isolation.hostileFlagKept],
    ['S3i enemy defenders select and engage a player escort attacking their installation', g(r.enemyDefense).beforeAttack?.attacker === false && r.enemyDefense.escortFiredAt === 'klingon' && r.enemyDefense.escortIsAttacker && r.enemyDefense.defenderSelectsEscort && r.enemyDefense.defenderFired && r.enemyDefense.defenderFiredAt === 'player' && r.enemyDefense.escortHullDropped],
  ];
  console.log(`behavior-probe: ${ROOT}`);
  for (const [name, ok] of checks) console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${name}`);
  console.log(`  detail: ${JSON.stringify(r)}`);
  if (pageErrors.length) console.log(`  page errors: ${pageErrors.join(' | ')}`);
  if (SCREENSHOT) await page.screenshot({ path: SCREENSHOT });
  if (SHOTS_DIR) {
    fs.mkdirSync(SHOTS_DIR, { recursive: true });
    const staged = await page.evaluate(shotsRunner);
    console.log(`  shots: ${JSON.stringify(staged)}`);
    for (const name of ['operator', 'visitor-order', 'visitor-holding']) {
      await page.evaluate((stage) => window.__bm1Shots?.[stage]?.(), name);
      await page.waitForTimeout(150);
      await page.screenshot({ path: path.join(SHOTS_DIR, `phase3-${name}.png`) });
    }
  }
  exitCode = checks.every(([, ok]) => ok) && !pageErrors.length ? 0 : 1;
} finally {
  await browser.close();
  server.close();
}
process.exit(exitCode);
