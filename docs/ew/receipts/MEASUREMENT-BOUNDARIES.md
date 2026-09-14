# EW timing receipt measurement boundaries

Keep every earlier receipt. This file labels what each family actually timed so later
reviews do not treat them as the same series.

## Current 51738ca Platinum evidence

**Current Platinum evidence for measured tree `51738ca`** is Astra’s rerun
family: C2 `electronicsPass` **3.70 / 9.20** and **2.00 / 4.30**, both
failures. The sensor baseline also failed p99; cumulative frame increments
passed. That is the current-facing Platinum citation.

Historical receipts stay on disk and keep their original numbers:

- `performance-*.json` Platinum 8573C **2.50 / 6.90 failed** — older EW tip,
  not `51738ca`.
- `perf-followup-20260914-*.json` supplementary C2 **1.60 / 2.20 pass** —
  quieter host, 300 samples, not current Platinum.

Do not cite those historical numbers as the current `51738ca` result.

## Authoritative contract (this review)

The **2 ms p95 / 4 ms p99** gate is the **original externally measured
full-workload timer**: harness wall-clock of `updatePowerSystems(12)` +
`updateSensorSystems(12)` after the seeker window. Historical Platinum
`performance-*.json` recorded that series as `detectionPass` at 2.50 / 6.90
on an older tip. Those thresholds were not raised and that series was not
redefined. Current `51738ca` Platinum evidence is the Astra rerun above.

- Report **separately** (p95 **and** p99): detection-pass (`elapsedMs` /
  `detectionMs`), `updateMs`, `electronicsPass` (the full-workload timer
  above), projectile / seekerCPU, and whole-frame tick.
- Report both **EW−sensors** and **EW−pre-sensor**. Cumulative added frame
  cost vs pre-sensor stays **≤ 2 ms p95**. Campaign summaries print an
  explicit campaign-level cumulative-frame verdict.
- Percentile convention: nearest-rank `sorted[floor(n * p)]` on a **copy**
  (n = 1000 → indices 500 / 950 / 990). Timer is `performance.now()`;
  receipts commonly show ~0.1 ms Chromium quantization.
- One pinned harness (`scripts/ew-frame-benchmark.mjs`) against all four
  pinned trees. Pre-sensor supplies the frame baseline and reports
  sensor-pass metrics as **not applicable**, never zero.
- Playwright may inject Chromium flags that appear in `launch.recordedArgv`
  but not in `launch.extraArgs` (preload-injected). Acceptance extraArgs
  remain `[]`. Prefer the `/proc` chrome process **without `--type=`**.
- If the unchanged 2/4 gate still fails (Astra’s `51738ca` Platinum rerun
  already failed twice), **return the results for an explicit decision**.
  Do not merge to main.

The `passms-20260913-*` family gated a later `passMs` definition. Keep those
files; they are **not** a replacement for the original full-workload gate.

Pinned trees:

| Label | Ref | Role |
| --- | --- | --- |
| A | `6958f08e73aff55efbf48bae3f9433e5acc270e8` | Pre-sensor / OPS. Frame baseline. Sensor-pass series N/A. |
| B | `e7aa3c594e4799c54d48e2eeac37a2a1acf36b9b` | Sensors. Ordinary torpedoes. |
| C1 | `74caf837c7882a86e3bd7c74f083029453953c1a` | Paid noise/ECCM. Ordinary torpedoes. |
| C2 | `51738caf3a1d88492c4fc48a7c0125d4a7e2a355` | Full EW + HOJ. |

Rerun: `scripts/ew-four-tree.sh`. Commands and hashes are copied next to the raw JSON.

## Receipt families

### `performance-*.json` — Platinum 8573C (release authority, failed)

- Host: Intel Xeon Platinum 8573C, 8 logical CPUs, `hardwareConcurrency` 9.
- Harness then timed **projectiles, then power+sensors**.
- The JSON field `detectionPass` was the **power+sensors wall-clock** (today’s
  `electronicsPass`), not engine `elapsedMs` and not seeker-inclusive `passMs`.
- Engine `elapsedMs` was overwritten by later scan work on those trees; the
  receipts still published that last assignment alongside the harness clock.
- `seekerCPU` was the full `updateProjectiles` window (guidance **and**
  movement / collision / damage / FX).
- Full-pass 2.50 / 6.90 failed the 2 / 4 ms numbers they applied to that
  power+sensors series. **Do not relabel this as a passMs pass or fail.**

### `review-20260913-*.json` — 4-core reuse follow-up

- Same harness boundaries as the Platinum run (projectiles then power+sensors;
  gated series = power+sensors wall-clock named `detectionPass` / later
  discussed as full-pass).
- Supplementary host, not Platinum. Thresholds were not raised.

### `fix-20260913-*.json` — first correctness-gate timing attempt

- Harness still ran **projectiles, then power+sensors**.
- **Gated `electronicsPass`** (power+sensors wall-clock) at 2 / 4 ms.
- Engine `elapsedMs` / `passMs` were **detection+sharing only** after the
  overwrite fix; they were reported and **were not** the intended complete
  5 Hz workload (scan-on-pass and due seeker sampling were outside that
  assignment).
- `seekerCPU` was still the full `updateProjectiles` window.
- Pre-sensor used `--passes` and the old harness **threw** rather than
  emitting N/A; the saved `fix-20260913-presensor.json` is tick-only from a
  run without the later N/A contract.
- Keep the file. The later passMs-as-gate experiment is not a replacement
  for this series; the restored authority is `electronicsPass` / Platinum
  `detectionPass`.

### `passms-20260913-*.json` — superseded passMs-as-gate experiment

- Gated a newly defined `passMs` (sensors + due seeker sampling) at 2 / 4.
- That **redefined the gate** and is **not** the authority. Keep the files
  so the experiment is auditable.

### `authority-20260913-*.json` — restored original full-workload timer

- One pinned tip harness against A / B / C1 / C2.
- Same order as Platinum: projectiles, then power+sensors.
- **Gate = `electronicsPass`** (power+sensors wall-clock). Same series as
  Platinum `detectionPass` 2.50 / 6.90. Thresholds not raised.
- Detection-pass, `updateMs`, seekerCPU (full `updateProjectiles`) and
  whole-frame tick are reported separately and are not substitute gates.
- Increments: EW−sensors and EW−pre-sensor. Cumulative tick vs A ≤ 2 ms.
- Pre-sensor `--passes` writes **not applicable** (nulls), never zeros.
- JSON includes source hashes, harness hash, environment, workload, sample
  counts and the timing objects above.
- This host is supplementary unless the CPU string is Platinum 8573C.
- If the unchanged 2/4 gate still fails (Platinum already failed), return
  for an explicit decision. Do not merge to main.

Optional `--profile` on the same harness records funding, snapshot,
detection, sharing and scan slices. That run is **not** the gate; keep it
separate so instrumentation overhead is visible.

SeekerCPU remains the full `updateProjectiles` window. A 2.2 ms sample
with no hit and no projectile death (`authority-20260913-ew-tip.json`
i:51) means the expensive-frame cause is **unproven** — do not label it
impact-only.

### `perf-followup-20260914-*.json` — detection/sharing follow-up (not the freeze)

- Branch `cursor/ew-perf-followup-8de2` from frozen `077a9ce`. Tag
  `ew-fable-candidate-20260913` was **not** moved.
- Same pinned harness (`e7987600…`) and original `electronicsPass` 2/4 gate.
- Unprofiled four-tree plus a **separate** profiled C2 run. Do not substitute
  the profiled file for the gate.
- This host (supplementary Xeon, not Platinum): C2 electronicsPass **1.60 / 2.20
  pass**. Cumulative tick vs pre-sensor **+0.90 ms**. **Historical quieter-host
  evidence**, not current Platinum for `51738ca`. Older Platinum 2.50 / 6.90
  (`performance-*.json`) is a different tip and did not measure `077a9ce`.
- Keep every receipt, including the profiled file.

### `prior-attempt-performance-*.json`

- Earlier failed EW timing on Platinum. Same family as `performance-*.json`.
  Retained; do not substitute for later receipts.

### Long-campaign protocol (not yet executed)

See `docs/ew/BENCHMARK-PROTOCOL.md`. Status: **awaiting independent protocol
review — long campaign not started.** Historical tag
`ew-fable-protocol-20260914` stays at `e556a380`. Prior freezes
`ew-fable-protocol-20260914-r2` (`6d4c01d`) and
`ew-fable-protocol-20260914-r3` (`c0b42b0`) and `ew-fable-protocol-20260914-r4`
(`70f47cc`) stay put. Current freeze
`ew-fable-protocol-20260914-r5`.

- **Unchanged** means measurement boundaries and thresholds (electronicsPass
  2/4, cumulative tick ≤2 ms vs A), not the entire harness file. A **new
  harness hash is expected**. Old helper preserved as
  `receipts/harness-e02235c.mjs` (`e7987600…`).
- Forced GC is **not** used on acceptance, including not between blocks.
  `--diagnostics` only, labelled, not the gate. `forcedGcThisRun` is derived
  from actual `gc()` calls.
- Finite campaign: **3** sequences, order **A→B→C1→C2**. 1000 × 200 ms =
  3 min 20 s per sensor-bearing tree; three trees × three sequences ≈ **30
  min** of timed sensor passes, plus A ticks / setup. Optional F and
  diagnostics add time. Resume: skip only complete valid receipts matching
  expected tree/hashes/sequence/config; never reroll a valid gate failure;
  stop on malformed/incomplete/mismatch. Reuse clean worktrees at the
  expected SHA; stop on dirty/unexpected without deleting. C2 stays
  `51738ca`. Freeze tag stays at `077a9ce`.
- Every run reports absolute p95/p99 (including detection, updateMs,
  projectile) and both increments. Campaign-level cumulative-frame verdict
  is required. No best-run selection; no median delta as the gate. Missing
  or invalid runs cannot yield an overall pass.
- Current Platinum evidence for `51738ca`: Astra C2 3.70 / 9.20 and
  2.00 / 4.30 (both failures). Earlier receipt families above remain the
  historical record (old harness hash). They are not this campaign.
