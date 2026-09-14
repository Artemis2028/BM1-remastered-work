#!/usr/bin/env node
// r6: B/C1 updateMs is exactly null + N/A summary; C2/F remain finite.
// Validation only — not performance receipts.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {
  PROTOCOL,
  classifyExistingReceipt,
  expectedCampaignMeasurement,
  fixtureReceipt,
  sha256File,
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
    tickP99: label === 'A' ? 1 : 1.4,
    electronicsP95: 1.5,
    electronicsP99: 2.0,
    ...extra
  });
}

function expected(label, sequence = 1) {
  return expectedCampaignMeasurement({
    sequence,
    label,
    treeSha: PROTOCOL.trees[label],
    ...hashes
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

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'ew-r6-'));

const b = rec('B', 1);
assert(b.samples.passes.every(p => Object.prototype.hasOwnProperty.call(p, 'updateMs')), 'B keeps the updateMs key');
assert(b.samples.passes.every(p => p.updateMs === null), 'B updateMs values are exactly null');
assert(b.updateMs.applicable === false && b.updateMs.p95 == null, 'B updateMs summary is N/A');
assert(validateReceipt(b, expected('B')).ok === true, 'positive B fixture validates');
const bFile = path.join(tmp, 'seq1-B.json');
fs.writeFileSync(bFile, JSON.stringify(b));
assert(classifyExistingReceipt(bFile, expected('B')).action === 'skip', 'resume skips complete valid B');

const c1 = rec('C1', 1);
assert(c1.samples.passes.every(p => p.updateMs === null) && c1.updateMs.applicable === false, 'positive C1 is null + N/A');
assert(validateReceipt(c1, expected('C1')).ok === true, 'positive C1 fixture validates');
const c1File = path.join(tmp, 'seq1-C1.json');
fs.writeFileSync(c1File, JSON.stringify(c1));
assert(classifyExistingReceipt(c1File, expected('C1')).status === 'complete-valid', 'resume treats C1 as complete-valid');

const c2 = rec('C2', 1);
assert(c2.samples.passes.every(p => Number.isFinite(p.updateMs)), 'C2 updateMs stays finite');
assert(c2.updateMs.applicable === true, 'C2 updateMs summary stays applicable');
assert(validateReceipt(c2, expected('C2')).ok === true, 'C2 finite updateMs still validates');

const f = rec('F', 1);
assert(f.samples.passes.every(p => Number.isFinite(p.updateMs)) && f.updateMs.applicable === true, 'F records finite updateMs');
assert(validateReceipt(f, expected('F')).ok === true, 'F finite updateMs validates');

const a = rec('A', 1);
assert(a.samples.passes === null, 'tree A pass samples stay null');
assert(validateReceipt(a, expected('A')).ok === true, 'tree A contract preserved');

const deleted = rec('B', 1);
deleted.samples.passes = deleted.samples.passes.map(({updateMs, ...rest}) => rest);
assert(deleted.samples.passes.every(p => !Object.prototype.hasOwnProperty.call(p, 'updateMs')), 'deleted-key fixture has no updateMs');
assert(validateReceipt(deleted, expected('B')).ok === false, 'deleted updateMs key is rejected');
assert(validateReceipt(deleted, expected('B')).status === 'incomplete', 'deleted updateMs key is incomplete');

const naC2 = rec('C2', 1);
naC2.updateMs = {applicable: false, samples: null, p95: null, p99: null, passed: null};
assert(validateReceipt(naC2, expected('C2')).ok === false, 'N/A updateMs on C2 is rejected');
assert(validateReceipt(naC2, expected('C2')).status === 'mismatch', 'N/A updateMs on C2 is mismatch');

const disagreeB = rec('B', 1);
disagreeB.updateMs = {applicable: true, p95: 1.5, p99: 2.0};
assert(validateReceipt(disagreeB, expected('B')).ok === false, 'B applicable summary vs null samples is rejected');

const disagreeSamples = rec('B', 1);
disagreeSamples.samples.passes = disagreeSamples.samples.passes.map(p => ({...p, updateMs: 1}));
assert(validateReceipt(disagreeSamples, expected('B')).ok === false, 'B finite samples vs N/A summary is rejected');

const disagreeC2 = rec('C2', 1);
disagreeC2.samples.passes = disagreeC2.samples.passes.map(p => ({...p, updateMs: null}));
assert(validateReceipt(disagreeC2, expected('C2')).ok === false, 'C2 null samples vs applicable summary is rejected');

const zeroB = rec('B', 1);
zeroB.samples.passes = zeroB.samples.passes.map(p => ({...p, updateMs: 0}));
assert(validateReceipt(zeroB, expected('B')).ok === false, 'B updateMs 0 is not accepted as N/A');

const blocks = [1, 2, 3].map(seq => ({
  sequence: seq,
  A: rec('A', seq),
  B: rec('B', seq),
  C1: rec('C1', seq),
  C2: rec('C2', seq)
}));
const passDir = path.join(tmp, 'full-pass');
writeCampaign(passDir, blocks);
const passReport = report(passDir);
assert(passReport.status === 0, `full B/C1-realistic campaign report exits 0 (${passReport.stderr || ''})`);
const passJson = JSON.parse(passReport.stdout);
assert(passJson.campaignPassed === true && passJson.campaignStatus === 'passed', 'full realistic campaign passes');
assert(passJson.perRun[0].trees.B.updateMsP95 == null && passJson.perRun[0].trees.C1.updateMsP95 == null, 'report lists B/C1 updateMs as N/A');
assert(passJson.perRun[0].trees.C2.updateMsP95 != null, 'report lists C2 updateMs percentiles');

const naDir = path.join(tmp, 'na-c2');
writeCampaign(naDir, [1, 2, 3].map(seq => ({
  sequence: seq,
  A: rec('A', seq),
  B: rec('B', seq),
  C1: rec('C1', seq),
  C2: (() => {
    const j = rec('C2', seq);
    j.updateMs = {applicable: false, samples: null, p95: null, p99: null, passed: null};
    return j;
  })()
})));
const naReport = report(naDir);
assert(naReport.status !== 0, 'report exits non-zero when C2 updateMs is N/A');
assert(JSON.parse(naReport.stdout).campaignPassed !== true, 'N/A C2 updateMs cannot pass the campaign');

fs.rmSync(tmp, {recursive: true, force: true});
console.log(JSON.stringify({ok: true, checks}, null, 2));
