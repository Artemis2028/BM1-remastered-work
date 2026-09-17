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

  console.log(`${checks - failures.length}/${checks} playtest reproductions no longer reproduce.`);
  if (failures.length) { console.log(`${failures.length} still reproduce:`); for (const f of failures) console.log(`  - ${f.name}: ${f.message.split('\n')[0]}`); process.exitCode = 1; }
  if (errors.length) { console.log(`page errors: ${errors.join(' | ')}`); process.exitCode = 1; }
  await Promise.race([probe.close(), new Promise((r) => setTimeout(r, 15000))]);
  process.exit(process.exitCode || 0);
})().catch((e) => { console.error(e); process.exit(1); });
