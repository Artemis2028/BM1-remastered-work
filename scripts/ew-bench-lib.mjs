#!/usr/bin/env node
// Shared EW benchmark helpers. Measurement/docs only: no gameplay, no
// threshold changes. Percentile method matches the historical harness
// (nearest-rank floor(n * p) on a copy so raw sample order is kept).
import {spawnSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';

export const PROTOCOL = {
  id: 'ew-benchmark-protocol-20260914',
  status: 'frozen for Fable final diff review — long campaign not started',
  protocolTag: 'ew-fable-protocol-20260914',
  gate: {
    series: 'electronicsPass',
    p95Ms: 2,
    p99Ms: 4,
    thresholdsRecalibrated: false
  },
  cumulativeFrameP95Ms: 2,
  passWarmup: 50,
  passSamples: 1000,
  tickWarmup: 600,
  tickSamples: 3600,
  renderSamples: 300,
  passCadenceMs: 200,
  viewport: {width: 1280, height: 850},
  sequenceOrder: ['A', 'B', 'C1', 'C2'],
  optionalFifthPin: 'F',
  sequenceRepetitions: 3,
  previousHarness: {
    commit: 'e02235caea7e23296f827d8519330c664e84e241',
    file: 'docs/ew/receipts/harness-e02235c.mjs',
    sha256: 'e79876004ea9b8846ed6f31ca040fc1ff2452db43f77ba744837d9fb6b8b115d',
    note: 'Preserved. New harness hash is expected; freeze the new file only after Fable reviews the diff.'
  },
  duration: {
    perSensorTreePassLoopSec: 200,
    perSensorTreePassLoop: '3 min 20 s',
    sensorBearingTrees: ['B', 'C1', 'C2'],
    sequences: 3,
    timedSensorPassesSec: 1800,
    timedSensorPasses: '~30 min',
    warmupPerSensorTreeSec: 10,
    plus: 'tree A ticks, 600+3600 tick measure, browser setup; optional F or --diagnostics add time'
  },
  trees: {
    A: '6958f08e73aff55efbf48bae3f9433e5acc270e8',
    B: 'e7aa3c594e4799c54d48e2eeac37a2a1acf36b9b',
    C1: '74caf837c7882a86e3bd7c74f083029453953c1a',
    C2: '51738caf3a1d88492c4fc48a7c0125d4a7e2a355',
    F: '077a9cedaa5a6cb858b200addb115d862ab238e6'
  },
  freezeTag: 'ew-fable-candidate-20260913',
  freezeMoved: false,
  harnessFile: 'scripts/ew-frame-benchmark.mjs',
  helperFile: 'scripts/ew-bench-lib.mjs',
  sourceFiles: ['src/main.js', 'src/ship-sensors.mjs', 'src/ship-ew.mjs', 'src/ship-hoj.mjs'],
  percentileMethod: 'nearest-rank floor(n * p) on a sorted copy',
  percentile: {
    method: 'nearest-rank floor(n * p) on a sorted copy',
    n1000: {p50Index: 500, p95Index: 950, p99Index: 990},
    note: 'Copy is required so raw sample order is kept. Same method as historical 300-sample receipts (those used n = 300). Mean / stdev / min / max are variability, not the gate.'
  },
  timer: {
    api: 'performance.now()',
    epochApi: 'Date.now() immediately before const t = performance.now(); not inside the timed deltas',
    observedQuantizationMs: 0.1,
    note: 'Receipts in this family commonly show ~0.1 ms steps (Chromium time resolution). Percentiles use the recorded values as-is.'
  },
  preloadInjectedFlags: {
    extraArgs: 'flags this process passed to chromium.launch ([] on acceptance)',
    recordedArgv: 'live Chromium argv from /proc; prefer the browser process without --type=',
    note: 'Playwright injects additional Chromium flags that appear in recordedArgv but not extraArgs. Those are preload-injected; they are not extraArgs.'
  },
  order: 'updateProjectiles(1) → updatePowerSystems(12) → updateSensorSystems(12)'
};

// Current Platinum evidence for measured tree 51738ca is Astra's rerun family.
// Historical 2.50/6.90 (performance-*.json) and supplementary 1.60/2.20 stay
// labeled as historical; they are not current 51738ca Platinum results.
export const PLATINUM_EVIDENCE = {
  measuredTree: PROTOCOL.trees.C2,
  current: {
    source: 'Astra 51738ca Platinum rerun family',
    series: 'electronicsPass',
    c2: [
      {p95: 3.7, p99: 9.2, passed: false},
      {p95: 2.0, p99: 4.3, passed: false}
    ],
    sensorBaselineP99Failed: true,
    cumulativeFrameIncrementsPassed: true,
    note: 'Current Platinum evidence for 51738ca. Both C2 runs failed electronicsPass 2/4. Sensor baseline also failed p99; cumulative frame increments passed.'
  },
  historical: {
    performanceJson: {
      family: 'performance-*.json',
      host: 'INTEL(R) XEON(R) PLATINUM 8573C',
      p95: 2.5,
      p99: 6.9,
      passed: false,
      note: 'Older EW tip, not 51738ca. Kept as historical evidence; not current 51738ca results.'
    },
    supplementaryFollowup: {
      family: 'perf-followup-20260914-*.json',
      p95: 1.6,
      p99: 2.2,
      passed: true,
      note: '300-sample quieter supplementary host of 51738ca. Not current Platinum authority.'
    }
  }
};

export function argFlag(argv, name) {
  return argv.includes(name);
}

export function argValue(argv, name, fallback = null) {
  const i = argv.indexOf(name);
  if (i < 0 || i + 1 >= argv.length) return fallback;
  return argv[i + 1];
}

export function argInt(argv, name, fallback) {
  const raw = argValue(argv, name, null);
  if (raw == null) return fallback;
  const n = Number(raw);
  if (!Number.isInteger(n) || n < 0) throw new Error(`${name} requires a non-negative integer`);
  return n;
}

export function sha256File(file) {
  return createHash('sha256').update(fs.readFileSync(file)).digest('hex');
}

export function sourceHashes(root, files = PROTOCOL.sourceFiles) {
  return Object.fromEntries(files.filter(f => fs.existsSync(path.join(root, f))).map(f => [f, sha256File(path.join(root, f))]));
}

function git(cwd, args) {
  const r = spawnSync('git', ['-C', cwd, ...args], {encoding: 'utf8'});
  if (r.status !== 0) return null;
  return (r.stdout || '').trim();
}

export function gitIdentity(cwd) {
  const head = git(cwd, ['rev-parse', 'HEAD']);
  if (!head) {
    return {cwd, available: false};
  }
  return {
    cwd,
    available: true,
    commit: head,
    tree: git(cwd, ['rev-parse', 'HEAD^{tree}']),
    dirty: git(cwd, ['status', '--porcelain']) || '',
    describe: git(cwd, ['describe', '--always', '--abbrev=40'])
  };
}

export function fileBlobHash(cwd, rel) {
  return git(cwd, ['hash-object', rel]);
}

export function percentileStats(values) {
  if (!values || !values.length) {
    return {
      samples: 0,
      min: null,
      max: null,
      mean: null,
      stdev: null,
      p50: null,
      p95: null,
      p99: null,
      method: PROTOCOL.percentileMethod
    };
  }
  const sorted = values.slice().sort((a, b) => a - b);
  const n = sorted.length;
  const mean = sorted.reduce((s, x) => s + x, 0) / n;
  const variance = sorted.reduce((s, x) => s + (x - mean) ** 2, 0) / n;
  const rank = p => sorted[Math.min(n - 1, Math.floor(n * p))];
  return {
    samples: n,
    min: sorted[0],
    max: sorted[n - 1],
    mean,
    stdev: Math.sqrt(variance),
    p50: rank(0.5),
    p95: rank(0.95),
    p99: rank(0.99),
    method: PROTOCOL.percentileMethod
  };
}

export function seriesGate(stats, p95Ms = PROTOCOL.gate.p95Ms, p99Ms = PROTOCOL.gate.p99Ms) {
  if (!stats || stats.samples === 0 || stats.p95 == null) return null;
  return stats.p95 <= p95Ms && stats.p99 <= p99Ms;
}

export function acceptanceEligible({
  passWarmup,
  passSamples,
  tickWarmup,
  tickSamples,
  profiled = false,
  diagnostics = false,
  starved = false
}) {
  return passWarmup === PROTOCOL.passWarmup
    && passSamples >= PROTOCOL.passSamples
    && tickWarmup === PROTOCOL.tickWarmup
    && tickSamples === PROTOCOL.tickSamples
    && !profiled
    && !diagnostics
    && !starved;
}

export function rnd(n) {
  return n == null || Number.isNaN(n) ? null : Math.round(n * 100) / 100;
}

export function selectRecordedArgv(candidates) {
  if (!candidates?.length) return null;
  const withoutType = candidates.filter(c => !(c.argv || []).some(a => String(a).startsWith('--type=')));
  const chosen = withoutType[0] || candidates[0];
  return {
    ...chosen,
    selected: withoutType.length ? 'browser-process-without-type' : 'fallback-chrome-with-type',
    candidateCount: candidates.length
  };
}

export function preloadInjectedFlags(recorded, extraArgs = []) {
  const extra = new Set(extraArgs || []);
  return (recorded?.argv || []).filter(a => typeof a === 'string' && a.startsWith('--') && !extra.has(a));
}

export function deriveGcSummary(gcState = {}, {
  diagnostics = false,
  exposeGcFlag = false,
  gcPlacement = 'none'
} = {}) {
  const calledBefore = !!gcState.calledBeforeMeasuredWindow;
  const calledAfter = !!gcState.calledAfterMeasuredWindow;
  const calledInside = !!gcState.calledInsideMeasuredWindow;
  const called = calledBefore || calledAfter || calledInside;
  return {
    ...gcState,
    placement: gcPlacement,
    diagnostics: !!diagnostics,
    exposeGcFlag: !!exposeGcFlag,
    gcFunctionPresent: !!gcState.gcFunctionPresent,
    calledBeforeMeasuredWindow: calledBefore,
    calledAfterMeasuredWindow: calledAfter,
    calledInsideMeasuredWindow: calledInside,
    forcedGcInAcceptance: false,
    forcedGcThisRun: called,
    note: gcPlacement === 'none'
      ? 'acceptance: forced GC is forbidden. No --js-flags=--expose-gc. gc() is never called. Naturally occurring GC stays in the samples. forcedGcThisRun is derived from actual gc() calls, not the diagnostics flag.'
      : gcPlacement === 'between-blocks'
        ? 'labelled diagnostics only (not acceptance): expose-gc; gc() after warmup and after the measured loop. Can shift collection costs; never the gate. forcedGcThisRun follows actual calls.'
        : 'labelled diagnostics only (not acceptance): expose-gc; gc() inside the measured loop between samples. Suppression; never the gate. forcedGcThisRun follows actual calls.'
  };
}

export function inspectWorktree({path: wt, expectedSha} = {}) {
  if (!wt) {
    return {action: 'stop', status: 'error', reason: 'worktree path required'};
  }
  if (!expectedSha) {
    return {action: 'stop', status: 'error', path: wt, reason: 'expected SHA required'};
  }
  if (!fs.existsSync(wt)) {
    return {action: 'create', status: 'missing', path: wt, expectedSha};
  }
  const identity = gitIdentity(wt);
  if (!identity.available) {
    return {
      action: 'stop',
      status: 'not-git',
      path: wt,
      expectedSha,
      reason: `path exists but is not a usable git worktree at expected ${expectedSha}; not deleting`
    };
  }
  if (identity.dirty) {
    return {
      action: 'stop',
      status: 'dirty',
      path: wt,
      commit: identity.commit,
      expectedSha,
      dirty: identity.dirty,
      reason: `worktree is dirty at ${identity.commit}; expected ${expectedSha}. Not force-deleting.`
    };
  }
  if (identity.commit !== expectedSha) {
    return {
      action: 'stop',
      status: 'unexpected-sha',
      path: wt,
      commit: identity.commit,
      expectedSha,
      reason: `worktree HEAD ${identity.commit} differs from expected ${expectedSha}. Not force-deleting.`
    };
  }
  return {
    action: 'reuse',
    status: 'clean-expected',
    path: wt,
    commit: identity.commit,
    expectedSha
  };
}

export function expectedCampaignMeasurement({
  sequence,
  label,
  treeSha = PROTOCOL.trees[label],
  harnessSha256,
  helperSha256,
  passWarmup = PROTOCOL.passWarmup,
  passSamples = PROTOCOL.passSamples,
  tickWarmup = PROTOCOL.tickWarmup,
  tickSamples = PROTOCOL.tickSamples,
  passCadenceMs = PROTOCOL.passCadenceMs
} = {}) {
  return {
    sequence,
    label,
    treeSha,
    harnessSha256,
    helperSha256,
    passWarmup,
    passSamples,
    tickWarmup,
    tickSamples,
    passCadenceMs,
    diagnostics: false,
    profiled: false,
    starved: false,
    gcPlacement: 'none',
    extraArgs: []
  };
}

function asArray(v) {
  return Array.isArray(v) ? v : null;
}

function completenessProblems(j, expected = {}) {
  const problems = [];
  const label = expected.label || j.treeLabel;
  if (!j.measuredTree || typeof j.measuredTree.commit !== 'string' || !j.measuredTree.commit) {
    problems.push('missing measuredTree.commit');
  }
  if (!j.harness || typeof j.harness.sha256 !== 'string' || !j.harness.sha256) {
    problems.push('missing harness.sha256');
  }
  if (expected.helperSha256 && (typeof j.harness?.helperSha256 !== 'string' || !j.harness.helperSha256)) {
    problems.push('missing harness.helperSha256');
  }
  if (j.treeLabel == null || j.treeLabel === '') problems.push('missing treeLabel');
  if (j.sequence == null || !Number.isInteger(j.sequence)) problems.push('missing integer sequence');
  const wl = j.workload || {};
  if (!Number.isInteger(wl.passWarmup) && wl.passWarmup !== 0) problems.push('missing workload.passWarmup');
  if (!Number.isInteger(wl.passSamples) && wl.passSamples !== 0) problems.push('missing workload.passSamples');
  const tickWarmup = wl.warmupTicks ?? wl.tickWarmup;
  const tickSamples = wl.measuredTicks ?? wl.tickSamples;
  if (!Number.isInteger(tickWarmup)) problems.push('missing workload tick warmup');
  if (!Number.isInteger(tickSamples)) problems.push('missing workload tick samples');
  if (!Array.isArray(j.launch?.extraArgs)) problems.push('missing launch.extraArgs array');
  if (!j.gc || typeof j.gc !== 'object') problems.push('missing gc object');
  else {
    for (const k of ['calledBeforeMeasuredWindow', 'calledAfterMeasuredWindow', 'calledInsideMeasuredWindow']) {
      if (typeof j.gc[k] !== 'boolean') problems.push(`missing gc.${k}`);
    }
  }
  const frameSamples = j.frameCPU?.samples;
  const tickDt = asArray(j.samples?.ticks?.dtMs);
  if (!Number.isInteger(frameSamples) || frameSamples < 1) problems.push('missing frameCPU.samples');
  if (!tickDt) problems.push('missing samples.ticks.dtMs');
  else if (Number.isInteger(frameSamples) && tickDt.length !== frameSamples) {
    problems.push(`tick sample count ${tickDt.length} != frameCPU.samples ${frameSamples}`);
  }
  const sensorTree = label && label !== 'A';
  if (sensorTree || j.electronicsPass?.applicable === true) {
    const elec = j.electronicsPass;
    if (!elec || elec.applicable !== true) problems.push('sensor tree missing applicable electronicsPass');
    else {
      if (!Number.isInteger(elec.samples) || elec.samples < 1) problems.push('electronicsPass.samples missing');
      if (elec.p95 == null || elec.p99 == null) problems.push('electronicsPass missing p95/p99');
      if (typeof elec.passed !== 'boolean') problems.push('electronicsPass.passed must be boolean');
      const passes = asArray(j.samples?.passes);
      if (!passes) problems.push('missing samples.passes');
      else if (Number.isInteger(elec.samples) && passes.length !== elec.samples) {
        problems.push(`pass sample count ${passes.length} != electronicsPass.samples ${elec.samples}`);
      }
    }
    for (const [key, obj] of [['detectionPass', j.detectionPass], ['updateMs', j.updateMs], ['seekerCPU', j.seekerCPU]]) {
      if (!obj) {
        problems.push(`missing ${key}`);
        continue;
      }
      if (obj.applicable === true && (obj.p95 == null || obj.p99 == null)) {
        problems.push(`${key} applicable but missing p95/p99`);
      }
    }
  } else if (label === 'A') {
    if (j.electronicsPass?.applicable !== false) problems.push('pre-sensor electronicsPass must be not applicable');
  }
  return problems;
}

function sameArgs(actual, expected) {
  const a = actual || [];
  const b = expected || [];
  return a.length === b.length && a.every((x, i) => x === b[i]);
}

function mismatchProblems(j, expected = {}) {
  const problems = [];
  const commit = j.measuredTree?.commit;
  if (expected.treeSha && commit && commit !== expected.treeSha) {
    problems.push(`tree SHA ${commit} != expected ${expected.treeSha}`);
  }
  if (expected.label != null && j.treeLabel !== expected.label) {
    problems.push(`treeLabel ${j.treeLabel} != expected ${expected.label}`);
  }
  if (expected.sequence != null && j.sequence !== expected.sequence) {
    problems.push(`sequence ${j.sequence} != expected ${expected.sequence}`);
  }
  if (expected.harnessSha256 && j.harness?.sha256 && j.harness.sha256 !== expected.harnessSha256) {
    problems.push('harness sha256 mismatch');
  }
  if (expected.helperSha256 && j.harness?.helperSha256 && j.harness.helperSha256 !== expected.helperSha256) {
    problems.push('helper sha256 mismatch');
  }
  const wl = j.workload || {};
  const tickWarmup = wl.warmupTicks ?? wl.tickWarmup;
  const tickSamples = wl.measuredTicks ?? wl.tickSamples;
  if (expected.passWarmup != null && wl.passWarmup !== expected.passWarmup) {
    problems.push(`passWarmup ${wl.passWarmup} != expected ${expected.passWarmup}`);
  }
  if (expected.passSamples != null && wl.passSamples !== expected.passSamples) {
    problems.push(`passSamples ${wl.passSamples} != expected ${expected.passSamples}`);
  }
  if (expected.tickWarmup != null && tickWarmup !== expected.tickWarmup) {
    problems.push(`tickWarmup ${tickWarmup} != expected ${expected.tickWarmup}`);
  }
  if (expected.tickSamples != null && tickSamples !== expected.tickSamples) {
    problems.push(`tickSamples ${tickSamples} != expected ${expected.tickSamples}`);
  }
  if (expected.passCadenceMs != null && wl.passCadenceMs !== expected.passCadenceMs) {
    problems.push(`passCadenceMs ${wl.passCadenceMs} != expected ${expected.passCadenceMs}`);
  }
  if (expected.diagnostics === false && (j.diagnostics === true || j.gc?.diagnostics === true)) {
    problems.push('diagnostics receipt is not acceptance measurement configuration');
  }
  if (expected.profiled === false && (j.profiled === true || j.harness?.profiled === true)) {
    problems.push('profiled receipt is not acceptance measurement configuration');
  }
  if (expected.starved === false && (j.starved === true || j.workload?.starved === true)) {
    problems.push('starved receipt is not acceptance measurement configuration');
  }
  const placement = j.gc?.placement ?? j.harness?.gcPlacement;
  if (expected.gcPlacement != null && placement && placement !== expected.gcPlacement) {
    problems.push(`gcPlacement ${placement} != expected ${expected.gcPlacement}`);
  }
  if (expected.extraArgs && !sameArgs(j.launch?.extraArgs, expected.extraArgs)) {
    problems.push('launch.extraArgs mismatch');
  }
  if (j.launch?.exposeGcFlag === true) {
    problems.push('exposeGcFlag is true; acceptance forbids --js-flags=--expose-gc');
  }
  if (j.gc?.forcedGcThisRun === true) {
    problems.push('forcedGcThisRun is true; acceptance never calls gc()');
  }
  return problems;
}

export function classifyExistingReceipt(file, expected = {}) {
  if (!file) {
    return {action: 'stop', status: 'error', reason: 'receipt path required'};
  }
  if (!fs.existsSync(file)) {
    return {action: 'run', status: 'missing', file, reason: 'receipt not present'};
  }
  let st;
  try {
    st = fs.statSync(file);
  } catch (e) {
    return {action: 'stop', status: 'malformed', file, reason: `unreadable: ${e.message}`};
  }
  if (st.isDirectory()) {
    return {action: 'stop', status: 'mismatch', file, reason: 'path exists as a directory; not deleting'};
  }
  let raw;
  try {
    raw = fs.readFileSync(file, 'utf8');
  } catch (e) {
    return {action: 'stop', status: 'malformed', file, reason: `unreadable: ${e.message}`};
  }
  if (!String(raw).trim()) {
    return {action: 'stop', status: 'incomplete', file, reason: 'empty receipt; not overwriting'};
  }
  let j;
  try {
    j = JSON.parse(raw);
  } catch (e) {
    return {action: 'stop', status: 'malformed', file, reason: `invalid JSON: ${e.message}`};
  }
  if (!j || typeof j !== 'object' || Array.isArray(j)) {
    return {action: 'stop', status: 'malformed', file, reason: 'receipt is not a JSON object'};
  }
  const incomplete = completenessProblems(j, expected);
  if (incomplete.length) {
    return {
      action: 'stop',
      status: 'incomplete',
      file,
      reason: incomplete.join('; '),
      problems: incomplete
    };
  }
  const mismatches = mismatchProblems(j, expected);
  if (mismatches.length) {
    return {
      action: 'stop',
      status: 'mismatch',
      file,
      reason: mismatches.join('; '),
      problems: mismatches
    };
  }
  const elec = j.electronicsPass;
  const electronicsPassed = elec?.applicable === false ? null : elec?.passed === true;
  return {
    action: 'skip',
    status: 'complete-valid',
    file,
    gatePassed: electronicsPassed,
    electronicsPassed,
    note: elec?.passed === false
      ? 'valid gate-failing run stays completed and is never rerolled'
      : 'complete valid receipt matching expected tree, hashes, sequence, and measurement configuration'
  };
}

export function campaignPlan({withFreeze = false, repetitions = PROTOCOL.sequenceRepetitions} = {}) {
  const order = withFreeze ? [...PROTOCOL.sequenceOrder, PROTOCOL.optionalFifthPin] : [...PROTOCOL.sequenceOrder];
  const sequences = [];
  for (let seq = 1; seq <= repetitions; seq++) {
    for (const label of order) {
      sequences.push({
        sequence: seq,
        label,
        sha: PROTOCOL.trees[label],
        role: label === 'F'
          ? 'frozen candidate, same-session comparison only; tag not moved'
          : label === 'A'
            ? 'pre-sensor / OPS frame baseline; sensor-pass N/A'
            : label === 'B'
              ? 'sensors, ordinary torpedoes'
              : label === 'C1'
                ? 'paid noise/ECCM, ordinary torpedoes'
                : 'measured EW candidate (full EW + HOJ)'
      });
    }
  }
  return {
    protocol: PROTOCOL.id,
    status: PROTOCOL.status,
    protocolTag: PROTOCOL.protocolTag,
    gate: PROTOCOL.gate,
    cumulativeFrameP95Ms: PROTOCOL.cumulativeFrameP95Ms,
    trees: PROTOCOL.trees,
    freezeTag: PROTOCOL.freezeTag,
    freezeMoved: false,
    withFreeze,
    sequenceOrder: order,
    repetitions,
    warmup: {passWarmup: PROTOCOL.passWarmup, tickWarmup: PROTOCOL.tickWarmup, passCadenceMs: PROTOCOL.passCadenceMs},
    measured: {passSamples: PROTOCOL.passSamples, tickSamples: PROTOCOL.tickSamples, renderSamples: PROTOCOL.renderSamples},
    previousHarness: PROTOCOL.previousHarness,
    duration: PROTOCOL.duration,
    percentile: PROTOCOL.percentile,
    timer: PROTOCOL.timer,
    preloadInjectedFlags: PROTOCOL.preloadInjectedFlags,
    platinumEvidence: PLATINUM_EVIDENCE,
    resume: {
      oneSequenceFlag: '--sequence N',
      keepEveryRawFile: true,
      skipOnlyCompleteValidReceipts: true,
      neverRerollValidGateFailure: true,
      stopOnMalformedIncompleteOrMismatch: true,
      reuseCleanExpectedWorktrees: true,
      stopOnDirtyOrUnexpectedWorktrees: true,
      neverForceDeleteWorktrees: true,
      interruptionsLog: '${STAMP}-interruptions.jsonl',
      note: 'Skip only complete valid receipts matching expected tree SHA, harness/helper hashes, sequence, and measurement configuration. A valid gate-failing run stays completed and is never rerolled. Preserve malformed/incomplete/mismatched files and stop with an explanation. Reuse clean worktrees at the expected SHA; stop on dirty or unexpected trees without deleting them.'
    },
    runs: sequences,
    notes: [
      'One pinned harness against every tree. New harness hash is expected; old e02235c / e7987600 file is preserved.',
      'Finite campaign: 3 sequences, order A→B→C1→C2. Optional F is extra and is not in the 30-minute estimate.',
      '1000 passes × 200 ms = 3 min 20 s per sensor-bearing tree (B, C1, C2). Three sequences × those three trees = ~30 min of timed sensor passes, plus A ticks, warm-up, and setup — not inherently multi-hour.',
      'Acceptance never uses forced GC or --js-flags=--expose-gc. Forced GC exists only on separately labelled --diagnostics runs. GC summary fields come from actual gc() calls.',
      'Report every run absolute p95/p99 including detection, updateMs, and projectile. Campaign-level cumulative-frame verdict is required. No best-run selection. No median delta as the gate.',
      'Current Platinum evidence for 51738ca is Astra C2 3.70/9.20 and 2.00/4.30 (both failures). Historical 2.50/6.90 and supplementary 1.60/2.20 stay labeled historical.',
      'Missing or invalid runs must not yield an overall pass. Do not start this campaign until Fable authorizes it after the tagged protocol review.'
    ]
  };
}

function tickOf(receipt) {
  return receipt?.frameCPU || {};
}

function elecOf(receipt) {
  return receipt?.electronicsPass?.applicable === false ? null : receipt?.electronicsPass || null;
}

export function blockIncrements(block) {
  const A = block.A, B = block.B, C2 = block.C2;
  const tickA = tickOf(A).p95, tickB = tickOf(B).p95, tickC2 = tickOf(C2).p95;
  const elecB = elecOf(B), elecC2 = elecOf(C2);
  return {
    tickP95: {
      ewMinusSensors: rnd((tickC2 ?? NaN) - (tickB ?? NaN)),
      ewMinusPresensor: rnd((tickC2 ?? NaN) - (tickA ?? NaN)),
      cumulativeLimitMs: PROTOCOL.cumulativeFrameP95Ms,
      cumulativePassed: tickC2 != null && tickA != null ? (tickC2 - tickA) <= PROTOCOL.cumulativeFrameP95Ms : null
    },
    electronicsPassP95: {
      ewMinusSensors: elecC2 && elecB ? rnd(elecC2.p95 - elecB.p95) : null,
      ewMinusPresensor: null,
      note: 'pre-sensor electronicsPass is not applicable'
    },
    freezeComparison: block.F && elecC2 && elecOf(block.F) ? {
      note: 'same-session comparison only; freeze tag not moved; not a substitute C2',
      electronicsPassP95: {ewMinusFreeze: rnd(elecC2.p95 - elecOf(block.F).p95)},
      tickP95: {ewMinusFreeze: rnd((tickC2 ?? NaN) - (tickOf(block.F).p95 ?? NaN))}
    } : null
  };
}

function seriesP99(obj) {
  if (!obj?.applicable) return null;
  return rnd(obj.p99);
}

function seriesP95(obj) {
  if (!obj?.applicable) return null;
  return rnd(obj.p95);
}

export function summarizeCampaign(blocks, {
  expectedSequences = PROTOCOL.sequenceRepetitions,
  expectedLabels = PROTOCOL.sequenceOrder,
  invalidReceipts = []
} = {}) {
  const perRun = [];
  const electronicsP95 = [];
  const tickP95 = [];
  const missing = [];
  const bySeq = new Map((blocks || []).map(b => [b.sequence, b]));
  for (let seq = 1; seq <= expectedSequences; seq++) {
    const block = bySeq.get(seq);
    for (const label of expectedLabels) {
      if (!block?.[label]) missing.push({sequence: seq, label});
    }
  }
  for (const block of blocks || []) {
    const C2 = block.C2;
    const elec = elecOf(C2);
    const inc = blockIncrements(block);
    const run = {
      sequence: block.sequence,
      trees: Object.fromEntries(['A', 'B', 'C1', 'C2', 'F'].filter(k => block[k]).map(k => {
        const j = block[k];
        const e = elecOf(j);
        return [k, {
          commit: j.measuredTree?.commit || j.treeCommit || null,
          tickP95: rnd(tickOf(j).p95),
          tickP99: rnd(tickOf(j).p99),
          electronicsP95: e ? rnd(e.p95) : null,
          electronicsP99: e ? rnd(e.p99) : null,
          electronicsPassed: e ? e.passed : null,
          detectionP95: seriesP95(j.detectionPass),
          detectionP99: seriesP99(j.detectionPass),
          updateMsP95: seriesP95(j.updateMs),
          updateMsP99: seriesP99(j.updateMs),
          projectileP95: seriesP95(j.seekerCPU),
          projectileP99: seriesP99(j.seekerCPU)
        }];
      })),
      increments: inc,
      electronicsPassAbsolute: elec ? {p95: rnd(elec.p95), p99: rnd(elec.p99), passed: elec.passed} : null
    };
    perRun.push(run);
    if (elec?.p95 != null) electronicsP95.push(elec.p95);
    if (tickOf(C2).p95 != null) tickP95.push(tickOf(C2).p95);
  }
  const invalid = [...invalidReceipts];
  const expectedBlockCount = expectedSequences;
  const listedComplete = missing.length === 0 && (blocks || []).length >= expectedBlockCount;
  const anyElecFail = perRun.some(r => r.electronicsPassAbsolute && r.electronicsPassAbsolute.passed === false);
  const anyElecMissing = perRun.some(r => !r.electronicsPassAbsolute) || missing.some(m => m.label === 'C2');
  const anyCumulFail = perRun.some(r => r.increments.tickP95.cumulativePassed === false);
  const anyCumulMissing = perRun.some(r => r.increments.tickP95.cumulativePassed == null) || missing.some(m => m.label === 'A' || m.label === 'C2');
  const campaignElectronicsPass = {
    anyRunFailed: anyElecFail,
    allRunsPassed: listedComplete && invalid.length === 0 && !anyElecFail && !anyElecMissing && perRun.every(r => r.electronicsPassAbsolute?.passed === true),
    worstP95: electronicsP95.length ? Math.max(...electronicsP95) : null,
    worstP99: perRun.reduce((w, r) => {
      const v = r.electronicsPassAbsolute?.p99;
      return v == null ? w : Math.max(w ?? v, v);
    }, null)
  };
  const cumulValues = perRun.map(r => r.increments.tickP95.ewMinusPresensor).filter(v => v != null);
  const campaignCumulativeFrame = {
    limitMs: PROTOCOL.cumulativeFrameP95Ms,
    series: 'whole-frame tick p95 vs pre-sensor (tree A)',
    anyRunFailed: anyCumulFail,
    allRunsPassed: listedComplete && invalid.length === 0 && !anyCumulFail && !anyCumulMissing && perRun.every(r => r.increments.tickP95.cumulativePassed === true),
    worstEwMinusPresensorP95: cumulValues.length ? Math.max(...cumulValues) : null,
    perRun: perRun.map(r => ({
      sequence: r.sequence,
      ewMinusPresensor: r.increments.tickP95.ewMinusPresensor,
      passed: r.increments.tickP95.cumulativePassed
    }))
  };
  const campaignPassed = campaignElectronicsPass.allRunsPassed && campaignCumulativeFrame.allRunsPassed && missing.length === 0 && invalid.length === 0;
  return {
    protocol: PROTOCOL.id,
    gate: PROTOCOL.gate,
    reportingRules: {
      everyRunListed: true,
      bestRunSelection: false,
      medianDeltaIsNotTheGate: true,
      absoluteGate: 'electronicsPass p95<=2 and p99<=4 on each listed C2 run',
      detectionUpdateProjectileP95P99: true,
      campaignLevelCumulativeFrameVerdict: true,
      increments: ['EW−sensors', 'EW−pre-sensor'],
      variabilityReported: true,
      missingOrInvalidCannotPass: true
    },
    expectedSequences,
    expectedLabels,
    missing,
    invalidReceipts: invalid,
    perRun,
    variability: {
      electronicsPassP95: percentileStats(electronicsP95),
      tickP95: percentileStats(tickP95),
      note: 'Variability across sequence blocks. Not a substitute for the absolute 2/4 gate.'
    },
    campaignElectronicsPass,
    campaignCumulativeFrame,
    campaignPassed,
    platinumEvidence: PLATINUM_EVIDENCE,
    decisionRequired: true,
    doNotMergeToMain: true
  };
}

export function supportingHashes(repoRoot) {
  const files = [
    'scripts/ew-frame-benchmark.mjs',
    'scripts/ew-bench-lib.mjs',
    'scripts/ew-bench-report.mjs',
    'scripts/ew-campaign.sh',
    'scripts/ew-resume-check.mjs',
    'scripts/ew-bench-resume-test.mjs',
    'docs/ew/BENCHMARK-PROTOCOL.md'
  ];
  return Object.fromEntries(files.filter(f => fs.existsSync(path.join(repoRoot, f))).map(f => [f, sha256File(path.join(repoRoot, f))]));
}

function assert(cond, msg) {
  if (!cond) throw new Error(msg);
}

function fixtureReceipt({
  label = 'C2',
  sequence = 1,
  commit = PROTOCOL.trees.C2,
  harnessSha256 = 'h'.repeat(64),
  helperSha256 = 'l'.repeat(64),
  passSamples = PROTOCOL.passSamples,
  tickSamples = PROTOCOL.tickSamples,
  electronicsP95 = 1.5,
  electronicsP99 = 2.0,
  electronicsPassed = true,
  tickP95 = 1.2,
  tickP99 = 1.5,
  applicable = label !== 'A',
  extras = {}
} = {}) {
  const passes = applicable ? Array.from({length: passSamples}, (_, i) => ({i, electronicsMs: electronicsP95})) : null;
  const ticks = Array.from({length: tickSamples}, () => tickP95);
  return {
    treeLabel: label,
    sequence,
    diagnostics: false,
    profiled: false,
    starved: false,
    measuredTree: {commit, dirty: ''},
    harness: {sha256: harnessSha256, helperSha256},
    workload: {
      passWarmup: PROTOCOL.passWarmup,
      passSamples: applicable ? passSamples : 0,
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
    frameCPU: {samples: tickSamples, p95: tickP95, p99: tickP99},
    electronicsPass: applicable
      ? {applicable: true, samples: passSamples, p95: electronicsP95, p99: electronicsP99, passed: electronicsPassed}
      : {applicable: false, samples: null, p95: null, p99: null, passed: null},
    detectionPass: applicable
      ? {applicable: true, p95: electronicsP95, p99: electronicsP99}
      : {applicable: false},
    updateMs: applicable
      ? {applicable: true, p95: electronicsP95, p99: electronicsP99}
      : {applicable: false},
    seekerCPU: applicable
      ? {applicable: true, p95: 0.2, p99: 0.3}
      : {applicable: false},
    samples: {ticks: {dtMs: ticks}, passes},
    ...extras
  };
}

export function selfTest() {
  const n = 1000;
  const values = Array.from({length: n}, (_, i) => i + 1);
  const s = percentileStats(values);
  assert(s.samples === 1000, 'sample count');
  assert(s.p50 === values[Math.floor(n * 0.5)], 'p50 rank');
  assert(s.p95 === values[Math.floor(n * 0.95)], 'p95 rank');
  assert(s.p99 === values[Math.floor(n * 0.99)], 'p99 rank');
  assert(values[0] === 1 && values[n - 1] === n, 'raw order preserved');
  const short = percentileStats([1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
  assert(short.p95 === 10, 'tiny p95');
  assert(seriesGate({samples: 1000, p95: 1.6, p99: 2.2}) === true, 'pass gate');
  assert(seriesGate({samples: 1000, p95: 3.7, p99: 9.2}) === false, 'fail gate');
  assert(acceptanceEligible({
    passWarmup: 50, passSamples: 1000, tickWarmup: 600, tickSamples: 3600
  }) === true, 'eligible');
  assert(acceptanceEligible({
    passWarmup: 50, passSamples: 300, tickWarmup: 600, tickSamples: 3600
  }) === false, '300-sample helper is not the campaign');
  assert(acceptanceEligible({
    passWarmup: 50, passSamples: 1000, tickWarmup: 600, tickSamples: 3600, diagnostics: true
  }) === false, 'diagnostics ineligible');
  const finite = campaignPlan();
  assert(finite.runs.length === 12, 'finite campaign is 3 × A/B/C1/C2');
  assert(finite.duration.timedSensorPassesSec === 1800, '30 min sensor passes');
  const plan = campaignPlan({withFreeze: true, repetitions: 3});
  assert(plan.runs.length === 15, '3 sequences × 5 trees');
  assert(plan.runs[4].label === 'F' && plan.runs[4].sha === PROTOCOL.trees.F, 'freeze pin');
  const block = {
    sequence: 1,
    A: {frameCPU: {p95: 0.8, p99: 1.2}, electronicsPass: {applicable: false}},
    B: {frameCPU: {p95: 2.0, p99: 3.0}, electronicsPass: {applicable: true, p95: 2.2, p99: 8.8, passed: false}, detectionPass: {applicable: true, p95: 2.0, p99: 3.0}, updateMs: {applicable: true, p95: 2.1, p99: 3.1}, seekerCPU: {applicable: true, p95: 0.1, p99: 0.2}},
    C1: {frameCPU: {p95: 2.0, p99: 3.0}, electronicsPass: {applicable: true, p95: 2.4, p99: 5.0, passed: false}},
    C2: {frameCPU: {p95: 2.0, p99: 3.3}, electronicsPass: {applicable: true, p95: 3.7, p99: 9.2, passed: false}, detectionPass: {applicable: true, p95: 3.0, p99: 8.0}, updateMs: {applicable: true, p95: 3.0, p99: 8.1}, seekerCPU: {applicable: true, p95: 0.2, p99: 0.4}},
    F: {frameCPU: {p95: 2.1, p99: 3.4}, electronicsPass: {applicable: true, p95: 2.8, p99: 7.2, passed: false}}
  };
  const summary = summarizeCampaign([block, {
    ...block,
    sequence: 2,
    C2: {frameCPU: {p95: 2.0, p99: 3.0}, electronicsPass: {applicable: true, p95: 2.0, p99: 4.3, passed: false}, detectionPass: {applicable: true, p95: 1.8, p99: 4.0}, updateMs: {applicable: true, p95: 1.9, p99: 4.1}, seekerCPU: {applicable: true, p95: 0.2, p99: 0.3}}
  }]);
  assert(summary.perRun.length === 2, 'every run listed');
  assert(summary.reportingRules.bestRunSelection === false, 'no best-run');
  assert(summary.reportingRules.medianDeltaIsNotTheGate === true, 'no median-delta gate');
  assert(summary.campaignElectronicsPass.anyRunFailed === true, 'absolute fail kept');
  assert(summary.campaignElectronicsPass.worstP95 === 3.7, 'worst absolute p95');
  assert(summary.campaignPassed === false, 'missing sequence 3 cannot pass');
  assert(summary.missing.some(m => m.sequence === 3), 'seq 3 reported missing');
  assert(summary.perRun[0].trees.C2.detectionP99 === 8, 'detection p99');
  assert(summary.perRun[0].trees.C2.updateMsP99 === 8.1, 'updateMs p99');
  assert(summary.perRun[0].trees.C2.projectileP99 === 0.4, 'projectile p99');
  assert(summary.campaignCumulativeFrame.allRunsPassed === false, 'cumulative campaign incomplete');
  const medianDelta = (3.7 - 2.2 + 2.0 - 2.2) / 2;
  assert(medianDelta !== PROTOCOL.gate.p95Ms, 'sanity');
  assert(summary.perRun[0].increments.tickP95.ewMinusPresensor === 1.2, 'EW−pre-sensor tick');
  assert(summary.perRun[0].increments.electronicsPassP95.ewMinusSensors === 1.5, 'EW−sensors electronics');
  assert(summary.platinumEvidence.current.c2[0].p95 === 3.7, 'current Astra 3.70');
  assert(summary.platinumEvidence.historical.performanceJson.p95 === 2.5, 'historical 2.50 retained as historical');
  const argvChosen = selectRecordedArgv([
    {pid: 1, argv: ['chrome', '--type=renderer', '--flag']},
    {pid: 2, argv: ['chrome', '--disable-field-trial-config']}
  ]);
  assert(argvChosen.pid === 2 && argvChosen.selected === 'browser-process-without-type', 'prefer no --type=');
  const gcFromFlag = deriveGcSummary({
    gcFunctionPresent: true,
    calledBeforeMeasuredWindow: false,
    calledAfterMeasuredWindow: false,
    calledInsideMeasuredWindow: false
  }, {diagnostics: true, exposeGcFlag: true, gcPlacement: 'between-blocks'});
  assert(gcFromFlag.forcedGcThisRun === false, 'diagnostics flag alone is not a GC call');
  const gcFromCall = deriveGcSummary({
    gcFunctionPresent: true,
    calledBeforeMeasuredWindow: true,
    calledAfterMeasuredWindow: true,
    calledInsideMeasuredWindow: false
  }, {diagnostics: true, exposeGcFlag: true, gcPlacement: 'between-blocks'});
  assert(gcFromCall.forcedGcThisRun === true, 'actual gc() calls set forcedGcThisRun');
  const passingBlock = seq => ({
    sequence: seq,
    A: fixtureReceipt({label: 'A', sequence: seq, commit: PROTOCOL.trees.A, applicable: false, tickP95: 0.8, passSamples: 0}),
    B: fixtureReceipt({label: 'B', sequence: seq, commit: PROTOCOL.trees.B, electronicsP95: 1.2, electronicsP99: 1.8, tickP95: 1.1}),
    C1: fixtureReceipt({label: 'C1', sequence: seq, commit: PROTOCOL.trees.C1, electronicsP95: 1.3, electronicsP99: 1.9, tickP95: 1.2}),
    C2: fixtureReceipt({label: 'C2', sequence: seq, electronicsP95: 1.5, electronicsP99: 2.0, tickP95: 1.4})
  });
  const green = summarizeCampaign([passingBlock(1), passingBlock(2), passingBlock(3)]);
  assert(green.campaignPassed === true, 'complete passing campaign');
  assert(green.campaignCumulativeFrame.allRunsPassed === true, 'cumulative campaign pass');
  const redElec = passingBlock(2);
  redElec.C2 = fixtureReceipt({label: 'C2', sequence: 2, electronicsP95: 3.7, electronicsP99: 9.2, electronicsPassed: false, tickP95: 1.4});
  const red = summarizeCampaign([passingBlock(1), redElec, passingBlock(3)]);
  assert(red.campaignPassed === false, 'gate-failing run fails campaign');
  assert(red.campaignElectronicsPass.anyRunFailed === true, 'gate fail recorded');
  const redCumul = passingBlock(2);
  redCumul.C2 = fixtureReceipt({label: 'C2', sequence: 2, electronicsP95: 1.5, electronicsP99: 2.0, tickP95: 3.5});
  const cumul = summarizeCampaign([passingBlock(1), redCumul, passingBlock(3)]);
  assert(cumul.campaignPassed === false, 'cumulative fail fails campaign');
  assert(cumul.campaignCumulativeFrame.anyRunFailed === true, 'cumulative fail recorded');
  const invalid = summarizeCampaign([passingBlock(1), passingBlock(2), passingBlock(3)], {
    invalidReceipts: [{file: 'x', status: 'malformed'}]
  });
  assert(invalid.campaignPassed === false, 'invalid receipts cannot pass');
  return {ok: true, checks: 40};
}

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  const result = selfTest();
  console.log(JSON.stringify(result, null, 2));
}
