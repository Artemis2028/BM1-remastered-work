#!/usr/bin/env node
// Focused resume-validation and campaign-reporting tests. No long campaign.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {spawnSync} from 'node:child_process';
import {
  PROTOCOL,
  classifyExistingReceipt,
  expectedCampaignMeasurement,
  inspectWorktree,
  summarizeCampaign
} from './ew-bench-lib.mjs';

let checks = 0;
function assert(cond, msg) {
  if (!cond) throw new Error(msg);
  checks++;
}

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'ew-resume-'));
const hashes = {harnessSha256: 'a'.repeat(64), helperSha256: 'b'.repeat(64)};

function write(name, value) {
  const file = path.join(tmp, name);
  fs.writeFileSync(file, typeof value === 'string' ? value : JSON.stringify(value));
  return file;
}

function validReceipt({label = 'C2', sequence = 1, passed = true, p95 = 1.5, p99 = 2.0, extras = {}} = {}) {
  const passSamples = PROTOCOL.passSamples;
  const tickSamples = 8;
  const applicable = label !== 'A';
  return {
    treeLabel: label,
    sequence,
    diagnostics: false,
    profiled: false,
    starved: false,
    measuredTree: {commit: PROTOCOL.trees[label], dirty: ''},
    harness: {sha256: hashes.harnessSha256, helperSha256: hashes.helperSha256},
    workload: {
      passWarmup: PROTOCOL.passWarmup,
      passSamples,
      warmupTicks: PROTOCOL.tickWarmup,
      measuredTicks: tickSamples,
      passCadenceMs: PROTOCOL.passCadenceMs
    },
    launch: {extraArgs: [], exposeGcFlag: false},
    gc: {
      placement: 'none',
      calledBeforeMeasuredWindow: false,
      calledAfterMeasuredWindow: false,
      calledInsideMeasuredWindow: false,
      forcedGcThisRun: false
    },
    frameCPU: {samples: tickSamples, p95: label === 'A' ? 0.8 : 1.4, p99: 1.6},
    electronicsPass: applicable
      ? {applicable: true, samples: passSamples, p95, p99, passed}
      : {applicable: false, samples: null, p95: null, p99: null, passed: null},
    detectionPass: applicable ? {applicable: true, p95, p99} : {applicable: false},
    updateMs: applicable ? {applicable: true, p95, p99} : {applicable: false},
    seekerCPU: applicable ? {applicable: true, p95: 0.2, p99: 0.3} : {applicable: false},
    samples: {
      ticks: {dtMs: Array.from({length: tickSamples}, () => 1)},
      passes: applicable ? Array.from({length: passSamples}, (_, i) => ({i})) : null
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

const wrongTree = validReceipt({extras: {measuredTree: {commit: '0'.repeat(40), dirty: ''}}});
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
shortSamples.samples.passes = Array.from({length: 300}, (_, i) => ({i}));
assert(classifyExistingReceipt(write('short.json', shortSamples), expected('C2', 1)).status === 'mismatch', '300-sample config mismatch');

const diag = validReceipt({extras: {diagnostics: true}});
assert(classifyExistingReceipt(write('diag.json', diag), expected('C2', 1)).status === 'mismatch', 'diagnostics mismatch');

assert(fs.readFileSync(failFile, 'utf8').includes('3.7'), 'failing receipt still on disk');

const aFile = write('seq1-A.json', validReceipt({label: 'A', sequence: 1}));
assert(classifyExistingReceipt(aFile, expected('A', 1)).action === 'skip', 'pre-sensor complete valid skip');

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
    const j = validReceipt({label, sequence: seq, ...extra});
    j.frameCPU.p95 = label === 'A' ? aTick : extra?.tick ?? (label === 'C2' ? c2tick : 1.2);
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

fs.rmSync(tmp, {recursive: true, force: true});
console.log(JSON.stringify({ok: true, checks}, null, 2));
