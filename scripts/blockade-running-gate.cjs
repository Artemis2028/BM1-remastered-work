// Gate for blockade interception and running, stacked on 4860070.
// Rules: docs/playtest/BLOCKADE-RUNNING-RULES-270100ZSEP26.md.
//
// One interception engine answers every runner — a formation crossing on its leg-by-leg route, a
// trader's passage, an evacuation convoy — from coverage, the blockade's real force, speed, cloak, escort
// strength and condition. Categories:
//   baseline-defect  fails on 4860070 because a blockade there was met and recorded but never intercepted
//   new-feature      needs a state 4860070 does not have
//   preservation     must hold on both
const assert = require('node:assert/strict');
const path = require('node:path');
const fs = require('node:fs');
const { startProbe } = require('./probe-harness.cjs');

(async () => {
  const probe = await startProbe({ pageOptions: { deviceScaleFactor: 2 } });
  const { ev, fresh, page } = probe;
  const out = process.env.BM1_TEST_OUTPUT || '/tmp';
  const results = [];
  const evidence = [];
  async function check(category, name, fn) {
    try { await fn(); results.push({ category, name, ok: true }); console.log('PASS', `[${category}]`, name); }
    catch (err) { results.push({ category, name, ok: false, message: String(err?.message || err).split('\n').slice(0, 6).join(' ') }); console.log('FAIL', `[${category}]`, name, '\n      ', String(err?.message || err).split('\n').slice(0, 8).join(' ')); }
  }
  const shot = (name) => page.screenshot({ path: path.join(out, name) });

  await page.evaluate(() => {
    const t = testBM1;
    window.__adv = (n) => { for (let i = 0; i < n; i++) t.advanceFleetCalendar(1, t.Fleet.nextId(t.fleetBook(), 'journey')); };
    window.__idx = (name) => t.getSystemIndexByName(name);
    window.__ship = (id, at, shipId = 215, hull = 600) => {
      t.state.playerFleet.push({ id, shipId: Number(shipId), name: id, systemIndex: at, assignment: 'defense', destroyed: false, vessel: { hull, maxHull: hull, condition: 'operational' } });
      return id;
    };
    window.__f = (id) => t.state.playerFleet.find((f) => f.id === id);
    window.__vid = (id) => t.ensureFleetVesselIdentity(window.__f(id)).vid;
    // A formation of the given ships (ids), standing where they are.
    window.__formation = (name, ids) => {
      const b = t.fleetBook();
      const g = t.Fleet.addFormation(b, name);
      for (const id of ids) t.Fleet.assignFormation(b, id, g.id);
      return g.id;
    };
    window.__g = (id) => t.fleetBook().formations.find((g) => g.id === id);
    window.__members = (gid) => window.__g(gid).members.map((m) => window.__f(m)).filter(Boolean);
    window.__where = (gid) => window.__members(gid).map((f) => [Number(f.systemIndex), f.transit ? Number(f.transit.to) : null, f.assignment, f.vessel?.condition || 'operational']);
    // An AI blockade through the model's own entry point, with the power's real hulls moved alongside.
    window.__aiBlockade = (power, target, n, purpose = 'interdict_trade') => {
      const book = t.campaign();
      t.syncPlayerPolity(book);
      const hulls = book.polities[power].hulls.filter((h) => h.status === 'ready' && !h.opId).slice(0, n);
      for (const h of hulls) h.systemIndex = target;
      const fx = [];
      const r = t.Campaign.startBlockade(book, t.buildCampaignWorld(true), { power, target, hullIds: hulls.map((h) => h.id), purpose }, t.state.day, fx);
      t.applyCampaignEffects(fx, t.state.day);
      return r.ok ? r.record.id : r.reason;
    };
    window.__block = (id) => (t.campaign().blockades || []).find((b) => b.id === id);
    window.__Q = (name) => { const i = t.getSystemIndexByName(name); if (t.getSystemControl(i).controller !== 'player') { t.transferSystemControlToPlayer(i); t.markSystemVisited(i); } return i; };
    window.__runsOf = (b, prefix) => (b.runs || []).filter((x) => String(x.by).startsWith(prefix));
  });

  // A route with a blockade on an intermediate system: Earth → Alpha Centauri → Paso → Ferenginar,
  // the Klingons blockading Paso (C).
  const R = { A: 'Earth', B: 'Alpha Centauri', C: 'Paso', D: 'Ferenginar' };

  // 1 ---------------------------------------------------------------------------------------------
  await check('baseline-defect', 'INTERCEPTS a heavy blockade at C actually intercepts slow unescorted runners crossing it: some are turned back or hurt; on 4860070 every one passed untouched', async () => {
    await fresh('br-intercepts');
    const r = await ev((R) => {
      const t = testBM1;
      const [A, , C, D] = [R.A, R.B, R.C, R.D].map(window.__idx);
      t.markSystemVisited(C);
      const id = window.__aiBlockade('klingon', C, 28);
      const groups = [];
      for (let k = 0; k < 8; k++) { const gid = window.__formation(`Runner ${k}`, [window.__ship(`run${k}`, A, 215, 600)]); window.__g(gid).destination = D; t.dispatchFleetFormation(gid); groups.push(gid); }
      window.__adv(40);
      const res = groups.map((gid) => { const g = window.__g(gid); const enc = (g.travel?.encounters || []).filter((e) => e.system === C); return { enc: enc.map((e) => e.outcome ?? 'passed-unrecorded'), hull: window.__members(gid).map((f) => f.vessel.hull)[0] ?? null, where: window.__where(gid)[0]?.[0] ?? null, status: g.travel?.status }; });
      const b = window.__block(id);
      return { C, D, tier: t.Campaign.blockadeTier(b.coverage), res, interceptions: t.campaign().stats.interceptions ?? null };
    }, R);
    evidence.push({ check: 'INTERCEPTS', ...r });
    assert.equal(r.tier, 'heavy', 'precondition: the blockade is not heavy');
    const met = r.res.filter((x) => x.enc.length);
    assert.ok(met.length >= 6, `only ${met.length} runners reached C`);
    // 4860070 recorded the encounter with no outcome at all and let every runner through untouched.
    const stopped = met.filter((x) => x.hull < 600 || x.enc.some((o) => !['slipped_through', 'challenged_but_passed', 'fought_through', 'intercepted_minor_damage', 'blockade_broken', 'passed-unrecorded'].includes(o)));
    assert.ok(stopped.length > 0, `every runner went through a heavy blockade: ${JSON.stringify(r.res)}`);
    assert.ok(r.interceptions > 0, 'the interception engine never ran');
  });

  // 2 ---------------------------------------------------------------------------------------------
  await check('new-feature', 'NO-BLOCKADE-NO-RUN with no blockade on the route, no interception runs and the journey is exactly as before', async () => {
    await fresh('br-none');
    const r = await ev((R) => {
      const t = testBM1;
      const [A, , , D] = [R.A, R.B, R.C, R.D].map(window.__idx);
      const gid = window.__formation('Quiet', [window.__ship('q0', A, 215), window.__ship('q1', A, 215)]);
      window.__g(gid).destination = D;
      t.dispatchFleetFormation(gid);
      window.__adv(40);
      const g = window.__g(gid);
      return { n: t.campaign().stats.interceptions || 0, status: g.travel.status, encounters: g.travel.encounters.length, where: window.__where(gid) };
    }, R);
    assert.equal(r.n, 0); assert.equal(r.encounters, 0); assert.equal(r.status, 'arrived');
  });

  // 3 ---------------------------------------------------------------------------------------------
  await check('new-feature', 'CLASS-FACTS the engine reads real class facts: dash speed, a fitted cloak (the Romulan freighter), fighting value (warship vs hauler)', async () => {
    await fresh('br-class');
    const r = await ev(() => {
      const t = testBM1;
      return { tarellian: [t.shipRunSpeed(215), t.shipClassCloak(215), t.shipClassCombat(215)], romulanFreighter: [t.shipRunSpeed(277), t.shipClassCloak(277), t.shipClassCombat(277)],
        kaplan: [t.shipRunSpeed(291), t.shipClassCloak(291), t.shipClassCombat(291)], sovereign: [t.shipRunSpeed(329), t.shipClassCloak(329), t.shipClassCombat(329)], birdOfPrey: [t.shipRunSpeed(217), t.shipClassCloak(217), t.shipClassCombat(217)],
        world: t.buildCampaignWorld().shipStats(277) };
    });
    evidence.push({ check: 'CLASS-FACTS', ...r });
    assert.deepEqual(r.tarellian.slice(1), [false, 0]);
    assert.equal(r.romulanFreighter[1], true); assert.ok(r.romulanFreighter[2] < 0.5);
    assert.ok(r.kaplan[0] > r.tarellian[0] * 2, 'the Kaplan is not the fast freighter');
    assert.equal(r.sovereign[2], 1); assert.equal(r.birdOfPrey[1], true);
    assert.equal(r.world.cloak, true); assert.ok(r.world.speed > 0);
  });

  // 4 ---------------------------------------------------------------------------------------------
  await check('new-feature', 'DAMAGE-MODEL a run\'s damage lands on the same persistent vessel through the fleet damage model: disabled stops her under §6 where it happened; destroyed retires her vid; nothing is re-created', async () => {
    await fresh('br-damage');
    const r = await ev((R) => {
      const t = testBM1, s = t.state;
      const C = window.__idx(R.C);
      window.__ship('dmgA', C, 215, 600); window.__ship('dmgB', C, 215, 600);
      const vidA = window.__vid('dmgA'), vidB = window.__vid('dmgB');
      const count = s.playerFleet.length;
      t.ensureFleetTradeState(window.__f('dmgA'), 'any').active = true;
      // The engine's result for a run: one hull pushed into the disabled band, one destroyed.
      const run = { hulls: [{ hullId: 'pf:dmgA', vid: vidA, before: 600, hull: 20, maxHull: 600, condition: 'disabled' }, { hullId: 'pf:dmgB', vid: vidB, before: 600, hull: 0, maxHull: 600, condition: 'destroyed' }] };
      const res = t.applyRunToFleet(run, C);
      const a = window.__f('dmgA'), b = window.__f('dmgB');
      const retired = t.fleetBook().retiredVessels || t.fleetBook().vesselRegistry || null;
      return { vidA, vidB, count, after: s.playerFleet.length, aCond: a.vessel.condition, aClass: t.Fleet.classifyDamage(a.vessel.hull, a.vessel.maxHull), aAt: a.systemIndex, aLine: t.fleetTradeStatusLine(a), aTrade: { active: a.trade.active, stage: a.trade.stage, disabledAt: a.trade.disabledAt, resume: a.trade.resumeTrade },
        bDestroyed: b.destroyed, bVid: t.ensureFleetVesselIdentity(b).vid, same: s.playerFleet.filter((f) => f.id === 'dmgA').length, lost: res.lost.length, disabled: res.disabled.length, C,
        found: t.findStrategicVessel ? Boolean(t.findStrategicVessel(vidB)) : null, prov: t.findStrategicVessel ? t.findStrategicVessel(vidB)?.status ?? t.findStrategicVessel(vidB)?.record?.status ?? null : null };
    }, R);
    evidence.push({ check: 'DAMAGE-MODEL', ...r });
    assert.equal(r.aCond, 'disabled'); assert.equal(r.aClass, 'disabled');
    assert.equal(r.aAt, r.C); assert.match(r.aLine, /Disabled/);
    assert.equal(r.aTrade.active, false); assert.equal(r.aTrade.resume, true, 'trading she was doing is not remembered (§6)'); assert.equal(r.aTrade.disabledAt, r.C);
    assert.equal(r.bDestroyed, true); assert.equal(r.bVid, r.vidB);
    assert.equal(r.after, r.count, 'a vessel record was added or removed'); assert.equal(r.same, 1);
    assert.equal(r.lost, 1); assert.equal(r.disabled, 1);
  });

  // 5 ---------------------------------------------------------------------------------------------
  await check('new-feature', 'FORMATION-IDENTITY a formation that runs the blockade keeps its vessels: same records, same vids, one position for all of them every day, never on both sides of it', async () => {
    await fresh('br-identity');
    const r = await ev((R) => {
      const t = testBM1;
      const [A, B, C, D] = [R.A, R.B, R.C, R.D].map(window.__idx);
      t.markSystemVisited(C);
      window.__aiBlockade('klingon', C, 3);
      const ids = [window.__ship('id0', A, 329, 2000), window.__ship('id1', A, 329, 2000), window.__ship('id2', A, 215, 600)];
      const vids = ids.map(window.__vid);
      const objs = ids.map(window.__f);
      const gid = window.__formation('Screen', ids);
      window.__g(gid).destination = D;
      t.dispatchFleetFormation(gid);
      const split = [];
      for (let d = 0; d < 45 && window.__g(gid).travel.status === 'underway'; d++) {
        window.__adv(1);
        const g = window.__g(gid);
        const pos = new Set(g.travel.members.map((m) => { const f = window.__f(m); return JSON.stringify([f.systemIndex, f.transit?.to ?? null]); }));
        if (pos.size > 1) split.push([t.state.day, [...pos]]);
      }
      const g = window.__g(gid);
      const enc = g.travel.encounters.filter((e) => e.system === C);
      return { vids, after: ids.map(window.__vid), same: objs.every((f, i) => t.state.playerFleet.includes(f) && f.id === ids[i]), split, enc: enc.map((e) => e.outcome), status: g.travel.status, at: window.__where(gid).map((w) => w[0]), D };
    }, R);
    evidence.push({ check: 'FORMATION-IDENTITY', ...r });
    assert.ok(r.enc.length >= 1, 'the formation never met the blockade');
    assert.deepEqual(r.after, r.vids); assert.ok(r.same);
    assert.deepEqual(r.split, [], `the formation was in two places: ${JSON.stringify(r.split)}`);
  });

  // 6 ---------------------------------------------------------------------------------------------
  await check('new-feature', 'FORCED-BACK a formation turned back at C goes back to B as one body — none of it beyond C — keeps the order it was given, and is reported', async () => {
    await fresh('br-forced');
    const r = await ev((R) => {
      const t = testBM1;
      const [A, B, C, D] = [R.A, R.B, R.C, R.D].map(window.__idx);
      t.markSystemVisited(C);
      window.__aiBlockade('klingon', C, 28);
      // Several slow single-freighter formations, so at least one is turned back.
      const gids = [];
      for (let k = 0; k < 8; k++) { const gid = window.__formation(`Hauler ${k}`, [window.__ship(`h${k}`, A, 215, 600), window.__ship(`h${k}b`, A, 215, 600)]); window.__g(gid).destination = D; t.dispatchFleetFormation(gid); gids.push(gid); }
      window.__adv(45);
      const back = gids.map((gid) => window.__g(gid)).filter((g) => g.travel.retreatFrom === C || g.travel.encounters.some((e) => e.system === C && ['intercepted_forced_back', 'intercepted_losses'].includes(e.outcome)));
      const x = back[0];
      if (!x) return { none: true };
      const members = x.members.map(window.__f).filter((f) => !f.destroyed && f.vessel.condition === 'operational');
      const reports = t.galaxyNewsBook().items.filter((i) => String(i.id).startsWith('blockade-run:')).map((i) => i.kind);
      return { B, C, D, status: x.travel.status, retreatFrom: x.travel.retreatFrom, dest: x.travel.destination, line: t.formationTravelLine(x), at: members.map((f) => [f.systemIndex, f.transit?.to ?? null]), beyond: x.travel.crossed.some((c) => c.system === D), reports };
    }, R);
    evidence.push({ check: 'FORCED-BACK', ...r });
    assert.ok(!r.none, 'no formation was turned back in eight tries against a heavy blockade');
    assert.equal(r.retreatFrom, r.C); assert.equal(r.dest, r.B);
    for (const w of r.at) assert.deepEqual(w, [r.B, null], `a member is not back at B: ${JSON.stringify(r.at)}`);
    assert.equal(r.beyond, false);
    assert.match(r.line, /Turned back at Paso/);
    assert.ok(r.reports.some((k) => /Blockade run failed — Paso/.test(k)), `reports ${r.reports}`);
  });

  // 7 ---------------------------------------------------------------------------------------------
  await check('new-feature', 'SAVELOAD-SEEDED a save made before the crossing gives exactly the same run after reloading: same outcome, same hulls, same blockade', async () => {
    const once = async (reload) => { await fresh('br-seeded'); return ev(([R, reload]) => {
      const t = testBM1;
      const [A, B, C, D] = [R.A, R.B, R.C, R.D].map(window.__idx);
      t.markSystemVisited(C);
      const id = window.__aiBlockade('klingon', C, 20);
      const gid = window.__formation('Seeded', [window.__ship('s0', A, 215, 600), window.__ship('s1', A, 215, 600), window.__ship('s2', A, 4, 1400)]);
      window.__g(gid).destination = D;
      t.dispatchFleetFormation(gid);
      window.__adv(12); // in warp towards C
      if (reload) { t.saveGame(6); t.startWithFaction('ferengi'); t.loadGame(6); }
      window.__adv(15);
      const g = t.fleetBook().formations.find((x) => x.name === 'Seeded');
      const b = window.__block(id);
      return JSON.stringify({ enc: g.travel.encounters.concat(g.lastTravel?.encounters || []).map((e) => [e.system, e.day, e.outcome, e.force]), hulls: ['s0', 's1', 's2'].map((x) => window.__f(x).vessel?.hull), block: [b.status, b.hulls.length, b.coverage], travel: [g.travel.status, g.travel.destination] });
    }, [R, reload]); };
    const a = await once(false), b = await once(true);
    evidence.push({ check: 'SAVELOAD-SEEDED', a: JSON.parse(a), b: JSON.parse(b) });
    assert.ok(JSON.parse(a).enc.length >= 1, 'no crossing of C in the window');
    assert.equal(b, a);
  });

  // 8 ---------------------------------------------------------------------------------------------
  await check('new-feature', 'CEASEFIRE-BEFORE a ceasefire signed while the formation is in warp towards C: the blockade no longer bears on it and nothing intercepts it at C', async () => {
    await fresh('br-cease');
    const r = await ev((R) => {
      const t = testBM1;
      const [A, B, C, D] = [R.A, R.B, R.C, R.D].map(window.__idx);
      t.markSystemVisited(C);
      const id = window.__aiBlockade('klingon', C, 28);
      const gid = window.__formation('Late', [window.__ship('l0', A, 215, 600)]);
      window.__g(gid).destination = D;
      t.dispatchFleetFormation(gid);
      window.__adv(12);
      const n0 = t.campaign().stats.interceptions || 0;
      t.applyCampaignEffects(t.Campaign.forceWarTransition(t.campaign(), t.buildCampaignWorld(true), 'player', 'klingon', 'ceasefire', t.state.day, 'gate ceasefire'), t.state.day);
      window.__adv(30);
      const g = window.__g(gid);
      const b = window.__block(id);
      return { block: b.status, applies: t.Campaign.blockadeApplies(t.campaign(), t.buildCampaignWorld(true), b, 'player'), n: (t.campaign().stats.interceptions || 0) - n0, enc: g.travel.encounters.length, status: g.travel.status, crossedC: g.travel.crossed.some((c) => c.system === C) };
    }, R);
    evidence.push({ check: 'CEASEFIRE-BEFORE', ...r });
    // The blockade is the Klingon–Terran war's (Paso is a Terran world): it may stand, but it no longer
    // bears on the captain's ships, whose own war with the Klingons is in ceasefire.
    assert.equal(r.applies, false, 'the blockade still bears on the captain after his ceasefire');
    assert.equal(r.crossedC, true, 'precondition: it never reached C');
    assert.equal(r.n, 0, 'an interception fired under a closed blockade'); assert.equal(r.enc, 0); assert.equal(r.status, 'arrived');
  });

  // 9 ---------------------------------------------------------------------------------------------
  await check('new-feature', 'INTEL-OBSERVED a run updates what the captain knows by what was seen — a range on contact, never the hidden count — and it survives save/load; the Operations card shows no more', async () => {
    await fresh('br-intel');
    const r = await ev((R) => {
      const t = testBM1;
      const [A, B, C, D] = [R.A, R.B, R.C, R.D].map(window.__idx);
      t.markSystemVisited(C);
      const id = window.__aiBlockade('klingon', C, 20);
      const b0 = window.__block(id);
      const before = t.blockadeKnowledge(b0);
      const gid = window.__formation('Scout', [window.__ship('sc0', A, 215, 600)]);
      window.__g(gid).destination = D;
      t.dispatchFleetFormation(gid);
      let guard = 0;
      while (!(window.__g(gid).travel.encounters || []).length && guard++ < 40) window.__adv(1);
      // Away from C (turned back or gone on), nothing of his on station there.
      window.__adv(12);
      const b = window.__block(id);
      const k = t.blockadeKnowledge(b);
      const seen = t.blockadeSighting(b);
      const cardHtml = () => { t.openCampaignPanel('strategic'); const el = document.querySelector(`[data-ops-blockade="${id}"]`); const txt = el?.textContent || ''; t.closeCampaignPanel(); return txt; };
      const card = cardHtml();
      const real = b.hulls.length;
      t.saveGame(7); t.startWithFaction('ferengi'); t.loadGame(7);
      const k2 = t.blockadeKnowledge(window.__block(id));
      const onStation = t.state.playerFleet.filter((f) => !f.destroyed && !f.transit && Number(f.systemIndex) === C).length;
      return { before, k, k2, seen, card, real, onStation };
    }, R);
    evidence.push({ check: 'INTEL-OBSERVED', ...r });
    assert.ok(!r.before || r.before.source !== 'sighting');
    assert.ok(r.seen, 'nothing was recorded of what the crews saw');
    assert.deepEqual(r.k2, r.k, 'the knowledge changed across save/load');
    if (r.onStation === 0) {
      assert.equal(r.k.source, 'sighting');
      if (r.seen.level !== 'engaged') {
        assert.equal(r.k.exact, false);
        assert.ok(!new RegExp(`Force: ${r.real} ship`).test(r.card), `the card shows the hidden count: ${r.card}`);
        if (r.seen.level === 'contact') assert.match(r.card, /Known force: \d+–\d+ ships/);
        if (r.seen.level === 'sighted') assert.doesNotMatch(r.card, /Known force/i); // ("Reinforcements …" in the effects list is not a force count)
      }
    }
    assert.match(r.card, /Seen by your ships day \d+/);
  });

  // 10 --------------------------------------------------------------------------------------------
  await check('new-feature', 'POLICY-WAIT-REROUTE a formation told to wait holds short of a known blockade until it lifts; one told to reroute goes round it; one told to run runs it', async () => {
    await fresh('br-policy');
    const r = await ev((R) => {
      const t = testBM1;
      // Earth → Alpha Centauri → Sato → Trey; the Klingons blockade Alpha Centauri and the captain knows
      // of it. The way round is by Epsilon.
      const A = window.__idx('Earth'), V = window.__idx('Trey'), O = window.__idx('Alpha Centauri');
      t.markSystemVisited(O);
      const id = window.__aiBlockade('klingon', O, 18);
      const known = Boolean(t.blockadeKnowledge(window.__block(id)));
      const mk = (name, policy) => { const gid = window.__formation(name, [window.__ship(`${name}0`, A, 215, 600)]); const g = window.__g(gid); g.destination = V; t.setFormationBlockadePolicy(gid, policy); t.dispatchFleetFormation(gid); return gid; };
      const wait = mk('Waiter', 'wait'), reroute = mk('Router', 'reroute'), run = mk('Runner', 'run');
      window.__adv(5);
      const snap = (gid) => { const g = window.__g(gid); return { waiting: g.travel.waiting || null, path: g.travel.path, line: t.formationTravelLine(g), at: window.__where(gid)[0] }; };
      const early = { wait: snap(wait), reroute: snap(reroute), run: snap(run) };
      t.openCampaignPanel('strategic');
      const rows = [...document.querySelectorAll('[data-ops-formation]')].map((el) => el.textContent);
      t.closeCampaignPanel();
      // The runner reaches Alpha Centauri (day 10), then the blockade lifts and the waiter goes on.
      window.__adv(8);
      t.Campaign.withdrawBlockade(t.campaign(), t.buildCampaignWorld(true), id, t.state.day, []);
      // Until the waiter has flown its three legs at its own 0.8× after the lift (a fixed 40 days assumed the
      // chart's 1.0×; SHIP-DEPENDENT-STRATEGIC-SPEED), bounded.
      window.__adv(40);
      for (let k = 0; k < 40 && window.__g(wait).travel.status === 'underway'; k++) window.__adv(1);
      const late = { wait: snap(wait), waitStatus: window.__g(wait).travel.status, waitCrossed: window.__g(wait).travel.crossed.map((c) => c.system), rerouteCrossed: window.__g(reroute).travel.crossed.map((c) => c.system), runEnc: window.__g(run).travel.encounters.map((e) => e.system) };
      return { O, V, A, known, early, late, rows };
    }, R);
    evidence.push({ check: 'POLICY-WAIT-REROUTE', ...r });
    assert.ok(r.known, 'precondition: the captain does not know of the blockade');
    assert.ok(r.early.wait.waiting, `the waiter did not wait: ${JSON.stringify(r.early.wait)}`);
    assert.equal(r.early.wait.at[0], r.A); assert.match(r.early.wait.line, /waiting at Earth/);
    assert.ok(!r.early.reroute.path.includes(r.O), `the rerouted formation still goes through the blockade: ${r.early.reroute.path}`);
    assert.ok(!r.late.rerouteCrossed.includes(r.O));
    assert.ok(r.late.runEnc.includes(r.O), 'the runner did not run the blockade');
    assert.equal(r.late.waitStatus, 'arrived'); assert.ok(r.late.waitCrossed.includes(r.O));
    assert.ok(r.rows.some((x) => /Run blockade/.test(x) && /Wait/.test(x) && /Reroute/.test(x)), 'no run / wait / reroute controls in Operations');
  });

  // 11 --------------------------------------------------------------------------------------------
  await check('new-feature', 'TRADER-RUN a trader\'s passage through a blockaded system runs it through the same engine: the run is on the blockade\'s record under her key', async () => {
    await fresh('br-trader');
    const r = await ev((R) => {
      const t = testBM1;
      const [A, B, C, D] = [R.A, R.B, R.C, R.D].map(window.__idx);
      t.markSystemVisited(C);
      const id = window.__aiBlockade('klingon', C, 20);
      window.__ship('tr0', A, 215, 600);
      t.orderFleetRendezvous('tr0', D);
      window.__adv(40);
      const b = window.__block(id);
      const f = window.__f('tr0');
      return { runs: (b.runs || []).filter((x) => String(x.by).startsWith('tr0:')).map((x) => [x.kind, x.outcome]), at: f.systemIndex, note: f.trade?.note, D, C, B };
    }, R);
    evidence.push({ check: 'TRADER-RUN', ...r });
    assert.ok(r.runs.length >= 1, 'the trader never ran the blockade');
    assert.ok(r.runs.every((x) => x[0] === 'trade'));
  });

  // 12 --------------------------------------------------------------------------------------------
  // The integrated scenario: an evacuation convoy on a real multi-leg route (Paso → Alpha Centauri →
  // Earth); a blockade appears at Alpha Centauri; slow unescorted haulers do badly; escorts and a
  // cloaked hauler are added; later runs go better; the blockade loses ships; deliveries rise. The same
  // scenario saved and reloaded mid-way ends identically.
  const scenario = async (saveMid, shots = false) => {
    await fresh('br-integration');
    const step = async (fn, arg) => ev(fn, arg);
    const setup = await step(() => {
      const t = testBM1;
      const P = window.__Q('Paso'), AC = window.__idx('Alpha Centauri'), E = window.__idx('Earth');
      for (const i of [P, AC, E]) t.markSystemVisited(i);
      const ids = [window.__ship('Hauler Ames', P, 215, 600), window.__ship('Hauler Brisk', P, 215, 600), window.__ship('Hauler Corva', P, 215, 600)];
      const res = t.startPlayerEvacuation(P, E, ids, { target: 3000000 });
      if (!res.ok) return { fail: res.reason };
      window.__e = res.record.id;
      window.__adv(1);
      // The blockade must outlast the three phases being compared (each three real round trips). With the
      // stock 90-day patience it withdrew during the first phase on every build since f34542d, so the
      // escorted phases met no blockade at all (STRATEGIC-TIME-SCALE-CORRECTION).
      t.campaign().config.blockadeMaxDays = 400;
      window.__bid = window.__aiBlockade('klingon', AC, 18);
      return { fail: null, P, AC, E, route: res.record.route, vids: ids.map(window.__vid) };
    });
    if (setup.fail) return setup;
    if (shots) {
      await step(() => { const t = testBM1; t.openCampaignPanel('strategic'); document.querySelector('[data-ops-evacuations]')?.scrollIntoView({ block: 'start' }); });
      await shot('BR-operations-before.png');
      await step(() => { const t = testBM1; t.closeCampaignPanel(); const AC = window.__idx('Alpha Centauri'); t.openMap(); t.focusStarChartOnSystem?.(AC, 2.2); t.drawInterstellarMapOverlay(); });
      await page.waitForTimeout(150);
      await step(() => testBM1.drawInterstellarMapOverlay());
      await shot('BR-map-route-through-blockade.png');
      await step(() => testBM1.closeMap());
    }
    const phase = async (label, days) => step(([label, days]) => {
      const t = testBM1;
      const e0 = (t.campaign().evacuations || []).find((x) => x.id === window.__e);
      const m0 = e0.moved;
      const b0 = window.__block(window.__bid);
      const n0 = (b0.runs || []).length;
      window.__adv(days);
      const e = (t.campaign().evacuations || []).find((x) => x.id === window.__e);
      const b = window.__block(window.__bid);
      const runs = (b.runs || []).slice(n0).filter((x) => String(x.by).startsWith(window.__e));
      return { label, days, moved: e.moved, gained: e.moved - m0, perDay: (e.moved - m0) / days, runs: runs.map((x) => x.outcome), passed: runs.filter((x) => t.Campaign.blockadeRunContinues(x.outcome)).length,
        transports: e.transports.length, escorts: e.escorts.length, lost: e.lost.length, removed: e.removed.length, blockade: [b.status, b.hulls.length, b.coverage], convoy: e.convoy ? [e.convoy.phase, e.convoy.pos, e.convoy.trip] : null };
    }, [label, days]);
    // STRATEGIC-MOVEMENT-UNIFICATION: each leg takes its real length, so every window is three round trips.
    const trip = await step(() => { const t = testBM1; const e = (t.campaign().evacuations || []).find((x) => x.id === window.__e); return t.Campaign.evacuationRoundTripDays(t.buildCampaignWorld(true), e) + (t.campaign().config.evacLoadingDays ?? 1); });
    const trace = [];
    // Four round trips unescorted (SHIP-DEPENDENT-STRATEGIC-SPEED): the freighters run this blockade a little
    // better than even at their 0.8× (the speed term now reads the strategic speed), so three trips — about
    // six runs — could all pass by chance and say nothing about the blockade. (Longer still, the Klingons draw
    // the blockade down for their war before the escorted phases begin, and those phases measure nothing.)
    trace.push(await phase('unescorted', 4 * trip));
    if (shots) {
      await step(() => { const t = testBM1; t.openGalaxyReports?.(); document.querySelector('[data-report-folder="personal"]')?.click(); });
      await shot('BR-run-result-reports.png');
      await step(() => { const t = testBM1; t.closeGalaxyReports?.(); t.renderFleetManager(true); const el = [...document.querySelectorAll('.fleet-manager details summary')].find((x) => /Hauler/.test(x.textContent)); el?.scrollIntoView({ block: 'center' }); });
      await shot('BR-damaged-convoy-fleet.png');
      await step(() => { document.querySelectorAll('dialog[open]').forEach((d) => d.close()); });
    }
    if (saveMid) await step(() => { const t = testBM1; t.saveGame(8); t.startWithFaction('ferengi'); t.loadGame(8); });
    await step((trip) => {
      const t = testBM1;
      const P = window.__idx('Paso');
      // Heavy escorts: eight Sovereign-class command cruisers.
      const esc = ['Dauntless', 'Endeavour', 'Fearless', 'Gallant', 'Hood', 'Intrepid'].map((n) => window.__ship(`Escort ${n}`, P, 329, 2000));
      t.assignPlayerEscorts(window.__e, esc);
      // They join the convoy when it is next home at Paso.
      const e = (t.campaign().evacuations || []).find((x) => x.id === window.__e);
      let guard = 0;
      while (e.status === 'active' && e.escorts.some((x) => x.joining) && guard++ < 2 * trip) window.__adv(1);
    }, trip);
    trace.push(await phase('escorted', 3 * trip));
    trace.push(await phase('later', 3 * trip));
    const end = await step(() => {
      const t = testBM1;
      const e = (t.campaign().evacuations || []).find((x) => x.id === window.__e);
      const b = window.__block(window.__bid);
      return { status: e.status, moved: e.moved, lost: e.lost.map((x) => x.vid), removed: e.removed.map((x) => [x.vid, x.reason]), block: [b.status, b.hulls.length, b.losses, b.coverage], transports: e.transports.map((x) => x.vid), escorts: e.escorts.map((x) => x.vid),
        fleet: t.state.playerFleet.filter((f) => /Hauler|Escort/.test(f.id)).map((f) => [f.id, window.__vid(f.id), f.destroyed ? 'destroyed' : f.vessel?.condition || 'operational', f.systemIndex]) };
    });
    if (shots) {
      await step(() => { const t = testBM1; t.openCampaignPanel('strategic'); document.querySelector('[data-ops-evacuations]')?.scrollIntoView({ block: 'start' }); });
      await shot('BR-operations-after.png');
      await step(() => testBM1.closeCampaignPanel());
    }
    return { fail: null, setup, trace, end };
  };
  await check('new-feature', 'BLOCKADE-RUN-INTEGRATION an evacuation convoy on a real multi-leg route meets a blockade that appears on its intermediate system; unescorted it does badly; escorted it does better; the blockade loses ships and weakens; deliveries rise; save/load mid-way changes nothing', async () => {
    const a = await scenario(false, true);
    const b = await scenario(true);
    evidence.push({ check: 'BLOCKADE-RUN-INTEGRATION', a, b });
    assert.ok(!a.fail, a.fail);
    assert.equal(a.setup.route.length, 3, `route ${a.setup.route}`); assert.equal(a.setup.route[1], a.setup.AC, 'the blockade is not on an intermediate system');
    const [u, e2, l] = a.trace;
    assert.ok(u.runs.length > 0, 'the convoy never ran the blockade');
    assert.ok(u.passed < u.runs.length, `unescorted, every run succeeded: ${u.runs}`);
    // Escorted, the runs go better (a phase with no runs — the blockade already broken — is not scored),
    // and deliveries do not fall. STRATEGIC-TIME-SCALE-CORRECTION: a convoy turned back now retries the next
    // day instead of waiting three, so the unescorted convoy's deliveries are bounded by its round trips as
    // the escorted one's are; the difference escorts make shows in the runs and in the blockade breaking.
    const share = (x) => x.passed / Math.max(1, x.runs.length);
    const scored = [e2, l].filter((x) => x.runs.length);
    // (A phase with no runs because the blockade had already broken is a clear road: it scores as all through.)
    const shareB = (x) => (x.runs.length ? share(x) : x.blockade[0] !== 'active' ? 1 : 0);
    assert.ok((scored.length && scored.every((x) => share(x) > share(u))) || (e2.perDay + l.perDay) / 2 > u.perDay || (e2.blockade[0] === 'broken' && shareB(e2) >= share(u)), `escorts did not improve the runs: ${JSON.stringify(a.trace)}`);
    assert.ok(a.end.block[1] < 18 || a.end.block[0] !== 'active', `the blockade lost nothing: ${a.end.block}`);
    assert.ok((e2.perDay + l.perDay) / 2 >= u.perDay, `deliveries fell: ${JSON.stringify(a.trace)}`);
    // Persistent vessels: every hauler is the same vid it started with, whatever happened to it.
    for (const [id, vid] of a.end.fleet) assert.ok(vid.startsWith('vsl:'), `${id} ${vid}`);
    assert.deepEqual(a.end.fleet.filter((x) => /Hauler/.test(x[0])).map((x) => x[1]), a.setup.vids);
    assert.equal(JSON.stringify(b), JSON.stringify(a), 'save/load mid-way changed the outcome');
  });

  // Screenshots of a formation approaching and running a blockade, and the Operations card.
  await check('new-feature', 'SHOTS a formation approaching a blockade on its route; the Operations card with Run / Wait / Reroute; the result', async () => {
    await fresh('br-shots');
    await ev((R) => {
      const t = testBM1;
      const [A, B, C, D] = [R.A, R.B, R.C, R.D].map(window.__idx);
      t.markSystemVisited(C); t.markSystemVisited(B);
      window.__shotBlock = window.__aiBlockade('klingon', C, 20);
      const gid = window.__formation('Relief Convoy', [window.__ship('Relief Hauler 1', A, 215, 600), window.__ship('Relief Hauler 2', A, 215, 600), window.__ship('Relief Escort', A, 329, 2000)]);
      window.__g(gid).destination = D;
      window.__shotG = gid;
      t.dispatchFleetFormation(gid);
      window.__adv(12);
      t.openMap(); t.focusStarChartOnSystem?.(C, 2.0); t.drawInterstellarMapOverlay();
    }, R);
    await page.waitForTimeout(150);
    await ev(() => testBM1.drawInterstellarMapOverlay());
    await shot('BR-formation-approaching-blockade.png');
    await ev(() => { const t = testBM1; t.closeMap(); t.openCampaignPanel('strategic'); document.querySelector('[data-ops-formations]')?.scrollIntoView({ block: 'start' }); });
    await shot('BR-operations-formation-card.png');
    const res = await ev(() => { const t = testBM1; t.closeCampaignPanel(); window.__adv(12); const g = window.__g(window.__shotG); t.renderFleetManager(true); document.querySelector(`[data-formation-travel="${g.id}"]`)?.scrollIntoView({ block: 'center' }); return { enc: g.travel.encounters.map((e) => e.outcome).concat(g.travel.retreatFrom != null ? ['(turned back)'] : []), line: t.formationTravelLine(g) }; });
    await shot('BR-formation-run-result.png');
    await ev(() => document.querySelectorAll('dialog[open]').forEach((d) => d.close()));
    evidence.push({ check: 'SHOTS', ...res });
  });

  fs.writeFileSync(path.join(out, 'blockade-running-evidence.json'), JSON.stringify(evidence, null, 1));
  const failed = results.filter((x) => !x.ok);
  const byCat = {};
  for (const x of results) { byCat[x.category] ||= { pass: 0, total: 0 }; byCat[x.category].total++; if (x.ok) byCat[x.category].pass++; }
  console.log(`\nblockade running: ${results.length - failed.length}/${results.length} passed`, JSON.stringify(byCat));
  if (probe.errors.length) console.log('page errors:', probe.errors.slice(0, 5));
  await probe.close();
  process.exit(failed.length || probe.errors.length ? 1 : 0);
})();
