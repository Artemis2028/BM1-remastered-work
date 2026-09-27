# Faction doctrine runtime — phase 1

DTG 271245ZSEP26 · stacked on 372fe66 (blockade interception and running, frozen)

This round loads the v0.2.1 doctrine package as game data and lets it decide from what an actor actually knows. It does not hand the campaign to doctrine. It follows stages 2–4 of the package's own integration order (`DESIGN-doctrine-v0.2.1.md`, "Data contract and integration order"):

1. observer-evidence and stable incident/location adapters;
2. a shadow evaluator that logs **why**;
3. three live pilot responses on one persistent incident type, `asset_overdue`.

Everything else doctrine proposes is recorded, not acted on.

| | |
|---|---|
| Doctrine package | `docs/doctrine/bm1-faction-doctrine.v0.2.1.json` + `.schema.json`. Unchanged; read in place; no second copy anywhere. |
| Evaluator | `src/doctrine-runtime.mjs` (pure) |
| Campaign adapter | `src/doctrine-campaign.mjs` (pure; one hook in `settleCampaignDay`) |
| Engine | `src/main.js`: loading, effects, player traces, Cheats & Debug, NPC overlay and fire facts |
| Gates | `test:doctrine` (28 pure groups), `test:doctrine:ingame` (13 checks) |

## 1. Loading the doctrine as runtime data

At startup the game fetches the data and schema from `docs/doctrine/`; the release build copies the two files to the same path. They pass through `Doctrine.loadDoctrine`:

* **Structure** is checked against the bundled schema, with the same keywords the reference validator implements. An unsupported schema keyword is itself an error.
* **References** are checked with the reference validator's rules: facts, actions, role templates, objectives, responses, profiles, sources and events.
* The **predicate grammar is strict**. Accepted are a Boolean literal, `{fact: ID}`, `{all: [..]}` and `{any: [..]}`, with nonempty lists. The loader rejects:
  * a string;
  * any other operator (`not` included);
  * an empty list;
  * an extra key;
  * an unknown fact.
* Nothing is ever executed.
* **Runtime rules:**
  * Two profiles may share a runtime key only through the Dominion adapter.
  * Callers cannot inject unknown facts or `engagement_authorized`. The evaluator throws on both.
* The loaded doctrine is **deep-frozen**.

**Failure is a development error, not a crash.** A package that fails to load or validate:

* logs a `console.error` listing every problem;
* shows the error in Cheats & Debug;
* leaves doctrine off.

The campaign then runs exactly as on 372fe66, because the doctrine hook is simply absent.

**Safe fallbacks for missing profile data:**

| Situation | Result |
|---|---|
| A runtime faction with no profile | Record-only, with a development warning. |
| An unsupported canonical role | `deny_assignment` |
| A legacy native role | `roleMap`, then the profile's `unknownRole` |

The package's own 59 offline cases run through the JavaScript evaluator in node (pure group 1) and in the browser (in-game check 1): **59/59**.

The package still carries `status: DESIGN_ONLY_NOT_LOADED_BY_GAME`. The schema pins that value as a `const`, so it is left alone and shown as the package status in the debug panel.

## 2. Actor knowledge

Doctrine evaluates what an **observer** knows. There are three kinds of observer:

* `command:<polity>`: a faction command;
* `hull:<hullId>`: one vessel;
* `player`: the captain. The captain's knowledge only matters for what the captain is told (§7).

The adapter keeps three stores apart:

| Store | Holds | Read by |
|---|---|---|
| `book.doctrine.ground` | **What happened**: fates, wrecks and survivors at a location. | Only detection (an observer physically present) and the on-site work of an assigned crew. |
| `book.doctrine.knowledge[observer][incident]` | **What that observer knows**: claims, provenance, confidence, observed/received days, evidence, survivor reports, linked losses, resolution. | The fact adapter, and nothing else. |
| `book.doctrine.incidents` | Incident **identities** and lifecycle. | Everything. It holds no fate and no attacker. |

Provenance, identification, attribution, confidence and freshness stay separate, as the package requires:

* `provenance` is one of `direct_witness`, `direct_sensor`, `received_report`, `recovered_record`, `inference`.
* `confidence` is `unassessed`, `tentative` or `corroborated`.
* **Identification** is a wreck's design and registry. It is recorded only by examining the wreck, and it is not attribution.
* **Attribution** is never created in phase 1: an overdue asset names no attacker.
* **Freshness** depends on the claim. Evidence stays a lead for `evidenceLifeDays`. A search area stays usable for `searchAreaFreshDays`. A survivor report stays usable for `survivorWindowDays`. A position is never a weapon track.

### How an observer learns

| Channel | Provenance, confidence |
|---|---|
| The owner's own assignment records: a milestone missed. | `direct_witness`, corroborated |
| Present at a system with a wreck site: an assigned vessel there, or the command holding the system. | `direct_sensor`. Debris is seen; whose it is, is not. |
| A vessel's crew reporting to its own command. | `received_report`, corroborated |
| A crew that examines a site (objective work). | `recovered_record`. Designs and registries are identified. |
| A report from another observer (`transmit`). The sender passes on only what it holds that day. | `received_report`: corroborated from the asset's owner, one's own side, or an eyewitness of a power not at war with the recipient; otherwise tentative until a second independent source. |
| A search group hailing for its own missing ship at each system it passes. | `received_report` to anyone present. |
| An authored or debug relay (Cheats & Debug, labelled override). | `received_report` |

Hidden cargo never travels:

* The owner may know a manifest (`verified`).
* Shared claims always carry `cargo: {knowledge: 'unknown', manifest: null}`.
* A payload that pairs unknown cargo with a manifest fails `eventErrors`.

### Doctrine facts → runtime evidence (phase 1)

Every fact not listed here is **false**, and the trace says why.

| Fact | Derived from (this observer only) |
|---|---|
| `event_known`, `witness_or_report_received` | The observer holds a knowledge record for this incident. Faction membership never creates one. |
| `credible_report` | The record's confidence is `corroborated` (see the channels above). |
| `event_actionable` | Either the observer has not heard it resolved, **and** its last-known area is ≤ `searchAreaFreshDays` old or it holds a live evidence lead; **or** survivors it knows of are still waiting within `survivorWindowDays`. |
| `own_asset_affected` | The asset's owner **as claimed in the record** is the observer's organisation. An unknown owner is false. |
| `usable_search_area` | A fresh last-known location, or a live evidence lead. |
| `evidence_available` | A known, unexamined evidence site within `evidenceLifeDays`, observed no earlier than the ship's last report. Anything seen before that cannot be a trace of what came after. For the owner only, it can also be its own assignment's route and last check-in while fresh (the place its ship's traces would be). |
| `survivors_known` | A survivor report with a location, within the window, not known rescued. |
| `linked_own_losses` | Evidence this observer holds for the incident identifies a wreck of **its own** organisation. |
| `identity_known` | A wreck design in its evidence was identified. |
| `actor_attributed` | An attribution claim. None is ever made in phase 1. |
| `pact_briefing_received` | An active pact where the observer is a **signatory command**, or an explicit briefing receipt (`briefActor`). |
| `pact_exposure_risk` | Briefed on a pact, **and** its known evidence identifies a wreck of the pact's other party. |
| `pact_task_assigned` | An explicit pact task (`assignPactTask`). |
| `war_order_active` | Only when a war target is named: `warAuthorityStamp`/`warAuthorityHolds`. The war instance must be formal and still at war, so a ceasefire removes it. |
| `supply_inadequate` | The polity's supply is below `minSupply`. |
| `can_transmit`, `report_due` | Subspace is always available; `report_due` holds until this observer has sent its report. |
| `can_respond` | Computed **for the response actually matched** (§5). |
| `regional_threat_supported`, `contract_affected` | Not derived in phase 1 (always false). |
| `live_weapon_track`, `contact_detected`, `weapon_*`, `inside_equipped_range`, `target_actionable` | **Never** strategic. Tactically they come only from the engine (§8). |
| Objective facts (`objective_complete`, `evidence_recovered`, `objective_cancelled`, `objective_deadline_reached`) | The objective's own state (§6). |

On the phase-1 pact gate: `phase1Integration.futurePactGate` said adapters must not supply pact facts until a scoped relationship resolver existed. Since then, 73d8d44 made pacts authored treaty state with a single visibility rule. This round supplies pact facts only from explicit per-actor receipts or signatory status. Every pact response (`conceal`, `support_pact`) stays **shadow-only**. The pact's public `knownTo` is never written.

## 3. Profile and role selection

Native runtime roles are preserved. `role`, `playerEscort`, `fleetId` and the combat-credit fields are read and never renamed; the doctrine role is an overlay. Command and allegiance, together with the job, select the profile and role. **Hull origin never does:** a Dominion-built hull in Romulan service is Romulan.

| Actor | Runtime faction for the profile | Doctrine role |
|---|---|---|
| `command:<polity>` | The polity | `commander` |
| `hull:<id>` on a doctrine assignment | The polity holding the hull | The assignment's `doctrineRole` (patrol, explorer, investigator's role, …) |
| `hull:<id>` with a designation | The polity holding the hull | The designation (`relief`, `civilian`, `covert`, …) |
| `hull:<id>`, otherwise | The polity holding the hull | Native `patrol` → `roleMap`, then the profile's `unknownRole` |
| Tactical NPC (overlay, inspection only) | Polity of its campaign hull, else its faction. A player escort or fleet ship uses the captain's flag. | `doctrineRole` if set, else `playerEscort`/`playerFleet`/native role via `roleMap` |

The shared `dominion` key has two profiles:

* Polity `dominion` is Central's own command. It resolves to **Central** only with central authority, scenario activation (Dominion phase not dormant) and orders (it is running the expedition).
* Polity `dominion_remnant` resolves to **Remnant** unless all three hold:
  * an explicit `commandBindings.dominion_remnant → dominion`;
  * scenario activation;
  * a received Central order (`issueCentralOrder`).
* A Dominion NPC that is not a hull of a Central operation is **Remnant**.
* The autonomous Blender Remnant never inherits Central command.

**Gorn** stays dormant. Its activation is `disabled`, every generator is disabled, and its reaction is `inactive`. No routine doctrine job is ever generated for it, even when configured.

**Vulcan** stays armed. Its relief and patrol ships keep `self_defense` and `protect_charge` and no war-only attack.

## 4. `asset_overdue`: persistent incidents on real assignments

### Assignments

An `asset_overdue` needs a real expectation. Doctrine assignments are the jobs that carry one:

* **Routine pilot jobs:**
  * one Romulan frontier **patrol** at a time (generator `patrol`; home world → an adjacent non-Romulan system; dwell 3 days; back);
  * one Delpin **survey** at a time (generator `traffic`; a seeded two-jump walk; back).
* **Objective legs:** investigation and rescue.
* **Return orders.**

Each assignment lives on an existing hull (status `assigned`, `opId` = the assignment), so no other operation can take it. It moves one jump per campaign day. A stop can carry a milestone, `arrival` or `check_in`, with a due day and a grace period (1 and 2 days). The owner's last report (the last milestone met) is its **last-known** location, not the truth.

Generation obeys the profile's generator (`requires_assignment_and_budget`), a real spare hull (never a world's last `homeGarrisonPerWorld` ships) and the interval.

Vulcan relief is a **designation** on one home hull. The hull stays in the ordinary pool, which is exactly why capacity is checked when a rescue is wanted.

### Detection

A milestone is missed only when both hold:

* the day is **strictly after** the due day plus grace, on the same clock;
* the vessel has not met it.

The incident ID is `inc:overdue:<assignment>:<milestone>`, keyed on the first milestone missed. It is never recreated.

There is one incident per missing asset on an assignment. A later milestone the same ship also misses is added to that incident (`alsoMissed`) and never opens a second search. For example, a patrol lost before its arrival also misses its check-in (pure 28).

This joining applies only while the owner still has the ship missing, or has found it lost.

* Once the ship reports in again, the incident resolves `asset_returned`.
* The owner then re-expects the rest of its itinerary from that day.
* A later loss is therefore a new disappearance, with a new incident and its own wreck (pure 33).

**Only the owner's command knows** (`direct_witness`, corroborated). Its record carries:

* the asset (vid, kind, role, owner, faction);
* the assignment (origin/destination location IDs);
* cargo (the owner's own knowledge);
* the missed milestone, `detectedAt` and the last-known location with its observation day;
* `position: null`.

`locationId` is the milestone's site and `jurisdictionAtOccurrence` its controller. Location IDs are the world's name (`system:aldnas`), never its index.

A vessel unloaded from a scene, or a captain leaving and re-entering a system, touches none of this. In-game check 7 runs routine patrols and surveys for 60 days while the captain hops between systems (including the patrol's own); pure group 23 runs 120 days. Neither produces an incident.

### What happens to a missing ship

This is ground truth; nobody is told:

* **Destroyed:** a wreck at its location.
* **Disabled:** the hulk stays with its crew, and survivors are recorded until the survivor window runs out.
  * If the hulk is later repaired and leaves, its wreck entry and its crew leave the site with it.
  * If it is lost after all, it becomes a destroyed wreck, and its crew are lost with it (pure 30).
* **Destroyed with pods:** survivors, seeded at a 0.5 chance.
* **Captured:** gone whole. No wreck.

Losses come from the shared blockade engine or from an explicit override. The override is **Lose latest patrol (unwitnessed)** in Cheats & Debug, `loseAssignmentHullUnwitnessed` in authored scenarios.

## 5. Shadow evaluation, the pilots and capacity

### Shadow evaluation

Every campaign day, each open incident is evaluated for:

* every observer who knows of it;
* the watched commands (Romulan, Klingon, Delpin, Vulcan, Cardassian, Terran, Dominion, Remnant);
* the designated relief ships and active explorers.

The latter two are included so that "knows nothing, does nothing" is on record.

**Each observer judges an incident by its own record.**

* The owner settling an incident (`asset_returned`, `asset_located`) settles it for the owner. Anyone else learns it only if told.
* An observer who has not heard keeps being evaluated while its knowledge is in date, keeps linking new evidence to it, and keeps its record (pure 29).
* A settled incident leaves the books only once every record of it is settled or out of date.

Each evaluation records:

* profile, role, culture, and their reasons;
* known facts, with a trace for each fact;
* the matched interest rule and the proposal;
* failed prerequisites (on a deferral) and the capacity check;
* whether it acted, the objective, or why it did not act;
* the existing, pre-doctrine activity of that actor.

`lastEval` holds the latest per observer and incident. `shadow` is a bounded log, appended when anything in the entry changes. It is visible in Cheats & Debug only.

### The live pilots

Everything else stays shadow.

| Profile | Role | Response | Actor |
|---|---|---|---|
| romulan | commander | investigate | Romulan command assigns an existing spare armed ship. |
| delpin | explorer | investigate | The explorer itself breaks off its survey (its milestones are superseded, and it tells its command). |
| vulcan | relief | rescue | The designated relief ship itself. |

### Capacity

`can_respond` must mean something real. It is true only when **all** of these hold:

* a suitable vessel exists:
  * for a command, a spare armed hull (combat ≥ 0.5), never below the garrison floor;
  * for a vessel, itself, free or on a routine job it may break off;
* the vessel is not committed incompatibly (`opId`, status);
* a route exists (`shortestRoute`, which honours the closed wormhole);
* the target is ≤ `maxResponseHops` (6) away;
* Dominion scenario activation means the expedition arc is running: reconnaissance, staging or invasion. Dormant and withdrawn are not active.
* supply is ≥ `minSupply`;
* the per-polity doctrine budget allows it (one live objective at a time);
* the trip plus the work fits the deadline;
* for a rescue, the ship can arrive within the reported survivors' window.

Otherwise the result is `defer:<response>` and the reason is recorded, for example `can_respond (no spare armed vessel (garrison floor kept))`. **No vessel is ever spawned.** A deferred response is re-evaluated daily and acts once capacity exists (pure 24, in-game check 4).

There is **one objective per (incident, actor, response), ever**, whatever its end. This is kept on the incident itself, so trimming old objectives cannot reopen it. A closed demand is never recycled with a new ID.

## 6. Objectives and their end

Each live objective records:

* a stable ID;
* the incident link;
* the actor, profile, role and response;
* the assigned vessel (hull ID and **vid**);
* the target location (bounded area);
* its creation day;
* its deadline on its template's clock;
* its resolution.

The deadline is 14 days for an investigation and 10 for a rescue.

**Clock.** The doctrine's `strategic_jumps` is the **settled campaign day**. Campaign days advance only on completed travel, by the route's days. A cancelled jump advances nothing, and neither does a wormhole transit, which takes no days (the 14 Sep decision). The doctrine text counts wormhole travel as a jump; phase 1 follows the settled calendar rule instead.

The objective's facts and the package's own `objectiveStatus` decide when it ends. Abort, cancellation and deadline take precedence over success, and both reasons are recorded.

### Incident, assignment and objective transitions

| Record | From → to | When |
|---|---|---|
| Incident | — → `open` | Owner detects a missed milestone past due + grace. |
| Incident | `open` → `resolved: asset_returned` | The vessel meets any later milestone (a late check-in). The owner's own searches are cancelled. |
| Incident | `open` → `resolved: asset_located` | The owner's own crew examines a wreck bearing its vessel's registry. The search that found it completes; other powers' objectives are **not** cancelled (they have not heard). |
| Incident | never | Deleted or recreated. Other observers keep their own view until told. |
| Milestone | `pending` → `met` / `missed` / `superseded` | Arrival on time or late / past due + grace / the job was diverted or ended. |
| Assignment | `active` → `completed` | The itinerary is complete (patrol, survey, return). |
| Assignment | `active` → `diverted` | The explorer breaks off for an objective. |
| Assignment | `active` → `superseded` | Its command gave the hull other orders. |
| Assignment | `active` → `ended` | Its objective closed. |
| Assignment | `active` → `written_off` | No word for longer than `evidenceLifeDays` after a missed milestone. |
| Objective | `active` → `completed` | `evidence_recovered` or `objective_complete` (rescue done). A site with nothing there is only *searched*: the objective runs on to its deadline. |
| Objective | `active` → `aborted` | `objective_cancelled` (the command itself knows: its incident resolved, or it reassigned the vessel), `objective_deadline_reached`, or `supply_inadequate`. |
| Objective | after closure | Its assignment ends and its pending milestones are superseded, then the hull is released. If away from home, it gets a **separate** return order. Nothing moves or fires under the closed objective (pure 21). |

A vessel **silently lost** on an objective is not a cancellation, because its command does not know. The objective runs to its deadline, and the vessel's own missed arrival becomes a new incident.

## 7. What the captain sees

There is no global "AI decisions" feed. The engine publishes a doctrine trace only through a source the captain actually has at that system: local, a fleet ship on station, a relay, or rumour. No trace carries a reason, a profile, a rule or a culprit (`claimedAttacker: null`).

| Trace | Report |
|---|---|
| Search departs its origin | *Search group departing — X*: "A Romulan search group was observed leaving X." |
| Search reaches each system on its way | *Romulan patrol overdue*: "Romulan ships at X are hailing for an overdue Romulan patrol." |
| Investigator on site | *Debris investigated — X*: "A Delpin vessel is investigating debris at X." Or *Search under way — X*. |
| Relief on site / rescue | *Relief ship searching — X* / *Survivors recovered — X* |

Incidents, knowledge, evaluations and objectives are **debug-only**.

## 8. Combat authority

The combat engine is unchanged; `fireNpcWeapon` and `updateNpcShips` are untouched.

* `npcPhysicalFireFacts` reads the engine's own conditions:
  * `sensorCanTrack` for a live track;
  * `fleetNpcWeapon` for an installed, usable weapon;
  * `weaponReadyAt` plus the scaled cooldown for readiness;
  * `getNpcWeaponRange` against the sensor-known distance for range;
  * the target still actionable.
* `doctrineFireCheck` combines those with authority facts through `Doctrine.fireDecision`. In game it is for inspection only.
* Any physical fact a caller supplies is **discarded** before the engine's readings are added (in-game check 8).

Doctrine can withhold a shot but never grant one the engine would refuse:

* outside range → `inside_equipped_range` fails;
* a cloaked or untracked target → `live_weapon_track` fails;
* whatever the war authority (in-game check 8, pure 19/20).

After a ceasefire the war order's authority stamp no longer holds (pure 27). Static hostility is not a formal war.

## 9. Coexistence with the accepted systems

* **Formal wars, ceasefire and peace:** `war_order_active` reads the formal war instance.
* **Blockades:**
  * every doctrine leg into a system runs its applicable blockades through `resolveBlockadeRun` (runner kind `doctrine`, the hull's vid);
  * a turned-back vessel retries the next day, and the delay can make it overdue;
  * losses are the engine's own (pure 26, in-game check 10).
* **Evacuation, blockade and formation routing:** untouched. Doctrine hulls are `assigned`, so evacuations, blockades and operation planning cannot take them.
* **Persistent vessel identity:** every assignment and objective records the hull's vid, and the same vessel carries it through assignment, travel, objective and return (pure 25, in-game check 5).
* **Secret treaty knowledge:** compartmented, as in §2. The pact never reaches the captain (in-game check 11).

## 9a. Doctrine off, or not loaded

With doctrine switched off for a campaign, or the package not loaded, every doctrine assignment ends and every live objective is called off. The hulls return to their powers where they stand, so nothing stays parked on a doctrine job (pure 31).

The package loads at page start, before any campaign day can pass: a campaign day advances only on a completed journey.

## 9b. Saved state is bounded

The doctrine part of a save (`book.doctrine`) is capped:

| What | Kept |
|---|---|
| Shadow log | 120 entries |
| Objectives | the live ones, plus the last 40 closed |
| Finished assignments | only those an incident or objective names, plus the last 12, with their itineraries trimmed |
| Incidents | 20 settled in history, with their knowledge and evaluations |
| Evaluation traces | dropped 30 days after an incident settles |
| Sightings | 60 per observer, oldest first, and none for expired sites |
| Wreck sites, fates, briefings, orders | expired sites removed; fates of jobs no longer on the books removed; briefings for inactive pacts removed; briefings and orders capped at 10 per actor |

Location indices are derived from the world and not saved. Routine patrols over 300 days add about 12 KB to a save. A 400-day stress run with repeated losses stays under 200 KB (pure 32).

## 10. Debug and cheats

Cheats & Debug has a new section, **Faction doctrine (debug)**:

* load status and warnings, or the load error;
* active incidents, with who knows each (provenance, confidence, evidence, survivors, links, known resolution);
* the last shadow evaluation per observer (profile/role, known facts, matched rule, proposal, objective or why not acting);
* doctrine objectives (vessel vid, target, created, deadline and clock, status and reasons);
* routine assignments with their milestones.

Controls, all labelled:

* **Romulan patrol now**;
* **Lose latest patrol/survey (override, unwitnessed)**;
* **Disable latest (override)**;
* **Relay report (override)**: incident, from, to;
* **Doctrine on/off** for the campaign.

Codes: `doctrine status | on | off | patrol <faction> [system] | lose [assignment] [disabled] | relay <incident> <from> <to>`.

## 11. Out of scope, documented

* All 22 profiles live, broad autonomous wars, full covert operations, every culture behaviour, occupation doctrine, pirate extortion, Borg assimilation, Hirogen hunting, Gorn activation, the Tactical Cube, weapon rebalance, new treaty mechanics, DMZs, inspections, tribute, reparations, basing and transit guarantees.
* Tactical materialisation of doctrine vessels.
  * Doctrine hulls move strategically only; a captain in the same system does not meet them in the scene.
  * As `assigned` hulls, they take no part in offscreen battles.
* Automatic report networks. Reports travel by own records, presence, own-crew reports, search hails and authored or debug relays. Selective sharing policies are future work.
* Carried forward, still true:
  * evacuation convoys still use simplified one-system-per-day timing rather than formation leg durations;
  * AI strategic missions beyond this pilot set do not yet all use the blockade-running engine;
  * the tactical handoff for strategic blockade interceptions remains deferred.

## 12. Tuning

`DOCTRINE_PILOT` in `src/doctrine-campaign.mjs`, first pass, unmeasured:

| Setting | Value |
|---|---|
| Patrol | every 10 days, dwell 3 |
| Survey | every 12 days, dwell 1, 2 jumps |
| Grace | arrival 1 day, check-in 2 days |
| Investigation | 2 days on site, deadline 14 |
| Rescue | 1 day on site, deadline 10 |
| Maximum response range | 6 jumps |
| Minimum supply | 0.3 |
| Live objectives per polity | 1 |
| Evidence life | 90 days |
| Search area fresh | 30 days |
| Survivor window | 20 days |
| Escape-pod chance | 0.5 |

The book keeps its config inline, so a save keeps its values.
