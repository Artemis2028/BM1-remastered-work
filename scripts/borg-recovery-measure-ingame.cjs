// In-game long run for BORG-HULK-REGENERATION: the real engine and chart, every campaign routine on, the campaign's
// own Borg Assimilation Cube at Vex, several hundred days. Three ordinary campaigns (hulks made only by the
// Collective's own assimilations) and one pressure campaign in which, every 50 days, one more disabled hull somewhere
// on the chart is taken by the Collective's assimilation transfer (setup), to keep the recovery loop loaded. The
// captain is far away at Earth; contacts held for his scene stay held. Reports the brief's metrics and its watch list.
// BM1_TEST_ROOT (probe harness) runs it against another tree (e949936: hulks are never recovered).
const fs = require('node:fs');
const path = require('node:path');
const { startProbe } = require('./probe-harness.cjs');
const DAYS = Number(process.env.BM1_BORG_DAYS || 500);
(async () => {
  const probe = await startProbe({});
  const { ev, fresh, page } = probe;
  const out = process.env.BM1_TEST_OUTPUT || '/tmp';
  fs.mkdirSync(out, { recursive: true });
  await page.waitForFunction(() => !testBM1.doctrineStatus || testBM1.doctrineStatus().state !== 'loading', null, { timeout: 30000 }).catch(() => {});
  const runs = [];
  for (const [seed, pressure] of [['borg-rec-long-1', false], ['borg-rec-long-2', false], ['borg-rec-long-3', false], ['borg-rec-pressure', true]]) {
    await fresh(seed);
    const r = await ev(({ DAYS, pressure }) => {
      const t = testBM1; const b = t.campaign();
      const vid = (h) => h?.identity?.vid || h?.vid || h?.id;
      const V = 33;
      const W0 = t.buildCampaignWorld(true);
      const borgLive = () => b.polities.borg.hulls.filter((h) => h.status !== 'lost');
      const operational = () => borgLive().filter((h) => !t.Campaign.hullIsDisabled(h) && !h.borgRegen);
      const n0 = { live: borgLive().length, operational: operational().length };
      const cube = () => b.polities.borg.hulls.find((h) => Number(h.shipId) === 346) || null;
      const hulks = {};   // hull id → { vid, shipId, from, taken, at, attach, delivered, regenStart, operational, abandoned, fate }
      const recs = {};    // recovery id → record (the summary keeps the newest closed ones only)
      const watch = { freshNodeRegens: [], transwarpTows: [], cubeDays: { tow: 0, assimilation: 0, return: 0, idle: 0, other: 0, lost: 0 }, growth: [], seeded: [] };
      const nodeRow = (i) => (t.DoctrineCampaign.borgDebug ? t.DoctrineCampaign.borgDebug(b, t.buildCampaignWorld(true)).hulkRecovery.nodes.find((n) => n.systemIndex === Number(i)) : null);
      const systems = W0.systems.map((s) => Number(s.index)).filter((i) => i !== V);
      let rng = 7;
      const rand = () => { rng = (rng * 1103515245 + 12345) % 2147483648; return rng / 2147483648; };
      for (let d = 0; d < DAYS; d++) {
        // Pressure: one more disabled hull taken by the Collective's own transfer, every 50 days.
        if (pressure && d % 50 === 10) {
          const pool = Object.entries(b.polities).filter(([pid]) => !['borg', 'player'].includes(pid)).flatMap(([pid, p]) => p.hulls.filter((h) => h.status === 'ready' && !h.opId && !h.transit && !h.encounterId).map((h) => [pid, h]));
          if (pool.length) {
            const [pid, h] = pool[Math.floor(rand() * pool.length)];
            const at = systems[Math.floor(rand() * systems.length)];
            h.systemIndex = at; h.hull = Math.max(1, Math.floor(t.Fleet.disableThreshold(h.maxHull)));
            const crew = rand() < 0.8 ? 1 : 0;
            const x = t.Campaign.assimilateHull(b, h, pid, 'borg', t.state.day, at, { result: crew ? 'crew_assimilated' : 'target_abandoned', before: 1, survivors: 0, assimilated: crew, after: crew });
            if (x) watch.seeded.push({ day: t.state.day, vid: vid(h), shipId: h.shipId, at, crew });
          }
        }
        t.advanceFleetCalendar(1, t.Fleet.nextId(t.fleetBook(), 'journey'));
        const day = t.state.day;
        // Every assimilated Borg hull, followed by its record.
        for (const h of [...b.polities.borg.hulls, ...(b.derelicts || [])]) {
          if (!h.assimilated) continue;
          const k = String(h.id);
          const x = hulks[k] ||= { vid: vid(h), shipId: h.shipId, from: h.assimilated.from, taken: h.assimilated.day ?? day, at: h.systemIndex, disabledAtTaking: t.Campaign.hullIsDisabled(h) || Boolean(h.regenerated) };
          if (h.towedBy && x.attach == null) x.attach = day;
          if (h.borgRegen && x.delivered == null) { x.delivered = day; x.node = h.borgRegen.node; x.inPlace = x.attach == null; }
          if (h.borgRegen?.state === 'regenerating' && x.regenStart == null) {
            x.regenStart = day;
            if (Number(h.borgRegen.node) !== V) { const n = nodeRow(h.borgRegen.node); if (!n || !n.ok) watch.freshNodeRegens.push({ day, vid: x.vid, node: h.borgRegen.node, row: n }); }
          }
          if (h.regenerated && x.operational == null) { x.operational = h.regenerated.day; x.regenDays = h.regenerated.days; }
          if (h.derelict && x.abandoned == null && h.derelict.abandonedBy === 'borg') x.abandoned = day;
          x.status = h.status; x.fate = h.fate || null; x.atNow = h.systemIndex;
        }
        const s = t.DoctrineCampaign.borgSummary(b);
        for (const rr of s.recoveries || []) recs[rr.id] = { id: rr.id, hullId: rr.hullId, vid: rr.vid, createdDay: rr.createdDay, result: rr.result, phase: rr.phase, missions: (rr.missions || []).length, movement: rr.movement?.mode ?? null };
        // Tows never by conduit.
        for (const m of b.hullRecoveries || []) if (m.sponsor === 'borg' && m.inbound?.journeyId) { const tr = t.Campaign.journeyById(b, m.inbound.journeyId); if (tr && tr.mode === 'transwarp') watch.transwarpTows.push({ day, mission: m.id }); }
        // How the cube spends its days.
        const c = cube();
        if (!c || c.status === 'lost') watch.cubeDays.lost++;
        else if (String(c.opId || '').includes(':tow:')) watch.cubeDays.tow++;
        else if (String(c.opId || '').includes('assimilation')) watch.cubeDays.assimilation++;
        else if (c.transit) watch.cubeDays.return++;
        else if (!c.opId) watch.cubeDays.idle++;
        else watch.cubeDays.other++;
        if ((d + 1) % 100 === 0) watch.growth.push({ day, live: borgLive().length, operational: operational().length, returned: borgLive().filter((h) => h.regenerated).length, borgBytes: JSON.stringify(t.DoctrineCampaign.doctrineBook(b).borg || {}).length });
      }
      const s = t.DoctrineCampaign.borgSummary(b);
      const all = [...Object.values(b.polities).flatMap((p) => p.hulls), ...(b.derelicts || [])].map(vid);
      const dupes = all.filter((v, i) => all.indexOf(v) !== i);
      const H = Object.values(hulks);
      const avg = (xs) => (xs.length ? Math.round((xs.reduce((a, x) => a + x, 0) / xs.length) * 10) / 10 : null);
      const R = Object.values(recs);
      const res = (k) => R.filter((x) => x.result?.result === k).length;
      return { days: DAYS, pressure, n0, stats: s.stats ? Object.fromEntries(Object.entries(s.stats).filter(([k]) => /Recover|Regen|Hulks|Returned|Assimilated|Transwarp|borgShips|InPlace/.test(k))) : null,
        metrics: {
          hulksCreated: H.length, recoveriesOpened: R.length, completed: res('hulk_operational'), awaitingDrones: res('awaiting_drones'), abandoned: res('abandoned'), noReachableNode: res('no_reachable_node'),
          vesselLosses: res('recovery_vessel_destroyed'), hulkDestroyed: res('hulk_destroyed'), cancelled: res('cancelled'), open: R.filter((x) => !x.result).length,
          inPlace: H.filter((x) => x.inPlace).length,
          avgStrandedDays: avg(H.filter((x) => x.delivered != null).map((x) => (x.attach ?? x.delivered) - x.taken)),
          avgTowDays: avg(H.filter((x) => x.attach != null && x.delivered != null).map((x) => x.delivered - x.attach)),
          avgRegenDays: avg(H.filter((x) => x.regenDays != null).map((x) => x.regenDays)),
          returnedToService: H.filter((x) => x.operational != null).length,
          strandedAtEnd: H.filter((x) => x.status !== 'lost' && x.operational == null && x.delivered == null).length,
          duplicateVids: dupes.length, licences: Object.keys(b.polities.borg.licenses || {}).length },
        watch, hulks: H, recoveries: R };
    }, { DAYS, pressure });
    runs.push({ seed, ...r });
    console.log(JSON.stringify({ seed, metrics: r.metrics, cubeDays: r.watch.cubeDays, growth: r.watch.growth, seeded: r.watch.seeded.length, fresh: r.watch.freshNodeRegens.length, transwarpTows: r.watch.transwarpTows.length }));
  }
  const live = runs.filter((r) => r.stats);
  const checks = [
    ['duplicate vids = 0', runs.every((r) => r.metrics.duplicateVids === 0)],
    ['Borg licences = 0', runs.every((r) => r.metrics.licences === 0)],
    ['no tow by conduit (transwarp never bypasses the tow restriction)', runs.every((r) => r.watch.transwarpTows.length === 0)],
    ['no fresh world regenerates before it is a node', runs.every((r) => r.watch.freshNodeRegens.length === 0)],
    ['no immortal objective (every recovery open ≤ its pending budget + the longest tow)', live.every((r) => r.recoveries.filter((x) => !x.result).every((x) => r.days - x.createdDay <= 240 + 160))],
    ['not too easy: regeneration takes ≥ 20 days on average', live.every((r) => r.metrics.avgRegenDays == null || r.metrics.avgRegenDays >= 20)],
    ['the cube is not a full-time tug (< 50% of its days towing)', live.every((r) => r.watch.cubeDays.tow < r.days * 0.5)],
    ['no exponential growth (Borg live hulls ≤ start + hulks taken; ≤ 4 more per 100 days)', live.every((r) => r.watch.growth.every((g, i) => g.live <= r.n0.live + r.metrics.hulksCreated && (i === 0 ? g.live - r.n0.live : g.live - r.watch.growth[i - 1].live) <= 4))],
    ['Borg state bounded (< 128 KB)', runs.every((r) => r.watch.growth.every((g) => g.borgBytes < 128 * 1024))],
    ['the loop works: the pressure campaign returns hulls to service', live.filter((r) => r.pressure).every((r) => r.metrics.returnedToService >= 2)],
  ];
  for (const [n, ok] of checks) console.log(ok ? 'OK  ' : 'FAIL', n);
  fs.writeFileSync(path.join(out, process.env.BM1_TEST_ROOT ? 'borg-recovery-measure-ingame-baseline.json' : 'borg-recovery-measure-ingame.json'), JSON.stringify({ days: DAYS, runs, checks: checks.map(([n, ok]) => ({ n, ok })) }, null, 1));
  if (probe.errors.length) console.log('page errors:', probe.errors.slice(0, 5));
  await probe.close();
  process.exit(checks.every(([, ok]) => ok) && !probe.errors.length ? 0 : 1);
})().catch((e) => { console.error(e); process.exit(1); });
