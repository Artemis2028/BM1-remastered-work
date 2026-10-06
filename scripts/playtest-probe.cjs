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
        `\nwindow.testBM1={createRuntimeStationFromDefinition,createLightweightRuntimeStation,getStationDefinitionWorldPoint,isNpcStationTarget,Fleet,state,startWithFaction,applyDebugCommand,getFactionStanding,saveGame,loadGame,keys,heldWeaponInputs,updateStats,fleetBook,applyVesselDisablement,gameNow,tick,pauseGameClock,resumeGameClock,getSystemControl,getStationOwner,getSecurityZone,getSecurityDockingBlock,placePlayerAtSecurityApproach,playerWorldPosition,adjustFactionStanding,setSecurityPolicyOverride,clearSecurityPolicyOverride,getDelegatedPolicy,canDelegateSecurity,renderSecurityPanelMarkup,getEffectiveSecurityPolicy,isNpcSystemAttacker,recordPlayerAggressionAgainst,createNpcShip,getSystemActivity,updateSystemActivity,ensurePlaytestState,isChartSystemVisible,getPlottedRoute,markSystemVisited,getOpenContracts,getCatalogPurchaseDecision,getCurrentDockedStation,getStationVisualProfile,resolveSecurityPoint,ensureActorSensors,ensureSystemState,getOpenContracts,normalizeContract,renderOpenContractsPanel,getRecoveryStatus,recoverDisabledPlayer,getNpcCombatDurability,updateRecoveryPanel,getCurrentPurchaseVendor,getShipSaleStatus,getUnfilteredShipyardStock,isDefensePlatform,getStationDefenseProfile,destroyStation,advanceFleetCalendar,advanceFactionReconstruction,syncFactionReconstruction,getStationCombatDurability,getShipStats,ensureCombatTargetStats,applySystemState,getSystemFaction,areFactionsOpposed,areFactionsAligned,changeDiplomacy,diplomacyBook,advanceWorldDiplomacy,activityTrafficShip,getShipFaction,getMapFactionTerritoryClusters,measureIntroCrawl,showIntroStory,skipIntroStory,openGameMenu,returnToMainMenu,factionDefs,reviewLegacyHolding,renderFleetManager,updateSecurityEncounters,getPlayerSecurityOrder,respondToSecurityOrder,setCamera,openStationComms,fireStationWeapon,withStationOrbit,spawnFleetAttack,updateSystemOrbits,openTopLeftTab,restoreWorldEncounter,captureWorldEncounter};`,
    });
  });
  await page.goto(`http://127.0.0.1:${server.address().port}`);
  await page.waitForFunction(
    () => window.testBM1 && testBM1.state.shipCatalog && testBM1.state.planets.length > 10 && testBM1.state.flaHints?.symbols?.length > 0,
  );
  const checks = [];
  async function check(name, fn) {
    await fn();
    checks.push(name);
    console.log('PASS', name);
  }
  const evaluate = (fn) => page.evaluate(fn);
  await check('all starts retain faction ownership and have separated arrivals', async () => {
    const result = await evaluate(() => {
      const t = testBM1;
      return Object.keys(t.factionDefs).map((key) => {
        t.startWithFaction(key);
        const p = t.playerWorldPosition();
        return {
          key,
          log: t.state.log,
          holdings: t.state.controlledSystems.length,
          owned: t.state.stations.filter((s) => t.getStationOwner(s) === 'player').length,
          distance: Math.hypot(p.x - t.state.systemPlanet.x, p.y - t.state.systemPlanet.y),
        };
      });
    });
    for (const r of result) {
      assert.match(r.log, /aboard.*selected\./, r.key);
      assert.doesNotMatch(r.log, /FLA action hint|_root|Symbol \d+|playership ==/, r.key);
      assert.equal(r.holdings, 0, r.key);
      assert.equal(r.owned, 0, r.key);
      assert.ok(r.distance > 350, JSON.stringify(r));
    }
  });
  await evaluate(() => testBM1.startWithFaction('terran'));
  await check(
    'authority requires ownership or governing membership at 100; no weapon command',
    async () => {
      const r = await evaluate(() => {
        const t = testBM1,
          i = t.state.currentPlanet;
        const low = t.setSecurityPolicyOverride(i, { access: { other: 'closed' } });
        t.adjustFactionStanding('terran', 100);
        const high = t.setSecurityPolicyOverride(i, { access: { other: 'closed' } });
        const roe = t.setSecurityPolicyOverride(i, { roe: 'return-fire' });
        const count = t.state.controlledSystems.length;
        t.saveGame(2);
        t.loadGame(2);
        const after = t.getDelegatedPolicy(i);
        t.adjustFactionStanding('terran', -1);
        const revoked = t.getDelegatedPolicy(i);
        t.adjustFactionStanding('terran', 1);
        const staysRevoked = t.getDelegatedPolicy(i);
        return { low, high, roe, count, after, revoked, staysRevoked };
      });
      assert.equal(r.low, null);
      assert.ok(r.high);
      assert.equal(r.roe, null);
      assert.equal(r.count, 0);
      assert.ok(r.after);
      assert.equal(r.revoked, null);
      assert.equal(r.staysRevoked, null);
    },
  );
  await check('retaliating independent is not an aggressor against Terran stations', async () => {
    const r = await evaluate(() => {
      const t = testBM1;
      const n = t.createNpcShip({
        id: 'neutral-victim',
        shipId: 6,
        faction: 'neutral',
        role: 'traffic',
        seed: 21,
        from: { x: 0, y: 0 },
      });
      t.recordPlayerAggressionAgainst(n);
      n.lastAggressionAt = t.gameNow();
      n.lastAggressionSystemIndex = t.state.currentPlanet;
      n.lastAggressionTargetSide = 'player';
      n.hostile = true;
      n.attitude = 'hostile';
      const stations = t.state.stations.filter(s => t.getStationOwner(s) === 'terran');
      return { attacker: t.isNpcSystemAttacker(n, 'terran'), count: stations.length, targets: stations.some(s => t.isNpcStationTarget(n, s)) };
    });
    assert.equal(r.attacker, false);
    assert.ok(r.count > 0);
    assert.equal(r.targets, false);
  });
  await check(
    'war / peace changes both directions and persists; friendship never overrides war',
    async () => {
      const r = await evaluate(() => {
        const t = testBM1;
        t.changeDiplomacy('romulan', 'klingon', 'war');
        const war = [
          t.areFactionsOpposed('romulan', 'klingon'),
          t.areFactionsOpposed('klingon', 'romulan'),
          t.areFactionsAligned('romulan', 'klingon'),
        ];
        t.changeDiplomacy('romulan', 'klingon', 'peace');
        t.saveGame(2);
        t.loadGame(2);
        return {
          war,
          peace: t.areFactionsOpposed('romulan', 'klingon'),
          history: t.diplomacyBook().history,
        };
      });
      assert.deepEqual(r.war, [true, true, false]);
      assert.equal(r.peace, false);
      assert.equal(r.history.at(-1).status, 'peace');
    },
  );
  await check(
    'quiet/patrol traffic has no enemy civilian influx, including Romulan foreign traffic limits',
    async () => {
      const r = await evaluate(() => {
        const t = testBM1;
        t.changeDiplomacy('terran', 'romulan', 'peace');
        const counts = {};
        for (let i = 0; i < 3000; i++) {
          const id = t.activityTrafficShip(t.state.currentPlanet, i * 31, 'traffic');
          const f = t.getShipFaction(id);
          counts[f] = (counts[f] || 0) + 1;
        }
        return counts;
      });
      assert.ok((r.romulan || 0) < (r.ferengi || 0) / 10, JSON.stringify(r));
      assert.equal(r.borg || 0, 0);
      assert.equal(r.klingon || 0, 0);
      console.log('  3000 civilian draws:', JSON.stringify(r));
    },
  );
  await check('activity cadence is saved and quiet activity never starts a raid', async () => {
    const r = await evaluate(() => {
      const t = testBM1,
        a = t.getSystemActivity();
      a.type = 'quiet';
      a.triggered = false;
      for (let i = 0; i < 200; i++) t.updateSystemActivity(60);
      const quiet = t.state.activeFleetAttack;
      t.getSystemActivity().type = 'raid';
      t.getSystemActivity().combatElapsed = 43210;
      t.saveGame(2);
      t.loadGame(2);
      return {
        quiet,
        elapsed: t.getSystemActivity().combatElapsed,
        type: t.getSystemActivity().type,
      };
    });
    assert.equal(r.quiet, null);
    assert.equal(r.type, 'raid');
    assert.equal(r.elapsed, 43210);
  });
  await check(
    'Dominica hidden in chart, route graph and shading; visit unlocks region',
    async () => {
      const r = await evaluate(() => {
        const t = testBM1;
        const i = t.state.planets.findIndex((p) => p.name.toLowerCase() === 'dominica');
        const hidden = !t.isChartSystemVisible(i),
          route = t.getPlottedRoute(t.state.currentPlanet, i),
          clusters = t.getMapFactionTerritoryClusters().some((c) => c.systems.includes(i));
        t.markSystemVisited(i);
        const unlocked = t.isChartSystemVisible(i);
        t.saveGame(2);
        t.loadGame(2);
        return { hidden, route, clusters, unlocked, reload: t.isChartSystemVisible(i) };
      });
      assert.deepEqual(r, {
        hidden: true,
        route: null,
        clusters: false,
        unlocked: true,
        reload: true,
      });
    },
  );
  await check('cargo markers are individual and preserve visibility across reload', async () => {
    await evaluate(() => {
      const t = testBM1;
      t.state.openContracts = [
        t.normalizeContract({ id: 'one', goods: 'Food', targetIndex: 4, tons: 2, payPerTon: 20 }),
        t.normalizeContract({ id: 'two', goods: 'Food', targetIndex: 4, tons: 2, payPerTon: 20 }),
      ];
      t.openTopLeftTab('inventory');
    });
    await page.locator('[data-contract-marker="one"]').click();
    const r = await evaluate(() => {
      const t = testBM1;
      t.saveGame(2);
      t.loadGame(2);
      return t.getOpenContracts().map((c) => [c.id, c.showMarker]);
    });
    assert.deepEqual(r, [
      ['one', false],
      ['two', true],
    ]);
    await evaluate(() => {
      testBM1.state.topLeftPanelOpen = false;
      testBM1.updateStats();
    });
  });
  await check(
    'disabled recovery is visible, costs debt and cannot double bill; reload resumes countdown',
    async () => {
      await evaluate(() => {
        const t = testBM1;
        t.state.latinum = 0;
        t.applyDebugCommand('hull 5');
        t.updateRecoveryPanel();
      });
      assert.equal(await page.locator('#disabled-recovery').isVisible(), true);
      await page.screenshot({
        path: path.join(process.env.BM1_TEST_OUTPUT || '/tmp', 'recovery-desktop.png'),
      });
      const r = await evaluate(() => {
        const t = testBM1,
          b = t.fleetBook();
        const before = b.debt,
          cost = t.getRecoveryStatus().amount,
          first = t.recoverDisabledPlayer(),
          second = t.recoverDisabledPlayer(),
          after = b.debt;
        t.saveGame(2);
        t.loadGame(2);
        return {
          first,
          second,
          cost,
          debt: after - before,
          pending: !!t.state.recoveryAt,
          hull: t.state.hull,
        };
      });
      assert.equal(r.first, true);
      assert.equal(r.second, false);
      assert.equal(r.debt, r.cost);
      assert.equal(r.pending, true);
      assert.ok(r.hull < 100);
      // Bounded polling instead of a fixed sleep against the 5,000 ms deadline: the recovery lands
      // whenever a frame runs after the deadline, so wait for the condition itself (up to 12 s).
      await page.waitForFunction(() => testBM1.fleetBook().personalCondition === 'operational', null, { timeout: 12000, polling: 100 });
      assert.equal(await evaluate(() => testBM1.fleetBook().personalCondition), 'operational');
    },
  );
  await check('visible menu freezes clock and ship; failed save-exit keeps run alive', async () => {
    await page.locator('#btn-game-menu').click();
    await page.screenshot({
      path: path.join(process.env.BM1_TEST_OUTPUT || '/tmp', 'game-menu-desktop.png'),
    });
    const before = await evaluate(() => [
      testBM1.gameNow(),
      testBM1.state.ship.x,
      testBM1.state.ship.y,
    ]);
    await page.waitForTimeout(300);
    assert.deepEqual(
      await evaluate(() => [testBM1.gameNow(), testBM1.state.ship.x, testBM1.state.ship.y]),
      before,
    );
    await evaluate(() => {
      window.savedSetItem = Storage.prototype.setItem;
      Storage.prototype.setItem = () => {
        throw new Error('quota');
      };
    });
    await page.locator('[data-game-menu="save-exit"]').click();
    assert.equal(await evaluate(() => testBM1.state.gameStarted), true);
    assert.match(await page.locator('[data-menu-status]').textContent(), /failed/i);
    await evaluate(() => (Storage.prototype.setItem = window.savedSetItem));
    await page.locator('[data-game-menu="resume"]').click();
  });
  await check(
    'Escape pauses warp; save-exit stops simulation and load resumes remaining travel',
    async () => {
      await evaluate(() => {
        const t = testBM1;
        t.state.currentSaveSlot = 2;
        t.state.warp = {
          active: true,
          from: t.state.currentPlanet,
          to: t.state.currentPlanet + 1,
          startedAt: t.gameNow() - 1000,
          duration: 20000,
          travelDays: 2,
          journeyId: t.Fleet.nextId(t.fleetBook(), 'journey'),
        };
      });
      await page.keyboard.press('Escape');
      assert.equal(await page.locator('#game-menu').evaluate((el) => el.open), true);
      const elapsed = await evaluate(() => testBM1.gameNow() - testBM1.state.warp.startedAt);
      await page.waitForTimeout(250);
      assert.equal(await evaluate(() => testBM1.gameNow() - testBM1.state.warp.startedAt), elapsed);
      await page.locator('[data-game-menu="save-exit"]').click();
      assert.equal(await evaluate(() => testBM1.state.gameStarted), false);
      await evaluate(() => testBM1.loadGame(2));
      const resumed = await evaluate(() => ({
        active: testBM1.state.warp.active,
        elapsed: testBM1.gameNow() - testBM1.state.warp.startedAt,
      }));
      assert.equal(resumed.active, true);
      assert.ok(Math.abs(resumed.elapsed - elapsed) < 250);
      await evaluate(() => {
        testBM1.state.warp.active = false;
      });
    },
  );
  await check('station hails open transporter trade without docking', async () => {
    await evaluate(() => { testBM1.startWithFaction('terran'); testBM1.openStationComms(); });
    assert.equal(await page.locator('#station-comms').evaluate((el) => el.open), true);
    assert.ok((await page.locator('[data-station-hail]').count()) > 0);
    const yardId = await evaluate(() => testBM1.state.stations.find(s => /shipyard|starbase/i.test(testBM1.getShipStats(s.stationTypeId).name)).id);
    await page.locator(`[data-station-hail="${yardId}"]`).click();
    assert.match(await page.locator('#planet-menu').textContent(), /Transporter trade channel/);
    assert.equal(await page.locator('[data-planet-action="repair"]:enabled').count(), 0);
    assert.equal(await evaluate(() => testBM1.state.docked), false);
    await page.locator('#planet-menu [data-planet-action="close"]').click();
  });
  await check(
    'faction rebuild pays once, produces a new installation offscreen and survives reload',
    async () => {
      const r = await evaluate(() => {
        const t = testBM1;
        t.startWithFaction('terran');
        const old = t.state.stations.find((s) => t.getStationOwner(s) === 'terran');
        t.ensureCombatTargetStats(old);
        t.destroyStation(old);
        const order = Object.values(t.ensurePlaytestState().reconstruction)[0];
        t.advanceFleetCalendar(1, t.Fleet.nextId(t.fleetBook(), 'journey'));
        const afterStart = JSON.parse(JSON.stringify(order));
        t.state.currentPlanet = 1; t.state.myplanet = 2; t.applySystemState(1);
        t.advanceFleetCalendar(7, t.Fleet.nextId(t.fleetBook(), 'journey'));
        const final = t.ensurePlaytestState().reconstruction[order.id];
        t.saveGame(2);
        t.loadGame(2);
        return {
          old: old.id,
          start: afterStart.status,
          final: final.status,
          newId: final.newDefinition?.id,
          oldDestroyed: t.state.destroyedStations[old.id],
          live: t.ensureSystemState(0).stations.filter(
            (s) => s.id === final.newDefinition?.id && !s.destroyed && !s.underConstruction,
          ).length,
        };
      });
      assert.equal(r.start, 'building', JSON.stringify(r));
      assert.equal(r.final, 'complete');
      assert.notEqual(r.old, r.newId);
      assert.equal(r.oldDestroyed, true);
      assert.equal(r.live, 1);
    },
  );
  await check(
    'Vulcan clearance gates remote hails, completes real hold, survives reload',
    async () => {
      const r = await evaluate(() => {
        const t = testBM1;
        t.startWithFaction('terran');
        const i = t.state.planets.findIndex((p) => p.name === 'Vulcan');
        t.state.currentPlanet = i;
        t.state.myplanet = i + 1;
        t.applySystemState(i);
        t.placePlayerAtSecurityApproach();
        const before = t.getSecurityDockingBlock();
        const zone = t.getSecurityZone();
        t.setCamera(zone.centre.x + zone.radius - 10, zone.centre.y);
        t.updateSecurityEncounters(1);
        const order = t.getPlayerSecurityOrder();
        if (!order) return { before, missingOrder: true, broadcast: t.ensureActorSensors(t.state) };
        const hold = t.resolveSecurityPoint(zone, order.hold);
        t.setCamera(hold.x, hold.y);
        t.state.ship.velocity = 0;
        for (let j = 0; j < 80; j++) t.updateSecurityEncounters(2.5);
        t.saveGame(2);
        t.loadGame(2);
        const resumed = t.getPlayerSecurityOrder();
        for (let j = 0; j < 80; j++) t.updateSecurityEncounters(2.5);
        t.respondToSecurityOrder('request');
        return {
          before,
          after: t.getSecurityDockingBlock(),
          resumed: !!resumed,
          orderKind: order.kind,
        };
      });
      assert.ok(r.before, JSON.stringify(r));
      assert.equal(r.missingOrder, undefined, JSON.stringify(r));
      assert.ok(r.resumed);
      assert.equal(r.after, null, JSON.stringify(r));
    },
  );
  await check(
    'Earth stock is Terran/independent and neutral designs use vendor standing',
    async () => {
      const r = await evaluate(() => {
        const t = testBM1;
        t.startWithFaction('terran');
        t.state.docked = true;
        t.state.latinum = 10000000;
        const stock = t.getUnfilteredShipyardStock();
        const foreign = stock.filter((s) => !['terran', 'neutral'].includes(s.faction));
        const independent = stock.find((s) => s.faction === 'neutral');
        if (!independent) return { foreign, missing: true };
        t.adjustFactionStanding('neutral', 100);
        t.adjustFactionStanding('terran', -100);
        const denied = t.getCatalogPurchaseDecision(independent.id);
        t.adjustFactionStanding('terran', 200);
        const accepted = t.getCatalogPurchaseDecision(independent.id);
        return { foreign, denied, accepted, origin: independent.faction };
      });
      assert.deepEqual(r.foreign, []);
      assert.equal(r.missing, undefined);
      assert.equal(r.denied.requiredFaction, 'terran');
      assert.equal(r.denied.allowed, false);
      assert.equal(r.accepted.allowed, true);
      assert.equal(r.origin, 'neutral');
    },
  );
  await check('construction loss and ownership change cannot resurrect a station', async () => {
    const r = await evaluate(() => {
      const t = testBM1;
      t.startWithFaction('terran');
      const st = t.state.stations.find((s) => t.getStationOwner(s) === 'terran');
      t.destroyStation(st);
      t.advanceFleetCalendar(1, t.Fleet.nextId(t.fleetBook(), 'journey'));
      const order = Object.values(t.ensurePlaytestState().reconstruction)[0];
      const replacement = t.state.stations.find((s) => s.id === order.newDefinition.id);
      t.destroyStation(replacement);
      t.advanceFleetCalendar(10, t.Fleet.nextId(t.fleetBook(), 'journey'));
      const lost = order.status,
        dead = t.state.destroyedStations[replacement.id];
      t.startWithFaction('terran');
      const second = t.state.stations.find((s) => t.getStationOwner(s) === 'terran');
      t.destroyStation(second);
      const secondOrder = Object.values(t.ensurePlaytestState().reconstruction)[0];
      t.state.factionSystemOverrides[t.state.currentPlanet] = 'klingon';
      t.advanceFleetCalendar(10, t.Fleet.nextId(t.fleetBook(), 'journey'));
      return { lost, dead, cancelled: secondOrder.status, spawned: !!secondOrder.newDefinition };
    });
    assert.deepEqual(r, { lost: 'lost', dead: true, cancelled: 'cancelled', spawned: false });
  });
  await check(
    'saved active raid retains incarnation and damage; peace terminates raid',
    async () => {
      const r = await evaluate(() => {
        const t = testBM1;
        t.startWithFaction('terran');
        const a = t.getSystemActivity();
        a.type = 'raid';
        a.combatElapsed = 180000;
        a.triggered = false;
        t.spawnFleetAttack(t.state.currentPlanet, 'klingon');
        a.triggered = true;
        const raid = t.state.activeFleetAttack;
        if (!raid) return { missing: true };
        const actor = t.state.npcShips.find((n) => n.attackId === raid.id);
        t.ensureCombatTargetStats(actor);
        actor.combatHull *= 0.5;
        const hull = actor.combatHull,
          id = actor.id;
        t.saveGame(2);
        t.loadGame(2);
        const restored = t.state.npcShips.find((n) => n.id === id);
        const result = {
          sameId: t.state.activeFleetAttack?.id === raid.id,
          hull: restored?.combatHull,
          expected: hull,
        };
        t.changeDiplomacy(raid.faction, 'terran', 'peace');
        result.stopped = t.state.activeFleetAttack === null;
        return result;
      });
      assert.equal(r.missing, undefined);
      assert.equal(r.sameId, true);
      assert.equal(r.hull, r.expected);
      assert.equal(r.stopped, true);
    },
  );
  await check('station rings remain moving and maintain silhouette separation', async () => {
    const r = await evaluate(() => {
      const t = testBM1;
      t.startWithFaction('terran');
      const live = t.state.stations.filter((s) => !s.destroyed);
      let minimum = Infinity;
      for (let a = 0; a < live.length; a++)
        for (let b = a + 1; b < live.length; b++) {
          const av = t.getStationVisualProfile(live[a]),
            bv = t.getStationVisualProfile(live[b]);
          minimum = Math.min(
            minimum,
            Math.abs(live[a].orbitDistance - live[b].orbitDistance) -
              (Math.max(av.width, av.height) + Math.max(bv.width, bv.height)) * 0.5,
          );
        }
      const before = { x: live[0].x, y: live[0].y };
      t.updateSystemOrbits(t.gameNow() + 10000);
      return { minimum, moved: Math.hypot(live[0].x - before.x, live[0].y - before.y) > 0 };
    });
    assert.ok(r.minimum >= 90, JSON.stringify(r));
    assert.equal(r.moved, true);
  });
  await check('authored remote and explicit orbits survive all station creation paths', async () => {
    const r = await evaluate(() => {
      const t = testBM1, s = t.state;
      const remote = s.stationDefinitions.filter(d => Math.hypot(d.offsetX, d.offsetY) > 5000);
      const rows = remote.map(d => {
        s.currentPlanet = d.systemIndex;
        t.applySystemState(d.systemIndex);
        const index = s.stationDefinitions.filter(x => x.systemIndex === d.systemIndex).findIndex(x => x.id === d.id);
        const expectedAt = planet => {
          const point = t.getStationDefinitionWorldPoint(d, s.systemStar, planet, 0);
          return t.withStationOrbit({ ...d, ...point }, s.systemStar, planet, d.systemIndex + 1, index);
        };
        // Scene generation uses the authored epoch; incremental constructors use the live planet.
        const expected = [expectedAt(s.systemStates[d.systemIndex].planet), expectedAt(s.systemPlanet), expectedAt(s.systemPlanet)];
        const variants = [s.stations.find(x => x.id === d.id),
          t.createRuntimeStationFromDefinition(d, d.systemIndex, index, 0),
          t.createLightweightRuntimeStation(d, d.systemIndex, index, 0)];
        return { id: d.id, name: d.name, authoredDistance: Math.hypot(d.offsetX, d.offsetY),
          preserved: variants.every((x, i) => x.orbitAnchor === expected[i].orbitAnchor && Math.abs(x.orbitDistance - expected[i].orbitDistance) < 1e-6) };
      });
      const explicit = { ...remote[0], systemIndex: s.currentPlanet, orbitAnchor: 'planet', orbitDistance: 2345, orbitAngle: 0.7, orbitPeriod: 80000, orbitDirection: -1 };
      const explicitKept = [false, true].every(builtByPlayer => [t.createRuntimeStationFromDefinition, t.createLightweightRuntimeStation].every(create => {
        const st = create({ ...explicit, builtByPlayer }, s.currentPlanet, 0, 0);
        return st.orbitAnchor === explicit.orbitAnchor && st.orbitDistance === explicit.orbitDistance && Math.abs(st.orbitAngle - explicit.orbitAngle) < 1e-6 && st.orbitPeriod === explicit.orbitPeriod && st.orbitDirection === explicit.orbitDirection;
      }));
      return { rows, explicitKept };
    });
    console.log('  remote orbit preservation:', JSON.stringify(r));
    assert.ok(r.rows.length >= 3);
    assert.ok(r.rows.every(x => x.preserved), JSON.stringify(r));
    assert.equal(r.explicitKept, true);
  });
  await check(
    'legacy start grant can be released without stripping other holdings or ships',
    async () => {
      const r = await evaluate(() => {
        const t = testBM1;
        t.startWithFaction('terran');
        const i = t.state.currentPlanet;
        t.state.controlledSystems = [i, i + 1];
        for (const st of t.state.stations)
          if (t.getStationOwner(st) === 'terran') t.state.stationOwners[st.id] = 'player';
        const saved = {
          shipId: 18,
          id: 'keep-fleet',
          name: 'Keep',
          systemIndex: i,
          assignment: 'system',
        };
        t.state.playerFleet.push(saved);
        t.ensurePlaytestState().legacyHolding = i;
        t.reviewLegacyHolding(false);
        return {
          holdings: t.state.controlledSystems,
          expected: i + 1,
          fleet: t.state.playerFleet.some((s) => s.id === 'keep-fleet'),
          stillOwned: t.state.stations.some((s) => t.getStationOwner(s) === 'player'),
        };
      });
      assert.deepEqual(r.holdings, [r.expected]);
      assert.equal(r.fleet, true);
      assert.equal(r.stillOwned, false);
    },
  );

  await check('full opening crawl clears final line at mobile and desktop sizes', async () => {
    await evaluate(() => testBM1.returnToMainMenu());
    for (const viewport of [
      { width: 390, height: 844 },
      { width: 1280, height: 720 },
    ]) {
      await page.setViewportSize(viewport);
      await evaluate(() => testBM1.showIntroStory());
      await page.waitForTimeout(100);
      const r = await evaluate(() => {
        testBM1.measureIntroCrawl();
        const el = document.getElementById('intro-story-text'),
          root = document.getElementById('intro-story');
        return {
          height: el.scrollHeight,
          end: parseFloat(root.style.getPropertyValue('--crawl-end')),
          duration: parseFloat(root.style.getPropertyValue('--crawl-duration')),
        };
      });
      assert.ok(-r.end >= r.height);
      assert.ok(r.duration >= 48);
      await evaluate(() => testBM1.skipIntroStory());
    }
  });
  await check('mobile game/debug menus fit and diplomacy form changes relation', async () => {
    await page.setViewportSize({ width: 390, height: 844 });
    await evaluate(() => testBM1.startWithFaction('terran'));
    await page.locator('#btn-game-menu').click();
    await page.locator('[data-game-menu="debug"]').click();
    await page.locator('[name="diplomacy-a"]').selectOption('romulan');
    await page.locator('[name="diplomacy-b"]').selectOption('klingon');
    await page.locator('[name="diplomacy-state"]').selectOption('crisis');
    await page.getByRole('button', { name: 'Set relationship', exact: true }).click();
    assert.equal(
      await evaluate(() => testBM1.diplomacyBook().pairs['klingon:romulan'].status),
      'crisis',
    );
    assert.match(await page.locator('[data-diplomacy-bulletin]').textContent(), /crisis/);
    const fit = await page
      .locator('#cheats-debug')
      .evaluate((el) => el.scrollWidth <= el.clientWidth);
    assert.ok(fit);
    await page.screenshot({
      path: path.join(process.env.BM1_TEST_OUTPUT || '/tmp', 'playtest-mobile.png'),
    });
    await page.keyboard.press('Escape');
  });
  assert.deepEqual(errors, []);
  console.log(`${checks.length} playtest scenario groups passed; no page errors.`);
  await browser.close();
  server.close();
})().catch((error) => {
  console.error(error);
  process.exit(1);
});
