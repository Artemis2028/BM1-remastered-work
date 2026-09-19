// Proposed cargo capacities for the whole hull roster, derived rather than hand-assigned.
//
// Nothing here changes the ship data. It reads the live catalogue, classifies every hull from fields
// the catalogue already carries — `shipClass` for size, `role` for whether the hull is a cargo hull —
// and proposes a capacity from that classification. The point is that the classification is derivable,
// so it can be re-derived when the roster changes and it cannot quietly become a list of names.
//
// Usage: node scripts/cargo-capacity-proposal.cjs [--out dir]
const fs = require('node:fs');
const path = require('node:path');
const { startProbe } = require('./probe-harness.cjs');

const outArg = process.argv.indexOf('--out');
const outDir = outArg > -1 ? process.argv[outArg + 1] : process.cwd();

// Size band from the catalogue's own class. A hull that carries no cargo role is a warship with a
// locker; a hull whose role says it hauls is a freighter of that size.
const CLASS_BASE = { shuttle: 12, escort: 45, lightCruiser: 70, cruiser: 140, battleship: 220, capital: 300 };
// Words a hull's authored role uses when hauling is what it is for. Matched against `role`, never
// against the ship's name.
// A liner carries passengers, not bulk, so it is not a freight hull however large it is — that one word
// was enough to put a pleasure ship at the top of the cargo table.
const CARGO_WORDS = /freighter|hauler|cargo|transport|tug|logistics|merchant|convoy|supply|courier|runabout|service craft|commerce/i;
const HEAVY_WORDS = /bulk|heavy|long-haul|grand|interstellar|frame/i;
// A dedicated heavy freighter must top the table, so the tier multiplier has to outweigh the fact
// that a warship class sits above a freighter class in size.
const TIER = { warship: 1, cargo: 3, heavyCargo: 6 };
const CAP_FLOOR = 5;
const CAP_CEILING = 1500;

function classify(row) {
  const role = String(row.role || '');
  const cargo = CARGO_WORDS.test(role);
  const heavy = cargo && HEAVY_WORDS.test(role);
  return { cargo, heavy, tier: heavy ? 'heavyCargo' : cargo ? 'cargo' : 'warship' };
}

(async () => {
  const probe = await startProbe();
  const rows = await probe.ev(() => {
    const t = testBM1, s = t.state;
    t.startWithFaction('terran');
    return Object.values(s.shipStatsById)
      .filter((x) => x && x.assetType === 'ship')
      .map((x) => ({
        id: Number(x.id), name: String(x.name), faction: t.getShipFaction(x.id),
        cls: String(x.shipClass || ''), role: String(x.role || ''),
        mass: Number(x.mass) || 0, price: t.getShipPrice(x),
        current: Number(x.cargoCapacity) || 0,
      }));
  });

  // Rank inside each class+tier bucket by current capacity, so the relative ordering the roster
  // already expresses survives the rescale instead of every hull in a bucket becoming one number.
  const buckets = new Map();
  for (const r of rows) {
    Object.assign(r, classify(r));
    const key = `${r.cls}:${r.tier}`;
    if (!buckets.has(key)) buckets.set(key, []);
    buckets.get(key).push(r);
  }
  for (const [, list] of buckets) {
    list.sort((a, b) => a.current - b.current);
    const n = Math.max(1, list.length - 1);
    list.forEach((r, i) => {
      const spread = list.length === 1 ? 1 : 0.7 + (i / n) * 0.7; // 0.7x .. 1.4x of the class base
      const base = CLASS_BASE[r.cls] ?? 60;
      r.proposed = Math.max(CAP_FLOOR, Math.min(CAP_CEILING, Math.round(base * TIER[r.tier] * spread)));
      r.spread = Number(spread.toFixed(2));
    });
  }

  const num = (v) => String(v).padStart(6);
  const pad = (v, n) => String(v).padEnd(n);
  const table = (title, head, body) => {
    const w = head.map((h, i) => Math.max(h.length, ...body.map((r) => String(r[i]).length)));
    const line = (c) => '| ' + c.map((v, i) => pad(v, w[i])).join(' | ') + ' |';
    return ['', `### ${title}`, '', line(head), '| ' + w.map((x) => '-'.repeat(x)).join(' | ') + ' |',
      ...body.map((r) => line(r.map(String))), ''].join('\n');
  };
  const sum = (list, f) => list.reduce((n, r) => n + f(r), 0);
  const stats = (list) => list.length
    ? { n: list.length, curMed: median(list.map((r) => r.current)), propMed: median(list.map((r) => r.proposed)),
        curMax: Math.max(...list.map((r) => r.current)), propMax: Math.max(...list.map((r) => r.proposed)) }
    : { n: 0, curMed: 0, propMed: 0, curMax: 0, propMax: 0 };
  function median(a) { const b = a.slice().sort((x, y) => x - y); return b.length ? b[Math.floor((b.length - 1) / 2)] : 0; }

  const byTier = {};
  for (const tier of ['warship', 'cargo', 'heavyCargo'])
    for (const cls of Object.keys(CLASS_BASE)) {
      const list = rows.filter((r) => r.tier === tier && r.cls === cls);
      if (list.length) byTier[`${tier}:${cls}`] = { tier, cls, list, ...stats(list) };
    }

  const lines = [];
  lines.push('# Proposed cargo capacity by role and size');
  lines.push('');
  lines.push(`Derived from ${rows.length} hulls. Classification uses the catalogue's own \`shipClass\` for size and`);
  lines.push('`role` for whether the hull is a cargo hull. No hull is named anywhere in the derivation.');
  lines.push('');
  lines.push(table('Buckets', ['tier', 'class', 'hulls', 'current median', 'proposed median', 'current max', 'proposed max'],
    Object.values(byTier).map((b) => [b.tier, b.cls, b.n, b.curMed, b.propMed, b.curMax, b.propMax])));

  const biggestNow = rows.slice().sort((a, b) => b.current - a.current).slice(0, 12);
  lines.push(table('The twelve largest holds today, and what they become',
    ['hull', 'class', 'role', 'tier', 'current', 'proposed'],
    biggestNow.map((r) => [r.name, r.cls, r.role, r.tier, r.current, r.proposed])));

  const biggestAfter = rows.slice().sort((a, b) => b.proposed - a.proposed).slice(0, 12);
  lines.push(table('The twelve largest holds afterwards',
    ['hull', 'class', 'role', 'tier', 'current', 'proposed', 'price'],
    biggestAfter.map((r) => [r.name, r.cls, r.role, r.tier, r.current, r.proposed, r.price])));

  const reps = ['shuttle', 'escort', 'lightCruiser', 'cruiser', 'battleship', 'capital']
    .flatMap((cls) => ['warship', 'cargo', 'heavyCargo'].map((tier) => {
      const list = rows.filter((r) => r.cls === cls && r.tier === tier);
      if (!list.length) return null;
      const mid = list.slice().sort((a, b) => a.current - b.current)[Math.floor((list.length - 1) / 2)];
      return [cls, tier, mid.name, mid.role, mid.current, mid.proposed, mid.price];
    }).filter(Boolean));
  const heavy = rows.filter((r) => r.heavy).sort((a, b) => b.proposed - a.proposed);
  lines.push(table('Every heavy freight hull in the game',
    ['hull', 'class', 'role', 'current', 'proposed', 'price'],
    heavy.map((r) => [r.name, r.cls, r.role, r.current, r.proposed, r.price])));

  lines.push(table('A representative hull from every bucket',
    ['class', 'tier', 'hull', 'role', 'current', 'proposed', 'price'], reps));

  lines.push('');
  lines.push(`Total hold across the roster: **${sum(rows, (r) => r.current).toLocaleString()} t** today, `
    + `**${sum(rows, (r) => r.proposed).toLocaleString()} t** proposed.`);
  lines.push(`Largest hold: **${Math.max(...rows.map((r) => r.current)).toLocaleString()} t** today, `
    + `**${Math.max(...rows.map((r) => r.proposed)).toLocaleString()} t** proposed.`);
  lines.push(`Cargo hulls: **${rows.filter((r) => r.cargo).length}** of ${rows.length}, of which `
    + `**${rows.filter((r) => r.heavy).length}** are heavy.`);

  fs.mkdirSync(outDir, { recursive: true });
  const csv = ['id,name,faction,class,role,tier,mass,price,current,proposed']
    .concat(rows.sort((a, b) => b.proposed - a.proposed).map((r) =>
      [r.id, JSON.stringify(r.name), r.faction, r.cls, JSON.stringify(r.role), r.tier, r.mass, r.price, r.current, r.proposed].join(',')))
    .join('\n');
  fs.writeFileSync(path.join(outDir, 'cargo-capacity-proposal.csv'), csv + '\n');
  fs.writeFileSync(path.join(outDir, 'cargo-capacity-proposal.json'), JSON.stringify(rows, null, 1) + '\n');
  console.log(lines.join('\n'));
  console.log(`\nWritten to ${path.join(outDir, 'cargo-capacity-proposal.csv')}`);
  if (probe.errors.length) { console.log(`page errors: ${probe.errors.join(' | ')}`); process.exitCode = 1; }
  await Promise.race([probe.close(), new Promise((r) => setTimeout(r, 15000))]);
  process.exit(process.exitCode || 0);
})().catch((e) => { console.error(e); process.exit(1); });
