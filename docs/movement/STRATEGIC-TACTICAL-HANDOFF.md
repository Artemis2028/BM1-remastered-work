# Strategic ↔ tactical encounter handoff

Stacked on `c07826b` (STRATEGIC-TIME-SCALE-CORRECTION). This round closes three carry-forward items:

- strategic interception → tactical combat handoff;
- the captain's warp → intermediate-system tactical handoff;
- the pirate group's local follow → tactical handoff.

**The rule.** A contact the strategic layer decided is one encounter, not two.

- **Where the captain is not**, the contact is resolved strategically, exactly as on `c07826b`.
- **Where the captain is**, it is handed to the loaded tactical scene. From that moment one persistent
  record owns its resolution:
  - no strategic damage, strike, run or capture happens in parallel;
  - the scene is fought with the same vessels (the same vids and hull records);
  - what happened in the scene is written back onto those records, once.

Nothing here reopens:

- real leg travel;
- ETA planning;
- doctrine Phases 1–4;
- the disabled/recrew model;
- the blockade-running rules;
- vessel identity;
- formal-war authority;
- surrender/compliance.

## 1. What is handed off (eligibility)

| family | strategic contact | handed to the scene when | otherwise |
|---|---|---|---|
| blockade interception (AI runner) | a journey's crossing of a blockaded system, detected **and** caught by the blockade's own seeded draws (`blockadeContact`) | the captain's loaded system is that crossing's system | `resolveBlockadeRun` as before |
| blockade interception (the captain) | the captain's own course crossing a blockaded system, caught by the same draws | always (he is there) | seen-but-let-past or never seen: the strategic run is recorded, with no damage |
| doctrine defence / strategic war op | an operation engaging its target (`advanceOperations`, the engaged branch) | the captain is at the target | `resolveOffscreenDay` |
| doctrine raid | a raid's strike day (`advanceRaids`) | the captain is at the target | `raidStrikeDay` |
| pirate predation (NPC prey) | the strike of an escalated demand (`workPredation`) | the captain is where the group is | `predationStrike` |
| pirate predation (the captain) | the captain's course reaching the waters of a lurking group (`pirateGroupFor`: haven + unclaimed neighbours; not paid off; no cooldown) | always (he is there) | — |
| enforcement escalated to combat | an enforcement strike (`enforcementEngage`) | the captain is at the target's system | `enforcementStrike` |
| captain crossing an intermediate system | any of the above at B on A→B→C (a blockade that catches him, an engaged hostile operation, a pirate group) | he stops at B | the course goes on |

Distant battles are never forced into the scene. **Present** means `world.localSystem`, which is null in
warp. The 29th pure regression runs a long campaign with the captain absent everywhere: no encounter is
opened and nothing is suppressed.

## 2. The encounter record (`src/strategic-encounter.mjs`)

```
{ id, key, system, type: blockade | operation | raid | predation | enforcement,
  createdDay, activatedDay, resolvedDay, status, captain, playerHostile,
  participants[{ ref, hullId, vid, polity, side, role, shipId, name, spawn, engineOwned,
                 pirateGroupId, faction, cloak, cargo, before{hull,maxHull,crew,status,systemIndex},
                 after{hull,crew,maxHull}, fate }],
  sides{a,b}, objective{kind, ref[, group]}, authority, journeys[], contact{…},
  spawned[], result, continuation, fallback{used, reason, day[, run]}, history[], suppressed }
```

- **The key names the contact itself.** Examples:
  - `blockade:<blockade>:<runner>:<day>`;
  - `op:<op>:h<n>`;
  - `raid:<objective>:<day>:h<n>`;
  - `predation:<objective>:<day>:h<n>`.

  A second open for the same contact returns the record already there, whatever its status. It is
  counted in `duplicatesPrevented`, so no contact is handed off or resolved twice.
- **Participant hulls.** While the encounter is live, every participating hull carries `encounterId`.
  `hullUnavailable` (via `hullInEncounter`) keeps it out of every strategic selection: ops, patrols,
  escorts, blockade forces and doctrine assignments.
- **Kept in the campaign book.** The record rides in the campaign book, so it saves and loads with the
  campaign. The newest 80 are kept, and live records are never pruned.
- **Families.** Each family registers its own resolve / fallback / abort (`registerEncounterFamily`):
  - blockade and operation: `campaign-strategy.mjs`;
  - raid, predation and enforcement: `doctrine-campaign.mjs`.

  The encounter module reads no world.

### Lifecycle matrix

| from → to | trigger | what happens to the strategic objects |
|---|---|---|
| (none) → **pending** | the family's contact where the captain is | hulls marked; the objective owned (op `resolvedBy='local'`, journey `held`, raid/predation/enforcement guarded) |
| pending → **tactical_active** | the engine spawned the scene (`activateEncounter`, with the spawned vids) | same vessels in the scene: `campaignHullId`/`pirateGroupId`, vid, hull share, side |
| tactical_active → **resolved** | the scene's decision (`encounterDecision`) or the fleet attack ending (`reconcileLocalOutcome`) | fates written to the same records; the family continues (journey resumes, op finishes, raid strikes/closes, demand closes) |
| tactical_active → **resolved (disengaged)** | the captain leaves mid-fight — decided at **departure** · (safety net) an active encounter found with the captain known to be in another system | what the scene did is written (nothing is inferred from a scene that holds none of its ships); the rest goes back to the strategic layer from that state |
| pending → **fallback** | no scene could be made (no ship could be placed, one side only, the test switch) · the captain left before the scene took it up · (safety net) a pending handoff found with the captain not in its system | the family's strategic resolver runs **once** for this contact, on its own key/day; the objective may be handed off again on a later day |
| pending → **aborted** | the contact vanished before it was fought (a ceasefire before contact, the runner gone) | nothing resolved either way; op stands down; `staleSuppressed` |
| resolved / fallback / aborted | — | final; `resolveEncounter` / `fallbackEncounter` on a final record return `{ ok:false }` |

### The explicit guard (PART 3)

Every strategic resolver that could touch a handed-off contact looks for its live encounter first.
- **If one exists** it does nothing and counts `abstractSuppressed`:
  - `advanceOperations` (engaged branch);
  - `advanceRaids`;
  - `workPredation`;
  - the enforcement loop;
  - `stepJourney` (held crossing).
- **Damage appliers** skip encounter hulls: `applyLosses`, `applyDefenderLosses`, the `damageBlockade`
  order and the blockade's daily attrition `weakest()`.
- **A held crossing** is never re-run. When the crossing is released it is settled once
  (`releaseHeldCrossing` → `settleCrossing`), and `stepJourney` breaks on `cross.held`.

## 3. Spawning the actual vessels (PART 4)

`spawnEncounterParticipant` builds each scene ship from its own record:

- class (`shipId`) and name (the faction hull identity);
- hull share (`combatHull = maxCombatHull × hull/maxHull`);
- side, `campaignHullId` / `pirateGroupId` and vid.

It refuses a lost, disabled or surrendered hull. A pirate group flies a hull chosen once from the
independent traffic and kept on the group record (pirates have no yard); every scene shows the same
vessel.

**Operations.**
- The existing wave spawner (`spawnCampaignOperation`) is kept.
- Its ships now carry the encounter's id and side.
- The world's actual defenders from the encounter appear with the first wave, as real ships. No abstract
  defender strength is added beside them.
- A disabled attacker is no longer counted as fighting (`updateFleetAttacks`).

**The captain's ship and escorts** are the engine's. They are recorded (`engineOwned`) and not spawned.

- **Shields** are set per scene from the class (`ensureNpcCombatStats`), because strategic hulls carry no
  shield state.
- **Crew** aboard follows the record's crew share where the scene models a crew.
- **Cloak.** A participant that cannot cloak spawns unable to.
- **Cargo** is recorded on the participant. The scene does not model NPC holds.
- **Already out.** A hull already disabled, surrendered or lost is never spawned (it is not a
  participant).

## 4. Strategic → tactical → strategic mapping (PART 5)

| scene fate | written back to the same record | strategic continuation |
|---|---|---|
| survived / damaged | `hull` = what it had left in the scene | goes on (journey, blockade force, op, raid) |
| **destroyed** | `loseHull` → `status 'lost'`, `fate 'destroyed_in_action'`; the vid is retired | a blockader destroyed reduces `b.hulls` and coverage; attackers and defenders are counted in `op.losses` / `defenderLosses`; a pirate group destroyed is `status 'lost'` with hull 0 |
| **disabled** | hull capped at the disable line, `systemIndex` = the encounter system, `strandHull` (awaiting recovery), status repairing; **no auto-repair** | stays in that system; unselectable (test 27) |
| **surrendered** | the Phase 4 `surrenderVessel` hook | unselectable; prize rules as Phase 4 |
| escaped | hull written; it goes on | raid → withdrawing; a runner goes on |

| family | scene result | strategic result |
|---|---|---|
| blockade (captain) | interceptors out → `passed` or `broken` (all beaten); captain hull < 35% or disabled → `forced_back`; 60 s held → `passed`; captain leaves → `escaped` | run `fought_through` / `blockade_broken` / `intercepted_forced_back` on the blockade record; losses; coverage refreshed or the blockade ends; `sightings.player` = what he fought (`tactical: true`); passed → `warpResume.ready`; forced back → retreat warp to the previous system, the course dropped |
| blockade (AI runner) | runners out → `forced_back`; blockaders out → `passed`/`broken`; time up → runners ≥ 50% hull → `passed`, else `forced_back` | the held journey is released once: it goes on, or turns back |
| operation | attackers wiped → `destroyed`; defenders gone for the capture delay → `captured` (only while the war still authorises it, else `withdrew`); captain leaves → `disengaged` | `finishOperation(…,'local')`, survivors fly home by journey; a capture records the change of hands; disengaged → offscreen from the scene's state |
| raid | raider out → `repelled`/`withdrew`; defenders out or time up → `struck` | a strike day counted (the raid stays finite: `raidStrikeDays`), `witnessAttack`; raider destroyed/disabled/surrendered/escaped closes the raid |
| predation (captain) | the demand's own state machine: pay / cargo → `paid`; run and out of reach → `escaped`; refuse or run → the same pirate vessel attacks; destroyed → group lost | objective closed now: `cargo_received` / `target_escaped` / `target_destroyed` / `attacker_disengaged`; loot to the group; cooldown on the captain |
| predation (NPC prey) | either side out or time up → `fought` | the same group and target updated; closed |
| enforcement | either side out or time up → `fought` | goes on from the written state (a disabled or surrendered target closes it the next day) |

## 5. Blockade (PART 6)

The strategic layer decides the contact with the same seeded detect and catch draws a strategic run
would use. The scene decides the fight, and no strategic damage is applied to either side. The tactical
run goes on the blockade's own record as one run, carrying `tactical` and `encounterId`:

- passed or forced back;
- losses;
- the blockade weakened, or broken when its force is gone;
- disabled blockaders released and stranded.

A player-absent crossing is unchanged. A crossing the scene could not take up falls back to
`resolveBlockadeRun` once, on the contact's original day.

## 6. War op / raid / defence (PART 7)

- **The war stamp.** The authorisation that stood at contact is preserved (`authority.warKey`).
- **Ceasefire before contact.** `maybeMaterializeCampaignOperation` checks `operationIsAuthorised` before
  spawning. If the war is gone, the encounter is aborted (`staleSuppressed`), nobody spawns and the op
  stands down (`enforceRelations`).
- **Ceasefire during combat.** The operation keeps `standDownPending` and the fight ends as a withdrawal,
  never a capture. No stale strike follows.
- **Defenders.** The actual defenders appear hull by hull (`defendingHullsAt`), with no extra abstract
  strength. Their losses are written to their own records and to `op.defenderLosses`.
- **A raid stays finite.** A scene strike is one strike day.

## 7. The captain's course, A → B → C (PART 8)

`beginWarpTravel` records the plotted course leg by leg:

- `path`;
- `legDays` (`routeLegDays`, each leg its chart length);
- `crossings`;
- `kind`.

`travelDays` is now the sum of the legs, the same days every other journey is charged. The route map
shows that same figure. **This is the one visible timing change**: the old warp charged the whole route's
distance as one leg (row 21 of the movement audit said so; for Paso → Earth, 17 days became 18). A
charge set apart from the legs, such as an explicit override, is spread over the same legs.

At the mid-jump briefing (and again, idempotently, on arrival), `advanceCaptainWarpLegs` works through the
course:

- **Each leg is charged on the calendar in order**, with its own ledger id. It is recorded before it is
  charged, so a reload charges it once.
- **Each system reached is checked** (`captainCrossingCheck`):
  - a blockade that catches him;
  - an engaged hostile operation at an intermediate system;
  - the pirates' waters.
- **On a stop:**
  - the warp ends at B (`w.to = B`, `w.finalTo = C`);
  - `state.warpResume` keeps the rest of the course: destination, remaining path and legs, the encounter
    and the stop type;
  - C is not reached.

**Resuming.** When the encounter is over, the course panel and `resumeCaptainCourse()` fly the remaining
legs, once:

- B is never crossed again;
- the ETA is recomputed from the remaining legs;
- a second call returns false.

Forced back, the course is dropped and he falls back to the previous system.

**Leaving mid-fight.** Leaving a system hands its engagements back at departure (`beginWarpTravel` →
`releaseLocalCampaignBattle` + `leaveStrategicEncounters`), decided on the state he leaves them in, before
any day of the new course passes:

- a pending one falls back;
- an active one is decided, or disengaged;
- a demand he flies from closes as escaped.

## 8. Pirates (PART 9)

When the captain's course reaches a lurking group's waters, the group makes the demand itself. It uses the
Phase 4 local state machine (`issueLocalPredation`), driven by the group's own vessel (its vid) and tied to
a strategic predation objective on the captain (`openCaptainPredation`). Stray local crews do not add a
second demand there.

- **Paid (or cargo):** no battle; the loot goes to the group and it cools off from him.
- **Refuse or run:** the same vessel attacks in the scene.
- **Escape:** the objective closes `target_escaped` with a cooldown. No abstract attack follows (the
  strategic groups never target the player abstractly).
- **The pirate destroyed or surrendered:** the same group is updated (lost; or recovering).

NPC prey attacked where the captain is are fought in the scene with the same group and target.

## 9. Lifecycle, clock and fallback (PART 10)

**Scene entry.**
- `updateStrategicEncounters()` runs every frame with the system activity.
- It spawns pending encounters where the captain is, then applies the decisions.

**Scene exit.** At departure, before any calendar day passes (§7). Once he has left, the system's scene
snapshot never keeps a copy of an encounter's ships: their written-back records are what exists.

**Clock.** Campaign days pass only in warp (or by debug). A scene never overlaps a strategic day of its
own contact.

**Failure.** The failure falls back safely, once, and is recorded:
- in `enc.fallback` (reason, day);
- in the local doctrine history;
- in the debug section.

**A fallback holds only for its own day** (`fellBackToday`). With the captain there the next day, the
objective behind it is handed to the scene again, as a new contact.

## 10. Knowledge and reports (PART 11)

Each encounter gets one galaxy report, `encounter:<id>`. It carries only what the captain saw:

- the classes and count of the ships that were in the scene;
- what became of them;
- what happens next.

The report carries no roster, reinforcements or hidden force. The abstract duplicates are suppressed:
- the blockade-run report (`engineApplied`);
- the operation's `op-done`.

The blockade's `sightings.player` records the force he actually fought.

## 11. Surrender and disabled (PART 12)

Tactical outcomes are written with the Phase 4 rules:

- **surrendered:** `surrenderVessel`;
- **disabled:** stranded, awaiting recovery, with no repair.

Both are unselectable afterwards: tests 27 and 7, and PASSED-AND-RESUMED in game.

## 12. Save / load (PART 13)

| state at save | supported | how |
|---|---|---|
| before handoff (a contact not yet made) | **yes** | nothing to carry; the contact is made on its day as usual |
| **pending** (contact made, scene not yet taken up) — model or captain | **yes** | the record in the campaign book; `tr.held` for a held crossing; `state.warpResume` for the captain's course; after load the scene takes it up once (in-game SAVE-LOAD-AROUND, WAR-OP-HANDOFF; pure 13) |
| **tactical_active**, saved in the same system | **yes** | the engine's existing same-system scene snapshot (`captureWorldEncounter` → `restoreWorldEncounter` for the matching cycle) now carries the encounter keys on each ship (`encounterId`, side, vid, `pirateGroupId`, `localPredation`); the same ships with the same damage come back, none duplicated (SAVE-LOAD-AROUND) |
| tactical_active, the scene not restorable (a cycle mismatch) | **restart from contact** | the record is still `tactical_active` with its participants' `before` state; with no ships in the scene it is re-spawned from the records (no duplicate, since nothing else holds those vids) |
| the captain's own pirate demand mid-answer | **lapses** | Phase 4's local demand is engine-local state; on a reload without its scene the encounter falls back (captain: closed, no attack) |
| right after return (resolved) | **yes** | final records; the course's `warpResume` is saved; nothing re-runs (SAVE-LOAD-AROUND step 3; pure 19) |

**Engine limitation (not faked).** NPC tactical-scene persistence in general, meaning a scene carried
across systems or cycles, stays a backlog item. The handoff does not depend on it:
- a pending record is always safe;
- an active one either comes back through the existing same-system snapshot, or restarts from contact.

## 13. Debug (PART 14)

**Cheats & Debug → Strategic ↔ tactical encounters.** The section shows:

- the counters:
  - opened by type;
  - activated / resolved / fallbacks / aborted;
  - duplicates prevented;
  - same-vid round trips;
  - losses written back;
  - journeys resumed;
  - objectives closed;
  - stale attacks suppressed;
  - abstract resolutions suppressed;
  - disengaged.
- a row per encounter:
  - id, system and type;
  - participant vids with side and fate;
  - objective / op and authority;
  - handoff state;
  - tactical result;
  - strategic continuation;
  - fallback (used, reason, day).
- the captain's course interruption, when there is one.

## 14. Gates

See `HANDOFF` in the package for the counts.

- **Pure:** `npm run test:handoff` (`scripts/strategic-tactical-handoff-test.mjs`), regressions 1–30 plus
  26b–26e, save/load and the three model scenarios.
- **In game:** `npm run test:handoff:ingame` (`scripts/strategic-tactical-handoff-gate.cjs`). It covers:
  - CAPTAIN-STOPS-AT-B;
  - SAME-SHIPS-IN-SCENE;
  - PASSED-AND-RESUMED;
  - FORCED-BACK;
  - SAVE-LOAD-AROUND;
  - FALLBACK-ONCE;
  - WAR-OP-HANDOFF;
  - WAR-OP-CEASEFIRE;
  - LEAVE-MID-FIGHT;
  - PIRATE-PAY / REFUSE / RUN;
  - RAID-IN-SCENE;
  - COURSE-AFTER-FALLBACK;
  - DEBUG-ENCOUNTERS;
  - CAPTAIN-LEGS.
- **Measurement:** `scripts/strategic-tactical-handoff-measure.cjs`, a bounded campaign sample with the
  captain actually flying.

**Existing gates adjusted, and why:**

- **`scripts/campaign-probe.cjs`, gates C and E.** Both counted every ship with a `campaignHullId` as the
  operation's. The world's own defenders now stand in the scene as campaign hulls too (§6), so both count
  the operation's ships (not `encounterSide 'defender'`). Nothing else in those checks changed.
- **The mid-jump briefing check (`captains-briefing-probe.cjs`)** sets `travelDays = 3` by hand. It passes
  unchanged: a charge set apart from the legs is spread over them (§7).

## 15. Independent review

A reviewer with no part in writing the patch reported **7 confirmed defects**. All 7 are fixed:

1. **An ambient raid whose scene failed could leave its encounter tactical_active forever**, holding its
   hulls. Leaving then reported every listed ship as destroyed.
   - The failed spawn now calls the encounter off.
   - The safety net also settles an active encounter the captain is not with.
   - `encounterReport` never infers "destroyed" from a scene that holds none of the encounter's ships
     (pure 26e).
2. **A held AI crossing that fell back kept its lost or disabled runners on the journey.** The strategic
   run's conditions now detach them, as a tactical result would (pure 26c).
3. **One hull could be in two live encounters**, and so be spawned twice. A hull already in one is never a
   party to another, and a blockader fighting in the scene is not "on station" for another runner
   (pure 26d).
4. **The 60 s engagement window was lost on reload**, because the page clock restarts. The elapsed time is
   saved and the window re-stamped on load.
5. **An interrupted course could be left waiting for ever** after a fallback or a called-off stop, and a
   resume that could not depart lost the course.
   - Every terminal transition now leaves the course ready or dropped (in-game COURSE-AFTER-FALLBACK).
   - The course is cleared only after the warp actually starts.
6. **Forced back at the destination itself did nothing.** A last-leg stop now records where he came from.
7. **Operation encounters over-counted what the captain saw**, since every hull was marked spawned at the
   claim, and a failed fresh claim ran a second battle day.
   - The spawned list is the ships actually placed, wave by wave.
   - A fresh claim that fails goes back to the model without re-running the day.

Of the reviewer's suspicions:

- **Fixed:**
  - a raid resolved after its war ended counts no strike;
  - a pending handoff at a world the attacker already holds falls back;
  - a pirate vessel missing from the scene is not taken as destroyed;
  - a forced retreat is saved and waits if the ship cannot depart yet;
  - interception counting on fallback;
  - pruning with 80 or more live encounters.
- **Known limits:**
  - a journey replotted by its owner while one of its crossings is held in the scene (reachable only by
    advancing campaign days with the captain present and the scene live, i.e. the debug day-advance:
    days do not otherwise pass during a scene, §9);
  - within a pirate group's waters, stray crews make no demand of their own, even while the group itself
    is cooling off.

## 16. Still deferred

1. SHIP-DEPENDENT STRATEGIC SPEED
2. towing/salvage and stranded-hull recovery movement
3. trader record-shape consolidation
4. treaty expansion (DMZs, inspections, tribute, reparations, basing rights, transit guarantees)
5. NPC tactical-scene persistence
6. autonomous war declarations
7. doctrine invasion/occupation
8. broad covert doctrine
9. Hirogen hunting
10. Borg assimilation
11. Gorn activation
12. Tactical Cube

The captain-warp handoff and the pirate local-follow handoff are done and come off the list.
