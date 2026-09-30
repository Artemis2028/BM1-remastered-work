// Bounded campaign sample for STRATEGIC-TACTICAL-HANDOFF (a measurement, not a balance claim). The default
// campaign with its real wars, blockades, AI operations, doctrine raids and pirates, on one seed, with the
// captain actually flying: every course is a real plotted multi-leg course, and wherever he is (arriving,
// stopped at an intermediate system, or waiting a few days at a world) whatever the strategic layer brings
// to that system is handed to the scene and fought there. The captain's hull is kept up between seconds
// (his survival is not what is measured); a pirate demand is answered pay / run / refuse in turn.
// Run it against the candidate and against c07826b (BM1_TEST_ROOT=<tree>/dist): the baseline has no
// encounter record, so what can be counted there is the abstract resolution of contacts where he was.
const fs = require('node:fs');
const path = require('node:path');
const { startProbe } = require('./probe-harness.cjs');
(async () => {
  const days = Number(process.env.BM1_HANDOFF_DAYS || 2000);
  const label = process.env.BM1_HANDOFF_LABEL || 'candidate';
  const out = process.env.BM1_TEST_OUTPUT || '/tmp';
  fs.mkdirSync(out, { recursive: true });
  const probe = await startProbe({ viewport: { width: 1200, height: 800 } });
  const { ev, fresh, page } = probe;
  await page.waitForFunction(() => !testBM1.doctrineStatus || testBM1.doctrineStatus().state !== 'loading', null, { timeout: 30000 }).catch(() => {});
  const t0 = Date.now();
  await fresh(process.env.BM1_HANDOFF_SEED || 'handoff-measure');
  await ev(() => {
    const t = testBM1;
    for (let i = 0; i < t.state.planets.length; i++) t.markSystemVisited(i);
    let seed = 0x5eed;
    window.__rng = () => { seed = (seed * 1103515245 + 12345) & 0x7fffffff; return seed / 0x7fffffff; };
    window.__seconds = (s) => { const n = Math.ceil((s * 1000) / (2.5 * 16.6667)); for (let i = 0; i < n; i++) { t.playtestClock.offset -= 2.5 * 16.6667; t.tick(2.5); } };
    window.__keepUp = () => { t.state.hull = 100; t.state.shields = 100; t.fleetBook().personalCondition = 'operational'; t.state.antimatter = Math.max(t.state.antimatter, 999); t.state.latinum = Math.max(t.state.latinum, 5000); };
    window.__acc = { flights: 0, stops: {}, answers: { pay: 0, run: 0, refuse: 0 }, resumes: 0, retreats: 0, waits: 0, sceneSeconds: 0, dupVidMax: 0, resurrected: 0, captainCrossings: 0, abstractAtCaptain: { blockadeRuns: 0, opsResolvedOffscreen: 0, opBattleDays: 0, raidStrikes: 0 }, lostVids: {}, errors: [], sceneTimeouts: 0, throughPirateWaters: 0, picks: { war: 0, blockade: 0, pirate: 0, pirateApproach: 0, random: 0 }, blockadesSeen: {} };
    const acc = window.__acc;
    const unpause = () => { t.closeGalaxyReports?.(); const c = t.playtestClock; if (c.stoppedAt !== null) { c.offset += performance.now() - c.stoppedAt; c.stoppedAt = null; } };
    const flyWarp = () => { if (!t.state.warp.active) return; t.openWarpBriefing?.(); unpause(); t.completeWarpTravel(); unpause(); };
    // Invariants watched every scene second: one living scene ship per vid; no vid of a lost hull back.
    const watch = () => {
      const book = t.campaign();
      const seen = {};
      for (const n of t.state.npcShips) if (n.vid && !n.destroyed) seen[n.vid] = (seen[n.vid] || 0) + 1;
      acc.dupVidMax = Math.max(acc.dupVidMax, ...Object.values(seen), 0);
      for (const p of Object.values(book.polities)) for (const h of p.hulls) if (h.status === 'lost') acc.lostVids[h.identity?.vid || h.id] = true;
      for (const v of Object.keys(seen)) if (acc.lostVids[v]) acc.resurrected++;
    };
    // The scene runs until nothing is live here: a pirate demand is answered, a forced retreat is flown.
    window.__scene = (max = 600) => {
      const book = t.campaign();
      let s = 0;
      for (; s < max; s++) {
        unpause(); window.__keepUp();
        const lp = t.state.localDoctrine?.predation;
        if (lp && ['sent', 'received'].includes(lp.state)) {
          const a = ['pay', 'run', 'refuse'][(acc.answers.pay + acc.answers.run + acc.answers.refuse) % 3];
          acc.answers[a]++;
          t.respondToPredation(a);
          if (a === 'run') { const p = t.playerWorldPosition(); t.setCamera?.(p.x + t.NPC_WEAPON_RANGE * 8, p.y); t.state.ship.velocity = 0; }
        }
        const live = t.Encounter ? t.Encounter.liveEncounters(book, t.state.currentPlanet) : [];
        if (!live.length && !t.state.pendingForcedRetreat && !(lp && !lp.closed)) break;
        window.__seconds(1); acc.sceneSeconds++;
        watch();
        if (t.state.warp.active) { acc.retreats++; flyWarp(); }
      }
      if (s >= max) acc.sceneTimeouts++;
      if (t.state.warp.active) { acc.retreats++; flyWarp(); }
      return t.Encounter ? t.Encounter.liveEncounters(book, t.state.currentPlanet).length : 0;
    };
    window.__flyTo = (to) => {
      const plan = t.getPlottedRoute(t.state.currentPlanet, to);
      if (!plan) return false;
      window.__keepUp();
      if (!t.beginWarpTravel(to, plan) && !t.state.warp.active) return false;
      acc.flights++;
      flyWarp();
      acc.captainCrossings += (t.state.warp.crossings || []).length;
      { const A = t.getSystemIndexByName('Astron'); const p = plan.systems.map(Number); if (p.slice(1, -1).includes(A)) acc.throughPirateWaters++; }
      const stop = t.state.warp.stop;
      if (stop) acc.stops[stop.type] = (acc.stops[stop.type] || 0) + 1;
      window.__scene();
      for (let k = 0; k < 4 && t.state.warpResume?.ready; k++) {
        if (!t.resumeCaptainCourse()) break;
        acc.resumes++;
        flyWarp();
        acc.captainCrossings += (t.state.warp.crossings || []).length;
        const s2 = t.state.warp.stop; if (s2) acc.stops[s2.type] = (acc.stops[s2.type] || 0) + 1;
        window.__scene();
      }
      return true;
    };
    // Where the captain waits, the war comes to him: a few days on the calendar, the scene after each.
    // (No calendar day passes while a scene is still being fought: in the game days only pass in warp.)
    // Baseline-comparable: a battle day or raid strike settled offscreen at the very world he is at.
    const offscreenHere = () => {
      const book = t.campaign(), here = Number(t.state.currentPlanet), day = t.state.day;
      // (not the day it arrived: no battle is fought on the engagement day itself)
      for (const o of book.operations || []) if (Number(o.targetSystem) === here && o.status === 'engaged' && Number(o.engagedDay) !== day && !o.resolvedBy && !(t.Encounter && t.Encounter.liveEncounterFor(book, 'operation', o.id))) acc.abstractAtCaptain.opBattleDays++;
      for (const o of book.operations || []) if (Number(o.targetSystem) === here && o.resolvedDay === day && o.resolvedBy === 'offscreen') acc.abstractAtCaptain.opsResolvedOffscreen++;
      const db = t.DoctrineCampaign?.doctrineBook(book);
      for (const o of db?.objectives || []) if (o.kind === 'raid' && Number(o.target?.systemIndex) === here) acc.abstractAtCaptain.raidStrikes += (o.actions || []).filter((a) => a.day === day && a.action === 'engage' && !/scene/.test(a.detail || '')).length;
    };
    window.__wait = (n) => { for (let i = 0; i < n; i++) { if (window.__scene()) return; window.__keepUp(); t.advanceFleetCalendar(1, t.Fleet.nextId(t.fleetBook(), 'journey')); acc.waits++; offscreenHere(); } window.__scene(); };
    // Where he goes: a captain heading into trouble more often than chance would send him (stated: this is a
    // measurement of the handoff, not of how often trouble finds a random traveller). While a blockade stands,
    // most courses cross it; otherwise half end at a world an operation or raid is flying against (he waits
    // there for it), a quarter cross the pirates' waters, and the rest go anywhere.
    const routeOK = (to) => { const p = t.getPlottedRoute(t.state.currentPlanet, to); return p && p.legs?.length >= 1 && p.legs.length <= 8 ? p : null; };
    window.__pick = () => {
      const here = t.state.currentPlanet, book = t.campaign(), w = t.buildCampaignWorld(true);
      for (const b of book.blockades || []) acc.blockadesSeen[b.id] = b.status;
      const pending = window.__pending; window.__pending = null;
      const A = t.getSystemIndexByName('Astron');
      const nb = w.neighbours(A).map(Number).filter((n) => n !== t.getSystemIndexByName('Pirates Haven'));
      const acrossFrom = (from) => nb.filter((n) => n !== from && t.getPlottedRoute(from, n)?.systems.slice(1, -1).map(Number).includes(A));
      if (pending === 'pirate' && nb.includes(here)) { const across = acrossFrom(here); if (across.length) { acc.picks.pirate++; return { to: across[Math.floor(window.__rng() * across.length)], wait: 1 }; } }
      // An active blockade is rare and short-lived: while there is one, most courses cross it.
      const blk = new Set((book.blockades || []).filter((b) => ['active', 'forming'].includes(b.status)).map((b) => Number(b.target)));
      if (blk.size && window.__rng() < 0.7) {
        const through = [];
        for (let i = 0; i < t.state.planets.length; i++) { if (i === here) continue; const p = routeOK(i); if (p && p.systems.slice(1, -1).map(Number).some((x) => blk.has(x))) through.push(i); }
        if (through.length) { acc.picks.blockade++; return { to: through[Math.floor(window.__rng() * through.length)], wait: 2 }; }
      }
      const u = window.__rng();
      if (u < 0.5) {
        const db = t.DoctrineCampaign?.doctrineBook(book);
        const targets = [...(book.operations || []).filter((o) => ['moving', 'engaged'].includes(o.status) && !o.resolvedBy).map((o) => ({ to: Number(o.targetSystem), eta: o.arriveDay ?? null })),
          ...((db?.objectives || []).filter((o) => o.kind === 'raid' && o.status === 'active').map((o) => ({ to: Number(o.target?.systemIndex ?? o.targetSystem), eta: null })))].filter((x) => Number.isFinite(x.to) && x.to !== here && routeOK(x.to));
        if (targets.length) { const x = targets[Math.floor(window.__rng() * targets.length)]; acc.picks.war++; const plan = routeOK(x.to); const legs = t.routeLegDays(plan).reduce((n, d) => n + d, 0); return { to: x.to, wait: Math.max(2, Math.min(20, (x.eta ?? t.state.day + 8) - (t.state.day + legs) + 3)) }; }
      }
      if (u < 0.75) {
        // Through the pirates' waters: to a neighbour of Astron from which a course crosses it, then across.
        if (nb.includes(here) && acrossFrom(here).length) { window.__pending = null; const across = acrossFrom(here); acc.picks.pirate++; return { to: across[Math.floor(window.__rng() * across.length)], wait: 1 }; }
        const to = nb.filter((n) => n !== here && acrossFrom(n).length && routeOK(n));
        if (to.length) { acc.picks.pirateApproach++; return { to: to[Math.floor(window.__rng() * to.length)], wait: 0, next: 'pirate' }; }
      }
      const cands = [];
      for (let i = 0; i < t.state.planets.length; i++) { if (i === here) continue; const p = t.getPlottedRoute(here, i); if (p && p.legs?.length >= 2 && p.legs.length <= 3) cands.push(i); }
      if (!cands.length) return null;
      acc.picks.random++;
      return { to: cands[Math.floor(window.__rng() * cands.length)], wait: 2 };
    };
  });
  const samples = [];
  let lastLog = 0;
  for (;;) {
    const r = await ev(() => {
      const t = testBM1;
      try {
        const pick = window.__pick();
        if (pick) { window.__flyTo(pick.to); window.__pending = pick.next || null; }
        window.__wait(pick ? pick.wait : 3);
      } catch (e) { window.__acc.errors.push(String(e?.stack || e).slice(0, 300)); }
      return { day: t.state.day, over: t.state.gameOver };
    });
    if (r.over || r.day >= days || Date.now() - t0 > 55 * 60 * 1000) break;
    if (r.day - lastLog >= 50) {
      lastLog = r.day;
      const s = await ev(() => { const t = testBM1, book = t.campaign(); return { day: t.state.day, stats: t.Encounter ? { ...t.Encounter.encounterStats(book) } : null, flights: window.__acc.flights, stops: { ...window.__acc.stops } }; });
      samples.push(s);
      console.log(label, JSON.stringify(s));
    }
  }
  const fin = await ev(() => {
    const t = testBM1, book = t.campaign(), a = window.__acc;
    // Baseline-comparable: contacts settled abstractly where the captain was.
    for (const b of book.blockades || []) for (const run of b.runs || []) if (String(run.by || '').startsWith('captain:') && !run.tactical) a.abstractAtCaptain.blockadeRuns++;
    const encs = book.encounters || [];
    const st = t.Encounter ? { ...t.Encounter.encounterStats(book) } : null;
    t.saveGame(9);
    const raw = t.getSaveSlotRaw(9) || '';
    const encBytes = JSON.stringify(encs).length + JSON.stringify(book.stats?.encounters || {}).length;
    const byStatus = encs.reduce((m, e) => { m[e.status] = (m[e.status] || 0) + 1; return m; }, {});
    return { day: t.state.day, acc: { ...a, lostVids: Object.keys(a.lostVids).length, blockadesSeen: Object.keys(a.blockadesSeen).length }, stats: st, stored: encs.length, byStatus,
      fallbackReasons: encs.filter((e) => e.fallback?.used).map((e) => [e.type, e.fallback.reason]),
      saveBytes: raw.length, encounterBytes: encBytes, warpResumeBytes: JSON.stringify(t.state.warpResume || null).length,
      gameOver: t.state.gameOver };
  });
  const result = { label, seed: process.env.BM1_HANDOFF_SEED || 'handoff-measure', days, elapsedSec: Math.round((Date.now() - t0) / 1000), samples, final: fin, pageErrors: probe.errors.slice(0, 10) };
  fs.writeFileSync(path.join(out, `strategic-tactical-handoff-measure-${label}.json`), JSON.stringify(result, null, 1));
  console.log(label, 'final', JSON.stringify(fin));
  if (probe.errors.length) console.log('page errors:', probe.errors.slice(0, 5));
  await probe.close();
})().catch((e) => { console.error(e); process.exit(1); });
