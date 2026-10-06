# Formation strategic route traversal — rules

DTG 261700ZSEP26 · base `d507b1b` (accepted, frozen)

A dispatched formation flies its route **one leg at a time, as a single body**. Every system on the way is reached, crossed and observed on the day its leg ends, exactly once.

This replaces the d507b1b shortcut. There, every member was given one transit straight to the destination, with an arrival day computed from the whole route's distance. The systems in between were never reached.

## 1. The journey record

The record lives on the formation, as `g.travel`, and is saved with the fleet book:

```
{ id, seq, origin, plotFrom, from, destination, path[], legDays[], legIndex,
  legDepartDay, legArrivalDay, startDay, etaDay,
  members[], vids{id → vid}, purpose: 'move'|'attack', war (authority stamp) | null,
  crossed[{system, day, leg, seq}], encounters[{system, day, leg, seq, blockadeId, power, coverage, force}],
  detached[{id, vid, system, day, reason}], replots[{day, at, from, to}],
  pending { destination, purpose, war, day } | null,
  status: underway|arrived|halted|superseded, endDay, endReason, arrivedDay, note, warLapsedDay? }
```

Fields:

* **`path`** is the plotted route, without the start system. Travelling on it are `legDays` (per leg, as trade passages use, `routeLegDays`) and `legIndex`.
* **`from`** is the last system the formation stood in. `plotFrom` is where the current plot began.
* **Each member** carries only the leg she is on: `f.transit = {from, to: path[legIndex], arrivalDay, formationId, travelId, leg}`. The formation's record is authoritative.
* **Replots.** A superseded plot is replaced by a new record. `seq` increases by one, and `origin`, `startDay`, `crossed`, `encounters` and `detached` carry over.
* **`g.warOrder`** (on arrival of an attack) is the authority stamp the attack stands on.

## 2. Rules

1. **One body, one place.** A formation is dispatched only if all its members stand in one system. An escort counts as being in the captain's system. Otherwise the dispatch is refused: *"split between X and Y; bring the ships together"*. While under way, every member is on the same leg, with the same `from`, `to` and arrival day.
2. **Legs.** The leg `from → path[i]` ends on `legDepartDay + legDays[i]`. The day it ends is the **crossing**.
3. **Crossing, once.** A crossing is guarded by `(seq, leg)` in `crossed`, so processing the same day again does nothing. At a crossing:
   * the members stand in the system;
   * it is observed, exactly as a trader crossing it would observe it (`fleetTradeObserve`: a dated `fleet` condition record);
   * each member's crossing is rolled with the same encounter roll trade passages use (`resolveFleetTradeLegRisk`, keyed to the journey);
   * a hostile blockade there is met (§4).
4. **Leaving the formation at a crossing.** These members stay where the leg ended and are listed in `detached`:
   * destroyed (`destroyed`);
   * disabled (`disabled`);
   * no longer in the formation (`reassigned`);
   * given her own movement order en route (`ordered`);
   * put to trading en route (`trading`).

   A disabled ship is marked through the ordinary §6 path (`markFleetShipDisabled`). She is never carried further, and repair does not move her.
5. **Then, in order:**
   * **Attack authority lapsed** → the formation halts here (§5).
   * **A pending order** → replot from here (§3).
   * **More legs** → schedule the next leg from today.
   * **Last leg** → **arrive**.
6. **Arrival, once.** `status` goes from `underway` to `arrived`, and only once. The members are set down. If this is the captain's system and he is not in warp, they are put in the scene. For an attack, the formation takes up the attack order.
7. **Days that pass in one call** are processed leg by leg, each crossing on its own arrival day. The loop is bounded by the route.
8. **Save/load.** The record and the members' legs are plain saved state. A reload mid-leg resumes the same leg, with the same vessels and the same days.

## 3. Orders en route (§5 command rules)

* **New destination or stop** (`dispatchFleetFormation` on a formation under way, `cancelFormationTravel`):
  * **In warp.** It cannot turn round, so the order is `pending`. At the end of the leg in flight, the rest of the route is **replotted from the system reached**. A stop is a destination equal to the end of the leg.
  * **Standing in a system today** (its origin on departure day, or a system it crossed today). It is replotted from there **at once**.
* **Reaching the formation.** The order reaches it as any order does: from the captain's own system, or over a relay link to where it stands, or else to where its leg ends. Otherwise it is **queued**.
  * A queued order is addressed to the formation: `systemIndex` follows it.
  * It is **not received while in warp**.
  * It is received on the day a leg ends at a linked system, after that crossing is processed, and replotted from there.
* **A member's own order** (recall, rendezvous) given en route follows the single-ship rule. She acknowledges it, leaves the formation where the leg ends, and flies it from there. Her row says so: *"… — leaves the formation at X"*.
* **Refusals kept from d507b1b:**
  * a disabled member;
  * a member on a circuit or passage of her own;
  * a member with an unresolved movement order (pending);
  * a member in any transit not belonging to the formation.

## 4. Blockades met on the way

When the formation crosses a system under an **active hostile blockade**:

* **The formation's record.** An `encounters` entry gives the day, leg, blockade, power, coverage tier and ships on station.
* **The blockade's record.** A `breaches` entry `{kind: 'formation'}`, and `sightings.player = day`.
* **The captain's knowledge.** For 30 days after a sighting (`BLOCKADE_SIGHTING_DAYS`), `blockadeKnowledge` treats it as seen by a ship (`fleet` source: exact force, coverage, supply, `seenDay`) where it would otherwise have been relay, hearsay or nothing.
* **A report** in the Captain's Log: *"Task Force passed through the Klingon blockade at Paso: 6 ships on station, heavy coverage."* It is filed, as every report is, only for a system the captain knows.
* **Not stopped, not harmed by it.** Running a blockade by speed or cloak, and interception, are **not modelled** (deferred).

## 5. War orders

* **Attack dispatch.** `dispatchFleetFormation(id, {purpose: 'attack'})` (UI: **Dispatch to attack**) needs **war authority**: the destination's holder is formally at war with the captain.
* **The stamp.** `Campaign.warAuthorityStamp` records `{power, holder, target, key, instance, warId}`.
* **When it holds.** `warAuthorityHolds` requires all of these:
  * the same holder;
  * the same war instance and `warId`;
  * a formal war (`relation === 'war'`);
  * war status `war` (not ceasefire).
* **When it ends.** It ends on:
  * a ceasefire;
  * a peace;
  * a *new* war after a settlement (a different instance);
  * the target changing hands.
* **Lapsed in warp.** The note says so. At the end of the leg in flight, the formation **halts** (`halted`, `war-authority`): no attack order and a report. It never reaches the target under the lapsed order. A pending plain move is still flown.
* **Arrived under the war.** `g.order = 'attack'` and `g.warOrder` hold the stamp. Checked every day, it **stands down** (`hold`) the day the authority ends.
* **Queued attack orders** are re-validated when acknowledged.

## 6. Route-state matrix

| state | trigger | next state | effects |
|---|---|---|---|
| — | dispatch (co-located, no refusal, route plotted; attack: authority) | underway, leg 0 | members on leg 0; npc actors removed |
| — | dispatch to own system | arrived (same day) | set down |
| — | dispatch, members elsewhere, no link | — (queued order) | nothing moves |
| underway, in warp | day < legArrivalDay | unchanged | — |
| underway | leg ends, more legs | underway, leg+1 | crossing (observe, roll, blockade); detachments; next leg from today |
| underway | last leg ends | **arrived** | crossing; set down once; attack → `attack` + warOrder |
| underway, in warp | new destination / stop | underway + `pending` | note; replot at the end of the leg |
| underway, standing today | new destination / stop | superseded → new underway (seq+1) | replot from the system stood in |
| underway | leg ends with `pending` | superseded → new underway (seq+1) or arrived | crossing first; replot from the system reached |
| underway, attack | authority lapses in warp | underway + `warLapsedDay` | note |
| underway, attack | leg ends, authority lapsed | **halted** (`war-authority`) | set down there; no attack; report |
| underway | leg ends, every member detached | **halted** (`no ships`) | — |
| underway | leg ends, no route for pending | **halted** (`no-route`) | holds there |
| arrived, attack | authority lapses | arrived; `g.order = hold`, no warOrder | report |
| any | save / load | same | same leg, vessels, days |

**Per member at a crossing:**

| condition | result |
|---|---|
| operational, still a member, no own order | continues |
| destroyed on the roll or before | `detached: destroyed` / `lost` |
| disabled (roll or already) | stays; `detached: disabled`; §6 disabled state |
| moved to another formation | stays; `detached: reassigned` |
| own recall/rendezvous acknowledged | stays; `detached: ordered`; flies her order from here |
| trading started en route | stays; `detached: trading`; trades from here |

## 7. UI

* **Fleet & shipyard → formation row:**
  * buttons: **Dispatch to system** (becomes **Redirect to system** under way), **Dispatch to attack**, **Stop at next system** (under way);
  * the journey line: *"En route to Vulcan · leg 2/3 Orion → Tellar in warp, arrives day 23 · destination day 33 · crossed Orion"*, then *"Arrived at Vulcan day 33 via Orion, Tellar"*, or the halt reason.
* **Member rows:** *"in warp → Tellar (day 23)"*, and the status *"With Task Force · Tellar day 23 · Vulcan day 33"*.
* **Chart:** a new layer, **Formations under way**. The route flown is solid, with crossed systems dotted. The route ahead is dashed. A chevron marks where the formation is along its leg, labelled *"Task Force → Vulcan · leg 2/3 · day 33"*.

## 8. Carried forward (not in this round)

* **Blockade running.** Cloak and ship speed should later affect running a blockade and interception. At present a formation meets a blockade, records and reports it, and is neither slowed nor engaged by it.
* **Evacuation transports** still shuttle abstractly on the operation's route (EVACUATION-BLOCKADE-RULES §8). Where appropriate, they should eventually use this route traversal.
* **Crossing rolls for warships** use the traders' encounter table. Formation strength does not yet reduce it.
* **No convergence order.** A split formation must be brought together (rendezvous) before dispatch.
