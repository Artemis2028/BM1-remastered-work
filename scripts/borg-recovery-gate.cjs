// In-game gate for BORG-HULK-REGENERATION (docs/doctrine/BORG-HULK-REGENERATION.md). The real engine, the default
// chart, the campaign's own Borg Assimilation Cube at Vex (its recovery capability is manifest data). Scenarios:
//   BORG-HULK-RECOVERY: a disabled Terran Inquiry at Harman (two legs from Vex) is assimilated by the cube by the
//     accepted assimilation rules; the cube withdraws home; the hulk lies stranded; the cube is dispatched back by
//     conduit, takes it in tow only when both stand at Harman, tows it home conventionally over two legs at the shared
//     tow speed, Vex (the origin) takes it in and regenerates it over campaign days, and the same Inquiry is back in
//     service under the Collective;
//   BORG-RECOVERY-INTERDICTED: a Klingon blockade on the tow's first crossing — one branch runs it in the shared
//     blockade engine and gets through; in the other the captain is there, the interception is his scene, the cube is
//     destroyed in it, and the hulk lies where the tow was let go;
//   BORG-NODE-VALIDATION: Vex (origin) is always a node; a world the cube has just assimilated is not, until it has
//     stabilized — then a hulk lying there is regenerated where it lies.
// Categories:
//   baseline-defect  e949936 leaves the hulk stranded for ever (fails on its own assertion)
//   new-feature      needs this round's recovery and regeneration
//   preservation     must hold on both
// BM1_TEST_ROOT (probe harness) serves another tree: the baseline reproduction runs this gate against e949936.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { startProbe } = require('./probe-harness.cjs');

(async () => {
  const probe = await startProbe({ viewport: { width: 1400, height: 900 }, pageOptions: { deviceScaleFactor: 2 } });
  const { ev, fresh, page } = probe;
  const out = process.env.BM1_TEST_OUTPUT || '/tmp';
  const ONLY = process.env.BM1_ONLY ? new RegExp(process.env.BM1_ONLY) : null;
  fs.mkdirSync(out, { recursive: true });
  const results = [];
  const evidence = [];
  async function check(category, name, fn) {
    if (ONLY && !ONLY.test(name)) return;
    try { await fn(); results.push({ category, name, ok: true }); console.log('PASS', `[${category}]`, name); }
    catch (err) { results.push({ category, name, ok: false, message: String(err?.message || err).split('\n').slice(0, 6).join(' ') }); console.log('FAIL', `[${category}]`, name, '\n      ', String(err?.message || err).split('\n').slice(0, 8).join(' ')); }
  }
  const shot = async (name) => { const draw = () => ev(() => { testBM1.render(); testBM1.updateSecurityOrderPanel?.(); }); await draw(); await page.waitForTimeout(500); await draw(); return page.screenshot({ path: path.join(out, name) }); };
  // A debug block shot: every debug section but the one holding `selector` hidden, the block itself captured.
  async function shotBlock(file, selector) {
    const there = await ev((sel) => { const d = document.getElementById('cheats-debug'); if (!d.open) testBM1.openDebugMenu(); return Boolean(document.querySelector(sel)); }, selector);
    if (!there) { await ev(() => document.getElementById('cheats-debug').close()); return false; }
    await ev(() => testBM1.closeGalaxyReports?.());
    await ev((sel) => { const d = document.getElementById('cheats-debug'); for (const x of d.querySelectorAll('section')) if (!x.matches(sel) && !x.querySelector(sel)) x.style.display = 'none'; d.style.maxHeight = 'none'; d.style.height = 'auto'; d.style.width = '1360px'; d.style.maxWidth = 'none'; d.style.overflow = 'visible'; d.style.position = 'absolute'; d.style.top = '0'; }, selector);
    const h = await ev((sel) => Math.ceil(document.querySelector(sel).getBoundingClientRect().bottom + window.scrollY + 40), selector);
    await page.setViewportSize({ width: 1400, height: Math.min(7000, Math.max(900, h)) });
    await page.locator(selector).first().screenshot({ path: path.join(out, file) });
    await page.setViewportSize({ width: 1400, height: 900 });
    await ev(() => { const d = document.getElementById('cheats-debug'); for (const x of d.querySelectorAll('section')) x.style.display = ''; d.removeAttribute('style'); d.close();
      testBM1.closeGalaxyReports?.(); const c = testBM1.playtestClock; if (c.stoppedAt !== null) { c.offset += performance.now() - c.stoppedAt; c.stoppedAt = null; } });
    return true;
  }
  await page.waitForFunction(() => !testBM1.doctrineStatus || testBM1.doctrineStatus().state !== 'loading', null, { timeout: 30000 }).catch(() => {});

  const setup = () => page.evaluate(() => {
    const t = testBM1;
    window.__adv = (n) => { for (let i = 0; i < n; i++) t.advanceFleetCalendar(1, t.Fleet.nextId(t.fleetBook(), 'journey')); };
    window.__idx = (name) => t.getSystemIndexByName(name);
    window.__step = (n, fs = 2.5) => { for (let i = 0; i < n; i++) { t.playtestClock.offset -= fs * 16.6667; t.tick(fs); t.updateSecurityOrderPanel?.(); } };
    window.__seconds = (s) => window.__step(Math.ceil((s * 1000) / (2.5 * 16.6667)));
    window.__vid = (h) => h?.identity?.vid || h?.vid || h?.id;
    window.__W = () => t.buildCampaignWorld(true);
    window.__npcs = (id) => t.state.npcShips.filter((n) => n.encounterId === id);
    window.__sum = () => t.DoctrineCampaign.borgSummary ? t.DoctrineCampaign.borgSummary(t.campaign()) : { objectives: [], selections: {}, progress: {}, assimilatedHulls: [], assimilatedWorlds: [], transwarp: {}, stats: {} };
    window.__dbg = () => (t.DoctrineCampaign.borgDebug ? t.DoctrineCampaign.borgDebug(t.campaign(), window.__W()).hulkRecovery : null) || { rows: [], nodes: [] };
    window.__borg = () => t.campaign().polities.borg?.hulls || [];
    window.__cube = () => window.__borg().find((h) => Number(h.shipId) === 346) || null;
    window.__find = (id) => { for (const [pid, p] of Object.entries(t.campaign().polities)) { const h = p.hulls.find((x) => x.id === id); if (h) return { pid, h }; } const d = (t.campaign().derelicts || []).find((x) => x.id === id); return d ? { pid: 'derelict', h: d } : null; };
    window.__rec = (hullId) => (window.__sum().recoveries || []).filter((r) => r.hullId === hullId).slice(-1)[0] || null;
    window.__mission = (r) => (r?.missionId || r?.missions?.length ? t.Campaign.hullRecoveryById(t.campaign(), r.missionId || r.missions[r.missions.length - 1]) : null);
    window.__place = (sys) => { t.markSystemVisited(sys); t.state.currentPlanet = sys; t.state.myplanet = sys + 1; t.applySystemState(sys); t.placePlayerAtSecurityApproach?.(); };
    window.__reset = () => { t.state.hull = 100; t.state.shields = 100; t.state.spawnProtectionUntil = 0; t.state.godMode = false; t.fleetBook().personalCondition = 'operational'; };
    window.__hold = (sec) => { for (let i = 0; i < sec; i++) { t.state.hull = 100; t.state.shields = 100; window.__seconds(1); } };
    window.__msgs = [];
    { const st = t.state; let cur = st.log; Object.defineProperty(st, 'log', { configurable: true, enumerable: true, get: () => cur, set: (v) => { cur = v; if (v) window.__msgs.push(String(v)); } }); }
    // Only the Borg live: no patrols, traffic, hunts, responses or campaign operations to muddy the scenario.
    window.__quiet = (borg = {}) => { const db = t.DoctrineCampaign.doctrineBook(t.campaign()); db.config = { ...db.config, patrols: {}, explorers: {}, merchants: {}, projects: {}, patrolAreas: {}, militaryResponses: false, enforcementResponses: false, predation: false, hunts: {}, borg: { ...(db.config.borg || { power: 'borg' }), captain: false, ...borg } }; t.campaign().config.aiStrategicOps = false; };
    // Every non-Borg hull standing at `systems` re-stationed at `far` and held (only the scenario's own vessels there).
    window.__clear = (systems, far) => { const set = new Set(systems.map(Number)); for (const [pid, p] of Object.entries(t.campaign().polities)) if (pid !== 'borg' && pid !== 'player') for (const h of p.hulls) if (h.status !== 'lost' && !h.transit && set.has(Number(h.systemIndex))) { h.systemIndex = far; if (h.status === 'ready') { h.status = 'assigned'; h.opId = 'held-by-gate'; } } };
    window.__cover = () => { const W = window.__W(); return W.systems.filter((s) => s.controller === 'borg').flatMap((s) => [Number(s.index), ...W.neighbours(s.index).map(Number)]); };
    // A Terran Inquiry (class 289, a campaign hull of the Terrans' own) lying disabled at `at`, held there.
    window.__inquiry = (at) => {
      const b = t.campaign();
      let h = b.polities.terran.hulls.find((x) => Number(x.shipId) === 289 && x.status === 'ready' && !x.opId && !x.transit);
      // None free in this campaign: a free Terran hull of the Terrans' own fitted as the Inquiry class (setup).
      if (!h) { h = b.polities.terran.hulls.find((x) => x.status === 'ready' && !x.opId && !x.transit); h.shipId = 289; h.maxHull = window.__W().shipStats(289).combatHull; }
      h.systemIndex = at; h.status = 'assigned'; h.opId = 'held-by-gate';
      h.hull = Math.max(1, Math.floor(t.Fleet.disableThreshold(h.maxHull)));
      return { hullId: h.id, vid: window.__vid(h), shipId: h.shipId, hull: h.hull, maxHull: h.maxHull, origin: h.identity?.origin?.builder ?? null };
    };
    // Setup for the interdiction and node scenarios: the Collective's own assimilation transfer of a disabled hull
    // (campaign-strategy assimilateHull, as the cube's completion calls it) — the hulk the scenario starts from.
    window.__assimilated = (at) => {
      const x = window.__inquiry(at);
      const h = window.__find(x.hullId).h;
      t.Campaign.assimilateHull(t.campaign(), h, 'terran', 'borg', t.state.day, at, { result: 'crew_assimilated', before: 1, survivors: 0, assimilated: 1, after: 1 });
      return x;
    };
    window.__row = (hullId) => window.__dbg().rows.find((r) => r.hullId === hullId) || null;
    window.__snap = (hullId) => { const f = window.__find(hullId); const r = window.__rec(hullId); const m = window.__mission(r); const c = window.__cube();
      return { day: t.state.day, owner: f?.pid, at: f?.h.systemIndex, transit: f?.h.transit ? f.h.transit.to : null, hull: f ? Math.round(f.h.hull) : null, maxHull: f?.h.maxHull, status: f?.h.status, disabled: f ? t.Campaign.hullIsDisabled(f.h) : null,
        phase: r?.phase ?? null, wait: r?.waitReason ?? null, result: r?.result ?? null, mission: m && { state: m.state, yard: m.yard, outbound: m.outbound && { mode: m.outbound.mode, route: m.outbound.route, departDay: m.outbound.departDay, eta: m.outbound.eta }, inbound: m.inbound, attachment: m.attachment, losses: m.losses, borgMovement: m.borgMovement },
        cube: c && { at: c.systemIndex, transit: c.transit ? c.transit.to : null, status: c.status, hull: Math.round(c.hull) } }; };
  });

  const H = await ev(() => testBM1.getSystemIndexByName('Harman'));
  const V = 33; // Vex
  let main = null; // { hullId, vid, … }

  // ================================================================================================
  // BORG-HULK-RECOVERY
  // ================================================================================================
  await check('preservation', 'SHIP-ASSIMILATION the cube at Harman assimilates a disabled Terran Inquiry by the accepted rules: the same hull becomes the Collective\'s (same vid, class, origin), its damage kept, no hull created; the cube withdraws home', async () => {
    await fresh('br-main'); await setup();
    const r = await ev((H) => {
      const t = testBM1;
      window.__quiet({ ships: true, worlds: false });
      window.__clear([...window.__cover(), H], window.__idx('Earth'));
      const x = window.__inquiry(H);
      const cube = window.__cube(); cube.systemIndex = H;
      const borg0 = window.__borg().map((h) => h.id);
      let o = null;
      for (let i = 0; i < 12; i++) { window.__adv(1); o = window.__sum().objectives.slice(-1)[0]; if (o?.result) break; }
      const f = window.__find(x.hullId);
      return { x, o: o && { target: o.target?.vid, result: o.result, phase: o.phase }, owner: f.pid, vid: window.__vid(f.h), shipId: f.h.shipId, hull: f.h.hull, origin: f.h.identity?.origin?.builder, borg: window.__borg().map((h) => h.id), borg0, day: t.state.day, cube: { at: cube.systemIndex, transit: cube.transit?.to ?? null } };
    }, H);
    main = r.x;
    evidence.push({ check: 'SHIP-ASSIMILATION', ...r });
    assert.equal(r.o?.result?.result, 'target_assimilated', JSON.stringify(r.o));
    assert.equal(r.owner, 'borg'); assert.equal(r.vid, r.x.vid); assert.equal(r.shipId, 289); assert.equal(r.origin, r.x.origin);
    assert.ok(Math.abs(r.hull - r.x.hull) < 0.5, `hull ${r.hull} vs ${r.x.hull}`);
    assert.deepEqual(r.borg.slice().sort(), [...r.borg0, r.x.hullId].sort());
  });
  await check('baseline-defect', 'R1/R3 STRANDED the assimilated Inquiry lies disabled at Harman — no self-repair, its hull unchanged — and a recovery objective waits on it: recovery_pending, "no Borg recovery vessel free" while the cube is away (e949936: no objective; it lies there for ever) (SHOT)', async () => {
    const r = await ev((x) => {
      const trail = [];
      for (let i = 0; i < 4; i++) { window.__adv(1); trail.push(window.__snap(x.hullId)); }
      return { trail, row: window.__row(x.hullId) };
    }, main);
    evidence.push({ check: 'STRANDED', ...r });
    const last = r.trail.at(-1);
    assert.ok(r.trail.every((s) => s.at === H && s.disabled && s.hull === r.trail[0].hull && s.transit == null), `the hulk moved or changed: ${JSON.stringify(r.trail)}`);
    assert.ok(last.phase, 'no recovery objective: the hulk lies there with nothing coming for it');
    assert.equal(last.phase, 'recovery_pending'); assert.equal(last.wait, 'no Borg recovery vessel free');
    assert.ok(last.cube.transit != null || last.cube.at !== H, 'the cube is still at Harman');
    await shotBlock('BR-1-stranded-assimilated-hulk-debug.png', '[data-hulk-recovery-block]');
  });
  await check('new-feature', 'R4/R5 VESSEL-EN-ROUTE once the cube is home and free it is sent for the hulk: by conduit (Vex ⇒ Harman, the transwarp days against the conventional), a real journey of the cube; the hulk has not moved (SHOT)', async () => {
    const r = await ev((x) => {
      let s = null;
      for (let i = 0; i < 60; i++) { window.__adv(1); s = window.__snap(x.hullId); if (s.mission && ['en_route_to_hulk', 'on_scene', 'attached', 'towing'].includes(s.mission.state)) break; }
      const tr = s?.mission ? testBM1.Campaign.journeyById(testBM1.campaign(), window.__cube().transit?.journeyId) : null;
      return { s, tr: tr && { mode: tr.mode, path: tr.path, legDays: tr.legDays, etaDay: tr.etaDay, members: tr.members, kind: tr.kind }, row: window.__row(x.hullId) };
    }, main);
    evidence.push({ check: 'VESSEL-EN-ROUTE', ...r });
    assert.ok(r.s?.mission, `never dispatched: ${JSON.stringify(r.s)}`);
    assert.equal(r.s.mission.state, 'en_route_to_hulk', r.s.mission.state);
    assert.equal(r.s.mission.outbound.mode, 'transwarp'); assert.deepEqual(r.s.mission.outbound.route?.slice(0, 1), [V]);
    assert.ok(r.s.mission.borgMovement.conventionalDays > r.s.mission.borgMovement.transwarpDays, JSON.stringify(r.s.mission.borgMovement));
    assert.ok(r.tr && r.tr.mode === 'transwarp' && r.tr.path.length === 1 && r.tr.path[0] === H, JSON.stringify(r.tr));
    assert.equal(r.s.at, H); assert.equal(r.s.transit, null); assert.equal(r.s.phase, 'recovery_en_route');
    await shotBlock('BR-2-recovery-vessel-en-route-debug.png', '[data-hulk-recovery-block]');
    await shotBlock('BR-2-recovery-vessel-en-route-journey-debug.png', '[data-journey-section]');
  });
  await check('new-feature', 'R7/R8/R9/R19 TOW-UNDERWAY made fast only when the cube stands at Harman; towed home conventionally over two legs (Harman → Kardon → Vex) at the shared tow speed (1.32 × 0.70), the hulk disabled throughout; R10 save/load mid-tow keeps the journey, route and ETA (SHOT)', async () => {
    const r = await ev((x) => {
      const t = testBM1;
      const trail = [];
      let s = null;
      for (let i = 0; i < 40; i++) { window.__adv(1); s = window.__snap(x.hullId); trail.push({ d: s.day, at: s.at, transit: s.transit, cubeAt: s.cube.at, cubeTransit: s.cube.transit, state: s.mission?.state, disabled: s.disabled }); if (s.mission?.state === 'towing' && s.transit != null) break; }
      const tr = s.mission?.inbound ? t.Campaign.journeyById(t.campaign(), s.mission.inbound.journeyId) : null;
      const before = tr && JSON.stringify({ path: tr.path, legDays: tr.legDays, etaDay: tr.etaDay, speed: tr.speed, mode: tr.mode || null });
      t.saveGame(3); t.loadGame(3);
      const tr2 = s.mission?.inbound ? t.Campaign.journeyById(t.campaign(), s.mission.inbound.journeyId) : null;
      const after = tr2 && JSON.stringify({ path: tr2.path, legDays: tr2.legDays, etaDay: tr2.etaDay, speed: tr2.speed, mode: tr2.mode || null });
      return { s, trail, tr: tr && JSON.parse(before), same: before === after, speed: t.Campaign.hullsSpeed(window.__W(), [window.__cube()]), penalty: t.campaign().config.towPenalty, towSpeed: t.Speed.towSpeed(t.Campaign.hullsSpeed(window.__W(), [window.__cube()]), t.campaign().config.towPenalty), row: window.__row(x.hullId), K: window.__idx('Kardon') };
    }, main);
    evidence.push({ check: 'TOW-UNDERWAY', ...r });
    const att = r.s.mission?.attachment?.day;
    assert.ok(att != null, `never attached: ${JSON.stringify(r.s.mission)}`);
    for (const x of r.trail.filter((y) => y.d < att)) assert.equal(x.at, H, `the hulk moved before the cube reached it (day ${x.d})`);
    assert.equal(r.s.mission.outbound.eta, att, 'made fast before the cube arrived');
    assert.deepEqual(r.s.mission.inbound.route, [H, r.K, V]); assert.equal(r.tr.mode, null, 'the tow went by conduit');
    assert.equal(r.penalty, 0.7); assert.equal(r.speed, 1.32); assert.equal(r.tr.speed, r.towSpeed, `tow speed ${r.tr.speed} vs the shared towSpeed(${r.speed}, 0.7) = ${r.towSpeed}`); assert.equal(r.towSpeed, 0.92);
    assert.ok(r.trail.every((y) => y.disabled), 'not disabled under tow');
    assert.ok(r.same, 'the tow journey changed on save/load');
    await shotBlock('BR-3-tow-underway-debug.png', '[data-hulk-recovery-block]');
    await shotBlock('BR-3-tow-underway-journey-debug.png', '[data-journey-section]');
  });
  await check('new-feature', 'R14/R15/R16 NODE-REGENERATION delivered at Vex on the tow\'s ETA, the origin node takes it in and regenerates it day by day (2% of hull a day): not in service while regenerating (SHOT)', async () => {
    const r = await ev((x) => {
      const eta = window.__snap(x.hullId).mission.inbound.eta;
      let s = null; const trail = [];
      for (let i = 0; i < 60; i++) { window.__adv(1); s = window.__snap(x.hullId); trail.push({ d: s.day, at: s.at, hull: s.hull, status: s.status, phase: s.phase, state: s.mission?.state }); if (s.phase === 'regenerating' && trail.filter((y) => y.phase === 'regenerating').length >= 8) break; }
      return { eta, s, trail, row: window.__row(x.hullId) };
    }, main);
    evidence.push({ check: 'NODE-REGENERATION', ...r });
    const delivered = r.trail.find((y) => y.state === 'delivered_to_yard');
    assert.ok(delivered, 'never delivered'); assert.equal(delivered.d, r.eta, `delivered day ${delivered.d}, ETA ${r.eta}`); assert.equal(delivered.at, V);
    const regen = r.trail.filter((y) => y.phase === 'regenerating');
    assert.ok(regen.length >= 8, 'no regeneration');
    for (let i = 1; i < regen.length; i++) assert.ok(regen[i].hull > regen[i - 1].hull, 'hull did not grow day by day');
    assert.ok(regen.every((y) => y.status !== 'ready'), 'in service while regenerating');
    assert.equal(r.row?.node, V);
    await shotBlock('BR-4-node-regeneration-debug.png', '[data-hulk-recovery-block]');
  });
  await check('new-feature', 'R2/R16/R17/R18/R24 SAME-HULL-OPERATIONAL at the threshold the same Inquiry — vid, class, origin, assimilation — is back in service under the Collective at Vex, hull ≥ 60%: no new hull or duplicate vid, no licence or production right, no conduit of its own, no yard or market (SHOT)', async () => {
    const r = await ev((x) => {
      const t = testBM1;
      let s = null;
      for (let i = 0; i < 60; i++) { window.__adv(1); s = window.__snap(x.hullId); if (s.result) break; }
      const f = window.__find(x.hullId);
      const all = [...Object.values(t.campaign().polities).flatMap((p) => p.hulls), ...(t.campaign().derelicts || [])];
      const W = window.__W();
      return { s, vid: window.__vid(f.h), shipId: f.h.shipId, origin: f.h.identity?.origin?.builder, from: f.h.assimilated?.from, history: (f.h.identity?.history || []).map((y) => y.event), regenerated: f.h.regenerated, frac: f.h.hull / f.h.maxHull,
        sameVid: all.filter((h) => window.__vid(h) === x.vid).length, licences: Object.keys(t.campaign().polities.borg.licenses || {}), canBuild: t.Campaign.polityCanBuildDesign(t.campaign(), W, 'borg', 289), transwarp: t.Campaign.transwarpCapable(W, f.h),
        repairDays: Object.values(t.campaign().polities.borg.repairedToday || {}).length, row: window.__row(x.hullId), stats: window.__sum().stats };
    }, main);
    evidence.push({ check: 'SAME-HULL-OPERATIONAL', ...r });
    assert.equal(r.s.result?.result, 'hulk_operational', JSON.stringify(r.s.result));
    assert.equal(r.s.owner, 'borg'); assert.equal(r.s.status, 'ready'); assert.equal(r.s.at, V); assert.equal(r.s.disabled, false);
    assert.ok(r.frac >= 0.6 - 1e-9 && r.frac < 0.65, `hull share ${r.frac}`);
    assert.equal(r.vid, main.vid); assert.equal(r.shipId, 289); assert.equal(r.origin, main.origin); assert.equal(r.from, 'terran'); assert.ok(r.history.includes('assimilated'));
    assert.equal(r.sameVid, 1, 'duplicate identity'); assert.equal(r.licences.length, 0); assert.equal(r.canBuild, false); assert.equal(r.transwarp, false);
    assert.ok(r.regenerated?.days >= 20, JSON.stringify(r.regenerated));
    await shotBlock('BR-5-same-hull-operational-debug.png', '[data-hulk-recovery-block]');
  });

  // ================================================================================================
  // BORG-RECOVERY-INTERDICTED
  // ================================================================================================
  // A hulk at Rator (Romulan; the shared planner tows it home Rator → Virinat → Harman → Kardon → Vex); the tow's first
  // crossing (Virinat, Romulan) blockaded by the Klingons, at war with the Romulans for the scenario. Seeds are searched for each branch's own draw.
  const interdiction = async (seed, { captain = false, blockaders = 2 } = {}) => {
    await fresh(seed); await setup();
    return ev(({ captain, blockaders }) => {
      const t = testBM1;
      window.__quiet({ ships: false, worlds: false });
      const G = window.__idx('Rator');
      window.__clear([...window.__cover(), G], window.__idx('Earth'));
      const x = window.__assimilated(G);
      const W = window.__W(), b = t.campaign(); t.syncPlayerPolity(b);
      const plan = t.Campaign.planHullRecovery(b, W, { sponsor: 'borg', targetHullId: x.hullId, tugHullId: window.__cube().id }, t.state.day);
      const mid = plan.ok ? plan.inbound?.path?.[0] ?? plan.yardPlan?.path?.[0] ?? null : null;
      const route = plan.ok ? (plan.inbound?.path || plan.yardPlan?.path || null) : null;
      const M = mid ?? (route ? route[0] : null);
      if (M == null) return { fail: 'no plan', plan };
      const holder = W.systems[M].controller;
      // The Klingons at war with the holder for the scenario (pirates take no declaration: they are outside diplomacy).
      try { if (holder && holder !== 'klingon' && holder !== 'pirate') t.applyWarDeclarationEngine({ a: 'klingon', b: holder, status: 'war', reason: 'gate: the scenario\'s blockade', warId: 'gate-br-war', by: 'klingon', source: 'gate' }, t.state.day); } catch (e) { return { fail: `no war: ${e.message}`, M, holder }; }
      const kl = b.polities.klingon.hulls.filter((h) => h.status === 'ready' && !h.opId && !h.transit).slice(0, blockaders);
      for (const h of kl) h.systemIndex = M;
      // Held on station for the scenario (Virinat is far from Klingon supply: unsupplied, it would withdraw in 10 days).
      b.config.blockadeMaxDays = 400; b.config.blockadeUnsuppliedDays = 400;
      const fx = [];
      const bl = t.Campaign.startBlockade(b, t.buildCampaignWorld(true), { power: 'klingon', target: M, hullIds: kl.map((h) => h.id), purpose: 'interdict_trade' }, t.state.day, fx);
      t.applyCampaignEffects(fx, t.state.day);
      if (!bl.ok) return { fail: `blockade refused: ${bl.reason}`, M, holder };
      if (captain) { window.__place(M); window.__reset(); }
      return { x, G, M, holder, bid: bl.record.id, plan: { ok: plan.ok, yard: plan.yard, keys: Object.keys(plan) } };
    }, { captain, blockaders });
  };
  await check('new-feature', 'R11 INTERDICTED-THROUGH the tow crossing the blockade is run once through the shared blockade engine (the cube as tug, the hulk as a towed member, at the tow speed); in this branch it gets through: the tow goes on and the hulk is delivered (SHOT)', async () => {
    let r = null;
    // Seeds searched for the branch's own draw (the one found first tried first).
    for (const k of [1, 0, 2, 3, 4, 5]) {
      if (r) break;
      const s = await interdiction(`br-int-through-${k}`);
      if (s.fail) { evidence.push({ check: 'INTERDICTED-THROUGH setup', k, ...s }); continue; }
      const x = await ev((s) => {
        const t = testBM1;
        let snap = null;
        for (let i = 0; i < 80; i++) { window.__adv(1); snap = window.__snap(s.x.hullId); if (snap.result || snap.mission?.state === 'delivered_to_yard' || ['failed', 'cancelled'].includes(snap.mission?.state)) break; }
        const bl = (t.campaign().blockades || []).find((b) => b.id === s.bid);
        const tr = snap.mission?.inbound ? t.Campaign.journeyById(t.campaign(), snap.mission.inbound.journeyId) : null;
        return { s, snap, runs: (bl?.runs || []).filter((y) => y.sponsor === 'borg'), journeyRuns: (tr?.encounters || []).filter((y) => y.blockadeId === s.bid), towSpeed: tr?.speed, sharedTowSpeed: t.Speed.towSpeed(t.Campaign.hullsSpeed(window.__W(), [window.__cube() || { shipId: 346 }]), 0.7) };
      }, s);
      evidence.push({ check: 'INTERDICTED-THROUGH attempt', k, ...x });
      if (x.runs.length && x.runs.every((y) => !/forced_back|destroyed|captured/.test(y.outcome)) && x.snap.mission?.state === 'delivered_to_yard') r = x;
      if (!x.runs.length && x.snap.mission?.state === 'delivered_to_yard') r = r || null;
    }
    assert.ok(r, 'no seed got through the blockade');
    assert.equal(r.runs.length, 1, `runs ${JSON.stringify(r.runs)}`); assert.equal(r.journeyRuns.length, 1);
    assert.equal(r.snap.at, V); assert.ok(r.snap.mission.losses.every((l) => l.hullId !== r.snap.mission.tug?.hullId));
    assert.equal(r.towSpeed, r.sharedTowSpeed);
    await shotBlock('BR-6-interdicted-through-journey-debug.png', '[data-journey-section]');
  });
  await check('new-feature', 'R11/R12/R23 INTERDICTED-LOST the captain stands at the blockaded world: the interception is held for his scene (one encounter; the cube spawned as the runner, the hulk a towed member, not spawned); nothing strategic touches either while it waits; the cube is destroyed in the scene, the encounter resolves once, the cube is lost on its own record, and the hulk lies where the tow was let go — still disabled, still the Collective\'s, never teleported home; the recovery closes recovery_vessel_destroyed (SHOT)', async () => {
    let r = null, s = null;
    for (const k of [7, 0, 1, 2, 3, 4, 5, 6, 8, 9, 10, 11]) {
      if (r) break;
      s = await interdiction(`br-int-lost-${k}`, { captain: true, blockaders: 6 });
      if (s.fail) { evidence.push({ check: 'INTERDICTED-LOST setup', k, ...s }); continue; }
      const x = await ev((s) => {
        const t = testBM1;
        let enc = null, snap = null;
        for (let i = 0; i < 60 && !enc; i++) { window.__adv(1); window.__reset(); snap = window.__snap(s.x.hullId); enc = (t.campaign().encounters || []).find((e) => e.type === 'blockade' && e.status !== 'resolved' && String(e.objective?.ref) === String(s.bid)) || null; if (snap.result || (snap.mission && ['delivered_to_yard', 'failed'].includes(snap.mission.state))) break; }
        if (!enc) return { held: false, snap };
        const cube = window.__cube();
        const recs0 = { cube: cube.hull, hulk: window.__find(s.x.hullId).h.hull };
        window.__adv(1); window.__reset();
        const recs1 = { cube: cube.hull, hulk: window.__find(s.x.hullId).h.hull };
        return { held: true, enc: { id: enc.id, status: enc.status, captain: enc.captain, participants: enc.participants.map((p) => ({ side: p.side, vid: p.vid, spawn: p.spawn ?? null, towed: p.towed ?? null })) }, recs0, recs1, snap: window.__snap(s.x.hullId) };
      }, s);
      evidence.push({ check: 'INTERDICTED-LOST attempt', k, s, ...x });
      if (x.held) r = x;
    }
    assert.ok(r, 'no seed held the interception for the captain\'s scene');
    const cubeVid = await ev(() => window.__vid(window.__cube()));
    assert.equal(r.enc.status, 'pending'); assert.deepEqual(r.recs0, r.recs1, 'R23: strategic damage while the scene held the contact');
    const runner = r.enc.participants.filter((p) => p.side === 'runner');
    assert.ok(runner.some((p) => p.vid === cubeVid), `the cube is not the runner: ${JSON.stringify(runner)}`);
    assert.ok(runner.some((p) => p.vid === s.x.vid && p.towed && !p.spawn), `the hulk was spawned or missing: ${JSON.stringify(runner)}`);
    // The scene: the cube spawns, the gate lets the scene run, then the blockade's fire is made decisive.
    const scene = await ev((s) => {
      const t = testBM1;
      let enc = (t.campaign().encounters || []).find((e) => e.type === 'blockade' && String(e.objective?.ref) === String(s.bid));
      for (let i = 0; i < 6 && enc.status !== 'tactical_active'; i++) window.__hold(1);
      const npcs = window.__npcs(enc.id).map((n) => ({ vid: n.vid, side: n.encounterSide, shipId: n.shipId, destroyed: Boolean(n.destroyed) }));
      const cn = window.__npcs(enc.id).find((n) => n.vid === window.__vid(window.__cube()));
      return { status: enc.status, npcs, cubeNpc: Boolean(cn) };
    }, s);
    evidence.push({ check: 'INTERDICTED-LOST scene', ...scene });
    assert.equal(scene.status, 'tactical_active');
    assert.ok(scene.cubeNpc, `the cube is not in the scene: ${JSON.stringify(scene.npcs)}`);
    assert.ok(!scene.npcs.some((n) => n.vid === s.x.vid), 'the hulk was put into the scene');
    // The captain closes on the cube (the camera is his position) so the shot shows the scene's ships.
    const closing = await ev(() => { const t = testBM1; const e = (t.campaign().encounters || []).filter((x) => x.type === 'blockade').slice(-1)[0];
      const cn = window.__npcs(e.id).find((n) => Number(n.shipId) === 346 && !n.destroyed);
      t.setCamera(cn.x - 260, cn.y - 140); t.state.velocity && (t.state.velocity.x = 0, t.state.velocity.y = 0);
      window.__hold(1);
      return { status: e.status, ships: window.__npcs(e.id).map((n) => [n.vid, n.shipId, Math.round(t.distanceToPlayer(n)), Boolean(n.destroyed)]) }; });
    evidence.push({ check: 'INTERDICTED-LOST closing', ...closing });
    await shot('BR-7-interdiction-scene-cube-runner.png');
    const after = await ev((s) => {
      const t = testBM1;
      const enc = (t.campaign().encounters || []).find((e) => e.type === 'blockade' && String(e.objective?.ref) === String(s.bid));
      const cn = window.__npcs(enc.id).find((n) => n.vid === window.__vid(window.__cube()));
      t.damageCombatTarget(cn, Math.ceil((cn.combatShields || 0) + cn.combatHull + 1), 'npc');
      for (let i = 0; i < 30 && enc.status !== 'resolved'; i++) window.__hold(1);
      if (enc.status !== 'resolved') for (let k = 0; k < 120 && t.Encounter.isLive(enc); k++) { t.playtestClock.offset -= 1000; t.updateStrategicEncounters(); }
      for (let i = 0; i < 2; i++) { window.__adv(1); window.__reset(); }
      const cube = t.campaign().polities.borg.hulls.find((h) => Number(h.shipId) === 346);
      const ev2 = enc.history.map((h) => h.event);
      return { enc: { status: enc.status, result: enc.result, resolved: ev2.filter((e) => e === 'resolved').length, fallback: enc.fallback }, cube: cube && { status: cube.status, fate: cube.fate, hull: cube.hull }, snap: window.__snap(s.x.hullId), encounters: (t.campaign().encounters || []).filter((e) => e.type === 'blockade' && String(e.objective?.ref) === String(s.bid)).length, row: window.__row(s.x.hullId) };
    }, s);
    evidence.push({ check: 'INTERDICTED-LOST after', ...after });
    assert.equal(after.enc.status, 'resolved'); assert.equal(after.enc.resolved, 1); assert.equal(after.enc.fallback, null); assert.equal(after.encounters, 1);
    assert.ok(!after.cube || after.cube.status === 'lost', `the cube survived: ${JSON.stringify(after.cube)}`);
    assert.equal(after.snap.at, s.M, `the hulk is at ${after.snap.at}, the tow was let go at ${s.M}`); assert.equal(after.snap.transit, null);
    assert.equal(after.snap.owner, 'borg'); assert.equal(after.snap.disabled, true);
    assert.equal(after.snap.result?.result, 'recovery_vessel_destroyed', JSON.stringify(after.snap.result));
    await shotBlock('BR-8-interdicted-lost-debug.png', '[data-hulk-recovery-block]');
  });

  // ================================================================================================
  // BORG-NODE-VALIDATION
  // ================================================================================================
  await check('new-feature', 'R13/R14 NODE-VALIDATION Vex (origin) is a node from the start; Tarellia, assimilated by the cube, is not a node the day it completes ("stabilizing until day N"): a hulk lying there is not regenerated there; once stabilized, a hulk lying there is taken in where it lies (no vessel, no tow) and regenerates (SHOT)', async () => {
    await fresh('br-node'); await setup();
    const r0 = await ev(() => {
      const t = testBM1;
      window.__quiet({ ships: false, worlds: true });
      const T = window.__idx('Tarellia');
      const b = t.campaign();
      const holder = window.__W().systems[T].controller;
      for (const h of b.polities[holder]?.hulls || []) if (Number(h.systemIndex) === T && !h.transit) { h.systemIndex = window.__idx('Vulcan'); h.status = 'assigned'; h.opId = 'held-by-gate'; }
      const vex0 = window.__dbg().nodes.find((n) => n.systemIndex === 33);
      const cube = window.__cube(); cube.systemIndex = T;
      let day = null;
      for (let i = 0; i < 240; i++) { window.__adv(1); if (t.getSystemControl(T).controller === 'borg') { day = t.state.day; break; } }
      return { T, holder, vex0, day };
    });
    evidence.push({ check: 'NODE-VALIDATION world', ...r0 });
    assert.ok(r0.vex0?.ok && r0.vex0.kind === 'origin', `Vex: ${JSON.stringify(r0.vex0)}`);
    assert.ok(r0.day, 'Tarellia was never assimilated');
    const r1 = await ev((r0) => {
      const t = testBM1;
      window.__quiet({ ships: false, worlds: false });
      const x = window.__assimilated(r0.T);
      const node = window.__dbg().nodes.find((n) => n.systemIndex === r0.T);
      const trail = [];
      for (let i = 0; i < 6; i++) { window.__adv(1); const s = window.__snap(x.hullId); trail.push({ d: s.day, at: s.at, hull: s.hull, phase: s.phase, yard: s.mission?.yard ?? null, wait: s.wait }); }
      const c = window.__cube();
      return { x, node, trail, nodeAfter: window.__dbg().nodes.find((n) => n.systemIndex === r0.T), cube: c && { at: c.systemIndex, status: c.status, opId: c.opId, hull: c.hull, maxHull: c.maxHull, transit: c.transit?.to ?? null, stranded: c.stranded || null } };
    }, r0);
    evidence.push({ check: 'NODE-VALIDATION fresh', ...r1 });
    assert.equal(r1.node?.ok, false, JSON.stringify(r1.node)); assert.match(r1.node.reason, /stabilizing until day \d+/);
    assert.ok(r1.trail.every((y) => y.phase !== 'regenerating' && y.phase !== 'at_borg_node' && y.yard !== r0.T), `a fresh world took the hulk in: ${JSON.stringify(r1.trail)}`);
    assert.ok(r1.trail.every((y) => y.hull === r1.trail[0].hull), 'the hulk regenerated at a fresh world');
    await shotBlock('BR-9-node-validation-fresh-world-debug.png', '[data-hulk-recovery-block]');
    const ready = Number(r1.node.reason.match(/day (\d+)/)[1]);
    const r2 = await ev(({ r0, ready }) => {
      const t = testBM1;
      for (let i = 0; i < 400 && t.state.day < ready; i++) window.__adv(1);
      const node = window.__dbg().nodes.find((n) => n.systemIndex === r0.T);
      // The first hulk may be on its way to Vex (or gone): a second, lying at Tarellia now.
      const y = window.__assimilated(r0.T);
      let s = null; const trail = [];
      for (let i = 0; i < 30; i++) { window.__adv(1); s = window.__snap(y.hullId); trail.push({ d: s.day, at: s.at, hull: s.hull, phase: s.phase, yard: s.mission?.yard ?? null, state: s.mission?.state ?? null }); if (s.phase === 'regenerating' && trail.filter((z) => z.phase === 'regenerating').length >= 3) break; }
      return { node, y, trail, day: t.state.day };
    }, { r0, ready });
    evidence.push({ check: 'NODE-VALIDATION stabilized', ...r2 });
    assert.ok(r2.node?.ok && r2.node.kind === 'assimilated', JSON.stringify(r2.node));
    const regen = r2.trail.filter((y) => y.phase === 'regenerating');
    assert.ok(regen.length >= 3, `not regenerated at Tarellia: ${JSON.stringify(r2.trail)}`);
    assert.ok(regen.every((y) => y.at === r0.T), 'moved off Tarellia'); assert.ok(regen.at(-1).hull > regen[0].hull);
    assert.ok(r2.trail.every((y) => y.yard == null), 'a vessel was sent for a hulk lying at a node');
    await shotBlock('BR-10-node-validation-stabilized-debug.png', '[data-hulk-recovery-block]');
  });
  await check('new-feature', 'DEBUG-HULK-RECOVERY the "Assimilated hulk recovery" debug block shows hulk vid and class, hull and where, recovery status, vessel, movement, tow, node, regeneration, ETA, result, and the Borg nodes with why', async () => {
    const r = await ev(() => { testBM1.openDebugMenu(); const el = document.querySelector('[data-hulk-recovery-block]'); const txt = el ? el.textContent : null; document.getElementById('cheats-debug').close(); return { txt }; });
    evidence.push({ check: 'DEBUG-HULK-RECOVERY', txt: r.txt?.slice(0, 1500) });
    for (const k of ['Assimilated hulk recovery', 'Hulk (vid) · class', 'Hull · where', 'Recovery status', 'Recovery vessel', 'Movement', 'Tow', 'Node', 'Regeneration', 'ETA', 'Result', 'Borg nodes']) assert.ok(r.txt && r.txt.includes(k), `missing ${k}`);
  });

  fs.writeFileSync(path.join(out, process.env.BM1_TEST_ROOT ? 'borg-recovery-gate-baseline.json' : 'borg-recovery-gate.json'), JSON.stringify({ results, evidence }, null, 1));
  const byCat = (c) => { const x = results.filter((y) => y.category === c); return `${x.filter((y) => y.ok).length}/${x.length}`; };
  console.log(`\nborg hulk recovery in-game: ${results.filter((x) => x.ok).length}/${results.length} (baseline-defect ${byCat('baseline-defect')}, new-feature ${byCat('new-feature')}, preservation ${byCat('preservation')})`);
  if (probe.errors.length) console.log('page errors:', probe.errors.slice(0, 5));
  await probe.close();
  process.exit(results.every((x) => x.ok) && !probe.errors.length ? 0 : 1);
})().catch((e) => { console.error(e); process.exit(1); });
