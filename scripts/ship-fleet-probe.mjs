#!/usr/bin/env node
// Real browser engine acceptance: the module is injected for inspection only, not replaced.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';
const rootArg = process.argv.indexOf('--root');
const root =
  rootArg >= 0
    ? path.resolve(process.argv[rootArg + 1])
    : path.resolve(fileURLToPath(new URL('../', import.meta.url)));
const shim = `window.__fleet={Fleet,state,startWithFaction,createNpcShip,ensureNpcCombatStats,ensureNpcPower,damageNpcShip,applyPlayerDamage,fireNpcWeapon,updateNpcShips,
 fleetBook,vesselDefaults,getScaledWeaponDamage,get WEAPON_CATALOG(){return WEAPON_CATALOG;},fleetServiceAllowed,captureShipPowerState,restoreFleetPower,applySystemState,saveGame,loadGame,playerWorldPosition,
 getPlayerEscortNpcShips,getPlayerFleetNpcShips,getPlayerEscortFleetShips,getShipStats,getOriginalShipWeaponSlots,getWeapon,
 startBoardingTarget,updateBoarding,canFleetDepart,physicalNpcId,beginAmbientTrafficArrival,advanceFleetCalendar,
 getCurrentPurchaseVendor,transferSystemControlToPlayer,openFleetPurchaseModal,renderFleetPurchaseModal,closeFleetPurchaseModal,getShipyardStock,fleetShipStock,fleetStockAvailable,buyEscortShip,buyFleetShip,buyEWModule,buySensorSuite,completeDueStationConstructions,syncPlayerBuiltStationDefinitions,repairHull,repairFleetVessel,sellFleetVessel,
 transferFleetCommand,renderFleetManager,refitFleetWeapon,orderFleetBuild,fleetBuildStationStatus,fleetPlanStatus,buyFleetPlan,
 buildPurchaseContext,getCurrentPurchaseVendor,isUnbalancedPrototype,getFactionStanding,adjustFactionStanding,getStationOwner,getShipPrice,completeFleetJourneys,fleetStationServices,tick,hojEmitterKey,sensorKey,sensorWorld,sensorAttackSnapshot,launchHoj,updateProjectiles,
 ensureActorEW,ensureActorSensors,ensurePlayerPower,updatePowerSystems,updateSensorSystems,applyVesselDisablement,
 fleetNpcWeapon,fleetFirePermitted,fleetFormationPoint,tickDisabledVessel,fireCounterfirePoint,refitFleetElectronics,transferFleetEquipment,ensureSecurityLedger,getSecurityLedger,getSecurityActiveOrders,remapFleetSecurity,parseStationData,resolveShipId,
 recoverDisabledPlayer,completeWormholeTransit,beginWarpTravel,completeWarpTravel,getPlottedRoute,canSeeDisabled,render,fleetTrafficCount,dispatchFleetFormation,
 getSystemIndexByName,getSaveSlotKey,upkeepPerDay,setCamera,freeze:()=>new Promise(resolve=>{requestAnimationFrame=cb=>{if(cb.name==='loop')resolve(true);return 0;};})};`;
const mime = {
  '.html': 'text/html',
  '.js': 'text/javascript',
  '.mjs': 'text/javascript',
  '.json': 'application/json',
  '.css': 'text/css',
  '.png': 'image/png',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
};
const lanOrigin = process.argv.includes('--lan');
const originHost = lanOrigin ? 'bm1-lan.test' : '127.0.0.1';
const server = http.createServer((req, res) => {
  const rel = decodeURIComponent((req.url || '/').split('?')[0]).replace(/^\/+/, '') || 'index.html';
  const file = path.resolve(root, rel);
  if (!file.startsWith(root + path.sep) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) {
    res.writeHead(404);
    res.end();
    return;
  }
  res.setHeader('Content-Type', mime[path.extname(file)] || 'application/octet-stream');
  res.setHeader('Cache-Control', 'no-store');
  if (rel === 'src/main.js') res.end(fs.readFileSync(file, 'utf8') + shim);
  else fs.createReadStream(file).pipe(res);
});
await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
let browser;
try {
  browser = await chromium.launch();
  const page = await browser.newPage({
      viewport: {
        width: 1280,
        height: 850,
      },
      hasTouch: true,
    }),
    errors = [];
  page.on('console', (msg) => {
    if (msg.text().startsWith('FLEET_')) console.log(msg.text());
  });
  page.on('pageerror', (e) => {
    errors.push(e.message);
    console.error('PAGE', e.message);
  });
  if (lanOrigin) {
    // Route only transport. The browser retains a real insecure HTTP origin;
    // neither secure-context status nor crypto APIs are overridden.
    await page.route(`http://${originHost}:*/**`, async route => {
      const response=await route.fetch({url:route.request().url().replace(originHost,'127.0.0.1')});
      await route.fulfill({response});
    });
  }
  await page.goto(`http://${originHost}:${server.address().port}/`);
  await page.waitForFunction(
    () => window.__fleet?.state.shipCatalog && window.__fleet.state.planets.length > 10,
  );
  console.log(
    'FLEET_ENV',
    JSON.stringify({
      cpu: os.cpus()[0]?.model,
      logicalCpus: os.cpus().length,
      browser: browser.version(),
      viewport: { width: 1280, height: 850 },
      ...(await page.evaluate(() => ({
        isSecureContext, randomUUID:typeof crypto.randomUUID, getRandomValues:typeof crypto.getRandomValues, origin:location.origin,
        hardwareConcurrency: navigator.hardwareConcurrency,
        userAgent: navigator.userAgent,
      }))),
    }),
  );
  const result = await page.evaluate(async () => {
    const B = window.__fleet,
      s = B.state,
      F = B.Fleet,
      checks = [];
    const test = (name, ok, detail) => checks.push({ name, ok: !!ok, ...(!ok ? { detail } : {}) });
    B.startWithFaction('terran');
    await B.freeze();
    const point = () => B.playerWorldPosition();
    const npc = (id = 'victim', shipId = 1) => {
      const p = point(),
        n = B.createNpcShip({ id, shipId, seed: 77, from: { x: p.x + 100, y: p.y }, faction: 'klingon' });
      B.ensureNpcCombatStats(n);
      B.ensureNpcPower(n);
      n.combatShields = 0;
      s.npcShips.push(n);
      return n;
    };
    const owned = (id, shipId = 1) => {
      const n = npc(id, shipId);
      n.fleetId = id;
      n.role = 'playerEscort';
      n.sideId = 'player';
      n.attitude = 'friendly';
      n.hostile = false;
      const f = { id, shipId, seed: n.seed, assignment: 'escort', systemIndex: s.currentPlanet, name: id };
      s.playerFleet.push(f);
      B.restoreFleetPower(n, f);
      return n;
    };
    const campaignId=B.fleetBook().campaignId;B.saveGame(1);B.loadGame(1);
    test('campaign identity survives save/load on this origin',B.fleetBook().campaignId===campaignId);
    const slotKey=B.getSaveSlotKey(1),saved=localStorage.getItem(slotKey),originalSet=Storage.prototype.setItem;
    Storage.prototype.setItem=function(k,v){if(k===slotKey)throw new DOMException('Full','QuotaExceededError');return originalSet.call(this,k,v);};
    let quota;try{quota=B.saveGame(1);}finally{Storage.prototype.setItem=originalSet;}
    test('quota failure reports and retains previous save',quota===false&&localStorage.getItem(slotKey)===saved&&s.log.startsWith('Save failed:'));
    localStorage.setItem('bm2_html_save',saved);localStorage.removeItem(slotKey);B.loadGame(1);
    test('legacy-only slot 1 can still load',B.fleetBook().campaignId===campaignId);B.saveGame(1);
    test('slot 1 stores one canonical payload',!!localStorage.getItem(slotKey)&&localStorage.getItem('bm2_html_save')===null);
    B.startWithFaction('terran');s.docked=true;s.latinum=100000;B.fleetBook().debt=1;
    test('EW arrears refusal explains without charging',!B.buyEWModule(1)&&s.log==='Settle fleet arrears before purchasing equipment.'&&s.latinum===100000);
    test('sensor arrears refusal explains without charging',!B.buySensorSuite(1)&&s.log==='Settle fleet arrears before purchasing equipment.'&&s.latinum===100000);
    B.startWithFaction('terran');s.npcShips=[];s.playerFleet=[];
    const zombie=npc('legacy-zero');zombie.combatHull=0;zombie.destroyed=false;zombie.lastDamageSource='player';s.combatTargetId=zombie.id;s.combatTargetType='ship';
    const zombieFunds=s.latinum;B.ensureNpcCombatStats(zombie);const zombiePaid=s.latinum;B.ensureNpcCombatStats(zombie);B.damageNpcShip(zombie,10);
    test('finite legacy zero resolves destruction and credit once',zombie.destroyed&&zombie.condition==='destroyed'&&zombie.combatHull===0&&s.combatTargetId===null&&zombiePaid>zombieFunds&&s.latinum===zombiePaid);
    const ownedZero=owned('owned-zero');ownedZero.combatHull=0;B.updateNpcShips(1);
    test('zero-hull owned actor retires fleet record before moving',ownedZero.destroyed&&s.playerFleet.find(f=>f.id===ownedZero.fleetId)?.destroyed);
    B.startWithFaction('terran');
    for(const name of ['Proxima Yard','Alpha Centauri','New Switzerland','Orilla','Andreas']){
      s.currentPlanet=B.getSystemIndexByName(name);s.myplanet=s.currentPlanet+1;s.dockedStationId=null;
      const listed=B.getShipyardStock(null).map(ship=>ship.id),authored=s.planets[s.currentPlanet].shipStockIds.map(B.resolveShipId);
      const context=B.buildPurchaseContext(B.getCurrentPurchaseVendor(null));
      const eligible=[...new Set(authored.filter(id=>{const ship=s.shipStatsById[id];return ship&&ship.assetType==='ship'&&B.getShipPrice(ship)>0&&!['retired','prototype'].includes(ship.rosterState)&&!B.isUnbalancedPrototype(ship)&&s.shipCatalog.eligibleForStock(id,context)&&(context.standingFaction==='neutral'||ship.faction==='neutral'||ship.faction===context.standingFaction);} ))];
      test(`${name} exposes complete eligible authored list`,JSON.stringify(listed)===JSON.stringify(eligible),{listed,eligible});
      console.log('FLEET_MARKET',JSON.stringify({name,authored:authored.length,eligible:eligible.length,offered:listed.length}));
    }
    B.startWithFaction('terran');s.npcShips=[];s.playerFleet=[];
    const origin=s.currentPlanet,destination=(origin+1)%s.planets.length,stationId='calendar-review-station';
    s.playerBuiltStations.push({...F.copy(s.stationDefinitions.find(st=>st.systemIndex===origin)),id:stationId,systemIndex:origin,builtByPlayer:true,underConstruction:true,constructionStartedDay:s.day,constructionDays:1});
    B.syncPlayerBuiltStationDefinitions();B.applySystemState(origin);B.beginWarpTravel(destination,B.getPlottedRoute(origin,destination));s.warp.travelDays=2;
    const actors=s.npcShips,stations=s.stations,departureDay=s.day;B.advanceFleetCalendar(2,s.warp.journeyId);
    test('calendar completion never rebuilds origin mid-warp',s.npcShips===actors&&s.stations===stations&&s.warp.active);
    test('construction completes on actual due day',s.playerBuiltStations.find(st=>st.id===stationId)?.completedDay===departureDay+1);
    B.completeWarpTravel();test('arrival reports completed stations once',s.currentPlanet===destination&&s.day===departureDay+2&&/1 station construction project completed/.test(s.log),{log:s.log});
    B.beginWarpTravel(origin,B.getPlottedRoute(destination,origin));B.completeWarpTravel();test('later arrival does not repeat completion notice',!/station construction project/.test(s.log));
    B.startWithFaction('terran');
    s.npcShips = [];
    s.playerFleet = [];
    s.latinum = 10000000;
    s.mylatinum = s.latinum;
    let n = npc();
    n.combatHull = F.disableThreshold(n.maxCombatHull) + 1;
    B.damageNpcShip(n, 2, 'npc');
    test('real damage disables living NPC', n.condition === 'disabled' && !n.destroyed);
    const before = { x: n.x, y: n.y, shots: s.projectiles.length, energy: n.power.energy };
    B.updateNpcShips(1);
    B.fireNpcWeapon(n, point(), 'player', performance.now() + 100000);
    test(
      'disabled NPC cannot move or fire',
      n.x === before.x && n.y === before.y && s.projectiles.length === before.shots,
    );
    B.beginAmbientTrafficArrival(n);
    test(
      'ambient replacement cannot overwrite disabled prize',
      n.id === 'victim' && n.condition === 'disabled',
    );
    B.saveGame(5);
    B.loadGame(5);
    n = s.npcShips.find((n) => n.id === 'victim');
    test('same-system save/load preserves unclaimed disabled incarnation', n?.condition === 'disabled');
    const oldId = B.physicalNpcId(n),
      oldHull = n.combatHull;
    B.setCamera(n.x - 100, n.y);
    s.spawnProtectionUntil = 0;
    test(
      'real boarding launch locks target and blocks warp',
      B.startBoardingTarget(n, false) && !B.canFleetDepart(),
    );
    B.fleetBook().boarding.roll = 0;
    B.updateBoarding(3);
    test('boarding enters committed phase', B.fleetBook().boarding?.phase === 'onboard');
    B.saveGame(5);
    B.loadGame(5);
    test(
      'boarding phase and roll survive reload',
      B.fleetBook().boarding?.phase === 'onboard' && B.fleetBook().boarding.roll === 0,
    );
    B.updateBoarding(12);
    n = s.npcShips.find((n) => n.physicalId === oldId);
    test(
      'capture preserves low hull and restores mobility',
      n?.fleetId && n.condition === 'operational' && n.prizeStabilized && n.combatHull === oldHull,
    );
    test(
      'capture has exactly one owned actor and record',
      s.playerFleet.length === 1 && s.npcShips.filter((x) => x.physicalId === oldId).length === 1,
    );
    n.weaponSlots = [null, null, null];
    n.weaponInventory = [];
    n.power.energy = 0;
    B.captureShipPowerState();
    const id = n.fleetId;
    const savedHull = n.combatHull;
    B.applySystemState(s.currentPlanet);
    n = s.npcShips.find((x) => x.fleetId === id);
    test(
      'rebuild preserves captured hull, empty loadout and zero energy',
      n.combatHull === savedHull && n.weaponSlots.every((x) => x === null) && n.power.energy === 0,
    );
    n.combatShields = 0;
    B.damageNpcShip(n, 1, 'npc');
    test('new damage can disable stabilized prize again', n.condition === 'disabled');
    n.combatHull = 0;
    n.condition = 'destroyed';
    n.destroyed = true;
    B.ensureNpcCombatStats(n);
    test('zero-hull stat initializer cannot revive wreck', n.combatHull === 0);
    s.playerFleet = [];
    s.npcShips = [];
    for (let i = 0; i < 20; i++) owned('owned' + i);
    B.captureShipPowerState();
    B.applySystemState(s.currentPlanet);
    test(
      '20 escorts restore without ownership cap',
      B.getPlayerEscortFleetShips().length === 20 && s.npcShips.filter((n) => n.fleetId).length === 20,
    );
    const testTrip = F.nextId(B.fleetBook(), 'journey');
    const accountBefore = s.latinum,
      day = s.day,
      total = s.playerFleet.reduce((v, f) => v + B.upkeepPerDay(f.shipId), 0);
    B.advanceFleetCalendar(5, testTrip);
    test(
      'all owned vessels billed original mass per day',
      s.day === day + 5 && s.latinum === accountBefore - 5 * total,
    );
    B.advanceFleetCalendar(5, testTrip);
    test('journey replay cannot bill twice', s.day === day + 5 && s.latinum === accountBefore - 5 * total);
    const wormholeDay = s.day,
      wormholeMoney = s.latinum;
    B.completeWormholeTransit((s.currentPlanet + 1) % s.planets.length, null, { silent: true });
    test(
      'wormhole advances neither calendar nor upkeep',
      s.day === wormholeDay && s.latinum === wormholeMoney,
    );
    s.npcShips = [];
    s.playerFleet = [];
    n = npc('retired');
    n.combatHull = 10;
    B.applyVesselDisablement(n);
    const system = s.currentPlanet;
    B.completeWormholeTransit((system + 1) % s.planets.length, null, { silent: true });
    B.completeWormholeTransit(system, null, { silent: true });
    test(
      'departed unclaimed disabled ship does not return',
      !s.npcShips.some((x) => x.id === 'retired' && x.condition === 'disabled'),
    );
    s.npcShips = [];
    s.playerFleet = [];
    n = owned('transfer');
    n.combatHull = n.maxCombatHull * 0.6;
    n.combatShields = 0;
    n.weaponSlots = [null, null, null];
    n.weaponInventory = [];
    n.power.energy = 17;
    n.cargoArray = [];
    n.crewSkill = 'elite';
    n.crewTemperament = 'aggressive';
    n.lastShotAt = performance.now();
    s.hull = 37;
    s.shields = 22;
    s.weaponSlots = [2, null, null];
    s.weaponInventory = [2];
    const oldShip = s.playership,
      oldPos = point(),
      destPos = { x: n.x, y: n.y },
      oldKey = B.sensorKey(s),
      destKey = B.sensorKey(n),
      oldHoj = B.hojEmitterKey(s),
      destHoj = B.hojEmitterKey(n);
    s.projectiles = [
      {
        owner: 'npc',
        targetType: 'player',
        targetId: null,
        attack: { key: destKey, side: 'player' },
        emitterKey: oldHoj,
        signal: { x: 1, y: 2 },
        signalAt: 3,
      },
      {
        owner: 'player',
        targetType: 'ship',
        targetId: n.id,
        attack: { key: oldKey, side: 'player' },
        emitterKey: destHoj,
      },
    ];
    B.ensureActorSensors(s).target = destKey;
    B.ensureActorSensors(n).target = oldKey;
    const historic = JSON.stringify(s.projectiles.map((p) => p.attack));
    test('command transfer succeeds with both physical snapshots', B.transferFleetCommand('transfer'));
    const former = s.npcShips.find((x) => x.fleetId);
    test(
      'transfer conserves hull in both unit systems',
      Math.abs(s.hull - 60) < 1e-9 && Math.abs((former.combatHull / former.maxCombatHull) * 100 - 37) < 1e-9,
    );
    test(
      'transfer preserves both loadouts and incoming energy',
      s.weaponSlots.every((x) => x === null) && former.weaponSlots[0] === 2 && s.power.energy === 17,
    );
    test(
      'crew stays with commanded hull',
      B.fleetBook().personal.crewSkill === 'elite' && former.crewSkill === 'regular',
    );
    test(
      'focused scan keys swap physical targets',
      s.sensors.target === B.sensorKey(former) && former.sensors.target === B.sensorKey(s),
    );
    test(
      'command transfer retains incoming shot cooldown',
      s.weaponLastFiredAt.some((t) => t > performance.now() - 100),
    );
    test(
      'incoming shots follow former personal vessel',
      s.projectiles[0].targetType === 'ship' &&
        s.projectiles[0].targetId === former.id &&
        s.projectiles[0].emitterKey === B.hojEmitterKey(former),
    );
    test(
      'shots at destination now target player representation',
      s.projectiles[1].targetType === 'player' && s.projectiles[1].emitterKey === B.hojEmitterKey(s),
    );
    test(
      'transfer does not rewrite launch attribution or refresh sample',
      JSON.stringify(s.projectiles.map((p) => p.attack)) === historic &&
        s.projectiles[0].signalAt === 3 &&
        s.projectiles[0].signal.x === 1,
    );
    // Resolve both ordinary paid shots at their physical targets, not just the binding strings.
    s.spawnProtectionUntil = 0;
    s.shields = 0;
    former.combatShields = 0;
    const oldHullBefore = former.combatHull,
      playerHullBefore = s.hull;
    s.projectiles.forEach((shot, i) =>
      Object.assign(shot, {
        x: i ? point().x : former.x,
        y: i ? point().y : former.y,
        vx: 0,
        vy: 0,
        born: performance.now(),
        ttl: 5000,
        damage: 1,
        kind: 'torpedo',
      }),
    );
    B.updateProjectiles(1);
    test(
      'both transferred ordinary projectiles apply to original physical targets',
      former.combatHull < oldHullBefore && s.hull < playerHullBefore && s.projectiles.length === 0,
    );
    s.projectiles = [];
    s.docked = true;
    s.dockedStationId = null;
    B.setCamera(former.x, former.y);
    former.power.combat = false;
    former.lastShieldHitAt = 0;
    const funds = s.latinum,
      quote = F.repairQuote(B.getShipStats(former.shipId).cost, former.combatHull, former.maxCombatHull);
    test(
      'real fleet repair uses paid hull-scaled service',
      B.repairFleetVessel(former.fleetId) && former.combatHull === former.maxCombatHull && s.latinum < funds,
    );
    test(
      'real sale removes vessel and cannot replay',
      B.sellFleetVessel(former.fleetId, false) && !B.sellFleetVessel(former.fleetId, false),
    );
    B.startWithFaction('terran');
    s.latinum = 10000000;
    s.mylatinum = s.latinum;
    s.docked = true;
    s.dockedStationId = null;
    const fundsBeforeRepair = s.latinum;
    s.hull = 80;
    s.shields = 60;
    const playerMax = B.vesselDefaults(s.playership).hull;
    const expectedHullCost = F.repairQuote(B.getShipPrice(B.getShipStats()), playerMax * 0.8, playerMax).amount;
    B.repairHull();
    test('personal combined repair charges scaled hull plus 1 L per shield percent',
      s.hull === 100 && s.shields === 100 && Math.abs(fundsBeforeRepair - s.latinum - expectedHullCost - 40) < 0.001,
      { hull: s.hull, shields: s.shields, spent: fundsBeforeRepair - s.latinum, expectedHullCost });
    s.shields = 75; s.latinum = 10;
    B.repairHull();
    test('personal repair with full hull still buys affordable shields', s.hull === 100 && s.shields === 85 && s.latinum === 0 && s.mylatinum === 0);
    B.repairHull();
    test('personal repair reports insufficient funds', s.log === 'Not enough latinum for repairs.' && s.shields === 85);
    s.shields = 100;
    B.repairHull();
    test('personal repair reports fully repaired vessel', s.log === 'Hull and shields already at 100%.');
    s.hull = 50; s.shields = 50; s.latinum = 10000000;
    s.gameOver = true; B.repairHull();
    test('personal repair cannot revive a game-over ship', s.hull === 50 && s.shields === 50 && s.latinum === 10000000);
    s.gameOver = false; s.gameStarted = false; B.repairHull();
    test('personal repair is inert before game starts', s.hull === 50 && s.shields === 50);
    s.gameStarted = true; s.docked = false; B.repairHull();
    test('personal repair requires docking', s.hull === 50 && s.shields === 50);
    s.docked = true; B.repairHull();
    s.latinum = 10000000; s.mylatinum = s.latinum;
    const offer = B.getShipyardStock()[0];
    if (offer) {
      B.openFleetPurchaseModal(offer.id);
      test(
        'fleet purchase modal renders without removed cap references',
        !!document.querySelector('[data-fleet-purchase-action]') || !!s.pendingFleetPurchase,
      );
      B.closeFleetPurchaseModal();
      const stock = B.fleetShipStock(offer.id);
      stock.quantity = 1;
      B.adjustFactionStanding(B.getCurrentPurchaseVendor().standingFaction, 100, { silent: true });
      const prior = s.playerFleet.length;
      B.buyEscortShip(offer.id);
      B.buyEscortShip(offer.id);
      test(
        'purchase consumes shared last unit exactly once',
        s.playerFleet.length === prior + 1 && stock.quantity === 0,
        { offer: offer.id, count: s.playerFleet.length, log: s.log },
      );
    } else test('planet has an authored or fallback offer', false);
    test(
      'Earth ambient traffic is busier than Paso',
      B.fleetTrafficCount(B.getSystemIndexByName('Earth'), []) >
        B.fleetTrafficCount(B.getSystemIndexByName('Paso'), []),
    );
    const parsed = B.parseStationData({
      stations: [
        { id: 'mixed', systemIndex: 4, stationTypeId: 101, name: 'Mixed', stock: { rawIds: [12, 106] } },
        {
          id: 'modern',
          systemIndex: 4,
          stationTypeId: 101,
          name: 'Modern',
          stock: { shipIds: [347], weaponIds: [46] },
        },
      ],
    });
    test(
      'stock decoder keeps mixed legacy and high modern hull IDs separate',
      parsed[0]?.stockIds.includes(12) &&
        parsed[0]?.weaponStockIds.includes(1) &&
        parsed[1]?.stockIds.includes(347) &&
        parsed[1]?.weaponStockIds.includes(46),
      parsed,
    );
    const original = s.currentPlanet;
    for (const name of ['Paso', 'New Switzerland', 'Vulcan']) {
      s.currentPlanet = B.getSystemIndexByName(name);
      s.myplanet = s.currentPlanet + 1;
      s.dockedStationId = null;
      const st = s.stationDefinitions.find(
        (st) => st.systemIndex === s.currentPlanet && st.stockIds?.length && B.fleetStationServices(st).sell,
      );
      const raw = st?.stockIds?.[0] || s.planets[s.currentPlanet].shipStockIds?.[0];
      const stock = raw ? B.fleetShipStock(raw) : null;
      test(`${name} authored market has positive system supply`, stock?.quantity > 0, { raw, stock });
      if (name === 'Paso') {
        const xbase = s.stationDefinitions.find(st => st.systemIndex === s.currentPlanet && st.name === 'X-Base');
        const ids = xbase ? B.getShipyardStock(xbase).map(ship => ship.id) : [];
        test('Paso X-Base preserves exactly its curated hull list despite system pool union',
          JSON.stringify(ids) === JSON.stringify([49, 347]), { ids, station: xbase?.name });
      }
    }
    s.currentPlanet = original;
    s.myplanet = original + 1;
    const auth = { stationTypeId: 101, stockIds: [347], services: { shipSales: false } };
    test('service-filtered authored stock stays empty', B.getShipyardStock(auth).length === 0);
    test(
      'all 101 traffic profiles retain source rows',
      s.fleetTrafficProfiles.length === 101 &&
        s.fleetTrafficProfiles.every((p, i) => p.systemIndex === i && p.source && p.rationale),
    );
    // Explicitly acquire this test holding: faction membership no longer grants ownership.
    B.startWithFaction('terran');
    B.transferSystemControlToPlayer(s.currentPlanet);
    s.latinum = 100000000;
    s.mylatinum = s.latinum;
    s.duranium = 100000;
    const yard = s.stations.find(
      (st) =>
        !st.destroyed &&
        !st.underConstruction &&
        B.getStationOwner(st) === 'player' &&
        B.fleetStationServices(st).build &&
        B.getShipyardStock(st).length,
    );
    test('owned shipbuilding service fixture exists', !!yard);
    if (yard) {
      s.docked = true;
      s.dockedStationId = yard.id;
      B.setCamera(yard.x, yard.y);
      const hull = B.getShipyardStock(yard)[0];
      B.adjustFactionStanding(B.getCurrentPurchaseVendor().standingFaction, 100, { silent: true });
      const funds = s.latinum,
        plan = B.fleetPlanStatus(hull.id);
      test(
        'real plan quote charges four times canonical price',
        plan.price === 4 * B.getShipPrice(hull) &&
          B.buyFleetPlan(hull.id) &&
          funds - s.latinum === plan.price,
      );
      test('plan purchase cannot replay', !B.buyFleetPlan(hull.id));
      const money = s.latinum,
        ore = s.duranium;
      test(
        'ship construction consumes both inputs',
        B.orderFleetBuild(hull.id, false) && s.latinum < money && s.duranium < ore,
      );
      const order = B.fleetBook().orders.at(-1),
        recipe = order.recipe;
      B.advanceFleetCalendar(recipe.days, F.nextId(B.fleetBook(), 'journey'));
      const built = s.playerFleet.find((f) => f.id === order.id + ':vessel');
      test(
        'calendar delivers one equipped physical ship',
        order.status === 'delivered' &&
          !!built &&
          JSON.stringify(built.vessel.weaponSlots) === JSON.stringify(B.getOriginalShipWeaponSlots(hull.id)),
      );
      const count = s.playerFleet.length;
      B.advanceFleetCalendar(1, F.nextId(B.fleetBook(), 'journey'));
      test('delivered build cannot duplicate', s.playerFleet.length === count);
      const actor = s.npcShips.find((n) => n.fleetId === built.id);
      actor.x = yard.x + 70;
      actor.y = yard.y;
      actor.power.combat = false;
      actor.lastShieldHitAt = 0;
      const available = actor.weaponInventory[0];
      if (available) {
        test(
          'fleet slot removal keeps inventory once',
          B.refitFleetWeapon(actor.fleetId, 0, 0) && actor.weaponInventory.includes(available),
        );
        test(
          'fleet reinstall consumes existing ownership, no duplicate',
          B.refitFleetWeapon(actor.fleetId, 0, available) &&
            actor.weaponInventory.filter((w) => w === available).length ===
              B.getOriginalShipWeaponSlots(hull.id).filter((w) => w === available).length,
        );
      }
      const receiver = owned('refit-recipient', actor.shipId);
      receiver.x = yard.x + 90;
      receiver.y = yard.y;
      receiver.power.combat = false;
      receiver.lastShieldHitAt = 0;
      if (available) {
        B.refitFleetWeapon(actor.fleetId, 0, 0);
        const beforeA = actor.weaponInventory.length,
          beforeB = receiver.weaponInventory.length;
        test(
          'loose weapon transfers once between two ship inventories',
          B.transferFleetEquipment(actor.fleetId, receiver.fleetId, 'weapon', available) &&
            actor.weaponInventory.length === beforeA - 1 &&
            receiver.weaponInventory.length === beforeB + 1,
        );
        test(
          'installed-only weapon cannot be duplicated by transfer',
          !B.transferFleetEquipment(actor.fleetId, receiver.fleetId, 'weapon', available),
        );
      }
      B.ensureActorEW(actor).module = 1;
      test(
        'jammer removal preserves one physical item',
        B.refitFleetElectronics(actor.fleetId, 'jammer', 0) &&
          actor.ew.module === null &&
          actor.jammerInventory.length === 1,
      );
      test(
        'jammer moves and installs at recipient without free copy',
        B.transferFleetEquipment(actor.fleetId, receiver.fleetId, 'jammer', 1) &&
          B.refitFleetElectronics(receiver.fleetId, 'jammer', 1) &&
          actor.jammerInventory.length === 0 &&
          receiver.ew.module === 1 &&
          receiver.jammerInventory.length === 0,
      );
      actor.combatHull = actor.maxCombatHull * 0.1;
      s.latinum = 10;
      const low = actor.combatHull;
      test(
        'partial repair buys only affordable hull fraction',
        B.repairFleetVessel(actor.fleetId) &&
          actor.combatHull > low &&
          actor.combatHull < actor.maxCombatHull &&
          s.latinum >= 0,
        {
          latinum: s.latinum,
          hull: actor.combatHull,
          low,
          max: actor.maxCombatHull,
          service: B.fleetServiceAllowed(actor),
          docked: s.docked,
          log: s.log,
        },
      );
    }
    B.startWithFaction('terran');
    s.npcShips = [];
    s.playerFleet = [];
    owned('travel-owner');
    s.latinum = 100000;
    s.mylatinum = s.latinum;
    const beforeDay = s.day,
      beforeMoney = s.latinum,
      next = (s.currentPlanet + 1) % s.planets.length,
      route = B.getPlottedRoute(s.currentPlanet, next);
    B.beginWarpTravel(next, route);
    const journey = F.copy(s.warp);
    B.saveGame(5);
    B.loadGame(5);
    test(
      'in-flight save retains quoted duration and journey identity',
      s.warp.active && s.warp.journeyId === journey.journeyId && s.warp.travelDays === journey.travelDays,
    );
    B.completeWarpTravel();
    const settled = s.day,
      afterMoney = s.latinum;
    B.completeWarpTravel();
    test(
      'resumed jump settles once at its quoted duration',
      settled === beforeDay + journey.travelDays &&
        s.day === settled &&
        s.latinum === afterMoney &&
        B.fleetBook().ledger.filter((e) => e.kind === 'upkeep').length === journey.travelDays,
    );
    // A save must not recall an already-paid projectile or reroll its private sample.
    s.npcShips = [];
    s.playerFleet = [];
    s.projectiles = [];
    s.docked = false;
    n = npc('save-shot');
    const p0 = point();
    s.projectiles = [
      {
        owner: 'player',
        targetType: 'ship',
        targetId: n.id,
        attack: B.sensorAttackSnapshot(s),
        kind: 'torpedo',
        x: p0.x,
        y: p0.y,
        heading: 0,
        vx: 0,
        vy: -10,
        speed: 10,
        damage: 20,
        weaponId: 46,
        ttl: 5000,
        born: performance.now(),
        emitterKey: B.hojEmitterKey(n),
        signal: { x: n.x, y: n.y },
        signalAt: 0.2,
        sampleDue: 0.4,
        elapsed: 0.3,
        remaining: 1000,
        lifeRemaining: 3,
      },
    ];
    B.saveGame(5);
    B.loadGame(5);
    test(
      'same-system save keeps paid projectile and sample age',
      s.projectiles.length === 1 &&
        s.projectiles[0].signalAt === 0.2 &&
        s.projectiles[0].sampleDue === 0.4 &&
        s.projectiles[0].targetId === 'save-shot',
    );
    s.projectiles = [];
    s.shields = 0;
    s.hull = 11;
    B.applyPlayerDamage(1);
    test(
      'player enters disabled using canonical hull conversion',
      B.fleetBook().personalCondition === 'disabled',
    );
    s.latinum = 0;
    const debt = B.fleetBook().debt;
    document.querySelector('[data-fleet-action="rescue"]')?.click();
    // Direct recovery is exposed in the fixture below; its charge uses the same book.
    B.recoverDisabledPlayer();
    test(
      'disabled recovery uses one debt book',
      s.hull >= 20 && B.fleetBook().debt > debt && s.recoveryAt > performance.now(),
    );
    const rescueDebt = B.fleetBook().debt;
    B.saveGame(5);
    B.loadGame(5);
    test(
      'recovery countdown survives save without second charge',
      s.recoveryAt > performance.now() && !B.recoverDisabledPlayer() && B.fleetBook().debt === rescueDebt,
    );
    B.tickDisabledVessel(null, s.recoveryAt + 1);
    test(
      'paid personal recovery becomes operational at 20 percent',
      B.fleetBook().personalCondition === 'operational' && s.hull === 20,
    );
    B.startWithFaction('terran');
    s.npcShips = [];
    s.playerFleet = [];
    s.projectiles = [];
    const fire = owned('controlled'),
      enemy = npc('controlled-target');
    fire.intent = 'disable';
    s.playerFleet.find((f) => f.id === fire.fleetId).intent = 'disable';
    fire.crewSkill = 'inexperienced';
    enemy.combatHull = 10;
    B.applyVesselDisablement(enemy);
    B.updateSensorSystems(12);
    const now = performance.now();
    test(
      'controlled fire holds on visually disabled target',
      B.canSeeDisabled(fire, enemy) && !B.fleetFirePermitted(fire, enemy, 'ship', now),
    );
    enemy.condition = 'operational';
    fire.disableDecisionAt = 0;
    B.fleetFirePermitted(fire, enemy, 'ship', now);
    const decisionAt = fire.disableDecisionAt;
    test('crew reaction interval uses actual inexperienced class', decisionAt === now + 1000);
    fire.weaponSlots = [1, 2, 3];
    fire.controlledFire = true;
    fire.fleetShotIndex = 2;
    const expected = fire.weaponSlots
      .slice()
      .sort((a, b) => B.getWeapon(a).damage - B.getWeapon(b).damage)[0];
    test(
      'critical assessment picks weakest weapon despite cycling index',
      B.fleetNpcWeapon(fire) === expected,
    );
    const g = F.addFormation(B.fleetBook(), 'Hold fixture');
    F.assignFormation(B.fleetBook(), fire.fleetId, g.id);
    g.order = 'hold';
    const pos = { x: fire.x, y: fire.y };
    B.updateNpcShips(1);
    test(
      'hold order prevents movement and fire',
      fire.x === pos.x && fire.y === pos.y && !B.fleetFirePermitted(fire, enemy, 'ship', now + 2000),
    );
    const deputy = owned('deputy');
    F.assignFormation(B.fleetBook(), deputy.fleetId, g.id);
    fire.condition = 'disabled';
    g.order = 'follow';
    B.fleetFormationPoint(deputy, now);
    test('disabled flagship yields command to operational deputy', g.flagship === deputy.fleetId);
    const ledger = B.ensureSecurityLedger(s.currentPlanet);
    ledger.orders = {
      a: { id: 'a', visitorKind: 'player', visitorInstanceId: 'player', kind: 'challenge' },
      b: { id: 'b', visitorKind: 'npc', visitorInstanceId: deputy.securityInstanceId, kind: 'withdraw' },
    };
    ledger.visitors = { player: { episode: 2 }, [deputy.securityInstanceId]: { episode: 4 } };
    B.remapFleetSecurity(deputy, fire);
    test(
      'active checkpoint instructions remap in both physical directions',
      ledger.orders.a.visitorKind === 'npc' &&
        ledger.orders.a.visitorInstanceId === fire.securityInstanceId &&
        ledger.orders.b.visitorKind === 'player' &&
        ledger.visitors[fire.securityInstanceId].episode === 2 &&
        ledger.visitors.player.episode === 4,
    );
    B.startWithFaction('terran');
    s.npcShips = [];
    s.playerFleet = [];
    s.projectiles = [];
    for (let i = 0; i < 36; i++) owned('formation' + i);
    B.renderFleetManager(true);
    test(
      '36 owned vessels form multiple bounded command groups',
      B.fleetBook().formations.length === 3 &&
        B.fleetBook().formations.every((g) => g.members.length <= 12) &&
        s.playerFleet.length === 36,
    );
    const timings = [];
    for (let i = 0; i < 330; i++) {
      const t = performance.now();
      B.updatePowerSystems(12);
      B.updateSensorSystems(12);
      const electronicsEnd = performance.now();
      B.updateNpcShips(1);
      const aiEnd = performance.now();
      B.updateProjectiles(1);
      const end = performance.now();
      if (i >= 30)
        timings.push({
          total: end - t,
          electronics: electronicsEnd - t,
          ai: aiEnd - electronicsEnd,
          projectiles: end - aiEnd,
        });
    }
    const sorted = timings.map((x) => x.total).sort((a, b) => a - b);
    console.log(
      'FLEET_SCALE_36',
      JSON.stringify({
        p95: sorted[285],
        p99: sorted[297],
        samples: 300,
        warmup: 30,
        host: 'supplementary',
        acceptanceEligible: false,
        boundary:
          'power(12),sensors(12),NPC(1),projectiles(1); packed synthetic stress, not the EW cadence harness',
        raw: timings,
      }),
    );
    B.renderFleetManager(true);
    B.render();
    test('fleet manager renders real controls', !!document.querySelector('[data-fleet-action="board"]'));
    return checks;
  });
  if (process.argv.includes('--balance')) {
    const balance = await page.evaluate(() => {
      const B = window.__fleet,
        F = B.Fleet,
        attacker = B.state.playership;
      const weapons = B.WEAPON_CATALOG.filter((w) => w.damage > 0 && w.type !== 'Device');
      const hulls = Object.values(B.state.shipStatsById).filter(
        (h) => h.assetType === 'ship' && h.rosterState === 'active',
      );
      const variants = [
        { name: 'candidate32', floor: 32, ceiling: 0.25 },
        { name: 'floor66Guard25', floor: 66, ceiling: 0.25 },
        { name: 'floor66NoGuard', floor: 66, ceiling: 1 },
      ];
      const disable = [];
      for (const hull of hulls)
        for (const weapon of weapons)
          for (const variant of variants) {
            const max = B.vesselDefaults(hull.id).hull,
              threshold = Math.min(max * variant.ceiling, Math.max(0.1 * max, variant.floor));
            const damage = B.getScaledWeaponDamage(attacker, weapon, weapon.damage, 1, null);
            const hits = Math.max(1, Math.ceil((max - threshold) / damage)),
              remaining = max - hits * damage;
            disable.push({
              hullId: hull.id,
              weaponId: weapon.id,
              variant: variant.name,
              max,
              threshold,
              damage,
              hits,
              remaining,
              disabled: remaining > 0,
              survivesNextPaidHit: remaining > damage,
            });
          }
      const economy = hulls.map((h) => {
        const max = B.vesselDefaults(h.id).hull,
          price = B.getShipPrice(h),
          damageHull = 0.1 * max,
          repair = F.repairQuote(price, damageHull, max).amount,
          sale = F.saleQuote(price, damageHull, max),
          repairedSale = F.saleQuote(price, max, max),
          build = F.buildRecipe(price, h.mass);
        return {
          hullId: h.id,
          name: h.name,
          price,
          upkeepPerDay: B.upkeepPerDay(h.id),
          disabledHull: damageHull,
          repair,
          damagedSale: sale,
          repairedSale,
          repairThenSaleNet: repairedSale - repair,
          buildThenSaleNet: repairedSale - build.latinum,
          buildDuranium: build.duranium,
          singleAttemptAt15Percent:
            0.15 * (sale - 10 * B.upkeepPerDay(h.id)) - 0.85 * F.FLEET_RULES.recruitCost,
        };
      });
      return {
        version: 1,
        attacker: { id: attacker, name: B.getShipStats(attacker).name },
        assumptions: [
          'Actual runtime hull maxima and weapon damage helper; unallocated weapon-power factor and owner scale 1.',
          'Shields start at zero; deterministic full-hull descent, one weapon at a time; no crew timing or simultaneous other shooters.',
          'This table is not a probability estimate or a performance gate. Floor alternatives are measurements only.',
          'Economy: 10% hull, ten upkeep days after success, 15% illustrative chance, replacement on failure; XP, standing, time and duranium value are not converted to latinum.',
        ],
        variants,
        disable,
        economy,
      };
    });
    const outputIndex = process.argv.indexOf('--balance-output'),
      file =
        outputIndex >= 0
          ? path.resolve(process.argv[outputIndex + 1])
          : path.join(root, 'tmp-fleet-balance.json');
    fs.writeFileSync(file, JSON.stringify(balance, null, 2) + '\n');
    console.log(
      `Balance report: ${file} (${balance.disable.length} damage rows, ${balance.economy.length} economy rows)`,
    );
  }
  if (process.argv.includes('--screenshot'))
    await page.screenshot({ path: path.join(root, 'tmp-fleet-manager.png'), fullPage: true });
  for (const c of result)
    console.log(`${c.ok ? 'PASS' : 'FAIL'} ${c.name}${c.detail ? ' ' + JSON.stringify(c.detail) : ''}`);
  if (errors.length) console.log('BROWSER ERRORS', JSON.stringify(errors));
  console.log(`${result.filter((c) => c.ok).length}/${result.length} live fleet checks passed`);
  process.exitCode = result.every((c) => c.ok) && !errors.length ? 0 : 1;
} finally {
  await browser?.close();
  await new Promise((resolve) => server.close(resolve));
}
