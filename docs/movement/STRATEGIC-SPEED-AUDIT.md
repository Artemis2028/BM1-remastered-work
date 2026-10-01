# Strategic speed audit (SHIP-DEPENDENT-STRATEGIC-SPEED)

Stacked on f0e219b. The rules are in `SHIP-DEPENDENT-STRATEGIC-SPEED.md`. This audit lists every path that
moves a ship strategically, or plans by how long that move takes, and says which speed it uses.

**Classifications**

- **NEW MODEL**: the days are `max(1, round(base / speed))` per leg. The speed is that of the ships actually
  flying, or of the slowest one able to travel. The planner and the journey call the same functions on the
  same hulls, so a planned ETA is the day the journey arrives.
- **FIXED-TIME**: the days do not depend on any ship, either by rule (a wormhole) or because the number is
  geography or a deadline, not a flight.
- **DEFERRED**: no speed this round, with the reason given.

**The two funnels.** Every model journey starts in `startJourney` (src/campaign-strategy.mjs). It always
recomputes the legs from the route's `legBase` at `hullsSpeed(world, hulls)`, even when the caller passes
a plan built at chart days. Every leg boundary then calls `J.respeedJourney(tr, hullsSpeed(members))`.

A planner therefore cannot make a journey fly at another speed. If a planner timed a journey at the wrong
speed, its ETA would disagree with the arrival day. The gates and the long run check that it does not
(planned = actual, see the measurements).

## Consumers

| # | consumer | class | how it reads speed |
|---|---|---|---|
| 1 | **player formations** | NEW MODEL | `fleetGroupSpeed(members)`: the slowest able member (disabled, destroyed and detached members are excluded). `beginFormationTravel` stores `legBase`, `speed` and `speedHistory`. At each leg boundary, after detaching members who left, the next legs are re-timed. The fleet manager line shows "strategic speed X×". Gate: FAST-VS-SLOW-ETA, CONVOY-SLOWEST-MEMBER. |
| 2 | **evacuation convoys** | NEW MODEL | `evacuationSpeed(world, e)`: the slowest transport or non-joining escort. A fast escort can only slow a convoy, never speed it. The convoy's journey, `evacuationPlan`, `evacuationRoundTripDays`, `validateEvacuationDestination` (the refuge's days and the "too far … at the convoy's X×" refusal), `evacuationDestinations` and the AI's choice (`plan.convoySpeed`) all use it. The captain's ops form reads the picked ships (or every free one). Pure 14, 15, 14b, CONVOY-SLOWEST-MEMBER; gate EVAC-CONVOY. |
| 3 | **doctrine patrol** (patrol, area patrol, exploration) | NEW MODEL, plus one FIXED-TIME geography metric | The assignment's milestones are issued at `hullSpeed(h)` and stored in `a.speed`. The frontier choice uses the flier's speed. The time on station (`patrolStationDays`) is in proportion to the leg the ship flies, both for routine patrols and for area-patrol cycles. If a journey is re-timed at a boundary, the owner's milestones are re-made from that crossing (`onRespeed`). A job issued before this round (no `a.speed`) is treated as timed at 1.0 and re-timed when it sets out (pure 27, 28). FIXED-TIME: `patrolArea`/`compact` choose an area by chart days, because that describes the area, not a flight. |
| 4 | **doctrine defence** | NEW MODEL | `responseCapacity` → `vesselEta` at the hull's speed (the 20-day defence reach is by that ETA, and the deadline runs from the arrival). |
| 5 | **doctrine raid** | NEW MODEL | The same `vesselEta`. The deadline is counted from the arrival milestone at the raider's speed. |
| 6 | **doctrine rescue** | NEW MODEL | `vesselEta` at the relief ship's speed against the survivors' window. A fast ship can make a window that a slow one cannot. The window is not stretched for either ship (`survivorWindowDays`, the hulk's crew clock). The objective arrives on `plan.arriveDay`. Pure 11/13, 12/FAST-VS-SLOW-RESCUE; gate RESCUE-FEASIBILITY. |
| 7 | **doctrine investigation** | NEW MODEL | The same `vesselEta`, bounded by travel + on station + slack. |
| 8 | **doctrine escort** | NEW MODEL | The escort flies in its charge's journey, so the pair goes at the slower of the two: at segment start, `groupSpeed` covers the vessel plus the joined escorts, and once the journey has started, `retimeMilestones` re-times them at the speed it actually flies. An escort slower than its charge is not chosen ("no spare vessel can keep up with the charge"), so it never pushes the charge past the days its owner and contract expect. The escort's position against the charge (`chargeAt`) uses the charge's live journey speed. |
| 9 | **delivery / construction** | NEW MODEL | The due day comes from `routeLegDaysFor(route, hullSpeed(h))` plus slack. The trade-port filter (`tradeMaxDays`) is applied at the ship's speed. The project's due day is set by `projectDaysFor(…, projectCarrierSpeed)`. A contract issued before this round keeps the due day it was given at 1.0, plus its slack. This is a save-migration note: a slow freighter carrying an old contract can be late. |
| 10 | **war operations** | NEW MODEL | `forceEtaDays`: for each origin, the plot is at that group's speed (`hullsSpeed`) and the force's ETA is its last group's arrival. `chooseOperationTarget` scores every target by that ETA and the defence on arrival, against `maxOperationEtaDays` (unchanged). It records `speed` in the record and the plan. Each group's journey flies at the same speed. Pure 16, 17; gate ETA-AWARE-WAR-SPEED. |
| 11 | **returns / retreats** | NEW MODEL | The home choice is `plannedJourneyDays(…, hullSpeed(h))`. A retreat to the previous system passes a one-leg plan at chart days; `startJourney` re-times it at the retreating hulls' speed. |
| 12 | **blockade deployment / reinforcement** | NEW MODEL (journey), with the dash input reconciled | The force taking station and each reinforcement fly as `blockade` journeys at their slowest hull's speed. A run's dash term reads the same strategic speed (§ blockade mapping in the rules doc). The crossing day is the convoy's speed-adjusted day (pure 20), and a run never re-times the journey (pure 21). |
| 13 | **Dominion movement** (corridor, reinforcement convoys, withdrawal) | NEW MODEL | Each is an `expedition`/`withdrawal` journey at its hulls' speed. Escalation targets are ordered by `forceEtaDays`. A reinforcement counts toward the expedition only on its speed-adjusted arrival (pure 19). |
| 14 | **repair / yard runs** | NEW MODEL | The yard choice is `plannedJourneyDays(…, hullSpeed(h))`, and the run is a `repair` journey at that hull's speed. |
| 15 | **captain's route** | NEW MODEL | `captainCourseSpeed()` is the slowest of his own ship and his operational escorts. `beginWarpTravel` sets `legDays`/`travelDays` at it. The route map shows "N travel days at X×". `captainCourseLine` recomputes the remaining days at the current speed. A wormhole transit is its own fixed passage. Gate CAPTAIN-COURSE. |
| 16 | **trader traffic** (the captain's fleet trading) | NEW MODEL | `fleetTradeRouteDays(route, shipStrategicSpeed(f.shipId))` is used for the leg schedule, circuit insertion (`legDaysBetween` memo in `planFleetTradeCircuit`), reposition and passage. |
| 17 | **player escorts with the captain** | NEW MODEL | Covered by row 15: they fly with him and slow him if they are slower. |
| 18 | **wormhole-only edges** | FIXED-TIME | `world.legFixed(a, b)` (`wormholeOnlyEdge`). The edge keeps its fixed days for every ship and is never shortened or lengthened by speed (pure 10; gate WORMHOLE-FIXED). |
| 19 | **pre-round journeys in a save** (no `legBase`) | FIXED-TIME (save migration) | They keep their stored legs, `respeedJourney` leaves them alone, and they finish at the chart's days. Every new journey and replot carries `legBase`. |
| 20 | **`fastestRoutesFrom` / route topology** | FIXED-TIME | The route itself never depends on the ship: the same systems and the same legs (pure 2). Only the days differ. |
| 21 | **ambient NPC traffic in the loaded scene** | FIXED-TIME (not timed) | Scene physics, not a strategic journey. |
| 22 | **`getRouteCosts`** | n/a | Not called by anything (dead code). Left unchanged. |
| 23 | **stranded-hull recovery movement** | NEW MODEL (TOWING-SALVAGE-RECOVERY) | The tug's outbound journey is at its group's speed; the tow is at `towSpeed = clamp(min(group, towed frame) × 0.7, 0.4, 1.0)` (`journeySpeed`), never through a fixed traversal. |
| 24 | **damage-based speed** | DEFERRED | The engine has no reliable engine-condition state, only operational / damaged / disabled from hull fraction. A ship is either able to travel or not. A disabled ship cannot travel (it is refused for an evacuation, skipped by planners, and excluded from a group's pace). A reduced-speed penalty for damaged-but-able ships waits for a real engine subsystem. |
| 25 | **`campaign legs N` debug override** | FIXED-TIME base | It replaces the chart's base days with N. Speed still applies on top. It is a labelled debug override and is never saved. |

## Double-accounting check

- The **force account** (`forceAccount`) counts each moving hull once, by its own journey's `etaDay`. That
  day is the speed-adjusted one, so a fast ship is "incoming" by its early day and a slow one "later" (pure
  18). No speed is applied twice: the account reads arrival days and never recomputes them.
- **Blockade running:** the dash term `(runner ÷ blockade)^2` (bounded) is the only place speed enters a
  run. The crossing's day is already speed-adjusted, and the run does not add or remove days.
- **Reinforcements and returns** count on arrival only (the journey's day). Nothing adds a separate
  speed-derived delay.

## After this round

Every UNIFIED row of STRATEGIC-MOVEMENT-AUDIT is now NEW MODEL, except the FIXED-TIME rows listed above.
The deferred items are unchanged except that **damage-based speed penalties** is added to the list.

## Carry-forward (from TOWING-SALVAGE-RECOVERY §21)

The category speeds here are a first implementation, not the final model: **individual / class-specific
strategic speed refinement** is carried forward. The lookup it needs is explicit class speed → class or
family fallback → role or category default → 1.0. A Sovereign-class, for instance, should be faster than
many smaller ships. Damage and engine-condition penalties stay on that same future list.
