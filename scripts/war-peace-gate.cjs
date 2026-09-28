// Gate for bilateral war and peace, stacked on c528f75.
// Rules: docs/playtest/BILATERAL-WAR-PEACE-RULES-260130ZSEP26.md.
//
// Peace is a state transition across the campaign: diplomacy, operations, war-only objectives, future
// planning, territory, reporting and save/load all have to agree afterwards. Categories as in
// section6-verification-gate.cjs:
//   baseline-defect  reproduces a wrong behaviour of c528f75
//   new-feature      needs a state c528f75 does not have (ceasefire, territory terms, the empire's own wars)
//   preservation     must hold on both
const assert = require('node:assert/strict');
const path = require('node:path');
const { startProbe } = require('./probe-harness.cjs');

(async () => {
  const probe = await startProbe({ pageOptions: { deviceScaleFactor: 2 } });
  const { ev, fresh, page } = probe;
  const out = process.env.BM1_TEST_OUTPUT || '/tmp';
  const results = [];
  async function check(category, name, fn) {
    try { await fn(); results.push({ category, name, ok: true }); console.log('PASS', `[${category}]`, name); }
    catch (err) { results.push({ category, name, ok: false, message: String(err?.message || err).split('\n').slice(0, 6).join(' ') }); console.log('FAIL', `[${category}]`, name, '\n      ', String(err?.message || err).split('\n').slice(0, 8).join(' ')); }
  }

  await page.evaluate(() => {
    const t = testBM1;
    window.__advance = (days) => { for (let i = 0; i < days; i++) t.advanceFleetCalendar(1, t.Fleet.nextId(t.fleetBook(), 'journey')); };
    window.__status = (a, b) => t.worldRelation(a, b).status;
    window.__stateOf = (a, b) => { const k = [a, b].sort().join(':'); const st = t.campaign().warStates?.[k]; return st ? { status: st.status, warId: st.warId, settlement: st.settlement, offer: st.offer, lastEval: st.lastEval } : null; };
    // Author a war's cost the way the campaign fixtures do: the ledger, the hulls, the front.
    window.__grind = (a, b, { keepA = 0.45, keepB = 0.45, engagements = 25, stallDays = 120 } = {}) => {
      const book = t.campaign();
      const w = t.Campaign.warRecord(book, a, b);
      w.engagements = (w.engagements || 0) + engagements; w.firstDay ??= 1; w.lastDay = t.state.day;
      w.losses[a] = (w.losses[a] || 0) + 12; w.losses[b] = (w.losses[b] || 0) + 11;
      w.front = (w.front || []).map((f) => ({ ...f, day: Math.min(f.day, t.state.day - stallDays) }));
      for (const [id, keep] of [[a, keepA], [b, keepB]]) {
        const p = t.Campaign.getPolity(book, id);
        if (!p) continue;
        const living = p.hulls.filter((h) => h.status !== 'lost');
        p.readinessPeak = Math.max(p.readinessPeak || 0, p.readinessBaseline || 0);
        for (const h of living.slice(Math.max(1, Math.round(living.length * keep)))) { h.status = 'lost'; h.hull = 0; }
      }
      const st = book.warStates?.[[a, b].sort().join(':')];
      if (st) { st.startedDay = Math.min(st.startedDay, t.state.day - 150); st.statusSince = st.startedDay; }
      // Nothing between the pair is in the air while the authored state settles.
      for (const op of book.operations) if (op.status !== 'resolved' && [a, b].includes(op.faction)) { op.status = 'resolved'; op.outcome = 'withdrew'; op.resolvedDay = t.state.day; for (const h of t.Campaign.operationHulls(book, op)) { h.opId = null; if (h.status !== 'lost') h.status = 'ready'; } }
    };
    // A world taken by `by` from `from`, through the real capture record.
    window.__take = (systemIndex, by, from) => {
      const book = t.campaign();
      if (by === 'player') t.transferSystemControlToPlayer(systemIndex); else t.transferSystemControlToFaction(systemIndex, by);
      // transferSystemControl* records the capture through the campaign hook; make sure it exists.
      if (!book.occupations[systemIndex]) t.Campaign.recordCapture(book, t.buildCampaignWorld(true), systemIndex, by, from, t.state.day);
    };
    window.__terr = (i) => (t.campaign().territory || {})[i] || null;
    window.__terrText = (x) => (t.territoryStatusText && x ? t.territoryStatusText(x) : '');
    window.__worldsOf = (id) => t.buildCampaignWorld(true).systems.filter((s) => s.controller === id).map((s) => s.index);
  });

  // 1 ---------------------------------------------------------------------------------------------
  await check('preservation', 'WAR-ACTIVE the Terran–Klingon war stays active while both have capacity and the front is moving', async () => {
    await fresh('wp-active');
    const r = await ev(() => {
      const t = testBM1, s = t.state;
      const terran = window.__worldsOf('terran').filter((i) => t.getSystemControl(i).origin === 'terran');
      const klingon = window.__worldsOf('klingon');
      const statuses = [];
      for (let k = 0; k < 6; k++) {
        // The front moves every twenty days: worlds change hands both ways.
        if (k % 2 === 0) window.__take(terran[k], 'klingon', 'terran'); else window.__take(klingon[k], 'terran', 'klingon');
        window.__advance(20);
        statuses.push(window.__status('terran', 'klingon'));
      }
      return { statuses, day: s.day, eval: window.__stateOf('terran', 'klingon')?.lastEval };
    });
    assert.ok(r.statuses.every((x) => x === 'war'), `the war ended while the front moved: ${r.statuses}`);
  });

  await check('baseline-defect', 'WAR-NO-CALENDAR a war between two AI powers with capacity and a moving front is not ended by a calendar roll', async () => {
    await fresh('wp-calendar');
    const r = await ev(() => {
      const t = testBM1;
      // This check is about the diplomacy calendar. AI evacuations and blockades are switched off so
      // that the front moves only as the fixture moves it: under BLOCKADE-RUNNING-RULES an AI
      // evacuation convoy runs differently, and on this seed that alone decided whether a fourth
      // Cardassian world fell and a (legitimate) decisive settlement ended the war. [f2837a7]
      t.campaign().config.aiStrategicOps = false;
      // Likewise faction doctrine's phase 3 military execution (area patrols and command defence): on this
      // seed either one alone leaves the front as the fixture moves it, both together tip a fifth Romulan
      // world and a legitimate decisive peace (docs/doctrine/DOCTRINE-RUNTIME-PHASE3.md §11).
      t.applyDebugCommand('doctrine military off');
      t.changeDiplomacy('romulan', 'cardassian', 'war');
      const rom = window.__worldsOf('romulan'), car = window.__worldsOf('cardassian');
      const statuses = [];
      for (let k = 0; k < 8; k++) {
        if (k % 2 === 0) window.__take(car[k], 'romulan', 'cardassian'); else window.__take(rom[k], 'cardassian', 'romulan');
        window.__advance(15);
        statuses.push(window.__status('romulan', 'cardassian'));
      }
      const hist = t.diplomacyBook().history.filter((e) => [e.a, e.b].sort().join(':') === 'cardassian:romulan').map((e) => `${e.day}:${e.status}:${e.reason}`);
      // And the engine's own calendar, run on this pair alone for 600 days on a copy of the real book:
      // the in-game run above only draws this pair now and then, so it cannot show the roll by itself.
      const copy = JSON.parse(JSON.stringify(t.diplomacyBook()));
      t.World.advanceDiplomacy(copy, copy.lastDay + 600, [['romulan', 'cardassian']], () => false);
      const calendar = t.World.relation(copy, 'romulan', 'cardassian').status;
      const calendarWhy = copy.history.filter((e) => [e.a, e.b].sort().join(':') === 'cardassian:romulan').map((e) => e.reason).slice(-1)[0] || null;
      return { statuses, hist, calendar, calendarWhy };
    });
    assert.ok(r.statuses.every((x) => x === 'war'), `a calendar roll ended a live war: ${r.statuses} / ${r.hist.join(' | ')}`);
    assert.equal(r.calendar, 'war', `the calendar ended the war on its own: ${r.calendarWhy}`);
  });

  // 2 ---------------------------------------------------------------------------------------------
  await check('baseline-defect', 'WAR-STALEMATE a long, costly, stalled Terran–Klingon war becomes a ceasefire and then a settlement, without inventing a winner', async () => {
    await fresh('wp-stalemate');
    const r = await ev(() => {
      const t = testBM1;
      window.__advance(3);
      window.__grind('terran', 'klingon', { keepA: 0.45, keepB: 0.45 });
      window.__advance(2);
      const first = { status: window.__status('terran', 'klingon'), st: window.__stateOf('terran', 'klingon') };
      window.__advance(32);
      const later = { status: window.__status('terran', 'klingon'), st: window.__stateOf('terran', 'klingon') };
      return { first, later, earth: t.getSystemControl(t.getSystemIndexByName('Earth')).controller, qonos: t.getSystemControl(t.getSystemIndexByName('Qonos')).controller };
    });
    assert.equal(r.first.status, 'ceasefire', `no ceasefire: ${r.first.status} ${JSON.stringify(r.first.st?.lastEval?.reasons)}`);
    assert.equal(r.later.status, 'peace', `the ceasefire did not settle: ${r.later.status}`);
    assert.equal(r.later.st.settlement.winner, null, 'a stalemate settlement named a winner');
    assert.match(r.later.st.settlement.reason, /ceasefire held/);
    assert.equal(r.earth, 'terran'); assert.equal(r.qonos, 'klingon');
  });

  // 3 ---------------------------------------------------------------------------------------------
  await check('baseline-defect', 'WAR-DECISIVE a decisively weakened Klingon Empire settles while it still holds worlds, Qonos included', async () => {
    await fresh('wp-decisive');
    const r = await ev(() => {
      const t = testBM1;
      window.__advance(3);
      const kl = window.__worldsOf('klingon').filter((i) => state_name(i) !== 'Qonos');
      function state_name(i) { return t.state.planets[i].name; }
      const take = kl.slice(0, Math.ceil(kl.length * 0.4));
      for (const i of take) window.__take(i, 'terran', 'klingon');
      window.__grind('terran', 'klingon', { keepA: 0.9, keepB: 0.2 });
      window.__advance(2);
      return { status: window.__status('terran', 'klingon'), st: window.__stateOf('terran', 'klingon'), left: window.__worldsOf('klingon').length, qonos: t.getSystemControl(t.getSystemIndexByName('Qonos')).controller, taken: take.length };
    });
    assert.equal(r.status, 'peace', `no settlement: ${JSON.stringify(r.st?.lastEval)}`);
    assert.equal(r.st.settlement.basis, 'decisive');
    assert.equal(r.st.settlement.winner, 'terran');
    assert.ok(r.left > 0, 'the settlement needed every Klingon world to fall');
    assert.equal(r.qonos, 'klingon');
    assert.ok(r.st.settlement.terms.filter((x) => x.status === 'retained').length >= 1, 'the winner did not keep what it took');
  });

  // 4 ---------------------------------------------------------------------------------------------
  await check('preservation', 'WAR-BILATERAL a Terran–Klingon peace changes no other pair: Romulan–Cardassian and every other war stay as they were', async () => {
    await fresh('wp-bilateral');
    const r = await ev(() => {
      const t = testBM1;
      t.changeDiplomacy('romulan', 'cardassian', 'war');
      const keys = Object.keys(t.factionDefs ? {} : {});
      const factions = ['terran', 'klingon', 'romulan', 'cardassian', 'vulcan', 'andorian', 'ferengi', 'tholian', 'breen', 'bajoran', 'sona'];
      const snap = () => { const o = {}; for (let i = 0; i < factions.length; i++) for (let j = i + 1; j < factions.length; j++) o[`${factions[i]}:${factions[j]}`] = window.__status(factions[i], factions[j]); return o; };
      const before = snap();
      t.changeDiplomacy('terran', 'klingon', 'peace');
      const after = snap();
      const changed = Object.keys(before).filter((k) => before[k] !== after[k]);
      return { changed, rc: after['romulan:cardassian'] };
    });
    assert.deepEqual(r.changed, ['terran:klingon']);
    assert.equal(r.rc, 'war');
  });

  // 5 & 6 -----------------------------------------------------------------------------------------
  await check('new-feature', 'CEASE-NO-ATTACKS a ceasefire stands down operations in transit the same day, closes their contracts, and no new attack is planned for 30 days', async () => {
    await fresh('wp-transit');
    const r = await ev(() => {
      const t = testBM1, s = t.state, book = t.campaign();
      window.__advance(3);
      // A Klingon operation already on its way to a Terran world.
      const target = window.__worldsOf('terran').find((i) => i !== t.getSystemIndexByName('Earth'));
      const hulls = t.Campaign.getPolity(book, 'klingon').hulls.filter((h) => h.status === 'ready' && !h.opId).slice(0, 4);
      const op = t.Campaign.launchOperation(book, t.buildCampaignWorld(true), 'klingon', hulls, target, s.day, 6, 'assault', []);
      op.arriveDay = s.day + 6;
      const mission = t.offerStationMission('escort', target, true);
      if (mission) t.Campaign.acceptMission(book, mission.id, s.day);
      window.__grind('terran', 'klingon', { keepA: 0.45, keepB: 0.45 });
      // __grind resolves ops in the air; relaunch the one under test after it.
      op.status = 'moving'; op.outcome = null; op.resolvedDay = null; for (const h of hulls) { if (h.status !== 'lost') { h.opId = op.id; h.status = 'assigned'; } }
      op.hullIds = hulls.filter((h) => h.status !== 'lost').map((h) => h.id);
      window.__advance(1);
      const cease = window.__status('terran', 'klingon');
      const opNow = book.operations.find((o) => o.id === op.id);
      const snapshot = { status: opNow.status, outcome: opNow.outcome };
      const launchedBefore = book.operations.length;
      window.__advance(30);
      const newOps = book.operations.filter((o) => o.createdDay > s.day - 30 && ((o.faction === 'klingon' && t.getSystemControl(o.targetSystem).controller === 'terran') || (o.faction === 'terran' && t.getSystemControl(o.targetSystem).controller === 'klingon')));
      const arrived = book.history.filter((h) => h.opId === op.id && h.kind === 'engagement');
      return { cease, snapshot, newOps: newOps.length, arrived: arrived.length, target, held: t.getSystemControl(target).controller, mission: mission ? book.missions.find((m) => m.id === mission.id) : null };
    });
    assert.equal(r.cease, 'ceasefire', 'precondition: no ceasefire');
    assert.deepEqual(r.snapshot, { status: 'resolved', outcome: 'stood-down' }, 'the operation in transit was not stood down');
    assert.equal(r.arrived, 0, 'the fleet arrived and engaged after the ceasefire');
    assert.equal(r.held, 'terran');
    assert.equal(r.newOps, 0, `${r.newOps} new operations between the parties during the ceasefire`);
    if (r.mission) { assert.equal(r.mission.status, 'failed'); assert.match(r.mission.reason, /ceasefire/); }
  });

  // local scene --------------------------------------------------------------------------------------
  await check('preservation', 'LOCAL-RECONCILE after peace a Klingon raid in a Terran system stands down; a Klingon ship that fires first is still answered in self-defence', async () => {
    await fresh('wp-local');
    const r = await ev(() => {
      const t = testBM1, s = t.state;
      t.spawnFleetAttack(s.currentPlanet, 'klingon');
      const raiders = s.npcShips.filter((n) => n.attackId && n.faction === 'klingon');
      const before = { attack: Boolean(s.activeFleetAttack), raiders: raiders.length };
      t.changeDiplomacy('terran', 'klingon', 'peace');
      const after = { attack: Boolean(s.activeFleetAttack), withdrawing: raiders.filter((n) => n.role === 'ceasefireWithdrawal' && !n.attackId).length };
      const patrol = s.npcShips.find((n) => !n.destroyed && n.faction === 'terran' && n.role === 'patrol') || null;
      const k = raiders[0];
      const quiet = patrol && k ? t.isNpcSystemAttacker(k, patrol) : null;
      if (k && patrol) { k.lastAggressionAt = t.gameNow(); k.lastAggressionSystemIndex = s.currentPlanet; k.lastAggressionTargetSide = t.getNpcSideId ? t.getNpcSideId(patrol) : 'terran'; }
      const provoked = patrol && k ? t.isNpcSystemAttacker(k, patrol) : null;
      return { before, after, quiet, provoked, patrol: Boolean(patrol) };
    });
    assert.ok(r.before.attack && r.before.raiders > 0, 'precondition: no Klingon raid spawned');
    assert.equal(r.after.attack, false, 'the raid kept its war authority after the peace');
    assert.equal(r.after.withdrawing, r.before.raiders, 'raiders kept their war orders');
    if (r.patrol) { assert.equal(r.quiet, false, 'a Terran defender still treats a peaceful Klingon as a war target'); assert.equal(r.provoked, true, 'self-defence stopped working after the peace'); }
  });

  // 8 ---------------------------------------------------------------------------------------------
  await check('new-feature', 'INCIDENT-NEW-WAR hostile acts after the empire\'s peace escalate to a NEW war instance; nothing from the old war is revived', async () => {
    await fresh('wp-incident');
    const r = await ev(() => {
      const t = testBM1, s = t.state, book = t.campaign();
      const rel0 = t.playerRelation ? t.playerRelation('klingon') : null;
      if (!rel0 || rel0.status !== 'war') return { fail: `precondition: the empire is not at war with the Klingons (${rel0?.status})` };
      const oldWar = rel0.warId;
      // Peace through the same path as a settlement.
      const eff = t.Campaign.forceWarTransition(book, t.buildCampaignWorld(true), 'player', 'klingon', 'peace', s.day, 'test settlement');
      t.applyCampaignEffects(eff, s.day);
      const peace = t.playerRelation('klingon').status;
      const resolvedOps = book.operations.filter((o) => o.status === 'resolved').map((o) => o.id);
      const steps = [];
      for (let i = 0; i < 4; i++) steps.push(t.recordPlayerHostileAct('klingon', 'ship'));
      const rel = t.playerRelation('klingon');
      window.__advance(2);
      const revived = book.operations.filter((o) => resolvedOps.includes(o.id) && o.status !== 'resolved').length;
      const st = book.warStates[['klingon', 'player'].sort().join(':')];
      // During a ceasefire, one act breaks it.
      const eff2 = t.Campaign.forceWarTransition(book, t.buildCampaignWorld(true), 'player', 'klingon', 'ceasefire', s.day, 'test ceasefire');
      t.applyCampaignEffects(eff2, s.day);
      const beforeBreak = t.playerRelation('klingon');
      t.recordPlayerHostileAct('klingon', 'ship');
      const broken = t.playerRelation('klingon');
      return { fail: null, peace, steps, status: rel.status, oldWar, newWar: rel.warId, revived, instanceWar: st?.warId, ceasefire: beforeBreak.status, broken: broken.status, brokenId: broken.warId };
    });
    assert.ok(!r.fail, r.fail);
    assert.equal(r.peace, 'peace');
    assert.deepEqual(r.steps.slice(0, 2), ['peace', 'crisis']);
    assert.equal(r.status, 'war', `four incidents did not lead to war: ${r.steps}`);
    assert.notEqual(r.newWar, r.oldWar, 'the old war was revived rather than a new one begun');
    assert.equal(r.revived, 0, 'a stood-down operation came back');
    assert.equal(r.instanceWar, r.newWar);
    assert.equal(r.ceasefire, 'ceasefire');
    assert.equal(r.broken, 'war', 'a hostile act during a ceasefire did not break it');
    assert.notEqual(r.brokenId, r.newWar);
  });

  // 9–11 ------------------------------------------------------------------------------------------
  await check('new-feature', 'TERRITORY a ceasefire leaves occupied worlds occupied; the settlement returns one and marks another disputed, per the terms', async () => {
    await fresh('wp-territory');
    const r = await ev(() => {
      const t = testBM1, s = t.state, book = t.campaign();
      window.__advance(3);
      // Two Terran-people worlds taken by the Klingons.
      const tw = window.__worldsOf('terran').filter((i) => t.getSystemControl(i).origin === 'terran' && t.state.planets[i].name !== 'Earth');
      const [w1, w2] = tw;
      window.__take(w1, 'klingon', 'terran'); window.__take(w2, 'klingon', 'terran');
      window.__grind('terran', 'klingon', { keepA: 0.45, keepB: 0.45 });
      window.__advance(1);
      const cease = { status: window.__status('terran', 'klingon'), w1: t.getSystemControl(w1).controller, t1: window.__terr(w1), text: window.__terrText(window.__terr(w1)) };
      // Terms are read at settlement: make the Terrans the stronger party, then settle.
      const kh = t.Campaign.getPolity(book, 'klingon').hulls.filter((h) => h.status !== 'lost');
      for (const h of kh.slice(Math.max(1, Math.round(kh.length * 0.6)))) { h.status = 'lost'; h.hull = 0; }
      const st = book.warStates?.['klingon:terran'] || {};
      // The ceasefire's 30 quiet days are tested in WAR-STALEMATE; here the settlement window is shortened
      // so third powers do not take the occupied worlds in the meantime. The rule under test is the terms.
      book.config.warRules = { ceasefireSettleDays: 2 };
      window.__advance(3);
      const settled = { status: window.__status('terran', 'klingon'), w1: t.getSystemControl(w1).controller, w2: t.getSystemControl(w2).controller, t1: window.__terr(w1), t2: window.__terr(w2), terms: st.settlement?.terms };
      // Disputed: a Klingon-people world held by the Terrans where the Terrans are stronger… and the
      // reverse where the claimant is weaker. Author one directly through the model's own terms function.
      return { cease, settled };
    });
    assert.equal(r.cease.status, 'ceasefire', 'precondition: no ceasefire');
    assert.equal(r.cease.w1, 'klingon', 'the ceasefire handed the world back');
    assert.equal(r.cease.t1.status, 'occupied');
    assert.match(r.cease.text, /ceasefire, territory unresolved/);
    assert.equal(r.settled.status, 'peace');
    assert.equal(r.settled.w1, 'terran', `the stronger claimant did not get its world back: ${JSON.stringify(r.settled.terms)}`);
    assert.equal(r.settled.t1.status, 'returned');
  });

  await check('new-feature', 'TERRITORY-DISPUTED a settlement where the claimant is weaker leaves its people\'s world with the holder, marked disputed; control, culture and claim stay separate', async () => {
    await fresh('wp-disputed');
    const r = await ev(() => {
      const t = testBM1, book = t.campaign();
      window.__advance(3);
      const w = window.__worldsOf('terran').filter((i) => t.getSystemControl(i).origin === 'terran' && t.state.planets[i].name !== 'Earth')[0];
      window.__take(w, 'klingon', 'terran');
      window.__grind('terran', 'klingon', { keepA: 0.35, keepB: 0.6 });
      window.__advance(1);
      const cease = window.__status('terran', 'klingon');
      book.config.warRules = { ceasefireSettleDays: 2 };
      window.__advance(3);
      const c = t.getSystemControl(w);
      return { cease, status: window.__status('terran', 'klingon'), controller: c.controller, origin: c.origin, terr: window.__terr(w), text: window.__terrText(window.__terr(w)), terms: book.warStates?.['klingon:terran']?.settlement?.terms };
    });
    assert.equal(r.cease, 'ceasefire', 'precondition: no ceasefire');
    assert.equal(r.status, 'peace');
    assert.equal(r.terr.status, 'disputed', JSON.stringify(r.terms));
    assert.equal(r.controller, 'klingon');
    assert.equal(r.terr.claimant, 'terran');
    assert.equal(r.origin, 'terran', 'the settlement rewrote the world\'s people');
    assert.match(r.text, /disputed: held by Klingon/);
  });

  // 12 --------------------------------------------------------------------------------------------
  await check('new-feature', 'SAVELOAD war, ceasefire and peace records, territorial terms and a pending offer survive save/load exactly', async () => {
    await fresh('wp-save');
    const r = await ev(() => {
      const t = testBM1, s = t.state, book = t.campaign();
      window.__advance(3);
      const w = window.__worldsOf('terran').filter((i) => t.getSystemControl(i).origin === 'terran' && t.state.planets[i].name !== 'Earth')[0];
      window.__take(w, 'klingon', 'terran');
      window.__grind('terran', 'klingon');
      window.__advance(1);
      const read = () => JSON.stringify({ d: Object.fromEntries(Object.entries(t.diplomacyBook().pairs).sort()), ws: t.campaign().warStates, terr: t.campaign().territory, rel: window.__status('terran', 'klingon'), ctl: t.getSystemControl(w).controller });
      const before = read();
      t.saveGame(9); t.startWithFaction('ferengi'); t.loadGame(9);
      return { before, after: read(), cease: JSON.parse(before).rel };
    });
    assert.equal(r.cease, 'ceasefire', 'precondition: no ceasefire');
    assert.equal(r.after, r.before);
  });

  // 13 --------------------------------------------------------------------------------------------
  await check('new-feature', 'PLAYER-OFFER a war the empire made its own receives a ceasefire offer, accepted through the panel, and the same cleanup runs: operations against its worlds stand down, its occupied world stays occupied', async () => {
    await fresh('wp-player');
    const r = await ev(() => {
      const t = testBM1, s = t.state, book = t.campaign();
      if (!t.playerRelation || t.playerRelation('cardassian').status !== 'peace') return { fail: 'precondition: the empire did not start at peace with the Cardassians' };
      window.__advance(3);
      // The empire makes the war its own: incidents against Cardassian ships.
      for (let i = 0; i < 4; i++) t.recordPlayerHostileAct('cardassian', 'ship');
      if (t.playerRelation('cardassian').status !== 'war') return { fail: 'precondition: the incidents did not open a war' };
      window.__advance(1);
      // The empire holds a world it took from the Cardassians, and a Cardassian operation is bound for it.
      const held = window.__worldsOf('cardassian').filter((i) => t.state.planets[i].name !== 'Cardassia')[0];
      window.__take(held, 'player', 'cardassian');
      const hulls = t.Campaign.getPolity(book, 'cardassian').hulls.filter((h) => h.status === 'ready' && !h.opId).slice(0, 4);
      const op = t.Campaign.launchOperation(book, t.buildCampaignWorld(true), 'cardassian', hulls, held, s.day, 6, 'assault', []);
      op.arriveDay = s.day + 6;
      // A costly stall between the empire and the Cardassians (the size gap is waived for this fixture: the
      // captain's empire is small, and the rule under test is the offer and its cleanup).
      book.config.warRules = { stalemateMaxRatio: 1e9 };
      const w = t.Campaign.warRecord(book, 'player', 'cardassian'); w.engagements = 30; w.losses.player = 3; w.losses.cardassian = 5;
      const st = book.warStates['cardassian:player']; st.startedDay = s.day - 150; st.statusSince = st.startedDay;
      w.front = (w.front || []).map((f) => ({ ...f, day: s.day - 120 }));
      window.__advance(1);
      return { fail: null, offer: book.warStates['cardassian:player']?.offer, inheritedOffer: book.warStates['klingon:player']?.offer || null, held, opId: op.id };
    });
    assert.ok(!r.fail, r.fail);
    assert.ok(r.offer, 'no offer reached the empire');
    assert.equal(r.offer.to, 'ceasefire');
    await ev(() => { testBM1.openCampaignPanel('wars'); });
    await page.screenshot({ path: path.join(out, 'war-offer-to-empire.png') });
    await page.click('[data-war-accept="cardassian:player"]');
    const after = await ev(({ held, opId }) => {
      const t = testBM1, book = t.campaign();
      const op = book.operations.find((o) => o.id === opId);
      return { rel: t.playerRelation('cardassian').status, op: op && { status: op.status, outcome: op.outcome }, controller: t.getSystemControl(held).controller, terr: window.__terr(held), empireKlingon: t.playerRelation('klingon').status, govWar: t.formalRelation('terran', 'klingon').status };
    }, r);
    await ev(() => { testBM1.renderCampaignPanel(); document.querySelector('[data-war-pair="cardassian:player"]')?.scrollIntoView({ block: 'start' }); });
    await page.screenshot({ path: path.join(out, 'war-empire-ceasefire.png') });
    await ev(() => document.querySelector('[data-war-territory]')?.scrollIntoView({ block: 'start' }));
    await page.screenshot({ path: path.join(out, 'war-empire-ceasefire-occupied.png') });
    await ev(() => testBM1.closeCampaignPanel());
    assert.equal(after.rel, 'ceasefire');
    assert.deepEqual(after.op, { status: 'resolved', outcome: 'stood-down' });
    assert.equal(after.controller, 'player', 'the ceasefire handed the world back');
    assert.equal(after.terr.status, 'occupied');
    assert.equal(after.empireKlingon, 'war', 'the empire\'s Cardassian ceasefire moved its Klingon war');
    assert.equal(after.govWar, 'war', 'the empire\'s ceasefire ended the Terran government\'s war');
    assert.equal(r.inheritedOffer, null, 'an inherited war was offered terms of its own');
  });

  await check('new-feature', 'INHERITED-FOLLOWS the empire\'s inherited Klingon war follows the Terran settlement; on the winning side of a decisive peace it keeps the world it took', async () => {
    await fresh('wp-inherited');
    const r = await ev(() => {
      const t = testBM1, book = t.campaign();
      if (!t.playerRelation || t.playerRelation('klingon').status !== 'war') return { fail: 'precondition: the empire is not at war with the Klingons' };
      window.__advance(3);
      const kl = window.__worldsOf('klingon').filter((i) => t.state.planets[i].name !== 'Qonos');
      const mine = kl[0];
      window.__take(mine, 'player', 'klingon');
      for (const i of kl.slice(1, 1 + Math.ceil(kl.length * 0.4))) window.__take(i, 'terran', 'klingon');
      window.__grind('terran', 'klingon', { keepA: 0.9, keepB: 0.2 });
      window.__advance(2);
      return { fail: null, gov: window.__status('terran', 'klingon'), empire: t.playerRelation('klingon').status, basis: book.warStates['klingon:player']?.settlement?.basis, controller: t.getSystemControl(mine).controller, terr: window.__terr(mine) };
    });
    assert.ok(!r.fail, r.fail);
    assert.equal(r.gov, 'peace', 'precondition: no Terran–Klingon settlement');
    assert.equal(r.empire, 'peace', 'the inherited war did not follow its government');
    assert.equal(r.basis, 'co-belligerent');
    assert.equal(r.controller, 'player', 'the empire lost the world it took, though its side won');
    assert.equal(r.terr.status, 'retained');
  });

  // 14 --------------------------------------------------------------------------------------------
  await check('baseline-defect', 'FLAG-NO-WAR raising a flag does not start or end the empire\'s wars: the campaign\'s view of who may attack the empire does not change', async () => {
    await fresh('wp-flag');
    const r = await ev(() => {
      const t = testBM1, s = t.state;
      const read = () => { const w = t.buildCampaignWorld(true); const side = w.playerRelationSide || w.playerFaction; return { klingon: w.relation('klingon', side), romulan: w.relation('romulan', side), ferengi: w.relation('ferengi', side) }; };
      const before = read();
      s.playerFlags = [...new Set([...(s.playerFlags || []), 'ferengi'])];
      t.raisePlayerFlag('ferengi');
      const after = read();
      return { flag: t.getPlayerFlag(), before, after };
    });
    assert.equal(r.flag, 'ferengi', 'precondition: the flag did not change');
    assert.deepEqual(r.after, r.before, `the flag rewrote the empire's wars: ${JSON.stringify(r.before)} → ${JSON.stringify(r.after)}`);
  });

  // 15 & 16 ---------------------------------------------------------------------------------------
  await check('baseline-defect', 'REPORT-KNOWLEDGE a distant Romulan–Cardassian peace is not known the day it is signed; the account arrives through the captain\'s sources later', async () => {
    await fresh('wp-knowledge');
    const r = await ev(() => {
      const t = testBM1, s = t.state;
      // The captain knows both powers (has charted a world of each), but has nobody near either.
      for (const f of ['romulan', 'cardassian']) t.markSystemVisited(window.__worldsOf(f)[0]);
      t.changeDiplomacy('romulan', 'cardassian', 'war');
      t.collectGalaxyReports(s.day);
      t.changeDiplomacy('romulan', 'cardassian', 'peace');
      const signed = s.day;
      const isPeace = (x) => (x.factions || []).includes('romulan') && (x.factions || []).includes('cardassian') && /peace|settlement/i.test(`${x.kind} ${x.text}`) && x.day >= signed;
      t.collectGalaxyReports(s.day);
      const sameDay = t.visibleGalaxyReports().filter(isPeace).map((x) => x.id);
      window.__advance(12);
      const later = t.visibleGalaxyReports().filter(isPeace).map((x) => ({ id: x.id, day: x.day, category: t.galaxyReportCategory(x), confidence: x.confidence }));
      return { sameDay, later };
    });
    assert.deepEqual(r.sameDay, [], `the captain knew of a distant peace the day it was signed: ${r.sameDay}`);
    assert.ok(r.later.length >= 1, 'the peace never reached the captain');
  });

  await check('baseline-defect', 'REPORT-CATEGORY an AI settlement is Diplomacy news: not the Dominion Campaign Report and not the fronts folder', async () => {
    await fresh('wp-category');
    const r = await ev(() => {
      const t = testBM1, s = t.state, book = t.campaign();
      window.__advance(3);
      // A decisive Terran victory the captain sees from Earth: Qonos has fallen and the fleet is broken.
      const qonos = t.getSystemIndexByName('Qonos');
      window.__take(qonos, 'terran', 'klingon');
      window.__grind('terran', 'klingon', { keepA: 0.9, keepB: 0.1 });
      window.__advance(2);
      const reports = t.visibleGalaxyReports().filter((x) => (x.factions || []).includes('klingon') && (x.factions || []).includes('terran') && /peace|settlement|resolved/i.test(`${x.kind} ${x.text}`));
      return { status: window.__status('terran', 'klingon'), reports: reports.map((x) => ({ id: x.id, category: t.galaxyReportCategory(x), dominion: t.isDominionCampaignReport(x), text: x.text })) };
    });
    assert.equal(r.status, 'peace', 'precondition: no settlement');
    assert.ok(r.reports.length >= 1, 'no report of the settlement');
    for (const x of r.reports) {
      assert.equal(x.category, 'diplomacy', `filed under ${x.category}: ${x.id}`);
      assert.equal(x.dominion, false);
    }
  });

  // formal wars vs static hostility (correction to 3bbcf15) ----------------------------------------
  const NOT_AT_WAR = ['romulan', 'cardassian', 'breen', 'tholian', 'hirogen', 'suliban', 'gorn', 'dominion', 'dominion_remnant'];
  await check('baseline-defect', 'START-WARS-FORMAL a new Terran game starts with exactly the declared formal wars: the empire and the Terran government at war with the Klingons, and nothing else', async () => {
    await fresh('wp-start');
    const r = await ev((others) => {
      const t = testBM1;
      const pairs = t.campaignWarPairs().filter((p) => p.status === 'war').map((p) => [p.a, p.b].sort().join(':')).sort();
      const empire = Object.fromEntries(['klingon', ...others].map((f) => [f, t.playerRelation(f).status]));
      const terran = Object.fromEntries(others.map((f) => [f, t.formalRelation ? t.formalRelation('terran', f).status : t.buildCampaignWorld(true).relation('terran', f)]));
      return { pairs, empire, terran };
    }, NOT_AT_WAR);
    assert.deepEqual(r.pairs, ['klingon:player', 'klingon:terran'], `formal wars at start: ${r.pairs}`);
    assert.equal(r.empire.klingon, 'war');
    for (const f of NOT_AT_WAR) assert.notEqual(r.empire[f], 'war', `the empire starts formally at war with ${f}`);
    for (const f of NOT_AT_WAR.filter((f) => !['dominion', 'dominion_remnant'].includes(f))) assert.notEqual(r.terran[f], 'war', `the Terran government starts formally at war with ${f}`);
  });

  await check('baseline-defect', 'GORN-DORMANT the dormant Gorn never acquire a formal war through static hostility, over time or through the evaluator', async () => {
    await fresh('wp-gorn');
    const r = await ev(() => {
      const t = testBM1;
      window.__advance(40);
      const gorn = t.campaignWarPairs().filter((p) => [p.a, p.b].includes('gorn')).map((p) => `${p.a}:${p.b}:${p.status}`);
      const states = Object.keys(t.campaign().warStates || {}).filter((k) => k.split(':').includes('gorn'));
      return { gorn, states, empire: t.playerRelation('gorn').status };
    });
    assert.deepEqual(r.gorn, [], `formal Gorn wars: ${r.gorn}`);
    assert.deepEqual(r.states, []);
    assert.notEqual(r.empire, 'war');
  });

  await check('preservation', 'STATIC-LOCAL a hostile-but-not-at-war power still behaves hostile locally: attitude, and its ships on sight', async () => {
    await fresh('wp-static');
    const r = await ev(() => {
      const t = testBM1, s = t.state;
      const out = {};
      for (const f of ['romulan', 'cardassian']) {
        const npc = t.createNpcShip({ id: `static-${f}`, shipId: f === 'romulan' ? 29 : 314, faction: f, from: t.playerWorldPosition() });
        s.npcShips.push(npc);
        t.reconcileDiplomacy();
        out[f] = { attitude: t.getFactionAttitude(f), hostile: Boolean(npc.hostile), formal: t.formalRelation ? t.formalRelation('terran', f).status : null };
      }
      return out;
    });
    for (const f of ['romulan', 'cardassian']) {
      assert.equal(r[f].attitude, 'hostile', `${f} is no longer hostile on sight`);
      assert.equal(r[f].hostile, true);
    }
  });

  await check('baseline-defect', 'STATIC-ESCALATES incidents with a hostile-but-not-at-war power escalate to a real formal war with a fresh war instance', async () => {
    await fresh('wp-escalate');
    const r = await ev(() => {
      const t = testBM1;
      const before = t.playerRelation('cardassian');
      const steps = [];
      for (let i = 0; i < 4; i++) steps.push(t.recordPlayerHostileAct('cardassian', 'ship'));
      const after = t.playerRelation('cardassian');
      window.__advance(1);
      const listed = t.campaignWarPairs().some((p) => [p.a, p.b].sort().join(':') === 'cardassian:player' && p.status === 'war');
      const st = t.campaign().warStates?.['cardassian:player'];
      // An AI pair: a declaration opens its own instance.
      t.changeDiplomacy('romulan', 'cardassian', 'war');
      const ai = t.formalRelation ? t.formalRelation('romulan', 'cardassian') : null;
      return { before: before.status, steps, after: after.status, warId: after.warId, listed, instance: st?.warId, ai: ai && { status: ai.status, warId: ai.warId, started: ai.warStarted } };
    });
    assert.equal(r.before, 'peace', `the empire started at ${r.before} with the Cardassians`);
    assert.equal(r.steps[0], 'peace'); assert.ok(r.steps.includes('crisis'), `no crisis on the way: ${r.steps}`); assert.equal(r.steps.at(-1), 'war');
    assert.equal(r.after, 'war');
    assert.ok(r.warId, 'no war instance');
    assert.ok(r.listed, 'the new war does not reach the war evaluator');
    assert.equal(r.instance, r.warId);
    assert.equal(r.ai.status, 'war'); assert.ok(r.ai.warId && r.ai.started != null);
  });

  await check('new-feature', 'SAVELOAD-FORMAL the explicit formal war set survives save/load exactly, and no static hostility is added on the way back', async () => {
    await fresh('wp-save-formal');
    const r = await ev(() => {
      const t = testBM1;
      for (let i = 0; i < 4; i++) t.recordPlayerHostileAct('cardassian', 'ship');
      const read = () => JSON.stringify(t.campaignWarPairs().map((p) => `${[p.a, p.b].sort().join(':')}:${p.status}:${p.warId}`).sort());
      const before = read();
      t.saveGame(8); t.startWithFaction('ferengi'); t.loadGame(8);
      return { before, after: read() };
    });
    assert.equal(r.after, r.before);
    assert.deepEqual(JSON.parse(r.before).map((x) => x.split(':').slice(0, 2).join(':')).sort(), ['cardassian:player', 'klingon:player', 'klingon:terran']);
  });

  await check('baseline-defect', 'INHERITED-ONE-REPORT an inherited Terran–Klingon settlement is one diplomatic event to the captain; the government and the empire\'s records both move', async () => {
    await fresh('wp-one-report');
    const r = await ev(() => {
      const t = testBM1, s = t.state;
      window.__advance(3);
      const qonos = t.getSystemIndexByName('Qonos');
      const kl = window.__worldsOf('klingon').filter((i) => i !== qonos);
      for (const i of kl.slice(0, Math.ceil(kl.length * 0.4))) window.__take(i, 'terran', 'klingon');
      window.__grind('terran', 'klingon', { keepA: 0.9, keepB: 0.2 });
      const from = s.day;
      window.__advance(2);
      const news = t.galaxyNewsBook();
      const rows = [...news.items, ...news.pending].filter((x) => x.day >= from && (x.factions || []).includes('klingon') && /peace|settlement|ceasefire/i.test(`${x.kind} ${x.text}`));
      window.__advance(3);
      const offers = [...news.items, ...news.pending].filter((x) => x.day >= from && /^diplomacy:offer:/.test(x.id) && (x.factions || []).includes('klingon'));
      return { gov: window.__status('terran', 'klingon'), empire: t.playerRelation('klingon').status, rows: rows.map((x) => ({ id: x.id, kind: x.kind, text: x.text, category: t.galaxyReportCategory(x) })), offers: offers.map((x) => x.text), inheritedOffer: t.campaign().warStates['klingon:player']?.offer || null };
    });
    assert.deepEqual(r.offers, [], 'the inherited war produced an offer of its own');
    assert.equal(r.inheritedOffer, null);
    assert.equal(r.gov, 'peace', 'precondition: no settlement');
    assert.equal(r.empire, 'peace', 'the inherited war did not follow');
    assert.equal(r.rows.length, 1, `the captain received ${r.rows.length} treaty reports: ${r.rows.map((x) => x.text).join(' | ')}`);
    assert.match(r.rows[0].text, /settlement also applies to your empire/);
    assert.equal(r.rows[0].category, 'diplomacy');
  });

  // screenshots -----------------------------------------------------------------------------------
  await check('new-feature', 'SHOTS an active war, a ceasefire/peace report, unresolved occupation and a returned world', async () => {
    await fresh('wp-shots');
    await ev(() => { window.__advance(3); testBM1.openCampaignPanel('wars'); });
    await page.screenshot({ path: path.join(out, 'war-active-empire.png') });
    await ev(() => testBM1.closeCampaignPanel());
    const r = await ev(() => {
      const t = testBM1, s = t.state, book = t.campaign();
      const tw = window.__worldsOf('terran').filter((i) => t.getSystemControl(i).origin === 'terran' && t.state.planets[i].name !== 'Earth');
      window.__take(tw[0], 'klingon', 'terran');
      window.__grind('terran', 'klingon', { keepA: 0.45, keepB: 0.45 });
      window.__advance(1);
      const cease = window.__status('terran', 'klingon');
      const kh = t.Campaign.getPolity(book, 'klingon').hulls.filter((h) => h.status !== 'lost');
      for (const h of kh.slice(Math.max(1, Math.round(kh.length * 0.6)))) { h.status = 'lost'; h.hull = 0; }
      book.config.warRules = { ceasefireSettleDays: 2 };
      window.__advance(3);
      return { cease, status: window.__status('terran', 'klingon'), returned: window.__terr(tw[0])?.status, name: t.state.planets[tw[0]].name };
    });
    await ev(() => { const t = testBM1; t.openGalaxyReports(); document.querySelector('[data-report-folder="diplomacy"]')?.click(); });
    await page.screenshot({ path: path.join(out, 'war-diplomacy-reports.png') });
    await ev(() => testBM1.closeGalaxyReports());
    await ev(() => { testBM1.openCampaignPanel('wars'); document.querySelector('[data-war-territory]')?.scrollIntoView({ block: 'start' }); });
    await page.screenshot({ path: path.join(out, 'war-settled-returned.png') });
    const listed = await ev((name) => [...document.querySelectorAll('[data-territory]')].map((e) => e.textContent).find((x) => x.includes(name)) || null, r.name);
    await ev(() => testBM1.closeCampaignPanel());
    assert.equal(r.cease, 'ceasefire');
    assert.equal(r.status, 'peace');
    assert.equal(r.returned, 'returned');
    assert.match(listed || '', /returned to Terran by settlement/, 'the returned world is not shown once its terms were reported');
  });

  await probe.close();
  const cats = {};
  for (const r of results) { cats[r.category] ||= { pass: 0, total: 0 }; cats[r.category].total++; if (r.ok) cats[r.category].pass++; }
  console.log('\nSummary by category:');
  for (const [c, v] of Object.entries(cats)) console.log(`  ${c}: ${v.pass}/${v.total}`);
  const failed = results.filter((r) => !r.ok);
  console.log(`${results.length - failed.length}/${results.length} war/peace checks passed.`);
  process.exit(failed.length ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
