// Adversarial gate for the playtest candidate on top of ae4ae4d: what the captain is told about a
// power they have not met, what an uninhabited world may sell them, and what the HUD does at the
// widths they actually play at.
//
// Same discipline as the blocker suites: every check reproduces a reported wrong behaviour and is
// written to fail on ae4ae4d. Nothing here asserts that a feature exists.
const assert = require('node:assert/strict');
const { startProbe } = require('./probe-harness.cjs');

(async () => {
  const probe = await startProbe();
  const { ev, fresh, page, errors } = probe;
  let checks = 0;
  const failures = [];
  async function check(name, fn) {
    checks++;
    try { await fn(); console.log('PASS', name); }
    catch (err) { failures.push({ name, message: String(err?.message || err) }); console.log('FAIL', name, '\n      ', String(err?.message || err).split('\n')[0]); }
  }


  // Fleet trading: a trader, a purse, and a set of worlds whose boards and conditions the captain has
  // actually read. Everything the planner is allowed to use is put here deliberately; nothing else is.
  await page.evaluate(() => {
    window.__tradeSetup = (opts) => {
      const t = testBM1, s = t.state;
      const o = opts || {};
      s.latinum = o.latinum ?? 100000; s.mylatinum = s.latinum; s.day = o.day ?? 10;
      s.playerFleet.length = 0;
      const home = s.currentPlanet;
      const learn = o.learn ?? Math.min(24, s.planets.length);
      const learned = [];
      for (let i = 0; i < learn; i++) {
        s.currentPlanet = i;
        t.markSystemVisited(i);
        if (typeof t.recordMarketObservation === 'function') t.recordMarketObservation(i);
        learned.push(i);
      }
      s.currentPlanet = home;
      return { home, learned };
    };
    window.__tradeShip = (id, opts) => {
      const t = testBM1, s = t.state;
      const o = opts || {};
      const ships = Object.values(s.shipStatsById).filter((x) => x && x.assetType === 'ship' && Number(x.cargoCapacity) > 0);
      ships.sort((a, b) => Number(a.cargoCapacity) - Number(b.cargoCapacity));
      const pick = o.big ? ships[ships.length - 1]
        : o.hold ? (ships.find((x) => Number(x.cargoCapacity) >= o.hold) || ships[0])
        : ships[Math.floor(ships.length / 2)];
      const f = { id, shipId: Number(o.shipId ?? pick.id), name: o.name || id, faction: s.playerFaction,
        assignment: 'defense', systemIndex: o.at ?? s.currentPlanet, seed: o.seed ?? 3 };
      s.playerFleet.push(f);
      t.autoAssignFleet(f);
      return { id, shipId: f.shipId, capacity: Number(t.getShipStats(f.shipId).cargoCapacity) || 0 };
    };
    // Put the captain alongside the world and docked, so the ordinary market and contract paths run
    // rather than refusing for range. Nothing here bypasses a refusal that is about standing.
    window.__dock = () => {
      const t = testBM1, s = t.state;
      t.applySystemState(s.currentPlanet);
      if (!s.systemPlanet) s.systemPlanet = { x: 0, y: 0, name: s.planets[s.currentPlanet]?.name };
      t.setCamera(s.systemPlanet.x, s.systemPlanet.y);
      s.docked = true;
      s.dockedPlanetIndex = s.currentPlanet;
      s.dockedStationId = null;
      return { block: t.commodityTradeBlock(), offers: t.currentMarketOffers().length,
        connected: !t.commodityTradeBlock() };
    };
    window.__tradeDays = (n) => {
      const t = testBM1, s = t.state;
      for (let i = 0; i < n; i++) {
        s.day += 1;
        t.completeFleetJourneys();
        // The calendar acknowledges queued orders after the day's arrivals and before the traders move.
        if (typeof t.acknowledgeCampaignOrders === 'function') t.acknowledgeCampaignOrders();
        if (typeof t.advanceFleetTrading === 'function') t.advanceFleetTrading(s.day);
      }
    };
  });
  await page.evaluate(() => {
    window.__panelHtml = (tab) => { testBM1.openCampaignPanel(tab); const html = document.getElementById('campaign-panel').innerHTML; testBM1.closeCampaignPanel(); return html; };
    // The gate works out for itself which worlds belong to the hidden region, from the authored name
    // list, so a tree that has no notion of contact still fails on what its panel says.
    window.__coreSystems = () => {
      const t = testBM1, s = t.state;
      return (s.planets || []).map((p, i) => i).filter((i) => t.isDominionCoreSystem?.(s.planets[i]?.name));
    };
  });

  // DOM-1 — the Empire panel listed the Dominion, with a strength band read off its true readiness, on
  // a fresh start where every world it holds is off the chart and nothing has reported it.
  await check('DOM a power whose whole territory is off the chart is not on the captain\'s board', async () => {
    await fresh('play-dom1');
    const r = await ev(() => {
      const t = testBM1, s = t.state;
      const core = window.__coreSystems();
      const world = t.buildCampaignWorld(true);
      const html = window.__panelHtml('powers');
      const rows = [...html.matchAll(/<tr><td>([^<]*)<\/td>/g)].map((m) => m[1]);
      const reports = t.galaxyNewsBook().items.filter((x) => (x.factions || []).includes('dominion')).map((x) => x.text);
      return { core: core.length,
        coreCharted: core.filter((i) => t.isChartSystemVisible(i)).length,
        hulls: (t.campaign().polities.dominion?.hulls || []).length,
        strength: Math.round(t.Campaign.polityReadiness(t.campaign(), world, 'dominion').strength),
        rows, mentionsDominion: /Dominion/.test(html), reports };
    });
    assert.ok(r.core >= 2, `precondition: the galaxy has a hidden region (${r.core} systems)`);
    assert.equal(r.coreCharted, 0, 'precondition: none of it is charted at a fresh start');
    assert.ok(r.hulls > 0 && r.strength > 0, `precondition: the power behind it is real (${r.hulls} hulls, strength ${r.strength})`);
    assert.equal(r.rows.includes('Dominion'), false, `the Other Powers table listed a power the captain has never met: ${r.rows.join(', ')}`);
    assert.equal(r.mentionsDominion, false, 'and the panel named it elsewhere');
    assert.deepEqual(r.reports, [], 'a public diplomatic report named a power the captain cannot know exists');
  });

  // DOM-2 — charting one world of a hidden region put the whole region on the map, and the estimate
  // went straight back to reading the power's true readiness across all of it.
  await check('DOM charting one hidden world does not count the rest of the region', async () => {
    await fresh('play-dom2');
    const r = await ev(() => {
      const t = testBM1, s = t.state, book = t.campaign();
      const core = window.__coreSystems();
      if (core.length < 2) return { fail: 'the galaxy has no hidden region to chart' };
      const [seen, unseen] = core;
      // The captain flies there and looks at it.
      t.markSystemVisited(seen);
      s.currentPlanet = seen; s.myplanet = seen + 1; s.warp.active = false;
      t.buildCampaignWorld(true);
      const read = () => { book.assessments = {}; const a = t.campaignAssessment('dominion'); return { worlds: a.estimate.worlds, strength: a.estimate.strength, atLeast: Boolean(a.estimate.atLeast), confidence: a.estimate.confidence }; };
      const first = read();
      const html = window.__panelHtml('powers');
      const truth = Math.round(t.Campaign.polityReadiness(book, t.buildCampaignWorld(true), 'dominion').strength);
      // More warships appear at a world the captain is NOT looking at.
      const pool = book.polities.dominion.hulls;
      const donor = pool.find((h) => Number(h.systemIndex) !== seen);
      for (let n = 0; n < 12; n++) pool.push({ ...donor, id: `extra-hidden-${n}`, systemIndex: unseen, status: 'ready' });
      s.day += 1; t.buildCampaignWorld(true);
      const afterHidden = read();
      // And then at the one they are standing in.
      for (let n = 0; n < 12; n++) pool.push({ ...donor, id: `extra-seen-${n}`, systemIndex: seen, status: 'ready' });
      s.day += 1; t.buildCampaignWorld(true);
      const afterSeen = read();
      return { fail: null, seen, unseen, first, afterHidden, afterSeen, truth,
        coreCharted: core.filter((i) => t.isChartSystemVisible(i)).length, core: core.length,
        listed: /<tr><td>Dominion<\/td>/.test(html), atLeastShown: /at least/.test(html), lowShown: /low confidence/.test(html) };
    });
    assert.ok(!r.fail, `the charting reproduction could not be set up: ${r.fail}`);
    assert.equal(r.listed, true, 'a power the captain has now charted ground of should appear');
    assert.equal(r.coreCharted, r.core, 'precondition: visiting one core world charts the region on the map');
    assert.equal(r.first.atLeast, true, 'the estimate presented a total rather than a floor');
    assert.equal(r.atLeastShown, true, 'and the table did not say it was a floor');
    assert.equal(r.first.confidence, 'low', 'an estimate from one observed world was not marked low confidence');
    assert.equal(r.lowShown, true, 'and the table did not say so');
    assert.equal(r.first.worlds, 1, `the captain has seen one of its worlds, not ${r.first.worlds}`);
    assert.ok(r.first.strength < r.truth, `the estimate (${r.first.strength}) is its whole true readiness (${r.truth})`);
    assert.equal(r.afterHidden.strength, r.first.strength,
      `warships that appeared at an unobserved world moved the estimate from ${r.first.strength} to ${r.afterHidden.strength}`);
    assert.ok(r.afterSeen.strength > r.first.strength,
      `warships that appeared at the world the captain is standing in did not move the estimate (${r.afterSeen.strength})`);
  });

  // DOM-3 — an expedition that took a near-side world made the Dominion an ordinary neighbour, and the
  // war-exhaustion roll signed a public peace with a power the captain had never met.
  await check('DOM the campaign\'s war is not settled by the neighbour roll', async () => {
    await fresh('play-dom3');
    const r = await ev(() => {
      const t = testBM1, s = t.state;
      if (typeof t.isDominionCoreSystem !== 'function') return { fail: 'this tree draws no line between the far side of the wormhole and the rest of the galaxy, so there is no near side for the expedition to cross into' };
      const world = t.buildCampaignWorld(true);
      const here = Number(s.currentPlanet);
      // The expedition takes a world on this side of the wormhole.
      const target = world.systems.findIndex((sys, i) => i !== here && sys.controller && sys.controller !== 'player'
        && !t.isDominionCoreSystem(s.planets[i]?.name));
      if (target < 0) return { fail: 'no near-side world was available to take' };
      t.transferSystemControlToFaction(target, 'dominion');
      t.buildCampaignWorld(true);
      const neighbours = (s.travelRoutes || []).filter((r) => r.from === target || r.to === target).length;
      const pairs = t.diplomaticPairs().map((p) => p.join(':'));
      return { fail: null, target, neighbours, pairs, dominionPairs: pairs.filter((k) => k.includes('dominion')) };
    });
    assert.ok(!r.fail, `the expedition reproduction could not be set up: ${r.fail}`);
    assert.ok(r.neighbours > 0, `precondition: the taken world borders somebody (${r.neighbours} routes)`);
    assert.ok(r.pairs.length > 0, 'precondition: the ordinary roll has pairs to work on');
    assert.deepEqual(r.dominionPairs, [],
      `the campaign's war was handed to the neighbour roll as ${r.dominionPairs.join(', ')}`);
  });

  // REM — the Blender remnant is a power in its own right: Jem'Hadar hulls and an outpost of its own,
  // at war with Earth and Romulus and nobody else, and not the Dominion beyond the wormhole. Before
  // this it did not exist at all; Blender was an empty neutral system and the only Dominion in the
  // game was the one the captain must not be told about.
  await check('REM the Blender remnant exists, flies Dominion hulls, and is not Dominion Central', async () => {
    await fresh('play-rem');
    const r = await ev(() => {
      const t = testBM1, s = t.state, book = t.campaign();
      if (typeof t.campaignPowerContact !== 'function') return { fail: 'this tree has no notion of a power coming to the captain\'s attention, so there is nothing for a remnant to be' };
      const blender = t.getSystemIndexByName('Blender');
      if (blender < 0) return { fail: 'the galaxy has no Blender' };
      const world = t.buildCampaignWorld(true);
      const rem = book.polities.dominion_remnant || null;
      const garrison = world.stationsBySystem(blender).filter((x) => x.owner === 'dominion_remnant');
      const hulls = (rem?.hulls || []);
      return { fail: null, blender,
        name: t.formatFaction('dominion_remnant'),
        controller: world.systems[blender].controller,
        garrison: garrison.map((x) => ({ name: x.name, status: x.cap?.status })),
        hulls: hulls.length,
        atBlender: hulls.every((h) => Number(h.systemIndex) === blender),
        dominionHulled: hulls.every((h) => t.getShipFaction(Number(h.shipId)) === 'dominion'),
        vsTerran: t.worldRelation('terran', 'dominion_remnant').status,
        vsRomulan: t.worldRelation('romulan', 'dominion_remnant').status,
        vsKlingon: t.worldRelation('klingon', 'dominion_remnant').status,
        vsCentral: t.worldRelation('dominion', 'dominion_remnant').status,
        centralHulls: (book.polities.dominion?.hulls || []).length,
        sharedHulls: (book.polities.dominion?.hulls || []).some((h) => hulls.some((x) => x.id === h.id)),
        contactBefore: t.campaignPowerContact('dominion_remnant'),
        contactAfter: (() => { t.markSystemVisited(blender); t.buildCampaignWorld(true); return t.campaignPowerContact('dominion_remnant'); })(),
        centralContact: t.campaignPowerContact('dominion') };
    });
    assert.ok(!r.fail, `the remnant reproduction could not be set up: ${r.fail}`);
    assert.equal(r.name, 'Blender Remnant', `it is named "${r.name}" rather than for the place it holds`);
    assert.ok(r.garrison.length >= 1, 'the remnant holds no installation at Blender');
    assert.equal(r.garrison[0].status, 'operational', `its outpost is ${r.garrison[0].status}`);
    assert.ok(r.hulls >= 3, `the remnant has ${r.hulls} hulls; a garrison that cannot raid is not a presence`);
    assert.equal(r.atBlender, true, 'its hulls are not all at Blender');
    assert.equal(r.dominionHulled, true, 'its hulls are not Dominion ships');
    assert.equal(r.controller, null, 'precondition: it holds an outpost in an independent system, it does not rule the world');
    assert.equal(r.vsTerran, 'war', 'it is not at war with Earth');
    assert.equal(r.vsRomulan, 'war', 'it is not at war with Romulus');
    assert.equal(r.vsKlingon, 'peace', 'it is at war with somebody it has no quarrel with');
    assert.equal(r.sharedHulls, false, 'the remnant and Dominion Central share hulls: they are one polity');
    assert.ok(r.centralHulls > 0, 'precondition: Dominion Central still exists separately');
    assert.equal(r.contactBefore, false, 'a garrison in a system the captain has never been to is already on their board');
    assert.equal(r.contactAfter, true, 'and going there does not put it on their board');
    assert.equal(r.centralContact, false, 'meeting the remnant revealed Dominion Central');
  });

  // REM-2 — the remnant is meant to be the player's first and only sight of the Dominion until they go
  // through the wormhole, so the two Jem'Hadar designs are the whole of what it may put on the board.
  // A garrison drawing from the parent culture's pool spoils the battleship, the cruiser, the scout and
  // the freighter years early, and it did: the opening four included a Dominion Battleship and a Scout.
  await check('REM the remnant flies two Jem\'Hadar designs and never the rest of the Dominion', async () => {
    await fresh('play-rem-designs');
    const r = await ev(() => {
      const t = testBM1, book = t.campaign();
      const rem = book.polities.dominion_remnant || null;
      if (!rem) return { fail: 'there is no Blender remnant to draw hulls for' };
      const world = t.buildCampaignWorld(true);
      const nameOf = (id) => t.getShipStats(Number(id))?.name || `#${id}`;
      const uniq = (a) => [...new Set(a.filter((x) => Number.isFinite(x)))];
      // Every path by which a hull reaches the board under its flag: the campaign's own draw, and the
      // spawner every patrol, escort and raid goes through.
      const draws = [];
      for (let i = 0; i < 200; i++) { const id = world.pickHull('dominion_remnant', i / 200); if (id != null) draws.push(Number(id)); }
      const spawns = [];
      for (let i = 1; i <= 100; i++) for (const role of ['patrol', 'fleetAttack', 'traffic', 'escort']) {
        const id = t.getNpcShipIdForFaction ? t.getNpcShipIdForFaction('dominion_remnant', i, role) : null;
        if (id != null) spawns.push(Number(id));
      }
      const central = [];
      for (let i = 0; i < 200; i++) { const id = world.pickHull('dominion', i / 200); if (id != null) central.push(Number(id)); }
      const garrison = rem.hulls.map((h) => Number(h.shipId));
      return { fail: null, spawnPaths: spawns.length,
        garrison: uniq(garrison).map(nameOf), draws: uniq(draws).map(nameOf),
        spawns: uniq(spawns).map(nameOf), central: uniq(central).map(nameOf),
        flown: uniq([...garrison, ...draws, ...spawns]).map(nameOf) };
    });
    assert.ok(!r.fail, `the design reproduction could not be set up: ${r.fail}`);
    const allowed = ["Jem'Hadar Attack Ship", "Jem'Hadar Battlecruiser"];
    const stray = (list) => list.filter((n) => !allowed.includes(n));
    assert.ok(r.spawnPaths > 0, 'precondition: the spawner answers for this faction at all');
    assert.deepEqual(stray(r.garrison), [], `the opening garrison fields ${stray(r.garrison).join(', ')}`);
    assert.deepEqual(stray(r.draws), [], `a campaign hull draw for the remnant returned ${stray(r.draws).join(', ')}`);
    assert.deepEqual(stray(r.spawns), [], `a patrol or raid spawn under the remnant flag returned ${stray(r.spawns).join(', ')}`);
    assert.equal(r.flown.length, 2, `the remnant flies ${r.flown.length} designs: ${r.flown.join(', ')}`);
    assert.ok(stray(r.central).length > 0,
      'the Dominion beyond the wormhole now draws from the same two designs: the restriction belongs to the remnant, not to the catalogue');
  });

  // REM-3 — a power with no world earns nothing, and the opening pass gave this one hulls with an
  // upkeep bill and no way to pay it: it ran its treasury down and a hull lost to a raid was gone for
  // good. A garrison the player is meant to keep meeting has to be able to stand where it stands.
  await check('REM the remnant pays for itself and makes good a loss while it holds its outpost', async () => {
    await fresh('play-rem-economy');
    const r = await ev(() => {
      const t = testBM1, s = t.state, book = t.campaign();
      const rem = book.polities.dominion_remnant || null;
      if (!rem) return { fail: 'there is no Blender remnant to keep standing' };
      const blender = t.getSystemIndexByName('Blender');
      const world = t.buildCampaignWorld(true);
      const live = () => rem.hulls.filter((h) => h.status !== 'lost');
      const snap = () => ({ treasury: Math.round(rem.treasury), hulls: live().length, supply: rem.supply, rebuilt: rem.garrisonRebuiltDay ?? null });
      const day0 = s.day;
      const worlds = world.systems.filter((sys) => sys.controller === 'dominion_remnant').length;
      const start = snap();
      // A quiet year on station: upkeep is paid every single day.
      t.advanceCampaign(day0 + 200);
      const sustained = snap();
      // Two hulls are lost the way raiding loses them.
      for (const h of live().slice(0, 2)) h.status = 'lost';
      const afterLoss = snap();
      t.advanceCampaign(day0 + 600);
      const rebuilt = snap();
      // Now the outpost itself is taken out from under it.
      const def = (s.stationDefinitions || []).find((d) => Number(d.systemIndex) === blender && t.getStationOwner(d, blender) === 'dominion_remnant');
      if (!def) return { fail: 'the remnant holds no station at Blender to lose' };
      t.destroyStation(def);
      t.buildCampaignWorld(true);
      for (const h of live().slice(0, 1)) h.status = 'lost';
      const beforeSiege = snap();
      t.advanceCampaign(day0 + 1200);
      const sieged = snap();
      return { fail: null, worlds, want: book.config.openingGarrisons?.dominion_remnant?.hulls ?? 0,
        start, sustained, afterLoss, rebuilt, beforeSiege, sieged };
    });
    assert.ok(!r.fail, `the economy reproduction could not be set up: ${r.fail}`);
    assert.equal(r.worlds, 0, 'precondition: it rules no world, so nothing but its outpost can pay it');
    assert.ok(r.sustained.treasury > r.start.treasury,
      `200 days on station took its treasury from ${r.start.treasury} to ${r.sustained.treasury}: it cannot pay its own upkeep`);
    assert.ok(r.sustained.supply > 0.35,
      `a garrison holding a live outpost runs at the no-supply floor (${r.sustained.supply})`);
    assert.ok(r.rebuilt.hulls > r.afterLoss.hulls,
      `it lost two hulls and 400 days later still has ${r.rebuilt.hulls}: a loss is permanent`);
    assert.ok(r.rebuilt.hulls <= r.want,
      `it rebuilt past its authored strength: ${r.rebuilt.hulls} hulls against ${r.want}`);
    assert.ok(r.rebuilt.rebuilt != null && r.rebuilt.rebuilt > r.afterLoss.rebuilt,
      'no replacement was ever raised at the outpost');
    assert.equal(r.sieged.rebuilt, r.beforeSiege.rebuilt,
      'it made good a hull after its outpost was destroyed: the yard is not the outpost');
    assert.ok(r.sieged.treasury < r.beforeSiege.treasury,
      `it kept drawing an income with no outpost left (${r.beforeSiege.treasury} to ${r.sieged.treasury})`);
  });

  // HAIL — a station could be selected as a target but not hailed: the hail button and the H key both
  // answered "No ship selected to hail", so the only ways into a station's channel were the COMMS list
  // and docking. The captain's report was that stations cannot be hailed unless docked.
  await check('HAIL a selected station can be hailed without docking', async () => {
    await fresh('play-hail');
    const r = await ev(() => {
      const t = testBM1, s = t.state;
      const station = s.stations.find((x) => !x.destroyed && !x.underConstruction);
      if (!station) return { fail: 'this system has no station to hail' };
      t.setCamera(station.x - 300, station.y);
      s.docked = false; s.dockedStationId = null; s.remoteStationId = null; s.planetMenuOpen = false;
      // The captain selects the station the way Tab selects it, and presses the hail button.
      s.combatTargetType = 'station'; s.combatTargetId = station.id; s.log = '';
      document.querySelector('[data-dock-action="hail"]')?.click();
      const hailed = { log: s.log, remote: s.remoteStationId, menu: s.planetMenuOpen, docked: s.docked };
      // And with nothing selected at all, the hail key opens the system's channels rather than refusing.
      document.getElementById('station-comms')?.close();
      s.combatTargetId = null; s.combatTargetType = 'ship'; s.remoteStationId = null; s.planetMenuOpen = false; s.log = '';
      document.querySelector('[data-dock-action="hail"]')?.click();
      const listed = { log: s.log, commsOpen: document.getElementById('station-comms')?.open || false };
      document.getElementById('station-comms')?.close();
      // A ship hail still behaves exactly as it did.
      const npc = (s.npcShips || []).find((n) => !n.destroyed);
      let ship = { skipped: true };
      if (npc) {
        t.setCamera(npc.x - 100, npc.y);
        s.combatTargetType = 'ship'; s.combatTargetId = npc.id; s.log = '';
        document.querySelector('[data-dock-action="hail"]')?.click();
        ship = { skipped: false, log: s.log, session: Boolean(npc.hailSession) };
      }
      return { fail: null, station: station.name, hailed, listed, ship };
    });
    assert.ok(!r.fail, `the hail reproduction could not be set up: ${r.fail}`);
    assert.equal(r.hailed.docked, false, 'precondition: the captain is flying, not docked');
    assert.ok(!/No ship selected/i.test(r.hailed.log),
      `hailing a selected station answered: ${r.hailed.log}`);
    assert.ok(r.hailed.remote, `hailing ${r.station} opened no channel to it (${r.hailed.log})`);
    assert.equal(r.hailed.menu, true, 'the channel opened but its services were not shown');
    assert.equal(r.listed.commsOpen, true,
      `with nothing selected the hail control refused instead of opening the system's channels: ${r.listed.log}`);
    if (!r.ship.skipped) assert.equal(r.ship.session, true, `hailing a ship stopped working: ${r.ship.log}`);
  });

  // DOM-4 — days pass only when the captain warps, and the expedition arc ran on 25/45/60: the first
  // Dominion warning arrived inside the opening hour of play and the invasion landed before a captain
  // had a second ship. The 17SEP specification goes further than "make the dates later": the entry has
  // to emerge from the state of the near side, so there must be no invasion date at all.
  await check('DOM the expedition has no date, and sixty warp-days of play does not start it', async () => {
    await fresh('play-dom4');
    const r = await ev(() => {
      const t = testBM1, s = t.state, book = t.campaign();
      if (typeof t.Campaign.dominionOpportunity !== 'function') {
        const dated = ['dominionReconDay', 'dominionStagingDay', 'dominionInvasionDay'].filter((k) => book.config[k] !== undefined);
        return { fail: `this tree has no entry decision to ask: the expedition runs on ${dated.join(', ') || 'a schedule'}` };
      }
      const start = s.day;
      const step = (days) => { let left = days; while (left > 0) { const n = Math.min(10, left); t.advanceFleetCalendar(n, t.Fleet.nextId(t.fleetBook(), 'journey')); left -= n; } };
      step(60);
      const o = t.Campaign.dominionOpportunity(book, t.buildCampaignWorld(true), s.day);
      return { days: s.day - start, phase: book.dominion.phase, warnings: book.dominion.warnings.length,
        dated: ['dominionReconDay', 'dominionStagingDay', 'dominionInvasionDay'].filter((k) => book.config[k] !== undefined),
        open: o.open, reason: o.reasons[0] || '', engagements: o.engagements,
        inputs: ['engagements', 'balance', 'corridorOpen', 'challengeable', 'defenders'].filter((k) => !(k in o)) };
    });
    assert.ok(!r.fail, `the entry-decision reproduction could not be set up: ${r.fail}`);
    assert.equal(r.days, 60, 'precondition: sixty campaign days actually passed');
    assert.deepEqual(r.dated, [],
      `the expedition still runs on a date: ${r.dated.join(', ')}`);
    assert.equal(r.phase, 'dormant', `sixty warp-days in, the expedition is already at "${r.phase}"`);
    assert.equal(r.warnings, 0, 'and the captain has already been warned about it');
    assert.equal(r.open, false, 'sixty days of trading produced a strategic opening');
    assert.match(r.reason, /engagement|capacity|balance|corridor|front/,
      `the reason it gave was "${r.reason}" rather than anything about the near side`);
    assert.deepEqual(r.inputs, [], `the entry decision does not report ${r.inputs.join(', ')}`);
  });

  // DOM-6 — one qualifying warp carried missing patrols, staging signatures and the crossing itself into
  // the same mid-jump briefing. The captain had no opportunity between the stages to investigate, warn
  // anybody, fortify the entry or change sides: the whole arc happened while they were asleep at warp.
  await check('DOM a single long jump cannot carry the whole expedition arc past the captain', async () => {
    await fresh('play-dom6');
    const r = await ev(() => {
      const t = testBM1, s = t.state, book = t.campaign();
      // Every stage eligible, no dwell between them: the only thing left to separate them is the rule
      // that a stage must reach the captain before the next one commits.
      Object.assign(book.config, { dominionMinCentralEngagements: 0, dominionDefenderWeakness: 1.1,
        dominionEconomicStrain: 1.1, dominionStalemateBand: 1, dominionFrontStallRatio: 1e6,
        dominionChallengeRatio: 1e6, dominionCorridorCloseRatio: 1e6, dominionMinPlayerCategories: 0,
        dominionOpeningWindowDays: 1, dominionOpeningSustainDays: 1,
        dominionReconDwellDays: 0, dominionStagingDwellDays: 0 });
      const jump = (days) => {
        const before = { phase: book.dominion.phase, warnings: book.dominion.warnings.length };
        t.advanceFleetCalendar(days, t.Fleet.nextId(t.fleetBook(), 'journey'));
        return { from: before.phase, to: book.dominion.phase, newWarnings: book.dominion.warnings.length - before.warnings,
          beat: book.dominion.lastPhaseBeat || null };
      };
      const jumps = [jump(200), jump(200), jump(200), jump(200)];
      return { jumps, phase: book.dominion.phase, day: s.day,
        beats: new Set(jumps.map((j) => j.beat).filter(Boolean)).size };
    });
    const steps = r.jumps.map((j) => `${j.from}->${j.to}`);
    assert.equal(r.jumps[0].to, 'reconnaissance',
      `one two-hundred-day jump took the expedition ${steps[0]}`);
    for (const j of r.jumps) assert.ok(j.newWarnings <= 1,
      `one jump delivered ${j.newWarnings} Dominion warnings into the same briefing`);
    assert.deepEqual(steps, ['dormant->reconnaissance', 'reconnaissance->staging', 'staging->invasion', 'invasion->invasion'],
      `the arc advanced ${steps.join(', ')} rather than one stage per journey`);
    assert.equal(r.beats, 3, 'the stages did not each commit on a beat of their own');
  });

  // DOM-7 — the pacing gate that replaced the calendar floor was a single additive counter, and every
  // press of "request contract" incremented it. Fifty-nine presses at one station, with no travel and
  // no time passing, satisfied the whole thing: the replacement for a calendar floor could be completed
  // by cycling a menu in one sitting.
  await check('DOM the maturity gate cannot be satisfied by cycling one menu', async () => {
    await fresh('play-dom7');
    const r = await ev(() => {
      const t = testBM1, s = t.state, book = t.campaign();
      if (!book.config.dominionPlayerBeats) return { fail: 'this tree has no maturity gate: nothing counts what the captain has been offered' };
      const world = () => t.buildCampaignWorld(true);
      const read = () => {
        const o = world().playerOpportunity || {};
        return { ...o, sum: Object.values(o).reduce((n, v) => n + (Number(v) || 0), 0) };
      };
      const before = read();
      // The captain stands at one station and asks for work, over and over. Nothing else happens: no
      // warp, no docking anywhere else, no day passes.
      const day = s.day;
      let presses = 0;
      for (let i = 0; i < 200; i++) { t.negotiateContract(); presses++; }
      const after = read();
      const beats = book.config.dominionPlayerBeats;
      const kinds = Object.keys(beats).filter((k) => (Number(after[k]) || 0) >= beats[k]);
      return { presses, before, after, dayMoved: s.day !== day,
        beats, kindsMet: kinds, needKinds: book.config.dominionMinPlayerCategories,
        systems: (s.visitedSystems || []).length };
    });
    assert.ok(!r.fail, `the maturity reproduction could not be set up: ${r.fail}`);
    assert.equal(r.dayMoved, false, 'precondition: no campaign day passed while the menu was cycled');
    assert.ok(r.presses >= 100, `precondition: the menu was actually cycled (${r.presses} presses)`);
    assert.ok(r.after.sum - r.before.sum <= 2,
      `${r.presses} presses at one station moved the maturity counts by ${r.after.sum - r.before.sum}`);
    assert.ok(r.kindsMet.length < r.needKinds,
      `cycling one menu satisfied ${r.kindsMet.length} of ${r.needKinds} kinds of chance: ${r.kindsMet.join(', ')}`);
    assert.ok(!r.kindsMet.includes('issuers'),
      'repeated offers from the same station counted as distinct issuers');
  });

  // DOM-8 — the journeys category counted calls to the calendar wrapper rather than journeys the fleet
  // ledger accepted. One ordinary warp calls it twice with the same persisted id — once when the
  // mid-jump briefing opens, once on arrival — and the second call correctly advances nothing and
  // charges nothing, but the counter had already moved. Thirteen warps recorded twenty-six journeys and
  // passed a threshold of twenty-five, halving the travel the pacing gate was meant to require. A
  // zero-day call counted as a journey too.
  await check('DOM a journey is counted when the ledger accepts it, once, and never for a zero-day call', async () => {
    await fresh('play-dom8');
    const r = await ev(() => {
      const t = testBM1, s = t.state;
      if (!t.buildCampaignWorld(true).playerOpportunity) return { fail: 'this tree counts no journeys: the campaign is never told what the captain has done' };
      const count = () => Number((t.buildCampaignWorld(true).playerOpportunity || {}).journeys) || 0;
      const start = count();

      // One journey id, presented twice, exactly as a warp presents it.
      const id = t.Fleet.nextId(t.fleetBook(), 'journey');
      const firstOk = t.advanceFleetCalendar(3, id);
      const afterFirst = count();
      const secondOk = t.advanceFleetCalendar(3, id);
      const afterSecond = count();

      // A zero-day call with a fresh id: the reload path makes one of these.
      const zeroOk = t.advanceFleetCalendar(0, t.Fleet.nextId(t.fleetBook(), 'journey'));
      const afterZero = count();

      // And thirteen ordinary warps, each presented the way the engine presents one.
      const dayBefore = s.day;
      for (let i = 0; i < 13; i++) {
        const jid = t.Fleet.nextId(t.fleetBook(), 'journey');
        t.advanceFleetCalendar(2, jid);   // the mid-jump briefing
        t.advanceFleetCalendar(2, jid);   // arrival, same persisted id
      }
      const afterWarps = count();
      return { start, firstOk, afterFirst, secondOk, afterSecond, zeroOk, afterZero,
        afterWarps, warps: 13, daysElapsed: s.day - dayBefore,
        needs: t.campaign().config.dominionPlayerBeats.journeys };
    });
    assert.ok(!r.fail, `the journey-counting reproduction could not be set up: ${r.fail}`);
    assert.equal(r.firstOk, true, 'precondition: the ledger accepted the first call');
    assert.equal(r.afterFirst - r.start, 1, `one accepted journey counted ${r.afterFirst - r.start}`);
    assert.equal(r.secondOk, false, 'precondition: the ledger refuses the same journey id twice');
    assert.equal(r.afterSecond, r.afterFirst,
      `the same journey presented twice counted ${r.afterSecond - r.afterFirst} extra journey(s)`);
    assert.equal(r.afterZero, r.afterSecond,
      'a zero-day calendar call counted as a journey');
    assert.equal(r.afterWarps - r.afterSecond, r.warps,
      `${r.warps} ordinary warps recorded ${r.afterWarps - r.afterSecond} journeys`);
    assert.equal(r.daysElapsed, r.warps * 2, 'precondition: each warp advanced its own days exactly once');
    assert.ok(r.afterWarps < r.needs,
      `${r.warps} warps already reach the ${r.needs}-journey threshold (${r.afterWarps})`);
  });

  // DOM-5 — the Dominion took Bajor and then signed a peace with Earth, because once it held ground on
  // this side of the wormhole the ordinary war-exhaustion roll treated it as an ordinary neighbour.
  // The expedition's war is authored: nothing but the campaign may end it.
  await check('DOM the expedition\'s war with Earth is never signed away', async () => {
    await fresh('play-dom5');
    const r = await ev(() => {
      const t = testBM1, s = t.state;
      if (typeof t.isDominionCoreSystem !== 'function') return { fail: 'this tree draws no line between the far side of the wormhole and the rest of the galaxy, so there is no expedition whose war could be signed away' };
      const world = t.buildCampaignWorld(true);
      const here = Number(s.currentPlanet);
      const target = world.systems.findIndex((sys, i) => i !== here && sys.controller && sys.controller !== 'player'
        && !t.isDominionCoreSystem(s.planets[i]?.name));
      if (target < 0) return { fail: 'no near-side world was available for the expedition to take' };
      t.changeDiplomacy('terran', 'dominion', 'war');
      t.transferSystemControlToFaction(target, 'dominion');
      t.markSystemVisited(target);
      t.buildCampaignWorld(true);
      const before = t.worldRelation('terran', 'dominion').status;
      const start = s.day;
      // Two hundred warp-days of the ordinary roll running every single day.
      for (let d = start + 1; d <= start + 200; d++) { s.day = d; t.advanceWorldDiplomacy(d); }
      t.advanceCampaign(s.day);
      return { fail: null, target, before, after: t.worldRelation('terran', 'dominion').status,
        pairs: t.diplomaticPairs().map((p) => p.join(':')).filter((k) => k.includes('dominion')) };
    });
    assert.ok(!r.fail, `the settlement reproduction could not be set up: ${r.fail}`);
    assert.equal(r.before, 'war', 'precondition: the expedition is at war with Earth');
    assert.deepEqual(r.pairs, [], `the roll still holds the expedition's war as ${r.pairs.join(', ')}`);
    assert.equal(r.after, 'war',
      `two hundred days of the ordinary roll settled the expedition's war: Earth and the Dominion are now at "${r.after}"`);
  });

  // CULT — Astra's point, and the captain's: a world has a people and a government, and the HUD showed
  // only the second. A Bajoran world under a Dominion flag read as "Dominion space" on the planet card
  // and "Dominion controlled" on the map, with nothing to say whose world it actually is.
  await check('CULT a world reports its people and its government separately', async () => {
    await fresh('play-cult');
    const r = await ev(() => {
      const t = testBM1, s = t.state;
      if (typeof t.getSystemSovereignty !== 'function') return { fail: 'this tree reports only a controller: a world has no people it can name separately' };
      const here = Number(s.currentPlanet);
      const world = t.buildCampaignWorld(true);
      // A world with a people of its own, governed by them — which means its culture and its governor
      // are the same power, not merely that its two government fields agree. Selecting on origin ===
      // controller picked Orion, a Terran-governed world whose people are Orion, and then asked why it
      // did not read as self-governed.
      const own = world.systems.findIndex((sys, i) => {
        if (i === here || !sys.controller) return false;
        const culture = t.getSystemCulture(i);
        return culture.id && culture.id === sys.controller;
      });
      if (own < 0) return { fail: 'no world is governed by its own people' };
      t.markSystemVisited(own);
      const before = t.getSystemSovereignty(own);
      const mapBefore = t.getMapSystemInfo(own);
      // Somebody else takes it.
      t.transferSystemControlToFaction(own, 'dominion');
      t.buildCampaignWorld(true);
      const taken = t.getSystemSovereignty(own);
      const mapAfter = t.getMapSystemInfo(own);
      // And the card the captain reads in that system.
      s.currentPlanet = own; s.myplanet = own + 1; s.warp.active = false;
      t.applySystemState(own);
      s.docked = true; s.dockedPlanetIndex = own; s.dockedStationId = null;
      s.planetMenuOpen = true; s.dockMenuTab = 'services';
      t.renderPlanetMenu();
      const card = document.getElementById('planet-menu')?.textContent || '';
      return { fail: null, own, before, taken, mapBefore: mapBefore.relation, mapAfter: mapAfter.relation,
        card: card.slice(0, 400), levels: [before.level, taken.level] };
    });
    assert.ok(!r.fail, `the sovereignty reproduction could not be set up: ${r.fail}`);
    assert.equal(r.before.level, 'independent', `a world governed by its own people reads as "${r.before.level}"`);
    assert.ok(r.before.cultureLabel, 'the world has no people the captain can be told about');
    assert.ok(['occupied', 'administered'].includes(r.taken.level),
      `a world taken by somebody else reads as "${r.taken.level}"`);
    assert.equal(r.taken.cultureLabel, r.before.cultureLabel,
      `conquest changed whose world it is: ${r.before.cultureLabel} became ${r.taken.cultureLabel}`);
    assert.equal(r.taken.governorLabel, 'Dominion', `it is governed by "${r.taken.governorLabel}"`);
    assert.ok(/Dominion/.test(r.mapAfter) && new RegExp(r.before.cultureLabel).test(r.mapAfter),
      `the map says "${r.mapAfter}" rather than naming both the people and the government`);
    assert.ok(new RegExp(`${r.before.cultureLabel} world`).test(r.card),
      `the planet card never names the people of the world: ${r.card.slice(0, 160)}`);
    assert.ok(/occupation|administration|annexed/.test(r.card),
      `the planet card never says the government over them is not their own: ${r.card.slice(0, 160)}`);
  });

  // HUD — the quick-action bar had eight buttons and neither Fleet nor EW among them: the fleet manager
  // was a button at the bottom of a long Sensors panel and electronic warfare a collapsed section
  // inside it, so neither could be found. The bar also showed both of each button's labels at once
  // ("COMMS Stations", "TGT Target") because the wide label was an addition rather than a replacement.
  await check('HUD the quick-action bar carries all ten actions, one label each', async () => {
    await fresh('play-hud');
    const read = async (width, height) => {
      await page.setViewportSize({ width, height });
      await page.waitForTimeout(120);
      return ev(() => {
        const bar = document.getElementById('bottom-dock');
        const buttons = [...(bar?.querySelectorAll('button') || [])];
        const visible = (el) => { const st = el && getComputedStyle(el); return Boolean(st && st.display !== 'none' && st.visibility !== 'hidden'); };
        const rows = new Set(buttons.map((b) => Math.round(b.getBoundingClientRect().top)));
        return { hidden: bar?.classList.contains('hidden'),
          actions: buttons.map((b) => b.dataset.dockAction || (b.dataset.comms ? 'comms' : '?')),
          labels: buttons.map((b) => {
            const short = b.querySelector('b'), long = b.querySelector('span');
            return { short: visible(short) ? short.textContent.trim() : null, long: visible(long) ? long.textContent.trim() : null };
          }),
          rows: rows.size, minHeight: Math.min(...buttons.map((b) => Math.round(b.getBoundingClientRect().height))),
          overflow: buttons.some((b) => b.getBoundingClientRect().right > window.innerWidth + 1 || b.getBoundingClientRect().left < -1) };
      });
    };
    const wide = await read(1600, 900);
    const compact = await read(1000, 800);
    const small = await read(600, 800);
    await page.setViewportSize({ width: 1280, height: 800 });
    assert.equal(wide.hidden, false, 'precondition: the bar is on screen');
    assert.deepEqual(wide.actions, ['comms', 'target', 'hail', 'map', 'inventory', 'power', 'fleet', 'ew', 'contract', 'save'],
      `the bar carries ${wide.actions.join(', ')}`);
    for (const [name, r] of [['wide', wide], ['compact', compact], ['small', small]]) {
      const both = r.labels.filter((l) => l.short && l.long);
      assert.deepEqual(both, [], `at ${name} width ${both.length} button(s) showed both labels, e.g. "${both[0]?.short} ${both[0]?.long}"`);
      const none = r.labels.filter((l) => !l.short && !l.long);
      assert.deepEqual(none, [], `at ${name} width ${none.length} button(s) showed no label at all`);
      assert.ok(r.minHeight >= 44, `at ${name} width the smallest button is ${r.minHeight}px tall`);
      assert.equal(r.overflow, false, `at ${name} width the bar runs off screen`);
    }
    assert.equal(wide.labels[0].long, 'Stations', `the wide label is "${wide.labels[0].long}"`);
    assert.equal(compact.labels[0].short, 'COM', `the compact label is "${compact.labels[0].short}"`);
    assert.equal(small.rows, 2, `at small width the ten buttons sit in ${small.rows} row(s), not two rows of five`);
  });

  // HUD-2 — Fleet and EW have to be panels of their own, not a button hidden under Sensors.
  await check('HUD Fleet and EW open their own panels from the bar', async () => {
    await fresh('play-hud2');
    const r = await ev(() => {
      const t = testBM1, s = t.state;
      const click = (action) => document.querySelector(`[data-dock-action="${action}"]`)?.click();
      click('fleet');
      const fleetOpen = Boolean(document.querySelector('dialog.fleet-manager')?.open);
      document.querySelector('dialog.fleet-manager')?.close();
      click('ew');
      const panel = document.getElementById('top-left-panel');
      const ewText = panel?.textContent || '';
      return { fleetOpen, ewTab: s.topLeftTab, ewOpen: s.topLeftPanelOpen,
        ewNamesItself: /electronic warfare/i.test(ewText), ewHidden: panel?.classList.contains('hidden') };
    });
    assert.equal(r.fleetOpen, true, 'the FLEET button did not open the fleet manager');
    assert.equal(r.ewTab, 'ew', `the EW button opened the "${r.ewTab}" panel`);
    assert.equal(r.ewOpen, true, 'and left it closed');
    assert.equal(r.ewHidden, false, 'and hidden');
    assert.equal(r.ewNamesItself, true, 'the EW panel does not name itself');
  });

  // TOP — power and alert posture were both behind a modal: the alert readout opened the game menu and
  // power lived in a panel that covers the view, so neither could be touched in a fight.
  await check('TOP power and alert are set from the top strip without opening anything', async () => {
    await fresh('play-top');
    // At the width the probe opens at, the strip carries power as a readout and the steppers live on
    // the quick-action bar; this check is about the steppers, so it plays at a width that offers them.
    await page.setViewportSize({ width: 1600, height: 900 });
    await page.waitForTimeout(180);
    const r = await ev(() => {
      const t = testBM1, s = t.state;
      const stats = document.getElementById('stats');
      if (typeof t.getAlertStatus !== 'function') return { fail: 'this tree has no alert posture to set: the readout beside the ship opens the game menu' };
      const dialogsOpen = () => [...document.querySelectorAll('dialog')].filter((d) => d.open).length;
      // A fight is on: this is when both of these matter.
      s.lastShieldHitAt = t.gameNow();
      t.updateStats();
      const before = { alert: t.ensurePlaytestState().alertLevel || 'green', power: t.state.power?.dist?.weapons ?? null, dialogs: dialogsOpen() };
      const pill = stats.querySelector('[data-alert-cycle]');
      const powerChips = [...stats.querySelectorAll('[data-power-dist]')].map((b) => `${b.dataset.powerDist}${b.dataset.powerDir}`);
      // Three clicks cycles green -> yellow -> red -> green, so it must land back where it started.
      // Re-queried each time: clicking it re-renders the strip, which detaches the node.
      const seen = [];
      for (let n = 0; n < 3; n++) {
        stats.querySelector('[data-alert-cycle]')?.click();
        seen.push(t.ensurePlaytestState().alertLevel);
      }
      const afterAlert = { alert: seen[1], cycle: seen, dialogs: dialogsOpen() };
      const up = stats.querySelector('[data-power-dist="weapons"][data-power-dir="1"]');
      // A control the captain cannot see is not a control they can use, whatever a query selector says.
      const upReachable = Boolean(up && up.offsetParent !== null);
      const livePill = stats.querySelector('[data-alert-cycle]');
      const alertReachable = livePill && livePill.offsetParent !== null ? 1 : 0;
      const alertTip = livePill ? String(livePill.getAttribute('title') || '') : '';
      const start = t.state.power?.dist?.weapons ?? 0;
      up?.click();
      const afterPower = { weapons: t.state.power?.dist?.weapons ?? 0, dialogs: dialogsOpen() };
      return { fail: null, before, pillPresent: Boolean(livePill), alertTip, powerChips, afterAlert, afterPower, start, upReachable, alertReachable, engaged: t.getAlertStatus() };
    });
    await page.setViewportSize({ width: 1280, height: 800 });
    await page.waitForTimeout(150);
    assert.ok(!r.fail, String(r.fail));
    assert.equal(r.pillPresent, true, 'the strip has no posture readout to set the alert from');
    assert.ok(r.powerChips.length >= 8, `the strip offers ${r.powerChips.length} power controls`);
    assert.equal(r.alertReachable, 1, 'the posture readout is not on screen');
    assert.match(r.alertTip, /click/i, `the posture readout does not say it can be clicked: "${r.alertTip}"`);
    assert.deepEqual(r.afterAlert.cycle, ['yellow', 'red', 'green'],
      `clicking the posture readout three times went ${r.afterAlert.cycle.join(' -> ')} rather than yellow -> red -> green`);
    assert.equal(r.upReachable, true, 'the power control is in the markup but not on screen');
    assert.equal(r.engaged, 'red', 'precondition: the ship is under fire, which is when this matters');
    assert.equal(r.afterAlert.alert, 'red', `the second click should reach red; it reached "${r.afterAlert.alert}"`);
    assert.equal(r.afterAlert.dialogs, r.before.dialogs, 'changing alert posture opened a dialog');
    assert.ok(r.afterPower.weapons > r.start, `raising weapon power from the strip left it at ${r.afterPower.weapons}`);
    assert.equal(r.afterPower.dialogs, r.before.dialogs, 'changing power opened a dialog');
  });

  // OWN — a world the captain holds and a yard they built on it still asked what a foreign government
  // thought of them before selling anything: at floor standing their own yard answered "Terran ports
  // refuse you". Prestige is how strangers decide whether to deal with you; there are no strangers at
  // your own dock.
  await check('OWN your own world and yard sell to you without prestige', async () => {
    await fresh('play-own');
    const r = await ev(() => {
      const t = testBM1, s = t.state;
      if (typeof t.isOwnHoldingVendor !== 'function') return { fail: 'this tree has no notion of a vendor being the captain\'s own: every yard asks a foreign government what it thinks of them' };
      // A real yard, wherever it is: a relay array sells nothing to anybody and would prove nothing.
      let found = null;
      for (let i = 0; i < s.planets.length && !found; i++) {
        s.currentPlanet = i; s.myplanet = i + 1; s.warp.active = false;
        s.systemStates = {}; t.applySystemState(i);
        const yard = (s.stations || []).find((x) => !x.destroyed && !x.underConstruction && t.fleetStationServices(x).sell);
        if (yard) found = { index: i, id: yard.id, name: s.planets[i]?.name };
      }
      if (!found) return { fail: 'no station in the galaxy sells ships' };
      const dockAt = (id) => {
        const st = (s.stations || []).find((x) => x.id === id);
        s.docked = true; s.dockedStationId = id; s.dockedPlanetIndex = null; s.remoteStationId = null;
        if (st) t.setCamera(st.x, st.y);
      };
      // Nobody who cares would deal with this captain.
      for (const key of ['terran', 'vulcan', 'ferengi', 'neutral', 'klingon', 'andorian', 'cardassian', 'romulan', 'bajoran']) t.adjustFactionStanding(key, -999);
      dockAt(found.id);
      const snap = () => {
        const st = t.getCurrentServiceStation();
        const stock = t.getShipyardStock(st) || [];
        const refusals = stock.map((sh) => { const bs = t.getShipPurchaseStatus(sh.id); return bs.ok ? null : String(bs.reason || ''); }).filter(Boolean);
        const prestige = /refuse|standing|prestige/i;
        return { station: st?.id || null, own: t.isOwnHoldingVendor(st), stock: stock.length,
          refusedForPrestige: refusals.filter((x) => prestige.test(x)),
          refusedForOther: refusals.filter((x) => !prestige.test(x)),
          market: String(t.commodityTradeBlock() || '') };
      };
      const foreign = snap();
      // The captain takes the world, and the yard on it is theirs.
      t.transferSystemControlToPlayer(found.index);
      const def = (s.stationDefinitions || []).find((d) => d.id === found.id);
      if (def) def.owner = t.PLAYER_SIDE;
      s.systemStates = {}; t.applySystemState(found.index);
      dockAt(found.id);
      const mine = snap();
      return { fail: null, system: found.name, foreign, mine };
    });
    assert.ok(!r.fail, `the ownership reproduction could not be set up: ${r.fail}`);
    assert.equal(r.foreign.own, false, 'precondition: the yard started as somebody else\'s');
    assert.equal(r.mine.own, true, 'taking the world and the yard did not make the vendor the captain\'s own');
    assert.equal(r.foreign.station, r.mine.station, 'precondition: the same yard is being asked twice');
    assert.ok(r.foreign.stock > 0 && r.mine.stock >= r.foreign.stock,
      `the yard stocked ${r.foreign.stock} designs for a stranger and ${r.mine.stock} for its owner`);
    assert.ok(r.foreign.refusedForPrestige.length > 0,
      `precondition: at floor standing a foreign yard refuses over prestige (it refused ${r.foreign.refusedForPrestige.length} of ${r.foreign.stock})`);
    assert.deepEqual(r.mine.refusedForPrestige, [],
      `the captain's own yard still refuses over prestige: ${r.mine.refusedForPrestige[0]}`);
    assert.ok(!/refuse|standing/i.test(r.mine.market),
      `the captain's own market answered: ${r.mine.market}`);
  });

  // MISSION — evacuation and blockade were offered but could not be pursued: evacuation completed by
  // holding position for twenty seconds with nothing attacking, and blockade only if a hostile
  // operation happened to engage there while the captain stood by.
  await check('MISSION contracts with nothing to pursue are not offered', async () => {
    await fresh('play-mission');
    const r = await ev(() => {
      const t = testBM1, s = t.state;
      const offered = {};
      for (const kind of ['relief', 'escort', 'evacuation', 'repair', 'recon', 'blockade']) {
        offered[kind] = Boolean(t.offerStationMission(kind, Number(s.currentPlanet), true));
      }
      const book = t.campaign();
      return { offered, open: book.missions.filter((m) => ['offered', 'active'].includes(m.status)).map((m) => m.kind) };
    });
    assert.equal(r.offered.evacuation, false, 'an evacuation contract was offered');
    assert.equal(r.offered.blockade, false, 'a blockade contract was offered');
    assert.ok(!r.open.includes('evacuation') && !r.open.includes('blockade'),
      `withdrawn contracts are open: ${r.open.join(', ')}`);
    assert.ok(r.offered.relief && r.offered.repair && r.offered.recon,
      `the contracts that do have objectives stopped being offered: ${JSON.stringify(r.offered)}`);
  });

  // CULT-2 — the government table maps four of its ids to 'neutral', and because that is a value rather
  // than a gap it short-circuited the name lookup behind it: fifty-eight of a hundred and one worlds had
  // no identity at all, Sonata among them, and the ones that did resolve were resolving off whatever
  // power the description happened to mention.
  // CULT-2 — the identities themselves, not just whether a label exists. The old chain guessed from
  // the world's name and then invented a people named after the planet, so five Tholian worlds called
  // themselves Crystal Loom and Webheart, Blender read as nobody, and New Bajor — whose own text says
  // its Bajorans are slaves to the Dominion — reported its people as Dominion. Every identity is now
  // authored and carries the phrase from that world's description that justifies it; this check reads
  // the shipped descriptions and holds each claim against them.
  await check('CULT every world is the people its own description names', async () => {
    await fresh('play-cult2');
    const r = await ev(() => {
      const t = testBM1, s = t.state;
      if (typeof t.getSystemSovereignty !== 'function') return { fail: 'this tree reports only a controller: no world has a people it can name apart from whoever governs it' };
      // On a tree with no authored identities there is nothing to hold against the descriptions, but
      // the worlds themselves can still be asked who they think they are — which is the reproduction.
      const authored = t.WORLD_CULTURES || {};
      const noTable = !t.WORLD_CULTURES;
      const govOf = (i) => Number(s.planets[i]?.governmentId ?? (s.systemData[i] || [])[1]);
      const indexOf = (name) => (s.planets || []).findIndex((p) => p.name === name);
      const unjustified = [];
      for (const [name, entry] of Object.entries(authored)) {
        const idx = indexOf(name);
        const planet = idx < 0 ? null : s.planets[idx];
        if (!planet) { unjustified.push(`${name}: no such world`); continue; }
        const why = String(entry.why || '');
        if (why.startsWith('gov:')) {
          if (String(govOf(idx)) !== why.slice(4)) unjustified.push(`${name}: claims governmentId ${why.slice(4)}, data says ${govOf(idx)}`);
        } else if (!String(planet.description || '').toLowerCase().includes(why.toLowerCase())) {
          unjustified.push(`${name}: description does not say "${why}"`);
        }
      }
      for (const [name, why] of Object.entries(t.WORLD_UNPEOPLED || {})) {
        const planet = (s.planets || []).find((p) => p.name === name);
        if (!planet) { unjustified.push(`${name}: no such world`); continue; }
        if (!String(planet.description || '').toLowerCase().includes(String(why).toLowerCase())) unjustified.push(`${name}: description does not say "${why}"`);
      }
      const at = (name) => {
        const i = (s.planets || []).findIndex((p) => p.name === name);
        return i < 0 ? null : { i, ...t.getSystemSovereignty(i), control: t.getSystemControl(i) };
      };
      const named = ['Sonata', 'New Bajor', 'Blender', 'Crystal Loom', 'Webheart', 'Lattice Hold', 'Spindle Reach',
        'Facet Gate', 'Remus', 'New Switzerland', 'Orilla', 'Earth', 'Bajora', 'Astron', 'Aldnas', 'Tellar'];
      const got = Object.fromEntries(named.map((n) => [n, at(n)]));
      // A people is not a polity. Nothing that is only a people may appear as a controller anywhere,
      // and no authored identity may have quietly become one.
      const peopleIds = Object.values(authored).map((c) => c.id).filter((id) => String(id).startsWith('people:'));
      const peopleTreatedAsFaction = peopleIds.filter((id) => t.isRecognizedFactionKey(id));
      const peopleGoverning = (s.planets || []).map((p, i) => t.getSystemControl(i))
        .filter((c) => peopleIds.includes(c.controller) || peopleIds.includes(c.allegiance) || peopleIds.includes(c.origin)).length;
      // No world's government may be its culture. Government now comes from two authored places — the
      // allegiance table and the shipped governmentId — and from nowhere else; in particular it may
      // never be taken from WORLD_CULTURES. Anything that does not match one of those two is the
      // conflation this check exists to catch.
      const govTable = t.BM1_GOVERNMENT_FACTIONS || {};
      const allegiance = t.WORLD_ALLEGIANCE || {};
      const independent = t.WORLD_INDEPENDENT || {};
      const governmentMoved = (s.planets || []).map((p, i) => {
        const origin = String(t.getSystemControl(i).origin || 'neutral');
        const authored = allegiance[p.name] ? String(allegiance[p.name].faction)
          : independent[p.name] ? 'neutral'
          : String(govTable[govOf(i)] ?? 'neutral');
        return { name: p.name, origin, authored, culture: String(t.getSystemCulture(i).id || '') };
      }).filter((x) => x.origin !== x.authored)
        .map((x) => `${x.name}: holder ${x.origin}, authored says ${x.authored}${x.origin === x.culture ? ' (taken from its culture)' : ''}`);
      const bySource = {};
      (s.planets || []).forEach((p, i) => { const k = t.getSystemCulture(i).source; bySource[k] = (bySource[k] || 0) + 1; });
      return { fail: null, noTable, unjustified, got, peopleTreatedAsFaction, peopleGoverning, governmentMoved, bySource };
    });
    assert.ok(!r.fail, `the identity reproduction could not be set up: ${r.fail}`);
    assert.deepEqual(r.unjustified, [],
      `${r.unjustified.length} identity claim(s) are not in the world's own data: ${r.unjustified.slice(0, 3).join('; ')}`);
    const g = r.got;
    assert.equal(g.Sonata?.culture, 'sona', `Sonata's people are "${g.Sonata?.culture}"`);
    assert.equal(g.Sonata?.cultureSource, 'authored',
      `Sonata's people are resolved by ${g.Sonata?.cultureSource}${r.noTable ? ', because this tree has no authored identities and guesses from the world\'s name' : ''}`);
    // The one that matters most: a people under someone else's government, reported as both.
    assert.equal(g['New Bajor']?.culture, 'bajoran', `New Bajor's people are "${g['New Bajor']?.culture}"`);
    assert.equal(g['New Bajor']?.governor, 'dominion', `New Bajor is governed by "${g['New Bajor']?.governor}"`);
    assert.match(String(g['New Bajor']?.label), /Bajoran world/, `New Bajor reads "${g['New Bajor']?.label}"`);
    assert.match(String(g['New Bajor']?.label), /Dominion/, `New Bajor does not name who holds it: "${g['New Bajor']?.label}"`);
    assert.equal(g.Remus?.culture, 'people:reman', `Remus's people are "${g.Remus?.culture}"`);
    assert.equal(g.Remus?.governor, 'romulan', `Remus is governed by "${g.Remus?.governor}"`);
    assert.equal(g.Blender?.culture, 'dominion_remnant', `Blender's people are "${g.Blender?.culture}"`);
    for (const n of ['Crystal Loom', 'Webheart', 'Lattice Hold', 'Spindle Reach', 'Facet Gate']) {
      assert.equal(g[n]?.culture, 'tholian', `${n} says its people are "${g[n]?.culture}" while its description says Tholian`);
    }
    assert.equal(g.Aldnas?.culture, 'romulan', `Aldnas's people are "${g.Aldnas?.culture}" though its text says the colony endures`);
    assert.equal(g.Tellar?.culture, 'people:tellarite', `Tellar's people are "${g.Tellar?.culture}"`);
    assert.equal(g['New Switzerland']?.culture, 'terran', `New Switzerland's people are "${g['New Switzerland']?.culture}"`);
    assert.equal(g['New Switzerland']?.governor, null, 'New Switzerland acquired a government along with its culture');
    assert.match(String(g.Astron?.label), /Uninhabited/, `Astron reads "${g.Astron?.label}" though its text says it is home to no one`);
    assert.equal(g.Orilla?.cultureSource, 'local', `Orilla, a refugee mixture with no people to name, resolved by ${g.Orilla?.cultureSource}`);
    // Culture never becomes ownership.
    assert.deepEqual(r.peopleTreatedAsFaction, [], `a people is being treated as a polity: ${r.peopleTreatedAsFaction.join(', ')}`);
    assert.equal(r.peopleGoverning, 0, `${r.peopleGoverning} world(s) are governed by something that is only a people`);
    assert.deepEqual(r.governmentMoved, [],
      `a world is held by something neither authored table says: ${r.governmentMoved.slice(0, 3).join('; ')}`);
    // And the guesswork is gone: no world should still be resolved by matching its name.
    assert.equal(r.bySource.name || 0, 0, `${r.bySource.name} world(s) still have their people guessed from the world's name`);
    assert.ok((r.bySource.authored || 0) >= 80, `only ${r.bySource.authored || 0} worlds have an authored identity`);
  });

  // LAYOUT — "the words still don't fit or we have issues with it overlapping". On ae4ae4d the top
  // strip clips its own posture pill at every width, runs 250px past its right edge around 1000, and
  // below 900 wraps onto a second row that sits across both the menu block and the minimap. This
  // check plays the HUD at six widths and reads back what is actually on screen.
  await check('LAYOUT the top strip fits its own readouts at every width and sits clear of the menu and the map', async () => {
    await fresh('play-layout');
    // This check is about the HUD's own layout, so it starts from a bare HUD: an earlier check leaves
    // the EW panel open, and at 600px that panel lies over the strip. (Which is worth knowing on its
    // own — a captain who opens EW in a fight loses the power controls underneath it — but it is a
    // question about that panel, not about whether the strip fits.)
    await ev(() => {
      const t = testBM1;
      t.state.topLeftPanelOpen = false;
      document.getElementById('top-left-panel')?.classList.add('hidden');
      for (const d of document.querySelectorAll('dialog')) { try { d.close(); } catch (e) { /* not open */ } }
      t.closePlanetMenu?.();
      t.updateStats();
    });
    const widths = [1920, 1600, 1536, 1440, 1366, 1280, 1100, 820, 600];
    const seen = [];
    try {
      for (const w of widths) {
        await page.setViewportSize({ width: w, height: 850 });
        await page.waitForTimeout(180);
        await ev(() => { const t = testBM1; t.state.lastShieldHitAt = t.gameNow(); t.updateStats(); });
        await page.waitForTimeout(120);
        seen.push(await ev(() => {
          const stats = document.getElementById('stats');
          const strip = stats && stats.querySelector('.top-strip');
          if (!strip) return { missing: true };
          const box = stats.getBoundingClientRect();
          const shown = [...strip.children].filter((el) => getComputedStyle(el).display !== 'none');
          const hit = (a, b) => Boolean(a && b && a.left < b.right && b.left < a.right && a.top < b.bottom && b.top < a.bottom);
          const other = (sel) => { const el = document.querySelector(sel); return el && getComputedStyle(el).display !== 'none' ? el.getBoundingClientRect() : null; };
          const name = (el) => (el.textContent || '').trim().replace(/\s+/g, ' ').slice(0, 24) || el.className;
          // Naming whatever is on top turns "covered" from a puzzle into a finding.
          const coveredBy = [];
          const reachable = (el) => {
            const r = el.getBoundingClientRect();
            if (r.width < 1 || r.height < 1) { coveredBy.push('zero-sized'); return false; }
            const over = document.elementFromPoint(Math.round(r.left + r.width / 2), Math.round(r.top + r.height / 2));
            if (over && (over === el || el.contains(over))) return true;
            coveredBy.push(over ? (over.id || String(over.className || '').split(' ')[0] || over.tagName) : 'nothing (off screen)');
            return false;
          };
          const onScreen = (sel) => [...stats.querySelectorAll(sel)].filter((el) => el.offsetParent !== null);
          return {
            // Nothing sticks out past the strip's own right edge.
            spill: shown.filter((el) => el.getBoundingClientRect().right - box.right > 1)
              .map((el) => `${name(el)} by ${Math.round(el.getBoundingClientRect().right - box.right)}px`),
            // Every readout is legible. The message slot rolls prose and is allowed its ellipsis.
            cut: shown.filter((el) => !el.classList.contains('top-message') && el.scrollWidth - el.clientWidth > 1)
              .map((el) => `${name(el)} cut by ${el.scrollWidth - el.clientWidth}px`),
            overMenu: hit(box, other('.top-left-menu')),
            overMap: hit(box, other('.minimap-panel')),
            // Whatever the strip still carries at this width has to be reachable, not merely present.
            overDock: hit(box, other('.bottom-dock')),
            alertShown: onScreen('[data-alert-cycle]').length,
            alertReachable: onScreen('[data-alert-cycle]').filter(reachable).length,
            powerShown: onScreen('.power-chip').length,
            powerReachable: onScreen('.power-chip').filter(reachable).length,
            stepsShown: onScreen('[data-power-dist][data-power-dir]').length,
            stepsReachable: onScreen('[data-power-dist][data-power-dir]').filter(reachable).length,
            coveredBy: [...new Set(coveredBy)].slice(0, 3).join(', '),
            dockPower: (() => { const b = document.querySelector('[data-dock-action="power"]'); return Boolean(b && b.offsetParent !== null && reachable(b)); })(),
            // The bar counts its labels elsewhere; this asks whether they fit the buttons they are on.
            dockCut: [...document.querySelectorAll('.bottom-dock button')].filter((b) => b.offsetParent !== null)
              .filter((b) => [...b.children].some((part) => getComputedStyle(part).display !== 'none' && part.scrollWidth - part.clientWidth > 1))
              .map((b) => (b.textContent || '').trim().slice(0, 12)),
          };
        }));
      }
    } finally {
      await page.setViewportSize({ width: 1280, height: 800 });
      await page.waitForTimeout(150);
    }
    // Every width is judged before anything is asserted, so the verdict names what is actually wrong
    // with the HUD rather than whichever width happened to be measured first.
    const wrong = [];
    seen.forEach((r, i) => {
      const at = `${widths[i]}px`;
      if (r.missing) { wrong.push(`at ${at} there is no top strip`); return; }
      if (r.overDock) wrong.push(`at ${at} the strip sits across the quick-action bar`);
      if (r.dockCut.length) wrong.push(`at ${at} the bar's labels are cut off: ${r.dockCut.join(', ')}`);
      if (r.spill.length) wrong.push(`at ${at} the strip runs past its own right edge: ${r.spill.join('; ')}`);
      if (r.cut.length) wrong.push(`at ${at} a readout is cut off: ${r.cut.join('; ')}`);
      if (r.overMenu) wrong.push(`at ${at} the strip sits across the menu block`);
      if (r.overMap) wrong.push(`at ${at} the strip sits across the minimap`);
      // Alert posture is the one control that has to survive to the narrowest width the game is played
      // at: it is what a captain reaches for first, and there is no room for a dialog in a fight.
      if (r.alertShown !== 1) wrong.push(`at ${at} the strip has no posture readout to set the alert from`);
      if (r.alertReachable !== r.alertShown) wrong.push(`at ${at} the posture readout is covered by ${r.coveredBy} and cannot be hit`);
      // Power stays in the strip at every width the game is played at. Below 641px it does not: that
      // column has to hold the menu, the strip, an incoming hail and the disabled-ship panel, and the
      // hail's own controls win. There it must still be one press away on the bar, which is checked.
      const phone = widths[i] <= 640;
      if (!phone) {
        if (r.powerShown !== 4) wrong.push(`at ${at} the strip shows ${r.powerShown} of 4 power readouts`);
        if (r.powerReachable !== r.powerShown) wrong.push(`at ${at} ${r.powerShown - r.powerReachable} of ${r.powerShown} power readouts are covered by ${r.coveredBy}`);
        if (r.stepsShown !== 8) wrong.push(`at ${at} the strip offers ${r.stepsShown} of 8 power controls`);
        if (r.stepsReachable !== r.stepsShown) wrong.push(`at ${at} ${r.stepsShown - r.stepsReachable} of ${r.stepsShown} power controls are covered by ${r.coveredBy} and cannot be hit`);
      } else if (!r.dockPower) {
        wrong.push(`at ${at} power has left the strip and there is no POWER button on the bar either`);
      }
    });
    assert.deepEqual(wrong, [], wrong.join('; '));
  });

  // POWER — the report was that power and alert had to be reachable while engaging. They were not
  // reachable at all: #stats is pointer-events:none, the strip having always been a readout the
  // captain looks past, and the controls added to it had none of their own. elementFromPoint returned
  // the canvas for a mouse exactly as it did for a finger, and a scripted element.click() reached them
  // anyway, which is why the first version of this work passed its own gate. This presses them where
  // they sit on screen, with an ordinary pointer, at the widths a laptop browser actually is.
  await check('POWER alert and power answer a real click at laptop widths', async () => {
    await fresh('play-power');
    const sizes = [[1920, 1080, '1920 (100%)'], [1536, 960, '1536 (125%)'], [1280, 800, '1280 (150%)']];
    const wrong = [];
    try {
      for (const [w, h, name] of sizes) {
        await page.setViewportSize({ width: w, height: h });
        await page.waitForTimeout(200);
        await ev(() => {
          const t = testBM1;
          t.state.topLeftPanelOpen = false;
          document.getElementById('top-left-panel')?.classList.add('hidden');
          for (const d of document.querySelectorAll('dialog')) { try { d.close(); } catch (e) { /* not open */ } }
          t.state.lastShieldHitAt = t.gameNow();
          t.ensurePlaytestState().alertLevel = 'green';
          t.updateStats();
        });
        await page.waitForTimeout(160);

        const centre = (sel) => ev((s) => {
          const b = document.querySelector(s);
          if (!b || b.offsetParent === null) return null;
          const r = b.getBoundingClientRect();
          const x = Math.round(r.left + r.width / 2), y = Math.round(r.top + r.height / 2);
          const over = document.elementFromPoint(x, y);
          return { x, y, w: Math.round(r.width), h: Math.round(r.height),
            covered: over && !(over === b || b.contains(over)) ? (over.id || String(over.className || '').split(' ')[0] || over.tagName) : null };
        }, sel);

        const pill = await centre('#stats [data-alert-cycle]');
        if (!pill) { wrong.push(`${name}: there is no posture readout in the strip`); continue; }
        if (pill.covered) wrong.push(`${name}: the posture readout is under ${pill.covered} and a click cannot reach it`);
        await page.mouse.click(pill.x, pill.y);
        await page.waitForTimeout(140);
        const alertNow = await ev(() => testBM1.ensurePlaytestState().alertLevel);
        if (alertNow !== 'yellow') wrong.push(`${name}: clicking the posture readout where it sits left the posture at "${alertNow}"`);

        const up = await centre('#stats [data-power-dist="weapons"][data-power-dir="1"]');
        if (!up) { wrong.push(`${name}: there is no power control in the strip`); continue; }
        if (up.covered) wrong.push(`${name}: the weapons power control is under ${up.covered} and a click cannot reach it`);
        const before = await ev(() => testBM1.state.power?.dist?.weapons ?? -1);
        await page.mouse.click(up.x, up.y);
        await page.waitForTimeout(140);
        const after = await ev(() => testBM1.state.power?.dist?.weapons ?? -1);
        if (!(after > before)) wrong.push(`${name}: clicking the weapons power control where it sits left it at ${after}`);

        // Down as well as up: a stepper that only ever raises is half a control.
        const down = await centre('#stats [data-power-dist="weapons"][data-power-dir="-1"]');
        if (down) {
          await page.mouse.click(down.x, down.y);
          await page.waitForTimeout(140);
          const back = await ev(() => testBM1.state.power?.dist?.weapons ?? -1);
          if (!(back < after)) wrong.push(`${name}: the weapons power control does not lower (${after} -> ${back})`);
        } else {
          wrong.push(`${name}: there is no control to lower weapons power`);
        }

        // Readable, which at a laptop size means the readouts are not ellipsised away.
        const unreadable = await ev(() => [...document.querySelectorAll('#stats .top-stat, #stats .power-chip')]
          .filter((el) => el.offsetParent !== null && el.scrollWidth - el.clientWidth > 1)
          .map((el) => (el.textContent || '').trim().slice(0, 16)));
        if (unreadable.length) wrong.push(`${name}: ${unreadable.length} readout(s) cut off: ${unreadable.join(', ')}`);

        const dialogs = await ev(() => [...document.querySelectorAll('dialog')].filter((d) => d.open).length);
        if (dialogs) wrong.push(`${name}: setting posture or power opened ${dialogs} dialog(s) over the fight`);
      }
    } finally {
      await page.setViewportSize({ width: 1280, height: 800 });
      await page.waitForTimeout(150);
    }
    assert.deepEqual(wrong, [], wrong.join('; '));
  });

  // OWN-2 — the ordinary shelf was made ownership-aware, but six other purchase paths were not: EW
  // modules, sensor suites, seeker weapons, fleet refit and repair, fleet weapon refit, and
  // commissioning. Those three decision functions did not even waive the test at an owned yard — they
  // re-aimed it at the captain's own flag, so a captain whose flag faction disliked them was refused
  // by their own dock. This check stands at a yard the captain owns, with every government at floor
  // standing, and asks each path in turn; and it checks that price, stock, compatibility and facility
  // requirements still refuse, because removing those would be the other way to pass.
  await check('OWN every service at a yard the captain owns stops asking foreign governments', async () => {
    await fresh('play-own2');
    const r = await ev(() => {
      const t = testBM1, s = t.state;
      if (typeof t.isOwnHoldingVendor !== 'function') return { fail: 'this tree has no notion of a vendor being the captain\'s own: every yard, including one the captain built, asks a foreign government what it thinks of them before it will sell or service anything' };
      // A yard that actually services ships: refit, weapons and repair, not a relay array.
      let found = null;
      for (let i = 0; i < s.planets.length && !found; i++) {
        s.currentPlanet = i; s.myplanet = i + 1; s.warp.active = false;
        s.systemStates = {}; t.applySystemState(i);
        const yard = (s.stations || []).find((x) => {
          if (x.destroyed || x.underConstruction) return false;
          const sv = t.fleetStationServices(x);
          return sv.refit && sv.weapons;
        });
        if (yard) found = { index: i, id: yard.id, name: s.planets[i]?.name };
      }
      if (!found) return { fail: 'no station in the galaxy both refits and sells weapons' };
      const dockAt = (id) => {
        const st = (s.stations || []).find((x) => x.id === id);
        s.docked = true; s.dockedStationId = id; s.dockedPlanetIndex = null; s.remoteStationId = null;
        if (st) t.setCamera(st.x, st.y);
      };
      for (const key of ['terran', 'vulcan', 'ferengi', 'neutral', 'klingon', 'andorian', 'cardassian', 'romulan', 'bajoran', 'breen', 'tholian', 'dominion']) t.adjustFactionStanding(key, -999);
      s.latinum = 5000000;
      const prestige = /refuse|standing|prestige/i;
      const reasons = () => {
        const st = t.getCurrentServiceStation();
        const out = {};
        // EW module: the dearest tier there is, so the tier test is the one that would bite.
        const ewIds = Object.keys(t.EW_MODULES || {});
        const ew = ewIds.map((id) => t.getEWUpgradeDecision(id)).filter(Boolean);
        out.ew = ew.map((d) => String(d.reason || '')).filter(Boolean);
        const sensorIds = Object.keys(t.SENSOR_SUITES || {});
        const sensors = sensorIds.map((id) => t.getSensorUpgradeDecision(id)).filter(Boolean);
        out.sensors = sensors.map((d) => String(d.reason || '')).filter(Boolean);
        const hoj = t.getHojPurchaseDecision(st);
        out.hoj = hoj && hoj.reason ? [String(hoj.reason)] : [];
        // fleetServiceAllowed also tests distance, combat state and the station's type, so asking it
        // for a boolean cannot tell prestige from proximity. The clause this work changed is named
        // directly, and the whole predicate is reported beside it.
        const faction = st?.faction || t.getSystemFaction(s.currentPlanet);
        const vr = typeof t.vendorRefusal === 'function' ? t.vendorRefusal(st, faction) : t.serviceRefusal(faction);
        out.fleetService = vr ? [String(vr)] : [];
        out.fleetServiceForeignClause = t.serviceRefusal(faction) ? String(t.serviceRefusal(faction)) : null;
        out.fleetServiceAllowed = t.fleetServiceAllowed(s);
        // Commissioning: an offered hull that is not on the shelf.
        const stock = t.getShipyardStock(st) || [];
        const catalog = t.state.shipCatalog;
        const all = Array.isArray(catalog) ? catalog : Object.values(catalog || {});
        const ids = all.slice(0, 40).map((sh) => sh && sh.id).filter((id) => id != null && !stock.some((x) => x.id === id));
        const comm = ids.map((id) => t.commissionStatus(id)).filter(Boolean);
        out.commission = comm.filter((c) => !c.ok).map((c) => String(c.reason || ''));
        return { station: st?.id || null, own: t.isOwnHoldingVendor(st), ...out };
      };
      dockAt(found.id);
      const foreign = reasons();
      t.transferSystemControlToPlayer(found.index);
      const def = (s.stationDefinitions || []).find((d) => d.id === found.id);
      if (def) def.owner = t.PLAYER_SIDE;
      s.systemStates = {}; t.applySystemState(found.index);
      dockAt(found.id);
      const mine = reasons();
      // And with no money, the captain's own yard still says no — ownership is not a free pass.
      s.latinum = 0;
      const broke = reasons();
      const paths = ['ew', 'sensors', 'hoj', 'fleetService', 'commission'];
      const stillPrestige = {};
      for (const k of paths) stillPrestige[k] = (mine[k] || []).filter((x) => prestige.test(x));
      const foreignPrestige = {};
      for (const k of paths) foreignPrestige[k] = (foreign[k] || []).filter((x) => prestige.test(x));
      const brokeSaysPrice = (broke.ew || []).concat(broke.sensors || []).filter((x) => /latinum|afford|need \d/i.test(x));
      return { fail: null, world: found.name, foreign, mine, stillPrestige, foreignPrestige, brokeSaysPrice,
        ownFlag: mine.own, foreignFlag: foreign.own };
    });
    assert.ok(!r.fail, `the ownership reproduction could not be set up: ${r.fail}`);
    assert.equal(r.foreignFlag, false, 'precondition: the yard starts as somebody else\'s');
    assert.equal(r.ownFlag, true, `precondition: after the capture the yard at ${r.world} is the captain's`);
    // It has to have been refusing on prestige beforehand, or the check proves nothing.
    const wasRefusing = Object.entries(r.foreignPrestige).filter(([, v]) => v.length).map(([k]) => k);
    assert.ok(wasRefusing.length >= 3,
      `precondition: a foreign yard at floor standing should refuse these on prestige; it refused ${wasRefusing.join(', ') || 'none of them'}`);
    for (const [path, refusals] of Object.entries(r.stillPrestige)) {
      assert.deepEqual(refusals, [],
        `at the captain's own yard, ${path} still asks a foreign government: ${refusals.slice(0, 2).join('; ')}`);
    }
    // The clause fleet refit, repair, sale and equipment transfer all hang off: it refused on prestige
    // at the foreign yard and does not at the captain's own.
    assert.ok(r.foreign.fleetServiceForeignClause,
      'precondition: at floor standing a foreign yard should refuse fleet service on prestige');
    assert.equal(r.mine.fleetServiceForeignClause !== null, true,
      'precondition: the underlying foreign opinion has not changed, only whether it is consulted');
    // The other requirements are untouched: with an empty purse the same yard refuses on price.
    assert.ok(r.brokeSaysPrice.length > 0,
      'with no latinum the captain\'s own yard raised no price objection either, so ownership is waiving more than prestige');
  });

  // SAVE — the previous version of this check called the migration helper directly, which proves the
  // helper works and nothing about what a player experiences. This writes a real save, strips the
  // migration flag from the stored JSON so it is genuinely a save from before the withdrawal, loads it
  // through loadGame, runs the game, saves and loads a second time, and then runs past the old
  // deadlines — which is where an unmigrated contract would have expired and taken standing with it.
  await check('SAVE a legacy save carrying withdrawn contracts survives loading, reloading and its own deadlines', async () => {
    await fresh('play-save');
    const r = await ev(() => {
      const t = testBM1, s = t.state;
      const kinds = t.WITHDRAWN_MISSION_KINDS || ['evacuation', 'blockade'];
      const SLOT = 3;
      const book = t.campaignBook();
      if (typeof t.saveGame !== 'function' || typeof t.loadGame !== 'function') return { fail: 'this tree cannot save or load, so a legacy save cannot be tested' };

      // The captain's position before any of this, so a penalty or a payout is visible.
      s.latinum = 50000; s.mylatinum = s.latinum;
      const standingKeys = ['terran', 'klingon', 'ferengi', 'romulan', 'cardassian', 'bajoran'];
      const standingBefore = Object.fromEntries(standingKeys.map((k) => [k, t.getFactionStanding(k)]));
      const latinumBefore = s.latinum;
      const deadline = s.day + 5;

      book.missions = (book.missions || []).filter((m) => !kinds.includes(m.kind));
      for (const kind of kinds) {
        for (const status of ['offered', 'active', 'complete']) {
          book.missions.push({ id: `legacy-${kind}-${status}`, key: `${kind}:1`, kind, status,
            systemIndex: 1, reward: 5000, text: `legacy ${kind}`, deadlineDay: deadline,
            ...(status === 'complete' ? { completedDay: s.day - 3, reason: 'completed before the withdrawal' } : {}) });
        }
      }
      // A contract of a kind that still works, to show the migration is not simply clearing the board.
      book.missions.push({ id: 'legacy-relief-active', key: 'relief:1', kind: 'relief', status: 'active',
        systemIndex: 1, reward: 4000, text: 'legacy relief', deadlineDay: deadline });

      t.saveGame(SLOT);
      // Make it a save from before the withdrawal: the flag the migration writes must not be in it.
      const key = typeof t.getSaveSlotKey === 'function' ? t.getSaveSlotKey(SLOT) : `${t.SAVE_SLOT_PREFIX}${SLOT}`;
      const raw = JSON.parse(localStorage.getItem(key) || 'null');
      if (!raw) return { fail: 'the save did not reach storage, so there is nothing to load' };
      const stored = raw?.playtest?.campaign;
      if (!stored) return { fail: 'the save carries no campaign book' };
      delete stored.migratedWithdrawnMissions;
      const savedWithdrawn = (stored.missions || []).filter((m) => kinds.includes(m.kind)).map((m) => `${m.kind}:${m.status}`);
      localStorage.setItem(key, JSON.stringify(raw));

      const snapshot = (label) => {
        const b = t.campaignBook();
        const mine = (b.missions || []).filter((m) => kinds.includes(m.kind));
        return { label,
          open: mine.filter((m) => ['offered', 'active'].includes(m.status)).map((m) => `${m.kind}:${m.status}`),
          statuses: mine.map((m) => `${m.kind}:${m.status}`).sort(),
          complete: mine.filter((m) => m.status === 'complete').map((m) => `${m.id}@${m.completedDay}:${m.reason}`).sort(),
          expired: mine.filter((m) => m.status === 'expired').map((m) => `${m.kind}`),
          relief: (b.missions || []).filter((m) => m.kind === 'relief').map((m) => m.status),
          latinum: s.latinum,
          standing: Object.fromEntries(standingKeys.map((k) => [k, t.getFactionStanding(k)])) };
      };

      // Load it the way a player would, then let the game run rather than calling the migration.
      t.loadGame(SLOT);
      for (let i = 0; i < 4; i++) { t.tick(); t.advanceStationMissions(t.gameNow()); }
      const afterLoad = snapshot('after first load');

      // Save and load a second time: a migration that only holds until the next save is not a fix.
      t.saveGame(SLOT);
      t.loadGame(SLOT);
      for (let i = 0; i < 4; i++) { t.tick(); t.advanceStationMissions(t.gameNow()); }
      const afterReload = snapshot('after save and reload');

      // Past the old deadlines, which is where an unmigrated contract expires.
      s.day = deadline + 20;
      t.campaign();
      t.advanceCampaign ? t.advanceCampaign() : null;
      for (let i = 0; i < 4; i++) { t.tick(); t.advanceStationMissions(t.gameNow()); }
      const afterDeadline = snapshot('past the deadline');

      return { fail: null, savedWithdrawn, deadline, latinumBefore, standingBefore,
        afterLoad, afterReload, afterDeadline, standingKeys };
    });
    assert.ok(!r.fail, `the save reproduction could not be set up: ${r.fail}`);
    assert.equal(r.savedWithdrawn.length, 6,
      `precondition: the stored save carries six withdrawn-kind contracts (${r.savedWithdrawn.join(', ')})`);

    for (const stage of [r.afterLoad, r.afterReload, r.afterDeadline]) {
      assert.deepEqual(stage.open, [],
        `${stage.label}: ${stage.open.length} withdrawn contract(s) are open — ${stage.open.join(', ')}`);
      assert.deepEqual(stage.expired, [],
        `${stage.label}: a withdrawn contract expired rather than being released — ${stage.expired.join(', ')}`);
      assert.equal(stage.complete.length, 2,
        `${stage.label}: the two already-completed contracts number ${stage.complete.length}`);
      assert.deepEqual(stage.complete, r.afterLoad.complete,
        `${stage.label}: an already-completed contract was altered`);
      assert.equal(stage.latinum, r.latinumBefore,
        `${stage.label}: the captain's latinum moved by ${stage.latinum - r.latinumBefore}`);
      for (const k of r.standingKeys) {
        assert.equal(stage.standing[k], r.standingBefore[k],
          `${stage.label}: ${k} standing moved by ${stage.standing[k] - r.standingBefore[k]}`);
      }
    }
    // The board is not simply being cleared: a contract of a kind that still works is still there.
    assert.ok(r.afterLoad.relief.length > 0, 'the relief contract vanished along with the withdrawn ones');
    assert.ok(!r.afterReload.relief.includes('withdrawn') && !r.afterReload.relief.includes('released'),
      `a working contract was released as though it were withdrawn: ${r.afterReload.relief.join(', ')}`);
    // And the release is recorded as a release rather than a failure.
    assert.ok(r.afterLoad.statuses.every((x) => /:(withdrawn|released|complete)$/.test(x)),
      `after loading, the withdrawn contracts read: ${r.afterLoad.statuses.join(', ')}`);
  });

  // HOLD — the previous round named each world's people and deliberately left the political map alone.
  // The result was that the Tholians held exactly one world while five more introduced themselves in
  // their own first sentence as Tholian space, and a Terran captain could fly into all five unopposed.
  // This checks what the allegiance does, not what it is labelled: who controls the system, who owns
  // the stations in it, what the map says the relation is, and whether the captain is unwelcome.
  await check('HOLD a world its own text places inside an empire behaves as that empire\'s', async () => {
    await fresh('play-hold');
    const r = await ev(() => {
      const t = testBM1, s = t.state;
      if (!t.WORLD_ALLEGIANCE) return { fail: 'this tree has no authored allegiance: a world the government table has no answer for is nobody\'s, so five worlds of Tholian space are unheld and unopposed' };
      const idx = (name) => (s.planets || []).findIndex((p) => p.name === name);
      // The map's relation line reads "Unsurveyed" for anything the captain has not been to, so
      // comparing relations at a fresh start compares two blanks. Survey the worlds under test first.
      for (const n of ['Tholia', 'Crystal Loom', 'Webheart', 'Lattice Hold', 'Spindle Reach', 'Facet Gate',
        ...Object.keys(t.WORLD_INDEPENDENT || {})]) {
        const i = idx(n);
        if (i >= 0 && !s.visitedSystems.includes(i)) s.visitedSystems.push(i);
      }
      const look = (name) => {
        const i = idx(name);
        if (i < 0) return null;
        const ctl = t.getSystemControl(i);
        const stations = [...new Set((s.stationDefinitions || [])
          .filter((d) => Number(d.systemIndex) === i)
          .map((d) => t.getStationOwner({ id: d.id, systemIndex: i }, i)))];
        return { i, controller: ctl.controller, allegiance: ctl.allegiance, polityId: ctl.polityId,
          source: ctl.originSource, playerControlled: ctl.playerControlled,
          hostile: t.getEffectiveAttitude(ctl.allegiance) === 'hostile',
          relation: t.getMapSystemInfo(i).relation,
          mapGovernor: t.getMapSystemInfo(i).sovereignty?.governor ?? null,
          stationOwners: stations.filter((o) => !String(o || '').startsWith('private:')).sort() };
      };
      const tholian = ['Crystal Loom', 'Webheart', 'Lattice Hold', 'Spindle Reach', 'Facet Gate'].map((n) => [n, look(n)]);
      const capital = look('Tholia');
      const independents = Object.keys(t.WORLD_INDEPENDENT || {}).map((n) => [n, look(n)]).filter(([, v]) => v);
      // Every authored claim must be justified by that world's own description.
      const unjustified = [];
      for (const [name, entry] of Object.entries(t.WORLD_ALLEGIANCE)) {
        const planet = (s.planets || []).find((p) => p.name === name);
        if (!planet) { unjustified.push(`${name}: no such world`); continue; }
        if (!String(planet.description || '').toLowerCase().includes(String(entry.why).toLowerCase())) {
          unjustified.push(`${name}: description does not say "${entry.why}"`);
        }
      }
      for (const [name, why] of Object.entries(t.WORLD_INDEPENDENT || {})) {
        const planet = (s.planets || []).find((p) => p.name === name);
        if (planet && !String(planet.description || '').toLowerCase().includes(String(why).toLowerCase())) {
          unjustified.push(`${name}: description does not say "${why}"`);
        }
      }
      // A capture still takes the world, and survives a save and a reload.
      const target = idx('Crystal Loom');
      t.transferSystemControlToPlayer(target);
      const captured = look('Crystal Loom');
      t.saveGame(2);
      t.loadGame(2);
      const afterReload = look('Crystal Loom');
      // And an explicit override still wins over the authored allegiance.
      s.factionSystemOverrides = { ...(s.factionSystemOverrides || {}), [idx('Webheart')]: 'klingon' };
      const overridden = look('Webheart');
      // Two worlds the first cut of the independent table got wrong, both caught by reading what the
      // descriptions actually say rather than which words they contain.
      const pirates = look('Pirates Haven');
      const rigel = look('Rigel');
      // An entry here has to be a sentence about who governs the world, not a word about who lives
      // there: "Trills" is in Trill's description and says nothing about its government.
      const GOVERNANCE = /govern|claim|free|unnoticed|died out|its own/i;
      const weak = Object.entries(t.WORLD_INDEPENDENT || {})
        .filter(([, why]) => !GOVERNANCE.test(String(why)))
        .map(([name, why]) => `${name}: "${why}"`);
      return { fail: null, unjustified, tholian, capital, independents, captured, afterReload, overridden,
        pirates, rigel, weak,
        allegianceCount: Object.keys(t.WORLD_ALLEGIANCE).length };
    });
    assert.ok(!r.fail, `the allegiance reproduction could not be set up: ${r.fail}`);
    assert.deepEqual(r.unjustified, [],
      `${r.unjustified.length} allegiance claim(s) are not in the world's own text: ${r.unjustified.slice(0, 3).join('; ')}`);
    assert.ok(r.capital && r.capital.controller === 'tholian', `Tholia itself is held by "${r.capital?.controller}"`);
    for (const [name, w] of r.tholian) {
      assert.ok(w, `${name} is not in the galaxy`);
      assert.equal(w.controller, 'tholian', `${name} is controlled by "${w.controller}" though its own text places it in Tholian space`);
      assert.equal(w.allegiance, 'tholian', `${name} flies "${w.allegiance}"`);
      assert.equal(w.hostile, r.capital.hostile,
        `${name} is ${w.hostile ? 'hostile' : 'not hostile'} to this captain while Tholia itself is ${r.capital.hostile ? 'hostile' : 'not'}`);
      assert.equal(w.relation, r.capital.relation,
        `the map calls ${name} "${w.relation}" and Tholia "${r.capital.relation}"`);
      assert.equal(/unsurveyed/i.test(String(w.relation)), false,
        `the map has no relation to report for ${name}: "${w.relation}"`);
      // The relation *line* reads the same either way — a Tholian world governed by Tholians and one
      // governed by nobody are both "self-governed" — so the map is questioned about who governs it,
      // which is the field that was empty before.
      assert.equal(w.mapGovernor, 'tholian',
        `the map gives ${name} no government of its own (governor "${w.mapGovernor}") while printing "${w.relation}"`);
      assert.deepEqual(w.stationOwners, ['tholian'],
        `the stations at ${name} are owned by ${w.stationOwners.join(', ') || 'nobody'}`);
    }
    // Genuine independents are not swept up.
    for (const [name, w] of r.independents) {
      assert.equal(w.allegiance, 'neutral', `${name}, whose text says nobody claims it, now flies "${w.allegiance}"`);
      assert.equal(w.source, 'independent', `${name} resolved by ${w.source} rather than as an authored independent`);
    }
    // Captures and overrides still win.
    assert.equal(r.captured.playerControlled, true, 'capturing an authored Tholian world did not transfer it');
    assert.equal(r.afterReload.playerControlled, true, 'the capture was lost when the save was reloaded');
    assert.equal(r.overridden.controller, 'klingon', `an explicit override was ignored: the world is held by "${r.overridden.controller}"`);
    assert.ok(r.allegianceCount >= 30, `only ${r.allegianceCount} worlds have an authored allegiance`);
    // Authoring independence must not quietly disarm a world whose text says it is dangerous, or
    // strip a protector the text names.
    assert.equal(r.pirates.controller, 'pirate',
      `Pirates Haven, whose text warns of "the rotting corpses of the poor traders caught in our little haven", is held by "${r.pirates.controller}"`);
    assert.equal(r.pirates.hostile, true, 'Pirates Haven is no longer hostile to this captain');
    assert.equal(r.rigel.controller, 'andorian',
      `Rigel, whose text says "The Andorians however lay claim to this world and are quite willing to protect it", is held by "${r.rigel.controller}"`);
    assert.deepEqual(r.weak, [],
      `${r.weak.length} world(s) are recorded as independent on a phrase that says nothing about who governs them: ${r.weak.join('; ')}`);
  });

  // MARK — item 7. Accepting a contract left nothing on the chart: the captain was told to fly to a
  // world and given no way to find it again, and the only list of what they had taken on was buried in
  // the Empire panel under "escort". This reproduces the whole round trip through real clicks: accept
  // from the contracts panel, read the marker, ask to be shown it, then finish it and let one expire.
  await check('MARK a contract taken on is named, dated and marked, and stops being marked when it ends', async () => {
    await fresh('play-mark');
    const setup = await ev(() => {
      const t = testBM1, s = t.state;
      if (!t.mapObjectives || !t.openContractsPanel) {
        return { fail: 'this tree has no contract list and no map objective layer: what the captain has accepted is listed only inside the Empire panel, and its destination is never marked on the chart' };
      }
      s.day = 10;
      // A charted world that is not the one the captain is standing in.
      const target = (s.planets || []).findIndex((p, i) => i !== Number(s.currentPlanet) && t.isChartSystemVisible(i) && !t.isDominionCoreSystem(p.name));
      if (target < 0) return { fail: 'no charted world to send the captain to' };
      if (!s.visitedSystems.includes(target)) s.visitedSystems.push(target);
      const m = t.offerStationMission('recon', target);
      if (!m) return { fail: 'the station would not offer a contract to reproduce against' };
      t.openContractsPanel();
      const panel = document.getElementById('top-left-panel');
      const beforeMarks = t.mapObjectives().filter((o) => o.index === target).length;
      return { fail: null, target, name: s.planets[target].name, missionId: m.id, deadlineDay: m.deadlineDay,
        beforeMarks, panelHtml: panel?.innerHTML || '', panelHidden: Boolean(panel?.classList.contains('hidden')) };
    });
    assert.ok(!setup.fail, `the contract reproduction could not be set up: ${setup.fail}`);
    assert.equal(setup.panelHidden, false, 'the CONTRACT control did not open a panel at all');
    assert.equal(setup.beforeMarks, 0,
      'a contract that was merely offered, and never accepted, was already marked on the chart');
    assert.ok(/data-campaign-accept/.test(setup.panelHtml),
      'the contracts panel offers no way to take a contract on; the captain must still go looking for it in the Empire panel');

    // Accept it the way a captain does: a real click on the button in the panel.
    const acceptBox = await page.locator(`#top-left-panel [data-campaign-accept="${setup.missionId}"]`).first().boundingBox();
    assert.ok(acceptBox, 'the Accept control is in the markup but not on screen');
    await page.mouse.click(acceptBox.x + acceptBox.width / 2, acceptBox.y + acceptBox.height / 2);
    await page.waitForTimeout(120);

    const after = await ev((target) => {
      const t = testBM1, s = t.state;
      const marks = t.mapObjectives().filter((o) => o.index === target);
      const panel = document.getElementById('top-left-panel');
      return { marks, panelHtml: panel?.innerHTML || '',
        status: (t.campaignBook().missions || []).find((m) => m.systemIndex === target)?.status,
        log: String(s.log || '') };
    }, setup.target);
    assert.equal(after.status, 'active', `the Accept control did not take the contract on (status "${after.status}")`);
    assert.equal(after.marks.length, 1,
      `an accepted contract left ${after.marks.length} markers on the chart; the captain is told to fly somewhere and never shown where`);
    assert.ok(/recon/i.test(after.marks[0].label),
      `the marker does not name the contract: "${after.marks[0].label}"`);
    assert.ok(after.marks[0].detail.includes(setup.name),
      `the marker does not name its destination: "${after.marks[0].detail}"`);
    assert.ok(after.marks[0].detail.includes(String(setup.deadlineDay)),
      `the marker carries no deadline: "${after.marks[0].detail}"`);
    assert.ok(after.panelHtml.includes(setup.name) && /due day/i.test(after.panelHtml),
      'the contract list does not give the destination and deadline together');
    assert.ok(new RegExp(setup.name).test(after.log),
      `accepting said nothing about where the objective was marked: "${after.log.slice(0, 160)}"`);

    // "Show on map" has to actually take the captain there.
    const showBox = await page.locator(`#top-left-panel [data-contract-show="${setup.target}"]`).first().boundingBox();
    assert.ok(showBox, 'the contract list has no "Show on map" control on screen');
    await page.mouse.click(showBox.x + showBox.width / 2, showBox.y + showBox.height / 2);
    await page.waitForTimeout(120);
    const shown = await ev(() => ({ mapOpen: testBM1.state.mapOpen, selected: Number(testBM1.state.selectedPlanet) }));
    assert.equal(shown.mapOpen, true, '"Show on map" did not open the chart');
    assert.equal(shown.selected, setup.target, `"Show on map" selected system ${shown.selected} rather than the objective`);

    // Finishing it, and letting one run out, both have to clear the marker.
    const ended = await ev((target) => {
      const t = testBM1, s = t.state;
      const book = t.campaignBook();
      const m = (book.missions || []).find((x) => x.systemIndex === target && x.status === 'active');
      t.Campaign.completeMission(book, m.id, s.day, 'gate');
      const afterComplete = t.mapObjectives().filter((o) => o.index === target).length;
      const second = t.offerStationMission('relief', target);
      t.acceptCampaignMission(second.id);
      const whileLive = t.mapObjectives().filter((o) => o.index === target).length;
      s.day = second.deadlineDay + 2;
      t.advanceCampaign(s.day);
      return { afterComplete, whileLive, afterExpiry: t.mapObjectives().filter((o) => o.index === target).length,
        secondStatus: (t.campaignBook().missions || []).find((x) => x.id === second.id)?.status };
    }, setup.target);
    assert.equal(ended.afterComplete, 0, 'a completed contract is still marked on the chart');
    assert.equal(ended.whileLive, 1, 'precondition: the replacement contract was marked while it was live');
    assert.equal(ended.secondStatus, 'expired', `precondition: the replacement expired (status "${ended.secondStatus}")`);
    assert.equal(ended.afterExpiry, 0, 'a contract whose deadline has passed is still marked on the chart');
  });

  // OVERLAY — item 9. There was no overlay: a single hardcoded ring for trade cargo, no routes, no
  // legend, nothing selectable, and nothing that said what a ring meant. This check paints the chart
  // for real and reads back what was drawn, so a layer that renders nothing cannot pass by declaring
  // itself.
  await check('OVERLAY the chart carries a selectable cargo and route layer that respects what is charted', async () => {
    await fresh('play-overlay');
    const setup = await ev(() => {
      const t = testBM1, s = t.state;
      if (!t.MAP_OVERLAY_LAYERS || !t.drawInterstellarMapOverlay) {
        return { fail: 'this tree draws one hardcoded ring for cargo and nothing else: no route lines, no legend, and no way to turn any of it off' };
      }
      const target = (s.planets || []).findIndex((p, i) => i !== Number(s.currentPlanet) && t.isChartSystemVisible(i) && !t.isDominionCoreSystem(p.name));
      const hidden = (s.planets || []).findIndex((p, i) => t.isDominionCoreSystem(p.name));
      if (target < 0 || hidden < 0) return { fail: 'the galaxy has no charted destination and no hidden region to test against' };
      if (!s.visitedSystems.includes(target)) s.visitedSystems.push(target);
      s.openContracts = [
        { id: 'gate-cargo', goods: 'medical supplies', tons: 12, payPerTon: 40, targetIndex: target, employerName: 'Gate Office' },
        { id: 'gate-hidden', goods: 'contraband', tons: 4, payPerTon: 90, targetIndex: hidden, employerName: 'Gate Office' },
      ];
      t.getOpenContracts();
      t.openMap();
      // Paint the chart and read back every string and every dashed stroke it put down.
      window.__painted = [];
      window.__dashed = 0;
      window.__routeColor = String(t.MAP_OVERLAY_LAYERS.find((l) => l.key === 'routes').color).toLowerCase();
      const C = CanvasRenderingContext2D.prototype;
      if (!window.__spied) {
        window.__spied = true;
        const ft = C.fillText;
        C.fillText = function (txt, ...rest) { window.__painted.push(String(txt)); return ft.call(this, txt, ...rest); };
        // Counting any dashed stroke would count the chart's own unexplored-route dashes, so the
        // route line is only credited when it is stroked in the overlay layer's own colour.
        const st = C.stroke;
        C.stroke = function (...a) {
          const dash = (this.getLineDash && this.getLineDash()) || [];
          if (dash.length && String(this.strokeStyle).toLowerCase() === window.__routeColor) window.__dashed++;
          return st.apply(this, a);
        };
      }
      t.drawInterstellarMapOverlay();
      const painted = window.__painted.slice();
      return { fail: null, target, hidden, targetName: s.planets[target].name, hiddenName: s.planets[hidden].name,
        painted, dashed: window.__dashed,
        layers: t.MAP_OVERLAY_LAYERS.map((l) => l.key),
        objectives: t.mapObjectives().map((o) => ({ index: o.index, kind: o.kind })) };
    });
    assert.ok(!setup.fail, `the overlay reproduction could not be set up: ${setup.fail}`);
    assert.ok(setup.layers.length >= 3, `only ${setup.layers.length} overlay layer(s) exist: ${setup.layers.join(', ')}`);
    assert.ok(setup.painted.some((txt) => /medical supplies/.test(txt)),
      'the chart was painted with no cargo marker; the captain cannot see where their delivery is going');
    assert.ok(setup.painted.some((txt) => /CLICK TO TOGGLE/i.test(txt)),
      'the chart has no legend saying what the markers mean or that they can be turned off');
    assert.ok(setup.painted.some((txt) => /Cargo destinations \(\d+\)/.test(txt)),
      `the legend does not count what each layer is showing: ${setup.painted.filter((t2) => /\(\d+\)/.test(t2)).join(' | ') || 'no counted rows'}`);
    assert.ok(setup.dashed >= 1,
      'no route line in the overlay\'s own colour was drawn between the captain and their objective; the chart\'s existing route lines are not the overlay');
    // Discovery: the second contract points into the hidden region, and must not put a ring there.
    assert.equal(setup.objectives.some((o) => o.index === setup.hidden), false,
      `a delivery into a region the captain has never charted was marked on the map at ${setup.hiddenName}`);
    assert.equal(setup.painted.some((txt) => /contraband/.test(txt)), false,
      'the overlay named a cargo whose destination the captain has not discovered');

    // Selectable: clicking the legend row turns that layer off, and the markers go with it.
    const box = await ev(() => {
      const t = testBM1;
      const r = t.getStarChartPanelRect();
      const n = t.MAP_OVERLAY_LAYERS.findIndex((l) => l.key === 'cargo');
      const y = r.bottom - 18 - t.MAP_OVERLAY_LAYERS.length * 18 + 9 + n * 18 - 4;
      const c = document.getElementById('game');
      const rect = c.getBoundingClientRect();
      return { clientX: rect.left + (r.left + 40) * (rect.width / c.width), clientY: rect.top + y * (rect.height / c.height) };
    });
    await page.mouse.click(box.clientX, box.clientY);
    await page.waitForTimeout(120);
    const afterToggle = await ev(() => {
      const t = testBM1;
      window.__painted = [];
      window.__dashed = 0;
      t.drawInterstellarMapOverlay();
      const cargoOff = { on: t.mapOverlayState().cargo, painted: window.__painted.slice() };
      // Negative control for the route count above: with the route layer off, nothing may be stroked
      // in its colour, so a passing count cannot have come from the chart's own lines.
      t.toggleMapOverlay('routes');
      window.__dashed = 0;
      t.drawInterstellarMapOverlay();
      return { ...cargoOff, dashedWithRoutesOff: window.__dashed };
    });
    assert.equal(afterToggle.on, false,
      'clicking the cargo row in the legend did not turn that layer off; the overlay is not selectable by pointer');
    assert.equal(afterToggle.painted.some((txt) => /medical supplies/.test(txt)), false,
      'the cargo layer reports itself off but its markers are still painted on the chart');
    assert.equal(afterToggle.dashedWithRoutesOff, 0,
      `the route layer was turned off and ${afterToggle.dashedWithRoutesOff} route line(s) were still drawn`);
  });

  // RECOVER — a recovery contract is the one kind whose destination moves: a lead to pay for anywhere,
  // then a wreck, then a yard that can build the design. It was excluded from the contracts list
  // outright, and its marker was pinned to the wreck at every step. This drives the contract the way a
  // captain does — fly to the wreck and let the engine notice, then carry it to a yard and dock —
  // rather than writing the step field and asserting about the writing.
  await check('RECOVER a recovery contract is flown, not set: the wreck, then a yard, then paid once', async () => {
    await fresh('play-recover');
    const set = await ev(() => {
      const t = testBM1, s = t.state;
      if (!t.missionObjective || !t.recoveryYardSystems) {
        return { fail: 'this tree resolves a mission to its systemIndex and nothing else: a recovery contract points at the wreck after the engineers are already aboard, and the contracts list excludes it entirely' };
      }
      const book = t.campaignBook();
      // A captain in good standing with their own government, which is what delivering an archive to
      // one of its yards assumes. Nothing else is raised.
      s.factionStanding.terran = 40;
      const wreck = (s.planets || []).findIndex((p, i) => i !== Number(s.currentPlanet) && t.isChartSystemVisible(i));
      if (wreck < 0) return { fail: 'no charted world to lose a design at' };
      t.markSystemVisited(wreck);
      const ship = Object.values(s.shipStatsById)
        .find((x) => x && x.assetType === 'ship' && x.rosterState === 'active' && x.mass <= 3 && x.faction === 'terran');
      if (!ship) return { fail: 'no light active hull to lose' };
      // The design has to have been somebody's before it can be recovered to somebody else's.
      book.designs[ship.id] = { sources: ['gate-lost'], lost: ['gate-lost'], relocatedTo: null };
      book.recoveries.push({ id: 'gate-recovery', shipId: Number(ship.id), lostStationId: 'gate-lost',
        systemIndex: wreck, kind: 'engineers', status: 'available', createdDay: s.day,
        completedDay: null, relocatedTo: null, attempts: 0 });
      if (!t.startDesignRecovery('gate-recovery')) return { fail: 'the recovery contract could not be started' };
      const m = (book.missions || []).find((x) => x.kind === 'archive' && x.status === 'active');
      if (!m) return { fail: 'starting the recovery made no live contract' };
      const read = () => ({
        step: m.step,
        objective: t.missionObjective(m),
        marks: t.mapObjectives().filter((o) => o.kind === 'contracts').map((o) => o.index).sort((a, b) => a - b),
        panel: t.renderContractsPanel(),
      });
      const offered = read();

      // --- the pickup, flown ---------------------------------------------------------------------
      // Arrive at the wreck and close to within transporter reach of the world. Nothing writes the
      // step; advanceRecoveryMissions notices where the ship is.
      s.currentPlanet = wreck;
      t.applySystemState(wreck);
      t.markSystemVisited(wreck);
      // The captain's position is the camera; flying is moving it.
      t.setCamera(s.systemPlanet.x + 9000, s.systemPlanet.y);
      t.advanceRecoveryMissions();
      const atRange = read();
      t.setCamera(s.systemPlanet.x + 300, s.systemPlanet.y);
      t.advanceRecoveryMissions();
      const aboard = read();

      // --- put it down and pick it up again -------------------------------------------------------
      t.saveGame(6);
      t.loadGame(6);
      const reloaded = (t.campaignBook().missions || []).find((x) => x.id === m.id);
      const afterLoad = reloaded ? { step: reloaded.step, objective: t.missionObjective(reloaded),
        marks: t.mapObjectives().filter((o) => o.kind === 'contracts').map((o) => o.index).sort((a, b) => a - b),
        panel: t.renderContractsPanel() } : null;

      // --- the delivery, docked -------------------------------------------------------------------
      const live = (t.campaignBook().missions || []).find((x) => x.id === m.id);
      if (!live) return { fail: 'the recovery contract did not survive the reload at all' };
      const yards = t.recoveryYardSystems(live.shipId);
      let delivered = null, yardSystem = null, yardStation = null;
      for (const i of yards) {
        s.currentPlanet = i;
        t.applySystemState(i);
        t.markSystemVisited(i);
        const st = (s.stations || []).find((x) => !x.destroyed && !x.underConstruction && t.compatibleRecoveryYard(x, live.shipId));
        if (!st) continue;
        s.docked = true;
        s.dockedStationId = st.id;
        t.setCamera(st.x, st.y);
        t.advanceRecoveryMissions();
        const record = (t.campaignBook().missions || []).find((x) => x.id === live.id);
        if (record?.status === 'completed') { yardSystem = i; yardStation = st.id; delivered = record; break; }
      }
      if (!delivered) {
        const probe = yards.slice(0, 3).map((i) => {
          s.currentPlanet = i; t.applySystemState(i);
          return { i, stations: (s.stations || []).filter((x) => !x.destroyed && !x.underConstruction)
            .map((st) => ({ id: st.id, ok: t.compatibleRecoveryYard(st, live.shipId) })).filter((x) => x.ok).length };
        });
        return { fail: `none of the ${yards.length} candidate yards would take the delivery (standing ${s.factionStanding.terran}, step ${live.step}, probe ${JSON.stringify(probe)})`, offered, aboard };
      }

      const bookAfter = t.campaignBook();
      const offersAt = t.getStationEffectiveOffers((s.stations || []).find((x) => x.id === yardStation));
      const after = {
        marks: t.mapObjectives().filter((o) => o.kind === 'contracts').map((o) => o.index),
        panel: t.renderContractsPanel(),
        relocated: bookAfter.designs[live.shipId]?.relocatedTo || null,
        relocatedOffers: (bookAfter.relocatedOffers?.[yardStation] || []).slice(),
        recoveryStatus: bookAfter.recoveries.find((x) => x.id === 'gate-recovery')?.status || null,
        offered: (offersAt.shipIds || []).map(Number).includes(Number(live.shipId)),
        provenance: offersAt.provenance?.[`ship:${live.shipId}`] || null,
      };
      // Standing at the same dock must not pay it a second time.
      t.advanceRecoveryMissions();
      t.advanceRecoveryMissions();
      const again = {
        relocatedOffers: (t.campaignBook().relocatedOffers?.[yardStation] || []).slice(),
        status: (t.campaignBook().missions || []).find((x) => x.id === live.id)?.status || null,
      };
      return { fail: null, wreck, shipName: ship.name, shipId: Number(ship.id), yardSystem, yardStation,
        offered, atRange, aboard, afterLoad, after, again, yards: yards.length };
    });
    assert.ok(!set.fail, `the recovery reproduction could not be set up: ${set.fail}`);

    assert.ok(set.offered.panel.includes(set.shipName),
      'the contracts list does not mention the recovery contract at all; it is marked on the chart and listed nowhere');
    assert.deepEqual(set.offered.marks, [set.wreck],
      `before the pickup the chart marks ${JSON.stringify(set.offered.marks)} rather than the wreck at ${set.wreck}`);

    // Flying to the system is not the same as reaching the wreck.
    assert.equal(set.atRange.step, 'recover',
      `arriving in the system 9,000 units out already counted as the pickup (step "${set.atRange.step}")`);
    assert.equal(set.aboard.step, 'deliver',
      `closing to transporter range did not pick the engineers up (step "${set.aboard.step}")`);
    assert.ok(set.aboard.objective.candidates > 0,
      'with the engineers aboard, no compatible yard is offered to deliver them to');
    assert.equal(set.aboard.marks.includes(set.wreck), false,
      'the engineers are aboard and the chart still marks the wreck they came from');
    assert.ok(set.aboard.panel.includes('data-contract-show'), 'the recovery row offers no "Show on map"');

    assert.ok(set.afterLoad, 'the recovery contract did not survive a save and a reload');
    assert.equal(set.afterLoad.step, 'deliver', `after reloading, the contract is back on step "${set.afterLoad.step}"`);
    assert.deepEqual(set.afterLoad.marks, set.aboard.marks,
      `after reloading, the chart marks ${JSON.stringify(set.afterLoad.marks)} rather than ${JSON.stringify(set.aboard.marks)}`);

    // Delivery pays, once, in the thing the contract was for.
    assert.equal(set.after.recoveryStatus, 'completed',
      `docking at a compatible yard left the recovery "${set.after.recoveryStatus}"`);
    assert.equal(set.after.relocated, set.yardStation,
      `the design was not relocated to the yard it was delivered to (${set.after.relocated})`);
    assert.equal(set.after.offered, true,
      'the design was delivered and the yard still does not offer it');
    assert.equal(set.after.provenance, 'recovered-archive',
      `the yard offers the design but not as a recovered archive ("${set.after.provenance}")`);
    assert.deepEqual(set.after.marks, [],
      `a completed recovery is still marked on the chart at ${JSON.stringify(set.after.marks)}`);
    assert.equal(/archive/i.test(set.after.panel), false,
      'a completed recovery is still listed among the open contracts');

    assert.deepEqual(set.again.relocatedOffers, set.after.relocatedOffers,
      `standing at the same dock paid the recovery again: ${JSON.stringify(set.after.relocatedOffers)} became ${JSON.stringify(set.again.relocatedOffers)}`);
    assert.equal(set.again.status, 'completed', `the completed contract went back to "${set.again.status}"`);
  });

  // MODAL — every dialog in this game is modal, and a modal swallows the pointer but not the keyboard.
  // With Fleet & Shipyard open, M opened the star chart underneath it: a chart whose systems could not
  // be clicked, behind a dialog the captain had to find and close first.
  await check('MODAL a gameplay key does not open a window behind an open dialog', async () => {
    await fresh('play-modal');
    const r = await ev(() => {
      const t = testBM1, s = t.state;
      const press = (key) => window.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true }));
      s.topLeftPanelOpen = false;
      s.topLeftTab = 'power';
      t.renderFleetManager(true);
      const dlg = document.querySelector('dialog.fleet-manager');
      const openedModal = Boolean(dlg?.open);
      press('m');
      const mapBehind = Boolean(s.mapOpen);
      press('c');
      const panelBehind = Boolean(s.topLeftPanelOpen) || s.topLeftTab === 'inventory';
      dlg?.close();
      press('m');
      const mapAfter = Boolean(s.mapOpen);
      return { openedModal, mapBehind, panelBehind, mapAfter, tab: s.topLeftTab,
        hasGuard: typeof t.isModalDialogOpen === 'function' };
    });
    assert.equal(r.openedModal, true, 'the fleet manager did not open as a modal dialog');
    assert.equal(r.mapBehind, false,
      'pressing M with Fleet & Shipyard open opened the star chart behind it, where no system can be clicked');
    assert.equal(r.panelBehind, false,
      'pressing C with Fleet & Shipyard open opened the top-left panel behind it');
    assert.equal(r.mapAfter, true,
      'closing the dialog did not give the keyboard back: M no longer opens the chart');
  });

  // STOCK — a world's hull lot is shaped by its government's own rule: Earth sells 2 of its 6, Andoria
  // 1 of its 7. Giving 31 worlds a government turned that shaping rule into a closing one on nine of
  // them, and the first repair treated an emptied lot as proof the world was a grey market — so a lot
  // with one eligible hull sold one hull, and the same lot with none sold every foreign hull in it.
  // Foreign availability cannot turn on whether one compatible hull happened to survive a filter.
  await check('STOCK a world sells what its own government would, and no world is authored to sell otherwise', async () => {
    await fresh('play-stock');
    const r = await ev(() => {
      const t = testBM1, s = t.state;
      for (const f of Object.keys(s.factionStanding || {})) s.factionStanding[f] = 100;
      const eligible = (ship, i) => {
        const trade = t.getTradeStandingFaction ? t.getTradeStandingFaction(i, null) : null;
        return !ship.faction || ship.faction === 'neutral' || trade === 'neutral' || ship.faction === trade;
      };
      const shelf = (i) => {
        s.currentPlanet = i; t.applySystemState(i);
        return t.getShipyardStock(null).map((x) => s.shipStatsById[x.id]).filter(Boolean);
      };
      const authoredWorlds = (s.planets || []).map((p, i) => i).filter((i) => (s.planets[i].shipStockIds || []).length);
      // Nothing with a shop may have an empty one.
      const empty = authoredWorlds.filter((i) => shelf(i).length === 0).map((i) => `${i}:${s.planets[i].name}`);
      // Nowhere unauthored may a foreign hull be on sale.
      const foreignTable = t.WORLD_FOREIGN_STOCK || {};
      const leaks = [];
      for (const i of authoredWorlds) {
        if (foreignTable[s.planets[i].name]) continue;
        for (const ship of shelf(i)) {
          if (!eligible(ship, i)) leaks.push(`${s.planets[i].name}: ${ship.name} (${ship.faction})`);
        }
      }
      // The same question asked of the whole galaxy rather than only the worlds with an authored lot:
      // a world with no lot at all takes the price-ranked shelf, and that must not carry foreign hulls
      // either.
      for (let i = 0; i < (s.planets || []).length; i++) {
        if ((s.planets[i].shipStockIds || []).length || foreignTable[s.planets[i].name]) continue;
        for (const ship of shelf(i)) {
          if (!eligible(ship, i)) leaks.push(`${s.planets[i].name} (no authored lot): ${ship.name} (${ship.faction})`);
        }
      }
      // The authored exceptions have to be justified by the world's own description, and have to work.
      const exceptions = Object.entries(foreignTable).map(([name, why]) => {
        const i = (s.planets || []).findIndex((p) => p.name === name);
        const planet = s.planets[i];
        const sold = i >= 0 ? shelf(i) : [];
        return { name, why, found: i >= 0,
          justified: i >= 0 && String(planet.description || '').toLowerCase().includes(String(why).toLowerCase()),
          foreignSold: sold.filter((ship) => !eligible(ship, i)).length };
      });
      // And the one that decides it: strip the last eligible hull out of an ordinary world's lot and
      // the foreign hulls in that same lot must not appear.
      let pivot = null;
      for (const i of authoredWorlds) {
        if (foreignTable[s.planets[i].name]) continue;
        const lot = (s.planets[i].shipStockIds || []).map((id) => s.shipStatsById[id]).filter(Boolean);
        const good = lot.filter((x) => eligible(x, i)), bad = lot.filter((x) => !eligible(x, i));
        if (!good.length || !bad.length) continue;
        const before = shelf(i).map((x) => x.name);
        const saved = s.planets[i].shipStockIds.slice();
        s.planets[i].shipStockIds = bad.map((x) => Number(x.id));
        s.systemStates = {};
        const after = shelf(i);
        s.planets[i].shipStockIds = saved;
        s.systemStates = {};
        pivot = { i, name: s.planets[i].name, before, strippedTo: bad.map((x) => `${x.name} (${x.faction})`),
          afterCount: after.length, afterForeign: after.filter((x) => !eligible(x, i)).map((x) => `${x.name} (${x.faction})`) };
        break;
      }
      return { worlds: authoredWorlds.length, empty, leaks, exceptions, pivot };
    });
    assert.ok(r.worlds > 50, `precondition: worlds with an authored hull lot (${r.worlds})`);
    assert.deepEqual(r.empty, [],
      `${r.empty.length} world(s) have an authored shipyard that sells nothing: ${r.empty.slice(0, 5).join(', ')}`);
    assert.deepEqual(r.leaks, [],
      `${r.leaks.length} foreign hull(s) are on sale at a world whose text does not say it deals in them: ${r.leaks.slice(0, 4).join('; ')}`);
    // The exception table is empty and held empty. Selling another power's hulls is a decision about
    // where a captain may buy what, with a standing cost attached; it is not a thing a world's prose
    // proves, and two worlds were authored here on phrases that describe what the Hirogen keep and how
    // the Suliban trade. The specific worlds and hulls are proposed for review in
    // docs/playtest/FOREIGN-MARKETS-SPEC; an entry appearing here without that decision trips this.
    assert.deepEqual(r.exceptions.map((e) => e.name), [],
      `${r.exceptions.length} world(s) are authored as selling foreign hulls: ${r.exceptions.map((e) => `${e.name} on "${e.why}"`).join('; ')} — that is a gameplay decision, and it belongs in the proposal until it is taken`);
    assert.ok(r.pivot, 'precondition: a world with both an eligible and an ineligible hull in its authored lot');
    assert.deepEqual(r.pivot.afterForeign, [],
      `stripping the last eligible hull out of ${r.pivot.name}'s lot put ${r.pivot.afterForeign.join(', ')} on sale: foreign availability is turning on whether one compatible hull survived the filter`);
    assert.ok(r.pivot.afterCount > 0,
      `${r.pivot.name} sells nothing once its lot holds no hull its government would carry`);
  });

  // CONDITIONS — what the chart was asked for was trade and safety: who flies a lane, who patrols it,
  // who preys on it, and what has stopped working. What it had was navigation lines to the captain's
  // own cargo. The hard part is not the drawing but the knowing: a system nobody has looked at must
  // read as unknown and never as quiet, and a memory of a place must not be dressed as a reading of it.
  await check('CONDITIONS trade and security are reported with a source and an age, and silence is not safety', async () => {
    await fresh('play-conditions');
    const r = await ev(() => {
      const t = testBM1, s = t.state;
      if (!t.systemConditions || !t.conditionsReadout) {
        return { fail: 'this tree has no notion of trade or security conditions: the chart draws routes to the captain\'s own cargo and nothing about who flies a lane, who patrols it or who preys on it' };
      }
      const charted = (s.planets || []).map((p, i) => i).filter((i) => t.isChartSystemVisible(i));
      const fresh0 = charted.map((i) => t.conditionsFor(i));
      const unreported = fresh0.filter((c) => c.source === 'none');
      // Nothing anyone has looked at yet may claim a threat reading of any kind.
      const falseCalm = unreported.filter((c) => c.threat || c.traffic || c.protection || c.disruption)
        .map((c) => `${s.planets[c.index].name}`);

      // A system the captain flew through, long ago — observed by standing in it, because marking a
      // system visited is not the same as having looked at it.
      const home = Number(s.currentPlanet);
      const seen = charted.find((i) => i !== home);
      s.day = 1;
      s.currentPlanet = seen; t.applySystemState(seen); t.markSystemVisited(seen);
      t.conditionsFor(seen);
      s.currentPlanet = home; t.applySystemState(home);
      s.day = 80;
      const stale = t.conditionsFor(seen);
      const staleRead = t.conditionsReadout(seen);

      // The same system with one of their own ships standing in it.
      s.playerFleet.push({ id: 'gate-eyes', shipId: 1, faction: 'terran', assignment: 'patrol',
        systemIndex: seen, vessel: { hull: 100, condition: 'ready' } });
      s.conditionsRev = (s.conditionsRev || 0) + 1;
      const live = t.conditionsFor(seen);
      const liveRead = t.conditionsReadout(seen);

      // A lane with one end nobody has looked at.
      const stranger = charted.find((i) => t.conditionsFor(i).source === 'none');
      const lane = stranger == null ? null : t.laneConditions(seen, stranger);

      // And a region that is not on the chart at all.
      const hidden = (s.planets || []).map((p, i) => i).find((i) => t.isDominionCoreSystem(s.planets[i].name));
      const hiddenCond = hidden == null ? null : t.conditionsFor(hidden);

      return { fail: null, charted: charted.length, unreported: unreported.length, falseCalm,
        stale: { source: stale.source, age: stale.ageDays, traffic: Boolean(stale.traffic),
          trafficDated: Boolean(stale.traffic?.dated), threat: stale.threat, protectionCapped: Boolean(stale.protection?.capped) },
        staleRead,
        live: { source: live.source, age: live.ageDays, threat: Boolean(live.threat), threatWhy: live.threat?.why },
        liveRead,
        lane: lane ? { traffic: lane.traffic, threat: lane.threat, source: lane.source } : null,
        hidden: hiddenCond ? hiddenCond.source : null };
    });
    assert.ok(!r.fail, `the conditions reproduction could not be set up: ${r.fail}`);

    assert.ok(r.unreported > r.charted * 0.5,
      `at a fresh start ${r.unreported} of ${r.charted} charted systems are unreported; a captain who has been nowhere should know almost nothing`);
    assert.deepEqual(r.falseCalm, [],
      `${r.falseCalm.length} system(s) nobody has looked at carry a reading anyway: ${r.falseCalm.slice(0, 4).join(', ')}`);

    // A memory is not a reading.
    assert.equal(r.stale.source, 'rumour', `a system flown through long ago reports as "${r.stale.source}"`);
    assert.ok(r.stale.age >= 70, `the stale reading is ${r.stale.age} days old; it should carry the age of the observation`);
    assert.ok(r.stale.traffic && r.stale.trafficDated,
      'what the captain saw of a world\'s trade is not carried forward, or is not marked as dated');
    assert.equal(r.stale.threat, null,
      `a system last seen 79 days ago reports a threat level anyway: ${JSON.stringify(r.stale.threat)}`);
    assert.equal(r.stale.protectionCapped, true,
      'a garrison seen 79 days ago is reported at full confidence');
    assert.ok(r.staleRead.some((l) => /Traffic reports/.test(l) && /observed day 1\b/.test(l) && /days old/.test(l)),
      `the readout does not give the source, the day and the age: ${JSON.stringify(r.staleRead)}`);
    assert.ok(r.staleRead.some((l) => /Threat: none reported/.test(l)),
      `the readout does not distinguish an unreported threat from a quiet one: ${JSON.stringify(r.staleRead)}`);
    // The instrument states the reading and its provenance and stops. It does not explain what a date
    // or a question mark means. [review]
    assert.deepEqual(r.staleRead.filter((l) => /not safe|not the same as|treat it as|may have changed|crews can be wrong/i.test(l)), [],
      `the readout narrates its own uncertainty instead of reporting: ${JSON.stringify(r.staleRead)}`);

    // A ship on station is a reading.
    assert.equal(r.live.source, 'fleet', `a system with the captain's own ship in it reports as "${r.live.source}"`);
    assert.equal(r.live.age, 0, `a ship standing in the system reports a ${r.live.age}-day-old picture`);
    assert.equal(r.live.threat, true, 'a ship standing in the system still cannot say what is happening there');
    assert.ok(r.liveRead.some((l) => /Fleet report/.test(l)),
      `the readout does not name the source: ${JSON.stringify(r.liveRead)}`);
    assert.ok(r.liveRead.some((l) => /\(est\.\)/.test(l)),
      `a fleet reading is not marked as an assessment: ${JSON.stringify(r.liveRead)}`);

    // A lane is only as known as its worse end.
    assert.ok(r.lane, 'precondition: a lane with one unlooked-at end');
    assert.equal(r.lane.traffic, null, 'a lane with an unreported end still claims to know its traffic');
    assert.equal(r.lane.threat, null,
      `a lane with an unreported end reports threat ${JSON.stringify(r.lane.threat)} — an unwatched lane is not a safe one`);

    assert.equal(r.hidden, 'none',
      `a system in a region the captain has never charted reports as "${r.hidden}"`);
  });

  // LANES — the layers have to be separate from the objective overlay, selectable, and drawn: an arc
  // that nothing explains is decoration, and a layer that cannot be turned off is not a layer.
  await check('LANES trade and security draw as their own selectable layers, and the unknown is counted', async () => {
    await fresh('play-lanes');
    const r = await ev(() => {
      const t = testBM1, s = t.state;
      const known = t.MAP_OVERLAY_LAYERS || [];
      if (!known.some((l) => l.key === 'lanes') || !known.some((l) => l.key === 'security')) {
        return { fail: 'this tree has one route layer and it draws navigation lines to the captain\'s own cargo; there is no trade-conditions layer to select' };
      }
      for (const i of (s.planets || []).map((p, n) => n).filter((i) => t.isChartSystemVisible(i)).slice(0, 6)) t.markSystemVisited(i);
      s.day = 20;
      t.openMap();
      const paint = () => {
        window.__painted = [];
        window.__strokes = [];
        const C = CanvasRenderingContext2D.prototype;
        if (!window.__condSpy) {
          window.__condSpy = true;
          const ft = C.fillText;
          C.fillText = function (txt, ...rest) { window.__painted.push(String(txt)); return ft.call(this, txt, ...rest); };
          const st = C.stroke;
          C.stroke = function (...a) { window.__strokes.push(String(this.strokeStyle).toLowerCase()); return st.apply(this, a); };
        }
        t.drawInterstellarMapOverlay();
        return { painted: window.__painted.slice(), strokes: window.__strokes.slice() };
      };
      const on = paint();
      // The lane is stroked through colorToRgba, so the spy matches the colour's own rgb triple
      // rather than the hex it was written as.
      const hex = '#8a7fa8';
      const rgb = `${parseInt(hex.slice(1, 3), 16)}, ${parseInt(hex.slice(3, 5), 16)}, ${parseInt(hex.slice(5, 7), 16)}`;
      const isUnknown = (c) => c === hex || c.includes(rgb);
      const unknownColor = hex;
      const withBoth = {
        painted: on.painted,
        unknownStrokes: on.strokes.filter(isUnknown).length,
        queries: on.painted.filter((x) => x === '?').length,
      };
      t.toggleMapOverlay('security');
      const noSecurity = paint();
      t.toggleMapOverlay('lanes');
      const neither = paint();
      t.toggleMapOverlay('security');
      t.toggleMapOverlay('lanes');
      return { fail: null, withBoth,
        securityOff: { queries: noSecurity.painted.filter((x) => x === '?').length },
        neither: { unknownStrokes: neither.strokes.filter(isUnknown).length },
        layers: t.MAP_OVERLAY_LAYERS.map((l) => l.key) };
    });
    assert.ok(!r.fail, `the layer reproduction could not be set up: ${r.fail}`);
    assert.ok(r.layers.includes('contracts') && r.layers.includes('lanes') && r.layers.includes('security'),
      `the objective layer and the conditions layers are not separate: ${r.layers.join(', ')}`);
    assert.ok(r.withBoth.queries > 0,
      'no system was marked as unreported on the chart; every charted system is being drawn as though something is known about it');
    assert.ok(r.withBoth.unknownStrokes > 0,
      'no lane was drawn in the unknown colour; a lane nobody has looked at is being drawn as an ordinary one');
    assert.ok(r.withBoth.painted.some((x) => /^\d+ unreported systems?$/.test(x)),
      `the legend does not count the unreported systems: ${r.withBoth.painted.filter((x) => /unreported|unknown/i.test(x)).join(' | ') || 'no such row'}`);
    assert.deepEqual(r.withBoth.painted.filter((x) => /not safe|not the same as|treat it as/i.test(x)), [],
      `the legend explains what unreported means instead of counting it: ${r.withBoth.painted.filter((x) => /not safe|not the same as/i.test(x)).join(' | ')}`);
    assert.equal(r.securityOff.queries, 0,
      'the security layer reports itself off and is still marking systems on the chart');
    assert.equal(r.neither.unknownStrokes, 0,
      'the trade-lane layer reports itself off and is still drawing lanes');
  });

  // HAIL — the star chart is drawn on a canvas at z 74, clipped to its own panel rect, and an
  // unanswered hail's panel sat under it: at 1440 the chart covered the left 200px of that panel,
  // taking part of its prose and the left end of both its buttons with it, and the chart's own close
  // control landed on what was left. Acknowledging the hail first is not a fix, it is looking away.
  await check('HAIL an unanswered hail and the open chart are both readable and clickable', async () => {
    const widths = [[1920, 1080], [1536, 864], [1440, 900], [1280, 800]];
    const trouble = [];
    for (const [width, height] of widths) {
      await fresh(`play-hail-${width}`);
      await page.setViewportSize({ width, height });
      await page.waitForTimeout(220);
      const r = await ev(() => {
        const t = testBM1, s = t.state;
        // Stand in a foreign checkpoint's approach with the arrival hail unanswered, then open the
        // chart on top of it — the state the captain is actually in when they check the map.
        const target = t.getSystemIndexByName('Qonos');
        s.currentPlanet = target;
        t.applySystemState(target);
        t.placePlayerAtSecurityApproach();
        t.updateSecurityOrderPanel();
        const hailEl = document.getElementById('security-order-panel');
        if (!hailEl || hailEl.classList.contains('hidden')) return { fail: 'no hail is up to test against' };
        t.openMap();
        t.updateSecurityOrderPanel();
        t.drawInterstellarMapOverlay();
        const view = document.getElementById('game').getBoundingClientRect();
        const toScreen = (v) => view.left + v * (view.width / document.getElementById('game').width);
        const panel = t.getStarChartPanelRect();
        const chart = { left: toScreen(panel.left), right: toScreen(panel.right) };
        const hail = hailEl.getBoundingClientRect();
        const closeEl = document.getElementById('btn-close-map');
        const close = closeEl ? closeEl.getBoundingClientRect() : null;
        const hits = (el, box) => {
          if (!box || box.width <= 0) return false;
          const at = document.elementFromPoint(Math.round(box.left + box.width / 2), Math.round(box.top + box.height / 2));
          return Boolean(at && (at === el || el.contains(at) || at.contains(el)));
        };
        const ack = hailEl.querySelector('[data-arrival-ack]');
        const channels = hailEl.querySelector('[data-comms="open"]');
        const overlaps = (a, b) => a && b && a.left < b.right && a.right > b.left && a.top < b.bottom && a.bottom > b.top;
        return { fail: null,
          chartOverHail: chart.right > hail.left,
          closeOverHail: overlaps(close, hail),
          ackHit: hits(ack, ack?.getBoundingClientRect()),
          channelsHit: hits(channels, channels?.getBoundingClientRect()),
          closeHit: close ? hits(closeEl, close) : false,
          chartWidth: Math.round(chart.right - chart.left),
          hailLeft: Math.round(hail.left), chartRight: Math.round(chart.right) };
      });
      if (r.fail) { trouble.push(`${width}px: ${r.fail}`); continue; }
      if (r.chartOverHail) trouble.push(`${width}px: the chart runs to ${r.chartRight} and the hail begins at ${r.hailLeft}, so ${r.chartRight - r.hailLeft}px of that panel is painted over`);
      if (r.closeOverHail) trouble.push(`${width}px: the chart's close control sits on the hail panel`);
      if (!r.ackHit) trouble.push(`${width}px: "Acknowledge hail" does not answer a click at its own coordinates`);
      if (!r.channelsHit) trouble.push(`${width}px: "Station channels" does not answer a click at its own coordinates`);
      if (!r.closeHit) trouble.push(`${width}px: the chart's own close control does not answer a click at its own coordinates`);
      if (r.chartWidth < 300) trouble.push(`${width}px: the chart gave way down to ${r.chartWidth}px, which is not a map`);
    }
    await page.setViewportSize({ width: 1280, height: 800 });
    assert.deepEqual(trouble, [], trouble.join('; '));
  });

  // STALE-TRUTH — the first cut of the conditions layer stored only the *day* of a visit and then
  // rendered today's truth beneath it, so a world whose stations were destroyed, whose government
  // changed and whose market collapsed after the captain left showed the new reality stamped with the
  // old date. That is not a stale reading; it is a leak wearing one's clothes.
  await check('STALE-TRUTH a world changed behind the captain\'s back still shows what they saw', async () => {
    await fresh('play-stale');
    const r = await ev(() => {
      const t = testBM1, s = t.state;
      // No precondition on the record existing: a tree without one still runs this and fails on what it
      // shows, which is the point — the numbers are the evidence, not the absence of a function.
      if (!t.conditionsFor) return { fail: 'this tree has no conditions layer at all' };
      const home = Number(s.currentPlanet);
      const A = (s.planets || []).map((p, i) => i).find((i) => i !== home && t.isChartSystemVisible(i));
      if (A == null) return { fail: 'no second charted world to observe' };
      // Observe it, standing in it.
      s.day = 20;
      s.currentPlanet = A; t.applySystemState(A); t.markSystemVisited(A);
      const observed = t.conditionsFor(A);
      const record = t.conditionLog ? JSON.parse(JSON.stringify(t.conditionLog()[A] || null)) : null;
      // Leave, and let the world turn over without telling them.
      s.currentPlanet = home; t.applySystemState(home);
      s.day = 80;
      for (const d of (s.stationDefinitions || []).filter((x) => Number(x.systemIndex) === A)) s.destroyedStations[d.id] = true;
      s.planets[A].market = 1;
      s.factionSystemOverrides = { ...(s.factionSystemOverrides || {}), [A]: 'klingon' };
      t.campaignBook().operations.push({ id: 'stale-op', faction: 'klingon', kind: 'assault', targetSystem: A,
        status: 'engaged', createdDay: s.day, arriveDay: s.day, hullIds: [], committed: 4 });
      const shown = t.conditionsFor(A);
      const staleReadout = t.conditionsReadout(A);
      const truthNow = { traffic: t.trueTradeTraffic(A).band, disruption: t.trueDisruption(A).band, threat: t.trueThreat(A).band };
      // And it survives being put down and picked up.
      t.saveGame(7); t.loadGame(7);
      const afterLoad = t.conditionsFor(A);
      // Then somebody finally tells them.
      s.currentPlanet = A; t.applySystemState(A); t.markSystemVisited(A);
      const refreshed = t.conditionsFor(A);
      return { fail: null, A, record,
        observed: { traffic: observed.traffic?.band, disruption: observed.disruption?.band },
        shown: { source: shown.source, age: shown.ageDays, asOf: shown.asOfDay,
          traffic: shown.traffic?.band, trafficWhy: shown.traffic?.why,
          disruption: shown.disruption?.band, threat: shown.threat?.band },
        truthNow,
        afterLoad: { traffic: afterLoad.traffic?.band, disruption: afterLoad.disruption?.band, asOf: afterLoad.asOfDay },
        refreshed: { source: refreshed.source, traffic: refreshed.traffic?.band, disruption: refreshed.disruption?.band, age: refreshed.ageDays },
        readout: staleReadout };
    });
    assert.ok(!r.fail, `the stale-truth reproduction could not be set up: ${r.fail}`);
    assert.equal(r.shown.source, 'rumour', `after leaving, the system reports as "${r.shown.source}"`);
    assert.equal(r.shown.asOf, 20, `the reading is dated day ${r.shown.asOf} rather than the day it was taken`);
    assert.equal(r.shown.age, 60, `the reading is ${r.shown.age} days old rather than 60`);

    // The three that were changed behind their back.
    assert.equal(r.shown.traffic, r.observed.traffic,
      `trade reads ${r.shown.traffic} after the market collapsed and the flag changed; it should still read what was seen (${r.observed.traffic})`);
    assert.notEqual(r.shown.traffic, r.truthNow.traffic,
      `trade reads today's truth (${r.truthNow.traffic}) under a 60-day-old date`);
    assert.equal(r.shown.disruption, r.observed.disruption,
      `disruption reads ${r.shown.disruption} after every installation was destroyed; it should still read what was seen (${r.observed.disruption})`);
    assert.notEqual(r.shown.disruption, r.truthNow.disruption,
      `disruption reads today's truth (${r.truthNow.disruption}) under a 60-day-old date`);
    assert.equal(r.shown.threat, undefined,
      `a force engaged at the system after the captain left is on their chart anyway (threat ${r.shown.threat})`);
    assert.ok(r.readout.some((l) => /observed day 20/.test(l) && /60 days old/.test(l)),
      `the readout does not say when the reading was taken: ${JSON.stringify(r.readout)}`);

    assert.ok(r.record && r.record.day === 20,
      `nothing was written down when the captain stood in the system, so there is nothing to show them later: ${JSON.stringify(r.record)}`);
    assert.equal(r.afterLoad.asOf, 20, 'the record did not survive a save and a reload');
    assert.equal(r.afterLoad.traffic, r.observed.traffic, 'the remembered trade reading changed across a reload');
    assert.equal(r.afterLoad.disruption, r.observed.disruption, 'the remembered disruption reading changed across a reload');

    // And going back replaces it.
    assert.equal(r.refreshed.source, 'local', 'standing in the system again did not make it a live reading');
    assert.equal(r.refreshed.age, 0, `going back left the reading ${r.refreshed.age} days old`);
    assert.equal(r.refreshed.disruption, r.truthNow.disruption,
      `going back still shows the old disruption reading (${r.refreshed.disruption}) rather than what is there (${r.truthNow.disruption})`);
  });

  // LIVE-INVALIDATION — the conditions cache was keyed on counts, so a station could be wrecked
  // without changing how many were destroyed, an operation could go from moving to engaged without
  // changing how many there were, and a ship could move without changing how many there were. The
  // captain would be standing in the system watching it happen and the chart would not move.
  await check('LIVE-INVALIDATION what the captain is watching changes on the chart at once', async () => {
    await fresh('play-live');
    const r = await ev(() => {
      const t = testBM1, s = t.state;
      if (!t.conditionsFor) return { fail: 'this tree has no conditions layer at all' };
      const here = Number(s.currentPlanet);
      const book = t.campaignBook();
      s.day = 30;
      const day = s.day;
      const base = t.conditionsFor(here);
      // A station wrecked but not destroyed: the count of destroyed stations does not move.
      const destroyedBefore = Object.keys(s.destroyedStations || {}).length;
      const def = (s.stationDefinitions || []).find((d) => Number(d.systemIndex) === here);
      book.stationDamage[def.id] = 0.5;
      const damaged = t.conditionsFor(here);
      const destroyedAfter = Object.keys(s.destroyedStations || {}).length;
      // An operation arriving, then engaging: the count of operations does not move on the second.
      book.operations.push({ id: 'live-op', faction: 'klingon', kind: 'assault', targetSystem: here,
        status: 'moving', createdDay: day, arriveDay: day + 3, hullIds: [], committed: 3 });
      const moving = t.conditionsFor(here);
      const opCount = book.operations.length;
      book.operations.find((o) => o.id === 'live-op').status = 'engaged';
      const engaged = t.conditionsFor(here);
      // A ship moving between systems: the size of the fleet does not move.
      const others = (s.planets || []).map((p, i) => i).filter((i) => i !== here && t.isChartSystemVisible(i)).slice(0, 2);
      for (const i of others) t.markSystemVisited(i);
      s.playerFleet.push({ id: 'live-eyes', shipId: 1, faction: 'terran', assignment: 'patrol',
        systemIndex: others[0], vessel: { hull: 100, condition: 'ready' } });
      const atFirst = [t.conditionsFor(others[0]).source, t.conditionsFor(others[1]).source];
      const fleetSize = s.playerFleet.length;
      s.playerFleet.find((f) => f.id === 'live-eyes').systemIndex = others[1];
      const atSecond = [t.conditionsFor(others[0]).source, t.conditionsFor(others[1]).source];
      return { fail: null, day, dayStill: s.day,
        destroyedUnchanged: destroyedBefore === destroyedAfter,
        disruption: [base.disruption?.band, damaged.disruption?.band],
        opCountUnchanged: opCount === book.operations.length,
        threat: [base.threat?.band, moving.threat?.band, engaged.threat?.band],
        movingWhy: moving.threat?.why, engagedWhy: engaged.threat?.why,
        fleetSizeUnchanged: fleetSize === s.playerFleet.length,
        atFirst, atSecond };
    });
    assert.ok(!r.fail, `the invalidation reproduction could not be set up: ${r.fail}`);
    assert.equal(r.dayStill, r.day, 'precondition: the day did not advance during this check');

    assert.equal(r.destroyedUnchanged, true, 'precondition: wrecking a station did not change how many are destroyed');
    assert.ok(r.disruption[1] > r.disruption[0],
      `a station was wrecked in front of the captain and disruption stayed at ${r.disruption[0]}`);

    assert.ok(r.threat[1] > (r.threat[0] ?? 0) || /inbound/.test(String(r.movingWhy)),
      `a force set out for this system and the threat reading stayed at ${r.threat[0]}`);
    assert.equal(r.opCountUnchanged, true, 'precondition: engaging did not change how many operations there are');
    assert.ok(r.threat[2] > r.threat[1],
      `the force engaged in front of the captain and the threat reading stayed at ${r.threat[1]}`);
    assert.ok(/engaged/.test(String(r.engagedWhy)),
      `the reading does not say the force engaged: "${r.engagedWhy}"`);

    assert.equal(r.fleetSizeUnchanged, true, 'precondition: moving a ship did not change the size of the fleet');
    assert.equal(r.atFirst[0], 'fleet',
      `with the ship at the first system it reads "${r.atFirst[0]}"`);
    assert.notEqual(r.atFirst[1], 'fleet',
      'the second system reads as having a ship on station before one arrived');
    assert.equal(r.atSecond[1], 'fleet',
      `after the ship moved, the second system reads "${r.atSecond[1]}" — the cache did not notice`);
    assert.notEqual(r.atSecond[0], 'fleet',
      `after the ship left, the first system still reads "${r.atSecond[0]}"`);
  });


  // TRADE-1 — a fleet ship set to trade did nothing: fleet ships had no autonomous trading at all, so
  // an order to trade left the ship parked and the captain's account untouched.
  await check('TRADE a fleet ship ordered to trade buys, carries and sells on its own', async () => {
    await fresh('play-trade-run');
    const r = await ev(() => {
      const t = testBM1, s = t.state;
      window.__tradeSetup({});
      const ship = window.__tradeShip('gate-trade-1', { big: true });
      if (typeof t.startFleetTrading !== 'function') return { ordered: false, reason: 'no trade order exists on a fleet ship' };
      const before = s.latinum;
      t.startFleetTrading('gate-trade-1', 'any');
      // Long enough for a call to happen: legs run to sixty-odd days each across this galaxy, so a
      // sixty-day window measured the calendar rather than whether the ship trades.
      window.__tradeDays(150);
      const f = s.playerFleet.find((x) => x.id === 'gate-trade-1');
      const trade = f && f.trade;
      return {
        ordered: true, capacity: ship.capacity, before, after: s.latinum,
        cumulative: trade ? trade.cumulative : 0,
        moved: f ? Number(f.systemIndex) !== Number(s.currentPlanet) || Boolean(f.transit) : false,
        captainHold: (s.cargoArray || []).reduce((n, pod) => n + Number(pod.tons || 0), 0),
        reason: '',
      };
    });
    assert.ok(r.ordered, `a fleet ship was ordered to trade and nothing took the order: ${r.reason}`);
    assert.ok(r.moved, 'the trader was ordered out and never left the system it was parked in');
    assert.ok(r.cumulative > 0,
      `the trader ran for 150 days and has ${r.cumulative} latinum of realised profit to show for it`);
    assert.ok(r.after > r.before,
      `the captain had ${r.before} latinum before the run and ${r.after} after`);
    assert.equal(r.captainHold, 0,
      `${r.captainHold} tons of the trader's cargo is sitting in the captain's own hold, where it can be sold a second time`);
  });

  // TRADE-2 — the hold was ignored: a ship's cargo capacity did not limit what it carried, so profit
  // did not scale with the ship the captain sent.
  await check('TRADE the hold a ship actually has limits what it carries and earns', async () => {
    await fresh('play-trade-capacity');
    const r = await ev(() => {
      const t = testBM1, s = t.state;
      window.__tradeSetup({});
      const small = window.__tradeShip('gate-cap-small', { hold: 25, seed: 4 });
      const big = window.__tradeShip('gate-cap-big', { big: true, seed: 4 });
      const plan = t.planFleetTradeCircuit || t.planFleetTradeRun;
      if (typeof plan !== 'function') return { planned: false, reason: 'no trade planner exists' };
      const load = (p) => p && p.manifest ? p.manifest.reduce((n, m) => n + m.tons, 0) : (p ? p.tons : 0);
      // Planning commits: it claims shipments off the world's book and buys cargo off its shelf. So the
      // two ships are measured against the same world in the same state, one after a reset, rather than
      // one after the other has already taken the work.
      const measure = (id, big) => {
        s.worldJobs = {}; s.marketStock = {};
        s.latinum = 200000; s.mylatinum = s.latinum;
        s.playerFleet.length = 0;
        const ship = window.__tradeShip(id, big ? { big: true, seed: 4 } : { hold: 25, seed: 4 });
        const f = s.playerFleet.find((x) => x.id === id);
        const p = plan(f, t.ensureFleetTradeState(f, 'any'), s.day);
        const jobs = typeof t.worldOpenJobs === 'function' ? t.worldOpenJobs(s.currentPlanet) : [];
        return { cap: ship.capacity, ok: p.ok, note: p.note, load: p.ok ? load(p.plan) : 0,
          took: p.ok ? (p.plan.manifest || []).filter((m) => m.kind === 'job').map((m) => m.tons) : [],
          offered: jobs.map((j) => j.tons) };
      };
      const smallRun = measure('gate-cap-small', false);
      const bigRun = measure('gate-cap-big', true);
      return { planned: true, small: smallRun, big: bigRun, reason: '' };
    });
    assert.ok(r.planned, `nothing plans a trade run: ${r.reason}`);
    assert.ok(r.big.cap > r.small.cap, `precondition: both test ships have the same hold (${r.small.cap})`);
    assert.ok(r.big.ok, `the larger ship found no work at all: ${r.big.note}`);
    assert.ok(r.small.load <= r.small.cap,
      `a ${r.small.cap}-ton hold was loaded with ${r.small.load} tons`);
    assert.ok(r.big.load <= r.big.cap,
      `a ${r.big.cap}-ton hold was loaded with ${r.big.load} tons`);
    assert.ok(r.big.load > r.small.load,
      `the ${r.big.cap}-ton ship loads ${r.big.load} tons and the ${r.small.cap}-ton ship loads ${r.small.load} — the hold is not being read`);
    assert.ok(r.small.took.every((tons) => tons <= r.small.cap),
      `the ${r.small.cap}-ton ship accepted shipments of ${r.small.took.join(', ')} tons`);
  });

  // TRADE-3 — the danger setting did nothing: every setting considered the same destinations, so
  // "Safe" was a label rather than a constraint, and a world nobody had ever reported on counted as
  // quiet.
  await check('TRADE the danger setting decides where a trader is willing to go', async () => {
    await fresh('play-trade-risk');
    const r = await ev(() => {
      const t = testBM1, s = t.state;
      window.__tradeSetup({});
      window.__tradeShip('gate-risk-1', { big: true });
      if (typeof t.fleetTradeCandidates !== 'function') return { gated: false, reason: 'a trader has no danger setting' };
      const f = s.playerFleet.find((x) => x.id === 'gate-risk-1');
      const counts = {};
      const sets = {};
      for (const level of ['safe', 'cautious', 'risky', 'any']) {
        const list = t.fleetTradeCandidates(f, t.ensureFleetTradeState(f, level));
        counts[level] = list.length; sets[level] = list;
      }
      // a world nobody has reported on, whose flag the captain has no reason to doubt
      const unreported = sets.safe[0];
      delete s.conditionLog[unreported];
      s.conditionsRev = (Number(s.conditionsRev) || 0) + 1;
      const after = {};
      for (const level of ['safe', 'cautious', 'risky', 'any'])
        after[level] = t.fleetTradeCandidates(f, t.ensureFleetTradeState(f, level)).includes(unreported);
      // ...and a destination whose route crosses charted, unreported space the captain has reason to
      // doubt — a system charted under a flag that refuses the captain. Cautious may cross what nobody
      // has reported on, but not what is known to be hostile; Any crosses anything.
      let hostileFlag = null;
      if (typeof t.unreportedSystemDoubt === 'function' && typeof t.fleetTradeRouteAcceptable === 'function') {
        const from = Number(s.currentPlanet);
        for (let i = 0; i < s.planets.length && !hostileFlag; i++) {
          if (i === from || !t.worldTrades(i) || t.serviceRefusal(t.getSystemFaction(i))) continue;
          const risk = t.plannedRouteRisk(from, i);
          if (!risk || !risk.unreported.length) continue;
          if (risk.worst && risk.worst.band > 1) continue;
          const doubts = risk.unreported.map((k) => t.unreportedSystemDoubt(k));
          if (!doubts.includes('hostile-flag')) continue;
          hostileFlag = { to: i, name: s.planets[i]?.name, doubts,
            cautious: Boolean(t.fleetTradeRouteAcceptable(f, t.ensureFleetTradeState(f, 'cautious'), from, i)),
            any: Boolean(t.fleetTradeRouteAcceptable(f, t.ensureFleetTradeState(f, 'any'), from, i)) };
        }
      }
      return { gated: true, counts, unreported, after, hostileFlag, safeSubsetOfAny: sets.safe.every((i) => sets.any.includes(i)), reason: '' };
    });
    assert.ok(r.gated, `the danger setting is not consulted: ${r.reason}`);
    assert.ok(r.counts.any > r.counts.safe,
      `Safe and Any consider the same ${r.counts.safe} destinations, so the setting changes nothing`);
    assert.ok(r.counts.cautious >= r.counts.safe && r.counts.risky >= r.counts.cautious && r.counts.any >= r.counts.risky,
      `the settings are not ordered: safe ${r.counts.safe}, cautious ${r.counts.cautious}, risky ${r.counts.risky}, any ${r.counts.any}`);
    assert.ok(r.safeSubsetOfAny, 'a destination Safe accepts is refused by Any');
    assert.equal(r.after.safe, false,
      `system ${r.unreported} has no report at all and a Safe trader will still run to it`);
    // Cautious, as reviewed: charted space nobody has reported on is open to her unless what the
    // captain knows says otherwise.
    assert.equal(r.after.cautious, true,
      `system ${r.unreported} is charted, nobody has reported on it and nothing the captain knows says it is hostile, and a Cautious trader will not run to it`);
    assert.equal(r.after.any, true,
      `system ${r.unreported} is refused by Any, which accepts everything`);
    assert.ok(r.hostileFlag, 'a Cautious trader has no notion of a charted flag to doubt an unreported system by');
    assert.equal(r.hostileFlag.cautious, false,
      `the route to ${r.hostileFlag.name} crosses unreported space charted under a flag that refuses the captain (${r.hostileFlag.doubts.join(', ')}), and a Cautious trader will still fly it`);
    assert.equal(r.hostileFlag.any, true, `Any refuses the route to ${r.hostileFlag.name}; Any accepts everything`);
  });

  // TRADE-4 — the planner read the world instead of the captain's records: it priced runs off markets
  // the captain had never looked at, which both invents knowledge and starts prices drifting on worlds
  // nobody has visited.
  await check('TRADE a trader plans on prices the captain has read, and sells at the ones that are there', async () => {
    await fresh('play-trade-stale');
    const r = await ev(() => {
      const t = testBM1, s = t.state;
      const setup = window.__tradeSetup({ learn: 12 });
      window.__tradeShip('gate-stale-1', { big: true });
      const planner = t.planFleetTradeCircuit || t.planFleetTradeRun;
      if (typeof planner !== 'function') return { planned: false, reason: 'no trade planner exists' };
      // This check is about commodity pricing, so the world's book of shipments is emptied first:
      // otherwise a circuit is all contract cargo and there is nothing priced off a remembered board.
      if (s.worldJobs) s.worldJobs[s.currentPlanet] = { day: s.day, jobs: [], seq: 1 };
      const f = s.playerFleet.find((x) => x.id === 'gate-stale-1');
      const knownBefore = Object.keys(s.marketLog || {}).map(Number).sort((a, b) => a - b);
      const plan = planner(f, t.ensureFleetTradeState(f, 'any'), s.day);
      const knownAfter = Object.keys(s.marketLog || {}).map(Number).sort((a, b) => a - b);
      const boardsAfter = Object.keys(s.planetMarkets || {}).map(Number).sort((a, b) => a - b);
      if (!plan.ok) return { planned: true, ran: false, note: plan.note, knownBefore, knownAfter, boardsAfter };
      // The circuit planner returns a manifest; the single-run planner it replaced returned one lot.
      const lot = (plan.plan.manifest || []).find((m) => m.kind === 'goods')
        || (plan.plan.goods ? { goods: plan.plan.goods, tons: plan.plan.tons, to: plan.plan.to } : null);
      if (!lot) return { planned: true, ran: false, note: 'no commodity lot in the planned run', knownBefore, knownAfter, boardsAfter };
      const dest = lot.to, goods = lot.goods;
      const remembered = t.knownMarketPrice(dest, goods);
      const before = s.latinum;
      if (typeof t.beginFleetTradeCircuit === 'function') t.beginFleetTradeCircuit(f, f.trade, plan.plan, s.day);
      else t.beginFleetTradeLeg(f, f.trade, plan.plan, s.day);
      f.trade.active = true;
      const paid = f.trade.paid;
      // the destination's board collapses while the run is committed
      t.getPlanetMarket(dest);
      const bound = new Set((f.trade.manifest || []).filter((m) => Number(m.to) === Number(dest)).map((m) => m.goods));
      for (const o of s.planetMarkets[dest]) if (bound.has(o.goods)) o.price = 1;
      // stop after this circuit so the run being measured is the one that was priced
      t.stopFleetTrading('gate-stale-1');
      let guard = 0;
      while (f.trade.stage === 'outbound' && guard++ < 200) window.__tradeDays(1);
      return { planned: true, ran: true, dest, goods, remembered, paid, before, after: s.latinum,
        trip: f.trade.tripProfit, stage: f.trade.stage, knownBefore, knownAfter, boardsAfter, learned: setup.learned.length };
    });
    assert.ok(r.planned, `nothing plans a trade run: ${r.reason}`);
    assert.deepEqual(r.knownAfter, r.knownBefore,
      `planning a run added ${r.knownAfter.length - r.knownBefore.length} worlds to what the captain knows about prices`);
    assert.ok(r.boardsAfter.every((i) => r.knownBefore.includes(i)),
      `planning a run opened the market on ${r.boardsAfter.filter((i) => !r.knownBefore.includes(i)).join(', ')}, which the captain has never read`);
    assert.ok(r.ran, `no run was available to price: ${r.note}`);
    assert.ok(r.remembered > 1,
      `precondition: the remembered price at ${r.dest} was already ${r.remembered}`);
    assert.ok(r.trip < 0,
      `${r.goods} was remembered at ${r.remembered} and is selling at 1; the circuit booked ${r.trip} latinum instead of a loss`);
  });

  // TRADE-5 — the leg was rolled against the captain's own records, so a route that looked quiet on a
  // dated reading could never turn out to be anything else.
  await check('TRADE a route that looked quiet is flown against what is actually there', async () => {
    await fresh('play-trade-danger');
    const r = await ev(() => {
      const t = testBM1, s = t.state;
      window.__tradeSetup({});
      window.__tradeShip('gate-danger-1', { big: true });
      if (typeof t.resolveFleetTradeLegRisk !== 'function') return { rolled: false, reason: 'a trade leg carries no risk at all' };
      const f = s.playerFleet.find((x) => x.id === 'gate-danger-1');
      t.ensureFleetTradeState(f, 'safe');
      const planner = t.planFleetTradeCircuit || t.planFleetTradeRun;
      if (typeof planner !== 'function') return { rolled: false, reason: 'a trade leg carries no risk at all' };
      const plan = planner(f, f.trade, s.day);
      if (!plan.ok) return { rolled: true, sampled: false, note: plan.note };
      const dest = plan.plan.stops ? plan.plan.stops[0] : plan.plan.to;
      const recordedBefore = t.plannedRiskBand(dest);
      t.transferSystemControlToFaction(dest, 'pirate');
      const recordedAfter = t.plannedRiskBand(dest);
      const truth = { threat: t.trueThreat(dest).band, protection: t.trueProtection(dest).band };
      const stillChosen = t.fleetTradeCandidates(f, f.trade).includes(dest);
      const outcomes = { none: 0, damaged: 0, disabled: 0, destroyed: 0 };
      for (let k = 0; k < 120; k++) {
        const probe = { id: `gate-danger-p${k}`, shipId: f.shipId, name: `Probe ${k}`, faction: s.playerFaction,
          assignment: 'defense', systemIndex: dest, seed: k };
        const pt = t.ensureFleetTradeState(probe, 'safe');
        pt.origin = plan.plan.to === dest ? Number(s.currentPlanet) : 0;
        pt.etaDay = 400 + k; pt.tons = 5; pt.paid = 25; pt.active = true; pt.stage = 'outbound';
        s.playerFleet.push(probe);
        outcomes[t.resolveFleetTradeLegRisk(probe, pt, dest) || 'none']++;
        s.playerFleet = s.playerFleet.filter((x) => x.id !== probe.id);
      }
      return { rolled: true, sampled: true, dest, recordedBefore, recordedAfter, truth, stillChosen, outcomes };
    });
    assert.ok(r.rolled, `a trade leg carries no risk: ${r.reason}`);
    assert.ok(r.sampled, `no Safe run was available to test: ${r.note}`);
    assert.equal(r.recordedBefore.band, 0,
      `precondition: the destination did not read as quiet (band ${r.recordedBefore.band})`);
    assert.equal(r.recordedAfter.band, 0,
      `the captain's dated record changed by itself when the world changed hands — it now reads band ${r.recordedAfter.band}`);
    assert.ok(r.truth.threat > 0,
      'precondition: handing the destination to pirates did not make it dangerous');
    assert.equal(r.stillChosen, true,
      'the trader stopped choosing a destination it has no way of knowing changed hands');
    assert.ok(r.outcomes.damaged + r.outcomes.disabled + r.outcomes.destroyed > 0,
      `120 legs were flown into a pirate-held system the records call quiet and not one ship was touched`);
    assert.ok(r.outcomes.none > 0,
      'every single leg into that system ended in an attack, which is not a risk, it is a wall');
  });

  // TRADE-6 — standing did not reach the trader: a ship would run cargo to a government that will not
  // deal with the captain, and sell it there anyway.
  await check('TRADE a government that refuses the captain refuses their freighters', async () => {
    await fresh('play-trade-refusal');
    const r = await ev(() => {
      const t = testBM1, s = t.state;
      window.__tradeSetup({});
      window.__tradeShip('gate-refuse-1', { big: true });
      if (typeof t.fleetTradeCandidates !== 'function' || typeof (t.fleetTradeCall || t.completeFleetTradeSale) !== 'function')
        return { checked: false, reason: 'a trader does not consult standing' };
      const f = s.playerFleet.find((x) => x.id === 'gate-refuse-1');
      t.ensureFleetTradeState(f, 'any');
      const before = t.fleetTradeCandidates(f, f.trade);
      const target = before.find((i) => {
        const key = s.conditionLog[i]?.controller;
        return key && key !== 'neutral' && key !== s.playerFaction;
      }) ?? before.find((i) => t.getSystemFaction(i) && t.getSystemFaction(i) !== 'neutral');
      if (target == null) return { checked: true, found: false };
      const faction = s.conditionLog[target]?.controller || t.getSystemFaction(target);
      t.adjustFactionStanding(faction, -100, { silent: true });
      const after = t.fleetTradeCandidates(f, f.trade);
      // and a trader already standing there is turned away rather than selling
      f.systemIndex = target;
      const trade = t.ensureFleetTradeState(f, 'any');
      const goods = t.knownMarket(target).offers[0].goods;
      trade.manifest = [{ kind: 'goods', goods, tons: 5, to: target, unit: 5, paid: 25 }];
      trade.stops = [target]; trade.path = [target]; trade.legDays = [1]; trade.legIndex = 0;
      trade.paid = 25; trade.stage = 'outbound'; trade.active = true; trade.destination = target;
      const purse = s.latinum;
      const call = t.fleetTradeCall || t.completeFleetTradeSale;
      call(f, trade, target, s.day);
      const stillAboard = typeof t.fleetTradeLoad === 'function' ? t.fleetTradeLoad(trade) : trade.tons;
      return { checked: true, found: true, target, faction, refusal: t.serviceRefusal(faction),
        had: before.includes(target), still: after.includes(target), stillAboard, purse, after: s.latinum, note: trade.note };
    });
    assert.ok(r.checked, `standing never reaches a trader: ${r.reason}`);
    assert.ok(r.found, 'precondition: no governed destination was available to refuse the captain');
    assert.ok(r.refusal, `precondition: dropping ${r.faction} standing to the floor did not make them refuse the captain`);
    assert.equal(r.had, true, `precondition: system ${r.target} was not a candidate to begin with`);
    assert.equal(r.still, false,
      `${r.faction} will not deal with the captain and their freighters are still being sent to system ${r.target}`);
    assert.equal(r.after, r.purse,
      `a refused call still paid the captain ${r.after - r.purse} latinum`);
    assert.equal(r.stillAboard, 5,
      `the cargo was unloaded at a port that refuses the captain: ${r.stillAboard} of 5 tons left aboard`);
    assert.ok(/refuse/i.test(String(r.note)), `the trader does not record why the call failed: "${r.note}"`);
  });

  // TRADE-7 — trade orders and remembered prices did not survive a reload: a saved campaign came back
  // with its traders parked and its price records blank.
  await check('TRADE orders, cargo, profit and remembered prices survive a reload', async () => {
    await fresh('play-trade-persist');
    const r = await ev(() => {
      const t = testBM1, s = t.state;
      window.__tradeSetup({});
      window.__tradeShip('gate-persist-1', { big: true });
      if (typeof t.startFleetTrading !== 'function') return { saved: false, reason: 'there is no trade order to save' };
      t.startFleetTrading('gate-persist-1', 'risky');
      window.__tradeDays(30);
      const f = s.playerFleet.find((x) => x.id === 'gate-persist-1');
      const before = { trade: JSON.parse(JSON.stringify(f.trade || null)), markets: Object.keys(s.marketLog || {}).length };
      t.saveGame(9);
      t.startWithFaction('terran');
      const wiped = { fleet: s.playerFleet.length, markets: Object.keys(s.marketLog || {}).length };
      t.loadGame(9);
      const g = s.playerFleet.find((x) => x.id === 'gate-persist-1');
      return { saved: true, before, wiped, after: { trade: g ? JSON.parse(JSON.stringify(g.trade || null)) : null, markets: Object.keys(s.marketLog || {}).length } };
    });
    assert.ok(r.saved, `${r.reason}`);
    assert.ok(r.before.markets > 0, 'precondition: the captain had read no markets to remember');
    assert.equal(r.wiped.markets, 0, 'precondition: starting a new campaign kept the old price records');
    assert.ok(r.after.trade, 'the trader came back from the save with no trade order at all');
    assert.equal(r.after.trade.risk, r.before.trade.risk,
      `the danger setting came back as ${r.after.trade.risk} instead of ${r.before.trade.risk}`);
    assert.equal(r.after.trade.cumulative, r.before.trade.cumulative,
      `cumulative profit came back as ${r.after.trade.cumulative} instead of ${r.before.trade.cumulative}`);
    assert.equal(r.after.trade.tons, r.before.trade.tons,
      `the ${r.before.trade.tons} tons in the hold came back as ${r.after.trade.tons}`);
    assert.equal(r.after.markets, r.before.markets,
      `${r.before.markets} remembered markets came back as ${r.after.markets}`);
  });


  // TRADE-8 — only the destination was looked at: a Safe trader was routed straight through a system
  // its own records call dangerous, because the risk test stopped at the far end of the route.
  await check('TRADE the danger on a run is the danger on the whole route', async () => {
    await fresh('play-trade-route');
    const r = await ev(() => {
      const t = testBM1, s = t.state;
      window.__tradeSetup({});
      window.__tradeShip('gate-route-1', { big: true });
      if (typeof t.fleetTradeCandidates !== 'function') return { built: false, reason: 'a trader has no route risk at all' };
      const f = s.playerFleet.find((x) => x.id === 'gate-route-1');
      const home = Number(s.currentPlanet);
      // A destination the captain's own records call quiet, reached through a system those same records
      // call dangerous. Both readings are the ones already written by looking at those worlds; nothing
      // is planted.
      let pair = null;
      for (let d = 0; d < s.planets.length && !pair; d++) {
        if (d === home || !t.knownMarket(d)) continue;
        const db = t.plannedRiskBand(d);
        if (!db || db.band !== 0 || t.trueThreat(d).band !== 0) continue;
        const route = t.getPlottedRoute(home, d);
        if (!route) continue;
        for (const i of (route.systems || []).map(Number)) {
          if (i === home || i === d) continue;
          const vb = t.plannedRiskBand(i);
          if (vb && vb.band > 0) { pair = { dest: d, via: i }; break; }
        }
      }
      if (!pair) return { built: true, found: false };
      // and it is dangerous in fact as well as on paper, so the run has something to be flown into
      t.transferSystemControlToFaction(pair.via, 'pirate');
      const viaBand = t.plannedRiskBand(pair.via);
      const destBand = t.plannedRiskBand(pair.dest);
      const safe = t.fleetTradeCandidates(f, t.ensureFleetTradeState(f, 'safe'));
      const any = t.fleetTradeCandidates(f, t.ensureFleetTradeState(f, 'any'));
      // and the run itself: arrivals at a destination that is genuinely quiet, flown through that system
      const truthVia = { threat: t.trueThreat(pair.via).band, protection: t.trueProtection(pair.via).band };
      const truthDest = { threat: t.trueThreat(pair.dest).band, protection: t.trueProtection(pair.dest).band };
      let touched = 0, flown = 0;
      for (let k = 0; k < 60; k++) {
        const probe = { id: `gate-route-p${k}`, shipId: f.shipId, name: `Probe ${k}`, faction: s.playerFaction,
          assignment: 'defense', systemIndex: pair.via, seed: k };
        const pt = t.ensureFleetTradeState(probe, 'any');
        pt.origin = home; pt.destination = pair.dest; pt.path = [pair.via, pair.dest];
        pt.legDays = [1, 1]; pt.legIndex = 0; pt.crossed = []; pt.tripId = `route-${k}`;
        pt.etaDay = 600 + k; pt.goods = t.knownMarket(pair.dest).offers[0].goods;
        pt.tons = 1; pt.paid = 1; pt.unitPaid = 1; pt.expectedUnit = 1; pt.active = true; pt.stage = 'outbound';
        s.playerFleet.push(probe);
        s.day += 1;
        t.advanceFleetTrading(s.day);
        flown++;
        const v = probe.vessel;
        if (v && v.hull < v.maxHull) touched++;
        s.playerFleet = s.playerFleet.filter((x) => x.id !== probe.id);
      }
      return { built: true, found: true, ...pair, viaBand, destBand, truthVia, truthDest,
        safeHas: safe.includes(pair.dest), anyHas: any.includes(pair.dest), flown, touched };
    });
    assert.ok(r.built, `a trader has no route risk: ${r.reason}`);
    assert.ok(r.found, 'precondition: no destination was reachable through another system');
    assert.ok(r.viaBand && r.viaBand.band > 0,
      `precondition: handing ${r.via} to pirates and looking at it did not make the records call it dangerous`);
    assert.equal(r.destBand && r.destBand.band, 0,
      `precondition: the destination itself reads as dangerous (band ${r.destBand && r.destBand.band})`);
    assert.equal(r.anyHas, true, `precondition: system ${r.dest} is not a destination at all`);
    assert.equal(r.safeHas, false,
      `a Safe trader will run to system ${r.dest} through system ${r.via}, which its own records put at band ${r.viaBand.band}`);
    assert.ok(r.truthVia.threat > 0, 'precondition: the system in the middle is not actually dangerous');
    assert.equal(r.truthDest.threat, 0,
      `precondition: the destination is itself dangerous (band ${r.truthDest.threat}), so this proves nothing`);
    assert.ok(r.touched > 0,
      `${r.flown} runs were flown through pirate-held system ${r.via} to a quiet destination and every ship arrived unmarked`);
  });

  // TRADE-9 — a trader turned away at a port still came home with that week's prices, and planned its
  // next run on them.
  await check('TRADE a port that turns a freighter away teaches it nothing', async () => {
    await fresh('play-trade-access');
    const r = await ev(() => {
      const t = testBM1, s = t.state;
      window.__tradeSetup({});
      window.__tradeShip('gate-access-1', { big: true });
      if (typeof t.knownMarket !== 'function') return { checked: false, reason: 'a trader keeps no price records' };
      const f = s.playerFleet.find((x) => x.id === 'gate-access-1');
      const trade = t.ensureFleetTradeState(f, 'any');
      const home = Number(s.currentPlanet);
      const target = t.fleetTradeCandidates(f, trade).find((i) => {
        const key = s.conditionLog[i]?.controller;
        return key && key !== 'neutral' && key !== s.playerFaction && i !== home;
      });
      if (target == null) return { checked: true, found: false };
      const faction = s.conditionLog[target].controller;
      const goods = t.knownMarket(target).offers[0].goods;
      t.adjustFactionStanding(faction, -100, { silent: true });
      // the captain has never read this board
      delete s.marketLog[target];
      const knewBefore = Boolean(t.knownMarket(target));
      // arriving with cargo, and being turned away
      f.systemIndex = target;
      trade.manifest = [{ kind: 'goods', goods, tons: 5, to: target, unit: 5, paid: 25 }];
      trade.stops = [target]; trade.paid = 25;
      trade.destination = target; trade.path = [target]; trade.legDays = [1]; trade.legIndex = 0;
      trade.stage = 'outbound'; trade.active = true;
      const purse = s.latinum;
      t.advanceFleetTrading(s.day);
      const afterArrival = { known: Boolean(t.knownMarket(target)), purse: s.latinum, note: trade.note,
        aboard: typeof t.fleetTradeLoad === 'function' ? t.fleetTradeLoad(trade) : trade.tons };
      // and standing at a port that refuses her, planning the next run teaches her nothing either
      delete s.marketLog[target];
      const g = { id: 'gate-access-2', shipId: f.shipId, name: 'Refused', faction: s.playerFaction,
        assignment: 'defense', systemIndex: target, seed: 2 };
      s.playerFleet.push(g);
      const planner = t.planFleetTradeCircuit || t.planFleetTradeRun;
      const plan = typeof planner === 'function' ? planner(g, t.ensureFleetTradeState(g, 'any'), s.day) : { ok: false, note: 'no planner' };
      const afterPlanning = { known: Boolean(t.knownMarket(target)), ok: plan.ok, note: plan.note,
        repositioning: Boolean(plan.repositioning),
        took: plan.ok ? (plan.plan.manifest || []).length : 0 };
      return { checked: true, found: true, target, faction, goods, knewBefore, afterArrival, afterPlanning, purse };
    });
    assert.ok(r.checked, `${r.reason}`);
    assert.ok(r.found, 'precondition: no governed destination was available to refuse the captain');
    assert.equal(r.knewBefore, false, 'precondition: the price record for that world was not cleared');
    assert.ok(/refuse/i.test(String(r.afterArrival.note)),
      `precondition: the trader was not actually turned away ("${r.afterArrival.note}")`);
    assert.equal(r.afterArrival.aboard, 5, 'the cargo came off at a port that refused her');
    assert.equal(r.afterArrival.purse, r.purse, `a refused sale still paid the captain ${r.afterArrival.purse - r.purse} latinum`);
    assert.equal(r.afterArrival.known, false,
      `${r.faction} turned the freighter away at system ${r.target} and she came home with that week's prices`);
    // She may leave; she may not take on work. A plan out of a refusing port has to be a move and
    // nothing else.
    assert.equal(r.afterPlanning.took, 0,
      `a trader loaded ${r.afterPlanning.took} lots at a port that will not deal with her`);
    assert.ok(!r.afterPlanning.ok || r.afterPlanning.repositioning,
      'a trader planned a trading circuit out of a port that will not deal with her');
    assert.equal(r.afterPlanning.known, false,
      `a trader standing at a port that refuses her read its board anyway`);
  });


  // TRADE-10 — the route was persisted and every system was checked, but only after the ship had flown
  // the whole travel timer: it was never anywhere in particular on the way, so an encounter on the
  // first leg resolved on the arrival day at the far end, and the legs beyond it were rolled anyway.
  await check('TRADE a trader crosses its route leg by leg, and stops where it is stopped', async () => {
    await fresh('play-trade-route-time');
    const r = await ev(() => {
      const t = testBM1, s = t.state;
      window.__tradeSetup({});
      window.__tradeShip('gate-time-seed', { big: true });
      if (typeof t.knownMarket !== 'function' || typeof t.ensureFleetVesselSnapshot !== 'function')
        return { built: false, reason: 'fleet ships do not trade at all, so no route is ever flown' };
      const seedShip = s.playerFleet.find((x) => x.id === 'gate-time-seed');
      const home = Number(s.currentPlanet);
      // a destination at least two systems away, so there is a later leg to not fly
      let dest = null, path = null, route = null;
      for (let d = 0; d < s.planets.length && !dest; d++) {
        if (d === home || !t.knownMarket(d)) continue;
        if (t.trueThreat(d).band !== 0) continue; // the far end must be quiet, or this proves nothing
        const rt = t.getPlottedRoute(home, d);
        if (!rt) continue;
        const p = (rt.systems || []).map(Number).slice(1);
        if (p.length >= 2 && t.trueThreat(p[0]).band === 0) { dest = d; path = p; route = rt; }
      }
      if (dest == null) return { built: true, found: false };
      // make the first system on the way somewhere a freighter can be stopped
      t.transferSystemControlToFaction(path[0], 'pirate');
      const legDays = typeof t.routeLegDays === 'function'
        ? t.routeLegDays(route)
        : path.map(() => Math.max(1, t.Fleet.travelDays(route.distance / path.length)));
      const totalDays = legDays.reduce((n, d) => n + d, 0);
      const goods = t.knownMarket(dest).offers[0].goods;
      // fly the same trip with a series of ships until one of them is stopped on the first leg
      let stopped = null;
      for (let k = 0; k < 40 && !stopped; k++) {
        const probe = { id: `gate-time-p${k}`, shipId: seedShip.shipId, name: `Runner ${k}`,
          faction: s.playerFaction, assignment: 'defense', systemIndex: home, seed: k };
        const pt = t.ensureFleetTradeState(probe, 'any');
        pt.origin = home; pt.destination = dest; pt.goods = goods;
        pt.tons = 10; pt.paid = 50; pt.unitPaid = 5; pt.expectedUnit = 9;
        pt.active = true; pt.stage = 'outbound';
        pt.path = path.slice(); pt.legDays = legDays.slice(); pt.legIndex = 0;
        pt.tripId = `time-${k}`;
        s.playerFleet.push(probe);
        // A freighter that has already been knocked about: one more hit stops her. Any hit at all is
        // catastrophic from here, so what is being measured is when the encounter resolves and how far
        // she got, not whether the dice were kind.
        const snap = t.ensureFleetVesselSnapshot(probe);
        snap.hull = Math.max(1, Math.round(snap.maxHull * 0.14));
        snap.condition = 'operational';
        const departed = s.day;
        if (typeof t.scheduleFleetTradeLeg === 'function') t.scheduleFleetTradeLeg(probe, pt, home, departed);
        else { probe.assignment = 'transit'; probe.transit = { from: home, to: dest, arrivalDay: departed + totalDays }; pt.etaDay = departed + totalDays; }
        // One trip, then hold: a trader that sells and immediately departs again never leaves the
        // outbound stage, and what is being measured here is where and when this trip ended.
        pt.active = false;
        for (let n = 0; n < totalDays + 4 && pt.stage === 'outbound'; n++) window.__tradeDays(1);
        const v = probe.vessel;
        // Stopped, not scratched: a ship that took a hit and carried on is a completed trip.
        const halted = Boolean(v && v.condition !== 'operational');
        if (halted) {
          stopped = { k, departed, stoppedDay: s.day, at: Number(probe.systemIndex),
            crossed: Array.isArray(pt.crossed) ? pt.crossed.slice() : null,
            transit: Boolean(probe.transit), stage: pt.stage, active: pt.active,
            condition: v.condition, legIndex: pt.legIndex };
        }
        s.playerFleet = s.playerFleet.filter((x) => x.id !== probe.id);
        if (!stopped) { s.day = departed; }
      }
      return { built: true, found: true, home, dest, path, legDays, totalDays, stopped };
    });
    assert.ok(r.built, `the trade-timing reproduction could not be set up: ${r.reason}`);
    assert.ok(r.found, 'precondition: no destination was two systems or more away');
    assert.ok(r.legDays.length >= 2 && r.totalDays > r.legDays[0],
      `precondition: the route is one hop (legs ${JSON.stringify(r.legDays)}), so there is no later leg to skip`);
    assert.ok(r.stopped,
      `40 freighters were flown through pirate-held system ${r.path[0]} on their way to system ${r.dest}, and not one of them was touched: nothing on that route is rolled as the ship crosses it`);
    assert.equal(r.stopped.stoppedDay, r.stopped.departed + r.legDays[0],
      `she was stopped on a ${r.legDays[0]}-day first leg, but it took until day ${r.stopped.stoppedDay - r.stopped.departed} of a ${r.totalDays}-day journey to find out`);
    assert.ok(r.stopped.stoppedDay < r.stopped.departed + r.totalDays,
      `the whole ${r.totalDays}-day travel timer ran before the encounter on the first leg resolved`);
    assert.equal(r.stopped.at, r.path[0],
      `the ship was stopped but is at system ${r.stopped.at}, not at system ${r.path[0]} where it happened`);
    assert.equal(r.stopped.transit, false,
      'the ship was stopped and is still booked to arrive somewhere: the remaining travel was not cancelled');
    assert.ok(Array.isArray(r.stopped.crossed),
      'the run keeps no record of the systems it crossed, because it never crossed them one at a time');
    assert.deepEqual(r.stopped.crossed, [r.path[0]],
      `the ship was stopped on the first leg and the run crossed ${JSON.stringify(r.stopped.crossed)}`);
    assert.equal(r.stopped.legIndex, 0,
      `the ship was stopped on the first leg and the run advanced to leg ${r.stopped.legIndex}`);
  });


  // ECON-1 — a world's board was an infinite tap: it sold any quantity of anything for ever, and
  // nothing the captain or a trader bought made the slightest difference to what was there.
  await check('ECON a world sells what it has, and it comes back over time', async () => {
    await fresh('play-econ-supply');
    const r = await ev(() => {
      const t = testBM1, s = t.state;
      if (typeof t.marketSupply !== 'function') return { finite: false, reason: 'a world sells any quantity of anything' };
      window.__tradeSetup({});
      const at = Number(s.currentPlanet);
      const goods = t.getPlanetMarket(at)[0].goods;
      const cap = t.worldTradeCapability(at);
      const start = t.marketSupply(at, goods);
      const took = t.takeMarketSupply(at, goods, Math.floor(start / 2));
      const half = t.marketSupply(at, goods);
      const grab = t.takeMarketSupply(at, goods, start * 10);
      const empty = t.marketSupply(at, goods);
      const dayWas = s.day;
      s.day += 5;
      const after5 = t.marketSupply(at, goods);
      s.day += 500;
      const afterAges = t.marketSupply(at, goods);
      return { finite: true, at, goods, cap: cap.tons, replenish: cap.replenish, start, took, half, grab, empty,
        after5, afterAges, dayWas };
    });
    assert.ok(r.finite, `${r.reason}`);
    assert.ok(r.start > 0, `system ${r.at} starts with no ${r.goods} at all`);
    assert.equal(r.half, r.start - r.took, `buying ${r.took} tons left ${r.half} of ${r.start}`);
    assert.equal(r.empty, 0, `asking for ten times the shelf left ${r.empty} tons behind`);
    assert.ok(r.grab < r.start * 10, `the world sold ${r.grab} tons when it only had ${r.half}`);
    assert.ok(r.after5 > 0 && r.after5 <= r.cap,
      `five days after being cleaned out the shelf holds ${r.after5} against a capacity of ${r.cap}`);
    assert.ok(r.after5 < r.cap, `five days brought the shelf all the way back to ${r.cap}: it refills instantly`);
    assert.equal(r.afterAges, r.cap, `five hundred days later the shelf is ${r.afterAges} of ${r.cap}: it never comes back`);
  });

  // ECON-2 — the captain and their traders were trading out of different worlds: nothing a fleet
  // trader bought was missing when the captain got there.
  await check('ECON the captain and their traders buy out of the same hold', async () => {
    await fresh('play-econ-shared');
    const r = await ev(() => {
      const t = testBM1, s = t.state;
      if (typeof t.marketSupply !== 'function') return { shared: false, reason: 'a fleet trader has stock of its own' };
      window.__tradeSetup({});
      const at = Number(s.currentPlanet);
      const goods = t.getPlanetMarket(at)[0].goods;
      const before = t.marketSupply(at, goods);
      // the captain buys a ton at the market screen
      s.latinum = 100000;
      const dock = window.__dock();
      const offers = t.currentMarketOffers();
      const slot = offers.findIndex((o) => o.goods === goods);
      t.buyMarketGood(slot);
      const afterCaptain = t.marketSupply(at, goods);
      // and a trader takes the rest
      const rest = t.takeMarketSupply(at, goods, afterCaptain);
      const afterTrader = t.marketSupply(at, goods);
      // now the captain cannot buy what the trader took
      const purse = s.latinum;
      t.buyMarketGood(slot);
      return { shared: true, at, goods, before, afterCaptain, rest, afterTrader, dock,
        purse, purseAfter: s.latinum, log: String(s.log || '') };
    });
    assert.ok(r.shared, `${r.reason}`);
    assert.ok(r.before > 1, `precondition: system ${r.at} had ${r.before} tons of ${r.goods}`);
    assert.ok(r.dock.offers > 0, `precondition: the market screen showed nothing (${r.dock.block})`);
    assert.equal(r.afterCaptain, r.before - 1,
      `the captain bought a ton of ${r.goods} and the shelf went from ${r.before} to ${r.afterCaptain}`);
    assert.equal(r.afterTrader, 0, 'a trader took the rest of the shelf and something is still there');
    assert.equal(r.purseAfter, r.purse,
      `the captain bought ${r.goods} a trader had already taken, for ${r.purse - r.purseAfter} latinum`);
    assert.ok(/no .* left|sold out|comes back/i.test(r.log), `the market does not say why it refused: "${r.log}"`);
  });

  // ECON-3 — a world would absorb any tonnage of anything at its posted price, so a thousand tons of
  // one commodity cleared exactly like one ton.
  await check('ECON a world only buys what it wants', async () => {
    await fresh('play-econ-demand');
    const r = await ev(() => {
      const t = testBM1, s = t.state;
      if (typeof t.marketDemand !== 'function') return { finite: false, reason: 'a world absorbs any tonnage at its posted price' };
      window.__tradeSetup({});
      const at = Number(s.currentPlanet);
      const goods = t.getPlanetMarket(at)[0].goods;
      const cap = t.worldTradeCapability(at);
      const want = t.marketDemand(at, goods);
      const filled = t.fillMarketDemand(at, goods, want * 20);
      const left = t.marketDemand(at, goods);
      s.day += 500;
      const back = t.marketDemand(at, goods);
      return { finite: true, at, goods, want, filled, left, back, cap: cap.demand };
    });
    assert.ok(r.finite, `${r.reason}`);
    assert.ok(r.want > 0, `system ${r.at} will not buy any ${r.goods} at all`);
    assert.equal(r.filled, r.want, `the world took ${r.filled} tons when it only wanted ${r.want}`);
    assert.equal(r.left, 0, `after being filled the world still wants ${r.left} tons`);
    assert.equal(r.back, r.cap, `the world's appetite never comes back: ${r.back} of ${r.cap}`);
  });

  // ECON-4 — an empty rock with nobody on it ran a commodity market and handed out shipping work; and
  // then, once installations were read, ANY installation did it. A gun platform on a bare rock kept a
  // commodity shelf and a book of freight contracts.
  await check('ECON an empty world trades only where something there does economic work', async () => {
    await fresh('play-econ-dead');
    const r = await ev(() => {
      const t = testBM1, s = t.state;
      if (typeof t.worldTrades !== 'function') return { derived: false, reason: 'every world trades, whoever lives there' };
      window.__tradeSetup({});
      const dead = [], alive = [];
      for (let i = 0; i < s.planets.length; i++) {
        const cap = t.worldTradeCapability(i);
        (cap.inhabited ? alive : dead).push({ i, name: s.planets[i].name, pop: cap.pop, installations: cap.installations });
      }
      if (!dead.length) return { derived: true, found: false };
      const one = dead[0];
      const goods = t.getPlanetMarket(one.i)[0].goods;
      const id = `gate-dead-${one.i}`;
      const look = () => ({ trades: t.worldTrades(one.i), supply: t.marketSupply(one.i, goods), jobs: t.worldOpenJobs(one.i).length });
      const build = (stationTypeId, name) => {
        s.stationDefinitions = (s.stationDefinitions || []).filter((d) => d.id !== id);
        s.stationDefinitions.push({ id, systemIndex: one.i, stationTypeId, name });
        const seen = look();
        s.worldJobs = {}; s.marketStock = {};
        return seen;
      };
      const before = look();
      // 86 is the Defense Platform: local beam defence, authored as no commerce at all.
      const platform = build(86, 'Gate Defence Platform');
      // 201 is the Communication Array: a relay, and nothing else.
      const relay = build(201, 'Gate Relay');
      // 75 is the Trade Station: freight brokerage, commodities, warehousing.
      const market = build(75, 'Gate Trade Station');
      s.stationDefinitions = s.stationDefinitions.filter((d) => d.id !== id);
      s.worldJobs = {}; s.marketStock = {};
      return { derived: true, found: true, dead: dead.map((w) => w.name), one, before, platform, relay, market,
        populated: alive.filter((w) => w.pop > 0).length, aliveCount: alive.length };
    });
    assert.ok(r.derived, `${r.reason}`);
    assert.ok(r.found, 'precondition: every world on the map has people or an installation');
    assert.equal(r.before.trades, false, `${r.one.name} has ${r.one.pop} people and ${r.one.installations} installations and still trades`);
    assert.equal(r.before.supply, 0, `${r.one.name} has ${r.before.supply} tons on a shelf nobody is standing behind`);
    assert.equal(r.before.jobs, 0, `${r.one.name} is handing out ${r.before.jobs} shipping jobs with nobody there to hire`);
    assert.equal(r.platform.trades, false,
      `a defence platform was built on the empty rock at ${r.one.name} and the world now runs a market with ${r.platform.supply} tons on the shelf and ${r.platform.jobs} shipments waiting: a gun is not a trading post`);
    assert.equal(r.relay.trades, false,
      `a relay was built on the empty rock at ${r.one.name} and the world now runs a market with ${r.relay.supply} tons on the shelf and ${r.relay.jobs} shipments waiting: a relay brokers no freight`);
    assert.equal(r.market.trades, true,
      `a trade station was built at ${r.one.name} and it still has no economy: the rule is reading the world's name, not what is actually there`);
    assert.ok(r.market.jobs > 0, `a trade station was built at ${r.one.name} and it generates no work`);
    assert.ok(r.market.supply > 0, `a trade station was built at ${r.one.name} and it has nothing on the shelf`);
  });

  // JOB-1 — a contract was invented to fit whatever hold was asking, so tonnage was never a constraint
  // and a shipment always fitted.
  await check('JOB a shipment has a size, and a hold has to have room for it', async () => {
    await fresh('play-job-tonnage');
    const r = await ev(() => {
      const t = testBM1, s = t.state;
      if (typeof t.worldOpenJobs !== 'function') return { finite: false, reason: 'shipments are invented to fit whoever is asking' };
      window.__tradeSetup({});
      const at = Number(s.currentPlanet);
      const jobs = t.worldOpenJobs(at).map((j) => ({ id: j.id, tons: j.tons, to: j.targetIndex }));
      const cap = t.worldTradeCapability(at);
      // a hold far too small for the smallest shipment is offered nothing
      s.cargoCap = Math.max(1, s.cargo + 1);
      const tiny = t.createCargoRunOffer();
      // a big hold is offered one of the world's own shipments, at its own size
      s.cargoCap = 5000;
      const big = t.createCargoRunOffer();
      return { finite: true, at, jobs, capTons: cap.tons, tiny: tiny ? tiny.tons : null,
        big: big ? { id: big.id, tons: big.tons } : null };
    });
    assert.ok(r.finite, `${r.reason}`);
    assert.ok(r.jobs.length > 0, `system ${r.at} has no shipments waiting at all`);
    assert.ok(r.jobs.every((j) => j.tons > 0), 'a shipment has no tonnage on it');
    assert.equal(r.tiny, null,
      `a one-ton hold was offered a ${r.tiny}-ton shipment when the smallest on the board is ${Math.min(...r.jobs.map((j) => j.tons))}`);
    assert.ok(r.big, 'a large hold was offered no shipment at all');
    assert.ok(r.jobs.some((j) => j.id === r.big.id && j.tons === r.big.tons),
      `the offered shipment (${r.big.tons} t, ${r.big.id}) is not one of the world's own: it was invented for the ship`);
  });

  // JOB-2 — asking again produced a fresh contract every time, so a captain stood at one system and
  // filled an arbitrarily large hold without going anywhere.
  await check('JOB a world has only so much work, and taking it does not make more', async () => {
    await fresh('play-job-finite');
    const r = await ev(() => {
      const t = testBM1, s = t.state;
      if (typeof t.worldOpenJobs !== 'function') return { finite: false, reason: 'a world hands out a new contract every time it is asked' };
      window.__tradeSetup({});
      const at = Number(s.currentPlanet);
      s.cargoCap = 100000; s.totcargo = s.cargoCap; s.latinum = 100000;
      window.__dock();
      const cap = t.worldTradeCapability(at);
      const open = t.worldOpenJobs(at).length;
      // ask twenty times without leaving
      const seen = new Set();
      for (let k = 0; k < 20; k++) { const o = t.createCargoRunOffer(); if (o) seen.add(o.id); }
      // and take them all
      let taken = 0;
      for (let k = 0; k < 20; k++) {
        const o = t.createCargoRunOffer();
        if (!o) break;
        const was = t.worldOpenJobs(at).length;
        s.pendingContractOffer = o;
        t.acceptPendingContract();
        if (t.worldOpenJobs(at).length < was) taken++; else break;
      }
      const leftSameDay = t.worldOpenJobs(at).length;
      s.day += 60;
      const later = t.worldOpenJobs(at).length;
      return { finite: true, at, cap: cap.jobs, open, distinct: seen.size, taken, leftSameDay, later };
    });
    assert.ok(r.finite, `${r.reason}`);
    assert.ok(r.open > 0 && r.open <= r.cap, `system ${r.at} keeps ${r.open} jobs open against a cap of ${r.cap}`);
    assert.ok(r.distinct <= r.open,
      `asking twenty times at one system produced ${r.distinct} different shipments from a board of ${r.open}`);
    assert.ok(r.taken <= r.open, `${r.taken} shipments were taken from a board of ${r.open}`);
    assert.equal(r.leftSameDay, 0, `after taking every shipment the world still has ${r.leftSameDay} waiting`);
    assert.ok(r.later > 0, 'sixty days later the world has generated no new work at all');
    assert.ok(r.later <= r.cap, `sixty days later the world has ${r.later} jobs open against a cap of ${r.cap}`);
  });

  // CAUTIOUS-STALE-FLAG — a Cautious trader's judgement of an unreported system read its LIVE controller,
  // so a conquest nobody had seen changed her plans the day it happened; and a trader who crossed a
  // system reported nothing about who she found holding it.
  await check('CAUTIOUS-STALE-FLAG a Cautious trader plans on the flag she knows, and reports the one she finds', async () => {
    await fresh('play-cautious-stale-flag');
    const r = await ev(() => {
      const t = testBM1, s = t.state;
      if (typeof t.unreportedSystemDoubt !== 'function' || typeof t.knownSystemController !== 'function')
        return { judged: false, reason: 'a Cautious trader never crosses unreported space, so there is no flag for her to judge' };
      window.__tradeSetup({});
      window.__tradeShip('gate-stale-1', { big: true });
      const f = s.playerFleet.find((x) => x.id === 'gate-stale-1');
      const trade = t.ensureFleetTradeState(f, 'cautious');
      trade.active = true;
      const from = Number(s.currentPlanet);
      // A destination whose route crosses a charted system nobody has reported on, and which Cautious
      // accepts today because nothing the captain knows says it is hostile.
      let to = null, x = null;
      for (let i = 0; i < s.planets.length; i++) {
        if (i === from || !t.worldTrades(i) || t.serviceRefusal(t.getSystemFaction(i))) continue;
        const risk = t.plannedRouteRisk(from, i);
        if (!risk || !risk.unreported.length) continue;
        if (!t.fleetTradeRouteAcceptable(f, trade, from, i)) continue;
        const quiet = risk.unreported.find((k) => t.unreportedSystemDoubt(k) === null && t.isChartSystemVisible(k));
        if (quiet == null) continue;
        to = i; x = Number(quiet); break;
      }
      if (to == null) return { judged: true, found: false };
      const hostile = 'romulan';
      if (!t.serviceRefusal(hostile)) return { judged: true, found: true, hostileFound: false };
      const known = t.knownSystemController(x);
      const before = { live: t.getSystemFaction(x), known, doubt: t.unreportedSystemDoubt(x),
        acceptable: Boolean(t.fleetTradeRouteAcceptable(f, trade, from, to)), recorded: Boolean(s.conditionLog && s.conditionLog[x]) };
      // The Romulans take it, and nobody tells the captain.
      s.factionSystemOverrides = s.factionSystemOverrides || {};
      s.factionSystemOverrides[x] = hostile;
      const secret = { live: t.getSystemFaction(x), known: t.knownSystemController(x), doubt: t.unreportedSystemDoubt(x),
        acceptable: Boolean(t.fleetTradeRouteAcceptable(f, trade, from, to)) };
      // Then she crosses it.
      f.systemIndex = x; delete f.transit;
      trade.stage = 'outbound'; trade.path = [x]; trade.legDays = [1]; trade.legIndex = 0; trade.crossed = []; trade.stops = [];
      t.crossFleetTradeSystem(f, trade, s.day);
      const after = { recorded: (s.conditionLog && s.conditionLog[x] && s.conditionLog[x].controller) || null,
        known: t.knownSystemController(x), deliverable: Boolean(t.fleetTradeDeliverable(f, trade, from, x)) };
      return { judged: true, found: true, hostileFound: true, from, to, x, name: s.planets[x]?.name, before, secret, after };
    });
    assert.ok(r.judged, `${r.reason}`);
    assert.ok(r.found, 'precondition: no Cautious-acceptable route crosses a charted system nobody has reported on');
    assert.ok(r.hostileFound, 'precondition: the Romulans do not refuse the captain, so a Romulan conquest is not a hostile one');
    assert.ok(!r.before.recorded, `precondition: ${r.name} already has a conditions record`);
    assert.equal(r.before.doubt, null, `precondition: ${r.name} was already in doubt (${r.before.doubt})`);
    assert.equal(r.secret.live, 'romulan', 'precondition: the secret conquest did not take');
    assert.equal(r.secret.known, r.before.known,
      `the Romulans took ${r.name} and nobody told the captain, and her record of it changed from ${r.before.known} to ${r.secret.known}`);
    assert.equal(r.secret.doubt, null,
      `the Romulans took ${r.name} and nobody told the captain, and her Cautious trader already doubts it (${r.secret.doubt}): the plan is reading the live flag, not the one the captain knows`);
    assert.equal(r.secret.acceptable, true,
      `the Romulans took ${r.name} and nobody told the captain, and her trader's route through it was cancelled the same day`);
    assert.equal(r.after.recorded, 'romulan',
      `the trader crossed ${r.name} under the Romulan flag and recorded ${r.after.recorded === null ? 'nothing' : r.after.recorded}: what she found is not on the captain's record`);
    assert.equal(r.after.known, 'romulan', `after the crossing the captain still believes ${r.name} is ${r.after.known}`);
    assert.equal(r.after.deliverable, false, `with the Romulan flag on record, a shipment to ${r.name} is still being offered to a trader they refuse`);
  });

  // RANK-TIME — the planner ranked a shipment by its price over the hold it took, and took every one
  // that fitted, so opening up more of the map sent a trader across it for a shipment whose price did
  // not pay for the voyage. Measured as Risky earning half of Safe.
  await check('RANK-TIME letting a trader go further cannot make her choose a worse day\'s pay than she could have had', async () => {
    await fresh('play-rank-time');
    const r = await ev(() => {
      const t = testBM1, s = t.state;
      if (typeof t.planFleetTradeCircuit !== 'function') return { ranked: false, reason: 'there is no circuit to plan' };
      // Only this world's prices are known, so no commodity lot exists to blur the comparison.
      window.__tradeSetup({ learn: 1 });
      window.__tradeShip('gate-rank-1', { big: true });
      const f = s.playerFleet.find((x) => x.id === 'gate-rank-1');
      const trade = t.ensureFleetTradeState(f, 'safe');
      trade.active = true;
      const from = Number(s.currentPlanet);
      // Near and far are measured in the days she will really fly — the same reckoning the planner uses
      // — where the tree has it; an older tree is measured the way it reckons.
      const routeDays = (route) => typeof t.fleetTradeRouteDays === 'function' ? t.fleetTradeRouteDays(route)
        : typeof t.routeLegDays === 'function' ? t.routeLegDays(route).reduce((n, d) => n + d, 0)
        : Math.max(1, t.Fleet.travelDays(route.distance));
      const daysTo = (i) => { const route = t.getPlottedRoute(from, i); return route ? routeDays(route) : null; };
      const worlds = [];
      for (let i = 0; i < s.planets.length; i++) {
        if (i === from || !t.worldTrades(i) || t.serviceRefusal(t.getSystemFaction(i))) continue;
        const d = daysTo(i); if (d) worlds.push({ i, d });
      }
      worlds.sort((a, b) => a.d - b.d);
      const near = worlds[0], far = worlds[worlds.length - 1];
      if (!near || !far || far.d < near.d * 4) return { ranked: true, found: false, near, far };
      // The near route is reported quiet; the far one crosses something nobody has reported on.
      const nearPath = t.plannedRouteRisk(from, near.i).path;
      const quiet = { source: 'local', traffic: { band: 0, why: 'quiet' }, protection: { band: 2, why: 'patrolled' }, disruption: { band: 0, why: 'none' }, threat: null };
      for (const k of nearPath) t.recordConditionObservation(k, quiet);
      const farPath = t.plannedRouteRisk(from, far.i).path;
      for (const k of farPath) if (!nearPath.includes(k) && s.conditionLog) delete s.conditionLog[k];
      const okSafe = { near: Boolean(t.fleetTradeDeliverable(f, trade, from, near.i)), far: Boolean(t.fleetTradeDeliverable(f, trade, from, far.i)) };
      const goods = t.getPlanetMarket(from)[0].goods;
      const post = () => {
        const base = { goods, originIndex: from, originName: s.planets[from]?.name, employerName: s.planets[from]?.name,
          employerType: 'planet', employerFaction: 'neutral', hazardPay: 0, hazards: [], negotiated: false, createdAt: Date.now(), createdDay: s.day };
        s.worldJobs = { [from]: { day: s.day, seq: 2, jobs: [
          { ...base, id: 'rank-near', tons: 50, targetIndex: near.i, targetName: s.planets[near.i]?.name, fee: 2000, payPerTon: 20 },
          { ...base, id: 'rank-far', tons: 1, targetIndex: far.i, targetName: s.planets[far.i]?.name, fee: 1500, payPerTon: 20, courier: true },
        ] } };
      };
      const rateOf = (p) => { const d = Number(p.plan.days) || (p.plan.legDays || []).reduce((n, x) => n + x, 0); return d > 0 ? p.plan.expected / d : 0; };
      post();
      trade.risk = 'safe';
      const ps = t.planFleetTradeCircuit(f, trade, s.day);
      const safe = ps.ok && !ps.repositioning ? { stops: ps.plan.stops.slice(), rate: rateOf(ps), expected: ps.plan.expected,
        days: Number(ps.plan.days) || (ps.plan.legDays || []).reduce((n, x) => n + x, 0) } : { note: ps.note };
      post();
      trade.risk = 'any';
      const pa = t.planFleetTradeCircuit(f, trade, s.day);
      const any = pa.ok && !pa.repositioning ? { stops: pa.plan.stops.slice(), rate: rateOf(pa), expected: pa.plan.expected,
        days: Number(pa.plan.days) || (pa.plan.legDays || []).reduce((n, x) => n + x, 0) } : { note: pa.note };
      return { ranked: true, found: true, from, near, far, nearName: s.planets[near.i]?.name, farName: s.planets[far.i]?.name, okSafe, safe, any };
    });
    assert.ok(r.ranked, `${r.reason}`);
    assert.ok(r.found, `precondition: no pair of worlds far enough apart (${JSON.stringify(r.near)} / ${JSON.stringify(r.far)})`);
    assert.ok(r.okSafe.near && !r.okSafe.far, `precondition: under Safe the near world is ${r.okSafe.near ? '' : 'not '}reachable and the far one ${r.okSafe.far ? 'is' : 'is not'}`);
    assert.ok(r.safe.stops, `under Safe no circuit was planned: ${r.safe.note}`);
    assert.ok(r.safe.stops.includes(r.near.i) && r.safe.rate > 0, `under Safe the trader did not take the ${r.nearName} shipment: ${JSON.stringify(r.safe)}`);
    assert.ok(r.any.stops, `under Any no circuit was planned: ${r.any.note}`);
    assert.ok(r.any.rate >= r.safe.rate - 1e-6,
      `letting her go anywhere, the trader chose a circuit worth ${Math.round(r.any.rate)} latinum a day (${r.any.days} days, ${JSON.stringify(r.any.stops)}) when the ${r.nearName} shipment alone was worth ${Math.round(r.safe.rate)} a day (${r.safe.days} days) and was still on the board`);
    assert.ok(r.any.stops.includes(r.near.i), `letting her go anywhere, the trader left the ${r.nearName} shipment on the board`);
  });

  // RANK-LEG-TIME — the planner reckoned a route's days from its total distance, while the ship pays the
  // rounded days of every leg; a many-hopped route could look faster than it flies, and be chosen over
  // a straighter one that really was faster.
  await check('RANK-LEG-TIME the planner reckons a route by the days it will really fly', async () => {
    await fresh('play-rank-leg-time');
    const r = await ev(() => {
      const t = testBM1, s = t.state;
      if (typeof t.planFleetTradeCircuit !== 'function') return { reckons: false, reason: 'there is no circuit to plan' };
      window.__tradeSetup({ learn: 1 });
      window.__tradeShip('gate-legtime-1', { big: true });
      const f = s.playerFleet.find((x) => x.id === 'gate-legtime-1');
      const trade = t.ensureFleetTradeState(f, 'any');
      trade.active = true;
      const from = Number(s.currentPlanet);
      const upkeep = t.upkeepPerDay(f.shipId);
      // What the calendar will charge for a route, and what a plan reckoning from the distance would.
      const flown = (route) => t.routeLegDays(route).reduce((n, d) => n + d, 0);
      const reckoned = (route) => Math.max(1, t.Fleet.travelDays(route.distance));
      const worlds = [];
      for (let i = 0; i < s.planets.length; i++) {
        if (i === from || !t.worldTrades(i) || t.serviceRefusal(t.getSystemFaction(i))) continue;
        if (!t.fleetTradeDeliverable(f, trade, from, i)) continue;
        const route = t.getPlottedRoute(from, i);
        if (!route || !(route.legs || []).length) continue;
        worlds.push({ i, name: s.planets[i]?.name, legs: route.legs.length, flown: flown(route), reckoned: reckoned(route) });
      }
      // A: a world whose route flies in exactly the days a distance reckoning gives it.
      // B: a world whose route really takes at least two days longer than a distance reckoning says.
      const exact = worlds.filter((w) => w.flown === w.reckoned).sort((a, b) => a.flown - b.flown);
      const longer = worlds.filter((w) => w.flown >= w.reckoned + 2).sort((a, b) => (b.flown - b.reckoned) - (a.flown - a.reckoned));
      const A = exact[0], B = longer[0];
      if (!A || !B) return { reckons: true, found: false, exact: exact.length, longer: longer.length };
      // Priced so that B looks better per day by the reckoning and worse by the days actually flown.
      const rateA = 40; // latinum a day, net of upkeep
      const payA = Math.round((rateA + upkeep) * A.flown);
      const payB = Math.round((rateA + upkeep) * (B.reckoned + B.flown) / 2);
      const goods = t.getPlanetMarket(from)[0].goods;
      const base = { goods, originIndex: from, originName: s.planets[from]?.name, employerName: s.planets[from]?.name,
        employerType: 'planet', employerFaction: 'neutral', hazardPay: 0, hazards: [], negotiated: false, createdAt: Date.now(), createdDay: s.day, payPerTon: 0 };
      s.worldJobs = { [from]: { day: s.day, seq: 2, jobs: [
        { ...base, id: 'legtime-a', tons: 10, targetIndex: A.i, targetName: A.name, fee: payA },
        { ...base, id: 'legtime-b', tons: 10, targetIndex: B.i, targetName: B.name, fee: payB },
      ] } };
      const plan = t.planFleetTradeCircuit(f, trade, s.day);
      if (!plan.ok || plan.repositioning) return { reckons: true, found: true, planned: false, note: plan.note, A, B };
      const days = (plan.plan.legDays || []).reduce((n, d) => n + d, 0);
      return { reckons: true, found: true, planned: true, A, B, payA, payB, upkeep,
        byReckoning: { A: (payA - upkeep * A.flown) / A.flown, B: (payB - upkeep * B.reckoned) / B.reckoned },
        byFlight: { A: (payA - upkeep * A.flown) / A.flown, B: (payB - upkeep * B.flown) / B.flown },
        stops: plan.plan.stops.map(Number), days, expected: plan.plan.expected, rate: days > 0 ? plan.plan.expected / days : 0 };
    });
    assert.ok(r.reckons, `${r.reason}`);
    assert.ok(r.found, `precondition: no pair of worlds on this map separates the two reckonings (${r.exact} exact, ${r.longer} longer)`);
    assert.ok(r.planned, `no circuit was planned: ${r.note}`);
    assert.ok(r.byReckoning.B > r.byReckoning.A && r.byFlight.B < r.byFlight.A,
      `precondition: the prices do not separate the two reckonings: ${JSON.stringify({ byReckoning: r.byReckoning, byFlight: r.byFlight })}`);
    assert.ok(r.stops.includes(r.A.i) && !r.stops.includes(r.B.i),
      `the trader was sent to ${JSON.stringify(r.stops)}: ${r.B.name} is ${r.B.legs} hops and really takes ${r.B.flown} days, not the ${r.B.reckoned} a distance reckoning gives it, and at ${Math.round(r.byFlight.B)} latinum a day it is worse than ${r.A.name} at ${Math.round(r.byFlight.A)} — the planner is reckoning days from distance, not from the legs she will fly`);
    assert.ok(Math.abs(r.rate - r.byFlight.A) < 1e-6,
      `the plan expects ${Math.round(r.rate)} latinum a day over ${r.days} days; ${r.A.name} really pays ${Math.round(r.byFlight.A)} a day over ${r.A.flown}`);
  });

  // JOB-ROLLBACK-AGE — a shipment claimed during planning and then put back was rebuilt without its
  // date, so an aborted plan made an old posting new again.
  await check('JOB-ROLLBACK-AGE a shipment put back after planning is as old as it was', async () => {
    await fresh('play-job-rollback-age');
    const r = await ev(() => {
      const t = testBM1, s = t.state;
      if (typeof t.worldOpenJobs !== 'function') return { dated: false, reason: 'shipments have no date to lose' };
      window.__tradeSetup({ day: 50 });
      window.__tradeShip('gate-rollback-1', { big: true });
      const f = s.playerFleet.find((x) => x.id === 'gate-rollback-1');
      const trade = t.ensureFleetTradeState(f, 'any');
      trade.active = true;
      const at = Number(s.currentPlanet);
      // Generated on day 50...
      const posted = t.worldOpenJobs(at).map((j) => ({ id: j.id, createdDay: j.createdDay }));
      if (!posted.length) return { dated: true, found: false };
      const ages = posted.map((j) => j.createdDay);
      // ...claimed by the planner on day 100...
      s.day = 100;
      const plan = t.planFleetTradeCircuit(f, trade, s.day);
      if (!plan.ok || plan.repositioning) return { dated: true, found: true, planned: false, note: plan.note };
      const claimed = plan.plan.manifest.filter((m) => m.kind === 'job');
      if (!claimed.length) return { dated: true, found: true, planned: true, claimedAny: false };
      // ...and put back, exactly as the planner does when it abandons a plan.
      const restored = claimed.map((m) => (typeof t.rebuildWorldJob === 'function' ? t.rebuildWorldJob(m, at) : { id: m.jobId }));
      return { dated: true, found: true, planned: true, claimedAny: true, ages,
        claimed: claimed.map((m) => ({ id: m.jobId, createdDay: m.createdDay })),
        restored: restored.map((j) => ({ id: j.id, createdDay: j.createdDay })), day: s.day };
    });
    assert.ok(r.dated, `${r.reason}`);
    assert.ok(r.found, 'precondition: the home world had no shipments posted');
    assert.ok(r.ages.every((d) => d != null), 'the postings carry no date at all, so a shipment has no age for anything to preserve');
    assert.ok(r.ages.every((d) => d === 50), `precondition: the postings are not dated day 50: ${JSON.stringify(r.ages)}`);
    assert.ok(r.planned, `precondition: no circuit could be planned from the home world: ${r.note}`);
    assert.ok(r.claimedAny, 'precondition: the plan claimed no shipment from the home world');
    for (const j of r.restored)
      assert.equal(j.createdDay, 50,
        `${j.id} was posted on day 50, claimed on day ${r.day} and put back dated ${j.createdDay == null ? 'nothing at all' : 'day ' + j.createdDay}: an abandoned plan made an old posting new`);
  });

  // JOB-TURNOVER — a shipment nobody would take sat on the board for the rest of the campaign, holding a
  // slot that could have carried work somebody would.
  await check('JOB-TURNOVER a shipment nobody takes leaves the board, and its slot is filled with new work', async () => {
    await fresh('play-job-turnover');
    const r = await ev(() => {
      const t = testBM1, s = t.state;
      if (typeof t.worldOpenJobs !== 'function') return { turns: false, reason: 'shipments are invented on demand and never sit anywhere' };
      window.__tradeSetup({ day: 10 });
      const at = Number(s.currentPlanet);
      const cap = t.worldTradeCapability(at);
      const lifetime = Number(t.TRADE_ECONOMY && t.TRADE_ECONOMY.jobLifetimeDays);
      // A book full of shipments a one-ton hull can never carry, all posted on day 10.
      const pool = t.worldJobPool(at);
      const original = pool.jobs.map((j) => j.id);
      for (const j of pool.jobs) j.tons = 5000;
      window.__tradeShip('gate-turnover-1', { hold: 1 });
      const f = s.playerFleet.find((x) => x.id === 'gate-turnover-1');
      const trade = t.ensureFleetTradeState(f, 'any');
      const takeable = () => t.worldOpenJobs(at).filter((j) => j.tons <= t.fleetTradeCapacity(f)).length;
      const before = { open: t.worldOpenJobs(at).length, capacity: cap.jobs, takeable: takeable() };
      // Well past whatever the lifetime is, if there is one; well past a year, if there is not.
      const horizon = Number.isFinite(lifetime) && lifetime > 0 ? lifetime + 30 : 400;
      s.day = 10 + horizon;
      const afterIds = t.worldOpenJobs(at).map((j) => j.id);
      const survivors = afterIds.filter((id) => original.includes(id));
      const fresh = afterIds.filter((id) => !original.includes(id));
      const newest = t.worldOpenJobs(at).filter((j) => !original.includes(j.id));
      return { turns: true, at, lifetime: Number.isFinite(lifetime) ? lifetime : null, before, horizon, day: s.day,
        after: { open: afterIds.length, survivors: survivors.length, fresh: fresh.length, takeable: takeable(),
          freshTons: newest.map((j) => j.tons), freshDays: newest.map((j) => j.createdDay) } };
    });
    assert.ok(r.turns, `${r.reason}`);
    assert.ok(r.before.open > 0 && r.before.open >= r.before.capacity, `precondition: the book at system ${r.at} is not full (${r.before.open} of ${r.before.capacity})`);
    assert.equal(r.before.takeable, 0, 'precondition: the one-ton hull could take something on the board');
    assert.ok(r.lifetime, 'an unaccepted shipment has no lifetime: it waits on the board for the rest of the campaign');
    assert.ok(r.lifetime >= 120 && r.lifetime <= 180, `the lifetime is ${r.lifetime} days; review asked for something around 120-180 to start`);
    assert.equal(r.after.survivors, 0,
      `${r.after.survivors} of ${r.before.open} shipments nobody could carry are still on the board ${r.horizon} days after they were posted`);
    assert.ok(r.after.fresh > 0, `the slots were freed and ${r.horizon} days later nothing new has been posted in them`);
    assert.ok(r.after.open <= r.before.capacity, `the book holds ${r.after.open} shipments against a capacity of ${r.before.capacity}`);
    assert.ok(r.after.freshDays.every((d) => d > 10), `a replacement shipment carries the old posting's date: ${JSON.stringify(r.after.freshDays)}`);
    assert.ok(r.after.freshTons.some((tons) => tons < 5000), 'the replacements are the same unsuitable shipments back again');
  });

  // JOB-3 — a freighter could only ever carry one job, so a large hold had nothing to put in it.
  await check('JOB several shipments ride in one freighter', async () => {
    await fresh('play-job-combine');
    const r = await ev(() => {
      const t = testBM1, s = t.state;
      if (typeof t.planFleetTradeCircuit !== 'function') return { combined: false, reason: 'a trader carries one thing at a time' };
      window.__tradeSetup({});
      window.__tradeShip('gate-combine-1', { big: true });
      const f = s.playerFleet.find((x) => x.id === 'gate-combine-1');
      const at = Number(s.currentPlanet);
      const open = t.worldOpenJobs(at).length;
      const plan = t.planFleetTradeCircuit(f, t.ensureFleetTradeState(f, 'any'), s.day);
      if (!plan.ok) return { combined: true, planned: false, note: plan.note, open };
      const jobs = plan.plan.manifest.filter((m) => m.kind === 'job');
      const destinations = new Set(plan.plan.manifest.map((m) => m.to));
      return { combined: true, planned: true, open, hold: t.fleetTradeCapacity(f),
        jobs: jobs.length, tons: jobs.reduce((n, m) => n + m.tons, 0),
        destinations: destinations.size, stops: plan.plan.stops.length,
        manifest: plan.plan.manifest.map((m) => ({ kind: m.kind, tons: m.tons, to: m.to })) };
    });
    assert.ok(r.combined, `${r.reason}`);
    assert.ok(r.planned, `no circuit could be planned at all: ${r.note}`);
    assert.ok(r.open >= 2, `precondition: the origin had ${r.open} shipments open`);
    assert.ok(r.jobs >= 2,
      `a ${r.hold}-ton freighter took ${r.jobs} of the ${r.open} shipments on offer`);
    assert.ok(r.tons <= r.hold, `${r.tons} tons of shipments went into a ${r.hold}-ton hold`);
    assert.ok(r.stops >= 2 && r.stops <= 4,
      `the circuit calls at ${r.stops} worlds, which is outside the two-to-four bound`);
  });

  // CIRCUIT-1 — two traders drew on nothing: the same tons and the same shipment could be taken twice.
  await check('CIRCUIT two traders cannot take the same tons or the same shipment', async () => {
    await fresh('play-circuit-shared');
    const r = await ev(() => {
      const t = testBM1, s = t.state;
      if (typeof t.planFleetTradeCircuit !== 'function') return { shared: false, reason: 'traders do not draw on a shared economy' };
      window.__tradeSetup({});
      const at = Number(s.currentPlanet);
      const openBefore = t.worldOpenJobs(at).map((j) => j.id);
      window.__tradeShip('gate-share-a', { big: true, seed: 1 });
      window.__tradeShip('gate-share-b', { big: true, seed: 2 });
      const a = s.playerFleet.find((x) => x.id === 'gate-share-a');
      const b = s.playerFleet.find((x) => x.id === 'gate-share-b');
      const goods = t.getPlanetMarket(at)[0].goods;
      const supplyBefore = t.marketSupply(at, goods);
      const pa = t.planFleetTradeCircuit(a, t.ensureFleetTradeState(a, 'any'), s.day);
      const supplyMid = t.marketSupply(at, goods);
      const pb = t.planFleetTradeCircuit(b, t.ensureFleetTradeState(b, 'any'), s.day);
      const supplyAfter = t.marketSupply(at, goods);
      const jobsA = pa.ok ? pa.plan.manifest.filter((m) => m.kind === 'job').map((m) => m.jobId) : [];
      const jobsB = pb.ok ? pb.plan.manifest.filter((m) => m.kind === 'job').map((m) => m.jobId) : [];
      const overlap = jobsA.filter((id) => jobsB.includes(id));
      const openAfter = t.worldOpenJobs(at).map((j) => j.id);
      return { shared: true, openBefore: openBefore.length, openAfter: openAfter.length,
        jobsA: jobsA.length, jobsB: jobsB.length, overlap, supplyBefore, supplyMid, supplyAfter };
    });
    assert.ok(r.shared, `${r.reason}`);
    assert.ok(r.jobsA > 0, 'the first trader took no shipments at all');
    assert.deepEqual(r.overlap, [],
      `both traders are carrying the same shipment: ${r.overlap.join(', ')}`);
    assert.ok(r.openAfter <= r.openBefore - r.jobsA - r.jobsB,
      `${r.jobsA + r.jobsB} shipments were taken and the board went from ${r.openBefore} to ${r.openAfter}`);
    assert.ok(r.supplyMid <= r.supplyBefore && r.supplyAfter <= r.supplyMid,
      `the shelf went ${r.supplyBefore} -> ${r.supplyMid} -> ${r.supplyAfter} as two traders loaded from it`);
  });

  // CIRCUIT-2 — cargo for different worlds was one undifferentiated load, delivered wherever the ship
  // happened to stop.
  await check('CIRCUIT cargo stays addressed, and comes off only at its own call', async () => {
    await fresh('play-circuit-manifest');
    const r = await ev(() => {
      const t = testBM1, s = t.state;
      if (typeof t.fleetTradeCall !== 'function') return { addressed: false, reason: 'a load has no addresses in it' };
      window.__tradeSetup({});
      window.__tradeShip('gate-manifest-1', { big: true });
      const f = s.playerFleet.find((x) => x.id === 'gate-manifest-1');
      const plan = t.planFleetTradeCircuit(f, t.ensureFleetTradeState(f, 'any'), s.day);
      if (!plan.ok) return { addressed: true, planned: false, note: plan.note };
      t.beginFleetTradeCircuit(f, f.trade, plan.plan, s.day);
      const stops = f.trade.stops.slice();
      if (stops.length < 2) return { addressed: true, planned: true, multi: false, stops: stops.length };
      const before = f.trade.manifest.map((m) => ({ tons: m.tons, to: m.to }));
      // The call has to be one the ship is actually served at: a port that turns her away is a failed
      // call and keeps its cargo on purpose, which is TRADE-4's business, not this check's.
      const first = stops.find((i) => !t.serviceRefusal(t.getSystemFaction(i)));
      if (first == null) return { addressed: true, planned: true, multi: false, stops: 0 };
      const forFirst = before.filter((m) => m.to === first).reduce((n, m) => n + m.tons, 0);
      const forOthers = before.filter((m) => m.to !== first).reduce((n, m) => n + m.tons, 0);
      f.systemIndex = first; delete f.transit; f.assignment = 'defense';
      t.fleetTradeCall(f, f.trade, first, s.day);
      const after = f.trade.manifest.map((m) => ({ tons: m.tons, to: m.to }));
      const leftForFirst = after.filter((m) => m.to === first).reduce((n, m) => n + m.tons, 0);
      const leftForOthers = after.filter((m) => m.to !== first).reduce((n, m) => n + m.tons, 0);
      return { addressed: true, planned: true, multi: true, stops: stops.length,
        forFirst, forOthers, leftForFirst, leftForOthers, revenue: f.trade.revenue };
    });
    assert.ok(r.addressed, `${r.reason}`);
    assert.ok(r.planned, `no circuit could be planned: ${r.note}`);
    assert.ok(r.multi, `the planned circuit calls at only ${r.stops} world, so nothing can be mis-delivered`);
    assert.ok(r.forFirst > 0, 'nothing on the manifest was addressed to the first call');
    assert.ok(r.forOthers > 0, 'nothing on the manifest was addressed to a later call');
    assert.ok(r.leftForFirst < r.forFirst,
      `${r.forFirst} tons were addressed to the first call and ${r.leftForFirst} are still aboard after it`);
    assert.equal(r.leftForOthers, r.forOthers,
      `${r.forOthers} tons addressed to later calls went to ${r.leftForOthers} at the first stop: cargo came off at the wrong world`);
    assert.ok(r.revenue > 0, 'calling at the first stop earned nothing');
  });

  // CIRCUIT-3 — space freed by a delivery sat empty for the rest of the circuit.
  await check('CIRCUIT freed hold goes back to work later in the circuit', async () => {
    await fresh('play-circuit-refill');
    const r = await ev(() => {
      const t = testBM1, s = t.state;
      if (typeof t.fleetTradeCall !== 'function') return { refills: false, reason: 'a circuit never picks anything up after it sets out' };
      window.__tradeSetup({});
      window.__tradeShip('gate-refill-1', { big: true });
      const f = s.playerFleet.find((x) => x.id === 'gate-refill-1');
      const trade = t.ensureFleetTradeState(f, 'any');
      trade.active = true; // a trader that has been stopped does not take on new work
      const plan = t.planFleetTradeCircuit(f, trade, s.day);
      if (!plan.ok) return { refills: true, planned: false, note: plan.note };
      t.beginFleetTradeCircuit(f, trade, plan.plan, s.day);
      trade.active = true;
      const stops = trade.stops.slice();
      if (stops.length < 2) return { refills: true, planned: true, multi: false };
      // A port that turns the ship away loads nothing, by design; the freed-hold rule needs a call
      // that is actually served, with somewhere still to come after it.
      const servedAt = stops.findIndex((i) => !t.serviceRefusal(t.getSystemFaction(i)));
      if (servedAt < 0 || servedAt >= stops.length - 1) return { refills: true, planned: true, multi: false };
      const first = stops[servedAt], ahead = stops.slice(servedAt + 1);
      // make sure the first call has work of its own bound for somewhere still to come
      const pool = t.worldJobPool(first);
      const cap = t.worldTradeCapability(first);
      if (pool && ahead.length) {
        pool.jobs.push({ id: `gate-refill-job`, goods: 'Medical Supplies', tons: Math.max(5, Math.round(cap.tons / 4)),
          targetIndex: ahead[0], targetName: s.planets[ahead[0]]?.name, payPerTon: 300, hazardPay: 0,
          originIndex: first, originName: s.planets[first]?.name, employerName: s.planets[first]?.name,
          employerType: 'planet', employerFaction: 'neutral', showMarker: false, negotiated: false, createdAt: Date.now() });
      }
      const beforeIds = trade.manifest.map((m) => m.jobId).filter(Boolean);
      f.systemIndex = first; delete f.transit; f.assignment = 'defense';
      t.fleetTradeCall(f, trade, first, s.day);
      const afterIds = trade.manifest.map((m) => m.jobId).filter(Boolean);
      const stillOpen = (t.worldOpenJobs(first) || []).some((j) => j.id === 'gate-refill-job');
      return { refills: true, planned: true, multi: true, picked: afterIds.includes('gate-refill-job'),
        stillOpen, beforeIds, afterIds, load: t.fleetTradeLoad(trade), hold: t.fleetTradeCapacity(f) };
    });
    assert.ok(r.refills, `${r.reason}`);
    assert.ok(r.planned, `no circuit could be planned: ${r.note}`);
    assert.ok(r.multi, 'the planned circuit has only one call, so there is no later stop to load for');
    assert.equal(r.picked, true,
      'a shipment waiting at the first call, bound for a world still on the circuit, was left behind in the freed hold');
    assert.equal(r.stillOpen, false, 'the shipment was loaded and is still on that world’s board');
    assert.ok(r.load <= r.hold, `${r.load} tons ended up in a ${r.hold}-ton hold`);
  });

  // CIRCUIT-4 — a reload came back with the route, the load and the economy all reset.
  await check('CIRCUIT a reload resumes the route, the manifest and the economy', async () => {
    await fresh('play-circuit-persist');
    const r = await ev(() => {
      const t = testBM1, s = t.state;
      if (typeof t.planFleetTradeCircuit !== 'function') return { saved: false, reason: 'there is no circuit to save' };
      window.__tradeSetup({});
      window.__tradeShip('gate-persist-2', { big: true });
      const f = s.playerFleet.find((x) => x.id === 'gate-persist-2');
      t.startFleetTrading('gate-persist-2', 'risky');
      window.__tradeDays(20);
      const at = Number(s.currentPlanet);
      const goods = t.getPlanetMarket(at)[0].goods;
      t.takeMarketSupply(at, goods, Math.floor(t.marketSupply(at, goods) / 2));
      const snap = (g) => g && g.trade ? {
        risk: g.trade.risk, stage: g.trade.stage, stops: g.trade.stops.slice(), path: g.trade.path.slice(),
        legIndex: g.trade.legIndex, legDays: g.trade.legDays.slice(),
        manifest: g.trade.manifest.map((m) => ({ kind: m.kind, goods: m.goods, tons: m.tons, to: m.to })),
        crossed: g.trade.crossed.slice(), cumulative: g.trade.cumulative, circuits: g.trade.circuits,
      } : null;
      const before = { trade: snap(f), supply: t.marketSupply(at, goods), jobs: t.worldOpenJobs(at).length,
        transit: f.transit ? { to: f.transit.to, arrivalDay: f.transit.arrivalDay } : null };
      t.saveGame(6);
      t.startWithFaction('terran');
      const wiped = { stock: Object.keys(s.marketStock || {}).length, jobs: Object.keys(s.worldJobs || {}).length };
      t.loadGame(6);
      const g = s.playerFleet.find((x) => x.id === 'gate-persist-2');
      const after = { trade: snap(g), supply: t.marketSupply(at, goods), jobs: t.worldOpenJobs(at).length,
        transit: g && g.transit ? { to: g.transit.to, arrivalDay: g.transit.arrivalDay } : null };
      return { saved: true, before, wiped, after };
    });
    assert.ok(r.saved, `${r.reason}`);
    assert.equal(r.wiped.stock, 0, 'precondition: a new campaign kept the previous one’s shelves');
    assert.ok(r.before.trade, 'precondition: the trader had no circuit to save');
    assert.ok(r.after.trade, 'the trader came back from the save with no circuit at all');
    assert.deepEqual(r.after.trade.stops, r.before.trade.stops,
      `the circuit came back calling at ${JSON.stringify(r.after.trade.stops)} instead of ${JSON.stringify(r.before.trade.stops)}`);
    assert.deepEqual(r.after.trade.path, r.before.trade.path, 'the route came back different');
    assert.equal(r.after.trade.legIndex, r.before.trade.legIndex,
      `the ship came back on leg ${r.after.trade.legIndex} instead of leg ${r.before.trade.legIndex}`);
    assert.deepEqual(r.after.trade.manifest, r.before.trade.manifest, 'the manifest came back different');
    assert.deepEqual(r.after.trade.crossed, r.before.trade.crossed, 'the record of systems crossed came back different');
    assert.deepEqual(r.after.transit, r.before.transit, 'the leg the ship was flying came back different');
    assert.equal(r.after.supply, r.before.supply,
      `the shelf came back at ${r.after.supply} tons instead of ${r.before.supply}`);
    assert.equal(r.after.jobs, r.before.jobs,
      `the world came back with ${r.after.jobs} shipments open instead of ${r.before.jobs}`);
  });

  // CIRCUIT-6 — a world that deals with the ship but has nothing for her to do was reported as a routing
  // failure and the trader was left standing there. Measured at 4,342 idle days out of 5,000.
  await check('CIRCUIT a trader with no work here moves on rather than standing still', async () => {
    await fresh('play-circuit-idle');
    const r = await ev(() => {
      const t = testBM1, s = t.state;
      if (typeof t.planFleetTradeCircuit !== 'function') return { moves: false, reason: 'there is no circuit to plan' };
      // Only this world's prices are known, so there is no commodity lot anywhere to plan for...
      window.__tradeSetup({ learn: 1 });
      window.__tradeShip('gate-idle-1', { big: true });
      const f = s.playerFleet.find((x) => x.id === 'gate-idle-1');
      const trade = t.ensureFleetTradeState(f, 'any');
      trade.active = true;
      const at = Number(s.currentPlanet);
      // ...and this world's book of work is empty, so there is no shipment either. The world itself is
      // untouched: it trades, it will deal with her, and there is simply nothing to do.
      s.worldJobs = { [at]: { day: s.day, jobs: [], seq: 1 } };
      const open = t.worldOpenJobs(at).length;
      const trades = t.worldTrades(at);
      const refusal = t.serviceRefusal(t.getSystemFaction(at));
      const plan = t.planFleetTradeCircuit(f, trade, s.day);
      return { moves: true, at, name: s.planets[at]?.name, open, trades, refusal,
        ok: Boolean(plan.ok), repositioning: Boolean(plan.repositioning), note: String(plan.note || ''),
        stops: plan.ok ? plan.plan.stops.slice() : [], legs: plan.ok ? plan.plan.path.length : 0 };
    });
    assert.ok(r.moves, `${r.reason}`);
    assert.equal(r.trades, true, `precondition: ${r.name} has no market at all, so this is the wrong case`);
    assert.ok(!r.refusal, `precondition: ${r.name} refuses the captain, which is TRADE-4's case: "${r.refusal}"`);
    assert.equal(r.open, 0, `precondition: ${r.name} still has ${r.open} shipments open`);
    assert.equal(r.ok, true,
      `${r.name} will deal with the trader and has nothing for her to do, and the planner answers "${r.note}" — she stands there for the rest of the campaign`);
    assert.equal(r.repositioning, true,
      `a plan was produced but it is not a move: the trader stays at ${r.name} with no work`);
    assert.ok(r.stops.length === 1 && r.stops[0] !== r.at,
      `the trader was sent to ${JSON.stringify(r.stops)} from ${r.at}`);
    assert.ok(r.legs > 0, 'the move has no route to fly');
    assert.ok(/no work/i.test(r.note), `the panel does not say why she left: "${r.note}"`);
  });

  // CIRCUIT-7 — a hold full of cargo nobody nearby was buying stopped a trader for good: she could not
  // plan, so she never went anywhere, so nobody ever bought it. Measured at nine tenths of a campaign.
  await check('CIRCUIT a trader whose hold nobody will buy goes where somebody will', async () => {
    await fresh('play-circuit-fullhold');
    const r = await ev(() => {
      const t = testBM1, s = t.state;
      if (typeof t.planFleetTradeCircuit !== 'function') return { moves: false, reason: 'there is no circuit to plan' };
      window.__tradeSetup({});
      const ship = window.__tradeShip('gate-full-1', { hold: 25 });
      const f = s.playerFleet.find((x) => x.id === 'gate-full-1');
      const trade = t.ensureFleetTradeState(f, 'any');
      trade.active = true;
      const at = Number(s.currentPlanet);
      const hold = t.fleetTradeCapacity(f);
      const goods = t.getPlanetMarket(at)[0].goods;
      // Every ton of her is cargo with no address, and this world is not buying it.
      trade.manifest = [{ kind: 'goods', goods, tons: hold, to: null, unit: 1, paid: 0 }];
      t.fillMarketDemand(at, goods, t.marketDemand(at, goods));
      const plan = t.planFleetTradeCircuit(f, trade, s.day);
      const wanted = plan.ok && plan.repositioning ? t.marketDemand(Number(plan.plan.stops[0]), goods) : 0;
      return { moves: true, at, name: s.planets[at]?.name, hold, load: t.fleetTradeLoad(trade), goods,
        hereWants: t.marketDemand(at, goods), ok: Boolean(plan.ok), repositioning: Boolean(plan.repositioning),
        note: String(plan.note || ''), stops: plan.ok ? plan.plan.stops.slice() : [],
        legs: plan.ok ? plan.plan.path.length : 0, wanted };
    });
    assert.ok(r.moves, `${r.reason}`);
    assert.equal(r.load, r.hold, `precondition: the ${r.hold}-ton hold is carrying ${r.load} tons, so it is not full`);
    assert.equal(r.hereWants, 0, `precondition: ${r.name} still wants ${r.hereWants} tons of ${r.goods}`);
    assert.equal(r.ok, true,
      `a full hold of ${r.goods} nobody at ${r.name} is buying, and the planner answers "${r.note}" — she stands there with it for the rest of the campaign`);
    assert.equal(r.repositioning, true, `a plan was produced but it is not a move: the trader stays at ${r.name}`);
    assert.ok(r.stops.length === 1 && r.stops[0] !== r.at, `the trader was sent to ${JSON.stringify(r.stops)} from ${r.at}`);
    assert.ok(r.legs > 0, 'the move has no route to fly');
    assert.ok(r.wanted > 0,
      `she was sent to system ${r.stops[0]}, which is buying ${r.wanted} tons of the ${r.goods} filling her hold`);
  });

  // CIRCUIT-8 — a hold full of a shipment still to be delivered was treated as a hold full of cargo
  // nobody had bought: the planner asked where to sell it instead of taking it where it was going, and
  // a five-ton hull with a five-ton courier lot aboard bounced between buyers of a cargo that was never
  // for sale, for two thousand days.
  await check('CIRCUIT a hold full of a shipment is a delivery to fly, not cargo to get rid of', async () => {
    await fresh('play-circuit-full-shipment');
    const r = await ev(() => {
      const t = testBM1, s = t.state;
      if (typeof t.planFleetTradeCircuit !== 'function') return { flies: false, reason: 'there is no circuit to plan' };
      window.__tradeSetup({});
      window.__tradeShip('gate-fullship-1', { hold: 25 });
      const f = s.playerFleet.find((x) => x.id === 'gate-fullship-1');
      const trade = t.ensureFleetTradeState(f, 'any');
      trade.active = true;
      const at = Number(s.currentPlanet);
      const hold = t.fleetTradeCapacity(f);
      // Somewhere she may deliver to.
      let to = null;
      for (let i = 0; i < s.planets.length; i++) {
        if (i === at || !t.worldTrades(i) || t.serviceRefusal(t.getSystemFaction(i))) continue;
        if (t.fleetTradeDeliverable(f, trade, at, i)) { to = i; break; }
      }
      if (to == null) return { flies: true, found: false };
      const goods = t.getPlanetMarket(at)[0].goods;
      // Every ton of her is one shipment, addressed there.
      trade.manifest = [{ kind: 'job', jobId: `job-${at}-9`, goods, tons: hold, to, from: at, owner: s.planets[at]?.name,
        createdDay: s.day, fee: 800, payPerTon: 20, paid: 0 }];
      const plan = t.planFleetTradeCircuit(f, trade, s.day);
      return { flies: true, found: true, at, to, toName: s.planets[to]?.name, hold, load: t.fleetTradeLoad(trade),
        ok: Boolean(plan.ok), repositioning: Boolean(plan.repositioning), note: String(plan.note || ''),
        stops: plan.ok ? plan.plan.stops.map(Number) : [] };
    });
    assert.ok(r.flies, `${r.reason}`);
    assert.ok(r.found, 'precondition: nowhere the trader may deliver to');
    assert.equal(r.load, r.hold, `precondition: the ${r.hold}-ton hold carries ${r.load} tons, so it is not full`);
    assert.ok(r.ok, `with a full hold of a shipment for ${r.toName}, the planner gave up: ${r.note}`);
    assert.equal(r.repositioning, false,
      `with a full hold of a shipment for ${r.toName}, the trader is repositioning ("${r.note}") instead of delivering it`);
    assert.ok(r.stops.includes(r.to), `the circuit calls at ${JSON.stringify(r.stops)} and not at ${r.toName}, where the shipment aboard is going`);
  });

  // FAILED-CARGO-OWNER — freight from a failed contract was carried as unaddressed stock and sold at
  // the next port that was buying, so a failed delivery turned the shipper's goods into the captain's
  // free merchandise. It is the shipper's: it goes home, for nothing, and is never sold.
  await check('FAILED-CARGO-OWNER undelivered freight goes back to its shipper for nothing, and is never sold', async () => {
    await fresh('play-failed-cargo-owner');
    const r = await ev(() => {
      const t = testBM1, s = t.state;
      if (typeof t.completeFleetTradeCircuit !== 'function') return { owned: false, reason: 'a circuit never completes with cargo aboard' };
      window.__tradeSetup({});
      window.__tradeShip('gate-owner-1', { big: true });
      const f = s.playerFleet.find((x) => x.id === 'gate-owner-1');
      const trade = t.ensureFleetTradeState(f, 'any');
      trade.active = true;
      const origin = Number(s.currentPlanet);
      // A governed destination the captain can be refused at.
      let target = null, faction = null;
      for (let i = 0; i < s.planets.length; i++) {
        if (i === origin) continue;
        const key = t.getSystemFaction(i);
        if (!key || key === 'neutral' || key === s.playerFaction || !t.worldTrades(i)) continue;
        target = i; faction = key; break;
      }
      if (target == null) return { owned: true, found: false };
      t.adjustFactionStanding(faction, -100, { silent: true });
      if (!t.serviceRefusal(faction)) return { owned: true, found: true, refused: false, faction };
      const goods = t.getPlanetMarket(origin)[0].goods;
      trade.manifest = [{ kind: 'job', jobId: `job-${origin}-7`, goods, tons: 30, to: target, from: origin,
        owner: s.planets[origin]?.name, fee: 500, payPerTon: 20, paid: 0 }];
      trade.stops = [target]; trade.path = [target]; trade.legDays = [1]; trade.legIndex = 0;
      trade.paid = 0; trade.revenue = 0; trade.stage = 'outbound'; trade.destination = target;
      // The circuit ends at the refusing port with the shipment undelivered...
      f.systemIndex = target; delete f.transit;
      t.completeFleetTradeCircuit(f, trade);
      const afterCircuit = { load: t.fleetTradeLoad(trade), purse: s.latinum,
        entry: (trade.manifest || []).map((m) => ({ kind: m.kind, to: m.to, tons: m.tons })) };
      // ...then she calls at a third world that is buying exactly this good, and is not the shipper's.
      let buyer = null;
      for (let i = 0; i < s.planets.length; i++) {
        if (i === origin || i === target || !t.worldTrades(i)) continue;
        if (t.serviceRefusal(t.getSystemFaction(i))) continue;
        if (t.marketDemand(i, goods) >= 30) { buyer = i; break; }
      }
      if (buyer == null) return { owned: true, found: true, refused: true, buyerFound: false, goods };
      trade.active = true; trade.stage = 'outbound'; trade.stops = [buyer]; trade.path = [buyer]; trade.legIndex = 0;
      f.systemIndex = buyer; delete f.transit;
      const purseBefore = s.latinum;
      t.fleetTradeCall(f, trade, buyer, s.day);
      const atBuyer = { load: t.fleetTradeLoad(trade), purse: s.latinum, gained: s.latinum - purseBefore };
      // ...and then plans afresh from there: the shipper's world has to be on the route.
      trade.stops = []; trade.path = []; trade.stage = 'idle';
      const plan = t.planFleetTradeCircuit(f, trade, s.day);
      const routed = plan.ok ? plan.plan.stops.map(Number) : [];
      // ...and at the shipper's world the freight is handed back for nothing.
      const purseHome = s.latinum;
      trade.active = true; trade.stage = 'outbound'; trade.stops = [origin]; trade.path = [origin]; trade.legIndex = 0;
      f.systemIndex = origin; delete f.transit;
      t.fleetTradeCall(f, trade, origin, s.day);
      const atHome = { load: t.fleetTradeLoad(trade), gained: s.latinum - purseHome, log: String(s.log || '') };
      return { owned: true, found: true, refused: true, buyerFound: true, goods, origin, target, buyer,
        originName: s.planets[origin]?.name, buyerName: s.planets[buyer]?.name,
        afterCircuit, atBuyer, planOk: Boolean(plan.ok), planNote: String(plan.note || ''), routed, atHome };
    });
    assert.ok(r.owned, `${r.reason}`);
    assert.ok(r.found, 'precondition: no governed destination was available to refuse the captain');
    assert.ok(r.refused, `precondition: dropping ${r.faction} standing to the floor did not make them refuse the captain`);
    assert.ok(r.buyerFound, `precondition: no third world is buying thirty tons of ${r.goods}`);
    assert.equal(r.afterCircuit.load, 30, `${30 - r.afterCircuit.load} of 30 tons of the shipper's freight were destroyed at the end of the circuit`);
    assert.equal(r.atBuyer.gained, 0,
      `${r.buyerName} is buying ${r.goods}, and the trader sold the shipper's ${30 - r.atBuyer.load} tons of it there for ${r.atBuyer.gained} latinum: a failed delivery became the captain's free merchandise`);
    assert.equal(r.atBuyer.load, 30, `${30 - r.atBuyer.load} tons of the shipper's freight left the hold at ${r.buyerName}, which is not where it came from`);
    assert.ok(r.planOk, `with the shipper's freight aboard, the trader could not plan at all: ${r.planNote}`);
    assert.ok(r.routed.includes(r.origin),
      `the next circuit calls at ${JSON.stringify(r.routed)} and not at ${r.originName}, where the freight belongs`);
    assert.equal(r.atHome.load, 0, `${r.atHome.load} tons of the shipper's freight are still aboard after calling at ${r.originName}`);
    assert.equal(r.atHome.gained, 0, `returning the shipper's freight paid the captain ${r.atHome.gained} latinum`);
    assert.ok(/returned .* nothing owed/i.test(r.atHome.log), `the return was not reported: "${r.atHome.log}"`);
  });

  // JOB-4 — a shipment's price was its tonnage times a rate, so the whole cost of the voyage was
  // charged again on every ton and one full hold was worth more than a warship.
  await check('JOB the voyage is paid for once, and the tonnage by the ton', async () => {
    await fresh('play-job-fee');
    const r = await ev(() => {
      const t = testBM1, s = t.state;
      if (typeof t.getContractTotal !== 'function') return { priced: false, reason: 'a shipment has no price to read' };
      window.__tradeSetup({});
      const jobs = [];
      // A tree with a world book of work is read from the book; one without it still quotes freight, so
      // the check reads the quotes it offers rather than falling over on a name it does not have.
      if (typeof t.worldTrades === 'function' && typeof t.worldOpenJobs === 'function') {
        for (let i = 0; i < s.planets.length && jobs.length < 60; i++)
          if (t.worldTrades(i)) for (const j of t.worldOpenJobs(i)) jobs.push(j);
      } else if (typeof t.createCargoRunOffer === 'function') {
        for (let k = 0; k < 60; k++) { const o = t.createCargoRunOffer(); if (o) jobs.push(o); }
      }
      if (jobs.length < 4) return { priced: true, found: false, n: jobs.length };
      // The same shipment, twice the load. The voyage has not got any longer.
      const doubled = jobs.map((j) => ({ id: j.id, tons: j.tons,
        one: t.getContractTotal(j), two: t.getContractTotal({ ...j, tons: j.tons * 2 }) }));
      const proportional = doubled.filter((d) => d.two >= d.one * 2);
      // And across a real board, what a ton of hold is worth must depend on how big the shipment is.
      const perTon = jobs.map((j) => t.getContractTotal(j) / Math.max(1, j.tons)).sort((a, b) => a - b);
      return { priced: true, found: true, n: jobs.length, proportional: proportional.slice(0, 3),
        proportionalCount: proportional.length,
        spread: Math.round((perTon[perTon.length - 1] / Math.max(0.01, perTon[0])) * 10) / 10,
        lowPerTon: Math.round(perTon[0]), highPerTon: Math.round(perTon[perTon.length - 1]) };
    });
    assert.ok(r.priced, `${r.reason}`);
    assert.ok(r.found, `precondition: only ${r.n} shipments were open anywhere on the map`);
    assert.equal(r.proportionalCount, 0,
      `${r.proportionalCount} of ${r.n} shipments cost twice as much for twice the load: e.g. ${JSON.stringify(r.proportional[0])} — the voyage is being charged again on every ton`);
    assert.ok(r.spread >= 4,
      `a ton of hold is worth between ${r.lowPerTon} and ${r.highPerTon} latinum whatever the shipment (a spread of ${r.spread}x): the price is a flat rate per ton, so the size of the job makes no difference to what it is worth carrying`);
  });

  // CIRCUIT-5 — a shipment to a port that would not deal with the ship was struck off the manifest at
  // the end of the circuit and its tons ceased to exist. The contract is lost, but the goods are in
  // the hold and nothing in the game has taken them out of it.
  await check('CIRCUIT a failed delivery loses the contract, not the cargo', async () => {
    await fresh('play-circuit-conserve');
    const r = await ev(() => {
      const t = testBM1, s = t.state;
      if (typeof t.completeFleetTradeCircuit !== 'function') return { conserves: false, reason: 'a circuit never completes with cargo aboard' };
      window.__tradeSetup({});
      window.__tradeShip('gate-conserve-1', { big: true });
      const f = s.playerFleet.find((x) => x.id === 'gate-conserve-1');
      const trade = t.ensureFleetTradeState(f, 'any');
      trade.active = true;
      // A governed destination the captain can be refused at, reachable and not the ship's own world.
      let target = null, faction = null;
      for (let i = 0; i < s.planets.length; i++) {
        if (i === Number(s.currentPlanet)) continue;
        const key = t.getSystemFaction(i);
        if (!key || key === 'neutral' || key === s.playerFaction) continue;
        if (!t.worldTrades(i)) continue;
        target = i; faction = key; break;
      }
      if (target == null) return { conserves: true, found: false };
      t.adjustFactionStanding(faction, -100, { silent: true });
      if (!t.serviceRefusal(faction)) return { conserves: true, found: true, refused: false, faction };
      // One shipment addressed there, and one ordinary lot with nowhere in particular to go, so the
      // check reads the whole hold rather than one entry.
      const goods = t.getPlanetMarket(Number(s.currentPlanet))[0].goods;
      const origin = Number(s.currentPlanet);
      trade.manifest = [
        { kind: 'job', jobId: `job-${origin}-1`, goods, tons: 40, to: target, from: origin, owner: s.planets[origin]?.name, fee: 500, payPerTon: 20, paid: 0 },
        { kind: 'goods', goods, tons: 9, to: target, unit: 5, paid: 45 },
      ];
      trade.stops = [target]; trade.path = [target]; trade.legDays = [1]; trade.legIndex = 0;
      trade.paid = 45; trade.revenue = 0; trade.stage = 'outbound'; trade.destination = target;
      const before = { load: t.fleetTradeLoad(trade), purse: s.latinum, circuits: trade.circuits };
      t.completeFleetTradeCircuit(f, trade);
      const after = { load: t.fleetTradeLoad(trade), purse: s.latinum, circuits: trade.circuits };
      return { conserves: true, found: true, refused: true, faction, target, origin, before, after,
        kinds: trade.manifest.map((m) => ({ kind: m.kind, tons: m.tons, to: m.to, paid: m.paid })),
        note: trade.note };
    });
    assert.ok(r.conserves, `${r.reason}`);
    assert.ok(r.found, 'precondition: no governed destination was available to refuse the captain');
    assert.ok(r.refused, `precondition: dropping ${r.faction} standing to the floor did not make them refuse the captain`);
    assert.equal(r.after.load, r.before.load,
      `${r.before.load} tons went into the circuit and ${r.after.load} came out: ${r.before.load - r.after.load} tons of undeliverable freight were destroyed by the end of the circuit`);
    assert.equal(r.after.purse, r.before.purse,
      `a failed delivery paid the captain ${r.after.purse - r.before.purse} latinum`);
    assert.ok(r.kinds.every((m) => m.kind !== 'job'),
      `the failed contract is still on the books as a contract: ${JSON.stringify(r.kinds)}`);
    const failed = r.kinds.find((m) => m.tons === 40);
    assert.ok(failed, `the forty tons of undeliverable freight are not aboard as one entry: ${JSON.stringify(r.kinds)}`);
    assert.equal(failed.paid, 0,
      'the goods from a failed contract came out of the circuit carrying a cost the captain never paid');
    assert.ok(r.kinds.find((m) => m.tons === 9)?.to === null,
      `the captain's own unsold lot came out of the circuit still addressed somewhere: ${JSON.stringify(r.kinds)}`);
  });

  // ---------- §5 recall and rendezvous ----------
  // A trader can rationally have nowhere to go — every world her setting allows has no work for her —
  // and hold for the rest of the campaign, and the captain had no order that moved her. Measured: a
  // Cautious heavy freighter held 1,626 days at Promelli Drift with two worlds she was allowed to fly
  // to and nothing at either.
  await page.evaluate(() => {
    // A trader standing somewhere with nothing to do and, under her setting, nowhere she may go: the
    // work is cleared and the route home is made unreported, so a Safe trader refuses it.
    window.__boxedTrader = (id, risk) => {
      const t = testBM1, s = t.state;
      const home = Number(s.currentPlanet);
      let at = null, route = null;
      for (let i = 0; i < s.planets.length; i++) {
        if (i === home || !t.isChartSystemVisible(i)) continue;
        const rt = t.getPlottedRoute(i, home);
        if (rt && (rt.systems || []).length >= 3) { at = i; route = rt; break; }
      }
      if (at == null) return null;
      window.__tradeShip(id, { big: true, at });
      const f = s.playerFleet.find((x) => x.id === id);
      const trade = t.ensureFleetTradeState(f, risk || 'safe');
      trade.active = true; trade.stage = 'idle';
      s.worldJobs = {};
      for (const k of (route.systems || []).map(Number)) if (k !== at && s.conditionLog) delete s.conditionLog[k];
      const path = (route.systems || []).map(Number).slice(1);
      const legDays = t.routeLegDays(route);
      return { f, trade, at, home, path, legDays, days: legDays.reduce((n, d) => n + d, 0) };
    };
  });

  // RECALL-1 — no order existed that moved a trader; her setting decided where she could go and, boxed
  // in, she held. Recall sends her to the captain's system whatever the setting says of the route.
  await check('RECALL a trader with nowhere to go can be ordered to the captain, whatever her setting allows', async () => {
    await fresh('play-recall-1');
    const r = await ev(() => {
      const t = testBM1, s = t.state;
      window.__tradeSetup({ learn: 24 });
      if (typeof t.orderFleetRecall !== 'function') return { orders: false, reason: 'there is no order that brings a trader to the captain' };
      const b = window.__boxedTrader('gate-recall-1', 'safe');
      if (!b) return { orders: true, found: false };
      const { f, trade, at, home, path, legDays, days } = b;
      const acceptable = Boolean(t.fleetTradeRouteAcceptable(f, trade, at, home));
      const run = t.planFleetTradeCircuit(f, trade, s.day);
      const boxed = { ok: run.ok, note: run.note };
      const day0 = s.day;
      const ordered = t.orderFleetRecall('gate-recall-1');
      const after = { stage: trade.stage, active: trade.active, to: trade.order?.to, path: trade.path.slice(), eta: trade.etaDay,
        transitTo: f.transit?.to, line: t.fleetTradeStatusLine(f) };
      window.__tradeDays(days);
      const arrived = { day: s.day, at: Number(f.systemIndex), stage: trade.stage, active: trade.active, transit: Boolean(f.transit),
        arrivedDay: trade.order?.arrivedDay, crossed: trade.crossed.slice(), line: t.fleetTradeStatusLine(f), note: trade.note,
        records: path.map((k) => ({ k, source: s.conditionLog?.[k]?.source, day: s.conditionLog?.[k]?.day })),
        jobs: trade.manifest.filter((m) => m.kind === 'job').length };
      return { orders: true, found: true, at, home, path, legDays, days, acceptable, boxed, day0, ordered, after, arrived };
    });
    assert.ok(r.orders, `${r.reason}`);
    assert.ok(r.found, 'precondition: no system two or more legs from the captain');
    assert.equal(r.acceptable, false, 'precondition: a Safe trader accepted the unreported route home');
    assert.equal(r.boxed.ok, false, `precondition: the trader was not boxed in — she planned something: ${JSON.stringify(r.boxed)}`);
    assert.ok(r.ordered, 'the recall order was refused');
    assert.equal(r.after.stage, 'passage', `ordered to the captain, the trader is ${r.after.stage} (${r.after.line})`);
    assert.equal(r.after.to, r.home, `the recall is to system ${r.after.to}, not the captain's ${r.home}`);
    assert.deepEqual(r.after.path, r.path, `she is flying ${JSON.stringify(r.after.path)}, not the plotted route ${JSON.stringify(r.path)}`);
    assert.equal(r.after.transitTo, r.path[0], `she left for ${r.after.transitTo} rather than the first system on the way, ${r.path[0]}`);
    assert.equal(r.after.eta, r.day0 + r.days, `she is due on day ${r.after.eta}; the legs ${JSON.stringify(r.legDays)} make it day ${r.day0 + r.days}`);
    assert.equal(r.after.active, false, 'she is still trading while under orders');
    assert.equal(r.arrived.at, r.home, `on day ${r.arrived.day} she is at system ${r.arrived.at}, not the captain's ${r.home}`);
    assert.equal(r.arrived.transit, false, 'she arrived and is still booked to go somewhere');
    assert.equal(r.arrived.stage, 'holding', `she arrived and is ${r.arrived.stage} rather than holding`);
    assert.equal(r.arrived.active, false, 'arrival put her straight back to trading instead of holding for orders');
    assert.ok(/awaiting orders/i.test(r.arrived.line), `the panel does not say she is awaiting orders: "${r.arrived.line}"`);
    assert.equal(r.arrived.arrivedDay, r.day0 + r.days, `she arrived on day ${r.arrived.arrivedDay}, not day ${r.day0 + r.days}`);
    assert.deepEqual(r.arrived.crossed, r.path, `she crossed ${JSON.stringify(r.arrived.crossed)} rather than every system on the way`);
    assert.ok(r.arrived.records.every((x) => x.source === 'fleet' && x.day >= r.day0),
      `she crossed systems and the captain's records do not carry her reading of them: ${JSON.stringify(r.arrived.records)}`);
    assert.equal(r.arrived.jobs, 0, 'she took on a shipment while under orders');
  });

  // RECALL-2 — recall is to where the captain was when the order was given. A captain who moves on
  // is not pursued; the rendezvous is the system named.
  await check('RECALL is to where the captain was when the order was given, not to wherever the captain goes', async () => {
    await fresh('play-recall-2');
    const r = await ev(() => {
      const t = testBM1, s = t.state;
      window.__tradeSetup({ learn: 24 });
      if (typeof t.orderFleetRecall !== 'function') return { orders: false, reason: 'there is no order that brings a trader to the captain' };
      const b = window.__boxedTrader('gate-recall-2', 'cautious');
      if (!b) return { orders: true, found: false };
      const { f, trade, home, days } = b;
      t.orderFleetRecall('gate-recall-2');
      const named = trade.order?.to;
      // the captain moves on before she arrives
      const elsewhere = [...Array(s.planets.length).keys()].find((i) => i !== home && i !== Number(f.systemIndex) && t.isChartSystemVisible(i));
      s.currentPlanet = elsewhere;
      window.__tradeDays(days);
      return { orders: true, found: true, home, elsewhere, named, at: Number(f.systemIndex), to: trade.order?.to, stage: trade.stage, line: t.fleetTradeStatusLine(f) };
    });
    assert.ok(r.orders, `${r.reason}`);
    assert.ok(r.found, 'precondition: no system two or more legs from the captain');
    assert.equal(r.named, r.home, `the order names system ${r.named}, not the captain's ${r.home}`);
    assert.equal(r.to, r.home, `the captain moved to ${r.elsewhere} and the order followed: it now names ${r.to}`);
    assert.equal(r.at, r.home, `she went to ${r.at}; the captain was at ${r.home} when the order was given`);
    assert.equal(r.stage, 'holding', `she is ${r.stage} rather than holding at the rendezvous`);
  });

  // RENDEZVOUS-1 — a chosen system, the captain's or not, owned or not; her hold stays hers and
  // nothing is sold or taken on the way; the days are the days of the legs.
  await check('RENDEZVOUS a trader can be sent to a chosen charted system the captain does not hold, keeping her hold', async () => {
    await fresh('play-rendezvous-1');
    const r = await ev(() => {
      const t = testBM1, s = t.state;
      window.__tradeSetup({ learn: 24 });
      if (typeof t.orderFleetRendezvous !== 'function') return { orders: false, reason: 'there is no order that sends a trader to a chosen system' };
      window.__tradeShip('gate-rdv-1', { big: true });
      const f = s.playerFleet.find((x) => x.id === 'gate-rdv-1');
      const trade = t.ensureFleetTradeState(f, 'safe');
      const from = Number(s.currentPlanet);
      // A governed world the captain does not hold, at least two legs away, on a route where the days
      // of the legs and one reckoning of the distance differ if such a world exists.
      const worlds = [];
      for (let i = 0; i < s.planets.length; i++) {
        if (i === from || !t.isChartSystemVisible(i)) continue;
        const key = t.getSystemFaction(i);
        if (!key || key === 'neutral' || key === s.playerFaction) continue;
        const rt = t.getPlottedRoute(from, i);
        if (!rt || (rt.systems || []).length < 3) continue;
        const legs = t.routeLegDays(rt);
        worlds.push({ i, key, path: rt.systems.map(Number).slice(1), legs, flown: legs.reduce((n, d) => n + d, 0), reckoned: Math.max(1, t.Fleet.travelDays(rt.distance)) });
      }
      worlds.sort((a, b) => (b.flown - b.reckoned) - (a.flown - a.reckoned));
      const w = worlds[0];
      if (!w) return { orders: true, found: false };
      const goods = t.getPlanetMarket(from)[0].goods;
      trade.manifest = [{ kind: 'goods', goods, tons: 30, to: null, unit: 5, paid: 150 }];
      trade.paid = 150;
      trade.active = true; trade.stage = 'idle';
      const purse = s.latinum;
      const day0 = s.day;
      const ordered = t.orderFleetRendezvous('gate-rdv-1', w.i);
      const after = { stage: trade.stage, to: trade.order?.to, eta: trade.etaDay, line: t.fleetTradeStatusLine(f), active: trade.active };
      window.__tradeDays(w.flown);
      const aboard = trade.manifest.map((m) => ({ kind: m.kind, tons: m.tons, to: m.to }));
      return { orders: true, found: true, from, w, purse, day0, ordered, after,
        arrived: { day: s.day, at: Number(f.systemIndex), stage: trade.stage, active: trade.active, purse: s.latinum, aboard, arrivedDay: trade.order?.arrivedDay, line: t.fleetTradeStatusLine(f) } };
    });
    assert.ok(r.orders, `${r.reason}`);
    assert.ok(r.found, 'precondition: no governed world two or more legs away');
    assert.ok(r.ordered, `the rendezvous at ${r.w.key} system ${r.w.i} was refused`);
    assert.equal(r.after.stage, 'passage', `ordered to rendezvous, the trader is ${r.after.stage} (${r.after.line})`);
    assert.equal(r.after.to, r.w.i, `the rendezvous is at ${r.after.to}, not the chosen ${r.w.i}`);
    assert.equal(r.after.eta, r.day0 + r.w.flown,
      `she is due on day ${r.after.eta}; the legs ${JSON.stringify(r.w.legs)} make it day ${r.day0 + r.w.flown}${r.w.flown !== r.w.reckoned ? ` (one reckoning of the distance would say ${r.day0 + r.w.reckoned})` : ''}`);
    assert.equal(r.arrived.at, r.w.i, `on day ${r.arrived.day} she is at ${r.arrived.at}, not the rendezvous ${r.w.i}`);
    assert.equal(r.arrived.arrivedDay, r.day0 + r.w.flown, `she arrived on day ${r.arrived.arrivedDay}, not day ${r.day0 + r.w.flown}`);
    assert.deepEqual(r.arrived.aboard, [{ kind: 'goods', tons: 30, to: null }], `her hold on arrival: ${JSON.stringify(r.arrived.aboard)} — the 30 tons she left with are not all there`);
    assert.equal(r.arrived.purse, r.purse, `${r.arrived.purse - r.purse} latinum changed hands on a passage`);
    assert.equal(r.arrived.active, false, 'arrival put her back to trading instead of holding for orders');
    assert.ok(/awaiting orders/i.test(r.arrived.line), `the panel does not say she is awaiting orders: "${r.arrived.line}"`);
  });

  // PASSAGE-1 — an order to a ship on a leg takes effect where the leg ends: what belongs at that
  // call comes off, nothing new goes on, and the rest of the circuit is broken off there.
  await check('PASSAGE an order given on a leg takes effect where the leg ends, and the circuit is broken off there', async () => {
    await fresh('play-passage-1');
    const r = await ev(() => {
      const t = testBM1, s = t.state;
      window.__tradeSetup({ learn: 24 });
      if (typeof t.orderFleetRendezvous !== 'function') return { orders: false, reason: 'there is no order that sends a trader to a chosen system' };
      window.__tradeShip('gate-passage-1', { big: true });
      const f = s.playerFleet.find((x) => x.id === 'gate-passage-1');
      t.startFleetTrading('gate-passage-1', 'any');
      window.__tradeDays(1);
      const trade = f.trade;
      if (!(trade.stage === 'outbound' && f.transit && trade.stops.length >= 2)) return { orders: true, found: false, stage: trade.stage, stops: trade.stops };
      const stops = trade.stops.slice();
      const next = Number(f.transit.to);
      const dest = [...Array(s.planets.length).keys()].find((i) => t.isChartSystemVisible(i) && !stops.includes(i) && !trade.path.includes(i) && i !== next && i !== Number(s.currentPlanet) && t.getPlottedRoute(next, i));
      const before = { manifest: trade.manifest.map((m) => ({ kind: m.kind, to: m.to, tons: m.tons })), circuits: trade.circuits, arrival: f.transit.arrivalDay };
      const ordered = t.orderFleetRendezvous('gate-passage-1', dest);
      const pending = { pending: trade.order?.pending, active: trade.active, transitTo: f.transit?.to, line: t.fleetTradeStatusLine(f) };
      window.__tradeDays(before.arrival - s.day);
      const reached = Number(f.systemIndex);
      const after = { reached, stage: trade.stage, origin: trade.origin, to: trade.order?.to, stops: trade.stops.slice(), circuits: trade.circuits,
        manifest: trade.manifest.map((m) => ({ kind: m.kind, to: m.to, tons: m.tons })), transitFrom: f.transit?.from, line: t.fleetTradeStatusLine(f) };
      return { orders: true, found: true, stops, next, dest, before, ordered, pending, after };
    });
    assert.ok(r.orders, `${r.reason}`);
    assert.ok(r.found, `precondition: the trader is not on a leg of a circuit with two or more calls (${r.stage}, ${JSON.stringify(r.stops)})`);
    assert.ok(r.ordered, 'the order to a ship on a leg was refused');
    assert.equal(r.pending.pending, true, 'the order was not recorded against a ship on a leg');
    assert.equal(r.pending.active, false, 'she is still trading with an order against her');
    assert.equal(r.pending.transitTo, r.next, `the order turned her round in warp: she is now bound for ${r.pending.transitTo}, not ${r.next}`);
    assert.equal(r.after.reached, r.next, `she is at ${r.after.reached}; the leg she was on ended at ${r.next}`);
    assert.equal(r.after.stage, 'passage', `at the end of the leg she is ${r.after.stage}, not on her passage (${r.after.line})`);
    assert.equal(r.after.origin, r.next, `the passage is plotted from ${r.after.origin}, not from ${r.next} where the leg ended`);
    assert.deepEqual(r.after.stops, [], `the circuit was not broken off: calls ${JSON.stringify(r.after.stops)} remain`);
    assert.equal(r.after.circuits, r.before.circuits, 'a circuit broken off short was counted as one worked');
    const addressedHere = r.before.manifest.filter((m) => Number(m.to) === r.next).length;
    if (r.stops.includes(r.next))
      assert.equal(r.after.manifest.filter((m) => Number(m.to) === r.next).length, 0,
        `she broke off at a call of her own without unloading the ${addressedHere} entries addressed there`);
    assert.ok(r.after.manifest.length <= r.before.manifest.length - addressedHere,
      `she took something new aboard after the order: ${JSON.stringify(r.after.manifest)} against ${JSON.stringify(r.before.manifest)}`);
  });

  // PASSAGE-2 — the order overrides her tolerance, not the danger. A passage crosses each system on
  // the day she is there and is rolled against the truth; a ship stopped there stays there, with the
  // order unresolved, and flies the rest of it when she is repaired.
  await check('PASSAGE the order is not immunity: a passage through danger is rolled, a stopped ship stays stopped, the order stays unresolved', async () => {
    await fresh('play-passage-2');
    const r = await ev(() => {
      const t = testBM1, s = t.state;
      window.__tradeSetup({ learn: 24 });
      if (typeof t.orderFleetRendezvous !== 'function') return { orders: false, reason: 'there is no order that sends a trader to a chosen system' };
      window.__tradeShip('gate-passage-seed', { big: true });
      const seedShip = s.playerFleet.find((x) => x.id === 'gate-passage-seed');
      const home = Number(s.currentPlanet);
      let dest = null, path = null;
      for (let d = 0; d < s.planets.length && !dest; d++) {
        if (d === home || !t.isChartSystemVisible(d)) continue;
        if (t.trueThreat(d).band !== 0) continue;
        const rt = t.getPlottedRoute(home, d);
        if (!rt) continue;
        const p = (rt.systems || []).map(Number).slice(1);
        if (p.length >= 2 && t.trueThreat(p[0]).band === 0) { dest = d; path = p; }
      }
      if (dest == null) return { orders: true, found: false };
      t.transferSystemControlToFaction(path[0], 'pirate');
      const day0 = s.day;
      let stopped = null;
      for (let k = 0; k < 40 && !stopped; k++) {
        s.day = day0 + k; // a different day, a different roll
        const probe = { id: `gate-passage-p${k}`, shipId: seedShip.shipId, name: `Runner ${k}`, faction: s.playerFaction, assignment: 'defense', systemIndex: home, seed: k };
        s.playerFleet.push(probe);
        const pt = t.ensureFleetTradeState(probe, 'safe');
        const snap = t.ensureFleetVesselSnapshot(probe);
        snap.hull = Math.max(1, Math.round(snap.maxHull * 0.14)); snap.condition = 'operational';
        const ordered = t.orderFleetRendezvous(probe.id, dest);
        if (!ordered) return { orders: true, found: true, refused: true, note: pt.note };
        const legs = pt.legDays.slice();
        window.__tradeDays(legs[0]);
        if (probe.vessel.condition !== 'operational') {
          const halted = { k, at: Number(probe.systemIndex), stage: pt.stage, transit: Boolean(probe.transit), order: pt.order ? { ...pt.order } : null, line: t.fleetTradeStatusLine(probe), crossed: pt.crossed.slice() };
          // repaired where she lies
          probe.vessel.hull = probe.vessel.maxHull; probe.vessel.condition = 'operational';
          const actor = t.fleetLocalActor(probe.id); if (actor) { actor.combatHull = actor.maxCombatHull; actor.condition = 'operational'; }
          window.__tradeDays(1);
          const resumed = { stage: pt.stage, origin: pt.origin, transitFrom: probe.transit?.from, to: pt.order?.to, pending: pt.order?.pending, line: t.fleetTradeStatusLine(probe) };
          stopped = { halted, resumed };
        }
        s.playerFleet = s.playerFleet.filter((x) => x.id !== probe.id);
      }
      return { orders: true, found: true, refused: false, home, dest, path, stopped };
    });
    assert.ok(r.orders, `${r.reason}`);
    assert.ok(r.found, 'precondition: no destination two or more systems away through a quiet first system');
    assert.equal(r.refused, false, `the order through pirate-held space was refused: ${r.note}`);
    assert.ok(r.stopped, `40 ships were ordered through pirate-held system ${r.path[0]} and not one was touched: the order made the passage safe`);
    assert.equal(r.stopped.halted.at, r.path[0], `the ship was stopped but is at ${r.stopped.halted.at}, not at ${r.path[0]} where it happened`);
    assert.equal(r.stopped.halted.transit, false, 'the ship was stopped and is still booked to arrive somewhere');
    assert.deepEqual(r.stopped.halted.crossed, [r.path[0]], `stopped on the first leg, she crossed ${JSON.stringify(r.stopped.halted.crossed)}`);
    assert.ok(r.stopped.halted.order && r.stopped.halted.order.to === r.dest, `the order was dropped when she was stopped: ${JSON.stringify(r.stopped.halted.order)}`);
    assert.ok(/unresolved/i.test(r.stopped.halted.line), `the panel does not say the rendezvous is unresolved: "${r.stopped.halted.line}"`);
    assert.equal(r.stopped.resumed.stage, 'passage', `repaired, she is ${r.stopped.resumed.stage} rather than under way again (${r.stopped.resumed.line})`);
    assert.equal(r.stopped.resumed.origin, r.path[0], `repaired, she flies from ${r.stopped.resumed.origin}, not from ${r.path[0]} where she lay`);
    assert.equal(r.stopped.resumed.to, r.dest, `repaired, she is bound for ${r.stopped.resumed.to}, not the rendezvous ${r.dest}`);
  });

  // PASSAGE-3 — the leg, the destination, the cargo and the order survive a save.
  await check('PASSAGE save and reload resume the leg, the destination, the cargo and the order', async () => {
    await fresh('play-passage-3');
    const r = await ev(() => {
      const t = testBM1, s = t.state;
      window.__tradeSetup({ learn: 24 });
      if (typeof t.orderFleetRendezvous !== 'function') return { orders: false, reason: 'there is no order to save' };
      window.__tradeShip('gate-passage-3', { big: true });
      const f = s.playerFleet.find((x) => x.id === 'gate-passage-3');
      const trade = t.ensureFleetTradeState(f, 'cautious');
      const from = Number(s.currentPlanet);
      const dest = [...Array(s.planets.length).keys()].find((i) => i !== from && t.isChartSystemVisible(i) && (t.getPlottedRoute(from, i)?.systems || []).length >= 4);
      if (dest == null) return { orders: true, found: false };
      const goods = t.getPlanetMarket(from)[0].goods;
      trade.manifest = [{ kind: 'goods', goods, tons: 12, to: null, unit: 5, paid: 60 }];
      t.orderFleetRendezvous('gate-passage-3', dest);
      const eta = trade.etaDay;
      window.__tradeDays(trade.legDays[0]); // on the second leg
      const snap = (g) => ({ day: s.day, at: Number(g.systemIndex), transit: g.transit ? { ...g.transit } : null, stage: g.trade.stage, legIndex: g.trade.legIndex,
        path: g.trade.path.slice(), order: g.trade.order ? { ...g.trade.order } : null, tons: g.trade.manifest.reduce((n, m) => n + m.tons, 0), eta: g.trade.etaDay, crossed: g.trade.crossed.slice() });
      const before = snap(f);
      t.saveGame(9);
      t.startWithFaction('terran');
      const wiped = s.playerFleet.length;
      t.loadGame(9);
      const g = s.playerFleet.find((x) => x.id === 'gate-passage-3');
      if (!g || !g.trade) return { orders: true, found: true, reloaded: false, wiped };
      const after = snap(g);
      window.__tradeDays(eta - s.day);
      const arrived = { day: s.day, at: Number(g.systemIndex), stage: g.trade.stage, crossed: g.trade.crossed.slice(), tons: g.trade.manifest.reduce((n, m) => n + m.tons, 0), arrivedDay: g.trade.order?.arrivedDay };
      return { orders: true, found: true, reloaded: true, wiped, dest, eta, before, after, arrived };
    });
    assert.ok(r.orders, `${r.reason}`);
    assert.ok(r.found, 'precondition: no destination three or more legs away');
    assert.equal(r.wiped, 0, 'precondition: a new campaign kept the old fleet');
    assert.ok(r.reloaded, 'the trader came back from the save with no order at all');
    assert.deepEqual(r.after.order, r.before.order, `the order came back as ${JSON.stringify(r.after.order)} instead of ${JSON.stringify(r.before.order)}`);
    assert.deepEqual(r.after.transit, r.before.transit, `the leg came back as ${JSON.stringify(r.after.transit)} instead of ${JSON.stringify(r.before.transit)}`);
    assert.equal(r.after.legIndex, r.before.legIndex, `she came back on leg ${r.after.legIndex} instead of ${r.before.legIndex}`);
    assert.deepEqual(r.after.path, r.before.path, 'the route came back different');
    assert.equal(r.after.tons, r.before.tons, `${r.before.tons} tons aboard came back as ${r.after.tons}`);
    assert.equal(r.after.stage, 'passage', `she came back ${r.after.stage} rather than on her passage`);
    assert.equal(r.arrived.at, r.dest, `after the reload she ended at ${r.arrived.at}, not the rendezvous ${r.dest}`);
    assert.equal(r.arrived.arrivedDay, r.eta, `after the reload she arrived on day ${r.arrived.arrivedDay}, not day ${r.eta}`);
    assert.deepEqual(r.arrived.crossed, r.before.path, `after the reload she crossed ${JSON.stringify(r.arrived.crossed)}, not the whole route ${JSON.stringify(r.before.path)}`);
    assert.equal(r.arrived.tons, r.before.tons, 'cargo went missing between the reload and the rendezvous');
  });

  // PASSAGE-4 — a rendezvous changed en route is replotted from where she is; a cancelled one ends
  // at the end of the leg she is on, and she holds there.
  await check('PASSAGE a changed rendezvous is replotted from where she is, and a cancelled one ends where the leg ends', async () => {
    await fresh('play-passage-4');
    const r = await ev(() => {
      const t = testBM1, s = t.state;
      window.__tradeSetup({ learn: 24 });
      if (typeof t.orderFleetRendezvous !== 'function' || typeof t.cancelFleetPassage !== 'function') return { orders: false, reason: 'there is no rendezvous to change or cancel' };
      window.__tradeShip('gate-passage-4', { big: true });
      const f = s.playerFleet.find((x) => x.id === 'gate-passage-4');
      const trade = t.ensureFleetTradeState(f, 'cautious');
      const from = Number(s.currentPlanet);
      const far = (origin, not) => [...Array(s.planets.length).keys()].filter((i) => i !== origin && !not.includes(i) && t.isChartSystemVisible(i) && (t.getPlottedRoute(origin, i)?.systems || []).length >= 4)
        .sort((a, b) => t.getPlottedRoute(origin, b).systems.length - t.getPlottedRoute(origin, a).systems.length)[0];
      const A = far(from, []);
      if (A == null) return { orders: true, found: false };
      t.orderFleetRendezvous('gate-passage-4', A);
      const routeA = trade.path.slice();
      window.__tradeDays(trade.legDays[0]);
      const at1 = Number(f.systemIndex), next1 = Number(f.transit?.to);
      const B = far(next1, [A, from, at1]);
      if (B == null) return { orders: true, found: false };
      const fromDeparture = (t.getPlottedRoute(from, B)?.systems || []).map(Number).slice(1);
      const fromActual = (t.getPlottedRoute(next1, B)?.systems || []).map(Number).slice(1);
      t.orderFleetRendezvous('gate-passage-4', B);
      const mid = { pending: trade.order?.pending, transitTo: f.transit?.to, line: t.fleetTradeStatusLine(f) };
      window.__tradeDays(f.transit.arrivalDay - s.day);
      const replotted = { at: Number(f.systemIndex), origin: trade.origin, path: trade.path.slice(), to: trade.order?.to, stage: trade.stage, line: t.fleetTradeStatusLine(f) };
      // now cancel on the next leg
      window.__tradeDays(trade.legDays[0]);
      const holdAt = Number(f.transit?.to);
      const cancelled = t.cancelFleetPassage('gate-passage-4');
      const cancelLine = t.fleetTradeStatusLine(f);
      window.__tradeDays(f.transit.arrivalDay - s.day);
      const held = { at: Number(f.systemIndex), stage: trade.stage, active: trade.active, transit: Boolean(f.transit), line: t.fleetTradeStatusLine(f) };
      return { orders: true, found: true, from, A, B, routeA, at1, next1, fromDeparture, fromActual, mid, replotted, holdAt, cancelled, cancelLine, held };
    });
    assert.ok(r.orders, `${r.reason}`);
    assert.ok(r.found, 'precondition: no pair of destinations three or more legs away');
    assert.equal(r.mid.pending, true, 'the change of rendezvous was not recorded against a ship on a leg');
    assert.equal(r.mid.transitTo, r.next1, `the change turned her round in warp: bound for ${r.mid.transitTo}, not ${r.next1}`);
    assert.equal(r.replotted.at, r.next1, `she is at ${r.replotted.at}; the leg ended at ${r.next1}`);
    assert.equal(r.replotted.to, r.B, `she is bound for ${r.replotted.to}, not the changed rendezvous ${r.B}`);
    assert.equal(r.replotted.origin, r.next1, `the new route is plotted from ${r.replotted.origin}, not from ${r.next1} where she is`);
    assert.deepEqual(r.replotted.path, r.fromActual,
      `the new route is ${JSON.stringify(r.replotted.path)}; from where she is it is ${JSON.stringify(r.fromActual)}${JSON.stringify(r.replotted.path) === JSON.stringify(r.fromDeparture) ? ' — it was plotted from her original departure' : ''}`);
    assert.ok(r.cancelled, 'the cancel was refused');
    assert.equal(r.held.at, r.holdAt, `cancelled on a leg to ${r.holdAt}, she is at ${r.held.at}`);
    assert.equal(r.held.stage, 'holding', `cancelled, she is ${r.held.stage} rather than holding (${r.held.line})`);
    assert.equal(r.held.transit, false, 'cancelled, she is still booked to go somewhere');
    assert.equal(r.held.active, false, 'cancelling the rendezvous put her back to trading');
    assert.ok(/awaiting orders/i.test(r.held.line), `the panel does not say she is awaiting orders: "${r.held.line}"`);
  });

  // PASSAGE-5 — a formation dispatch put a trading member in one jump to the formation's destination
  // while her circuit still had her on a route of her own.
  await check('PASSAGE a formation dispatch cannot pull a trader off her own route', async () => {
    await fresh('play-passage-5');
    const r = await ev(() => {
      const t = testBM1, s = t.state;
      window.__tradeSetup({ learn: 24 });
      window.__tradeShip('gate-passage-5', { big: true });
      const f = s.playerFleet.find((x) => x.id === 'gate-passage-5');
      if (typeof t.startFleetTrading !== 'function') return { trades: false, reason: 'a fleet ship cannot be ordered to trade' };
      t.startFleetTrading('gate-passage-5', 'any');
      window.__tradeDays(1);
      const trade = f.trade;
      if (!(trade.stage === 'outbound' && f.transit)) return { trades: true, found: false, stage: trade.stage };
      const b = t.fleetBook();
      const g = b.formations.find((x) => x.members.includes(f.id));
      const onWay = Number(f.transit.to);
      // The route she is on: a path of legs on a tree that flies leg by leg, her destination on one that does not.
      const own = Array.isArray(trade.path) ? trade.path.map(Number) : [Number(trade.destination)].filter(Number.isFinite);
      const dest = [...Array(s.planets.length).keys()].find((i) => t.isChartSystemVisible(i) && i !== onWay && i !== Number(s.currentPlanet) && !own.includes(i) && t.getPlottedRoute(Number(f.systemIndex), i));
      g.destination = dest;
      const before = { transit: { ...f.transit }, legIndex: trade.legIndex, own: own.slice() };
      const dispatched = t.dispatchFleetFormation(g.id);
      const pathAt = Array.isArray(trade.path) ? Number(trade.path[trade.legIndex]) : Number(trade.destination);
      return { trades: true, found: true, dest, onWay, before, dispatched, after: { transit: f.transit ? { ...f.transit } : null, stage: trade.stage, pathAt } };
    });
    assert.ok(r.trades, `${r.reason}`);
    assert.ok(r.found, `precondition: the trader is not on a leg of a circuit (${r.stage})`);
    assert.equal(r.dispatched, false,
      `the formation was dispatched to ${r.dest} with a trader on a leg to ${r.onWay}: she is now booked to ${r.after.transit?.to} in one jump while her circuit still has her on the way to ${r.after.pathAt}`);
    assert.deepEqual(r.after.transit, r.before.transit, `the refused dispatch still changed her leg: ${JSON.stringify(r.after.transit)}`);
  });

  // PASSAGE-6 — the fleet manager offered no way to move a trader; and what it shows of an order is
  // the destination, the day, and the controls, not prose.
  await check('PASSAGE the fleet manager offers recall, rendezvous, change and cancel, and shows destination and day', async () => {
    await fresh('play-passage-6');
    const r = await ev(() => {
      const t = testBM1, s = t.state;
      window.__tradeSetup({ learn: 24 });
      window.__tradeShip('gate-passage-6', { big: true });
      const f = s.playerFleet.find((x) => x.id === 'gate-passage-6');
      const from = Number(s.currentPlanet);
      const dest = [...Array(s.planets.length).keys()].find((i) => i !== from && t.isChartSystemVisible(i) && (t.getPlottedRoute(from, i)?.systems || []).length >= 3);
      const row = () => {
        t.renderFleetManager(true);
        const dlg = document.querySelector('dialog.fleet-manager');
        const details = [...dlg.querySelectorAll('details')].find((d) => d.querySelector('summary')?.textContent.includes('gate-passage-6'));
        const block = details?.querySelector('.fleet-trade');
        const buttons = block ? [...block.querySelectorAll('button[data-fleet-action]')].map((b) => [b.dataset.fleetAction, b.textContent.trim()]) : [];
        const select = block?.querySelector('select[data-fleet-passage]');
        const status = block?.querySelector('p')?.textContent.trim() || '';
        return { buttons, hasSelect: Boolean(select), options: select ? select.options.length : 0, status };
      };
      const idle = row();
      // choose the destination in the panel and press the button, as the captain would
      const dlg = document.querySelector('dialog.fleet-manager');
      const select = [...dlg.querySelectorAll('select[data-fleet-passage]')].find((e) => e.dataset.fleetPassage === 'gate-passage-6');
      if (select) select.value = String(dest);
      const button = [...dlg.querySelectorAll('button[data-fleet-action="rendezvous"]')].find((b) => b.dataset.fleetId === 'gate-passage-6');
      if (button) button.click();
      const underWay = row();
      document.querySelector('dialog.fleet-manager')?.close();
      return { dest, name: s.planets[dest]?.name, eta: f.trade?.etaDay, stage: f.trade?.stage, idle, underWay };
    });
    const actions = (x) => x.buttons.map((b) => b[0]);
    assert.ok(actions(r.idle).includes('recall') && actions(r.idle).includes('rendezvous'),
      `the fleet manager offers no way to recall or send a trader anywhere: controls are ${JSON.stringify(r.idle.buttons)}`);
    assert.ok(r.idle.hasSelect && r.idle.options > 1, 'there is no way to choose the rendezvous system');
    assert.equal(r.stage, 'passage', `pressing the button in the panel did not send her (${r.stage})`);
    assert.ok(r.underWay.status.includes(r.name) && r.underWay.status.includes(`day ${r.eta}`),
      `under way, the row does not show the destination and the day: "${r.underWay.status}"`);
    assert.ok(actions(r.underWay).includes('cancel-passage') && r.underWay.buttons.some((b) => /change/i.test(b[1])),
      `under way, the row does not offer to change or cancel the rendezvous: ${JSON.stringify(r.underWay.buttons)}`);
    assert.ok(!/\. [A-Z]/.test(r.underWay.status) && r.underWay.status.length < 140,
      `the row explains instead of stating: "${r.underWay.status}"`);
  });

  // PASSAGE-RELAY — relays are the command link for distant fleets, and a formation dispatch already
  // waits for one; the trade orders and the passage orders bypassed it. An order to a ship beyond
  // reach is queued, visibly, and acknowledged against where she actually is when a link reaches her;
  // a ship with the captain, or under a relay, takes it at once.
  await check('PASSAGE-RELAY an order to a ship beyond relay reach waits for a link, and reaches her where she then is', async () => {
    await fresh('play-passage-relay');
    const r = await ev(() => {
      const t = testBM1, s = t.state;
      window.__tradeSetup({ learn: 24 });
      if (typeof t.orderFleetRecall !== 'function') return { delivers: false, reason: 'there is no order that brings a trader to the captain' };
      // Give an order the way the panel does on this tree: through command delivery where the tree
      // has it, and straight to the ship where it does not.
      const send = typeof t.sendFleetCommand === 'function' ? (id, c) => t.sendFleetCommand(id, c) : (id, c) => {
        if (c.command === 'recall') return t.orderFleetRecall(id);
        if (c.command === 'rendezvous') return t.orderFleetRendezvous(id, c.destination);
        if (c.command === 'cancel') return t.cancelFleetPassage(id);
        if (c.command === 'trade-start') return t.startFleetTrading(id, c.risk);
        if (c.command === 'trade-stop') return t.stopFleetTrading(id);
        return t.setFleetTradeRisk(id, c.risk);
      };
      const queuedFor = (id) => (t.campaign().orders || []).filter((o) => o.status === 'queued' && o.order === 'fleet' && o.fleetId === id).map((o) => ({ command: o.command, destination: o.destination, systemIndex: o.systemIndex, day: o.queuedDay }));
      const home = Number(s.currentPlanet);
      const connected = (i) => Boolean(t.isSystemRelayConnected(i));
      // A remote system with no link to it, two or more legs from the captain.
      const R = [...Array(s.planets.length).keys()].find((i) => i !== home && t.isChartSystemVisible(i) && !connected(i) && (t.getPlottedRoute(i, home)?.systems || []).length >= 3);
      if (R == null) return { delivers: true, found: false };
      const X = [...Array(s.planets.length).keys()].find((i) => i !== home && i !== R && t.isChartSystemVisible(i) && t.getPlottedRoute(home, i) && t.getPlottedRoute(R, i));
      window.__tradeShip('gate-relay-remote', { big: true, at: R });
      window.__tradeShip('gate-relay-local', { big: true });
      window.__tradeShip('gate-relay-lost', { big: true, at: R, seed: 9 });
      const B = s.playerFleet.find((x) => x.id === 'gate-relay-remote');
      const A = s.playerFleet.find((x) => x.id === 'gate-relay-local');
      const C = s.playerFleet.find((x) => x.id === 'gate-relay-lost');
      // 1. remote Start trading
      send('gate-relay-remote', { command: 'trade-start', risk: 'any' });
      const start = { active: Boolean(B.trade?.active), queued: queuedFor('gate-relay-remote') };
      // 2. remote recall replaces it; nothing happens for days
      send('gate-relay-remote', { command: 'recall', destination: home });
      const recall = { stage: B.trade?.stage, order: B.trade?.order || null, active: Boolean(B.trade?.active), queued: queuedFor('gate-relay-remote') };
      window.__tradeDays(3);
      const later = { at: Number(B.systemIndex), transit: Boolean(B.transit), stage: B.trade?.stage, order: B.trade?.order || null, queued: queuedFor('gate-relay-remote') };
      // 3. the panel says so
      t.renderFleetManager(true);
      const dlg = document.querySelector('dialog.fleet-manager');
      const row = [...dlg.querySelectorAll('details')].find((d) => d.querySelector('summary')?.textContent.includes('gate-relay-remote'));
      const rowText = row ? row.querySelector('.fleet-trade')?.textContent || '' : '';
      dlg.close();
      // 4. a ship with the captain takes the order at once
      send('gate-relay-local', { command: 'rendezvous', destination: X });
      const local = { stage: A.trade?.stage, to: A.trade?.order?.to, queued: queuedFor('gate-relay-local') };
      // 5. a newer command replaces the queued one
      send('gate-relay-remote', { command: 'rendezvous', destination: X });
      const replaced = queuedFor('gate-relay-remote');
      // 6. a ship that is lost drops hers
      send('gate-relay-lost', { command: 'recall', destination: home });
      const lostBefore = queuedFor('gate-relay-lost');
      C.destroyed = true;
      window.__tradeDays(1);
      const lostAfter = queuedFor('gate-relay-lost');
      // 7. meanwhile she goes about her business (a standing trade order she already had), and the
      //    queued command follows her; the captain comes to where she can be reached — the system she
      //    stands in, or the one where the leg she is flying ends — and it is acknowledged there,
      //    against her position then. (The captain standing at the system she has just left does not
      //    reach a ship in warp: COMMAND-IN-TRANSIT.)
      t.startFleetTrading('gate-relay-remote', 'any');
      let moved = null;
      for (let d = 0; d < 60 && moved === null; d++) {
        window.__tradeDays(1);
        if (Number(B.systemIndex) !== R) moved = { day: s.day, at: Number(B.systemIndex), transitTo: B.transit ? Number(B.transit.to) : null };
      }
      const followed = queuedFor('gate-relay-remote');
      const address = () => (B.transit ? Number(B.transit.to) : Number(B.systemIndex));
      const position = address();
      s.currentPlanet = position;
      for (let d = 0; d < 60 && queuedFor('gate-relay-remote').length; d++) window.__tradeDays(1);
      const acked = { queued: queuedFor('gate-relay-remote'), order: B.trade?.order || null, stage: B.trade?.stage, origin: B.trade?.origin, active: Boolean(B.trade?.active) };
      s.currentPlanet = home;
      let arrived = null;
      for (let d = 0; d < 400 && !arrived; d++) {
        window.__tradeDays(1);
        if (B.trade?.order?.arrivedDay != null) arrived = { day: s.day, at: Number(B.systemIndex) };
      }
      return { delivers: true, found: true, home, R, X, start, recall, later, rowText, local, replaced, lostBefore, lostAfter, moved, followed, position, acked, arrived };
    });
    assert.ok(r.delivers, `${r.reason}`);
    assert.ok(r.found, 'precondition: no charted system beyond relay reach two or more legs from the captain');
    assert.equal(r.start.active, false, `Start trading reached a ship at system ${r.R} with no relay link at once: the trade orders bypass the command link`);
    assert.ok(r.start.queued.length === 1 && r.start.queued[0].command === 'trade-start', `the remote Start trading was not queued: ${JSON.stringify(r.start.queued)}`);
    assert.notEqual(r.recall.stage, 'passage', `a recall reached a ship at system ${r.R} with no relay link at once`);
    assert.equal(r.recall.order, null, `the recall was written on a ship it could not reach: ${JSON.stringify(r.recall.order)}`);
    // A recall and a Start trading are different kinds of order and both wait: the recall does not
    // delete the start, and the start does not delete the recall.
    assert.ok(r.recall.queued.some((o) => o.command === 'recall') && r.recall.queued.some((o) => o.command === 'trade-start') && r.recall.queued.length === 2,
      `with no link, a Start trading and then a recall were queued and the queue holds ${JSON.stringify(r.recall.queued)}`);
    assert.ok(r.later.at === r.R && !r.later.transit && r.later.order === null && r.later.queued.length === 2,
      `three days on, with no link, she reacted anyway: ${JSON.stringify(r.later)}`);
    assert.ok(/queued/i.test(r.rowText) && /relay/i.test(r.rowText), `her row does not show the queued order: "${r.rowText.slice(0, 160)}"`);
    assert.equal(r.local.stage, 'passage', `a ship standing with the captain did not take the order at once (${r.local.stage}, queued ${JSON.stringify(r.local.queued)})`);
    assert.equal(r.local.to, r.X, `the local ship is bound for ${r.local.to}, not ${r.X}`);
    assert.ok(!r.replaced.some((o) => o.command === 'recall') && r.replaced.some((o) => o.command === 'rendezvous' && o.destination === r.X),
      `a newer rendezvous did not replace the queued recall: ${JSON.stringify(r.replaced)}`);
    assert.ok(r.replaced.some((o) => o.command === 'trade-start') && r.replaced.length === 2,
      `the newer rendezvous replaced the queued Start trading too: ${JSON.stringify(r.replaced)}`);
    assert.equal(r.lostBefore.length, 1, 'precondition: the order for the ship about to be lost was not queued');
    assert.equal(r.lostAfter.length, 0, `a ship that was lost still has an order queued for her: ${JSON.stringify(r.lostAfter)}`);
    assert.ok(r.moved, `precondition: with a standing trade order she never reached another system from ${r.R} in sixty days, so there is no later position to acknowledge against`);
    assert.ok(r.followed.length >= 1 && r.followed.every((o) => o.systemIndex === r.position),
      r.moved.transitTo != null && r.followed[0]?.systemIndex === r.moved.at
        ? `she is in warp to system ${r.position} and the queued commands are addressed to system ${r.moved.at}, the one she has left: a captain there would reach a ship in warp`
        : `she can be reached at system ${r.position} and the queued commands are still addressed to system ${r.followed[0]?.systemIndex}: they did not follow her`);
    assert.equal(r.acked.queued.length, 0, `the captain came to where she was and the order stayed queued: ${JSON.stringify(r.acked.queued)}`);
    assert.ok(r.acked.order && r.acked.order.to === r.X, `acknowledged, she is not under the order she was sent: ${JSON.stringify(r.acked.order)}`);
    assert.notEqual(r.acked.order.from, r.R, `acknowledged where she then was, the order was executed from system ${r.R} where it was given`);
    assert.ok(r.arrived && r.arrived.at === r.X, `she never arrived at ${r.X}: ${JSON.stringify(r.arrived)}`);
  });

  // COMMAND-DOMAINS — one queued slot per ship: a change of a remote trader's danger setting deleted
  // her queued recall, and a queued recall deleted a queued danger change. Commands are in domains now
  // — passage, trade-mode, trade-risk — and a newer one supersedes only an older one in its own.
  await check('COMMAND-DOMAINS a queued recall and a queued danger change coexist, and each is superseded only by its own kind', async () => {
    await fresh('play-command-domains');
    const r = await ev(() => {
      const t = testBM1, s = t.state;
      window.__tradeSetup({ learn: 24 });
      if (typeof t.orderFleetRecall !== 'function') return { delivers: false, reason: 'there is no order that brings a trader to the captain' };
      if (typeof t.sendFleetCommand !== 'function') return { delivers: false, reason: 'there is no command queue to keep a recall and a danger change apart' };
      const queuedFor = (id) => (t.campaign().orders || []).filter((o) => o.status === 'queued' && o.order === 'fleet' && o.fleetId === id).map((o) => ({ command: o.command, destination: o.destination, risk: o.risk, day: o.queuedDay }));
      const home = Number(s.currentPlanet);
      const R = [...Array(s.planets.length).keys()].find((i) => i !== home && t.isChartSystemVisible(i) && !t.isSystemRelayConnected(i) && (t.getPlottedRoute(i, home)?.systems || []).length >= 3);
      if (R == null) return { delivers: true, found: false };
      const X = [...Array(s.planets.length).keys()].find((i) => i !== home && i !== R && t.isChartSystemVisible(i) && t.getPlottedRoute(R, i));
      window.__tradeShip('gate-domains', { big: true, at: R });
      const B = s.playerFleet.find((x) => x.id === 'gate-domains');
      t.ensureFleetTradeState(B, 'cautious');
      t.sendFleetCommand('gate-domains', { command: 'recall', destination: home });
      s.day += 1;
      t.sendFleetCommand('gate-domains', { command: 'trade-risk', risk: 'risky' });
      const both = queuedFor('gate-domains');
      s.day += 1;
      t.sendFleetCommand('gate-domains', { command: 'rendezvous', destination: X });
      const after = queuedFor('gate-domains');
      const riskBefore = B.trade?.risk;
      // the captain comes to her: both are delivered, in the order they were given
      s.currentPlanet = R;
      window.__tradeDays(1);
      s.currentPlanet = home;
      const delivered = { queued: queuedFor('gate-domains'), risk: B.trade?.risk, stage: B.trade?.stage, to: B.trade?.order?.to };
      return { delivers: true, found: true, home, R, X, both, after, riskBefore, delivered };
    });
    assert.ok(r.delivers, `${r.reason}`);
    assert.ok(r.found, 'precondition: no charted system beyond relay reach two or more legs from the captain');
    assert.ok(r.both.some((o) => o.command === 'recall') && r.both.some((o) => o.command === 'trade-risk'),
      `with no link, a recall and then a danger change were queued and the queue holds ${JSON.stringify(r.both)}: ${r.both.some((o) => o.command === 'recall') ? 'the danger change was dropped' : 'changing her danger setting deleted the queued recall'}`);
    assert.ok(!r.after.some((o) => o.command === 'recall') && r.after.some((o) => o.command === 'rendezvous' && o.destination === r.X),
      `a newer rendezvous did not replace the queued recall: ${JSON.stringify(r.after)}`);
    assert.ok(r.after.some((o) => o.command === 'trade-risk' && o.risk === 'risky'),
      `the rendezvous replaced the queued danger change as well: ${JSON.stringify(r.after)}`);
    assert.equal(r.after.length, 2, `the queue holds ${r.after.length} commands, not the two domains: ${JSON.stringify(r.after)}`);
    assert.equal(r.riskBefore, 'cautious', 'precondition: the queued danger change reached her before any link did');
    assert.equal(r.delivered.queued.length, 0, `the captain came to her and commands stayed queued: ${JSON.stringify(r.delivered.queued)}`);
    assert.equal(r.delivered.risk, 'risky', `delivered, her danger setting is ${r.delivered.risk}, not the queued Risky`);
    assert.ok(r.delivered.stage === 'passage' && r.delivered.to === r.X, `delivered, she is ${r.delivered.stage} bound for ${r.delivered.to}, not on the rendezvous at ${r.X}`);
  });

  // COMMAND-OVERTAKE — a link returned and the captain gave a new order before the day's acknowledgement
  // ran; the stale queued command then fired on the next tick and overrode it.
  await check('COMMAND-OVERTAKE an order given the moment a link returns is not overridden by the stale one still queued', async () => {
    await fresh('play-command-overtake');
    const r = await ev(() => {
      const t = testBM1, s = t.state;
      window.__tradeSetup({ learn: 24 });
      if (typeof t.orderFleetRecall !== 'function') return { delivers: false, reason: 'there is no order that brings a trader to the captain' };
      if (typeof t.sendFleetCommand !== 'function') return { delivers: false, reason: 'there is no command queue for a stale order to fire from' };
      const queuedFor = (id) => (t.campaign().orders || []).filter((o) => o.status === 'queued' && o.order === 'fleet' && o.fleetId === id).map((o) => ({ command: o.command, destination: o.destination, day: o.queuedDay }));
      const home = Number(s.currentPlanet);
      const R = [...Array(s.planets.length).keys()].find((i) => i !== home && t.isChartSystemVisible(i) && !t.isSystemRelayConnected(i) && (t.getPlottedRoute(i, home)?.systems || []).length >= 3);
      if (R == null) return { delivers: true, found: false };
      const X = [...Array(s.planets.length).keys()].find((i) => i !== home && i !== R && t.isChartSystemVisible(i) && (t.getPlottedRoute(R, i)?.systems || []).length >= 3);
      if (X == null) return { delivers: true, found: false };
      window.__tradeShip('gate-overtake', { big: true, at: R });
      const B = s.playerFleet.find((x) => x.id === 'gate-overtake');
      t.sendFleetCommand('gate-overtake', { command: 'recall', destination: home });
      const queued = queuedFor('gate-overtake');
      // the link returns — the captain arrives — and gives a new order before the day turns
      s.currentPlanet = R;
      const sent = t.sendFleetCommand('gate-overtake', { command: 'rendezvous', destination: X });
      const immediate = { stage: B.trade?.stage, to: B.trade?.order?.to, queued: queuedFor('gate-overtake') };
      window.__tradeDays(1);
      const tick = { stage: B.trade?.stage, to: B.trade?.order?.to, pending: Boolean(B.trade?.order?.pending), queued: queuedFor('gate-overtake') };
      // and where she ends up
      s.currentPlanet = home;
      let arrived = null;
      for (let d = 0; d < 400 && !arrived; d++) { window.__tradeDays(1); if (B.trade?.order?.arrivedDay != null) arrived = { day: s.day, at: Number(B.systemIndex) }; }
      return { delivers: true, found: true, home, R, X, queued, sent, immediate, tick, arrived };
    });
    assert.ok(r.delivers, `${r.reason}`);
    assert.ok(r.found, 'precondition: no pair of systems beyond relay reach far enough apart');
    assert.ok(r.queued.length === 1 && r.queued[0].command === 'recall', `precondition: the recall was not queued: ${JSON.stringify(r.queued)}`);
    assert.ok(r.sent && r.immediate.stage === 'passage' && r.immediate.to === r.X, `with the captain there, the rendezvous did not take effect at once: ${JSON.stringify(r.immediate)}`);
    assert.equal(r.immediate.queued.length, 0, `the rendezvous was given and the stale recall is still queued behind it: ${JSON.stringify(r.immediate.queued)}`);
    assert.ok(r.tick.to === r.X && !r.tick.pending, `the stale recall fired on the next tick and overrode the rendezvous: she is now under ${JSON.stringify(r.tick)}`);
    assert.ok(r.arrived && r.arrived.at === r.X, `she ended at ${r.arrived?.at}, not the rendezvous at ${r.X}`);
  });

  // COMMAND-CROSS-DOMAIN — Stop trading turned any stage but outbound into holding, so a Stop delivered
  // after a recall left the passage's transit and order alive under a stage that never flew the next
  // leg. Stop controls autonomous trading only; a passage under way, pending or unresolved is kept.
  await check('COMMAND-CROSS-DOMAIN a recall and a Stop trading delivered together leave the passage whole, in either order', async () => {
    await fresh('play-command-cross');
    const r = await ev(() => {
      const t = testBM1, s = t.state;
      window.__tradeSetup({ learn: 24 });
      if (typeof t.orderFleetRecall !== 'function') return { delivers: false, reason: 'there is no order that brings a trader to the captain' };
      if (typeof t.sendFleetCommand !== 'function') return { delivers: false, reason: 'there is no command queue for a recall and a Stop trading to wait in' };
      const queuedFor = (id) => (t.campaign().orders || []).filter((o) => o.status === 'queued' && o.order === 'fleet' && o.fleetId === id).map((o) => o.command);
      const home = Number(s.currentPlanet);
      const R = [...Array(s.planets.length).keys()].find((i) => i !== home && t.isChartSystemVisible(i) && !t.isSystemRelayConnected(i) && (t.getPlottedRoute(i, home)?.systems || []).length >= 3);
      if (R == null) return { delivers: true, found: false };
      // One run for each order of delivery: the recall first, then the stop; and the stop first.
      const run = (id, first, second) => {
        window.__tradeShip(id, { big: true, at: R });
        const B = s.playerFleet.find((x) => x.id === id);
        // a standing trade order she already has, so Stop trading has something to stop
        t.startFleetTrading(id, 'any');
        const trading = Boolean(B.trade?.active);
        t.sendFleetCommand(id, first);
        s.day += 1;
        t.sendFleetCommand(id, second);
        const queued = queuedFor(id);
        // the captain comes to where she is: both are delivered, in the order given
        s.currentPlanet = Number(B.systemIndex);
        window.__tradeDays(1);
        s.currentPlanet = home;
        const delivered = { queued: queuedFor(id), active: Boolean(B.trade?.active), stage: B.trade?.stage, order: B.trade?.order ? { kind: B.trade.order.kind, to: B.trade.order.to, pending: B.trade.order.pending } : null,
          transit: B.transit ? { ...B.transit } : null, eta: B.trade?.etaDay, line: t.fleetTradeStatusLine(B) };
        let arrived = null;
        for (let d = 0; d < 400 && !arrived; d++) { window.__tradeDays(1); if (B.trade?.order?.arrivedDay != null) arrived = { day: s.day, at: Number(B.systemIndex), active: Boolean(B.trade?.active), stage: B.trade?.stage }; }
        return { trading, queued, delivered, arrived };
      };
      const recallThenStop = run('gate-cross-1', { command: 'recall', destination: home }, { command: 'trade-stop' });
      const stopThenRecall = run('gate-cross-2', { command: 'trade-stop' }, { command: 'recall', destination: home });
      return { delivers: true, found: true, home, R, recallThenStop, stopThenRecall };
    });
    assert.ok(r.delivers, `${r.reason}`);
    assert.ok(r.found, 'precondition: no charted system beyond relay reach two or more legs from the captain');
    for (const [name, x] of [['recall then Stop trading', r.recallThenStop], ['Stop trading then recall', r.stopThenRecall]]) {
      assert.equal(x.trading, true, `precondition (${name}): she was not trading before the orders`);
      assert.equal(x.queued.length, 2, `precondition (${name}): both commands were not queued: ${JSON.stringify(x.queued)}`);
      assert.equal(x.delivered.queued.length, 0, `${name}: the captain came to her and commands stayed queued: ${JSON.stringify(x.delivered.queued)}`);
      assert.equal(x.delivered.active, false, `${name}: Stop trading was delivered and she is still trading`);
      assert.ok(x.delivered.order && x.delivered.order.kind === 'recall' && x.delivered.order.to === r.home, `${name}: the recall did not survive delivery: ${JSON.stringify(x.delivered.order)}`);
      assert.ok(x.delivered.stage === 'passage' || (x.delivered.order.pending && x.delivered.transit),
        `${name}: Stop trading turned her passage into ${x.delivered.stage} while she is still booked to ${x.delivered.transit?.to ?? 'nowhere'} under a recall (${x.delivered.line})`);
      assert.ok(x.arrived && x.arrived.at === r.home, `${name}: she never arrived at ${r.home}: ${JSON.stringify(x.arrived)}`);
      assert.equal(x.arrived.active, false, `${name}: arrival put her back to trading`);
    }
  });

  // COMMAND-DISABLED-RECEIPT — a queued recall that finally reached a disabled ship was refused and
  // lost. An order received by a ship that cannot fly is hers, unresolved, and resumes after repair
  // under the rule that already governs an order she was stopped in the middle of.
  await check('COMMAND-DISABLED-RECEIPT a recall that reaches a disabled ship is received and unresolved, and flies after repair', async () => {
    await fresh('play-command-disabled');
    const r = await ev(() => {
      const t = testBM1, s = t.state;
      window.__tradeSetup({ learn: 24 });
      if (typeof t.orderFleetRecall !== 'function') return { delivers: false, reason: 'there is no order that brings a trader to the captain' };
      if (typeof t.sendFleetCommand !== 'function') return { delivers: false, reason: 'there is no command queue for a recall to wait in' };
      const queuedFor = (id) => (t.campaign().orders || []).filter((o) => o.status === 'queued' && o.order === 'fleet' && o.fleetId === id).map((o) => o.command);
      const home = Number(s.currentPlanet);
      const R = [...Array(s.planets.length).keys()].find((i) => i !== home && t.isChartSystemVisible(i) && !t.isSystemRelayConnected(i) && (t.getPlottedRoute(i, home)?.systems || []).length >= 3);
      if (R == null) return { delivers: true, found: false };
      window.__tradeShip('gate-disabled', { big: true, at: R });
      const B = s.playerFleet.find((x) => x.id === 'gate-disabled');
      t.ensureFleetTradeState(B, 'cautious');
      t.sendFleetCommand('gate-disabled', { command: 'recall', destination: home });
      const queued = queuedFor('gate-disabled');
      // she is disabled before any link reaches her
      const v = t.ensureFleetVesselSnapshot(B);
      v.hull = Math.max(1, Math.round(t.Fleet.disableThreshold(v.maxHull) * 0.5)); v.condition = 'disabled';
      const actor = t.fleetLocalActor(B.id); if (actor) { actor.combatHull = v.hull; actor.condition = 'disabled'; }
      window.__tradeDays(2);
      const stillQueued = queuedFor('gate-disabled');
      // the link returns: the captain comes to her
      s.currentPlanet = R;
      window.__tradeDays(1);
      s.currentPlanet = home;
      const received = { queued: queuedFor('gate-disabled'), order: B.trade?.order ? { kind: B.trade.order.kind, to: B.trade.order.to, pending: B.trade.order.pending } : null,
        stage: B.trade?.stage, transit: Boolean(B.transit), at: Number(B.systemIndex), line: t.fleetTradeStatusLine(B) };
      window.__tradeDays(3);
      const waiting = { at: Number(B.systemIndex), transit: Boolean(B.transit), order: B.trade?.order ? { to: B.trade.order.to, pending: B.trade.order.pending } : null };
      // repaired where she lies
      v.hull = v.maxHull; v.condition = 'operational';
      if (actor) { actor.combatHull = actor.maxCombatHull; actor.condition = 'operational'; }
      window.__tradeDays(1);
      const resumed = { stage: B.trade?.stage, origin: B.trade?.origin, to: B.trade?.order?.to, transitFrom: B.transit?.from, line: t.fleetTradeStatusLine(B) };
      let arrived = null;
      for (let d = 0; d < 400 && !arrived; d++) { window.__tradeDays(1); if (B.trade?.order?.arrivedDay != null) arrived = { day: s.day, at: Number(B.systemIndex) }; }
      return { delivers: true, found: true, home, R, queued, stillQueued, received, waiting, resumed, arrived };
    });
    assert.ok(r.delivers, `${r.reason}`);
    assert.ok(r.found, 'precondition: no charted system beyond relay reach two or more legs from the captain');
    assert.deepEqual(r.queued, ['recall'], `precondition: the recall was not queued: ${JSON.stringify(r.queued)}`);
    assert.deepEqual(r.stillQueued, ['recall'], `precondition: the recall did not wait while she lay disabled with no link: ${JSON.stringify(r.stillQueued)}`);
    assert.equal(r.received.queued.length, 0, `the link returned and the recall stayed queued: ${JSON.stringify(r.received.queued)}`);
    assert.ok(r.received.order && r.received.order.kind === 'recall' && r.received.order.to === r.home,
      `the recall reached her while she was disabled and vanished: no order on her (${r.received.line})`);
    assert.equal(r.received.order.pending, true, `received while disabled, the recall is not held as unresolved: ${JSON.stringify(r.received.order)}`);
    assert.ok(!r.received.transit && r.received.at === r.R, `disabled, she was moved anyway: ${JSON.stringify(r.received)}`);
    assert.ok(/unresolved/i.test(r.received.line), `her row does not say the recall is unresolved: "${r.received.line}"`);
    assert.ok(!r.waiting.transit && r.waiting.at === r.R && r.waiting.order && r.waiting.order.pending, `still disabled days later, the order did not wait on her: ${JSON.stringify(r.waiting)}`);
    assert.equal(r.resumed.stage, 'passage', `repaired, she is ${r.resumed.stage} rather than on her passage (${r.resumed.line})`);
    assert.equal(r.resumed.origin, r.R, `repaired, she flies from ${r.resumed.origin}, not from ${r.R} where she lay`);
    assert.ok(r.arrived && r.arrived.at === r.home, `she never arrived at ${r.home}: ${JSON.stringify(r.arrived)}`);
  });

  // ---------- §5 consolidated interaction repair ----------
  await page.evaluate(() => {
    window.__queuedFor = (id) => (testBM1.campaign().orders || []).filter((o) => o.status === 'queued' && o.order === 'fleet' && o.fleetId === id)
      .map((o) => ({ id: o.id, command: o.command, destination: o.destination ?? null, risk: o.risk ?? null, systemIndex: o.systemIndex, day: o.queuedDay }));
    // A charted system two or more legs from the captain that no relay reaches.
    window.__remoteSystem = () => {
      const t = testBM1, s = t.state, home = Number(s.currentPlanet);
      return [...Array(s.planets.length).keys()].find((i) => i !== home && t.isChartSystemVisible(i) && !t.isSystemRelayConnected(i) && (t.getPlottedRoute(i, home)?.systems || []).length >= 3) ?? null;
    };
    window.__disable = (f) => {
      const t = testBM1;
      const v = t.ensureFleetVesselSnapshot(f);
      v.hull = Math.max(1, Math.round(t.Fleet.disableThreshold(v.maxHull) * 0.5)); v.condition = 'disabled';
      const a = t.fleetLocalActor(f.id); if (a) { a.combatHull = v.hull; a.condition = 'disabled'; }
    };
    window.__repair = (f) => {
      const t = testBM1;
      const v = t.ensureFleetVesselSnapshot(f);
      v.hull = v.maxHull; v.condition = 'operational';
      const a = t.fleetLocalActor(f.id); if (a) { a.combatHull = a.maxCombatHull; a.condition = 'operational'; }
    };
    window.__untilArrived = (f, days = 400) => {
      for (let d = 0; d < days; d++) { window.__tradeDays(1); if (f.trade?.order?.arrivedDay != null) return { day: testBM1.state.day, at: Number(f.systemIndex) }; }
      return null;
    };
  });

  // COMMAND-IN-TRANSIT — command delivery addressed a ship by `fleetShipSystem`, which in warp is still
  // the system she left, so a captain who stayed behind there had instant communications with a ship
  // already in warp. In warp she is addressed to where her leg ends, which is where a mid-leg order
  // takes effect, and receives nothing until she is there.
  await check('COMMAND-IN-TRANSIT a captain left behind has no line to a ship already in warp; the order waits for her where her leg ends', async () => {
    await fresh('play-command-in-transit');
    const r = await ev(() => {
      const t = testBM1, s = t.state;
      window.__tradeSetup({ learn: 24 });
      if (typeof t.orderFleetRecall !== 'function') return { delivers: false, reason: 'there is no order that brings a trader to the captain' };
      if (typeof t.sendFleetCommand !== 'function') return { delivers: false, reason: 'there is no command delivery for a ship in warp to be out of reach of' };
      const home = Number(s.currentPlanet);
      let X = null, L1 = null, systems = null;
      for (let i = 0; i < s.planets.length && X === null; i++) {
        if (i === home || !t.isChartSystemVisible(i)) continue;
        const rt = t.getPlottedRoute(home, i);
        if (!rt || (rt.systems || []).length < 4) continue;
        const first = Number(rt.systems[1]);
        if (t.isSystemRelayConnected(first)) continue;
        X = i; L1 = first; systems = rt.systems.map(Number);
      }
      if (X === null) return { delivers: true, found: false };
      const Y = [...Array(s.planets.length).keys()].find((i) => i !== home && !systems.includes(i) && t.isChartSystemVisible(i) && t.getPlottedRoute(L1, i));
      window.__tradeShip('gate-transit', { big: true });
      const B = s.playerFleet.find((x) => x.id === 'gate-transit');
      t.ensureFleetTradeState(B, 'cautious');
      t.sendFleetCommand('gate-transit', { command: 'rendezvous', destination: X });
      const departed = { stage: B.trade?.stage, from: B.transit?.from, to: B.transit?.to, arrival: B.transit?.arrivalDay, day: s.day };
      // The captain stays at the system she has just left, and changes her orders.
      t.sendFleetCommand('gate-transit', { command: 'rendezvous', destination: Y });
      t.sendFleetCommand('gate-transit', { command: 'trade-risk', risk: 'risky' });
      const changed = { to: B.trade?.order?.to, pending: Boolean(B.trade?.order?.pending), risk: B.trade?.risk, queued: window.__queuedFor('gate-transit') };
      t.renderFleetManager(true);
      const dlg = document.querySelector('dialog.fleet-manager');
      const row = [...dlg.querySelectorAll('details')].find((d) => d.querySelector('summary')?.textContent.includes('gate-transit'));
      const rowText = row ? row.querySelector('.fleet-trade')?.textContent || '' : '';
      dlg.close();
      // The captain goes to where her leg ends and waits there. Nothing reaches her in warp.
      s.currentPlanet = L1;
      while (B.transit && s.day < departed.arrival - 1) window.__tradeDays(1);
      const lastWarpDay = { day: s.day, inWarp: Boolean(B.transit), queued: window.__queuedFor('gate-transit').length, to: B.trade?.order?.to, risk: B.trade?.risk };
      window.__tradeDays(1);
      const received = { day: s.day, at: Number(B.systemIndex), queued: window.__queuedFor('gate-transit').length, to: B.trade?.order?.to, stage: B.trade?.stage,
        origin: B.trade?.origin, risk: B.trade?.risk, recorded: s.conditionLog?.[L1]?.day ?? null };
      const arrived = window.__untilArrived(B);
      return { delivers: true, found: true, home, X, Y, L1, L1name: s.planets[L1]?.name, departed, changed, rowText, lastWarpDay, received, arrived };
    });
    assert.ok(r.delivers, `${r.reason}`);
    assert.ok(r.found, 'precondition: no destination three or more legs out whose first leg ends beyond relay reach');
    assert.ok(r.departed.stage === 'passage' && r.departed.from === r.home && r.departed.to === r.L1,
      `precondition: she did not leave for ${r.L1} on her passage: ${JSON.stringify(r.departed)}`);
    assert.ok(r.changed.to === r.X && !r.changed.pending,
      `the captain stayed at ${r.home} and changed the orders of a ship already in warp to ${r.L1} at once: she is now under ${JSON.stringify({ to: r.changed.to, pending: r.changed.pending })}`);
    assert.equal(r.changed.risk, 'cautious', `the captain at ${r.home} changed the danger setting of a ship already in warp`);
    assert.ok(r.changed.queued.length === 2 && r.changed.queued.every((o) => o.systemIndex === r.L1),
      `the orders to a ship in warp were not queued for ${r.L1}, where her leg ends: ${JSON.stringify(r.changed.queued)}`);
    assert.ok(/queued/i.test(r.rowText) && /warp/i.test(r.rowText) && r.rowText.includes(r.L1name), `her row does not say what is waiting and where: "${r.rowText.slice(0, 200)}"`);
    assert.ok(r.lastWarpDay.inWarp && r.lastWarpDay.queued === 2 && r.lastWarpDay.to === r.X && r.lastWarpDay.risk === 'cautious',
      `with the captain waiting at ${r.L1}, an order reached her in warp before she got there: ${JSON.stringify(r.lastWarpDay)}`);
    assert.equal(r.received.day, r.departed.arrival, 'precondition: the day after the last day in warp is not her arrival');
    assert.equal(r.received.queued, 0, `she arrived at ${r.L1} with the captain there and the orders stayed queued`);
    assert.ok(r.received.to === r.Y && r.received.stage === 'passage' && r.received.origin === r.L1,
      `received at ${r.L1}, the changed rendezvous was not flown from there: ${JSON.stringify(r.received)}`);
    assert.equal(r.received.risk, 'risky', 'received at the end of her leg, the danger change did not take');
    assert.equal(r.received.recorded, r.departed.arrival, `the order received on arrival skipped the crossing at ${r.L1}: nothing was recorded there that day`);
    assert.ok(r.arrived && r.arrived.at === r.Y, `she never arrived at ${r.Y}: ${JSON.stringify(r.arrived)}`);
  });

  // COMMAND-RETENTION — the order book was cut to its newest forty entries whatever their status, so a
  // recall still waiting for a link could vanish because forty newer orders were written after it.
  await check('COMMAND-RETENTION a queued recall is never evicted by newer orders; only acknowledged history is bounded', async () => {
    await fresh('play-command-retention');
    const r = await ev(() => {
      const t = testBM1, s = t.state;
      window.__tradeSetup({ learn: 24 });
      if (typeof t.orderFleetRecall !== 'function') return { delivers: false, reason: 'there is no order that brings a trader to the captain' };
      if (typeof t.sendFleetCommand !== 'function') return { delivers: false, reason: 'there is no command queue for a recall to wait in' };
      const home = Number(s.currentPlanet);
      const R = window.__remoteSystem();
      if (R === null) return { delivers: true, found: false };
      const Q = [...Array(s.planets.length).keys()].find((i) => i !== home && i !== R && t.isChartSystemVisible(i) && !t.isSystemRelayConnected(i));
      window.__tradeShip('gate-retain', { big: true, at: R });
      const B = s.playerFleet.find((x) => x.id === 'gate-retain');
      t.sendFleetCommand('gate-retain', { command: 'recall', destination: home });
      const recall = window.__queuedFor('gate-retain')[0] || null;
      const book = t.campaign();
      const cap = book.config.maxOrders;
      // Forty-five orders acknowledged at once — history — and forty-five more still waiting elsewhere.
      for (let i = 0; i < 45; i++) t.Campaign.queueDistantOrder(book, { order: 'dispatch', formationId: `gate-history-${i}`, systemIndex: home, label: `history ${i}` }, s.day, true);
      for (let i = 0; i < 45; i++) t.Campaign.queueDistantOrder(t.campaign(), { order: 'dispatch', formationId: `gate-waiting-${i}`, systemIndex: Q, label: `waiting ${i}` }, s.day, false);
      const orders = t.campaign().orders;
      const after = {
        recall: window.__queuedFor('gate-retain')[0] || null,
        waiting: orders.filter((o) => o.status === 'queued' && String(o.formationId || '').startsWith('gate-waiting-')).length,
        history: orders.filter((o) => o.status !== 'queued').length,
        total: orders.length,
      };
      // the captain comes to her
      s.currentPlanet = R;
      window.__tradeDays(1);
      s.currentPlanet = home;
      const delivered = { queued: window.__queuedFor('gate-retain').length, stage: B.trade?.stage, to: B.trade?.order?.to,
        history: t.campaign().orders.filter((o) => o.status !== 'queued').length };
      const arrived = window.__untilArrived(B);
      return { delivers: true, found: true, home, R, cap, recall, after, delivered, arrived };
    });
    assert.ok(r.delivers, `${r.reason}`);
    assert.ok(r.found, 'precondition: no charted system beyond relay reach two or more legs from the captain');
    assert.ok(r.recall && r.recall.command === 'recall', `precondition: the recall was not queued: ${JSON.stringify(r.recall)}`);
    assert.ok(r.after.recall && r.after.recall.id === r.recall.id,
      `the recall queued on day ${r.recall.day} is gone from the book after ninety newer orders (${r.after.total} entries left): a live command was evicted to make room`);
    assert.equal(r.after.waiting, 45, `${45 - r.after.waiting} of forty-five orders still waiting for a link were evicted`);
    assert.ok(r.after.history <= r.cap, `acknowledged history is ${r.after.history} entries, over its bound of ${r.cap}`);
    assert.equal(r.delivered.queued, 0, 'the captain came to her and the recall stayed queued');
    assert.ok(r.delivered.stage === 'passage' && r.delivered.to === r.home, `the retained recall was not delivered: ${JSON.stringify(r.delivered)}`);
    assert.ok(r.delivered.history <= r.cap, `acknowledged history is ${r.delivered.history} entries after the delivery, over its bound of ${r.cap}`);
    assert.ok(r.arrived && r.arrived.at === r.home, `she never arrived at ${r.home}: ${JSON.stringify(r.arrived)}`);
  });

  // PASSAGE-FORMATION-PENDING — formation dispatch refused a member on a circuit or a passage, but not
  // one whose movement order was pending and not yet flown: repaired where she lay and not yet departed,
  // she was operational and holding, and a dispatch moved her in one jump away from it.
  await check('PASSAGE-FORMATION-PENDING a formation dispatch cannot take a ship whose movement order is still unresolved', async () => {
    await fresh('play-passage-formation-pending');
    const r = await ev(() => {
      const t = testBM1, s = t.state;
      window.__tradeSetup({ learn: 24 });
      if (typeof t.orderFleetRecall !== 'function') return { delivers: false, reason: 'there is no order that brings a trader to the captain' };
      const send = typeof t.sendFleetCommand === 'function' ? (id, c) => t.sendFleetCommand(id, c) : (id, c) => t.orderFleetRendezvous(id, c.destination);
      const home = Number(s.currentPlanet);
      const Y = [...Array(s.planets.length).keys()].find((i) => i !== home && t.isChartSystemVisible(i) && (t.getPlottedRoute(home, i)?.systems || []).length >= 3);
      if (Y === undefined) return { delivers: true, found: false };
      const Z = [...Array(s.planets.length).keys()].find((i) => i !== home && i !== Y && t.isChartSystemVisible(i) && t.getPlottedRoute(home, i));
      window.__tradeShip('gate-fpend', { big: true });
      const B = s.playerFleet.find((x) => x.id === 'gate-fpend');
      t.ensureFleetTradeState(B, 'cautious');
      window.__disable(B);
      const received = send('gate-fpend', { command: 'rendezvous', destination: Y });
      window.__repair(B);
      const window_ = { condition: B.vessel?.condition, stage: B.trade?.stage, order: B.trade?.order ? { to: B.trade.order.to, pending: B.trade.order.pending, arrivedDay: B.trade.order.arrivedDay } : null, transit: Boolean(B.transit) };
      const g = t.fleetBook().formations.find((x) => x.members.includes(B.id));
      g.destination = Z;
      const dispatched = t.dispatchFleetFormation(g.id);
      const after = { transit: B.transit ? { ...B.transit } : null, assignment: B.assignment, to: B.trade?.order?.to, pending: Boolean(B.trade?.order?.pending) };
      window.__tradeDays(1);
      const departed = { stage: B.trade?.stage, from: B.transit?.from, to: B.trade?.order?.to };
      const arrived = window.__untilArrived(B);
      return { delivers: true, found: true, home, Y, Z, received, window_, dispatched, after, departed, arrived };
    });
    assert.ok(r.delivers, `${r.reason}`);
    assert.ok(r.found, 'precondition: no destination two or more legs from the captain');
    assert.ok(r.window_.order && r.window_.order.to === r.Y && r.window_.order.pending && r.window_.order.arrivedDay == null && r.window_.stage === 'holding' && r.window_.condition === 'operational' && !r.window_.transit,
      `precondition: she is not repaired, holding, with her rendezvous pending and not yet departed: ${JSON.stringify(r.window_)}`);
    assert.equal(r.dispatched, false,
      `the formation was dispatched to ${r.Z} with a rendezvous at ${r.Y} still pending on her: she is now booked to ${r.after.transit?.to} in one jump while her own order stands`);
    assert.equal(r.after.transit, null, `the refused dispatch still moved her: ${JSON.stringify(r.after.transit)}`);
    assert.ok(r.after.to === r.Y && r.after.pending, `the refused dispatch changed her order: ${JSON.stringify(r.after)}`);
    assert.ok(r.departed.stage === 'passage' && r.departed.from === r.home && r.departed.to === r.Y, `the next day she did not leave on her own order: ${JSON.stringify(r.departed)}`);
    assert.ok(r.arrived && r.arrived.at === r.Y, `she never arrived at ${r.Y}: ${JSON.stringify(r.arrived)}`);
  });

  // COMMAND-FAILED-SUPERSESSION — a stale queued command was removed before its replacement was
  // executed, so a replacement that was refused took the older, valid command with it.
  await check('COMMAND-FAILED-SUPERSESSION a replacement that is refused leaves the older queued command authoritative, and one that stands replaces it', async () => {
    await fresh('play-command-failed-supersession');
    const r = await ev(() => {
      const t = testBM1, s = t.state;
      window.__tradeSetup({ learn: 24 });
      if (typeof t.orderFleetRecall !== 'function') return { delivers: false, reason: 'there is no order that brings a trader to the captain' };
      if (typeof t.sendFleetCommand !== 'function') return { delivers: false, reason: 'there is no command queue for a command to be superseded in' };
      const home = Number(s.currentPlanet);
      const R = window.__remoteSystem();
      if (R === null) return { delivers: true, found: false };
      const uncharted = [...Array(s.planets.length).keys()].find((i) => !t.isChartSystemVisible(i));
      if (uncharted === undefined) return { delivers: true, found: true, uncharted: false };
      window.__tradeShip('gate-failsup-1', { big: true, at: R });
      window.__tradeShip('gate-failsup-2', { big: true, at: R, seed: 7 });
      window.__tradeShip('gate-failsup-3', { big: true, at: R, seed: 8 });
      const A = s.playerFleet.find((x) => x.id === 'gate-failsup-1');
      const B = s.playerFleet.find((x) => x.id === 'gate-failsup-2');
      const C = s.playerFleet.find((x) => x.id === 'gate-failsup-3');
      // C: never traded; a Start waits for a link.
      t.sendFleetCommand('gate-failsup-3', { command: 'trade-start', risk: 'any' });
      // A: a recall waits for a link. B: trading, and a Stop waits for a link; then she is disabled.
      t.sendFleetCommand('gate-failsup-1', { command: 'recall', destination: home });
      t.startFleetTrading('gate-failsup-2', 'any');
      t.sendFleetCommand('gate-failsup-2', { command: 'trade-stop' });
      window.__disable(B);
      const before = { A: window.__queuedFor('gate-failsup-1'), B: window.__queuedFor('gate-failsup-2') };
      // The captain arrives, and before the day turns gives each a replacement that cannot stand.
      s.currentPlanet = R;
      const refusedA = t.sendFleetCommand('gate-failsup-1', { command: 'rendezvous', destination: uncharted });
      const refusedB = t.sendFleetCommand('gate-failsup-2', { command: 'trade-start', risk: 'risky' });
      // ...and to C a Stop, which stands — she is not trading — and so replaces the queued Start.
      const stoodC = t.sendFleetCommand('gate-failsup-3', { command: 'trade-stop' });
      const between = { A: window.__queuedFor('gate-failsup-1'), B: window.__queuedFor('gate-failsup-2'), C: window.__queuedFor('gate-failsup-3'), aOrder: A.trade?.order || null, bActive: Boolean(B.trade?.active) };
      window.__tradeDays(1);
      s.currentPlanet = home;
      const delivered = { A: { queued: window.__queuedFor('gate-failsup-1').length, stage: A.trade?.stage, to: A.trade?.order?.to },
        B: { queued: window.__queuedFor('gate-failsup-2').length, active: Boolean(B.trade?.active) },
        C: { queued: window.__queuedFor('gate-failsup-3').length, active: Boolean(C.trade?.active) } };
      const arrived = window.__untilArrived(A);
      return { delivers: true, found: true, uncharted: true, home, R, target: uncharted, before, refusedA, refusedB, stoodC, between, delivered, arrived };
    });
    assert.ok(r.delivers, `${r.reason}`);
    assert.ok(r.found, 'precondition: no charted system beyond relay reach two or more legs from the captain');
    assert.ok(r.uncharted, 'precondition: every system is on the chart, so there is no rendezvous that cannot stand');
    assert.ok(r.before.A.length === 1 && r.before.A[0].command === 'recall' && r.before.B.length === 1 && r.before.B[0].command === 'trade-stop',
      `precondition: the recall and the Stop were not both queued: ${JSON.stringify(r.before)}`);
    assert.equal(r.refusedA, false, `a rendezvous at uncharted system ${r.target} was accepted`);
    assert.equal(r.refusedB, false, 'a Start trading to a disabled ship was accepted');
    assert.ok(r.between.A.length === 1 && r.between.A[0].id === r.before.A[0].id,
      `the rendezvous at ${r.target} was refused and took the queued recall with it: ${JSON.stringify(r.between.A)}`);
    assert.ok(r.between.B.length === 1 && r.between.B[0].id === r.before.B[0].id,
      `the Start trading was refused and took the queued Stop with it: ${JSON.stringify(r.between.B)}`);
    assert.equal(r.between.aOrder, null, `the refused rendezvous left an order on her: ${JSON.stringify(r.between.aOrder)}`);
    assert.ok(r.stoodC && r.between.C.length === 0, `a Stop to a ship that is not trading did not stand over the Start queued for her: returned ${r.stoodC}, queue ${JSON.stringify(r.between.C)}`);
    assert.equal(r.delivered.C.active, false, 'the captain said Stop and the Start queued before it put her to work anyway');
    assert.ok(r.delivered.A.queued === 0 && r.delivered.A.stage === 'passage' && r.delivered.A.to === r.home, `the surviving recall was not delivered: ${JSON.stringify(r.delivered.A)}`);
    assert.ok(r.delivered.B.queued === 0 && r.delivered.B.active === false, `the surviving Stop was not delivered: ${JSON.stringify(r.delivered.B)}`);
    assert.ok(r.arrived && r.arrived.at === r.home, `she never arrived at ${r.home}: ${JSON.stringify(r.arrived)}`);
  });

  // COMMAND-QUEUE-SAVE — coverage: commands waiting in three domains survive a save exactly, in order,
  // and are delivered the same way after it.
  await check('COMMAND-QUEUE-SAVE commands waiting in several domains survive a save exactly and are delivered the same way', async () => {
    await fresh('play-command-queue-save');
    const r = await ev(() => {
      const t = testBM1, s = t.state;
      window.__tradeSetup({ learn: 24 });
      if (typeof t.orderFleetRecall !== 'function') return { delivers: false, reason: 'there is no order that brings a trader to the captain' };
      if (typeof t.sendFleetCommand !== 'function') return { delivers: false, reason: 'there is no command queue to save' };
      const home = Number(s.currentPlanet);
      const R = window.__remoteSystem();
      if (R === null) return { delivers: true, found: false };
      window.__tradeShip('gate-qsave', { big: true, at: R });
      t.startFleetTrading('gate-qsave', 'cautious');
      t.sendFleetCommand('gate-qsave', { command: 'recall', destination: home });
      s.day += 1;
      t.sendFleetCommand('gate-qsave', { command: 'trade-risk', risk: 'risky' });
      s.day += 1;
      t.sendFleetCommand('gate-qsave', { command: 'trade-stop' });
      const snap = () => (t.campaign().orders || []).filter((o) => o.order === 'fleet').map((o) => JSON.parse(JSON.stringify(o)));
      const before = snap();
      t.saveGame(9);
      t.startWithFaction('terran');
      const wiped = snap().length;
      t.loadGame(9);
      const after = snap();
      const B = s.playerFleet.find((x) => x.id === 'gate-qsave');
      if (!B) return { delivers: true, found: true, before, wiped, after, reloaded: false };
      const standing = { active: Boolean(B.trade?.active), risk: B.trade?.risk, order: B.trade?.order || null };
      s.currentPlanet = R;
      window.__tradeDays(1);
      s.currentPlanet = home;
      const delivered = { queued: window.__queuedFor('gate-qsave').length, stage: B.trade?.stage, to: B.trade?.order?.to, kind: B.trade?.order?.kind, risk: B.trade?.risk, active: Boolean(B.trade?.active) };
      const arrived = window.__untilArrived(B);
      return { delivers: true, found: true, reloaded: true, home, R, before, wiped, after, standing, delivered, arrived };
    });
    assert.ok(r.delivers, `${r.reason}`);
    assert.ok(r.found, 'precondition: no charted system beyond relay reach two or more legs from the captain');
    assert.deepEqual(r.before.map((o) => o.command), ['recall', 'trade-risk', 'trade-stop'], `precondition: the three commands were not queued in order: ${JSON.stringify(r.before)}`);
    assert.equal(r.wiped, 0, 'precondition: a new campaign kept the old queue');
    assert.ok(r.reloaded, 'the ship did not come back from the save');
    assert.deepEqual(r.after, r.before, 'the queue came back from the save changed');
    assert.ok(r.standing.active && r.standing.risk === 'cautious' && r.standing.order === null, `after the reload, a queued command had reached her with no link: ${JSON.stringify(r.standing)}`);
    assert.equal(r.delivered.queued, 0, 'the captain came to her and commands stayed queued');
    assert.ok(r.delivered.stage === 'passage' && r.delivered.kind === 'recall' && r.delivered.to === r.home, `after the reload the recall was not delivered: ${JSON.stringify(r.delivered)}`);
    assert.equal(r.delivered.risk, 'risky', 'after the reload the danger change was not delivered');
    assert.equal(r.delivered.active, false, 'after the reload the Stop was not delivered');
    assert.ok(r.arrived && r.arrived.at === r.home, `she never arrived at ${r.home}: ${JSON.stringify(r.arrived)}`);
  });

  console.log(`${checks - failures.length}/${checks} playtest reproductions no longer reproduce.`);
  if (failures.length) { console.log(`${failures.length} still reproduce:`); for (const f of failures) console.log(`  - ${f.name}: ${f.message.split('\n')[0]}`); process.exitCode = 1; }
  if (errors.length) { console.log(`page errors: ${errors.join(' | ')}`); process.exitCode = 1; }
  await Promise.race([probe.close(), new Promise((r) => setTimeout(r, 15000))]);
  process.exit(process.exitCode || 0);
})().catch((e) => { console.error(e); process.exit(1); });
