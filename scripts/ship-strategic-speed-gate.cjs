// In-game gate for SHIP-DEPENDENT-STRATEGIC-SPEED (docs/movement/SHIP-DEPENDENT-STRATEGIC-SPEED.md). The real
// engine, the real chart and the real ship catalogue: the class speeds as the shipyard shows them, a fast
// and a slow formation flying the same route (planned ETA = actual arrival), a mixed formation flying at its
// slowest member and speeding up once the slow ship leaves it (save/load between the legs), the captain's
// own course at his slowest escort, an evacuation convoy at its slowest transport, a doctrine rescue a fast
// relief ship can make and a slow one cannot, and the AI's war planning at its force's speed.
// Rated round: every expected speed is the class's approved rating as bm-ships/ships.json carries it (read by the
// gate itself), and every leg is max(1, ceil(chart / multiplier)). The Kingston (5/10, now the chart's own pace)
// is replaced as the slow ship by the Danube Utility Runabout (3/10 · 0.85×).
// Categories:
//   baseline-defect  7d3ce43 flies category speeds with legs rounded to nearest (fails on its own assertion)
//   new-feature      needs this round's speed field, labels or records
//   preservation     must hold on both (none here: the existing gates are the preservation)
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
    await ev((sel) => { const t = testBM1; t.renderFleetManager(true); document.querySelector(sel)?.scrollIntoView({ block: 'center' }); }, selector);
    await page.waitForTimeout(150);
    await page.screenshot({ path: path.join(out, file) });
    await ev(() => document.querySelectorAll('dialog[open]').forEach((d) => d.close()));
  }
  await page.waitForFunction(() => !testBM1.doctrineStatus || testBM1.doctrineStatus().state !== 'loading', null, { timeout: 30000 }).catch(() => {});
  const hasSpeed = await ev(() => Boolean(testBM1.Speed));

  // The catalogue's speeds, read here (not from the build under test), so a baseline's expectations are the
  // ones this round defines; every expected day count below is computed in the gate from the chart's own
  // legs: max(1, round(chart / speed)).
  const CAT = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'bm-ships', 'ships.json'), 'utf8')).ships;
  const SPEEDS = Object.fromEntries(CAT.map((x) => [x.id, x.strategicSpeed ?? 1]));
  const LABEL = Object.fromEntries(CAT.map((x) => [x.id, `${Number(x.strategicSpeedRating).toFixed(1)}/10 · ${Number(x.strategicSpeed).toFixed(2)}×`]));
  const re = (s) => new RegExp(s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'));
  // The classes used throughout, from the real catalogue.
  const SABER = 307, KINGSTON = 308; // Saber Planetary Defender (7.5/10 · 1.20×) · Danube Utility Runabout (3/10 · 0.85×), the slow ship
  const setup = () => page.evaluate((SPEEDS) => {
    const t = testBM1;
    window.__SP = SPEEDS;
    window.__at = (base, speed) => base.map((b) => Math.max(1, Math.ceil(b / speed - 1e-9)));
    window.__adv = (n) => { for (let i = 0; i < n; i++) t.advanceFleetCalendar(1, t.Fleet.nextId(t.fleetBook(), 'journey')); };
    window.__idx = (name) => t.getSystemIndexByName(name);
    window.__ship = (id, at, shipId, hull = 1200, assignment = 'defense') => {
      t.state.playerFleet.push({ id, shipId: Number(shipId), name: id, systemIndex: at, assignment, destroyed: false, vessel: { hull, maxHull: hull, condition: 'operational' } });
      return id;
    };
    window.__formation = (name, at, shipIds) => {
      const b = t.fleetBook();
      const ids = shipIds.map((sid, k) => window.__ship(`${name}-${k}`, at, sid));
      const g = t.Fleet.addFormation(b, name);
      for (const id of ids) t.Fleet.assignFormation(b, id, g.id);
      return g.id;
    };
    window.__g = (id) => t.fleetBook().formations.find((g) => g.id === id);
    window.__members = (id) => window.__g(id).members.map((m) => t.state.playerFleet.find((f) => f.id === m)).filter(Boolean);
    // The chart's legs (speed 1.0 on every build) at `speed`, by the formula.
    window.__days = (route, speed) => { const base = t.routeLegDays(route); return speed == null ? base : window.__at(base, speed); };
    window.__quiet = () => { const db = t.DoctrineCampaign.doctrineBook(t.campaign()); db.config = { ...db.config, patrols: {}, explorers: {}, merchants: {}, projects: {}, patrolAreas: {}, reliefShips: {} }; t.campaign().config.aiStrategicOps = false; };
  }, SPEEDS);

  // 1 ---------------------------------------------------------------------------------------------
  await check('new-feature', 'SHIPYARD each class on offer shows its strategic speed: a fast escort and a slow freighter side by side, as the catalogue gives them', async () => {
    await fresh('sp-yard');
    await setup();
    const r = await ev(() => {
      const t = testBM1, s = t.state;
      s.currentPlanet = t.getSystemIndexByName('Earth'); t.applySystemState(s.currentPlanet);
      const yard = s.stations.find((st) => /Human Shipyard/.test(t.getShipStats(st.stationTypeId)?.name || '') && t.getStationOwner(st) === 'terran');
      s.docked = true; s.dockedStationId = yard.id; s.dockedPlanetIndex = s.currentPlanet; s.remoteStationId = null; t.setCamera(yard.x, yard.y);
      s.planetMenuOpen = true; s.dockMenuTab = 'market'; t.renderPlanetMenu();
      document.querySelector('.market-section .shipyard')?.scrollIntoView({ block: 'start' });
      const cards = [...document.querySelectorAll('.market-section .shipyard article, .market-section .shipyard .ship-card')].map((c) => c.textContent.replace(/\s+/g, ' ').slice(0, 160));
      const speeds = Object.fromEntries([2, 4, 9, 11, 35, 307, 308, 49, 212].map((id) => [id, t.shipStrategicSpeed ? t.shipStrategicSpeed(id) : null]));
      const card = (re) => cards.find((c) => re.test(c)) || '';
      return { saber: card(/Saber Planetary Defender/), kingston: card(/Danube Utility Runabout/), cards: cards.slice(0, 12), speeds, html: document.querySelector('.market-section .shipyard')?.innerHTML.includes('Strategic speed') };
    });
    evidence.push({ check: 'SHIPYARD', ...r });
    await page.screenshot({ path: path.join(out, 'SPEED-shipyard-class-speeds.png') });
    await ev(() => { const s = testBM1.state; s.planetMenuOpen = false; testBM1.renderPlanetMenu(); });
    assert.ok(r.html, 'the shipyard shows no strategic speed');
    for (const id of [307, 308, 35, 9, 2]) assert.equal(r.speeds[id], SPEEDS[id], `class ${id}`);
    assert.match(r.saber, re(LABEL[SABER]), r.saber); if (r.kingston) assert.match(r.kingston, re(LABEL[KINGSTON]), r.kingston);
  });

  // 2 ---------------------------------------------------------------------------------------------
  await check('baseline-defect', 'FAST-VS-SLOW-ETA the same route, Earth → Vulcan: a Saber formation (7.5/10 · 1.20×) and a Danube runabout (3/10 · 0.85×) dispatched the same day; each leg and the arrival are the ships\' own, and each arrives on exactly the day its plan said', async () => {
    await fresh('sp-fastslow');
    await setup();
    const r = await ev((C) => {
      const t = testBM1, s = t.state;
      const A = window.__idx('Earth'), D = window.__idx('Vulcan');
      const fast = window.__formation('Saber Wing', A, [C.SABER, C.SABER]);
      const slow = window.__formation('Freighter Group', A, [C.KINGSTON]);
      window.__g(fast).destination = D; window.__g(slow).destination = D;
      const route = t.getPlottedRoute(A, D);
      const day0 = s.day;
      const okF = t.dispatchFleetFormation(fast), okS = t.dispatchFleetFormation(slow);
      const plan = (id) => { const tr = window.__g(id).travel; return { legDays: tr.legDays.slice(), eta: tr.etaDay ?? (tr.startDay + tr.legDays.reduce((n, d) => n + d, 0)), speed: tr.speed ?? null }; };
      const pf = plan(fast), ps = plan(slow);
      t.renderFleetManager(true);
      const lineF = document.querySelector(`[data-formation-travel="${fast}"]`)?.textContent || '';
      const lineS = document.querySelector(`[data-formation-travel="${slow}"]`)?.textContent || '';
      window.__fastG = fast; window.__slowG = slow;
      return { okF, okS, day0, systems: route.systems, chart: window.__days(route, 1), pf, ps, lineF, lineS, expectF: window.__days(route, window.__SP[C.SABER]), expectS: window.__days(route, window.__SP[C.KINGSTON]) };
    }, { SABER, KINGSTON });
    await ev(() => { const t = testBM1; t.renderFleetManager(true); document.querySelector(`[data-formation-travel="${window.__fastG}"]`)?.scrollIntoView({ block: 'center' }); });
    await page.screenshot({ path: path.join(out, 'SPEED-fast-vs-slow-dispatched-fleet.png') });
    await ev(() => document.querySelectorAll('dialog[open]').forEach((d) => d.close()));
    await shotSection('SPEED-journey-debug-fast-vs-slow.png', '[data-journey-section]');
    const arr = await ev(() => {
      const t = testBM1, s = t.state;
      const done = {};
      for (let i = 0; i < 80 && Object.keys(done).length < 2; i++) {
        window.__adv(1);
        for (const id of [window.__fastG, window.__slowG]) { const tr = window.__g(id).travel; if (!done[id] && tr.status === 'arrived') done[id] = tr.arrivedDay; }
      }
      return { fast: done[window.__fastG], slow: done[window.__slowG] };
    });
    evidence.push({ check: 'FAST-VS-SLOW-ETA', ...r, arrived: arr });
    assert.ok(r.okF && r.okS, 'dispatch refused');
    assert.deepEqual(r.pf.legDays, r.expectF, `the Saber formation flies ${r.pf.legDays}; the chart ${r.chart} at 1.20× is ${r.expectF}`);
    assert.deepEqual(r.ps.legDays, r.expectS, `the freighter flies ${r.ps.legDays}; the chart ${r.chart} at 0.85× is ${r.expectS}`);
    assert.ok(arr.fast < arr.slow, `the fast formation arrived day ${arr.fast}, the slow one day ${arr.slow}`);
    assert.equal(arr.fast, r.pf.eta, 'the fast formation did not arrive on its planned day');
    assert.equal(arr.slow, r.ps.eta, 'the slow formation did not arrive on its planned day');
    assert.match(r.lineF, re(`strategic speed ${LABEL[SABER]}`)); assert.match(r.lineS, re(`strategic speed ${LABEL[KINGSTON]}`));
  });

  // 3 ---------------------------------------------------------------------------------------------
  await check('baseline-defect', 'CONVOY-SLOWEST-MEMBER two Sabers escorting a Danube runabout fly at the runabout\'s 0.85×; the runabout taken out of the formation during the first leg, the next leg flies at 1.20×; save/load between the legs changes nothing', async () => {
    await fresh('sp-convoy');
    await setup();
    const r = await ev((C) => {
      const t = testBM1, s = t.state;
      const A = window.__idx('Earth'), D = window.__idx('Vulcan');
      const gid = window.__formation('Convoy', A, [C.SABER, C.SABER, C.KINGSTON]);
      window.__g(gid).destination = D;
      const route = t.getPlottedRoute(A, D);
      t.dispatchFleetFormation(gid);
      window.__convoyG = gid;
      const tr = window.__g(gid).travel;
      return { systems: route.systems, legDays0: tr.legDays.slice(), slow: window.__days(route, window.__SP[C.KINGSTON]), fast: window.__days(route, window.__SP[C.SABER]), speed: tr.speed ?? null, start: tr.startDay, firstEnd: tr.startDay + tr.legDays[0] };
    }, { SABER, KINGSTON });
    await ev(() => { const t = testBM1; t.renderFleetManager(true); document.querySelector(`[data-formation-travel="${window.__convoyG}"]`)?.scrollIntoView({ block: 'center' }); });
    await page.screenshot({ path: path.join(out, 'SPEED-convoy-slowest-member-fleet.png') });
    await ev(() => document.querySelectorAll('dialog[open]').forEach((d) => d.close()));
    await shotSection('SPEED-journey-debug-convoy-slowest.png', '[data-journey-section]');
    const r2 = await ev(() => {
      const t = testBM1, s = t.state, b = t.fleetBook();
      const gid = window.__convoyG;
      window.__adv(2);
      // The captain takes the freighter out of the formation mid-leg: it is detached when the leg ends.
      t.Fleet.assignFormation(b, 'Convoy-2', null);
      const tr = window.__g(gid).travel;
      const inFlight = tr.legDays[0], arrivalLeg0 = tr.legArrivalDay;
      let guard = 0; while (tr.legIndex < 1 && tr.status === 'underway' && guard++ < 40) window.__adv(1);
      const atBoundary = { legIndex: tr.legIndex, legDays: tr.legDays.slice(), speed: tr.speed ?? null, history: tr.speedHistory || null, detached: tr.detached.map((x) => [x.id, x.reason, x.day]), legArrivalDay: tr.legArrivalDay, etaDay: tr.etaDay };
      t.saveGame(6); t.startWithFaction('ferengi'); t.loadGame(6);
      const tr2 = window.__g(gid).travel;
      const afterLoad = { legIndex: tr2.legIndex, legDays: tr2.legDays.slice(), speed: tr2.speed ?? null, legArrivalDay: tr2.legArrivalDay, etaDay: tr2.etaDay };
      guard = 0; while (window.__g(gid).travel.status === 'underway' && guard++ < 60) window.__adv(1);
      const fin = window.__g(gid).travel;
      return { inFlight, arrivalLeg0, atBoundary, afterLoad, arrived: fin.arrivedDay, status: fin.status, legDays: fin.legDays.slice() };
    });
    await shotFleet('SPEED-convoy-after-detach-fleet.png', '[data-formation-travel]');
    evidence.push({ check: 'CONVOY-SLOWEST-MEMBER', ...r, ...r2 });
    assert.deepEqual(r.legDays0, r.slow, `the convoy flies ${r.legDays0}; at its runabout's 0.85× it is ${r.slow}`);
    assert.equal(r.firstEnd, r2.arrivalLeg0, 'the leg in flight was re-timed');
    assert.equal(r2.atBoundary.legIndex, 1);
    assert.deepEqual(r2.atBoundary.detached.map((x) => x[0]), ['Convoy-2']);
    assert.deepEqual(r2.atBoundary.legDays.slice(1), r.fast.slice(1), `after the freighter left, the remaining legs fly ${r2.atBoundary.legDays.slice(1)}, at the Sabers' 1.20× they are ${r.fast.slice(1)}`);
    assert.deepEqual(r2.afterLoad, { legIndex: r2.atBoundary.legIndex, legDays: r2.atBoundary.legDays, speed: r2.atBoundary.speed, legArrivalDay: r2.atBoundary.legArrivalDay, etaDay: r2.atBoundary.etaDay }, 'save/load changed the journey');
    assert.equal(r2.arrived, r.firstEnd + r.fast.slice(1).reduce((n, d) => n + d, 0), 'the convoy did not arrive when its re-timed legs said');
  });

  // 4 ---------------------------------------------------------------------------------------------
  await check('baseline-defect', 'CAPTAIN-COURSE the captain\'s own course flies at his ship\'s speed, and with a slow freighter escorting him at the freighter\'s: the calendar charges the legs he actually flies', async () => {
    const fly = async (tag, escort) => {
      await fresh(tag);
      await setup();
      return ev((C) => {
        const t = testBM1, s = t.state;
        const A = window.__idx('Earth'), D = window.__idx('Vulcan');
        s.currentPlanet = A; t.applySystemState(A);
        if (C.escort) window.__ship('Escort-K', A, C.KINGSTON, 1200, 'escort');
        const plan = t.getPlottedRoute(A, D);
        // His course's speed by this round's rule: the slowest of his ship and his escorts (the catalogue's values).
        const own = window.__SP[s.playership] ?? 1;
        const speed = C.escort ? Math.min(own, window.__SP[C.KINGSTON]) : own;
        const reported = t.captainCourseSpeed ? t.captainCourseSpeed() : null;
        s.antimatter = Math.max(s.antimatter, 999);
        const day0 = s.day;
        if (!t.beginWarpTravel(D, plan) && !s.warp.active) return { fail: 'warp refused' };
        t.openWarpBriefing?.(); t.closeGalaxyReports?.();
        t.completeWarpTravel();
        return { ship: s.playership, own, reported, speed, days: s.day - day0, expect: window.__days(plan, speed).reduce((n, d) => n + d, 0), chart: window.__days(plan, 1), at: s.currentPlanet, D };
      }, { escort, KINGSTON });
    };
    const solo = await fly('sp-capt-solo', false), esc = await fly('sp-capt-esc', true);
    evidence.push({ check: 'CAPTAIN-COURSE', solo, esc });
    assert.ok(!solo.fail && !esc.fail, solo.fail || esc.fail);
    assert.equal(solo.at, solo.D); assert.equal(esc.at, esc.D);
    assert.equal(solo.days, solo.expect, `alone the course took ${solo.days} days; the chart ${solo.chart} at his ship's ${solo.speed}× is ${solo.expect}`);
    assert.equal(esc.days, esc.expect, `escorted the course took ${esc.days} days; at the Danube's ${esc.speed}× it is ${esc.expect}`);
    assert.ok(esc.days > solo.days, `escorted by a 0.85× runabout the course took ${esc.days} days, alone ${solo.days}`);
    assert.equal(solo.reported, solo.own, 'the course speed the game reports alone'); assert.equal(esc.reported, esc.speed, 'the course speed the game reports escorted');
  });

  // 5 ---------------------------------------------------------------------------------------------
  await check('baseline-defect', 'EVAC-CONVOY an evacuation\'s convoy of Danube runabouts escorted by Sabers flies at the runabouts\' 0.85×: its journey, the round trip it plans with and the debug all read the same days', async () => {
    await fresh('sp-evac');
    await setup();
    const r = await ev((C) => {
      const t = testBM1;
      const P = t.getSystemIndexByName('Orion'); if (t.getSystemControl(P).controller !== 'player') { t.transferSystemControlToPlayer(P); t.markSystemVisited(P); }
      const dest = t.getSystemIndexByName('Vulcan');
      window.__ship('tK0', P, C.KINGSTON); window.__ship('tK1', P, C.KINGSTON); window.__ship('eS0', P, C.SABER); window.__ship('eS1', P, C.SABER);
      const res = t.startPlayerEvacuation(P, dest, ['tK0', 'tK1'], { escorts: ['eS0', 'eS1'] });
      if (!res.ok) return { fail: res.reason };
      const e = res.record;
      const w = t.buildCampaignWorld(true);
      window.__adv(2);
      const tr = t.Campaign.journeyById(t.campaign(), e.convoy?.journeyId);
      // The chart's legs of the route it flies (speed 1.0 on every build), at the runabouts' 0.85×.
      const chart = tr ? [tr.from, ...tr.path].slice(0, -1).map((a, i) => w.legDays(a, tr.path[i])) : null;
      return { origin: P, dest, legDays: tr?.legDays || null, speed: tr?.speed ?? null, planSpeed: t.Campaign.evacuationSpeed ? t.Campaign.evacuationSpeed(w, e) : null, roundTrip: t.Campaign.evacuationRoundTripDays(w, e),
        expect: chart ? window.__at(chart, window.__SP[C.KINGSTON]) : null, chart };
    }, { SABER, KINGSTON });
    await shotSection('SPEED-evacuation-convoy-debug.png', '[data-planning-section]');
    const dbg = await ev(() => { testBM1.openDebugMenu(); const x = document.querySelector('[data-evac-speed]')?.textContent || ''; document.getElementById('cheats-debug').close(); testBM1.closeGalaxyReports?.(); return x; });
    evidence.push({ check: 'EVAC-CONVOY', ...r, debug: dbg });
    assert.ok(!r.fail, r.fail);
    assert.deepEqual(r.legDays, r.expect, `the convoy flies ${r.legDays}; the chart ${r.chart} at 0.85× is ${r.expect}`);
    assert.equal(r.roundTrip, 2 * r.expect.reduce((n, d) => n + d, 0), 'the round trip it plans with is not what it flies');
    assert.equal(r.planSpeed, SPEEDS[KINGSTON]);
    assert.match(dbg, re(`convoy ${LABEL[KINGSTON]}`));
  });

  // 6 ---------------------------------------------------------------------------------------------
  // A Vulcan patrol ship disabled with its crew aboard; its command hears the call and tells a relief
  // ship standing at Vulcan (a Vulcan relief ship rescues live). The survivors' window (what anyone told of
  // it assumes) is set between the fast light cruiser's ETA and the slow explorer's — the same window, the same origin, only the ship differs.
  await check('new-feature', 'RESCUE-FEASIBILITY the same distress and the same window: a Vulcan Light Cruiser (7.5/10 · 1.20×) is sent and arrives on its planned day; a Vulcan Warpship (4/10 · 0.92×) is refused as unable to reach the survivors in time', async () => {
    const runOnce = async (tag, cls) => {
      await fresh(tag);
      await setup();
      return ev((cls) => {
        const t = testBM1, s = t.state, DC = t.DoctrineCampaign;
        window.__quiet();
        const book = t.campaign(); t.syncPlayerPolity(book);
        const w = t.buildCampaignWorld(true);
        const db = DC.doctrineBook(book);
        const rom = book.polities.vulcan;
        const free = rom.hulls.filter((h) => h.status === 'ready' && !h.opId && !h.transit);
        const home = t.getSystemIndexByName('Vulcan');
        const [victim, relief] = free;
        relief.systemIndex = home; relief.shipId = cls; victim.systemIndex = home;
        // A system nobody holds, two or more jumps out (no yard there to repair the hulk and send it on
        // its way): where the patrol is lost.
        const C = t.Campaign;
        let site = null;
        for (const sys of w.systems) {
          if (sys.index === home || sys.controller) continue;
          const p = C.plotJourney(w, home, sys.index, 'vulcan');
          const d = p && p.legDays.reduce((n, x) => n + x, 0);
          if (p && p.path.length >= 2 && d >= 12 && d <= 24) { site = sys.index; break; }
        }
        if (site == null) return { fail: 'no site' };
        const fastEta = C.journeyDays(w, home, site, 'vulcan', window.__SP[237]), slowEta = C.journeyDays(w, home, site, 'vulcan', window.__SP[25]);
        db.config = { ...db.config, reliefShips: { vulcan: 1 } };
        DC.designate(book, 'vulcan', relief.id, 'relief');
        const p = DC.issuePatrol(book, w, 'vulcan', victim.id, site, s.day, []);
        if (!p?.assignment) return { fail: 'patrol refused' };
        const arrive = p.assignment.milestones.find((m) => m.kind === 'arrival').dueDay;
        while (s.day < arrive) window.__adv(1);
        // The window anyone told of the survivors assumes: one day past the courier's arrival (it hears on
        // the day after the loss); the hulk's life support lasts longer, so the plan, not the ground, binds.
        db.config.survivorWindowDays = fastEta + 2; book.config.crewSurvivalDays = slowEta + 20;
        const lost = DC.loseAssignmentHullUnwitnessed(book, w, p.assignment.id, s.day, 'disabled', { silent: false });
        const lossDay = s.day;
        let dist = null, o = null, evd = null;
        for (let i = 0; i < 4 && !dist; i++) { window.__adv(1); dist = Object.values(db.incidents).find((x) => x.eventType === 'distress' && x.status === 'open'); }
        if (!dist) return { fail: 'no distress call', lost };
        DC.relayReport(book, t.buildCampaignWorld(true), dist.id, `command:vulcan`, `hull:${relief.id}`, s.day, { include: 'survivor_report' });
        const told = s.day;
        for (let i = 0; i < 60; i++) {
          window.__adv(1);
          const e = db.lastEval[`hull:${relief.id}|${dist.id}`];
          if (!evd && e?.capacity) evd = JSON.parse(JSON.stringify({ proposal: e.proposal, notActing: e.notActing, capacity: e.capacity, day: e.day }));
          o = db.objectives.find((y) => y.actor === `hull:${relief.id}`);
          if (o && o.status !== 'active') break;
          if (!o && evd && i > 3) break;
        }
        window.__reliefId = relief.id;
        return { site, siteName: s.planets[site]?.name, home, fastEta, slowEta, lossDay, told, cls, speed: t.Campaign.hullSpeed ? t.Campaign.hullSpeed(w, relief) : null,
          objective: o ? { response: o.response, plan: o.plan, arrivedDay: o.arrivedDay ?? null, status: o.status } : null, eval: evd, incident: dist.resolution?.status || dist.status };
      }, cls);
    };
    const fast = await runOnce('sp-rescue-fast', 237);
    await shotSection('SPEED-rescue-fast-light-cruiser-doctrine.png', '[data-doctrine-section]');
    const slow = await runOnce('sp-rescue-slow', 25);
    await shotSection('SPEED-rescue-slow-explorer-doctrine.png', '[data-doctrine-section]');
    evidence.push({ check: 'RESCUE-FEASIBILITY', fast, slow });
    assert.ok(!fast.fail && !slow.fail, fast.fail || slow.fail);
    assert.equal(fast.speed, SPEEDS[237]); assert.equal(slow.speed, SPEEDS[25]);
    assert.ok(fast.objective && fast.objective.response === 'rescue', `the light cruiser was not sent: ${JSON.stringify(fast.eval)}`);
    assert.equal(fast.objective.plan.etaDays, fast.fastEta, 'the light cruiser was planned on another ETA than its own');
    assert.equal(fast.objective.arrivedDay, fast.objective.plan.arriveDay, `arrived day ${fast.objective.arrivedDay}, planned ${fast.objective.plan.arriveDay}`);
    assert.equal(fast.objective.status, 'completed', JSON.stringify(fast.objective));
    assert.equal(fast.incident, 'survivors_rescued');
    assert.ok(!slow.objective || slow.objective.response !== 'rescue', `the explorer was sent: ${JSON.stringify(slow.objective)}`);
    assert.match(slow.eval?.capacity?.reason || '', /cannot reach the survivors in time/, JSON.stringify(slow.eval));
    assert.match(slow.eval.capacity.reason, new RegExp(`${slow.slowEta} days`));
  });

  // 7 ---------------------------------------------------------------------------------------------
  await check('baseline-defect', 'ETA-AWARE-WAR-SPEED the Klingon planner scores the same targets for a force of Vor\'cha attack cruisers (8.5/10 · 1.28×) and one of Klingon cargo ships (5/10 · 1.00×): each target\'s ETA is that force\'s own, and an operation launched flies and engages on its planned day', async () => {
    const plan = async (tag, cls, file) => {
      await fresh(tag);
      await setup();
      const planned = await ev((cls) => {
        const t = testBM1, s = t.state;
        window.__quiet();
        const book = t.campaign(); t.syncPlayerPolity(book);
        const kl = book.polities.klingon;
        // Every Klingon hull of the one class (a hull back from repair tomorrow joins the same force).
        for (const h of kl.hulls) if (h.status !== 'lost') h.shipId = cls;
        kl.lastPlanDay = -1e9; book.config.planningIntervalDays = 1; book.config.aiStrategicOps = true;
        window.__adv(1);
        book.config.aiStrategicOps = false;
        const op = (book.operations || []).filter((o) => o.faction === 'klingon' && o.createdDay === s.day && o.plan).slice(-1)[0] || null;
        window.__warOp = op ? op.id : null;
        const lp = kl.lastPlan;
        return { speed: lp?.speed ?? null, chosen: lp?.chosen ?? null, considered: (lp?.considered || []).map((x) => ({ index: x.index, etaDays: x.etaDays, skip: x.skip || null })) };
      }, cls);
      // The planner's table the day it planned, before anything flies.
      await shotSection(file, '[data-planning-section]');
      const engaged = await ev(() => {
        const t = testBM1, s = t.state, book = t.campaign();
        const op = (book.operations || []).find((o) => o.id === window.__warOp) || null;
        let engaged = null;
        if (op) {
          // Each group of the force flies from where it stands; the force arrives when its last group does.
          const trs = (op.journeyIds || []).map((id) => t.Campaign.journeyById(book, id)).filter(Boolean);
          const w = t.buildCampaignWorld(true);
          const journeys = trs.map((tr) => { const chart = [tr.from, ...tr.path].slice(0, -1).map((a, i) => w.legDays(a, tr.path[i])); const hs = tr.members.map((id) => book.polities.klingon.hulls.find((h) => h.id === id)).filter(Boolean);
            const slowest = Math.min(...hs.map((h) => window.__SP[h.shipId] ?? 1));
            return { id: tr.id, from: tr.origin ?? tr.from, start: tr.startDay, legDays: tr.legDays.slice(), chart, expect: window.__at(chart, slowest), slowest, speed: tr.speed ?? null, eta: tr.etaDay }; });
          let guard = 0; while (!op.engagedDay && op.status !== 'resolved' && guard++ < 200 && s.day < op.plan.arriveDay + 2) window.__adv(1);
          engaged = { engagedDay: op.engagedDay ?? null, journeys, lastEta: Math.max(...journeys.map((j) => j.eta)), planned: op.plan.arriveDay, etaDays: op.plan.etaDays, speed: op.plan.speed ?? null, status: op.status };
        }
        return engaged;
      });
      return { ...planned, engaged };
    };
    const fast = await plan('sp-war-fast', 334, 'SPEED-war-planning-fast-vorcha.png');
    const slow = await plan('sp-war-slow', 239, 'SPEED-war-planning-slow-cargo.png');
    evidence.push({ check: 'ETA-AWARE-WAR-SPEED', fast, slow });
    // Every group of a launched force flies the chart's legs at its slowest ship's catalogue speed.
    for (const e of [fast.engaged, slow.engaged].filter(Boolean)) for (const j of e.journeys) assert.deepEqual(j.legDays, j.expect, `a group flies ${j.legDays}; the chart ${j.chart} at ${j.slowest}× is ${j.expect}`);
    const both = fast.considered.filter((x) => x.etaDays != null).map((x) => [x, slow.considered.find((y) => y.index === x.index)]).filter(([, y]) => y && y.etaDays != null);
    assert.ok(both.length > 0, 'no common target was scored');
    for (const [x, y] of both) assert.ok(x.etaDays <= y.etaDays, `target ${x.index}: the Vor'cha force's ETA ${x.etaDays}, the cargo ships' ${y.etaDays}`);
    assert.ok(both.some(([x, y]) => x.etaDays < y.etaDays), 'no target is nearer for the faster force');
    assert.equal(fast.speed, SPEEDS[334]); assert.equal(slow.speed, SPEEDS[239]);
    for (const e of [fast.engaged, slow.engaged].filter(Boolean)) {
      for (const j of e.journeys) assert.equal(j.speed, e.speed, `a group of the force flies at ${j.speed}, the plan at ${e.speed}`);
      assert.equal(e.lastEta, e.planned, `the force's last group arrives day ${e.lastEta}, planned ${e.planned}: ${JSON.stringify(e.journeys)}`);
      if (e.engagedDay != null) assert.equal(e.engagedDay, e.planned, `engaged day ${e.engagedDay}, planned ${e.planned}`);
    }
    assert.ok(fast.engaged || slow.engaged, 'neither force launched an operation');
  });

  // 8 ---------------------------------------------------------------------------------------------
  await check('new-feature', 'WORMHOLE-FIXED the Bajoran wormhole keeps its fixed days for every ship: a fast scout is not faster through it, and no leg is ever 0 days', async () => {
    await fresh('sp-worm');
    await setup();
    const r = await ev(() => {
      const t = testBM1;
      const w = t.buildCampaignWorld(true);
      const pairs = [];
      const nb = (i) => [...new Set([...(w.neighbours(i) || []).map(Number), ...(w.wormholes || []).flatMap((x) => Number(x.from) === i ? [Number(x.to)] : Number(x.to) === i ? [Number(x.from)] : [])])];
      w.systems.forEach((s, i) => { for (const n of nb(i)) if (i < n && w.legFixed?.(i, n)) pairs.push([i, n]); });
      const at = (a, b, sp) => t.Campaign.legDaysBetween ? t.Campaign.legDaysBetween(w, a, b, sp) : null;
      const any = [];
      w.systems.forEach((s, i) => { for (const n of nb(i)) any.push(at(i, n, 1.5)); });
      return { pairs: pairs.map(([a, b]) => ({ a, b, slow: at(a, b, 0.6), base: at(a, b, 1), fast: at(a, b, 1.5) })), minLeg: Math.min(...any.filter((x) => x != null)) };
    });
    evidence.push({ check: 'WORMHOLE-FIXED', ...r });
    if (!hasSpeed) throw new Error('no strategic speed on this build');
    assert.ok(r.pairs.length >= 1, 'no fixed (wormhole) traversal found on the chart');
    for (const p of r.pairs) { assert.equal(p.fast, p.base); assert.equal(p.slow, p.base); assert.ok(p.base >= 1); }
    assert.ok(r.minLeg >= 1, `a leg flew ${r.minLeg} days at 1.5×`);
  });

  fs.writeFileSync(path.join(out, 'ship-strategic-speed-gate.json'), JSON.stringify({ results, evidence }, null, 1));
  const failed = results.filter((x) => !x.ok);
  const by = (c) => { const x = results.filter((y) => y.category === c); return `${x.filter((y) => y.ok).length}/${x.length}`; };
  console.log(`\nship strategic speed in-game: ${results.length - failed.length}/${results.length} (baseline-defect ${by('baseline-defect')}, new-feature ${by('new-feature')}, preservation ${by('preservation')})${failed.length ? ` — FAILED: ${failed.map((x) => x.name.split(' ')[0]).join(', ')}` : ''}`);
  await probe.close?.();
  process.exit(failed.length ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(2); });
