# Electronic warfare

**Review candidate, not performance-cleared:** functional suites (102 EW/seeker checks) and both release builds pass on the review host. The 2 / 4 ms gate is **passMs** (complete 5 Hz sensing workload including due seeker sampling), not `elapsedMs` and not `electronicsPass`. On this supplementary 4-core host C2 passMs is 1.20 / 1.60 and cumulative tick vs pre-sensor is +1.10 ms. Platinum 8573C remains the release authority and is still a failed power+sensors receipt there. See VALIDATION.md and `receipts/MEASUREMENT-BOUNDARIES.md` before release.

Base: sensors commit `758665eef8cc001973529a23e9cd556aeb98c68e`.

Noise/ECCM adds one dedicated EW installation, retaining three weapon slots and the sensor suite. OPS Electronics exposes player and local fleet orders, refits, paid consumption and own-fleet interference. Jammer prices and tier gates are centralized in `src/ship-ew.mjs`.

The local receiver contest uses all paid emitters with root-sum-square stacking, no 35% quality floor and no strongest-three cutoff. Self-cancellation affects only the emitter itself. Visual/checkpoint floors, communications, direct same-side sharing and hit evidence retain the sensor contract. Defense platform type records use the enhanced 1,500/1.25 array. Jamming alone is not a witnessed weapons attack.

Read DESIGN.md for the complete accepted contract, tuning ledger and cumulative performance authority. Module prices and the specialized torpedo's price remain playtest values. Actual iPad/Safari testing is not implied by Chromium touch emulation.

Run `npm run test:ew` and `npm run test:ew:ingame`, alongside the sensor, power, behavior and ship/economy suites. EW browser fixtures use real production power, sensing, UI and persistence paths.

See [INTEGRATION.md](INTEGRATION.md) for the launcher, stock rules, incarnation locking and application instructions; see [VALIDATION.md](VALIDATION.md) for measured results.
