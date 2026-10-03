# Basing and service matrix (ARCHITECTURE-CLEANUP §2, §3, §5, §6, §8)

DTG 031416ZOCT26 · stacked on 1f2da30.

The rule is simple: "access" is not one boolean. Transit, docking, staging, repair, resupply, recovery and production are separate permissions. Each one is granted or denied by its own term, and no permission implies another.

## The one model answer: `Campaign.accessAt(book, world, polity, system, cls, day)`

For each permission it returns `{ ok, basis: 'own' | 'open' | 'treaty' | 'none', termId, reason }`. It also returns `holder` and `atWar`.

| permission | own world | foreign, at peace | foreign, at war | granted by | never implied by |
|---|---|---|---|---|---|
| **transit** | open | open, unless a DMZ restricts transit for this class | open (war is not a treaty) | a **transit guarantee** from a DMZ party, for this class | staging, docking, basing |
| **staging** (stay, base, hold; a valid origin, return or rendezvous point) | own (`base: true`) | open, unless a DMZ bans **stationing** for this class. A foreign system is never a *base* without a term. | as at peace | a **staging** basing right from a DMZ party (lifts the stationing ban) | transit guarantee, docking, repair |
| **docking** (past a closed checkpoint) | own | not authorized | refused | a **docking** basing right | repair, resupply, staging |
| **repair** | own | not authorized | refused | a **repair** basing right | docking, staging, recovery |
| **resupply** | own | not authorized | refused | a **resupply** basing right | docking |
| **recovery** (a host takes a tow in) | own | not authorized | refused | a **recovery** basing right (plus **repair** for a tow destination) | repair alone |
| **production** (build, buy designs, berths) | own | **never** | never | — (no term grants it) | every basing right |

- **War** (`basingRightAt`): a host at war with its guest grants nothing, whatever terms are still on the books. 1f2da30 took the basing right before it asked about war, so a tow could be planned to an enemy's yard (pure R12/R29).
- **Ownership/control:** no basing right changes a system's holder, its stations' owners, licences, designs, stock or berths. This is checked in pure FOREIGN-BASE-SERVICES and R7/R8, and in-game CG-5 and CG-8.

## The captain at a foreign facility: `playerServiceAccess(service, system, { station, remote })`

The treaty half is `accessAt`. The facility half belongs to the engine. Checks run in this order:

1. **The facility exists and works:** not destroyed and not under construction. For repair, the station's *role* must repair (`getStationCapabilities().services.repair`); a world's own dock always repairs. When remote (a tow's destination), the system must have a working repair station (`systemRepairStation`).
2. **Own:** his own vendor or system gives `own`.
3. **War** with the holder: "Enemy yard: no service". The UI shows "Enemy yard: no service. Repair refused."
4. **A basing right for exactly this service** gives `treaty`, with the term id. A term that names stations (`t.stations`) covers those stations only.
5. Otherwise the vendor's own answer (`vendorRefusal`) applies. Under a host's basing terms that do not name this service, the refusal reads "*service* not authorized", and the UI shows "Docking permitted. Repair not authorized." when a docking right is held. A vendor that serves him anyway is `open`.

**Docking** is checked separately: `playerDockingBlock`. The checkpoint's clearance is waived by a docking right, and only by a docking right. `requireDocked(service)` checks docking first and then the service. `requireServiceConnection(service)` (the transporter channel) does the same, so a treaty-granted service still sits behind the checkpoint.

## Every access/service path, classified

| # | path | classification | notes |
|---|---|---|---|
| S1 | `accessAt` (model) | **canonical** | New. One record per polity, system and class. |
| S2 | `basingRightAt` | **canonical** | Now refuses at war. |
| S3 | `treatyBarred` / `treatyCrossing` (route and crossing) | **canonical** | Read *transit* only (`dmzRestrictsTransit`). On 1f2da30 a stationing-only DMZ barred transit (pure R3/R20, R14b). |
| S4 | `dmzDay` (presence) | **canonical** | Reads *stationing*. See DMZ-PRESENCE-STATE-MATRIX.md. |
| S5 | `playerServiceAccess` (captain: repair, resupply, docking) | **canonical** (engine side) | New. Replaces three ad-hoc checks. |
| S6 | `requireDocked(service)` (repair, refuel and market at the dock) | **adapted** | On 1f2da30 a repair right returned early and skipped the checkpoint, the vendor and war. In-game, 1f2da30 repaired him at an enemy yard (CG-6). |
| S7 | `requireServiceConnection(service)` (transporter channel) | **adapted** | Uses S5. A treaty basis still needs the docking clearance (CG-13). |
| S8 | `fleetServiceAllowed(npc, physical, service)` (fleet repair, sale, refit, equipment) | **adapted** | The service goes through S5 and the checkpoint through `playerDockingBlock`. Sales and refits name no service, so basing never opens them. |
| S9 | `tryDockAtPlanetIndex` / `tryDockAtStation` | **adapted** | Use `playerDockingBlock`, so a docking right is what lets him dock. |
| S10 | `towYardOk` (model tow destination) | **adapted** | War is checked first, then own yard, then a basing right for recovery *and* repair, then (for the captain) `world.playerYardServes`, which is S5 in remote mode. On 1f2da30 his tows went to any yard of a power not at war with him (CG-7, pure R12/R29). |
| S11 | `operationHome` (where an operation returns) | **adapted** | Includes systems where the polity holds a **staging** right (`accessAt.staging.base`). A transit right is never a home. |
| S12 | doctrine `patrolBaseRefusal` / `issuePatrolCycle` | **adapted** | A patrol's anchor must be its own world where its warships may stay. A patrol whose anchor is lost or banned ends (stat `patrolsEndedNoBase`), and dwell stops must allow staging (pure R28). On 1f2da30 the anchor was checked once and never again. |
| S13 | doctrine `treatyStandDown` | **adapted** | Stands a job down only where transit is barred. A stationing-only zone is left to the DMZ's grace, then a breach if the job keeps the ship there: a job is an order of its own (§7). |
| S14 | AI crew regain (`crewsAt`) | **adapted** | No crews at a world held by an enemy (pure CREW-AT-ENEMY-WORLD). On 1f2da30 crews were raised at any world with morale. |
| S15 | AI repair at a host yard under a repair right | **intentionally separate** / **deferred** | Repair capacity is the host's `stationEffects`. A guest's repair is counted against the host's yard without reserving it, so two guests (or host and guest) may both use one yard's full capacity. This is listed as new carry-forward. |
| S16 | shipyard sales, plans, licences, production berths, prize shelves | **intentionally separate** | Provenance rules unchanged. No basing purpose reaches them (CG-8). |
| S17 | `getSecurityDockingBlock(ownerSide)` | **intentionally separate** / note | Its `ownerSide` argument is unused. The block reads the current security zone. This is harmless here, because the docking right is checked around it, but it is listed. |
| S18 | `fleetStationServices().repair` | **adapted** | Now read through `stationRepairs`. On 1f2da30 it was unread, and repair was decided by station type name. |
| S19 | fleet trade route treaty checks | **deferred** | Traders do not consult DMZ or inspection terms (TRADER-RECORD-AUDIT). |

## Treaty combinations (brief §5), each distinct

| combination | transit | stay | docking | repair | check |
|---|---|---|---|---|---|
| DMZ + transit guarantee | ✔ | ✘, grace then breach | — | — | pure R1/R2, DMZ-TRANSIT-VS-STAGING; in-game CG-1/2/3 |
| DMZ (stationing only) + staging right | ✔ | ✔ staged | — | — | pure R3/R20; in-game CG-4 |
| transit guarantee without staging | ✔ | ✘ | — | — | pure R2 |
| docking without staging | ✔ | ✘ | ✔ | ✘ | pure R5; in-game CG-5, CG-11 |
| repair without docking | — | — | ✘ checkpoint | ✔ once docked | treaty gate BASING-REPAIR (repair-only refused past the closed Oce Nu checkpoint) |
| staging without production | — | ✔ | — | — | pure FOREIGN-BASE-SERVICES, R7/R8 |
| resupply without docking | — | — | ✘ checkpoint | — | in-game CG-13 |

**FOREIGN-BASE-SERVICES** (pure): docking, repair and staging are three terms. Ending them one at a time removes exactly that service. Ownership, control, licences, designs and production stay unchanged throughout.

## UI lines

- Fleet manager, the captain where he is (`captainAccessLine`):
  - "Transit permitted. Staging prohibited."
  - "Docking permitted. Repair not authorized."
  - "Docking permitted. Repair permitted."
  - "Enemy yard: no service. Repair refused."
- Fleet vessels (`fleetVesselTreatyLine`): "Staging permitted under treaty at Oce Nu", "DMZ — military stationing prohibited · Withdrawal required by day N", or "… · in breach since day N".
- Debug, the treaty section's "Access (each service on its own)" table, with columns: Party | System | Vessel | Class | Transit | Docking | Staging | Repair | Presence | Deadline | Breach | Term (in-game CG-11).
