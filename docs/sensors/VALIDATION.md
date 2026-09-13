# Sensor patch validation

Base: `34c1827abe059b43951f62354968a2c6bccce621`.

## Automated results

| Check | Result |
| --- | --- |
| Sensor pure model | 24/24 |
| Sensor live engine, DOM and touch-viewport probe | 55/55 |
| Existing behavior S1–S5 | 79/79 |
| Power pure model | 21/21 |
| Power live engine | 29/29 |
| Ship content/helpers | 14/14 |
| Ship integration | 11/11 |
| Live ship economy | 30/30 |
| Hull merge decisions | 23/23 |
| Full-roster balance | 19/19 |
| In-game ship catalog smoke | Passed |
| Manifest synchronization | Passed |
| Main/module syntax and whitespace checks | Passed |
| Node and Python release builders | Passed |

Both release outputs include `src/ship-sensors.mjs`, including their generated offline asset lists. A semantic comparison against the base confirms that `bm-ships/ships.json` and `data/starship_manifest.json` changed only by adding `sensorProfile` and `sensorDesign`; reviewed hull/art/loadout/price/standing data remain intact.

The old behavior probe now supplies visibility explicitly where a test formerly assumed omniscience. Its long-range hunter acquires an actively transmitting player through real sensor updates before the firing-range measurement. The station-order fixture places the escort in real acquisition/firing range with sufficient energy. The Unknown classifier expectation changes from unavailable to enforceable, matching the approved contract. Existing range, damage, attribution, authority and policy assertions remain.

## Performance gate

Reference: local headless Chromium **153.0.8010.0**, Linux x64, Intel Xeon Platinum 8573C virtual CPU; Node reports 8 available logical CPUs, browser reports hardware concurrency 9 and device memory 16 GB. Viewport 1280×850. This is a shared virtual runner, not an iPad measurement.

Fresh seeded Earth: 20 NPC contacts, 18 stations and the player, 39 observers, 1,481 spatial candidate pairs in the reported pass. Detection runs at the actual 5 Hz cadence after ten seconds of warm-up, with 300 measured passes across sixty seconds. Full pass instrumentation includes actor snapshots, candidate generation, contact updates, direct sharing and scan advancement.

| Timing | Measured | Budget |
| --- | ---: | ---: |
| Detection pass p95 | 1.2 ms | ≤2 ms |
| Detection pass p99 | 2.3 ms | ≤4 ms |
| Whole-tick p95, base | 0.8 ms | — |
| Whole-tick p95, sensors | 1.5 ms | — |
| Added whole-tick p95 | 0.7 ms | ≤2 ms |
| Render p95, base | 1.8 ms | Report separately |
| Render p95, sensors | 1.2 ms | Report separately |

Whole-tick timing uses the identical seeded scene and 3,600 ticks after 600 warm-up ticks on each tree; rendering is timed separately over 300 calls. These are CPU execution samples, not a claimed display FPS. The detection cadence test is separately scheduled at 200 ms intervals. Neither browser run reported page errors.

Earlier runs exceeded the pass budget. Profiling found redundant same-side sharing of targets already observed locally. The final implementation skips local tracks and takes one direct peer report per missing target, retaining the no-relay rule. The final fresh-scene measurements above use that implementation; thresholds were not relaxed. Re-run on the intended deployment environment rather than treating shared-runner timing as universal.

## Visual checks and practical limits

Screenshots cover passive contact, completed hull scan, technical assessment, lost contact and a 1024×768 touch viewport. OPS controls operate through real DOM clicks; expanded contact details survive the periodic power-panel refresh. Long reports use the existing panel scroll area.

The mobile smoke check uses Chromium touch emulation. **Actual iPad/Safari operation and performance remain unverified** and should receive a device smoke check before release. Existing narrow-viewport top-HUD cropping is outside this sensor change. Exact foreign cargo is intentionally unavailable, crew estimates remain uncertain until firing behavior is observed, and declarations remain spoofable by design.
