# Faction doctrine runtime — phase 2

DTG 271806ZSEP26 · stacked on the frozen phase 1 candidate `82b7c79`.

Phase 2 takes the phase 1 architecture (the doctrine package loaded as data, per-observer knowledge, a
persistent incident, shadow evaluation, a handful of live pilots on real hulls) and proves it across
different incident families and different non-combat interests:

- **distress and rescue** — a persistent incident of its own;
- **threatened commercial assignments** — Ferengi freighters reroute a threatened contract;
- **escort obligations** — Tholian command protects a threatened project as an escort of a named charge;
- **report propagation** — reports are persistent messages between real actors, with a payload, a channel
  and a delivery day.

Nothing else goes live. Military, covert, occupation, pirate, Borg, Hirogen and war-planning doctrine stay
in shadow. The source package is unchanged (`docs/doctrine/bm1-faction-doctrine.v0.2.1.json`, status
`DESIGN_ONLY_NOT_LOADED_BY_GAME`); the game still reads it in place.

Code: `src/doctrine-campaign.mjs` (the campaign adapter; the pure loader/evaluator `src/doctrine-runtime.mjs`
is unchanged) and the doctrine block in `src/main.js`. Gates: `test:doctrine:p2` (pure, 27 groups) and
`test:doctrine:p2:ingame` (11 checks); phase 1's `test:doctrine` (28) and `test:doctrine:ingame` (13) stay green.

---

## 1. One incident framework, several families

There is still one incident store (`book.doctrine.incidents`), one knowledge store per observer, one
evaluation loop and one objective list. Phase 2 adds event types to it; it does not add a second system.

| field | asset_overdue | distress |
|---|---|---|
| ID | `inc:overdue:<assignment>:<first missed milestone>` | `inc:distress:<vid>:<day>` (or `inc:distress:site-<location>:<day>` when found by someone who could not identify the ship) |
| created by | the owner's command, strictly after due + grace | the ground: a crew alive aboard a disabled hull or in lifeboats (a *call*), or an observer that finds people on the spot where no call went out |
| `detectedBy` | `command:<owner>` | `beacon:<site>` (the call) or the finding observer |
| location | the missed milestone's site | where the people are |
| contract | `contractId` of the assignment, if any | — |
| dedup | a later miss by the same ship joins the open (or located) incident | a second call for the same people joins the open incident |
| resolution | `asset_returned`, `asset_located`, `written_off` (no word for 90 days) | `survivors_rescued`, `vessel_under_way` (repaired and gone), `lost_with_vessel`, `window_closed`, `call_ended` |

Both families share: stable IDs, per-observer evidence and claims, reports sent and received, objectives,
deadlines on `strategic_jumps`, resolution per observer (the owner's settlement is not anybody else's),
save/load, bounded history and deduplication (`stats.duplicatesPrevented`).

Every knowledge record now carries a `version` and a `lastChange {day, cause}`; the cause is what the
reevaluation log quotes ("report …msg:21", "debris seen at system:aldnas", "survivors found on the spot").

### Contract-affected (commercial) facts

`contract_affected` is derived only from the observer's own contracts (§3): the missing ship carries one of
its contracts, or the incident's area lies on a contract's remaining route. The incident's area is what the
observer knows of it: for a missing ship, the stretch between where it was last heard from and where it
failed to report; for a distress call, where it came from. It is false once the observer knows the matter
resolved.

Unknown stays unknown: a distress call names its caller only if the caller said who it is; people found on
the spot by someone who could not examine the wreck are "a ship, owner unknown"; hidden cargo never travels;
no report names an attacker; nothing supplies a live weapon track.

## 2. Distress and rescue

A distress incident contains only what was reported or observed:

| claim | from |
|---|---|
| `asset` (vid, role, owner) | the call itself, or the recovered wreck's registry; otherwise unknown |
| `lastKnown` | where the call comes from / where the people were seen |
| `survivors {locationId, observedDay, provenance}` | the call, or being there |
| `urgency` | `critical` (aboard a disabled hull), `lifeboats` (the ship is gone) |
| `hazards` | any blockade that bears on the caller at that system |
| deadline | the survivor window (`survivorWindowDays`) |

Survivors are **never** inferred from a vessel's class, faction or disappearance, or from hidden state. An
overdue ship is not a distress call: phase 1's "survivors attached to an overdue record" is gone; the
survivor part of a loss is its own distress incident, opened only by a call or by someone who sees them.

**Several groups at one place** (two hulks, lifeboats beside a hulk) are tracked separately: each hulk's
crew is listed on the site, each call knows the hulk it came from, and one repaired ship leaving takes only
its own crew (its call resolves `vessel_under_way`); the others keep waiting.

**Who hears a call:** anyone on the spot, the commands that hold a system next door, and the caller's own
command — each by a `broadcast` report (same day if on the spot, a day later over the network). Not the
caller itself, and not a power far away.

**A silent loss** (`loseAssignmentHullUnwitnessed(…, { silent: true })`: the ship's comms went with it) sends
no call. Phase 1's tests and in-game scenarios use silent losses so their semantics hold unchanged.

**Vulcan rescues only when** its relief ship has received a usable survivor report (from the call, a
forward from its command, or anyone passing the report on), a real relief-capable vessel is free (or on a
job the pre-emption table lets it break off), and route, range, supply and the survivor window permit.
Otherwise the result is `record_only` (no survivor evidence) or `defer:rescue — <reason>` (no capacity).
Nothing is spawned. A rescue ends `completed` when the people are taken off (the distress incident resolves
`survivors_rescued`), or `aborted` when it can no longer arrive in time, when nobody is left on arrival, or
at its deadline.

## 3. Commercial incidents

Contracts are real, persistent commitments carried by real hulls (`book.doctrine.contracts`):

- **Ferengi delivery**: one freighter, a cargo, a destination, a due day (route + a day loading + slack).
- **Tholian construction project**: tenders carrying materials from a depot to a site, one load after
  another, until the project has its loads or is past due. When a tender goes overdue, the project sends
  the next load with the next free hull at the depot.

Contracts decide `contract_affected`; they carry no money this round (economic settlement is deferred).
Routine generation starts one Ferengi delivery every 12 days to a friendly port 2–3 jumps off, and one
Tholian project every 30 days between two Tholian worlds 1–3 jumps apart.

**Ferengi (civilian role): reroute.** A freighter whose contract runs through a threatened stretch — a
missed delivery of its own company, or any other overdue ship on its way; the victim's nationality does not
matter (`contract_risk`) — takes another route to the same destination, on the same assignment, same hull,
same vid; the pending milestones are re-expected on the new schedule, so the change is not itself a missed
check-in. If there is no way round, its destination lies inside the trouble area, or the way round misses
the due day, it defers with that reason. The Ferengi never investigate; an unrelated loss is `record_only`.

**Tholian (commander role): protect → escort.** `industrial_risk` fires on a tender overdue on a live
project. The response is carried out as an **escort** of the project's next live load (§4). With no live
load yet it defers (`no live delivery on contract N to protect`) and reevaluates when the next tender
sails; with no spare armed ship it defers (`no spare armed vessel …`). No protection fleet is spawned.

`protect` maps to the package's `escort` objective template (strategic clock, success `charge_safe`),
not the tactical `defense` template the response catalogue names for immediate defence.

## 4. Escort objectives

An escort objective retains:

| field | |
|---|---|
| `id` | the objective |
| `charge {assignmentId, hullId, vid, contractId, destination}` | the named charge, fixed at creation |
| `assigned {hullId, vid}` | the escort |
| `target {locationId, area}` | the charge's destination and the stretch it still has to sail |
| `createdDay`, `deadline` | deadline = created + 20 days (`escortDeadlineDays`) |
| `escortState` | `joining` → `escorting` → `closed` |
| `resolution` | reasons and note |

The escort is chosen from spare armed ships (never a world's last defenders) that can reach a point on the
charge's way **before the charge gets there and before its destination** (meeting it at the destination
protects nothing); the earliest such point wins. It sails there, joins when they are in the same system
(at once if they already are), and from then on travels with the charge: it moves in the charge's own step,
and the pair run any blockade **together** in one runner through the shared interception engine.

If a blockade disables or destroys the charge, the escort (which ran it beside the charge) ends the day in
the same system. The captain's report `… escort assigned to … convoy` is sent when the escort actually
joins, from where it joins.

It never leaves the charge to chase anything: it has no target of its own, takes no other objective while
committed (§6), and an unrelated report or contact is recorded and nothing more. It closes:

| on | status |
|---|---|
| the charge's arrival at its destination is on record (`charge_safe`) | completed |
| the charge is lost while escorted, or its job/contract ended | aborted (`objective_cancelled`) |
| the escort is lost, disabled or taken for something else | aborted |
| the deadline | aborted (`objective_deadline_reached`) |

After closing, the escort goes home under a separate return order (as every phase 1 objective).

## 5. Reports: persistent messages

A report is an object in `book.doctrine.messages`:

| field | |
|---|---|
| `id` | `<seed>:doctrine-msg:<n>` |
| `incidentId`, `eventType`, `kind` | what it is about; `kind` names it (`distress_call`, `survivor_report`, `findings:<obj>`, `orders:<obj>`, `internal:v<n>`, `hail:<system>`, debug kinds) |
| `sender`, `recipient` | observers: `command:<polity>`, `hull:<id>`, `beacon:<site>` |
| `payload` | a **snapshot** of what the sender held on the day it was sent, cut to the profile |
| `include` | the profile's claim list |
| `provenance`, `confidence` | `received_report`; `corroborated` or `tentative` (below) |
| `channel`, `hops` | §6 |
| `sentDay`, `deliverDay`, `deliveredDay` | on `strategic_jumps` |
| `state`, `reason` | `pending`, `delivered`, `undeliverable` (recipient gone / incident no longer on the books), `expired` (30 days) |

Payload profiles:

| profile | carries |
|---|---|
| `overdue_notice` | asset, assignment, missed milestone, detected-at, last known (the expected place) |
| `findings` | the above + evidence + the sender's resolution |
| `survivor_report` | asset, survivors, hazards, urgency, last known |
| `full` | everything the sender holds (own command → own vessels, orders, overrides) |

Always: cargo travels as `{knowledge: 'unknown', manifest: null}`; no attribution field exists to travel; a
pact briefing travels only if the sender itself is briefed **and** the send names the pact (`pactKey`).

A report grants no more than its payload: an overdue notice gives the recipient that the ship is overdue
and where it was expected — not the owner's evidence, not whether it was destroyed, not survivors or their
position, not an attacker, not the cargo. Until it is delivered the recipient holds nothing and its
doctrine is untouched (it evaluates `ignore_unknown`).

**Confidence:** corroborated when first-party (the owner about its own ship), same side, or an eyewitness
(evidence seen or examined, a call from the people themselves) from a power not at war with the recipient;
otherwise tentative, and a second independent source corroborates.

**Deduplication:** one report per (incident, sender, recipient, kind, version of the sender's record): the
same report is not sent twice, but one sent after the sender learned more goes. A command forwards to its
vessels once per version of its record.

**A crew's sighting** of debris reaches its own command the same way: at once if the command holds the
system, otherwise queued over the network (bounded, with the same expiry); a fresher sighting rides on the
one already on its way.

## 6. Delivery

No new communications simulator: delivery reuses the campaign's route graph (`world.routeHops`).

| channel | when | delivered |
|---|---|---|
| `local` / 0 hops | sender and recipient in the same system | the same day |
| `network` | across the chart | sent + ⌈hops ÷ 2⌉ days, at least 1, at most 5 |
| `broadcast` | a distress call | as network from where the people are |
| `override` | authored events and the debug panel (labelled as such) | at once |

A recipient with no route yet leaves the report **pending**; it is retried daily until delivered or it
expires after 30 days. A hull recipient that is gone makes it undeliverable. Pending reports are part of
the saved book and survive save/load with their ID, payload and state.

Where reports come from in the simulation: the distress call (beacon → hearers); the crew's findings and
survivor reports (hull → own command); a command's orders to the crew it sends (override: the briefing is
the orders); a command forwarding its record to its own vessels at work (network, once per version; not to a
vessel it has a missed check-in from); a search group's hails to vessels present (local, overdue notice
only). Everything else — one power telling another — is an explicit send (authored or debug).

**Compartments:** a secret pact reaches an actor only by an explicit briefing from a briefed sender (§5).
An unbriefed sender cannot send what it does not hold, and a briefed one sends it only when it chooses to.

**Pilot configuration and old saves:** the pilot configuration carries a version
(`DOCTRINE_CONFIG_VERSION`). A book saved under an older one takes the current defaults on load, keeping
only whether doctrine was switched on — so a phase 1 save gets the phase 2 live set. Within a version a
changed configuration (debug, tests) stands.

## 7. Reevaluation

Every open incident is evaluated daily for everyone who knows of it (plus watched commands, designated
relief ships and vessels at work). When an observer's verdict on the **same** incident changes, a
reevaluation record is kept (`book.doctrine.reevaluations`, bounded to 80):
`{day, actor, incident, from, to, cause, objective}`, where from/to are `ignore_unknown`, `record_only`,
`defer:<response>`, `live:<response>` or the shadow proposal, and the cause is the knowledge record's last
change with the facts gained or lost, or the capacity change.

Examples the gates show: Vulcan relief `record_only → live:rescue` on a survivor report
(`+survivors_known`); Klingon command `record_only → investigate` on findings linking Klingon losses
(`+linked_own_losses`, shadow); Tholian command `defer:protect → live:protect` when the next tender sails;
a Delpin explorer `defer:investigate → live:investigate` once its current objective closes. No response
change ever creates a second incident.

## 8. Live and shadow

| profile / role | response | this round |
|---|---|---|
| Romulan commander | investigate own overdue asset | **live** (phase 1) |
| Delpin explorer | investigate recoverable evidence | **live** (phase 1) |
| Vulcan relief | rescue on a survivor report | **live** |
| Ferengi civilian | reroute a threatened contract | **live** |
| Tholian commander | protect a threatened project (escort of its next load) | **live** |
| every other profile/role/response | whatever the rules propose | shadow (logged, never acted on) |
| war attacks, invasion, occupation, covert concealment/extraction, pirate extortion, Hirogen hunts, Borg acquisition, broad border enforcement | — | shadow |
| Gorn | — | dormant |

## 9. Movement

Every live doctrine mission travels strategically on the accepted stack: the vessel keeps its vid,
moves one jump a day along its itinerary, and every blockade that bears on it at the next system is run
through `resolveBlockadeRun` (escorts together with their charge). A disabled doctrine vessel stays where it
lies as a repairing hull (§6) and its crew may call for help; a destroyed one is lost with its vid retired;
nothing replaces either. An investigation or rescue that can no longer arrive and work before its deadline
(turned back once too often, say) is aborted rather than sailed out.

A hull disabled on arriving at a stop (a blockade run into it, say) and repaired there reports in from
that stop: its milestone is met then, late if need be, so a load delivered by a damaged tender counts and
no false overdue incident is raised. A reroute supersedes every expectation of the old plan, missed ones
included; only the current plan's milestones can be met.

## 10. Objective priority and conflict

A vessel on a job keeps it. Its current live objective is authoritative unless the table allows the new
response to pre-empt it:

| vessel's current job | may be pre-empted by |
|---|---|
| exploration, patrol (routine) | investigate, rescue |
| return (going home) | investigate, rescue, protect |
| investigation | **rescue** — the one emergency rule: lives before evidence |
| rescue, escort, delivery, construction | nothing |

A pre-emption ends the old objective at once (aborted, `objective_cancelled`, with the note
`pre-empted by <response> for <incident>`) and records the conflict (`decision: preempted`); breaking off a
routine job (a survey, a patrol, the way home) is recorded the same way. An actor already running an
objective on an incident is not "deferred" on it again (no self-conflicts, no inflated deferral counts).
The investigation → rescue rule cannot occur live this round (the only live rescuer, Vulcan relief, never
investigates live); the pure gate exercises it with a test-only live entry.
Anything else **defers**, with the reason in the evaluation and in `book.doctrine.conflicts`:
`defer:investigate — vessel committed to investigate objective 12`. The commitment is checked before the
operation budget, and a job the vessel may break off does not count against the budget it replaces. A
command never takes a committed vessel (it assigns spare ones only). Self-defence is not an objective: it
belongs to the tactical engine and is never affected.

## 11. What the captain sees

Only what reaches the captain through a real source at that system (local, relay, fleet, rumour — the
phase 1 tiers):

| event | report |
|---|---|
| a call | `Distress call received — refugee transport` (freighter, construction tender, patrol ship, survey ship) |
| a relief ship sails | `Vulcan relief vessel responding.` |
| a freighter reroutes | `Ferengi traffic rerouted after missed delivery.` (or `… rerouted.` when the trouble was someone else's) |
| an escort is assigned | `Tholian escort assigned to construction convoy.` (or merchant convoy) |

One line each; no reasons, no profiles, no culprit.

## 12. Cheats & Debug

Header: `Source package status: DESIGN_ONLY_NOT_LOADED_BY_GAME · Runtime integration: Phase 2`.

Added views: objectives with charge/escort state and reroute plans; **reports** pending and delivered with
sender, recipient, channel, hops, provenance, confidence, what they carry and their state; **reevaluations**;
**conflicts and pre-emption**; **contracts and projects**; a counts line. The relay form now chooses the
payload profile and the channel (override or network). Codes:
`doctrine delivery <faction> <system>`, `doctrine project <faction> <depot> > <site>`,
`doctrine lose [assignment|latest] [disabled] [silent]`,
`doctrine relay <incident> <from> <to> [full|overdue_notice|findings|survivor_report] [override|network]`.

## 13. Measurements

`test:doctrine:p2` MEASURE: 400 days, every pilot generator on, a loss every 17 days (silent and calling,
destroyed and disabled). Counts from the latest run (`logs/doctrine-phase2-pure-log.json`):

| count | |
|---|---|
| incidents created (overdue / distress) | 17 (10 / 7) |
| duplicate incidents prevented | 6 |
| reports sent / delivered / expired / undeliverable | 59 / 59 / 0 / 0 |
| reevaluations | 157 |
| live objectives created | 9 |
| deferred responses (on change) | 113 |
| objectives completed / aborted / expired | 7 / 2 / 0 |
| contracts opened | 36 |

Saved doctrine state over the run (bytes of `book.doctrine`): 148K (day 50), 258K (100), 295K (200),
305K (300), 346K (400). The 400-day sample is still rising slowly at its end; an independent 1000-day run
held at about 300–357K, with incidents at the history bound (20) and messages at 60: delivered reports are compacted after 10 days and kept to 60,
verdicts not renewed for 60 days leave the live table, a lost vessel's knowledge is dropped, incidents a
power writes off are closed and leave the books past the history bound. This is a stress sample, not a
balance claim.

The shadow comparison (`screenshots/shadow-comparison-phase2.json`) gives, for each evaluation in the
in-game scenarios: actor, incident, existing (pre-doctrine) activity, doctrine proposal, matched rule,
live, objective, reason, known facts and capacity.

## 14. Still deferred

Broad military doctrine; autonomous war declarations; invasion and occupation doctrine; covert
Dominion/Cardassian/Breen operations; pirate extortion; Hirogen hunting; Borg assimilation; Gorn activation;
the Tactical Cube; broad culture rollout; new treaty terms; economic settlement of contracts (payment,
penalties, reputation).

Future treaty mechanics, documented only: demilitarised corridors and zones, inspections, tribute,
reparations, basing rights, transit guarantees.

Carried forward:
- evacuation convoy timing still uses the simplified one-system-per-day progression rather than actual
  strategic leg durations;
- strategic AI outside doctrine-enabled missions does not universally use the blockade-running engine;
- strategic interception → tactical combat handoff remains deferred;
- the escort's command reads the escort's own loss or disablement directly (not through a missed
  milestone); acceptable while escorts sail with their charge in their own space, revisit when escorts
  range further;
- one escort objective per (actor, incident): a project whose later loads are threatened again needs a new
  incident (a new overdue tender) to be escorted again;
- a disabled hull repairs itself in a few days under the campaign's §6 rules, so a crew aboard a hulk may
  sail on before a rescue arrives (the distress incident then resolves `vessel_under_way`).
  **Superseded in phase 3** (DOCTRINE-RUNTIME-PHASE3.md §1): a disabled hull stays disabled until a real
  recovery brings it into a yard; `vessel_under_way` now follows only such a recovery and repair.

## 15. Tuning (phase 2 additions; campaign days, first-pass values)

`tradeEveryDays 12`, `tradeHops 3`, `deliverySlackDays 3`, `contractGraceDays 3`, `projectEveryDays 30`,
`projectDeliveries 2`, `projectDays 30`, `closedContractLimit 12`, `escortDeadlineDays 20`,
`networkHopsPerDay 2`, `maxNetworkDelayDays 5`, `messageExpiryDays 30`, `messageHistoryLimit 60`,
`conflictLimit 60`, `reevaluationLimit 80`. Cargo jobs spend one day loading.
