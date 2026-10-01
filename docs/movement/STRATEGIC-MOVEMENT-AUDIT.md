# Strategic movement audit (after STRATEGIC-MOVEMENT-UNIFICATION)

This audit classifies every strategic movement path found in the PART 1 inventory
(`STRATEGIC-MOVEMENT-INVENTORY.md`, surveyed at `29710b1`). The last section lists the paths checked and
found not to be movement.

**Classifications:**

- **UNIFIED** — the path moves on the shared journey record (`src/strategic-journey.mjs`) and gets:
  - the chart's real leg lengths;
  - every intermediate system reached and processed once;
  - `resolveBlockadeRun` at every applicable blockade;
  - the reason for the movement re-checked at each system reached (its kind's `valid` hook: a war stamp,
    the owning record still live, the yard still held, the invasion still on). A movement home (`return`,
    `withdrawal`, `release`) has no authority that can lapse;
  - the vids kept, and mid-leg save/load.
- **INTENTIONALLY ABSTRACT** — not strategic travel, or deliberately not modelled as travel, for the
  reason given.
- **DEFERRED** — real strategic movement not yet on the shared path. The reason and the round that owns
  it are given.

**How the survey was done.** It searched every write of `systemIndex` on a campaign hull or group, and
every writer of `transit`, `travel` or `itinerary`:

- in `src/campaign-strategy.mjs` and `src/doctrine-campaign.mjs`;
- in the fleet, formation, trade, warp and scene paths of `src/main.js`.

The check was repeated on the candidate. Every hull `systemIndex` write left in the model is one of these:

- a crossing inside `crossJourneyLeg`;
- a pre-round save's one-time fallback (rows 10a and 11a);
- a capture in the loaded scene, which releases on the taken world only the force the scene actually
  held there (`reconcileLocalOutcome`). A hull disabled, surrendered or in warp on the way is not in the
  scene and is not moved;
- a disabled hull staying where a run disabled it;
- a pirate group's local position (row 23).

## Required call-outs

| path | classification | how / why |
|---|---|---|
| **Evacuation** (convoys, player and AI) | **UNIFIED** | Kind `evacuation`:<ul><li>one journey each way, on real legs;</li><li>it runs every blockade on the route at the system where it lies, and the origin's own blockade on departure;</li><li>it delivers only when it arrives at the destination;</li><li>forced back on the way out, it goes home empty; forced back on the way in, it falls back a system and retries;</li><li>a transport disabled or lost in warp stays where it last stood with its vid, and the convoy's lift drops.</li></ul> |
| **Doctrine patrol** (patrol, area patrol, exploration, delivery, construction, transport) | **UNIFIED** | Kind `doctrine`:<ul><li>one journey per itinerary segment, from the stop where the ship stands to the next stop with a stay;</li><li>milestones are due on the real schedule;</li><li>a replan while in warp starts from the end of the leg in flight.</li></ul> |
| **Doctrine defence** | **UNIFIED** | Same `doctrine` journeys. Presence at the defended world is read from where the ship actually stands (`standingAt`). |
| **Doctrine raids** | **UNIFIED** | The journey carries the objective's war stamp:<ul><li>at every system reached, a stamp that no longer holds stops it there, and it never sets out again under that stamp;</li><li>its strike still waits until it is on station, on the Phase 3 authority check.</li></ul>The baseline reproduction (pure test 9) is a raider reaching its target after a ceasefire. |
| **Doctrine rescue / investigation** | **UNIFIED** | Same journeys, and every blockade is run through the shared engine (pure 7; phase 2 P2-20; the in-game DDI blockade stage). Its capacity checks read real days — see §9 of the UNIFICATION doc for what that does to the doctrine's deadlines. |
| **Doctrine escort** | **UNIFIED** | Joined escorts sail in the charge's journey and run what it runs. A charge lost or disabled on the way stops the group where it happened. |
| **Campaign war operations** (AI planning, Dominion invasion and escalation, authored) | **UNIFIED** | Kind `operation`:<ul><li>one journey per system the force sets out from, stamped with `warAuthorityStamp`;</li><li>at each system reached, a lapsed war, a resolved operation or a changed holder turns the force for home;</li><li>it engages only with the force actually standing at the target;</li><li>forced back, it drops out of the operation and retreats.</li></ul> |
| **Dominion strategic movement** | **UNIFIED** | Each of these is its own journey:<ul><li>partner-corridor crossing — kind `expedition`, under pact authority;</li><li>reinforcement convoys — created at the staging system, then flown to the bridgehead;</li><li>expedition withdrawal — kind `withdrawal`, through the wormhole, leg by leg.</li></ul>The creation of recon, staging and expedition hulls is covered in row 18. |
| **Strategic traders** (the captain's circuits, passages, recall, rendezvous) | **UNIFIED** (timing, crossing, blockade, intel) | They already flew real legs with `routeLegDays`, ran blockades through the shared engine and observed each crossing. Their record is the trade record rather than the journey record: it predates this round and is interleaved with manifests and market state. Moving it onto the journey record is DEFERRED as pure refactoring, because no movement behaviour differs. |
| **Blockade fleets** (forming) | **UNIFIED** | Kind `blockade`:<ul><li>ships not on station fly there, and the blockade is `forming` until they arrive;</li><li>if the war lapses on the way, they turn for home at the next system.</li></ul>The captain's blockade ships are mirrored onto the same journey. |
| **Reinforcement movement** | **UNIFIED** | Blockade reinforcements join by journey: they count toward the blockade only once on station. Evacuation escorts join at the origin when the convoy is next home (as before). Dominion reinforcements: see above. |
| **Retreat / return** | **UNIFIED** | Every kind returns by the same record:<ul><li>operation survivors go home by kind `return` — one still in warp turns for home at the end of its leg;</li><li>a force turned back retreats with the next sequence number and the same history;</li><li>a doctrine job that ends in warp flies out its leg as kind `release`.</li></ul> |
| **Recovery movement** | yard runs **UNIFIED**; disabled-hull recovery **DEFERRED** | A damaged, uncommitted hull sails to the nearest yard as kind `repair`. A disabled hull still stays where it lies until real recovery acts; the towing/salvage round will make recovery movement real. The captain's own ships are never sent to a yard by the model. |
| **Authored event movement** | **UNIFIED** | Authored and doctrine-authored movement goes through `launchOperation` or `issueAssignment` (`runCampaignAuthored`), so it flies journeys. Debug overrides that place hulls directly remain labelled overrides. |

## Every inventory row

| # | path | classification | reason |
|---|---|---|---|
| 1 | player formations | **UNIFIED** | The canonical record, now built by `strategic-journey.mjs` (`createJourney`, `markCrossed`, `legLength`, `journeyEta`) instead of an inline copy. |
| 2 | player traders | **UNIFIED** (behaviour) / record-shape **DEFERRED** | See above. |
| 3 | doctrine patrol, exploration, delivery, construction, transport, area patrol | **UNIFIED** | kind `doctrine` |
| 4 | doctrine defence | **UNIFIED** | kind `doctrine` |
| 5 | doctrine raid | **UNIFIED** | kind `doctrine` + war stamp |
| 6 | doctrine investigation / rescue | **UNIFIED** | kind `doctrine` |
| 7 | doctrine escort | **UNIFIED** | in the charge's journey |
| 8 | doctrine return / surrender release / leave jurisdiction | **UNIFIED** | kind `doctrine` (plus `release` for a job ended in warp); leaving jurisdiction in warp starts from the end of the leg |
| 9 | evacuation convoy | **UNIFIED** | kind `evacuation` |
| 10 | campaign war operations | **UNIFIED** | kind `operation` |
| 10a | an operation saved before this round, mid-move | **INTENTIONALLY ABSTRACT** (save migration) | It keeps its old one-time arrival rule, so an old save does not restart or lose it. Every new operation flies journeys. |
| 11 | operation survivors going home | **UNIFIED** | kind `return` |
| 11a | survivors of a pre-round operation, or of the loaded scene's raid when captured | **INTENTIONALLY ABSTRACT** | A pre-round save keeps the old rule. A capture leaves the victors on the world they took, which is not movement. |
| 12 | damaged hull to a yard | **UNIFIED** | kind `repair`; a hull turned back waits before trying again |
| 13 | blockade force taking station | **UNIFIED** | kind `blockade` |
| 14 | blockade reinforcement | **UNIFIED** | kind `blockade` (joining) |
| 15 | Dominion partner-corridor crossing | **UNIFIED** | kind `expedition` |
| 16 | Dominion expedition withdrawal | **UNIFIED** | kind `withdrawal` |
| 17 | Dominion reinforcement convoys | **UNIFIED** | created at staging, then kind `expedition` to the bridgehead |
| 18 | Dominion recon, staging and expedition hulls created beyond the map | **INTENTIONALLY ABSTRACT** | Creation, not movement: the far side of the wormhole is the Dominion's own off-map production. The hulls then move by journey. |
| 19 | ambient raid launched from the loaded scene | **INTENTIONALLY ABSTRACT** | The scene itself is the raid (`opts.immediate`). Its hulls are already here or one route away, and the one hop is the scene's arrival. Survivors now fly home by a `return` journey, and the force selector skips hulls in warp. |
| 20 | operations materialised in a scene | **INTENTIONALLY ABSTRACT** | Tactical-scene ownership of a force that already arrived by journey; not strategic travel. |
| 21 | the captain's own warp (and ships escorting him) | **UNIFIED** (STRATEGIC-TACTICAL-HANDOFF §7) | The course is flown leg by leg, each leg its chart length (the same days as every other journey; the route map shows the same figure), and every system on the way is reached and checked. A blockade that catches him, an engaged hostile operation, or a pirate group at B stops him there. C is reached only after he resumes the remaining legs, once. *Was: DEFERRED; one leg over the whole route.* |
| 22 | legacy single-ship `f.transit` fallback | **INTENTIONALLY ABSTRACT** (save migration) | Only a pre-formation save or an orphaned record reaches it. |
| 23 | pirate group following its prey | **UNIFIED** (STRATEGIC-TACTICAL-HANDOFF §8) | Where the captain is, a predation contact is an encounter: the same group vessel (its vid) makes the demand or the attack in the scene, and the result updates the same group and objective. Elsewhere it stays bounded to its haven and neighbours, as before. *Was: DEFERRED.* |
| 24 | stranded hulk recovery | **DEFERRED** → towing/salvage | Recovery in place, at the hulk's own yard world. Real recovery movement (towing) is the towing/salvage round. |
| 25 | production, garrison replacement, capture transfer | **INTENTIONALLY ABSTRACT** (not movement) | Creation or a change of hands in place. The pure test 24 checks that none of them makes a journey or moves a hull. |

## Checked and found not to be strategic movement

- **Tactical-scene NPC motion:** `state.npcShips`, `spawnFleetAttack`, the local security, enforcement
  and predation scenes, and the captain's escorts in the scene. These are the scene's own physics. Scene
  persistence is deferred.
- **Debug overrides that place hulls:** the gate fixtures and `campaign phase …`. They are labelled
  overrides. `campaign phase dormant` now also sets the Dominion's ships under way down where they last
  stood (`haltJourneysOf`) instead of leaving them flying under no order.
- **`campaign legs N`:** a new debug override, never saved, that makes every leg N days. The doctrine
  phase gates use it because their scenarios are authored one hop at a time.

## After STRATEGIC-TIME-SCALE-CORRECTION

No row is reclassified. Every UNIFIED path still moves on the shared journey record at real leg lengths.
What changed is the planning that feeds those journeys, which now reads the same real days
(`docs/movement/STRATEGIC-TIME-SCALE-CORRECTION.md` §1 lists every one-hop-era assumption found and what
became of it). Travel stays ship-independent.

| row | what the planner now reads |
|---|---|
| 3, 4 (doctrine patrol and defence) | Patrol legs are at most 15 days, with time on station in proportion to the leg. Defence reach is 20 days by ETA, with a deadline from arrival. There is no replacement while a patrol is in warp. |
| 5 (raids) | The deadline is counted from the arrival milestone. |
| 6 (rescue / investigation) | Reach and deadline come from `vesselEta` (the route the assignment flies). Rescue is bounded by survivor endurance, and investigation by travel + on station + slack. |
| 7 (escort) | The escort's ETA is set against the charge's real arrival at each stop. |
| 9 (evacuation) | Refuge by real days and safety; target by the trips possible before the threat arrives; retry after 1 day; a loaded convoy in flight lands its people after the origin falls. |
| 10, 11 (operations, returns) | Target by ETA and the defence on arrival (`forceAccount`: standing / incoming / later, no double counting). Home is the nearest by real days, from the end of the leg in flight. |
| 12 (repair) | Yard is the nearest by real days. |
| 15, 17 (Dominion corridor and reinforcements) | Count toward the expedition only on arrival. Escalation targets are ordered by ETA. |

## After STRATEGIC-TACTICAL-HANDOFF

Rows 21 (the captain's warp) and 23 (the pirate group's local follow) are unified; the rules are in
STRATEGIC-TACTICAL-HANDOFF.md. The strategic interception → tactical combat handoff is done.

## After SHIP-DEPENDENT-STRATEGIC-SPEED

No row is reclassified. Each UNIFIED row now flies at the speed of the ships flying it: a group at its
slowest member able to travel; wormhole-only edges keep fixed days. Each planner reads that same speed.
The per-consumer classification is `docs/movement/STRATEGIC-SPEED-AUDIT.md`, and the rules are
`SHIP-DEPENDENT-STRATEGIC-SPEED.md`. The "travel stays ship-independent" note above holds only up to
f0e219b.

## Still deferred

- **This audit:**
  - stranded recovery movement (row 24);
  - moving the trade record onto the journey record (row 2).
- **The standing list:**
  - towing/salvage;
  - trader record-shape consolidation;
  - treaty expansion;
  - NPC tactical-scene persistence;
  - autonomous war declarations;
  - doctrine invasion/occupation;
  - broad covert doctrine;
  - Hirogen hunting;
  - Borg assimilation;
  - Gorn activation;
  - Tactical Cube;
  - damage-based strategic speed penalties (no reliable engine-condition state; SHIP-DEPENDENT-STRATEGIC-SPEED §4).
