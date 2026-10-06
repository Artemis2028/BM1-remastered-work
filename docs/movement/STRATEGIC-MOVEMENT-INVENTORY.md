# Strategic movement inventory (before this round)

Survey of `29710b1`, taken before any code was changed (PART 1). It covers every place where a strategic
vessel or group changes system: every `systemIndex` write on a campaign hull, and every `transit` /
`travel` / `itinerary` writer on a fleet vessel.

Columns:

- **route**: where the path comes from.
- **timing**: what decides the arrival day.
- **crosses B?**: whether systems between origin and destination are actually reached.
- **blockade**: whether the shared engine (`Campaign.resolveBlockadeRun`) runs at a crossing.
- **intel**: whether a crossing is observed or reported.
- **save mid-leg**: whether saving mid-leg resumes exactly.
- **vids**: whether the same persistent hulls are kept.
- **stale authority**: whether ceasefire or cancellation invalidates the movement.

| # | path | where (29710b1) | representation | route | timing | crosses B? | blockade | intel | save mid-leg | vids | stale authority |
|---|---|---|---|---|---|---|---|---|---|---|---|
| 1 | player formations | `main.js` `beginFormationTravel` / `crossFormationLeg` | `g.travel` journey record (canonical) | `getPlottedRoute` (distance-minimal, chart) | `routeLegDays` per leg | **yes**, once per `(seq, leg)` | **yes** | `fleetTradeObserve` + crossing roll | yes | yes (fleet ids + vids) | war stamp; halts at the end of the leg in flight |
| 2 | player traders (circuits, passages, recall, rendezvous) | `main.js` `scheduleFleetTradeLeg` / `crossFleetTradeSystem` | trade record `t.path/legDays/legIndex/crossed` + `f.transit` | `getPlottedRoute` | `routeLegDays` | **yes** | **yes** | `fleetTradeObserve` | yes | yes | order supersede at leg end |
| 3 | doctrine patrol / exploration / delivery / construction / transport / area patrol | `doctrine-campaign.mjs` `issueAssignment` / `stepAssignment` | assignment itinerary `pos`, `dwellLeft`, `nextDay` | `shortestRoute` (BFS) | **one hop per day**, whatever the distance | yes | **yes** | none on the way (milestones only) | yes | yes | objective close / order ends it |
| 4 | doctrine defence | same (`kind: 'defense'`) | itinerary | BFS | 1 hop/day | yes | yes | none | yes | yes | objective close |
| 5 | doctrine raid | same (`kind: 'raid'`) | itinerary + war stamp | BFS | 1 hop/day | yes | yes | none | yes | yes | stamp re-checked daily; strike only at target |
| 6 | doctrine investigation / rescue | same | itinerary | BFS | 1 hop/day | yes | yes | none | yes | yes | objective close |
| 7 | doctrine escort | charge's step moves joined escorts | itinerary (escort joined) | charge's | charge's | yes | yes (with the charge) | none | yes | yes | charge lost → closes |
| 8 | doctrine return / surrender release / leave-jurisdiction | `issueAssignment('return')`, `leaveJurisdiction` | itinerary | BFS / `routeAvoiding` | 1 hop/day | yes | yes | none | yes | yes | — |
| 9 | **evacuation convoy** | `campaign-strategy.mjs` `advanceEvacuationConvoy` | `e.convoy {phase, pos, nextDay}` | `shortestRoute` | **one system per campaign day** | yes | yes | none | yes | yes | not hostile; ends on origin/destination loss |
| 10 | **campaign war operations** (AI planning, Dominion invasion, Dominion escalation) | `launchOperation` / `advanceOperations` | `op.status: moving`, `arriveDay = day + hops` | none (hop count only) | **hops × 1 day**; hulls wait at origin | **no — teleport origin → target on the arrival day** | **no** | launch/arrival reports only, at the target | yes | yes | `enforceRelations` daily; stand-down **teleports survivors home** |
| 11 | **operation survivors going home** | `finishOperation` | `h.systemIndex = h.originSystem` | none | **instant** | **no** | **no** | none | n/a | yes | — |
| 12 | **damaged hull to a yard** | `advanceRepairs` | `h.systemIndex = yard; arriveDay` | none (hop count) | hops × 1 day | **no — teleported at once, then waits** | **no** | none | yes | yes | — |
| 13 | **blockade force taking station** | `startBlockade` | `h.systemIndex = target` at once; `forming` until `activeDay` | `routeHops` count | hops × 1 day | **no — teleported at once** | **no** | none | yes | yes | ceasefire closes (`closePairBlockades`) |
| 14 | **blockade reinforcement** | `reinforceBlockade` | `h.systemIndex = target` at once | none | **instant** | **no** | **no** | none | n/a | yes | — |
| 15 | **Dominion partner-corridor crossing** | `advanceDominion` (staging → entry, pact corridor) | `h.systemIndex = entry` | wormhole edge | **instant** | n/a (1 leg) | **no** | warning report | n/a | yes | pact re-checked |
| 16 | **Dominion expedition withdrawal** | `withdrawExpedition` | near-side ready hulls `h.systemIndex = staging` | none | **instant, multi-hop** | **no** | **no** | withdrawal report | n/a | yes | — |
| 17 | Dominion reinforcement convoys | `advanceDominion` | `addHull` **at the bridgehead** | none | every N days | **no — created on arrival** | no (cut by a defence-strength test) | convoy report | n/a | new hulls | cut while the entry is held |
| 18 | Dominion recon / staging / expedition hulls | `advanceDominion` | `addHull` at the staging system (beyond the map) | — | authored dwell | n/a (created there) | n/a | warnings | n/a | new hulls | stand-down |
| 19 | ambient raid in the loaded scene | `main.js` `launchBudgetedAmbientRaid` | op engaged at once; hulls "here or one route away" set to the scene system | none | **instant, one hop** | no | no | the scene itself | scene | yes | op rules |
| 20 | local ops materialised in a scene | `claimOperationForScene` / `reconcileLocalOutcome` | op engaged at the target | — | — | — | — | the scene | — | yes | op rules |
| 21 | captain's own warp (and escorts with him) | `main.js` `beginWarpTravel` / `completeWarpTravel` | `state.warp` over a plotted route | `getPlottedRoute` | total route distance | **no — one warp over the whole route** | **no** | arrival only | warp blocks saving | yes | — |
| 22 | legacy single-ship transit | `completeFleetJourneys` fallback (`f.transit` with no formation or trade leg) | `f.transit {to, arrivalDay}` | — | arrivalDay | no | no | no | yes | yes | — (only orphaned or pre-round saves reach it) |
| 23 | pirate group following its prey | `doctrine-campaign.mjs` `workPredation` | `g.systemIndex = target's system` | none | same day | n/a (haven and neighbours) | n/a (pirates are at no formal war) | via predation reports | yes | group vid | objective close |
| 24 | stranded hulk recovery | `advanceStranded` | in place (recovery at the hulk's own yard world) | — | — | **no movement** | — | — | yes | yes | — |
| 25 | production / garrison replacement / capture transfer | `addHull`, `advanceGarrisons`, `transferHullOut`, `recordCapture` | creation or transfer in place | — | — | no movement | — | — | — | — | — |

Evacuation is row 9. The three known cases are rows 9, 10 and 11. The same survey found six more bypasses
of leg traversal and the blockade engine:

- the damaged hull sailing to a yard (12);
- a blockade force taking station (13);
- blockade reinforcement (14);
- the Dominion partner-corridor crossing (15);
- the Dominion expedition withdrawal (16);
- Dominion reinforcement convoys (17).

It also found three paths that move on a timing model other than the canonical one:

- every doctrine assignment (rows 3–8), at one hop per day, and the evacuation convoy (9);
- the captain's own warp (21), timed by total distance;
- ambient raids (19), which move one hop at once.
