# Towing, salvage and stranded-hull recovery — audit of a7e56d2

Audited tree: **a7e56d2** (ship-dependent strategic speed, rated). The towing system it carries was built
in d5b50b5 (TOWING-SALVAGE-RECOVERY.md), before the treaty round (db11c10, 7d3ce43) and the rated speed
round (effdc9d, a7e56d2). Its own suites are green at a7e56d2 (`test:towing` 29/29, `test:towing:ingame`
4/4). Green gates were not taken as acceptance: every path below was read and checked against the model
the brief sets out:

    crew state  ≠  hull recovery  ≠  hull repair  ≠  recommissioning

**Verdict.** There is one recovery system, not several. The mission record, the shared journey kind
`recovery`, the shared blockade and handoff engines, the claim rules and the derelict lifecycle are sound and
are kept. The corrections are to that system, not a second one. The audit found:
- **one parallel path**, the captain's personal-ship emergency recovery (A1). By Rafael's decision of
  03 Oct it is kept as an **INTENTIONAL PLAYER-ONLY EMERGENCY RECOVERY EXCEPTION**, fenced and tested, not
  corrected;
- **seven defects** in the existing system (A2–A5; A10 found while testing treaty integration; A11 and A12
  found by the long-run measurement);
- **four gaps** against the brief's lifecycle and UI (A6–A9).

Classification: **ACCEPTABLE** (kept as is), **NEEDS CORRECTION** (fixed this round), **DEFERRED** (named,
not done).

## 1. Every recovery-related path in the tree

| # | path | where | what it does | class |
|---|---|---|---|---|
| P1 | `advanceStranded` / `strandHull` | campaign-strategy.mjs | Finds stranded hulls: every AI hull in the disabled band gets `stranded` (crew clock, `awaiting_recovery`), stays where it is, never available. Own yard here (or a basing yard): `recovering` → `in_yard` after 2 days. Crewless and unclaimed 90 days: written off, the wreck becomes a derelict. | ACCEPTABLE |
| P2 | `recoverStrandedHull` | campaign-strategy.mjs, debug `campaign recover` | Puts a hulk in a yard **only where it lies** and only if that system has a usable yard. Never moves it. Debug only. | ACCEPTABLE |
| P3 | `rescueStrandedCrew` | campaign-strategy.mjs; doctrine relief rescue (doctrine-campaign.mjs §rescue) | Takes the crew off; the hull stays exactly where and as it is. | ACCEPTABLE |
| P4 | `planHullRecovery` / `requestHullRecovery` | campaign-strategy.mjs | The one planner and the one mission record (`book.hullRecoveries`, id `<seed>:tow:<n>`). | ACCEPTABLE (with A3–A6) |
| P5 | outbound tug journey (`startOutbound`, kind `recovery`, leg `outbound`) | campaign-strategy.mjs | The tug and escorts fly the shared journey, leg by leg, at the group's rated speed. | ACCEPTABLE |
| P6 | `onRecoveryScene` | campaign-strategy.mjs | On arrival only: hulk still there, still disabled, claim still holds, tug operational and able. Salvage changes hands here. | ACCEPTABLE (with A2) |
| P7 | `startTow` (leg `inbound`, `tr.tow`) | campaign-strategy.mjs | The tow: the hulk is a member of the same journey, carried, never detached as "disabled". | ACCEPTABLE (with A3) |
| P8 | `dropUntowed` / `onTowDropped` / `dropTowedHulk` | campaign-strategy.mjs | Tug lost, disabled, surrendered: the hulk is let go where the group last stood; the mission fails; a new one may be sent. | ACCEPTABLE |
| P9 | `deliverHulk` | campaign-strategy.mjs | At the yard: the yard's ordinary recovery and repair take over. Nothing is repaired on arrival. | ACCEPTABLE (with A6) |
| P10 | `advanceHullRecoveries` | campaign-strategy.mjs | Daily retries for a held mission, the watchdog, derelicts breaking up, history pruning, the AI decision. | ACCEPTABLE |
| P11 | `planAiRecoveries` | campaign-strategy.mjs | The AI selector: every 5 days, a ready tug (never a world's last garrison), the most worthwhile own hulk, then salvage at a higher bar. Never builds or spawns a tug. | ACCEPTABLE |
| P12 | `playerRecoveryOptions` / `requestPlayerRecovery` | main.js | The captain's selector for a disabled **fleet vessel**: every free ship of his (`fleetShipFreeForOperation`), the same planner. | ACCEPTABLE (with A5, A7) |
| P13 | `playerSalvageCandidates` / `requestPlayerSalvage` | main.js | Hulks where the captain or a ship of his is: claim verdict, and a free ship of his able to tow it. | ACCEPTABLE |
| P14 | `adoptSalvagedToPlayer` / `adoptSalvagedHull` | main.js / campaign-strategy.mjs | The salvaged AI hulk joins the captain's books as the same identity, then the tow sets out. | ACCEPTABLE (with A2) |
| P15 | **`recoverDisabledPlayer` / `getRecoveryStatus`** (Fleet & Shipyard "Emergency recovery"; the in-scene "Ship disabled" panel) | main.js | **The captain's personal vessel: hull restored in place to just above the disabled band, operational 5 seconds later, billed as rescue debt.** | **INTENTIONAL PLAYER-ONLY EMERGENCY RECOVERY EXCEPTION (A1)** |
| P16 | `repairFleetVessel` (fleet and personal) | main.js | Paid repair, docked at a yard (or under a basing right for `repair`). A real repair source. | ACCEPTABLE |
| P17 | `tickDisabledVessel` / `recoveryAt` (NPC and fleet actors) | main.js | Operational again only after a paid repair took the hull to ≥ 20% (P16) or after P15. No self-repair of its own. | ACCEPTABLE |
| P18 | `transferFleetCommand` | main.js | The captain moves into another ship of his; his disabled former ship becomes a fleet vessel where it lies, the same identity, recoverable by P12. | ACCEPTABLE |
| P19 | `book.recoveries` / `completeRecovery` / `startDesignRecovery` | campaign-strategy.mjs, main.js | **Design** recovery (a lost sole-vendor design's archive): same word, unrelated to hulls. Moves nothing. | ACCEPTABLE (name only) |
| P20 | AI `repair` journeys (`advanceRepairs`) | campaign-strategy.mjs | A damaged but **operational** hull sails itself to a yard. A disabled hull never does (`hullIsDisabled` → skipped unless `in_yard`). | ACCEPTABLE |
| P21 | boarding capture of a disabled NPC (prize) | main.js | Capture, not salvage: the persistent-hull prize path. Unchanged. | ACCEPTABLE |

No other function moves, repairs or re-owns a disabled hull. No path teleports a hulk to a yard (P2 works
only where it lies). No path repairs a hulk before it is in a yard (P1/P20: `in_yard` only; the captain's
fleet vessels: docked repair only). The one exception is P15, for the vessel the captain is aboard (A1).

## 2. The questions the brief asks

| question | finding | class |
|---|---|---|
| current towing/recovery functions | P1–P21 above | — |
| selectors that can assign a recovery ship | AI: `planAiRecoveries` (ready, recovery-capable, not a world's last garrison `recoveryGarrisonFloor`, value, ≤ 70 days, safe route). Captain: `playerRecoveryOptions` / `playerSalvageSection` (`fleetShipFreeForOperation`: stationed, not escorting, trading, held or in the scene). Both end in `planHullRecovery`. The captain's personal vessel uses none: P15 is the exception. | ACCEPTABLE / A1 |
| how stranded hulls are found | AI: `advanceStranded` (the disabled band → `stranded`). Captain's fleet: `fleetVesselCondition === 'disabled'` (mirror `engineDisabled`). Derelicts: `book.derelicts`. | ACCEPTABLE |
| how towing movement works / uses the shared journey | Two shared journeys of kind `recovery` (outbound, inbound). The hulk is a journey member with `tr.tow`; leg days from `journeySpeed`. | ACCEPTABLE |
| tow speed | `clamp(min(towing group, casualty class speed) × 0.7, 0.4, 1.0)`. **The casualty's own rated speed limits the tow although its drive is dead.** | NEEDS CORRECTION (A3) |
| blockades | Same engine (`runJourneyBlockades` → `resolveBlockadeRun`). The runner dashes at the tow speed; a towed hulk adds `towSignature` 0.2 and its mass to the signature, spoils any cloak (`cloakAll && !towed.length`), takes an unarmed share of damage; escorts add deterrence and cover. | ACCEPTABLE |
| recovery vessel disabled / destroyed | At a crossing: the tug detaches there; with no capable towing member left, `dropUntowed` lets the hulk go **at that system**; the disabled tug is stranded there in its own right (P1). In warp: both at the leg's start (the model has no position between systems). Destroyed: the hulk is let go, not destroyed. | ACCEPTABLE |
| casualty with crew aboard | The crew stay aboard; the life-support clock stops at attachment (`crewSupportedBy`) and resumes with what was left if the tow is lost or the yard is lost before repair. | ACCEPTABLE |
| crew already rescued | Towed in empty; repaired, it enters `recrew` (repaired-awaiting-crew) until `minOperatingCrew`. | ACCEPTABLE |
| crew died before recovery | The hull stays; written off only by the 90-day rule, and never while a claim is live. | ACCEPTABLE |
| foreign / enemy / abandoned hulls | `claimVerdict`: own → recovery; at war and crewless, not protected or guarded → salvage; not at war and not abandoned → refused; a derelict → salvage by anyone; the captain's vessels are never salvage. | ACCEPTABLE |
| does salvage change ownership | Yes, explicitly, on attachment: the same record moves (AI) or the same identity is adopted (captain), with a `salvaged` provenance entry, `salvagedFrom` / `takenFrom`, and the old owner counts it lost. **To the captain the hull figure is lost (A2).** | ACCEPTABLE (with A2) |
| any hull teleported to a yard | No. The personal vessel is restored where it lies (A1, the exception); it is not moved. | ACCEPTABLE / A1 |
| repairs before reaching a yard | None in the recovery system. P15 is one, for the personal vessel only (the exception). | ACCEPTABLE / A1 |
| does towing preserve vid | Yes. The same record and `vids` map; the captain's salvage adopts the same identity. | ACCEPTABLE |
| save/load | Everything is on the book and the journey records; a reload restores leg, ETA, tow speed and route. | ACCEPTABLE |
| doctrine recovery | Doctrine has **no hull recovery**: its relief `rescue` takes crews off (P3) and moves no hull. The AI's hull recovery is P11, in the same system as the captain's. | ACCEPTABLE |
| the captain's REQUEST RECOVERY | Two buttons shared that label. Per fleet vessel: P12, the shared system ("Request recovery"). For the personal vessel: P15, outside it, now labelled **Emergency recovery**. | ACCEPTABLE / A1 |
| treaty movement | Kind `recovery` is its own traffic class (`recovery`): DMZs bind it, a transit guarantee can name it, and tows are plotted without fixed traversals. Basing purpose `recovery` admits a host yard as a destination. **It does not check that the host's yard may repair it (A4).** | ACCEPTABLE (with A4) |

## 3. Findings

### A1 — the personal vessel's emergency recovery: INTENTIONAL PLAYER-ONLY EMERGENCY RECOVERY EXCEPTION

`recoverDisabledPlayer` (main.js) charges the repair quote as rescue debt, sets `state.hull` to just above
the disabled band where the ship lies, and makes her operational 5 seconds later (`state.recoveryAt`). No
vessel comes, nothing moves, and no yard is involved. It is reached from:
- Fleet & Shipyard's top-level button (next to Repair personal hull);
- the in-scene **Ship disabled** panel.

It is outside the recovery system. The campaign calendar advances only when the captain warps, so a captain
whose own ship is disabled could not let days pass while a tug came, and a captain with no fleet would have
no way out.

**Decision (Rafael, 03 Oct): keep it, as an explicit gameplay exception.**
- It applies only to the captain's currently controlled personal vessel. It takes no vessel id and reads
  only the personal vessel's condition (`fleetBook().personalCondition`).
- After 5 seconds it restores her enough to continue, and keeps the same personal vid.
- It records the rescue debt, as before.
- It is not strategic towing: it creates no recovery record, no journey and no yard visit.
- It does not change the disabled-hull rules for anything else. Fleet vessels, AI hulls, doctrine vessels,
  abandoned hulls and prizes still use the real shared recovery, towing and yard system.
- The visible labels are now **Emergency recovery** (fleet manager) and **Emergency recovery** (Ship disabled
  panel), so it is not confused with a fleet vessel's **Request recovery**. Internal action names are
  unchanged.
- No stationary campaign-time wait is added this round.

Preservation tests (in-game, `test:towing:audit:ingame` EMERGENCY-RECOVERY-EXCEPTION):
- the personal ship still recovers after 5 seconds, with the same personal vid and the rescue debt;
- no recovery record or journey is created;
- a disabled fleet vessel, an NPC hull and a doctrine vessel cannot use it;
- with a disabled fleet vessel selected, it repairs only the personal vessel.

### A2 — a hull salvaged to the captain arrives with 1 hull point (NEEDS CORRECTION)

`onRecoveryScene` calls `transferHullOut`, which sets the AI record's `hull = 0` (it leaves those books).
The `hullSalvagedToPlayer` effect is built *after* that and reads `h.hull`, so it carries 0.
`adoptSalvagedToPlayer` then sets the adopted vessel to `max(1, 0)`.
- Reproduction: the Klingon hulk at 5% (49/990) becomes the captain's at 1/990.
- A derelict is not affected (`transferHullOut` skips lost records).
- Brief §13 ("actual damage") fails for the captain's salvage. Reproduced in game (SALVAGE-PRIZE-HULL: 1/2804 against 0.050 as she lay on a7e56d2); the pure R23/R24 uses an AI salvager, which was already right.

### A3 — the tow is limited by the casualty's own warp rating (NEEDS CORRECTION)

`towSpeed = clamp(min(group, casualty) × 0.7, 0.4, 1.0)`. A disabled casualty has no drive, so its rating
should not set the pace. On a7e56d2:
- a Tug Class II (4/10, 0.92×) towing a Bajoran Solar Sailor (1/10, 0.70×) flies at 0.49× instead of the
  tug's 0.92 × 0.7 = 0.64×: an 11-day leg is 23 days instead of 18;
- the planner and the journey agree with each other (both use the same formula), so the ETA matches, but on
  the wrong rule.

The brief's rule replaces it: `tow multiplier = towing group multiplier × 0.70`, floor 0.40, never above
1.0. The towing group is its slowest able towing member, escorts included.

### A4 — a basing yard without a repair right is a tow destination where nothing is ever repaired (NEEDS CORRECTION)

`towYardOk` and `recoveryYardAt` accept a host yard under a basing right for `recovery`. `advanceRepairs`
spends host capacity only under a right for `repair`.
- A hulk delivered under `recovery` alone sits `in_yard` and is never repaired.
- Brief §15: basing rights decide whether a foreign yard can **accept and repair** it.

### A5 — a recovery with no vessel free is refused, not kept (NEEDS CORRECTION)

`requestPlayerRecovery` / `requestHullRecovery` refuse outright when no ship can tow ("No ship of yours can
tow her."), and no record persists. Brief §3: a request with no suitable recovery ship waits ("awaiting
recovery vessel") and is matched when one is free. It must never spawn one.

### A10 — a transit guarantee scoped to recovery traffic covers no recovery traffic (NEEDS CORRECTION)

Found while testing treaty integration (brief §15). `TRAFFIC` admits `recovery` as a guarantee's traffic
scope, but `transitCovers` and `guaranteeBinds` map a recovery mover to `military` before looking.
- A guarantee naming `['recovery']` therefore never lifts a DMZ for a tug or a tow, and never binds its
  grantor to it.
- Only a `military` guarantee did.
- Reproduction (pure TA-28): a DMZ with recovery traffic prohibited on Vega, and a Terran tow Minor → Earth
  (only route through Vega). With a Klingon guarantee to the Terrans for recovery traffic at Vega, the tow is
  still refused on a7e56d2.

### A11 — a casualty in tow, in warp, could be finished off at the system she had left (NEEDS CORRECTION)

Found by the long-run measurement (the "tow surviving after the casualty was destroyed" watch item).
`applyDefenderLosses` deals an assault's defender losses to the defenders and to every disabled hull lying
at the system. "Lying" was read from `systemIndex` alone. A hulk under tow keeps the `systemIndex` of the
leg's start while she is in warp, so an assault on the system the tow had just left could damage or destroy
her there.
- Reproduction (pure A11): a Saber in tow leaving Minor; a Klingon assault engages Minor's defenders on day
  12. On a7e56d2 her hull falls from 10 to 2.9 while she is in warp.
- In the 400-day run, a Klingon salvage tow leaving Iritum lost its casualty this way (Terran assault on
  Iritum).
- Fix: a hulk with `transit` is not at the system (`!h.transit`), as `defendsHere` already rules for
  operational ships.

### A12 — a casualty gone from the books in mid-leg did not end the tow (NEEDS CORRECTION)

When a towed hulk is lost while the leg is flown (A11, or any loss that takes her off the books),
`crossJourneyLeg` finds no record (`hullOf` skips lost hulls) and only detaches the id. The tow's `onDetach`
is not called and `tr.tow.targets` still names her. The mission stays `towing` and the tug flies on, at tow
speed, to the yard with nothing in tow, failing only on arrival.
- Reproduction (pure A12): on a7e56d2 the mission is still `towing` after the first crossing (day 15), with
  the yard due day 50.
- In the long run on a7e56d2: 33 open-tow days with no casualty.
- Fix: a towed target missing at a crossing is taken out of `tr.tow`, and the mission fails there ("the hulk
  was destroyed under tow"). The tug is released at the next boundary.

### A6 — the record stops at the yard gate (NEEDS CORRECTION)

The mission closes at `delivered_to_yard`. What follows (in yard, repairing, awaiting crew,
recommissioned, or lost) is on the hull, not on the recovery. There is no single phase in the brief's terms
(requested → asset en route → on scene → tow attached → towing → in yard → repairing → recrew → complete),
and no termination record after delivery.

### A7 — captain lines (NEEDS CORRECTION)

The current lines are "Recovery possible — X · tug arrives in N days · Y day D" and "Recovery assigned — X ·
tug arrives day D". The brief wants a concise request line (vessel, ETA, tow to), "No recovery vessel
available.", and "Tug towing Casualty → Yard · arrives day N".

### A8 — debug view (NEEDS CORRECTION, small)

The view has vid, class, owner/origin, system, crew, state, tug, capacity, route and leg, tow speed, yard,
claim and result. It is missing:
- the phase;
- the ETA;
- the tow rule and penalty;
- the current blocker;
- the waiting-for-asset requests.

### A9 — the captain's foreign yard is not checked for service (DEFERRED)

For the captain, `towYardOk` accepts any repair-capable yard whose holder is not at war with him. His repair
there is the ordinary paid docked service, which a vendor refusal or a docking block can deny. The model
cannot see those engine-side refusals from the book. A captain's vessel delivered to such a yard can be sent
on again (a new recovery from there is allowed), so nothing is lost or duplicated. This is deferred, not
fixed.

## 4. Deferred, as found

- **Multi-tug tows** of the heaviest hulls: one tug per hulk, capacity ≥ mass.
- **A towed hulk is not drawn in the tactical scene** (`spawn: false`); its strategic record stands.
- **Allied recovery:** there is no alliance relation in the model.
- **AI hulls carry no per-hull equipment or cargo.** Salvage keeps what the record has (class, damage,
  identity, history, crew state). The captain's adopted prize gets his engine's class loadout snapshot.
- **The captain's vessels have no crew clock.** Their crew are "aboard"; they are never written off or
  salvaged by the AI.
- **Taking another polity's hull without permission is refused, not an incident:** not at war and not
  abandoned → refused.
- **A9** (above).

## 5. A1 decided

Asked on 03 Oct; Rafael chose to keep the personal emergency recovery as a fenced exception (§3 A1). The
fleet, AI, doctrine, derelict and prize paths are all in the shared system and are corrected there (A2–A8).
