// In-game gate for TOWING-SALVAGE-RECOVERY (docs/movement/TOWING-SALVAGE-RECOVERY.md). The real engine, the real
// chart, the real catalogue: a disabled vessel of the captain's lying several systems away stays there; the
// fleet manager's Request recovery sends a real tug out by a real route; it attaches on arrival; the tow
// flies back slower and is delivered to a yard on the day the plan said, not repaired; a tow crosses a
// blockade through the shared engine; an AI hulk whose crew were taken off is towed in, repaired and waits
// for a crew; a Klingon hulk in sight is salvaged by the captain — the same vessel joins his books, origin
// Klingon, no prize-shelf copy. Screenshots of each.
// Categories:
//   baseline-defect  78cd8fa never recovers a hulk away from an own yard (fails on its own assertion)
//   new-feature      needs this round's missions, claims, UI or debug
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
    // The vessel's row is a collapsed <details>: opened, as the captain would, to show her lines.
    await ev((sel) => { const t = testBM1; t.renderFleetManager(true); const el = document.querySelector(sel); const d = el?.closest('details'); if (d) d.open = true; el?.scrollIntoView({ block: 'center' }); }, selector);
    await page.waitForTimeout(150);
    await page.screenshot({ path: path.join(out, file) });
    await ev(() => document.querySelectorAll('dialog[open]').forEach((d) => d.close()));
  }
  await page.waitForFunction(() => !testBM1.doctrineStatus || testBM1.doctrineStatus().state !== 'loading', null, { timeout: 30000 }).catch(() => {});
  const hasTow = await ev(() => typeof testBM1.Campaign.requestHullRecovery === 'function');

  // A Saber (escort, mass 2) disabled at Tellar; the captain's Oberth Tug (capacity 8, 0.8×) at Earth.
  const HULK = 307, TUG = 47;
  const setup = () => page.evaluate(() => {
    const t = testBM1;
    window.__adv = (n) => { for (let i = 0; i < n; i++) t.advanceFleetCalendar(1, t.Fleet.nextId(t.fleetBook(), 'journey')); };
    window.__idx = (name) => t.getSystemIndexByName(name);
    window.__ship = (id, at, shipId, opts = {}) => {
      const d = t.getShipStats(shipId);
      const rec = { id, shipId: Number(shipId), name: opts.name || id, systemIndex: at, assignment: 'defense', destroyed: false };
      const v = t.ensureFleetVesselSnapshot(rec);
      if (opts.disabled) { v.hull = Math.max(1, Math.floor(v.maxHull * 0.05)); v.condition = 'disabled'; }
      t.state.playerFleet.push(rec);
      void d;
      return rec;
    };
    window.__f = (id) => t.state.playerFleet.find((f) => f.id === id);
    window.__rec = () => (t.campaign().hullRecoveries || []).slice(-1)[0] || null;
    window.__quiet = () => { const db = t.DoctrineCampaign.doctrineBook(t.campaign()); db.config = { ...db.config, patrols: {}, explorers: {}, merchants: {}, projects: {}, patrolAreas: {} }; t.campaign().config.aiStrategicOps = false; t.campaign().config.aiRecovery = false; };
    // Click a fleet-manager button by its action and id, as the captain does.
    window.__click = (action, id) => { t.renderFleetManager(true); const el = [...document.querySelectorAll(`[data-fleet-action="${action}"]`)].find((b) => !id || b.dataset.fleetId === String(id) || b.getAttribute('data-id') === String(id) || b.outerHTML.includes(`"${id}"`)); if (!el) return false; el.click(); return true; };
  });

  // 1 ---------------------------------------------------------------------------------------------
  await check('baseline-defect', 'STRANDED-THEN-RECOVERED a disabled vessel of the captain\'s at Tellar stays there 30 days; Request recovery in the fleet manager sends his tug out by the real route; it attaches only on arrival at Tellar; the tow flies back slower; she reaches the yard on the day the plan said, disabled (awaiting repair), the same vessel', async () => {
    await fresh('tw-player');
    await setup();
    const r0 = await ev((C) => {
      const t = testBM1, s = t.state;
      window.__quiet();
      const E = window.__idx('Earth'), T = window.__idx('Tellar');
      t.markSystemVisited(T);
      window.__ship('Stranded Saber', T, C.HULK, { disabled: true, name: 'USS Hood' });
      window.__ship('Tug Atlas', E, C.TUG, { name: 'Tug Atlas' });
      s.currentPlanet = window.__idx('Vulcan'); t.applySystemState(s.currentPlanet);
      const vid = t.ensureFleetVesselIdentity(window.__f('Stranded Saber')).vid;
      window.__adv(30);
      const f = window.__f('Stranded Saber');
      t.renderFleetManager(true);
      const line = document.querySelector('[data-fleet-recovery="Stranded Saber"]')?.textContent || '';
      return { T, E, vid, at30: f.systemIndex, cond: f.vessel.condition, line, day: s.day };
    }, { HULK, TUG });
    await shotFleet('TOW-1-stranded-hull-fleet.png', '[data-fleet-recovery="Stranded Saber"]');
    await shotSection('TOW-1-stranded-hull-debug.png', '[data-recovery-section]');
    evidence.push({ check: 'STRANDED', ...r0 });
    assert.equal(r0.at30, r0.T, 'she moved without a tug'); assert.equal(r0.cond, 'disabled');
    if (!hasTow) throw new Error(`no towing on this build: after 30 days she still lies at Tellar with no way to send a tug (line: "${r0.line}")`);
    assert.match(r0.line, /Recovery possible — Tug Atlas/);
    // Request recovery, in the fleet manager.
    const r1 = await ev(() => {
      const t = testBM1, s = t.state;
      t.renderFleetManager(true);
      const btn = document.querySelector('[data-fleet-recovery="Stranded Saber"]')?.nextElementSibling;
      btn?.click();
      const rec = window.__rec();
      t.renderFleetManager(true);
      const line = document.querySelector('[data-fleet-recovery="Stranded Saber"]')?.textContent || '';
      const tug = window.__f('Tug Atlas');
      return { clicked: btn?.textContent, rec: rec && { id: rec.id, state: rec.state, plan: rec.plan, outbound: rec.outbound, yard: rec.yard, tug: rec.tug.vid, target: rec.target.vid }, line, tugOp: tug.strategicOp, day: s.day };
    });
    await shotFleet('TOW-2-tug-outbound-fleet.png', '[data-fleet-recovery="Stranded Saber"]');
    await shotSection('TOW-2-tug-outbound-journey-debug.png', '[data-journey-section]');
    evidence.push({ check: 'OUTBOUND', ...r1 });
    assert.ok(r1.rec, `no mission (button "${r1.clicked}")`);
    assert.equal(r1.rec.state, 'en_route_to_hulk');
    assert.match(r1.line, /Recovery assigned — Tug Atlas · tug arrives day \d+/);
    assert.ok(r1.rec.outbound.route.length >= 3, `outbound route ${r1.rec.outbound.route}`);
    // Day by day until she is in tow.
    const r2 = await ev((T) => {
      const t = testBM1, s = t.state;
      const rec = window.__rec();
      const trail = [];
      for (let i = 0; i < 120 && rec.state === 'en_route_to_hulk'; i++) { window.__adv(1); trail.push([s.day, window.__f('Tug Atlas').systemIndex, rec.state]); }
      t.renderFleetManager(true);
      const line = document.querySelector('[data-fleet-recovery="Stranded Saber"]')?.textContent || '';
      return { state: rec.state, attachment: rec.attachment, inbound: rec.inbound, planned: rec.plan, line, tugAt: window.__f('Tug Atlas').systemIndex, hulkAt: window.__f('Stranded Saber').systemIndex, trail: trail.slice(-3), T };
    }, r0.T);
    await shotFleet('TOW-3-under-tow-fleet.png', '[data-fleet-recovery="Stranded Saber"]');
    await shotSection('TOW-3-under-tow-recovery-debug.png', '[data-recovery-section]');
    evidence.push({ check: 'ATTACHED', ...r2 });
    assert.equal(r2.state, 'towing', JSON.stringify(r2));
    assert.equal(r2.attachment.at, r0.T); assert.equal(r2.attachment.day, r1.rec.outbound.eta, 'attached on another day than the tug arrived');
    assert.match(r2.line, /Under tow → .* · tow ETA day \d+/);
    assert.ok(r2.inbound.towSpeed < r1.rec.outbound.speed, `tow ${r2.inbound.towSpeed}× is not slower than the tug's ${r1.rec.outbound.speed}×`);
    const r3 = await ev(() => {
      const t = testBM1, s = t.state;
      const rec = window.__rec();
      for (let i = 0; i < 200 && rec.state === 'towing'; i++) window.__adv(1);
      const f = window.__f('Stranded Saber');
      t.renderFleetManager(true);
      return { state: rec.state, endedDay: rec.endedDay, eta: rec.inbound.eta, plannedDeliver: rec.plan.deliverDay, yard: rec.yard, at: f.systemIndex, cond: f.vessel.condition, vid: t.ensureFleetVesselIdentity(f).vid, status: t.fleetTradeStatusLine(f), tugFree: !window.__f('Tug Atlas').strategicOp, tugAt: window.__f('Tug Atlas').systemIndex };
    });
    await shotFleet('TOW-5-delivered-to-yard-fleet.png', '[data-fleet-recovery="Stranded Saber"], .fleet-status-disabled');
    await shotSection('TOW-5-delivered-to-yard-debug.png', '[data-recovery-section]');
    evidence.push({ check: 'DELIVERED', ...r3 });
    assert.equal(r3.state, 'delivered_to_yard', JSON.stringify(r3));
    assert.equal(r3.endedDay, r3.eta, 'delivered on another day than the tow ETA');
    assert.equal(r3.endedDay, r3.plannedDeliver, `delivered day ${r3.endedDay}; the request said day ${r3.plannedDeliver}`);
    assert.equal(r3.at, r3.yard); assert.equal(r3.cond, 'disabled', 'repaired on delivery');
    assert.match(r3.status, /Disabled — awaiting repair/);
    assert.equal(r3.vid, r0.vid);
    assert.ok(r3.tugFree, 'the tug is still held');
  });

  // 2 ---------------------------------------------------------------------------------------------
  await check('new-feature', 'TOW-BLOCKADE an AI tow crossing a blockaded system runs the blockade through the shared engine: the run is on the blockade\'s record as a recovery journey\'s, the hulk in the runner', async () => {
    if (!hasTow) throw new Error('no towing on this build');
    await fresh('tw-blockade');
    await setup();
    const r = await ev(() => {
      const t = testBM1, s = t.state, C = t.Campaign;
      window.__quiet();
      const book = t.campaign(); t.syncPlayerPolity(book);
      const w = t.buildCampaignWorld(true);
      const tp = book.polities.terran;
      const free = tp.hulls.filter((h) => h.status === 'ready' && !h.opId && !h.transit);
      const E = window.__idx('Earth');
      // A Terran escort disabled two systems out, a Terran tug at Earth, a Klingon blockade on the way between.
      const [hulk, tug] = free;
      hulk.shipId = 307; tug.shipId = 47;
      hulk.maxHull = hulk.hull = w.shipStats(307).combatHull; tug.maxHull = tug.hull = w.shipStats(47).combatHull;
      let pick = null;
      for (const sys of w.systems) {
        if (sys.controller === 'klingon' || sys.index === E) continue;
        const plan = C.plotJourney(w, sys.index, E, 'terran', null, 1, { noFixed: true });
        if (plan && plan.path.length >= 2 && plan.path.length <= 3) { pick = { at: sys.index, mid: plan.path[0] }; break; }
      }
      if (!pick) return { fail: 'no route' };
      hulk.systemIndex = pick.at; tug.systemIndex = pick.at;
      hulk.hull = Math.max(1, Math.floor(hulk.maxHull * 0.05)); hulk.status = 'repairing';
      C.advanceStranded(book, w, s.day, []);
      const kl = book.polities.klingon.hulls.filter((h) => h.status === 'ready' && !h.opId && !h.transit).slice(0, 3);
      for (const h of kl) h.systemIndex = pick.mid;
      book.config.blockadeMaxDays = 400;
      const fx = [];
      const b = C.startBlockade(book, w, { power: 'klingon', target: pick.mid, hullIds: kl.map((h) => h.id), purpose: 'interdict_trade' }, s.day, fx);
      t.applyCampaignEffects(fx, s.day);
      if (!b.ok) return { fail: b.reason };
      const rq = C.requestHullRecovery(book, w, { sponsor: 'terran', targetHullId: hulk.id, tugHullId: tug.id, yard: E }, s.day, []);
      if (!rq.ok) return { fail: rq.reason };
      const rec = rq.record;
      let run = null;
      for (let i = 0; i < 60 && !run; i++) { window.__adv(1); run = (b.record.runs || []).find((x) => String(x.by).includes(rec.inbound?.journeyId || '§')); }
      const tr = C.journeyById(book, rec.inbound.journeyId);
      return { pick, rec: { id: rec.id, state: rec.state, inbound: rec.inbound }, run, encounters: tr.encounters, blockade: { status: b.record.status, runs: (b.record.runs || []).length } };
    });
    await shotSection('TOW-4-tow-crossing-blockade-journey-debug.png', '[data-journey-section]');
    await shotSection('TOW-4-tow-crossing-blockade-recovery-debug.png', '[data-recovery-section]');
    evidence.push({ check: 'TOW-BLOCKADE', ...r });
    assert.ok(!r.fail, r.fail);
    assert.ok(r.run, 'the tow never ran the blockade');
    assert.equal(r.run.kind, 'recovery');
    assert.ok(r.encounters.some((e) => e.system === r.pick.mid), 'not on the tow journey\'s record');
  });

  // 3 ---------------------------------------------------------------------------------------------
  await check('new-feature', 'CREWLESS-AWAITING-CREW an AI hulk whose crew were taken off is towed in, repaired in the yard over days, and then waits for a crew: repaired-awaiting-crew, not operational', async () => {
    if (!hasTow) throw new Error('no towing on this build');
    await fresh('tw-crew');
    await setup();
    const r = await ev(() => {
      const t = testBM1, s = t.state, C = t.Campaign;
      window.__quiet();
      const book = t.campaign(); t.syncPlayerPolity(book);
      const w = t.buildCampaignWorld(true);
      const tp = book.polities.terran;
      const [hulk, tug] = tp.hulls.filter((h) => h.status === 'ready' && !h.opId && !h.transit);
      hulk.shipId = 307; tug.shipId = 47; hulk.maxHull = hulk.hull = w.shipStats(307).combatHull; tug.maxHull = tug.hull = w.shipStats(47).combatHull;
      const at = window.__idx('Tellar'), E = window.__idx('Earth');
      hulk.systemIndex = at; tug.systemIndex = E;
      hulk.hull = Math.max(1, Math.floor(hulk.maxHull * 0.05)); hulk.status = 'repairing';
      C.advanceStranded(book, w, s.day, []);
      C.rescueStrandedCrew(book, 'terran', hulk.id, s.day, 'relief');
      const rq = C.requestHullRecovery(book, w, { sponsor: 'terran', targetHullId: hulk.id, tugHullId: tug.id }, s.day, []);
      if (!rq.ok) return { fail: rq.reason };
      const rec = rq.record;
      for (let i = 0; i < 200 && rec.state !== 'delivered_to_yard'; i++) window.__adv(1);
      const delivered = s.day;
      let repaired = null;
      for (let i = 0; i < 120 && C.hullIsDisabled(hulk); i++) { window.__adv(1); if (!C.hullIsDisabled(hulk)) repaired = s.day; }
      window.__adv(1);
      return { state: rec.state, delivered, repaired, recrew: hulk.recrew || null, status: hulk.status, crew: hulk.crew, vid: hulk.identity?.vid || hulk.id, targetVid: rec.target.vid };
    });
    await shotSection('TOW-6-crewless-repaired-awaiting-crew-debug.png', '[data-recovery-section]');
    evidence.push({ check: 'CREWLESS', ...r });
    assert.ok(!r.fail, r.fail);
    assert.equal(r.state, 'delivered_to_yard');
    assert.ok(r.repaired && r.repaired > r.delivered, `repaired day ${r.repaired}, delivered ${r.delivered}`);
    assert.ok(r.recrew, 'repaired without a crew and not waiting for one'); assert.equal(r.status, 'repairing');
    assert.equal(r.vid, r.targetVid);
  });

  // 4 ---------------------------------------------------------------------------------------------
  await check('new-feature', 'PLAYER-SALVAGE a crewless Klingon hulk lying in sight is claimable; Salvage in the fleet manager sends his tug; at attachment the same vessel joins his books (same vid, origin Klingon, taken from the Klingons), disabled, no prize-shelf copy; she is towed to a yard', async () => {
    if (!hasTow) throw new Error('no towing on this build');
    await fresh('tw-salvage');
    await setup();
    const r0 = await ev((C) => {
      const t = testBM1, s = t.state, Cm = t.Campaign;
      window.__quiet();
      const book = t.campaign(); t.syncPlayerPolity(book);
      const w = t.buildCampaignWorld(true);
      const T = window.__idx('Tellar'), E = window.__idx('Earth');
      const k = book.polities.klingon.hulls.find((h) => h.status === 'ready' && !h.opId && !h.transit);
      k.shipId = 330; k.maxHull = k.hull = w.shipStats(330).combatHull; k.systemIndex = T;
      k.hull = Math.max(1, Math.floor(k.maxHull * 0.05)); k.status = 'repairing';
      Cm.advanceStranded(book, w, s.day, []);
      k.stranded.crew = 'lost'; k.stranded.crewEndDay = s.day; k.crew = 0;
      window.__ship('Tug Atlas', T, C.TUG, { name: 'Tug Atlas' });
      window.__f('Tug Atlas').systemIndex = window.__idx('Orion');
      s.currentPlanet = T; t.applySystemState(T); t.markSystemVisited(T);
      t.renderFleetManager(true);
      const row = document.querySelector(`[data-salvage-hulk="${k.id}"]`);
      return { kid: k.id, vid: k.identity?.vid || k.id, origin: k.identity?.origin?.builder, row: row?.textContent || null, T, claim: Cm.recoveryClaim(book, w, 'player', k.id) };
    }, { TUG });
    await shotFleet('TOW-7-salvage-claim-fleet.png', `[data-salvage-hulk="${r0.kid}"]`);
    evidence.push({ check: 'SALVAGE-CLAIM', ...r0 });
    assert.ok(r0.row, 'the hulk is not listed in sight'); assert.equal(r0.claim.ok, true, r0.claim.reason); assert.equal(r0.claim.kind, 'salvage');
    const r1 = await ev((kid) => {
      const t = testBM1, s = t.state, Cm = t.Campaign;
      t.renderFleetManager(true);
      const btn = [...document.querySelectorAll('[data-fleet-action="salvage"]')][0];
      const before = t.state.playerFleet.length, shelfBefore = JSON.stringify(t.campaignPrizes?.() || null);
      btn?.click();
      const rec = window.__rec();
      if (!rec) return { fail: `no salvage mission (button: ${btn ? btn.outerHTML : 'none'})` };
      // The captain moves on; his tug does the work.
      s.currentPlanet = window.__idx('Vulcan'); t.applySystemState(s.currentPlanet);
      for (let i = 0; i < 120 && ['assigned', 'en_route_to_hulk', 'on_scene', 'attached'].includes(rec.state); i++) window.__adv(1);
      const adopted = t.state.playerFleet.find((f) => f.salvaged);
      const atAttach = { state: rec.state, members: t.state.playerFleet.length - before, adopted: adopted && { id: adopted.id, vid: t.ensureFleetVesselIdentity(adopted).vid, origin: adopted.identity?.origin?.builder, takenFrom: adopted.takenFrom, cond: adopted.vessel.condition, at: adopted.systemIndex, shipId: adopted.shipId } };
      const klingonStill = t.campaign().polities.klingon.hulls.some((h) => h.id === kid && h.status !== 'lost');
      for (let i = 0; i < 200 && rec.state === 'towing'; i++) window.__adv(1);
      t.renderFleetManager(true);
      return { atAttach, klingonStill, final: { state: rec.state, yard: rec.yard, endedDay: rec.endedDay, at: adopted?.systemIndex, cond: adopted?.vessel.condition, history: rec.history.map((x) => `${x.day} ${x.state} ${x.note}`) },
        shelfSame: JSON.stringify(t.campaignPrizes?.() || null) === shelfBefore, vids: t.state.playerFleet.filter((f) => !f.destroyed).map((f) => t.ensureFleetVesselIdentity(f).vid) };
    }, r0.kid);
    await shotFleet('TOW-7-salvaged-hull-in-fleet.png', '.fleet-status-disabled');
    await shotSection('TOW-7-salvage-ownership-change-debug.png', '[data-recovery-section]');
    evidence.push({ check: 'SALVAGE', ...r1 });
    assert.ok(!r1.fail, r1.fail);
    assert.equal(r1.atAttach.members, 1, 'not exactly one vessel joined the fleet');
    assert.equal(r1.atAttach.adopted.vid, r0.vid, 'a different vessel');
    assert.equal(r1.atAttach.adopted.origin, r0.origin); assert.equal(r1.atAttach.adopted.takenFrom, 'klingon'); assert.equal(r1.atAttach.adopted.shipId, 330);
    assert.equal(r1.atAttach.adopted.cond, 'disabled');
    assert.equal(r1.klingonStill, false, 'still on the Klingon books');
    assert.equal(r1.final.state, 'delivered_to_yard', JSON.stringify(r1.final));
    assert.equal(r1.final.at, r1.final.yard);
    assert.equal(new Set(r1.vids).size, r1.vids.length, 'duplicated identities');
    assert.ok(r1.shelfSame, 'a prize-shelf copy appeared');
  });

  fs.writeFileSync(path.join(out, 'towing-salvage-gate.json'), JSON.stringify({ results, evidence }, null, 1));
  const failed = results.filter((x) => !x.ok);
  const by = (c) => { const x = results.filter((y) => y.category === c); return `${x.filter((y) => y.ok).length}/${x.length}`; };
  console.log(`\ntowing & salvage in-game: ${results.length - failed.length}/${results.length} (baseline-defect ${by('baseline-defect')}, new-feature ${by('new-feature')})${failed.length ? ` — FAILED: ${failed.map((x) => x.name.split(' ')[0]).join(', ')}` : ''}`);
  if (probe.errors.length) console.log('page errors:', probe.errors.slice(0, 5));
  await probe.close?.();
  process.exit(failed.length || probe.errors.length ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(2); });
