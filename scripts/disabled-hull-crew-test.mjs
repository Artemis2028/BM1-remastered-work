// Crewless repaired hulls (DOCTRINE-RUNTIME-PHASE3 §1a): a hull whose crew were rescued or lost may be
// recovered and structurally repaired, but it is not operational — not selectable, not resuming a job —
// until the ordinary crew recovery at a friendly world gives it the minimum operating complement.
// Runs against 508198a too: the baseline-defect checks fail there on their own assertions.
//   baseline-defect  a crewless hull repaired in the yard sails / is picked / resumes its job with crew 0
//   preservation     holds on both
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import * as C from '../src/campaign-strategy.mjs';
import * as D from '../src/doctrine-runtime.mjs';
import * as DC from '../src/doctrine-campaign.mjs';
import { classifyDamage } from '../src/ship-fleet.mjs';
import { galaxy, run, IDX, P, ready, hullById, reload, disable } from './doctrine-galaxy-fixture.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (f) => JSON.parse(fs.readFileSync(path.join(root, f), 'utf8'));
const doctrine = D.loadDoctrine(read('docs/doctrine/bm1-faction-doctrine.v0.2.1.json'), read('docs/doctrine/bm1-faction-doctrine.schema.json'));
const out = process.env.BM1_TEST_OUTPUT || null;
const results = [];
const log = {};
const check = (category, name, fn) => {
  try { fn(); results.push({ category, name, ok: true }); console.log('PASS', `[${category}]`, name); }
  catch (e) { results.push({ category, name, ok: false }); console.log('FAIL', `[${category}]`, name, '\n      ', String(e?.stack || e).split('\n').slice(0, 6).join('\n       ')); }
};
function mk(seed, opts = {}) {
  const env = galaxy(seed, opts);
  env.world.doctrineStep = (b, w, d, fx) => DC.advanceDoctrineDay(b, w, d, fx, doctrine);
  const db = DC.doctrineBook(env.book);
  db.config = { ...db.config, patrols: {}, explorers: {}, reliefShips: {}, merchants: {}, projects: {}, patrolAreas: {} };
  return { ...env, db };
}
const cond = (h) => classifyDamage(h.hull, h.maxHull);
const minCrew = (book) => book.config.minOperatingCrew ?? 0.5;
// Operational as the campaign uses the word: it can sail and be picked.
const operational = (h) => cond(h) === 'operational' && h.status !== 'repairing' && !h.recrew;
// A Terran hull disabled at Earth (its own yard, with shore leave; nothing in the way) whose crew are
// taken off at once.
function crewlessAtYard(env, { rescue = true } = {}) {
  const { book } = env;
  const h = ready(book, 'terran', IDX.Earth)[0];
  disable(h); h.status = 'repairing';
  run(book, env.world, 2, 2); // stranded
  if (rescue) {
    if (C.rescueStrandedCrew) assert.ok(C.rescueStrandedCrew(book, 'terran', h.id, 2, 'test relief'), 'no crew to take off');
    else h.crew = 0;
  }
  return h;
}
// Until the yard has finished the structure completely (the point at which an ordinary repair releases it).
function untilStructurallyRepaired(env, h, max = 80) {
  const trail = [];
  for (let i = 0; i < max && h.hull < h.maxHull; i++) { run(env.book, env.world, env.book.settled + 1, env.book.settled + 1); trail.push(`${env.book.settled}:${cond(h)}:${h.status}`); }
  return trail;
}

check('preservation', 'C1. rescue takes the crew off and the hulk stays disabled', () => {
  const env = mk('C1');
  const h = ready(env.book, 'romulan', IDX.Romulus)[0];
  h.systemIndex = IDX.Aldnas; disable(h); h.status = 'repairing';
  run(env.book, env.world, 2, 2);
  C.rescueStrandedCrew(env.book, 'romulan', h.id, 2, 'test relief');
  run(env.book, env.world, 3, 30);
  assert.equal(cond(h), 'disabled'); assert.equal(h.crew, 0); assert.equal(h.systemIndex, IDX.Aldnas);
  assert.equal(h.stranded.crew, 'rescued');
});
check('baseline-defect', 'C2. recovered and repaired in the yard with no crew: structurally sound but not operational', () => {
  const env = mk('C2');
  const h = crewlessAtYard(env);
  const vid = h.identity.vid;
  untilStructurallyRepaired(env, h);
  run(env.book, env.world, env.book.settled + 1, env.book.settled + 1);
  log.c2 = { cond: cond(h), status: h.status, crew: h.crew, recrew: h.recrew || null };
  assert.equal(cond(h), 'operational', 'the hull was never repaired');
  assert.ok(h.crew < minCrew(env.book), 'precondition: the crew is below the minimum');
  assert.equal(operational(h), false, `a crewless hull is operational (status ${h.status}, crew ${h.crew})`);
  assert.equal(h.systemIndex, IDX.Earth); assert.equal(h.identity.vid, vid);
});
check('baseline-defect', 'C3. a crewless repaired hull is picked by nothing: area patrol, raid, evacuation, blockade, escort, defence or campaign planning', () => {
  const env = mk('C3', { planning: true });
  const { book, world, db } = env;
  const h = crewlessAtYard(env);
  untilStructurallyRepaired(env, h);
  run(book, world, book.settled + 1, book.settled + 1);
  assert.ok(h.crew < minCrew(book), 'precondition');
  const d = book.settled;
  const patrol = DC.startAreaPatrol(book, world, 'terran', h.id, IDX.Earth, d, []);
  const raid = DC.orderRaid(book, world, { power: 'terran', target: IDX.Border, hullId: h.id, day: d, doctrine });
  // Evacuation: the crewless hull offered as a transport, and as an escort beside an able transport. The
  // control is the same order with an able escort, so a refusal is about the hull, not the order.
  const others = ready(book, 'terran', IDX.Earth).filter((x) => x.id !== h.id);
  if (others[0]) others[0].shipId = 91; // an authored freighter at Earth, so an evacuation has a carrier
  const tryEvac = (transports, escorts) => C.startEvacuation(JSON.parse(JSON.stringify(book)), world, { sponsor: 'terran', origin: IDX.Earth, destination: IDX.Vega, transports, escorts }, d, []);
  const carrier = others.find((x) => tryEvac([x.id], []).ok);
  const escortAble = others.find((x) => x !== carrier);
  const evacT = tryEvac([h.id], []);
  const evacE = carrier ? tryEvac([carrier.id], [h.id]) : { ok: false, reason: 'no carrier' };
  const evac = { ok: evacT.ok || evacE.ok, reason: `${evacT.reason} / ${evacE.reason}` };
  const evacAble = carrier && escortAble ? tryEvac([carrier.id], [escortAble.id]) : { ok: false, reason: 'no able carrier and escort at Earth' };
  const bh = ready(book, 'terran').filter((x) => x.id !== h.id).slice(0, 13);
  const blockade = C.startBlockade(JSON.parse(JSON.stringify(book)), world, { power: 'terran', target: IDX.Border, hullIds: [h.id, ...bh.map((x) => x.id)], purpose: 'cut_reinforcements' }, d, []);
  const blockadeAble = C.startBlockade(JSON.parse(JSON.stringify(book)), world, { power: 'terran', target: IDX.Border, hullIds: bh.map((x) => x.id), purpose: 'cut_reinforcements' }, d, []);
  const res = { patrol: patrol.ok, raid: raid.ok, evac: evac.ok, blockade: blockade.ok };
  log.c3 = { res, reasons: [patrol.reason, raid.reason, evac.reason, blockade.reason], controls: { evacAble: evacAble.ok || evacAble.reason, blockadeAble: blockadeAble.ok || blockadeAble.reason } };
  assert.deepEqual(res, { patrol: false, raid: false, evac: false, blockade: false }, JSON.stringify(log.c3));
  assert.equal(evacAble.ok, true, `control: ${JSON.stringify(log.c3.controls)}`); assert.equal(blockadeAble.ok, true, `control: ${JSON.stringify(log.c3.controls)}`);
  const strength = C.localDefenseStrength(book, world, IDX.Earth);
  const without = (() => { const s = h.status; h.status = 'lost'; const v = C.localDefenseStrength(book, world, IDX.Earth); h.status = s; return v; })();
  assert.equal(strength, without, 'a crewless hull counts as a defender');
  // Days of ordinary campaign planning and doctrine: nobody takes it while it waits for a crew.
  const picked = [];
  for (let i = 0; i < 12 && h.crew < minCrew(book); i++) { run(book, world, book.settled + 1, book.settled + 1); if (h.opId || h.status === 'assigned' || h.systemIndex !== IDX.Earth) picked.push(`${book.settled}:${h.status}:${h.opId}`); }
  assert.deepEqual(picked, [], 'picked while waiting for a crew');
});
check('new-feature', 'C4. save/load preserves the repaired-awaiting-crew state exactly', () => {
  const env = mk('C4');
  const h = crewlessAtYard(env);
  untilStructurallyRepaired(env, h);
  run(env.book, env.world, env.book.settled + 1, env.book.settled + 1);
  assert.ok(h.recrew, 'no awaiting-crew state');
  C.upgradeCampaignBook(env.book);
  const loaded = reload(env.book);
  const lh = hullById(loaded, 'terran', h.id);
  assert.deepEqual(lh.recrew, h.recrew); assert.equal(lh.status, h.status); assert.equal(lh.crew, h.crew);
  run(loaded, env.world, loaded.settled + 1, loaded.settled + 3);
  run(env.book, env.world, env.book.settled + 1, env.book.settled + 3);
  assert.equal(C.checksum(loaded), C.checksum(env.book), 'the continuation differs after save/load');
});
check('new-feature', 'C5/C6. the friendly world recrews it day by day; operational only on the day the minimum complement is reached', () => {
  const env = mk('C5');
  const h = crewlessAtYard(env);
  untilStructurallyRepaired(env, h);
  const trail = [];
  let recommissioned = null;
  for (let i = 0; i < 80 && !recommissioned; i++) {
    run(env.book, env.world, env.book.settled + 1, env.book.settled + 1, (e) => { if (e.type === 'hullRecommissioned' && e.hullId === h.id) recommissioned = e; });
    trail.push({ day: env.book.settled, crew: Math.round(h.crew * 1000) / 1000, status: h.status, operational: operational(h) });
  }
  log.c5 = { trail: trail.filter((_, i) => i % 5 === 0 || i === trail.length - 1), recommissioned };
  assert.ok(recommissioned, 'never recommissioned');
  const rising = trail.map((x) => x.crew);
  assert.ok(rising.every((c, i) => i === 0 || c >= rising[i - 1]) && rising.at(-1) > rising[0], 'the crew did not grow');
  assert.ok(trail.slice(0, -1).every((x) => !x.operational && x.crew < minCrew(env.book)), 'operational before the minimum complement');
  assert.ok(trail.at(-1).crew >= minCrew(env.book)); assert.equal(trail.at(-1).operational, true); assert.equal(h.status, 'ready');
});
check('baseline-defect', 'C7. an interrupted doctrine job resumes only once the hull is repaired AND crewed', () => {
  const env = mk('C7');
  const { book, world } = env;
  const h = ready(book, 'terran', IDX.Earth)[0];
  const r = DC.issueAssignment(book, world, { polity: 'terran', hullId: h.id, kind: 'patrol', doctrineRole: 'patrol', stops: [{ systemIndex: IDX.Vega, dwell: 0, milestone: 'arrival' }, { systemIndex: IDX.Earth, dwell: 0, milestone: null }, { systemIndex: IDX.Vega, dwell: 0, milestone: 'check_in' }] }, 1, []);
  run(book, world, 2, 3);
  assert.equal(h.systemIndex, IDX.Earth);
  DC.loseAssignmentHullUnwitnessed(book, world, r.assignment.id, 3, 'disabled', { silent: true });
  run(book, world, 4, 4);
  C.rescueStrandedCrew(book, 'terran', h.id, 4, 'test relief');
  let repairedDay = null, recrewedDay = null, movedDay = null;
  for (let d = 5; d <= 120 && movedDay == null; d++) {
    run(book, world, d, d, (e) => { if (e.hullId === h.id && e.type === 'doctrineMoved' && movedDay == null) movedDay = d; if (e.hullId === h.id && e.type === 'hullRecommissioned') recrewedDay = d; });
    if (repairedDay == null && cond(h) === 'operational') repairedDay = d;
  }
  log.c7 = { repairedDay, recrewedDay, movedDay, crew: h.crew };
  assert.ok(repairedDay != null && movedDay != null, JSON.stringify(log.c7));
  assert.ok(movedDay > repairedDay, `the job resumed the day the hull was repaired (day ${movedDay}), with crew ${h.crew}`);
  assert.ok(recrewedDay != null && movedDay >= recrewedDay, JSON.stringify(log.c7));
  assert.equal(r.assignment.status, 'completed'); assert.equal(h.identity.vid, r.assignment.vid);
});
check('preservation', 'C8. a hull whose crew never left is back as soon as it is repaired: no recrewing delay', () => {
  const env = mk('C8');
  const h = crewlessAtYard(env, { rescue: false });
  const crew0 = h.crew ?? 1;
  const fx = [];
  for (let i = 0; i < 60 && !(cond(h) === 'operational' && h.status === 'ready'); i++) run(env.book, env.world, env.book.settled + 1, env.book.settled + 1, (e) => { if (e.hullId === h.id) fx.push(e.type); });
  log.c8 = { status: h.status, crew: h.crew, fx };
  assert.equal(cond(h), 'operational'); assert.equal(h.status, 'ready');
  assert.ok(!fx.includes('hullAwaitingCrew'), 'a crew that never left was made to wait for a crew');
  assert.equal(h.recrew ?? null, null); assert.ok((h.crew ?? 1) >= Math.min(crew0, minCrew(env.book)));
});

if (out) { fs.mkdirSync(out, { recursive: true }); fs.writeFileSync(path.join(out, 'disabled-hull-crew-log.json'), JSON.stringify({ results, log }, null, 1)); }
const by = (c) => { const r = results.filter((x) => x.category === c); return `${r.filter((x) => x.ok).length}/${r.length}`; };
console.log(`\ncrewless repaired hulls: ${results.filter((x) => x.ok).length}/${results.length} (baseline-defect ${by('baseline-defect')}, new-feature ${by('new-feature')}, preservation ${by('preservation')})`);
process.exit(results.every((x) => x.ok) ? 0 : 1);
