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
    // docs/playtest/FOREIGN-STOCK-PROPOSAL; an entry appearing here without that decision trips this.
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
    assert.ok(r.staleRead.some((l) => /traffic gossip/.test(l) && /day 1/.test(l) && /days old/.test(l)),
      `the readout does not give the source, the day and the age: ${JSON.stringify(r.staleRead)}`);
    assert.ok(r.staleRead.some((l) => /threat no report/.test(l)),
      `the readout does not say the threat is unreported: ${JSON.stringify(r.staleRead)}`);

    // A ship on station is a reading.
    assert.equal(r.live.source, 'fleet', `a system with the captain's own ship in it reports as "${r.live.source}"`);
    assert.equal(r.live.age, 0, `a ship standing in the system reports a ${r.live.age}-day-old picture`);
    assert.equal(r.live.threat, true, 'a ship standing in the system still cannot say what is happening there');
    assert.ok(r.liveRead.some((l) => /fleet on station/.test(l) && /crews can be wrong/.test(l)),
      `the readout does not name the source or its caveat: ${JSON.stringify(r.liveRead)}`);

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
    assert.ok(r.withBoth.painted.some((x) => /unreported/.test(x) && /not safe/.test(x)),
      `the legend does not say how many charted systems are unreported, or that unreported is not safe: ${r.withBoth.painted.filter((x) => /unreported|unknown/i.test(x)).join(' | ') || 'no such row'}`);
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
        readout: t.conditionsReadout(A) };
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
    assert.ok(/as seen on day 20/.test(String(r.shown.trafficWhy)),
      `the reading does not say when it was taken: "${r.shown.trafficWhy}"`);

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

  console.log(`${checks - failures.length}/${checks} playtest reproductions no longer reproduce.`);
  if (failures.length) { console.log(`${failures.length} still reproduce:`); for (const f of failures) console.log(`  - ${f.name}: ${f.message.split('\n')[0]}`); process.exitCode = 1; }
  if (errors.length) { console.log(`page errors: ${errors.join(' | ')}`); process.exitCode = 1; }
  await Promise.race([probe.close(), new Promise((r) => setTimeout(r, 15000))]);
  process.exit(process.exitCode || 0);
})().catch((e) => { console.error(e); process.exit(1); });
