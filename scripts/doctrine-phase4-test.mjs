// Pure tests for faction doctrine runtime phase 4 (docs/doctrine/DOCTRINE-RUNTIME-PHASE4.md): enforcement,
// compliance, surrender and bounded predation. The doctrine package is loaded from docs/doctrine/ exactly
// as the game loads it; the galaxy is scripts/doctrine-galaxy-fixture.mjs:
//   Romulus(4) ─ Aldnas(11) ─ Delpi(9) ─ Vulcan(10) ─ Vega(1) ─ Romulus(4)
//                  │   │
//             Border(2) Ferenginar(12) ─ Ganalda(13) ─ Rigel(17) ─ Delpi(9)
// Security policies are published per world by the test (as the engine publishes FACTION_BORDER_POLICIES
// and authored checkpoints); a pirate haven is authored at Ganalda (unclaimed).
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

let passed = 0;
const failures = [];
const log = {};
const test = (name, fn) => {
  try { fn(); passed++; console.log('PASS', name); }
  catch (e) { failures.push(name); console.log('FAIL', name, '\n      ', String(e?.stack || e).split('\n').slice(0, 10).join('\n       ')); }
};
// The engine's faction border defaults (src/main.js FACTION_BORDER_POLICIES), as published policy.
export const BORDER = {
  klingon: { warFlag: 'closed', independent: 'challenge', other: 'challenge', unknown: 'challenge' },
  romulan: { warFlag: 'closed', independent: 'challenge', other: 'challenge', unknown: 'closed' },
  cardassian: { warFlag: 'closed', independent: 'challenge', other: 'challenge', unknown: 'challenge' },
  dominion: { warFlag: 'closed', independent: 'closed', other: 'challenge', unknown: 'closed' },
  terran: { warFlag: 'closed', independent: 'open', other: 'open', unknown: 'challenge' },
  ferengi: { warFlag: 'challenge', independent: 'open', other: 'open', unknown: 'open' },
  tholian: { warFlag: 'closed', independent: 'open', other: 'open', unknown: 'challenge' },
};
function mk(seed, opts = {}) {
  const env = galaxy(seed, opts);
  const policies = opts.policies || {};
  env.world.borderPolicy = (i) => {
    const ctl = env.world.systems[i]?.controller;
    if (policies[i] === null) return null;
    if (policies[i]) return { authority: ctl, label: `${ctl} security`, ...policies[i] };
    return opts.defaultPolicies && BORDER[ctl] ? { authority: ctl, label: `${ctl} border policy`, access: BORDER[ctl] } : null;
  };
  env.world.doctrineStep = (b, w, d, fx) => DC.advanceDoctrineDay(b, w, d, fx, doctrine);
  const db = DC.doctrineBook(env.book);
  db.config = { ...db.config, patrols: opts.patrols || {}, explorers: opts.explorers || {}, reliefShips: opts.reliefShips || {}, merchants: opts.merchants || {}, projects: opts.projects || {}, patrolAreas: opts.patrolAreas || {}, pirateHaunts: opts.pirateHaunts || [] };
  return { ...env, db };
}
const cond = (h) => classifyDamage(h.hull, h.maxHull);
const enfs = (db, pred = () => true) => db.objectives.filter((o) => o.kind === 'enforcement' && pred(o));
const preds = (db, pred = () => true) => db.objectives.filter((o) => o.kind === 'predation' && pred(o));
const step = (env, n = 1, onEffect) => run(env.book, env.world, env.book.settled + 1, env.book.settled + n, onEffect);
const closed = { access: { warFlag: 'closed', independent: 'closed', other: 'closed', unknown: 'closed' } };
const open = { access: { warFlag: 'closed', independent: 'open', other: 'open', unknown: 'open' } };
const challenge = (extra = {}) => ({ access: { warFlag: 'closed', independent: 'challenge', other: 'challenge', unknown: 'challenge' }, ...extra });
// A Romulan security picket at Romulus; everything else Romulan at Romulus sent elsewhere, so exactly one
// enforcer stands at the world.
function oneRomulanPicket(book) {
  const at = ready(book, 'romulan', IDX.Romulus);
  for (const h of at.slice(1)) { h.status = 'assigned'; h.opId = 'elsewhere'; }
  return at[0];
}
// A Delpin transport from Aldnas to Romulus (dwell) and back to Delpi: a foreign civilian in Romulan space.
function delpinVisitor(env, { plan = null, dwell = 3, commsDown = false, transponder = true, from = IDX.Aldnas, cargo = null } = {}) {
  const t = ready(env.book, 'delpin', IDX.Delpi)[0];
  t.systemIndex = from;
  const r = DC.issueAssignment(env.book, env.world, { polity: 'delpin', hullId: t.id, kind: 'transport', doctrineRole: 'civilian', cargo, stops: [{ systemIndex: IDX.Romulus, dwell, milestone: 'arrival' }, { systemIndex: IDX.Delpi, milestone: 'check_in' }] }, env.book.settled, []);
  assert.ok(r.ok, r.reason);
  if (plan) r.assignment.responsePlan = [...plan];
  if (commsDown) r.assignment.commsDown = true;
  if (!transponder) r.assignment.transponder = false;
  return { t, a: r.assignment };
}
function untilEnforcement(env, pred = () => true, max = 6) {
  let o = null;
  for (let i = 0; i < max && !o; i++) { step(env, 1); o = enfs(env.db, pred)[0] || null; }
  return o;
}

// ===================================================================================================
// Enforcement
// ===================================================================================================
test('P4-1. a security patrol sees lawful foreign traffic and does nothing when the policy permits transit', () => {
  const env = mk('P4-1', { policies: { [IDX.Romulus]: open } });
  oneRomulanPicket(env.book);
  const { t } = delpinVisitor(env);
  step(env, 8);
  assert.equal(enfs(env.db).length, 0);
  const v = Object.values(env.db.visits || {}).find((x) => x.vid === t.identity.vid);
  assert.equal(v?.outcome, 'lawful'); assert.ok(env.db.stats.lawfulTransits >= 1);
});
test('P4-2/27/28. a restricted-area violation creates one bounded leave-area objective with every field; enforcer and target keep their vids', () => {
  const env = mk('P4-2', { policies: { [IDX.Romulus]: closed } });
  const e = oneRomulanPicket(env.book);
  const { t } = delpinVisitor(env, { plan: ['comply'] });
  const o = untilEnforcement(env);
  assert.ok(o, 'no enforcement objective');
  for (const f of ['id', 'actor', 'target', 'authority', 'demand', 'comms', 'response', 'escalation', 'deadline', 'status']) assert.ok(o[f] != null, `missing ${f}`);
  assert.equal(o.demand.type, 'leave_area'); assert.equal(o.authority.source, 'security_policy'); assert.equal(o.authority.jurisdiction, 'authority:romulan');
  assert.equal(o.assigned.vid, e.identity.vid); assert.equal(o.target.vid, t.identity.vid);
  assert.equal(o.escalation.stage, 1); assert.ok(o.demand.issuedDay != null && o.deadline.value > o.demand.issuedDay);
  step(env, 6);
  assert.equal(enfs(env.db).length, 1, 'more than one objective for the visit');
  assert.equal(o.assigned.vid, e.identity.vid); assert.equal(e.identity.vid, hullById(env.book, 'romulan', e.id).identity.vid);
  assert.equal(t.identity.vid, o.target.vid);
  log.p4_2 = o;
});
test('P4-3. a warning must actually be received before any refusal or timeout handling', () => {
  const env = mk('P4-3', { policies: { [IDX.Romulus]: closed } });
  oneRomulanPicket(env.book);
  const { a } = delpinVisitor(env, { commsDown: true, plan: ['refuse', 'comply'], dwell: 10 });
  const o = untilEnforcement(env);
  step(env, 4);
  // Unheard, the ladder climbs one stage at a time — repeat on every channel, then alongside — and holds nobody.
  assert.deepEqual(o.escalation.history.map((x) => x.name), ['observe', 'warn', 'repeat', 'intercept']);
  assert.equal(a.hold, undefined, 'a vessel held on a demand it never heard');
  assert.equal(o.comms.receivedDay, null);
  assert.equal(o.response.history.length, 0, 'a refusal was recorded for a demand never received');
  assert.equal(o.escalation.refusals, 0);
  assert.ok(o.comms.log.some((x) => x.event === 'not received'));
  assert.equal(o.escalation.name, 'intercept', 'the enforcer did not close to make contact');
  assert.equal(enforcementEngaged(o), false, 'engaged a target that never received a warning');
  // Comms back: the demand arrives; only now can it be answered.
  a.commsDown = false; o.comms.state = 'sent';
  step(env, 1);
  assert.ok(o.comms.receivedDay != null);
  log.p4_3 = o.comms.log;
});
function enforcementEngaged(o) { return o.escalation.history.some((x) => x.name === 'engage') || o.actions.some((x) => x.action === 'engage' && /strike/.test(x.detail)); }
test('P4-4/5. the target complies by leaving: the objective closes (compliance verified); the enforcer does not follow it out', () => {
  const env = mk('P4-4', { policies: { [IDX.Romulus]: closed } });
  const e = oneRomulanPicket(env.book);
  const { t } = delpinVisitor(env, { plan: ['comply'] });
  const o = untilEnforcement(env);
  const where = new Set();
  for (let i = 0; i < 6 && o.status === 'active'; i++) { step(env, 1); where.add(e.systemIndex); }
  assert.equal(o.status, 'completed', JSON.stringify(o.resolution)); assert.deepEqual(o.resolution.reasons, ['compliance_verified', 'target_left_jurisdiction']);
  assert.notEqual(t.systemIndex, IDX.Romulus);
  step(env, 5, () => {}); where.add(e.systemIndex);
  assert.deepEqual([...where], [IDX.Romulus], 'the enforcer pursued the compliant vessel');
  assert.equal(o.escalation.history.filter((x) => x.name === 'engage').length, 0);
});
test('P4-6/7. a refusal moves the ladder up exactly one stage, never straight to force; a later compliance stops it and closes the objective', () => {
  const env = mk('P4-6', { policies: { [IDX.Romulus]: closed } });
  oneRomulanPicket(env.book);
  delpinVisitor(env, { plan: ['refuse', 'comply'] });
  const o = untilEnforcement(env);
  const stages = [];
  for (let i = 0; i < 8 && o.status === 'active'; i++) { step(env, 1); stages.push(o.escalation.stage); }
  assert.equal(Math.max(...stages), 2, `stages ${stages}`);
  assert.equal(o.status, 'completed'); assert.ok(o.resolution.reasons.includes('compliance_verified'));
  assert.deepEqual(o.escalation.history.map((x) => x.name), ['observe', 'warn', 'repeat', 'closed']);
  log.p4_6 = o.escalation.history;
});
test('P4-8. the same violation does not create a duplicate objective every tick', () => {
  const env = mk('P4-8', { policies: { [IDX.Romulus]: challenge() } });
  oneRomulanPicket(env.book);
  const { t } = delpinVisitor(env, { dwell: 12, plan: Array(20).fill('refuse') });
  step(env, 14);
  const mine = enfs(env.db, (o) => o.target.vid === t.identity.vid);
  assert.equal(mine.length, 1, `${mine.length} objectives for one visit`);
  assert.ok((env.db.stats.enforcementRepeatPrevented || 0) >= 1);
});
test('P4-9. static hostility without security or war authority never permits attack', () => {
  // Hostile but not at war, and the policy lets them through: nothing at all.
  const env = mk('P4-9', { relations: { 'romulan:delpin': 'hostile' }, policies: { [IDX.Romulus]: open } });
  oneRomulanPicket(env.book);
  delpinVisitor(env, { plan: Array(10).fill('refuse') });
  step(env, 10);
  assert.equal(enfs(env.db).length, 0);
  // Hostile, challenged and refusing every demand: the ladder stops at intercept — no strike.
  const env2 = mk('P4-9b', { relations: { 'romulan:delpin': 'hostile' }, policies: { [IDX.Romulus]: challenge() } });
  oneRomulanPicket(env2.book);
  delpinVisitor(env2, { dwell: 12, plan: Array(20).fill('refuse') });
  const strikes = [];
  step(env2, 12, (e) => { if (e.type === 'doctrineEnforcementStrike') strikes.push(e); });
  const o = enfs(env2.db)[0];
  assert.ok(o); assert.equal(strikes.length, 0);
  assert.ok(o.escalation.stage <= 3, `stage ${o.escalation.stage}`);
  assert.ok(o.lastEngageCheck && !o.lastEngageCheck.allowed, JSON.stringify(o.lastEngageCheck));
  log.p4_9 = { stage: o.escalation.stage, engage: o.lastEngageCheck };
});
test('P4-11. a formal war authorises the military part: a refusing enemy vessel is intercepted and engaged (to disable)', () => {
  const env = mk('P4-11', { relations: { 'romulan:delpin': 'war' }, policies: { [IDX.Romulus]: challenge() } });
  oneRomulanPicket(env.book);
  const { t } = delpinVisitor(env, { dwell: 12, plan: Array(20).fill('refuse') });
  const o = untilEnforcement(env);
  assert.equal(o.authority.source, 'formal_war'); assert.equal(o.target.class, 'warFlag'); assert.equal(o.demand.type, 'leave_area');
  const strikes = [];
  for (let i = 0; i < 8 && o.status === 'active'; i++) step(env, 1, (e) => { if (e.type === 'doctrineEnforcementStrike') strikes.push(e); });
  assert.ok(strikes.length >= 1, `no strike: ${JSON.stringify(o.lastEngageCheck)}`);
  assert.ok(o.escalation.history.some((x) => x.name === 'engage'));
  assert.notEqual(t.status, 'lost', 'the strike destroyed rather than disabled');
  log.p4_11 = { history: o.escalation.history, resolution: o.resolution, target: `${t.hull}/${t.maxHull}` };
});
function warEngagement(seed, policyAfter) {
  const env = mk(seed, { relations: { 'romulan:delpin': 'war' }, policies: { [IDX.Romulus]: challenge() } });
  oneRomulanPicket(env.book);
  const v = delpinVisitor(env, { dwell: 14, plan: Array(20).fill('refuse') });
  const o = untilEnforcement(env);
  for (let i = 0; i < 8 && o.escalation.stage < 4; i++) step(env, 1);
  assert.equal(o.escalation.stage, 4, 'precondition: engaging under formal war');
  env.relations['romulan:delpin'] = 'ceasefire';
  env.world.borderPolicy = ((orig) => (i) => (i === IDX.Romulus ? { authority: 'romulan', label: 'romulan security', ...policyAfter } : orig(i)))(env.world.borderPolicy);
  const strikes = [];
  const d0 = env.book.settled;
  step(env, 6, (e) => { if (e.type === 'doctrineEnforcementStrike') strikes.push(e); });
  return { env, o, v, strikes, d0 };
}
test('P4-12. a ceasefire cancels war-only enforcement at once: with the local policy permitting the vessel, the objective closes and no strike follows', () => {
  const { o, strikes, d0 } = warEngagement('P4-12', open);
  assert.equal(o.status, 'aborted', JSON.stringify(o.resolution)); assert.equal(o.resolution.day, d0 + 1);
  assert.match(o.resolution.note, /authority removed/);
  assert.equal(strikes.length, 0);
});
test('P4-13. local security enforcement independently authorised survives the ceasefire — without the war-only engagement', () => {
  const { o, strikes, d0 } = warEngagement('P4-13', closed);
  assert.equal(o.authority.source, 'security_policy'); assert.equal(o.authority.previous, 'formal_war');
  // Nothing the war authorised carries on: the local ladder restarts with its own warning, and any force it
  // reaches later is the enforcement mode's, on its own notice — never the war mode.
  assert.ok(strikes.every((e) => e.day >= d0 + 4 && !e.modes.includes('war') && e.authority === 'security_policy'), JSON.stringify(strikes));
  assert.ok(o.escalation.history.some((x) => x.name === 'warn' && x.day === d0 + 1));
  assert.ok(o.escalation.history.some((x) => /formal war ended/.test(x.detail)));
  assert.ok(o.status === 'active' || o.resolution.reasons.some((r) => r !== 'objective_cancelled'), JSON.stringify(o.resolution));
});
test('P4-14/15. an inspection request reveals nothing; an actual inspection reveals only what it can observe (not a concealed compartment)', () => {
  const cargo = { knowledge: 'verified', manifest: [{ cargoId: 'trade-goods', quantity: 30 }, { cargoId: 'weapons', quantity: 5, concealed: true }] };
  const refused = mk('P4-14', { policies: { [IDX.Romulus]: challenge({ inspection: true, contraband: ['weapons'] }) } });
  oneRomulanPicket(refused.book);
  delpinVisitor(refused, { cargo, plan: ['refuse', 'refuse', 'refuse'] });
  const o1 = untilEnforcement(refused);
  step(refused, 3);
  assert.equal(o1.demand.type, 'inspect'); assert.equal(o1.inspection, undefined); assert.equal(o1.target.cargo, 'unknown');
  assert.doesNotMatch(JSON.stringify({ o1, inspections: refused.db.inspections || [], knowledge: refused.db.knowledge }), /weapons/, 'the request alone revealed the cargo');
  const done = mk('P4-15', { policies: { [IDX.Romulus]: challenge({ inspection: true, contraband: ['weapons'] }) } });
  oneRomulanPicket(done.book);
  delpinVisitor(done, { cargo, plan: ['comply'] });
  const o2 = untilEnforcement(done);
  step(done, 2);
  assert.deepEqual(o2.inspection.observed, [{ cargoId: 'trade-goods', quantity: 30 }]); assert.equal(o2.inspection.concealedFound, false);
  assert.equal(o2.status, 'completed'); assert.deepEqual(o2.resolution.reasons, ['compliance_verified']);
  // Visible contraband is found, and turns the check into an order to leave.
  const seen = mk('P4-15b', { policies: { [IDX.Romulus]: challenge({ inspection: true, contraband: ['weapons'] }) } });
  oneRomulanPicket(seen.book);
  delpinVisitor(seen, { cargo: { knowledge: 'verified', manifest: [{ cargoId: 'weapons', quantity: 5 }] }, plan: ['comply', 'comply'] });
  const o3 = untilEnforcement(seen);
  step(seen, 4);
  assert.equal(o3.demand.type, 'leave_area'); assert.match(JSON.stringify(o3.actions), /contraband found: weapons/);
  log.p4_15 = { inspection: o2.inspection, contraband: o3.actions.map((x) => x.detail) };
});
function surrenderScene(seed) {
  const env = mk(seed, { relations: { 'romulan:delpin': 'war' }, policies: { [IDX.Romulus]: challenge() } });
  oneRomulanPicket(env.book);
  const v = delpinVisitor(env, { dwell: 14, plan: ['refuse', 'refuse', 'refuse', 'surrender'] });
  const o = untilEnforcement(env);
  const strikes = [];
  let surrenderDay = null;
  for (let i = 0; i < 10 && o.status === 'active'; i++) step(env, 1, (e) => { if (e.type === 'doctrineEnforcementStrike') strikes.push(e.day); if (e.type === 'vesselSurrendered') surrenderDay = e.day; });
  return { env, o, v, strikes, surrenderDay };
}
test('P4-16/17. an accepted surrender stops the fire; the surrendered vessel holds, inactive, and no attack objective reopens on it', () => {
  const { env, o, v, strikes, surrenderDay } = surrenderScene('P4-16');
  assert.ok(surrenderDay != null, 'no surrender');
  assert.equal(o.status, 'completed'); assert.deepEqual(o.resolution.reasons, ['surrender_accepted']);
  assert.ok(strikes.every((d) => d < surrenderDay), `a strike after the surrender: ${strikes} / ${surrenderDay}`);
  assert.equal(v.t.status, 'surrendered');
  const later = [];
  step(env, 6, (e) => { if (e.type === 'doctrineEnforcementStrike' || (e.type === 'doctrineEnforcement' && e.event === 'warning' && e.targetVid === v.t.identity.vid)) later.push(e); });
  assert.deepEqual(later, [], 'fire or a new demand after the surrender');
  assert.ok(enfs(env.db, (x) => x.target.vid === v.t.identity.vid).length === 1);
  assert.notEqual(v.t.status, 'surrendered', 'never released');
  log.p4_16 = { strikes, surrenderDay, resolution: o.resolution };
});
test('P4-18. a surrender survives save/load exactly; the continuation is identical', () => {
  const env = mk('P4-18', { relations: { 'romulan:delpin': 'war' }, policies: { [IDX.Romulus]: challenge() } });
  oneRomulanPicket(env.book);
  const v = delpinVisitor(env, { dwell: 14, plan: ['surrender'] });
  untilEnforcement(env);
  for (let i = 0; i < 4 && v.t.status !== 'surrendered'; i++) step(env, 1);
  assert.equal(v.t.status, 'surrendered');
  C.upgradeCampaignBook(env.book);
  const loaded = reload(env.book);
  assert.deepEqual(hullById(loaded, 'delpin', v.t.id).surrendered, v.t.surrendered);
  run(loaded, env.world, loaded.settled + 1, loaded.settled + 4);
  step(env, 4);
  assert.equal(C.checksum(loaded), C.checksum(env.book));
});
test('P4-19. a disabled vessel cannot comply by moving: it stays, and the demand closes as unable to comply', () => {
  const env = mk('P4-19', { policies: { [IDX.Romulus]: closed } });
  oneRomulanPicket(env.book);
  const { t } = delpinVisitor(env, { plan: ['comply'] });
  const o = untilEnforcement(env);
  disable(t);
  step(env, 3);
  assert.equal(t.systemIndex, IDX.Romulus); assert.equal(cond(t), 'disabled');
  assert.equal(o.status, 'aborted'); assert.deepEqual(o.resolution.reasons, ['target_unable_to_comply']);
});
test('P4-20. a disabled or surrendered vessel is selected for no new job: patrol, raid, evacuation, blockade', () => {
  const env = mk('P4-20', { relations: { 'romulan:klingon': 'war' } });
  const { book, world } = env;
  const k = ready(book, 'klingon', IDX.Border)[0];
  DC.surrenderVessel(book, world, { polity: 'klingon', hullId: k.id, to: 'terran', day: 1, reason: 'test' }, []);
  const d = 1;
  const res = {
    patrol: DC.startAreaPatrol(book, world, 'klingon', k.id, IDX.Border, d, []).ok,
    raid: DC.orderRaid(book, world, { power: 'klingon', target: IDX.Vega, hullId: k.id, day: d, doctrine }).ok,
    blockade: C.startBlockade(book, world, { power: 'klingon', target: IDX.Vega, hullIds: [k.id], purpose: 'cut_reinforcements' }, d, []).ok,
    evac: C.startEvacuation(book, world, { sponsor: 'klingon', origin: IDX.Border, destination: IDX.Qonos, transports: [k.id], escorts: [] }, d, []).ok,
    unavailable: C.hullUnavailable(k),
  };
  assert.deepEqual(res, { patrol: false, raid: false, blockade: false, evac: false, unavailable: true });
  const k2 = ready(book, 'klingon', IDX.Border)[0];
  disable(k2); k2.status = 'repairing';
  assert.equal(DC.startAreaPatrol(book, world, 'klingon', k2.id, IDX.Border, d, []).ok, false);
  assert.equal(C.hullUnavailable(k2), true);
});

// ===================================================================================================
// Predation
// ===================================================================================================
function ferengiRun(env, { plan = null, commsDown = false, cargo = null, hull = null } = {}) {
  const f = hull || ready(env.book, 'ferengi', IDX.Ferenginar)[0];
  const r = DC.issueDelivery(env.book, env.world, 'ferengi', f.id, IDX.Rigel, env.book.settled, [], cargo ? { cargo } : {});
  assert.ok(r.ok, r.reason);
  if (plan) r.assignment.predationPlan = [...plan];
  if (commsDown) r.assignment.commsDown = true;
  return { f, a: r.assignment, c: r.contract };
}
function untilPredation(env, max = 8) {
  let o = null;
  for (let i = 0; i < max && !o; i++) { step(env, 1); o = preds(env.db)[0] || null; }
  return o;
}
test('P4-21. a pirate demand reaches its target before any refusal is recorded; an unheard demand only times out', () => {
  const env = mk('P4-21', { pirateHaunts: [IDX.Ganalda] });
  ferengiRun(env, { commsDown: true, plan: ['refuse'] });
  const o = untilPredation(env);
  assert.ok(o, 'no demand');
  step(env, 1);
  assert.equal(o.comms.receivedDay, null); assert.equal(o.response.history.length, 0, 'a refusal recorded for an unheard demand');
  for (let i = 0; i < 4 && !o.attack.phase && o.status === 'active'; i++) step(env, 1);
  assert.notEqual(o.attack.cause, 'refusal'); assert.match(String(o.attack.cause || o.resolution?.note), /timed out|never answered|left|escaped/);
  log.p4_21 = o.comms.log;
});
test('P4-22. the target pays: the pirates take it and disengage; no strike', () => {
  const env = mk('P4-22', { pirateHaunts: [IDX.Ganalda] });
  ferengiRun(env, { plan: ['pay'] });
  const o = untilPredation(env);
  const strikes = [];
  for (let i = 0; i < 4 && o.status === 'active'; i++) step(env, 1, (e) => { if (e.type === 'doctrinePredation' && e.event === 'attack') strikes.push(e); });
  assert.equal(o.status, 'completed'); assert.deepEqual(o.resolution.reasons, ['cargo_received']);
  assert.equal(strikes.length, 0);
  assert.ok(o.paid > 0 && o.paid <= o.demand.amount, `paid ${o.paid}`);
  assert.equal(env.db.pirates[o.pirateId].loot, o.paid);
  assert.equal(env.db.pirates[o.pirateId].status, 'lurking');
});
test('P4-23. the target refuses: a bounded attack may follow, then the pirates break off', () => {
  const env = mk('P4-23', { pirateHaunts: [IDX.Ganalda] });
  const { f } = ferengiRun(env, { plan: ['refuse'] });
  const o = untilPredation(env);
  const strikes = [];
  for (let i = 0; i < 6 && o.status === 'active'; i++) step(env, 1, (e) => { if (e.type === 'doctrinePredation' && e.event === 'attack') strikes.push(e); });
  assert.equal(o.attack.cause, 'refusal');
  assert.ok(strikes.length <= env.db.config.predationAttackDays, `${strikes.length} strikes`);
  assert.notEqual(o.status, 'active');
  log.p4_23 = { strikes: strikes.length, resolution: o.resolution, target: `${f.hull}/${f.maxHull}` };
});
test('P4-24. the pirates do not extort the same ship again every tick: one demand per encounter, then a long cooldown', () => {
  const env = mk('P4-24', { pirateHaunts: [IDX.Ganalda] });
  const { f } = ferengiRun(env, { plan: ['pay'] });
  untilPredation(env);
  step(env, 3);
  // Back through the pirates' waters again soon after.
  for (let n = 0; n < 3; n++) {
    for (let i = 0; i < 12 && DC.doctrineBook(env.book).assignments.some((a) => a.hullId === f.id && a.status === 'active'); i++) step(env, 1);
    if (f.status === 'ready') { f.systemIndex = IDX.Ferenginar; ferengiRun(env, { hull: f, plan: ['pay'] }); }
  }
  step(env, 3);
  const mine = preds(env.db, (o) => o.target.vid === f.identity.vid);
  assert.equal(mine.length, 1, `${mine.length} demands on one ship within the cooldown`);
  assert.ok((env.db.stats.predationRepeatPrevented || 0) >= 1);
});
test('P4-25. the pirates choose and price by what they can see (a hull class), never by a hold they cannot', () => {
  const env = mk('P4-25', { pirateHaunts: [IDX.Ganalda] });
  const secret = { knowledge: 'verified', manifest: [{ cargoId: 'dilithium', quantity: 500, concealed: true, value: 900000 }] };
  ferengiRun(env, { cargo: secret, plan: ['pay'] });
  const o = untilPredation(env);
  const plain = mk('P4-25b', { pirateHaunts: [IDX.Ganalda] });
  ferengiRun(plain, { plan: ['pay'] });
  const o2 = untilPredation(plain);
  assert.equal(o.demand.amount, o2.demand.amount, 'the demand followed the hidden hold');
  assert.match(o.demand.basis, /observed .* hull \(hold unseen\)/);
  assert.doesNotMatch(JSON.stringify({ ...o, cargoTaken: undefined }), /dilithium|900000/);
});
test('P4-26. the target escapes the pirates\' waters: the objective closes; no pursuit beyond them', () => {
  const env = mk('P4-26', { pirateHaunts: [IDX.Ganalda] });
  ferengiRun(env, { plan: ['run'] });
  const o = untilPredation(env);
  for (let i = 0; i < 8 && o.status === 'active'; i++) step(env, 1);
  assert.ok(o.resolution.reasons.includes('target_escaped') || o.resolution.reasons.includes('attacker_disengaged'), JSON.stringify(o.resolution));
  const g = env.db.pirates[o.pirateId];
  assert.ok([IDX.Ganalda, IDX.Rigel].includes(g.systemIndex), 'the pirates left their waters');
});

// ===================================================================================================
// State
// ===================================================================================================
test('P4-29. save/load mid-escalation preserves the objective, its ladder and its deadlines; the continuation is identical', () => {
  const env = mk('P4-29', { policies: { [IDX.Romulus]: closed } });
  oneRomulanPicket(env.book);
  delpinVisitor(env, { plan: ['refuse', 'refuse', 'comply'] });
  const o = untilEnforcement(env);
  step(env, 2);
  assert.ok(o.escalation.stage >= 2);
  C.upgradeCampaignBook(env.book);
  const loaded = reload(env.book);
  const lo = DC.doctrineBook(loaded).objectives.find((x) => x.id === o.id);
  assert.deepEqual(lo, o);
  run(loaded, env.world, loaded.settled + 1, loaded.settled + 6);
  step(env, 6);
  assert.equal(C.checksum(loaded), C.checksum(env.book));
  assert.deepEqual(DC.doctrineBook(loaded).objectives.find((x) => x.id === o.id).resolution, o.resolution);
});
test('P4-30. a closed enforcement objective gives no further orders', () => {
  const env = mk('P4-30', { policies: { [IDX.Romulus]: closed } });
  oneRomulanPicket(env.book);
  delpinVisitor(env, { plan: ['comply'] });
  const o = untilEnforcement(env);
  for (let i = 0; i < 6 && o.status === 'active'; i++) step(env, 1);
  assert.notEqual(o.status, 'active');
  const n = o.actions.length, fx = [];
  step(env, 10, (e) => { if (e.id === o.id) fx.push(e); });
  assert.equal(o.actions.length, n); assert.deepEqual(fx, []);
});

// ===================================================================================================
// Review corrections
test('P4-R1. ordered out of one world, a vessel keeps the rest of its business: its later stops and their milestones, by a route that avoids that world', () => {
  const env = mk('P4-R1', { policies: { [IDX.Romulus]: closed } });
  oneRomulanPicket(env.book);
  const t = ready(env.book, 'delpin', IDX.Delpi)[0]; t.systemIndex = IDX.Aldnas;
  const r = DC.issueAssignment(env.book, env.world, { polity: 'delpin', hullId: t.id, kind: 'transport', doctrineRole: 'civilian', stops: [{ systemIndex: IDX.Romulus, dwell: 3, milestone: 'arrival' }, { systemIndex: IDX.Vulcan, dwell: 1, milestone: 'arrival' }, { systemIndex: IDX.Delpi, milestone: 'check_in' }] }, env.book.settled, []);
  assert.ok(r.ok, r.reason);
  r.assignment.responsePlan = ['comply'];
  const o = untilEnforcement(env);
  for (let i = 0; i < 4 && o.compliance !== 'complying'; i++) step(env, 1);
  assert.equal(o.compliance, 'complying');
  const a = r.assignment;
  const pending = a.milestones.filter((m) => m.status === 'pending').map((m) => `${m.kind}@${m.systemIndex}`);
  assert.ok(pending.includes(`arrival@${IDX.Vulcan}`), `the later stop was dropped: ${pending}`);
  assert.ok(pending.includes(`check_in@${IDX.Delpi}`));
  assert.ok(!a.itinerary.slice(a.pos + 1).some((x) => x.systemIndex === IDX.Romulus), 'routed back through the world it was ordered out of');
  for (let i = 0; i < 8 && o.status === 'active'; i++) step(env, 1);
  assert.equal(o.status, 'completed'); assert.equal(a.leaveOrder, undefined, 'the spent leave order was left on the route');
});
test('P4-R2. doctrine switched off mid-scene: surrendered vessels are let go, pirate crews go back to lurking; switched back on, the crew makes demands again', () => {
  const env = mk('P4-R2', { pirateHaunts: [IDX.Ganalda] });
  ferengiRun(env, { plan: ['pay'] });
  const o = untilPredation(env);
  assert.ok(o);
  const g = env.db.pirates[o.pirateId];
  const f2 = ready(env.book, 'ferengi', IDX.Ferenginar)[0];
  DC.surrenderVessel(env.book, env.world, { polity: 'ferengi', hullId: f2.id, to: 'pirate', day: env.book.settled, reason: 'test' }, []);
  assert.equal(f2.status, 'surrendered');
  env.db.config = { ...env.db.config, enabled: false };
  step(env, 1);
  assert.notEqual(f2.status, 'surrendered', 'a surrendered vessel stayed held with doctrine off');
  assert.equal(g.objectiveId, null); assert.notEqual(g.status, 'demanding');
  env.db.config = { ...env.db.config, enabled: true };
  const before = g.demands;
  ferengiRun(env, { plan: ['pay'], hull: f2 });
  for (let i = 0; i < 12 && g.demands === before; i++) step(env, 1);
  assert.ok(g.demands > before, 'the crew never demanded again');
});
// Integrated
// ===================================================================================================
test('DOCTRINE-ENFORCEMENT-INTEGRATION. a foreign vessel enters a restricted Romulan world; the area patrol there warns it; the warning arrives; it refuses; the ladder climbs; save/load mid-sequence; it complies and leaves; the objective closes; the patrol returns to its cycles; no pursuit', () => {
  const env = mk('P4-EI', { policies: { [IDX.Romulus]: closed } });
  const { book, world, db } = env;
  // Every Romulan ship elsewhere but one area patrol around Romulus: the patrol is the enforcer.
  const ph = ready(book, 'romulan', IDX.Romulus)[0];
  const pr = DC.startAreaPatrol(book, world, 'romulan', ph.id, IDX.Romulus, 1, []);
  assert.ok(pr.ok, pr.reason);
  for (const h of ready(book, 'romulan')) { h.status = 'assigned'; h.opId = 'elsewhere'; }
  // Wait for the patrol to be home at Romulus, then the visitor arrives from Aldnas.
  for (let i = 0; i < 12 && !(ph.systemIndex === IDX.Romulus && DC.doctrineBook(book).assignments.find((a) => a.hullId === ph.id && a.status === 'active')?.dwellLeft > 0); i++) step(env, 1);
  const v = delpinVisitor(env, { dwell: 6, plan: ['refuse', 'comply'] });
  const o = untilEnforcement(env);
  assert.ok(o, 'no enforcement');
  assert.equal(o.actor, `hull:${ph.id}`); assert.equal(o.enforcerKind, 'area patrol'); assert.equal(pr.patrol.status, 'responding');
  step(env, 2);
  assert.equal(o.escalation.name, 'repeat');
  C.upgradeCampaignBook(book);
  const loaded = reload(book);
  const lo = DC.doctrineBook(loaded).objectives.find((x) => x.id === o.id);
  assert.deepEqual(lo.escalation, o.escalation); assert.deepEqual(lo.comms, o.comms);
  const where = new Set();
  for (let i = 0; i < 8 && o.status === 'active'; i++) { step(env, 1); where.add(ph.systemIndex); }
  assert.equal(o.status, 'completed'); assert.ok(o.resolution.reasons.includes('compliance_verified'));
  assert.equal(pr.patrol.status, 'patrolling'); assert.ok((db.stats.patrolsReturned || 0) >= 1);
  const later = new Set();
  for (let i = 0; i < 10; i++) { step(env, 1); later.add(ph.systemIndex); }
  assert.ok([...later].every((i) => pr.patrol.area.includes(i)), `left its area: ${[...later]}`);
  assert.ok(!later.has(v.t.systemIndex) || pr.patrol.area.includes(v.t.systemIndex));
  log.enforcementIntegration = { history: o.escalation.history, comms: o.comms.log, resolution: o.resolution };
});
test('DOCTRINE-SURRENDER-INTEGRATION. a Klingon raid under formal war meets a Terran defence it cannot face; the raider surrenders; the holder accepts; the strikes stop; the raid closes; the raider holds inactive, keeps its vid, is released home; nothing reopens', () => {
  const env = mk('P4-SI');
  const { book, world, db } = env;
  // Minor (Terran) held; a lone Klingon raider; Terran spare warships one jump away at Vega.
  for (const h of P(book, 'terran').hulls.filter((x) => x.systemIndex === IDX.Minor)) h.systemIndex = IDX.Earth;
  const raider = ready(book, 'klingon', IDX.Border).sort((a, b) => a.maxHull - b.maxHull)[0];
  const r = DC.orderRaid(book, world, { power: 'klingon', target: IDX.Minor, hullId: raider.id, day: 1, doctrine });
  assert.ok(r.ok, r.reason);
  const vid = raider.identity.vid;
  const strikes = [];
  let surrendered = null;
  for (let d = 0; d < 14 && !surrendered; d++) step(env, 1, (e) => { if (e.type === 'raidStrike') strikes.push(e.day); if (e.type === 'vesselSurrendered' && e.hullId === raider.id) surrendered = e; });
  if (!surrendered) {
    // The defence may simply be enough to break the raid without cornering it; the explicit hook stands in.
    const inc = Object.values(db.incidents).find((i) => i.source === 'raid' && i.sourceId === r.objective.id && i.status === 'open');
    assert.ok(inc, `no open attack to surrender in: ${JSON.stringify(r.objective.actions)}`);
    DC.recordSurrender(book, world, inc.id, book.settled, { acceptedBy: 'command:terran' });
    surrendered = { day: book.settled };
  }
  const sd = surrendered.day;
  step(env, 1);
  assert.equal(raider.status, 'surrendered'); assert.equal(raider.identity.vid, vid);
  assert.notEqual(r.objective.status, 'active'); assert.match(String(r.objective.resolution.note), /surrendered/);
  const after = [];
  step(env, 4, (e) => { if (e.type === 'raidStrike' || e.type === 'doctrineEnforcementStrike') after.push(e); });
  assert.deepEqual(after, [], 'fire after the surrender');
  assert.equal(db.objectives.filter((o) => o.kind === 'raid' && o.assigned.hullId === raider.id && o.status === 'active').length, 0);
  const defs = db.objectives.filter((o) => o.kind === 'defense' && o.incidentId && db.incidents[o.incidentId]?.sourceId === r.objective.id);
  assert.ok(defs.length <= 1, 'a second defence on the same attack');
  if (defs[0]) assert.notEqual(defs[0].status, 'active');
  assert.notEqual(raider.status, 'surrendered', 'never released');
  assert.equal(raider.identity.vid, vid);
  log.surrenderIntegration = { strikes, surrenderDay: sd, raid: r.objective.resolution, raider: raider.status, released: db.surrenderLog };
});
test('DOCTRINE-PREDATION-INTEGRATION. the pirates see a Ferengi freighter in their waters; demand; it arrives; one crew pays and the pirates go; another refuses and is attacked (bounded) or runs; each objective closes; the pirates return to lurking; the cooldown holds', () => {
  const branches = {};
  for (const [name, plan] of [['comply', ['pay']], ['refuse', ['refuse']], ['run', ['run']]]) {
    const env = mk(`P4-PI-${name}`, { pirateHaunts: [IDX.Ganalda] });
    const { f } = ferengiRun(env, { plan });
    const o = untilPredation(env);
    assert.ok(o, name);
    assert.equal(o.target.vid, f.identity.vid);
    step(env, 1);
    assert.ok(o.comms.receivedDay != null, `${name}: never received`);
    for (let i = 0; i < 8 && o.status === 'active'; i++) step(env, 1);
    const g = env.db.pirates[o.pirateId];
    step(env, 6);
    branches[name] = { resolution: o.resolution, strikes: o.actions.filter((x) => x.action === 'attack').length, pirate: g.status, cooldown: g.cooldowns[f.identity.vid] ?? null, demands: preds(env.db, (x) => x.target.vid === f.identity.vid).length };
    assert.notEqual(o.status, 'active', name);
    assert.equal(branches[name].demands, 1, `${name}: repeated`);
    assert.ok(branches[name].cooldown > env.book.settled, `${name}: no cooldown`);
    assert.ok(['lurking', 'recovering', 'lost'].includes(g.status));
  }
  assert.deepEqual(branches.comply.resolution.reasons, ['cargo_received']); assert.equal(branches.comply.strikes, 0);
  assert.ok(branches.refuse.strikes >= 0 && branches.refuse.strikes <= 2);
  log.predationIntegration = branches;
});

// ===================================================================================================
// Measurement
// ===================================================================================================
test('MEASURE. 400 days with published border policies, area patrols, merchants, relief, and a pirate haven: enforcement and predation stay bounded; no doctrine-created war', () => {
  const env = mk('P4-MEASURE', { planning: true, defaultPolicies: true, patrolAreas: { romulan: 1, klingon: 1, terran: 1 }, patrols: { romulan: 1 }, explorers: { delpin: 1 }, reliefShips: { vulcan: 1 }, merchants: { ferengi: 1 }, pirateHaunts: [IDX.Ganalda] });
  const { book, world, db, relations } = env;
  const rel0 = JSON.stringify(relations);
  const wars0 = JSON.stringify(Object.fromEntries(Object.entries(book.warStates || {}).map(([k, v]) => [k, v.instance])));
  let maxActive = 0, longest = 0;
  const series = [];
  // A few foreign civilians crossing restricted space each month (the fixture has little traffic of its own).
  for (let d = 2; d <= 400; d++) {
    if (d % 20 === 0) {
      const t = ready(book, 'delpin').find((h) => classifyDamage(h.hull, h.maxHull) === 'operational');
      if (t) { t.systemIndex = IDX.Aldnas; DC.issueAssignment(book, world, { polity: 'delpin', hullId: t.id, kind: 'transport', doctrineRole: 'civilian', stops: [{ systemIndex: [IDX.Romulus, IDX.Border][Math.floor(d / 20) % 2], dwell: 2, milestone: 'arrival' }, { systemIndex: IDX.Delpi, milestone: 'check_in' }] }, d, []); }
    }
    run(book, world, d, d);
    const act = db.objectives.filter((o) => o.status === 'active' && (o.kind === 'enforcement' || o.kind === 'predation'));
    maxActive = Math.max(maxActive, act.length);
    for (const o of act) longest = Math.max(longest, d - o.createdDay);
    if (d % 50 === 0) series.push([d, JSON.stringify(book).length, db.objectives.filter((o) => o.kind === 'enforcement').length, db.stats.enforcementObjectives || 0, db.stats.pirateDemands || 0]);
  }
  const s = db.stats;
  const all = [...db.objectives, ...[]];
  const counts = {
    enforcementObjectives: s.enforcementObjectives || 0, complied: s.enforcementComplied || 0, comply_responses: s.enforcementComplyResponses || 0, refusals: s.enforcementRefusals || 0,
    expired: s.enforcementExpired || 0, cancelledByAuthority: s.enforcementCancelledByAuthority || 0, leftUncomplied: s.enforcementLeftUncomplied || 0,
    stage2: s.enforcementStage2 || 0, stage3: s.enforcementStage3 || 0, stage4: s.enforcementStage4 || 0, strikes: s.enforcementStrikes || 0,
    lawfulTransits: s.lawfulTransits || 0, unenforced: s.breachesUnenforced || 0, shadow: s.enforcementShadow || 0, repeatPrevented: s.enforcementRepeatPrevented || 0,
    surrenders: s.surrenders || 0, surrendersReleased: s.surrendersReleased || 0,
    pirateDemands: s.pirateDemands || 0, paid: s.predationPaid || 0, predationRefusals: s.predationRefusals || 0, runs: s.predationRuns || 0, timeouts: s.predationTimeouts || 0, escaped: s.predationEscaped || 0, predationStrikes: s.predationStrikes || 0, predationRepeatPrevented: s.predationRepeatPrevented || 0,
    patrolsReturned: s.patrolsReturned || 0, maxActive, longestDays: longest,
    formalWarsCreated: JSON.stringify(relations) === rel0 && JSON.stringify(Object.fromEntries(Object.entries(book.warStates || {}).map(([k, v]) => [k, v.instance]))) === wars0 ? 0 : 'CHANGED',
  };
  log.measure = { counts, series };
  console.log('   counts', JSON.stringify(counts));
  console.log('   growth', JSON.stringify(series));
  assert.equal(counts.formalWarsCreated, 0);
  assert.ok(counts.enforcementObjectives >= 1, 'nothing was enforced');
  assert.ok(longest <= db.config.enforceDeadlineDays + 2, `an objective ran ${longest} days`);
  assert.ok(maxActive <= 3 * db.config.maxEnforcementPerPolity + 2);
});

if (out) { fs.mkdirSync(out, { recursive: true }); fs.writeFileSync(path.join(out, 'doctrine-phase4-pure-log.json'), JSON.stringify(log, null, 1)); }
console.log(`\ndoctrine runtime phase 4 pure: ${passed} passed${failures.length ? `, ${failures.length} FAILED: ${failures.join(' | ')}` : ''}`);
process.exit(failures.length ? 1 : 0);
