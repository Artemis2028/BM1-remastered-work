// In-game gate for STRATEGIC-TACTICAL-HANDOFF (docs/movement/STRATEGIC-TACTICAL-HANDOFF.md). The real engine
// and the default chart: the captain's own course leg by leg, a blockade interception fought in the loaded
// scene with the blockade's own ships, a war operation and a raid handed to the scene where the captain
// is, the pirates of these waters demanding from him (pay / refuse / run), the write-back of every fate
// onto the same persistent vessels, save/load around a handoff, the strategic fallback, one report per
// encounter, and the debug encounter record.
// Categories:
//   baseline-defect  c07826b resolves (or ignores) the contact abstractly while the captain is there, or charges his
//                    course by its whole distance rather than the legs he flies (fails on its own assertion)
//   new-feature      needs this round's encounter record and scene handoff
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
  // The canvas is drawn by the frame loop; the gate steps the game itself, so it draws the frame it shoots.
  const shot = async (name) => { const draw = () => ev(() => { testBM1.render(); testBM1.updateSecurityOrderPanel?.(); }); await draw(); await page.waitForTimeout(500); await draw(); return page.screenshot({ path: path.join(out, name) }); };
  async function shotSection(file, selector) {
    await ev(() => testBM1.closeGalaxyReports?.());
    await ev((sel) => { const d = document.getElementById('cheats-debug'); if (!d.open) testBM1.openDebugMenu(); for (const x of d.querySelectorAll('section')) if (!x.matches(sel)) x.style.display = 'none'; d.style.maxHeight = 'none'; d.style.height = 'auto'; d.style.width = '1360px'; d.style.maxWidth = 'none'; d.style.overflow = 'visible'; d.style.position = 'absolute'; d.style.top = '0'; }, selector);
    const h = await ev((sel) => Math.ceil(document.querySelector(sel).getBoundingClientRect().bottom + window.scrollY + 40), selector);
    await page.setViewportSize({ width: 1400, height: Math.min(7000, Math.max(900, h)) });
    await page.locator(selector).screenshot({ path: path.join(out, file) });
    await page.setViewportSize({ width: 1400, height: 900 });
    await ev(() => { const d = document.getElementById('cheats-debug'); for (const x of d.querySelectorAll('section')) x.style.display = ''; d.removeAttribute('style'); d.close();
      // The menu paused the game; a report left open would keep it paused. The scene resumes as the player would.
      testBM1.closeGalaxyReports?.(); const c = testBM1.playtestClock; if (c.stoppedAt !== null) { c.offset += performance.now() - c.stoppedAt; c.stoppedAt = null; } });
  }
  await page.waitForFunction(() => !testBM1.doctrineStatus || testBM1.doctrineStatus().state !== 'loading', null, { timeout: 30000 }).catch(() => {});
  const hasHandoff = await ev(() => typeof testBM1.Campaign.blockadeContact === 'function');

  const setup = () => page.evaluate(() => {
    const t = testBM1;
    window.__adv = (n) => { for (let i = 0; i < n; i++) t.advanceFleetCalendar(1, t.Fleet.nextId(t.fleetBook(), 'journey')); };
    window.__idx = (name) => t.getSystemIndexByName(name);
    window.__step = (n, fs = 2.5) => { for (let i = 0; i < n; i++) { t.playtestClock.offset -= fs * 16.6667; t.tick(fs); t.updateSecurityOrderPanel?.(); } };
    window.__seconds = (s) => window.__step(Math.ceil((s * 1000) / (2.5 * 16.6667)));
    window.__B = () => t.campaign();
    window.__W = () => t.buildCampaignWorld(true);
    window.__encs = () => (t.campaign().encounters || []);
    window.__enc = (type) => window.__encs().filter((e) => !type || e.type === type).slice(-1)[0] || null;
    window.__npcs = (id) => t.state.npcShips.filter((n) => n.encounterId === id);
    window.__vid = (h) => h?.identity?.vid || h?.vid || h?.id;
    window.__quiet = () => { const db = t.DoctrineCampaign.doctrineBook(t.campaign()); db.config = { ...db.config, patrols: {}, explorers: {}, merchants: {}, projects: {}, patrolAreas: {}, militaryResponses: false, enforcementResponses: false, hunts: {}, borg: {} }; /* hunts and Borg assimilation open encounters of their own: quiet like every other routine */ t.campaign().config.aiStrategicOps = false; };
    // The captain flies a whole plotted course the way the game does: departure, the briefing at mid-jump
    // (where the calendar is settled, leg by leg), arrival.
    window.__fly = (to) => {
      const plan = t.getPlottedRoute(t.state.currentPlanet, to);
      if (!plan) return { fail: 'no route' };
      t.state.antimatter = Math.max(t.state.antimatter, 999);
      const day0 = t.state.day;
      if (!t.beginWarpTravel(to, plan) && !t.state.warp.active) return { fail: 'warp refused' };
      t.openWarpBriefing?.(); t.closeGalaxyReports?.();
      t.completeWarpTravel();
      // The chart's legs at his course's strategic speed (SHIP-DEPENDENT-STRATEGIC-SPEED; chart days on a build without it).
      return { day0, day: t.state.day, at: t.state.currentPlanet, path: plan.systems, legDays: t.routeLegDays ? t.routeLegDays(plan, t.captainCourseSpeed ? t.captainCourseSpeed() : null) : null };
    };
    // A Klingon blockade of `at` (the captain's side is at war with the Klingons at the start).
    window.__blockade = (at, n) => {
      const book = t.campaign(); t.syncPlayerPolity(book);
      const kl = book.polities.klingon.hulls.filter((h) => h.status === 'ready' && !h.opId && !h.transit).slice(0, n);
      for (const h of kl) h.systemIndex = at;
      const fx = [];
      const r = t.Campaign.startBlockade(book, t.buildCampaignWorld(true), { power: 'klingon', target: at, hullIds: kl.map((h) => h.id), purpose: 'interdict_trade' }, t.state.day, fx);
      t.applyCampaignEffects(fx, t.state.day);
      return r.ok ? r.record.id : null;
    };
    window.__block = (id) => (t.campaign().blockades || []).find((b) => b.id === id);
    window.__place = (sys) => { t.markSystemVisited(sys); t.state.currentPlanet = sys; t.state.myplanet = sys + 1; t.applySystemState(sys); t.placePlayerAtSecurityApproach?.(); };
    // The captain holds his own (his hull is not what these checks measure): time passes in the scene with
    // his hull and shields kept up.
    window.__hold = (sec) => { for (let i = 0; i < sec; i++) { t.state.hull = 100; t.state.shields = 100; window.__seconds(1); } };
    window.__reset = () => { t.state.hull = 100; t.state.shields = 100; t.state.spawnProtectionUntil = 0; t.state.godMode = false; t.fleetBook().personalCondition = 'operational'; };
    // Paso → Alpha Centauri → Earth with Alpha Centauri blockaded, the seed searched until the captain's
    // crossing is actually intercepted (the strategic layer's own contact draw).
    window.__interceptScene = (seedTag, { hull = 100, blockadeN = 12 } = {}) => {
      const P = window.__idx('Paso'), AC = window.__idx('Alpha Centauri'), E = window.__idx('Earth');
      for (const i of [P, AC, E]) t.markSystemVisited(i);
      window.__quiet(); window.__place(P); window.__reset(); t.state.hull = hull;
      const bid = window.__blockade(AC, blockadeN);
      return { P, AC, E, bid };
    };
    // The scene closes on its own rule at the end of its window, with no simulated combat after the fixture's
    // last act: the clock is moved on (no tick runs, so nobody fires), and the engine's own per-frame encounter
    // step decides and writes back exactly as it does when the window runs out. No constant is assumed: the
    // clock moves a second at a time until the engine closes it.
    window.__closeAtWindow = (enc) => {
      for (let k = 0; k < 120 && t.Encounter.isLive(enc); k++) { t.playtestClock.offset -= 1000; t.updateStrategicEncounters(); }
      return enc.status;
    };
    // HANDOFF INVARIANTS: what must hold however the scene's own later fire treats a cripple — finished by the
    // world's station guns, or left adrift. One encounter for the captain's crossing, resolved once, never
    // settled by the strategic resolver beside it; every blockader's fate written onto its one persistent
    // record (the same vid), with the blockade's tallies agreeing with those fates.
    window.__handoffInvariants = (encId, roles = {}) => {
      const book = t.campaign();
      const enc = t.Encounter.encounterById(book, encId);
      const bl = window.__block(enc.objective.ref);
      const all = Object.values(book.polities).flatMap((p) => p.hulls || []);
      const byVid = (vid) => all.filter((h) => window.__vid(h) === vid);
      const events = enc.history.map((h) => h.event);
      const key = enc.contact?.runner?.key || null;
      const blockaders = enc.participants.filter((p) => p.side === 'blockader').map((p) => {
        const recs = byVid(p.vid);
        const own = (book.polities[p.polity]?.hulls || []).find((h) => String(h.id) === String(p.hullId)) || null;
        const rec = recs[0] || null;
        const npc = t.state.npcShips.find((n) => n.encounterId === enc.id && n.encounterRef === p.ref) || null;
        return { vid: p.vid, fate: p.fate, after: p.after?.hull ?? null, vidMismatch: p.vidMismatch || null, spawned: (enc.spawned || []).includes(p.vid),
          records: recs.length, ownIsSame: own ? own === rec : null,
          rec: rec && { status: rec.status, hull: rec.hull, maxHull: rec.maxHull, systemIndex: rec.systemIndex, stranded: rec.stranded?.recovery || null, fate: rec.fate || null,
            surrenderedTo: rec.surrendered?.to || null, stillMarked: rec.encounterId === enc.id, disableLine: Math.max(1, Math.floor(t.Fleet.disableThreshold(rec.maxHull))) },
          scene: npc && { vid: npc.vid, destroyed: Boolean(npc.destroyed), surrendered: Boolean(npc.surrendered), disabled: npc.condition === 'disabled', lastDamageSource: npc.lastDamageSource || null } };
      });
      const roleOf = (vid) => blockaders.find((x) => x.vid === vid) || null;
      return {
        id: enc.id, system: enc.system, status: enc.status, result: enc.result, fallback: enc.fallback, resolvedDay: enc.resolvedDay,
        resolvedEvents: events.filter((e) => e === 'resolved').length, fallbackEvents: events.filter((e) => e === 'fallback').length, history: events,
        // Every encounter the book holds for this blockade with the captain in it (one contact, one record).
        captainEncounters: (book.encounters || []).filter((e) => e.captain && e.type === 'blockade' && String(e.objective?.ref) === String(enc.objective.ref)).length,
        runsForEncounter: (bl.runs || []).filter((x) => x.encounterId === enc.id).map((x) => ({ outcome: x.outcome, tactical: Boolean(x.tactical), day: x.day })),
        // The strategic resolver's own run for the captain's crossing, if it had settled the contact beside the scene.
        abstractRuns: (bl.runs || []).filter((x) => !x.tactical && x.day >= enc.createdDay && (x.by === key || x.encounterId === enc.id)).length,
        blockade: { status: bl.status, losses: bl.losses || 0 },
        blockaders, roles: Object.fromEntries(Object.entries(roles).map(([k, vid]) => [k, roleOf(vid)])),
      };
    };
  });
  // The handoff invariants, asserted the same way for every branch (see window.__handoffInvariants).
  function assertHandoffInvariants(inv) {
    assert.equal(inv.status, 'resolved', `encounter ${inv.status}: ${JSON.stringify(inv.result)}`);
    assert.equal(inv.resolvedEvents, 1, `resolved ${inv.resolvedEvents} times: ${inv.history.join(' → ')}`);
    assert.equal(inv.fallbackEvents, 0, `the strategic fallback also ran: ${inv.history.join(' → ')}`);
    assert.equal(inv.fallback, null, `fallback recorded: ${JSON.stringify(inv.fallback)}`);
    assert.equal(inv.captainEncounters, 1, `${inv.captainEncounters} encounters for one crossing`);
    assert.ok(['passed', 'broken'].includes(inv.result.outcome), `the runner did not pass: ${inv.result.outcome}`);
    assert.ok(['fought_through', 'blockade_broken'].includes(inv.result.run), `run recorded as ${inv.result.run}`);
    assert.equal(inv.runsForEncounter.length, 1, `runs for this encounter: ${JSON.stringify(inv.runsForEncounter)}`);
    assert.equal(inv.runsForEncounter[0].tactical, true, 'the run on the blockade record is not the tactical one');
    assert.equal(inv.abstractRuns, 0, 'an abstract blockade run was also recorded for the captain\'s crossing');
    const tally = { lost: 0, disabled: 0, surrendered: 0 };
    for (const b of inv.blockaders) {
      const at = `blockader ${b.vid} (${b.fate})`;
      assert.ok(b.spawned, `${at} was not in the scene`);
      assert.equal(b.vidMismatch, null, `${at}: the scene spoke for ${b.vidMismatch}`);
      assert.ok(b.records <= 1, `${at}: ${b.records} records carry this vid`);
      if (b.scene) assert.equal(b.scene.vid, b.vid, `${at}: scene ship is ${b.scene.vid}`);
      if (b.fate !== 'destroyed') { assert.equal(b.records, 1, `${at}: no record`); assert.equal(b.rec.stillMarked, false, `${at}: still marked as in the encounter`); }
      if (b.ownIsSame === false) assert.fail(`${at}: the record under its hull id is not the record carrying its vid`);
      // What the scene showed is what the encounter says (the record's own classifier may only make a
      // damaged ship disabled or lost, never the reverse).
      if (b.scene?.destroyed) assert.equal(b.fate, 'destroyed', `${at}: destroyed in the scene`);
      if (b.scene?.surrendered) assert.equal(b.fate, 'surrendered', `${at}: struck in the scene`);
      if (b.scene?.disabled && !b.scene.destroyed && !b.scene.surrendered) assert.equal(b.fate, 'disabled', `${at}: disabled in the scene`);
      if (b.fate === 'destroyed') { tally.lost++; assert.ok(!b.rec || (b.rec.status === 'lost' && b.rec.hull === 0 && !b.rec.stranded), `${at}: record ${JSON.stringify(b.rec)}`); }
      else if (b.fate === 'disabled') { tally.disabled++; assert.ok(b.rec.stranded === 'awaiting_recovery' && b.rec.systemIndex === inv.system && b.rec.hull > 0 && b.rec.hull <= b.rec.disableLine && b.rec.status !== 'lost', `${at}: record ${JSON.stringify(b.rec)}`); }
      else if (b.fate === 'surrendered') { tally.surrendered++; assert.equal(b.rec.status, 'surrendered', `${at}: record ${JSON.stringify(b.rec)}`); }
      else { assert.notEqual(b.rec.status, 'lost', `${at}: lost on record`); if (b.after != null) assert.ok(Math.abs(b.rec.hull - b.after) <= 0.1, `${at}: record hull ${b.rec.hull} vs ${b.after} reported`); }
    }
    const bl = inv.result.blockaderLosses || {};
    assert.deepEqual({ lost: bl.lost, disabled: bl.disabled, surrendered: bl.surrendered }, tally, `blockade tallies vs fates ${JSON.stringify(bl)}`);
    assert.ok(inv.blockade.losses >= tally.lost, `blockade losses ${inv.blockade.losses} < ${tally.lost} destroyed`);
  }
  // The crippled interceptor may legitimately end either way: still disabled (awaiting recovery) or finished
  // by later valid tactical fire (destroyed, retired from its polity). Nothing else.
  const CRIPPLE_FATES = ['disabled', 'destroyed'];

  // ================================================================================================
  // BLOCKADE-TACTICAL-HANDOFF
  // ================================================================================================
  // Find a campaign seed where the captain's crossing of Alpha Centauri is intercepted.
  const interceptSeed = await (async () => {
    for (let i = 0; i < 60; i++) {
      await fresh(`th-intercept-${i}`); await setup();
      const r = await ev(() => ({ ok: Boolean(window.__interceptScene('probe').bid) }));
      if (r.ok) {
        // Fly it and see whether it stopped at Alpha Centauri.
        const f = await ev(() => { const s = { AC: window.__idx('Alpha Centauri') }; const r = window.__fly(window.__idx('Earth')); return { ...r, AC: s.AC, stop: testBM1.state.warp.stop || null }; });
        if (!hasHandoff || (f.at === f.AC && f.stop?.type === 'blockade')) return i;
      }
    }
    return null;
  })();
  evidence.push({ interceptSeed });

  await check('baseline-defect', 'CAPTAIN-STOPS-AT-B the captain\'s course Paso → Alpha Centauri → Earth is intercepted at the blockaded Alpha Centauri: he is there on the day he reaches it, and Earth is not reached until the encounter is over and he resumes', async () => {
    await fresh(`th-intercept-${interceptSeed ?? 0}`); await setup();
    const r = await ev(() => {
      const t = testBM1;
      const s = window.__interceptScene('b1');
      const f = window.__fly(s.E);
      const enc = window.__enc('blockade');
      return { ...f, s, enc: enc && { id: enc.id, status: enc.status, captain: enc.captain, participants: enc.participants.length }, resume: t.state.warpResume ? { destination: t.state.warpResume.destination, path: t.state.warpResume.path } : null, runs: (window.__block(s.bid)?.runs || []).map((x) => ({ day: x.day, outcome: x.outcome, tactical: x.tactical || false })) };
    });
    evidence.push({ check: 'CAPTAIN-STOPS-AT-B', ...r });
    assert.ok(interceptSeed != null, 'no seed intercepted the captain');
    assert.equal(r.at, r.s.AC, `the captain went straight to ${r.at} (Earth is ${r.s.E}); the blockade at Alpha Centauri was ${JSON.stringify(r.runs)}`);
    assert.equal(r.day - r.day0, r.legDays[0], `he reached Alpha Centauri on day ${r.day}, leg 1 is ${r.legDays[0]} days`);
    assert.ok(r.enc && r.enc.captain && r.enc.status === 'pending', JSON.stringify(r.enc));
    assert.equal(r.resume?.destination, r.s.E);
    assert.deepEqual(r.resume.path, [r.s.E]);
  });

  await check('new-feature', 'SAME-SHIPS-IN-SCENE the scene holds the blockade\'s own ships — the same vids, classes and hull shares as their records — and no generic substitute (SHOT)', async () => {
    const r = await ev(() => {
      const t = testBM1;
      window.__seconds(3);
      const enc = window.__enc('blockade');
      const b = window.__block(enc.objective.ref);
      const book = t.campaign();
      const recs = b.hulls.map((x) => book.polities.klingon.hulls.find((h) => h.id === x.hullId)).filter(Boolean);
      const npcs = window.__npcs(enc.id);
      return { status: enc.status, npcs: npcs.map((n) => ({ vid: n.vid, shipId: n.shipId, frac: Math.round(100 * n.combatHull / n.maxCombatHull), faction: n.faction, side: n.encounterSide })),
        recs: recs.map((h) => ({ vid: window.__vid(h), shipId: h.shipId, frac: Math.round(100 * h.hull / h.maxHull) })), other: t.state.npcShips.filter((n) => !n.encounterId && !n.fleetId && n.faction === 'klingon' && !n.destroyed).length };
    });
    evidence.push({ check: 'SAME-SHIPS-IN-SCENE', ...r });
    assert.equal(r.status, 'tactical_active');
    assert.equal(r.npcs.length, r.recs.length, `${r.npcs.length} ships in the scene for ${r.recs.length} on station`);
    for (const rec of r.recs) { const n = r.npcs.find((x) => x.vid === rec.vid); assert.ok(n, `blockader ${rec.vid} is not in the scene`); assert.equal(n.shipId, rec.shipId); assert.ok(Math.abs(n.frac - rec.frac) <= 1, `hull share ${n.frac} vs ${rec.frac}`); }
    // Let them close on him (the interceptors spawn at weapons range) so the scene shot shows them.
    const closing = await ev(() => { const enc = window.__enc('blockade'); const near = () => window.__npcs(enc.id).filter((n) => !n.destroyed && testBM1.distanceToPlayer(n) < 520).length;
      let k = 0; for (; k < 25 && near() < 3; k++) window.__hold(1);
      return { seconds: k, near: near(), dist: window.__npcs(enc.id).map((n) => Math.round(testBM1.distanceToPlayer(n))) }; });
    evidence.push({ check: 'SAME-SHIPS-IN-SCENE (closing)', ...closing });
    await page.waitForTimeout(150);
    await shot('TH-blockade-handoff-scene.png');
    await shotSection('TH-debug-encounter-blockade-active.png', '[data-encounter-section]');
  });

  await check('new-feature', 'PASSED-AND-RESUMED the interception fought out: the blockaders\' damage, losses and a surrender are written to the same hulls; the captain resumes the remaining Alpha Centauri → Earth leg once, arriving by its real length (SHOT)', async () => {
    const r = await ev(() => {
      const t = testBM1;
      const enc = window.__enc('blockade');
      const npcs = window.__npcs(enc.id);
      // The captain's fire, as the scene would record it: one destroyed, one disabled, one struck.
      const [a, b2, c, d] = npcs;
      t.destroyNpcShip(a);
      d.combatHull = Math.round(d.maxCombatHull * 0.55);
      // The captain holds (his shields and hull are not what this check measures). Late in the engagement one
      // interceptor is crippled and one strikes (done late so the world's own guns do not finish the cripple).
      const elapsed = () => t.gameNow() - enc.activatedAtMs;
      for (let k = 0; k < 80 && enc.status === 'tactical_active' && elapsed() < 56000; k++) window.__hold(1);
      // Crippled just under the disable line (the world's station still fires on a crippled enemy).
      b2.combatHull = Math.max(1, Math.floor(t.Fleet.disableThreshold(b2.maxCombatHull))); t.applyVesselDisablement?.(b2); b2.condition = 'disabled';
      t.surrenderNpc(c, { to: 'player', reason: 'struck to the captain', acceptedBy: 'captain' });
      for (let k = 0; k < 40 && enc.status === 'tactical_active'; k++) window.__hold(1);
      const e2 = t.Encounter.encounterById(t.campaign(), enc.id);
      const book = t.campaign();
      const h = (vid) => Object.values(book.polities).flatMap((p) => p.hulls).find((x) => window.__vid(x) === vid);
      const bl = window.__block(enc.objective.ref);
      const fates = { dead: [a.vid, h(a.vid)?.status ?? 'gone'], disabled: [b2.vid, h(b2.vid) && { hull: h(b2.vid).hull, max: h(b2.vid).maxHull, at: h(b2.vid).systemIndex, stranded: h(b2.vid).stranded?.recovery || null, status: h(b2.vid).status }],
        surrendered: [c.vid, h(c.vid)?.status, h(c.vid)?.surrendered?.to], damaged: [d.vid, h(d.vid) && Math.round(100 * h(d.vid).hull / h(d.vid).maxHull), d.destroyed ? null : Math.round(100 * d.combatHull / d.maxCombatHull)] };
      const course = t.captainCourseLine();
      const panel = document.getElementById('security-order-panel')?.textContent?.replace(/\s+/g, ' ').trim() || '';
      const inv = window.__handoffInvariants(enc.id, { dead: a.vid, cripple: b2.vid, struck: c.vid, damaged: d.vid });
      return { status: e2.status, result: e2.result, fates, inv, crippleFate: inv.roles.cripple?.fate ?? null, crippleFinishedBy: b2.destroyed ? (b2.lastDamageSource || null) : null,
        blockade: { status: bl.status, hulls: bl.hulls.length, coverage: bl.coverage, sighting: bl.sightings?.player || null, losses: bl.losses }, course, panel, AC: e2.system, day: t.state.day };
    });
    evidence.push({ check: 'PASSED-AND-RESUMED (resolution)', ...r });
    assert.equal(r.status, 'resolved', JSON.stringify(r.result));
    assert.ok(['passed', 'broken'].includes(r.result.outcome), r.result.outcome);
    assert.ok(['lost', 'gone'].includes(r.fates.dead[1]), `destroyed blockader is ${r.fates.dead[1]}`);
    // The cripple is left just under the disable line while the world's station still fires on enemies:
    // it may end disabled (awaiting recovery here) or finished by that later fire (lost). Both are valid
    // combat outcomes; what must hold either way is the handoff (CRIPPLE-EITHER-FATE exercises both).
    assert.ok(CRIPPLE_FATES.includes(r.crippleFate), `the crippled blockader came back as ${r.crippleFate}: ${JSON.stringify(r.fates.disabled)}`);
    assertHandoffInvariants(r.inv);
    assert.equal(r.fates.surrendered[1], 'surrendered');
    // The damaged interceptor's record carries exactly what it had left in the scene (≤ 55%: it was struck).
    if (r.fates.damaged[2] != null) { assert.ok(r.fates.damaged[1] <= 56, JSON.stringify(r.fates.damaged)); assert.ok(Math.abs(r.fates.damaged[1] - r.fates.damaged[2]) <= 1, JSON.stringify(r.fates.damaged)); }
    assert.ok(r.blockade.sighting?.tactical, 'what the captain saw is not on the blockade record');
    assert.ok(r.course?.ready, `the course is not ready to resume: ${JSON.stringify(r.course)}`);
    await shot('TH-course-panel-resume.png');
    await shotSection('TH-debug-encounter-post-battle.png', '[data-encounter-section]');
    const r2 = await ev(() => {
      const t = testBM1;
      const day0 = t.state.day, AC = t.state.currentPlanet;
      const ok = t.resumeCaptainCourse();
      const again = t.resumeCaptainCourse(); // once only
      const legs = t.state.warp.legDays;
      t.openWarpBriefing?.(); t.closeGalaxyReports?.(); t.completeWarpTravel();
      return { ok, again, day0, day: t.state.day, at: t.state.currentPlanet, legs, crossings: t.state.warp.crossings, AC, encounters: window.__encs().length };
    });
    evidence.push({ check: 'PASSED-AND-RESUMED (resume)', ...r2 });
    assert.equal(r2.ok, true); assert.equal(r2.again, false);
    assert.equal(r2.at, await ev(() => window.__idx('Earth')));
    assert.equal(r2.day - r2.day0, r2.legs.reduce((n, d) => n + d, 0));
    assert.ok(!r2.crossings.some((c) => c.system === r2.AC), 'Alpha Centauri was crossed again');
    assert.equal(r2.encounters, 1, 'a second encounter was opened');
  });

  // PASSED-AND-RESUMED leaves one interceptor just under the disable line late in the fight; whether the
  // world's station guns finish it before the window closes is ordinary tactical fire. Here each fate is
  // produced on purpose — on the same seed, scene and timing — and the scene is closed by the engine's own
  // window rule with no simulated fire after the last act, so both branches run every time, deterministically.
  await check('new-feature', 'CRIPPLE-EITHER-FATE the same interception with the cripple left disabled, then finished by one more station hit: either way the runner passes, the encounter resolves once with no abstract run beside it, every fate is written to the same vid, and the course resumes once', async () => {
    for (const branch of CRIPPLE_FATES) {
      await fresh(`th-intercept-${interceptSeed ?? 0}`); await setup();
      const r = await ev((branch) => {
        const t = testBM1;
        const s = window.__interceptScene(`cf-${branch}`);
        const f = window.__fly(s.E);
        window.__seconds(3);
        const enc = window.__enc('blockade');
        if (!enc || enc.status !== 'tactical_active') return { fail: `no scene: ${JSON.stringify(enc && { status: enc.status, result: enc.result })}`, f };
        const [a, b2, c, d] = window.__npcs(enc.id);
        t.destroyNpcShip(a);
        d.combatHull = Math.round(d.maxCombatHull * 0.55);
        const elapsed = () => t.gameNow() - enc.activatedAtMs;
        for (let k = 0; k < 80 && enc.status === 'tactical_active' && elapsed() < 56000; k++) window.__hold(1);
        if (enc.status !== 'tactical_active') return { fail: `closed before the cripple: ${JSON.stringify(enc.result)}` };
        b2.combatHull = Math.max(1, Math.floor(t.Fleet.disableThreshold(b2.maxCombatHull))); t.applyVesselDisablement?.(b2); b2.condition = 'disabled';
        // The station's fire, through the engine's own damage path (shields first, then hull).
        if (branch === 'destroyed') t.damageCombatTarget(b2, Math.ceil((b2.combatShields || 0) + b2.combatHull + 1), 'station');
        t.surrenderNpc(c, { to: 'player', reason: 'struck to the captain', acceptedBy: 'captain' });
        const scene = { crippleDestroyed: Boolean(b2.destroyed), crippleSource: b2.lastDamageSource || null, crippleCondition: b2.condition };
        const closed = window.__closeAtWindow(enc);
        const inv = window.__handoffInvariants(enc.id, { dead: a.vid, cripple: b2.vid, struck: c.vid, damaged: d.vid });
        const course = t.captainCourseLine();
        const day0 = t.state.day, AC = t.state.currentPlanet;
        const ok = t.resumeCaptainCourse();
        const again = t.resumeCaptainCourse();
        const legs = t.state.warp.legDays;
        t.openWarpBriefing?.(); t.closeGalaxyReports?.(); t.completeWarpTravel();
        return { scene, closed, inv, course: course && { ready: course.ready }, resume: { ok, again, day0, day: t.state.day, at: t.state.currentPlanet, E: s.E, AC, legs, recrossed: (t.state.warp.crossings || []).some((x) => x.system === AC), encounters: window.__encs().length, warpResume: t.state.warpResume } };
      }, branch);
      evidence.push({ check: `CRIPPLE-EITHER-FATE (${branch})`, ...r });
      assert.ok(!r.fail, r.fail);
      assert.equal(r.closed, 'resolved', `the scene did not close on its window: ${r.closed}`);
      if (branch === 'destroyed') { assert.equal(r.scene.crippleDestroyed, true, 'the station hit did not finish the cripple'); assert.equal(r.scene.crippleSource, 'station'); }
      else assert.equal(r.scene.crippleDestroyed, false);
      assert.equal(r.inv.roles.cripple?.fate, branch, `cripple came back ${r.inv.roles.cripple?.fate}, expected ${branch}`);
      assert.equal(r.inv.roles.dead?.fate, 'destroyed');
      assert.equal(r.inv.roles.struck?.fate, 'surrendered');
      assertHandoffInvariants(r.inv);
      assert.ok(r.course?.ready, 'the course is not ready to resume');
      assert.equal(r.resume.ok, true, 'resume refused'); assert.equal(r.resume.again, false, 'resumed twice');
      assert.equal(r.resume.at, r.resume.E, `arrived at ${r.resume.at}, not Earth`);
      assert.equal(r.resume.day - r.resume.day0, r.resume.legs.reduce((n, x) => n + x, 0));
      assert.equal(r.resume.recrossed, false, 'Alpha Centauri was crossed again');
      assert.equal(r.resume.encounters, 1, 'a second encounter was opened');
    }
  });

  await check('new-feature', 'FORCED-BACK the same interception with the captain already badly hurt: driven back — the course to Earth is off, and he falls back to Paso, never to Earth', async () => {
    await fresh(`th-intercept-${interceptSeed ?? 0}`); await setup();
    const r = await ev(() => {
      const t = testBM1;
      const s = window.__interceptScene('b4', { hull: 40 });
      const f = window.__fly(s.E);
      window.__seconds(3);
      const enc = window.__enc('blockade');
      // The interceptors' fire, as the scene records it.
      for (let k = 0; k < 40 && enc.status === 'tactical_active'; k++) { t.state.hull = Math.max(1, t.state.hull - 1); window.__seconds(0.5); }
      window.__seconds(3);
      const w = { active: t.state.warp.active, to: t.state.warp.to, kind: t.state.warp.kind };
      if (t.state.warp.active) { t.openWarpBriefing?.(); t.closeGalaxyReports?.(); t.completeWarpTravel(); }
      return { f, s, enc: { status: enc.status, result: enc.result }, warp: w, at: t.state.currentPlanet, resume: t.state.warpResume, run: (window.__block(s.bid)?.runs || []).find((x) => x.encounterId === enc.id) || null };
    });
    evidence.push({ check: 'FORCED-BACK', ...r });
    assert.equal(r.enc.result?.outcome, 'forced_back', JSON.stringify(r.enc));
    assert.equal(r.run?.outcome, 'intercepted_forced_back');
    assert.equal(r.warp.kind, 'retreat'); assert.equal(r.warp.to, r.s.P);
    assert.equal(r.at, r.s.P, 'not back at Paso');
    assert.equal(r.resume, null, 'the course to Earth survived being forced back');
  });

  await check('new-feature', 'SAVE-LOAD-AROUND saving before contact (pending), mid-fight (tactical, with damage) and after the return: no duplicated ships, no repeated encounter, the same hull states, the same remaining route', async () => {
    await fresh(`th-intercept-${interceptSeed ?? 0}`); await setup();
    const r = await ev(() => {
      const t = testBM1;
      const s = window.__interceptScene('b5');
      window.__fly(s.E);
      const enc0 = window.__enc('blockade');
      // 1. pending: saved before the scene took it up.
      t.saveGame(7); t.startWithFaction('ferengi'); t.loadGame(7);
      const a = { encounters: window.__encs().length, status: window.__enc('blockade').status, resume: t.state.warpResume?.path };
      window.__seconds(3);
      const e1 = window.__enc('blockade');
      const npcs = window.__npcs(e1.id);
      npcs[0].combatHull = Math.round(npcs[0].maxCombatHull * 0.4);
      const mid = { status: e1.status, vids: npcs.map((n) => n.vid).sort(), hurt: [npcs[0].vid, npcs[0].combatHull] };
      // 2. mid-fight: the scene is saved with its ships.
      t.saveGame(7); t.startWithFaction('ferengi'); t.loadGame(7);
      window.__seconds(1);
      const e2 = window.__enc('blockade');
      const npcs2 = window.__npcs(e2.id);
      const b = { status: e2.status, vids: npcs2.map((n) => n.vid).sort(), hurt: npcs2.find((n) => n.vid === mid.hurt[0])?.combatHull, encounters: window.__encs().length, dup: t.state.npcShips.filter((n) => n.vid && mid.vids.includes(n.vid) && !n.destroyed).length };
      window.__hold(62);
      // 3. after the return: nothing re-runs, the course is still there once.
      t.saveGame(7); t.startWithFaction('ferengi'); t.loadGame(7);
      window.__seconds(2);
      const c = { encounters: window.__encs().length, statuses: window.__encs().map((e) => e.status), resume: t.state.warpResume?.path || null, runs: (window.__block(s.bid)?.runs || []).filter((x) => x.encounterId).length };
      return { a, mid, b, c, id0: enc0.id };
    });
    evidence.push({ check: 'SAVE-LOAD-AROUND', ...r });
    assert.equal(r.a.encounters, 1); assert.equal(r.a.status, 'pending'); assert.ok(r.a.resume?.length === 1);
    assert.equal(r.mid.status, 'tactical_active');
    assert.equal(r.b.encounters, 1, 'the encounter was re-opened by the reload');
    assert.deepEqual(r.b.vids, r.mid.vids, 'not the same ships after the reload');
    assert.equal(r.b.hurt, r.mid.hurt[1], 'the damage done before the save was lost or repeated');
    assert.equal(r.b.dup, r.mid.vids.length, 'ships were duplicated');
    assert.equal(r.c.encounters, 1); assert.deepEqual(r.c.statuses, ['resolved']);
    assert.equal(r.c.runs, 1, 'the tactical run was recorded more than once');
    assert.ok(r.c.resume?.length === 1, 'the remaining route was lost');
  });

  await check('new-feature', 'FALLBACK-ONCE a scene that cannot be made: the strategic run settles the interception exactly once, recorded as a fallback in debug', async () => {
    await fresh(`th-intercept-${interceptSeed ?? 0}`); await setup();
    const r = await ev(() => {
      const t = testBM1;
      const s = window.__interceptScene('b6');
      window.__fly(s.E);
      globalThis.__bm1FailEncounterScene = true;
      window.__seconds(3);
      globalThis.__bm1FailEncounterScene = false;
      window.__seconds(3);
      const enc = window.__enc('blockade');
      const bl = window.__block(s.bid);
      const out = { status: enc.status, fallback: enc.fallback, runs: (bl?.runs || []).filter((x) => String(x.by || '').startsWith('captain:')), stats: t.Encounter.encounterStats(t.campaign()), npcs: window.__npcs(enc.id).length };
      // The strategic run's own verdict stands: driven back, the captain falls back (a retreat warp).
      out.after = { warp: t.state.warp.active ? { kind: t.state.warp.kind, to: t.state.warp.to } : null, resume: t.state.warpResume ? { ready: t.state.warpResume.ready } : null };
      if (t.state.warp.active) { t.openWarpBriefing?.(); t.closeGalaxyReports?.(); t.completeWarpTravel(); }
      out.after.at = t.state.currentPlanet;
      out.runsAfter = (bl?.runs || []).filter((x) => String(x.by || '').startsWith('captain:')).length;
      return out;
    });
    evidence.push({ check: 'FALLBACK-ONCE', ...r });
    assert.equal(r.status, 'fallback'); assert.ok(r.fallback?.used);
    assert.equal(r.runs.length, 1, `runs ${JSON.stringify(r.runs)}`); assert.ok(!r.runs[0].tactical);
    assert.equal(r.stats.fallbacks, 1); assert.equal(r.npcs, 0);
    assert.equal(r.runsAfter, 1, 'the crossing was settled again after the fallback');
    assert.ok(!['intercepted_forced_back', 'intercepted_losses'].includes(r.runs[0].outcome) ? r.after.resume?.ready : r.after.warp?.kind === 'retreat', JSON.stringify({ run: r.runs[0], after: r.after }));
    await shotSection('TH-debug-encounter-fallback.png', '[data-encounter-section]');
  });

  // ================================================================================================
  // WAR-OP-TACTICAL-HANDOFF
  // ================================================================================================
  // A Klingon force on a real multi-leg route to a Terran world where the captain waits.
  const warScene = async (seed) => {
    await fresh(seed); await setup();
    return ev(() => {
      const t = testBM1, book = t.campaign(), w = t.buildCampaignWorld(true);
      window.__quiet();
      t.syncPlayerPolity(book);
      const kl = book.polities.klingon.hulls.filter((h) => h.status === 'ready' && !h.opId && !h.transit);
      const by = {}; for (const h of kl) (by[h.systemIndex] ||= []).push(h);
      let best = null;
      for (const [from, hs] of Object.entries(by)) {
        if (hs.length < 3 || w.systems[from]?.controller !== 'klingon') continue;
        for (const s of w.systems) {
          if (s.controller !== 'terran') continue;
          const plan = t.Campaign.plotJourney(w, Number(from), s.index, 'klingon');
          if (!plan || plan.path.length < 2) continue;
          const days = plan.legDays.reduce((n, d) => n + d, 0);
          if (!best || days < best.days) best = { from: Number(from), target: s.index, hs: hs.slice(0, 3), plan, days };
        }
      }
      if (!best) return { fail: 'no multi-leg Klingon mission' };
      for (const i of [best.from, ...best.plan.path]) t.markSystemVisited(i);
      window.__place(best.target); window.__reset();
      const fx = [];
      const op = t.Campaign.launchOperation(book, w, 'klingon', best.hs, best.target, t.state.day, best.plan.path.length, 'assault', fx);
      t.applyCampaignEffects(fx, t.state.day);
      window.__op = op.id;
      return { target: best.target, from: best.from, path: best.plan.path, legDays: best.plan.legDays, vids: best.hs.map(window.__vid), op: op.id };
    });
  };
  await check('new-feature', 'WAR-OP-HANDOFF an operation flying real legs engages the world the captain is at: the scene takes it up with its own hulls and the world\'s actual defenders, never an offscreen battle day; save/load around the handoff; the survivors\' state goes back to the same hulls; one report (SHOT)', async () => {
    const m = await warScene('th-war');
    assert.ok(!m.fail, m.fail);
    const r = await ev((m) => {
      const t = testBM1, book = t.campaign();
      const op = book.operations.find((o) => o.id === m.op);
      const hits = [];
      for (let k = 0; k < 80 && !(book.encounters || []).some((e) => e.type === 'operation'); k++) { t.advanceFleetCalendar(1, t.Fleet.nextId(t.fleetBook(), 'journey')); }
      const enc = window.__enc('operation');
      const pending = enc && { id: enc.id, status: enc.status, attackers: enc.participants.filter((p) => p.side === 'attacker').map((p) => p.vid).sort(), defenders: enc.participants.filter((p) => p.side === 'defender').length };
      // Save/load around the handoff: pending on save, taken up once after the load.
      t.saveGame(6); t.startWithFaction('ferengi'); t.loadGame(6);
      window.__seconds(3);
      const e2 = window.__enc('operation');
      const scene = window.__npcs(e2.id).map((n) => ({ vid: n.vid, side: n.encounterSide }));
      const reportsBefore = (t.galaxyNewsBook().items || []).concat(t.galaxyNewsBook().pending || []).filter((x) => /encounter:|op-done:/.test(String(x.id))).length;
      // The captain and the defenders finish the attackers.
      for (const n of window.__npcs(e2.id).filter((n) => n.encounterSide === 'attacker')) t.destroyNpcShip(n);
      window.__seconds(3);
      const op2 = t.campaign().operations.find((o) => o.id === m.op);
      const reports = (t.galaxyNewsBook().items || []).concat(t.galaxyNewsBook().pending || []).filter((x) => /encounter:|op-done:/.test(String(x.id))).map((x) => x.id);
      const later = [];
      for (let k = 0; k < 5; k++) { t.advanceFleetCalendar(1, t.Fleet.nextId(t.fleetBook(), 'journey')); }
      return { pending, e2: { status: e2.status, result: e2.result, fates: e2.participants.map((p) => [p.side, p.vid, p.fate]) }, scene, op: { status: op2.status, outcome: op2.outcome, resolvedBy: op2.resolvedBy, defenderLosses: op2.defenderLosses, losses: op2.losses }, reports, reportsBefore,
        lost: m.vids.map((v) => { const h = t.campaign().polities.klingon.hulls.find((x) => window.__vid(x) === v); return h ? h.status : 'gone'; }), encounters: window.__encs().length };
    }, m);
    evidence.push({ check: 'WAR-OP-HANDOFF', m, ...r });
    assert.ok(r.pending, 'the operation was never handed off');
    assert.deepEqual(r.pending.attackers, [...m.vids].sort());
    assert.equal(r.e2.status, 'resolved', JSON.stringify(r.e2));
    assert.ok(r.scene.filter((x) => x.side === 'attacker').length === m.vids.length, JSON.stringify(r.scene));
    assert.equal(r.op.status, 'resolved'); assert.equal(r.op.resolvedBy, 'local');
    assert.ok(r.lost.every((s) => s === 'lost' || s === 'gone'), JSON.stringify(r.lost));
    assert.equal(r.encounters, 1);
    assert.equal(r.reports.filter((id) => id.startsWith('op-done:')).length, 0, `the abstract battle report was also written: ${r.reports}`);
    assert.equal(r.reports.filter((id) => id.startsWith('encounter:')).length, 1, `reports ${r.reports}`);
    await shotSection('TH-debug-encounter-war-op.png', '[data-encounter-section]');
  });
  await check('new-feature', 'WAR-OP-CEASEFIRE a ceasefire before contact: the handed-off attack is called off in the scene — nobody spawns, nothing strikes, the operation stands down; no stale strike later', async () => {
    const m = await warScene('th-war-cf');
    assert.ok(!m.fail, m.fail);
    const r = await ev((m) => {
      const t = testBM1, book = t.campaign();
      for (let k = 0; k < 80 && !(book.encounters || []).some((e) => e.type === 'operation'); k++) t.advanceFleetCalendar(1, t.Fleet.nextId(t.fleetBook(), 'journey'));
      const enc = window.__enc('operation');
      t.changeDiplomacy('terran', 'klingon', 'ceasefire');
      window.__seconds(3);
      const hits = [];
      for (let k = 0; k < 6; k++) t.advanceFleetCalendar(1, t.Fleet.nextId(t.fleetBook(), 'journey'));
      const op = t.campaign().operations.find((o) => o.id === m.op);
      return { enc: enc && { status: t.Encounter.encounterById(t.campaign(), enc.id).status }, npcs: enc ? window.__npcs(enc.id).length : null, op: { status: op.status, outcome: op.outcome }, holder: t.buildCampaignWorld(true).systems[m.target].controller, stale: t.Encounter.encounterStats(t.campaign()).staleSuppressed };
    }, m);
    evidence.push({ check: 'WAR-OP-CEASEFIRE', ...r });
    assert.ok(r.enc, 'no handoff to call off');
    assert.equal(r.enc.status, 'aborted'); assert.equal(r.npcs, 0);
    assert.equal(r.op.status, 'resolved'); assert.equal(r.op.outcome, 'stood-down');
    assert.notEqual(r.holder, 'klingon');
    assert.ok(r.stale >= 1);
  });

  await check('new-feature', 'LEAVE-MID-FIGHT the captain warps out of a battle the scene is fighting: it is handed back on the day he leaves, with the survivors as they stand, before any day of his course passes — no day of the war waits on his travel', async () => {
    const m = await warScene('th-war-leave');
    assert.ok(!m.fail, m.fail);
    const r = await ev((m) => {
      const t = testBM1, book = t.campaign();
      for (let k = 0; k < 80 && !(book.encounters || []).some((e) => e.type === 'operation'); k++) t.advanceFleetCalendar(1, t.Fleet.nextId(t.fleetBook(), 'journey'));
      window.__seconds(3);
      const enc = window.__enc('operation');
      const active = enc && enc.status;
      const hurt = window.__npcs(enc.id).find((n) => n.encounterSide === 'attacker');
      if (hurt) hurt.combatHull = Math.round(hurt.maxCombatHull * 0.5);
      const day0 = t.state.day, sup0 = t.Encounter.encounterStats(book).abstractSuppressed;
      const w = t.buildCampaignWorld(true);
      const away = w.neighbours(m.target).map(Number).find((n) => t.getPlottedRoute(m.target, n));
      const plan = t.getPlottedRoute(m.target, away);
      t.state.antimatter = 999;
      t.beginWarpTravel(away, plan);
      const atDeparture = { status: enc.status, resolvedDay: enc.resolvedDay, outcome: enc.result?.outcome, op: book.operations.find((o) => o.id === m.op).resolvedBy };
      t.openWarpBriefing?.(); t.closeGalaxyReports?.(); t.completeWarpTravel();
      const h = hurt && book.polities.klingon.hulls.find((x) => window.__vid(x) === hurt.vid);
      return { active, day0, atDeparture, dayArrived: t.state.day, suppressedDuringCourse: t.Encounter.encounterStats(book).abstractSuppressed - sup0, hurt: hurt && { vid: hurt.vid, frac: h ? Math.round(100 * h.hull / h.maxHull) : null }, encs: window.__encs().filter((e) => e.type === 'operation').length };
    }, m);
    evidence.push({ check: 'LEAVE-MID-FIGHT', ...r });
    assert.equal(r.active, 'tactical_active');
    assert.equal(r.atDeparture.status, 'resolved', JSON.stringify(r.atDeparture));
    assert.equal(r.atDeparture.resolvedDay, r.day0, 'handed back on a later day than the one he left');
    assert.notEqual(r.atDeparture.op, 'local', 'the operation is still held by a scene he has left');
    assert.ok(r.dayArrived > r.day0);
    assert.equal(r.suppressedDuringCourse, 0, 'days of the war waited on his travel');
    if (r.hurt?.frac != null) assert.ok(r.hurt.frac <= 51, `the damage done before he left was not kept: ${r.hurt.frac}%`);
    assert.equal(r.encs, 1);
  });

  // ================================================================================================
  // PIRATE-TACTICAL-HANDOFF
  // ================================================================================================
  // A course through the pirates' own waters (Pirates Haven and the unclaimed Astron beside it).
  const pirateScene = async (seed) => {
    await fresh(seed); await setup();
    return ev(() => {
      const t = testBM1, w = t.buildCampaignWorld(true);
      window.__quiet();
      const db = t.DoctrineCampaign.doctrineBook(t.campaign());
      db.config.predation = true;
      const H = window.__idx('Pirates Haven'), A = window.__idx('Astron');
      const nbs = w.neighbours(A).map(Number).filter((n) => n !== H);
      for (const from of nbs) for (const to of nbs) {
        if (from === to) continue;
        for (const i of [from, A, to, H]) t.markSystemVisited(i);
        const plan = t.getPlottedRoute(from, to);
        if (plan && plan.systems.length === 3 && plan.systems[1] === A) { window.__place(from); window.__reset(); t.state.latinum = 1000; return { from, to, A, H }; }
      }
      return { fail: 'no course through Astron' };
    });
  };
  await check('new-feature', 'PIRATE-PAY the course through the pirates\' waters stops where they are; their own vessel (the group\'s vid) demands; paying ends it with no battle, and the group keeps the loot and leaves the captain alone (cooldown); the course resumes (SHOT)', async () => {
    const s = await pirateScene('th-pirate-pay');
    assert.ok(!s.fail, s.fail);
    const r = await ev((s) => {
      const t = testBM1;
      const f = window.__fly(s.to);
      window.__seconds(4);
      const enc = window.__enc('predation');
      const db = t.DoctrineCampaign.doctrineBook(t.campaign());
      const g = enc ? db.pirates[enc.objective.group] : null;
      const npc = enc ? window.__npcs(enc.id)[0] : null;
      const demand = t.state.localDoctrine?.predation ? { state: t.state.localDoctrine.predation.state, amount: t.state.localDoctrine.predation.amount } : null;
      return { f, enc: enc && { status: enc.status, captain: enc.captain }, g: g && { vid: g.vid, loot: g.loot }, npcVid: npc?.vid, demand };
    }, s);
    evidence.push({ check: 'PIRATE-PAY (demand)', ...r });
    assert.equal(r.f.at, s.A, `the captain was not stopped in the pirates' waters (at ${r.f.at})`);
    assert.ok(r.enc?.captain && r.enc.status === 'tactical_active', JSON.stringify(r.enc));
    assert.equal(r.npcVid, r.g.vid, 'the demand is not made by the group\'s own vessel');
    assert.ok(r.demand, 'no demand');
    await shot('TH-pirate-demand.png');
    const r2 = await ev((s) => {
      const t = testBM1;
      const shots0 = t.state.npcShips.filter((n) => n.faction === 'pirate' && n.lastAggressionTargetSide === 'player').length;
      document.querySelector('[data-predation-response="pay"]')?.click();
      window.__seconds(3);
      const enc = window.__enc('predation');
      const db = t.DoctrineCampaign.doctrineBook(t.campaign());
      const g = db.pirates[enc.objective.group];
      const o = db.objectives.find((x) => x.id === enc.objective.ref);
      const me = t.ensurePersonalIdentity().vid;
      const ok = t.resumeCaptainCourse();
      if (t.state.warp.active) { t.openWarpBriefing?.(); t.closeGalaxyReports?.(); t.completeWarpTravel(); }
      return { status: enc.status, result: enc.result, loot: g.loot, cooldown: g.cooldowns[me], day: t.state.day, o: { status: o.status, reasons: o.resolution?.reasons }, shots: t.state.npcShips.filter((n) => n.faction === 'pirate' && n.lastAggressionTargetSide === 'player').length - shots0, resumed: ok, at: t.state.currentPlanet };
    }, s);
    evidence.push({ check: 'PIRATE-PAY (paid)', ...r2 });
    assert.equal(r2.status, 'resolved'); assert.equal(r2.result.outcome, 'paid');
    assert.ok(r2.loot > 0); assert.ok(r2.cooldown > r2.day);
    assert.deepEqual(r2.o.reasons, ['cargo_received']);
    assert.equal(r2.shots, 0, 'shots were fired after paying');
    assert.equal(r2.resumed, true); assert.equal(r2.at, s.to);
  });
  await check('new-feature', 'PIRATE-REFUSE refusing: the same pirate vessel attacks in the scene; destroyed there, the same strategic group is gone (SHOT)', async () => {
    const s = await pirateScene('th-pirate-refuse');
    assert.ok(!s.fail, s.fail);
    const r = await ev((s) => {
      const t = testBM1;
      window.__fly(s.to);
      window.__seconds(4);
      document.querySelector('[data-predation-response="refuse"]')?.click();
      window.__seconds(6);
      const enc = window.__enc('predation');
      const npc = window.__npcs(enc.id)[0];
      const fired = Boolean(npc && npc.lastAggressionTargetSide === 'player') || (t.state.hull < 100 || t.state.shields < 100);
      return { fired, npc: npc && { vid: npc.vid, attack: npc.localPredation?.attack || false } };
    }, s);
    await shot('TH-pirate-refuse-fight.png');
    const r2 = await ev(() => {
      const t = testBM1;
      const enc = window.__enc('predation');
      const npc = window.__npcs(enc.id)[0];
      t.destroyNpcShip(npc);
      window.__seconds(2);
      const db = t.DoctrineCampaign.doctrineBook(t.campaign());
      const g = db.pirates[enc.objective.group];
      const o = db.objectives.find((x) => x.id === enc.objective.ref);
      return { status: enc.status, result: enc.result, g: { status: g.status, hull: g.hull, vid: g.vid }, o: { status: o.status, reasons: o.resolution?.reasons } };
    });
    evidence.push({ check: 'PIRATE-REFUSE', ...r, ...r2 });
    assert.ok(r.npc?.attack, 'the pirates did not turn to attack on refusal');
    assert.ok(r.fired, 'no shot fired after the refusal');
    assert.equal(r2.status, 'resolved'); assert.equal(r2.g.status, 'lost'); assert.equal(r2.g.hull, 0);
    assert.equal(r2.g.vid, r.npc.vid);
  });
  await check('new-feature', 'PIRATE-RUN running and getting clear: the demand closes as escaped, the group cools off from the captain, and days later there is no abstract attack on him', async () => {
    const s = await pirateScene('th-pirate-run');
    assert.ok(!s.fail, s.fail);
    const r = await ev((s) => {
      const t = testBM1;
      window.__fly(s.to);
      window.__seconds(4);
      document.querySelector('[data-predation-response="run"]')?.click();
      const p = t.playerWorldPosition();
      t.setCamera?.(p.x + t.NPC_WEAPON_RANGE * 8, p.y); t.state.ship.velocity = 0;
      window.__seconds(3);
      const enc = window.__enc('predation');
      const db = t.DoctrineCampaign.doctrineBook(t.campaign());
      const g = db.pirates[enc.objective.group];
      const o = db.objectives.find((x) => x.id === enc.objective.ref);
      const me = t.ensurePersonalIdentity().vid;
      const fx = [];
      for (let k = 0; k < 8; k++) t.advanceFleetCalendar(1, t.Fleet.nextId(t.fleetBook(), 'journey'));
      const attacks = (db.predationLog || []).length;
      const later = db.objectives.filter((x) => x.kind === 'predation' && x.target?.vid === me && x.id !== o.id).length;
      return { status: enc.status, result: enc.result, o: { status: o.status, reasons: o.resolution?.reasons }, cooldown: g.cooldowns[me], day: t.state.day, later, gStatus: g.status };
    }, s);
    evidence.push({ check: 'PIRATE-RUN', ...r });
    assert.equal(r.status, 'resolved'); assert.equal(r.result.outcome, 'escaped');
    assert.deepEqual(r.o.reasons, ['target_escaped']);
    assert.ok(r.cooldown > r.day - 8 + 20, 'no cooldown for the captain');
    assert.equal(r.later, 0, 'a second demand on the captain inside the cooldown');
  });

  await check('new-feature', 'COURSE-AFTER-FALLBACK a stop whose scene could not be made (the pirates\' vessel could not be placed) still ends: the demand is settled by the model once with no attack on him, and the course is ready to resume — never left waiting on an engagement that is over', async () => {
    const s = await pirateScene('th-pirate-fb');
    assert.ok(!s.fail, s.fail);
    const r = await ev((s) => {
      const t = testBM1;
      const f = window.__fly(s.to);
      globalThis.__bm1FailEncounterScene = true;
      window.__seconds(2);
      globalThis.__bm1FailEncounterScene = false;
      window.__seconds(1);
      const enc = window.__enc('predation');
      const course = t.captainCourseLine();
      const hull = t.state.hull;
      const ok = t.resumeCaptainCourse();
      if (t.state.warp.active) { t.openWarpBriefing?.(); t.closeGalaxyReports?.(); t.completeWarpTravel(); }
      return { at0: f.at, status: enc?.status, fallback: enc?.fallback, course, hull, ok, at: t.state.currentPlanet };
    }, s);
    evidence.push({ check: 'COURSE-AFTER-FALLBACK', ...r });
    assert.equal(r.at0, s.A);
    assert.equal(r.status, 'fallback'); assert.ok(r.fallback?.used);
    assert.ok(r.course?.ready, JSON.stringify(r.course));
    assert.equal(r.hull, 100, 'the model attacked him abstractly');
    assert.equal(r.ok, true); assert.equal(r.at, s.to);
  });

  // ================================================================================================
  // Raid and AI runners where the captain is; knowledge; debug
  // ================================================================================================
  await check('new-feature', 'RAID-IN-SCENE a raid striking the world the captain is at is fought in the scene (raider against the world\'s defenders, the same hulls); the finite raid takes its result', async () => {
    await fresh('th-raid'); await setup();
    const r = await ev(() => {
      const t = testBM1, book = t.campaign(), w = t.buildCampaignWorld(true);
      window.__quiet();
      const db = t.DoctrineCampaign.doctrineBook(book);
      // A Terran world next to a Klingon one, lightly held; a Klingon raider next door.
      let pick = null;
      for (const s of w.systems) {
        if (s.controller !== 'terran') continue;
        for (const n of w.neighbours(s.index).map(Number)) {
          if (w.systems[n]?.controller !== 'klingon') continue;
          const raider = book.polities.klingon.hulls.filter((h) => h.status === 'ready' && !h.opId && !h.transit && Number(h.systemIndex) === n).sort((a, b) => b.maxHull - a.maxHull)[0];
          if (raider) { pick = { target: s.index, from: n, raider }; break; }
        }
        if (pick) break;
      }
      if (!pick) return { fail: 'no raid scene' };
      for (const h of book.polities.terran.hulls) if (Number(h.systemIndex) === pick.target) h.systemIndex = w.neighbours(pick.target).map(Number).find((x) => w.systems[x].controller === 'terran') ?? h.systemIndex;
      const keep = book.polities.terran.hulls.find((h) => h.status === 'ready' && !h.opId && !h.transit); if (keep) keep.systemIndex = pick.target;
      t.markSystemVisited(pick.target); window.__place(pick.target); window.__reset();
      const res = t.runCampaignAuthored((b, wo, fx) => t.DoctrineCampaign.orderRaid(b, wo, { power: 'klingon', target: pick.target, hullId: pick.raider.id, day: t.state.day, doctrine: t.getDoctrineRuntime() }, fx));
      if (!res?.ok) return { fail: `raid refused: ${res?.reason}` };
      let enc = null;
      for (let k = 0; k < 60 && !enc; k++) { t.advanceFleetCalendar(1, t.Fleet.nextId(t.fleetBook(), 'journey')); enc = window.__enc('raid'); }
      if (!enc) return { fail: 'no raid handoff', actions: res.objective.actions.slice(-4) };
      window.__seconds(3);
      const active = { status: enc.status, npcs: window.__npcs(enc.id).map((n) => [n.encounterSide, n.vid]) };
      window.__seconds(64);
      const o = db.objectives.find((x) => x.id === enc.objective.ref);
      return { active, status: enc.status, result: enc.result, fates: enc.participants.map((p) => [p.side, p.vid, p.fate]), raid: { status: o.status, strikeDays: o.strikeDays, tacticalDay: o.tacticalDay }, raiderVid: window.__vid(pick.raider) };
    });
    evidence.push({ check: 'RAID-IN-SCENE', ...r });
    assert.ok(!r.fail, `${r.fail} ${JSON.stringify(r.actions || '')}`);
    assert.equal(r.active.status, 'tactical_active');
    assert.ok(r.active.npcs.some(([side, vid]) => side === 'attacker' && vid === r.raiderVid), 'the raider in the scene is not the raid\'s own hull');
    assert.equal(r.status, 'resolved');
    assert.ok(r.raid.tacticalDay != null || r.raid.status !== 'active');
  });

  await check('new-feature', 'DEBUG-ENCOUNTERS the debug section lists every encounter: id, system, type, participant vids and fates, objective, authority, handoff state, tactical result, continuation and fallback (SHOT)', async () => {
    const r = await ev(() => { testBM1.openDebugMenu(); const el = document.querySelector('[data-encounter-table]'); const txt = el ? el.textContent : null; const head = document.querySelector('[data-encounter-stats]')?.textContent || null; document.getElementById('cheats-debug').close(); return { txt, head }; });
    evidence.push({ check: 'DEBUG-ENCOUNTERS', ...r });
    assert.ok(r.head && /Opened/.test(r.head), r.head);
    assert.ok(r.txt && /tactical_active|resolved|fallback|aborted/.test(r.txt), r.txt);
    await shotSection('TH-debug-encounter-record.png', '[data-encounter-section]');
  });

  await check('baseline-defect', 'CAPTAIN-LEGS the captain\'s course takes the chart\'s legs: an uninterrupted multi-leg course arrives on the day the legs add up to, crossing every system on the way once', async () => {
    await fresh('th-legs'); await setup();
    const r = await ev(() => {
      const t = testBM1;
      const P = window.__idx('Paso'), E = window.__idx('Earth');
      for (const i of [P, E]) t.markSystemVisited(i);
      window.__place(P);
      const f = window.__fly(E);
      return { ...f, crossings: t.state.warp.crossings || null };
    });
    evidence.push({ check: 'CAPTAIN-LEGS', ...r });
    assert.equal(r.at, await ev(() => window.__idx('Earth')));
    if (r.legDays) assert.equal(r.day - r.day0, r.legDays.reduce((n, d) => n + d, 0));
    if (r.crossings) assert.deepEqual(r.crossings.map((c) => c.system), r.path.slice(1));
  });

  fs.writeFileSync(path.join(out, 'strategic-tactical-handoff-gate.json'), JSON.stringify({ hasHandoff, interceptSeed, results, evidence }, null, 1));
  const byCat = (c) => { const x = results.filter((y) => y.category === c); return `${x.filter((y) => y.ok).length}/${x.length}`; };
  console.log(`\nstrategic tactical handoff in-game: ${results.filter((x) => x.ok).length}/${results.length} (baseline-defect ${byCat('baseline-defect')}, new-feature ${byCat('new-feature')}, preservation ${byCat('preservation')})`);
  if (probe.errors.length) console.log('page errors:', probe.errors.slice(0, 5));
  await probe.close();
  process.exit(results.every((x) => x.ok) && !probe.errors.length ? 0 : 1);
})().catch((e) => { console.error(e); process.exit(1); });
