// In-game gate for STRATEGIC-TIME-SCALE-CORRECTION (docs/movement/STRATEGIC-TIME-SCALE-CORRECTION.md).
// The real engine and the default chart (a median hop of 12 days): doctrine deadlines built from the real
// ETA, AI war plans that weigh the defence a force will meet on arrival, AI evacuations that choose a near
// safe refuge and a target they can move before the attack arrives, and the debug view of all of it.
// Categories:
//   baseline-defect  a one-hop-era assumption present at f34542d (fails there on its own assertion)
//   new-feature      needs this round's ETA-aware planning
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
    // Only the section being photographed is laid out at full height: the rest of the dialog is hidden, so
    // the page stays inside the browser's texture limit at 2× scale.
    await ev((sel) => { const d = document.getElementById('cheats-debug'); if (!d.open) testBM1.openDebugMenu(); for (const x of d.querySelectorAll('section')) if (!x.matches(sel)) x.style.display = 'none'; d.style.maxHeight = 'none'; d.style.height = 'auto'; d.style.width = '1360px'; d.style.maxWidth = 'none'; d.style.overflow = 'visible'; d.style.position = 'absolute'; d.style.top = '0'; }, selector);
    const h = await ev((sel) => Math.ceil(document.querySelector(sel).getBoundingClientRect().bottom + window.scrollY + 40), selector);
    await page.setViewportSize({ width: 1400, height: Math.min(16000, Math.max(900, h)) });
    await page.locator(selector).screenshot({ path: path.join(out, file) });
    await page.setViewportSize({ width: 1400, height: 900 });
    await ev(() => { const d = document.getElementById('cheats-debug'); for (const x of d.querySelectorAll('section')) x.style.display = ''; d.removeAttribute('style'); d.close(); });
  }
  await page.waitForFunction(() => !testBM1.doctrineStatus || testBM1.doctrineStatus().state !== 'loading', null, { timeout: 30000 }).catch(() => {});
  const hasPlanning = await ev(() => typeof testBM1.Campaign.forceAccount === 'function');

  const setup = () => page.evaluate(() => {
    const t = testBM1;
    window.__adv = (n) => { for (let i = 0; i < n; i++) t.advanceFleetCalendar(1, t.Fleet.nextId(t.fleetBook(), 'journey')); };
    window.__idx = (name) => t.getSystemIndexByName(name);
    window.__W = () => t.buildCampaignWorld(true);
    window.__D = () => t.DoctrineCampaign.doctrineBook(t.campaign());
    window.__P = (id) => t.campaign().polities[id];
    window.__ready = (polity, at = null) => (window.__P(polity)?.hulls || []).filter((h) => h.status === 'ready' && !h.opId && !h.transit && (at == null || Number(h.systemIndex) === Number(at))).sort((a, b) => String(a.id).localeCompare(String(b.id)));
    window.__quiet = () => { const db = window.__D(); db.config = { ...db.config, patrols: {}, explorers: {}, merchants: {}, projects: {}, patrolAreas: {}, militaryResponses: false, enforcementResponses: false, predation: false }; };
    window.__authored = (fn) => t.runCampaignAuthored(fn);
    window.__lose = (asgId, mode = 'destroyed') => t.DoctrineCampaign.loseAssignmentHullUnwitnessed(t.campaign(), window.__W(), asgId, t.state.day, mode, { silent: true });
    // Days of a route as a journey flies it (the chart's legs).
    // `speed`: the flying ship's strategic speed (SHIP-DEPENDENT-STRATEGIC-SPEED; ignored by a build without it).
    window.__days = (from, to, polity, speed = null) => { const p = t.Campaign.plotJourney(window.__W(), Number(from), Number(to), polity, null, speed); return p ? { hops: p.path.length, days: p.legDays.reduce((n, d) => n + d, 0), legs: p.legDays, path: p.path } : null; };
    window.__name = (i) => t.state.planets[Number(i)]?.name;
  });

  // 1 ---------------------------------------------------------------------------------------------
  await check('baseline-defect', 'INVESTIGATION-TWO-LEGS a Romulan patrol lost two legs out is investigated: the deadline is its real travel + on-station budget, and the investigator gets there in time (SHOT)', async () => {
    await fresh('ts-investigation'); await setup();
    const r = await ev(() => {
      const t = testBM1, w = window.__W();
      window.__quiet();
      const R = window.__idx('Romulus');
      // Every spare Romulan ship at home: the investigator must come from Romulus.
      for (const h of window.__ready('romulan')) h.systemIndex = R;
      // A world two legs from Romulus, at least 20 days out (the one-hop-era 14-day clock cannot hold it).
      const cand = w.systems.map((s) => ({ i: s.index, d: window.__days(R, s.index, 'romulan') })).filter((x) => x.d && x.d.hops === 2 && x.d.days >= 20 && x.d.days <= 40).sort((a, b) => a.d.days - b.d.days || a.i - b.i);
      if (!cand.length) return { fail: 'no world two legs out' };
      const T = cand[0].i;
      const h = window.__ready('romulan', R)[0];
      const p = window.__authored((book, world, fx) => t.DoctrineCampaign.issuePatrol(book, world, 'romulan', h.id, T, t.state.day, fx));
      if (!p?.ok) return { fail: `patrol refused: ${p?.reason}` };
      for (let k = 0; k < 80 && !(p.assignment.milestones[0]?.status === 'met' && Number(h.systemIndex) === T); k++) window.__adv(1);
      const lostDay = t.state.day;
      const lost = window.__lose(p.assignment.id);
      if (!lost.ok) return { fail: lost.reason };
      const m = p.assignment.milestones.at(-1);
      const detect = m.dueDay + m.grace + 1;
      let o = null;
      for (let k = 0; k < 120 && !o; k++) { window.__adv(1); o = window.__D().objectives.find((y) => y.response === 'investigate' && y.polity === 'romulan'); }
      const inc = Object.values(window.__D().incidents).find((i) => i.polity === 'romulan');
      const ev0 = inc ? window.__D().lastEval[`command:romulan|${inc.id}`] : null;
      if (!o) return { fail: 'no investigation', target: window.__name(T), route: cand[0].d, lostDay, detect, eval: ev0 && { proposal: ev0.proposal, notActing: ev0.notActing, capacity: ev0.capacity } };
      // The route as the investigator itself flies it: at its own strategic speed (chart days on a build without ship speed).
      const inv = o.assigned?.hullId != null ? t.campaign().polities.romulan.hulls.find((x) => x.id === o.assigned.hullId) : null;
      const invSpeed = inv && t.Campaign.hullSpeed ? t.Campaign.hullSpeed(window.__W(), inv) : null;
      const snap = { target: window.__name(T), route: invSpeed == null ? cand[0].d : window.__days(R, T, 'romulan', invSpeed), chartRoute: cand[0].d, invSpeed, lostDay, detect, created: o.createdDay, plan: o.plan, deadline: o.deadline.value };
      for (let k = 0; k < 120 && o.status === 'active'; k++) window.__adv(1);
      return { ...snap, status: o.status, arrived: o.arrivedDay, resolution: o.resolution, stats: { ...window.__D().stats } };
    });
    evidence.push({ check: 'INVESTIGATION-TWO-LEGS', ...r });
    assert.ok(!r.fail, `${r.fail}: ${JSON.stringify(r)}`);
    assert.ok(r.plan && r.plan.etaDays === r.route.days, `planned ${JSON.stringify(r.plan)}, route ${JSON.stringify(r.route)}`);
    assert.ok(r.deadline > r.created + 14, 'still the one-hop-era 14-day clock');
    assert.ok(r.deadline >= r.plan.arriveDay + r.plan.onStationDays);
    assert.equal(r.status, 'completed', JSON.stringify(r.resolution));
    assert.ok(r.arrived <= r.plan.arriveDay + 1, `arrived day ${r.arrived}, planned ${r.plan.arriveDay}`);
  });
  await check('new-feature', 'DEBUG-OBJECTIVE-PLAN the planning debug view shows the objective\'s ETA, time on station, deadline and its basis (SHOT)', async () => {
    const r = await ev(() => { testBM1.openDebugMenu(); const el = document.querySelector('[data-objective-plan-table]'); const txt = el ? el.textContent : null; document.getElementById('cheats-debug').close(); return { txt, stats: document.querySelector('[data-eta-stats]')?.textContent || null }; });
    evidence.push({ check: 'DEBUG-OBJECTIVE-PLAN', ...r });
    assert.ok(r.txt && /travel \+ on station \+ slack/.test(r.txt), r.txt);
    await shotSection('TS-debug-eta-doctrine-objective.png', '[data-planning-section]');
  });

  // 2 ---------------------------------------------------------------------------------------------
  await check('new-feature', 'RESCUE-BY-ETA survivors 20 days from rescue: a relief ship one leg away can reach them, one across the chart cannot', async () => {
    await fresh('ts-rescue'); await setup();
    const r = await ev(() => {
      const t = testBM1, w = window.__W(), book = t.campaign(), db = window.__D();
      const V = window.__idx('Vulcan');
      const vs = window.__ready('vulcan').slice(0, 2);
      if (vs.length < 2) return { fail: 'fewer than two Vulcan ships' };
      // The survivors: a world next to Vulcan. Near: Vulcan. Far: the Vulcan-reachable world furthest in days.
      const nb = w.neighbours(V).map(Number).sort((a, b) => window.__days(V, a, 'vulcan').days - window.__days(V, b, 'vulcan').days)[0];
      const far = w.systems.map((s) => ({ i: s.index, d: window.__days(s.index, nb, 'vulcan') })).filter((x) => x.d && x.d.days > 25).sort((a, b) => b.d.days - a.d.days)[0];
      if (!far) return { fail: 'no distant system' };
      vs[0].systemIndex = V; vs[1].systemIndex = far.i;
      const day = t.state.day;
      const target = { systemIndex: nb, survivorsUntil: day + 20 };
      const cap = (h) => t.DoctrineCampaign.responseCapacity(book, w, db, `hull:${h.id}`, 'rescue', target, day, { incidentId: `ts-gate-${h.id}` });
      const a = cap(vs[0]), b = cap(vs[1]);
      return { survivorsAt: window.__name(nb), near: { from: 'Vulcan', ok: a.ok, eta: a.etaDays, reason: a.reason }, far: { from: window.__name(far.i), ok: b.ok, eta: b.etaDays, reason: b.reason, failedByDistance: b.failedByDistance } };
    });
    evidence.push({ check: 'RESCUE-BY-ETA', ...r });
    assert.ok(!r.fail, r.fail);
    assert.equal(r.near.ok, true, r.near.reason); assert.ok(r.near.eta <= 20);
    assert.equal(r.far.ok, false); assert.equal(r.far.failedByDistance, true); assert.ok(r.far.eta > 20);
  });

  // 3 ---------------------------------------------------------------------------------------------
  await check('new-feature', 'WAR-PLAN-ETA the default campaign\'s AI plans weigh real ETA and the defence on arrival; an operation\'s planned arrival is the day its journeys arrive and it engages then; save/load keeps the plan (SHOT)', async () => {
    await fresh('ts-war'); await setup();
    const r = await ev(() => {
      const t = testBM1;
      let op = null;
      for (let k = 0; k < 200 && !op; k++) { window.__adv(1); op = (t.campaign().operations || []).find((o) => o.plan && o.status !== 'resolved' && o.engagedDay == null && (o.journeyIds || []).length); }
      if (!op) return { fail: 'no planned operation in 200 days' };
      const book = t.campaign();
      const js = book.journeys.filter((j) => op.journeyIds.includes(j.id));
      const eta = Math.max(...js.map((j) => j.etaDay));
      const planner = book.polities[op.faction].lastPlan;
      const snap = { id: op.id, faction: op.faction, target: window.__name(op.targetSystem), plan: op.plan, arriveDay: op.arriveDay, journeysEta: eta, planner: { chosen: planner?.chosen, considered: (planner?.considered || []).slice(0, 6) } };
      t.saveGame(8); t.startWithFaction('ferengi'); t.loadGame(8);
      const op2 = (t.campaign().operations || []).find((o) => o.id === op.id);
      const reloaded = { plan: op2?.plan, lastPlan: t.campaign().polities[op.faction].lastPlan?.day };
      return { ...snap, reloaded, day: t.state.day };
    });
    evidence.push({ check: 'WAR-PLAN-ETA', ...r });
    assert.ok(!r.fail, r.fail);
    assert.equal(r.plan.arriveDay, r.journeysEta, `planned day ${r.plan.arriveDay}, journeys arrive ${r.journeysEta}`);
    assert.equal(r.arriveDay, r.journeysEta);
    assert.deepEqual(r.reloaded.plan, r.plan);
    assert.ok(r.planner.considered.some((x) => x.etaDays != null && x.defenseAtEta != null));
    await shotSection('TS-debug-eta-war-planning.png', '[data-planning-section]');
    const e = await ev((id) => { const op = (testBM1.campaign().operations || []).find((o) => o.id === id); for (let k = 0; k < 150 && op && op.engagedDay == null && op.status !== 'resolved'; k++) window.__adv(1); return op ? { engaged: op.engagedDay, status: op.status, outcome: op.outcome } : null; }, r.id);
    evidence.push({ check: 'WAR-PLAN-ETA engagement', ...e });
    if (e && e.engaged != null) assert.equal(e.engaged, r.plan.arriveDay, `engaged day ${e.engaged}, planned ${r.plan.arriveDay}`);
  });

  // 4 ---------------------------------------------------------------------------------------------
  await check('baseline-defect', 'EVAC-NEAR-REFUGE an AI evacuation under threat takes its people to a near safe refuge, with a target it can move before the attackers arrive, and lands them on arrival (SHOT)', async () => {
    await fresh('ts-evac'); await setup();
    const r = await ev(() => {
      const t = testBM1, book = t.campaign(), w = window.__W();
      window.__quiet();
      t.syncPlayerPolity(book);
      // A Terran world of 5000+ people with a Klingon world in reach: a Klingon force far stronger than its
      // defence is sent against it.
      const cfg = book.config;
      let pick = null;
      for (const s of w.systems) {
        if (s.controller !== 'terran' || (s.population || 0) < cfg.evacMinPopulation) continue;
        const kl = book.polities.klingon.hulls.filter((h) => h.status === 'ready' && !h.opId && !h.transit);
        const bySys = {}; for (const h of kl) (bySys[h.systemIndex] ||= []).push(h);
        for (const [from, hs] of Object.entries(bySys)) { const d = window.__days(Number(from), s.index, 'klingon'); if (d && hs.length >= 3 && d.days >= 20 && (!pick || d.days < pick.d.days)) pick = { s, from: Number(from), hs, d }; }
      }
      if (!pick) return { fail: 'no Terran world with a Klingon force in reach' };
      const carriers = book.polities.terran.hulls.filter((h) => h.status === 'ready' && !h.opId && Number(h.systemIndex) === pick.s.index && t.Campaign.evacuationLift(book, w, h) > 0);
      // Strength enough to be a threat: every Klingon ship there, and the world's own ships moved off.
      for (const h of book.polities.terran.hulls) if (Number(h.systemIndex) === pick.s.index && !carriers.slice(0, 4).includes(h)) h.systemIndex = w.neighbours(pick.s.index).map(Number).find((n) => w.systems[n].controller === 'terran') ?? h.systemIndex;
      // Every spare Klingon ship joins the force at its departure system.
      const force = book.polities.klingon.hulls.filter((h) => h.status === 'ready' && !h.opId && !h.transit);
      for (const h of force) h.systemIndex = pick.from;
      const fx = [];
      const op = t.Campaign.launchOperation(book, w, 'klingon', force, pick.s.index, t.state.day, pick.d.hops, 'assault', fx);
      t.applyCampaignEffects(fx, t.state.day);
      let e = null;
      for (let k = 0; k < 5 && !e; k++) { window.__adv(1); e = (book.evacuations || []).find((x) => x.sponsor === 'terran' && Number(x.origin) === pick.s.index); }
      if (!e) return { fail: 'no AI evacuation', origin: pick.s.name, carriers: carriers.length, threat: op.arriveDay, attack: t.Campaign.operationHulls(book, op).reduce((n, h) => n + t.Campaign.hullStrength(book, w, h), 0), defence: t.Campaign.localDefenseStrength(book, window.__W(), pick.s.index), ratio: cfg.evacThreatRatio, active: (book.evacuations || []).filter((x) => x.status === 'active').map((x) => [x.sponsor, x.origin]), maxAi: cfg.maxAiEvacuations, aiOps: cfg.aiStrategicOps };
      // (A build without the destination ranking — f34542d — records none, and fails on its own assertion below.)
      const dests = (t.Campaign.evacuationDestinations ? t.Campaign.evacuationDestinations(book, window.__W(), 'terran', pick.s.index) : []).map((d) => ({ name: d.name, days: d.days, danger: d.danger, score: d.score }));
      const snap = { origin: pick.s.name, destination: window.__name(e.destination), plan: e.plan, target: e.target, threatDay: op.arriveDay, dests: dests.slice(0, 6) };
      // First landing: only on arrival at the refuge.
      let firstLanding = null, atRefugeDay = null;
      const hulls = e.transports.map((x) => book.polities.terran.hulls.find((h) => h.id === x.hullId)).filter(Boolean);
      for (let k = 0; k < 120 && firstLanding == null && e.status === 'active'; k++) {
        window.__adv(1);
        if (atRefugeDay == null && hulls.some((h) => Number(h.systemIndex) === Number(e.destination) && !h.transit)) atRefugeDay = t.state.day;
        if (e.moved > 0) firstLanding = t.state.day;
      }
      return { ...snap, firstLanding, atRefugeDay, moved: e.moved, status: e.status, started: e.startDay };
    });
    evidence.push({ check: 'EVAC-NEAR-REFUGE', ...r });
    assert.ok(!r.fail, `${r.fail}: ${JSON.stringify(r)}`);
    assert.ok(r.plan, 'the evacuation has no plan (one-hop-era AI evacuation)');
    assert.equal(r.destination, r.dests[0].name, 'not the best refuge by days and safety');
    assert.ok(r.plan.destinationDays <= r.dests.reduce((m, d) => Math.max(m, d.days), 0));
    assert.ok(r.target <= r.plan.tripsBeforeThreat * r.plan.liftPerTrip);
    assert.ok(r.firstLanding != null, 'nobody landed');
    assert.equal(r.firstLanding, r.atRefugeDay, `landed day ${r.firstLanding}, at the refuge day ${r.atRefugeDay}`);
    await shotSection('TS-debug-eta-evacuation.png', '[data-planning-section]');
  });

  // 5 ---------------------------------------------------------------------------------------------
  await check('preservation', 'NO-INSTANT-MOVEMENT every journey under way in a 60-day default run flies its chart legs (at its ships\' strategic speed): no leg shorter than that, no arrival before its ETA', async () => {
    await fresh('ts-legs'); await setup();
    const r = await ev(() => {
      const t = testBM1, bad = [];
      const seen = {};
      for (let k = 0; k < 60; k++) {
        window.__adv(1);
        const w = window.__W();
        for (const j of t.campaign().journeys || []) {
          if (seen[j.id]) continue; seen[j.id] = true;
          // A transwarp jump (BORG-ASSIMILATION-TRANSWARP) is not a chart route: one leg of its own fixed days.
          if (j.mode === 'transwarp') { if (j.path.length !== 1 || j.legDays.length !== 1 || j.legDays[0] !== j.transwarp?.days) bad.push({ id: j.id, legs: j.legDays, transwarp: j.transwarp }); continue; }
          const sys = [j.plotFrom ?? j.origin, ...j.path];
          // Its chart legs at the speed it was flying each one (SHIP-DEPENDENT-STRATEGIC-SPEED: a fast ship's
          // leg is legitimately shorter than the chart's; a journey recorded without a speed flies the chart).
          const speedAt = (i) => { let sp = null; for (const x of j.speedHistory || []) if (x.fromLeg <= i) sp = x.speed; return sp ?? j.speed ?? null; };
          const chart = sys.slice(1).map((x, i) => (speedAt(i) == null ? w.legDays(Number(sys[i]), Number(x)) : t.Campaign.legDaysBetween(w, Number(sys[i]), Number(x), speedAt(i))));
          if (j.legDays.some((d, i) => d < chart[i])) bad.push({ id: j.id, legs: j.legDays, chart, speed: j.speed });
        }
      }
      return { journeys: Object.keys(seen).length, bad: bad.slice(0, 5) };
    });
    evidence.push({ check: 'NO-INSTANT-MOVEMENT', ...r });
    assert.ok(r.journeys > 0);
    assert.deepEqual(r.bad, []);
  });

  fs.writeFileSync(path.join(out, 'strategic-time-scale-gate.json'), JSON.stringify({ hasPlanning, results, evidence }, null, 1));
  const byCat = (c) => { const x = results.filter((y) => y.category === c); return `${x.filter((y) => y.ok).length}/${x.length}`; };
  console.log(`\nstrategic time-scale in-game: ${results.filter((x) => x.ok).length}/${results.length} (baseline-defect ${byCat('baseline-defect')}, new-feature ${byCat('new-feature')}, preservation ${byCat('preservation')})`);
  if (probe.errors.length) console.log('page errors:', probe.errors.slice(0, 5));
  await probe.close();
  process.exit(results.every((x) => x.ok) && !probe.errors.length ? 0 : 1);
})().catch((e) => { console.error(e); process.exit(1); });
