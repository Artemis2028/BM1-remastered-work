// Gate for foreign stock and captured markets, stacked on 125e55c.
// Rules: docs/playtest/FOREIGN-STOCK-RULES-251536ZSEP26.md.
//
// Two concepts, kept apart: a PRIZE is one specific captured vessel (a vid) held on a vendor's shelf;
// CAPTURED INDUSTRY is design access at an integrated major world. Categories as in
// section6-verification-gate.cjs:
//   baseline-defect  reproduces a wrong behaviour of 125e55c
//   new-feature      needs the prize shelf, which 125e55c does not have (fails its precondition there)
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

  await page.evaluate(() => {
    const t = testBM1;
    // Every hull offered anywhere in a system: the planet market and every station, by vendor.
    window.__vendors = (i) => {
      const s = t.state;
      s.currentPlanet = i; s.myplanet = i + 1; s.docked = false; s.dockedStationId = null; s.remoteStationId = null;
      t.applySystemState(i);
      const rows = [{ vendor: 'planet', station: null, ids: t.getShipyardStock(null).map((x) => Number(x.id)) }];
      for (const st of s.stations.filter((x) => !x.destroyed)) rows.push({ vendor: st.id, name: t.getShipStats(st.stationTypeId)?.name, sell: Boolean(t.fleetStationServices(st).sell), owner: t.getStationOwner(st, i), ids: t.getShipyardStock(st).map((x) => Number(x.id)) });
      return rows;
    };
    window.__all = (i) => [...new Set(window.__vendors(i).flatMap((r) => r.ids))];
    // The rules document's civilian test, written out here so the gate does not depend on the code it
    // judges (and runs unchanged on the parent): a civilian role word, no military role word, mass <= 4.
    window.__civilian = (id) => {
      const ship = t.state.shipStatsById[Number(id)] || {}, role = String(ship.role || '');
      return Number(ship.mass || 1) <= 4 && /freight|hauler|cargo|shuttle|transport|courier|tender|tug|liner|yacht|utility|runabout|civilian/i.test(role)
        && !/warbird|military|miltek|strike|attack|assault|patrol|defen|destroyer|battle|raider|interceptor|gunship|dreadn|carrier|fighter|scout|escort|frigate|cruiser|warship|capital/i.test(role);
    };
    // A design of the origin culture that is not local civilian production: a warship.
    window.__military = (ids, faction) => ids.filter((id) => t.getShipFaction(id) === faction && !window.__civilian(id));
    window.__foreign = (ids, allowed) => ids.filter((id) => { const f = t.getShipFaction(id); return f && f !== 'neutral' && !allowed.includes(f); });
    window.__integrate = (days) => t.advanceFleetCalendar(days, t.Fleet.nextId(t.fleetBook(), 'journey'));
    // A real campaign hull materialised in the captain's system and captured by the real boarding code.
    window.__capturePrize = (faction = 'klingon') => {
      const s = t.state, book = t.campaign();
      const hull = book.polities[faction].hulls.find((h) => h.status === 'ready' && !h.opId);
      if (!hull) return null;
      s.activeFleetAttack = null;
      const op = t.Campaign.launchOperation(book, t.buildCampaignWorld(true), faction, [hull], Number(s.currentPlanet), s.day, 0, 'raid', []);
      op.status = 'engaged'; op.engagedDay = s.day; op.arriveDay = s.day;
      hull.systemIndex = Number(s.currentPlanet);
      const claim = t.Campaign.claimOperationForScene(book, op.id);
      op.spawnedHullIds = [];
      t.spawnCampaignOperation(op, claim.hulls, 0);
      const npc = s.npcShips.find((n) => n.campaignHullId === hull.id);
      t.ensureNpcCombatStats(npc);
      npc.combatHull = Math.max(1, Math.floor(t.Fleet.disableThreshold(npc.maxCombatHull) * 0.5));
      t.applyVesselDisablement(npc);
      t.setCamera(npc.x + 50, npc.y);
      const b = t.fleetBook();
      b.team.available = false;
      b.boarding = { id: t.Fleet.nextId(b, 'boarding'), targetId: t.physicalNpcId(npc), sourceId: b.personalId, phase: 'onboard', remaining: 0.1, xp: 50, resistance: 'light', chance: 90, roll: 1, algorithm: 2 };
      t.updateBoarding(1);
      const record = s.playerFleet.find((f) => f.identity?.vid === hull.id);
      return record ? { record, hullId: hull.id } : null;
    };
    // Dock at a station and bring a fleet vessel alongside it, as a captain selling or buying would.
    window.__dockAt = (stationId, fleetId = null) => {
      const s = t.state, st = s.stations.find((x) => x.id === stationId);
      s.docked = true; s.dockedStationId = st.id; s.dockedPlanetIndex = s.currentPlanet; s.remoteStationId = null;
      t.setCamera(st.x, st.y);
      if (fleetId) {
        const npc = t.fleetLocalActor(fleetId);
        if (npc) { npc.x = st.x + 60; npc.y = st.y + 40; npc.lastShieldHitAt = 0; if (npc.power) npc.power.combat = false; t.ensureNpcCombatStats(npc); npc.condition = 'operational'; }
      }
      return st;
    };
    window.__vidCount = (vid) => {
      const s = t.state, book = t.campaign();
      let n = 0;
      for (const [id, p] of Object.entries(book.polities)) if (id !== 'player') n += p.hulls.filter((h) => h.status !== 'lost' && (h.identity?.vid || h.id) === vid).length;
      n += s.playerFleet.filter((f) => !f.destroyed && f.identity?.vid === vid).length;
      n += (book.prizes || []).filter((p) => p.vid === vid).length;
      if (t.fleetBook().personalIdentity?.vid === vid) n++;
      return n;
    };
    window.__openMarket = (stationId) => {
      const s = t.state;
      window.__dockAt(stationId);
      s.planetMenuOpen = true; s.dockMenuTab = 'market';
      t.renderPlanetMenu();
    };
    window.__openPlanet = () => {
      const s = t.state;
      s.docked = true; s.dockedStationId = null; s.dockedPlanetIndex = s.currentPlanet; s.remoteStationId = null;
      s.planetMenuOpen = true; s.dockMenuTab = 'ships';
      t.renderPlanetMenu();
    };
    window.__closeMarket = () => { const s = t.state; s.planetMenuOpen = false; t.renderPlanetMenu(); };
  });
  const idx = (name) => ev((name) => testBM1.getSystemIndexByName(name), name);

  // ---------------- normal markets ----------------
  await check('preservation', 'FS-NORMAL a Terran world sells Terran and independent hulls only: no Romulan, Klingon or other foreign hull at any of its vendors', async () => {
    await fresh('fs-normal');
    const r = await ev(() => ['Earth', 'Alpha Centauri', 'Terra Nova', 'Quintus', 'Paso'].map((n) => {
      const i = testBM1.getSystemIndexByName(n);
      const ids = window.__all(i);
      return { n, count: ids.length, foreign: window.__foreign(ids, ['terran']) };
    }));
    for (const w of r) {
      assert.ok(w.count > 0, `${w.n} sells nothing`);
      assert.deepEqual(w.foreign, [], `${w.n} sells foreign hulls ${w.foreign}`);
    }
  });

  await check('preservation', 'FS-VARIATION two Terran worlds offer different selections from the same Terran pool', async () => {
    await fresh('fs-variation');
    const r = await ev(() => ['Earth', 'Paso', 'Quintus'].map((n) => ({ n, planet: window.__vendors(testBM1.getSystemIndexByName(n))[0].ids })));
    const [earth, paso, quintus] = r;
    assert.notDeepEqual(earth.planet, paso.planet);
    assert.notDeepEqual(paso.planet, quintus.planet);
    const eShip = (await ev((ids) => ids.map((id) => testBM1.getShipFaction(id)), [...earth.planet, ...paso.planet, ...quintus.planet]));
    assert.ok(eShip.every((f) => f === 'terran' || f === 'neutral'), JSON.stringify(eShip));
  });

  await check('preservation', 'FS-SPECIAL special non-shipyard stations stay non-vendors, under any holder, and cannot take a prize', async () => {
    await fresh('fs-special');
    const r = await ev(() => {
      const t = testBM1;
      const earth = window.__vendors(t.getSystemIndexByName('Earth')).filter((v) => /Comm|Research|Habitat|Bar|Defense Platform/.test(v.name || ''));
      const romulus = t.getSystemIndexByName('Romulus');
      t.transferSystemControlToPlayer(romulus);
      const held = window.__vendors(romulus).filter((v) => /Bar|Defense Platform|Habitat|Ore/.test(v.name || ''));
      const comm = t.state.stations.find((s) => /Bar/.test(t.getShipStats(s.stationTypeId)?.name || ''));
      const decision = t.prizeShelfDecision ? t.prizeShelfDecision({ shipId: 330, identity: { vid: 'x', history: [{ event: 'captured', from: 'klingon' }] } }, comm) : { ok: false, reason: 'no prize shelf' };
      return { earth, held, decision };
    });
    assert.ok(r.earth.length >= 5);
    for (const v of [...r.earth, ...r.held]) {
      assert.equal(v.sell, false, `${v.name} sells ships`);
      assert.deepEqual(v.ids, [], `${v.name} lists ${v.ids}`);
    }
    assert.equal(r.decision.ok, false, 'a bar took a prize hull');
  });

  // ---------------- occupied worlds and captured industry ----------------
  await check('baseline-defect', 'FS-MINOR-OUTPOST capturing a minor enemy world does not unlock its warship production, even after the integration period', async () => {
    await fresh('fs-minor');
    const r = await ev(() => {
      const t = testBM1, book = t.campaign();
      const virinat = t.getSystemIndexByName('Virinat'), xonok = t.getSystemIndexByName('Xonok');
      const before = window.__all(virinat);
      t.transferSystemControlToPlayer(virinat); t.transferSystemControlToPlayer(xonok);
      const now = { virinat: window.__all(virinat), xonok: window.__all(xonok) };
      window.__integrate(book.config.integrationDays + 3);
      const later = { virinat: window.__all(virinat), xonok: window.__all(xonok) };
      const q = book.polities.player.integrations[virinat]?.qualification;
      return { before: window.__military(before, 'romulan'), now: { r: window.__military(now.virinat, 'romulan'), k: window.__military(now.xonok, 'klingon') },
        later: { r: window.__military(later.virinat, 'romulan'), k: window.__military(later.xonok, 'klingon') }, qualifies: q?.qualifies, held: t.getSystemControl(virinat).playerControlled };
    });
    assert.ok(r.before.length > 0, 'precondition: Virinat sells no Romulan warships under the Romulans');
    assert.equal(r.qualifies, false, 'precondition: Virinat counts as a major world');
    assert.deepEqual(r.now.r, [], `captured Virinat sells Romulan warships ${r.now.r}`);
    assert.deepEqual(r.now.k, [], `captured Xonok sells Klingon warships ${r.now.k}`);
    if (r.held) assert.deepEqual(r.later.r, [], `Virinat sells Romulan warships after the integration period ${r.later.r}`);
    assert.deepEqual(r.later.k, [], `Xonok sells Klingon warships after the integration period ${r.later.k}`);
  });

  await check('baseline-defect', 'FS-MAJOR-PENDING a captured major world does not sell the former owner\'s warships before its yards are integrated — at any vendor, private yards included', async () => {
    await fresh('fs-major-pending');
    const r = await ev(() => {
      const t = testBM1, romulus = t.getSystemIndexByName('Romulus');
      t.transferSystemControlToPlayer(romulus);
      const vendors = window.__vendors(romulus).map((v) => ({ name: v.name || v.vendor, owner: v.owner, military: window.__military(v.ids, 'romulan'), civilian: v.ids.filter((id) => t.getShipFaction(id) === 'romulan' && window.__civilian(id)) }));
      return { vendors, qualifies: t.campaign().polities.player.integrations[romulus]?.qualification?.qualifies };
    });
    assert.equal(r.qualifies, true, 'precondition: Romulus is not a major world');
    for (const v of r.vendors) assert.deepEqual(v.military, [], `${v.name} (${v.owner}) sells Romulan warships ${v.military} before integration`);
    assert.ok(r.vendors.some((v) => v.civilian.length), 'the local Romulan civilian industry vanished with the change of flag');
  });

  await check('preservation', 'FS-MAJOR-INTEGRATED once the holder integrates a captured major world, its yards offer permitted former-owner designs, and only those', async () => {
    await fresh('fs-major-integrated');
    const r = await ev(() => {
      const t = testBM1, book = t.campaign(), romulus = t.getSystemIndexByName('Romulus');
      t.transferSystemControlToPlayer(romulus);
      window.__integrate(book.config.integrationDays + 3);
      const integ = book.polities.player.integrations[romulus];
      const ids = window.__all(romulus);
      const military = window.__military(ids, 'romulan');
      const restricted = (integ?.designs || []).filter((id) => !t.isRecoverableIndustrialDesign(id));
      return { held: t.getSystemControl(romulus).playerControlled, completed: integ?.completedDay || null, designs: integ?.designs || [], military, restricted,
        outside: military.filter((id) => !(integ?.designs || []).includes(id)), foreign: window.__foreign(ids, ['romulan']) };
    });
    assert.ok(r.held, 'precondition: Romulus was lost during the integration period');
    assert.ok(r.completed, 'precondition: integration did not complete');
    assert.ok(r.military.length > 0, 'an integrated major world offers none of the former owner\'s designs');
    assert.deepEqual(r.outside, [], `offered designs outside the integration ${r.outside}`);
    assert.deepEqual(r.restricted, [], `integration includes restricted designs ${r.restricted}`);
    assert.deepEqual(r.foreign, [], `Romulus sells other powers\' hulls ${r.foreign}`);
  });

  await check('baseline-defect', 'FS-RECLAIM retaking the world restores its own market; recapturing it restarts integration rather than restoring the old access', async () => {
    await fresh('fs-reclaim');
    const r = await ev(() => {
      const t = testBM1, book = t.campaign(), romulus = t.getSystemIndexByName('Romulus');
      const own = window.__military(window.__all(romulus), 'romulan');
      t.transferSystemControlToPlayer(romulus);
      window.__integrate(book.config.integrationDays + 3);
      const integrated = window.__military(window.__all(romulus), 'romulan');
      t.transferSystemControlToFaction(romulus, 'romulan');
      const retaken = window.__military(window.__all(romulus), 'romulan');
      const occupiedAfterRetake = t.occupiedMarket ? t.occupiedMarket(romulus) : 'n/a';
      t.transferSystemControlToPlayer(romulus);
      const recaptured = window.__military(window.__all(romulus), 'romulan');
      return { own, integrated, retaken, recaptured, occupiedAfterRetake, completedAfterRecapture: book.polities.player.integrations[romulus]?.completedDay || null };
    });
    assert.ok(r.own.length > 0);
    assert.ok(r.integrated.length > 0, 'precondition: no access after integration');
    assert.deepEqual(r.retaken.slice().sort(), r.own.slice().sort(), 'the retaken world does not sell what it sold before it was taken');
    assert.deepEqual(r.recaptured, [], `recapture restored warship access at once ${r.recaptured}`);
    assert.equal(r.completedAfterRecapture, null, 'a fresh capture kept the old integration');
    assert.equal(r.occupiedAfterRetake, null);
  });

  await check('baseline-defect', 'FS-FLAG raising the former owner\'s flag does not unlock its production at a held world, or anywhere else', async () => {
    await fresh('fs-flag');
    const r = await ev(() => {
      const t = testBM1, s = t.state, virinat = t.getSystemIndexByName('Virinat'), earth = t.getSystemIndexByName('Earth');
      t.transferSystemControlToPlayer(virinat);
      s.playerFlags = [...new Set([...(s.playerFlags || []), 'romulan'])];
      t.raisePlayerFlag('romulan');
      return { flag: t.getPlayerFlag(), virinat: window.__military(window.__all(virinat), 'romulan'), earth: window.__foreign(window.__all(earth), ['terran']) };
    });
    assert.equal(r.flag, 'romulan', 'precondition: the flag did not change');
    assert.deepEqual(r.virinat, [], `the Romulan flag unlocked Romulan warships at held Virinat ${r.virinat}`);
    assert.deepEqual(r.earth, [], `the Romulan flag put foreign hulls on Earth\'s shelves ${r.earth}`);
  });

  await check('preservation', 'FS-SAME-FLAG a world held by the government whose flag the captain flies is that government\'s market, not the captain\'s', async () => {
    await fresh('fs-same-flag');
    const r = await ev(() => {
      const t = testBM1, s = t.state, chaltok = t.getSystemIndexByName('Chaltok');
      const underTerran = window.__all(chaltok);
      s.playerFlags = [...new Set([...(s.playerFlags || []), 'romulan'])];
      t.raisePlayerFlag('romulan');
      const underRomulan = window.__all(chaltok);
      return { flag: t.getPlayerFlag(), same: JSON.stringify(underTerran) === JSON.stringify(underRomulan), own: t.isOwnHoldingVendor(null, chaltok), holder: t.getSystemControl(chaltok).controller, controlled: t.getSystemControl(chaltok).playerControlled };
    });
    assert.equal(r.flag, 'romulan');
    assert.equal(r.own, false, 'a same-flag Romulan world is treated as the captain\'s own vendor');
    assert.equal(r.controlled, false);
    assert.equal(r.holder, 'romulan');
    assert.ok(r.same, 'the Romulan world\'s shelf changed with the captain\'s flag');
  });

  await check('baseline-defect', 'FS-RESTRICTED rare, prototype and special-vendor hulls stay restricted: an occupier never inherits Project X, integrated or not', async () => {
    await fresh('fs-restricted');
    const r = await ev(() => {
      const t = testBM1, book = t.campaign(), paso = t.getSystemIndexByName('Paso');
      const terranHeld = window.__all(paso).filter((id) => [49, 347].includes(id));
      t.transferSystemControlToFaction(paso, 'klingon');
      const occupied = window.__all(paso).filter((id) => [49, 347].includes(id));
      // Even a completed integration by the occupier (forced, since Paso is not a major world) cannot pass them on.
      book.polities.klingon.integrations[paso] = { sourceFaction: 'terran', startedDay: 1, progress: 99, completedDay: 2, qualification: { qualifies: true }, designs: [49, 347, 305] };
      const forced = window.__all(paso);
      return { terranHeld, occupied, forcedX: forced.filter((id) => [49, 347].includes(id)), forcedIndustrial: forced.includes(305) || !t.isRecoverableIndustrialDesign(305), klingon: window.__foreign(forced, ['terran']) };
    });
    assert.deepEqual(r.terranHeld.sort(), [347, 49].sort(), 'precondition: X-Base does not sell Project X under the Terrans');
    assert.deepEqual(r.occupied, [], `Klingon-held Paso sells Project X ${r.occupied}`);
    assert.deepEqual(r.forcedX, [], `an integration passed Project X to the occupier ${r.forcedX}`);
    assert.deepEqual(r.klingon, [], `the occupier's own hulls appeared at an occupied Terran world ${r.klingon}`);
  });

  // ---------------- prize hulls ----------------
  await check('new-feature', 'PRIZE-SHELVE a captured hull sold at a yard goes onto that yard\'s prize shelf as the same vessel: same vid, origin and provenance, in one place only', async () => {
    await fresh('prize-shelve');
    const r = await ev(() => {
      const t = testBM1, s = t.state;
      const cap = window.__capturePrize('klingon');
      if (!cap) return { fail: 'precondition: no capture' };
      const { record } = cap;
      const identity = JSON.parse(JSON.stringify(record.identity));
      const yard = s.stations.find((st) => /Human Shipyard/.test(t.getShipStats(st.stationTypeId)?.name || '') && t.getStationOwner(st) === 'terran');
      window.__dockAt(yard.id, record.id);
      const hull = t.fleetLocalActor(record.id).combatHull / t.fleetLocalActor(record.id).maxCombatHull;
      const sold = t.sellFleetVessel(record.id, false);
      const shelf = t.prizeShelf ? t.prizeShelf(yard) : null;
      const found = t.findStrategicVessel(identity.vid);
      return { fail: null, sold, identity, hull, shelf: shelf && shelf.map((p) => ({ vid: p.vid, id: p.id, name: p.name, origin: p.identity.origin, hull: p.vessel.hull / p.vessel.maxHull })),
        found: found && { status: found.status, kind: found.kind, holder: found.holder }, retired: t.Identity.retiredVessel(t.campaign(), identity.vid), count: window.__vidCount(identity.vid), inFleet: s.playerFleet.some((f) => f.identity?.vid === identity.vid) };
    });
    assert.ok(!r.fail, r.fail);
    assert.ok(r.sold, 'the sale did not go through');
    assert.ok(r.shelf, 'no prize shelf');
    assert.equal(r.shelf.length, 1, `the yard holds ${r.shelf.length} prizes`);
    assert.equal(r.shelf[0].vid, r.identity.vid);
    assert.equal(r.shelf[0].name, r.identity.name);
    assert.deepEqual(r.shelf[0].origin, r.identity.origin, 'the prize\'s origin changed on the shelf');
    assert.equal(r.shelf[0].origin.builder, 'klingon');
    assert.ok(Math.abs(r.shelf[0].hull - r.hull) < 1e-6, 'the hull was repaired on the shelf');
    assert.equal(r.retired, null, 'the prize was retired instead of shelved');
    assert.deepEqual(r.found, { status: 'active', kind: 'prize', holder: 'terran' });
    assert.equal(r.inFleet, false);
    assert.equal(r.count, 1, `the vessel is in ${r.count} places`);
  });

  await check('new-feature', 'PRIZE-BUY buying the prize moves that exact hull to the fleet: same vid, name, seed, origin, hull state; the shelf is empty and nothing regrows it', async () => {
    await fresh('prize-buy');
    const r = await ev(() => {
      const t = testBM1, s = t.state;
      const cap = window.__capturePrize('klingon');
      if (!cap) return { fail: 'precondition: no capture' };
      const identity = JSON.parse(JSON.stringify(cap.record.identity));
      const yard = s.stations.find((st) => /Human Shipyard/.test(t.getShipStats(st.stationTypeId)?.name || '') && t.getStationOwner(st) === 'terran');
      window.__dockAt(yard.id, cap.record.id);
      t.sellFleetVessel(cap.record.id, false);
      if (!t.prizeShelf) return { fail: 'no prize shelf' };
      const entry = t.prizeShelf(yard)[0];
      const shelfHull = entry.vessel.hull;
      s.latinum = 1e7;
      const price = t.prizePrice(entry);
      const before = s.latinum;
      const bought = t.buyPrize(entry.id);
      const paid = before - s.latinum;
      const rec = s.playerFleet.find((f) => f.identity?.vid === identity.vid);
      const actor = rec && t.fleetLocalActor(rec.id);
      const again = t.buyPrize(entry.id);
      window.__integrate(12);
      return { fail: null, identity, bought: Boolean(bought), price, paid, rec: rec && { vid: rec.identity.vid, name: rec.name, seed: rec.seed, shipId: rec.shipId, origin: rec.identity.origin, sameObject: rec.identity === entry.identity, events: rec.identity.history.map((h) => h.event) },
        actorHull: actor?.combatHull, shelfHull, shelfAfter: t.prizeShelf(yard).length, again, count: window.__vidCount(identity.vid), shelfLater: t.prizeShelf(yard).length };
    });
    assert.ok(!r.fail, r.fail);
    assert.ok(r.bought, 'the purchase failed');
    assert.equal(r.paid, r.price);
    assert.equal(r.rec.vid, r.identity.vid);
    assert.equal(r.rec.name, r.identity.name);
    assert.equal(r.rec.seed, r.identity.seed);
    assert.equal(r.rec.shipId, r.identity.shipId);
    assert.deepEqual(r.rec.origin, r.identity.origin);
    assert.ok(r.rec.sameObject, 'the fleet got a copy of the identity rather than the vessel\'s own');
    assert.deepEqual(r.rec.events.filter((e) => ['captured', 'sold', 'purchased'].includes(e)), ['captured', 'sold', 'purchased']);
    assert.ok(Math.abs(r.actorHull - r.shelfHull) < 1e-6, `the hull arrived at ${r.actorHull}, not the ${r.shelfHull} she was sold with`);
    assert.equal(r.shelfAfter, 0);
    assert.equal(r.again, false, 'the same prize was bought twice');
    assert.equal(r.count, 1, `the vessel is in ${r.count} places`);
    assert.equal(r.shelfLater, 0, 'the shelf regrew the prize');
  });

  await check('new-feature', 'PRIZE-RETIRED a destroyed prize never reaches a shelf; a yard lost with a prize retires it as lost, not destroyed; a full shelf sells the oldest on', async () => {
    await fresh('prize-retired');
    const r = await ev(() => {
      const t = testBM1, s = t.state;
      if (!t.prizeShelfDecision) return { fail: 'no prize shelf' };
      const cap = window.__capturePrize('klingon');
      if (!cap) return { fail: 'precondition: no capture' };
      const vid = cap.record.identity.vid;
      const actor = t.fleetLocalActor(cap.record.id);
      t.destroyNpcShip(actor);
      const retired = t.Identity.retiredVessel(t.campaign(), vid);
      const decision = t.prizeShelfDecision(cap.record, s.stations.find((st) => t.fleetStationServices(st).sell));
      const onShelf = (t.campaign().prizes || []).some((p) => p.vid === vid);
      // Seven prizes at one yard (synthetic records through the real shelving path): the oldest is sold on.
      const yard = s.stations.find((st) => /Human Shipyard/.test(t.getShipStats(st.stationTypeId)?.name || '') && t.getStationOwner(st) === 'terran');
      window.__dockAt(yard.id);
      const vids = [];
      for (let i = 0; i < 7; i++) {
        const idn = t.Identity.makeIdentity({ vid: `test-prize:${i}`, shipId: 351, name: `IKS Test ${i}`, builder: 'klingon', via: 'captured' });
        t.Identity.recordProvenance(idn, { day: s.day, event: 'captured', from: 'klingon', to: 'player' });
        const rec = { id: `tp${i}`, shipId: 351, name: idn.name, seed: idn.seed, identity: idn, takenFrom: 'klingon', assignment: 'escort', systemIndex: s.currentPlanet, faction: s.playerFaction };
        s.playerFleet.push(rec);
        s.npcShips.push(...t.getPlayerEscortNpcShips().filter((n) => n.fleetId === rec.id));
        const actorI = t.fleetLocalActor(rec.id);
        if (actorI) { actorI.x = yard.x + 50; actorI.y = yard.y; actorI.lastShieldHitAt = 0; if (actorI.power) actorI.power.combat = false; }
        t.sellFleetVessel(rec.id, false);
        vids.push(idn.vid);
        s.day += 1;
      }
      const shelf = t.prizeShelf(yard).map((p) => p.vid);
      const oldest = t.Identity.retiredVessel(t.campaign(), vids[0]);
      // The yard is destroyed with prizes on its shelf, through the real destruction path.
      s.docked = false; s.dockedStationId = null;
      t.destroyStation(yard);
      t.sweepPrizeShelves();
      const lost = t.Identity.retiredVessel(t.campaign(), vids[6]);
      t.saveGame(9); t.startWithFaction('ferengi'); t.loadGame(9);
      const reloaded = { destroyedActive: window.__vidCount(vid), lostActive: window.__vidCount(vids[6]), prizes: (t.campaign().prizes || []).length };
      return { fail: null, retired: retired?.cause, decision: decision.ok, onShelf, shelf, oldest: oldest?.cause, lost: lost?.cause, reloaded };
    });
    assert.ok(!r.fail, r.fail);
    assert.equal(r.retired, 'destroyed');
    assert.equal(r.decision, false, 'a destroyed hull may be shelved');
    assert.equal(r.onShelf, false);
    assert.equal(r.shelf.length, 6, `the shelf holds ${r.shelf.length}`);
    assert.equal(r.oldest, 'sold-on');
    assert.equal(r.lost, 'lost-with-yard');
    assert.deepEqual(r.reloaded, { destroyedActive: 0, lostActive: 0, prizes: 0 });
  });

  await check('preservation', 'PRIZE-ORDINARY an ordinary bought escort sold at a yard is still a sink: retired as sold, no shelf entry', async () => {
    await fresh('prize-ordinary');
    const r = await ev(() => {
      const t = testBM1, s = t.state;
      s.docked = true; s.latinum = 1e7; s.mylatinum = s.latinum;
      const yard = s.stations.find((st) => /Human Shipyard/.test(t.getShipStats(st.stationTypeId)?.name || '') && t.getStationOwner(st) === 'terran');
      window.__dockAt(yard.id);
      const offer = t.getShipyardStock(yard)[0];
      t.fleetShipStock(offer.id).quantity = 5;
      t.adjustFactionStanding('terran', 100, { silent: true });
      t.buyEscortShip(offer.id);
      const rec = s.playerFleet[s.playerFleet.length - 1];
      window.__dockAt(yard.id, rec.id);
      const vid = rec.identity.vid;
      t.sellFleetVessel(rec.id, false);
      return { cause: t.Identity.retiredVessel(t.campaign(), vid)?.cause, prizes: (t.campaign().prizes || []).length, count: window.__vidCount(vid) };
    });
    assert.equal(r.cause, 'sold');
    assert.equal(r.prizes, 0);
    assert.equal(r.count, 0);
  });

  await check('new-feature', 'FS-SAVELOAD captured-market state, the prize shelf and vessel provenance survive save/load', async () => {
    await fresh('fs-saveload');
    const r = await ev(() => {
      const t = testBM1, s = t.state, book = t.campaign(), romulus = t.getSystemIndexByName('Romulus');
      if (!t.prizeShelf) return { fail: 'no prize shelf' };
      const cap = window.__capturePrize('klingon');
      if (!cap) return { fail: 'precondition: no capture' };
      const vid = cap.record.identity.vid;
      const yard = s.stations.find((st) => /Human Shipyard/.test(t.getShipStats(st.stationTypeId)?.name || '') && t.getStationOwner(st) === 'terran');
      window.__dockAt(yard.id, cap.record.id);
      t.sellFleetVessel(cap.record.id, false);
      s.docked = false; s.dockedStationId = null;
      t.transferSystemControlToPlayer(romulus);
      window.__integrate(book.config.integrationDays + 3);
      const read = () => {
        const p = (t.campaign().prizes || []).find((x) => x.vid === vid);
        return JSON.stringify({ market: window.__all(romulus), occupied: (() => { const o = t.occupiedMarket(romulus); return o && { origin: o.origin, holder: o.holder, day: o.integratedDay, designs: [...o.designs].sort() }; })(),
          prize: p && { vid: p.vid, name: p.name, hull: p.vessel.hull, identity: p.identity, vendor: p.vendorKey }, prov: t.vesselProvenance(vid) });
      };
      const before = read();
      t.saveGame(8); t.startWithFaction('ferengi'); t.loadGame(8);
      return { fail: null, before, after: read(), integrated: Boolean(JSON.parse(before).occupied?.day) };
    });
    assert.ok(!r.fail, r.fail);
    assert.ok(r.integrated, 'precondition: Romulus did not integrate');
    assert.equal(r.after, r.before);
  });

  // ---------------- screenshots ----------------
  await check('new-feature', 'FS-SHOTS normal faction market, captured-major-world market and a prize hull offered and transferred', async () => {
    await fresh('fs-shots');
    await ev(() => { const t = testBM1, s = t.state; s.currentPlanet = t.getSystemIndexByName('Earth'); t.applySystemState(s.currentPlanet); const yard = s.stations.find((st) => /Human Shipyard/.test(t.getShipStats(st.stationTypeId)?.name || '') && t.getStationOwner(st) === 'terran'); window.__openMarket(yard.id); document.querySelector('.market-section .shipyard')?.scrollIntoView({ block: 'start' }); });
    await page.screenshot({ path: path.join(out, 'market-normal-terran.png') });
    await ev(() => window.__closeMarket());
    const prize = await ev(() => {
      const t = testBM1, s = t.state;
      if (!t.prizeShelf) return null;
      const cap = window.__capturePrize('klingon');
      const yard = s.stations.find((st) => /Human Shipyard/.test(t.getShipStats(st.stationTypeId)?.name || '') && t.getStationOwner(st) === 'terran');
      window.__dockAt(yard.id, cap.record.id);
      t.sellFleetVessel(cap.record.id, false);
      s.latinum = 5e6;
      window.__openMarket(yard.id);
      document.querySelector('.prize-head')?.scrollIntoView({ block: 'start' });
      return { yard: yard.id, id: t.prizeShelf(yard)[0]?.id, vid: cap.record.identity.vid };
    });
    await page.screenshot({ path: path.join(out, 'market-prize-offered.png') });
    if (prize) {
      await page.click(`[data-prize-buy="${prize.id}"]`);
      await ev(() => { const t = testBM1; window.__closeMarket(); t.renderFleetManager(true); for (const d of document.querySelectorAll('.fleet-manager details')) d.open = true; });
      await page.screenshot({ path: path.join(out, 'market-prize-transferred.png') });
      const moved = await ev((vid) => ({ fleet: testBM1.state.playerFleet.some((f) => f.identity?.vid === vid), lines: [...document.querySelectorAll('.fleet-manager .fleet-identity')].map((e) => e.textContent) }), prize.vid);
      await ev(() => document.querySelector('.fleet-manager')?.close());
      assert.ok(moved.fleet, 'clicking Buy did not move the hull');
      assert.ok(moved.lines.some((l) => /taken from Klingon/.test(l)), 'the transferred hull lost her capture provenance');
    }
    const romulusShot = async (file) => {
      await ev(() => { window.__openPlanet(); document.querySelector('.occupied-market')?.scrollIntoView({ block: 'start' }); });
      await page.screenshot({ path: path.join(out, file) });
      const shown = await ev(() => window.__military(testBM1.getShipyardStock(null).map((x) => Number(x.id)), 'romulan'));
      await ev(() => window.__closeMarket());
      return shown;
    };
    await ev(() => {
      const t = testBM1, s = t.state, romulus = t.getSystemIndexByName('Romulus');
      s.docked = false; s.dockedStationId = null;
      s.currentPlanet = romulus; s.myplanet = romulus + 1; t.applySystemState(romulus);
      t.transferSystemControlToPlayer(romulus);
    });
    const pending = await romulusShot('market-captured-major-romulus-pending.png');
    await ev(() => {
      const t = testBM1, s = t.state, romulus = t.getSystemIndexByName('Romulus');
      window.__integrate(t.campaign().config.integrationDays + 3);
      s.currentPlanet = romulus; s.myplanet = romulus + 1; t.applySystemState(romulus);
    });
    const integrated = await romulusShot('market-captured-major-romulus-integrated.png');
    assert.deepEqual(pending, [], 'Romulan warships on the shelf before integration');
    assert.ok(integrated.length > 0, 'no Romulan design on the integrated shelf');
    assert.ok(prize, 'no prize shelf to show');
  });

  await probe.close();
  const cats = {};
  for (const r of results) { cats[r.category] ||= { pass: 0, total: 0 }; cats[r.category].total++; if (r.ok) cats[r.category].pass++; }
  console.log('\nSummary by category:');
  for (const [c, v] of Object.entries(cats)) console.log(`  ${c}: ${v.pass}/${v.total}`);
  const failed = results.filter((r) => !r.ok);
  console.log(`${results.length - failed.length}/${results.length} foreign-stock checks passed.`);
  process.exit(failed.length ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
