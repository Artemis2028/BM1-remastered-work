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
        `\nwindow.testBM1={openGalaxyReports,openWarpBriefing,closeGalaxyReports,renderGalaxyReports,collectGalaxyReports,galaxyNewsBook,addGalaxyReport,triggerDebugEvent,triggerDebugMission,getCurrentServiceStation,hasServiceConnection,openRemoteStationShop,buyWeapon,getWeaponPrice,getWeaponIconSrc,getWeapon,getStationWeaponStock,getShipyardStock,completeShipPurchase,repairHull,createCargoRunOffer,getContractTotal,acceptPendingContract,deliverDestinationCargoAtCurrentPlanet,getCurrentDockedStation,getSecurityZone,getSecurityDockingBlock,updateSecurityOrderPanel,getPlayerSecurityOrder,respondToSecurityOrder,updatePowerSystems,updateSensorSystems,getSystemIndexByName,applyPlayerDamage,applyCurrentShipStats,getOriginalShipWeaponSlots,ensureNpcCombatStats,ensureNpcPower,startBoardingTarget,physicalNpcId,capturePolicy,canFleetDepart,beginWarpTravel,completeWarpTravel,getPlottedRoute,getShipPurchaseStatus,createRuntimeStationFromDefinition,createLightweightRuntimeStation,getStationDefinitionWorldPoint,isNpcStationTarget,Fleet,state,startWithFaction,applyDebugCommand,getFactionStanding,saveGame,loadGame,keys,heldWeaponInputs,updateStats,fleetBook,applyVesselDisablement,gameNow,tick,pauseGameClock,resumeGameClock,getSystemControl,getStationOwner,getSecurityZone,getSecurityDockingBlock,placePlayerAtSecurityApproach,playerWorldPosition,adjustFactionStanding,setSecurityPolicyOverride,clearSecurityPolicyOverride,getDelegatedPolicy,canDelegateSecurity,renderSecurityPanelMarkup,getEffectiveSecurityPolicy,isNpcSystemAttacker,recordPlayerAggressionAgainst,createNpcShip,getSystemActivity,updateSystemActivity,ensurePlaytestState,isChartSystemVisible,getPlottedRoute,markSystemVisited,getOpenContracts,getCatalogPurchaseDecision,getCurrentDockedStation,getStationVisualProfile,resolveSecurityPoint,ensureActorSensors,ensureSystemState,getOpenContracts,normalizeContract,renderOpenContractsPanel,getRecoveryStatus,recoverDisabledPlayer,getNpcCombatDurability,updateRecoveryPanel,getCurrentPurchaseVendor,getShipSaleStatus,getUnfilteredShipyardStock,isDefensePlatform,getStationDefenseProfile,destroyStation,advanceFleetCalendar,advanceFactionReconstruction,syncFactionReconstruction,getStationCombatDurability,getShipStats,ensureCombatTargetStats,applySystemState,getSystemFaction,areFactionsOpposed,areFactionsAligned,changeDiplomacy,diplomacyBook,advanceWorldDiplomacy,activityTrafficShip,getShipFaction,getMapFactionTerritoryClusters,measureIntroCrawl,showIntroStory,skipIntroStory,openGameMenu,returnToMainMenu,factionDefs,reviewLegacyHolding,renderFleetManager,updateSecurityEncounters,getPlayerSecurityOrder,respondToSecurityOrder,setCamera,openStationComms,fireStationWeapon,withStationOrbit,spawnFleetAttack,updateSystemOrbits,openTopLeftTab,restoreWorldEncounter,captureWorldEncounter};`,
    });
  });
  await page.goto(`http://127.0.0.1:${server.address().port}`);
  await page.waitForFunction(
    () => window.testBM1 && testBM1.state.shipCatalog && testBM1.state.planets.length > 10 && testBM1.state.flaHints?.symbols?.length > 0,
  );
  let passed=0;
  const check=async(name,fn)=>{await fn();passed++;console.log('PASS',name);};
  const ev=fn=>page.evaluate(fn);
  await ev(async()=>{
    testBM1.startWithFaction('terran');
    await new Promise(resolve=>{requestAnimationFrame=cb=>{if(cb.name==='loop')resolve();return 0;};});
  });
  await check('combat damage respects capital hull pools; environmental damage keeps its units',async()=>{
    const rows=await ev(()=>[305,223,38].map(id=>{
      const t=testBM1,s=t.state;s.playership=id;t.applyCurrentShipStats(true);s.godMode=false;s.hull=100;s.shields=100;
      const pools=t.getNpcCombatDurability(id);const hit=t.applyPlayerDamage(100,'#fff',{combatUnits:true});
      s.shields=0;const hull=t.applyPlayerDamage(100,'#fff',{combatUnits:true});s.hull=100;
      const environment=t.applyPlayerDamage(4);
      return {id,pools,hit,hull,environment,weapons:t.getOriginalShipWeaponSlots(id),name:t.getShipStats(id).name};
    }));
    for(const r of rows){assert.ok(Math.abs(r.hit.shieldDamage-10000/r.pools.shields)<1e-9);assert.ok(Math.abs(r.hull.hullDamage-10000/r.pools.hull)<1e-9);assert.equal(r.environment.hullDamage,4);}
    assert.ok(rows[2].hit.shieldDamage<rows[1].hit.shieldDamage/2);console.log('COMBAT_POOLS',JSON.stringify(rows));
  });
  await check('new freight quotes scale with route and cargo; old accepted prices remain intact',async()=>{
    const r=await ev(()=>{const t=testBM1;t.startWithFaction('terran');const offers=Array.from({length:120},()=>t.createCargoRunOffer());return {min:Math.min(...offers.map(t.getContractTotal)),max:Math.max(...offers.map(t.getContractTotal)),mean:offers.reduce((n,o)=>n+t.getContractTotal(o),0)/offers.length,old:t.getContractTotal(t.normalizeContract({goods:'Ore',targetIndex:1,tons:2,payPerTon:15})),valid:offers.every(o=>o.tons<=t.state.cargoCap&&o.payPerTon>=150)};});
    assert.ok(r.valid);assert.ok(r.min>=300);assert.equal(r.old,30);console.log('FREIGHT_QUOTES',JSON.stringify(r));
  });
  await check('remote station purchases honor real stock, charge once, and never grant physical docking',async()=>{
    const r=await ev(()=>{const t=testBM1,s=t.state;t.startWithFaction('terran');s.latinum=1e7;s.factionStanding.terran=100;s.weaponInventory=[];s.weaponSlots=[null,null,null];
      const yard=s.stations.find(st=>t.getStationWeaponStock(st).some(w=>w.minMass<=s.mymass)&&t.getShipyardStock(st).some(x=>x.id!==s.playership));
      t.setCamera(yard.x+2000,yard.y);const opened=t.openRemoteStationShop(yard.id);
      const w=t.getStationWeaponStock().find(w=>w.minMass<=s.mymass&&w.guidance!=='home-on-jam');const funds=s.latinum;t.buyWeapon(w.id);
      const bought=funds-s.latinum===t.getWeaponPrice(w)&&s.weaponInventory.includes(w.id);
      const ship=t.getShipyardStock().find(x=>x.id!==s.playership&&t.getShipPurchaseStatus(x.id).ok);const price=t.getShipPurchaseStatus(ship.id).price,old=s.latinum;t.completeShipPurchase(ship.id);
      s.hull=50;const cash=s.latinum;t.repairHull();
      return {opened,bought,ship:s.playership===ship.id,charged:old-s.latinum===price,physical:s.docked,station:t.getCurrentDockedStation(),repairBlocked:s.hull===50&&cash===s.latinum,remote:s.remoteStationId};});
    assert.ok(r.opened&&r.bought&&r.ship&&r.charged&&r.repairBlocked,JSON.stringify(r));assert.equal(r.physical,false);assert.equal(r.station,null);
  });
  await check('Terran arrival at Qonos is distant, hailed and denied trade during war',async()=>{
    const r=await ev(()=>{const t=testBM1,s=t.state;t.startWithFaction('terran');s.currentPlanet=t.getSystemIndexByName('Qonos');t.applySystemState(s.currentPlanet);t.placePlayerAtSecurityApproach();t.updateSecurityOrderPanel();const z=t.getSecurityZone(),p=t.playerWorldPosition();const before=s.latinum;const result=t.openRemoteStationShop(s.stations[0].id);return {distance:Math.hypot(p.x-z.centre.x,p.y-z.centre.y),radius:z.radius,text:document.getElementById('security-order-panel').textContent,blocked:t.getSecurityDockingBlock(),denied:!result&&before===s.latinum};});
    assert.ok(r.distance>=r.radius+590);assert.match(r.text,/Incoming hail/);assert.match(r.text,/barred/);assert.ok(r.denied&&r.blocked);
    await page.screenshot({path:path.join(process.env.BM1_TEST_OUTPUT||'/tmp','klingon-arrival.png')});
    await ev(()=>document.getElementById('station-comms').close());
  });
  await check('peacetime inspection issues a holding marker and unlocks service only after dwell',async()=>{
    const r=await ev(()=>{const t=testBM1,s=t.state;t.changeDiplomacy('terran','klingon','peace');s.factionStanding.klingon=100;const z=t.getSecurityZone();const initiallyBlocked=!!t.getSecurityDockingBlock();t.setCamera(z.centre.x+z.radius-40,z.centre.y);s.ship.velocity=0;
      const step=()=>{t.updatePowerSystems(6);t.updateSensorSystems(6);t.updateSecurityEncounters(6);};for(let i=0;i<40&&!t.getPlayerSecurityOrder();i++)step();const o=t.getPlayerSecurityOrder();if(!o)return {initiallyBlocked,missing:true};
      t.updateSecurityOrderPanel();const instruction=document.getElementById('security-order-panel').textContent;
      t.respondToSecurityOrder('acknowledge');const hold=t.resolveSecurityPoint(z,o.hold);t.setCamera(hold.x,hold.y);for(let i=0;i<320&&!o.outcome;i++)step();
      return {initiallyBlocked,kind:o.kind,instruction,outcome:o.outcome,allowed:!t.getSecurityDockingBlock(),shop:t.openRemoteStationShop(s.stations.find(st=>t.getStationWeaponStock(st).length).id)};});
    assert.ok(r.initiallyBlocked&&!r.missing,JSON.stringify(r));assert.equal(r.kind,'challenge');assert.match(r.instruction,/holding marker/i);assert.equal(r.outcome,'cleared');assert.ok(r.allowed&&r.shop,JSON.stringify(r));
  });
  await check('anti-emitter torpedo icon resolves to a real loaded image',async()=>{
    const r=await ev(async()=>{const src=testBM1.getWeaponIconSrc(testBM1.getWeapon(46));const img=new Image();img.src=src;await img.decode();return {src,width:img.naturalWidth};});assert.ok(r.width>0);console.log('TORPEDO_ICON',JSON.stringify(r));
  });
  async function prepareBoarding(success){return page.evaluate(want=>{const t=testBM1,s=t.state;t.startWithFaction('terran');s.npcShips=[];s.playerFleet=[];const p=t.playerWorldPosition(),n=t.createNpcShip({id:'boarding-review',shipId:1,seed:77,faction:'klingon',from:{x:p.x+100,y:p.y}});t.ensureNpcCombatStats(n);t.ensureNpcPower(n);n.combatHull=20;n.combatShields=0;n.condition='disabled';s.npcShips.push(n);for(let i=0;i<12;i++)t.updateSensorSystems(6);const b=t.fleetBook();for(let i=0;i<100;i++){const copy=t.Fleet.copy(b);copy.campaignId=`boarding-review-${i}`;const op=t.Fleet.beginBoarding(copy,{targetId:t.physicalNpcId(n),sourceId:b.personalId,resistance:t.capturePolicy(n.shipId).resistance});if((op.roll<op.chance)===want){b.campaignId=copy.campaignId;break;}}return {physical:t.physicalNpcId(n),hull:n.combatHull};},success);}
  await check('boarding No makes no attempt; Yes resolves success immediately and persists one prize',async()=>{
    const fixture=await prepareBoarding(true);page.once('dialog',d=>d.dismiss());const no=await ev(()=>testBM1.startBoardingTarget(testBM1.state.npcShips[0]));assert.equal(no,false);assert.equal(await ev(()=>testBM1.fleetBook().team.available),true);
    page.once('dialog',d=>d.accept());const yes=await ev(()=>testBM1.startBoardingTarget(testBM1.state.npcShips[0]));assert.equal(yes,true);
    const r=await ev(()=>{const t=testBM1,s=t.state;const now={pending:t.fleetBook().boarding,owned:s.playerFleet.length,hull:s.npcShips[0].combatHull,mobile:s.npcShips[0].prizeStabilized};t.saveGame(6);t.loadGame(6);return {...now,after:s.playerFleet.length};});assert.equal(r.pending,null);assert.equal(r.owned,1);assert.equal(r.after,1);assert.equal(r.hull,fixture.hull);assert.ok(r.mobile);
  });
  await check('boarding failure resolves immediately with no reroll or duplicate reward',async()=>{
    await prepareBoarding(false);page.once('dialog',d=>d.accept());await ev(()=>testBM1.startBoardingTarget(testBM1.state.npcShips[0]));const r=await ev(()=>({pending:testBM1.fleetBook().boarding,team:testBM1.fleetBook().team.available,destroyed:testBM1.state.npcShips[0].destroyed,fleet:testBM1.state.playerFleet.length}));assert.equal(r.pending,null);assert.equal(r.team,false);assert.equal(r.destroyed,true);assert.equal(r.fleet,0);
  });
  await check('debug actions deploy real hostile ships and reports describe actual station losses',async()=>{
    const r=await ev(()=>{const t=testBM1,s=t.state;t.startWithFaction('terran');t.changeDiplomacy('terran','klingon','war');const before=s.npcShips.length;const msg=t.triggerDebugEvent('raid');const raid=s.activeFleetAttack;const station=s.stations[0];t.destroyStation(station);t.collectGalaxyReports();const news=t.galaxyNewsBook().items;return {msg,raid:!!raid,spawned:s.npcShips.length-before,report:news.some(r=>r.id===raid.id),loss:news.some(r=>r.kind==='Installation lost'&&r.text.includes(station.name)),bounded:news.length<=120};});assert.ok(r.raid&&r.spawned>0&&r.report&&r.loss&&r.bounded,JSON.stringify(r));
  });
  await check('debug mission controls open real cargo offers and run existing away missions',async()=>{
    const r=await ev(()=>{const t=testBM1,s=t.state;t.startWithFaction('terran');t.triggerDebugMission('cargo');const offer=s.pendingContractOffer;t.acceptPendingContract();const accepted=t.getOpenContracts().some(c=>c.id===offer.id);t.setCamera(s.systemPlanet.x+100,s.systemPlanet.y);const result=t.triggerDebugMission('transport');return {offer:!!offer,accepted,result,physical:s.docked};});
    assert.ok(r.offer&&r.accepted,JSON.stringify(r));assert.equal(r.physical,false);assert.match(r.result,/Transport/);
  });
  await check('news deduplicates repeated reads without hiding same-day war and peace',async()=>{
    const r=await ev(()=>{const t=testBM1;t.startWithFaction('terran');t.changeDiplomacy('terran','ferengi','peace');t.collectGalaxyReports();const peaceful=t.galaxyNewsBook().items.filter(r=>r.id.startsWith('diplomacy:')).at(-1);t.changeDiplomacy('terran','ferengi','war');t.collectGalaxyReports();t.changeDiplomacy('terran','ferengi','peace');t.collectGalaxyReports();const rows=t.galaxyNewsBook().items.filter(r=>r.id.startsWith('diplomacy:'));const count=rows.length;t.collectGalaxyReports();return {peaceful:peaceful.kind,last:rows.at(-1).kind,count,after:t.galaxyNewsBook().items.filter(r=>r.id.startsWith('diplomacy:')).length};});
    assert.equal(r.peaceful,'Diplomatic update');assert.equal(r.last,'Peace agreement');assert.equal(r.count,3);assert.equal(r.after,r.count);
  });
  await check('mid-jump briefing pauses, saves and resumes without charging campaign days twice',async()=>{
    const r=await ev(()=>{const t=testBM1,s=t.state;t.startWithFaction('terran');t.changeDiplomacy('vulcan','klingon','war');const to=t.getSystemIndexByName('Ferenginar');t.beginWarpTravel(to,t.getPlottedRoute(s.currentPlanet,to));s.warp.travelDays=3;s.warp.startedAt=t.gameNow()-s.warp.duration*0.6;const before=s.day;t.tick(1);return {before,after:s.day,open:document.getElementById('galaxy-reports').open,clock:t.gameNow(),report:document.getElementById('galaxy-reports').textContent};});
    assert.equal(r.after,r.before+3);assert.ok(r.open);assert.match(r.report,/Vulcan.*Klingon/);await page.waitForTimeout(120);assert.equal(await ev(()=>testBM1.gameNow()),r.clock);
    await page.screenshot({path:path.join(process.env.BM1_TEST_OUTPUT||'/tmp','jump-briefing.png')});
    const after=await ev(()=>{const t=testBM1;t.saveGame(6);t.closeGalaxyReports();t.loadGame(6);t.tick(1);const reopened=document.getElementById('galaxy-reports').open;t.closeGalaxyReports();t.completeWarpTravel();return {day:t.state.day,reopened,arrived:!t.state.warp.active};});assert.equal(after.day,r.after);assert.ok(after.reopened&&after.arrived,JSON.stringify(after));
  });
  await check('reports and debug event controls fit a narrow screen',async()=>{
    await page.setViewportSize({width:390,height:844});await ev(()=>testBM1.openGalaxyReports());const r=await page.locator('#galaxy-reports').evaluate(el=>({width:el.getBoundingClientRect().width,height:el.getBoundingClientRect().height,overflow:el.scrollWidth>el.clientWidth+2}));assert.ok(r.width<=390&&r.height<=844&&!r.overflow,JSON.stringify(r));await page.screenshot({path:path.join(process.env.BM1_TEST_OUTPUT||'/tmp','reports-mobile.png')});await ev(()=>testBM1.closeGalaxyReports());
  });
  assert.deepEqual(errors,[]);console.log(`${passed} captain briefing groups passed; no page errors.`);
  await browser.close();await new Promise(r=>server.close(r));
})().catch(e=>{console.error(e);process.exit(1);});
