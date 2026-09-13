# EW integration and tuning ledger

This series builds on sensor commit `758665eef8cc001973529a23e9cd556aeb98c68e`. Apply both commits, in order. It preserves the reviewed ship roster, artwork, prices, standing gates, native power/sensor profiles, and the three weapon slots.

## Equipment and authority

Noise modules use one dedicated EW slot. Refits use the installation owner's faction standing and existing checkpoint service restrictions. A locally commanded escort can be refitted; a foreign ship or an out-of-comms escort cannot. A captured module remains physical equipment, while its old command orders are cleared. New purchases start with an empty EW slot. Save/load keeps equipment, orders and restart state, but never restores a free paid field.

Automatic jammer/ECCM decisions use the existing four crew skills. Equipment does not improve merely because a crew is elite. Civilian traffic receives no random jammer; authored equipment takes precedence over deterministic pirate/government patrol rolls. The initial rollout does not randomly arm those patrols with anti-emitter torpedoes.

## Anti-emitter Torpedo

Weapon ID **46** is a normal installation occupying one of the existing weapon slots. Its price is **9,000 latinum**, with the economy's **respected** standing threshold (30 by default). Photon damage, recharge, projectile speed, mass and OPS energy/damage scaling are retained. Its actual launch reach is **1,800 units**.

Daystrom Institute's authored stock explicitly includes the launcher. Generic military/science weapons services can stock it; other explicit local weapon lists remain authoritative. The shop handler and displayed purchase decision share the standing/service gate. Jamming is not an attack and does not grant permission for an autonomous launcher to fire.

A launch requires a fresh emission report, local or directly shared, and a currently paid transmitter. The projectile samples only its original emitter incarnation at 5 Hz, within a 2,400-unit, 120-degree seeker cone. Between samples it turns toward its stored point at the Photon turn rate. Silence, cloak, a missed sample, a replacement hull or a recycled NPC ID cannot provide hidden steering. Reacquisition never renews its three-second simulated lifetime or 1,800-unit path budget.

The seeker writes no observations back to the captain's contact map. Segment collisions use the physical bodies along the flight path, including intervening ships. Player, escort, foreign-NPC and station launch paths keep their existing impact credit and aggression evidence. Cloaking does not delete an incoming seeker; a coasting torpedo can still hit a body by chance.

## Tuning ledger

- The 9,000-latinum launcher versus a 60,000-latinum Fleet jammer is a **provisional playtest asymmetry**, not a settled economic ratio.
- No fixed quality floor: additional paid emitters continue to contribute through root-sum-square stacking. Visual detection, checkpoint coverage and hit cues still provide counterplay.
- A standard receiver can hear a Fleet jammer around 3,000 units, outside ordinary communications range. Native receiver sensitivity and Sensors allocation change that figure.
- Defense platforms use 1,500-unit / 1.25-processing military arrays. Stations do not receive noise jammers in this increment.
- Weaker hardware still needs measurement. The external two-core sensor result is context; actual iPad/Safari EW performance has not been measured here.

## Verification commands

Use a Playwright Chromium installation compatible with the local runtime.

```sh
npm run test:ew
npm run test:ew:ingame
npm run test:ew:seeker
npm run test:ew:seeker:ingame
npm run test:sensors
npm run test:sensors:ingame
npm run test:power
npm run test:power:ingame
npm run probe
npm run build
npm run build:python
```

`scripts/ew-frame-benchmark.mjs --root CHECKOUT` runs a matched Earth scene. Add `--passes` on sensor/EW checkouts for the 5 Hz cadence measurement; `--starved` exercises the power-limited emitter case. Run pre-sensor, sensor-only and EW checkouts **serially**, with identical browser/CPU configuration. Keep the raw timing receipts and calculate the cumulative EW-minus-pre-sensor tick p95, rather than granting EW a new two-millisecond allowance.

The full-pass measurement includes power/electronics funding and the entire sensor update including scan advancement. Projectile execution is additionally reported separately and is included in whole-tick timings. The pre-sensor/sensor trees carry the same six host hulls and six ordinary torpedoes; EW equips those hosts and runs the new guidance branch.
