#!/usr/bin/env node
// Astra synthetic cases for summarizeCampaign / report loader.
// Validation tests ONLY — these are not performance results.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {
  PROTOCOL,
  sha256File,
  summarizeCampaign
} from './ew-bench-lib.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
let checks = 0;
function assert(cond, msg) {
  if (!cond) throw new Error(msg);
  checks++;
}

const receipt = (extra = {}) => ({
  acceptanceEligible: true,
  diagnostics: false,
  errors: [],
  measuredTree: {commit: 'deliberately-not-a-pinned-commit', dirty: ''},
  frameCPU: {samples: 3600, p95: 1, p99: 1.5},
  electronicsPass: {applicable: true, samples: 1000, p95: 1, p99: 2, passed: true},
  ...extra
});
const block = (sequence = 1) => ({
  sequence,
  A: receipt({electronicsPass: {applicable: false}}),
  B: receipt(),
  C1: receipt(),
  C2: receipt()
});

const oneC2 = summarizeCampaign([{sequence: 1, C2: receipt()}]);
assert(oneC2.campaignElectronicsPass.allRunsPassed === false, '1: one C2 cannot allRunsPassed');
assert(oneC2.campaignPassed !== true && oneC2.campaignStatus !== 'passed', '1: one C2 is not a passing campaign');

const diagC2 = receipt({
  acceptanceEligible: false,
  diagnostics: true,
  gc: {calledInsideMeasuredWindow: true}
});
const threeDiagC2 = summarizeCampaign([
  {sequence: 1, C2: diagC2},
  {sequence: 2, C2: {...diagC2}},
  {sequence: 3, C2: {...diagC2}}
]);
assert(threeDiagC2.campaignElectronicsPass.allRunsPassed === false, '2: diagnostic C2s cannot allRunsPassed');
assert(threeDiagC2.campaignStatus !== 'passed', '2: diagnostic C2s are not a passing campaign');

const diagBlock = seq => ({
  sequence: seq,
  A: receipt({electronicsPass: {applicable: false}, acceptanceEligible: false, diagnostics: true, gc: {calledInsideMeasuredWindow: true}}),
  B: receipt({acceptanceEligible: false, diagnostics: true, gc: {calledInsideMeasuredWindow: true}}),
  C1: receipt({acceptanceEligible: false, diagnostics: true, gc: {calledInsideMeasuredWindow: true}}),
  C2: receipt({acceptanceEligible: false, diagnostics: true, gc: {calledInsideMeasuredWindow: true}})
});
const threeDiagFull = summarizeCampaign([diagBlock(1), diagBlock(2), diagBlock(3)]);
assert(threeDiagFull.campaignElectronicsPass.allRunsPassed === false, '2b: full diagnostic blocks cannot allRunsPassed');
assert(threeDiagFull.campaignStatus === 'invalid', '2b: diagnostic campaign is invalid');

const staleSketch = summarizeCampaign([
  {...block(1), C2: receipt({electronicsPass: {applicable: true, samples: 1000, p95: 9, p99: 9, passed: true}})},
  block(2),
  block(3)
]);
assert(staleSketch.campaignElectronicsPass.allRunsPassed === false, '3: sketch 9/9 stale passed cannot allRunsPassed');
assert(staleSketch.campaignStatus !== 'passed', '3: sketch 9/9 is not a passing campaign');

const eligible = (label, sequence, extra = {}) => ({
  ...receipt({
    measuredTree: {commit: PROTOCOL.trees[label], dirty: ''},
    launch: {verified: true, recordedArgv: {verified: true}},
    electronicsPass: label === 'A'
      ? {applicable: false}
      : {applicable: true, samples: 1000, p95: 1, p99: 2, passed: true},
    ...extra
  }),
  treeLabel: label,
  sequence
});
const eligibleBlock = (seq, c2Extra = {}) => ({
  sequence: seq,
  A: eligible('A', seq),
  B: eligible('B', seq),
  C1: eligible('C1', seq),
  C2: eligible('C2', seq, c2Extra)
});
const staleEligible = summarizeCampaign([
  eligibleBlock(1, {electronicsPass: {applicable: true, samples: 1000, p95: 9, p99: 9, passed: true}}),
  eligibleBlock(2),
  eligibleBlock(3)
]);
assert(staleEligible.campaignElectronicsPass.allRunsPassed === false, '3b: eligible 9/9 stale passed cannot allRunsPassed');
assert(staleEligible.campaignElectronicsPass.anyRunFailed === true, '3b: eligible 9/9 is a gate failure');
assert(staleEligible.perRun[0].electronicsPassAbsolute?.passed === false, '3b: recomputed gate ignores stale passed:true');
assert(staleEligible.campaignStatus === 'failed', '3b: eligible 9/9 campaign is failed');

const empty = summarizeCampaign([]);
assert(empty.campaignElectronicsPass.allRunsPassed === false, '4: empty allRunsPassed is false');
assert(empty.campaignPassed === false && empty.campaignStatus !== 'passed', '4: empty is not a passing campaign');

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'ew-astra-'));
const reportDir = path.join(tmp, 'report');
fs.mkdirSync(reportDir);
const n = PROTOCOL.passSamples;
const i95 = Math.min(n - 1, Math.floor(n * 0.95));
const i99 = Math.min(n - 1, Math.floor(n * 0.99));
const series = Array.from({length: n}, (_, i) => (i >= i99 ? 9.2 : i >= i95 ? 3.7 : 1));
const failReceipt = {
  treeLabel: 'C2',
  sequence: 1,
  diagnostics: false,
  profiled: false,
  starved: false,
  acceptanceEligible: true,
  errors: [],
  measuredTree: {commit: PROTOCOL.trees.C2, dirty: ''},
  harness: {
    sha256: sha256File(path.join(root, 'scripts/ew-frame-benchmark.mjs')),
    helperSha256: sha256File(path.join(root, 'scripts/ew-bench-lib.mjs'))
  },
  workload: {
    passWarmup: PROTOCOL.passWarmup,
    passSamples: n,
    warmupTicks: PROTOCOL.tickWarmup,
    measuredTicks: PROTOCOL.tickSamples,
    passCadenceMs: PROTOCOL.passCadenceMs
  },
  launch: {
    extraArgs: [],
    exposeGcFlag: false,
    verified: true,
    recordedArgv: {pid: 1, argv: ['/usr/bin/chromium'], selected: 'playwright-browser-process', verified: true}
  },
  gc: {
    placement: 'none',
    calledBeforeMeasuredWindow: false,
    calledAfterMeasuredWindow: false,
    calledInsideMeasuredWindow: false,
    forcedGcThisRun: false
  },
  frameCPU: {samples: PROTOCOL.tickSamples, p95: 1.4, p99: 1.6},
  electronicsPass: {applicable: true, samples: n, p95: 3.7, p99: 9.2, passed: false},
  detectionPass: {applicable: true, p95: 3.7, p99: 9.2},
  updateMs: {applicable: true, p95: 3.7, p99: 9.2},
  seekerCPU: {applicable: true, p95: 0.2, p99: 0.3},
  samples: {
    ticks: {dtMs: Array.from({length: PROTOCOL.tickSamples}, () => 1)},
    passes: series.map((electronicsMs, i) => ({i, electronicsMs, detectionMs: electronicsMs, updateMs: electronicsMs, projectileMs: 0.2}))
  }
};
fs.writeFileSync(path.join(reportDir, 'campaign-pending-seq1-C2.json'), JSON.stringify(failReceipt));
const report = spawnSync(process.execPath, [path.join(root, 'scripts/ew-bench-report.mjs'), reportDir, 'campaign-pending'], {encoding: 'utf8'});
assert(report.status !== 0, '5: report CLI exits non-zero when anyRunFailed');
const reportJson = JSON.parse(report.stdout);
assert(reportJson.campaignElectronicsPass.anyRunFailed === true, '5: report JSON keeps anyRunFailed');
assert(reportJson.campaignElectronicsPass.allRunsPassed !== true, '5: report cannot allRunsPassed on one failing C2');
assert(reportJson.campaignPassed !== true, '5: report campaignPassed false');
fs.rmSync(tmp, {recursive: true, force: true});

const measure = src => {
  const m = src.match(/const t = performance\.now\(\);\s*B\.updateProjectiles\(1\);\s*const afterSeekers = performance\.now\(\);\s*B\.updatePowerSystems\(12\);\s*B\.updateSensorSystems\(12\);\s*const afterElectronics = performance\.now\(\);/);
  return m ? m[0].replace(/\s+/g, '\n') : null;
};
const oldHarness = fs.readFileSync(path.join(root, 'docs/ew/receipts/harness-e02235c.mjs'), 'utf8');
const newHarness = fs.readFileSync(path.join(root, 'scripts/ew-frame-benchmark.mjs'), 'utf8');
assert(measure(oldHarness) && measure(oldHarness) === measure(newHarness), 'electronicsPass measure block matches preserved harness');

console.log(JSON.stringify({ok: true, checks}, null, 2));
