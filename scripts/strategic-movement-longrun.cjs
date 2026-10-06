// Long-run measurement for STRATEGIC-MOVEMENT-UNIFICATION in the real game (not a balance claim): the
// default campaign with its real wars, AI planning, doctrine traffic, evacuations and blockades, advanced
// day by day on one seed. Run it against the candidate and against 29710b1 (BM1_TEST_ROOT=<tree>/dist):
// the baseline has no journey record, so what can be measured there is measured from the operations,
// evacuations and blockades themselves.
const fs = require('node:fs');
const path = require('node:path');
const { startProbe } = require('./probe-harness.cjs');
(async () => {
  const days = Number(process.env.BM1_LONGRUN_DAYS || 400);
  const label = process.env.BM1_LONGRUN_LABEL || 'candidate';
  const out = process.env.BM1_TEST_OUTPUT || '/tmp';
  fs.mkdirSync(out, { recursive: true });
  const probe = await startProbe({ viewport: { width: 1200, height: 800 } });
  const { ev, fresh, page } = probe;
  await page.waitForFunction(() => !testBM1.doctrineStatus || testBM1.doctrineStatus().state !== 'loading', null, { timeout: 30000 }).catch(() => {});
  const t0 = Date.now();
  await fresh('movement-longrun');
  await ev(() => {
    window.__acc = { forceDays: { standing: 0, committed: 0, transit: 0 }, patrolDays: { travelling: 0, standing: 0 }, maxActiveJourneys: 0, journeyDaySum: 0, samples: 0, warLog: [], seenWar: {}, controllerChanges: 0, lastControl: null, opsSeen: {}, evacSeen: {}, blockSeen: {}, disabledMax: 0 };
  });
  const samples = [];
  for (let d = 0; d < days; d += 10) {
    await ev(() => {
      const t = testBM1, book = t.campaign(), a = window.__acc;
      for (let i = 0; i < 10; i++) {
        t.advanceFleetCalendar(1, t.Fleet.nextId(t.fleetBook(), 'journey'));
        const live = (book.journeys || []).filter((j) => j.status === 'underway').length;
        a.maxActiveJourneys = Math.max(a.maxActiveJourneys, live); a.journeyDaySum += live; a.samples++;
        for (const [k, w] of Object.entries(book.warStates || {})) { const key = `${k}|${w.instance}|${w.status}`; if (!a.seenWar[key]) { a.seenWar[key] = true; a.warLog.push({ day: t.state.day, pair: k, status: w.status }); } }
        const ctl = t.buildCampaignWorld(true).systems.map((s) => s.controller).join(',');
        if (a.lastControl && a.lastControl !== ctl) a.controllerChanges += ctl.split(',').filter((c, j) => c !== a.lastControl.split(',')[j]).length;
        a.lastControl = ctl;
        // Forces: standing (free, not moving), committed (on an order, not moving), in transit.
        for (const p of Object.values(book.polities)) for (const h of p.hulls || []) { if (h.status === 'lost') continue; if (h.transit) a.forceDays.transit++; else if (h.opId || h.status === 'assigned') a.forceDays.committed++; else a.forceDays.standing++; }
        // Doctrine patrols: days in warp against days on station or at home.
        { const db = t.DoctrineCampaign?.doctrineBook(book); for (const x of db?.assignments || []) { if (x.status !== 'active' || !['patrol', 'area_patrol', 'patrol_area'].includes(x.kind)) continue; const h = book.polities[x.polity]?.hulls.find((y) => y.id === x.hullId); if (!h) continue; if (h.transit) a.patrolDays.travelling++; else a.patrolDays.standing++; } }
        for (const o of book.operations || []) a.opsSeen[o.id] = { plannedEta: o.plan?.etaDays ?? null, actualEta: o.arriveDay != null && o.createdDay != null ? o.arriveDay - o.createdDay : null, losses: o.losses, defenderLosses: o.defenderLosses, faction: o.faction, kind: o.kind, created: o.createdDay, arrive: o.arriveDay, engaged: o.engagedDay, resolved: o.resolvedDay, outcome: o.outcome, status: o.status, hops: o.journeyIds ? o.journeyIds.length : null };
        for (const e of book.evacuations || []) a.evacSeen[e.id] = { oneWayDays: t.Campaign.evacuationRoundTripDays ? t.Campaign.evacuationRoundTripDays(t.buildCampaignWorld(true), e) / 2 : null, trips: e.convoy?.trip ?? null, sponsor: e.sponsor, start: e.startDay, end: e.endDay, status: e.status, moved: e.moved, target: e.target, runs: (e.convoy?.attempts || []).length };
        for (const b of book.blockades || []) a.blockSeen[b.id] = { losses: b.losses, power: b.power, start: b.startDay, active: b.activeDay, status: b.status, end: b.endDay, runs: (b.runs || []).length, byKind: (b.runs || []).reduce((m, r) => { m[r.kind] = (m[r.kind] || 0) + 1; return m; }, {}) };
        const dis = Object.values(book.polities).flatMap((p) => p.hulls).filter((h) => t.Campaign.hullIsDisabled(h)).length;
        a.disabledMax = Math.max(a.disabledMax, dis);
      }
    });
    if ((d + 10) % 50 === 0) {
      const s = await ev(() => {
        const t = testBM1, book = t.campaign(), a = window.__acc;
        const st = book.stats.journeys || null;
        const hulls = Object.values(book.polities).flatMap((p) => p.hulls);
        return { day: t.state.day, bookBytes: JSON.stringify(book).length, journeysStored: (book.journeys || []).length, activeJourneys: (book.journeys || []).filter((j) => j.status === 'underway').length,
          journeyStats: st && { ...st, meanLegDays: st.legs ? Math.round(100 * st.legDays / st.legs) / 100 : null },
          disabledNow: hulls.filter((h) => t.Campaign.hullIsDisabled(h)).length, lostTotal: book.stats.hullsLost, battles: book.stats.battlesResolved, captures: book.stats.captures ?? null,
          wars: Object.values(book.warStates || {}).filter((w) => w.status === 'war').length };
      });
      samples.push(s);
      console.log(label, JSON.stringify({ day: s.day, bytes: s.bookBytes, active: s.activeJourneys, legs: s.journeyStats?.meanLegDays ?? null, runs: s.journeyStats?.blockadeRuns ?? null, wars: s.wars }));
    }
  }
  const fin = await ev(() => {
    const t = testBM1, book = t.campaign(), a = window.__acc;
    const ops = Object.values(a.opsSeen), evs = Object.values(a.evacSeen), bls = Object.values(a.blockSeen);
    const by = (list, f) => list.reduce((m, x) => { const k = f(x); m[k] = (m[k] || 0) + 1; return m; }, {});
    const mean = (xs) => (xs.length ? Math.round(10 * xs.reduce((n, x) => n + x, 0) / xs.length) / 10 : null);
    let saveBytes = null; try { t.saveGame(3); saveBytes = (t.getSaveSlotRaw?.(3) || '').length; } catch (e) { saveBytes = String(e.message || e); }
    return {
      timeScale: (() => {
        const db = t.DoctrineCampaign?.doctrineBook(book); const st = db?.stats || {};
        const cancelled = ops.filter((o) => o.status === 'resolved' && o.engaged == null && ['stood-down', 'recalled', 'turned-back', 'superseded', 'cancelled'].includes(o.outcome));
        const dist = {}; for (const e of evs) { const d = e.oneWayDays; if (d == null) continue; const b = d <= 10 ? '≤10' : d <= 20 ? '11–20' : d <= 30 ? '21–30' : d <= 45 ? '31–45' : '>45'; dist[b] = (dist[b] || 0) + 1; }
        const done = evs.filter((e) => e.status === 'completed');
        const fd = a.forceDays, n = a.samples || 1;
        return {
          operationEta: { planned: mean(ops.filter((o) => o.plannedEta != null).map((o) => o.plannedEta)), actual: mean(ops.filter((o) => o.actualEta != null).map((o) => o.actualEta)), cancelledUnderway: cancelled.length },
          patrol: { travellingDays: a.patrolDays.travelling, standingDays: a.patrolDays.standing, travellingShare: (a.patrolDays.travelling + a.patrolDays.standing) ? Math.round(100 * a.patrolDays.travelling / (a.patrolDays.travelling + a.patrolDays.standing)) : null, replacementHeldDays: st.patrolReplacementHeldDays || 0 },
          rescue: { proposed: st.etaRescueProposed || 0, feasible: st.etaRescueFeasible || 0, failedByDistance: st.etaRescueFailedByDistance || 0 },
          investigation: { proposed: st.etaInvestigationProposed || 0, feasible: st.etaInvestigationFeasible || 0, failedByDistance: st.etaInvestigationFailedByDistance || 0 },
          evacuation: { started: evs.length, completed: done.length, meanCycleDays: mean(done.filter((e) => e.trips).map((e) => (e.end - e.start) / e.trips)), moved: evs.reduce((n2, e) => n2 + e.moved, 0), destinationOneWayDays: dist, meanOneWayDays: mean(evs.filter((e) => e.oneWayDays != null).map((e) => e.oneWayDays)) },
          forcesMeanPerDay: { standing: Math.round(fd.standing / n), committed: Math.round(fd.committed / n), inTransit: Math.round(fd.transit / n) },
        };
      })(),
      operations: { total: ops.length, byOutcome: by(ops, (o) => o.outcome || o.status), engaged: ops.filter((o) => o.engaged != null).length, meanDaysToEngage: mean(ops.filter((o) => o.engaged != null).map((o) => o.engaged - o.created)), resolved: ops.filter((o) => o.status === 'resolved').length },
      evacuations: { total: evs.length, byStatus: by(evs, (e) => e.status), meanCompletionDays: mean(evs.filter((e) => e.status === 'completed').map((e) => e.end - e.start)), moved: evs.reduce((n, e) => n + e.moved, 0) },
      lossesBySource: { operationsAttacker: ops.reduce((n, o) => n + (o.losses || 0), 0), operationsDefender: ops.reduce((n, o) => n + (o.defenderLosses || 0), 0), blockades: bls.reduce((n, b) => n + (b.losses || 0), 0),
        byPolity: Object.fromEntries(Object.entries(book.polities).map(([k, p]) => [k, p.lostHulls || 0]).filter(([, n]) => n > 0)) },
      blockades: { total: bls.length, byStatus: by(bls, (b) => b.status), meanFormingDays: mean(bls.map((b) => (b.active ?? b.start) - b.start)), runsByKind: bls.reduce((m, b) => { for (const [k, n] of Object.entries(b.byKind)) m[k] = (m[k] || 0) + n; return m; }, {}) },
      maxActiveJourneys: a.maxActiveJourneys, meanActiveJourneys: a.samples ? Math.round(10 * a.journeyDaySum / a.samples) / 10 : 0, disabledMax: a.disabledMax,
      doctrine: (() => { const db = t.DoctrineCampaign?.doctrineBook(book); if (!db) return null; const st = db.stats || {};
        return { incidents: st.incidentsCreated || 0, liveObjectives: st.liveObjectives || 0, deferred: st.deferred || 0, completed: st.objectivesCompleted || 0, aborted: st.objectivesAborted || 0, expired: st.objectivesExpired || 0, blockadeRuns: st.blockadeRuns || 0, patrolsReturned: st.patrolsReturned || 0,
          assignmentsCompleted: db.assignments.filter((x) => x.status === 'completed').length, byResponse: by(db.objectives, (o) => `${typeof o.response === 'string' ? o.response : o.kind}:${o.status}`),
          etaObjectives: db.objectives.filter((o) => ['investigate', 'rescue'].includes(o.response)).map((o) => ({ response: o.response, created: o.createdDay, plan: o.plan || null, deadline: o.deadline?.value, arrived: o.arrivedDay ?? null, status: o.status, reasons: o.resolution?.reasons || null, note: o.resolution?.note || null })) }; })(),
      controllerChanges: a.controllerChanges, warLog: a.warLog, saveBytes, hullsLost: book.stats.hullsLost, battles: book.stats.battlesResolved };
  });
  const res = { label, days, seconds: Math.round((Date.now() - t0) / 1000), samples, final: fin, errors: probe.errors.slice(0, 5) };
  fs.writeFileSync(path.join(out, `strategic-movement-longrun-${label}.json`), JSON.stringify(res, null, 1));
  console.log(label, 'final', JSON.stringify({ ...fin, warLog: fin.warLog.length }));
  await probe.close();
  process.exit(probe.errors.length ? 1 : 0);
})();
