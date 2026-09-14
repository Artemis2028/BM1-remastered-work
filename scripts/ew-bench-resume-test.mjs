#!/usr/bin/env node
// Focused resume-validation and campaign-reporting tests. No long campaign.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {spawnSync} from 'node:child_process';
import {
  PROTOCOL,
  campaignConfigFromEnv,
  campaignPlan,
  classifyExistingReceipt,
  expectedCampaignMeasurement,
  inspectWorktree,
  isBrowserExecutable,
  selectRecordedArgv,
  sha256File,
  summarizeCampaign,
  validatePlan
} from './ew-bench-lib.mjs';

let checks = 0;
function assert(cond, msg) {
  if (!cond) throw new Error(msg);
  checks++;
}

const astra = spawnSync(process.execPath, [path.join(process.cwd(), 'scripts/ew-bench-astra-synthetics.mjs')], {encoding: 'utf8'});
assert(astra.status === 0, `Astra synthetic suite exits 0 (${astra.stderr || astra.stdout})`);
assert(JSON.parse(astra.stdout).ok === true, 'Astra synthetic suite ok');
const r5 = spawnSync(process.execPath, [path.join(process.cwd(), 'scripts/ew-bench-r5-repro.mjs')], {encoding: 'utf8'});
assert(r5.status === 0, `r5 repro suite exits 0 (${r5.stderr || r5.stdout})`);
assert(JSON.parse(r5.stdout).ok === true, 'r5 repro suite ok');

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'ew-resume-'));
const hashes = {harnessSha256: 'a'.repeat(64), helperSha256: 'b'.repeat(64)};

function write(name, value) {
  const file = path.join(tmp, name);
  fs.writeFileSync(file, typeof value === 'string' ? value : JSON.stringify(value));
  return file;
}

function rankedSeries(n, p95, p99) {
  const i95 = Math.min(n - 1, Math.floor(n * 0.95));
  const i99 = Math.min(n - 1, Math.floor(n * 0.99));
  return Array.from({length: n}, (_, i) => (i >= i99 ? p99 : i >= i95 ? p95 : Math.min(p95, 1)));
}

function validReceipt({label = 'C2', sequence = 1, passed = true, p95 = 1.5, p99 = 2.0, extras = {}} = {}) {
  const passSamples = PROTOCOL.passSamples;
  const tickSamples = 8;
  const applicable = label !== 'A';
  const elec = applicable ? rankedSeries(passSamples, p95, p99) : [];
  const tickP95 = label === 'A' ? 0.8 : 1.4;
  const tickP99 = tickP95;
  const tickVals = rankedSeries(tickSamples, tickP95, tickP99);
  const pin = PROTOCOL.pinned[label];
  return {
    treeLabel: label,
    sequence,
    diagnostics: false,
    profiled: false,
    starved: false,
    acceptanceEligible: true,
    errors: [],
    measuredTree: {commit: PROTOCOL.trees[label], tree: pin.tree, dirty: ''},
    sources: {...pin.sources},
    harness: {sha256: hashes.harnessSha256, helperSha256: hashes.helperSha256},
    workload: {
      passWarmup: PROTOCOL.passWarmup,
      passSamples,
      warmupTicks: PROTOCOL.tickWarmup,
      measuredTicks: tickSamples,
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
      gcFunctionPresent: false,
      calledBeforeMeasuredWindow: false,
      calledAfterMeasuredWindow: false,
      calledInsideMeasuredWindow: false,
      forcedGcThisRun: false
    },
    frameCPU: {samples: tickSamples, p95: tickP95, p99: tickP99},
    electronicsPass: applicable
      ? {applicable: true, samples: passSamples, p95, p99, passed}
      : {applicable: false, samples: null, p95: null, p99: null, passed: null},
    detectionPass: applicable ? {applicable: true, p95, p99} : {applicable: false},
    updateMs: applicable ? {applicable: true, p95, p99} : {applicable: false},
    seekerCPU: applicable ? {applicable: true, p95: 0.2, p99: 0.2} : {applicable: false},
    samples: {
      ticks: {
        dtMs: tickVals,
        tRelMs: tickVals.map((_, i) => i)
      },
      passes: applicable ? elec.map((electronicsMs, i) => ({
        i,
        tEpochMs: 1e12 + i,
        tRelMs: i,
        electronicsMs,
        detectionMs: electronicsMs,
        updateMs: electronicsMs,
        projectileMs: 0.2
      })) : null
    },
    ...extras
  };
}

function expected(label, sequence) {
  return expectedCampaignMeasurement({
    sequence,
    label,
    ...hashes,
    tickSamples: 8
  });
}

const passFile = write('seq1-C2.json', validReceipt({passed: true}));
const passClass = classifyExistingReceipt(passFile, expected('C2', 1));
assert(passClass.action === 'skip' && passClass.status === 'complete-valid', 'skip complete valid pass');
assert(passClass.electronicsPassed === true, 'pass recorded');

const failFile = write('seq1-C2-fail.json', validReceipt({passed: false, p95: 3.7, p99: 9.2}));
const failClass = classifyExistingReceipt(failFile, expected('C2', 1));
assert(failClass.action === 'skip' && failClass.status === 'complete-valid', 'skip complete valid gate failure');
assert(failClass.electronicsPassed === false, 'gate failure stays completed');
assert(/never rerolled/.test(failClass.note), 'gate-fail note');

const missingClass = classifyExistingReceipt(path.join(tmp, 'nope.json'), expected('C2', 1));
assert(missingClass.action === 'run' && missingClass.status === 'missing', 'missing receipt is run, not pass');

const malformed = write('bad.json', '{not json');
const malformedClass = classifyExistingReceipt(malformed, expected('C2', 1));
assert(malformedClass.action === 'stop' && malformedClass.status === 'malformed', 'malformed stops');
assert(fs.existsSync(malformed), 'malformed file preserved');

const empty = write('empty.json', '');
const emptyClass = classifyExistingReceipt(empty, expected('C2', 1));
assert(emptyClass.action === 'stop' && emptyClass.status === 'incomplete', 'empty stops');

const incompleteJson = validReceipt();
delete incompleteJson.samples;
const incomplete = write('incomplete.json', incompleteJson);
const incompleteClass = classifyExistingReceipt(incomplete, expected('C2', 1));
assert(incompleteClass.action === 'stop' && incompleteClass.status === 'incomplete', 'incomplete stops');
assert(fs.existsSync(incomplete), 'incomplete file preserved');

const wrongTree = validReceipt({extras: {measuredTree: {commit: '0'.repeat(40), tree: PROTOCOL.pinned.C2.tree, dirty: ''}}});
const mismatchTree = classifyExistingReceipt(write('wrong-tree.json', wrongTree), expected('C2', 1));
assert(mismatchTree.action === 'stop' && mismatchTree.status === 'mismatch', 'wrong tree SHA stops');

const wrongHarness = validReceipt({extras: {harness: {sha256: 'c'.repeat(64), helperSha256: hashes.helperSha256}}});
assert(classifyExistingReceipt(write('wrong-h.json', wrongHarness), expected('C2', 1)).status === 'mismatch', 'harness hash mismatch');

const wrongHelper = validReceipt({extras: {harness: {sha256: hashes.harnessSha256, helperSha256: 'd'.repeat(64)}}});
assert(classifyExistingReceipt(write('wrong-l.json', wrongHelper), expected('C2', 1)).status === 'mismatch', 'helper hash mismatch');

const wrongSeq = validReceipt({sequence: 2});
assert(classifyExistingReceipt(write('wrong-seq.json', wrongSeq), expected('C2', 1)).status === 'mismatch', 'sequence mismatch');

const shortSamples = validReceipt({extras: {workload: {
  passWarmup: PROTOCOL.passWarmup,
  passSamples: 300,
  warmupTicks: PROTOCOL.tickWarmup,
  measuredTicks: 8,
  passCadenceMs: PROTOCOL.passCadenceMs
}}});
shortSamples.electronicsPass.samples = 300;
shortSamples.samples.passes = Array.from({length: 300}, (_, i) => ({
  i,
  tEpochMs: 1e12 + i,
  tRelMs: i,
  electronicsMs: 1,
  detectionMs: 1,
  updateMs: 1,
  projectileMs: 0.2
}));
assert(classifyExistingReceipt(write('short.json', shortSamples), expected('C2', 1)).status === 'mismatch', '300-sample config mismatch');

const diag = validReceipt({extras: {diagnostics: true}});
assert(classifyExistingReceipt(write('diag.json', diag), expected('C2', 1)).status === 'mismatch', 'diagnostics mismatch');

assert(fs.readFileSync(failFile, 'utf8').includes('3.7'), 'failing receipt still on disk');

const aFile = write('seq1-A.json', validReceipt({label: 'A', sequence: 1}));
assert(classifyExistingReceipt(aFile, expected('A', 1)).action === 'skip', 'pre-sensor complete valid skip');
assert(validReceipt({label: 'A'}).samples.passes === null, 'pre-sensor pass samples are null');
const aWithPasses = validReceipt({label: 'A'});
aWithPasses.samples.passes = [{i: 0, electronicsMs: 1}];
assert(classifyExistingReceipt(write('a-passes.json', aWithPasses), expected('A', 1)).status === 'incomplete', 'pre-sensor pass samples must be null');
const aDet = validReceipt({label: 'A'});
aDet.detectionPass = {applicable: true, p95: 1, p99: 2};
assert(classifyExistingReceipt(write('a-det.json', aDet), expected('A', 1)).status === 'incomplete', 'pre-sensor detectionPass must be N/A');
const aNoTicks = validReceipt({label: 'A'});
aNoTicks.samples.ticks.dtMs = [];
aNoTicks.frameCPU.samples = 0;
assert(classifyExistingReceipt(write('a-ticks.json', aNoTicks), expected('A', 1)).action === 'stop', 'pre-sensor missing ticks stops');

const cleanRepo = path.join(tmp, 'clean-git');
fs.mkdirSync(cleanRepo);
const gitClean = (args) => spawnSync('git', args, {cwd: cleanRepo, encoding: 'utf8'});
gitClean(['init']);
gitClean(['config', 'user.email', 'ew@test']);
gitClean(['config', 'user.name', 'ew']);
fs.writeFileSync(path.join(cleanRepo, 'f'), 'a');
gitClean(['add', 'f']);
gitClean(['commit', '-m', 't']);
const cleanSha = gitClean(['rev-parse', 'HEAD']).stdout.trim();
const reuse = inspectWorktree({path: cleanRepo, expectedSha: cleanSha});
assert(reuse.action === 'reuse' && reuse.status === 'clean-expected', 'reuse clean expected worktree');

const unexpected = inspectWorktree({path: cleanRepo, expectedSha: PROTOCOL.trees.C2});
assert(unexpected.action === 'stop' && unexpected.status === 'unexpected-sha', 'unexpected SHA stops');
assert(/Not force-deleting/.test(unexpected.reason), 'unexpected SHA explains no delete');

const missingWt = inspectWorktree({path: path.join(tmp, 'no-worktree'), expectedSha: PROTOCOL.trees.A});
assert(missingWt.action === 'create' && missingWt.status === 'missing', 'missing worktree is create');

const notGit = inspectWorktree({path: tmp, expectedSha: PROTOCOL.trees.A});
assert(notGit.action === 'stop' && notGit.status === 'not-git', 'non-git existing path stops');

const dirtyRepo = path.join(tmp, 'dirty-git');
fs.mkdirSync(dirtyRepo);
const git = (args) => spawnSync('git', args, {cwd: dirtyRepo, encoding: 'utf8'});
git(['init']);
git(['config', 'user.email', 'ew@test']);
git(['config', 'user.name', 'ew']);
fs.writeFileSync(path.join(dirtyRepo, 'f'), 'a');
git(['add', 'f']);
git(['commit', '-m', 't']);
const dirtySha = git(['rev-parse', 'HEAD']).stdout.trim();
fs.writeFileSync(path.join(dirtyRepo, 'f'), 'dirty');
const dirty = inspectWorktree({path: dirtyRepo, expectedSha: dirtySha});
assert(dirty.action === 'stop' && dirty.status === 'dirty', 'dirty worktree stops');
assert(/Not force-deleting/.test(dirty.reason), 'dirty explains no delete');

function block(seq, {c2p95 = 1.5, c2p99 = 2.0, c2passed = true, c2tick = 1.4, aTick = 0.8} = {}) {
  const tree = (label, extra) => {
    const tickP95 = label === 'A' ? aTick : extra?.tick ?? (label === 'C2' ? c2tick : 1.2);
    const tickP99 = tickP95;
    const j = validReceipt({label, sequence: seq, ...extra});
    j.frameCPU = {samples: j.frameCPU.samples, p95: tickP95, p99: tickP99};
    j.samples.ticks = {
      dtMs: rankedSeries(j.frameCPU.samples, tickP95, tickP99),
      tRelMs: Array.from({length: j.frameCPU.samples}, (_, i) => i)
    };
    return j;
  };
  return {
    sequence: seq,
    A: tree('A'),
    B: tree('B', {p95: 1.2, p99: 1.8, passed: true}),
    C1: tree('C1', {p95: 1.3, p99: 1.9, passed: true}),
    C2: tree('C2', {p95: c2p95, p99: c2p99, passed: c2passed})
  };
}

const incompleteCampaign = summarizeCampaign([block(1), block(2)]);
assert(incompleteCampaign.campaignPassed === false, 'two of three sequences cannot pass');
assert(incompleteCampaign.missing.some(m => m.sequence === 3 && m.label === 'C2'), 'missing C2 seq3');

const green = summarizeCampaign([block(1), block(2), block(3)]);
assert(green.campaignPassed === true, 'three complete passing sequences pass');
assert(green.campaignCumulativeFrame.allRunsPassed === true, 'campaign cumulative pass');
assert(green.perRun[0].trees.C2.detectionP95 != null && green.perRun[0].trees.C2.detectionP99 != null, 'detection p95/p99');
assert(green.perRun[0].trees.C2.updateMsP95 != null && green.perRun[0].trees.C2.updateMsP99 != null, 'updateMs p95/p99');
assert(green.perRun[0].trees.C2.projectileP95 != null && green.perRun[0].trees.C2.projectileP99 != null, 'projectile p95/p99');

const failedStay = summarizeCampaign([
  block(1, {c2p95: 3.7, c2p99: 9.2, c2passed: false}),
  block(2),
  block(3)
]);
assert(failedStay.campaignPassed === false, 'valid gate-failing run fails campaign');
assert(failedStay.perRun[0].electronicsPassAbsolute.passed === false, 'failing run remains listed');
assert(failedStay.campaignElectronicsPass.anyRunFailed === true, 'electronics campaign fail');

const cumulFail = summarizeCampaign([
  block(1),
  block(2, {c2tick: 3.5}),
  block(3)
]);
assert(cumulFail.campaignPassed === false, 'cumulative fail fails campaign');
assert(cumulFail.campaignCumulativeFrame.anyRunFailed === true, 'cumulative campaign verdict');
assert(cumulFail.campaignCumulativeFrame.worstEwMinusPresensorP95 === 2.7, 'worst cumulative listed');

const withInvalid = summarizeCampaign([block(1), block(2), block(3)], {
  invalidReceipts: [{file: failFile, status: 'malformed'}]
});
assert(withInvalid.campaignPassed === false, 'invalid receipts cannot yield overall pass');

const emptySummary = summarizeCampaign([]);
assert(emptySummary.campaignPassed === false, 'no receipts cannot pass');
assert(emptySummary.missing.length === 12, 'empty campaign missing 12 runs');
assert(emptySummary.campaignElectronicsPass.allRunsPassed === false, 'empty allRunsPassed false');

const syntheticC2 = {
  acceptanceEligible: true,
  diagnostics: false,
  errors: [],
  measuredTree: {commit: 'deliberately-not-a-pinned-commit', dirty: ''},
  frameCPU: {samples: 3600, p95: 1, p99: 1.5},
  electronicsPass: {applicable: true, samples: 1000, p95: 1, p99: 2, passed: true}
};
const oneC2 = summarizeCampaign([{sequence: 1, C2: syntheticC2}]);
assert(oneC2.campaignElectronicsPass.allRunsPassed === false, 'single C2 cannot allRunsPassed');
assert(oneC2.campaignStatus !== 'passed', 'single C2 is not a completed passing campaign');

assert(isBrowserExecutable('/usr/bin/chromium'), 'chromium is a browser executable');
assert(isBrowserExecutable('/path/to/headless_shell'), 'headless_shell is a browser executable');
assert(!/chrome/i.test('/usr/bin/chromium'), 'legacy chrome regex misses chromium');
const chromiumArgv = selectRecordedArgv([
  {pid: 3, argv: ['/usr/bin/chromium', '--disable-field-trial-config']}
]);
assert(chromiumArgv.verified === true && chromiumArgv.pid === 3, 'chromium without --type= is verified');
const parentOf = pid => ({20: 10, 10: 1, 50: 9}[pid] ?? 0);
const ownedArgv = selectRecordedArgv([
  {pid: 50, argv: ['/usr/bin/chromium', '--disable-field-trial-config']},
  {pid: 20, argv: ['/usr/bin/chromium', '--owned']}
], {ownerPid: 1, parentOf});
assert(ownedArgv.pid === 20 && ownedArgv.verified === true, 'process ownership ignores unrelated chromium');

const drifted = campaignConfigFromEnv({TREE_C2: '0'.repeat(40)});
assert(drifted.acceptance === false && drifted.drifts.includes('trees.C2'), 'TREE_C2 override is not acceptance');
const generated = campaignPlan(drifted.requested);
assert(generated.runs.filter(r => r.label === 'C2').every(r => r.sha === generated.trees.C2), 'plan.trees and plan.runs stay together');
assert(validatePlan(generated).ok === false, 'unapproved C2 plan is rejected');
const approved = campaignPlan();
approved.harness = {sha256: 'h'.repeat(64), helperSha256: 'l'.repeat(64)};
assert(validatePlan(approved).ok === true, 'approved plan validates');

const repoRoot = process.cwd();
const realHashes = {
  harnessSha256: sha256File(path.join(repoRoot, 'scripts/ew-frame-benchmark.mjs')),
  helperSha256: sha256File(path.join(repoRoot, 'scripts/ew-bench-lib.mjs'))
};
const reportDir = path.join(tmp, 'report-cli');
fs.mkdirSync(reportDir);
const failReceipt = validReceipt({passed: false, p95: 3.7, p99: 9.2});
failReceipt.harness = {sha256: realHashes.harnessSha256, helperSha256: realHashes.helperSha256};
failReceipt.workload.measuredTicks = PROTOCOL.tickSamples;
failReceipt.frameCPU = {samples: PROTOCOL.tickSamples, p95: 1, p99: 1};
failReceipt.seekerCPU = {applicable: true, p95: 0.2, p99: 0.2};
failReceipt.samples.ticks = {
  dtMs: Array.from({length: PROTOCOL.tickSamples}, () => 1),
  tRelMs: Array.from({length: PROTOCOL.tickSamples}, (_, i) => i)
};
fs.writeFileSync(path.join(reportDir, 'campaign-pending-seq1-C2.json'), JSON.stringify(failReceipt));
const report = spawnSync(process.execPath, [path.join(repoRoot, 'scripts/ew-bench-report.mjs'), reportDir, 'campaign-pending'], {encoding: 'utf8'});
assert(report.status !== 0, 'report CLI exits non-zero when anyRunFailed/incomplete');
const reportJson = JSON.parse(report.stdout);
assert(reportJson.campaignElectronicsPass.anyRunFailed === true, 'report JSON keeps anyRunFailed');
assert(reportJson.campaignElectronicsPass.allRunsPassed !== true, 'report cannot allRunsPassed on one failing C2');
assert(reportJson.campaignPassed !== true, 'report campaignPassed false');

const resumeExpected = JSON.stringify(expectedCampaignMeasurement({
  sequence: 1,
  label: 'C2',
  treeSha: PROTOCOL.trees.C2,
  ...realHashes
}));
const resumeCheck = spawnSync(process.execPath, [
  path.join(repoRoot, 'scripts/ew-resume-check.mjs'), 'receipt',
  '--file', path.join(reportDir, 'campaign-pending-seq1-C2.json'),
  '--expected', resumeExpected
], {encoding: 'utf8'});
assert(resumeCheck.status === 0, 'valid gate-failing receipt is skipped, not rerolled');
assert(JSON.parse(resumeCheck.stdout).action === 'skip', 'resume action skip');
assert(JSON.parse(resumeCheck.stdout).electronicsPassed === false, 'retained failure stays a failure');
assert(fs.readFileSync(path.join(reportDir, 'campaign-pending-seq1-C2.json'), 'utf8').includes('3.7'), 'failing receipt preserved');

fs.rmSync(tmp, {recursive: true, force: true});
console.log(JSON.stringify({ok: true, checks}, null, 2));
