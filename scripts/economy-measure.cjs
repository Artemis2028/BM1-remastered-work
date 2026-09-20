// Long-horizon measurements of the finite economy, driven through the real engine.
//
// This is not a model. It starts a campaign, learns a set of worlds, puts one or more fleet traders to
// work, and advances the campaign day by day, reading the same shelves, the same books of work and the
// same danger the captain would. Everything it reports is what the engine did.
//
// Nothing is tuned here, and nothing is changed: the ship roster still carries its shipped cargo
// capacities, and contract pay is still the engine's own `150 + min(350, distance*3) + hazard`.
//
// Usage: node scripts/economy-measure.cjs [--out dir] [--days 5000]
const fs = require('node:fs');
const path = require('node:path');
const { startProbe } = require('./probe-harness.cjs');

const outArg = process.argv.indexOf('--out');
const outDir = outArg > -1 ? process.argv[outArg + 1] : process.cwd();
const daysArg = process.argv.indexOf('--days');
const HORIZONS = [300, 1000, 3000, 5000];
const MAX_DAYS = daysArg > -1 ? Number(process.argv[daysArg + 1]) : HORIZONS[HORIZONS.length - 1];
const LEARN = 30;

const pad = (v, n) => String(v).padEnd(n);
const table = (title, head, body) => {
  const w = head.map((h, i) => Math.max(h.length, ...body.map((r) => String(r[i]).length)));
  const line = (c) => '| ' + c.map((v, i) => pad(v, w[i])).join(' | ') + ' |';
  return ['', `### ${title}`, '', line(head), '| ' + w.map((x) => '-'.repeat(x)).join(' | ') + ' |',
    ...body.map((r) => line(r.map(String))), ''].join('\n');
};
const money = (n) => Number(n).toLocaleString('en-US');

(async () => {
  const probe = await startProbe();
  const { ev, fresh } = probe;

  await probe.page.evaluate(() => {
    window.__econ = {
      setup(learn) {
        const t = testBM1, s = t.state;
        s.latinum = 250000; s.mylatinum = s.latinum; s.day = 1;
        s.playerFleet.length = 0;
        const home = s.currentPlanet;
        for (let i = 0; i < learn && i < s.planets.length; i++) {
          s.currentPlanet = i;
          t.markSystemVisited(i);
          t.recordMarketObservation(i);
        }
        s.currentPlanet = home;
        return home;
      },
      hulls() {
        const t = testBM1, s = t.state;
        const CARGO = /freighter|hauler|cargo|transport|tug|logistics|merchant|convoy|supply|courier|runabout|service craft|commerce/i;
        const HEAVY = /bulk|heavy|long-haul|grand|interstellar|frame/i;
        return Object.values(s.shipStatsById)
          .filter((x) => x && x.assetType === 'ship' && Number(x.cargoCapacity) > 0)
          .map((x) => {
            const role = String(x.role || '');
            const cargo = CARGO.test(role), heavy = cargo && HEAVY.test(role);
            return { id: Number(x.id), name: String(x.name), cls: String(x.shipClass || ''), role,
              tier: heavy ? 'heavyCargo' : cargo ? 'cargo' : 'warship',
              hold: Number(x.cargoCapacity), price: t.getShipPrice(x), mass: Number(x.mass) || 0 };
          });
      },
      // One run, snapshotted at each horizon, so a five-thousand-day answer costs one pass.
      run({ shipId, count, risk, days, marks, repair, learn, seed }) {
        const t = testBM1, s = t.state;
        t.startWithFaction('terran');
        const p = t.ensurePlaytestState(); delete p.diplomacy; delete p.campaign;
        t.fleetBook().campaignId = seed; t.campaign();
        const home = window.__econ.setup(learn);
        const ships = [];
        for (let k = 0; k < count; k++) {
          const f = { id: `econ-${k}`, shipId, name: `Trader ${k + 1}`, faction: s.playerFaction,
            assignment: 'defense', systemIndex: home, seed: k + 1 };
          s.playerFleet.push(f);
          t.autoAssignFleet(f);
          t.startFleetTrading(f.id, risk);
          ships.push(f);
        }
        const purse0 = s.latinum;
        const upkeepPerDay = ships.reduce((n, f) => n + t.upkeepPerDay(f.shipId), 0);
        const stats = ships.map(() => ({ idle: 0, stoppedDay: null, loadSum: 0, loadSamples: 0 }));
        const snapshots = {};
        for (let d = 1; d <= days; d++) {
          s.day += 1;
          t.completeFleetJourneys();
          t.advanceFleetTrading(s.day);
          for (let k = 0; k < ships.length; k++) {
            const f = ships[k], tr = f.trade;
            if (!tr) continue;
            if (tr.stage !== 'outbound') stats[k].idle++;
            if (stats[k].stoppedDay === null && !tr.active && tr.stage === 'holding') stats[k].stoppedDay = d;
            if (tr.stage === 'outbound') {
              const hold = t.fleetTradeCapacity(f);
              if (hold > 0) { stats[k].loadSum += t.fleetTradeLoad(tr) / hold; stats[k].loadSamples++; }
            }
            // The captain maintaining her ships: without a repair loop a trader is crippled once and
            // idle for ever, which would make every long horizon a measure of how fast it broke.
            if (repair && tr.stage !== 'outbound' && f.vessel && f.vessel.condition !== 'destroyed'
                && f.vessel.hull < f.vessel.maxHull) {
              f.vessel.hull = f.vessel.maxHull;
              f.vessel.shields = f.vessel.maxShields;
              f.vessel.condition = 'operational';
              if (!tr.active) { tr.active = true; tr.stage = 'idle'; tr.note = ''; }
            }
          }
          if (marks.includes(d)) {
            const per = ships.map((f, k) => {
              const tr = f.trade || {};
              return {
                cumulative: Math.round(tr.cumulative || 0),
                circuits: tr.circuits || 0,
                contract: Math.round(tr.contractIncome || 0),
                commodity: Math.round(tr.commodityIncome || 0),
                idle: stats[k].idle,
                stoppedDay: stats[k].stoppedDay,
                fill: stats[k].loadSamples ? stats[k].loadSum / stats[k].loadSamples : 0,
                hull: f.vessel ? f.vessel.hull / f.vessel.maxHull : 1,
                destroyed: Boolean(f.destroyed),
              };
            });
            snapshots[d] = {
              day: d,
              purse: s.latinum,
              net: s.latinum - purse0,
              upkeep: upkeepPerDay * d,
              traders: per,
              total: per.reduce((n, x) => n + x.cumulative, 0),
              circuits: per.reduce((n, x) => n + x.circuits, 0),
              contract: per.reduce((n, x) => n + x.contract, 0),
              commodity: per.reduce((n, x) => n + x.commodity, 0),
              idle: per.reduce((n, x) => n + x.idle, 0),
              destroyed: per.filter((x) => x.destroyed).length,
            };
          }
        }
        return snapshots;
      },
    };
  });

  const hulls = await ev(() => window.__econ.hulls());
  const byTier = (tier, cls) => hulls.filter((h) => h.tier === tier && (!cls || h.cls === cls));
  const cheapest = (list) => list.slice().sort((a, b) => a.price - b.price)[0];
  const biggest = (list) => list.slice().sort((a, b) => b.hold - a.hold)[0];
  const median = (list) => list.slice().sort((a, b) => a.price - b.price)[Math.floor((list.length - 1) / 2)];
  const cast = [
    { label: 'starter ship', hull: cheapest(byTier('warship', 'shuttle')) },
    { label: 'ordinary cruiser', hull: median(byTier('warship', 'cruiser')) },
    { label: 'normal freighter', hull: biggest(byTier('cargo', 'lightCruiser')) },
    { label: 'heavy freighter', hull: biggest(byTier('heavyCargo')) },
  ].filter((c) => c.hull);

  const runs = {};
  for (const c of cast) {
    await fresh(`econ-${c.label}`);
    runs[c.label] = await ev((arg) => window.__econ.run(arg), {
      shipId: c.hull.id, count: 1, risk: 'cautious', days: MAX_DAYS, marks: HORIZONS, repair: true,
      learn: LEARN, seed: `econ-${c.label}`,
    });
  }
  // the same heavy freighter with nobody maintaining her
  await fresh('econ-unmaintained');
  const unmaintained = await ev((arg) => window.__econ.run(arg), {
    shipId: cast[cast.length - 1].hull.id, count: 1, risk: 'cautious', days: MAX_DAYS, marks: HORIZONS,
    repair: false, learn: LEARN, seed: 'econ-unmaintained',
  });
  // risk settings, maintained, at the long horizon
  const byRisk = {};
  for (const risk of ['safe', 'cautious', 'risky', 'any']) {
    await fresh(`econ-risk-${risk}`);
    byRisk[risk] = await ev((arg) => window.__econ.run(arg), {
      shipId: cast[cast.length - 1].hull.id, count: 1, risk, days: MAX_DAYS, marks: HORIZONS,
      repair: true, learn: LEARN, seed: `econ-risk-${risk}`,
    });
  }
  // several traders on one economy
  const competition = {};
  for (const count of [1, 2, 4]) {
    await fresh(`econ-competition-${count}`);
    competition[count] = await ev((arg) => window.__econ.run(arg), {
      shipId: cast[cast.length - 1].hull.id, count, risk: 'cautious', days: MAX_DAYS, marks: HORIZONS,
      repair: true, learn: LEARN, seed: `econ-competition-${count}`,
    });
  }
  const worlds = await ev((learn) => {
    const t = testBM1, s = t.state;
    t.startWithFaction('terran');
    window.__econ.setup(learn);
    const rows = s.planets.map((p, i) => ({ i, name: p.name, ...t.worldTradeCapability(i) }));
    const live = rows.filter((w) => w.inhabited);
    const band = (f) => {
      const v = live.map(f).sort((a, b) => a - b);
      const q = (x) => v[Math.floor((v.length - 1) * x)];
      return `${v[0]} / ${q(0.25)} / ${q(0.5)} / ${q(0.75)} / ${v[v.length - 1]}`;
    };
    const sorted = live.slice().sort((a, b) => a.score - b.score);
    const c1 = sorted[Math.floor(sorted.length / 3)].score, c2 = sorted[Math.floor((sorted.length * 2) / 3)].score;
    const size = (w) => (w.score <= c1 ? 'small' : w.score <= c2 ? 'medium' : 'major');
    const bySize = {};
    for (const key of ['small', 'medium', 'major']) {
      const list = live.filter((w) => size(w) === key);
      const b = (f) => {
        const v = list.map(f).sort((a, b) => a - b);
        const q = (x) => v[Math.floor((v.length - 1) * x)];
        return `${v[0]} / ${q(0.5)} / ${v[v.length - 1]}`;
      };
      bySize[key] = { worlds: list.length, example: list[Math.floor(list.length / 2)].name,
        tons: b((w) => w.tons), demand: b((w) => w.demand), replenish: b((w) => w.replenish), jobs: b((w) => w.jobs) };
    }
    // what the world's book of work actually looks like
    const tonnage = [], pay = [];
    for (const w of live.slice(0, 40)) for (const j of t.worldOpenJobs(w.i)) { tonnage.push(j.tons); pay.push(j.payPerTon); }
    const stat = (v) => { const a = v.slice().sort((x, y) => x - y); const q = (p) => a[Math.floor((a.length - 1) * p)];
      return { n: a.length, min: a[0], p25: q(0.25), med: q(0.5), p75: q(0.75), max: a[a.length - 1] }; };
    return { total: rows.length, live: live.length, dead: rows.length - live.length,
      deadNames: rows.filter((w) => !w.inhabited).map((w) => w.name),
      popBand: band((w) => w.pop), bySize, tonnage: stat(tonnage), pay: stat(pay) };
  }, LEARN);

  const L = [];
  L.push('# Finite economy — long-horizon measurements');
  L.push('');
  L.push(`Driven through the engine, not modelled. ${worlds.total} worlds: **${worlds.live} with an economy**, `
    + `**${worlds.dead} without one** (${worlds.deadNames.join(', ')}). Population across the living worlds `
    + `(min / p25 / median / p75 / max): **${worlds.popBand}**.`);
  L.push(table('What a world carries and hires for (min / median / max)',
    ['size', 'worlds', 'example', 'tons per good', 'demand per good', 'replenish t/day', 'open jobs'],
    ['small', 'medium', 'major'].map((k) => {
      const b = worlds.bySize[k];
      return [k, b.worlds, b.example, b.tons, b.demand, b.replenish, b.jobs];
    })));
  L.push(`Shipments on the board (n / min / p25 / median / p75 / max): tonnage **${worlds.tonnage.n} / `
    + `${worlds.tonnage.min} / ${worlds.tonnage.p25} / ${worlds.tonnage.med} / ${worlds.tonnage.p75} / ${worlds.tonnage.max}**, `
    + `pay per ton **${worlds.pay.min} / ${worlds.pay.p25} / ${worlds.pay.med} / ${worlds.pay.p75} / ${worlds.pay.max} L** — `
    + `the engine's shipped rate, untouched.`);

  const rows = [];
  for (const c of cast)
    for (const d of HORIZONS) {
      const snap = runs[c.label][d];
      if (!snap) continue;
      const tr = snap.traders[0];
      const perDay = tr.cumulative / d;
      rows.push([c.label, c.hull.hold, money(c.hull.price), d, money(tr.cumulative), Math.round(perDay),
        tr.circuits, tr.circuits ? money(Math.round(tr.cumulative / tr.circuits)) : 0,
        `${Math.round(tr.fill * 100)}%`, money(tr.contract), money(tr.commodity), money(snap.upkeep),
        `${Math.round((tr.idle / d) * 100)}%`, perDay > 0 ? Math.round(c.hull.price / perDay) : '-']);
    }
  L.push(table('One maintained trader, Cautious',
    ['hull', 'hold', 'price', 'days', 'net L', 'L/day', 'circuits', 'L/circuit', 'hold used',
      'shipments L', 'commodities L', 'upkeep L', 'idle', 'payback days'],
    rows));

  L.push(table('The same heavy freighter with nobody repairing her',
    ['days', 'net L', 'circuits', 'hull left', 'idle', 'stopped on day'],
    HORIZONS.filter((d) => unmaintained[d]).map((d) => {
      const tr = unmaintained[d].traders[0];
      return [d, money(tr.cumulative), tr.circuits, `${Math.round(tr.hull * 100)}%`,
        `${Math.round((tr.idle / d) * 100)}%`, tr.stoppedDay ?? 'still going'];
    })));

  L.push(table('Danger setting, one maintained heavy freighter',
    ['setting', ...HORIZONS.map((d) => `${d}d net L`), 'circuits at 5000', 'hull left', 'idle at 5000'],
    Object.entries(byRisk).map(([risk, snaps]) => {
      const last = snaps[HORIZONS[HORIZONS.length - 1]];
      return [risk, ...HORIZONS.map((d) => snaps[d] ? money(snaps[d].traders[0].cumulative) : '-'),
        last ? last.traders[0].circuits : '-',
        last ? `${Math.round(last.traders[0].hull * 100)}%` : '-',
        last ? `${Math.round((last.traders[0].idle / HORIZONS[HORIZONS.length - 1]) * 100)}%` : '-'];
    })));

  L.push(table('Several heavy freighters on one economy',
    ['traders', ...HORIZONS.map((d) => `${d}d each`), 'circuits each at 5000', 'idle each at 5000'],
    Object.entries(competition).map(([n, snaps]) => {
      const c = Number(n);
      const last = snaps[HORIZONS[HORIZONS.length - 1]];
      return [n, ...HORIZONS.map((d) => snaps[d] ? money(Math.round(snaps[d].total / c)) : '-'),
        last ? Math.round(last.circuits / c) : '-',
        last ? `${Math.round((last.idle / c / HORIZONS[HORIZONS.length - 1]) * 100)}%` : '-'];
    })));

  fs.mkdirSync(outDir, { recursive: true });
  fs.writeFileSync(path.join(outDir, 'economy-measurements.json'),
    JSON.stringify({ horizons: HORIZONS, learn: LEARN, worlds, cast, runs, unmaintained, byRisk, competition }, null, 1) + '\n');
  console.log(L.join('\n'));
  console.log(`\nWritten to ${path.join(outDir, 'economy-measurements.json')}`);
  if (probe.errors.length) { console.log(`page errors: ${probe.errors.slice(0, 4).join(' | ')}`); process.exitCode = 1; }
  await Promise.race([probe.close(), new Promise((r) => setTimeout(r, 15000))]);
  process.exit(process.exitCode || 0);
})().catch((e) => { console.error(e); process.exit(1); });
