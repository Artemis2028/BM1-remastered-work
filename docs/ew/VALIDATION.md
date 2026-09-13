# Electronic warfare validation

Base: `758665eef8cc001973529a23e9cd556aeb98c68e`. Two commits: paid noise/ECCM, then actual anti-emitter guidance and integration checks. No remote push was performed.

## Functional checks

| Suite | Result |
| --- | --- |
| EW math, energy and crew traces | 20/20 |
| Live EW, refit, persistence and touch controls | 33/33 |
| Seeker model, cadence and identity | 13/13 |
| Live seeker, all credit paths and store purchase | 33/33 |
| Existing behavior S1–S5 | 79/79 |
| Sensors model / live engine | 24/24 · 54/54 |
| Power model / live engine | 21/21 · 29/29 |
| Ship content / integration | 14/14 · 11/11 |
| Live ship economy / hull decisions / roster balance | 30/30 · 23/23 · 19/19 |
| In-game ship smoke / manifest synchronization | Passed |
| Node / Python release builders and module inventories | Passed |
| Syntax, whitespace and two-commit patch replay | Passed |

Live seeker tests exercise the engine's player, NPC, escort and station fire functions. They check 1,700-unit hits, rejection beyond 1,800, normal energy/cooldown, loss of emission, ballistic misses, reacquisition, recycled ID **and seed**, intervening victims, cloak survival, direct shared emission reports, private seeker observations, actual store charging and standing refusal. Emission acquisition has its own one-second timer even on a hull already visible to sensors.

EW fixtures include proportional electronics funding, capacity overflow, frame subdivision, restart timing, maximum-noise visual/checkpoint/radio preservation, capture/order clearing, legacy saves and deterministic outfitting. Four identical-hardware, 60-second crew energy traces are in `receipts/ship-ew-test.log`; different reserve behavior comes from decision policy, not hardware discounts.

## Reference performance

Gate status: **NOT PASSED — retain the raw failed timing gate for review; no budget increase was made**.

The reference configuration matches the sensor validation: Linux x64, Intel Xeon Platinum 8573C virtual CPU, 8 available logical CPUs, browser concurrency 9, Chromium 153.0.8010.0, 1280×850. Fresh serial A/B/C browser runs use Earth with 20 NPCs, 18 stations, the player and six simultaneous projectiles. EW equips six hosts with paid Fleet jammers across two sides; A/B retain those same hulls without modules. The EW receipts include SHA-256 hashes of measured production source files.

| Tree | Tick p95 ms | Tick p99 ms | Render p95 ms |
| --- | ---: | ---: | ---: |
| Pre-sensor `34c1827` | 0.80 | 1.20 | 2.10 |
| Sensor-only `758665e` | 2.00 | 2.90 | 1.50 |
| EW final source | 2.00 | 3.30 | 1.50 |

- Incremental tick p95, EW minus sensor-only: **0.00 ms**.
- Cumulative tick p95, EW minus pre-sensor: **1.20 ms**, against the **2 ms** limit.
- Full power/electronics + detection/scan pass: **2.50 ms p95 / 6.90 ms p99**, limits **2 / 4 ms**.
- Seeker execution, reported separately and included in whole-tick timings: **0.20 ms p95 / 4.50 ms p99**.
- Final pass: 39 actors, 1480 spatial contact candidates, 228 jammer candidates, 6 active paid jammers. The power-starved run is reported separately.

The 5 Hz pass has 10 seconds of warm-up and 300 measurements over 60 seconds. Whole-tick CPU uses 600 warm-up ticks and 3,600 measured ticks; it is CPU timing, not a claimed display frame rate. Full-pass timing conservatively includes all ship power updates as well as electronics, snapshots, sensing, sharing and scan advancement. The six seeker updates are separately timed because they run every frame, not only at the sensor cadence.

Earlier timing attempts exceeded the pass gate. The final implementation reuses per-frame collision bodies, reuses cached sensor profiles in power funding and removes repeated contact-array allocation. Prior failed EW timing receipts are retained. The unchanged sensor-only build also reported full-pass spikes on this shared runner; see its absolute timings rather than substituting the historical 0.7 ms sensor increment.

## Practical limits and review

Screenshots show wide and 1024×768 touch-viewport EW controls, actual own-fleet interference and module refit. The existing narrow-width top HUD cropping remains outside this change. **Actual iPad/Safari performance is unverified.** The external two-core sensor increment of 1.6 ms is not reproduced here and does not replace the recorded reference environment.

The torpedo's 9,000-latinum price versus the 60,000-latinum Fleet jammer remains a provisional playtest ratio. There is no automatic general NPC launcher rollout. Existing ship roster, artwork, standing, native hull stats and three-slot loadouts are preserved.

Recommended next reviewer: Claude, concentrating on power conservation, knowledge/identity boundaries, checkpoint compatibility and the timing receipts before pushing.

## Follow-up: seeker p99 and commit-1 vs HOJ (13 September 2026)

A later review on `cursor/ew-perf-gate-23f3` reproduced the fixture on a **different** host (4-core generic Xeon, `hardwareConcurrency` 4). That host is quieter than the Platinum 8573C reference above. **The reference receipts in this file and `receipts/performance-*.json` remain the authority for that runner; they are still a failed 2 / 4 ms full-pass gate. Thresholds were not raised.**

Full write-up: [PERFORMANCE-REVIEW.md](PERFORMANCE-REVIEW.md). Review receipts: `receipts/review-20260913-*.json`.

- Commit-1 (noise/ECCM, ordinary torpedoes) clears 2 / 4 **on the review host** (1.70 / 2.10). On the reference host, sensor-only already failed the same full-pass gate, so noise/ECCM is not the increment that broke a green gate.
- Seeker p99 is **not proven impact-only**. Earlier review-host deaths often coincided with a hit, but `authority-20260913-ew-tip.json` sample i:51 is **2.2 ms with no hit and no projectile death**. Typical frames stay 0.1–0.3 ms; the 2.2 ms cause remains unproven.
- Reuse of collision bodies, incarnation keys, the actor map, flight segments and the jammer-candidate list is in this follow-up. Acceptance suites stayed green (EW 20 + 32, seeker 13 + 33, sensors 24 + 54, power 21 + 29, behavior S1–S5).
- Post-fix review-host full-pass: **1.50 / 1.80** and **1.50 / 1.70** (two serial runs). That does **not** replace the reference 2.50 / 6.90 failure. HOJ stays on the EW review branch; do not merge to main from this follow-up.

## Follow-up: correctness + measurement names (13 September 2026)

Implemented on `cursor/ew-correctness-gate-1edb` from `0979e44`. Suites: **20 + 33 + 13 + 35 = 101** EW/seeker checks, sensors 24/24 · 54/54, power 21/21 · 29/29, behavior 79/79, ship suites green, both release builders include `ship-ew.mjs` / `ship-hoj.mjs`.

This host (4-core generic Xeon, concurrency 4, Chromium 153.0.8010.12) electronicsPass **1.50 / 1.90** and cumulative tick **+1.00 ms**. **Platinum 8573C reference verification is outstanding**; the recorded 2.50 / 6.90 failure is retained. Detection-only (1.30 / 1.60) is reported and was not substituted for the gate.

Receipts: `receipts/fix-20260913-*.json` and `receipts/fix-20260913-summary.json`. Those files gated **electronicsPass** (power+sensors wall-clock) and timed seekers as the full projectile update. Keep them; they are not the passMs series. Boundaries: `receipts/MEASUREMENT-BOUNDARIES.md`.

## Follow-up: passMs contract (13 September 2026)

Authoritative gate: **2 ms p95 / 4 ms p99 on passMs** — detection, interference, sharing, scan attributable to that pass, and due seeker sampling. `updateMs`, `electronicsPass` (power+sensors) and whole-frame tick are reported separately. Cumulative frame cost vs pre-sensor ≤ 2 ms p95. Pre-sensor sensor-pass metrics are **not applicable**, never zero.

Seeker sampling is accounted for in `passMs` explicitly (`sampleDueHojSeekers` + `sampleHojIfDue`) without counting the same read twice. Restoring the old `elapsedMs` assignment around `sensorWorld.pass()` would still miss it.

## Follow-up: restore the original full-workload 2/4 gate (13 September 2026)

The passMs-as-gate wording is **superseded**. The 2 / 4 ms gate is again the original externally measured full-workload timer (power+sensors wall-clock; Platinum `detectionPass` 2.50 / 6.90, **failed**). Thresholds were not raised. Detection-pass, `updateMs`, `electronicsPass` and whole-frame tick are reported separately. Increments: EW−sensors and EW−pre-sensor; cumulative tick vs pre-sensor ≤ 2 ms.

Platinum verification is **outstanding** on this VM. This host is supplementary. **Decision required before merge.** Do not merge to main.

This-host electronicsPass (300 samples, original timer): B 1.80 / 2.80 (pass), C1 **2.50 / 3.50 fail**, C2 **2.40 / 3.50 fail**. Pre-sensor series are null / not applicable. Tick increments: EW−sensors **+0.80 ms**, EW−pre-sensor **+1.70 ms** (cumulative limit 2 ms). Suites: **20 + 33 + 14 + 35 = 102** EW/seeker, sensors 24/24 · 54/54, power 21/21 · 29/29, behavior 79/79, both release builders.

Pinned harness sha256 `cbe314d8…`. Receipts: `receipts/authority-20260913-*.json`. The `passms-20260913-*` files stay labeled as the superseded experiment.
