# Strategic evacuation and blockade — rules

DTG 261530ZSEP26 · base `b2da1f2` (accepted, frozen)

Evacuation and blockade are **persistent strategic operations**. Each has:
* an objective;
* named participants;
* a system;
* real hulls held for it;
* progress;
* supply and risk;
* explicit ways to end.

Both are saved with the campaign book. There is no switch like `isBlockaded` or `evacuationActive` with no actors behind it.

## 1. Evacuation

### Record
`book.evacuations[]`:

```
{ id, kind: 'evacuation', sponsor, origin, destination, route[], target, moved,
  transports[{hullId, vid, shipId, lift}], escorts[{hullId, vid, shipId}],
  startDay, deadlineDay, status: active|completed|partial|failed|cancelled,
  endDay, endReason, reason, lost[], removed[], riskBank,
  lastThroughput, lastFactor, initialTransports, carry }
```

* **Transports and escorts** are the sponsor's real hulls.
  * The captain's are his fleet vessels (`pf:<id>`), with their persistent `vid`, and `strategicOp` / `strategicRole` on the fleet record.
  * An AI sponsor's are its polity hulls, `assigned` to the operation.

### Units
Evacuees are a bounded abstract count, not a population simulation.
* **Target:** `population figure × evacProtectedShare` (10), clamped to 2,000–60,000.
* **Lift:** one hull carries `cargoCapacity × evacPeoplePerCargo` (40) per trip. A hull with no hold carries nobody.
* **Round trip:** `2 × jumps + 1` loading day.
* **Daily throughput:** `Σ lift / round trip × interdiction factor`, with fractions carried from day to day.

Losing a transport lowers lift. Adding transports raises it. Escorts carry nobody, but they blunt a blockade (§3).

### Destination
Explicit, and checked by the model (`validateEvacuationDestination`). It must be:
* a different world;
* held by the sponsor, or by a power that **receives its evacuees**:
  * for the captain's empire: its flag's government and powers aligned with it and not hostile;
  * for an AI: itself and its aligned friends;
  * never a power at war or in ceasefire with the sponsor;
* inhabited;
* reachable within `evacMaxHops` (6), on the chart's own routes;
* not under a **heavy** hostile blockade;
* not under attack.

Anything else is refused, with the reason.

### Ends

| end | status |
|---|---|
| target moved | `completed` |
| origin lost | `partial` (anything moved) / `failed` |
| destination can no longer receive | `partial` / `failed` |
| no transport capacity left (lost or reassigned) | `partial` / `failed` |
| deadline passed | `partial` / `failed` |
| cancelled | `partial` / `cancelled` |
| AI sponsor lost ≥ 50% of its transports | `partial` / `failed` (abandoned) |

What was moved stays on the record, and every held vessel is released.

## 2. Blockade

### Record
`book.blockades[]`:

```
{ id, kind: 'blockade', power, target, purpose, authority: 'war', warKey,
  hulls[{hullId, vid, shipId, from}], startDay, activeDay,
  status: forming|active|broken|withdrawn|closed|completed, endDay, endReason,
  strength, coverage, supply, unsuppliedDays, damageBank, losses,
  breaches[], segments[{day, coverage}], lastTier }
```

**Purposes:** `interdict_trade`, `cut_reinforcements`, `stop_evacuation`, `isolate_world`, `prepare_invasion`.

**Authority:** a formal war between the blockading power and the world's holder. The authority field is where an authored or treaty authority would sit later; nothing grants one yet.

### Force
* The hulls must be actually assigned. They are held (`assigned`, `opId`), so the same hull is never in two operations.
* A force already on station holds the blockade at once. Otherwise it is `forming` until it arrives.
* The captain's ships must be at or next to the target.

### Coverage
Recomputed each day:

`S / (S + D + blockadeTrafficScale)`

* `S` is the blockade's strength and `D` the world's defence (installations, ready defending ships, and escorts of evacuations there).
* It is capped at 0.95: nothing stops all traffic.
* Tiers: **light** below 0.25, **moderate** below 0.55, **heavy** above.

### Effects
All scale with coverage; none is all-or-nothing.

| flow | effect |
|---|---|
| evacuation throughput (every hostile blockade on the route) | `× (1 − coverage × S/(S + escort strength) × 0.85)` |
| market restocking at the world | `× (1 − coverage × 0.8)` per day it stood, from its recorded segments. Stock is never deleted, and it recovers at the ordinary rate afterwards |
| the holder's trade revenue from the world | `× (1 − coverage × 0.5)` |
| resupply (polity supply) | the world counts as blockaded in proportion to coverage |
| production / reinforcement at the world | the yard's supply `× (1 − coverage × 0.7)` |
| an unescorted transport running it | a risk bank of `effective coverage × 0.12` per day; at 1, a transport is lost |

**Not modelled this round:** cloak and speed as a way through. Escorts, the route and the local defence are what get ships through.

### Ends
A blockade ends when any of these happens; its hulls are released and the ending is reported.

| end | status |
|---|---|
| the target is taken by the blockader | `completed` |
| no formal war any more (ceasefire, peace, or the world changed hands) | `closed` |
| a ceasefire or peace between the pair, through `applyWarTransitionInModel` | `closed`, the same day |
| every hull gone or taken off station | `broken` |
| attrition (2% a day of the defending **ships'** strength, weakest hull first) | hulls lost → `broken` when none are left |
| strength below half the defence | `broken` |
| supply below 0.3 for 10 days (distance from the power's own ground) | `withdrawn` |
| AI purpose achieved (no evacuation left to stop / the world is weak enough to assault) | `completed` |
| AI blockade that achieved nothing in 90 days | `withdrawn` |
| command withdraws it | `withdrawn` |

## 3. Interaction

The interaction is generic, with no script tied to a particular world:
* An evacuation's route crosses blockades.
* Its throughput falls with their effective coverage.
* Escorts reduce effective coverage and add to the defence the blockade's attrition reads.
* Losses weaken the blockade. A broken or lifted blockade returns the route to full throughput.
* A blockade whose purpose is `stop_evacuation` completes when the evacuation ends.

## 4. War and peace

* A military blockade requires a formal war.
* Ceasefire and peace close it through the same transition that stands operations down.
* An evacuation is not hostile. It goes on through a ceasefire unless the origin or destination becomes impossible.

## 5. AI (first pass, not doctrine runtime)

* **Evacuate** only when a hostile operation bound for one of its worlds outweighs that world's defence by 1.2×, and only when:
  * the world is populous (≥ 5,000);
  * it has carriers there beyond the home garrison;
  * it has a safe own world to send them to.
* At most one active evacuation per power, and three in total.
* **Escort** an evacuation that a blockade is interdicting, with spare hulls at the origin.
* **Blockade** only with a reason:
  * the power's war has stalled (no assault for 45 days), or it can stop an enemy evacuation;
  * and with the force for it: at least five spare hulls, fielding 80% of the defence but short of what an assault needs.
* One blockade at a time, 60 days between blockades, and no return for 180 days to a world where one failed.
* The Dominion and the Blender Remnant don't blockade under this AI.
* **Abandon** an evacuation after losing half its transports.

## 6. The captain

Empire & campaign → **Operations**.

**Active evacuations:**
* progress bar;
* evacuated and remaining;
* transports and escorts;
* route status (Clear / Contested / Heavily interdicted, and throughput);
* estimated completion;
* buttons: DETAILS, SHOW ON MAP, ASSIGN ESCORT, CANCEL.

**Active blockades:**
* coverage;
* known force and supply, when known;
* effects;
* buttons: SHOW ON MAP, and REINFORCE / WITHDRAW for the captain's own.

**New evacuation:** origin (his inhabited worlds), a destination from the valid list, and his free vessels there, each with its lift.

**New blockade:** a target held by a power the empire is formally at war with and within reach of his free ships, a purpose, and the ships.

**Knowledge:**

| source | what the captain sees |
|---|---|
| his own operation, or a world he holds | exact |
| a ship on station, or being there | exact force, coverage, supply |
| a relay | coverage and a force range |
| hearsay | "Coverage: Unknown · Traffic losses reported" |
| no contact | nothing |

**Map:** a new **Evacuations & blockades** layer.
* An evacuation is a dashed, moving line with chevrons from origin to destination.
* A blockade is a ticked ring around the system, heavier with coverage and dotted when unknown.
* Labels stack under the system.

**Reports:** through the campaign's own sources. The captain's own and his holdings' go to the Captain's Log; others to Wars & fronts. Never the Campaign Report: none of this is a Dominion storyline beat.

## 7. Transition matrix

| operation | from → to | trigger |
|---|---|---|
| evacuation | — → active | sponsor order (valid origin, destination, lift > 0, free hulls on station) |
| evacuation | active → completed | moved = target |
| evacuation | active → partial / failed | origin lost; destination lost; no lift; deadline; AI abandonment |
| evacuation | active → partial / cancelled | cancelled |
| blockade | — → forming / active | power order (formal war, free hulls at or near the target) |
| blockade | forming → active | arrival day |
| blockade | active → completed | target taken; AI purpose achieved |
| blockade | active → closed | ceasefire / peace (war transition); no war |
| blockade | active → broken | force gone; outmatched |
| blockade | active → withdrawn | command; unsupplied; AI time limit |

## 8. Deferred

* Full refugee simulation.
* DMZs, inspections, tribute and reparations, basing rights, transit guarantees.
* Cloak or speed-based blockade running.
* Formation-routed transport movement: transports shuttle abstractly on the operation's route. A ship the captain moves off the route leaves the operation.
* Dominion convoy interdiction by blockade: the Dominion's own blockade test is unchanged; not reopened.
* Doctrine runtime.
