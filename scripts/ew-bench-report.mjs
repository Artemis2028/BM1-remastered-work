#!/usr/bin/env node
// Aggregate interleaved campaign receipts. Does not run the campaign.
import fs from 'node:fs';
import path from 'node:path';
import {summarizeCampaign} from './ew-bench-lib.mjs';

const dir = path.resolve(process.argv[2] || 'docs/ew/receipts');
const stamp = process.argv[3] || 'campaign-pending';

function loadBlocks(receiptDir, prefix) {
  const files = fs.readdirSync(receiptDir).filter(f => f.startsWith(prefix) && f.endsWith('.json') && !f.includes('summary') && !f.includes('plan') && !f.includes('increments'));
  const blocks = new Map();
  for (const file of files) {
    const m = file.match(/seq(\d+)-(A|B|C1|C2|F)\.json$/);
    if (!m) continue;
    const seq = Number(m[1]);
    const label = m[2];
    const block = blocks.get(seq) || {sequence: seq};
    block[label] = JSON.parse(fs.readFileSync(path.join(receiptDir, file), 'utf8'));
    blocks.set(seq, block);
  }
  return [...blocks.values()].sort((a, b) => a.sequence - b.sequence);
}

const blocks = loadBlocks(dir, stamp);
if (!blocks.length) {
  const summary = {
    stamp,
    status: 'awaiting Fable protocol review — long campaign not started',
    receiptsFound: 0,
    note: 'No campaign sequence receipts yet. Do not treat older 300-sample families as this campaign.'
  };
  console.log(JSON.stringify(summary, null, 2));
  process.exit(0);
}

const summary = {stamp, ...summarizeCampaign(blocks)};
const out = path.join(dir, `${stamp}-summary.json`);
fs.writeFileSync(out, JSON.stringify(summary, null, 2));
console.log(JSON.stringify(summary, null, 2));
console.error(`Wrote ${out}`);
