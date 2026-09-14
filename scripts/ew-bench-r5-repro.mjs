#!/usr/bin/env node
// Focused negative tests for the r4 review gaps. Not performance receipts.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {
  PROTOCOL,
  campaignPlan,
  expectedCampaignMeasurement,
  fixtureReceipt,
  sha256File,
  summarizeCampaign,
  validatePlan,
  validateReceipt
} from './ew-bench-lib.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
let checks = 0;
function assert(cond, msg) {
  if (!cond) throw new Error(msg);
  checks++;
}

const hashes = {
  harnessSha256: sha256File(path.join(root, 'scripts/ew-frame-benchmark.mjs')),
  helperSha256: sha256File(path.join(root, 'scripts/ew-bench-lib.mjs'))
};

function rec(label, sequence, extra = {}) {
  return fixtureReceipt({
    label,
    sequence,
    commit: PROTOCOL.trees[label],
    harnessSha256: hashes.harnessSha256,
    helperSha256: hashes.helperSha256,
    tickP95: label === 'A' ? 1 : 1.4,
    tickP99: label === 'A' ? 1 : 1.6,
    electronicsP95: 1.5,
    electronicsP99: 2.0,
    ...extra
  });
}

function writeCampaign(dir, blocks) {
  fs.mkdirSync(dir, {recursive: true});
  for (const block of blocks) {
    for (const label of ['A', 'B', 'C1', 'C2']) {
      fs.writeFileSync(path.join(dir, `campaign-pending-seq${block.sequence}-${label}.json`), JSON.stringify(block[label]));
    }
  }
}

function report(dir) {
  return spawnSync(process.execPath, [path.join(root, 'scripts/ew-bench-report.mjs'), dir, 'campaign-pending'], {encoding: 'utf8'});
}

function fullBlocks(mutate = (b) => b) {
  return [1, 2, 3].map(seq => mutate({
    sequence: seq,
    A: rec('A', seq, {tickP95: 1, tickP99: 1}),
    B: rec('B', seq),
    C1: rec('C1', seq),
    C2: rec('C2', seq)
  }));
}

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'ew-r5-'));

// 1. Stale frameCPU vs raw ticks: A=1ms C2=10ms stored C2 p95 1.5.
const staleBlocks = fullBlocks(b => {
  const ticks = Array.from({length: PROTOCOL.tickSamples}, () => 10);
  b.C2 = rec('C2', b.sequence, {tickP95: 10, tickP99: 10});
  b.C2.samples.ticks.dtMs = ticks;
  b.C2.frameCPU = {samples: PROTOCOL.tickSamples, p95: 1.5, p99: 1.5};
  return b;
});
const staleSummary = summarizeCampaign(staleBlocks);
assert(staleSummary.campaignCumulativeFrame.anyRunFailed === true, '1: recomputed cumulative fails on 10-1 ticks');
assert(staleSummary.perRun[0].increments.tickP95.ewMinusPresensor === 9, '1: EW−pre-sensor is +9 ms from samples');
assert(staleSummary.campaignStatus !== 'passed', '1: stale frameCPU cannot pass campaign');
const staleDir = path.join(tmp, 'stale-ticks');
writeCampaign(staleDir, staleBlocks);
const staleReport = report(staleDir);
assert(staleReport.status !== 0, '1: report exits non-zero on stale tick summaries');
const staleJson = JSON.parse(staleReport.stdout);
assert(staleJson.campaignPassed !== true && staleJson.campaignStatus !== 'passed', '1: report does not pass');
const staleExpected = expectedCampaignMeasurement({
  sequence: 1, label: 'C2', treeSha: PROTOCOL.trees.C2, ...hashes
});
assert(validateReceipt(staleBlocks[0].C2, staleExpected).ok === false, '1: validator rejects inconsistent frameCPU');

// 2. expose-gc in recorded argv / gcFunctionPresent with empty extraArgs.
const gcBlocks = fullBlocks(b => {
  b.C2 = rec('C2', b.sequence);
  b.C2.launch.extraArgs = [];
  b.C2.launch.exposeGcFlag = false;
  b.C2.launch.recordedArgv = {
    pid: 1,
    argv: ['/usr/bin/chromium', '--js-flags=--expose-gc'],
    selected: 'playwright-browser-process',
    verified: true
  };
  b.C2.gc.gcFunctionPresent = true;
  return b;
});
assert(validateReceipt(gcBlocks[0].C2, staleExpected).ok === false, '2: validator rejects expose-gc argv');
const gcDir = path.join(tmp, 'expose-gc');
writeCampaign(gcDir, gcBlocks);
const gcReport = report(gcDir);
assert(gcReport.status !== 0, '2: report exits non-zero when argv exposes GC');
assert(JSON.parse(gcReport.stdout).campaignPassed !== true, '2: expose-gc campaign is not passed');

// 3. Permissive-validator holes.
const base = rec('C2', 1);
const expC2 = expectedCampaignMeasurement({sequence: 1, label: 'C2', treeSha: PROTOCOL.trees.C2, ...hashes});
assert(validateReceipt(base, expC2).ok === true, '3: complete C2 is valid');
const dirty = rec('C2', 1);
dirty.measuredTree.dirty = ' M src/main.js';
assert(validateReceipt(dirty, expC2).ok === false, '3: dirty measured tree is rejected');
const wrongTree = rec('C2', 1);
wrongTree.measuredTree.tree = PROTOCOL.pinned.A.tree;
assert(validateReceipt(wrongTree, expC2).ok === false, '3: wrong tree hash is rejected');
assert(validateReceipt(wrongTree, expC2).status === 'mismatch', '3: wrong tree hash is mismatch not skip');
const wrongSources = rec('C2', 1);
wrongSources.sources['src/main.js'] = '0'.repeat(64);
assert(validateReceipt(wrongSources, expC2).ok === false, '3: wrong sources are rejected');
const missingSources = rec('C2', 1);
delete missingSources.sources;
assert(validateReceipt(missingSources, expC2).ok === false, '3: missing sources are rejected');
const missingEligible = rec('C2', 1);
delete missingEligible.acceptanceEligible;
assert(validateReceipt(missingEligible, expC2).ok === false, '3: missing acceptanceEligible is rejected');
const missingErrors = rec('C2', 1);
delete missingErrors.errors;
assert(validateReceipt(missingErrors, expC2).ok === false, '3: missing errors array is rejected');
const launchOnly = rec('C2', 1);
launchOnly.launch.recordedArgv = {verified: true};
assert(validateReceipt(launchOnly, expC2).ok === false, '3: launch.verified without argv is rejected');
const thinPasses = rec('C2', 1);
thinPasses.samples.passes = thinPasses.samples.passes.map(p => ({electronicsMs: p.electronicsMs}));
assert(validateReceipt(thinPasses, expC2).ok === false, '3: electronicsMs-only passes are rejected');
const noTickAt = rec('C2', 1);
delete noTickAt.samples.ticks.tRelMs;
assert(validateReceipt(noTickAt, expC2).ok === false, '3: missing tick timestamps are rejected');
const aOk = rec('A', 1, {tickP95: 1, tickP99: 1});
assert(aOk.samples.passes === null, '3: tree A pass samples stay null');
assert(validateReceipt(aOk, expectedCampaignMeasurement({sequence: 1, label: 'A', treeSha: PROTOCOL.trees.A, ...hashes})).ok === true, '3: tree A with N/A passes is valid');

const permDir = path.join(tmp, 'permissive');
writeCampaign(permDir, fullBlocks(b => {
  b.C2 = rec('C2', b.sequence);
  b.C2.measuredTree.dirty = ' M src/main.js';
  b.C2.measuredTree.tree = PROTOCOL.pinned.A.tree;
  b.C2.sources = {};
  return b;
}));
const permReport = report(permDir);
assert(permReport.status !== 0, '3: report exits non-zero on dirty/wrong-identity receipts');
assert(JSON.parse(permReport.stdout).campaignPassed !== true, '3: identity-invalid campaign is not passed');

// 4. validatePlan holes.
const hashesPlan = {sha256: hashes.harnessSha256, helperSha256: hashes.helperSha256, libSha256: hashes.helperSha256};
const goodPlan = campaignPlan();
goodPlan.harness = hashesPlan;
assert(validatePlan(goodPlan, hashes).ok === true, '4: approved plan with hashes validates');
const twelveA = campaignPlan();
twelveA.harness = hashesPlan;
twelveA.runs = twelveA.runs.map(r => ({...r, label: 'A', sequence: 1, sha: PROTOCOL.trees.A}));
assert(validatePlan(twelveA, hashes).ok === false, '4: 12× A/seq1 is not the matrix');
const onlyC2 = campaignPlan();
onlyC2.harness = hashesPlan;
onlyC2.sequenceOrder = ['C2'];
assert(validatePlan(onlyC2, hashes).ok === false, '4: sequenceOrder C2-only is rejected');
const badGate = campaignPlan();
badGate.harness = hashesPlan;
badGate.gate = {series: 'electronicsPass', p95Ms: 9, p99Ms: 9};
assert(validatePlan(badGate, hashes).ok === false, '4: altered gates are rejected');
const noHash = campaignPlan();
assert(validatePlan(noHash).ok === false, '4: missing harness hashes are rejected');

fs.rmSync(tmp, {recursive: true, force: true});
console.log(JSON.stringify({ok: true, checks}, null, 2));
