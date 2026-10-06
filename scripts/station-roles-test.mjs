import assert from 'node:assert/strict';
import fs from 'node:fs';
import * as R from '../src/station-roles.mjs';

let checks = 0;
const test = (name, fn) => { fn(); checks++; console.log('PASS', name); };
const stations = JSON.parse(fs.readFileSync(new URL('../data/stationData.json', import.meta.url), 'utf8')).stations;
const audit = fs.readFileSync(new URL('../docs/playtest/STATION-ROLE-AUDIT.csv', import.meta.url), 'utf8').split('\n').slice(1).filter(Boolean);

test('every one of the 36 audited station types has an explicit role with services, effects and missions', () => {
  const types = new Set(audit.map((l) => Number(l.split(',')[3])));
  assert.equal(types.size, 36);
  for (const t of types) {
    const role = R.stationRole(t);
    assert.ok(role, `type ${t} has no role`);
    assert.ok(role.role && role.summary && role.survival, `type ${t} incomplete`);
    assert.ok(Array.isArray(role.missions) && role.missions.length > 0, `type ${t} has no missions`);
    assert.ok(['general', 'licensed', 'small', 'none'].includes(role.services.shipSales));
  }
});
test('every placed station resolves to a capability object; no-commerce roles never sell hulls or weapons', () => {
  for (const s of stations) {
    const cap = R.resolveStationCapabilities(s, { name: R.stationRole(s.stationTypeId)?.name }, { discovered: { gorn: false } });
    assert.ok(cap.role, s.id);
    if ([86, 87, 89, 201].includes(Number(s.stationTypeId))) {
      assert.equal(cap.services.shipSales, 'none', s.id);
      assert.equal(cap.services.weaponSales, false, s.id);
      assert.equal(cap.depot, null, s.id);
    }
  }
});
test('named exceptions: Gorn sites are dormant until discovery, abandoned sites are offline until restored, the derelict node has no habitat bonus', () => {
  const gorn = stations.find((s) => s.id === '9-gorn-muster-dock');
  const dormant = R.resolveStationCapabilities(gorn, {}, { discovered: { gorn: false } });
  assert.equal(dormant.status, 'dormant'); assert.equal(dormant.known, false); assert.equal(R.describeServices(dormant), 'no commerce');
  const awake = R.resolveStationCapabilities(gorn, {}, { discovered: { gorn: true } });
  assert.equal(awake.status, 'operational'); assert.equal(awake.services.shipSales, 'licensed');
  const abandoned = stations.find((s) => s.id === '14-70');
  assert.equal(R.resolveStationCapabilities(abandoned, {}, {}).status, 'abandoned');
  assert.equal(R.resolveStationCapabilities(abandoned, {}, { restored: { '14-70': true } }).status, 'operational');
  const node = stations.find((s) => s.id === 'egg-shipyard-borg-1');
  const derelict = R.resolveStationCapabilities(node, {}, {});
  assert.equal(derelict.status, 'dormant'); assert.equal(derelict.effects.housing, 0);
  const kpec = R.resolveStationCapabilities(stations.find((s) => s.id === '30-106'), {}, {});
  assert.equal(kpec.effects.housing, 0); assert.ok(kpec.missions.includes('extraction'));
});
test('offer migrations move each hull/weapon exactly once and keep provenance; sources retain unrelated weapons', () => {
  const byId = Object.fromEntries(stations.map((s) => [s.id, { ...s, stockIds: s.stock.shipIds, weaponStockIds: s.stock.weaponIds }]));
  for (const m of R.OFFER_MIGRATIONS) {
    const src = R.migratedOffers(byId[m.from]), dst = R.migratedOffers(byId[m.to]);
    for (const h of m.hulls || []) { assert.ok(!src.shipIds.includes(h), `${m.from} still lists ${h}`); assert.ok(dst.shipIds.includes(h), `${m.to} lacks ${h}`); assert.equal(dst.provenance[`ship:${h}`], m.from); }
    for (const w of m.weapons || []) { assert.ok(!src.weaponIds.includes(w)); assert.ok(dst.weaponIds.includes(w)); assert.equal(dst.provenance[`weapon:${w}`], m.from); }
    assert.ok(byId[m.to], `destination ${m.to} must be a real station`);
    assert.equal(byId[m.to].systemIndex, m.system, 'destination must be in the same system');
  }
  assert.deepEqual(R.migratedOffers(byId['5-43']).weaponIds, [14], "Kathy's Pub keeps weapon 14");
  assert.deepEqual(R.migratedOffers(byId['15-71']).weaponIds, [36], 'Nausica Orbital keeps weapon 36');
  assert.deepEqual(R.migratedOffers(byId['import-201-5']).weaponIds, [], 'Swiss Relay Array is relay-only');
});
test('sale permission follows role, depot and mass', () => {
  const yard = R.resolveStationCapabilities({ id: 'y', stationTypeId: 73 }, {});
  assert.equal(R.stationSellsHull(yard, { hullId: 999, mass: 9, authoredHere: false }), true);
  const maint = R.resolveStationCapabilities({ id: 'm', stationTypeId: 83 }, {});
  assert.equal(R.stationSellsHull(maint, { hullId: 1, mass: 4 }), true);
  assert.equal(R.stationSellsHull(maint, { hullId: 1, mass: 5 }), false);
  const trade = R.resolveStationCapabilities({ id: 't', stationTypeId: 75 }, {});
  assert.equal(R.stationSellsHull(trade, { hullId: 1, mass: 4, authoredHere: false }), false);
  assert.equal(R.stationSellsHull(trade, { hullId: 1, mass: 4, authoredHere: true }), true);
  const arboretum = R.resolveStationCapabilities({ id: '3-32', stationTypeId: 84 }, {});
  assert.equal(R.stationSellsHull(arboretum, { hullId: 343, mass: 5 }), true);
  assert.equal(R.stationSellsHull(arboretum, { hullId: 1, mass: 4, authoredHere: true }), false);
});
test('runtime status narrows capabilities: destroyed, under construction, damaged and unstaffed', () => {
  const d = { id: 'x', stationTypeId: 74 };
  assert.equal(R.resolveStationCapabilities({ ...d, destroyed: true }, {}).status, 'destroyed');
  assert.equal(R.resolveStationCapabilities({ ...d, underConstruction: true }, {}).status, 'construction');
  const damaged = R.resolveStationCapabilities(d, {}, { conditionFraction: 0.4 });
  assert.equal(damaged.services.construction, 'none'); assert.equal(damaged.status, 'damaged');
  assert.equal(damaged.effects.berths, 0.8);
  const unstaffed = R.resolveStationCapabilities(d, {}, { staffed: false });
  assert.equal(unstaffed.effects.berths, 0); assert.equal(unstaffed.status, 'unstaffed');
});
console.log(`${checks}/${checks} station role checks passed.`);
