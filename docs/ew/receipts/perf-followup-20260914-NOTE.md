# EW performance follow-up (does not move the Fable freeze)

**Freeze still:** tag `ew-fable-candidate-20260913` @ `077a9cedaa5a6cb858b200addb115d862ab238e6`.
This branch is a separate follow-up. It does not retag, force-push, or edit that tip.
PR #6 and the frozen candidate stay unchanged. Do not merge to main.

Implementation: `51738caf3a1d88492c4fc48a7c0125d4a7e2a355` on `cursor/ew-perf-followup-8de2` (PR #9).
Pinned harness sha256 `e79876004ea9b8846ed6f31ca040fc1ff2452db43f77ba744837d9fb6b8b115d` (unchanged).

## Why this change (profile first)

Pinned-harness `--profile` on the frozen tip (validate receipts, not the gate)
split `electronicsPass` as detect 1.1 / share 0.8 / fund 0.3 / snapshot 0.2 / scan 0.
Detection + sharing dominate. The existing 2400-unit bucket grid is already in
place; the Earth fixture still examines 1480 pairs / 228 jammer pairs, so this
follow-up did **not** redesign the grid.

After this tip, a **separate** profiled C2 run (not the gate) measured:

| Slice | p95 ms |
| --- | ---: |
| detectMs | 0.6 |
| shareMs | 0.8 |
| fundMs | 0.2 |
| snapshotMs | 0.2 |
| scanMs | 0 |
| jamSetupMs | 0.1 |

Profiled electronicsPass was 1.70 / 3.00. Unprofiled C2 (the gate) was 1.60 / 2.20.
Keep those runs separate; instrumentation overhead is visible.

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

## Unprofiled four-tree (gate)

This host is supplementary (generic Xeon, 4 logical CPUs, concurrency 4,
Chromium 153.0.8010.12, 1280×850). **Platinum 8573C verification is outstanding.**
The historical Platinum 2.50 / 6.90 failure did **not** measure `077a9ce`.

| Tree | Tick p95 / p99 | electronicsPass | Detection-pass | updateMs | Seeker |
| --- | ---: | ---: | ---: | ---: | ---: |
| A `6958f08` | 0.40 / 0.50 | n/a | n/a | n/a | n/a |
| B `e7aa3c5` | 1.20 / 1.40 | 1.30 / 1.80 pass | 1.10 / 1.50 | n/a | 0.10 / 0.10 |
| C1 `74caf83` | 1.40 / 1.60 | 1.70 / 2.40 pass | 1.50 / 2.20 | n/a | 0.10 / 0.10 |
| C2 `51738ca` | 1.30 / 1.50 | **1.60 / 2.20 pass** | 1.40 / 2.10 | 1.40 / 2.10 | 0.20 / 0.20 |

Increments: EW−sensors tick **+0.10**, EW−pre-sensor tick **+0.90** (limit 2).
electronicsPass EW−sensors **+0.30**. All four-tree receipts kept, including the
profiled file. Four-tree harness exit 0.

## Suites (actual counts, no failures)

EW 20/20 · 33/33, seeker 14/14 · 38/38 = **105/105**. Sensors **26/26** · 54/54
(two new model locks: first-peer donor, comms 2400 edge). Power 21/21 · 29/29.
Behavior 79/79. Ships 14 · 11 · smoke · 30 · 23 · 19. Both release builders;
`ship-ew.mjs` and `ship-hoj.mjs` present in `dist` and `dist-chrome-extension`.

## Decision

This supplementary host **passes** the unchanged 2/4 gate. Platinum remains
**outstanding** (recorded fail 2.50/6.90, different tip). **Do not merge to
main. Do not move the freeze tag.** Return for an explicit decision on landing
this follow-up after Fable and on whether Platinum must re-run.
