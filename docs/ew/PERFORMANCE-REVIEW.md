# EW performance release-gate review

Review branch: `cursor/ew-perf-gate-23f3` on top of `feat/electronic-warfare-review` (`75a721e`).
This machine is **not** the recorded Platinum 8573C reference runner. Absolute times here are quieter; the original failed receipts stay authoritative for that host.

## Trees measured

Same Playwright fixture (`scripts/ew-frame-benchmark.mjs --passes`): Earth, 20 NPCs, 18 stations, six projectiles. Serial runs. Pre-sensor commit `34c1827` is not in this repo; B/C plus commit-1 were used. Pre-sensor parent `6958f08` is available for tick-only A if needed.

| Tree | Tick p95 / p99 ms | Full-pass p95 / p99 ms | Seeker p95 / p99 ms | Full-pass vs 2 / 4 |
| --- | ---: | ---: | ---: | ---: |
| B sensors `e7aa3c5` | 1.20 / 1.50 | 1.30 / 1.70 | 0.10 / 0.20 | pass |
| C1 noise/ECCM `74caf83` | 1.40 / 1.60 | 1.70 / 2.10 | 0.10 / 0.10 | pass |
| C2 full EW tip (unfixed) | 1.60 / 2.20 | 1.90 / 2.20 | 0.30 / 0.30 | pass (run 1) |
| C2 unfixed, profiled rerun | 1.60 / 2.00 | **2.30 / 2.90** | 0.20 / 0.30 | **fail p95** |

Reference receipts (`docs/ew/receipts/performance-*.json`, Platinum 8573C, 8 logical CPUs, `hardwareConcurrency` 9):

| Tree | Tick p95 / p99 | Full-pass p95 / p99 | Seeker p95 / p99 | Gate |
| --- | ---: | ---: | ---: | ---: |
| Pre-sensor `34c1827` | 0.80 / 1.20 | n/a | n/a | tick baseline |
| Sensor-only | 2.00 / 2.90 | 2.20 / 8.80 | 0.10 / 1.10 | full-pass fail |
| EW final | 2.00 / 3.30 | 2.50 / 6.90 | 0.20 / 4.50 | full-pass fail |

This host: `Intel(R) Xeon(R) Processor`, 4 logical CPUs, `hardwareConcurrency` 4, Chromium 153.0.8010.12.

## Does noise/ECCM alone clear the 2 / 4 ms full-pass gate?

- **On this host:** yes. Commit-1 is 1.70 / 2.10 with six paid Fleet jammers and ordinary torpedoes. Incremental vs sensors is about +0.4 ms p95 on the full pass and +0.2 ms on whole-tick p95.
- **On the recorded reference host:** no, not as a unique EW failure. Sensor-only already misses the same 2 / 4 ms full-pass gate (2.20 / 8.80). Commit-1 was not separately timed there; the EW tip’s sensor-only slice was 2.30 / 5.30. Noise/ECCM should not be treated as the increment that broke a previously green full-pass gate.

Cumulative tick p95 (EW minus pre-sensor) remains the passing increment on the reference receipts (+1.20 ms vs 2 ms). This host has no `34c1827` tree, so that exact cumulative pair was not recreated.

## Seeker p99 root cause

Unfixed tip profile (`review-20260913-ew-tip-profile.json`):

- 300 seeker samples: 289 < 0.25 ms, 11 in 0.25–0.50 ms, **none ≥ 1 ms**
- **29 hits / 29 deaths** — every death is a physical impact (`newEffects === 1`), not range/lifetime expiry
- Every recorded “outlier” is a single-projectile hit frame
- Guidance/sampling itself stays on the 0.1–0.2 ms plateau

The expensive seeker frames are **segment hits** (`applyPointImpact` → sensor cue + damage + shield/burst effects), not collision-body rebuild or a large live-seeker count. Six seekers share one body list per `updateProjectiles`. They spawn 900 units north of the player and strike occupied Earth space (player / station / intervening hull) after a few hundred units.

That matches the reference shape (p50 0.1, p95 0.2, p99 4.5): typical frames are cheap; rare frames do impact work, and on the loaded Platinum runner those frames also pay GC from per-frame body/key/segment allocation. Sensor-only ordinary torpedoes on that runner already showed a 1.1 ms seeker p99; HOJ adds body rebuild, incarnation strings and impact FX on the same window.

## What changed

Targeted reuse only; no budget raise, no roster/price/slot/artwork change, no knowledge-boundary change.

- Reuse collision-body objects instead of allocating 39 new bodies each HOJ frame
- Cache incarnation key strings (invalidate on hull or system change)
- Reuse the HOJ actor `Map` and fill it only when a sample is due
- Reuse the live jammer signal scratch and the flight segment `from`/`to` objects; copy sample coordinates onto the shot so the stored point is never the live emitter
- Compact `state.projectiles` in place instead of `filter`
- Reuse the jammer-candidate list in the 5 Hz pass and skip `localeCompare` when there is 0–1 candidate
- Benchmark receipts now record seeker histogram, deaths, hits and hit-kind counters

## Gate after the fix

Filled in after functional suites and a post-fix timing pass. Original failed reference receipts are retained.
