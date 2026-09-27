# Blockade interception and running — rules

DTG 270100ZSEP26 · base `4860070` (accepted, frozen)

A blockade is something ships can actually try to run. It is no longer only a throughput modifier.

There is **one interception engine**, `Campaign.resolveBlockadeRun` in `src/campaign-strategy.mjs`. Every runner goes through it:
* a player formation, at the crossing of its leg-by-leg route;
* a trader's passage or circuit;
* an evacuation convoy;
* (later) AI missions.

There is no second probability model anywhere. The evacuation risk bank and its flat daily throughput factor are gone.

## 1. When it runs

When a ship or group reaches a system on its route, every blockade there that **applies** is run, in turn, the day the leg ends. The first run that turns the group back ends the attempt.

`blockadeApplies(book, world, b, sponsor)` requires all of these:
* the blockade is `active`;
* the world is still held by a power the blockader is formally at war with;
* the blockade's war (`warStates[warKey]`) is still `war`, not ceasefire or peace;
* the blockader is formally at war with the **runner's sponsor**.

Consequences:
* A ceasefire or peace closes the blockade (as before) or at least takes it off that sponsor, so a formation already in transit is not intercepted by a blockade that has legally ended.
* Neutral traffic is not fired on. Inspection regimes are a later treaty term.
* **No blockade on the route means no interception path runs.** `book.stats.interceptions` does not move.

## 2. The model

### The blockade's side
It is read from the hulls actually on station and able to act:
* **S** is Σ `hullStrength` (price × condition) of on-station hulls not disabled. A disabled hull adds nothing.
* **coverage** is `S / (S + D + blockadeTrafficScale)`, recomputed from the live force the moment it changes:
  * after an engagement;
  * every day;
  * when disabled hulls leave (they go to repair).
* **Blockade speed** is the mean class speed of its hulls.
* No "heavy" label is kept apart from the force.

### The runner's side
It is read from the ships' own records and class facts:
* **Speed** is the class top speed (`shipRunSpeed`) of the **slowest operational member**.
* **Cloak** means every operational member has a working cloaking device:
  * a device fitted in her own slots, or the class's as built (`shipClassCloak`);
  * the ship is operational;
  * she has at least 50% hull.

  Stealth is the **least stealthy member's**: one uncloaked freighter gives the group away, and a mixed group gets **no** cloak benefit. A hook, `b.cloakDetection`, stands for a blockade with a special detection advantage; nothing sets it yet.
* **Fighting value** (`shipClassCombat`, 0–1) is combat weapons fitted (two make a warship), × 0.25 for a civilian hauler. E is Σ strength × fighting value of the operational members. Three warships are not three freighters.
* **Signature** is 0.7 + 0.02 per ship + 0.3 × (largest mass / 10), clamped to 0.6–1.5.
* **Condition** is the mean hull fraction of the operational members.

### Formulas

```
rel      = clamp(v_runner / v_blockade, 0.4, 2.5)
pDetect  = clamp((0.2 + 0.85·coverage) · signature · stealth · (1.2 − 0.2·rel), 0.02, 0.97)
           stealth = 0.3 if every member is cloaked, else 1
pCatch   = clamp((0.25 + 0.75·coverage) · (1.35 − 0.45·rel) · S/(S + 1.5·E), 0.03, 0.95)
ratio    = E / S
pressure = S/(S + 1.5·E) · (1 + 0.6·(1 − condition)) · (0.35 + 0.65·coverage) · (0.6 + 0.8·u)
```

Seeded values `u` come from (book seed, blockade id, runner key, day, step). The same crossing gives the same answer after a reload.

### Rationale
* **Detection and interception are separate steps.**
  * Cloak and signature bear on being seen.
  * Speed bears on both.
  * Coverage bears on both.
  * Escorts deter interception (S/(S+1.5E)) and blunt the fight.
* **Neither cloak nor speed is automatic success.** Both multiply odds that have floors, and a cloaked group that *is* caught fights as any other.
* **How hard an interception presses** scales with the force balance, the runner's condition and the share of the blockade that can be brought to bear (its coverage). A light blockade that catches a runner rarely has the ships to hurt it.

## 3. Outcomes

| outcome | condition | the group | damage |
|---|---|---|---|
| `slipped_through` | not detected | goes on | none |
| `challenged_but_passed` | detected, not caught | goes on | none |
| `fought_through` | caught, E/S ≥ 0.75 | goes on; the escorts take the fight | light on runners, fighters first; the blockade takes E·0.25·(0.5–1.5)·1.5 |
| `intercepted_minor_damage` | caught, pressure < 0.45 | goes on | light |
| `intercepted_forced_back` | caught, 0.45 ≤ pressure < 0.9 | turned back | moderate |
| `intercepted_losses` | caught, pressure ≥ 0.9 | turned back | one ship caught (see below) |
| `blockade_broken` | a passing run leaves the blockade with no force, or a ≥ 4:1 fight that cost it ships | goes on | the blockade ends `broken` |

**The ship caught** in `intercepted_losses`:
* Escorts put themselves in the way as often as they cover the group (E/(E+S)); the weakest of them takes it.
* Otherwise it is the most exposed ship: least armed, worst condition.
* It is disabled (8% hull), or destroyed with probability 0.35 × (1 − cover).

**Bounds and damage:**
* Never more than one runner destroyed per crossing.
* Runner damage per hull is capped at 50% per run. Fighters take it first (×1.3), and transports' share is cut by (1 − cover).
* Blockade damage lands on its weakest hull first, classified by the fleet damage model:
  * **disabled:** the hull leaves the station and goes to repair (`repairing`);
  * **destroyed:** the hull is lost.

## 4. Persistent vessels
* **Runner damage** is applied to the same records:
  * a model polity hull (AI, or the mirror of the captain's fleet);
  * for the captain's ships, `applyRunToFleet`.
* **Classification** uses `Fleet.classifyDamage`:
  * **disabled:** §6 `markFleetShipDisabled`; she stops where it happened, and trading she was doing is remembered;
  * **destroyed:** `retireStrategicVessel`, with the same vid.
* Nothing is re-created, duplicated or resurrected.
* **Formation membership** updates: disabled or destroyed members are `detached` at the system, with their vid.
* **Evacuation capacity:** a lost or disabled transport leaves the operation (`lost` / `removed: disabled`), recorded with its vid, and lift falls.

## 5. Crossings, by runner

### Formation
The run happens at the crossing, after the system is observed and rolled.
* **Goes on:** the formation continues on its route.
* **Turned back:** the formation returns **as one body** to the system it came from. The journey ends `halted` with `forced-back`, and a new one-leg journey back is flagged `retreatFrom`. An order it was given en route is kept and flown from there. It is never on both sides at once.

**Standing order for blockades** (`g.blockadePolicy`), which applies to a blockade the captain **knows** of:
* **Run** (the default): no change from how it plots.
* **Wait:** the formation holds short, standing at its current system, and looks again every day until the blockade lifts or is unknown.
* **Reroute:** it replots round every known applicable blockade, excepting its own destination. With no way round, it waits.

A blockade nobody has reported is simply met.

### Trader (passage or circuit)
The run happens at the crossing.
* **Destroyed / disabled:** as for any crossing.
* **Turned back:** she returns to the previous system. A passage ends there as `hold`; a circuit is re-planned from there.

### Evacuation convoy (replaces the abstract shuttle and its risk bank)
The transports and escorts sail the route as **one convoy, a jump a day**:
* load at the origin (the loading day);
* run the origin's blockade on departure;
* run each system reached on the way out, including the destination;
* deliver on arrival;
* run each system on the way home, the origin last.

**The convoy's ships move.** Model hulls, and the captain's fleet ships through `evacuationConvoyMoved`, are where the convoy is.

**Turned back:**

| where | result |
|---|---|
| at departure | waits `evacRetryDays` (3) and tries again |
| on the way out | returns without delivering |
| on the way home | held a day, then retries |

Round trip timing is unchanged (2 × jumps + 1 loading day).

**Delivery** is `min(people aboard, remaining)`. People aboard a transport lost on the way are lost with her.

**Escorts** assigned while the convoy is away wait at the origin (`joining`) and join it on its next departure. They do not appear beside it.

**Still abstract:**
* the population figure and the lift per cargo unit (40 people);
* no individual passengers;
* the convoy is one group, and its loading day has no port capacity model.

## 6. What the captain knows
**A run records what its crews saw** as `b.sightings.player = {day, level, tier, force}`, stored as observed then and never re-read from the live force:

| level | when | force shown |
|---|---|---|
| `sighted` | slipped through | none (coverage tier only) |
| `contact` | challenged, or intercepted without a fight of his choosing | a range |
| `engaged` | fought through, or broke it | the count |

**How a sighting is used:**
* For 30 days a sighting is better than a relay or hearsay (`blockadeKnowledge.source = 'sighting'`).
* Own, local, or a ship on station remains live and exact, as accepted.
* It is saved with the campaign book.
* A pre-round save's bare day reads as `contact`, without a count.

**Estimates are qualitative:** Favorable (≥ 80% passage), Risky (≥ 50%), Poor, or Unknown.
* They are computed live where the captain can see the blockade.
* Otherwise they use the midpoint of the coverage tier he knows.
* On hearsay they are Unknown.
* No percentages are shown.

## 7. UI and reports

### Operations
**Evacuation card:**
* `Route status: Clear | Contested | Heavily interdicted | Interdicted` (worst known blockade on the route);
* `Estimated chance of passage` for his convoy as it is now;
* the convoy line: trip, phase, where, last run.

**Blockade card:**
* the known force: a range or count, only as known;
* `Running it, unescorted transport: …`;
* `Seen by your ships day N (level)`;
* `Your runs: n of m got through`;
* the effects list (trade, reinforcements). The flat "evacuation throughput −x%" line is removed.

**Formations and blockades:** formations under way whose remaining route runs through a known blockade, with the estimate and **Run blockade / Wait / Reroute**. The fleet manager's formation row has the same choice.

### Map
* Blockade rings (the operations layer).
* The formation's route and chevron (the formations layer).

### Reports
**The captain's own runs** go to the Captain's Log:
* **Blockade run succeeded — X:** "Three transports slipped through the Klingon screen."
* **Blockade run failed — X:** "One transport was disabled and the convoy turned back."
* **Blockade weakened — X:** "Escort action forced part of the Klingon blockade off station."
* **Blockade broken — X.**

Routine evacuation passes are not reported each trip.

**Other runs:**
* His blockade stopping or missing a convoy: Captain's Log.
* Others' notable runs: Wars & fronts at the quality his sources allow.

## 8. What changed in accepted behaviour
* **Evacuation throughput.** It is now delivered per convoy arrival, not as a daily fraction.
* **Blockade effects on evacuations.** The convoy's runs replace the throughput factor (`blockadeEvacImpact`), the unescorted-transport risk bank (`evacLossRate`), and escort strength counted as local defence or daily attrition (escorts fight where they are, in the runs).
* **Tests revised to the new rule.** In `evac-blockade-gate`: EVAC-FINITE, EVAC-LOSS-REDUCES, EVAC-SAVELOAD, BLOCKADE-STRONG-REDUCES, BLOCKADE-WEAK-LEAKS, BLOCKADE-WEAKENED, EVAC-THROUGH-CEASEFIRE and EVAC-BLOCKADE-INTEGRATION. In `evac-blockade-test`: group 2.
* **Formations.** A blockade met on a formation's route is run (`formation-route-gate` BLOCKADE-AT-C revised). 4860070 only recorded the encounter.
* **Blockade knowledge from a crossing** is what was seen (`sighting`), not the exact live force.
* **Disabled blockaders** leave the station and stop counting.
* **Map legend.** Unchanged (7 layers).

## 9. Deferred
* Tactical battles for strategic interceptions (a run is strategic; a local scene is not spawned).
* Full refugee simulation.
* DMZs, inspection regimes, tribute, reparations, basing rights, transit guarantees. The `authority` and `cloakDetection` fields are the extension points.
* Doctrine runtime.
* Tactical Cube; Gorn activation.
* Economy rebalance.
* AI missions calling the engine (the entry point is ready).
* Transports added to a running evacuation (escorts only, as before).
