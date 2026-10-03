// Same-seed long-run measurement for TOWING-SALVAGE-RECOVERY in the real game (not a balance claim): the default
// campaign with its wars, AI planning, doctrine traffic, evacuations and blockades, advanced day by day. Run it
// against the candidate and against 78cd8fa (BM1_TEST_ROOT=<tree>/dist, BM1_LONGRUN_LABEL=baseline): the
// baseline has no recovery missions, so there the hulks are counted as they lie.
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
  await fresh('tow-longrun');
  await ev(() => { window.__acc = { ms: 0, n: 0, strandedEver: {}, strandedMax: 0, strandedDays: 0, openMax: 0, tugsBusyMax: {}, minStanding: {}, towSpeeds: [], crewlessBackInAction: [], writtenOff: 0, derelictMax: 0, valueStranded: 0, rescuedBeforeRecovery: {}, orphanTows: 0, towJourneysSeen: {} }; });
  const samples = [];
  for (let d = 0; d < days; d += 10) {
    await ev(() => {
      const t = testBM1, book = t.campaign(), a = window.__acc;
      for (let i = 0; i < 10; i++) {
        const t0 = performance.now();
        t.advanceFleetCalendar(1, t.Fleet.nextId(t.fleetBook(), 'journey'));
        a.ms += performance.now() - t0; a.n++;
        let stranded = 0;
        for (const [pid, p] of Object.entries(book.polities)) {
          if (pid === 'player') continue;
          for (const h of p.hulls) {
            if (h.status === 'lost') continue;
            if (h.stranded) { stranded++; a.strandedEver[h.id] ||= { pid, shipId: h.shipId, since: h.stranded.since }; }
            // Crew taken off before any recovery of the hull had reached her (TOWING-SALVAGE-AUDIT round).
            if (h.stranded?.crew === 'rescued' && !h.towedBy && !a.rescuedBeforeRecovery[h.id]) a.rescuedBeforeRecovery[h.id] = t.state.day;
            // A repaired hull with too few crew must not be back in action.
            if (h.recrew && (h.status === 'ready' || (h.status === 'assigned' && !String(h.opId || '').includes('doctrine')))) a.crewlessBackInAction.push([h.id, t.state.day, h.status]);
          }
        }
        a.strandedMax = Math.max(a.strandedMax, stranded); a.strandedDays += stranded;
        const open = (book.hullRecoveries || []).filter((r) => !['delivered_to_yard', 'aborted', 'failed'].includes(r.state));
        a.openMax = Math.max(a.openMax, open.length);
        const busy = {}; for (const r of open) busy[r.sponsor] = (busy[r.sponsor] || 0) + 1;
        for (const [k, v] of Object.entries(busy)) a.tugsBusyMax[k] = Math.max(a.tugsBusyMax[k] || 0, v);
        for (const r of open) if (r.inbound?.towSpeed != null && !a.towSpeeds.some((x) => x[0] === r.id)) a.towSpeeds.push([r.id, r.inbound.towSpeed]);
        // An open tow whose casualty is gone (destroyed, salvaged elsewhere) must not survive it.
        for (const r of open) { const found = Object.values(book.polities).some((p) => p.hulls.some((h) => String(h.id) === String(r.target.hullId) && h.status !== 'lost')) || (book.derelicts || []).some((d) => String(d.id) === String(r.target.hullId)); if (!found && !r.awaitingAdoption) a.orphanTows++; }
        for (const r of open) if (r.inbound?.journeyId) a.towJourneysSeen[r.inbound.journeyId] = r.id;
        a.derelictMax = Math.max(a.derelictMax, (book.derelicts || []).length);
        for (const [k, p] of Object.entries(book.polities)) { if (k === 'player') continue; const n = (p.hulls || []).filter((h) => h.status === 'ready' && !h.opId && !h.transit).length; a.minStanding[k] = Math.min(a.minStanding[k] ?? 1e9, n); }
      }
    });
    if ((d + 10) % 100 === 0) {
      const s = await ev(() => { const t = testBM1, book = t.campaign(); return { day: t.state.day, bookBytes: JSON.stringify(book).length, open: (book.hullRecoveries || []).filter((r) => !['delivered_to_yard', 'aborted', 'failed'].includes(r.state)).length, derelicts: (book.derelicts || []).length, recoveryBytes: JSON.stringify(book.hullRecoveries || []).length + JSON.stringify(book.derelicts || []).length }; });
      samples.push(s); console.log(label, JSON.stringify(s));
    }
  }
  const fin = await ev(() => {
    const t = testBM1, book = t.campaign(), a = window.__acc;
    const mean = (xs) => (xs.length ? Math.round(100 * xs.reduce((n, x) => n + x, 0) / xs.length) / 100 : null);
    const recs = book.hullRecoveries || [];
    const st = book.stats.recovery || {};
    const byState = recs.reduce((m, r) => { m[r.state] = (m[r.state] || 0) + 1; return m; }, {});
    const strandedNow = Object.entries(book.polities).filter(([k]) => k !== 'player').flatMap(([pid, p]) => p.hulls.filter((h) => h.status !== 'lost' && h.stranded).map((h) => ({ pid, rec: h.stranded.recovery, crew: h.stranded.crew })));
    const byRec = strandedNow.reduce((m, x) => { m[x.rec] = (m[x.rec] || 0) + 1; return m; }, {});
    let saveBytes = null; try { t.saveGame(3); saveBytes = (t.getSaveSlotRaw?.(3) || '').length; } catch (e) { saveBytes = String(e.message || e); }
    const delivered = recs.filter((r) => r.state === 'delivered_to_yard');
    return {
      strandedEver: Object.keys(a.strandedEver).length, strandedMax: a.strandedMax, meanStrandedPerDay: a.n ? Math.round(10 * a.strandedDays / a.n) / 10 : 0, strandedNowByState: byRec,
      recoveryRequests: st.requested ?? 0, refused: st.refused ?? 0, launched: st.launched ?? 0, successful: st.delivered ?? 0, failed: st.failed ?? 0, aborted: st.aborted ?? 0, tugLosses: st.tugLosses ?? 0, hulksLostUnderTow: st.hulksLostUnderTow ?? 0,
      missionsByState: byState, byKind: recs.reduce((m, r) => { m[r.kind] = (m[r.kind] || 0) + 1; return m; }, {}), bySponsor: recs.reduce((m, r) => { m[r.sponsor] = (m[r.sponsor] || 0) + 1; return m; }, {}),
      meanOutboundEta: st.outboundN ? Math.round(10 * st.outboundDays / st.outboundN) / 10 : null, meanTowEta: st.towN ? Math.round(10 * st.towDays / st.towN) / 10 : null,
      meanTotalDays: mean(delivered.map((r) => r.endedDay - r.createdDay)), maxTotalDays: delivered.length ? Math.max(...delivered.map((r) => r.endedDay - r.createdDay)) : null,
      towSpeeds: { n: a.towSpeeds.length, mean: mean(a.towSpeeds.map((x) => x[1])), min: a.towSpeeds.length ? Math.min(...a.towSpeeds.map((x) => x[1])) : null, max: a.towSpeeds.length ? Math.max(...a.towSpeeds.map((x) => x[1])) : null },
      salvageClaims: st.salvageClaims ?? 0, salvaged: st.salvaged ?? 0, hullValueRecovered: st.valueRecovered ?? 0, aiSkipped: st.skipped || {}, aiSkippedTotal: Object.values(st.skipped || {}).reduce((n, x) => n + x, 0),
      writtenOff: book.stats.hullsWrittenOff ?? null, derelictsNow: (book.derelicts || []).length, derelictsMax: a.derelictMax, derelictsBrokenUp: st.derelictsBrokenUp ?? 0,
      openRecoveriesMax: a.openMax, tugsBusyMaxBySponsor: a.tugsBusyMax, minStandingByPower: a.minStanding, crewlessBackInAction: a.crewlessBackInAction.slice(0, 5), crewlessBackInActionCount: a.crewlessBackInAction.length,
      duplicateIdentities: (() => { const vids = Object.values(book.polities).flatMap((p) => p.hulls.filter((h) => h.status !== 'lost').map((h) => h.identity?.vid || h.vid || h.id)).concat((book.derelicts || []).map((d) => d.identity?.vid || d.id)); return vids.length - new Set(vids).size; })(),
      // TOWING-SALVAGE-AUDIT round additions.
      waitingRequests: st.waitingRequests ?? 0, returnedToService: st.returnedToService ?? 0,
      meanDaysToReachCasualty: mean(recs.filter((r) => r.attachment).map((r) => r.attachment.day - r.createdDay)),
      meanTowingDays: mean(delivered.filter((r) => r.inbound).map((r) => r.endedDay - r.inbound.departDay)),
      crewsRescuedBeforeHullRecovery: Object.keys(a.rescuedBeforeRecovery).length,
      blockadeEncountersWhileTowing: (book.journeys || []).filter((j) => a.towJourneysSeen[j.id]).reduce((n, j) => n + (j.encounters || []).length, 0),
      towFailures: recs.filter((r) => r.state === 'failed').length, failureReasons: recs.filter((r) => ['failed', 'aborted'].includes(r.state)).reduce((m, r) => { const k = String(r.reason || '').replace(/\d+/g, 'N'); m[k] = (m[k] || 0) + 1; return m; }, {}),
      repeatRequestsSameHull: (() => { const m = {}; for (const r of recs) m[r.target.hullId] = (m[r.target.hullId] || 0) + 1; return Object.values(m).filter((n) => n > 2).length; })(),
      orphanTowDays: a.orphanTows,
      heaviestTowRatio: (() => { const W = t.buildCampaignWorld(true); const xs = recs.filter((r) => r.tug).map((r) => ({ tug: W.shipStats(r.tug.shipId), target: W.shipStats(r.target.shipId) })).map((x) => [Number(x.tug?.mass) || 0, Number(x.target?.mass) || 0, Number(x.tug?.recoveryCapacity) || 0]); return xs.length ? { maxTargetToTugMass: Math.max(...xs.map(([a1, b1]) => b1 / Math.max(1, a1))), overCapacity: xs.filter(([, b1, c1]) => b1 > c1).length } : null; })(),
      saveBytes, bookBytes: JSON.stringify(book).length, recoveryStateBytes: JSON.stringify(book.hullRecoveries || []).length + JSON.stringify(book.derelicts || []).length, msPerDay: Math.round(100 * a.ms / a.n) / 100, hullsLost: book.stats.hullsLost, battles: book.stats.battlesResolved,
    };
  });
  const res = { label, days, samples, final: fin, errors: probe.errors.slice(0, 5) };
  fs.writeFileSync(path.join(out, `towing-salvage-measure-${label}.json`), JSON.stringify(res, null, 1));
  console.log(label, 'final', JSON.stringify(fin));
  await probe.close();
  process.exit(probe.errors.length ? 1 : 0);
})();
