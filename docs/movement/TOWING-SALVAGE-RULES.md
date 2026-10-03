# Towing, salvage and stranded-hull recovery — rules after the audit round

Stacked on the frozen **a7e56d2** (ship-dependent strategic speed, rated). This document states the rules
of BM1's **one** recovery system as corrected by the audit (TOWING-SALVAGE-AUDIT.md). The original design
is still in TOWING-SALVAGE-RECOVERY.md; where the two differ, this document governs. No second towing system
was written; every change is to the existing code.

    crew state  ≠  hull recovery  ≠  hull repair  ≠  recommissioning

A disabled ship stays where it was disabled. It does not repair itself, does not fly itself home, and keeps
the same persistent vid. It may have crew aboard, rescued crew, lost crew, or no crew. It moves again only
when a real recovery vessel flies out, takes it in tow, and tows it to a real yard.

**The one exception** is the captain's own personal vessel's **Emergency recovery**. It is a paid 5-second
stabilisation where she lies. It is kept by Rafael's decision of 03 Oct as an **INTENTIONAL PLAYER-ONLY
EMERGENCY RECOVERY EXCEPTION** (§10).

## 1. What changed in this round

| finding | change | where |
|---|---|---|
| A2 salvaged hull arrived with 1 hull point | Her hull is read before she leaves the old owner's books; the captain's prize keeps her actual damage. | `onRecoveryScene` |
| A3 casualty's own rating limited the tow | `towSpeed = clamp(towing group × 0.70, 0.40, 1.00)`; the casualty's rating no longer enters it. | `strategic-speed.mjs towSpeed`, `journeySpeed`, `planHullRecovery`, `startTow` |
| A4 recovery-only basing yard never repaired | A host yard is a destination (or an in-place pickup) only with basing rights for both `recovery` and `repair`. | `basingRecoveryYardAt`, `towYardOk`, `recoveryYardAt` |
| A5 no-vessel request refused | The request is kept, awaiting a vessel, and is matched the first day one is free. | `requestHullRecoveryWaiting`, `assignHullRecoveryAsset`, `matchWaitingPlayerRecoveries` |
| A6 record ended at the yard gate | The record follows the hull through the yard to back in service (`rec.after`); one phase in the brief's terms. | `recoveryPhase`, `yardPhase`, `advanceHullRecoveries` |
| A7 captain lines | Concise lines (§9). | `playerRecoveryLine`, effect reports |
| A8 debug | Recovery id, phase, ETA, tow rule, blocker, result; waiting requests counted. | `renderRecoveryDebug` |
| A10 recovery-scoped guarantee covered nothing | A transit guarantee naming `recovery` covers recovery traffic (a `military` one still does too). | `treaty-terms.mjs trafficInScope` |
| A11 a towed hulk in warp could be hit at the system she left | A hulk with `transit` lies nowhere; defender losses skip it. | `applyDefenderLosses` |
| A12 a casualty lost mid-leg left the tow flying on | The tow ends at the next crossing; the mission fails there. | `crossJourneyLeg` |
| A1 personal emergency recovery | Kept as the exception; relabelled **Emergency recovery**; fenced by preservation tests. | `recoverDisabledPlayer` |

## 2. Recovery lifecycle and state matrix

One persistent record per recovery (`book.hullRecoveries`), stable id `<seed>:tow:<n>`. It holds:
- the casualty (hull id, vid, class, origin) and its crew state;
- the recovery vessel and any escorts;
- where the casualty lay, the destination yard, and both routes with their legs;
- the phase, the authority (claim kind and basis) and the plan (ETA days);
- the waiting or holding blocker, and the result.

**Phases** (`recoveryPhase(rec)`; the internal mission states drive the tow):

| phase | internal state | entered when | leaves to | crew |
|---|---|---|---|---|
| `requested` | `requested`, `awaitingAsset` set | requested and no recovery vessel can take it; the casualty is claimed (no second mission), nothing moves | `recovery_asset_en_route` (a vessel is assigned); `aborted` (cancelled, casualty gone or no longer disabled) | as it is: aboard on its clock, rescued, or lost |
| `recovery_asset_en_route` | `assigned`, `en_route_to_hulk` | a real vessel is committed and flies the shared journey out | `on_scene`; `aborted` (cancel, casualty gone at a boundary); `failed` (vessel lost) | unchanged |
| `on_scene` | `on_scene` | the vessel reaches the casualty's system; every check runs again here | `tow_attached`; `aborted` | — |
| `tow_attached` | `attached` | made fast (salvage changes hands here) | `towing` the same day | aboard: life support carried by the tug from here |
| `towing` | `towing` | the tow journey departs, or holds with no way on | `in_yard` (delivered); `failed` (vessel lost, casualty destroyed, no way for `recoveryWaitDays`) | unchanged; nobody appears |
| `in_yard` | `delivered_to_yard`, `rec.after.phase` | delivered: the yard's ordinary recovery has it; not repaired | `repairing` | aboard: ashore at the yard |
| `repairing` | (same) | the yard's repair is raising the hull | `recrew_if_required` or `complete` | — |
| `recrew_if_required` | (same) | repaired out of the disabled band, crew rescued or lost: repaired-awaiting-crew | `complete` the day the complement is reached | — |
| `complete` | (same) | back in service: same hull, same vid | — | — |
| `left_yard` | (same) | still disabled and out of this yard's hands (the yard lost: back in the open), or another recovery has her; this record ends there and a new recovery's record follows her | — | as it is |
| `aborted` / `failed` / `lost_after_delivery` | — | as above; the casualty lies where it was let go | — | — |

A delivered record still following its hull is not pruned as history until its phase is final (`complete`,
`lost_after_delivery`, `left_yard`). A repair that lifts the hull out of the disabled band within one yard day
still records `repairing` that day.

**Deadline.** Only where physically meaningful:
- the crew's life-support clock (stopped while the tug carries them);
- a tow holding with no way on for `recoveryWaitDays` (20) is let go where it stands.

A waiting request has no deadline; the captain can cancel it.

## 3. Recovery asset: eligibility matrix

A casualty moves only with an **eligible real ship**:
- it is the sponsor's own;
- it is free: AI hulls `ready`; the captain's per `fleetShipFreeForOperation`;
- for the AI, it is never a world's last garrison (`recoveryGarrisonFloor` 1);
- its `recoveryCapacity` ≥ the casualty's mass;
- it has a valid lawful route out and a yard reachable by a lawful tow route (DMZs, guarantees, no wormhole
  for a tow);
- the claim rules allow it (§7).

With none: **awaiting recovery**. No ship is spawned. The captain's request is kept and matched daily. The AI
looks again every 5 days and records why it skipped.

Capacity is explicit per class (`bm-ships/ships.json recoveryCapacity`, from role and size, never combat
stats). The 172 active classes:

| category | capacity (max casualty mass) | classes | ratings | classes it can tow | examples |
|---|---|---|---|---|---|
| heavy tug | 10 | 1 | 4 | 172 / 172 | Tug Class II |
| tug | 8 | 3 | 2.5–5 | 163 | Oberth Tug, Constitution Utility Tug, Constellation Cargo Tug |
| support | 7 | 4 | 6–8 | 157 | California, Parliament, Sutherland, Olympic Support Ship |
| battleship | 6 | 14 | 5.5–9 | 145 | Neg'Var, Galaxy Dreadnaught, Klingon Qonos |
| capital | 5 | 15 | 6–10 | 118 | Galaxy, Sovereign, Jem'Hadar Battlecruiser |
| freighter | 4 | 14 | 4–8 | 98 | Kingston, Tarellian Freighter |
| cruiser | 3 | 38 | 3.5–10 | 59 | Excelsior, Nebula, Akira |
| light / fast cruiser | 2 | 32 | 4.5–10 | 43 | Steamrunner, sydney, Vulcan Light Cruiser |
| escort | 1 | 22 | 2–8.5 | 25 | Defiant Escort, Vega Class |
| shuttle / scout / runabout | 0 | 29 | 1–9 | 0 | Basic Shuttle, Danube, Romulan Scout |

Casualty masses: 1 (25 classes), 2 (18), 3 (16), 4 (39), 5 (20), 6 (27), 7 (12), 8 (6), 9 (3), 10 (6).

So:
- a Defiant (capacity 1) tows only a shuttle-sized hull;
- a Galaxy (5) cannot tow another Galaxy (mass 6);
- only the heavy tug, the tugs and support ships tow mass 7–10;
- no shuttle tows anything;
- one tug per casualty; multi-tug tows are deferred.

## 4. Movement

Both legs are the shared strategic journey (kind `recovery`; outbound `outbound`, tow `inbound` with
`tr.tow`). Each leg is real chart days at the group's multiplier: `max(1, ceil(chart / multiplier))`. The
tow:
- crosses every intermediate system once, observed;
- saves and loads mid-leg exactly;
- meets blockades through the shared engine;
- never takes a fixed traversal (wormhole).

The casualty is a journey member: carried, still disabled, the same vid.
- It is not repaired in transit.
- It is never dropped as "disabled" at a crossing.
- It is let go only when no capable towing ship remains with it: where the group last stood (§8).

## 5. Towing speed rule

```
tow multiplier = clamp( towing group multiplier × 0.70 , 0.40 , 1.00 )
```

- **Towing group multiplier:** the slowest towing member able to travel, escorts included. Escorts can only
  slow a tow.
- **The casualty's own rating does not enter.** A disabled hull has no drive; the tug carries it. (A3: on
  a7e56d2 the planner used `min(group, casualty) × 0.7`. A Tug Class II towing a Bajoran Solar Sailor flew
  0.49× instead of 0.64×: an 11-day leg took 23 days instead of 18.)
- **Floor 0.40, cap 1.00:** a tow never reaches the chart's own pace. The lowest catalogue rating (1/10,
  0.70×) gives 0.49×, so the floor does not bind on the catalogue.
- **Planner and journey use the same function** (`SPD.towSpeed`), so the planned ETA is the actual arrival
  (pure R9, in-game RECOVERY-FLOW).

| towing vessel | rating | alone | towing | an 11-day chart leg alone / towing |
|---|---|---|---|---|
| Constellation Cargo Tug | 2.5 | 0.82× | 0.57× | 14 / 20 |
| Tug Class II | 4 | 0.92× | 0.64× | 12 / 18 |
| Oberth Tug | 5 | 1.00× | 0.70× | 11 / 16 |
| California Class (support) | 7 | 1.16× | 0.81× | 10 / 14 |
| Galaxy Class (capital, mass ≤ 5 only) | 8.5 | 1.28× | 0.90× | 9 / 13 |
| Sovereign Class (capital, mass ≤ 5 only) | 9.5 | 1.36× | 0.95× | 9 / 12 |

- **A tow is always materially slower** than the same vessel alone (×0.70).
- **A Defiant does not tow a battleship at cruise:** its capacity (1) refuses it outright.
- **Watch item:** dedicated tugs are rated slow (2.5–5). A capital or battleship that *can* tow a given hull
  tows it faster than a tug does. Tugs matter by capacity (mass 7–10 needs a tug or support ship), not by
  speed. This is a balance question for playtest; no mass-based physics was added.

## 6. Crew and hull are separate

| case | before recovery | during the tow | at the yard | after repair |
|---|---|---|---|---|
| A. crew aboard | life-support clock runs (`crewSurvivalDays`) | the clock stops at attachment (`crewSupportedBy`); resumes with what was left if the tow is lost | ashore at the yard; resumes if the yard is lost before repair | back with her own crew |
| B. crew rescued first (`rescueStrandedCrew`, the doctrine relief) | hull stays where it is | towed in empty; nobody reappears | crewless | repaired-awaiting-crew (`recrew`) until `minOperatingCrew` |
| C. crew died | the hull stays; written off only after `derelictWriteOffDays` (90) with no claim, and never while a recovery claims it; a written-off wreck stays a derelict, salvageable, until it breaks up | towed in empty | crewless | as B |

The captain's vessels have no crew clock (the engine keeps them): crew are "aboard".

## 7. Ownership and salvage transition matrix

The claim (`claimVerdict`) is checked when requested and again on scene.

| casualty | crew | claimant's relation to its owner | result | ownership | record |
|---|---|---|---|---|---|
| own hull | any | — | **recovery** | unchanged | `claim.authority: own hull` |
| own written-off derelict | any | — | **recovery** (reclaimed) | back on its books, same record | derelict removed |
| another active polity's | aboard | any | **refused** (a capture, not a salvage) | unchanged | — |
| another active polity's | rescued / lost | at war, not in its space, not guarded | **salvage** | transferred **at attachment, explicitly** | `identity.history: salvaged {from, to}`, `salvagedFrom` / `takenFrom`, `stats.salvaged`, effect `hullSalvaged` / `hullSalvagedToPlayer`; the old owner counts it lost |
| another active polity's | rescued / lost | not at war | **refused** (not abandoned): no silent taking; an incident path is deferred | unchanged | — |
| any, in its owner's space or guarded by its owner | — | — | **refused** (protected / guarded) | unchanged | — |
| abandoned derelict (written off) | — | anyone | **salvage** | transferred at attachment | as above |
| surrendered | — | — | **refused** (the Phase 4 surrender rules) | unchanged | — |
| the captain's vessel | — | anyone else | **refused** (his vessels are not salvage) | unchanged | — |

A salvaged hull is the exact persistent hull: the same record (AI) or the same identity adopted (captain), the
same vid, class, damage, origin and history. The captain's prize now keeps her actual hull figure (A2). It
still has to be towed, repaired and re-crewed before it serves; there is no "salvage → pristine ship".
Salvage unlocks no production: no licence, plan, integration or design record changes (pure R25, in-game
SALVAGE-PRIZE-HULL). AI hulls carry no per-hull equipment or cargo in the model; the captain's adopted prize
gets the engine's class loadout snapshot. That is a known limit (audit §4).

## 8. Damage to the recovery operation

| event | casualty | recovery vessel | record |
|---|---|---|---|
| vessel lost or disabled on the way out | untouched where it lies | stranded where it dropped out (its own disabled state) or lost | `failed`; a new recovery may be sent |
| vessel **disabled** mid-tow (at a crossing or in a run) | let go at that system, still disabled | stranded at the same system | `failed`; both hulls at the actual system (pure R14) |
| vessel disabled in warp | let go at the leg's start (the model has no position between systems) | at the leg's start | `failed` |
| vessel **destroyed** | not destroyed, not moved on: let go where the tow last stood | lost | `failed` (pure R15) |
| vessel surrendered | let go there | held under the surrender rules | `failed` |
| tow **forced back** by a blockade | retreats with the tow, then the tow replans around the blockade | with it | `towing` (holding, `avoid` grows) |
| casualty destroyed under tow | lost | free where it stands | `failed` |
| an escort that cannot tow, left alone | let go where the last capable vessel was | goes free | `failed` |

## 9. Blockades, handoff, treaties, yards

- **Blockades:** there is no tow-specific resolver. The tow runs `resolveBlockadeRun` once per crossing, at
  its tow speed (the dash), with:
  - the casualty's mass in the signature, plus `towSignature` 0.2;
  - the casualty taking an unarmed share of damage;
  - escorts adding deterrence and cover;
  - no cloak: one uncloaked casualty spoils a cloaked tug's cloak (pure R12/R13).

  Damage falls on the same persistent hulls.
- **Tactical handoff:** where the captain is, an interception goes to the scene once.
  - The crossing is held; there is no strategic run alongside it.
  - The result is written back once.
  - The casualty is a non-spawned participant, `towed: true` (pure R31).
- **Treaties:** recovery is its own traffic class (`recovery`).
  - A DMZ binds it only if it prohibits recovery traffic.
  - A transit guarantee naming `recovery` (or `military`) lifts a DMZ for it (A10).
  - Basing rights make a host yard a destination only with both `recovery` and `repair` (A4), and never
    transfer ownership (pure R29/R30).
  - Inspections apply at crossings as for any mover.
- **Yards:** delivery only to a usable yard:
  - the AI's own yard, or a basing yard as above;
  - for the captain, his own yard or a repair yard of a power not at war with him.

  A yard lost before arrival is re-chosen at the next boundary. A yard lost after delivery repairs nothing
  and puts the hull back in the open (pure R20). Repair happens only in the yard, by the ordinary repair.

## 10. The captain

**Fleet vessels.** Each disabled vessel's row:
- before a request: `Recovery vessel: Tug Atlas · ETA: 22 days · Tow to: Vulcan`, or
  `No recovery vessel available (needs tow capacity 2)`, or — a ship of his could tow her but cannot get her
  anywhere — `No recovery: no yard a tow can reach` (then the request is refused, not kept: waiting for a
  vessel would not answer it);
- requested: `Recovery requested — USS Hood · Recovery vessel: Tug Atlas · ETA: 22 days · Tow to: Vulcan`, or
  `Recovery requested — No recovery vessel available`;
- towing: `Tug Atlas towing USS Hood → Vulcan · arrives day 43`;
- delivered: `In yard at Vulcan — awaiting repair` (he repairs her there, docked, at the ordinary price).

Reports: Recovery requested / Awaiting recovery vessel / Under tow / Recovered to yard / Back in service /
Recovery failed / Recovery called off.

**INTENTIONAL PLAYER-ONLY EMERGENCY RECOVERY EXCEPTION** (Rafael, 03 Oct).
- **Emergency recovery** (Fleet & Shipyard's top-level button, and the Ship disabled panel) applies only to
  the vessel the captain is aboard. It takes no vessel id.
- After 5 seconds she is restored enough to continue: hull just above the disabled band, operational.
- The same personal vid; the rescue debt is recorded as before.
- It creates no recovery record, no journey and no yard visit, and is not strategic towing.
- Fleet vessels, NPCs, AI and doctrine hulls, derelicts and prizes cannot use it. Preservation tests: in-game
  EMERGENCY-RECOVERY-EXCEPTION.
- No stationary wait for campaign time was added.

## 11. Debug

The **Recovery & salvage (debug)** section (`[data-recovery-section]`) shows each record with:
- recovery id;
- casualty vid and class;
- owner and origin;
- crew state;
- recovery asset;
- **phase** (and internal state);
- current system and leg, with the route out and back;
- destination yard;
- capability against what is needed;
- **speed and tow penalty** (group × 0.7);
- **ETA**;
- **blocker** (no vessel free, holding reason);
- claim;
- **result**, with the yard phases after delivery.

The header counts waiting requests and hulls back in service. The table below it lists every stranded hull
with no recovery.

## 12. Gates and regressions

| suite | candidate | a7e56d2 (baseline reproduction) |
|---|---|---|
| `test:towing:audit` (new, pure) | see the handoff | fails every baseline-defect check on its own assertion |
| `test:towing:audit:ingame` (new) | see the handoff | fails the baseline-defect checks on their own assertions |
| `test:towing` / `test:towing:ingame` (existing) | unchanged pure; in-game line regexes updated to the §10 wording | — |

Each of the brief's 32 regressions is mapped to a check:

| # | check |
|---|---|
| 1 | R1 |
| 2 | R2 |
| 3 | R3 (pure), NO-VESSEL-WAITS (in-game) |
| 4, 6 | R4/R6 |
| 5 | R5 |
| 7, 8 | R7/R8 (and R8b, escorts) |
| 9 | R9, RECOVERY-FLOW |
| 10 | R10, STRANDED-HULL-RECOVERY |
| 11 | R11, TOW-BLOCKADE |
| 12, 13 | R12/R13, TOW-UNDER-INTERDICTION |
| 14 | R14 |
| 15 | R15 |
| 16, 17 | R16/R17 |
| 18 | R18 |
| 19 | R19 |
| 20 | R20 |
| 21 | RECOVERY-FLOW (in-game), plus the EMERGENCY exception fence |
| 22 | R22 |
| 23, 24, 26 | R23/R24/R26, SALVAGE-PRIZE-HULL (in-game) |
| 25 | R25, SALVAGE-PRIZE-HULL |
| 27 | R27 |
| 28 | R28 |
| 29, 30 | R29/R30 |
| 31 | R31 |
| 32 | R32 |
| (found) | A11, A12 |

**Integrated scenarios:**
- STRANDED-HULL-RECOVERY and TOW-UNDER-INTERDICTION are pure;
- SALVAGE-PRIZE-HULL is pure (AI salvager, preservation) and in-game (the captain's prize, A2 baseline-defect);
- the lifecycle is in LIFECYCLE.
