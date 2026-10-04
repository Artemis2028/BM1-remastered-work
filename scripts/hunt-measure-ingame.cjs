// In-game long run for HIROGEN-HUNTING-DOCTRINE: the real engine and chart, the campaign's own Hirogen, several
// hundred days. Two runs: the captain at home (Earth, far from Hirogen space) and the captain parked in a
// Sovereign at the Suliban Helix, beside the Hirogen Range (the chain-hunting check: how often is he hunted,
// with what gaps). Contacts with the captain that wait for a scene are taken as escapes (he never answers them;
// the gate covers the scene). Reports the brief's metrics; world captures and formal wars by hunting must be 0.
const fs = require('node:fs');
const path = require('node:path');
const { startProbe } = require('./probe-harness.cjs');
const DAYS = Number(process.env.BM1_HUNT_DAYS || 400);
(async () => {
  const probe = await startProbe({});
  const { ev, fresh, page } = probe;
  const out = process.env.BM1_TEST_OUTPUT || '/tmp';
  fs.mkdirSync(out, { recursive: true });
  await page.waitForFunction(() => !testBM1.doctrineStatus || testBM1.doctrineStatus().state !== 'loading', null, { timeout: 30000 }).catch(() => {});
  const runs = [];
  for (const [mode, huntsOn] of [['captain-home', true], ['captain-home', false], ['captain-beside-range', true], ['captain-beside-range', false]]) {
    await fresh(`hunt-long-${mode}`);
    const r = await ev(({ mode, DAYS, huntsOn }) => {
      const t = testBM1; const b = t.campaign();
      if (!huntsOn) { const db = t.DoctrineCampaign.doctrineBook(b); db.config = { ...db.config, hunts: {} }; }
      if (mode === 'captain-beside-range') { const S = t.getSystemIndexByName('Suliban Helix'); t.state.playership = 38; t.markSystemVisited(S); t.state.currentPlanet = S; t.state.myplanet = S + 1; t.applySystemState(S); }
      const ctlArr = () => t.state.planets.map((p, i) => t.getSystemControl(i).controller);
      const ctl = () => JSON.stringify(ctlArr());
      const w0 = t.buildCampaignWorld(true);
      const pols = Object.keys(b.polities).filter((p) => p !== 'hirogen' && p !== 'player');
      const relOf = (w) => pols.map((p) => [p, w.relation('hirogen', p)]);
      const rel0 = JSON.stringify(relOf(w0)); const relStart = relOf(w0);
      const ctl0 = ctl();
      const growth = []; let homeDays = 0, ctlChanges = 0, prevCtl = ctl0, prevArr = ctlArr(); const hirogenCaptures = [];
      const hirHome = t.getSystemIndexByName('Hirogen Range');
      for (let d = 0; d < DAYS; d++) {
        t.advanceFleetCalendar(1, t.Fleet.nextId(t.fleetBook(), 'journey'));
        // A contact with the captain that waits for a scene: he does not answer it here (he breaks away).
        for (const e of (b.encounters || []).filter((x) => x.type === 'hunt' && x.status === 'pending')) t.leaveStrategicEncounters(e.system);
        const c = ctl(); if (c !== prevCtl) { const arr = ctlArr(); arr.forEach((v, i) => { if (v !== prevArr[i]) { ctlChanges++; if (v === 'hirogen' || prevArr[i] === 'hirogen') hirogenCaptures.push([t.state.day, i, prevArr[i], v]); } }); prevArr = arr; prevCtl = c; }
        if (b.polities.hirogen.hulls.some((h) => h.status !== 'lost' && !h.transit && Number(h.systemIndex) === hirHome)) homeDays++;
        if ((d + 1) % 100 === 0) { const db = t.DoctrineCampaign.doctrineBook(b); growth.push({ day: t.state.day, huntBytes: JSON.stringify(db.hunt || {}).length, huntObjectiveBytes: JSON.stringify(db.objectives.filter((o) => o.kind === 'hunt')).length }); }
      }
      const s = t.DoctrineCampaign.huntSummary(b);
      const closed = s.hunts.filter((o) => o.status !== 'active');
      const cap = s.hunts.filter((o) => o.prey.kind === 'captain').sort((a, c) => a.startDay - c.startDay);
      const gaps = cap.slice(1).map((o, k) => o.startDay - (cap[k].closedDay ?? o.startDay));
      const w1 = t.buildCampaignWorld(true);
      const relEnd = relOf(w1);
      const hirHist = t.diplomacyBook().history.filter((h) => (h.a === 'hirogen' || h.b === 'hirogen') && h.status === 'war').map((h) => [h.day, h.a === 'hirogen' ? h.b : h.a, h.reason]);
      return { mode, huntsOn, days: DAYS, hirogenCaptures, hirogenWarEntries: hirHist, warDeclaredByHirogen: Object.values(b.wars || {}).filter((w) => w.declared && (w.declared.by === 'hirogen')).length, relationChanges: relEnd.filter(([p, v], k) => v !== relStart[k][1]).map(([p, v], k) => [p, relStart.find((x) => x[0] === p)[1], v]),
        active: s.hunts.filter((o) => o.status === 'active').map((o) => ({ id: o.id, prey: o.prey.kind, phase: o.phase, startDay: o.startDay, lastKnown: o.lastKnown, lostSince: o.lostSince, encounterId: o.encounterId, actions: o.actions.slice(-4) })), stats: s.stats, scale: t.DoctrineCampaign.doctrineBook(b).hunt?.scale,
        results: closed.reduce((m, o) => ({ ...m, [o.result.result]: (m[o.result.result] || 0) + 1 }), {}),
        avgDurationDays: closed.length ? Math.round(closed.reduce((n, o) => n + (o.closedDay - o.startDay), 0) / closed.length * 10) / 10 : null,
        maxDurationDays: closed.length ? Math.max(...closed.map((o) => o.closedDay - o.startDay)) : null,
        avgLegs: closed.length ? Math.round(closed.reduce((n, o) => n + (o.legsFlown || 0), 0) / closed.length * 10) / 10 : null,
        hunterHullsLost: b.polities.hirogen.hulls.filter((h) => h.status === 'lost').length, hirogenHulls: b.polities.hirogen.hulls.length,
        captainHunts: cap.length, captainHuntGaps: gaps, prey: s.hunts.map((o) => `${o.prey.polity}:${o.prey.cls}`),
        relationsUnchanged: rel0 === JSON.stringify(pols.map((p) => w1.relation('hirogen', p))), worldControlChanges: ctlChanges,
        homeCoverageShare: Math.round(homeDays / DAYS * 1000) / 1000, growth };
    }, { mode, DAYS, huntsOn });
    runs.push(r);
    console.log(JSON.stringify(r));
  }
  const checks = [
    // The hunt writes no relation and declares no war: every Hirogen war entry is the diplomatic calendar's
    // (a border incident / rival claims), none is declared by the Hirogen, and the hunt-off control shows the
    // calendar does the same kind of thing without any hunt.
    ['formal wars by hunting = 0 (Hirogen war entries all from the diplomatic calendar; none declared by the Hirogen)', runs.every((r) => r.warDeclaredByHirogen === 0 && r.hirogenWarEntries.every(([, , why]) => /border incident|rival claims|tensions|crisis/i.test(why)))],
    ['world captures by hunting = 0 (no world taken by or from the Hirogen)', runs.every((r) => r.hirogenCaptures.length === 0)],
    ['no hunt left open past its budget at the end', runs.every((r) => r.active.every((o) => r.days + 1 - o.startDay <= 54 * (r.scale || 1)))],
    ['no endless pursuit', runs.every((r) => r.maxDurationDays == null || r.maxDurationDays <= 54 * (r.scale || 1))],
    ['the captain is not chain-hunted (gap between hunts on him ≥ the cooldown)', runs.every((r) => r.captainHuntGaps.every((g) => g >= 45 * (r.scale || 1)))],
    ['hunt state bounded (< 64 KB)', runs.every((r) => r.growth.every((g) => g.huntBytes + g.huntObjectiveBytes < 65536))],
    ['the Hirogen keep a hull home most days', runs.every((r) => r.homeCoverageShare >= 0.5)],
  ];
  for (const [n, ok] of checks) console.log(ok ? 'OK  ' : 'FAIL', n);
  fs.writeFileSync(path.join(out, 'hunt-measure-ingame.json'), JSON.stringify({ runs, checks: checks.map(([n, ok]) => ({ n, ok })) }, null, 1));
  if (probe.errors.length) console.log('page errors:', probe.errors.slice(0, 5));
  await probe.close();
  process.exit(checks.every(([, ok]) => ok) && !probe.errors.length ? 0 : 1);
})().catch((e) => { console.error(e); process.exit(1); });
