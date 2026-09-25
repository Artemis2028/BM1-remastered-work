// Gate for the §6 fleet repair/state round and the playtest fixes stacked on 416f1c0.
//
// Every check reproduces a behaviour reported from play or exposed by the §6 state matrix, and is
// written to fail on 416f1c0. The matrix itself is in the change document; the FLEET-* checks below are
// its rows that 416f1c0 got wrong, plus the rows that pin down behaviour this round had to decide.
//
//   FLEET-*          §6 fleet repair / state matrix
//   MAP-*            interstellar map layout, density and readable side rails
//   CARGO-*          jettison of contract cargo; transporter delivery without docking or cloak
//   OPS-*            inspectable, knowledge-masked active operations
//   REPORTS-*        Campaign Report is the Dominion story; Subspace News and Captain's Log hold the rest
//   PROSE-*          explanatory paragraphs removed; table labels explain themselves
const assert = require('node:assert/strict');
const path = require('node:path');
const { startProbe } = require('./probe-harness.cjs');

(async () => {
  // A laptop at 200% scaling: 1280x800 CSS pixels on a 2560x1600 panel.
  const probe = await startProbe({ pageOptions: { deviceScaleFactor: 2 } });
  const { ev, fresh, page, errors } = probe;
  const out = process.env.BM1_TEST_OUTPUT || '/tmp';
  let checks = 0;
  const failures = [];
  const window_names = [];
  async function check(name, fn) {
    checks++;
    window_names.push(name);
    try { await fn(); console.log('PASS', name); }
    catch (err) { failures.push({ name, message: String(err?.message || err) }); console.log('FAIL', name, '\n      ', String(err?.message || err).split('\n')[0]); }
  }

  // The same fleet fixtures the playtest gate uses.
  await page.evaluate(() => {
    window.__tradeSetup = (opts) => {
      const t = testBM1, s = t.state;
      const o = opts || {};
      s.latinum = o.latinum ?? 100000; s.mylatinum = s.latinum; s.day = o.day ?? 10;
      s.playerFleet.length = 0;
      const home = s.currentPlanet;
      for (let i = 0; i < (o.learn ?? 24); i++) { s.currentPlanet = i; t.markSystemVisited(i); if (typeof t.recordMarketObservation === 'function') t.recordMarketObservation(i); }
      s.currentPlanet = home;
      return { home };
    };
    window.__tradeShip = (id, opts) => {
      const t = testBM1, s = t.state;
      const o = opts || {};
      const ships = Object.values(s.shipStatsById).filter((x) => x && x.assetType === 'ship' && Number(x.cargoCapacity) > 0);
      ships.sort((a, b) => Number(a.cargoCapacity) - Number(b.cargoCapacity));
      const pick = ships[ships.length - 1];
      const f = { id, shipId: Number(pick.id), name: o.name || id, faction: s.playerFaction, assignment: 'defense', systemIndex: o.at ?? s.currentPlanet, seed: 3 };
      s.playerFleet.push(f);
      t.autoAssignFleet(f);
      return f;
    };
    window.__tradeDays = (n) => {
      const t = testBM1, s = t.state;
      for (let i = 0; i < n; i++) { s.day += 1; t.completeFleetJourneys(); t.acknowledgeCampaignOrders(); t.advanceFleetTrading(s.day); }
    };
    window.__disable = (f) => {
      const t = testBM1;
      const v = t.ensureFleetVesselSnapshot(f);
      v.hull = Math.max(1, Math.round(t.Fleet.disableThreshold(v.maxHull) * 0.5)); v.condition = 'disabled';
      const a = t.fleetLocalActor(f.id); if (a) { a.combatHull = v.hull; a.condition = 'disabled'; }
    };
    window.__repair = (f) => {
      const t = testBM1;
      const v = t.ensureFleetVesselSnapshot(f);
      v.hull = v.maxHull; v.condition = 'operational';
      const a = t.fleetLocalActor(f.id); if (a) { a.combatHull = a.maxCombatHull; a.condition = 'operational'; }
    };
    window.__remote = () => {
      const t = testBM1, s = t.state, home = Number(s.currentPlanet);
      return [...Array(s.planets.length).keys()].find((i) => i !== home && t.isChartSystemVisible(i) && !t.isSystemRelayConnected(i) && (t.getPlottedRoute(i, home)?.systems || []).length >= 3) ?? null;
    };
    window.__queued = (id) => (testBM1.campaign().orders || []).filter((o) => o.status === 'queued' && o.order === 'fleet' && o.fleetId === id).map((o) => o.command);
    window.__snap = (f) => ({ stage: f.trade?.stage, active: Boolean(f.trade?.active), resume: Boolean(f.trade?.resumeTrade), transit: f.transit ? { ...f.transit } : null,
      at: Number(f.systemIndex), order: f.trade?.order ? { kind: f.trade.order.kind, to: f.trade.order.to, pending: f.trade.order.pending, arrivedDay: f.trade.order.arrivedDay } : null,
      condition: testBM1.fleetVesselCondition ? testBM1.fleetVesselCondition(f) : f.vessel?.condition, line: testBM1.fleetTradeStatusLine(f) });
  });

  // ---------------------------------------------------------------- §6 fleet repair / state matrix
  await check('FLEET-HOLD an intentionally held ship: disabled, it says so; repaired, it holds and says it is repaired', async () => {
    await fresh('s6-hold');
    const r = await ev(() => {
      const t = testBM1, s = t.state;
      window.__tradeSetup();
      const f = window.__tradeShip('s6-hold');
      t.ensureFleetTradeState(f, 'cautious');
      t.stopFleetTrading(f.id);
      window.__disable(f);
      window.__tradeDays(1);
      const disabled = window.__snap(f);
      window.__repair(f);
      const repaired = window.__snap(f);
      window.__tradeDays(3);
      return { disabled, repaired, later: window.__snap(f) };
    });
    assert.match(r.disabled.line, /^Disabled — awaiting repair/, `disabled, her row reads "${r.disabled.line}"`);
    assert.equal(r.disabled.transit, null);
    assert.match(r.repaired.line, /^Repaired — holding/, `repaired, her row reads "${r.repaired.line}"`);
    assert.equal(r.later.active, false, 'an intentionally held ship went to work on her own after repair');
    assert.equal(r.later.transit, null);
  });

  await check('FLEET-TRADE-RESUME trading interrupted by disablement resumes by itself after repair, as an unresolved order does', async () => {
    await fresh('s6-resume');
    const r = await ev(() => {
      const t = testBM1, s = t.state;
      window.__tradeSetup();
      const f = window.__tradeShip('s6-resume');
      const tr = t.ensureFleetTradeState(f, 'any');
      tr.active = true; tr.stage = 'idle';
      window.__disable(f);
      window.__tradeDays(1);
      const disabled = window.__snap(f);
      window.__tradeDays(2);
      const still = window.__snap(f);
      window.__repair(f);
      const repaired = window.__snap(f);
      window.__tradeDays(1);
      return { disabled, still, repaired, after: window.__snap(f) };
    });
    assert.equal(r.disabled.active, false, 'disabled, she is still trading');
    assert.equal(r.disabled.resume, true, `the trading she was doing was forgotten: ${JSON.stringify(r.disabled)}`);
    assert.match(r.disabled.line, /^Disabled — awaiting repair · trading .* resumes when repaired$/, `row: "${r.disabled.line}"`);
    assert.equal(r.still.transit, null, 'disabled, she moved');
    assert.match(r.repaired.line, /^Repaired — resuming trading/, `row: "${r.repaired.line}"`);
    assert.equal(r.after.active, true, `repaired, she did not go back to trading: ${JSON.stringify(r.after)}`);
    assert.doesNotMatch(r.after.line, /Disabled|Repaired/, `row after she resumed: "${r.after.line}"`);
  });

  await check('FLEET-STOP-WHILE-DISABLED a Stop received while she lies disabled is an intentional hold: no resume after repair', async () => {
    await fresh('s6-stop');
    const r = await ev(() => {
      const t = testBM1;
      window.__tradeSetup();
      const f = window.__tradeShip('s6-stop');
      const tr = t.ensureFleetTradeState(f, 'any');
      tr.active = true; tr.stage = 'idle';
      window.__disable(f);
      window.__tradeDays(1);
      t.stopFleetTrading(f.id);
      const stopped = window.__snap(f);
      window.__repair(f);
      window.__tradeDays(2);
      return { stopped, after: window.__snap(f) };
    });
    assert.equal(r.stopped.resume, false);
    assert.equal(r.after.active, false, 'the captain said Stop and she went back to trading after repair');
    assert.match(r.after.line, /^Repaired — holding/, `row: "${r.after.line}"`);
  });

  await check('FLEET-WARP-LEG a ship disabled before her leg ends stops where it ends; her circuit and passage go no further', async () => {
    await fresh('s6-warp');
    const r = await ev(() => {
      const t = testBM1, s = t.state;
      window.__tradeSetup();
      const home = Number(s.currentPlanet);
      const dest = [...Array(s.planets.length).keys()].find((i) => i !== home && t.isChartSystemVisible(i) && (t.getPlottedRoute(home, i)?.systems || []).length >= 4);
      if (dest == null) return { found: false };
      // A passage (rendezvous) of three or more legs; disabled while on the first.
      const P = window.__tradeShip('s6-warp-passage');
      t.ensureFleetTradeState(P, 'any');
      t.orderFleetRendezvous(P.id, dest);
      const leg1 = P.transit ? { ...P.transit } : null;
      window.__disable(P);
      window.__tradeDays(Math.max(1, (leg1?.arrivalDay || s.day + 1) - s.day));
      const passage = window.__snap(P);
      window.__tradeDays(3);
      const passageLater = window.__snap(P);
      window.__repair(P);
      window.__tradeDays(1);
      const passageRepaired = window.__snap(P);
      return { found: true, leg1, passage, passageLater, passageRepaired, dest };
    });
    assert.ok(r.found, 'precondition: no destination three legs away');
    assert.ok(r.leg1, 'precondition: the passage did not start');
    assert.equal(r.passage.at, r.leg1.to, `she did not stop at the end of her leg: ${JSON.stringify(r.passage)}`);
    assert.equal(r.passage.transit, null, `disabled, the next leg was booked anyway: ${JSON.stringify(r.passage.transit)}`);
    assert.ok(r.passage.order && r.passage.order.pending && r.passage.order.to === r.dest, `the order was not kept, unresolved: ${JSON.stringify(r.passage.order)}`);
    assert.match(r.passage.line, /^Disabled — awaiting repair · .*unresolved/, `row: "${r.passage.line}"`);
    assert.equal(r.passageLater.transit, null, 'still disabled, she moved');
    assert.equal(r.passageRepaired.stage, 'passage', `repaired, she did not resume the passage: ${JSON.stringify(r.passageRepaired)}`);
  });

  await check('FLEET-QUEUED-START a Start that reaches a disabled ship waits for her repair instead of being acknowledged and lost', async () => {
    await fresh('s6-qstart');
    const r = await ev(() => {
      const t = testBM1, s = t.state;
      window.__tradeSetup();
      const home = Number(s.currentPlanet);
      const R = window.__remote();
      if (R == null) return { found: false };
      const f = window.__tradeShip('s6-qstart', { at: R });
      t.ensureFleetTradeState(f, 'cautious');
      t.sendFleetCommand(f.id, { command: 'trade-start', risk: 'risky' });
      const queued = window.__queued(f.id);
      window.__disable(f);
      s.currentPlanet = R; // the link reaches her
      window.__tradeDays(1);
      const reached = { queued: window.__queued(f.id), snap: window.__snap(f) };
      t.renderFleetManager(true);
      const rowQueued = [...document.querySelectorAll('.fleet-manager .fleet-queued')].map((e) => e.textContent).join(' | ');
      document.querySelector('.fleet-manager')?.close();
      window.__tradeDays(2);
      const waiting = window.__queued(f.id);
      window.__repair(f);
      window.__tradeDays(1);
      s.currentPlanet = home;
      return { found: true, queued, reached, rowQueued, waiting, after: window.__snap(f), risk: f.trade?.risk, left: window.__queued(f.id) };
    });
    assert.ok(r.found, 'precondition: no remote system');
    assert.deepEqual(r.queued, ['trade-start']);
    assert.deepEqual(r.reached.queued, ['trade-start'], `the Start reached a disabled ship and was acknowledged and lost: ${JSON.stringify(r.reached)}`);
    assert.match(r.rowQueued, /waiting for repair/, `the row does not say the Start is waiting for repair: "${r.rowQueued}"`);
    assert.deepEqual(r.waiting, ['trade-start']);
    assert.deepEqual(r.left, [], 'repaired, the Start is still queued');
    assert.equal(r.after.active, true, `repaired, the Start was not carried out: ${JSON.stringify(r.after)}`);
    assert.equal(r.risk, 'risky');
  });

  await check('FLEET-DISPATCH formation dispatch: disabled refused; repaired with a pending order refused; repaired and resuming — dispatch replaces the resume', async () => {
    await fresh('s6-dispatch');
    const r = await ev(() => {
      const t = testBM1, s = t.state;
      window.__tradeSetup();
      const home = Number(s.currentPlanet);
      const dest = [...Array(s.planets.length).keys()].find((i) => i !== home && t.isChartSystemVisible(i) && t.getPlottedRoute(home, i));
      const f = window.__tradeShip('s6-disp');
      const b = t.fleetBook();
      const g = b.formations.find((x) => x.members.includes(f.id));
      g.destination = dest;
      const tr = t.ensureFleetTradeState(f, 'any');
      tr.active = true; tr.stage = 'idle';
      window.__disable(f);
      window.__tradeDays(1);
      const disabled = t.dispatchFleetFormation(g.id);
      window.__repair(f);
      const resumeBefore = Boolean(f.trade.resumeTrade);
      const repaired = t.dispatchFleetFormation(g.id);
      const afterDispatch = { resume: Boolean(f.trade.resumeTrade), transit: Boolean(f.transit), line: t.fleetTradeStatusLine(f) };
      window.__tradeDays(40);
      const arrived = window.__snap(f);
      // A second ship: repaired with a recall still pending on her.
      const h = window.__tradeShip('s6-disp-2');
      t.ensureFleetTradeState(h, 'any');
      const g2 = b.formations.find((x) => x.members.includes(h.id));
      g2.destination = dest;
      window.__disable(h);
      t.orderFleetRendezvous(h.id, dest);
      window.__repair(h);
      const pending = t.dispatchFleetFormation(g2.id);
      return { disabled, resumeBefore, repaired, afterDispatch, arrived, pending, dest };
    });
    assert.equal(r.disabled, false, 'a formation with a disabled member was dispatched');
    assert.equal(r.resumeBefore, true, 'precondition');
    assert.equal(r.repaired, true, 'a repaired, resuming ship could not be dispatched');
    assert.equal(r.afterDispatch.resume, false, 'the dispatch did not replace the resume');
    assert.doesNotMatch(r.afterDispatch.line, /Repaired|Disabled/, `row after dispatch: "${r.afterDispatch.line}"`);
    assert.equal(r.arrived.active, false, `dispatched, she went back to trading on arrival: ${JSON.stringify(r.arrived)}`);
    assert.equal(r.pending, false, 'a ship with an unresolved order was dispatched (the accepted §5 rule)');
  });

  await check('FLEET-DEFENDER a ship on station knocked into the disabled band by a strategic battle is disabled and stops trading', async () => {
    await fresh('s6-defender');
    const r = await ev(() => {
      const t = testBM1, s = t.state;
      window.__tradeSetup();
      const f = window.__tradeShip('s6-def');
      const tr = t.ensureFleetTradeState(f, 'any');
      tr.active = true; tr.stage = 'idle';
      const v = t.ensureFleetVesselSnapshot(f);
      const low = Math.max(1, Math.round(t.Fleet.disableThreshold(v.maxHull) * 0.5));
      t.applyCampaignEffects([{ type: 'defenderLosses', polityId: 'player', systemIndex: Number(f.systemIndex), opId: 'gate-op', attacker: 'klingon', day: s.day,
        hulls: [{ hullId: `pf:${f.id}`, hull: low, maxHull: v.maxHull, destroyed: false }] }], s.day);
      const hit = window.__snap(f);
      window.__tradeDays(2);
      return { hit, later: window.__snap(f), hull: f.vessel.hull, max: f.vessel.maxHull };
    });
    assert.equal(r.hit.condition, 'disabled', `hull ${r.hull}/${r.max} and still ${r.hit.condition}`);
    assert.equal(r.later.active, false, 'disabled by the battle, she went on trading');
    assert.equal(r.later.transit, null);
    assert.equal(r.later.resume, true);
  });

  await check('FLEET-SAVE disabled, resuming, with a Start waiting for repair: all of it survives a save and behaves the same after', async () => {
    await fresh('s6-save');
    const r = await ev(() => {
      const t = testBM1, s = t.state;
      window.__tradeSetup();
      const R = window.__remote();
      if (R == null) return { found: false };
      const f = window.__tradeShip('s6-save', { at: R });
      const tr = t.ensureFleetTradeState(f, 'any');
      tr.active = true; tr.stage = 'idle';
      window.__disable(f);
      window.__tradeDays(1);
      const before = window.__snap(f);
      t.saveGame(7);
      t.startWithFaction('terran');
      t.loadGame(7);
      const g = t.state.playerFleet.find((x) => x.id === 's6-save');
      const after = window.__snap(g);
      window.__repair(g);
      window.__tradeDays(1);
      return { found: true, before, after, resumed: window.__snap(g) };
    });
    assert.ok(r.found, 'precondition');
    assert.deepEqual(r.after, r.before, 'the disabled state changed across the save');
    assert.equal(r.resumed.active, true, 'after the reload, repair did not resume trading');
  });

  await check('FLEET-ROW a disabled ship\'s row carries no route, call or arrival text, and queued commands are set apart from what she is doing', async () => {
    await fresh('s6-row');
    const r = await ev(() => {
      const t = testBM1, s = t.state;
      window.__tradeSetup();
      const home = Number(s.currentPlanet);
      const dest = [...Array(s.planets.length).keys()].find((i) => i !== home && t.isChartSystemVisible(i) && (t.getPlottedRoute(home, i)?.systems || []).length >= 3);
      const f = window.__tradeShip('s6-row');
      t.ensureFleetTradeState(f, 'any');
      t.orderFleetRendezvous(f.id, dest);
      window.__disable(f);
      window.__tradeDays(Math.max(1, (f.transit?.arrivalDay || s.day + 1) - s.day));
      t.renderFleetManager(true);
      const row = [...document.querySelectorAll('.fleet-manager details')].find((d) => d.querySelector('summary')?.textContent.includes('s6-row'));
      const text = row?.querySelector('.fleet-trade')?.textContent || '';
      const status = row?.querySelector('.fleet-status')?.textContent || '';
      document.querySelector('.fleet-manager')?.close();
      return { text, status };
    });
    assert.match(r.status, /^Disabled — awaiting repair/, `status: "${r.status}"`);
    assert.doesNotMatch(r.text, /Calls:|circuit ends|next .* day|arrives day|This circuit .* expected/, `stale route text: "${r.text.slice(0, 300)}"`);
  });

  // ---------------------------------------------------------------- map
  for (const vp of [{ width: 1280, height: 800 }, { width: 1920, height: 1080 }, { width: 2560, height: 1080 }, { width: 3440, height: 1440 }]) {
    await check(`MAP-LAYOUT ${vp.width}x${vp.height}: bounded chart, readable DOM rails, pan and zoom inside the chart`, async () => {
      await page.setViewportSize(vp);
      await page.waitForFunction((w) => window.innerWidth === w && document.getElementById('game').width === w, vp.width);
      await fresh(`map-${vp.width}`);
      const r = await ev(() => {
        const t = testBM1, s = t.state;
        if (!t.getStarChartLayout) return { fail: 'no chart layout: the chart stretches across the whole panel with its key painted over the corners' };
        s.selectedPlanet = s.planets.findIndex((p, i) => i !== Number(s.currentPlanet) && t.isChartSystemVisible(i));
        t.openMap();
        window.__canvasText = [];
        const C = CanvasRenderingContext2D.prototype;
        if (!window.__mapSpy) { window.__mapSpy = true; const ft = C.fillText; C.fillText = function (txt, ...rest) { (window.__canvasText ||= []).push(String(txt)); return ft.call(this, txt, ...rest); }; }
        t.drawInterstellarMapOverlay();
        const L = t.getStarChartLayout();
        const rails = [...document.querySelectorAll('.map-rail')].filter((e) => !e.classList.contains('hidden'));
        const sizes = [...document.querySelectorAll('.map-rail [data-map-line]')].filter((e) => e.offsetParent).map((e) => parseFloat(getComputedStyle(e).fontSize));
        const toggles = document.querySelectorAll('.map-rail [data-map-overlay]').length;
        const railRects = rails.map((e) => e.getBoundingClientRect()).map((b) => ({ left: b.left, right: b.right }));
        const canvasKey = window.__canvasText.some((x) => /CLICK TO TOGGLE/i.test(x));
        const c = document.getElementById('interstellar-map-canvas');
        return { fail: null, mode: L.mode, chart: L.chart, rails: railRects, minSize: Math.min(...sizes), lines: sizes.length, toggles, canvasKey, dpr: window.devicePixelRatio, backing: c.width, css: document.getElementById('game').width, zoom: s.starChart.zoom, panX: s.starChart.panX };
      });
      assert.ok(!r.fail, r.fail);
      const aspect = (r.chart.right - r.chart.left) / (r.chart.bottom - r.chart.top);
      assert.ok(aspect <= 1.6 + 1e-6, `the chart is ${aspect.toFixed(2)}:1`);
      assert.notEqual(r.mode, 'none', 'no rail at this width');
      if (vp.width >= 2560) assert.equal(r.mode, 'two', `at ${vp.width} the spare width is not framing on both sides`);
      for (const b of r.rails) assert.ok(b.right <= r.chart.left + 1 || b.left >= r.chart.right - 1, `a rail overlaps the chart: ${JSON.stringify(b)} vs ${JSON.stringify(r.chart)}`);
      assert.ok(r.lines >= 7 && r.minSize >= 14, `rail text: ${r.lines} lines, smallest ${r.minSize}px`);
      assert.equal(r.toggles, 5);
      assert.equal(r.canvasKey, false, 'the overlay key is still painted into the canvas');
      assert.equal(r.backing, r.css * r.dpr, `the chart canvas is ${r.backing} pixels for ${r.css} CSS pixels at ${r.dpr}x`);
      // Toggle by pointer; zoom with the wheel and pan with a drag inside the chart.
      const at = await ev(() => { const t = testBM1; const p = t.mapOverlayLegendRowPoint('cargo'); return { ...p, before: t.mapOverlayState().cargo }; });
      await page.mouse.click(at.x, at.y);
      assert.notEqual(await ev(() => testBM1.mapOverlayState().cargo), at.before, 'clicking the cargo toggle did not toggle it');
      const cx = (r.chart.left + r.chart.right) / 2, cy = (r.chart.top + r.chart.bottom) / 2;
      await page.mouse.move(cx, cy);
      await page.mouse.wheel(0, -300);
      await page.mouse.down(); await page.mouse.move(cx + 80, cy + 20, { steps: 4 }); await page.mouse.up();
      const moved = await ev(() => ({ zoom: testBM1.state.starChart.zoom, panX: testBM1.state.starChart.panX }));
      assert.ok(moved.zoom > r.zoom, 'the wheel did not zoom the chart');
      assert.notEqual(moved.panX, r.panX, 'a drag did not pan the chart');
      await ev(() => testBM1.drawInterstellarMapOverlay());
      await page.screenshot({ path: path.join(out, `map-${vp.width}x${vp.height}.png`) });
      await ev(() => testBM1.closeMap && testBM1.closeMap());
    });
  }
  await page.setViewportSize({ width: 1280, height: 800 });

  // ---------------------------------------------------------------- cargo
  await check('CARGO-DUMP contract cargo can be jettisoned; the confirming click fails that shipment and frees the hold for good', async () => {
    await fresh('ui-dump');
    const r = await ev(() => {
      const t = testBM1, s = t.state;
      if (!t.dumpCargoPod) return { fail: 'there is no way to dump cargo' };
      s.cargoArray.forEach((p) => { p.tons = 0; p.item = 'Nothing'; p.destination = undefined; delete p.contractId; });
      s.openContracts = [];
      t.addCargoToPods('Dilithium', 5);
      const target = s.planets.findIndex((p, i) => i !== Number(s.currentPlanet) && t.isChartSystemVisible(i));
      s.openContracts = [{ id: 'gate-dump', goods: 'Medical supplies', tons: 7, payPerTon: 40, fee: 1000, targetIndex: target, employerName: 'Gate Office', employerFaction: 'terran' }];
      t.getOpenContracts();
      t.openTopLeftTab('inventory');
      const pods = () => s.cargoArray.map((p, i) => ({ i, tons: Number(p.tons || 0), item: p.item })).filter((p) => p.tons > 0);
      const loaded = pods();
      const plainIndex = loaded.find((p) => p.item === 'Dilithium').i;
      const firstPlain = t.dumpCargoPod(plainIndex);
      const secondPlain = t.dumpCargoPod(plainIndex);
      const standing = t.getFactionStanding('terran');
      const contractIndex = pods().find((p) => p.item === 'Medical supplies').i;
      const firstContract = t.dumpCargoPod(contractIndex);
      const warning = s.log;
      const stillOpen = t.getOpenContracts().length;
      const secondContract = t.dumpCargoPod(contractIndex);
      t.renderTopLeftPanel();
      return { fail: null, loaded: loaded.length, firstPlain, secondPlain, firstContract, warning, stillOpen, secondContract,
        contracts: t.getOpenContracts().length, pods: pods(), cargo: s.cargo, standingDelta: t.getFactionStanding('terran') - standing, log: s.log };
    });
    assert.ok(!r.fail, r.fail);
    assert.equal(r.loaded, 2);
    assert.equal(r.firstPlain, false, 'a single click jettisoned cargo without confirmation');
    assert.equal(r.secondPlain, true);
    assert.equal(r.firstContract, false);
    assert.match(r.warning, /shipment for .* fails/, `no warning before dumping contract cargo: "${r.warning}"`);
    assert.equal(r.stillOpen, 1);
    assert.equal(r.secondContract, true);
    assert.equal(r.contracts, 0, 'the contract survived its cargo being dumped');
    assert.deepEqual(r.pods, [], `cargo came back after the dump: ${JSON.stringify(r.pods)}`);
    assert.equal(r.cargo, 0);
    assert.match(r.log, /failed/);
    assert.equal(r.standingDelta, -3);
  });

  // A Terran captain with cargo for Qo'noS, arriving at the edge of its checkpoint, no cloak.
  const prepare = () => ev(() => {
    const t = testBM1, s = t.state;
    t.startWithFaction('terran');
    const vendor = s.stations.find((st) => t.getShipyardStock(st).length);
    t.setCamera(vendor.x + 100, vendor.y);
    t.openRemoteStationShop(vendor.id);
    const target = t.getSystemIndexByName('Qonos');
    const offer = { ...t.createCargoRunOffer(), targetIndex: target, targetName: 'Qonos', tons: 2, fee: 0, payPerTon: 500 };
    s.pendingContractOffer = offer;
    t.acceptPendingContract();
    t.closePlanetMenu();
    s.currentPlanet = target; s.myplanet = target + 1;
    t.applySystemState(target);
    t.placePlayerAtSecurityApproach();
    return { latinum: s.latinum, expected: 1000 };
  });
  await check('CARGO-TRANSPORT a hostile destination, no cloak, no docking: within transporter range the captain beams the cargo down', async () => {
    const f = await prepare();
    const r = await ev(() => {
      const t = testBM1, s = t.state;
      const range = t.CARGO_TRANSPORT_RANGE ?? 600;
      const planet = s.systemPlanet;
      t.setCamera(planet.x + range + 20, planet.y);
      const far = t.deliverDestinationCargoAtCurrentPlanet({ manual: true });
      t.setCamera(planet.x + Math.min(range, 2500) - 100, planet.y);
      t.updateSecurityEncounters(1);
      const status = t.getWorldCargoDeliveryStatus();
      const cash = s.latinum;
      t.tick(0); t.tick(0);
      const afterTicks = s.latinum;
      t.openTopLeftTab('contracts');
      const button = Boolean(document.querySelector('[data-cargo-drop]'));
      return { range, far, docked: Boolean(s.docked), cloaked: t.isPlayerCloaked(), blocked: Boolean(t.getSecurityDockingBlock()), status, cash, afterTicks, button };
    });
    assert.ok(r.range >= 2500, `delivery range is ${r.range} units, not transporter range`);
    assert.equal(r.far, false, 'cargo was delivered from beyond transporter range');
    assert.ok(!r.docked && !r.cloaked && r.blocked, `precondition: ${JSON.stringify(r)}`);
    assert.equal(r.afterTicks, r.cash, 'cargo was beamed into a checkpoint that had not cleared the captain without being ordered');
    assert.ok(r.button, 'no Beam cargo down button at the destination');
    await ev(() => document.querySelector('[data-cargo-drop]').click());
    const after = await ev(() => ({ latinum: testBM1.state.latinum, contracts: testBM1.getOpenContracts().length, log: testBM1.state.log }));
    assert.equal(after.contracts, 0, `the order to beam it down did not deliver: ${after.log}`);
    assert.equal(after.latinum, f.latinum + f.expected, 'the contract did not pay in full');
  });
  await check('CARGO-CLOAK delivery while cloaked stays valid and still happens on approach', async () => {
    const f = await prepare();
    const r = await ev(() => {
      const t = testBM1, s = t.state;
      t.setCamera(s.systemPlanet.x + 500, s.systemPlanet.y);
      t.setPlayerCloak(true);
      t.tick(0);
      return { latinum: s.latinum, contracts: t.getOpenContracts().length, cloaked: t.isPlayerCloaked() };
    });
    assert.ok(r.cloaked, 'precondition');
    assert.equal(r.contracts, 0);
    assert.equal(r.latinum, f.latinum + f.expected);
  });

  // ---------------------------------------------------------------- operations
  await check('OPS-DETAIL the operation count opens onto the operations; a reported one shows the account, never the operation\'s own facts', async () => {
    await fresh('ui-ops');
    const r = await ev(() => {
      const t = testBM1, s = t.state;
      const book = t.campaign();
      const here = Number(s.currentPlanet);
      const target = s.planets.findIndex((p, i) => i !== here && t.isChartSystemVisible(i));
      t.markSystemVisited(target);
      book.operations.push({ id: 'gate-op-1', faction: 'klingon', kind: 'gatesecretkind', targetSystem: target, status: 'moving', launchedDay: s.day, arriveDay: s.day + 3, losses: 7, hulls: [] });
      t.addGalaxyReport({ id: 'op-launch:gate-op-1', systemIndex: target, day: s.day, kind: 'Fleet movement', category: 'campaign', confidence: 'Relay dispatch — identity confirmed, strength unverified', factions: ['klingon'], claimedAttacker: 'klingon', text: `Relay traffic reports a Klingon force moving on ${s.planets[target].name}. Strength not established.` });
      t.openCampaignPanel('powers');
      return { hasButton: Boolean(document.querySelector('[data-campaign-power-ops="klingon"]')), target: s.planets[target].name };
    });
    assert.ok(r.hasButton, 'the Klingon operation count is not clickable');
    await page.locator('[data-campaign-power-ops="klingon"]').click();
    const detail = await ev(() => document.querySelector('.campaign-ops-detail')?.textContent || '');
    assert.match(detail, new RegExp(r.target), `the detail does not say where: ${detail}`);
    assert.match(detail, /under way/);
    assert.match(detail, /last report day \d+/);
    assert.match(detail, /Relay dispatch/);
    assert.doesNotMatch(detail, /gatesecretkind/, 'the detail printed the operation\'s type, which no account gave');
    assert.doesNotMatch(detail, /7 lost|hulls present/, 'the detail printed losses or strength no account gave');
    await page.screenshot({ path: path.join(out, 'powers-ops-detail.png') });
    await page.locator('[data-campaign-power-ops="klingon"]').click();
    assert.equal(await ev(() => document.querySelectorAll('.campaign-ops-detail').length), 0, 'a second click did not close it');
    await ev(() => testBM1.closeCampaignPanel());
  });

  // ---------------------------------------------------------------- reports
  await check('REPORTS-CAMPAIGN the jump briefing\'s Campaign Report is the Dominion story; Captain\'s Log and Subspace News hold the rest', async () => {
    await fresh('ui-reports');
    const r = await ev(() => {
      const t = testBM1, s = t.state;
      const b = t.galaxyNewsBook(); b.items = []; b.readIds = []; b.pending = [];
      const here = s.currentPlanet;
      t.addGalaxyReport({ id: 'dominion:missing-patrols', systemIndex: null, day: s.day, kind: 'Strategic warning', category: 'campaign', confidence: 'Unconfirmed civilian report', factions: [], text: 'Patrols near the wormhole have stopped reporting on schedule.' });
      t.addGalaxyReport({ id: `convoy:${here}:${s.day}`, systemIndex: here, day: s.day, kind: 'Reinforcement convoy', category: 'campaign', confidence: 'Fleet assessment', factions: ['dominion'], claimedAttacker: 'dominion', text: 'Convoy.' });
      t.addGalaxyReport({ id: 'op-launch:gate-kl', systemIndex: null, day: s.day, kind: 'Fleet movement', category: 'campaign', confidence: 'Relay dispatch', factions: ['klingon', 'romulan'], claimedAttacker: 'klingon', text: 'Klingon force moving.' });
      t.addGalaxyReport({ id: 'war-resolved:romulan:klingon:3', systemIndex: null, day: s.day, kind: 'War resolved', category: 'campaign', confidence: 'Campaign record', factions: ['romulan', 'klingon'], text: 'War over.' });
      t.addGalaxyReport({ id: `fleet-losses:x:${s.day}`, systemIndex: here, day: s.day, kind: 'Fleet losses', category: 'campaign', confidence: 'Campaign record', factions: ['klingon'], playerRelated: true, text: 'Lost ships.' });
      t.addGalaxyReport({ id: 'recovery:r1', systemIndex: here, day: s.day, kind: 'Design at risk', category: 'campaign', confidence: 'Campaign record', factions: [], text: 'Yard gone.' });
      const cat = Object.fromEntries(b.items.map((x) => [x.id.split(':')[0], t.galaxyReportCategory ? t.galaxyReportCategory(x) : null]));
      const to = s.planets.findIndex((p, i) => i !== Number(here) && t.isChartSystemVisible(i));
      t.beginWarpTravel(to, t.getPlottedRoute(here, to));
      t.openWarpBriefing();
      const ids = (sel) => [...document.querySelectorAll(`${sel} .galaxy-report`)].map((a) => a.dataset.reportId);
      const summaries = [...document.querySelectorAll('#galaxy-reports .report-section summary')].map((x) => x.textContent);
      const res = { cat, campaign: ids('[data-report-campaign]'), log: ids('[data-report-personal]'), news: ids('[data-report-background]'), summaries };
      t.closeGalaxyReports();
      return res;
    });
    assert.deepEqual(r.cat, { dominion: 'campaign', convoy: 'campaign', 'op-launch': 'fronts', 'war-resolved': 'fronts', 'fleet-losses': 'combat', recovery: 'contracts' });
    assert.deepEqual([...r.campaign].sort(), [`convoy`, 'dominion'].map((p) => r.campaign.find((id) => id.startsWith(p))).sort(), `Campaign Report: ${JSON.stringify(r.campaign)}`);
    assert.equal(r.campaign.length, 2);
    assert.ok([...r.log, ...r.news].every((id) => !/^(dominion|convoy):/.test(id)), 'a Dominion report is also shown in the other sections');
    assert.ok(r.news.includes('op-launch:gate-kl') && r.news.includes('war-resolved:romulan:klingon:3'), `ordinary galaxy events are not in Subspace News: ${JSON.stringify(r.news)}`);
    assert.ok(r.log.includes(r.log.find((id) => id.startsWith('fleet-losses:'))), `the captain's own loss is not in the Captain's Log: ${JSON.stringify(r.log)}`);
    assert.ok(r.summaries.some((x) => /^Campaign report/.test(x)) && r.summaries.some((x) => /^Captain's log/.test(x)) && r.summaries.some((x) => /^Subspace news/.test(x)), `sections: ${JSON.stringify(r.summaries)}`);
  });

  // ---------------------------------------------------------------- prose
  await check('PROSE the intelligence screens carry no explanatory paragraphs; the table says "Known worlds"; the wormhole section is terse', async () => {
    await fresh('ui-prose');
    const r = await ev(() => {
      const t = testBM1, s = t.state;
      const out = [];
      for (const tab of ['powers', 'operations', 'empire']) { t.openCampaignPanel(tab); out.push(document.getElementById('campaign-panel').textContent); }
      t.closeCampaignPanel();
      t.openGalaxyReports(); out.push(document.getElementById('galaxy-reports').textContent); t.closeGalaxyReports();
      t.openTopLeftTab('contracts'); out.push(document.getElementById('top-left-panel')?.textContent || document.body.textContent);
      // A warning heard, the power not yet met.
      t.campaign().dominion.warnings.push({ id: 'missing-patrols', day: s.day, text: 'Patrols near Bajora have stopped reporting on schedule.' });
      t.openCampaignPanel('powers');
      const wormhole = document.querySelector('#campaign-panel .campaign-wormhole')?.textContent || '';
      const headers = [...document.querySelectorAll('#campaign-panel .campaign-table th')].map((th) => th.textContent);
      t.closeCampaignPanel();
      return { text: out.join('\n'), wormhole, headers };
    });
    for (const phrase of [/Estimates carry an error band/, /Any active power can rise/, /timetable is not visible/, /This section reports what reached you/, /This panel shows what you have observed/, /never merged into a faction's books/, /Readiness is derived/, /count as read/, /Reports may be delayed/, /Toggle the layers from the legend/, /What you have heard/]) {
      assert.doesNotMatch(r.text + r.wormhole, phrase);
    }
    assert.ok(r.headers.includes('Known worlds'), `headers: ${JSON.stringify(r.headers)}`);
    assert.match(r.wormhole, /^Bajoran Wormhole/, `wormhole section: "${r.wormhole.slice(0, 120)}"`);
    assert.match(r.wormhole, /Patrols near the wormhole silent\./);
    assert.match(r.wormhole, /Day \d+: /);
    assert.doesNotMatch(r.wormhole, /Dominion/, 'the section names the Dominion before the captain has met it');
  });

  console.log(`${checks - failures.length}/${checks} checks pass.`);
  // Categories, fixed per check (see section6-verification-gate.cjs for the definitions). Measured
  // against 416f1c0, the tree this gate was written for.
  const CATEGORY = [[/^FLEET-WARP-LEG/, 'synthetic-guard'], [/^FLEET-DISPATCH/, 'new-feature'], [/^FLEET-/, 'baseline-defect'],
    [/^MAP-/, 'new-feature'], [/^CARGO-CLOAK/, 'preservation'], [/^CARGO-/, 'baseline-defect'], [/^OPS-/, 'new-feature'],
    [/^REPORTS-/, 'baseline-defect'], [/^PROSE/, 'baseline-defect']];
  const failed = new Set(failures.map((f) => f.name));
  const tally = {};
  for (const name of window_names) { const cat = (CATEGORY.find(([re]) => re.test(name)) || [null, 'uncategorised'])[1]; (tally[cat] ||= { pass: 0, fail: 0 })[failed.has(name) ? 'fail' : 'pass']++; }
  for (const [k, v] of Object.entries(tally)) console.log(`  ${k}: ${v.pass} pass, ${v.fail} fail`);
  if (failures.length) { for (const f of failures) console.log(`  - ${f.name}: ${f.message.split('\n')[0]}`); process.exitCode = 1; }
  if (errors.length) { console.log(`page errors: ${errors.join(' | ')}`); process.exitCode = 1; }
  await Promise.race([probe.close(), new Promise((r) => setTimeout(r, 15000))]);
  process.exit(process.exitCode || 0);
})().catch((e) => { console.error(e); process.exit(1); });
