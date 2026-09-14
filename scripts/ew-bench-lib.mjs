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
  status: 'awaiting Fable protocol review — long campaign not started',
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
  sourceFiles: ['src/main.js', 'src/ship-sensors.mjs', 'src/ship-ew.mjs', 'src/ship-hoj.mjs'],
  percentileMethod: 'nearest-rank floor(n * p) on a sorted copy',
  order: 'updateProjectiles(1) → updatePowerSystems(12) → updateSensorSystems(12)'
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

export function campaignPlan({withFreeze = true, repetitions = PROTOCOL.sequenceRepetitions} = {}) {
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
    runs: sequences,
    notes: [
      'One pinned harness against every tree.',
      'Serial interleaved sequences; one browser process per run; process exit between runs.',
      'Run one sequence at a time (--sequence N). Keep every raw seq*-*.json file.',
      '1000 passes at 200 ms cadence ≈ 3+ minutes per run; four/five trees × several sequences is multi-hour.',
      'Acceptance: naturally occurring GC only. No expose-gc. gc() is never called.',
      'Diagnostics hygiene: --diagnostics --gc-placement=between-blocks (default for --diagnostics). expose-gc; gc() outside the measured window.',
      'Diagnostics suppression: --diagnostics --gc-placement=inside-window. expose-gc; gc() between measured samples. Not the gate.',
      'Report every run absolute p95/p99. No best-run selection. No median delta as the gate.',
      'Do not start this campaign until Fable approves the protocol.'
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

export function summarizeCampaign(blocks) {
  const perRun = [];
  const electronicsP95 = [];
  const tickP95 = [];
  for (const block of blocks) {
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
          detectionP95: j.detectionPass?.applicable ? rnd(j.detectionPass.p95) : null,
          updateMsP95: j.updateMs?.applicable ? rnd(j.updateMs.p95) : null,
          projectileP95: j.seekerCPU?.applicable ? rnd(j.seekerCPU.p95) : null
        }];
      })),
      increments: inc,
      electronicsPassAbsolute: elec ? {p95: rnd(elec.p95), p99: rnd(elec.p99), passed: elec.passed} : null
    };
    perRun.push(run);
    if (elec?.p95 != null) electronicsP95.push(elec.p95);
    if (tickOf(C2).p95 != null) tickP95.push(tickOf(C2).p95);
  }
  const anyFail = perRun.some(r => r.electronicsPassAbsolute && r.electronicsPassAbsolute.passed === false);
  const anyUnpassed = perRun.some(r => r.electronicsPassAbsolute && r.electronicsPassAbsolute.passed !== true);
  return {
    protocol: PROTOCOL.id,
    gate: PROTOCOL.gate,
    reportingRules: {
      everyRunListed: true,
      bestRunSelection: false,
      medianDeltaIsNotTheGate: true,
      absoluteGate: 'electronicsPass p95<=2 and p99<=4 on each listed C2 run',
      increments: ['EW−sensors', 'EW−pre-sensor'],
      variabilityReported: true
    },
    perRun,
    variability: {
      electronicsPassP95: percentileStats(electronicsP95),
      tickP95: percentileStats(tickP95),
      note: 'Variability across sequence blocks. Not a substitute for the absolute 2/4 gate.'
    },
    campaignElectronicsPass: {
      anyRunFailed: anyFail,
      allRunsPassed: !anyUnpassed && perRun.every(r => r.electronicsPassAbsolute),
      worstP95: electronicsP95.length ? Math.max(...electronicsP95) : null,
      worstP99: perRun.reduce((w, r) => {
        const v = r.electronicsPassAbsolute?.p99;
        return v == null ? w : Math.max(w ?? v, v);
      }, null)
    },
    platinumAuthority: {p95: 2.5, p99: 6.9, passed: false, series: 'same electronicsPass / Platinum detectionPass timer'},
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
    'docs/ew/BENCHMARK-PROTOCOL.md'
  ];
  return Object.fromEntries(files.filter(f => fs.existsSync(path.join(repoRoot, f))).map(f => [f, sha256File(path.join(repoRoot, f))]));
}

function assert(cond, msg) {
  if (!cond) throw new Error(msg);
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
  const plan = campaignPlan({withFreeze: true, repetitions: 3});
  assert(plan.runs.length === 15, '3 sequences × 5 trees');
  assert(plan.runs[4].label === 'F' && plan.runs[4].sha === PROTOCOL.trees.F, 'freeze pin');
  const block = {
    sequence: 1,
    A: {frameCPU: {p95: 0.8, p99: 1.2}, electronicsPass: {applicable: false}},
    B: {frameCPU: {p95: 2.0, p99: 3.0}, electronicsPass: {applicable: true, p95: 2.2, p99: 8.8, passed: false}, detectionPass: {applicable: true, p95: 2.0}, seekerCPU: {applicable: true, p95: 0.1}},
    C1: {frameCPU: {p95: 2.0, p99: 3.0}, electronicsPass: {applicable: true, p95: 2.4, p99: 5.0, passed: false}},
    C2: {frameCPU: {p95: 2.0, p99: 3.3}, electronicsPass: {applicable: true, p95: 3.7, p99: 9.2, passed: false}, detectionPass: {applicable: true, p95: 3.0}, updateMs: {applicable: true, p95: 3.0}, seekerCPU: {applicable: true, p95: 0.2}},
    F: {frameCPU: {p95: 2.1, p99: 3.4}, electronicsPass: {applicable: true, p95: 2.8, p99: 7.2, passed: false}}
  };
  const summary = summarizeCampaign([block, {
    ...block,
    sequence: 2,
    C2: {frameCPU: {p95: 2.0, p99: 3.0}, electronicsPass: {applicable: true, p95: 2.0, p99: 4.3, passed: false}}
  }]);
  assert(summary.perRun.length === 2, 'every run listed');
  assert(summary.reportingRules.bestRunSelection === false, 'no best-run');
  assert(summary.reportingRules.medianDeltaIsNotTheGate === true, 'no median-delta gate');
  assert(summary.campaignElectronicsPass.anyRunFailed === true, 'absolute fail kept');
  assert(summary.campaignElectronicsPass.worstP95 === 3.7, 'worst absolute p95');
  const medianDelta = (3.7 - 2.2 + 2.0 - 2.2) / 2;
  assert(medianDelta !== PROTOCOL.gate.p95Ms, 'sanity');
  assert(summary.perRun[0].increments.tickP95.ewMinusPresensor === 1.2, 'EW−pre-sensor tick');
  assert(summary.perRun[0].increments.electronicsPassP95.ewMinusSensors === 1.5, 'EW−sensors electronics');
  return {ok: true, checks: 18};
}

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  const result = selfTest();
  console.log(JSON.stringify(result, null, 2));
}
