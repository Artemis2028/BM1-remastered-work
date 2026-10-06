#!/usr/bin/env node
// Assigns each class in bm-ships/ships.json its explicit `recoveryCapacity` (TOWING-SALVAGE-RECOVERY): the
// heaviest hull (catalogue mass 1–10) it can take in tow alone, from the class's role and size category
// (src/strategic-recovery.mjs: CATEGORY_RECOVERY / recoveryCategory), and records the basis. A value
// marked `"recoveryCapacityBasis": "authored"` is a hand-set value and is kept. The file is edited in
// place, field by field, so nothing else in it is re-serialised. Then run: node scripts/sync-ship-roster.mjs
import fs from 'node:fs';
import { speedCategory } from '../src/strategic-speed.mjs';
import { authoredRecoveryCapacity, recoveryCategory } from '../src/strategic-recovery.mjs';
const file = new URL('../bm-ships/ships.json', import.meta.url);
let text = fs.readFileSync(file, 'utf8');
const data = JSON.parse(text);
let changed = 0;
for (const ship of data.ships) {
  if (ship.recoveryCapacityBasis === 'authored' && ship.recoveryCapacity != null) continue;
  const cat = recoveryCategory(ship, speedCategory(ship));
  const v = authoredRecoveryCapacity(ship, speedCategory(ship));
  const basis = `category:${cat}`;
  if (ship.recoveryCapacity === v && ship.recoveryCapacityBasis === basis) continue;
  const start = text.indexOf(`\n    {\n      "id": ${ship.id},\n`);
  if (start < 0) throw new Error(`ship ${ship.id} not found as a top-level record`);
  const end = text.indexOf('\n    }', start + 1);
  let block = text.slice(start, end);
  block = block.replace(/,\n      "recoveryCapacity": [^\n]*\n      "recoveryCapacityBasis": "[^"]*"$/, '');
  block += `,\n      "recoveryCapacity": ${v},\n      "recoveryCapacityBasis": "${basis}"`;
  text = text.slice(0, start) + block + text.slice(end);
  changed++;
}
JSON.parse(text);
fs.writeFileSync(file, text);
console.log(`recovery capacity: ${changed} class record(s) updated of ${data.ships.length}`);
