// In-game gate for the rated round of SHIP-DEPENDENT-STRATEGIC-SPEED (docs/movement/SHIP-DEPENDENT-STRATEGIC-SPEED.md).
// The real engine, chart and catalogue: each class's approved rating as the fleet shows it; a formation of an Intrepid
// and a Danube at the Danube's pace, named as its limit, with its ETA; the captain's own course at his current ship's
// rating, and slower once he changes to a slower ship; a trader's passage at its own hull's rating; a blockade
// interception (tactical handoff) at an intermediate system on the day the captain's adjusted leg reaches it; and the
// strategic-journey debug fields (each participant's rating, the limiter, base → flown legs, planned vs arrived).
// Expected values are computed here from bm-ships/ships.json and the chart's own legs: max(1, ceil(chart / multiplier)).
// Categories:
//   baseline-defect  7d3ce43 flies category speeds with legs rounded to nearest (fails on its own assertion)
//   new-feature      needs this round's ratings, labels or debug fields
//   preservation     must hold on both
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { startProbe } = require('./probe-harness.cjs');

(async () => {
  const probe = await startProbe({ viewport: { width: 1400, height: 900 }, pageOptions: { deviceScaleFactor: 2 } });
  const { ev, fresh, page } = probe;
  const out = process.env.BM1_TEST_OUTPUT || '/tmp';
  fs.mkdirSync(out, { recursive: true });
  const results = [];
  const evidence = [];
  async function check(category, name, fn) {
    try { await fn(); results.push({ category, name, ok: true }); console.log('PASS', `[${category}]`, name); }
    catch (err) { results.push({ category, name, ok: false, message: String(err?.message || err).split('\n').slice(0, 6).join(' ') }); console.log('FAIL', `[${category}]`, name, '\n      ', String(err?.message || err).split('\n').slice(0, 8).join(' ')); }
  }
  async function shotSection(file, selector) {
    await ev(() => testBM1.closeGalaxyReports?.());
    await ev((sel) => { const d = document.getElementById('cheats-debug'); if (!d.open) testBM1.openDebugMenu(); for (const x of d.querySelectorAll('section')) if (!x.matches(sel)) x.style.display = 'none'; d.style.maxHeight = 'none'; d.style.height = 'auto'; d.style.width = '1360px'; d.style.maxWidth = 'none'; d.style.overflow = 'visible'; d.style.position = 'absolute'; d.style.top = '0'; }, selector);
    const h = await ev((sel) => Math.ceil(document.querySelector(sel).getBoundingClientRect().bottom + window.scrollY + 40), selector);
    await page.setViewportSize({ width: 1400, height: Math.min(7000, Math.max(900, h)) });
    await page.locator(selector).screenshot({ path: path.join(out, file) });
    await page.setViewportSize({ width: 1400, height: 900 });
    await ev(() => { const d = document.getElementById('cheats-debug'); for (const x of d.querySelectorAll('section')) x.style.display = ''; d.removeAttribute('style'); d.close(); testBM1.closeGalaxyReports?.();
      const c = testBM1.playtestClock; if (c.stoppedAt !== null) { c.offset += performance.now() - c.stoppedAt; c.stoppedAt = null; } });
  }
  async function shotFleet(file, selector) {
    await ev((sel) => { testBM1.renderFleetManager(true); document.querySelector(sel)?.scrollIntoView({ block: 'center' }); }, selector);
    await page.waitForTimeout(150);
    await page.screenshot({ path: path.join(out, file) });
    await ev(() => document.querySelectorAll('dialog[open]').forEach((d) => d.close()));
  }
  // The star chart with the captain's course to `to` plotted: the legend reads "From → To: N days" at his speed.
  async function shotMap(file, to) {
    const open = await ev((to) => { const t = testBM1; document.querySelectorAll('dialog[open]').forEach((d) => d.close()); t.closeGalaxyReports?.(); if (!t.state.mapOpen) t.openMap(); t.state.selectedPlanet = to; t.render(); return [...document.querySelectorAll('dialog[open]')].map((d) => d.className); }, to);
    if (open.length) console.log('open dialogs at map shot:', open);
    await page.waitForTimeout(300);
    await ev(() => testBM1.render());
    await page.waitForTimeout(150);
    const text = await ev(() => document.querySelector('[data-map-eta]')?.textContent.trim() || null);
    await page.screenshot({ path: path.join(out, file) });
    await ev(() => { testBM1.closeMap(); });
    return text;
  }
  await page.waitForFunction(() => !testBM1.doctrineStatus || testBM1.doctrineStatus().state !== 'loading', null, { timeout: 30000 }).catch(() => {});

  const CAT = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'bm-ships', 'ships.json'), 'utf8')).ships;
  const cls = (name) => { const s = CAT.find((x) => x.name === name); if (!s) throw new Error(`no class ${name}`); return s; };
  const SPEEDS = Object.fromEntries(CAT.map((x) => [x.id, x.strategicSpeed ?? 1]));
  const LABEL = Object.fromEntries(CAT.map((x) => [x.id, `${Number(x.strategicSpeedRating).toFixed(1)}/10 · ${Number(x.strategicSpeed).toFixed(2)}×`]));
  const INTREPID = cls('Intrepid Explorer').id, DANUBE = cls('Danube Utility Runabout').id, GALAXY = cls('Galaxy Class').id, SAILOR = cls('Bajoran Solar Sailor').id;

  const setup = () => page.evaluate((SPEEDS) => {
    const t = testBM1;
    window.__SP = SPEEDS;
    window.__at = (base, speed) => base.map((b) => Math.max(1, Math.ceil(b / speed - 1e-9)));
    window.__sum = (a) => a.reduce((n, d) => n + d, 0);
    window.__adv = (n) => { for (let i = 0; i < n; i++) t.advanceFleetCalendar(1, t.Fleet.nextId(t.fleetBook(), 'journey')); };
    window.__idx = (name) => t.getSystemIndexByName(name);
    window.__chart = (route) => t.routeLegDays(route);
    window.__ship = (id, at, shipId, assignment = 'defense', hull = 1200) => {
      t.state.playerFleet.push({ id, shipId: Number(shipId), name: id, systemIndex: at, assignment, destroyed: false, vessel: { hull, maxHull: hull, condition: 'operational' } });
      return id;
    };
    window.__formation = (name, at, ships) => {
      const b = t.fleetBook();
      const ids = ships.map(([label, sid]) => window.__ship(label, at, sid));
      const g = t.Fleet.addFormation(b, name);
      for (const id of ids) t.Fleet.assignFormation(b, id, g.id);
      return g.id;
    };
    window.__g = (id) => t.fleetBook().formations.find((g) => g.id === id);
    // The captain alone: no escort warps with him (his ship's rating is what these checks measure).
    window.__alone = () => { for (const f of t.state.playerFleet) if (f.assignment === 'escort') f.assignment = 'defense'; };
    window.__setShip = (id) => { t.state.playership = Number(id); t.applyCurrentShipStats(true); t.state.antimatter = Math.max(t.state.antimatter, 999); };
    window.__fly = (to) => {
      const plan = t.getPlottedRoute(t.state.currentPlanet, to);
      if (!plan) return { fail: 'no route' };
      t.state.antimatter = Math.max(t.state.antimatter, 999);
      const speed = t.captainCourseSpeed();
      const day0 = t.state.day;
      if (!t.beginWarpTravel(to, plan) && !t.state.warp.active) return { fail: 'warp refused' };
      t.openWarpBriefing?.(); t.closeGalaxyReports?.();
      t.completeWarpTravel();
      return { day0, day: t.state.day, at: t.state.currentPlanet, path: plan.systems, speed, chart: window.__chart(plan), legDays: t.routeLegDays(plan, speed) };
    };
    window.__quiet = () => { const db = t.DoctrineCampaign.doctrineBook(t.campaign()); db.config = { ...db.config, patrols: {}, explorers: {}, merchants: {}, projects: {}, patrolAreas: {}, militaryResponses: false, enforcementResponses: false }; t.campaign().config.aiStrategicOps = false; };
  }, SPEEDS);

  // 1 ---------------------------------------------------------------------------------------------
  await check('new-feature', 'FLEET-RATING each class carries its approved rating: the anchors read as the rater gives them, and a Galaxy in the fleet shows "Strategic speed: 8.5/10 · 1.28×"', async () => {
    await fresh('sr-fleet');
    await setup();
    const r = await ev((C) => {
      const t = testBM1;
      const E = window.__idx('Earth');
      window.__ship('USS Galaxy Test', E, C.GALAXY); window.__ship('USS Danube Test', E, C.DANUBE);
      t.renderFleetManager(true);
      const line = (id) => document.querySelector(`[data-fleet-speed="${id}"]`)?.textContent.replace(/\s+/g, ' ').trim() || '';
      const anchors = Object.fromEntries(C.ANCHORS.map((id) => [id, t.shipStrategicSpeed(id)]));
      return { galaxy: line('USS Galaxy Test'), danube: line('USS Danube Test'), anchors };
    }, { GALAXY, DANUBE, ANCHORS: CAT.filter((x) => x.strategicSpeedBasis === 'rater:table' && x.strategicSpeedConfidence === 'high').map((x) => x.id) });
    await shotFleet('SPEED-RATING-fleet-vessel-speed.png', '[data-fleet-speed="USS Galaxy Test"]');
    evidence.push({ check: 'FLEET-RATING', ...r });
    for (const [id, v] of Object.entries(r.anchors)) assert.equal(v, SPEEDS[id], `class ${id} (${CAT.find((x) => x.id === Number(id)).name}) flies ${v}, rated ${SPEEDS[id]}`);
    // (A ship in a formation also shows the formation's pace after its own.)
    assert.ok(r.galaxy.startsWith('Strategic speed: 8.5/10 · 1.28×'), r.galaxy);
    assert.ok(r.danube.startsWith(`Strategic speed: ${LABEL[DANUBE]}`), r.danube);
  });

  // 2 ---------------------------------------------------------------------------------------------
  await check('baseline-defect', 'SLOWEST-FORMATION-UI an Intrepid (10/10) and a Danube (3/10) in one formation bound for Vulcan: the formation shows "3.0/10 · 0.85× (limited by Danube)" and its ETA at that pace; dispatched, it flies those legs and arrives on its planned day, which the journey debug shows with every participant\'s rating', async () => {
    await fresh('sr-formation');
    await setup();
    const r = await ev((C) => {
      const t = testBM1;
      const A = window.__idx('Earth'), D = window.__idx('Vulcan');
      const gid = window.__formation('Survey Group', A, [['USS Swift', C.INTREPID], ['USS Plodder', C.DANUBE]]);
      window.__g(gid).destination = D;
      window.__gid = gid;
      const route = t.getPlottedRoute(A, D);
      t.renderFleetManager(true);
      const line = document.querySelector(`[data-formation-speed="${gid}"]`)?.textContent.replace(/\s+/g, ' ').trim() || '';
      return { gid, line, chart: window.__chart(route), slow: window.__at(window.__chart(route), window.__SP[C.DANUBE]), fast: window.__at(window.__chart(route), window.__SP[C.INTREPID]), A, D };
    }, { INTREPID, DANUBE });
    await shotFleet('SPEED-RATING-slowest-member-formation.png', `[data-formation-speed="${r.gid}"]`);
    const d = await ev(() => {
      const t = testBM1;
      const ok = t.dispatchFleetFormation(window.__gid);
      const tr = window.__g(window.__gid).travel;
      t.renderFleetManager(true);
      return { ok, id: tr.id, legDays: tr.legDays.slice(), eta: tr.etaDay, planned: tr.plannedEtaDay ?? null, speed: tr.speed, start: tr.startDay };
    });
    await shotSection('SPEED-RATING-journey-debug-fields.png', '[data-journey-section]');
    const dbg = await ev(() => {
      testBM1.openDebugMenu();
      const row = [...document.querySelectorAll('[data-journey-row]')].find((x) => /Survey Group|USS Swift/.test(x.textContent));
      const g = (sel) => row?.querySelector(sel)?.textContent.replace(/\s+/g, ' ').trim() || '';
      const x = { effective: g('[data-journey-effective]'), limiter: g('[data-journey-limiter]'), participants: g('[data-journey-participants]'), legs: g('[data-journey-legs]') };
      document.getElementById('cheats-debug').close(); testBM1.closeGalaxyReports?.();
      return x;
    });
    const fin = await ev(() => { let guard = 0; while (window.__g(window.__gid).travel.status === 'underway' && guard++ < 80) window.__adv(1); const tr = window.__g(window.__gid).travel; return { status: tr.status, arrived: tr.arrivedDay }; });
    await shotSection('SPEED-RATING-journey-debug-planned-vs-arrived.png', '[data-journey-section]');
    // The formation's own row in the "Recently ended" table.
    const ended = await ev((id) => { testBM1.openDebugMenu(); const row = [...document.querySelectorAll('[data-journey-ended-row]')].find((r) => r.getAttribute('data-journey-ended-row') === id); const x = row?.querySelector('[data-journey-planned-actual]')?.textContent.trim() ?? null; document.getElementById('cheats-debug').close(); testBM1.closeGalaxyReports?.(); return x; }, d.id);
    evidence.push({ check: 'SLOWEST-FORMATION-UI', ...r, dispatch: d, debug: dbg, fin, ended });
    const days = r.slow.reduce((n, x) => n + x, 0);
    assert.equal(r.line, `Strategic speed: ${LABEL[DANUBE]} (limited by USS Plodder) · Earth → Vulcan: ${days} days`);
    assert.ok(d.ok, 'dispatch refused');
    assert.deepEqual(d.legDays, r.slow, `the formation flies ${d.legDays}; the chart ${r.chart} at the Danube's pace is ${r.slow}`);
    assert.equal(d.speed, SPEEDS[DANUBE]);
    assert.equal(d.planned, d.eta); assert.equal(d.eta, d.start + days);
    assert.equal(dbg.effective, LABEL[DANUBE]);
    assert.equal(dbg.limiter, 'limited by USS Plodder');
    assert.equal(dbg.participants, `USS Swift ${LABEL[INTREPID]}; USS Plodder ${LABEL[DANUBE]}`);
    assert.match(dbg.legs, new RegExp(`base → flown: ${r.chart.map((c, i) => `${c}→${r.slow[i]}`).join(' · ')}`));
    assert.match(dbg.legs, new RegExp(`planned day ${d.planned} · now due day ${d.eta}`));
    assert.equal(fin.status, 'arrived'); assert.equal(fin.arrived, d.planned, `arrived day ${fin.arrived}, planned ${d.planned}`);
    assert.ok(ended && ended.startsWith(`planned day ${d.planned} · arrived day ${d.planned} (as planned)`), `the formation's ended row reads ${JSON.stringify(ended)}`);
  });

  // 3 ---------------------------------------------------------------------------------------------
  await check('baseline-defect', 'CAPTAIN-SHIP-SPEED (16, 17) the captain\'s own course Earth → Vulcan in an Intrepid (10/10) takes the chart\'s legs at 1.40×, and the course back after he changes to a Danube (3/10) takes them at 0.85×: the map\'s ETA and the calendar charge agree each time', async () => {
    await fresh('sr-captain');
    await setup();
    const a = await ev((C) => {
      const t = testBM1, s = t.state;
      window.__alone();
      const E = window.__idx('Earth'), V = window.__idx('Vulcan');
      s.currentPlanet = E; t.applySystemState(E); t.markSystemVisited(V);
      window.__setShip(C.INTREPID);
      s.selectedPlanet = V;
      const plan = t.getPlottedRoute(E, V);
      return { mapDays: t.fleetTradeRouteDays(plan, t.captainCourseSpeed()), speed: t.captainCourseSpeed(), E, V };
    }, { INTREPID });
    a.chartText = await shotMap('SPEED-RATING-captain-route-eta-intrepid.png', a.V);
    const flyA = await ev((V) => window.__fly(V), a.V);
    const b = await ev((C) => {
      const t = testBM1, s = t.state;
      window.__setShip(C.DANUBE);
      s.selectedPlanet = C.E;
      const plan = t.getPlottedRoute(s.currentPlanet, C.E);
      return { mapDays: t.fleetTradeRouteDays(plan, t.captainCourseSpeed()), speed: t.captainCourseSpeed(), ship: s.playership };
    }, { DANUBE, E: a.E });
    b.chartText = await shotMap('SPEED-RATING-captain-route-eta-danube.png', a.E);
    const flyB = await ev((E) => window.__fly(E), a.E);
    evidence.push({ check: 'CAPTAIN-SHIP-SPEED', a, flyA, b, flyB });
    assert.ok(!flyA.fail && !flyB.fail, flyA.fail || flyB.fail);
    assert.equal(a.speed, SPEEDS[INTREPID]); assert.equal(b.speed, SPEEDS[DANUBE]);
    const expA = flyA.chart.map((c) => Math.max(1, Math.ceil(c / SPEEDS[INTREPID] - 1e-9))), expB = flyB.chart.map((c) => Math.max(1, Math.ceil(c / SPEEDS[DANUBE] - 1e-9)));
    assert.equal(flyA.at, a.V); assert.equal(flyB.at, a.E);
    assert.equal(flyA.day - flyA.day0, expA.reduce((n, x) => n + x, 0), `the Intrepid's course took ${flyA.day - flyA.day0} days; the chart ${flyA.chart} at 1.40× is ${expA}`);
    assert.equal(flyB.day - flyB.day0, expB.reduce((n, x) => n + x, 0), `the Danube's course took ${flyB.day - flyB.day0} days; the chart ${flyB.chart} at 0.85× is ${expB}`);
    assert.equal(a.mapDays, flyA.day - flyA.day0, 'the map\'s ETA is not what the Intrepid\'s course was charged');
    assert.equal(b.mapDays, flyB.day - flyB.day0, 'the map\'s ETA is not what the Danube\'s course was charged');
    assert.ok(flyB.day - flyB.day0 > flyA.day - flyA.day0, 'changing to the slower ship did not slow the next course');
    assert.equal(a.chartText, `Earth → Vulcan: ${flyA.day - flyA.day0} days`, 'the star chart\'s course ETA (Intrepid)');
    assert.equal(b.chartText, `Vulcan → Earth: ${flyB.day - flyB.day0} days`, 'the star chart\'s course ETA (Danube)');
  });

  // 4 ---------------------------------------------------------------------------------------------
  await check('baseline-defect', 'TRADER-ETA (14) two of the captain\'s traders ordered Earth → Vulcan the same day: an Intrepid and a Solar Sailor each fly the chart\'s legs at their own hull\'s rating and arrive on the day those legs add up to', async () => {
    await fresh('sr-trader');
    await setup();
    const r = await ev((C) => {
      const t = testBM1, s = t.state;
      const E = window.__idx('Earth'), V = window.__idx('Vulcan');
      t.markSystemVisited(V);
      window.__ship('Fast Trader', E, C.INTREPID); window.__ship('Slow Trader', E, C.SAILOR);
      const okF = t.orderFleetPassage('Fast Trader', V, 'rendezvous'), okS = t.orderFleetPassage('Slow Trader', V, 'rendezvous');
      window.__adv(1);
      const st = (id) => { const f = s.playerFleet.find((x) => x.id === id); const tr = t.ensureFleetTradeState(f); return { legDays: (tr.legDays || []).slice(), order: tr.order ? { ...tr.order } : null, at: t.fleetShipSystem(f), stage: tr.stage }; };
      const day0 = s.day - 1;
      const route = t.getPlottedRoute(E, V);
      const plan = { fast: st('Fast Trader'), slow: st('Slow Trader') };
      const arrived = {};
      for (let i = 0; i < 90 && Object.keys(arrived).length < 2; i++) {
        for (const id of ['Fast Trader', 'Slow Trader']) { const x = st(id); if (!arrived[id] && x.at === V && (x.order?.arrivedDay != null || !x.order)) arrived[id] = s.day; }
        if (Object.keys(arrived).length < 2) window.__adv(1);
      }
      return { okF, okS, day0, chart: window.__chart(route), plan, arrived, fastExp: window.__at(window.__chart(route), window.__SP[C.INTREPID]), slowExp: window.__at(window.__chart(route), window.__SP[C.SAILOR]),
        orderDays: { fast: plan.fast.order?.day ?? null, slow: plan.slow.order?.day ?? null } };
    }, { INTREPID, SAILOR });
    evidence.push({ check: 'TRADER-ETA', ...r });
    assert.ok(r.okF && r.okS, 'passage refused');
    assert.deepEqual(r.plan.fast.legDays, r.fastExp, `the Intrepid trader flies ${r.plan.fast.legDays}; the chart ${r.chart} at 1.40× is ${r.fastExp}`);
    assert.deepEqual(r.plan.slow.legDays, r.slowExp, `the Solar Sailor flies ${r.plan.slow.legDays}; the chart ${r.chart} at 0.70× is ${r.slowExp}`);
    assert.ok(r.arrived['Fast Trader'] < r.arrived['Slow Trader'], JSON.stringify(r.arrived));
    assert.equal(r.arrived['Slow Trader'] - r.arrived['Fast Trader'], r.slowExp.reduce((n, x) => n + x, 0) - r.fastExp.reduce((n, x) => n + x, 0), `arrivals ${JSON.stringify(r.arrived)}: the difference is not the legs' difference`);
  });

  // 5 ---------------------------------------------------------------------------------------------
  // Paso → Alpha Centauri → Earth with Alpha Centauri blockaded by the Klingons, flown in a Danube: the seed
  // searched until the crossing is intercepted (the strategic layer's own contact draw), then the handoff day checked.
  const interceptRun = async (seed) => {
    await fresh(seed); await setup();
    return ev((C) => {
      const t = testBM1;
      const P = window.__idx('Paso'), AC = window.__idx('Alpha Centauri'), E = window.__idx('Earth');
      for (const i of [P, AC, E]) t.markSystemVisited(i);
      window.__quiet(); window.__alone();
      t.state.currentPlanet = P; t.state.myplanet = P + 1; t.applySystemState(P); t.placePlayerAtSecurityApproach?.();
      window.__setShip(C.DANUBE);
      t.state.hull = 100; t.state.shields = 100; t.fleetBook().personalCondition = 'operational';
      const book = t.campaign(); t.syncPlayerPolity(book);
      const kl = book.polities.klingon.hulls.filter((h) => h.status === 'ready' && !h.opId && !h.transit).slice(0, 12);
      for (const h of kl) h.systemIndex = AC;
      const fx = [];
      const b = t.Campaign.startBlockade(book, t.buildCampaignWorld(true), { power: 'klingon', target: AC, hullIds: kl.map((h) => h.id), purpose: 'interdict_trade' }, t.state.day, fx);
      t.applyCampaignEffects(fx, t.state.day);
      if (!b.ok) return { fail: 'no blockade' };
      const f = window.__fly(E);
      const enc = (t.campaign().encounters || []).filter((e) => e.type === 'blockade').slice(-1)[0] || null;
      return { ...f, P, AC, E, stop: t.state.warp.stop || null, enc: enc && { id: enc.id, status: enc.status, captain: enc.captain, day: enc.day ?? enc.startDay ?? null }, resume: t.state.warpResume ? { destination: t.state.warpResume.destination, path: t.state.warpResume.path } : null };
    }, { DANUBE });
  };
  await check('baseline-defect', 'HANDOFF-ADJUSTED-DAY (19, 20) a Danube captain intercepted at a blockaded intermediate system: he is stopped there — the tactical handoff pending — on the day his first leg at 0.85× reaches it, not the chart\'s day', async () => {
    let r = null;
    for (let i = 0; i < 40; i++) { const x = await interceptRun(`sr-intercept-${i}`); if (x.at === x.AC && x.stop?.type === 'blockade') { r = { ...x, seed: i }; break; } if (i === 39) r = x; }
    evidence.push({ check: 'HANDOFF-ADJUSTED-DAY', ...r });
    assert.ok(r && !r.fail, r?.fail);
    assert.equal(r.at, r.AC, `no seed intercepted the captain at Alpha Centauri: ${JSON.stringify(r.stop)}`);
    const leg0 = Math.max(1, Math.ceil(r.chart[0] / SPEEDS[DANUBE] - 1e-9));
    assert.equal(r.speed, SPEEDS[DANUBE]);
    assert.equal(r.day - r.day0, leg0, `he reached Alpha Centauri ${r.day - r.day0} days out; the chart's ${r.chart[0]} at 0.85× is ${leg0}`);
    assert.ok(leg0 !== r.chart[0] || r.chart[0] === 1, 'the leg is the same at chart pace; the check would not tell them apart');
    assert.ok(r.enc && r.enc.captain && r.enc.status === 'pending', JSON.stringify(r.enc));
    assert.equal(r.resume?.destination, r.E);
  });

  fs.writeFileSync(path.join(out, 'strategic-speed-rating-gate.json'), JSON.stringify({ results, evidence }, null, 1));
  const failed = results.filter((x) => !x.ok);
  const by = (c) => { const x = results.filter((y) => y.category === c); return `${x.filter((y) => y.ok).length}/${x.length}`; };
  console.log(`\nstrategic speed ratings in-game: ${results.length - failed.length}/${results.length} (baseline-defect ${by('baseline-defect')}, new-feature ${by('new-feature')}, preservation ${by('preservation')})${failed.length ? ` — FAILED: ${failed.map((x) => x.name.split(' ')[0]).join(', ')}` : ''}`);
  await probe.close?.();
  process.exit(failed.length ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(2); });
