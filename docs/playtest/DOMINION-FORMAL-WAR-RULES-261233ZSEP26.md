# Dominion formal-war integration — governing note

DTG 261233ZSEP26 · base `f6c684f` (accepted, frozen) · written before any runtime change in this round.

This supersedes the carry-forward note of 261219ZSEP26. It extends `BILATERAL-WAR-PEACE-RULES-260130ZSEP26.md`; everything there still holds unless this note says otherwise.

## 0. Core rule

Dominion Central (`dominion`) and the Blender Remnant (`dominion_remnant`) never receive formal wars from static hostility. They enter the bilateral war system only through:
* **explicit authored escalation** (the storyline declares it);
* **an independently declared formal war** (a declaration recorded in the diplomacy book by some other path, for example the captain's own incidents or the debug control);
* **an authored reunification or subordination event** that explicitly binds the Remnant to Central's wars.

Static `factionRelations.hostile` remains local attitude and combat context only.

**Rules doc §1a, new wording:** "Dominion Central and Blender Remnant do not receive formal wars from static hostility. They enter the bilateral war system only through explicit authored escalation or an independently declared war."

## 1. The formal record decides, when there is one

| read | Dominion/Remnant pair **without** a formal record | **with** a formal record (any status) |
|---|---|---|
| campaign relation (planning, operations, evaluator, defence) | `allied` when aligned **and** bound (see §7), otherwise `peace` | the record's status |
| local attitude (`worldRelation`) | static hostility, as before | the record: war is war; a concluded ceasefire/peace ends local hostility |
| `campaignWarPairs()` | not listed | listed with its war instance and any `inheritedFrom` |
| `evaluateWars` | skipped (`LOCKED_WAR_PARTIES`) | evaluated like any war, with the expeditionary side model (§5) |

`LOCKED_WAR_PARTIES`, `arcOwned()` and `campaignWarPairs()` become conditional on the absence of a record. The random incident roll still never touches Dominion Central pairs (`CAMPAIGN_LOCKED_DIPLOMACY`, unchanged): the roll is not an authored escalation.

## 2. Where open war starts: the invasion plan

The authored `staging → invasion` transition in `advanceDominion` builds an explicit **invasion plan** (`book.dominion.plan`), and creates formal records from it on the same campaign day the invasion operation launches, before the launch:

```
plan = { day, objective: <entry system>, warTargets: [...], pacts: [...], reason }
```

* **Objective:** the wormhole's near terminus (Bajora on the default map).
* **War targets** are exactly the powers the opening operation deliberately attacks. The candidate list is authored (`dominionCorridorTargets`): the powers against which the corridor may be forced. The holder of the objective becomes a war target only if it is on that list: the corridor is then being forced against it.
  * Bajoran authority at Bajora: war target (the corridor is forced).
  * An unheld objective: no war target; the crossing occupies it unopposed.
  * A partner with an **active pact** (§2a) holds the objective (for example the Cardassians, once they have taken Bajora): the corridor isn't forced. The expedition crosses unopposed into the partner's world under the pact and stands there. No operation is launched and no war is declared. The partner-held terminus counts as the expedition's ground for planning, convoys and sustainability.
  * Any other holder not on the list: the crossing waits.
  * No war is ever inferred from holding the entry world.
  * *(Amended during implementation, 261233ZSEP26 round: the first draft had the crossing wait at a partner-held corridor too. That stalled the arc for good whenever the Cardassians held Bajora, which the playtest gate DOM check caught.)*
  * `dominionOpeningAlsoDeclare` (authored, empty by default) can add further opening targets deliberately attacked by the plan.
* **Pacts:** `plan.pacts` lists the pacts that are **active** (§2a) at the crossing. A pact is an alliance, not a co-belligerence: no partner is put at war. *(Corrected 261400ZSEP26: b6334bf read an active pact off static alignment.)*
* Nobody else is declared against: not every hostile faction, not the Terran government, not the captain.

The declaration is one effect per pair (`warDeclared`, `source: 'authored'`) with a model-assigned war instance id. The engine records it in the diplomacy book with that id, so the model's war instance and the diplomacy record are the same war. The report is Diplomacy news under the usual knowledge rules.

## 2a. Treaty state: Dominion pacts (correction, 261400ZSEP26)

A pact is an explicit, authored treaty record in the campaign book (`book.treaties['pact:<a>:<b>']`). It is never read off static friendship or alignment (`factionRelations.friendly`, `areFactionsAligned`, a campaign `allied` relation).

| | |
|---|---|
| **eligible** | `dominionPactPartners` (default Cardassian, Breen). Eligibility makes a pact possible; it is not a pact. |
| **activation** | only an authored agreement event: `activatePact`. The storyline's own beat concludes the pacts named in `dominionAuthoredPacts` (default Cardassian) when staging begins, with a partner that still holds ground and is not at war with Central. It is also exposed as `activateDominionPact(partner)` and the debug command `campaign pact <partner> on`. |
| **record** | `{ kind: 'pact', parties, status: active\|collapsed, since, endedDay, reason, endReason, secret: true, knownTo: [], instance }`. Typed, named parties, start and end, knowledge state; persisted with the book. |
| **only an active pact** | grants an unopposed partner-held corridor; counts toward expeditionary partner support (together with actual support: fighting Central's enemy or hosting the expedition); appears in `dominion.plan.pacts`; is what later pact-specific orders read (`pactActive`, `activePacts`). |
| **end / collapse** | `endPact` (authored, `endDominionPact`, debug `campaign pact <partner> off`). The benefits go at once: a partner terminus stops being Central's ground, support stops counting, and convoys to it are interdicted as at anyone else's. **No hostility, no war, no change to the ordinary relation.** |
| **knowledge** | secret: no report is published, and `knownTo` is empty. Revealing it through intelligence is a later round. |
| **visibility rule** *(261630ZSEP26)* | `secret: true` with the captain not in `knownTo` means the pact is **unavailable to every player-facing view**, not merely absent from galaxy news. The campaign-history entries of a pact carry `secretOf: <treaty key>`, and one rule (`historyVisibleTo` / `visibleHistory`) decides what any player-facing view may read: visible once the record is no longer secret or the viewer is in its `knownTo`. The book keeps every entry unchanged, so a later revelation shows the history as it was recorded. Expedition reasons (which reach reports and the Wars & treaties front line) never name a partner whose pact the captain does not know. |
| **Remnant** | pacts are Central's. The autonomous Remnant neither learns nor inherits them; subordination to Central does not hand them over either. |

Static alignment keeps its ordinary effects (the campaign `allied` relation for defence), which the pact neither grants nor removes.

## 3. How the war spreads

| Dominion activity | formal war? |
|---|---|
| reconnaissance, staging, transit | no |
| covert activity, warnings | no |
| a local incident (a raid, a ship fight) | no automatic war (the story may raise tension instead) |
| **a deliberate strategic attack, occupation attempt or openly hostile military operation** against a new power | **yes: a formal record is created with that operation, on the same day, before it launches** |

**Rule.** Once integrated, Dominion strategic operations target only powers against which a formal war record exists. The existing `operationIsAuthorised` / `enforceRelations` check applies unchanged: an operation against a power the Dominion is not formally at war with stands down.

**Escalation (authored).** While the invasion is open, when Central holds near-side ground, has no legal target left within its planning bounds and has spare force, it may deliberately escalate against the nearest near-side world held by a power on its authored escalation list (`dominionEscalationTargets`, same list as the corridor by default). This happens at most once per `dominionEscalationEveryDays`. The declaration and the operation are one step. This is the only way the Dominion's war spreads to a new power.

## 4. The player's empire

There is no Dominion exception to f6c684f. The empire does not inherit later wars of the government whose flag it flies. It enters a Dominion war only by:
* an **explicit authored binding event** tied to a government's specific formal war (`bindEmpireToWar(government, enemy)`), which reuses the follow-your-government mechanism: the empire's record is `inheritedFrom: government`, it follows that government's ceasefire and settlement, and it produces one report;
* **voluntary entry** (its own incidents or a declaration);
* a **direct attack** on the empire: a Dominion escalation against a world the empire holds declares war on the empire.

Raising a flag never creates the war.

## 5. Expeditionary sides: defeat and sustainability

Dominion Central fights on the near side as an **expedition**. The ordinary home-world and worlds-held test does not apply: the Gamma Quadrant realm is never conquered and doesn't need to be.

A reusable **expeditionary side mode** (`config.expeditionarySides`) replaces the side's inputs to the war evaluator with an expedition assessment:

| input | meaning |
|---|---|
| strength | ready and committed hulls on the near side and at the staging system (not the home realm's reserve) |
| capacity / capShare | against the expedition's strength at staging (`readinessBaseline`) |
| bridgeheads | near-side worlds it holds; `worldsNow` / `worldsAtStart` read these |
| wormhole access | the entry is held by it or a partner, or reinforcement isn't interdicted |
| supply throughput / reinforcement flow / replacement | convoys still to come while access holds (`dominionMaxConvoys − convoys`) |
| partner support | partners with an **active pact** (§2a) that still hold worlds and actually support: fighting one of Central's enemies, or hosting the expedition at their terminus |
| Blender front | the Remnant is bound to Central and still has living hulls |
| homeLost | always false |

**Sustainable** unless:
* strength ≤ `expeditionCollapseShare` (35%) of the expedition's best, **and** it can't replace losses (no access or no convoys left), **and** no active partner or bound Blender front props it up;
* **or** it holds no bridgehead, has no access, and has nothing left on the near side.

**Evaluator.** For an expeditionary loser, *decisive* means "unsustainable **and** outmatched 2:1". Stalemate and exhaustion work unchanged, on the expedition's own capacity. The other side keeps the ordinary model.

## 6. How a Dominion war ends

Once formal, it goes through the normal bilateral machinery: ceasefire, peace, occupation, disputed territory, operation cleanup, Wars & Treaties, player participation (offers), save/load.

Authored endings, which military arithmetic can't express, are story conditions that then **call the same transition path** (`applyWarTransitionInModel`):

| story condition | trigger in this round | result |
|---|---|---|
| **expedition unsustainable, ordered to withdraw** | assessment unsustainable (§5), whether or not the enemy is 2:1 stronger | `withdraw_expedition` |
| **wormhole access permanently denied** | the entry held by a power at war with Central, and convoys interdicted, for `dominionAccessDeniedDays` (60) | `withdraw_expedition` |
| Blender front breaks away | hook only: an authored event may call `withdraw_expedition` or settle a bound Remnant pair | — |
| a covert alliance collapses | `endPact` (authored event / debug `campaign pact <partner> off`): the corridor and support go at once, the relation is untouched | — (no war follows) |
| Central abandons one front for another | hook only: `withdraw_expedition` with a single-enemy scope | — |

### `withdraw_expedition` (authored settlement action)
* **Scope:** Central's formal wars (all of them, or the authored subset).
* **Per AI pair:** a normal **peace**, `basis: 'withdrawal'`, loser Dominion, winner the other party, `source: 'authored'`. With the empire as a party it is an **offer** of peace, as for any war the empire is party to.
* **Terms:**
  * near-side worlds Central holds and the enemy claims are **abandoned** (returned to the claimant) unless the authored terms list them as retained or disputed;
  * worlds the enemy took from Central stay retained;
  * worlds taken from nobody stay as held.
  * Evacuation of those worlds is a documented hook, not modelled.
* **Operations:** every Dominion operation under those wars stands down that day (the normal cleanup), and no new attack is planned: the phase becomes `withdrawn`.
* **Forces:** near-side Dominion hulls not otherwise engaged are withdrawn to the staging system (Dominica) through the wormhole. Nothing is deleted.
* **Remnant:** an autonomous Remnant is untouched. A bound Remnant's inherited wars follow Central's settlement through the ordinary follow mechanism (one report).
* **Evacuation / blockade:** exposed as hooks (`territory[i]` gains `evacuate: true` on abandoned worlds; `d.withdrawal`), not implemented.

## 7. The Blender Remnant

* It is its own polity. **Autonomous by default** (`book.commandBindings.dominion_remnant` absent). While autonomous:
  * Central's wars don't include it;
  * it isn't allied to Central in the campaign, so it doesn't defend Central's worlds;
  * it may have its own bilateral wars and settlements.
* Shared designs and the shared ship pool never make it a belligerent.
* **Authored subordination** (`subordinateRemnant()`, also a debug command) binds it to Central (`commandBindings.dominion_remnant = { to: 'dominion', day }`):
  * each of Central's current formal wars is mirrored as a Remnant record, `inheritedFrom: 'dominion'`, with no separate declarations;
  * Central's later declarations bind it too;
  * Central's ceasefires and settlements carry it along (the ordinary follow);
  * one report: the Remnant has returned to Central command and names the wars it now shares.

The follow mechanism is generalised from the player's empire to any **follower** (`player`, `dominion_remnant`). The rule is unchanged: an inherited record is not evaluated on its own, and it follows its government's transitions with no separate report.

## 8. Future treaty terms (architecture only, nothing implemented)

Settlement terms stay a list of **typed term records** (`{ term, systemIndex, holder, claimant, … }`) on `warStates[key].settlement.terms`. The same list can later carry:
* demilitarised corridors and zones;
* inspection regimes;
* tribute and reparations;
* basing rights;
* transit guarantees (the Bajoran wormhole is the likely first use).

Each future term carries:
* named parties;
* the systems, routes or assets it covers;
* start and end conditions;
* breach rules (a breach is a specific incident on the pair and escalates through §6 of the rules doc, never by restoring old war objectives);
* knowledge and report state;
* save/load persistence.

No term becomes a faction-wide friendship bonus or a hidden boolean. Nothing in this round hard-codes a settlement structure that would prevent a corridor term keyed to the wormhole id.

## 9. Transition matrix (Dominion additions)

| from → to | trigger | cleanup |
|---|---|---|
| no record → war | the invasion plan's war targets, on the crossing day | new war instance (model id = diplomacy id), report; Remnant records only if bound |
| no record → war | deliberate escalation with an operation (§3) | as above, same day as the operation |
| no record → war | captain's incidents or an independent declaration | ordinary |
| war → ceasefire / peace | normal evaluator: stalemate, exhaustion, expeditionary decisive (§5) | ordinary cleanup, terms, report; offers to the empire |
| war → peace (`withdrawal`) | `withdraw_expedition` (§6) | ops stood down, phase `withdrawn`, near-side hulls to staging, abandoned worlds returned, report |
| Central transition → bound Remnant / bound empire | follow (`co-belligerent`) | same cleanup, no separate report |
| autonomous → bound Remnant | `subordinateRemnant()` | mirrored inherited records, one report |
| debug phase rewind below invasion | recall | Central's formal wars end through `withdraw_expedition` (`basis: 'directed'`) |

## 10. Regressions (gate `test:dominion-war:ingame`)

1. Dominion hostile before the invasion, but no formal war.
2. The staging → invasion transition creates exactly the plan's formal wars.
3. The formal Dominion war appears in Wars & Treaties.
4. Normal ceasefire logic operates on a formal Dominion war.
5. Authored withdrawal produces a normal bilateral settlement record.
6. The Remnant stays outside Central's war while autonomous.
7. Explicit subordination makes the Remnant inherit Central's war.
8. Save/load preserves the Central-vs-Remnant distinction and every formal record.
9. Static Dominion hostility alone never creates a formal war.
10. A deliberate attack on a new power creates its formal war with the attack.
11. No ordinary Dominion strategic attack on a power it isn't formally at war with.
12. The empire doesn't join a later Terran-government Dominion war on its own.
13. An explicit binding event joins the empire, with one-report inheritance.
14. The expedition can become unsustainable and withdraw with the home realm untouched.
15. `withdraw_expedition` deletes no unrelated Dominion or autonomous Remnant asset.

## 11. Out of scope

Evacuation and blockade as systems, DMZs, inspections, tribute and reparations, basing rights, transit guarantees, formation routing cleanup, the Tactical Cube, Gorn activation, market redesign, starters, and general doctrine runtime integration.
