#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import assert from 'node:assert/strict';
import {fileURLToPath} from 'node:url';
import {createShipCatalog} from './catalog.mjs';
const root = path.dirname(fileURLToPath(import.meta.url));
const json = name => JSON.parse(fs.readFileSync(path.join(root, name), 'utf8'));
const manifest = json('ships.json'), map = json('bm2-id-map.json'), sizes = json('size-config.json');
const assets = json('assets.json').assets;
const catalog = createShipCatalog(manifest, map, sizes);
const byPath = new Map(assets.map(asset => [asset.path, asset]));
let checks = 0;
function check(name, fn) { fn(); checks++; console.log(`PASS ${name}`); }
check('212 distinct records; 205 active, two retired and five unbalanced prototypes', () => {
  assert.equal(manifest.ships.length, 212);
  assert.equal(manifest.ships.filter(s => s.rosterState === 'active').length, 205);
  assert.equal(manifest.ships.filter(s => s.rosterState === 'retired').length, 2);
  assert.equal(manifest.ships.filter(s => s.rosterState === 'prototype').length, 5);
  assert.equal(new Set(manifest.ships.map(s => s.key)).size, 212);
  assert(manifest.ships.every(s => s.assetType === 'ship' && !(s.id >= 70 && s.id <= 205)));
});
check('All 152 BM2 source IDs resolve; Galaxy Dreadnaught maps to 49, not 60', () => {
  assert.equal(Object.keys(map.sourceToRemaster).length, 152);
  for (const id of Object.keys(map.sourceToRemaster)) assert(catalog.fromBM2(id));
  assert.equal(catalog.fromBM2(49).id, 49);
  assert.equal(catalog.fromBM2(60).id, 216);
});
check('Every asset is inside this pack, hash-verified and referenced', () => {
  for (const asset of assets) {
    assert(/^assets\/[0-9a-f]{64}\.(png|gif|webp)$/.test(asset.path));
    const raw = fs.readFileSync(path.join(root, asset.path));
    assert.equal(raw.length, asset.bytes);
    assert.equal(crypto.createHash('sha256').update(raw).digest('hex'), asset.sha256);
    assert(manifest.ships.some(s => s.image === asset.path));
  }
});
check('Every image crop and baseline draw size is valid', () => {
  for (const ship of manifest.ships) {
    const asset = byPath.get(ship.image); assert(asset);
    const b = ship.trimBounds;
    assert(b.sx >= 0 && b.sy >= 0 && b.sw > 0 && b.sh > 0);
    assert(b.sx + b.sw <= asset.native[0] && b.sy + b.sh <= asset.native[1]);
    if (ship.rosterState === 'prototype') {assert.equal(catalog.getDrawSize(ship.id), null); continue;}
    const size = catalog.getDrawSize(ship.id);
    assert(size.width > 0 && size.height > 0 && size.width < 521 && size.height < 521);
    assert(Math.abs(size.width / size.height - b.sw / b.sh) < .001);
  }
});
check('26 redirects only new references to 211; retired 63 remains loadable', () => {
  assert.equal(catalog.resolveNewShipId(26), 211);
  assert.equal(catalog.getShip(26).id, 26);
  assert.equal(catalog.resolveNewShipId(63), null);
  assert.equal(catalog.getShip(63).id, 63);
  for (const id of [26, 63]) assert.equal(catalog.eligibleForSpawn(id), false);
});
check('Excalibur, independent capital and Galaxy Dreadnaught are distinct', () => {
  const [galaxy, independent, excalibur] = [49,60,347].map(catalog.getShip);
  assert.equal(new Set([galaxy.image, independent.image, excalibur.image]).size, 3);
  assert.equal(independent.faction, 'neutral'); assert.equal(excalibur.faction, 'terran');
  assert.equal(excalibur.purchaseRequirements.worldPrestige, 100);
});
check('Explicitly retained new artwork is present without fabricated combat stats', () => {
  for(const id of [347,348,349,350,351]) {
    const ship=catalog.getShip(id); assert.equal(ship.rosterState,'prototype');
    assert.equal(ship.hull,undefined);assert.equal(ship.cost,undefined);
    assert.equal(catalog.eligibleForSpawn(id),false);
  }
  assert.equal(catalog.getShip(351).progression.afterShipId,39);
});
check('Blender gets scouts/fighters, not Dominion cruisers or battleships', () => {
  const context={systemName:'Blender',role:'patrol'};
  for(const id of [30,206,322]) assert(catalog.eligibleForSpawn(id,context));
  for(const id of [48,65,216,238]) assert.equal(catalog.eligibleForSpawn(id,context),false);
});
check('Dominion core keeps its heavy ships; only authorized deployments leave', () => {
  for(const id of [48,65,216,238]) {
    if (id !== 65) assert(catalog.eligibleForSpawn(id,{systemName:'Dominica',role:'patrol'}));
    else assert(catalog.eligibleForSpawn(id,{systemName:'Dominica',role:'mission',authorizedDeployment:true}));
    assert.equal(catalog.eligibleForSpawn(id,{systemName:'Earth',role:'fleetAttack'}),false);
    assert(catalog.eligibleForSpawn(id,{systemName:'Earth',role:'fleetAttack',authorizedDeployment:true}));
  }
});
check('Gorn stays reserved; tactical cube requires an authored mission', () => {
  for(const id of [251,252,288]) assert.equal(catalog.eligibleForSpawn(id,{role:'mission',authorizedDeployment:true}),false);
  assert.equal(catalog.eligibleForSpawn(261,{role:'traffic'}),false);
  assert(catalog.eligibleForSpawn(261,{role:'mission',authorizedDeployment:true}));
});
check('No illegal fallback when a faction has no permitted local hulls', () => {
  assert.deepEqual(catalog.spawnPool({systemName:'Earth',role:'traffic'},'gorn'),[]);
  assert.deepEqual(catalog.spawnPool({systemName:'Earth',role:'traffic'},'not-a-faction'),[]);
});
check('World prestige is required independently of money; unknown thresholds fail closed', () => {
  assert.equal(catalog.getPurchaseDecision(206,{systemName:'Blender',credits:1e9,worldPrestige:100}).reason,'prestige-threshold-unconfigured');
  const context={systemName:'Blender',credits:1e9,tierThresholds:{open:10}};
  assert.equal(catalog.getPurchaseDecision(206,{...context,worldPrestige:9}).allowed,false);
  assert.equal(catalog.getPurchaseDecision(206,{...context,worldPrestige:10}).allowed,true);
  assert.equal(catalog.getPurchaseDecision(347,{worldPrestige:99,credits:1e9}).reason,'world-prestige');
  assert.equal(catalog.getPurchaseDecision(347,{worldPrestige:100,credits:1e9}).reason,'balance-pending');
});
check('Secret stock and regional sales require the corresponding vendor/context', () => {
  const c={credits:1e9,worldPrestige:100,tierThresholds:{unassigned:0,strategic:100,military:50}};
  assert.equal(catalog.getPurchaseDecision(49,{...c,systemName:'Paso'}).allowed,false);
  assert.equal(catalog.getPurchaseDecision(49,{...c,systemName:'Paso',vendor:'paso-project-x'}).allowed,true);
  assert.equal(catalog.getPurchaseDecision(216,{...c,systemName:'Blender'}).allowed,false);
  assert.equal(catalog.getPurchaseDecision(216,{...c,systemName:'Dominica'}).allowed,true);
});
check('Changing class scale preserves the aspect ratio and the per-hull envelope', () => {
  const s=catalog.getShip(4), before=catalog.getDrawSize(4);
  const after=catalog.getDrawSize(4,{...sizes.classScales,[s.shipClass]:sizes.classScales[s.shipClass]*2});
  assert.equal(after.width,before.width*2);assert.equal(after.height,before.height*2);
});
console.log(`${checks}/${checks} content/helper checks passed. No game-engine integration is implied.`);
