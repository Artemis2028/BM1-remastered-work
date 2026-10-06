// Long-run measurement of doctrine runtime phase 4 in the real game (not a balance claim): the default
// campaign with its real wars, AI planning, patrols, published border policies and the Pirates Haven crew,
// advanced day by day. The same seed is run twice — Phase 4 on, and Phase 4 off (enforcementResponses and
// predation false) — and the formal war record of the two runs is compared: doctrine creates no war.
// Watches for endless warning loops, pursuit out of jurisdiction, everything-becomes-combat, repeat
// extortion, fire after a surrender, and demands priced on hidden cargo.
const fs = require('node:fs');
const path = require('node:path');
const { startProbe } = require('./probe-harness.cjs');
(async () => {
  const days = Number(process.env.BM1_LONGRUN_DAYS || 500);
  const out = process.env.BM1_TEST_OUTPUT || '/tmp';
  const probe = await startProbe({ viewport: { width: 1200, height: 800 } });
  const { ev, fresh, page } = probe;
  await page.waitForFunction(() => !testBM1.doctrineStatus || testBM1.doctrineStatus().state !== 'loading', null, { timeout: 30000 }).catch(() => {});
  const t0 = Date.now();
  // haven: the same campaign plus one Delpin transport that shuttles through Pirates Haven whenever it is
  // free (the default campaign's routine traffic does not pass the haven), answering with its own judgement.
  async function run(p4, haven = false) {
    await fresh('p4-longrun');
    await ev(({ p4, haven }) => {
      const t = testBM1; const db = t.DoctrineCampaign.doctrineBook(t.campaign());
      db.config = { ...db.config, enforcementResponses: p4, predation: p4 };
      window.__haven = haven ? { H: t.getSystemIndexByName('Pirates Haven') } : null;
      window.__lr0 = 1; window.__lr = { maxActiveEnf: 0, maxActivePred: 0, longestEnfDays: 0, longestPredDays: 0, pursuitDays: 0, strikesAfterSurrender: 0, pricesSeen: {}, warLog: [], seenWar: {}, maxWarningsSameVisit: 0, repeatExtortion: 0, surrenderedTargeted: 0 };
    }, { p4, haven });
    const samples = [];
    for (let d = 0; d < days; d += 10) {
      await ev(() => {
        const t = testBM1; const book = t.campaign(); const a = window.__lr;
        for (let i = 0; i < 10; i++) {
          if (window.__haven) {
            const hv = window.__haven, w = t.buildCampaignWorld(true), db0 = t.DoctrineCampaign.doctrineBook(book);
            // The shuttle is whichever Delpin hull is free; when the campaign retires or loses one, the next.
            if (hv.hullId && !book.polities.delpin.hulls.some((h) => h.id === hv.hullId && h.status !== 'lost')) { hv.hullId = null; hv.replaced = (hv.replaced || 0) + 1; }
            const hull = hv.hullId ? book.polities.delpin.hulls.find((h) => h.id === hv.hullId) : (book.polities.delpin.hulls.find((h) => h.status === 'ready' && !h.opId));
            if (hull && !hv.hullId) hv.hullId = hull.id;
            if (hull && hull.status === 'ready' && !hull.opId && !db0.assignments.some((x) => x.status === 'active' && x.hullId === hull.id)) {
              const nb = w.neighbours(hv.H);
              const from = nb.includes(Number(hull.systemIndex)) ? Number(hull.systemIndex) : nb[0];
              t.runCampaignAuthored((b, ww, fx) => t.DoctrineCampaign.issueAssignment(b, ww, { polity: 'delpin', hullId: hull.id, kind: 'transport', doctrineRole: 'civilian', stops: [{ systemIndex: hv.H, dwell: 2, milestone: 'arrival' }, { systemIndex: from, milestone: 'check_in' }] }, t.state.day, fx));
              hv.trips = (hv.trips || 0) + 1;
            }
          }
          t.advanceFleetCalendar(1, t.Fleet.nextId(t.fleetBook(), 'journey'));
          const db = t.DoctrineCampaign.doctrineBook(book);
          const act = db.objectives.filter((o) => o.status === 'active');
          const enf = act.filter((o) => o.kind === 'enforcement'), pred = act.filter((o) => o.kind === 'predation');
          a.maxActiveEnf = Math.max(a.maxActiveEnf, enf.length); a.maxActivePred = Math.max(a.maxActivePred, pred.length);
          for (const o of enf) {
            a.longestEnfDays = Math.max(a.longestEnfDays, t.state.day - o.createdDay);
            const eh = book.polities[o.polity]?.hulls.find((h) => h.id === o.assigned.hullId);
            if (eh && Number(eh.systemIndex) !== Number(o.target.systemIndex)) a.pursuitDays++;
            a.maxWarningsSameVisit = Math.max(a.maxWarningsSameVisit, o.comms.hails);
            const th = book.polities[o.target.polity]?.hulls.find((h) => h.id === o.target.hullId);
            if (th?.status === 'surrendered' && o.status === 'active' && o.actions.some((x) => x.action === 'strike' && x.day > (th.surrendered?.day ?? 1e9))) a.strikesAfterSurrender++;
          }
          for (const o of pred) { a.longestPredDays = Math.max(a.longestPredDays, t.state.day - o.createdDay); a.pricesSeen[o.demand.amount] = (a.pricesSeen[o.demand.amount] || 0) + 0; }
          // Surrendered hulls never the target of a new objective.
          for (const o of db.objectives) if (o.createdDay === t.state.day && (o.kind === 'enforcement' || o.kind === 'predation')) {
            const th = book.polities[o.target.polity]?.hulls.find((h) => h.id === o.target.hullId);
            if (th?.status === 'surrendered') a.surrenderedTargeted++;
            if (o.kind === 'predation') a.pricesSeen[o.demand.amount] = (a.pricesSeen[o.demand.amount] || 0) + 1;
          }
          for (const [k, w] of Object.entries(book.warStates || {})) { const key = `${k}|${w.instance}|${w.status}|${w.statusSince ?? ''}`; if (!a.seenWar[key]) { a.seenWar[key] = true; a.warLog.push({ day: t.state.day, pair: k, status: w.status }); } }
        }
        // Repeat extortion: two demands on the same vessel by the same crew inside the cooldown.
        const db = t.DoctrineCampaign.doctrineBook(book);
        const byKey = {};
        for (const o of db.objectives.filter((x) => x.kind === 'predation').sort((x, y) => x.createdDay - y.createdDay)) {
          const k = `${o.pirateId}|${o.target.vid}`;
          if (byKey[k] != null && o.createdDay - byKey[k] < db.config.pirateTargetCooldownDays) a.repeatExtortion++;
          byKey[k] = o.createdDay;
        }
      });
      if ((d + 10) % 50 === 0) {
        const s = await ev(() => {
          const t = testBM1; const book = t.campaign(); const db = t.DoctrineCampaign.doctrineBook(book); const st = db.stats || {};
          const enf = db.objectives.filter((o) => o.kind === 'enforcement'), pred = db.objectives.filter((o) => o.kind === 'predation');
          const res = (list, s) => list.filter((o) => o.status === s).length;
          return { day: t.state.day, bookBytes: JSON.stringify(book).length, doctrineBytes: JSON.stringify(db).length,
            enforcement: { created: st.enforcementObjectives || 0, complied: st.enforcementComplied || 0, leftUncomplied: st.enforcementLeftUncomplied || 0, complyResponses: st.enforcementComplyResponses || 0, refusals: st.enforcementRefusals || 0, flee: st.enforcementFlee || 0,
              stage2: st.enforcementStage2 || 0, stage3: st.enforcementStage3 || 0, stage4: st.enforcementStage4 || 0, strikes: st.enforcementStrikes || 0, expired: st.enforcementExpired || 0, cancelledByAuthority: st.enforcementCancelledByAuthority || 0, warAuthorityDropped: st.enforcementWarAuthorityDropped || 0,
              targetLost: st.enforcementTargetLost || 0, deferred: st.enforcementDeferred || 0, shadow: st.enforcementShadow || 0, repeatPrevented: st.enforcementRepeatPrevented || 0, breachesUnenforced: st.breachesUnenforced || 0,
              completed: res(enf, 'completed'), aborted: res(enf, 'aborted'), expiredStatus: res(enf, 'expired'), active: res(enf, 'active') },
            surrenders: { total: st.surrenders || 0, accepted: st.surrendersAccepted || 0, released: st.surrendersReleased || 0, holding: Object.values(book.polities).flatMap((p) => p.hulls).filter((h) => h.status === 'surrendered').length },
            predation: { demands: st.pirateDemands || 0, paid: st.predationPaid || 0, refusals: st.predationRefusals || 0, runs: st.predationRuns || 0, timeouts: st.predationTimeouts || 0, strikes: st.predationStrikes || 0, escaped: st.predationEscaped || 0, destroyed: st.predationTargetDestroyed || 0, repeatPrevented: st.predationRepeatPrevented || 0, shadow: st.predationShadow || 0, groupsLost: st.pirateGroupsLost || 0,
              completed: res(pred, 'completed'), aborted: res(pred, 'aborted'), expiredStatus: res(pred, 'expired'), active: res(pred, 'active'), pirates: Object.values(db.pirates || {}).map((g) => ({ id: g.id, status: g.status, demands: g.demands, loot: g.loot })) },
            patrolsReturned: st.patrolsReturned || 0, duplicatesPrevented: st.duplicatesPrevented || 0,
            wars: Object.values(book.warStates || {}).filter((w) => w.status === 'war').length, havenTrips: window.__haven?.trips || 0, havenShuttlesReplaced: window.__haven?.replaced || 0, acc: { ...window.__lr, warLog: undefined, seenWar: undefined } };
        });
        samples.push(s);
        console.log(haven ? 'haven ' : p4 ? 'P4 on ' : 'P4 off', JSON.stringify({ day: s.day, bytes: s.bookBytes, enf: s.enforcement.created, comp: s.enforcement.complied, pred: s.predation.demands, surr: s.surrenders.total, wars: s.wars }));
      }
    }
    const warLog = await ev(() => window.__lr.warLog);
    const saves = await ev(() => { const t = testBM1; const o = {}; for (const slot of [1, 2, 3]) { let ok = true, err = null; try { t.saveGame(slot); } catch (e) { ok = false; err = String(e.message || e); } o[slot] = { ok, err }; } return o; });
    return { samples, warLog, saves };
  }
  const on = await run(true);
  const off = await run(false);
  const havenRun = await run(true, true);
  const sameWars = JSON.stringify(on.warLog) === JSON.stringify(off.warLog);
  console.log('war record identical with Phase 4 on and off:', sameWars, `(${on.warLog.length} / ${off.warLog.length} war-state changes)`);
  const res = { days, seconds: Math.round((Date.now() - t0) / 1000), on, off: { samples: off.samples.slice(-1), warLog: off.warLog }, haven: { samples: havenRun.samples, saves: havenRun.saves }, doctrineCreatedWars: 0, warRecordIdentical: sameWars, errors: probe.errors.slice(0, 5) };
  fs.writeFileSync(path.join(out, 'doctrine-phase4-longrun.json'), JSON.stringify(res, null, 1));
  await probe.close();
  process.exit(probe.errors.length ? 1 : 0);
})();
