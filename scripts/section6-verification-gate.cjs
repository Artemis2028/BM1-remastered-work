// Bounded verification/correction pass on the §6 candidate 1ddb287. Each check carries a category, and
// the summary counts them separately:
//   baseline-defect  reproduces a wrong behaviour; expected to fail on the tree the correction is for
//   preservation     behaviour that must not change; expected to pass on 1ddb287 and on this candidate
//   synthetic-guard  a state play cannot reach today, pinned so it cannot regress silently
//   new-feature      needs something 1ddb287 does not have; on that tree it fails its precondition
// The categories are stated per check below. Nothing is inferred from the result.
const assert = require('node:assert/strict');
const path = require('node:path');
const { startProbe } = require('./probe-harness.cjs');

(async () => {
  const probe = await startProbe({ pageOptions: { deviceScaleFactor: 2 } });
  const { ev, fresh, page, errors } = probe;
  const out = process.env.BM1_TEST_OUTPUT || '/tmp';
  const results = [];
  async function check(category, name, fn) {
    try { await fn(); results.push({ category, name, ok: true }); console.log('PASS', `[${category}]`, name); }
    catch (err) { results.push({ category, name, ok: false, message: String(err?.message || err).split('\n').slice(0, 6).join(' ') }); console.log('FAIL', `[${category}]`, name, '\n      ', String(err?.message || err).split('\n').slice(0, 8).join(' ')); }
  }

  await page.evaluate(() => {
    window.__tradeSetup = () => {
      const t = testBM1, s = t.state;
      s.latinum = 100000; s.mylatinum = s.latinum; s.day = 10;
      s.playerFleet.length = 0;
      const home = s.currentPlanet;
      for (let i = 0; i < 24; i++) { s.currentPlanet = i; t.markSystemVisited(i); if (typeof t.recordMarketObservation === 'function') t.recordMarketObservation(i); }
      s.currentPlanet = home;
    };
    window.__tradeShip = (id) => {
      const t = testBM1, s = t.state;
      const ships = Object.values(s.shipStatsById).filter((x) => x && x.assetType === 'ship' && Number(x.cargoCapacity) > 0).sort((a, b) => Number(a.cargoCapacity) - Number(b.cargoCapacity));
      const f = { id, shipId: Number(ships[ships.length - 1].id), name: id, faction: s.playerFaction, assignment: 'defense', systemIndex: s.currentPlanet, seed: 3 };
      s.playerFleet.push(f);
      t.autoAssignFleet(f);
      return f;
    };
    window.__tradeDays = (n) => { const t = testBM1, s = t.state; for (let i = 0; i < n; i++) { s.day += 1; t.completeFleetJourneys(); t.acknowledgeCampaignOrders(); t.advanceFleetTrading(s.day); } };
    // A fleet ship in the captain's system, in the loaded scene, disabled by the production path: her
    // hull is knocked into the band and applyVesselDisablement runs, as a hit in combat does.
    window.__localShip = (id) => {
      const t = testBM1, s = t.state;
      const f = window.__tradeShip(id);
      t.ensureFleetTradeState(f, 'any');
      s.npcShips.push(...t.getPlayerFleetNpcShips().filter((n) => n.fleetId === f.id));
      const a = t.fleetLocalActor(f.id);
      t.ensureNpcCombatStats(a);
      return { f, a };
    };
    window.__disableLocal = (a) => {
      const t = testBM1;
      a.combatHull = Math.max(1, Math.floor(t.Fleet.disableThreshold(a.maxCombatHull) * 0.5));
      t.applyVesselDisablement(a);
      t.captureShipPowerState();
    };
    // Alongside her, docked, out of combat: the state the yard's Repair hull control requires.
    window.__dockBeside = (a) => {
      const t = testBM1, s = t.state;
      s.docked = true; s.dockedStationId = null; s.dockedPlanetIndex = s.currentPlanet;
      t.setCamera(a.x, a.y);
      if (a.power) a.power.combat = false;
      a.lastShieldHitAt = 0;
    };
  });
  // Press the fleet manager's Repair hull for one ship, as the captain does.
  const pressRepair = async (id) => {
    const before = await ev((id) => {
      const t = testBM1, s = t.state;
      const a = t.fleetLocalActor(id);
      const price = t.getShipPrice(t.getShipStats(a.shipId));
      const basis = price * t.Fleet.FLEET_RULES.repairBasis;
      const desired = Math.min(a.maxCombatHull, a.combatHull + (Math.max(0, s.latinum) / Math.max(1, basis)) * a.maxCombatHull);
      const quote = t.Fleet.repairQuote(price, a.combatHull, a.maxCombatHull, desired);
      t.renderFleetManager(true);
      return { latinum: s.latinum, quote: quote.amount, allowed: t.fleetServiceAllowed(a, true) };
    }, id);
    await page.locator(`.fleet-manager details:has(summary:has-text("${id}"))`).first().evaluate((d) => { d.open = true; });
    await page.locator(`.fleet-manager [data-fleet-action="repair"][data-fleet-id="${id}"]`).first().click();
    const after = await ev((id) => {
      const t = testBM1, s = t.state;
      const a = t.fleetLocalActor(id);
      const f = s.playerFleet.find((x) => x.id === id);
      const line = t.fleetTradeStatusLine(f);
      document.querySelector('.fleet-manager')?.close();
      t.resumeGameClock();
      return { latinum: s.latinum, condition: a.condition, recoveryAt: a.recoveryAt, now: t.gameNow(), hull: a.combatHull, max: a.maxCombatHull, line };
    }, id);
    return { before, after };
  };
  // Let real time pass until the recovery timer has run out, ticking the scene as the game loop does.
  const recover = async () => {
    for (let i = 0; i < 20; i++) {
      await page.waitForTimeout(400);
      const done = await ev(() => { const t = testBM1; t.tick(0.001); return t.state.npcShips.filter((n) => n.fleetId).every((n) => n.condition !== 'disabled'); });
      if (done && i >= 12) return true;
    }
    return false;
  };

  // ------------------------------------------------------------ production repair workflow
  const recoveringLines = [];
  for (const scenario of ['interrupted-trading', 'intentional-stop', 'unresolved-rendezvous']) {
    await check('preservation', `REPAIR-PROD ${scenario}: disabled in combat → Repair hull at the yard → paid → save/load during recovery → recovery completes → correct state`, async () => {
      await fresh(`repair-${scenario}`);
      const setup = await ev((scenario) => {
        const t = testBM1, s = t.state;
        window.__tradeSetup();
        const { f, a } = window.__localShip(`prod-${scenario}`);
        const tr = f.trade;
        let dest = null;
        if (scenario !== 'unresolved-rendezvous') { tr.active = true; tr.stage = 'idle'; }
        window.__disableLocal(a);
        window.__tradeDays(1);
        if (scenario === 'intentional-stop') t.stopFleetTrading(f.id);
        if (scenario === 'unresolved-rendezvous') {
          dest = [...Array(s.planets.length).keys()].find((i) => i !== Number(s.currentPlanet) && t.isChartSystemVisible(i) && t.getPlottedRoute(s.currentPlanet, i));
          t.orderFleetRendezvous(f.id, dest);
        }
        window.__dockBeside(a);
        return { disabled: t.fleetTradeStatusLine(f), condition: a.condition, resume: Boolean(tr.resumeTrade), order: tr.order ? { ...tr.order } : null, dest };
      }, scenario);
      assert.equal(setup.condition, 'disabled', 'precondition: the combat path did not disable her');
      assert.match(setup.disabled, /^Disabled — awaiting repair/, `disabled: "${setup.disabled}"`);
      const repair = await pressRepair(`prod-${scenario}`);
      assert.ok(repair.before.allowed, 'precondition: the yard refused service');
      assert.ok(repair.before.quote > 0, 'precondition: nothing to pay for');
      assert.equal(Math.round((repair.before.latinum - repair.after.latinum) * 100), Math.round(repair.before.quote * 100), `paid ${repair.before.latinum - repair.after.latinum}, quoted ${repair.before.quote}`);
      assert.equal(repair.after.hull, repair.after.max, 'the hull was not restored');
      assert.equal(repair.after.condition, 'disabled', 'repair skipped the recovery timer');
      assert.ok(repair.after.recoveryAt > repair.after.now, 'no recovery timer running');
      assert.match(repair.after.line, /^Disabled/, `during recovery: "${repair.after.line}"`);
      recoveringLines.push(repair.after.line);
      // Save and reload in the middle of the recovery.
      const reloaded = await ev((scenario) => {
        const t = testBM1, s = t.state;
        const id = `prod-${scenario}`;
        t.saveGame(9);
        t.startWithFaction('terran');
        t.loadGame(9);
        t.resumeGameClock();
        const a = t.fleetLocalActor(id);
        const f = s.playerFleet.find((x) => x.id === id);
        return { actor: Boolean(a), condition: a?.condition, recovering: Boolean(a && a.recoveryAt > t.gameNow()), resume: Boolean(f.trade?.resumeTrade), order: f.trade?.order ? { ...f.trade.order } : null, latinum: s.latinum };
      }, scenario);
      assert.ok(reloaded.actor, 'after the reload she is not in the scene');
      assert.equal(reloaded.condition, 'disabled');
      assert.ok(reloaded.recovering, 'the reload lost the recovery timer');
      assert.equal(Math.round(reloaded.latinum), Math.round(repair.after.latinum), 'the reload changed what was paid');
      assert.ok(await recover(), 'the recovery timer never completed');
      const done = await ev((scenario) => {
        const t = testBM1, s = t.state;
        const id = `prod-${scenario}`;
        const f = s.playerFleet.find((x) => x.id === id);
        const repaired = t.fleetTradeStatusLine(f);
        // The real calendar, which captures the scene's vessels before the day moves them.
        t.advanceFleetCalendar(1, t.Fleet.nextId(t.fleetBook(), "journey"));
        return { repaired, after: { active: Boolean(f.trade.active), stage: f.trade.stage, order: f.trade.order ? { ...f.trade.order } : null, line: t.fleetTradeStatusLine(f), condition: t.fleetVesselCondition(f) } };
      }, scenario);
      assert.equal(done.after.condition, 'operational');
      if (scenario === 'interrupted-trading') {
        assert.match(done.repaired, /^Repaired — resuming trading/, `recovered: "${done.repaired}"`);
        assert.equal(done.after.active, true, `interrupted trading did not resume: ${JSON.stringify(done.after)}`);
      } else if (scenario === 'intentional-stop') {
        assert.match(done.repaired, /^Repaired — holding/, `recovered: "${done.repaired}"`);
        assert.equal(done.after.active, false, 'the captain said Stop and she resumed trading');
        assert.match(done.after.line, /^Repaired — holding/);
      } else {
        assert.match(done.repaired, /^Repaired — Rendezvous at .* · leaving/, `recovered: "${done.repaired}"`);
        assert.equal(done.after.stage, 'passage', `the unresolved rendezvous did not resume: ${JSON.stringify(done.after)}`);
        assert.equal(done.after.order.to, setup.dest);
      }
    });
  }

  await check('new-feature', 'REPAIR-RECOVERING-STATUS between payment and the end of the recovery timer the row says she is repaired and recovering, not awaiting repair', async () => {
    assert.equal(recoveringLines.length, 3, 'precondition: the repair scenarios did not reach the recovery timer');
    for (const line of recoveringLines) assert.match(line, /^Disabled — repaired, recovering/, `during recovery: "${line}"`);
  });

  await check('preservation', 'ACCOUNTING disablement, repair and resumption move money only through the repair payment and the trade books only through trading', async () => {
    await fresh('accounting');
    const r = await ev(() => {
      const t = testBM1, s = t.state;
      window.__tradeSetup();
      const { f, a } = window.__localShip('acct');
      const tr = f.trade;
      tr.active = true; tr.stage = 'idle';
      tr.manifest = [{ goods: 'Dilithium', tons: 12, to: s.currentPlanet, kind: 'commodity', cost: 60 }];
      const books = () => ({ paid: tr.paid, revenue: tr.revenue, cumulative: tr.cumulative, circuits: tr.circuits, contract: tr.contractIncome, commodity: tr.commodityIncome, aboard: t.fleetTradeLoad(tr) });
      s.latinum = 50000; s.mylatinum = s.latinum;
      const start = { latinum: s.latinum, books: books() };
      window.__disableLocal(a);
      window.__tradeDays(5); // five days disabled: nothing traded, nothing paid, nothing earned
      const disabled = { latinum: s.latinum, books: books(), active: tr.active };
      return { start, disabled };
    });
    assert.equal(r.disabled.latinum, r.start.latinum, 'money moved while she lay disabled (the calendar here does not bill upkeep)');
    assert.deepEqual(r.disabled.books, r.start.books, 'her trade books changed while she lay disabled');
    assert.equal(r.disabled.active, false);
    await ev(() => window.__dockBeside(testBM1.fleetLocalActor('acct')));
    const repair = await pressRepair('acct');
    assert.equal(Math.round((repair.before.latinum - repair.after.latinum) * 100), Math.round(repair.before.quote * 100), 'the repair charged something other than its quote');
    assert.ok(await recover(), 'the recovery timer never completed');
    const after = await ev(() => {
      const t = testBM1, s = t.state;
      const f = s.playerFleet.find((x) => x.id === 'acct');
      const tr = f.trade;
      const before = { latinum: s.latinum, aboard: t.fleetTradeLoad(tr), paid: tr.paid, cumulative: tr.cumulative };
      window.__tradeDays(1);
      return { before, active: tr.active, aboard: t.fleetTradeLoad(tr) };
    });
    assert.equal(after.before.aboard, 12, 'cargo aboard was lost to the disablement or the repair');
    assert.equal(after.before.paid, r.start.books.paid);
    assert.equal(after.active, true, 'she did not resume');
  });

  // ------------------------------------------------------------ Campaign Report classification
  await check('baseline-defect', 'STORYLINE only the expedition\'s warnings, convoys and accounts that name it are Campaign Report; ordinary Dominion incidents are Subspace News; a misattributed account of the expedition is not filed under the story', async () => {
    await fresh('storyline');
    const r = await ev(() => {
      const t = testBM1, s = t.state;
      if (!t.reportCampaignEvent) return { fail: 'no report composer exported' };
      const here = Number(s.currentPlanet);
      const other = s.planets.findIndex((p, i) => i !== here && t.isChartSystemVisible(i));
      t.markSystemVisited(other);
      const b = t.galaxyNewsBook(); b.items = []; b.readIds = []; b.pending = [];
      t.campaign().dominion.expeditionOpId = 'gate-expedition';
      const compose = (id, attacker, storyline, place = other) => t.reportCampaignEvent({ id, systemIndex: place, day: s.day, kind: 'Fleet movement', source: 'local', attacker,
        factions: [attacker], involved: [], storyline, observationKind: 'raid', playerRelated: false, direct: `${attacker} force moving.` });
      // The expedition, named in the account received.
      compose('op-launch:gate-expedition', 'dominion', 'dominion');
      // The expedition, but the account received blames someone else.
      compose('op-arrive:gate-expedition', 'klingon', 'dominion');
      // An ordinary Dominion incident: a remnant raid elsewhere.
      compose('op-launch:gate-remnant', 'dominion', null);
      // An ordinary Dominion incident at a world of the captain's: player-relevant.
      t.addGalaxyReport({ id: 'op-launch:gate-remnant-2', systemIndex: other, day: s.day, kind: 'Fleet movement', category: 'campaign', confidence: 'x', factions: ['dominion'], claimedAttacker: 'dominion', playerRelated: true, text: 'Dominion raiders at your world.' });
      // Warnings and a convoy.
      t.applyCampaignEffects([{ type: 'dominionWarning', id: 'missing-patrols', text: 'Patrols near Bajora have stopped reporting on schedule.', systemIndex: null, day: s.day }], s.day);
      t.addGalaxyReport({ id: `convoy:${other}:${s.day}`, systemIndex: other, day: s.day, kind: 'Reinforcement convoy', category: 'campaign', confidence: 'x', factions: [], text: 'Warship movements through the wormhole.' });
      const by = Object.fromEntries(b.items.map((x) => [x.id, { story: t.isDominionCampaignReport(x), folder: t.galaxyReportCategory(x), personal: t.isPersonalGalaxyReport(x) }]));
      return { fail: null, by };
    });
    assert.ok(!r.fail, r.fail);
    assert.equal(r.by['op-launch:gate-expedition'].story, true, 'the expedition, named, is not in the Campaign Report');
    assert.equal(r.by['op-arrive:gate-expedition'].story, false, 'an account blaming the Klingons was filed under the Dominion story, which tells the captain who it really was');
    assert.equal(r.by['op-launch:gate-remnant'].story, false, 'an ordinary Dominion incident was filed as the storyline');
    assert.equal(r.by['op-launch:gate-remnant'].folder, 'fronts');
    assert.equal(r.by['op-launch:gate-remnant-2'].story, false);
    assert.equal(r.by['op-launch:gate-remnant-2'].personal, true, 'a player-relevant Dominion incident is not in the Captain\'s Log');
    assert.equal(r.by['dominion:missing-patrols'].story, true);
    assert.equal(r.by[Object.keys(r.by).find((k) => k.startsWith('convoy:'))].story, true);
  });

  await check('baseline-defect', 'STORYLINE-CAP the jump briefing\'s Campaign Report is bounded; the overflow waits for the next jump', async () => {
    await fresh('storyline-cap');
    const r = await ev(() => {
      const t = testBM1, s = t.state;
      const b = t.galaxyNewsBook(); b.items = []; b.readIds = []; b.pending = [];
      for (let i = 0; i < 7; i++) t.addGalaxyReport({ id: `convoy:${s.currentPlanet}:${i}`, systemIndex: s.currentPlanet, day: s.day, kind: 'Reinforcement convoy', category: 'campaign', confidence: 'x', factions: [], text: `Convoy ${i}` });
      s.warp.briefingReports = null;
      const first = t.selectJumpBriefingReports();
      b.readIds = [...b.readIds, ...first.campaign.map((x) => x.id)];
      s.warp.briefingReports = null;
      const second = t.selectJumpBriefingReports();
      return { first: first.campaign.length, second: second.campaign.length, overlap: first.campaign.some((x) => second.campaign.some((y) => y.id === x.id)) };
    });
    assert.equal(r.first, 3, `the first jump showed ${r.first} storyline reports`);
    assert.equal(r.second, 3);
    assert.equal(r.overlap, false);
  });

  // ------------------------------------------------------------ operation intelligence
  await check('baseline-defect', 'OPS-LOSS-OF-CONTACT what the captain watched is kept as it was seen; later hidden changes to strength, losses, target, status or existence do not reach it', async () => {
    await fresh('ops-contact');
    const r = await ev(() => {
      const t = testBM1, s = t.state;
      const book = t.campaign();
      const here = Number(s.currentPlanet);
      const hulls = book.polities.klingon.hulls.filter((h) => h.status !== 'lost').slice(0, 5);
      const op = { id: 'gate-watch', faction: 'klingon', kind: 'raid', targetSystem: here, status: 'engaged', launchedDay: s.day - 2, arriveDay: s.day, losses: 1, hullIds: hulls.map((h) => h.id) };
      book.operations.push(op);
      const panel = () => { t.openCampaignPanel('operations'); const text = document.getElementById('campaign-panel').textContent; t.closeCampaignPanel(); return text; };
      const watching = panel();
      const seenDay = s.day;
      // The captain leaves; there is no report of this operation in the book at all.
      const away = s.planets.findIndex((p, i) => i !== here && t.isChartSystemVisible(i) && !t.isSystemRelayConnected(i));
      s.currentPlanet = away;
      s.day += 3;
      const left = panel();
      // Hidden changes: more hulls, more losses, a new target, and then the operation is resolved and pruned.
      op.hullIds = book.polities.klingon.hulls.filter((h) => h.status !== 'lost').slice(0, 11).map((h) => h.id);
      op.losses = 9;
      const target2 = s.planets.findIndex((p, i) => i !== here && i !== away && t.isChartSystemVisible(i));
      op.targetSystem = target2;
      const retargeted = panel();
      op.status = 'resolved';
      book.operations = book.operations.filter((o) => o !== op);
      const pruned = panel();
      return { watching, left, retargeted, pruned, seenDay, here: s.planets[here].name, target2: s.planets[target2].name };
    });
    assert.match(r.watching, /5 hulls present, 1 lost/, `watching: ${r.watching.slice(0, 300)}`);
    for (const [label, text] of [['after leaving', r.left], ['after the hidden changes', r.retargeted], ['after the operation left the books', r.pruned]]) {
      assert.match(text, new RegExp(`observed day ${r.seenDay}`), `${label}: the dated sighting is gone: ${text.slice(0, 300)}`);
      assert.match(text, /5 hulls present, 1 lost/, `${label}: the sighting changed: ${text.slice(0, 300)}`);
      assert.ok(text.includes(r.here), `${label}: the target the captain saw is gone`);
      assert.doesNotMatch(text, /11 hulls|9 lost/, `${label}: hidden strength or losses reached the panel`);
      assert.ok(!text.includes(`→ ${r.target2}`), `${label}: the hidden new target reached the panel`);
    }
  });

  await check('baseline-defect', 'OPS-RETURN-AFTER-PRUNE returning to where a pruned operation was watched leaves the dated sighting as it was: same day, target, 5 hulls / 1 lost; never direct, never rewritten', async () => {
    await fresh('ops-return');
    const r = await ev(() => {
      const t = testBM1, s = t.state;
      const book = t.campaign();
      const here = Number(s.currentPlanet);
      const hulls = book.polities.klingon.hulls.filter((h) => h.status !== 'lost').slice(0, 5);
      const op = { id: 'gate-return', faction: 'klingon', kind: 'raid', targetSystem: here, status: 'engaged', launchedDay: s.day - 2, arriveDay: s.day, losses: 1, hullIds: hulls.map((h) => h.id) };
      book.operations.push(op);
      const panel = () => { t.openCampaignPanel('operations'); const text = document.getElementById('campaign-panel').textContent; t.closeCampaignPanel(); return text; };
      const levelOf = () => { const x = t.campaignKnownOperations().find((k) => k.op.id === 'gate-return'); return x ? x.known.level : 'none'; };
      panel();
      const seen = { ...t.campaignSightings(book)['gate-return'] };
      // Leave; change it behind the captain's back; resolve and prune it.
      const away = s.planets.findIndex((p, i) => i !== here && t.isChartSystemVisible(i) && !t.isSystemRelayConnected(i));
      s.currentPlanet = away;
      s.day += 3;
      op.hullIds = book.polities.klingon.hulls.filter((h) => h.status !== 'lost').slice(0, 11).map((h) => h.id);
      op.losses = 9;
      op.targetSystem = s.planets.findIndex((p, i) => i !== here && i !== away && t.isChartSystemVisible(i));
      op.status = 'resolved';
      book.operations = book.operations.filter((o) => o !== op);
      const awayText = panel();
      const awayLevel = levelOf();
      // Return to the system where it was watched.
      s.currentPlanet = here;
      s.day += 2;
      const backText = panel();
      const backLevel = levelOf();
      const after = { ...t.campaignSightings(book)['gate-return'] };
      return { seen, after, awayText, awayLevel, backText, backLevel, name: s.planets[here].name };
    });
    assert.equal(r.seen.hulls, 5, `precondition: the watched operation was not recorded: ${JSON.stringify(r.seen)}`);
    assert.equal(r.awayLevel, 'observed');
    assert.match(r.awayText, new RegExp(`observed day ${r.seen.day}[^]*5 hulls present, 1 lost`), `away: ${r.awayText.slice(0, 300)}`);
    assert.equal(r.backLevel, 'observed', `back at ${r.name} the pruned operation became "${r.backLevel}"`);
    assert.deepEqual(r.after, r.seen, `returning rewrote the sighting: ${JSON.stringify(r.seen)} -> ${JSON.stringify(r.after)}`);
    assert.match(r.backText, new RegExp(`observed day ${r.seen.day}[^]*5 hulls present, 1 lost`), `back: ${r.backText.slice(0, 300)}`);
    assert.ok(r.backText.includes(r.name));
    assert.doesNotMatch(r.backText, /0 hulls present|11 hulls|9 lost/, `back: ${r.backText.slice(0, 300)}`);
  });

  // ------------------------------------------------------------ cargo
  const cargoFixture = () => ev(() => {
    const t = testBM1, s = t.state;
    s.cargoArray.forEach((p) => { p.tons = 0; p.item = 'Nothing'; p.destination = undefined; delete p.contractId; delete p.destinationIndex; p.payout = 0; });
    const here = Number(s.currentPlanet);
    const dest = s.planets.findIndex((p, i) => i !== here && t.isChartSystemVisible(i));
    const dest2 = s.planets.findIndex((p, i) => i !== here && i !== dest && t.isChartSystemVisible(i));
    s.openContracts = [
      { id: 'gate-a', goods: 'Medical supplies', tons: 7, payPerTon: 40, fee: 1000, targetIndex: dest, employerName: 'Office A', employerFaction: 'terran' },
      { id: 'gate-b', goods: 'Medical supplies', tons: 4, payPerTon: 40, fee: 500, targetIndex: dest, employerName: 'Office B', employerFaction: 'terran' },
      { id: 'gate-c', goods: 'Medical supplies', tons: 3, payPerTon: 40, fee: 200, targetIndex: dest2, employerName: 'Office C', employerFaction: 'terran' },
    ];
    t.getOpenContracts();
    t.addCargoToPods('Medical supplies', 5); // ordinary cargo of the same commodity
    t.openTopLeftTab('inventory');
    return { dest, dest2 };
  });
  const hold = () => ev(() => testBM1.state.cargoArray.filter((p) => Number(p.tons) > 0).map((p) => ({ item: p.item, tons: Number(p.tons), dest: p.destinationIndex ?? null, contractId: p.contractId || null, payout: Number(p.payout || 0) })));
  await check('new-feature', 'CARGO-CONFIRM the confirmation states the exact consequences — tonnage, destination, forfeited payment and the −3 standing — and Cancel changes nothing', async () => {
    await fresh('cargo-confirm');
    await cargoFixture();
    const r = await ev(() => {
      const t = testBM1, s = t.state;
      const snap = () => JSON.stringify({ pods: s.cargoArray, contracts: t.getOpenContracts().map((c) => c.id), standing: t.getFactionStanding('terran'), latinum: s.latinum });
      const before = snap();
      const idx = s.cargoArray.findIndex((p) => p.contractId === 'gate-c');
      t.dumpCargoPod(idx);
      const text = document.querySelector('[data-cargo-dump-text]')?.textContent || '';
      const buttons = [...document.querySelectorAll('.cargo-dump-confirm button')].map((b) => b.textContent);
      document.querySelector('[data-cargo-dump-cancel]').click();
      const after = snap();
      const reArmed = s.cargoDumpArmed;
      return { text, buttons, same: before === after, reArmed, total: t.getContractTotal(t.getOpenContracts().find((c) => c.id === 'gate-c')) };
    });
    assert.match(r.text, /3 t Medical supplies/, `confirmation: "${r.text}"`);
    assert.match(r.text, new RegExp(`${r.total.toLocaleString()} L payment is forfeit`), `confirmation: "${r.text}"`);
    assert.match(r.text, /Terran standing -3/, `confirmation: "${r.text}"`);
    assert.deepEqual(r.buttons, ['Confirm dump', 'Cancel']);
    assert.equal(r.same, true, 'Cancel changed the hold, the contracts, standing or money');
    assert.equal(r.reArmed, null, 'Cancel left the dump armed');
  });
  await check('baseline-defect', 'CARGO-ONCE confirming fails that shipment once and removes only its cargo; a shared pod keeps the other shipment; plain cargo of the same commodity survives; it stays gone across save/load', async () => {
    await fresh('cargo-once');
    await cargoFixture();
    const before = await hold();
    const sumBefore = before.filter((p) => p.dest != null).reduce((n, p) => n + p.tons, 0);
    assert.equal(sumBefore, 14, `shipments A (7 t), B (4 t) and C (3 t) are not all aboard: ${JSON.stringify(before)}`);
    const r = await ev(() => {
      const t = testBM1, s = t.state;
      const standing = t.getFactionStanding('terran');
      // Shipments A and B go to the same world with the same goods; dump A (warning, then confirmation).
      const idx = s.cargoArray.findIndex((p) => Number(p.tons) > 0 && p.contractId === 'gate-a')
        ?? s.cargoArray.findIndex((p) => Number(p.tons) > 0 && p.destinationIndex != null);
      t.dumpCargoPod(idx >= 0 ? idx : s.cargoArray.findIndex((p) => Number(p.tons) > 0 && p.destinationIndex != null));
      t.dumpCargoPod(idx >= 0 ? idx : s.cargoArray.findIndex((p) => Number(p.tons) > 0 && p.destinationIndex != null));
      const again = t.abandonCargoContract('gate-a'); // a second confirmation arriving late
      const contracts = t.getOpenContracts().map((c) => c.id);
      t.saveGame(8); t.startWithFaction('terran'); t.loadGame(8);
      t.openTopLeftTab('inventory'); // the render that restores missing contract cargo
      return { again, contracts, standingDelta: t.getFactionStanding('terran') - standing, reloadedContracts: t.getOpenContracts().map((c) => c.id) };
    });
    const after = await hold();
    const sum = (rows, pred) => rows.filter(pred).reduce((n, p) => n + p.tons, 0);
    assert.equal(r.again, false, 'a second confirmation failed the shipment again');
    assert.equal(r.standingDelta, -3, `the penalty was applied ${r.standingDelta / -3} times`);
    assert.deepEqual(r.contracts, ['gate-b', 'gate-c']);
    assert.deepEqual(r.reloadedContracts, ['gate-b', 'gate-c'], 'the failed shipment came back with the save');
    assert.equal(sum(before, (p) => p.dest != null && p.contractId !== 'gate-c') - 7, sum(after, (p) => p.dest != null && p.contractId !== 'gate-c'), `the shared pod lost more or less than shipment A's 7 t: ${JSON.stringify(after)}`);
    assert.equal(sum(after, (p) => p.contractId === 'gate-c'), 3, 'shipment C was touched');
    assert.equal(sum(after, (p) => p.dest == null && p.item === 'Medical supplies'), 5, 'ordinary Medical supplies were jettisoned with the shipment');
  });
  await check('preservation', 'CARGO-CONTROLS every delivery control runs the same destination, cargo and range test and pays once', async () => {
    await fresh('cargo-controls');
    const r = await ev(() => {
      const t = testBM1, s = t.state;
      const here = Number(s.currentPlanet);
      s.cargoArray.forEach((p) => { p.tons = 0; p.item = 'Nothing'; p.destination = undefined; delete p.contractId; p.payout = 0; });
      s.openContracts = [{ id: 'gate-d', goods: 'Medical supplies', tons: 2, payPerTon: 100, fee: 300, targetIndex: here, employerName: 'Office D', employerFaction: 'terran' }];
      t.getOpenContracts();
      t.applySystemState(here);
      const planet = s.systemPlanet;
      const cash0 = s.latinum;
      t.setCamera(planet.x + t.CARGO_TRANSPORT_RANGE + 50, planet.y);
      t.openTopLeftTab('inventory');
      const out = { inventoryFar: (document.querySelector('[data-cargo-drop]')?.click(), s.latinum - cash0) };
      t.openTopLeftTab('contracts');
      out.contractsFar = (document.querySelector('[data-cargo-drop]')?.click(), s.latinum - cash0);
      out.menuFar = (t.deliverContractCargo(), s.latinum - cash0);
      t.setCamera(planet.x + t.CARGO_TRANSPORT_RANGE - 50, planet.y);
      t.openTopLeftTab('contracts');
      document.querySelector('[data-cargo-drop]')?.click();
      out.first = s.latinum - cash0;
      t.openTopLeftTab('inventory');
      document.querySelector('[data-cargo-drop]')?.click();
      t.deliverContractCargo();
      t.tick(0);
      out.total = s.latinum - cash0;
      out.contracts = t.getOpenContracts().length;
      return out;
    });
    assert.deepEqual([r.inventoryFar, r.contractsFar, r.menuFar], [0, 0, 0], 'a control delivered from beyond transporter range');
    assert.equal(r.first, 500);
    assert.equal(r.total, 500, `payment was duplicated: ${r.total}`);
    assert.equal(r.contracts, 0);
  });

  // ------------------------------------------------------------ rendering
  await check('preservation', 'RENDER-RESIZE the chart canvas is resized only when the view or density changes, and the rails are not rebuilt every frame', async () => {
    await page.setViewportSize({ width: 1920, height: 1080 });
    await page.waitForFunction(() => document.getElementById('game').width === 1920);
    await fresh('render-resize');
    const r = await ev(() => {
      const t = testBM1;
      t.openMap();
      t.drawInterstellarMapOverlay();
      const c = document.getElementById('interstellar-map-canvas');
      let sets = 0;
      const obs = new MutationObserver((m) => { sets += m.filter((x) => x.attributeName === 'width' || x.attributeName === 'height').length; });
      obs.observe(c, { attributes: true });
      const railNode = document.querySelector('#map-rail-left [data-map-overlay]');
      for (let i = 0; i < 60; i++) t.drawInterstellarMapOverlay();
      return new Promise((res) => setTimeout(() => { obs.disconnect(); res({ sets, sameNode: railNode === document.querySelector('#map-rail-left [data-map-overlay]'), backing: c.width }); }, 50));
    });
    assert.equal(r.sets, 0, `the canvas was resized ${r.sets} times in 60 frames with nothing changed`);
    assert.equal(r.sameNode, true, 'the rail buttons were rebuilt between frames');
    await ev(() => { const c = document.getElementById('interstellar-map-canvas'); window.__sets = 0; window.__obs = new MutationObserver((m) => { window.__sets += m.filter((x) => x.attributeName === 'width').length; }); window.__obs.observe(c, { attributes: true }); });
    await page.setViewportSize({ width: 1600, height: 1000 });
    await page.waitForFunction(() => document.getElementById('game').width === 1600);
    const after = await ev(() => new Promise((res) => { for (let i = 0; i < 30; i++) testBM1.drawInterstellarMapOverlay(); setTimeout(() => { window.__obs.disconnect(); res({ sets: window.__sets, backing: document.getElementById('interstellar-map-canvas').width }); }, 50); }));
    assert.equal(after.backing, 3200);
    assert.equal(after.sets, 1, `a viewport change resized the canvas width ${after.sets} times`);
    await ev(() => testBM1.closeMap());
  });

  await check('new-feature', 'MAP-NARROW below the rail width the same DOM panel sits over the chart edge, readable, with working toggles and a pannable chart', async () => {
    await page.setViewportSize({ width: 800, height: 600 });
    await page.waitForFunction(() => document.getElementById('game').width === 800);
    await fresh('map-narrow');
    const r = await ev(() => {
      const t = testBM1, s = t.state;
      s.selectedPlanet = s.planets.findIndex((p, i) => i !== Number(s.currentPlanet) && t.isChartSystemVisible(i));
      t.openMap();
      t.drawInterstellarMapOverlay();
      const L = t.getStarChartLayout();
      const panel = t.getStarChartPanelRect();
      const rail = document.getElementById('map-rail-right');
      const b = rail.getBoundingClientRect();
      const sizes = [...rail.querySelectorAll('[data-map-line]')].filter((e) => e.offsetParent).map((e) => parseFloat(getComputedStyle(e).fontSize));
      return { mode: L.mode, chart: L.chart, rail: { left: b.left, right: b.right, top: b.top, bottom: b.bottom }, panel, visible: !rail.classList.contains('hidden'), minSize: Math.min(...sizes), lines: sizes.length, toggles: rail.querySelectorAll('[data-map-overlay]').length, zoom: s.starChart.zoom };
    });
    assert.equal(r.mode, 'overlay', `at 800x600 the layout is "${r.mode}"`);
    assert.ok(r.visible, 'no panel');
    assert.ok(r.rail.right <= r.panel.right + 1 && r.rail.left >= r.panel.left, `the panel is outside the chart window: ${JSON.stringify(r.rail)}`);
    assert.ok(r.lines >= 7 && r.minSize >= 13, `narrow panel text: ${r.lines} lines, smallest ${r.minSize}px`);
    assert.equal(r.toggles, 6); // + Evacuations & blockades (EVACUATION-BLOCKADE-RULES)
    const at = await ev(() => { const t = testBM1; const p = t.mapOverlayLegendRowPoint('cargo'); return { ...p, before: t.mapOverlayState().cargo }; });
    await page.mouse.click(at.x, at.y);
    assert.notEqual(await ev(() => testBM1.mapOverlayState().cargo), at.before, 'the toggle did not work');
    const cx = r.chart.left + 60, cy = (r.chart.top + r.chart.bottom) / 2;
    await page.mouse.move(cx, cy);
    await page.mouse.wheel(0, -300);
    assert.ok(await ev(() => testBM1.state.starChart.zoom) > r.zoom, 'the uncovered chart does not zoom');
    await page.screenshot({ path: path.join(out, 'map-800x600-narrow.png') });
    await ev(() => testBM1.closeMap());
    await page.setViewportSize({ width: 1280, height: 800 });
  });

  // ------------------------------------------------------------ summary
  const byCategory = {};
  for (const x of results) { (byCategory[x.category] ||= { pass: 0, fail: 0 }); byCategory[x.category][x.ok ? 'pass' : 'fail']++; }
  console.log(`\n${results.filter((x) => x.ok).length}/${results.length} checks pass.`);
  for (const [k, v] of Object.entries(byCategory)) console.log(`  ${k}: ${v.pass} pass, ${v.fail} fail`);
  for (const f of results.filter((x) => !x.ok)) console.log(`  - [${f.category}] ${f.name}: ${f.message}`);
  if (results.some((x) => !x.ok)) process.exitCode = 1;
  if (errors.length) { console.log(`page errors: ${errors.join(' | ')}`); process.exitCode = 1; }
  await Promise.race([probe.close(), new Promise((r) => setTimeout(r, 15000))]);
  process.exit(process.exitCode || 0);
})().catch((e) => { console.error(e); process.exit(1); });
