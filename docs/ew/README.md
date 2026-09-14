# Electronic warfare

**Milestone acceptance (14 September 2026):** the independently audited r6
campaign in PR #11 is **sufficient performance evidence for this
milestone**. The Platinum-only gate is **removed**. Thresholds stay
**2 ms p95 / 4 ms p99** `electronicsPass` and cumulative frame **≤ 2 ms**.
Canonical note: [ACCEPTANCE.md](ACCEPTANCE.md). This tree **prepares
integration**; merge to `main` is a separate later decision.

Historical Platinum failures keep their original labels (not rewritten):
Astra `51738ca` C2 **3.70 / 9.20** and **2.00 / 4.30**, and older
`performance-*.json` **2.50 / 6.90**. The quieter-host 300-sample follow-up
(C2 1.60 / 2.20) remains historical supplementary evidence. Freeze tags
including `ew-fable-candidate-20260913` @ `077a9ce` and
`ew-fable-protocol-20260914` through `…-r6` stay immutable. See
VALIDATION.md and `receipts/MEASUREMENT-BOUNDARIES.md`.

Base: sensors commit `758665eef8cc001973529a23e9cd556aeb98c68e`.

Noise/ECCM adds one dedicated EW installation, retaining three weapon slots and the sensor suite. OPS Electronics exposes player and local fleet orders, refits, paid consumption and own-fleet interference. Jammer prices and tier gates are centralized in `src/ship-ew.mjs`.

The local receiver contest uses all paid emitters with root-sum-square stacking, no 35% quality floor and no strongest-three cutoff. Self-cancellation affects only the emitter itself. Visual/checkpoint floors, communications, direct same-side sharing and hit evidence retain the sensor contract. Defense platform type records use the enhanced 1,500/1.25 array. Jamming alone is not a witnessed weapons attack.

Read DESIGN.md for the complete accepted contract, tuning ledger and cumulative performance authority. Module prices and the specialized torpedo's price remain playtest values. Actual iPad/Safari testing is not implied by Chromium touch emulation.

Run `npm run test:ew` and `npm run test:ew:ingame`, alongside the sensor, power, behavior and ship/economy suites. EW browser fixtures use real production power, sensing, UI and persistence paths.

See [INTEGRATION.md](INTEGRATION.md) for the launcher, stock rules, incarnation locking and application instructions; see [VALIDATION.md](VALIDATION.md) for measured results. The longer timing campaign is specified in [BENCHMARK-PROTOCOL.md](BENCHMARK-PROTOCOL.md). The r6 execution pack is `receipts/campaign-r6-20260914T1309Z/` (PR #11); see [ACCEPTANCE.md](ACCEPTANCE.md).
