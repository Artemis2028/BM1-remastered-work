// Seeded measurements of the PROPOSED finite economy, before any of it is built.
//
// Nothing in the game is changed by this file. It reads the real world — populations, market
// strengths, stations, routes and board prices — applies the proposed cargo capacities and the
// proposed finite commodity supply, demand and contract rules as a model, and reports what falls out.
// The point is to argue about numbers that came from the actual map rather than from a guess.
//
// Usage: node scripts/economy-measure.cjs [--out dir]
const fs = require('node:fs');
const path = require('node:path');
const { startProbe } = require('./probe-harness.cjs');

const outArg = process.argv.indexOf('--out');
const outDir = outArg > -1 ? process.argv[outArg + 1] : process.cwd();

const MODEL = {
  // A world's economic capability, from what the world already has. Nothing is named. The authored
  // population figures run to tens of thousands, so they are read per thousand — at face value they
  // swamped every other term and put every world on the ceiling.
  popPerThousand: 1.0,
  marketWeight: 0.6,     // per point of the authored market strength above the 4 floor
  stationWeight: 1.5,    // per surviving installation in the system
  // Tons of one good a world holds when full, and how fast it comes back.
  capacityPerPoint: 6,
  capacityFloor: 10,
  capacityCeiling: 220,
  replenishDays: 20,     // full shelf in about three weeks
  // Demand is the same shape: a world will absorb this much of a good before it stops paying for more.
  demandFraction: 0.8,
  // Cargo contracts.
  contractsPerPoint: 0.22,
  contractsCeiling: 6,
  contractTonsLow: 0.1,
  contractTonsHigh: 0.8,
  // How many different commodities one trip may combine, derived from the hold: no single world holds
  // eight hundred tons of one thing, so a large hold is only worth its price if it can carry several
  // shipments at once. A small ship carries one lot; a heavy freighter can work a whole board.
  tonsPerLot: 110,
  goodsPerTripCeiling: 8,
  // Cargo jobs: explicit tonnage, a named destination, paid on delivery. A board only ever shows eight
  // commodities and only a few of them have a spread worth flying, so beyond roughly three hundred tons
  // a hold has nothing to put in it. Contracts are what a large hold is actually for.
  contractPayPerTon: 3.0,
  contractPayPerTonPerDay: 0.8,
  jobRespawnDays: 12,
  // A circuit may serve this many destinations before coming to rest. One stop is a point-to-point run;
  // more than one is what a hold big enough to carry several shipments at once buys you.
  maxStops: 4,
  // A circuit a trader will actually commit to. Without this the planner cheerfully accepted a
  // four-stop loop across the whole map and was gone for most of a campaign year.
  maxCircuitDays: 40,
};

(async () => {
  const probe = await startProbe();
  const result = await probe.ev((MODEL) => {
    const t = testBM1, s = t.state;
    t.startWithFaction('terran');
    s.day = 1;

    const rand = (n) => { const x = Math.sin(n * 999.91) * 10000; return x - Math.floor(x); };
    const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));

    // ---- a world's economic capability, derived ------------------------------------------------
    const stationsAt = (i) => (s.stationDefinitions || [])
      .filter((d) => Number(d.systemIndex) === i && !s.destroyedStations?.[d.id]).length;
    const worlds = s.planets.map((p, i) => {
      const pop = Math.max(0, Number(p.population) || 0);
      const market = Math.max(0, (Number(p.market) || 0) - 4);
      const stations = stationsAt(i);
      // An uninhabited world with no installation has no economy at all: no goods, no demand, no jobs.
      // That is derived from the world, not from its name.
      const score = pop > 0 || stations > 0
        ? (pop / 1000) * MODEL.popPerThousand + market * MODEL.marketWeight + stations * MODEL.stationWeight
        : 0;
      const capacity = score > 0
        ? clamp(Math.round(score * MODEL.capacityPerPoint), MODEL.capacityFloor, MODEL.capacityCeiling)
        : 0;
      return {
        index: i, name: p.name, pop, market: Number(p.market) || 0, stations, score: Number(score.toFixed(2)),
        capacity,
        replenish: capacity ? Math.max(1, Math.round(capacity / MODEL.replenishDays)) : 0,
        demand: Math.round(capacity * MODEL.demandFraction),
        contracts: capacity ? clamp(Math.round(score * MODEL.contractsPerPoint), 1, MODEL.contractsCeiling) : 0,
        goods: capacity ? t.getPlanetMarket(i).map((o) => o.goods) : [],
      };
    });

    const inhabited = worlds.filter((w) => w.capacity > 0);
    const dead = worlds.filter((w) => w.capacity === 0);
    const bands = (list, f) => {
      const v = list.map(f).sort((a, b) => a - b);
      const q = (x) => v[Math.floor((v.length - 1) * x)];
      return { n: v.length, min: v[0], p25: q(0.25), med: q(0.5), p75: q(0.75), max: v[v.length - 1] };
    };
    // Small / medium / major, cut by the capability score itself.
    const sorted = inhabited.slice().sort((a, b) => a.score - b.score);
    const cut1 = sorted[Math.floor(sorted.length / 3)].score;
    const cut2 = sorted[Math.floor((sorted.length * 2) / 3)].score;
    const sizeOf = (w) => (w.score <= cut1 ? 'small' : w.score <= cut2 ? 'medium' : 'major');
    const bySize = {};
    for (const size of ['small', 'medium', 'major']) {
      const list = inhabited.filter((w) => sizeOf(w) === size);
      bySize[size] = {
        worlds: list.length,
        score: bands(list, (w) => w.score),
        capacity: bands(list, (w) => w.capacity),
        replenish: bands(list, (w) => w.replenish),
        demand: bands(list, (w) => w.demand),
        contracts: bands(list, (w) => w.contracts),
        example: list.slice().sort((a, b) => b.score - a.score)[Math.floor(list.length / 2)]?.name || '',
      };
    }

    // ---- contract tonnage distribution ----------------------------------------------------------
    const tonnage = [];
    for (const w of inhabited)
      for (let k = 0; k < w.contracts; k++) {
        const u = MODEL.contractTonsLow + rand(w.index * 131 + k * 17) * (MODEL.contractTonsHigh - MODEL.contractTonsLow);
        tonnage.push(Math.max(5, Math.round(w.capacity * u)));
      }
    const tonnageBands = bands(tonnage, (v) => v);
    const tonnageHist = {};
    for (const v of tonnage) {
      const b = v < 25 ? '<25' : v < 50 ? '25-49' : v < 100 ? '50-99' : v < 150 ? '100-149' : v < 200 ? '150-199' : '200+';
      tonnageHist[b] = (tonnageHist[b] || 0) + 1;
    }

    // ---- four representative hulls, at proposed capacity ----------------------------------------
    // Proposed capacities are recomputed here by the same derivation the capacity proposal uses, so
    // the two documents cannot disagree.
    const CLASS_BASE = { shuttle: 12, escort: 45, lightCruiser: 70, cruiser: 140, battleship: 220, capital: 300 };
    const CARGO = /freighter|hauler|cargo|transport|tug|logistics|merchant|convoy|supply|courier|runabout|service craft|commerce/i;
    const HEAVY = /bulk|heavy|long-haul|grand|interstellar|frame/i;
    const TIER = { warship: 1, cargo: 3, heavyCargo: 6 };
    const hulls = Object.values(s.shipStatsById).filter((x) => x && x.assetType === 'ship').map((x) => {
      const role = String(x.role || '');
      const cargo = CARGO.test(role), heavy = cargo && HEAVY.test(role);
      return { id: Number(x.id), name: String(x.name), cls: String(x.shipClass || ''), role,
        tier: heavy ? 'heavyCargo' : cargo ? 'cargo' : 'warship',
        current: Number(x.cargoCapacity) || 0, price: t.getShipPrice(x), mass: Number(x.mass) || 0 };
    });
    const buckets = new Map();
    for (const h of hulls) {
      const key = `${h.cls}:${h.tier}`;
      if (!buckets.has(key)) buckets.set(key, []);
      buckets.get(key).push(h);
    }
    for (const [, list] of buckets) {
      list.sort((a, b) => a.current - b.current);
      const n = Math.max(1, list.length - 1);
      list.forEach((h, i) => {
        const spread = list.length === 1 ? 1 : 0.7 + (i / n) * 0.7;
        h.proposed = clamp(Math.round((CLASS_BASE[h.cls] ?? 60) * TIER[h.tier] * spread), 5, 1500);
      });
    }
    const pick = (f) => hulls.filter(f).sort((a, b) => b.proposed - a.proposed)[0];
    const cast = [
      { label: 'starter shuttle', hull: hulls.filter((h) => h.cls === 'shuttle' && h.tier === 'warship').sort((a, b) => a.price - b.price)[0] },
      { label: 'ordinary cruiser', hull: hulls.filter((h) => h.cls === 'cruiser' && h.tier === 'warship').sort((a, b) => a.price - b.price)[Math.floor(hulls.filter((h) => h.cls === 'cruiser' && h.tier === 'warship').length / 2)] },
      { label: 'normal freighter', hull: pick((h) => h.tier === 'cargo' && h.cls === 'lightCruiser') },
      { label: 'heavy freighter', hull: pick((h) => h.tier === 'heavyCargo') },
    ];

    // ---- the simulation -------------------------------------------------------------------------
    // One shared economy. Traders draw down the same supply and fill the same demand as each other and
    // as the captain would. There is no separate trader stock anywhere in here.
    function runSim({ traders, days, seed }) {
      const supply = {}, demand = {};
      for (const w of inhabited) for (const g of w.goods) {
        supply[`${w.index}:${g}`] = w.capacity;
        demand[`${w.index}:${g}`] = w.demand;
      }
      const boards = {};
      for (const w of inhabited) boards[w.index] = t.getPlanetMarket(w.index).map((o) => ({ goods: o.goods, price: o.price }));
      // Open cargo jobs, bounded by what each world can actually generate.
      const jobs = {};
      let jobSeq = 0;
      const reachable = {};
      const makeJob = (w, k) => {
        const pool = reachable[w.index] || (reachable[w.index] = inhabited
          .filter((x) => x.index !== w.index && t.getPlottedRoute(w.index, x.index)).map((x) => x.index));
        if (!pool.length) return null;
        const u = MODEL.contractTonsLow + rand(w.index * 131 + k * 17 + seed * 7) * (MODEL.contractTonsHigh - MODEL.contractTonsLow);
        const to = pool[Math.floor(rand(w.index * 57 + k * 23 + seed * 11) * pool.length)];
        const legs = Math.max(1, t.Fleet.travelDays(t.getPlottedRoute(w.index, to).distance));
        return { id: ++jobSeq, from: w.index, to, tons: Math.max(5, Math.round(w.capacity * u)),
          payPerTon: Math.max(1, MODEL.contractPayPerTon + MODEL.contractPayPerTonPerDay * legs), legs };
      };
      for (const w of inhabited) {
        jobs[w.index] = [];
        for (let k = 0; k < w.contracts; k++) { const j = makeJob(w, k); if (j) jobs[w.index].push(j); }
      }
      const world = (i) => worlds[i];
      const ships = traders.map((h, k) => ({
        hull: h, hold: h.proposed, at: inhabited[(k * 7) % inhabited.length].index,
        lots: null, haul: null, commodityTo: null, stops: 0, stopSum: 0, legSum: 0, stopsThisTrip: 0, legsThisTrip: 0, tons: 0, paid: 0, arrive: 0, dest: null, profit: 0, trips: 0, idleDays: 0, blocked: 0, fill: 0, fillSum: 0, jobsTaken: 0,
      }));
      let purse = 250000;
      for (let day = 1; day <= days; day++) {
        // prices drift, exactly as they do today
        for (const w of inhabited)
          for (let i = 0; i < boards[w.index].length; i++) {
            const d = Math.floor(rand((w.index + 1) * 211 + day * 37 + i * 17) * 5) - 2;
            boards[w.index][i].price = clamp(boards[w.index][i].price + d, 1, 20);
          }
        // shelves and appetites come back
        for (const w of inhabited) for (const g of w.goods) {
          supply[`${w.index}:${g}`] = Math.min(w.capacity, supply[`${w.index}:${g}`] + w.replenish);
          demand[`${w.index}:${g}`] = Math.min(w.demand, demand[`${w.index}:${g}`] + w.replenish);
        }
        // Worlds generate new demand over time; a taken job is not replaced instantly, which is what
        // stops a captain standing at one system rerolling jobs until a large hold is full.
        if (day % MODEL.jobRespawnDays === 0)
          for (const w of inhabited)
            if (jobs[w.index].length < w.contracts) { const j = makeJob(w, day + jobs[w.index].length); if (j) jobs[w.index].push(j); }
        for (const ship of ships) {
          if (ship.dest !== null) {
            if (day < ship.arrive) continue;
            // arrive and sell into whatever appetite is left
            ship.at = ship.dest; ship.dest = null;
            let revenue = 0, left = 0;
            const sellAt = ship.commodityTo;
            for (const lot of ship.lots || []) {
              const key = `${sellAt}:${lot.goods}`;
              const board = boards[sellAt].find((o) => o.goods === lot.goods);
              const sellable = Math.min(lot.tons, demand[key] ?? 0);
              revenue += sellable * (board ? board.price : 1);
              demand[key] = Math.max(0, (demand[key] ?? 0) - sellable);
              left += lot.tons - sellable;
            }
            for (const job of ship.haul || []) revenue += Math.round(job.tons * job.payPerTon);
            purse += revenue;
            ship.profit += revenue - ship.paid;
            ship.fillSum += ship.fill || 0;
            ship.stopSum += ship.stopsThisTrip || 1;
            ship.legSum += ship.legsThisTrip || 1;
            ship.haul = null; ship.commodityTo = null;
            if (left > 0) ship.blocked++;       // could not place the whole load
            ship.lots = null; ship.tons = 0; ship.paid = 0; ship.trips++;
            continue;
          }
          // plan: the best good here, for the best place that can actually absorb it
          const here = world(ship.at);
          if (!here.capacity) { ship.idleDays++; continue; }
          // A circuit, not a single hop. Commodities fill the hold for the first stop; cargo jobs are
          // taken whole, to wherever they are going, and the ship works round them. A hold big enough
          // to carry several shipments at once is the only thing that makes more than one stop pay.
          const here2 = boards[ship.at];
          const openJobs = (jobs[ship.at] || []).slice().sort((a, b) => b.payPerTon - a.payPerTon);
          let room = ship.hold, spend = purse;
          const haul = [];
          for (const job of openJobs) {
            if (job.tons > room) continue;
            if (new Set([...haul.map((j) => j.to), job.to]).size > MODEL.maxStops) continue;
            haul.push(job); room -= job.tons;
          }
          // the best commodity run for whatever hold is left, to any reachable world
          let commodity = null;
          for (const w of inhabited) {
            if (w.index === ship.at) continue;
            const route = t.getPlottedRoute(ship.at, w.index);
            if (!route) continue;
            const legs = Math.max(1, t.Fleet.travelDays(route.distance));
            const lots = [];
            for (const o of here2) {
              const sell = boards[w.index].find((x) => x.goods === o.goods);
              if (!sell || sell.price <= o.price) continue;
              const have = Math.min(supply[`${ship.at}:${o.goods}`] ?? 0, demand[`${w.index}:${o.goods}`] ?? 0);
              if (have < 1) continue;
              lots.push({ goods: o.goods, unit: o.price, margin: sell.price - o.price, have });
            }
            if (!lots.length) continue;
            lots.sort((a, b) => b.margin - a.margin);
            const allowed = Math.max(1, Math.min(MODEL.goodsPerTripCeiling, Math.ceil(ship.hold / MODEL.tonsPerLot)));
            let r = room, sp = spend, net = 0;
            const take = [];
            for (const lot of lots.slice(0, allowed)) {
              const tons = Math.min(lot.have, r, Math.floor(sp / Math.max(1, lot.unit)));
              if (tons < 1) continue;
              take.push({ ...lot, tons });
              r -= tons; sp -= tons * lot.unit; net += tons * lot.margin;
            }
            if (!take.length || net <= 0) continue;
            const score = net / legs;
            if (!commodity || score > commodity.score) commodity = { to: w.index, legs, take, net, score };
          }
          if (!haul.length && !commodity) { ship.idleDays++; continue; }
          // days for the circuit: the commodity stop plus each job's destination, nearest first
          const stops = [];
          if (commodity) stops.push(commodity.to);
          for (const j of haul) if (!stops.includes(j.to)) stops.push(j.to);
          let cursor = ship.at, legsTotal = 0, ok = true;
          const order = [];
          const remaining = stops.slice();
          while (remaining.length) {
            let bestStop = null;
            for (const st of remaining) {
              const rt = t.getPlottedRoute(cursor, st);
              if (!rt) continue;
              const d = Math.max(1, t.Fleet.travelDays(rt.distance));
              if (!bestStop || d < bestStop.d) bestStop = { st, d };
            }
            if (!bestStop) { ok = false; break; }
            legsTotal += bestStop.d; cursor = bestStop.st; order.push(bestStop.st);
            remaining.splice(remaining.indexOf(bestStop.st), 1);
          }
          if (!ok || !order.length) { ship.idleDays++; continue; }
          if (legsTotal > MODEL.maxCircuitDays) {
            // too far to commit to: drop the furthest stops and the jobs that went with them
            while (order.length > 1 && legsTotal > MODEL.maxCircuitDays) {
              const dropped = order.pop();
              const rt = t.getPlottedRoute(order[order.length - 1] ?? ship.at, dropped);
              legsTotal -= rt ? Math.max(1, t.Fleet.travelDays(rt.distance)) : 1;
              for (let i = haul.length - 1; i >= 0; i--) if (haul[i].to === dropped) haul.splice(i, 1);
              if (commodity && commodity.to === dropped) commodity = null;
            }
            if (!haul.length && !commodity) { ship.idleDays++; continue; }
          }
          ship.lots = commodity ? commodity.take : [];
          ship.commodityTo = commodity ? commodity.to : null;
          ship.haul = haul;
          ship.tons = 0; ship.paid = 0;
          for (const lot of ship.lots) {
            supply[`${ship.at}:${lot.goods}`] -= lot.tons;
            purse -= lot.tons * lot.unit;
            ship.tons += lot.tons; ship.paid += lot.tons * lot.unit;
          }
          for (const job of haul) { jobs[ship.at] = jobs[ship.at].filter((j) => j.id !== job.id); ship.tons += job.tons; }
          ship.jobsTaken += haul.length;
          ship.stops = order.length;
          ship.stopsThisTrip = order.length;
          ship.legsThisTrip = legsTotal;
          ship.fill = Math.round((ship.tons / ship.hold) * 100);
          ship.dest = order[order.length - 1]; ship.arrive = day + legsTotal;
        }
      }
      return {
        purse,
        ships: ships.map((sh) => ({ hull: sh.hull.name, hold: sh.hold, price: sh.hull.price,
          profit: Math.round(sh.profit), trips: sh.trips, idleDays: sh.idleDays, blocked: sh.blocked,
          perDay: Math.round(sh.profit / days), fill: sh.trips ? Math.round(sh.fillSum / sh.trips) : 0, jobs: sh.jobsTaken, stops: sh.trips ? (sh.stopSum / sh.trips).toFixed(1) : 0, circuit: sh.trips ? Math.round(sh.legSum / sh.trips) : 0 })),
      };
    }

    // Sensitivity: the one structural question this model keeps raising is whether a hold beyond a few
    // hundred tons has anything to put in it. Three levers, measured rather than argued.
    const variants = {};
    const baseCeiling = MODEL.capacityCeiling, baseCircuit = MODEL.maxCircuitDays;
    for (const v of [
      { label: 'as modelled', ceiling: baseCeiling, circuit: baseCircuit },
      { label: 'longer circuits (80 days)', ceiling: baseCeiling, circuit: 80 },
      { label: 'bigger worlds (ceiling 400t)', ceiling: 400, circuit: baseCircuit },
      { label: 'both', ceiling: 400, circuit: 80 },
    ]) {
      MODEL.capacityCeiling = v.ceiling; MODEL.maxCircuitDays = v.circuit;
      for (const w of worlds) {
        w.capacity = w.score > 0 ? clamp(Math.round(w.score * MODEL.capacityPerPoint), MODEL.capacityFloor, v.ceiling) : 0;
        w.replenish = w.capacity ? Math.max(1, Math.round(w.capacity / MODEL.replenishDays)) : 0;
        w.demand = Math.round(w.capacity * MODEL.demandFraction);
      }
      const freighter = cast[2].hull, heavyH = cast[3].hull;
      variants[v.label] = {
        freighter: runSim({ traders: [freighter], days: 300, seed: 3 }).ships[0],
        heavy: runSim({ traders: [heavyH], days: 300, seed: 3 }).ships[0],
      };
    }
    MODEL.capacityCeiling = baseCeiling; MODEL.maxCircuitDays = baseCircuit;
    for (const w of worlds) {
      w.capacity = w.score > 0 ? clamp(Math.round(w.score * MODEL.capacityPerPoint), MODEL.capacityFloor, baseCeiling) : 0;
      w.replenish = w.capacity ? Math.max(1, Math.round(w.capacity / MODEL.replenishDays)) : 0;
      w.demand = Math.round(w.capacity * MODEL.demandFraction);
    }

    const single = {};
    for (const c of cast)
      for (const days of [100, 300])
        single[`${c.label}:${days}`] = runSim({ traders: [c.hull], days, seed: 1 });
    const heavy = cast[3].hull;
    const competition = {};
    for (const n of [1, 2, 4])
      competition[n] = runSim({ traders: Array.from({ length: n }, () => heavy), days: 300, seed: 2 });

    return {
      worlds: worlds.length, inhabited: inhabited.length, dead: dead.length,
      deadNames: dead.map((w) => w.name).slice(0, 14),
      popBands: bands(inhabited, (w) => w.pop), marketBands: bands(inhabited, (w) => w.market),
      bySize, tonnageBands, tonnageHist, totalContracts: tonnage.length,
      variants,
      cast: cast.map((c) => ({ label: c.label, name: c.hull.name, cls: c.hull.cls, role: c.hull.role,
        current: c.hull.current, proposed: c.hull.proposed, price: c.hull.price })),
      single, competition,
    };
  }, MODEL);

  const pad = (v, n) => String(v).padEnd(n);
  const table = (title, head, body) => {
    const w = head.map((h, i) => Math.max(h.length, ...body.map((r) => String(r[i]).length)));
    const line = (c) => '| ' + c.map((v, i) => pad(v, w[i])).join(' | ') + ' |';
    return ['', `### ${title}`, '', line(head), '| ' + w.map((x) => '-'.repeat(x)).join(' | ') + ' |',
      ...body.map((r) => line(r.map(String))), ''].join('\n');
  };
  const band = (b) => `${b.min} / ${b.p25} / ${b.med} / ${b.p75} / ${b.max}`;

  const L = [];
  L.push('# Proposed economy — seeded measurements');
  L.push('');
  L.push(`${result.worlds} worlds: **${result.inhabited} with an economy**, **${result.dead} without one**.`);
  L.push(`A world has no economy when it has no population and no surviving installation, derived from the`);
  L.push(`world rather than from its name. Those worlds: ${result.deadNames.join(', ')}.`);
  L.push('');
  L.push(`Population across the inhabited worlds (min / p25 / median / p75 / max): **${band(result.popBands)}**.`);
  L.push(`Market strength: **${band(result.marketBands)}**.`);

  L.push(table('World capability by size (min / p25 / median / p75 / max)',
    ['size', 'worlds', 'example', 'score', 'tons per good', 'replenish t/day', 'demand per good', 'open jobs'],
    ['small', 'medium', 'major'].map((k) => {
      const b = result.bySize[k];
      return [k, b.worlds, b.example, band(b.score), band(b.capacity), band(b.replenish), band(b.demand), band(b.contracts)];
    })));

  L.push(table('Cargo contract tonnage', ['band', 'jobs'],
    Object.entries(result.tonnageHist).sort((a, b) => a[0].localeCompare(b[0])).map(([k, v]) => [k, v])));
  L.push(`${result.totalContracts} cargo jobs open across the map at once; tonnage min / p25 / median / p75 / max = **${band(result.tonnageBands)}**.`);

  L.push(table('The four hulls measured', ['role in the test', 'hull', 'class', 'authored role', 'current hold', 'proposed hold', 'price'],
    result.cast.map((c) => [c.label, c.name, c.cls, c.role, c.current, c.proposed, c.price])));

  L.push(table('Profit, one trader alone',
    ['hull', 'hold', 'lots/trip', 'price', '100 days', 'per day', 'trips', '300 days', 'per day', 'trips', 'hold filled', 'jobs carried', 'stops/trip', 'days/circuit'],
    result.cast.map((c) => {
      const a = result.single[`${c.label}:100`].ships[0], b = result.single[`${c.label}:300`].ships[0];
      const lots = Math.max(1, Math.min(8, Math.ceil(a.hold / 110)));
      return [c.label, a.hold, lots, c.price, a.profit, a.perDay, a.trips, b.profit, b.perDay, b.trips, `${b.fill}%`, b.jobs, b.stops, b.circuit];
    })));

  L.push(table('Does a hold beyond a few hundred tons have anything to put in it? (300 days)',
    ['model', 'freighter 294t', 'heavy 840t', 'heavy advantage', 'heavy hold filled', 'heavy stops/trip'],
    Object.entries(result.variants).map(([k, v]) => [k, v.freighter.profit, v.heavy.profit,
      `${Math.round(((v.heavy.profit / Math.max(1, v.freighter.profit)) - 1) * 100)}%`,
      `${v.heavy.fill}%`, v.heavy.stops])));

  L.push(table('Heavy freighters competing for the same markets, 300 days',
    ['traders', 'total profit', 'each', 'trips each', 'idle days each', 'loads that would not fit demand'],
    Object.entries(result.competition).map(([n, r]) => {
      const total = r.ships.reduce((x, sh) => x + sh.profit, 0);
      return [n, total, Math.round(total / Number(n)), Math.round(r.ships.reduce((x, sh) => x + sh.trips, 0) / Number(n)),
        Math.round(r.ships.reduce((x, sh) => x + sh.idleDays, 0) / Number(n)),
        r.ships.reduce((x, sh) => x + sh.blocked, 0)];
    })));

  fs.mkdirSync(outDir, { recursive: true });
  fs.writeFileSync(path.join(outDir, 'economy-measurements.json'), JSON.stringify({ model: MODEL, result }, null, 1) + '\n');
  console.log(L.join('\n'));
  console.log(`\nModel parameters: ${JSON.stringify(MODEL)}`);
  console.log(`Written to ${path.join(outDir, 'economy-measurements.json')}`);
  if (probe.errors.length) { console.log(`page errors: ${probe.errors.join(' | ')}`); process.exitCode = 1; }
  await Promise.race([probe.close(), new Promise((r) => setTimeout(r, 15000))]);
  process.exit(process.exitCode || 0);
})().catch((e) => { console.error(e); process.exit(1); });
