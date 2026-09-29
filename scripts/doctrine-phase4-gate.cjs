// Gate for faction doctrine runtime phase 4 (enforcement, compliance, surrender, bounded predation),
// stacked on 6e9a1d5. Rules: docs/doctrine/DOCTRINE-RUNTIME-PHASE4.md.
//
// Categories:
//   baseline-defect  fails on 6e9a1d5 on its own assertion: a pirate within reach opens fire on a captain
//                    who was never asked for anything and never refused
//   new-feature      needs state 6e9a1d5 does not have
//   preservation     must hold on both (a checkpoint refusal is still a record, not a target; lawful
//                    transit draws nothing)
//
// Local scenes step the real frame update (tick) on the game clock, the same bounded frame delta the
// loop uses; campaign scenes advance whole days through the ordinary journey calendar.
const assert = require('node:assert/strict');
const path = require('node:path');
const fs = require('node:fs');
const { startProbe } = require('./probe-harness.cjs');

(async () => {
  const probe = await startProbe({ viewport: { width: 1400, height: 900 }, pageOptions: { deviceScaleFactor: 2 } });
  const { ev, page } = probe;
  const out = process.env.BM1_TEST_OUTPUT || '/tmp';
  fs.mkdirSync(out, { recursive: true });
  const results = [];
  const evidence = [];
  const only = process.env.BM1_GATE_ONLY ? new RegExp(process.env.BM1_GATE_ONLY) : null;
  async function check(category, name, fn) {
    if (only && !only.test(name)) return;
    try { await fn(); results.push({ category, name, ok: true }); console.log('PASS', `[${category}]`, name); }
    catch (err) { results.push({ category, name, ok: false, message: String(err?.message || err).split('\n').slice(0, 6).join(' ') }); console.log('FAIL', `[${category}]`, name, '\n      ', String(err?.message || err).split('\n').slice(0, 8).join(' ')); }
  }
  async function shotDoctrine(file, only = null) {
    await ev((only) => {
      const d = document.getElementById('cheats-debug'); if (!d.open) testBM1.openDebugMenu();
      d.style.maxHeight = 'none'; d.style.height = 'auto'; d.style.width = '1360px'; d.style.maxWidth = 'none'; d.style.overflow = 'visible'; d.style.position = 'absolute'; d.style.top = '0';
      const sec = document.querySelector('[data-doctrine-debug]') || document.querySelector('[data-doctrine-section]');
      if (only) {
        let keep = false;
        for (const el of [...sec.children]) {
          if (el.tagName === 'H4') keep = only.some((h) => el.textContent.startsWith(h));
          else if (el.tagName === 'P' && !el.previousElementSibling) keep = true;
          if (el.tagName === 'FORM' || el.classList.contains('debug-actions')) keep = false;
          el.style.display = keep || (el.tagName === 'P' && el === sec.firstElementChild) ? '' : 'none';
        }
      }
    }, only);
    const h = await ev(() => Math.ceil(document.querySelector('[data-doctrine-section]').getBoundingClientRect().bottom + window.scrollY + 40));
    await page.setViewportSize({ width: 1400, height: Math.min(16000, Math.max(900, h)) });
    await page.locator('[data-doctrine-section]').screenshot({ path: path.join(out, file) });
    await page.setViewportSize({ width: 1400, height: 900 });
    await ev(() => { const d = document.getElementById('cheats-debug'); d.removeAttribute('style'); for (const el of document.querySelectorAll('[data-doctrine-debug] > *, [data-doctrine-section] *')) el.style.display = ''; d.close(); });
  }
  // The loaded scene as the captain sees it: one rendered frame and the viewport.
  async function shotScene(file) {
    await ev(() => { testBM1.render(); testBM1.updateSecurityOrderPanel(); });
    await page.screenshot({ path: path.join(out, file) });
  }
  const click = async (selector) => { await page.locator(selector).first().click(); };
  await page.waitForFunction(() => !testBM1.doctrineStatus || testBM1.doctrineStatus().state !== 'loading', null, { timeout: 30000 }).catch(() => {});

  await ev(() => {
    const t = testBM1;
    window.__adv = (n) => { for (let i = 0; i < n; i++) t.advanceFleetCalendar(1, t.Fleet.nextId(t.fleetBook(), 'journey')); };
    window.__idx = (name) => t.getSystemIndexByName(name);
    window.__D = () => t.DoctrineCampaign.doctrineBook(t.campaign());
    window.__P = (id) => t.campaign().polities[id];
    window.__ready = (polity, at = null) => (window.__P(polity)?.hulls || []).filter((h) => h.status === 'ready' && !h.opId && (at == null || h.systemIndex === at)).sort((a, b) => String(a.id).localeCompare(String(b.id)));
    // Everything routine off; Phase 4 switched on per scene.
    window.__quiet = (p4 = {}) => { const db = window.__D(); db.config = { ...db.config, patrols: {}, explorers: {}, merchants: {}, projects: {}, patrolAreas: {}, enforcementResponses: false, predation: false, ...p4 }; t.campaign().config.aiStrategicOps = false; };
    window.__start = (faction, seed, p4 = {}) => { t.startWithFaction(faction); const p = t.ensurePlaytestState(); delete p.diplomacy; delete p.campaign; t.fleetBook().campaignId = seed; t.campaign(); window.__quiet(p4); };
    window.__authored = (fn) => t.runCampaignAuthored(fn);
    window.__assign = (spec) => window.__authored((book, world, fx) => t.DoctrineCampaign.issueAssignment(book, world, spec, t.state.day, fx));
    window.__enf = () => (window.__D().objectives || []).filter((o) => o.kind === 'enforcement');
    window.__pred = () => (window.__D().objectives || []).filter((o) => o.kind === 'predation');
    // One frame of the game at the loop's bounded delta, on the game clock.
    window.__step = (n, fs = 2.5) => { for (let i = 0; i < n; i++) { t.playtestClock.offset -= fs * 16.6667; t.tick(fs); t.updateSecurityOrderPanel(); } };
    window.__seconds = (s) => window.__step(Math.ceil((s * 1000) / (2.5 * 16.6667)));
    window.__shotsAtPlayer = () => t.state.npcShips.filter((n) => !n.destroyed && n.lastAggressionTargetSide === 'player').map((n) => ({ id: n.id, at: Math.round(n.lastAggressionAt) }));
    window.__origRomulan = window.__origRomulan || { ...t.FACTION_BORDER_POLICIES.romulan };
    window.__restorePolicy = () => Object.assign(t.FACTION_BORDER_POLICIES.romulan, window.__origRomulan);
    // A Klingon captain inside Romulan restricted space. The Romulan default admits Klingon traffic for a
    // check; the scene publishes the stricter local rule (identified foreigners closed) through the same
    // engine table the checkpoint reads, so the refusal is the captain's own.
    window.__romulus = (seed, { refuse = true } = {}) => {
      window.__start('klingon', seed, { enforcementResponses: true });
      t.FACTION_BORDER_POLICIES.romulan.other = 'closed';
      const i = window.__idx('Romulus');
      t.state.currentPlanet = i; t.state.myplanet = i + 1; t.applySystemState(i); t.placePlayerAtSecurityApproach();
      if (t.state.arrivalHail) t.state.arrivalHail.acknowledged = true;
      const e = t.ensureActorSensors(t.state); e.transponder = true; e.declaration = 'klingon';
      t.state.npcShips = t.state.npcShips.filter((n) => n.faction === 'romulan');
      const zone = t.getSecurityZone();
      // Every seed gets one Romulan patrol ship on station at the planet (scenes differ in their traffic).
      if (!t.state.npcShips.some((n) => n.role === 'patrol')) {
        const ref = t.state.npcShips[0];
        t.state.npcShips.push(t.createNpcShip({ id: 'gate-romulan-patrol', shipId: ref.shipId, faction: 'romulan', attitude: t.state.npcShips[0].attitude, hostile: false, role: 'patrol', seed: 777, sideId: 'romulan',
          from: { x: zone.centre.x + zone.radius - 700, y: zone.centre.y + 420 }, destination: { x: zone.centre.x + zone.radius - 700, y: zone.centre.y + 420 } }));
      }
      t.setCamera(zone.centre.x + zone.radius - 60, zone.centre.y);
      t.state.ship.velocity = 0;
      window.__step(3);
      const order = t.getPlayerSecurityOrder();
      if (refuse && order) t.respondToSecurityOrder('refuse');
      return { zone: { label: zone.label, radius: zone.radius, exit: zone.exitDistance, access: zone.access }, order: order && { kind: order.kind, decision: order.decision, outcome: order.outcome } };
    };
    window.__leave = () => { const z = t.getSecurityZone(); t.setCamera(z.centre.x + z.exitDistance + 400, z.centre.y); t.state.ship.velocity = 0; };
    window.__ld = () => JSON.parse(JSON.stringify(t.state.localDoctrine || null));
    window.__panel = () => { const el = document.getElementById('security-order-panel') || document.querySelector('.security-order-panel'); return el && !el.classList.contains('hidden') ? el.textContent.replace(/\s+/g, ' ').trim() : ''; };
    window.__pirate = (distanceFactor, id = 'gate-pirate') => {
      const p = t.playerWorldPosition();
      const ref = t.state.npcShips.find((n) => n.shipId != null);
      const npc = t.createNpcShip({ id, shipId: ref?.shipId, faction: 'pirate', attitude: 'hostile', hostile: true, role: 'traffic', seed: 4242, name: 'Nausicaan Raider',
        from: { x: p.x + t.NPC_WEAPON_RANGE * distanceFactor, y: p.y }, destination: { x: p.x + t.NPC_WEAPON_RANGE * distanceFactor, y: p.y } });
      t.state.npcShips.push(npc); t.ensureNpcCombatStats(npc);
      return npc.id;
    };
    window.__quietScene = () => { t.state.npcShips = []; t.state.activeFleetAttack = null; };
    // Until the pirate's demand is on the captain's screen (spawn protection holds everyone off at first).
    window.__untilDemand = (max = 30) => { for (let s = 0; s < max * 2 && !(t.state.localDoctrine?.predation?.state === 'received'); s++) window.__seconds(0.5); const pir = t.state.npcShips.find((n) => n.faction === 'pirate'); if (pir && window.__pirSpeed) pir.speed = window.__pirSpeed; return window.__ld()?.predation || null; };
  });
  // STRATEGIC-MOVEMENT-UNIFICATION: this gate's scenarios are authored hop by hop (one hop a day, as every
  // doctrine vessel flew until this round). They run with the labelled debug override that makes every
  // strategic leg one day; doctrine at the chart's real leg lengths is covered by doctrine-runtime-gate and
  // strategic-movement-gate, and by the pure suites' unequal legs.
  await ev(() => testBM1.applyDebugCommand('campaign legs 1'));

  // =============================================================================================
  await check('new-feature', 'P4-HEADER the doctrine debug header names Phase 4; the source package is unchanged', async () => {
    const r = await ev(() => { window.__start('terran', 'p4-header'); testBM1.openDebugMenu(); const text = document.querySelector('[data-doctrine-section]')?.textContent || ''; document.getElementById('cheats-debug').close(); return { text: text.slice(0, 1400), status: testBM1.getDoctrineRuntime()?.data?.status }; });
    evidence.push({ check: 'P4-HEADER', text: r.text.slice(0, 400) });
    assert.match(r.text, /Runtime integration: Phase 4/);
    assert.equal(r.status, 'DESIGN_ONLY_NOT_LOADED_BY_GAME');
  });

  await check('new-feature', 'P4-POLICY the campaign reads each world\'s published security policy from its holder (Romulus: Romulan border security), and none for the captain\'s own holdings or a pirate haven', async () => {
    const r = await ev(() => {
      const t = testBM1; window.__start('terran', 'p4-policy');
      const w = t.buildCampaignWorld(true);
      const R = window.__idx('Romulus'), H = window.__idx('Pirates Haven'), E = window.__idx('Qo\'noS') >= 0 ? window.__idx('Qo\'noS') : window.__idx('Kronos');
      return { romulus: w.borderPolicy(R), haven: w.borderPolicy(H), klingon: E >= 0 ? w.borderPolicy(E) : 'n/a' };
    });
    evidence.push({ check: 'P4-POLICY', ...r });
    assert.equal(r.romulus.authority, 'romulan'); assert.equal(r.romulus.access.unknown, 'closed'); assert.equal(r.romulus.access.other, 'challenge');
    assert.equal(r.haven, null);
  });

  // ---------------------------------------------------------------------------------------------
  // Strategic (campaign days): a Delpin transport in Romulan space with its transponder dark.
  const stratScene = (seed, plan, dwell = 3) => ev(({ seed, plan, dwell }) => {
    const t = testBM1;
    window.__start('terran', seed, { enforcementResponses: true });
    const R = window.__idx('Romulus'), A = window.__idx('Aldnas'), Dp = window.__idx('Delpi');
    const rom = window.__ready('romulan', R);
    for (const h of rom.slice(1)) { h.status = 'assigned'; h.opId = 'gate-elsewhere'; }
    const picket = rom[0];
    const d = window.__ready('delpin')[0];
    d.systemIndex = A;
    const r = window.__assign({ polity: 'delpin', hullId: d.id, kind: 'transport', doctrineRole: 'civilian', stops: [{ systemIndex: R, dwell, milestone: 'arrival' }, { systemIndex: Dp, milestone: 'check_in' }] });
    r.assignment.transponder = false;
    r.assignment.responsePlan = plan;
    window.__g = { picket: picket.id, picketVid: picket.identity?.vid, target: d.id, targetVid: d.identity?.vid, asg: r.assignment.id, R };
    return { ok: r.ok, reason: r.reason, ...window.__g };
  }, { seed, plan, dwell });

  await check('new-feature', 'P4-STRAT-COMPLY (2,3,4,5,8,27,28,30) one objective for the breach; the demand is received before any response; compliance by leaving closes it; no pursuit, no strike; enforcer and target keep their vids; the picket stands down', async () => {
    const s = await stratScene('p4-strat-comply', ['comply']);
    assert.ok(s.ok, s.reason);
    const r1 = await ev(() => { for (let i = 0; i < 6 && !window.__enf().length; i++) window.__adv(1); const o = window.__enf()[0]; return o && JSON.parse(JSON.stringify(o)); });
    assert.ok(r1, 'no enforcement objective');
    await shotDoctrine('P4-debug-enforcement-active.png', ['Enforcement objectives', 'Enforcement log']);
    const r = await ev(() => {
      const t = testBM1; const fx = [];
      const o = window.__enf()[0];
      for (let i = 0; i < 10 && o.status === 'active'; i++) window.__adv(1);
      const after = [];
      for (let i = 0; i < 6; i++) { window.__adv(1); after.push(window.__enf().length); }
      const p = window.__P('romulan').hulls.find((h) => h.id === window.__g.picket), d = window.__P('delpin').hulls.find((h) => h.id === window.__g.target);
      return { o: JSON.parse(JSON.stringify(o)), count: window.__enf().filter((x) => x.target.systemIndex === window.__g.R).length, after, picket: { vid: p.identity?.vid, status: p.status, defendingAt: p.defendingAt ?? null, at: p.systemIndex }, target: { vid: d.identity?.vid, at: d.systemIndex, status: d.status }, stats: window.__D().stats };
    });
    evidence.push({ check: 'P4-STRAT-COMPLY', created: { demand: r1.demand, authority: r1.authority, comms: r1.comms }, closed: { resolution: r.o.resolution, comms: r.o.comms.log, response: r.o.response, escalation: r.o.escalation.history, actions: r.o.actions }, picket: r.picket, target: r.target });
    assert.equal(r1.demand.type, 'leave_area'); assert.equal(r1.authority.source, 'security_policy'); assert.ok(r1.target.identity === 'unknown' || r1.target.identity === false, String(r1.target.identity));
    assert.equal(r.count, 1, 'a duplicate objective at Romulus'); // the way home may cross another world's own jurisdiction
    assert.equal(r.o.status, 'completed', JSON.stringify(r.o.resolution));
    assert.ok(r.o.resolution.reasons.includes('target_left_jurisdiction'));
    const recv = r.o.comms.receivedDay, resp = r.o.response.history[0]?.day;
    assert.ok(recv != null && resp != null && recv <= resp, `response before receipt: ${recv} / ${resp}`);
    assert.ok(!r.o.actions.some((a) => a.action === 'strike'), 'a strike on a complying vessel');
    assert.equal(r.picket.vid, s.picketVid); assert.equal(r.target.vid, s.targetVid);
    assert.equal(r.picket.defendingAt, null); assert.equal(r.picket.at, s.R, 'the picket pursued');
    assert.notEqual(r.target.at, s.R);
    await shotDoctrine('P4-debug-enforcement-closed.png', ['Enforcement objectives', 'Enforcement log']);
  });

  await check('new-feature', 'P4-STRAT-REFUSE-SURRENDER (6,7,16,17,18,20) each refusal climbs one stage; the surrender closes the objective, the vessel holds surrendered (and survives save/load), and no demand reopens on it', async () => {
    const s = await stratScene('p4-strat-surrender', ['refuse', 'refuse', 'surrender'], 14);
    assert.ok(s.ok, s.reason);
    const r = await ev(() => {
      const t = testBM1;
      const fx = [];
      for (let i = 0; i < 6 && !window.__enf().length; i++) window.__adv(1);
      const o = window.__enf()[0];
      const trail = [];
      for (let i = 0; i < 12 && o.status === 'active'; i++) { window.__adv(1); trail.push(`${t.state.day}:${o.escalation.stage}:${o.response.state}`); }
      const d = window.__P('delpin').hulls.find((h) => h.id === window.__g.target);
      const snap = { status: d.status, surrendered: d.surrendered ? { ...d.surrendered } : null };
      t.saveGame(8); t.startWithFaction('romulan'); t.loadGame(8);
      const d2 = window.__P('delpin').hulls.find((h) => h.id === window.__g.target);
      const o2 = window.__enf().find((x) => x.id === o.id);
      const loaded = { status: d2.status, surrendered: d2.surrendered ? { ...d2.surrendered } : null, objective: o2.status };
      for (let i = 0; i < 8; i++) window.__adv(1);
      return { o: JSON.parse(JSON.stringify(o2)), trail, snap, loaded, later: window.__enf().filter((x) => x.target.vid === window.__g.targetVid && x.target.systemIndex === window.__g.R).length, objs: window.__enf().filter((x) => x.target.vid === window.__g.targetVid).map((x) => ({ id: x.id, created: x.createdDay, status: x.status, res: x.resolution, demand: x.demand.type, esc: x.escalation.history })), visits: Object.entries(window.__D().visits || {}).filter(([k]) => k.includes(window.__g.targetVid)), final: d2.status, surrenderLog: window.__D().surrenderLog };
    });
    evidence.push({ check: 'P4-STRAT-REFUSE-SURRENDER', objs: r.objs, visits: r.visits, surrenderLog: r.surrenderLog, trail: r.trail, escalation: r.o.escalation.history, resolution: r.o.resolution, snap: r.snap, loaded: r.loaded, final: r.final });
    const stages = r.o.escalation.history.map((h) => h.stage).filter((x) => typeof x === 'number');
    for (let i = 1; i < stages.length; i++) assert.ok(stages[i] - stages[i - 1] <= 1, `skipped a stage: ${stages}`);
    assert.equal(r.o.status, 'completed'); assert.deepEqual(r.o.resolution.reasons, ['surrender_accepted']);
    assert.equal(r.snap.status, 'surrendered');
    assert.deepEqual(r.loaded.surrendered, r.snap.surrendered); assert.equal(r.loaded.status, 'surrendered');
    assert.equal(r.later, 1, 'a new demand at Romulus on the surrendered vessel'); // another world's security is its own jurisdiction
    assert.notEqual(r.final, 'surrendered', 'never released');
    await shotDoctrine('P4-debug-surrender.png', ['Enforcement objectives', 'Surrenders']);
  });

  await check('new-feature', 'P4-STRAT-PREDATION (21,22,24,25,26) the Pirates Haven crew demands from a transport it can see (hull class, not hold); the transport pays; the pirates disengage; the same vessel is not asked again within the cooldown', async () => {
    const r = await ev(() => {
      const t = testBM1;
      window.__start('terran', 'p4-strat-pred', { predation: true, pirateHaunts: 'auto' });
      const H = window.__idx('Pirates Haven');
      const w = t.buildCampaignWorld(true);
      const nb = w.neighbours(H);
      const d = window.__ready('delpin')[0];
      d.systemIndex = nb[0];
      const trip = () => window.__assign({ polity: 'delpin', hullId: d.id, kind: 'transport', doctrineRole: 'civilian', cargo: { value: 99999, concealed: true }, stops: [{ systemIndex: H, dwell: 2, milestone: 'arrival' }, { systemIndex: nb[0], milestone: 'check_in' }] });
      const a1 = trip();
      if (!a1.ok) return { fail: a1.reason };
      a1.assignment.predationPlan = ['pay'];
      const t0 = t.state.latinum;
      for (let i = 0; i < 8 && !window.__pred().length; i++) window.__adv(1);
      const o = window.__pred()[0];
      if (!o) return { fail: 'no demand', pirates: window.__D().pirates };
      for (let i = 0; i < 6 && o.status === 'active'; i++) window.__adv(1);
      for (let i = 0; i < 6 && d.status !== 'ready'; i++) window.__adv(1);
      const rp = window.__D().stats.predationRepeatPrevented || 0;
      const a2 = trip();
      if (a2.ok) a2.assignment.predationPlan = ['refuse'];
      for (let i = 0; i < 6; i++) window.__adv(1);
      const g = Object.values(window.__D().pirates)[0];
      return { o: JSON.parse(JSON.stringify(o)), count: window.__pred().length, repeat: (window.__D().stats.predationRepeatPrevented || 0) - rp, g: { id: g.id, vid: g.vid, loot: g.loot, cooldowns: g.cooldowns, history: g.history, status: g.status }, vid: d.identity?.vid, second: a2.ok };
    });
    evidence.push({ check: 'P4-STRAT-PREDATION', ...r });
    assert.equal(r.fail, undefined, JSON.stringify(r));
    assert.equal(r.o.demand.type, 'payment'); assert.match(r.o.demand.basis, /hold unseen/);
    assert.ok(r.o.demand.amount <= 240, 'a demand priced on the hidden cargo');
    assert.equal(r.o.status, 'completed', JSON.stringify(r.o.resolution));
    assert.ok(r.o.paid > 0 && r.o.paid <= r.o.demand.amount);
    assert.ok(r.o.comms.receivedDay != null && r.o.comms.receivedDay <= r.o.response.day);
    assert.ok(!r.o.attack.phase, 'an attack on a paying vessel');
    assert.equal(r.count, 1, 'the same vessel was asked again'); assert.ok(r.repeat >= 1);
    assert.ok(r.g.cooldowns[r.vid] != null);
    await shotDoctrine('P4-debug-predation.png', ['Pirate groups', 'Predation objectives']);
  });

  // ---------------------------------------------------------------------------------------------
  // The captain as the target of local enforcement.
  await check('preservation', 'P4-REFUSAL-RECORD a checkpoint refusal is still a record, not a target: for the eight seconds after it nothing is hostile to the captain and nothing fires', async () => {
    const r = await ev(() => {
      const t = testBM1; const s = window.__romulus('p4-record');
      const hull = t.state.hull;
      window.__seconds(7.5);
      const res = { s, hull0: hull, hull1: t.state.hull, shots: window.__shotsAtPlayer(), hostile: t.state.npcShips.filter((n) => n.hostile).length };
      window.__restorePolicy();
      return res;
    });
    evidence.push({ check: 'P4-REFUSAL-RECORD', ...r });
    assert.equal(r.s.order?.kind, 'withdraw', JSON.stringify(r.s));
    assert.deepEqual(r.shots, []); assert.equal(r.hostile, 0); assert.equal(r.hull1, r.hull0);
  });

  await check('new-feature', 'P4-LOCAL-WARN (3,9) a refusal that stands is followed once by a final warning the captain actually sees — Comply / Refuse / Surrender — and no fire', async () => {
    const r = await ev(() => { const t = testBM1; window.__romulus('p4-warn'); window.__seconds(9); return { ld: window.__ld(), panel: window.__panel(), shots: window.__shotsAtPlayer() }; });
    await shotScene('P4-patrol-final-warning.png');
    evidence.push({ check: 'P4-LOCAL-WARN', enforcement: r.ld?.enforcement, panel: r.panel });
    const e = r.ld?.enforcement;
    assert.ok(e, 'no enforcement');
    assert.equal(e.stage, 2); assert.equal(e.comms, 'received'); assert.equal(e.notice.repeat, true);
    assert.match(r.panel, /Final warning\. Leave restricted space\./); assert.match(r.panel, /Comply/); assert.match(r.panel, /Refuse/); assert.match(r.panel, /Surrender/);
    assert.deepEqual(r.shots, []);
  });

  await check('new-feature', 'P4-LOCAL-COMPLY (4,5,6,7) Refuse climbs one stage (an interceptor closes in; no fire); Comply and leaving close it; the interceptor is released back to its patrol; nothing follows the captain out', async () => {
    await ev(() => { window.__romulus('p4-comply'); window.__seconds(9); });
    await click('[data-enforcement-response="refuse"]');
    const r1 = await ev(() => { window.__seconds(17); const ld = window.__ld(); const npc = testBM1.state.npcShips.find((n) => n.id === ld.enforcement?.interceptorId); return { roster: testBM1.state.npcShips.map((n) => `${n.id}:${n.role}:${n.faction}:${n.condition || ''}:${n.trafficWarp?.phase || ''}:${n.localEnforcement?.mode || ''}`), ld, npc: npc && { id: npc.id, mode: npc.localEnforcement?.mode, dest: npc.destinationName, dist: Math.round(testBM1.distanceToPlayer(npc)) }, shots: window.__shotsAtPlayer() }; });
    await shotScene('P4-patrol-intercepting.png');
    assert.equal(r1.ld.enforcement.stage, 3, JSON.stringify(r1.ld.enforcement?.history));
    assert.equal(r1.npc?.mode, 'intercept', JSON.stringify({ roster: r1.roster, e: r1.ld.enforcement })); assert.deepEqual(r1.shots, []);
    await click('[data-enforcement-response="comply"]');
    const r2 = await ev(() => {
      const t = testBM1;
      const id = window.__ld().enforcement.interceptorId;
      window.__leave(); window.__step(4);
      const ld = window.__ld();
      window.__seconds(10);
      const npc = t.state.npcShips.find((n) => n.id === id);
      return { ld, npc: npc && { mode: npc.localEnforcement?.mode || null, dest: npc.destinationName }, shots: window.__shotsAtPlayer(), after: window.__ld().enforcement };
    });
    await shotScene('P4-target-complied-patrol-returning.png');
    evidence.push({ check: 'P4-LOCAL-COMPLY', stage3: r1.ld.enforcement.history, closed: r2.ld.lastEnforcement?.closed, interceptor: r2.npc });
    assert.equal(r2.ld.enforcement, null);
    assert.equal(r2.ld.lastEnforcement.closed.reason, 'compliance_verified');
    assert.equal(r2.npc.mode, null); assert.doesNotMatch(r2.npc.dest || '', /intercept/);
    assert.deepEqual(r2.shots, []); assert.equal(r2.after, null);
    await ev(() => window.__restorePolicy());
  });

  await check('new-feature', 'P4-LOCAL-ENGAGE-SURRENDER (10,11,16,17) only after warning, final warning and interception does the Romulan doctrine authorise force; the captain surrenders; all fire stops at once, the captain is held, then released, and nothing reopens this visit', async () => {
    const standing0 = await ev(() => { window.__romulus('p4-engage'); const s0 = testBM1.getFactionStanding('romulan'); window.__seconds(9); return [s0, testBM1.getFactionStanding('romulan')]; });
    await click('[data-enforcement-response="refuse"]');
    const r1 = await ev(() => {
      const t = testBM1;
      window.__seconds(5);
      const pre = window.__shotsAtPlayer();
      window.__seconds(17);
      const e = window.__ld().enforcement;
      const t4 = t.gameNow();
      window.__seconds(12);
      return { pre, e, t4: Math.round(t4), shots: window.__shotsAtPlayer(), hull: t.state.hull, standing: t.getFactionStanding('romulan') };
    });
    evidence.push({ check: 'P4-LOCAL-ENGAGE', standing: [...standing0, r1.standing], history: r1.e?.history, engageCheck: r1.e?.engageCheck, shots: r1.shots });
    assert.deepEqual(r1.pre, [], 'fire before any authority');
    assert.ok(r1.e, 'the enforcement closed before engagement');
    assert.equal(r1.e.stage, 4, `engagement not reached: ${JSON.stringify(r1.e.engageCheck)}`);
    assert.deepEqual(r1.e.notice, { warn: true, repeat: true, intercept: true });
    assert.ok(r1.shots.some((x) => x.at >= r1.t4 - 50), 'the authorised interceptor never fired');
    await shotScene('P4-weapons-free.png');
    await click('[data-enforcement-response="surrender"]');
    const r2 = await ev(() => {
      const t = testBM1;
      const shots0 = window.__shotsAtPlayer();
      const shotsAt = Object.fromEntries(shots0.map((x) => [x.id, x.at]));
      const proj0 = t.state.projectiles.length;
      t.firePlayerWeapon(1);
      const playerFired = t.state.projectiles.length > proj0;
      window.__seconds(3);
      const held = { ld: window.__ld(), vel: t.state.ship.velocity, panel: window.__panel() };
      window.__seconds(5);
      const later = window.__shotsAtPlayer().filter((x) => x.at > (shotsAt[x.id] ?? -1));
      return { held, later, playerFired };
    });
    await shotScene('P4-surrender-stops-fire.png');
    const r3 = await ev(() => { window.__seconds(6); const a = window.__ld(); window.__seconds(40); return { released: a.surrender, after: window.__ld(), shots: window.__shotsAtPlayer() }; });
    evidence.push({ check: 'P4-LOCAL-SURRENDER', held: r2.held.ld.surrender, panel: r2.held.panel, laterShots: r2.later, released: r3.released, closed: r3.after.lastEnforcement?.closed, history: r3.after.history });
    assert.ok(r2.held.ld.surrender, 'surrender not recorded');
    assert.equal(r2.held.ld.enforcement, null); assert.equal(r2.held.ld.lastEnforcement.closed.reason, 'surrender_accepted');
    assert.match(r2.held.panel, /Surrendered/);
    assert.deepEqual(r2.later, [], 'fire after the surrender');
    assert.equal(r2.playerFired, false); assert.ok(r2.held.vel <= 0.5);
    assert.equal(r3.released, null, 'never released');
    assert.equal(r3.after.enforcement, null, 'enforcement reopened after the surrender');
    await ev(() => window.__restorePolicy());
  });

  await check('new-feature', 'P4-LOCAL-COMPLY-LAPSE saying "complying" and staying inside is not compliance: after the window the word lapses and the ladder resumes one stage up; nothing fires on the way', async () => {
    await ev(() => { window.__romulus('p4-lapse'); window.__seconds(9); });
    await click('[data-enforcement-response="comply"]');
    const r = await ev(() => {
      const mid = (window.__seconds(20), { ld: window.__ld(), panel: window.__panel() });
      window.__seconds(28);
      const after = window.__ld();
      window.__restorePolicy();
      return { mid: mid.ld.enforcement, panel: mid.panel, after: after.enforcement, shots: window.__shotsAtPlayer() };
    });
    evidence.push({ check: 'P4-LOCAL-COMPLY-LAPSE', history: r.after?.history, panel: r.panel });
    assert.equal(r.mid.compliance, 'complying'); assert.match(r.panel, /Complying/);
    assert.ok(r.after, 'the enforcement closed although the captain never left');
    assert.equal(r.after.compliance, null); assert.equal(r.after.stage, 3, JSON.stringify(r.after.history));
    assert.ok(r.after.history.some((h) => h.name === 'lapsed'));
    assert.deepEqual(r.shots, []);
  });

  await check('new-feature', 'P4-LOCAL-SAVELOAD (18,29) an open local enforcement and a held surrender survive save/load with their stage and clocks', async () => {
    const r = await ev(() => {
      const t = testBM1; window.__romulus('p4-save'); window.__seconds(9);
      const before = window.__ld();
      t.saveGame(7); t.startWithFaction('terran'); t.loadGame(7);
      const after = window.__ld();
      window.__restorePolicy();
      return { before: before.enforcement, after: after?.enforcement, clockB: before.clockMs, clockA: after?.clockMs };
    });
    evidence.push({ check: 'P4-LOCAL-SAVELOAD', ...r });
    assert.deepEqual(r.after, r.before); assert.equal(r.clockA, r.clockB);
  });

  await check('new-feature', 'P4-LOCAL-DISABLED (19) a disabled captain cannot comply by moving: the enforcement closes as unable to comply, and no one fires on the hulk', async () => {
    const r = await ev(() => {
      const t = testBM1; window.__romulus('p4-disabled'); window.__seconds(9);
      t.applyVesselDisablement ? t.applyVesselDisablement(t.state, 'gate') : (t.fleetBook().personalCondition = 'disabled');
      t.fleetBook().personalCondition = 'disabled';
      window.__seconds(2);
      const ld = window.__ld();
      window.__seconds(10);
      window.__restorePolicy();
      return { closed: ld.lastEnforcement?.closed, open: ld.enforcement, shots: window.__shotsAtPlayer() };
    });
    evidence.push({ check: 'P4-LOCAL-DISABLED', ...r });
    assert.equal(r.open, null); assert.equal(r.closed?.reason, 'target_unable_to_comply'); assert.deepEqual(r.shots, []);
  });

  // ---------------------------------------------------------------------------------------------
  // A pirate's demand on the captain.
  const pirateScene = (seed, factor) => ev(({ seed, factor }) => {
    const t = testBM1;
    window.__start('terran', seed, { predation: true });
    const keep = t.state.npcShips.find((n) => n.shipId != null);
    // No other traffic; the raider waits where it is until its sensors have the captain (then moves freely).
    window.__quietScene();
    if (keep) t.state.npcShips.push({ ...keep, id: 'gate-ref', x: 1e7, y: 1e7, destination: { x: 1e7, y: 1e7 } });
    const id = window.__pirate(factor);
    t.state.npcShips = t.state.npcShips.filter((n) => n.id !== 'gate-ref');
    const pir = t.state.npcShips.find((n) => n.id === id); window.__pirSpeed = pir.speed; pir.speed = 0;
    t.state.latinum = 1000; t.state.hull = t.state.maxHull || t.state.hull; t.state.shields = 100;
    return id;
  }, { seed, factor });

  await check('baseline-defect', 'P4-PIRATE-DEMAND-FIRST (21) a pirate in weapon range of a captain who has neither been asked for anything nor refused does not open fire: it makes a demand and waits for the answer', async () => {
    await pirateScene('p4-pirate-first', 0.8);
    const r = await ev(() => { window.__seconds(18); const ld = window.__ld(); return { shots: window.__shotsAtPlayer(), predation: ld?.predation || null, panel: window.__panel() }; });
    evidence.push({ check: 'P4-PIRATE-DEMAND-FIRST', ...r });
    assert.deepEqual(r.shots, [], 'the pirate fired with no demand and no refusal');
    assert.ok(r.predation, 'no demand');
    assert.equal(r.predation.state, 'received');
    assert.match(r.panel, /Transfer \d+ latinum or surrender cargo/);
  });

  await check('new-feature', 'P4-PIRATE-PAY (22,24,25) the demand panel: PAY / SURRENDER CARGO / REFUSE / RUN; the captain pays; the pirates take it and stand down; no fire, no second demand; the price is set by the hull class, never the hold', async () => {
    await pirateScene('p4-pirate-pay', 1.0);
    const r0 = await ev(() => {
      const t = testBM1;
      const p = window.__untilDemand();
      // The price with an empty hold and with a full one, from the same observation.
      const amt1 = p?.amount;
      const n = t.state.npcShips.find((x) => x.faction === 'pirate');
      return { p, amt1, panel: window.__panel(), diag: n && { track: t.sensorCanTrack(n, t.state), dist: Math.round(t.distanceToPlayer(n)), lp: n.localPredation, cd: t.state.localDoctrine?.cooldowns, last: t.state.localDoctrine?.lastPredation, aggro: n.playerAggroUntil, speed: n.speed, cond: n.condition, warp: n.trafficWarp, standing: t.getFactionStanding('pirate'), npcs: t.state.npcShips.length, gw: t.state.warp.active, ld: !!t.state.localDoctrine, live: t.doctrineLiveFor('pirate','raider','exploit_cargo'), shotSide: n.lastAggressionTargetSide } };
    });
    await shotScene('P4-pirate-demand.png');
    assert.ok(r0.p, 'no demand ' + JSON.stringify(r0.diag)); assert.match(r0.panel, /Pay/); assert.match(r0.panel, /Refuse/); assert.match(r0.panel, /Run/);
    const lat0 = await ev(() => testBM1.state.latinum);
    await click('[data-predation-response="pay"]');
    const r = await ev(() => {
      const t = testBM1;
      const after = window.__ld();
      window.__seconds(40);
      // A second captain's hold, full this time: the same class, the same price.
      const pods = t.state.cargoArray || [];
      return { after, lat: t.state.latinum, shots: window.__shotsAtPlayer(), open: window.__ld().predation, history: window.__ld().history, cooldowns: window.__ld().cooldowns, pods: pods.length };
    });
    const priceFull = await ev(() => {
      const t = testBM1;
      const pods = t.state.cargoArray || [];
      for (const pod of pods) { pod.item = pod.item || 'dilithium'; pod.tons = pod.tons || 10; }
      const npc = t.state.npcShips.find((n) => n.faction === 'pirate');
      const ld = t.localDoctrine(); ld.cooldowns = {}; npc.localPredation = null;
      const p = t.issueLocalPredation(npc); const amt = p.amount; ld.predation = null; return amt;
    });
    evidence.push({ check: 'P4-PIRATE-PAY', demand: r0.p, paidFrom: lat0, to: r.lat, closed: r.after.lastPredation?.closed, cooldowns: r.cooldowns, priceEmpty: r0.amt1, priceFull });
    assert.equal(lat0 - r.lat, r0.p.amount);
    assert.equal(r.after.lastPredation.closed.reason, 'cargo_received');
    assert.deepEqual(r.shots, []); assert.equal(r.open, null, 'a second demand');
    assert.equal(priceFull, r0.amt1, 'the price followed the hold');
  });

  await check('new-feature', 'P4-PIRATE-CREW-COOLDOWN (24) paid once, the pirates of this system do not come back for more — not even as a fresh spawn of the same crew', async () => {
    await pirateScene('p4-pirate-crew', 1.0);
    await ev(() => window.__untilDemand());
    await click('[data-predation-response="pay"]');
    const r = await ev(() => {
      const t = testBM1;
      t.state.npcShips = t.state.npcShips.filter((n) => n.faction !== 'pirate');
      window.__pirate(1.0, 'gate-pirate-2');
      window.__seconds(25);
      return { open: window.__ld().predation, history: window.__ld().history.filter((h) => h.kind === 'predation'), cooldowns: window.__ld().cooldowns, shots: window.__shotsAtPlayer() };
    });
    evidence.push({ check: 'P4-PIRATE-CREW-COOLDOWN', ...r });
    assert.equal(r.open, null, 'a second demand from the same crew'); assert.equal(r.history.length, 1);
    assert.ok(Object.keys(r.cooldowns).some((k) => k.startsWith('crew:')));
  });

  await check('new-feature', 'P4-PIRATE-REFUSE (23) refusing brings a bounded attack: the pirate fires, and after the attack window it disengages and stops', async () => {
    await pirateScene('p4-pirate-refuse', 1.0);
    await ev(() => window.__untilDemand());
    await click('[data-predation-response="refuse"]');
    const r = await ev(() => {
      const t = testBM1;
      window.__seconds(14);
      const during = window.__shotsAtPlayer();
      window.__seconds(20);
      const ld = window.__ld();
      const at = Object.fromEntries(window.__shotsAtPlayer().map((x) => [x.id, x.at]));
      window.__seconds(15);
      const later = window.__shotsAtPlayer().filter((x) => x.at > (at[x.id] ?? -1));
      return { during, closed: ld.lastPredation?.closed, open: ld.predation, later };
    });
    evidence.push({ check: 'P4-PIRATE-REFUSE', ...r });
    assert.ok(r.during.length >= 1, 'no attack after the refusal');
    assert.equal(r.open, null); assert.equal(r.closed?.reason, 'attacker_disengaged');
    assert.deepEqual(r.later, [], 'the attack did not stop');
  });

  await check('new-feature', 'P4-PIRATE-RUN (26) running: once out of reach the demand closes as escaped', async () => {
    await pirateScene('p4-pirate-run', 1.0);
    await ev(() => window.__untilDemand());
    await click('[data-predation-response="run"]');
    const r = await ev(() => {
      const t = testBM1; const p = t.playerWorldPosition();
      t.setCamera(p.x - t.NPC_WEAPON_RANGE * 6, p.y);
      window.__step(4);
      return window.__ld();
    });
    evidence.push({ check: 'P4-PIRATE-RUN', closed: r.lastPredation?.closed });
    assert.equal(r.predation, null); assert.equal(r.lastPredation?.closed?.reason, 'target_escaped');
  });

  await check('new-feature', 'P4-RETURN-FIRE (10) a pirate that was paid stands down, and still answers fire: return fire waits for aggression, and comes when there is some', async () => {
    await pirateScene('p4-return-fire', 0.9);
    await ev(() => window.__untilDemand());
    await click('[data-predation-response="pay"]');
    const r = await ev(() => {
      const t = testBM1;
      const npc = t.state.npcShips.find((n) => n.faction === 'pirate');
      npc.trafficWarp = null; npc.destination = { x: npc.x, y: npc.y }; npc.speed = 0;
      const p = t.playerWorldPosition();
      window.__seconds(6);
      const quiet = window.__shotsAtPlayer();
      const targetBefore = t.shouldNpcTargetPlayer(npc, t.distanceToPlayer(npc), null);
      t.recordPlayerAggressionAgainst ? t.recordPlayerAggressionAgainst(npc) : null;
      npc.playerAggroUntil = t.gameNow() + 12000;
      window.__seconds(8);
      return { quiet, targetBefore, targetAfter: t.shouldNpcTargetPlayer(npc, t.distanceToPlayer(npc), null), shots: window.__shotsAtPlayer() };
    });
    evidence.push({ check: 'P4-RETURN-FIRE', ...r });
    assert.deepEqual(r.quiet, []); assert.equal(r.targetBefore, false);
    assert.equal(r.targetAfter, true); assert.ok(r.shots.length >= 1, 'no return fire');
  });

  await check('new-feature', 'P4-NPC-SURRENDER (16,20) a pirate that strikes in a loaded scene is out of the fight: never an attacker to defenders, never an escort target, holds position, and fires at no one', async () => {
    const r = await ev(() => {
      const t = testBM1;
      window.__start('terran', 'p4-npc-surrender', { predation: false });
      const id = window.__pirate(1.0, 'gate-pirate-s');
      const npc = t.state.npcShips.find((n) => n.id === id);
      npc.playerAggroUntil = t.gameNow() + 60000;
      npc.lastAggressionAt = t.gameNow(); npc.lastAggressionTargetSide = 'player'; npc.lastAggressionSystemIndex = Number(t.state.currentPlanet);
      const before = { attacker: t.isNpcSystemAttacker(npc, 'player'), escort: t.isPlayerEscortShipTarget(npc), targets: t.shouldNpcTargetPlayer(npc, t.distanceToPlayer(npc), null) };
      t.surrenderNpc(npc, { to: 'player', reason: 'struck its colours' });
      const shot0 = npc.lastShotAt;
      const x0 = npc.x;
      window.__seconds(8);
      return { before, after: { attacker: t.isNpcSystemAttacker(npc, 'player'), escort: t.isPlayerEscortShipTarget(npc), targets: t.shouldNpcTargetPlayer(npc, t.distanceToPlayer(npc), null), surrendered: npc.surrendered, fired: npc.lastShotAt !== shot0, moved: Math.round(Math.abs(npc.x - x0)), hostile: npc.hostile } };
    });
    await shotScene('P4-npc-surrendered.png');
    evidence.push({ check: 'P4-NPC-SURRENDER', ...r });
    assert.equal(r.before.attacker, true);
    assert.equal(r.after.attacker, false); assert.equal(r.after.escort, false); assert.equal(r.after.targets, false);
    assert.equal(r.after.fired, false); assert.equal(r.after.hostile, false); assert.ok(r.after.moved < 5);
  });

  await check('preservation', 'P4-LAWFUL (1) lawful transit draws nothing: a Klingon captain broadcasting in Romulan space under the published default gets the ordinary checkpoint and no enforcement', async () => {
    const r = await ev(() => {
      const t = testBM1;
      t.startWithFaction('klingon');
      const i = t.getSystemIndexByName('Romulus'); t.state.currentPlanet = i; t.state.myplanet = i + 1; t.applySystemState(i); t.placePlayerAtSecurityApproach();
      const e = t.ensureActorSensors(t.state); e.transponder = true; e.declaration = 'klingon';
      const z = t.getSecurityZone(); t.setCamera(z.centre.x + z.radius - 60, z.centre.y);
      for (let k = 0; k < 400; k++) { t.playtestClock.offset -= 41.67; t.tick(2.5); }
      return { ld: t.state.localDoctrine?.enforcement || null, order: t.getPlayerSecurityOrder()?.kind || null, shots: t.state.npcShips.filter((n) => n.lastAggressionTargetSide === 'player').length };
    });
    evidence.push({ check: 'P4-LAWFUL', ...r });
    assert.equal(r.ld, null); assert.equal(r.shots, 0);
  });

  await check('new-feature', 'P4-DEBUG-LOCAL the debug view shows the local encounters with their chain after resolution', async () => {
    await ev(() => { window.__romulus('p4-debug'); window.__seconds(9); });
    await click('[data-enforcement-response="comply"]');
    await ev(() => { window.__leave(); window.__step(4); });
    await shotDoctrine('P4-debug-local-encounters.png', ['Local encounters', 'Enforcement objectives']);
    await ev(() => window.__restorePolicy());
  });

  await check('new-feature', 'SHOTS the phase 4 views', async () => {
    for (const f of ['P4-patrol-final-warning.png', 'P4-patrol-intercepting.png', 'P4-target-complied-patrol-returning.png', 'P4-weapons-free.png', 'P4-surrender-stops-fire.png', 'P4-pirate-demand.png', 'P4-npc-surrendered.png', 'P4-debug-enforcement-active.png', 'P4-debug-enforcement-closed.png', 'P4-debug-surrender.png', 'P4-debug-predation.png', 'P4-debug-local-encounters.png'])
      assert.ok(fs.existsSync(path.join(out, f)) && fs.statSync(path.join(out, f)).size > 10000, `missing ${f}`);
  });

  fs.writeFileSync(path.join(out, 'doctrine-phase4-evidence.json'), JSON.stringify({ results, evidence }, null, 1));
  const byCat = (c) => { const r = results.filter((x) => x.category === c); return `${r.filter((x) => x.ok).length}/${r.length}`; };
  console.log(`\ndoctrine runtime phase 4 in-game: ${results.filter((x) => x.ok).length}/${results.length} (baseline-defect ${byCat('baseline-defect')}, new-feature ${byCat('new-feature')}, preservation ${byCat('preservation')})`);
  if (probe.errors.length) console.log('page errors:', probe.errors.slice(0, 5));
  await probe.close();
  process.exit(results.every((x) => x.ok) && !probe.errors.length ? 0 : 1);
})();
