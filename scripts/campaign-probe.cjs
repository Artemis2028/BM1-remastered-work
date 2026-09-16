// Campaign gate: strategic accounts, single-resolution battles, captured industry, Dominion phases,
// design recovery, relays, commissions and the Empire panel, exercised in the built game.
// Run with Playwright installed. Starts its own static server; BM1_TEST_ROOT can select dist.
const { chromium } = require('playwright');
const assert = require('node:assert/strict');
const http = require('node:http'), fs = require('node:fs'), path = require('node:path');
const root = path.resolve(process.env.BM1_TEST_ROOT || path.join(__dirname, '..'));
const server = http.createServer((req, res) => {
  const rel = decodeURIComponent(req.url.split('?')[0]).replace(/^\/+/, '') || 'index.html';
  const file = path.resolve(root, rel);
  if (!file.startsWith(root + path.sep) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) { res.writeHead(404); res.end(); return; }
  res.setHeader('Content-Type', { '.js': 'text/javascript', '.mjs': 'text/javascript', '.css': 'text/css', '.html': 'text/html', '.json': 'application/json', '.png': 'image/png', '.svg': 'image/svg+xml' }[path.extname(file)] || 'application/octet-stream');
  fs.createReadStream(file).pipe(res);
});
const OUT = process.env.BM1_TEST_OUTPUT || '/tmp';
const EXPORTS = 'window.testBM1={state,startWithFaction,advanceFleetCalendar,fleetBook,Fleet,Campaign,campaign,campaignBook,buildCampaignWorld,openCampaignPanel,closeCampaignPanel,renderCampaignPanel,applyDebugCommand,saveGame,loadGame,getSystemControl,spawnFleetAttack,updateSystemActivity,getSystemActivity,launchBudgetedAmbientRaid,destroyStation,getStationOwner,ensurePlaytestState,advanceFactionReconstruction,applySystemState,tick,updateFleetAttacks,getShipyardStock,getStationWeaponStock,fleetStationServices,getSystemFaction,transferSystemControlToPlayer,transferSystemControlToFaction,campaignIntegrationOffers,fleetPlanStatus,buyFleetPlan,commissionStatus,commissionShip,fleetShipStock,getCurrentServiceStation,openRemoteStationShop,gameNow,pauseGameClock,resumeGameClock,ensureCombatTargetStats,getShipStats,changeDiplomacy,captureWorldEncounter,restoreWorldEncounter,maybeMaterializeCampaignOperation,dispatchFleetFormation,isSystemRelayConnected,campaignRelayCoverage,advanceCommissions,getShipPrice,setCamera,renderPlanetMenu,renderFleetManager,getAllWormholeLinks,triggerDebugEvent,getUnfilteredShipyardStock,startDesignRecovery,advanceRecoveryMissions,getStationCapabilities,getFactionStanding,adjustFactionStanding,galaxyNewsBook,visibleGalaxyReports,isChartSystemVisible,reconstructionFunds,syncPlayerPolity,offerStationMission,advanceStationMissions,keys,heldWeaponInputs,updateStats,getPlayerFleetShips,completeFleetJourneys,markSystemVisited,acknowledgeCampaignOrders,getStationEffectiveOffers,deliverFleetBuild,orderFleetBuild,chooseActivityAttacker,areFactionsOpposed,worldRelation,getSystemIndexByName,placePlayerAtSecurityApproach,updateSecurityOrderPanel,getSecurityZone,playerWorldPosition,getShipPurchaseStatus,fleetReservations,openDebugMenu,closePlanetMenu,openPlanetMenu,hasWorldCargoToDeliver,sellOrdinaryCargo,deliverContractCargo,tradeAtPlanet,recalcCargoFromPods,getCurrentDockedStation,autoAssignFleet,updateRecoveryPanel,applyPlayerDamage,applyCurrentShipStats,ensureSystemState,campaignSystemName,campaignMaskText,compatibleRecoveryYard,getNpcCombatDurability};';
(async () => {
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const browser = await chromium.launch({ headless: true, executablePath: process.env.BM1_CHROMIUM_PATH, args: ['--single-process', '--no-zygote', '--no-sandbox', '--disable-dev-shm-usage', '--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
  const page = await browser.newPage({ viewport: { width: 1280, height: 800 }, serviceWorkers: 'block' });
  const errors = []; page.on('pageerror', (e) => errors.push(e.message));
  await page.route('**/src/main.js*', async (route) => { const r = await route.fetch(); await route.fulfill({ response: r, body: (await r.text()) + '\n' + EXPORTS }); });
  await page.goto(`http://127.0.0.1:${server.address().port}`);
  await page.waitForFunction(() => window.testBM1 && testBM1.state.shipCatalog && testBM1.state.planets.length > 10 && testBM1.state.flaHints?.symbols?.length > 0);
  await page.evaluate(async () => { testBM1.startWithFaction('terran'); await new Promise((res) => { requestAnimationFrame = (cb) => { if (cb.name === 'loop') res(); return 0; }; }); });
  const checks = [];
  async function check(name, fn) { await fn(); checks.push(name); console.log('PASS', name); }
  const ev = (fn, arg) => page.evaluate(fn, arg);
  // A seeded fresh start: the campaign, diplomacy and stock ledgers all derive from the campaign id.
  const fresh = (seed = 'gate-seed') => ev((seed) => { const t = testBM1; t.startWithFaction('terran'); const p = t.ensurePlaytestState(); delete p.diplomacy; delete p.campaign; t.fleetBook().campaignId = seed; t.campaign(); }, seed);

  await check('every world-holding faction and the player empire are separate polities with real hulls from legal pools; the three accounts are reported separately', async () => {
    await fresh('gate-A');
    const r = await ev(() => {
      const t = testBM1, s = t.state, book = t.campaign(), world = t.buildCampaignWorld(true);
      const controllers = new Set(world.systems.map((x) => x.controller).filter((c) => c && c !== 'player' && world.isFaction(c)));
      const polities = Object.keys(book.polities);
      const missing = [...controllers].filter((c) => !polities.includes(c));
      const legal = Object.values(book.polities).every((p) => p.hulls.every((h) => s.shipStatsById[h.shipId]?.assetType === 'ship' && h.hull > 0 && h.maxHull > 0 && Number.isInteger(h.systemIndex)));
      const summary = Object.fromEntries(['terran', 'klingon', 'player'].map((id) => [id, t.Campaign.politySummary(book, world, id)]));
      const player = book.polities.player;
      return { missing, legal, hasPlayer: Boolean(player), playerTreasury: player.treasury, latinum: s.latinum, summary: Object.fromEntries(Object.entries(summary).map(([k, v]) => [k, { econ: v.economy, prod: v.production, ready: v.readiness }])), openingRatio: summary.klingon.readiness.strength / Math.max(1, summary.terran.readiness.strength), wormhole: t.getAllWormholeLinks().map((w) => [w.id, w.from, w.to]) };
    });
    assert.deepEqual(r.missing, []); assert.ok(r.legal); assert.ok(r.hasPlayer);
    assert.equal(r.summary.player.econ.treasury, 0, 'player polity has no treasury copy before sync');
    assert.ok(r.summary.terran.prod.berths > 0 && r.summary.klingon.prod.berths > 0);
    assert.ok(r.summary.klingon.ready.hulls > 0 && r.summary.terran.ready.hulls > 0);
    assert.deepEqual(r.wormhole, [['bajora-dominica-wormhole', 46, 58]]);
    console.log('OPENING_FORCES', JSON.stringify({ terran: r.summary.terran.ready, klingon: r.summary.klingon.ready, ratio: Number(r.openingRatio.toFixed(2)) }));
  });

  await check('daily and chunked calendar advances give identical campaign books; player income is credited once and never re-credited on reload', async () => {
    const run = async (chunks) => {
      await fresh('gate-B');
      return ev((chunks) => { const t = testBM1, s = t.state; const before = s.latinum; for (const n of chunks) t.advanceFleetCalendar(n, t.Fleet.nextId(t.fleetBook(), 'journey')); const book = t.campaign(); return { sum: t.Campaign.checksum(book), day: s.day, income: s.latinum - before, ledger: Object.keys(book.incomeLedger).length, settled: book.settled }; }, chunks);
    };
    const daily = await run(Array(40).fill(1)), chunked = await run([7, 13, 20]), once = await run([40]);
    assert.equal(daily.sum, chunked.sum); assert.equal(daily.sum, once.sum); assert.equal(daily.day, 41);
    assert.equal(daily.income, chunked.income);
    const reload = await ev(() => { const t = testBM1, s = t.state; t.saveGame(3); const before = s.latinum; t.loadGame(3); const sum = t.Campaign.checksum(t.campaign()); const id = t.Fleet.nextId(t.fleetBook(), 'journey'); t.advanceFleetCalendar(0, id); return { same: before === s.latinum, sum, settled: t.campaign().settled, day: s.day }; });
    assert.ok(reload.same); assert.equal(reload.sum, once.sum); assert.equal(reload.settled, 41);
  });

  await check('an engaged operation at the captain\'s system materialises as real hulls in waves; killing a wave brings the next; the last kill resolves the battle once with losses recorded', async () => {
    await fresh('gate-C');
    const r = await ev(() => {
      const t = testBM1, s = t.state, book = t.campaign(), world = t.buildCampaignWorld(true);
      const k = book.polities.klingon; const hulls = k.hulls.filter((h) => h.status === 'ready').slice(0, 9);
      const effects = []; const op = t.Campaign.launchOperation(book, world, 'klingon', hulls, s.currentPlanet, s.day, 0, 'assault', effects);
      op.status = 'engaged'; op.engagedDay = s.day; op.arriveDay = s.day;
      s.activeFleetAttack = null;
      t.updateSystemActivity(0);
      const wave1 = s.npcShips.filter((n) => n.campaignHullId && n.attackId === s.activeFleetAttack?.id);
      const claimed = op.resolvedBy;
      const sizes = [wave1.length];
      // save and reload mid-battle keeps the same claimed operation and the same hull links
      t.saveGame(4); t.loadGame(4);
      const afterLoad = { attack: s.activeFleetAttack?.campaignOpId, ships: s.npcShips.filter((n) => n.campaignHullId).length, claimed: t.campaign().operations.find((o) => o.id === op.id).resolvedBy };
      // wipe the first wave
      for (const n of s.npcShips.filter((n) => n.attackId === s.activeFleetAttack.id)) n.destroyed = true;
      t.updateFleetAttacks();
      const wave2 = s.npcShips.filter((n) => n.campaignHullId && !n.destroyed && n.attackId === s.activeFleetAttack?.id);
      sizes.push(wave2.length);
      const opMid = t.campaign().operations.find((o) => o.id === op.id);
      const midStatus = { status: opMid.status, spawned: opMid.spawnedHullIds.length, lost: t.campaign().polities.klingon.hulls.filter((h) => h.status === 'lost').length };
      for (const n of s.npcShips.filter((n) => n.attackId === s.activeFleetAttack.id)) n.destroyed = true;
      t.updateFleetAttacks();
      const opEnd = t.campaign().operations.find((o) => o.id === op.id);
      return { claimed, sizes, afterLoad, midStatus, end: { status: opEnd.status, outcome: opEnd.outcome, resolvedBy: opEnd.resolvedBy, losses: opEnd.losses }, lostHulls: t.campaign().polities.klingon.hulls.filter((h) => h.status === 'lost').length, attack: s.activeFleetAttack, battles: t.campaign().stats.battlesResolved };
    });
    assert.equal(r.claimed, 'local'); assert.deepEqual(r.sizes, [6, 3]);
    assert.equal(r.afterLoad.ships, 6); assert.equal(r.afterLoad.claimed, 'local'); assert.ok(r.afterLoad.attack);
    assert.equal(r.midStatus.status, 'engaged'); assert.equal(r.midStatus.spawned, 9); assert.equal(r.midStatus.lost, 0, 'no loss recorded before the battle resolves');
    assert.deepEqual(r.end, { status: 'resolved', outcome: 'destroyed', resolvedBy: 'local', losses: 9 });
    assert.equal(r.lostHulls, 9); assert.equal(r.attack, null); assert.equal(r.battles, 1);
  });

  await check('a locally won operation captures the world exactly once: occupation and integration clock recorded, control transferred, no offscreen double resolution', async () => {
    await fresh('gate-D');
    const r = await ev(() => {
      const t = testBM1, s = t.state, book = t.campaign(), world = t.buildCampaignWorld(true);
      const target = s.currentPlanet; const before = t.getSystemControl(target).polityId;
      const hulls = book.polities.klingon.hulls.filter((h) => h.status === 'ready').slice(0, 4);
      const op = t.Campaign.launchOperation(book, world, 'klingon', hulls, target, s.day, 0, 'assault', []);
      op.status = 'engaged'; op.engagedDay = s.day; op.arriveDay = s.day; s.activeFleetAttack = null;
      t.updateSystemActivity(0);
      // remove all local defenders, keep the captain out of the fight and let the control timer elapse
      for (const st of s.stations) st.destroyed = true;
      s.npcShips = s.npcShips.filter((n) => n.attackId === s.activeFleetAttack.id);
      s.lastPlayerShotAt = -1e9; t.setCamera(s.systemStar.x + 60000, s.systemStar.y);
      t.updateFleetAttacks();
      const timerStarted = s.fleetAttackControlSince > 0;
      s.fleetAttackControlSince = t.gameNow() - 10 * 60 * 1000;
      const captures0 = book.stats.captures;
      t.updateFleetAttacks();
      const after = t.getSystemControl(target).polityId;
      const o = book.operations.find((x) => x.id === op.id);
      const occ = book.occupations[target];
      const integ = book.polities.klingon.integrations[target];
      t.advanceFleetCalendar(3, t.Fleet.nextId(t.fleetBook(), 'journey'));
      return { timerStarted, before, after, outcome: o.outcome, resolvedBy: o.resolvedBy, captures: book.stats.captures - captures0, occ: occ && { by: occ.by, from: occ.from }, integ: integ && { source: integ.sourceFaction, qualifies: integ.qualification.qualifies }, stillOne: book.stats.captures - captures0, survivorsReady: t.Campaign.operationHulls(book, o).every((h) => h.status === 'ready' && h.systemIndex === target) };
    });
    assert.ok(r.timerStarted, 'defences broken'); assert.equal(r.before, 'terran'); assert.equal(r.after, 'klingon');
    assert.equal(r.outcome, 'captured'); assert.equal(r.resolvedBy, 'local'); assert.equal(r.captures, 1);
    assert.deepEqual(r.occ, { by: 'klingon', from: 'terran' }); assert.deepEqual(r.integ, { source: 'terran', qualifies: true });
    assert.equal(r.stillOne, 1); assert.ok(r.survivorsReady);
  });

  await check('leaving the system hands the battle back to the model with the survivors as they stand; returning materialises what is left; no hull is duplicated', async () => {
    await fresh('gate-E');
    const r = await ev(() => {
      const t = testBM1, s = t.state, book = t.campaign(), world = t.buildCampaignWorld(true);
      const home = s.currentPlanet;
      const hulls = book.polities.klingon.hulls.filter((h) => h.status === 'ready').slice(0, 5);
      const op = t.Campaign.launchOperation(book, world, 'klingon', hulls, home, s.day, 0, 'assault', []);
      op.status = 'engaged'; op.engagedDay = s.day; op.arriveDay = s.day; s.activeFleetAttack = null;
      t.updateSystemActivity(0);
      const ships = s.npcShips.filter((n) => n.campaignHullId);
      ships[0].destroyed = true; ships[1].combatHull = Math.round(ships[1].maxCombatHull * 0.5);
      const other = s.planets.findIndex((p, i) => i !== home && t.getSystemControl(i).polityId === 'terran');
      s.currentPlanet = other; s.myplanet = other + 1; t.applySystemState(other);
      const released = { resolvedBy: op.resolvedBy, status: op.status, lost: book.polities.klingon.hulls.filter((h) => h.status === 'lost').length, damaged: hulls.filter((h) => h.status !== 'lost' && h.hull < h.maxHull).length, encounterAttack: t.ensurePlaytestState().encounters[home].attack, snapshotCampaignShips: t.ensurePlaytestState().encounters[home].ships.filter((x) => x.actor.campaignHullId).length };
      s.currentPlanet = home; s.myplanet = home + 1; t.applySystemState(home);
      s.activeFleetAttack = null;
      t.updateSystemActivity(0);
      const back = s.npcShips.filter((n) => n.campaignHullId && !n.destroyed);
      return { released, back: back.length, distinct: new Set(back.map((n) => n.campaignHullId)).size, claimedAgain: op.resolvedBy, halfHull: back.some((n) => n.combatHull < n.maxCombatHull * 0.6) };
    });
    assert.equal(r.released.resolvedBy, null); assert.equal(r.released.status, 'engaged'); assert.equal(r.released.lost, 1); assert.equal(r.released.damaged, 1);
    assert.equal(r.released.encounterAttack, null); assert.equal(r.released.snapshotCampaignShips, 0);
    assert.equal(r.back, 4); assert.equal(r.distinct, 4); assert.equal(r.claimedAgain, 'local'); assert.ok(r.halfHull, 'damage carried through the release');
  });

  await check('ambient fleet actions draw real hulls from the attacker\'s pool and are marked assigned; a power with no available force sends nothing', async () => {
    await fresh('gate-F');
    const r = await ev(() => {
      const t = testBM1, s = t.state, book = t.campaign();
      const record = t.getSystemActivity(); Object.assign(record, { type: 'battle', triggered: false, combatElapsed: 1e9, seed: 4242 });
      s.activeFleetAttack = null;
      const attacker = t.chooseActivityAttacker(record);
      const readyBefore = book.polities[attacker].hulls.filter((h) => h.status === 'ready').length;
      t.updateSystemActivity(0);
      const ships = s.npcShips.filter((n) => n.campaignHullId && n.attackId === s.activeFleetAttack?.id);
      const assigned = book.polities[attacker].hulls.filter((h) => h.status === 'assigned').length;
      const readyAfter = book.polities[attacker].hulls.filter((h) => h.status === 'ready').length;
      const op = book.operations.at(-1);
      const legal = ships.every((n) => book.polities[attacker].hulls.some((h) => h.id === n.campaignHullId && h.shipId === n.shipId));
      // a power whose pool is exhausted cannot raid and is no longer a candidate attacker
      for (const h of book.polities[attacker].hulls) if (h.status === 'ready') h.status = 'repairing';
      s.activeFleetAttack = null; Object.assign(record, { type: 'battle', triggered: false, combatElapsed: 1e9 });
      const before = s.npcShips.length; const refused = t.launchBudgetedAmbientRaid(attacker, record);
      return { attacker, readyBefore, triggered: record.triggered, outcome: record.outcome, ships: ships.length, faction: op?.faction, assigned, drawn: readyBefore - readyAfter, opKind: op?.kind, legal, exhausted: { ok: refused.ok, reason: refused.reason, added: s.npcShips.length - before, candidate: t.chooseActivityAttacker(record) === attacker } };
    });
    assert.ok(r.attacker);
    const drawn = Math.min(7, r.readyBefore);
    assert.equal(r.ships, Math.min(6, drawn), JSON.stringify(r)); assert.equal(r.faction, r.attacker); assert.equal(r.drawn, drawn); assert.equal(r.assigned, drawn); assert.equal(r.opKind, 'battle'); assert.ok(r.legal);
    console.log('AMBIENT_RAID', JSON.stringify({ attacker: r.attacker, ready: r.readyBefore, drawn }));
    assert.deepEqual(r.exhausted, { ok: false, reason: 'no available force', added: 0, candidate: false });
  });

  await check('Dominion: dormant → reconnaissance → staging → invasion via the Bajoran wormhole with two warnings first; no Dominion operation before the invasion; convoys are finite', async () => {
    await fresh('gate-G');
    const r = await ev(() => {
      const t = testBM1, s = t.state, book = t.campaign();
      const c = book.config; const phases = [];
      const step = (to) => { while (s.day < to) { t.advanceFleetCalendar(Math.min(10, to - s.day), t.Fleet.nextId(t.fleetBook(), 'journey')); phases.push([s.day, book.dominion.phase, book.operations.filter((o) => o.faction === 'dominion').length]); } };
      step(c.dominionReconDay - 1); const beforeRecon = { phase: book.dominion.phase, ops: book.operations.filter((o) => o.faction === 'dominion').length, warnings: book.dominion.warnings.length };
      step(c.dominionStagingDay + 1); const staging = { phase: book.dominion.phase, ops: book.operations.filter((o) => o.faction === 'dominion').length, warnings: book.dominion.warnings.length, hullsAtStaging: book.polities.dominion.hulls.filter((h) => h.systemIndex === 58).length };
      step(c.dominionInvasionDay + 31); const inv = book.dominion; const op = book.operations.find((o) => o.id === inv.expeditionOpId);
      return { beforeRecon, staging, phase: inv.phase, warnings: inv.warnings.map((w) => [w.day, w.id]), entry: inv.entrySystem, stagingSystem: inv.stagingSystem, target: op?.targetSystem, kind: op?.kind, convoys: inv.convoys, maxConvoys: c.dominionMaxConvoys, dominionOpsBeforeInvasion: phases.filter((p) => p[1] !== 'invasion').every((p) => p[2] === 0) };
    });
    assert.equal(r.beforeRecon.phase, 'dormant'); assert.equal(r.beforeRecon.ops, 0); assert.equal(r.beforeRecon.warnings, 0);
    assert.equal(r.staging.phase, 'staging'); assert.equal(r.staging.ops, 0); assert.ok(r.staging.warnings >= 2); assert.ok(r.staging.hullsAtStaging > 5);
    assert.equal(r.phase, 'invasion'); assert.equal(r.entry, 46); assert.equal(r.stagingSystem, 58); assert.equal(r.target, 46); assert.equal(r.kind, 'invasion');
    assert.ok(r.warnings.filter((w) => w[1] !== 'invasion').length >= 2); assert.ok(r.dominionOpsBeforeInvasion); assert.ok(r.convoys <= r.maxConvoys);
    console.log('DOMINION_TIMELINE', JSON.stringify(r.warnings));
  });


  await check('design recovery: losing a sole vendor offers one bounded contract; rescue → recover → deliver relocates lawful access once; plans stay 4× price at the next standing tier; an owned licence is never charged again', async () => {
    await fresh('gate-H');
    const r = await ev(() => {
      const t = testBM1, s = t.state, book = t.campaign();
      // pick a sole-source authored hull at a station in a system the captain can reach, whose loss is detectable
      const entry = Object.entries(book.designs).find(([id, d]) => d.sources.length === 1 && (s.stationDefinitions || []).some((def) => def.id === d.sources[0] && !s.destroyedStations[def.id] && t.isChartSystemVisible(Number(def.systemIndex))));
      const [shipId, design] = entry; const def = s.stationDefinitions.find((d) => d.id === design.sources[0]);
      const sys = Number(def.systemIndex);
      s.currentPlanet = sys; s.myplanet = sys + 1; t.applySystemState(sys);
      const station = s.stations.find((x) => x.id === def.id);
      t.ensureCombatTargetStats(station);
      const news0 = t.galaxyNewsBook().items.length;
      t.destroyStation(station); t.destroyStation(station);
      const offers = book.recoveries.filter((x) => x.shipId === Number(shipId));
      const status = t.Campaign.designStatus(book, Number(shipId));
      const rec = offers[0];
      const started = t.startDesignRecovery(rec.id);
      const again = t.startDesignRecovery(rec.id);
      const mission = book.missions.find((m) => m.recoveryId === rec.id);
      // recover: be near the world
      t.setCamera(s.systemPlanet.x + 100, s.systemPlanet.y); t.advanceRecoveryMissions();
      const recovered = mission.step;
      // deliver: dock at a compatible yard the captain controls
      // a compatible yard: construction capacity for the design's mass and a trade culture allowed to sell it
      const yard = s.stationDefinitions.find((d) => !s.destroyedStations[d.id] && d.id !== def.id && t.isChartSystemVisible(Number(d.systemIndex)) && t.getStationCapabilities(d).services.construction === 'heavy' && (() => { const i = Number(d.systemIndex); s.currentPlanet = i; return t.compatibleRecoveryYard(d, Number(shipId)); })());
      const ysys = Number(yard.systemIndex); s.currentPlanet = ysys; s.myplanet = ysys + 1; t.applySystemState(ysys);
      t.transferSystemControlToPlayer(ysys);
      s.docked = true; s.dockedStationId = yard.id; s.dockedPlanetIndex = ysys;
      const quoteBefore = t.fleetPlanStatus(Number(shipId));
      t.advanceRecoveryMissions();
      const done = book.missions.find((m) => m.recoveryId === rec.id).status;
      const relocated = t.getStationEffectiveOffers(yard).shipIds.includes(Number(shipId));
      const stocked = t.getShipyardStock(s.stations.find((x) => x.id === yard.id)).some((x) => Number(x.id) === Number(shipId));
      const ship = t.getShipStats(Number(shipId));
      const base = ship.purchaseRequirements?.factionStanding ?? 0;
      const quote = t.fleetPlanStatus(Number(shipId));
      const tier = t.Fleet.planStanding(base);
      // owned licence: no second charge
      t.fleetBook().shipPlans.push(Number(shipId)); const owned = t.fleetPlanStatus(Number(shipId));
      // broker path: the lead is paid at a trade station or bar before the recovery leg opens
      s.docked = false; s.dockedStationId = null;
      const entry2 = Object.entries(book.designs).find(([id2, d2]) => Number(id2) !== Number(shipId) && d2.sources.length === 1 && !d2.lost.length && (s.stationDefinitions || []).some((d3) => d3.id === d2.sources[0] && !s.destroyedStations[d3.id] && t.isChartSystemVisible(Number(d3.systemIndex))));
      let broker = null;
      if (entry2) {
        const [id2, d2] = entry2; const def2 = s.stationDefinitions.find((d3) => d3.id === d2.sources[0]); const sys2 = Number(def2.systemIndex);
        s.currentPlanet = sys2; s.myplanet = sys2 + 1; t.applySystemState(sys2);
        const st2 = s.stations.find((x) => x.id === def2.id); t.ensureCombatTargetStats(st2); t.destroyStation(st2);
        const rec2 = book.recoveries.find((x) => x.shipId === Number(id2)); rec2.kind = 'broker';
        t.startDesignRecovery(rec2.id); const m2 = book.missions.find((m) => m.recoveryId === rec2.id);
        const bar = s.stationDefinitions.find((d3) => !s.destroyedStations[d3.id] && (t.getStationCapabilities(d3).services.rumors || t.getStationCapabilities(d3).services.commodities) && t.isChartSystemVisible(Number(d3.systemIndex)));
        const bsys = Number(bar.systemIndex); s.currentPlanet = bsys; s.myplanet = bsys + 1; t.applySystemState(bsys);
        s.docked = true; s.dockedStationId = bar.id; s.dockedPlanetIndex = bsys; s.latinum = 5e6; const cash = s.latinum;
        t.advanceRecoveryMissions();
        broker = { step0: 'lead', fee: m2.fee, step: m2.step, paid: cash - s.latinum };
        s.docked = false; s.dockedStationId = null;
      }
      return { broker, shipId: Number(shipId), station: def.id, offers: offers.length, status: status.state, text: status.text, started, again, missionKind: mission.kind, step0: rec.kind === 'broker' ? 'lead' : 'recover', recovered, done, relocated, stocked, price: quote.price, expectedPrice: 4 * t.getShipPrice(ship), required: quote.required, tier, ownedPrice: owned.price, ownedReason: owned.reason, quoteBeforeOffered: quoteBefore.reason, recStatus: rec.status, relocatedTo: rec.relocatedTo, secondLoss: book.recoveries.filter((x) => x.shipId === Number(shipId)).length };
    });
    assert.equal(r.offers, 1, JSON.stringify(r)); assert.equal(r.status, 'lost'); assert.match(r.text, /Original yard lost — locate engineering archive/);
    assert.ok(r.started); assert.equal(r.again, false); assert.equal(r.missionKind, 'archive'); assert.equal(r.recovered, 'deliver');
    assert.equal(r.done, 'completed'); assert.ok(r.relocated); assert.ok(r.stocked, 'the recovered design is a real offer at the new yard');
    assert.equal(r.price, r.expectedPrice); assert.equal(r.required, r.tier); assert.ok([15, 30, 50, 75, 100].includes(r.required));
    assert.equal(r.ownedReason, 'Already licensed'); assert.equal(r.recStatus, 'completed'); assert.equal(r.secondLoss, 1);
    if (r.broker) { assert.ok(r.broker.fee > 0); assert.equal(r.broker.step, 'recover'); assert.equal(r.broker.paid, r.broker.fee); }
    console.log('RECOVERY', JSON.stringify({ shipId: r.shipId, from: r.station, to: r.relocatedTo, price: r.price, standing: r.required }));
  });

  await check('relays are command links: a dispatch to ships beyond any relay link is queued once and acknowledged exactly once when a link exists; local orders always work', async () => {
    await fresh('gate-I');
    const r = await ev(() => {
      const t = testBM1, s = t.state, book = t.campaign();
      const home = s.currentPlanet; // Earth, home of the Alpha Array relay
      const other = s.planets.findIndex((p, i) => i !== home && t.getSystemControl(i).polityId === 'terran');
      // a fleet vessel waiting at Earth while the captain is elsewhere
      const shipId = t.getShipyardStock(null)[0]?.id || Number(s.playership);
      t.deliverFleetBuild({ id: 'gate-relay-1', shipId: Number(shipId), system: home, stationId: null });
      s.currentPlanet = other; s.myplanet = other + 1; t.applySystemState(other);
      const b = t.fleetBook(); const g = b.formations.find((f) => f.members.includes('gate-relay-1:vessel'));
      g.destination = other;
      const connectedBefore = t.isSystemRelayConnected(home);
      const first = t.dispatchFleetFormation(g.id); const second = t.dispatchFleetFormation(g.id);
      const queued = book.orders.filter((o) => o.status === 'queued').length;
      const vessel = s.playerFleet.find((f) => f.id === 'gate-relay-1:vessel');
      const stillThere = vessel.assignment !== 'transit';
      // taking Earth gives the captain its relay array; the queued order is acknowledged on the next calendar day
      t.transferSystemControlToPlayer(home);
      const connectedAfter = t.isSystemRelayConnected(home);
      t.advanceFleetCalendar(1, t.Fleet.nextId(t.fleetBook(), 'journey'));
      const acked = book.orders.filter((o) => o.status === 'acknowledged').length;
      const moving = vessel.assignment === 'transit' || vessel.systemIndex === other;
      t.advanceFleetCalendar(1, t.Fleet.nextId(t.fleetBook(), 'journey'));
      const ackedAgain = book.orders.filter((o) => o.status === 'acknowledged').length;
      // a local order never needs a relay
      const local = t.deliverFleetBuild({ id: 'gate-relay-2', shipId: Number(shipId), system: other, stationId: null });
      const g2 = t.fleetBook().formations.find((f) => f.members.includes('gate-relay-2:vessel')); g2.destination = home;
      const localOk = t.dispatchFleetFormation(g2.id);
      return { connectedBefore, first, second, queued, stillThere, connectedAfter, acked, moving, ackedAgain, localOk, orders: book.orders.length };
    });
    assert.equal(r.connectedBefore, false); assert.equal(r.first, false); assert.equal(r.second, false); assert.equal(r.queued, 1); assert.ok(r.stillThere);
    assert.equal(r.connectedAfter, true); assert.equal(r.acked, 1); assert.ok(r.moving); assert.equal(r.ackedAgain, 1); assert.equal(r.localOk, true); assert.equal(r.orders, 1);
  });

  await check('commissions: an out-of-stock authored offer can be commissioned once, is paid once, and is delivered to the fleet at that system with the next shared resupply', async () => {
    await fresh('gate-J');
    const r = await ev(() => {
      const t = testBM1, s = t.state;
      s.latinum = 5e6;
      const vendor = s.stations.find((st) => !st.destroyed && t.getShipyardStock(st).length && t.getStationOwner(st) === 'terran');
      s.docked = true; s.dockedStationId = vendor.id; s.dockedPlanetIndex = s.currentPlanet;
      const ship = t.getShipyardStock(vendor)[0]; const id = Number(ship.id);
      const inStock = t.commissionStatus(id).reason;
      const ledger = t.fleetShipStock(id); ledger.quantity = 0;
      const status = t.commissionStatus(id);
      const before = s.latinum;
      const ok = t.commissionShip(id); const dup = t.commissionStatus(id).reason;
      const paid = before - s.latinum;
      const buyBlocked = t.getShipPurchaseStatus(id).reason;
      s.planetMenuOpen = true; t.renderPlanetMenu(); const card = document.querySelector(`[data-ship-stock="${id}"]`)?.textContent || ''; t.closePlanetMenu();
      const days = ledger.nextDay - s.day + 1;
      t.advanceFleetCalendar(days, t.Fleet.nextId(t.fleetBook(), 'journey'));
      const res = t.fleetReservations()[0];
      const vessel = s.playerFleet.find((f) => f.id === `${res.id}:vessel`);
      return { inStock, ok, status: status.ok, price: status.price, paid, dup, buyBlocked, card, res: res.status, delivered: Boolean(vessel), at: vessel?.systemIndex, quantityAfter: t.fleetShipStock(id).quantity, latinumAfter: before - s.latinum };
    });
    assert.match(r.inStock, /In stock/); assert.ok(r.status); assert.ok(r.ok); assert.equal(r.paid, r.price); assert.equal(r.dup, 'Already commissioned here');
    assert.equal(r.buyBlocked, 'Out of stock'); assert.match(r.card, /Out of stock/); assert.match(r.card, /commissioned/); assert.match(r.card, /next resupply/);
    assert.equal(r.res, 'delivered'); assert.ok(r.delivered); assert.equal(r.at, 0); assert.equal(r.quantityAfter, 0, 'the delivered unit came out of the shared stock'); assert.ok(r.latinumAfter >= r.price && r.latinumAfter - r.price <= 60, 'paid exactly once (plus the delivered vessel\'s own daily upkeep)');
  });

  await check('one account per faction: reconstruction spends the campaign treasury and no faction keeps a second budget; private businesses keep their own ledgers', async () => {
    await fresh('gate-K');
    const r = await ev(() => {
      const t = testBM1, s = t.state, book = t.campaign();
      const st = s.stations.find((x) => t.getStationOwner(x) === 'terran' && !x.destroyed);
      t.ensureCombatTargetStats(st);
      const before = book.polities.terran.treasury, materialsBefore = book.polities.terran.materials;
      t.destroyStation(st);
      const order = Object.values(t.ensurePlaytestState().reconstruction).find((o) => o.sourceId === st.id);
      t.advanceFleetCalendar(1, t.Fleet.nextId(t.fleetBook(), 'journey'));
      const afterStart = order.status;
      const spent = before + book.polities.terran.revenueLastDay - book.polities.terran.expenseLastDay - book.polities.terran.treasury;
      const budgets = Object.keys(t.ensurePlaytestState().factionBudgets);
      return { afterStart, cost: order.cost, spent: Math.round(spent), materialsSpent: Math.round(materialsBefore + 0 - book.polities.terran.materials), factionBudgets: budgets.filter((k) => !k.startsWith('private:')), funds: t.reconstructionFunds('terran').latinum === book.polities.terran.treasury };
    });
    assert.equal(r.afterStart, 'building'); assert.ok(Math.abs(r.spent - r.cost) <= r.cost * 0.05 + 50, JSON.stringify(r)); assert.deepEqual(r.factionBudgets, []); assert.ok(r.funds);
  });

  await check('captured major worlds integrate their native designs for any conqueror including the player; minor worlds grant nothing; integration designs are licensable and buildable only at the player\'s own yards there', async () => {
    await fresh('gate-L');
    const r = await ev(() => {
      const t = testBM1, s = t.state, book = t.campaign();
      const qonos = t.getSystemIndexByName('Qonos');
      const world = t.buildCampaignWorld(true);
      const q = t.Campaign.majorWorldQualification(book, world, qonos);
      const minor = world.systems.find((x) => x.controller === 'klingon' && !t.Campaign.majorWorldQualification(book, world, x.index).qualifies);
      s.currentPlanet = qonos; s.myplanet = qonos + 1; t.applySystemState(qonos);
      t.transferSystemControlToPlayer(qonos);
      if (minor) t.transferSystemControlToPlayer(minor.index);
      const integ0 = book.polities.player.integrations[qonos];
      t.advanceFleetCalendar(book.config.integrationDays + 2, t.Fleet.nextId(t.fleetBook(), 'journey'));
      const integ = book.polities.player.integrations[qonos];
      const minorInteg = minor ? book.polities.player.integrations[minor.index] : null;
      const yard = s.stations.find((x) => !x.destroyed && t.getStationOwner(x) === 'player' && t.fleetStationServices(x).build);
      s.docked = true; s.dockedStationId = yard.id; s.dockedPlanetIndex = qonos;
      const offers = t.campaignIntegrationOffers(yard);
      const design = offers[0];
      const plan = t.fleetPlanStatus(design);
      const foreignYard = s.stationDefinitions.find((d) => Number(d.systemIndex) !== qonos && t.getStationOwner(d, d.systemIndex) !== 'player');
      const elsewhere = t.campaignIntegrationOffers(foreignYard);
      t.adjustFactionStanding('klingon', 100); s.latinum = 5e6;
      const plan2 = t.fleetPlanStatus(design);
      const bought = t.buyFleetPlan(design);
      const build = t.orderFleetBuild(design, false);
      return { qualifies: q.qualifies, reason: q.reason, source: integ0?.sourceFaction, completed: Boolean(integ?.completedDay), designs: integ?.designs.length, licenses: Object.keys(book.polities.player.licenses).length, minorQualifies: minorInteg?.qualification.qualifies, minorDesigns: minorInteg?.designs.length, offers: offers.length, allKlingon: offers.every((id) => t.getShipFaction ? true : true), plan: plan.reason, integrated: plan.integrated, plan2: plan2.reason, price: plan2.price, expected: 4 * t.getShipPrice(t.getShipStats(design)), bought, build, elsewhere: elsewhere.length, stock: t.getShipyardStock(yard).some((x) => Number(x.id) === design) };
    });
    assert.ok(r.qualifies, r.reason); assert.equal(r.source, 'klingon'); assert.ok(r.completed); assert.ok(r.designs > 5); assert.equal(r.licenses, r.designs);
    if (r.minorQualifies !== undefined) { assert.equal(r.minorQualifies, false); assert.equal(r.minorDesigns, 0); }
    assert.ok(r.offers > 0); assert.ok(r.integrated); assert.match(r.plan, /standing|latinum/i); assert.equal(r.plan2, null, JSON.stringify(r)); assert.equal(r.price, r.expected); assert.ok(r.bought); assert.ok(r.build); assert.equal(r.elsewhere, 0);
    console.log('INTEGRATION', JSON.stringify({ reason: r.reason, designs: r.designs, offersAtYard: r.offers, shelfStock: r.stock }));
  });

  await check('review fixes: symmetric index coercion in the fleet-attack guard; Deliver and Sell are separate actions; the hail panel never overlaps the map thumbnail or the recovery panel', async () => {
    await fresh('gate-M');
    const r = await ev(() => {
      const t = testBM1, s = t.state;
      s.activeFleetAttack = null; s.currentPlanet = String(s.currentPlanet); t.getSystemActivity().type = 'battle';
      const spawned = t.spawnFleetAttack(Number(s.currentPlanet), 'klingon');
      s.currentPlanet = Number(s.currentPlanet); s.activeFleetAttack = null; s.npcShips = s.npcShips.filter((n) => !n.attackId);
      // Deliver vs Sell: ordinary cargo aboard, nothing due here
      s.cargoArray[0] = { tons: 6, item: 'Grain', destination: undefined }; t.recalcCargoFromPods();
      s.docked = true; s.dockedPlanetIndex = s.currentPlanet; s.dockedStationId = null;
      const cash = s.latinum; t.deliverContractCargo(); const afterDeliver = { latinum: s.latinum, tons: s.cargoArray[0].tons, log: s.log };
      t.sellOrdinaryCargo(); const afterSell = { latinum: s.latinum, tons: s.cargoArray[0].tons, log: s.log };
      s.planetMenuOpen = true; t.renderPlanetMenu(); const buttons = [...document.querySelectorAll('#planet-menu [data-planet-action]')].map((b) => b.dataset.planetAction); t.closePlanetMenu();
      return { spawned, deliverKept: afterDeliver.tons === 6 && afterDeliver.latinum === cash, deliverLog: afterDeliver.log, sold: afterSell.tons < 6 && afterSell.latinum > cash, sellLog: afterSell.log, buttons: buttons.filter((b) => ['deliver', 'sell'].includes(b)) };
    });
    assert.ok(r.spawned, 'a numeric-string current system no longer blocks fleet attacks');
    assert.ok(r.deliverKept, JSON.stringify(r)); assert.doesNotMatch(r.deliverLog, /Sold|Traded/); assert.ok(r.sold, JSON.stringify(r)); assert.match(r.sellLog, /Sold/); assert.deepEqual(r.buttons, ['deliver', 'sell']);
    for (const [w, h, name] of [[1280, 800, 'desktop'], [390, 844, 'mobile']]) {
      await page.setViewportSize({ width: w, height: h });
      const rects = await ev(() => { const t = testBM1, s = t.state; t.startWithFaction('terran'); s.currentPlanet = t.getSystemIndexByName('Qonos'); t.applySystemState(s.currentPlanet); t.placePlayerAtSecurityApproach(); t.updateSecurityOrderPanel();
        const box = (id) => { const el = document.getElementById(id); if (!el || getComputedStyle(el).display === 'none' || el.classList.contains('hidden')) return null; const b = el.getBoundingClientRect(); return { l: b.left, t: b.top, r: b.right, b: b.bottom }; };
        s.godMode = false; const pool = t.getNpcCombatDurability(s.playership).hull; s.hull = 100 * t.Fleet.disableThreshold(pool) / pool + 1; s.shields = 0; t.applyPlayerDamage(100, '#fff', { combatUnits: true }); t.updateRecoveryPanel(); t.updateSecurityOrderPanel();
        return { hail: box('security-order-panel'), mini: box('minimap-panel'), recovery: box('disabled-recovery'), text: document.getElementById('security-order-panel').textContent }; });
      const overlaps = (a, b) => a && b && a.l < b.r && b.l < a.r && a.t < b.b && b.t < a.b;
      assert.match(rects.text, /Incoming hail/);
      assert.ok(rects.hail, 'hail panel visible');
      assert.ok(!overlaps(rects.hail, rects.mini), `${name}: hail overlaps minimap ${JSON.stringify(rects)}`);
      assert.ok(!overlaps(rects.hail, rects.recovery), `${name}: hail overlaps recovery ${JSON.stringify(rects)}`);
      assert.ok(rects.hail.b <= h && rects.hail.t >= 0, `${name}: hail panel within viewport`);
      await page.screenshot({ path: path.join(OUT, `hail-layout-${name}.png`) });
    }
    await page.setViewportSize({ width: 1280, height: 800 });
  });

  await check('Empire panel: every tab renders with the player\'s holdings counted separately, hidden regions masked, and debug controls act through the model', async () => {
    await fresh('gate-N');
    const r = await ev(() => {
      const t = testBM1, s = t.state, book = t.campaign();
      t.advanceFleetCalendar(70, t.Fleet.nextId(t.fleetBook(), 'journey'));
      const tabs = {};
      for (const tab of ['empire', 'powers', 'operations', 'missions', 'history']) { t.openCampaignPanel(tab); tabs[tab] = document.getElementById('campaign-panel').textContent; }
      const hiddenNames = s.planets.map((p, i) => [p.name, i]).filter(([n, i]) => !t.isChartSystemVisible(i)).map(([n]) => n);
      const leaks = hiddenNames.filter((n) => Object.values(tabs).some((text) => text.includes(n)));
      const open = document.getElementById('campaign-panel').open, paused = t.gameNow();
      const results = {};
      t.closeCampaignPanel();
      results.advance = t.applyDebugCommand('campaign advance 3');
      results.day = s.day;
      results.treasury = t.applyDebugCommand('campaign treasury klingon 777000'); results.treasuryValue = book.polities.klingon.treasury;
      results.readiness = t.applyDebugCommand('campaign readiness romulan 12'); results.romulanReady = book.polities.romulan.hulls.filter((h) => h.status !== 'lost').length;
      const st = s.stations.find((x) => !x.destroyed);
      results.damage = t.applyDebugCommand(`campaign damage ${st.id}`); results.damaged = book.stationDamage[st.id];
      results.restore = t.applyDebugCommand(`campaign restore ${st.id}`); results.restored = book.stationDamage[st.id] === undefined && book.restoredStations[st.id] === true;
      const stocked = t.getShipyardStock(null)[0]?.id; results.stock = t.applyDebugCommand(`campaign stock ${stocked} deplete`); results.depleted = t.fleetShipStock(stocked)?.quantity;
      let missing = null; try { t.applyDebugCommand('campaign stock 999999 deplete'); } catch (e) { missing = e.message; } results.missing = missing;
      results.mission = t.applyDebugCommand('campaign mission relief'); results.missionOffered = book.missions.some((m) => m.kind === 'relief' && m.status === 'offered');
      results.phase = t.applyDebugCommand('campaign phase invasion');
      results.discover = t.applyDebugCommand('campaign discover gorn'); results.gorn = book.discoveries.gorn;
      let bad = null; try { t.applyDebugCommand('campaign nonsense'); } catch (e) { bad = e.message; }
      return { tabs: Object.fromEntries(Object.entries(tabs).map(([k, v]) => [k, v.length])), empireText: tabs.empire.slice(0, 300), leaks, hiddenCount: hiddenNames.length, open, results, bad };
    });
    for (const [tab, len] of Object.entries(r.tabs)) assert.ok(len > 100, `${tab} renders`);
    assert.match(r.empireText, /your own empire/); assert.deepEqual(r.leaks, []); assert.ok(r.hiddenCount > 0, 'the Dominion region is hidden in a fresh game'); assert.ok(r.open);
    assert.equal(r.results.day, 74); assert.equal(r.results.treasuryValue, 777000); assert.equal(r.results.romulanReady, 12); assert.ok(r.results.damaged >= 0.5); assert.ok(r.results.restored);
    assert.equal(r.results.depleted, 0); assert.match(r.results.missing, /stock/); assert.ok(r.results.missionOffered); assert.match(r.results.phase, /Forced override/); assert.ok(r.results.gorn); assert.match(r.bad, /campaign: phase|treasury/);
    await ev(() => testBM1.openCampaignPanel('empire'));
    await page.screenshot({ path: path.join(OUT, 'campaign-panel-desktop.png') });
    await ev(() => testBM1.openCampaignPanel('powers'));
    await page.screenshot({ path: path.join(OUT, 'campaign-powers-desktop.png') });
    await page.setViewportSize({ width: 390, height: 844 });
    await ev(() => testBM1.openCampaignPanel('empire'));
    await page.screenshot({ path: path.join(OUT, 'campaign-panel-mobile.png') });
    const fits = await ev(() => { const el = document.getElementById('campaign-panel'); const b = el.getBoundingClientRect(); return { w: b.width, sw: el.scrollWidth, cw: el.clientWidth, vw: window.innerWidth }; });
    assert.ok(fits.w <= fits.vw && fits.sw <= fits.cw + 1, JSON.stringify(fits));
    await page.setViewportSize({ width: 1280, height: 800 });
    await ev(() => testBM1.closeCampaignPanel());
  });

  await check('older saves migrate: a save without a campaign book gains one at its current day, legacy faction budgets fold into the single treasury exactly once, and a mid-battle campaign save reloads intact', async () => {
    await fresh('gate-O');
    const r = await ev(() => {
      const t = testBM1, s = t.state;
      // simulate a pre-campaign save: no campaign book, a legacy faction budget and a private ledger
      const p = t.ensurePlaytestState(); delete p.campaign; p.factionBudgets = { klingon: { latinum: 333000, duranium: 4000, lastDay: 1 }, 'private:egg-shipyard-terran-1': { latinum: 5000, duranium: 20, lastDay: 1 } };
      t.advanceFleetCalendar(5, t.Fleet.nextId(t.fleetBook(), 'journey'));
      t.saveGame(5); t.loadGame(5);
      const book = t.campaign();
      const world = t.buildCampaignWorld(true);
      return { version: book.version, initialized: book.initialized, day: book.day, klingonTreasury: book.polities.klingon.treasury >= 333000, migrated: book.migratedBudgets, budgets: Object.keys(t.ensurePlaytestState().factionBudgets), hulls: book.polities.klingon.hulls.length > 0, sum: t.Campaign.checksum(book) };
    });
    assert.equal(r.version, 1); assert.ok(r.initialized); assert.ok(r.klingonTreasury); assert.ok(r.migrated); assert.deepEqual(r.budgets, ['private:egg-shipyard-terran-1']); assert.ok(r.hulls);
  });


  await check('station contracts complete against real state and pay once: relief takes cargo, evacuation and reconnaissance need presence, repair needs duranium at the installation', async () => {
    await fresh('gate-P');
    const r = await ev(() => {
      const t = testBM1, s = t.state, book = t.campaign();
      const here = s.currentPlanet; const out = {};
      for (const kind of ['relief', 'evacuation', 'recon', 'repair']) { const m = t.offerStationMission(kind, here, true); t.Campaign.acceptMission(book, m.id, s.day); }
      const active = () => book.missions.filter((m) => m.status === 'active').map((m) => m.kind);
      out.active0 = active();
      // far from the world: nothing completes
      t.setCamera(s.systemStar.x + 60000, s.systemStar.y); t.advanceStationMissions(); out.farStill = active().length;
      // relief: 6 tons of trade goods within 600 units of the world
      s.cargoArray[0] = { tons: 6, item: 'Grain', destination: undefined }; t.recalcCargoFromPods();
      t.setCamera(s.systemPlanet.x + 100, s.systemPlanet.y); const cash = s.latinum;
      t.advanceStationMissions(); out.reliefDone = !active().includes('relief'); out.reliefTons = s.cargoArray[0].tons; out.reliefPaid = s.latinum - cash;
      // evacuation: hold near the world for a transporter cycle (20 s of frames)
      const evac = book.missions.find((m) => m.kind === 'evacuation'); evac.progressMs = 19990; t.advanceStationMissions(); out.evacDone = evac.status;
      // recon: uncloaked within 2,400 of an installation for 30 s
      const recon = book.missions.find((m) => m.kind === 'recon'); const st = s.stations.find((x) => !x.destroyed); t.setCamera(st.x + 100, st.y); recon.progressMs = 29990; t.advanceStationMissions(); out.reconDone = recon.status;
      // repair: dock at a damaged installation with 40 duranium
      book.stationDamage[st.id] = 0.5; s.docked = true; s.dockedStationId = st.id; s.dockedPlanetIndex = here; s.duranium = 39; t.advanceStationMissions(); out.repairShort = book.missions.find((m) => m.kind === 'repair').status;
      s.duranium = 45; t.advanceStationMissions(); const rep = book.missions.find((m) => m.kind === 'repair'); out.repairDone = rep.status; out.duraniumLeft = s.duranium; out.damageCleared = book.stationDamage[st.id] === undefined;
      t.advanceStationMissions(); out.paidTwice = s.latinum - cash;
      const rewards = book.missions.filter((m) => m.status === 'completed').reduce((n, m) => n + (m.reward || 0), 0);
      out.rewards = rewards;
      // expiry is bounded
      const m2 = t.offerStationMission('recon', here, true); t.Campaign.acceptMission(book, m2.id, s.day); t.advanceFleetCalendar(45, t.Fleet.nextId(t.fleetBook(), 'journey')); out.expired = book.missions.find((m) => m.id === m2.id).status;
      return out;
    });
    assert.deepEqual(r.active0, ['relief', 'evacuation', 'recon', 'repair']); assert.equal(r.farStill, 4);
    assert.ok(r.reliefDone); assert.equal(r.reliefTons, 1); assert.equal(r.reliefPaid, 4000);
    assert.equal(r.evacDone, 'completed'); assert.equal(r.reconDone, 'completed'); assert.equal(r.repairShort, 'active'); assert.equal(r.repairDone, 'completed'); assert.equal(r.duraniumLeft, 5); assert.ok(r.damageCleared);
    assert.equal(r.paidTwice, r.rewards); assert.equal(r.expired, 'expired');
  });

  assert.deepEqual(errors, []);
  console.log(`${checks.length} campaign gate groups passed; no page errors.`);
  await browser.close(); server.close();
})().catch((e) => { console.error(e); process.exit(1); });
