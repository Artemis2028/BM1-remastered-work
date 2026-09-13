# EW timing receipt measurement boundaries

Keep every earlier receipt. This file labels what each family actually timed so later
reviews do not treat them as the same series.

Platinum 8573C remains the release authority. Two-core / 4-core runs are supplementary.

## Authoritative contract (this review)

The **2 ms p95 / 4 ms p99** gate is the **original externally measured
full-workload timer**: harness wall-clock of `updatePowerSystems(12)` +
`updateSensorSystems(12)` after the seeker window. Platinum recorded that
series as `detectionPass` at **2.50 / 6.90 (failed)**. Those thresholds were
not raised and that series was not redefined.

- Report **separately**: detection-pass (`elapsedMs` / `detectionMs`),
  `updateMs`, `electronicsPass` (the full-workload timer above), and
  whole-frame tick.
- Report both **EW−sensors** and **EW−pre-sensor**. Cumulative added frame
  cost vs pre-sensor stays **≤ 2 ms p95**.
- One pinned harness (`scripts/ew-frame-benchmark.mjs`) against all four
  pinned trees. Pre-sensor supplies the frame baseline and reports
  sensor-pass metrics as **not applicable**, never zero.
- Platinum is the release authority. If it is not available, mark it
  outstanding and treat this host as supplementary.
- If the unchanged 2/4 gate still fails (including the retained Platinum
  failure), **return the results for an explicit decision**. Do not merge
  to main.

The `passms-20260913-*` family gated a later `passMs` definition. Keep those
files; they are **not** a replacement for the original full-workload gate.

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

### `prior-attempt-performance-*.json`

- Earlier failed EW timing on Platinum. Same family as `performance-*.json`.
  Retained; do not substitute for later receipts.
