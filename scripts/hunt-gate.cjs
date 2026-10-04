// In-game gate for HIROGEN-HUNTING-DOCTRINE (docs/doctrine/HIROGEN-HUNTING-DOCTRINE.md). The real engine, the
// default chart and the campaign's own Hirogen hulls at the Hirogen Range. The captain, in a credible warship,
// stands at the Suliban Helix (beside the Range: its border sensors cover it): the Hirogen evaluate what they
// see, choose him, fly the shared journey to him and intercept him there — one encounter, fought in the scene
// with their own ships — and each way the scene can end (he destroys them, is disabled, strikes, breaks away)
// is written to the same hunt. Also: the crossing check his warp runs at each system, lost contact and the
// bounded search, the cooldown after an escape, and the debug section.
// Categories:
//   baseline-defect  c0a5890's generic Hirogen do not hunt (fails on its own assertion)
//   new-feature      needs this round's hunt
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
  const hasHunt = await ev(() => typeof testBM1.DoctrineCampaign.huntSummary === 'function');

  const setup = () => page.evaluate(() => {
    const t = testBM1;
    window.__adv = (n) => { for (let i = 0; i < n; i++) t.advanceFleetCalendar(1, t.Fleet.nextId(t.fleetBook(), 'journey')); };
    window.__idx = (name) => t.getSystemIndexByName(name);
    window.__step = (n, fs = 2.5) => { for (let i = 0; i < n; i++) { t.playtestClock.offset -= fs * 16.6667; t.tick(fs); t.updateSecurityOrderPanel?.(); } };
    window.__seconds = (s) => window.__step(Math.ceil((s * 1000) / (2.5 * 16.6667)));
    window.__B = () => t.campaign();
    window.__vid = (h) => h?.identity?.vid || h?.vid || h?.id;
    window.__encs = (type = 'hunt') => (t.campaign().encounters || []).filter((e) => e.type === type);
    window.__npcs = (id) => t.state.npcShips.filter((n) => n.encounterId === id);
    window.__sum = () => t.DoctrineCampaign.huntSummary ? t.DoctrineCampaign.huntSummary(t.campaign()) : { hunts: [], selections: {}, history: {}, cooldowns: {}, stats: {}, contacts: {} };
    window.__hunt = () => window.__sum().hunts.filter((o) => o.prey.kind === 'captain').slice(-1)[0] || null;
    window.__hir = () => t.campaign().polities.hirogen.hulls;
    window.__place = (sys) => { t.markSystemVisited(sys); t.state.currentPlanet = sys; t.state.myplanet = sys + 1; t.applySystemState(sys); t.placePlayerAtSecurityApproach?.(); };
    window.__reset = () => { t.state.hull = 100; t.state.shields = 100; t.state.spawnProtectionUntil = 0; t.state.godMode = false; t.fleetBook().personalCondition = 'operational'; };
    window.__hold = (sec) => { for (let i = 0; i < sec; i++) { t.state.hull = Math.max(t.state.hull, 60); t.state.shields = 100; window.__seconds(1); } };
    // Every message the log line showed (setLog writes state.log): a recording setter on the live state.
    window.__msgs = [];
    { const st = t.state; let cur = st.log; Object.defineProperty(st, 'log', { configurable: true, enumerable: true, get: () => cur, set: (v) => { cur = v; if (v) window.__msgs.push(String(v)); } }); }
    window.__said = (re) => window.__msgs.some((m) => re.test(m));
    // Nothing else moving: no routine patrols, traffic, campaign operations; the Hirogen hunt is the only live job.
    window.__quiet = () => { const db = t.DoctrineCampaign.doctrineBook(t.campaign()); db.config = { ...db.config, patrols: {}, explorers: {}, merchants: {}, projects: {}, patrolAreas: {}, militaryResponses: false, enforcementResponses: false }; t.campaign().config.aiStrategicOps = false; };
    // The captain in a Sovereign (a credible warship: comparable to a Hirogen Warship) at the Suliban Helix.
    window.__scene = () => {
      const S = window.__idx('Suliban Helix'), R = window.__idx('Hirogen Range');
      window.__quiet(); t.state.playership = 38; window.__place(S); window.__reset();
      return { S, R };
    };
    // Days pass (the captain standing where he is) until the hunt on him has an encounter, or `max` days.
    window.__untilContact = (max = 60) => { for (let i = 0; i < max; i++) { const e = window.__encs().find((x) => x.captain && ['pending', 'tactical_active'].includes(x.status)); if (e) return e; window.__adv(1); } return null; };
    window.__brief = (o) => o && { id: o.id, phase: o.phase, status: o.status, result: o.result, lastKnown: o.lastKnown, lostSince: o.lostSince, engagements: o.engagements, hunters: o.hunters.map((x) => x.vid), prey: o.prey.vid, why: o.why };
  });

  // ================================================================================================
  // HIROGEN-HUNT-SELECTION (in game)
  // ================================================================================================
  await check('baseline-defect', 'HUNT-SELECTION the captain in a Sovereign beside the Hirogen Range is assessed from what the Hirogen see (border sensors), scored worthy and chosen; the trivial Suliban ship is rejected; the selection records every verdict and why (c0a5890: the Hirogen have no hunt — they sit at home or raid generically) (SHOT)', async () => {
    await fresh('hunt-g1'); await setup();
    const r = await ev(() => {
      const t = testBM1; const s = window.__scene();
      const hir0 = window.__hir().map((h) => ({ id: h.id, vid: window.__vid(h), shipId: h.shipId }));
      window.__adv(3);
      const sum = window.__sum();
      const sel = (sum.selections.hirogen || []).slice(-1)[0] || null;
      return { s, hir0, sel, hunt: window.__brief(window.__hunt()), me: t.ensurePersonalIdentity().vid, hirAfter: window.__hir().length };
    });
    evidence.push({ check: 'HUNT-SELECTION', ...r });
    const o = r.hunt;
    assert.ok(o, `no hunt on the captain: ${JSON.stringify(r.sel?.decision ?? 'no selection')}`);
    assert.equal(o.prey, r.me);
    assert.ok(o.hunters.every((v) => r.hir0.some((h) => h.vid === v)), 'a hunter that is not one of the campaign\'s Hirogen hulls');
    assert.equal(r.hirAfter, r.hir0.length, 'a Hirogen hull was made');
    const mine = r.sel.candidates.find((c) => c.vid === r.me);
    assert.equal(mine.verdict, 'eligible'); assert.match(mine.reason, /worthy|dangerous|lesser/);
    assert.ok(r.sel.candidates.some((c) => c.reason === 'trivial prey'), 'no trivial candidate rejected');
    await shotSection('HUNT-selection-debug.png', '[data-hunt-section]');
  });

  // ================================================================================================
  // HIROGEN-TACTICAL-HUNT: pursuit, interception where he stands, the scene, each way it ends
  // ================================================================================================
  // One interception scene: hunt opened, hunters fly the shared journey, contact at the Suliban Helix.
  const interception = async (seed, { shots = false } = {}) => {
    await fresh(seed); await setup();
    const a = await ev(() => {
      const t = testBM1; const s = window.__scene();
      window.__adv(3);
      const o = window.__hunt();
      if (!o) return { s, fail: 'no hunt' };
      window.__adv(1);
      const tr = (t.campaign().journeys || []).find((j) => j.kind === 'hunt' && j.ref === o.id && j.status === 'underway');
      return { s, hunt: window.__brief(o), journey: tr && { path: tr.path, legDays: tr.legDays, speed: tr.speed, members: tr.members, legArrivalDay: tr.legArrivalDay }, day: t.state.day,
        plan: tr ? t.Campaign.plotJourney(t.buildCampaignWorld(true), Number(tr.origin ?? tr.from), s.S, 'hirogen', null, t.Campaign.hullsSpeed(t.buildCampaignWorld(true), tr.members.map((id) => window.__hir().find((h) => h.id === id)))) : null };
    });
    if (shots && a.journey) await shotSection('HUNT-pursuit-underway-debug.png', '[data-hunt-section]');
    const b = await ev(() => {
      const t = testBM1;
      const hunterRecs0 = window.__hir().map((h) => ({ id: h.id, hull: h.hull }));
      const enc = window.__untilContact(80);
      if (!enc) return { fail: 'no contact', hunt: window.__brief(window.__hunt()) };
      // R28: while the contact waits for the scene, more days pass: nothing strategic touches it.
      const before = { status: enc.status, recs: window.__hir().map((h) => ({ id: h.id, hull: h.hull, status: h.status })), encs: window.__encs().length };
      return { day: t.state.day, enc: { id: enc.id, status: enc.status, system: enc.system, captain: enc.captain, participants: enc.participants.map((p) => ({ side: p.side, vid: p.vid, spawn: p.spawn, engineOwned: p.engineOwned })) }, before, hunterRecs0, hunt: window.__brief(window.__hunt()) };
    });
    return { a, b };
  };

  let scene = null;
  await check('new-feature', 'PURSUIT-UNDERWAY R11 the hunt flies the shared journey (kind hunt, the route and leg days the model plots at the hunters\' own speed) toward the Suliban Helix; the debug shows phase, last-known system, budget and ETA (SHOT)', async () => {
    scene = await interception('hunt-g2', { shots: true });
    evidence.push({ check: 'PURSUIT-UNDERWAY', ...scene.a });
    assert.ok(!scene.a.fail, scene.a.fail);
    assert.ok(scene.a.journey, 'no hunt journey under way');
    assert.deepEqual(scene.a.journey.path, scene.a.plan.path); assert.deepEqual(scene.a.journey.legDays, scene.a.plan.legDays);
    assert.ok(['stalking', 'intercepting', 'pursuing'].includes(scene.a.hunt.phase), scene.a.hunt.phase);
  });

  await check('new-feature', 'R27/R28 TACTICAL-INTERCEPTION the hunters reach the Suliban Helix where the captain stands: one encounter (captain, pending for the scene), no strategic resolution — further days leave it and every hunter record untouched; the scene spawns the hunt\'s own Hirogen hulls (same vids) and logs "Hirogen Hunt — Engaged" (SHOT)', async () => {
    assert.ok(scene && !scene.b.fail, JSON.stringify(scene?.b));
    evidence.push({ check: 'TACTICAL-INTERCEPTION (contact)', ...scene.b });
    assert.equal(scene.b.enc.system, scene.a.s.S); assert.equal(scene.b.enc.captain, true); assert.equal(scene.b.enc.status, 'pending');
    const r = await ev(() => {
      const t = testBM1;
      const enc = window.__encs().find((x) => x.captain && x.status === 'pending');
      // R28: days advanced while the contact is open (the gate's calendar; nothing in the scene yet).
      const recs0 = JSON.stringify(window.__hir().map((h) => [h.id, h.hull, h.status, h.systemIndex]));
      window.__adv(2);
      const recs1 = JSON.stringify(window.__hir().map((h) => [h.id, h.hull, h.status, h.systemIndex]));
      const stillOne = window.__encs().filter((x) => x.objective.ref === enc.objective.ref && x.status !== 'aborted').length;
      const statusAfterDays = t.Encounter.encounterById(t.campaign(), enc.id).status;
      // The scene: the encounter is taken up.
      window.__seconds(2);
      const e2 = t.Encounter.encounterById(t.campaign(), enc.id);
      const npcs = window.__npcs(enc.id);
      const hunterVids = enc.participants.filter((p) => p.side === 'hunter').map((p) => p.vid);
      const log = window.__msgs.slice(-8).join(' | ');
      return { recsSame: recs0 === recs1, stillOne, statusAfterDays, status: e2.status, result: e2.result || null, npcs: npcs.map((n) => ({ vid: n.vid, shipId: n.shipId, faction: n.faction, hostile: n.hostile, side: n.encounterSide })), hunterVids, log, hunt: window.__brief(window.__hunt()), panel: document.getElementById('security-order-panel')?.textContent?.replace(/\s+/g, ' ').trim() || '' };
    });
    evidence.push({ check: 'TACTICAL-INTERCEPTION (scene)', ...r });
    assert.ok(r.recsSame, 'the strategic layer moved or damaged the hunters while the contact was open');
    assert.equal(r.stillOne, 1, 'more than one engagement for one contact');
    assert.equal(r.statusAfterDays, 'pending');
    assert.equal(r.status, 'tactical_active', JSON.stringify(r.result));
    assert.ok(r.npcs.length >= 1 && r.npcs.every((n) => r.hunterVids.includes(n.vid) && n.hostile), JSON.stringify(r.npcs));
    assert.ok(r.hunt.phase === 'engaged', r.hunt.phase);
    assert.match(r.panel, /Hirogen Hunt — Engaged/);
    assert.match(r.log, /Hirogen Hunt — Engaged/, 'no "Hirogen Hunt — Engaged" in the log');
    const closing = await ev(() => { const enc = window.__encs().find((x) => x.status === 'tactical_active'); let k = 0; for (; k < 20 && window.__npcs(enc.id).filter((n) => testBM1.distanceToPlayer(n) < 600).length < 1; k++) window.__hold(1); return k; });
    evidence.push({ closing });
    await shot('HUNT-tactical-interception.png');
  });

  await check('new-feature', 'R19-like PREY-WINS the captain destroys the hunters in the scene: the hunt resolves "hunter_lost" on the same record; the hunters\' records are lost', async () => {
    const r = await ev(() => {
      const t = testBM1;
      const enc = window.__encs().find((x) => x.status === 'tactical_active');
      for (const n of window.__npcs(enc.id)) t.destroyNpcShip(n);
      for (let k = 0; k < 10 && t.Encounter.encounterById(t.campaign(), enc.id).status === 'tactical_active'; k++) window.__hold(1);
      const o = window.__hunt();
      return { enc: t.Encounter.encounterById(t.campaign(), enc.id).status, result: o.result, status: o.status, recs: o.hunters.map((x) => window.__hir().find((h) => h.id === x.hullId)?.status) };
    });
    evidence.push({ check: 'PREY-WINS', ...r });
    assert.equal(r.enc, 'resolved');
    assert.equal(r.result.result, 'hunter_lost'); assert.equal(r.status, 'aborted');
    assert.ok(r.recs.every((s) => s === 'lost'), JSON.stringify(r.recs));
  });

  await check('new-feature', 'R20/PREY-DISABLED the captain\'s ship is disabled in the scene: the hunt resolves "target_disabled" — and nothing is taken (no capture, no prisoners, no trophy): his ship and every world stay as they were', async () => {
    const s = await interception('hunt-g3');
    assert.ok(!s.b.fail, JSON.stringify(s.b));
    const r = await ev(() => {
      const t = testBM1;
      const ctl0 = JSON.stringify(t.state.planets.map((p) => p.controller ?? p.owner ?? null));
      const enc = window.__encs().find((x) => x.status === 'pending' && x.captain);
      window.__seconds(2);
      t.fleetBook().personalCondition = 'disabled';
      for (let k = 0; k < 6 && t.Encounter.encounterById(t.campaign(), enc.id).status === 'tactical_active'; k++) window.__seconds(1);
      const o = window.__hunt();
      return { result: o.result, status: o.status, ship: t.state.playership, ctlSame: ctl0 === JSON.stringify(t.state.planets.map((p) => p.controller ?? p.owner ?? null)) };
    });
    await ev(() => window.__reset());
    evidence.push({ check: 'PREY-DISABLED', ...r });
    assert.equal(r.result?.result, 'target_disabled', JSON.stringify(r.result));
    assert.equal(r.ship, 38); assert.ok(r.ctlSame, 'a world changed hands');
  });

  await check('new-feature', 'R21/R30/PREY-SURRENDERS the captain strikes ("Surrender" on the hunt panel): the hunters stop firing at once, the hunt resolves "surrender_accepted" (recorded as an unsatisfying end), no further engagement opens and no pursuit is ordered after it', async () => {
    const s = await interception('hunt-g4');
    assert.ok(!s.b.fail, JSON.stringify(s.b));
    const r = await ev(() => {
      const t = testBM1;
      const enc = window.__encs().find((x) => x.status === 'pending' && x.captain);
      window.__seconds(2);
      const panel = document.getElementById('security-order-panel');
      const btn = panel?.querySelector('[data-hunt-response="surrender"]');
      if (btn) btn.click(); else t.respondToHunt('surrender');
      const hull0 = t.state.hull;
      window.__seconds(8);
      const o = window.__hunt();
      const day = t.state.day;
      const encsAt = window.__encs().length;
      window.__adv(20);
      const later = (t.campaign().journeys || []).filter((j) => j.kind === 'hunt' && j.ref === o.id && Number(j.departedDay ?? j.startDay ?? 0) > day).length;
      return { clicked: Boolean(btn), surrendered: t.playerSurrendered(), hullHeld: t.state.hull >= hull0, enc: t.Encounter.encounterById(t.campaign(), enc.id).status, result: o.result, status: o.status, encsLater: window.__encs().length - encsAt, later };
    });
    await ev(() => { const ld = testBM1.localDoctrine(); ld.surrender = null; window.__reset(); });
    evidence.push({ check: 'PREY-SURRENDERS', ...r });
    assert.ok(r.clicked, 'no surrender button on the hunt panel');
    assert.ok(r.hullHeld, 'fired on after striking');
    assert.equal(r.enc, 'resolved'); assert.equal(r.result.result, 'surrender_accepted'); assert.match(r.result.reason, /unsatisfying/);
    assert.equal(r.encsLater, 0, 'a new engagement after the closure'); assert.equal(r.later, 0, 'a pursuit order after the closure');
  });

  await check('new-feature', 'R29/R17 PREY-ESCAPES the captain breaks away (warps out of the scene): the hunt resolves "prey_escaped" on the same record, the log says "Hirogen hunters disengaged.", and back in sight he is not hunted again at once (cooldown) (SHOT)', async () => {
    const s = await interception('hunt-g5');
    assert.ok(!s.b.fail, JSON.stringify(s.b));
    const r = await ev(() => {
      const t = testBM1;
      const enc = window.__encs().find((x) => x.status === 'pending' && x.captain);
      window.__seconds(2);
      const S = enc.system;
      const away = t.buildCampaignWorld(true).neighbours(S).map(Number).find((i) => i !== window.__idx('Hirogen Range'));
      t.markSystemVisited(away);
      const plan = t.getPlottedRoute(S, away);
      t.state.antimatter = Math.max(t.state.antimatter, 999);
      const ok = t.beginWarpTravel(away, plan);
      const e2 = t.Encounter.encounterById(t.campaign(), enc.id);
      const o = window.__hunt();
      t.openWarpBriefing?.(); t.closeGalaxyReports?.(); t.completeWarpTravel();
      const log = window.__msgs.join(' | ');
      return { ok, enc: e2.status, encResult: e2.result, result: o.result, cooldown: window.__sum().cooldowns[`hirogen|${o.prey.vid}`] ?? null, prey: o.prey.vid, at: t.state.currentPlanet, S, day: t.state.day, saidDisengaged: /Hirogen hunters disengaged\./.test(log) };
    });
    evidence.push({ check: 'PREY-ESCAPES', ...r });
    assert.ok(r.ok, 'he could not warp out');
    assert.equal(r.enc, 'resolved'); assert.equal(r.encResult.outcome, 'escaped');
    assert.equal(r.result.result, 'prey_escaped');
    assert.ok(r.cooldown > r.day, `cooldown ${r.cooldown}`);
    assert.ok(r.saidDisengaged, 'no "Hirogen hunters disengaged." in the log');
    await shotSection('HUNT-escape-disengaged-debug.png', '[data-hunt-section]');
    // Back where they can see him: rejected "cooldown until day N".
    const c = await ev(() => { const t = testBM1; window.__place(window.__idx('Suliban Helix')); window.__reset(); window.__adv(8); const sel = (window.__sum().selections.hirogen || []).slice(-1)[0]; const me = sel?.candidates.find((x) => x.vid === t.ensurePersonalIdentity().vid); return { verdict: me && { verdict: me.verdict, reason: me.reason }, active: window.__sum().hunts.filter((o) => o.status === 'active' && o.prey.kind === 'captain').length }; });
    evidence.push({ check: 'PREY-ESCAPES (cooldown)', ...c });
    assert.match(c.verdict?.reason || '', /^cooldown until day/); assert.equal(c.active, 0);
  });

  await check('new-feature', 'R27 CROSSING his warp\'s crossing check at a system where hunters of a hunt on him stand: the engine\'s captainCrossingCheck returns a "hunt" stop with the encounter (captain, pending) — the course stops there and the scene fights it', async () => {
    await fresh('hunt-g6'); await setup();
    const r = await ev(() => {
      const t = testBM1; const s = window.__scene();
      window.__adv(3);
      const o = window.__hunt();
      if (!o) return { fail: 'no hunt' };
      // His hunters standing at the Suliban Helix (their journey there done), the captain arriving on a course.
      const hs = o.hunters.map((x) => window.__hir().find((h) => h.id === x.hullId));
      for (const h of hs) { const tr = (t.campaign().journeys || []).find((j) => j.id === h.transit?.journeyId); if (tr) { tr.status = 'arrived'; } delete h.transit; h.systemIndex = s.S; }
      t.state.warp.active = true; t.state.warp.path = [s.S, s.R]; t.state.warp.legsDone = 1;
      const stop = t.captainCrossingCheck(s.S, { journeyId: 'gate-course', leg: 0, last: false });
      t.state.warp.active = false;
      const enc = stop?.encounterId ? t.Encounter.encounterById(t.campaign(), stop.encounterId) : null;
      return { stop, enc: enc && { status: enc.status, captain: enc.captain, system: enc.system, type: enc.type }, hunt: window.__brief(window.__hunt()), S: s.S, heading: window.__hunt()?.lastKnown?.heading };
    });
    evidence.push({ check: 'CROSSING', ...r });
    assert.ok(!r.fail, r.fail);
    assert.equal(r.stop?.type, 'hunt', JSON.stringify(r.stop));
    assert.equal(r.enc.type, 'hunt'); assert.equal(r.enc.captain, true); assert.equal(r.enc.status, 'pending'); assert.equal(r.enc.system, r.S);
    assert.equal(r.hunt.lastKnown.source, 'contact');
  });

  await check('new-feature', 'R14/R15 LOST-CONTACT the captain leaves the Hirogen\'s sensor cover while they close: the hunt keeps where and when he was last seen (not a live track), searches there and gives up within the search budget — "escaped" (SHOT)', async () => {
    await fresh('hunt-g7'); await setup();
    const r = await ev(() => {
      const t = testBM1; const s = window.__scene();
      window.__adv(3);
      const o = window.__hunt();
      if (!o) return { fail: 'no hunt' };
      // Gone where no Hirogen sensor reaches (Earth).
      window.__place(window.__idx('Earth'));
      const trail = [];
      let shotDay = null;
      for (let d = 0; d < 120 && window.__hunt().status === 'active'; d++) { window.__adv(1); const h = window.__hunt(); trail.push([t.state.day, h.phase, h.lastKnown.systemIndex, h.lastKnown.day, h.lostSince]); if (h.phase === 'searching' && shotDay == null) { shotDay = t.state.day; break; } }
      return { S: s.S, trail, shotDay, hunt: window.__brief(window.__hunt()) };
    });
    evidence.push({ check: 'LOST-CONTACT (searching)', ...r });
    assert.ok(!r.fail, r.fail);
    assert.ok(r.shotDay != null, `never searched: ${JSON.stringify(r.trail.slice(-3))}`);
    assert.ok(r.trail.every((x) => x[2] === r.S), 'tracked a ship nobody could see');
    await shotSection('HUNT-lost-contact-search-debug.png', '[data-hunt-section]');
    const e = await ev(() => { const t = testBM1; for (let d = 0; d < 200 && window.__hunt().status === 'active'; d++) window.__adv(1); const o = window.__hunt(); return { hunt: window.__brief(o), searchDays: t.DoctrineCampaign.huntDebug(t.campaign(), t.buildCampaignWorld(true)).hunts[0] ? null : null, cfgScale: t.DoctrineCampaign.doctrineBook(t.campaign()).hunt.scale }; });
    evidence.push({ check: 'LOST-CONTACT (end)', ...e });
    assert.equal(e.hunt.status, 'aborted'); assert.equal(e.hunt.result.result, 'escaped');
    assert.ok(e.hunt.result.day - e.hunt.lostSince <= 10 * e.cfgScale + 1, `searched ${e.hunt.result.day - e.hunt.lostSince} days`);
  });

  await check('preservation', 'R22/R23/R24 NO-CAPTURE-NO-WAR two hundred days with the Hirogen hunting (captain beside their space): no world changes hands, no relation changes, no war is declared', async () => {
    await fresh('hunt-g8'); await setup();
    const r = await ev(() => {
      const t = testBM1; window.__scene();
      const b = t.campaign();
      const ctl0 = JSON.stringify(t.state.planets.map((p) => p.controller ?? p.owner ?? null));
      const w = t.buildCampaignWorld(true);
      const pols = Object.keys(b.polities).filter((p) => p !== 'hirogen' && p !== 'player');
      const rel0 = pols.map((p) => [p, w.relation('hirogen', p)]);
      window.__adv(200);
      const w2 = t.buildCampaignWorld(true);
      return { ctlSame: ctl0 === JSON.stringify(t.state.planets.map((p) => p.controller ?? p.owner ?? null)), rel0, rel1: pols.map((p) => [p, w2.relation('hirogen', p)]), stats: window.__sum().stats, hunts: window.__sum().hunts.length };
    });
    evidence.push({ check: 'NO-CAPTURE-NO-WAR', ...r });
    assert.ok(r.ctlSame, 'a world changed hands');
    assert.deepEqual(r.rel1, r.rel0);
  });

  await check('new-feature', 'DEBUG-HUNTS the "Hirogen hunts" debug section lists hunts (hunter, prey, known facts, score, phase, last-known system, budget, ETA/intercept, authority, result, cooldown) and the latest selections with each candidate\'s verdict', async () => {
    const r = await ev(() => { testBM1.openDebugMenu(); const el = document.querySelector('[data-hunt-section]'); const txt = el ? el.textContent : null; document.getElementById('cheats-debug').close(); return { txt }; });
    evidence.push({ check: 'DEBUG-HUNTS', txt: r.txt?.slice(0, 1500) });
    for (const k of ['Hunters', 'Prey', 'Score', 'Phase', 'Last known', 'Budget left', 'ETA / intercept', 'Authority', 'Result / cooldown', 'Candidates']) assert.ok(r.txt && r.txt.includes(k), `missing ${k}`);
  });

  fs.writeFileSync(path.join(out, 'hunt-gate.json'), JSON.stringify({ hasHunt, results, evidence }, null, 1));
  const byCat = (c) => { const x = results.filter((y) => y.category === c); return `${x.filter((y) => y.ok).length}/${x.length}`; };
  console.log(`\nhirogen hunt in-game: ${results.filter((x) => x.ok).length}/${results.length} (baseline-defect ${byCat('baseline-defect')}, new-feature ${byCat('new-feature')}, preservation ${byCat('preservation')})`);
  if (probe.errors.length) console.log('page errors:', probe.errors.slice(0, 5));
  await probe.close();
  process.exit(results.every((x) => x.ok) && !probe.errors.length ? 0 : 1);
})().catch((e) => { console.error(e); process.exit(1); });
