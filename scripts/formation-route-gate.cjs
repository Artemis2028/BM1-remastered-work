// Gate for formation strategic route traversal, stacked on d507b1b.
// Rules: docs/playtest/FORMATION-ROUTE-TRAVERSAL-RULES-261700ZSEP26.md.
//
// A dispatched formation flies its route leg by leg as one body, and every system on the way is reached,
// crossed and observed once. Categories as in the other gates:
//   baseline-defect  fails on d507b1b because the formation jumped the whole route in one transit
//   new-feature      needs a state d507b1b does not have (a journey record, supersession en route, …)
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
    // A formation of real fleet vessels standing at `at`, in a formation of their own.
    window.__formation = (name, at, n = 3, shipId = 4, hull = 2000) => {
      const s = t.state, b = t.fleetBook();
      const ids = [];
      for (let k = 0; k < n; k++) {
        const id = `${name}-${k}`;
        s.playerFleet.push({ id, shipId: Number(shipId), name: `${name} ${k + 1}`, systemIndex: at, assignment: 'defense', destroyed: false, vessel: { hull, maxHull: hull, condition: 'operational' } });
        ids.push(id);
      }
      const g = t.Fleet.addFormation(b, name);
      for (const id of ids) t.Fleet.assignFormation(b, id, g.id);
      return g.id;
    };
    window.__g = (id) => t.fleetBook().formations.find((g) => g.id === id);
    window.__members = (id) => window.__g(id).members.map((m) => t.state.playerFleet.find((f) => f.id === m)).filter(Boolean);
    window.__vids = (id) => window.__members(id).map((f) => t.ensureFleetVesselIdentity(f).vid);
    // Where every member is: [systemIndex, transit.to|null, transit.arrivalDay|null].
    window.__where = (id) => window.__members(id).map((f) => [Number(f.systemIndex), f.transit ? Number(f.transit.to) : null, f.transit ? Number(f.transit.arrivalDay) : null, f.assignment]);
    window.__log = (i) => (t.conditionLog ? t.conditionLog(i) : []) || [];
  });

  // The route every check below flies unless it says otherwise: Earth → Orion → Tellar → Vulcan.
  const ROUTE = { A: 'Earth', B: 'Orion', C: 'Tellar', D: 'Vulcan' };

  // 1 ---------------------------------------------------------------------------------------------
  await check('baseline-defect', 'ROUTE-VISITS A→B→C→D: the formation actually reaches B, then C, then D — leg by leg, on the calendar, as one body', async () => {
    await fresh('fr-visits');
    const r = await ev((R) => {
      const t = testBM1, s = t.state;
      const [A, B, C, D] = [R.A, R.B, R.C, R.D].map(window.__idx);
      const gid = window.__formation('Task Force', A);
      const g = window.__g(gid); g.destination = D;
      const route = t.getPlottedRoute(A, D);
      const ok = t.dispatchFleetFormation(gid);
      const firstLeg = window.__where(gid);
      const trace = [];
      let prev = JSON.stringify(window.__where(gid));
      for (let d = 0; d < 60; d++) {
        window.__adv(1);
        const w = window.__where(gid);
        const key = JSON.stringify(w);
        if (key !== prev) trace.push({ day: s.day, w });
        prev = key;
        // One body: never two positions at once.
        const distinct = new Set(w.map((x) => JSON.stringify([x[0], x[1], x[2]])));
        if (distinct.size > 1) return { fail: `split on day ${s.day}: ${key}` };
        if (!w[0][1] && w[0][0] === D) break;
      }
      const tr = t.fleetBook().formations.find((x) => x.id === gid).travel;
      // The chart's legs at the formation's strategic speed (its slowest ship; SHIP-DEPENDENT-STRATEGIC-SPEED —
      // chart days on a build without ship speed).
      const members = s.playerFleet.filter((f) => g.members.includes(f.id) && !f.destroyed);
      return { fail: null, ok, A, B, C, D, systems: route.systems, legDays: t.routeLegDays(route, t.fleetGroupSpeed ? t.fleetGroupSpeed(members) : null), firstLeg, trace, crossed: tr?.crossed || null, status: tr?.status || null, startDay: tr?.startDay };
    }, ROUTE);
    evidence.push({ check: 'ROUTE-VISITS', ...r });
    assert.ok(!r.fail, r.fail);
    assert.ok(r.ok, 'dispatch refused');
    assert.deepEqual(r.systems, [r.A, r.B, r.C, r.D], `precondition: the plotted route is ${r.systems}`);
    // The first leg ends at B, not at D.
    for (const w of r.firstLeg) assert.equal(w[1], r.B, `on dispatch the formation was sent to ${w[1]}, not the first system on its route (${r.B}): one jump`);
    assert.ok(r.crossed, 'no journey record');
    assert.deepEqual(r.crossed.map((c) => c.system), [r.B, r.C, r.D], 'the systems crossed');
    // Each crossing on the calendar day its leg ends.
    let day = r.startDay;
    r.crossed.forEach((c, i) => { day += r.legDays[i]; assert.equal(c.day, day, `crossing ${i} on day ${c.day}, expected ${day}`); });
    assert.equal(r.status, 'arrived');
    // The members were actually in B and in C.
    const seen = r.trace.map((x) => x.w[0][0]);
    assert.ok(seen.indexOf(r.B) >= 0 && seen.indexOf(r.C) > seen.indexOf(r.B) && seen.lastIndexOf(r.D) > seen.indexOf(r.C), `positions over time: ${seen}`);
  });

  // 2 ---------------------------------------------------------------------------------------------
  await check('baseline-defect', 'CROSS-ONCE every intermediate crossing is processed exactly once: the formation observes B and C on the days it is there, one crossing record each, and nothing more however often the day is processed again', async () => {
    await fresh('fr-once');
    const r = await ev((R) => {
      const t = testBM1, s = t.state;
      const [A, B, C, D] = [R.A, R.B, R.C, R.D].map(window.__idx);
      const gid = window.__formation('Task Force', A);
      window.__g(gid).destination = D;
      t.dispatchFleetFormation(gid);
      // Every fleet observation filed at B or C, by day (the log keeps the latest per system).
      const fleetObs = { [B]: [], [C]: [] };
      const noteObs = () => { for (const i of [B, C]) { const o = t.conditionLog()[i]; if (o && o.source === 'fleet' && !fleetObs[i].includes(o.day)) fleetObs[i].push(o.day); } };
      let repeatDelta = 0, repeatCross = 0;
      const crossedLen = () => window.__g(gid).travel?.crossed?.length ?? 0;
      for (let d = 0; d < 60; d++) {
        window.__adv(1);
        noteObs();
        const n = crossedLen(), rev = s.conditionsRev;
        // The same day, processed again and again, must change nothing.
        t.completeFleetJourneys(); t.completeFleetJourneys(); t.advanceFormationTravels?.();
        repeatDelta += s.conditionsRev - rev; repeatCross += crossedLen() - n;
        const w = window.__where(gid)[0];
        if (w[0] === D && w[1] === null) break;
      }
      const crossed = window.__g(gid).travel?.crossed || [];
      return { crossed, B, C, D, fleetObs, repeatDelta, repeatCross };
    }, ROUTE);
    evidence.push({ check: 'CROSS-ONCE', ...r });
    assert.ok(r.fleetObs[r.B].length, 'the formation never observed B: it was never there');
    assert.ok(r.fleetObs[r.C].length, 'the formation never observed C: it was never there');
    const count = (i) => r.crossed.filter((c) => c.system === i).length;
    assert.equal(count(r.B), 1, `B crossed ${count(r.B)} times`);
    assert.equal(count(r.C), 1, `C crossed ${count(r.C)} times`);
    for (const i of [r.B, r.C]) {
      const day = r.crossed.find((c) => c.system === i).day;
      assert.deepEqual(r.fleetObs[i], [day], `system ${i}: fleet observations on days ${r.fleetObs[i]}, crossed on day ${day}`);
    }
    assert.equal(r.repeatCross, 0, 'processing a day again crossed a system again');
    assert.equal(r.repeatDelta, 0, 'processing a day again observed a system again');
  });

  // 3 ---------------------------------------------------------------------------------------------
  await check('baseline-defect', 'SAVELOAD-MID a save made on the B→C leg resumes the B→C leg — same leg, same vessels, same days — not A→D', async () => {
    await fresh('fr-save');
    const r = await ev((R) => {
      const t = testBM1, s = t.state;
      const [A, B, C, D] = [R.A, R.B, R.C, R.D].map(window.__idx);
      const gid = window.__formation('Task Force', A);
      const name = window.__g(gid).name;
      window.__g(gid).destination = D;
      t.dispatchFleetFormation(gid);
      let guard = 0;
      // Stop one day into the second leg — or, if there is no second leg, one day into the journey.
      const lead = () => window.__members(gid)[0];
      while (!(lead().transit && Number(lead().transit.from) === B && s.day > window.__g(gid).travel?.legDepartDay) && guard++ < 40) window.__adv(1);
      const snap = () => {
        const g = t.fleetBook().formations.find((x) => x.name === name);
        const tr = g.travel || {};
        return JSON.stringify({ day: s.day, leg: tr.legIndex ?? null, from: tr.from ?? null, to: tr.path ? tr.path[tr.legIndex] : null, depart: tr.legDepartDay ?? null, arrive: tr.legArrivalDay ?? null, eta: tr.etaDay ?? null, dest: tr.destination ?? null, members: tr.members ?? null, vids: g.members.map((m) => t.ensureFleetVesselIdentity(s.playerFleet.find((f) => f.id === m)).vid),
          where: g.members.map((m) => { const f = s.playerFleet.find((x) => x.id === m); return [f.systemIndex, f.transit?.from ?? null, f.transit?.to ?? null, f.transit?.arrivalDay ?? null, f.assignment]; }) });
      };
      const before = snap();
      t.saveGame(6); t.startWithFaction('ferengi'); t.loadGame(6);
      const after = snap();
      // Carry on: the next system reached is C, on the day the B→C leg was due.
      const g = t.fleetBook().formations.find((x) => x.name === name);
      const f0 = s.playerFleet.find((x) => x.id === g.members[0]);
      const due = f0.transit?.arrivalDay ?? s.day;
      while (s.day < due) window.__adv(1);
      const next = g.travel?.crossed ? g.travel.crossed[g.travel.crossed.length - 1] : { system: f0.systemIndex, day: s.day };
      return { A, B, C, D, before, after, next, due };
    }, ROUTE);
    evidence.push({ check: 'SAVELOAD-MID', ...r });
    const b = JSON.parse(r.before);
    for (const w of b.where) assert.deepEqual([w[1], w[2]], [r.B, r.C], `at the save a member is at ${w[0]} on ${w[1]}→${w[2]}, not on the B→C leg (${r.B}→${r.C})`);
    assert.equal(b.leg, 1); assert.equal(b.from, r.B); assert.equal(b.to, r.C);
    assert.equal(r.after, r.before, 'the journey after the reload differs');
    assert.equal(r.next.system, r.C, `after the reload the next system crossed was ${r.next.system}`);
    assert.equal(r.next.day, r.due);
  });

  // 4 ---------------------------------------------------------------------------------------------
  await check('preservation', 'IDENTITY formation member vids and records stay identical throughout the journey, across a reload, and at arrival', async () => {
    await fresh('fr-ident');
    const r = await ev((R) => {
      const t = testBM1, s = t.state;
      const [A, , , D] = [R.A, R.B, R.C, R.D].map(window.__idx);
      const gid = window.__formation('Task Force', A);
      const name = window.__g(gid).name;
      window.__g(gid).destination = D;
      const start = window.__vids(gid);
      const objs = window.__members(gid);
      t.dispatchFleetFormation(gid);
      const seen = [];
      for (let d = 0; d < 20; d++) { window.__adv(1); seen.push(JSON.stringify(window.__vids(gid))); }
      t.saveGame(7); t.startWithFaction('ferengi'); t.loadGame(7);
      const g = t.fleetBook().formations.find((x) => x.name === name);
      const reloaded = g.members.map((m) => t.ensureFleetVesselIdentity(s.playerFleet.find((f) => f.id === m)).vid);
      const arrived = () => window.__members(gid).every((f) => !f.transit && Number(f.systemIndex) === D);
      for (let d = 0; d < 40 && !arrived(); d++) window.__adv(1);
      const end = g.members.map((m) => t.ensureFleetVesselIdentity(s.playerFleet.find((f) => f.id === m)).vid);
      const travelVids = g.travel ? Object.values(g.travel.vids) : null;
      return { start, seen, reloaded, end, travelVids, arrived: arrived() };
    }, ROUTE);
    assert.equal(r.arrived, true, 'the formation did not arrive');
    for (const x of r.seen) assert.equal(x, JSON.stringify(r.start), 'vids changed en route');
    assert.deepEqual(r.reloaded, r.start); assert.deepEqual(r.end, r.start);
    if (r.travelVids) assert.deepEqual(r.travelVids, r.start, 'the journey record names other vessels');
  });

  // 5 ---------------------------------------------------------------------------------------------
  const BROUTE = { A: 'Earth', B: 'Alpha Centauri', C: 'Paso', D: 'Ferenginar' };
  await check('new-feature', 'BLOCKADE-AT-C a blockade that appears at C while the formation is en route is met at C — on the crossing day — and run through the interception engine (BLOCKADE-RUNNING-RULES supersedes the 4860070 pass-through): one run on the record, what the crews saw, one report; turned back means back towards B', async () => {
    await fresh('fr-block');
    const r = await ev((R) => {
      const t = testBM1, s = t.state;
      const [A, B, C, D] = [R.A, R.B, R.C, R.D].map(window.__idx);
      const gid = window.__formation('Task Force', A);
      window.__g(gid).destination = D;
      t.dispatchFleetFormation(gid);
      window.__adv(1); // in warp on A→B
      // A power at war with C's holder blockades it, through the model's own entry point.
      const book = t.campaign(); t.syncPlayerPolity(book);
      const world = t.buildCampaignWorld(true);
      const holder = world.systems[C].controller;
      const power = 'klingon';
      let rel = world.relation(power, holder);
      const fx = [];
      if (rel !== 'war') t.Campaign.declareFormalWar(book, world, power, holder, s.day, fx, { reason: 'gate fixture' });
      t.applyCampaignEffects(fx, s.day);
      const hulls = book.polities[power].hulls.filter((h) => h.status === 'ready' && !h.opId).slice(0, 6);
      for (const h of hulls) h.systemIndex = C;
      const fx2 = [];
      const res = t.Campaign.startBlockade(book, t.buildCampaignWorld(true), { power, target: C, hullIds: hulls.map((h) => h.id), purpose: 'interdict_trade' }, s.day, fx2);
      t.applyCampaignEffects(fx2, s.day);
      if (!res.ok) return { fail: `fixture: ${res.reason}` };
      // The captain has been to C before: reports about it are filed as they are for any known world.
      t.markSystemVisited(C);
      const b = res.record;
      const knownBefore = t.blockadeKnowledge(b);
      const tr = window.__g(gid).travel;
      let atB = null;
      for (let d = 0; d < 60 && tr.status === 'underway'; d++) {
        window.__adv(1);
        if (atB === null && tr.crossed.some((c) => c.system === B)) atB = tr.encounters.length;
      }
      const crossC = tr.crossed.find((c) => c.system === C);
      const knownAfter = t.blockadeKnowledge(b);
      const reports = t.galaxyNewsBook().items.filter((x) => String(x.id).startsWith('blockade-run:') && String(x.id).includes(b.id)).map((x) => ({ day: x.day, kind: x.kind, text: x.text, systemIndex: x.systemIndex }));
      const g = window.__g(gid);
      return { fail: null, B, C, holder, bStatus: b.status, encounters: tr.encounters, atB, crossC, runs: b.runs || [], breaches: b.breaches, sightings: b.sightings, knownBefore, knownAfter, reports, day: s.day,
        after: { status: g.travel.status, retreatFrom: g.travel.retreatFrom ?? null, destination: g.travel.destination, oldEnd: tr.endReason } };
    }, BROUTE);
    evidence.push({ check: 'BLOCKADE-AT-C', ...r });
    assert.ok(!r.fail, r.fail);
    assert.equal(r.atB, 0, 'a blockade was met at B');
    assert.equal(r.encounters.length, 1, `encounters: ${JSON.stringify(r.encounters)}`);
    assert.equal(r.encounters[0].system, r.C);
    assert.equal(r.encounters[0].day, r.crossC.day, 'met on a day other than the crossing');
    const enc = r.encounters[0];
    assert.ok(['slipped_through', 'challenged_but_passed', 'fought_through', 'intercepted_minor_damage', 'intercepted_forced_back', 'intercepted_losses', 'blockade_broken'].includes(enc.outcome), `outcome ${enc.outcome}`);
    assert.equal(r.runs.filter((x) => x.sponsor === 'player' && x.day === r.crossC.day).length, 1, `runs on the blockade: ${JSON.stringify(r.runs)}`);
    assert.deepEqual(r.sightings?.player, enc.observed, 'the captain\'s sighting is not what the crews saw');
    assert.ok(r.knownAfter, 'the captain knows nothing of it after running it');
    assert.ok(r.reports.length >= 1 && r.reports.every((x) => x.systemIndex === r.C), `reports: ${JSON.stringify(r.reports)}`);
    const passed = ['slipped_through', 'challenged_but_passed', 'fought_through', 'intercepted_minor_damage', 'blockade_broken'].includes(enc.outcome);
    if (passed) assert.ok(r.breaches.some((x) => x.day === r.crossC.day), 'passage not on the blockade\'s record');
    else { assert.equal(r.after.oldEnd, 'forced-back'); assert.equal(r.after.retreatFrom, r.C); assert.equal(r.after.destination, r.B, 'turned back somewhere other than B'); }
  });

  // 6 ---------------------------------------------------------------------------------------------
  await check('new-feature', 'CEASEFIRE-ATTACK a ceasefire while an attack formation is travelling stops it where its leg ends: no attack order is ever taken up at the target, and a new attack without a war is refused', async () => {
    await fresh('fr-cease');
    const r = await ev(() => {
      const t = testBM1, s = t.state;
      const A = window.__idx('Earth'), T = window.__idx('Qem-Kis');
      const gid = window.__formation('Strike Group', A);
      const g = window.__g(gid); g.destination = T;
      const route = t.getPlottedRoute(A, T).systems;
      const rel0 = t.playerRelation('klingon').status;
      const ok = t.dispatchFleetFormation(gid, { purpose: 'attack' });
      const tr = g.travel;
      const war = { ...tr.war };
      // Cross the first system, then a ceasefire while in warp on the second leg.
      while (tr.crossed.length < 1) window.__adv(1);
      window.__adv(1);
      const book = t.campaign();
      const eff = t.Campaign.forceWarTransition(book, t.buildCampaignWorld(true), 'player', 'klingon', 'ceasefire', s.day, 'gate ceasefire');
      t.applyCampaignEffects(eff, s.day);
      const rel1 = t.playerRelation('klingon').status;
      const lapseDay = s.day;
      for (let d = 0; d < 60 && tr.status === 'underway'; d++) window.__adv(1);
      for (let d = 0; d < 20; d++) window.__adv(1);
      const where = window.__where(gid);
      // A fresh attack under the ceasefire is refused.
      const refused = t.dispatchFleetFormation(gid, { purpose: 'attack' });
      return { rel0, rel1, ok, war, route, status: tr.status, endReason: tr.endReason, crossed: tr.crossed.map((c) => [c.system, c.day]), where, order: g.order, warOrder: g.warOrder || null, T, lapseDay, refused, note: tr.note };
    });
    evidence.push({ check: 'CEASEFIRE-ATTACK/1', ...r });
    assert.equal(r.rel0, 'war', 'precondition: the empire is not at war with the Klingons');
    assert.ok(r.ok, 'the attack dispatch was refused');
    assert.ok(r.war && r.war.holder === 'klingon', `stamped authority ${JSON.stringify(r.war)}`);
    assert.equal(r.rel1, 'ceasefire');
    assert.equal(r.status, 'halted');
    assert.equal(r.endReason, 'war-authority');
    assert.ok(!r.crossed.some(([i]) => i === r.T), 'the formation reached its attack target after the ceasefire');
    assert.equal(r.crossed.length, 2, `crossings ${JSON.stringify(r.crossed)}: it should stop where the leg in flight ended`);
    for (const w of r.where) { assert.notEqual(w[0], r.T); assert.equal(w[1], null, 'still in transit'); }
    assert.notEqual(r.order, 'attack', 'a stale attack order is standing');
    assert.equal(r.warOrder, null);
    assert.equal(r.refused, false, 'an attack was dispatched with no war behind it');

  });

  await check('new-feature', 'ATTACK-ARRIVAL-STANDDOWN an attack that arrives under its war takes up the attack once; a ceasefire afterwards stands it down; a target changing hands halts one en route', async () => {
    await fresh('fr-arrive-attack');
    const r = await ev(() => {
      const t = testBM1, s = t.state;
      const A = window.__idx('Earth'), T = window.__idx('Qem-Kis');
      const gid = window.__formation('Strike Group', A);
      const g = window.__g(gid); g.destination = T;
      t.dispatchFleetFormation(gid, { purpose: 'attack' });
      const tr = g.travel;
      for (let d = 0; d < 60 && tr.status === 'underway'; d++) window.__adv(1);
      const arrived = { status: tr.status, order: g.order, warOrder: g.warOrder ? { ...g.warOrder } : null, at: window.__where(gid)[0][0], day: tr.arrivedDay };
      window.__adv(2);
      const steady = { order: g.order, since: g.warOrder?.since };
      const book = t.campaign();
      t.applyCampaignEffects(t.Campaign.forceWarTransition(book, t.buildCampaignWorld(true), 'player', 'klingon', 'ceasefire', s.day, 'gate ceasefire'), s.day);
      window.__adv(1);
      const stood = { order: g.order, warOrder: g.warOrder || null };
      // Control change: a second group sent to attack a Klingon world that is handed to someone else en route.
      t.applyCampaignEffects(t.Campaign.forceWarTransition(book, t.buildCampaignWorld(true), 'player', 'klingon', 'war', s.day, 'gate war'), s.day);
      const rel = t.playerRelation('klingon').status;
      return { T, arrived, steady, stood, rel };
    });
    evidence.push({ check: 'ATTACK-ARRIVAL-STANDDOWN', ...r });
    assert.equal(r.arrived.status, 'arrived');
    assert.equal(r.arrived.at, r.T);
    assert.equal(r.arrived.order, 'attack');
    assert.ok(r.arrived.warOrder && r.arrived.warOrder.holder === 'klingon');
    assert.equal(r.steady.order, 'attack'); assert.equal(r.steady.since, r.arrived.day, 'the arrival was processed again');
    assert.notEqual(r.stood.order, 'attack', 'the attack order outlived the war');
    assert.equal(r.stood.warOrder, null);
  });

  await check('new-feature', 'CONTROL-CHANGE an attack formation whose target changes hands en route halts where its leg ends', async () => {
    await fresh('fr-control');
    const r = await ev(() => {
      const t = testBM1, s = t.state;
      const A = window.__idx('Earth'), T = window.__idx('Qem-Kis');
      const gid = window.__formation('Strike Group', A);
      const g = window.__g(gid); g.destination = T;
      t.dispatchFleetFormation(gid, { purpose: 'attack' });
      const tr = g.travel;
      window.__adv(2);
      // The target is taken from the Klingons (the captain's empire takes it through the real transfer).
      t.transferSystemControlToFaction(T, 'romulan');
      for (let d = 0; d < 60 && tr.status === 'underway'; d++) window.__adv(1);
      return { T, holder: t.getSystemControl(T).controller, status: tr.status, endReason: tr.endReason, crossed: tr.crossed.map((c) => c.system), order: g.order, warOrder: g.warOrder || null };
    });
    evidence.push({ check: 'CONTROL-CHANGE', ...r });
    assert.notEqual(r.holder, 'klingon', 'precondition: the target did not change hands');
    assert.equal(r.status, 'halted'); assert.equal(r.endReason, 'war-authority');
    assert.ok(!r.crossed.includes(r.T));
    assert.notEqual(r.order, 'attack'); assert.equal(r.warOrder, null);
  });

  // 7 ---------------------------------------------------------------------------------------------
  await check('new-feature', 'SUPERSEDE a new destination given in warp takes effect where the leg ends and replaces the rest of the route from there; one given in a system is flown at once; stop holds at the next system', async () => {
    await fresh('fr-supersede');
    const r = await ev((R) => {
      const t = testBM1, s = t.state;
      const [A, B, C, D] = [R.A, R.B, R.C, R.D].map(window.__idx);
      const E = window.__idx('Gorn'); // Earth → Orion → Rigel → Gorn: shares B, not C
      const gid = window.__formation('Task Force', A);
      const g = window.__g(gid); g.destination = D;
      t.dispatchFleetFormation(gid);
      window.__adv(1); // in warp A→B
      // The captain is at B, where the leg ends: the order reaches the formation there.
      s.currentPlanet = B; s.myplanet = B + 1; t.applySystemState(B);
      g.destination = E;
      const accepted = t.dispatchFleetFormation(gid);
      const tr0 = g.travel;
      const pending = tr0.pending ? { ...tr0.pending } : null;
      const stillOnLeg = window.__where(gid).map((w) => w[1]);
      for (let d = 0; d < 60 && g.travel.status === 'underway'; d++) window.__adv(1);
      const tr = g.travel;
      const route = t.getPlottedRoute(B, E).systems;
      const first = { oldStatus: tr0.status, newPath: tr.path, crossed: tr.crossed.map((c) => c.system), replots: tr.replots, status: tr.status, at: window.__where(gid)[0][0], seq: tr.seq };
      // In a system on the day it crosses: replotted from there, at once.
      s.currentPlanet = E; s.myplanet = E + 1; t.applySystemState(E);
      g.destination = D;
      t.dispatchFleetFormation(gid);
      const tr2 = g.travel;
      while (tr2.crossed.length < 1) window.__adv(1);
      const standingAt = tr2.from, standingDay = s.day;
      s.currentPlanet = standingAt; s.myplanet = standingAt + 1; t.applySystemState(standingAt);
      g.destination = A;
      const immediate = t.dispatchFleetFormation(gid);
      const tr3 = g.travel;
      const replotted = { id3: tr3.id !== tr2.id, from: tr3.plotFrom, path: tr3.path, depart: tr3.legDepartDay };
      // Stop at the next system.
      window.__adv(1);
      const legEnd = tr3.path[tr3.legIndex];
      s.currentPlanet = legEnd; s.myplanet = legEnd + 1; t.applySystemState(legEnd);
      t.cancelFormationTravel(gid);
      for (let d = 0; d < 60 && g.travel.status === 'underway'; d++) window.__adv(1);
      return { A, B, C, D, E, accepted, pending, stillOnLeg, route, first, standingAt, standingDay, immediate, replotted, legEnd, stop: { status: g.travel.status, at: window.__where(gid)[0][0], transit: window.__where(gid)[0][1] } };
    }, ROUTE);
    evidence.push({ check: 'SUPERSEDE', ...r });
    assert.ok(r.accepted);
    assert.equal(r.pending?.destination, r.E);
    for (const x of r.stillOnLeg) assert.equal(x, r.B, 'the formation turned round in warp');
    assert.equal(r.first.oldStatus, 'superseded');
    assert.equal(r.first.status, 'arrived'); assert.equal(r.first.at, r.E);
    assert.deepEqual(r.first.newPath, r.route.slice(1), 'the rest of the route was not replotted from B');
    assert.ok(!r.first.crossed.includes(r.C), 'the superseded route was flown on to C');
    assert.equal(r.first.crossed[0], r.B, 'B was not crossed before the replot');
    assert.equal(r.first.replots.length, 1); assert.equal(r.first.replots[0].at, r.B);
    assert.ok(r.immediate); assert.ok(r.replotted.id3);
    assert.equal(r.replotted.from, r.standingAt); assert.equal(r.replotted.depart, r.standingDay);
    assert.equal(r.stop.status, 'arrived'); assert.equal(r.stop.at, r.legEnd); assert.equal(r.stop.transit, null);
  });

  await check('new-feature', 'MEMBER-ORDER a member given her own recall en route leaves the formation where the leg ends and flies it from there; the others go on without her', async () => {
    await fresh('fr-member-order');
    const r = await ev((R) => {
      const t = testBM1, s = t.state;
      const [A, B, C, D] = [R.A, R.B, R.C, R.D].map(window.__idx);
      const gid = window.__formation('Task Force', A);
      const g = window.__g(gid); g.destination = D;
      t.dispatchFleetFormation(gid);
      window.__adv(1);
      const m = window.__members(gid)[2];
      const ok = t.orderFleetRendezvous(m.id, A);
      const line = t.fleetTradeStatusLine(m);
      for (let d = 0; d < 80 && (g.travel.status === 'underway' || m.transit); d++) window.__adv(1);
      return { A, B, D, ok, line, detached: g.travel.detached, members: g.travel.members, m: { at: m.systemIndex, order: m.trade?.order, crossed: m.trade?.crossed }, others: window.__members(gid).filter((f) => f.id !== m.id).map((f) => f.systemIndex) };
    }, ROUTE);
    evidence.push({ check: 'MEMBER-ORDER', ...r });
    assert.ok(r.ok);
    assert.match(r.line, /leaves the formation at Orion/);
    assert.equal(r.detached.length, 1); assert.equal(r.detached[0].reason, 'ordered'); assert.equal(r.detached[0].system, r.B);
    assert.equal(r.m.at, r.A, 'she did not fly her own order back'); assert.ok(r.m.order.arrivedDay != null);
    for (const x of r.others) assert.equal(x, r.D);
  });

  // 8 ---------------------------------------------------------------------------------------------
  await check('new-feature', 'DISABLED-NOT-DRAGGED a member disabled in flight stops where the leg ends and is never carried further; a repaired ship does not jump to the formation; a disabled or order-pending member blocks dispatch', async () => {
    await fresh('fr-disabled');
    const r = await ev((R) => {
      const t = testBM1, s = t.state;
      const [A, B, C, D] = [R.A, R.B, R.C, R.D].map(window.__idx);
      const gid = window.__formation('Task Force', A);
      const g = window.__g(gid); g.destination = D;
      // Refusals at dispatch.
      const m0 = window.__members(gid)[0];
      m0.vessel.condition = 'disabled'; m0.vessel.hull = 50;
      const refusedDisabled = t.dispatchFleetFormation(gid);
      m0.vessel.condition = 'operational'; m0.vessel.hull = m0.vessel.maxHull;
      // Disabled, given an order, repaired: the order is hers, unresolved.
      const f1 = window.__members(gid)[1];
      f1.vessel.condition = 'disabled'; f1.vessel.hull = 50;
      t.orderFleetRendezvous(f1.id, C);
      f1.vessel.condition = 'operational'; f1.vessel.hull = f1.vessel.maxHull;
      const refusedPending = t.dispatchFleetFormation(gid);
      t.cancelFleetPassage(f1.id);
      const ok = t.dispatchFleetFormation(gid);
      window.__adv(1);
      // Disabled in warp on A→B.
      const victim = window.__members(gid)[1];
      victim.vessel.condition = 'disabled'; victim.vessel.hull = 50;
      const path = [];
      let stopped = null;
      for (let d = 0; d < 60 && g.travel.status === 'underway'; d++) {
        window.__adv(1);
        if (!victim.transit) path.push(victim.systemIndex);
        if (!stopped && !victim.transit) stopped = { at: victim.systemIndex, transit: Boolean(victim.transit), line: t.fleetTradeStatusLine(victim), day: t.state.day };
      }
      // Repaired: she stays where she lay.
      victim.vessel.condition = 'operational'; victim.vessel.hull = victim.vessel.maxHull;
      window.__adv(3);
      return { A, B, D, refusedDisabled, refusedPending, f1pending: f1.trade?.order, ok, detached: g.travel.detached, members: g.travel.members, victim: victim.id, path: [...new Set(path)], stopped, repairedAt: victim.systemIndex, repairedTransit: Boolean(victim.transit), others: window.__members(gid).filter((f) => f.id !== victim.id).map((f) => f.systemIndex) };
    }, ROUTE);
    evidence.push({ check: 'DISABLED-NOT-DRAGGED', ...r });
    assert.equal(r.refusedDisabled, false); assert.equal(r.refusedPending, false);
    assert.ok(r.ok, `dispatch after cancel refused (${JSON.stringify(r.f1pending)})`);
    assert.equal(r.detached.length, 1); assert.equal(r.detached[0].reason, 'disabled'); assert.equal(r.detached[0].system, r.B);
    assert.ok(!r.members.includes(r.victim));
    assert.deepEqual(r.path, [r.B], `the disabled ship was carried on: ${r.path}`);
    assert.equal(r.stopped.transit, false); assert.match(r.stopped.line, /Disabled/);
    assert.equal(r.repairedAt, r.B); assert.equal(r.repairedTransit, false);
    for (const x of r.others) assert.equal(x, r.D);
  });

  // 9 ---------------------------------------------------------------------------------------------
  await check('preservation', 'ARRIVAL-ONCE the final arrival is processed once: the members reach the destination on one day and stay; one set of scene ships in the captain\'s system; with a journey record, one crossing of the destination and one arrival day', async () => {
    await fresh('fr-arrive');
    const r = await ev((R) => {
      const t = testBM1, s = t.state;
      const [A, B, C, D] = [R.A, R.B, R.C, R.D].map(window.__idx);
      // Sent from D to the captain's own system A.
      const gid = window.__formation('Homeward', D);
      const g = window.__g(gid); g.destination = A;
      // Ordered in person at D; the captain then goes home to A ahead of it.
      s.currentPlanet = D; s.myplanet = D + 1; t.applySystemState(D);
      const ok = t.dispatchFleetFormation(gid);
      s.currentPlanet = A; s.myplanet = A + 1; t.applySystemState(A);
      const here = () => window.__members(gid).every((f) => !f.transit && Number(f.systemIndex) === A);
      const arrivals = [];
      let was = here();
      for (let d = 0; d < 65; d++) {
        window.__adv(1); t.completeFleetJourneys(); t.completeFleetJourneys();
        const now = here();
        if (now && !was) arrivals.push(s.day);
        was = now;
      }
      const ids = window.__members(gid).map((f) => f.id);
      const scene = ids.map((id) => s.npcShips.filter((n) => n.fleetId === id).length);
      const tr = g.travel || null;
      return { ok, A, arrivals, record: tr ? { arrivedDay: tr.arrivedDay, crossedA: tr.crossed.filter((c) => c.system === A).length, status: tr.status } : null, scene, where: window.__where(gid) };
    }, ROUTE);
    evidence.push({ check: 'ARRIVAL-ONCE', ...r });
    assert.ok(r.ok, 'dispatch refused');
    assert.equal(r.arrivals.length, 1, `arrivals on days ${r.arrivals}`);
    for (const w of r.where) assert.deepEqual([w[0], w[1]], [r.A, null]);
    for (const n of r.scene) assert.ok(n <= 1, `a member was put in the scene ${n} times`);
    if (r.record) {
      assert.equal(r.record.status, 'arrived'); assert.equal(r.record.crossedA, 1);
      assert.equal(r.record.arrivedDay, r.arrivals[0]);
    }
  });

  // 10 --------------------------------------------------------------------------------------------
  await check('preservation', 'FORMATION-OPS a formation moved by dispatch can then be put to an evacuation and to formation trading at its destination', async () => {
    await fresh('fr-ops');
    const r = await ev(() => {
      const t = testBM1, s = t.state;
      const A = window.__idx('Earth');
      const P = window.__idx('Orion');
      const gid = window.__formation('Lift Group', A, 2, 1, 400);
      const g = window.__g(gid); g.destination = P;
      t.dispatchFleetFormation(gid);
      const arrived = () => window.__members(gid).every((f) => !f.transit && Number(f.systemIndex) === P);
      for (let d = 0; d < 30 && !arrived(); d++) window.__adv(1);
      // Orion becomes the captain's own world once the group is there (the evacuation fixture's world).
      if (t.getSystemControl(P).controller !== 'player') { t.transferSystemControlToPlayer(P); t.markSystemVisited(P); }
      const ids = window.__members(gid).map((f) => f.id);
      const ctl = t.getSystemControl(P).controller;
      const free = t.freeFleetShipsAt(P).map((f) => f.id);
      const evac = t.startPlayerEvacuation(P, A, ids);
      const held = window.__members(gid).map((f) => f.strategicOp || null);
      const cancel = evac.ok ? t.cancelPlayerEvacuation(evac.record.id) : null;
      // Trading with the formation.
      const traded = ids.map((id) => t.startFleetTrading(id, 'safe'));
      return { status: arrived() ? 'arrived' : 'not arrived', at: window.__where(gid).map((w) => w[0]), P, ctl, free, ids, evac: evac.ok ? 'ok' : evac.reason, held, traded };
    });
    evidence.push({ check: 'FORMATION-OPS', ...r });
    assert.equal(r.status, 'arrived');
    for (const x of r.at) assert.equal(x, r.P);
    for (const id of r.ids) assert.ok(r.free.includes(id), `${id} is not free for an operation at its destination`);
    assert.equal(r.evac, 'ok');
    for (const h of r.held) assert.ok(h, 'a member was not held by the evacuation');
    for (const x of r.traded) assert.equal(x, true);
  });

  await check('new-feature', 'RELAY-EN-ROUTE a new destination for a formation in warp beyond any link is queued, is not received in warp or at an unlinked system, is received where a leg ends at a linked system, and is flown from there', async () => {
    await fresh('fr-relay');
    const r = await ev((R) => {
      const t = testBM1, s = t.state;
      const [A, B, C, D] = [R.A, R.B, R.C, R.D].map(window.__idx);
      const E = window.__idx('Gorn');
      const gid = window.__formation('Task Force', A);
      const g = window.__g(gid); g.destination = D;
      t.dispatchFleetFormation(gid);
      window.__adv(1);
      // The captain goes ahead to C. Neither B nor the formation in warp has a link.
      s.currentPlanet = C; s.myplanet = C + 1; t.applySystemState(C);
      const linkedB = t.isSystemRelayConnected(B);
      g.destination = A;
      const given = t.dispatchFleetFormation(gid);
      const book = t.campaign();
      const q = () => book.orders.filter((o) => o.formationId === gid).map((o) => ({ status: o.status, systemIndex: o.systemIndex, ack: o.acknowledgedDay }));
      const queued = q();
      const tr = g.travel;
      while (!tr.crossed.some((c) => c.system === B)) window.__adv(1);
      const afterB = { orders: q(), status: tr.status, leg: tr.legIndex, to: tr.path[tr.legIndex] };
      for (let d = 0; d < 60 && g.travel.status === 'underway' && g.travel === tr; d++) window.__adv(1);
      const crossC = tr.crossed.find((c) => c.system === C);
      const next = g.travel;
      const plotted = { plotFrom: next.plotFrom, depart: next.legDepartDay, legIndex: next.legIndex, path: [...next.path] };
      for (let d = 0; d < 60 && g.travel.status === 'underway'; d++) window.__adv(1);
      return { A, B, C, D, linkedB, given, queued, afterB, crossC, oldStatus: tr.status, orders: q(), next: { ...plotted, destination: next.destination, status: next.status, crossed: next.crossed.map((c) => c.system) }, at: window.__where(gid)[0][0] };
    }, ROUTE);
    evidence.push({ check: 'RELAY-EN-ROUTE', ...r });
    assert.equal(r.linkedB, false, 'precondition: B is linked');
    assert.equal(r.given, false);
    assert.equal(r.queued.length, 1); assert.equal(r.queued[0].status, 'queued'); assert.equal(r.queued[0].systemIndex, r.B);
    assert.equal(r.afterB.orders[0].status, 'queued', 'received at B, which has no link');
    assert.equal(r.afterB.to, r.C, 'the formation turned at B');
    assert.equal(r.orders[0].status, 'acknowledged'); assert.equal(r.orders[0].ack, r.crossC.day, 'not received the day the leg ended at C');
    assert.equal(r.oldStatus, 'superseded');
    assert.equal(r.next.plotFrom, r.C); assert.equal(r.next.depart, r.crossC.day); assert.equal(r.next.legIndex, 0);
    assert.equal(r.next.status, 'arrived'); assert.equal(r.at, r.A);
    assert.ok(!r.next.crossed.includes(r.D), 'the old route was flown on to D');
  });

  // Evidence: a formation progressing across the chart, leg by leg, in the fleet manager and on the map.
  await check('new-feature', 'EVIDENCE the fleet manager row and the chart layer show the journey as it progresses: leg, crossed systems, position', async () => {
    await fresh('fr-evidence');
    const legs = await ev((R) => {
      const t = testBM1;
      const [A, , , D] = [R.A, R.B, R.C, R.D].map(window.__idx);
      const gid = window.__formation('Task Force', A);
      window.__g(gid).destination = D;
      t.dispatchFleetFormation(gid);
      window.__gid = gid;
      return window.__g(gid).travel.legDays;
    }, ROUTE);
    const lines = [];
    const frame = async (tag) => {
      const st = await ev(() => { const t = testBM1; t.renderFleetManager(true); const el = document.querySelector(`[data-formation-travel="${window.__gid}"]`); el?.scrollIntoView({ block: 'center' }); return { line: el?.textContent || '', member: t.fleetTradeStatusLine(window.__members(window.__gid)[0]), day: t.state.day }; });
      lines.push({ tag, ...st });
      await shot(`FORMATION-ROUTE-${tag}-fleet.png`);
      await ev(() => { const t = testBM1; document.querySelectorAll('dialog[open]').forEach((d) => d.close()); t.openMap(); const s = t.state; const i = window.__idx('Tellar'); t.focusStarChartOnSystem?.(i); t.render?.(); });
      await page.waitForTimeout(150);
      await shot(`FORMATION-ROUTE-${tag}-chart.png`);
      await ev(() => testBM1.closeMap());
    };
    await frame('0-dispatched');
    const advanceTo = async (n) => ev((n) => { const g = window.__g(window.__gid); let guard = 0; while (g.travel.crossed.length < n && guard++ < 60) window.__adv(1); window.__adv(Math.max(0, 3)); }, n);
    await advanceTo(1); await frame('1-past-Orion');
    await advanceTo(2); await frame('2-past-Tellar');
    await ev(() => { const g = window.__g(window.__gid); let guard = 0; while (g.travel.status === 'underway' && guard++ < 60) window.__adv(1); });
    await frame('3-arrived-Vulcan');
    evidence.push({ check: 'EVIDENCE', legs, lines });
    assert.match(lines[0].line, /leg 1\/3 Earth → Orion/);
    assert.match(lines[1].line, /leg 2\/3 Orion → Tellar/); assert.match(lines[1].line, /crossed Orion/);
    assert.match(lines[2].line, /leg 3\/3 Tellar → Vulcan/); assert.match(lines[2].line, /crossed Orion, Tellar/);
    assert.match(lines[3].line, /Arrived at Vulcan day \d+ via Orion, Tellar/);
    assert.match(lines[1].member, /With Task Force · Tellar day \d+ · Vulcan day \d+/);
  });

  fs.writeFileSync(path.join(out, 'formation-route-evidence.json'), JSON.stringify(evidence, null, 1));
  const failed = results.filter((x) => !x.ok);
  const byCat = {};
  for (const x of results) { byCat[x.category] ||= { pass: 0, total: 0 }; byCat[x.category].total++; if (x.ok) byCat[x.category].pass++; }
  console.log(`\nformation route: ${results.length - failed.length}/${results.length} passed`, JSON.stringify(byCat));
  if (probe.errors.length) console.log('page errors:', probe.errors.slice(0, 5));
  await probe.close();
  process.exit(failed.length || probe.errors.length ? 1 : 0);
})();
