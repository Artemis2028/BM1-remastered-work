// Long-run sanity for ARCHITECTURE-CLEANUP-FINAL §2 on the real chart: four of the captain's traders (two unarmed
// freighters, two armed ones) trade freely for DAYS days from Earth under an empire–Terran DMZ at Lik Prime and a
// Terran inspection regime at Orion; half-way through, a second DMZ begins at Proxima Yard and later ends. Checked
// every day: no armed (military) trader ever stands in a DMZ that bars her; every trader keeps her vid and one
// trade/1 record; no fleet entry is duplicated; a hold never outlives the DMZ that caused it by more than a day.
// Reports inspections, re-plots, holds and the trading result. Exit 1 on any violation.
const fs = require('node:fs');
const path = require('node:path');
const { startProbe } = require('./probe-harness.cjs');

const DAYS = Number(process.env.BM1_CLEANUP_DAYS || 240);
(async () => {
  const probe = await startProbe({ viewport: { width: 1280, height: 800 } });
  const { ev, fresh, page } = probe;
  const out = process.env.BM1_TEST_OUTPUT || null;
  await page.waitForFunction(() => !testBM1.doctrineStatus || testBM1.doctrineStatus().state !== 'loading', null, { timeout: 30000 }).catch(() => {});
  await fresh('cf-long');
  const t0 = Date.now();
  const r = await ev((DAYS) => {
    const t = testBM1, s = t.state;
    const idx = (n) => t.getSystemIndexByName(n);
    const E = idx('Earth'), L = idx('Lik Prime'), O = idx('Orion'), P = idx('Proxima Yard');
    const db = t.DoctrineCampaign.doctrineBook(t.campaign()); db.config = { ...db.config, patrols: {}, explorers: {}, merchants: {}, projects: {}, patrolAreas: {} };
    s.latinum = 400000;
    for (let i = 0; i < s.planets.length; i++) { t.markSystemVisited(i); const cp = s.currentPlanet; s.currentPlanet = i; t.recordMarketObservation?.(i); s.currentPlanet = cp; }
    const term = (spec) => { const book = t.campaign(); t.syncPlayerPolity(book); const eff = []; const x = t.Campaign.addTreatyTerm(book, t.buildCampaignWorld(true), spec, s.day, eff); t.applyCampaignEffects(eff, s.day); if (!x.ok) throw new Error(x.reason); return x.term.id; };
    const end = (id) => { const eff = []; t.Campaign.endTreatyTerm(t.campaign(), t.buildCampaignWorld(true), id, s.day, 'measure', eff); t.applyCampaignEffects(eff, s.day); };
    const holder = (i) => t.buildCampaignWorld(true).systems[i]?.controller;
    term({ type: 'dmz', parties: ['player', holder(L)], systems: [L] });
    term({ type: 'inspection', inspector: holder(O), inspected: 'player', systems: [O], traffic: ['civilian', 'military'], hullCategories: ['freighter'], reveals: ['manifest'] });
    s.currentPlanet = E; t.applySystemState(E);
    const ships = [['cf-civ-1', 215], ['cf-civ-2', 223], ['cf-mil-1', 236], ['cf-mil-2', 236]];
    for (const [id, shipId] of ships) { const f = { id, shipId, name: id, faction: s.playerFaction, assignment: 'defense', systemIndex: E, seed: 3 }; s.playerFleet.push(f); t.autoAssignFleet(f); t.startFleetTrading(id, 'any'); }
    const vids = Object.fromEntries(ships.map(([id]) => [id, t.ensureFleetTradeState(s.playerFleet.find((f) => f.id === id)).vid]));
    const violations = [];
    const stats = { holdDays: 0, holds: 0, militaryAtDmzDays: 0, maxHold: 0 };
    const lat0 = s.latinum;
    let second = null, secondEnd = null;
    const trips = {};
    for (let d = 0; d < DAYS; d++) {
      if (d === Math.floor(DAYS / 3)) second = term({ type: 'dmz', parties: ['player', holder(P)], systems: [P] });
      if (d === Math.floor(DAYS / 2) && second) { end(second); secondEnd = s.day; second = null; }
      t.advanceFleetCalendar(1, t.Fleet.nextId(t.fleetBook(), 'journey'));
      const barredMil = t.Campaign.treatyBarred(t.campaign(), 'player', 'military', s.day);
      for (const [id] of ships) {
        const copies = s.playerFleet.filter((f) => f.id === id);
        if (copies.length !== 1) { violations.push(`day ${s.day}: ${id} has ${copies.length} entries`); continue; }
        const f = copies[0];
        if (f.destroyed) continue;
        const tr = f.trade || {};
        if (tr.schema !== 'trade/1') violations.push(`day ${s.day}: ${id} record ${tr.schema}`);
        if (tr.vid !== vids[id]) violations.push(`day ${s.day}: ${id} vid changed ${vids[id]} → ${tr.vid}`);
        if (['tradeRun', 'tradeRoute', 'cargoRun', 'route'].some((k) => k in f)) violations.push(`day ${s.day}: ${id} carries a legacy trade record`);
        const cls = t.shipTrafficClass(f.shipId);
        if (cls === 'military' && !f.transit && barredMil.has(Number(f.systemIndex)) && Number(f.systemIndex) !== E) { stats.militaryAtDmzDays++; violations.push(`day ${s.day}: armed ${id} standing in a barred DMZ at ${f.systemIndex}`); }
        if (tr.treatyHold) { stats.holdDays++; if (tr.treatyHold.since === s.day) stats.holds++; stats.maxHold = Math.max(stats.maxHold, s.day - tr.treatyHold.since); if (secondEnd != null && s.day > secondEnd + 1 && tr.treatyHold.system === P) violations.push(`day ${s.day}: ${id} still held by the ended DMZ at Proxima Yard`); }
        if (tr.tripId) (trips[id] ||= new Set()).add(tr.tripId);
      }
    }
    const insp = (t.campaign().treatyInspections || []).filter((x) => x.inspected === 'player');
    const keys = insp.map((x) => x.key);
    if (new Set(keys).size !== keys.length) violations.push('an inspection recorded twice');
    const fleet = s.playerFleet.filter((f) => ships.some(([id]) => id === f.id));
    return { days: DAYS, inspections: insp.length, inspectionStates: insp.reduce((m, x) => ({ ...m, [x.state]: (m[x.state] || 0) + 1 }), {}), reroutes: fleet.reduce((n, f) => n + (f.trade?.treatyReroutes || 0), 0), ...stats,
      circuitsByShip: Object.fromEntries(Object.entries(trips).map(([k, v]) => [k, v.size])), latinumDelta: Math.round(s.latinum - lat0), destroyed: fleet.filter((f) => f.destroyed).map((f) => f.id), violations: violations.slice(0, 20), violationCount: violations.length };
  }, DAYS);
  r.msPerDay = Math.round((Date.now() - t0) / DAYS);
  console.log(JSON.stringify(r, null, 1));
  console.log(`cleanup final long run: ${r.days} days, ${r.inspections} inspections, ${r.reroutes} re-plots, ${r.holds} holds, ${r.violationCount} violations`);
  if (out) { fs.mkdirSync(out, { recursive: true }); fs.writeFileSync(path.join(out, 'cleanup-final-measure.json'), JSON.stringify(r, null, 1)); }
  if (probe.errors.length) console.log('page errors:', probe.errors.slice(0, 5));
  await probe.close();
  process.exit(r.violationCount || probe.errors.length ? 1 : 0);
})();
