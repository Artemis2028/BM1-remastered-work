#!/usr/bin/env node
/**
 * Integration-layer checks for wiring bm-ships into the remaster.
 * Uses the real pack over a file-backed fetch so it does not invent fixtures.
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import {
  loadGameShipCatalog,
  mergeCatalogIntoEntities,
  buildSpawnContext,
  buildPurchaseContext,
  detectPurchaseVendor,
  resolveOwnedShipId,
  resolveNewSpawnShipId,
  pickSpawnShip,
  getCatalogDrawSize,
  isAmbiguousIndependentCapitalSave,
  isUnbalancedPrototype,
  describePurchaseDecision,
  isDominionCoreSystem,
  RETIRED_VULCAN_EXPLORER_ID,
  REPLACEMENT_VULCAN_EXPLORER_ID,
  RETIRED_VULCAN_LIFEFORM_ID,
  INDEPENDENT_CAPITAL_ID,
  EXCALIBUR_ID,
} from '../src/ship-catalog-integration.mjs';

const root = path.dirname(fileURLToPath(new URL('../bm-ships/catalog.mjs', import.meta.url)));
const json = (name) => JSON.parse(fs.readFileSync(path.join(root, name), 'utf8'));

async function fileFetch(url) {
  const filePath = fileURLToPath(url);
  const raw = fs.readFileSync(filePath);
  return {
    ok: true,
    status: 200,
    json: async () => JSON.parse(raw.toString('utf8')),
  };
}

let checks = 0;
function check(name, fn) {
  return Promise.resolve()
    .then(fn)
    .then(() => {
      checks += 1;
      console.log(`PASS ${name}`);
    });
}

const remasterEntities = [
  { id: 1, name: 'Steamrunner Class', assetType: 'ship', hull: 250, cost: 18000, image: 'assets/game/ships/1.png' },
  { id: 26, name: 'Vulcan Explorer', assetType: 'ship', hull: 300, cost: 70200 },
  { id: 70, name: 'Outpost', assetType: 'station', hull: 400 },
  { id: 94, name: 'Escape Pod', assetType: 'pod', hull: 5 },
];

const catalog = await loadGameShipCatalog(pathToFileURL(`${root}/`), fileFetch);
const overlay = mergeCatalogIntoEntities(remasterEntities, catalog);
const byId = Object.fromEntries(overlay.map((entity) => [Number(entity.id), entity]));

await check('catalog loads through the remaster helper (HTTP-shaped fetch, not file:// globals)', () => {
  assert.equal(typeof catalog.getShip, 'function');
  assert.equal(typeof catalog.spawnPool, 'function');
  assert.equal(typeof catalog.getPurchaseDecision, 'function');
  assert.equal(typeof catalog.imageUrl, 'function');
  assert.equal(catalog.getShip(216).name.includes('Dominion'), true);
  assert.match(catalog.imageUrl(1), /\/bm-ships\/assets\/[0-9a-f]{64}\./);
});

await check('merge overlays catalog ships and leaves stations/pods untouched', () => {
  assert.equal(byId[70].assetType, 'station');
  assert.equal(byId[70].name, 'Outpost');
  assert.equal(byId[94].assetType, 'pod');
  assert.equal(byId[1].fromShipCatalog, true);
  assert.equal(byId[1].faction, catalog.getShip(1).faction);
  assert.equal(byId[211].fromShipCatalog, true);
  assert.equal(byId[347].rosterState, 'prototype');
  assert.equal(Object.prototype.hasOwnProperty.call(byId[347], 'hull'), false);
  assert.equal(Object.prototype.hasOwnProperty.call(byId[347], 'cost'), false);
});

await check('getShip stays distinct from resolveNewShipId for 26 and 63', () => {
  assert.equal(resolveOwnedShipId(catalog, RETIRED_VULCAN_EXPLORER_ID), 26);
  assert.equal(resolveNewSpawnShipId(catalog, RETIRED_VULCAN_EXPLORER_ID), REPLACEMENT_VULCAN_EXPLORER_ID);
  assert.equal(catalog.getShip(26).id, 26);
  assert.equal(resolveOwnedShipId(catalog, RETIRED_VULCAN_LIFEFORM_ID), 63);
  assert.equal(resolveNewSpawnShipId(catalog, RETIRED_VULCAN_LIFEFORM_ID), null);
  assert.equal(catalog.getShip(63).id, 63);
});

await check('ambiguous shipId 60 is never auto-converted to Excalibur', () => {
  assert.equal(resolveOwnedShipId(catalog, INDEPENDENT_CAPITAL_ID), 60);
  assert.equal(catalog.getShip(60).name.includes('Concord'), true);
  assert.equal(catalog.getShip(EXCALIBUR_ID).id, 347);
  assert.equal(isAmbiguousIndependentCapitalSave(60), true);
  assert.equal(isAmbiguousIndependentCapitalSave(60, { saveVersion: 'excalibur-was-60' }), false);
  assert.equal(isAmbiguousIndependentCapitalSave(60, { explicitChoice: 'excalibur' }), false);
});

await check('Blender remnant traffic and Dominion core / reserved rules', () => {
  const blender = pickSpawnShip(catalog, { systemName: 'Blender', role: 'patrol' }, 'dominion').map((s) => s.id);
  for (const id of [30, 206, 322]) assert(blender.includes(id), `missing Blender remnant ${id}`);
  for (const id of [48, 65, 216, 238]) assert(!blender.includes(id), `illegal Blender hull ${id}`);
  assert.equal(isDominionCoreSystem('Dominica'), true);
  assert.equal(isDominionCoreSystem('Blender'), false);
  const core = pickSpawnShip(catalog, { systemName: 'Dominica', role: 'patrol' }, 'dominion').map((s) => s.id);
  assert(core.includes(216));
  assert(!core.includes(65));
  assert.deepEqual(pickSpawnShip(catalog, { systemName: 'Earth', role: 'traffic' }, 'gorn'), []);
  assert.deepEqual(
    pickSpawnShip(catalog, { systemName: 'Earth', role: 'fleetAttack' }, 'dominion'),
    [],
  );
  const invasion = pickSpawnShip(
    catalog,
    { systemName: 'Earth', role: 'fleetAttack', authorizedDeployment: true },
    'dominion',
  ).map((s) => s.id);
  assert(invasion.includes(216));
  assert.equal(
    catalog.eligibleForSpawn(65, { systemName: 'Dominica', role: 'patrol' }),
    false,
  );
});

await check('purchase uses real prestige/credits/vendor and refuses missing thresholds', () => {
  const rich = buildPurchaseContext({
    systemName: 'Blender',
    credits: 1e9,
    worldPrestige: 100,
  });
  assert.equal(rich.tierThresholds, undefined);
  assert.equal(catalog.getPurchaseDecision(206, rich).reason, 'prestige-threshold-unconfigured');
  assert.match(describePurchaseDecision(catalog.getPurchaseDecision(206, rich), catalog.getShip(206)), /thresholds/);

  const withStandingOnly = buildPurchaseContext({
    systemName: 'Blender',
    credits: 1e9,
    worldPrestige: 0,
    tierThresholds: { open: 10 },
  });
  assert.equal(catalog.getPurchaseDecision(206, withStandingOnly).allowed, false);

  assert.equal(detectPurchaseVendor({ systemName: 'Paso', stationName: 'X-Base' }), 'paso-project-x');
  const paso = buildPurchaseContext({
    systemName: 'Paso',
    stationName: 'X-Base',
    credits: 1e9,
    worldPrestige: 100,
    tierThresholds: { unassigned: 0, strategic: 100, military: 50 },
  });
  assert.equal(paso.vendor, 'paso-project-x');
  assert.equal(catalog.getPurchaseDecision(49, paso).allowed, true);
  assert.equal(catalog.getPurchaseDecision(49, { ...paso, vendor: undefined, stationName: 'Outpost' }).allowed, false);

  assert.equal(catalog.getPurchaseDecision(EXCALIBUR_ID, {
    worldPrestige: 100,
    credits: 1e9,
    systemName: 'Paso',
    vendor: 'paso-project-x',
  }).reason, 'balance-pending');
  assert.equal(isUnbalancedPrototype(catalog.getShip(EXCALIBUR_ID)), true);
});

await check('draw sizes are final envelopes and prototypes stay unsized', () => {
  const size = getCatalogDrawSize(catalog, 1);
  const doubled = catalog.getDrawSize(1, {
    ...json('size-config.json').classScales,
    [catalog.getShip(1).shipClass]: json('size-config.json').classScales[catalog.getShip(1).shipClass] * 2,
  });
  assert(size.width > 0 && size.height > 0);
  assert.equal(doubled.width, size.width * 2);
  assert.equal(getCatalogDrawSize(catalog, EXCALIBUR_ID), null);
});

await check('ambient roles never receive authorizedDeployment from the helper', () => {
  const traffic = buildSpawnContext({
    systemName: 'Earth',
    role: 'traffic',
    authorizedDeployment: true,
  });
  assert.equal(traffic.authorizedDeployment, undefined);
  const attack = buildSpawnContext({
    systemName: 'Earth',
    role: 'fleetAttack',
    authorizedDeployment: true,
  });
  assert.equal(attack.authorizedDeployment, true);
});

await check('catalog JSON and helpers load over HTTP, not file://', async () => {
  const projectRoot = path.dirname(root);
  const server = http.createServer((req, res) => {
    const rel = decodeURIComponent((req.url || '/').split('?')[0]).replace(/^\/+/, '');
    const file = path.resolve(projectRoot, rel);
    if (!file.startsWith(projectRoot) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) {
      res.writeHead(404); res.end('not found'); return;
    }
    res.setHeader('Content-Type', file.endsWith('.json') ? 'application/json' : 'text/javascript');
    fs.createReadStream(file).pipe(res);
  });
  const port = await new Promise((resolve) => server.listen(0, '127.0.0.1', () => resolve(server.address().port)));
  try {
    const httpCatalog = await loadGameShipCatalog(new URL(`http://127.0.0.1:${port}/bm-ships/`), fetch);
    assert.equal(httpCatalog.getShip(216).id, 216);
    assert.match(httpCatalog.imageUrl(1), /^http:\/\/127\.0\.0\.1/);
    const decision = httpCatalog.getPurchaseDecision(347, { worldPrestige: 100, credits: 1e9 });
    assert.equal(decision.reason, 'balance-pending');
    const blender = httpCatalog.spawnPool({ systemName: 'Blender', role: 'patrol' }, 'dominion').map((s) => s.id);
    assert(blender.includes(206));
    assert(!blender.includes(216));
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});

console.log(`${checks}/${checks} remaster ship-catalog integration checks passed.`);
