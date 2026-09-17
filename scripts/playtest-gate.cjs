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

  console.log(`${checks - failures.length}/${checks} playtest reproductions no longer reproduce.`);
  if (failures.length) { console.log(`${failures.length} still reproduce:`); for (const f of failures) console.log(`  - ${f.name}: ${f.message.split('\n')[0]}`); process.exitCode = 1; }
  if (errors.length) { console.log(`page errors: ${errors.join(' | ')}`); process.exitCode = 1; }
  await Promise.race([probe.close(), new Promise((r) => setTimeout(r, 15000))]);
  process.exit(process.exitCode || 0);
})().catch((e) => { console.error(e); process.exit(1); });
