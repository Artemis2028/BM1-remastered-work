// In-game long run for BORG-ASSIMILATION-TRANSWARP: the real engine and chart, the campaign's own Borg
// Assimilation Cube at Vex, several hundred days, two campaigns. Contacts held for the captain's scene are left
// (he is far away at Earth). Reports the brief's metrics; formal wars by the assimilation doctrine and duplicate
// hull identities must be 0.
const fs = require('node:fs');
const path = require('node:path');
const { startProbe } = require('./probe-harness.cjs');
const DAYS = Number(process.env.BM1_BORG_DAYS || 400);
(async () => {
  const probe = await startProbe({});
  const { ev, fresh, page } = probe;
  const out = process.env.BM1_TEST_OUTPUT || '/tmp';
  fs.mkdirSync(out, { recursive: true });
  await page.waitForFunction(() => !testBM1.doctrineStatus || testBM1.doctrineStatus().state !== 'loading', null, { timeout: 30000 }).catch(() => {});
  const runs = [];
  for (const seed of ['borg-long-1', 'borg-long-2']) {
    await fresh(seed);
    const r = await ev(({ DAYS }) => {
      const t = testBM1; const b = t.campaign();
      const vid = (h) => h?.identity?.vid || h?.vid || h?.id;
      const ctl = () => t.state.planets.map((p, i) => t.getSystemControl(i).controller);
      let prev = ctl(); const flips = []; const growth = [];
      const borgWars0 = Object.keys(b.warStates || {}).filter((k) => k.includes('borg')).length;
      for (let d = 0; d < DAYS; d++) {
        t.advanceFleetCalendar(1, t.Fleet.nextId(t.fleetBook(), 'journey'));
        const c = ctl(); c.forEach((x, i) => { if (x !== prev[i]) flips.push({ day: t.state.day, i, from: prev[i], to: x }); }); prev = c;
        if ((d + 1) % 100 === 0) { const db = t.DoctrineCampaign.doctrineBook(b); growth.push({ day: t.state.day, borgBytes: JSON.stringify(db.borg || {}).length + JSON.stringify(db.objectives.filter((o) => o.kind === 'assimilation')).length }); }
      }
      const s = t.DoctrineCampaign.borgSummary(b);
      const all = [...Object.values(b.polities).flatMap((p) => p.hulls), ...(b.derelicts || [])].map(vid);
      const dupes = all.filter((v, i) => all.indexOf(v) !== i);
      const assimilatedWorlds = s.assimilatedWorlds.map((w) => w.systemIndex);
      return { days: DAYS, stats: s.stats, results: s.history.reduce((m, h) => ({ ...m, [h.result]: (m[h.result] || 0) + 1 }), {}),
        transwarp: { uses: s.transwarp.uses, cooldownBlocks: s.transwarp.cooldownBlocks, pairs: (s.transwarp.log || []).map((x) => [x.conventionalDays, x.transwarpDays]) },
        borgHulls: b.polities.borg.hulls.filter((h) => h.status !== 'lost').map((h) => ({ vid: vid(h), shipId: h.shipId, assimilated: Boolean(h.assimilated), status: h.status, at: h.systemIndex })),
        flipsToBorg: flips.filter((f) => f.to === 'borg'), flipsUnexplained: flips.filter((f) => f.to === 'borg' && !assimilatedWorlds.includes(f.i)), assimilatedWorlds: s.assimilatedWorlds,
        borgWars: Object.keys(b.warStates || {}).filter((k) => k.includes('borg')).length - borgWars0, borgPairs: Object.keys(t.diplomacyBook().pairs || {}).filter((k) => k.includes('borg')).length,
        borgLicences: Object.keys(b.polities.borg.licenses || {}).length, duplicateIdentities: dupes.length, growth };
    }, { DAYS });
    runs.push({ seed, ...r });
    console.log(JSON.stringify({ seed, ...r }).slice(0, 2500));
  }
  const checks = [
    ['formal wars created by assimilation doctrine = 0', runs.every((r) => r.borgWars === 0 && r.borgPairs === 0)],
    ['duplicate hull identities = 0', runs.every((r) => r.duplicateIdentities === 0)],
    ['every world that became Borg was a recorded assimilation', runs.every((r) => r.flipsUnexplained.length === 0)],
    ['no production rights (Borg licences = 0)', runs.every((r) => r.borgLicences === 0)],
    ['no steamroll (≤ 1 world assimilated per 100 days)', runs.every((r) => r.assimilatedWorlds.length <= Math.ceil(r.days / 100))],
    ['transwarp bounded by its cooldown', runs.every((r) => r.transwarp.uses <= Math.ceil(r.days / 60) + 1)],
    ['Borg state bounded (< 96 KB)', runs.every((r) => r.growth.every((g) => g.borgBytes < 96 * 1024))],
  ];
  for (const [n, ok] of checks) console.log(ok ? 'OK  ' : 'FAIL', n);
  fs.writeFileSync(path.join(out, 'borg-measure-ingame.json'), JSON.stringify({ runs, checks: checks.map(([n, ok]) => ({ n, ok })) }, null, 1));
  if (probe.errors.length) console.log('page errors:', probe.errors.slice(0, 5));
  await probe.close();
  process.exit(checks.every(([, ok]) => ok) && !probe.errors.length ? 0 : 1);
})().catch((e) => { console.error(e); process.exit(1); });
