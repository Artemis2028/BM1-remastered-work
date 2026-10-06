# CAPTAIN AS BORG ASSIMILATION TARGET — FAILURE STATE ONLY

Stacked on the accepted, frozen Borg Assimilation + Transwarp tip `1eceab37c1d3d8b31c21e1e3f3fe321e577f2c73`; everything accepted through it is preserved. Nothing has been pushed, merged or deployed.

The captain's personal vessel can now be Borg prey, chosen by exactly the rules any vessel is chosen by. The Collective may pursue him, disable him and begin assimilating him in his own scene. If he fails to escape or stop them, **the run ends: CAPTAIN ASSIMILATED**.

It is a terminal failure state, not a faction transfer. There is:
- no Borg captain;
- no command of Borg fleets;
- no conversion of his empire, worlds, fleet, treaties, standings or contracts;
- no continued play.

| Piece | Where |
|---|---|
| Pure rules: scene progress step, stages and their lines, three config values | `src/borg-doctrine.mjs`: `captainProgressStep`, `captainStage`, `CAPTAIN_STAGE_TEXT`, `BORG_DEFAULTS.captainAssimilateSeconds / captainStages / captainLethalBelow` |
| Campaign layer: knowledge, selection, pursuit, contact, progress record, completion, crossings, debug | `src/borg-campaign.mjs`: `recordCaptainContact`, `coverOf`, `workCaptain`, `engageCaptain`, `captainAssimilationTick`, `completeCaptain`, `borgAtCaptainCrossing`, `captainDebug`; re-exported by `doctrine-campaign.mjs` |
| Engine | `src/main.js`: the crossing check, scene spawn (hostile, disabling fire), decision, per-frame countdown, recovery block, loss settlement, terminal state and menu, save refusal, debug row; `index.html`: two terminal buttons |
| Regressions | `scripts/borg-captain-test.mjs` (pure, 18 checks), `scripts/borg-captain-gate.cjs` (in game, 13 checks) |
| Measurement | `scripts/borg-captain-measure-ingame.cjs` |

## 1. Target selection (§1)

The captain is **one more ship contact**. The same observation produces it, the same value and score judge it, and the same verdicts reject it.

**Seen only where a Borg sensor covers him**
- **Direct:** a Borg hull stands in his system.
- **Border:** a Borg-held world or one of its neighbours.

**Hidden**
- Not in cover: he is never a contact, and nothing about him is known.
- An active cloak hides him from every Borg sensor.
- A cloak-capable class is not seen at border range. This is the rule for every vessel.

**When he is seen**
- **Standing in a covered system on a campaign day:** the daily pass (`observe`).
- **Crossing a covered system on his course:** `borgAtCaptainCrossing`, called from `captainCrossingCheck` after the hunt check. In warp he stands nowhere.

**What is recorded:** the vessel contact fields — class price, mass, category, class cloak; strength from his hull share up close, full at border range; subdued, speed, system, day, source and heading. Only his own hull counts: his escorts are his fleet, not targets (the existing rule for player-fleet hulls).

**Value and score:** `shipValue` and `scoreTarget` unchanged. There is no captain factor and no bias. Measured with the same class at the same place, the captain and an NPC hull get an identical value, score, factors, verdict and movement plan (C4).

**Rejections:**
- "no technology worth acquiring": his starting Saber (19,000 L) at Astron is rejected every evaluation;
- "too strong to take";
- "below threshold";
- cooldown, staleness, no route — all as for any vessel.

**One objective per target.** The captain is one target whatever vessel he flies (duplicate check by kind). At most one objective is active per Borg power (`maxActive`, unchanged).

**Config:** `borg.captain: false` excludes him (the same switch shape as `ships` and `worlds`).

**Doctrine:** unchanged, and it decides. The same `technology_discovery → assess_technology` reaction, the `assimilation` engagement mode in role `raider`, and the live entry `{borg, commander, assess_technology}`. Shadow without it.

## 2. Pursuit and contact (§2, §3)

**Pursuit is the existing objective and movement.**
- The persistent `assimilation` objective, now with `targetKind: 'captain'`.
- The Collective's own hulls; none is made.
- `moveForce` by the accepted rules: conventional legs or a transwarp journey. In game, Vex ⇒ Astron is about 9 days conventional against a 2-day transwarp, which is chosen.
- The same knowledge budget (track, search, stale) and the same ending rules.

**Contact** comes when the force and the captain stand in one system on one day, or when the force stands where he crosses.

**`engageCaptain` opens one encounter**, always his scene:
- `captain: true`, `playerHostile: true`;
- participants: the Borg hulls only (he is not a model hull);
- `contact.targetKind: 'captain'`, `contact.captainVid`.

**At a crossing his course stops there:** `stop.type: 'assimilation'`, with the shared `warpResume`.

**Nothing about him is decided off-scene:**
- no strategic damage, and no strategic assimilation;
- a contact with no scene falls back to the model once as `disengaged`, and nothing is fought (C9);
- a contact he leaves is decided by the engine's leaving rule (§6).

**The scene** (`spawnStrategicEncounter`):
- The cube is spawned with its own vid, hostile to him.
- **Disabling fire** (§3): `npc.fireIntent = 'disable'` uses the fleet "Attempt to disable" rules already in `fleetFirePermitted`:
  - hold on a vessel seen or reported disabled;
  - use only the lightest weapon on one reported critical.
- Once the Borg vessel is below `captainLethalBelow` (50%) of its hull, it fights to kill like any vessel. If he fights back heavily, destruction stays a normal combat outcome.
- Interceptors already stop targeting a disabled captain (existing rule).
- Message: "Borg vessel is attempting to disable your ship."

**Measured scene fact (not changed; carried forward).** Against an Inquiry Class, the cube's own scene weapon (default weapon 5) takes about 1% of his shields per shot, one shot every ~3.8 s. A healthy captain is therefore not disabled inside one 60-s engagement window. Disabling him takes a captain already badly hurt.

## 3. Assimilation progress state machine (§4, §5)

The progress is the objective's own record (`o.progress`), so it is saved with the campaign. It runs on scene time, not days: a disabled captain cannot travel, so no day passes for him.

`captainProgressStep({ progress, dtMs, subdued, assimilatorPresent, borgAlive })` is called each frame by `captainAssimilationTick`. A frame's step is capped at 250 ms.

| State | When | Progress |
|---|---|---|
| `attempting` | he is not subdued (operational) | 0; it starts over if he was subdued and is no longer ("Assimilation interrupted.") |
| `assimilating` | subdued (his vessel disabled, him aboard it) **and** an assimilating Borg vessel is in the fight in the scene | + dt / 60 s (`captainAssimilateSeconds`) |
| `held` | subdued, but no assimilator able in the scene | unchanged |
| `stopped` | no Borg vessel left in the fight | unchanged; the contact then ends (below), and the objective's closure marks it `interrupted` |
| `completed` | progress reaches 1 | 1; the scene reports `captain_assimilated` |

**Lines, each once, as the stage is reached:**
- "Assimilation in progress."
- "Assimilation 35%"
- "Assimilation 70%"
- "Assimilation imminent." (90%)

The disabled panel shows "Assimilation N%" while it runs. "Present" means an assimilator class (`assimilator: true`, the Assimilation Cube) in the scene and still in the fight. No proximity rule and no drone boarding are modelled.

### The contact's decision (`captainBorgDecision`)

| Situation | Outcome | Objective |
|---|---|---|
| he leaves the system (warp) | `escaped` | `target_escaped`, cooldown on his vessel |
| he is no longer aboard the target vessel (command transfer, a new vessel) | `escaped` | `target_escaped` |
| no assimilator left in the fight, and every Borg vessel left the scene | `borg_withdrew` | `abandoned` ("the Borg withdrew"), progress interrupted |
| no assimilator left in the fight (destroyed or disabled) | `borg_beaten` | `borg_destroyed` / `borg_disabled`, progress interrupted |
| progress 1 | `captain_assimilated` | completed (`target_assimilated`); terminal state (§4) |
| subdued | — (no window: the countdown governs) | — |
| not subdued, the 60-s engagement window ran out (from contact, or from when he got moving again) | `fought` | goes on (`approach`); at 3 engagements `abandoned` |
| his ship destroyed (hull 0) | `target_destroyed` (`settleCaptainBorgOnLoss`) | `target_destroyed`; the ordinary game over follows |

## 4. Terminal failure lifecycle (§7, §8, §11)

`captain_assimilated` closes the objective as completed and records it in `db.borg.captainAssimilations`:
- `captainVid`, `shipId`, `force` (Borg vids), `systemIndex`, `day`, `objectiveId`, `encounterId`, `result`.

It emits one effect. The engine's `enterCaptainAssimilated` is entered once (a second call returns false):
- `state.gameOver = true`, `gameOverCause = 'assimilated'`;
- `state.captainFailure` holds the same record;
- input is cleared;
- the line "CAPTAIN ASSIMILATED".

**The terminal menu** (`syncGameOverMenu`):
- Title "CAPTAIN ASSIMILATED"; text "Your ship has been assimilated by the Borg."
- **Reload last save (slot N)**, disabled with "No save to reload" when the slot is empty.
- **Main menu.**
- Restart and Escape Pod are hidden for this cause. `restartInEscapePod` refuses it.
- Nothing is loaded automatically.

**After it:**
- Saving is refused ("Captain assimilated: this run cannot be saved."): no slot is written.
- The run is over: `tick` returns, no day passes, departures do nothing.
- Loading a save or starting a run clears the cause.

**Nothing converts** (C19/C21/C22, CAP-NO-CONVERSION):
- flag, faction, worlds, fleet, player hulls, treaties, standings, Borg licences and Borg-held worlds are byte-identical before and after;
- `polityCanBuildDesign(borg, his class)` stays false;
- there is no Borg command UI.

The withdrawing cube's "Borg contact lost." is not shown after the end.

## 5. Emergency recovery (§10)

While a captain-target Borg contact is live in his system, `getRecoveryStatus` returns unavailable: "Emergency recovery unavailable during active Borg contact." `recoverDisabledPlayer`, the panel button and the distress hail all go through it.

When the contact ends (Borg beaten, withdrawn, escaped, fought), the normal disabled-player state applies and recovery works again. A recovery started before a contact is not cancelled.

## 6. Save/load (§9)

These are kept across a save and load:
- the objective;
- the encounter;
- the Borg vids and his vessel;
- the progress (the objective record);
- his disabled state (the fleet book).

**Engine limit (accepted, documented):** an active scene reloads as "restarted from contact". The encounter goes back to `pending` and the same cube respawns at weapons range. The progress continues from the saved value; it is not reset and not faked forward.

So a save made late in the countdown resumes late in the countdown. The gate measured the end coming 34 s after reloading a save made at 46%: the remaining 54% of the countdown (32 s) plus the scene restarting. He still has to be held for the remainder. Earlier slots stay available.

The scene clock (`captainBorgClock`) is never saved. It is cleared on load and on respawn.

## 7. Debug (§12)

The "Borg assimilation" section gains a **Captain as target** row:
- his vessel vid and class;
- what the Collective knows (system, day, source, strength, hull, cloak, subdued);
- value and score at the latest evaluation with verdict and reason;
- the objective id, phase and engagements;
- progress and state;
- the Borg force;
- handoff;
- the failure state if completed.

The objectives table names "the captain" as target. The summary counts captain targets.

**Stats:** `borgCaptainTargets`, `borgCaptainEscapes`, `borgCaptainBorgDefeats`, `borgCaptainDestroyed`, `borgCaptainAbandoned`, `borgCaptainAssimilations`, `borgCaptainAssimilationsBegun`, `borgCaptainAssimilationsReset`.

## 8. Regressions

**Pure: `npm run test:borg:captain` → 18/18.** At 1eceab3: **4/18** — preservation 4/4; baseline-defect C2 fails on its own assertion ("no objective on an observed valuable captain: no target known"); new-feature 0/13.

**In game: `npm run test:borg:captain:ingame` → 13/13.** At 1eceab3: **1/13** — preservation CAP-OUT-OF-COVER 1/1; baseline-defect CAP-SELECTED fails on its own assertion ("no captain objective: no target known"); new-feature 0/11.

| Brief | Pure | In game |
|---|---|---|
| 1 hidden captain not selectable | C1 (no cover; active cloak; cloak class at border; direct seen) | CAP-OUT-OF-COVER |
| 2 observed advanced captain selected | C2 (baseline-defect) | CAP-SELECTED (baseline-defect) |
| 3 low-value rejected | C3 (shuttle; also "too strong") | CAP-LOW-VALUE (his Saber) |
| 4 same scoring as NPC ships | C4 | — |
| 5 no omniscient bias | C5 | CAP-OUT-OF-COVER |
| 6 real Borg hulls | C6 | CAP-SELECTED, CAP-TRANSWARP-HANDOFF |
| 7 same conventional/transwarp rules | C7 (incl. cooldown) | CAP-TRANSWARP-HANDOFF |
| 8 handoff once | C8 | CAP-TRANSWARP-HANDOFF |
| 9 no parallel strategic damage | C9 | CAP-TRANSWARP-HANDOFF, CAP-ESCAPE |
| 10 subdued first | C10/C11 | CAP-SUBDUED-FIRST |
| 11 advances while present | C10/C11 | CAP-PROGRESS-SAVE-LOAD |
| 12 destroying Borg stops it | C12 | CAP-BORG-DEFEATED |
| 13 Borg withdrawal stops it | C13 | CAP-BORG-WITHDRAWAL |
| 14 escape aborts | C14 | CAP-ESCAPE |
| 15 recovery blocked | — | CAP-RECOVERY-BLOCKED |
| 16 recovery works after contact | — | CAP-BORG-DEFEATED |
| 17 save/load keeps progress | C17/C18 | CAP-PROGRESS-SAVE-LOAD |
| 18 no duplicate after reload | C17/C18 | CAP-PROGRESS-SAVE-LOAD |
| 19 terminal exactly once | C19 | CAP-ASSIMILATED |
| 20 reload / main menu | — | CAP-ASSIMILATED, CAP-RELOAD-MENU |
| 21 no conversion | C19/C21/C22 | CAP-NO-CONVERSION |
| 22 no session continues | — | CAP-NO-CONVERSION |
| 23 NPC ship assimilation unchanged | C23 (identical with an unseen captain) | `test:borg:ingame` 9/9 |
| 24 world assimilation unchanged | C24 | `test:borg` 25/25 |
| 25 transwarp unchanged | C25 | `test:borg` / `test:borg:ingame` |

**Integrated CAPTAIN-BORG-ASSIMILATION (in game)**, the captain in an Inquiry Class at Astron:
1. The Collective sees him (border, value 0.71, score 0.60) and opens the objective.
2. Transwarp Vex ⇒ Astron (9 d against 2 d).
3. One encounter in his scene.
4. **Branch A, CAP-ESCAPE:** he warps out before he is disabled → `target_escaped`, cooldown, no progress, no strategic damage.
5. **Branch B, CAP-BORG-DEFEATED:** disabled at ≥ 20%, the cube is destroyed → `borg_destroyed`, progress interrupted, recovery available and working.
6. **Branch C:**
   - CAP-SUBDUED-FIRST: badly hurt, the cube's own fire disables him; then CAP-PROGRESS-SAVE-LOAD.
   - CAP-ASSIMILATED: 35% → 70% → imminent → CAPTAIN ASSIMILATED once; reload / main menu offered.
   - CAP-NO-CONVERSION.
   - CAP-RELOAD-MENU: the reload is the player's click; the countdown has to run again.

## 9. Long run (`npm run measure:borg:captain:ingame`)

Every campaign routine is on, and days pass through the normal calendar.

| Campaign | Days | Captain objectives | Contacts (policy → result) | Assimilations | Escapes | Borg defeats | Recovery blocks / bypasses |
|---|---|---|---|---|---|---|---|
| parked 1 (Inquiry at Astron) | 200 | 2 | hurt → assimilated (60 s after disable; reloaded the start-of-day save); escape → escaped; healthy → fought; destroy → `borg_destroyed` | 1 | 1 | 1 | 6 / 0 |
| parked 2 | 200 | 2 | healthy → fought; escape → escaped; hurt → assimilated (61 s); escape → escaped | 1 | 2 | 0 | 6 / 0 |
| parked 3 | 200 | 2 | escape → escaped; destroy → `borg_destroyed` | 0 | 1 | 1 | 0 / 0 |
| elsewhere (Inquiry around Earth) | 200 | **0** | none (never evaluated) | 0 | 0 | 0 | — |
| low value (Saber at Astron) | 120 | **0** | none ("no technology worth acquiring", or no free force) | 0 | 0 | 0 | — |

Across all five, these are all 0:
- formal wars or diplomatic pairs involving the Borg;
- duplicate or concurrent captain objectives;
- Borg licences;
- recovery bypasses;
- reload loops (no completion within 10 s of a reload).

Each completion came ≥ 60 s after the disable, so there was no instant finish. The checks are in the measure's own pass/fail list (10/10).

**Watch list**

| Concern | Status |
|---|---|
| Borg constantly targeting the player regardless of value | No. Only when seen in a valuable hull: away from Vex, 0 evaluations in 200 days; in a Saber beside Vex, rejected on value. After an escape his vessel cools for ~120 days on this chart. |
| Unavoidable assimilation | No. Escape before disable and destroying or driving off the cube each end it. A healthy Inquiry is not disabled in a window (§2). |
| Assimilation finishing instantly | No: 60 s of continuous subdual with an assimilator in the fight. |
| Emergency recovery bypassing it | No: blocked during contact (12 blocks, 0 bypasses). |
| Repeated game-over loops after reload | None measured. A save made late in a countdown does resume late (§6). |

## 10. Not implemented (by the brief)

- a playable Borg captain or player Borg faction mode
- a drone economy or drone boarding simulation
- prisoner or trophy systems
- the Tactical Cube
- full NPC tactical-scene persistence
- ordinary invasion or occupation doctrine
- any minigame

## 11. Carry-forward

**Unchanged:**
- carrier/conduit access for non-capable Borg craft
- Borg repair/regeneration of assimilated hulks — *done in `BORG-HULK-REGENERATION.md`*
- defenders retaking assimilated worlds
- assimilated-world population/industry consequences
- Tactical Cube
- NPC tactical-scene persistence
- the treaty/trader/towing/speed backlog
- Hirogen hunt tuning/re-hunt memory
- autonomous war declarations
- doctrine invasion/occupation
- broad covert doctrine
- Gorn activation

**New this round:**
- **Borg scene weapon tuning.** The cube's scene weapon cannot disable a healthy advanced captain inside one engagement window (§2), so in ordinary play an assimilation needs a captain already badly hurt.
- **Contacts happen only at crossings or on campaign days he stands still.** Days pass only while he travels (no stationary campaign clock). A parked captain is reached only when days pass by other means.
- **Command transfer during the countdown** ends the contact as escaped, through the vid check. It is not exercised by a gate this round.
- **The old personal vessel left disabled after a command transfer** becomes a fleet vessel. Player-fleet hulls are not Borg targets this round.
