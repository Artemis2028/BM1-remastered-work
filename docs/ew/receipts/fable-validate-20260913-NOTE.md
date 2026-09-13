# Fable-candidate validation (follow-up only)

Validates frozen tag `ew-fable-candidate-20260913` / commit `077a9ce`.
This note and the `fable-validate-20260913-*` receipts live on
`cursor/ew-fable-validate-1edb`. They do **not** move the tag.

Harness sha256 `e79876004ea9b8846ed6f31ca040fc1ff2452db43f77ba744837d9fb6b8b115d`.
This host is supplementary (generic 4-core Xeon, Chromium 153.0.8010.12).
Platinum 8573C 2.50 / 6.90 remains outstanding.

## Suites

EW 20/20 · 33/33, seeker 14/14 · 38/38 (**105**), sensors 24/24 · 54/54,
power 21/21 · 29/29, behavior 79/79, ships 14 · 11 · smoke · 30 · 23 · 19,
both release builders.

## Unprofiled four-tree (`electronicsPass` 2/4)

| Tree | Tick p95 / p99 | electronicsPass | Detection-pass | updateMs | Seeker |
| --- | ---: | ---: | ---: | ---: | ---: |
| A `6958f08` | 0.80 / 0.90 | n/a | n/a | n/a | n/a |
| B `e7aa3c5` | 1.60 / 2.30 | 1.80 / 2.40 pass | 1.50 / 2.20 | n/a | 0.10 / 0.10 |
| C1 `74caf83` | 2.00 / 2.90 | **2.20 / 3.60 fail** | 2.00 / 3.30 | n/a | 0.10 / 0.10 |
| C2 `077a9ce` | 1.60 / 2.20 | **2.80 / 7.20 fail** | 2.40 / 6.10 | 2.40 / 6.10 | 0.20 / 0.30 |

Increments: EW−sensors tick **+0.00**, EW−pre-sensor tick **+0.80** (limit 2).
electronicsPass EW−sensors **+1.00**. Thresholds not raised.

Profiled C2 (not the gate): detect 1.1 / share 0.8 / fund 0.3 / snapshot 0.2 / scan 0.
The 2.2 ms seeker sample with no hit/death remains unproven.

**Decision required. Do not merge to main.**
