// Gate for strategic evacuation and blockade, stacked on b2da1f2.
// Rules: docs/playtest/EVACUATION-BLOCKADE-RULES-261530ZSEP26.md.
//
// Both are persistent operations with real hulls behind them. Categories as in the other gates:
//   new-feature   needs a state b2da1f2 does not have (there were no evacuation or blockade operations)
//   preservation  must hold on both
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
  const shot = (name) => page.screenshot({ path: path.join(out, name) });

  await page.evaluate(() => {
    const t = testBM1;
    window.__adv = (n) => { for (let i = 0; i < n; i++) t.advanceFleetCalendar(1, t.Fleet.nextId(t.fleetBook(), 'journey')); };
    // A world of the captain's own: Orion (Terran, next to Earth), handed over through the real transfer.
    window.__P = () => { const i = t.getSystemIndexByName('Orion'); if (t.getSystemControl(i).controller !== 'player') { t.transferSystemControlToPlayer(i); t.markSystemVisited(i); } return i; };
    // A force strong enough to hold a blockade of a lightly defended Klingon world.
    window.__squadron = (prefix, at, n = 6) => Array.from({ length: n }, (_, k) => window.__ship(`${prefix}${k}`, at, 4, 1400));
    window.__ship = (id, at, shipId = 1, hull = 400) => {
      const s = t.state;
      s.playerFleet.push({ id, shipId: Number(shipId), name: id, systemIndex: at, assignment: 'defense', destroyed: false, vessel: { hull, maxHull: hull, condition: 'operational' } });
      return id;
    };
    window.__vid = (id) => t.ensureFleetVesselIdentity(t.state.playerFleet.find((f) => f.id === id)).vid;
    window.__evac = () => (t.campaign().evacuations || []).find((e) => e.status === 'active' && e.sponsor === 'player') || null;
    window.__evacById = (id) => (t.campaign().evacuations || []).find((e) => e.id === id);
    window.__block = (id) => (t.campaign().blockades || []).find((b) => b.id === id);
    // An AI blockade through the model's own entry point, with the power's real hulls moved alongside.
    window.__aiBlockade = (power, target, n, purpose = 'stop_evacuation') => {
      const book = t.campaign();
      t.syncPlayerPolity(book);
      const hulls = book.polities[power].hulls.filter((h) => h.status === 'ready' && !h.opId).slice(0, n);
      for (const h of hulls) h.systemIndex = target;
      const fx = [];
      const r = t.Campaign.startBlockade(book, t.buildCampaignWorld(true), { power, target, hullIds: hulls.map((h) => h.id), purpose }, t.state.day, fx);
      t.applyCampaignEffects(fx, t.state.day);
      return r.ok ? r.record.id : r.reason;
    };
    // Convoy-era helpers (BLOCKADE-RUNNING-RULES): civilian freighters (the Tarellian hauler: unarmed,
    // slow) as transports, and what an evacuation delivered over a window of days.
    // A world of the captain's that the Klingon war does not reach in the first weeks (Orion can fall
    // within ten days on these seeds, which ends a convoy test for the wrong reason).
    window.__Q = () => { const i = t.getSystemIndexByName('Alpha Centauri'); if (t.getSystemControl(i).controller !== 'player') { t.transferSystemControlToPlayer(i); t.markSystemVisited(i); } return i; };
    window.__freighters = (prefix, at, n = 2) => Array.from({ length: n }, (_, k) => window.__ship(`${prefix}${k}`, at, 215, 600));
    window.__window = (e, days) => { const m0 = e.moved; window.__adv(days); return e.moved - m0; };
    // STRATEGIC-MOVEMENT-UNIFICATION: a convoy flies each leg its real length, so a test window is a number
    // of round trips (loading included), not a number of days.
    window.__trip = (e) => t.Campaign.evacuationRoundTripDays(t.buildCampaignWorld(true), e) + (t.campaign().config.evacLoadingDays ?? 1);
    window.__runs = (e) => (t.campaign().blockades || []).flatMap((b) => (b.runs || []).filter((x) => String(x.by).startsWith(e.id)).map((x) => ({ ...x, blockade: b.id })));
    window.__fleetStrategic = () => JSON.stringify(t.state.playerFleet.filter((f) => !f.destroyed).map((f) => [f.id, f.strategicOp || null, f.strategicRole || null, f.systemIndex, window.__vid(f.id)]));
  });

  // 1 ---------------------------------------------------------------------------------------------
  await check('new-feature', 'EVAC-FINITE an evacuation moves a finite capacity over strategic days: its convoy delivers the transports\' lift each time it reaches the destination (BLOCKADE-RUNNING-RULES convoy), nothing in between', async () => {
    await fresh('eb-finite');
    const r = await ev(() => {
      const t = testBM1;
      const P = window.__P();
      window.__ship('tA', P, 1); window.__ship('tB', P, 2);
      const dest = t.getSystemIndexByName('Earth');
      const res = t.startPlayerEvacuation(P, dest, ['tA', 'tB']);
      if (!res.ok) return { fail: res.reason };
      const e = res.record;
      const days = [];
      const n = 2 * window.__trip(e) + 2;
      for (let k = 0; k < n; k++) { window.__adv(1); days.push(e.moved); }
      const lift = e.transports.reduce((n, x) => n + x.lift, 0);
      return { fail: null, days, target: e.target, lift, trip: 2 * (e.route.length - 1) + 1, status: e.status };
    });
    assert.ok(!r.fail, r.fail);
    const steps = r.days.map((m, i) => m - (i ? r.days[i - 1] : 0)).filter((x) => x > 0);
    assert.ok(steps.length >= 2, `deliveries over two round trips: ${r.days}`);
    // Every delivery is a full lift, except a last one that finishes the target.
    steps.forEach((x, i) => assert.ok(x === r.lift || (i === steps.length - 1 && r.days[r.days.length - 1] === r.target), `a delivery of ${x} for a lift of ${r.lift}: ${r.days}`));
    assert.ok(r.days[0] === 0, 'people arrived before the convoy could have');
    assert.ok(r.days[r.days.length - 1] < r.target || r.status === 'completed');
  });
  await check('new-feature', 'EVAC-NO-CAPACITY with no transport capacity an evacuation cannot start, and one whose transports are all gone stops without progress', async () => {
    await fresh('eb-nocap');
    const r = await ev(() => {
      const t = testBM1, s = t.state;
      const P = window.__P(); const dest = t.getSystemIndexByName('Earth');
      const none = t.startPlayerEvacuation(P, dest, []);
      // A hull whose hold carries nobody (the fixture zeroes a copy's cargo).
      const hold = { ...s.shipStatsById[1], id: 9901, cargoCapacity: 0 }; s.shipStatsById[9901] = hold;
      window.__ship('z1', P, 9901);
      const empty = t.startPlayerEvacuation(P, dest, ['z1']);
      window.__ship('tA', P, 1);
      const ok = t.startPlayerEvacuation(P, dest, ['tA'], { target: 50000 });
      const e = ok.record;
      s.playerFleet.find((f) => f.id === 'tA').destroyed = true;
      const before = e.moved;
      window.__adv(2);
      return { none: none.reason, empty: empty.reason, before, after: e.moved, status: e.status, why: e.endReason };
    });
    assert.match(r.none, /No transport capacity/); assert.match(r.empty, /No transport capacity/);
    assert.equal(r.after, r.before, 'an evacuation with no transports moved people');
    assert.equal(r.status, 'failed'); assert.match(r.why, /no transport capacity/);
  });

  await check('new-feature', 'EVAC-LOSS-REDUCES losing a transport lowers what each trip delivers, and the loss is recorded against the vessel\'s vid', async () => {
    await fresh('eb-loss');
    const r = await ev(() => {
      const t = testBM1, s = t.state;
      const P = window.__P();
      window.__ship('tA', P, 1); window.__ship('tB', P, 1); window.__ship('tC', P, 1);
      const vid = window.__vid('tC');
      const e = t.startPlayerEvacuation(P, t.getSystemIndexByName('Earth'), ['tA', 'tB', 'tC'], { target: 600000 }).record;
      const trip = window.__trip(e);
      window.__adv(trip); const full = e.lastDelivery?.delivered;
      s.playerFleet.find((f) => f.id === 'tC').destroyed = true;
      window.__adv(trip + 1);
      return { full, reduced: e.lastDelivery?.delivered, transports: e.transports.length, lost: e.lost, vid };
    });
    assert.equal(r.transports, 2);
    assert.ok(r.full > 0 && r.reduced === Math.round(r.full * 2 / 3), `per trip ${r.full} → ${r.reduced}`);
    assert.equal(r.lost[0]?.vid, r.vid);
  });
  await check('new-feature', 'EVAC-SAVELOAD progress, assigned vessels (with their vids) and route survive save/load exactly', async () => {
    await fresh('eb-save');
    const r = await ev(() => {
      const t = testBM1;
      const P = window.__P();
      window.__ship('tA', P, 1); window.__ship('tB', P, 2);
      const e = t.startPlayerEvacuation(P, t.getSystemIndexByName('Earth'), ['tA', 'tB'], { target: 60000 }).record;
      window.__adv(2);
      const read = () => JSON.stringify({ e: window.__evacById(e.id), fleet: window.__fleetStrategic() });
      const before = read();
      t.saveGame(5); t.startWithFaction('ferengi'); t.loadGame(5);
      const after = read();
      window.__adv(window.__trip(e));
      return { before, after, moving: window.__evacById(e.id).moved > JSON.parse(before).e.moved };
    });
    assert.equal(r.after, r.before);
    assert.ok(r.moving, 'the loaded evacuation did not continue');
  });

  await check('new-feature', 'EVAC-COMPLETE a finished evacuation closes cleanly: completed, every vessel released, one report', async () => {
    await fresh('eb-complete');
    const r = await ev(() => {
      const t = testBM1;
      const P = window.__P();
      window.__ship('tA', P, 1); window.__ship('tB', P, 2);
      const from = t.state.day;
      const e = t.startPlayerEvacuation(P, t.getSystemIndexByName('Earth'), ['tA', 'tB']).record;
      for (let k = 0; k < 20 * window.__trip(e) && e.status === 'active'; k++) window.__adv(1);
      const news = t.galaxyNewsBook();
      return { status: e.status, moved: e.moved, target: e.target, fleet: JSON.parse(window.__fleetStrategic()).filter((x) => x[1]), reports: [...news.items, ...news.pending].filter((x) => x.day >= from && /Evacuation complete/.test(x.kind)).map((x) => x.text) };
    });
    assert.equal(r.status, 'completed'); assert.equal(r.moved, r.target);
    assert.deepEqual(r.fleet, [], 'vessels are still held by a finished evacuation');
    assert.equal(r.reports.length, 1);
  });

  await check('new-feature', 'EVAC-PARTIAL-FALL an evacuation whose world falls ends, and what it moved stays on the record', async () => {
    await fresh('eb-fall');
    const r = await ev(() => {
      const t = testBM1;
      const P = window.__P();
      window.__ship('tA', P, 1);
      const e = t.startPlayerEvacuation(P, t.getSystemIndexByName('Earth'), ['tA'], { target: 60000 }).record;
      window.__adv(window.__trip(e));
      const moved = e.moved;
      t.transferSystemControlToFaction(P, 'klingon');
      window.__adv(1);
      return { moved, status: e.status, after: e.moved, why: e.endReason, released: !window.__fleetStrategic().includes(e.id) };
    });
    assert.ok(r.moved > 0);
    assert.equal(r.status, 'partial'); assert.equal(r.after, r.moved); assert.match(r.why, /was lost/);
    assert.ok(r.released);
  });

  // 7 & 8 -----------------------------------------------------------------------------------------
  await check('new-feature', 'BLOCKADE-NEEDS-FORCE a blockade needs ships actually assigned to it', async () => {
    await fresh('eb-force');
    const r = await ev(() => {
      const t = testBM1, book = t.campaign();
      const qonosSide = t.getSystemIndexByName('Koann');
      const player = t.startPlayerBlockade(qonosSide, []);
      t.syncPlayerPolity(book);
      const ai = t.Campaign.startBlockade(book, t.buildCampaignWorld(true), { power: 'klingon', target: t.getSystemIndexByName('Orion'), hullIds: [] }, t.state.day, []);
      return { player: player.reason, ai: ai.reason, count: (book.blockades || []).length };
    });
    assert.match(r.player, /needs ships/); assert.match(r.ai, /needs ships/); assert.equal(r.count, 0);
  });

  await check('new-feature', 'BLOCKADE-NEEDS-WAR an ordinary military blockade needs a formal war: refused against the Cardassians, accepted against the Klingons', async () => {
    await fresh('eb-war');
    const r = await ev(() => {
      const t = testBM1;
      const car = t.getSystemIndexByName('Anorez'), kl = t.getSystemIndexByName("Ty'Gokor");
      const a = window.__squadron('ca', car), b = window.__squadron('kl', kl);
      const no = t.startPlayerBlockade(car, a);
      const yes = t.startPlayerBlockade(kl, b);
      return { no: no.reason, yes: yes.ok, status: yes.record?.status };
    });
    assert.match(r.no, /not at war/); assert.equal(r.yes, true); assert.equal(r.status, 'active');
  });

  // 9–11 ------------------------------------------------------------------------------------------
  await check('new-feature', 'BLOCKADE-STRONG-REDUCES a strong blockade turns an unescorted freighter convoy back far more than it lets through: deliveries fall hard and the route reads heavily interdicted', async () => {
    const one = async (blockade) => { await fresh('eb-strong'); return ev((blockade) => {
      const t = testBM1;
      const P = window.__Q();
      const ids = window.__freighters('fr', P, 2);
      const e = t.startPlayerEvacuation(P, t.getSystemIndexByName('Earth'), ids, { target: 5000000 }).record;
      const id = blockade ? window.__aiBlockade('klingon', P, 28) : null;
      const moved = window.__window(e, 3 * window.__trip(e));
      const b = id ? window.__block(id) : null;
      window.__adv(0);
      const route = t.evacRouteAssessment(e);
      return { moved, runs: window.__runs(e).map((x) => x.outcome), tier: b ? t.Campaign.blockadeTier(b.coverage) : null, route: e.status === 'active' ? route.status : 'ended', estimate: route.estimate, status: e.status };
    }, blockade); };
    const clear = await one(false);
    const blocked = await one(true);
    assert.equal(blocked.tier, 'heavy');
    assert.ok(blocked.runs.length > 0, 'no run was made');
    assert.ok(blocked.moved < clear.moved * 0.5, `delivered ${clear.moved} clear → ${blocked.moved} blockaded (${blocked.runs})`);
    assert.equal(clear.route, 'Clear'); assert.ok(['Heavily interdicted', 'ended'].includes(blocked.route), `route ${blocked.route}`);
  });
  await check('new-feature', 'BLOCKADE-WEAK-LEAKS a weak blockade leaks: the convoy slips through most of the time, without a fight, and keeps most of its deliveries', async () => {
    const one = async (blockade) => { await fresh('eb-weak'); return ev((blockade) => {
      const t = testBM1;
      const P = window.__Q();
      const ids = window.__freighters('fr', P, 2);
      const e = t.startPlayerEvacuation(P, t.getSystemIndexByName('Earth'), ids, { target: 5000000 }).record;
      const id = blockade ? window.__aiBlockade('klingon', P, 1) : null;
      const moved = window.__window(e, 3 * window.__trip(e));
      return { moved, runs: window.__runs(e).map((x) => x.outcome), tier: id ? t.Campaign.blockadeTier(window.__block(id).coverage) : null };
    }, blockade); };
    const clear = await one(false), weak = await one(true);
    assert.notEqual(weak.tier, 'heavy');
    assert.ok(weak.moved >= clear.moved * 0.5, `delivered ${clear.moved} → ${weak.moved}`);
    const quiet = weak.runs.filter((o) => ['slipped_through', 'challenged_but_passed'].includes(o)).length;
    assert.ok(quiet >= weak.runs.length / 2, `runs ${weak.runs}`);
  });
  await check('new-feature', 'BLOCKADE-WEAKENED escorts get the convoy through and cost the blockade ships; a blockade whose force is gone ends and deliveries return to full', async () => {
    const one = async (escorts) => { await fresh('eb-weaken'); return ev((escorts) => {
      const t = testBM1;
      const P = window.__Q();
      const ids = window.__freighters('fr', P, 2);
      const esc = window.__squadron('esc', P, escorts);
      const e = t.startPlayerEvacuation(P, t.getSystemIndexByName('Earth'), ids, { target: 5000000, escorts: esc }).record;
      const id = window.__aiBlockade('klingon', P, 8);
      const b = window.__block(id);
      const hulls0 = b.hulls.length, cov0 = b.coverage;
      const moved = window.__window(e, 3 * window.__trip(e));
      return { moved, runs: window.__runs(e).map((x) => x.outcome), hulls0, hulls: b.hulls.length, cov0, cov: b.coverage, status: b.status };
    }, escorts); };
    const bare = await one(0), escorted = await one(4);
    // On real legs a turned-back departure costs days, not a trip (STRATEGIC-MOVEMENT-UNIFICATION): escorts
    // are judged on the runs they make (let through more often, or at least as often, and delivering no less).
    const share = (x) => x.runs.length ? x.runs.filter((o) => ['slipped_through', 'challenged_but_passed', 'fought_through', 'intercepted_minor_damage'].includes(o)).length / x.runs.length : 1;
    console.log('   blockade-weakened (bare / escorted):', JSON.stringify({ bare, escorted }));
    // (When the bare convoy already got through every run in the window there is nothing for escorts to
    // improve on the runs; what they did to the blockade is checked next.)
    assert.ok(share(escorted) > share(bare) || escorted.moved > bare.moved || (share(bare) === 1 && share(escorted) === 1 && escorted.moved >= bare.moved), `escorts did not help: ${JSON.stringify({ bare, escorted })}`);
    assert.ok(escorted.hulls < escorted.hulls0 || escorted.status !== 'active' || escorted.cov < escorted.cov0, `the blockade lost nothing to the escorts: ${JSON.stringify(escorted)}`);
    await fresh('eb-weaken-gone');
    const gone = await ev(() => {
      const t = testBM1, book = t.campaign();
      const P = window.__Q();
      const ids = window.__freighters('fr', P, 2);
      const e = t.startPlayerEvacuation(P, t.getSystemIndexByName('Earth'), ids, { target: 5000000 }).record;
      const id = window.__aiBlockade('klingon', P, 8);
      const b = window.__block(id);
      for (const h of book.polities.klingon.hulls) if (b.hulls.some((x) => x.hullId === h.id)) { h.status = 'lost'; h.hull = 0; }
      window.__adv(1);
      const lift = e.transports.reduce((n, x) => n + x.lift, 0);
      window.__adv(window.__trip(e) + 1);
      return { status: b.status, why: b.endReason, factor: e.lastFactor, delivered: e.lastDelivery?.delivered, lift };
    });
    assert.equal(gone.status, 'broken'); assert.match(gone.why, /gone/);
    assert.equal(gone.factor, 1); assert.equal(gone.delivered, gone.lift, 'deliveries did not return to full');
  });
  await check('new-feature', 'BLOCKADE-THROUGHPUT a blockade slows market restocking, resupply and production at the world, and the shelf recovers once it lifts', async () => {
    await fresh('eb-market');
    const r = await ev(() => {
      const t = testBM1, s = t.state, book = t.campaign();
      const P = t.getSystemIndexByName('Lik Prime'), C = t.getSystemIndexByName('Trey');
      const goods = Object.keys(t.marketStockFor(P).goods)[0], goodsC = Object.keys(t.marketStockFor(C).goods)[0];
      const cap = t.worldTradeCapability(P).tons;
      t.takeMarketSupply(P, goods, 1e9); t.takeMarketSupply(C, goodsC, 1e9);
      const supplyBefore = book.polities.terran.supply;
      const id = window.__aiBlockade('klingon', P, 12, 'interdict_trade');
      window.__adv(4);
      const blocked = t.marketSupply(P, goods), control = t.marketSupply(C, goodsC);
      const capC = t.worldTradeCapability(C).tons;
      const supplyDuring = book.polities.terran.supply;
      const fx = []; t.Campaign.withdrawBlockade(book, t.buildCampaignWorld(true), id, s.day, fx, 'test'); t.applyCampaignEffects(fx, s.day);
      window.__adv(40);
      return { blocked, control, cap, capC, supplyBefore, supplyDuring, recovered: t.marketSupply(P, goods), flowAfter: t.Campaign.blockadeFlowFactor(book, P, 1) };
    });
    assert.ok(r.blocked / r.cap < r.control / r.capC * 0.7, `restock under blockade ${r.blocked}/${r.cap} vs ${r.control}/${r.capC}`);
    assert.ok(r.supplyDuring < r.supplyBefore, `resupply unchanged: ${r.supplyBefore} → ${r.supplyDuring}`);
    assert.equal(r.recovered, r.cap, 'the shelf did not recover once the blockade lifted');
    assert.equal(r.flowAfter, 1, 'the blockade still weighs on the world after it lifted');
  });

  await check('preservation', 'MARKET-NO-BLOCKADE with no blockade the shelf restocks exactly as before', async () => {
    await fresh('eb-market-plain');
    const r = await ev(() => {
      const t = testBM1;
      const C = t.getSystemIndexByName('Trey');
      const goods = Object.keys(t.marketStockFor(C).goods)[0];
      t.takeMarketSupply(C, goods, 1e9);
      const cap = t.worldTradeCapability(C);
      window.__adv(3);
      return { supply: t.marketSupply(C, goods), expected: Math.min(cap.tons, 3 * cap.replenish), days: t.blockadeRestockDays ? t.blockadeRestockDays(C, 1, 4) : 3 };
    });
    assert.equal(r.supply, r.expected); assert.equal(r.days, 3);
  });

  // 13 & 14 ---------------------------------------------------------------------------------------
  await check('new-feature', 'CEASEFIRE-CLOSES a ceasefire closes a war-authorised blockade through the same transition, the day it is signed, and releases its force', async () => {
    await fresh('eb-cease');
    const r = await ev(() => {
      const t = testBM1, book = t.campaign();
      window.__P();
      for (const i of [1, 0]) t.markSystemVisited(i);
      const target = t.getSystemIndexByName('Lik Prime');
      t.markSystemVisited(target);
      window.__ship('picket', target, 1);
      const id = window.__aiBlockade('klingon', target, 6, 'isolate_world');
      window.__adv(1);
      const before = window.__block(id).status;
      t.changeDiplomacy('terran', 'klingon', 'ceasefire');
      const b = window.__block(id);
      const released = book.polities.klingon.hulls.filter((h) => b.hulls.some((x) => x.hullId === h.id)).every((h) => h.opId == null && h.status !== 'assigned');
      return { before, status: b.status, why: b.endReason, released };
    });
    assert.equal(r.before, 'active');
    assert.equal(r.status, 'closed'); assert.match(r.why, /ceasefire/);
    assert.ok(r.released, 'the blockade\'s hulls are still held');
    await ev(() => { testBM1.openCampaignPanel('strategic'); document.querySelector('.campaign-body section:last-of-type')?.scrollIntoView({ block: 'start' }); });
    await shot('eb-ceasefire-closes-blockade.png');
    await ev(() => testBM1.closeCampaignPanel());
  });

  await check('new-feature', 'EVAC-THROUGH-CEASEFIRE an evacuation is not hostile: it continues through a ceasefire; the blockade closes and no interception fires after it', async () => {
    await fresh('eb-evac-cease');
    const r = await ev(() => {
      const t = testBM1;
      const P = window.__Q();
      const ids = window.__freighters('fr', P, 3);
      const e = t.startPlayerEvacuation(P, t.getSystemIndexByName('Earth'), ids, { target: 5000000, escorts: window.__squadron('esc', P, 3) }).record;
      const id = window.__aiBlockade('klingon', P, 6);
      window.__adv(4);
      const runsBefore = window.__runs(e).length;
      t.changeDiplomacy('terran', 'klingon', 'ceasefire');
      const empire = t.playerRelation('klingon').status;
      const n0 = t.campaign().stats.interceptions || 0;
      window.__adv(7);
      return { runsBefore, empire, status: e.status, factor: e.lastFactor, block: window.__block(id).status, newRuns: (t.campaign().stats.interceptions || 0) - n0, delivered: e.lastDelivery?.delivered, lift: e.transports.reduce((n, x) => n + x.lift, 0) };
    });
    assert.ok(r.runsBefore > 0, 'precondition: no run before the ceasefire');
    assert.equal(r.empire, 'ceasefire', 'precondition: the empire\'s inherited war did not follow');
    assert.equal(r.block, 'closed');
    assert.equal(r.newRuns, 0, 'an interception fired after the ceasefire');
    assert.equal(r.status, 'active'); assert.equal(r.factor, 1); assert.equal(r.delivered, r.lift);
  });
  await check('new-feature', 'DEST-VALID the captain can pick a valid destination: own and friendly worlds within reach', async () => {
    await fresh('eb-dest');
    const r = await ev(() => {
      const t = testBM1;
      const P = window.__P();
      const dests = t.evacuationDestinationsFor(P);
      const w = t.buildCampaignWorld(true);
      return { names: dests.map((d) => d.name), holders: [...new Set(dests.map((d) => w.systems[d.index].controller))] };
    });
    assert.ok(r.names.includes('Earth'), `destinations: ${r.names}`);
    assert.ok(r.holders.every((h) => ['terran', 'vulcan', 'andorian', 'bajoran', 'player'].includes(h)), `destination held by a power that will not take them: ${r.holders}`);
  });

  await check('new-feature', 'DEST-REFUSED an invalid, hostile or inaccessible destination is refused', async () => {
    await fresh('eb-dest-bad');
    const r = await ev(() => {
      const t = testBM1;
      const P = window.__P();
      window.__ship('tA', P, 1);
      const try_ = (i) => t.startPlayerEvacuation(P, i, ['tA']).reason || 'accepted';
      const heavy = t.getSystemIndexByName('Lik Prime');
      const bid = window.__aiBlockade('klingon', heavy, 20, 'interdict_trade');
      window.__adv(1);
      const cov = window.__block(bid)?.coverage;
      return { self: try_(P), hostile: try_(t.getSystemIndexByName('Qonos')), cardassian: try_(t.getSystemIndexByName('Cardassia')), far: try_(t.getSystemIndexByName('Dominica')), blockaded: try_(heavy), cov, bid };
    });
    assert.match(r.self, /world being evacuated/);
    assert.match(r.hostile, /will not receive/);
    assert.match(r.cardassian, /will not receive/);
    assert.match(r.far, /will not receive|no route|too far/);
    assert.match(r.blockaded, /under blockade/, `coverage ${r.cov} (${r.bid})`);
  });

  // 17 & 18 ---------------------------------------------------------------------------------------
  await check('new-feature', 'PLAYER-BLOCKADE-VIDS the captain\'s blockade holds his real vessels, keeps their vids, and they stay held until he withdraws them', async () => {
    await fresh('eb-vids');
    const r = await ev(() => {
      const t = testBM1;
      const kl = t.getSystemIndexByName("Ty'Gokor");
      const ids = window.__squadron('b', kl);
      const vids = ids.map(window.__vid);
      const res = t.startPlayerBlockade(kl, ids, 'interdict_trade');
      window.__adv(3);
      const b = window.__block(res.record.id);
      const held = JSON.parse(window.__fleetStrategic()).filter((x) => x[1] === b.id).map((x) => x[4]);
      const recordVids = b.hulls.map((x) => x.vid);
      t.withdrawPlayerBlockade(b.id);
      return { vids, held, recordVids, status: b.status, after: JSON.parse(window.__fleetStrategic()).filter((x) => x[1]), nowVids: ids.map(window.__vid) };
    });
    assert.deepEqual(r.recordVids, r.vids); assert.deepEqual(r.held.sort(), [...r.vids].sort());
    assert.equal(r.status, 'withdrawn'); assert.deepEqual(r.after, []);
    assert.deepEqual(r.nowVids, r.vids, 'the vessels lost their identities');
  });

  await check('new-feature', 'NO-DUPLICATE a vessel held by one operation cannot be put to another: not a second blockade, not an evacuation, not a reinforcement', async () => {
    await fresh('eb-dup');
    const r = await ev(() => {
      const t = testBM1;
      const P = window.__P();
      const kl = t.getSystemIndexByName("Ty'Gokor");
      const ids = window.__squadron('b', kl);
      const b = t.startPlayerBlockade(kl, ids);
      const again = t.startPlayerBlockade(t.getSystemIndexByName('Boreth'), ['b0']);
      const reinf = t.reinforcePlayerBlockade(b.record.id, ['b0']);
      window.__ship('tA', P, 1);
      const e = t.startPlayerEvacuation(P, t.getSystemIndexByName('Earth'), ['tA']);
      const both = t.startPlayerBlockade(kl, ['tA']);
      return { again: again.reason, reinf: reinf.reason, both: both.reason, free: t.freeFleetShipsAt([kl, P]).map((f) => f.id) };
    });
    assert.ok(/committed|not at|already/.test(r.again), r.again);
    assert.match(r.reinf, /not free/);
    assert.ok(/committed|not at|already/.test(r.both), r.both);
    assert.deepEqual(r.free, []);
  });

  // 19 --------------------------------------------------------------------------------------------
  await check('new-feature', 'INTEL-MASK exact blockade strength is shown only to a source that can see it: hearsay says unknown, a relay a range, a ship on station the count', async () => {
    await fresh('eb-intel');
    const r = await ev(() => {
      const t = testBM1;
      const target = t.getSystemIndexByName('Lik Prime');
      t.markSystemVisited(target);
      const id = window.__aiBlockade('klingon', target, 7, 'isolate_world');
      window.__adv(1);
      const b = window.__block(id);
      const rumour = t.blockadeKnowledge(b);
      t.openCampaignPanel('strategic');
      const card = document.querySelector(`[data-ops-blockade="${id}"]`)?.textContent || '';
      t.closeCampaignPanel();
      window.__ship('eye', target, 1);
      const fleet = t.blockadeKnowledge(b);
      return { rumour, card, fleet, n: b.hulls.length };
    });
    assert.equal(r.rumour.coverage, 'unknown'); assert.equal(r.rumour.force, null);
    assert.ok(!/\d+\s*ship/.test(r.card) && /Coverage: Unknown/.test(r.card), `the card leaks strength: ${r.card}`);
    assert.equal(r.fleet.force, String(r.n)); assert.notEqual(r.fleet.coverage, 'unknown');
  });

  // 20 --------------------------------------------------------------------------------------------
  await check('new-feature', 'UI-SAVELOAD the Operations tab and the map overlay read the same after save/load', async () => {
    await fresh('eb-ui-save');
    const r = await ev(() => {
      const t = testBM1;
      const P = window.__P();
      window.__ship('tA', P, 1); window.__ship('tB', P, 2);
      t.startPlayerEvacuation(P, t.getSystemIndexByName('Earth'), ['tA', 'tB'], { target: 60000 });
      window.__aiBlockade('klingon', P, 10);
      window.__adv(1);
      const read = () => { t.openCampaignPanel('strategic'); const html = document.querySelector('.campaign-body').innerHTML; t.closeCampaignPanel(); const m = t.mapStrategicOps(); return JSON.stringify({ html, evacs: m.evacs.map((e) => e.id), blocks: m.blocks.map((x) => [x.b.id, x.k]) }); };
      const before = read();
      t.saveGame(4); t.startWithFaction('ferengi'); t.loadGame(4);
      return { before, after: read() };
    });
    assert.equal(r.after, r.before);
  });

  await check('new-feature', 'AI-REASONS an AI evacuates a world only when a superior force is bound for it, and escorts it when it is blockaded; quiet worlds are left alone', async () => {
    await fresh('eb-ai');
    const r = await ev(() => {
      const t = testBM1, s = t.state, book = t.campaign();
      window.__adv(20);
      // Quiet worlds: an AI evacuation of a world no assault or invasion was sent against. (Since
      // STRATEGIC-TIME-SCALE-CORRECTION the AI's own wars pick populous targets in the first weeks, and
      // their evacuations are the rule working, not a quiet world evacuated.)
      const attacked = new Set((book.operations || []).filter((o) => ['assault', 'invasion'].includes(o.kind)).map((o) => Number(o.targetSystem)));
      const quiet = (book.evacuations || []).filter((e) => e.sponsor !== 'player' && !attacked.has(Number(e.origin))).length;
      const underAttack = (book.evacuations || []).filter((e) => e.sponsor !== 'player' && attacked.has(Number(e.origin))).length;
      const ac = t.getSystemIndexByName('Alpha Centauri');
      const terran = book.polities.terran.hulls.filter((h) => h.status === 'ready' && !h.opId).slice(0, 5);
      for (const h of terran) h.systemIndex = ac;
      const kl = book.polities.klingon.hulls.filter((h) => h.status === 'ready' && !h.opId).slice(0, 45);
      const op = t.Campaign.launchOperation(book, t.buildCampaignWorld(true), 'klingon', kl, ac, s.day, 8, 'assault', []);
      op.arriveDay = s.day + 8;
      window.__adv(1);
      const evac = (book.evacuations || []).find((e) => e.origin === ac && e.status === 'active');
      return { quiet, underAttack, started: evac ? { sponsor: evac.sponsor, dest: evac.destination, transports: evac.transports.length, reason: evac.reason, destHolder: t.buildCampaignWorld(true).systems[evac.destination].controller } : null };
    });
    assert.equal(r.quiet, 0, 'an AI evacuated a world nobody was attacking');
    assert.ok(r.started, 'a threatened AI world did not evacuate');
    assert.equal(r.started.sponsor, 'terran'); assert.equal(r.started.destHolder, 'terran');
    assert.ok(r.started.transports > 0); assert.match(r.started.reason, /bound for it/);
  });

  // combined --------------------------------------------------------------------------------------
  const integration = async (saveMid) => ev((saveMid) => {
    const t = testBM1;
    const P = window.__Q();
    for (const i of [P, 0]) t.markSystemVisited(i);
    const ids = window.__freighters('fr', P, 4);
    // Heavy escorts: six Sovereign-class command cruisers.
    const esc = Array.from({ length: 6 }, (_, k) => window.__ship(`esc${k}`, P, 329, 2000));
    const e = t.startPlayerEvacuation(P, t.getSystemIndexByName('Earth'), ids, { target: 4000000 }).record;
    const trace = [];
    const phase = (label, days) => {
      const m0 = window.__evacById(e.id).moved, r0 = window.__runs(window.__evacById(e.id)).length;
      window.__adv(days);
      const x = window.__evacById(e.id), runs = window.__runs(x).slice(r0).map((r) => r.outcome);
      trace.push([label, x.moved, x.moved - m0, x.status, days, runs, runs.filter((o) => t.Campaign.blockadeRunContinues(o)).length]);
    };
    const trip = window.__trip(e);
    phase('clear', 2 * trip);
    const id = window.__aiBlockade('klingon', P, 20);
    phase('blockade', 4 * trip);
    if (saveMid) { t.saveGame(3); t.startWithFaction('ferengi'); t.loadGame(3); }
    t.assignPlayerEscorts(e.id, esc);
    phase('escorted', 4 * trip);
    const book = t.campaign();
    const b = window.__block(id);
    for (const h of book.polities.klingon.hulls) if (b.hulls.some((x) => x.hullId === h.id)) { h.status = 'lost'; h.hull = 0; }
    phase('broken', 3 * trip);
    const x = window.__evacById(e.id);
    return { trace, status: x.status, moved: x.moved, target: x.target, block: window.__block(id).status, runs: window.__runs(x).map((r) => r.outcome) };
  }, saveMid);
  await check('new-feature', 'EVAC-BLOCKADE-INTEGRATION evacuation progresses, a blockade cuts it, escorts and losses break the blockade, it recovers and completes; saving mid-way changes nothing', async () => {
    await fresh('eb-integration');
    const a = await integration(false);
    await ev(() => { testBM1.openCampaignPanel('strategic'); });
    await shot('eb-operations-after.png');
    await ev(() => testBM1.closeCampaignPanel());
    await fresh('eb-integration');
    const b = await integration(true);
    // On real legs a round trip here is weeks long, and a convoy turned back at its home port loses the
    // days until it tries again, not a trip: what the blockade does is measured on the runs themselves (how
    // often the convoy is let through), and deliveries per day are recorded alongside (the handoff's
    // measurements). [STRATEGIC-MOVEMENT-UNIFICATION]
    const ph = (label) => a.trace.find((y) => y[0] === label);
    const share = (label) => { const x = ph(label); return x[5].length ? x[6] / x[5].length : 1; };
    assert.equal(ph('clear')[5].length, 0, 'runs before any blockade');
    assert.ok(ph('blockade')[5].length > 0, `the convoy never met the blockade: ${JSON.stringify(a.trace)}`);
    assert.ok(share('blockade') < 1, `the blockade let every run through: ${JSON.stringify(a.trace)}`);
    assert.ok(share('escorted') >= share('blockade'), `escorts did not help the runs: ${JSON.stringify(a.trace)}`);
    assert.equal(ph('broken')[5].length, 0, `runs after the blockade was broken: ${JSON.stringify(a.trace)}`);
    assert.ok(ph('broken')[2] > 0, 'deliveries did not continue once the blockade was gone');
    console.log('   evac-blockade integration (label, moved, gained, status, days, runs, passed):', JSON.stringify(a.trace));
    assert.equal(a.block, 'broken');
    assert.ok(['completed', 'active'].includes(a.status));
    assert.equal(JSON.stringify(b), JSON.stringify(a), 'save/load mid-way changed the outcome');
  });

  // screenshots -----------------------------------------------------------------------------------
  await check('new-feature', 'SHOTS evacuation progress, a blockade cutting it, the map overlay, and a partial evacuation', async () => {
    await fresh('eb-shots');
    await ev(() => {
      const t = testBM1;
      const P = window.__P();
      for (const i of [P, 0, 2]) t.markSystemVisited(i);
      window.__ship('Transport Hale', P, 1); window.__ship('Transport Ibarra', P, 2); window.__ship('Transport Juno', P, 1);
      window.__ship('Escort Kestrel', P, 4, 1400);
      t.startPlayerEvacuation(P, t.getSystemIndexByName('Earth'), ['Transport Hale', 'Transport Ibarra', 'Transport Juno'], { target: 60000 });
      window.__adv(2);
      t.openCampaignPanel('strategic');
    });
    await shot('eb-evacuation-progress.png');
    await ev(() => { const t = testBM1; t.closeCampaignPanel(); window.__aiBlockade('klingon', window.__P(), 10); window.__adv(1); t.openCampaignPanel('strategic'); });
    await shot('eb-blockade-reduces.png');
    await ev(() => {
      const t = testBM1; t.closeCampaignPanel();
      const P = window.__P();
      t.state.selectedPlanet = P; t.openMap(); t.state.selectedPlanet = P;
      t.focusStarChartOnSystem?.(P, 2.6);
      t.drawInterstellarMapOverlay();
    });
    await page.waitForTimeout(200);
    await ev(() => testBM1.drawInterstellarMapOverlay());
    await shot('eb-map-overlay.png');
    await ev(() => { const t = testBM1; t.closeMap?.(); t.transferSystemControlToFaction(window.__P(), 'klingon'); window.__adv(1); t.openCampaignPanel('strategic'); document.querySelector('.campaign-body section:last-of-type')?.scrollIntoView({ block: 'start' }); });
    await shot('eb-partial-evacuation.png');
    await ev(() => testBM1.closeCampaignPanel());
  });

  // summary -----------------------------------------------------------------------------------------
  const byCat = {};
  for (const x of results) { byCat[x.category] ||= { ok: 0, n: 0 }; byCat[x.category].n++; if (x.ok) byCat[x.category].ok++; }
  console.log('\nSummary by category:');
  for (const [k, v] of Object.entries(byCat)) console.log(`  ${k}: ${v.ok}/${v.n}`);
  const failed = results.filter((x) => !x.ok);
  console.log(`${results.length - failed.length}/${results.length} evacuation/blockade checks passed.`);
  if (probe.errors.length) console.log(`page errors: ${probe.errors.join(' | ')}`);
  await probe.close();
  process.exit(failed.length || probe.errors.length ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
