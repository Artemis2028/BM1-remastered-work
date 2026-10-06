// Long-horizon measurements of the finite economy, driven through the real engine.
//
// This is not a model. It starts a campaign, learns a set of worlds, puts one or more fleet traders to
// work, and advances the campaign day by day, reading the same shelves, the same books of work and the
// same danger the captain would. Everything it reports is what the engine did.
//
// Nothing is tuned here, and nothing is changed: it reads whatever the tree under measurement does.
// This pass measures the reviewed payout — a route and hazard fee paid once for the voyage plus a flat
// rate per ton — against the fourteen reduced warship holds and the narrowed rule for which
// installations give a world an economy.
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
      // The books of work as they stand, read without touching them: a world nobody has looked at is
      // reported as unseeded rather than seeded by the act of measuring it. Every open shipment on a
      // seeded world is judged from that world, as the trader would judge it standing there, and the
      // first reason it would be passed over is recorded.
      books(f) {
        const t = testBM1, s = t.state;
        const tr = f.trade;
        const day = Number(s.day) || 1;
        const hold = t.fleetTradeCapacity(f);
        const load = t.fleetTradeLoad(tr);
        const room = hold - load;
        const rule = typeof t.tradeRiskRule === 'function' ? t.tradeRiskRule(tr.risk)
          : (t.TRADE_RISK_RULES[tr.risk] || t.TRADE_RISK_RULES.cautious);
        const unreportedOk = (list) => (typeof t.unreportedLegsAcceptable === 'function'
          ? t.unreportedLegsAcceptable(rule, list) : Boolean(rule.acceptUnreported));
        const out = { day, seeded: 0, unseeded: 0, capacity: 0, open: 0, ages: [], reasons: {}, doubts: {},
          full: 0, empty: 0, worlds: 0, hold, load };
        for (let i = 0; i < s.planets.length; i++) {
          if (!t.worldTrades(i)) continue;
          out.worlds += 1;
          const seededRecord = s.worldJobs && s.worldJobs[i];
          if (!seededRecord || !Array.isArray(seededRecord.jobs)) { out.unseeded += 1; continue; }
          // A seeded book is read the way a visitor reads it — expiry and regeneration are lazy and
          // happen on the read — so the board reported is the board anyone arriving would see.
          const record = typeof t.worldJobPool === 'function' ? (t.worldJobPool(i) || seededRecord) : seededRecord;
          const cap = t.worldTradeCapability(i);
          out.seeded += 1;
          out.capacity += cap.jobs;
          out.open += record.jobs.length;
          if (record.jobs.length >= cap.jobs) out.full += 1;
          if (record.jobs.length === 0) out.empty += 1;
          for (const j of record.jobs) {
            out.ages.push(Math.max(0, day - (Number(j.createdDay) || day)));
            let reason = 'ok';
            const to = Number(j.targetIndex);
            const recorded = t.conditionLog()[to] && t.conditionLog()[to].controller;
            const risk = t.plannedRouteRisk(i, to);
            if (!risk) reason = 'no-route';
            else if (recorded != null && t.serviceRefusal(recorded)) reason = 'refusal';
            else if (risk.unreported.length && !unreportedOk(risk.unreported)) {
              reason = 'unreported';
              // Under Cautious, which of the captain's doubts stopped it.
              if (rule.acceptUnreported === 'charted-quiet' && typeof t.unreportedSystemDoubt === 'function') {
                const doubt = risk.unreported.map((k) => t.unreportedSystemDoubt(k)).find(Boolean);
                if (doubt) out.doubts[doubt] = (out.doubts[doubt] || 0) + 1;
              }
            }
            else if (risk.worst && risk.worst.band > rule.maxBand) reason = 'danger';
            else if (j.tons > hold) reason = 'too-big';
            else if (j.tons > room) reason = 'no-room';
            out.reasons[reason] = (out.reasons[reason] || 0) + 1;
          }
        }
        out.ages.sort((a, b) => a - b);
        const q = (p) => out.ages.length ? out.ages[Math.floor((out.ages.length - 1) * p)] : 0;
        out.age = { median: q(0.5), p90: q(0.9), max: q(1) };
        delete out.ages;
        out.occupancy = out.capacity ? out.open / out.capacity : 0;
        return out;
      },
      // One run, snapshotted at each horizon, so a five-thousand-day answer costs one pass.
      // `orders`: the captain's part in the run, if any — a trader that has stood idle with nothing to
      // do for `orders.idleDays` days is sent to rendezvous at the home world, and put back to work
      // when she arrives. It is a policy the harness plays, stated here and nowhere else in the game;
      // it exists to show what the recall order does to the one case the tables kept finding, a
      // trader parked where her setting gives her nowhere to go. The order is given as acknowledged —
      // the harness's captain does not fly out to her and builds no relays — and whether a link
      // would have reached her where she stood is recorded beside it. [playtest]
      run({ shipId, count, risk, days, marks, repair, learn, seed, rules, orders }) {
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
        const stats = ships.map(() => ({ idle: 0, stoppedDay: null, loadSum: 0, loadSamples: 0,
          contractSeen: 0, deliveries: 0, lastDeliveryDay: null, disabled: 0, down: false, idleRun: 0, ordered: 0, orderedInReach: 0, passageDays: 0 }));
        const snapshots = {};
        for (let d = 1; d <= days; d++) {
          s.day += 1;
          t.completeFleetJourneys();
          t.advanceFleetTrading(s.day);
          for (let k = 0; k < ships.length; k++) {
            const f = ships[k], tr = f.trade;
            if (!tr) continue;
            if (tr.stage !== 'outbound') stats[k].idle++;
            if (tr.stage === 'passage') stats[k].passageDays++;
            // The captain's policy: idle with nothing to do for long enough is sent home, and put back
            // to work on arrival.
            if (orders && typeof t.orderFleetRendezvous === 'function') {
              stats[k].idleRun = tr.active && tr.stage === 'idle' ? stats[k].idleRun + 1 : 0;
              if (stats[k].idleRun >= orders.idleDays && Number(f.systemIndex) !== home) {
                const reach = typeof t.fleetCommandReachable === 'function' ? t.fleetCommandReachable(f) : null;
                const given = typeof t.sendFleetCommand === 'function'
                  ? t.sendFleetCommand(f.id, { command: 'rendezvous', destination: home }, { fromRelay: true })
                  : t.orderFleetRendezvous(f.id, home);
                if (given) { stats[k].ordered += 1; if (reach) stats[k].orderedInReach += 1; stats[k].idleRun = 0; }
              }
              // She has arrived and is holding for orders, with the captain at home: back to work.
              if (!tr.active && tr.stage === 'holding' && tr.order && tr.order.arrivedDay != null) t.startFleetTrading(f.id, risk);
            }
            // Every time she is crippled on a crossing, once per crippling.
            const crippled = !tr.active && /^Disabled/.test(String(tr.note || ''));
            if (crippled && !stats[k].down) stats[k].disabled += 1;
            stats[k].down = crippled;
            if ((tr.contractIncome || 0) > stats[k].contractSeen) {
              stats[k].contractSeen = tr.contractIncome || 0;
              stats[k].deliveries += 1;
              stats[k].lastDeliveryDay = d;
            }
            if (stats[k].stoppedDay === null && !tr.active && tr.stage === 'holding') stats[k].stoppedDay = d;
            if (tr.stage === 'outbound') {
              const hold = t.fleetTradeCapacity(f);
              if (hold > 0) { stats[k].loadSum += t.fleetTradeLoad(tr) / hold; stats[k].loadSamples++; }
            }
            // The captain maintaining her ships: without a repair loop a trader is crippled once and
            // idle for ever, which would make every long horizon a measure of how fast it broke.
            //
            // A trader's condition is read from the LOCAL ACTOR first and only then from the fleet
            // record (`fleetVesselCondition`), so restoring the record alone left a disabled ship
            // disabled: the run went on reporting a "maintained" trader that had in fact stopped, with
            // its circuits and income frozen from the day it was hit and its idle time climbing to
            // ninety per cent. Both are restored now, which is what "maintained" was always supposed
            // to mean. [review]
            if (repair && tr.stage !== 'outbound' && !f.destroyed) {
              let fixed = false;
              const v = f.vessel;
              if (v && v.condition !== 'destroyed' && (v.hull < v.maxHull || v.condition !== 'operational')) {
                v.hull = v.maxHull;
                v.shields = v.maxShields;
                v.condition = 'operational';
                fixed = true;
              }
              const actor = typeof t.fleetLocalActor === 'function' ? t.fleetLocalActor(f.id) : null;
              if (actor && !actor.destroyed
                  && (actor.condition !== 'operational' || actor.combatHull < actor.maxCombatHull)) {
                actor.combatHull = actor.maxCombatHull;
                if (Number.isFinite(Number(actor.maxCombatShields))) actor.combatShields = actor.maxCombatShields;
                actor.condition = 'operational';
                actor.recoveryAt = 0;
                fixed = true;
              }
              // A ship under orders resumes them once she can fly; only one with none goes back to work.
              if (fixed && !tr.active && !tr.order) { tr.active = true; tr.stage = 'idle'; tr.note = ''; }
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
                deliveries: stats[k].deliveries,
                lastDeliveryDay: stats[k].lastDeliveryDay,
                disabled: stats[k].disabled,
                ordered: stats[k].ordered,
                orderedInReach: stats[k].orderedInReach,
                passageDays: stats[k].passageDays,
              };
            });
            const books = window.__econ.books(ships[0]);
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
              books,
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
  // risk settings, maintained, at the long horizon — the heavy freighter, and the five-ton starter
  // hull, which is the one the courier lots exist for
  const byRisk = {};
  const byRiskSmall = {};
  for (const risk of ['safe', 'cautious', 'risky', 'any']) {
    await fresh(`econ-risk-${risk}`);
    byRisk[risk] = await ev((arg) => window.__econ.run(arg), {
      shipId: cast[cast.length - 1].hull.id, count: 1, risk, days: MAX_DAYS, marks: HORIZONS,
      repair: true, learn: LEARN, seed: `econ-risk-${risk}`,
    });
    await fresh(`econ-risk-small-${risk}`);
    byRiskSmall[risk] = await ev((arg) => window.__econ.run(arg), {
      shipId: cast[0].hull.id, count: 1, risk, days: MAX_DAYS, marks: HORIZONS,
      repair: true, learn: LEARN, seed: `econ-risk-small-${risk}`,
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
  // the same two freighters, with the captain sending an idle one home after sixty days of nothing
  await fresh('econ-competition-2-orders');
  const competitionOrders = await ev((arg) => window.__econ.run(arg), {
    shipId: cast[cast.length - 1].hull.id, count: 2, risk: 'cautious', days: MAX_DAYS, marks: HORIZONS,
    repair: true, learn: LEARN, seed: 'econ-competition-2', orders: { idleDays: 60 },
  });
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
    const tonnage = [], pay = [], fee = [], perHoldTon = [];
    let couriers = 0, shipments = 0;
    const whole = (j) => (typeof t.jobPay === 'function' ? t.jobPay(j)
      : Math.round((Number(j.fee) || 0) + (Number(j.payPerTon) || 0) * (Number(j.tons) || 0)));
    for (const w of live.slice(0, 40)) for (const j of t.worldOpenJobs(w.i)) {
      tonnage.push(j.tons); pay.push(whole(j)); fee.push(Math.round(Number(j.fee) || 0));
      perHoldTon.push(Math.round(whole(j) / Math.max(1, j.tons)));
      shipments += 1; if (j.courier) couriers += 1;
    }
    const stat = (v) => { const a = v.slice().sort((x, y) => x - y); const q = (p) => a[Math.floor((a.length - 1) * p)];
      return { n: a.length, min: a[0], p25: q(0.25), med: q(0.5), p75: q(0.75), max: a[a.length - 1] }; };
    return { total: rows.length, live: live.length, dead: rows.length - live.length,
      deadNames: rows.filter((w) => !w.inhabited).map((w) => w.name),
      popBand: band((w) => w.pop), bySize, tonnage: stat(tonnage), pay: stat(pay),
      fee: stat(fee), perHoldTon: stat(perHoldTon), couriers, shipments };
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
    + `whole price **${worlds.pay.min} / ${worlds.pay.p25} / ${worlds.pay.med} / ${worlds.pay.p75} / ${worlds.pay.max} L**, `
    + `of which the once-paid route and hazard fee is **${worlds.fee.min} / ${worlds.fee.p25} / ${worlds.fee.med} / `
    + `${worlds.fee.p75} / ${worlds.fee.max} L**. What a trader actually compares — price over the hold it takes — is `
    + `**${worlds.perHoldTon.min} / ${worlds.perHoldTon.p25} / ${worlds.perHoldTon.med} / ${worlds.perHoldTon.p75} / `
    + `${worlds.perHoldTon.max} L per ton of hold**. ${worlds.couriers} of ${worlds.shipments} are courier lots.`);

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

  L.push(table('Danger setting, one maintained heavy freighter — shipments and cripplings',
    ['setting', ...HORIZONS.map((d) => `${d}d net L`), 'circuits at 5000', 'shipments delivered', 'times crippled', 'idle at 5000'],
    Object.entries(byRisk).map(([risk, snaps]) => {
      const last = snaps[HORIZONS[HORIZONS.length - 1]];
      return [risk, ...HORIZONS.map((d) => snaps[d] ? money(snaps[d].traders[0].cumulative) : '-'),
        last ? last.traders[0].circuits : '-', last ? last.traders[0].deliveries : '-',
        last ? last.traders[0].disabled : '-',
        last ? `${Math.round((last.traders[0].idle / HORIZONS[HORIZONS.length - 1]) * 100)}%` : '-'];
    })));

  L.push(table(`Danger setting, one maintained ${cast[0].label} (${cast[0].hull.hold} t)`,
    ['setting', ...HORIZONS.map((d) => `${d}d net L`), 'circuits at 5000', 'shipments delivered', 'hull left', 'idle at 5000'],
    Object.entries(byRiskSmall).map(([risk, snaps]) => {
      const last = snaps[HORIZONS[HORIZONS.length - 1]];
      return [risk, ...HORIZONS.map((d) => snaps[d] ? money(snaps[d].traders[0].cumulative) : '-'),
        last ? last.traders[0].circuits : '-',
        last ? last.traders[0].deliveries : '-',
        last ? `${Math.round(last.traders[0].hull * 100)}%` : '-',
        last ? `${Math.round((last.traders[0].idle / HORIZONS[HORIZONS.length - 1]) * 100)}%` : '-'];
    })));

  // The books of work by danger setting: how full they are, how old what is on them is, and why the
  // trader passes it over. Read for the heavy freighter's runs, at the horizons review asked for.
  const BOOK_HORIZONS = HORIZONS.filter((d) => d <= 3000);
  const reasonKeys = ['ok', 'danger', 'unreported', 'no-route', 'refusal', 'too-big', 'no-room'];
  const bookRows = [];
  for (const [label, source] of [['heavy freighter', byRisk], [cast[0].label, byRiskSmall]])
    for (const [risk, snaps] of Object.entries(source))
      for (const d of BOOK_HORIZONS) {
        const snap = snaps[d];
        if (!snap || !snap.books) continue;
        const b = snap.books, tr = snap.traders[0];
        const total = Object.values(b.reasons).reduce((n, x) => n + x, 0) || 1;
        const pct = (k) => `${Math.round(((b.reasons[k] || 0) / total) * 100)}%`;
        const doubts = Object.keys(b.doubts || {}).length
          ? Object.entries(b.doubts).map(([k, v]) => `${k} ${v}`).join(', ') : '-';
        bookRows.push([label, risk, d, `${b.seeded}/${b.worlds}`, `${Math.round(b.occupancy * 100)}%`,
          b.full, b.empty, b.open, `${b.age.median} / ${b.age.p90} / ${b.age.max}`,
          ...reasonKeys.map(pct), doubts, `${b.load}/${b.hold}`, tr.deliveries, tr.lastDeliveryDay == null ? '-' : tr.lastDeliveryDay]);
      }
  L.push(table('The books of work, by danger setting (seeded worlds only; a world nobody has looked at is not seeded)',
    ['hull', 'setting', 'day', 'seeded/trading', 'occupancy', 'full', 'empty', 'open', 'age med / p90 / max',
      ...reasonKeys.map((k) => `${k}`), 'why unreported', 'aboard/hold', 'delivered', 'last delivery'],
    bookRows));

  L.push(table('Several heavy freighters on one economy',
    ['traders', ...HORIZONS.map((d) => `${d}d each`), 'circuits each at 5000', 'idle each at 5000'],
    Object.entries(competition).map(([n, snaps]) => {
      const c = Number(n);
      const last = snaps[HORIZONS[HORIZONS.length - 1]];
      return [n, ...HORIZONS.map((d) => snaps[d] ? money(Math.round(snaps[d].total / c)) : '-'),
        last ? Math.round(last.circuits / c) : '-',
        last ? `${Math.round((last.idle / c / HORIZONS[HORIZONS.length - 1]) * 100)}%` : '-'];
    })));

  // Two traders, same seeds, with and without the captain's order: each trader on her own.
  const orderRows = [];
  for (const [label, snaps] of [['nobody moves her', competition[2]], ['sent home after 60 idle days', competitionOrders]]) {
    const last = snaps && snaps[HORIZONS[HORIZONS.length - 1]];
    if (!last) continue;
    last.traders.forEach((tr, k) => orderRows.push([label, `Trader ${k + 1}`, money(tr.cumulative), tr.circuits, tr.deliveries,
      `${Math.round((tr.idle / HORIZONS[HORIZONS.length - 1]) * 100)}%`, tr.ordered ?? 0, tr.ordered ? `${tr.orderedInReach ?? 0}/${tr.ordered}` : '-', tr.passageDays ?? 0, tr.disabled]));
  }
  L.push(table('Two heavy freighters on one economy, with and without the captain moving an idle one',
    ['captain', 'trader', '5000d net L', 'circuits', 'shipments', 'idle', 'times ordered home', 'in relay reach when ordered', 'days on passage', 'times crippled'], orderRows));

  fs.mkdirSync(outDir, { recursive: true });
  fs.writeFileSync(path.join(outDir, 'economy-measurements.json'),
    JSON.stringify({ horizons: HORIZONS, learn: LEARN, worlds, cast, runs, unmaintained, byRisk, byRiskSmall, competition, competitionOrders }, null, 1) + '\n');
  console.log(L.join('\n'));
  console.log(`\nWritten to ${path.join(outDir, 'economy-measurements.json')}`);
  if (probe.errors.length) { console.log(`page errors: ${probe.errors.slice(0, 4).join(' | ')}`); process.exitCode = 1; }
  await Promise.race([probe.close(), new Promise((r) => setTimeout(r, 15000))]);
  process.exit(process.exitCode || 0);
})().catch((e) => { console.error(e); process.exit(1); });
