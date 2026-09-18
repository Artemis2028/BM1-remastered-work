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
      // A world with a people of its own, governed by them.
      const own = world.systems.findIndex((sys, i) => i !== here && sys.controller && sys.origin === sys.controller);
      if (own < 0) return { fail: 'no self-governed world to read' };
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
      const alertChips = [...stats.querySelectorAll('[data-alert-set]')].map((b) => b.dataset.alertSet);
      const powerChips = [...stats.querySelectorAll('[data-power-dist]')].map((b) => `${b.dataset.powerDist}${b.dataset.powerDir}`);
      stats.querySelector('[data-alert-set="red"]')?.click();
      const afterAlert = { alert: t.ensurePlaytestState().alertLevel, dialogs: dialogsOpen() };
      const up = stats.querySelector('[data-power-dist="weapons"][data-power-dir="1"]');
      // A control the captain cannot see is not a control they can use, whatever a query selector says.
      const upReachable = Boolean(up && up.offsetParent !== null);
      const alertReachable = [...stats.querySelectorAll('[data-alert-set]')].filter((b) => b.offsetParent !== null).length;
      const start = t.state.power?.dist?.weapons ?? 0;
      up?.click();
      const afterPower = { weapons: t.state.power?.dist?.weapons ?? 0, dialogs: dialogsOpen() };
      stats.querySelector('[data-alert-set="green"]')?.click();
      return { fail: null, before, alertChips, powerChips, afterAlert, afterPower, start, upReachable, alertReachable, engaged: t.getAlertStatus() };
    });
    await page.setViewportSize({ width: 1280, height: 800 });
    await page.waitForTimeout(150);
    assert.ok(!r.fail, String(r.fail));
    assert.deepEqual(r.alertChips, ['green', 'yellow', 'red'], `the strip offers ${r.alertChips.join(', ') || 'no'} alert settings`);
    assert.ok(r.powerChips.length >= 8, `the strip offers ${r.powerChips.length} power controls`);
    assert.equal(r.alertReachable, 3, `${r.alertReachable} of 3 alert settings can actually be reached on screen`);
    assert.equal(r.upReachable, true, 'the power control is in the markup but not on screen');
    assert.equal(r.engaged, 'red', 'precondition: the ship is under fire, which is when this matters');
    assert.equal(r.afterAlert.alert, 'red', `setting red alert from the strip left it at "${r.afterAlert.alert}"`);
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
  await check('CULT every inhabited world has a people, and they are its own', async () => {
    await fresh('play-cult2');
    const r = await ev(() => {
      const t = testBM1, s = t.state;
      if (typeof t.getSystemSovereignty !== 'function') return { fail: 'this tree reports only a controller: no world has a people it can name' };
      const rows = (s.planets || []).map((p, i) => ({ i, name: p.name, pop: Number(p.population) || 0, sov: t.getSystemSovereignty(i) }));
      const byName = (n) => rows.find((x) => x.name === n);
      return {
        total: rows.length,
        inhabitedWithoutPeople: rows.filter((x) => x.pop > 0 && !x.sov.culture).map((x) => x.name),
        emptyWithPeople: rows.filter((x) => x.pop === 0 && x.sov.cultureSource === 'local').map((x) => x.name),
        sonata: byName('Sonata')?.sov || null,
        swiss: byName('New Switzerland')?.sov || null,
        orilla: byName('Orilla')?.sov || null,
        blender: byName('Blender')?.sov || null,
        earth: byName('Earth')?.sov || null,
        distinctLocal: new Set(rows.filter((x) => x.sov.cultureSource === 'local').map((x) => x.sov.culture)).size,
        localCount: rows.filter((x) => x.sov.cultureSource === 'local').length,
      };
    });
    assert.ok(!r.fail, `the culture reproduction could not be set up: ${r.fail}`);
    assert.ok(r.total > 50, `precondition: the galaxy has ${r.total} systems`);
    assert.deepEqual(r.inhabitedWithoutPeople, [],
      `${r.inhabitedWithoutPeople.length} inhabited world(s) have no people: ${r.inhabitedWithoutPeople.slice(0, 6).join(', ')}`);
    assert.deepEqual(r.emptyWithPeople, [], `an empty world was given a people: ${r.emptyWithPeople.join(', ')}`);
    assert.equal(r.sonata.culture, 'sona', `Sonata's people are "${r.sonata.culture}" (${r.sonata.label})`);
    assert.notEqual(r.swiss.culture, r.orilla.culture,
      `New Switzerland and Orilla share one identity: ${r.swiss.culture}`);
    assert.equal(r.swiss.cultureSource, 'local', `New Switzerland resolved as ${r.swiss.cultureSource}`);
    assert.equal(r.blender.culture !== 'dominion', true,
      'Blender reads as a Dominion world because its description mentions the Dominion');
    assert.equal(r.earth.culture, 'terran', `Earth's people are "${r.earth.culture}"`);
    assert.equal(r.distinctLocal, r.localCount,
      `${r.localCount} self-governing worlds share ${r.distinctLocal} identities between them`);
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
    const widths = [1600, 1360, 1280, 1100, 1000, 820, 600];
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
            alertShown: onScreen('[data-alert-set]').length,
            alertReachable: onScreen('[data-alert-set]').filter(reachable).length,
            powerShown: onScreen('.power-chip').length,
            powerReachable: onScreen('.power-chip').filter(reachable).length,
            stepsShown: onScreen('[data-power-dist][data-power-dir]').length,
            stepsReachable: onScreen('[data-power-dist][data-power-dir]').filter(reachable).length,
            coveredBy: [...new Set(coveredBy)].slice(0, 3).join(', '),
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
      if (r.spill.length) wrong.push(`at ${at} the strip runs past its own right edge: ${r.spill.join('; ')}`);
      if (r.cut.length) wrong.push(`at ${at} a readout is cut off: ${r.cut.join('; ')}`);
      if (r.overMenu) wrong.push(`at ${at} the strip sits across the menu block`);
      if (r.overMap) wrong.push(`at ${at} the strip sits across the minimap`);
      // Alert posture is the one control that has to survive to the narrowest width the game is played
      // at: it is what a captain reaches for first, and there is no room for a dialog in a fight.
      if (r.alertShown !== 3) wrong.push(`at ${at} the strip shows ${r.alertShown} of 3 alert settings`);
      if (r.alertReachable !== r.alertShown) wrong.push(`at ${at} ${r.alertShown - r.alertReachable} of ${r.alertShown} alert settings are covered by ${r.coveredBy} and cannot be hit`);
      if (r.powerShown !== 4) wrong.push(`at ${at} the strip shows ${r.powerShown} of 4 power readouts`);
      if (r.powerReachable !== r.powerShown) wrong.push(`at ${at} ${r.powerShown - r.powerReachable} of ${r.powerShown} power readouts are covered by ${r.coveredBy}`);
      if (r.stepsShown !== 8) wrong.push(`at ${at} the strip offers ${r.stepsShown} of 8 power controls`);
      if (r.stepsReachable !== r.stepsShown) wrong.push(`at ${at} ${r.stepsShown - r.stepsReachable} of ${r.stepsShown} power controls are covered by ${r.coveredBy} and cannot be hit`);
    });
    assert.deepEqual(wrong, [], wrong.join('; '));
  });

  // POWER — the report: "power should be shown while engaging ... including on my iPad". The strip
  // dropped the power steppers at 1400px and the whole group at 1200px, so on a tablet there was
  // nothing to press; and because #stats is pointer-events:none, what was left rendered without
  // taking input at all — a control you can see, cannot hit, and which a scripted .click() reaches
  // anyway, which is why the first version of this work passed its own gate. This check opens a touch
  // context, presses the controls where they actually sit on screen, and reads the state back.
  await check('POWER alert and power take a real press on a tablet, at tablet sizes', async () => {
    const touch = await startProbe({ pageOptions: { hasTouch: true }, viewport: { width: 1180, height: 820 } });
    try {
      await touch.fresh('play-power');
      const sizes = [[1180, 820, 'tablet across'], [820, 1180, 'tablet upright']];
      const wrong = [];
      for (const [w, h, name] of sizes) {
        await touch.page.setViewportSize({ width: w, height: h });
        await touch.page.waitForTimeout(220);
        await touch.ev(() => {
          const t = testBM1;
          t.state.topLeftPanelOpen = false;
          document.getElementById('top-left-panel')?.classList.add('hidden');
          t.state.lastShieldHitAt = t.gameNow();
          t.ensurePlaytestState().alertLevel = 'green';
          t.updateStats();
        });
        await touch.page.waitForTimeout(180);

        const coarse = await touch.ev(() => matchMedia('(pointer: coarse)').matches);
        if (!coarse) { wrong.push(`${name}: the page does not report a coarse pointer, so this is not the tablet case`); continue; }

        // Sizes first: a control under the 44pt floor is one a thumb misses.
        const small = await touch.ev(() => [...document.querySelectorAll('#stats [data-alert-set], #stats [data-power-dist][data-power-dir]')]
          .filter((b) => b.offsetParent !== null)
          .map((b) => { const r = b.getBoundingClientRect(); return { n: b.dataset.alertSet || (b.dataset.powerDist + b.dataset.powerDir), w: Math.round(r.width), h: Math.round(r.height) }; })
          .filter((b) => b.w < 44 || b.h < 44));
        if (small.length) wrong.push(`${name}: ${small.length} control(s) under 44pt, smallest ${small[0].n} at ${small[0].w}x${small[0].h}`);

        // Then a real press at real coordinates, which is what a finger does and what a scripted
        // element.click() does not: it goes through hit testing and fails on a covered control.
        const redBox = await touch.ev(() => { const b = document.querySelector('#stats [data-alert-set="red"]'); if (!b || b.offsetParent === null) return null; const r = b.getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2 }; });
        if (!redBox) { wrong.push(`${name}: there is no red-alert control in the strip`); continue; }
        await touch.page.mouse.click(redBox.x, redBox.y);
        await touch.page.waitForTimeout(140);
        const alertNow = await touch.ev(() => testBM1.ensurePlaytestState().alertLevel);
        if (alertNow !== 'red') wrong.push(`${name}: pressing red alert where it sits on screen left the posture at "${alertNow}"`);

        const before = await touch.ev(() => Number(document.querySelector('#stats .power-chip u')?.textContent ?? -1));
        const upBox = await touch.ev(() => { const b = document.querySelector('#stats [data-power-dist="weapons"][data-power-dir="1"]'); if (!b || b.offsetParent === null) return null; const r = b.getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2 }; });
        if (!upBox) { wrong.push(`${name}: there is no power control in the strip`); continue; }
        const weaponsBefore = await touch.ev(() => testBM1.state.power?.dist?.weapons ?? -1);
        await touch.page.mouse.click(upBox.x, upBox.y);
        await touch.page.waitForTimeout(140);
        const weaponsAfter = await touch.ev(() => testBM1.state.power?.dist?.weapons ?? -1);
        if (!(weaponsAfter > weaponsBefore)) wrong.push(`${name}: pressing the weapons power control where it sits on screen left it at ${weaponsAfter}`);
        if (before < 0) wrong.push(`${name}: the strip shows no power level`);

        const dialogs = await touch.ev(() => [...document.querySelectorAll('dialog')].filter((d) => d.open).length);
        if (dialogs) wrong.push(`${name}: setting posture or power opened ${dialogs} dialog(s) over the fight`);
      }
      assert.deepEqual(wrong, [], wrong.join('; '));
    } finally {
      await Promise.race([touch.close(), new Promise((r) => setTimeout(r, 12000))]);
    }
  });

  console.log(`${checks - failures.length}/${checks} playtest reproductions no longer reproduce.`);
  if (failures.length) { console.log(`${failures.length} still reproduce:`); for (const f of failures) console.log(`  - ${f.name}: ${f.message.split('\n')[0]}`); process.exitCode = 1; }
  if (errors.length) { console.log(`page errors: ${errors.join(' | ')}`); process.exitCode = 1; }
  await Promise.race([probe.close(), new Promise((r) => setTimeout(r, 15000))]);
  process.exit(process.exitCode || 0);
})().catch((e) => { console.error(e); process.exit(1); });
