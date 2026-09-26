// Gate for Dominion formal-war integration, stacked on f6c684f.
// Rules: docs/playtest/DOMINION-FORMAL-WAR-RULES-261233ZSEP26.md (extends BILATERAL-WAR-PEACE-RULES).
//
// Dominion Central and the Blender Remnant receive no formal war from static hostility; they enter the
// bilateral system only by authored escalation, an independent declaration or an authored binding, and
// once in it their wars run on the ordinary machinery. Categories as in war-peace-gate.cjs:
//   baseline-defect  reproduces a wrong behaviour of f6c684f
//   new-feature      needs a state f6c684f does not have (declared Dominion wars, withdrawal, command bindings)
//   preservation     must hold on both
const assert = require('node:assert/strict');
const path = require('node:path');
const { startProbe } = require('./probe-harness.cjs');

(async () => {
  const probe = await startProbe({ pageOptions: { deviceScaleFactor: 2 } });
  const { ev, fresh, page } = probe;
  const out = process.env.BM1_TEST_OUTPUT || '/tmp';
  const results = [];
  async function check(category, name, fn) {
    try { await fn(); results.push({ category, name, ok: true }); console.log('PASS', `[${category}]`, name); }
    catch (err) { results.push({ category, name, ok: false, message: String(err?.message || err).split('\n').slice(0, 6).join(' ') }); console.log('FAIL', `[${category}]`, name, '\n      ', String(err?.message || err).split('\n').slice(0, 8).join(' ')); }
  }
  const shot = (name) => page.screenshot({ path: path.join(out, name) });

  await page.evaluate(() => {
    const t = testBM1;
    window.__advance = (days) => { for (let i = 0; i < days; i++) t.advanceFleetCalendar(1, t.Fleet.nextId(t.fleetBook(), 'journey')); };
    // Formal records involving Central or the Remnant, as the diplomacy book holds them.
    window.__arcRecords = () => Object.values(t.diplomacyBook().pairs).filter((r) => [r.a, r.b].some((x) => x === 'dominion' || x === 'dominion_remnant'))
      .map((r) => ({ key: [r.a, r.b].sort().join(':'), status: r.status, warId: r.warId || null, inheritedFrom: r.inheritedFrom || null, declaredBy: r.declaredBy || null, declaration: r.declaration || null })).sort((x, y) => x.key.localeCompare(y.key));
    window.__arcPairs = () => (t.campaignWarPairs ? t.campaignWarPairs() : []).filter((p) => [p.a, p.b].some((x) => x === 'dominion' || x === 'dominion_remnant'))
      .map((p) => `${[p.a, p.b].sort().join(':')}:${p.status}`).sort();
    window.__rel = (a, b) => t.buildCampaignWorld(true).relation(a, b);
    // The captain knows both ends of the wormhole (charted), so declarations and settlements can reach them.
    // A picket of the captain's off Dominica: the Dominion's own terminus, so its declarations are seen the
    // day they are made (a fleet source), and nobody is at war with the captain there.
    window.__contact = () => {
      for (const i of [46, 58]) t.markSystemVisited(i);
      const s = t.state;
      if ((s.playerFleet || []).some((f) => f.id === 'dw-picket')) return;
      const ship = Object.values(s.shipStatsById).find((x) => x && x.assetType === 'ship' && t.getShipPrice(x) > 0);
      s.playerFleet.push({ id: 'dw-picket', shipId: Number(ship.id), name: 'Picket', systemIndex: 58, assignment: 'defense', destroyed: false, vessel: { hull: 400, maxHull: 400, condition: 'operational' } });
    };
    // The authored opening, entered through the ordinary calendar by the debug override.
    window.__invade = () => { window.__contact(); t.applyDebugCommand('campaign phase staging'); t.applyDebugCommand('campaign phase invasion'); return t.campaign().dominion.phase; };
    window.__remnantHulls = () => JSON.stringify(t.campaign().polities.dominion_remnant.hulls.map((h) => [h.id, h.status, h.systemIndex, h.hull]));
  });

  // 1 & 9 -----------------------------------------------------------------------------------------
  await check('baseline-defect', 'PRE-INVASION the Dominion is hostile before the invasion, but no formal war exists: the campaign reads peace, not war', async () => {
    await fresh('dw-pre');
    const r = await ev(() => {
      const t = testBM1;
      window.__contact();
      window.__advance(5);
      return { phase: t.campaign().dominion.phase, local: t.worldRelation('dominion', 'bajoran').status, opposed: t.areFactionsOpposed('dominion', 'terran'),
        campaign: { bajoran: window.__rel('dominion', 'bajoran'), terran: window.__rel('dominion', 'terran'), klingon: window.__rel('dominion', 'klingon'), empire: window.__rel('dominion', 'player') },
        records: window.__arcRecords(), pairs: window.__arcPairs() };
    });
    assert.equal(r.phase, 'dormant', 'precondition: the expedition is not open');
    assert.equal(r.local, 'war', 'local hostility was lost');
    assert.equal(r.opposed, true, 'local attitude was lost');
    assert.deepEqual(r.campaign, { bajoran: 'peace', terran: 'peace', klingon: 'peace', empire: 'peace' }, `static hostility is a strategic war: ${JSON.stringify(r.campaign)}`);
    assert.deepEqual(r.records, []); assert.deepEqual(r.pairs, []);
    await ev(() => { testBM1.openCampaignPanel('wars'); document.querySelector('[data-war-hostile]')?.scrollIntoView({ block: 'start' }); });
    await shot('dw-pre-invasion-no-war.png');
    await ev(() => testBM1.closeCampaignPanel());
  });

  await check('baseline-defect', 'STATIC-NEVER static Dominion and Remnant hostility by itself never creates a formal war, over time, through the incident roll or the evaluator', async () => {
    await fresh('dw-static');
    const r = await ev(() => {
      const t = testBM1;
      window.__advance(120);
      const w = t.buildCampaignWorld(true);
      const hostileOf = (id) => ['terran', 'klingon', 'romulan', 'vulcan', 'bajoran', 'andorian', 'ferengi', 'hirogen'].filter((x) => t.areFactionsOpposed(id, x));
      const strategic = (id) => hostileOf(id).filter((x) => w.relation(id, x) === 'war');
      return { phase: t.campaign().dominion.phase, records: window.__arcRecords(), pairs: window.__arcPairs(), warStates: Object.keys(t.campaign().warStates || {}).filter((k) => /dominion/.test(k)),
        strategic: { dominion: strategic('dominion'), remnant: strategic('dominion_remnant') }, hostile: { dominion: hostileOf('dominion').length, remnant: hostileOf('dominion_remnant').length } };
    });
    assert.ok(r.hostile.dominion > 3 && r.hostile.remnant >= 1, 'precondition: static hostility exists');
    assert.deepEqual(r.strategic, { dominion: [], remnant: [] }, `static hostility read as war: ${JSON.stringify(r.strategic)}`);
    assert.deepEqual(r.records, []); assert.deepEqual(r.pairs, []); assert.deepEqual(r.warStates, []);
  });

  // 2 ---------------------------------------------------------------------------------------------
  await check('new-feature', 'INVASION-DECLARES the authored staging → invasion transition creates exactly the plan\'s formal war, on the day the invasion launches, under one war id', async () => {
    await fresh('dw-invade');
    const r = await ev(() => {
      const t = testBM1, book = t.campaign();
      const phase = window.__invade();
      const d = book.dominion;
      const op = book.operations.find((o) => o.id === d.expeditionOpId);
      const st = book.warStates['bajoran:dominion'];
      const rec = t.diplomacyBook().pairs['bajoran:dominion'];
      return { phase, plan: d.plan, op: op && { kind: op.kind, target: op.targetSystem, day: op.createdDay, defender: op.defender }, st: st && { warId: st.warId, started: st.startedDay, declared: st.declared },
        rec: rec && { status: rec.status, warId: rec.warId, warStarted: rec.warStarted, declaredBy: rec.declaredBy }, records: window.__arcRecords().map((x) => x.key), campaign: window.__rel('dominion', 'bajoran') };
    });
    assert.equal(r.phase, 'invasion');
    assert.deepEqual(r.plan.warTargets, ['bajoran'], `the plan declared against ${r.plan.warTargets}`);
    assert.equal(r.plan.holder, 'bajoran'); assert.match(r.plan.reason, /forcing/);
    assert.deepEqual(r.records, ['bajoran:dominion'], `formal records beyond the plan: ${r.records}`);
    assert.equal(r.op.kind, 'invasion'); assert.equal(r.op.target, 46); assert.equal(r.op.defender, 'bajoran');
    assert.equal(r.rec.status, 'war'); assert.equal(r.rec.warId, r.st.warId, 'the diplomacy record and the war instance are different wars');
    assert.equal(r.rec.warStarted, r.op.day, 'the war was not declared on the day the invasion launched');
    assert.equal(r.st.declared.source, 'authored'); assert.equal(r.campaign, 'war');
  });

  // Treaty state: pacts are authored records, never alignment (DOMINION-FORMAL-WAR-RULES §2a) -------
  await page.evaluate(() => {
    const t = testBM1;
    // The storyline without its authored agreement, so each check decides the pact itself.
    window.__noAuthoredPacts = () => { t.campaign().config.dominionAuthoredPacts = []; };
    window.__pactView = () => {
      const book = t.campaign(), w = t.buildCampaignWorld(true), d = book.dominion;
      const exp = t.Campaign.expeditionAssessment(book, w, 'dominion');
      return { phase: d.phase, plan: d.plan ? { partnerCorridor: d.plan.partnerCorridor, pacts: d.plan.pacts, warTargets: d.plan.warTargets } : null,
        active: t.Campaign.activePacts ? t.Campaign.activePacts(book, 'dominion') : (d.plan?.pacts || []), partners: exp?.partners || [], bridgeheads: exp?.bridgeheads ?? null, access: exp?.access ?? null,
        records: window.__arcRecords().map((x) => x.key), ops46: book.operations.filter((o) => o.faction === 'dominion' && o.targetSystem === 46 && o.status !== 'resolved').length,
        atEntry: book.polities.dominion.hulls.filter((h) => h.status === 'ready' && Number(h.systemIndex) === 46).length,
        rel: { cardassian: w.relation('dominion', 'cardassian'), breen: w.relation('dominion', 'breen') }, local: { cardassian: t.worldRelation('dominion', 'cardassian').status, breen: t.worldRelation('dominion', 'breen').status } };
    };
  });

  await check('baseline-defect', 'PACT-INACTIVE Cardassia statically aligned with the Dominion but with no pact: no partner-corridor privilege and no expedition support', async () => {
    await fresh('dw-pact-off');
    const r = await ev(() => {
      const t = testBM1;
      window.__noAuthoredPacts();
      t.transferSystemControlToFaction(46, 'cardassian');
      window.__invade();
      return window.__pactView();
    });
    assert.equal(r.rel.cardassian, 'allied', 'precondition: Cardassia is not statically aligned with the Dominion');
    assert.notEqual(r.plan?.partnerCorridor, true, `alignment alone opened a partner corridor (plan.pacts ${JSON.stringify(r.plan?.pacts)})`);
    assert.equal(r.phase, 'staging', `the expedition crossed a Cardassian corridor without a pact (${r.phase})`);
    assert.equal(r.atEntry, 0);
    assert.deepEqual(r.partners, [], 'alignment alone counted as partner support');
    assert.deepEqual(r.active, []);
  });

  await check('new-feature', 'PACT-ACTIVE an authored Cardassian pact lets the expedition cross partner-held Bajora unopposed, with nobody declared against, and Cardassian support counts', async () => {
    await fresh('dw-pact-on');
    const r = await ev(() => {
      const t = testBM1;
      window.__noAuthoredPacts();
      const act = t.activateDominionPact('cardassian', 'a secret agreement');
      t.transferSystemControlToFaction(46, 'cardassian');
      window.__invade();
      return { act: act.ok, view: window.__pactView(), record: t.Campaign.pactRecord(t.campaign(), 'dominion', 'cardassian') };
    });
    assert.ok(r.act);
    assert.equal(r.record.status, 'active'); assert.equal(r.record.secret, true);
    assert.equal(r.view.phase, 'invasion');
    assert.equal(r.view.plan.partnerCorridor, true); assert.deepEqual(r.view.plan.pacts, ['cardassian']); assert.deepEqual(r.view.plan.warTargets, []);
    assert.deepEqual(r.view.records, [], `a war was declared for a partner-held corridor: ${r.view.records}`);
    assert.equal(r.view.ops46, 0, 'the expedition assaulted its partner\'s world');
    assert.ok(r.view.atEntry > 0, 'the expedition did not come through');
    assert.deepEqual(r.view.partners, ['cardassian'], 'the active pact does not count as support');
    assert.equal(r.view.bridgeheads, 1, 'the partner-held terminus is not the expedition\'s ground');
  });

  await check('new-feature', 'PACT-COLLAPSE ending the pact removes the corridor and support at once, and leaves the ordinary relation exactly as it was: no hostility, no war', async () => {
    await fresh('dw-pact-collapse');
    const r = await ev(() => {
      const t = testBM1;
      window.__noAuthoredPacts();
      t.activateDominionPact('cardassian');
      t.transferSystemControlToFaction(46, 'cardassian');
      window.__invade();
      const before = window.__pactView();
      const end = t.endDominionPact('cardassian', 'the agreement collapses');
      const after = window.__pactView();
      window.__advance(3);
      return { before, end: end.ok, after, later: window.__pactView(), record: t.Campaign.pactRecord(t.campaign(), 'dominion', 'cardassian') };
    });
    assert.deepEqual(r.before.partners, ['cardassian']); assert.equal(r.before.bridgeheads, 1);
    assert.ok(r.end);
    assert.equal(r.record.status, 'collapsed'); assert.ok(r.record.endedDay != null);
    assert.deepEqual(r.after.active, []); assert.deepEqual(r.after.partners, [], 'support survived the collapse');
    assert.equal(r.after.bridgeheads, 0, 'the corridor privilege survived the collapse');
    assert.deepEqual(r.after.rel, r.before.rel, 'the collapse changed the ordinary relation');
    assert.deepEqual(r.after.local, r.before.local);
    assert.deepEqual(r.later.records, [], `the collapse created a war: ${r.later.records}`);
    assert.equal(r.later.rel.cardassian, 'allied');
  });

  await check('new-feature', 'PACT-BREEN the Breen behave the same way: no pact, no privilege; an authored pact grants the corridor and support; collapse removes them without war', async () => {
    await fresh('dw-pact-breen');
    const r = await ev(() => {
      const t = testBM1;
      window.__noAuthoredPacts();
      t.transferSystemControlToFaction(46, 'breen');
      window.__invade();
      const off = window.__pactView();
      t.activateDominionPact('breen', 'a secret agreement');
      t.applyDebugCommand('campaign phase invasion');
      const on = window.__pactView();
      t.endDominionPact('breen', 'the agreement collapses');
      window.__advance(2);
      const ended = window.__pactView();
      return { off, on, ended };
    });
    assert.equal(r.off.phase, 'staging'); assert.deepEqual(r.off.partners, []); assert.equal(r.off.atEntry, 0);
    assert.equal(r.on.phase, 'invasion'); assert.equal(r.on.plan.partnerCorridor, true); assert.deepEqual(r.on.plan.pacts, ['breen']);
    assert.deepEqual(r.on.partners, ['breen']); assert.deepEqual(r.on.records, []);
    assert.deepEqual(r.ended.partners, []); assert.equal(r.ended.bridgeheads, 0);
    assert.equal(r.ended.rel.breen, r.off.rel.breen, 'the Breen collapse changed the ordinary relation');
    assert.deepEqual(r.ended.records, [], `the Breen collapse created a war: ${r.ended.records}`);
  });

  await check('new-feature', 'PACT-SAVELOAD active and collapsed pact state survive save/load exactly', async () => {
    await fresh('dw-pact-save');
    const r = await ev(() => {
      const t = testBM1;
      window.__noAuthoredPacts();
      t.activateDominionPact('cardassian');
      t.activateDominionPact('breen'); t.endDominionPact('breen', 'collapsed');
      const read = () => JSON.stringify({ treaties: t.campaign().treaties, active: t.Campaign.activePacts(t.campaign(), 'dominion') });
      const before = read();
      t.saveGame(6); t.startWithFaction('ferengi'); t.loadGame(6);
      return { before, after: read() };
    });
    assert.equal(r.after, r.before);
    const b = JSON.parse(r.before);
    assert.deepEqual(b.active, ['cardassian']);
    assert.equal(b.treaties['pact:breen:dominion'].status, 'collapsed');
  });

  await check('new-feature', 'PACT-REMNANT the autonomous Remnant neither learns nor inherits Central\'s pact, and a later subordination does not hand it one either', async () => {
    await fresh('dw-pact-remnant');
    const r = await ev(() => {
      const t = testBM1, book = t.campaign();
      window.__noAuthoredPacts();
      const relBefore = window.__rel('dominion_remnant', 'cardassian');
      t.activateDominionPact('cardassian');
      const news = () => { const n = t.galaxyNewsBook(); return [...n.items, ...n.pending].filter((x) => /pact|agreement/i.test(`${x.kind} ${x.text}`)).map((x) => x.text); };
      const autonomous = { pacts: t.Campaign.activePacts(book, 'dominion_remnant'), rel: window.__rel('dominion_remnant', 'cardassian'), treaties: Object.keys(book.treaties || {}).filter((k) => k.includes('dominion_remnant')), news: news(), knownTo: t.Campaign.pactRecord(book, 'dominion', 'cardassian').knownTo };
      window.__invade();
      t.subordinateRemnant();
      const bound = { pacts: t.Campaign.activePacts(book, 'dominion_remnant'), treaties: Object.keys(book.treaties || {}).filter((k) => k.includes('dominion_remnant')) };
      return { relBefore, autonomous, bound };
    });
    assert.deepEqual(r.autonomous.pacts, []); assert.deepEqual(r.autonomous.treaties, []);
    assert.equal(r.autonomous.rel, r.relBefore, 'the pact changed the Remnant\'s relation to Cardassia');
    assert.deepEqual(r.autonomous.news, [], `the secret pact was published: ${r.autonomous.news}`);
    assert.deepEqual(r.autonomous.knownTo, []);
    assert.deepEqual(r.bound.pacts, [], 'subordination handed the Remnant Central\'s pact');
    assert.deepEqual(r.bound.treaties, []);
  });

  // Secrecy: an unrevealed pact is unavailable to every player-facing view ----------------------------
  await page.evaluate(() => {
    const t = testBM1;
    // Everything the captain can read: every Empire & campaign tab, every report folder, the chart's rails.
    window.__playerUI = () => {
      const parts = [];
      t.openCampaignPanel('empire');
      for (const b of [...document.querySelectorAll('#campaign-panel [data-campaign-tab]')].map((x) => x.dataset.campaignTab)) {
        t.openCampaignPanel(b);
        parts.push(`[tab ${b}] ${document.getElementById('campaign-panel').innerHTML}`);
      }
      t.closeCampaignPanel();
      t.openGalaxyReports();
      for (const f of [...document.querySelectorAll('[data-report-folder]')].map((x) => x.dataset.reportFolder)) {
        document.querySelector(`[data-report-folder="${f}"]`)?.click();
        parts.push(`[reports ${f}] ${document.getElementById('galaxy-reports')?.innerHTML || ''}`);
      }
      t.closeGalaxyReports();
      t.openMap(); t.drawInterstellarMapOverlay();
      parts.push(`[map] ${[...document.querySelectorAll('.map-rail')].map((e) => e.innerHTML).join('')}`);
      t.closeMap?.();
      return parts;
    };
    window.__leaks = (parts) => parts.filter((p) => /\bpacts?\b|agreement/i.test(p)).map((p) => p.slice(0, 40));
    window.__diffParts = (a, b) => a.map((x, i) => (x === b[i] ? null : x.slice(0, 30))).filter(Boolean);
    window.__secretHistory = () => t.campaign().history.filter((h) => h.kind === 'treaty').map((h) => h.text);
  });

  await check('baseline-defect', 'PACT-SECRET-HISTORY an unrevealed secret pact is unavailable to every player-facing view: Campaign Log, every report folder, the chart — no row, count or text changes when it is concluded; the book keeps it', async () => {
    await fresh('dw-secret');
    const r = await ev(() => {
      const t = testBM1;
      window.__noAuthoredPacts();
      const before = window.__playerUI(), again = window.__playerUI();
      t.activateDominionPact('cardassian', 'a secret agreement');
      const after = window.__playerUI();
      const rec = t.Campaign.pactRecord(t.campaign(), 'dominion', 'cardassian');
      return { stable: window.__diffParts(before, again), changed: window.__diffParts(before, after), leaks: window.__leaks(after), record: rec && { status: rec.status, secret: rec.secret, knownTo: rec.knownTo }, history: window.__secretHistory() };
    });
    assert.deepEqual(r.stable, [], `precondition: the views are not stable on their own: ${r.changed}`);
    assert.deepEqual(r.leaks, [], `a player-facing view mentions the pact: ${r.leaks}`);
    assert.deepEqual(r.changed, [], `concluding the secret pact changed a player-facing view: ${r.changed}`);
    assert.deepEqual(r.record, { status: 'active', secret: true, knownTo: [] });
    assert.equal(r.history.length, 1, 'the campaign history no longer keeps the pact');
  });

  await check('baseline-defect', 'PACT-SECRET-COLLAPSE ending an unrevealed pact is just as invisible; the book keeps both events, and save/load reveals nothing', async () => {
    await fresh('dw-secret-end');
    const r = await ev(() => {
      const t = testBM1;
      window.__noAuthoredPacts();
      const before = window.__playerUI();
      t.activateDominionPact('cardassian', 'a secret agreement');
      t.endDominionPact('cardassian', 'the agreement collapses');
      const after = window.__playerUI();
      t.saveGame(2); t.startWithFaction('ferengi'); t.loadGame(2);
      const loaded = window.__playerUI();
      const rec = t.Campaign.pactRecord(t.campaign(), 'dominion', 'cardassian');
      return { changed: window.__diffParts(before, after), leaks: [...window.__leaks(after), ...window.__leaks(loaded)], loadedChanged: window.__diffParts(before, loaded), record: rec && { status: rec.status, knownTo: rec.knownTo }, history: window.__secretHistory(), remnant: t.Campaign.activePacts(t.campaign(), 'dominion_remnant') };
    });
    assert.deepEqual(r.leaks, [], `a player-facing view mentions the pact: ${r.leaks}`);
    assert.deepEqual(r.changed, [], `the secret pact changed a player-facing view: ${r.changed}`);
    assert.deepEqual(r.loadedChanged, [], `save/load revealed it: ${r.loadedChanged}`);
    assert.deepEqual(r.record, { status: 'collapsed', knownTo: [] });
    assert.equal(r.history.length, 2, `the book lost an event: ${r.history}`);
    assert.deepEqual(r.remnant, []);
  });

  // 3 & 6 -----------------------------------------------------------------------------------------
  await check('new-feature', 'WARS-UI the formal Dominion war appears in Wars & Treaties once its declaration reaches the captain, with the Remnant shown as outside it', async () => {
    await fresh('dw-ui');
    const r = await ev(() => {
      const t = testBM1;
      window.__invade();
      const reports = t.galaxyNewsBook();
      const declared = [...reports.items, ...reports.pending].filter((x) => String(x.id).startsWith('diplomacy:declared:bajoran:dominion'));
      t.openCampaignPanel('wars');
      const row = document.querySelector('[data-war-other="bajoran:dominion"]');
      return { declared: declared.map((x) => ({ kind: x.kind, text: x.text, category: x.category })), row: row?.textContent || null, note: row?.querySelector('[data-remnant-note]')?.textContent || null };
    });
    assert.equal(r.declared.length, 1, `declaration reports: ${JSON.stringify(r.declared)}`);
    assert.equal(r.declared[0].category, 'diplomacy'); assert.match(r.declared[0].text, /Dominion declared war on Bajoran/);
    assert.ok(r.row, 'the Dominion war is not in Wars & Treaties');
    assert.match(r.row, /declared by Dominion/);
    assert.match(r.note || '', /autonomous — not a party/);
    await ev(() => document.querySelector('[data-war-others]')?.scrollIntoView({ block: 'start' }));
    await shot('dw-invasion-formal-war.png');
    await ev(() => testBM1.closeCampaignPanel());
    await ev(() => { testBM1.openGalaxyReports(); document.querySelector('[data-report-folder="diplomacy"]')?.click(); });
    await shot('dw-declaration-report.png');
    await ev(() => testBM1.closeGalaxyReports());
  });

  await check('baseline-defect', 'REMNANT-AUTONOMOUS the autonomous Remnant stays outside Central\'s war: no record, no alliance with Central, no defence of Central\'s worlds, no war from its own hostility', async () => {
    await fresh('dw-remnant');
    const r = await ev(() => {
      const t = testBM1, book = t.campaign();
      window.__invade();
      window.__advance(8);
      const w = t.buildCampaignWorld(true);
      const bajora = 46;
      return { bajora: w.systems[bajora].controller, records: window.__arcRecords().filter((x) => x.key.includes('dominion_remnant')),
        central: w.relation('dominion_remnant', 'dominion'), bajoran: w.relation('dominion_remnant', 'bajoran'), terran: w.relation('dominion_remnant', 'terran'), romulan: w.relation('dominion_remnant', 'romulan'),
        defends: t.Campaign.defendingPolityIds(book, w, bajora, 'bajoran'), remnantOps: book.operations.filter((o) => o.faction === 'dominion_remnant').length };
    });
    assert.deepEqual(r.records, [], `the Remnant acquired records: ${JSON.stringify(r.records)}`);
    assert.equal(r.bajoran, 'peace', 'the Remnant is in Central\'s war');
    assert.equal(r.central, 'peace', 'the autonomous Remnant is allied to Central');
    assert.deepEqual([r.terran, r.romulan], ['peace', 'peace'], 'the Remnant\'s raiding hostility became a war');
    assert.ok(!r.defends.includes('dominion_remnant'), `the Remnant defends Central's world: ${r.defends}`);
    assert.equal(r.remnantOps, 0);
  });

  // 4 ---------------------------------------------------------------------------------------------
  await check('new-feature', 'DOMINION-CEASEFIRE the normal evaluator acts on a formal Dominion war: a costly, stalled war becomes a ceasefire, operations stand down, and the expedition is judged on its own capacity', async () => {
    await fresh('dw-cease');
    const r = await ev(() => {
      const t = testBM1, s = t.state, book = t.campaign();
      window.__invade();
      // A stall at the corridor (the fixture authors the war's cost, as the bilateral gate does): the
      // invasion is thrown back before it takes Bajora, both sides have paid, and nothing has moved.
      const op = book.operations.find((o) => o.id === book.dominion.expeditionOpId);
      op.status = 'resolved'; op.outcome = 'withdrew'; op.resolvedDay = s.day;
      for (const h of t.Campaign.operationHulls(book, op)) { h.opId = null; h.status = 'ready'; h.systemIndex = book.dominion.stagingSystem; }
      book.config.warRules = { stalemateMaxRatio: 1e9 };
      const w = t.Campaign.warRecord(book, 'bajoran', 'dominion'); w.engagements = 30; w.losses.bajoran = 6; w.losses.dominion = 5; w.front = [];
      const st = book.warStates['bajoran:dominion']; st.startedDay = s.day - 150; st.statusSince = st.startedDay;
      // A second Dominion operation bound for Bajora, to be stood down by the ceasefire.
      const hulls = book.polities.dominion.hulls.filter((h) => h.status === 'ready' && h.systemIndex === book.dominion.stagingSystem).slice(0, 3);
      const op2 = t.Campaign.launchOperation(book, t.buildCampaignWorld(true), 'dominion', hulls, 46, s.day, 4, 'assault', []);
      window.__advance(1);
      const after = book.warStates['bajoran:dominion'];
      return { status: t.formalRecord('bajoran', 'dominion').status, st: { status: after.status, basis: after.lastEval?.basis, sides: after.lastEval?.sides }, op2: book.operations.find((o) => o.id === op2.id)?.outcome,
        exp: t.Campaign.expeditionAssessment(book, t.buildCampaignWorld(true), 'dominion'), home: window.__rel('dominion', 'bajoran') };
    });
    assert.equal(r.status, 'ceasefire', `no ceasefire: ${JSON.stringify(r.st)}`);
    assert.ok(['stalemate', 'exhaustion'].includes(r.st.basis), `basis ${r.st.basis}`);
    assert.equal(r.op2, 'stood-down', 'the Dominion operation outlived the ceasefire');
    assert.ok(r.st.sides.dominion.strength <= r.exp.capacity + 1, 'the Dominion side was not judged on its expedition');
    await ev(() => { testBM1.openCampaignPanel('wars'); document.querySelector('[data-war-others]')?.scrollIntoView({ block: 'start' }); });
    await shot('dw-dominion-ceasefire.png');
    await ev(() => testBM1.closeCampaignPanel());
  });

  // 10 & 11 ---------------------------------------------------------------------------------------
  await check('new-feature', 'ESCALATION-DECLARES a deliberate Dominion attack on a new power creates that power\'s formal war on the day of the attack, before it launches', async () => {
    await fresh('dw-escalate');
    const r = await ev(() => {
      const t = testBM1, book = t.campaign();
      window.__invade();
      let op = null;
      for (let i = 0; i < 80 && !op; i++) { window.__advance(1); op = book.operations.find((o) => o.faction === 'dominion' && o.declares); }
      if (!op) return { fail: 'no escalation in 80 days' };
      const st = book.warStates[op.declares];
      const rec = t.diplomacyBook().pairs[op.declares];
      return { fail: null, op: { day: op.createdDay, defender: op.defender, declares: op.declares }, st: { warId: st.warId, started: st.startedDay, source: st.declared.source, opId: st.declared.opId }, rec: rec && { warId: rec.warId, warStarted: rec.warStarted }, opId: op.id };
    });
    assert.ok(!r.fail, r.fail);
    assert.ok(r.op.declares.split(':').includes(r.op.defender), 'the escalation declared on somebody other than the power it attacked');
    assert.equal(r.st.started, r.op.day); assert.equal(r.rec.warStarted, r.op.day); assert.equal(r.rec.warId, r.st.warId);
    assert.equal(r.st.source, 'escalation'); assert.equal(r.st.opId, r.opId);
  });

  await check('baseline-defect', 'NO-UNDECLARED-ATTACK the Dominion never mounts an ordinary strategic attack on a power it is not formally at war with: every operation is declared, and a forced one stands down', async () => {
    await fresh('dw-undeclared');
    const r = await ev(() => {
      const t = testBM1, s = t.state, book = t.campaign();
      const inv = window.__invade();
      window.__advance(60);
      const war = (a, b, day) => { const k = [a, b].sort().join(':'); const st = book.warStates[k]; return Boolean(st && st.startedDay <= day); };
      const undeclared = book.operations.filter((o) => o.faction === 'dominion' && o.defender && o.defender !== 'dominion' && !war('dominion', o.defender, o.createdDay)).map((o) => `${o.createdDay}:${o.targetSystem}:${o.defender}`);
      // A Dominion operation forced against the Terran government, which it is not at war with.
      const earthSide = t.buildCampaignWorld(true).systems.find((x) => x.controller === 'terran' && x.name !== 'Earth');
      const hulls = book.polities.dominion.hulls.filter((h) => h.status === 'ready' && !h.opId).slice(0, 3);
      const forced = t.Campaign.launchOperation(book, t.buildCampaignWorld(true), 'dominion', hulls, earthSide.index, s.day, 5, 'assault', []);
      window.__advance(1);
      const f = book.operations.find((o) => o.id === forced.id);
      return { inv, undeclared, forced: f && { status: f.status, outcome: f.outcome }, terran: window.__rel('dominion', 'terran') };
    });
    assert.deepEqual(r.undeclared, [], `undeclared Dominion attacks: ${r.undeclared}`);
    assert.equal(r.terran, 'peace', 'precondition: no Dominion–Terran war was declared');
    assert.deepEqual(r.forced, { status: 'resolved', outcome: 'stood-down' }, `an attack on a power the Dominion is not at war with went ahead: ${JSON.stringify(r.forced)}`);
  });

  // 5, 14 & 15 ------------------------------------------------------------------------------------
  await check('new-feature', 'WITHDRAWAL-SETTLEMENT an authored withdrawal ends Central\'s wars through the ordinary transition: a normal peace record (basis withdrawal), abandoned worlds returned, operations stood down, phase withdrawn', async () => {
    await fresh('dw-withdraw');
    const r = await ev(() => {
      const t = testBM1, s = t.state, book = t.campaign();
      window.__invade();
      window.__advance(4);
      // Central holds a Bajoran world it took in the opening; make it an open war with ground at stake:
      // the Bajorans still hold another world (a fixture), so the war is not already decided.
      const w0 = t.buildCampaignWorld(true);
      const spare = w0.systems.find((x) => x.controller === 'cardassian' && x.name !== 'Cardassia');
      t.transferSystemControlToFaction(spare.index, 'bajoran');
      if (t.buildCampaignWorld(true).systems[46].controller !== 'dominion') { t.transferSystemControlToFaction(46, 'dominion'); }
      if (!book.occupations[46]) t.Campaign.recordCapture(book, t.buildCampaignWorld(true), 46, 'dominion', 'bajoran', s.day);
      if (t.formalRecord('bajoran', 'dominion').status !== 'war') return { fail: `precondition: the Bajoran war is ${t.formalRecord('bajoran', 'dominion').status}` };
      const hullsBefore = book.polities.dominion.hulls.filter((h) => h.status !== 'lost').length;
      const w = t.withdrawDominionExpedition('Central orders the expedition home');
      window.__advance(1);
      const st = book.warStates['bajoran:dominion'];
      const live = book.operations.filter((o) => o.faction === 'dominion' && o.status !== 'resolved').length;
      return { fail: null, w, st: { status: st.status, settlement: st.settlement }, rec: t.formalRecord('bajoran', 'dominion').status, bajora: t.getSystemControl(46).controller, terr: book.territory[46],
        phase: book.dominion.phase, live, hullsBefore, hullsAfter: book.polities.dominion.hulls.filter((h) => h.status !== 'lost').length,
        nearHulls: book.polities.dominion.hulls.filter((h) => h.status === 'ready' && t.Campaign.nearSideSystems(t.buildCampaignWorld(true), 46).has(Number(h.systemIndex))).length };
    });
    assert.ok(!r.fail, r.fail);
    assert.equal(r.st.status, 'peace'); assert.equal(r.rec, 'peace');
    assert.equal(r.st.settlement.basis, 'withdrawal'); assert.equal(r.st.settlement.loser, 'dominion'); assert.equal(r.st.settlement.source, 'authored');
    assert.ok(r.st.settlement.terms.some((x) => x.systemIndex === 46 && x.status === 'returned'), `Bajora was not abandoned: ${JSON.stringify(r.st.settlement.terms)}`);
    assert.equal(r.bajora, 'bajoran', 'the abandoned world did not return to its claimant');
    assert.equal(r.terr.status, 'returned'); assert.equal(r.terr.evacuate, true, 'no evacuation hook on the abandoned world');
    assert.equal(r.phase, 'withdrawn'); assert.equal(r.live, 0, 'Dominion operations survived the withdrawal');
    assert.equal(r.hullsAfter, r.hullsBefore, 'the withdrawal deleted Dominion hulls');
    assert.equal(r.nearHulls, 0, 'hulls stayed on the near side');
    await ev(() => { testBM1.openGalaxyReports(); document.querySelector('[data-report-folder="diplomacy"]')?.click(); });
    await shot('dw-withdrawal-settlement.png');
    await ev(() => testBM1.closeGalaxyReports());
  });

  await check('new-feature', 'UNSUSTAINABLE-WITHDRAWS an expedition worn down with the wormhole closed and no way to replace losses withdraws of its own accord; the home realm is untouched', async () => {
    await fresh('dw-unsustainable');
    const r = await ev(() => {
      const t = testBM1, s = t.state, book = t.campaign();
      window.__invade();
      const d = book.dominion;
      const home = t.buildCampaignWorld(true).systems.filter((x) => x.controller === 'dominion').map((x) => x.index);
      // The invasion is thrown back and Bajora fortified against it: convoys interdicted, none left.
      const op = book.operations.find((o) => o.id === d.expeditionOpId);
      op.status = 'resolved'; op.outcome = 'destroyed'; op.resolvedDay = s.day;
      const near = t.Campaign.nearSideSystems(t.buildCampaignWorld(true), 46);
      const exp = book.polities.dominion.hulls.filter((h) => h.status !== 'lost' && (near.has(Number(h.systemIndex)) || Number(h.systemIndex) === d.stagingSystem));
      for (const h of exp.slice(Math.max(1, Math.round(exp.length * 0.25)))) { h.status = 'lost'; h.hull = 0; h.opId = null; }
      for (const h of exp.slice(0, Math.max(1, Math.round(exp.length * 0.25)))) { h.opId = null; h.status = 'ready'; h.systemIndex = d.stagingSystem; }
      d.convoys = book.config.dominionMaxConvoys; d.reinforcementCut = true;
      const before = t.campaign().dominion.phase;
      window.__advance(2);
      const st = book.warStates['bajoran:dominion'];
      return { before, phase: d.phase, withdrawal: d.withdrawal, st: st && { status: st.status, basis: st.settlement?.basis, reason: st.settlement?.reason },
        homeAfter: t.buildCampaignWorld(true).systems.filter((x) => home.includes(x.index)).every((x) => x.controller === 'dominion') };
    });
    assert.equal(r.before, 'invasion');
    assert.equal(r.phase, 'withdrawn', `the expedition did not withdraw: ${JSON.stringify(r.withdrawal)}`);
    assert.match(r.withdrawal.reason, /can no longer sustain/);
    assert.equal(r.st.status, 'peace'); assert.equal(r.st.basis, 'withdrawal');
    assert.equal(r.homeAfter, true, 'the Dominion home realm changed hands');
  });

  await check('new-feature', 'WITHDRAW-NO-DELETE withdraw_expedition deletes no unrelated Dominion asset and does not touch the autonomous Remnant', async () => {
    await fresh('dw-nodelete');
    const r = await ev(() => {
      const t = testBM1, book = t.campaign();
      window.__invade();
      window.__advance(3);
      const gamma = (w) => w.systems.filter((x) => x.controller === 'dominion' && !t.Campaign.nearSideSystems(w, 46).has(Number(x.index))).map((x) => x.index).sort();
      const stations = () => JSON.stringify((t.state.stationDefinitions || []).filter((d) => t.getStationOwner(d, d.systemIndex) === 'dominion').map((d) => d.id).sort());
      const before = { hulls: book.polities.dominion.hulls.filter((h) => h.status !== 'lost').map((h) => h.id).sort(), gamma: gamma(t.buildCampaignWorld(true)), stations: stations(), remnant: window.__remnantHulls(), remnantRecords: window.__arcRecords().filter((x) => x.key.includes('dominion_remnant')), treasury: book.polities.dominion_remnant.treasury };
      t.withdrawDominionExpedition('Central orders the expedition home');
      const after = { hulls: book.polities.dominion.hulls.filter((h) => h.status !== 'lost').map((h) => h.id).sort(), gamma: gamma(t.buildCampaignWorld(true)), stations: stations(), remnant: window.__remnantHulls(), remnantRecords: window.__arcRecords().filter((x) => x.key.includes('dominion_remnant')), treasury: book.polities.dominion_remnant.treasury };
      return { before, after, binding: book.commandBindings?.dominion_remnant || null };
    });
    assert.deepEqual(r.after.hulls, r.before.hulls, 'Dominion hulls were deleted');
    assert.deepEqual(r.after.gamma, r.before.gamma, 'the Gamma Quadrant realm changed');
    assert.equal(r.after.stations, r.before.stations, 'Dominion installations were deleted or changed owner');
    assert.equal(r.after.remnant, r.before.remnant, 'the autonomous Remnant\'s hulls were touched');
    assert.deepEqual(r.after.remnantRecords, []); assert.equal(r.after.treasury, r.before.treasury);
    assert.equal(r.binding, null);
  });

  // 7 ---------------------------------------------------------------------------------------------
  await check('new-feature', 'REMNANT-SUBORDINATE an explicit subordination makes the Remnant inherit Central\'s war with one report; Central\'s settlement then carries it along', async () => {
    await fresh('dw-subordinate');
    const r = await ev(() => {
      const t = testBM1, book = t.campaign();
      window.__invade();
      const from = t.state.day;
      const joined = t.subordinateRemnant();
      const rec = t.formalRecord('bajoran', 'dominion_remnant');
      const news = () => { const n = t.galaxyNewsBook(); return [...n.items, ...n.pending].filter((x) => x.day >= from); };
      const bindingReports = news().filter((x) => /Command bound/.test(x.kind)).map((x) => x.text);
      const remnantDeclared = news().filter((x) => String(x.id).startsWith('diplomacy:declared:') && String(x.id).includes('dominion_remnant')).length;
      const relation = { central: window.__rel('dominion_remnant', 'dominion'), bajoran: window.__rel('dominion_remnant', 'bajoran') };
      // Central's war with the Bajorans ends (Bajora falls): the Remnant's inherited war follows it.
      window.__advance(12);
      const settle = news().filter((x) => String(x.id).startsWith('diplomacy:war:') && /bajoran/.test(String(x.id)));
      return { joined, rec: rec && { status: rec.status, inheritedFrom: rec.inheritedFrom }, bindingReports, remnantDeclared, relation,
        central: t.formalRecord('bajoran', 'dominion').status, remnant: t.formalRecord('bajoran', 'dominion_remnant').status, basis: book.warStates['bajoran:dominion_remnant']?.settlement?.basis, settle: settle.map((x) => x.text) };
    });
    assert.deepEqual(r.joined.map((x) => x.other), ['bajoran']);
    assert.deepEqual(r.rec, { status: 'war', inheritedFrom: 'dominion' });
    assert.equal(r.bindingReports.length, 1, `binding reports: ${r.bindingReports}`); assert.match(r.bindingReports[0], /Bajoran/);
    assert.equal(r.remnantDeclared, 0, 'the Remnant\'s inherited war was published as a declaration of its own');
    assert.deepEqual(r.relation, { central: 'allied', bajoran: 'war' });
    assert.equal(r.central, 'peace', 'precondition: Central\'s Bajoran war did not end');
    assert.equal(r.remnant, 'peace', 'the Remnant\'s inherited war did not follow Central\'s settlement');
    assert.equal(r.basis, 'co-belligerent');
    assert.equal(r.settle.length, 1, `settlement reports: ${r.settle.join(' | ')}`);
    assert.match(r.settle[0], /also binds Blender Remnant/);
  });

  // 8 ---------------------------------------------------------------------------------------------
  await check('new-feature', 'SAVELOAD Central\'s and the Remnant\'s formal records, the invasion plan and the command binding survive save/load exactly, autonomous and bound', async () => {
    await fresh('dw-save');
    const r = await ev(() => {
      const t = testBM1, book = () => t.campaign();
      const read = () => JSON.stringify({ records: window.__arcRecords(), pairs: window.__arcPairs(), plan: book().dominion.plan, phase: book().dominion.phase, bindings: book().commandBindings || null,
        states: Object.fromEntries(Object.entries(book().warStates).filter(([k]) => /dominion/.test(k)).map(([k, v]) => [k, { warId: v.warId, status: v.status, declared: v.declared }])),
        rel: { remnantCentral: window.__rel('dominion_remnant', 'dominion'), centralBajoran: window.__rel('dominion', 'bajoran'), remnantBajoran: window.__rel('dominion_remnant', 'bajoran') } });
      window.__invade();
      const autonomous = read();
      t.saveGame(7); t.startWithFaction('ferengi'); t.loadGame(7);
      const autonomousBack = read();
      t.subordinateRemnant();
      const bound = read();
      t.saveGame(7); t.startWithFaction('ferengi'); t.loadGame(7);
      return { autonomous, autonomousBack, bound, boundBack: read() };
    });
    assert.equal(r.autonomousBack, r.autonomous);
    assert.equal(r.boundBack, r.bound);
    assert.equal(JSON.parse(r.autonomous).rel.remnantBajoran, 'peace'); assert.equal(JSON.parse(r.bound).rel.remnantBajoran, 'war');
    assert.equal(JSON.parse(r.autonomous).rel.remnantCentral, 'peace'); assert.equal(JSON.parse(r.bound).rel.remnantCentral, 'allied');
  });

  // 12 & 13 ---------------------------------------------------------------------------------------
  await check('baseline-defect', 'EMPIRE-NOT-AUTO the captain\'s empire does not join a later Terran-government war with the Dominion, and neither its flag nor static hostility puts it at war', async () => {
    await fresh('dw-empire');
    const r = await ev(() => {
      const t = testBM1, s = t.state;
      t.changeDiplomacy('dominion', 'terran', 'war');
      const gov = t.formalRelation('terran', 'dominion').status;
      const empire = t.playerRelation('dominion').status;
      s.playerFlags = [...new Set([...(s.playerFlags || []), 'bajoran'])];
      t.raisePlayerFlag?.('bajoran');
      return { gov, empire, afterFlag: t.playerRelation('dominion').status, campaign: window.__rel('dominion', 'player') };
    });
    assert.equal(r.gov, 'war', 'precondition: no Terran–Dominion war');
    assert.equal(r.empire, 'peace', 'the empire inherited its government\'s later war');
    assert.equal(r.afterFlag, 'peace'); assert.equal(r.campaign, 'peace', 'the campaign puts the empire at war with the Dominion through its flag\'s static hostility');
  });

  await check('new-feature', 'EMPIRE-BOUND an explicit binding event joins the empire to the Terran–Dominion war with one report, and the government\'s ceasefire carries it along as one report', async () => {
    await fresh('dw-bound');
    const r = await ev(() => {
      const t = testBM1, s = t.state;
      window.__contact();
      t.changeDiplomacy('dominion', 'terran', 'war');
      const from = s.day;
      t.bindEmpireToWar('terran', 'dominion', 'the Admiralty mobilises its officers');
      const rec = t.diplomacyBook().pairs['dominion:player'];
      const news = () => { const n = t.galaxyNewsBook(); return [...n.items, ...n.pending].filter((x) => x.day >= from); };
      const binding = news().filter((x) => x.kind === 'War binding').map((x) => x.text);
      t.changeDiplomacy('dominion', 'terran', 'ceasefire');
      const cease = news().filter((x) => String(x.id).startsWith('diplomacy:war:') && /dominion/.test(String(x.id)));
      return { rec: rec && { status: rec.status, inheritedFrom: rec.inheritedFrom }, binding, empire: t.playerRelation('dominion').status, gov: t.formalRelation('terran', 'dominion').status,
        basis: t.campaign().warStates['dominion:player']?.settlement?.basis ?? t.campaign().warStates['dominion:player']?.status, cease: cease.map((x) => x.text) };
    });
    assert.deepEqual(r.rec, { status: 'war', inheritedFrom: 'terran' });
    assert.equal(r.binding.length, 1);
    assert.equal(r.gov, 'ceasefire'); assert.equal(r.empire, 'ceasefire', 'the bound empire did not follow its government\'s ceasefire');
    assert.equal(r.cease.length, 1, `ceasefire reports: ${r.cease.join(' | ')}`);
    assert.match(r.cease[0], /also applies to your empire/);
  });

  await check('preservation', 'LOCAL-HOSTILE a hostile Dominion without a formal war is still hostile locally: attitude and ships on sight', async () => {
    await fresh('dw-local');
    const r = await ev(() => {
      const t = testBM1;
      return { opposed: t.areFactionsOpposed('dominion', t.getPlayerFlag()), attitude: t.getFactionAttitude('dominion'), local: t.worldRelation('terran', 'dominion').status };
    });
    assert.equal(r.opposed, true); assert.equal(r.local, 'war');
  });

  // summary -----------------------------------------------------------------------------------------
  const byCat = {};
  for (const x of results) { byCat[x.category] ||= { ok: 0, n: 0 }; byCat[x.category].n++; if (x.ok) byCat[x.category].ok++; }
  console.log('\nSummary by category:');
  for (const [k, v] of Object.entries(byCat)) console.log(`  ${k}: ${v.ok}/${v.n}`);
  const failed = results.filter((x) => !x.ok);
  console.log(`${results.length - failed.length}/${results.length} Dominion-war checks passed.`);
  if (probe.errors.length) console.log(`page errors: ${probe.errors.join(' | ')}`);
  await probe.close();
  process.exit(failed.length || probe.errors.length ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
