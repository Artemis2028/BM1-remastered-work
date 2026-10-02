// In-game long run for TREATY-EXPANSION (not a balance claim): the default campaign with its wars, AI planning,
// doctrine traffic, evacuations, blockades and tows, advanced day by day for BM1_LONGRUN_DAYS, once with a set of
// treaty terms in force from day 1 (the empire–Klingon ceasefire with a DMZ at Oce Nu, a Klingon transit guarantee,
// basing, an inspection regime, tribute, reparations, a Cardassian–Klingon DMZ) and once without (BM1_LONGRUN_LABEL=
// baseline sets no terms). Reports the per-day cost, the treaty counters, and the wars declared in each.
const fs = require('node:fs');
const path = require('node:path');
const { startProbe } = require('./probe-harness.cjs');
(async () => {
  const days = Number(process.env.BM1_LONGRUN_DAYS || 300);
  const label = process.env.BM1_LONGRUN_LABEL || 'candidate';
  const out = process.env.BM1_TEST_OUTPUT || '/tmp';
  fs.mkdirSync(out, { recursive: true });
  const probe = await startProbe({ viewport: { width: 1200, height: 800 } });
  const { ev, fresh, page } = probe;
  await page.waitForFunction(() => !testBM1.doctrineStatus || testBM1.doctrineStatus().state !== 'loading', null, { timeout: 30000 }).catch(() => {});
  await fresh('treaty-longrun');
  const setup = await ev((withTerms) => {
    const t = testBM1, s = t.state, book = t.campaign();
    window.__acc = { ms: 0, n: 0, declared: 0 };
    if (!withTerms || typeof t.Campaign.addTreatyTerm !== 'function') return { terms: 0 };
    t.syncPlayerPolity(book);
    const idx = (n) => t.getSystemIndexByName(n);
    const N = idx('Oce Nu'), R = idx('Narendra'), C = idx('Cardassia');
    const eff = t.Campaign.forceWarTransition(book, t.buildCampaignWorld(true), 'player', 'klingon', 'ceasefire', s.day, 'measured settlement', 'directed',
      { treaty: ['add DMZ systems Oce Nu', { type: 'transit', grantor: 'klingon', beneficiary: 'player', systems: [N] }, { type: 'basing', host: 'klingon', guest: 'player', systems: [R], purposes: ['repair', 'resupply'] },
        { type: 'inspection', inspector: 'klingon', inspected: 'player', systems: [N], traffic: ['military'], hullCategories: ['freighter'] }, { type: 'tribute', payer: 'klingon', recipient: 'player', amount: 5000, cadenceDays: 30 },
        { type: 'reparations', payer: 'player', recipient: 'klingon', total: 40000, payments: 4, cadenceDays: 60 }] });
    t.Campaign.addTreatyTerm(book, t.buildCampaignWorld(true), { type: 'dmz', parties: ['cardassian', 'klingon'], systems: [C] }, s.day, eff);
    t.applyCampaignEffects(eff, s.day);
    s.latinum = Math.max(s.latinum, 50000);
    return { terms: book.treatyTerms.length };
  }, label !== 'baseline');
  const samples = [];
  for (let d = 0; d < days; d += 10) {
    await ev(() => {
      const t = testBM1, a = window.__acc;
      for (let i = 0; i < 10; i++) { const t0 = performance.now(); t.advanceFleetCalendar(1, t.Fleet.nextId(t.fleetBook(), 'journey')); a.ms += performance.now() - t0; a.n++; }
    });
    if ((d + 10) % 100 === 0) { const x = await ev(() => ({ day: testBM1.state.day, ms: Math.round(100 * window.__acc.ms / window.__acc.n) / 100 })); samples.push(x); console.log(label, JSON.stringify(x)); }
  }
  const fin = await ev(() => {
    const t = testBM1, book = t.campaign(), st = book.stats.treaty || {};
    const declared = (t.galaxyNewsBook().items || []).filter((r) => /^diplomacy:declared:/.test(String(r.id))).length;
    return { msPerDay: Math.round(100 * window.__acc.ms / window.__acc.n) / 100, terms: (book.treatyTerms || []).map((x) => [x.type, x.status]), stats: st, incidents: (book.treatyIncidents || []).length, incidentsWithWar: (book.treatyIncidents || []).filter((x) => x.warDeclared).length,
      warStatePlayerKlingon: book.warStates?.['klingon:player']?.status ?? null, declarationsReported: declared, bookBytes: JSON.stringify(book).length };
  });
  const res = { label, days, setup, samples, final: fin, errors: probe.errors.slice(0, 5) };
  fs.writeFileSync(path.join(out, `treaty-expansion-ingame-measure-${label}.json`), JSON.stringify(res, null, 1));
  console.log(label, 'final', JSON.stringify(fin));
  await probe.close();
  process.exit(probe.errors.length ? 1 : 0);
})();
