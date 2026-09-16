// Adversarial in-game gate for the fa7de12 review blockers that live in the engine rather than the
// pure model: station-role bypasses, strategic damage reaching live services, the debug controls, the
// Empire panel's omniscience, report classification, the hail panel's own controls, and the campaign
// resolver actually taking the captain's stationed ships.
//
// Like the model gate, every check reproduces a reported wrong behaviour and fails on the candidate
// that has it. Nothing here asserts that a feature exists.
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

  // B10 — plans were gated on the ship-sales service, so any vendor that sold hulls also sold plans.
  await check('B10 buying a plan needs a site that issues plans, not one that merely sells hulls', async () => {
    await fresh('blk-plans');
    const r = await ev(() => {
      const t = testBM1, s = t.state;
      // A real installation somewhere in the galaxy that sells hulls and does not issue plans.
      const def = (s.stationDefinitions || []).find((d) => {
        if (s.destroyedStations?.[d.id] || d.underConstruction) return false;
        const cap = t.getStationCapabilities(d, Number(d.systemIndex));
        return cap && cap.status === 'operational' && cap.services.shipSales !== 'none' && cap.services.plans === false;
      });
      if (!def) return { skipped: true };
      const sys = Number(def.systemIndex);
      s.currentPlanet = sys; s.myplanet = sys + 1; t.applySystemState(sys);
      t.markSystemVisited(sys);
      s.docked = true; s.dockedStationId = def.id; s.dockedPlanetIndex = sys;
      const services = t.fleetStationServices(t.getCurrentServiceStation());
      const shipId = t.getShipyardStock(t.getCurrentServiceStation())[0]?.id ?? Object.values(s.shipStatsById).find((x) => x && x.assetType === 'ship' && t.getShipPrice(x) > 0).id;
      const status = t.fleetPlanStatus(shipId);
      return { skipped: false, id: def.id, sells: services.sell, plans: services.plans, reason: String(status.reason || '') };
    });
    if (r.skipped) return;
    assert.equal(r.sells, true, 'precondition: the site sells hulls');
    assert.equal(r.plans, false, 'precondition: the site does not issue plans');
    assert.match(r.reason, /No ship plans here/i, `${r.id} sells hulls and issued plans anyway: ${JSON.stringify(r)}`);
  });

  // B10 — heavy hulls were laid down in standard slips because nothing compared mass to the berth.
  await check('B10 a heavy hull cannot be laid down in a standard slip', async () => {
    await fresh('blk-heavy');
    const r = await ev(() => {
      const t = testBM1, s = t.state;
      const heavyMass = t.campaignBook().config.heavyMass;
      // A real site whose role builds hulls but has no heavy berth, made the captain's own.
      const def = (s.stationDefinitions || []).find((d) => {
        if (s.destroyedStations?.[d.id] || d.underConstruction) return false;
        const cap = t.getStationCapabilities(d, Number(d.systemIndex));
        return cap && cap.status === 'operational' && cap.services.construction === 'standard';
      });
      if (!def) return { skipped: true };
      const sys = Number(def.systemIndex);
      s.currentPlanet = sys; s.myplanet = sys + 1; t.applySystemState(sys); t.markSystemVisited(sys);
      s.stationOwners ||= {}; s.stationOwners[def.id] = t.PLAYER_SIDE;
      s.docked = true; s.dockedStationId = def.id; s.dockedPlanetIndex = sys;
      const st = t.getCurrentServiceStation();
      const services = t.fleetStationServices(st);
      const heavy = Object.values(s.shipStatsById).find((x) => x && x.assetType === 'ship' && Number(x.mass) >= heavyMass && t.getShipPrice(x) > 0);
      const light = Object.values(s.shipStatsById).find((x) => x && x.assetType === 'ship' && Number(x.mass) < heavyMass && t.getShipPrice(x) > 0);
      if (!heavy || !light) return { skipped: true };
      const b = t.fleetBook();
      b.shipPlans.push(Number(heavy.id), Number(light.id)); b.debt = 0;
      s.latinum = 50000000; s.duranium = 1000000;
      const orders = b.orders.length;
      const heavyOrdered = t.orderFleetBuild(Number(heavy.id), false);
      const afterHeavy = b.orders.length - orders;
      const lightOrdered = t.orderFleetBuild(Number(light.id), false);
      return { skipped: false, id: def.id, construction: services.build, heavyBerth: services.heavy, heavyMass,
        mass: Number(heavy.mass), heavyOrdered, afterHeavy, lightOrdered };
    });
    if (r.skipped) return;
    assert.equal(r.construction, true, 'precondition: the site builds hulls');
    assert.equal(r.heavyBerth, false, 'precondition: the site has no heavy berth');
    assert.equal(r.heavyOrdered, false, `a mass ${r.mass} hull was accepted by a standard slip at ${r.id} (heavy threshold ${r.heavyMass})`);
    assert.equal(r.afterHeavy, 0, 'and an order for it was written into the fleet book');
    assert.equal(r.lightOrdered, true, 'while an ordinary hull must still be buildable there');
  });

  // B10 — build status looked only at ownership and wreckage, never at whether the site builds ships.
  await check('B10 owning a site does not make it a shipyard', async () => {
    await fresh('blk-buildsite');
    const r = await ev(() => {
      const t = testBM1, s = t.state;
      const def = (s.stationDefinitions || []).find((d) => {
        if (s.destroyedStations?.[d.id] || d.underConstruction) return false;
        const cap = t.getStationCapabilities(d, Number(d.systemIndex));
        return cap && cap.status === 'operational' && cap.services.construction === 'none';
      });
      if (!def) return { skipped: true };
      const sys = Number(def.systemIndex);
      s.currentPlanet = sys; s.myplanet = sys + 1; t.applySystemState(sys); t.markSystemVisited(sys);
      s.stationOwners ||= {}; s.stationOwners[def.id] = t.PLAYER_SIDE;
      const owner = t.getStationOwner(def, sys);
      const status = t.fleetBuildStationStatus(def.id, sys);
      return { skipped: false, id: def.id, owner, playerSide: t.PLAYER_SIDE, status };
    });
    if (r.skipped) return;
    assert.equal(r.owner, r.playerSide, 'precondition: the captain owns the site');
    assert.notEqual(r.status, 'owned', `${r.id} has no construction service but reported build status "${r.status}"`);
  });

  // B10 — recruiting a boarding team was ungated while training was gated.
  await check('B10 recruiting a boarding crew needs a site that recruits', async () => {
    await fresh('blk-recruit');
    const r = await ev(() => {
      const t = testBM1, s = t.state;
      const def = (s.stationDefinitions || []).find((d) => {
        if (s.destroyedStations?.[d.id] || d.underConstruction) return false;
        const cap = t.getStationCapabilities(d, Number(d.systemIndex));
        return cap && cap.status === 'operational' && cap.services.recruit === false;
      });
      if (!def) return { skipped: true };
      const sys = Number(def.systemIndex);
      s.currentPlanet = sys; s.myplanet = sys + 1; t.applySystemState(sys); t.markSystemVisited(sys);
      s.docked = true; s.dockedStationId = def.id; s.dockedPlanetIndex = sys;
      const services = t.fleetStationServices(t.getCurrentServiceStation());
      const b = t.fleetBook();
      b.team.available = false; b.boarding = null; b.debt = 0; s.latinum = 500000;
      const button = document.createElement('button');
      button.dataset.fleetAction = 'recruit';
      document.body.appendChild(button);
      button.click();
      button.remove();
      return { skipped: false, id: def.id, recruits: services.recruit, available: b.team.available, latinum: s.latinum };
    });
    if (r.skipped) return;
    assert.equal(r.recruits, false, 'precondition: this site recruits nobody');
    assert.equal(r.available, false, `a boarding crew was recruited at ${r.id}, which recruits nobody`);
    assert.equal(r.latinum, 500000, 'and the captain was charged for it');
  });

  // B10 — plan stock tiers were decided by substrings in the installation type's name.
  await check('B10 the plan catalogue follows the role, not words in the name', async () => {
    await fresh('blk-name');
    const r = await ev(() => {
      const t = testBM1, s = t.state;
      const st = (s.stations || []).find((x) => !x.destroyed && x.stationTypeId != null);
      if (!st) return { skipped: true };
      s.docked = true; s.dockedStationId = st.id; s.dockedPlanetIndex = Number(s.currentPlanet);
      const pick = (c) => ({ maxBuildCost: c.maxBuildCost, stockSize: c.stockSize, isResearch: c.isResearch, isIndustrial: c.isIndustrial, isHeavy: c.isHeavy });
      const before = pick(t.getStationPlanStockContext(st));
      const stats = t.getShipStats(st.stationTypeId);
      const originalType = stats.name, originalName = st.name;
      stats.name = 'Grand Heavy Starbase Research University Laboratory';
      st.name = stats.name;
      const after = pick(t.getStationPlanStockContext(st));
      stats.name = originalType; st.name = originalName;
      return { skipped: false, id: st.id, type: originalType, before, after };
    });
    if (r.skipped) return;
    assert.deepEqual(r.after, r.before, `renaming the "${r.type}" role changed what it sells plans for: ${JSON.stringify(r)}`);
  });

  // B10 / ST-02 — the commodity market was planet-level and reachable from any hailed installation.
  // The site that must refuse is one that does no commerce at all: a relay, a subspace communicator, a
  // defence platform. Starbases, shipyards, trade stations and bars all trade and must not be blocked.
  await check('B10 a relay is not a commodity market, and a starbase still is', async () => {
    await fresh('blk-market');
    const r = await ev(() => {
      const t = testBM1, s = t.state;
      const commerce = (def) => { const cap = t.getStationCapabilities(def, Number(def.systemIndex)); if (!cap) return null; const x = cap.services; return { cap, trades: Boolean(x.commodities || x.passengers || x.rumors || x.weaponSales || x.refit || (x.shipSales && x.shipSales !== 'none') || cap.depot || cap.weaponDepot) }; };
      const pick = (want) => (s.stationDefinitions || []).find((d) => {
        if (s.destroyedStations?.[d.id] || d.underConstruction) return false;
        const c = commerce(d);
        return c && c.cap.status === 'operational' && c.trades === want;
      });
      const quiet = pick(false), trading = pick(true);
      if (!quiet || !trading) return { skipped: true };
      const visit = (def) => {
        const sys = Number(def.systemIndex);
        s.currentPlanet = sys; s.myplanet = sys + 1; t.applySystemState(sys); t.markSystemVisited(sys);
        s.docked = true; s.dockedStationId = def.id; s.dockedPlanetIndex = sys;
        t.setCamera(s.systemPlanet.x + 90000, s.systemPlanet.y + 90000);   // well clear of the world
        const offers = t.currentMarketOffers().length;
        const cash = s.latinum; s.latinum = 100000;
        t.buyMarketGood(0);
        const spent = 100000 - s.latinum; s.latinum = cash;
        return { id: def.id, role: t.getStationCapabilities(def, sys)?.role, offers, spent };
      };
      return { skipped: false, quiet: visit(quiet), trading: visit(trading) };
    });
    if (r.skipped) return;
    assert.equal(r.quiet.offers, 0, `${r.quiet.id} (${r.quiet.role}) offered a commodity market and does no commerce at all`);
    assert.equal(r.quiet.spent, 0, 'and a purchase went through it');
    assert.ok(r.trading.offers > 0, `${r.trading.id} (${r.trading.role}) trades, but its market was blocked`);
    assert.ok(r.trading.spent > 0, 'and a purchase through it was refused');
  });

  // Verification-round finding: the no-station default for a world dock omitted keys, so services the
  // world had always offered were silently withdrawn by a missing property rather than by any rule.
  await check('DOCK a world dock still issues plans and recruits crews', async () => {
    await fresh('blk-worlddock');
    const r = await ev(() => {
      const t = testBM1, s = t.state;
      s.docked = true; s.dockedStationId = null; s.dockedPlanetIndex = Number(s.currentPlanet);
      const services = t.fleetStationServices();
      const missing = ['sell', 'refit', 'build', 'heavy', 'training', 'plans', 'weapons', 'repair', 'recruit', 'relay'].filter((k) => services[k] === undefined);
      const b = t.fleetBook();
      b.team.available = false; b.boarding = null; b.debt = 0; s.latinum = 500000;
      const button = document.createElement('button');
      button.dataset.fleetAction = 'recruit';
      document.body.appendChild(button); button.click(); button.remove();
      const shipId = t.getShipyardStock()[0]?.id;
      const plan = shipId == null ? null : String(t.fleetPlanStatus(shipId).reason || '');
      return { station: t.getCurrentServiceStation(), missing, recruited: b.team.available, shipId, plan };
    });
    assert.equal(r.station, null, 'precondition: docked at the world, not an installation');
    assert.deepEqual(r.missing, [], `the world-dock service list leaves ${r.missing.join(', ')} undefined`);
    assert.equal(r.recruited, true, 'a boarding crew could not be recruited at a world');
    if (r.shipId != null) assert.doesNotMatch(r.plan, /No ship plans here/, `a world that stocks hull ${r.shipId} refused to issue its plan`);
  });

  // B11 — strategic damage was recorded in the campaign book and never consulted by the live resolver.
  await check('B11 a facility wrecked in a strategic battle is wrecked when you dock at it', async () => {
    await fresh('blk-damage');
    const r = await ev(() => {
      const t = testBM1, s = t.state;
      const st = (s.stations || []).find((x) => !x.destroyed && t.getStationCapabilities(x)?.status === 'operational');
      if (!st) return { skipped: true };
      const before = t.getStationCapabilities(st);
      const snapshot = { status: before.status, condition: t.stationConditionFraction(st), services: JSON.stringify(before.services), defense: before.effects.defense || 0 };
      t.applyCampaignEffects([{ type: 'stationDamaged', stationId: st.id, systemIndex: Number(s.currentPlanet), fraction: 0.85, day: s.day }]);
      const after = t.getStationCapabilities(st);
      const damaged = { status: after.status, condition: t.stationConditionFraction(st), services: JSON.stringify(after.services), defense: after.effects.defense || 0 };
      delete t.campaignBook().stationDamage[st.id];
      return { skipped: false, id: st.id, snapshot, damaged };
    });
    if (r.skipped) return;
    assert.ok(r.damaged.condition < r.snapshot.condition, `campaign damage did not reach ${r.id}: condition stayed ${r.snapshot.condition}`);
    assert.ok(r.damaged.status !== r.snapshot.status || r.damaged.services !== r.snapshot.services || r.damaged.defense < r.snapshot.defense,
      'the live installation was unaffected by being wrecked in the campaign');
  });

  // B13 — the Empire panel rendered the true attacker, force, losses, timing and resolver for every
  // operation in the book, whether or not the captain could possibly know about it.
  await check('B13 the Empire panel shows operations you have observed or been told of, and no others', async () => {
    await fresh('blk-panel');
    const r = await ev(() => {
      const t = testBM1, s = t.state, book = t.campaign();
      const world = t.buildCampaignWorld(true);
      const here = Number(s.currentPlanet);
      // A battle far away, in a system the captain neither holds nor has a ship in, and about which no
      // report has been received.
      const target = world.systems.findIndex((sys, i) => i !== here && sys.controller && sys.controller !== 'player');
      const attacker = Object.keys(book.polities).find((id) => id !== 'player' && id !== world.systems[target].controller && book.polities[id].hulls.length >= 3);
      const hulls = book.polities[attacker].hulls.slice(0, 3);
      const op = t.Campaign.launchOperation(book, world, attacker, hulls, target, s.day, 1, 'assault');
      op.status = 'engaged'; op.losses = 4; op.defenderLosses = 7;
      // Remove any report the launch may have produced: this operation is genuinely unknown.
      const news = t.galaxyNewsBook();
      news.items = news.items.filter((x) => !String(x.id).includes(op.id));
      t.markSystemVisited(target);
      t.openCampaignPanel('operations');
      const html = document.getElementById('campaign-panel').innerHTML;
      t.closeCampaignPanel();
      const name = s.planets[target]?.name || '';
      return { target, attacker, opId: op.id, place: name, mentionsPlace: name ? html.includes(name) : false,
        mentionsLosses: /4 attackers/.test(html) || /4 lost/.test(html), listedNone: /No fleets on the move that you know of/.test(html) };
    });
    assert.equal(r.mentionsLosses, false, `the panel printed exact losses for a battle at ${r.place} that the captain has had no word of`);
    assert.equal(r.listedNone, true, `the panel listed an operation against ${r.place} that the captain has had no word of`);
  });

  // IM-02 — a galaxy-wide Dominion warning and a settlement between two other powers were flagged as
  // the captain's own involvement, so they escaped the background-report cap.
  await check('IM-02 galaxy news is not personal involvement', async () => {
    await fresh('blk-reports');
    const r = await ev(() => {
      const t = testBM1, s = t.state;
      const news = t.galaxyNewsBook();
      news.items = [];
      t.applyCampaignEffects([{ type: 'dominionWarning', id: 'missing-patrols', text: 'Patrols have stopped reporting on schedule.', systemIndex: null, day: s.day }], s.day);
      // A war between two powers the captain (terran) belongs to neither of.
      t.applyCampaignEffects([{ type: 'warResolved', a: 'romulan', b: 'cardassian', winner: 'romulan', reason: 'a home world fell', day: s.day }], s.day);
      const warn = news.items.find((x) => String(x.id).startsWith('dominion:'));
      const war = news.items.find((x) => String(x.id).startsWith('war-resolved:'));
      return { flag: t.getPlayerFlag(), warn: warn ? { id: warn.id, personal: t.isPersonalGalaxyReport(warn) } : null, war: war ? { id: war.id, personal: t.isPersonalGalaxyReport(war) } : null };
    });
    assert.ok(r.warn, 'the warning was recorded');
    assert.equal(r.warn.personal, false, 'a galaxy-wide warning was classed as the captain\'s own business');
    assert.ok(r.war, 'the settlement was recorded');
    assert.equal(r.war.personal, false, 'a settlement between two other powers was classed as the captain\'s own business');
  });

  // B8 in the engine — the captain's stationed ships raised a world's defence and could never be lost.
  await check('B8 ships left on station are really at risk when the world is attacked', async () => {
    await fresh('blk-fleetloss');
    const r = await ev(() => {
      const t = testBM1, s = t.state, book = t.campaign();
      const world = t.buildCampaignWorld(true);
      const here = Number(s.currentPlanet);
      const elsewhere = world.systems.findIndex((sys, i) => i !== here);
      t.transferSystemControlToPlayer(elsewhere);
      const ship = Object.values(s.shipStatsById).find((x) => x && x.assetType === 'ship' && t.getShipPrice(x) > 0);
      s.playerFleet.push({ id: 'gate-defender', shipId: Number(ship.id), name: 'Gate Defender', systemIndex: elsewhere, assignment: 'defense', destroyed: false, vessel: { hull: 400, maxHull: 400, condition: 'operational' } });
      t.syncPlayerPolity(book);
      const w2 = t.buildCampaignWorld(true);
      const attacker = Object.keys(book.polities).find((id) => id !== 'player' && book.polities[id].hulls.length >= 8);
      const strike = book.polities[attacker].hulls.slice(0, 8);
      for (const h of strike) h.systemIndex = elsewhere;
      const op = t.Campaign.launchOperation(book, w2, attacker, strike, elsewhere, s.day, 1, 'assault');
      op.status = 'engaged'; op.engagedDay = s.day;
      const before = s.playerFleet.find((f) => f.id === 'gate-defender').vessel.hull;
      let sawEffect = false;
      for (let d = 1; d <= 12; d++) {
        const effects = t.Campaign.advanceCampaignDay(book, w2, s.day + d);
        if (effects.some((e) => e.type === 'defenderLosses' && e.polityId === 'player')) sawEffect = true;
        t.applyCampaignEffects(effects, s.day + d);
      }
      const record = s.playerFleet.find((f) => f.id === 'gate-defender');
      return { elsewhere, attacker, before, after: record ? record.vessel.hull : 0, destroyed: Boolean(record?.destroyed), sawEffect };
    });
    assert.equal(r.sawEffect, true, 'the resolver never reported losses for the captain\'s stationed ships');
    assert.ok(r.after < r.before || r.destroyed, `a ship that raised the world's defence came through untouched (${r.before} -> ${r.after})`);
  });

  // Verification-round finding: a vessel instantiated in the loaded scene was still counted as a
  // strategic defender. The losses assigned to it were dropped on the way back (the live actor owns
  // that hull) and syncPlayerPolity restored it to full strength next day, so the resolver booked a
  // fresh kill every day against a ship that was never scratched.
  await check('SCENE a vessel the loaded scene owns is not killed again every day by the resolver', async () => {
    await fresh('blk-scene');
    const r = await ev(() => {
      const t = testBM1, s = t.state, book = t.campaign();
      const here = Number(s.currentPlanet);
      t.transferSystemControlToPlayer(here);
      const ship = Object.values(s.shipStatsById).find((x) => x && x.assetType === 'ship' && t.getShipPrice(x) > 0);
      s.playerFleet.push({ id: 'scene-defender', shipId: Number(ship.id), name: 'Scene Defender', systemIndex: here, assignment: 'defense', destroyed: false, vessel: { hull: 400, maxHull: 400, condition: 'operational' } });
      t.applySystemState(here);
      t.syncPlayerPolity(book);
      const live = Boolean(t.getPlayerFleetShips(here).length);
      const hull = book.polities.player.hulls.find((h) => h.id === 'pf:scene-defender');
      const world = t.buildCampaignWorld(true);
      const attacker = Object.keys(book.polities).find((id) => id !== 'player' && book.polities[id].hulls.length >= 8);
      const strike = book.polities[attacker].hulls.slice(0, 8);
      for (const h of strike) h.systemIndex = here;
      const op = t.Campaign.launchOperation(book, world, attacker, strike, here, s.day, 1, 'assault');
      op.status = 'engaged'; op.engagedDay = s.day;
      // Warping: localSystem is null, so the model no longer defers to the scene, but the scene's
      // actors are still instantiated at the origin.
      s.warp.active = true;
      const w2 = t.buildCampaignWorld(true);
      let losses = 0;
      for (let d = 1; d <= 12; d++) {
        const effects = t.Campaign.advanceCampaignDay(book, w2, s.day + d);
        losses += effects.filter((e) => e.type === 'defenderLosses' && e.polityId === 'player').reduce((n, e) => n + e.hulls.filter((x) => x.destroyed).length, 0);
        t.applyCampaignEffects(effects, s.day + d);
        t.syncPlayerPolity(book);
      }
      s.warp.active = false;
      const record = s.playerFleet.find((f) => f.id === 'scene-defender');
      return { live, sceneActor: Boolean(t.fleetLocalActor?.('scene-defender')), status: hull?.status, phantomKills: losses, stillThere: Boolean(record && !record.destroyed), statsLost: book.stats.hullsLost };
    });
    assert.equal(r.live, true, 'precondition: the vessel is on station here');
    assert.equal(r.sceneActor, true, 'precondition: the vessel is instantiated in the loaded scene');
    assert.equal(r.phantomKills, 0, `the resolver booked ${r.phantomKills} kills against a vessel it could not touch`);
    assert.equal(r.status, 'assigned', 'and it must be out of the strategic ready pool while the scene owns it');
    assert.equal(r.stillThere, true, 'and the vessel is still in the fleet, as the engine believes');
  });

  // The previous layout fix traded an overlap for unreachable controls: the panel collapsed and both
  // action buttons went with it. Bounding-box separation alone could not see that. This reproduces the
  // exact configuration the shipped screenshot came from — a barred arrival at Qonos with the
  // disabled-ship panel also up — on a short screen, and asks whether the buttons can be pressed.
  await check('HAIL the incoming-hail actions stay reachable when the column is squeezed', async () => {
    await fresh('blk-hail');
    await page.setViewportSize({ width: 390, height: 844 });
    const setup = await ev(() => {
      const t = testBM1, s = t.state;
      t.startWithFaction('terran');
      s.currentPlanet = t.getSystemIndexByName('Qonos');
      t.applySystemState(s.currentPlanet);
      t.placePlayerAtSecurityApproach();
      t.updateSecurityOrderPanel();
      s.godMode = false;
      const pool = t.getNpcCombatDurability(s.playership).hull;
      s.hull = 100 * t.Fleet.disableThreshold(pool) / pool + 1; s.shields = 0;
      t.applyPlayerDamage(100, '#fff', { combatUnits: true });
      t.updateRecoveryPanel(); t.updateSecurityOrderPanel();
      const el = document.getElementById('security-order-panel');
      const rec = document.getElementById('disabled-recovery');
      return { shown: Boolean(el && !el.classList.contains('hidden')), text: el ? el.textContent : '', recovery: Boolean(rec && !rec.classList.contains('hidden') && getComputedStyle(rec).display !== 'none') };
    });
    const r = await page.evaluate(() => {
      const el = document.getElementById('security-order-panel');
      if (!el || el.classList.contains('hidden')) return { skipped: true };
      const panel = el.getBoundingClientRect();
      const buttons = [...el.querySelectorAll('button')];
      const reachable = buttons.filter((b) => {
        const r = b.getBoundingClientRect();
        if (r.width < 8 || r.height < 8) return false;
        if (r.top < panel.top - 1 || r.bottom > panel.bottom + 1) return false;
        if (r.top < 0 || r.bottom > window.innerHeight) return false;
        const hit = document.elementFromPoint(Math.round(r.left + r.width / 2), Math.round(r.top + r.height / 2));
        return Boolean(hit && el.contains(hit));
      });
      const head = el.querySelector('.security-order-head');
      const headRect = head ? head.getBoundingClientRect() : null;
      const headVisible = Boolean(headRect && headRect.height > 4 && headRect.top >= 0 && (() => { const hit = document.elementFromPoint(Math.round(headRect.left + 8), Math.round(headRect.top + headRect.height / 2)); return Boolean(hit && el.contains(hit)); })());
      return { skipped: false, buttons: buttons.length, reachable: reachable.length, headVisible, panelHeight: Math.round(panel.height) };
    });
    await page.setViewportSize({ width: 1280, height: 800 });
    assert.equal(setup.shown, true, 'precondition: an incoming hail is on screen');
    assert.equal(setup.recovery, true, 'precondition: the disabled-ship panel is competing for the column');
    assert.match(setup.text, /Incoming hail/i);
    if (r.skipped) return;
    assert.ok(r.buttons > 0, 'the hail panel rendered no actions at all');
    assert.equal(r.reachable, r.buttons, `${r.buttons - r.reachable} of ${r.buttons} hail actions were clipped or unclickable (panel ${r.panelHeight}px)`);
    assert.equal(r.headVisible, true, 'the panel slid under the status strip, hiding who is hailing');
  });

  // ---- second-review findings ----

  // R2 — the Empire panel read observations correctly, but the effect pipeline published exact
  // strategic truth as a report for every operation at any system the captain had ever visited. The
  // panel then faithfully rendered perfect intelligence. Merely having flown through a system is not
  // a listening post.
  await check('R2 a system you once flew through is not a listening post', async () => {
    await fresh('blk-intel');
    const r = await ev(() => {
      const t = testBM1, s = t.state, book = t.campaign();
      const world = t.buildCampaignWorld(true);
      const here = Number(s.currentPlanet);
      const relayed = new Set([...t.campaignRelayCoverage()].map(Number));
      // A system the captain has visited, holds nothing in, has no ship at, and no relay link to.
      const target = world.systems.findIndex((sys, i) => i !== here && sys.controller && sys.controller !== 'player' && !relayed.has(i));
      t.markSystemVisited(target);
      // The conditions are established here rather than read back from the runtime, so this check
      // fails on the behaviour it is about and not on a missing helper.
      const owns = (s.stationDefinitions || []).some((d) => Number(d.systemIndex) === target && t.getStationOwner(d, target) === t.PLAYER_SIDE);
      const source = { visited: (s.visitedSystems || []).includes(target), controlled: t.getSystemControl(target).playerControlled, ships: t.getPlayerFleetShips(target).length, owns, relayed: relayed.has(target) };
      const attacker = Object.keys(book.polities).find((id) => id !== 'player' && id !== world.systems[target].controller && book.polities[id].hulls.length >= 6);
      const hulls = book.polities[attacker].hulls.slice(0, 6);
      const effects = [];
      const op = t.Campaign.launchOperation(book, world, attacker, hulls, target, s.day, 1, 'assault', effects);
      const news = t.galaxyNewsBook();
      news.items = []; news.pending = [];
      t.applyCampaignEffects(effects, s.day);
      const immediate = news.items.filter((x) => String(x.id).startsWith('op-launch:'));
      const pending = news.pending.filter((x) => String(x.id).startsWith('op-launch:'));
      // Deliver it when its own delay says it arrives.
      const dueDay = pending[0] ? pending[0].day : s.day;
      t.collectRegionalIntel(dueDay);
      const delivered = news.items.filter((x) => String(x.id).startsWith('op-launch:'));
      return { target, source, attacker, opId: op.id,
        immediate: immediate.length, pending: pending.length, delay: dueDay - s.day,
        deliveredText: delivered[0]?.text || '', confidence: delivered[0]?.confidence || '',
        namesCount: /\b6\s+hulls\b/.test(delivered[0]?.text || ''),
        namesTruth: (delivered[0]?.text || '').includes(t.formatFaction(attacker)) };
    });
    assert.deepEqual(r.source, { visited: true, controlled: false, ships: 0, owns: false, relayed: false },
      `precondition: visited, but no presence and no relay link — got ${JSON.stringify(r.source)}`);
    assert.equal(r.immediate, 0, 'a distant operation was reported the instant it launched');
    assert.equal(r.pending, 1, 'and it was not queued as a delayed account either');
    assert.ok(r.delay >= 1, `the account arrived with ${r.delay} days of delay`);
    assert.equal(r.namesCount, false, `a second-hand account carried the exact hull count: ${r.deliveredText}`);
    assert.match(r.confidence, /Unconfirmed/, 'and it was presented as confirmed truth');
  });

  await check('R2 presence and a relay link each give what they should', async () => {
    await fresh('blk-intel2');
    const r = await ev(() => {
      const t = testBM1, s = t.state, book = t.campaign();
      const world = t.buildCampaignWorld(true);
      const here = Number(s.currentPlanet);
      const attacker = Object.keys(book.polities).find((id) => id !== 'player' && book.polities[id].hulls.length >= 6);
      const run = (target) => {
        const hulls = book.polities[attacker].hulls.slice(0, 6);
        const effects = [];
        t.Campaign.launchOperation(book, world, attacker, hulls, target, s.day, 1, 'assault', effects);
        const news = t.galaxyNewsBook(); news.items = []; news.pending = [];
        t.applyCampaignEffects(effects, s.day);
        const immediate = news.items.filter((x) => String(x.id).startsWith('op-launch:'));
        const pending = news.pending.filter((x) => String(x.id).startsWith('op-launch:'));
        if (pending[0]) t.collectRegionalIntel(pending[0].day);
        const all = news.items.filter((x) => String(x.id).startsWith('op-launch:'));
        return { immediate: immediate.length, text: all[0]?.text || '', confidence: all[0]?.confidence || '' };
      };
      // The captain is standing in this system: first-hand.
      const direct = run(here);
      // A system covered by a relay link the captain can read.
      const relayed = [...t.campaignRelayCoverage()].map(Number).find((i) => i !== here && world.systems[i]?.controller);
      const relay = relayed == null ? null : (t.markSystemVisited(relayed), run(relayed));
      return { direct, relay, attacker };
    });
    assert.equal(r.direct.immediate, 1, 'a first-hand observation was delayed or withheld');
    assert.match(r.direct.confidence, /Confirmed local observation/);
    assert.match(r.direct.text, /about 6 hulls/, 'and it lost the detail presence should give');
    if (r.relay) {
      assert.equal(r.relay.immediate, 0, 'a relayed dispatch arrived instantly');
      assert.doesNotMatch(r.relay.text, /about 6 hulls/, 'and it carried an exact count it could not have');
      assert.match(r.relay.text, /Relay traffic/, `unexpected relay text: ${r.relay.text}`);
    }
  });

  // R7 — every Dominion hull is region-tagged, so filtering a captured culture's catalogue by the
  // retail rule granted a conqueror nothing at all.
  await check('R7 capturing a Dominion major world grants its ordinary designs', async () => {
    await fresh('blk-industry');
    const r = await ev(() => {
      const t = testBM1, s = t.state;
      const world = t.buildCampaignWorld(true);
      const dominionShips = Object.values(s.shipStatsById).filter((x) => x && x.assetType === 'ship' && t.getShipFaction(Number(x.id)) === 'dominion' && t.getShipPrice(x) > 0);
      const catalogue = world.nativeDesigns('dominion');
      const gorn = world.nativeDesigns('gorn');
      const cube = Object.values(s.shipStatsById).find((x) => x && /tactical cube/i.test(x.name || ''));
      return { active: dominionShips.filter((x) => x.rosterState === 'active').length, catalogue: catalogue.length,
        gorn: gorn.length, gornDiscovered: t.getCampaignDiscoveries().gorn,
        cubeId: cube ? Number(cube.id) : null, cubeIncluded: cube ? world.nativeDesigns(t.getShipFaction(Number(cube.id))).includes(Number(cube.id)) : false };
    });
    assert.ok(r.active > 0, 'precondition: the Dominion has active hulls');
    assert.equal(r.catalogue, r.active, `capturing Dominion industry would grant ${r.catalogue} of ${r.active} designs`);
    assert.equal(r.gornDiscovered, false, 'precondition: the Gorn discovery has not happened');
    assert.equal(r.gorn, 0, 'undiscovered Gorn material is not a recoverable catalogue');
    if (r.cubeId != null) assert.equal(r.cubeIncluded, false, 'the Tactical Cube is in a recoverable catalogue');
  });

  // R8 — strategic damage healed from every repair-capable station in the system, whoever owned it.
  await check('R8 a rival\'s repair slip does not rebuild your installation', async () => {
    await fresh('blk-repair');
    const r = await ev(() => {
      const t = testBM1, s = t.state, book = t.campaign();
      const here = Number(s.currentPlanet);
      const defs = (s.stationDefinitions || []).filter((d) => Number(d.systemIndex) === here && !s.destroyedStations?.[d.id]);
      const repairer = defs.find((d) => (t.getStationCapabilities(d, here)?.effects.repairCapacity || 0) > 0);
      const victim = defs.find((d) => d.id !== repairer?.id);
      if (!repairer || !victim) return { skipped: true };
      s.stationOwners ||= {};
      s.stationOwners[repairer.id] = 'klingon';
      s.stationOwners[victim.id] = t.PLAYER_SIDE;
      book.stationDamage[victim.id] = 0.5;
      const before = book.stationDamage[victim.id];
      t.advanceCampaign(s.day + 1);
      const foreign = book.stationDamage[victim.id];
      // Now the repair slip belongs to the same side: it should help.
      s.stationOwners[repairer.id] = t.PLAYER_SIDE;
      book.stationDamage[victim.id] = 0.5;
      t.advanceCampaign(s.day + 2);
      const own = book.stationDamage[victim.id];
      return { skipped: false, victim: victim.id, repairer: repairer.id, before, foreign, own };
    });
    if (r.skipped) return;
    assert.equal(r.foreign, r.before, `a Klingon repair slip healed a player installation (${r.before} -> ${r.foreign})`);
    assert.ok(r.own < r.before, `and the captain's own slip did not heal it either (${r.before} -> ${r.own})`);
  });

  // R9 — the phase cheats left hulls assigned to operations that no longer existed, left an invasion
  // running after the phase was wound back, and turned a non-finite advance into one day.
  await check('R9 phase cheats leave no dangling or contradictory campaign state', async () => {
    await fresh('blk-phase');
    const r = await ev(() => {
      const t = testBM1;
      t.applyDebugCommand('campaign phase invasion');
      const book = t.campaign();
      const liveBefore = book.operations.filter((o) => o.faction === 'dominion' && o.status !== 'resolved').length;
      const assignedBefore = book.polities.dominion.hulls.filter((h) => h.status === 'assigned').length;
      // Wind the phase back: the war it started must be wound back with it.
      t.applyDebugCommand('campaign phase staging');
      const afterBack = {
        phase: t.campaign().dominion.phase,
        live: book.operations.filter((o) => o.faction === 'dominion' && o.status !== 'resolved').length,
        dangling: book.polities.dominion.hulls.filter((h) => h.opId && !book.operations.some((o) => o.id === h.opId && o.status !== 'resolved')).length,
      };
      t.applyDebugCommand('campaign phase invasion');
      t.applyDebugCommand('campaign phase dormant');
      const afterDormant = {
        phase: t.campaign().dominion.phase,
        present: book.operations.filter((o) => o.faction === 'dominion' && o.status !== 'resolved').length,
        dangling: book.polities.dominion.hulls.filter((h) => h.opId && !book.operations.some((o) => o.id === h.opId && o.status !== 'resolved')).length,
        stuck: book.polities.dominion.hulls.filter((h) => h.status === 'assigned').length,
      };
      let advanceThrew = '';
      try { t.applyDebugCommand('campaign advance 1e999'); } catch (e) { advanceThrew = String(e.message || e); }
      return { liveBefore, assignedBefore, afterBack, afterDormant, advanceThrew };
    });
    assert.ok(r.liveBefore > 0, 'precondition: forcing the invasion phase launched the expedition');
    assert.equal(r.afterBack.live, 0, 'winding the phase back left the invasion running');
    assert.equal(r.afterBack.dangling, 0, 'and left hulls pointing at an operation that no longer exists');
    assert.equal(r.afterDormant.dangling, 0, 'the dormant reset left hulls pointing at deleted operations');
    assert.equal(r.afterDormant.stuck, 0, 'and left them assigned to nothing');
    assert.ok(r.advanceThrew, 'a non-finite advance was accepted and quietly became one day');
  });

  // ---- third-review findings ----

  // Which power an account names in its own words, so text and metadata can be compared as claims
  // rather than as strings. Installed once in the page and used by the tier checks below.
  await ev(() => {
    window.__namedPower = (text) => {
      const t = testBM1;
      // Every recognised power, longest label first so "Terran Officer" cannot be mistaken for
      // "Terran". state.factionStanding is not the list: standings are created lazily and a fresh
      // start holds exactly one.
      const keys = (t.intelIdentityCandidates?.() || []).slice().sort((a, b) => t.formatFaction(b).length - t.formatFaction(a).length);
      for (const key of keys) if (text.includes(t.formatFaction(key))) return key;
      return null;
    };
  });

  // I1a — every other campaign event was routed through the source model; the Dominion convoy was not.
  // It published the real identity and the exact reinforcement count, immediately, gated only on the
  // wormhole system having been visited once.
  await check('I1 a convoy at a system you do not watch is not counted for you', async () => {
    await fresh('blk-convoy');
    const r = await ev(() => {
      const t = testBM1, s = t.state;
      const world = t.buildCampaignWorld(true);
      const here = Number(s.currentPlanet);
      const relayed = new Set([...t.campaignRelayCoverage()].map(Number));
      const target = world.systems.findIndex((sys, i) => i !== here && sys.controller && sys.controller !== 'player' && !relayed.has(i));
      t.markSystemVisited(target);
      const news = t.galaxyNewsBook(); news.items = []; news.pending = [];
      t.applyCampaignEffects([{ type: 'dominionConvoy', day: s.day, systemIndex: target, hulls: 4 }], s.day);
      const immediate = news.items.filter((x) => String(x.id).startsWith('convoy:'));
      const pending = news.pending.filter((x) => String(x.id).startsWith('convoy:'));
      const due = pending[0] ? pending[0].day : s.day;
      t.collectRegionalIntel(due);
      const delivered = news.items.filter((x) => String(x.id).startsWith('convoy:'))[0];
      return { target, immediate: immediate.length, pending: pending.length, delay: due - s.day,
        text: delivered?.text || '', confidence: delivered?.confidence || '', countsHulls: /\b4\s+hulls\b/.test(delivered?.text || '') };
    });
    assert.equal(r.immediate, 0, 'a convoy at an unwatched system was reported the moment it arrived');
    assert.equal(r.pending, 1, 'and it was not queued as a delayed account either');
    assert.ok(r.delay >= 1, `the account arrived with ${r.delay} days of delay`);
    assert.equal(r.countsHulls, false, `a second-hand account counted the convoy: ${r.text}`);
    assert.match(r.confidence, /Unconfirmed/);
  });

  // I1b — relay reports printed the true attacker while filing the assessor's guess, so the sentence
  // the player read and the metadata used to classify it described different claims.
  await check('I1 what a relay report says and what it files are the same claim', async () => {
    await fresh('blk-relay');
    const r = await ev(() => {
      const t = testBM1, s = t.state;
      // Give the captain a sector relay of their own, so its neighbours are genuinely covered.
      const relayDef = (s.stationDefinitions || []).find((d) => (t.getStationCapabilities(d, Number(d.systemIndex))?.effects.relay || 0) >= 2 && !s.destroyedStations?.[d.id]);
      if (!relayDef) return { fail: 'no sector relay exists in the galaxy to give the captain' };
      s.stationOwners ||= {}; s.stationOwners[relayDef.id] = t.PLAYER_SIDE;
      const world = t.buildCampaignWorld(true);
      const covered = [...t.campaignRelayCoverage()].map(Number);
      const relaySystem = Number(relayDef.systemIndex);
      const target = covered.find((i) => i !== relaySystem && world.systems[i]?.controller && !t.getSystemControl(i).playerControlled && !t.getPlayerFleetShips(i).length);
      if (target == null) return { fail: `the captain's relay at system ${relaySystem} covered no foreign world to report on` };
      t.markSystemVisited(target);
      const holder = world.systems[target].controller;
      const attacker = Object.keys(t.campaign().polities).find((id) => id !== 'player' && id !== holder && t.campaign().polities[id].hulls.length >= 6);
      if (!attacker) return { fail: `no power with six hulls could attack ${holder}` };
      const rows = [];
      for (let n = 0; n < 40; n++) {
        const book = t.campaign();
        const hulls = book.polities[attacker].hulls.slice(0, 6);
        const effects = [];
        const op = t.Campaign.launchOperation(book, world, attacker, hulls, target, s.day, 1, 'assault', effects);
        const news = t.galaxyNewsBook(); news.items = []; news.pending = [];
        t.applyCampaignEffects(effects, s.day);
        const queued = news.pending.filter((x) => String(x.id).startsWith('op-launch:'))[0];
        if (queued) rows.push({ named: window.__namedPower(queued.text), factions: queued.factions.slice(), confidence: queued.confidence, text: queued.text });
        op.status = 'resolved';
      }
      return { target, relaySystem, attacker, rows };
    });
    // A precondition this gate cannot arrange is a failed gate, not a quiet pass: a check that reports
    // success because it never ran is worse than no check. [third review]
    assert.ok(!r.fail, `the relay reproduction could not be set up: ${r.fail}`);
    assert.ok(r.rows.length >= 20, `only ${r.rows.length} relay accounts were produced`);
    const disagree = r.rows.filter((row) => row.named && !row.factions.includes(row.named));
    assert.equal(disagree.length, 0, `${disagree.length} of ${r.rows.length} relay accounts named one power in the text and filed another`);
    assert.equal(r.rows.filter((row) => row.named !== r.attacker).length, 0, 'a relay account, which reads transponders, named the wrong power');
    assert.ok(r.rows.every((row) => /Relay/.test(row.confidence) || /Relay/.test(row.text)), 'these are not relay accounts');
  });

  // I1c — a crew on station reporting by subspace was treated as infallible, the same as the captain
  // standing there. Ships make reports better, not certain.
  await check('I1 a ship on station reports well, not perfectly', async () => {
    await fresh('blk-fleet');
    const r = await ev(() => {
      const t = testBM1, s = t.state;
      const world = t.buildCampaignWorld(true);
      const here = Number(s.currentPlanet);
      const relayed = new Set([...t.campaignRelayCoverage()].map(Number));
      const target = world.systems.findIndex((sys, i) => i !== here && sys.controller && sys.controller !== 'player' && !relayed.has(i));
      t.markSystemVisited(target);
      const ship = Object.values(s.shipStatsById).find((x) => x && x.assetType === 'ship' && t.getShipPrice(x) > 0);
      s.playerFleet.push({ id: 'watcher', shipId: Number(ship.id), name: 'Watcher', systemIndex: target, assignment: 'defense', destroyed: false, vessel: { hull: 400, maxHull: 400, condition: 'operational' } });
      const holder = world.systems[target].controller;
      const attacker = Object.keys(t.campaign().polities).find((id) => id !== 'player' && id !== holder && t.campaign().polities[id].hulls.length >= 6);
      const rows = []; const immediates = [];
      for (let n = 0; n < 40; n++) {
        const book = t.campaign();
        const hulls = book.polities[attacker].hulls.slice(0, 6);
        const effects = [];
        const op = t.Campaign.launchOperation(book, world, attacker, hulls, target, s.day, 1, 'assault', effects);
        const news = t.galaxyNewsBook(); news.items = []; news.pending = [];
        t.applyCampaignEffects(effects, s.day);
        const immediate = news.items.filter((x) => String(x.id).startsWith('op-launch:')).length;
        const queued = news.pending.filter((x) => String(x.id).startsWith('op-launch:'))[0];
        immediates.push(immediate);
        if (queued) rows.push({ immediate, named: window.__namedPower(queued.text), factions: queued.factions.slice(), confidence: queued.confidence, text: queued.text });
        op.status = 'resolved';
      }
      return { target, holder, attacker, rows, immediates };
    });
    assert.equal(r.immediates.filter((n) => n > 0).length, 0, 'a remote crew reported instantly, as if the captain were standing there');
    assert.ok(r.rows.length >= 20, `only ${r.rows.length} fleet accounts were queued`);
    assert.equal(r.rows.filter((row) => /about 6 hulls/.test(row.text)).length, 0, 'and with an exact count');
    const wrong = r.rows.filter((row) => row.named !== r.attacker);
    assert.ok(wrong.length > 0, `a remote crew named the right power in all ${r.rows.length} accounts — this tier is infallible`);
    assert.ok(wrong.length < r.rows.length / 2, `a remote crew was wrong ${wrong.length} times in ${r.rows.length} — a ship on station should be better than hearsay`);
    const disagree = r.rows.filter((row) => row.named && !row.factions.includes(row.named));
    assert.equal(disagree.length, 0, `${disagree.length} fleet accounts named one power in the text and filed another`);
  });

  // I1d — the delayed branch threw away who the event happened to, so a world the captain had just
  // lost, or an attack on the faction whose colours they fly, could fall into the six background slots.
  await check('I1 losing a world, and an attack on your own colours, stay your business', async () => {
    await fresh('blk-personal');
    const r = await ev(() => {
      const t = testBM1, s = t.state;
      const world = t.buildCampaignWorld(true);
      const here = Number(s.currentPlanet);
      const relayed = new Set([...t.campaignRelayCoverage()].map(Number));
      const flag = t.getPlayerFlag();
      const news = t.galaxyNewsBook();

      // A world the captain holds, far away and unwatched, taken from them.
      const mine = world.systems.findIndex((sys, i) => i !== here && !relayed.has(i));
      t.transferSystemControlToPlayer(mine);
      t.markSystemVisited(mine);
      const w2 = t.buildCampaignWorld(true);
      const taker = Object.keys(t.campaign().polities).find((id) => id !== 'player');
      news.items = []; news.pending = [];
      t.applyCampaignEffects([{ type: 'captureSystem', systemIndex: mine, by: taker, from: 'player', opId: 'lost-world', day: s.day }], s.day);
      const lost = [...news.items, ...news.pending].filter((x) => String(x.id).startsWith('capture:'))[0];

      // An attack on a world held by the faction whose colours the captain flies.
      const theirs = w2.systems.findIndex((sys, i) => i !== here && i !== mine && !relayed.has(i) && t.campaignFactionKeyFor?.(sys.controller) === flag);
      let ally = null;
      if (theirs >= 0) {
        t.markSystemVisited(theirs);
        const attacker = Object.keys(t.campaign().polities).find((id) => id !== 'player' && t.campaign().polities[id].hulls.length >= 6);
        const hulls = t.campaign().polities[attacker].hulls.slice(0, 6);
        const effects = [];
        t.Campaign.launchOperation(t.campaign(), w2, attacker, hulls, theirs, s.day, 1, 'assault', effects);
        news.items = []; news.pending = [];
        t.applyCampaignEffects(effects, s.day);
        const queued = [...news.items, ...news.pending].filter((x) => String(x.id).startsWith('op-launch:'))[0];
        ally = queued ? { flagged: queued.playerRelated === true, personal: t.isPersonalGalaxyReport(queued), factions: queued.factions.slice(), holder: t.campaignFactionKeyFor(w2.systems[theirs].controller) } : null;
      }
      return { flag, mine, taker, lost: lost ? { flagged: lost.playerRelated === true, personal: t.isPersonalGalaxyReport(lost), factions: lost.factions.slice() } : null, theirs, ally };
    });
    assert.ok(r.lost, 'no report was produced for a world the captain lost');
    assert.equal(r.lost.flagged, true, `the report for a world the captain lost was not flagged as theirs: ${JSON.stringify(r.lost)}`);
    assert.equal(r.lost.personal, true, `and it counts against the six background slots: ${JSON.stringify(r.lost)}`);
    assert.ok(r.theirs >= 0 && r.ally, `no unwatched ${r.flag} world was available to attack`);
    assert.equal(r.ally.holder, r.flag, 'precondition: the attacked world flies the captain\'s colours');
    assert.equal(r.ally.flagged, true, `an attack on ${r.flag} colours was not flagged as the captain's business: ${JSON.stringify(r.ally)}`);
    assert.ok(r.ally.factions.includes(r.flag), `and the harmed power was not even recorded: ${JSON.stringify(r.ally)}`);
  });

  // I1e — the Other Powers table fuzzed strength but copied the live world count, so a conquest the
  // captain could not have seen corrected their books on the next refresh.
  await check('I1 an unobserved conquest does not correct the Other Powers table', async () => {
    await fresh('blk-powers');
    const r = await ev(() => {
      const t = testBM1, s = t.state, book = t.campaign();
      const world = t.buildCampaignWorld(true);
      const unseen = world.systems.findIndex((sys, i) => sys.controller && sys.controller !== 'player' && !t.isChartSystemVisible(i) && !(s.visitedSystems || []).includes(i));
      if (unseen < 0) return { fail: 'every controlled world was already charted, so nothing could be taken unobserved' };
      const holder = world.systems[unseen].controller;
      const taker = Object.keys(book.polities).find((id) => id !== 'player' && id !== holder);
      const read = () => { book.assessments = {}; const a = t.campaignAssessment(taker); return a.estimate.worlds; };
      const before = read();
      t.transferSystemControlToFaction(unseen, taker);
      t.buildCampaignWorld(true);
      const after = read();
      return { unseen, holder, taker, before, after };
    });
    assert.ok(!r.fail, `the unobserved-conquest reproduction could not be set up: ${r.fail}`);
    assert.equal(r.after, r.before, `an unobserved conquest moved ${r.taker}'s displayed holdings from ${r.before} to ${r.after}`);
  });

  // I2 — separating retail from industry was right for the Dominion's regional hulls, but the new
  // predicate also unlocked the designs that exist at one authored place under one named vendor.
  await check('I2 captured industry does not unlock secret or named-vendor designs', async () => {
    await fresh('blk-secret');
    const r = await ev(() => {
      const t = testBM1, s = t.state;
      const world = t.buildCampaignWorld(true);
      const named = (id) => s.shipStatsById[id]?.name || String(id);
      const catalogue = (faction) => world.nativeDesigns(faction);
      const dominionActive = Object.values(s.shipStatsById).filter((x) => x && x.assetType === 'ship' && t.getShipFaction(Number(x.id)) === 'dominion' && t.getShipPrice(x) > 0 && x.rosterState === 'active').length;
      return {
        terran: catalogue('terran'), romulan: catalogue('romulan'), neutral: catalogue('neutral'),
        dominion: catalogue('dominion').length, dominionActive,
        names: { 49: named(49), 347: named(347), 53: named(53), 60: named(60) },
      };
    });
    assert.equal(r.terran.includes(49), false, `capturing a Terran world granted the Paso-only ${r.names[49]}`);
    assert.equal(r.terran.includes(347), false, `capturing a Terran world granted the Paso-only ${r.names[347]}`);
    assert.equal(r.romulan.includes(53), false, `capturing a Romulan world granted the Remus-secret ${r.names[53]}`);
    assert.equal(r.neutral.includes(60), false, `capturing an independent world granted the endgame-vendor ${r.names[60]}`);
    assert.equal(r.dominion, r.dominionActive, `and the Dominion's ordinary designs were lost again: ${r.dominion} of ${r.dominionActive}`);
    assert.ok(r.terran.length > 0, 'a Terran capture should still grant ordinary Terran designs');
  });

  // Third-review follow-up: a settlement that ends a battle already fought was reported as a
  // withdrawal "without a fight", contradicting the history entry beside it.
  await check('I3 a peace that ends a battle already fought is not called bloodless', async () => {
    await fresh('blk-peacewording');
    const r = await ev(() => {
      const t = testBM1, s = t.state;
      const here = Number(s.currentPlanet);
      const news = t.galaxyNewsBook(); news.items = []; news.pending = [];
      const say = (losses, defenderLosses) => {
        news.items = []; news.pending = [];
        t.applyCampaignEffects([{ type: 'operationResolved', opId: `pw:${losses}:${defenderLosses}`, faction: 'klingon', targetSystem: here,
          outcome: 'stood-down', losses, defenderLosses, day: s.day, resolvedBy: 'diplomacy' }], s.day);
        return ([...news.items, ...news.pending].filter((x) => String(x.id).startsWith('op-done:'))[0] || {}).text || '';
      };
      return { bloodless: say(0, 0), fought: say(3, 2) };
    });
    assert.match(r.bloodless, /without a fight/, 'a stand-down before contact should say so');
    assert.doesNotMatch(r.fought, /without a fight/, `a stand-down after losses was reported as bloodless: ${r.fought}`);
    assert.match(r.fought, /broke off/, `and did not say what happened instead: ${r.fought}`);
  });

  // ---- fourth-review findings ----

  // A foreign world outside every live source the captain has: not where they stand, no ship of theirs
  // on station, no relay link, no installation of their own. Installed once and used by the readers
  // below, so "unwatched" means the same thing in each of them.
  await page.evaluate(() => {
    window.__unwatchedWorld = () => {
      const t = testBM1, s = t.state;
      const world = t.buildCampaignWorld(true);
      const here = Number(s.currentPlanet);
      const relayed = new Set([...t.campaignRelayCoverage()].map(Number));
      return world.systems.findIndex((sys, i) => i !== here && !relayed.has(i) && sys.controller && sys.controller !== 'player'
        && !t.getPlayerFleetShips(i).length
        && !(s.stationDefinitions || []).some((d) => Number(d.systemIndex) === i && t.getStationOwner(d, i) === t.PLAYER_SIDE && window.__liveStation(d, i)));
    };
    window.__watcher = (index) => {
      const t = testBM1, s = t.state;
      const ship = Object.values(s.shipStatsById).find((x) => x && x.assetType === 'ship' && t.getShipPrice(x) > 0);
      s.playerFleet.push({ id: `watcher-${index}`, shipId: Number(ship.id), name: 'Watcher', systemIndex: index, assignment: 'defense',
        destroyed: false, vessel: { hull: 400, maxHull: 400, condition: 'operational' } });
      return `watcher-${index}`;
    };
    window.__panelHtml = (tab) => { testBM1.openCampaignPanel(tab); const html = document.getElementById('campaign-panel').innerHTML; testBM1.closeCampaignPanel(); return html; };
    // The gate works out the captain's best source at a system for itself, from primitives every tree
    // has, rather than asking the runtime for the judgement under test. A tree without the four-tier
    // model at all must still fail these checks on what its panel does, not on a missing symbol.
    // An installation is a listening post only while it is standing. The gate decides that for itself
    // from the resolved capability, so a tree that grants coverage from ownership alone fails here
    // rather than agreeing with itself. [ninth review]
    window.__liveStation = (def, index) => {
      const t = testBM1, s = t.state;
      if (s.destroyedStations?.[def.id] || def.destroyed || def.underConstruction) return false;
      const cap = t.getStationCapabilities(def, Number(index));
      return Boolean(cap) && ['operational', 'damaged', 'unstaffed'].includes(cap.status);
    };
    window.__sourceOf = (index) => {
      const t = testBM1, s = t.state, i = Number(index);
      if (!s.warp.active && Number(s.currentPlanet) === i) return 'local';
      if (t.getPlayerFleetShips(i).length) return 'fleet';
      const owns = (s.controlledSystems || []).includes(i)
        || (s.stationDefinitions || []).some((d) => Number(d.systemIndex) === i && t.getStationOwner(d, i) === t.PLAYER_SIDE && window.__liveStation(d, i));
      if (owns || [...t.campaignRelayCoverage()].map(Number).includes(i)) return 'relay';
      return 'rumour';
    };
    // What the panel's reader makes of an operation. A tree with no reader renders every operation from
    // the campaign record, which is what 'direct' means, so that is the honest answer for it.
    window.__knows = (op) => (typeof testBM1.campaignOperationKnowledge === 'function' ? testBM1.campaignOperationKnowledge(op) : { level: 'direct', reports: [] });
    // What the runtime itself calls the captain's best source there, where the runtime has an opinion
    // at all. A tree with no four-tier model returns null and is judged on what its panel and its books
    // do instead.
    window.__runtimeSource = (index) => (typeof testBM1.campaignIntelSource === 'function' ? testBM1.campaignIntelSource(index) : null);
  });

  // I1R-a — "direct" was granted to a remote crew and to any installation the captain owned, so the
  // panel rendered the campaign record — true faction, exact hulls present, both sides' losses, labelled
  // "observed in your space" — for a battle nobody had yet reported.
  for (const mode of ['a ship on station', 'an installation of your own']) {
    await check(`I1R ${mode} is a source, not the captain's own eyes`, async () => {
      await fresh(`blk-eyes-${mode.startsWith('a ship') ? 'ship' : 'station'}`);
      const r = await ev((mode) => {
        const t = testBM1, s = t.state, book = t.campaign();
        const target = window.__unwatchedWorld();
        if (target < 0) return { fail: 'no foreign world outside the captain\'s coverage was available' };
        t.markSystemVisited(target);
        if (mode.startsWith('a ship')) window.__watcher(target);
        else {
          const def = (s.stationDefinitions || []).find((d) => Number(d.systemIndex) === target && !s.destroyedStations?.[d.id]);
          if (!def) return { fail: `no installation stands at system ${target} to give the captain` };
          s.stationOwners ||= {}; s.stationOwners[def.id] = t.PLAYER_SIDE;
        }
        const world = t.buildCampaignWorld(true);
        const attacker = Object.keys(book.polities).find((id) => id !== 'player' && id !== world.systems[target].controller && book.polities[id].hulls.length >= 3);
        if (!attacker) return { fail: 'no power with three hulls could attack it' };
        const news = t.galaxyNewsBook(); news.items = []; news.pending = [];
        const effects = [];
        const op = t.Campaign.launchOperation(book, world, attacker, book.polities[attacker].hulls.slice(0, 3), target, s.day, 1, 'assault', effects);
        op.status = 'engaged'; op.losses = 4; op.defenderLosses = 7;
        t.applyCampaignEffects(effects, s.day);
        const source = window.__sourceOf(target);
        const queued = news.pending.length;
        const before = window.__knows(op).level;
        const beforeHtml = window.__panelHtml('operations');
        t.collectRegionalIntel(s.day + 30);
        const after = window.__knows(op);
        const afterHtml = window.__panelHtml('operations');
        const name = s.planets[target]?.name || '';
        return { target, name, source, queued, before, afterLevel: after.level,
          beforeListedNone: /No fleets on the move that you know of/.test(beforeHtml),
          beforeExact: /hulls present|observed in your space|4 lost/.test(beforeHtml),
          afterExact: /hulls present|observed in your space|4 lost/.test(afterHtml),
          afterConfidence: /Fleet assessment|Relay dispatch/.test(afterHtml) };
      }, mode);
      assert.ok(!r.fail, `the ${mode} reproduction could not be set up: ${r.fail}`);
      assert.equal(r.source, mode.startsWith('a ship') ? 'fleet' : 'relay', `precondition: ${mode} is the captain's only source at ${r.name}`);
      // The behaviour first, then what the tree needs for the rest of it: a candidate that reports
      // everything instantly has no pending account to deliver, and must fail on what its panel did.
      assert.equal(r.beforeExact, false, `the panel printed the campaign record for a battle at ${r.name} that ${mode} had not yet reported`);
      assert.equal(r.beforeListedNone, true, `the panel listed an operation at ${r.name} that nothing had reported yet`);
      assert.equal(r.before, 'none', `${mode} rendered "${r.before}" for a battle whose account had not arrived`);
      assert.ok(r.queued >= 1, 'precondition: the source filed an account of the launch to be delivered later');
      assert.equal(r.afterLevel, 'reported', `once the account arrived the panel read it as "${r.afterLevel}" rather than as a report`);
      assert.equal(r.afterExact, false, 'and then printed exact hull counts and losses anyway');
      assert.equal(r.afterConfidence, true, 'the delivered account was not shown with the confidence it was filed under');
    });
  }

  // I1R-b — holdings were counted from live controllers for every system the captain had ever visited,
  // so a world taken years after they flew through it corrected their books without a word reaching them.
  await check('I1R a world you visited once is a memory, not a live feed', async () => {
    await fresh('blk-visited');
    const r = await ev(() => {
      const t = testBM1, s = t.state, book = t.campaign();
      const target = window.__unwatchedWorld();
      if (target < 0) return { fail: 'no foreign world outside the captain\'s coverage was available' };
      t.markSystemVisited(target);
      const holder = t.buildCampaignWorld(true).systems[target].controller;
      const taker = Object.keys(book.polities).find((id) => id !== 'player' && id !== holder);
      if (!taker) return { fail: `no other power exists to take a world from ${holder}` };
      const read = (id) => { book.assessments = {}; return t.campaignAssessment(id).estimate.worlds; };
      // The captain sees it held, once, with a ship of theirs on station — and then the ship leaves.
      const watcher = window.__watcher(target);
      t.buildCampaignWorld(true);
      const seenHolder = read(holder);
      s.playerFleet = s.playerFleet.filter((f) => f.id !== watcher);
      s.day += 1;
      const beforeTaker = read(taker);
      // Now it changes hands with nothing of the captain's anywhere near it.
      t.transferSystemControlToFaction(target, taker);
      t.buildCampaignWorld(true);
      s.day += 1;
      return { fail: null, target, holder, taker, seenHolder, beforeTaker, afterHolder: read(holder), afterTaker: read(taker), source: window.__sourceOf(target) };
    });
    assert.ok(!r.fail, `the visited-world reproduction could not be set up: ${r.fail}`);
    assert.equal(r.source, 'rumour', 'precondition: nothing of the captain\'s watches that system any more');
    assert.ok(r.seenHolder >= 1, `precondition: the captain saw ${r.holder} holding it (counted ${r.seenHolder})`);
    assert.equal(r.afterTaker, r.beforeTaker, `a conquest nobody reported moved ${r.taker}'s holdings from ${r.beforeTaker} to ${r.afterTaker}`);
    assert.equal(r.afterHolder, r.seenHolder, `and struck a world off ${r.holder}'s books (${r.seenHolder} → ${r.afterHolder}) with no word of it`);
  });

  // I2R — regional restriction was made recoverable, but the Gorn reserve was left out of the set, so
  // capturing Gorn industry granted nothing even after the authored discovery that opens Gorn space.
  await check('I2R Gorn industry is recoverable after the authored discovery, and not before', async () => {
    await fresh('blk-gorn');
    const r = await ev(() => {
      const t = testBM1, s = t.state;
      const disc = t.getCampaignDiscoveries();
      const catalogue = Object.values(s.shipStatsById).filter((x) => x && x.assetType === 'ship' && t.getShipFaction(Number(x.id)) === 'gorn'
        && t.getShipPrice(x) > 0 && x.rosterState === 'active' && x.balanceStatus !== 'pending').length;
      disc.gorn = false;
      const before = t.buildCampaignWorld(true).nativeDesigns('gorn').length;
      disc.gorn = true;
      const after = t.buildCampaignWorld(true).nativeDesigns('gorn').length;
      const sample = t.buildCampaignWorld(true).nativeDesigns('gorn').slice(0, 3).map((id) => s.shipStatsById[id]?.name);
      disc.gorn = false;
      t.buildCampaignWorld(true);
      return { catalogue, before, after, sample };
    });
    assert.ok(r.catalogue > 0, 'precondition: the Gorn build ships');
    assert.equal(r.before, 0, `${r.before} Gorn designs were recoverable before the authored discovery`);
    assert.ok(r.after > 0, `capturing Gorn industry after the discovery still grants nothing, out of ${r.catalogue} active Gorn designs`);
  });

  // I3R — damage was applied inside the strategic day while repair ran once per engine call, so a
  // jump across a battle healed a single day's worth of damage and a walk healed one per day: different
  // damage, different capabilities, different book.
  await check('I3R a jump across damage and repair produces the book that stepping produces', async () => {
    const DAYS = 6;
    const run = async (stepped) => {
      await fresh('blk-repairgap');
      return ev((args) => {
        const t = testBM1, s = t.state, book = t.campaign();
        const world = t.buildCampaignWorld(true);
        // A system holding an installation that can be hurt and, in the same hands and the same system,
        // the capacity to put it back together.
        let victim = null, repairer = null, sys = -1;
        for (let i = 0; i < world.systems.length && victim == null; i++) {
          const here = world.stationsBySystem(i);
          const rep = here.find((x) => x.cap && x.cap.status === 'operational' && (x.cap.effects.repairCapacity || 0) > 0);
          if (!rep) continue;
          const other = here.find((x) => x.id !== rep.id && x.cap && ['operational', 'damaged'].includes(x.cap.status) && (x.owner ?? null) === (rep.owner ?? null));
          if (!other) continue;
          victim = other.id; repairer = rep.id; sys = i;
        }
        if (victim == null) return { fail: 'no system holds an installation and same-owner repair capacity' };
        book.stationDamage[victim] = 0.6;
        const start = s.day;
        if (args.stepped) { for (let d = start + 1; d <= start + args.days; d++) t.advanceCampaign(d); }
        else t.advanceCampaign(start + args.days);
        const def = (s.stationDefinitions || []).find((d) => d.id === victim);
        const cap = t.getStationCapabilities(def, sys);
        return { fail: null, sys, victim, repairer, days: args.days,
          damage: Number((book.stationDamage[victim] || 0).toFixed(4)),
          condition: Number(t.stationConditionFraction(victim).toFixed(4)),
          status: cap?.status || 'gone', repairCapacity: cap?.effects.repairCapacity || 0,
          history: book.history.length, settled: book.settled, checksum: t.Campaign.checksum(book) };
      }, { stepped, days: DAYS });
    };
    const walked = await run(true);
    const jumped = await run(false);
    assert.ok(!walked.fail && !jumped.fail, `the repair-gap reproduction could not be set up: ${walked.fail || jumped.fail}`);
    assert.ok(walked.damage < 0.6, `precondition: ${walked.days} days of repair healed nothing at all (still ${walked.damage})`);
    assert.equal(jumped.damage, walked.damage,
      `a ${walked.days}-day jump left ${jumped.damage} damage on ${walked.victim} where stepping left ${walked.damage}`);
    assert.equal(jumped.condition, walked.condition, `and its live condition differs: jumped ${jumped.condition}, stepped ${walked.condition}`);
    assert.equal(jumped.status, walked.status, `and its status differs: jumped ${jumped.status}, stepped ${walked.status}`);
    assert.equal(jumped.history, walked.history, `and the strategic history differs: ${jumped.history} entries jumped, ${walked.history} stepped`);
    assert.equal(jumped.checksum, walked.checksum, `and the books differ: ${jumped.checksum} jumped, ${walked.checksum} stepped`);
  });

  // ---- fifth-review findings ----

  // What an account blames, in its own words, whatever the runtime records beside it. The gate works
  // this out for itself so it indicts a tree that has no such field at all.
  await page.evaluate(() => {
    // The power an account BLAMES, taken from the sentence itself — not the power it merely mentions,
    // and not a field the tree under test may not have. Fallible tiers name their suspect in one fixed
    // phrase, which is the only place a claim of responsibility appears in the captain's own words.
    window.__claimOf = (report) => {
      const m = String(report?.text || '').match(/identified as ([^;.]+)[;.]/);
      if (!m) return null;
      const label = m[1].trim();
      for (const key of testBM1.intelIdentityCandidates()) if (testBM1.formatFaction(key) === label) return key;
      return null;
    };
    window.__rowCount = (html, name) => {
      const m = html.match(new RegExp('<tr><td>' + name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '</td><td>[^<]*</td><td>[^<]*</td><td>(\\d+)</td>'));
      return m ? Number(m[1]) : null;
    };
    window.__sections = (html) => {
      const cut = html.indexOf('Recent battles');
      return { motion: cut < 0 ? html : html.slice(0, cut), recent: cut < 0 ? '' : html.slice(cut) };
    };
  });

  // F1a — the panel read the report text and then counted the operation by its REAL faction, so an
  // account that blamed the wrong power still incremented the right one's row.
  await check('F1 a fallible account is counted against the power it blames, not the one that sailed', async () => {
    await fresh('blk-blame');
    const r = await ev(() => {
      const t = testBM1, s = t.state, book = t.campaign();
      const target = window.__unwatchedWorld();
      if (target < 0) return { fail: 'no foreign world outside the captain\'s coverage was available' };
      t.markSystemVisited(target);
      window.__watcher(target); // a crew on station: the tier that files a suspect and can be wrong about it
      const world = t.buildCampaignWorld(true);
      const attacker = Object.keys(book.polities).find((id) => id !== 'player' && id !== world.systems[target].controller && book.polities[id].hulls.length >= 3);
      if (!attacker) return { fail: 'no power with three hulls could attack it' };
      const news = t.galaxyNewsBook();
      // One operation in the book and one account in the news, so the table's count is unambiguous.
      // A mistaken account can name a power that holds nothing and has no row; that is a legitimate
      // outcome for the claim, so the gate prefers a misattribution to a listed power and keeps the
      // other kind only as a fallback.
      let fallback = null;
      for (let n = 0; n < 60; n++) {
        book.operations = []; news.items = []; news.pending = [];
        const effects = [];
        t.Campaign.launchOperation(book, world, attacker, book.polities[attacker].hulls.slice(0, 3), target, s.day, 1, 'assault', effects);
        t.applyCampaignEffects(effects, s.day);
        t.collectRegionalIntel(s.day + 30);
        const report = news.items.filter((x) => String(x.id).startsWith('op-launch:'))[0];
        const claim = window.__claimOf(report);
        if (!report || !claim || claim === attacker) continue;
        const html = window.__panelHtml('powers');
        const row = { fail: null, target, attacker, claim, tries: n + 1, listed: Boolean(book.polities[claim] && world.isFaction(claim)),
          filed: report.claimedAttacker ?? null, text: report.text,
          truthRow: window.__rowCount(html, t.formatFaction(attacker)), claimRow: window.__rowCount(html, t.formatFaction(claim)),
          known: t.campaignKnownOperations().length };
        if (row.listed && row.claimRow != null) return row;
        fallback ||= row;
      }
      if (fallback) return fallback;
      return { fail: 'sixty accounts from a crew on station all named the power that really sailed — on this tree that tier cannot be wrong, which is the defect the four-tier model exists to remove' };
    });
    assert.ok(!r.fail, `the misattribution reproduction could not be set up: ${r.fail}`);
    assert.equal(r.known, 1, `precondition: exactly one operation is known to the captain, got ${r.known}`);
    assert.notEqual(r.claim, r.attacker, 'precondition: the delivered account blames the wrong power');
    if (r.filed != null) assert.equal(r.filed, r.claim, `the account says ${r.claim} and files ${r.filed}: ${r.text}`);
    assert.notEqual(r.truthRow, null, `precondition: ${r.attacker} has a row in the Other Powers table`);
    assert.equal(r.truthRow, 0, `the table counted a fleet under ${r.attacker}, which the captain's only account does not mention (it blames ${r.claim})`);
    if (r.listed && r.claimRow != null) assert.equal(r.claimRow, 1, `and did not count it under ${r.claim}, which is who the account blames`);
  });

  // F1b — "Fleets in motion" and "Recent battles" were separated by the operation's LIVE status, so a
  // resolution nobody had reported moved the fleet between the two lists while the sentence beside it
  // still said the fleet was on its way.
  await check('F1 an unreported resolution does not move a fleet from the map to the history', async () => {
    await fresh('blk-phase');
    const r = await ev(() => {
      const t = testBM1, s = t.state, book = t.campaign();
      const target = window.__unwatchedWorld();
      if (target < 0) return { fail: 'no foreign world outside the captain\'s coverage was available' };
      t.markSystemVisited(target);
      const world = t.buildCampaignWorld(true);
      const attacker = Object.keys(book.polities).find((id) => id !== 'player' && id !== world.systems[target].controller && book.polities[id].hulls.length >= 3);
      if (!attacker) return { fail: 'no power with three hulls could attack it' };
      const news = t.galaxyNewsBook();
      book.operations = []; news.items = []; news.pending = [];
      const effects = [];
      const op = t.Campaign.launchOperation(book, world, attacker, book.polities[attacker].hulls.slice(0, 3), target, s.day, 1, 'assault', effects);
      t.applyCampaignEffects(effects, s.day);
      t.collectRegionalIntel(s.day + 30); // the launch account arrives
      const launch = news.items.filter((x) => String(x.id).startsWith('op-launch:'))[0];
      if (!launch) return { fail: 'no launch account was delivered' };
      const before = window.__sections(window.__panelHtml('operations'));
      // It ends, far away, and nobody tells the captain.
      op.status = 'resolved'; op.outcome = 'repelled'; op.resolvedDay = s.day + 4; op.losses = 3; op.defenderLosses = 1;
      const after = window.__sections(window.__panelHtml('operations'));
      const snippet = launch.text.slice(0, 30);
      // The exception that must survive: standing in the system, watching it burn.
      op.status = 'engaged';
      s.currentPlanet = target; s.myplanet = target + 1; s.warp.active = false;
      const present = window.__knows(op);
      return { fail: null, target, attacker, opId: op.id, snippet,
        beforeMotion: before.motion.includes(snippet), afterMotion: after.motion.includes(snippet),
        afterRecent: after.recent.includes(snippet), afterNoBattles: /No battles recorded/.test(after.recent),
        presentLevel: present.level, presentClaim: present.claimant };
    });
    assert.ok(!r.fail, `the unreported-resolution reproduction could not be set up: ${r.fail}`);
    assert.equal(r.beforeMotion, true, 'precondition: the reported fleet is listed as on the move');
    assert.equal(r.afterMotion, true, 'an unreported resolution took the fleet off the map the captain has been told about');
    assert.equal(r.afterRecent, false, 'and filed it under battles the captain has been told the outcome of');
    assert.equal(r.afterNoBattles, true, 'the recent-battles list should still be empty: no account of any battle has arrived');
    assert.equal(r.presentLevel, 'direct', 'a captain standing in an engaged battle must still read the campaign record');
    assert.equal(r.presentClaim, r.attacker, 'and see who is actually there');
  });

  // F2 — the source map was built once per advancement call, so a world lost on an internal day went on
  // reporting its new owner to its old owner for the rest of the jump, and the jumped book diverged.
  await check('F2 a source lost inside a jump stops observing from the day it is lost', async () => {
    const DAYS = 16;
    const run = async (stepped) => {
      await fresh('blk-sourceloss');
      return ev((args) => {
        const t = testBM1, s = t.state, book = t.campaign();
        const world = t.buildCampaignWorld(true);
        const here = Number(s.currentPlanet);
        const relayed = new Set([...t.campaignRelayCoverage()].map(Number));
        // A world the captain can hold, far from anything else of theirs, with no relay of its own.
        const target = world.systems.findIndex((sys, i) => i !== here && !relayed.has(i) && sys.controller && sys.controller !== 'player'
          && !t.getPlayerFleetShips(i).length
          && !world.stationsBySystem(i).some((st) => (st.cap?.effects.relay || 0) > 0));
        if (target < 0) return { fail: 'no relay-free foreign world was available to hold' };
        t.markSystemVisited(target);
        t.transferSystemControlToPlayer(target);
        const w2 = t.buildCampaignWorld(true);
        // A power actually at war with the colours the captain flies, or the settlement rules stand the
        // operation down before it reaches anybody.
        const flag = t.getPlayerFlag();
        const attacker = Object.keys(book.polities).find((id) => id !== 'player' && book.polities[id].hulls.length >= 20
          && t.worldRelation(flag, t.campaignFactionKeyFor(id)).status === 'war');
        if (!attacker) return { fail: `no power at war with ${flag} had twenty hulls to take it` };
        const hulls = book.polities[attacker].hulls.slice(0, 20);
        for (const h of hulls) h.systemIndex = target;
        t.Campaign.launchOperation(book, w2, attacker, hulls, target, s.day, 1, 'assault');
        const start = s.day;
        if (args.stepped) { for (let d = start + 1; d <= start + args.days; d++) t.advanceCampaign(d); }
        else t.advanceCampaign(start + args.days);
        const obs = (book.observations || {})[target] || null;
        return { fail: null, target, attacker, days: args.days, obs, lastDay: start + args.days,
          controller: t.buildCampaignWorld(true).systems[target].controller,
          source: window.__sourceOf(target), checksum: t.Campaign.checksum(book) };
      }, { stepped, days: DAYS });
    };
    const walked = await run(true);
    const jumped = await run(false);
    assert.ok(!walked.fail && !jumped.fail, `the source-loss reproduction could not be set up: ${walked.fail || jumped.fail}`);
    assert.notEqual(walked.controller, 'player', `precondition: the captain lost the world inside the interval (still ${walked.controller})`);
    assert.ok(walked.obs, 'precondition: the captain observed the world while they held it');
    assert.ok(walked.obs.day < walked.lastDay, `precondition: stepping stopped observing before day ${walked.lastDay} (last observation day ${walked.obs.day})`);
    assert.ok(jumped.obs, 'the jumped run recorded no observation at all');
    assert.equal(jumped.obs.day, walked.obs.day,
      `a jump went on watching a world the captain had lost: last observed day ${jumped.obs.day} jumped, ${walked.obs.day} stepped`);
    assert.equal(jumped.obs.controller, walked.obs.controller, `and recorded ${jumped.obs.controller} holding it where stepping recorded ${walked.obs.controller}`);
    assert.equal(jumped.obs.source, walked.obs.source, `and called the source ${jumped.obs.source} where stepping called it ${walked.obs.source}`);
    assert.equal(jumped.checksum, walked.checksum, `and the books differ: ${jumped.checksum} jumped, ${walked.checksum} stepped`);
  });

  // Found while gating F2, and not in the review: the engine's own equivalence claim was false for
  // reasons that had nothing to do with intelligence. Contracts the engine offers BETWEEN model days
  // took their ids from the model's counter, so a jump — which offers them after sixteen days of model
  // allocations instead of after one — handed different ids to every hull and operation created later.
  // Ids seed rolls, so battles then resolved differently. And the captain's own account was refreshed
  // from their real latinum once per call rather than once per day, so a jump left the model reading a
  // stale treasury. This is the whole book, compared field by field.
  await check('EQUIV a jump through the engine produces the book stepping produces', async () => {
    const DAYS = 16;
    const run = async (stepped, mode) => {
      await fresh('blk-equiv');
      return ev((a) => {
        const t = testBM1, s = t.state, book = t.campaign();
        if (a.mode === 'holding') {
          // The captain holding a world of their own puts their account, their supply and their
          // defence into the same days.
          const world = t.buildCampaignWorld(true);
          const i = world.systems.findIndex((sys, idx) => idx !== Number(s.currentPlanet) && sys.controller && sys.controller !== 'player');
          if (i < 0) return { fail: 'no foreign world was available to claim' };
          t.transferSystemControlToPlayer(i); t.markSystemVisited(i);
        }
        const start = s.day;
        if (a.stepped) { for (let d = start + 1; d <= start + a.days; d++) t.advanceCampaign(d); }
        else t.advanceCampaign(start + a.days);
        return { fail: null, checksum: t.Campaign.checksum(book), book: JSON.parse(JSON.stringify(book)), latinum: s.latinum };
      }, { stepped, days: DAYS, mode });
    };
    for (const mode of ['plain', 'holding']) {
      const walked = await run(true, mode);
      const jumped = await run(false, mode);
      assert.ok(!walked.fail && !jumped.fail, `the ${mode} equivalence run could not be set up: ${walked.fail || jumped.fail}`);
      assert.equal(jumped.latinum, walked.latinum, `${mode}: the captain's latinum differs — ${jumped.latinum} jumped, ${walked.latinum} stepped`);
      const differing = [...new Set([...Object.keys(walked.book), ...Object.keys(jumped.book)])]
        .filter((k) => JSON.stringify(walked.book[k]) !== JSON.stringify(jumped.book[k]));
      assert.deepEqual(differing, [], `${mode}: a ${DAYS}-day jump produced a different book: ${differing.join(', ')}`);
      assert.equal(jumped.checksum, walked.checksum, `${mode}: the digests differ: ${jumped.checksum} jumped, ${walked.checksum} stepped`);
    }
  });

  // ---- sixth-review finding ----

  // F3 — the source map was reduced BEFORE the day's station records were written into the shadow, so
  // a recomputation read every installation at its old strength. The reducer also only ran on the day's
  // effects, and the repair tick is not an effect, so a sector hub repaired back above the threshold
  // inside a jump never re-entered the captain's coverage at all. Both halves are the same ordering.
  await check('F3 a relay whose reach changes inside a jump changes what the captain covers from that day', async () => {
    // One internal day of repair is all this needs, and a short window keeps the galaxy from doing the
    // reducer's work for it: any conquest anywhere recomputes the whole source map, which would mask
    // the defect rather than fix it. The check refuses to draw a conclusion if that happens.
    const DAYS = 2;
    const run = async (stepped) => {
      await fresh('blk-relayreach');
      return ev((args) => {
        const t = testBM1, s = t.state, book = t.campaign();
        const PLAYER = t.PLAYER_SIDE;
        s.stationOwners ||= {};
        const here = Number(s.currentPlanet);
        // A sector hub (relay 2) the captain owns, with repair capacity of theirs in the same system,
        // and a neighbour that nothing else of theirs watches.
        let chosen = null;
        for (const def of s.stationDefinitions || []) {
          if (s.destroyedStations?.[def.id] || def.underConstruction) continue;
          const cap = t.getStationCapabilities(def, Number(def.systemIndex));
          if (!cap || cap.status !== 'operational' || (cap.effects.relay || 0) < 2) continue;
          const sys = Number(def.systemIndex);
          if (sys === here) continue;
          const yard = (s.stationDefinitions || []).find((d) => Number(d.systemIndex) === sys && d.id !== def.id
            && !s.destroyedStations?.[d.id] && !d.underConstruction
            && ((t.getStationCapabilities(d, sys) || {}).effects?.repairCapacity || 0) > 0);
          if (!yard) continue;
          s.stationOwners[def.id] = PLAYER; s.stationOwners[yard.id] = PLAYER;
          const world = t.buildCampaignWorld(true);
          const covered = new Set([...t.campaignRelayCoverage()].map(Number));
          const neighbour = world.neighbours(sys).map(Number).find((n) => n !== here && n !== sys && covered.has(n)
            && !(s.controlledSystems || []).includes(n)
            && !t.getPlayerFleetShips(n).length
            && !(s.stationDefinitions || []).some((d) => Number(d.systemIndex) === n && t.getStationOwner(d, n) === PLAYER));
          if (neighbour == null) { delete s.stationOwners[def.id]; delete s.stationOwners[yard.id]; continue; }
          chosen = { hub: def.id, yard: yard.id, sys, neighbour };
          break;
        }
        if (!chosen) return { fail: 'no sector hub with repair capacity beside it and an otherwise unwatched neighbour was available' };
        t.markSystemVisited(chosen.neighbour);
        // Wreck it just enough to drop it below the sector threshold, and let one day's repair tick
        // carry it back over: 0.05 heals to nothing on the first internal day, so the reach returns on
        // the second, and the whole reproduction sits inside two days.
        book.stationDamage[chosen.hub] = 0.05;
        t.buildCampaignWorld(true);
        const before = [...t.campaignRelayCoverage()].map(Number).includes(chosen.neighbour);
        const capturesAtStart = book.stats.captures;
        const start = s.day;
        if (args.stepped) { for (let d = start + 1; d <= start + args.days; d++) t.advanceCampaign(d); }
        else t.advanceCampaign(start + args.days);
        t.buildCampaignWorld(true);
        return { fail: null, ...chosen, before, days: args.days, lastDay: start + args.days,
          capturesInWindow: book.stats.captures - capturesAtStart,
          after: [...t.campaignRelayCoverage()].map(Number).includes(chosen.neighbour),
          damage: book.stationDamage[chosen.hub] || 0,
          obs: (book.observations || {})[chosen.neighbour] || null,
          source: window.__sourceOf(chosen.neighbour), checksum: t.Campaign.checksum(book) };
      }, { stepped, days: DAYS });
    };
    const walked = await run(true);
    const jumped = await run(false);
    assert.ok(!walked.fail && !jumped.fail, `the relay-reach reproduction could not be set up: ${walked.fail || jumped.fail}`);
    assert.equal(walked.before, false, `precondition: the damaged hub does not reach ${walked.neighbour} at the start`);
    assert.equal(walked.capturesInWindow + jumped.capturesInWindow, 0,
      'precondition: no conquest happened inside the window, which would have recomputed the whole source map for unrelated reasons');
    assert.equal(walked.damage, 0, `precondition: the hub was repaired during the interval (${walked.damage} damage left)`);
    assert.equal(walked.after, true, `precondition: the repaired hub reaches ${walked.neighbour} again`);
    assert.ok(walked.obs, `precondition: stepping observed ${walked.neighbour} once the hub came back`);
    assert.ok(jumped.obs, `a jump never noticed the hub come back: ${jumped.neighbour} was never observed, where stepping observed it on day ${walked.obs.day}`);
    assert.equal(jumped.obs.day, walked.obs.day, `last observed day ${jumped.obs.day} jumped, ${walked.obs.day} stepped`);
    assert.equal(jumped.obs.source, walked.obs.source, `and called the source ${jumped.obs.source} where stepping called it ${walked.obs.source}`);
    assert.equal(jumped.checksum, walked.checksum, `and the books differ: ${jumped.checksum} jumped, ${walked.checksum} stepped`);
  });

  // ---- seventh-review finding ----

  // F4 — the shadow was told about a settlement before the source map was reduced, but the reducer did
  // not count a settlement as something that changes the map. A foreign hub standing in a world of the
  // captain's is theirs to read the day the war with its owner ends; a jump went on treating it as
  // enemy infrastructure for the rest of the call.
  await check('F4 a settlement that brings a foreign relay back on side is seen from the day it is signed', async () => {
    const DAYS = 3;
    const run = async (stepped) => {
      await fresh('blk-peacerelay');
      return ev((args) => {
        const t = testBM1, s = t.state, book = t.campaign();
        s.stationOwners ||= {};
        const here = Number(s.currentPlanet);
        const flag = t.getPlayerFlag();
        // The other belligerent in the central war, which is who the captain's colours are at war with.
        const foe = (book.config.centralWar || []).find((id) => id !== flag);
        if (!foe || t.worldRelation(flag, foe).status !== 'war') return { fail: `${flag} is not at war with the other central belligerent` };
        // A sector hub the captain will own the ground under but not the installation itself.
        let chosen = null;
        for (const def of s.stationDefinitions || []) {
          if (s.destroyedStations?.[def.id] || def.underConstruction) continue;
          const cap = t.getStationCapabilities(def, Number(def.systemIndex));
          if (!cap || cap.status !== 'operational' || (cap.effects.relay || 0) < 2) continue;
          const sys = Number(def.systemIndex);
          if (sys === here) continue;
          // Take the ground first, then leave the installation in foreign hands: a conquest moves the
          // displaced sovereign's installations and nobody else's, which is exactly the real shape —
          // an outpost owned by one power standing in a world another power has taken.
          t.transferSystemControlToPlayer(sys);
          s.stationOwners[def.id] = foe;
          const world = t.buildCampaignWorld(true);
          const covered = new Set([...t.campaignRelayCoverage()].map(Number));
          const neighbour = world.neighbours(sys).map(Number).find((n) => n !== here && n !== sys && !covered.has(n)
            && !(s.controlledSystems || []).includes(n)
            && !t.getPlayerFleetShips(n).length
            && !(s.stationDefinitions || []).some((d) => Number(d.systemIndex) === n && t.getStationOwner(d, n) === t.PLAYER_SIDE));
          if (neighbour == null) continue;
          chosen = { hub: def.id, sys, neighbour, foe, flag };
          break;
        }
        if (!chosen) return { fail: 'no sector hub could be placed in foreign hands inside a world the captain holds' };
        t.markSystemVisited(chosen.neighbour);
        // End the war inside the call: a belligerent that holds no world has lost it, and the model
        // settles that on the first day it settles.
        const world = t.buildCampaignWorld(true);
        for (const sys of world.systems) if (sys.controller === chosen.foe) t.transferSystemControlToFaction(sys.index, chosen.flag);
        t.buildCampaignWorld(true);
        const before = {
          relation: t.worldRelation(chosen.flag, chosen.foe).status,
          covered: [...t.campaignRelayCoverage()].map(Number).includes(chosen.neighbour),
        };
        const capturesAtStart = book.stats.captures;
        const start = s.day;
        if (args.stepped) { for (let d = start + 1; d <= start + args.days; d++) t.advanceCampaign(d); }
        else t.advanceCampaign(start + args.days);
        t.buildCampaignWorld(true);
        return { fail: null, ...chosen, before, days: args.days, lastDay: start + args.days,
          capturesInWindow: book.stats.captures - capturesAtStart,
          relation: t.worldRelation(chosen.flag, chosen.foe).status,
          covered: [...t.campaignRelayCoverage()].map(Number).includes(chosen.neighbour),
          obs: (book.observations || {})[chosen.neighbour] || null,
          checksum: t.Campaign.checksum(book) };
      }, { stepped, days: DAYS });
    };
    const walked = await run(true);
    const jumped = await run(false);
    assert.ok(!walked.fail && !jumped.fail, `the settlement reproduction could not be set up: ${walked.fail || jumped.fail}`);
    assert.equal(walked.before.relation, 'war', `precondition: ${walked.flag} and ${walked.foe} start at war`);
    assert.equal(walked.before.covered, false, `precondition: the enemy hub does not cover ${walked.neighbour} while the war is on`);
    assert.equal(walked.capturesInWindow + jumped.capturesInWindow, 0,
      'precondition: no conquest happened inside the window, which would have recomputed the whole source map for unrelated reasons');
    assert.equal(walked.relation, 'peace', `precondition: the war ended inside the interval (still ${walked.relation})`);
    assert.equal(walked.covered, true, `precondition: the hub covers ${walked.neighbour} once the war is over`);
    assert.ok(walked.obs, `precondition: stepping observed ${walked.neighbour} once peace brought the hub on side`);
    assert.ok(jumped.obs, `a jump kept treating the hub as enemy infrastructure after the settlement: ${jumped.neighbour} was never observed, where stepping observed it on day ${walked.obs.day}`);
    assert.equal(jumped.obs.day, walked.obs.day, `last observed day ${jumped.obs.day} jumped, ${walked.obs.day} stepped`);
    assert.equal(jumped.obs.source, walked.obs.source, `and called the source ${jumped.obs.source} where stepping called it ${walked.obs.source}`);
    assert.equal(jumped.checksum, walked.checksum, `and the books differ: ${jumped.checksum} jumped, ${walked.checksum} stepped`);
  });

  // ---- eighth-review finding ----

  // F5 — the survivor test asked whether any hull of the captain's was still at the system, which
  // counted vessels the source map had deliberately excluded. An outbound hull keeps its departure
  // system in the book until it arrives and is never a defender, so it survived the battle that killed
  // the crew actually watching and kept that system reporting for the rest of the call.
  await check('F5 an outbound hull does not keep a dead crew\'s station reporting', async () => {
    const DAYS = 6;
    const run = async (stepped) => {
      await fresh('blk-transitmask');
      return ev((args) => {
        const t = testBM1, s = t.state, book = t.campaign();
        const here = Number(s.currentPlanet);
        const flag = t.getPlayerFlag();
        const world = t.buildCampaignWorld(true);
        const relayed = new Set([...t.campaignRelayCoverage()].map(Number));
        // A world the captain neither holds nor owns anything in, held by somebody they are not at war
        // with, so their ships there are counted among its defenders.
        const target = world.systems.findIndex((sys, i) => i !== here && !relayed.has(i) && sys.controller && sys.controller !== 'player'
          && t.worldRelation(flag, t.campaignFactionKeyFor(sys.controller)).status !== 'war'
          && !t.getPlayerFleetShips(i).length
          && !(s.controlledSystems || []).includes(i)
          && !(s.stationDefinitions || []).some((d) => Number(d.systemIndex) === i && t.getStationOwner(d, i) === t.PLAYER_SIDE));
        if (target < 0) return { fail: 'no neutral world outside the captain\'s coverage was available' };
        t.markSystemVisited(target);
        const ship = Object.values(s.shipStatsById).find((x) => x && x.assetType === 'ship' && t.getShipPrice(x) > 0);
        // The crew that is actually watching, small enough to die in the first exchange...
        s.playerFleet.push({ id: 'onstation', shipId: Number(ship.id), name: 'Picket', systemIndex: target, assignment: 'defense',
          destroyed: false, vessel: { hull: 1, maxHull: 1, condition: 'operational' } });
        // ...and one already outbound from the same world, which the book still files there.
        s.playerFleet.push({ id: 'outbound', shipId: Number(ship.id), name: 'Courier', systemIndex: target, assignment: 'transit',
          destroyed: false, vessel: { hull: 400, maxHull: 400, condition: 'operational' } });
        const w2 = t.buildCampaignWorld(true);
        const attacker = Object.keys(book.polities).find((id) => id !== 'player' && id !== w2.systems[target].controller
          && book.polities[id].hulls.length >= 20
          && t.worldRelation(flag, t.campaignFactionKeyFor(id)).status === 'war');
        if (!attacker) return { fail: `no power at war with ${flag} had twenty hulls to attack it` };
        const hulls = book.polities[attacker].hulls.slice(0, 20);
        for (const h of hulls) h.systemIndex = target;
        t.Campaign.launchOperation(book, w2, attacker, hulls, target, s.day, 1, 'assault');
        const start = s.day;
        if (args.stepped) { for (let d = start + 1; d <= start + args.days; d++) t.advanceCampaign(d); }
        else t.advanceCampaign(start + args.days);
        const picket = (s.playerFleet || []).find((f) => f.id === 'onstation');
        const courier = (s.playerFleet || []).find((f) => f.id === 'outbound');
        return { fail: null, target, attacker, days: args.days, lastDay: start + args.days,
          picketLost: Boolean(picket?.destroyed), courierAlive: Boolean(courier && !courier.destroyed),
          obs: (book.observations || {})[target] || null,
          source: window.__sourceOf(target), checksum: t.Campaign.checksum(book) };
      }, { stepped, days: DAYS });
    };
    const walked = await run(true);
    const jumped = await run(false);
    assert.ok(!walked.fail && !jumped.fail, `the transit-mask reproduction could not be set up: ${walked.fail || jumped.fail}`);
    assert.equal(walked.picketLost, true, 'precondition: the crew on station was killed inside the interval');
    assert.equal(walked.courierAlive, true, 'precondition: the outbound hull survived, as a vessel in transit always does');
    assert.ok(walked.obs, `precondition: the captain observed ${walked.target} while the picket was alive`);
    assert.ok(walked.obs.day < walked.lastDay, `precondition: stepping stopped observing when the picket died (last observation day ${walked.obs.day} of ${walked.lastDay})`);
    assert.ok(jumped.obs, 'the jumped run recorded no observation at all');
    assert.equal(jumped.obs.day, walked.obs.day,
      `an outbound hull kept a dead crew's station reporting: last observed day ${jumped.obs.day} jumped, ${walked.obs.day} stepped`);
    assert.equal(jumped.obs.source, walked.obs.source, `and called the source ${jumped.obs.source} where stepping called it ${walked.obs.source}`);
    assert.equal(jumped.checksum, walked.checksum, `and the books differ: ${jumped.checksum} jumped, ${walked.checksum} stepped`);
  });

  // The other half of the same rule: a crew that is hurt but alive is still watching. A survivor test
  // that struck a system off on any loss report would be wrong in the opposite direction.
  await check('F5 a damaged crew that survives keeps reporting', async () => {
    await fresh('blk-damagedcrew');
    const r = await ev(() => {
      const t = testBM1, s = t.state;
      const world = t.buildCampaignWorld(true);
      const here = Number(s.currentPlanet);
      const relayed = new Set([...t.campaignRelayCoverage()].map(Number));
      const target = world.systems.findIndex((sys, i) => i !== here && !relayed.has(i) && sys.controller && sys.controller !== 'player'
        && !t.getPlayerFleetShips(i).length
        && !(s.controlledSystems || []).includes(i)
        && !(s.stationDefinitions || []).some((d) => Number(d.systemIndex) === i && t.getStationOwner(d, i) === t.PLAYER_SIDE));
      if (target < 0) return { fail: 'no unwatched world was available' };
      t.markSystemVisited(target);
      window.__watcher(target);
      const before = window.__sourceOf(target);
      // The strategic resolver reports the vessel as hurt, not lost.
      t.applyCampaignEffects([{ type: 'defenderLosses', polityId: 'player', systemIndex: target, opId: 'dmg-1', day: s.day,
        attacker: 'klingon', hulls: [{ hullId: `pf:watcher-${target}`, hull: 120, maxHull: 400, destroyed: false }] }], s.day);
      const after = window.__sourceOf(target);
      const ship = (s.playerFleet || []).find((f) => f.id === `watcher-${target}`);
      return { fail: null, target, before, after, hull: ship?.vessel?.hull ?? null, destroyed: Boolean(ship?.destroyed) };
    });
    assert.ok(!r.fail, `the damaged-crew check could not be set up: ${r.fail}`);
    assert.equal(r.before, 'fleet', 'precondition: the crew on station is the captain\'s only source there');
    assert.equal(r.destroyed, false, 'precondition: the vessel survived the engagement');
    assert.equal(r.hull, 120, 'precondition: and took the damage the resolver assigned it');
    assert.equal(r.after, 'fleet', 'a crew that survived the battle stopped counting as a source');
  });

  // ---- ninth-review finding ----

  // F6 — ownership and observation were one question. A destroyed installation of the captain's kept
  // its system in the source map, so a wreck went on filing dated, relay-grade controller observations
  // for the rest of the campaign, and campaign events there were still classified as dependable relay
  // dispatches. Reachable in ordinary daily play: destruction leaves the definition and its owner in
  // place, which is right for salvage and reconstruction and wrong for listening.
  await check('F6 a destroyed installation is still yours and no longer your eyes', async () => {
    await fresh('blk-wreck');
    const r = await ev(() => {
      const t = testBM1, s = t.state, book = t.campaign();
      const target = window.__unwatchedWorld();
      if (target < 0) return { fail: 'no foreign world outside the captain\'s coverage was available' };
      t.markSystemVisited(target);
      const def = (s.stationDefinitions || []).find((d) => Number(d.systemIndex) === target && !s.destroyedStations?.[d.id]
        && !d.underConstruction && window.__liveStation(d, target));
      if (!def) return { fail: `no standing installation at system ${target} to give the captain` };
      s.stationOwners ||= {}; s.stationOwners[def.id] = t.PLAYER_SIDE;
      t.buildCampaignWorld(true);
      const holder = t.buildCampaignWorld(true).systems[target].controller;
      const taker = Object.keys(book.polities).find((id) => id !== 'player' && id !== holder);
      if (!taker) return { fail: `no other power exists to take a world from ${holder}` };
      const read = (id) => { book.assessments = {}; return t.campaignAssessment(id).estimate.worlds; };

      // 1. it is the captain's only source there, and they observe the world through it.
      const standing = { source: window.__runtimeSource(target), gate: window.__sourceOf(target) };
      s.day += 1; read(holder);
      const observedStanding = (book.observations || {})[target] || null;

      // 2. it is destroyed — the record the destruction path leaves behind, with the definition and
      //    its owner deliberately preserved for salvage and reconstruction.
      s.destroyedStations[def.id] = true;
      t.buildCampaignWorld(true);
      const wrecked = { source: window.__runtimeSource(target), gate: window.__sourceOf(target),
        owner: t.getStationOwner(def, target), playerSide: t.PLAYER_SIDE,
        status: (t.getStationCapabilities(def, target) || {}).status };

      // 3. the world changes hands with nothing of the captain's left watching it.
      t.transferSystemControlToFaction(target, taker);
      t.buildCampaignWorld(true);
      s.day += 1; read(taker);
      const observedWrecked = (book.observations || {})[target] || null;

      // 4. the loss is still the captain's business even though it is no longer their eyes.
      const personal = t.isPersonalGalaxyReport({ id: 'wreck-report', systemIndex: target, factions: [], playerRelated: false, text: '' });

      // 5. rebuilt, it reports again.
      delete s.destroyedStations[def.id];
      t.buildCampaignWorld(true);
      s.day += 1; read(taker);
      const rebuilt = { source: window.__runtimeSource(target), gate: window.__sourceOf(target),
        obs: (book.observations || {})[target] || null };
      return { fail: null, target, station: def.id, holder, taker, standing, observedStanding, wrecked, observedWrecked, personal, rebuilt, day: s.day };
    });
    assert.ok(!r.fail, `the wreck reproduction could not be set up: ${r.fail}`);
    assert.equal(r.standing.gate, 'relay', `precondition: a standing installation of the captain's is their source at ${r.target}`);
    if (r.standing.source != null) assert.equal(r.standing.source, 'relay', 'precondition: and the runtime agrees while it stands');
    assert.ok(r.observedStanding, 'precondition: the captain observed the world through it');
    assert.equal(r.observedStanding.controller, r.holder, `precondition: they saw ${r.holder} holding it`);
    assert.equal(r.wrecked.status, 'destroyed', 'precondition: the installation is a wreck');
    assert.equal(r.wrecked.owner, r.wrecked.playerSide, 'precondition: and the wreck is still the captain\'s, as the destruction path leaves it');
    assert.equal(r.wrecked.gate, 'rumour', 'precondition: with the wreck discounted, nothing of the captain\'s watches that system');
    if (r.wrecked.source != null) assert.equal(r.wrecked.source, 'rumour', `a destroyed installation was still classed as a "${r.wrecked.source}" source`);
    assert.equal(r.observedWrecked.controller, r.holder,
      `a wreck went on watching: the captain's books moved to ${r.observedWrecked.controller} with nothing of theirs left at ${r.target}`);
    assert.equal(r.observedWrecked.day, r.observedStanding.day, `and were re-dated to day ${r.observedWrecked.day}`);
    assert.equal(r.personal, true, 'a report about a world where the captain owns a wreck stopped being their business');
    if (r.rebuilt.source != null) assert.equal(r.rebuilt.source, 'relay', 'a rebuilt installation did not become a source again');
    assert.equal(r.rebuilt.obs.controller, r.taker, 'and the captain did not learn who holds the world now');
    assert.equal(r.rebuilt.obs.day, r.day, 'and the observation was not dated to the day they saw it');
  });

  // B12 — the phase control computed a sentence and changed nothing; a numeric control accepted 1e999.
  await check('B12 the debug phase control changes the phase, and numeric controls reject absurd input', async () => {
    await fresh('blk-debug');
    // On the reviewed candidate this does not return a wrong answer: it wedges the page in an
    // unbounded append loop. The evaluation is raced against a deadline so the gate reports the
    // reproduction instead of hanging with it. It runs last for the same reason.
    const deadline = new Promise((resolve) => setTimeout(() => resolve({ timedOut: true }), 25000));
    const r = await Promise.race([deadline, ev(() => {
      const t = testBM1;
      const before = t.campaign().dominion.phase;
      const said = t.applyDebugCommand('campaign phase staging');
      const after = t.campaign().dominion.phase;
      let threw = '';
      const started = Date.now();
      try { t.applyDebugCommand('campaign readiness klingon 1e999'); } catch (e) { threw = String(e.message || e); }
      const elapsed = Date.now() - started;
      const hulls = t.campaign().polities.klingon.hulls.length;
      let fracThrew = '';
      try { t.applyDebugCommand('campaign readiness klingon 2.7'); } catch (e) { fracThrew = String(e.message || e); }
      const afterFrac = t.campaign().polities.klingon.hulls.filter((h) => h.status !== 'lost').length;
      return { before, after, said: String(said), threw, elapsed, hulls, fracThrew, afterFrac, cap: t.campaign().config.maxHullsPerPolity };
    })]);
    assert.notEqual(r.timedOut, true, 'a numeric debug control did not return within 25 s: the unbounded loop reproduces');
    assert.notEqual(r.after, r.before, `the phase control reported "${r.said}" and changed nothing`);
    assert.equal(r.after, 'staging', `expected the staging phase, got ${r.after}`);
    assert.ok(r.threw, 'a non-finite readiness argument was accepted');
    assert.ok(r.elapsed < 5000, `the non-finite argument took ${r.elapsed} ms`);
    assert.ok(r.hulls <= r.cap, `${r.hulls} hulls against a cap of ${r.cap}`);
    assert.equal(r.afterFrac, 2, 'a fractional count must land on a whole number of hulls');
  });

  // The summary prints before anything that can hang. One check reproduces its defect by wedging the
  // page, so on a tree that still has it the run must still be able to report what it found — and that
  // check is deliberately last for the same reason.
  console.log(`${checks - failures.length}/${checks} engine-side blocker reproductions no longer reproduce.`);
  if (failures.length) { console.log(`${failures.length} still reproduce:`); for (const f of failures) console.log(`  - ${f.name}: ${f.message.split('\n')[0]}`); process.exitCode = 1; }
  if (errors.length) { console.log(`page errors: ${errors.join(' | ')}`); process.exitCode = 1; }
  await Promise.race([probe.close(), new Promise((r) => setTimeout(r, 15000))]);
  process.exit(process.exitCode || 0);
})().catch((e) => { console.error(e); process.exit(1); });
