// In-game gate for the TOWING / SALVAGE / STRANDED-HULL RECOVERY AUDIT round (docs/movement/TOWING-SALVAGE-AUDIT.md,
// TOWING-SALVAGE-RULES.md). The real engine, chart and catalogue. Categories:
//   baseline-defect  reproduces a defect in a7e56d2's towing (fails on its own assertion there)
//   new-feature      this round's lifecycle, lines and debug
//   preservation     must hold on both trees (the personal-ship emergency recovery exception, the shared system)
// Screenshots: stranded hull awaiting recovery, tug en route, tow under way with ETA, a tow at a blockade, the
// hull in the yard, the salvaged prize hull, the recovery debug view.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { startProbe } = require('./probe-harness.cjs');

(async () => {
  const probe = await startProbe({ viewport: { width: 1400, height: 900 }, pageOptions: { deviceScaleFactor: 2 } });
  const { ev, fresh, page } = probe;
  const out = process.env.BM1_TEST_OUTPUT || '/tmp';
  fs.mkdirSync(out, { recursive: true });
  const results = [], evidence = [];
  async function check(category, name, fn) {
    try { await fn(); results.push({ category, name, ok: true }); console.log('PASS', `[${category}]`, name); }
    catch (err) { results.push({ category, name, ok: false, message: String(err?.message || err).split('\n').slice(0, 6).join(' ') }); console.log('FAIL', `[${category}]`, name, '\n      ', String(err?.message || err).split('\n').slice(0, 8).join(' ')); }
  }
  async function shotSection(file, selector) {
    await ev(() => testBM1.closeGalaxyReports?.());
    const ok = await ev((sel) => { const d = document.getElementById('cheats-debug'); if (!d.open) testBM1.openDebugMenu(); if (!document.querySelector(sel)) return false; for (const x of d.querySelectorAll('section')) if (!x.matches(sel)) x.style.display = 'none'; d.style.maxHeight = 'none'; d.style.height = 'auto'; d.style.width = '1360px'; d.style.maxWidth = 'none'; d.style.overflow = 'visible'; d.style.position = 'absolute'; d.style.top = '0'; return true; }, selector);
    if (ok) {
      const h = await ev((sel) => Math.ceil(document.querySelector(sel).getBoundingClientRect().bottom + window.scrollY + 40), selector);
      await page.setViewportSize({ width: 1400, height: Math.min(7000, Math.max(900, h)) });
      await page.locator(selector).screenshot({ path: path.join(out, file) });
      await page.setViewportSize({ width: 1400, height: 900 });
    }
    await ev(() => { const d = document.getElementById('cheats-debug'); for (const x of d.querySelectorAll('section')) x.style.display = ''; d.removeAttribute('style'); d.close(); testBM1.closeGalaxyReports?.();
      const c = testBM1.playtestClock; if (c.stoppedAt !== null) { c.offset += performance.now() - c.stoppedAt; c.stoppedAt = null; } });
  }
  async function shotFleet(file, selector) {
    await ev((sel) => { const t = testBM1; t.renderFleetManager(true); const el = document.querySelector(sel); const d = el?.closest('details'); if (d) d.open = true; el?.scrollIntoView({ block: 'center' }); }, selector);
    await page.waitForTimeout(150);
    await page.screenshot({ path: path.join(out, file) });
    await ev(() => document.querySelectorAll('dialog[open]').forEach((d) => d.close()));
  }
  await page.waitForFunction(() => !testBM1.doctrineStatus || testBM1.doctrineStatus().state !== 'loading', null, { timeout: 30000 }).catch(() => {});
  const HULK = 307, TUG = 47; // Saber Planetary Defender (mass 2), Oberth Tug (capacity 8, 5/10)
  const setup = () => page.evaluate(() => {
    const t = testBM1;
    window.__adv = (n) => { for (let i = 0; i < n; i++) t.advanceFleetCalendar(1, t.Fleet.nextId(t.fleetBook(), 'journey')); };
    window.__idx = (name) => t.getSystemIndexByName(name);
    window.__ship = (id, at, shipId, opts = {}) => {
      const rec = { id, shipId: Number(shipId), name: opts.name || id, systemIndex: at, assignment: 'defense', destroyed: false };
      const v = t.ensureFleetVesselSnapshot(rec);
      if (opts.disabled) { v.hull = Math.max(1, Math.floor(v.maxHull * 0.05)); v.condition = 'disabled'; }
      t.state.playerFleet.push(rec);
      return rec;
    };
    window.__f = (id) => t.state.playerFleet.find((f) => f.id === id);
    window.__rec = () => (t.campaign().hullRecoveries || []).slice(-1)[0] || null;
    window.__quiet = () => { const db = t.DoctrineCampaign.doctrineBook(t.campaign()); db.config = { ...db.config, patrols: {}, explorers: {}, merchants: {}, projects: {}, patrolAreas: {} }; t.campaign().config.aiStrategicOps = false; t.campaign().config.aiRecovery = false; };
    window.__line = (id) => { t.renderFleetManager(true); return document.querySelector(`[data-fleet-recovery="${id}"]`)?.textContent || ''; };
    window.__requestBtn = (id) => document.querySelector(`[data-fleet-recovery="${id}"]`)?.nextElementSibling;
  });

  // 1 ---------------------------------------------------------------------------------------------
  await check('preservation', 'EMERGENCY-RECOVERY-EXCEPTION the captain\'s own disabled ship recovers after 5 seconds, same personal vid, rescue debt recorded; no recovery record and no journey are created; a disabled fleet vessel (selected as target), a disabled NPC and a disabled AI (doctrine) hull nearby are not touched; the call cannot be pointed at another vessel', async () => {
    await fresh('ta-emergency');
    await setup();
    const r = await ev(() => {
      const t = testBM1, s = t.state, b = t.fleetBook(), book = t.campaign();
      window.__quiet();
      const here = s.currentPlanet;
      window.__ship('Hood', here, 307, { disabled: true, name: 'USS Hood' });
      t.applySystemState(here);
      const actor = t.fleetLocalActor('Hood');
      // An NPC disabled in the scene, and an AI hull disabled in the model at this system (a doctrine vessel's).
      const npc = s.npcShips.find((n) => !n.fleetId && !n.destroyed);
      if (npc) { npc.combatHull = Math.max(1, Math.floor((npc.maxCombatHull || 100) * 0.05)); t.applyVesselDisablement(npc); }
      const w = t.buildCampaignWorld(true);
      const ai = book.polities.terran.hulls.find((h) => h.status === 'ready' && !h.opId && !h.transit);
      ai.systemIndex = here; ai.hull = Math.max(1, Math.floor(ai.maxHull * 0.05)); ai.status = 'repairing'; window.__aiHull0 = ai.hull;
      t.Campaign.advanceStranded(book, w, s.day, []);
      if (actor) { s.combatTargetId = actor.id; s.combatTargetType = 'npc'; }
      // The personal ship disabled.
      s.hull = 3; t.applyVesselDisablement(null);
      s.latinum = 0; s.mylatinum = 0;
      const vid0 = t.ensurePersonalIdentity().vid, debt0 = b.debt, rec0 = (book.hullRecoveries || []).length, jr0 = (book.journeys || []).length;
      const fleetHull0 = window.__f('Hood').vessel.hull;
      // Fleet & Shipyard's top-level button (the personal vessel's), as the captain clicks it.
      t.renderFleetManager(true);
      const btn = document.querySelector('[data-fleet-action="rescue"]');
      const label = btn?.textContent || null;
      btn?.click();
      document.querySelectorAll('dialog[open]').forEach((d) => d.close());
      const pending = { cond: b.personalCondition, recoveryAt: s.recoveryAt > 0 };
      const second = null;
      return { label, vid0, debt0, rec0, jr0, fleetHull0, pending, second, npcId: npc?.id || null, aiId: ai.id, aiHull0: ai.hull, actorId: actor?.id || null, here };
    });
    // 5 seconds of game time, then a few frames.
    // 5 seconds of game time pass: the engine's own per-frame tick, for the personal ship and every disabled actor in
    // the scene (the fleet vessel, the NPC), at the same game time.
    await ev((p) => { const t = testBM1, s = t.state; const c = t.playtestClock; c.offset -= 5200; const now = (c.stoppedAt ?? performance.now()) - c.offset;
      t.tickDisabledVessel(null, now); for (const n of s.npcShips) if (n.condition === 'disabled') t.tickDisabledVessel(n, now);
      // The personal ship now operational: the call, even aimed at the disabled fleet vessel, has nothing to do.
      window.__aimed = t.recoverDisabledPlayer('Hood'); }, r);
    const r2 = await ev((p) => {
      const t = testBM1, s = t.state, b = t.fleetBook(), book = t.campaign();
      const npc = p.npcId ? s.npcShips.find((n) => n.id === p.npcId) : null;
      const ai = book.polities.terran.hulls.find((h) => h.id === p.aiId);
      return { aimed: window.__aimed, cond: b.personalCondition, vid: t.ensurePersonalIdentity().vid, debt: b.debt, rescueBills: (b.ledger || []).filter((x) => x.kind === 'rescue').length,
        recs: (book.hullRecoveries || []).length, journeys: (book.journeys || []).length, fleetCond: t.fleetVesselCondition(window.__f('Hood')), fleetHull: window.__f('Hood').vessel.hull,
        npcCond: npc ? npc.condition : null, aiDisabled: t.Campaign.hullIsDisabled(ai), aiAt: ai.systemIndex, aiHull: ai.hull, aiStranded: ai.stranded?.recovery || null };
    }, r);
    evidence.push({ check: 'EMERGENCY', before: r, after: r2 });
    assert.equal(r.pending.recoveryAt, true, 'no emergency recovery started');
    assert.equal(r2.cond, 'operational', 'the personal ship did not recover after 5 seconds');
    assert.equal(r2.vid, r.vid0, 'the personal vid changed');
    assert.equal(r2.aimed, false, 'aimed at the disabled fleet vessel, the emergency recovery acted');
    assert.ok(r2.debt > r.debt0, `no rescue debt (${r.debt0} → ${r2.debt})`); assert.ok(r2.rescueBills >= 1);
    assert.equal(r2.recs, r.rec0, 'a recovery record was created'); assert.equal(r2.journeys, r.jr0, 'a journey was created');
    assert.equal(r2.fleetCond, 'disabled', 'the fleet vessel was repaired by the personal exception');
    if (r.npcId) assert.equal(r2.npcCond, 'disabled', 'an NPC was repaired');
    assert.equal(r2.aiDisabled, true); assert.equal(r2.aiAt, r.here); assert.equal(r2.aiHull, r.aiHull0, 'the AI hull was repaired');
    assert.equal(r2.fleetHull, r.fleetHull0, 'the fleet vessel\'s hull changed');
  });

  // 2 ---------------------------------------------------------------------------------------------
  await check('new-feature', 'EMERGENCY-LABEL the personal exception is labelled Emergency recovery (fleet manager and Ship disabled panel); a disabled fleet vessel\'s own button is Request recovery', async () => {
    await fresh('ta-label');
    await setup();
    const r = await ev(() => {
      const t = testBM1, s = t.state;
      window.__quiet();
      window.__ship('Hood', window.__idx('Tellar'), 307, { disabled: true, name: 'USS Hood' });
      s.hull = 3; t.applyVesselDisablement(null);
      t.updateRecoveryPanel?.();
      const panel = document.querySelector('#disabled-recovery [data-recovery="request"]')?.textContent || null;
      t.renderFleetManager(true);
      const top = document.querySelector('[data-fleet-action="rescue"]')?.textContent || null;
      const fleet = window.__requestBtn('Hood')?.textContent || null;
      return { panel, top, fleet };
    });
    await ev(() => document.querySelectorAll('dialog[open]').forEach((d) => d.close()));
    evidence.push({ check: 'LABEL', ...r });
    assert.match(r.top, /Emergency recovery/i); assert.match(r.panel || '', /Emergency recovery/i); assert.match(r.fleet || '', /Request recovery/i);
  });

  // 3 ---------------------------------------------------------------------------------------------
  let flow = null;
  await check('new-feature', 'RECOVERY-FLOW (R21) a disabled vessel of the captain\'s at Tellar: the line names the vessel, ETA and yard; Request recovery makes one book.hullRecoveries mission flown by kind-recovery journeys; the lines read "Recovery requested — … · Recovery vessel: … · ETA: N days · Tow to: …", then "Tug Atlas towing USS Hood → … · arrives day N" (that very day), then "In yard at … — awaiting repair"; the debug view shows the phase, ETA, tow rule and blocker columns', async () => {
    await fresh('ta-flow');
    await setup();
    const r0 = await ev((C) => {
      const t = testBM1, s = t.state;
      window.__quiet();
      const T = window.__idx('Tellar'), E = window.__idx('Earth');
      t.markSystemVisited(T);
      window.__ship('Hood', T, C.HULK, { disabled: true, name: 'USS Hood' });
      window.__ship('Atlas', E, C.TUG, { name: 'Tug Atlas' });
      s.currentPlanet = window.__idx('Vulcan'); t.applySystemState(s.currentPlanet);
      window.__adv(5);
      return { T, E, vid: t.ensureFleetVesselIdentity(window.__f('Hood')).vid, at: window.__f('Hood').systemIndex, line: window.__line('Hood') };
    }, { HULK, TUG });
    await shotFleet('TA-1-stranded-awaiting-recovery-fleet.png', '[data-fleet-recovery="Hood"]');
    await shotSection('TA-1-stranded-awaiting-recovery-debug.png', '[data-recovery-section]');
    assert.equal(r0.at, r0.T); assert.match(r0.line, /^Recovery vessel: Tug Atlas · ETA: \d+ days · Tow to: \S/);
    const r1 = await ev(() => {
      const t = testBM1, s = t.state, book = t.campaign();
      const j0 = (book.journeys || []).length;
      window.__requestBtn('Hood').click();
      const rec = window.__rec();
      const tr = t.Campaign.journeyById(book, rec.outbound.journeyId);
      return { id: rec.id, state: rec.state, kind: tr.kind, journeysAdded: (book.journeys || []).length - j0, line: window.__line('Hood'), plan: rec.plan, outEta: rec.outbound.eta, day: s.day };
    });
    await shotFleet('TA-2-tug-en-route-fleet.png', '[data-fleet-recovery="Hood"]');
    await shotSection('TA-2-tug-en-route-recovery-debug.png', '[data-recovery-section]');
    assert.equal(r1.state, 'en_route_to_hulk'); assert.equal(r1.kind, 'recovery'); assert.equal(r1.journeysAdded, 1);
    assert.match(r1.line, /^Recovery requested — USS Hood · Recovery vessel: Tug Atlas · ETA: \d+ days · Tow to: \S/);
    const r2 = await ev(() => {
      const t = testBM1, s = t.state;
      const rec = window.__rec();
      for (let i = 0; i < 120 && rec.state === 'en_route_to_hulk'; i++) window.__adv(1);
      const line = window.__line('Hood');
      t.openDebugMenu(); const row = document.querySelector(`[data-recovery-row="${rec.id}"]`);
      const cells = row ? { phase: row.querySelector('[data-recovery-phase]')?.textContent, eta: row.querySelector('[data-recovery-eta]')?.textContent, tow: row.querySelector('[data-recovery-tow-speed]')?.textContent, blocker: row.querySelector('[data-recovery-blocker]')?.textContent } : null;
      document.getElementById('cheats-debug').close();
      return { state: rec.state, line, eta: rec.inbound?.eta, towSpeed: rec.inbound?.towSpeed, outSpeed: rec.outbound.speed, cells, day: s.day };
    });
    await shotFleet('TA-3-tow-underway-eta-fleet.png', '[data-fleet-recovery="Hood"]');
    await shotSection('TA-3-tow-underway-recovery-debug.png', '[data-recovery-section]');
    assert.equal(r2.state, 'towing');
    assert.match(r2.line, new RegExp(`^Tug Atlas towing USS Hood → \\S.* · arrives day ${r2.eta}$`));
    assert.ok(r2.towSpeed < r2.outSpeed); assert.equal(r2.towSpeed, Math.round(r2.outSpeed * 0.7 * 100) / 100, 'the tow is not the tug × 0.70');
    assert.match(r2.cells.phase, /towing/); assert.match(r2.cells.eta, new RegExp(`yard day ${r2.eta}`)); assert.match(r2.cells.tow, /× 0\.7/);
    const r3 = await ev(() => {
      const t = testBM1, s = t.state;
      const rec = window.__rec();
      for (let i = 0; i < 200 && rec.state === 'towing'; i++) window.__adv(1);
      const f = window.__f('Hood');
      return { state: rec.state, endedDay: rec.endedDay, eta: rec.inbound.eta, deliver: rec.plan.deliverDay, yard: rec.yard, at: f.systemIndex, cond: t.fleetVesselCondition(f), vid: t.ensureFleetVesselIdentity(f).vid, line: window.__line('Hood'), phase: t.Recovery.recoveryPhase(rec) };
    });
    await shotFleet('TA-5-hull-in-yard-fleet.png', '[data-fleet-recovery="Hood"]');
    await shotSection('TA-5-hull-in-yard-recovery-debug.png', '[data-recovery-section]');
    flow = { r0, r1, r2, r3 };
    evidence.push({ check: 'FLOW', ...flow });
    assert.equal(r3.state, 'delivered_to_yard'); assert.equal(r3.endedDay, r3.eta); assert.equal(r3.endedDay, r3.deliver);
    assert.equal(r3.at, r3.yard); assert.equal(r3.cond, 'disabled', 'repaired on delivery'); assert.equal(r3.vid, r0.vid);
    assert.match(r3.line, /^In yard at \S.* — awaiting repair$/); assert.equal(r3.phase, 'in_yard');
  });

  // 4 ---------------------------------------------------------------------------------------------
  await check('baseline-defect', 'NO-VESSEL-WAITS (R3) a disabled vessel and no ship of his able to tow her: Request recovery KEEPS the request ("Recovery requested — No recovery vessel available"; on a7e56d2 it was refused and nothing was kept); nothing is spawned and she does not move; the day a tug of his is free the same request takes it and the tug flies out', async () => {
    await fresh('ta-wait');
    await setup();
    const r = await ev((C) => {
      const t = testBM1, s = t.state, book = t.campaign();
      window.__quiet();
      const T = window.__idx('Tellar');
      window.__ship('Hood', T, C.HULK, { disabled: true, name: 'USS Hood' });
      s.currentPlanet = window.__idx('Vulcan'); t.applySystemState(s.currentPlanet);
      const n0 = s.playerFleet.length;
      window.__requestBtn('Hood')?.click();
      const kept = (book.hullRecoveries || []).find((x) => String(x.target.hullId) === 'pf:Hood');
      const line = window.__line('Hood');
      window.__adv(4);
      const mid = { state: kept?.state ?? null, at: window.__f('Hood').systemIndex, fleet: s.playerFleet.length - n0 };
      window.__ship('Atlas', window.__idx('Earth'), C.TUG, { name: 'Tug Atlas' });
      window.__adv(1);
      return { kept: Boolean(kept), line, mid, after: kept && { state: kept.state, tug: kept.tug?.hullId ?? null, waited: kept.waitedDays ?? null }, T, line2: window.__line('Hood') };
    }, { HULK, TUG });
    await shotFleet('TA-4-awaiting-recovery-vessel-fleet.png', '[data-fleet-recovery="Hood"]');
    evidence.push({ check: 'WAIT', ...r });
    assert.ok(r.kept, `the request was not kept (line "${r.line}")`);
    assert.equal(r.line, 'Recovery requested — No recovery vessel available');
    assert.equal(r.mid.state, 'requested'); assert.equal(r.mid.at, r.T); assert.equal(r.mid.fleet, 0);
    assert.equal(r.after.state, 'en_route_to_hulk'); assert.equal(r.after.tug, 'pf:Atlas');
  });

  // 5 ---------------------------------------------------------------------------------------------
  await check('preservation', 'TOW-BLOCKADE an AI tow crossing a blockaded system: the shared engine runs it, once, as a recovery journey\'s run with the casualty in the runner; shown in the journey and recovery debug', async () => {
    await fresh('ta-blockade');
    await setup();
    const r = await ev(() => {
      const t = testBM1, s = t.state, C = t.Campaign;
      window.__quiet();
      const book = t.campaign(); t.syncPlayerPolity(book);
      const w = t.buildCampaignWorld(true);
      const free = book.polities.terran.hulls.filter((h) => h.status === 'ready' && !h.opId && !h.transit);
      const E = window.__idx('Earth');
      const [hulk, tug] = free;
      hulk.shipId = 307; tug.shipId = 47;
      hulk.maxHull = hulk.hull = w.shipStats(307).combatHull; tug.maxHull = tug.hull = w.shipStats(47).combatHull;
      let pick = null;
      for (const sys of w.systems) {
        if (sys.controller === 'klingon' || sys.index === E) continue;
        const plan = C.plotJourney(w, sys.index, E, 'terran', null, 1, { noFixed: true });
        if (plan && plan.path.length >= 2 && plan.path.length <= 3) { pick = { at: sys.index, mid: plan.path[0] }; break; }
      }
      hulk.systemIndex = pick.at; tug.systemIndex = pick.at;
      hulk.hull = Math.max(1, Math.floor(hulk.maxHull * 0.05)); hulk.status = 'repairing';
      C.advanceStranded(book, w, s.day, []);
      const kl = book.polities.klingon.hulls.filter((h) => h.status === 'ready' && !h.opId && !h.transit).slice(0, 3);
      for (const h of kl) h.systemIndex = pick.mid;
      book.config.blockadeMaxDays = 400;
      const fx = [];
      const b = C.startBlockade(book, w, { power: 'klingon', target: pick.mid, hullIds: kl.map((h) => h.id), purpose: 'interdict_trade' }, s.day, fx);
      t.applyCampaignEffects(fx, s.day);
      const rec = C.requestHullRecovery(book, w, { sponsor: 'terran', targetHullId: hulk.id, tugHullId: tug.id, yard: E }, s.day, []).record;
      let run = null;
      for (let i = 0; i < 60 && !run; i++) { window.__adv(1); run = (b.record.runs || []).find((x) => String(x.by).includes(rec.inbound?.journeyId || '§')); }
      return { pick, run, runs: (b.record.runs || []).filter((x) => String(x.by).includes(rec.inbound?.journeyId || '§')).length, rec: { id: rec.id, state: rec.state, phase: t.Recovery.recoveryPhase?.(rec) ?? rec.state, hulkAt: hulk.systemIndex, history: rec.history.map((x) => `${x.day} ${x.state} ${x.note}`) } };
    });
    await shotSection('TA-6-tow-at-blockade-journey-debug.png', '[data-journey-section]');
    await shotSection('TA-6-tow-at-blockade-recovery-debug.png', '[data-recovery-section]');
    evidence.push({ check: 'TOW-BLOCKADE', ...r });
    assert.ok(r.run, 'the tow never ran the blockade'); assert.equal(r.run.kind, 'recovery'); assert.equal(r.runs, 1);
  });

  // 6 ---------------------------------------------------------------------------------------------
  await check('baseline-defect', 'SALVAGE-PRIZE-HULL a crewless Klingon hulk at 5% hull lying in sight is salvaged by his tug: the same vessel joins his books (same vid, origin Klingon, taken from the Klingons) at her ACTUAL damage — about 5%, not 1 hull point (a7e56d2: A2) — disabled, to be towed, repaired and kept; no prize-shelf copy, no Klingon plans or production unlocked', async () => {
    await fresh('ta-salvage');
    await setup();
    const r0 = await ev((C) => {
      const t = testBM1, s = t.state, Cm = t.Campaign;
      window.__quiet();
      const book = t.campaign(); t.syncPlayerPolity(book);
      const w = t.buildCampaignWorld(true);
      const T = window.__idx('Tellar');
      const k = book.polities.klingon.hulls.find((h) => h.status === 'ready' && !h.opId && !h.transit);
      k.shipId = 330; k.maxHull = k.hull = w.shipStats(330).combatHull; k.systemIndex = T;
      k.hull = Math.max(1, Math.floor(k.maxHull * 0.05)); k.status = 'repairing';
      Cm.advanceStranded(book, w, s.day, []);
      k.stranded.crew = 'lost'; k.stranded.crewEndDay = s.day; k.crew = 0;
      window.__ship('Atlas', window.__idx('Orion'), C.TUG, { name: 'Tug Atlas' });
      s.currentPlanet = T; t.applySystemState(T); t.markSystemVisited(T);
      return { kid: k.id, vid: k.identity?.vid || k.id, origin: k.identity?.origin?.builder, frac: k.hull / k.maxHull, plans: JSON.stringify(t.fleetBook().shipPlans), lic: JSON.stringify(book.polities.player?.licenses || {}) };
    }, { HULK, TUG });
    const r1 = await ev((p) => {
      const t = testBM1, s = t.state;
      t.renderFleetManager(true);
      const before = s.playerFleet.length, shelfBefore = JSON.stringify(t.campaignPrizes?.() || null);
      [...document.querySelectorAll('[data-fleet-action="salvage"]')][0]?.click();
      const rec = window.__rec();
      if (!rec) return { fail: 'no salvage mission' };
      s.currentPlanet = window.__idx('Vulcan'); t.applySystemState(s.currentPlanet);
      for (let i = 0; i < 120 && ['assigned', 'en_route_to_hulk', 'on_scene', 'attached'].includes(rec.state); i++) window.__adv(1);
      const a = s.playerFleet.find((f) => f.salvaged);
      const adopted = a && { id: a.id, vid: t.ensureFleetVesselIdentity(a).vid, origin: a.identity?.origin?.builder, takenFrom: a.takenFrom, cond: a.vessel.condition, frac: a.vessel.hull / a.vessel.maxHull, hull: a.vessel.hull, maxHull: a.vessel.maxHull, shipId: a.shipId, history: (a.identity?.history || []).map((x) => x.event) };
      for (let i = 0; i < 200 && rec.state === 'towing'; i++) window.__adv(1);
      return { joined: s.playerFleet.length - before, adopted, state: rec.state, yard: rec.yard, at: a?.systemIndex, condAfter: a?.vessel.condition,
        shelfSame: JSON.stringify(t.campaignPrizes?.() || null) === shelfBefore, plansSame: JSON.stringify(t.fleetBook().shipPlans) === p.plans, licSame: JSON.stringify(t.campaign().polities.player?.licenses || {}) === p.lic,
        klingonStill: t.campaign().polities.klingon.hulls.some((h) => h.id === p.kid && h.status !== 'lost'), vids: s.playerFleet.filter((f) => !f.destroyed).map((f) => t.ensureFleetVesselIdentity(f).vid) };
    }, r0);
    await shotFleet('TA-7-salvaged-prize-hull-fleet.png', '.fleet-status-disabled');
    await shotSection('TA-7-salvaged-prize-hull-recovery-debug.png', '[data-recovery-section]');
    evidence.push({ check: 'SALVAGE', r0, r1 });
    assert.ok(!r1.fail, r1.fail);
    assert.equal(r1.joined, 1); assert.equal(r1.adopted.vid, r0.vid); assert.equal(r1.adopted.origin, r0.origin); assert.equal(r1.adopted.takenFrom, 'klingon');
    assert.equal(r1.adopted.cond, 'disabled'); assert.equal(r1.klingonStill, false);
    assert.ok(r1.adopted.hull > 1 && Math.abs(r1.adopted.frac - r0.frac) < 0.02, `her damage was not kept: ${r1.adopted.hull}/${r1.adopted.maxHull} (${r1.adopted.frac.toFixed(3)}) against ${r0.frac.toFixed(3)} as she lay`);
    assert.ok(r1.adopted.history.includes('salvaged'));
    assert.equal(r1.state, 'delivered_to_yard'); assert.equal(r1.at, r1.yard); assert.equal(r1.condAfter, 'disabled', 'pristine on delivery');
    assert.ok(r1.shelfSame && r1.plansSame && r1.licSame, 'a prize copy, plans or licences appeared');
    assert.equal(new Set(r1.vids).size, r1.vids.length);
  });

  fs.writeFileSync(path.join(out, 'towing-audit-gate.json'), JSON.stringify({ results, evidence }, null, 1));
  const failed = results.filter((x) => !x.ok);
  const by = (c) => { const x = results.filter((y) => y.category === c); return `${x.filter((y) => y.ok).length}/${x.length}`; };
  console.log(`\ntowing audit in-game: ${results.length - failed.length}/${results.length} (baseline-defect ${by('baseline-defect')}, new-feature ${by('new-feature')}, preservation ${by('preservation')})${failed.length ? ` — FAILED: ${failed.map((x) => x.name.split(' ')[0]).join(', ')}` : ''}`);
  if (probe.errors.length) console.log('page errors:', probe.errors.slice(0, 5));
  await probe.close?.();
  process.exit(failed.length || probe.errors.length ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(2); });
