// Screenshots for the §6 verification handoff (not a gate). 1280x800 CSS at 2x.
const path = require('node:path');
const { startProbe } = require('./probe-harness.cjs');
(async () => {
  const out = process.env.BM1_TEST_OUTPUT || '/tmp';
  const probe = await startProbe({ pageOptions: { deviceScaleFactor: 2 } });
  const { ev, fresh, page } = probe;
  // 1. Cargo confirmation.
  await fresh('shot-cargo');
  await ev(() => { const t = testBM1, s = t.state; const dest = s.planets.findIndex((p, i) => i !== Number(s.currentPlanet) && t.isChartSystemVisible(i));
    s.openContracts = [{ id: 'shot-a', goods: 'Medical supplies', tons: 7, payPerTon: 40, fee: 1000, targetIndex: dest, employerName: 'Earth Contract Office', employerFaction: 'terran' }];
    t.getOpenContracts(); t.openTopLeftTab('contracts'); document.querySelector('[data-contract-abandon="shot-a"]').click(); });
  await page.screenshot({ path: path.join(out, 'cargo-dump-confirmation.png') });
  // 2. Fleet row: disabled, trading resumes when repaired; and repaired, recovering.
  await fresh('shot-fleet');
  await ev(() => { const t = testBM1, s = t.state; s.latinum = 200000;
    const ships = Object.values(s.shipStatsById).filter((x) => x && x.assetType === 'ship' && Number(x.cargoCapacity) > 0).sort((a, b) => Number(a.cargoCapacity) - Number(b.cargoCapacity));
    const f = { id: 'Freighter-1', shipId: Number(ships[ships.length - 1].id), name: 'Freighter-1', faction: s.playerFaction, assignment: 'defense', systemIndex: s.currentPlanet, seed: 3 };
    s.playerFleet.push(f); t.autoAssignFleet(f); const tr = t.ensureFleetTradeState(f, 'cautious'); tr.active = true; tr.stage = 'idle';
    s.npcShips.push(...t.getPlayerFleetNpcShips().filter((n) => n.fleetId === f.id)); const a = t.fleetLocalActor(f.id); t.ensureNpcCombatStats(a);
    a.combatHull = Math.max(1, Math.floor(t.Fleet.disableThreshold(a.maxCombatHull) * 0.5)); t.applyVesselDisablement(a);
    s.day += 1; t.advanceFleetTrading(s.day); t.renderFleetManager(true); const d = [...document.querySelectorAll('.fleet-manager details')].find((x) => x.textContent.includes('Freighter-1')); d.open = true; });
  await page.screenshot({ path: path.join(out, 'fleet-row-disabled.png') });
  await ev(() => { const t = testBM1, s = t.state; document.querySelector('.fleet-manager').close(); const a = t.fleetLocalActor('Freighter-1');
    s.docked = true; s.dockedStationId = null; s.dockedPlanetIndex = s.currentPlanet; t.setCamera(a.x, a.y); if (a.power) a.power.combat = false; a.lastShieldHitAt = 0;
    t.repairFleetVessel('Freighter-1'); t.renderFleetManager(true); const d = [...document.querySelectorAll('.fleet-manager details')].find((x) => x.textContent.includes('Freighter-1')); d.open = true; });
  await page.screenshot({ path: path.join(out, 'fleet-row-recovering.png') });
  await ev(() => document.querySelector('.fleet-manager').close());
  // 3. Jump briefing: Campaign report / Captain's log / Subspace news.
  await fresh('shot-briefing');
  await ev(() => { const t = testBM1, s = t.state; const b = t.galaxyNewsBook(); b.items = []; b.readIds = [];
    t.applyCampaignEffects([{ type: 'dominionWarning', id: 'missing-patrols', text: 'Patrols near Bajora have stopped reporting on schedule.', systemIndex: null, day: s.day }], s.day);
    t.addGalaxyReport({ id: 'war-resolved:romulan:cardassian:1', systemIndex: null, day: s.day, kind: 'War resolved', category: 'campaign', confidence: 'Campaign record', factions: ['romulan', 'cardassian'], text: 'The Romulan–Cardassian war has ended.' });
    t.addGalaxyReport({ id: 'op-launch:shot-dom', systemIndex: s.currentPlanet, day: s.day, kind: 'Fleet movement', category: 'campaign', confidence: 'Relay dispatch', factions: ['dominion'], claimedAttacker: 'dominion', text: 'Relay traffic reports a Dominion remnant force moving on a border world.' });
    t.addGalaxyReport({ id: `fleet-losses:x:${s.day}`, systemIndex: s.currentPlanet, day: s.day, kind: 'Fleet damaged', category: 'campaign', confidence: 'Campaign record', factions: ['klingon'], playerRelated: true, text: 'Klingon forces engaged your vessels. Damaged: Freighter-1.' });
    const to = s.planets.findIndex((p, i) => i !== Number(s.currentPlanet) && t.isChartSystemVisible(i)); t.beginWarpTravel(to, t.getPlottedRoute(s.currentPlanet, to)); t.openWarpBriefing(); });
  await page.screenshot({ path: path.join(out, 'jump-briefing-sections.png') });
  await ev(() => testBM1.closeGalaxyReports());
  // 4. Operations after loss of contact.
  await fresh('shot-ops');
  await ev(() => { const t = testBM1, s = t.state; const book = t.campaign(); const here = Number(s.currentPlanet);
    const hulls = book.polities.klingon.hulls.filter((h) => h.status !== 'lost').slice(0, 5);
    const op = { id: 'shot-watch', faction: 'klingon', kind: 'raid', targetSystem: here, status: 'engaged', launchedDay: s.day - 2, arriveDay: s.day, losses: 1, hullIds: hulls.map((h) => h.id) };
    book.operations.push(op); t.openCampaignPanel('operations'); t.closeCampaignPanel();
    s.currentPlanet = s.planets.findIndex((p, i) => i !== here && t.isChartSystemVisible(i) && !t.isSystemRelayConnected(i)); s.day += 5; op.losses = 9;
    t.openCampaignPanel('powers'); document.querySelector('[data-campaign-power-ops="klingon"]')?.click(); });
  await page.screenshot({ path: path.join(out, 'ops-after-loss-of-contact.png') });
  await Promise.race([probe.close(), new Promise((r) => setTimeout(r, 15000))]);
  process.exit(0);
})().catch((e) => { console.error(e); process.exit(1); });
