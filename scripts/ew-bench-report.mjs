#!/usr/bin/env node
// Aggregate interleaved campaign receipts. Does not run the campaign.
import fs from 'node:fs';
import path from 'node:path';
import {PROTOCOL, summarizeCampaign} from './ew-bench-lib.mjs';

const dir = path.resolve(process.argv[2] || 'docs/ew/receipts');
const stamp = process.argv[3] || 'campaign-pending';

function loadBlocks(receiptDir, prefix) {
  const files = fs.existsSync(receiptDir)
    ? fs.readdirSync(receiptDir).filter(f => f.startsWith(prefix) && f.endsWith('.json') && !f.includes('summary') && !f.includes('plan') && !f.includes('increments'))
    : [];
  const blocks = new Map();
  const invalidReceipts = [];
  for (const file of files) {
    const m = file.match(/seq(\d+)-(A|B|C1|C2|F)\.json$/);
    if (!m) continue;
    const full = path.join(receiptDir, file);
    let json;
    try {
      json = JSON.parse(fs.readFileSync(full, 'utf8'));
    } catch (e) {
      invalidReceipts.push({file: full, status: 'malformed', reason: e.message});
      continue;
    }
    if (!json || typeof json !== 'object' || Array.isArray(json)) {
      invalidReceipts.push({file: full, status: 'malformed', reason: 'receipt is not a JSON object'});
      continue;
    }
    const seq = Number(m[1]);
    const label = m[2];
    const block = blocks.get(seq) || {sequence: seq};
    block[label] = json;
    blocks.set(seq, block);
  }
  return {blocks: [...blocks.values()].sort((a, b) => a.sequence - b.sequence), invalidReceipts};
}

const {blocks, invalidReceipts} = loadBlocks(dir, stamp);
const summary = {
  stamp,
  status: PROTOCOL.status,
  receiptsFound: blocks.reduce((n, b) => n + ['A', 'B', 'C1', 'C2', 'F'].filter(k => b[k]).length, 0),
  ...summarizeCampaign(blocks, {invalidReceipts})
};
if (!blocks.length) {
  summary.note = 'No campaign sequence receipts yet. Do not treat older 300-sample families as this campaign. Missing runs cannot yield an overall pass.';
}
const out = path.join(dir, `${stamp}-summary.json`);
fs.writeFileSync(out, JSON.stringify(summary, null, 2));
console.log(JSON.stringify(summary, null, 2));
console.error(`Wrote ${out}`);
if (summary.campaignPassed !== true) process.exitCode = 1;
