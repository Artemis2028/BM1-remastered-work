# EW performance release-gate review

Review branch: `cursor/ew-perf-gate-23f3` on top of `feat/electronic-warfare-review` (`75a721e`).
This machine is **not** the recorded Platinum 8573C reference runner. Absolute times here are quieter; the original failed receipts stay authoritative for that host. Thresholds were not raised.

## Trees measured

Same Playwright fixture (`scripts/ew-frame-benchmark.mjs --passes`): Earth, 20 NPCs, 18 stations, six projectiles. Serial runs. Pre-sensor `34c1827` is not in this repo. Tick-only A used parent `6958f08` (OPS, immediately before sensors `e7aa3c5`).

### This host — unfixed trees

`Intel(R) Xeon(R) Processor`, 4 logical CPUs, `hardwareConcurrency` 4, Chromium 153.0.8010.12.

| Tree | Tick p95 / p99 ms | Full-pass p95 / p99 ms | Seeker p95 / p99 ms | Full-pass vs 2 / 4 |
| --- | ---: | ---: | ---: | ---: |
| A pre-sensor `6958f08` (tick only) | 0.60 / 0.70 | n/a | n/a | n/a |
| B sensors `e7aa3c5` | 1.20 / 1.50 | 1.30 / 1.70 | 0.10 / 0.20 | pass |
| C1 noise/ECCM `74caf83` | 1.40 / 1.60 | 1.70 / 2.10 | 0.10 / 0.10 | pass |
| C2 full EW tip (unfixed) | 1.60 / 2.20 | 1.90 / 2.20 | 0.30 / 0.30 | pass (run 1) |
| C2 unfixed, profiled rerun | 1.60 / 2.00 | **2.30 / 2.90** | 0.20 / 0.30 | **fail p95** |

Cumulative tick p95 on this host, unfixed EW minus `6958f08`: **1.00 ms** (limit 2 ms).

### This host — after reuse (two serial runs)

| Run | Tick p95 / p99 | Full-pass p95 / p99 | Seeker p95 / p99 | Gate |
| --- | ---: | ---: | ---: | ---: |
| postfix-1 | 1.50 / 2.00 | 1.50 / 1.80 | 0.20 / 0.30 | pass |
| postfix-2 | 1.50 / 1.90 | 1.50 / 1.70 | 0.20 / 0.30 | pass |

### Recorded Platinum 8573C reference (not re-run here)

8 logical CPUs, `hardwareConcurrency` 9. Receipts: `performance-*.json`.

| Tree | Tick p95 / p99 | Full-pass p95 / p99 | Seeker p95 / p99 | Gate |
| --- | ---: | ---: | ---: | ---: |
| Pre-sensor `34c1827` | 0.80 / 1.20 | n/a | n/a | tick baseline |
| Sensor-only | 2.00 / 2.90 | 2.20 / 8.80 | 0.10 / 1.10 | full-pass fail |
| EW final | 2.00 / 3.30 | 2.50 / 6.90 | 0.20 / 4.50 | full-pass fail |

Cumulative tick p95, EW minus pre-sensor: **+1.20 ms** (limit 2 ms) — already passing on the reference receipts.

## Does noise/ECCM alone clear the 2 / 4 ms full-pass gate?

- **On this host:** yes. Commit-1 is 1.70 / 2.10 with six paid Fleet jammers and ordinary torpedoes. Incremental vs sensors is about +0.4 ms p95 on the full pass and +0.2 ms on whole-tick p95.
- **On the recorded reference host:** no, not as a unique EW failure. Sensor-only already misses the same 2 / 4 ms full-pass gate (2.20 / 8.80). Commit-1 was not separately timed there; the EW tip’s sensor-only slice was 2.30 / 5.30. Noise/ECCM should not be treated as the increment that broke a previously green full-pass gate.

HOJ stays on the EW review branch. This follow-up does not merge to main.

## Seeker p99 root cause

Unfixed profile (`review-20260913-ew-tip-profile.json`) and post-fix runs agree on the shape:

- 300 seeker samples: almost all < 0.25 ms; a handful in 0.25–0.50 ms; **none ≥ 1 ms on this host**
- **29 hits / 29 deaths** every time — every death is a physical impact (`newEffects === 1`), not range/lifetime expiry
- Hit kinds after the reuse patch: **19 ships, 10 stations, 0 player**
- Every recorded slow frame is a single-projectile hit; guidance/sampling stays on the 0.1–0.2 ms plateau

The expensive seeker frames are **segment hits** (`pointImpact` → `applyPointImpact` → sensor cue + NPC/station damage + burst/shield FX), not collision-body rebuild or a large live-seeker count. Six seekers share one body list per `updateProjectiles`. They spawn 900 units north of the player and strike occupied Earth space (intervening hulls and stations) after a few hundred units. That is accepted HOJ behavior: the flight uses physical bodies on the path, including intervening ships.

That matches the reference shape (p50 0.1, p95 0.2, p99 4.5): typical frames are cheap; rare frames do impact work, and on the loaded Platinum runner those frames also pay GC from per-frame body/key/segment allocation. Sensor-only ordinary torpedoes on that runner already showed a 1.1 ms seeker p99; HOJ adds body rebuild, incarnation strings and impact FX on the same window.

Discarded hunches: “many live seekers” (the fixture holds six, and miss frames stay cheap), “collision-body rebuild is the 4.5 ms of work” (rebuild happens every frame; only hit frames rise), “player HUD `updateStats`” (zero player hits).

The reuse patch does not remove those 29 hits and does not make impact processing free. On this host seeker p99 stayed 0.30 ms. The intended win is less garbage on the hit frames that spike to 4.5 ms on the reference runner. **That 4.5 ms figure was not reproduced here and is not claimed green.**

## What changed

Targeted reuse only; no budget raise, no roster/price/slot/artwork change, no knowledge-boundary change.

- Reuse collision-body objects instead of allocating 39 new bodies each HOJ frame
- Cache incarnation key strings (invalidate on hull or system change)
- Reuse the HOJ actor `Map` and fill it only when a sample is due
- Reuse the live jammer signal scratch and the flight segment `from`/`to` objects; copy sample coordinates onto the shot so the stored point is never the live emitter
- Compact `state.projectiles` in place instead of `filter`
- Reuse the jammer-candidate list in the 5 Hz pass and skip `localeCompare` when there is 0–1 candidate
- Benchmark receipts now record seeker histogram, deaths, hits and hit-kind counters (after the timed sections)

## Functional suites after the change

| Suite | Result |
| --- | --- |
| `test:ew` | 20/20 |
| `test:ew:ingame` | 32/32 |
| `test:ew:seeker` | 13/13 |
| `test:ew:seeker:ingame` | 33/33 |
| `test:sensors` / `test:sensors:ingame` | 24/24 · 54/54 |
| `test:power` / `test:power:ingame` | 21/21 · 29/29 |
| `probe` (S1–S5) | passed |

## Gate verdict

- **This host, post-fix:** full-pass **passes** in two serial runs (1.50 / 1.80 and 1.50 / 1.70). Unfixed full EW was flaky here (one pass at 1.90 / 2.20, one fail at 2.30 / 2.90).
- **Reference Platinum host:** still **not passed** at 2.50 / 6.90. Those receipts are kept. This review did not re-measure that machine.
- **Noise/ECCM can land before HOJ** from a *unique full-pass regress* standpoint (sensors already owned the red gate on the reference runner; commit-1 is green here). HOJ seeker p99 on the reference runner is impact+GC; reuse is a reasonable attempt, not a proven clear on that host.
- Do not merge to main from this follow-up.

## Follow-up: correctness + named timing (13 September 2026)

Branch `cursor/ew-correctness-gate-1edb` on the same host class (4-core generic Xeon, `hardwareConcurrency` 4, Chromium 153.0.8010.12, 1280×850). **Still not the Platinum 8573C reference.** Thresholds were not raised. Prior Platinum `performance-*.json` receipts stay failed and authoritative for that runner.

Identical harness boundaries on all trees: `electronicsPass` is power+sensors wall-clock (the 2 / 4 ms gate); `elapsedMs` / `passMs` is the detection pass only; `updateMs` is the complete sensor update. Older trees still overwrite `elapsedMs` in-engine; the harness wall-clock is the comparable series.

| Tree | Tick p95 / p99 | electronicsPass p95 / p99 | Detection-only p95 / p99 | Seeker p95 / p99 | Gate 2 / 4 |
| --- | ---: | ---: | ---: | ---: | ---: |
| A pre-sensor `6958f08` | 0.40 / 0.50 | n/a | n/a | n/a | tick baseline |
| B sensors `e7aa3c5` | 1.20 / 1.30 | 1.00 / 1.20 | 0.90 / 1.00 | 0.10 / 0.10 | pass |
| C1 noise/ECCM `74caf83` | 1.30 / 1.60 | 1.20 / 2.00 | 1.00 / 1.80 | 0.10 / 0.10 | pass |
| C2 this tip | 1.40 / 1.80 | **1.50 / 1.90** | 1.30 / 1.60 | 0.20 / 0.30 | **pass on this host** |
| Reference EW (Platinum, kept) | 2.00 / 3.30 | 2.50 / 6.90 | n/a | 0.20 / 4.50 | **fail — not re-run** |

Cumulative tick p95, C2 minus A: **1.00 ms** (limit 2 ms) on this host. Detection-only on C2 is 1.30 / 1.60; it was **not** used as the gate.

Functional count after the two seeker fixtures and the command-hull warning: EW 20 + 33, seeker 13 + 35 (**101**). Sensors 24 + 54, power 21 + 29, behavior 79/79, both release builders. Raw receipts: `receipts/fix-20260913-*.json`. **Those receipts gated `electronicsPass` and are retained with that boundary labeled** in `receipts/MEASUREMENT-BOUNDARIES.md`. They are not the passMs authority.

## Follow-up: passMs gate (authoritative timing paragraph)

The 2 ms p95 / 4 ms p99 gate applies to **passMs**: the complete 5 Hz sensing workload, including detection, interference, sharing, scan advancement attributable to that pass, and due seeker sampling. Do not gate merely on whichever value currently occupies `elapsedMs`.

Report `updateMs`, `electronicsPass`, and whole-frame timing separately. Judge cumulative added frame cost against the pre-sensor baseline at ≤2 ms p95. Projectile movement, collision, damage and FX remain included in whole-frame measurements.

One pinned harness (`scripts/ew-frame-benchmark.mjs`) against all four pinned trees. Pre-sensor supplies the frame baseline and reports sensor-pass metrics as **not applicable**, never zero. Platinum remains the release authority; this two-core / 4-core run is supplementary.

Seeker sampling still runs through the projectile path. `sampleDueHojSeekers` / `sampleHojIfDue` add due samples to `passMs` once; `stepHojFlight` will not read the same sample again.

Rerun: `scripts/ew-four-tree.sh`. Receipts: `receipts/passms-20260913-*.json` (filled after the pinned rerun). Exact review-branch commit and a format-patch / bundle ship with that rerun. Still do not merge to main.
