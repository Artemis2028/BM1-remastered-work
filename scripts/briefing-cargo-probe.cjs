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
        `\nwindow.testBM1={getWorldCargoDeliveryStatus,hasWorldCargoToDeliver,isPersonalGalaxyReport,ownsReportLocation,selectJumpBriefingReports,visibleGalaxyReports,isPlayerCloaked,setPlayerCloak,fleetPlanStatus,rebuildTravelRoutes,getPlayerDisableGraceRemaining,hasServiceChannel,getServiceTransferBlock,updateServiceRangeIndicator,isReportSystemKnown,hasIntelShips,intelIdentityCandidates,recordLocalIntel,makeIntelReport,collectRegionalIntel,closePlanetMenu,negotiateContract,openGalaxyReports,openWarpBriefing,closeGalaxyReports,renderGalaxyReports,collectGalaxyReports,galaxyNewsBook,addGalaxyReport,triggerDebugEvent,triggerDebugMission,getCurrentServiceStation,hasServiceConnection,openRemoteStationShop,buyWeapon,getWeaponPrice,getWeaponIconSrc,getWeapon,getStationWeaponStock,getShipyardStock,completeShipPurchase,repairHull,createCargoRunOffer,getContractTotal,acceptPendingContract,deliverDestinationCargoAtCurrentPlanet,getCurrentDockedStation,getSecurityZone,getSecurityDockingBlock,updateSecurityOrderPanel,getPlayerSecurityOrder,respondToSecurityOrder,updatePowerSystems,updateSensorSystems,getSystemIndexByName,applyPlayerDamage,applyCurrentShipStats,getOriginalShipWeaponSlots,ensureNpcCombatStats,ensureNpcPower,startBoardingTarget,physicalNpcId,capturePolicy,canFleetDepart,beginWarpTravel,completeWarpTravel,getPlottedRoute,getShipPurchaseStatus,createRuntimeStationFromDefinition,createLightweightRuntimeStation,getStationDefinitionWorldPoint,isNpcStationTarget,Fleet,state,startWithFaction,applyDebugCommand,getFactionStanding,saveGame,loadGame,keys,heldWeaponInputs,updateStats,fleetBook,applyVesselDisablement,gameNow,tick,pauseGameClock,resumeGameClock,getSystemControl,getStationOwner,getSecurityZone,getSecurityDockingBlock,placePlayerAtSecurityApproach,playerWorldPosition,adjustFactionStanding,setSecurityPolicyOverride,clearSecurityPolicyOverride,getDelegatedPolicy,canDelegateSecurity,renderSecurityPanelMarkup,getEffectiveSecurityPolicy,isNpcSystemAttacker,recordPlayerAggressionAgainst,createNpcShip,getSystemActivity,updateSystemActivity,ensurePlaytestState,isChartSystemVisible,getPlottedRoute,markSystemVisited,getOpenContracts,getCatalogPurchaseDecision,getCurrentDockedStation,getStationVisualProfile,resolveSecurityPoint,ensureActorSensors,ensureSystemState,getOpenContracts,normalizeContract,renderOpenContractsPanel,getRecoveryStatus,recoverDisabledPlayer,getNpcCombatDurability,updateRecoveryPanel,getCurrentPurchaseVendor,getShipSaleStatus,getUnfilteredShipyardStock,isDefensePlatform,getStationDefenseProfile,destroyStation,advanceFleetCalendar,advanceFactionReconstruction,syncFactionReconstruction,getStationCombatDurability,getShipStats,ensureCombatTargetStats,applySystemState,getSystemFaction,areFactionsOpposed,areFactionsAligned,changeDiplomacy,diplomacyBook,advanceWorldDiplomacy,activityTrafficShip,getShipFaction,getMapFactionTerritoryClusters,measureIntroCrawl,showIntroStory,skipIntroStory,openGameMenu,returnToMainMenu,factionDefs,reviewLegacyHolding,renderFleetManager,updateSecurityEncounters,getPlayerSecurityOrder,respondToSecurityOrder,setCamera,openStationComms,fireStationWeapon,withStationOrbit,spawnFleetAttack,updateSystemOrbits,openTopLeftTab,restoreWorldEncounter,captureWorldEncounter};`,
    });
  });
  await page.goto(`http://127.0.0.1:${server.address().port}`);
  await page.waitForFunction(
    () => window.testBM1 && testBM1.state.shipCatalog && testBM1.state.planets.length > 10 && testBM1.state.flaHints?.symbols?.length > 0,
  );
  let passed=0;
  const ev=fn=>page.evaluate(fn);
  const check=async(name,fn)=>{await fn();passed++;console.log('PASS',name);};
  await ev(async()=>{testBM1.startWithFaction('terran');await new Promise(resolve=>{requestAnimationFrame=cb=>{if(cb.name==='loop')resolve();return 0;};});});
  await check('six background headlines plus every personal report; unread overflow reaches next jump',async()=>{
    const r=await ev(()=>{const t=testBM1,s=t.state;t.startWithFaction('terran');const book=t.galaxyNewsBook();book.items=[];book.readIds=[];
      for(let i=0;i<12;i++)t.addGalaxyReport({id:`other-${i}`,kind:'Border news',category:'diplomacy',factions:['romulan','klingon'],confidence:'Public report',text:`Background ${i}`});
      for(let i=0;i<9;i++)t.addGalaxyReport({id:`personal-${i}`,kind:'Our faction',category:'diplomacy',factions:['terran','ferengi'],confidence:'Public report',text:`Personal ${i}`});
      s.warp.briefingReports=null;const first=t.selectJumpBriefingReports();book.readIds=[...first.personal,...first.galaxy].map(r=>r.id);s.warp.briefingReports=null;const second=t.selectJumpBriefingReports();return {first:{personal:first.personal.length,galaxy:first.galaxy.length},second:{personal:second.personal.length,galaxy:second.galaxy.length},overlap:first.galaxy.some(r=>second.galaxy.some(x=>x.id===r.id))};});
    assert.deepEqual(r.first,{personal:9,galaxy:6});assert.deepEqual(r.second,{personal:0,galaxy:6});assert.equal(r.overlap,false);
  });
  await check('personal relevance covers fleet ships, owned worlds, owned stations and faction accusations',async()=>{
    const r=await ev(()=>{const t=testBM1,s=t.state;t.startWithFaction('terran');const indexes=s.planets.map((p,i)=>i).filter(i=>i!==s.currentPlanet&&t.isChartSystemVisible(i)).slice(0,4);const [world,stationSystem,fleetSystem,other]=indexes;s.controlledSystems.push(world);const station=s.stationDefinitions.find(st=>st.systemIndex===stationSystem);s.stationOwners[station.id]='player';s.playerFleet.push({id:'test-observer',systemIndex:fleetSystem,assignment:'defense',vessel:{hull:100,condition:'operational'}});return {world:t.isPersonalGalaxyReport({systemIndex:world}),station:t.isPersonalGalaxyReport({systemIndex:stationSystem}),fleet:t.isPersonalGalaxyReport({systemIndex:fleetSystem}),faction:t.isPersonalGalaxyReport({factions:['terran'],text:'Unconfirmed identification'}),other:t.isPersonalGalaxyReport({systemIndex:other,factions:['romulan']})};});
    assert.deepEqual(r,{world:true,station:true,fleet:true,faction:true,other:false});
  });
  await check('jump selection persists through folders and save/load; archive pages stay bounded',async()=>{
    const r=await ev(()=>{const t=testBM1,s=t.state;t.startWithFaction('terran');const to=t.getSystemIndexByName('Ferenginar');t.beginWarpTravel(to,t.getPlottedRoute(s.currentPlanet,to));t.openWarpBriefing();const b=t.galaxyNewsBook();b.items=[];b.readIds=[];b.pending=[];s.warp.briefingReports=null;for(let i=0;i<15;i++)t.addGalaxyReport({id:`folder-${i}`,kind:'Diplomatic news',category:'diplomacy',factions:i<8?['terran']:['romulan'],confidence:'Public report',text:`Archive entry ${i}`});t.openGalaxyReports();return {day:s.day,ids:JSON.stringify(s.warp.briefingReports)};});
    assert.equal(await page.locator('[data-report-personal] .galaxy-report').count(),8);assert.equal(await page.locator('[data-report-background] .galaxy-report').count(),6);
    await page.locator('[data-report-folder="diplomacy"]').click();assert.equal(await page.locator('.galaxy-report').count(),6);await page.locator('[data-report-page="1"]').click();assert.equal(await page.locator('.galaxy-report').count(),6);await page.locator('[data-report-folder="briefing"]').click();
    assert.equal(await ev(()=>JSON.stringify(testBM1.state.warp.briefingReports)),r.ids);
    await page.setViewportSize({width:390,height:844});const fit=await page.locator('#galaxy-reports').evaluate(el=>el.scrollWidth<=el.clientWidth+2);assert.ok(fit);await page.screenshot({path:path.join(process.env.BM1_TEST_OUTPUT||'/tmp','briefing-folders-mobile.png')});
    const loaded=await ev(()=>{const t=testBM1;t.saveGame(6);t.closeGalaxyReports();t.loadGame(6);t.openWarpBriefing();return {day:t.state.day,ids:JSON.stringify(t.state.warp.briefingReports)};});assert.deepEqual(loaded,r);await ev(()=>testBM1.closeGalaxyReports());await page.setViewportSize({width:1280,height:800});
  });
  const prepare=async()=>ev(()=>{const t=testBM1,s=t.state;t.startWithFaction('terran');const vendor=s.stations.find(st=>t.getShipyardStock(st).length);t.setCamera(vendor.x+100,vendor.y);t.openRemoteStationShop(vendor.id);const target=t.getSystemIndexByName('Qonos');const offer={...t.createCargoRunOffer(),targetIndex:target,targetName:'Qonos',tons:2,payPerTon:500};s.pendingContractOffer=offer;t.acceptPendingContract();t.closePlanetMenu();s.currentPlanet=target;s.myplanet=target+1;t.applySystemState(target);t.placePlayerAtSecurityApproach();return {id:offer.id,latinum:s.latinum,zone:t.getSecurityZone().radius,expected:1000};});
  await check('expanded checkpoints place arrivals outside the new perimeter and above world delivery range',async()=>{
    const f=await prepare();const r=await ev(()=>{const t=testBM1,z=t.getSecurityZone(),p=t.playerWorldPosition();return {radius:z.radius,distance:Math.hypot(p.x-z.centre.x,p.y-z.centre.y),status:t.getWorldCargoDeliveryStatus(),delivered:t.deliverDestinationCargoAtCurrentPlanet(),contracts:t.getOpenContracts().length};});assert.ok(r.radius>=1400&&r.radius<=2600);assert.ok(r.distance>=r.radius+590);assert.ok(!r.status.ok&&!r.delivered);assert.equal(r.contracts,1);assert.equal(await ev(()=>testBM1.state.latinum),f.latinum);
  });
  await check('distant station access cannot deliver world cargo; the 600-unit boundary is enforced',async()=>{
    await prepare();const r=await ev(()=>{const t=testBM1,s=t.state;const planet=s.systemPlanet;const station=s.stations.find(st=>Math.hypot(st.x-planet.x,st.y-planet.y)>600);s.docked=true;s.dockedStationId=station.id;s.dockedPlanetIndex=s.currentPlanet;t.setCamera(station.x,station.y);const docked=t.deliverDestinationCargoAtCurrentPlanet();s.docked=false;t.setPlayerCloak(true);t.setCamera(planet.x+601,planet.y);const far=t.deliverDestinationCargoAtCurrentPlanet();return {docked,far,contracts:t.getOpenContracts().length};});assert.deepEqual(r,{docked:false,far:false,contracts:1});
  });
  await check('cloaked world approach automatically delivers once despite an unresolved wartime check',async()=>{
    const f=await prepare();const r=await ev(()=>{const t=testBM1,s=t.state;t.setCamera(s.systemPlanet.x+599,s.systemPlanet.y);t.updateSecurityEncounters(1);const blocked=t.getSecurityDockingBlock();const plain=t.deliverDestinationCargoAtCurrentPlanet();t.setPlayerCloak(true);t.tick(0);const cash=s.latinum;const cloaked=t.isPlayerCloaked(),stillBlocked=!!t.getSecurityDockingBlock(),log=s.log;t.tick(0);t.saveGame(6);t.loadGame(6);t.deliverDestinationCargoAtCurrentPlanet();return {status:t.getWorldCargoDeliveryStatus(),hasCargo:t.hasWorldCargoToDeliver(),blocked:!!blocked,plain,cloaked,stillBlocked,log,cash,after:s.latinum,contracts:t.getOpenContracts().length};});assert.ok(r.blocked&&!r.plain&&r.cloaked&&r.stillBlocked,JSON.stringify(r));assert.equal(r.cash,f.latinum+f.expected,JSON.stringify(r));assert.equal(r.after,r.cash);assert.equal(r.contracts,0);
  });
  await check('finishing an inspection allows an uncloaked world drop without another hail',async()=>{
    const f=await prepare();const r=await ev(()=>{const t=testBM1,s=t.state;t.changeDiplomacy('terran','klingon','peace');s.factionStanding.klingon=100;const z=t.getSecurityZone();t.setCamera(z.centre.x+z.radius-40,z.centre.y);s.ship.velocity=0;const step=()=>{t.updatePowerSystems(6);t.updateSensorSystems(6);t.updateSecurityEncounters(6);};for(let i=0;i<40&&!t.getPlayerSecurityOrder();i++)step();const o=t.getPlayerSecurityOrder();if(!o)return {missing:true};t.respondToSecurityOrder('acknowledge');const hold=t.resolveSecurityPoint(z,o.hold);t.setCamera(hold.x,hold.y);for(let i=0;i<320&&!o.outcome;i++)step();const before=s.latinum;t.setCamera(z.centre.x+400,z.centre.y);t.tick(0);return {outcome:o.outcome,before,after:s.latinum,contracts:t.getOpenContracts().length,cloaked:t.isPlayerCloaked()};});assert.equal(r.outcome,'cleared',JSON.stringify(r));assert.equal(r.before,f.latinum);assert.equal(r.after,f.latinum+1000);assert.equal(r.contracts,0);assert.equal(r.cloaked,false);
  });
  assert.deepEqual(errors,[]);console.log(`${passed} briefing cargo groups passed; no page errors.`);
  await browser.close();await new Promise(r=>server.close(r));
})().catch(e=>{console.error(e);process.exit(1);});
