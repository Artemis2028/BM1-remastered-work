// In-game gate for STRATEGIC-MOVEMENT-UNIFICATION (docs/movement/STRATEGIC-MOVEMENT-UNIFICATION.md).
// The real engine: the chart's leg lengths, the captain's own ships mirrored onto model journeys, the
// captain's sources for crossing news, the Operations card and the debug journey table.
// Categories:
//   baseline-defect  reproduces a bypass that exists at 29710b1 (fails there on its own assertion)
//   new-feature      needs this round's shared journeys
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
  const shot = (name) => page.screenshot({ path: path.join(out, name) });
  // The debug dialog laid out at full height, one section photographed.
  async function shotSection(file, selector) {
    await ev(() => { const d = document.getElementById('cheats-debug'); if (!d.open) testBM1.openDebugMenu(); d.style.maxHeight = 'none'; d.style.height = 'auto'; d.style.width = '1360px'; d.style.maxWidth = 'none'; d.style.overflow = 'visible'; d.style.position = 'absolute'; d.style.top = '0'; });
    const h = await ev((sel) => Math.ceil(document.querySelector(sel).getBoundingClientRect().bottom + window.scrollY + 40), selector);
    await page.setViewportSize({ width: 1400, height: Math.min(16000, Math.max(900, h)) });
    await page.locator(selector).screenshot({ path: path.join(out, file) });
    await page.setViewportSize({ width: 1400, height: 900 });
    await ev(() => { const d = document.getElementById('cheats-debug'); d.removeAttribute('style'); d.close(); });
  }
  const hasJourneys = await ev(() => typeof testBM1.Campaign.journeyById === 'function');

  const setup = () => page.evaluate(() => {
    const t = testBM1;
    window.__adv = (n) => { for (let i = 0; i < n; i++) t.advanceFleetCalendar(1, t.Fleet.nextId(t.fleetBook(), 'journey')); };
    window.__idx = (name) => t.getSystemIndexByName(name);
    window.__Q = (name) => { const i = t.getSystemIndexByName(name); if (t.getSystemControl(i).controller !== 'player') { t.transferSystemControlToPlayer(i); t.markSystemVisited(i); } return i; };
    window.__ship = (id, at, shipId = 1, hull = 400) => { t.state.playerFleet.push({ id, shipId: Number(shipId), name: id, systemIndex: at, assignment: 'defense', destroyed: false, vessel: { hull, maxHull: hull, condition: 'operational' } }); return id; };
    window.__vid = (id) => t.ensureFleetVesselIdentity(t.state.playerFleet.find((f) => f.id === id)).vid;
    window.__evac = (id) => (t.campaign().evacuations || []).find((e) => e.id === id);
    // A hop's length from the chart: the world's own hook, or (on a tree that has none, the baseline) the
    // same Fleet.travelDays over the plotted route's leg that a formation flies.
    window.__leg = (a, b) => { const w = t.buildCampaignWorld(true); if (typeof w.legDays === 'function') return w.legDays(Number(a), Number(b)); const r = t.getPlottedRoute(Number(a), Number(b)); return r ? t.routeLegDays(r).reduce((n, d) => n + d, 0) : 1; };
    // Fewest jumps over the model's adjacency (Campaign.plotJourney where there is one).
    window.__plot = (w, from, to, polity) => {
      if (t.Campaign.plotJourney) return t.Campaign.plotJourney(w, from, to, polity);
      const prev = new Map([[from, null]]); const q = [from];
      while (q.length) { const c = q.shift(); if (c === to) break; for (const n of w.neighbours(c).map(Number)) if (!prev.has(n)) { prev.set(n, c); q.push(n); } }
      if (!prev.has(to)) return null;
      const sys = []; for (let x = to; x != null; x = prev.get(x)) sys.unshift(x);
      return { systems: sys, path: sys.slice(1), legDays: sys.slice(1).map((x, i) => window.__leg(sys[i], x)) };
    };
    window.__trip = (e) => t.Campaign.evacuationRoundTripDays(t.buildCampaignWorld(true), e) + (t.campaign().config.evacLoadingDays ?? 1);
    window.__aiBlockade = (power, target, n, purpose = 'interdict_trade') => {
      const book = t.campaign();
      t.syncPlayerPolity(book);
      const hulls = book.polities[power].hulls.filter((h) => h.status === 'ready' && !h.opId && !h.transit).slice(0, n);
      for (const h of hulls) h.systemIndex = target;
      const fx = [];
      const r = t.Campaign.startBlockade(book, t.buildCampaignWorld(true), { power, target, hullIds: hulls.map((h) => h.id), purpose }, t.state.day, fx);
      t.applyCampaignEffects(fx, t.state.day);
      return r.ok ? r.record.id : r.reason;
    };
    window.__block = (id) => (t.campaign().blockades || []).find((b) => b.id === id);
    // A Klingon war fleet on a real multi-leg route to a Terran world: the shortest such passage (in days)
    // from a Klingon world with spare ships, at least two legs long, every leg at most `maxLeg` days.
    window.__klingonMission = (maxLeg = 12) => {
      const book = t.campaign(), w = t.buildCampaignWorld(true);
      t.syncPlayerPolity(book);
      const kl = book.polities.klingon.hulls.filter((h) => h.status === 'ready' && !h.opId && !h.transit);
      const bySys = new Map(); for (const h of kl) { const k = Number(h.systemIndex); if (!bySys.has(k)) bySys.set(k, []); bySys.get(k).push(h); }
      let best = null;
      for (const [from, hs] of bySys) {
        if (hs.length < 3 || w.systems[from]?.controller !== 'klingon') continue;
        for (const s of w.systems) {
          if (s.controller !== 'terran') continue;
          const plan = window.__plot(w, from, s.index, 'klingon');
          if (!plan || plan.path.length < 2 || plan.legDays.some((d) => d > maxLeg)) continue;
          const days = plan.legDays.reduce((n, d) => n + d, 0);
          if (!best || days < best.days) best = { from, target: s.index, plan, days, hulls: hs.slice(0, 3).map((h) => h.id) };
        }
      }
      return best;
    };
    window.__launch = (m) => {
      const book = t.campaign(), w = t.buildCampaignWorld(true);
      const hulls = m.hulls.map((id) => book.polities.klingon.hulls.find((h) => h.id === id));
      const fx = [];
      const op = t.Campaign.launchOperation(book, w, 'klingon', hulls, m.target, t.state.day, m.plan.path.length, 'assault', fx);
      t.applyCampaignEffects(fx, t.state.day);
      return op.id;
    };
    window.__opHulls = (opId) => { const book = t.campaign(); const op = book.operations.find((o) => o.id === opId); return op.hullIds.map((id) => book.polities.klingon.hulls.find((h) => h.id === id)).filter(Boolean); };
    window.__jOf = (ref, kind = null) => (t.campaign().journeys || []).filter((j) => j.ref === ref && (!kind || j.kind === kind));
  });

  // ------------------------------------------------------------------------------------------------
  // Evacuation on real legs
  // ------------------------------------------------------------------------------------------------
  await check('baseline-defect', 'EVAC-REAL-LEGS the captain\'s convoy Paso → Alpha Centauri → Earth flies each leg its chart length; nobody is delivered until it reaches Earth', async () => {
    await fresh('sm-evac-legs'); await setup();
    const r = await ev(() => {
      const t = testBM1;
      const P = window.__Q('Paso'), AC = window.__idx('Alpha Centauri'), E = window.__idx('Earth');
      for (const i of [P, AC, E]) t.markSystemVisited(i);
      const ids = [window.__ship('Hauler Ames', P, 215, 600), window.__ship('Hauler Brisk', P, 215, 600)];
      const res = t.startPlayerEvacuation(P, E, ids, { target: 3000000 });
      if (!res.ok) return { fail: res.reason };
      const e = res.record;
      const legs = e.route.slice(1).map((s, k) => window.__leg(e.route[k], s));
      const trail = [];
      for (let k = 0; k < legs.reduce((n, d) => n + d, 0) + 4; k++) { window.__adv(1); const f = t.state.playerFleet.find((x) => x.id === ids[0]); trail.push([t.state.day, Number(f.systemIndex), e.moved]); }
      return { route: e.route, legs, trail, start: e.startDay, P, AC, E };
    });
    evidence.push({ check: 'EVAC-REAL-LEGS', ...r });
    assert.ok(!r.fail, r.fail);
    assert.equal(r.route.length, 3, `route ${r.route}`);
    const at = (sys) => r.trail.find((x) => x[1] === sys)?.[0];
    const dAC = at(r.AC), dE = at(r.E);
    assert.ok(dAC != null && dE != null, JSON.stringify(r.trail));
    assert.equal(dE - dAC, r.legs[1], `Alpha Centauri day ${dAC} → Earth day ${dE}; the leg is ${r.legs[1]} days`);
    const first = r.trail.find((x) => x[2] > 0)?.[0];
    assert.equal(first, dE, 'evacuees were delivered on a day the convoy was not at Earth');
  });

  await check('new-feature', 'EVAC-MID-LEG the Operations card shows the leg in flight and its real ETA; save/load mid-leg keeps the journey exactly (SHOT)', async () => {
    await fresh('sm-evac-mid'); await setup();
    const r = await ev(() => {
      const t = testBM1;
      const P = window.__Q('Paso'), AC = window.__idx('Alpha Centauri'), E = window.__idx('Earth');
      for (const i of [P, AC, E]) t.markSystemVisited(i);
      const ids = [window.__ship('Hauler Ames', P, 215, 600), window.__ship('Hauler Brisk', P, 215, 600), window.__ship('Hauler Corva', P, 215, 600)];
      const e = t.startPlayerEvacuation(P, E, ids, { target: 3000000 }).record;
      // Into the long Alpha Centauri → Earth leg.
      for (let k = 0; k < 60; k++) { window.__adv(1); const tr = e.convoy?.journeyId && t.Campaign.journeyById(t.campaign(), e.convoy.journeyId); if (tr && tr.legIndex === 1 && t.state.day > tr.legDepartDay) break; }
      const tr = t.Campaign.journeyById(t.campaign(), e.convoy.journeyId);
      const line = t.convoyLine(e);
      const snap = JSON.stringify(tr);
      t.saveGame(6); t.startWithFaction('ferengi'); t.loadGame(6);
      const after = JSON.stringify(t.Campaign.journeyById(t.campaign(), e.convoy.journeyId));
      t.openCampaignPanel('strategic');
      document.querySelector('[data-ops-evacuations]')?.scrollIntoView({ block: 'start' });
      return { line, same: snap === after, tr: { legIndex: tr.legIndex, from: tr.from, to: tr.path[tr.legIndex], arr: tr.legArrivalDay, eta: tr.etaDay, depart: tr.legDepartDay }, day: t.state.day, moved: window.__evac(e.id).moved,
        card: document.querySelector(`[data-ops-evac="${e.id}"]`)?.textContent || '' };
    });
    evidence.push({ check: 'EVAC-MID-LEG', ...r });
    await shot('SM-evacuation-mid-leg-eta.png');
    await ev(() => testBM1.closeCampaignPanel());
    assert.ok(r.same, 'the journey changed across save/load');
    assert.equal(r.moved, 0, 'people delivered mid-leg');
    assert.match(r.line, new RegExp(`arrives day ${r.tr.arr}`), r.line);
    assert.match(r.line, new RegExp(`reaches Earth day ${r.tr.eta}`), r.line);
    assert.match(r.card, /arrives day/, 'the card does not show the leg ETA');
  });

  await check('new-feature', 'EVAC-BLOCKADE-CROSSING a blockade laid at the intermediate system is run there, on the day the convoy reaches it, through the shared engine (SHOT)', async () => {
    await fresh('sm-evac-block'); await setup();
    const r = await ev(() => {
      const t = testBM1;
      const P = window.__Q('Paso'), AC = window.__idx('Alpha Centauri'), E = window.__idx('Earth');
      for (const i of [P, AC, E]) t.markSystemVisited(i);
      const ids = [window.__ship('Hauler Ames', P, 215, 600), window.__ship('Hauler Brisk', P, 215, 600), window.__ship('Hauler Corva', P, 215, 600)];
      const e = t.startPlayerEvacuation(P, E, ids, { target: 3000000 }).record;
      window.__adv(1);
      const bid = window.__aiBlockade('klingon', AC, 18);
      let run = null;
      for (let k = 0; k < 60 && !run; k++) { window.__adv(1); run = (window.__block(bid)?.runs || []).find((x) => String(x.by).startsWith(e.id)) || null; }
      const tr = (t.campaign().journeys || []).find((j) => j.ref === e.id && j.encounters.some((x) => x.blockadeId === bid));
      t.state.selectedPlanet = AC;
      t.openCampaignPanel('strategic');
      document.querySelector(`[data-ops-evac="${e.id}"]`)?.scrollIntoView({ block: 'center' });
      return { bid, run, AC, crossed: tr?.crossed || [], enc: tr?.encounters || [], line: t.convoyLine(e), vids: ids.map(window.__vid), fleet: t.state.playerFleet.filter((f) => ids.includes(f.id)).map((f) => [f.id, window.__vid(f.id), f.destroyed ? 'destroyed' : f.vessel?.condition]) };
    });
    evidence.push({ check: 'EVAC-BLOCKADE-CROSSING', ...r });
    await shot('SM-evacuation-crossing-blockade.png');
    await ev(() => testBM1.closeCampaignPanel());
    assert.ok(r.run, 'the convoy never ran the blockade');
    const enc = r.enc.find((x) => x.blockadeId === r.bid);
    assert.equal(enc.system, r.AC);
    assert.ok(r.crossed.some((c) => c.system === r.AC && c.day === enc.day), 'the run was not on the day the convoy reached Alpha Centauri');
    assert.equal(r.run.day, enc.day);
    assert.deepEqual(r.fleet.map((x) => x[1]), r.vids, 'a hauler changed identity');
  });

  // ------------------------------------------------------------------------------------------------
  // Legacy AI movement
  // ------------------------------------------------------------------------------------------------
  await check('baseline-defect', 'AI-MULTI-LEG a Klingon war fleet on a multi-leg route is at each intermediate system on the way, on its real days; the captain there sees it pass once (SHOT)', async () => {
    await fresh('sm-ai-legs'); await setup();
    const r = await ev(() => {
      const t = testBM1;
      const m = window.__klingonMission();
      if (!m) return { fail: 'no Klingon mission found' };
      const mid = m.plan.path[0];
      for (const i of [m.from, ...m.plan.path]) t.markSystemVisited(i);
      // The captain waits at the first intermediate system.
      t.state.currentPlanet = mid; t.applySystemState(mid);
      const opId = window.__launch(m);
      const hs = window.__opHulls(opId);
      const trail = [];
      for (let k = 0; k < m.days + 2; k++) { window.__adv(1); trail.push([t.state.day, hs.map((h) => Number(h.systemIndex)), hs.map((h) => (h.transit ? Number(h.transit.to) : null))]); }
      const news = t.galaxyNewsBook();
      const sightings = [...news.items, ...(news.pending || [])].filter((x) => String(x.id).startsWith('journey:'));
      t.openGalaxyReports?.();
      // Open the folder the sighting is filed in, and page to it.
      const item = sightings[0];
      if (item) {
        document.querySelector(`[data-report-folder="${t.galaxyReportCategory(item)}"]`)?.click();
        for (let k = 0; k < 20 && !document.querySelector(`[data-report-id="${item.id}"]`); k++) document.querySelector('[data-report-page="1"]:not([disabled])')?.click();
        document.querySelector(`[data-report-id="${item.id}"]`)?.scrollIntoView({ block: 'center' });
      }
      return { m: { from: m.from, target: m.target, path: m.plan.path, legDays: m.plan.legDays, days: m.days }, mid, trail, start: t.state.day - m.days - 2, sightings: sightings.map((x) => ({ id: x.id, kind: x.kind, text: x.text, day: x.day })), vids: hs.map((h) => h.identity?.vid) };
    });
    evidence.push({ check: 'AI-MULTI-LEG', ...r });
    await shot('SM-ai-fleet-sighted-on-route.png');
    await ev(() => testBM1.closeGalaxyReports?.());
    assert.ok(!r.fail, r.fail);
    const firstAt = (sys) => r.trail.find((x) => x[1][0] === sys)?.[0];
    const dMid = firstAt(r.mid);
    assert.ok(dMid != null, `the fleet was never at ${r.mid}: ${JSON.stringify(r.trail)}`);
    assert.equal(dMid - r.start, r.m.legDays[0], `first leg took ${dMid - r.start} days, the chart says ${r.m.legDays[0]}`);
    assert.equal(r.sightings.filter((x) => x.id.includes(':l0')).length, 1, `sightings ${JSON.stringify(r.sightings)}`);
  });

  await check('new-feature', 'AI-SAVELOAD-NO-REPEAT save/load on the crossing day repeats no crossing, sighting or blockade run', async () => {
    await fresh('sm-ai-save'); await setup();
    const r = await ev(() => {
      const t = testBM1;
      const m = window.__klingonMission();
      const mid = m.plan.path[0];
      for (const i of [m.from, ...m.plan.path]) t.markSystemVisited(i);
      t.state.currentPlanet = mid; t.applySystemState(mid);
      const opId = window.__launch(m);
      window.__adv(m.plan.legDays[0]);
      const j = window.__jOf(opId, 'operation')[0];
      const count = () => { const news = t.galaxyNewsBook(); return [...news.items, ...(news.pending || [])].filter((x) => String(x.id).startsWith(`journey:${j.id}:`)).length; };
      const before = { crossed: JSON.stringify(j.crossed), sightings: count(), crossings: t.campaign().stats.journeys.crossings };
      t.saveGame(7); t.startWithFaction('ferengi'); t.loadGame(7);
      const jr = t.Campaign.journeyById(t.campaign(), j.id);
      const fx = []; t.Campaign.stepJourney(t.campaign(), t.buildCampaignWorld(true), jr, t.state.day, fx);
      t.applyCampaignEffects(fx, t.state.day);
      const after = { crossed: JSON.stringify(jr.crossed), sightings: count(), crossings: t.campaign().stats.journeys.crossings, fx: fx.length };
      window.__adv(3);
      return { before, after, later: count() };
    });
    evidence.push({ check: 'AI-SAVELOAD-NO-REPEAT', ...r });
    assert.equal(r.after.crossed, r.before.crossed); assert.equal(r.after.crossings, r.before.crossings); assert.equal(r.after.fx, 0);
    assert.equal(r.after.sightings, r.before.sightings);
  });

  await check('new-feature', 'CEASEFIRE-MOVING-FLEET a ceasefire while the war fleet is under way: at its next system its objective is void, it turns for home, and no strike ever lands (SHOT)', async () => {
    await fresh('sm-ceasefire'); await setup();
    await ev(() => {
      const t = testBM1, book = t.campaign();
      const m = window.__klingonMission();
      const opId = window.__launch(m);
      window.__adv(1);
      t.changeDiplomacy('terran', 'klingon', 'ceasefire');
      window.__cf = { opId, m, hits: [] };
      // Up to the boundary: the leg in flight is flown, and at its end the stale order is dropped.
      for (let k = 0; k < m.days + 5 && window.__jOf(opId, 'operation').some((j) => j.status === 'underway'); k++) {
        window.__adv(1);
        if (book.operations.find((o) => o.id === opId).status === 'engaged') window.__cf.hits.push(['engaged', t.state.day]);
      }
      return window.__cf.opId;
    });
    await shotSection('SM-ceasefire-cancels-moving-fleet.png', '[data-journey-section]');
    const r = await ev(() => {
      const t = testBM1, book = t.campaign();
      const { opId, m } = window.__cf;
      const hits = window.__cf.hits;
      for (let k = 0; k < m.days + 20; k++) {
        window.__adv(1);
        const op = book.operations.find((o) => o.id === opId);
        if (op.status === 'engaged') hits.push(['engaged', t.state.day]);
      }
      const op = book.operations.find((o) => o.id === opId);
      const js = window.__jOf(opId).map((j) => ({ id: j.id, kind: j.kind, seq: j.seq, status: j.status, endReason: j.endReason, staleAt: j.staleAt || null, crossed: j.crossed.map((c) => c.system), path: j.path }));
      return { target: m.target, op: { status: op.status, outcome: op.outcome }, js, hits, ownerAfter: t.buildCampaignWorld(true).systems[m.target].controller, stale: book.stats.journeys.staleCancelled };
    });
    evidence.push({ check: 'CEASEFIRE-MOVING-FLEET', ...r });
    assert.equal(r.hits.length, 0, `the fleet engaged after the ceasefire: ${JSON.stringify(r.hits)}`);
    assert.equal(r.op.status, 'resolved'); assert.notEqual(r.op.outcome, 'captured');
    assert.equal(r.ownerAfter, 'terran');
    assert.ok(!r.js.some((j) => j.crossed.includes(r.target)), 'the fleet reached its target after the ceasefire');
    assert.ok(r.js.some((j) => j.kind === 'operation' && j.staleAt), `no stale stop recorded: ${JSON.stringify(r.js)}`);
  });

  await check('new-feature', 'DEBUG-JOURNEYS the debug view lists every movement under way with actor, purpose, origin, leg, destination, days, authority and next blocker (SHOT)', async () => {
    await fresh('sm-debug'); await setup();
    const r = await ev(() => {
      const t = testBM1;
      const P = window.__Q('Paso'), AC = window.__idx('Alpha Centauri'), E = window.__idx('Earth');
      for (const i of [P, AC, E]) t.markSystemVisited(i);
      t.startPlayerEvacuation(P, E, [window.__ship('Hauler Ames', P, 215, 600)], { target: 3000000 });
      const m = window.__klingonMission();
      window.__launch(m);
      window.__aiBlockade('klingon', AC, 12);
      window.__adv(2);
      const html = t.renderJourneyDebug();
      const div = document.createElement('div'); div.innerHTML = html;
      const heads = [...div.querySelectorAll('[data-journey-table] th')].map((x) => x.textContent);
      const rows = [...div.querySelectorAll('[data-journey-row]')].map((x) => [...x.querySelectorAll('td')].map((td) => td.textContent));
      return { heads, rows: rows.slice(0, 12), n: rows.length, stats: div.querySelector('[data-journey-stats]')?.textContent };
    });
    evidence.push({ check: 'DEBUG-JOURNEYS', ...r });
    await shotSection('SM-debug-shared-journeys.png', '[data-journey-section]');
    assert.deepEqual(r.heads, ['Actor (vids)', 'Purpose', 'Origin', 'Current leg', 'Destination', 'Departure / arrival', 'Authority', 'Next blocker']);
    assert.ok(r.n >= 2, `rows ${r.n}`);
    assert.ok(r.rows.some((x) => /evacuation/.test(x[0]) && /Alpha Centauri/.test(x[7])), 'the evacuation row does not name the blockade ahead');
    assert.ok(r.rows.some((x) => /operation/.test(x[0]) && /war/.test(x[6])), 'the war fleet row has no war authority');
  });

  // ------------------------------------------------------------------------------------------------
  // The captain's own ships on model journeys
  // ------------------------------------------------------------------------------------------------
  await check('new-feature', 'PLAYER-BLOCKADE-JOURNEY the captain\'s ships sent to blockade a neighbouring world fly there on a journey; the mirror keeps them on it across daily syncs; the blockade forms when they arrive', async () => {
    await fresh('sm-player-block'); await setup();
    const r = await ev(() => {
      const t = testBM1, w = t.buildCampaignWorld(true);
      const target = window.__idx("Ty'Gokor");
      const from = w.neighbours(target).map(Number).sort((a, b) => window.__leg(a, target) - window.__leg(b, target))[0];
      t.markSystemVisited(target); t.markSystemVisited(from);
      const ids = Array.from({ length: 6 }, (_, k) => window.__ship(`bl${k}`, from, 4, 1400));
      const res = t.startPlayerBlockade(target, ids);
      if (!res.ok) return { fail: res.reason };
      const b = res.record, status0 = b.status;
      const leg = window.__leg(from, target);
      const days = [];
      for (let k = 0; k < leg + 2; k++) { window.__adv(1); days.push([t.state.day, b.status, t.state.playerFleet.filter((f) => ids.includes(f.id)).map((f) => Number(f.systemIndex)).join(','), b.hulls.length]); }
      const j = (t.campaign().journeys || []).find((x) => x.ref === b.id);
      return { from, target, leg, status0, days, j: j && { status: j.status, members: j.members.length, detached: j.detached, crossed: j.crossed }, final: b.status, vids: ids.map(window.__vid) };
    });
    evidence.push({ check: 'PLAYER-BLOCKADE-JOURNEY', ...r });
    assert.ok(!r.fail, r.fail);
    assert.equal(r.status0, 'forming');
    assert.ok(r.j, 'no journey');
    assert.deepEqual(r.j.detached, [], `ships were dropped from the journey: ${JSON.stringify(r.j.detached)}`);
    assert.equal(r.j.status, 'arrived');
    assert.equal(r.final, 'active');
    const arrived = r.days.find((d) => d[2].split(',').every((x) => Number(x) === r.target));
    assert.ok(arrived, JSON.stringify(r.days));
  });

  await check('new-feature', 'CANCEL-IN-WARP the captain cancels an evacuation while its convoy is in warp: the ships finish the leg in flight, stop there and are free; nothing is delivered and nothing teleports', async () => {
    await fresh('sm-cancel-warp'); await setup();
    const r = await ev(() => {
      const t = testBM1;
      const P = window.__Q('Paso'), AC = window.__idx('Alpha Centauri'), E = window.__idx('Earth');
      for (const i of [P, AC, E]) t.markSystemVisited(i);
      const ids = [window.__ship('Hauler Ames', P, 215, 600), window.__ship('Hauler Brisk', P, 215, 600)];
      const e = t.startPlayerEvacuation(P, E, ids, { target: 3000000 }).record;
      window.__adv(3);
      const tr = t.Campaign.journeyById(t.campaign(), e.convoy.journeyId);
      const leg = { from: tr.from, to: tr.path[tr.legIndex], arr: tr.legArrivalDay };
      t.cancelPlayerEvacuation(e.id);
      const held = t.state.playerFleet.filter((f) => ids.includes(f.id)).map((f) => [f.strategicOp || null, Number(f.systemIndex)]);
      window.__adv(leg.arr - t.state.day + 1);
      const book = t.campaign(); t.syncPlayerPolity(book);
      const after = t.state.playerFleet.filter((f) => ids.includes(f.id)).map((f) => [f.strategicOp || null, Number(f.systemIndex), f.strategicReleasePending || null]);
      const mirror = book.polities.player.hulls.filter((h) => ids.includes(h.id.slice(3))).map((h) => [h.status, Number(h.systemIndex), Boolean(h.transit)]);
      return { leg, held, after, mirror, status: window.__evac(e.id).status, moved: window.__evac(e.id).moved, journey: t.Campaign.journeyById(book, tr.id)?.status };
    });
    evidence.push({ check: 'CANCEL-IN-WARP', ...r });
    assert.equal(r.moved, 0);
    assert.ok(r.held.every((x) => x[0] != null), `released mid-leg: ${JSON.stringify(r.held)}`);
    assert.ok(r.after.every((x) => x[0] == null && x[1] === r.leg.to && x[2] == null), `not freed at the leg end: ${JSON.stringify(r.after)}`);
    assert.ok(r.mirror.every((x) => x[0] === 'ready' && x[1] === r.leg.to && !x[2]), JSON.stringify(r.mirror));
    assert.notEqual(r.journey, 'underway');
  });

  await check('preservation', 'FORMATION-UNCHANGED a player formation still flies the canonical record: legs, crossings and arrival as before, now built by the shared module', async () => {
    await fresh('sm-formation'); await setup();
    const r = await ev(() => {
      const t = testBM1, b = t.fleetBook();
      const A = window.__idx('Earth'), D = window.__idx('Paso');
      const ids = [window.__ship('F1', A, 4, 1400), window.__ship('F2', A, 4, 1400)];
      const g = t.Fleet.addFormation(b, 'Test Formation');
      for (const id of ids) t.Fleet.assignFormation(b, id, g.id);
      g.destination = D;
      t.dispatchFleetFormation(g.id);
      const tr = g.travel;
      if (!tr) return { fail: 'no travel' };
      const days = tr.legDays.reduce((n, d) => n + d, 0);
      window.__adv(days + 1);
      return { kind: tr.kind, sponsor: tr.sponsor, legs: tr.legDays, crossed: tr.crossed.map((c) => c.system), path: tr.path, status: tr.status, at: t.state.playerFleet.filter((f) => ids.includes(f.id)).map((f) => Number(f.systemIndex)), D };
    });
    evidence.push({ check: 'FORMATION-UNCHANGED', ...r });
    assert.ok(!r.fail, r.fail);
    assert.equal(r.status, 'arrived'); assert.deepEqual(r.crossed, r.path);
    assert.ok(r.at.every((x) => x === r.D));
  });

  fs.writeFileSync(path.join(out, 'strategic-movement-gate.json'), JSON.stringify({ hasJourneys, results, evidence }, null, 1));
  const byCat = (c) => { const x = results.filter((y) => y.category === c); return `${x.filter((y) => y.ok).length}/${x.length}`; };
  console.log(`\nstrategic movement in-game: ${results.filter((x) => x.ok).length}/${results.length} (baseline-defect ${byCat('baseline-defect')}, new-feature ${byCat('new-feature')}, preservation ${byCat('preservation')})`);
  if (probe.errors.length) console.log('page errors:', probe.errors.slice(0, 5));
  await probe.close();
  process.exit(results.every((x) => x.ok) && !probe.errors.length ? 0 : 1);
})().catch((e) => { console.error(e); process.exit(1); });
