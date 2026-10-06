# Faction doctrine runtime — phase 4

DTG 291200ZSEP26 · stacked on the frozen phase 3 candidate `6e9a1d5`.

Phase 4 is about enforcement, compliance, surrender and bounded predation. It teaches the AI to **stop
when the other side complies**. Every demand in this phase follows the same pattern:

- It rests on a real authority.
- It has to reach the target before anything counts.
- The target may comply or refuse.
- Any response is proportionate and climbs one stage at a time.
- It ends when the demand is satisfied.

Most encounters never become combat.

This phase does not:

- declare wars, plan invasions, occupy anything, or plan a war strategy;
- add covert strategy, Borg assimilation, Hirogen hunting or Gorn doctrine;
- add a Tactical Cube, a pirate economy or prisoners of war;
- expand treaties (DMZs, inspection regimes, tribute, reparations, basing and transit rights are future items);
- make any strategic-movement backlog changes (§14).

The source package is unchanged: `docs/doctrine/bm1-faction-doctrine.v0.2.1.json`, status `DESIGN_ONLY_NOT_LOADED_BY_GAME`.

Code:

- `src/doctrine-campaign.mjs` has the campaign-day layer: breaches, enforcement, surrender, predation and debug summaries.
- `src/campaign-strategy.mjs` makes a surrendered hull unavailable and never repaired while it holds.
- The Phase 4 block of `src/main.js` has the loaded-scene layer:
  - the captain as the target of enforcement and of a pirate's demand;
  - surrender in a scene;
  - the fire-gate refusals for surrendered vessels;
  - the order panel, save/load, reports and debug tables.

| gate | script | result |
|---|---|---|
| phase 4 pure | `npm run test:doctrine:p4` | 29 groups (regressions 1–30 except 10, three integrated scenarios, review corrections, 400-day measurement) |
| phase 4 in-game | `npm run test:doctrine:p4:ingame` | 22/22 (baseline-defect 1/1, new-feature 19/19, preservation 2/2); 6e9a1d5: baseline-defect 0/1, preservation 2/2 |
| phase 4 long run (measurement) | `npm run measure:doctrine:p4` | 500 days × 3 runs of the real game (§12) |
| phases 1–3 pure / in-game | `test:doctrine`, `:p2`, `:p3` (+`:ingame`), `test:disabled-hulls`, `test:disabled-hulls:crew` | 28 / 27 / 30 pure; 13 / 11 / 16 in-game; 6/6; 7/7 |

The one **baseline defect** is P4-PIRATE-DEMAND-FIRST. On 6e9a1d5, a pirate within weapon range opens fire
on a captain who was never asked for anything and never refused. It fails there on its own assertion
("the pirate fired with no demand and no refusal").

---

## 1. Two layers, one rule

| layer | clock | who is the target | where |
|---|---|---|---|
| campaign (strategic) | campaign days | NPC strategic hulls on doctrine assignments (merchants, transports, explorers, projects); persistent vids | `doctrine-campaign.mjs` |
| loaded scene (tactical) | the system's local frame clock (`state.localDoctrine.clockMs`, bounded frame delta, saved) | the captain; NPCs in the scene (surrender) | `main.js` Phase 4 block |

The existing checkpoint (`issueSecurityOrder` / `respondToSecurityOrder`) is **unchanged**. A refusal
there is still a record, not a target. The in-game check `P4-REFUSAL-RECORD` holds on both builds.

What Phase 4 adds is the doctrine that may come after that refusal, *if the captain stays inside restricted
space*. That doctrine is a final warning, then an interception, and then — only with real authority — an
engagement.

## 2. Enforcement objectives (PART 1)

On the campaign layer, an enforcement objective is kept in `db.objectives` with `kind: 'enforcement'`:

| field | content |
|---|---|
| `id` | stable, `…:doctrine-obj:N` |
| `actor` / `assigned` | enforcer `hull:<id>` and its vid (never re-issued) |
| `enforcerKind` | `area patrol` (breaks off its cycle) or `security picket` (a ready armed hull at the world) |
| `target` | `hullId`, `vid`, `polity`, `assignmentId`, `systemIndex`/`locationId`, `class` (exempt/unknown/warFlag/independent/other), `identity` (`known`/`unknown`) and `identitySource`, `cargo: 'unknown'` until inspected |
| `authority` | `source` (`security_policy` or `formal_war`), `detail`, `jurisdiction`, `war` key, `previous` when downgraded |
| `demand` | `type` (`leave_area` / `halt_identify` / `inspect`), `decision`, `issuedDay`, `revisions` |
| `comms` | `state` (sent → received → complied), `sentDay`, `receivedDay`, `hails`, `unreceivedDays`, `log[]` |
| `response` | `state` (awaiting / comply / refuse / flee / surrender / unable_to_comply), `day`, `history[]` |
| `escalation` | `stage` 0–4, `name`, `refusals`, `notice {warn, repeat, interceptDays}`, `history[]` |
| `deadline` | `enforceDeadlineDays` (6) |
| `resolution` | `status` + `reasons` + `note` (§9) |

**No duplicates.** Visits are keyed by authority, world and vid (`db.visits`), with continuity across days.
A visit gets at most one objective per episode. Later days count as `enforcementRepeatPrevented`, never as
a new demand. A new episode needs the vessel to have left and returned.

On the loaded-scene layer, `state.localDoctrine.enforcement` holds `{id, zoneId, epoch, episode, authority,
stage, refusals, notice, comms, compliance, deadlineMs, interceptorId, history, closed}`. There is one per
zone, authority epoch and visit episode.

## 3. Enforcement authority matrix (PART 2)

| authority source | who | what it permits | what it never permits |
|---|---|---|---|
| **published security policy** of the world's *controller* (`FACTION_BORDER_POLICIES`, authored checkpoints, delegated terms; read via `world.borderPolicy`) | the controller's own patrol or picket **at that world** | demands for the policy's decision about the vessel's class: `closed` → leave; `challenge` → halt/identify (or inspect where the policy includes inspection); the ladder; force only after full notice and only if the doctrine's `enforcement` mode passes | anything at another power's world; pursuit past the boundary; inspection by a foreign patrol |
| **formal war** (the model's own `relation === 'war'` with the target's side, re-checked daily) | the same enforcer | the `war` engagement mode, still after warning and repeat (§5) | anything after a ceasefire or peace (§10) |
| witnessed aggression, escort/defence obligation | Phase 3, unchanged | defence and return fire | — |
| **pirate role** | the authored pirate group of a pirate-held world | bounded extortion in its haven and the unclaimed systems next to it (§8) | anything for anyone else; any formal state |
| static hostility (`hostile` flags, opposed factions) | — | **nothing** | — |
| same flag | — | exempt from that world's policy; **not** a shared command | — |

Jurisdiction follows control: `borderPolicyAt` returns a policy only when the policy's authority is the
world's controller. The policy is read against the campaign model's own view of control (the world the day is
settled with), so a sixteen-day jump and sixteen single days read the same policy on the same day — the
full suite's `EQUIV` check caught an earlier version that read the engine's control mid-jump. The captain's own holdings and pirate havens publish none. Authority is re-checked
every day before anything else. If a policy is withdrawn or opened, the objective closes as
`objective_cancelled`.

## 4. Communication and the demand/compliance state machine (PARTS 3–4)

```
            ┌────────── not received (no transponder reply, comms down, disabled) ──────────┐
            │  counts as NOTHING: the hail repeats; 2 unheard days → one stage up, never a  │
            ▼  refusal and never a detention; the first demand heard is the warning        │
  observe ─► SENT ──received──► RECEIVED ──response after enforceResponseDays──► comply ─────────┐
                                    │                                               refuse / ignore ─► ESCALATE (one stage)
                                    │                                               flee (stage<3) ─► left alone to the boundary
                                    │                                               surrender ───────► SURRENDER (§6)
                                    └──► the vessel leaves S at any time ──► CLOSED (left jurisdiction)

  comply, per demand:
    leave_area     reroute out (§4a) → complying → closes when it is gone (compliance_verified + target_left_jurisdiction)
    halt_identify  identity known → re-classed; if now barred → demand revised to leave; if inspection → inspect; else cleared
    inspect        only what an actual inspection sees (the non-concealed manifest); contraband → demand revised to leave
```

- **Unreceived is never a refusal.** Only a received demand can be refused. Receipt needs the vessel to
  be able to hear (not disabled, comms up). On the loaded scene, "received" means the panel is actually on
  the captain's screen. A final warning that never reached the screen is sent again (up to 3 times) and is
  never counted.
- **An inspection request reveals nothing.** Hidden (concealed) cargo is not found by asking.
  `o.inspection.observed` lists only what an inspection sees. `concealedFound` is always false this round.
- **§4a. Leaving keeps the rest of the voyage.** The vessel keeps every later stop that is not the world it
  was ordered out of, together with that stop's milestone. It reaches them by routes that avoid that world
  (review correction R1). The leave order is spent when the objective closes with the vessel outside.
- **Complying then staying is not compliance** (loaded scene). "Complying" opens a 45 s window. If the
  captain is still inside when it ends, the word lapses and the ladder resumes where it was.

## 5. Escalation ladder (PART 5)

| stage | name | campaign | loaded scene |
|---|---|---|---|
| 0 | observe | vessel seen; class and identity recorded | — |
| 1 | warn | demand sent (it counts once received) | the checkpoint refusal itself (unchanged) plus 8 s |
| 2 | repeat | demand repeated, escort-out offered | **final warning** panel: Comply / Refuse / Surrender, 30 s |
| 3 | intercept | enforcer alongside; the vessel is **held** (only once the demand has been heard) | nearest own patrol or defender intercepts and shadows at 320 units; **no weapons**; 20 s |
| 4 | engage | only if warning **and** repeat were both heard **and** `D.intent(patrol) === 'attack'` in the `enforcement` mode (identity known, serious breach attributed, jurisdiction valid, order active, notice complete) or the `war` mode under formal war; strikes to **disable** (hull never below 1); re-checked daily | the interceptor may fire through the unchanged fire gates; re-checked every pass (authority, interceptor still own-side, not surrendered, not disabled); 45 s |

- Each refusal climbs exactly one stage. Compliance de-escalates: the engaging interceptor drops back to
  intercept. Nothing resets on a tick.
- Without full notice there is no force, whatever the authority. The demand is repeated instead.
- A strike never lands on a surrendered or disabled vessel.

## 6. Surrender lifecycle (PART 6, PART 13)

```
  (an explicit decision: the target's answer, a losing raid, a civilian crew facing pirate guns,
   a cornered pirate crew in a scene, or the captain's own button — never read off a low hull)
        │
        ▼
  SURRENDERED ── h.status 'surrendered', h.surrendered {to, acceptedBy, day, systemIndex, reason,
        │         objectiveId, holdUntil, priorStatus}; same vid; defendingAt cleared
        │   • the objective that took it closes: surrender_accepted (no refire, no reopen)
        │   • picked for nothing: hullUnavailable; no enforcement or predation selects it; no strike lands on it
        │   • never repaired while it holds (advanceRepairs skips it)
        ▼  holdUntil (surrenderHoldDays = 2)
  RELEASED ── status restored (repairing if disabled); an enforcement target is routed out of that
              jurisdiction; a free hull in foreign space goes home. The visit episode continues,
              so no new demand opens on it at that world.
```

On the loaded scene:

- **NPC** (`surrenderNpc`): hostility is cleared. The ship holds, never fires (`fireNpcWeapon`,
  `npcPhysicalFireFacts.weapon_usable`), is never an attacker (`isNpcSystemAttacker`), and is never an
  escort target, even on order. It leaves the raid count (`updateFleetAttacks`). After 20 s it is released
  and leaves the system.
- Automatic NPC surrender in a scene is limited to cornered pirate crews: hull 20% or less, under
  pressure, one seeded decision per encounter.
- **Captain** (the Surrender button): the captain holds position with weapons cold for 10 s. No NPC and
  no station fires on a surrendered captain. The enforcement closes as `surrender_accepted`. On release,
  nothing reopens for the rest of the visit.

Save/load: a strategic surrender is saved exactly (`P4-18`, in-game `P4-STRAT-REFUSE-SURRENDER`), and so is
the captain's. NPCs in a loaded scene are not persisted by the engine at all (a load regenerates the
scene), so neither is an NPC's surrender. The pirates' cooldown on the captain is keyed to the system's
crew, so it survives that (§8).

There is no prisoner economy. A surrendered crew is simply let go after the hold.

## 7. Disabled vessels (PART 13)

Phase 3's rule stands: disabled means disabled until recovered, and a repaired hull waits for a crew.

- A disabled target cannot comply by moving. Its enforcement closes as `target_unable_to_comply`, both on
  the campaign and for the captain (`P4-LOCAL-DISABLED`).
- A disabled vessel is never selected by enforcement or predation, and no enforcement strike is aimed at
  one.
- Pirates take the cargo from a disabled hulk (`takeFromHulk`) and do not strike it again.

## 8. Predation lifecycle (PART 7)

```
  authored group per pirate-held world (pirateHaunts 'auto'), vid `${seed}:pirate:<loc>`, never replenished
  area = the haven + unclaimed/pirate neighbours (a haven taken by a real power disperses its group)
        │  every pirateDemandEveryDays, if idle
        ▼
  choose a plausible target: a civilian vessel on a doctrine assignment in the area, not escorted, not
  disabled, not surrendered, not on cooldown (predationRepeatPrevented); priced on what is SEEN — the
  hull's cargo class (60 / 120 / 240), never the hold ("observed … hull (hold unseen)")
        │  D.react(pirate, prey_sighting) must be exploit_cargo, and the profile live
        ▼
  DEMAND sent ─► received ─► answer:  pay / surrender cargo ─► paid → CLOSED cargo_received; the group lurks
        │                          refuse / run ─────────────► ATTACK PHASE
        └── deadline (never received, or no answer) ───────────► ATTACK PHASE ("timed out")
  ATTACK PHASE: D.intent(pirate raider) === 'attack' (predation mode), bounded to predationAttackDays;
    the crew may surrender its cargo (explicit); a disabled hulk is looted; the pirates break off when
    hurt (recovering at the haven) and close as attacker_disengaged when the window ends
  CLOSED on: cargo_received · target_escaped (left the area) · attacker_disengaged · target_destroyed ·
    deadline · role invalid (group lost/dispersed); history kept; cooldown pirateTargetCooldownDays on that vid
```

On the loaded scene, a pirate within 2.4× weapon range of the captain, with the captain on its sensors,
hails: "Transfer N latinum or surrender cargo."

- It is not on a raid, and not on cooldown for this system's crew.
- The price follows the captain's hull class, never the hold (`P4-PIRATE-PAY`).
- The panel offers PAY / SURRENDER CARGO / REFUSE / RUN.
- While the demand is open, the pirate shadows the captain and fires at no one. It does not go after
  installations.
- It answers fire: shooting at it is a refusal, and return fire follows (`P4-RETURN-FIRE`).
- **Pay or cargo:** it stands down and leaves.
- **Refuse, run or timeout:** a bounded 30 s attack, closed early if the captain gets beyond 3.4× range.
- **After closing:** a 5-minute cooldown on this system's crew.

A sworn enemy (standing ≤ −50) is attacked as before, with no demand.

## 9. Termination (PART 9)

| objective | closes on (reasons) |
|---|---|
| enforcement | compliance (`compliance_verified`, with `target_left_jurisdiction` for leave), exit (`target_left_jurisdiction`), surrender (`surrender_accepted`), authority removed (`objective_cancelled`: war over and policy permits, policy gone or opened, jurisdiction lost, switched off), target lost (`target_lost`), `target_unable_to_comply` (disabled, or surrendered to another party), deadline (`objective_deadline_reached`), cancelled |
| predation | paid or cargo (`cargo_received`), escape (`target_escaped`), disengage (`attacker_disengaged`), deadline, destroyed (`target_destroyed`), role invalid (group lost or dispersed; predation switched off) |

On closing:

- The enforcer's `defendingAt` is cleared, and a patrol resumes its cycle.
- The target's hold and spent leave order are cleared.
- The pirate group returns to lurking.
- A closed objective issues no orders (P4-30).

Switching doctrine off (or the runtime failing to load) releases all of this: enforcers stand down, pirate
groups lurk, and surrendered hulls are let go (review correction R2).

## 10. Formal war, ceasefire and peace (PART 10)

- A ceasefire or peace ends war-only enforcement **that day**. If the local policy still bars the vessel,
  the objective continues under `security_policy`. It restarts at stage 1 with its own warning and a new
  deadline, carrying nothing over from the war (P4-13). If the policy permits the vessel, the objective
  closes (P4-12).
- Surrender neither creates nor ends a war. Piracy creates no formal state. Local hostility, security
  enforcement and formal war stay separate. No Phase 4 code writes `warStates`, relations or diplomacy
  (checked by source search). The long run compares the war record with Phase 4 on and off (§12).

## 11. Knowledge boundaries and fire gates (PARTS 11–12)

**Knowledge boundaries:**

- An inspection request is not cargo knowledge.
- A warning does not identify an unknown ship. Identity comes only from a transponder or an answered
  halt/identify.
- Pirates price on hull class only.
- Pacts stay compartmented (Phase 2 rules, unchanged).
- Player reports appear only where the captain has a source (`reportDoctrineTrace`). They cover
  interceptions, strikes, surrenders and pirate demands and attacks. Routine warnings are not news.

**Fire gates are unchanged.**

- Enforcement engagement goes through `D.intent` → modes, and on the scene through `shouldNpcTargetPlayer`
  → `fireNpcWeapon` → `fleetFirePermitted`.
- The only additions refuse fire:
  - on or by a surrendered vessel;
  - by a pirate holding a demand;
  - by a station on a surrendered captain.

## 12. Measurements (not a balance claim)

The default campaign was run for 500 days, three times on the same seed:

- **on**: Phase 4 on;
- **off**: `enforcementResponses` and `predation` false;
- **haven**: Phase 4 on, plus a Delpin transport shuttling through Pirates Haven whenever free. The
  default campaign's routine traffic never passes the haven, so the default run makes no pirate demands.

See `doctrine-phase4-longrun.json`.

**Headline figures after 500 days:**

| | on (default) | haven (+ shuttle through Pirates Haven) | off |
|---|---|---|---|
| enforcement objectives created | 76 | 80 | 0 |
| complied (left under the demand) | 29 | 30 | — |
| left without complying (dwell over, no answer yet) | 47 | 50 | — |
| refusals | 8 | 9 | — |
| flights | 2 | 0 | — |
| highest stage reached (stage 2 / 3 / 4) | 8 / 0 / 0 | 9 / 0 / 0 | — |
| enforcement strikes | 0 | 0 | — |
| expired / cancelled by authority | 0 / 0 | 0 / 0 | — |
| still active at day 501 | 0 | 0 | — |
| repeat demands prevented (same visit) | 44 | 45 | — |
| shadow (non-live security, logged only) | 20 | 11 | — |
| surrenders (total / released) | 0 / 0 | 1 / 1 (a civilian crew gave its cargo to the pirates) | — |
| pirate demands | 0 (no routine traffic reaches the haven) | 16 over 97 shuttle trips | 0 |
| paid / ran | — | 13 / 5 | — |
| predation strikes | — | 8 | — |
| targets destroyed | — | 1 | — |
| repeat extortion prevented (cooldown) | — | 235 | — |
| repeat extortion that got through | — | 0 | — |
| every demand priced at | — | 120 (the shuttle's hull class) | — |
| patrols returned to their cycles | 12 | 13 | — |
| max active enforcement at once | 2 | 2 | — |
| longest enforcement (days) | 2 | 2 | — |
| enforcer days outside its jurisdiction (pursuit) | 0 | 0 | — |
| most hails in one visit (warning loop watch) | 2 | 2 | — |
| strikes after a surrender | 0 | 0 | — |
| surrendered vessels picked as targets | 0 | 0 | — |
| saved campaign (bytes; doctrine part) | 738,253 (364,026) | 772,119 (397,861) | 655,073 |
| saves in all three slots | ok | ok | ok |

*Objective status counts in the saved book are bounded (`closedLimit`), so the created/complied figures
come from the counters.*

**Doctrine-created formal wars: 0.**

- No Phase 4 code touches war state.
- The war record with Phase 4 on and off is **identical in every war start through day 461** (16
  declarations). In the on run, the strategic war AI makes one extra declaration on day 462
  (Hirogen–Promelli). Neither of those powers has a live Phase 4 role.
- Peace dates differ in three places: two by 1–5 days, and one peace (Breen–Klingon, day 477) that
  the off run had not yet reached by day 501. All are outcomes of the campaign's own war AI, whose inputs
  (hull positions and assignments) diverge once enforcement has moved ships. They are not doctrine-created.

**Watch list:**

| watch item | observed |
|---|---|
| endless warning loops | none (most hails in one visit: 2) |
| pursuit out of jurisdiction | 0 enforcer-days |
| everything becoming combat | 0 enforcement strikes in 156 objectives |
| repeat extortion | 0 inside the cooldown |
| surrender not stopping fire | 0 strikes after a surrender |
| cargo or knowledge leaks | none (every demand priced on the hull class) |

Pure 400-day measurement (fixture galaxy with published policies at every world, area patrols, merchants,
relief and a haven): 85 enforcement objectives, 47 complied, 11 refusals, 38 left without complying, 11
reached stage 2, none reached stages 3–4, 0 strikes, 61 lawful transits, 66 repeats prevented, 1 surrender
(released), 11 pirate demands, 8 paid, 4 runs, 6 strikes, 30 repeats prevented, 29 patrols returned, at
most 3 active, longest 2 days, **0 formal wars created**.

## 13. Live vs shadow (PART 8)

| actor | response | this round |
|---|---|---|
| Romulan, Klingon, Terran security (patrol role) | `enforce` | **live** (campaign and scene) |
| existing patrol/defender roles (Phase 3) | investigate / defend / raid-under-war | live, unchanged |
| existing escort (Phase 2) | protect | live, unchanged |
| one pirate raider profile (`pirate` / `raider`) | `exploit_cargo` | **live** (campaign groups at pirate havens; scene pirates) |
| any side | surrender | live (explicit) |
| Cardassian, Dominion, Breen, other security | `enforce` | shadow (logged: `enforcementShadow`) |
| Hirogen hunting, Borg, covert Dominion/Cardassian/Breen, occupation, invasion, war creation | — | shadow / not implemented |

## 14. Deferred

The following are deferred:

- war declarations, invasion, occupation and broad war planning;
- covert strategy;
- Hirogen hunting, Borg, Gorn and the Tactical Cube;
- the pirate economy and prisoners of war;
- treaty expansion (DMZs, inspection regimes, tribute, reparations, basing, transit).

**Next round (not in this phase):** the strategic-movement backlog. It covers evacuation leg timing,
putting non-doctrine AI on the shared route/blockade path, and removing special-case movement. Tactical
handoff and towing come later.

## 15. Player choices (PART 14) and debug (PART 15)

**Player choices:**

| encounter | panel |
|---|---|
| security after a standing refusal | "Romulan Orbital Authority: Final warning. Leave restricted space." — COMPLY / REFUSE / SURRENDER; then "Heave to…" — COMPLY / SURRENDER; while complying — the countdown and SURRENDER |
| pirate | "Nausicaan Raider: Transfer 120 latinum or surrender cargo." — PAY / SURRENDER CARGO / REFUSE / RUN |
| surrendered | "Holding position. Awaiting release." |

**Cheats & Debug → Faction doctrine**, header "Runtime integration: Phase 4":

- **Enforcement objectives**, as their chain: known target → jurisdiction · authority → demand → comms →
  response (and inspection) → escalation (notice, engage check) → termination.
- **Pirate groups** (cooldowns and history).
- **Predation objectives.**
- **Surrenders** (holding / released).
- **Local encounters** (loaded scene).
- **Enforcement log.**

Codes: `doctrine enforcement on|off`, `doctrine predation on|off`, `doctrine pirate demand` (override),
`doctrine surrender nearest` (override), `doctrine surrender vessel <faction> <hull> [to]` (override).

## 16. Tuning (campaign days / scene ms, first-pass values)

**Campaign (days):**

| setting | value |
|---|---|
| `enforceDeadlineDays` | 6 |
| `enforceResponseDays` | 1 |
| `maxEnforcementPerPolity` | 3 |
| `surrenderHoldDays` | 2 |
| `raidSurrenderRatio` | 0.3 |
| `pirateStrength` / `pirateMaxHull` | 900 / 1500 |
| `pirateDemandEveryDays` | 5 |
| `pirateTargetCooldownDays` | 30 |
| `predationDeadlineDays` | 2 |
| `predationAttackDays` | 2 |
| `pirateRecoverPerDay` | 0.05 |

**Scene (ms):**

| setting | value |
|---|---|
| `LOCAL_ENFORCE_DELAY_MS` | 8000 |
| `LOCAL_FINAL_WARNING_MS` | 30000 |
| `LOCAL_INTERCEPT_MS` | 20000 |
| `LOCAL_ENGAGE_MS` | 45000 |
| `LOCAL_COMPLY_WINDOW_MS` | 45000 |
| `PLAYER_SURRENDER_HOLD_MS` | 10000 |
| `NPC_SURRENDER_HOLD_MS` | 20000 |
| `PREDATION_RESPONSE_MS` | 25000 |
| `PREDATION_ATTACK_MS` | 30000 |
| `PREDATION_COOLDOWN_MS` | 300000 |

**Scene (weapon-range factors):**

| setting | value |
|---|---|
| demand range | 2.4 |
| escape range | 3.4 |

## 17. Review corrections (independent review before packaging)

| # | finding | correction | evidence |
|---|---|---|---|
| 1 | a hostile station kept firing on a surrendered captain | stations skip a surrendered captain | code |
| 2 | "Comply" without leaving froze the local ladder | 45 s window, then the ladder resumes; panel shows the countdown | in-game `P4-LOCAL-COMPLY-LAPSE` |
| 3 | doctrine off / unavailable stranded pirate groups and surrendered hulls | release on switch-off; groups self-heal a dangling objective | pure `P4-R2` |
| 4 | a leave order suppressed later holds elsewhere | a hold yields only to a leave order for the same jurisdiction; spent orders cleared | pure `P4-R1` |
| 5 | complying dropped later stops (deliveries) | the later stops and milestones are kept, routed around the world | pure `P4-R1` |
| 6 | unheard demands jumped to intercept and detained | one stage per two unheard days; no hold before a demand is heard; force only after warning and repeat heard | pure `P4-3` |
| 7 | an unseen final warning counted as a refusal (and Refuse counted twice) | resent, never counted; counted once | code |
| 8 | scene surrender held forever | 20 s hold, then the crew leaves | code |
| 9 | pirate cooldown reset by a new spawn | cooldown keyed to the system's crew | in-game `P4-PIRATE-CREW-COOLDOWN` |
| 10 | raiding pirates stopped to extort | raiders on a raid make no demands | code |
| 11 | strikes could reach a vessel surrendered to another party; a captured haven kept extorting | no strike on surrendered/disabled; enforcement closes `target_unable_to_comply`; the group disperses | code |
| 12 | scene engagement not re-checked | re-checked every pass | code |
