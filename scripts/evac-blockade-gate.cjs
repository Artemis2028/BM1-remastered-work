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
    window.__fleetStrategic = () => JSON.stringify(t.state.playerFleet.filter((f) => !f.destroyed).map((f) => [f.id, f.strategicOp || null, f.strategicRole || null, f.systemIndex, window.__vid(f.id)]));
  });

  // 1 ---------------------------------------------------------------------------------------------
  await check('new-feature', 'EVAC-FINITE an evacuation moves a finite capacity over several strategic days, at the rate its real transports allow', async () => {
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
      for (let k = 0; k < 3; k++) { window.__adv(1); days.push(e.moved); }
      const lift = e.transports.reduce((n, x) => n + x.lift, 0);
      return { fail: null, days, target: e.target, lift, trip: 2 * (e.route.length - 1) + 1, status: e.status };
    });
    assert.ok(!r.fail, r.fail);
    assert.ok(r.days[0] > 0 && r.days[0] < r.target, `day one moved ${r.days[0]} of ${r.target}`);
    assert.ok(r.days[1] > r.days[0] && r.days[2] > r.days[1], `no progress over days: ${r.days}`);
    assert.equal(r.days[0], Math.floor(r.lift / r.trip), 'throughput is not the transports\' lift over the round trip');
    assert.equal(r.status, 'active');
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

  await check('new-feature', 'EVAC-LOSS-REDUCES losing a transport lowers the throughput, and the loss is recorded against the vessel\'s vid', async () => {
    await fresh('eb-loss');
    const r = await ev(() => {
      const t = testBM1, s = t.state;
      const P = window.__P();
      window.__ship('tA', P, 1); window.__ship('tB', P, 1); window.__ship('tC', P, 1);
      const vid = window.__vid('tC');
      const e = t.startPlayerEvacuation(P, t.getSystemIndexByName('Earth'), ['tA', 'tB', 'tC'], { target: 60000 }).record;
      window.__adv(1); const full = e.lastThroughput;
      s.playerFleet.find((f) => f.id === 'tC').destroyed = true;
      window.__adv(1);
      return { full, reduced: e.lastThroughput, transports: e.transports.length, lost: e.lost, vid };
    });
    assert.equal(r.transports, 2);
    assert.ok(r.reduced < r.full && Math.abs(r.reduced - r.full * 2 / 3) <= 2, `throughput ${r.full} → ${r.reduced}`);
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
      window.__adv(1);
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
      window.__adv(6);
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
      window.__adv(2);
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
  await check('new-feature', 'BLOCKADE-STRONG-REDUCES a strong blockade cuts the evacuation\'s throughput hard; the route reads as interdicted', async () => {
    await fresh('eb-strong');
    const r = await ev(() => {
      const t = testBM1;
      const P = window.__P();
      window.__ship('tA', P, 1); window.__ship('tB', P, 2);
      const e = t.startPlayerEvacuation(P, t.getSystemIndexByName('Earth'), ['tA', 'tB'], { target: 60000 }).record;
      window.__adv(1); const clear = e.lastThroughput;
      const id = window.__aiBlockade('klingon', P, 12);
      window.__adv(1);
      const b = window.__block(id);
      return { clear, blocked: e.lastThroughput, factor: e.lastFactor, coverage: b.coverage, tier: t.Campaign.blockadeTier(b.coverage) };
    });
    assert.equal(r.tier, 'heavy', `coverage ${r.coverage}`);
    assert.ok(r.blocked < r.clear * 0.5, `throughput ${r.clear} → ${r.blocked}`);
  });

  await check('new-feature', 'BLOCKADE-WEAK-LEAKS a weak blockade leaks: the evacuation keeps most of its throughput', async () => {
    await fresh('eb-weak');
    const r = await ev(() => {
      const t = testBM1;
      const P = window.__P();
      window.__ship('tA', P, 1); window.__ship('tB', P, 2);
      const e = t.startPlayerEvacuation(P, t.getSystemIndexByName('Earth'), ['tA', 'tB'], { target: 60000 }).record;
      window.__adv(1); const clear = e.lastThroughput;
      const id = window.__aiBlockade('klingon', P, 1);
      window.__adv(1);
      const b = window.__block(id);
      return { clear, weak: e.lastThroughput, tier: t.Campaign.blockadeTier(b.coverage), moved: e.moved };
    });
    assert.notEqual(r.tier, 'heavy');
    assert.ok(r.weak > 0 && r.weak >= r.clear * 0.5, `throughput ${r.clear} → ${r.weak}`);
  });

  await check('new-feature', 'BLOCKADE-WEAKENED escorts soften it, losses weaken it, and a blockade whose force is gone ends: throughput recovers', async () => {
    await fresh('eb-weaken');
    const r = await ev(() => {
      const t = testBM1, book = t.campaign();
      const P = window.__P();
      window.__ship('tA', P, 1); window.__ship('tB', P, 2);
      for (let i = 0; i < 4; i++) window.__ship(`esc${i}`, P, 4, 1400);
      const e = t.startPlayerEvacuation(P, t.getSystemIndexByName('Earth'), ['tA', 'tB'], { target: 60000 }).record;
      const id = window.__aiBlockade('klingon', P, 8);
      window.__adv(1); const blocked = e.lastThroughput;
      t.assignPlayerEscorts(e.id, ['esc0', 'esc1', 'esc2', 'esc3']);
      window.__adv(1); const escorted = e.lastThroughput;
      const b = window.__block(id);
      // The blockade's ships are destroyed (by whatever): it is weaker, then gone.
      const kl = book.polities.klingon.hulls;
      const mine = b.hulls.map((x) => x.hullId);
      for (const h of kl) if (mine.slice(0, 4).includes(h.id)) { h.status = 'lost'; h.hull = 0; }
      window.__adv(1); const thinner = { throughput: e.lastThroughput, coverage: b.coverage };
      for (const h of kl) if (mine.includes(h.id)) { h.status = 'lost'; h.hull = 0; }
      window.__adv(1);
      return { blocked, escorted, thinner, status: b.status, why: b.endReason, after: e.lastThroughput, clearFactor: e.lastFactor };
    });
    assert.ok(r.escorted > r.blocked, `escorts did not help: ${r.blocked} → ${r.escorted}`);
    assert.ok(r.thinner.throughput >= r.escorted, 'losses did not weaken the blockade');
    assert.equal(r.status, 'broken'); assert.match(r.why, /gone/);
    assert.equal(r.clearFactor, 1, 'throughput did not recover after the blockade ended');
  });

  // 12 --------------------------------------------------------------------------------------------
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

  await check('new-feature', 'EVAC-THROUGH-CEASEFIRE an evacuation is not hostile: it continues through a ceasefire, at full rate once the blockade is closed', async () => {
    await fresh('eb-evac-cease');
    const r = await ev(() => {
      const t = testBM1;
      const P = window.__P();
      window.__ship('tA', P, 1); window.__ship('tB', P, 2);
      const e = t.startPlayerEvacuation(P, t.getSystemIndexByName('Earth'), ['tA', 'tB'], { target: 60000 }).record;
      const id = window.__aiBlockade('klingon', P, 10);
      window.__adv(1); const blocked = e.lastFactor;
      t.changeDiplomacy('terran', 'klingon', 'ceasefire');
      const empire = t.playerRelation('klingon').status;
      window.__adv(1);
      return { blocked, empire, status: e.status, factor: e.lastFactor, block: window.__block(id).status };
    });
    assert.ok(r.blocked < 1);
    assert.equal(r.empire, 'ceasefire', 'precondition: the empire\'s inherited war did not follow');
    assert.equal(r.block, 'closed');
    assert.equal(r.status, 'active'); assert.equal(r.factor, 1);
  });

  // 15 & 16 ---------------------------------------------------------------------------------------
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
      const quiet = (book.evacuations || []).filter((e) => e.sponsor !== 'player').length;
      const ac = t.getSystemIndexByName('Alpha Centauri');
      const terran = book.polities.terran.hulls.filter((h) => h.status === 'ready' && !h.opId).slice(0, 5);
      for (const h of terran) h.systemIndex = ac;
      const kl = book.polities.klingon.hulls.filter((h) => h.status === 'ready' && !h.opId).slice(0, 45);
      const op = t.Campaign.launchOperation(book, t.buildCampaignWorld(true), 'klingon', kl, ac, s.day, 8, 'assault', []);
      op.arriveDay = s.day + 8;
      window.__adv(1);
      const evac = (book.evacuations || []).find((e) => e.origin === ac && e.status === 'active');
      return { quiet, started: evac ? { sponsor: evac.sponsor, dest: evac.destination, transports: evac.transports.length, reason: evac.reason, destHolder: t.buildCampaignWorld(true).systems[evac.destination].controller } : null };
    });
    assert.equal(r.quiet, 0, 'an AI evacuated a world nobody was attacking');
    assert.ok(r.started, 'a threatened AI world did not evacuate');
    assert.equal(r.started.sponsor, 'terran'); assert.equal(r.started.destHolder, 'terran');
    assert.ok(r.started.transports > 0); assert.match(r.started.reason, /bound for it/);
  });

  // combined --------------------------------------------------------------------------------------
  const integration = async (saveMid) => ev((saveMid) => {
    const t = testBM1;
    const P = window.__P();
    for (const i of [P, 0]) t.markSystemVisited(i);
    window.__ship('tA', P, 1); window.__ship('tB', P, 2); window.__ship('tC', P, 1);
    for (let i = 0; i < 4; i++) window.__ship(`esc${i}`, P, 4, 1400);
    const e = t.startPlayerEvacuation(P, t.getSystemIndexByName('Earth'), ['tA', 'tB', 'tC'], { target: 60000 }).record;
    const trace = [];
    const step = (label) => { window.__adv(1); const x = window.__evacById(e.id); trace.push([label, x.moved, x.lastThroughput, x.status]); };
    step('clear'); step('clear');
    const id = window.__aiBlockade('klingon', P, 10);
    step('blockade'); step('blockade');
    if (saveMid) { t.saveGame(3); t.startWithFaction('ferengi'); t.loadGame(3); }
    t.assignPlayerEscorts(e.id, ['esc0', 'esc1', 'esc2', 'esc3']);
    step('escorted'); step('escorted');
    const book = t.campaign();
    const b = window.__block(id);
    for (const h of book.polities.klingon.hulls) if (b.hulls.some((x) => x.hullId === h.id)) { h.status = 'lost'; h.hull = 0; }
    for (let i = 0; i < 12; i++) step('broken');
    const x = window.__evacById(e.id);
    return { trace, status: x.status, moved: x.moved, target: x.target, block: window.__block(id).status };
  }, saveMid);
  await check('new-feature', 'EVAC-BLOCKADE-INTEGRATION evacuation progresses, a blockade cuts it, escorts and losses break the blockade, it recovers and completes; saving mid-way changes nothing', async () => {
    await fresh('eb-integration');
    const a = await integration(false);
    await ev(() => { testBM1.openCampaignPanel('strategic'); });
    await shot('eb-operations-after.png');
    await ev(() => testBM1.closeCampaignPanel());
    await fresh('eb-integration');
    const b = await integration(true);
    const tp = (label) => a.trace.filter((x) => x[0] === label).map((x) => x[2]);
    assert.ok(Math.max(...tp('blockade')) < Math.min(...tp('clear')), `the blockade did not cut throughput: ${JSON.stringify(a.trace)}`);
    assert.ok(Math.min(...tp('escorted')) > Math.max(...tp('blockade')), 'escorts did not raise throughput');
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
