// Long-run sanity for ARCHITECTURE-CLEANUP: the model runs DAYS days with AI operations on. The terms are a Terran–Klingon
// DMZ at Border (transit and stationing restricted), a Klingon guarantee of Terran military transit there, a
// stationing-only DMZ at Archanis with a Klingon staging right for the Terrans, and basing rights at Qonos. Each day it
// checks the invariants:
//   - one stationing breach per presence (no incident key twice; no hull with two open breaches for one `since`);
//   - nobody teleported (a hull that changed system without a journey moved only to a neighbour, by a leg that ended);
//   - every presence record is in a legal state;
//   - production and ownership unchanged by basing;
// and it reports the counts. Exit 1 on any violation.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import * as C from '../src/campaign-strategy.mjs';
import { makeWorld, run } from './campaign-world-fixture.mjs';
import * as FX from './treaty-fixture.mjs';

const DAYS = Number(process.env.BM1_CLEANUP_DAYS || 400);
const out = process.env.BM1_TEST_OUTPUT || null;
const { IDX } = FX;
const env = FX.treatyWorldWith(C, makeWorld, 'CU-LONG');
env.relations['terran:klingon'] = 'ceasefire';
env.book.config.aiStrategicOps = true;
env.book.config.planningIntervalDays = 7;
for (const p of Object.values(env.book.polities)) p.lastPlanDay = 0;
const add = (spec) => { const r = C.addTreatyTerm(env.book, env.world, spec, 1, []); if (!r.ok) throw new Error(r.reason); return r.term; };
const border = add({ type: 'dmz', parties: ['terran', 'klingon'], systems: [IDX.Border], graceDays: 6 });
add({ type: 'transit', grantor: 'klingon', beneficiary: 'terran', systems: [IDX.Border], traffic: ['military'] });
const archanis = add({ type: 'dmz', parties: ['terran', 'klingon'], systems: [IDX.Archanis], graceDays: 6, restrict: { transit: false } });
add({ type: 'basing', host: 'klingon', guest: 'terran', systems: [IDX.Archanis], purposes: ['staging'] });
add({ type: 'basing', host: 'klingon', guest: 'terran', systems: [IDX.Qonos], purposes: ['repair', 'docking', 'recovery'] });

const LEGAL = new Set(['pending', 'stranded', 'breach', 'staged', 'withdrawn', 'withdrawn_late']);
const violations = [];
// Two Terran warships kept in the zones by orders of their own: one at Archanis (staged), one at Border (one breach).
const keep = (i, ref) => { const h = env.book.polities.terran.hulls.find((x) => x.status === 'ready' && !x.opId); h.systemIndex = i; h.status = 'assigned'; h.opId = ref; return h; };
const kept = { archanis: keep(IDX.Archanis, 'held:archanis'), border: keep(IDX.Border, 'held:border') };
const ctl0 = JSON.stringify(env.world.systems.map((s) => s.controller));
let pos = new Map();
const snapshot = () => { const m = new Map(); for (const p of Object.values(env.book.polities)) for (const h of p.hulls) if (h.status !== 'lost') m.set(h.id, { at: Number(h.systemIndex), transit: Boolean(h.transit) }); return m; };
pos = snapshot();
const presencesSeen = new Set();
const staged = new Set();
for (let d = 2; d <= DAYS; d++) {
  run(env.book, env.world, d, d);
  const now = snapshot();
  for (const [id, b] of now) {
    const a = pos.get(id);
    if (!a || a.at === b.at) continue;
    const near = env.world.neighbours(a.at).map(Number).includes(b.at);
    if (!near && !a.transit && !b.transit) violations.push(`day ${d}: ${id} jumped ${a.at} → ${b.at} with no journey`);
  }
  pos = now;
  for (const t of [border, archanis]) for (const [id, r] of Object.entries(t.withdrawal?.hulls || {})) {
    if (!LEGAL.has(r.state)) violations.push(`day ${d}: ${id} in state ${r.state}`);
    presencesSeen.add(`${t.id}|${id}|${r.since}`);
    if (r.state === 'staged') staged.add(id);
    if (t === archanis && r.state === 'breach') violations.push(`day ${d}: ${id} breached at Archanis under a staging right`);
  }
  const keys = (env.book.treatyIncidents || []).filter((x) => x.kind === 'dmz_stationing').map((x) => x.key);
  if (new Set(keys).size !== keys.length) violations.push(`day ${d}: a stationing breach recorded twice`);
}
const inc = (env.book.treatyIncidents || []).filter((x) => x.kind === 'dmz_stationing');
if (JSON.stringify(env.world.systems.map((s) => s.controller)) !== ctl0) violations.push('a system changed hands (no war is fought in this run)');
// Basing never changes production: the Terran berths with every basing right at Qonos equal those without (same day).
{ const withB = JSON.stringify(C.polityProduction(env.book, env.world, 'terran'));
  const saved = env.book.treatyTerms; env.book.treatyTerms = saved.filter((t) => t.type !== 'basing');
  const without = JSON.stringify(C.polityProduction(env.book, env.world, 'terran')); env.book.treatyTerms = saved;
  if (withB !== without) violations.push('Terran production differs with and without basing rights'); }
const keptBorder = (env.book.treatyIncidents || []).filter((x) => x.kind === 'dmz_stationing' && x.assets.includes(kept.border.identity?.vid || kept.border.vid || kept.border.id)).length;
if (keptBorder !== 1) violations.push(`the warship kept at Border has ${keptBorder} stationing breaches (one expected)`);
if (archanis.withdrawal?.hulls?.[kept.archanis.id]?.state !== 'staged') violations.push('the warship kept at Archanis is not staged');
const st = env.book.stats.treaty || {};
const report = {
  days: DAYS,
  journeys: (env.book.journeys || []).length,
  dmzCrossings: st.dmzCrossings || 0,
  presences: presencesSeen.size,
  stagedHulls: staged.size,
  compliantWithdrawals: st.compliantWithdrawals || 0,
  withdrawalsOrdered: st.withdrawalsOrdered || 0,
  stationingBreaches: st.stationingBreaches || 0,
  stationingIncidents: inc.length,
  stationingIncidentStates: inc.reduce((m, x) => ({ ...m, [x.state]: (m[x.state] || 0) + 1 }), {}),
  strandedInDmz: st.strandedInDmz || 0,
  violations,
};
console.log(JSON.stringify(report, null, 1));
console.log(`cleanup long run: ${DAYS} days, ${report.presences} presences, ${report.stationingBreaches} stationing breaches, ${violations.length} violations`);
if (out) { fs.mkdirSync(out, { recursive: true }); fs.writeFileSync(path.join(out, 'cleanup-measure.json'), JSON.stringify(report, null, 1)); }
void fileURLToPath;
process.exit(violations.length ? 1 : 0);
