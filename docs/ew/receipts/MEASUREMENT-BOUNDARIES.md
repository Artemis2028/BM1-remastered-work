# EW timing receipt measurement boundaries

Keep every earlier receipt. This file labels what each family actually timed so later
reviews do not treat them as the same series.

Platinum 8573C remains the release authority. Two-core / 4-core runs are supplementary.

## Authoritative contract (this review)

Gate **2 ms p95 / 4 ms p99** applies to **passMs**: the complete 5 Hz sensing
workload — detection, interference, sharing, scan advancement attributable to
that pass, and due seeker sampling.

- Do **not** gate on whichever value currently occupies `elapsedMs`.
- Do **not** gate on `electronicsPass`.
- Report `updateMs`, `electronicsPass`, and whole-frame tick separately.
- Cumulative added **frame** cost vs the pre-sensor baseline is ≤ 2 ms p95.
- Projectile movement, collision, damage and FX stay in whole-frame measurements
  and are **not** part of `passMs`.
- One pinned harness (`scripts/ew-frame-benchmark.mjs`) against all four pinned
  trees. Pre-sensor supplies the frame baseline and reports sensor-pass metrics
  as **not applicable**, never zero.
- Seeker sampling runs through the projectile path. Restoring an old
  `elapsedMs` assignment around `sensorWorld.pass()` does **not** include it.
  Account for due samples in `passMs` explicitly without counting that work
  twice (`sampleHojIfDue` advances `sampleDue` before flight).

Pinned trees:

| Label | Ref | Role |
| --- | --- | --- |
| A | `6958f08e73aff55efbf48bae3f9433e5acc270e8` | Pre-sensor / OPS. Frame baseline. Sensor-pass series N/A. |
| B | `e7aa3c594e4799c54d48e2eeac37a2a1acf36b9b` | Sensors. Ordinary torpedoes. |
| C1 | `74caf837c7882a86e3bd7c74f083029453953c1a` | Paid noise/ECCM. Ordinary torpedoes. |
| C2 | review-branch tip | Full EW + HOJ. |

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
- **Not** the authoritative passMs gate. Keep the file; do not treat the
  electronicsPass pass/fail as the new contract.

### `passms-20260913-*.json` — corrected passMs contract

- One pinned tip harness against A / B / C1 / C2.
- Production order: power → sensors → due seeker sample → projectile flight.
- **Gate = harness `passMs`** (updateSensorSystems + due seeker sampling).
- `electronicsPass`, `updateMs`, seeker-sample slice, post-sample projectile
  slice, and whole-frame tick are reported separately.
- Pre-sensor `--passes` writes **not applicable** (null samples / percentiles),
  never zeros, for sensor-pass series.
- JSON includes source hashes, harness hash, environment, workload, sample
  counts and the timing objects above.
- This host is supplementary unless the CPU string is Platinum 8573C.

### `prior-attempt-performance-*.json`

- Earlier failed EW timing on Platinum. Same family as `performance-*.json`.
  Retained; do not substitute for later receipts.
