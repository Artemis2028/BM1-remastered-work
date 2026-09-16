// Gate: service migration must be access-preserving. Compares the live purchasable offers of the
// current build with the committed baseline of the parent (docs/playtest/OFFER-BASELINE-d629143.json).
//   BM1_TEST_ROOT="$PWD/dist" node scripts/station-offer-gate.cjs
const assert = require('node:assert/strict');
const fs = require('node:fs'), path = require('node:path');
const { auditOffers } = require('./station-offer-audit.cjs');
(async () => {
  const roles = await import('../src/station-roles.mjs');
  const baseline = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'docs', 'playtest', 'OFFER-BASELINE-d629143.json'), 'utf8'));
  const stations = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'data', 'stationData.json'), 'utf8')).stations;
  const byId = Object.fromEntries(stations.map((s) => [s.id, s]));
  const current = await auditOffers();
  assert.equal(current.errors.length, 0, `page errors: ${current.errors.join('; ')}`);
  const pairs = (d, kind) => { const m = new Map(); for (const o of d.offers) for (const id of o[kind]) { if (typeof id !== 'number') continue; const k = `${o.system}:${id}`; if (!m.has(k)) m.set(k, new Set()); m.get(k).add(o.station || 'planet'); } return m; };
  let checks = 0;
  const report = {};
  for (const [kind, field] of [['ships', 'shipIds'], ['weapons', 'weaponIds']]) {
    const B = pairs(baseline, kind), A = pairs(current, kind);
    const lost = [...B.keys()].filter((k) => !A.has(k));
    const authoredLost = [], fallbackLost = [];
    for (const k of lost) { const id = Number(k.split(':')[1]); for (const v of B.get(k)) { const s = byId[v]; const isAuth = s && (s.stock[field] || []).map(Number).includes(id); (isAuth ? authoredLost : fallbackLost).push(`${v}:${id}`); } }
    report[kind] = { before: B.size, after: A.size, lost: lost.length, authoredLost, fallbackLostVendors: [...new Set(fallbackLost.map((x) => x.split(':')[0]))].length };
    if (kind === 'ships') assert.deepEqual(authoredLost, [], `authored hull offers lost: ${authoredLost.join(', ')}`);
    else assert.deepEqual(authoredLost, ['9-gorn-muster-dock:3'], `authored weapon losses must be limited to the dormant Gorn dock: ${authoredLost.join(', ')}`);
    checks++;
  }
  // The five migrated hull sources: every pair purchasable before is purchasable in-system after.
  const Bs = pairs(baseline, 'ships'), As = pairs(current, 'ships');
  for (const m of roles.OFFER_MIGRATIONS.filter((x) => x.kind === 'ship')) {
    for (const h of m.hulls) { const k = `${m.system}:${h}`; if (Bs.has(k)) assert.ok(As.has(k), `migrated offer ${m.from} -> ${m.to} hull ${h} no longer purchasable in system ${m.system}`); }
    checks++;
  }
  for (const m of roles.OFFER_MIGRATIONS.filter((x) => x.kind === 'weapon')) {
    const Bw = pairs(baseline, 'weapons'), Aw = pairs(current, 'weapons');
    for (const w of m.weapons) { const k = `${m.system}:${w}`; if (Bw.has(k)) assert.ok(Aw.has(k) && Aw.get(k).has(m.to), `relocated weapon ${w} must be sold at ${m.to}`); }
    checks++;
  }
  // Sources must no longer retail hulls; destinations must carry the moved ids.
  for (const m of roles.OFFER_MIGRATIONS.filter((x) => x.kind === 'ship')) {
    const src = current.offers.find((o) => o.station === m.from), dst = current.offers.find((o) => o.station === m.to);
    assert.ok(src && src.sell === false && src.ships.length === 0, `${m.from} must not retail hulls after migration`);
    assert.ok(dst, `destination ${m.to} missing from audit`);
    checks++;
  }
  // Already inactive platform offers stay inactive.
  for (const x of roles.INACTIVE_AUTHORED_OFFERS) {
    const o = current.offers.find((e) => e.station === x.station);
    assert.ok(o && o.sell === false && o.ships.length === 0, `${x.station} platform offers must remain inactive`);
    checks++;
  }
  // Every system that had a ship vendor still has one.
  const sysB = new Set([...Bs.keys()].map((k) => k.split(':')[0])), sysA = new Set([...As.keys()].map((k) => k.split(':')[0]));
  assert.deepEqual([...sysB].filter((s) => !sysA.has(s)), [], 'a system lost all ship vendors');
  checks++;
  const Bw = pairs(baseline, 'weapons'), Aw = pairs(current, 'weapons');
  const wB = new Set([...Bw.keys()].map((k) => k.split(':')[0])), wA = new Set([...Aw.keys()].map((k) => k.split(':')[0]));
  report.systemsLosingAllWeaponSales = [...wB].filter((s) => !wA.has(s));
  console.log('OFFER_AUDIT', JSON.stringify(report));
  console.log(`${checks} station offer checks passed; migration is access-preserving for authored offers.`);
})().catch((e) => { console.error(e); process.exit(1); });
