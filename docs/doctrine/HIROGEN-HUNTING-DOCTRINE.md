# HIROGEN HUNTING DOCTRINE

Stacked on the accepted Architecture Cleanup candidate `c0a58901a4886ae698121970b65d100b1b6c1fe5`. Nothing pushed, merged or deployed.

The Hirogen are no longer generic hostile traffic. They are a hunter culture:

- Their own hulls choose prey from what they have actually seen.
- They stalk and pursue it on the shared strategic journey system.
- They intercept it in one encounter, then break off when the hunt stops being worth it.
- They remember how each hunt ended, and keep a bounded cooldown and history.

A hunt is a **bounded objective**. It implies no war, no claim, no occupation, no extermination and no infinite pursuit.

| Piece | Where |
|---|---|
| Pure rules: worth curve, prey score, escape chance, intercept estimate, termination, search plan, chart time scale | `src/hunt-doctrine.mjs` |
| Records, knowledge, selection, journeys, encounters, closure, debug summary | `src/doctrine-campaign.mjs` (the "HIROGEN-HUNTING-DOCTRINE" section; `advanceHunts` in the daily doctrine step) |
| Captain as prey: crossing check, scene decision, surrender panel, messages, "Hirogen hunts" debug section | `src/main.js` |
| Doctrine data (unchanged; it is the authority) | `docs/doctrine/bm1-faction-doctrine.v0.2.1.json`: Hirogen profile, role `hunter`, interest rule `quarry` → `pursue_quarry` on `prey_sighting` when `worthy_hunt_known`; objective template `hunt` |
| Regressions | `scripts/hunt-test.mjs` (pure, 23 checks), `scripts/hunt-gate.cjs` (in game, 11 checks) |
| Measurement | `scripts/hunt-measure.mjs` (pure), `scripts/hunt-measure-ingame.cjs` (in game) |

## 1. Authority (§1, §12)

A hunt opens only when all four of these hold:

1. The doctrine data gives `pursue_quarry`. The evaluator runs `D.react(profile hirogen, role hunter, event prey_sighting, worthy_hunt_known)`.
2. The response is live for the profile: `DOCTRINE_PILOT.live` has `{ profile: 'hirogen', role: 'hunter', response: 'pursue_quarry' }`.
3. The power is configured to hunt: `config.hunts.hirogen`.
4. A real hunter is free (§15).

If the response is not live, the selection is recorded as `shadow: hunting not live` and nothing moves. `DOCTRINE_CONFIG_VERSION` is now 5, so saved configs pick up the new live entry.

The authority stamped on a hunt is `{ kind: 'hunt', source: 'hunter_role' }`. It never consults or writes war state:

- No hunt code path calls a war declaration, a relation change, a capture or a claim.
- Hostile encounter, predation and formal war stay separate families.
- An existing formal war stays exactly as it was (R24).

## 2. Hunt lifecycle and state matrix (§2)

A hunt is a doctrine objective with `kind: 'hunt'`. The generic objective close/work loops skip it; `workHunt` owns it.

**Fields on the hunt record**

| Group | Fields |
|---|---|
| Identity | `id`, `polity` |
| Hunters | `hunters[{hullId, vid, shipId}]` |
| Prey | `prey{vid, kind hull or captain, polity, hullIds, vids, shipIds, cls, estimate{strength, count, speed}}` |
| Why selected | `why{score, worth, ratio, band, factors, reason, hunterStrength}` |
| Knowledge | `lastKnown{systemIndex, day, source, heading}`, `lostSince`, `searched[]` |
| Budget | `budget{pursuitDays, searchDays, staleDays, maxEngagements}`, `startDay`, `deadline` |
| Progress | `phase`, `phaseHistory[]`, `engagements`, `encounterId`, `legsFlown`, `actions[]` |
| Ending | `result{result, reason, day}`, `closedDay` |

The cooldown and history live beside the record in `db.hunt`.

**Phases**

| Phase | Entered when | Hunters do | Leaves to |
|---|---|---|---|
| `evaluating` | the hunt opens | — | stalking / pursuing |
| `stalking` | fresh track, prey standing still | fly the shared journey to the prey's system | intercepting, engaged, searching |
| `pursuing` | fresh track, prey moving (a heading is known) or seen moved | fly toward the heading (re-plotted at a leg boundary) | intercepting, engaged, searching |
| `intercepting` | the hunters' current leg ends where the prey is expected | continue | engaged, searching |
| `searching` | track lost (older than `trackDays`) | visit the plan: heading, then last-known system, then its neighbours, each once | stalking/pursuing (reacquired), resolved (escaped) |
| `engaged` | hunters and prey stand in the same system on the same day: one encounter | nothing else; no strategic step touches the contact | pursuing (indecisive), disengaging |
| `disengaging` | the hunt closed | fly home on a `return` journey (or released where they stand) | resolved |
| `resolved` | every hunter is home or out | — | — |

**Status:**

- `active` while open.
- `completed` on target destroyed, target disabled or surrender accepted.
- `aborted` otherwise.

There is one record per prey: a second hunt is refused with `already hunted` when a candidate shares any hull vid with a live hunt's prey (R31). The prey is its hulls, not a group key. A contact belongs to a hunt when it holds any of the prey's vids, so a group that gains a lower-id hull, loses one or changes its lead is still the same prey (R10/R31b). Cooldowns are set on every prey vid, and expired cooldowns are pruned. A hunt is never recreated each tick. Selection runs every `evaluateEveryDays`, and only while the power has fewer than `maxActive` hunts.

## 3. Prey scoring (§3, §4, §16)

`r` = observed prey strength ÷ the strength of the hunting group actually available now.

**Worth by force ratio**

| Band | `r` | Worth | Verdict |
|---|---|---|---|
| trivial | < 0.3 | 0 → 0.1 | rejected: `trivial prey` |
| lesser | 0.3 – 0.7 | 0.1 → 1 | eligible if the score ≥ 0.45 |
| worthy | 0.7 – 1.5 | 1 | eligible |
| dangerous | 1.5 – 2.5 | 1 → 0.5 | eligible if the score ≥ 0.45 |
| reckless | 2.5 – 4, reckless doctrine only | the falling side stretched to 4 | eligible if the score ≥ 0.45 |
| overwhelming | > 2.5 (> 4 if reckless) | 0 | rejected: `too strong` |

**Score** = worth × class × confidence × reach + bonus. The factors are:

| Factor | Value |
|---|---|
| class | military 1; civilian (unarmed, no fighting value) 0.35 |
| confidence | source confidence × (1 − 0.5 × age ÷ `staleDays`). Source confidence: direct 1, contact 1, crossing 0.9, border 0.85, report 0.7 |
| reach | 1 − 0.3 × (reach days ÷ `maxReachDays`) |
| bonus | +0.1 if this hull class is the only one of its kind the power has seen; +0.2 if it slipped one of this power's hunts before (only after that cooldown) |

**Rejections, in order:**

1. `already hunted`
2. `cooldown until day N`
3. `knowledge stale`
4. `no route`
5. `beyond reach (N days)`
6. `too strong`
7. `trivial prey`
8. `below threshold (0.45)`

Reach is the planned journey days of the available group from its system. If no lawful route exists and the power's doctrine goes through in defiance (`treatyDefiance: 'when_no_lawful_route'`), reach is the route ignoring the treaty. The crossing is then an ordinary breach (§13).

Every evaluation keeps every candidate's verdict and reason in `db.hunt.selections` (last 5 per power, 12 candidates each), and the debug section shows them.

**Measured in game (HUNT-selection-debug.png).** Two Hirogen at the Range (one Warship free, strength 235) see four candidates:

| Candidate | Ratio | Score | Verdict |
|---|---|---|---|
| The captain's Sovereign (strength 180) | 0.77 | 0.899 | eligible, worthy — **chosen** |
| A Promelli pair | 1.66 | 0.657 | eligible, dangerous |
| A Son'a pair | 2.0 | 0.626 | eligible, dangerous |
| A Suliban pair | 0.04 | — | rejected, trivial prey |

The captain's starting ship (strength 19) is rejected as trivial: the Hirogen do not hunt a shuttle-class captain.

## 4. Knowledge and track rules (§5, §18)

What a power sees each day:

- **Direct.** Any system where one of its hulls stands.
- **Border.** Its held worlds and their neighbours.

A cloaked hull is invisible at border range and seen only directly.

A **departure sighting** is a hull that left a covered system within `trackDays`. It is recorded at that system, on its departure day, with the heading it left on (its first leg). That is a sighting, not a live track of where it is now.

Contacts are actor-specific, grouped by polity and system and keyed by the lead hull's vid. Each contact carries:

- the observed strength (the hull share is read only at direct range; border sees nameplate class strength);
- class, speed, cloak and heading;
- the first and last sighting day.

They are bounded to the freshest 40 per power and drop after three stale windows.

**The captain** is a contact only when standing in covered space (`world.captain`: class, hull share, escorts, course speed, cloak, heading). He is also a contact at a crossing on his warp course through covered space (`huntAtCaptainCrossing`). Neither hidden cargo, nor hidden equipment, nor an unseen battle record is ever read.

**Tracking a hunt's prey**

| Age of the last sighting | Hunt treats it as |
|---|---|
| ≤ `trackDays` (1) | a live track: the hunters fly to the prey's system or heading |
| > `trackDays` | **last-known**: `lostSince` is set, the phase becomes `searching`; the record keeps `lastKnown` as it was and never moves it to where the prey really is (R14) |
| > `staleDays` | the hunt ends `escaped` (knowledge too stale) |

**Search** (`searchPlan`) visits the last heading, then the last-known system, then its neighbours, each once. Nothing found at a visited system strikes it off.

The search ends `escaped` when either:

- `searchDays` have passed since contact was lost (R15); or
- every planned system has been searched.

**The player** learns of a hunt only through real sources:

| What happens | What the player gets |
|---|---|
| A hunter stands in his system when the hunt on him opens | "Hirogen vessel is shadowing your course." |
| He has been shadowed or engaged, and the hunters are on their intercepting leg | "Hirogen hunters are closing." (his crew is already tracking the shadow) |
| The interception scene opens | "Hirogen Hunt — Engaged" (log and panel) |
| The hunt on him ends out of his own engagement that day | "Hirogen hunters disengaged." |
| A hunt on another ship | the existing intel path (`reportDoctrineTrace`: a local observation, a relay or fleet report, or a rumour). No global announcement. |

## 5. Pursuit on the shared journey system (§6, §13, §14)

Hunters fly `startJourney` with `kind: 'hunt'` and `ref` = the hunt id. The journey uses:

- the route `plotJourney` plots;
- leg days at the group's own speed (`hullsSpeed`);
- the same crossings, treaty checks, blockade runs and save/load as every other mover.

A change of target while under way is a pending replot (`tr.pending`), taken at the next leg boundary. When a hunt closes, its journey turns into a `return` home. There is no separate movement model.

**Treaties.** A DMZ or other bar on the way:

- Lawful route exists → it is taken.
- No lawful route, and the doctrine allows defiance → the journey goes with `treatyDefy`. The crossing is an ordinary treaty breach recorded by the treaty system (`dmz_entry` by the Hirogen, R25). A breach is not a war.
- No lawful route, and no defiance → the hunt is `blocked` and abandons after `searchDays`.

**Blockades.** Run through the shared resolver under the hunt's journey key (R26). There is no Hirogen rule.

**Speed.** Faster prey slips the hunters more often (`escapeChance`); a faster hunter group makes an intercept feasible where a slower one is too late (`interceptEstimate`).

| Measure | Fast prey | Slow prey |
|---|---|---|
| Escape chance vs 1.2× Hunters (R12) | 0.40 (1.6× cruiser) | 0.05 (0.6× cruiser) |
| Escapes in 20 seeded contacts | 7 | 1 |

R13: to a prey at Vega with a ten-day window, the 1.2× Hunter arrives in time and the 0.7× Hunter does not.

**Chart time scale.** The budgets are written for a chart whose typical leg is 6 days. On a chart with longer legs, every day budget stretches by the median-leg ratio, measured once per campaign:

- reach, pursuit, search;
- staleness;
- both cooldowns.

The real chart's median leg is 12 days, so its scale is 2. The pure fixture's scale is 1.

## 6. Contact, encounter and tactical handoff (§8)

**Contact.** Hunters and prey stand in the same system on the same day. Exactly one encounter opens (`SE.openEncounter`, type `hunt`), keyed `hunt:<id>:<day>:e<n>`. While it is live, `workHunt` does nothing else: there is no parallel strategic step and no strategic damage (R28).

| Where | Who resolves it |
|---|---|
| Not in the captain's system | the strategic resolver, once, now: an escape roll, else one bounded exchange scaled by the force ratio; a prey under 25% may strike (35%) |
| The captain's system (`world.localSystem`, never when he is in warp) | held `pending` for the scene. From the next day the shared `settleAbandonedHandoff` rule applies, as for every other family: a pending contact he is no longer at falls back to the strategic resolver once, and an engagement fought where he no longer is gets disengaged. A hunt is never held "engaged" by a scene nobody will fight (R28, R28c). |
| The captain is the prey | held for the scene, either standing where he is (the hunters arrive) or at a crossing on his warp course (`captainCrossingCheck` returns `{ type: 'hunt', encounterId }`, and the course stops there) |

**In the scene.** The hunt's own Hirogen hulls are spawned:

- same vids;
- same classes;
- the hull share of their records.

They are hostile to the captain, and their fates are written back to the same hulls.

**How the scene can end (captain as prey)**

| Captain does / scene state | Encounter outcome | Hunt result |
|---|---|---|
| Destroys or disables every hunter | `hunters_beaten` | `hunter_lost` / `hunter_disabled` |
| Breaks away (warps out) | `escaped` | `prey_escaped`; cooldown `escapeCooldownDays` |
| Strikes (**Surrender** button on the hunt panel) | `surrendered` | `surrender_accepted`: "an unsatisfying end" |
| His ship is disabled | `prey_disabled` | `target_disabled` |
| Hunters driven off but not beaten, or the window runs out | `disengaged` | `abandoned` (the hunters broke off) |
| The scene could not be made | fallback | `abandoned`: the hunters broke off. Nothing is fought off-scene for the captain, and no escape is credited for a contact never fought. |

## 7. Termination rules (§7, §9, §10)

These are checked each day in `huntTermination`, first match wins, plus the engagement outcomes:

| Rule | Result | Status |
|---|---|---|
| Objective cancelled | `cancelled` | aborted |
| Every hunter destroyed | `hunter_lost` | aborted |
| No hunter able to fly | `hunter_disabled` | aborted |
| After an engagement, the lowest able hunter < 50% hull | `abandoned` (hunters need repair) | aborted |
| Prey ÷ hunters now > 2.5 (4 if reckless) | `abandoned` (hunters no longer adequate) | aborted |
| More than `pursuitDays` since start | `escaped` if lost, else `abandoned` | aborted |
| Last sighting older than `staleDays` | `escaped` | aborted |
| Lost for more than `searchDays`, or every planned system searched | `escaped` | aborted |
| Blocked by a treaty with no defiance for more than `searchDays` | `abandoned` | aborted |
| Prey destroyed | `target_destroyed` | completed |
| Prey disabled | `target_disabled` | completed |
| Prey surrendered | `surrender_accepted` (unsatisfying) | completed |
| Prey slipped at contact | `prey_escaped` | aborted |
| `maxEngagements` (2) indecisive engagements | `abandoned` | aborted |

**Closure:**

- The hunters fly home, or are released where they stand if they cannot fly.
- A cooldown is set: `cooldownDays` 45, or `escapeCooldownDays` 60 after an escape, both scaled.
- If the doctrine is switched off (`releaseDoctrineHulls`), hunts still get their own closure record: result `cancelled`, history and cooldown. Hunters in warp are turned home by the hunt journey's `valid` check and released where they arrive or halt. No hull is left assigned to a closed hunt.
- Treaty defiance is decided again for each route: a redirect never inherits an earlier leg's `treatyDefy`.
- History is kept, bounded to 30 per power.
- After closure there are no more pursuit orders and no new encounter (R30).

**Surrender** follows Phase 4 semantics:

- Fire stops at once: the captain's surrender hold blocks all NPC fire, and struck NPC hulls keep `surrendered` status.
- The hunt closes and is never reopened.
- There are no prisoners and no trophies. The captain is released when the hold ends.

## 8. Hunters (§15, R7, R8)

Hunters are the power's own hulls of a hunter class (any hull with fighting value), and nothing is spawned for a hunt. A hull is available when it is:

- ready, with no op;
- not in transit or in an encounter;
- able to travel, at ≥ 70% hull;
- not over the commitment cap: the power never commits more than `committedShareMax` (0.67) of its hunters.

A hunt is at most `groupMax` (2) hulls from the system holding the most free hunters. With no hunter available, the selection is `deferred: no free hunter` and nothing moves.

The hunters' and prey's vids never change (R9, R10).

## 9. No capture, no occupation, no war (§11, §12)

A hunt has no capture, claim, occupation, relation or war code path. Hunters may:

- enter foreign space (lawfully, or as an ordinary treaty breach);
- stalk and strike;
- withdraw.

They never take a world or declare a war:

- **R22–R24 (pure).** Forty days of hunting with an existing Hirogen–Romulan war leave every holder and relation as they were.
- **NO-CAPTURE-NO-WAR (in game).** Two hundred days give the same result.
- **Long runs.** See §11.

## 10. Live vs shadow matrix

| Situation | Doctrine | Live entry | `config.hunts` | Result |
|---|---|---|---|---|
| Hirogen, worthy prey seen, a hunter free | `pursue_quarry` | present | present | **live**: the hunt opens, the hunters fly |
| Same, live entry removed | `pursue_quarry` | absent | present | **shadow**: `shadow: hunting not live` recorded, counted `huntShadow`, nothing moves |
| Profile whose doctrine does not give `pursue_quarry` | other | — | present | `doctrine: <result>` recorded, nothing moves |
| Power not in `config.hunts` | — | — | absent | not evaluated |
| No free hunter | `pursue_quarry` | present | present | `deferred: no free hunter` |
| Doctrine package not loaded | — | — | — | the step runs only to release hunters a save left on a hunt |

## 11. Baseline (c0a5890): generic Hirogen

The baseline reproduction (`scripts/hunt-gate.cjs` and `scripts/hunt-test.mjs` with `BM1_TEST_ROOT` / `BM1_HUNT_ROOT` = a c0a5890 worktree) shows:

- **The hulls sit at home.** With the captain in a Sovereign at the Suliban Helix (beside the Range), over 120 days the Hirogen Range's three campaign hulls never move: `[[99,ready],[99,ready],[99,ready]]`.
- **No hunt state of any kind.** There are no operations, no doctrine live entry for the Hirogen, and no hunt API.
- **Hostility is generic.** It shows up only as hostile local traffic and the budgeted ambient raid draw (`chooseActivityAttacker`, `campaignRaidForce`, `launchBudgetedAmbientRaid`, `spawnFleetAttack`). No prey is selected and nothing is remembered.

| Suite | c0a5890 | Candidate |
|---|---|---|
| Pure suite | 3/23: preservation 3/3; baseline-defect R2 fails on its own assertion ("no hunt on an observed worthy quarry"); new-feature 0/19 | 23/23 |
| In-game gate | 1/11: preservation 1/1; baseline-defect HUNT-SELECTION fails on its own assertion ("no hunt on the captain"); new-feature 0/9 | 11/11 |

## 12. Long-run measurement

**Pure** (`npm run measure:hunt`): 4 seeds × 400 days, every routine on, each seed also run with hunts off as the control.

| Metric | Value |
|---|---|
| Hunts opened | 19 |
| Completed | 1 (target destroyed) |
| Escaped | 3 |
| Abandoned | 15 (mostly "hunters need repair" / "no longer adequate" after an even exchange; the rest broke off after their engagements) |
| Hunter losses | 0 hunts lost to hunters, 0 hulls |
| Pursuit duration | average 5.7 days, max 11 |
| Distance | 1.0 legs on average |
| Duplicates prevented | 0 (selection never re-offered a hunted prey: `maxActive` 1) |
| Cooldowns | 19 set; 338 evaluations rejected a prey on cooldown |
| Prey | 19 military, 0 civilian |
| World captures by hunting | **0** (captures with hunts on vs control: 0 / 0) |
| Formal wars by hunting | **0** (wars on vs control: 0 / 0) |
| Hirogen hull at home | ≥ 98% of days |
| Hirogen hull-days committed to hunts | ≤ 6.5% |
| Same prey hunted again | seed HM-3: one Romulan patrol hunted 7 times, each after its cooldown (shortest gap 47 days, cooldown 45). That is bounded, but a patrol that keeps returning to Hirogen space keeps getting hunted. |
| Save state | 15–31 KB of hunt state per campaign (6–13% of a ~240 KB book). It does not grow with time: cooldowns are pruned when they expire, history and selections are capped, closed hunts fall under `closedLimit`. |

**In game** (`npm run measure:hunt:ingame`): real chart and engine, 400 days, captain at Earth and captain parked beside the Range, each with a hunts-off control.

| Metric | Captain at Earth | Captain beside the Range |
|---|---|---|
| Hunts opened | 1 | 3 (one on the captain) |
| Results | 1 abandoned | 3 abandoned (the contact with the captain is left unanswered in this run, and an unfought scene counts as the hunters breaking off) |
| Hunt duration | 34 days | average 21 days, max 37 |
| Hunter losses | 0 | 0 |
| Hunt state | 11 KB, flat | 17–20 KB, flat |

Across both in-game runs:

- **Captures.** World captures taken by or from the Hirogen: **0**.
- **Wars.** Every Hirogen war entry comes from the diplomatic calendar ("A border incident spikes tensions"). The hunts-off control shows the same entries, and the Hirogen declared nothing.
- **Captain.** He is hunted once in 400 days beside their space; he is not chain-hunted.
- **Home.** A Hirogen hull is at home on 95–100% of days.
- **Open hunts.** None left open past its budget.

**Watch list**

| Concern | Status |
|---|---|
| Hirogen abandoning their duties | no: home coverage ≥ 95%, commitment ≤ 6.5% |
| Endless pursuits | none: longest 11 days pure, 37 days in game at scale 2 |
| Weak-civilian farming | none: all prey military; civilian factor 0.35 and the trivial band reject it |
| Player chain-hunted | no: once in 400 days beside their space; escape cooldown 120 days at scale 2 |
| Hunts becoming wars | 0 |
| Capture side effects | 0 |
| Hidden-information leaks | none: contacts come only from direct, border and departure sightings; cloak hides at border; hidden cargo and equipment are never read |

**Finding (tuning).** Worthy prey is, by design, about the hunters' own strength. Two indecisive exchanges usually leave the hunters needing repair, so strategic hunts rarely end in a kill: 1 of 19 in the pure runs. This matches "disengage when no longer worthwhile", but the exchange shares (`strikeShare` 0.35, `returnShare` 0.25) and `maxEngagements` (2) are the knobs if kills should be more common.

**Measurement note.** The in-game hunts-on and hunts-off runs diverge in the unrelated Klingon–Terran war after about day 150. The campaign's id counter is shared, so hunt journeys and encounters shift every later id and the seeded draws keyed by them. The attribution checks therefore look at the Hirogen directly (captures by or of them, war declarations by them, the reasons of their war entries), not at a whole-galaxy diff.

## 13. Independent review (a0d81f1) and fixes

An independent review of the first commit found the following; all are fixed in the candidate:

| # | Severity | Finding | Fix | Regression |
|---|---|---|---|---|
| 1 | high | A hunt lost its prey when a lower-id hull joined the prey's group (the contact key changed); the hunt searched and ended `escaped` with the prey sitting still, and the cooldown and duplicate checks could be bypassed the same way | prey matched by hull vids; cooldowns per vid | R10/R31b (fails on a0d81f1) |
| 2 | medium-high | `Number(null) === 0`: a contact at system 0 during the captain's warp was held for a scene forever | `localSystem != null` | R28c (fails on a0d81f1) |
| 3 | medium | No safety net for an engagement the captain had left | shared `settleAbandonedHandoff` | R28 |
| 4 | low-medium | Hunters of a hunt aborted by `releaseDoctrineHulls` could stay assigned through a pending redirect | `valid` checks hunt status first; release on arrive/halt | — |
| 5 | low | Hunts aborted by `releaseDoctrineHulls` had no result, history or cooldown | closure record | — |
| 6 | low | Treaty defiance stuck to later redirects | re-decided per route | — |
| 7 | low | "Hunters disengaged" sent on any closure once aware | only out of his own engagement that day | gate R29 |
| 8 | low | A stale enforcement record could release a hunt surrender at once | system check only for enforcement surrenders | — |
| 9 | low | A failed captain scene was credited as his escape | `abandoned` | — |

**Two earlier gates pinned.** The full suite on 47c0d3d found two earlier in-game checks that assumed no hunts. Neither is a behaviour change.

- **`test:doctrine:ingame`** counts every doctrine objective; a hunt is a new kind. Its `__quiet` now quiets hunts as it quiets every other routine.
- **`test:playtest:gate` DOM single-long-jump** pins a seeded battle history. With hunts off, advancing the shared id counter by one on day 2 flips that seed's fourth stage from `invasion` to `withdrawn`. That scenario now runs with no hunts.

Both pass at cecf293. The source is unchanged from 47c0d3d.

## 14. Not implemented this round (by the brief)

- trophy or prisoner economy;
- a permanent prey reputation beyond the bounded history and cooldown;
- occupation;
- autonomous war declarations;
- broad covert doctrine;
- Borg, Gorn, Tactical Cube.

The captain's own fleet ships (the `player` polity's mirrored hulls) are not prey this round. The captain himself is.

## 15. Carry-forward (unchanged from c0a5890, plus this round's)

- `restrict.reinforcement` / `restrict.offensive` treaty consumption
- `blockade_in_dmz` incident semantics
- stationing-only DMZ authoring through `parseClause`
- AI proactive staging-base selection
- a military trader inside a newly activated DMZ should leave it before holding
- `fleetPassageRouteNote` lawful-route wording
- the outbound tug's delay in learning its casualty was destroyed
- trader inspection refusal policy
- NPC tactical-scene persistence
- engine-condition strategic-speed degradation
- low-confidence speed tuning
- dedicated-tug speed tuning
- multi-tug towing
- allied recovery
- towed-hulk tactical rendering
- unauthorized foreign salvage incident
- captain crew-survival clock
- autonomous war declarations
- doctrine invasion / occupation
- broad covert doctrine
- Borg, Gorn, Tactical Cube
- **new:** the captain's fleet ships as hunt prey
- **new:** hunt exchange tuning (kill rate, see §12)
- **new:** the shared campaign id counter makes on/off controls diverge (measurement hygiene)
- **new:** a prey that keeps returning to Hirogen space is hunted again after each cooldown (bounded; a longer memory would be the excluded prey-reputation system)
