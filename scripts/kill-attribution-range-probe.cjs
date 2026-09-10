#!/usr/bin/env node
/**
 * Static probes for manhunt fire-range gating and kill attribution.
 * Does not run the browser game — checks that the invariants remain encoded in src/main.js.
 */
const fs = require('fs');
const path = require('path');

const mainPath = path.join(__dirname, '..', 'src', 'main.js');
const src = fs.readFileSync(mainPath, 'utf8');
const failures = [];

function assert(cond, msg) {
  if (!cond) failures.push(msg);
}

assert(/function isPlayerKillCreditSource\s*\(/.test(src), 'missing isPlayerKillCreditSource helper');
assert(/npc\.lastDamageSource\s*=\s*source/.test(src), 'damageNpcShip must record lastDamageSource');
assert(/station\.lastDamageSource\s*=\s*source/.test(src), 'damageStation must record lastDamageSource');
assert(/const playerCredited = isPlayerKillCreditSource\(npc\.lastDamageSource\)/.test(src), 'destroyNpcShip must gate rewards on player credit');
assert(/!isPlayerKillCreditSource\(station\.lastDamageSource\)/.test(src), 'destroyStation must gate rewards on player credit');
assert(/creditSource:\s*isPlayerEscortNpc\(npc\)\s*\?\s*'playerEscort'\s*:\s*'npc'/.test(src), 'escort projectiles must carry playerEscort creditSource');
assert(/shot\.creditSource\s*\|\|\s*shot\.owner/.test(src), 'projectile hits must prefer creditSource');

const playerFireBlock = src.match(/else if \(targetPlayer && !playerCloaked\) \{[\s\S]*?\} else if \(npc\.hostile && stationTarget\)/);
assert(playerFireBlock, 'could not locate player-targeting combat block');
if (playerFireBlock) {
  assert(/playerDistance\s*<=\s*weaponRange/.test(playerFireBlock[0]), 'player fire must be gated by weaponRange');
  assert(/getNpcWeaponRange\(npc\)/.test(playerFireBlock[0]), 'player fire gate must use getNpcWeaponRange');
  assert(/fireNpcWeapon\(npc,\s*player,\s*'player'/.test(playerFireBlock[0]), 'player fire call must remain');
}

// Manhunt may still return true at any distance (chase), but fire must be gated separately.
assert(/getFactionStanding\(npc\.faction\)\s*<=\s*-50\)\s*return true/.test(src), 'manhunt chase trigger should remain');

if (failures.length) {
  console.error('FAIL');
  for (const f of failures) console.error(' -', f);
  process.exit(1);
}
console.log('PASS: kill attribution + manhunt fire-range invariants present in src/main.js');
