#!/usr/bin/env node
// bm-ships/ships.json is the authored roster. This generated compatibility
// manifest lets older integrations read the same data without another database
// to tune by hand. No renderer or gameplay code is generated here.
import fs from 'node:fs';
const source = JSON.parse(fs.readFileSync(new URL('../bm-ships/ships.json', import.meta.url)));
const output = JSON.stringify({
  generatedFrom: 'bm-ships/ships.json — run node scripts/sync-ship-roster.mjs; do not edit hulls here',
  version: source.version,
  aliases: source.aliases,
  ships: source.ships.map(ship => ({...ship, image: `bm-ships/${ship.image}`})),
}, null, 2) + '\n';
const target = new URL('../data/starship_manifest.json', import.meta.url);
if (process.argv.includes('--check')) {
  if (fs.readFileSync(target, 'utf8') !== output) throw new Error('Generated ship manifest is stale. Run node scripts/sync-ship-roster.mjs.');
} else fs.writeFileSync(target, output);
