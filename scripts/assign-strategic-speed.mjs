#!/usr/bin/env node
// Assigns each class in bm-ships/ships.json its explicit `strategicSpeed` (SHIP-DEPENDENT-STRATEGIC-SPEED),
// from the class's authored shipClass and role (src/strategic-speed.mjs: CATEGORY_SPEED / speedCategory),
// and records the basis. A value marked `"strategicSpeedBasis": "authored"` is a hand-set value and is
// kept. The file is edited in place, field by field, so nothing else in it is re-serialised.
// Then run: node scripts/sync-ship-roster.mjs
import fs from 'node:fs';
import { authoredSpeed, speedCategory, clampSpeed } from '../src/strategic-speed.mjs';
const file = new URL('../bm-ships/ships.json', import.meta.url);
let text = fs.readFileSync(file, 'utf8');
const data = JSON.parse(text);
let changed = 0;
for (const ship of data.ships) {
  if (ship.strategicSpeedBasis === 'authored' && ship.strategicSpeed != null) continue;
  const v = clampSpeed(authoredSpeed(ship));
  const basis = `category:${speedCategory(ship)}`;
  if (ship.strategicSpeed === v && ship.strategicSpeedBasis === basis) continue;
  const start = text.indexOf(`\n    {\n      "id": ${ship.id},\n`);
  if (start < 0) throw new Error(`ship ${ship.id} not found as a top-level record`);
  const end = text.indexOf('\n    }', start + 1);
  let block = text.slice(start, end);
  block = block.replace(/,\n      "strategicSpeed": [^\n]*\n      "strategicSpeedBasis": "[^"]*"$/, '');
  block += `,\n      "strategicSpeed": ${v},\n      "strategicSpeedBasis": "${basis}"`;
  text = text.slice(0, start) + block + text.slice(end);
  changed++;
}
JSON.parse(text);
fs.writeFileSync(file, text);
console.log(`strategic speed: ${changed} class record(s) updated of ${data.ships.length}`);
