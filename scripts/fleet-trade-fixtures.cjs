// Seeded fixtures for autonomous fleet trading.
//
// Every row is produced from a fixed campaign seed and a fixed set of worlds the captain has read, so
// two runs of this file on the same tree produce the same table. The table is the evidence for the
// parts of §4 that a pass/fail gate states but does not show: what each danger setting is willing to
// consider, how the hold scales what a run earns, what a stale price does to a committed run, what a
// government that refuses the captain does to their freighters, and what survives a reload.
//
// Usage: node scripts/fleet-trade-fixtures.cjs [--out path.json]
const fs = require('node:fs');
const path = require('node:path');
const { startProbe } = require('./probe-harness.cjs');

const outArg = process.argv.indexOf('--out');
const outPath = outArg > -1 ? process.argv[outArg + 1] : path.join(process.cwd(), 'fleet-trade-fixtures.json');
const SEED = 'fixture-fleet-trade';
const LEARN = 20;

const pad = (v, n) => String(v).padEnd(n);
const table = (title, head, rows) => {
  const widths = head.map((h, i) => Math.max(h.length, ...rows.map((r) => String(r[i]).length)));
  const line = (cells) => '| ' + cells.map((c, i) => pad(c, widths[i])).join(' | ') + ' |';
  return [`\n### ${title}`, '', line(head), '| ' + widths.map((w) => '-'.repeat(w)).join(' | ') + ' |',
    ...rows.map((r) => line(r.map(String))), ''].join('\n');
};

(async () => {
  const probe = await startProbe();
  const { ev, fresh } = probe;

  await probe.page.evaluate(() => {
    window.__fx = {
      setup(learn) {
        const t = testBM1, s = t.state;
        s.latinum = 100000; s.mylatinum = s.latinum; s.day = 10;
        s.playerFleet.length = 0;
        const home = s.currentPlanet;
        for (let i = 0; i < learn; i++) { s.currentPlanet = i; t.markSystemVisited(i); t.recordMarketObservation(i); }
        s.currentPlanet = home;
        return home;
      },
      ship(id, pick) {
        const t = testBM1, s = t.state;
        const ships = Object.values(s.shipStatsById)
          .filter((x) => x && x.assetType === 'ship' && Number(x.cargoCapacity) > 0)
          .sort((a, b) => Number(a.cargoCapacity) - Number(b.cargoCapacity));
        const stats = ships[Math.min(ships.length - 1, Math.max(0, Math.round((ships.length - 1) * pick)))];
        const f = { id, shipId: Number(stats.id), name: id, faction: s.playerFaction,
          assignment: 'defense', systemIndex: s.currentPlanet, seed: 17 };
        s.playerFleet.push(f); t.autoAssignFleet(f);
        return { id, shipId: f.shipId, hull: stats.name, capacity: Number(stats.cargoCapacity) || 0 };
      },
      days(n) {
        const t = testBM1, s = t.state;
        for (let i = 0; i < n; i++) { s.day += 1; t.completeFleetJourneys(); t.advanceFleetTrading(s.day); }
      },
    };
  });

  const fixtures = {};

  // 1. Each danger setting: how many destinations it will consider, and why the rest are out.
  await fresh(SEED);
  fixtures.risk = await ev((learn) => {
    const t = testBM1, s = t.state;
    window.__fx.setup(learn);
    const ship = window.__fx.ship('fx-risk', 1);
    const f = s.playerFleet.find((x) => x.id === 'fx-risk');
    const rows = [];
    for (const level of t.TRADE_RISK_LEVELS) {
      const list = t.fleetTradeCandidates(f, t.ensureFleetTradeState(f, level));
      const rule = t.TRADE_RISK_RULES[level];
      const plan = t.planFleetTradeRun(f, f.trade);
      const bandsSeen = list.map((i) => { const b = t.plannedRiskBand(i); return b ? b.band : null; });
      rows.push({
        level, maxBand: rule.maxBand, acceptUnreported: rule.acceptUnreported,
        candidates: list.length,
        worstBand: bandsSeen.some((b) => b === null) ? 'unreported' : Math.max(-1, ...bandsSeen.filter((b) => b !== null)),
        chose: plan.ok ? s.planets[plan.plan.to]?.name : null,
        goods: plan.ok ? plan.plan.goods : null,
        tons: plan.ok ? plan.plan.tons : 0,
        days: plan.ok ? plan.plan.days : 0,
        expected: plan.ok ? plan.plan.net : 0,
        note: plan.ok ? '' : plan.note,
      });
    }
    const bands = {};
    for (let i = 0; i < learn; i++) { const b = t.plannedRiskBand(i); bands[b ? b.band : 'unreported'] = (bands[b ? b.band : 'unreported'] || 0) + 1; }
    return { ship, rows, bands };
  }, LEARN);

  // 2. Cargo capacity: the same route, five hulls, what each can carry and earn.
  await fresh(SEED);
  fixtures.capacity = await ev((learn) => {
    const t = testBM1, s = t.state;
    window.__fx.setup(learn);
    const rows = [];
    for (const pick of [0, 0.25, 0.5, 0.75, 1]) {
      s.playerFleet.length = 0;
      const ship = window.__fx.ship(`fx-cap-${pick}`, pick);
      const f = s.playerFleet.find((x) => x.id === `fx-cap-${pick}`);
      const plan = t.planFleetTradeRun(f, t.ensureFleetTradeState(f, 'any'));
      rows.push({ hull: ship.hull, capacity: ship.capacity, upkeep: t.upkeepPerDay(ship.shipId),
        tons: plan.ok ? plan.plan.tons : 0, days: plan.ok ? plan.plan.days : 0,
        expected: plan.ok ? plan.plan.net : 0, perDay: plan.ok ? Math.round(plan.plan.score) : 0,
        note: plan.ok ? '' : plan.note });
    }
    return { rows };
  }, LEARN);

  // 3. Stale prices: a run priced on a remembered board, sold into the board that is there.
  await fresh(SEED);
  fixtures.stale = await ev((learn) => {
    const t = testBM1, s = t.state;
    window.__fx.setup(learn);
    window.__fx.ship('fx-stale', 1);
    const f = s.playerFleet.find((x) => x.id === 'fx-stale');
    const rows = [];
    for (const actual of [0, 0.5, 1, 1.5, 2]) {
      const purse = s.latinum;
      const plan = t.planFleetTradeRun(f, t.ensureFleetTradeState(f, 'any'));
      if (!plan.ok) { rows.push({ actual, note: plan.note }); continue; }
      const dest = plan.plan.to, goods = plan.plan.goods;
      const remembered = t.knownMarketPrice(dest, goods);
      t.startFleetTrading('fx-stale', 'any');
      window.__fx.days(1);
      const paid = f.trade.paid, tons = f.trade.tons, expected = f.trade.expectedProfit;
      t.getPlanetMarket(dest);
      const priced = Math.max(1, Math.round(remembered * actual));
      for (const o of s.planetMarkets[dest]) if (o.goods === goods) o.price = priced;
      t.stopFleetTrading('fx-stale');
      let guard = 0;
      while (f.trade.stage !== 'holding' && guard++ < 120) window.__fx.days(1);
      rows.push({ at: s.planets[dest]?.name, goods, tons, remembered, actual: priced, paid,
        expected, realised: f.trade.tripProfit, purseBefore: purse, purseAfter: s.latinum });
      f.trade.cumulative = 0;
    }
    return { rows };
  }, LEARN);

  // 4. Access: what a government that will not deal with the captain does to their freighters.
  await fresh(SEED);
  fixtures.access = await ev((learn) => {
    const t = testBM1, s = t.state;
    window.__fx.setup(learn);
    window.__fx.ship('fx-access', 1);
    const f = s.playerFleet.find((x) => x.id === 'fx-access');
    const trade = t.ensureFleetTradeState(f, 'any');
    const rows = [];
    const target = t.fleetTradeCandidates(f, trade).find((i) => {
      const key = s.conditionLog[i]?.controller;
      return key && key !== 'neutral' && key !== s.playerFaction;
    });
    const faction = target == null ? null : s.conditionLog[target].controller;
    for (const standing of [40, 0, -20, -40, -80]) {
      if (!faction) break;
      t.adjustFactionStanding(faction, standing - t.getFactionStanding(faction), { silent: true });
      const list = t.fleetTradeCandidates(f, trade);
      rows.push({ faction, standing: t.getFactionStanding(faction),
        attitude: t.getEffectiveAttitude(faction),
        refusal: t.serviceRefusal(faction) ? 'refused' : 'serves',
        candidates: list.length, targetConsidered: list.includes(target) });
    }
    return { target: target == null ? null : s.planets[target]?.name, faction, rows };
  }, LEARN);

  // 5/6. Profit and loss over a run of legs, and what the danger actually costs.
  await fresh(SEED);
  fixtures.running = await ev((learn) => {
    const t = testBM1, s = t.state;
    window.__fx.setup(learn);
    const rows = [];
    for (const level of t.TRADE_RISK_LEVELS) {
      s.playerFleet.length = 0;
      s.latinum = 100000; s.mylatinum = s.latinum;
      const ship = window.__fx.ship(`fx-run-${level}`, 1);
      const f = s.playerFleet.find((x) => x.id === `fx-run-${level}`);
      const before = s.latinum;
      t.startFleetTrading(`fx-run-${level}`, level);
      window.__fx.days(180);
      const v = f.vessel;
      rows.push({ level, before, after: s.latinum, cumulative: f.trade.cumulative,
        hull: v ? Math.round((v.hull / v.maxHull) * 100) : 100,
        condition: v ? v.condition : 'operational',
        destroyed: Boolean(f.destroyed), stage: f.trade.stage, note: f.trade.note,
        capacity: ship.capacity });
    }
    return { rows, days: 180 };
  }, LEARN);

  // 7. Save and reload, mid-run.
  await fresh(SEED);
  fixtures.persistence = await ev((learn) => {
    const t = testBM1, s = t.state;
    window.__fx.setup(learn);
    window.__fx.ship('fx-save', 1);
    t.startFleetTrading('fx-save', 'risky');
    window.__fx.days(40);
    const f = s.playerFleet.find((x) => x.id === 'fx-save');
    const snap = (g) => g ? { risk: g.trade.risk, stage: g.trade.stage, active: g.trade.active,
      goods: g.trade.goods, tons: g.trade.tons, paid: g.trade.paid, destination: g.trade.destination,
      etaDay: g.trade.etaDay, tripProfit: g.trade.tripProfit, cumulative: g.trade.cumulative } : null;
    const before = { trade: snap(f), markets: Object.keys(s.marketLog).length, latinum: s.latinum, day: s.day };
    t.saveGame(7);
    t.startWithFaction('terran');
    const wiped = { fleet: s.playerFleet.length, markets: Object.keys(s.marketLog || {}).length,
      boards: Object.keys(s.planetMarkets || {}).length };
    t.loadGame(7);
    const g = s.playerFleet.find((x) => x.id === 'fx-save');
    const after = { trade: snap(g), markets: Object.keys(s.marketLog).length, latinum: s.latinum, day: s.day };
    // and it keeps running from where it was
    window.__fx.days(40);
    return { before, wiped, after, resumedCumulative: g ? g.trade.cumulative : null, resumedStage: g ? g.trade.stage : null };
  }, LEARN);

  fixtures.meta = { seed: SEED, learnedWorlds: LEARN, generated: new Date().toISOString() };
  fs.mkdirSync(path.dirname(outPath), { recursive: true });
  fs.writeFileSync(outPath, JSON.stringify(fixtures, null, 2) + '\n');

  console.log(`# Fleet trade fixtures — seed ${SEED}, ${LEARN} worlds read`);
  console.log(`\nTrader hull: ${fixtures.risk.ship.hull} (${fixtures.risk.ship.capacity} t)`);
  console.log(`Planned risk bands across the worlds the captain has read: ${JSON.stringify(fixtures.risk.bands)}`);
  console.log(table('Danger setting', ['setting', 'max band', 'takes unreported', 'destinations', 'worst accepted', 'chose', 'goods', 'tons', 'days', 'expected L', 'note'],
    fixtures.risk.rows.map((r) => [r.level, r.maxBand, r.acceptUnreported, r.candidates, r.worstBand, r.chose ?? '-', r.goods ?? '-', r.tons, r.days, r.expected, r.note])));
  console.log(table('Cargo capacity', ['hull', 'capacity t', 'upkeep L/day', 'tons', 'days', 'expected L', 'L/day', 'note'],
    fixtures.capacity.rows.map((r) => [r.hull, r.capacity, r.upkeep, r.tons, r.days, r.expected, r.perDay, r.note])));
  console.log(table('Stale prices', ['at', 'goods', 'tons', 'remembered', 'actual', 'paid', 'expected L', 'realised L', 'purse before', 'purse after'],
    fixtures.stale.rows.map((r) => [r.at ?? '-', r.goods ?? '-', r.tons ?? 0, r.remembered ?? '-', r.actual ?? '-', r.paid ?? 0, r.expected ?? 0, r.realised ?? 0, r.purseBefore ?? 0, r.purseAfter ?? 0])));
  console.log(table(`Access — ${fixtures.access.faction ?? 'none'} at ${fixtures.access.target ?? 'none'}`,
    ['standing', 'attitude', 'port', 'destinations', 'that world considered'],
    fixtures.access.rows.map((r) => [r.standing, r.attitude, r.refusal, r.candidates, r.targetConsidered])));
  console.log(table(`Profit and loss over ${fixtures.running.days} days`,
    ['setting', 'purse before', 'purse after', 'realised L', 'hull %', 'condition', 'lost', 'ends', 'note'],
    fixtures.running.rows.map((r) => [r.level, r.before, r.after, r.cumulative, r.hull, r.condition, r.destroyed, r.stage, r.note])));
  const p = fixtures.persistence;
  console.log(table('Save and reload mid-run', ['field', 'before save', 'after new game', 'after load'],
    [['trade order', p.before.trade ? `${p.before.trade.risk}/${p.before.trade.stage}` : 'none', 'none', p.after.trade ? `${p.after.trade.risk}/${p.after.trade.stage}` : 'none'],
     ['tons aboard', p.before.trade?.tons ?? 0, 0, p.after.trade?.tons ?? 0],
     ['paid for cargo', p.before.trade?.paid ?? 0, 0, p.after.trade?.paid ?? 0],
     ['cumulative L', p.before.trade?.cumulative ?? 0, 0, p.after.trade?.cumulative ?? 0],
     ['remembered markets', p.before.markets, p.wiped.markets, p.after.markets],
     ['market boards', '-', p.wiped.boards, '-'],
     ['calendar day', p.before.day, '-', p.after.day]]));
  console.log(`\nAfter reload the trader kept running: stage ${p.resumedStage}, cumulative ${p.resumedCumulative} L.`);
  console.log(`\nWritten to ${outPath}`);
  if (probe.errors.length) { console.log(`page errors: ${probe.errors.join(' | ')}`); process.exitCode = 1; }
  await Promise.race([probe.close(), new Promise((r) => setTimeout(r, 15000))]);
  process.exit(process.exitCode || 0);
})().catch((e) => { console.error(e); process.exit(1); });
