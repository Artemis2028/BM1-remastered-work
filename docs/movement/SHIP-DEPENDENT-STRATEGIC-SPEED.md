# Ship-dependent strategic speed (rated)

Stacked on the frozen 7d3ce43 (treaty expansion and the captain's personal-warp correction). The previous round
(f0e219b → 78cd8fa) made a journey's days depend on the ships flying it, through ten hull categories. This round
replaces the categories with a **per-hull 1–10 strategic speed rating**, taken exactly as the BM1 Strategic Speed
Rater recommends it. There are no user overrides.

- The rating is **sustained strategic cruise**: the pace a hull keeps up between systems. It is not tactical
  impulse speed, not a warp-factor conversion, not the hull's size and not a planning-only estimate.
- **One model.** Every journey and every planner reads the same function on the same hulls. A planned ETA is the
  arrival day: 0 mismatches in 402 arrived journeys and 0 of 34 engaged operations off their planned day in the
  long run (§12).
- The consumer-by-consumer classification is in `STRATEGIC-SPEED-AUDIT.md`.

## 1. The rating: one source

- **Input:** the rater the user approved, kept verbatim at `docs/movement/sources/BM1-strategic-speed-rater.html`.
- **One canonical runtime source:** each class in `bm-ships/ships.json` (and `data/starship_manifest.json`, synced
  by `scripts/sync-ship-roster.mjs`) carries:

| field | meaning |
|---|---|
| `strategicSpeedRating` | 1–10 in half steps, the rater's recommendation |
| `strategicSpeed` | the multiplier for that rating (§2) |
| `strategicSpeedConfidence` | `high`, `medium` or `low`, as the rater gives it |
| `strategicSpeedBasis` | `rater:table` (a named entry in the rater) · `rater:fallback` (the rater's role/class inference for a hull it does not name) · `rater:fallback (retired)` |
| `strategicSpeedNote` | the rater's stated basis for the value |

- **How the values got there.** `scripts/assign-strategic-speed.mjs` does not re-type the rater's numbers: it runs
  the rater's own recommendation code (its per-hull table `OV`, its `multiplierByRating`, its `recommendation()`
  and `fallbackRec()`) in a sandbox against every catalogue class, and writes the result into the class record.
  It refuses to run if the runtime's multiplier table differs from the rater's. The rater's 129 named entries all
  match catalogue names; the other 43 active classes get the rater's own fallback; the 2 retired classes (which the
  rater skips) get the same fallback and are marked as such.
- **No duplicate maps.** The multiplier table exists once at runtime (`RATING_MULTIPLIER` in
  `src/strategic-speed.mjs`). `classSpeed(stats)` reads `strategicSpeedRating` and maps it through that table;
  nothing else in the engine knows a class's speed. The previous round's `CATEGORY_SPEED` table and its
  `authored` overrides are removed. `speedCategory` survives only as the *hull category* that recovery capacity,
  inspection regimes and the captain's traffic class read; it no longer sets a speed.
- **Legacy and fallbacks.** A class with no rating (an old record, a fixture, an unknown id) flies at its
  `strategicSpeed` if it has one and otherwise at 1.00× (= 5/10, the chart's own pace).
- **Saves stay valid.** The rating lives in the catalogue, not the save (§10).

The full per-hull table, with every rating's confidence and provenance, is **Appendix A**. It is generated from
`ships.json`, and the pure suite fails if the doc and the catalogue disagree.

## 2. Rating → multiplier

The rater's mapping, unchanged. Treat it as the initial gameplay scaling, not a permanent curve.

| rating | 1 | 1.5 | 2 | 2.5 | 3 | 3.5 | 4 | 4.5 | 5 | 5.5 | 6 | 6.5 | 7 | 7.5 | 8 | 8.5 | 9 | 9.5 | 10 |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| multiplier | 0.70 | 0.74 | 0.78 | 0.82 | 0.85 | 0.89 | 0.92 | 0.96 | 1.00 | 1.04 | 1.08 | 1.12 | 1.16 | 1.20 | 1.24 | 1.28 | 1.32 | 1.36 | 1.40 |

How the catalogue's 172 active classes spread over it (the 2 retired classes, the Vulcan Explorer at 7 and the Vulcan Lifeform at 6 by fallback, are not counted):

| rating | 1 | 2 | 2.5 | 3 | 3.5 | 4 | 4.5 | 5 | 5.5 | 6 | 6.5 | 7 | 7.5 | 8 | 8.5 | 9 | 9.5 | 10 |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| classes | 1 | 1 | 2 | 4 | 2 | 7 | 6 | 16 | 6 | 15 | 27 | 23 | 20 | 18 | 11 | 7 | 2 | 4 |

The catalogue's geometric-mean multiplier is 1.12: most of the galaxy's ships are faster than the chart's own
pace, which is the 5/10 baseline.

## 3. Journey timing

```
baseLegDays   = the chart's leg (Fleet.travelDays(route distance), via world.legDays / legBaseBetween)
actualLegDays = fixed ? fixedDays : max(1, ceil(baseLegDays / multiplier))
```

- **ceil**, as the brief specifies. The previous round rounded to nearest. A 5/10 hull (1.00×) reproduces the
  chart exactly (pure 3), so the baseline is unchanged; every other rating is the rater's.
- Never 0 days; no fractional-day state anywhere. The route never depends on the ship, only each leg's days.
- A journey stores `legBase: [{ days, fixed }]`, `speed`, `speedHistory: [{ fromLeg, speed }]` and now
  `plannedEtaDay` (the ETA as planned at departure, kept for the debug's planned-vs-actual column).

Leg days by rating (`adjustLegDays`):

| chart days | 1/10 (0.70×) | 2 (0.78×) | 3 (0.85×) | 4 (0.92×) | 5 (1.00×) | 6 (1.08×) | 7 (1.16×) | 7.5 (1.20×) | 8 (1.24×) | 8.5 (1.28×) | 9 (1.32×) | 9.5 (1.36×) | 10 (1.40×) |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| 1 | 2 | 2 | 2 | 2 | 1 | 1 | 1 | 1 | 1 | 1 | 1 | 1 | 1 |
| 3 | 5 | 4 | 4 | 4 | 3 | 3 | 3 | 3 | 3 | 3 | 3 | 3 | 3 |
| 5 | 8 | 7 | 6 | 6 | 5 | 5 | 5 | 5 | 5 | 4 | 4 | 4 | 4 |
| 8 | 12 | 11 | 10 | 9 | 8 | 8 | 7 | 7 | 7 | 7 | 7 | 6 | 6 |
| 10 | 15 | 13 | 12 | 11 | 10 | 10 | 9 | 9 | 9 | 8 | 8 | 8 | 8 |
| 12 | 18 | 16 | 15 | 14 | 12 | 12 | 11 | 10 | 10 | 10 | 10 | 9 | 9 |
| 15 | 22 | 20 | 18 | 17 | 15 | 14 | 13 | 13 | 13 | 12 | 12 | 12 | 11 |
| 20 | 29 | 26 | 24 | 22 | 20 | 19 | 18 | 17 | 17 | 16 | 16 | 15 | 15 |

**Watch: ceil on short legs.** Under ceil, any hull rated below 5 flies a 1-day leg in 2 days; above 5, a short
leg gains nothing (a 3-day leg is 3 days from 5/10 to 10/10). Slow hulls pay most on many-hop routes of short
legs, and fast hulls gain most on long legs. This is the rule as specified; §12 measures its effect.

## 4. Provenance: canon-backed against inferred

The rater says it scored "on-screen/official speed statements where available, then role/era inference for
BM/custom hulls", and that low-confidence BM/custom recommendations "are deliberately provisional". Every rating
keeps that provenance next to it (Appendix A), so a playtest change can see what it is changing:

| provenance (Appendix A) | from | classes | what changing one means |
|---|---|---|---|
| **lore anchor** | rater table, confidence high | 22 | a canon or official figure (e.g. "Canon maximum cruising speed warp 9.975"). Changing it departs from the lore the rater anchored to. |
| **lore-informed inference** | rater table, confidence medium | 52 | placed from canon context, era and family ("inferred from battlecruiser family", "no firm canon number used"). |
| **BM estimate · rater table** | rater table, confidence low | 55 | a BM-specific or custom hull the rater named and placed by role ("BM defense cruiser; inferred"). |
| **BM estimate · rater role/class fallback** | rater `fallbackRec`, confidence low | 43 | not named by the rater at all: its generic role/class inference ("Provisional BM role/class inference; no specific canon warp figure used"). |
| **BM estimate · rater fallback (retired class)** | the same fallback | 2 | retired classes the rater skips. |

So, for instance: "the D'deridex feels too slow" touches a **lore anchor** (7.5, high: "Observed around warp 9;
warp 9.6 damages propulsion; staying cloaked limits it to warp 6."), while "the Kingston feels too fast" touches
a **BM estimate · rater role/class fallback** (5, low).

The brief's key anchors, as the catalogue now carries them:

| class | rating | multiplier | confidence | provenance |
|---|---|---|---|---|
| Intrepid Explorer | 10 | 1.40 | high | lore anchor |
| Prometheus Tactical Cruiser | 10 | 1.40 | high | lore anchor |
| Constitution III Class | 10 | 1.40 | high | lore anchor |
| Inquiry Class | 10 | 1.40 | high | lore anchor |
| Sovereign Class / Sovereign Command Cruiser | 9.5 | 1.36 | high | lore anchor |
| Galaxy Class / Galaxy Command Variant | 8.5 | 1.28 | high / medium | lore anchor / lore-informed inference |
| Defiant Escort | 8.5 | 1.28 | high | lore anchor |
| Vor'cha Attack Cruiser | 8.5 | 1.28 | high | lore anchor |
| D'deridex Warbird | 7.5 | 1.20 | high | lore anchor |
| Ferengi Marauder Refit | 7.5 | 1.20 | high | lore anchor |
| Galor Cruiser | 6.5 | 1.12 | high | lore anchor |
| Nova Surveyor | 6 | 1.08 | high | lore anchor |
| Danube Utility Runabout | 3 | 0.85 | high | lore anchor |
| NX Class | 2 | 0.78 | high | lore anchor |
| Bajoran Solar Sailor | 1 | 0.70 | high | lore anchor |

(The pure suite's test 0 checks every one of these against the catalogue.)

## 5. Formations and convoys

Unchanged from the previous round, now at the rated speeds:

- **A group flies at its slowest member able to travel** (`groupSpeed`, `hullsSpeed`, `fleetGroupSpeed`,
  `evacuationSpeed`, `captainCourseSpeed`): player formations, doctrine formations, strategic war groups, escorts,
  evacuation convoys, blockade groups and returns all go through these. For model hulls (`hullsSpeed`,
  `hullCanTravel`) a disabled, surrendered, crew-awaiting or lost member is not travelling and does not set the
  pace (pure 22/23); for the captain's own ships (`fleetGroupSpeed`, `captainCourseSpeed`, `fleetShipCanTravel`)
  a destroyed or disabled one — the only states his vessels have.
- **A faster escort never speeds a convoy:** every group function is a minimum (pure 5/6).
- **The slowest member leaving at a boundary speeds the later legs**; the leg in flight keeps the days it was
  issued (pure 7/8; gates SLOWEST-FORMATION-UI and CONVOY-SLOWEST-MEMBER). `respeedJourney` re-times only later
  legs and appends to `speedHistory`.
- **No mid-leg re-timing.** There is no rule that changes a leg in flight; an engine-damage rule would be one
  (§7).

## 6. Single hulls and the captain

- A single-hull journey (investigation, rescue, patrol, courier, trader, repair, return) flies at its own
  class's rating.
- **The captain's own course** flies at `captainCourseSpeed()`: his current hull's rating, or the slowest escort
  warping with him. Changing his ship (`state.playership` → `applyCurrentShipStats`) changes his next course
  (gate CAPTAIN-SHIP-SPEED: Earth → Vulcan (chart 10 + 12 + 10) in an Intrepid 8 + 9 + 8 days; back in a Danube 12 + 15 + 12). The
  star chart shows the plotted course's ETA at that pace ("Vulcan → Earth: 39 days"), and it is exactly what the
  calendar charges.
- Preserved, with their gates re-run: treaty-aware personal warp (captain-treaty gate; pure 18), intermediate
  tactical handoff on the adjusted day (gate HANDOFF-ADJUSTED-DAY: a Danube captain is stopped at the blockaded
  Alpha Centauri ceil(chart / 0.85) days out, the encounter pending), route resume, save/load and blockade
  interception (strategic-tactical-handoff gate).

## 7. Deferred and special

- **Engine damage: deferred.** No continuous engine-damage speed penalty this round. A hull is either strategically
  mobile at its class rating or unavailable under the existing disabled-hull rules (refused as a transport,
  skipped by planners, left out of a group's pace and detached from formations). A damaged but operational hull
  flies at its class rating. A mid-leg slowdown would be the first rule allowed to re-time a leg in flight.
- **Special propulsion stays separate**, never expressed through the 1–10 number:
  - **Borg transwarp** — a future special route/travel mechanic. The cubes are rated 9 for *conventional* cruise,
    as the rater advises ("Borg transwarp should be modeled separately rather than as rating 10+").
  - **Crossfield spore drive** — separate; no catalogue hull uses it as conventional speed.
  - **Wormhole transit** keeps its fixed days for every rating, 1 to 10 (`world.legFixed`; pure 24, gate
    WORMHOLE-FIXED); the captain's wormhole passage is its own fixed transit.
  - **The Bajoran Solar Sailor** is rated 1 for normal cruise; its exceptional tachyon-assisted FTL remains special
    (rater: "should remain special"). No tachyon mechanic is added here.

## 8. The changed ETA / planning matrix

Every planner below reads the same model at the speed of the hulls it would send. "Changed" is what this round
changes for it: the rated multiplier and ceil in place of the category speed and nearest-rounding.

| planner | speed it uses | function | regression |
|---|---|---|---|
| rescue feasibility | the relief hull's rating, against the survivors' window | `responseCapacity` → `vesselEta` at `hullSpeed(h)` | pure 10, SPEED-RESCUE; gate RESCUE-FEASIBILITY |
| investigation ETA / deadline | the investigator's rating | `vesselEta` | (as rescue; pure suite of the previous round) |
| war target scoring | each origin group's slowest member; the force arrives with its last group | `forceEtaDays`, `chooseOperationTarget` | pure 11/SPEED-WAR-PLANNING; gate ETA-AWARE-WAR-SPEED |
| incoming defence | each defender on its own adjusted arrival | `forceAccount` | pure 12 |
| reinforcement / Dominion reinforcement | the convoy's slowest hull; counted from its adjusted arrival | `forceEtaDays`, `expeditionAssessment` | pure 13 |
| evacuation destination / cycle | the slowest transport or escort | `evacuationSpeed`, `validateEvacuationDestination`, `evacuationDestinations`, `evacuationRoundTripDays` | pure 9; gate EVAC-CONVOY |
| patrol cadence | the patrol hull's rating | the assignment's milestones at `hullSpeed(h)`, `patrolStationDays(…, speed)` | pure 15 |
| contracts / deliveries | the carrier's rating | `routeLegDaysFor(route, hullSpeed(h))`, `projectDaysFor(…, projectCarrierSpeed)` | (previous round) |
| repair / return ETA | the hull's rating | `plannedJourneyDays(…, hullSpeed(h))` | (previous round) |
| blockade response / interception | crossings on the adjusted day; dash term from the same strategic speed | `startJourney` crossings, `blockadeRun` | pure 19; gate HANDOFF-ADJUSTED-DAY |
| captain's route | his hull, or his slowest escort | `captainCourseSpeed()`; chart ETA `mapCourseEtaText` | gates CAPTAIN-SHIP-SPEED, CAPTAIN-COURSE |
| trader ETA | the trader hull's rating | `fleetTradeRouteDays(route, shipStrategicSpeed(f.shipId))` | gate TRADER-ETA; playtest RANK-LEG-TIME |
| treaty routing | the lawful route, flown at the hull's rating | `plotJourney` with the treaty filter | pure 18; captain-treaty gate |

**No planning-only shortcut.** `startJourney` re-times every journey from its `legBase` at its flying hulls'
speed whatever plan it was handed, and the planners call the same functions on the same hulls, so a planner
working at any other speed would show as a planned-vs-actual mismatch. Pure 4 checks planned = actual at every
rating on the table; pure 25 checks statically that no planner reads raw chart days (the model takes a leg's
length only through `legBaseBetween`, and the engine reads `Fleet.travelDays` only for the chart's base legs).

**Blockade running.** The dash term reads the same strategic multiplier, `(runner ÷ blockade)^2`, bounded. The
exponent was calibrated against the category spread (sd of log speed 0.145). The rated catalogue's spread is
0.123, so the exponent is kept; the term changes by less than it did when it was introduced.

## 9. UI and debug

Player-facing (the label is `ratingLabel`, "8.5/10 · 1.28×"; raw arithmetic is kept out of the player's view):

- **Fleet & Shipyard:** each vessel's `data-fleet-speed` line, "Strategic speed: 8.5/10 · 1.28×" (followed by
  its formation's pace when it is in one); each class card in the shipyard; each ship in the ops pickers; the
  ops convoy line.
- **Formation:** `data-formation-speed`, "Strategic speed: 3.0/10 · 0.85× (limited by USS Plodder) · Earth →
  Vulcan: 39 days" (the limiter is named when the formation has more than one ship; the ETA appears for a chosen
  destination before dispatch). The travel line ends "· strategic speed 3.0/10 · 0.85×".
- **ETA:** the star chart's selected-system rail shows the plotted course's ETA, "Vulcan → Earth: 39 days"
  (`data-map-eta`), at the captain's own pace. When a DMZ in force bars the plotted route it adds the lawful
  route's days ("· around the DMZ: N days") or "· DMZ: no lawful route". An interrupted course's remaining
  days (`captainCourseLine`) are read from the same plan the resume flies (`captainResumePlan`), the lawful
  route included.

Debug (Cheats & Debug → Strategic journeys, `journeySpeedCell`):

- the effective rating and multiplier (`data-journey-effective`) and the limiting hull (`data-journey-limiter`:
  the slowest member able to travel, named only when it is slower than another; "the tow" on a tow);
- each participant's rating (`data-journey-participants`; a towed hulk shows "in tow", and a member not able to
  travel is marked "(not travelling)");
- base → flown leg days (`data-journey-legs`, e.g. "10→12 · 12→15 · 10→12"), every re-time "from leg N: …";
- planned ETA against actual arrival ("planned day 40 · now due day 40"; and in the "Recently ended" table, which
  lists the captain's formations' last travels with the model journeys, "planned day 40 · arrived day 40 (as
  planned)", `data-journey-planned-actual`). A formation held at a blockade when dispatched records its plan when
  it first sets out.

The war-planning and evacuation debug sections show the force's and the convoy's rating the same way.

## 10. Save / load

- The rating is per class, not saved per ship. A journey saves `legBase`, `legDays`, `speed`, `speedHistory`,
  `legArrivalDay`, `etaDay` and `plannedEtaDay`; a load restores them exactly (pure 21: mid-leg save/load keeps the
  adjusted arrival; gate CONVOY-SLOWEST-MEMBER saves and loads between legs).
- **A journey in flight when this build loads an older save keeps its stored legs.** Its next boundary re-times
  the later legs at the rated speed. Nothing is re-timed mid-leg.
- No change to save shape beyond `plannedEtaDay` (a number per journey).

## 11. Tests and gates

New:

- `test:speed:ratings` (`scripts/strategic-speed-rating-test.mjs`): 23 checks on real catalogue classes, covering
  regressions 1–15, 18, 19, 21–25, SPEED-RESCUE, SPEED-WAR-PLANNING and SLOWEST-FORMATION (as 7/8), plus the
  doc-table checks (Appendix A must equal the catalogue, byte for byte), and RATER-EXACT: every class's rating,
  confidence, basis and note are what the rater's own code recommends for it, and the runtime manifest
  (`data/starship_manifest.json`) carries the same.
- `test:speed:ratings:ingame` (`scripts/strategic-speed-rating-gate.cjs`): FLEET-RATING, SLOWEST-FORMATION-UI (the
  formation line, dispatch, debug fields, planned = arrived), CAPTAIN-SHIP-SPEED (16, 17; the chart's ETA),
  TRADER-ETA (14), HANDOFF-ADJUSTED-DAY (19, 20).
- `measure:speed:ratings` (`scripts/strategic-speed-rating-measure.cjs`): the long run (§12).
- `scripts/strategic-speed-table.mjs`: generates Appendix A (`--write`) and checks it (`--check`).

Regression → check:

| # | regression | where |
|---|---|---|
| 1 | 10/10 faster than 5/10 | pure 1 |
| 2 | 1/10 slower than 5/10 | pure 2 |
| 3 | 5/10 reproduces the baseline | pure 3 |
| 4 | planned ETA = actual arrival | pure 4; every gate's arrival check; long run (0 mismatches) |
| 5 | formation at slowest member | pure 5/6; gates SLOWEST-FORMATION-UI, CONVOY-SLOWEST-MEMBER |
| 6 | faster escort does not speed a convoy | pure 5/6, 9 |
| 7 | slowest leaving at a boundary speeds later legs | pure 7/8; gate CONVOY-SLOWEST-MEMBER |
| 8 | no retroactive mid-leg re-time | pure 7/8 (the slow hull lost mid-leg: the leg in flight keeps its days and arrival); gate CONVOY-SLOWEST-MEMBER (taken out mid-leg) |
| 9 | evacuation ETA / cycle | pure 9; gate EVAC-CONVOY |
| 10 | rescue feasibility | pure 10, SPEED-RESCUE; gate RESCUE-FEASIBILITY |
| 11 | war planner | pure 11/SPEED-WAR-PLANNING; gate ETA-AWARE-WAR-SPEED |
| 12 | incoming defence | pure 12 |
| 13 | Dominion reinforcement | pure 13 |
| 14 | trader ETA | gate TRADER-ETA; playtest RANK-LEG-TIME |
| 15 | patrol cadence | pure 15 |
| 16 | captain uses ship speed | gate CAPTAIN-SHIP-SPEED; gate CAPTAIN-COURSE |
| 17 | changing the captain's ship changes future travel | gate CAPTAIN-SHIP-SPEED |
| 18 | treaty reroute / DMZ | pure 18; captain-treaty gate, treaty gate (full suite) |
| 19 | blockade crossing on the adjusted day | pure 19; gate HANDOFF-ADJUSTED-DAY |
| 20 | handoff on the adjusted day | gate HANDOFF-ADJUSTED-DAY; strategic-tactical-handoff gate |
| 21 | save/load mid-leg | pure 21 |
| 22 | disabled / surrendered / crew-awaiting give no speed | pure 22/23 |
| 23 | vids unchanged | pure 22/23 |
| 24 | wormhole correct | pure 24; gate WORMHOLE-FIXED |
| 25 | no planner uses the old ETA | pure 25 (static), pure 4, the long run |

Changed, with no behaviour weakened:

- `test:speed` (the previous round's suite, `ship-strategic-speed-test.mjs`): its fixture keeps synthetic
  multipliers; its literal day counts were re-derived for ceil. 25/25.
- `test:speed:ingame` (`ship-strategic-speed-gate.cjs`): expected speeds and labels now come from the catalogue's
  ratings; the slow ship is the Danube (3/10; the Kingston is now 5/10, the chart's own pace); the rescue pair is
  the Vulcan Light Cruiser (7.5) against the Vulcan Warpship (4); the war pair is Vor'cha (8.5) against Klingon
  cargo ships (5; no Klingon class is rated below 5, so this pair does not exercise a below-baseline force — pure
  11 does, at 3/10). The war check now requires the faster force's ETA to be no later for every target and earlier
  for at least one (ceil makes very short routes tie).
- `playtest-gate` RANK-LEG-TIME: the faster-reckoned world A is now chosen off B's route. With the rated legs the
  old pick put A on B's way, and the planner fairly carried both in one circuit (42.9 latinum a day against A's
  40). The check of what it guards (distance reckoning vs flown legs) is unchanged.
- `evac-blockade-gate` EVAC-BLOCKADE-INTEGRATION: two fixture changes, both explained in the gate.
  - The blockade phase is counted in runs (at least five, ending with the convoy home loading) rather than a
    fixed eight round trips. A convoy turned back is damaged each time and nothing repairs it on the way: on the
    rated build the Tarellian freighters (7/10, faster and with better odds than at 7d3ce43, pPass 0.62 against
    0.53) were turned back six times in nine runs on this seed's draw and worn out before the escort phase.
  - Nine Sovereign escorts instead of six. Six stood at 0.54 of the blockade's strength, under the 0.75 at which
    escorts screen a convoy (`interceptCoverRatio`), so the escorted phase was the same dice as the unescorted
    one (7d3ce43 passed it 6 of 7 on the draw). Nine (0.81) fight the convoy through, which is the phase's point.
- `doctrine-runtime-gate` lays out only the doctrine section for its full-section pictures (other sections
  hidden, as the newer gates do). With the journey debug's rated fields above it, the whole dialog grew past
  what Chromium captures in one screenshot and the browser closed mid-check.
- **Fixes from the independent review** (no behaviour weakened):
  - formations' ended travels now reach the debug's "Recently ended" table, and the gate asserts on the
    formation's own row (it could match an unrelated AI journey before);
  - `plannedEtaDay` is recorded for a formation held at a blockade when it first sets out;
  - the debug's "limited by" names only a member able to travel, and only when it is slower than another;
    a tow is named as the tow (the formation line follows the same rule);
  - `captainCourseSpeed` leaves out a disabled escort by the same test as `fleetGroupSpeed`;
  - `ratingMultiplier` holds a rating to 1–10 (0, 11 or 10.5 no longer fall silently to 1.00×);
  - the evacuation's "too far … at the convoy's …" refusal uses the rating label;
  - pure 7/8 now loses the slow hull mid-leg (it was a pass-through before), pure 18's name says what it checks,
    the doc-table check cannot silently vanish, and RATER-EXACT was added.
- `probe-harness` exports `fleetGroupLimiter`, `formationSpeedText`, `formationEtaText`, `mapCourseEtaText`,
  `journeyParticipantSpeeds`.

## 12. Long-run measurement

Same seed (`fresh('speed-rating-longrun')`), the default campaign advanced 400 days, the candidate against 7d3ce43
(`npm run measure:speed:ratings`; the baseline with `BM1_TEST_ROOT=<7d3ce43>/dist BM1_LONGRUN_LABEL=baseline`).
Nothing was tuned toward the old numbers. 7d3ce43 flies the previous round's category speeds with legs rounded to
nearest. On both builds a journey is bucketed by the **rating** this catalogue gives its slowest member, so the
buckets line up. The two campaigns diverge after the first journey whose timing differs, so totals (battles,
losses, operations) describe two different histories, not a balance comparison. The candidate run is
deterministic: two runs matched in every figure except time per day.

Journey time by rating band (slowest member):

| band | journeys (cand / base) | flown per chart day (cand / base) | mean first leg (cand / base) | min–max (cand) | mean journey days (cand / base) | longest (cand / base) |
|---|---|---|---|---|---|---|
| 3–4.5 | 44 / 54 | 1.13 / 1.07 | 13.09 / 12.48 | 9–19 | 29.3 / 23.8 | 64 / 67 |
| 5–6 | 85 / 88 | 1.00 / 1.22 | 11.71 / 14.3 | 7–22 | 26.1 / 27.1 | 73 / 91 |
| 6.5–7.5 | 245 / 238 | 0.89 / 0.98 | 9.56 / 10.53 | 5–19 | 16.8 / 19.4 | 75 / 84 |
| 8–8.5 | 35 / 43 | 0.83 / 1.00 | 10.2 / 13.35 | 6–16 | 20.7 / 25.5 | 81 / 98 |
| 9–10 | 39 / 21 | 0.77 / 1.01 | 8.92 / 11.19 | 6–16 | 17.1 / 23.1 | 57 / 56 |

(No AI journey had a 1–2.5 slowest member on either build.)

Journey time by role (the slowest member's catalogue role, the twelve most travelled on the candidate):

| role (slowest member) | rating | journeys | mean days | days per chart day | 7d3ce43: journeys / mean days / per chart day |
|---|---|---|---|---|---|
| compact warship | 7.5 | 38 | 9.5 | 0.84 | 40 / 9 / 0.83 |
| Renux cruiser | 6.5 | 34 | 10.2 | 0.94 | 29 / 10.7 / 1 |
| assault battleship | 7.5 | 30 | 11.2 | 0.84 | 20 / 15.8 / 1.16 |
| advanced tactical cruiser | 10 | 28 | 12.9 | 0.76 | 11 / 18.5 / 1 |
| Klingon armed hauler | 5 | 22 | 35.9 | 1 | 18 / 36.8 / 1.27 |
| entry Bird of Prey | 6.5 | 21 | 13.7 | 0.94 | 19 / 8.7 / 0.86 |
| armed merchant cruiser | 7.5 | 18 | 19.6 | 0.85 | 16 / 22.4 / 1 |
| Ferengi defense cruiser | 7 | 17 | 19.9 | 0.92 | 14 / 21 / 0.9 |
| bulk interstellar freighter | 4 | 12 | 27.8 | 1.14 | — |
| Tholian cargo cruiser | 5 | 11 | 25.9 | 1 | 11 / 27 / 1.27 |
| Miltek military transport | 6 | 10 | 11.2 | 1 | 14 / 14 / 1.27 |
| Daedalus service refit | 5 | 9 | 32.3 | 1 | 10 / 31.7 / 1.12 |

| measure | candidate | 7d3ce43 |
|---|---|---|
| journeys started / arrived | 449 / 402 | 449 / 405 |
| **planned vs actual arrival mismatches** | **0** | **0** |
| journeys re-timed at a boundary | 0 | 0 |
| groups (2+ hulls): mean slowest / mean fastest member | 128: 1.06 / 1.23 | 130: 1.07 / 1.22 |
| **slowest-member penalty** (first leg, days beyond the group's fastest member alone): groups slowed / mean / max | 93 of 128 / 1.5 / 7 | 107 of 130 / 2.86 / 12 |
| operations: total / engaged | 44 / 34 | 44 / 33 |
| operations: mean planned ETA (days) / mean force speed | 46.27 / 1.00× | 48.07 / 0.86× |
| **operations engaged off their planned day** | **0** | **0** |
| reinforcements & returns: journeys / arrived / still under way at day 400 / mean days / off plan | 26 / 13 / 12 / 11.85 / 0 | 26 / 22 / 4 / 19.5 / 0 |
| evacuations started / completed / partial / failed / active | 10 / 6 / 1 / 1 / 2 | 10 / 8 / 1 / 0 / 1 |
| evacuation mean one-way / mean cycle (days) / mean convoy speed | 17.9 / 19.07 / 1.09× | 15.9 / 17.72 / 1.17× |
| people moved | 187800 | 136600 |
| rescue / investigation proposed in the run | 0 / 0 | 0 / 0 |
| patrol days travelling / on station (travel share) | 1126 / 353 (76%) | 1130 / 350 (76%) |
| blockades / runs (by kind) | 1 / 1 {evacuation: 1} | 3 / 0 |
| hulls lost / battles / control changes | 80 / 40 / 32 | 80 / 37 / 30 |
| AI hull choice: mean rating of hulls sent on operations / of all ready hulls | 7.14 / 6.63 | 6.98 / 6.62 |
| journeys whose slowest member is rated ≤ 3 / their mean days | 1 / 64 | 12 / 12.25 |
| save size (bytes) / campaign book (bytes) | 1052066 / 932969 | 1101888 / 980575 |
| ms per campaign day | 221 | 224 |

The "still under way at day 400" returns are the Klingon and Breen forces sent home in the last days of a war
(all twelve started on day 354 or later, with ETAs up to day 433); none is stuck.

**Rescue: feasible against failed-by-distance.** Neither build raised a rescue or investigation in these 400
days on this seed (as in the previous round's run), so the run is complemented by the rescue reach of each
rating on the real chart: from every 4th system to every other (2222 routes), the days a lone relief hull
flies, against the doctrine's 20-day survivor window.

| rating | 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9 | 10 |
|---|---|---|---|---|---|---|---|---|---|---|
| feasible (≤ 20 days) | 88 | 92 | 98 | 105 | 126 | 126 | 163 | 180 | 210 | 222 |
| too far | 2134 | 2130 | 2124 | 2117 | 2096 | 2096 | 2059 | 2042 | 2012 | 2000 |
| mean days | 108.5 | 97.3 | 89.9 | 83.7 | 74.1 | 72 | 66.9 | 62.3 | 58.8 | 55.5 |

A 10/10 hull can reach 1.8× as many routes inside the window as a 5/10, and 2.5× as many as a 1/10. The fixed
scenarios: pure 10 (Intrepid 13 days accepted, Danube 21 refused against a 15-day window), SPEED-RESCUE, and gate
RESCUE-FEASIBILITY (Vulcan Light Cruiser sent and on time; Vulcan Warpship refused).

**Watch items**

| watch for | what the run shows |
|---|---|
| shuttles too slow | Hulls rated ≤ 3 almost left the AI's journeys: 1 (64 days) against 12 (12 days) on 7d3ce43. On 7d3ce43 the runabouts were "scouts" at 1.3×, the fastest category; the rater puts the Danube at 3 (canon warp 5), and the ETA-aware planners now pass it over. No slow hull was stranded: the one 64-day journey arrived. The player's own Danube is usable but slow (0.85×: Earth → Vulcan 39 days against 32 for a 5/10). |
| fast ships trivialising the map | The fastest band flies 0.77 days per chart day; no leg is under 5 days in the AI's traffic (a 1-day leg stays 1 day at any rating ≥ 5). Operations' mean planned ETA fell 4% (48.1 → 46.3 days), and battles rose 37 → 40 on a different history. Control changes 30 → 32. Nothing here looks trivialised. |
| convoys immobile | No group was immobile. The slowest-member penalty fell (mean 2.86 → 1.5 days on the first leg; max 12 → 7), because the rated spread inside a typical group is narrower than the category spread was. Evacuation convoys averaged 1.09× (1.17× on 7d3ce43, when freighters' categories were fast escorts' neighbours); one-way 17.9 days against 15.9. |
| AI preferring only fast hulls | Hulls sent on operations average 7.14 against a ready pool of 6.63 (+0.51); on 7d3ce43 the same measure was 6.98 against 6.62 (+0.36). A mild extra preference, not exclusion: the 3–4.5 and 5–6 bands still made 129 journeys. |
| rescue / investigation balance | Reach grows smoothly with rating (table above); a fast hull reaches about twice the routes of a baseline one inside the window. No planner disagrees with its journey. |
| speed compounding with distance | Under ceil, a hull below 5/10 loses a whole day on every 1-day leg (§3), so slow hulls pay most on many-hop routes: the 3–4.5 band (0.85–0.96×) flies 1.13 days per chart day. Fast hulls gain least on short legs. Watch many-hop slow convoys in play. |
| ETA mismatch | **0** planned-vs-actual mismatches in 402 arrived journeys, **0** of 34 engaged operations off their planned day, **0** reinforcements or returns off plan. |
| blockade encounters | 1 blockade and 1 run on the candidate, 3 and 0 on 7d3ce43 — too few on this seed to compare. The run odds are measured in the gates: at the evac-blockade integration's blockade, the rated Tarellian freighters (7/10) run at pPass 0.62, against 0.53 at their 7d3ce43 category speed. |
| save size / performance | Save 1052 KB (1102 KB on 7d3ce43); 221 ms against 224 ms per campaign day (runs side by side). |

## 13. Carry-forward

Kept explicitly, unchanged by this round:

1. towing/salvage + stranded-hull recovery movement (the tow pace is still `clamp(min(group, towed) × 0.7, 0.4,
   1.0)` of the rated speeds)
2. trader record-shape consolidation
3. basing staging/docking consumption
4. DMZ stationing/loitering breach handling
5. NPC tactical-scene persistence
6. autonomous war declarations
7. doctrine invasion/occupation
8. broad covert doctrine
9. Hirogen hunting
10. Borg assimilation/transwarp (transwarp as a special route, §7)
11. Gorn activation
12. Tactical Cube

Added by this round: **engine-condition speed degradation** (§7), and **a playtest pass over the low-confidence
ratings** (Appendix A's "BM estimate" rows: 100 of 174 classes).

## Appendix A — the approved per-hull rating table

Every class in the catalogue, by faction, then rating. "Provenance" is §4's reading of the rater's confidence and
source; "rater's basis" is the rater's own note.

<!-- strategic-speed-table:begin (generated by scripts/strategic-speed-table.mjs; do not edit by hand) -->

174 classes. By provenance: lore anchor 22 · lore-informed inference 52 · BM estimate · rater table 55 · BM estimate · rater role/class fallback 43 · BM estimate · rater fallback (retired class) 2.

| id | class | faction | role | rating | multiplier | confidence | provenance | rater's basis |
|---:|---|---|---|---:|---:|---|---|---|
| 240 | Andorian Patrol Cruiser | andorian | Andorian patrol cruiser | 7.0 | 1.16× | low | BM estimate · rater table | BM later patrol cruiser; inferred. |
| 293 | Kumari Class | andorian | Andorian battlecruiser | 3.5 | 0.89× | medium | lore-informed inference | 22nd-century Andorian battlecruiser; early warp generation. |
| 348 | Andorian Cargo Shuttle | andorian | Andorian cargo shuttle | 3.0 | 0.85× | low | BM estimate · rater table | Cargo shuttle. |
| 345 | Bajoran Solar Sailor | bajoran | Bajoran sail transport | 1.0 | 0.70× | high | lore anchor | Solar-sail craft is not a normal warp cruiser; exceptional tachyon-assisted FTL should remain special. |
| 346 | Borg Assimilation Cube | borg | Borg assimilation cube | 9.0 | 1.32× | high | lore anchor | Conventional strategic speed is high, but Borg transwarp should be modeled separately rather than as rating 10+. |
| 261 | Tactical Cube | borg | mission tactical cube | 9.0 | 1.32× | medium | lore-informed inference | Same principle: conventional travel high; transwarp is a special system. |
| 234 | Breen Light Cruiser | breen | Breen shield cruiser | 8.0 | 1.24× | low | BM estimate · rater table | BM fast shield cruiser. |
| 218 | Breen Warship | breen | Breen attack cruiser | 8.0 | 1.24× | medium | lore-informed inference | Late Dominion-War peer combatant; no precise canon sustainable speed used. |
| 233 | Breen Shuttle | breen | Breen shuttle | 4.5 | 0.96× | low | BM estimate · rater table | Small craft. |
| 324 | Keldon War Cruiser | cardassian | Cardassian war cruiser | 7.5 | 1.20× | medium | lore-informed inference | Observed/technical references include enhanced warp performance; advanced Galor derivative. |
| 314 | Cardassian Hideki Shuttle | cardassian | Cardassian patrol craft | 6.5 | 1.12× | medium | lore-informed inference | Fast patrol craft relative to Cardassian fleet. |
| 323 | Galor Cruiser | cardassian | Cardassian fleet cruiser | 6.5 | 1.12× | high | lore anchor | Canon approximately warp 8. |
| 62 | Cardassian Behemoth | cardassian | Cardassian supercapital | 5.5 | 1.04× | low | BM estimate · rater table | BM supercapital; very large hull. |
| 292 | Cardassian Transport Ship | cardassian | Cardassian convoy transport | 5.0 | 1.00× | low | BM estimate · rater table | Convoy transport. |
| 319 | Delpin Long-Range Cruiser | delpin | Delpin long-range cruiser | 8.0 | 1.24× | low | BM estimate · rater table | Long-range role. |
| 22 | Delpin Warship | delpin | compact warship | 7.5 | 1.20× | low | BM estimate · rater table | Compact warship. |
| 51 | Delpin Luxury Liner | delpin | luxury liner | 6.0 | 1.08× | low | BM estimate · rater table | Liner prioritizes comfort/range over speed. |
| 216 | Dominion Cruiser | dominion | Dominion cruiser | 8.0 | 1.24× | medium | lore-informed inference | Dominion combat cruiser; inferred from battlecruiser family. |
| 48 | Jem'Hadar Battlecruiser | dominion | JemHadar battlecruiser | 8.0 | 1.24× | medium | lore-informed inference | Technical references list about warp 9.6; heavy Dominion cruiser. |
| 206 | Dominion Scout | dominion | Dominion scout | 7.5 | 1.20× | medium | lore-informed inference | Scout role. |
| 65 | Dominion Battleship | dominion | Dominion supercapital | 7.0 | 1.16× | medium | lore-informed inference | Very heavy hull; canon observed figure is not a demonstrated maximum. |
| 322 | Jem'Hadar Attack Ship | dominion | JemHadar attack ship | 7.0 | 1.16× | high | lore anchor | Canon observed warp 7+; some technical sources give higher, but sustained capability is uncertain. |
| 238 | Dominion Freighter | dominion | Dominion logistics ship | 5.0 | 1.00× | low | BM estimate · rater table | Logistics role. |
| 315 | Ferengi Marauder Refit | ferengi | armed merchant cruiser | 7.5 | 1.20× | high | lore anchor | D'Kora class is canonically warp 9+. |
| 317 | Ferengi Vagabond | ferengi | Ferengi defense cruiser | 7.0 | 1.16× | low | BM estimate · rater table | BM defense cruiser; inferred. |
| 316 | Ferengi Cargo Shuttle | ferengi | cargo shuttle | 3.0 | 0.85× | low | BM estimate · rater table | Small cargo shuttle. |
| 288 | Gorn Interceptor | gorn | reserved Gorn interceptor | 8.0 | 1.24× | low | BM estimate · rater table | Interceptor role; inferred. |
| 252 | Gorn Patrol Ship | gorn | reserved Gorn patrol | 7.0 | 1.16× | low | BM estimate · rater table | Patrol role; inferred. |
| 251 | Gorn Cruiser | gorn | reserved Gorn cruiser | 6.0 | 1.08× | low | BM estimate · rater table | Reserved BM Gorn hull; inferred. |
| 253 | Hirogen Hunter | hirogen | Hirogen hunter | 8.5 | 1.28× | medium | lore-informed inference | Voyager-era hunter expected to cover large distances efficiently. |
| 254 | Hirogen Warship | hirogen | Hirogen warship | 8.0 | 1.24× | medium | lore-informed inference | Large Voyager-era warship; inferred. |
| 267 | Hirogen Shuttle | hirogen | Hirogen hunting shuttle | 6.5 | 1.12× | low | BM estimate · rater table | Hunting shuttle. |
| 334 | Vor'cha Attack Cruiser | klingon | Klingon attack cruiser | 8.5 | 1.28× | high | lore anchor | Memory Alpha lists warp 9.5+. |
| 255 | K'tra Class | klingon | Ktra attack cruiser | 7.5 | 1.20× | low | BM estimate · rater table | BM Klingon attack cruiser; role inference. |
| 42 | Neg'Var Warship | klingon | assault battleship | 7.5 | 1.20× | high | lore anchor | Negh'Var-line heavy battleship. |
| 333 | Negh'Var Command Ship | klingon | Klingon command battleship | 7.5 | 1.20× | high | lore anchor | Mirror Negh'Var observed up to warp 9; huge command battleship. |
| 332 | K'Vort Patrol Ship | klingon | Bird of Prey patrol ship | 7.0 | 1.16× | medium | lore-informed inference | Bird-of-Prey patrol role; fast response but not top-tier strategic cruise. |
| 351 | Klingon Bird of Prey | klingon | light Bird of Prey | 7.0 | 1.16× | medium | lore-informed inference | Light Bird-of-Prey; tactical agility does not automatically equal top strategic cruise. |
| 330 | B'rel Scout | klingon | entry Bird of Prey | 6.5 | 1.12× | medium | lore-informed inference | Small Bird-of-Prey scout; good response speed, limited sustained endurance. |
| 61 | Klingon Qonos | klingon | Klingon supercapital | 6.0 | 1.08× | low | BM estimate · rater table | BM supercapital; large command hull. |
| 331 | K't'inga Cargo Cruiser | klingon | armed cargo conversion | 5.5 | 1.04× | medium | lore-informed inference | Older Klingon hull in cargo conversion. |
| 239 | Klingon Cargo Ship | klingon | Klingon armed hauler | 5.0 | 1.00× | low | BM estimate · rater table | Armed logistics ship. |
| 55 | Alien Bioship | neutral | alien combat bioship | 9.0 | 1.32× | low | BM estimate · rater table | Exotic combat bioship; intentionally high but uncertain. |
| 291 | Kaplan F17 Freighter | neutral | fast frontier freighter | 8.0 | 1.24× | low | BM estimate · rater table | Explicit fast frontier freighter. |
| 50 | Sentient Lifeform | neutral | organic transport | 8.0 | 1.24× | low | BM estimate · rater table | Exotic/organic transport; uncertain. |
| 301 | Thawn Class | neutral | Thawn frontier escort | 8.0 | 1.24× | low | BM estimate · rater table | Frontier escort; inferred. |
| 302 | Trieste Class | neutral | Trieste reconnaissance cruiser | 8.0 | 1.24× | low | BM estimate · rater table | Reconnaissance cruiser; inferred. |
| 276 | Helios Class | neutral | Helios civilian explorer | 7.5 | 1.20× | low | BM estimate · rater table | Civilian explorer. |
| 1 | Steamrunner Class | neutral | reserve cruiser | 7.5 | 1.20× | medium | lore-informed inference | Late-24c Starfleet combat hull; no firm canon warp figure found. |
| 335 | Akuzi Explorer | neutral | budget civilian explorer | 7.0 | 1.16× | low | BM estimate · rater role/class fallback | Provisional BM role/class inference; no specific canon warp figure used. |
| 15 | Ambassador Civilian Refit | neutral | civilian cruiser | 7.0 | 1.16× | medium | lore-informed inference | Ambassador-era frame; civilian refit lowers sustained strategic priority. |
| 311 | Mozart Civilian Explorer | neutral | civilian explorer | 7.0 | 1.16× | low | BM estimate · rater role/class fallback | Provisional BM role/class inference; no specific canon warp figure used. |
| 296 | Orion Science Ship | neutral | Orion science vessel | 7.0 | 1.16× | low | BM estimate · rater table | Long-range science vessel. |
| 297 | Penine Class | neutral | Penine patrol escort | 7.0 | 1.16× | low | BM estimate · rater role/class fallback | Provisional BM role/class inference; no specific canon warp figure used. |
| 54 | Tamarian Warship | neutral | independent cruiser | 7.0 | 1.16× | low | BM estimate · rater table | 24c independent cruiser; inferred. |
| 215 | Tarellian Freighter | neutral | quantum-drive freighter | 7.0 | 1.16× | low | BM estimate · rater table | Quantum-drive freighter; lower than the cruiser but above conventional bulk freighters. |
| 282 | Althinas Class | neutral | Vulcan-derived civilian explorer | 6.5 | 1.12× | low | BM estimate · rater role/class fallback | Provisional BM role/class inference; no specific canon warp figure used. |
| 310 | Aries Multipurpose Vessel | neutral | civilian generalist | 6.5 | 1.12× | low | BM estimate · rater role/class fallback | Provisional BM role/class inference; no specific canon warp figure used. |
| 248 | Eisenhower Class | neutral | Eisenhower civilian cruiser | 6.5 | 1.12× | low | BM estimate · rater role/class fallback | Provisional BM role/class inference; no specific canon warp figure used. |
| 214 | Freedom Class | neutral | independent utility escort | 6.5 | 1.12× | low | BM estimate · rater role/class fallback | Provisional BM role/class inference; no specific canon warp figure used. |
| 268 | Independent Warbird | neutral | independent militia warbird | 6.5 | 1.12× | low | BM estimate · rater role/class fallback | Provisional BM role/class inference; no specific canon warp figure used. |
| 290 | Intrepid Frigate | neutral | early Intrepid patrol refit | 6.5 | 1.12× | low | BM estimate · rater role/class fallback | Provisional BM role/class inference; no specific canon warp figure used. |
| 207 | Nausican Raider | neutral | armed raider | 6.5 | 1.12× | medium | lore-informed inference | Raider role; fast enough to intercept commerce, not a known top-warp benchmark. |
| 336 | New Orleans Civilian Refit | neutral | civilian patrol conversion | 6.5 | 1.12× | low | BM estimate · rater role/class fallback | Provisional BM role/class inference; no specific canon warp figure used. |
| 270 | Onyx Class | neutral | Onyx guard cruiser | 6.5 | 1.12× | low | BM estimate · rater role/class fallback | Provisional BM role/class inference; no specific canon warp figure used. |
| 312 | Centaur Reserve Cruiser | neutral | civilian reserve cruiser | 6.0 | 1.08× | medium | lore-informed inference | Miranda/Excelsior-era reserve frame. |
| 60 | Concord-class Grand Cruiser | neutral | independent supercapital | 6.0 | 1.08× | low | BM estimate · rater table | Independent supercapital; large hull. |
| 249 | Ford Class | neutral | Ford utility cruiser | 6.0 | 1.08× | low | BM estimate · rater role/class fallback | Provisional BM role/class inference; no specific canon warp figure used. |
| 342 | Olympic Support Ship | neutral | medical support transport | 6.0 | 1.08× | low | BM estimate · rater role/class fallback | Provisional BM role/class inference; no specific canon warp figure used. |
| 225 | Orion Starbridge | neutral | Orion commerce cruiser | 6.0 | 1.08× | low | BM estimate · rater table | Commerce cruiser. |
| 309 | Deforest Armed Freighter | neutral | armed civilian freighter | 5.5 | 1.04× | low | BM estimate · rater role/class fallback | Provisional BM role/class inference; no specific canon warp figure used. |
| 9 | Kingston Class | neutral | long-haul freighter | 5.0 | 1.00× | low | BM estimate · rater role/class fallback | Provisional BM role/class inference; no specific canon warp figure used. |
| 208 | Venture Class | neutral | light scout | 5.0 | 1.00× | low | BM estimate · rater role/class fallback | Provisional BM role/class inference; no specific canon warp figure used. |
| 247 | Drayton Class | neutral | Drayton service craft | 4.5 | 0.96× | low | BM estimate · rater role/class fallback | Provisional BM role/class inference; no specific canon warp figure used. |
| 303 | Warp Delta | neutral | early warp patrol craft | 4.5 | 0.96× | low | BM estimate · rater role/class fallback | Provisional BM role/class inference; no specific canon warp figure used. |
| 350 | Basic Shuttle | neutral | basic civilian shuttle | 4.0 | 0.92× | low | BM estimate · rater role/class fallback | Provisional BM role/class inference; no specific canon warp figure used. |
| 340 | Constitution Utility Tug | neutral | Constitution service tug | 4.0 | 0.92× | low | BM estimate · rater role/class fallback | Provisional BM role/class inference; no specific canon warp figure used. |
| 349 | Utility Shuttle | neutral | independent utility shuttle | 4.0 | 0.92× | low | BM estimate · rater role/class fallback | Provisional BM role/class inference; no specific canon warp figure used. |
| 24 | Lysian Fighter | neutral | budget light craft | 3.5 | 0.89× | low | BM estimate · rater role/class fallback | Provisional BM role/class inference; no specific canon warp figure used. |
| 341 | Constellation Cargo Tug | neutral | Constellation cargo tug | 2.5 | 0.82× | low | BM estimate · rater role/class fallback | Provisional BM role/class inference; no specific canon warp figure used. |
| 269 | NX Class | neutral | civilian NX refit | 2.0 | 0.78× | high | lore anchor | NX-01 era warp-five technology; very slow by late-24c standards. |
| 226 | Promelli Skiff | promelli | Promelli energy skiff | 5.5 | 1.04× | low | BM estimate · rater table | Ancient/legacy Promellian tech; inferred. |
| 227 | Promelli Manitee | promelli | Promelli heavy cruiser | 5.0 | 1.00× | low | BM estimate · rater table | Heavy ancient cruiser; inferred. |
| 321 | Norexan Warbird | romulan | fast strike warbird | 9.0 | 1.32× | medium | lore-informed inference | Later Romulan fast strike design; newer than D'deridex. |
| 53 | Reman Warbird | romulan | secret strike capital | 8.5 | 1.28× | medium | lore-informed inference | Advanced late-24c strike capital; Scimitar-like role cues. |
| 212 | Romulan Courier | romulan | Romulan courier | 8.0 | 1.24× | medium | lore-informed inference | Courier role favors sustained speed. |
| 320 | D'deridex Warbird | romulan | heavy cloaked warbird | 7.5 | 1.20× | high | lore anchor | Observed around warp 9; warp 9.6 damages propulsion; staying cloaked limits it to warp 6. |
| 29 | Romulan Scout | romulan | armed scout | 7.5 | 1.20× | medium | lore-informed inference | Scout/courier role favors high strategic speed. |
| 279 | Romulan Warbird | romulan | Romulan patrol capital | 7.5 | 1.20× | medium | lore-informed inference | Generic later warbird; inferred between D'deridex and Norexan. |
| 64 | Romulan Warhawk | romulan | Romulan supercapital | 7.0 | 1.16× | low | BM estimate · rater table | BM supercapital; large hull offsets Romulan propulsion quality. |
| 246 | Classic Warbird | romulan | classic Romulan capital | 6.5 | 1.12× | medium | lore-informed inference | Older Romulan capital design. |
| 256 | Renux Class | romulan | Renux cruiser | 6.5 | 1.12× | low | BM estimate · rater role/class fallback | Provisional BM role/class inference; no specific canon warp figure used. |
| 278 | Romulan Miltek | romulan | Miltek military transport | 6.0 | 1.08× | low | BM estimate · rater table | Military transport; inferred. |
| 277 | Romulan Freighter | romulan | Romulan convoy freighter | 5.0 | 1.00× | medium | lore-informed inference | Heavy logistics role. |
| 219 | Son'a Warship | sona | Sona attack cruiser | 8.5 | 1.28× | medium | lore-informed inference | Highly advanced late-24c power; strategic speed inferred. |
| 224 | Son'a Battleship | sona | Sona battleship | 8.0 | 1.24× | medium | lore-informed inference | Large advanced Son'a hull. |
| 235 | Son'a Shuttle | sona | Sona shuttle | 5.0 | 1.00× | low | BM estimate · rater table | Advanced small craft. |
| 257 | Suliban Cruiser | suliban | Suliban raiding cruiser | 5.0 | 1.00× | low | BM estimate · rater table | BM Suliban raiding cruiser; early-era baseline with advanced tech. |
| 259 | Suliban Cell Ship | suliban | Suliban cell ship | 4.5 | 0.96× | medium | lore-informed inference | Warp-capable 22nd-century craft with future-aided technology. |
| 258 | Suliban Pod | suliban | Suliban pod | 4.0 | 0.92× | low | BM estimate · rater table | Small Cabal craft; future-aided but limited hull. |
| 338 | Tarellian Quantum Cruiser | tarellian | quantum-drive cruiser | 8.0 | 1.24× | low | BM estimate · rater table | BM 'quantum-drive' role suggests above-average strategic propulsion; not canon-grounded. |
| 284 | Constitution III Class | terran | modern exploration cruiser | 10.0 | 1.40× | high | lore anchor | Warp 9.99 observed. |
| 289 | Inquiry Class | terran | heavy tactical capital | 10.0 | 1.40× | high | lore anchor | Explicitly called Starfleet's fastest ship in 2399. |
| 327 | Intrepid Explorer | terran | long-range explorer | 10.0 | 1.40× | high | lore anchor | Canon maximum cruising speed warp 9.975. |
| 328 | Prometheus Tactical Cruiser | terran | advanced tactical cruiser | 10.0 | 1.40× | high | lore anchor | Warp 9.9+ / 9.99 references; described as fastest Starfleet vessel of its era. |
| 38 | Sovereign Class | terran | battlecruiser | 9.5 | 1.36× | high | lore anchor | Sources vary (~9.7 to ~9.995); newer battlecruiser intended for high sustained strategic performance. |
| 329 | Sovereign Command Cruiser | terran | command battlecruiser | 9.5 | 1.36× | high | lore anchor | Sovereign-derived command hull. |
| 285 | Duderstadt Class | terran | modern reconnaissance cruiser | 9.0 | 1.32× | medium | lore-informed inference | Modern reconnaissance design; speed role strongly implied, no firm canon number used. |
| 299 | Sagan Class | terran | capital explorer | 9.0 | 1.32× | medium | lore-informed inference | Modern capital explorer. |
| 272 | Speeder | terran | fast courier | 9.0 | 1.32× | low | BM estimate · rater table | BM fast courier; role intentionally speed-specialized. |
| 325 | Akira Strike Cruiser | terran | upgraded strike cruiser | 8.5 | 1.28× | medium | lore-informed inference | Combat-optimized Akira variant. |
| 326 | Defiant Escort | terran | armored combat escort | 8.5 | 1.28× | high | lore anchor | Warp ~9.5 achievable, but engines are explicitly overpowered/stress-limited for the hull. |
| 286 | Excelsior II Class | terran | modern fleet cruiser | 8.5 | 1.28× | medium | lore-informed inference | Modern fleet-cruiser successor to Excelsior. |
| 275 | Falcon Class | terran | Falcon strike escort | 8.5 | 1.28× | low | BM estimate · rater table | Strike escort; inferred high speed. |
| 287 | Gagarin Class | terran | fleet assault cruiser | 8.5 | 1.28× | medium | lore-informed inference | Modern fleet assault cruiser. |
| 35 | Galaxy Class | terran | multipurpose capital | 8.5 | 1.28× | high | lore anchor | Warp 9.6 for hours; 9.8 theoretically at extreme risk; cruise lower. |
| 221 | Galaxy Command Variant | terran | Galaxy command capital | 8.5 | 1.28× | medium | lore-informed inference | Galaxy-derived command variant; same broad propulsion generation. |
| 33 | Akira Class | terran | standard battlecruiser | 8.0 | 1.24× | medium | lore-informed inference | Late-24c combat design; speed not firmly established on-screen. |
| 4 | Nebula Class | terran | survey logistics refit | 8.0 | 1.24× | high | lore anchor | Canon examples reach warp 9.3–9.6. |
| 298 | Reliant Class | terran | modern utility cruiser | 8.0 | 1.24× | medium | lore-informed inference | Modern utility cruiser. |
| 300 | Sutherland Class | terran | sensor support cruiser | 8.0 | 1.24× | medium | lore-informed inference | Modernized sensor-support cruiser. |
| 313 | Ambassador Imperial Cruiser | terran | Imperial fleet cruiser | 7.5 | 1.20× | medium | lore-informed inference | Ambassador-era strategic cruiser. |
| 245 | Belfast Class | terran | Belfast survey cruiser | 7.5 | 1.20× | low | BM estimate · rater role/class fallback | Provisional BM role/class inference; no specific canon warp figure used. |
| 283 | Cheyenne Class | terran | multi-mission cruiser | 7.5 | 1.20× | medium | lore-informed inference | 24c multi-mission cruiser; no firm canon max used. |
| 265 | Crossfield Class | terran | experimental survey cruiser | 7.5 | 1.20× | medium | lore-informed inference | Conventional warp only here; spore drive should be a separate special movement system. |
| 295 | Norway Class | terran | tactical escort cruiser | 7.5 | 1.20× | medium | lore-informed inference | Late-24c Starfleet combat/support hull. |
| 271 | Parliament Class | terran | engineering support cruiser | 7.5 | 1.20× | medium | lore-informed inference | Modern engineering/support cruiser. |
| 307 | Saber Planetary Defender | terran | local defense escort | 7.5 | 1.20× | medium | lore-informed inference | Late-24c escort; compact fast-response role. |
| 281 | Aeroshuttle | terran | armed auxiliary scout | 7.0 | 1.16× | low | BM estimate · rater table | Armed auxiliary scout. |
| 264 | California Class | terran | operations support cruiser | 7.0 | 1.16× | medium | lore-informed inference | Late-24c support ship; capable but not a speed-specialist. |
| 229 | Sovereign Yacht | terran | premium command yacht | 7.0 | 1.16× | low | BM estimate · rater table | Premium command yacht; fast auxiliary. |
| 344 | Steamrunner Strike Frigate | terran | military strike frigate | 7.0 | 1.16× | low | BM estimate · rater role/class fallback | Provisional BM role/class inference; no specific canon warp figure used. |
| 209 | sydney Class | terran | courier transport | 7.0 | 1.16× | low | BM estimate · rater role/class fallback | Provisional BM role/class inference; no specific canon warp figure used. |
| 230 | Aurelius Patrol Frigate | terran | frontier patrol frigate | 6.5 | 1.12× | low | BM estimate · rater role/class fallback | Provisional BM role/class inference; no specific canon warp figure used. |
| 242 | Austin Class | terran | Austin defense cruiser | 6.5 | 1.12× | low | BM estimate · rater role/class fallback | Provisional BM role/class inference; no specific canon warp figure used. |
| 220 | Azuki | terran | Azuki multirole cruiser | 6.5 | 1.12× | low | BM estimate · rater role/class fallback | Provisional BM role/class inference; no specific canon warp figure used. |
| 347 | Excalibur Class | terran | Project X supercapital | 6.5 | 1.12× | low | BM estimate · rater table | BM Project X supercapital; strategic speed kept below specialist cruisers. |
| 2 | Excelsior Class | terran | fleet cruiser | 6.5 | 1.12× | medium | lore-informed inference | Older Starfleet cruiser; high-warp capable but a generation behind Galaxy-era drive efficiency. |
| 49 | Galaxy Dreadnaught | terran | Project X dreadnaught | 6.5 | 1.12× | low | BM estimate · rater table | Huge dreadnought; prioritizes combat over cruise. |
| 217 | Human Bird of Prey | terran | Terran light raider | 6.5 | 1.12× | low | BM estimate · rater role/class fallback | Provisional BM role/class inference; no specific canon warp figure used. |
| 213 | Imperial Class | terran | Imperial command capital | 6.5 | 1.12× | low | BM estimate · rater role/class fallback | Provisional BM role/class inference; no specific canon warp figure used. |
| 294 | Luna Class | terran | deep-space survey cruiser | 6.5 | 1.12× | high | lore anchor | Memory Alpha lists warp 8 for the canon class. |
| 231 | Manticore Class | terran | assault cruiser | 6.5 | 1.12× | low | BM estimate · rater role/class fallback | Provisional BM role/class inference; no specific canon warp figure used. |
| 262 | Terra Class | terran | Terra command capital | 6.5 | 1.12× | low | BM estimate · rater role/class fallback | Provisional BM role/class inference; no specific canon warp figure used. |
| 11 | Vega Class | terran | civilian combat escort | 6.5 | 1.12× | low | BM estimate · rater role/class fallback | Provisional BM role/class inference; no specific canon warp figure used. |
| 241 | Astrid Class | terran | Astrid utility cruiser | 6.0 | 1.08× | low | BM estimate · rater role/class fallback | Provisional BM role/class inference; no specific canon warp figure used. |
| 244 | Beijing Class | terran | Beijing transport cruiser | 6.0 | 1.08× | low | BM estimate · rater role/class fallback | Provisional BM role/class inference; no specific canon warp figure used. |
| 266 | Diana Class | terran | Diana science cruiser | 6.0 | 1.08× | low | BM estimate · rater role/class fallback | Provisional BM role/class inference; no specific canon warp figure used. |
| 305 | Miranda Long-Range Frigate | terran | long-range frigate | 6.0 | 1.08× | medium | lore-informed inference | Old but extensively refitted Starfleet workhorse. |
| 306 | Nova Surveyor | terran | local survey ship | 6.0 | 1.08× | high | lore anchor | Canon Nova maximum warp 8; short-term science design. |
| 250 | Galaxy Yacht | terran | Galaxy command yacht | 5.5 | 1.04× | low | BM estimate · rater table | Command yacht. |
| 243 | Avon Class | terran | Avon courier | 5.0 | 1.00× | low | BM estimate · rater role/class fallback | Provisional BM role/class inference; no specific canon warp figure used. |
| 274 | Daedalus Class | terran | Daedalus service refit | 5.0 | 1.00× | low | BM estimate · rater role/class fallback | Provisional BM role/class inference; no specific canon warp figure used. |
| 47 | Oberth Tug | terran | entry utility tug | 5.0 | 1.00× | low | BM estimate · rater role/class fallback | Provisional BM role/class inference; no specific canon warp figure used. |
| 228 | Peregrin Fighter | terran | strike fighter | 5.0 | 1.00× | medium | lore-informed inference | Warp-capable tactical craft; strategic endurance lower than cruisers. |
| 236 | Salcombe class  | terran | heavy cargo frame | 5.0 | 1.00× | low | BM estimate · rater role/class fallback | Provisional BM role/class inference; no specific canon warp figure used. |
| 280 | Terran Constitution | terran | Imperial Constitution refit | 5.0 | 1.00× | medium | lore-informed inference | Old Constitution lineage/refit; TOS-era warp numbers are not directly comparable to 24c scale. |
| 273 | Type 11 Shuttle | terran | advanced shuttle | 4.5 | 0.96× | medium | lore-informed inference | Later/advanced shuttle, still not a long-range starship. |
| 10 | Tug Class II | terran | heavy tug | 4.0 | 0.92× | low | BM estimate · rater role/class fallback | Provisional BM role/class inference; no specific canon warp figure used. |
| 308 | Danube Utility Runabout | terran | armed utility runabout | 3.0 | 0.85× | high | lore anchor | Canon Danube maximum warp 5. |
| 263 | Type 7 Shuttle | terran | passenger shuttle | 2.5 | 0.82× | medium | lore-informed inference | Shuttlecraft-era strategic performance; comparable shuttle types are low-warp. |
| 232 | Tholian Battleship | tholian | Tholian battleship | 6.0 | 1.08× | low | BM estimate · rater table | Large warship; inferred. |
| 66 | Tholian Conquest | tholian | Tholian supercapital | 5.5 | 1.04× | low | BM estimate · rater table | Supercapital; inferred. |
| 223 | Tholian Cargo Ship | tholian | Tholian cargo cruiser | 5.0 | 1.00× | low | BM estimate · rater table | Cargo role. |
| 222 | Tholian Shuttle | tholian | Tholian shuttle | 4.5 | 0.96× | low | BM estimate · rater table | Small craft; inferred. |
| 318 | Tholian Isaac Freighter | tholian | bulk interstellar freighter | 4.0 | 0.92× | low | BM estimate · rater table | Bulk freighter; intentionally slow strategic hauler. |
| 237 | Vulcan Light Cruiser | vulcan | Vulcan fast cruiser | 7.5 | 1.20× | low | BM estimate · rater table | BM fast cruiser; role inference. |
| 260 | T'Pral Class | vulcan | TPral exploration cruiser | 7.0 | 1.16× | low | BM estimate · rater table | BM Vulcan exploration cruiser; inferred. |
| 343 | Vulcan C'Thia Defense Cruiser | vulcan | Vulcan defense cruiser | 7.0 | 1.16× | low | BM estimate · rater table | BM Vulcan defense cruiser; inferred. |
| 211 | Vulcan Expeditionary Explorer | vulcan | expeditionary capital | 7.0 | 1.16× | low | BM estimate · rater table | BM expeditionary capital; endurance emphasized over sprint. |
| 26 | Vulcan Explorer | vulcan | — | 7.0 | 1.16× | low | BM estimate · rater fallback (retired class) | Provisional BM role/class inference; no specific canon warp figure used. |
| 63 | Vulcan Lifeform | vulcan | — | 6.0 | 1.08× | low | BM estimate · rater fallback (retired class) | Provisional BM role/class inference; no specific canon warp figure used. |
| 25 | Vulcan Warpship | vulcan | Vulcan transport | 4.0 | 0.92× | medium | lore-informed inference | Early Vulcan/Suurok-era ships are around warp 6.5–7; much slower than late-24c Starfleet. |
| 210 | Vulcan shuttle | vulcan | Vulcan shuttle | 3.0 | 0.85× | low | BM estimate · rater table | Small Vulcan shuttle. |

<!-- strategic-speed-table:end -->
