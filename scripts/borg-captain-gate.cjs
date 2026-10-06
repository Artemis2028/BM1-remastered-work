// In-game gate for CAPTAIN-BORG-ASSIMILATION (docs/doctrine/CAPTAIN-BORG-ASSIMILATION.md). The real engine, the
// default chart and the campaign's own Assimilation Cube at Vex; the captain parked at Astron beside Vex (Borg border
// cover) in a valuable advanced hull (an Inquiry Class), days advanced through the normal calendar.
// Integrated scenario CAPTAIN-BORG-ASSIMILATION: the Collective sees him, opens the objective, jumps by transwarp,
// intercepts him in his scene; branch A he escapes, branch B he destroys the cube, branch C the cube disables him,
// the assimilation runs to completion and the run ends as CAPTAIN ASSIMILATED (reload / main menu), with nothing
// converted. Plus: low value rejected, nothing known when he is out of cover, recovery blocked during contact and
// restored after it, save/load mid-assimilation, Borg withdrawal.
// Categories:
//   baseline-defect  1eceab3 never targets the captain (fails on its own assertion)
//   new-feature      needs this round's captain target
//   preservation     must hold on both
// Note on the scene fight: against the cube's own scene weapons a healthy Inquiry loses about 1% of its shields per
// shot (measured), so the disabling branches start the captain already badly hurt (shields down, hull just above the
// disable line) — the cube's own fire then disables him. Nothing in combat is changed for the gate.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { startProbe } = require('./probe-harness.cjs');

(async () => {
  const probe = await startProbe({ viewport: { width: 1400, height: 900 }, pageOptions: { deviceScaleFactor: 2 } });
  const { ev, fresh, page, errors } = probe;
  const out = process.env.BM1_TEST_OUTPUT || '/tmp';
  fs.mkdirSync(out, { recursive: true });
  const results = [];
  const evidence = [];
  async function check(category, name, fn) {
    try { await fn(); results.push({ category, name, ok: true }); console.log('PASS', `[${category}]`, name); }
    catch (err) { results.push({ category, name, ok: false, message: String(err?.message || err).split('\n').slice(0, 6).join(' ') }); console.log('FAIL', `[${category}]`, name, '\n      ', String(err?.message || err).split('\n').slice(0, 8).join(' ')); }
  }
  const shot = async (name) => { const draw = () => ev(() => { testBM1.render(); testBM1.updateSecurityOrderPanel?.(); testBM1.updateRecoveryPanel?.(); }); await draw(); await page.waitForTimeout(400); await draw(); return page.screenshot({ path: path.join(out, name) }); };
  async function shotSection(file, selector) {
    await ev(() => testBM1.closeGalaxyReports?.());
    await ev((sel) => { const d = document.getElementById('cheats-debug'); if (!d.open) testBM1.openDebugMenu(); for (const x of d.querySelectorAll('section')) if (!x.matches(sel)) x.style.display = 'none'; d.style.maxHeight = 'none'; d.style.height = 'auto'; d.style.width = '1360px'; d.style.maxWidth = 'none'; d.style.overflow = 'visible'; d.style.position = 'absolute'; d.style.top = '0'; }, selector);
    const h = await ev((sel) => Math.ceil(document.querySelector(sel).getBoundingClientRect().bottom + window.scrollY + 40), selector);
    await page.setViewportSize({ width: 1400, height: Math.min(7000, Math.max(900, h)) });
    // A clip, not an element screenshot: the terminal overlay keeps the page from settling for an element capture.
    const box = await ev((sel) => { const r = document.querySelector(sel).getBoundingClientRect(); return { x: Math.max(0, r.x), y: Math.max(0, r.y + window.scrollY), width: Math.max(1, r.width), height: Math.max(1, r.height) }; }, selector);
    await page.screenshot({ path: path.join(out, file), clip: box, fullPage: true });
    await page.setViewportSize({ width: 1400, height: 900 });
    await ev(() => { const d = document.getElementById('cheats-debug'); for (const x of d.querySelectorAll('section')) x.style.display = ''; d.removeAttribute('style'); d.close();
      testBM1.closeGalaxyReports?.(); const c = testBM1.playtestClock; if (c.stoppedAt !== null) { c.offset += performance.now() - c.stoppedAt; c.stoppedAt = null; } });
  }
  await page.waitForFunction(() => !testBM1.doctrineStatus || testBM1.doctrineStatus().state !== 'loading', null, { timeout: 30000 }).catch(() => {});
  const hasCaptain = await ev(() => typeof testBM1.DoctrineCampaign.captainAssimilationTick === 'function');

  const setup = () => page.evaluate(() => {
    const t = testBM1;
    window.__adv = (n) => { for (let i = 0; i < n; i++) t.advanceFleetCalendar(1, t.Fleet.nextId(t.fleetBook(), 'journey')); };
    window.__idx = (name) => t.getSystemIndexByName(name);
    window.__step = (n, fs = 2.5) => { for (let i = 0; i < n; i++) { t.playtestClock.offset -= fs * 16.6667; t.tick(fs); t.updateSecurityOrderPanel?.(); } };
    window.__seconds = (s) => window.__step(Math.ceil((s * 1000) / (2.5 * 16.6667)));
    window.__vid = (h) => h?.identity?.vid || h?.vid || h?.id;
    window.__sum = () => t.DoctrineCampaign.borgSummary ? t.DoctrineCampaign.borgSummary(t.campaign()) : { objectives: [], selections: {}, contacts: {}, stats: {}, captainAssimilations: [] };
    window.__capObj = () => window.__sum().objectives.filter((o) => o.targetKind === 'captain').slice(-1)[0] || null;
    window.__capEncs = () => (t.campaign().encounters || []).filter((e) => e.type === 'assimilation' && e.contact?.targetKind === 'captain');
    window.__capEnc = () => window.__capEncs().slice(-1)[0] || null;
    window.__npcs = (id) => t.state.npcShips.filter((n) => n.encounterId === id);
    window.__borg = () => t.campaign().polities.borg?.hulls || [];
    window.__cube = () => window.__borg().find((h) => Number(h.shipId) === 346) || null;
    window.__msgs = [];
    { const st = t.state; let cur = st.log; Object.defineProperty(st, 'log', { configurable: true, enumerable: true, get: () => cur, set: (v) => { cur = v; if (v) window.__msgs.push(String(v)); } }); }
    window.__said = (re) => window.__msgs.filter((m) => re.test(m)).length;
    window.__quiet = (borg = {}) => { const db = t.DoctrineCampaign.doctrineBook(t.campaign()); db.config = { ...db.config, patrols: {}, explorers: {}, merchants: {}, projects: {}, patrolAreas: {}, militaryResponses: false, enforcementResponses: false, predation: false, hunts: {}, borg: { ...(db.config.borg || { power: 'borg' }), worlds: false, ...borg } }; t.campaign().config.aiStrategicOps = false; };
    // The Collective's sensor cover cleared of other traffic, so the captain is the only vessel it can see.
    window.__clearCover = () => {
      const b = t.campaign(); const W = t.buildCampaignWorld(true);
      const cover = new Set(W.systems.filter((s) => s.controller === 'borg').flatMap((s) => [Number(s.index), ...W.neighbours(s.index).map(Number)]));
      for (const [pid, p] of Object.entries(b.polities)) if (pid !== 'borg' && pid !== 'player') for (const h of p.hulls) if (h.status !== 'lost' && !h.transit && cover.has(Number(h.systemIndex))) { h.systemIndex = window.__idx('Earth'); if (h.status === 'ready') { h.status = 'assigned'; h.opId = 'held-by-gate'; } }
      return [...cover];
    };
    window.__place = (sys) => { t.markSystemVisited(sys); t.state.currentPlanet = sys; t.state.myplanet = sys + 1; t.applySystemState(sys); t.placePlayerAtSecurityApproach?.(); };
    // The captain takes a new personal vessel the way a purchase gives him one (the old identity retired as
    // replaced, a new personal identity, the class's stats and weapons), without the vendor and price gates.
    window.__ship = (id) => { const b = t.fleetBook(); t.ensurePersonalIdentity(); b.personalRetireCause = 'replaced'; b.personalId = t.Fleet.nextId(b, 'personal'); b.personalCondition = 'operational';
      t.state.playership = id; t.state.hull = 100; t.applyCurrentShipStats(true); t.applyShipDefaultWeapons(id, true); t.ensurePersonalIdentity(); t.state.shipName = t.getShipStats(id).name; t.state.shields = 100; t.state.spawnProtectionUntil = 0; };
    window.__line = () => { const max = t.getNpcCombatDurability(t.state.playership).hull; return (100 * t.Fleet.disableThreshold(max)) / max; };
    // Badly hurt: shields down, hull 1.5% above the disable line (the cube's own fire does the rest).
    window.__hurt = () => { t.state.shields = 0; t.state.hull = window.__line() + 1.5; };
    window.__brief = (o) => o && { id: o.id, status: o.status, phase: o.phase, progress: o.progress, result: o.result, engagements: o.engagements, handoff: o.handoff, movement: o.movement && { mode: o.movement.mode, conventionalDays: o.movement.conventionalDays, transwarpDays: o.movement.transwarpDays, reason: o.movement.reason }, force: o.force };
    // The captain at Astron in `ship`; days pass until the cube is in his scene (or `maxDays`).
    window.__toContact = (ship = 289, maxDays = 14) => {
      window.__quiet(); window.__clearCover();
      const A = window.__idx('Astron');
      window.__place(A); window.__ship(ship);
      const d0 = t.state.day, hull0 = t.state.hull;
      let k = 0; for (; k < maxDays && !window.__capEnc(); k++) window.__adv(1);
      return { A, d0, days: t.state.day - d0, hullBeforeScene: hull0, hullAtContact: t.state.hull };
    };
    window.__toScene = () => { for (let k = 0; k < 40 && window.__capEnc()?.status !== 'tactical_active'; k++) window.__step(1); return window.__capEnc()?.status; };
    window.__runUntil = (pred, maxSec = 200, hurt = false) => { let s = 0; for (; s < maxSec && !pred(); s++) { if (hurt) t.state.shields = 0; window.__seconds(1); } return s; };
    window.__progress = () => Number(window.__capObj()?.progress?.value) || 0;
    window.__terminalSnapshot = () => {
      const b = t.campaign(); const W = t.buildCampaignWorld(true);
      return JSON.stringify({ flag: t.getPlayerFlag(), faction: t.state.playerFaction,
        worlds: W.systems.filter((s) => s.controller === t.PLAYER_SIDE || s.controller === 'player').map((s) => s.index),
        fleet: t.state.playerFleet.map((f) => [f.id, f.shipId, Boolean(f.destroyed)]), playerHulls: (b.polities.player?.hulls || []).map((h) => [h.id, h.status]),
        treaties: b.treatyTerms || [], standing: t.state.factionStanding || t.state.standing || null, war: b.war || null, licences: b.polities.borg?.licenses || {},
        borgCanBuild: t.Campaign.polityCanBuildDesign(b, W, 'borg', 289), borgWorlds: W.systems.filter((s) => s.controller === 'borg').map((s) => s.index) });
    };
  });

  const A_NAME = 'Astron';
  // ================================================================================================
  // Selection
  // ================================================================================================
  await check('preservation', 'CAP-OUT-OF-COVER the captain at Earth (no Borg sensor reaches it) for 20 days: nothing about him is known, no objective, the cube stays at Vex (no omniscient selection)', async () => {
    await fresh('cap-g0'); await setup();
    const r = await ev(() => {
      const t = testBM1; window.__quiet(); window.__clearCover();
      window.__place(window.__idx('Earth')); window.__ship(289);
      window.__adv(20);
      const s = window.__sum();
      return { contacts: Object.values(s.contacts.borg || {}).filter((c) => c.kind === 'captain').length, obj: window.__capObj(), cubeAt: window.__cube()?.systemIndex, cubeTransit: Boolean(window.__cube()?.transit) };
    });
    evidence.push({ check: 'CAP-OUT-OF-COVER', ...r });
    assert.equal(r.contacts, 0); assert.equal(r.obj, null); assert.equal(r.cubeAt, 33); assert.equal(r.cubeTransit, false);
  });

  await check('new-feature', 'CAP-LOW-VALUE the captain at Astron in his starting Saber (19,000 L, no technology worth acquiring) is seen and rejected — the verdict and reason are on the selection; no objective', async () => {
    await fresh('cap-g1'); await setup();
    const r = await ev(() => {
      window.__quiet(); window.__clearCover(); window.__place(window.__idx('Astron')); window.__ship(307);
      window.__adv(8);
      const sel = (window.__sum().selections.borg || []).slice(-1)[0] || null;
      return { sel: sel && { decision: sel.decision, captain: sel.candidates.find((c) => c.kind === 'captain') }, obj: window.__capObj() };
    });
    evidence.push({ check: 'CAP-LOW-VALUE', ...r });
    if (!hasCaptain) assert.fail('this tree never evaluates the captain');
    assert.equal(r.sel.captain.verdict, 'rejected'); assert.equal(r.sel.captain.reason, 'no technology worth acquiring'); assert.equal(r.obj, null);
  });

  // ================================================================================================
  // CAPTAIN-BORG-ASSIMILATION: selection → transwarp → contact → branch C (assimilated)
  // ================================================================================================
  let snapBefore = null;
  await check('baseline-defect', 'CAP-SELECTED the captain in an Inquiry Class at Astron, seen by the Collective, becomes the assimilation objective — target kind captain, his vid, the same value and score rules (1eceab3: no captain target at all) (SHOT)', async () => {
    await fresh('cap-g2'); await setup();
    const r = await ev(() => {
      const t = testBM1; window.__quiet(); window.__clearCover();
      window.__place(window.__idx('Astron')); window.__ship(289);
      const n0 = window.__borg().length;
      window.__adv(2);
      const sel = (window.__sum().selections.borg || []).slice(-1)[0] || null;
      return { vid: t.ensurePersonalIdentity().vid, sel: sel && { decision: sel.decision, chosen: sel.chosen, captain: sel.candidates.find((c) => c.kind === 'captain') }, o: window.__brief(window.__capObj()), target: window.__capObj()?.target, n0, n: window.__borg().length };
    });
    evidence.push({ check: 'CAP-SELECTED', ...r });
    assert.ok(r.o, `no captain objective: ${r.sel?.decision ?? 'no selection'}`);
    assert.equal(r.target.vid, r.vid); assert.equal(r.target.captain, true); assert.equal(r.sel.captain.verdict, 'eligible'); assert.equal(r.sel.chosen, r.vid);
    assert.equal(r.n, r.n0, 'a Borg hull was made');
    await shotSection('CAP-captain-selected-debug.png', '[data-borg-section]');
  });

  await check('new-feature', 'CAP-TRANSWARP-HANDOFF the cube (the campaign\'s own hull, same vid) jumps by transwarp by the accepted rules (conventional ~9 d vs 2 d), arrives where he stands, and one encounter opens in his scene: captain:true, the cube in it with its vid and disabling-fire intent; no strategic damage to him before the scene; one encounter only', async () => {
    const r = await ev(() => {
      const t = testBM1;
      const hull0 = t.state.hull;
      for (let k = 0; k < 10 && !window.__capEnc(); k++) window.__adv(1);
      const enc = window.__capEnc();
      const status = window.__toScene();
      const npcs = enc ? window.__npcs(enc.id) : [];
      return { o: window.__brief(window.__capObj()), cubeVid: window.__vid(window.__cube()), tw: window.__sum().transwarp.log?.slice(-1)[0] || null, hullBeforeScene: hull0, hullAtScene: t.state.hull,
        enc: enc && { id: enc.id, status, captain: enc.captain, playerHostile: enc.playerHostile, system: enc.system, participants: enc.participants.map((p) => [p.side, p.vid]) },
        npcs: npcs.map((n) => ({ vid: n.vid, shipId: n.shipId, hostile: n.hostile, intent: n.fireIntent })), encs: window.__capEncs().length, said: window.__said(/Borg vessel is attempting to disable your ship/), aperture: window.__said(/Borg transwarp aperture detected/) };
    });
    evidence.push({ check: 'CAP-TRANSWARP-HANDOFF', ...r });
    assert.equal(r.o.movement.mode, 'transwarp'); assert.equal(r.o.movement.transwarpDays, 2); assert.ok(r.o.movement.conventionalDays >= 5, String(r.o.movement.conventionalDays));
    assert.deepEqual(r.o.force.map((x) => x.vid), [r.cubeVid]);
    assert.equal(r.enc.captain, true); assert.equal(r.enc.status, 'tactical_active'); assert.deepEqual(r.enc.participants, [['borg', r.cubeVid]]);
    assert.equal(r.npcs.length, 1); assert.equal(r.npcs[0].vid, r.cubeVid); assert.equal(r.npcs[0].hostile, true); assert.equal(r.npcs[0].intent, 'disable');
    assert.equal(r.hullAtScene, r.hullBeforeScene, 'strategic damage before the scene');
    assert.equal(r.encs, 1); assert.ok(r.said >= 1); assert.ok(r.aperture >= 1);
  });

  await check('new-feature', 'CAP-SUBDUED-FIRST in the scene, the captain operational: no progress, the objective stays in disable, no recovery panel; badly hurt, the cube\'s own fire disables him and only then does the assimilation begin ("Assimilation in progress.")', async () => {
    const r = await ev(() => {
      const t = testBM1;
      window.__seconds(15);
      const early = { progress: window.__progress(), phase: window.__capObj()?.phase, panel: !document.getElementById('disabled-recovery').classList.contains('hidden') };
      window.__hurt();
      const s = window.__runUntil(() => t.fleetBook().personalCondition === 'disabled', 120, true);
      const at = { s, progress: window.__progress(), hull: t.state.hull, line: window.__line() };
      window.__seconds(3);
      return { early, at, after: { progress: window.__progress(), phase: window.__capObj()?.phase }, begun: window.__said(/^Assimilation in progress\.$/), gameOver: t.state.gameOver };
    });
    evidence.push({ check: 'CAP-SUBDUED-FIRST', ...r });
    assert.equal(r.early.progress, 0); assert.equal(r.early.phase, 'disable'); assert.equal(r.early.panel, false);
    assert.ok(r.at.s < 120, 'the cube never disabled him'); assert.equal(r.gameOver, false, 'destroyed instead of disabled');
    assert.ok(r.after.progress > 0); assert.equal(r.after.phase, 'assimilate'); assert.equal(r.begun, 1);
  });

  await check('new-feature', 'CAP-RECOVERY-BLOCKED during the active Borg contact the player-only emergency recovery is unavailable ("Emergency recovery unavailable during active Borg contact."); requesting it does nothing; the disabled panel shows the progress', async () => {
    const r = await ev(() => {
      const t = testBM1;
      const st = t.getRecoveryStatus();
      const ok = t.recoverDisabledPlayer();
      t.updateRecoveryPanel();
      const panel = document.getElementById('disabled-recovery');
      const btn = panel.querySelector('[data-recovery="request"]');
      btn?.click();
      window.__seconds(6);
      return { st, ok, cond: t.fleetBook().personalCondition, recoveryAt: t.state.recoveryAt, btnDisabled: btn?.disabled, line: panel.querySelector('[data-captain-assimilation]')?.textContent, text: panel.textContent.replace(/\s+/g, ' ').trim(), said: window.__said(/Emergency recovery unavailable during active Borg contact/) };
    });
    evidence.push({ check: 'CAP-RECOVERY-BLOCKED', ...r });
    assert.equal(r.st.available, false); assert.equal(r.st.reason, 'Emergency recovery unavailable during active Borg contact.');
    assert.equal(r.ok, false); assert.equal(r.cond, 'disabled'); assert.ok(!r.recoveryAt); assert.equal(r.btnDisabled, true);
    assert.match(r.line || '', /^Assimilation \d+%$/); assert.ok(r.said >= 1);
  });

  await check('new-feature', 'CAP-PROGRESS-SAVE-LOAD the progress advances while the cube stays (35%, 70% said in turn); saved and reloaded mid-assimilation: the same objective, encounter and cube vid, the same progress; the scene restarts from contact (the engine\'s accepted limit) and the progress goes on from where it was — no duplicate objective or encounter (SHOT)', async () => {
    const r = await ev(() => {
      const t = testBM1;
      window.__runUntil(() => window.__progress() >= 0.45, 120);
      const before = { p: window.__progress(), o: window.__capObj().id, enc: window.__capEnc().id, cube: window.__vid(window.__cube()), said35: window.__said(/^Assimilation 35%$/) };
      t.saveGame(7);
      t.loadGame(7);
      const after = { p: window.__progress(), o: window.__capObj().id, enc: window.__capEnc().id, status: window.__capEnc().status, objs: window.__sum().objectives.filter((o) => o.targetKind === 'captain').length, encs: window.__capEncs().length, cond: t.fleetBook().personalCondition };
      window.__toScene();
      const scene = { status: window.__capEnc().status, npcs: window.__npcs(window.__capEnc().id).map((n) => n.vid) };
      window.__seconds(6);
      return { before, after, scene, cont: window.__progress(), objs2: window.__sum().objectives.filter((o) => o.targetKind === 'captain').length, encs2: window.__capEncs().length };
    });
    evidence.push({ check: 'CAP-PROGRESS-SAVE-LOAD', ...r });
    assert.ok(r.before.p >= 0.45); assert.equal(r.before.said35, 1);
    assert.equal(r.after.p, r.before.p); assert.equal(r.after.o, r.before.o); assert.equal(r.after.enc, r.before.enc); assert.equal(r.after.cond, 'disabled');
    assert.equal(r.after.objs, 1); assert.equal(r.after.encs, 1);
    assert.equal(r.scene.status, 'tactical_active'); assert.deepEqual(r.scene.npcs, [r.before.cube]);
    assert.ok(r.cont > r.before.p, `progress did not continue (${r.cont})`); assert.equal(r.objs2, 1); assert.equal(r.encs2, 1);
    await shot('CAP-assimilation-progress.png');
  });

  await check('new-feature', 'CAP-ASSIMILATED (branch C) the countdown completes: "Assimilation 70%", "Assimilation imminent.", then CAPTAIN ASSIMILATED exactly once — the terminal state, its record (his vid, class, the cube, the system, the day), the objective completed; the terminal menu offers reload / main menu only (no escape pod, no restart in place) (SHOT)', async () => {
    snapBefore = await ev(() => window.__terminalSnapshot());
    const r = await ev(() => {
      const t = testBM1;
      const s = window.__runUntil(() => t.state.gameOver, 120);
      const again = t.enterCaptainAssimilated ? t.enterCaptainAssimilated({ id: 'x', captainVid: 'x', force: [] }) : null;
      const menu = document.getElementById('gameover-menu');
      return { s, gameOver: t.state.gameOver, cause: t.state.gameOverCause, failure: t.state.captainFailure, again, o: window.__brief(window.__capObj()), records: window.__sum().captainAssimilations,
        said: { s70: window.__said(/^Assimilation 70%$/), imm: window.__said(/^Assimilation imminent\.$/), done: window.__said(/^CAPTAIN ASSIMILATED$/) },
        menu: { visible: !menu.classList.contains('hidden'), cause: menu.dataset.cause, title: document.getElementById('gameover-title').textContent, desc: document.getElementById('gameover-desc').textContent, buttons: [...menu.querySelectorAll('button')].map((b) => ({ id: b.id, hidden: b.hidden, disabled: b.disabled, text: b.textContent })) },
        vid: t.ensurePersonalIdentity().vid, cube: window.__vid(window.__cube()) };
    });
    evidence.push({ check: 'CAP-ASSIMILATED', ...r });
    assert.equal(r.gameOver, true); assert.equal(r.cause, 'assimilated'); assert.equal(r.again, false, 'entered twice');
    assert.equal(r.failure.result, 'captain_assimilated'); assert.equal(r.failure.captainVid, r.vid); assert.equal(r.failure.shipId, 289); assert.deepEqual(r.failure.force, [r.cube]);
    assert.equal(r.records.length, 1); assert.equal(r.o.status, 'completed'); assert.equal(r.o.result.result, 'target_assimilated');
    assert.equal(r.said.s70, 1); assert.equal(r.said.imm, 1); assert.equal(r.said.done, 1);
    assert.equal(r.menu.visible, true); assert.equal(r.menu.title, 'CAPTAIN ASSIMILATED');
    const btn = (id) => r.menu.buttons.find((b) => b.id === id);
    assert.equal(btn('btn-escape-pod').hidden, true); assert.equal(btn('btn-restart-game').hidden, true);
    assert.equal(btn('btn-gameover-reload').hidden, false); assert.equal(btn('btn-gameover-reload').disabled, false); assert.equal(btn('btn-gameover-menu').hidden, false);
    await shot('CAP-terminal-captain-assimilated.png');
    // The debug menu does not open once the run is over (the engine's rule), so the Borg debug section is rendered
    // into a detached panel for the record: the captain row must carry the failure state.
    const dbg = await ev(() => { const d = document.createElement('section'); d.id = 'cap-terminal-debug'; d.className = 'debug-panel'; d.style.cssText = 'position:absolute;left:0;top:0;width:1360px;background:#10131c;color:#e6e6e6;padding:12px;z-index:99999';
      d.innerHTML = `<h3>Borg assimilation</h3>${testBM1.renderBorgDebug()}`; document.body.appendChild(d);
      const f = d.querySelector('[data-captain-failure]'); return { failure: f?.dataset.captainFailure || null, text: d.querySelector('[data-captain-target]')?.textContent.replace(/\s+/g, ' ').trim().slice(0, 400) || null }; });
    evidence.push({ check: 'CAP-ASSIMILATED (debug row)', ...dbg });
    assert.equal(dbg.failure, 'captain_assimilated', `debug captain row: ${dbg.text}`);
    const h = await ev(() => Math.ceil(document.getElementById('cap-terminal-debug').getBoundingClientRect().height + 20));
    await page.setViewportSize({ width: 1400, height: Math.min(7000, Math.max(900, h)) });
    await page.locator('#cap-terminal-debug').screenshot({ path: path.join(out, 'CAP-terminal-debug-captain-row.png') });
    await page.setViewportSize({ width: 1400, height: 900 });
    await ev(() => document.getElementById('cap-terminal-debug')?.remove());
  });

  await check('new-feature', 'CAP-NO-CONVERSION nothing converts and nothing continues: the player\'s flag, faction, worlds, fleet, treaties, standings and licences are unchanged; the Borg gain no production right and no world; the run is over — scene time does not move him, no day passes, saving is refused, the escape pod and departures do nothing, and there is no Borg command UI', async () => {
    const r = await ev((before) => {
      const t = testBM1;
      const after = window.__terminalSnapshot();
      const pos = JSON.stringify([t.state.ship.x, t.state.ship.y]), day = t.state.day, n = window.__npcs(window.__capEnc().id).length;
      window.__seconds(5);
      const slots = [1, 2, 3, 4, 5, 6, 7, 8].map((k) => t.getSaveSlotRaw(k) || null);
      const saved = t.saveGame(t.state.currentSaveSlot || 1);
      t.restartInEscapePod();
      const jumped = t.jumpPlanet ? (t.jumpPlanet(), t.state.warp.active) : false;
      return { same: after === before, before: JSON.parse(before), after: JSON.parse(after), moved: JSON.stringify([t.state.ship.x, t.state.ship.y]) !== pos, day0: day, day: t.state.day, saved, slot8: [1, 2, 3, 4, 5, 6, 7, 8].some((k, i) => (t.getSaveSlotRaw(k) || null) !== slots[i]), gameOver: t.state.gameOver, cause: t.state.gameOverCause, jumped,
        borgUi: [...document.querySelectorAll('button, h2, h3')].filter((x) => !x.closest('#cheats-debug')).some((x) => /borg command|command borg|command the collective|join the collective/i.test(x.textContent)), faction: t.state.playerFaction };
    }, snapBefore);
    evidence.push({ check: 'CAP-NO-CONVERSION', ...r });
    assert.ok(r.same, `converted: ${JSON.stringify({ before: r.before, after: r.after }).slice(0, 600)}`);
    assert.equal(r.after.borgCanBuild, false, 'Borg production right'); assert.equal(r.moved, false, 'the scene moved him'); assert.equal(r.day, r.day0, 'a day passed');
    assert.equal(r.saved, false, 'saved'); assert.equal(r.slot8, false, 'slot written'); assert.equal(r.gameOver, true, 'run resumed'); assert.equal(r.cause, 'assimilated', 'cause changed'); assert.equal(r.jumped, false, 'departed');
    assert.equal(r.borgUi, false, 'Borg command UI'); assert.notEqual(r.faction, 'borg');
  });

  await check('new-feature', 'CAP-RELOAD-MENU the terminal choices work and are the player\'s: "Reload last save" loads the slot he saved (the run before the end, the progress as saved, no terminal state) — never an automatic load; then from a second terminal state "Main menu" returns to the start menu; after the reload the countdown has to run again (no immediate game over)', async () => {
    const r = await ev(() => {
      const t = testBM1;
      const auto = { gameOver: t.state.gameOver };
      document.getElementById('btn-gameover-reload').click();
      const re = { gameOver: t.state.gameOver, cause: t.state.gameOverCause, p: window.__progress(), cond: t.fleetBook().personalCondition, started: t.state.gameStarted, menuHidden: document.getElementById('gameover-menu').classList.contains('hidden') };
      window.__toScene();
      const t0 = t.gameNow();
      const s = window.__runUntil(() => t.state.gameOver, 120);
      const secondsToEnd = Math.round((t.gameNow() - t0) / 1000);
      document.getElementById('btn-gameover-menu').click();
      return { auto, re, secondsToEnd, s, terminalAgain: t.state.gameOverCause, started: t.state.gameStarted, start: !document.getElementById('start-menu').classList.contains('hidden'), menuHidden: document.getElementById('gameover-menu').classList.contains('hidden') };
    });
    evidence.push({ check: 'CAP-RELOAD-MENU', ...r });
    assert.equal(r.auto.gameOver, true, 'it auto-loaded');
    assert.equal(r.re.gameOver, false, 'still over after reload'); assert.equal(r.re.cause, null, 'cause kept'); assert.equal(r.re.started, true, 'not started'); assert.equal(r.re.menuHidden, true, 'terminal menu still shown'); assert.ok(r.re.p >= 0.45 && r.re.p < 1, String(r.re.p));
    assert.ok(r.secondsToEnd >= 10, `game over ${r.secondsToEnd} s after the reload`);
    assert.equal(r.started, false, 'main menu: run still started'); assert.equal(r.start, true, 'start menu hidden'); assert.equal(r.menuHidden, true, 'terminal menu shown over the main menu');
  });

  // ================================================================================================
  // Branch A: escape; branch B: the cube destroyed (recovery restored); Borg withdrawal
  // ================================================================================================
  await check('new-feature', 'CAP-ESCAPE (branch A) intercepted but not yet disabled, the captain warps out of Astron: the contact closes as escaped, the objective target_escaped with a cooldown on him; no progress was ever made; no strategic damage follows him (SHOT)', async () => {
    await fresh('cap-g3'); await setup();
    const r = await ev(() => {
      const t = testBM1;
      const c = window.__toContact(289);
      window.__toScene(); window.__seconds(8);
      const hull = t.state.hull;
      const to = window.__idx('Lexa') ?? null;
      const W = t.buildCampaignWorld(true);
      const dest = W.neighbours(c.A).map(Number).find((i) => i !== 33) ?? W.neighbours(c.A)[0];
      t.state.antimatter = Math.max(t.state.antimatter, 999);
      const plan = t.getPlottedRoute(t.state.currentPlanet, dest);
      const began = t.beginWarpTravel(dest, plan);
      const enc = window.__capEnc();
      const o = window.__capObj();
      t.openWarpBriefing?.(); t.closeGalaxyReports?.(); t.completeWarpTravel();
      window.__adv(3);
      return { c, began, enc: enc && { status: enc.status, result: enc.result }, o: window.__brief(o), cd: window.__sum().cooldowns[`borg|${t.ensurePersonalIdentity().vid}`] ?? null, day: t.state.day, hull, hullAfter: t.state.hull, at: t.state.currentPlanet, dest };
    });
    evidence.push({ check: 'CAP-ESCAPE', ...r });
    assert.ok(r.began !== false); assert.equal(r.enc.status, 'resolved'); assert.equal(r.enc.result.outcome, 'escaped');
    assert.equal(r.o.result.result, 'target_escaped'); assert.equal(r.o.progress.value, 0); assert.ok(r.cd > r.day - 3, `cooldown ${r.cd}`);
    assert.equal(r.hullAfter, r.hull, 'strategic damage followed him'); assert.equal(r.at, r.dest);
    await shotSection('CAP-escape-branch-debug.png', '[data-borg-section]');
  });

  await check('new-feature', 'CAP-BORG-DEFEATED (branch B) disabled with the assimilation under way, the cube is destroyed in the scene: the contact ends (Borg out of the fight), the objective closes borg_destroyed, the progress stops; with contact broken and the captain still disabled, the emergency recovery is available again and works (SHOT)', async () => {
    await fresh('cap-g4'); await setup();
    const r = await ev(() => {
      const t = testBM1;
      window.__toContact(289); window.__toScene(); window.__hurt();
      window.__runUntil(() => t.fleetBook().personalCondition === 'disabled', 120, true);
      window.__runUntil(() => window.__progress() >= 0.2, 60);
      const p0 = window.__progress();
      const blocked = t.getRecoveryStatus();
      const cube = window.__npcs(window.__capEnc().id)[0];
      t.destroyNpcShip(cube);
      window.__seconds(2);
      const enc = window.__capEnc(), o = window.__capObj();
      return { p0, blocked: blocked.available, enc: { status: enc.status, result: enc.result }, o: window.__brief(o), rec: t.getRecoveryStatus(), cubeRec: window.__cube()?.status ?? 'gone' };
    });
    // The scene right after: the cube gone, contact broken, the disabled panel offering recovery again.
    await shot('CAP-borg-defeated-branch.png');
    Object.assign(r, await ev(() => { const t = testBM1; const started = t.recoverDisabledPlayer(); window.__seconds(6); return { started, cond: t.fleetBook().personalCondition, gameOver: t.state.gameOver }; }));
    evidence.push({ check: 'CAP-BORG-DEFEATED', ...r });
    assert.ok(r.p0 >= 0.2); assert.equal(r.blocked, false);
    assert.equal(r.enc.status, 'resolved'); assert.equal(r.enc.result.outcome, 'borg_beaten');
    assert.equal(r.o.result.result, 'borg_destroyed'); assert.equal(r.o.progress.state, 'interrupted'); assert.ok(r.o.progress.value <= r.p0 + 0.05);
    assert.equal(r.rec.available, true, r.rec.reason); assert.equal(r.started, true); assert.equal(r.cond, 'operational'); assert.equal(r.gameOver, false);
    assert.ok(['lost', 'gone'].includes(r.cubeRec), `cube record ${r.cubeRec}`);
    await shotSection('CAP-borg-defeated-debug.png', '[data-borg-section]');
  });

  await check('new-feature', 'CAP-BORG-WITHDRAWAL disabled mid-assimilation, the cube leaves the fight (withdraws from the scene): the contact ends, the objective closes (the Borg withdrew), the progress stops where it was and no assimilation happens', async () => {
    await fresh('cap-g5'); await setup();
    const r = await ev(() => {
      const t = testBM1;
      window.__toContact(289); window.__toScene(); window.__hurt();
      window.__runUntil(() => t.fleetBook().personalCondition === 'disabled', 120, true);
      window.__runUntil(() => window.__progress() >= 0.15, 60);
      const p0 = window.__progress();
      const cube = window.__npcs(window.__capEnc().id)[0];
      cube.encounterGone = true;
      window.__seconds(3);
      const p1 = window.__progress();
      window.__seconds(10);
      return { p0, p1, p2: window.__progress(), enc: { status: window.__capEnc().status, result: window.__capEnc().result }, o: window.__brief(window.__capObj()), gameOver: t.state.gameOver, records: window.__sum().captainAssimilations.length };
    });
    evidence.push({ check: 'CAP-BORG-WITHDRAWAL', ...r });
    assert.equal(r.enc.status, 'resolved'); assert.equal(r.enc.result.outcome, 'borg_withdrew');
    assert.equal(r.o.status, 'aborted'); assert.equal(r.o.result.result, 'abandoned'); assert.equal(r.o.progress.state, 'interrupted');
    assert.ok(r.p2 <= r.p1 + 1e-9 && r.p1 <= r.p0 + 0.06, JSON.stringify([r.p0, r.p1, r.p2])); assert.equal(r.gameOver, false); assert.equal(r.records, 0);
  });

  const ok = results.filter((r) => r.ok).length;
  const by = (c) => `${results.filter((r) => r.category === c && r.ok).length}/${results.filter((r) => r.category === c).length}`;
  const line = `captain borg assimilation in-game: ${ok}/${results.length} (baseline-defect ${by('baseline-defect')}, new-feature ${by('new-feature')}, preservation ${by('preservation')})`;
  console.log(line);
  fs.writeFileSync(path.join(out, 'borg-captain-gate.json'), JSON.stringify({ line, results, evidence, pageErrors: errors }, null, 1));
  await probe.close();
  process.exit(ok === results.length ? 0 : 1);
})();
