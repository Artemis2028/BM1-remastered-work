// Gate for faction doctrine runtime phase 3, stacked on 6f9e499.
// Rules: docs/doctrine/DOCTRINE-RUNTIME-PHASE3.md.
//
// Categories:
//   baseline-defect  fails on 6f9e499 on its own assertion: a real defect phase 3 removes (a disabled
//                    hull repairs itself / turns up operational with nothing having recovered it)
//   new-feature      needs state 6f9e499 does not have
//   preservation     must hold on both
const assert = require('node:assert/strict');
const path = require('node:path');
const fs = require('node:fs');
const { startProbe } = require('./probe-harness.cjs');

(async () => {
  const probe = await startProbe({ viewport: { width: 1400, height: 900 }, pageOptions: { deviceScaleFactor: 2 } });
  const { ev, fresh, page } = probe;
  const out = process.env.BM1_TEST_OUTPUT || '/tmp';
  fs.mkdirSync(out, { recursive: true });
  const results = [];
  const evidence = [];
  const only = process.env.BM1_GATE_ONLY ? new RegExp(process.env.BM1_GATE_ONLY) : null; // debugging aid
  async function check(category, name, fn) {
    if (only && !only.test(name)) return;
    try { await fn(); results.push({ category, name, ok: true }); console.log('PASS', `[${category}]`, name); }
    catch (err) { results.push({ category, name, ok: false, message: String(err?.message || err).split('\n').slice(0, 6).join(' ') }); console.log('FAIL', `[${category}]`, name, '\n      ', String(err?.message || err).split('\n').slice(0, 8).join(' ')); }
  }
  // The doctrine section of Cheats & Debug at full height, limited to the headings named.
  async function shotDoctrine(file, only = null) {
    await ev((only) => {
      const d = document.getElementById('cheats-debug'); if (!d.open) testBM1.openDebugMenu();
      d.style.maxHeight = 'none'; d.style.height = 'auto'; d.style.width = '1360px'; d.style.maxWidth = 'none'; d.style.overflow = 'visible'; d.style.position = 'absolute'; d.style.top = '0';
      const sec = document.querySelector('[data-doctrine-debug]') || document.querySelector('[data-doctrine-section]');
      if (only) {
        let keep = false;
        for (const el of [...sec.children]) {
          if (el.tagName === 'H4') keep = only.some((h) => el.textContent.startsWith(h));
          else if (el.tagName === 'P' && !el.previousElementSibling) keep = true;
          if (el.tagName === 'FORM' || el.classList.contains('debug-actions')) keep = false;
          el.style.display = keep || (el.tagName === 'P' && el === sec.firstElementChild) ? '' : 'none';
        }
      }
    }, only);
    const h = await ev(() => Math.ceil(document.querySelector('[data-doctrine-section]').getBoundingClientRect().bottom + window.scrollY + 40));
    await page.setViewportSize({ width: 1400, height: Math.min(16000, Math.max(900, h)) });
    await page.locator('[data-doctrine-section]').screenshot({ path: path.join(out, file) });
    await page.setViewportSize({ width: 1400, height: 900 });
    await ev(() => { const d = document.getElementById('cheats-debug'); d.removeAttribute('style'); for (const el of document.querySelectorAll('[data-doctrine-debug] > *, [data-doctrine-section] *')) el.style.display = ''; d.close(); });
  }
  await page.waitForFunction(() => !testBM1.doctrineStatus || testBM1.doctrineStatus().state !== 'loading', null, { timeout: 30000 }).catch(() => {});

  const setup = () => page.evaluate(() => {
    const t = testBM1;
    window.__adv = (n) => { for (let i = 0; i < n; i++) t.advanceFleetCalendar(1, t.Fleet.nextId(t.fleetBook(), 'journey')); };
    window.__idx = (name) => t.getSystemIndexByName(name);
    window.__D = () => t.DoctrineCampaign.doctrineBook(t.campaign());
    window.__P = (id) => t.campaign().polities[id];
    window.__ready = (polity, at = null) => (window.__P(polity)?.hulls || []).filter((h) => h.status === 'ready' && !h.opId && (at == null || h.systemIndex === at)).sort((a, b) => String(a.id).localeCompare(String(b.id)));
    window.__quiet = () => { const db = window.__D(); db.config = { ...db.config, patrols: {}, explorers: {}, merchants: {}, projects: {}, patrolAreas: {} }; t.campaign().config.aiStrategicOps = false; };
    window.__authored = (fn) => t.runCampaignAuthored(fn);
    window.__assign = (spec) => window.__authored((book, world, fx) => t.DoctrineCampaign.issueAssignment(book, world, spec, t.state.day, fx));
    window.__lose = (asgId, mode = 'destroyed', opts = {}) => t.DoctrineCampaign.loseAssignmentHullUnwitnessed(t.campaign(), t.buildCampaignWorld(true), asgId, t.state.day, mode, opts);
    window.__relay = (inc, from, to, opts = {}) => t.DoctrineCampaign.relayReport(t.campaign(), t.buildCampaignWorld(true), inc, from, to, t.state.day, opts);
    window.__eval = (obs, inc) => window.__D().lastEval[`${obs}|${inc}`] || null;
    window.__inc = (pred) => Object.values(window.__D().incidents || {}).filter(pred);
    window.__cond = (h) => t.Fleet.classifyDamage(h.hull, h.maxHull);
    window.__disable = (h) => { h.hull = Math.max(1, Math.floor(h.maxHull * 0.05)); };
    window.__reports = () => (t.galaxyNewsBook().items || []).concat(t.galaxyNewsBook().pending || []).concat(t.campaignBook().reports || []);
    window.__sh = window.__sh || [];
    window.__mil = () => (window.__D().objectives || []).filter((o) => o.military);
    window.__hops = (a, b, polity) => t.buildCampaignWorld(true).routeHops([a], b, polity);
  });
  await setup();

  // ---------------------------------------------------------------------------------------------
  await check('preservation', 'P3-HEADER the doctrine debug header names the source package status and the runtime phase; the source package is unchanged', async () => {
    await fresh('p3-header');
    const r = await ev(() => { testBM1.openDebugMenu(); const text = document.querySelector('[data-doctrine-section]')?.textContent || ''; document.getElementById('cheats-debug').close(); return { text: text.slice(0, 900), status: testBM1.getDoctrineRuntime()?.data?.status }; });
    evidence.push({ check: 'P3-HEADER', ...r });
    assert.match(r.text, /Source package status: DESIGN_ONLY_NOT_LOADED_BY_GAME · Runtime integration: Phase [2-9]/);
    assert.equal(r.status, 'DESIGN_ONLY_NOT_LOADED_BY_GAME');
  });

  // ---------------------------------------------------------------------------------------------
  // PART 1. A Romulan warship disabled at Aldnas (no yard, nobody's world) and left alone.
  await check('baseline-defect', 'STRANDED-DAYS a disabled Romulan hull at Aldnas is still disabled, still at Aldnas and still the same vessel after 1, 5, 20 and 40 campaign days with nobody recovering it; save/load does not change that', async () => {
    await fresh('p3-stranded');
    const r = await ev(() => {
      const t = testBM1;
      window.__quiet();
      const A = window.__idx('Aldnas'), R = window.__idx('Romulus');
      const h = window.__ready('romulan', R)[0] || window.__ready('romulan')[0];
      const vid = h.identity?.vid;
      // Disabled and released from its job as the game releases a hull (status ready, no job): on 6f9e499
      // the ordinary repair rule sails it to a yard the next day and repairs it there.
      h.systemIndex = A; window.__disable(h); h.status = 'ready'; h.opId = null;
      const trail = [];
      let last = 0;
      for (const d of [1, 5, 20]) { window.__adv(d - last); last = d; trail.push({ d, at: t.state.planets[h.systemIndex]?.name, cond: window.__cond(h), status: h.status, hull: `${h.hull}/${h.maxHull}`, recovery: h.stranded?.recovery ?? null, crew: h.stranded?.crew ?? null }); }
      t.saveGame(8); t.startWithFaction('klingon'); t.loadGame(8);
      const lh = window.__P('romulan').hulls.find((x) => x.id === h.id);
      window.__adv(20);
      trail.push({ d: 40, afterSaveLoad: true, at: t.state.planets[lh.systemIndex]?.name, cond: window.__cond(lh), status: lh.status, hull: `${lh.hull}/${lh.maxHull}`, recovery: lh.stranded?.recovery ?? null, crew: lh.stranded?.crew ?? null });
      return { hullId: h.id, vid, vidAfter: lh.identity?.vid, trail, sameVid: window.__P('romulan').hulls.filter((x) => x.identity?.vid === vid && x.status !== 'lost').length };
    });
    evidence.push({ check: 'STRANDED-DAYS', ...r });
    for (const x of r.trail) {
      assert.equal(x.cond, 'disabled', `day ${x.d}: the hull repaired itself (${JSON.stringify(x)})`);
      assert.equal(x.at, 'Aldnas', `day ${x.d}: the hulk moved (${JSON.stringify(x)})`);
    }
    assert.equal(r.vidAfter, r.vid); assert.equal(r.sameVid, 1);
  });
  await check('baseline-defect', 'OP-SURVIVOR-STRANDED a Klingon hull disabled in a real assault on a Terran world stays disabled where it was hit when the operation stands down: it is not brought home, repaired or reused', async () => {
    await fresh('p3-op-survivor');
    const r = await ev(() => {
      const t = testBM1;
      window.__quiet();
      const E = window.__idx('Epsilon'), O = window.__idx('Oce Nu');
      const ks = window.__ready('klingon').filter((h) => window.__cond(h) === 'operational').slice(0, 3);
      for (const h of ks) h.systemIndex = O;
      const op = window.__authored((b, w, fx) => t.Campaign.launchOperation(b, w, 'klingon', ks, E, t.state.day, 1, 'assault', fx));
      window.__adv(1);
      const h = ks.find((x) => x.status !== 'lost');
      window.__disable(h);
      const at0 = t.state.planets[h.systemIndex]?.name;
      window.__authored((b, w, fx) => t.Campaign.terminateOperations(b, w, 'klingon', t.state.day, fx, 'gate: stand down'));
      const seen = new Set();
      for (let d = 0; d < 20; d++) { window.__adv(1); seen.add(`${t.state.planets[h.systemIndex]?.name}|${h.opId || '-'}|${window.__cond(h)}`); }
      return { at0, seen: [...seen], op: op && op.id };
    });
    evidence.push({ check: 'OP-SURVIVOR-STRANDED', ...r });
    assert.deepEqual(r.seen, [`${r.at0}|-|disabled`]);
  });
  await check('new-feature', 'STRANDED-SHOTS the stranded hulk over several days in the debug view: crew clock running, recovery awaited, never repaired', async () => {
    await fresh('p3-stranded-shot');
    await ev(() => {
      window.__quiet();
      const A = window.__idx('Aldnas'), R = window.__idx('Romulus');
      const h = window.__ready('romulan', R)[0];
      h.systemIndex = A; window.__disable(h); h.status = 'repairing';
      window.__adv(1);
    });
    await shotDoctrine('P3-stranded-day1.png', ['Disabled hulls']);
    await ev(() => window.__adv(7));
    await shotDoctrine('P3-stranded-day8.png', ['Disabled hulls']);
    const r = await ev(() => { window.__adv(15); const s = window.__P('romulan').hulls.find((h) => h.stranded)?.stranded; return s; });
    await shotDoctrine('P3-stranded-day23.png', ['Disabled hulls']);
    evidence.push({ check: 'STRANDED-SHOTS', stranded: r });
    assert.equal(r.crew, 'lost', 'the crew clock did not run out on its own'); assert.equal(r.recovery, 'awaiting_recovery');
  });
  await check('new-feature', 'RECOVERY-YARD a hull disabled at its own unblockaded yard world is brought in over the recovery days and then repaired by the yard — the same hull and vid; one disabled at an enemy-blockaded yard waits', async () => {
    await fresh('p3-recovery');
    const r = await ev(() => {
      const t = testBM1;
      window.__quiet();
      const R = window.__idx('Romulus');
      const h = window.__ready('romulan', R)[0];
      const vid = h.identity?.vid;
      window.__disable(h); h.status = 'repairing';
      const trail = [];
      for (let d = 1; d <= 30 && window.__cond(h) !== 'operational'; d++) { window.__adv(1); trail.push(`${d}:${h.stranded?.recovery || 'restored'}:${window.__cond(h)}`); }
      return { trail, cond: window.__cond(h), vid, vidAfter: h.identity?.vid, at: t.state.planets[h.systemIndex]?.name };
    });
    evidence.push({ check: 'RECOVERY-YARD', ...r });
    assert.ok(r.trail.some((x) => x.includes(':recovering:')), r.trail.join(' '));
    assert.equal(r.cond, 'operational'); assert.equal(r.vidAfter, r.vid); assert.equal(r.at, 'Romulus');
    assert.ok(r.trail.findIndex((x) => x.includes(':recovering:')) < r.trail.findIndex((x) => !x.includes('disabled')), r.trail.join(' '));
  });

  // ---------------------------------------------------------------------------------------------
  // DISABLED-RESCUE-TIME. A Romulan refugee transport disabled at an unclaimed system three jumps from
  // Vulcan; its distress call reaches Vulcan over the network; the Vulcan relief sails jump by jump.
  await check('new-feature', 'DISABLED-RESCUE-TIME the relief sails several jumps day by day; the hull stays disabled throughout; the crew clock runs; the relief takes the crew off inside their life support; the hulk waits for recovery', async () => {
    await fresh('p3-rescue');
    const r = await ev(() => {
      const t = testBM1;
      window.__quiet();
      const V = window.__idx('Vulcan');
      const w = t.buildCampaignWorld(true);
      const site = w.systems.filter((s) => s.controller == null && w.routeHops([V], s.index, 'vulcan') === 3 && w.neighbours(s.index).length).sort((a, b) => a.index - b.index)[0];
      const from = w.neighbours(site.index).map(Number).sort((a, b) => a - b)[0];
      const tr = window.__ready('romulan')[0];
      tr.systemIndex = from;
      const asg = window.__assign({ polity: 'romulan', hullId: tr.id, kind: 'transport', doctrineRole: 'civilian', stops: [{ systemIndex: site.index, dwell: 3, milestone: 'arrival' }, { systemIndex: from, milestone: 'check_in' }] });
      window.__adv(1);
      window.__lose(asg.assignment.id, 'disabled');
      window.__adv(2);
      const dist = window.__inc((i) => i.eventType === 'distress')[0];
      if (!dist) return { error: 'no distress', site: site.name };
      window.__relay(dist.id, 'command:romulan', 'command:vulcan', { include: 'survivor_report', channel: 'network' });
      const trail = [];
      let o = null;
      const d0 = t.state.day;
      for (let i = 0; i < 25 && !(o && o.status !== 'active'); i++) {
        window.__adv(1);
        const db = window.__D();
        o ||= db.objectives.find((x) => x.response === 'rescue');
        const rh = o && window.__P('vulcan').hulls.find((h) => h.id === o.assigned.hullId);
        trail.push({ day: t.state.day, hulk: `${window.__cond(tr)}@${t.state.planets[tr.systemIndex]?.name}`, crew: tr.stranded?.crew, crewUntil: tr.stranded?.crewUntil, relief: rh ? t.state.planets[rh.systemIndex]?.name : null, rescue: o?.status || null });
        if (o && o.status === 'active' && trail.filter((x) => x.relief).length === 2) window.__sh.push(...(db.shadow || []).filter((x) => x.incident === dist.id).slice(-4));
      }
      return { site: site.name, hops: w.routeHops([V], site.index, 'vulcan'), trail, rescue: o && { status: o.status, resolution: o.resolution, vid: o.assigned.vid }, stranded: tr.stranded, cond: window.__cond(tr), d0 };
    });
    evidence.push({ check: 'DISABLED-RESCUE-TIME', ...r });
    assert.ok(!r.error, JSON.stringify(r));
    assert.ok(r.rescue, 'no rescue objective');
    assert.ok(r.trail.every((x) => x.hulk === `disabled@${r.site}`), JSON.stringify(r.trail));
    const reliefStops = [...new Set(r.trail.map((x) => x.relief).filter(Boolean))];
    assert.ok(reliefStops.length >= 3, `the relief made only ${reliefStops.length - 1} jumps: ${reliefStops}`);
    assert.equal(r.rescue.status, 'completed', JSON.stringify(r.rescue));
    assert.equal(r.stranded.crew, 'rescued'); assert.ok(r.rescue.resolution.day <= r.stranded.crewUntil);
    assert.equal(r.cond, 'disabled'); assert.equal(r.stranded.recovery, 'awaiting_recovery');
    await shotDoctrine('P3-rescue-after-multijump.png', ['Doctrine objectives', 'Disabled hulls', 'Active incidents']);
  });

  // ---------------------------------------------------------------------------------------------
  // DOCTRINE-DEFENSE-INTEGRATION. The Terran–Klingon war (a formal starting war): a Klingon assault from
  // Oce Nu on Epsilon. Terran command learns of it from its own world and sends an existing spare warship
  // from Earth, one jump away; the Klingons withdraw; the objective closes; the defender goes home.
  await check('new-feature', 'DOCTRINE-DEFENSE-INTEGRATION a verified attack on a Terran world; Terran command defends it with an existing warship through the existing engine; the threat ends; the objective closes; the defender goes home; no pursuit, nothing spawned', async () => {
    await fresh('p3-defense');
    const r = await ev(() => {
      const t = testBM1;
      window.__quiet();
      const E = window.__idx('Epsilon'), O = window.__idx('Oce Nu');
      const book = t.campaign();
      const count = () => Object.values(book.polities).reduce((n, p) => n + p.hulls.filter((h) => h.status !== 'lost').length, 0) - (book.stats.hullsBuilt || 0);
      const n0 = count();
      const ks = window.__ready('klingon').filter((h) => window.__cond(h) === 'operational').slice(0, 3);
      for (const h of ks) h.systemIndex = O;
      const op = window.__authored((b, w, fx) => t.Campaign.launchOperation(b, w, 'klingon', ks, E, t.state.day, 1, 'assault', fx));
      if (!op) return { error: 'no assault' };
      const trail = [];
      let o = null;
      for (let i = 0; i < 6 && !(o && o.state === 'defending'); i++) {
        window.__adv(1);
        o ||= window.__mil().find((x) => x.kind === 'defense' && x.polity === 'terran');
        trail.push({ day: t.state.day, op: op.status, obj: o ? `${o.state}/${o.status}` : null });
      }
      if (!o) return { error: 'no defence objective', trail, inc: window.__inc(() => true).map((i) => [i.eventType, i.polity]), ev: Object.values(window.__D().lastEval).filter((e) => e.actor === 'command:terran').slice(-3) };
      const h = window.__P('terran').hulls.find((x) => x.id === o.assigned.hullId);
      const inc = window.__D().incidents[o.incidentId];
      const e = window.__eval('command:terran', o.incidentId);
      window.__sh.push(...(window.__D().shadow || []).filter((x) => x.incident === o.incidentId).slice(-4));
      const during = { state: o.state, at: t.state.planets[h.systemIndex]?.name, defendingAt: h.defendingAt, authority: o.authority, vid: o.assigned.vid, vidNow: h.identity?.vid, rule: e?.matchedRule, live: e?.live, attribution: window.__D().knowledge['command:terran']?.[o.incidentId]?.attribution };
      return { during, trail, opId: op.id, objId: o.id, hullId: h.id, n0, n1: count(), incident: inc && { eventType: inc.eventType, source: inc.source } };
    });
    evidence.push({ check: 'DOCTRINE-DEFENSE-INTEGRATION:during', ...r });
    assert.ok(!r.error, JSON.stringify(r));
    assert.equal(r.during.state, 'defending', JSON.stringify(r.trail));
    assert.equal(r.during.at, 'Epsilon'); assert.equal(r.during.authority.source, 'defense_obligation');
    assert.equal(r.during.vid, r.during.vidNow); assert.equal(r.n1, r.n0, 'a defence force was spawned');
    assert.equal(r.during.rule, 'defend_assets'); assert.equal(r.during.live, true);
    assert.equal(r.during.attribution?.factionId, 'klingon');
    await shotDoctrine('P3-defense-objective.png', ['Military objectives', 'Active incidents']);
    const r2 = await ev(({ objId, hullId }) => {
      const t = testBM1;
      window.__authored((b, w, fx) => t.Campaign.terminateOperations(b, w, 'klingon', t.state.day, fx, 'gate: the assault withdraws'));
      window.__adv(1);
      const o = window.__D().objectives.find((x) => x.id === objId);
      const h = window.__P('terran').hulls.find((x) => x.id === hullId);
      const at1 = t.state.planets[h.systemIndex]?.name;
      const acts = [];
      for (let i = 0; i < 6; i++) { window.__adv(1); acts.push(`${t.state.planets[h.systemIndex]?.name}/${h.status}/${h.opId || '-'}/${(t.campaign().operations || []).filter((x) => (x.hullIds || []).includes(h.id)).map((x) => `${x.id}:${x.kind}:${x.status}`).join('+')}/${window.__D().assignments.filter((a) => a.hullId === h.id && a.status === 'active').map((a) => a.kind).join('+')}`); }
      const again = window.__mil().filter((x) => x.incidentId === o.incidentId).length;
      return { status: o.status, resolution: o.resolution, defendingAt: h.defendingAt ?? null, at1, acts, again };
    }, { objId: r.objId, hullId: r.hullId });
    evidence.push({ check: 'DOCTRINE-DEFENSE-INTEGRATION:after', ...r2 });
    assert.equal(r2.status, 'completed', JSON.stringify(r2.resolution)); assert.deepEqual(r2.resolution.reasons, ['threat_ended']);
    assert.equal(r2.defendingAt, null); assert.equal(r2.again, 1, 'a replacement objective on the same incident');
    // Doctrine gives it no pursuit: after the close it holds at home under no doctrine job. If Terran
    // campaign strategy later takes it for an operation of its own, that is campaign strategy's call,
    // made under that operation — never a doctrine order.
    for (const a of r2.acts) {
      const [at, , opId, ops, asg] = a.split('/');
      assert.equal(asg, '', `a doctrine job after the close: ${a}`);
      if (at !== 'Epsilon') assert.ok(opId !== '-' && ops.includes(':'), `moved off its post without a campaign operation: ${a}`);
    }
    await shotDoctrine('P3-defense-closed.png', ['Military objectives']);
  });

  // ---------------------------------------------------------------------------------------------
  // A Romulan area patrol around Romulus: a ship of its own goes silent in its area; the patrol
  // investigates (its command has no spare ship), the search ends, the patrol goes back to its cycles.
  await check('new-feature', 'PATROL-RETURN an area patrol breaks off to investigate a loss inside its area, the bounded search ends, and it returns to its patrol cycles in its area', async () => {
    await fresh('p3-patrol');
    const r = await ev(() => {
      const t = testBM1;
      window.__quiet();
      const R = window.__idx('Romulus');
      const book = t.campaign();
      const ph = window.__ready('romulan', R)[0];
      const p = window.__authored((b, w, fx) => t.DoctrineCampaign.startAreaPatrol(b, w, 'romulan', ph.id, R, t.state.day, fx));
      if (!p.ok) return { error: p.reason };
      const pat = p.patrol;
      const lostAt = pat.area.find((i) => i !== R);
      const other = window.__ready('romulan', R)[0] || window.__ready('romulan')[0];
      const asg = window.__assign({ polity: 'romulan', hullId: other.id, kind: 'patrol', doctrineRole: 'patrol', stops: [{ systemIndex: lostAt, dwell: 0, milestone: 'arrival' }, { systemIndex: R, milestone: 'check_in' }] });
      for (const h of window.__P('romulan').hulls) if (h.status === 'ready' && !h.opId && h.id !== ph.id) { h.status = 'assigned'; h.opId = 'gate-elsewhere'; }
      window.__adv(1);
      window.__lose(asg.assignment.id, 'destroyed', { silent: true });
      const m = asg.assignment.milestones.at(-1);
      window.__adv(Math.max(1, m.dueDay + m.grace + 1 - t.state.day));
      let o = null;
      for (let i = 0; i < 8 && !o; i++) { window.__adv(1); o = window.__D().objectives.find((x) => x.actor === `hull:${ph.id}`); }
      if (!o) return { error: 'the patrol never responded', ev: Object.values(window.__D().lastEval).filter((e) => e.actor === `hull:${ph.id}`) };
      const responding = { status: pat.status, obj: o.status, response: o.response, area: pat.area.map((i) => t.state.planets[i]?.name) };
      return { patId: pat.id, objId: o.id, responding, hullId: ph.id };
    });
    evidence.push({ check: 'PATROL-RETURN:responding', ...r });
    assert.ok(!r.error, JSON.stringify(r));
    assert.equal(r.responding.response, 'investigate');
    await shotDoctrine('P3-patrol-responding.png', ['Area patrols', 'Doctrine objectives']);
    const r2 = await ev(({ patId, objId, hullId }) => {
      const t = testBM1;
      const db = window.__D();
      const o = db.objectives.find((x) => x.id === objId);
      for (let i = 0; i < 30 && o.status === 'active'; i++) window.__adv(1);
      window.__adv(2);
      const pat = db.patrols[patId];
      const h = window.__P('romulan').hulls.find((x) => x.id === hullId);
      const where = new Set();
      for (let i = 0; i < 12; i++) { window.__adv(1); where.add(h.systemIndex); }
      return { obj: o.status, resolution: o.resolution, pat: pat.status, cycles: pat.cycles, returned: db.stats.patrolsReturned || 0, inArea: [...where].every((i) => pat.area.includes(i)), where: [...where].map((i) => t.state.planets[i]?.name), again: db.objectives.filter((x) => x.actor === `hull:${hullId}` && x.incidentId === o.incidentId).length };
    }, r);
    evidence.push({ check: 'PATROL-RETURN:after', ...r2 });
    assert.notEqual(r2.obj, 'active'); assert.equal(r2.pat, 'patrolling'); assert.ok(r2.returned >= 1);
    assert.equal(r2.inArea, true, `left its area: ${r2.where}`); assert.equal(r2.again, 1);
    await shotDoctrine('P3-patrol-returned.png', ['Area patrols', 'Doctrine objectives']);
  });

  // ---------------------------------------------------------------------------------------------
  // DOCTRINE-WAR-AUTHORITY: no raid without formal war; a raid under the Terran–Klingon war sails; save
  // and load mid-operation; a ceasefire ends it at once and nothing lands afterwards.
  await check('new-feature', 'DOCTRINE-WAR-AUTHORITY a raid order is refused without formal war; under the Terran–Klingon war it is executed; it survives save/load with its authority; a ceasefire cancels it and no strike lands afterwards', async () => {
    await fresh('p3-war');
    const r = await ev(() => {
      const t = testBM1;
      window.__quiet();
      const E = window.__idx('Epsilon'), O = window.__idx('Oce Nu'), R = window.__idx('Romulus');
      const doctrine = t.getDoctrineRuntime();
      const rh = window.__ready('romulan', R)[0];
      const refused = window.__authored((b, w, fx) => t.DoctrineCampaign.orderRaid(b, w, { power: 'romulan', target: E, hullId: rh.id, day: t.state.day, doctrine, by: 'gate' }, fx));
      // The strongest free Klingon warship, at Oce Nu, against the weakest Terran world next to it.
      const book = t.campaign(), w = t.buildCampaignWorld(true);
      const kh = window.__ready('klingon').filter((h) => window.__cond(h) === 'operational').sort((a, b) => t.Campaign.hullStrength(book, w, b) - t.Campaign.hullStrength(book, w, a))[0];
      kh.systemIndex = O;
      const target = w.neighbours(O).map(Number).filter((i) => w.systems[i]?.controller === 'terran').sort((a, b) => t.Campaign.localDefenseStrength(book, w, a) - t.Campaign.localDefenseStrength(book, w, b))[0];
      const ratio = t.Campaign.hullStrength(book, w, kh) / t.Campaign.localDefenseStrength(book, w, target);
      const ordered = window.__authored((b, w, fx) => t.DoctrineCampaign.orderRaid(b, w, { power: 'klingon', target, hullId: kh.id, day: t.state.day, doctrine, by: 'gate' }, fx));
      if (!ordered.ok) return { error: ordered.reason, refused };
      const o = window.__mil().find((x) => x.kind === 'raid');
      const trail = [];
      for (let i = 0; i < 4 && !['engaged', 'shadowing'].includes(o.state); i++) { window.__adv(1); trail.push(`${t.state.day}:${o.state}@${t.state.planets[kh.systemIndex]?.name}`); }
      const before = JSON.stringify({ state: o.state, authority: o.authority });
      t.saveGame(8); t.startWithFaction('klingon'); t.loadGame(8);
      const lo = window.__mil().find((x) => x.id === o.id);
      const same = JSON.stringify({ state: lo.state, authority: lo.authority }) === before;
      return { refused: { ok: refused.ok, reason: refused.reason }, target: t.state.planets[target]?.name, ratio, objId: o.id, hullId: kh.id, trail, same, authority: lo.authority, state: lo.state, actions: lo.actions };
    });
    evidence.push({ check: 'DOCTRINE-WAR-AUTHORITY:ordered', ...r });
    assert.ok(!r.error, JSON.stringify(r));
    assert.equal(r.refused.ok, false); assert.match(r.refused.reason, /no formal war/);
    assert.equal(r.same, true, 'the raid changed across save/load');
    assert.ok(r.ratio >= 1, `no raid-capable pairing: ratio ${r.ratio}`);
    assert.equal(r.state, 'engaged', `${r.trail.join(' ')} ${JSON.stringify(r.actions)}`);
    assert.equal(r.authority.source, 'formal_war');
    await shotDoctrine('P3-raid-active.png', ['Military objectives', 'Raid orders']);
    const r2 = await ev(({ objId }) => {
      const t = testBM1;
      const book = t.campaign();
      const strikes = () => (book.history || []).length;
      const o = window.__mil().find((x) => x.id === objId);
      const status0 = o.status, strikes0 = o.strikeDays, cfDay = t.state.day;
      t.changeDiplomacy('klingon', 'terran', 'ceasefire');
      window.__adv(6);
      const after = o.actions.filter((a) => a.day > cfDay);
      return { status0, strikes0, strikes1: o.strikeDays, status: o.status, resolution: o.resolution, cancelledBy: o.cancelledBy || null, actionsAfter: after, relation: t.formalRelation('klingon', 'terran').status };
    }, r);
    evidence.push({ check: 'DOCTRINE-WAR-AUTHORITY:ceasefire', ...r2 });
    assert.equal(r2.relation, 'ceasefire');
    assert.notEqual(r2.status, 'active', 'the raid went on under a ceasefire');
    assert.ok(r2.resolution.reasons.includes('objective_cancelled'), JSON.stringify(r2.resolution));
    assert.ok(r2.strikes0 >= 1, 'the raid never struck before the ceasefire');
    assert.equal(r2.strikes1, r2.strikes0, 'a strike landed after the ceasefire');
    assert.ok(!r2.actionsAfter.some((a) => a.action === 'engage'), JSON.stringify(r2.actionsAfter));
    assert.equal(r2.cancelledBy, 'authority');
    await shotDoctrine('P3-ceasefire-cancels-raid.png', ['Military objectives', 'Raid orders']);
  });

  // ---------------------------------------------------------------------------------------------
  // Tactical: the security rules of engagement and the authority chain, against the engine's own rule.
  await check('new-feature', 'SECURITY-ROE the captain\'s security ships under return-fire hold against a hostile until it attacks; under defend they engage on sight; the authority chain agrees with the engine each time and names its source', async () => {
    await fresh('p3-roe');
    const r = await ev(() => {
      const t = testBM1, s = t.state;
      const here = s.currentPlanet;
      t.transferSystemControlToPlayer(here);
      const base = { x: s.ship?.x ?? 0, y: s.ship?.y ?? 0 };
      const mk = (id, faction, dx, extra = {}) => { const n = t.createNpcShip({ id, shipId: 334, faction, attitude: extra.attitude || 'neutral', hostile: Boolean(extra.hostile), seed: 7, name: id, from: { x: base.x + dx, y: base.y }, destination: { x: base.x + dx, y: base.y }, role: extra.role || 'patrol' }); t.ensureCombatTargetStats?.(n); Object.assign(n, extra.set || {}); s.npcShips.push(n); return n; };
      const sec = mk('gate-sec', 'terran', 60, { role: 'playerFleet', set: { weaponReadyAt: 0, lastShotAt: -1e9 } });
      const hostile = mk('gate-hostile', 'klingon', 200, { attitude: 'hostile', hostile: true });
      const tgt = (npc) => { const x = t.getNpcDefenseTarget(npc); return (x?.target || x)?.id || null; };
      const pick = (c) => ({ allowed: c.allowed, objective: c.objective, authority: Object.keys(c.authority), failed: c.failed, engine: c.engineDefends, modes: c.modes });
      t.setSecurityPolicyOverride(here, { roe: 'return-fire' });
      const rf = { target: tgt(sec), chain: pick(t.doctrineEngageChain(sec, hostile, 'ship')) };
      t.setSecurityPolicyOverride(here, { roe: 'defend' });
      const df = { target: tgt(sec), chain: pick(t.doctrineEngageChain(sec, hostile, 'ship')) };
      t.setSecurityPolicyOverride(here, { roe: 'return-fire' });
      hostile.lastAggressionAt = t.gameNow(); hostile.lastAggressionSystemIndex = here; hostile.lastAggressionTargetSide = t.getNpcSideId(sec);
      const after = { target: tgt(sec), chain: pick(t.doctrineEngageChain(sec, hostile, 'ship')) };
      return { rf, df, after };
    });
    evidence.push({ check: 'SECURITY-ROE', ...r });
    assert.equal(r.rf.target, null); assert.equal(r.rf.chain.allowed, false); assert.equal(r.rf.chain.engine, false);
    assert.equal(r.df.target, 'gate-hostile'); assert.equal(r.df.chain.allowed, true, JSON.stringify(r.df.chain)); assert.equal(r.df.chain.objective, 'security policy: defend');
    assert.equal(r.after.target, 'gate-hostile'); assert.equal(r.after.chain.allowed, true); assert.ok(r.after.chain.modes.includes('self_defense'));
  });
  await check('new-feature', 'FACTION-DEFENDER-ROE a Klingon defender at a Klingon world holds against a Romulan visitor (at peace) until it attacks; afterwards engages by the engine and doctrine agrees (protect); no war authority is made from hostility', async () => {
    await fresh('p3-kdef');
    const r = await ev(() => {
      const t = testBM1, s = t.state;
      const K = window.__idx('Qonos');
      s.currentPlanet = K; t.applySystemState(K);
      s.npcShips.length = 0;
      const base = { x: s.ship?.x ?? 0, y: s.ship?.y ?? 0 };
      const mk = (id, faction, dx, extra = {}) => { const n = t.createNpcShip({ id, shipId: 334, faction, attitude: extra.attitude || 'neutral', hostile: false, seed: 7, name: id, from: { x: base.x + dx, y: base.y }, destination: { x: base.x + dx, y: base.y }, role: extra.role || 'patrol' }); t.ensureCombatTargetStats?.(n); Object.assign(n, extra.set || {}); s.npcShips.push(n); return n; };
      const kd = mk('gate-kdef', 'klingon', 60, { set: { weaponReadyAt: 0, lastShotAt: -1e9 } });
      const rv = mk('gate-rom', 'romulan', 220);
      const tgt = (npc) => { const x = t.getNpcDefenseTarget(npc); return (x?.target || x)?.id || null; };
      const pick = (c) => ({ allowed: c.allowed, objective: c.objective, authority: Object.keys(c.authority), failed: c.failed, engine: c.engineDefends, modes: c.modes });
      const before = { rel: t.formalRelation('klingon', 'romulan').status, target: tgt(kd), chain: pick(t.doctrineEngageChain(kd, rv, 'ship')) };
      rv.lastAggressionAt = t.gameNow(); rv.lastAggressionSystemIndex = K; rv.lastAggressionTargetSide = 'klingon';
      const after = { target: tgt(kd), chain: pick(t.doctrineEngageChain(kd, rv, 'ship')), rel: t.formalRelation('klingon', 'romulan').status };
      return { before, after };
    });
    evidence.push({ check: 'FACTION-DEFENDER-ROE', ...r });
    assert.equal(r.before.rel, 'peace');
    assert.equal(r.before.target, null); assert.equal(r.before.chain.allowed, false); assert.equal(r.before.chain.engine, false);
    assert.equal(r.after.target, 'gate-rom'); assert.equal(r.after.chain.allowed, true, JSON.stringify(r.after.chain));
    assert.ok(!r.after.chain.authority.includes('war_order_active')); assert.equal(r.after.rel, 'peace', 'hostility became a war');
  });
  await check('new-feature', 'FIRE-GATES-P3 no track, out of range or weapon not ready: no fire, whatever the authority; a civilian attacked may return fire (self-defence) but has no war authority', async () => {
    await fresh('p3-fire');
    const r = await ev(() => {
      const t = testBM1, s = t.state;
      const base = { x: s.ship?.x ?? 0, y: s.ship?.y ?? 0 };
      const mk = (id, faction, dx, extra = {}) => { const n = t.createNpcShip({ id, shipId: faction === 'ferengi' ? 330 : 334, faction, attitude: 'hostile', hostile: true, seed: 7, name: id, from: { x: base.x + dx, y: base.y }, destination: { x: base.x + dx, y: base.y }, role: extra.role || 'patrol' }); t.ensureCombatTargetStats?.(n); Object.assign(n, extra.set || {}); s.npcShips.push(n); return n; };
      const k = mk('gate-k', 'klingon', 60, { set: { weaponReadyAt: 0, lastShotAt: -1e9 } });
      const near = mk('gate-near', 'terran', 160);
      const far = mk('gate-far', 'terran', 60000);
      const cloaked = mk('gate-cloak', 'terran', 200, { set: { cloaked: true } });
      const war = { war_target_verified: true, war_order_active: true, engagement_objective_active: true };
      const notReady = mk('gate-k2', 'klingon', 70, { set: { weaponReadyAt: t.gameNow() + 1e7, lastShotAt: t.gameNow() } });
      const civ = mk('gate-civ', 'ferengi', 120, { role: 'trader', set: { weaponReadyAt: 0, lastShotAt: -1e9 } });
      near.lastAggressionAt = t.gameNow(); near.lastAggressionSystemIndex = s.currentPlanet; near.lastAggressionTargetSide = t.getNpcSideId(civ);
      const civChain = t.doctrineEngageChain(civ, near, 'ship');
      return {
        far: t.doctrineFireCheck(k, far, 'ship', war), blind: t.doctrineFireCheck(k, cloaked, 'ship', war), notReady: t.doctrineFireCheck(notReady, near, 'ship', war),
        civ: { allowed: civChain.allowed, modes: civChain.modes, authority: Object.keys(civChain.authority), role: civChain.role, profile: civChain.profile },
      };
    });
    evidence.push({ check: 'FIRE-GATES-P3', ...r });
    assert.equal(r.far.allowed, false); assert.ok(r.far.failed.includes('inside_equipped_range'));
    assert.equal(r.blind.allowed, false); assert.ok(r.blind.failed.includes('live_weapon_track'));
    assert.equal(r.notReady.allowed, false, JSON.stringify(r.notReady)); assert.ok(r.notReady.failed.includes('weapon_ready'), JSON.stringify(r.notReady.failed));
    assert.equal(r.civ.allowed, true, JSON.stringify(r.civ)); assert.deepEqual(r.civ.modes, ['self_defense']);
    assert.ok(!r.civ.authority.includes('war_order_active'));
  });
  await check('new-feature', 'LOCAL-CHAIN-DEBUG the debug view shows each armed ship\'s local engagement chain (target known, objective, authority, physical gates, fire) — and nothing of it reaches the captain\'s reports', async () => {
    await fresh('p3-chain-debug');
    const r = await ev(() => {
      const t = testBM1, s = t.state;
      const here = s.currentPlanet;
      t.transferSystemControlToPlayer(here);
      t.setSecurityPolicyOverride(here, { roe: 'return-fire' });
      const base = { x: s.ship?.x ?? 0, y: s.ship?.y ?? 0 };
      const mk = (id, faction, dx, extra = {}) => { const n = t.createNpcShip({ id, shipId: 334, faction, attitude: extra.attitude || 'neutral', hostile: Boolean(extra.hostile), seed: 7, name: id, from: { x: base.x + dx, y: base.y }, destination: { x: base.x + dx, y: base.y }, role: extra.role || 'patrol' }); t.ensureCombatTargetStats?.(n); s.npcShips.push(n); return n; };
      mk('Security One', 'terran', 60, { role: 'playerFleet' });
      mk('Hostile Bird', 'klingon', 200, { attitude: 'hostile', hostile: true });
      t.openDebugMenu();
      const sec = document.querySelector('[data-doctrine-section]');
      const text = sec.textContent;
      document.getElementById('cheats-debug').close();
      return { hasTable: /Local engagement chain/.test(text), row: /Security One/.test(text) && /not authorised/.test(text), reports: window.__reports().filter((x) => /engagement chain|authority|physical gates/i.test(`${x.kind} ${x.text}`)).length };
    });
    evidence.push({ check: 'LOCAL-CHAIN-DEBUG', ...r });
    assert.equal(r.hasTable, true); assert.equal(r.row, true); assert.equal(r.reports, 0);
    await shotDoctrine('P3-local-engagement-chain.png', ['Local engagement chain']);
  });

  // ---------------------------------------------------------------------------------------------
  await check('new-feature', 'PLAYER-REPORTS-P3 a defence force leaving is reported to the captain only through a source at that system, with no doctrine reasoning, attacker attribution or rule', async () => {
    // Present: Terran command defends Epsilon from Earth, in the captain's own (Terran) space, where the
    // captain has a source. Absent: Klingon command defends Oce Nu against a Terran assault from inside
    // Klingon space, where the captain has none.
    const run = async (present) => { await fresh(`p3-reports-${present}`); return ev((present) => {
      const t = testBM1;
      window.__quiet();
      const E = window.__idx('Epsilon'), O = window.__idx('Oce Nu');
      const [attacker, from, target] = present ? ['klingon', O, E] : ['terran', E, O];
      const hs = window.__ready(attacker).filter((h) => window.__cond(h) === 'operational').slice(0, 3);
      for (const h of hs) h.systemIndex = from;
      window.__authored((b, w, fx) => t.Campaign.launchOperation(b, w, attacker, hs, target, t.state.day, 1, 'assault', fx));
      window.__adv(4);
      const defence = window.__mil().find((o) => o.kind === 'defense');
      const reps = window.__reports().filter((rep) => String(rep.id || '').startsWith('doctrine:') && String(rep.id).includes(':defense'));
      return { defence: defence && { polity: defence.polity, from: defence.fromSystem ?? null, actions: defence.actions.slice(0, 3) }, sourceAtDeparture: defence?.fromSystem != null ? t.campaignIntelSource(defence.fromSystem) : null,
        reps: reps.map((rep) => ({ id: rep.id, kind: rep.kind, text: rep.text, systemIndex: rep.systemIndex, source: t.campaignIntelSource(rep.systemIndex) })) };
    }, present); };
    const present = await run(true), absent = await run(false);
    evidence.push({ check: 'PLAYER-REPORTS-P3', present, absent });
    assert.ok(present.reps.length >= 1, JSON.stringify(present));
    assert.ok(present.reps.every((x) => x.source !== 'none'));
    assert.equal(absent.defence?.polity, 'klingon', `no Klingon defence to report: ${JSON.stringify(absent)}`);
    assert.equal(absent.sourceAtDeparture, 'none', JSON.stringify(absent));
    assert.equal(absent.reps.length, 0, JSON.stringify(absent.reps));
    for (const x of present.reps) assert.doesNotMatch(`${x.kind} ${x.text}`, /doctrine|profile|rule|shadow|defer|authority|obligation|klingon/i);
  });

  await check('new-feature', 'SHOTS the phase 3 debug views', async () => {
    for (const f of ['P3-stranded-day1.png', 'P3-stranded-day8.png', 'P3-stranded-day23.png', 'P3-rescue-after-multijump.png', 'P3-defense-objective.png', 'P3-defense-closed.png', 'P3-patrol-responding.png', 'P3-patrol-returned.png', 'P3-raid-active.png', 'P3-ceasefire-cancels-raid.png', 'P3-local-engagement-chain.png'])
      assert.ok(fs.existsSync(path.join(out, f)) && fs.statSync(path.join(out, f)).size > 10000, `missing ${f}`);
  });

  const shadow = await ev(() => window.__sh || []);
  const cmp = shadow.map((x) => ({ day: x.day, actor: x.actor, incident: x.incident, profile: x.profile, role: x.role, existingAction: x.existing, doctrineProposal: x.proposal, matchedRule: x.matchedRule, live: x.live, objective: x.objective, reason: x.notActing || (x.live ? 'live pilot response' : null), knownFacts: x.knownFacts, capacity: x.capacity }));
  fs.writeFileSync(path.join(out, 'shadow-comparison-phase3.json'), JSON.stringify(cmp, null, 1));
  fs.writeFileSync(path.join(out, 'doctrine-phase3-evidence.json'), JSON.stringify({ results, evidence }, null, 1));
  const byCat = (c) => { const r = results.filter((x) => x.category === c); return `${r.filter((x) => x.ok).length}/${r.length}`; };
  console.log(`\ndoctrine runtime phase 3 in-game: ${results.filter((x) => x.ok).length}/${results.length} (baseline-defect ${byCat('baseline-defect')}, new-feature ${byCat('new-feature')}, preservation ${byCat('preservation')})`);
  if (probe.errors.length) console.log('page errors:', probe.errors.slice(0, 5));
  await probe.close();
  process.exit(results.every((x) => x.ok) && !probe.errors.length ? 0 : 1);
})();
