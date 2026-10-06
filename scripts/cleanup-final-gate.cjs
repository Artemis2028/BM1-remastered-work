// In-game gate for ARCHITECTURE-CLEANUP-FINAL on the real chart. Two corrections:
//  §1 a docking right grants docking only: not the market, ship sales, refits, production, repair or resupply —
//     each keeps its own ordinary rule or treaty permission (Vulcan: a checkpoint that wants clearance, a vendor
//     that would serve him; Andoria: an open port);
//  §2 the captain's fleet traders (trade/1) meet the treaties as every other mover does: routes their class may
//     lawfully fly, the one crossing engine for inspections, a re-plot or a hold at a boundary — never a teleport,
//     never a lost contract.
// Categories: baseline-defect (79bc258 gets it wrong, failing on its own assertion), new-feature, preservation.
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
  async function shotFleet(file, selector) {
    await ev((sel) => { const t = testBM1; t.closeGalaxyReports?.(); t.renderFleetManager(true); const el = document.querySelector(sel); el?.scrollIntoView({ block: 'center' }); }, selector);
    await page.waitForTimeout(150);
    await page.screenshot({ path: path.join(out, file) }); shots.push(file);
    await ev(() => document.querySelectorAll('dialog[open]').forEach((d) => d.close()));
  }
  async function shotSection(file, selector) {
    await ev(() => testBM1.closeGalaxyReports?.());
    const ok = await ev((sel) => { const d = document.getElementById('cheats-debug'); if (!d.open) testBM1.openDebugMenu(); if (!document.querySelector(sel)) return false; for (const x of d.querySelectorAll('section')) if (!x.matches(sel)) x.style.display = 'none'; d.style.maxHeight = 'none'; d.style.height = 'auto'; d.style.width = '1360px'; d.style.maxWidth = 'none'; d.style.overflow = 'visible'; d.style.position = 'absolute'; d.style.top = '0'; return true; }, selector);
    if (ok) {
      const h = await ev((sel) => Math.ceil(document.querySelector(sel).getBoundingClientRect().bottom + window.scrollY + 40), selector);
      await page.setViewportSize({ width: 1400, height: Math.min(7000, Math.max(900, h)) });
      await page.locator(selector).screenshot({ path: path.join(out, file) }); shots.push(file);
      await page.setViewportSize({ width: 1400, height: 900 });
    }
    await ev(() => { const d = document.getElementById('cheats-debug'); for (const x of d.querySelectorAll('section')) x.style.display = ''; d.removeAttribute('style'); d.close(); testBM1.closeGalaxyReports?.();
      const c = testBM1.playtestClock; if (c.stoppedAt !== null) { c.offset += performance.now() - c.stoppedAt; c.stoppedAt = null; } });
    return ok;
  }
  await page.waitForFunction(() => !testBM1.doctrineStatus || testBM1.doctrineStatus().state !== 'loading', null, { timeout: 30000 }).catch(() => {});
  const setup = () => page.evaluate(() => {
    const t = testBM1;
    window.__idx = (name) => t.getSystemIndexByName(name);
    window.__adv = (n) => { for (let i = 0; i < n; i++) t.advanceFleetCalendar(1, t.Fleet.nextId(t.fleetBook(), 'journey')); };
    window.__quiet = () => { const db = t.DoctrineCampaign.doctrineBook(t.campaign()); db.config = { ...db.config, patrols: {}, explorers: {}, merchants: {}, projects: {}, patrolAreas: {}, militaryResponses: false, enforcementResponses: false }; t.campaign().config.aiStrategicOps = false; t.campaign().config.aiRecovery = false; };
    window.__term = (spec) => { const book = t.campaign(); t.syncPlayerPolity(book); const eff = []; const r = t.Campaign.addTreatyTerm(book, t.buildCampaignWorld(true), spec, t.state.day, eff); t.applyCampaignEffects(eff, t.state.day); if (!r.ok) throw new Error(r.reason); return r.term.id; };
    window.__endTerm = (id) => { const book = t.campaign(); const eff = []; t.Campaign.endTreatyTerm(book, t.buildCampaignWorld(true), id, t.state.day, 'gate', eff); t.applyCampaignEffects(eff, t.state.day); };
    window.__place = (sys) => { for (let i = 0; i < t.state.planets.length; i++) t.markSystemVisited(i); t.state.currentPlanet = sys; t.state.myplanet = sys + 1; t.state.docked = false; t.applySystemState(sys); t.placePlayerAtSecurityApproach?.(); t.state.hull = 100; };
    window.__dock = (sys) => { const s = t.state; window.__place(sys); s.docked = true; s.dockedStationId = null; s.dockedPlanetIndex = sys; if (s.systemPlanet) t.setCamera(s.systemPlanet.x, s.systemPlanet.y); }; // at the world's own dock
    window.__ship = (id, at, shipId, name) => { const rec = { id, shipId: Number(shipId), name: name || id, systemIndex: at, assignment: 'defense', destroyed: false }; t.ensureFleetVesselSnapshot(rec); t.state.playerFleet.push(rec); return rec; };
    // A fleet vessel of his here, on the scene (a sale, a refit and an equipment transfer are judged on her).
    window.__localShip = (id, at) => { const rec = window.__ship(id, at, 9, id); t.state.npcShips.push(...t.getPlayerFleetNpcShips().filter((n) => n.fleetId === rec.id)); const a = t.fleetLocalActor(rec.id); if (a) { t.ensureNpcCombatStats(a); t.setCamera(a.x, a.y); if (a.power) a.power.combat = false; a.lastShieldHitAt = 0; } return { rec, a }; };
    // Market: one unit bought from the first slot (what the market screen's buy does).
    window.__buy = () => { const s = t.state; const lat = s.latinum; const pods = JSON.stringify(s.cargoPods || s.cargo || null); s.log = ''; t.buyMarketGood(0); return { bought: s.latinum < lat || JSON.stringify(s.cargoPods || s.cargo || null) !== pods, log: s.log }; };
    window.__traders = () => { const s = t.state; s.latinum = 200000; for (let i = 0; i < s.planets.length; i++) { t.markSystemVisited(i); const cp = s.currentPlanet; s.currentPlanet = i; t.recordMarketObservation?.(i); s.currentPlanet = cp; } };
    // A trader of his at `at`, on the circuit the planner gives her there (one circuit: she holds when it ends).
    window.__trader = (id, shipId, at) => {
      const s = t.state;
      s.currentPlanet = at; t.applySystemState(at);
      const f = { id, shipId: Number(shipId), name: id, faction: s.playerFaction, assignment: 'defense', systemIndex: at, seed: 3 };
      s.playerFleet.push(f); t.autoAssignFleet(f);
      const tr = t.ensureFleetTradeState(f, 'any');
      const pl = t.planFleetTradeCircuit(f, tr, s.day);
      if (!pl.ok) return { fail: pl.note };
      t.beginFleetTradeCircuit(f, tr, pl.plan, s.day);
      tr.active = false;
      return { id, path: tr.path.slice(), stops: tr.stops.slice(), tripId: tr.tripId, vid: tr.vid, legTo: f.transit?.to };
    };
    window.__f = (id) => t.state.playerFleet.find((x) => x.id === id);
    window.__rec = (id) => { const f = window.__f(id); return f ? JSON.parse(JSON.stringify({ trade: f.trade, transit: f.transit || null, at: f.systemIndex })) : null; };
    // Fly her day by day until her circuit ends (or `days` pass), noting where she stood and what she crossed.
    window.__fly = (id, days, stopWhen = null) => { const trail = []; for (let d = 0; d < days; d++) { window.__adv(1); const f = window.__f(id); const tr = f.trade; trail.push({ day: t.state.day, at: Number(f.systemIndex), to: f.transit?.to ?? null, stage: tr.stage, hold: tr.treatyHold ? { ...tr.treatyHold } : null, trip: tr.tripId, legIndex: tr.legIndex }); if (stopWhen && stopWhen(f)) break; if (!f.transit && tr.stage === 'holding') break; } return trail; };
    window.__crossed = (trail) => [...new Set(trail.filter((x) => x.to == null).map((x) => x.at))];
    window.__holder = (i) => t.buildCampaignWorld(true).systems[i]?.controller;
  });
  await setup();

  // =================================================================================================
  // §1 Docking grants docking only
  // =================================================================================================
  const dockSetup = async (seed) => { await fresh(seed); await setup(); return ev(() => { const t = testBM1, s = t.state; window.__quiet(); const V = window.__idx('Vulcan'), A = window.__idx('Andoria'); window.__dock(V); s.latinum = 500000; return { V, A, rel: t.campaignPartyRelation?.('player', 'vulcan') ?? null, block: t.getSecurityDockingBlock(), vendor: t.vendorRefusal(null, t.getSystemFaction(V)) }; }); };

  await check('preservation', 'D-1 DOCKING Vulcan\'s checkpoint wants clearance before he may dock; a Vulcan docking right is what lets him past it — docking permitted', async () => {
    const S = await dockSetup('cf-d1');
    const r = await ev((S) => { const t = testBM1; const before = t.playerDockingBlock(S.V, null); window.__term({ type: 'basing', host: 'vulcan', guest: 'player', systems: [S.V], purposes: ['docking'] }); return { before, after: t.playerDockingBlock(S.V, null) }; }, S);
    evidence.d1 = { S, ...r };
    assert.ok(S.block, 'precondition: Vulcan\'s checkpoint wants clearance'); assert.equal(S.vendor, null, 'precondition: the Vulcan vendor would serve him');
    assert.ok(r.before, 'docked past the checkpoint with no right'); assert.equal(r.after, null);
  });
  await check('preservation', 'D-2 MARKET docked at Vulcan under the docking right alone, the market stays shut — nothing bought', async () => {
    const r = await ev(() => window.__buy());
    evidence.d2 = r;
    assert.equal(r.bought, false, 'the market sold to him under a docking right');
    // (the refusal's wording — "Docking permitted. Market not authorized." — is this round's; checked in D-7)
  });
  await check('baseline-defect', 'D-3/4 SALES-REFIT under the docking right alone, his fleet vessel at Vulcan can be neither sold nor refitted (79bc258: the docking right lifted the checkpoint for every docked service the vendor would give)', async () => {
    const r = await ev(() => { const t = testBM1, S = { V: window.__idx('Vulcan') }; const { rec, a } = window.__localShip('cf-ship', S.V); const allowed = t.fleetServiceAllowed(a, true); const n0 = t.state.playerFleet.filter((f) => !f.destroyed).length; const lat0 = t.state.latinum; const sold = t.sellFleetVessel(rec.id); return { allowed, sold: Boolean(sold), lat: t.state.latinum - lat0, kept: t.state.playerFleet.filter((f) => !f.destroyed).length === n0, purchase: t.requireServiceConnection(null, 'Ship sales'), log: t.state.log }; });
    evidence.d34 = r;
    assert.equal(r.allowed, false, 'a refit, sale or equipment transfer was allowed under a docking right');
    assert.equal(r.sold, false); assert.ok(r.kept); assert.equal(r.lat, 0);
    assert.equal(r.purchase, false, 'ship purchases opened under a docking right');
  });
  await check('preservation', 'D-5 PRODUCTION no basing right — docking, repair, staging, resupply all granted at Vulcan — opens production there: the access record says refused and a build order is refused', async () => {
    const r = await ev(() => { const t = testBM1, V = window.__idx('Vulcan'); window.__term({ type: 'basing', host: 'vulcan', guest: 'player', systems: [V], purposes: ['repair', 'staging', 'resupply'] }); const a = t.Campaign.accessAt(t.campaign(), t.buildCampaignWorld(true), 'player', V, 'military', t.state.day); const ship = Object.values(t.state.shipStatsById).find((x) => x && x.assetType === 'ship' && t.getShipFaction(x.id) === 'vulcan'); return { production: a.production, market: a.market || null, build: ship ? t.orderFleetBuild(ship.id, false) : null }; });
    evidence.d5 = r;
    assert.equal(r.production.ok, false); assert.equal(r.build, false);
  });
  await check('baseline-defect', 'D-7 REPAIR a docking right alone does not repair him at Vulcan, however willing the vendor (79bc258 did: the open vendor\'s repair rode through the checkpoint the docking right lifted); a repair right beside it does — and the market stays shut', async () => {
    await dockSetup('cf-d7');
    const r = await ev(() => { const t = testBM1, s = t.state, V = window.__idx('Vulcan');
      window.__term({ type: 'basing', host: 'vulcan', guest: 'player', systems: [V], purposes: ['docking'] });
      s.hull = 50; s.log = ''; t.repairHull(); const dockOnly = { hull: s.hull, log: s.log, line: t.captainAccessLine(V) };
      window.__term({ type: 'basing', host: 'vulcan', guest: 'player', systems: [V], purposes: ['repair'] });
      s.hull = 50; t.repairHull(); const withRepair = { hull: s.hull, line: t.captainAccessLine(V) };
      const market = window.__buy();
      return { dockOnly, withRepair, market }; });
    evidence.d7 = r;
    assert.equal(r.dockOnly.hull, 50, `repaired under a docking right alone: ${JSON.stringify(r.dockOnly)}`);
    assert.match(r.dockOnly.log, /Docking permitted\. Repair not authorized\./);
    assert.ok(r.withRepair.hull > 50, 'a repair right did not repair him');
    assert.equal(r.market.bought, false); assert.match(r.market.log, /Docking permitted\. Market not authorized\./);
    assert.match(r.withRepair.line || '', /Docking permitted\. Repair permitted\..*Market not authorized\./);
  });
  await ev(() => { const t = testBM1; t.state.log = ''; window.__buy(); });
  await shotFleet('CF-1-docking-without-market.png', '[data-captain-access]');
  await check('preservation', 'D-6/8 OPEN-MARKET at Andoria, an open port, the market serves him while docked with a docking right on the books, and still does once the docking term ends — a docking right neither makes nor takes away ordinary commerce', async () => {
    await dockSetup('cf-d6');
    const r = await ev(() => { const t = testBM1, A = window.__idx('Andoria'); window.__dock(A);
      const id = window.__term({ type: 'basing', host: 'andorian', guest: 'player', systems: [A], purposes: ['docking'] });
      const withDock = window.__buy();
      window.__endTerm(id);
      const without = window.__buy();
      return { block: t.getSecurityDockingBlock(), withDock, without }; });
    evidence.d68 = r;
    assert.equal(r.block, null, 'precondition: Andoria is an open port');
    assert.equal(r.withDock.bought, true, `the open market refused him while a docking right stood: ${r.withDock.log}`);
    assert.equal(r.without.bought, true, `ending the docking right closed the open market: ${r.without.log}`);
  });
  await check('preservation', 'D-9 CHECKPOINT-OWNER (audit finding) the checkpoint is the system authority\'s: a private vendor inside Vulcan\'s perimeter is behind the same clearance as Vulcan\'s own; no station in a foreign perimeter belongs to him at the start of a campaign (getSecurityDockingBlock\'s unused owner argument changes nothing reachable — documented, not a defect)', async () => {
    const r = await ev(() => { const t = testBM1, s = t.state, V = window.__idx('Vulcan'); window.__place(V);
      const defs = (s.stationDefinitions || []).filter((d) => Number(d.systemIndex) === V);
      const byOwner = defs.map((d) => [d.name, t.getStationOwner(d), Boolean(t.getSecurityDockingBlock(t.getStationOwner(d)))]);
      const own = [];
      for (let i = 0; i < s.planets.length; i++) { const z = (i === Number(s.currentPlanet)) ? t.getSecurityZone(i) : null; void z; }
      for (const d of s.stationDefinitions || []) { const ctl = t.getSystemControl(Number(d.systemIndex)); if (!ctl.playerControlled && t.getStationOwner(d) === 'player') own.push(d.name); }
      return { byOwner, own }; });
    evidence.d9 = r;
    assert.ok(r.byOwner.length > 1, 'precondition: more than one station at Vulcan');
    assert.ok(r.byOwner.every((x) => x[2] === r.byOwner[0][2]), `the checkpoint answered differently by owner: ${JSON.stringify(r.byOwner)}`);
    assert.deepEqual(r.own, []);
  });

  // =================================================================================================
  // §2 Fleet traders under treaty
  // =================================================================================================
  const CIV = 215, MIL = 236; // Tarellian Freighter (unarmed: civilian) · Salcombe class (an armed freighter: military)
  // One fresh campaign per scenario, same seed: the planner gives the same circuit from Earth every time.
  const traderSetup = async (seed, shipId) => { await fresh(seed); await setup(); return ev(({ shipId }) => { const t = testBM1; window.__quiet(); window.__traders(); const E = window.__idx('Earth'); const r = window.__trader('cf-trader', shipId, E); return { ...r, cls: t.shipTrafficClass?.(shipId) ?? null, names: (r.path || []).map((i) => t.state.planets[i]?.name) }; }, { shipId }); };

  await check('preservation', 'T-1 CIVILIAN-DMZ an unarmed freighter (civilian) on a circuit from Earth; a DMZ that bars military transit begins on the second system ahead of her: she flies straight through it, no re-plot, no hold', async () => {
    const S = await traderSetup('cf-t1', CIV);
    assert.ok(!S.fail, S.fail); assert.ok(S.path.length >= 3, `precondition: a circuit of three legs or more (${S.path})`);
    const X = S.path[1];
    const r = await ev(({ X }) => { const t = testBM1; window.__term({ type: 'dmz', parties: ['player', window.__holder(X)], systems: [X] }); const trail = window.__fly('cf-trader', 60, (f) => f.trade.tripId !== null && !f.transit && f.trade.stage === 'holding'); const f = window.__f('cf-trader'); return { trail: trail.slice(0, 30), crossed: f.trade.crossed, reroutes: f.trade.treatyReroutes || 0, holds: trail.filter((x) => x.hold).length }; }, { X });
    evidence.t1 = { S, X, ...r };
    assert.equal(S.cls ?? 'civilian', 'civilian');
    assert.ok(r.crossed.includes(X) || r.trail.some((x) => x.at === X), `she did not cross the DMZ at ${X}: ${JSON.stringify(r.trail.slice(0, 8))}`);
    assert.equal(r.reroutes, 0); assert.equal(r.holds, 0);
  });
  await check('baseline-defect', 'T-2 MILITARY-DMZ an armed freighter (military) on the same circuit; the same DMZ begins ahead of her: at the next boundary her route is re-plotted round it (or she holds), she never enters it, her record, vid, trip and cargo unchanged (79bc258 flew traders straight through every DMZ)', async () => {
    const S = await traderSetup('cf-t2', MIL);
    assert.ok(!S.fail, S.fail); assert.ok(S.path.length >= 3);
    const X = S.path[1];
    const r = await ev(({ X }) => { const t = testBM1; const f0 = window.__f('cf-trader'); const manifest0 = JSON.stringify(f0.trade.manifest.map((m) => [m.kind, m.goods, m.tons, m.to, m.jobId ?? null]));
      window.__term({ type: 'dmz', parties: ['player', window.__holder(X)], systems: [X] });
      const trail = window.__fly('cf-trader', 50, (f) => f.trade.treatyHold != null || (f.trade.treatyReroutes || 0) > 0);
      const f = window.__f('cf-trader');
      return { trail, visited: trail.map((x) => x.at), crossed: f.trade.crossed, path: f.trade.path, legIndex: f.trade.legIndex, reroutes: f.trade.treatyReroutes || 0, hold: f.trade.treatyHold, trip: f.trade.tripId, vid: f.trade.vid, schema: f.trade.schema, manifestSame: JSON.stringify(f.trade.manifest.map((m) => [m.kind, m.goods, m.tons, m.to, m.jobId ?? null])) === manifest0, note: f.trade.note, line: t.fleetTradeStatusLine(f) }; }, { X });
    evidence.t2 = { S, X, ...r };
    assert.equal(S.cls ?? 'military', 'military');
    assert.ok(!r.visited.includes(X) && !r.crossed.includes(X), `the military freighter entered the DMZ at ${X}: ${JSON.stringify(r.trail.slice(0, 10))}`);
    assert.ok(r.reroutes > 0 || r.hold, 'neither re-plotted nor held');
    if (r.reroutes) assert.ok(!r.path.slice(r.legIndex).includes(X), `the re-plotted route still runs through ${X}: ${r.path}`);
    assert.equal(r.trip, S.tripId); assert.equal(r.vid, S.vid); assert.equal(r.schema, 'trade/1'); assert.ok(r.manifestSame, 'the cargo or contracts changed');
  });
  await shotSection('CF-2-trader-rerouted-round-DMZ-debug.png', '[data-trade-section]');
  await check('new-feature', 'T-3/4 GUARANTEE the same armed freighter and DMZ, with a transit guarantee from the DMZ\'s other party to his empire for military traffic there: she flies through it. An unrelated guarantee — to the Vulcans, or to him at another system — does not', async () => {
    const S = await traderSetup('cf-t3', MIL);
    const X = S.path[1], Y = S.path[S.path.length - 1];
    const r = await ev(({ X }) => { const h = window.__holder(X); window.__term({ type: 'dmz', parties: ['player', h], systems: [X] }); window.__term({ type: 'transit', grantor: h, beneficiary: 'player', systems: [X], traffic: ['military'] }); const trail = window.__fly('cf-trader', 30, (f) => f.trade.legIndex >= 2); const f = window.__f('cf-trader'); return { visited: trail.map((x) => x.at), crossed: f.trade.crossed, reroutes: f.trade.treatyReroutes || 0 }; }, { X });
    const S2 = await traderSetup('cf-t3', MIL);
    const r2 = await ev(({ X, Y }) => { const h = window.__holder(X); window.__term({ type: 'dmz', parties: ['player', h], systems: [X] }); window.__term({ type: 'transit', grantor: h, beneficiary: 'vulcan', systems: [X], traffic: ['military'] }); window.__term({ type: 'transit', grantor: h, beneficiary: 'player', systems: [Y], traffic: ['military'] }); const trail = window.__fly('cf-trader', 50, (f) => f.trade.treatyHold != null || (f.trade.treatyReroutes || 0) > 0); const f = window.__f('cf-trader'); return { visited: trail.map((x) => x.at), crossed: f.trade.crossed, reroutes: f.trade.treatyReroutes || 0, hold: f.trade.treatyHold }; }, { X: S2.path[1], Y });
    evidence.t34 = { X, covered: r, unrelated: r2 };
    assert.ok(r.crossed.includes(X) || r.visited.includes(X), `the covered guarantee did not let her through ${X}`);
    assert.equal(r.reroutes, 0);
    assert.ok(!r2.visited.includes(X) && !r2.crossed.includes(X), 'an unrelated guarantee let her through');
    assert.ok(r2.reroutes > 0 || r2.hold);
  });
  await check('baseline-defect', 'T-5/6/7 INSPECTION an inspection regime on the system ahead (its holder inspects his civilian freighters, reveals the manifest): she is inspected there with her canonical cargo lines — every declared line, cargo and quantity, not an empty hold — and the one line marked concealed is not seen; her contracts stay on her record (79bc258 never inspected a trader)', async () => {
    const S = await traderSetup('cf-t5', CIV);
    const X = S.path[1];
    const r = await ev(({ X }) => { const t = testBM1; const h = window.__holder(X);
      window.__term({ type: 'inspection', inspector: h, inspected: 'player', systems: [X], traffic: ['civilian'], hullCategories: ['freighter'], reveals: ['manifest'] });
      const f = window.__f('cf-trader');
      f.trade.manifest.push({ kind: 'goods', goods: 'Contraband Spice', tons: 3, to: f.trade.destination, paid: 0, concealed: true });
      const declared = (t.tradeCargoLines ? t.tradeCargoLines(f.trade.manifest) : []).filter((m) => !m.concealed).map((m) => ({ cargoId: m.cargoId, quantity: m.quantity }));
      const jobs0 = f.trade.manifest.map((m) => m.jobId).filter(Boolean);
      window.__fly('cf-trader', 40, (g) => g.trade.lastInspection != null);
      const insp = (t.campaign().treatyInspections || []).filter((x) => x.inspected === 'player' && x.systemIndex === X);
      const g = window.__f('cf-trader');
      return { declared, insp: insp.map((x) => ({ state: x.state, observed: x.observed, vids: x.vids })), last: g.trade.lastInspection || null, jobs: g.trade.manifest.map((m) => m.jobId).filter(Boolean), jobs0, vid: g.trade.vid }; }, { X });
    evidence.t567 = { X, ...r };
    assert.equal(r.insp.length, 1, `inspections at ${X}: ${JSON.stringify(r.insp)}`);
    assert.equal(r.insp[0].state, 'completed');
    assert.ok(r.declared.length >= 1, 'precondition: she carries declared cargo');
    assert.deepEqual(r.insp[0].observed.manifest, r.declared, 'the inspection did not see her canonical manifest');
    assert.ok(!JSON.stringify(r.insp[0].observed).includes('Contraband Spice'), 'concealed cargo was revealed');
    assert.deepEqual(r.insp[0].vids, [r.vid]);
    assert.deepEqual(r.jobs.filter((j) => r.jobs0.includes(j)), r.jobs, 'contracts changed');
  });
  await shotSection('CF-3-trader-inspected-treaty-debug.png', '[data-trade-section]');
  await check('new-feature', 'T-8/9 HOLD-SAVE-LOAD the armed freighter\'s last call is inside a DMZ that begins while she is under way: with no lawful way on she holds at the boundary — the same record (trade/1, vid, trip, cargo, contracts), nothing deleted; saved and reloaded while holding, the record is unchanged and not duplicated; when the DMZ ends she sails on and completes the same circuit', async () => {
    const S = await traderSetup('cf-t8', MIL);
    const last = S.stops[S.stops.length - 1];
    const r0 = await ev(({ last }) => { const t = testBM1;
      const id = window.__term({ type: 'dmz', parties: ['player', window.__holder(last)], systems: [last] });
      window.__fly('cf-trader', 120, (f) => f.trade.treatyHold != null);
      const before = window.__rec('cf-trader');
      t.saveGame(6); t.loadGame(6);
      const after = window.__rec('cf-trader');
      return { id, before, same: JSON.stringify(before) === JSON.stringify(after), copies: t.state.playerFleet.filter((x) => x.id === 'cf-trader').length, line: t.fleetTradeStatusLine(window.__f('cf-trader')) }; }, { last });
    // While she holds: her fleet row and her record, as the captain and the debug view see them.
    await shotFleet('CF-4-trader-held-no-lawful-route-fleet.png', '[data-fleet-id="cf-trader"]');
    await shotSection('CF-5-trader-held-no-lawful-route-debug.png', '[data-trade-section]');
    const r1 = await ev(({ id, last }) => { const t = testBM1;
      window.__adv(3);
      const stillHold = window.__f('cf-trader').trade.treatyHold != null;
      window.__endTerm(id);
      const trail = window.__fly('cf-trader', 120);
      const f = window.__f('cf-trader');
      return { stillHold, end: { stage: f.trade.stage, trip: f.trade.tripId, vid: f.trade.vid, crossed: f.trade.crossed, hold: f.trade.treatyHold }, reachedLast: trail.some((x) => x.at === last), keys: Object.keys(f).sort() }; }, { id: r0.id, last });
    const r = { ...r0, ...r1 };
    evidence.t89 = { S, last, ...r };
    assert.ok(r.before?.trade?.treatyHold, `she never held: ${JSON.stringify(r.before?.trade?.note)}`);
    assert.equal(r.before.transit, null, 'holding in warp');
    assert.equal(r.before.trade.tripId, S.tripId); assert.equal(r.before.trade.vid, S.vid); assert.equal(r.before.trade.schema, 'trade/1');
    assert.ok(r.before.trade.manifest.length > 0, 'cargo lost while holding');
    assert.ok(r.same, 'the held record changed across save/load'); assert.equal(r.copies, 1);
    assert.match(r.line, /Holding at .* no lawful route to .* under treaty/);
    assert.ok(r.stillHold, 'she left the hold with the DMZ still in force');
    assert.ok(r.reachedLast, 'she never reached her last call after the DMZ ended');
    assert.equal(r.end.vid, S.vid); assert.equal(r.end.hold, null);
    assert.ok(!r.keys.some((k) => ['tradeRun', 'tradeRoute', 'cargoRun', 'route'].includes(k)), `legacy record beside trade/1: ${r.keys}`);
  });
  await check('new-feature', 'T-12 HOLD-EDGES while an armed freighter holds for want of a lawful way: disabled where she holds, she books no leg when the DMZ ends; a rendezvous order given during a hold takes her out of it as an ordinary passage', async () => {
    const S = await traderSetup('cf-t12', MIL);
    const last = S.stops[S.stops.length - 1];
    const hold = async () => ev(({ last }) => { const id = window.__term({ type: 'dmz', parties: ['player', window.__holder(last)], systems: [last] }); window.__fly('cf-trader', 120, (f) => f.trade.treatyHold != null); return id; }, { last });
    const dmz1 = await hold();
    const a = await ev(({ dmz1 }) => { const t = testBM1, f = window.__f('cf-trader'); const held = Boolean(f.trade.treatyHold);
      f.vessel = { ...(f.vessel || {}), hull: 1, condition: 'disabled' }; const ac = t.fleetLocalActor(f.id); if (ac) { ac.combatHull = 1; ac.condition = 'disabled'; }
      window.__endTerm(dmz1); window.__adv(2);
      return { held, condition: t.fleetVesselCondition(f), transit: f.transit || null, hold: f.trade.treatyHold, stage: f.trade.stage, line: t.fleetTradeStatusLine(f) }; }, { dmz1 });
    const S2 = await traderSetup('cf-t12', MIL);
    await hold();
    const b = await ev(() => { const t = testBM1, f = window.__f('cf-trader'); const held = Boolean(f.trade.treatyHold); const E = window.__idx('Earth');
      t.orderFleetRendezvous('cf-trader', E); window.__adv(1);
      return { held, stage: f.trade.stage, hold: f.trade.treatyHold, order: f.trade.order?.kind || null, to: f.transit?.to ?? null }; });
    evidence.t12 = { a, b, last, S2: S2.path };
    assert.ok(a.held, 'precondition: she held');
    assert.notEqual(a.condition, 'operational', 'precondition: disabled');
    assert.equal(a.transit, null, `a disabled hull booked a leg: ${JSON.stringify(a.transit)}`);
    assert.ok(b.held, 'precondition: she held');
    assert.equal(b.hold, null, 'the order did not take her out of the hold'); assert.equal(b.stage, 'passage');
  });
  await check('preservation', 'T-10/11 BLOCKADE-AND-TREATY a Klingon blockade and an inspection regime on the same system ahead of a civilian freighter: the blockade resolver runs her once under her key; through it, the inspection asks her once (turned back, never); one fleet entry, one trade/1 record', async () => {
    const S = await traderSetup('cf-t10', CIV);
    const X = S.path[1];
    const r = await ev(({ X }) => { const t = testBM1; const book = t.campaign(); t.syncPlayerPolity(book);
      const hulls = book.polities.klingon.hulls.filter((h) => h.status === 'ready' && !h.opId).slice(0, 4); for (const h of hulls) h.systemIndex = X;
      const eff = []; const b = t.Campaign.startBlockade(book, t.buildCampaignWorld(true), { power: 'klingon', target: X, hullIds: hulls.map((h) => h.id), purpose: 'interdict_trade' }, t.state.day, eff); t.applyCampaignEffects(eff, t.state.day);
      window.__term({ type: 'inspection', inspector: window.__holder(X), inspected: 'player', systems: [X], traffic: ['civilian'], hullCategories: ['freighter'], reveals: ['manifest'] });
      window.__fly('cf-trader', 40, (g) => g.trade.crossed.includes(X) && !g.transit);
      const blk = (t.campaign().blockades || []).find((x) => x.id === b.record?.id);
      const runs = (blk?.runs || []).filter((x) => String(x.by).startsWith('cf-trader:'));
      const insp = (t.campaign().treatyInspections || []).filter((x) => x.inspected === 'player' && x.systemIndex === X);
      return { ok: b.ok, reason: b.reason || null, runs: runs.map((x) => [x.kind, x.outcome, x.by]), insp: insp.length, copies: t.state.playerFleet.filter((x) => x.id === 'cf-trader').length, schema: window.__f('cf-trader')?.trade?.schema }; }, { X });
    evidence.t1011 = { X, ...r };
    assert.ok(r.ok, `precondition: blockade at ${X}: ${r.reason}`);
    assert.equal(r.runs.length, 1, `blockade runs: ${JSON.stringify(r.runs)}`); assert.equal(r.runs[0][0], 'trade');
    // Through the blockade, she meets the inspection once; turned back by it, she never reaches the inspection point.
    const through = !/forced_back|turned|captured|destroyed|disabled/.test(r.runs[0][1]);
    assert.equal(r.insp, through ? 1 : 0, `run ${r.runs[0][1]}, inspections ${r.insp}`);
    assert.equal(r.copies, 1); assert.equal(r.schema, 'trade/1');
  });

  const failed = results.filter((x) => !x.ok);
  const by = (c) => `${c} ${results.filter((x) => x.category === c && x.ok).length}/${results.filter((x) => x.category === c).length}`;
  console.log(`architecture cleanup final in-game: ${results.length - failed.length}/${results.length} (${['baseline-defect', 'new-feature', 'preservation'].map(by).join(', ')})`);
  fs.writeFileSync(path.join(out, 'cleanup-final-gate.json'), JSON.stringify({ results, evidence, shots, errors: probe.errors.slice(0, 10) }, null, 1));
  if (probe.errors.length) console.log('page errors:', probe.errors.slice(0, 5));
  await probe.close();
  process.exit(failed.length || probe.errors.length ? 1 : 0);
})();
