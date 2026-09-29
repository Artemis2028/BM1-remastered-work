# Strategic movement unification

This round is stacked on `29710b1` (Doctrine Runtime Phase 4). It is not a doctrine expansion. Its purpose
is that everything which physically moves between systems moves the same way:

- one journey record;
- the chart's real leg lengths;
- every system on the way reached and processed exactly once;
- the one blockade resolver at every blockaded crossing;
- the reason for the movement re-checked at every boundary.

The inventory taken before any code changed is `STRATEGIC-MOVEMENT-INVENTORY.md`. The per-path
classification (UNIFIED, INTENTIONALLY ABSTRACT or DEFERRED) is `STRATEGIC-MOVEMENT-AUDIT.md`.

## 1. What was wrong at 29710b1

Only two movers flew real legs and ran blockades: the captain's formations and his traders. The inventory
found everything else fell into one of these patterns:

- **One hop a day, whatever the distance:**
  - every doctrine assignment;
  - the evacuation convoy ("one system per campaign day").
- **Teleport** — the hulls waited at the origin, then appeared at the target on the arrival day, with no
  intermediate system and no blockade:
  - AI war operations, including Dominion invasion and escalation;
  - damaged hulls sent to a yard (hop count in days);
  - blockade forces taking station.
- **Instant, multi-hop:**
  - operation survivors going home;
  - blockade reinforcements;
  - the Dominion corridor crossing and the Dominion withdrawal.
- **Created on arrival:** Dominion reinforcement convoys appeared at the bridgehead.

So a Klingon war fleet could cross a Terran blockade without meeting it. A convoy took one day for a hop
the captain's own formation needed nine days to fly. A ceasefire could not catch a fleet between systems,
because the fleet was never between systems.

## 2. One journey record

`src/strategic-journey.mjs` is the formation route record of FORMATION-ROUTE-TRAVERSAL-RULES, generalised
rather than duplicated:

```
{ id, seq, kind, ref, sponsor, origin, plotFrom, from, destination, path[], legDays[], legIndex,
  legDepartDay, legArrivalDay, startDay, etaDay, members[], vids{}, purpose, war, authority, meta,
  crossed[{system, day, leg, seq}], encounters[], detached[], replots[], pending, status, endReason, … }
```

The pure helpers are:

- `createJourney` — a `prior` record carries its history forward and the sequence number goes up by one;
- `scheduleLeg`, `legDue`, `advanceLeg`;
- `markCrossed` — the crossing guard, one crossing per `(seq, leg)`;
- `detachMember`, `arriveJourney`, `haltJourney`, `supersedeJourney`;
- `journeyEta`, `journeyPosition`, `journeySummary`.

**The captain's formations** (`main.js beginFormationTravel` / `crossFormationLeg`) now build and guard
their record with these helpers instead of an inline copy.

**Model movers.** Their records live in `book.journeys`. They are driven by `advanceJourneys`, which runs
every campaign day after planning and before operations are advanced. Doctrine journeys are stepped by
their own assignments in the doctrine day.

**Members.** A hull on a journey carries only the leg it is on (`h.transit = { journeyId, from, to,
arrivalDay, leg, seq }`), as a formation's members do. The journey record is authoritative.

**Kinds.** What a mover does at a crossing, on arrival, when turned back or when its reason lapses belongs
to its kind. Each kind registers hooks with `registerJourneyKind`: `valid`, `onCross`, `onArrive`,
`onForcedBack`, `onHalt`, `onDetach`, `keep`, `role`, `runMeta` and `runnerKey`. The kinds are:

| kind | movers |
|---|---|
| `operation` | AI war operations: planning, Dominion invasion and escalation, authored |
| `return` | operation survivors going home; forces turned back |
| `repair` | a damaged hull sailing to a yard |
| `blockade` | blockade forces taking station, and reinforcements joining |
| `evacuation` | evacuation convoys, the captain's and the AI's |
| `expedition` | the Dominion corridor crossing, Dominion reinforcements |
| `withdrawal` | the Dominion expedition going home |
| `release` | a leg in flight finished after its order ended |
| `doctrine` | every doctrine assignment, with its joined escorts |

## 3. Timing

- **Leg length.** Each leg takes `world.legDays(a, b)` days. The engine computes it exactly as a
  formation's leg: `Fleet.travelDays` over the route's warp distance. A wormhole transit takes one day. A
  world that gives no leg length (the pure fixtures) takes one day per hop.
- **Routing.** Model routes are fewest-jumps, as they always were, and respect `world.edgeOpen`: the
  uncharted wormhole stays open only to the Dominion.
- **In the default game:**
  - the median hop is 12 days, the mean 13.8, the maximum 81;
  - Orion → Earth is 10 days;
  - the evacuation round trip Paso → Alpha Centauri → Earth is 36 days, plus loading.
- **Doctrine milestones** are due on the real schedule. When a vessel reports in late, its later
  milestones are rescheduled by leg length. A reroute, a leave order or a new job taken in warp is planned
  from the end of the leg in flight (`replanPoint`), because a ship in warp never turns round mid-leg.
- **No back-dating.** A doctrine job never sets out earlier than the day its vessel reached the stop it
  stands at (`readyFrom`). A vessel found somewhere other than where its itinerary says (turned back on a
  leg it took the job on) is re-routed from where it actually stands (`realignItinerary`).

## 4. Crossing processing, exactly once

`crossJourneyLeg` handles the crossing at the end of every leg, in this order:

1. **The crossing guard** (`markCrossed`, keyed on `(seq, leg)`). A second call for the same leg (the same
   day stepped twice, or a reload) changes nothing and counts `duplicateCrossingsPrevented`.
2. **Moving members.** Each member arrives. A member disabled, surrendered or lost while the leg was in
   flight is never carried on: it drops out where it last stood, since the model has no position between
   systems. A member reassigned, or whose own order ended in warp, is set down at the crossing.
3. **The crossing effect** (`journeyCrossed`). The engine uses it to place the captain's own ships and to
   file the crossing as news where the captain has a real source.
4. **Blockades.** Every blockade there that bears on the sponsor is run through `resolveBlockadeRun`, once
   per `(seq, leg, blockade)`.

`settleCrossing` then decides what happens next, in order:

1. the kind's `onCross`;
2. no ships left;
3. turned back;
4. the reason still holds (`valid`);
5. a pending order (a replot);
6. the next leg, or arrival.

**On save/load:** a reload mid-leg repeats nothing, skips nothing, restarts nothing and delivers nothing
early. The crossing record, the sequence number and the leg timing are all in the saved book, and the
engine's news mark for a crossing is stored on the crossing record itself.

## 5. Blockades

There is no new resolver. Every model crossing runs `resolveBlockadeRun` with the journey's operational
members as the runner. This keeps:

- cloak, speed and escort strength;
- persistent damage and disablement on the real hull records;
- what the crews saw.

The runner key is the owner's id plus the journey, sequence and leg (`<ref>:<journey>:s<seq>:l<leg>`),
so the blockade's run log attributes every run to the evacuation, assignment or blockade that made it.

Now running blockades:

- war operations (baseline reproduction: pure test 11);
- returns, yard runs and Dominion forces;
- doctrine vessels;
- evacuation convoys, at the actual intermediate system on the day they reach it.

## 6. Authority

The journey carries its purpose and authority: `war` (a `warAuthorityStamp`), `authority`, `ref`. At every
system reached, the kind's `valid` hook asks whether the reason for the movement still holds:

| kind | the reason re-checked | if it no longer holds |
|---|---|---|
| operation | the operation is still on, and its war stamp holds (same war instance, same holder) | a lapsed war stands the operation down there: `stood-down`, recorded as `staleAt`, and the force turns home |
| blockade | the blockade is still forming or active, and its war stamp holds | the blockade closes and its ships turn home |
| doctrine | the assignment is active, and a raid's war stamp holds | the vessel stops there, and its objective is stood down by the Phase 3 check. It never sets out again under that stamp |
| evacuation | the evacuation is active | — |
| repair | the yard's world is still its own | it stops and looks for another yard |
| expedition | the invasion is still on, and the destination is held by the Dominion or an active pact partner | it turns for the staging system |
| return, withdrawal, release | nothing: these are movements home | — |

A superseding order (a stand-down, the end of the owner's record, a reroute) is taken at the next system,
as `pending`. The same ships continue with the next sequence number and the same history (pure test 15).

A ceasefire can no longer produce a stale strike on arrival:

- pure tests 16 and STALE-AUTHORITY-MOVEMENT;
- in-game CEASEFIRE-MOVING-FLEET;
- the raid reproduction, pure test 9: at `29710b1` the raider still flew on to its target after the
  ceasefire.

## 7. Disabled, awaiting-crew and surrendered hulls; membership

- **Selectors.** `hullUnavailable` now includes a hull in warp. Every selector excludes disabled,
  crewless, surrendered and in-warp hulls:
  - evacuation, blockade and reinforcement selectors;
  - AI planning;
  - the scene raid force;
  - doctrine's `freeHulls`, and doctrine's `issueAssignment` on a hull in warp on someone else's order;
  - yard runs.

  (Pure tests 17–19 each watch one hull for up to 60 days while it stays in its state.)
- **No auto-return, no auto-repair.** A disabled hull stays where it was disabled until real recovery acts.
  A surrendered operation survivor is held where it surrendered and flown nowhere. The loaded scene claims
  only the force actually standing at the target, and a capture moves nobody else.
- **Membership.** A member that becomes ineligible is detached with its vid (`detached[]`), and the rest
  continue. Nothing is cloned (pure tests 20 and 23; in-game CANCEL-IN-WARP). An evacuation's lift drops
  with a lost or disabled transport (pure test 6).

## 8. Save/load

`book.journeys` is part of the campaign book (`upgradeCampaignBook` adds it) and is bounded: every journey
under way, plus the newest 120 finished ones. Older saves keep working:

- an operation saved mid-move keeps its old one-time arrival rule;
- a convoy saved mid-route picks up from where its ships actually are and flies journeys from there;
- an assignment saved under the old counters reads its departure day from them.

## 9. What real travel time does to doctrine deadlines (a finding, not tuned)

The doctrine package's objective windows were written when one hop took one day. Examples:

- a rescue must be finished within 10 days of the survivor report;
- an investigation within 14 days;
- the `maxResponseHops` reach.

Capacity is now judged on real days: `viability` reads each candidate's route in leg days, from the end of
its leg in flight. So on the real chart a distant ship correctly declines jobs it cannot finish in time.
In the in-game end-to-end story, for example, the Vulcan relief ship defers the rescue because "2 jumps,
20 days + 1 > 10".

This is the brief's intended effect, but it will change how often doctrine acts. **Rafael's decision:** are
the doctrine windows meant in days (keep, as now) or in legs (scale them by leg length)? Either is a small
data or config change, and it is not made here.

The phase 2, 3 and 4 in-game doctrine gates, and the doctrine-runtime end-to-end story, are authored one
hop at a time. They run under a labelled debug override, `campaign legs 1` (never saved), that makes
every leg one day. Doctrine at the chart's real lengths is covered by:

- the rest of `doctrine-runtime-gate`;
- `strategic-movement-gate`;
- the pure suites' unequal legs.

## 10. Engine integration, UI and debug

- **World hooks.** `buildCampaignWorld` supplies `legDays` and `edgeOpen`.
- **The captain's ships on model journeys** (his evacuation convoys and blockade forces):
  - They are mirrored from the journey record on every `syncPlayerPolity`, so a leg in flight survives
    the daily rebuild.
  - `journeyDeparted`, `journeyCrossed` and `journeyEnded` place his fleet entries.
  - An operation ended while its ships are in warp holds them until the leg ends (in-game CANCEL-IN-WARP
    and PLAYER-BLOCKADE-JOURNEY).
- **News.** Another power's war fleet, blockade force, expedition or convoy passing a system is filed once
  (for example "War fleet passing — Epsilon"), and only where the captain has a local, fleet or relay
  source. The mark is stored on the crossing, so a reload never files it twice.
- **Operations card.** The evacuation card shows the leg in flight and its real ETA ("outbound: Alpha
  Centauri → Earth, arrives day 20 · reaches Earth day 20"). The round trip in its details is computed from
  real legs.
- **Debug.** *Cheats & Debug → Strategic journeys (debug)* shows:
  - counters: under way, started, crossings, duplicate crossings prevented, arrived, halted, forced back,
    stale orders cancelled, mean leg, blockade runs by kind;
  - one row per movement under way: actor and vids, purpose, origin, current leg, destination, departure
    and arrival, authority (with the war stamp, marked "lapsed" when it no longer holds), and the next
    blocker on the route;
  - the ten movements to end most recently, each with its end reason and any stale stop.

  The player UI stays as concise as it was.
- **Debug override** `campaign legs N|chart` (see §9).
- **Scene raid.** The loaded scene's own ambient raid is launched `immediate`: the scene is its arrival.
  Its survivors fly home by journey.

## 11. Before / after

| path | 29710b1 | now |
|---|---|---|
| player formations | real legs, crossings, blockades (canonical) | unchanged; the record is built by the shared module |
| player traders | real legs, crossings, blockades | unchanged (record shape deferred) |
| doctrine patrol, defence, raid, investigation, rescue, escort, return | one hop per day; blockades run | real legs on shared journeys; blockades run; authority checked at each system; replans in warp start at the leg end |
| evacuation convoy | one system per day | real legs; the run at the intermediate system on the day it gets there; delivery only on arrival; turned back → home, empty |
| AI war operations | teleport on the arrival day; no blockade; no intermediate systems | real legs; every system crossed; blockades run; ceasefire caught at the next system; engages only with the force actually there |
| operation survivors home | instant | `return` journeys; a ship in warp turns home at the leg end |
| damaged hull to a yard | teleported, then waited | `repair` journey; the yard must stay its own |
| blockade forming / reinforcement | teleported | `blockade` journeys; forming until the ships arrive |
| Dominion corridor / withdrawal / reinforcements | instant / instant / created at the bridgehead | `expedition` / `withdrawal` / created at staging and flown in |
| scene raid | one hop instant | unchanged (the scene is the move); survivors fly home |
| captain's own warp | one warp over the whole route | unchanged — **deferred** to the tactical handoff |
| pirate group follow; stranded recovery | local; in place | unchanged — **deferred** (tactical handoff; towing/salvage) |

## 12. Baseline reproductions (29710b1)

The same test files were run against the frozen tip's tree:

- pure: `BM1_MOVEMENT_ROOT=<29710b1 tree> node scripts/strategic-movement-test.mjs`;
- in-game: `strategic-movement-gate.cjs` with `BM1_TEST_ROOT=<29710b1>/dist`.

The results are in `evidence/baseline-29710b1/`.

**Pure suite at 29710b1: every baseline-defect check fails on its own assertion.**

| check | failure at 29710b1 |
|---|---|
| 1 | "Vega day 3 → Earth day 4: the 3-day leg took 1" |
| 2 | delivery on a day the convoy was not at Earth |
| 9 | "the raider reached Vega after the ceasefire" |
| 10 | "never at Border": the fleet went Qonos → Vega with no day at Border |
| 11 | "the war fleet slipped past the blockade without a run" |

- The preservation checks (8) pass on both trees.
- The new-feature checks fail on the missing journey record.

**In-game gate at 29710b1: 1/10.** Both baseline-defect checks fail on their own assertion:

| check | failure at 29710b1 |
|---|---|
| EVAC-REAL-LEGS | "Alpha Centauri day 3 → Earth day 4; the leg is 9 days" |
| AI-MULTI-LEG | the Klingon fleet was never at the intermediate system: it stood at its origin, then at its target on day 3, for a 20-day route |

- The preservation check (FORMATION-UNCHANGED) passes on both trees.
- The new-feature checks fail on the missing record.
- CEASEFIRE-MOVING-FLEET is a new-feature check, not a baseline defect: at 29710b1 a ceasefire stands a
  moving operation down at once and puts its hulls straight back home, so no stale strike lands there
  either. What is new is that the fleet flies its leg out and turns at the boundary.

## 13. Tests

**Pure suite:** `test:movement` (`scripts/strategic-movement-test.mjs`), 27 checks:

- required regressions 1–24;
- the integrated scenarios EVACUATION-REAL-TIME, LEGACY-AI-ROUTE-INTEGRATION and STALE-AUTHORITY-MOVEMENT;
- the fixture has legs of unequal length (1, 2 and 3 days).

**In-game gate:** `test:movement:ingame` (`scripts/strategic-movement-gate.cjs`), 10 checks:

- EVAC-REAL-LEGS, EVAC-MID-LEG, EVAC-BLOCKADE-CROSSING;
- AI-MULTI-LEG, AI-SAVELOAD-NO-REPEAT;
- CEASEFIRE-MOVING-FLEET;
- DEBUG-JOURNEYS;
- PLAYER-BLOCKADE-JOURNEY, CANCEL-IN-WARP;
- FORMATION-UNCHANGED.

It produces the five screenshots.

**Measurement:** `measure:movement` (`scripts/strategic-movement-longrun.cjs`), §14.

**Earlier suites adjusted for real time.** The adjustments are listed so the reviewer can see none of
them weakens a check:

- **`evac-blockade-gate`:**
  - windows are counted in real round trips instead of fixed days;
  - EVAC-BLOCKADE-INTEGRATION and BLOCKADE-WEAKENED judge the blockade and the escorts on the runs
    themselves (how often the convoy is let through), and record deliveries per day as measurement.
    With 38-day trips, a turn-back at the home port costs the three retry days, not a trip.
- **`blockade-running-gate`:** windows are three real round trips. The test also counts a run as the
  evacuation's by the new runner key.
- **`blockade-running-test` 13:** escorts are compared over five seeded campaigns instead of one. One seed
  is a coin: the runner key changed, and with it the seeding of individual runs.
- **`dominion-war-gate`:**
  - the corridor is a real one-day crossing, so PACT-ACTIVE advances one day;
  - the DOMINION-CEASEFIRE fixture also ends the journey of the operation it resolves by hand.
- **`doctrine-runtime-gate`:**
  - the patrol is lost on station, after flying to it;
  - the windows are counted in legs;
  - REENTRY runs 100 days instead of 60;
  - the end-to-end story runs under `campaign legs 1` (§9).
- **`doctrine-phase2`, `phase3` and `phase4` in-game gates:** run under `campaign legs 1` (§9).
- **`campaign-probe`, `vessel-identity-gate` and `foreign-stock-gate`:** their fixtures stage "an
  operation engaged at the captain's system now" by hand. They now do it as the game's own scene raid
  does: the hulls are placed at the scene, and the operation is launched `immediate`. Before, they
  launched an ordinary operation, and that now flies its route.
- **`campaign-blocker-probe`:**
  - B8 and F2 choose an attacker actually at war with the captain's empire. Before, the fixture's own
    operation was stood down that day at `29710b1` too, and the check passed only because another power's
    raid landed on the world inside the window. War fleets that fly real legs no longer arrive that fast.
  - R9 exposed two code issues, both fixed:
    - operation survivors flying home kept pointing at their finished operation;
    - the forced `campaign phase dormant` reset left the Dominion's ships flying. It now sets them down
      where they last stood (`haltJourneysOf`, used only by that labelled override).
- **Pure:** `campaign-strategy-test` (the war fleet takes its legs before engaging) and
  `doctrine-runtime-test` 31/33 (a leg in flight is flown out; a repaired hull departs the next day and
  flies its one-day leg).

## 14. Measurements (default campaign, one seed, 500 days, the real game)

Source: `evidence/strategic-movement-longrun-{candidate,baseline-29710b1}.json`. **These are balance
observations, not regressions.** Real travel time and blockade exposure change the campaign, as the brief
anticipates.

| | 29710b1 | candidate |
|---|---|---|
| journeys under way (mean / max) | — (no journeys) | 22.8 / 35 |
| journeys started / crossings / arrived / halted | — | 509 / 857 / 472 / 9 |
| mean leg | 1 day per hop (model) | 13.2 days |
| blockade runs by movement type | evacuation 4 | operation 8, repair 1, doctrine 1 |
| forced back | — | 1 |
| disabled hulls (max at once) | 3 | 6 |
| duplicate crossings prevented | — | 0 (none arose; the guard is exercised by pure 13/14 and in-game AI-SAVELOAD-NO-REPEAT) |
| stale orders cancelled | — | 19 |
| evacuations: started / completed / mean completion | 5 / 1 / 18 days | 3 / 0 / — (one still flying at day 500; round trips are weeks long) |
| AI operations: launched / engaged / mean days to engage | 84 / 77 / 1.3 | 50 / 29 / 46.6 |
| operation outcomes | captured 54, absorbed 20, stood down 9, withdrew 1 | captured 24, absorbed 11, stood down 10, moving 3, engaged 1, destroyed 1 |
| blockades | 2 (forming 4 days) | 7 (forming 41 days on average) |
| battles / hulls lost | 64 / 60 | 35 / 103 |
| losses: operations (attacker / defender) / blockades | 18 / 39 / 0 | 23 / 60 / 12 |
| world control changes | 60 | 24 |
| formal war-state changes | 21 | 15 |
| doctrine: incidents / objectives completed / deferred | 85 / 53 / 571 | 29 / 34 / 202 |
| save size at day 500 | 894 KB | 1,056 KB (+18%) |

**Reading.**

- War is slower and bloodier per battle:
  - operations take weeks to arrive, and fewer are launched;
  - forces arrive concentrated, so defenders lose more per battle;
  - stalled wars turn to blockades far more often, and those blockades bleed ships.
- Hull losses shift to the Bajoran, Cardassian and Breen front.
- **Evacuations complete far less often in 500 days.** The AI's evacuation targets were sized for 3-day
  round trips.
- Candidates for a tuning round, not made here:
  - AI planning horizons and evacuation targets in leg time;
  - the evacuation retry delay;
  - the doctrine windows (§9).

The save grows about 18%, which is the bounded journey history.

## 15. Independent review

An independent reviewer read the diff and reproduced defects with scratch scripts. Every confirmed
finding was fixed before packaging:

1. **(High) A doctrine job could be back-dated and fly a non-adjacent hop past a blockade.** This happened
   after being pre-empted in warp and turned back. Fixed: `readyFrom`, `realignItinerary`, and a
   `blocked()` when the vessel is in warp on another order. The reproduction now departs day 7, from where
   the ship stands, through Vega.
2. **(Medium) A pre-round convoy with its position counter one system ahead stalled forever.** Fixed: it
   resumes from its ships' actual position, and holds if it cannot sail.
3. **(Medium) A disabled hull was teleported on a local capture.** Fixed: the scene claims only the force
   on station, and reconcile and capture touch only those ships.
4. **(Medium) A surrendered survivor was flown home and freed in warp.** Fixed: it is held where it
   surrendered. Doctrine's `freeHulls` also skips in-warp and crewless hulls.
5. **(Medium) A yard run to a yard lost mid-route never ended.** Fixed: the `repair` kind's `valid` hook,
   with a retry.

Suspicions 6–10 were also addressed:

- blockade ships dropped on the way are released to the captain (`strategicShipReleased`);
- halted journeys without an owner hook release their ships;
- a job ended in warp flies out its leg the same day;
- escorts whose own job ended are set down at the next crossing (`keep`), and a doctrine order no longer
  takes a hull in warp on another order;
- `expedition` re-checks the invasion and the destination's holder.

Dead code was removed (`endJourneyHere`, and `releaseHulls`'s unused position argument), and the audit's
claims were corrected.

## 16. Still deferred (carried into the handoff)

- **From this round's audit:**
  - the captain's own warp → tactical handoff;
  - the pirate group's local follow → tactical handoff;
  - stranded recovery movement → towing/salvage;
  - the trade record's shape.
- **The standing list:**
  - strategic interception → tactical combat handoff;
  - towing/salvage;
  - NPC tactical-scene persistence;
  - autonomous war declarations;
  - doctrine invasion/occupation;
  - broad covert doctrine;
  - Hirogen hunting;
  - Borg assimilation;
  - Gorn activation;
  - Tactical Cube;
  - treaty expansion.
