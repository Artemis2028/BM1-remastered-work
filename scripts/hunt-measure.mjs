// Long-run measurement for HIROGEN-HUNTING-DOCTRINE (pure). The campaign suites' galaxy plus the Hirogen Range
// (hunt-fixture.mjs), the real doctrine data, every routine on (patrols, explorers, merchants: real traffic for
// the Hirogen to see), several seeds, several hundred days. Each seed is also run with the hunt switched off
// (the control), so anything the hunt changes beyond itself shows as a difference.
// Reports: hunts opened / completed / escaped / abandoned, hunter losses, pursuit duration and distance,
// duplicates prevented, cooldowns, civilian vs military prey, world captures and formal wars attributable to
// hunting (must be 0), hunter commitment (do the Hirogen abandon their home?), save-state growth.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import * as C from '../src/campaign-strategy.mjs';
import * as DC from '../src/doctrine-campaign.mjs';
import * as D from '../src/doctrine-runtime.mjs';
import { makeWorld } from './campaign-world-fixture.mjs';
import * as HF from './hunt-fixture.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const doctrine = HF.loadDoctrine(D, path.join(here, '..'));
const DAYS = Number(process.env.BM1_HUNT_DAYS || 400);
const SEEDS = (process.env.BM1_HUNT_SEEDS || 'HM-1,HM-2,HM-3,HM-4').split(',');
const out = process.env.BM1_TEST_OUTPUT || null;

function runOne(seed, huntsOn) {
  const e = HF.huntWorld(C, makeWorld, seed, { DC, doctrine });
  const db = DC.doctrineBook(e.book);
  if (!huntsOn) db.config = { ...db.config, hunts: {} };
  // The Hirogen get a real hunting force: their campaign hulls, as Hunters and a Warship.
  const hir = e.book.polities.hirogen.hulls;
  hir.forEach((h, k) => { h.shipId = k === 0 ? 71 : 70; h.maxHull = h.hull = e.world.shipStats(h.shipId).combatHull; h.crew = 1; });
  const fx = [];
  const growth = [];
  let homeDays = 0, committedHullDays = 0, hullDays = 0;
  for (let d = 2; d <= DAYS; d++) {
    fx.push(...C.advanceCampaignDay(e.book, e.world, d).map((x) => ({ type: x.type, day: d, systemIndex: x.systemIndex ?? x.target ?? null, by: x.by ?? x.polity ?? x.attacker ?? null, encounterType: x.encounterType ?? null, ref: x.ref ?? x.id ?? null })));
    const live = hir.filter((h) => h.status !== 'lost');
    hullDays += live.length;
    committedHullDays += live.filter((h) => DC.huntSummary(e.book).hunts.some((o) => o.status === 'active' && o.hunters.some((x) => x.hullId === h.id))).length;
    if (live.some((h) => !h.transit && Number(h.systemIndex) === HF.IDX.Range)) homeDays++;
    if (d % 100 === 0) growth.push({ day: d, huntBytes: JSON.stringify(db.hunt || {}).length, huntObjectiveBytes: JSON.stringify(db.objectives.filter((o) => o.kind === 'hunt')).length, bookBytes: JSON.stringify(e.book).length });
  }
  const s = DC.huntSummary(e.book);
  const hist = Object.values(s.history).flat();
  const closed = s.hunts.filter((o) => o.status !== 'active');
  const huntIds = new Set(s.hunts.map((o) => o.id));
  const huntEncounters = new Set((e.book.encounters || []).filter((x) => x.type === 'hunt').map((x) => x.id));
  const captures = fx.filter((x) => /capture/i.test(x.type));
  const wars = fx.filter((x) => /declar|warDeclared|war_declared/i.test(x.type));
  const byHunt = (x) => huntIds.has(x.ref) || huntEncounters.has(x.ref);
  const rel = Object.fromEntries(Object.keys(e.book.polities).filter((p) => p !== 'hirogen').map((p) => [p, e.world.relation('hirogen', p)]));
  return {
    seed, huntsOn, days: DAYS,
    opened: s.stats.huntsOpened || 0, completed: s.stats.huntsCompleted || 0, escaped: s.stats.huntsEscaped || 0, abandoned: s.stats.huntsAbandoned || 0, hunterLostOrDisabled: s.stats.huntsHunterLost || 0,
    stillActive: s.hunts.filter((o) => o.status === 'active').length,
    hunterHullsLost: hir.filter((h) => h.status === 'lost').length,
    results: hist.reduce((m, h) => ({ ...m, [h.result]: (m[h.result] || 0) + 1 }), {}),
    avgDurationDays: closed.length ? Math.round((closed.reduce((n, o) => n + (o.closedDay - o.startDay), 0) / closed.length) * 10) / 10 : null,
    maxDurationDays: closed.length ? Math.max(...closed.map((o) => o.closedDay - o.startDay)) : null,
    avgLegs: closed.length ? Math.round((closed.reduce((n, o) => n + (o.legsFlown || 0), 0) / closed.length) * 10) / 10 : null,
    duplicatesPrevented: s.stats.huntDuplicatesPrevented || 0, cooldownsSet: s.stats.huntCooldownsSet || 0, cooldownRejections: s.stats.huntCooldownSkips || 0, deferredNoHunter: s.stats.huntDeferredNoHunter || 0,
    preyMilitary: s.stats.huntPreyMilitary || 0, preyCivilian: s.stats.huntPreyCivilian || 0,
    rehuntSamePrey: (() => { const by = {}; for (const h of hist) (by[h.preyVid] ||= []).push(h); let n = 0, minGap = null; for (const l of Object.values(by)) { l.sort((a, b) => a.startDay - b.startDay); for (let k = 1; k < l.length; k++) { n++; const g = l[k].startDay - l[k - 1].endDay; minGap = minGap == null ? g : Math.min(minGap, g); } } return { repeats: n, minGapDays: minGap }; })(),
    worldCapturesByHunting: captures.filter(byHunt).length, formalWarsByHunting: wars.filter(byHunt).length, capturesAll: captures.length, warsAll: wars.length,
    hirogenRelations: rel,
    homeCoverageShare: Math.round((homeDays / (DAYS - 1)) * 1000) / 1000, committedShare: hullDays ? Math.round((committedHullDays / hullDays) * 1000) / 1000 : 0,
    growth,
  };
}

const rows = [];
for (const seed of SEEDS) { rows.push(runOne(seed, true)); rows.push(runOne(seed, false)); }
const on = rows.filter((r) => r.huntsOn);
const sum = (k) => on.reduce((n, r) => n + (r[k] || 0), 0);
const total = {
  seeds: SEEDS.length, days: DAYS,
  opened: sum('opened'), completed: sum('completed'), escaped: sum('escaped'), abandoned: sum('abandoned'), hunterLostOrDisabled: sum('hunterLostOrDisabled'), hunterHullsLost: sum('hunterHullsLost'),
  duplicatesPrevented: sum('duplicatesPrevented'), cooldownsSet: sum('cooldownsSet'), cooldownRejections: sum('cooldownRejections'),
  preyMilitary: sum('preyMilitary'), preyCivilian: sum('preyCivilian'),
  worldCapturesByHunting: sum('worldCapturesByHunting'), formalWarsByHunting: sum('formalWarsByHunting'),
  capturesOnVsControl: [sum('capturesAll'), rows.filter((r) => !r.huntsOn).reduce((n, r) => n + r.capturesAll, 0)],
  warsOnVsControl: [sum('warsAll'), rows.filter((r) => !r.huntsOn).reduce((n, r) => n + r.warsAll, 0)],
  avgDurationDays: Math.round((on.filter((r) => r.avgDurationDays != null).reduce((n, r) => n + r.avgDurationDays, 0) / Math.max(1, on.filter((r) => r.avgDurationDays != null).length)) * 10) / 10,
  maxDurationDays: Math.max(0, ...on.map((r) => r.maxDurationDays || 0)),
  avgLegs: Math.round((on.filter((r) => r.avgLegs != null).reduce((n, r) => n + r.avgLegs, 0) / Math.max(1, on.filter((r) => r.avgLegs != null).length)) * 10) / 10,
  minHomeCoverage: Math.min(...on.map((r) => r.homeCoverageShare)), maxCommittedShare: Math.max(...on.map((r) => r.committedShare)),
  minRehuntGap: Math.min(...on.map((r) => r.rehuntSamePrey.minGapDays ?? Infinity)),
  maxHuntBytes: Math.max(...on.flatMap((r) => r.growth.map((g) => g.huntBytes + g.huntObjectiveBytes))),
};
const checks = [
  ['world captures by hunting = 0', total.worldCapturesByHunting === 0],
  ['formal wars by hunting = 0', total.formalWarsByHunting === 0],
  ['no endless pursuit (every closed hunt within its pursuit budget + search)', total.maxDurationDays <= 40 + 12 + 2],
  ['military prey outnumber civilian (no weak-civilian farming)', total.preyMilitary >= total.preyCivilian],
  ['the Hirogen keep a hull at home most days (≥ 50%)', total.minHomeCoverage >= 0.5],
  ['no prey re-hunted inside the shortest cooldown', total.minRehuntGap === Infinity || total.minRehuntGap >= 45],
  ['hunt state stays bounded (< 64 KB)', total.maxHuntBytes < 64 * 1024],
  ['hunts happened', total.opened > 0],
];
console.log(JSON.stringify(total, null, 1));
for (const [n, ok] of checks) console.log(ok ? 'OK  ' : 'FAIL', n);
if (out) { fs.mkdirSync(out, { recursive: true }); fs.writeFileSync(path.join(out, 'hunt-measure.json'), JSON.stringify({ total, checks: checks.map(([n, ok]) => ({ n, ok })), rows }, null, 1)); }
process.exit(checks.every(([, ok]) => ok) ? 0 : 1);
