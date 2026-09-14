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

## 3. One pinned harness

File: `scripts/ew-frame-benchmark.mjs` (helpers: `scripts/ew-bench-lib.mjs`).
The same files time every tree via `--root`; trees are detached worktrees of
the SHAs above. C2 is always `51738ca`, not the protocol-branch HEAD.

Every receipt records:

- measured commit SHA, git tree SHA, source file SHA-256 (`main.js`,
  `ship-sensors.mjs`, `ship-ew.mjs`, `ship-hoj.mjs` when present)
- harness SHA-256 and helper SHA-256
- browser version, complete Chromium launch arguments (`spawnargs`), viewport
- CPU model, logical CPU count, `hardwareConcurrency`
- full process argv and workload counts actually used

Viewport remains **1280×850**. Fixture remains Earth, 20 NPCs, 18 stations, six
projectiles; EW trees mount the six paid Fleet jammers. Order stays
`updateProjectiles(1)` → `updatePowerSystems(12)` → `updateSensorSystems(12)`.

`--profile` stays a separate, labelled instrumentation run and is **not** the
gate.

## 4. Samples, warm-up, planned campaign size

Harness capability (implemented, not yet executed at campaign size):

- Individual sample timings, timestamps, and workload counters for each
  measured pass (`electronicsPass`, detection, `updateMs`, projectile window,
  observers/actors/pairs/jammerPairs, live projectiles, deaths/hits).
- Whole-frame tick samples kept in original order (percentile uses a copy).
- `--pass-samples` / `--pass-warmup` / `--tick-samples` / `--tick-warmup` for
  the campaign counts below. Default `npm run test:ew:performance` remains the
  historical 50 + 300 helper and is **not** an acceptance campaign.

Specified beforehand and **not started** in this PR:

| Item | Value |
| --- | ---: |
| Pass warm-up | 50 passes (200 ms cadence; ~10 s) |
| Measured passes per sensor/EW run | **≥ 1,000** (plan uses 1,000) |
| Tick warm-up / measured | 600 / 3,600 (unchanged) |
| Sequence order | A → B → C1 → C2 → F |
| Serial interleaved repetitions | **3** |
| Browser | one process per run; exit between runs |

A receipt is `acceptanceEligible` only at these campaign counts, unprofiled,
without `--diagnostics` or `--starved`. Short helper runs stay labelled as
such.

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
3. Report variability across the three C2 blocks (range of p95 / p99). That
   is context, not a substitute gate.
4. **No best-run selection.** A green block does not retire a red block.
5. **No median delta substituted for the absolute gate.** A small typical
   increment does not pass a run whose absolute `electronicsPass` is 3.70 /
   9.20.
6. The campaign fails the electronics gate if **any** listed C2 acceptance
   run fails 2 / 4. The summary also prints the worst absolute p95 / p99.
7. Platinum 2.50 / 6.90 remains failed release authority until a Platinum
   campaign using this protocol says otherwise. Supplementary hosts say so.

`scripts/ew-bench-report.mjs` implements those rules after receipts exist.

## 6. GC and diagnostics

Naturally occurring GC **stays inside** acceptance measurements. Acceptance
runs do not force a collection between measured samples to clean the tail.

Forced-GC and tracing exist only behind `--diagnostics`. Those receipts are
labelled `diagnostics: true` and `acceptanceEligible: false`. They are not
the gate.

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

After written approval, a later run (not this PR):

```sh
EW_CAMPAIGN_CONFIRMED=1 scripts/ew-campaign.sh --execute docs/ew/receipts
```

Until then the execute path refuses. Do not merge to main. Do not move
`ew-fable-candidate-20260913`.
