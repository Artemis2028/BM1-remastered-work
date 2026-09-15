// Run with Playwright installed. Starts its own static server; BM1_TEST_ROOT can select dist.
// Test-only exports are appended in the browser response, never to game source.
const { chromium } = require('playwright');
const assert = require('node:assert/strict');
const http = require('node:http'),
  fs = require('node:fs'),
  path = require('node:path');
const root = path.resolve(process.env.BM1_TEST_ROOT || path.join(__dirname, '..'));
const server = http.createServer((req, res) => {
  const rel = decodeURIComponent(req.url.split('?')[0]).replace(/^\/+/, '') || 'index.html';
  const file = path.resolve(root, rel);
  if (
    !file.startsWith(root + path.sep) ||
    !fs.existsSync(file) ||
    fs.statSync(file).isDirectory()
  ) {
    res.writeHead(404);
    res.end();
    return;
  }
  res.setHeader(
    'Content-Type',
    {
      '.js': 'text/javascript',
      '.mjs': 'text/javascript',
      '.css': 'text/css',
      '.html': 'text/html',
      '.json': 'application/json',
      '.png': 'image/png',
      '.svg': 'image/svg+xml',
    }[path.extname(file)] || 'application/octet-stream',
  );
  fs.createReadStream(file).pipe(res);
});
(async () => {
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const browser = await chromium.launch({
    headless: true,
    executablePath: process.env.BM1_CHROMIUM_PATH,
    args: [
      '--single-process',
      '--no-zygote',
      '--no-sandbox',
      '--disable-dev-shm-usage',
      '--use-gl=angle',
      '--use-angle=swiftshader',
      '--enable-unsafe-swiftshader',
    ],
  });
  const page = await browser.newPage({
    viewport: { width: 1280, height: 800 },
    serviceWorkers: 'block',
  });
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.route('**/src/main.js*', async (route) => {
    const r = await route.fetch();
    await route.fulfill({
      response: r,
      body:
        (await r.text()) +
        `\nfunction baselineStationDefenseProfile(station = {}) {
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
window.testBM1={baselineStationDefenseProfile,Fleet,state,startWithFaction,applyDebugCommand,getFactionStanding,saveGame,loadGame,keys,heldWeaponInputs,updateStats,fleetBook,applyVesselDisablement,gameNow,tick,pauseGameClock,resumeGameClock,getSystemControl,getStationOwner,getSecurityZone,getSecurityDockingBlock,placePlayerAtSecurityApproach,playerWorldPosition,adjustFactionStanding,setSecurityPolicyOverride,clearSecurityPolicyOverride,getDelegatedPolicy,canDelegateSecurity,renderSecurityPanelMarkup,getEffectiveSecurityPolicy,isNpcSystemAttacker,recordPlayerAggressionAgainst,createNpcShip,getSystemActivity,updateSystemActivity,ensurePlaytestState,isChartSystemVisible,getPlottedRoute,markSystemVisited,getOpenContracts,getCatalogPurchaseDecision,getCurrentDockedStation,getStationVisualProfile,resolveSecurityPoint,ensureActorSensors,ensureSystemState,getOpenContracts,normalizeContract,renderOpenContractsPanel,getRecoveryStatus,recoverDisabledPlayer,getNpcCombatDurability,updateRecoveryPanel,getCurrentPurchaseVendor,getShipSaleStatus,getUnfilteredShipyardStock,isDefensePlatform,getStationDefenseProfile,destroyStation,advanceFleetCalendar,advanceFactionReconstruction,syncFactionReconstruction,getStationCombatDurability,getShipStats,ensureCombatTargetStats,applySystemState,getSystemFaction,areFactionsOpposed,areFactionsAligned,changeDiplomacy,diplomacyBook,advanceWorldDiplomacy,activityTrafficShip,getShipFaction,getMapFactionTerritoryClusters,measureIntroCrawl,showIntroStory,skipIntroStory,openGameMenu,returnToMainMenu,factionDefs,reviewLegacyHolding,renderFleetManager,updateSecurityEncounters,getPlayerSecurityOrder,respondToSecurityOrder,setCamera,openStationComms,fireStationWeapon,withStationOrbit,updateSystemOrbits,updateSensorSystems,updatePowerSystems,sensorCanTrack,getWeapon,WEAPON_CATALOG,openTopLeftTab,restoreWorldEncounter,captureWorldEncounter};`,
    });
  });
  await page.goto(`http://127.0.0.1:${server.address().port}`);
  await page.waitForFunction(
    () => window.testBM1 && testBM1.state.shipCatalog && testBM1.state.planets.length > 10,
  );
  const data = await page.evaluate(() => {
    const t = testBM1;
    t.startWithFaction('terran');
    const base = t.state.stations[0];
    const records = [];
    for (const variant of ['baseline', 'candidate']) {
      const profile = (
        variant === 'baseline' ? t.baselineStationDefenseProfile : t.getStationDefenseProfile
      )({ stationTypeId: 86 });
      const station = {
        ...base,
        id: 'measure-platform',
        stationTypeId: 86,
        ownerId: 'terran',
        faction: 'terran',
        stationWeaponIds: profile.weaponIds,
        defenseDamage: profile.damage,
        defenseCooldown: profile.cooldown,
        defenseRange: profile.range,
        lastShotAt: 0,
      };
      const target = t.createNpcShip({
        id: 'measure-enemy',
        shipId: 18,
        faction: 'klingon',
        role: 'patrol',
        seed: 18,
        from: { x: station.x + 250, y: station.y },
      });
      t.ensureCombatTargetStats(target);
      target.combatHull = target.maxCombatHull = 100000;
      target.combatShields = 0;
      target.maxCombatShields = 0;
      t.state.stations = [station];
      t.state.npcShips = [target];
      for (let i = 0; i < 30; i++) {
        t.updatePowerSystems(12);
        t.updateSensorSystems(12);
      }
      const tracked = t.sensorCanTrack(station, target);
      const before = target.combatHull;
      for (let time = 100000; time < 110000; time += 10) t.fireStationWeapon(station, target, time);
      records.push({ variant, tracked, profile, damage: before - target.combatHull });
    }
    const profiles = Object.values(t.state.shipStatsById)
      .filter((s) => s.assetType === 'station')
      .map((s) => ({
        id: s.id,
        name: s.name,
        old: t.baselineStationDefenseProfile({ stationTypeId: s.id }),
        new: t.getStationDefenseProfile({ stationTypeId: s.id }),
      }));
    return {
      combat: records,
      changedProfiles: profiles.filter((p) => JSON.stringify(p.old) !== JSON.stringify(p.new)),
      unchangedProfiles: profiles.filter((p) => JSON.stringify(p.old) === JSON.stringify(p.new))
        .length,
    };
  });
  console.log(JSON.stringify(data, null, 2));
  assert.ok(data.combat.every((r) => r.tracked));
  assert.equal(data.combat[0].damage, 1012);
  assert.equal(data.combat[1].damage, 1144);
  assert.deepEqual(
    data.changedProfiles.map((p) => p.id),
    [86, 87],
  );
  await browser.close();
  server.close();
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
