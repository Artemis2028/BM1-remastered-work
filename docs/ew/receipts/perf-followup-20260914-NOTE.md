# EW performance follow-up (does not move the Fable freeze)

**Freeze still:** tag `ew-fable-candidate-20260913` @ `077a9cedaa5a6cb858b200addb115d862ab238e6`.
This branch is a separate follow-up. It does not retag, force-push, or edit that tip.
PR #6 and the frozen candidate stay unchanged. Do not merge to main.

## Why this change (profile first)

Pinned-harness `--profile` on the frozen tip (validate receipts, not the gate)
split `electronicsPass` as:

| Slice | p95 ms |
| --- | ---: |
| detectMs | 1.1 |
| shareMs | 0.8 |
| fundMs | 0.3 |
| snapshotMs | 0.2 |
| scanMs | 0 |

Detection + sharing dominate. The existing 2400-unit bucket grid is already in
place; the Earth fixture still examines most nearby pairs, so this follow-up
does **not** redesign the grid. It cuts per-pair work and sharing scan cost.

## What changed

In `SensorWorld.pass` only (same detection rules, same first-peer share, no relay):

- Reuse pass scratch maps/arrays instead of allocating them every 5 Hz pass
- One actor walk for extrema, jammer list, numeric cell keys, and `byKey`
- Squared-range compares in the pair loop (`hypot` was not required)
- Do not `record()` a contact for a miss or a cloaked never-seen target
  (those ghosts were created and then deleted every pass)
- Collect hit cues during the existing observer map walk
- Share the first peer report by walking each peer’s direct map in actor order
  instead of scanning every actor for every observer

Gates are unchanged: `electronicsPass` ≤2 ms p95 / ≤4 ms p99; cumulative tick
≤2 ms p95 vs pre-sensor. Thresholds were not recalibrated.

## Still required after this note

Unprofiled four-tree on the pinned harness, a separate profiled C2 run, full
suite counts, source/harness hashes, and an explicit Platinum outstanding mark.
If the unchanged 2/4 gate still fails, return the receipts for a decision.
Do not greenwash or merge.
