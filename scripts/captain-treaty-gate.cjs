// In-game gate for the captain's personal warp under treaty terms (TREATY-EXPANSION, captain's warp correction).
// The same persistent personal vessel; the treaties that bind his empire apply to his own course as to his
// formations: a course through a DMZ offers ROUTE AROUND / CANCEL (and VIOLATE TREATY where defiance is
// permitted); a prohibited destination with no lawful route is refused; a transit guarantee opens it; a
// defiant crossing is one breach through the shared incident engine and no war; every leg boundary re-checks the
// treaties; inspections see only what the regime allows; save/load keeps the course; the strategic↔tactical
// handoff still stops him at a blockaded, treaty-restricted system and resumes. Categories:
//   baseline-defect  db11c10 lets the captain's course straight through a DMZ that binds his empire
//   new-feature      needs this correction
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
  await page.waitForFunction(() => !testBM1.doctrineStatus || testBM1.doctrineStatus().state !== 'loading', null, { timeout: 30000 }).catch(() => {});
  const setup = () => page.evaluate(() => {
    const t = testBM1;
    window.__idx = (name) => t.getSystemIndexByName(name);
    window.__quiet = () => { const db = t.DoctrineCampaign.doctrineBook(t.campaign()); db.config = { ...db.config, patrols: {}, explorers: {}, merchants: {}, projects: {}, patrolAreas: {}, militaryResponses: false, enforcementResponses: false }; t.campaign().config.aiStrategicOps = false; t.campaign().config.aiRecovery = false; };
    window.__term = (spec) => { const book = t.campaign(); t.syncPlayerPolity(book); const eff = []; const r = t.Campaign.addTreatyTerm(book, t.buildCampaignWorld(true), spec, t.state.day, eff); t.applyCampaignEffects(eff, t.state.day); if (!r.ok) throw new Error(r.reason); return r.term.id; };
    // A long-range Terran warship for the captain (a re-routed course is longer than the chart's; the ship's own
    // warp range still applies as always).
    window.__longRange = () => { const ships = Object.values(t.state.shipStatsById).filter((x) => x && x.assetType === 'ship' && t.getShipFaction(x.id) === 'terran' && t.shipClassCombat(x.id) > 0.5); const best = ships.sort((a, b) => t.getShipWarpRange(b.id) - t.getShipWarpRange(a.id))[0]; if (best && t.getShipWarpRange(best.id) > t.getShipWarpRange()) { t.state.playership = Number(best.id); t.applyCurrentShipStats(true); } return t.getShipWarpRange(); };
    window.__place = (sys) => { for (let i = 0; i < t.state.planets.length; i++) t.markSystemVisited(i); t.state.currentPlanet = sys; t.state.myplanet = sys + 1; t.state.docked = false; t.applySystemState(sys); t.placePlayerAtSecurityApproach?.(); window.__longRange(); t.state.hull = 100; t.state.fuelCap = Math.max(t.state.fuelCap, 9999); t.state.antimatter = Math.max(t.state.antimatter, 9999); };
    // The captain's own Jump button on the star chart, as he presses it.
    window.__jump = (to, choice = null) => { t.state.mapOpen = true; t.state.selectedPlanet = to; t.state.fuelCap = Math.max(t.state.fuelCap, 9999); t.state.antimatter = Math.max(t.state.antimatter, 9999); if (choice) t.jumpPlanet({ treaty: choice }); else t.jumpPlanet(); const d = document.getElementById('treaty-course-choice'); return { warp: t.state.warp.active, path: t.state.warp.active ? t.state.warp.path.slice() : null, dialog: d?.open ? { status: d.querySelector('[data-treaty-course-status]')?.dataset.treatyCourseStatus, buttons: [...d.querySelectorAll('[data-treaty-course]')].map((b) => b.dataset.treatyCourse), text: d.textContent.trim() } : null }; };
    window.__arrive = () => { t.openWarpBriefing?.(); t.closeGalaxyReports?.(); t.completeWarpTravel(); return { at: t.state.currentPlanet, crossings: (t.state.warp.crossings || []).map((c) => c.system), replots: t.state.warp.treatyReplots || [], stop: t.state.warp.stop || null }; };
    window.__inc = () => (t.campaign().treatyIncidents || []).map((x) => ({ kind: x.kind, state: x.state, breaching: x.breaching, knownTo: x.knownTo, key: x.key }));
    window.__warSnap = () => JSON.stringify(Object.values(t.campaign().warStates || {}).filter((s) => s.key === 'klingon:player').map((s) => [s.status === 'war' ? 'war' : 'not-war', s.instance]));
    window.__declared = () => (t.galaxyNewsBook().items || []).filter((r) => /^diplomacy:declared:/.test(String(r.id)) && String(r.id).includes('player')).length;
    window.__S = () => ({ O: window.__idx('Orion'), N: window.__idx('Oce Nu'), R: window.__idx('Narendra'), E: window.__idx('Earth') });
    // A course of at least three legs whose chart route crosses Oce Nu on its last-but-one leg: Earth → Epsilon →
    // Oce Nu → Narendra on the real chart (searched, not assumed).
    window.__threeLeg = () => { const S = window.__S(); for (const start of [S.E, S.O, window.__idx('Epsilon')]) for (const d of t.buildCampaignWorld(true).neighbours(S.N)) { const r = t.getPlottedRoute(start, d); if (r && r.systems.length >= 4 && Number(r.systems[r.systems.length - 2]) === S.N) return { start, dest: Number(d), chart: r.systems.map(Number) }; } return null; };
  });
  async function shot(file) { await page.waitForTimeout(120); await page.screenshot({ path: path.join(out, file) }); }

  // 1 ---------------------------------------------------------------------------------------------
  await check('baseline-defect', 'CT-1 REROUTE a personal course Orion → Narendra whose chart route crosses the empire–Klingon DMZ at Oce Nu: the captain is offered DMZ — Military transit prohibited / ROUTE AROUND / CANCEL / VIOLATE TREATY; ROUTE AROUND flies a lawful route that never enters Oce Nu', async () => {
    await fresh('ct-1'); await setup();
    const r = await ev(() => {
      const t = testBM1, S = window.__S();
      window.__quiet(); window.__place(S.O);
      if (typeof t.Campaign.addTreatyTerm !== 'function') { const j = window.__jump(S.R); return { S, first: j }; }
      window.__term({ type: 'dmz', parties: ['player', 'klingon'], systems: [S.N] });
      const chart = t.getPlottedRoute(S.O, S.R).systems;
      const first = window.__jump(S.R);
      return { S, chart, first };
    });
    evidence.reroute = r;
    assert.ok(!r.first.warp, `the captain went straight into the DMZ: ${JSON.stringify(r.first.path)}`);
    assert.ok(r.chart.includes(r.S.N), 'precondition: the chart route passes Oce Nu');
    assert.equal(r.first.dialog?.status, 'reroute');
    assert.deepEqual(r.first.dialog.buttons, ['around', 'cancel', 'violate']);
    assert.match(r.first.dialog.text, /DMZ — Military transit prohibited\./);
    await shot('CT-1-course-choice-route-around.png');
    const r2 = await ev(() => { const S = window.__S(); const j = window.__jump(S.R, 'around'); const a = window.__arrive(); return { j, a, inc: window.__inc() }; });
    evidence.reroute2 = r2;
    assert.ok(r2.j.warp); assert.ok(!r2.j.path.includes(r.S.N));
    assert.equal(r2.a.at, r.S.R); assert.ok(!r2.a.crossings.includes(r.S.N));
    assert.equal(r2.inc.length, 0);
  });

  // 2 ---------------------------------------------------------------------------------------------
  await check('new-feature', 'CT-2 REFUSED a personal course to Oce Nu itself: no lawful route exists — refused (CANCEL / VIOLATE TREATY, no ROUTE AROUND); CANCEL leaves him where he is', async () => {
    const r = await ev(() => {
      const t = testBM1, S = window.__S();
      window.__place(S.O);
      const j = window.__jump(S.N);
      document.querySelector('[data-treaty-course="cancel"]')?.click();
      return { S, j, after: { warp: t.state.warp.active, at: t.state.currentPlanet, open: document.getElementById('treaty-course-choice')?.open } };
    });
    evidence.refused = r;
    assert.equal(r.j.warp, false); assert.equal(r.j.dialog?.status, 'refused');
    assert.deepEqual(r.j.dialog.buttons, ['cancel', 'violate']);
    assert.equal(r.after.warp, false); assert.equal(r.after.at, r.S.O); assert.equal(r.after.open, false);
    await ev(() => { const S = window.__S(); window.__jump(S.N); });
    await shot('CT-2-course-refused.png');
    await ev(() => document.querySelector('[data-treaty-course="cancel"]')?.click());
  });

  // 3 ---------------------------------------------------------------------------------------------
  await check('new-feature', 'CT-3 GUARANTEE with Klingon\'s transit guarantee to the empire through Oce Nu, the course Orion → Narendra flies straight through it, no choice offered, no incident', async () => {
    const r = await ev(() => {
      const S = window.__S();
      window.__term({ type: 'transit', grantor: 'klingon', beneficiary: 'player', systems: [S.N] });
      window.__place(S.O);
      const j = window.__jump(S.R); const a = j.warp ? window.__arrive() : null;
      return { S, j, a, inc: window.__inc() };
    });
    evidence.guarantee = r;
    assert.ok(r.j.warp && !r.j.dialog); assert.ok(r.j.path.includes(r.S.N));
    assert.equal(r.a.at, r.S.R); assert.equal(r.inc.length, 0);
  });

  // 4 ---------------------------------------------------------------------------------------------
  await check('new-feature', 'CT-4 SAME-FLAG the captain flies the Terran flag, but a guarantee to the Terran government is not his empire\'s: a DMZ binding his empire still refuses his course', async () => {
    await fresh('ct-4'); await setup();
    const r = await ev(() => {
      const t = testBM1, S = window.__S();
      window.__quiet(); window.__place(S.O);
      window.__term({ type: 'dmz', parties: ['player', 'klingon'], systems: [S.N] });
      window.__term({ type: 'transit', grantor: 'klingon', beneficiary: 'terran', systems: [S.N] });
      const flag = t.getPlayerFlag?.();
      const j = window.__jump(S.R);
      document.querySelector('[data-treaty-course="cancel"]')?.click();
      return { flag, j };
    });
    evidence.sameFlag = r;
    assert.equal(r.flag, 'terran');
    assert.equal(r.j.warp, false); assert.equal(r.j.dialog?.status, 'reroute');
  });

  // 5–7 -------------------------------------------------------------------------------------------
  await check('new-feature', 'CT-5/6/7 DEFIANCE VIOLATE TREATY flies the chart route through Oce Nu: one dmz_entry breach by the empire, observed by Klingon (one engine: the shared treaty incident record); no war declared, no war state changed; crossing it again on the same (resumed) course files nothing new, while a new defiant course is a new incident', async () => {
    const r = await ev(() => {
      const t = testBM1, S = window.__S();
      window.__place(S.O);
      const before = window.__declared(), snap = window.__warSnap();
      const j = window.__jump(S.R, 'violate');
      const w = t.state.warp;
      const courseId = w.courseId, defy = w.treatyDefy;
      const a = window.__arrive();
      const inc1 = window.__inc();
      // The same course re-crossing Oce Nu (as a course resumed after a stop there would): the same course key.
      t.captainTreatyCrossing(S.N, { courseId, treatyDefy: true, trafficClass: 'military', kind: 'resume' }, 0);
      const inc2 = window.__inc();
      // A new defiant course back through Oce Nu: a new incident.
      const back = window.__jump(S.O, 'violate'); window.__arrive();
      const inc3 = window.__inc();
      return { S, j, defy, a, inc1, inc2, inc3, declared: window.__declared() - before, snapSame: window.__warSnap() === snap, rel: t.campaign().warStates?.['klingon:player']?.status ?? null };
    });
    evidence.defiance = r;
    assert.ok(r.j.warp && r.j.path.includes(r.S.N)); assert.equal(r.defy, true);
    assert.equal(r.a.at, r.S.R);
    const entries = r.inc1.filter((x) => x.kind === 'dmz_entry');
    assert.equal(entries.length, 1); assert.equal(entries[0].state, 'breach'); assert.equal(entries[0].breaching, 'player'); assert.ok(entries[0].knownTo.includes('klingon'));
    assert.equal(r.declared, 0); assert.ok(r.snapSame, 'a war state changed');
    assert.equal(r.inc2.length, r.inc1.length, 're-crossing on the same course filed a second incident');
    assert.equal(r.inc3.filter((x) => x.kind === 'dmz_entry').length, 2, 'a new defiant course was not its own incident');
    await ev(() => { testBM1.closeGalaxyReports?.(); testBM1.openCampaignPanel('wars'); document.querySelector('[data-war-treaties]')?.scrollIntoView({ block: 'start' }); });
    await page.waitForTimeout(150);
    await page.locator('[data-war-treaties]').first().screenshot({ path: path.join(out, 'CT-5-personal-defiance-breach.png') });
    await ev(() => document.querySelectorAll('dialog[open]').forEach((d) => d.close()));
  });

  // 8 ---------------------------------------------------------------------------------------------
  await check('new-feature', 'CT-8 BEGINS-IN-WARP a DMZ at Oce Nu that begins the day after he leaves Earth for Narendra (Earth → Orion → Oce Nu → Narendra): at Orion the rest is re-routed lawfully, Oce Nu is never entered, he still reaches Narendra', async () => {
    await fresh('ct-8'); await setup();
    const r = await ev(() => {
      const t = testBM1, S = window.__S();
      window.__quiet(); window.__place(S.E);
      const c = window.__threeLeg(); if (!c) return { fail: 'no three-leg course through Oce Nu' };
      window.__place(c.start);
      const j = window.__jump(c.dest);
      window.__term({ type: 'dmz', parties: ['player', 'klingon'], systems: [S.N], startDay: t.state.day + 1 });
      const a = window.__arrive();
      return { S, c, j, a, inc: window.__inc() };
    });
    evidence.beginsInWarp = r;
    assert.ok(!r.fail, r.fail);
    assert.ok(r.j.warp && r.j.path.includes(r.S.N));
    assert.equal(r.a.replots.length, 1); assert.equal(r.a.replots[0].at, r.c.chart[1]);
    assert.ok(!r.a.crossings.includes(r.S.N)); assert.equal(r.a.at, r.c.dest);
    assert.equal(r.inc.length, 0);
  });

  // 9 ---------------------------------------------------------------------------------------------
  await check('new-feature', 'CT-9 ENDS-IN-WARP the guarantee through Oce Nu lapses the day after he leaves Earth: the course that was lawful through Oce Nu is re-routed at Orion (the remaining lawful route updates at the boundary)', async () => {
    await fresh('ct-9'); await setup();
    const r = await ev(() => {
      const t = testBM1, S = window.__S();
      window.__quiet(); window.__place(S.E);
      const c = window.__threeLeg(); if (!c) return { fail: 'no three-leg course through Oce Nu' };
      window.__place(c.start);
      window.__term({ type: 'dmz', parties: ['player', 'klingon'], systems: [S.N] });
      window.__term({ type: 'transit', grantor: 'klingon', beneficiary: 'player', systems: [S.N], endDay: t.state.day });
      const j = window.__jump(c.dest);
      const a = window.__arrive();
      return { S, c, j, a, inc: window.__inc() };
    });
    evidence.endsInWarp = r;
    assert.ok(!r.fail, r.fail);
    assert.ok(r.j.warp && r.j.path.includes(r.S.N), 'precondition: the guarantee opened Oce Nu at departure');
    assert.equal(r.a.replots.length, 1); assert.equal(r.a.replots[0].at, r.c.chart[1]); assert.ok(!r.a.crossings.includes(r.S.N)); assert.equal(r.a.at, r.c.dest);
    assert.equal(r.inc.length, 0);
  });

  // 10 --------------------------------------------------------------------------------------------
  await check('new-feature', 'CT-10 SECRET a secret Klingon–Romulan DMZ at Oce Nu (not his empire\'s, unknown to him): his course passes, nothing is offered, logged or shown that names it', async () => {
    await fresh('ct-10'); await setup();
    const r = await ev(() => {
      const t = testBM1, S = window.__S();
      window.__quiet(); window.__place(S.O);
      const id = window.__term({ type: 'dmz', parties: ['klingon', 'romulan'], systems: [S.N], secret: true });
      const j = window.__jump(S.R); const a = window.__arrive();
      t.openCampaignPanel('wars');
      const html = document.querySelector('[data-war-treaties]')?.innerHTML || '';
      document.querySelectorAll('dialog[open]').forEach((d) => d.close());
      const logs = String(t.state.log || '') + ' ' + (document.getElementById('log')?.textContent || '');
      const reports = (t.galaxyNewsBook().items || []).filter((x) => String(x.id).includes(id) || /romulan.*klingon.*DMZ|DMZ.*romulan/i.test(x.text || '')).length;
      return { j, a, shown: html.includes(id) || /Romulan/.test(html), logDMZ: /DMZ/.test(logs), reports, S };
    });
    evidence.secret = r;
    assert.ok(r.j.warp && !r.j.dialog); assert.ok(r.j.path.includes(r.S.N));
    assert.equal(r.shown, false); assert.equal(r.logDMZ, false); assert.equal(r.reports, 0);
  });

  // 11 --------------------------------------------------------------------------------------------
  await check('new-feature', 'CT-11 INSPECTION Klingon inspects the empire\'s military traffic at Oce Nu (a guarantee lets him through): his ship is asked to heave to, complies, and the inspection sees only his declared hold — never the concealed pod, never destinations or payouts', async () => {
    await fresh('ct-11'); await setup();
    const r = await ev(() => {
      const t = testBM1, S = window.__S(), s = t.state;
      window.__quiet(); window.__place(S.O);
      window.__term({ type: 'inspection', inspector: 'klingon', inspected: 'player', systems: [S.N], traffic: ['military', 'civilian'] });
      s.cargoArray[0] = { tons: 4, item: 'Dilithium', destination: S.R, payout: 900 };
      s.cargoArray[1] = { tons: 2, item: 'Contraband Disruptors', destination: S.R, payout: 400, concealed: true };
      const j = window.__jump(S.R); const a = window.__arrive();
      const x = (t.campaign().treatyInspections || []).slice(-1)[0];
      return { j, a, x };
    });
    evidence.inspection = r;
    assert.ok(r.x, 'no inspection');
    assert.deepEqual(r.x.history.map((h) => h.state), ['requested', 'completed']);
    assert.deepEqual(r.x.observed, { manifest: [{ cargoId: 'Dilithium', quantity: 4 }] });
  });

  // 12 --------------------------------------------------------------------------------------------
  await check('new-feature', 'CT-12 SAVE-LOAD a re-routed course saved mid-warp and reloaded keeps its treaty state (class, course id, lawful path) and arrives by the lawful route', async () => {
    await fresh('ct-12'); await setup();
    const r = await ev(() => {
      const t = testBM1, S = window.__S();
      window.__quiet(); window.__place(S.O);
      window.__term({ type: 'dmz', parties: ['player', 'klingon'], systems: [S.N] });
      window.__jump(S.R, 'around');
      const before = { path: t.state.warp.path.slice(), courseId: t.state.warp.courseId, cls: t.state.warp.trafficClass };
      t.saveGame(3); t.loadGame(3);
      const after = { active: t.state.warp.active, path: t.state.warp.path?.slice(), courseId: t.state.warp.courseId, cls: t.state.warp.trafficClass };
      const a = window.__arrive();
      return { S, before, after, a };
    });
    evidence.saveLoad = r;
    assert.equal(r.after.active, true); assert.deepEqual(r.after, { active: true, ...r.before });
    assert.equal(r.a.at, r.S.R); assert.ok(!r.a.crossings.includes(r.S.N));
  });

  // 13 --------------------------------------------------------------------------------------------
  // Paso → Alpha Centauri → Earth, Alpha Centauri a treaty-restricted system (an empire–Romulan DMZ the Romulans
  // guarantee him through) blockaded by Klingon: the seed is searched until the crossing is intercepted.
  const interceptScene = () => ev(() => {
    const t = testBM1;
    const P = window.__idx('Paso'), AC = window.__idx('Alpha Centauri'), E = window.__idx('Earth');
    window.__quiet(); window.__place(P);
    window.__term({ type: 'dmz', parties: ['player', 'romulan'], systems: [AC] });
    window.__term({ type: 'transit', grantor: 'romulan', beneficiary: 'player', systems: [AC] });
    const book = t.campaign(); t.syncPlayerPolity(book);
    const kl = book.polities.klingon.hulls.filter((h) => h.status === 'ready' && !h.opId && !h.transit).slice(0, 12);
    for (const h of kl) h.systemIndex = AC;
    const fx = [];
    const b = t.Campaign.startBlockade(book, t.buildCampaignWorld(true), { power: 'klingon', target: AC, hullIds: kl.map((h) => h.id), purpose: 'interdict_trade' }, t.state.day, fx);
    t.applyCampaignEffects(fx, t.state.day);
    return { P, AC, E, bid: b.ok ? b.record.id : null };
  });
  const seed = await (async () => {
    for (let i = 0; i < 60; i++) {
      await fresh(`ct-13-${i}`); await setup();
      const s = await interceptScene();
      if (!s.bid) continue;
      const f = await ev((s) => { const j = window.__jump(s.E); const a = window.__arrive(); return { j, a }; }, s);
      if (f.a.at === s.AC && f.a.stop?.type === 'blockade') return i;
    }
    return null;
  })();
  await check('preservation', 'CT-13 HANDOFF the captain\'s course Paso → Alpha Centauri → Earth through a treaty-restricted Alpha Centauri (guaranteed to him) under a Klingon blockade: the strategic layer stops him there for the scene, and the course resumes to Earth once — treaty-aware, with no treaty incident', async () => {
    assert.ok(seed != null, 'no seed intercepted the captain');
    await fresh(`ct-13-${seed}`); await setup();
    const s = await interceptScene();
    const r = await ev((s) => {
      const t = testBM1;
      const j = window.__jump(s.E); const a = window.__arrive();
      const resume = t.state.warpResume ? { destination: t.state.warpResume.destination, courseId: t.state.warpResume.courseId, path: t.state.warpResume.path } : null;
      const enc = (t.campaign().encounters || []).filter((e) => e.type === 'blockade').slice(-1)[0];
      if (enc) t.resolveStrategicEncounter(enc, { outcome: 'disengaged' });
      const ok = t.resumeCaptainCourse();
      const resumedCourse = t.state.warp.courseId;
      const a2 = ok ? window.__arrive() : null;
      return { j, a, resume, ok, resumedCourse, a2, inc: window.__inc() };
    }, s);
    evidence.handoff = { seed, s, ...r };
    assert.equal(r.a.at, s.AC); assert.equal(r.a.stop?.type, 'blockade');
    assert.equal(r.resume?.destination, s.E);
    assert.equal(r.ok, true); assert.equal(r.resumedCourse, r.resume.courseId, 'the resumed course is not the same course');
    assert.equal(r.a2?.at, s.E);
    assert.equal(r.inc.length, 0);
  });

  const failed = results.filter((x) => !x.ok);
  const by = (c) => `${c} ${results.filter((x) => x.category === c && x.ok).length}/${results.filter((x) => x.category === c).length}`;
  console.log(`captain treaty in-game: ${results.length - failed.length}/${results.length} (${['baseline-defect', 'new-feature', 'preservation'].map(by).join(', ')})`);
  fs.writeFileSync(path.join(out, 'captain-treaty-gate.json'), JSON.stringify({ results, evidence, errors: probe.errors.slice(0, 10) }, null, 1));
  if (probe.errors.length) console.log('page errors:', probe.errors.slice(0, 5));
  await probe.close();
  process.exit(failed.length || probe.errors.length ? 1 : 0);
})();
