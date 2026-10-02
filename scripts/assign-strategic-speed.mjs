#!/usr/bin/env node
// Assigns each class in bm-ships/ships.json its strategic speed from the approved BM1 Strategic Speed Rater
// (docs/movement/sources/BM1-strategic-speed-rater.html), exactly as the rater recommends it. There are no
// user overrides. The rater's own recommendation code is run, not re-typed: its per-hull table (OV), its
// rating→multiplier table and its role/class fallback for hulls the table does not name.
//
// Each class gets these fields:
//   strategicSpeedRating      1–10 in half steps (sustained strategic cruise; not impulse, not a warp factor)
//   strategicSpeed            the multiplier for that rating (src/strategic-speed.mjs RATING_MULTIPLIER, which
//                             must equal the rater's table; this script refuses to run if they differ)
//   strategicSpeedConfidence  high | medium | low, as the rater gives it
//   strategicSpeedBasis       rater:table (a named entry) | rater:fallback (the rater's role/class inference)
//   strategicSpeedNote        the rater's stated basis for the value
//
// A retired class is not in the rater's roster. It is given the same fallback the rater would give it, marked
// rater:fallback (retired).
//
// The file is edited in place, field by field, so nothing else in it is re-serialised.
// Then run: node scripts/sync-ship-roster.mjs
import fs from 'node:fs';
import vm from 'node:vm';
import { RATING_MULTIPLIER, ratingMultiplier } from '../src/strategic-speed.mjs';

const raterFile = new URL('../docs/movement/sources/BM1-strategic-speed-rater.html', import.meta.url);
const file = new URL('../bm-ships/ships.json', import.meta.url);

// The rater's recommendation code, from its own script: everything from the multiplier table through
// recommendation().
export function loadRater(html = fs.readFileSync(raterFile, 'utf8')) {
  const start = html.indexOf('const multiplierByRating');
  const end = html.indexOf('let ships=[]');
  if (start < 0 || end < 0) throw new Error('rater script not found');
  const code = `${html.slice(start, end)}\n;({ multiplierByRating, OV, recommendation, fallbackRec });`;
  return vm.runInNewContext(code, {});
}

const isMain = import.meta.url === `file://${process.argv[1]}`;
if (isMain) {
  const R = loadRater();
  // The runtime's multiplier table must be the rater's.
  for (const [k, v] of Object.entries(R.multiplierByRating)) if (RATING_MULTIPLIER[k] !== v) throw new Error(`multiplier for ${k}: runtime ${RATING_MULTIPLIER[k]}, rater ${v}`);
  if (Object.keys(RATING_MULTIPLIER).length !== Object.keys(R.multiplierByRating).length) throw new Error('multiplier tables differ in size');
  let text = fs.readFileSync(file, 'utf8');
  const data = JSON.parse(text);
  let changed = 0;
  for (const ship of data.ships) {
    const rec = R.recommendation(ship);
    const rating = Number(rec.score);
    const fields = {
      strategicSpeedRating: rating,
      strategicSpeed: ratingMultiplier(rating),
      strategicSpeedConfidence: rec.confidence,
      strategicSpeedBasis: Object.prototype.hasOwnProperty.call(R.OV, ship.name) ? 'rater:table' : ship.rosterState === 'retired' ? 'rater:fallback (retired)' : 'rater:fallback',
      strategicSpeedNote: rec.basis,
    };
    const start = text.indexOf(`\n    {\n      "id": ${ship.id},\n`);
    if (start < 0) throw new Error(`ship ${ship.id} not found as a top-level record`);
    const end = text.indexOf('\n    }', start + 1);
    let block = text.slice(start, end);
    // Drop any earlier strategic-speed fields (the category era, or a previous run of this script).
    block = block.replace(/,\n      "strategicSpeed(?:Rating|Confidence|Basis|Note)?": (?:"(?:[^"\\]|\\.)*"|[^\n,]*)(?=,\n|$)/g, '');
    block += Object.entries(fields).map(([k, v]) => `,\n      "${k}": ${JSON.stringify(v)}`).join('');
    if (block !== text.slice(start, end)) changed++;
    text = text.slice(0, start) + block + text.slice(end);
  }
  const parsed = JSON.parse(text);
  for (const s of parsed.ships) if (s.strategicSpeedRating == null || s.strategicSpeed == null) throw new Error(`ship ${s.id} has no rating`);
  fs.writeFileSync(file, text);
  console.log(`strategic speed (rater): ${changed} class record(s) updated of ${data.ships.length}`);
}
