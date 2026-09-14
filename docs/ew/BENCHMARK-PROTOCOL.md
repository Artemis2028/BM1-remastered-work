# EW long-campaign measurement protocol (Fable review)

**Status: awaiting Fable protocol review — long campaign not started.**

This document specifies the benchmark-only follow-up. It does not change
gameplay, budgets, freeze tags, or the 2 / 4 ms **measurement boundaries and
thresholds**. The harness *file* is allowed to change so it can emit
per-sample series and launch flags; a **new harness hash is expected**. The
old helper is preserved. The new file is **not** frozen until Fable reviews
this diff.

It does not start the 1,000-pass campaign. Existing receipts stay on disk.

Correctness is already accepted (functional suites + builds). Astra’s Platinum
rerun of `51738ca` failed `electronicsPass` twice (3.70 / 9.20 and 2.00 / 4.30).
The sensor baseline also failed p99; cumulative frame increases passed.
Variability on those short runs prevents reliable attribution. This protocol
exists so a later campaign can be compared without selecting a lucky run.

## 1. Gates (unchanged boundaries and thresholds)

| Gate | Series | Limit |
| --- | --- | ---: |
| External electronics gate | `electronicsPass` = harness wall-clock of `updatePowerSystems(12)` + `updateSensorSystems(12)` after the seeker window | **2 ms p95 / 4 ms p99** |
| Cumulative frame | whole-frame tick p95 vs pre-sensor (tree A) | **≤ 2 ms** |

Same series Platinum recorded as `detectionPass` at **2.50 / 6.90 (failed)**.
Thresholds are not recalibrated. A later campaign does not invent a replacement
gate.

Report **separately**, and never as substitute gates:

- **detection-pass** — engine `elapsedMs` / `detectionMs` (detection + sharing)
- **sensor update** — `updateMs` (complete `updateSensorSystems`)
- **projectile / seekerCPU** — full `updateProjectiles` (guidance, movement, collision, damage, FX)
- **whole-frame tick** — `tick(1)` including projectiles

Pre-sensor + `--passes` writes sensor-pass series as **not applicable**, never
zero. Increments to report on every sequence block: **EW−sensors** and
**EW−pre-sensor**. `electronicsPass` vs pre-sensor is N/A.

The timed boundary in `scripts/ew-frame-benchmark.mjs` is unchanged:

```
const t = performance.now();
B.updateProjectiles(1);
const afterSeekers = performance.now();
B.updatePowerSystems(12);
B.updateSensorSystems(12);
const afterElectronics = performance.now();
seekers.push(afterSeekers - t);
electronics.push(afterElectronics - afterSeekers);
```

`electronicsPass` remains `afterElectronics - afterSeekers`. Projectile timing
remains `afterSeekers - t` and is not folded into the gate.

## 2. Pinned trees (full SHAs)

One pinned **new** harness (after Fable reviews this diff) against every tree.
Do not retag or move `ew-fable-candidate-20260913` or the `51738ca` pin.

| Label | SHA | Role |
| --- | --- | --- |
| A | `6958f08e73aff55efbf48bae3f9433e5acc270e8` | Pre-sensor / OPS. Frame baseline. Sensor-pass N/A. |
| B | `e7aa3c594e4799c54d48e2eeac37a2a1acf36b9b` | Sensors. Ordinary torpedoes. |
| C1 | `74caf837c7882a86e3bd7c74f083029453953c1a` | Paid noise/ECCM. Ordinary torpedoes. |
| C2 | `51738caf3a1d88492c4fc48a7c0125d4a7e2a355` | Measured EW candidate (full EW + HOJ). |
| F (optional extra) | `077a9cedaa5a6cb858b200addb115d862ab238e6` | Frozen candidate. Same-session comparison only. **Tag not moved.** Not in the finite 30-minute campaign. |

## 3. New harness hash is expected; old harness preserved

“Unchanged” in this review means **measurement boundaries and thresholds**,
not the entire `ew-frame-benchmark.mjs` file. Adding individual samples and
recording actual browser launch flags **requires** changing that file.

| Harness | Where | sha256 |
| --- | --- | --- |
| **Old** (preserved) | git `e02235c:scripts/ew-frame-benchmark.mjs` and copy `docs/ew/receipts/harness-e02235c.mjs` | `e79876004ea9b8846ed6f31ca040fc1ff2452db43f77ba744837d9fb6b8b115d` |
| **New** (this PR; freeze **after** Fable reviews the diff) | `scripts/ew-frame-benchmark.mjs` | see `docs/ew/receipts/campaign-pending-plan.json` |

Old receipts that used `e7987600…` stay on disk and are not rewritten. Do not
point those families at the new hash.

The previous pinned helper emitted **percentiles plus a few selected seeker
outliers**. It did **not** emit a per-sample series. Launch arguments were
not written by the harness; they came from a preload **outside** the receipt.

Required output of the **new** helper (inside the JSON receipt, not a sidecar):

- `samples.passes[]`: per-pass `electronicsMs`, `detectionMs`, `updateMs`,
  `projectileMs`, `tEpochMs`, `tRelMs`, and workload counters (`observers`,
  `actors`, `pairs`, `jammerPairs`, `liveProjectiles`, `died`, `newEffects`,
  `activeJammers`)
- `samples.ticks`: whole-frame `dtMs` in original order, with `tRelMs`
- `launch.extraArgs`: flags **this process** passed to `chromium.launch`
  (`[]` on acceptance)
- `launch.recordedArgv`: Chromium argv observed from `/proc` while the
  browser is live
- `launch.argv`: node argv
- `gc.*` collection-call flags and `launch.exposeGcFlag`
- measured commit/tree SHA, source hashes, harness hash, browser version,
  CPU, viewport

Acceptance still calls `chromium.launch()` with **no extra args**.

### Every harness diff vs preserved `e02235c` / `e7987600…`

| Change | Why |
| --- | --- |
| CLI: `--pass-samples`, `--pass-warmup`, `--tick-samples`, `--tick-warmup`, `--tree-label`, `--sequence`, `--diagnostics`, `--gc-placement` | Campaign size, labels, diagnostics-only GC. Defaults remain 50+300 / 600+3600. |
| `launchExtraArgs` / `launchOptions` recorded on the receipt | Flags live in the JSON, not a preload. Acceptance extraArgs = `[]`. |
| `/proc` snapshot of chrome argv (`launch.recordedArgv`) | Complete Chromium command line Playwright actually spawned. |
| `samples.passes` / `samples.ticks` | Per-sample series, timestamps, counters. |
| `stats()` sorts a **copy** | Required so raw series survive. Formula still `sorted[floor(n * p)]`. |
| Loop bounds use `passWarmup` / `passSamples` / `tickWarmup` / `tickSamples` instead of literals 50 / 300 / 600 / 3600 | Same defaults; campaign can request 1000. |
| `Date.now()` immediately **before** `const t = performance.now()` | Timestamp; not inside the timed deltas. |
| `gc` object + `--gc-placement` | Diagnostic-only forced GC. See §6. |
| `measuredTree` git commit/tree | Pin identity in the receipt. |
| `acceptanceEligible` | True only at campaign counts, unprofiled, no diagnostics, `gcPlacement=none`. |
| `previousHarness` | Points at the preserved `e7987600…` file. |
| `warmupSeconds` / `simulationSeconds` derived from actual pass counts | 50+300 still 10s / 60s. |

**Not changed (boundaries / fixture / thresholds):** Earth 20/18/6 fixture;
jammer mount on EW only; order `updateProjectiles(1)` →
`updatePowerSystems(12)` → `updateSensorSystems(12)`; 200 ms cadence;
`electronicsPass` clock; gate objects `{p95Ms: 2, p99Ms: 4}`; seeker outlier
top-12 still present; `--profile` still off the gate; viewport 1280×850; N/A
pre-sensor contract; source SHA-256 of the four production files.

## 4. Finite campaign: count, order, duration, resume

Specified **upfront** (not started in this PR):

| Item | Value |
| --- | --- |
| Sequence count | **3** |
| Sequence order | **A → B → C1 → C2** (F is optional extra, not in this budget) |
| Pass warm-up | 50 passes at 200 ms (~10 s) per sensor-bearing tree |
| Measured passes | **1,000** per sensor-bearing tree (B, C1, C2) |
| Tick warm-up / measured | 600 / 3,600 (all trees, including A) |
| Browser | one process per run; process exit between runs (not forced GC) |

**Duration arithmetic** (200 ms cadence):

- 1,000 samples × 0.200 s = **200 s = 3 min 20 s** of timed sensor passes per
  sensor-bearing tree.
- Sensor-bearing trees per sequence: B, C1, C2 (three).
- Timed sensor passes: 3 sequences × 3 trees × 200 s = **1,800 s ≈ 30 min**.
- Plus, not in that 30 min: 50-pass warm-up (~10 s × 9 ≈ 1.5 min), tree A
  (ticks only; sensor-pass N/A), 600+3600 tick measure, browser/setup.
- Optional F or `--diagnostics` **add time** and are not part of the finite
  acceptance campaign.

This specified campaign is **not inherently multi-hour**.

**Resume procedure** (Fable may run one sequence at a time):

1. After approval: `EW_CAMPAIGN_CONFIRMED=1 scripts/ew-campaign.sh --execute --sequence N`
2. Every raw file is retained. `campaign-pending-seq{N}-{A,B,C1,C2}.json`
   that already exist and are non-empty are **skipped**, so a stopped
   sequence resumes at the next missing tree.
3. Start / skip / complete / fail events append to
   `campaign-pending-interruptions.jsonl`. Record operator stops there too.
4. Do not delete other sequences’ files. Do not pass `--diagnostics` on
   these runs.
5. Matched-block comparison uses sequence *k* of C2 only with sequence *k*
   of A/B/C1.

Default `npm run test:ew:performance` remains the historical 50 + 300 helper
(`acceptanceEligible: false`).

## 5. Percentile, matched blocks, reporting

**Percentile:** nearest-rank `sorted[floor(n * p)]` on a **copy**. For n =
1,000: p50 = index 500, p95 = 950, p99 = 990. Same method as the historical
300-sample receipts (those used n = 300). Mean / stdev / min / max may be
printed as variability; they are not the gate.

**Matched-block comparison:** sequence *k* of C2 is compared only to sequence
*k* of A, B, and C1. Do not pair a later C2 block with an earlier B block.

**Reporting rules:**

1. List **every** run’s absolute `electronicsPass` p95 / p99 and pass/fail vs
   2 / 4. Same for detection, `updateMs`, projectile, and tick p95 / p99.
2. List **both** increments on every block: EW−sensors and EW−pre-sensor
   (tick and, where defined, `electronicsPass`). Cumulative tick vs A stays
   judged at ≤ 2 ms p95.
3. Report variability across C2 blocks (range of p95 / p99). That is context,
   not a substitute gate.
4. **No best-run selection.** A green block does not retire a red block.
5. **No median delta substituted for the absolute gate.** A small typical
   increment does not pass a run whose absolute `electronicsPass` is 3.70 /
   9.20.
6. The campaign fails the electronics gate if **any** listed C2 acceptance
   run fails 2 / 4. The summary also prints the worst absolute p95 / p99.
7. Platinum 2.50 / 6.90 remains failed release authority until a Platinum
   campaign using this protocol says otherwise. Supplementary hosts say so.

`scripts/ew-bench-report.mjs` implements those rules after receipts exist.

## 6. Forced GC stays out of acceptance altogether

Placement alone does not make forced GC safe for the gate. Forcing collection
**between measured blocks** can still shift collection costs out of the
results. Therefore:

- **Acceptance / campaign execute:** no `--diagnostics`, no
  `--gc-placement`, no `--js-flags=--expose-gc`, **`gc()` is never called**.
  Naturally occurring GC stays in the samples.
- **Forced GC exists only** on separately labelled `--diagnostics` runs
  (`acceptanceEligible: false`, never the gate). Those runs are extra time.

Fable can verify **both** collection calls and launch configuration from the
receipt, not from prose:

| Field | Acceptance must show |
| --- | --- |
| `launch.extraArgs` | `[]` |
| `launch.exposeGcFlag` | `false` |
| `gc.forcedGcThisRun` | `false` |
| `gc.forcedGcInAcceptance` | `false` |
| `gc.gcFunctionPresent` | `false` (no expose-gc) |
| `gc.calledBeforeMeasuredWindow` | `false` |
| `gc.calledAfterMeasuredWindow` | `false` |
| `gc.calledInsideMeasuredWindow` | `false` |
| `launch.recordedArgv.argv` | must **not** contain `--js-flags=--expose-gc` |

Diagnostic-only (never mix into the finite campaign):

| Mode | Flags | `gc()` | Receipt |
| --- | --- | --- | --- |
| between-blocks | `--diagnostics` (default placement) | after warm-up and after the measured `for` | `calledBefore/AfterMeasuredWindow=true`, `calledInside=false`, `exposeGcFlag=true` |
| inside-window | `--diagnostics --gc-placement=inside-window` | inside the measured `for` | `calledInsideMeasuredWindow=true`, `exposeGcFlag=true` |

Grep anchors in `scripts/ew-frame-benchmark.mjs`:

- `launchExtraArgs = gcPlacement === 'none' ? [] : ['--js-flags=--expose-gc']`
- `if (gcPlacement === 'between-blocks') forceGc(...)` only under `--diagnostics`
- `if (gcPlacement === 'inside-window') forceGc('calledInsideMeasuredWindow')` only under `--diagnostics`
- `scripts/ew-campaign.sh` execute path never passes `--diagnostics`

## 7. Existing receipts (preserved)

Do not delete, rewrite, or relabel earlier families. They are not this
campaign. They keep the **old** harness hash `e7987600…`.

| Family | What it is |
| --- | --- |
| `performance-*.json` | Platinum 8573C authority, failed 2.50 / 6.90 |
| `review-20260913-*.json` | 4-core supplementary |
| `fix-20260913-*.json` | correctness-gate timings |
| `passms-20260913-*.json` | superseded passMs-as-gate experiment |
| `authority-20260913-*.json` | restored original timer |
| `perf-followup-20260914-*.json` | 300-sample follow-up of `51738ca` on a supplementary host |
| `harness-e02235c.mjs` | preserved old helper (`e7987600…`) |

Projectile spikes on sensor-only / ordinary-torpedo trees show stalls are
**not unique to seekers**. They do not establish cause and they do not
exonerate EW. `authority-20260913-ew-tip.json` sample i:51 (2.2 ms, died 0,
newEffects 0, live 6) remains unproven.

## 8. How to run — after Fable approval only

Plan only (this PR’s verification):

```sh
scripts/ew-campaign.sh --plan
node scripts/ew-bench-lib.mjs
```

The hashed plan snapshot for this PR is `docs/ew/receipts/campaign-pending-plan.json`.

After written approval, **one sequence at a time** (not this PR):

```sh
EW_CAMPAIGN_CONFIRMED=1 scripts/ew-campaign.sh --execute --sequence 1 docs/ew/receipts
EW_CAMPAIGN_CONFIRMED=1 scripts/ew-campaign.sh --execute --sequence 2 docs/ew/receipts
EW_CAMPAIGN_CONFIRMED=1 scripts/ew-campaign.sh --execute --sequence 3 docs/ew/receipts
```

Until then the execute path refuses. Do not merge to main. Do not move
`ew-fable-candidate-20260913` or the `51738ca` pin. Do not freeze the new
harness until Fable reviews this diff. **Campaign not started.**
