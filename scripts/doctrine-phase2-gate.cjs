// Gate for faction doctrine runtime phase 2, stacked on 82b7c79.
// Rules: docs/doctrine/DOCTRINE-RUNTIME-PHASE2.md.
//
// Categories:
//   baseline-defect  fails on 82b7c79 on its own assertion: a real gap in phase 1 that phase 2 closes
//                    (no distress incident for a crew calling for help; a relayed report arriving at once
//                    however far; a relay carrying everything the sender knew)
//   new-feature      needs state 82b7c79 does not have
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
  const shadow = [];
  async function check(category, name, fn) {
    try { await fn(); results.push({ category, name, ok: true }); console.log('PASS', `[${category}]`, name); }
    catch (err) { results.push({ category, name, ok: false, message: String(err?.message || err).split('\n').slice(0, 6).join(' ') }); console.log('FAIL', `[${category}]`, name, '\n      ', String(err?.message || err).split('\n').slice(0, 8).join(' ')); }
  }
  // The doctrine section of Cheats & Debug, laid out at full height. `only` limits the picture to the
  // headings named (and the header), so each screenshot shows what it is about.
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
    window.__quiet = () => { const db = window.__D(); db.config = { ...db.config, patrols: {}, explorers: {}, merchants: {}, projects: {} }; };
    window.__authored = (fn) => t.runCampaignAuthored(fn);
    window.__assign = (spec) => window.__authored((book, world, fx) => t.DoctrineCampaign.issueAssignment(book, world, spec, t.state.day, fx));
    window.__patrol = (polity, hullId, target, opts = {}) => window.__authored((book, world, fx) => t.DoctrineCampaign.issuePatrol(book, world, polity, hullId, target, t.state.day, fx, opts));
    window.__lose = (asgId, mode = 'destroyed', opts = {}) => t.DoctrineCampaign.loseAssignmentHullUnwitnessed(t.campaign(), t.buildCampaignWorld(true), asgId, t.state.day, mode, opts);
    window.__relay = (inc, from, to, opts = {}) => t.DoctrineCampaign.relayReport(t.campaign(), t.buildCampaignWorld(true), inc, from, to, t.state.day, opts);
    window.__eval = (obs, inc) => window.__D().lastEval[`${obs}|${inc}`] || null;
    window.__inc = (pred) => Object.values(window.__D().incidents).filter(pred);
    window.__know = (obs, inc) => window.__D().knowledge[obs]?.[inc] || null;
    window.__reports = () => (t.galaxyNewsBook().items || []).concat(t.galaxyNewsBook().pending || []).concat(t.campaignBook().reports || []);
    window.__relief = () => Object.keys(window.__D().designations?.vulcan || {})[0];
    window.__sh = window.__sh || [];
  });
  await setup();

  // ---------------------------------------------------------------------------------------------
  await check('new-feature', 'P2-HEADER the doctrine debug header names the source package status and the runtime phase separately; the source package itself is unchanged', async () => {
    await fresh('p2-header');
    const r = await ev(() => { testBM1.openDebugMenu(); const text = document.querySelector('[data-doctrine-section]')?.textContent || ''; document.getElementById('cheats-debug').close(); return { text: text.slice(0, 600), status: testBM1.getDoctrineRuntime()?.data?.status }; });
    evidence.push({ check: 'P2-HEADER', ...r });
    assert.match(r.text, /Source package status: DESIGN_ONLY_NOT_LOADED_BY_GAME · Runtime integration: Phase 2/);
    assert.doesNotMatch(r.text, /\. Package status:/);
    assert.equal(r.status, 'DESIGN_ONLY_NOT_LOADED_BY_GAME', 'the source package was rewritten');
  });

  // ---------------------------------------------------------------------------------------------
  // A Romulan refugee transport from Aldnas home to Romulus, sailing into a Terran blockade of Romulus.
  // The blockade (the shared engine) disables it; its crew call for help from where they lie.
  const distressSetup = () => ev(() => {
    const t = testBM1;
    window.__quiet();
    // No AI offensives in this scenario: they would take the relief ship for an operation of their own.
    t.campaign().config.aiStrategicOps = false;
    const R = window.__idx('Romulus'), A = window.__idx('Aldnas'), Rm = window.__idx('Remus');
    t.changeDiplomacy('romulan', 'terran', 'war');
    // Gate fixture: the Vulcans are at war with the blockading Terrans too, so the blockade bears on the
    // relief ship as well as on the transport.
    t.changeDiplomacy('vulcan', 'terran', 'war');
    const book = t.campaign();
    t.syncPlayerPolity(book);
    const terr = book.polities.terran.hulls.filter((h) => h.status === 'ready' && !h.opId).slice(0, 16);
    for (const h of terr) h.systemIndex = R;
    const fx = [];
    const b = t.Campaign.startBlockade(book, t.buildCampaignWorld(true), { power: 'terran', target: R, hullIds: terr.map((h) => h.id), purpose: 'cut_reinforcements' }, t.state.day, fx);
    t.applyCampaignEffects(fx, t.state.day);
    if (!b.ok) return { error: b.reason };
    window.__adv(1);
    // A Romulan refugee transport from Aldnas into blockaded Romulus, then on to Remus to report in.
    const tr = window.__ready('romulan').find((h) => h.systemIndex !== R) || window.__ready('romulan')[0];
    tr.systemIndex = A;
    const asg = window.__assign({ polity: 'romulan', hullId: tr.id, kind: 'transport', doctrineRole: 'civilian', stops: [{ systemIndex: R, dwell: 1, milestone: 'arrival' }, { systemIndex: Rm, milestone: 'check_in' }] });
    // It runs the blockade (the shared engine). Whatever the run does to it, the gate then has it lost at
    // Romulus with its people in lifeboats (an override), so the scenario has survivors who cannot simply
    // repair and sail away.
    let disabledBy = null;
    for (let i = 0; i < 3 && !disabledBy; i++) {
      window.__adv(1);
      const h = window.__P('romulan').hulls.find((x) => x.id === tr.id);
      if (h.systemIndex === R || h.status === 'lost') { disabledBy = `blockade run: ${h.status}${h.status === 'lost' ? '' : '; then lost at Romulus with its people in lifeboats (override)'}`; if (h.status !== 'lost') window.__lose(asg.assignment.id, 'destroyed', { pods: true }); }
    }
    const runs = window.__D().assignments.find((a) => a.id === asg.assignment.id)?.runs || [];
    window.__adv(2);
    return { blockade: b.record.id, asg: asg.assignment.id, transport: tr.id, vid: tr.identity?.vid, disabledBy, transportRuns: runs, R, A, day: t.state.day };
  });

  await check('baseline-defect', 'DISTRESS-CALL a disabled transport\'s crew call for help: one persistent distress incident carrying only what the call says (who, where, alive, urgency, the blockade hazard); heard by the commands in range, not by distant Vulcan', async () => {
    await fresh('p2-distress-call');
    const s = await distressSetup();
    assert.ok(!s.error, s.error);
    const r = await ev((s) => {
      const t = testBM1;
      const d = window.__inc((i) => i.eventType === 'distress');
      const inc = d[0];
      const beacon = inc && window.__know(inc.detectedBy, inc.id);
      const heard = inc ? Object.entries(window.__D().knowledge).filter(([, st]) => st[inc.id]).map(([o]) => o).sort() : [];
      return { count: d.length, inc, beacon: beacon && { claims: beacon.claims, survivors: beacon.survivors }, heard, reliefKnows: inc ? Boolean(window.__know(`hull:${window.__relief()}`, inc.id)) : null };
    }, s);
    evidence.push({ check: 'DISTRESS-CALL', setup: s, ...r });
    assert.equal(r.count, 1, `a crew calling for help made no distress incident (${JSON.stringify(s)})`);
    assert.equal(r.inc.assetId, s.vid);
    assert.equal(r.beacon.claims.asset.role, 'refugee_transport');
    assert.ok(['critical', 'lifeboats'].includes(r.beacon.claims.urgency), r.beacon.claims.urgency);
    assert.ok(r.beacon.survivors?.locationId, 'no survivors in the call');
    assert.ok(s.transportRuns.length >= 1, 'the transport entered the blockaded system without the shared engine');
    assert.ok(r.beacon.claims.hazards.some((h) => h.kind === 'blockade' && h.power === 'terran'), JSON.stringify(r.beacon.claims.hazards));
    assert.ok(r.heard.includes('command:romulan'), r.heard.join(','));
    assert.ok(!r.heard.some((o) => o.includes('vulcan')), `Vulcan heard a call from out of range: ${r.heard.join(',')}`);
    assert.equal(r.reliefKnows, false);
    assert.equal(r.beacon.claims.cargo, undefined, 'the call carried cargo');
  });

  await check('new-feature', 'DOCTRINE-DISTRESS-INTEGRATION the transport calls; Vulcan gets only the overdue notice (record only); the Romulans hold the survivor report; Vulcan reacts only once it reaches them; a real relief ship; the blockade on its way runs through the shared engine; save/load midway; the objective closes', async () => {
    await fresh('p2-ddi');
    const s = await distressSetup();
    assert.ok(!s.error, s.error);
    // 1. Romulan command notices its transport overdue and tells Vulcan command: an overdue notice only.
    const s1 = await ev((s) => {
      const t = testBM1;
      const asg = window.__D().assignments.find((a) => a.id === s.asg);
      const m = asg.milestones.at(-1);
      window.__adv(Math.max(0, m.dueDay + m.grace + 1 - t.state.day));
      const od = window.__inc((i) => i.eventType === 'asset_overdue' && i.polity === 'romulan')[0];
      const dist = window.__inc((i) => i.eventType === 'distress')[0];
      const msg = od && window.__relay(od.id, 'command:romulan', 'command:vulcan', { include: 'overdue_notice', channel: 'network', kind: 'ally-notice' });
      window.__adv(3);
      const relief = window.__relief();
      return { od: od?.id, dist: dist?.id, relief, msg: msg && { id: msg.id, state: msg.state, deliveredDay: msg.deliveredDay, hops: msg.hops, sentDay: msg.sentDay },
        reliefOnOverdue: window.__eval(`hull:${relief}`, od?.id), reliefOnDistress: window.__eval(`hull:${relief}`, dist?.id), romulanOnDistress: window.__eval('command:romulan', dist?.id),
        reliefObjectives: window.__D().objectives.filter((o) => o.actor === `hull:${relief}`).length, reliefKnowsSurvivors: Boolean(window.__know(`hull:${relief}`, od?.id)?.survivors) };
    }, s);
    evidence.push({ check: 'DDI stage 1 (overdue notice only)', ...s1 });
    assert.ok(s1.od && s1.dist, JSON.stringify(s1));
    assert.equal(s1.msg.state, 'delivered'); assert.ok(s1.msg.deliveredDay > s1.msg.sentDay, 'the network notice arrived the day it was sent');
    assert.equal(s1.reliefOnOverdue?.proposal, 'record_only', JSON.stringify(s1.reliefOnOverdue));
    assert.equal(s1.reliefKnowsSurvivors, false);
    assert.equal(s1.reliefObjectives, 0, 'rescue on an overdue notice');
    assert.ok(s1.romulanOnDistress.knownFacts.includes('survivors_known'), JSON.stringify(s1.romulanOnDistress));
    assert.equal(s1.romulanOnDistress.proposal, 'record_only');
    await shotDoctrine('P2-distress-overdue-only.png', ['Active incidents', 'Last shadow', 'Reports']);
    // 2. The Romulans pass the survivor report to Vulcan command, over the network.
    const s2 = await ev((s1) => {
      const t = testBM1;
      const msg = window.__relay(s1.dist, 'command:romulan', 'command:vulcan', { include: 'survivor_report', channel: 'network', kind: 'pass-on-call' });
      const pendingBefore = msg.state;
      const reliefBefore = window.__know(`hull:${s1.relief}`, s1.dist);
      window.__adv(1);
      return { msg: { id: msg.id, state: msg.state, pendingBefore, deliverDay: msg.deliverDay }, reliefBefore: Boolean(reliefBefore) };
    }, s1);
    evidence.push({ check: 'DDI stage 2 (survivor report sent)', ...s2 });
    assert.equal(s2.msg.pendingBefore, 'pending'); assert.equal(s2.reliefBefore, false);
    // 3. Save and load midway: while the report travels or the relief is on its way.
    const snap = await ev(() => {
      const t = testBM1;
      const pick = () => { const db = window.__D(); return JSON.stringify({ incidents: db.incidents, messages: db.messages, objectives: db.objectives.map((o) => [o.id, o.status, o.assigned, o.deadline]), knowledge: db.knowledge, assignments: db.assignments.map((a) => [a.id, a.status, a.pos, a.hullId, a.vid]) }); };
      const before = pick();
      t.saveGame(9); t.startWithFaction('ferengi'); t.loadGame(9);
      return { same: pick() === before, day: t.state.day, pending: window.__D().messages.filter((m) => m.state === 'pending').map((m) => m.id) };
    });
    evidence.push({ check: 'DDI save/load midway', ...snap });
    assert.equal(snap.same, true, 'incident/report/objective/knowledge state changed across save/load');
    const s3 = await ev((s1) => {
      const t = testBM1;
      for (let i = 0; i < 4 && !window.__D().objectives.some((o) => o.actor === `hull:${s1.relief}`); i++) window.__adv(1);
      const o = window.__D().objectives.find((x) => x.actor === `hull:${s1.relief}`);
      const rv = window.__D().reevaluations.filter((r) => r.actor === `hull:${s1.relief}`);
      const h = window.__P('vulcan').hulls.find((x) => x.id === s1.relief);
      return { o: o && { id: o.id, incidentId: o.incidentId, response: o.response, status: o.status, vid: o.assigned.vid, hullId: o.assigned.hullId, target: o.target, assignmentId: o.assignmentId }, rv, reliefVid: h?.identity?.vid, day: t.state.day };
    }, s1);
    evidence.push({ check: 'DDI stage 3 (relief responds)', ...s3 });
    assert.ok(s3.o, 'Vulcan never responded to the survivor report');
    assert.equal(s3.o.incidentId, s1.dist); assert.equal(s3.o.response, 'rescue'); assert.equal(s3.o.hullId, s1.relief); assert.equal(s3.o.vid, s3.reliefVid);
    assert.ok(s3.rv.some((r) => r.incident === s1.dist && r.to === 'live:rescue'), JSON.stringify(s3.rv));
    await shotDoctrine('P2-distress-rescue-live.png', ['Active incidents', 'Last shadow', 'Doctrine objectives', 'Reports', 'Reevaluations']);
    // 4. The relief sails into the blockade; the objective ends on its own terms.
    const s4 = await ev(([s1, s3]) => {
      const t = testBM1;
      const o = window.__D().objectives.find((x) => x.id === s3.o.id);
      for (let i = 0; i < 20 && o.status === 'active'; i++) window.__adv(1);
      const asg = window.__D().assignments.find((a) => a.id === o.assignmentId);
      const blk = (t.campaign().blockades || []).find((b) => b.power === 'terran');
      const dist = window.__D().incidents[s1.dist];
      window.__sh.push(...window.__D().shadow.filter((x) => x.incident === s1.dist || x.incident === s1.od));
      return { status: o.status, resolution: o.resolution, runs: asg?.runs || [], blockadeRuns: (blk?.runs || []).filter((r) => String(r.by).startsWith(o.assignmentId)), dist: dist && { status: dist.status, resolution: dist.resolution },
        duplicates: window.__inc((i) => i.eventType === 'distress' && i.assetId === dist?.assetId).length, spawned: false };
    }, [s1, s3]).catch(async (e) => { throw e; });
    evidence.push({ check: 'DDI stage 4 (closure)', ...s4 });
    assert.notEqual(s4.status, 'active');
    assert.ok(s4.runs.length >= 1 && s4.blockadeRuns.length >= 1, `the relief crossed the blockade without the shared engine: ${JSON.stringify(s4.runs)}`);
    assert.equal(s4.duplicates, 1);
    if (s4.status === 'completed') assert.equal(s4.dist.resolution?.status, 'survivors_rescued');
    else assert.ok(s4.resolution.reasons.length && (s4.resolution.note || s4.resolution.reasons.join()), JSON.stringify(s4.resolution));
    await shotDoctrine('P2-distress-closed.png', ['Active incidents', 'Doctrine objectives', 'Reevaluations', 'Objective conflicts']);
  });

  // ---------------------------------------------------------------------------------------------
  await check('baseline-defect', 'REPORT-DELAY a report sent across the chart is pending until the network brings it (the recipient knows nothing and does nothing meanwhile); one to the next system arrives sooner', async () => {
    await fresh('p2-delay');
    const r = await ev(() => {
      const t = testBM1;
      window.__quiet();
      const R = window.__idx('Romulus'), A = window.__idx('Aldnas');
      const h = window.__ready('romulan', R)[0];
      const p = window.__patrol('romulan', h.id, A);
      window.__adv(1);
      window.__lose(p.assignment.id, 'destroyed', { silent: true });
      const m = p.assignment.milestones.at(-1);
      window.__adv(m.dueDay + m.grace + 1 - t.state.day);
      const inc = window.__inc((i) => i.eventType === 'asset_overdue' && i.polity === 'romulan')[0];
      const far = window.__relay(inc.id, 'command:romulan', 'command:ferengi', { include: 'overdue_notice', channel: 'network', kind: 'far' });
      const known0 = Boolean(window.__know('command:ferengi', inc.id));
      const e0 = window.__eval('command:ferengi', inc.id);
      window.__adv(1);
      const known1 = Boolean(window.__know('command:ferengi', inc.id));
      for (let i = 0; i < 6 && far && far.state === 'pending'; i++) window.__adv(1);
      return { inc: inc.id, far: far && { state: far.state, sentDay: far.sentDay, deliverDay: far.deliverDay, deliveredDay: far.deliveredDay, hops: far.hops }, known0, known1, e0: e0?.proposal ?? null, eAfter: window.__eval('command:ferengi', inc.id)?.proposal ?? null };
    });
    evidence.push({ check: 'REPORT-DELAY', ...r });
    assert.equal(r.known0, false, 'the report reached a command across the chart the day it was sent');
    assert.ok(r.far && r.far.deliveredDay != null, JSON.stringify(r.far));
    assert.ok(r.far.deliveredDay > r.far.sentDay && r.far.deliveredDay - r.far.sentDay <= 5, JSON.stringify(r.far));
    assert.ok(r.e0 === 'ignore_unknown' || r.e0 == null, `an undelivered report touched the recipient's doctrine: ${r.e0}`);
    assert.equal(r.eAfter, 'record_only');
  });

  await check('baseline-defect', 'PAYLOAD-BOUNDED a report carries only its payload: an overdue notice gives the missing ship and where it was expected, never the owner\'s evidence, its fate, the survivors, an attacker or the hidden cargo', async () => {
    await fresh('p2-payload');
    const r = await ev(() => {
      const t = testBM1;
      window.__quiet();
      const R = window.__idx('Romulus'), A = window.__idx('Aldnas');
      const h = window.__ready('romulan', R)[0];
      const p = window.__patrol('romulan', h.id, A, { cargo: { knowledge: 'verified', manifest: [{ cargoId: 'hidden:design-samples', quantity: 4 }] } });
      window.__adv(1);
      window.__lose(p.assignment.id, 'disabled', { silent: true });
      const m = p.assignment.milestones.at(-1);
      window.__adv(m.dueDay + m.grace + 1 - t.state.day + 8); // the owner's search examines the site
      const inc = window.__inc((i) => i.eventType === 'asset_overdue' && i.polity === 'romulan')[0];
      const own = window.__know('command:romulan', inc.id);
      window.__relay(inc.id, 'command:romulan', 'command:klingon', { include: 'overdue_notice' });
      const k = window.__know('command:klingon', inc.id);
      const e = (window.__adv(1), window.__eval('command:klingon', inc.id));
      return { ownEvidence: Object.keys(own.evidence).length, ownLocated: Boolean(own.located), ownResolution: own.resolution?.status || null, k: k && { claims: Object.keys(k.claims).sort(), evidence: Object.keys(k.evidence).length, survivors: k.survivors, resolution: k.resolution, located: k.located ?? null, attribution: k.attribution, cargo: k.claims.cargo, missed: k.claims.missedMilestone?.kind, area: k.lastKnownArea },
        facts: e?.knownFacts, text: JSON.stringify(t.DoctrineCampaign.doctrineBook(t.campaign()).knowledge['command:klingon'] || {}) .includes('hidden:design-samples') };
    });
    evidence.push({ check: 'PAYLOAD-BOUNDED', ...r });
    assert.ok(r.ownEvidence > 0, 'precondition: the owner found nothing');
    assert.ok(r.k, 'nothing delivered');
    assert.equal(r.k.evidence, 0, `the owner's evidence travelled in an overdue notice (${r.k.evidence} site(s))`);
    assert.equal(r.k.resolution, null, 'the owner\'s answer travelled in an overdue notice');
    assert.equal(r.k.located, null); assert.equal(r.k.survivors, null); assert.equal(r.k.attribution, null);
    assert.deepEqual(r.k.cargo, { knowledge: 'unknown', manifest: null }); assert.equal(r.text, false);
    assert.equal(r.k.missed, 'check_in'); assert.equal(r.k.area, 'system:aldnas');
    for (const f of ['actor_attributed', 'identity_known', 'survivors_known', 'linked_own_losses']) assert.ok(!r.facts.includes(f), f);
  });

  // ---------------------------------------------------------------------------------------------
  await check('new-feature', 'DOCTRINE-REPORT-REEVALUATION Klingon command records a plain overdue report of the Romulan loss; separate findings that link Klingon losses reach it later over the network; the SAME incident reevaluates to investigate (shadow); no duplicate incident, no attribution', async () => {
    await fresh('p2-drr');
    const s1 = await ev(() => {
      const t = testBM1;
      window.__quiet();
      const R = window.__idx('Romulus'), A = window.__idx('Aldnas'), Dl = window.__idx('Delpi');
      const h = window.__ready('romulan', R)[0];
      const p = window.__patrol('romulan', h.id, A);
      window.__adv(1);
      window.__lose(p.assignment.id, 'destroyed', { silent: true });
      const kh = window.__ready('klingon')[0]; kh.systemIndex = R;
      const kr = window.__patrol('klingon', kh.id, A);
      window.__adv(1);
      window.__lose(kr.assignment.id, 'destroyed', { silent: true });
      const m = p.assignment.milestones.at(-1);
      window.__adv(Math.max(0, m.dueDay + m.grace + 1 - t.state.day));
      const inc = window.__inc((i) => i.eventType === 'asset_overdue' && i.polity === 'romulan' && i.assignmentId === p.assignment.id)[0];
      const msg = window.__relay(inc.id, 'command:romulan', 'command:klingon', { include: 'overdue_notice', channel: 'network', kind: 'ally-notice' });
      window.__adv(3);
      const dh = window.__ready('delpin', Dl)[0];
      window.__assign({ polity: 'delpin', hullId: dh.id, kind: 'exploration', doctrineRole: 'explorer', stops: [{ systemIndex: A, dwell: 10, milestone: 'arrival' }, { systemIndex: Dl, milestone: 'check_in' }] });
      window.__relay(inc.id, 'command:romulan', `hull:${dh.id}`, { include: 'overdue_notice', kind: 'told-explorer' });
      return { inc: inc.id, dh: dh.id, msg: { state: msg.state, sentDay: msg.sentDay, deliveredDay: msg.deliveredDay }, klingon: window.__eval('command:klingon', inc.id), count: window.__inc(() => true).filter((i) => i.eventType === 'asset_overdue' && i.polity === 'romulan').length };
    });
    evidence.push({ check: 'DRR stage 1 (plain overdue report)', ...s1 });
    assert.equal(s1.klingon.proposal, 'record_only', JSON.stringify(s1.klingon));
    assert.ok(!s1.klingon.knownFacts.includes('linked_own_losses'));
    await shotDoctrine('P2-report-reevaluation-before.png', ['Active incidents', 'Last shadow', 'Reports']);
    const s2 = await ev((s1) => {
      const t = testBM1;
      for (let i = 0; i < 12 && !Object.values(window.__know(`hull:${s1.dh}`, s1.inc)?.evidence || {}).some((e) => e.recovered); i++) window.__adv(1);
      const recovered = Object.values(window.__know(`hull:${s1.dh}`, s1.inc)?.evidence || {}).some((e) => e.recovered);
      const before = window.__eval('command:klingon', s1.inc)?.proposal;
      const msg = window.__relay(s1.inc, `hull:${s1.dh}`, 'command:klingon', { include: 'findings', channel: 'network', kind: 'explorer-findings' });
      const pending = msg?.state;
      for (let i = 0; i < 6 && msg?.state === 'pending'; i++) window.__adv(1);
      window.__adv(1);
      const db = window.__D();
      window.__sh.push(...db.shadow.filter((x) => x.incident === s1.inc));
      return { recovered, before, msg: msg && { id: msg.id, state: msg.state, pending, sentDay: msg.sentDay, deliveredDay: msg.deliveredDay, hops: msg.hops }, klingon: window.__eval('command:klingon', s1.inc),
        rv: db.reevaluations.filter((r) => r.actor === 'command:klingon' && r.incident === s1.inc), count: Object.values(db.incidents).filter((i) => i.eventType === 'asset_overdue' && i.polity === 'romulan').length,
        attributions: Object.values(db.knowledge).flatMap((st) => Object.values(st)).filter((k) => k.attribution).length, klingonObjectives: db.objectives.filter((o) => o.polity === 'klingon').length };
    }, s1);
    evidence.push({ check: 'DRR stage 2 (findings reach Klingon)', ...s2 });
    assert.ok(s2.recovered, 'precondition: the explorer recovered nothing');
    assert.equal(s2.before, 'record_only', 'Klingon reevaluated before the findings reached it');
    assert.equal(s2.msg.pending, 'pending');
    assert.ok(s2.klingon.knownFacts.includes('linked_own_losses'), JSON.stringify(s2.klingon));
    assert.equal(s2.klingon.matchedRule, 'shared_losses');
    assert.ok(['investigate', 'defer:investigate'].includes(s2.klingon.proposal), s2.klingon.proposal);
    assert.equal(s2.klingon.live, false); assert.equal(s2.klingonObjectives, 0);
    assert.ok(s2.rv.some((r) => r.from === 'record_only' && /linked_own_losses/.test(r.cause)), JSON.stringify(s2.rv));
    assert.equal(s2.count, s1.count, 'a duplicate incident'); assert.equal(s2.attributions, 0, 'an attribution appeared');
    await shotDoctrine('P2-report-reevaluation-after.png', ['Active incidents', 'Last shadow', 'Reports', 'Reevaluations']);
  });

  // ---------------------------------------------------------------------------------------------
  await check('new-feature', 'FERENGI-REROUTE a Ferengi freighter misses its delivery; its command\'s notice reaches the next freighter, whose contract runs the same way; it reroutes (live), same vessel, same contract; the Ferengi investigate nothing', async () => {
    await fresh('p2-ferengi');
    const r = await ev(() => {
      const t = testBM1;
      window.__quiet();
      const F = window.__idx('Ferenginar');
      const world = t.buildCampaignWorld(true);
      // A destination two or three jumps off whose way leads through one system, with another way round.
      const bfs = (from, avoid = new Set()) => { const prev = new Map([[from, null]]); const q = [from]; while (q.length) { const c = q.shift(); for (const n of world.neighbours(c).map(Number)) if (!prev.has(n) && !avoid.has(n)) { prev.set(n, c); q.push(n); } } return prev; };
      const pathTo = (prev, to) => { if (!prev.has(to)) return null; const p = []; for (let x = to; x != null; x = prev.get(x)) p.unshift(x); return p; };
      const all = bfs(F);
      let pick = null;
      for (const [dest] of all) {
        const p = pathTo(all, dest);
        if (!p || p.length < 3 || p.length > 4 || !world.systems[dest]?.controller || world.relation('ferengi', world.systems[dest].controller) === 'war') continue;
        const other = [...all.keys()].find((d2) => { const p2 = pathTo(all, d2); return p2 && p2.length >= 3 && p2.length <= 4 && p2[1] === p[1] && d2 !== dest && world.systems[d2]?.controller && world.relation('ferengi', world.systems[d2].controller) !== 'war'; });
        if (!other) continue;
        const around = pathTo(bfs(F, new Set(pathTo(all, other).slice(1))), dest);
        if (around && around.length <= p.length + 2) { pick = { first: other, second: dest, via: p[1] }; break; }
      }
      if (!pick) return { error: 'no suitable Ferengi lanes in this galaxy' };
      const [f1, f2] = window.__ready('ferengi', F);
      const d1 = window.__authored((book, w, fx) => t.DoctrineCampaign.issueDelivery(book, w, 'ferengi', f1.id, pick.first, t.state.day, fx));
      window.__adv(2); // a day loading, a day's jump
      window.__lose(d1.assignment.id, 'destroyed', { silent: true });
      const m = d1.assignment.milestones[0];
      window.__adv(Math.max(0, m.dueDay + m.grace - t.state.day));
      const d2 = window.__authored((book, w, fx) => t.DoctrineCampaign.issueDelivery(book, w, 'ferengi', f2.id, pick.second, t.state.day, fx));
      const oldRoute = d2.assignment.itinerary.map((s) => s.systemIndex);
      window.__adv(1);
      const db = window.__D();
      const inc = Object.values(db.incidents).find((i) => i.polity === 'ferengi' && i.eventType === 'asset_overdue');
      const o = db.objectives.find((x) => x.actor === `hull:${f2.id}`);
      const e = inc && window.__eval(`hull:${f2.id}`, inc.id);
      const mid = o && { response: o.response, contractId: o.contractId, reroute: o.reroute, status: o.status };
      let deliveredAt = null;
      for (let i = 0; i < 8 && o && o.status === 'active'; i++) { window.__adv(1); if (deliveredAt == null && db.contracts[d2.contract.id]?.status === 'completed') deliveredAt = window.__P('ferengi').hulls.find((h) => h.id === f2.id)?.systemIndex; }
      window.__sh.push(...db.shadow.filter((x) => x.incident === inc?.id));
      return { pick, inc: inc && { id: inc.id, contractId: inc.contractId }, c1: d1.contract.id, c2: d2.contract.id, oldRoute, e, mid, final: o && { status: o.status, resolution: o.resolution }, contract2: db.contracts[d2.contract.id]?.status,
        deliveredAt, f2id: f2.id, f2vid: f2.identity?.vid, asgVid: d2.assignment.vid, asgHull: d2.assignment.hullId, investigations: db.objectives.filter((x) => x.polity === 'ferengi' && x.response === 'investigate').length,
        reps: window.__reports().filter((x) => String(x.id || '').includes(':reroute')).map((x) => ({ kind: x.kind, text: x.text })) };
    });
    evidence.push({ check: 'FERENGI-REROUTE', ...r });
    assert.ok(!r.error, r.error);
    assert.ok(r.inc && r.inc.contractId === r.c1, JSON.stringify(r.inc));
    assert.ok(r.e.knownFacts.includes('contract_affected'), JSON.stringify(r.e));
    assert.equal(r.e.matchedRule, 'contract_risk'); assert.equal(r.e.live, true);
    assert.equal(r.mid.response, 'reroute'); assert.equal(r.mid.contractId, r.c2);
    assert.ok(!r.mid.reroute.newRoute.includes(r.pick.via), JSON.stringify(r.mid.reroute));
    assert.equal(r.asgHull, r.f2id); assert.equal(r.asgVid, r.f2vid);
    assert.equal(r.investigations, 0, 'a Ferengi became an investigator');
    assert.notEqual(r.final.status, 'active');
    assert.equal(r.contract2, 'completed'); assert.equal(r.deliveredAt, r.pick.second, 'the contract was marked delivered away from its destination');
  });

  await check('new-feature', 'THOLIAN-ESCORT a Tholian tender is lost on a real project; the command first defers (no load to protect), then escorts the next tender with an existing armed ship; the escort stays with its named charge and closes when the charge is safe; nothing spawned', async () => {
    await fresh('p2-tholian');
    const r = await ev(() => {
      const t = testBM1;
      window.__quiet();
      const T = window.__idx('Tholia');
      const world = t.buildCampaignWorld(true);
      // Site: a Tholian world two jumps from Tholia.
      const held = world.systems.filter((s) => s.controller === 'tholian').map((s) => s.index);
      const site = held.find((i) => i !== T && t.Campaign.shortestRoute?.(world, T, i, 'tholian')?.length === 3) ?? held.find((i) => i !== T && !world.neighbours(T).map(Number).includes(i));
      // Enough hulls at the depot for the loads; the escorts come from wherever there are spares.
      const tholian = window.__P('tholian');
      for (const h of tholian.hulls.filter((x) => x.status === 'ready' && !x.opId).slice(0, 6)) h.systemIndex = T;
      const n0 = tholian.hulls.filter((h) => h.status !== 'lost').length;
      const pr = window.__authored((book, w, fx) => t.DoctrineCampaign.startProject(book, w, 'tholian', T, site, t.state.day, fx));
      if (!pr?.tender) return { error: 'no first tender', pr };
      window.__adv(2); // a day loading, a day's jump: on its way
      const lostAt = tholian.hulls.find((h) => h.id === pr.tender.hullId)?.systemIndex;
      window.__lose(pr.tender.id, 'destroyed', { silent: true });
      const m = pr.tender.milestones[0];
      window.__adv(Math.max(0, m.dueDay + m.grace + 1 - t.state.day));
      const db = window.__D();
      const inc = Object.values(db.incidents).find((i) => i.polity === 'tholian');
      const e0 = window.__eval('command:tholian', inc?.id);
      window.__adv(1);
      const e1 = window.__eval('command:tholian', inc?.id);
      const o = db.objectives.find((x) => x.incidentId === inc?.id && x.response === 'protect');
      const charge = o && { ...o.charge };
      const trail = [];
      for (let i = 0; i < 12 && o && o.status === 'active'; i++) {
        window.__adv(1);
        const eh = tholian.hulls.find((h) => h.id === o.assigned.hullId), ch = tholian.hulls.find((h) => h.id === charge.hullId);
        trail.push({ day: t.state.day, escort: eh?.systemIndex, charge: ch?.systemIndex, state: o.escortState });
      }
      window.__sh.push(...db.shadow.filter((x) => x.incident === inc?.id));
      const eh = o && tholian.hulls.find((h) => h.id === o.assigned.hullId);
      return { site, lostAt, depot: T, project: pr.contract.id, inc: inc && { id: inc.id, contractId: inc.contractId }, e0, e1, o: o && { id: o.id, template: o.template, charge: o.charge, status: o.status, resolution: o.resolution, hullId: o.assigned.hullId, escortShip: eh?.shipId, combat: world.shipStats(eh?.shipId)?.combat },
        chargeAtStart: charge, trail, n0, n1: tholian.hulls.filter((h) => h.status !== 'lost').length + 1, rv: db.reevaluations.filter((x) => x.actor === 'command:tholian'),
        escortHome: eh && (db.assignments.some((a) => a.hullId === eh.id && a.kind === 'return' && a.status === 'active') || world.systems[eh.systemIndex]?.controller === 'tholian'),
        reps: window.__reports().filter((x) => String(x.id || '').includes(':escort')).map((x) => ({ kind: x.kind, text: x.text })) };
    });
    evidence.push({ check: 'THOLIAN-ESCORT', ...r });
    assert.ok(!r.error, JSON.stringify(r));
    assert.notEqual(r.lostAt, r.depot, 'the tender was lost in port, not on its way');
    assert.equal(r.inc.contractId, r.project);
    assert.equal(r.e0.matchedRule, 'industrial_risk');
    assert.equal(r.e0.proposal, 'defer:protect', JSON.stringify(r.e0));
    assert.ok(r.o, JSON.stringify(r.e1));
    assert.equal(r.o.template, 'escort');
    assert.deepEqual(r.o.charge, r.chargeAtStart, 'the charge changed');
    assert.equal(r.o.status, 'completed', JSON.stringify({ res: r.o.resolution, trail: r.trail }));
    assert.deepEqual(r.o.resolution.reasons, ['charge_safe']);
    assert.ok(r.trail.filter((x) => x.state === 'escorting').every((x) => x.escort === x.charge), JSON.stringify(r.trail));
    assert.ok(r.o.combat >= 0.5, 'the escort is not an armed ship');
    assert.ok(r.trail.some((x) => x.state === 'escorting'), `the escort never joined its charge before it was safe: ${JSON.stringify(r.trail)}`);
    assert.equal(r.n1, r.n0, 'a protection fleet was spawned (hull count changed other than the lost tender)');
    assert.ok(r.rv.some((x) => x.from === 'defer:protect' && x.to === 'live:protect'), JSON.stringify(r.rv));
    assert.ok(r.escortHome, 'the escort neither went home nor stayed in Tholian space');
    await shotDoctrine('P2-escort-tholian.png', ['Active incidents', 'Doctrine objectives', 'Reevaluations', 'Contracts']);
  });

  // ---------------------------------------------------------------------------------------------
  await check('new-feature', 'PLAYER-REPORTS-P2 the captain hears a distress call, a relief vessel responding, a reroute and an escort only through a real source at that system; with no source nothing arrives; no report carries doctrine reasoning', async () => {
    const run = async (present) => { await fresh(`p2-reports-${present}`); return ev((present) => {
      const t = testBM1;
      window.__quiet();
      const R = window.__idx('Romulus'), V = window.__idx('Vulcan'), A = window.__idx('Aldnas');
      // A Romulan transport disabled at Aldnas (override), calling for help; the report reaches Vulcan.
      if (present) { t.markSystemVisited(A); t.state.currentPlanet = A; t.applySystemState(A); }
      const tr = window.__ready('romulan', R)[0];
      const asg = window.__assign({ polity: 'romulan', hullId: tr.id, kind: 'transport', doctrineRole: 'civilian', stops: [{ systemIndex: A, dwell: 3, milestone: 'arrival' }, { systemIndex: R, milestone: 'check_in' }] });
      window.__adv(1);
      window.__lose(asg.assignment.id, 'disabled');
      window.__adv(2);
      const dist = window.__inc((i) => i.eventType === 'distress')[0];
      if (dist) window.__relay(dist.id, 'command:romulan', 'command:vulcan', { include: 'survivor_report' });
      window.__adv(2);
      if (present) { t.markSystemVisited(V); t.state.currentPlanet = V; t.applySystemState(V); }
      window.__adv(4);
      const reps = window.__reports().filter((rep) => String(rep.id || '').startsWith('doctrine:'));
      return { dist: dist?.id, reps: reps.map((rep) => ({ id: rep.id, kind: rep.kind, text: rep.text, confidence: rep.confidence, claimedAttacker: rep.claimedAttacker ?? null })) };
    }, present); };
    const present = await run(true), absent = await run(false);
    evidence.push({ check: 'PLAYER-REPORTS-P2', present, absent });
    assert.ok(present.reps.some((x) => /^Distress call received — refugee transport$/.test(x.kind)), JSON.stringify(present.reps));
    assert.equal(absent.reps.length, 0, `reports reached a captain with no source: ${JSON.stringify(absent.reps)}`);
    for (const x of present.reps) {
      assert.doesNotMatch(`${x.kind} ${x.text}`, /doctrine|profile|interest|rule|shadow|defer|attribut|survivors_known|live:|reevaluat/i);
      assert.equal(x.claimedAttacker, null);
      assert.ok(`${x.kind} ${x.text}`.length < 240, `an explanatory paragraph: ${x.text}`);
    }
  });

  await check('new-feature', 'PENDING-SAVELOAD a report still travelling survives save and load with its ID, payload and state, and is delivered afterwards', async () => {
    await fresh('p2-pending');
    const r = await ev(() => {
      const t = testBM1;
      window.__quiet();
      const R = window.__idx('Romulus'), A = window.__idx('Aldnas');
      const h = window.__ready('romulan', R)[0];
      const p = window.__patrol('romulan', h.id, A);
      window.__adv(1);
      window.__lose(p.assignment.id, 'destroyed', { silent: true });
      const m = p.assignment.milestones.at(-1);
      window.__adv(m.dueDay + m.grace + 1 - t.state.day);
      const inc = window.__inc((i) => i.eventType === 'asset_overdue')[0];
      const msg = window.__relay(inc.id, 'command:romulan', 'command:ferengi', { include: 'overdue_notice', channel: 'network', kind: 'saveload' });
      const before = JSON.stringify(msg);
      t.saveGame(8); t.startWithFaction('klingon'); t.loadGame(8);
      const after = window.__D().messages.find((x) => x.id === msg.id);
      const same = JSON.stringify(after) === before;
      for (let i = 0; i < 6 && after.state === 'pending'; i++) window.__adv(1);
      return { same, state0: JSON.parse(before).state, state1: after.state, deliveredDay: after.deliveredDay, knows: Boolean(window.__know('command:ferengi', inc.id)) };
    });
    evidence.push({ check: 'PENDING-SAVELOAD', ...r });
    assert.equal(r.state0, 'pending'); assert.equal(r.same, true, 'the pending report changed across save/load');
    assert.equal(r.state1, 'delivered'); assert.equal(r.knows, true);
  });

  await check('preservation', 'SHOTS the phase 2 debug views and the phase 1 header fix', async () => {
    for (const f of ['P2-distress-overdue-only.png', 'P2-distress-rescue-live.png', 'P2-distress-closed.png', 'P2-report-reevaluation-before.png', 'P2-report-reevaluation-after.png', 'P2-escort-tholian.png'])
      assert.ok(fs.existsSync(path.join(out, f)) && fs.statSync(path.join(out, f)).size > 10000, `missing ${f}`);
  });

  shadow.push(...(await ev(() => window.__sh || [])));
  const cmp = shadow.map((x) => ({ day: x.day, actor: x.actor, incident: x.incident, profile: x.profile, role: x.role, existingAction: x.existing, doctrineProposal: x.proposal, matchedRule: x.matchedRule, live: x.live, objective: x.objective, reason: x.notActing || (x.live ? 'live pilot response' : null), knownFacts: x.knownFacts, capacity: x.capacity }));
  fs.writeFileSync(path.join(out, 'shadow-comparison-phase2.json'), JSON.stringify(cmp, null, 1));
  fs.writeFileSync(path.join(out, 'doctrine-phase2-evidence.json'), JSON.stringify({ results, evidence }, null, 1));
  const byCat = (c) => { const r = results.filter((x) => x.category === c); return `${r.filter((x) => x.ok).length}/${r.length}`; };
  console.log(`\ndoctrine runtime phase 2 in-game: ${results.filter((x) => x.ok).length}/${results.length} (baseline-defect ${byCat('baseline-defect')}, new-feature ${byCat('new-feature')}, preservation ${byCat('preservation')})`);
  if (probe.errors.length) console.log('page errors:', probe.errors.slice(0, 5));
  await probe.close();
  process.exit(results.every((x) => x.ok) && !probe.errors.length ? 0 : 1);
})();
