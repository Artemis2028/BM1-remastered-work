#!/usr/bin/env node
 // Real browser engine acceptance: the module is injected for inspection only, not replaced.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import {
  fileURLToPath
} from 'node:url';
import {
  chromium
} from 'playwright';
const root = path.resolve(process.env.BM1_TEST_ROOT || fileURLToPath(new URL('../', import.meta.url)));
const shim =
  `
// Authored foreign access variants are test fixtures; all classification/order code stays real.
const probeOriginalZone=getSecurityZone;let probeForeignAccess=null;
getSecurityZone=function(...args){const z=probeOriginalZone(...args);if(z?.foreign&&probeForeignAccess){z.access={...z.access,...probeForeignAccess};z.accessSignature=JSON.stringify(z.access);}return z;};
window.__power={state,startWithFaction,applyCurrentShipStats,getShipStats,getWeapon,getDefaultWeaponId,
 ensureActorSensors,ensurePlayerPower,ensureNpcPower,getActorPowerProfile,createNpcShip,ensureNpcCombatStats,playerWorldPosition,
 sensorWorld,sensorKey,sensorCanTrack,sensorContact,sensorCheckpointTrack,sensorCheckpointBroadcast,sensorSnapshotActor,
 updatePowerSystems,updateSensorSystems,startSensorAction,getSensorUpgradeDecision,buySensorSuite,renderPowerPanel,renderTopLeftPanel,render,
 getSecurityZone,getSecurityAnchorCandidates,setPlayerCheckpoint,setSecurityPolicyOverride,getVisitorAccessDecision,getSecurityContact,
 resetSecurityRecords,updateSecurityEncounters,getSecurityLedger,respondToSecurityOrder,getSecurityDockingBlock,transferSystemControlToFaction,
 transferSystemControlToPlayer,getSystemIndexByName,applySystemState,fireCounterfirePoint,getCounterfireCue,recordSensorHit,sensorAttackSnapshot,
 updateProjectiles,fireNpcWeapon,fireStationWeapon,firePlayerWeapon,saveGame,loadGame,getSaveSlotKey,setPowerDist,
 getScaledWeaponDamage,getWeaponEnergyCost,getFactionStanding,setPlayerCloak,getPlayerEscortPriorityTarget,
 setForeignProbeAccess:value=>{probeForeignAccess=value;},setCamera,resolveSecurityPoint,getPlayerSecurityOrder,
 getPlayerEscortNpcShips,restoreFleetPower,snapshotActorSensors,sensorCrewEstimate,updateNpcShips,updateStationDefenses,
 getSelectedCombatTarget,cycleCombatTarget,renderSecurityPanelMarkup,renderTargetWindow:updateTargetWindow,
 setFleetStance:()=>{state.fleetStance='attack';},sensorPursuitPoint,beginAmbientTrafficArrival,playerContactLabel,
 freeze:()=>new Promise(resolve=>{const t=setTimeout(()=>resolve(false),3000);requestAnimationFrame=cb=>{if(cb.name==='loop'){clearTimeout(t);resolve(true);}return 0;};})};`;
const mime = {
  '.html': 'text/html',
  '.js': 'text/javascript',
  '.mjs': 'text/javascript',
  '.json': 'application/json',
  '.css': 'text/css',
  '.png': 'image/png',
  '.gif': 'image/gif',
  '.webp': 'image/webp'
};
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
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
let browser;
try {
  browser = await chromium.launch();
  const page = await browser.newPage({
      viewport: {
        width: 1280,
        height: 850
      },
      hasTouch: true
    }),
    errors = [];
  page.on('pageerror', e => {
    errors.push(e.message);
    console.error('PAGE', e.message);
  });
  await page.goto(`http://127.0.0.1:${server.address().port}/`);
  await page.waitForFunction(() => window.__power?.state.shipCatalog && window.__power.state.planets.length > 10);
  const result = await page.evaluate(async () => {
    const B = window.__power,
      s = B.state,
      checks = [];
    const test = (name, ok, detail) => checks.push({
      name,
      ok: !!ok,
      ...(!ok ? {
        detail
      } : {})
    });
    B.startWithFaction('terran');
    test('real engine main loop freezes', await B.freeze());
    const home = s.currentPlanet;
    s.activeFleetAttack = null;
    s.spawnProtectionUntil = 0;
    s.npcShips = [];
    s.projectiles = [];
    const at = B.playerWorldPosition();
    const spawn = (id, x, opts = {}) => {
      const n = B.createNpcShip({
        id,
        shipId: 1,
        faction: 'ferengi',
        role: 'traffic',
        seed: id,
        from: {
          x: at.x + x,
          y: at.y
        },
        ...opts
      });
      B.ensureNpcCombatStats(n);
      B.ensureNpcPower(n);
      s.npcShips.push(n);
      return n;
    };
    const step = (count = 12) => {
      for (let i = 0; i < count; i++) {
        B.updatePowerSystems(6);
        B.updateSensorSystems(6);
      }
    };
    const reset = () => {
      s.npcShips = [];
      s.projectiles = [];
      B.sensorWorld.clear(s.currentPlanet);
      s.sensors = null;
      s.power.dist = {
        engines: 5,
        weapons: 5,
        shields: 5,
        sensors: 5
      };
      s.power.energy = B.getActorPowerProfile().energyCapacity;
    };
    const ships = Object.values(s.shipStatsById).filter(x => x.assetType === 'ship' && x.rosterState ===
      'active');
    test('all 172 native sensor profiles reach runtime', ships.length === 172 && ships.every(x => x.sensorProfile
      ?.sensitivity > 0));
    s.power.dist = {
      engines: 5,
      weapons: 5,
      shields: 5,
      sensors: 0
    };
    const near = spawn(9601, 400, {
      faction: 'pirate'
    });
    step();
    test('dark on-screen contact is visible with sensors offline', B.sensorCanTrack(s, near));
    const far = spawn(9602, 2200);
    step();
    const c = B.sensorContact(s, far);
    test('radio-only declaration at zero sensors has no firing track', c?.declaration === 'ferengi' && !B
      .sensorCanTrack(s, far), c);
    s.autoTarget = false;
    s.combatTargetId = far.id;
    s.combatTargetType = 'ship';
    s.weaponLastFiredAt = [-1e9, -1e9, -1e9];
    const oldEnergy = s.power.energy;
    B.firePlayerWeapon(1);
    test('radio-only contact cannot be fired on', s.power.energy === oldEnergy && !s.projectiles.length);
    B.ensureActorSensors(far).transponder = false;
    step(32);
    test('declaration expires without sensor reidentification', B.sensorWorld.now - c.declaredAt > 3);
    reset();
    const sensingStations = s.stations;
    s.stations = [];
    const hidden = spawn(9603, 1300, {
      faction: 'pirate'
    });
    B.ensureActorSensors().suite = 0;
    step();
    test('dark contact outside nominal passive reach is untracked', !B.sensorCanTrack(s, hidden));
    hidden.weaponSlots = [1, 15, null];
    const before = s.power.energy;
    B.startSensorAction('sweep');
    step(3);
    test('funded sweep acquires a previously unseen contact and spends power', B.sensorCanTrack(s, hidden) && B
      .ensureActorSensors().emitting && s.power.telemetry.sensors > 0, {
        before,
        after: s.power.energy
      });
    s.combatTargetId = hidden.id;
    s.combatTargetType = 'ship';
    B.startSensorAction('focus');
    step(95);
    const report = B.sensorContact(s, hidden)?.report;
    test('focused scan builds actual equipment assessment with unknown cargo/crew', JSON.stringify(report
        ?.weapons) === JSON.stringify([B.getWeapon(1).name, B.getWeapon(15).name]) && report.cargo ===
      'Cargo manifest unavailable' && report.crew.startsWith('Unknown'), report);
    s.power.dist = {
      engines: 0,
      weapons: 0,
      shields: 0,
      sensors: 10
    };
    s.power.energy = 0;
    const eq = B.ensureActorSensors();
    eq.mode = 'focus';
    eq.progress = 0;
    // Demand exceeds fresh generation when using this authored high-draw profile.
    const stats = B.getShipStats(s.playership),
      prev = stats.powerProfile.reactorOutput;
    stats.powerProfile.reactorOutput = 1;
    eq.suite = 3;
    step(2);
    test('underfunded active scan pauses rather than transmitting for free', !eq.emitting && eq.progress === 0, {
      funded: eq.funded,
      progress: eq.progress
    });
    stats.powerProfile.reactorOutput = prev;
    s.stations = sensingStations;
    reset();
    s.docked = true;
    s.dockedStationId = null;
    s.latinum = 100000;
    s.factionStanding.terran = 29;
    test('Survey upgrade is denied below economy standing 30', !B.getSensorUpgradeDecision(2).canBuy);
    s.factionStanding.terran = 30;
    const money = s.latinum;
    const bought = B.buySensorSuite(2);
    test('Survey upgrade uses shared tier and charges once', bought && s.latinum === money - 22000 && !B
      .buySensorSuite(2));
    s.docked = false;
    for (const [tier, gate] of [
        [1, 15],
        [2, 30],
        [3, 75]
      ]) {
      B.ensureActorSensors().suite = 0;
      s.docked = true;
      s.factionStanding.terran = gate - 1;
      const denied = !B.getSensorUpgradeDecision(tier).canBuy;
      s.factionStanding.terran = gate;
      test(`suite ${tier} enforces faction standing ${gate}`, denied && B.getSensorUpgradeDecision(tier).canBuy);
    }
    B.ensureActorSensors().suite = 2;
    s.docked = false;
    B.startSensorAction('toggle');
    const off = !B.ensureActorSensors().transponder;
    B.saveGame(6);
    B.loadGame(6);
    test('suite and transponder selection persist through save/load', off && B.ensureActorSensors().suite === 2 &&
      !B.ensureActorSensors().transponder);
    const key = B.getSaveSlotKey(6),
      raw = JSON.parse(localStorage.getItem(key));
    delete raw.sensorVersion;
    delete raw.sensors;
    delete raw.sensorReports;
    raw.power.dist = {
      reserve: 10,
      engines: 10,
      weapons: 10,
      shields: 0
    };
    raw.power.energy = 0;
    localStorage.setItem(key, JSON.stringify(raw));
    B.loadGame(6);
    test('actual pre-sensor save migrates deterministically without charge refill', s.power.dist.sensors === 5 &&
      s.power.dist.engines === 8 && s.power.dist.weapons === 7 && s.power.energy === 0 && B.ensureActorSensors()
      .suite === 0, s.power);
    reset();
    s.docked = true;
    s.factionStanding.terran = 100;
    s.latinum = 100000;
    const owned = spawn(9607, 100, {
      role: 'playerEscort',
      fleetId: 'sensor-refit-fleet',
      faction: 'terran',
      crewSkill: 'veteran'
    });
    s.playerFleet.push({
      id: owned.fleetId,
      shipId: owned.shipId,
      assignment: 'escort',
      name: 'Sensor test escort'
    });
    const ownBefore = s.latinum;
    test('locally commanded fleet ship can refit independently', B.buySensorSuite(1, owned) && B
      .ensureActorSensors(owned).suite === 1 && B.ensureActorSensors().suite === 0 && s.latinum === ownBefore -
      8000);
    const fitRecord = s.playerFleet.find(f => f.id === owned.fleetId);
    const restored = spawn(9608, 200, {
      role: 'playerEscort',
      fleetId: owned.fleetId,
      faction: 'terran'
    });
    B.restoreFleetPower(restored, fitRecord);
    test('fleet restoration preserves own suite and exact crew', B.ensureActorSensors(restored).suite === 1 &&
      restored.crewSkill === 'veteran');
    test('foreign visitor cannot consume a fleet refit', !B.getSensorUpgradeDecision(1, spawn(9609, 200)).canBuy);
    s.playerFleet = s.playerFleet.filter(f => f.id !== owned.fleetId);
    s.docked = false;
    reset();
    B.resetSecurityRecords();
    B.transferSystemControlToPlayer(home);
    const anchor = B.getSecurityAnchorCandidates(home, 'player')[0];
    test('checkpoint issuer fixture exists', !!anchor);
    B.setPlayerCheckpoint(home, {
      enabled: true,
      anchorStationId: anchor.id
    });
    B.setSecurityPolicyOverride(home, {
      access: {
        unknown: 'closed'
      }
    });
    let zone = B.getSecurityZone();
    const dark = spawn(9610, 0, {
      faction: 'pirate'
    });
    dark.hostile = false;
    dark.attitude = 'neutral';
    dark.x = zone.centre.x + 100;
    dark.y = zone.centre.y;
    const decision = B.getVisitorAccessDecision(zone, B.getSecurityContact(dark));
    test('Unknown is physically trackable and enforceable under Closed', B.sensorCheckpointTrack(dark, zone) &&
      decision.class === 'unknown' && decision.enforceable && decision.decision === 'closed', decision);
    B.updateSecurityEncounters(1);
    const orders = Object.values(B.getSecurityLedger(home).orders);
    test('closed dark visitor gets a real withdrawal order', orders.some(o => o.visitorInstanceId === dark
      .securityInstanceId && o.kind === 'withdraw'), orders);
    B.ensureActorSensors().transponder = false;
    test('own-side exemption survives player dark mode', B.getVisitorAccessDecision(zone, B.getSecurityContact(
      'player')).class === 'exempt');
    const allCheckpointStations = s.stations;
    const originalAnchor = {
      x: anchor.x,
      y: anchor.y
    };
    s.stations = [anchor];
    anchor.x = B.playerWorldPosition().x + 5000;
    anchor.y = B.playerWorldPosition().y;
    const patrol = spawn(9611, 0, {
      role: 'patrol',
      faction: 'terran',
      sideId: 'player'
    });
    patrol.x = anchor.x - 900;
    patrol.y = anchor.y;
    patrol.power.dist = {
      engines: 5,
      weapons: 5,
      shields: 5,
      sensors: 0
    };
    dark.x = anchor.x + Math.min(1400, zone.radius + 100);
    dark.y = anchor.y;
    patrol.sensorNextDecision = Infinity;
    patrol.power.decisionIn = 1e9;
    B.ensureActorSensors(patrol).mode = 'passive';
    dark.sensorNextDecision = Infinity;
    B.ensureActorSensors(dark).mode = 'passive';
    step();
    test('issuer shares a live positional track with its same-side patrol', B.sensorCanTrack(patrol, dark));
    const savedIssuerX = anchor.x,
      savedDarkX = dark.x;
    anchor.x -= 10000;
    step();
    test('issuer loss stops shared tracking and keeps the last position frozen', !B.sensorCanTrack(patrol,
      dark) && B.sensorContact(patrol, dark)?.position?.x === savedDarkX);
    anchor.x = savedIssuerX;
    step();
    test('issuer reacquisition restores the same-side track', B.sensorCanTrack(patrol, dark));
    s.stations = allCheckpointStations;
    anchor.x = originalAnchor.x;
    anchor.y = originalAnchor.y;
    const evidence = B.sensorAttackSnapshot(dark);
    B.recordSensorHit(s, evidence);
    const cue = B.getCounterfireCue(s);
    test('attack-origin evidence is labeled in OPS', B.renderPowerPanel().includes('Attack origin'));
    dark.x += 2000;
    test('hit cue freezes launch origin instead of following hidden movement', cue && cue.x === evidence.x && cue
      .x !== dark.x);
    // Point-fire mechanism: isolate a stationary source beyond visual range; damage travels through real engine.
    reset();
    const pos = B.playerWorldPosition();
    const source = spawn(9612, 1400, {
      faction: 'pirate'
    });
    source.x = pos.x + 1400;
    source.y = pos.y;
    const attack = B.sensorAttackSnapshot(source);
    B.recordSensorHit(s, attack);
    const point = B.getCounterfireCue(s);
    const beam = {
      ...B.getWeapon(1),
      range: 1800
    };
    s.weaponLastFiredAt = [-1e9, -1e9, -1e9];
    s.power.energy = 100;
    const hull0 = source.combatHull + source.combatShields;
    const fired = B.fireCounterfirePoint(s, point, beam, performance.now(), 0);
    test('point beam hits physical source and credits player damage', fired && source.combatHull + source
      .combatShields < hull0 && source.lastDamageSource === 'player');
    source.y += 500;
    s.weaponLastFiredAt[0] = -1e9;
    const pool = source.combatHull + source.combatShields,
      energy = s.power.energy;
    test('empty-origin point beam spends energy but cannot damage moved source', B.fireCounterfirePoint(s, point,
        beam, performance.now(), 0) && source.combatHull + source.combatShields === pool && s.power.energy <
      energy);
    source.y = pos.y;
    s.weaponLastFiredAt[0] = -1e9;
    s.power.energy = 100;
    const torpedo = {
      ...B.getWeapon(15),
      range: 1800
    };
    const beforePool = source.combatHull + source.combatShields;
    const launched = B.fireCounterfirePoint(s, point, torpedo, performance.now(), 0),
      shot = s.projectiles.at(-1);
    for (let i = 0; i < 200 && s.projectiles.length; i++) B.updateProjectiles(1);
    test('point torpedo is ballistic and preserves impact attribution', launched && shot?.pointAim && !shot
      .targetId && shot.turnRate === 0 && source.combatHull + source.combatShields < beforePool && source
      .lastDamageSource === 'player');
    // An intervening hull receives the actual hit; an empty point never damages the old source.
    s.projectiles = [];
    source.y += 500;
    const interloper = spawn(9620, 1000, {
      faction: 'ferengi'
    });
    interloper.x = pos.x + 1000;
    interloper.y = pos.y;
    interloper.combatShields = 0;
    interloper.combatHull = 1;
    s.weaponLastFiredAt[0] = -1e9;
    s.power.energy = 100;
    const cash = s.latinum,
      sourcePool = source.combatHull + source.combatShields;
    test('point beam collateral kills actual intervening ship and rewards once', B.fireCounterfirePoint(s, point,
        beam, performance.now(), 0) && interloper.destroyed && s.latinum > cash && source.combatHull + source
      .combatShields === sourcePool);
    const cashAfter = s.latinum;
    B.updateProjectiles(1);
    test('counterfire kill reward is not duplicated by another update', s.latinum === cashAfter);
    s.projectiles = [];
    s.weaponLastFiredAt[0] = -1e9;
    s.power.energy = 100;
    B.fireCounterfirePoint(s, point, torpedo, performance.now(), 0);
    for (let i = 0; i < 200 && s.projectiles.length; i++) B.updateProjectiles(1);
    test('ballistic torpedo into empty origin misses moved source', source.combatHull + source.combatShields ===
      sourcePool);
    step(32);
    test('hit-origin counterfire permission expires', !B.getCounterfireCue(s));
    // Real own-side station and escort counterfire use the same damage / attribution path.
    for (const kind of ['npc', 'escort', 'station']) {
      reset();
      s.stations = [];
      const victim = spawn(9630, 1400, {
        faction: 'pirate'
      });
      victim.x = pos.x + 1400;
      victim.y = pos.y;
      const gun = kind === 'station' ? {
        id: 'test-counter-turret',
        stationTypeId: 64,
        ownerId: 'player',
        ownedByPlayer: true,
        faction: 'terran',
        x: pos.x,
        y: pos.y,
        defenseDamage: 20,
        lastShotAt: -1e9
      } : spawn(9631, 0, {
        faction: 'terran',
        role: kind === 'escort' ? 'playerEscort' : 'patrol',
        fleetId: kind === 'escort' ? 'counter-escort' : null
      });
      gun.x = pos.x + 4000;
      gun.y = pos.y;
      victim.x = gun.x + 1400;
      gun.lastShotAt = -1e9;
      if (kind === 'station') s.stations.push(gun);
      else gun.power.energy = 500;
      B.recordSensorHit(gun, B.sensorAttackSnapshot(victim));
      const oldCash = s.latinum;
      victim.combatShields = 0;
      victim.combatHull = 1;
      const fired = B.fireCounterfirePoint(gun, B.getCounterfireCue(gun), beam, performance.now());
      test(`${kind} point counterfire preserves kill credit`, fired && victim.destroyed && victim
        .lastDamageSource === (kind === 'escort' ? 'playerEscort' : kind === 'station' ? 'station' : 'npc') && (
          kind === 'escort' ? s.latinum > oldCash : s.latinum === oldCash), {
          fired,
          source: victim.lastDamageSource,
          delta: s.latinum - oldCash
        });
    }
    s.stations = sensingStations;
    // Live foreign checkpoint with authored policy variants. The normal foreign preset remains Unknown Open.
    const vulcan = B.getSystemIndexByName('Vulcan');
    B.transferSystemControlToFaction(vulcan, 'vulcan');
    s.currentPlanet = vulcan;
    delete s.systemStates[vulcan];
    B.applySystemState(vulcan);
    s.playerFaction = 'vulcan';
    s.npcShips = [];
    s.spawnProtectionUntil = 0;
    for (const mode of ['open', 'challenge', 'closed']) {
      B.resetSecurityRecords();
      B.setForeignProbeAccess({
        unknown: mode
      });
      B.sensorWorld.clear(vulcan);
      B.ensureActorSensors().transponder = true;
      s.topLeftPanelOpen = true;
      s.topLeftTab = 'power';
      B.renderTopLeftPanel();
      document.querySelector('[data-sensor-action="toggle"]').click();
      const foreignZone = B.getSecurityZone();
      B.setCamera(foreignZone.centre.x + 100, foreignZone.centre.y);
      B.updateSecurityEncounters(1);
      const d = B.getVisitorAccessDecision(foreignZone, B.getSecurityContact('player')),
        order = B.getPlayerSecurityOrder();
      test(`dark player at foreign same-flag checkpoint obeys Unknown ${mode}`, !B.ensureActorSensors()
        .transponder && d.class === 'unknown' && (mode === 'open' ? !order : order?.kind === (mode ===
          'closed' ? 'withdraw' : 'challenge')) && (mode === 'open' || !!B.getSecurityDockingBlock('vulcan')), {
          d,
          order
        });
      if (mode === 'challenge') {
        const hold = B.resolveSecurityPoint(foreignZone, order.hold);
        B.setCamera(hold.x, hold.y);
        s.ship.velocity = 0;
        B.respondToSecurityOrder('acknowledge');
        for (let i = 0; i < 400; i++) B.updateSecurityEncounters(1);
        test('dark challenged player remains incomplete and denied services', order.state ===
          'check_incomplete' && !order.outcome && !!B.getSecurityDockingBlock('vulcan'), order);
        const remaining = order.remainingMs;
        B.setForeignProbeAccess({
          unknown: 'challenge',
          warFlag: 'closed'
        });
        const declaredEquipment = B.ensureActorSensors();
        declaredEquipment.commandDefault = false;
        declaredEquipment.declaration = 'romulan';
        B.startSensorAction('toggle');
        step(11);
        B.updateSecurityEncounters(1);
        test('fresh hostile declaration revises incomplete order without deadline reset', order.kind ===
          'withdraw' && order.remainingMs <= remaining && !order.outcome, order);
      }
    }
    B.setForeignProbeAccess(null);
    B.ensureActorSensors().commandDefault = true;
    B.ensureActorSensors().transponder = true;
    // Geometry smoke uses the actual source scenes, including hidden outlying installations.
    const geometry = [];
    for (const name of ['Earth', 'Vulcan', 'Ferenginar', 'Paso', 'Remus']) {
      const i = B.getSystemIndexByName(name);
      s.currentPlanet = i;
      B.applySystemState(i);
      const player = B.playerWorldPosition();
      geometry.push({
        name,
        stations: s.stations.length,
        maximum: Math.max(...s.stations.map(st => Math.hypot(st.x - player.x, st.y - player.y)))
      });
    }
    test('five real system geometries load, with remote secret installations', geometry.every(g => g.stations >
      0) && geometry.filter(g => ['Paso', 'Remus'].includes(g.name)).every(g => g.maximum > 5000), geometry);

    // Resume observer-relative fixtures after the system/holding-marker tour moved the camera.
    B.setCamera(at.x, at.y);
    reset();
    s.stations = [];
    const assessed = spawn(9640, 400, {
      faction: 'pirate'
    });
    step();
    test('unscanned target label does not disclose its actual hull or faction', B.playerContactLabel(assessed) ===
      'Unidentified ship');
    for (const skill of ['inexperienced', 'regular', 'veteran', 'elite']) {
      reset();
      s.stations = [];
      const seeker = spawn(9650, 4000, {
          faction: 'klingon',
          role: 'patrol',
          crewSkill: skill,
          hostile: false,
          attitude: 'neutral'
        }),
        contact = spawn(9651, 4500, {
          faction: 'ferengi'
        });
      seeker.sensorNextDecision = Infinity;
      contact.sensorNextDecision = Infinity;
      step();
      const seen = B.sensorContact(seeker, contact)?.position;
      seeker.sensorPursuitKey = B.sensorKey(contact);
      contact.x += 6000;
      step(6);
      B.updateNpcShips(1);
      test(`${skill} searches a frozen last position, not hidden coordinates`, !!seen && seeker
        .destinationName === 'search last contact' && seeker.destination.x === seen.x && seeker.destination
        .y === seen.y && seeker.destination.x !== contact.x);
    }
    reset();
    s.stations = [];
    const oldOccupant = spawn(9660, 400, {
      faction: 'ferengi'
    });
    step();
    const oldKey = B.sensorKey(oldOccupant);
    const oldRecord = B.sensorContact(s, oldOccupant);
    oldRecord.report = {
      hull: 'Previously assessed hull',
      assessedAt: B.sensorWorld.now
    };
    B.ensureActorSensors(oldOccupant).suite = 3;
    B.beginAmbientTrafficArrival(oldOccupant, performance.now());
    test('ambient slot reuse changes contact identity and resets equipment', B.sensorKey(oldOccupant) !==
      oldKey && !B.sensorContact(s, oldOccupant) && B.ensureActorSensors(oldOccupant).suite === 0);
    // Re-entry retains dated intelligence, while the fresh scene still requires observation.
    const fromSystem = s.currentPlanet;
    step();
    const keyNow = B.sensorKey(oldOccupant);
    B.sensorWorld.map('player').set(keyNow, {
      key: keyNow,
      position: {
        x: oldOccupant.x,
        y: oldOccupant.y
      },
      observedAt: B.sensorWorld.now,
      declaredAt: -100,
      report: {
        hull: 'Archive marker',
        assessedAt: B.sensorWorld.now
      },
      valid: true
    });
    const other = B.getSystemIndexByName('Earth');
    s.currentPlanet = other;
    B.applySystemState(other);
    step(10);
    s.currentPlanet = fromSystem;
    B.applySystemState(fromSystem);
    step(2);
    test('returning to a system restores dated reports without granting a fresh track', B.sensorWorld.contact(
      'player', keyNow)?.report?.hull === 'Archive marker' && B.sensorWorld.now - B.sensorWorld.contact(
      'player', keyNow).report.assessedAt >= 1);
    s.topLeftPanelOpen = true;
    s.topLeftTab = 'power';
    B.renderTopLeftPanel();
    B.render();
    test('OPS contains sensor allocation and explicit transponder UI', B.renderPowerPanel().includes(
      'data-power-tank="sensors"') && B.renderPowerPanel().includes('Transponder:'));
    // Contact reports used to be a collapsed <details> inside a long Sensors panel, which is why the
    // captain reported never seeing them. They are now a labelled, always-open, scrollable list, so
    // the check is that the list is on screen and readable after a live re-render, not that a
    // disclosure the captain opened stayed open.
    B.renderTopLeftPanel();
    const list = document.querySelector('.sensor-contact-list');
    const head = document.querySelector('.panel-subhead');
    const style = list && getComputedStyle(list);
    const collapsed = Boolean(list?.closest('details:not([open])'));
    test('live OPS refresh leaves contact reports expanded, labelled and scrollable',
      Boolean(list) && !collapsed && list.offsetHeight > 0
      && /contact reports/i.test(document.querySelector('#top-left-panel')?.textContent || '')
      && Boolean(head)
      && ['auto', 'scroll'].includes(style.overflowY)
      && parseFloat(style.maxHeight) > 0);
    return {
      checks
    };
  });
  const galleryArg = process.argv.indexOf('--screenshots');
  if (galleryArg >= 0) {
    const folder = path.resolve(process.argv[galleryArg + 1]);
    fs.mkdirSync(folder, {
      recursive: true
    });
    await page.evaluate(() => {
      const B = window.__power,
        s = B.state;
      B.startWithFaction('terran');
      s.npcShips = [];
      s.stations = [];
      s.projectiles = [];
      s.topLeftPanelOpen = true;
      s.topLeftTab = 'power';
      s.docked = false;
      s.power.dist = {
        engines: 5,
        weapons: 5,
        shields: 5,
        sensors: 5
      };
      s.power.energy = 180;
      const p = B.playerWorldPosition();
      const n = B.createNpcShip({
        id: 'sensor-demo',
        shipId: 2,
        faction: 'ferengi',
        role: 'traffic',
        seed: 1982,
        from: {
          x: p.x + 700,
          y: p.y
        }
      });
      B.ensureNpcCombatStats(n);
      B.ensureNpcPower(n);
      n.weaponSlots = [1, 15, null];
      n.sensorNextDecision = Infinity;
      s.npcShips.push(n);
      window.__demo = n;
      for (let i = 0; i < 12; i++) {
        B.updatePowerSystems(6);
        B.updateSensorSystems(6);
      }
      s.combatTargetId = n.id;
      s.combatTargetType = 'ship';
      B.renderTopLeftPanel();
      B.render();
    });
    await page.screenshot({
      path: path.join(folder, '01-passive.png')
    });
    await page.evaluate(() => {
      const B = window.__power;
      B.startSensorAction('focus');
      for (let i = 0; i < 30; i++) {
        B.updatePowerSystems(6);
        B.updateSensorSystems(6);
      }
      B.renderTopLeftPanel();
      B.render();
    });
    await page.screenshot({
      path: path.join(folder, '02-focused.png')
    });
    await page.evaluate(() => {
      const B = window.__power;
      for (let i = 0; i < 100; i++) {
        B.updatePowerSystems(6);
        B.updateSensorSystems(6);
      }
      B.renderTopLeftPanel();
      B.render();
      document.querySelector('.sensor-contact-list').open = true;
    });
    await page.screenshot({
      path: path.join(folder, '03-assessed.png')
    });
    await page.evaluate(() => {
      const B = window.__power;
      window.__demo.x += 6000;
      for (let i = 0; i < 8; i++) {
        B.updatePowerSystems(6);
        B.updateSensorSystems(6);
      }
      B.renderTopLeftPanel();
      B.render();
      document.querySelector('.sensor-contact-list').open = true;
    });
    await page.screenshot({
      path: path.join(folder, '04-lost.png')
    });
    await page.setViewportSize({
      width: 1024,
      height: 768
    });
    await page.evaluate(() => window.__power.renderTopLeftPanel());
    const beforeToggle = await page.evaluate(() => window.__power.ensureActorSensors().transponder);
    const button = page.locator('[data-sensor-action="toggle"]');
    await button.tap();
    const mobileOk = await page.evaluate(before => window.__power.ensureActorSensors().transponder !== before,
      beforeToggle);
    result.checks.push({
      name: '1024×768 touch viewport can operate transponder control',
      ok: mobileOk
    });
    await page.screenshot({
      path: path.join(folder, '05-touch-viewport.png')
    });
  }
  for (const c of result.checks) console.log(`${c.ok?'PASS':'FAIL'} ${c.name}${c.ok?'':' '+JSON.stringify(c.detail)}`);
  console.log(JSON.stringify({
    browser: await browser.version(),
    environment: {
      platform: os.platform(),
      arch: os.arch(),
      cpu: os.cpus()[0]?.model,
      logicalCPUs: os.availableParallelism()
    },
    errors
  }));
  const screenshot = process.argv.indexOf('--screenshot');
  if (screenshot >= 0) await page.screenshot({
    path: process.argv[screenshot + 1],
    fullPage: true
  });
  console.log(`${result.checks.filter(c=>c.ok).length}/${result.checks.length} live sensor checks passed`);
  if (errors.length || result.checks.some(c => !c.ok)) process.exitCode = 1;
} finally {
  if (browser) await browser.close();
  server.close();
}
