// Gate for faction doctrine runtime phase 1, stacked on 372fe66.
// Rules: docs/doctrine/DOCTRINE-RUNTIME-PHASE1.md.
//
// Categories:
//   baseline-defect  fails on 372fe66, which does not load the doctrine package and has no incident,
//                    knowledge or doctrine evaluation at all
//   new-feature      needs state 372fe66 does not have
//   preservation     must hold on both
const assert = require('node:assert/strict');
const path = require('node:path');
const fs = require('node:fs');
const { startProbe } = require('./probe-harness.cjs');

const ROOT = path.join(__dirname, '..');
const CASES = JSON.parse(fs.readFileSync(path.join(ROOT, 'docs/doctrine/doctrine-acceptance.json'), 'utf8')).cases;
const DATA = JSON.parse(fs.readFileSync(path.join(ROOT, 'docs/doctrine/bm1-faction-doctrine.v0.2.1.json'), 'utf8'));
const SCHEMA = JSON.parse(fs.readFileSync(path.join(ROOT, 'docs/doctrine/bm1-faction-doctrine.schema.json'), 'utf8'));

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
  // The Cheats & Debug dialog scrolls; for a picture of the whole doctrine section it is laid out at its
  // full height and the viewport grown to fit, then restored.
  async function shotDoctrine(file, focus = null) {
    // Only the doctrine section is laid out: the sections above it (the strategic journeys' debug among them, a few
    // lines per journey since SHIP-DEPENDENT-STRATEGIC-SPEED's rated debug fields) would otherwise push it past
    // what the browser can capture in one picture.
    await ev(() => { const d = document.getElementById('cheats-debug'); if (!d.open) testBM1.openDebugMenu(); for (const x of d.querySelectorAll('section')) if (!x.matches('[data-doctrine-section]')) x.style.display = 'none'; d.style.maxHeight = 'none'; d.style.height = 'auto'; d.style.width = '1360px'; d.style.maxWidth = 'none'; d.style.overflow = 'visible'; d.style.position = 'absolute'; d.style.top = '0'; });
    const h = await ev(() => Math.ceil(document.querySelector('[data-doctrine-section]').getBoundingClientRect().bottom + window.scrollY + 40));
    await page.setViewportSize({ width: 1400, height: Math.min(16000, Math.max(900, h)) });
    await page.locator('[data-doctrine-section]').screenshot({ path: path.join(out, file) });
    await page.setViewportSize({ width: 1400, height: 900 });
    await ev(() => { const d = document.getElementById('cheats-debug'); for (const x of d.querySelectorAll('section')) x.style.display = ''; d.removeAttribute('style'); d.close(); });
  }
  await page.waitForFunction(() => !testBM1.doctrineStatus || testBM1.doctrineStatus().state !== 'loading', null, { timeout: 30000 }).catch(() => {});

  const setup = () => page.evaluate(() => {
    const t = testBM1;
    window.__adv = (n) => { for (let i = 0; i < n; i++) t.advanceFleetCalendar(1, t.Fleet.nextId(t.fleetBook(), 'journey')); };
    window.__idx = (name) => t.getSystemIndexByName(name);
    // The real length in days of a hop (STRATEGIC-MOVEMENT-UNIFICATION): test windows are counted in legs.
    // The route's days; with a hull, at that hull's strategic speed (SHIP-DEPENDENT-STRATEGIC-SPEED; the chart's on a build without it).
    window.__leg = (a, b, h = null) => { const w = t.buildCampaignWorld(true); return t.Campaign.journeyDays(w, window.__idx(a), window.__idx(b), 'romulan', h && t.Campaign.hullSpeed ? t.Campaign.hullSpeed(w, h) : null); };
    window.__D = () => t.DoctrineCampaign.doctrineBook(t.campaign());
    window.__P = (id) => t.campaign().polities[id];
    window.__ready = (polity, at = null) => (window.__P(polity)?.hulls || []).filter((h) => h.status === 'ready' && !h.opId && (at == null || h.systemIndex === at)).sort((a, b) => String(a.id).localeCompare(String(b.id)));
    // Routine pilot generation off: each scenario issues exactly the jobs it needs.
    window.__quiet = () => { const db = window.__D(); db.config = { ...db.config, patrols: {}, explorers: {}, merchants: {}, projects: {}, patrolAreas: {}, militaryResponses: false, enforcementResponses: false, predation: false }; };
    window.__authored = (fn) => t.runCampaignAuthored(fn);
    window.__patrol = (polity, hullId, target, opts = {}) => window.__authored((book, world, fx) => t.DoctrineCampaign.issuePatrol(book, world, polity, hullId, target, t.state.day, fx, opts));
    window.__assign = (spec) => window.__authored((book, world, fx) => t.DoctrineCampaign.issueAssignment(book, world, spec, t.state.day, fx));
    // Phase 1's losses are silent (the ship's comms went with it); phase 2's distress calls are gated separately.
    window.__lose = (asgId, mode = 'destroyed') => t.DoctrineCampaign.loseAssignmentHullUnwitnessed(t.campaign(), t.buildCampaignWorld(true), asgId, t.state.day, mode, { silent: true });
    window.__relay = (inc, from, to, opts = {}) => t.DoctrineCampaign.relayReport(t.campaign(), t.buildCampaignWorld(true), inc, from, to, t.state.day, opts);
    window.__eval = (obs, inc) => window.__D().lastEval[`${obs}|${inc}`] || null;
    window.__incOf = (polity) => Object.values(window.__D().incidents).filter((i) => i.polity === polity);
    window.__reports = () => (t.galaxyNewsBook().items || []).concat(t.galaxyNewsBook().pending || []);
    // A Romulan patrol Romulus → Aldnas → Romulus, lost unwitnessed once on station.
    window.__romulanLost = (mode = 'destroyed') => {
      const R = window.__idx('Romulus'), A = window.__idx('Aldnas');
      const h = window.__ready('romulan', R)[0];
      const r = window.__patrol('romulan', h.id, A);
      if (!r?.ok) throw new Error(`patrol refused: ${r?.reason}`);
      // On station: legs take their real length (STRATEGIC-MOVEMENT-UNIFICATION), so fly until it has
      // reported its arrival at Aldnas (never more than a leg's worth of days).
      window.__adv(1);
      for (let k = 0; k < 40 && !(r.assignment.milestones[0]?.status === 'met' && Number(h.systemIndex) === A); k++) window.__adv(1);
      const lost = window.__lose(r.assignment.id, mode);
      if (!lost.ok) throw new Error(lost.reason);
      const m = r.assignment.milestones.at(-1);
      return { hullId: h.id, vid: h.identity?.vid, asg: r.assignment.id, detectDay: m.dueDay + m.grace + 1, R, A };
    };
  });

  // 1 ---------------------------------------------------------------------------------------------
  await check('baseline-defect', 'DOCTRINE-LOADED the game loads the v0.2.1 doctrine package as runtime data and validates it; the in-browser evaluator reproduces the package\'s 59/59 cases', async () => {
    const r = await ev((cases) => {
      const t = testBM1;
      if (typeof t.getDoctrineRuntime !== 'function' || !t.getDoctrineRuntime()) return { loaded: false };
      const d = t.getDoctrineRuntime();
      const res = t.Doctrine.runAcceptance(d, cases);
      return { loaded: true, status: t.doctrineStatus(), profiles: Object.keys(d.data.profiles).length, cultures: Object.keys(d.data.cultures).length, passed: res.filter((x) => x.ok).length, total: res.length, failed: res.filter((x) => !x.ok) };
    }, CASES);
    evidence.push({ check: 'DOCTRINE-LOADED', ...r });
    assert.ok(r.loaded, 'the game does not load the doctrine package (it is design-only on this build)');
    assert.equal(r.status.state, 'loaded'); assert.equal(r.profiles, 22); assert.equal(r.cultures, 9);
    assert.equal(r.passed, 59, JSON.stringify(r.failed));
  });
  await setup();

  // 2 ---------------------------------------------------------------------------------------------
  await check('baseline-defect', 'OVERDUE-NOTICED a Romulan patrol that never returns is noticed by Romulan command alone, as one persistent incident after its check-in plus grace, and an existing ship is sent to look', async () => {
    await fresh('dg-noticed');
    const r = await ev(() => {
      const t = testBM1;
      if (!t.DoctrineCampaign) {
        // What 372fe66 can do with the same situation: a Romulan ship sent to Aldnas and lost there.
        const R = window.__idx('Romulus'), A = window.__idx('Aldnas');
        const h = (t.campaign().polities.romulan.hulls || []).find((x) => x.status === 'ready' && x.systemIndex === R);
        h.systemIndex = A; h.status = 'lost'; h.hull = 0;
        window.__adv(20);
        const book = t.campaign();
        return { build: 'no doctrine runtime', incidents: Object.keys(book.doctrine?.incidents || {}).length, anySearch: false, historyMentions: (book.history || []).filter((x) => /Aldnas/.test(x.text || '')).length };
      }
      window.__quiet();
      const x = window.__romulanLost();
      const before = t.state.day;
      window.__adv(x.detectDay - t.state.day - 1);
      const early = window.__incOf('romulan').length;
      window.__adv(1);
      const inc = window.__incOf('romulan');
      const db = window.__D();
      const obj = db.objectives.find((o) => o.incidentId === inc[0]?.id);
      const knowers = Object.entries(db.knowledge).filter(([, s]) => s[inc[0]?.id]).map(([o]) => o);
      window.__adv(5);
      return { build: 'doctrine', early, incidents: inc.length, createdDay: inc[0]?.createdDay, detectDay: x.detectDay, knowers, anySearch: Boolean(obj), obj: obj && { hullId: obj.assigned.hullId, vid: obj.assigned.vid, target: obj.target.locationId, deadline: obj.deadline }, lostHull: x.hullId,
        stillOne: window.__incOf('romulan').length, day: t.state.day, from: before };
    });
    evidence.push({ check: 'OVERDUE-NOTICED', ...r });
    assert.ok(r.incidents > 0, `a Romulan ship lost at Aldnas went unnoticed: no incident, no search (${r.build})`);
    assert.equal(r.early, 0, 'the incident appeared before the check-in plus grace had passed');
    assert.equal(r.createdDay, r.detectDay);
    // Romulan command, and (phase 2) the crew it sends, briefed by their orders: nobody else.
    assert.ok(r.knowers.includes('command:romulan'), JSON.stringify(r.knowers));
    assert.deepEqual(r.knowers.filter((o) => o !== 'command:romulan'), r.obj ? [`hull:${r.obj.hullId}`] : [], JSON.stringify(r.knowers));
    assert.ok(r.anySearch, 'nobody was sent');
    assert.notEqual(r.obj.hullId, r.lostHull);
    assert.equal(r.stillOne, 1, 'the incident was recreated');
  });

  // 3 ---------------------------------------------------------------------------------------------
  await check('new-feature', 'MALFORMED-FAILS-SAFE a doctrine with an unknown fact, action or profile, a string expression or a missing file is refused with a clear development error; the valid runtime stays and the game runs on', async () => {
    const r = await ev(([data, schema]) => {
      const t = testBM1;
      const m = (fn) => { const d = JSON.parse(JSON.stringify(data)); fn(d); return d; };
      const tries = {
        fact: t.installDoctrine(m((d) => { d.profiles.klingon.interestRules[0].when = { fact: 'klingons_feel_insulted' }; }), schema, { install: false }),
        action: t.installDoctrine(m((d) => { d.roleTemplates.raider.intentPriority[0].action = 'glass_the_planet'; }), schema, { install: false }),
        profile: t.installDoctrine(m((d) => { d.scenarioTreaties[1].parties = ['dominion_central', 'orion_syndicate']; }), schema, { install: false }),
        expression: t.installDoctrine(m((d) => { d.actions.attack = "facts.war && eval('1')"; }), schema, { install: false }),
        missing: t.installDoctrine(null, null, { install: false, missing: 'docs/doctrine/absent.json' }),
      };
      const stillLoaded = t.doctrineStatus().state === 'loaded' && Boolean(t.getDoctrineRuntime());
      const day0 = t.state.day;
      window.__adv(2);
      return { tries: Object.fromEntries(Object.entries(tries).map(([k, v]) => [k, { ok: v.ok, error: (v.error || '').split('\n').slice(0, 3).join(' | ') }])), stillLoaded, advanced: t.state.day - day0 };
    }, [DATA, SCHEMA]);
    evidence.push({ check: 'MALFORMED-FAILS-SAFE', ...r });
    assert.match(r.tries.fact.error, /unknown fact reference klingons_feel_insulted/);
    assert.match(r.tries.action.error, /unknown actions reference glass_the_planet/);
    assert.match(r.tries.profile.error, /unknown profiles reference orion_syndicate/);
    assert.match(r.tries.expression.error, /schema/);
    assert.match(r.tries.missing.error, /not found/);
    for (const v of Object.values(r.tries)) assert.equal(v.ok, false);
    assert.ok(r.stillLoaded); assert.equal(r.advanced, 2);
  });

  // 4 ---------------------------------------------------------------------------------------------
  await check('new-feature', 'DEFER-NO-SPAWN with every Romulan ship committed, the credible overdue incident is deferred with its reason and nothing is spawned; once a ship is free the deferred response acts', async () => {
    await fresh('dg-defer');
    const r = await ev(() => {
      const t = testBM1;
      window.__quiet();
      const x = window.__romulanLost();
      const held = [];
      for (const h of window.__P('romulan').hulls) if (h.status === 'ready' && !h.opId) { h.status = 'assigned'; h.opId = 'gate:elsewhere'; held.push(h.id); }
      const count = () => Object.values(t.campaign().polities).reduce((n, p) => n + p.hulls.filter((h) => h.status !== 'lost').length, 0) - (t.campaign().stats.hullsBuilt || 0);
      window.__adv(x.detectDay - t.state.day + 1);
      const inc = window.__incOf('romulan')[0];
      const deferred = window.__eval('command:romulan', inc.id);
      const n0 = count();
      window.__adv(3);
      const stillDeferred = window.__eval('command:romulan', inc.id);
      const n1 = count();
      const objectives0 = window.__D().objectives.length;
      return { inc: inc.id, deferred, stillDeferred, n0, n1, objectives0, held };
    });
    evidence.push({ check: 'DEFER-NO-SPAWN', ...r });
    assert.equal(r.deferred.proposal, 'defer:investigate', JSON.stringify(r.deferred));
    assert.ok(r.deferred.failed.includes('can_respond'), JSON.stringify(r.deferred.failed));
    assert.match(r.deferred.notActing, /^defer:investigate — no spare armed vessel/);
    assert.equal(r.stillDeferred.proposal, 'defer:investigate');
    assert.equal(r.objectives0, 0); assert.equal(r.n1, r.n0, 'a vessel appeared');
    // Screenshot while deferred, then release and let it act.
    await shotDoctrine('DR-debug-deferred-no-asset.png');
    const after = await ev((held) => {
      const t = testBM1;
      for (const h of window.__P('romulan').hulls) if (held.includes(h.id)) { h.status = 'ready'; h.opId = null; }
      window.__adv(1);
      const inc = window.__incOf('romulan')[0];
      return { e: window.__eval('command:romulan', inc.id), objectives: window.__D().objectives.map((o) => [o.actor, o.response, o.status]) };
    }, r.held);
    evidence.push({ check: 'DEFER-NO-SPAWN (released)', ...after });
    assert.equal(after.e.proposal, 'investigate');
    assert.deepEqual(after.objectives, [['command:romulan', 'investigate', 'active']]);
  });

  // 5 ---------------------------------------------------------------------------------------------
  await check('new-feature', 'ROMULAN-INVESTIGATES the investigator is an existing Romulan hull; it keeps its vid through the objective and its return; the objective ends on its own terms', async () => {
    await fresh('dg-romulan');
    const r = await ev(() => {
      const t = testBM1;
      window.__quiet();
      const x = window.__romulanLost('disabled');
      window.__adv(x.detectDay - t.state.day + 1);
      const db = window.__D();
      const o = db.objectives[0];
      const h0 = window.__P('romulan').hulls.find((h) => h.id === o.assigned.hullId);
      const vid0 = h0.identity.vid;
      const L = window.__leg('Romulus', 'Aldnas');
      window.__adv(L + 3);
      const mid = { status: o.status, found: o.found || null, arrivedDay: o.arrivedDay ?? null, onSite: (o.actions || []).find((a) => a.action === 'investigate') || null };
      window.__adv(L + 5);
      const same = window.__P('romulan').hulls.filter((h) => h.identity?.vid === vid0);
      return { o: { actor: o.actor, response: o.response, template: o.template, clock: o.clock, created: o.createdDay, deadline: o.deadline, target: o.target, status: o.status, resolution: o.resolution, vid: o.assigned.vid }, vid0, mid, sameCount: same.length, sameId: same[0]?.id === h0.id,
        incident: Object.values(db.incidents)[0], aldnas: window.__idx('Aldnas') };
    });
    evidence.push({ check: 'ROMULAN-INVESTIGATES', ...r });
    assert.equal(r.o.actor, 'command:romulan'); assert.equal(r.o.template, 'investigation'); assert.equal(r.o.clock, 'strategic_jumps');
    assert.equal(r.o.vid, r.vid0); assert.equal(r.sameCount, 1); assert.ok(r.sameId);
    assert.ok(r.mid.arrivedDay != null && /system:aldnas/.test(r.mid.onSite?.detail || ''), `the investigator never reached Aldnas: ${JSON.stringify(r.mid)}`);
    assert.equal(r.o.status, 'completed', JSON.stringify(r.o.resolution));
    assert.ok(r.o.resolution.reasons.includes('evidence_recovered'));
    assert.equal(r.incident.status, 'resolved'); assert.equal(r.incident.resolution.status, 'asset_located');
  });

  // 6 ---------------------------------------------------------------------------------------------
  await check('new-feature', 'PLAYER-REPORTS the captain hears of a search only through a real source (here: present at Aldnas when the search arrives); with no source nothing arrives, and no report carries doctrine reasoning', async () => {
    const run = async (atRomulus) => { await fresh(`dg-reports-${atRomulus}`); return ev((atRomulus) => {
      const t = testBM1;
      window.__quiet();
      const R = window.__idx('Aldnas');
      if (atRomulus) { t.markSystemVisited(R); t.state.currentPlanet = R; t.applySystemState(R); }
      const x = window.__romulanLost();
      window.__adv(x.detectDay - t.state.day + window.__leg('Romulus', 'Aldnas') + 3);
      const reps = window.__reports().filter((rep) => String(rep.id || '').startsWith('doctrine:'));
      return { here: t.state.currentPlanet, R, reps: reps.map((rep) => ({ id: rep.id, kind: rep.kind, text: rep.text, confidence: rep.confidence, factions: rep.factions, claimedAttacker: rep.claimedAttacker ?? null })) };
    }, atRomulus); };
    const present = await run(true), absent = await run(false);
    evidence.push({ check: 'PLAYER-REPORTS', present, absent });
    assert.ok(present.reps.some((x) => /Romulan patrol overdue/.test(x.kind) && /Romulan ships at Aldnas are hailing for an overdue Romulan patrol/.test(x.text)), JSON.stringify(present.reps));
    assert.ok(!present.reps.some((x) => /departing/.test(x.kind)), 'the departure was reported without a source at the departure world');
    assert.equal(absent.reps.length, 0, `reports reached a captain with no source: ${JSON.stringify(absent.reps)}`);
    for (const x of present.reps) {
      assert.doesNotMatch(`${x.kind} ${x.text}`, /doctrine|profile|interest|rule|shadow|defer|attribut|investigate_|overdue_our/i);
      assert.equal(x.claimedAttacker, null);
    }
  });

  // 7 ---------------------------------------------------------------------------------------------
  await check('new-feature', 'REENTRY-NO-INCIDENT routine Romulan patrols and Delpin surveys run for 60 days while the captain leaves and re-enters systems (including the patrol\'s own): no overdue incident is manufactured', async () => {
    await fresh('dg-reentry');
    const r = await ev(() => {
      const t = testBM1;
      const A = window.__idx('Aldnas'), R = window.__idx('Romulus'), E = window.__idx('Earth');
      // Phase 1's routine traffic as it was: no phase 3 area patrols or witnessed-attack defence here.
      { const db = window.__D(); db.config = { ...db.config, patrolAreas: {}, militaryResponses: false }; }
      const scenes = [];
      // 100 days: a Romulus–Aldnas patrol flies two ten-day legs each way (STRATEGIC-MOVEMENT-UNIFICATION).
      // Completed jobs are tallied as they close: the book keeps only the last few closed assignments, and
      // other routine traffic can push a patrol out of it (STRATEGIC-TIME-SCALE-CORRECTION).
      const done = {}, patrols = {};
      for (let d = 0; d < 100; d++) {
        const at = [A, R, E][d % 3];
        t.markSystemVisited(at); t.state.currentPlanet = at; t.applySystemState(at); scenes.push(at);
        window.__adv(1);
        for (const a of window.__D().assignments) { if (a.status === 'completed') done[a.id] = `${a.polity}:${a.kind}`; if (a.polity === 'romulan' && a.kind === 'patrol') patrols[a.id] = a.status; }
      }
      const db = window.__D();
      return { incidents: Object.keys(db.incidents).length, completed: Object.values(done), romulanPatrols: patrols, active: db.assignments.filter((a) => a.status === 'active').length, relief: db.designations, scenes: scenes.length };
    });
    evidence.push({ check: 'REENTRY-NO-INCIDENT', ...r });
    assert.equal(r.incidents, 0);
    // Routine patrols keep sailing, one after another: three in 100 days. A patrol now stays on station in
    // proportion to its leg (STRATEGIC-TIME-SCALE-CORRECTION §5): a 13-day leg is a 7-day stay and a cycle
    // of about 34 days (it was 3 days and 30). The book keeps only the last few closed jobs, so a patrol
    // that closed may already have been pruned; it is counted as issued.
    assert.ok(Object.keys(r.romulanPatrols).length >= 3, JSON.stringify(r.romulanPatrols));
    assert.ok(r.completed.includes('romulan:patrol'), JSON.stringify(r.completed));
    assert.ok(r.completed.some((x) => x === 'delpin:exploration'));
  });

  // 8 ---------------------------------------------------------------------------------------------
  await check('new-feature', 'FIRE-GATES doctrine never authorises a shot outside the equipped weapon range or without a live track (engine facts), whatever the war authority; armed Vulcans keep self-defence', async () => {
    await fresh('dg-fire');
    const r = await ev(() => {
      const t = testBM1, s = t.state;
      const base = { x: s.ship?.x ?? 0, y: s.ship?.y ?? 0 };
      const mk = (id, faction, dx, extra = {}) => { const n = t.createNpcShip({ id, shipId: faction === 'vulcan' ? 343 : 334, faction, attitude: 'hostile', hostile: true, seed: 7, name: id, from: { x: base.x + dx, y: base.y }, destination: { x: base.x + dx, y: base.y }, role: 'patrol' }); t.ensureCombatTargetStats?.(n); Object.assign(n, extra); s.npcShips.push(n); return n; };
      const k = mk('gate-k', 'klingon', 60, { weaponReadyAt: 0, lastShotAt: -1e9 });
      const near = mk('gate-near', 'terran', 160);
      const far = mk('gate-far', 'terran', 60000);
      const cloaked = mk('gate-cloak', 'terran', 200, { cloaked: true });
      const war = { war_target_verified: true, war_order_active: true, engagement_objective_active: true };
      const range = t.getNpcWeaponRange(k);
      const inRange = t.doctrineFireCheck(k, near, 'ship', war);
      const outRange = t.doctrineFireCheck(k, far, 'ship', war);
      const blind = t.doctrineFireCheck(k, cloaked, 'ship', war);
      // A caller claiming the physical facts gains nothing: the engine's readings replace them.
      const claimed = t.doctrineFireCheck(k, far, 'ship', { ...war, live_weapon_track: true, inside_equipped_range: true, weapon_ready: true, weapon_usable: true, target_actionable: true });
      const v = mk('gate-v', 'vulcan', 120, { weaponReadyAt: 0, lastShotAt: -1e9 });
      const vulcanSelf = t.doctrineFireCheck(v, near, 'ship', { attack_on_self_verified: true, engagement_objective_active: true });
      const vulcanWar = t.doctrineFireCheck(v, near, 'ship', war);
      const nat = { role: k.role, playerEscort: k.playerEscort ?? null, fleetId: k.fleetId ?? null };
      return { range, inRange, outRange, blind, claimed, vulcanSelf, vulcanWar, nat, overlay: t.npcDoctrineOverlay(k) };
    });
    evidence.push({ check: 'FIRE-GATES', ...r });
    assert.equal(r.inRange.allowed, true, JSON.stringify(r.inRange));
    assert.equal(r.outRange.allowed, false); assert.ok(r.outRange.failed.includes('inside_equipped_range'), JSON.stringify(r.outRange.failed));
    assert.equal(r.blind.allowed, false); assert.ok(r.blind.failed.includes('live_weapon_track'), JSON.stringify(r.blind.failed));
    assert.equal(r.claimed.allowed, false, 'caller-supplied physical facts authorised a shot'); assert.ok(r.claimed.failed.includes('inside_equipped_range'));
    assert.equal(r.vulcanSelf.allowed, true, JSON.stringify(r.vulcanSelf)); assert.equal(r.vulcanWar.allowed, false);
    assert.equal(r.nat.role, 'patrol', 'the overlay renamed the native role');
    assert.equal(r.overlay.profileId, 'klingon'); assert.equal(r.overlay.role, 'patrol');
  });

  // 9 ---------------------------------------------------------------------------------------------
  await check('new-feature', 'DOMINION-OVERLAY a Dominion ship with no Central command resolves to the Remnant profile; hull origin never selects the profile; Gorn stays dormant', async () => {
    await fresh('dg-dominion');
    const r = await ev(() => {
      const t = testBM1, s = t.state;
      const n = t.createNpcShip({ id: 'gate-dom', shipId: 334, faction: 'dominion', attitude: 'neutral', hostile: false, seed: 3, name: 'gate-dom', from: { x: 0, y: 0 }, destination: { x: 0, y: 0 }, role: 'patrol' });
      const dom = t.npcDoctrineOverlay(n);
      const rom = t.npcDoctrineOverlay({ ...n, id: 'gate-rom', faction: 'romulan' });
      const d = t.getDoctrineRuntime();
      const gorn = t.Doctrine.react(d, { profileId: 'gorn', role: 'commander', eventType: 'asset_overdue', facts: { event_known: true, own_asset_affected: true } }).result;
      const gornGen = ['traffic', 'patrol', 'raid', 'reinforcement', 'occupation'].map((g) => t.Doctrine.generatorAllowed(d, 'gorn', g, { rosterEnabled: true, assignmentExists: true, budgetExists: true }));
      window.__adv(30);
      return { dom, rom, gorn, gornGen, gornAssignments: window.__D().assignments.filter((a) => a.polity === 'gorn').length };
    });
    evidence.push({ check: 'DOMINION-OVERLAY', ...r });
    assert.equal(r.dom.profileId, 'dominion_remnant'); assert.match(r.dom.profileReason, /Dominion default/);
    assert.equal(r.rom.profileId, 'romulan', 'hull origin (a Dominion design) chose the profile');
    assert.equal(r.gorn, 'inactive'); assert.deepEqual(r.gornGen, [false, false, false, false, false]); assert.equal(r.gornAssignments, 0);
  });

  // 10 --------------------------------------------------------------------------------------------
  await check('new-feature', 'BLOCKADE-SHARED-ENGINE a doctrine vessel sailing into a blockaded system runs it through the accepted interception engine, with its own vid', async () => {
    await fresh('dg-blockade');
    const r = await ev(() => {
      const t = testBM1;
      window.__quiet();
      const R = window.__idx('Romulus'), A = window.__idx('Aldnas');
      t.changeDiplomacy('romulan', 'terran', 'war');
      const book = t.campaign();
      t.syncPlayerPolity(book);
      const hulls = book.polities.terran.hulls.filter((h) => h.status === 'ready' && !h.opId).slice(0, 12);
      for (const h of hulls) h.systemIndex = R;
      const fx = [];
      const b = t.Campaign.startBlockade(book, t.buildCampaignWorld(true), { power: 'terran', target: R, hullIds: hulls.map((h) => h.id), purpose: 'isolate_world' }, t.state.day, fx);
      t.applyCampaignEffects(fx, t.state.day);
      if (!b.ok) return { error: b.reason };
      window.__adv(3);
      const h = window.__ready('romulan').find((x) => x.systemIndex !== R);
      h.systemIndex = A;
      const asg = window.__assign({ polity: 'romulan', hullId: h.id, kind: 'return', doctrineRole: 'patrol', stops: [{ systemIndex: R }] });
      const n0 = book.stats.interceptions || 0;
      // The hop takes its real length; the run is on the day it gets there.
      window.__adv(window.__leg('Aldnas', 'Romulus', h));
      const blk = (t.campaign().blockades || []).find((x) => x.id === b.record.id);
      return { applies: t.Campaign.blockadeApplies(t.campaign(), t.buildCampaignWorld(true), blk, 'romulan'), n: (t.campaign().stats.interceptions || 0) - n0, runs: (blk.runs || []).filter((x) => String(x.by).startsWith(asg.assignment.id)), asgRuns: window.__D().assignments.find((a) => a.id === asg.assignment.id)?.runs, vid: h.identity.vid };
    });
    evidence.push({ check: 'BLOCKADE-SHARED-ENGINE', ...r });
    assert.ok(!r.error, r.error);
    assert.equal(r.applies, true, 'precondition: the blockade does not bear on Romulan ships');
    assert.equal(r.n, 1, 'the crossing did not go through the interception engine');
    assert.equal(r.runs.length, 1); assert.equal(r.runs[0].kind, 'doctrine');
    assert.equal(r.asgRuns.length, 1);
  });

  // 11 --------------------------------------------------------------------------------------------
  await check('new-feature', 'PACT-COMPARTMENT an active secret Dominion–Cardassian pact is known to its signatory commands only: an ordinary Cardassian merchant and Klingon command have no briefing, and the pact never reaches the captain', async () => {
    await fresh('dg-pact');
    const r = await ev(() => {
      const t = testBM1;
      window.__quiet();
      const act = t.activateDominionPact('cardassian', 'gate pact');
      const book = t.campaign();
      const key = t.Campaign.pactKey('dominion', 'cardassian');
      const merchant = window.__ready('cardassian')[0];
      t.DoctrineCampaign.designate(book, 'cardassian', merchant.id, 'civilian');
      const x = window.__romulanLost();
      window.__adv(x.detectDay - t.state.day + 1);
      const inc = window.__incOf('romulan')[0];
      for (const to of [`hull:${merchant.id}`, 'command:cardassian', 'command:klingon']) window.__relay(inc.id, 'command:romulan', to);
      window.__adv(1);
      const w = t.buildCampaignWorld(true), d = t.getDoctrineRuntime(), db = window.__D();
      const f = (obs) => t.DoctrineCampaign.deriveFacts(d, book, w, db, obs, inc.id, t.state.day).facts;
      return { act: act?.ok ?? act, active: t.Campaign.pactActive(book, 'dominion', 'cardassian'), merchant: f(`hull:${merchant.id}`).pact_briefing_received ?? false, klingon: f('command:klingon').pact_briefing_received ?? false, cardassian: f('command:cardassian').pact_briefing_received ?? false,
        merchantProposal: window.__eval(`hull:${merchant.id}`, inc.id)?.proposal, knownTo: book.treaties[key].knownTo, reports: window.__reports().filter((rep) => /pact|agreement/i.test(`${rep.kind} ${rep.text}`)).length };
    });
    evidence.push({ check: 'PACT-COMPARTMENT', ...r });
    assert.equal(r.active, true, `precondition: pact not active (${JSON.stringify(r.act)})`);
    assert.equal(r.merchant, false); assert.equal(r.klingon, false); assert.equal(r.cardassian, true);
    assert.equal(r.merchantProposal, 'record_only');
    assert.deepEqual(r.knownTo, []); assert.equal(r.reports, 0);
  });

  // 12 --------------------------------------------------------------------------------------------
  const e2eShadow = {};
  await check('new-feature', 'DOCTRINE-INCIDENT-INTEGRATION one Romulan incident end to end: only Romulan command knows; the others know nothing and do nothing; reports reach chosen observers; Romulan command assigns an investigator; Delpin investigates by its own interest; Klingon records until its own losses are linked; Vulcan rescues known survivors; a save/load midway keeps the same incident, objectives and knowledge; no duplicate missions; no attribution', async () => {
    await fresh('dg-e2e');
    // This end-to-end story is authored hop by hop (its rescue and investigation deadlines were written for
    // one hop a day): it runs under the labelled one-day-leg debug override. At the chart's real lengths the
    // distant Vulcan relief defers the rescue it cannot finish in time (STRATEGIC-MOVEMENT-UNIFICATION §9).
    await ev(() => testBM1.applyDebugCommand('campaign legs 1'));
    const s1 = await ev(() => {
      const t = testBM1;
      window.__quiet();
      const R = window.__idx('Romulus'), A = window.__idx('Aldnas'), Dl = window.__idx('Delpi');
      const x = window.__romulanLost('disabled');
      // A Klingon scout visiting allied Romulan space is lost at the same place, unwitnessed.
      // Legs take their chart length now (STRATEGIC-MOVEMENT-UNIFICATION): the scout and the survey below set
      // out from Aldnas's nearest neighbour, so both are there while the Romulan check-in is still due.
      const w0 = t.buildCampaignWorld(true);
      const N = w0.neighbours(A).map(Number).sort((a, b) => w0.legDays(a, A) - w0.legDays(b, A))[0];
      const kh = window.__ready('klingon')[0]; kh.systemIndex = N;
      const kr = window.__patrol('klingon', kh.id, A);
      window.__adv(1);
      for (let k = 0; k < 20 && Number(kh.systemIndex) !== A; k++) window.__adv(1);
      window.__lose(kr.assignment.id, 'destroyed');
      // A Delpin survey that will dwell at Aldnas.
      const dh = window.__ready('delpin', Dl)[0]; dh.systemIndex = N;
      window.__assign({ polity: 'delpin', hullId: dh.id, kind: 'exploration', doctrineRole: 'explorer', stops: [{ systemIndex: A, dwell: 40, milestone: 'arrival' }, { systemIndex: Dl, milestone: 'check_in' }] }); // (a long stay: it must outlast the Romulan check-in)
      window.__adv(Math.max(0, x.detectDay - t.state.day));
      window.__e2eLate = { detectDay: x.detectDay, day: t.state.day, legN: w0.legDays(N, A) };
      const db = window.__D();
      const inc = window.__incOf('romulan')[0];
      const relief = Object.keys(db.designations.vulcan || {})[0];
      const who = ['command:klingon', `hull:${dh.id}`, `hull:${relief}`, 'command:delpin', 'command:vulcan'];
      return { romulanHulls: window.__P('romulan').hulls.map((h) => h.id), inc: inc?.id, day: t.state.day, knowers: Object.entries(db.knowledge).filter(([, s]) => s[inc?.id]).map(([o]) => o), before: Object.fromEntries(who.map((o) => [o, window.__eval(o, inc?.id)?.proposal ?? null])),
        romulan: window.__eval('command:romulan', inc?.id), objectives: db.objectives.map((o) => [o.id, o.actor, o.response, o.status]), dh: dh.id, relief, delpinSighted: Boolean(db.sightings?.[`hull:${dh.id}`]) };
    });
    evidence.push({ check: 'E2E stage 1 (only the owner knows)', ...s1 });
    assert.ok(s1.inc, 'no incident');
    // Romulan command, and (phase 2) the crew it sent with its orders: nobody else.
    const romulanCrew = s1.objectives.filter(([, a]) => a === 'command:romulan').map(([id]) => id);
    assert.ok(s1.knowers.includes('command:romulan'), JSON.stringify(s1.knowers));
    assert.equal(s1.knowers.filter((o) => o !== 'command:romulan').length, romulanCrew.length, JSON.stringify(s1.knowers));
    assert.ok(s1.knowers.filter((o) => o !== 'command:romulan').every((o) => s1.romulanHulls.includes(o.slice(5))), JSON.stringify(s1.knowers));
    for (const [o, p] of Object.entries(s1.before)) assert.equal(p, 'ignore_unknown', `${o} reacted to an incident it never received`);
    assert.equal(s1.romulan.proposal, 'investigate'); assert.equal(s1.objectives.length, 1);
    assert.ok(s1.delpinSighted, 'the Delpin survey never saw the debris');
    await shotDoctrine('DR-debug-incident-romulan-investigation.png');
    // Save midway, reload into a different start, and compare.
    const snap = await ev((s1) => {
      const t = testBM1;
      const db = window.__D();
      const pick = () => JSON.stringify({ incidents: window.__D().incidents, objectives: window.__D().objectives.map((o) => [o.id, o.status, o.assigned, o.deadline]), knowledge: window.__D().knowledge, assignments: window.__D().assignments.map((a) => [a.id, a.status, a.pos, a.hullId, a.vid]) });
      const before = pick();
      t.saveGame(9); t.startWithFaction('ferengi'); t.loadGame(9);
      return { same: pick() === before, day: t.state.day };
    }, s1);
    evidence.push({ check: 'E2E save/load midway', ...snap });
    assert.equal(snap.same, true, 'incident/objective/knowledge state changed across save/load');
    await shotDoctrine('DR-debug-incident-after-saveload.png');
    const s2 = await ev((s1) => {
      const t = testBM1;
      // The report reaches three chosen observers (the debug relay, as the captain would use it).
      for (const to of ['command:klingon', `hull:${s1.dh}`, `hull:${s1.relief}`]) t.applyDebugCommand(`doctrine relay ${s1.inc} command:romulan ${to}`.toLowerCase());
      window.__adv(4);
      const db = window.__D();
      return { klingon: window.__eval('command:klingon', s1.inc), delpin: window.__eval(`hull:${s1.dh}`, s1.inc), vulcan: window.__eval(`hull:${s1.relief}`, s1.inc), objectives: db.objectives.map((o) => [o.actor, o.response, o.status]) };
    }, s1);
    evidence.push({ check: 'E2E stage 2 (reports reach chosen observers)', ...s2 });
    assert.equal(s2.klingon.proposal, 'record_only', JSON.stringify(s2.klingon));
    assert.ok(s2.objectives.some(([a, r]) => a === `hull:${s1.dh}` && r === 'investigate'), 'Delpin did not investigate');
    assert.notEqual(s2.vulcan.proposal, 'rescue', 'rescue without a survivor report');
    assert.ok(!s2.objectives.some(([a]) => a === `hull:${s1.relief}`));
    await shotDoctrine('DR-debug-shadow-evaluation.png');
    const s3 = await ev((s1) => {
      const t = testBM1;
      // What the Delpin crew found goes to Klingon command and to the Vulcan relief ship.
      window.__relay(s1.inc, `hull:${s1.dh}`, 'command:klingon');
      // Phase 2: the people found alive are a distress incident of their own (opened by whoever found them,
      // since the hulk's comms were silent); the Delpin crew pass that survivor report to the relief ship.
      const dist = Object.values(window.__D().incidents).find((i) => i.eventType === 'distress' && window.__D().knowledge[`hull:${s1.dh}`]?.[i.id]?.survivors);
      if (dist) window.__relay(dist.id, `hull:${s1.dh}`, `hull:${s1.relief}`, { include: 'survivor_report' });
      window.__adv(8);
      const db = window.__D();
      const keys = db.objectives.map((o) => `${o.incidentId}|${o.actor}|${o.response}`);
      const reliefHull = window.__P('vulcan').hulls.find((h) => h.id === s1.relief);
      return { distress: dist?.id || null, klingon: window.__eval('command:klingon', s1.inc), vulcan: dist ? window.__eval(`hull:${s1.relief}`, dist.id) : null, objectives: db.objectives.map((o) => ({ actor: o.actor, response: o.response, status: o.status, reasons: o.resolution?.reasons || [], vid: o.assigned.vid })),
        duplicates: keys.length - new Set(keys).size, attributions: Object.values(db.knowledge).flatMap((st) => Object.values(st)).filter((k) => k.attribution).length, reliefVid: reliefHull?.identity?.vid,
        survivors: Object.values(db.ground.evidence).map((e) => e.survivors), shadow: db.shadow.filter((x) => x.incident === s1.inc) };
    }, s1);
    evidence.push({ check: 'E2E stage 3 (evidence links Klingon losses; survivors rescued)', ...s3, shadow: s3.shadow.length });
    e2eShadow.entries = s3.shadow;
    assert.ok(s3.klingon.knownFacts.includes('linked_own_losses'), JSON.stringify(s3.klingon));
    assert.equal(s3.klingon.matchedRule, 'shared_losses');
    assert.equal(s3.klingon.live, false);
    const rescue = s3.objectives.find((o) => o.actor === `hull:${s1.relief}`);
    assert.ok(rescue, JSON.stringify(s3.vulcan)); assert.equal(rescue.response, 'rescue'); assert.equal(rescue.status, 'completed', JSON.stringify(rescue));
    assert.equal(rescue.vid, s3.reliefVid);
    assert.equal(s3.duplicates, 0, 'duplicate missions'); assert.equal(s3.attributions, 0, 'an attribution appeared');
    assert.ok(!s3.objectives.some((o) => o.actor === 'command:klingon'), 'Klingon acted on a shadow proposal');
    await ev(() => testBM1.applyDebugCommand('campaign legs chart'));
  });

  // 13 --------------------------------------------------------------------------------------------
  await check('new-feature', 'SHOTS the doctrine debug views: incident + evaluations, shadow evaluation, Romulan investigation, a deferred response, the incident after save/load', async () => {
    for (const f of ['DR-debug-incident-romulan-investigation.png', 'DR-debug-shadow-evaluation.png', 'DR-debug-deferred-no-asset.png', 'DR-debug-incident-after-saveload.png']) assert.ok(fs.existsSync(path.join(out, f)) && fs.statSync(path.join(out, f)).size > 10000, `missing ${f}`);
  });

  // Shadow comparison: actor / incident / existing action / doctrine proposal / reason.
  const cmp = (e2eShadow.entries || []).map((x) => ({ day: x.day, actor: x.actor, incident: x.incident, profile: x.profile, role: x.role, existingAction: x.existing, doctrineProposal: x.proposal, matchedRule: x.matchedRule, live: x.live, objective: x.objective, reason: x.notActing || (x.live ? 'live pilot response' : null), knownFacts: x.knownFacts, capacity: x.capacity }));
  fs.writeFileSync(path.join(out, 'shadow-comparison.json'), JSON.stringify(cmp, null, 1));
  fs.writeFileSync(path.join(out, 'doctrine-runtime-evidence.json'), JSON.stringify({ results, evidence }, null, 1));
  const byCat = (c) => { const r = results.filter((x) => x.category === c); return `${r.filter((x) => x.ok).length}/${r.length}`; };
  console.log(`\ndoctrine runtime in-game: ${results.filter((x) => x.ok).length}/${results.length} (baseline-defect ${byCat('baseline-defect')}, new-feature ${byCat('new-feature')}, preservation ${byCat('preservation')})`);
  if (probe.errors.length) console.log('page errors:', probe.errors.slice(0, 5));
  await probe.close();
  process.exit(results.every((x) => x.ok) && !probe.errors.length ? 0 : 1);
})();
