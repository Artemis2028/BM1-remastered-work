# Strategic time-scale correction

**Basis:** stacked on `f34542d` (STRATEGIC-MOVEMENT-UNIFICATION), which is kept as it is. Real leg travel
stays, and ships are no faster.

`f34542d` put every strategic movement on its real legs: the chart's `Fleet.travelDays`, a median hop of
12 days, and a mean of 13.8. The systems that planned around those movements still assumed that a hop took
about a day. This round corrects those planners and leaves the movement alone.

Every estimate below uses the same route the journey will actually fly, with each leg its real length
(`world.legDays`). Travel stays ship-independent, and there is no planning-only speed:

- `plotJourney` for operations, returns, repairs and Dominion movement;
- `routeBetween` for doctrine assignments;
- `e.route` for evacuations.

## 1. What assumed a hop ≈ a day (inventory)

| # | where | at f34542d | the assumption | status |
|---|---|---|---|---|
| 1 | doctrine rescue / investigation capacity | `arrive + dwell > day + 10 / 14` refused; reach capped at `maxResponseHops` 6 | The deadline was a one-hop-era day clock, and reach was counted in jumps. | **fixed** (§2) |
| 2 | objective deadlines (investigate, rescue) | `createdDay + 14` / `+ 10` | same | **fixed** (§2) |
| 3 | "can it still finish?" check | `day + remaining jumps + dwell > deadline` | Jumps were used as days. | **fixed**: the remaining itinerary in real days |
| 4 | defence reach and deadline | within `defenseHops` 2 jumps; `day + 10` | same | **fixed**: reach `defenseMaxTravelDays` 20; deadline `arrival + 10` |
| 5 | raid deadline | `day + 15` | A multi-leg raid expired before it arrived. | **fixed**: `arrival + 15` |
| 6 | escort capacity and deadline | "meets it first" if `jumps ≤ i`; `day + 20` | Jumps were compared as time. | **fixed**: the escort's ETA against the charge's real arrival at each stop; deadline = the charge's delivery + 5 |
| 7 | delivery / construction contract dues | `day + 1 + jumps + 3` / `day + 30` | same | **fixed**: `day + 1 + days + slack`; a project covers its deliveries' round trips |
| 8 | search-area freshness | `today − last seen ≤ 30` | An overdue ship is known to be missing only after its whole way home was due, so every distant loss was already stale. | **fixed**: two clocks (§2) |
| 9 | AI target choice | the first target by jumps that is weaker than the force *now* | No ETA; the defence on arrival was ignored. | **fixed** (§3) |
| 10 | front accounting | `defendsHere` counted a ship in warp at the system it left | double counting | **fixed**: no ship in warp defends anything (§3) |
| 11 | Dominion escalation target | by jumps, defence now | same as #9 | **fixed**: soonest by ETA, defence on arrival |
| 12 | Dominion expedition strength | reinforcements still in the corridor counted | Strength before arrival. | **fixed** (§6) |
| 13 | evacuation destination | fewest jumps; `evacMaxHops` 6 | A distant refuge could be one jump; a near one could be several. | **fixed** (§4) |
| 14 | AI evacuation target | the whole target, with 3 transports | Trips are weeks long, so most never finished. | **fixed** (§4) |
| 15 | evacuation retry at a blockaded origin | 3 days | A one-hop-era wait. | **fixed**: 1 day |
| 16 | evacuation when the origin falls | ended at once, stranding a loaded convoy in flight | Arrival was assumed to be imminent. | **fixed**: the convoy lands its people |
| 17 | routine patrol target and stay | any frontier neighbour; 3 days on station | Legs of up to 81 days; 11% of a patrol on station. | **fixed** (§5) |
| 18 | area patrol area | every neighbour | same | **fixed**: neighbours within 15 days (the nearest if none) |
| 19 | patrol replacement | a patrol that ran late was replaced while still in warp | duplicates | **fixed** (§5) |
| 20 | survey walk / trade ports | by jumps | same | **fixed**: a day budget (30 out and back / 30 one way) |
| 21 | repair yard / operation's home | nearest by jumps | same | **fixed**: nearest by the days the journey flies |
| — | message relay (`networkHopsPerDay`) | jumps per day | Subspace traffic, not ship travel. | unchanged, intentionally |
| — | blockade supply by jumps from own ground | jumps | A supply-chain abstraction, not a clock. | unchanged, intentionally |
| — | Dominion contender reach (`dominionContenderHops`) | jumps | Topological eligibility, part of opportunity-based entry. | unchanged, intentionally |
| — | patrol response radius (`patrolResponseHops`) | jumps | Area membership, not time. | unchanged, intentionally |

## 2. Doctrine deadlines: physical versus objective clocks

The rule is
`objectiveDeadline = createdDay + estimatedTravelDays + onStationBudget + boundedSlack`, with
`estimatedTravelDays` taken from `vesselEta`.

`vesselEta` gives the day a vessel can be at a system:

- from where it stands today;
- or, if it is in warp, from the end of the leg it is flying, on the day that leg ends;
- or, if it is setting out today on a doctrine leg, from here today, as `issueAssignment` itself does.

**Deadline table**

| objective | f34542d | now | clock |
|---|---|---|---|
| investigation | `created + 14` | `max(created + 14, arrive + max(dwell, 4) + 4)` | objective: travel + on station (4) + slack (4) |
| investigation reach | ≤ 6 jumps | ≤ 45 days' travel, **and** arrival before the trail runs cold (`last seen + 90`) | physical (evidence life) |
| rescue | `created + 10` | `min(survivorsUntil + dwell, arrive + dwell + 2)` | **physical**: survivor endurance decides |
| rescue reach | ≤ 6 jumps, and `arrive + dwell ≤ created + 10` | `arrive ≤ survivorsUntil` | physical |
| defence | `created + 10`; reach 2 jumps | `arrive + 10`; reach 20 days | objective |
| raid | `created + 15` | `arrival + 15` | objective |
| escort | `created + 20`; meet if jumps ≤ stops | `max(created + 20, delivery due + 5)`; meet if ETA ≤ the charge's arrival there | objective |
| delivery contract | `day + 1 + jumps + 3` | `day + 1 + days + 3` | objective |
| construction contract | `day + 30` | `max(30, deliveries × (2 × one-way + 2) + 3)` | objective |
| still viable? | `day + jumps left + dwell` | `day + remaining real days + dwell` (not for a vessel silently lost, which the command does not know about) | — |
| search area fresh | `today − last seen ≤ 30` | `today − last seen ≤ 90` (physical) **and** `today − learned ≤ 30` (decision) | both |

**Survivor endurance is not inflated.** Survivors are still `survivorWindowDays` = 20 from the report, and a
stranded crew keeps `crewSurvivalDays` = 20. Only the planning changed. A rescue is sent when the relief
can arrive inside that window and refused (`failedByDistance`) when it cannot. On arrival, the ground
truth (`untilDay`) still decides whether anyone is left.

Each objective carries `o.plan`:

- `etaDays`, `arriveDay` and `onStationDays`;
- `survivorsUntil` / `freshUntil`;
- `basis`.

This is shown in the planning debug table.

## 3. War planning and front accounting

**`forceAccount(book, world, system, byDay, attacker)`** returns three separate figures:

- `standing`: what defends there now, where a ship in warp defends nothing, either where it left or where
  it is going;
- `incoming`: defenders' journeys to that system arriving by `byDay`. Only ships that will defend when they
  arrive are counted: a force going home (`return`), or a doctrine vessel on an active defence objective.
  An assault, a blockade force, a freighter or a patrol arriving there is not a defence;
- `later`: the same, arriving after `byDay`.

`atEta = standing + incoming`, so nothing is counted twice.

**`chooseOperationTarget`**:

- **ETA:** the slowest group's days on the route its journey will fly (`forceEtaDays`).
- **Skip rules:** a target is skipped when:
  - a force of its own is already on the way (no duplicate replacement);
  - there is no route;
  - the ETA is more than `maxOperationEtaDays` = 120;
  - the defence on arrival outweighs the force (`minReadinessRatioToAttack`).
- **Score:** `value / (1 + eta / 30)`, where `value = 1 + population / 1000`. A target twice as far away is
  worth planning for less but is not rejected.
- **Record:** `op.plan` = `{etaDays, arriveDay, defenseNow, defenseAtEta, incomingDefense, strength, score}`.
  `p.lastPlan` keeps every target weighed and why.

The engagement lands on `op.plan.arriveDay`: pure test 6, and the in-game `WAR-PLAN-ETA` check (engaged
day 67 = planned day 67).

## 4. Evacuation: destination and cadence

**Destination** (`evacuationDestinations`):

- **Valid refuges:** friendly, settled, not under heavy blockade, not under attack, and no more than
  `evacMaxOneWayDays` = 45 days one way. A hostile or inaccessible world is never a refuge, however close.
- **Route:** the quickest in real days, from a single-source Dijkstra over `journeyNeighbours`. The convoy
  flies exactly that route (`e.route`).
- **Score:**
  - days one way;
  - plus 10 per danger: a front-line refuge (an enemy next door) or a blockade on the way;
  - plus 5 if the settlement is too small for the evacuation's target (capacity).

The captain's own list is ordered by days and front line as *he* sees them: visible neighbours only, with
no blockades he may not know of.

**Cadence:**

- The AI takes up to 4 transports.
- **Target:** its target is what those transports can move before the attackers arrive (their operation's
  real `arriveDay`), at least one full lift:
  `trips = 1 + floor((window − load − 1) / (2 × days + load))`.
- **Retry:** a convoy turned back at the origin's blockade retries the next day, not after 3. An old save
  that still carries the stock 3 takes the new value once (`book.timeScale`).
- **Origin lost:** if the origin is lost while a loaded convoy is in flight, the convoy flies on and lands
  its people. The evacuation ends `partial` when they arrive, provided the refuge still takes them on that
  day. A retaken origin clears that state.

**Before and after (500 days, same seed):**

| | f34542d | candidate |
|---|---|---|
| evacuations started / completed | 3 / **0** (1 failed, 1 partial, 1 active) | 10 / **9** (1 active) |
| people moved | 38,800 | 337,200 |
| mean one-way to the refuge | 51 days | 14.8 days |
| refuge distance (one way) | ≤10: 1 · 11–20: 1 · >45: 1 | ≤10: 4 · 11–20: 4 · 21–30: 2 |
| mean days start → completion | — | 45.2 |
| mean cycle (days per trip) | — | 21.2 |

## 5. Patrol cadence

- **Routine patrol legs:** a leg of at most `patrolMaxLegDays` = 15, or the shortest if none is that short.
- **Area patrols:** neighbours within 15 days, or the nearest.
- **Time on station:** `max(dwell, ceil(leg × 0.5))`. A patrol exists to be somewhere, so a weeks-long leg
  earns a proportionate stay.
- **Replacements:** a patrol still in warp counts against its power's patrol budget even when it has run
  late, so no replacement is sent while it flies (`patrolReplacementHeldDays` counts those days).
- **Garrison:** the garrison floor is untouched: `spareHulls` still leaves `homeGarrisonPerWorld`.

| (500 days) | f34542d | candidate |
|---|---|---|
| doctrine patrol-days travelling / on station or home | 1,573 / 212 (88% travelling) | 1,474 / 463 (76%) |

## 6. Dominion

The following are preserved:

- opportunity-based entry;
- the wormhole traversal rules;
- the expeditionary capacity model;
- persistent wars and pacts.

No calendar scripting was added. Two changes:

- **Reinforcements:** a reinforcement counts toward the expedition only after it physically arrives. A hull
  on a corridor-crossing or reinforcement journey (kind `expedition`) is `incomingStrength`, not strength.
  Central does not call the expedition collapsed or stranded while such ships are on the way. Ships moving
  about the theatre (an assault, a return) are still its strength.
- **Escalation targets:** these are ordered by ETA against the defence on arrival.

## 7. Measurement (500 days, default campaign, same seed; `scripts/strategic-movement-longrun.cjs`)

| | f34542d | candidate |
|---|---|---|
| mean leg | 13.22 days | 11.61 days |
| journeys under way (mean / max) | 22.8 / 35 | 20.1 / 32 |
| AI operations launched / engaged | 50 / 29 | 42 / 36 |
| operation ETA, planned / actual (mean days) | — / 47.6 | 53.3 / 53.3 |
| operations cancelled while under way | 9 | 2 |
| operation outcomes | captured 24, absorbed 11, stood down 10, … | captured 32, stood down 3, destroyed 2, … |
| battles / hulls lost / control changes | 35 / 103 / 24 | 37 / 107 / 32 |
| blockades | 7 | 3 |
| patrol travelling share | 88% | 76% |
| rescue proposed / feasible / failed by distance | 0 / 0 / 0 | 0 / 0 / 0 (no survivor incident arose in this campaign; exercised by the tests) |
| investigations proposed / feasible / failed by distance | 0 / 0 / 0 | 3 / 3 / 0 |
| evacuations started / completed | 3 / 0 | 10 / 9 |
| forces per day: standing / committed / in transit | 337 / 34 / 50 | 341 / 23 / 55 |
| save at day 500 | 1,056,324 bytes | 1,045,457 bytes |

The run was **not** tuned toward the 29710b1 numbers.

**The investigations:**

- One recovered its evidence.
- One arrived on day 438, as planned, searched its full budget, and closed at its deadline having found
  nothing.
- One was stood down when the missing ship came home.

The rescue and investigation counters count each incident once, at the first check that reaches the ETA
question: feasible, or refused because the arrival misses the window.

## 8. Gates

- **Pure** — `test:timescale`: regressions 1–18 plus ETA-AWARE-RESCUE, ETA-AWARE-WAR-PLANNING and
  EVACUATION-CADENCE. Run against `f34542d` (`BM1_TIMESCALE_ROOT`), all six baseline-defect checks fail on
  their own assertions.
- **In-game** — `test:timescale:ingame`:
  - INVESTIGATION-TWO-LEGS;
  - DEBUG-OBJECTIVE-PLAN;
  - RESCUE-BY-ETA;
  - WAR-PLAN-ETA;
  - EVAC-NEAR-REFUGE;
  - NO-INSTANT-MOVEMENT.
- **ETA-AWARE-RESCUE** covers nearby, distant and better-positioned relief:
  - **Nearby:** one jump, 14 days, can reach the survivors.
  - **Distant:** 55 days, is refused.
  - **Better-positioned:** two jumps, but 5 days on its actual route. The command sends it, and it arrives
    on the planned day (day 6).

  There is no speed modifier: every ship moves by the chart.
- The `f34542d` movement pure gate (`test:movement`) runs unchanged.

**Earlier gates adjusted, and why.** Each failed on this round's first clean-tree suite run on an
assumption that the round removed. None of them weakens what the gate is for:

| gate | check | what changed |
|---|---|---|
| `test:movement:ingame` | AI-MULTI-LEG | It counts only its own fleet's sightings. A Terran war fleet from the AI's own plans passed the same system in the same weeks. |
| `test:doctrine:ingame` | REENTRY-NO-INCIDENT | "Three routine patrols in 100 days" now means three issued, one after another, with at least one seen completing. It no longer requires three completed and still in the book: patrols now stay on station in proportion to their leg (cycle about 34 days), and the book prunes closed jobs. The incident assertion (none manufactured) is unchanged. |
| `test:evac-blockade:ingame` | AI-REASONS | "Quiet worlds are left alone" now means no AI evacuation of a world no assault was sent against. The AI's own wars now pick populous targets in the first weeks, and evacuating those is the rule working. |
| `test:blockade-running:ingame` | BLOCKADE-RUN-INTEGRATION | 1. The scenario's blockade is given the patience to outlast the three phases it compares. With the stock 90 days it withdrew during the first phase on every build since `f34542d`, so the escorted phases met no blockade at all. 2. Escorts are scored on the runs and on breaking the blockade, and deliveries must not fall. The earlier pass came from the unescorted convoy's 3-day wait after each turn-back; with the 1-day retry, both convoys' deliveries are bounded by their round trips. |

**The planning debug section** sits last in the dialog, so the older debug sections keep their place.
Photographing it hides the rest, so the page stays within Chromium's texture limit at 2× scale.

**Phase 4 isolation measurement** (`measure:doctrine:p4`):

- Doctrine still creates no war (`doctrineCreatedWars` 0).
- The war records with Phase 4 on and off are no longer identical: 19 and 17 changes, diverging from day
  298.
- AI target choice now weighs the defence on arrival and a scored ETA, so the ships Phase 4 enforcement
  commits change the AI's plans.

The coupling was there before; the old "first target by jumps" planner was simply insensitive to it.

## 9. Debug

The Cheats & Debug dialog has a new section, **ETA-aware planning (debug)**, showing:

- forces standing, committed and in transit;
- each power's last war plan, with every target: jumps, ETA, defence now, incoming defence, defence on
  arrival, score and decision;
- operations under way: planned ETA, and standing / incoming / later at the target;
- evacuations: refuge, days each way, cycle, trips before the threat, other refuges;
- the doctrine ETA counters;
- doctrine objectives: ETA, time on station, deadline and its basis.

## 10. Carried forward (not implemented)

- **SHIP-DEPENDENT STRATEGIC SPEED** — its own bounded future round, not folded into this correction.
  `Fleet.travelDays(route.distance)` stays authoritative for actual journey timing until then. Future design
  requirements:
  - different ship classes may have different strategic warp speeds;
  - formations move at the slowest applicable member unless a future rule says otherwise;
  - convoy escorts cannot make transports travel faster;
  - damage or engine condition may eventually reduce strategic speed;
  - route ETA, actual journey timing, AI planning, rescue feasibility, interception, evacuation and UI must
    all use the same speed model;
  - existing wormhole and special-route fixed traversal rules must remain explicit;
  - no planning-only speed estimates that disagree with actual movement.
- **Also carried forward:**
  - strategic interception → tactical combat handoff;
  - the captain's warp → intermediate/tactical handoff;
  - the pirate group's local follow → tactical handoff;
  - towing/salvage and stranded-hull recovery movement;
  - trader record-shape consolidation;
  - treaty expansion (DMZs, inspections, tribute, reparations, basing rights, transit guarantees);
  - NPC tactical-scene persistence;
  - autonomous war declarations;
  - doctrine invasion/occupation;
  - broad covert doctrine;
  - Hirogen;
  - Borg;
  - Gorn;
  - Tactical Cube.

**Known limits, recorded rather than tuned:**

- A convoy turned back at a blockaded origin now meets the blockade daily instead of every third day. Each
  attempt is a real run; the AI still abandons an evacuation at `evacAbandonLossShare`.
- The escort's estimate of the charge's arrival ignores any waits the charge has at intermediate stops, so
  it errs toward refusing a marginal escort.
