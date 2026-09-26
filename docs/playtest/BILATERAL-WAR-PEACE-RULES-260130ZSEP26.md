# Bilateral war and peace — rules

DTG 260130ZSEP26 · base `c528f75` · written before any runtime change in this round

Peace is a **state transition across the campaign**, not a label change. It concerns exactly one pair of powers. When it happens, it has to reconcile six things:
* the diplomatic record;
* live operations;
* war-generated objectives;
* future operation planning;
* occupied territory;
* reporting.

Save/load must carry the result.

## 1. State model

The formal relation between two parties is one record per unordered pair. Terran↔Klingon and Klingon↔Terran are the same key (`pairKey`, sorted). The record's `status` is one of:

| status | meaning | who may shoot | operations | territory |
|---|---|---|---|---|
| **peace** | no state of war. Says nothing about liking each other | nobody, except in self-defence or as a fresh incident (§6) | none between the pair; planning can't target the other | as held; open disputes stay open |
| **crisis** | peace under strain: tension ≥ 70 after incidents | as peace | as peace | as held |
| **war** | a declared state of war, with a numbered **war instance** (`warId`, `warStarted`) | either side may target the other | planned and launched against the other's worlds | captures create **occupied** territory |
| **ceasefire** | fighting suspended, no political settlement yet | as peace. Breaking it by attack is an incident that re-opens war as a **new** instance | all operations between the pair stood down; no new ones planned | occupation **unresolved**: stays *occupied* |

No separate *truce* state. A ceasefire is the truce: it is time-bounded by the evaluator (it either settles into peace or breaks). A fifth label would add a state with no different behaviour.

Separate facts that are **not** the formal relation, and never change it:

* **Standing** (reputation, −100…100) is how a power regards the captain. It gates service, prices and access. It moves on kills and trade. Peace doesn't reset it; war doesn't set it.
* **Alliance / friendship** (`factionRelations.friendly`, `areFactionsAligned`) is lore alignment. At peace ≠ friendly. A power at peace can still refuse you service, deny docking or contest territory.
* **Occupied territory** is a world held by someone other than the claimant it was taken from (`campaign.territory[i].status = 'occupied'`, with `holder`, `claimant`, `warKey`, `day`).
* **Disputed territory** is a world whose settlement left the holder in control while the former holder still claims it (`status = 'disputed'`). It is not war: nobody may attack over it without an incident.
* **Retained / returned** are the two settled outcomes for an occupied world (`retained_by_occupier`, `returned_to_previous_controller`).

Ownership, culture, sovereign claim, current controller and jurisdiction stay separate, as in the existing campaign work. A territorial term changes the **controller** (returned) or records a **claim** (disputed). It never rewrites a world's people. Captured-industry and foreign-market access keep following actual control and provenance.

## 1a. Formal wars and static hostility (correction, 261300ZSEP26)

Two different things were being read from one table. They are now separate.

| | source | used for |
|---|---|---|
| **formal war** | `FORMAL_STARTING_WARS` (the campaign's declared starting wars) and, after that, the diplomacy pair records alone | the war set: campaign operations and planning, the war evaluator, offers, the Wars & treaties tab, save/load |
| **static hostility** | `factionRelations.hostile` / `baseFactionWar()` | local attitude and targeting only: who is hostile on sight, as before |

* The declared starting wars are exactly **Terran ↔ Klingon**. A Terran officer's empire inherits that one, and no other.
* Static hostility never becomes a formal war on its own: not at the start, not over time, not through the evaluator. Romulan, Cardassian, Breen, Tholian, Hirogen, Suliban and the others start formally at **peace** with the Terran empire, and are still hostile locally.
* **Gorn** are dormant. Their static hostility never produces a formal war.
* **Arc-owned hostility.** The Dominion and the Blender Remnant (`dominion`, `dominion_remnant`) keep whatever relation their campaign arcs establish. They are never formal wars in this system, never evaluated, and never listed as the empire's wars.
* A hostile-but-not-at-war pair can become a real war through the ordinary route (§6): incidents raise tension to crisis and then war, with a **fresh** war instance.
* Once a pair has a formal record that ended a war (`formalPeace`), local attitude follows that peace. Without one, static hostility still decides local attitude.
* **Old saves.** A save whose empire inherited every static hostility as a war (`playerSeeded.version` < 2) is reseeded once on load: inherited records that are not declared starting wars are dropped, and the declared ones are seeded. Wars the empire made its own through incidents are kept.

## 2. The war record

Per pair, two stores with one owner each:

| store | where | holds |
|---|---|---|
| diplomacy pair record | `playtest.diplomacy.pairs[pairKey]` | `status`, `tension`, `since`, `warId`, `warStarted`, `lastHostileDay`, the transition history |
| campaign war state | `campaign.warStates[warKey]` | the **war instance**: parties, `instance`, `startedDay`, `status`, `statusSince`; a baseline taken at the start (each side's hulls, worlds, ledger engagements/losses/captures); `frontLog` (captures with day and system); pending **offer**; **settlement** (kind, basis, winner/loser, terms, day) |

The existing engagement ledger (`campaign.wars`: engagements, losses per side, captures per side, first and last day) stays as it is. A war instance reads it **as deltas from its own baseline**, so a second war between the same pair doesn't inherit the first one's losses.

The record answers:
* who and since when (`startedDay`);
* status;
* engagements and losses (ledger delta);
* territorial change (`frontLog`, `campaign.territory`);
* production and economic damage (each side's revenue and yard shares against its own best, from the existing peaks);
* front movement (days since the last capture);
* continuation capacity (ready strength against its own best);
* pending outcome (`offer`);
* last hostile act (`lastHostileDay`).

## 3. How a war ends

**The calendar never ends a war.** The old roll that signed peace after ten days at random is removed for every pair. The random incident roll still raises crises and can start wars between powers at peace.

Once a day, `evaluateWars` reads every pair at **war** or in **ceasefire** whose parties are both strategic polities. The player's empire counts; pairs involving the campaign-locked Dominion don't, because the Dominion arc ends its war. Several conditions are evaluated together:

| basis | conditions (all required) | outcome |
|---|---|---|
| **decisive** | the loser L holds no world at all, **or** L's ready strength ≤ 35% of its own best **and** L has lost its home world or ≥ 1/3 of the worlds it held at the war's start **and** the winner's ready strength ≥ 2× L's | **peace**, dictated by the winner. Not every world has to fall |
| **stalemate** | war ≥ 90 days old; no capture either way for ≥ 60 days; both sides have paid (losses on both sides, ≥ 20 consequential engagements in this instance, the same bar the Dominion reads); both still ≥ 30% of their own best (still costly to continue); the stronger ≤ 2.5× the weaker (no realistic near-term decisive path) | **ceasefire** |
| **exhaustion** | as stalemate, but either side ≤ 50% of its own best or economically strained (revenue or yards ≤ 60% of its own best; a spent war chest is not counted). The age and stall windows are **halved** | **ceasefire** (basis `exhaustion`). Exhaustion alone, with the front still moving, is **not** enough |
| **settlement** | a ceasefire held ≥ 30 days with no hostile act between the pair since it began | **peace**, negotiated, with terms |
| **continue** | anything else, in particular a front that has moved in the last 60 days (30 when exhausted) while the mover still has capacity | war continues |

The Earth–Klingon war runs on exactly these rules. Its authored home worlds (Earth, Qonos) feed the decisive test. No winner is forced: it can stalemate, settle through exhaustion, end when one side clearly prevails, or go on while both can fight. The Dominion's opening still reads this war's ledger and its first settlement (`resolutions['terran:klingon']`).

**Acceptance.** Between two AI powers, an eligible outcome is accepted: eligibility already requires that neither side has a realistic path to victory, or that one side can't continue. When the **player's empire** is a party, the outcome becomes an **offer**. The captain can accept it or refuse it. Refusing:
* keeps the war;
* costs 5 standing with the offering power;
* blocks a new offer for 45 days.

An unanswered offer lapses after 20 days, with the same cooldown and no standing change.

## 4. Settlement terms (per occupied world between the pair)

| basis | world taken by the winner | world taken by the loser | world taken during a stalemate/exhaustion war |
|---|---|---|---|
| decisive | retained_by_occupier | returned_to_previous_controller | — |
| negotiated | — | — | **returned** if the claimant is at least as strong as the holder and the world is the claimant's own people; **disputed** if it's the claimant's people but the holder is stronger; **retained** otherwise |
| ceasefire | *unresolved: stays occupied* | *unresolved* | *unresolved* |

A returned world changes controller through the ordinary control-transfer path, so its installations, integration and market access follow. A disputed world keeps its holder and records the claimant.

## 5. What a ceasefire or peace does immediately

The transition runs `applyWarTransition` once:

1. The diplomacy record gets the new status and a history entry marked as a war transition.
2. **Operations** between the pair, in both directions and in any phase (moving, engaged), are stood down the same day. A battle the loaded scene owns is marked `standDownPending` and is stood down when the scene releases it, as before. A fleet in transit therefore never arrives to carry out an attack the war no longer authorises.
3. **Planning:** `reachableEnemyTargets` requires `war`, so neither side plans against the other.
4. **War-only objectives:** escort and blockade contracts at a world whose only threat was a stood-down operation fail with the reason given.
5. **Territory** follows the terms (§4). A ceasefire leaves it occupied.
6. **Local scene:** `reconcileDiplomacy` recomputes NPC hostility, clears a war attack's orders (the ship withdraws) and ends the local fleet attack if its authority is gone. Projectiles already in flight keep their launch attribution, which is the existing rule.
7. **Reports** go through the knowledge rules (§7).

## 6. Incidents after a ceasefire or peace

Self-defence is unchanged: a ship fired on remembers its attacker (`lastAggression…`, `playerAggroUntil`) and answers.

A hostile act between parties who are not at war is an **incident**, recorded on the pair:

| act | at peace / crisis | during a ceasefire |
|---|---|---|
| ship destroyed or captured | tension +30. At 100 it becomes war, as a **new** instance | ceasefire broken: war, as a **new** instance |
| installation destroyed | tension +50 | ceasefire broken |
| world seized | war, as a new instance | ceasefire broken |

A new instance starts a fresh baseline, and its operations are planned fresh. Nothing from the old war (its operations, objectives or offers) is revived: the operations were resolved and the offers closed.

## 7. The player's empire

The player's empire is a party in its own right (`player`), with its own pair records.

**Where its wars come from:**
* At the start of a game, it inherits its starting faction's **declared formal** wars (§1a): a Terran officer begins at war with the Klingons, and with nobody else.
* A save from before this round inherits its wars once, on load, from the flag it was saved under.
* After that, its wars change only through its own acts (incidents and world seizures) or its own settlements.

**Flags:** raising a flag doesn't start, end or move any of these records. The flag still decides who treats the captain's own ship as an enemy on sight. That is existing behaviour and it is about the ship, not the empire. The empire's wars add to it.

**Rules:** the player's empire can hold occupied territory, lose it, and receive and answer offers. Offers come from the same evaluator, under the same thresholds.

**Inherited wars follow their source.** When an AI pair makes a ceasefire or peace, a war the captain's empire inherited from one of the settling governments follows it, with the same cleanup and basis `co-belligerent`. The officer's empire was fighting that government's war, and its settlement binds it. For example, after a Terran–Klingon ceasefire, the Terran officer's empire is in ceasefire with the Klingons too.

An inherited war is **not evaluated on its own** and never receives offers of its own: it moves only when its government's war moves. The empire's record is updated in the same transition, but no separate treaty is published: the captain receives **one** report, the government's, marked *Binding on your empire*, ending "The ceasefire/settlement also applies to your empire." Wars the empire started itself still produce their own offers and reports.

Nothing the captain does afterwards is bound: firing on a Klingon ship is an incident, and it can open a new war that is the empire's own. A war the empire made its own through an incident or a seizure is not inherited, and it ends only through its own evaluation and offers. A later war between the two governments doesn't pull the empire back in.

## 8. Reports and knowledge

**Where the news goes:**
* A ceasefire or settlement between two AI powers is **Diplomacy** news (category `diplomacy`). It is never the Dominion Campaign Report, unless one party is the Dominion.
* The generic diplomacy-history publisher skips war transitions, which have their own report.
* The debug bulletin is unchanged.

**When the captain hears:**
* immediately, if the captain's empire is a party, or the settlement binds an inherited war of the empire's (one report, not two: §7);
* otherwise through the best source the captain has at any world held by either party:
  * local or fleet: the same day;
  * relay: 2 days later;
  * rumour: 5–10 days later (seeded);
* never, if the captain has had no contact with both powers.

**What it says:**
* Ceasefire, peace settlement and dictated peace are distinct kinds.
* The text lists the territorial terms the account knows: worlds retained, returned or disputed.
* A ceasefire report says the occupied worlds remain occupied, by name.

**The Empire panel's Wars & treaties tab** lists:
* the empire's own wars: status, start, engagements and losses, and the open offer with Accept and Refuse;
* occupied and disputed territory the captain knows of: the empire's own, worlds the captain watches, and settled terms whose report has reached the captain;
* the ceasefire and settlement reports received.

## 9. Transition matrix

| from → to | trigger | cleanup |
|---|---|---|
| peace/crisis → war | incident tension ≥ 100; world seizure; random incident roll (AI pairs); debug | new war instance and baseline |
| war → ceasefire | stalemate or exhaustion (AI: automatic; player: offer accepted) | ops stood down, war-only contracts closed, planning stops, local reconcile, report; territory stays occupied |
| war → peace | decisive (AI: automatic; player: offer accepted) | as ceasefire, plus terms applied |
| ceasefire → peace | ≥ 30 quiet days (AI: automatic; player: offer accepted) | terms applied, report |
| ceasefire → war | incident: ship, installation or world attacked | new war instance; nothing old revived |
| peace → crisis/peace | tension moves with incidents and mediation | none |
| AI pair settles → the empire's inherited war | follows automatically (basis `co-belligerent`) | the same cleanup; no separate report or offer (the government's report says it binds the empire); the empire's incidents afterwards are its own |
| static hostility → formal war | never directly; only through incidents (§6) | new war instance |
| any → any | debug `setDiplomacy` | the same `applyWarTransition` cleanup when the change ends or suspends a war |

## 10. Deferred hooks

Evacuation and blockade would read `territory[i].status` and the ceasefire's `statusSince`. A civilian evacuation of an occupied world under ceasefire, or a blockade that breaks a ceasefire, needs no new record. Neither is implemented here.
