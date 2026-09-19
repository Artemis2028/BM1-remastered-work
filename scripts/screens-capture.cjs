// Every screenshot in the pack, taken against the built tree in one pass, through the mouse rather
// than through the engine: each panel is opened by clicking its dock button, and the script refuses to
// take a shot while any dialog is open or while a control it just pressed did not answer. The previous
// pack's shots were taken with Fleet & Shipyard open over them, which is how the modal bug was found.
const assert = require('node:assert/strict');
const { startProbe } = require('./probe-harness.cjs');
const OUT = process.env.BM1_SCREENS_OUT || '/home/claude/bm1/patch2/validation/screens';

(async () => {
  const probe = await startProbe();
  const { ev, fresh, page } = probe;
  const problems = [];
  const note = (m) => { problems.push(m); console.log('   !!', m); };

  const openDialogs = () => ev(() => [...document.querySelectorAll('dialog[open]')].map((d) => d.id || d.className));
  const shot = async (name, clip) => {
    const open = await openDialogs();
    if (open.length) note(`${name}: taken with a dialog open — ${open.join(', ')}`);
    await page.screenshot({ path: `${OUT}/${name}.png`, ...(clip ? { clip } : {}) });
    console.log('shot', name);
  };
  // A real press at the element's own coordinates: this is what tells a control that renders from one
  // that answers.
  const press = async (selector, label) => {
    const box = await page.locator(selector).first().boundingBox();
    if (!box) { note(`${label}: "${selector}" is not on screen`); return false; }
    await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
    await page.waitForTimeout(150);
    return true;
  };
  const panelShot = async (name) => {
    await page.waitForTimeout(180);
    const b = await page.locator('#top-left-panel').boundingBox();
    if (!b) { note(`${name}: the top-left panel is not on screen`); return; }
    await shot(name, { x: Math.max(0, b.x - 8), y: Math.max(0, b.y - 8), width: b.width + 16, height: b.height + 16 });
  };

  // ---- the HUD at the widths this is played at ----
  for (const [name, width, height] of [['hud-wide', 1920, 1080], ['hud-laptop-1536', 1536, 864], ['hud-laptop-1440', 1440, 900], ['hud-laptop-1280', 1280, 800]]) {
    await fresh(`shot-${width}`);
    await page.setViewportSize({ width, height });
    await page.waitForTimeout(280);
    await ev(() => { testBM1.updateStats(); });
    await shot(name);
  }

  await page.setViewportSize({ width: 1440, height: 900 });
  await fresh('shot-panels');
  await page.waitForTimeout(250);

  // ---- panels, each opened by pressing its own dock button ----
  await press('#bottom-dock [data-dock-action="power"]', 'PWR');
  if (!(await ev(() => testBM1.state.topLeftTab === 'power' && testBM1.state.topLeftPanelOpen))) note('PWR did not open the power panel');
  await panelShot('panel-power');

  await press('#bottom-dock [data-dock-action="ew"]', 'EW');
  if (!(await ev(() => testBM1.state.topLeftTab === 'ew' && testBM1.state.topLeftPanelOpen))) note('EW did not open the EW panel');
  await panelShot('panel-ew');

  // Close the panel before the fleet manager, so nothing of one is in the shot of the other.
  await press('#top-left-panel [data-top-action="close-panel"]', 'panel close');
  await press('#bottom-dock [data-dock-action="fleet"]', 'FLT');
  if (!(await ev(() => Boolean(document.querySelector('dialog.fleet-manager')?.open)))) note('FLT did not open the fleet manager');
  await page.waitForTimeout(280);
  // This one is a dialog, so it is the only shot allowed to have one open.
  await page.screenshot({ path: `${OUT}/panel-fleet.png` });
  console.log('shot panel-fleet');
  await press('dialog.fleet-manager [data-fleet-action="close"]', 'fleet close');
  if (await ev(() => Boolean(document.querySelector('dialog.fleet-manager')?.open))) note('the fleet manager would not close from its own × control');

  // ---- something to actually carry ----
  const set = await ev(() => {
    const t = testBM1, s = t.state;
    s.day = 12;
    const charted = (s.planets || []).map((p, i) => i)
      .filter((i) => i !== Number(s.currentPlanet) && t.isChartSystemVisible(i) && !t.isDominionCoreSystem(s.planets[i].name));
    const a = charted[3], b = charted[7];
    for (const i of [a, b]) if (!s.visitedSystems.includes(i)) s.visitedSystems.push(i);
    const book = t.campaignBook();
    t.acceptCampaignMission(t.offerStationMission('recon', a).id, { announce: false });
    t.acceptCampaignMission(t.offerStationMission('repair', b).id, { announce: false });
    // A recovery contract with the engineers already aboard, so the moved objective is in the shot.
    const ship = Object.values(s.shipStatsById)
      .find((x) => x && x.assetType === 'ship' && x.rosterState === 'active' && x.mass <= 3 && x.faction === 'terran');
    book.recoveries.push({ id: 'shot-recovery', shipId: Number(ship.id), lostStationId: 'shot-lost',
      systemIndex: charted[11], kind: 'engineers', status: 'available', createdDay: s.day,
      completedDay: null, relocatedTo: null, attempts: 0 });
    t.startDesignRecovery('shot-recovery');
    const rec = (book.missions || []).find((m) => m.kind === 'archive' && m.status === 'active');
    rec.step = 'deliver'; rec.carrying = true;
    s.openContracts = [
      { id: 'shot-cargo-1', goods: 'medical supplies', tons: 12, payPerTon: 44, targetIndex: a, employerName: 'Relief Office' },
      { id: 'shot-cargo-2', goods: 'duranium', tons: 30, payPerTon: 18, targetIndex: b, employerName: 'Yard Agent' },
    ];
    t.getOpenContracts();
    return { a, b, aName: s.planets[a].name, bName: s.planets[b].name, ship: ship.name };
  });

  // The probe stubs requestAnimationFrame at startup, so the game's own frame loop is not running and
  // nothing repaints the canvas. paint() stands in for one frame of it, called before every press and
  // every shot from here down. It paints; it does not interact — every press below is a real mouse
  // click at the control's own coordinates.
  const paint = () => ev(() => { try { testBM1.drawInterstellarMapOverlay(); } catch (e) {} });


  // Answer the standing hail for the layer shots: the chart-with-a-hail case has a shot of its own at
  // the end, and these are meant to show the layers rather than the panel arrangement.
  await press('#security-order-panel [data-arrival-ack]', 'Acknowledge hail');
  if (await ev(() => !document.getElementById('security-order-panel')?.classList.contains('hidden'))) {
    note('the incoming hail would not clear from its own Acknowledge control');
  }

  // A captain with some history behind them, so the conditions layer shows what it is for rather than a
  // galaxy of question marks. These are real observations — stand in the system, take the reading — at
  // different days, plus one of their own ships left on station.
  const observedAt = await ev(() => {
    const t = testBM1, s = t.state;
    const home = Number(s.currentPlanet);
    const charted = (s.planets || []).map((p, i) => i).filter((i) => t.isChartSystemVisible(i));
    let day = 4;
    const seen = [];
    for (const i of charted.slice(0, 20)) {
      if (i === home) continue;
      s.day = day;
      s.currentPlanet = i;
      t.applySystemState(i);
      t.markSystemVisited(i);
      t.conditionsFor(i);
      seen.push({ i, day });
      day += 3;
    }
    s.day = 70;
    s.currentPlanet = home;
    t.applySystemState(home);
    // One ship left watching, so a live remote reading is on the chart beside the dated ones.
    const watched = seen[12]?.i ?? seen[0].i;
    s.playerFleet.push({ id: 'shot-eyes', shipId: 1, faction: 'terran', assignment: 'patrol',
      systemIndex: watched, vessel: { hull: 100, condition: 'ready' } });
    s.conditionsRev = (s.conditionsRev || 0) + 1;
    // Select a world the captain saw a while ago, so the readout shows a dated reading.
    s.selectedPlanet = seen[3]?.i ?? watched;
    return { watched, selected: s.selectedPlanet, seen: seen.length };
  });

  // ---- contracts, opened by pressing CONTRACT ----
  await press('#bottom-dock [data-dock-action="contract"]', 'CON');
  if (!(await ev(() => testBM1.state.topLeftTab === 'contracts' && testBM1.state.topLeftPanelOpen))) note('CONTRACT did not open the contracts list');
  await panelShot('panel-contracts');

  // and its controls have to answer a real press
  const before = await ev(() => ({ mapOpen: testBM1.state.mapOpen, selected: Number(testBM1.state.selectedPlanet) }));
  await press(`#top-left-panel [data-contract-show="${set.a}"]`, 'Show on map');
  const afterShow = await ev(() => ({ mapOpen: testBM1.state.mapOpen, selected: Number(testBM1.state.selectedPlanet) }));
  if (!afterShow.mapOpen || afterShow.selected !== set.a) {
    note(`"Show on map" did not take the chart to ${set.aName}: mapOpen ${before.mapOpen}->${afterShow.mapOpen}, selected ${before.selected}->${afterShow.selected}`);
  }

  // ---- the same populated chart, with each layer turned off from the legend by pressing it ----
  await page.waitForTimeout(320);
  await paint();
  await shot('map-overlay');
  const legendPress = async (key) => {
    await paint();
    const p = await ev((key) => {
      const t = testBM1;
      const r = t.getStarChartPanelRect();
      const n = t.MAP_OVERLAY_LAYERS.findIndex((l) => l.key === key);
      const y = r.bottom - 18 - t.MAP_OVERLAY_LAYERS.length * 18 + 9 + n * 18 - 4;
      const c = document.getElementById('game');
      const rect = c.getBoundingClientRect();
      return { x: rect.left + (r.left + 40) * (rect.width / c.width), y: rect.top + y * (rect.height / c.height),
        was: Boolean(t.mapOverlayState()[key]) };
    }, key);
    await page.mouse.click(p.x, p.y);
    await page.waitForTimeout(200);
    const now = await ev((key) => Boolean(testBM1.mapOverlayState()[key]), key);
    if (now === p.was) note(`the legend row for "${key}" did not answer a press at its own coordinates`);
    return now;
  };
  await legendPress('cargo');
  await paint();
  await shot('map-overlay-cargo-off');
  await legendPress('cargo');
  await legendPress('routes');
  await paint();
  await shot('map-overlay-routes-off');
  await legendPress('routes');
  await legendPress('security');
  await paint();
  await shot('map-overlay-security-off');
  await legendPress('security');
  await legendPress('lanes');
  await paint();
  await shot('map-overlay-lanes-off');
  await legendPress('lanes');
  await legendPress('routes');
  await legendPress('contracts');
  await paint();
  await shot('map-overlay-contracts-off');
  await legendPress('contracts');

  // The chart with an unanswered hail standing, which is the state a captain is in when they check the
  // map on arrival. Both panels have to be whole; the script checks that rather than trusting the eye.
  await ev(() => {
    const t = testBM1, s = t.state;
    t.closeMap();
    const target = t.getSystemIndexByName('Qonos');
    s.currentPlanet = target;
    t.applySystemState(target);
    t.placePlayerAtSecurityApproach();
    t.updateSecurityOrderPanel();
    t.openMap();
    t.updateSecurityOrderPanel();
  });
  await paint();
  await page.waitForTimeout(220);
  const both = await ev(() => {
    const hail = document.getElementById('security-order-panel');
    const close = document.getElementById('btn-close-map');
    if (!hail || hail.classList.contains('hidden')) return { fail: 'no hail is up' };
    const hits = (el) => {
      const b = el?.getBoundingClientRect();
      if (!b || b.width <= 0) return false;
      const at = document.elementFromPoint(Math.round(b.left + b.width / 2), Math.round(b.top + b.height / 2));
      return Boolean(at && (at === el || el.contains(at) || at.contains(el)));
    };
    return { fail: null, ack: hits(hail.querySelector('[data-arrival-ack]')),
      channels: hits(hail.querySelector('[data-comms="open"]')), close: hits(close) };
  });
  if (both.fail) note(`hail-over-chart shot: ${both.fail}`);
  else {
    if (!both.ack) note('with the chart open, "Acknowledge hail" does not answer a click at its own coordinates');
    if (!both.channels) note('with the chart open, "Station channels" does not answer a click at its own coordinates');
    if (!both.close) note('with a hail up, the chart\'s own close control does not answer a click at its own coordinates');
  }
  await shot('map-with-pending-hail');

  console.log(JSON.stringify({ ...set, ...observedAt }));
  if (problems.length) {
    console.log(`\n${problems.length} problem(s) with these captures:`);
    for (const p of problems) console.log(`  - ${p}`);
    process.exitCode = 1;
  } else {
    console.log('\nevery capture was taken with no dialog open and every control pressed answered.');
  }
  await Promise.race([probe.close(), new Promise((r) => setTimeout(r, 12000))]);
  process.exit(process.exitCode || 0);
})().catch((e) => { console.error(e); process.exit(1); });
