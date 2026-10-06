// In-game gate for TREATY-EXPANSION (docs/diplomacy/TREATY-EXPANSION.md). The real engine, the real chart: a
// ceasefire with Klingon settled with a DMZ at Oce Nu; the captain's formation is refused a route into it, routed
// round it, and — sent through in defiance — warned at Oce Nu and turned back; a Klingon transit guarantee opens
// it; his freighters heave to for inspection there and only the declared hold is seen; a Klingon yard refuses his
// damaged ship until basing rights let it repair her (nothing changes hands); tribute and reparations move his
// real latinum on their days, a miss is arrears and a breach; a secret term between two other powers is never
// shown; the debug view shows everything. No war is declared by any of it. Screenshots of each.
// Categories:
//   baseline-defect  d5b50b5 carries no treaty terms (a settlement's DMZ is not even recorded)
//   new-feature      needs this round's terms, crossings, basing, ledger, UI or debug
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
    return ok;
  }
  // The Empire panel's Wars & treaties tab, as the captain opens it.
  async function shotTreaties(file, selector = '[data-war-treaties]') {
    await ev(() => { testBM1.closeGalaxyReports?.(); testBM1.openCampaignPanel('wars'); });
    await page.waitForTimeout(150);
    const ok = await ev((sel) => { const el = document.querySelector(sel); if (!el) return false; el.scrollIntoView({ block: 'start' }); return true; }, selector);
    if (ok) await page.locator(selector).first().screenshot({ path: path.join(out, file) });
    await ev(() => document.querySelectorAll('dialog[open]').forEach((d) => d.close()));
    return ok;
  }
  async function shotFleet(file, selector) {
    await ev((sel) => { const t = testBM1; t.renderFleetManager(true); const el = document.querySelector(sel); const d = el?.closest('details'); if (d) d.open = true; el?.scrollIntoView({ block: 'center' }); }, selector);
    await page.waitForTimeout(150);
    await page.screenshot({ path: path.join(out, file) });
    await ev(() => document.querySelectorAll('dialog[open]').forEach((d) => d.close()));
  }
  await page.waitForFunction(() => !testBM1.doctrineStatus || testBM1.doctrineStatus().state !== 'loading', null, { timeout: 30000 }).catch(() => {});
  const hasTreaty = await ev(() => typeof testBM1.Campaign.addTreatyTerm === 'function');
  const setup = () => page.evaluate(() => {
    const t = testBM1;
    window.__adv = (n) => { for (let i = 0; i < n; i++) t.advanceFleetCalendar(1, t.Fleet.nextId(t.fleetBook(), 'journey')); };
    window.__idx = (name) => t.getSystemIndexByName(name);
    window.__quiet = () => { const db = t.DoctrineCampaign.doctrineBook(t.campaign()); db.config = { ...db.config, patrols: {}, explorers: {}, merchants: {}, projects: {}, patrolAreas: {} }; t.campaign().config.aiStrategicOps = false; t.campaign().config.aiRecovery = false; };
    window.__term = (spec) => { const book = t.campaign(); t.syncPlayerPolity(book); const eff = []; const r = t.Campaign.addTreatyTerm(book, t.buildCampaignWorld(true), spec, t.state.day, eff); t.applyCampaignEffects(eff, t.state.day); if (!r.ok) throw new Error(r.reason); return r.term.id; };
    window.__ship = (id, at, shipId, name) => { const rec = { id, shipId: Number(shipId), name: name || id, systemIndex: at, assignment: 'defense', destroyed: false }; t.ensureFleetVesselSnapshot(rec); t.state.playerFleet.push(rec); return rec; };
    window.__formation = (name, at, shipIds) => { const b = t.fleetBook(); const g = t.Fleet.addFormation(b, name); shipIds.forEach((sid, k) => { const r = window.__ship(`${name}-${k}`, at, sid, `${name} ${k + 1}`); t.Fleet.assignFormation(b, r.id, g.id); }); return g.id; };
    window.__g = (id) => t.fleetBook().formations.find((g) => g.id === id);
    window.__at = (id) => window.__g(id).members.map((m) => t.state.playerFleet.find((f) => f.id === m)).filter(Boolean).map((f) => [Number(f.systemIndex), f.transit ? Number(f.transit.to) : null]);
    // The treaty's own pair (the empire and Klingon): AI wars elsewhere go on evolving and are not this gate's business.
    window.__warSnap = () => JSON.stringify(Object.values(t.campaign().warStates || {}).filter((s) => s.key === 'klingon:player').map((s) => [s.key, s.status === 'war' ? 'war' : 'not-war', s.instance]));
    window.__warsDeclared = () => (t.galaxyNewsBook().items || []).filter((r) => /^diplomacy:declared:/.test(String(r.id)) && String(r.id).includes('klingon') && String(r.id).includes('player')).length;
    // A warship class and a freighter class from the real catalogue.
    const ships = Object.values(t.state.shipStatsById).filter((s) => s && s.assetType === 'ship');
    window.__WAR = 4;
    window.__FREIGHTER = Number((ships.find((s) => t.Speed.speedCategory(s) === 'freighter' && t.getShipFaction(s.id) === 'terran') || ships.find((s) => t.Speed.speedCategory(s) === 'freighter')).id);
  });
  const lastLog = () => ev(() => (testBM1.conditionLog?.(0) || []).slice(-6).map((x) => x.text || x).join(' | '));

  // 1 ---------------------------------------------------------------------------------------------
  await check('baseline-defect', 'DMZ-SETTLEMENT the war with Klingon ends in a ceasefire settled with "add DMZ systems Oce Nu": the term is in force, the captain\'s Wars & Treaties shows "DMZ — Military transit prohibited", and his formation at Orion is refused a dispatch into Oce Nu', async () => {
    await fresh('tx-settle');
    await setup();
    const r = await ev((has) => {
      const t = testBM1, s = t.state;
      window.__quiet();
      const O = window.__idx('Orion'), N = window.__idx('Oce Nu');
      t.markSystemVisited(N); t.markSystemVisited(window.__idx('Narendra'));
      s.currentPlanet = O; t.applySystemState(O); // the captain is with his formations at Orion (orders need no relay)
      const before = window.__warsDeclared();
      const book = t.campaign(); t.syncPlayerPolity(book);
      const eff = t.Campaign.forceWarTransition(book, t.buildCampaignWorld(true), 'player', 'klingon', 'ceasefire', s.day, 'the border war is exhausted', 'directed', { treaty: ['add DMZ systems Oce Nu'] });
      t.applyCampaignEffects(eff, s.day);
      const gid = window.__formation('Task Force', O, [window.__WAR, window.__WAR]);
      window.__g(gid).destination = N;
      const ok = t.dispatchFleetFormation(gid);
      t.renderFleetManager(true);
      return { has, terms: (book.treatyTerms || []).map((x) => [x.type, x.systems, x.status]), ok, note: window.__g(gid).treatyNote || null, fleetLine: document.querySelector(`[data-formation-treaty="${gid}"]`)?.textContent || null, rel: book.warStates?.['klingon:player']?.status, declared: window.__warsDeclared() - before, gid, N, O };
    }, hasTreaty);
    evidence.settlement = r;
    assert.deepEqual(r.terms, [['dmz', [r.N], 'active']], `the settlement carries no DMZ: ${JSON.stringify(r.terms)}`);
    assert.equal(r.ok, false);
    assert.match(r.note || '', /DMZ — Military transit prohibited/);
    assert.equal(r.declared, 0);
    await shotTreaties('TX-1-wars-and-treaties-dmz.png');
    await shotFleet('TX-1-dmz-dispatch-refused.png', `[data-formation-treaty="${r.gid}"]`);
  });

  // 2 ---------------------------------------------------------------------------------------------
  await check('new-feature', 'DMZ-WARNING-COMPLIANCE sent through Oce Nu toward Narendra in defiance, the formation is warned there by Klingon (who holds it) and complies — turned back to Orion; a second, refusing, is a recorded breach; no war is declared and the ceasefire stands', async () => {
    const r = await ev(() => {
      const t = testBM1, s = t.state;
      const O = window.__idx('Orion'), N = window.__idx('Oce Nu'), R = window.__idx('Narendra');
      const before = window.__warsDeclared(), snap = window.__warSnap();
      const gid = window.__formation('Raiders', O, [window.__WAR, window.__WAR]);
      const g = window.__g(gid); g.destination = R; g.treatyResponse = 'comply';
      const route = t.getPlottedRoute(O, R)?.systems || [];
      const lawful = t.playerLawfulRoute(O, R)?.systems || null;
      const ok = t.triggerTreatyDebug(['defy', gid]);
      const path0 = g.travel?.path?.slice() || [];
      window.__adv(40);
      const book = t.campaign();
      const inc = (book.treatyIncidents || []).filter((x) => x.kind === 'dmz_entry');
      const gid2 = window.__formation('Raiders II', O, [window.__WAR]);
      const g2 = window.__g(gid2); g2.destination = R; g2.treatyResponse = 'refuse';
      t.triggerTreatyDebug(['defy', gid2]);
      window.__adv(40);
      const inc2 = (book.treatyIncidents || []).filter((x) => x.kind === 'dmz_entry');
      return { route, lawful, ok, path0, at: window.__at(gid), at2: window.__at(gid2), first: inc[0] ? { state: inc[0].state, responses: inc[0].responses.map((x) => x.state), knownTo: inc[0].knownTo } : null,
        second: inc2[1] ? { state: inc2[1].state, knownTo: inc2[1].knownTo } : null, stationing: (book.treatyIncidents || []).filter((x) => x.kind === 'dmz_stationing').length, line: t.formationTravelLine(window.__g(gid)), declared: window.__warsDeclared() - before, snapSame: window.__warSnap() === snap, rel: book.warStates?.['klingon:player']?.status, O, N, R, gid };
    });
    evidence.dmzWarning = r;
    assert.ok(r.route.includes(r.N), `precondition: the chart route to Narendra passes Oce Nu (${r.route})`);
    assert.ok(r.path0.includes(r.N));
    assert.ok(r.first, 'no warning at Oce Nu');
    assert.deepEqual(r.first.responses, ['warned', 'complied']);
    assert.ok(r.first.knownTo.includes('klingon') && r.first.knownTo.includes('player'));
    assert.ok(r.at.every(([sys, tr]) => sys === r.O && tr == null), `the warned formation is not back at Orion: ${JSON.stringify(r.at)}`);
    assert.ok(r.second && r.second.state === 'breach', 'the refusing formation was not recorded as a breach');
    assert.match(r.line, /DMZ warning/);
    assert.equal(r.stationing, 0, 'a formation turned back out of the zone (in warp home) was recorded as stationed in it');
    assert.equal(r.declared, 0); assert.ok(r.snapSame, 'a war state changed');
    assert.notEqual(r.rel, 'war');
    await shotTreaties('TX-2-dmz-warning-compliance.png');
    await shotFleet('TX-2-dmz-warning-fleet.png', `[data-formation-travel="${r.gid}"]`);
  });

  // 3 ---------------------------------------------------------------------------------------------
  await check('new-feature', 'TRANSIT-GUARANTEE Klingon guarantees the empire transit through Oce Nu: the lawful route to Narendra now passes it, the dispatch succeeds without defiance, the fleet manager shows "Transit guaranteed under treaty", and the formation crosses Oce Nu with no incident', async () => {
    const r = await ev(() => {
      const t = testBM1;
      const O = window.__idx('Orion'), N = window.__idx('Oce Nu'), R = window.__idx('Narendra');
      const id = window.__term({ type: 'transit', grantor: 'klingon', beneficiary: 'player', systems: [N] });
      const nIncidents = (t.campaign().treatyIncidents || []).length;
      const gid = window.__formation('Envoy', O, [window.__WAR]);
      const g = window.__g(gid); g.destination = R;
      const ok = t.dispatchFleetFormation(gid);
      t.renderFleetManager(true);
      const line = document.querySelector(`[data-formation-treaty="${gid}"]`)?.textContent || '';
      const path = g.travel?.path?.slice() || [];
      return { id, ok, path, line, nIncidents, N, R, gid };
    });
    await shotFleet('TX-3-transit-guarantee-fleet.png', `[data-formation-treaty="${r.gid}"]`);
    const r2 = await ev((gid) => { window.__adv(30); return { at: window.__at(gid), incidents: (testBM1.campaign().treatyIncidents || []).length }; }, r.gid);
    evidence.transit = { ...r, ...r2 };
    assert.equal(r.ok, true); assert.ok(r.path.includes(r.N));
    assert.match(r.line, /Transit guaranteed under treaty/);
    assert.equal(r2.incidents - r.nIncidents, 0);
    assert.ok(r2.at.every(([sys, tr]) => sys === r.R && tr == null), `the guaranteed formation did not reach Narendra: ${JSON.stringify(r2.at)}`);
    await shotTreaties('TX-3-transit-guarantee-treaties.png');
  });

  // 4 ---------------------------------------------------------------------------------------------
  await check('new-feature', 'BASING-REPAIR at Oce Nu the Klingon yard refuses to repair the captain\'s damaged ship; basing rights for repair alone do not take him past the closed checkpoint (cleanup round); with docking rights too the same Repair hull now works, paid as any repair; Oce Nu, its stations\' owners and the shipyard sale status are unchanged', async () => {
    const r = await ev(() => {
      const t = testBM1, s = t.state;
      const N = window.__idx('Oce Nu');
      s.currentPlanet = N; t.applySystemState(N);
      const rec = window.__ship('Damaged Ship', N, window.__WAR, 'USS Repairable');
      s.npcShips.push(...t.getPlayerFleetNpcShips().filter((n) => n.fleetId === rec.id));
      const a = t.fleetLocalActor(rec.id);
      if (!a) return { fail: 'no actor' };
      t.ensureNpcCombatStats(a);
      a.combatHull = Math.round(a.maxCombatHull * 0.5);
      s.docked = true; s.dockedStationId = null; s.dockedPlanetIndex = N; t.setCamera(a.x, a.y); if (a.power) a.power.combat = false; a.lastShieldHitAt = 0;
      s.latinum = 500000;
      const owners = (s.stationDefinitions || []).filter((d) => Number(d.systemIndex) === N).map((d) => d.owner ?? d.faction ?? null);
      const before = { hull: a.combatHull, allowed: t.fleetServiceAllowed(a, true, 'repair'), refusal: t.vendorRefusal(null, t.getSystemFaction(N)) };
      const refused = t.repairFleetVessel(rec.id);
      const afterRefusal = a.combatHull;
      const id = window.__term({ type: 'basing', host: 'klingon', guest: 'player', systems: [N], purposes: ['repair', 'resupply'] });
      // ARCHITECTURE-CLEANUP: a repair right is the right to be repaired, not to dock past a closed checkpoint —
      // Oce Nu's is closed to him, so the docking right is a separate term.
      const repairOnly = t.fleetServiceAllowed(a, true, 'repair');
      const dockId = window.__term({ type: 'basing', host: 'klingon', guest: 'player', systems: [N], purposes: ['docking'] });
      const allowedNow = t.fleetServiceAllowed(a, true, 'repair');
      const saleAllowed = t.fleetServiceAllowed(a, true); // no service named: sales, refits — basing grants none of them
      const lat0 = s.latinum;
      const repaired = t.repairFleetVessel(rec.id);
      const owners2 = (s.stationDefinitions || []).filter((d) => Number(d.systemIndex) === N).map((d) => d.owner ?? d.faction ?? null);
      t.renderFleetManager(true);
      return { before, refused, afterRefusal, id, dockId, repairOnly, allowedNow, saleAllowed, repaired, hull: a.combatHull, max: a.maxCombatHull, paid: lat0 - s.latinum, controller: t.buildCampaignWorld(true).systems[N].controller, ownersSame: JSON.stringify(owners) === JSON.stringify(owners2), rec: rec.id };
    });
    evidence.basing = r;
    assert.ok(!r.fail, r.fail);
    assert.equal(r.refused, false, 'the Klingon yard repaired without basing rights');
    assert.equal(r.afterRefusal, r.before.hull);
    assert.equal(r.repairOnly, false, 'a repair right alone took him past a closed checkpoint (repair implied docking)');
    assert.equal(r.allowedNow, true); assert.equal(r.saleAllowed, false, 'basing opened sales and refits');
    assert.equal(r.repaired, true); assert.ok(r.hull > r.before.hull); assert.ok(r.paid > 0);
    assert.equal(r.controller, 'klingon'); assert.ok(r.ownersSame);
    await shotFleet('TX-4-basing-repair-fleet.png', `[data-fleet-id="${r.rec}"]`);
    await shotTreaties('TX-4-basing-rights-treaties.png');
  });

  // 5 ---------------------------------------------------------------------------------------------
  await check('new-feature', 'INSPECTION Klingon inspects the empire\'s military freighters at Oce Nu: the captain\'s freighter is asked to heave to (the request alone reveals nothing), complies, and the inspection sees only the declared hold — the concealed spice and the cargo\'s destination are never in it', async () => {
    const r = await ev(() => {
      const t = testBM1, s = t.state;
      const O = window.__idx('Orion'), N = window.__idx('Oce Nu'), R = window.__idx('Narendra');
      s.currentPlanet = O; s.docked = false; t.applySystemState(s.currentPlanet);
      window.__term({ type: 'inspection', inspector: 'klingon', inspected: 'player', systems: [N], traffic: ['military'], hullCategories: ['freighter'] });
      const gid = window.__formation('Convoy', O, [window.__FREIGHTER]);
      const f = t.state.playerFleet.find((x) => x.id === 'Convoy-0');
      const tr = t.ensureFleetTradeState(f);
      tr.manifest.push({ kind: 'goods', goods: 'weapons', tons: 5, to: R, paid: 900 }, { kind: 'goods', goods: 'spice', tons: 3, to: R, paid: 400, concealed: true });
      tr.active = false;
      const g = window.__g(gid); g.destination = R;
      const ok = t.dispatchFleetFormation(gid);
      t.renderFleetManager(true);
      const note = document.querySelector(`[data-formation-treaty="${gid}"]`)?.textContent || '';
      window.__adv(30);
      const x = (t.campaign().treatyInspections || []).slice(-1)[0];
      return { ok, note, freighter: window.__FREIGHTER, x, gid };
    });
    evidence.inspection = r;
    assert.equal(r.ok, true);
    assert.match(r.note, /Inspection required/);
    assert.ok(r.x, 'no inspection');
    assert.deepEqual(r.x.history.map((h) => h.state), ['requested', 'completed']);
    assert.deepEqual(r.x.observed, { manifest: [{ cargoId: 'weapons', quantity: 5 }] });
    await shotTreaties('TX-5-inspection-request-result.png');
  });

  // 6 ---------------------------------------------------------------------------------------------
  await check('new-feature', 'TRIBUTE-REPARATIONS Klingon pays the empire 5,000 L every 30 days; the empire owes 20,000 L of reparations over 4 payments every 10 days: the captain\'s real latinum moves on each due day, a payment he cannot make is arrears and a breach (not war), paying later clears it, and the reparations end', async () => {
    const r = await ev(() => {
      const t = testBM1, s = t.state;
      const book = t.campaign();
      const before = window.__warsDeclared(), snap = window.__warSnap();
      const trib = window.__term({ type: 'tribute', payer: 'klingon', recipient: 'player', amount: 5000, cadenceDays: 30 });
      const rep = window.__term({ type: 'reparations', payer: 'player', recipient: 'klingon', total: 20000, payments: 4, cadenceDays: 10 });
      s.latinum = 100000;
      const trace = [];
      const ledgerLen = () => (book.treatyLedger || []).length;
      for (let d = 0; d < 60; d++) {
        const l0 = s.latinum, n0 = ledgerLen();
        if (d === 15) s.latinum = 0; // the empire is broke when its second installment falls due
        if (d === 25) s.latinum = 60000;
        window.__adv(1);
        if (ledgerLen() > n0) trace.push({ day: s.day, entries: book.treatyLedger.slice(n0).map((e) => [e.type, e.status, e.amount, e.payer]) });
        void l0;
      }
      const R = book.treatyTerms.find((x) => x.id === rep), T = book.treatyTerms.find((x) => x.id === trib);
      return { trace, rep: { status: R.status, remaining: R.remaining, missed: R.missedCount, arrears: R.arrears }, trib: { paid: T.paidTotal }, incidents: (book.treatyIncidents || []).filter((x) => x.kind === 'payment_missed').map((x) => [x.breaching, x.state, x.knownTo]), declared: window.__warsDeclared() - before, snapSame: window.__warSnap() === snap };
    });
    evidence.ledger = r;
    assert.ok(r.trace.some((x) => x.entries.some((e) => e[0] === 'tribute' && e[1] === 'paid' && e[2] === 5000)), 'no tribute was paid');
    assert.ok(r.incidents.some(([who, st]) => who === 'player' && ['breach', 'resolved'].includes(st)), 'the missed installment was not a breach');
    assert.equal(r.rep.status, 'ended'); assert.equal(r.rep.remaining, 0); assert.equal(r.rep.missed, 1);
    assert.equal(r.declared, 0); assert.ok(r.snapSame);
    await shotTreaties('TX-6-tribute-reparations-ledger.png');
  });

  // 7 ---------------------------------------------------------------------------------------------
  await check('new-feature', 'SECRET-AND-DEBUG a secret Romulan–Klingon guarantee is never in the captain\'s Wars & Treaties, and the debug view shows every term, incident, inspection, payment and withdrawal (with "War: no" on every incident)', async () => {
    const r = await ev(() => {
      const t = testBM1;
      const id = window.__term({ type: 'transit', grantor: 'klingon', beneficiary: 'romulan', systems: [window.__idx('Narendra')], secret: true });
      t.openCampaignPanel('wars');
      const html = document.querySelector('[data-war-treaties]')?.innerHTML || '';
      document.querySelectorAll('dialog[open]').forEach((d) => d.close());
      const dbg = t.renderTreatyDebug();
      return { id, shown: html.includes(id), inDebug: dbg.includes(id.split(':').slice(-2).join(':')), warYes: />YES</.test(dbg) };
    });
    evidence.secret = r;
    assert.equal(r.shown, false, 'a secret term between two other powers was shown to the captain');
    assert.equal(r.inDebug, true); assert.equal(r.warYes, false);
    await shotSection('TX-7-treaty-breach-debug.png', '[data-treaty-section]');
  });

  // 8 ---------------------------------------------------------------------------------------------
  await check('new-feature', 'SAVE-LOAD a save and reload keeps every treaty term, incident, inspection and ledger entry exactly (ids, states, arrears, withdrawal records)', async () => {
    const r = await ev(() => {
      const t = testBM1;
      const pick = (b) => JSON.stringify({ terms: b.treatyTerms, incidents: b.treatyIncidents, inspections: b.treatyInspections, ledger: b.treatyLedger });
      const before = pick(t.campaign());
      t.saveGame(3); t.loadGame(3);
      return { same: pick(t.campaign()) === before, n: t.campaign().treatyTerms.length };
    });
    evidence.saveLoad = r;
    assert.ok(r.n >= 6); assert.equal(r.same, true);
  });

  const failed = results.filter((x) => !x.ok);
  const by = (c) => `${c} ${results.filter((x) => x.category === c && x.ok).length}/${results.filter((x) => x.category === c).length}`;
  console.log(`treaty expansion in-game: ${results.length - failed.length}/${results.length} (${['baseline-defect', 'new-feature', 'preservation'].map(by).join(', ')})`);
  fs.writeFileSync(path.join(out, 'treaty-expansion-gate.json'), JSON.stringify({ results, evidence, errors: probe.errors.slice(0, 10) }, null, 1));
  if (probe.errors.length) console.log('page errors:', probe.errors.slice(0, 5));
  await probe.close();
  process.exit(failed.length || probe.errors.length ? 1 : 0);
})();
