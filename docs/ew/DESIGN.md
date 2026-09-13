# BM1 — Electronic warfare proposal

Version 0.3 · 13 September 2026

Status: revised proposal for stronger suppression, burn-through and an optional specialized home-on-jam weapon; no EW engine changes yet.

Inspected base: `758665eef8cc001973529a23e9cd556aeb98c68e`, the complete sensors patch built after `34c1827`. The remote integration of that patch has not been verified in this turn. Reconcile with the integrated sensor head before implementation.

## 1. Intended experience

EW lets a captain trade power and concealment for interference with distant enemy acquisition and scanning. A sensor-equipped cargo ship can become useful fleet support; it still has its original engines, shields, weapons, reactor and cargo role. A science ship's efficient, capable electronics remain valuable. A capital's larger reactor buys endurance rather than automatic immunity.

Jamming is local interference around an emitter. It affects receivers in that area, including friendly receivers. It does not make every ship behind the jammer invisible. Moving outside the interference, bringing a better receiver, buying a sensor upgrade, allocating more power to Sensors, enabling ECCM processing or receiving a direct report from an unaffected same-side observer are distinct responses.

All values below are starting balance proposals. They are calculated against the inspected ship/power data, not claimed playtest results. The implementation should ship them as centralized tuning data.

## 2. Equipment and controls

Keep all three weapon slots. Keep the dedicated sensor suite. Add **one dedicated EW equipment slot per ship**, initially empty. The slot accepts one jammer; installation replaces its contents and never stacks modules. Ships may fit any offered jammer they can afford and qualify to buy. Reactor demand supplies the practical small-ship tradeoff rather than an arbitrary faction or hull-size ban.

Do not repurpose flags, passes, the future utility inventory, the cloak or existing special-weapon slots. A ship described as unarmed remains capable of installing weapons; an empty EW slot simply means no jammer installed.

OPS retains four allocations—Engines, Weapons, Shields, Sensors—sharing twenty points. EW electronics use the Sensors allocation and real reactor energy; there is no fifth slider or free reserve-generation multiplier. The electronic section shows separate reception/scan, jammer and ECCM consumption, alongside their total.

Controls:

- Jammer: Off / On, installed model, spin-up/cooldown and power-limited state.
- ECCM processing: Off / Boost, available through the sensor suite without a second purchasable module.
- Existing Passive / Active Sweep / Focused Scan and Transponder On/Off remain independent.
- Receiver status: Clear / Interference, estimated degradation of this ship's own sensors, rated versus presently effective range, and current electronic draw.
- Known friendly interference is labeled explicitly: **“Interference: own fleet jammer”**, with the contributing known ship names; self-interference says **“Own jammer.”** Mixed interference says **“Own fleet + other/unattributed.”** Use actual side and fresh own-side telemetry, never a transponder claim, to identify friendly contributions. Show the known friendly contribution even when no foreign emitter has been located; do not invent a foreign identity from the remaining measured noise.
- A known emitter receives an observed “Jamming emission” annotation. Interference alone does not reveal every emitter's identity or location.

Unknown sources stay unknown. The panel must not show hidden enemy module models, exact energy, crew skill or coordinates. Technical scans can reveal an installed EW module through the same runtime-equipment reporting path as other equipment.

## 3. Proposed jammer catalog and access

| Module | Price | Existing standing tier | Base radius | Base strength | Draw at 5 sensor points, native efficiency 1 |
| --- | ---: | --- | ---: | ---: | ---: |
| Compact noise jammer | 7,500 L | Trusted (15 default) | 900 | 0.75 | 2.5 EU/s |
| Tactical noise jammer | 25,000 L | Respected (30 default) | 1,200 | 1.25 | 5 EU/s |
| Fleet support jammer | 60,000 L | Strategic (75 default) | 1,500 | 1.80 | 9 EU/s |

Use configured economy tier thresholds, faction-wide standing and service authority. Do not introduce world-by-world prestige or a separate EW reputation currency. Installation uses eligible shipyard/science/university/maintenance/starbase or planetary refit services, including the existing checkpoint service-denial rules.

Player, escort and garrison refits call one purchase gate. A successful installation charges once, preserves the sensor suite and three weapon slots, and persists on the actual fleet vessel. Remote or foreign ships cannot be refitted through the local panel. Rebuying an installed model is refused. No trade-in refund or removable-item resale loop in this increment.

All purchased hulls retain their reviewed starting loadouts and start with an empty EW slot unless a reviewed sale record explicitly includes one. Existing purchases must not silently gain equipment or a price increase.

## 4. Power and timing

Let `S` be the ship's allocated Sensors points. For `S > 0`, define `A = 0.5 + 0.1 × S`; for `S = 0`, both jammer and powered ECCM are unavailable. Let `H` be native sensor efficiency, which is a **draw multiplier** in the current data: lower is cheaper.

At full electronic funding:

- Jammer draw = catalog draw × A × H.
- Jammer strength = catalog strength × A.
- Jammer radius = catalog radius × sqrt(A).
- ECCM Boost draw = 2 EU/s × A × the installed sensor profile's draw multiplier.
- Existing sensor reception/active-scan draw remains governed by its own suite and allocation.

Normal passive rejection costs no extra beyond running the sensors. ECCM Boost adds receiver processing; it does not transmit a new signal by itself. Scanning or running a jammer still emits normally.

Compute the electronic demands together after the existing essential-load ordering. Give reception/scan, jammer and ECCM the **same funded fraction** from the energy available to electronics; do not let their order in the source code decide who receives free/full power. Debit their combined actual consumption once. Apply the storage-capacity clamp after all continuous demand, so energy produced during the step is available before genuine overflow is discarded. Preserve cloak/engine/shield priorities and weapon-shot accounting; do not count the same generated energy twice.

For funded fraction `f` between zero and one, jammer strength additionally multiplies by `f` and radius by sqrt(f). ECCM's extra rejection interpolates with `f`. Ordinary sensor behavior retains the sensor contract: reduced passive supply, and no full active scan progression/emission without its required funding. Zero supply produces no jammer field. UI telemetry reports actual rather than requested consumption.

Jammer On requires one second of continuously funded spin-up. During spin-up it draws its running demand and advertises an emission but produces no interference. Partial funding resets spin-up; the control reports the shortage. A shutdown for zero funding also requires a fresh spin-up before the field returns. Once operating, partial funding weakens it by the formula above. Switching Off, losing the module, destruction, docking, departing the system or engaging cloak removes the field immediately. Restart has a two-second cooldown followed by spin-up. Holding On while unfunded cannot repeatedly earn a free burst.

Enabling the jammer while cloaked is refused with a clear reason. Starting cloak switches the jammer off. No ordinary jammer reveals or decloaks an otherwise silent cloaked ship. Docked ships do not emit EW fields into space; leaving dock requires a fresh activation.

All durations use simulation time. Pause, low frame rate and reload cannot advance spin-up or manufacture energy. Frame subdivisions must produce equivalent paid energy and bounded, consistent field strength.

## 5. Receiver contest

For each operating emitter within range of an observer, calculate:

```
falloff = max(0, 1 - (distance / radius)^2)^2
contribution = funded_strength × falloff
```

The emitter's own receiver has designed self-cancellation: multiply its own contribution by **0.25**. That cancellation does not protect its escorts or other same-side ships. Every other receiver uses the same formula regardless of faction, hostility, ownership or crew skill.

Aggregate **all** spatially relevant paid contributions, including the self-cancelled contribution:

```
N = sqrt(sum(contribution_i × contribution_i))
```

There is no strongest-three truncation or hard noise cap. Identical co-located sources produce sqrt(count) times one source's interference: more paid emitters always help, with diminishing returns. Use stable incarnation-key ordering for reproducible floating-point accumulation. This is a game balance law, not a claim to simulate real electromagnetic propagation.

Receiver rejection is:

```
E = native_processing × suite_processing × A × receiver_funded_fraction × ECCM_factor
ECCM_factor = 1 normally, or 1 + 0.6 × electronic_funded_fraction with Boost
Q = E / (E + N)
```

Sanitize individual equipment values and allocation, but do not cap a legitimate combined rejection value at four. When N is zero, Q is exactly one and the unchanged funding rules decide whether the receiver can operate. When N is positive and E is zero, Q is zero and there is no ordinary RF acquisition or scan progression. Avoid division by zero explicitly. For a powered receiver and finite interference, Q remains positive. There is **no gameplay floor of 0.35**; an epsilon may protect a division in code but must never grant a minimum detection radius or scan rate.

### Ceiling, suppression and burn-through

The superseded v0.1 floor limited jamming to about **59.2% of RF range, 35% of scan speed and 2.86 seconds of passive acquisition**. That was too restrictive for the investment the user wants to permit. Those three limits are removed in v0.2: paid fleet-scale interference can reduce RF range and scan speed further and make acquisition take longer.

Burn-through follows distance and receiver strength. For a particular target, let B be its unjammed detection radius from this observer, including the existing target-signature rule on the passive path:

```
RF burn-through radius = B × sqrt(Q)
ordinary RF contact is eligible when target_distance <= RF burn-through radius
```

Closing within that radius, improving the sensor suite, allocating/funding more Sensors, using ECCM, leaving the jammer's local field or obtaining a valid direct donor report can recover a track. For any finite field and powered receiver the computed RF radius is positive; there is no promise of a fixed fraction of the system being visible. Moving closer to a jammer may also raise its local noise, so evaluate both actual distances every pass.

Visual detection, the operational checkpoint's near-field tracking guarantee, direct communications and hit-origin evidence remain separate paths (section 6). In particular, jamming does not erase an uncloaked ship already on screen. These are explicit close-range/knowledge protections, not a hidden restoration of the old RF percentage floor. A receiver whose RF radius falls below the visual floor still sees visible sprites; it may take much longer to analyze them.

Apply interference only to the radio-frequency sensor paths in scope:

- Passive and ordinary active range multiply by sqrt(Q).
- Passive acquisition time becomes the existing one-second threshold divided by Q, with no three-second cap. At Q=0, clear/pause acquisition safely rather than producing Infinity/NaN. The visual/checkpoint/strong-emission paths retain their separately specified acquisition behavior.
- Reception range for an ordinary active-scan emission also multiplies by sqrt(Q); the stronger jammer-emission path in section 7 is the explicit exception.
- Focused hull/equipment scan progress multiplies by Q, in addition to existing native/suite processing and funding.
- Preserve the existing track-age and explicit source-loss rules; a missed acquisition does not follow the current hidden position.

The first increment does **not** invent a random chance for every beam to miss. It changes whether the shooter can acquire/maintain a track and how quickly it can analyze a contact. A valid targeted shot retains the existing weapon accuracy and damage model. This makes the initial implementation testable without rewriting every weapon.

## 6. Paths that keep their existing guarantees

| Path | EW v1 behavior |
| --- | --- |
| Visual contact | Uncloaked sprites inside the world-space viewport guarantee remain Detected, even at zero sensor allocation. |
| Checkpoint coverage | The issuer's approved near-field tracking floor remains available throughout its moving perimeter plus margin. Jamming cannot become a checkpoint-entry bypass. Technical analysis may still take longer. |
| Declared transponder | Still heard at 2,400 units and stale after three seconds. This increment does not jam communications or authenticate declarations. |
| Direct same-side datalink | Still 2,400 units, maximum 0.4-second age and no relay. A donor can share only a direct track it actually has under its own local interference. |
| Hit-origin cue | Still a frozen launch-origin cue lasting three seconds after impact; jamming does not delete damage evidence or turn it into a homing lock. |
| Existing projectile types | Continue with their existing guidance/ballistic behavior and attribution. Only the proposed dedicated home-on-jam torpedo has the new emission-seeker behavior in section 7a; existing torpedoes are not silently converted. |
| Political identity and ROE | Resolvers retain authoritative sides/ownership. Jamming changes knowledge, not who owns a ship or what counts as a witnessed weapons attack. |

The visual/checkpoint floors deliberately limit close-range jamming. At normal close combat distances, EW may slow equipment scans without removing a firing track. Long-range acquisition and support positioning are its main initial uses. Do not inflate ranges or remove those floors to make a jammer appear more dramatic.

## 7. Emissions, counterplay and legal consequences

A powered, spinning-up or operating jammer advertises itself. A funded passive receiver can acquire the uncloaked emitting ship within:

```
emission_reach = 2 × effective_jammer_radius × (observer_unjammed_passive_range / 1200)
```

“Unjammed” here still includes the receiver's actual suite, allocation and funding, and excludes only interference degradation. During spin-up, use the radius that the paid transmitter would have when operating, even though its interference field is still zero. Use a one-second acquisition delay. This strong emitter path is not suppressed by the jammer's own noise; otherwise a jammer could hide the very transmission meant to expose it. At zero passive supply, only the existing visual/checkpoint guarantees apply. The position is an ordinary observed emitter track, not hull identification or a declaration. It can be shared under the same direct-report rule.

**Player-facing consequence:** a fully funded Fleet jammer at five sensor points is visible to a baseline funded passive receiver at about **3,000 units**, beyond the **2,400-unit communications range**. It can therefore reveal a ship that is running a dark transponder. At ten points its nominal emission reach is about 3,674 units for that same receiver; actual funding and receiver hardware change these figures. “Fleet jammer transmitting — detectable around 3,000 units by standard sensors at this setting” belongs in the equipment description/OPS help. Detection at that distance does not extend the observer's weapon range.

Reception status can show measured interference without a located emitter. AI decisions may use that local measurement; they may not enumerate all hidden jammers to pick targets. Once located, the emitter can be approached or engaged only under the existing targeting and ROE rules.

**Deliberate v1 boundary:** switching on a jammer alone does not write `lastAggressionAt`, revoke clearance as a weapons attack, reduce faction standing or authorize return-fire. Those consequences require the later electronic-incident policy. Checkpoint Unknown/Challenge/Closed and service denial continue to operate, but jamming adds no new automatic fine or kill authorization. This is a known gameplay limitation, not an assertion that hostile interference is harmless in the fiction.

## 7a. Home-on-jam torpedo — proposed additional counterplay

**Recommendation:** include a specialized anti-emitter torpedo as a separately reviewable commit in the EW series. Stronger suppression should already be balanced by burn-through, ECCM, visibility of the emitter and friendly interference; this weapon adds another option rather than being the only permitted counter. It is new scope compared with v0.1, not existing game behavior.

The torpedo uses **one of the existing three weapon slots**. It does not require the launching ship to carry a jammer and does not consume the dedicated EW slot. Installing it sacrifices another weapon choice. It is a reusable weapon installation under the existing weapon economy, not a new ammunition-inventory system.

Starting catalog proposal: **Anti-emitter Torpedo**, 9,000 L, the existing Respected tier (30 default), sold through eligible military/science weapon services with actual owner standing and checkpoint access. Assign its ID only after checking the final integrated weapon catalog. Use the inspected Photon Torpedo (#15) as the warhead/motion baseline: damage 33, cooldown 1,200 ms, speed 10 and minimum mass 1 in current game units. The proposed new weapon has **base launch range 1,800**, compared with the inspected Photon's 980. Preserve normal hull/OPS damage, firing-arc, range-modifier and energy rules; make the longer authored range effective through the real range resolver rather than a UI-only number. Keep the Photon's collision radius and finite turn limit. Its maximum travelled path is the resolved launch range; expire at that path limit or the corresponding straight-flight time budget, whichever is first, without replenishing either on reacquisition.

That longer **emitter-only standoff range** is the weapon's reason to exist. Current normal torpedoes retain homing after launch under the approved contract, so a same-range anti-emitter weapon that loses guidance when the jammer switches off would be a worse purchase. Do not silently weaken normal torpedoes to justify it. The premium buys reach against a transmitting jammer, with silence/coasting vulnerability in exchange, rather than a bigger warhead or a 3,000-unit launch range.

The seeker contract:

1. Launch requires an observed, currently transmitting jammer with a fresh local/direct-shared emission track (maximum age 0.4 seconds), this weapon's resolved range and normal firing arc, paid energy and ready cooldown. Apply the existing explicit-order/ROE rules; transmitting alone is not permission for an AI ship to fire under return-fire. Do not offer the weapon as a universal homing torpedo against silent targets.
2. The launch captures the observed emitter's **incarnation/signature key** and last sampled emission position. It must never follow a recycled NPC ID or a declared faction string.
3. The projectile samples a local passive seeker at 5 Hz: proposed 2,400-unit receiver reach and a 120-degree cone centred on its current heading. The sampled target must be that same live, paid emitter, within both reach and cone. Use the same advertised spin-up/operating emission definition; a commanded-On but unfunded or docked ship is silent. Heavy local noise does not hide this strong source from the specialized seeker.
4. Steering may use only a fresh seeker sample. It turns at the baseline torpedo's finite turn rate toward that sampled position between passes; it does not read the hidden entity's current coordinates every flight tick. Seeker knowledge stays private to the projectile, without refreshing fleet/player tracks.
5. When the next seeker pass finds the emitter silent, out of reach/cone or gone, stop homing. Coast ballistically on the last commanded heading, retain the last emission sample only for possible reacquisition, and continue normal collision/lifetime checks. No instant disappearance, teleportation or perfect tracking of a jammer that has switched off. Reject samples older than 0.4 seconds if a seeker pass is missed.
6. Reacquire only the original incarnation if it resumes a qualifying emission within reach/cone before the existing lifetime expires. Do not automatically switch to a nearby civilian, another jammer or a replacement hull occupying the same NPC ID. Multiple torpedoes and simultaneous emitters must remain deterministic.
7. Off/On cycling makes the emitter choose between continuing its interference and breaking seeker guidance, subject to the paid spin-up/cooldown rules. Cloaking switches the jammer off; the torpedo continues physically and can still hit by chance, but cannot track a silent cloaked hull through its entity reference.
8. Collision resolves against the actual body encountered, including an intervening ship or station. Keep original player/NPC/escort/station credit, damage scaling, event origin and aggression against the actual victim. Missile flight never creates an attack on someone it has not hit or legitimately been fired at under existing evidence rules.

AI-equipped launchers use this same seeker and launch gate. No perfect knowledge, free shots or faction immunity. Initial NPC launcher rollout should use explicit reviewed support/anti-EW encounter equipment; the jammer percentages in section 10 do not automatically equip every such ship with this torpedo. Existing mission and regional inventory restrictions remain authoritative.

This requires a real new projectile guidance branch, not a rename of current homing fire. Keep it separate from normal entity-targeted and frozen-point counterfire, and include it in performance and attribution tests. Deceptive signatures/decoys remain later work.

## 8. Initial numerical checks

For a baseline receiver with E=1 and passive range 1,200, one fully funded jammer at five sensor points produces approximately:

| Jammer / distance from receiver | Noise N | Quality Q | Effective passive range |
| --- | ---: | ---: | ---: |
| Compact / 300 | 0.593 | 0.628 | 951 |
| Tactical / 300 | 1.099 | 0.477 | 828 |
| Tactical / 1,000 | 0.117 | 0.895 | 1,136 |
| Fleet support / 300 | 1.659 | 0.376 | 736 |

With several identical Fleet jammers all 300 units from the receiver, the revised stacking rule gives:

| Receiver / sources | Noise N | Q | RF range | Passive acquisition |
| --- | ---: | ---: | ---: | ---: |
| Baseline, one Fleet jammer | 1.659 | 0.376 | 736 | 2.66 s |
| Baseline, three Fleet jammers | 2.873 | 0.258 | 610 | 3.87 s |
| Baseline, six Fleet jammers | 4.063 | 0.197 | 533 | 5.06 s |
| Baseline + funded ECCM Boost, three Fleet jammers | 2.873 | 0.358 | 718 | 2.80 s |
| Military platform (1,500 range / 1.25 processing), one Fleet jammer | 1.659 | 0.430 | 983 | 2.33 s |

These are RF values for a normal-signature target, before independent visual/checkpoint guarantees. The three- and six-jammer cases cost 27 and 54 EU/s of transmitter demand at native efficiency 1, plus the ships' other running demands. They are not free fleet bonuses. More sensor allocation or hardware upgrades change both sides of the contest.

The range is measured from the affected receiver to its attempted contact, not from the contact to the jammer. A strong emitter will often be easier to locate than another quiet ship in the same area.

Using the inspected ship data, full impulse, eligible full-rate shield regeneration, native passive sensors at five points and the Tactical jammer:

| Hull | Reactor | Total draw | Net energy / second |
| --- | ---: | ---: | ---: |
| Basic Shuttle | 7 | 10.90 | −3.90 |
| Deforest Armed Freighter | 10 | 12.35 | −2.35 |
| Nova Surveyor | 11 | 10.25 | +0.75 |
| Concord-class Grand Cruiser | 29 | 21.80 | +7.20 |
| Excalibur Class | 37 | 21.80 | +15.20 |

These estimates exclude weapon fire, cloak, active scanning, ECCM Boost and engine boost. Full shields need no recharge draw, so they reduce consumption. They demonstrate the intended distinction: a cargo ship can do this job by slowing down or accepting reserve drain; the Nova's efficient electronics help; large reactors can sustain more simultaneous tasks. They do not justify changing any reviewed ship stats in this patch.

### Economy playtest ledger

The proposed **9,000-L anti-emitter launcher versus 60,000-L Fleet jammer** is an unresolved balance question to revisit with the other equipment prices, not a proven or automatically intentional 1:6.67 counter-price relationship. These are installation prices under the current reusable-weapon system, not the price of each fired torpedo. The launcher also occupies a weapon slot and requires standing/access; its counter can force the jammer silent without guaranteeing a kill. The jammer can benefit several ships while affecting friendly receivers and paying continuous energy costs.

Keep these prices for the first controlled playtest rather than changing them solely to make the ratio look symmetrical. Record launcher pick rate, jammer usefulness and active uptime, forced-silence duration, escape/survival outcomes, alternate weapon opportunity cost, and single-jammer versus supported-fleet encounters. Include all four crew skills and normal refit/economy gates. Revisit launcher price, availability, standoff range and jammer price together if the cheap counter makes fleet EW pointless or the counter is too specialized to justify its slot. None of those tuning changes is pre-approved by accepting the current proposal.


## 9. Four AI skill profiles

Equipment is separate from proficiency and temperament. A skilled ship without a jammer cannot jam; a rookie with one gets exactly the same funded hardware output. Preserve current reaction delays, reserve thresholds and recovery rules. Use local measured interference, own equipment, own energy and already-observed combat/search state as decision inputs.

| Skill | Proposed operation |
| --- | --- |
| Inexperienced | Enables an available jammer on observed combat, tends to leave it running, and responds slowly to drain; can exhaust reserves. Uses ECCM reactively after sustained interference. |
| Regular | Enables during observed combat/search support when reserves permit, boosts ECCM for measured interference, switches optional transmitters off during recovery. |
| Veteran | Accounts for combined electronics demand and the existing forecast window; reduces jamming before losing essential power and favors receiver/ECCM power when its own needed track is failing. |
| Elite | Same knowledge and equipment limits; faster decisions, stronger reserve discipline, and stable prioritization of receiver versus jammer demand. No perfect knowledge of hidden enemy equipment. |

Temperament adjusts risk using the existing independent temperament system. A cautious pirate and reckless government officer remain possible. Do not equate faction with skill, grant government ships free energy, or lower hardware costs for higher skill.

Automatic activation requires an explicit EW operating order/preset. Player fleet ships default to jammer Off after installation; the captain can choose Automatic for a local commanded ship. Automatic follows the table. Manual On remains subject to energy, cloak, docking and equipment constraints. It is not an order to attack or change fleet stance.

## 10. NPC equipment rollout

Keep NPC equipment in a single deterministic outfitting policy, separately from hull identity and crew assignment. Proposed initial rollout, requiring normal spawn fixtures in the implementation review:

- Ordinary civilian traffic: no jammer by default.
- Authored covert/EW support role: explicit module; never inferred solely from its name or a spoofed flag.
- Unauthored pirate combat patrols: 20% Compact, otherwise none.
- Unauthored major-government combat patrols: 20% Tactical, otherwise none.
- Fleet Support models: explicit support encounter slots only, not every capital hull.
- Missions with explicit equipment, merchants and special regional availability rules take precedence over random outfitting.

These percentages are tuning proposals. Seed the roll from the spawn incarnation and role, not frame time. A cache return preserves equipment; a replacement ship rerolls from its new incarnation and inherits no old EW state. Do not automatically sell rolled NPC equipment as extra inventory or silently add it to player purchase records. No station jammer rollout in v1; station receivers do get the same interference calculations and fixed native rejection profile. Ordinary civilian installations retain passive range 1,200 and native processing 1.0. **Defense platforms join the enhanced military/service array profile: passive range 1,500, processing 1.25**, five sensor points and no automatic Boost in this first increment. Existing enhanced service installations use the same 1,500/1.25 profile. Classify platforms through their station type/capability records, not brittle name text or a player-provided label.

The intended result is that a lone standard Fleet jammer does not open the accidental ordinary-array first-shot gap against a platform's roughly 760–820-unit turret reach noted in review. At 300 units, the proposed platform still has about 983 units of RF reach against a normal-signature target. Verify actual turret ranges from the integrated loadout rather than hard-coding that review range as an invariant. Multiple emitters, higher transmitter settings and genuinely lower-signature targets may still create a first-shot window; that is an intended outcome of winning the contest. The 1,500/1.25 military array is not immunity, does not extend turret range or grant repair services, and does not confer a checkpoint floor on an ordinary platform.

## 11. Integration and persistence

The inspected sensor module is a suitable boundary for pure receiver math, but EW belongs in its own pure `ship-ew.mjs` module so sensor declarations and power state do not grow another unrelated database. Export jammer definitions, sanitation, demand calculation, spin-up state transitions and receiver-noise aggregation. The game adapter supplies funded actor snapshots and applies their computed quality to the sensor pass.

Important current hooks:

- `src/ship-power.mjs`: preserve the four-consumer allocation/crew model; include electronics in final energy accounting.
- `fundSensors` / `updatePowerSystems`: fund the electronic demands together, avoid double debit, finalize capacity once.
- `sensorSnapshotActor` / `SensorWorld.pass`: snapshot only paid fields; compute local interference once per observer using spatial emitter candidates, then use it across target candidates.
- `advanceSensorScan`: consume the observer's quality and funding. No scan progress while untracked or unpaid.
- `sensorCanTrack`, `freshTrack` and shared-report validation: retain their guarantees and knowledge-based targeting.
- `renderSensorPanelMarkup`: show controls, measured receiver state, actual draw and purchase decisions.
- Fleet/security participant snapshots, cache return and ambient replacement: serialize the same EW equipment/state shape everywhere.

Proposed per-ship record:

```json
{
  "version": 1,
  "module": null,
  "jammerOrder": "off",
  "eccmOrder": "off",
  "spinupRemaining": 1,
  "cooldownRemaining": 0
}
```

Allowed jammer orders are `off`, `on` and `auto`; ECCM orders are `off`, `boost` and `auto`. The captain's initial UI can expose manual controls, while the local fleet panel exposes Automatic explicitly. An automatic jammer order does not silently change a separately manual ECCM order. Sanitize module identifiers and order enums. Store relative remaining durations and equipment/orders; do not save global live fields, hidden emitter coordinates or a “fully powered” flag. On reload, retain paid progress only for the same persistent actor, require the next real power step before any emission, and preserve current energy. Travel/dock forces Off and a fresh activation; cache-only restoration of a still-present actor preserves its applicable state. Old saves receive empty EW equipment and Off orders with no ship/economy changes.

A capture transfers the physical installed module with the ship but not the former side's private intelligence or operating orders. Reset EW orders to Off under the new owner. Checkpoint waiver/refusal, system control transfer and transponder toggles cannot change the physical module.

## 12. Performance and implementation boundaries

Detection remains 5 Hz. Gather spatial jammer candidates per receiver, accumulate all local emitter contributions once, then reuse Q during that receiver's contact pass. Do not add a jammer loop inside every observer-target pair, recalculate fields every render, or relay reports through other shared reports.

Use the sensor patch's reference scene and environment record. Retain its **2 ms p95 / 4 ms p99** full-pass budget with twenty NPC contacts and operational Earth stations, now with at least six active jammers and mixed sides. Warm up ten seconds and measure at least sixty seconds at the actual cadence. Include emitter-candidate counts and paid/unpaid cases. Run **three matched trees on the same machine and fixture**: (A) pre-sensor `34c1827`, (B) the integrated sensor-only head, and (C) EW. Report absolute tick p95/p99 for all three, the incremental difference C−B, and the cumulative difference C−A. The **cumulative added tick p95 must remain ≤2 ms versus A**; EW does not receive a fresh two-millisecond allowance. **Gate authority:** judge the cumulative ≤2 ms added-tick gate and the full-pass p95/p99 gates on the reference environment recorded in the sensor validation: Linux x64, Intel Xeon Platinum 8573C virtual CPU, eight available logical CPUs (browser hardware concurrency nine), headless Chromium 153.0.8010.0, 1280×850 viewport. The recorded sensor increment there was 0.7 ms p95. Re-run A, B and C together on that environment for delivery; the historical 0.7 ms is context, not a value to subtract from a new machine's timings. Record actual CPU allocation and browser/version for every run. If that reference configuration is unavailable, report the gate as unverified on the substitute environment rather than silently redefining the authority.

Report the reviewer's two-core run and actual iPad/device measurements beside the reference as weaker-hardware signals. The externally reported 1.6 ms sensor increment on the two-core box is not reproduced in this revision and does not independently reduce the reference gate's allowance to 0.4 ms. Include its full A/B/C measurements when available; serious weak-hardware regressions remain actionable even if the reference gate passes. A reference pass is not a claim of device-wide performance.

Use identical contact/station/flight fixtures and run serially with the same browser/version, CPU allowance, viewport, warm-up and duration. The non-EW trees treat the selected six jammer hosts as ordinary ships. Add an active-projectile fixture using equivalent projectile counts/flight geometry on all three trees; distinguish the new seeker workload on C. Preserve absolute timings alongside differences and report the instrumented EW workload independently, so any unrelated improvement offsetting EW cost is visible rather than described as zero EW work. Report render time separately. A failure calls for optimization or an explicit revised budget, never a silent baseline reset.

The inspected sensor timer currently ends before per-frame focused-scan advancement. The EW benchmark must measure the complete EW/sensor workload and report scan advancement separately or include its same-step cost in the full total; do not hide new work outside the timer. If optimization is needed, preserve the acceptance behavior rather than weakening the threshold. This remains a reference runner budget, not an iPad guarantee.

Beyond the single specialized seeker in section 7a, no general guided-missile redesign, decoys/chaff, deceptive fake contacts, communications denial, transponder forgery UI, shield-drain weapon, boarding, station jammer deployment, new hull stats or new political incident escalation in this first patch. Those require separate behavior contracts.

## 13. Acceptance gate

1. No EW module and Off orders reproduce the accepted sensor behavior and all existing suites; zero-noise Q is exactly one.
2. One dedicated EW slot preserves all weapon slots, existing utility/pass records, sensor suite and reviewed hull data.
3. Purchases use faction-wide standing at each configured tier boundary, service authority and funds; one charge; same gate for player/escort/garrison; remote/foreign refits refused.
4. Test the stated radius/strength/quality formulas at centre, edge and outside; equal results for identical player/NPC/station receivers; lower Q never improves range or scan speed.
5. All-emitter aggregation is order-independent within numeric tolerance and reproducible; the fourth and later paid emitters still contribute with diminishing returns. No Q=0.35 floor, noise cap or artificial three-second acquisition ceiling remains. Identical friendly receivers are affected; self-cancellation applies only to the emitter itself.
6. Energy generation and combined electronics consumption balance numerically across frame subdivisions; allocation zero, shortages, full battery overflow and simultaneous firing never grant free effects.
7. Spin-up, cooldown, rapid toggles, pause and low frame rate obey paid simulation time; live field ceases on Off, destruction, docking, warp and cloak.
8. Visual/contact floor remains true at supported viewport corners and sprite edges, including sensor allocation zero and maximum interference.
9. Passive/active acquisition boundaries change as specified. A lost contact freezes at the last observation; no hidden coordinate updates or target cycling leaks.
10. Focused scans slow under noise, improve with better processing/Boost and pause without funding/track; completed reports retain their dates and are not erased by interference.
11. Jammer emissions can be acquired without identifying the hull; reception does not produce political aggression. Unlocated interference never reveals hidden modules, coordinates or owners through UI or AI.
12. Direct sharing lets an unaffected same-side donor support a jammed receiver, but loses validity when the donor's own track fails, range/age fails or the source disappears. No relay, allied-side or spoofed-identity sharing.
13. Checkpoint perimeter tracking, Unknown Open/Challenge/Closed, the player's dark approach, same-flag foreign authority, service denial and own-side exemption all survive maximum interference.
14. Radio declarations retain range/staleness; jamming itself does not grant clearance, revoke clearance as a weapons attack or alter sides/standing. Real attacks still produce the existing evidence.
15. Already-launched homing and ballistic shots continue, new targeted fire needs a valid track, and fixed-origin counterfire retains geometry, expiry, attribution and hit evidence.
16. All four crew profiles operate identical hardware under identical observed pressure; energy traces demonstrate different reserve behavior without faction discounts or hidden-target knowledge. Manual/Automatic/Off fleet orders remain distinct.
17. Cache return, real old-save load, new-save load, ship/fleet transfer, capture and checkpoint participant restoration preserve module/energy as specified; ambient replacement inherits no old EW state.
18. Seeded normal spawn paths exercise proposed NPC outfitting and authored overrides; rolled NPC equipment does not alter a hull's sale loadout or regional rules.
19. Twenty-contact/six-jammer performance runs compare pre-sensor, sensor-only and EW builds on the same environment. Report incremental and cumulative cost; enforce the cumulative ≤2 ms tick gate and full-pass p95/p99 budgets. Include active home-on-jam seeker cost, environment and spatial candidate counts. Both release builders include the new modules and offline cache version.
20. Screenshots and a touch-viewport smoke check show OPS power draw, module refit, measured interference, Boost response and tracked/lost contacts. Own-fleet/self/mixed interference is labeled using legitimate telemetry, and the Fleet jammer's ~3,000-unit nominal emission consequence is explained in the UI. Actual iPad/Safari testing remains a separate device check.
21. Defense-platform type/capability selection yields 1,500/1.25 and the stated single-jammer burn-through margin without changing its weapons or service capabilities. Massed fields can still win; low-signature targets and ordinary civilian stations remain distinct.
22. Distance-based burn-through, improved suite/allocation/ECCM and unaffected donor reporting each recover a track in appropriate fixtures. Test saturated low-power receivers, Q=0 handling, finite extremely heavy noise, passive delay beyond three seconds and RF radius below the visual floor.
23. Home-on-jam launch requires the right installed weapon, observed active emission, legal target/order, its authored range and paid power. Exercise a transmitting target beyond Photon reach but within the proposed 1,800 base reach; a silent target at the same position must not qualify. A radio-only identity, generic untracked interference or a silent vessel is insufficient. Buying/installing it preserves the three-slot model and existing weapon entries.
24. The projectile follows its own sampled emitter within seeker range/cone and turn/lifetime limits; it coasts when the source goes silent or exits coverage, can miss a moved shooter, and reacquires only the original incarnation. It does not leak seeker knowledge to its owner, snap to another jammer, track a reused ID, or follow a silent cloaked source.
25. Real beam/normal torpedo/point counterfire behavior remains unchanged. New anti-emitter collisions—including intervening friendly ships and stations—preserve original credit, energy/cooldowns and evidence against the actual victim. Exercise player, NPC, escort and an explicitly equipped station fixture.

## 14. Recommended work split and handoff

Astra: implement this increment against the integrated sensor head, with pure math/state tests, live acceptance exercises and one complete incremental patch. Claude: independently review the formulas, power accounting, source/knowledge boundaries, checkpoint compatibility and final game behavior. Grok: push the reviewed result through the existing project workflow.

Implement noise/ECCM and the specialized anti-emitter weapon as separate, testable commits within the proposed EW series. Do not describe the series as complete if the seeker is only a data entry with ordinary homing underneath it. The user has requested stronger paid suppression and counterplay; exact stacking coefficients, module/launcher prices and seeker parameters in this revision remain proposed tuning values for review.

## 15. Revision dispositions

- **Effect ceiling:** documented the old 59.2% / 35% / 2.86-second limits and removed their RF floor/cap in favor of distance-based burn-through and all-paid-emitter diminishing returns.
- **Defense platforms:** adopted a 1,500-range, 1.25-processing military array; deliberately prevent a weak default platform receiver from being the source of a free single-jammer first shot, while permitting stronger contests to succeed.
- **Performance:** report pre-sensor, sensor-only and EW timings; the ≤2 ms added-tick gate is cumulative against the pre-sensor tree and judged on the recorded sensor-validation reference environment. Report two-core and iPad results separately as weaker-hardware evidence.
- **Own-fleet interference:** explicit own/self/mixed labels from actual-side telemetry, with no invented knowledge of unidentified enemy emitters.
- **Emitter visibility:** plain-language ~3,000-unit Fleet jammer detection consequence at the baseline setting, beyond 2,400-unit communications.
- **Stronger EW and counterplay:** remove the artificial percentage ceiling, retain visual/checkpoint/communications guarantees, and propose a separate real home-on-jam torpedo with finite sensing, silence/coasting behavior and existing attribution.


### v0.3 — final review ledger

- Pinned the exact reference environment as the performance gate authority; retained cumulative measurement and separate weak-hardware reporting.
- Flagged the 9,000-L launcher / 60,000-L jammer asymmetry for economy playtesting. These remain provisional installation prices, not an accepted final balance ratio.
- Retained two implementation commits: **(1) noise and ECCM**, then **(2) the actual home-on-jam seeker**. The second must pass its flight, emission-loss, reacquisition, collision and attribution fixtures; a catalog entry alone does not satisfy it.
- This revision changes the design document only. No EW implementation or new benchmark result is claimed.
