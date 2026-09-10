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
const TIMEOUT_MS = Number(argValue('--timeout') || 45000);

const SHIM = `
// ---- behavior-probe export shim (injected in transit; never written to disk) ----
window.__bm1 = {
  state, startWithFaction, createNpcShip, damageCombatTarget, tick, render,
  fireNpcWeapon, ensureStationCombatStats, ensureNpcCombatStats, getFactionStanding,
  playerWorldPosition, getNpcWeaponRange, getDefaultWeaponId, getWeapon,
  applySystemState, getSystemIndexByName,
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
  const B = window.__bm1;
  const s = B.state;
  const out = { setup: [] };
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

  // ---------- S1d: player-escort projectile kill ----------
  clearNpcs(); clearShots();
  const target = spawn(9004, 320);
  s.originalShipWeaponSlots = s.originalShipWeaponSlots || {};
  const savedSlots2 = s.originalShipWeaponSlots[2];
  s.originalShipWeaponSlots[2] = [15]; // Photon Torpedo: a tracking projectile, so credit must ride the shot
  const escort = spawn(9005, 40, { shipId: 2, faction: s.playerFaction, attitude: 'friendly', hostile: false, role: 'playerEscort', fleetId: 'probe-escort' });
  const escortWeapon = B.getWeapon(B.getDefaultWeaponId(escort.shipId, escort.faction, true));
  need(escortWeapon.type === 'Torpedo', `S1d fixture: escort weapon is ${escortWeapon.name} (${escortWeapon.type}), expected a Torpedo`);
  escort.lastShotAt = READY;
  const savedStations = s.stations;
  s.stations = []; // station defenses fire with source 'station' and would steal the last hit
  target.combatShields = 0;
  target.combatHull = 1;
  latinum = s.latinum; kl = standing('klingon');
  B.fireNpcWeapon(escort, target, 'ship', performance.now());
  const shot = (s.projectiles || []).find((p) => p.targetId === target.id);
  need(shot, 'S1d fixture: escort produced no projectile aimed at the target');
  escort.lastShotAt = performance.now() + 1e9; // one shot only; the escort AI must not fire again during flight
  for (let i = 0; i < 400 && !target.destroyed; i++) { B.tick(1); await sleep(16); }
  s.stations = savedStations;
  s.originalShipWeaponSlots[2] = savedSlots2;
  out.escortProjectileKill = {
    shotOwner: shot?.owner, shotCredit: shot?.creditSource, lastDamageSource: target.lastDamageSource,
    destroyed: !!target.destroyed, latinumDelta: s.latinum - latinum, standingDelta: standing('klingon') - kl,
  };

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

  // ---------- S2: pursuit vs. firing range ----------
  clearNpcs(); clearShots();
  s.factionStanding = s.factionStanding || {};
  s.factionStanding.klingon = -60;
  const savedSlots1 = s.originalShipWeaponSlots[1];
  s.originalShipWeaponSlots[1] = [1]; // Type X Phaser: a beam, so impact is instant and stop-on-fire is valid
  const hunter = spawn(9003, 4000);
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
      B.tick(1);
      maxDrop = Math.max(maxDrop, pool0 - (s.shields + s.hull));
      if (stopWhenFired && hunter.lastShotAt > READY) break;
      await sleep(30);
    }
    return { fired: hunter.lastShotAt > READY, playerHitAfter: (s.lastShieldHitAt || 0) > hitBefore, maxDrop, pursuing: hunter.destinationName === 'player', alive: !hunter.destroyed, elapsedMs: Math.round(performance.now() - t0) };
  };
  const farDistance = Math.max(4000, Math.round(weaponRange * 4));
  out.far = { weaponRange, distance: farDistance, ...(await runPhase(farDistance, 4000)) };
  const nearDistance = Math.round(weaponRange * 0.5);
  out.near = { distance: nearDistance, ...(await runPhase(nearDistance, 4000, true)) };
  s.stations = stationsAside;
  s.originalShipWeaponSlots[1] = savedSlots1;
  B.render();
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
  ];
  console.log(`behavior-probe: ${ROOT}`);
  for (const [name, ok] of checks) console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${name}`);
  console.log(`  detail: ${JSON.stringify(r)}`);
  if (pageErrors.length) console.log(`  page errors: ${pageErrors.join(' | ')}`);
  if (SCREENSHOT) await page.screenshot({ path: SCREENSHOT });
  exitCode = checks.every(([, ok]) => ok) && !pageErrors.length ? 0 : 1;
} finally {
  await browser.close();
  server.close();
}
process.exit(exitCode);