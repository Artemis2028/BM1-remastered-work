// Long-run measurement of doctrine runtime phase 3 in the real game (not a balance claim): the default
// campaign with the real wars, AI planning, area patrols and command defence, advanced day by day. Samples
// every 50 days: military objectives created/closed/active, deferrals, repeats prevented, patrols,
// stranded hulls and hull-days, rescues, and the size of the saved campaign. Watches for permanent
// pursuit, exploding counts and garrison stripping.
const fs = require('node:fs');
const path = require('node:path');
const { startProbe } = require('./probe-harness.cjs');
(async () => {
  const days = Number(process.env.BM1_LONGRUN_DAYS || 600);
  const out = process.env.BM1_TEST_OUTPUT || '/tmp';
  const probe = await startProbe({ viewport: { width: 1200, height: 800 } });
  const { ev, fresh, page } = probe;
  await page.waitForFunction(() => !testBM1.doctrineStatus || testBM1.doctrineStatus().state !== 'loading', null, { timeout: 30000 }).catch(() => {});
  await fresh('p3-longrun');
  const samples = [];
  const t0 = Date.now();
  let acc = { strandedHullDays: 0, maxActiveMilitary: 0, maxPerPolity: 0, longestMilitaryDays: 0, maxActivePatrols: 0 };
  for (let d = 0; d < days; d += 10) {
    const r = await ev((acc) => {
      const t = testBM1;
      const book = t.campaign();
      for (let i = 0; i < 10; i++) {
        t.advanceFleetCalendar(1, t.Fleet.nextId(t.fleetBook(), 'journey'));
        const db = book.doctrine || t.DoctrineCampaign.doctrineBook(book);
        const act = (db.objectives || []).filter((o) => o.status === 'active' && o.military);
        acc.maxActiveMilitary = Math.max(acc.maxActiveMilitary, act.length);
        const per = {}; for (const o of act) { per[o.polity] = (per[o.polity] || 0) + 1; acc.longestMilitaryDays = Math.max(acc.longestMilitaryDays, t.state.day - o.createdDay); }
        acc.maxPerPolity = Math.max(acc.maxPerPolity, ...Object.values(per), 0);
        acc.maxActivePatrols = Math.max(acc.maxActivePatrols, Object.values(db.patrols || {}).filter((p) => ['patrolling', 'responding'].includes(p.status)).length);
        for (const p of Object.values(book.polities)) for (const h of p.hulls) if (h.stranded && h.status !== 'lost') acc.strandedHullDays++;
      }
      return acc;
    }, acc);
    acc = r;
    if ((d + 10) % 50 === 0) {
      const s = await ev(() => {
        const t = testBM1; const book = t.campaign(); const db = t.DoctrineCampaign.doctrineBook(book); const st = db.stats || {};
        const stranded = Object.values(book.polities).flatMap((p) => p.hulls).filter((h) => h.stranded && h.status !== 'lost');
        return { day: t.state.day, bookBytes: JSON.stringify(book).length, doctrineBytes: JSON.stringify(db).length,
          military: { created: st.militaryObjectives || 0, closed: st.militaryClosed || 0, expired: st.militaryExpired || 0, cancelledByAuthority: st.militaryCancelledByAuthority || 0, active: db.objectives.filter((o) => o.status === 'active' && o.military).length },
          deferred: st.deferred || 0, repeatPrevented: st.repeatPrevented || 0, patrolsFormed: st.patrolsFormed || 0, patrolsReturned: st.patrolsReturned || 0,
          attacks: Object.values(db.incidents).filter((i) => i.eventType === 'asset_attack').length, incidents: Object.keys(db.incidents).length, objectives: db.objectives.length, assignments: db.assignments.length,
          stranded: stranded.length, strandedCrewAboard: stranded.filter((h) => h.stranded.crew === 'aboard').length, rescued: st.rescuesCompleted || 0,
          operations: (book.operations || []).filter((o) => o.status !== 'resolved').length, wars: Object.values(book.warStates || {}).filter((w) => w.status === 'war').length };
      });
      samples.push({ ...s, ...acc });
      console.log(JSON.stringify({ day: s.day, bytes: s.bookBytes, mil: s.military, stranded: s.stranded, acc }));
    }
  }
  // The saved game at the end, in all three slots: it must still fit the browser's storage.
  const saves = await ev(() => { const t = testBM1; const out = {}; for (const slot of [1, 2, 3]) { let ok = true, err = null; try { t.saveGame(slot); } catch (e) { ok = false; err = String(e.message || e); } const raw = t.getSaveSlotRaw ? t.getSaveSlotRaw(slot) : null; out[slot] = { ok, err, bytes: raw ? raw.length : null }; } return out; });
  console.log('saves', JSON.stringify(saves));
  const res = { days, seconds: Math.round((Date.now() - t0) / 1000), samples, saves, errors: probe.errors.slice(0, 5) };
  fs.writeFileSync(path.join(out, 'doctrine-phase3-longrun.json'), JSON.stringify(res, null, 1));
  await probe.close();
  process.exit(probe.errors.length ? 1 : 0);
})();
