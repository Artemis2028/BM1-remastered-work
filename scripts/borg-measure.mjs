// Long-run measurement for BORG-ASSIMILATION-TRANSWARP (pure). The campaign suites' galaxy plus Unimatrix, the
// Nexus and the Outpost (borg-fixture.mjs), the real doctrine data, every routine on (patrols, explorers,
// merchants, hunts: real traffic for the Collective to see), several seeds, several hundred days, worlds as
// targets. Reports the brief's metrics and checks the watch list.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import * as C from '../src/campaign-strategy.mjs';
import * as DC from '../src/doctrine-campaign.mjs';
import * as D from '../src/doctrine-runtime.mjs';
import { makeWorld, station } from './campaign-world-fixture.mjs';
import * as BF from './borg-fixture.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const doctrine = BF.loadDoctrine(D, path.join(here, '..'));
const DAYS = Number(process.env.BM1_BORG_DAYS || 400);
const SEEDS = (process.env.BM1_BORG_SEEDS || 'BM-1,BM-2,BM-3,BM-4').split(',');
const out = process.env.BM1_TEST_OUTPUT || null;

function vidOf(h) { return h?.identity?.vid || h?.vid || h?.id; }
function runOne(seed) {
  const e = BF.borgWorld(C, makeWorld, seed, { DC, doctrine, station });
  const db = DC.doctrineBook(e.book);
  db.config = { ...db.config, borg: { ...(db.config.borg || { power: 'borg' }), worlds: true } };
  const fx = [];
  const growth = [];
  const flips = [];
  for (let d = 2; d <= DAYS; d++) {
    const f = BF.run(C, e.book, e.world, d, d);
    for (const x of f) { if (x.type === 'systemAssimilated' || x.type === 'captureSystem') flips.push({ type: x.type, systemIndex: x.systemIndex, by: x.by, day: d }); if (/war|declar|peace|ceasefire/i.test(x.type)) fx.push({ type: x.type, a: x.a, b: x.b, by: x.by, day: d }); }
    if (d % 100 === 0) growth.push({ day: d, borgBytes: JSON.stringify(db.borg || {}).length, objectiveBytes: JSON.stringify(db.objectives.filter((o) => o.kind === 'assimilation')).length, bookBytes: JSON.stringify(e.book).length });
  }
  const s = DC.borgSummary(e.book);
  const st = s.stats;
  const objs = s.objectives;
  const results = s.history.reduce((m, h) => ({ ...m, [h.result]: (m[h.result] || 0) + 1 }), {});
  const all = [...Object.values(e.book.polities).flatMap((p) => p.hulls), ...(e.book.derelicts || [])];
  const vids = all.map(vidOf);
  const dupes = vids.filter((v, i) => vids.indexOf(v) !== i);
  const tw = s.transwarp.log || [];
  const worldDays = s.assimilatedWorlds.map((w) => w.day - w.startDay);
  return { seed, days: DAYS,
    opened: st.borgObjectivesOpened || 0, shipTargets: st.borgShipTargets || 0, worldTargets: st.borgWorldTargets || 0,
    shipsAssimilated: st.borgShipsAssimilated || 0, worldsAssimilated: st.borgWorldsAssimilated || 0, targetsEscaped: st.borgTargetsEscaped || 0, targetsDestroyed: st.borgTargetsDestroyed || 0,
    borgForcesLost: st.borgForcesLost || 0, borgHullsLost: (e.book.polities.borg.hulls || []).filter((h) => h.status === 'lost').length + (e.book.polities.borg.lostHulls || 0), results,
    transwarpUses: s.transwarp.uses || 0, cooldownBlocks: s.transwarp.cooldownBlocks || 0, transwarpRefused: s.transwarp.refused || 0,
    etaPairs: tw.map((x) => [x.conventionalDays, x.transwarpDays]),
    borgHulls: e.book.polities.borg.hulls.filter((h) => h.status !== 'lost').length, assimilatedHullsHeld: e.book.polities.borg.hulls.filter((h) => h.status !== 'lost' && h.assimilated).length,
    borgLicences: Object.keys(e.book.polities.borg.licenses || {}).length, borgIntegrations: Object.keys(e.book.polities.borg.integrations || {}).length,
    flips, captures: flips.filter((f) => f.type === 'captureSystem').length, assimilationFlips: flips.filter((f) => f.type === 'systemAssimilated').length,
    warEffects: fx, borgWarEffects: fx.filter((x) => [x.a, x.b, x.by].includes('borg')).length, borgWarStates: Object.keys(e.book.warStates || {}).filter((k) => k.includes('borg')).length,
    duplicateIdentities: dupes.length, minWorldDays: worldDays.length ? Math.min(...worldDays) : null, growth };
}
const rows = SEEDS.map(runOne);
const sum = (k) => rows.reduce((n, r) => n + (r[k] || 0), 0);
const total = {
  seeds: SEEDS.length, days: DAYS,
  opened: sum('opened'), shipTargets: sum('shipTargets'), worldTargets: sum('worldTargets'), shipsAssimilated: sum('shipsAssimilated'), worldsAssimilated: sum('worldsAssimilated'),
  targetsEscaped: sum('targetsEscaped'), targetsDestroyed: sum('targetsDestroyed'), borgForcesLost: sum('borgForcesLost'), borgHullsLost: sum('borgHullsLost'),
  transwarpUses: sum('transwarpUses'), cooldownBlocks: sum('cooldownBlocks'),
  meanConventionalDays: (() => { const p = rows.flatMap((r) => r.etaPairs).filter(([c]) => c != null); return p.length ? Math.round((p.reduce((n, [c]) => n + c, 0) / p.length) * 10) / 10 : null; })(),
  meanTranswarpDays: (() => { const p = rows.flatMap((r) => r.etaPairs); return p.length ? Math.round((p.reduce((n, [, t]) => n + t, 0) / p.length) * 10) / 10 : null; })(),
  assimilatedHullsHeld: sum('assimilatedHullsHeld'), borgLicences: sum('borgLicences'), borgIntegrations: sum('borgIntegrations'),
  captures: sum('captures'), borgWarEffects: sum('borgWarEffects'), borgWarStates: sum('borgWarStates'), duplicateIdentities: sum('duplicateIdentities'),
  minWorldDays: Math.min(...rows.map((r) => r.minWorldDays ?? Infinity)),
  maxBorgBytes: Math.max(...rows.flatMap((r) => r.growth.map((g) => g.borgBytes + g.objectiveBytes))),
};
const checks = [
  ['formal wars created by assimilation doctrine = 0', total.borgWarEffects === 0 && total.borgWarStates === 0],
  ['duplicate hull identities = 0', total.duplicateIdentities === 0],
  ['no production rights from a captured hull or world (Borg licences/integrations = 0)', total.borgLicences === 0 && total.borgIntegrations === 0],
  ['no steamroll (at most one world assimilated per 100 days per seed)', rows.every((r) => r.worldsAssimilated <= Math.ceil(DAYS / 100))],
  ['no instant world flip (every assimilated world took ≥ 10 days)', total.minWorldDays === Infinity || total.minWorldDays >= 10],
  ['not every target assimilated (some escaped, destroyed or abandoned)', total.opened === 0 || total.shipsAssimilated + total.worldsAssimilated < total.opened],
  ['transwarp does not trivialise distance (uses bounded by the cooldown)', rows.every((r) => r.transwarpUses <= Math.ceil(DAYS / 30) + 1)],
  ['Borg state bounded (< 96 KB)', total.maxBorgBytes < 96 * 1024],
  ['the Collective did something', total.opened > 0],
];
console.log(JSON.stringify(total, null, 1));
for (const [n, ok] of checks) console.log(ok ? 'OK  ' : 'FAIL', n);
if (out) { fs.mkdirSync(out, { recursive: true }); fs.writeFileSync(path.join(out, 'borg-measure.json'), JSON.stringify({ total, checks: checks.map(([n, ok]) => ({ n, ok })), rows }, null, 1)); }
process.exit(checks.every(([, ok]) => ok) ? 0 : 1);
