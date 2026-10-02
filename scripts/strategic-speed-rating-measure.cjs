// Same-seed long-run measurement for the RATED round of SHIP-DEPENDENT-STRATEGIC-SPEED in the real game (not a
// balance claim, not tuned to the old numbers): the default campaign with its wars, AI planning, doctrine traffic,
// evacuations and blockades, advanced day by day. Run it against the candidate and against 7d3ce43
// (BM1_TEST_ROOT=<tree>/dist, BM1_LONGRUN_LABEL=baseline). Every journey is bucketed by the RATING this tree's
// catalogue gives its slowest member (read from bm-ships/ships.json and handed to the page), on both builds, so
// the two are compared bucket for bucket; 7d3ce43 flew category speeds with legs rounded to nearest.
// Beyond the previous round's measure: journey time by role, the slowest-member penalty (days a group flew beyond
// what its fastest member alone would have), the rating mix of the hulls the AI sends against what it has,
// shuttle-class journeys, the longest journeys, and control changes.
//   leg duration by speed bucket (days flown per chart day), group speeds, rescue feasibility by speed,
//   evacuation one-way and cycle, operation planned vs actual ETA (and every mismatch), reinforcement and
//   return arrivals, patrol travel share, blockade encounters, garrisons, save size and time per day.
const fs = require('node:fs');
const path = require('node:path');
const { startProbe } = require('./probe-harness.cjs');
const catalogue = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'bm-ships', 'ships.json'), 'utf8')).ships;
const SPEEDS = Object.fromEntries(catalogue.map((s) => [s.id, s.strategicSpeed ?? 1]));
const RATINGS = Object.fromEntries(catalogue.map((s) => [s.id, s.strategicSpeedRating ?? 5]));
const ROLES = Object.fromEntries(catalogue.map((s) => [s.id, String(s.role || s.shipClass || 'unknown')]));
(async () => {
  const days = Number(process.env.BM1_LONGRUN_DAYS || 400);
  const label = process.env.BM1_LONGRUN_LABEL || 'candidate';
  const out = process.env.BM1_TEST_OUTPUT || '/tmp';
  fs.mkdirSync(out, { recursive: true });
  const probe = await startProbe({ viewport: { width: 1200, height: 800 } });
  const { ev, fresh, page } = probe;
  await page.waitForFunction(() => !testBM1.doctrineStatus || testBM1.doctrineStatus().state !== 'loading', null, { timeout: 30000 }).catch(() => {});
  await fresh('speed-rating-longrun');
  await ev(({ SPEEDS, RATINGS, ROLES }) => {
    window.__SPEEDS = SPEEDS; window.__RATINGS = RATINGS; window.__ROLES = ROLES;
    window.__acc = { ms: 0, n: 0, journeys: {}, ops: {}, evac: {}, block: {}, patrol: { travelling: 0, standing: 0 }, rescue: {}, minStanding: {}, mismatches: [], control: null, controlChanges: 0, fleetRatings: [] };
  }, { SPEEDS, RATINGS, ROLES });
  const samples = [];
  for (let d = 0; d < days; d += 10) {
    await ev(() => {
      const t = testBM1, book = t.campaign(), a = window.__acc;
      const sp = (h) => window.__SPEEDS[h?.shipId] ?? 1;
      const hullOf = (polity, id) => book.polities[polity]?.hulls.find((h) => h.id === id);
      for (let i = 0; i < 10; i++) {
        const t0 = performance.now();
        t.advanceFleetCalendar(1, t.Fleet.nextId(t.fleetBook(), 'journey'));
        a.ms += performance.now() - t0; a.n++;
        const day = t.state.day;
        // Journeys: as started (speed as the catalogue gives its slowest member at departure), and as ended.
        for (const j of book.journeys || []) {
          let r = a.journeys[j.id];
          if (!r) {
            const hs = j.members.map((id) => hullOf(j.sponsor, id)).filter(Boolean);
            const rt = (h) => window.__RATINGS[h?.shipId] ?? 5;
            const slowH = hs.slice().sort((x, y) => sp(x) - sp(y))[0];
            r = a.journeys[j.id] = { kind: j.kind, purpose: j.purpose, sponsor: j.sponsor, start: j.startDay, members: hs.length, slowest: hs.length ? Math.min(...hs.map(sp)) : 1, fastest: hs.length ? Math.max(...hs.map(sp)) : 1, speed: j.speed ?? null,
              slowRating: slowH ? rt(slowH) : 5, slowRole: slowH ? (window.__ROLES[slowH.shipId] || 'unknown') : 'unknown', ratings: hs.map(rt), opId: hs.find((h) => h.opId)?.opId ?? null,
              base: j.legBase ? j.legBase.map((l) => l.days) : j.legDays.slice(), legDays0: j.legDays.slice(), plannedEta: j.etaDay };
          }
          if (j.status !== 'underway' && r.status == null) { r.status = j.status; r.end = j.endDay ?? j.arrivedDay ?? day; r.arrived = j.arrivedDay ?? null; r.legDays = j.legDays.slice(); r.history = j.speedHistory || null; }
        }
        for (const o of book.operations || []) a.ops[o.id] = { faction: o.faction, created: o.createdDay, plannedEta: o.plan?.etaDays ?? null, plannedArrive: o.plan?.arriveDay ?? null, arrive: o.arriveDay ?? null, engaged: o.engagedDay ?? null, speed: o.plan?.speed ?? null, outcome: o.outcome || null, status: o.status };
        for (const e of book.evacuations || []) a.evac[e.id] = { sponsor: e.sponsor, start: e.startDay, end: e.endDay, status: e.status, trips: e.convoy?.trip ?? null, moved: e.moved,
          oneWay: t.Campaign.evacuationRoundTripDays ? t.Campaign.evacuationRoundTripDays(t.buildCampaignWorld(true), e) / 2 : null, speed: t.Campaign.evacuationSpeed ? t.Campaign.evacuationSpeed(t.buildCampaignWorld(true), e) : null };
        for (const b of book.blockades || []) a.block[b.id] = { power: b.power, status: b.status, runs: (b.runs || []).length, byKind: (b.runs || []).reduce((m, r) => { m[r.kind] = (m[r.kind] || 0) + 1; return m; }, {}), losses: b.losses };
        const db = t.DoctrineCampaign?.doctrineBook(book);
        for (const x of db?.assignments || []) {
          if (x.status !== 'active' || !['patrol', 'area_patrol', 'patrol_area'].includes(x.kind)) continue;
          const h = hullOf(x.polity, x.hullId); if (!h) continue;
          if (h.transit) a.patrol.travelling++; else a.patrol.standing++;
        }
        for (const o of db?.objectives || []) if (o.response === 'rescue' && !a.rescue[o.id]) { const h = hullOf(o.polity, o.assigned?.hullId); a.rescue[o.id] = { speed: sp(h), plan: o.plan || null }; }
        for (const o of db?.objectives || []) if (a.rescue[o.id] && o.status !== 'active') Object.assign(a.rescue[o.id], { status: o.status, arrived: o.arrivedDay ?? null });
        for (const [k, p] of Object.entries(book.polities)) { if (k === 'player') continue; const n = (p.hulls || []).filter((h) => h.status === 'ready' && !h.opId && !h.transit).length; a.minStanding[k] = Math.min(a.minStanding[k] ?? 1e9, n); }
        // Control changes: the controller of every system, day by day.
        const ctl = t.state.planets.map((_, i) => t.getSystemControl(i)?.controller ?? null);
        if (a.control) a.controlChanges += ctl.filter((c, i) => c !== a.control[i]).length;
        a.control = ctl;
        // The rating mix of every AI hull available (ready, sampled every 10 days) — what the AI could send.
        if (day % 10 === 0) for (const [k, p] of Object.entries(book.polities)) { if (k === 'player') continue; for (const h of p.hulls || []) if (h.status === 'ready') a.fleetRatings.push(window.__RATINGS[h.shipId] ?? 5); }
      }
    });
    if ((d + 10) % 100 === 0) {
      const s = await ev(() => { const t = testBM1, book = t.campaign(); return { day: t.state.day, bookBytes: JSON.stringify(book).length, active: (book.journeys || []).filter((j) => j.status === 'underway').length, wars: Object.values(book.warStates || {}).filter((w) => w.status === 'war').length }; });
      samples.push(s); console.log(label, JSON.stringify(s));
    }
  }
  const fin = await ev(() => {
    const t = testBM1, book = t.campaign(), a = window.__acc, db = t.DoctrineCampaign?.doctrineBook(book);
    const mean = (xs) => (xs.length ? Math.round(100 * xs.reduce((n, x) => n + x, 0) / xs.length) / 100 : null);
    const sum = (xs) => xs.reduce((n, x) => n + x, 0);
    const J = Object.values(a.journeys);
    // Rating bands (of the slowest member, from the catalogue) — not the build's own speed, so both builds bucket alike.
    const band = (r) => (r <= 2.5 ? '1–2.5' : r <= 4.5 ? '3–4.5' : r <= 6 ? '5–6' : r <= 7.5 ? '6.5–7.5' : r <= 8.5 ? '8–8.5' : '9–10');
    const MULT = { 1: 0.7, 1.5: 0.74, 2: 0.78, 2.5: 0.82, 3: 0.85, 3.5: 0.89, 4: 0.92, 4.5: 0.96, 5: 1, 5.5: 1.04, 6: 1.08, 6.5: 1.12, 7: 1.16, 7.5: 1.2, 8: 1.24, 8.5: 1.28, 9: 1.32, 9.5: 1.36, 10: 1.4 };
    const rOf = (s) => { let best = 5, d = 1e9; for (const [r, m] of Object.entries(MULT)) if (Math.abs(m - s) < d) { d = Math.abs(m - s); best = Number(r); } return best; };
    const bucket = (s) => band(rOf(s));
    // Leg duration: the first leg of each journey (never re-timed), days flown per chart day.
    const legs = {};
    for (const j of J) { if (!j.base.length) continue; const k = band(j.slowRating); (legs[k] ||= { journeys: 0, chartDays: 0, flownDays: 0, legs: [] }); const L = legs[k]; L.journeys++; L.chartDays += j.base[0]; L.flownDays += j.legDays0[0]; L.legs.push(j.legDays0[0]); }
    for (const L of Object.values(legs)) { L.flownPerChartDay = Math.round(100 * L.flownDays / L.chartDays) / 100; L.meanLeg = mean(L.legs); L.minLeg = Math.min(...L.legs); L.maxLeg = Math.max(...L.legs); delete L.legs; }
    // Arrival: planned at departure vs actual (only journeys that arrived untouched: no supersession).
    const arrived = J.filter((j) => j.status === 'arrived' && j.arrived != null);
    const etaMismatch = arrived.filter((j) => j.plannedEta != null && j.arrived !== j.plannedEta && !(j.history && j.history.length > 1));
    const groups = J.filter((j) => j.members > 1);
    const ops = Object.values(a.ops);
    const engaged = ops.filter((o) => o.engaged != null && o.plannedArrive != null);
    const ev2 = Object.values(a.evac);
    const done = ev2.filter((e) => e.status === 'completed' && e.trips);
    const rescues = Object.values(a.rescue);
    const st = db?.stats || {};
    const reinf = J.filter((j) => ['reinforce', 'return'].includes(j.purpose) || ['return', 'expedition'].includes(j.kind));
    // Journey time by the slowest member's role (arrived journeys, total days, and days per chart day).
    const byRole = {};
    for (const j of arrived) { const k = j.slowRole; const x = (byRole[k] ||= { n: 0, days: 0, chart: 0, rating: j.slowRating }); x.n++; x.days += j.arrived - j.start; x.chart += j.base.reduce((n, d) => n + d, 0); }
    const roleRows = Object.entries(byRole).map(([role, x]) => ({ role, rating: x.rating, journeys: x.n, meanDays: Math.round(10 * x.days / x.n) / 10, perChartDay: Math.round(100 * x.days / Math.max(1, x.chart)) / 100 })).sort((p, q) => q.journeys - p.journeys);
    const byBand = {};
    for (const j of arrived) { const k = band(j.slowRating); const x = (byBand[k] ||= { n: 0, days: 0, max: 0 }); x.n++; x.days += j.arrived - j.start; x.max = Math.max(x.max, j.arrived - j.start); }
    for (const x of Object.values(byBand)) { x.meanDays = Math.round(10 * x.days / x.n) / 10; delete x.days; }
    // Slowest-member penalty: the days a group's first leg took beyond what its fastest member alone would take.
    const pen = groups.filter((g) => g.base.length).map((g) => g.legDays0[0] - Math.max(1, Math.ceil(g.base[0] / g.fastest - 1e-9)));
    // The AI's choice of hulls: mean rating of hulls in operations and war groups against the mean of its ready hulls.
    const opRatings = J.filter((j) => j.opId || j.purpose === 'attack' || j.kind === 'operation').flatMap((j) => j.ratings);
    const longest = arrived.slice().sort((p, q) => (q.arrived - q.start) - (p.arrived - p.start)).slice(0, 5).map((j) => ({ kind: j.kind, purpose: j.purpose, days: j.arrived - j.start, legs: j.legDays, slowRating: j.slowRating, slowRole: j.slowRole }));
    const extra = {
      journeyTimeByRole: roleRows.slice(0, 16), journeyTimeByBand: byBand,
      slowestMemberPenalty: { groups: pen.length, slowed: pen.filter((p) => p > 0).length, meanPenaltyDays: mean(pen), maxPenaltyDays: pen.length ? Math.max(...pen) : null },
      aiHullChoice: { opHulls: opRatings.length, meanOpRating: mean(opRatings), meanReadyRating: mean(a.fleetRatings) },
      shuttleClass: { journeys: arrived.filter((j) => j.slowRating <= 3).length, meanDays: mean(arrived.filter((j) => j.slowRating <= 3).map((j) => j.arrived - j.start)) },
      longestJourneys: longest, controlChanges: a.controlChanges,
    };
    let saveBytes = null; try { t.saveGame(3); saveBytes = (t.getSaveSlotRaw?.(3) || '').length; } catch (e) { saveBytes = String(e.message || e); }
    return {
      legDurationBySpeed: legs,
      journeys: { total: J.length, arrived: arrived.length, plannedVsActualMismatch: etaMismatch.length, mismatchSample: etaMismatch.slice(0, 5), respeededAtBoundary: J.filter((j) => j.history && j.history.length > 1).length },
      groupSpeeds: { groups: groups.length, meanSlowest: mean(groups.map((g) => g.slowest)), meanFastest: mean(groups.map((g) => g.fastest)), slowedByAMember: groups.filter((g) => g.slowest < g.fastest).length },
      rescue: { proposed: st.etaRescueProposed || 0, feasible: st.etaRescueFeasible || 0, failedByDistance: st.etaRescueFailedByDistance || 0, sent: rescues.length, bySpeed: rescues.reduce((m, r) => { const k = bucket(r.speed); (m[k] ||= { sent: 0, completed: 0, arrivedOnPlan: 0 }); m[k].sent++; if (r.status === 'completed') m[k].completed++; if (r.arrived != null && r.plan?.arriveDay === r.arrived) m[k].arrivedOnPlan++; return m; }, {}) },
      investigation: { proposed: st.etaInvestigationProposed || 0, feasible: st.etaInvestigationFeasible || 0, failedByDistance: st.etaInvestigationFailedByDistance || 0 },
      evacuation: { started: ev2.length, completed: done.length, meanOneWay: mean(ev2.filter((e) => e.oneWay != null).map((e) => e.oneWay)), meanCycle: mean(done.map((e) => (e.end - e.start) / e.trips)), meanConvoySpeed: mean(ev2.filter((e) => e.speed != null).map((e) => e.speed)), moved: sum(ev2.map((e) => e.moved || 0)), byStatus: ev2.reduce((m, e) => { m[e.status] = (m[e.status] || 0) + 1; return m; }, {}) },
      operations: { total: ops.length, meanPlannedEta: mean(ops.filter((o) => o.plannedEta != null).map((o) => o.plannedEta)), meanSpeed: mean(ops.filter((o) => o.speed != null).map((o) => o.speed)), engaged: engaged.length, engagedOffPlannedDay: engaged.filter((o) => o.engaged !== o.plannedArrive).map((o) => ({ planned: o.plannedArrive, engaged: o.engaged, outcome: o.outcome })).slice(0, 8), engagedOffCount: engaged.filter((o) => o.engaged !== o.plannedArrive).length },
      reinforcementsAndReturns: { journeys: reinf.length, arrived: reinf.filter((j) => j.status === 'arrived').length, byStatus: reinf.reduce((m, j) => { const k = j.status || 'underway'; m[k] = (m[k] || 0) + 1; return m; }, {}), meanDays: mean(reinf.filter((j) => j.arrived != null).map((j) => j.arrived - j.start)), arrivedOffPlan: reinf.filter((j) => j.arrived != null && j.plannedEta != null && j.arrived !== j.plannedEta && !(j.history && j.history.length > 1)).length },
      patrol: { travellingDays: a.patrol.travelling, standingDays: a.patrol.standing, travellingShare: a.patrol.travelling + a.patrol.standing ? Math.round(100 * a.patrol.travelling / (a.patrol.travelling + a.patrol.standing)) : null },
      blockades: { total: Object.keys(a.block).length, runs: sum(Object.values(a.block).map((b) => b.runs)), runsByKind: Object.values(a.block).reduce((m, b) => { for (const [k, n] of Object.entries(b.byKind)) m[k] = (m[k] || 0) + n; return m; }, {}) },
      garrisonsMinStanding: a.minStanding,
      ...extra,
      saveBytes, bookBytes: JSON.stringify(book).length, msPerDay: Math.round(100 * a.ms / a.n) / 100, hullsLost: book.stats.hullsLost, battles: book.stats.battlesResolved,
    };
  });
  // Rescue reach on the real chart, by rating: from every 4th system to every other, the days a lone relief hull of
  // each rating takes (the chart's legs at its multiplier, the same function the journey flies), and whether that
  // is inside the doctrine's survivor window. The long run's own seed raised no rescue, so this is the measure of
  // feasible against failed-by-distance. Only the candidate (the rated build) is measured.
  const reach = await ev(() => {
    const t = testBM1, w = t.buildCampaignWorld(true), C = t.Campaign, S = t.Speed;
    if (!S?.ratingMultiplier) return null;
    const win = t.DoctrineCampaign.doctrineBook(t.campaign()).config.survivorWindowDays ?? 20;
    const ratings = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10];
    const res = Object.fromEntries(ratings.map((r) => [r, { feasible: 0, tooFar: 0, meanDays: 0 }]));
    let pairs = 0;
    for (let a = 0; a < w.systems.length; a += 4) for (let b = 0; b < w.systems.length; b++) {
      if (a === b) continue;
      const p = C.plotJourney(w, a, b, null);
      if (!p || !p.legBase) continue;
      pairs++;
      for (const r of ratings) { const d = S.legDaysAt(p.legBase, S.ratingMultiplier(r)).reduce((n, x) => n + x, 0); const x = res[r]; x.meanDays += d; if (d <= win) x.feasible++; else x.tooFar++; }
    }
    for (const x of Object.values(res)) x.meanDays = Math.round(10 * x.meanDays / Math.max(1, pairs)) / 10;
    return { windowDays: win, pairs, byRating: res };
  });
  fin.rescueReach = reach;
  const res = { label, days, samples, final: fin, errors: probe.errors.slice(0, 5) };
  fs.writeFileSync(path.join(out, `strategic-speed-rating-measure-${label}.json`), JSON.stringify(res, null, 1));
  console.log(label, 'final', JSON.stringify(fin));
  await probe.close();
  process.exit(probe.errors.length ? 1 : 0);
})();
