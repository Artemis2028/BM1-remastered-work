# Faction doctrine runtime — phase 3

DTG 281338ZSEP26 · stacked on the frozen phase 2 candidate `6f9e499`.

Phase 3 does two things.

1. **Disabled hulls stay disabled** until something real recovers and repairs them. Campaign days alone
   never restore a disabled strategic hull. Crew survival, hull recovery and hull repair are three separate
   things with three separate causes.
2. **Bounded military execution.** Doctrine may *carry out* patrol, defence and war-raid work, but it never
   *manufactures authority*. Every military objective names the authority it runs under, is bounded in
   area and time, ends on stated terms, and stops acting the moment it is closed.

Nothing here declares war, invades, occupies, plans a strategy, or builds a fleet. Covert, pirate, Hirogen,
Borg and Gorn doctrine, war creation, occupation and invasion planning stay in shadow. The source package
is unchanged (`docs/doctrine/bm1-faction-doctrine.v0.2.1.json`, status `DESIGN_ONLY_NOT_LOADED_BY_GAME`).

Code: `src/campaign-strategy.mjs` (disabled hulls; raid strike and stand-down helpers), `src/doctrine-campaign.mjs`
(patrols, defence, raids, the military facts, bounded storage) and the doctrine block of `src/main.js` (the
tactical authority chain and the debug tables). Gates:

| gate | script | result |
|---|---|---|
| disabled hulls (pure, runs on the baseline too) | `npm run test:disabled-hulls` | 6/6 (baseline-defect 3/3, preservation 3/3); 6f9e499: 3/6 |
| phase 3 pure | `npm run test:doctrine:p3` | 30 groups |
| phase 3 in-game | `npm run test:doctrine:p3:ingame` | 15/15 (baseline-defect 2/2, new-feature 12/12, preservation 1/1); 6f9e499: baseline-defect 0/2 |
| phase 2 pure / in-game | `test:doctrine:p2`, `test:doctrine:p2:ingame` | 27 / 11 of 11 |
| phase 1 pure / in-game | `test:doctrine`, `test:doctrine:ingame` | 28 / 13 of 13 |
| long run (measurement) | `node scripts/doctrine-phase3-longrun.cjs` | 1000 days, real game |

---

## 1. Disabled hulls

### Baseline defect (reproduced on 6f9e499)

On 6f9e499 a disabled hull was an ordinary damaged hull:

- released from a job (status `ready`), the ordinary repair rule sailed it to the nearest own yard the next
  day and repaired it there — `STRANDED-DAYS` on 6f9e499: *"day 1: the hulk moved … 'Remus' !== 'Aldnas'"*;
- a disabled survivor of an operation that stood down was sent home with the others and repaired —
  `OP-SURVIVOR-STRANDED` on 6f9e499: *"Batos|-|disabled, Batos|-|operational"* where it was hit at Epsilon;
- an own yard repaired a hulk inside an active enemy blockade (`DH-3`).

Pure reproduction: `scripts/disabled-hull-test.mjs` (DH-1…DH-3 fail on 6f9e499 on their own assertions).

### The rule

A hull is **disabled** when `classifyDamage(hull, maxHull) === 'disabled'`. A disabled strategic hull:

- never sails, never joins anything, is never picked by planning, never counts as a local defender;
- keeps whatever job still holds it (an operation mid-battle, a doctrine assignment) — the job keeps its
  claim and releases it by its own rules; released, it becomes `repairing` (stranded), never `ready`;
- is repaired only once it is **in a yard** (`stranded.recovery === 'in_yard'`), by the ordinary yard repair;
- adds nothing to a world's defence, but is within a fight's reach: losses at an attacked world fall on the
  hulks lying there too (they can be finished off where they lie).

It is stranded the moment it is disabled, before anything else that day can pick it: `advanceStranded` runs
before the repairs, again right after the day's operations (a defender disabled in battle) and again after
the strategic operations (a blockade run). Evacuation, escort and blockade orders refuse a disabled hull.

The captain's own vessels are not touched (`player` is skipped): the engine owns them, and §6 (an
interrupted assignment resumes after repair; Stop remains a hold) is unchanged.

### State matrix (`hull.stranded`)

| part | states | what moves it | what never moves it |
|---|---|---|---|
| **crew** | `aboard` → `rescued` \| `lost` | `rescued`: a rescue objective reaches the hulk and takes them off (`rescueStrandedCrew`). `lost`: life support ends — the day after `crewUntil = since + crewSurvivalDays` (20) — effect `strandedCrewLost` | repair, recovery, the passage of days before `crewUntil` |
| **recovery** | `awaiting_recovery` → `recovering` → `in_yard` | an own yard in the same system, not under an applicable blockade: `recovering` at once, `in_yard` after `strandedRecoveryDays` (2), effect `hullRecovered`. An explicit recovery that happened (a tow, an authored salvage): `recoverStrandedHull` → `in_yard` (refused where there is no own yard, or the yard is blockaded) | days alone; a rescue; a yard under blockade (`recovering` drops back to `awaiting_recovery`). In the yard it stays through a later blockade; if the yard itself is lost (world taken, yard destroyed) it is back to `awaiting_recovery` |
| **repair** | disabled → operational | only `in_yard`, by the ordinary yard repair (existing capacity rules); effect `hullRestored`, `stranded` removed | anything while not `in_yard` |
| **write-off** | → `lost`, fate `written_off` | nobody aboard (crew rescued or lost) and nobody recovering it for `derelictWriteOffDays` (90) after the crew left; its identity is retired | a hulk with crew still aboard |

Towing is not modelled this round: a hulk away from an own yard stays `awaiting_recovery` — persistently.
That is the strategic problem the brief asks for: if rescue is 12 days away and life support lasts 8, the
crew are lost; the hull does not repair itself on day 3.

### Continuity

- The same hull and the same vid throughout; a stranded hull is one asset in one place (`STRANDED-DAYS`,
  `P3-D1/23`). The doctrine incident about it (overdue, distress) names that same vid.
- Save/load preserves `stranded` exactly; the continuation is identical (`P3-D2`, `P3-25`, in-game
  `STRANDED-DAYS` after save/load).
- A rescue takes the crew off and leaves the hulk where it is, `awaiting_recovery` (`P3-D4/24`,
  `DISABLED-RESCUE-TIME`).
- Recovered and repaired, its interrupted doctrine assignment resumes from where it stood (§6 behaviour for
  doctrine jobs) — `P3-D7/D8`.
- A disabled operation survivor stays where it was hit, never picked for another job (`P3-D10`,
  `OP-SURVIVOR-STRANDED`).
- The distress site's survivor window for a crew aboard a hulk is the hulk's life support (`crewUntil`), not
  the lifeboat window.

### 1a. Recommissioning: a repaired hull needs a crew (correction on 508198a)

508198a let a hull whose crew had been rescued or lost come out of the yard with `crew 0` and sail again —
patrol, defend, be planned, resume its doctrine job — on the campaign's combat crew floor. That is corrected:

| state | how it is entered | what it may do | how it leaves |
|---|---|---|---|
| **repaired, awaiting crew** (`hull.recrew`, status `repairing`, debug: `repaired_awaiting_crew`) | the yard repairs a stranded hull out of the disabled band, its crew were `rescued` or `lost`, and its crew is below `minOperatingCrew` (0.5 of a complement) — effect `hullAwaitingCrew` | nothing: it stays in the yard; no patrol, defence, raid, trade, evacuation, blockade, escort or operation picks it; it adds nothing to the world's defence; an interrupted doctrine job does not resume | the ordinary crew recovery at a world with shore leave (morale) raises its crew by `crewRecoveryPerDay` (0.02) a day; the day it reaches the minimum it is recommissioned (effect `hullRecommissioned`): `ready`, or back to its job (`assigned`) under §6 |

- A hull whose crew never left is repaired and back as before — no recrewing delay.
- Crew comes only from that existing recovery — never from the combat-strength floor. A yard world without
  shore leave cannot recrew a hull; it waits there.
- Same hull and vid throughout; save/load keeps the state exactly.
- From 0 at the default rate, recommissioning takes ~25 days after the repair (in-game `CREWLESS-REPAIR`:
  repaired day 15, recommissioned day 29).

Checks: `scripts/disabled-hull-crew-test.mjs` (`test:disabled-hulls:crew`, C1–C8; 508198a: 2/7) and the
in-game `CREWLESS-REPAIR` (baseline-defect; fails on 508198a).

Old saves: a hulk that 6f9e499 had already "sailed" to a yard (status `repairing`, already at the yard world)
is treated as lying at that yard and is recovered in two days; nothing else in an old save changes.

Earlier tests that moved a hulk home "repaired" (phase 1 test 30, phase 2 `P2-17b`) now say what they model:
a real recovery and repair, standing in for a tow. Phase 2's doc note that "a disabled hull repairs itself in
a few days" is marked superseded.

---

## 2. Authority: doctrine executes, it never manufactures

| authority source | where it comes from | what it permits | never from |
|---|---|---|---|
| **formal war** | the formal war record: `warAuthorityStamp(power, target)` — a formal war with the target's holder, not suspended by ceasefire; stamped with the war's key, instance and id | a raid ordered by campaign strategy; checked **every day**; a ceasefire, peace, or a new war instance voids it | hostility, attitude, alignment, a flag, a hull design |
| **defence obligation** | own world, a charge or contract of the power itself | defence of that world / charge against a verified attacker | somebody else's world; a same-flag captain's ship |
| **witnessed aggression** | the engine's `lastAggression*` records at this system | self-defence; defence of this system by its forces | a claim by a caller or doctrine |
| **security policy** | the captain's ROE for the captain's own systems (`return-fire` / `defend`) | captain's security ships: under `defend`, the engine's attacker test is the order | a faction's doctrine |
| **system defence, formal enemy** | a holder's forces in the holder's own system against a power it is formally at war with | engaging that enemy there | static hostility |
| **explicit order** | a campaign raid order (`orderRaid`), an authored/debug patrol order | the ordered task, bounded | doctrine itself |

`orderRaid` is refused without a formal war with the target's holder ("no formal war with the holder of
Epsilon"), refused if the vessel is not free, and runs in shadow where the profile's raider response is not
live. Doctrine never orders a raid itself; campaign strategy (or the debug menu) does.

### Military authority matrix (who may do what, this round)

| actor | patrol (own area) | defend own world | defend a charge | raid | declare war / invade / occupy |
|---|---|---|---|---|---|
| Romulan, Klingon, Terran | live (area patrols) | live (command) | phase 2 escort rules | live **only** under an existing formal war and a campaign raid order | never |
| Tholian | — | — | live (escort, phase 2) | shadow | never |
| Vulcan, Delpin, Ferengi | — | shadow | — | shadow | never |
| Dominion (both), Cardassian, others | shadow | shadow | shadow | shadow | never |
| Pirate, Hirogen, Borg, Gorn | shadow / dormant | — | — | shadow | never |
| a civilian ship attacked | — | — | — | — | self-defence only: return fire, evade; no pursuit, no war authority |

"Same flag does not mean same command": a captain flying Klingon colours changes no Klingon authority; a
same-flag captain's ship is never a Klingon asset; a hull's design never selects the authority or profile
(`P3-26/27`). The controller of a system, not its sovereign, is whose own-world defence applies.

---

## 3. Patrols

A patrol is a persistent assignment of one armed vessel to a **bounded area**: a world of its own power
(the anchor) and the neighbouring systems not held by a power it is at war with.

- **Cycle:** out to one neighbour, dwell `patrolAreaDwellDays` (2), back to the anchor, dwell, report in —
  a `area_patrol` assignment with its milestones, so an overdue patrol is an overdue ship like any other.
  The next cycle begins when one ends, whatever the formation settings (`P3-1`).
- **Formation:** `patrolAreas` config (Romulan, Klingon, Terran: 1 each) forms one from a spare armed hull at
  a frontier world every `patrolFormEveryDays` (15) until the count is met; or explicitly by
  `startAreaPatrol` (debug `doctrine areapatrol <faction> <system>`).
- **Responses:** a patrol may break off (pre-emption `area_patrol → investigate | protect | rescue`) for an
  incident **it knows of** inside its area, or at most `patrolResponseHops` (1) outside it. Anything further
  defers: `defer:investigate — outside its patrol area (…)` (`P3-4/19`).
- **Return:** when that objective closes, the patrol resumes its cycles from where it is (`patrolsReturned`),
  and the closed incident does not make a replacement objective (`P3-4/19`, in-game `PATROL-RETURN`).
- **End:** the vessel lost or disabled ends the patrol (a disabled patrol ship is stranded, §1).
- Through a blockade, a patrol cycle runs the blockade through the shared interception engine like any
  other doctrine voyage (`P3-22`).

### Patrol lifecycle

```
formed/ordered ──► patrolling ──(known incident in area, response live, capacity)──► responding
      ▲                │                                                                   │
      │                └── cycle ends ──► next cycle                                        │
      └────────────────────────────────── objective closed ◄───────────────────────────────┘
patrolling | responding ──(vessel lost / disabled)──► ended
```

---

## 4. Defence

**Trigger:** a verified attack on something the power is obliged to protect — its own world (campaign
operations engaged there, a doctrine raid on station there) or its own vessel fired on in a blockade run.
The attack is an `asset_attack` incident, witnessed by those physically there (the world's command; the
crew of the ship fired on), with the attacker's faction as **they** saw it (`direct_sensor`). Nobody else
knows unless told (`P3-K`); an unidentified attacker names nobody.

**Facts** (strategic, derived per observer): `attack_on_protected_verified`, `defense_obligation_active`,
`protected_party_affected`. Profile rule `defend_assets` → response `protect`.

**Capacity:** one existing armed hull (combat ≥ 0.5), free, operational, within `defenseHops` (2), leaving
the garrison floor; at most `maxMilitaryObjectivesPerPolity` (2) military objectives per power at a time.
Two safeguards against stripping and waste:

- never from a world that is itself under attack or targeted by an enemy operation;
- never into a fight it cannot hold: with the ship added, the defence must stand within
  `defenseHopelessRatio` (2) of the attacking hulls' strength, else `defer:protect — <world> cannot be held
  with what is spare (attack … against …)`.

No hull → `defer:protect — no spare armed vessel (garrison floor kept)`; nothing is spawned (`P3-20`).

**Execution:** the defender sails by the ordinary route engine (blockades included), arrives, and stands
as a local defender (`defendingAt`), counted by `localDefenseStrength` and taking its share of losses in the
existing attrition model. It never pursues.

**Termination (the package's `defense` template on the strategic clock):**

| ends as | when |
|---|---|
| completed: `threat_ended` | the attack ended (the operation resolved, the raid left) — as known to the observer |
| completed: `surrender_accepted` | a surrender was recorded (`recordSurrender`; the engine has no surrender mechanic yet — the hook stands the attackers down) |
| aborted: `objective_cancelled` | the protected world fell or changed hands; the defender was lost or disabled |
| expired: `objective_deadline_reached` | `defenseDeadlineDays` (10) |

On close: `defendingAt` cleared, the assignment ended, a return order home if it is away from its own space
(or back to its patrol). Nothing more happens under the closed objective (`P3-6/18`). The same incident
never makes a second defence objective; repeat evaluations are counted as `repeatPrevented`.

### Defence lifecycle

```
attack witnessed ──► incident (asset_attack) ──► command: defend_assets
      │                                             ├── no capacity ──► defer:protect (reason) … reevaluated daily
      │                                             └── capacity ──► objective: moving ──► defending
      └── threat ends / surrender / world falls / deadline ──────────────► closed ──► home (or back to patrol)
```

---

## 5. Raids under formal war

`orderRaid(book, world, { power, target, hullId, day, doctrine, by })` — campaign strategy's order. The
objective carries its authority stamp (`formal_war`, the war key, instance and id).

- **Every day, first:** `warAuthorityHolds(stamp)`. If not — ceasefire, peace, a different war instance —
  the raid is cancelled (`cancelledBy: 'authority'`, `objective_cancelled`, "war authority ended
  (klingon–terran: ceasefire)"). It does nothing more that day, **including a strike already in reach**
  (`P3-12/13`, in-game `DOCTRINE-WAR-AUTHORITY`).
- **En route:** moves by the route engine; a blockade on its way is run through the shared engine.
- **On station:** strength ratio against `localDefenseStrength`: below `raidMinRatio` (0.6) it withdraws;
  below `raidEngageRatio` (1.0) it shadows (holds, does not strike); otherwise it strikes — one day of the
  existing offscreen attrition model (`raidStrikeDay`), no capture — for `raidStrikeDays` (2), then goes home.
  The strike is witnessed by the holder the day it lands; the attack it is ends the day the raid's authority
  does (`P3-12b`: a ceasefire between strikes — no further strike, the attack incident `threat_ended` the next
  day).
- Deadline `raidDeadlineDays` (15). A raid in progress is itself a witnessed attack on the target's holder,
  who may defend under §4.

The raid never invades, occupies, captures, invents a jurisdiction, or makes a fleet.

---

## 6. Fire: the gates are unchanged

The tactical fire path is untouched. Doctrine can only ever add a "no".

`doctrineFireCheck` takes physical facts from the engine only (live track, usable weapon, weapon ready,
inside equipped range, target actionable); a caller's claims are discarded. New in phase 3,
`npcAuthorityFacts` reads the authority facts from the engine's own sources (§2) — witnessed aggression here,
the system-defence rule, the captain's ROE, formal war **with the target's own side** (the formal relation,
never attitude) with an operation or doctrine raid under way — and
`doctrineEngageChain` reports the whole chain:

**known target → applicable objective → authority → physical gates → fire / no fire (and why)**

plus what the engine's own defence rule would do (`engineDefends`). Checked in-game:

- captain's security ships under `return-fire` hold against a hostile until it attacks; under `defend` they
  engage on sight; the chain agrees with the engine each time and names its source (`SECURITY-ROE`);
- a Klingon defender at Qo'noS holds against a Romulan visitor (at peace) until it attacks; then engages,
  and doctrine agrees (`protect_charge`, `self_defense`); the relation stays peace (`FACTION-DEFENDER-ROE`);
- no track, out of range, weapon not ready → no fire, whatever the authority; a civilian attacked may return
  fire (`self_defense`) and gets no war authority (`FIRE-GATES-P3`).

Offscreen, "fire" is the campaign's attrition model; the strategic chain in the debug view says so.

---

## 7. Termination and repetition

- Every military objective has success and abort conditions (the package templates), a deadline, and closes
  once; closed objectives act no more (`P3-6/18`, `P3-12/13`).
- An observer running an objective on an incident, or whose power already has one on it, does not open a
  second: `repeatPrevented` (long run: 290 in 1000 days). No objective is re-created every tick (`P3-4/19`).
- Budgets: 2 active military objectives per power; one hull per defence; patrols bounded to their area.

---

## 8. Integration

- **Wars, ceasefire, player wars:** authority is the formal record (§2). A ceasefire voids raids at once.
  `forceWarTransition`/`changeDiplomacy` paths are the only ones that change it.
- **ROE and access:** the captain's security policy is the captain's order for the captain's ships only.
- **Controller vs sovereign:** own-world defence follows the controller.
- **Escorts:** phase 2 escort rules unchanged; the defence template is separate (`kind: 'defense'`).
- **Movement:** every doctrine move is a vid on the route/blockade engine, one jump a day; no teleport.
- **Knowledge:** per actor (`P3-K`); an overdue notice reveals no attacker; secret pact knowledge never
  reaches a patrol's decisions (`P3-28`).
- **Earlier gates:** phase 1/2 in-game scenarios run with `militaryResponses: false` and no area patrols
  (their `__quiet`), as they ran before phase 3; phase 1's re-entry check runs the same way. The switch
  (`militaryResponses`, default on; debug `doctrine military on|off`, which also sets the area patrols)
  turns off witnessing attacks for a campaign.
- **Fixture-sensitive campaign checks** run with `doctrine military off`, as their own rules are what is
  under test (the precedent is f2837a7, which did the same with AI evacuations and blockades):
  - `campaign-probe` "Dominion: … the crossing": with doctrine defence on, in seed `gate-G` the Terrans
    hold and retake Bajora and the expedition withdraws on day 434 before the check's last step;
  - `campaign-blocker-probe` F5 (a dead crew's station): a Terran doctrine defender arriving at Vega changes
    which hull takes the day's losses, so the picket survives the interval;
  - `war-peace-gate` WAR-NO-CALENDAR: area patrols alone, or defence alone, leave the front as the fixture
    moves it; both together tip a fifth Romulan world and a legitimate decisive peace.

  These are real effects of live defence on war outcomes (§11 watch items), not defects in the checks.

---

## 9. Live vs shadow

| family | live this round | shadow |
|---|---|---|
| disabled hulls | all (campaign model) | — |
| patrol | Romulan, Klingon, Terran area patrols: investigate / protect / rescue in area | every other profile |
| defence | Romulan, Klingon, Terran command: protect own worlds | every other profile |
| escort | Tholian (phase 2) | — |
| raid | Romulan, Klingon, Terran raider, **only** on an existing formal war and a campaign raid order | every other profile |
| war creation, occupation, invasion planning | — | all |
| covert, pirate, Hirogen, Borg, Gorn | — | all (Gorn dormant) |

The shadow comparison for the in-game scenarios is `shadow-comparison-phase3.json` in the gate output.

---

## 10. Cheats & Debug

Faction doctrine (debug), new tables:

- **Military objectives (patrol, defence, raid):** objective, kind, actor, vessel (vid), authority source and
  detail, jurisdiction, target and what is known of it, current action, the termination conditions
  (success / abort, and which hold now), the strategic fire chain, deadline, status.
- **Area patrols:** power, vessel, anchor, area, status, cycles, responses.
- **Raid orders:** order, power, target, day, by, status and reason (refusals shown).
- **Disabled hulls: stranded until recovered:** power, hull (vid), where, hull, stranded since, crew
  (aboard until / rescued / lost), recovery state, the job still holding it.
- **Local engagement chain (this system, now):** each armed ship against the ship it would engage — target
  known, objective, authority, physical gates, fire / not authorised with the failed facts, and the engine's
  defence rule.

Debug codes: `doctrine areapatrol <faction> <system>`, `doctrine raid <faction> <system>` (a campaign raid
order; refused without formal war), `doctrine surrender <incident> [acceptedBy]` and
`doctrine recover <faction> <hull>` (both labelled overrides). Nothing in the section is sent to the captain's reports. The captain hears only
"<power> ships moving to defend <world>" through a real source at the departure system (`PLAYER-REPORTS-P3`).

---

## 11. Measurements (not a balance claim)

**Pure, 400 days** (`MEASURE`: fixture galaxy, AI offensives on, area patrols on, a raid order every 25 days,
ceasefire day 200, war again day 260): military objectives 22 created / 21 closed (2 completed, 3 expired),
83 deferrals, 96 repeats prevented, 6 patrols formed / 1 returned, 16 raid orders (5 refused), 10 witnessed
attacks, max 2 active military objectives (2 per power), longest military objective 9 days, garrison
breaches 0, stranded hull-days 52. No raid happened to be under way at the day-200 ceasefire in this run
(cancelled by authority: 0); the ceasefire cancellation is covered by `P3-12/13` (en route), `P3-12b`
(between strikes) and in-game `DOCTRINE-WAR-AUTHORITY`.

**Rescue by travel time** (`MEASURE-RESCUE`, Vulcan relief, report relayed 2 days after the loss):

| site (jumps) | life support 3 | 5 | 8 | 12 | 20 |
|---|---|---|---|---|---|
| Rigel (2) | lost | rescued day 5 | rescued day 5 | rescued day 5 | rescued day 5 |
| Ferenginar (3) | lost | rescued day 6 | rescued day 6 | rescued day 6 | rescued day 6 |

A longer trip never succeeds where a shorter one with the same life support failed. In the in-game
`DISABLED-RESCUE-TIME` the relief makes three jumps day by day and takes the crew off inside their 20 days.

**Real game, 1000 days** (`doctrine-phase3-longrun.cjs`, default campaign, real wars, planning on, fc935e3):

| | day 51 | 251 | 501 | 751 | 1001 |
|---|---|---|---|---|---|
| military objectives created (cum.) | 1 | 5 | 18 | 39 | 50 |
| expired (cum.) | 0 | 1 | 4 | 11 | 15 |
| deferrals (cum.) | 92 | 234 | 496 | 999 | 1191 |
| repeats prevented (cum.) | 0 | 12 | 122 | 218 | 290 |
| stranded hulls at sample | 0 | 1 | 2 | 0 | 0 |
| stranded hull-days (cum.) | 4 | 151 | 470 | 795 | 1272 |
| doctrine book (bytes) | 221 k | 203 k | 409 k | 369 k | 403 k |
| whole campaign book (bytes) | 383 k | 481 k | 773 k | 803 k | 891 k |

Max 3 active military objectives at once, 2 per power; longest 9 days; 3 area patrols at most; 10 formed,
2 returned; 0 page errors. Saved game at day 1000: 1.02 MB per slot (6f9e499, same run: 0.66 MB); all
three slots saved. Nothing grows without bound: incidents stay at the history limit (20), objectives at 40.

**Campaign balance runs** (`test:campaign:balance`, 300 days, three seeds; worlds / hulls / hulls lost at
day 301, Terran and Klingon — the formal war — and Cardassian):

| seed | 6f9e499 | candidate | candidate, military doctrine off (disabled-hull rule only) |
|---|---|---|---|
| balance-1 | T 13w/69h/L7 · K 13w/74h/L21 · C 8w/53h/L1 | T 15w/65h/L14 · K 11w/76h/L17 · C 8w/53h/L1 | T 19w/55h/L27 · K 9w/66h/L24 · C 7w/53h/L0 |
| balance-2 | T 13w/59h/L27 · K 12w/61h/L17 · C 10w/50h/L4 | T 16w/51h/L41 · K 9w/49h/L29 · C 8w/52h/L2 | T 17w/56h/L32 · K 8w/56h/L21 · C 7w/23h/L34 |
| balance-3 | T 14w/77h/L2 · K 11w/69h/L28 · C 8w/56h/L1 | T 19w/53h/L34 · K 6w/56h/L41 · C 9w/51h/L2 | T 11w/54h/L29 · K 10w/65h/L32 · C 8w/56h/L1 |

Wars now cost more hulls: a disabled hull no longer comes back in days, and a hulk can be finished off where
it lies. The disabled-hull rule on its own already moves the fronts as much as the military doctrine does,
and not in one direction (Terrans ahead in seeds 1–2, behind in seed 3; a Cardassian collapse in seed 2).
This is the brief's rule working, not a tuning; the fronts are sensitive, and tuning (crew survival, recovery
days, a towing mission, write-off) is a separate decision.

**Watch items:**

- *Doctrine and war outcomes.* Live defence and area patrols change how wars go (and so does the
  disabled-hull rule, above). Three fixture-sensitive
  campaign checks now run with military doctrine off (§8). In the default long run the defence is selective
  (50 objectives in 1000 days after the two safeguards; 100 before them). Whether this should be tuned or
  gated per scenario is a design call.
- *Save size.* The doctrine book is ~0.2–0.46 MB in a long war (6f9e499: ~0.02 MB, when doctrine saw almost
  no incidents). Storage was bounded this round (unknown observers of an attack are not listed; traces keep
  only deciding facts; orphaned signatures are dropped); the per-observer knowledge record (phase 1
  structure, ~1 KB) is the next thing to compact.
- *Deferrals* are frequent (1191 in 1000 days), mostly "no spare armed vessel (garrison floor kept)" or
  "cannot be held with what is spare": that is the garrison floor and the hopeless-fight rule holding, not
  doctrine stripping garrisons.
- *Stranded hulls* accumulate in a war (write-off after 90 crewless days keeps it bounded); with no towing
  yet, a hulk away from an own yard is never recovered.
- *Doctrine vs campaign strategy:* after a defence closes the hull is back in the ordinary pool; campaign
  strategy may take it for an operation of its own (seen in-game) — that is campaign strategy's call, under
  that operation, never a doctrine order.

---

## 12. Still deferred

- towing / salvage missions to bring a hulk to a yard (the hook `recoverStrandedHull` exists);
- a surrender mechanic in the engine (the hook `recordSurrender` exists);
- campaign strategy issuing raid orders itself (the API exists; only authored/debug orders this round);
- tactical handoff of a strategic defence/raid into a local battle the captain is in; a hull disabled
  offscreen in an operation still materialises with that operation (at its damaged hull) when the captain is
  at the battle — the engine's materialisation is unchanged this round;
- enforcement, predation, hunt and assimilation modes (shadow);
- carried forward: evacuation one system per day; non-doctrine AI not using the blockade engine; treaties
  beyond war/ceasefire/peace (DMZs, inspections, tribute, reparations, basing, transit rights).

---

## 13. Tuning (phase 3 additions; campaign days, first-pass values)

Campaign: `crewSurvivalDays 20`, `strandedRecoveryDays 2`, `derelictWriteOffDays 90`, `minOperatingCrew 0.5` (§1a).
Doctrine: `patrolAreas {romulan:1, klingon:1, terran:1}`, `patrolAreaDwellDays 2`, `patrolFormEveryDays 15`,
`patrolResponseHops 1`, `closedPatrolLimit 10`, `maxMilitaryObjectivesPerPolity 2`, `defenseHops 2`,
`defenseDeadlineDays 10`, `raidDeadlineDays 15`, `raidStrikeDays 2`, `raidEngageRatio 1.0`,
`raidMinRatio 0.6`, `attackHistoryLimit 30`, `defenseHopelessRatio 2`, `militaryResponses true`. `DOCTRINE_CONFIG_VERSION 3`.
