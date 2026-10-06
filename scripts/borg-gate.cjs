// In-game gate for BORG-ASSIMILATION-TRANSWARP (docs/doctrine/BORG-ASSIMILATION-TRANSWARP.md). The real engine,
// the default chart and the campaign's own Borg Assimilation Cube at Vex. Scenarios:
//   BORG-SHIP-ASSIMILATION + BORG-TRANSWARP: a valuable vessel is seen at Astron beside Vex; the Collective chooses
//     it, plans conventional (~9 d) and transwarp (2 d), jumps, exits at Astron where the captain is (his scene),
//     the target is disabled in the scene, the assimilation goes on from there and the same hull becomes Borg;
//   BORG-WORLD-ASSIMILATION: the cube at Tarellia suppresses it, progress persists (save/load), the cube recalled
//     stops it, the cube staying completes it — controller Borg, origin kept, no market, no capture, no war.
// Categories:
//   baseline-defect  9db1fc6's generic Borg do none of it (fails on its own assertion)
//   new-feature      needs this round's assimilation / transwarp
//   preservation     must hold on both
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { startProbe } = require('./probe-harness.cjs');

(async () => {
  const probe = await startProbe({ viewport: { width: 1400, height: 900 }, pageOptions: { deviceScaleFactor: 2 } });
  const { ev, fresh, page } = probe;
  const out = process.env.BM1_TEST_OUTPUT || '/tmp';
  fs.mkdirSync(out, { recursive: true });
  const results = [];
  const evidence = [];
  async function check(category, name, fn) {
    try { await fn(); results.push({ category, name, ok: true }); console.log('PASS', `[${category}]`, name); }
    catch (err) { results.push({ category, name, ok: false, message: String(err?.message || err).split('\n').slice(0, 6).join(' ') }); console.log('FAIL', `[${category}]`, name, '\n      ', String(err?.message || err).split('\n').slice(0, 8).join(' ')); }
  }
  const shot = async (name) => { const draw = () => ev(() => { testBM1.render(); testBM1.updateSecurityOrderPanel?.(); }); await draw(); await page.waitForTimeout(500); await draw(); return page.screenshot({ path: path.join(out, name) }); };
  async function shotSection(file, selector) {
    await ev(() => testBM1.closeGalaxyReports?.());
    await ev((sel) => { const d = document.getElementById('cheats-debug'); if (!d.open) testBM1.openDebugMenu(); for (const x of d.querySelectorAll('section')) if (!x.matches(sel)) x.style.display = 'none'; d.style.maxHeight = 'none'; d.style.height = 'auto'; d.style.width = '1360px'; d.style.maxWidth = 'none'; d.style.overflow = 'visible'; d.style.position = 'absolute'; d.style.top = '0'; }, selector);
    const h = await ev((sel) => Math.ceil(document.querySelector(sel).getBoundingClientRect().bottom + window.scrollY + 40), selector);
    await page.setViewportSize({ width: 1400, height: Math.min(7000, Math.max(900, h)) });
    await page.locator(selector).screenshot({ path: path.join(out, file) });
    await page.setViewportSize({ width: 1400, height: 900 });
    await ev(() => { const d = document.getElementById('cheats-debug'); for (const x of d.querySelectorAll('section')) x.style.display = ''; d.removeAttribute('style'); d.close();
      testBM1.closeGalaxyReports?.(); const c = testBM1.playtestClock; if (c.stoppedAt !== null) { c.offset += performance.now() - c.stoppedAt; c.stoppedAt = null; } });
  }
  await page.waitForFunction(() => !testBM1.doctrineStatus || testBM1.doctrineStatus().state !== 'loading', null, { timeout: 30000 }).catch(() => {});
  const hasBorg = await ev(() => typeof testBM1.DoctrineCampaign.borgSummary === 'function');

  const setup = () => page.evaluate(() => {
    const t = testBM1;
    window.__adv = (n) => { for (let i = 0; i < n; i++) t.advanceFleetCalendar(1, t.Fleet.nextId(t.fleetBook(), 'journey')); };
    window.__idx = (name) => t.getSystemIndexByName(name);
    window.__step = (n, fs = 2.5) => { for (let i = 0; i < n; i++) { t.playtestClock.offset -= fs * 16.6667; t.tick(fs); t.updateSecurityOrderPanel?.(); } };
    window.__seconds = (s) => window.__step(Math.ceil((s * 1000) / (2.5 * 16.6667)));
    window.__vid = (h) => h?.identity?.vid || h?.vid || h?.id;
    window.__encs = () => (t.campaign().encounters || []).filter((e) => e.type === 'assimilation');
    window.__npcs = (id) => t.state.npcShips.filter((n) => n.encounterId === id);
    window.__sum = () => t.DoctrineCampaign.borgSummary ? t.DoctrineCampaign.borgSummary(t.campaign()) : { objectives: [], selections: {}, progress: {}, assimilatedHulls: [], assimilatedWorlds: [], transwarp: {}, stats: {} };
    window.__obj = () => window.__sum().objectives.find((o) => o.status === 'active') || window.__sum().objectives[0] || null;
    window.__borg = () => t.campaign().polities.borg?.hulls || [];
    window.__cube = () => window.__borg().find((h) => Number(h.shipId) === 346) || null;
    window.__place = (sys) => { t.markSystemVisited(sys); t.state.currentPlanet = sys; t.state.myplanet = sys + 1; t.applySystemState(sys); t.placePlayerAtSecurityApproach?.(); };
    window.__reset = () => { t.state.hull = 100; t.state.shields = 100; t.state.spawnProtectionUntil = 0; t.state.godMode = false; t.fleetBook().personalCondition = 'operational'; };
    window.__msgs = [];
    { const st = t.state; let cur = st.log; Object.defineProperty(st, 'log', { configurable: true, enumerable: true, get: () => cur, set: (v) => { cur = v; if (v) window.__msgs.push(String(v)); } }); }
    window.__said = (re) => window.__msgs.some((m) => re.test(m));
    // Only the Borg live: no patrols, traffic, hunts, responses or campaign operations to muddy the scenario.
    window.__quiet = (borg = {}) => { const db = t.DoctrineCampaign.doctrineBook(t.campaign()); db.config = { ...db.config, patrols: {}, explorers: {}, merchants: {}, projects: {}, patrolAreas: {}, militaryResponses: false, enforcementResponses: false, predation: false, hunts: {}, borg: { ...(db.config.borg || { power: 'borg' }), ...borg } }; t.campaign().config.aiStrategicOps = false; };
    // The Collective's sensor cover (Vex and its neighbours) cleared of other traffic: every other hull there is
    // re-stationed far away and held, so the scenario's target is the only vessel the Borg can see.
    window.__clearCover = (far) => {
      const b = t.campaign(); const W = t.buildCampaignWorld(true);
      const cover = new Set(W.systems.filter((s) => s.controller === 'borg').flatMap((s) => [Number(s.index), ...W.neighbours(s.index).map(Number)]));
      for (const [pid, p] of Object.entries(b.polities)) if (pid !== 'borg' && pid !== 'player') for (const h of p.hulls) if (h.status !== 'lost' && !h.transit && cover.has(Number(h.systemIndex))) { h.systemIndex = far; if (h.status === 'ready') { h.status = 'assigned'; h.opId = 'held-by-gate'; } }
      return [...cover];
    };
    // A valuable vessel (a Terran hull of the campaign's own, re-stationed and held) at `at`.
    window.__target = (at) => {
      const b = t.campaign(); const W = t.buildCampaignWorld(true);
      // Uncloaked (a cloak is not seen at border range) and not stronger than the cube will take on.
      const cube = (b.polities.borg?.hulls || [])[0];
      const cap = cube ? t.Campaign.hullStrength(b, W, cube) * 0.8 : Infinity;
      const pool = Object.entries(b.polities).filter(([pid]) => !['borg', 'player'].includes(pid)).flatMap(([pid, p]) => p.hulls.filter((h) => h.status === 'ready' && !h.opId && !h.transit && !W.shipStats(h.shipId)?.cloak && t.Campaign.hullStrength(b, W, h) <= cap).map((h) => ({ pid, h, price: W.shipStats(h.shipId)?.price || 0 })));
      const pick = pool.filter((x) => x.pid === 'terran').sort((a, b2) => b2.price - a.price)[0] || pool.sort((a, b2) => b2.price - a.price)[0];
      pick.h.systemIndex = at; pick.h.status = 'assigned'; pick.h.opId = 'held-by-gate';
      return { hullId: pick.h.id, vid: window.__vid(pick.h), polity: pick.pid, shipId: pick.h.shipId, hull: pick.h.hull, maxHull: pick.h.maxHull };
    };
    window.__hull = (polity, id) => (t.campaign().polities[polity]?.hulls || []).find((h) => h.id === id) || null;
    window.__find = (id) => { for (const [pid, p] of Object.entries(t.campaign().polities)) { const h = p.hulls.find((x) => x.id === id); if (h) return { pid, h }; } return null; };
    // The captain closes on the engagement (the camera is his position) so a shot shows the ships in it.
    window.__closeOn = () => { const e = window.__encs().filter((x) => window.__npcs(x.id).length).slice(-1)[0]; if (!e) return false; const ns = window.__npcs(e.id).filter((n) => !n.destroyed); if (!ns.length) return false; const x = ns.reduce((a, n) => a + n.x, 0) / ns.length, y = ns.reduce((a, n) => a + n.y, 0) / ns.length; t.setCamera(x + 260, y + 160); return true; };
    window.__brief = (o) => o && { id: o.id, targetKind: o.targetKind, target: o.target?.vid, phase: o.phase, status: o.status, result: o.result, movement: o.movement, progress: o.progress, engagements: o.engagements, handoff: o.handoff };
  });

  const V = 33; // Vex
  // ================================================================================================
  // BORG-SHIP-ASSIMILATION + BORG-TRANSWARP
  // ================================================================================================
  await check('baseline-defect', 'BORG-SELECTION a valuable vessel the Collective sees beside Vex (at Astron) becomes an assimilation target: the objective names its vid, the debug records every candidate\'s value, score and verdict (9db1fc6: the cube sits at Vex — no target, no objective) (SHOT)', async () => {
    await fresh('borg-g1'); await setup();
    const r = await ev(() => {
      const t = testBM1;
      window.__quiet({ worlds: false });
      const A = window.__idx('Astron');
      window.__clearCover(window.__idx('Earth'));
      const tgt = window.__target(A);
      const n0 = window.__borg().length;
      window.__adv(2);
      const sel = (window.__sum().selections.borg || []).slice(-1)[0] || null;
      return { A, tgt, sel: sel && { decision: sel.decision, chosen: sel.chosen, candidates: sel.candidates.slice(0, 6).map((c) => ({ vid: c.vid, value: c.value?.value, score: c.score, verdict: c.verdict, reason: c.reason, movement: c.movement })) }, o: window.__brief(window.__obj()), borg: window.__borg().length, n0, cube: window.__vid(window.__cube()) };
    });
    evidence.push({ check: 'BORG-SELECTION', ...r });
    assert.ok(r.o, `no assimilation objective: ${r.sel?.decision ?? 'no selection at all'}`);
    assert.equal(r.o.target, r.tgt.vid); assert.equal(r.borg, r.n0, 'a Borg hull was made');
    await shotSection('BORG-target-selection-debug.png', '[data-borg-section]');
  });

  await check('new-feature', 'BORG-TRANSWARP the objective plans conventional (~9 d) and transwarp (2 d) and jumps: a transwarp journey Vex ⇒ Astron (one leg, no route), entry announced, the cube\'s speed rating untouched (1.32×); the journey survives save and load identically (SHOT)', async () => {
    const r = await ev(() => {
      const t = testBM1;
      window.__adv(1);
      const o = window.__obj();
      const tr = (t.campaign().journeys || []).find((j) => j.id === o.movement?.journeyId);
      const before = tr && JSON.stringify(tr);
      t.saveGame(6); t.loadGame(6);
      const tr2 = (t.campaign().journeys || []).find((j) => j.id === o.movement?.journeyId);
      return { o: window.__brief(window.__obj()), tr: tr && { mode: tr.mode, path: tr.path, legDays: tr.legDays, etaDay: tr.etaDay, transwarp: tr.transwarp, members: tr.members }, same: before === JSON.stringify(tr2), speed: t.shipStrategicSpeed(346), day: t.state.day };
    });
    evidence.push({ check: 'BORG-TRANSWARP', ...r });
    assert.ok(r.tr, `no journey: ${JSON.stringify(r.o?.movement)}`);
    assert.equal(r.tr.mode, 'transwarp'); assert.deepEqual(r.tr.path, [await ev(() => window.__idx('Astron'))]); assert.equal(r.tr.legDays.length, 1);
    assert.ok(r.o.movement.conventionalDays > r.o.movement.transwarpDays + 2, JSON.stringify(r.o.movement));
    assert.ok(Math.abs(r.speed - 1.32) < 0.01, `speed ${r.speed}`);
    assert.ok(r.same, 'the transwarp journey changed on save/load');
    await shotSection('BORG-transwarp-journey-debug.png', '[data-borg-section]');
  });

  await check('new-feature', 'R33/R34 TRANSWARP-TACTICAL-ARRIVAL the cube exits at Astron where the captain is: "Borg transwarp aperture detected."; one contact held for his scene (no strategic resolution or damage while it waits); the scene spawns the same cube and the same target (vids) (SHOT)', async () => {
    const r = await ev(() => {
      const t = testBM1;
      const A = window.__idx('Astron');
      window.__place(A); window.__reset();
      const o = window.__obj();
      const tgt = window.__find(o.target.hullId);
      let enc = null;
      for (let i = 0; i < 6 && !enc; i++) { window.__adv(1); enc = window.__encs().find((e) => e.status === 'pending'); }
      if (!enc) return { fail: 'no contact', o: window.__brief(window.__obj()) };
      const recs0 = JSON.stringify([tgt.h.hull, window.__cube().hull]);
      window.__adv(1);
      const recs1 = JSON.stringify([tgt.h.hull, window.__cube().hull]);
      const pendingAfter = t.Encounter.encounterById(t.campaign(), enc.id).status;
      window.__seconds(2);
      const e2 = t.Encounter.encounterById(t.campaign(), enc.id);
      const npcs = window.__npcs(enc.id).map((n) => ({ vid: n.vid, side: n.encounterSide, shipId: n.shipId }));
      // let them close so the shot shows them
      let k = 0; for (; k < 15 && window.__npcs(enc.id).filter((n) => t.distanceToPlayer(n) < 900).length < 2; k++) { t.state.hull = 100; window.__seconds(1); }
      return { said: window.__said(/Borg transwarp aperture detected\./), enc: { id: enc.id, system: enc.system, status: e2.status, participants: enc.participants.map((p) => [p.side, p.vid]) }, recsSame: recs0 === recs1, pendingAfter, npcs, cube: window.__vid(window.__cube()), target: o.target.vid, count: window.__encs().filter((e) => e.objective.ref === o.id).length, msgs: window.__msgs.slice(-6) };
    });
    evidence.push({ check: 'TRANSWARP-TACTICAL-ARRIVAL', ...r });
    assert.ok(!r.fail, `${r.fail}: ${JSON.stringify(r.o)}`);
    assert.ok(r.said, `no aperture message: ${JSON.stringify(r.msgs)}`);
    assert.equal(r.pendingAfter, 'pending'); assert.ok(r.recsSame, 'R34: strategic damage while the scene held the contact');
    assert.equal(r.count, 1, 'more than one encounter');
    assert.equal(r.enc.status, 'tactical_active');
    assert.ok(r.npcs.some((n) => n.side === 'borg' && n.vid === r.cube) && r.npcs.some((n) => n.side === 'target' && n.vid === r.target), JSON.stringify(r.npcs));
    await ev(() => window.__closeOn());
    await shot('BORG-transwarp-tactical-arrival.png');
  });

  await check('new-feature', 'R18 SHIP-DISABLED-ASSIMILATION the target is disabled in the scene: the contact resolves "subdued" with the scene\'s figures, the objective goes to assimilation ("Assimilation in progress."), and with the cube beside it the same hull becomes the Collective\'s: same vid, the scene\'s damage, its origin kept, the crew outcome recorded; no hull created (SHOT)', async () => {
    const r = await ev(() => {
      const t = testBM1;
      const enc = window.__encs().find((e) => e.status === 'tactical_active');
      const tn = window.__npcs(enc.id).find((n) => n.encounterSide === 'target');
      const line = Math.max(1, Math.floor(t.Fleet.disableThreshold(tn.maxCombatHull)));
      tn.combatHull = Math.max(1, line - 1); t.applyVesselDisablement?.(tn); tn.condition = 'disabled';
      for (let k = 0; k < 6 && t.Encounter.encounterById(t.campaign(), enc.id).status === 'tactical_active'; k++) { t.state.hull = 100; window.__seconds(1); }
      const o = window.__obj();
      const borg0 = window.__borg().map((h) => h.id);
      const f0 = window.__find(o.target.hullId);
      const afterScene = { phase: o.phase, hull: f0?.h.hull, max: f0?.h.maxHull, owner: f0?.pid };
      return { enc: t.Encounter.encounterById(t.campaign(), enc.id).status, result: t.Encounter.encounterById(t.campaign(), enc.id).result, afterScene, said: window.__said(/Assimilation in progress\./), borg0, o: window.__brief(o), msgs: window.__msgs.slice(-5) };
    });
    evidence.push({ check: 'SHIP-DISABLED-ASSIMILATION (scene)', ...r });
    assert.equal(r.enc, 'resolved'); assert.equal(r.result.outcome, 'subdued');
    assert.equal(r.afterScene.phase, 'assimilate', 'the scene\'s disablement did not feed the assimilation');
    assert.ok(r.said, `no "Assimilation in progress." — ${JSON.stringify(r.msgs)}`);
    await ev(() => window.__closeOn());
    await shot('BORG-ship-disabled-assimilation.png');
    const r2 = await ev((r) => {
      const t = testBM1;
      const o = window.__sum().objectives.find((x) => x.id === r.o.id);
      for (let i = 0; i < 12 && o.status === 'active'; i++) window.__adv(1);
      const o2 = window.__sum().objectives.find((x) => x.id === r.o.id);
      const f = window.__find(o2.target.hullId);
      return { result: o2.result, owner: f?.pid, vid: window.__vid(f?.h), hull: f?.h.hull, max: f?.h.maxHull, origin: f?.h.identity?.origin?.builder, history: (f?.h.identity?.history || []).slice(-2), crew: f?.h.assimilated?.crew, borgNow: window.__borg().map((h) => h.id), sameVid: Object.values(t.campaign().polities).flatMap((p) => p.hulls).filter((h) => window.__vid(h) === r.o.target).length, licences: Object.keys(t.campaign().polities.borg.licenses || {}), canBuild: t.Campaign.polityCanBuildDesign(t.campaign(), t.buildCampaignWorld(true), 'borg', f?.h.shipId) };
    }, r);
    evidence.push({ check: 'SHIP-DISABLED-ASSIMILATION (assimilated)', ...r2 });
    assert.equal(r2.result?.result, 'target_assimilated', JSON.stringify(r2.result));
    assert.equal(r2.owner, 'borg'); assert.equal(r2.vid, r.o.target);
    assert.ok(Math.abs(r2.hull - r.afterScene.hull) < 0.5 && r2.hull < r2.max, `hull ${r2.hull} vs the scene's ${r.afterScene.hull}`);
    assert.ok(r2.origin && r2.origin !== 'borg', 'origin rewritten'); assert.ok(r2.history.some((x) => x.event === 'assimilated'));
    assert.deepEqual(r2.borgNow.slice().sort(), [...r.borg0, r.o.target].sort(), 'the Borg books gained anything but the target'); assert.equal(r2.sameVid, 1, 'a duplicate of the vessel');
    assert.equal(r2.licences.length, 0); assert.equal(r2.canBuild, false);
    await shotSection('BORG-persistent-assimilated-hull-debug.png', '[data-borg-section]');
  });

  // ================================================================================================
  // BORG-WORLD-ASSIMILATION
  // ================================================================================================
  const worldScene = async (seed) => {
    await fresh(seed); await setup();
    return ev(() => {
      const t = testBM1;
      window.__quiet({ ships: false, worlds: true });
      const T = window.__idx('Tarellia');
      const b = t.campaign();
      const holder = t.buildCampaignWorld(true).systems[T].controller;
      // Its hulls are away (the defence is its installations), the cube stands there; the captain elsewhere.
      for (const h of b.polities[holder]?.hulls || []) if (Number(h.systemIndex) === T && !h.transit) { h.systemIndex = window.__idx('Vulcan'); h.status = 'assigned'; h.opId = 'held-by-gate'; }
      const cube = window.__cube(); cube.systemIndex = T;
      return { T, holder, origin: t.getSystemControl(T).origin };
    });
  };
  await check('new-feature', 'BORG-WORLD-ASSIMILATION / R20 the cube at Tarellia: the world is chosen from what the cube sees, its defence is suppressed, progress begins and persists across save and load (SHOT)', async () => {
    const s = await worldScene('borg-g5');
    const r = await ev((s) => {
      const t = testBM1;
      let o = null;
      for (let i = 0; i < 80; i++) { window.__adv(1); o = window.__obj(); if (o && o.progress?.state === 'assimilating' && o.progress.value >= 0.2) break; }
      const rec = () => JSON.stringify(window.__sum().progress[s.T]);
      const before = rec();
      t.saveGame(7); t.loadGame(7);
      return { o: window.__brief(window.__obj()), rec: window.__sum().progress[s.T], same: before === rec(), ctl: t.getSystemControl(s.T).controller };
    }, s);
    evidence.push({ check: 'WORLD-PROGRESS', s, ...r });
    assert.ok(r.o && r.o.targetKind === 'world', JSON.stringify(r.o));
    assert.ok(r.rec && r.rec.progress >= 0.2 && r.rec.state === 'assimilating', JSON.stringify(r.rec));
    assert.ok(r.same, 'R20: progress changed on save/load'); assert.equal(r.ctl, s.holder, 'an instant flip');
    await shotSection('BORG-world-assimilation-progress-debug.png', '[data-borg-section]');
  });
  await check('new-feature', 'R21 the cube recalled mid-assimilation: the objective closes, the cube leaves, the world\'s progress is interrupted and decays day by day; the world stays its holder\'s', async () => {
    const r = await ev(() => {
      const t = testBM1;
      const o = window.__sum().objectives.find((x) => x.status === 'active');
      const T = o.target.systemIndex;
      const p0 = window.__sum().progress[T].progress;
      o.cancelRequested = 'recalled by the gate';
      const trail = []; for (let i = 0; i < 8; i++) { window.__adv(1); const rec = window.__sum().progress[T]; trail.push(rec ? [rec.progress, rec.state] : [0, 'gone']); }
      return { p0, trail, result: o.result, ctl: t.getSystemControl(T).controller };
    });
    evidence.push({ check: 'WORLD-INTERRUPTED', ...r });
    assert.equal(r.result?.result, 'cancelled');
    assert.ok(r.trail.at(-1)[0] < r.p0 && r.trail.slice(2).every((x) => x[1] !== 'assimilating'), JSON.stringify(r.trail));
  });
  await check('new-feature', 'R22/R23/R24 the cube staying completes it: the controller changes to the Borg explicitly (origin kept, former holder on record), with no capture, occupation, integration, licence or war record; the world sells nothing to anyone (no former-owner market)', async () => {
    const s = await worldScene('borg-g6');
    const r = await ev((s) => {
      const t = testBM1;
      const b = t.campaign();
      const wars0 = JSON.stringify(Object.keys(b.warStates || {}).filter((k) => k.includes('borg')).sort());
      const dipl0 = JSON.stringify(Object.keys(t.diplomacyBook().pairs || {}).filter((k) => k.includes('borg')));
      let day = null;
      for (let i = 0; i < 220; i++) { window.__adv(1); if (t.getSystemControl(s.T).controller === 'borg') { day = t.state.day; break; } }
      const ctl = t.getSystemControl(s.T);
      const m = t.occupiedMarket(s.T);
      window.__place(s.T);
      const stock = (t.state.stations || []).filter((st) => !st.destroyed).flatMap((st) => t.getUnfilteredShipyardStock(st).map((x) => x.id));
      return { day, ctl: { controller: ctl.controller, origin: ctl.origin }, record: window.__sum().assimilatedWorlds[0], occupation: b.occupations?.[s.T] || null, integration: b.polities.borg?.integrations?.[s.T] || null, licences: Object.keys(b.polities.borg?.licenses || {}),
        wars: JSON.stringify(Object.keys(b.warStates || {}).filter((k) => k.includes('borg')).sort()) === wars0, dipl: JSON.stringify(Object.keys(t.diplomacyBook().pairs || {}).filter((k) => k.includes('borg'))) === dipl0, market: m && { assimilated: m.assimilated, line: t.occupiedMarketLine(m) }, stock: stock.length };
    }, s);
    evidence.push({ check: 'WORLD-COMPLETED', s, ...r });
    assert.ok(r.day, 'R22: never completed');
    assert.equal(r.ctl.controller, 'borg'); assert.equal(r.ctl.origin, s.origin);
    assert.equal(r.record.from, s.holder);
    assert.equal(r.occupation, null, 'R23: an occupation record'); assert.equal(r.integration, null); assert.equal(r.licences.length, 0);
    assert.ok(r.wars, 'R23: a war record'); assert.ok(r.dipl, 'a Borg diplomatic pair');
    assert.equal(r.market?.assimilated, true); assert.equal(r.stock, 0, 'R24: a market still sells there');
  });
  await check('preservation', 'R37/R38 NO-CAPTURE-NO-WAR two hundred days with the Collective at work: no world changes hands except by a recorded assimilation, no Borg war or diplomatic record appears', async () => {
    await fresh('borg-g8'); await setup();
    const r = await ev(() => {
      const t = testBM1; window.__quiet();
      const ctl = () => t.state.planets.map((p, i) => t.getSystemControl(i).controller);
      const c0 = ctl();
      const b = t.campaign();
      const wars0 = Object.keys(b.warStates || {}).filter((k) => k.includes('borg')).length;
      window.__adv(200);
      const c1 = ctl();
      const changed = c1.map((c, i) => [i, c0[i], c]).filter(([, a, x]) => a !== x);
      const assimilated = (window.__sum().assimilatedWorlds || []).map((w) => w.systemIndex);
      return { changed, assimilated, borgWars: Object.keys(b.warStates || {}).filter((k) => k.includes('borg')).length - wars0, borgPairs: Object.keys(t.diplomacyBook().pairs || {}).filter((k) => k.includes('borg')).length, stats: window.__sum().stats };
    });
    evidence.push({ check: 'NO-CAPTURE-NO-WAR', ...r });
    assert.ok(r.changed.every(([i, , x]) => x === 'borg' && r.assimilated.includes(i)) || !hasBorg && r.changed.length === 0 || r.changed.every(([i, , x]) => x !== 'borg'), `a world changed hands to the Borg without an assimilation: ${JSON.stringify(r.changed)}`);
    assert.equal(r.borgWars, 0); assert.equal(r.borgPairs, 0);
  });
  await check('new-feature', 'DEBUG-BORG the "Borg assimilation" debug section shows objectives (force, target, known facts, value/score, phase, progress, movement mode with both ETAs and why, journey, handoff, result), assimilated vessels, world progress and transwarp journeys', async () => {
    const r = await ev(() => { testBM1.openDebugMenu(); const el = document.querySelector('[data-borg-section]'); const txt = el ? el.textContent : null; document.getElementById('cheats-debug').close(); return { txt }; });
    evidence.push({ check: 'DEBUG-BORG', txt: r.txt?.slice(0, 1500) });
    for (const k of ['Borg force', 'Target', 'Value / score', 'Phase', 'Progress', 'Movement', 'Journey', 'Handoff', 'Result', 'Assimilated vessels', 'World assimilation progress', 'Transwarp journeys']) assert.ok(r.txt && r.txt.includes(k), `missing ${k}`);
  });

  fs.writeFileSync(path.join(out, 'borg-gate.json'), JSON.stringify({ hasBorg, results, evidence }, null, 1));
  const byCat = (c) => { const x = results.filter((y) => y.category === c); return `${x.filter((y) => y.ok).length}/${x.length}`; };
  console.log(`\nborg assimilation in-game: ${results.filter((x) => x.ok).length}/${results.length} (baseline-defect ${byCat('baseline-defect')}, new-feature ${byCat('new-feature')}, preservation ${byCat('preservation')})`);
  if (probe.errors.length) console.log('page errors:', probe.errors.slice(0, 5));
  await probe.close();
  process.exit(results.every((x) => x.ok) && !probe.errors.length ? 0 : 1);
})().catch((e) => { console.error(e); process.exit(1); });
