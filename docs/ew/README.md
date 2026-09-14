# Electronic warfare

**Review candidate:** functional suites (105 EW/seeker) pass. The 2 / 4 ms gate is the **original full-workload timer** (`electronicsPass` = power+sensors). **Current Platinum evidence for `51738ca`** is Astra’s rerun family: C2 **3.70 / 9.20** and **2.00 / 4.30**, both failures. The sensor baseline also failed p99; cumulative frame increments passed. The quieter-host 300-sample follow-up (C2 1.60 / 2.20) and older Platinum `performance-*.json` 2.50 / 6.90 are **historical** receipts, not current `51738ca` Platinum results. Freeze tag `ew-fable-candidate-20260913` stays at `077a9ce`. Explicit decision required before merge. Do not merge to main. See VALIDATION.md and `receipts/MEASUREMENT-BOUNDARIES.md`.

Base: sensors commit `758665eef8cc001973529a23e9cd556aeb98c68e`.

Noise/ECCM adds one dedicated EW installation, retaining three weapon slots and the sensor suite. OPS Electronics exposes player and local fleet orders, refits, paid consumption and own-fleet interference. Jammer prices and tier gates are centralized in `src/ship-ew.mjs`.

The local receiver contest uses all paid emitters with root-sum-square stacking, no 35% quality floor and no strongest-three cutoff. Self-cancellation affects only the emitter itself. Visual/checkpoint floors, communications, direct same-side sharing and hit evidence retain the sensor contract. Defense platform type records use the enhanced 1,500/1.25 array. Jamming alone is not a witnessed weapons attack.

Read DESIGN.md for the complete accepted contract, tuning ledger and cumulative performance authority. Module prices and the specialized torpedo's price remain playtest values. Actual iPad/Safari testing is not implied by Chromium touch emulation.

Run `npm run test:ew` and `npm run test:ew:ingame`, alongside the sensor, power, behavior and ship/economy suites. EW browser fixtures use real production power, sensing, UI and persistence paths.

See [INTEGRATION.md](INTEGRATION.md) for the launcher, stock rules, incarnation locking and application instructions; see [VALIDATION.md](VALIDATION.md) for measured results. The longer timing campaign is specified in [BENCHMARK-PROTOCOL.md](BENCHMARK-PROTOCOL.md) and is **frozen for Fable final diff review — long campaign not started.**
