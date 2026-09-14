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
  status: 'awaiting independent protocol review — long campaign not started',
  protocolTag: 'ew-fable-protocol-20260914-r5',
  previousProtocolTag: {
    name: 'ew-fable-protocol-20260914-r4',
    commit: '70f47cc96bf37f6df3625a1bcc00f089dfccbb1e',
    note: 'prior reporting/validation freeze; do not move'
  },
  historicalProtocolTag: {
    name: 'ew-fable-protocol-20260914',
    commit: 'e556a3801848d85062ccecc1dcfec4d8c56620fd',
    note: 'historical; do not move'
  },
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
  pinned: {
    A: {
      commit: '6958f08e73aff55efbf48bae3f9433e5acc270e8',
      tree: 'eed3e2271afc88f54eebfa3f129f1fb8b7a85b99',
      sources: {'src/main.js': '47fd75c8ba9820c23b73c2e1c1c6047a3ef810cbccf955ee498e212e13bfc9fc'}
    },
    B: {
      commit: 'e7aa3c594e4799c54d48e2eeac37a2a1acf36b9b',
      tree: 'bddf1e43788bebdf78ed3ea8136dd0faad397db6',
      sources: {
        'src/main.js': '966c183e4911c385a61625d856321b6c81e2290f6bbc9075689537b1cb48054c',
        'src/ship-sensors.mjs': '53c43a6ff00ec8f23e9bd83eec3aad4e017a89017f8102398d50088130dc212c'
      }
    },
    C1: {
      commit: '74caf837c7882a86e3bd7c74f083029453953c1a',
      tree: '632ecefe45d03a97fa86872c099f7ab6be70c501',
      sources: {
        'src/main.js': '5ba906285ac27503f17ec6ef23cda90f2e1ed1dc6bd94bf92c010adb42ab1be3',
        'src/ship-sensors.mjs': '2011305d0cd5f32d634aa13cc766aaacbfa28ecd06546fe0cc37a19b452714c6',
        'src/ship-ew.mjs': '77b6f145d98f99964b497093c1a5dc75f28cb066298d57eea77ed1c7a0d2e75c'
      }
    },
    C2: {
      commit: '51738caf3a1d88492c4fc48a7c0125d4a7e2a355',
      tree: '8d71d88fc97d36556965a5a59c35ca1766ab7ffb',
      sources: {
        'src/main.js': 'f1e8d9c0c85825ee8248f943bff4c2a777fa466a5a970950cf147c8b1f1e535f',
        'src/ship-sensors.mjs': '457f0ef9bea951bd50810b5cc450466c54fa850430ea2b8e8b2e3ec82e3d6f2f',
        'src/ship-ew.mjs': '4f16df1f128dd9fffb607a8024f64827a0cb640ba648fc9c709067520afd1d17',
        'src/ship-hoj.mjs': '7d46cdfe0dcab3be056ca64e578c24094e95f7956bb8ae1eb64c8b275c40df5e'
      }
    },
    F: {
      commit: '077a9cedaa5a6cb858b200addb115d862ab238e6',
      tree: '6f22de07e0339b7ba078d0e0b68d9cc20658f199',
      sources: {
        'src/main.js': 'f1e8d9c0c85825ee8248f943bff4c2a777fa466a5a970950cf147c8b1f1e535f',
        'src/ship-sensors.mjs': 'fe4b4de0e27c515fa9b6c3f73675925e3a35eb7607f0dda1bc80ff6d800aafa4',
        'src/ship-ew.mjs': '4f16df1f128dd9fffb607a8024f64827a0cb640ba648fc9c709067520afd1d17',
        'src/ship-hoj.mjs': '7d46cdfe0dcab3be056ca64e578c24094e95f7956bb8ae1eb64c8b275c40df5e'
      }
    }
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

export function rankedSeries(n, p95, p99) {
  const i95 = Math.min(n - 1, Math.floor(n * 0.95));
  const i99 = Math.min(n - 1, Math.floor(n * 0.99));
  const floor = Math.min(p95, 1);
  return Array.from({length: n}, (_, i) => (i >= i99 ? p99 : i >= i95 ? p95 : floor));
}

export function pinnedIdentity(labelOrCommit) {
  if (PROTOCOL.pinned[labelOrCommit]) return PROTOCOL.pinned[labelOrCommit];
  return Object.values(PROTOCOL.pinned).find(p => p.commit === labelOrCommit) || null;
}

export function argvExposesGc(argv) {
  return (argv || []).some(a => {
    const s = String(a);
    if (s === '--expose-gc') return true;
    const m = s.match(/^--js-flags=(.*)$/);
    if (!m) return false;
    return m[1].split(',').map(x => x.trim()).includes('--expose-gc');
  });
}

export function derivedExposeGc(j) {
  const argv = j?.launch?.recordedArgv?.argv;
  return argvExposesGc(argv)
    || j?.launch?.exposeGcFlag === true
    || j?.gc?.exposeGcFlag === true
    || j?.gc?.gcFunctionPresent === true;
}

export function approvedRunMatrix(config = approvedCampaignConfig()) {
  const runs = [];
  for (let seq = 1; seq <= config.repetitions; seq++) {
    for (const label of config.sequenceOrder) {
      runs.push({sequence: seq, label, sha: config.trees[label]});
    }
  }
  return runs;
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

export function browserExecutableKind(cmd0) {
  const base = String(cmd0 || '').split(/[/\\]/).pop() || '';
  const name = base.replace(/\.(exe|sh)$/i, '');
  if (/^headless_shell$/i.test(name) || /^chrome-headless-shell$/i.test(name)) return 'headless_shell';
  if (/^chromium/i.test(name)) return 'chromium';
  if (/^google-chrome/i.test(name) || /^chrome$/i.test(name)) return 'chrome';
  return null;
}

export function isBrowserExecutable(cmd0) {
  return browserExecutableKind(cmd0) != null;
}

export function readProcCmdline(pid) {
  try {
    const cmd = fs.readFileSync(`/proc/${pid}/cmdline`, 'utf8').split('\0').filter(Boolean);
    return cmd.length ? cmd : null;
  } catch {
    return null;
  }
}

export function readProcPpid(pid) {
  try {
    const st = fs.readFileSync(`/proc/${pid}/stat`, 'utf8');
    const close = st.lastIndexOf(')');
    if (close < 0) return null;
    const rest = st.slice(close + 2).trim().split(/\s+/);
    const ppid = Number(rest[1]);
    return Number.isInteger(ppid) ? ppid : null;
  } catch {
    return null;
  }
}

export function processOwnedBy(pid, ownerPid, parentOf = readProcPpid) {
  const owner = Number(ownerPid);
  let cur = Number(pid);
  const seen = new Set();
  while (Number.isInteger(cur) && cur > 0 && !seen.has(cur)) {
    if (cur === owner) return true;
    seen.add(cur);
    const parent = parentOf(cur);
    if (parent == null) return false;
    cur = Number(parent);
  }
  return false;
}

export function collectProcBrowserCandidates({ownerPid = null, parentOf = readProcPpid} = {}) {
  const found = [];
  try {
    for (const pid of fs.readdirSync('/proc')) {
      if (!/^\d+$/.test(pid)) continue;
      const argv = readProcCmdline(pid);
      if (!argv) continue;
      if (isBrowserExecutable(argv[0])) {
        found.push({
          pid: Number(pid),
          argv,
          kind: browserExecutableKind(argv[0]),
          ppid: parentOf(Number(pid))
        });
      }
    }
  } catch { /* no /proc */ }
  if (ownerPid == null) return found;
  return found.filter(c => processOwnedBy(c.pid, ownerPid, parentOf));
}

// Prefer the Playwright-launched PID if it is owned by this harness.
// Never use /chrome/i on the full path (misses /chromium and can match
// unrelated processes). extraArgs are not proof of preload-injected flags;
// unverified launch is not acceptance.
export function selectRecordedArgv(candidates, {preferPid = null, ownerPid = null, parentOf = readProcPpid} = {}) {
  let list = candidates || [];
  if (ownerPid != null) {
    list = list.filter(c => processOwnedBy(c.pid, ownerPid, parentOf));
  }
  if (preferPid != null) {
    if (ownerPid != null && Number(preferPid) !== Number(ownerPid) && !processOwnedBy(preferPid, ownerPid, parentOf)) {
      return {
        pid: Number(preferPid),
        selected: 'playwright-pid-unverified',
        verified: false,
        candidateCount: list.length,
        reason: 'Playwright pid is not owned by this harness process'
      };
    }
    const hit = list.find(c => Number(c.pid) === Number(preferPid));
    if (hit && isBrowserExecutable(hit.argv?.[0]) && !(hit.argv || []).some(a => String(a).startsWith('--type='))) {
      return {
        ...hit,
        selected: 'playwright-browser-process',
        verified: true,
        candidateCount: list.length
      };
    }
    const argv = readProcCmdline(preferPid);
    if (argv && isBrowserExecutable(argv[0]) && !argv.some(a => String(a).startsWith('--type='))) {
      return {
        pid: Number(preferPid),
        argv,
        kind: browserExecutableKind(argv[0]),
        selected: 'playwright-browser-process',
        verified: true,
        candidateCount: list.length
      };
    }
    return {
      pid: Number(preferPid),
      argv: argv || hit?.argv || null,
      selected: 'playwright-pid-unverified',
      verified: false,
      candidateCount: list.length,
      reason: 'Playwright pid was not a browser process without --type='
    };
  }
  const browsers = list.filter(c => isBrowserExecutable(c.argv?.[0]));
  const withoutType = browsers.filter(c => !(c.argv || []).some(a => String(a).startsWith('--type=')));
  if (withoutType.length === 1) {
    return {
      ...withoutType[0],
      selected: 'browser-process-without-type',
      verified: true,
      candidateCount: list.length
    };
  }
  if (withoutType.length > 1) {
    return {
      selected: 'ambiguous-multiple-browser-processes',
      verified: false,
      candidateCount: withoutType.length,
      pids: withoutType.map(c => c.pid),
      reason: 'multiple browser processes without --type=; refusing to pick an unrelated argv'
    };
  }
  return {
    selected: 'unverified',
    verified: false,
    candidateCount: list.length,
    reason: 'no browser process without --type= (chrome/chromium/headless_shell)'
  };
}

export function preloadInjectedFlags(recorded, extraArgs = []) {
  if (!recorded?.verified || !Array.isArray(recorded.argv)) return [];
  const extra = new Set(extraArgs || []);
  return recorded.argv.filter(a => typeof a === 'string' && a.startsWith('--') && !extra.has(a));
}

export function approvedCampaignConfig() {
  return {
    trees: {...PROTOCOL.trees},
    withFreeze: false,
    repetitions: PROTOCOL.sequenceRepetitions,
    sequenceOrder: [...PROTOCOL.sequenceOrder],
    passWarmup: PROTOCOL.passWarmup,
    passSamples: PROTOCOL.passSamples,
    tickWarmup: PROTOCOL.tickWarmup,
    tickSamples: PROTOCOL.tickSamples,
    passCadenceMs: PROTOCOL.passCadenceMs,
    renderSamples: PROTOCOL.renderSamples
  };
}

export function campaignConfigFromEnv(env = process.env) {
  const approved = approvedCampaignConfig();
  const num = (key, fallback) => {
    if (env[key] == null || env[key] === '') return fallback;
    const n = Number(env[key]);
    return Number.isFinite(n) ? n : fallback;
  };
  const requested = {
    trees: {
      A: env.TREE_A || approved.trees.A,
      B: env.TREE_B || approved.trees.B,
      C1: env.TREE_C1 || approved.trees.C1,
      C2: env.TREE_C2 || approved.trees.C2,
      F: env.TREE_F || approved.trees.F
    },
    withFreeze: env.WITH_FREEZE != null && env.WITH_FREEZE !== '' && env.WITH_FREEZE !== '0',
    repetitions: num('EW_CAMPAIGN_REPS', approved.repetitions),
    sequenceOrder: [...approved.sequenceOrder],
    passWarmup: num('EW_PASS_WARMUP', approved.passWarmup),
    passSamples: num('EW_PASS_SAMPLES', approved.passSamples),
    tickWarmup: num('EW_TICK_WARMUP', approved.tickWarmup),
    tickSamples: num('EW_TICK_SAMPLES', approved.tickSamples),
    passCadenceMs: approved.passCadenceMs,
    renderSamples: approved.renderSamples
  };
  const drifts = [];
  for (const k of ['A', 'B', 'C1', 'C2']) {
    if (requested.trees[k] !== approved.trees[k]) drifts.push(`trees.${k}`);
  }
  if (requested.withFreeze !== approved.withFreeze) drifts.push('withFreeze');
  if (requested.repetitions !== approved.repetitions) drifts.push('repetitions');
  if (requested.passWarmup !== approved.passWarmup) drifts.push('passWarmup');
  if (requested.passSamples !== approved.passSamples) drifts.push('passSamples');
  if (requested.tickWarmup !== approved.tickWarmup) drifts.push('tickWarmup');
  if (requested.tickSamples !== approved.tickSamples) drifts.push('tickSamples');
  return {
    requested,
    approved,
    drifts,
    acceptance: drifts.length === 0
  };
}

export function campaignPlan(config = {}) {
  const approved = approvedCampaignConfig();
  const cfg = {
    ...approved,
    ...config,
    trees: config.trees ? {...config.trees} : {...approved.trees},
    sequenceOrder: config.sequenceOrder ? [...config.sequenceOrder] : [...approved.sequenceOrder]
  };
  const order = cfg.withFreeze ? [...cfg.sequenceOrder, PROTOCOL.optionalFifthPin] : [...cfg.sequenceOrder];
  const sequences = [];
  for (let seq = 1; seq <= cfg.repetitions; seq++) {
    for (const label of order) {
      sequences.push({
        sequence: seq,
        label,
        sha: cfg.trees[label],
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
    previousProtocolTag: PROTOCOL.previousProtocolTag,
    historicalProtocolTag: PROTOCOL.historicalProtocolTag,
    gate: PROTOCOL.gate,
    cumulativeFrameP95Ms: PROTOCOL.cumulativeFrameP95Ms,
    trees: {...cfg.trees},
    freezeTag: PROTOCOL.freezeTag,
    freezeMoved: false,
    withFreeze: !!cfg.withFreeze,
    sequenceOrder: order,
    repetitions: cfg.repetitions,
    warmup: {passWarmup: cfg.passWarmup, tickWarmup: cfg.tickWarmup, passCadenceMs: cfg.passCadenceMs},
    measured: {passSamples: cfg.passSamples, tickSamples: cfg.tickSamples, renderSamples: cfg.renderSamples},
    previousHarness: PROTOCOL.previousHarness,
    duration: PROTOCOL.duration,
    percentile: PROTOCOL.percentile,
    timer: PROTOCOL.timer,
    preloadInjectedFlags: PROTOCOL.preloadInjectedFlags,
    platinumEvidence: PLATINUM_EVIDENCE,
    acceptanceOverridesRejected: true,
    resume: {
      oneSequenceFlag: '--sequence N',
      keepEveryRawFile: true,
      skipOnlyCompleteValidReceipts: true,
      neverRerollValidGateFailure: true,
      stopOnMalformedIncompleteOrMismatch: true,
      reuseCleanExpectedWorktrees: true,
      stopOnDirtyOrUnexpectedWorktrees: true,
      neverForceDeleteWorktrees: true,
      validatePlanBeforeOverwrite: true,
      interruptionsLog: '${STAMP}-interruptions.jsonl',
      note: 'Skip only complete valid receipts matching expected tree SHA, harness/helper hashes, sequence, and measurement configuration. A valid gate-failing run stays completed and is never rerolled. Preserve malformed/incomplete/mismatched files and stop with an explanation. Reuse clean worktrees at the expected SHA; stop on dirty or unexpected trees without deleting them. Validate an existing plan before writing a new one on resume.'
    },
    runs: sequences,
    notes: [
      'One pinned harness against every tree. New harness hash is expected; old e02235c / e7987600 file is preserved.',
      'Finite campaign: 3 sequences, order A→B→C1→C2. Optional F is extra and is not in the 30-minute estimate.',
      '1000 passes × 200 ms = 3 min 20 s per sensor-bearing tree (B, C1, C2). Three sequences × those three trees = ~30 min of timed sensor passes, plus A ticks, warm-up, and setup — not inherently multi-hour.',
      'Acceptance never uses forced GC or --js-flags=--expose-gc. Forced GC exists only on separately labelled --diagnostics runs. GC summary fields come from actual gc() calls.',
      'Report every run absolute p95/p99 including detection, updateMs, and projectile. Campaign-level cumulative-frame verdict is required. No best-run selection. No median delta as the gate.',
      'Current Platinum evidence for 51738ca is Astra C2 3.70/9.20 and 2.00/4.30 (both failures). Historical 2.50/6.90 and supplementary 1.60/2.20 stay labeled historical.',
      'Missing or invalid runs must not yield an overall pass. Plan trees and runs come from one validated configuration. Non-approved acceptance overrides are rejected.',
      'Do not start this campaign until the tagged protocol is authorized. Historical tag ew-fable-protocol-20260914 stays at e556a380. Prior freezes r2@6d4c01d r3@c0b42b0 r4@70f47cc stay put. None of those tags are moved.'
    ]
  };
}

export function validatePlan(plan, {
  harnessSha256,
  helperSha256,
  config = approvedCampaignConfig()
} = {}) {
  const problems = [];
  if (!plan || typeof plan !== 'object') return {ok: false, problems: ['plan is not an object']};
  for (const k of ['A', 'B', 'C1', 'C2']) {
    if (plan.trees?.[k] !== config.trees[k]) problems.push(`trees.${k} is not the approved SHA`);
  }
  const expectedOrder = config.sequenceOrder;
  if (!Array.isArray(plan.sequenceOrder) || plan.sequenceOrder.join(',') !== expectedOrder.join(',')) {
    problems.push('sequenceOrder is not the approved A,B,C1,C2 matrix');
  }
  const expectedRuns = approvedRunMatrix(config);
  if (!Array.isArray(plan.runs) || plan.runs.length !== expectedRuns.length) {
    problems.push('runs length does not match approved 3 × A/B/C1/C2');
  } else {
    expectedRuns.forEach((exp, i) => {
      const run = plan.runs[i];
      if (!run || run.sequence !== exp.sequence || run.label !== exp.label || run.sha !== exp.sha) {
        problems.push(`runs[${i}] is not ${exp.label} seq ${exp.sequence} ${exp.sha}`);
      }
    });
  }
  if (plan.gate?.series !== PROTOCOL.gate.series || plan.gate?.p95Ms !== PROTOCOL.gate.p95Ms || plan.gate?.p99Ms !== PROTOCOL.gate.p99Ms) {
    problems.push('gate fields are not the approved electronicsPass 2/4');
  }
  if (plan.gate?.thresholdsRecalibrated === true) problems.push('thresholdsRecalibrated is not false');
  if (plan.cumulativeFrameP95Ms !== PROTOCOL.cumulativeFrameP95Ms) {
    problems.push('cumulativeFrameP95Ms is not the approved 2 ms limit');
  }
  if (plan.warmup?.passWarmup !== config.passWarmup) problems.push('warmup.passWarmup drift');
  if (plan.warmup?.tickWarmup !== config.tickWarmup) problems.push('warmup.tickWarmup drift');
  if (plan.warmup?.passCadenceMs !== config.passCadenceMs) problems.push('warmup.passCadenceMs drift');
  if (plan.measured?.passSamples !== config.passSamples) problems.push('measured.passSamples drift');
  if (plan.measured?.tickSamples !== config.tickSamples) problems.push('measured.tickSamples drift');
  if (plan.withFreeze) problems.push('withFreeze is not acceptance');
  if (plan.repetitions !== config.repetitions) problems.push('repetitions drift');
  if (!plan.harness?.sha256) problems.push('missing plan harness sha256');
  if (!plan.harness?.helperSha256 && !plan.harness?.libSha256) problems.push('missing plan helper sha256');
  if (harnessSha256 && plan.harness?.sha256 && plan.harness.sha256 !== harnessSha256) {
    problems.push('plan harness sha256 mismatch');
  }
  if (helperSha256 && plan.harness?.helperSha256 && plan.harness.helperSha256 !== helperSha256) {
    problems.push('plan helper sha256 mismatch');
  }
  if (helperSha256 && plan.harness?.libSha256 && plan.harness.libSha256 !== helperSha256) {
    problems.push('plan lib sha256 mismatch');
  }
  return {ok: problems.length === 0, problems};
}

export function recomputeReceiptSeries(j) {
  const passes = asArray(j?.samples?.passes) || [];
  const ticks = asArray(j?.samples?.ticks?.dtMs) || [];
  const electronics = percentileStats(passes.map(p => p.electronicsMs).filter(Number.isFinite));
  const detection = percentileStats(passes.map(p => p.detectionMs).filter(Number.isFinite));
  const updateMs = percentileStats(passes.map(p => p.updateMs).filter(Number.isFinite));
  const projectile = percentileStats(passes.map(p => p.projectileMs).filter(Number.isFinite));
  const tick = percentileStats(ticks.filter(Number.isFinite));
  const applicable = j?.electronicsPass?.applicable === true;
  const gatePassed = applicable ? seriesGate(electronics) : null;
  return {electronics, detection, updateMs, projectile, tick, gatePassed};
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
    extraArgs: [],
    sensorApplicable: label !== 'A',
    treeObject: PROTOCOL.pinned[label]?.tree,
    sources: PROTOCOL.pinned[label]?.sources
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
  const pin = pinnedIdentity(label) || pinnedIdentity(j.measuredTree?.commit);
  if (j.measuredTree?.dirty) problems.push('measured tree is dirty');
  if (!j.measuredTree || typeof j.measuredTree.tree !== 'string' || !j.measuredTree.tree) {
    problems.push('missing measuredTree.tree');
  }
  if (j.acceptanceEligible !== true) problems.push('acceptanceEligible must be true');
  if (!Array.isArray(j.errors)) problems.push('missing errors array');
  else if (j.errors.length) problems.push('receipt errors are not empty');
  if (!j.sources || typeof j.sources !== 'object') problems.push('missing sources manifest');
  else if (pin) {
    for (const file of Object.keys(pin.sources)) {
      if (typeof j.sources[file] !== 'string' || !j.sources[file]) {
        problems.push(`sources.${file} missing`);
      }
    }
  }
  if (j.launch?.verified !== true) problems.push('launch.verified must be true');
  const rec = j.launch?.recordedArgv;
  if (!rec || rec.verified !== true) problems.push('missing verified launch.recordedArgv');
  if (!Array.isArray(rec?.argv) || !rec.argv.length) problems.push('missing recordedArgv.argv');
  if (derivedExposeGc(j)) problems.push('exposed GC is not acceptance');
  if (typeof j.gc?.gcFunctionPresent !== 'boolean') problems.push('missing gc.gcFunctionPresent');
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
  else {
    if (Number.isInteger(frameSamples) && tickDt.length !== frameSamples) {
      problems.push(`tick sample count ${tickDt.length} != frameCPU.samples ${frameSamples}`);
    }
    if (tickDt.some(x => !Number.isFinite(x))) {
      problems.push('samples.ticks.dtMs is not a complete finite array');
    }
    if (Number.isInteger(expected.tickSamples) && tickDt.length !== expected.tickSamples) {
      problems.push(`tick sample count ${tickDt.length} != expected ${expected.tickSamples}`);
    }
    const tickAt = asArray(j.samples?.ticks?.tRelMs);
    if (!tickAt) problems.push('missing samples.ticks.tRelMs');
    else if (tickAt.length !== tickDt.length) {
      problems.push('samples.ticks.tRelMs length != dtMs');
    } else if (tickAt.some(x => !Number.isFinite(x))) {
      problems.push('samples.ticks.tRelMs is not a complete finite array');
    }
  }
  const sensorTree = (label && label !== 'A') || expected.sensorApplicable === true;
  const preSensor = label === 'A' || expected.sensorApplicable === false;
  if (sensorTree && !preSensor) {
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
      } else if (passes.some(p => !p || !Number.isFinite(p.electronicsMs))) {
        problems.push('samples.passes is not a complete finite electronicsMs array');
      } else if (passes.some(p => !Number.isInteger(p.i)
        || !Number.isFinite(p.tEpochMs)
        || !Number.isFinite(p.tRelMs)
        || !Number.isFinite(p.detectionMs)
        || !Number.isFinite(p.updateMs)
        || !Number.isFinite(p.projectileMs))) {
        problems.push('samples.passes missing complete per-sample timing fields');
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
  } else if (preSensor) {
    if (j.electronicsPass?.applicable !== false) problems.push('pre-sensor electronicsPass must be not applicable');
    if (j.electronicsPass && j.electronicsPass.samples != null) {
      problems.push('pre-sensor electronicsPass.samples must be null');
    }
    if (asArray(j.samples?.passes)) problems.push('pre-sensor samples.passes must be null');
    for (const key of ['detectionPass', 'updateMs', 'seekerCPU']) {
      const obj = j[key];
      if (!obj) problems.push(`missing ${key}`);
      else if (obj.applicable !== false) problems.push(`pre-sensor ${key} must be not applicable`);
    }
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
  const label = expected.label || j.treeLabel;
  const pin = pinnedIdentity(label) || pinnedIdentity(expected.treeSha) || pinnedIdentity(j.measuredTree?.commit);
  const commit = j.measuredTree?.commit;
  if (expected.treeSha && commit !== expected.treeSha) {
    problems.push(`tree SHA ${commit} != expected ${expected.treeSha}`);
  }
  const treeObject = expected.treeObject || pin?.tree;
  if (treeObject && j.measuredTree?.tree && j.measuredTree.tree !== treeObject) {
    problems.push(`measuredTree.tree != pinned tree ${treeObject}`);
  }
  const sources = expected.sources || pin?.sources;
  if (sources && j.sources) {
    for (const [file, hash] of Object.entries(sources)) {
      if (j.sources[file] && j.sources[file] !== hash) problems.push(`sources.${file} does not match pinned tree`);
    }
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
  if (j.launch?.exposeGcFlag === true || derivedExposeGc(j)) {
    problems.push('exposeGcFlag is true; acceptance forbids --js-flags=--expose-gc');
  }
  if (j.gc?.forcedGcThisRun === true) {
    problems.push('forcedGcThisRun is true; acceptance never calls gc()');
  }
  if (j.gc?.gcFunctionPresent === true) {
    problems.push('gcFunctionPresent is true; acceptance forbids exposed GC');
  }
  return problems;
}

export function validateReceipt(j, expected = {}) {
  if (!j || typeof j !== 'object' || Array.isArray(j)) {
    return {ok: false, action: 'stop', status: 'malformed', reason: 'receipt is not a JSON object'};
  }
  const incomplete = completenessProblems(j, expected);
  if (incomplete.length) {
    return {
      ok: false,
      action: 'stop',
      status: 'incomplete',
      reason: incomplete.join('; '),
      problems: incomplete
    };
  }
  const mismatches = mismatchProblems(j, expected);
  if (mismatches.length) {
    return {
      ok: false,
      action: 'stop',
      status: 'mismatch',
      reason: mismatches.join('; '),
      problems: mismatches
    };
  }
  const ineligible = ineligibleReasons(j, expected);
  if (ineligible.length) {
    return {
      ok: false,
      action: 'stop',
      status: 'mismatch',
      reason: ineligible.join('; '),
      problems: ineligible
    };
  }
  const recomputed = recomputeReceiptSeries(j);
  const sampleProblems = sampleVerificationProblems(j, expected, recomputed);
  if (sampleProblems.length) {
    return {
      ok: false,
      action: 'stop',
      status: sampleProblems.some(p => p.startsWith('stale')) ? 'mismatch' : 'incomplete',
      reason: sampleProblems.join('; '),
      problems: sampleProblems
    };
  }
  const elec = j.electronicsPass;
  const electronicsPassed = elec?.applicable === false ? null : recomputed.gatePassed === true;
  return {
    ok: true,
    action: 'skip',
    status: 'complete-valid',
    gatePassed: electronicsPassed,
    electronicsPassed,
    recomputedGatePassed: recomputed.gatePassed,
    note: electronicsPassed === false
      ? 'valid gate-failing run stays completed and is never rerolled'
      : 'complete valid receipt matching expected tree, hashes, sequence, and measurement configuration'
  };
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
  return {...validateReceipt(j, expected), file};
}

export function ineligibleReasons(j, expected = {}) {
  const problems = [];
  if (j.diagnostics === true || j.gc?.diagnostics === true) problems.push('diagnostics receipt is not acceptance');
  if (j.acceptanceEligible !== true) problems.push('acceptanceEligible is not true');
  if (j.profiled === true || j.harness?.profiled === true) problems.push('profiled receipt is not acceptance');
  if (j.starved === true) problems.push('starved receipt is not acceptance');
  if (j.gc?.calledInsideMeasuredWindow === true || j.gc?.calledBeforeMeasuredWindow === true || j.gc?.calledAfterMeasuredWindow === true) {
    problems.push('forced GC call flags are set; acceptance never calls gc()');
  }
  if (j.gc?.forcedGcThisRun === true) problems.push('forcedGcThisRun is true');
  if (!Array.isArray(j.errors) || j.errors.length) problems.push('receipt errors are missing or not empty');
  if (j.measuredTree?.dirty) problems.push('measured tree is dirty');
  const launchVerified = j.launch?.verified === true && j.launch?.recordedArgv?.verified === true
    && Array.isArray(j.launch?.recordedArgv?.argv) && j.launch.recordedArgv.argv.length > 0;
  if (expected.requireLaunchVerified !== false && !launchVerified) {
    problems.push('unverified launch state cannot qualify as reference acceptance');
  }
  if (derivedExposeGc(j)) problems.push('exposed GC is not acceptance');
  const commit = j.measuredTree?.commit;
  const allowed = new Set(Object.values(PROTOCOL.trees));
  if (expected.treeSha) {
    if (commit !== expected.treeSha) problems.push(`tree SHA ${commit} != expected ${expected.treeSha}`);
  } else if (commit && !allowed.has(commit)) {
    problems.push('measuredTree.commit is not an approved pinned tree');
  }
  return problems;
}

export function sampleVerificationProblems(j, expected, recomputed = recomputeReceiptSeries(j)) {
  const problems = [];
  const label = expected.label || j.treeLabel;
  const sensor = (label && label !== 'A') || j.electronicsPass?.applicable === true;
  const check = (name, claimed, stats) => {
    if (!claimed || claimed.applicable === false || !stats || stats.samples === 0) return;
    if (claimed.p95 != null && stats.p95 != null && claimed.p95 !== stats.p95) {
      problems.push(`stale ${name} p95 ${claimed.p95} != samples ${stats.p95}`);
    }
    if (claimed.p99 != null && stats.p99 != null && claimed.p99 !== stats.p99) {
      problems.push(`stale ${name} p99 ${claimed.p99} != samples ${stats.p99}`);
    }
  };
  if (sensor) {
    const claimed = j.electronicsPass || {};
    if (recomputed.electronics.samples < (expected.passSamples || claimed.samples || 0)) {
      problems.push(`actual electronics samples ${recomputed.electronics.samples} below expected`);
    }
    check('electronicsPass', claimed, recomputed.electronics);
    const actualGate = recomputed.gatePassed;
    if (typeof claimed.passed === 'boolean' && actualGate != null && claimed.passed !== actualGate) {
      problems.push(`stale electronicsPass.passed=${claimed.passed} but samples/gate are ${actualGate}`);
    }
    check('detectionPass', j.detectionPass, recomputed.detection);
    check('updateMs', j.updateMs, recomputed.updateMs);
    check('seekerCPU', j.seekerCPU, recomputed.projectile);
  }
  if (recomputed.tick?.samples) {
    check('frameCPU', {applicable: true, p95: j.frameCPU?.p95, p99: j.frameCPU?.p99}, recomputed.tick);
  }
  return problems;
}

export function effectiveElectronics(j) {
  if (!j || j.electronicsPass?.applicable === false) return null;
  const e = j.electronicsPass;
  if (!e) return null;
  const samples = asArray(j?.samples?.passes);
  let stats = {samples: e.samples, p95: e.p95, p99: e.p99};
  if (samples && samples.some(p => Number.isFinite(p.electronicsMs))) {
    stats = recomputeReceiptSeries(j).electronics;
  }
  return {
    ...e,
    samples: stats.samples,
    p95: stats.p95,
    p99: stats.p99,
    passed: seriesGate(stats)
  };
}

export function receiptIneligible(j) {
  if (!j) return 'missing';
  if (j.diagnostics === true) return 'diagnostics';
  if (j.acceptanceEligible === false) return 'not-acceptance-eligible';
  if (j.profiled === true) return 'profiled';
  if (j.starved === true) return 'starved';
  if (j.gc?.calledInsideMeasuredWindow === true || j.gc?.forcedGcThisRun === true) return 'forced-gc';
  if (Array.isArray(j.errors) && j.errors.length) return 'errors';
  if (j.measuredTree?.dirty) return 'dirty-tree';
  if (j.launch?.verified === false || j.launch?.recordedArgv?.verified === false) return 'unverified-launch';
  if (derivedExposeGc(j)) return 'expose-gc';
  const commit = j.measuredTree?.commit;
  if (commit && !Object.values(PROTOCOL.trees).includes(commit)) return 'unapproved-tree';
  return null;
}

export function effectiveTick(receipt) {
  if (!receipt) return {};
  const ticks = asArray(receipt.samples?.ticks?.dtMs);
  if (ticks && ticks.some(Number.isFinite)) return recomputeReceiptSeries(receipt).tick;
  return receipt.frameCPU || {};
}

function tickOf(receipt) {
  return effectiveTick(receipt);
}

function elecOf(receipt) {
  return effectiveElectronics(receipt);
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
  const ineligible = [];
  const bySeq = new Map((blocks || []).map(b => [b.sequence, b]));
  for (let seq = 1; seq <= expectedSequences; seq++) {
    const block = bySeq.get(seq);
    for (const label of expectedLabels) {
      const j = block?.[label];
      if (!j) {
        missing.push({sequence: seq, label});
        continue;
      }
      const reason = receiptIneligible(j);
      if (reason) ineligible.push({sequence: seq, label, reason});
    }
  }
  for (const block of blocks || []) {
    const C2 = receiptIneligible(block.C2) ? null : block.C2;
    const A = receiptIneligible(block.A) ? null : block.A;
    const B = receiptIneligible(block.B) ? null : block.B;
    const eligibleBlock = {...block, A: A || undefined, B: B || undefined, C2: C2 || undefined};
    if (!A) delete eligibleBlock.A;
    if (!B) delete eligibleBlock.B;
    if (!C2) delete eligibleBlock.C2;
    const elec = effectiveElectronics(C2);
    const inc = blockIncrements({...block, A: A || block.A, B: B || block.B, C2: C2 || block.C2});
    if (!A || !C2) {
      inc.tickP95.cumulativePassed = null;
      inc.tickP95.ewMinusPresensor = A && C2 ? inc.tickP95.ewMinusPresensor : null;
    }
    const run = {
      sequence: block.sequence,
      trees: Object.fromEntries(['A', 'B', 'C1', 'C2', 'F'].filter(k => block[k]).map(k => {
        const j = block[k];
        const inelig = receiptIneligible(j);
        const e = inelig ? null : effectiveElectronics(j);
        const recomputed = inelig ? null : recomputeReceiptSeries(j);
        const tick = recomputed?.tick || tickOf(j);
        const det = recomputed?.detection;
        const upd = recomputed?.updateMs;
        const proj = recomputed?.projectile;
        return [k, {
          commit: j.measuredTree?.commit || j.treeCommit || null,
          ineligible: inelig,
          tickP95: rnd(tick.p95),
          tickP99: rnd(tick.p99),
          electronicsP95: e ? rnd(e.p95) : null,
          electronicsP99: e ? rnd(e.p99) : null,
          electronicsPassed: e ? e.passed : null,
          detectionP95: j.detectionPass?.applicable === false ? null : rnd(det?.p95 ?? seriesP95(j.detectionPass)),
          detectionP99: j.detectionPass?.applicable === false ? null : rnd(det?.p99 ?? seriesP99(j.detectionPass)),
          updateMsP95: j.updateMs?.applicable === false ? null : rnd(upd?.p95 ?? seriesP95(j.updateMs)),
          updateMsP99: j.updateMs?.applicable === false ? null : rnd(upd?.p99 ?? seriesP99(j.updateMs)),
          projectileP95: j.seekerCPU?.applicable === false ? null : rnd(proj?.p95 ?? seriesP95(j.seekerCPU)),
          projectileP99: j.seekerCPU?.applicable === false ? null : rnd(proj?.p99 ?? seriesP99(j.seekerCPU))
        }];
      })),
      increments: inc,
      electronicsPassAbsolute: elec ? {p95: rnd(elec.p95), p99: rnd(elec.p99), passed: elec.passed} : null
    };
    perRun.push(run);
    if (elec?.p95 != null) electronicsP95.push(elec.p95);
    if (C2 && tickOf(C2).p95 != null) tickP95.push(tickOf(C2).p95);
  }
  const invalid = [...invalidReceipts, ...ineligible];
  const acceptanceComplete = missing.length === 0 && ineligible.length === 0 && invalidReceipts.length === 0
    && expectedLabels.every(label => {
      if (label === 'F') return true;
      return [...bySeq.values()].filter(b => b.sequence >= 1 && b.sequence <= expectedSequences).length >= expectedSequences
        && Array.from({length: expectedSequences}, (_, i) => bySeq.get(i + 1)?.[label]).every(Boolean);
    });
  const listedComplete = missing.length === 0 && ineligible.length === 0 && (blocks || []).length >= expectedSequences;
  const anyElecFail = perRun.some(r => r.electronicsPassAbsolute && r.electronicsPassAbsolute.passed === false);
  const anyElecMissing = !listedComplete || perRun.filter(r => r.electronicsPassAbsolute).length < expectedSequences;
  const anyCumulFail = perRun.some(r => r.increments.tickP95.cumulativePassed === false);
  const anyCumulMissing = !listedComplete || perRun.some(r => r.increments.tickP95.cumulativePassed == null);
  const campaignElectronicsPass = {
    anyRunFailed: anyElecFail,
    allRunsPassed: listedComplete && invalid.length === 0 && !anyElecFail && !anyElecMissing
      && perRun.length >= expectedSequences
      && perRun.every(r => r.electronicsPassAbsolute?.passed === true),
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
    allRunsPassed: listedComplete && invalid.length === 0 && !anyCumulFail && !anyCumulMissing
      && perRun.length >= expectedSequences
      && perRun.every(r => r.increments.tickP95.cumulativePassed === true),
    worstEwMinusPresensorP95: cumulValues.length ? Math.max(...cumulValues) : null,
    perRun: perRun.map(r => ({
      sequence: r.sequence,
      ewMinusPresensor: r.increments.tickP95.ewMinusPresensor,
      passed: r.increments.tickP95.cumulativePassed
    }))
  };
  const campaignPassed = campaignElectronicsPass.allRunsPassed && campaignCumulativeFrame.allRunsPassed;
  const campaignStatus = campaignPassed
    ? 'passed'
    : (ineligible.length || invalidReceipts.length)
      ? 'invalid'
      : missing.length
        ? 'incomplete'
        : (anyElecFail || anyCumulFail)
          ? 'failed'
          : 'incomplete';
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
      missingOrInvalidCannotPass: true,
      ineligibleCannotPass: true
    },
    expectedSequences,
    expectedLabels,
    missing,
    ineligible,
    invalidReceipts: invalid,
    campaignStatus,
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

export function loadCampaignReceipts(receiptDir, stamp, {
  harnessSha256,
  helperSha256,
  config = approvedCampaignConfig()
} = {}) {
  const prefix = stamp;
  const files = fs.existsSync(receiptDir)
    ? fs.readdirSync(receiptDir).filter(f => f.startsWith(prefix) && f.endsWith('.json') && !f.includes('summary') && !f.includes('plan') && !f.includes('increments'))
    : [];
  const blocks = new Map();
  const invalidReceipts = [];
  for (const file of files) {
    const m = file.match(/seq(\d+)-(A|B|C1|C2|F)\.json$/);
    if (!m) continue;
    const full = path.join(receiptDir, file);
    const seq = Number(m[1]);
    const label = m[2];
    const expected = expectedCampaignMeasurement({
      sequence: seq,
      label,
      treeSha: config.trees[label],
      harnessSha256,
      helperSha256,
      passWarmup: config.passWarmup,
      passSamples: config.passSamples,
      tickWarmup: config.tickWarmup,
      tickSamples: config.tickSamples,
      passCadenceMs: config.passCadenceMs
    });
    const classification = classifyExistingReceipt(full, expected);
    if (classification.action !== 'skip') {
      invalidReceipts.push({file: full, ...classification});
      continue;
    }
    const json = JSON.parse(fs.readFileSync(full, 'utf8'));
    const block = blocks.get(seq) || {sequence: seq};
    block[label] = json;
    blocks.set(seq, block);
  }
  return {blocks: [...blocks.values()].sort((a, b) => a.sequence - b.sequence), invalidReceipts};
}

export function supportingHashes(repoRoot) {
  const files = [
    'scripts/ew-frame-benchmark.mjs',
    'scripts/ew-bench-lib.mjs',
    'scripts/ew-bench-report.mjs',
    'scripts/ew-campaign.sh',
    'scripts/ew-resume-check.mjs',
    'scripts/ew-bench-resume-test.mjs',
    'scripts/ew-bench-astra-synthetics.mjs',
    'scripts/ew-bench-r5-repro.mjs',
    'docs/ew/BENCHMARK-PROTOCOL.md'
  ];
  return Object.fromEntries(files.filter(f => fs.existsSync(path.join(repoRoot, f))).map(f => [f, sha256File(path.join(repoRoot, f))]));
}

function assert(cond, msg) {
  if (!cond) throw new Error(msg);
}

export function fixtureReceipt({
  label = 'C2',
  sequence = 1,
  commit = PROTOCOL.trees[label] || PROTOCOL.trees.C2,
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
  if (electronicsP99 < electronicsP95) electronicsP99 = electronicsP95;
  if (tickP99 < tickP95) tickP99 = tickP95;
  const pin = pinnedIdentity(label) || pinnedIdentity(commit);
  const elec = applicable ? rankedSeries(passSamples, electronicsP95, electronicsP99) : [];
  const ticks = rankedSeries(tickSamples, tickP95, tickP99);
  const projectile = applicable ? rankedSeries(passSamples, 0.2, 0.3) : [];
  return {
    treeLabel: label,
    sequence,
    diagnostics: false,
    profiled: false,
    starved: false,
    acceptanceEligible: true,
    errors: [],
    measuredTree: {commit, tree: pin?.tree || '0'.repeat(40), dirty: ''},
    sources: {...(pin?.sources || {'src/main.js': 'a'.repeat(64)})},
    harness: {sha256: harnessSha256, helperSha256},
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
    samples: {
      ticks: {dtMs: ticks, tRelMs: ticks.map((_, i) => i)},
      passes: applicable ? elec.map((electronicsMs, i) => ({
        i,
        tEpochMs: 1e12 + i,
        tRelMs: i,
        electronicsMs,
        detectionMs: electronicsMs,
        updateMs: electronicsMs,
        projectileMs: projectile[i]
      })) : null
    },
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
  assert(argvChosen.pid === 2 && argvChosen.selected === 'browser-process-without-type' && argvChosen.verified === true, 'prefer no --type=');
  assert(/chrome/i.test('/usr/bin/chromium') === false, 'legacy /chrome/i misses chromium basename');
  assert(isBrowserExecutable('/usr/bin/chromium') && isBrowserExecutable('/opt/google/chrome') && isBrowserExecutable('/path/headless_shell'), 'chromium/chrome/headless_shell');
  const fromChromium = selectRecordedArgv([
    {pid: 9, argv: ['/usr/bin/firefox']},
    {pid: 10, argv: ['/usr/bin/chromium', '--disable-field-trial-config']}
  ]);
  assert(fromChromium.pid === 10 && fromChromium.verified === true, 'select chromium without /chrome/i');
  const fromPid = selectRecordedArgv([
    {pid: 10, argv: ['/usr/bin/chromium', '--disable-field-trial-config']},
    {pid: 11, argv: ['/usr/bin/chromium', '--type=renderer']}
  ], {preferPid: 10});
  assert(fromPid.selected === 'playwright-browser-process' && fromPid.verified === true, 'prefer Playwright pid');
  const drifted = campaignConfigFromEnv({TREE_C2: '0'.repeat(40), EW_PASS_WARMUP: '3', EW_TICK_SAMPLES: '9'});
  assert(drifted.acceptance === false && drifted.drifts.includes('trees.C2') && drifted.drifts.includes('passWarmup') && drifted.drifts.includes('tickSamples'), 'non-approved overrides are not acceptance');
  const approvedPlan = campaignPlan();
  assert(validatePlan(approvedPlan).ok === false, 'plan without harness hashes is incomplete');
  approvedPlan.harness = {sha256: 'h'.repeat(64), helperSha256: 'l'.repeat(64)};
  assert(approvedPlan.runs.filter(r => r.label === 'C2').every(r => r.sha === approvedPlan.trees.C2), 'plan.runs match plan.trees');
  assert(validatePlan(approvedPlan, {harnessSha256: 'h'.repeat(64), helperSha256: 'l'.repeat(64)}).ok === true, 'approved plan validates');
  const internallyConsistentOverride = campaignPlan(drifted.requested);
  internallyConsistentOverride.harness = {sha256: 'h'.repeat(64), helperSha256: 'l'.repeat(64)};
  assert(internallyConsistentOverride.runs.filter(r => r.label === 'C2').every(r => r.sha === internallyConsistentOverride.trees.C2), 'generated plan keeps trees and runs together');
  assert(validatePlan(internallyConsistentOverride).ok === false, 'unapproved generated plan is not acceptance');
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
    A: fixtureReceipt({label: 'A', sequence: seq, commit: PROTOCOL.trees.A, applicable: false, tickP95: 0.8}),
    B: fixtureReceipt({label: 'B', sequence: seq, commit: PROTOCOL.trees.B, electronicsP95: 1.2, electronicsP99: 1.8, tickP95: 1.1}),
    C1: fixtureReceipt({label: 'C1', sequence: seq, commit: PROTOCOL.trees.C1, electronicsP95: 1.3, electronicsP99: 1.9, tickP95: 1.2}),
    C2: fixtureReceipt({label: 'C2', sequence: seq, electronicsP95: 1.5, electronicsP99: 2.0, tickP95: 1.4})
  });
  const green = summarizeCampaign([passingBlock(1), passingBlock(2), passingBlock(3)]);
  assert(green.campaignStatus === 'passed', 'complete passing status');
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
  const synthetic = (extra = {}) => ({
    acceptanceEligible: true,
    diagnostics: false,
    errors: [],
    measuredTree: {commit: 'deliberately-not-a-pinned-commit', dirty: ''},
    frameCPU: {samples: 3600, p95: 1, p99: 1.5},
    electronicsPass: {applicable: true, samples: 1000, p95: 1, p99: 2, passed: true},
    ...extra
  });
  const oneC2 = summarizeCampaign([{sequence: 1, C2: synthetic()}]);
  assert(oneC2.campaignElectronicsPass.allRunsPassed === false, 'single C2 cannot allRunsPassed');
  assert(oneC2.campaignPassed === false && oneC2.campaignStatus !== 'passed', 'single C2 is not a passing campaign');
  const diag = (label, seq) => ({
    treeLabel: label,
    sequence: seq,
    acceptanceEligible: false,
    diagnostics: true,
    errors: [],
    measuredTree: {commit: PROTOCOL.trees[label], dirty: ''},
    gc: {calledInsideMeasuredWindow: true, forcedGcThisRun: true},
    frameCPU: {samples: 3600, p95: 1, p99: 1.5},
    electronicsPass: label === 'A' ? {applicable: false} : {applicable: true, samples: 1000, p95: 1, p99: 2, passed: true}
  });
  const diagBlock = seq => ({sequence: seq, A: diag('A', seq), B: diag('B', seq), C1: diag('C1', seq), C2: diag('C2', seq)});
  const diagSum = summarizeCampaign([diagBlock(1), diagBlock(2), diagBlock(3)]);
  assert(diagSum.campaignElectronicsPass.allRunsPassed === false, 'diagnostic ineligible C2s cannot allRunsPassed');
  assert(diagSum.campaignStatus === 'invalid', 'diagnostic campaign is invalid not passed');
  const staleBlock = passingBlock(1);
  staleBlock.C2 = fixtureReceipt({label: 'C2', sequence: 1, electronicsP95: 9, electronicsP99: 9, electronicsPassed: true});
  const staleSum = summarizeCampaign([staleBlock, passingBlock(2), passingBlock(3)]);
  assert(staleSum.campaignElectronicsPass.allRunsPassed === false && staleSum.campaignElectronicsPass.anyRunFailed === true, 'stale passed:true with 9/9 fails');
  const empty = summarizeCampaign([]);
  assert(empty.campaignElectronicsPass.allRunsPassed === false && empty.campaignPassed === false, 'empty helper allRunsPassed is false');
  assert(empty.campaignStatus === 'incomplete', 'empty campaign is incomplete');
  const parentOf = pid => ({20: 10, 10: 1, 99: 2}[pid] ?? 0);
  const ownedArgv = selectRecordedArgv([
    {pid: 99, argv: ['/usr/bin/chromium', '--disable-field-trial-config']},
    {pid: 20, argv: ['/usr/bin/chromium', '--owned-flag']}
  ], {ownerPid: 1, parentOf});
  assert(ownedArgv.pid === 20 && ownedArgv.verified === true, 'ownership prefers descendant browser');
  const unownedPid = selectRecordedArgv([
    {pid: 99, argv: ['/usr/bin/chromium', '--disable-field-trial-config']}
  ], {preferPid: 99, ownerPid: 1, parentOf});
  assert(unownedPid.verified === false, 'unowned Playwright pid is unverified');
  const aValid = fixtureReceipt({label: 'A', sequence: 1, commit: PROTOCOL.trees.A});
  const aExpected = expectedCampaignMeasurement({
    label: 'A',
    sequence: 1,
    treeSha: PROTOCOL.trees.A,
    harnessSha256: 'h'.repeat(64),
    helperSha256: 'l'.repeat(64)
  });
  const aCheck = validateReceipt(aValid, aExpected);
  assert(aCheck.ok === true && aCheck.electronicsPassed === null, 'tree A complete with N/A electronics');
  const aWithPasses = {...aValid, samples: {...aValid.samples, passes: [{electronicsMs: 1}]}};
  assert(validateReceipt(aWithPasses, aExpected).status === 'incomplete', 'tree A pass samples must be null');
  const aWithDetection = {...aValid, detectionPass: {applicable: true, p95: 1, p99: 1}};
  assert(validateReceipt(aWithDetection, aExpected).status === 'incomplete', 'tree A detectionPass must be N/A');
  const aShortTicks = {
    ...aValid,
    frameCPU: {...aValid.frameCPU, samples: 8},
    samples: {...aValid.samples, ticks: {dtMs: Array.from({length: 8}, () => 1), tRelMs: Array.from({length: 8}, (_, i) => i)}}
  };
  assert(validateReceipt(aShortTicks, aExpected).status === 'incomplete', 'tree A tick samples must match campaign count');
  const c2Expected = expectedCampaignMeasurement({
    label: 'C2',
    sequence: 1,
    treeSha: PROTOCOL.trees.C2,
    harnessSha256: 'h'.repeat(64),
    helperSha256: 'l'.repeat(64)
  });
  const staleTicks = fixtureReceipt({label: 'C2', sequence: 1, tickP95: 10, tickP99: 10});
  staleTicks.frameCPU = {samples: PROTOCOL.tickSamples, p95: 1.5, p99: 1.5};
  assert(validateReceipt(staleTicks, c2Expected).ok === false, 'stale frameCPU vs tick samples is rejected');
  const aBaseline = fixtureReceipt({label: 'A', sequence: 1, commit: PROTOCOL.trees.A, applicable: false, tickP95: 1, tickP99: 1});
  const staleInc = blockIncrements({A: aBaseline, C2: staleTicks});
  assert(staleInc.tickP95.ewMinusPresensor === 9, 'cumulative uses recomputed ticks');
  assert(staleInc.tickP95.cumulativePassed === false, 'recomputed +9 fails cumulative');
  const gcArgv = fixtureReceipt({label: 'C2', sequence: 1});
  gcArgv.launch.extraArgs = [];
  gcArgv.launch.exposeGcFlag = false;
  gcArgv.launch.recordedArgv = {
    pid: 1,
    argv: ['/usr/bin/chromium', '--js-flags=--expose-gc'],
    selected: 'playwright-browser-process',
    verified: true
  };
  gcArgv.gc.gcFunctionPresent = true;
  assert(validateReceipt(gcArgv, c2Expected).ok === false, 'expose-gc argv is rejected');
  const dirtyTree = fixtureReceipt({label: 'C2', sequence: 1});
  dirtyTree.measuredTree.dirty = ' M src/main.js';
  assert(validateReceipt(dirtyTree, c2Expected).ok === false, 'dirty measured tree is rejected');
  const twelveA = campaignPlan();
  twelveA.harness = {sha256: 'h'.repeat(64), helperSha256: 'l'.repeat(64)};
  twelveA.runs = twelveA.runs.map(r => ({...r, label: 'A', sequence: 1, sha: PROTOCOL.trees.A}));
  assert(validatePlan(twelveA, {harnessSha256: 'h'.repeat(64), helperSha256: 'l'.repeat(64)}).ok === false, '12× A/seq1 is not the matrix');
  return {ok: true, checks: 67};
}

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  const result = selfTest();
  console.log(JSON.stringify(result, null, 2));
}
