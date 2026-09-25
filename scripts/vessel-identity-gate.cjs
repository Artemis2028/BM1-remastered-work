// Gate for persistent strategic vessel identity, stacked on 2d6b4e5.
//
// One vessel stays one vessel — the same vid, design, name, seed and origin — through purchase,
// capture, command transfer, formation assignment, travel, disablement, repair, save/load and a change
// of flag. Ownership and allegiance live on the record that holds her and never rewrite where the hull
// came from. Categories as in section6-verification-gate.cjs:
//   baseline-defect  reproduces a wrong behaviour of 2d6b4e5
//   new-feature      needs identity, which 2d6b4e5 does not have (fails its precondition there)
//   preservation     must hold on both
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
    // Two escorts of one class bought at the captain's yard, through the real purchase path.
    window.__buyTwins = () => {
      const t = testBM1, s = t.state;
      s.docked = true; s.latinum = 1e7; s.mylatinum = s.latinum;
      const offer = t.getShipyardStock()[0];
      if (!offer) return null;
      t.fleetShipStock(offer.id).quantity = 5;
      t.adjustFactionStanding(t.getCurrentPurchaseVendor().standingFaction, 100, { silent: true });
      const before = s.playerFleet.length;
      t.buyEscortShip(offer.id); t.buyEscortShip(offer.id);
      const bought = s.playerFleet.slice(before);
      return { offer: offer.id, bought };
    };
    // A real campaign hull of a faction, materialised in the captain's system by the operation path.
    window.__materialise = (faction = 'klingon', count = 1, excludeIds = []) => {
      const t = testBM1, s = t.state, book = t.campaign();
      const p = book.polities[faction];
      const hulls = p.hulls.filter((h) => h.status === 'ready' && !h.opId && !excludeIds.includes(h.id)).slice(0, count);
      if (!hulls.length) return null;
      s.activeFleetAttack = null;
      const effects = [];
      const op = t.Campaign.launchOperation(book, t.buildCampaignWorld(true), faction, hulls, Number(s.currentPlanet), s.day, 0, 'raid', effects);
      op.status = 'engaged'; op.engagedDay = s.day; op.arriveDay = s.day;
      for (const h of hulls) h.systemIndex = Number(s.currentPlanet);
      const claim = t.Campaign.claimOperationForScene(book, op.id);
      op.spawnedHullIds = [];
      t.spawnCampaignOperation(op, claim.hulls, 0);
      const npcs = hulls.map((h) => s.npcShips.find((n) => n.campaignHullId === h.id));
      return { op, hulls, npcs };
    };
    // Take a disabled NPC with a boarding party that has already won: the capture branch of the real
    // boarding code runs from here.
    window.__capture = (npc) => {
      const t = testBM1, s = t.state, b = t.fleetBook();
      t.ensureNpcCombatStats(npc);
      npc.combatHull = Math.max(1, Math.floor(t.Fleet.disableThreshold(npc.maxCombatHull) * 0.5));
      t.applyVesselDisablement(npc);
      t.setCamera(npc.x + 50, npc.y);
      b.team.available = false;
      b.boarding = { id: t.Fleet.nextId(b, 'boarding'), targetId: t.physicalNpcId(npc), sourceId: b.personalId, phase: 'onboard', remaining: 0.1, xp: 50, resistance: 'light', chance: 90, roll: 1, algorithm: 2 };
      t.updateBoarding(1);
      return s.playerFleet.find((f) => f.shipId === npc.shipId && f.assignment === 'escort' && f.name === npc.name) || s.playerFleet[s.playerFleet.length - 1];
    };
    window.__vidCount = (vid) => {
      const t = testBM1, s = t.state, book = t.campaign();
      let n = 0;
      for (const [id, p] of Object.entries(book.polities)) if (id !== 'player') n += p.hulls.filter((h) => h.status !== 'lost' && (h.identity?.vid || h.id) === vid).length;
      n += s.playerFleet.filter((f) => !f.destroyed && f.identity?.vid === vid).length;
      if (t.fleetBook().personalIdentity?.vid === vid) n++;
      return n;
    };
  });

  await check('new-feature', 'IDENT-TWINS two ships of the same class bought the same way are two vessels, and stay distinct through damage and save/load', async () => {
    await fresh('ident-twins');
    const r = await ev(() => {
      const t = testBM1, s = t.state;
      const bought = window.__buyTwins();
      if (!bought || bought.bought.length !== 2) return { fail: `precondition: bought ${bought?.bought?.length ?? 0}` };
      const [a, b] = bought.bought;
      if (!a.identity || !b.identity) return { fail: 'purchased ships carry no identity' };
      // Damage lands on the escort in the scene, as it would in a fight; the save captures it.
      const actorA = t.fleetLocalActor(a.id);
      t.ensureNpcCombatStats(actorA);
      actorA.combatHull = Math.round(actorA.maxCombatHull * 0.4);
      t.captureShipPowerState();
      const before = { a: JSON.stringify(a.identity), b: JSON.stringify(b.identity), hullA: a.vessel.hull };
      t.saveGame(6); t.startWithFaction('terran'); t.loadGame(6);
      const A = s.playerFleet.find((f) => f.identity?.vid === JSON.parse(before.a).vid), B = s.playerFleet.find((f) => f.identity?.vid === JSON.parse(before.b).vid);
      return { fail: null, same: a.shipId === b.shipId, vids: [a.identity.vid, b.identity.vid], names: [a.identity.name, b.identity.name], seeds: [a.identity.seed, b.identity.seed],
        origin: a.identity.origin, after: { a: JSON.stringify(A?.identity), b: JSON.stringify(B?.identity), hullA: A?.vessel?.hull, hullB: B?.vessel?.hull, max: B?.vessel?.maxHull }, before };
    });
    assert.ok(!r.fail, r.fail);
    assert.ok(r.same, 'precondition: not the same class');
    assert.notEqual(r.vids[0], r.vids[1]);
    assert.notEqual(r.seeds[0], r.seeds[1], 'identical twins share a seed');
    assert.equal(r.origin.via, 'purchased');
    assert.equal(r.after.a, r.before.a, 'the first ship\'s identity changed across the save');
    assert.equal(r.after.b, r.before.b, 'the second ship\'s identity changed across the save');
    assert.equal(r.after.hullA, r.before.hullA, 'the damage moved to a different vessel');
    assert.ok(r.after.hullB === undefined || r.after.hullB === r.after.max, 'the undamaged twin picked up damage');
  });

  await check('baseline-defect', 'IDENT-MATERIALISE a faction hull is the same ship every time it is materialised: same name and seed in two different operations', async () => {
    await fresh('ident-mat');
    const r = await ev(() => {
      const t = testBM1, s = t.state;
      const first = window.__materialise('klingon', 1);
      if (!first || !first.npcs[0]) return { fail: 'precondition: nothing materialised' };
      const h = first.hulls[0];
      const a = { name: first.npcs[0].name, seed: first.npcs[0].seed };
      t.releaseLocalCampaignBattle();
      s.npcShips = s.npcShips.filter((n) => n.campaignHullId !== h.id);
      s.activeFleetAttack = null;
      // The same hull, in a new operation.
      h.opId = null; h.status = 'ready';
      const book = t.campaign();
      const effects = [];
      const op2 = t.Campaign.launchOperation(book, t.buildCampaignWorld(true), 'klingon', [h], Number(s.currentPlanet), s.day, 0, 'skirmish', effects);
      op2.status = 'engaged'; op2.engagedDay = s.day; op2.arriveDay = s.day;
      const claim = t.Campaign.claimOperationForScene(book, op2.id);
      op2.spawnedHullIds = [];
      t.spawnCampaignOperation(op2, claim.hulls, 0);
      const npc = s.npcShips.find((n) => n.campaignHullId === h.id);
      return { fail: null, a, b: { name: npc?.name, seed: npc?.seed }, ops: [first.op.id, op2.id], identity: h.identity || null };
    });
    assert.ok(!r.fail, r.fail);
    assert.notEqual(r.ops[0], r.ops[1]);
    assert.deepEqual(r.b, r.a, `the hull came back as a different ship: ${JSON.stringify(r.a)} then ${JSON.stringify(r.b)}`);
    assert.ok(r.identity && r.identity.name === r.a.name, 'the hull\'s identity does not record the name it is seen under');
  });

  await check('baseline-defect', 'IDENT-CAPTURE a captured campaign hull becomes the captain\'s with the same identity, leaves its faction\'s books alive, and exists exactly once', async () => {
    await fresh('ident-capture');
    const r = await ev(() => {
      const t = testBM1, s = t.state;
      const m = window.__materialise('klingon', 2);
      if (!m || !m.npcs[0]) return { fail: 'precondition: nothing materialised' };
      const [h] = m.hulls, npc = m.npcs[0];
      const seen = { name: npc.name, seed: npc.seed, vid: h.id, origin: JSON.stringify(h.identity?.origin || null) };
      const record = window.__capture(npc);
      const report = t.campaignSurvivorReport(m.op);
      const book = t.campaign();
      const hull = book.polities.klingon.hulls.find((x) => x.id === h.id);
      return { fail: null, seen, record: record ? { vid: record.identity?.vid, name: record.name, seed: record.seed, origin: JSON.stringify(record.identity?.origin || null), takenFrom: record.takenFrom } : null,
        survivorHasIt: report.some((x) => x.hullId === h.id), hullStatus: hull?.status, fate: hull?.fate, count: window.__vidCount(h.id),
        provenance: t.vesselProvenance ? t.vesselProvenance(h.id) : null };
    });
    assert.ok(!r.fail, r.fail);
    assert.ok(r.record, 'no capture record');
    assert.equal(r.record.vid, r.seen.vid, `captured, she became a new vessel: ${r.record.vid} instead of ${r.seen.vid}`);
    assert.equal(r.record.name, r.seen.name);
    assert.equal(r.record.seed, r.seen.seed);
    assert.equal(r.record.origin, r.seen.origin, 'capture rewrote where the hull came from');
    assert.equal(r.record.takenFrom, 'klingon');
    assert.equal(r.survivorHasIt, false, 'the operation still counts the captured hull among its survivors');
    assert.equal(r.hullStatus, 'lost'); assert.equal(r.fate, 'captured');
    assert.equal(r.count, 1, `the vessel exists ${r.count} times`);
    assert.equal(r.provenance.takenFrom, 'klingon');
    assert.equal(r.provenance.status, 'active');
    assert.equal(r.provenance.holder, 'player');
  });

  await check('baseline-defect', 'IDENT-FLAG raising another flag changes allegiance only: same record objects, names, seeds and origins; a captured ship keeps her name', async () => {
    await fresh('ident-flag');
    const r = await ev(() => {
      const t = testBM1, s = t.state;
      const twins = window.__buyTwins();
      const m = window.__materialise('klingon', 1);
      const prize = window.__capture(m.npcs[0]);
      const refs = s.playerFleet.slice();
      const before = refs.map((f) => ({ id: f.id, name: f.name, seed: f.seed, identity: JSON.stringify(f.identity || null) }));
      s.playerFlags = [...new Set([...(s.playerFlags || []), 'romulan'])];
      t.raisePlayerFlag('romulan');
      t.saveGame(5); // a save used to replace every fleet record object
      const after = s.playerFleet.map((f) => ({ id: f.id, name: f.name, seed: f.seed, identity: JSON.stringify(f.identity || null) }));
      const sameObjects = refs.every((f, i) => s.playerFleet[i] === f);
      const flags = s.playerFleet.map((f) => f.faction);
      // In the scene, the escort flies under the name she has.
      const actor = s.npcShips.find((n) => n.fleetId === prize.id);
      return { before, after, sameObjects, flags, flag: s.playerFaction, prizeName: prize.name, actorName: actor?.name };
    });
    assert.equal(r.flag, 'romulan', 'precondition: the flag did not change');
    assert.ok(r.flags.every((f) => f === 'romulan'), 'allegiance did not follow the flag');
    assert.equal(r.sameObjects, true, 'a flag change or a save replaced fleet record objects');
    assert.deepEqual(r.after.map((x) => x.name), r.before.map((x) => x.name), 'a flag change renamed a vessel');
    assert.deepEqual(r.after.map((x) => x.identity), r.before.map((x) => x.identity), 'a flag change rewrote an identity');
    assert.ok(!r.actorName || r.actorName === r.prizeName, `in the scene the prize flies as "${r.actorName}", not "${r.prizeName}"`);
  });

  await check('new-feature', 'IDENT-TRANSFER command transfer swaps the vessels\' roles, not their identities; transferring back restores both', async () => {
    await fresh('ident-transfer');
    const r = await ev(() => {
      const t = testBM1, s = t.state;
      const twins = window.__buyTwins();
      const f = twins.bought[0];
      const actor = t.fleetLocalActor(f.id);
      if (!actor) return { fail: 'precondition: no escort in the scene' };
      t.ensureNpcCombatStats(actor);
      const personal0 = JSON.stringify(t.ensurePersonalIdentity());
      const fleet0 = JSON.stringify(f.identity);
      t.setCamera(actor.x + 20, actor.y);
      if (!t.transferFleetCommand(f.id)) return { fail: 'precondition: transfer refused' };
      const personal1 = t.fleetBook().personalIdentity;
      const former = s.playerFleet.find((x) => x.identity?.vid === JSON.parse(personal0).vid);
      const mid = { personalVid: personal1.vid, formerVid: former?.identity?.vid, formerName: former?.name, shipName: s.shipName };
      const back = t.fleetLocalActor(former.id);
      t.setCamera(back.x + 20, back.y);
      back.condition = 'operational';
      const ok2 = t.transferFleetCommand(former.id);
      const personal2 = t.fleetBook().personalIdentity;
      const again = s.playerFleet.find((x) => x.identity?.vid === JSON.parse(fleet0).vid);
      return { fail: ok2 ? null : 'second transfer refused', personal0: JSON.parse(personal0), fleet0: JSON.parse(fleet0), mid, personal2Vid: personal2.vid, againVid: again?.identity?.vid,
        counts: [window.__vidCount(JSON.parse(personal0).vid), window.__vidCount(JSON.parse(fleet0).vid)] };
    });
    assert.ok(!r.fail, r.fail);
    assert.equal(r.mid.personalVid, r.fleet0.vid, 'the ship the captain took command of is not the vessel she was');
    assert.equal(r.mid.formerVid, r.personal0.vid, 'the ship the captain left is not the vessel she was');
    assert.equal(r.mid.formerName, r.personal0.name);
    assert.equal(r.personal2Vid, r.personal0.vid);
    assert.equal(r.againVid, r.fleet0.vid);
    assert.deepEqual(r.counts, [1, 1]);
  });

  await check('new-feature', 'IDENT-DESTROY a destroyed fleet ship and a destroyed faction hull are retired with their cause; a sold ship likewise; no vid returns', async () => {
    await fresh('ident-destroy');
    const r = await ev(() => {
      const t = testBM1, s = t.state;
      const twins = window.__buyTwins();
      const [a, b] = twins.bought;
      const vids = [a.identity.vid, b.identity.vid];
      const actor = t.fleetLocalActor(a.id);
      t.destroyNpcShip(actor);
      // B is sold at the yard.
      const bActor = t.fleetLocalActor(b.id);
      t.setCamera(bActor.x, bActor.y); bActor.power && (bActor.power.combat = false); bActor.lastShieldHitAt = 0;
      const sold = t.sellFleetVessel(b.id, false);
      // A faction hull destroyed and pruned by the campaign day.
      const book = t.campaign();
      const h = book.polities.romulan.hulls.find((x) => x.status === 'ready' && !x.opId);
      const hvid = h.id;
      h.status = 'lost'; h.hull = 0;
      t.advanceCampaign(s.day + 1);
      const more = window.__buyTwins();
      const newVids = more.bought.map((f) => f.identity.vid);
      return { vids, sold, a: t.findStrategicVessel(vids[0]), b: t.findStrategicVessel(vids[1]), h: t.findStrategicVessel(hvid), hvid, newVids,
        stillListed: book.polities.romulan.hulls.some((x) => x.id === hvid) };
    });
    assert.equal(r.a?.status, 'retired'); assert.equal(r.a.retired.cause, 'destroyed');
    assert.ok(r.sold, 'precondition: the sale was refused');
    assert.equal(r.b?.status, 'retired'); assert.equal(r.b.retired.cause, 'sold');
    assert.equal(r.stillListed, false, 'precondition: the lost hull was not pruned');
    assert.equal(r.h?.status, 'retired'); assert.equal(r.h.retired.cause, 'destroyed'); assert.equal(r.h.holder, 'romulan');
    assert.ok(r.newVids.every((v) => !r.vids.includes(v) && v !== r.hvid), 'a vid was reused');
  });

  await check('preservation', 'IDENT-REPAIR disablement and a paid yard repair leave the vessel\'s record and identity untouched', async () => {
    await fresh('ident-repair');
    const r = await ev(() => {
      const t = testBM1, s = t.state;
      const twins = window.__buyTwins();
      const f = twins.bought[0];
      const a = t.fleetLocalActor(f.id);
      t.ensureNpcCombatStats(a);
      const identity = JSON.stringify(f.identity || null);
      a.combatHull = Math.max(1, Math.floor(t.Fleet.disableThreshold(a.maxCombatHull) * 0.5));
      t.applyVesselDisablement(a);
      t.captureShipPowerState();
      s.docked = true; s.dockedStationId = null; t.setCamera(a.x, a.y); if (a.power) a.power.combat = false; a.lastShieldHitAt = 0;
      const repaired = t.repairFleetVessel(f.id);
      a.recoveryAt = t.gameNow() - 1; t.tickDisabledVessel(a, t.gameNow());
      t.captureShipPowerState();
      return { repaired, condition: a.condition, same: s.playerFleet.includes(f), identity, after: JSON.stringify(f.identity || null) };
    });
    assert.ok(r.repaired, 'precondition: repair refused');
    assert.equal(r.condition, 'operational');
    assert.equal(r.same, true);
    assert.equal(r.after, r.identity);
  });

  await check('preservation', 'IDENT-FORMATION formation assignment, dispatch and travel keep the same vessel; membership survives save/load', async () => {
    await fresh('ident-formation');
    const r = await ev(() => {
      const t = testBM1, s = t.state, b = t.fleetBook();
      const twins = window.__buyTwins();
      const f = twins.bought[0];
      for (const x of twins.bought) { x.assignment = 'defense'; x.systemIndex = s.currentPlanet; }
      const g = t.Fleet.addFormation(b, 'Gate Squadron');
      t.Fleet.assignFormation(b, f.id, g.id);
      const identity = JSON.stringify(f.identity || null);
      const dest = s.planets.findIndex((p, i) => i !== Number(s.currentPlanet) && t.isChartSystemVisible(i) && t.getPlottedRoute(s.currentPlanet, i));
      g.destination = dest;
      const dispatched = t.dispatchFleetFormation(g.id);
      for (let d = 0; d < 60 && f.transit; d++) { s.day += 1; t.completeFleetJourneys(); }
      const arrived = { at: Number(f.systemIndex), transit: Boolean(f.transit), same: s.playerFleet.includes(f), identity: JSON.stringify(f.identity || null) };
      t.saveGame(4); t.startWithFaction('terran'); t.loadGame(4);
      const g2 = t.fleetBook().formations.find((x) => x.name === 'Gate Squadron');
      const member = s.playerFleet.find((x) => g2?.members.includes(x.id));
      return { dispatched, dest, identity, arrived, reloaded: JSON.stringify(member?.identity || null) };
    });
    assert.ok(r.dispatched, 'precondition: dispatch refused');
    assert.equal(r.arrived.at, r.dest);
    assert.equal(r.arrived.same, true);
    assert.equal(r.arrived.identity, r.identity);
    assert.equal(r.reloaded, r.identity, 'after the reload the formation holds a different vessel');
  });

  await check('new-feature', 'IDENT-LEGACY a save written without identities migrates deterministically: the same vids on every load, names kept, legacy marked; campaign hulls too', async () => {
    await fresh('ident-legacy');
    const r = await ev(() => {
      const t = testBM1, s = t.state;
      const twins = window.__buyTwins();
      const m = window.__materialise('klingon', 1);
      window.__capture(m.npcs[0]);
      const names = s.playerFleet.map((f) => f.name);
      t.saveGame(3);
      // Strip every identity the save carries, as a save from 2d6b4e5 would be.
      const key = t.getSaveSlotKey(3);
      const raw = JSON.parse(localStorage.getItem(key));
      for (const f of raw.playerFleet || []) { delete f.identity; delete f.takenFrom; }
      delete raw.fleetBook.personalIdentity; delete raw.fleetBook.personalIdentityFor; delete raw.fleetBook.personalRetireCause;
      const cb = raw.playtest?.campaign;
      if (cb) { delete cb.identityVersion; delete cb.vesselRegistry; for (const p of Object.values(cb.polities || {})) for (const h of p.hulls || []) delete h.identity; }
      localStorage.setItem(key, JSON.stringify(raw));
      const read = () => ({ fleet: s.playerFleet.map((f) => JSON.stringify(f.identity)), personal: JSON.stringify(t.fleetBook().personalIdentity),
        hull: JSON.stringify(t.campaign().polities.romulan.hulls[0]?.identity), names: s.playerFleet.map((f) => f.name) });
      t.loadGame(3); const first = read();
      t.startWithFaction('terran'); t.loadGame(3); const second = read();
      return { names, first, second, legacyFlags: s.playerFleet.map((f) => f.identity?.origin?.legacy), personalLegacy: t.fleetBook().personalIdentity?.origin?.legacy, hullLegacy: t.campaign().polities.romulan.hulls[0]?.identity?.origin?.legacy };
    });
    assert.deepEqual(r.second, r.first, 'loading the same legacy save twice gave different vessels');
    assert.deepEqual(r.first.names, r.names, 'migration renamed a vessel');
    assert.ok(r.legacyFlags.every(Boolean) && r.personalLegacy && r.hullLegacy, `legacy marks: ${JSON.stringify(r)}`);
    assert.ok(r.first.fleet.every((x) => x && x !== 'undefined'));
  });

  await check('new-feature', 'IDENT-UI the fleet manager shows each vessel\'s registry mark, origin and capture, and the captain\'s own ship', async () => {
    await fresh('ident-ui');
    const r = await ev(() => {
      const t = testBM1, s = t.state;
      window.__buyTwins();
      const m = window.__materialise('klingon', 1);
      window.__capture(m.npcs[0]);
      t.renderFleetManager(true);
      for (const d of document.querySelectorAll('.fleet-manager details')) d.open = true;
      const lines = [...document.querySelectorAll('.fleet-manager .fleet-identity')].map((e) => e.textContent);
      return { lines, marks: s.playerFleet.map((f) => t.Identity.registryMark(f.identity.vid)) };
    });
    await page.screenshot({ path: path.join(out, 'fleet-identity-rows.png') });
    await ev(() => document.querySelector('.fleet-manager')?.close());
    assert.ok(r.lines.some((l) => /^Your ship .*Registry R-/.test(l)), `no personal identity line: ${JSON.stringify(r.lines)}`);
    for (const mark of r.marks) assert.ok(r.lines.some((l) => l.includes(mark)), `no row shows ${mark}`);
    assert.ok(r.lines.some((l) => /taken from Klingon/.test(l)), 'the prize does not say who she was taken from');
    assert.ok(r.lines.some((l) => /origin .*\(bought/.test(l)));
  });

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
