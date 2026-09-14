# EW long-campaign measurement protocol (Fable review)

**Status: awaiting Fable protocol review — long campaign not started.**

This document specifies the benchmark-only follow-up. It does not change
gameplay, budgets, freeze tags, or the 2 / 4 ms gate. It does not start the
≥1,000-pass campaign. Existing receipts stay on disk, unlabeled as this
campaign.

Correctness is already accepted (functional suites + builds). Astra’s Platinum
rerun of `51738ca` failed `electronicsPass` twice (3.70 / 9.20 and 2.00 / 4.30).
The sensor baseline also failed p99; cumulative frame increases passed.
Variability on those short runs prevents reliable attribution. This protocol
exists so a later campaign can be compared without selecting a lucky run.

## 1. Gates (unchanged)

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

One pinned harness against every tree. Do not retag or move the freeze.

| Label | SHA | Role |
| --- | --- | --- |
| A | `6958f08e73aff55efbf48bae3f9433e5acc270e8` | Pre-sensor / OPS. Frame baseline. Sensor-pass N/A. |
| B | `e7aa3c594e4799c54d48e2eeac37a2a1acf36b9b` | Sensors. Ordinary torpedoes. |
| C1 | `74caf837c7882a86e3bd7c74f083029453953c1a` | Paid noise/ECCM. Ordinary torpedoes. |
| C2 | `51738caf3a1d88492c4fc48a7c0125d4a7e2a355` | Measured EW candidate (full EW + HOJ). |
| F (optional fifth) | `077a9cedaa5a6cb858b200addb115d862ab238e6` | Frozen `ew-fable-candidate-20260913`. Same-session comparison when assessing the optimization. **Tag not moved.** Not a replacement C2. |

This protocol includes F in the planned sequence because the campaign is meant
to assess `51738ca` against the freeze as well as A/B/C1.

## 3. Check 2 — harness output shape and launch flags in the receipt

The previous pinned harness (`e02235c` / sha256 `e7987600…`) emitted
**percentiles plus a few selected seeker outliers**. It did **not** emit a
per-sample series. Launch arguments were not written by the harness; they
came from a preload **outside** the receipt.

This commit changes that file so Fable can inspect **exactly what else
changed**. Required output (inside the JSON receipt, not a sidecar):

- `samples.passes[]`: per-pass `electronicsMs`, `detectionMs`, `updateMs`,
  `projectileMs`, `tEpochMs`, `tRelMs`, and workload counters (`observers`,
  `actors`, `pairs`, `jammerPairs`, `liveProjectiles`, `died`, `newEffects`,
  `activeJammers`)
- `samples.ticks`: whole-frame `dtMs` in original order, with `tRelMs`
- `launch.extraArgs`: flags **this process** passed to `chromium.launch`
  (empty on acceptance)
- `launch.recordedArgv`: Chromium argv observed from `/proc` while the
  browser is live (Playwright defaults plus any extraArgs)
- `launch.argv`: node argv
- measured commit/tree SHA, source hashes, harness hash, browser version,
  CPU, viewport

Acceptance still calls `chromium.launch()` with **no extra args**, same as
the pinned helper. Diagnostics is the only path that adds
`--js-flags=--expose-gc`, and that path is labelled not-the-gate.

### Every harness diff vs `e02235c` `scripts/ew-frame-benchmark.mjs`

| Change | Why |
| --- | --- |
| CLI: `--pass-samples`, `--pass-warmup`, `--tick-samples`, `--tick-warmup`, `--tree-label`, `--sequence`, `--diagnostics`, `--gc-placement` | Campaign size, labels, diagnostics. Defaults remain 50+300 / 600+3600. |
| `launchExtraArgs` / `launchOptions` recorded on the receipt | Check 2: flags live in the JSON, not a preload. Acceptance extraArgs = `[]`. |
| `/proc` snapshot of chrome argv (`launch.recordedArgv`) | Complete Chromium command line Playwright actually spawned. |
| `samples.passes` / `samples.ticks` | Check 2: per-sample series, timestamps, counters. |
| `stats()` sorts a **copy** | Required so raw series survive. Formula still `sorted[floor(n * p)]`. |
| Loop bounds use `passWarmup` / `passSamples` / `tickWarmup` / `tickSamples` instead of literals 50 / 300 / 600 / 3600 | Same defaults; campaign can request 1000. |
| `Date.now()` / `performance.now()` origin next to each measured pass | Timestamps for the series. |
| `gc` object + `--gc-placement` | Check 5. See §6. Acceptance never calls `gc()`. |
| `measuredTree` git commit/tree | Pin identity in the receipt. |
| `acceptanceEligible` | True only at campaign counts, unprofiled, no diagnostics, `gcPlacement=none`. |
| `warmupSeconds` / `simulationSeconds` derived from actual pass counts | 50+300 still 10s / 60s. |

**Not changed (timed boundary / fixture):** Earth 20/18/6 fixture; jammer mount
on EW only; order `updateProjectiles(1)` → `updatePowerSystems(12)` →
`updateSensorSystems(12)`; 200 ms cadence; `electronicsPass` clock; gate
objects `{p95Ms: 2, p99Ms: 4}`; seeker outlier top-12 still present;
`--profile` still off the gate; viewport 1280×850; N/A pre-sensor contract;
source SHA-256 of the four production files.

## 4. Samples, warm-up, planned campaign size, logistics

| Item | Value |
| --- | ---: |
| Pass warm-up | 50 passes (200 ms cadence; ~10 s) |
| Measured passes per sensor/EW run | **≥ 1,000** (plan uses 1,000) |
| Tick warm-up / measured | 600 / 3,600 (unchanged) |
| Sequence order | A → B → C1 → C2 → F |
| Serial interleaved repetitions | **3** |
| Browser | one process per run; exit between runs |

**Wall-clock (why one sequence at a time):** 1,000 passes × 200 ms ≈ **200 s
(3+ min) per run** for the pass loop alone, plus tick warm-up/measure and
browser start. Four or five trees × several interleaved sequences is
**multi-hour**. Do not require one invocation to finish the whole campaign.

**One sequence at a time, every raw file kept:**

```sh
# After Fable approval only — not in this PR:
EW_CAMPAIGN_CONFIRMED=1 scripts/ew-campaign.sh --execute --sequence 1
EW_CAMPAIGN_CONFIRMED=1 scripts/ew-campaign.sh --execute --sequence 2
EW_CAMPAIGN_CONFIRMED=1 scripts/ew-campaign.sh --execute --sequence 3
```

Each run writes `campaign-pending-seq{N}-{A,B,C1,C2,F}.json` and does **not**
delete other `seq*.json` files. Matched-block comparison uses sequence *k*
across trees that share *k*.

Default `npm run test:ew:performance` remains the historical 50 + 300 helper
and is **not** an acceptance campaign (`acceptanceEligible: false`).

## 5. Percentile, matched blocks, reporting

**Percentile:** nearest-rank `sorted[floor(n * p)]` on a **copy**. For n =
1,000: p50 = index 500, p95 = 950, p99 = 990. Same method as the historical
300-sample receipts (those used n = 300). Mean / stdev / min / max may be
printed as variability; they are not the gate.

**Matched-block comparison:** sequence *k* of C2 is compared only to sequence
*k* of A, B, C1, and F. Do not pair a later C2 block with an earlier B block.

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

## 6. Check 5 — forced GC placement (verify from code + receipts)

Forced GC in Chromium only exists if the process was launched with
`--js-flags=--expose-gc` **and** `typeof gc === 'function'`. Placement
relative to the measurement window is the whole question:

| Mode | How to run | Launch flag | Where `gc()` is called | Receipt fields to verify |
| --- | --- | --- | --- | --- |
| **Acceptance** | default / campaign execute (no `--diagnostics`) | `launch.extraArgs = []` (no expose-gc) | **never** | `gc.placement=none`, `exposeGcFlag=false`, all `called*=false`, `acceptanceEligible` can be true |
| **Diagnostics hygiene** | `--diagnostics` (defaults to `--gc-placement=between-blocks`) | `--js-flags=--expose-gc` | **Outside** the measured loop: after pass warm-up, before `for (i < passSamples)`; and again after that loop | `calledBeforeMeasuredWindow` / `calledAfterMeasuredWindow` true; `calledInsideMeasuredWindow` false; `acceptanceEligible=false` |
| **Diagnostics suppression** | `--diagnostics --gc-placement=inside-window` | `--js-flags=--expose-gc` | **Inside** the measured loop, after each sample (cleans the tail) | `calledInsideMeasuredWindow=true`; `acceptanceEligible=false`; **not the gate** |

Acceptance keeps naturally occurring GC. There is no collection between
measured acceptance samples. Hygiene GC between *campaign* tree runs is the
process exit between receipts (a new browser each run); optional in-process
hygiene is the between-blocks diagnostics path above, never mixed into
acceptance.

Grep anchors in `scripts/ew-frame-benchmark.mjs`:

- `launchExtraArgs = gcPlacement === 'none' ? [] : ['--js-flags=--expose-gc']`
- `if (gcPlacement === 'between-blocks') forceGc('calledBeforeMeasuredWindow');` immediately **before** the measured `for`
- `if (gcPlacement === 'inside-window') forceGc('calledInsideMeasuredWindow');` **inside** that `for`, after the timed clocks
- `if (gcPlacement === 'between-blocks') forceGc('calledAfterMeasuredWindow');` immediately **after** the measured `for`

## 7. Existing receipts (preserved)

Do not delete, rewrite, or relabel earlier families. They are not this
campaign.

| Family | What it is |
| --- | --- |
| `performance-*.json` | Platinum 8573C authority, failed 2.50 / 6.90 |
| `review-20260913-*.json` | 4-core supplementary |
| `fix-20260913-*.json` | correctness-gate timings |
| `passms-20260913-*.json` | superseded passMs-as-gate experiment |
| `authority-20260913-*.json` | restored original timer |
| `perf-followup-20260914-*.json` | 300-sample follow-up of `51738ca` on a supplementary host |

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

After written approval, a later run (not this PR), **one sequence at a time**:

```sh
EW_CAMPAIGN_CONFIRMED=1 scripts/ew-campaign.sh --execute --sequence 1 docs/ew/receipts
```

Until then the execute path refuses. Do not merge to main. Do not move
`ew-fable-candidate-20260913`. **Long campaign not started.**
