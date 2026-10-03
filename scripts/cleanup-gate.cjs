// In-game gate for ARCHITECTURE-CLEANUP (docs/diplomacy/BASING-SERVICE-MATRIX.md, DMZ-PRESENCE-STATE-MATRIX.md,
// docs/movement/TRADER-RECORD-AUDIT.md), on the real chart with the real runtime: the captain is held to the same
// DMZ term as the model's ships (transit is not stationing; a stop is a grace, then one breach; a staging right
// lifts it; he is warned and offered Leave, never moved); a foreign yard serves him only the service a treaty grants
// (docking and repair separately; never an enemy's yard; never ownership, stock or production); a tow goes to a
// foreign yard only where it would be served; a trader's record is one shape that survives save/load mid-leg and a
// blockade; a world's posted jobs keep their courier flag, posting day and hazards across a reload. Categories:
//   baseline-defect  1f2da30 gets it wrong (fails on its own assertion there)
//   new-feature      needs this round
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
  const evidence = {};
  const shots = [];
  async function check(category, name, fn) {
    try { await fn(); results.push({ category, name, ok: true }); console.log('PASS', `[${category}]`, name); }
    catch (err) { results.push({ category, name, ok: false, message: String(err?.message || err).split('\n').slice(0, 6).join(' ') }); console.log('FAIL', `[${category}]`, name, '\n      ', String(err?.message || err).split('\n').slice(0, 8).join(' ')); }
  }
  async function shot(file) { await page.waitForTimeout(150); await page.screenshot({ path: path.join(out, file) }); shots.push(file); }
  async function shotSection(file, selector) {
    await ev(() => testBM1.closeGalaxyReports?.());
    const ok = await ev((sel) => { const d = document.getElementById('cheats-debug'); if (!d.open) testBM1.openDebugMenu(); if (!document.querySelector(sel)) return false; for (const x of d.querySelectorAll('section')) if (!x.matches(sel)) x.style.display = 'none'; d.style.maxHeight = 'none'; d.style.height = 'auto'; d.style.width = '1360px'; d.style.maxWidth = 'none'; d.style.overflow = 'visible'; d.style.position = 'absolute'; d.style.top = '0'; return true; }, selector);
    if (ok) {
      const h = await ev((sel) => Math.ceil(document.querySelector(sel).getBoundingClientRect().bottom + window.scrollY + 40), selector);
      await page.setViewportSize({ width: 1400, height: Math.min(7000, Math.max(900, h)) });
      await page.locator(selector).screenshot({ path: path.join(out, file) });
      await page.setViewportSize({ width: 1400, height: 900 });
      shots.push(file);
    }
    await ev(() => { const d = document.getElementById('cheats-debug'); for (const x of d.querySelectorAll('section')) x.style.display = ''; d.removeAttribute('style'); d.close(); testBM1.closeGalaxyReports?.();
      const c = testBM1.playtestClock; if (c.stoppedAt !== null) { c.offset += performance.now() - c.stoppedAt; c.stoppedAt = null; } });
    return ok;
  }
  // The fleet manager as the captain opens it, scrolled to the element.
  async function shotFleet(file, selector) {
    await ev((sel) => { const t = testBM1; t.closeGalaxyReports?.(); t.renderFleetManager(true); const el = document.querySelector(sel); el?.scrollIntoView({ block: 'center' }); }, selector);
    await page.waitForTimeout(150);
    await page.screenshot({ path: path.join(out, file) }); shots.push(file);
    await ev(() => document.querySelectorAll('dialog[open]').forEach((d) => d.close()));
  }
  await page.waitForFunction(() => !testBM1.doctrineStatus || testBM1.doctrineStatus().state !== 'loading', null, { timeout: 30000 }).catch(() => {});
  const setup = () => page.evaluate(() => {
    const t = testBM1;
    window.__idx = (name) => t.getSystemIndexByName(name);
    window.__S = () => ({ O: window.__idx('Orion'), N: window.__idx('Oce Nu'), R: window.__idx('Narendra'), E: window.__idx('Earth'), Q: window.__idx('Qonos') });
    window.__adv = (n) => { for (let i = 0; i < n; i++) t.advanceFleetCalendar(1, t.Fleet.nextId(t.fleetBook(), 'journey')); };
    window.__quiet = () => { const db = t.DoctrineCampaign.doctrineBook(t.campaign()); db.config = { ...db.config, patrols: {}, explorers: {}, merchants: {}, projects: {}, patrolAreas: {}, militaryResponses: false, enforcementResponses: false }; t.campaign().config.aiStrategicOps = false; t.campaign().config.aiRecovery = false; };
    // The border war with Klingon ends in a ceasefire (no clauses): what follows is added term by term.
    window.__ceasefire = () => { const book = t.campaign(); t.syncPlayerPolity(book); const eff = t.Campaign.forceWarTransition(book, t.buildCampaignWorld(true), 'player', 'klingon', 'ceasefire', t.state.day, 'the border war is exhausted', 'directed', { treaty: [] }); t.applyCampaignEffects(eff, t.state.day); return book.warStates?.['klingon:player']?.status; };
    window.__resumeWar = () => { const book = t.campaign(); t.syncPlayerPolity(book); const eff = t.Campaign.forceWarTransition(book, t.buildCampaignWorld(true), 'player', 'klingon', 'war', t.state.day, 'the ceasefire collapses', 'directed', {}); t.applyCampaignEffects(eff, t.state.day); return book.warStates?.['klingon:player']?.status; };
    window.__term = (spec) => { const book = t.campaign(); t.syncPlayerPolity(book); const eff = []; const r = t.Campaign.addTreatyTerm(book, t.buildCampaignWorld(true), spec, t.state.day, eff); t.applyCampaignEffects(eff, t.state.day); if (!r.ok) throw new Error(r.reason); return r.term.id; };
    window.__endTerm = (id) => { const book = t.campaign(); const eff = []; t.Campaign.endTreatyTerm(book, t.buildCampaignWorld(true), id, t.state.day, 'gate', eff); t.applyCampaignEffects(eff, t.state.day); };
    window.__longRange = () => { const ships = Object.values(t.state.shipStatsById).filter((x) => x && x.assetType === 'ship' && t.getShipFaction(x.id) === 'terran' && t.shipClassCombat(x.id) > 0.5); const best = ships.sort((a, b) => t.getShipWarpRange(b.id) - t.getShipWarpRange(a.id))[0]; if (best && t.getShipWarpRange(best.id) > t.getShipWarpRange()) { t.state.playership = Number(best.id); t.applyCurrentShipStats(true); } };
    window.__place = (sys) => { for (let i = 0; i < t.state.planets.length; i++) t.markSystemVisited(i); t.state.currentPlanet = sys; t.state.myplanet = sys + 1; t.state.docked = false; t.applySystemState(sys); t.placePlayerAtSecurityApproach?.(); window.__longRange(); t.state.hull = 100; t.state.fuelCap = Math.max(t.state.fuelCap, 9999); t.state.antimatter = Math.max(t.state.antimatter, 9999); };
    window.__jump = (to) => { t.state.mapOpen = true; t.state.selectedPlanet = to; t.state.fuelCap = Math.max(t.state.fuelCap, 9999); t.state.antimatter = Math.max(t.state.antimatter, 9999); t.jumpPlanet(); const d = document.getElementById('treaty-course-choice'); return { warp: t.state.warp.active, path: t.state.warp.active ? t.state.warp.path.slice() : null, dialog: d?.open ? d.textContent.trim() : null }; };
    window.__arrive = () => { t.openWarpBriefing?.(); t.closeGalaxyReports?.(); t.completeWarpTravel(); t.closeGalaxyReports?.(); return { at: t.state.currentPlanet, crossings: (t.state.warp.crossings || []).map((c) => c.system) }; };
    window.__dmz = () => (t.campaign().treatyTerms || []).find((x) => x.type === 'dmz' && x.status === 'active');
    window.__cap = () => { const d = window.__dmz(); return d?.withdrawal?.hulls?.captain ? { ...d.withdrawal.hulls.captain } : null; };
    window.__stationing = () => (t.campaign().treatyIncidents || []).filter((x) => x.kind === 'dmz_stationing').map((x) => ({ id: x.id, state: x.state, breaching: x.breaching, day: x.day, assets: x.assets }));
    window.__status = () => { const d = t.captainDmzStatus?.(); return d ? { state: d.state, due: d.due ?? null, line: d.line } : null; };
    window.__fleetText = (sel) => { t.renderFleetManager(true); const el = document.querySelector(sel); const r = el ? { text: el.textContent.trim(), state: el.dataset.captainDmz ?? null, leave: Boolean(el.querySelector('[data-fleet-action="dmz-leave"]')) } : null; document.querySelectorAll('dialog[open]').forEach((d) => d.close()); return r; };
    // Docked at a world's own dock, as the captain is after clicking it.
    window.__dock = (sys) => { const s = t.state; s.currentPlanet = sys; s.myplanet = sys + 1; t.applySystemState(sys); s.docked = true; s.dockedStationId = null; s.dockedPlanetIndex = sys; };
    window.__log = () => document.getElementById('log')?.textContent?.trim() || t.state.log || null;
    window.__lastLog = () => { const s = t.state; return (Array.isArray(s.logLines) ? s.logLines[s.logLines.length - 1] : null) || s.lastLog || document.querySelector('#log, .log, [data-log]')?.textContent?.trim() || null; };
  });
  // setLog is captured once, so a refusal line can be read back exactly.
  const captureLog = () => ev(() => { if (window.__logCap) return; window.__logCap = []; const orig = testBM1.setLog || window.setLog; void orig; });

  // 1 ---------------------------------------------------------------------------------------------
  await check('preservation', 'CG-1 TRANSIT-ONLY a ceasefire DMZ at Oce Nu and a Klingon guarantee of military transit there: the captain\'s course Orion → Narendra flies straight through Oce Nu (no choice offered), he arrives, and the pass leaves no presence and no breach', async () => {
    await fresh('cg-1'); await setup();
    const r = await ev(() => {
      const t = testBM1, S = window.__S();
      window.__quiet(); const rel = window.__ceasefire();
      window.__term({ type: 'dmz', parties: ['player', 'klingon'], systems: [S.N] });
      window.__term({ type: 'transit', grantor: 'klingon', beneficiary: 'player', systems: [S.N], traffic: ['military'] });
      window.__place(S.O);
      const line = t.captainAccessLine?.(S.N) ?? null;
      return { S, rel, line };
    });
    // The chart as he plots it: the course to Narendra drawn through Oce Nu, no treaty choice in the way.
    await ev(() => { const t = testBM1, S = window.__S(); t.openMap(); t.state.selectedPlanet = S.R; t.focusStarChartOnSystem(S.N); t.render?.(); });
    await shot('CG-1-transit-only-course-through-Oce-Nu.png');
    r.j = await ev(() => { const t = testBM1, S = window.__S(); t.closeMap?.(); return window.__jump(S.R); });
    evidence.transit = r;
    assert.equal(r.rel, 'ceasefire');
    assert.ok(r.j.warp && !r.j.dialog, `the course was not flown: ${JSON.stringify(r.j)}`); assert.ok(r.j.path.includes(r.S.N), `route ${r.j.path}`);
    const r2 = await ev(() => { const a = window.__arrive(); window.__adv(12); return { a, cap: window.__cap(), inc: window.__stationing() }; });
    evidence.transit2 = r2;
    assert.equal(r2.a.at, r.S.R); assert.ok(r2.a.crossings.includes(r.S.N));
    assert.equal(r2.cap, null, `a pass through was recorded as a presence: ${JSON.stringify(r2.cap)}`);
    assert.equal(r2.inc.length, 0);
    if (r.line != null) assert.match(r.line, /Transit permitted\. Staging prohibited\./);
  });

  // 2–3 -------------------------------------------------------------------------------------------
  await check('baseline-defect', 'CG-2 LOITER the same guarantee takes him to Oce Nu itself; stopped there, the next day he is warned — "DMZ — military stationing prohibited · Withdrawal required by day N" with a Leave DMZ button; pressing it plots the way out on the chart and does not move him (1f2da30 never held the captain to the stationing term)', async () => {
    const r = await ev(() => {
      const t = testBM1, S = window.__S();
      const j = window.__jump(S.N); const a = j.warp ? window.__arrive() : null;
      const day0 = t.state.day;
      window.__adv(1);
      return { S, j, a, day0, cap: window.__cap(), status: window.__status(), ui: window.__fleetText('[data-captain-dmz]'), inc: window.__stationing() };
    });
    evidence.loiter = r;
    assert.ok(r.j.warp, `no course to Oce Nu: ${JSON.stringify(r.j)}`); assert.equal(r.a.at, r.S.N);
    assert.equal(r.cap?.state, 'pending', `no presence: ${JSON.stringify(r.cap)}`); assert.equal(r.cap.presence, 'loitering');
    assert.ok(r.cap.dueDay > r.day0);
    assert.equal(r.inc.length, 0, 'a breach on the first day');
    assert.ok(r.ui, 'no DMZ line in the fleet manager');
    assert.match(r.ui.text, new RegExp(`DMZ — military stationing prohibited · Withdrawal required by day ${r.cap.dueDay}`));
    assert.equal(r.ui.leave, true);
    await shotFleet('CG-2-dmz-loiter-warning-grace.png', '[data-captain-dmz]');
    const leave = await ev(() => { const t = testBM1, S = window.__S(); t.renderFleetManager(true); document.querySelector('[data-captain-dmz] [data-fleet-action="dmz-leave"]')?.click(); const res = { at: t.state.currentPlanet, warp: t.state.warp.active, selected: t.state.selectedPlanet, mapOpen: t.state.mapOpen, inZone: t.state.selectedPlanet === S.N }; document.querySelectorAll('dialog[open]').forEach((d) => d.close()); t.closeMap?.(); return res; });
    evidence.leave = leave;
    assert.equal(leave.at, r.S.N, 'Leave moved him'); assert.equal(leave.warp, false, 'Leave started a course on its own');
    assert.equal(leave.inZone, false); assert.ok(Number.isFinite(leave.selected));
  });
  await check('baseline-defect', 'CG-3 BREACH he stays: the day after the withdrawal day one stationing breach by the empire is recorded and the line says so; ten more days add nothing; when he leaves, the presence closes (late) and the breach is resolved — no war', async () => {
    const r = await ev(() => {
      const t = testBM1;
      const due = window.__cap()?.dueDay ?? t.state.day + 15; // (1f2da30 kept no presence for him: wait out a grace anyway)
      while (t.state.day <= due) window.__adv(1);
      const first = { day: t.state.day, cap: window.__cap(), inc: window.__stationing(), status: window.__status(), ui: window.__fleetText('[data-captain-dmz]') };
      return { due, first };
    });
    evidence.breach = r;
    assert.equal(r.first.inc.length, 1, `breaches: ${JSON.stringify(r.first.inc)}`); assert.equal(r.first.inc[0].breaching, 'player');
    assert.equal(r.first.cap.state, 'breach');
    assert.match(r.first.ui.text, /in breach since day \d+/);
    await shotFleet('CG-3-dmz-breach-after-grace.png', '[data-captain-dmz]');
    await shotSection('CG-3-dmz-breach-access-debug.png', '[data-treaty-section]');
    const r2 = await ev(() => {
      const t = testBM1, S = window.__S();
      window.__adv(10);
      const later = window.__stationing();
      window.__place(S.O); window.__adv(1);
      return { later, cap: window.__cap(), inc: window.__stationing(), war: t.campaign().warStates?.['klingon:player']?.status };
    });
    evidence.breach2 = r2;
    assert.equal(r2.later.length, 1, 'a breach a day');
    assert.equal(r2.cap.state, 'withdrawn_late'); assert.equal(r2.inc[0].state, 'resolved'); assert.equal(r2.war, 'ceasefire');
  });

  // 4 ---------------------------------------------------------------------------------------------
  await check('new-feature', 'CG-4 STAGING a Klingon staging right at Oce Nu: back there and stopped, his presence is "staged", the line reads "Staging permitted under treaty at Oce Nu", no Leave button, and well past the grace no breach is recorded', async () => {
    const r = await ev(() => {
      const t = testBM1, S = window.__S();
      const id = window.__term({ type: 'basing', host: 'klingon', guest: 'player', systems: [S.N], purposes: ['staging'] });
      const n0 = window.__stationing().length;
      window.__place(S.N); window.__adv(1);
      const first = { cap: window.__cap(), ui: window.__fleetText('[data-captain-dmz]'), access: t.captainAccessLine(S.N) };
      window.__adv(20);
      return { id, n0, first, cap: window.__cap(), n: window.__stationing().length };
    });
    evidence.staging = r;
    assert.equal(r.first.cap?.state, 'staged'); assert.equal(r.first.cap.presence, 'staged'); assert.equal(r.first.cap.termId, r.id);
    assert.equal(r.first.ui?.text, 'Staging permitted under treaty at Oce Nu'); assert.equal(r.first.ui.leave, false);
    assert.equal(r.n, r.n0, 'a staged ship breached');
    assert.equal(r.cap.state, 'staged');
    await shotFleet('CG-4-staging-right-exception.png', '[data-captain-dmz]');
  });

  // 5–6 -------------------------------------------------------------------------------------------
  await check('new-feature', 'CG-5 FOREIGN REPAIR docked at Oce Nu under the ceasefire with his hull at 50%: no treaty — repair refused; a docking right alone — "Docking permitted. Repair not authorized." and the hull unchanged; a repair right too — repaired and paid for; the Klingon shipyard\'s stock, sale status, owners and Oce Nu\'s holder unchanged throughout (each service answered on its own, by the term that grants it; the outcomes here already held on 1f2da30 — its defect, an enemy yard serving him, is CG-6)', async () => {
    await fresh('cg-5'); await setup();
    const r = await ev(() => {
      const t = testBM1, s = t.state, S = window.__S();
      window.__quiet(); window.__ceasefire();
      window.__place(S.N); window.__dock(S.N);
      s.latinum = 500000;
      const logs = []; const keep = (v) => logs.push(v);
      const snapWorld = () => JSON.stringify({ holder: t.getSystemControl(S.N).polityId, owners: (s.stationDefinitions || []).filter((d) => Number(d.systemIndex) === S.N).map((d) => [d.id, t.getStationOwner(d)]), own: t.isOwnHoldingVendor(null, S.N), sale: Object.values(s.shipStatsById).filter((x) => x && x.assetType === 'ship' && t.getShipFaction(x.id) === 'klingon').slice(0, 6).map((x) => t.getShipPurchaseStatus(x.id)?.ok ?? null) });
      const w0 = snapWorld();
      const attempt = () => { s.hull = 50; const lat = s.latinum; t.repairHull(); keep(t.state.lastLog || document.getElementById('log')?.textContent || ''); return { hull: s.hull, paid: lat - s.latinum, acc: t.playerServiceAccess?.('repair', S.N) ?? null }; };
      const none = attempt();
      const dockId = window.__term({ type: 'basing', host: 'klingon', guest: 'player', systems: [S.N], purposes: ['docking'] });
      const dockOnly = attempt();
      const dockLine = t.captainAccessLine?.(S.N) ?? null;
      const repId = window.__term({ type: 'basing', host: 'klingon', guest: 'player', systems: [S.N, S.Q], purposes: ['repair', 'recovery'] });
      const both = attempt();
      const bothLine = t.captainAccessLine?.(S.N) ?? null;
      return { S, none, dockOnly, both, dockLine, bothLine, dockId, repId, worldSame: snapWorld() === w0, w0, w1: snapWorld(), logs };
    });
    evidence.foreignRepair = r;
    assert.equal(r.none.hull, 50, 'repaired at a foreign yard with no treaty');
    assert.equal(r.dockOnly.hull, 50, 'a docking right repaired him');
    assert.ok(r.both.hull > 50, `not repaired under docking and repair rights: ${JSON.stringify(r.both)}`);
    assert.ok(r.none.acc && r.dockOnly.acc, 'no per-service access answer for the captain');
    assert.equal(r.none.acc.ok, false); assert.equal(r.dockOnly.acc.ok, false);
    assert.match(r.dockLine, /Docking permitted\. Repair not authorized\./);
    assert.ok(r.both.hull > 50, `not repaired under a repair right: ${JSON.stringify(r.both)}`); assert.ok(r.both.paid > 0);
    assert.equal(r.both.acc.basis, 'treaty'); assert.equal(r.both.acc.termId, r.repId);
    assert.match(r.bothLine, /Docking permitted\. Repair permitted\./);
    assert.ok(r.worldSame, `basing changed ownership, stock or sales: ${r.w0} → ${r.w1}`);
  });
  await ev(() => { window.__fleetAccess = () => { testBM1.renderFleetManager(true); }; });
  await shotFleet('CG-5-foreign-authorized-repair.png', '[data-captain-access]');
  await check('baseline-defect', 'CG-6 REFUSAL the ceasefire collapses: at the same Klingon yard, with the same basing terms on the books, repair is refused — "Repair refused: enemy yard." — and the hull is unchanged; the same yard is no tow destination for his fleet either (1f2da30 repaired him at an enemy yard under a repair right and sent tows to any yard not at war)', async () => {
    const r = await ev(() => {
      const t = testBM1, s = t.state, S = window.__S();
      const rel = window.__resumeWar();
      s.hull = 50;
      const lat = s.latinum;
      t.repairHull();
      const acc = t.playerServiceAccess?.('repair', S.N) ?? { ok: null, reason: 'no per-service access answer' };
      const serves = t.buildCampaignWorld(true).playerYardServes?.(S.Q) ?? null; // the Klingon yard at Qonos, under the same repair and recovery terms
      return { rel, hull: s.hull, paid: lat - s.latinum, acc, line: (acc.ok ? '' : (acc.reason || '')), serves };
    });
    evidence.refusal = r;
    assert.equal(r.rel, 'war');
    assert.equal(r.hull, 50, 'repaired at an enemy yard'); assert.equal(r.paid, 0);
    assert.equal(r.acc.ok, false); assert.match(r.acc.reason, /Enemy yard/);
    assert.equal(r.serves, false);
    const line = await ev(() => { const t = testBM1, S = window.__S(); return t.captainAccessLine(S.N); });
    assert.equal(line, 'Enemy yard: no service. Repair refused.');
    await ev(() => { testBM1.state.hull = 50; testBM1.repairHull(); });
    await shotFleet('CG-6-foreign-repair-refusal.png', '[data-captain-access]');
  });

  // 7 ---------------------------------------------------------------------------------------------
  await check('new-feature', 'CG-7 TOW-YARD under the ceasefire: with no treaty the Klingon shipyard at Qonos is no tow destination for his fleet; a repair and recovery right there makes it one (the yard would serve her); his own yards always are (the engine\'s half of the tow-yard test; the model\'s defect — a basing right taken before the war was asked about — is reproduced by the pure R12/R29)', async () => {
    await fresh('cg-7'); await setup();
    const r = await ev(() => {
      const t = testBM1, S = window.__S();
      window.__quiet(); window.__ceasefire();
      const before = t.buildCampaignWorld(true).playerYardServes?.(S.Q) ?? null;
      window.__term({ type: 'basing', host: 'klingon', guest: 'player', systems: [S.Q], purposes: ['repair', 'recovery'] });
      const after = t.buildCampaignWorld(true).playerYardServes?.(S.Q) ?? null;
      const ownYard = t.buildCampaignWorld(true).systems.filter((x) => x.controller === 'player').map((x) => x.index).find((i) => t.systemRepairStation(i));
      const own = ownYard == null ? null : t.buildCampaignWorld(true).playerYardServes?.(ownYard) ?? null;
      return { before, after, own, ownYard, station: t.systemRepairStation(S.Q)?.name || null };
    });
    evidence.towYard = r;
    assert.ok(r.station, 'precondition: Qonos has a repair yard');
    assert.equal(r.before, false, 'an unauthorized foreign yard accepts his tows');
    assert.equal(r.after, true);
  });

  // 8 ---------------------------------------------------------------------------------------------
  await check('preservation', 'CG-8 PROVENANCE every basing purpose at Oce Nu leaves its yard Klingon: not his own vendor, the same owner, the same holder, the same purchase answers for Klingon designs and no Klingon design among his production designs', async () => {
    const r = await ev(() => {
      const t = testBM1, s = t.state, S = window.__S();
      window.__dock(S.N);
      const snap = () => JSON.stringify({ holder: t.systemHolderPolity(S.N), own: t.isOwnHoldingVendor(null, S.N), owners: (s.stationDefinitions || []).filter((d) => Number(d.systemIndex) === S.N).map((d) => t.getStationOwner(d)), sale: Object.values(s.shipStatsById).filter((x) => x && x.assetType === 'ship' && t.getShipFaction(x.id) === 'klingon').slice(0, 8).map((x) => [x.id, t.getShipPurchaseStatus(x.id)?.ok ?? null, t.isGeneralProductionDesign?.(x.id) ?? null]) });
      const before = snap();
      window.__term({ type: 'basing', host: 'klingon', guest: 'player', systems: [S.N], purposes: ['docking', 'staging', 'resupply'] });
      return { same: snap() === before, before, after: snap() };
    });
    evidence.provenance = r;
    assert.ok(r.same, `${r.before} → ${r.after}`);
  });

  // 9 ---------------------------------------------------------------------------------------------
  await check('baseline-defect', 'CG-9 WORLD-JOBS a world\'s posted job keeps its courier flag, its posting day and its hazards across a save and reload (1f2da30 dropped all three and re-dated every posting to the day of the reload)', async () => {
    await fresh('cg-9'); await setup();
    const r = await ev(() => {
      const t = testBM1, s = t.state, S = window.__S();
      s.day = 30;
      const jobs = t.worldOpenJobs(S.E);
      if (!jobs.length) return { fail: 'no jobs posted at Earth' };
      const j = jobs[0];
      j.courier = true; j.createdDay = 21; j.hazards = ['pirates'];
      const pick = (x) => ({ id: x.id, courier: Boolean(x.courier), createdDay: x.createdDay ?? null, hazards: x.hazards || [] });
      const before = pick(j);
      t.saveGame(4); t.loadGame(4);
      const after = (s.worldJobs?.[S.E]?.jobs || []).find((x) => x.id === before.id);
      return { before, after: after ? pick(after) : null };
    });
    evidence.worldJobs = r;
    assert.ok(!r.fail, r.fail);
    assert.deepEqual(r.after, r.before);
  });

  // 10 --------------------------------------------------------------------------------------------
  await check('new-feature', 'CG-10 TRADER-RECORD-CONSOLIDATION a trading freighter plans a multi-leg circuit: her record is the one trade/1 shape (vid, origin → destination, path, leg, trip, cargo/contracts, risk) and her leg in flight names the trip; saved and reloaded mid-leg it is unchanged; a blockade ahead is run through the same engine under her key; the same record, vid and trip carry her on — no legacy record beside it', async () => {
    await fresh('cg-10'); await setup();
    const r = await ev(() => {
      const t = testBM1, s = t.state, S = window.__S();
      window.__quiet();
      s.latinum = 100000; s.day = 10;
      for (let i = 0; i < s.planets.length; i++) { t.markSystemVisited(i); const cp = s.currentPlanet; s.currentPlanet = i; t.recordMarketObservation?.(i); s.currentPlanet = cp; }
      const ships = Object.values(s.shipStatsById).filter((x) => x && x.assetType === 'ship' && Number(x.cargoCapacity) > 0).sort((a, b) => Number(b.cargoCapacity) - Number(a.cargoCapacity));
      // A home port from which the planner finds a circuit of two legs or more (the planner's own choice of cargo).
      let f = null, home = null;
      for (const h of [S.E, window.__idx('Alpha Centauri'), window.__idx('Lik Prime'), S.O]) {
        if (!Number.isFinite(h)) continue;
        s.currentPlanet = h; t.applySystemState(h);
        const x = { id: `cg-trader-${h}`, shipId: Number(ships[Math.floor(ships.length / 2)].id), name: 'Merchantman Cleanup', faction: s.playerFaction, assignment: 'defense', systemIndex: h, seed: 3 };
        s.playerFleet.push(x); t.autoAssignFleet(x);
        const tr = t.ensureFleetTradeState(x, 'any');
        const pl = t.planFleetTradeCircuit(x, tr, s.day);
        if (pl.ok && pl.plan.path.length >= 3 && pl.plan.manifest.some((m) => m.jobId)) { t.beginFleetTradeCircuit(x, tr, pl.plan, s.day); tr.active = true; f = x; home = h; break; }
        s.playerFleet = s.playerFleet.filter((y) => y !== x);
      }
      if (!f) return { fail: 'no multi-leg circuit planned from any home port' };
      const keys = Object.keys(f).sort();
      const rec0 = JSON.parse(JSON.stringify({ trade: f.trade, transit: f.transit }));
      // A blockade on a system still ahead of her: the first one past her first leg that a Klingon blockade can hold.
      let ahead = null;
      const book = t.campaign(); t.syncPlayerPolity(book);
      const hulls = book.polities.klingon.hulls.filter((h) => h.status === 'ready' && !h.opId).slice(0, 6);
      let b = null; const tried = [];
      for (const cand of f.trade.path.slice(1)) {
        for (const h of hulls) h.systemIndex = cand;
        const eff = [];
        b = t.Campaign.startBlockade(book, t.buildCampaignWorld(true), { power: 'klingon', target: cand, hullIds: hulls.map((h) => h.id), purpose: 'interdict_trade' }, s.day, eff);
        tried.push([cand, b.ok || b.reason]);
        if (b.ok) { t.applyCampaignEffects(eff, s.day); ahead = cand; break; }
      }
      // Saved and reloaded mid-leg.
      t.saveGame(5); t.loadGame(5);
      const g = s.playerFleet.find((x) => x.id === f.id);
      const rec1 = JSON.parse(JSON.stringify({ trade: g.trade, transit: g.transit }));
      const vid0 = g.trade.vid, trip0 = g.trade.tripId;
      const seen = [];
      let blk = null;
      for (let d = 0; d < 80; d++) {
        window.__adv(1);
        const h = s.playerFleet.find((x) => x.id === f.id);
        if (!h || h.destroyed) break;
        seen.push({ day: s.day, stage: h.trade.stage, trip: h.trade.tripId, leg: h.transit ? [h.transit.kind, h.transit.tripId, h.transit.leg] : null, at: h.systemIndex, vid: h.trade.vid, note: h.trade.note || '' });
        blk = (t.campaign().blockades || []).find((x) => x.id === b?.record?.id);
        if (h.trade.tripId !== trip0) break;
      }
      const end = s.playerFleet.find((x) => x.id === f.id);
      const runs = (blk?.runs || []).filter((x) => String(x.by).startsWith(`${f.id}:`)).map((x) => [x.kind, x.outcome, x.by]);
      const legacy = ['tradeRun', 'tradeRoute', 'cargoRun', 'route'].filter((k) => end && k in end);
      const dups = s.playerFleet.filter((x) => x.id === f.id).length;
      return { home, ahead, tried, path: rec0.trade.path, rec0, rec1, same: JSON.stringify(rec0) === JSON.stringify(rec1), keys, blockade: b?.ok ? true : JSON.stringify(tried), runs, seen: seen.slice(0, 40), endTrade: end ? { schema: end.trade.schema, vid: end.trade.vid, stage: end.trade.stage, trip: end.trade.tripId, note: end.trade.note } : null, vid0, trip0, legacy, dups };
    });
    evidence.trader = r;
    assert.ok(!r.fail, r.fail);
    const tr = r.rec0.trade;
    assert.equal(tr.schema, 'trade/1'); assert.ok(tr.vid); assert.equal(tr.destination, tr.stops[tr.stops.length - 1]);
    assert.equal(r.rec0.transit?.kind, 'trade'); assert.equal(r.rec0.transit.tripId, tr.tripId); assert.equal(r.rec0.transit.leg, tr.legIndex);
    assert.ok(Array.isArray(tr.manifest) && tr.manifest.length, 'no cargo');
    assert.ok(r.same, 'the record changed across save/load mid-leg');
    assert.equal(r.blockade, true, `precondition: the blockade did not form: ${r.blockade}`);
    assert.ok(r.seen.every((x) => x.vid === r.vid0), 'her vid changed');
    assert.ok(r.seen.filter((x) => x.leg).every((x) => x.leg[0] === 'trade'), 'a leg not tagged as trade');
    const sawBlockade = r.runs.length > 0 || r.seen.some((x) => /blockade/i.test(x.note));
    assert.ok(sawBlockade, `she never met the blockade at ${r.ahead}: ${JSON.stringify(r.seen.slice(0, 12))}`);
    assert.ok(r.runs.every((x) => x[0] === 'trade'));
    assert.equal(r.endTrade.vid, r.vid0); assert.equal(r.endTrade.schema, 'trade/1');
    assert.ok(r.seen.some((x) => x.trip !== r.trip0), `the circuit never completed: ${JSON.stringify(r.seen.slice(-3))}`);
    assert.deepEqual(r.legacy, []); assert.equal(r.dups, 1);
  });
  await shotSection('CG-10-trader-canonical-record-debug.png', '[data-trade-section]');

  // 11 --------------------------------------------------------------------------------------------
  await check('new-feature', 'CG-11 ACCESS-DEBUG the treaty debug view lists each service on its own for the captain: party, system, vessel, class, transit, docking, staging, repair, presence, deadline, breach and the term that granted or denied it', async () => {
    await fresh('cg-11'); await setup();
    const r = await ev(() => {
      const t = testBM1, S = window.__S();
      window.__quiet(); window.__ceasefire();
      window.__term({ type: 'dmz', parties: ['player', 'klingon'], systems: [S.N] });
      window.__term({ type: 'transit', grantor: 'klingon', beneficiary: 'player', systems: [S.N], traffic: ['military'] });
      window.__term({ type: 'basing', host: 'klingon', guest: 'player', systems: [S.N], purposes: ['docking'] });
      window.__place(S.N); window.__adv(1);
      const html = t.renderTreatyDebug();
      const div = document.createElement('div'); div.innerHTML = html;
      const head = [...div.querySelectorAll('[data-treaty-access-table] th')].map((x) => x.textContent.trim());
      const row = div.querySelector('[data-treaty-access-row^="player"]');
      const cells = row ? [...row.querySelectorAll('td')].map((x) => x.textContent.trim()) : null;
      return { head, cells };
    });
    evidence.accessDebug = r;
    assert.deepEqual(r.head, ['Party', 'System', 'Vessel', 'Class', 'Transit', 'Docking', 'Staging', 'Repair', 'Presence', 'Deadline', 'Breach', 'Term']);
    assert.ok(r.cells, 'no row for the captain');
    assert.match(r.cells[4], /permitted \(treaty\)/); assert.match(r.cells[5], /permitted \(treaty\)/);
    assert.match(r.cells[6], /stationing|prohibited|DMZ/i); assert.match(r.cells[7], /not authorized/);
    assert.equal(r.cells[8], 'loitering'); assert.match(r.cells[9], /day \d+/);
    await shotSection('CG-11-access-debug.png', '[data-treaty-section]');
  });

  // 12 --------------------------------------------------------------------------------------------
  await check('new-feature', 'CG-12 DISABLED-CAPTAIN his own ship disabled inside the DMZ at Oce Nu, waiting for recovery: he is listed as stranded, never in breach, however long the grace has run', async () => {
    await fresh('cg-12'); await setup();
    const r = await ev(() => {
      const t = testBM1, S = window.__S();
      window.__quiet(); window.__ceasefire();
      window.__term({ type: 'dmz', parties: ['player', 'klingon'], systems: [S.N] });
      window.__place(S.N);
      t.fleetBook().personalCondition = 'disabled';
      window.__adv(30);
      return { cap: window.__cap(), inc: window.__stationing() };
    });
    evidence.disabledCaptain = r;
    assert.equal(r.cap?.state, 'stranded', JSON.stringify(r.cap)); assert.equal(r.inc.length, 0);
  });

  // 13 --------------------------------------------------------------------------------------------
  await check('new-feature', 'CG-13 SEPARATE-RIGHTS a resupply right at Oce Nu does not take him past its closed checkpoint (the transporter channel refuses, as docking does); every station whose role repairs is a repair facility to him, not only those named shipyard, starbase or maintenance', async () => {
    await fresh('cg-13'); await setup();
    const r = await ev(() => {
      const t = testBM1, s = t.state, S = window.__S();
      window.__quiet(); window.__ceasefire();
      window.__place(S.N);
      window.__term({ type: 'basing', host: 'klingon', guest: 'player', systems: [S.N], purposes: ['resupply'] });
      const block = t.playerDockingBlock(S.N, t.getCurrentServiceStation());
      const am0 = s.antimatter; s.antimatter = 10;
      const conn = t.requireServiceConnection('resupply');
      s.antimatter = am0;
      const roles = (s.stationDefinitions || []).filter((d) => t.stationRepairs(d) && !/shipyard|starbase|maintenance/i.test(t.getShipStats(d.stationTypeId)?.name || ''));
      const refused = roles.filter((d) => /No repair facility/.test(t.playerServiceAccess('repair', Number(d.systemIndex), { station: d }).reason || '')).map((d) => d.id);
      return { block, conn, roles: roles.length, refused };
    });
    evidence.separate = r;
    assert.ok(r.block, 'precondition: Oce Nu checkpoint is closed to him');
    assert.equal(r.conn, false, 'a resupply right took him past the checkpoint');
    assert.ok(r.roles > 0, 'precondition: no station repairs by role alone');
    assert.deepEqual(r.refused, []);
  });

  const failed = results.filter((x) => !x.ok);
  const by = (c) => `${c} ${results.filter((x) => x.category === c && x.ok).length}/${results.filter((x) => x.category === c).length}`;
  console.log(`architecture cleanup in-game: ${results.length - failed.length}/${results.length} (${['baseline-defect', 'new-feature', 'preservation'].map(by).join(', ')})`);
  fs.writeFileSync(path.join(out, 'cleanup-gate.json'), JSON.stringify({ results, evidence, shots, errors: probe.errors.slice(0, 10) }, null, 1));
  if (probe.errors.length) console.log('page errors:', probe.errors.slice(0, 5));
  await probe.close();
  process.exit(failed.length || probe.errors.length ? 1 : 0);
})();
