// Bounded campaign measurement for TREATY-EXPANSION (not a balance claim): the treaty fixture galaxy with the AI
// planning, operations, blockades and tows switched on, a Terran–Klingon ceasefire settled with several terms (a
// two-system DMZ, a Klingon transit guarantee, basing at Qonos, an inspection regime on military freighters at
// Khitomer, tribute and reparations), a Cardassian–Klingon DMZ, and a steady stream of traffic — lawful freighters
// through the inspection point and, every 25 days, a warship sent through the DMZ in defiance (alternately
// complying and refusing). Run for DAYS days beside a twin with the same settlement but no terms: the number of
// wars declared must be the same in both (a breach never makes a war).
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(process.env.BM1_TREATY_ROOT || path.join(here, '..'));
const C = await import(pathToFileURL(path.join(root, 'src/campaign-strategy.mjs')).href);
const { makeWorld } = await import(pathToFileURL(path.join(root, 'scripts/campaign-world-fixture.mjs')).href);
const FX = await import(pathToFileURL(path.join(here, 'treaty-fixture.mjs')).href);
const { IDX } = FX;
const DAYS = Number(process.env.BM1_TREATY_DAYS || 360);
const out = process.env.BM1_TEST_OUTPUT || null;

function campaign(withTerms) {
  const env = FX.treatyWorldWith(C, makeWorld, 'TX-MEASURE');
  const { book, world, relations } = env;
  book.config.aiStrategicOps = true; book.config.aiRecovery = true; book.config.planningIntervalDays = 10;
  for (const p of Object.values(book.polities)) p.lastPlanDay = 0;
  C.registerJourneyKind('treaty-test', {});
  const treaty = withTerms ? ['add DMZ systems Border/Archanis', { type: 'transit', grantor: 'klingon', beneficiary: 'terran', systems: [IDX.Archanis, IDX.Khitomer] },
    { type: 'basing', host: 'klingon', guest: 'terran', systems: [IDX.Qonos], purposes: ['repair', 'resupply', 'recovery'] },
    { type: 'inspection', inspector: 'klingon', inspected: 'terran', systems: [IDX.Khitomer], traffic: ['military', 'civilian'], hullCategories: ['freighter'] },
    { type: 'tribute', payer: 'klingon', recipient: 'terran', amount: 5000, cadenceDays: 30 },
    { type: 'reparations', payer: 'terran', recipient: 'klingon', total: 60000, payments: 6, cadenceDays: 45 }] : null;
  const eff0 = C.forceWarTransition(book, world, 'terran', 'klingon', 'ceasefire', 1, 'measured settlement', 'directed', { treaty });
  relations['terran:klingon'] = 'ceasefire';
  if (withTerms) C.addTreatyTerm(book, world, { type: 'dmz', parties: ['cardassian', 'klingon'], systems: [IDX.Cardassia], graceDays: 15 }, 1, eff0);
  return { ...env, eff0 };
}
function runOne(withTerms) {
  const env = campaign(withTerms);
  const { book, world } = env;
  const effects = env.eff0.slice();
  let ms = 0, maxActive = 0, defiers = 0, freighters = 0;
  for (let d = 2; d <= DAYS; d++) {
    // Traffic: a Terran freighter every 15 days Vega → Qonos by Archanis/Khitomer (inspected at Khitomer), and every 25
    // days a Terran warship sent Vega → Qonos through Border in defiance (alternately complying and refusing).
    const free = (shipId) => (book.polities.terran.hulls || []).find((h) => h.status === 'ready' && !h.opId && !h.transit && Number(h.systemIndex) === IDX.Vega && !(h.hull < h.maxHull));
    const putAtVega = () => { const h = (book.polities.terran.hulls || []).find((x) => x.status === 'ready' && !x.opId && !x.transit && !(x.hull < x.maxHull)); if (h) h.systemIndex = IDX.Vega; return h; };
    if (withTerms && d % 15 === 0) { const h = free() || putAtVega(); if (h) { h.shipId = 99; const r = C.startJourney(book, world, { kind: 'treaty-test', sponsor: 'terran', hulls: [h], destination: IDX.Qonos, purpose: 'move', plan: { path: [IDX.Archanis, IDX.Khitomer, IDX.Qonos], legDays: [6, 6, 6] }, meta: { cargo: [{ cargoId: 'grain', quantity: 40 }, { cargoId: 'disruptors', quantity: 2, concealed: true }], inspectionResponse: d % 45 === 0 ? 'refuse' : 'comply' } }, d, effects); if (r.ok) { freighters++; h.status = 'assigned'; h.opId = r.journey.id; } } }
    if (withTerms && d % 25 === 0) { const h = free() || putAtVega(); if (h) { const r = C.startJourney(book, world, { kind: 'treaty-test', sponsor: 'terran', hulls: [h], destination: IDX.Qonos, purpose: 'move', treatyDefy: true, plan: { path: [IDX.Border, IDX.Qonos], legDays: [10, 8] }, meta: { treatyResponse: (d / 25) % 2 ? 'comply' : 'refuse' } }, d, effects); if (r.ok) { defiers++; h.status = 'assigned'; h.opId = r.journey.id; } } }
    // A damaged Terran warship standing at Qonos every 60 days: only basing rights can repair it there.
    if (d % 60 === 0) { const h = (book.polities.terran.hulls || []).find((x) => x.status === 'ready' && !x.opId && !x.transit && x.hull >= x.maxHull); if (h) { h.systemIndex = IDX.Qonos; h.hull = Math.round(h.maxHull * 0.7); } }
    const t0 = performance.now();
    const e = C.advanceCampaignDay(book, world, d);
    ms += performance.now() - t0;
    for (const x of e) if (x.type === 'captureSystem') world.systems[x.systemIndex].controller = x.by;
    effects.push(...e);
    // Arrived test movers are free again.
    for (const h of book.polities.terran.hulls) if (h.status === 'assigned' && !h.transit && h.opId && !C.journeyById(book, h.opId)?.status?.includes('underway') && String(h.opId).includes(':journey:')) { h.status = 'ready'; h.opId = null; }
    maxActive = Math.max(maxActive, C.activeTreatyTerms ? C.activeTreatyTerms(book, null, d).length : 0);
  }
  const st = book.stats.treaty || {};
  const count = (t) => effects.filter((e) => e.type === t).length;
  return {
    withTerms, days: DAYS, msPerDay: Math.round(100 * ms / (DAYS - 1)) / 100,
    activeTermsMax: maxActive, termsAtEnd: (book.treatyTerms || []).map((t) => [t.type, t.status]),
    dmzCrossings: st.dmzCrossings ?? 0, dmzWarnings: st.dmzWarnings ?? 0, compliantWithdrawals: st.compliantWithdrawals ?? 0, withdrawalsOrdered: st.withdrawalsOrdered ?? 0, routesRefused: st.dmzRoutesRefused ?? 0, treatyReplots: st.treatyReplots ?? 0,
    breaches: st.breaches ?? 0, breachesByKind: (book.treatyIncidents || []).filter((x) => x.responses.some((r) => r.state === 'breach')).reduce((m, x) => { m[x.kind] = (m[x.kind] || 0) + 1; return m; }, {}),
    inspections: { requested: st.inspectionsRequested ?? 0, completed: st.inspectionsCompleted ?? 0, refused: st.inspectionsRefused ?? 0, unenforced: st.inspectionsUnenforced ?? 0 },
    tribute: { paid: st.tributePaid ?? 0, missed: st.tributeMissed ?? 0 }, reparations: { paid: st.reparationsPaid ?? 0, missed: st.reparationsMissed ?? 0, completed: st.reparationsCompleted ?? 0 },
    blockadeClosures: st.blockadeClosures ?? 0, blockadesRefused: st.blockadesRefused ?? 0, basingRepairDays: st.basingRepairDays ?? 0,
    defiersSent: defiers, freightersSent: freighters,
    warDeclaredEffects: count('warDeclared'), incidentsWithWar: (book.treatyIncidents || []).filter((x) => x.warDeclared).length,
    terranKlingonStatus: book.warStates?.['klingon:terran']?.status, terranKlingonInstance: book.warStates?.['klingon:terran']?.instance,
    operations: (book.operations || []).length, bookBytes: JSON.stringify(book).length, treatyBytes: JSON.stringify({ a: book.treatyTerms, b: book.treatyIncidents, c: book.treatyLedger, d: book.treatyInspections }).length,
  };
}
const withTerms = runOne(true);
const twin = runOne(false);
const accidentalWars = withTerms.warDeclaredEffects - twin.warDeclaredEffects;
const res = { withTerms, twin, accidentalWars };
console.log(JSON.stringify(res, null, 1));
if (out) { fs.mkdirSync(out, { recursive: true }); fs.writeFileSync(path.join(out, 'treaty-expansion-measure.json'), JSON.stringify(res, null, 1)); }
const ok = accidentalWars === 0 && withTerms.incidentsWithWar === 0 && withTerms.terranKlingonStatus !== 'war';
console.log(`treaty measurement: accidental war declarations ${accidentalWars} (with terms ${withTerms.warDeclaredEffects}, twin ${twin.warDeclaredEffects}); ${ok ? 'OK' : 'FAIL'}`);
process.exit(ok ? 0 : 1);
