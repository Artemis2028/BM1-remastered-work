#!/usr/bin/env node
// Aggregate interleaved campaign receipts. Does not run the campaign.
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {
  PROTOCOL,
  loadCampaignReceipts,
  sha256File,
  summarizeCampaign
} from './ew-bench-lib.mjs';

const dir = path.resolve(process.argv[2] || 'docs/ew/receipts');
const stamp = process.argv[3] || 'campaign-pending';
const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const harnessSha256 = sha256File(path.join(repoRoot, PROTOCOL.harnessFile));
const helperSha256 = sha256File(path.join(repoRoot, PROTOCOL.helperFile));

const {blocks, invalidReceipts} = loadCampaignReceipts(dir, stamp, {harnessSha256, helperSha256});
const summary = {
  stamp,
  status: PROTOCOL.status,
  receiptsFound: blocks.reduce((n, b) => n + ['A', 'B', 'C1', 'C2', 'F'].filter(k => b[k]).length, 0),
  ...summarizeCampaign(blocks, {invalidReceipts})
};
if (!blocks.length) {
  summary.note = 'No valid campaign sequence receipts yet. Do not treat older 300-sample families as this campaign. Missing or invalid runs cannot yield an overall pass.';
}
const out = path.join(dir, `${stamp}-summary.json`);
fs.writeFileSync(out, JSON.stringify(summary, null, 2));
console.log(JSON.stringify(summary, null, 2));
console.error(`Wrote ${out}`);
if (summary.campaignStatus !== 'passed' || summary.campaignPassed !== true) process.exitCode = 1;
