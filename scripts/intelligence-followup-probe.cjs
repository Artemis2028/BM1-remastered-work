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
        `\nwindow.testBM1={getPlayerDisableGraceRemaining,hasServiceChannel,getServiceTransferBlock,updateServiceRangeIndicator,isReportSystemKnown,hasIntelShips,regionalIntelFactions,recordLocalIntel,makeIntelReport,collectRegionalIntel,closePlanetMenu,negotiateContract,openGalaxyReports,openWarpBriefing,closeGalaxyReports,renderGalaxyReports,collectGalaxyReports,galaxyNewsBook,addGalaxyReport,triggerDebugEvent,triggerDebugMission,getCurrentServiceStation,hasServiceConnection,openRemoteStationShop,buyWeapon,getWeaponPrice,getWeaponIconSrc,getWeapon,getStationWeaponStock,getShipyardStock,completeShipPurchase,repairHull,createCargoRunOffer,getContractTotal,acceptPendingContract,deliverDestinationCargoAtCurrentPlanet,getCurrentDockedStation,getSecurityZone,getSecurityDockingBlock,updateSecurityOrderPanel,getPlayerSecurityOrder,respondToSecurityOrder,updatePowerSystems,updateSensorSystems,getSystemIndexByName,applyPlayerDamage,applyCurrentShipStats,getOriginalShipWeaponSlots,ensureNpcCombatStats,ensureNpcPower,startBoardingTarget,physicalNpcId,capturePolicy,canFleetDepart,beginWarpTravel,completeWarpTravel,getPlottedRoute,getShipPurchaseStatus,createRuntimeStationFromDefinition,createLightweightRuntimeStation,getStationDefinitionWorldPoint,isNpcStationTarget,Fleet,state,startWithFaction,applyDebugCommand,getFactionStanding,saveGame,loadGame,keys,heldWeaponInputs,updateStats,fleetBook,applyVesselDisablement,gameNow,tick,pauseGameClock,resumeGameClock,getSystemControl,getStationOwner,getSecurityZone,getSecurityDockingBlock,placePlayerAtSecurityApproach,playerWorldPosition,adjustFactionStanding,setSecurityPolicyOverride,clearSecurityPolicyOverride,getDelegatedPolicy,canDelegateSecurity,renderSecurityPanelMarkup,getEffectiveSecurityPolicy,isNpcSystemAttacker,recordPlayerAggressionAgainst,createNpcShip,getSystemActivity,updateSystemActivity,ensurePlaytestState,isChartSystemVisible,getPlottedRoute,markSystemVisited,getOpenContracts,getCatalogPurchaseDecision,getCurrentDockedStation,getStationVisualProfile,resolveSecurityPoint,ensureActorSensors,ensureSystemState,getOpenContracts,normalizeContract,renderOpenContractsPanel,getRecoveryStatus,recoverDisabledPlayer,getNpcCombatDurability,updateRecoveryPanel,getCurrentPurchaseVendor,getShipSaleStatus,getUnfilteredShipyardStock,isDefensePlatform,getStationDefenseProfile,destroyStation,advanceFleetCalendar,advanceFactionReconstruction,syncFactionReconstruction,getStationCombatDurability,getShipStats,ensureCombatTargetStats,applySystemState,getSystemFaction,areFactionsOpposed,areFactionsAligned,changeDiplomacy,diplomacyBook,advanceWorldDiplomacy,activityTrafficShip,getShipFaction,getMapFactionTerritoryClusters,measureIntroCrawl,showIntroStory,skipIntroStory,openGameMenu,returnToMainMenu,factionDefs,reviewLegacyHolding,renderFleetManager,updateSecurityEncounters,getPlayerSecurityOrder,respondToSecurityOrder,setCamera,openStationComms,fireStationWeapon,withStationOrbit,spawnFleetAttack,updateSystemOrbits,openTopLeftTab,restoreWorldEncounter,captureWorldEncounter};`,
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
  await check('reports respect discovery and reading them does not materialize galaxy activities',async()=>{
    const r=await ev(()=>{const t=testBM1,s=t.state;t.startWithFaction('terran');const initial=Object.keys(t.ensurePlaytestState().activities).length;
      const unknown=s.planets.findIndex((p,i)=>!t.isReportSystemKnown(i)&&t.isChartSystemVisible(i));
      const refused=!t.addGalaxyReport({id:'unknown-test',systemIndex:unknown,kind:'test',confidence:'test',text:s.planets[unknown].name});
      for(let day=1;day<=84;day++){s.day=day;t.collectGalaxyReports(day);}
      const n=t.galaxyNewsBook();return {initial,after:Object.keys(t.ensurePlaytestState().activities).length,refused,rows:n.items.length,leaks:n.items.filter(r=>r.systemIndex!=null&&!t.isReportSystemKnown(r.systemIndex)).length,pending:n.pending.length};});
    assert.equal(r.after,r.initial);assert.ok(r.refused&&r.rows>0&&r.rows<=120&&r.pending<=120);assert.equal(r.leaks,0);console.log('READ_ONLY_FEED',JSON.stringify(r));
  });
  await check('ship presence improves the source but excludes transit and destroyed vessels',async()=>{
    const r=await ev(()=>{const t=testBM1,s=t.state;t.startWithFaction('terran');const i=t.getSystemIndexByName('Vulcan');s.visitedSystems.push(i);const observation={day:s.day,kind:'raid',attacker:'klingon'};
      const civilian=t.makeIntelReport(i,observation,'presence',s.day);const f={id:'observer',systemIndex:i,assignment:'defense',vessel:{hull:100,condition:'operational'}};s.playerFleet.push(f);
      const fleet=t.makeIntelReport(i,observation,'presence',s.day);f.transit={from:i,to:s.currentPlanet};const transit=t.hasIntelShips(i);delete f.transit;f.destroyed=true;const destroyed=t.hasIntelShips(i);
      const neighbors=t.regionalIntelFactions(i);const uncharted=s.planets.findIndex((p,j)=>!t.isReportSystemKnown(j)&&t.isChartSystemVisible(j));const anonymous=t.makeIntelReport(uncharted,observation,'anonymous',s.day);
      return {civilian:civilian.confidence,fleet:fleet.confidence,transit,destroyed,neighbors,anonymous,unknownName:s.planets[uncharted].name};});
    assert.match(r.civilian,/Civilian|civilian/);assert.match(r.fleet,/Fleet/);assert.equal(r.transit,false);assert.equal(r.destroyed,false);assert.ok(!r.neighbors.includes('borg'),JSON.stringify(r.neighbors));assert.equal(r.anonymous.systemIndex,null);assert.ok(!r.anonymous.text.includes(r.unknownName));
  });
  await check('delayed reports keep original claims across new events, rereads and save/load',async()=>{
    const r=await ev(()=>{const t=testBM1,s=t.state;t.startWithFaction('terran');t.recordLocalIntel();t.collectRegionalIntel(s.day);const original=JSON.stringify(t.galaxyNewsBook().pending);const expected=t.galaxyNewsBook().pending[0];
      t.galaxyNewsBook().observations[s.currentPlanet]={day:s.day,kind:'battle',attacker:'borg'};t.collectRegionalIntel(s.day);const repeated=JSON.stringify(t.galaxyNewsBook().pending);t.saveGame(6);t.loadGame(6);const loaded=JSON.stringify(t.galaxyNewsBook().pending);s.day=expected.day;t.collectRegionalIntel(s.day);const actual=t.galaxyNewsBook().items.find(r=>r.id===expected.id);return {original,repeated,loaded,expected,actual};});
    assert.equal(r.repeated,r.original);assert.equal(r.loaded,r.original);assert.deepEqual(r.actual,r.expected);
  });
  await check('station browsing stays open at long range; transfers check range at transaction time',async()=>{
    const r=await ev(()=>{const t=testBM1,s=t.state;t.startWithFaction('terran');s.latinum=1e7;s.factionStanding.terran=100;s.weaponInventory=[];s.weaponSlots=[null,null,null];
      const vendor=s.stations.find(st=>t.getStationWeaponStock(st).some(w=>w.minMass<=s.mymass)&&t.getShipyardStock(st).length);
      t.setCamera(vendor.x+565685,vendor.y);const opened=t.openRemoteStationShop(vendor.id);const w=t.getStationWeaponStock().find(w=>w.minMass<=s.mymass&&w.guidance!=='home-on-jam');const before=s.latinum;t.buyWeapon(w.id);const blocked=s.latinum===before;
      const browse=!document.getElementById('planet-menu').classList.contains('hidden');const text=document.querySelector('[data-transporter-range]').textContent;
      t.setCamera(vendor.x+2500,vendor.y);t.buyWeapon(w.id);const bought=s.weaponInventory.includes(w.id);const after=s.latinum;t.setCamera(vendor.x+2501,vendor.y);t.buyWeapon(w.id);const movedOut=s.latinum===after;t.updateServiceRangeIndicator();return {opened,blocked,browse,text,bought,movedOut,docked:s.docked};});
    assert.ok(r.opened&&r.blocked&&r.browse&&r.bought&&r.movedOut,JSON.stringify(r));assert.match(r.text,/Browse only/);assert.equal(r.docked,false);
    await page.screenshot({path:path.join(process.env.BM1_TEST_OUTPUT||'/tmp','transporter-range.png')});
  });
  await check('full holds do not produce unloadable freight offers',async()=>{
    const r=await ev(()=>{const t=testBM1,s=t.state;t.startWithFaction('terran');s.cargo=s.cargoCap;const offer=t.createCargoRunOffer();s.cargo=s.cargoCap-1;const small=t.createCargoRunOffer();return {offer,tons:small.tons};});assert.equal(r.offer,null);assert.equal(r.tons,1);
  });
  await check('each real reconstruction loss reports once and duplicate destruction calls do not report again',async()=>{
    const r=await ev(()=>{const t=testBM1,s=t.state;t.startWithFaction('terran');const original=s.stations.find(st=>t.getStationOwner(st)==='terran');t.destroyStation(original);t.destroyStation(original);const once=t.galaxyNewsBook().items.filter(r=>r.kind==='Installation lost').length;
      for(let day=2;day<=40;day++){s.day=day;t.advanceFactionReconstruction(day);}
      const order=Object.values(t.ensurePlaytestState().reconstruction).find(o=>o.sourceId===original.id);const replacement=s.stations.find(st=>st.id===order?.newDefinition?.id&&!st.destroyed&&!st.underConstruction);
      if(!replacement)return {once,order,missing:true};t.destroyStation(replacement);t.destroyStation(replacement);const rows=t.galaxyNewsBook().items.filter(r=>r.kind==='Installation lost');t.saveGame(6);t.loadGame(6);return {once,missing:false,count:rows.length,unique:new Set(rows.map(r=>r.id)).size,after:t.galaxyNewsBook().items.filter(r=>r.kind==='Installation lost').length};});
    assert.ok(!r.missing,JSON.stringify(r));assert.equal(r.once,1);assert.equal(r.count,2);assert.equal(r.unique,2);assert.equal(r.after,2);
  });
  await check('small hull disablement grants one short saved window, then combat remains lethal',async()=>{
    const r=await ev(()=>{const t=testBM1,s=t.state;t.startWithFaction('terran');const ship=Object.values(s.shipStatsById).find(x=>/Lysian Fighter/i.test(x.name));s.playership=ship.id;t.applyCurrentShipStats(true);s.godMode=false;const pool=t.getNpcCombatDurability(s.playership).hull;const threshold=100*t.Fleet.disableThreshold(pool)/pool;s.hull=threshold+1;s.shields=0;t.applyPlayerDamage(100,'#fff',{combatUnits:true});const disabled=t.fleetBook().personalCondition;const hull=s.hull;t.applyPlayerDamage(100000,'#fff',{combatUnits:true});const protectedHull=s.hull;
      t.pauseGameClock();const remaining=t.getPlayerDisableGraceRemaining();t.saveGame(6);t.loadGame(6);const loaded=t.getPlayerDisableGraceRemaining();t.updateRecoveryPanel();return {disabled,hull,protectedHull,remaining,loaded};});
    assert.equal(r.disabled,'disabled');assert.ok(r.hull>0);assert.equal(r.protectedHull,r.hull);assert.ok(r.remaining>0&&r.remaining<=3000);assert.ok(Math.abs(r.loaded-r.remaining)<50);
    await page.screenshot({path:path.join(process.env.BM1_TEST_OUTPUT||'/tmp','disabled-grace.png')});
    const end=await ev(()=>{const t=testBM1,s=t.state;s.disableGrace.until=t.gameNow()-1;for(let i=0;i<4;i++)t.applyPlayerDamage(100000,'#fff',{combatUnits:true});const dead=s.hull===0&&s.gameOver;t.startWithFaction('terran');return {dead,reset:t.getPlayerDisableGraceRemaining()};});assert.ok(end.dead);assert.equal(end.reset,0);
  });
  assert.deepEqual(errors,[]);console.log(`${passed} intelligence follow-up groups passed; no page errors.`);
  await browser.close();await new Promise(r=>server.close(r));
})().catch(e=>{console.error(e);process.exit(1);});
