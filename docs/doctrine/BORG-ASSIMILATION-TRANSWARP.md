# BORG ASSIMILATION + TRANSWARP

This round is stacked on the accepted Hirogen Hunting candidate `9db1fc6596d499e71a5237cca6b4afea934e5b1a`. Nothing has been pushed, merged or deployed.

The Borg are now a distinct strategic threat rather than one more hostile faction. Their doctrine is **acquire → disable → assimilate → integrate**:

- The Collective's own persistent hulls choose targets from what they have actually seen.
- They reach those targets by conventional travel or by **transwarp**, a separate movement mode and not a speed rating.
- They disable a vessel rather than kill it, then assimilate the **same hull record**.
- A world is suppressed, then assimilated over a persistent, interruptible progress.

None of this is war. There is no capture, no occupation, no diplomacy and no treaty compliance.

| Piece | Where |
|---|---|
| Pure rules (value, score, eligibility, crew outcome, world progress, escape, movement mode, termination, chart scale) | `src/borg-doctrine.mjs` |
| Campaign layer (knowledge, selection, objectives, movement, encounters, closure, debug) | `src/borg-campaign.mjs`, run from the daily doctrine step (`advanceDoctrineDay` → `BC.advanceBorg`) |
| Shared systems touched | `src/campaign-strategy.mjs`: transwarp journeys (`startJourney` with `mode: 'transwarp'`, `transwarpCapable`, `transwarpRefusal`), hull assimilation (`assimilateHull`), the Borg as universal hostiles to blockades, assimilated worlds in the shadow world |
| Capability data | `bm-ships/ships.json` → `data/starship_manifest.json`: 346 Assimilation Cube `assimilator: true`, `transwarp.capable: true`; 261 Tactical Cube `transwarp.capable: false` (deferred) |
| Engine | `src/main.js`: `systemAssimilated` (controller change without capture), aperture and assimilation news, scene decision, "Borg assimilation" debug, no market on an assimilated world |
| Regressions | `scripts/borg-test.mjs` (pure, 25 checks), `scripts/borg-gate.cjs` (in game, 9 checks) |
| Measurement | `scripts/borg-measure.mjs`, `scripts/borg-measure-ingame.cjs` |

## 1. Authority and identity (§1, §16, live vs shadow)

The doctrine data (unchanged) is the authority:

1. **Borg command** (`commander`) reacts to a `technology_discovery` it has itself observed with `assess_technology`. The interest rule `technology` needs `unusual_technology` and `evidence_available`.
2. The **assimilation order** that follows authorizes the force's `assimilation` engagement mode. Role `raider` is used for a ship and `occupier` for a world. The mode requires `identity_known`, `unusual_technology` and `assimilation_order_active`.

The live entry is `{ profile: 'borg', role: 'commander', response: 'assess_technology' }`. `DOCTRINE_CONFIG_VERSION` is now 6.

| Situation | Doctrine | Live entry | `config.borg` | Result |
|---|---|---|---|---|
| Borg command sees a valuable target, a force is free | `assess_technology` + engagement authorized | present | `{ power: 'borg' }` | **live**: the objective opens, the force moves |
| Same, live entry removed | `assess_technology` | absent | present | **shadow**: `shadow: assimilation not live` recorded, counted `borgShadow` |
| A target with nothing worth acquiring | `record_only` | — | present | rejected `no technology worth acquiring` |
| `config.borg` absent | — | — | absent | not evaluated |
| No free assimilating vessel | — | present | present | `deferred: no free Borg vessel` / `no assimilating vessel free` |
| Doctrine not loaded | — | — | — | live objectives get a closure record, the force is let go |

**No war, by construction.**
- No Borg code path declares war, writes a relation, records a capture, occupation or integration, grants a licence, or uses a treaty right.
- The Borg are already excluded from diplomacy (`setDiplomacy` refuses them; `diplomaticPairs` skips them). They stay at "peace" in the war model, and nobody wages a formal war on them.
- Blockades are the one place their hostility must act like war. `UNIVERSAL_HOSTILES = ['borg']` lets every blockade bear on Borg traffic with no war record (§15).

**Treaties (§16).**
- The Borg are no party to any term, so no DMZ bars their route and they make no compliance decision.
- An entry into a DMZ-protected system (conventional crossing, or a transwarp exit) is recorded as an **incursion** (`db.borg.incursions`, effect `dmz_incursion`) and reported to the parties through the intel path.

## 2. Assimilation lifecycle and state matrix (§2, §20)

An objective is a doctrine objective of `kind: 'assimilation'`. The generic objective loops skip it.

**Fields**

| Group | Fields |
|---|---|
| Identity | `id` |
| Force | `force[{hullId, vid, shipId}]` |
| Target | `targetKind` (`ship` / `world`); `target{vid, hullId \| systemIndex, polity, shipId, known{…observed facts}}` |
| Value | `value`, `why{score, ratio, factors, reason}` |
| Knowledge | `lastKnown{systemIndex, day, source, heading}`, `lostSince` |
| Progress | `phase`, `phaseHistory`; `movement{mode, conventionalDays, transwarpDays, holdDays, reason, refusal, journeyId, etaDay}`; `progress{value, startDay, state}` |
| Contact | `engagements`, `encounterId`, `handoff{encounterId, status, captainScene, outcome}`, `lastEngagement` |
| Outcome | `authority{…, war: false}`, `result{result, reason, day}` |

A world's progress is a separate persistent record, `db.borg.progress[systemIndex]` (§8).

**Phases**

| Phase | Entered when | The force | Leaves to |
|---|---|---|---|
| `evaluate` | the objective opens | — | approach |
| `approach` | under way (conventional legs or a conduit), or waiting for the conduit (`hold`) | moves (§5) | intercept, disable |
| `intercept` | its current leg/jump ends where the target is | continues | disable |
| `disable` | on station: one encounter per contact (ship), or the defenders, then suppression (world) | engages | assimilate, disable, closure |
| `assimilate` | the ship target is subdued (disabled or struck), or the world's defence is suppressed | stays with it; progress accrues daily | completion, or back to `disable` / `approach` if interrupted |
| `withdraw` | closed | returns conventionally to the nearest Collective world | resolved |
| `resolved` | every hull of the force is home or out | — | — |

**Termination (`borgTermination`, plus the encounter outcomes)**

| Result | When | Status |
|---|---|---|
| `target_assimilated` | ship: progress 1 → `assimilateHull`; world: progress 1 → `systemAssimilated` | completed |
| `target_destroyed` | destroyed in the engagement (an overkill), or known lost where the Collective sees | aborted |
| `target_escaped` | slipped away at contact; lost beyond `searchDays`; knowledge older than `staleDays` | aborted |
| `borg_destroyed` / `borg_disabled` | the force is gone or unable | aborted |
| `inaccessible` | no way there for longer than `searchDays` | aborted |
| `interrupted` | a world's progress interrupted longer than `worldAbandonDays` | aborted |
| `abandoned` | objective budget spent, or `maxEngagements` (3) without subduing | aborted |
| `cancelled` | recalled, or the doctrine switched off | aborted |

At closure a cooldown is set on the target (60 days for a ship, 120 for a world, both scaled). History is bounded to 40 entries, and the force withdraws. One objective exists per target (`already an objective`), and the force runs at most one objective at a time.

## 3. Knowledge (§3, §17)

What the Collective knows:

- **Direct.** Every system a Borg hull stands in.
- **Border.** Every Borg-held world and its neighbours. A cloaked hull is not seen at border range.
- **Departure sightings.** A hull seen leaving, with its heading.

**Ship contacts** are per hull. They record:
- observed class: price, mass, category, cloak;
- strength (the hull share is read only up close);
- subdued or not, speed, system, day, source, heading.

**World knowledge** is per covered system: holder, population, yards (stations with berths), installations, and defence (installations plus the holder's hulls standing there).

Nothing is read that was not observed: no hidden cargo, equipment, unseen technology or unseen population. A hull or world that has become the Collective's own leaves the target lists.

**The captain** learns only through real sources:

| What happens | What the captain gets |
|---|---|
| An aperture (entry or exit) in his system | "Borg transwarp aperture detected." |
| The Borg leave his system | "Borg contact lost." |
| A Borg vessel in his scene turns on him | "Borg vessel is attempting to disable your ship." |
| An assimilation begins in his system | "Assimilation in progress." |
| Anything elsewhere | the intel path (`reportDoctrineTrace`): local observation, relay or fleet report, or a rumour |

Hidden Cube destinations, target lists and distant progress are never told.

## 4. Target scoring (§3, §4)

**Ship value** = 0.5·tech + 0.25·crew + 0.25·strategic + bonus.

| Term | How it is computed |
|---|---|
| tech | log(price/20 000)/log 50, clamped 0..1. A shuttle is 0, a cruiser about 0.56, a battleship about 0.9. |
| crew | mass / 10 (class size) |
| strategic | battleship 1, cruiser 0.7, shuttle 0.1, other 0.4 |
| bonus | cloak +0.25 (unusual technology); the only class of its kind seen +0.1 |

**World value** = 0.4·population (pop/5000) + 0.3·industry (0.5 per yard) + 0.3·installations (0.15 each). Every term uses only what was observed.

**Unusual technology**, the doctrine fact, means:
- for a ship: tech ≥ 0.5 or a cloak;
- for a world: any yard or tech ≥ 0.3.

**Score** = value × confidence × reach.
- Confidence: direct 1, contact 1, departure 0.9, border 0.85, report 0.7, falling with age.
- Reach: 1 − 0.3 × reach/maxReach, where reach is the chosen mode's ETA.

**Verdicts, in order**

| Reason | Verdict |
|---|---|
| already an objective | rejected |
| cooldown until day N | rejected |
| knowledge stale | rejected |
| no route / beyond reach | rejected |
| too strong to take: ship stronger than 0.9 × the force | rejected (fought only in self-defence) |
| defences too strong: world defence × 1.5 > the force | rejected |
| no technology worth acquiring | rejected |
| below threshold (0.3) | rejected |
| vessel / world worth assimilating | **eligible** |

**Measured.**
- Pure: an unarmed shuttle scores 0.123 and is rejected; a cruiser scores 0.614 and is chosen.
- In game: the Borg chose a Terran *Inquiry*-class (value 0.71, score 0.60) seen at Astron beside Vex.

## 5. Movement: conventional and transwarp (§11–§15)

| | Conventional | Transwarp |
|---|---|---|
| Record | shared journey, `kind: 'borg'` | shared journey, `kind: 'borg'`, `mode: 'transwarp'`, `transwarp{entry, exit, openedDay, days, conventionalDays, exitDay}` |
| Route | `plotJourney` (the chart's legs) | none: **one leg** from the entry to the exit, `path: [exit]` |
| Days | each leg at the slowest member's strategic speed (the Cube's rating 9 → 1.32×) | **fixed** `transwarpDays` (2), whatever the distance and whatever the rating |
| Crossings | every intermediate system: blockades (shared engine), treaty crossings, incursions | **only the exit**: no intermediate crossing, blockade or treaty check (R32); the exit is an ordinary arrival, so a blockade there runs and an encounter can open (R33) |
| Capability | any hull that can travel | the class's own data, `transwarp.capable` (the Assimilation Cube); refused for any other hull (R29, R36) |
| Limits | — | per-hull cooldown `transwarpCooldownDays` (30, scaled: 60 on the real chart) from its exit; hull ≥ 60 %; objective score ≥ 0.5; must save ≥ 3 days |
| Save/load | the journey record | the same journey record; it survives identically (R31) |
| ETA | `etaDay` | `etaDay` = opened + 2, and arrival is exactly then (R30) |

**The movement-mode choice (`chooseMovement`, ETA-aware, shown in the debug with both ETAs and why)**

| Situation | Mode |
|---|---|
| No assimilator able to jump in the force | conventional ("no transwarp capability in the force") |
| A hull below 60 % | conventional ("too damaged to hold a conduit") |
| On cooldown, and waiting + 2 + 3 ≤ the conventional ETA | **hold** for the conduit ("waiting N d …"; one cooldown block counted) |
| On cooldown, conventional is no slower | conventional ("transwarp cooldown"; counted) |
| Score < 0.5 | conventional ("below the transwarp threshold") |
| Saves < 3 days | conventional ("transwarp saves too little") |
| Otherwise | **transwarp** ("saves N days") |

**Further rules.**
- **Force composition.** A force that jumps is its capable hulls only. A smaller Borg craft or an assimilated hull is not carried this round (carrier access is deferred).
- **Presence.** An objective is not present anywhere until its hulls physically stand there (`standingAt`), so a hull in a conduit is nowhere.
- **Conduit network.** The model is one bounded direct jump. There is no conduit network, Tactical Cube or time travel.

**Speed preserved.** The Cube's strategic speed stays 1.32× (rating 9). Transwarp is not a rating (R27).

## 6. Ship assimilation transition matrix (§4–§6, §10)

| From → to | Condition | What changes on the **same hull record** |
|---|---|---|
| operational → engaged | Borg and target stand in the same system on the same day | one encounter (`assim:<id>:<day>:e<n>`); in the captain's system it is held for his scene, otherwise the strategic resolver runs once |
| engaged → escaped | escape roll (faster or cloaked target) | nothing; objective `target_escaped`, cooldown |
| engaged → damaged | strike short of the disable line | hull reduced; objective stays in `disable` (at most 3 engagements) |
| engaged → **disabled (subdued)** | strike reaches the disable line | hull clamped to the line (stranded, crew aboard); objective → `assimilate` |
| engaged → destroyed | an overkill: 12 %, ×3 if the target fights back hard (strength ≥ 0.6 × the force) | hull lost; objective `target_destroyed` |
| subdued → assimilating | eligible: present, subdued, an assimilator present, not destroyed, not escaped | progress `1/shipAssimilateDays` (2 days) per day |
| assimilating → interrupted | target gone (towed or recovered), or no longer subdued | progress kept, phase back to approach/disable |
| assimilating → **assimilated** | progress 1 | `assimilateHull`, below |

**`assimilateHull`** moves the same object from its owner to the Borg:

| Kept | Changed |
|---|---|
| id, i.e. its **vid** | **controller** (owner): Borg |
| class (`shipId`, no refit, no Borg advantages) | identity history: `{event: 'assimilated', from, to}` appended |
| **damage** (hull) | `assimilated{day, from, originBuilder, systemIndex, crew}` recorded |
| stranded state | stranded crew becomes `assimilated`: crewed, never written off, not salvageable by others |
| identity **origin**, written once (e.g. `builder: 'terran'`) | owner's counters: `lostHulls` and `assimilatedHulls` +1 |
| its own class speed; no transwarp (its class has none) | status: disabled → repairing (a Borg hulk); operational (struck) → ready |
| no licence, no production right (`polityCanBuildDesign(borg, class)` stays false) | — |

**Crew outcome (`crewOutcome`)** is explicit and nothing is created:
- **`crew_assimilated`**: the complement aboard.
- **`partial_survivors`**: with 30 % chance, 30 % of the crew get off.
- **`target_abandoned`**: there was no crew aboard.

The hull's `crew` becomes what was assimilated. No drone economy is modelled.

**Assimilated hulls in Borg service (§18).** They are Borg hulls under a bounded rule:
- They have their own class's speed, no transwarp and the same weapons.
- They join a force only once operational and crewed.
- They repair only through the ordinary rules, at a Borg yard. None exists in the default chart, so a hulk assimilated disabled stays where it lies. That is deliberate (carry-forward).

**Hunting interaction (found this round).** The Hirogen had hunted down an assimilated wreck. An assimilated hulk is now no quarry for them. The filter is scoped to assimilated, disabled hulls only, so the Hirogen's handling of other disabled prey is unchanged. Hunt R19 now uses a mobile cripple (hull above the disable line) for its destroyed-prey case.

## 7. World assimilation transition matrix (§7, §8, §19)

| From → to | Condition | Progress record (`db.borg.progress[i]`) |
|---|---|---|
| — → suppressing | the force stands at the world | `{startDay, progress 0, suppressed 0, resist, borgPresent, state, from, origin, history}` |
| suppressing (defenders standing) | the holder's operational hulls at the world | one encounter a day with them (Borg disable them), then suppression |
| suppressing → contested | resist > Borg strength | suppression only; no progress |
| suppressing → subdued | `suppressed` reaches 1 (rate 1/6 per day at parity) | — |
| subdued → assimilating | Borg present, defence suppressed | `progress += (1/20)·(1 − 0.5·popResist)` per day |
| any → interrupted | no Borg force standing there (left or destroyed) | `progress −= 0.04` per day; `interruptedSince` set; the objective ends after 15 days interrupted (scaled) |
| assimilating → **completed** | progress 1 | `systemAssimilated` → controller **Borg** |

**Completion (engine).** The engine applies the change with `transferSystemControlToFaction(i, 'borg')`, with the **capture hook suppressed**. As a result:

- **No capture records:** no occupation record, no integration, no licence, no war front, no captureSystem effect.
- **On record:** origin is unchanged (`getSystemControl().origin`), and the former holder is kept in the progress record and in `assimilatedWorlds`.
- **Market and services:** the world has no market for anyone (`occupiedMarket.assimilated`, an empty shipyard stock). Its services are refused because it is Borg (hostile).
- **No production:** nothing is unlocked for the Borg.
- **The model's world:** the shadow world applies the controller change exactly as it would a capture's, but records nothing else.

**Measured.**
- Pure: the Outpost took 44 days from arrival to completion (minimum across seeds 35), with no instant flip.
- In game: Tarellia reached progress ≥ 0.2 with its defence suppressed. The cube recalled → progress decays. The cube staying → the controller becomes Borg, origin Tarellian, no market, no capture or war record.

## 8. Tactical handoff (§9, R17–R19, R33–R34)

**One encounter per contact.** If the contact is in the captain's system (`world.localSystem`, never while he is in warp), it is held `pending` for the scene. Meanwhile nothing strategic touches it: no damage, no second encounter (R19, R34).

In the scene the same hulls are spawned (same vids) with their hull shares. The decision rule:

| Scene state | Outcome |
|---|---|
| target disabled or struck | `subdued` → the objective goes to `assimilate` on the same hull (R18) |
| target destroyed | `target_destroyed` |
| target escaped | `escaped` |
| Borg out | `borg_beaten` |
| window over, or the captain left | `fought`, on the state reached |

The shared `settleAbandonedHandoff` rule covers a scene the captain is no longer in. A transwarp exit into his system is just such a contact (R33).

**Not this round.** The captain's own ship is not an assimilation target. The Borg turn on him only if he engages them (self-defence is lethal); the target is always an NPC hull or a world.

## 9. Baseline (9db1fc6): generic Borg

- **The Borg fleet:** one Assimilation Cube (346) at Vex (system 33).
- **No movement:** over 200 days the cube never moves.
- **No Borg state:** there are no Borg operations or wars, no doctrine live entry, and no assimilation or transwarp code.
- **Generic hostility only:** local NPC hostility everywhere, and the ambient-raid draw (`chooseActivityAttacker` with the cube when a system next to Vex rolls a raid).
- **Transwarp:** only text in the manifest's `strategicSpeedNote`.

| Suite | 9db1fc6 | Candidate |
|---|---|---|
| Pure suite | **4/25**: preservation 4/4; baseline-defect R2 fails on its own assertion ("no assimilation objective on an observed valuable vessel"); new-feature 0/20 | 25/25 |
| In-game gate | **1/9**: preservation 1/1; baseline-defect BORG-SELECTION fails on its own assertion ("no assimilation objective: no selection at all"); new-feature 0/7 | 9/9 |

## 10. Long-run measurement

**Pure** (`npm run measure:borg`): 4 seeds × 400 days, every routine on, worlds as targets.

| Metric | Value |
|---|---|
| Objectives | 21 opened (17 ship targets, 4 world targets) |
| Ships assimilated | 7 (all still held by the Borg, same vids) |
| Worlds assimilated | 4 (the Outpost once per seed, ≥ 35 days each) |
| Targets destroyed | 4 (overkills, or lost to others' wars where the Collective saw it) |
| Targets escaped | 6 (including contacts lost beyond the search budget) |
| Borg losses | 0 |
| Transwarp | 6 uses, 3 cooldown blocks; mean conventional ETA 7 d vs transwarp 2 d |
| Formal wars by assimilation | **0** |
| World captures | **0** |
| Borg licences / integrations | **0** |
| Duplicate hull identities | **0** |
| Borg state | ≤ 34 KB |

**In game** (`npm run measure:borg:ingame`): 2 campaigns × 400 days.

| | Campaign 1 | Campaign 2 |
|---|---|---|
| Objectives | 5 | 6 |
| Ships assimilated | 3 | 4 |
| Escaped / destroyed | 1 / 1 | 0 / 1 |
| Transwarp | 3 jumps (16/25/16 d conventional vs 2 d), 2 cooldown blocks | 4 jumps (16/25/16/16 d conventional vs 2 d), 2 cooldown blocks |
| Borg hulls held | the cube + 3 assimilated Promelli hulks | the cube + 4 assimilated Promelli hulks |
| Worlds | 0 (none near Vex is both valuable and feasible for one cube) | 0 |

Across both campaigns:
- Wars, diplomatic pairs, licences, unexplained flips to Borg and duplicate identities are all **0**.
- Borg state stays 31–42 KB.

**Watch list**

| Concern | Status |
|---|---|
| Steamrolling the map | no: ≤ 1 world per 100 days per seed; one cube in the real game |
| Every target assimilated | no: 4 destroyed, 6 escaped against 11 assimilations |
| Transwarp trivializing distance | no: per-hull cooldown, score and saving thresholds; ≤ 4 jumps in 400 days per campaign |
| Instant world flips | no: progress over weeks, decays without the force |
| Production rights from one hull | none: no licence or integration ever |
| Diplomatic war loops | none |
| Duplicate or reset vessels | none: same record, same vid, damage kept |

## 11. Independent review (901c815) and fixes

| # | Severity | Finding | Fix | Regression (fails on 901c815) |
|---|---|---|---|---|
| 1 | high | A world retaken from the Borg was re-assimilated the day they arrived (a completed progress record was reused) | completed records of a world no longer Borg-held are dropped (after a day's grace for the engine's controller change); successful world objectives also set the world cooldown | REVIEW-1 |
| 2 | medium | The Borg "knew" of a target's destruction anywhere once its last-known system was covered; a hull taken by someone else read as destroyed | destroyed only when seen (own engagement, or lost in a system covered today); otherwise contact lost and the search budget runs | REVIEW-2 |
| 3 | medium | A hull another journey had under way (a tow) could be assimilated, leaving a Borg hull stuck in someone else's transit | `assimilateHull` refuses a hull in transit; presence requires not under way | REVIEW-3/6 |
| 4 | medium | A world occupied before the Borg took it kept its occupation and territory records (skewing war termination) | cleared on assimilation | — |
| 5 | medium | The Hirogen filter dropped every disabled hull, not only assimilated wrecks | scoped to assimilated disabled hulls | hunt suite 23/23 |
| 6 | low | A force recalled mid-conduit was released at the exit instead of returning home | the conduit journey carries `meta.home`; the force exits, then turns for home | REVIEW-3/6 |
| 7 | low | World progress could freeze while any Borg hull (a probe) stood there with no objective | presence requires an active objective's assimilator | — |
| 8 | low | Border sensors counted cloaked defenders | a cloak hides defenders at border range | — |
| 9 | low | An assimilated world of neutral origin still had a market; recovered-archive designs and commodities still traded | `occupiedMarket` reports assimilated first, whatever the origin; archive stock and commodity trade blocked | — |

## 12. Not implemented (by the brief)

- Tactical Cube (stays `transwarp.capable: false`, deferred)
- full drone economy; individual drone simulation; mass-assimilation population simulation
- Borg diplomacy or peace
- a galaxy-wide transwarp conduit network (one bounded direct jump instead)
- time travel
- ordinary-faction invasion or occupation doctrine

## 13. Carry-forward

**Earlier rounds:**
- `restrict.reinforcement` / `restrict.offensive` treaty consumption
- `blockade_in_dmz` incident semantics
- stationing-only DMZ authoring through `parseClause`
- AI proactive staging-base selection
- military trader inside a newly activated DMZ should leave first
- `fleetPassageRouteNote` lawful-route wording
- outbound tug casualty-destroyed notification delay
- trader inspection refusal policy
- NPC tactical-scene persistence
- engine-condition speed degradation
- low-confidence speed tuning
- dedicated-tug tuning
- multi-tug towing
- allied recovery
- towed-hulk tactical rendering
- unauthorized foreign salvage incident
- captain crew-survival clock
- autonomous war declarations
- doctrine invasion/occupation
- broad covert doctrine
- Gorn activation
- Tactical Cube
- Hirogen hunt exchange tuning / re-hunt memory

**New this round:**
- the captain's own ship as an assimilation target
- carrier/conduit access for non-capable Borg craft
- Borg repair or regeneration of assimilated hulks (no Borg yard exists)
- defenders retaking an assimilated world (nobody is at war with the Borg, so nobody retakes)
- assimilated-world population and industry consequences beyond "no market"
