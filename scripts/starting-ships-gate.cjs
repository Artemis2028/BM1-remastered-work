// Gate for the starting-ship completion round, stacked on 150edb3.
//
// Terran captains start in the Saber Planetary Defender and Tholian captains in the Tholian Shuttle; the
// rest of the roster is unchanged. The first personal vessel carries the right design through save/load,
// and the escape pod retires the ship it replaces with an accurate disposition while leaving the fleet
// active. Categories as in section6-verification-gate.cjs:
//   baseline-defect  reproduces a wrong behaviour of 150edb3
//   synthetic-guard  a state the UI cannot reach today, set up directly, that must still be handled right
//   preservation     must hold on both
const assert = require('node:assert/strict');
const path = require('node:path');
const { startProbe } = require('./probe-harness.cjs');

// The start roster by design name. Terran and Tholian are this round's changes; the others must not move.
const ROSTER = {
  neutral: { id: 308, name: 'Danube Utility Runabout' },
  ferengi: { id: 316, name: 'Ferengi Cargo Shuttle' },
  vulcan: { id: 25, name: 'Vulcan Warpship', armed: true },
  romulan: { id: 29, name: 'Romulan Scout' },
  cardassian: { id: 314, name: 'Cardassian Hideki Shuttle' },
  terran: { id: 307, name: 'Saber Planetary Defender' },
  klingon: { id: 330, name: "B'rel Scout" },
  dominion: { id: 322, name: "Jem'Hadar Attack Ship", armed: true },
  tholian: { id: 222, name: 'Tholian Shuttle' },
};

(async () => {
  const probe = await startProbe({ pageOptions: { deviceScaleFactor: 2 } });
  const { ev, page } = probe;
  const out = process.env.BM1_TEST_OUTPUT || '/tmp';
  const results = [];
  async function check(category, name, fn) {
    try { await fn(); results.push({ category, name, ok: true }); console.log('PASS', `[${category}]`, name); }
    catch (err) { results.push({ category, name, ok: false, message: String(err?.message || err).split('\n').slice(0, 6).join(' ') }); console.log('FAIL', `[${category}]`, name, '\n      ', String(err?.message || err).split('\n').slice(0, 8).join(' ')); }
  }

  // Start a faction the way a player does: the setup card, then its Start Game button.
  async function startFromMenu(faction, shot) {
    const card = await ev((faction) => {
      const t = testBM1, s = t.state;
      s.gameStarted = false; s.startSetupFaction = faction; s.captainName = ''; s.shipName = '';
      t.startMenuEl.style.display = '';
      t.renderStartMenu('setup');
      return document.querySelector('.start-setup-summary span')?.textContent || '';
    }, faction);
    if (shot) await page.screenshot({ path: path.join(out, `${shot}-setup.png`) });
    await page.click('[data-start-game]');
    return ev((card) => {
      const t = testBM1, s = t.state, id = t.ensurePersonalIdentity();
      return { card, started: s.gameStarted, playership: s.playership, design: t.getShipStats(s.playership).name, mass: t.getShipStats(s.playership).mass,
        weapons: (s.weaponSlots || []).filter(Boolean).length, shipName: s.shipName, identity: JSON.parse(JSON.stringify(id)) };
    }, card);
  }
  async function shootInGame(shot) {
    await ev(() => {
      const t = testBM1;
      t.render();
      t.renderFleetManager(true);
      for (const d of document.querySelectorAll('.fleet-manager details')) d.open = true;
    });
    await page.screenshot({ path: path.join(out, `${shot}-fleet.png`) });
    await ev(() => document.querySelector('.fleet-manager')?.close());
    await ev(() => testBM1.render());
    await page.screenshot({ path: path.join(out, `${shot}-ingame.png`) });
  }

  await check('baseline-defect', 'START-TERRAN a new Terran game starts in the Saber Planetary Defender, and the first personal vessel records that design', async () => {
    const r = await startFromMenu('terran', 'start-terran-saber');
    await shootInGame('start-terran-saber');
    assert.equal(r.started, true);
    assert.equal(r.playership, 307, `Terran started in ${r.design} (${r.playership})`);
    assert.equal(r.design, 'Saber Planetary Defender');
    assert.match(r.card, /^Saber Planetary Defender \|/, `the setup card offers ${r.card}`);
    assert.equal(r.identity.shipId, 307);
    assert.equal(r.identity.name, 'Saber Planetary Defender');
    assert.equal(r.identity.origin.via, 'commissioned');
    assert.equal(r.identity.origin.legacy, false);
  });

  await check('baseline-defect', 'START-THOLIAN a new Tholian game starts in the Tholian Shuttle, and the first personal vessel records that design', async () => {
    const r = await startFromMenu('tholian', 'start-tholian-shuttle');
    await shootInGame('start-tholian-shuttle');
    assert.equal(r.playership, 222, `Tholian started in ${r.design} (${r.playership})`);
    assert.equal(r.design, 'Tholian Shuttle');
    assert.match(r.card, /^Tholian Shuttle \|/, `the setup card offers ${r.card}`);
    assert.equal(r.identity.shipId, 222);
    assert.equal(r.identity.name, 'Tholian Shuttle');
    assert.equal(r.identity.origin.builder, 'tholian');
  });

  await check('baseline-defect', 'START-ALIAS the Terran and Tholian start ids are canonical: the catalog does not resolve them to another hull', async () => {
    const r = await ev(() => {
      const t = testBM1, c = t.state.shipCatalog;
      return ['terran', 'tholian'].map((k) => {
        const id = t.factionDefs[k].playership;
        return { k, id, resolved: t.resolveShipId(id), catalog: c.getShip(id)?.id, name: c.getShip(id)?.name };
      });
    });
    for (const x of r) {
      assert.equal(x.resolved, x.id, `${x.k}: ${x.id} resolves to ${x.resolved}`);
      assert.equal(x.catalog, x.id, `${x.k}: the catalog answers ${x.id} with ${x.catalog} (${x.name})`);
    }
    assert.deepEqual(r.map((x) => x.name), ['Saber Planetary Defender', 'Tholian Shuttle']);
  });

  await check('baseline-defect', 'START-TEXT the start-menu text matches the ships: Vulcans armed, Tholians begin small', async () => {
    const r = await ev(() => {
      const d = testBM1.factionDefs;
      return { vulcan: [d.vulcan.desc, d.vulcan.profile, d.vulcan.lore].join(' '), tholian: [d.tholian.desc, d.tholian.profile, d.tholian.lore].join(' ') };
    });
    assert.doesNotMatch(r.vulcan, /disarm|do not equip|no weapons|without weapons|unarmed/i, 'Vulcan text still says the Vulcans are disarmed');
    assert.match(r.vulcan, /\barmed\b/i);
    assert.doesNotMatch(r.tholian, /begins in this trading tradition|concentrate on the Isaac/i, 'Tholian text still has the captain starting in an Isaac-class trader');
    assert.match(r.tholian, /shuttle/i);
    assert.match(r.tholian, /shipbuild|ship designers|yards/i, 'the Tholian shipbuilding identity is gone');
  });

  await check('preservation', 'START-ROSTER the seven unchanged factions start where they did: Vulcan still in the armed Warpship, Dominion still in the Jem\'Hadar Attack Ship', async () => {
    const r = await ev((keys) => {
      const t = testBM1, s = t.state;
      return keys.map((k) => {
        t.startWithFaction(k);
        return { k, id: s.playership, name: t.getShipStats(s.playership).name, weapons: (s.weaponSlots || []).filter(Boolean).length, identityShip: t.ensurePersonalIdentity().shipId };
      });
    }, Object.keys(ROSTER).filter((k) => !['terran', 'tholian'].includes(k)));
    for (const x of r) {
      const want = ROSTER[x.k];
      assert.equal(x.id, want.id, `${x.k} starts in ${x.name} (${x.id}), expected ${want.name}`);
      assert.equal(x.name, want.name);
      assert.equal(x.identityShip, want.id, `${x.k}: the first personal identity records ${x.identityShip}`);
      if (want.armed) assert.ok(x.weapons > 0, `${x.k} starts unarmed`);
    }
  });

  await check('preservation', 'START-VIABLE the Saber and the Tholian Shuttle can leave home: at least one system is in warp and fuel range', async () => {
    const r = await ev(() => {
      const t = testBM1, s = t.state;
      return ['terran', 'tholian'].map((k) => {
        t.startWithFaction(k);
        let reachable = 0;
        for (let j = 0; j < s.planets.length; j++) {
          if (j === s.currentPlanet) continue;
          const route = t.getPlottedRoute(s.currentPlanet, j);
          if (route && t.getRouteRangeStatus(route).canTravel) reachable++;
        }
        return { k, reachable, cargo: s.cargoCap };
      });
    });
    for (const x of r) {
      assert.ok(x.reachable > 0, `${x.k}: no system is reachable from home`);
      assert.ok(x.cargo > 0, `${x.k}: the starter carries no cargo`);
    }
  });

  await check('baseline-defect', 'START-SAVELOAD the first personal vessel keeps its vid, design, name, seed and origin through save/load', async () => {
    const r = await ev(() => {
      const t = testBM1, s = t.state, pick = (i) => JSON.stringify({ vid: i.vid, shipId: i.shipId, name: i.name, seed: i.seed, origin: i.origin });
      return ['terran', 'tholian', 'vulcan', 'dominion'].map((k, n) => {
        t.startWithFaction(k, { shipName: `Gate ${k}` });
        const before = pick(t.ensurePersonalIdentity());
        const ship = s.playership;
        t.saveGame(7 + n);
        t.startWithFaction('ferengi');
        t.loadGame(7 + n);
        const after = pick(t.ensurePersonalIdentity());
        return { k, before, after, ship, shipAfter: s.playership, name: s.shipName };
      });
    });
    const want = { terran: 307, tholian: 222, vulcan: 25, dominion: 322 };
    for (const x of r) {
      assert.equal(x.after, x.before, `${x.k}: identity changed across save/load`);
      assert.equal(x.shipAfter, want[x.k], `${x.k}: reloaded in ${x.shipAfter}`);
      assert.equal(JSON.parse(x.after).shipId, want[x.k]);
      assert.equal(JSON.parse(x.after).name, `Gate ${x.k}`);
    }
  });

  await check('preservation', 'POD-DESTROYED a ship lost in the game-over path is retired as destroyed; the fleet is not touched; nothing reappears after save/load', async () => {
    const r = await ev(() => {
      const t = testBM1, s = t.state;
      t.startWithFaction('terran');
      const lost = JSON.parse(JSON.stringify(t.ensurePersonalIdentity()));
      s.docked = true; s.latinum = 1e7; s.mylatinum = s.latinum;
      const offer = t.getShipyardStock()[0];
      t.fleetShipStock(offer.id).quantity = 5;
      t.adjustFactionStanding(t.getCurrentPurchaseVendor().standingFaction, 100, { silent: true });
      t.buyEscortShip(offer.id);
      const escort = s.playerFleet[s.playerFleet.length - 1];
      const escortVid = escort.identity.vid;
      s.docked = false;
      s.hull = 0; t.checkWinLose();
      const gameOver = s.gameOver;
      t.restartInEscapePod();
      const pod = JSON.parse(JSON.stringify(t.ensurePersonalIdentity()));
      const afterPod = { lost: t.findStrategicVessel(lost.vid), prov: t.vesselProvenance(lost.vid), escort: t.findStrategicVessel(escortVid), sameRecord: s.playerFleet.includes(escort), fleet: s.playerFleet.length };
      t.saveGame(11); t.startWithFaction('ferengi'); t.loadGame(11);
      const activeWithLost = (s.playerFleet.filter((f) => !f.destroyed && f.identity?.vid === lost.vid).length) + (t.fleetBook().personalIdentity?.vid === lost.vid ? 1 : 0);
      const reloaded = { lost: t.findStrategicVessel(lost.vid), escort: t.findStrategicVessel(escortVid), personal: t.fleetBook().personalIdentity?.vid, activeWithLost };
      return { lost, pod, gameOver, escortVid, afterPod: { lost: afterPod.lost.status, cause: afterPod.prov?.cause, origin: afterPod.prov?.origin, retiredShip: afterPod.lost.retired?.shipId, escort: afterPod.escort?.status, escortKind: afterPod.escort?.kind, sameRecord: afterPod.sameRecord, fleet: afterPod.fleet },
        reloaded: { lost: reloaded.lost?.status, cause: reloaded.lost?.retired?.cause, escort: reloaded.escort?.status, escortVid: reloaded.escort?.identity?.vid, personal: reloaded.personal, activeWithLost } };
    });
    assert.equal(r.gameOver, true, 'hull 0 did not end the game');
    assert.equal(r.afterPod.lost, 'retired');
    assert.equal(r.afterPod.cause, 'destroyed');
    assert.deepEqual(r.afterPod.origin, r.lost.origin, 'provenance lost the origin');
    assert.equal(r.afterPod.retiredShip, r.lost.shipId, 'the retired entry lost the design');
    assert.notEqual(r.pod.vid, r.lost.vid, 'the escape pod took the lost ship\'s vid');
    assert.equal(r.pod.origin.via, 'escape-pod');
    assert.equal(r.afterPod.escort, 'active', 'the pod removed a fleet ship from the books');
    assert.equal(r.afterPod.escortKind, 'fleet');
    assert.equal(r.afterPod.sameRecord, true);
    assert.equal(r.reloaded.lost, 'retired');
    assert.equal(r.reloaded.cause, 'destroyed');
    assert.equal(r.reloaded.activeWithLost, 0, 'the lost ship is active again after save/load');
    assert.equal(r.reloaded.personal, r.pod.vid);
    assert.equal(r.reloaded.escort, 'active');
    assert.equal(r.reloaded.escortVid, r.escortVid);
  });

  await check('synthetic-guard', 'POD-ABANDONED an ejection from a ship that was not destroyed retires it as abandoned, never destroyed', async () => {
    const r = await ev(() => {
      const t = testBM1, s = t.state;
      t.startWithFaction('tholian');
      const lost = t.ensurePersonalIdentity().vid;
      s.hull = 60; s.gameOver = false;
      t.restartInEscapePod();
      t.ensurePersonalIdentity();
      const p = t.vesselProvenance(lost);
      t.saveGame(12); t.startWithFaction('ferengi'); t.loadGame(12);
      return { status: p?.status, cause: p?.cause, via: t.fleetBook().personalIdentity?.origin?.via, reloadedCause: t.vesselProvenance(lost)?.cause, reloadedStatus: t.vesselProvenance(lost)?.status };
    });
    assert.equal(r.status, 'retired');
    assert.equal(r.cause, 'abandoned', `retired as ${r.cause}`);
    assert.equal(r.via, 'escape-pod');
    assert.equal(r.reloadedStatus, 'retired');
    assert.equal(r.reloadedCause, 'abandoned');
  });

  await probe.close();
  const cats = {};
  for (const r of results) { cats[r.category] ||= { pass: 0, total: 0 }; cats[r.category].total++; if (r.ok) cats[r.category].pass++; }
  console.log('\nSummary by category:');
  for (const [c, v] of Object.entries(cats)) console.log(`  ${c}: ${v.pass}/${v.total}`);
  const failed = results.filter((r) => !r.ok);
  console.log(`${results.length - failed.length}/${results.length} starting-ship checks passed.`);
  process.exit(failed.length ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
