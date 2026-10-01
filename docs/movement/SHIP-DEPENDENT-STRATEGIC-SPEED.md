# Ship-dependent strategic speed

Stacked on the frozen f0e219b (STRATEGIC-TACTICAL-HANDOFF). A journey's days now depend on the ships
actually flying it. Every planner reads exactly those days: the AI's war planning, rescue feasibility,
evacuation, defence, raids, escort, deliveries, reinforcements, returns, repair runs, patrols and the
captain's own course.

Speed is not a planner-only value. A planner calls the same functions on the same hulls that the journey
uses, and `startJourney` always re-times the legs at the flying hulls' speed whatever plan it was handed.
The planned ETA is therefore the arrival day. The long run measures this directly: 0 planned-vs-actual
mismatches in 367 arrived journeys, and 0 of 28 engaged operations off their planned day.

The consumer-by-consumer classification is in `STRATEGIC-SPEED-AUDIT.md`.

## 1. The speed field

- Each class in `bm-ships/ships.json` (and `data/starship_manifest.json`, synced by
  `scripts/sync-ship-roster.mjs`) carries two fields:
  - `strategicSpeed`: a multiplier on the chart's pace;
  - `strategicSpeedBasis`: where the value came from, either `category:<name>` or `authored` for a
    hand-set value, which `scripts/assign-strategic-speed.mjs` never overwrites.
- **Default 1.0. Range [0.6, 1.5]**, clamped to two decimals (`clampSpeed`). The authored values span
  0.8–1.3.
- **Legacy behaviour:** a class with no `strategicSpeed` flies at 1.0, which is exactly the old
  ship-independent timing. This covers a legacy record, an unknown id, a fixture class, or a non-numeric or
  non-positive value.
- **Saves stay valid.** The field lives in the catalogue, not the save. The new journey fields are additive
  (§15).
- Tactical speed (`speed` in the catalogue, the scene's units) is a different quantity and is not read for
  strategic travel.

## 2. Durations only: formula and rounding

```
legDays = fixed ? fixedDays : max(1, round(baseDays / speed))
```

- `baseDays` is the leg's chart length at speed 1.0. This is `world.legDays(a, b)`, which is
  `ceil(distance / 10)` for chart routes. It is the same number for every ship.
- Each leg is rounded on its own to whole campaign days: `Math.round`, so halves round up. A leg is
  never below 1 day and never 0. There is no fractional-day state anywhere.
- The route never depends on the ship: same systems, same legs, same topology (pure 2). Only each leg's
  days change.
- A journey stores `legBase: [{ days, fixed }]`, `speed` and `speedHistory: [{ fromLeg, speed }]` next
  to its `legDays`.

Leg durations at each speed, from `adjustLegDays`:

| chart days | 0.8× | 0.85× | 0.9× | 1.0× | 1.1× | 1.15× | 1.2× | 1.3× |
|---|---|---|---|---|---|---|---|---|
| 5 | 6 | 6 | 6 | 5 | 5 | 4 | 4 | 4 |
| 8 | 10 | 9 | 9 | 8 | 7 | 7 | 7 | 6 |
| 10 | 13 | 12 | 11 | 10 | 9 | 9 | 8 | 8 |
| 12 | 15 | 14 | 13 | 12 | 11 | 10 | 10 | 9 |
| 15 | 19 | 18 | 17 | 15 | 14 | 13 | 13 | 12 |
| 20 | 25 | 24 | 22 | 20 | 18 | 17 | 17 | 15 |

Rounding is per leg, so close speeds can tie on a short leg: 1.2× and 1.3× both fly a 10-day leg in 8
days. Over a route the difference shows.

## 3. Formations and convoys

- **A group flies at its slowest member able to travel** (`groupSpeed`, `hullsSpeed`, `fleetGroupSpeed`,
  `evacuationSpeed`, `captainCourseSpeed`).
  - Members that are disabled, surrendered, awaiting crew (`recrew`), destroyed or lost are not travelling
    and are left out of the pace.
  - A group with none able to travel falls back to the slowest of what it has, so a timing is always
    defined. Such a group does not move anyway.
- **An escort cannot make a transport faster.** Every group function is a minimum, so adding a member can
  only keep the speed or lower it (pure 4, gate CONVOY-SLOWEST-MEMBER).
- **Detaching the slow member improves the next leg.** The leg in flight keeps the days it was issued and
  is never re-timed retroactively. At the boundary, after members who left are detached, `respeedJourney`
  re-times every later leg at the remaining members' speed and appends to `speedHistory` (pure 5/6 and
  CONVOY-SLOWEST-MEMBER; gate CONVOY-SLOWEST-MEMBER).
- **Doctrine jobs:**
  - After a segment's journey starts, its owner's milestones are re-made at the speed the journey actually
    flies (`retimeMilestones`).
  - When a journey is re-timed at a boundary, they are re-made from that crossing (the `onRespeed` journey
    hook; pure 28).
  - A doctrine escort slower than its charge is not chosen, so it never slows the charge past what was
    promised.

## 4. Damage: deferred

Damage-based speed is deferred. The engine has no reliable engine-condition state: hull fraction gives
operational, disabled or destroyed (`classifyDamage`), and nothing models drive damage.

The minimum is in place: **a disabled ship cannot travel**.
- `startEvacuation` refuses it as a transport.
- Planners skip it (`hullUnavailable`).
- A moving group leaves it out of the pace and, in formations, detaches it.
- A damaged but still operational ship flies at its class speed.

"Damage-based speed penalties" is added to the deferred list.

## 5. Every planner reads the same speed

| planner | what it calls |
|---|---|
| doctrine response (defence, rescue, investigation, raid) | `responseCapacity` → `vesselEta` at `hullSpeed(h)` |
| escort | the escort's `assignment.speed`; the charge's position at the charge's `assignment.speed` |
| commercial delivery | the due day from `routeLegDaysFor(route, hullSpeed(h))`; the trade-port filter at the ship's speed |
| construction delivery | `projectDaysFor(…, projectCarrierSpeed)` |
| war target scoring | `forceEtaDays` (each origin group at its own `hullsSpeed`; the force arrives with its last group) |
| reinforcement timing / Dominion ETA | `forceEtaDays`; reinforcement convoys are `expedition` journeys at their hulls' speed |
| evacuation refuge and cycles | `evacuationSpeed`, `validateEvacuationDestination(…, speed)`, `evacuationDestinations(…, speed)`, `evacuationRoundTripDays` |
| patrol cadence | the frontier and station days at the flier's speed (`patrolStationDays(…, speed)`), for routine and area patrols; the area itself is chosen by chart days (geography) |
| repair / return-yard routing | `plannedJourneyDays(…, hullSpeed(h))` |
| captain | `captainCourseSpeed()`; trading `fleetTradeRouteDays(route, shipStrategicSpeed(f.shipId))` |

## 6. Rescue

- A relief ship's ETA is computed at its own speed against the survivors' window that its knowledge
  gives it (`observedDay + survivorWindowDays`, or the hulk's crew clock).
- **Endurance is not inflated** for anyone. A fast ship can make a window that a slow one cannot.
- Pure 11/13: the same origin and survivors, 15 days left.
  - A 1.3× ship is accepted: 4 + 9 = 13 days.
  - A 0.8× ship is refused, "cannot reach the survivors in time": 6 + 15 = 21 days.
- Pure 12/FAST-VS-SLOW-RESCUE runs the whole chain. The fast ship is sent, arrives on `plan.arriveDay`
  (planned = actual) and rescues them. The slow one is refused with "arrives day 48, 21 days; survivors
  last to day 46".
- Gate RESCUE-FEASIBILITY runs the same chain in the real game with a Vulcan Light Cruiser (1.2×) and a
  Vulcan Explorer (0.9×).

## 7. Evacuation

- A convoy flies at its slowest transport or escort. Fast escorts do not help: the round trip is the same
  escorted or not (pure 15).
- Refuge scoring and the trip count use the actual ETA at the convoy's speed.
- A refuge in reach of fast ships but too far for slow ones is refused for the slow convoy ("too far: 29
  days … at the convoy's 0.8×") and accepted for the fast one (pure 14b). The destination choice can
  therefore change with the ships.
- The AI picks its convoy, then its refuge at that convoy's speed (`plan.convoySpeed`).

## 8. War

- An operation's ETA is computed per origin group at that group's slowest ship. The force arrives when its
  last group does.
- `chooseOperationTarget` scores by that ETA and the defence on arrival. `maxOperationEtaDays` is kept.
- The same targets get different ETAs for a fast and a slow force, and the slow one can be out of reach
  where the fast one is not (pure 17/ETA-AWARE-WAR-SPEED).
- The operation engages on its planned day, against the defence it was planned against (pure 17). In the
  gate, the Neg'Var force engaged on day 106, as planned.

## 9. Reinforcements and returns

- These are journeys like any other, at their hulls' speed.
- `forceAccount` counts each hull once, by its own journey's arrival day: incoming if it arrives by the
  attacker's ETA, later otherwise. It does no double accounting (pure 18).
- A Dominion reinforcement is incoming until its speed-adjusted arrival and strength from that day
  (pure 19).

## 10. Blockade running: one speed, mapped once

Before this round the run's dash term read the catalogue's **tactical** speed (scene units, 25–70) through
`world.shipStats().speed`, with `interceptRefSpeed: 45` as the default. Strategic and tactical speed were two
different numbers for the same ship. Now there is one:

- `world.shipStats(id).speed` and `.strategicSpeed` are both the class's strategic speed
  (`shipStrategicSpeed`).
- The runner's speed is its slowest operational member. The blockade's speed is the mean of its hulls on
  station. A class without a value is taken at `interceptRefSpeed: 1.0`, the same default every journey
  flies at.
- **Mapping:** `rel = bounded((runner ÷ blockade) ^ interceptSpeedExponent, 0.4, 2.5)` with
  `interceptSpeedExponent: 2`.
  - The run's detection and catch odds were calibrated on the tactical spread (sd of log speed 0.268).
    The strategic spread is about half that (0.145), so the ratio is squared to keep a comparable
    effect. This is a documented calibration, not a new rule.
  - Measured effect at the same seeds, gate fixtures:
    - an unescorted 0.8× freighter convoy through a strong blockade passes 42% of the time (was 37%);
    - the integration case passes 48% (was 44%).
- **No double count.** Speed enters a run only through this term. The crossing day is already the
  speed-adjusted day, and a run never re-times a journey (pure 20, 21).
- **Old saves:** `upgradeCampaignBook` sets `book.strategicSpeed = 1` once and rewrites a stored
  `interceptRefSpeed` of 45 to 1.0. A save's other config is untouched.
- Fixture `speed` values in the blockade and handoff tests were converted to `strategicSpeed`: 25→0.8,
  30→0.85, 40→0.9, 45→1.0, 50→1.1, 65/70→1.3.

## 11. Tactical handoff

- The handoff is preserved. A journey intercepted at an intermediate system is held at that crossing on
  the speed-adjusted day (pure 22/23/24).
- When the scene hands the result back, the next legs are re-timed at the survivors' speed at that
  boundary (`respeedJourney`). The remaining ETA is recalculated from the same model, and the vids are the
  same throughout.
- The captain's course line (`captainCourseLine`) recomputes the remaining days from his remaining legs at
  his current course speed.

## 12. Special routes

| route | days | why |
|---|---|---|
| ordinary chart route (lane, corridor, shortcut: every non-wormhole edge) | `max(1, round(base / speed))` | a flight: a faster ship covers it sooner |
| wormhole-only edge (the Bajoran wormhole, `world.legFixed` = `wormholeOnlyEdge`) | its fixed days, for every ship | a transit, not a flight: not shortened for a fast ship nor lengthened for a slow one |
| the captain's wormhole transit | its own fixed passage (unchanged) | as before f0e219b |
| any leg | never 0 days | the `max(1, …)` floor; a fixed leg is at least 1 |
| `campaign legs N` (debug override) | N becomes the base, then speed applies | a labelled override, never saved |

Pure 10 and the WORMHOLE-FIXED gate check fixed days at 0.6×, 0.8×, 1.0×, 1.3× and 1.5×, and that no leg on
the whole chart is below 1 day at 1.5×.

## 13. Defaults: the class/category table

- The values were assigned once by `scripts/assign-strategic-speed.mjs`, from each class's authored
  `shipClass` and `role` (`speedCategory` in `src/strategic-speed.mjs`). Nothing is derived from tactical
  speed, mass or power.
- The values are conservative and bounded at 0.8–1.3: meaningful differences, no extremes.
- A freight word in the role (freighter, hauler, cargo, transport, tug, logistics, liner) makes a
  freighter. The exceptions:
  - a role that also says the frame is fast ("fast frontier freighter", "courier transport");
  - a survey ship carrying logistics (the Nebula: a cruiser).
- A hand-set value marked `"strategicSpeedBasis": "authored"` is kept on re-assignment.

| Category | Speed | Classes |
|---|---|---|
| scout | 1.3× | 12 |
| shuttle | 1.15× | 12 |
| cargoShuttle | 1× | 5 |
| escort | 1.2× | 22 |
| lightCruiser | 1.1× | 23 |
| fastCruiser | 1.2× | 10 |
| cruiser | 1× | 40 |
| freighter | 0.8× | 19 |
| capital | 0.9× | 16 |
| battleship | 0.85× | 15 |
| **total** | | **174** |

| id | Class | Faction | shipClass | role | category | strategic speed |
|---|---|---|---|---|---|---|
| 9 | Kingston Class | neutral | escort | long-haul freighter | freighter | 0.8× |
| 10 | Tug Class II | terran | lightCruiser | heavy tug | freighter | 0.8× |
| 47 | Oberth Tug | terran | escort | entry utility tug | freighter | 0.8× |
| 50 | Sentient Lifeform | neutral | cruiser | organic transport | freighter | 0.8× |
| 215 | Tarellian Freighter | neutral | cruiser | quantum-drive freighter | freighter | 0.8× |
| 223 | Tholian Cargo Ship | tholian | lightCruiser | Tholian cargo cruiser | freighter | 0.8× |
| 236 | Salcombe class | terran | lightCruiser | heavy cargo frame | freighter | 0.8× |
| 238 | Dominion Freighter | dominion | lightCruiser | Dominion logistics ship | freighter | 0.8× |
| 239 | Klingon Cargo Ship | klingon | lightCruiser | Klingon armed hauler | freighter | 0.8× |
| 244 | Beijing Class | terran | lightCruiser | Beijing transport cruiser | freighter | 0.8× |
| 277 | Romulan Freighter | romulan | lightCruiser | Romulan convoy freighter | freighter | 0.8× |
| 278 | Romulan Miltek | romulan | cruiser | Miltek military transport | freighter | 0.8× |
| 292 | Cardassian Transport Ship | cardassian | lightCruiser | Cardassian convoy transport | freighter | 0.8× |
| 309 | Deforest Armed Freighter | neutral | escort | armed civilian freighter | freighter | 0.8× |
| 318 | Tholian Isaac Freighter | tholian | cruiser | bulk interstellar freighter | freighter | 0.8× |
| 331 | K't'inga Cargo Cruiser | klingon | lightCruiser | armed cargo conversion | freighter | 0.8× |
| 340 | Constitution Utility Tug | neutral | lightCruiser | Constitution service tug | freighter | 0.8× |
| 341 | Constellation Cargo Tug | neutral | lightCruiser | Constellation cargo tug | freighter | 0.8× |
| 342 | Olympic Support Ship | neutral | lightCruiser | medical support transport | freighter | 0.8× |
| 42 | Neg'Var Warship | klingon | battleship | assault battleship | battleship | 0.85× |
| 49 | Galaxy Dreadnaught | terran | battleship | Project X dreadnaught | battleship | 0.85× |
| 60 | Concord-class Grand Cruiser | neutral | battleship | independent supercapital | battleship | 0.85× |
| 61 | Klingon Qonos | klingon | battleship | Klingon supercapital | battleship | 0.85× |
| 62 | Cardassian Behemoth | cardassian | battleship | Cardassian supercapital | battleship | 0.85× |
| 63 | Vulcan Lifeform | vulcan | battleship | undefined | battleship | 0.85× |
| 64 | Romulan Warhawk | romulan | battleship | Romulan supercapital | battleship | 0.85× |
| 65 | Dominion Battleship | dominion | battleship | Dominion supercapital | battleship | 0.85× |
| 66 | Tholian Conquest | tholian | battleship | Tholian supercapital | battleship | 0.85× |
| 224 | Son'a Battleship | sona | battleship | Sona battleship | battleship | 0.85× |
| 232 | Tholian Battleship | tholian | battleship | Tholian battleship | battleship | 0.85× |
| 261 | Tactical Cube | borg | battleship | mission tactical cube | battleship | 0.85× |
| 333 | Negh'Var Command Ship | klingon | battleship | Klingon command battleship | battleship | 0.85× |
| 346 | Borg Assimilation Cube | borg | battleship | Borg assimilation cube | battleship | 0.85× |
| 347 | Excalibur Class | terran | battleship | Project X supercapital | battleship | 0.85× |
| 26 | Vulcan Explorer | vulcan | capital | undefined | capital | 0.9× |
| 35 | Galaxy Class | terran | capital | multipurpose capital | capital | 0.9× |
| 38 | Sovereign Class | terran | capital | battlecruiser | capital | 0.9× |
| 48 | Jem'Hadar Battlecruiser | dominion | capital | JemHadar battlecruiser | capital | 0.9× |
| 51 | Delpin Luxury Liner | delpin | capital | luxury liner | capital | 0.9× |
| 53 | Reman Warbird | romulan | capital | secret strike capital | capital | 0.9× |
| 211 | Vulcan Expeditionary Explorer | vulcan | capital | expeditionary capital | capital | 0.9× |
| 213 | Imperial Class | terran | capital | Imperial command capital | capital | 0.9× |
| 221 | Galaxy Command Variant | terran | capital | Galaxy command capital | capital | 0.9× |
| 246 | Classic Warbird | romulan | capital | classic Romulan capital | capital | 0.9× |
| 254 | Hirogen Warship | hirogen | capital | Hirogen warship | capital | 0.9× |
| 289 | Inquiry Class | terran | capital | heavy tactical capital | capital | 0.9× |
| 299 | Sagan Class | terran | capital | capital explorer | capital | 0.9× |
| 320 | D'deridex Warbird | romulan | capital | heavy cloaked warbird | capital | 0.9× |
| 324 | Keldon War Cruiser | cardassian | capital | Cardassian war cruiser | capital | 0.9× |
| 329 | Sovereign Command Cruiser | terran | capital | command battlecruiser | capital | 0.9× |
| 2 | Excelsior Class | terran | cruiser | fleet cruiser | cruiser | 1× |
| 4 | Nebula Class | terran | cruiser | survey logistics refit | cruiser | 1× |
| 15 | Ambassador Civilian Refit | neutral | cruiser | civilian cruiser | cruiser | 1× |
| 25 | Vulcan Warpship | vulcan | shuttle | Vulcan transport | cargoShuttle | 1× |
| 33 | Akira Class | terran | cruiser | standard battlecruiser | cruiser | 1× |
| 54 | Tamarian Warship | neutral | cruiser | independent cruiser | cruiser | 1× |
| 216 | Dominion Cruiser | dominion | cruiser | Dominion cruiser | cruiser | 1× |
| 218 | Breen Warship | breen | cruiser | Breen attack cruiser | cruiser | 1× |
| 219 | Son'a Warship | sona | cruiser | Sona attack cruiser | cruiser | 1× |
| 220 | Azuki | terran | cruiser | Azuki multirole cruiser | cruiser | 1× |
| 227 | Promelli Manitee | promelli | cruiser | Promelli heavy cruiser | cruiser | 1× |
| 231 | Manticore Class | terran | cruiser | assault cruiser | cruiser | 1× |
| 242 | Austin Class | terran | cruiser | Austin defense cruiser | cruiser | 1× |
| 248 | Eisenhower Class | neutral | cruiser | Eisenhower civilian cruiser | cruiser | 1× |
| 251 | Gorn Cruiser | gorn | cruiser | reserved Gorn cruiser | cruiser | 1× |
| 253 | Hirogen Hunter | hirogen | cruiser | Hirogen hunter | cruiser | 1× |
| 255 | K'tra Class | klingon | cruiser | Ktra attack cruiser | cruiser | 1× |
| 256 | Renux Class | romulan | cruiser | Renux cruiser | cruiser | 1× |
| 257 | Suliban Cruiser | suliban | cruiser | Suliban raiding cruiser | cruiser | 1× |
| 260 | T'Pral Class | vulcan | cruiser | TPral exploration cruiser | cruiser | 1× |
| 262 | Terra Class | terran | cruiser | Terra command capital | cruiser | 1× |
| 263 | Type 7 Shuttle | terran | shuttle | passenger shuttle | cargoShuttle | 1× |
| 265 | Crossfield Class | terran | cruiser | experimental survey cruiser | cruiser | 1× |
| 268 | Independent Warbird | neutral | cruiser | independent militia warbird | cruiser | 1× |
| 270 | Onyx Class | neutral | cruiser | Onyx guard cruiser | cruiser | 1× |
| 271 | Parliament Class | terran | cruiser | engineering support cruiser | cruiser | 1× |
| 279 | Romulan Warbird | romulan | cruiser | Romulan patrol capital | cruiser | 1× |
| 280 | Terran Constitution | terran | cruiser | Imperial Constitution refit | cruiser | 1× |
| 283 | Cheyenne Class | terran | cruiser | multi-mission cruiser | cruiser | 1× |
| 284 | Constitution III Class | terran | cruiser | modern exploration cruiser | cruiser | 1× |
| 285 | Duderstadt Class | terran | cruiser | modern reconnaissance cruiser | cruiser | 1× |
| 286 | Excelsior II Class | terran | cruiser | modern fleet cruiser | cruiser | 1× |
| 287 | Gagarin Class | terran | cruiser | fleet assault cruiser | cruiser | 1× |
| 293 | Kumari Class | andorian | cruiser | Andorian battlecruiser | cruiser | 1× |
| 300 | Sutherland Class | terran | cruiser | sensor support cruiser | cruiser | 1× |
| 313 | Ambassador Imperial Cruiser | terran | cruiser | Imperial fleet cruiser | cruiser | 1× |
| 315 | Ferengi Marauder Refit | ferengi | cruiser | armed merchant cruiser | cruiser | 1× |
| 316 | Ferengi Cargo Shuttle | ferengi | shuttle | cargo shuttle | cargoShuttle | 1× |
| 319 | Delpin Long-Range Cruiser | delpin | cruiser | Delpin long-range cruiser | cruiser | 1× |
| 323 | Galor Cruiser | cardassian | cruiser | Cardassian fleet cruiser | cruiser | 1× |
| 328 | Prometheus Tactical Cruiser | terran | cruiser | advanced tactical cruiser | cruiser | 1× |
| 334 | Vor'cha Attack Cruiser | klingon | cruiser | Klingon attack cruiser | cruiser | 1× |
| 343 | Vulcan C'Thia Defense Cruiser | vulcan | cruiser | Vulcan defense cruiser | cruiser | 1× |
| 345 | Bajoran Solar Sailor | bajoran | shuttle | Bajoran sail transport | cargoShuttle | 1× |
| 348 | Andorian Cargo Shuttle | andorian | shuttle | Andorian cargo shuttle | cargoShuttle | 1× |
| 1 | Steamrunner Class | neutral | lightCruiser | reserve cruiser | lightCruiser | 1.1× |
| 55 | Alien Bioship | neutral | lightCruiser | alien combat bioship | lightCruiser | 1.1× |
| 225 | Orion Starbridge | neutral | lightCruiser | Orion commerce cruiser | lightCruiser | 1.1× |
| 226 | Promelli Skiff | promelli | lightCruiser | Promelli energy skiff | lightCruiser | 1.1× |
| 230 | Aurelius Patrol Frigate | terran | lightCruiser | frontier patrol frigate | lightCruiser | 1.1× |
| 234 | Breen Light Cruiser | breen | lightCruiser | Breen shield cruiser | lightCruiser | 1.1× |
| 240 | Andorian Patrol Cruiser | andorian | lightCruiser | Andorian patrol cruiser | lightCruiser | 1.1× |
| 241 | Astrid Class | terran | lightCruiser | Astrid utility cruiser | lightCruiser | 1.1× |
| 247 | Drayton Class | neutral | lightCruiser | Drayton service craft | lightCruiser | 1.1× |
| 249 | Ford Class | neutral | lightCruiser | Ford utility cruiser | lightCruiser | 1.1× |
| 264 | California Class | terran | lightCruiser | operations support cruiser | lightCruiser | 1.1× |
| 266 | Diana Class | terran | lightCruiser | Diana science cruiser | lightCruiser | 1.1× |
| 276 | Helios Class | neutral | lightCruiser | Helios civilian explorer | lightCruiser | 1.1× |
| 282 | Althinas Class | neutral | lightCruiser | Vulcan-derived civilian explorer | lightCruiser | 1.1× |
| 290 | Intrepid Frigate | neutral | lightCruiser | early Intrepid patrol refit | lightCruiser | 1.1× |
| 294 | Luna Class | terran | lightCruiser | deep-space survey cruiser | lightCruiser | 1.1× |
| 295 | Norway Class | terran | lightCruiser | tactical escort cruiser | lightCruiser | 1.1× |
| 298 | Reliant Class | terran | lightCruiser | modern utility cruiser | lightCruiser | 1.1× |
| 302 | Trieste Class | neutral | lightCruiser | Trieste reconnaissance cruiser | lightCruiser | 1.1× |
| 312 | Centaur Reserve Cruiser | neutral | lightCruiser | civilian reserve cruiser | lightCruiser | 1.1× |
| 317 | Ferengi Vagabond | ferengi | lightCruiser | Ferengi defense cruiser | lightCruiser | 1.1× |
| 327 | Intrepid Explorer | terran | lightCruiser | long-range explorer | lightCruiser | 1.1× |
| 336 | New Orleans Civilian Refit | neutral | lightCruiser | civilian patrol conversion | lightCruiser | 1.1× |
| 24 | Lysian Fighter | neutral | shuttle | budget light craft | shuttle | 1.15× |
| 210 | Vulcan shuttle | vulcan | shuttle | Vulcan shuttle | shuttle | 1.15× |
| 222 | Tholian Shuttle | tholian | shuttle | Tholian shuttle | shuttle | 1.15× |
| 229 | Sovereign Yacht | terran | shuttle | premium command yacht | shuttle | 1.15× |
| 233 | Breen Shuttle | breen | shuttle | Breen shuttle | shuttle | 1.15× |
| 235 | Son'a Shuttle | sona | shuttle | Sona shuttle | shuttle | 1.15× |
| 250 | Galaxy Yacht | terran | shuttle | Galaxy command yacht | shuttle | 1.15× |
| 258 | Suliban Pod | suliban | shuttle | Suliban pod | shuttle | 1.15× |
| 267 | Hirogen Shuttle | hirogen | shuttle | Hirogen hunting shuttle | shuttle | 1.15× |
| 273 | Type 11 Shuttle | terran | shuttle | advanced shuttle | shuttle | 1.15× |
| 349 | Utility Shuttle | neutral | shuttle | independent utility shuttle | shuttle | 1.15× |
| 350 | Basic Shuttle | neutral | shuttle | basic civilian shuttle | shuttle | 1.15× |
| 11 | Vega Class | terran | escort | civilian combat escort | escort | 1.2× |
| 22 | Delpin Warship | delpin | escort | compact warship | escort | 1.2× |
| 207 | Nausican Raider | neutral | escort | armed raider | escort | 1.2× |
| 209 | sydney Class | terran | lightCruiser | courier transport | fastCruiser | 1.2× |
| 214 | Freedom Class | neutral | escort | independent utility escort | escort | 1.2× |
| 217 | Human Bird of Prey | terran | escort | Terran light raider | escort | 1.2× |
| 237 | Vulcan Light Cruiser | vulcan | lightCruiser | Vulcan fast cruiser | fastCruiser | 1.2× |
| 245 | Belfast Class | terran | lightCruiser | Belfast survey cruiser | fastCruiser | 1.2× |
| 252 | Gorn Patrol Ship | gorn | escort | reserved Gorn patrol | escort | 1.2× |
| 259 | Suliban Cell Ship | suliban | escort | Suliban cell ship | escort | 1.2× |
| 269 | NX Class | neutral | escort | civilian NX refit | escort | 1.2× |
| 274 | Daedalus Class | terran | escort | Daedalus service refit | escort | 1.2× |
| 275 | Falcon Class | terran | escort | Falcon strike escort | escort | 1.2× |
| 288 | Gorn Interceptor | gorn | escort | reserved Gorn interceptor | escort | 1.2× |
| 291 | Kaplan F17 Freighter | neutral | lightCruiser | fast frontier freighter | fastCruiser | 1.2× |
| 296 | Orion Science Ship | neutral | escort | Orion science vessel | escort | 1.2× |
| 297 | Penine Class | neutral | escort | Penine patrol escort | escort | 1.2× |
| 301 | Thawn Class | neutral | escort | Thawn frontier escort | escort | 1.2× |
| 305 | Miranda Long-Range Frigate | terran | escort | long-range frigate | escort | 1.2× |
| 306 | Nova Surveyor | terran | escort | local survey ship | escort | 1.2× |
| 307 | Saber Planetary Defender | terran | escort | local defense escort | escort | 1.2× |
| 310 | Aries Multipurpose Vessel | neutral | escort | civilian generalist | escort | 1.2× |
| 311 | Mozart Civilian Explorer | neutral | escort | civilian explorer | escort | 1.2× |
| 321 | Norexan Warbird | romulan | cruiser | fast strike warbird | fastCruiser | 1.2× |
| 322 | Jem'Hadar Attack Ship | dominion | lightCruiser | JemHadar attack ship | fastCruiser | 1.2× |
| 325 | Akira Strike Cruiser | terran | cruiser | upgraded strike cruiser | fastCruiser | 1.2× |
| 326 | Defiant Escort | terran | escort | armored combat escort | escort | 1.2× |
| 332 | K'Vort Patrol Ship | klingon | escort | Bird of Prey patrol ship | escort | 1.2× |
| 335 | Akuzi Explorer | neutral | escort | budget civilian explorer | escort | 1.2× |
| 338 | Tarellian Quantum Cruiser | tarellian | cruiser | quantum-drive cruiser | fastCruiser | 1.2× |
| 344 | Steamrunner Strike Frigate | terran | lightCruiser | military strike frigate | fastCruiser | 1.2× |
| 351 | Klingon Bird of Prey | klingon | lightCruiser | light Bird of Prey | fastCruiser | 1.2× |
| 29 | Romulan Scout | romulan | shuttle | armed scout | scout | 1.3× |
| 206 | Dominion Scout | dominion | shuttle | Dominion scout | scout | 1.3× |
| 208 | Venture Class | neutral | shuttle | light scout | scout | 1.3× |
| 212 | Romulan Courier | romulan | shuttle | Romulan courier | scout | 1.3× |
| 228 | Peregrin Fighter | terran | shuttle | strike fighter | scout | 1.3× |
| 243 | Avon Class | terran | shuttle | Avon courier | scout | 1.3× |
| 272 | Speeder | terran | shuttle | fast courier | scout | 1.3× |
| 281 | Aeroshuttle | terran | shuttle | armed auxiliary scout | scout | 1.3× |
| 303 | Warp Delta | neutral | shuttle | early warp patrol craft | scout | 1.3× |
| 308 | Danube Utility Runabout | terran | shuttle | armed utility runabout | scout | 1.3× |
| 314 | Cardassian Hideki Shuttle | cardassian | shuttle | Cardassian patrol craft | scout | 1.3× |
| 330 | B'rel Scout | klingon | shuttle | entry Bird of Prey | scout | 1.3× |


## 14. UI

The label is "Strategic speed: 1.2×", formatted by `speedLabel`. It appears in:

- **Fleet / ship detail:** the fleet manager's `data-fleet-speed` line, for example "Strategic speed: 1.2× · Convoy
  flies at 0.8×" (the ship's own speed, then the pace of its formation). The ops evacuation form (`data-ops-convoy-speed`) and each ship label in the ops
  pickers also show it.
- **Formation ETA:** the travel line ends "· strategic speed 1.2×" (screenshot
  SPEED-fast-vs-slow-dispatched-fleet.png).
- **Journey debug:** a "Speed · legs (base → flown)" column (`journeySpeedCell`), for example "0.8× ·
  10→13 · 12→15 · 10→13", and, after a re-time, "from leg N: X×". A fixed leg is marked "f".
- **Evacuation debug:** "convoy 0.8× (slowest of N transports)" (`data-evac-speed`).
- **War planning debug:** "force speed 0.85× (its slowest ship)", and each operation's "N days → day D at
  0.85×" (`data-op-speed`). The section's heading no longer says travel is ship-independent.
- **Shipyard:** each class card has a "Strategic speed" stat (screenshot SPEED-shipyard-class-speeds.png).
- **Captain's route map:** "N travel days at 1.2×".

## 15. Save / load

- Speed is not saved per ship. It comes from the class.
- A journey saves `legBase`, `legDays`, `speed`, `speedHistory`, `legArrivalDay` and `etaDay`. A load
  restores them exactly:
  - the same leg ETA;
  - no re-plot from the origin;
  - no day gained or lost;
  - no crossing repeated (pure 9/25; gate CONVOY-SLOWEST-MEMBER saves and loads between the legs).
- **The leg in flight keeps its timing. The next leg uses the speed at its boundary.** A change in the
  group (a member detached, disabled or joined) or in the catalogue between save and load takes effect at
  the next boundary, never mid-leg.
- A doctrine job saved before this round has no `a.speed`. Its expectations were made at 1.0, and they are
  re-made at the speed it actually flies when it next sets out, so there is no false "missed arrival"
  (pure 27). A delivery contract issued before this round keeps its 1.0 due day plus slack.
- A journey saved before this round has no `legBase`. It finishes on its stored legs (1.0×), and
  `respeedJourney` leaves it alone. Its next journey or replot carries the new fields.
- Save size: see the measurements. The new fields are a few numbers per journey.

**Pre-existing quirk, found and not fixed in this round.** When the captain shares a system with convoy
ships, a reload rebuilds those ships from the scene, and a damaged vessel hull resets to the class default.
The evac-blockade integration gate places the captain off the convoy's route (at Vulcan) so its mid-way
save compares two identical models.

## 16. Gate and test changes needed by the speed (no behaviour weakened)

The in-game gates assert days that are now the ships' own. Each expectation is now computed at the flying
group's speed, through the same model functions. The extra speed argument is ignored on f0e219b, so the
gates stay baseline-compatible.

- **strategic-movement-gate:**
  - `__plot` takes a speed;
  - the Klingon mission is chosen on the chart and timed at `hullsSpeed`;
  - EVAC-REAL-LEGS is timed at `evacuationSpeed`;
  - DEBUG-JOURNEYS reads its columns from the end (the new Speed column).
- **strategic-time-scale-gate:**
  - `__days` takes a speed;
  - INVESTIGATION-TWO-LEGS is at the investigator's speed;
  - NO-INSTANT-MOVEMENT compares each leg at that leg's speed (`speedHistory`).
- **strategic-tactical-handoff-gate:** `__fly` legs at `captainCourseSpeed`.
- **formation-route-gate:** legs at `fleetGroupSpeed(members)`.
- **blockade-running-gate:**
  - the INTEL check matches "Known force" (the effects list's "Reinforcements …" is not a force count);
  - a phase with no runs because the blockade had already broken counts as a clear road.
- **evac-blockade-gate:**
  - STRONG-REDUCES is judged over 6 round trips with the blockade kept on station (`blockadeMaxDays` 400);
  - EVAC-THROUGH-CEASEFIRE waits for the first post-ceasefire delivery at the convoy's own speed, not a
    fixed 7 days;
  - in the integration case:
    - phase runs are counted by day (a blockade keeps only its last 30);
    - the heavy escorts are brought in at the escort phase (built at the start, they garrisoned the
      origin and wore the blockade down before it had been run);
    - the blockade phase is 8 trips;
    - the captain watches from off-route (§15 quirk).
- **playtest-gate:** RENDEZVOUS, RECALL and RANK-LEG-TIME read the trader's legs at her own speed. The
  distance reckoning they compare against is at the same speed.
- **doctrine-runtime-gate:** BLOCKADE-SHARED-ENGINE advances by the Romulan hull's own leg (`__leg(…, h)`).
- **blockade-running-gate:**
  - POLICY-WAIT-REROUTE waits until the waiter arrives at its 0.8× (bounded), not a fixed 40 days;
  - the integration's unescorted phase is four round trips, not three, because three (six runs) could
    all pass by chance.
- **Fixtures:**
  - the blockade and handoff test fixtures carry `strategicSpeed` (converted, §10);
  - the doctrine-galaxy and time-scale fixtures keep their legacy tactical `speed` keys, which are now
    ignored, so they fly at 1.0 (their time assertions assume uniform speed);
  - the campaign world fixture marks the 6↔7 wormhole `legFixed`.
- **Code fix found by the new suite:** `settleCrossing` recursed without end for a journey kind with no
  registered hooks. It compared a fresh `{}` with itself. It now compares the registry entry. No shipped
  kind was affected.
- **Fixes from the independent review** (all with regressions where they change behaviour):
  - pre-round doctrine jobs re-timed when they set out (pure 27);
  - an owner's expectations re-made when its journey is re-timed at a boundary (pure 28);
  - a doctrine job's speed is set from the journey actually started (alone, if its escorts could not
    start with it);
  - the escort position check reads the charge's live journey speed;
  - escorts slower than their charge are not chosen;
  - area-patrol station days are at the patrol ship's speed;
  - `speedHistory` keeps its first entry when bounded;
  - the debug cell shows only the legs a truncated journey still has.

## 17. Measurements

Same seed (`fresh('speed-longrun')`), the default campaign advanced 400 days, candidate against f0e219b
(`npm run measure:speed`; the baseline with `BM1_TEST_ROOT=<f0e219b>/dist BM1_LONGRUN_LABEL=baseline`).
Nothing was tuned to the old numbers. f0e219b has no speed field, so there each journey is bucketed by the
speed this round's catalogue gives its slowest member. On f0e219b every bucket flies exactly the chart
(1.00 per chart day): that is the ship-independent baseline. The two campaigns diverge after the first
speed-adjusted journey, so totals (losses, battles, operations) describe two different histories. They are
not a balance comparison.

Leg duration by speed bucket (first leg of each journey; bucket = the slowest member's catalogue speed):

| bucket | journeys (cand / base) | flown per chart day (cand / base) | mean leg days (cand / base) | min–max (cand) |
|---|---|---|---|---|
| 0.8 freighter | 71 / 67 | 1.27 / 1 | 15.1 / 11.64 | 9–28 |
| 0.85 battleship | 38 / 52 | 1.17 / 1 | 13.42 / 11.35 | 8–26 |
| 0.9 capital | 81 / 88 | 1.1 / 1 | 12.86 / 11.48 | 8–22 |
| 1.0 cruiser | 167 / 165 | 1 / 1 | 11.31 / 11.21 | 6–22 |
| 1.1 light cruiser | 6 / 6 | 0.91 / 1 | 10.33 / 10 | 8–13 |
| 1.2 escort/fast | 37 / 43 | 0.85 / 1 | 8.32 / 10.42 | 6–17 |
| 1.3 scout | 4 / 11 | 0.75 / 1 | 10.5 / 11.73 | 6–15 |

| measure | candidate | f0e219b |
|---|---|---|
| journeys started / arrived | 406 / 364 | 435 / 395 |
| **planned vs actual arrival mismatches** | **0** | **0** |
| journeys re-timed at a boundary | 0 | 0 |
| groups (2+ hulls): mean slowest / mean fastest member | 129: 0.91 / 1.15 | 125: 0.9 / 1.16 |
| groups slowed by a member | 103 | 106 |
| operations: total / engaged | 34 / 28 | 42 / 32 |
| operations: mean planned ETA (days) / mean force speed | 51.82 / 0.85 | 49.62 / — (no speed) |
| **operations engaged off their planned day** | **0** | **0** |
| reinforcements & returns: journeys / arrived / mean days / off plan | 30 / 22 / 17.32 / 0 | 27 / 26 / 26.5 / 0 |
| evacuations started / completed | 7 / 6 | 6 / 6 |
| evacuation mean one-way / mean cycle (days) | 13.57 / 19.39 | 13.5 / 18.04 |
| evacuation mean convoy speed | 1.13 | — |
| people moved | 218200 | 199000 |
| rescue proposed / feasible / out of reach / sent | 0 / 0 / 0 / 0 | 0 / 0 / 0 / 0 |
| investigation proposed / feasible / out of reach | 0 / 0 / 0 | 0 / 0 / 0 |
| patrol days travelling / on station (travel share) | 1125 / 356 (76%) | 1130 / 365 (76%) |
| blockades / runs (by kind) | 5 / 1 {"evacuation":1} | 4 / 0 {} |
| lowest standing garrison (any power) / which | 1 / borg | 1 / borg |
| hulls lost / battles | 38 / 31 | 58 / 37 |
| save size (bytes) / campaign book (bytes) | 943492 / 823904 | 971501 / 849415 |
| ms per campaign day | 104.2 | 126.07 |


**Rescue feasibility by speed.** Neither build raised a rescue or investigation in these 400 days on this
seed, so the long run has nothing to bucket. The difference is shown directly:
- pure 11/13: same origin and survivors: 1.3× accepted (13 days), 0.8× refused (21 days > 15);
- pure 12/FAST-VS-SLOW-RESCUE and gate RESCUE-FEASIBILITY: Vulcan Light Cruiser 1.2× sent, 19 days,
  arrived on its planned day 47 and rescued; Vulcan Explorer 0.9× refused, "arrives day 53, 25 days;
  survivors last to day 48".

**Formation speeds** (the player's): gate FAST-VS-SLOW-ETA. Earth → Vulcan, chart 10 + 12 + 10:
- Saber formation at 1.2×: 8 + 10 + 8, arrives day 27;
- Kingston at 0.8×: 13 + 15 + 13, arrives day 42;
- both on their planned day.

CONVOY-SLOWEST-MEMBER:
- planned at 0.8×: 13 + 15 + 13;
- the Kingston left the formation on day 14, and the first leg still ended on day 14 as issued;
- the remaining legs flew 10 + 8 at 1.2×, arriving on day 32;
- save/load between the legs changed nothing.

CAPTAIN-COURSE: his Saber (1.2×) flies Earth → Vulcan in 26 days alone and 41 days with a Kingston
escorting him.

**Watch items**

| watch for | what the run shows |
|---|---|
| extreme spreads | Days per chart day range from 0.75 (scouts) to 1.27 (freighters): a 1.7× spread between the fastest and slowest bucket. No leg is 0 days, and the longest is 28 (a 22-day chart leg at 0.8×). |
| capitals too slow | Capitals fly 1.10 days per chart day and battleships 1.17. AI operations fly at a mean 0.85×, because most forces include a battleship or heavy frame. Their mean planned ETA is 51.8 days against 49.6 on f0e219b (+4%). These ~50-day ETAs come from gathering a force from several origins, which f0e219b already does; speed adds little to it. |
| impossible evacuations | 7 started, 6 completed, 1 still running at day 400; none was impossible. Mean one-way 13.6 days (13.5) and cycle 19.4 (18.0). The AI's mean convoy speed is 1.13×: it picks cruiser-speed transports where it has them. |
| AI emptying garrisons | The lowest standing count per power is unchanged within ±2 for every power except the Breen (2, against 6 on f0e219b). That is one small fleet drawn into the war on a different history. Keep watching it. |
| ETA mismatch | **0** planned-vs-actual arrival mismatches in 364 arrived journeys, **0** of 28 engaged operations off their planned day, and **0** reinforcements or returns off plan. |
| blockade encounters | 5 blockades, 1 run (an evacuation), against 4 blockades and 0 runs. The gate fixtures measure the odds (§10). |
| save size / performance | Save 943 KB (971 KB on f0e219b). 83–104 ms per campaign day over two candidate runs, against 126 ms for f0e219b; this is timing noise (runs side by side). The candidate's run is deterministic: the second clean-tree run matched the first in every figure except a 1-byte save timestamp. |

**Gates.** The full normal suite was run on a clean worktree of the candidate: **78/78 exit 0** (the build
plus 77 scripts; the list and logs are in the package). The new suites:
- `test:speed`: 25/25 (baseline-defect 8, new-feature 12, preservation 5);
- `test:speed:ingame`: 8/8 (baseline-defect 5, new-feature 3).

Against f0e219b, `test:speed` scores 3/25. Every baseline-defect check fails on its own assertion, for
example "fast arrives day 11, slow day 11". The in-game gate scores 0/8 there, for example "the Saber
formation flies 10,12,10; the chart at 1.2× is 8,10,8".


## 18. Still deferred

1. towing/salvage, plus stranded-hull recovery movement
2. trader record-shape consolidation
3. treaty expansion: DMZs, inspection regimes, tribute, reparations, basing rights, transit guarantees
4. NPC tactical-scene persistence
5. autonomous war declarations
6. doctrine invasion/occupation
7. broad covert doctrine
8. Hirogen hunting
9. Borg assimilation
10. Gorn activation
11. Tactical Cube
12. **damage-based speed penalties** (§4: no reliable engine-condition state)
