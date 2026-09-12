# BM1 faction doctrine — v0.2.1 design draft

Prepared 11 September 2026. **This package defines proposed behavior. The game does not load it yet.** It does not change weapons, starting inventories, relations, map ownership, saves or the pushed combat fixes.

The next gameplay goal is for factions to want different things and act on information they actually obtained. A lost Romulan patrol should not send every empire into the same investigation. A Klingon commander can know about the loss and leave it alone; evidence connecting it to Klingon losses gives that commander a reason to reconsider.

## Phase 1 relationship contract

The JSON `phase1Integration` block takes precedence over later campaign proposals. Breen and Dominion have no static alliance in Phase 1. Remove friendship both ways without adding hostility. All scenario treaties are disabled in Phase 1; their role policies are retained only for future use. This package does not patch the engine.

Add explicit empty friendly/hostile lists for Delpin, Promelli, Son'a, Tarellian and neutral, plus an empty-list fallback with development warnings for unknown keys. Empty lists mean no declared relationship, not immunity or a ceasefire. Preserve immediate defense and check reverse-direction hostility. Shared neutral status must not make unrelated independent organizations allies.

Runtime acceptance must cover spawn attitudes, defense target selection and `calmHomeSystem`, in both directions and after re-entry/save reload. Test a genuine attack separately: non-allied ships can still defend themselves. The 59 offline checks below are policy/record checks, not proof of these engine changes.

## What is in this package

| File | Purpose |
|---|---|
| `bm1-faction-doctrine.v0.2.1.json` | 22 profiles covering 21 runtime faction keys, 9 local cultures, 13 shared role templates, action guards, objectives, incident interests and source notes. The two Dominion profiles share the existing `dominion` key. |
| `bm1-faction-doctrine.schema.json` | JSON Schema for the authoring format. |
| `doctrine-acceptance.json` | Contrasting examples of intended decisions. |
| `validate-doctrine.py` | Dependency-free structure/reference validation and a small reference policy evaluator. It tests the draft's rules, not the game. |
| This guide | Readable faction behavior, source reconciliation and implementation boundaries. |

After extracting the bundle, run:

```sh
python3 validate-doctrine.py
```

The included version passes structure/reference validation and **59/59 offline policy cases**. These are distinct from the previously pushed Chromium combat probe; they do not prove that runtime AI, travel, sensors, saves or reports implement doctrine. All release files are packaged together under the explicit 0.2.1 archive name.

## Decisions preserved, proposals made explicit

**Preserved from the user and handoff:** offline laptop play; completed jumps advance strategic time; events persist; sensors and communications apply to both sides; all selectable starts remain viable; Dominion Remnant begins in Blender; Vulcan ships are armed; weapon changes need separate review.

**Proposed here:** every exact priority, role permission, event response and termination contract in the JSON. Minor-faction interpretations and cultural responses are authored design, with sources distinguished below. Numeric durations, force ratios and operation budgets remain tuning inputs rather than invented final values.

Changes from v0.1:

- Armed Vulcans retain defensive force. No unarmed start or removal of their loadout is proposed.
- Breen's ordinary guarded posture is separated from a possible secret Dominion treaty. The BM2 biographies explicitly describe Breen allies, while the retained BM1 Anchorage description says they honor no alliances. This draft proposes a compartmented pact as the reconciliation; its starting date and participants remain scenario choices. **Phase 1 supersedes the earlier reconciliation: remove the blanket Breen–Dominion friendship both ways. The covert pact is disabled until scoped relationship decisions exist.**
- Klingon compliance depends on the encounter. Leaving a restricted zone can end enforcement; it does not settle an independent military objective.
- Vulcan access restrictions resolve through the relevant clearance or offense. There is no universal eight-jump forgiveness timer, and compensation settles only the named obligation.
- Gorn routine generation stays disabled. A future survivor discovery would require an authored exception/profile; keeping a ship-name pool must not recreate a Gorn state.
- Knowledge has separate provenance, identification, attribution, confidence and freshness. There is no ladder that makes every report superior to direct observation.
- Role policies explicitly reference shared templates. Every action has a guard; every template has an objective with typed termination rules.
- `sovereignId` is a stable authority/claim identity, not the legacy `governmentId`. Several independent societies currently collapse to `neutral`; that is not shared culture or shared command.

## What governs a ship

1. **Command and role:** Who currently controls it? Is it a merchant, escort, explorer, investigator or strike ship? Hull origin alone answers neither question.
2. **Knowledge:** What did this actor detect, receive, recover or infer? Which claims remain useful? Who was actually identified as responsible?
3. **Interest:** Does the incident threaten its people, contract, charge, route, secrets or assigned operation?
4. **Capacity:** Does an existing asset have time, access, equipment and supplies to respond?
5. **Objective:** What concrete result is it trying to achieve, and what ends that effort?
6. **Action and fire:** Choose a guarded intent. Separately enforce live tracking, equipped weapon range, readiness, resources and authorization for each shot.

Knowing about an incident does not compel a response. A matched interest with inadequate resources is **deferred**; it does not create a free fleet. Unknown events remain unknown. A credible disappearance report can justify searching for evidence without identifying an attacker or justifying punishment.

The reference selector uses ordered rules so outcomes are inspectable. More complex scoring can come later, behind the same hard gates. Reports and distress messages are deduplicated side actions; sending one cannot trap a freighter in place instead of evading. An armed civilian can evade and return fire simultaneously.

## The factions

These are proposed BM1 behaviors, preserving its imperial setting rather than importing Prime-timeline Federation politics. A faction's military posture does not turn all its civilian traffic into warships.

| Profile | Ordinary priorities and behavior | Reaction to the developing Dominion threat |
|---|---|---|
| **Earth Empire** | Protect people, infrastructure and war supply; control sensitive approaches; requisition through explicit events; counterattack and reclaim territory when forces and logistics allow. | Initially preoccupied with Klingons. Corroborated wider danger shifts attention toward intelligence recovery, protected corridors, evacuation and contingency defense. |
| **Klingon** | Win the rebellion/war through concentrated attacks on military targets and verified war logistics. Raid, regroup and withdraw when the assigned objective ends. Honor concerns military achievement. | Records an unrelated Romulan disappearance. Investigates when evidence links its own losses, routes or operations, or supports a regional threat. May maintain pressure on Earth while allocating a limited investigation. |
| **Romulan** | Protect frontier access, intelligence and secrecy. Patrols shadow and investigate; civilian captains preserve their cargo. Share information selectively. | Own missing patrols are an early concern. Evidence near Blender can trigger discreet surveillance, recovery efforts and preparation against the second front. |
| **Cardassian** | Build industrial and political leverage, control corridors, and employ coercion and proxies through specific orders. | In the BM2-derived scenario, informed command supports hidden preparation and the Bajoran corridor. A briefed operative assigned to prevent exposure may conceal evidence; an ordinary merchant does not know the conspiracy. |
| **Dominion Remnant — Blender** | Preserve the isolated outpost, protect scarce ships, secure supplies and assess possible partners. | Investigates authenticated contact with the wider Dominion. Cooperation, reunification, autonomy and resistance are possible authored paths. The playable start has no automatic distant map, fleet or secret-plan access. |
| **Wider Dominion** | Patiently secure access, allies, supply and concealed forces; exploit divided opponents; commit coordinated fronts only when operations are sustainable. | Pursues the invasion strategy but can be exposed, delayed, denied access, deprived of supplies or forced to abandon a front. Occupation requires forces and logistics after the battle. |
| **Breen** | Guard assets and exclusion zones; communicate minimally; use intermediaries and specific contracts. | A secret treaty can involve informed command while ordinary captains remain guarded and commercially focused. A shipment order need not disclose the invasion it supports. |
| **Ferengi** | Protect profit, commercial reputation, cargo and expensive ships. Bargain, insure, reroute and hire escorts. Merchants are distinct from pirates. | Cares when losses threaten contracts, markets or routes. Brokers can trade verified information; merchants avoid dangerous deliveries unless compensation justifies the risk. |
| **Vulcan** | Armed restraint, investigation, relief, diplomacy and organized defense of home and protected traffic. Accept surrender and genuine withdrawal. | Can investigate foreign losses and rescue survivors without declaring war. Stronger evidence prompts warnings, mediation, evacuation and defensive preparation. |
| **Tholian** | Protect industry, construction and clearly defined restricted areas. Preserve contracts and design shipments. | Unusual construction demand, stolen designs and missing deliveries can reveal preparation. Responds to concrete industrial exposure without automatically joining a coalition. |
| **Bajoran / Bajora** | Protect communities, autonomy and wormhole approaches. Patrol, assist civilians and resist occupation pressure. | Cardassian corridor preparation matters early and directly. Seeks reconnaissance, defense supplies, guarantees and evacuation capacity. Successful intervention can obstruct the invasion route. |
| **Delpin — Delpi** | Aquatic explorers with advanced science, fast ships and comparatively weak weapons. Recover observations and crews; evade superior fleets. | Can discover a wreck, signal or transit trace outside Romulan space. Investigates and reports what it actually finds without automatically becoming a combat ally. |
| **Andorian** | Protect shipyards, deliveries and commercial independence while selling to competing customers. | Concealed buyers, procurement anomalies and missing deliveries can expose the hidden buildup. Trading with a customer does not establish mutual defense. |
| **Son'a — Sonata** | Powerful local defense, courtesy to visitors and protection of the Briar Patch. | Usually stays outside the war until intrusion, resource threats or displaced people create a local interest. Compliance can resolve access encounters. |
| **Tarellian** | Long-range exploration, unusual drives, routes and scientific adventure. | Investigates distinctive transit signatures and endangered expeditions. Discovery and information sharing still require travel and delivered reports. |
| **Promelli** | Protect secretive biotechnology research; investigate useful evidence and known hazards. | Recovered biotech or stolen research can matter. This does not add weapon effects or grant knowledge of Dominion secrets. |
| **Hirogen** | Hunt specific, noteworthy quarry with finite search effort and acceptable operational risk. | A disappearance interests a hunting group if evidence points to a worthy target. They do not investigate every missing ship or join a general alliance. |
| **Suliban** | Small cells pursue information, infiltration and extraction under compartmented assignments. | May recover or trade evidence, manipulate a particular report, or extract an operative. No automatic Dominion allegiance or full-plan knowledge. |
| **Borg** | Assess useful technology and pursue assigned acquisition/assimilation objectives through organized operations. | Responds to technological relevance and its own objectives. It does not become a default anti-Dominion ally. Assimilation mechanics require separate implementation. |
| **Pirate groups** | Appraise known cargo and opposition; ambush or demand payment; withdraw when paid, repelled or overmatched. | Exploit disrupted routes and exposed shipping when profitable. A satisfied demand closes that incident; it cannot justify endless firing. |
| **Independent societies** | Preserve livelihood, autonomy and access through local rules, actual contracts and ship jobs. | Reactions vary by society and exposure. `neutral` standing is not a unified empire, alliance or intelligence network. |
| **Gorn — historical absence** | No normal campaign traffic, patrol, raid, reinforcement or occupation generation. | Ruins and recovered technology can support stories. A survivor event must be deliberately authored. |

### Civilian, patrol and military distinctions

The JSON contains 13 canonical roles: civilian, patrol, defender, escort, explorer, relief, envoy, scout, raider, occupier, hunter, covert and commander.

- **Civilian:** preserve crew and complete its contract. It can report danger or defend itself with its actual installed weapons, but does not inherit the faction military's war permissions.
- **Patrol/defender:** protect a defined area or asset. Inspection requires jurisdiction; violence requires its own authorization and evidence. A Vulcan defender can protect a freighter without being attacked first.
- **Escort:** protect the assigned charge. Chasing an enemy across the system cannot silently override the escort contract. Once the charge is safe, the obligation can end.
- **Explorer/relief:** investigate or rescue using real equipment and capacity. Reporting an event does not automatically grant authority to punish its suspected cause.
- **Raider/occupier:** pursue an assigned military or predatory result, then close the operation or regroup. Destroying a random ship does not establish territorial control.
- **Covert/commander:** secrecy comes from received compartmented orders and restricted reports. It is not built into every member of the species.

Some roles are intentionally unavailable to some profiles. A Vulcan `raider` assignment is denied by this draft. Player-directed choices can differ from autonomous doctrine; their consequences and physical combat rules still apply.

## Independent status and local culture

The culture layer changes interest, tone and local priorities. It **cannot grant military fire permission**. Apply it to residents or actors assigned to represent that community, not every visitor or occupying soldier.

| Society | Proposed local concern | Example response |
|---|---|---|
| Lysia | Freedom from renewed enslavement | Seek guarantees or outside protection when occupation threatens. |
| Flash | Software clients, contracts and trust | Investigate suspicious procurement or a compromised client trace. |
| New Switzerland | Refugees and commercial safety | Offer bounded refuge, transport and trade support. |
| Dyson | Advanced society and controlled technology access | Investigate theft or interference with its technology. |
| Opusab | Peaceful coexistence across faction lines | Mediate threats to the shared settlement. |
| Tepos | Weapons contracts and deliveries | Negotiate sales while assessing buyer and route risks. |
| Reman communities | Community survival under coercive control | Seek protection or a specifically authored resistance opportunity. This is not a new empire. |
| Trill | Proposed civilian/community assistance | Offer aid when capable. This is new design; the retained description does not establish it. |
| Blender remnant | Survival of the isolated outpost | Secure particular supply agreements and preserve autonomy. |

Culture, legal sovereign, actual controller and jurisdiction are distinct. Occupation can change the controller without erasing the population's society. Store disputed legal claims explicitly. Several worlds sharing an old `governmentId` must not gain a common authority or telepathic intelligence network.

## One incident, several reactions

### A general overdue-asset event

The canonical event is now **`asset_overdue`**, replacing the earlier `missing_patrol` label throughout the policy rules and acceptance fixtures. A Romulan patrol is one example; the same event handles freighters, explorers, refugee transports, construction tenders, convoys and fleets. It does not require Romulan ownership or a Dominion connection.

`eventContracts.asset_overdue.payloadSchema` defines the report's structure:

| Field | Information retained |
|---|---|
| `asset` | Stable asset ID, ship/convoy/fleet kind, role, known owner and known faction. Unknown ownership or affiliation stays null. |
| `assignment` | Assignment ID and kind, known origin/destination, and contract ID where applicable. |
| `cargo` | Knowledge state and manifest. Unknown cargo is null; an empty manifest means cargo is known to be absent. Reports must not reveal hidden inventory. |
| `missedMilestone` | A specific expected arrival or check-in, its deadline and its grace period on a declared clock. |
| `detectedAt` | When the observer detected the missed milestone. It must be strictly beyond the deadline plus grace, using that same clock. |
| `lastKnown` | Last known location, optional coordinates and observation time. Historical information does not supply a live target track. |
| `locationId`, `jurisdictionAtOccurrence` | The known milestone/report site and its jurisdiction. This is not proof of where the asset was lost; later evidence may locate a separate incident. |

Emit the report only for an observer that knows about the assignment and missed milestone. Unloading an NPC from the current scene is not disappearance evidence. Use the asset, assignment and milestone IDs to update one persistent incident rather than generating a new mission every tick or jump.

The new acceptance examples cover these responses:

| Overdue asset and known circumstances | Proposed response |
|---|---|
| Ferengi freighter whose delay threatens an active contract | An affected merchant reroutes. |
| Delpin explorer with a recoverable evidence trail | An available explorer investigates. |
| Refugee transport with independently reported survivors | A capable Vulcan relief ship attempts rescue. |
| Refugee transport with no evidence or survivor report | The relief ship records the report; it does not invent survivor coordinates. |
| Tholian construction tender whose delay threatens a contract | Command assigns available protection to the exposed operation. |

An overdue event alone establishes neither destruction nor an attacker. Accident, delay, communications failure, desertion, piracy and covert interference are possibilities to establish through later evidence. The existing distress, trade, border, technology, occupation and military event families continue to apply independently.

### Example: a frontier patrol

**Proposed scenario:** a Romulan patrol fails to return. A Delpin explorer later finds debris at a separately addressable deep-space POI outside Romulan jurisdiction. The site has its own `locationId`; traveling to it does not require loading the Romulus scene.

| Observer's actual information | Result |
|---|---|
| No report received and no direct observation | No response and no journal entry revealing the event. |
| Romulan command receives a credible report about its own missing patrol | Assign an available investigator; otherwise retain and defer the request. |
| Klingon command receives the same report with no link to its interests | Record it. Continue the existing war objective. |
| Klingons later receive a credible connection to their own missing scouts | Reevaluate the retained report and investigate the link. |
| Delpin explorer detects recoverable traces | Investigate within its equipment and access limits; report observations rather than inventing attribution. |
| Vulcan relief ship receives usable survivor coordinates | Attempt rescue if capacity and access exist. |
| Cardassian merchant hears a rumor | Ordinary contract/risk behavior; no automatic cover-up knowledge. |
| Cardassian operative receives evidence that exposes a pact it was briefed on, plus an applicable order | Attempt the assigned concealment or extraction with actual available resources. |

A report of a missing patrol is not a live firing solution and does not establish that the player destroyed it. Standing changes require a faction's applicable reputational policy and attributed evidence. Legal interception also requires valid jurisdiction or a specific cross-border agreement. A faction may disapprove of an act outside its borders without thereby gaining authority to enforce its laws there.

## The wider Dominion's operation

The retained BM2 opening and biographies describe a wormhole invasion combined with a hidden Blender fleet, supported by Cardassian preparation and Breen allies. For BM1, this is a **possible developing strategy**, not a predetermined ending.

| Stage | Dominion objective | What can change it |
|---|---|---|
| Reconnect and assess | Establish reliable contact and learn local conditions | Remnant autonomy, false assumptions, intercepted reports, disrupted communications. |
| Secure partners | Negotiate compartmented supply/access agreements | Exposure, failed terms, rival offers, local resistance. |
| Conceal preparation | Fund ships, stores and staging facilities | Procurement traces, scouting, lost deliveries, sabotage. |
| Establish access | Prepare wormhole routes and supporting infrastructure | Bajoran defense, denied transit, logistics losses. |
| Coordinate fronts | Commit forces when both fronts have sustainable readiness | An exposed Blender force, insufficient supplies, changed enemy strength, loss of an ally. |
| Consolidate or withdraw | Hold actual territory and supply occupation forces | Resistance, overextension, relief of conquered systems, broken routes. |

Command evaluates what it knows about opponents. It does not read hidden exact fleet totals. Preparation consumes finite assets and persists across jumps; a single low-strength threshold must not instantly spawn an invasion. Initial pact timing, readiness requirements and stage durations belong to later scenario authoring.

The Blender player can help the operation, oppose it, negotiate a relationship or preserve independence. Wider Dominion command and a local remnant use separate profile selection even while sharing the existing runtime faction key.

## Objectives must end

| Objective | Clock | Examples of closure |
|---|---|---|
| Border enforcement | Tactical simulation seconds | Specific instruction satisfied; target leaves the jurisdiction; cancellation or deadline. |
| Immediate defense | Tactical simulation seconds | Threat ends or applicable surrender is accepted; cancellation/deadline. |
| Local search/hunt | Tactical simulation seconds | Target/objective resolved; search effort exhausted; deadline. This must work without a player jump. |
| Escort/delivery | Completed strategic jumps | Charge reaches the specified safety/destination condition; cancellation, inadequate supply or deadline. |
| Investigation/rescue | Completed strategic jumps | Assigned evidence or rescue result obtained; cancellation, inadequate capacity/supply or deadline. Local searching uses a tactical child objective. |
| Raid/extortion | Tactical simulation seconds | Assigned result achieved; demanded cargo received; applicable surrender accepted; poor force ratio or deadline. |
| Occupation/large operation | Completed strategic jumps | Defined control/operation result established, or cancellation, inadequate logistics or deadline. |

Every objective instance requires an ID, incident/assignment link, responsible actor, target or bounded area, creation time, deadline on its declared clock, resource allocation and resolution state. A role's `defaultObjective` is a fallback for a new assignment, not permission to reuse one encounter for an unrelated mission. A Borg acquisition patrol, for example, needs its explicit acquisition assignment rather than a border inspection objective.

Closing an objective stops new actions under that objective and records the reason. It does not erase separate crimes or automatically remove established territorial control. Projectiles already in flight keep their launch attribution. Accepted surrender and ceasefire handling for in-flight damage need deliberate runtime rules; this draft does not magically delete shots.

No global `complianceAccepted: false` applies to an entire faction. Specific compliance resolves the relevant demand. A serious attack can leave a separate investigation or access restriction even after immediate fighting stops. Do not recycle a closed demand with a new ID every tick to manufacture perpetual pursuit.

## Data contract and integration order

Predicates are Boolean literals or one of `{"fact":"id"}`, `{"all":[...]}`, `{"any":[...]}`. Lists are nonempty. No free-form expression strings, pipe syntax or hidden executable code are accepted. Missing known facts are false; unknown fact IDs are invalid. `engagement_authorized` is computed from the selected role's permitted modes, never injected by world state.

The fact adapter must derive Boolean inputs from **that actor's** evidence, orders, local capabilities and active objectives. Giving it global incident truth would defeat the model even though the JSON still validates. Standing, criminal status, war orders, immediate self-defense and physical firing permission remain separate.

Suggested bounded integration sequence:

1. Add the schema, draft data and validation to development tooling. No runtime behavior change is needed to review the policies.
2. Build the observer-evidence and stable incident/location adapters. Initially use existing planets; record `locationId` and `jurisdictionAtOccurrence` from the start.
3. Run a shadow evaluator on a controlled incident and log **why** it proposed a response. Do not let it act yet; compare against the accepted examples.
4. Enable a small set of roles for one persistent incident: an explorer discovers evidence, a patrol responds or declines, and an escort protects a specific charge. Save/load and completed-jump behavior need real acceptance tests here.
5. Expand faction policies and build the separate deep-space scene/travel support. Add covert treaty and Dominion campaign stages only when knowledge, objectives and logistics persist correctly.

Preserve the existing native NPC roles. `playerEscort` plus `fleetId` still matters to combat attribution; a doctrine-role adapter must not rename those fields. An unsupported canonical role denies assignment. An unrecognized legacy role falls back to the profile's explicit safe policy, without inheriting war permissions.

The pushed final-hit credit rule remains the Phase 0 baseline: player and player-escort final blows receive applicable reward/blame; NPC-only destruction does not. A later evidence-driven standing system must avoid charging both the old immediate cascade and a new report consequence for the same incident.

## Verification and limits

The validator checks the bundled schema's structural keywords, references between catalogs, role fallbacks, action coverage, source IDs and dormant-profile generation. The reference examples cover different reactions to the same information, missing evidence/capacity, compartmented knowledge, role-specific fire permission, physical gates, compliance, local search expiry, cultural differences and separate Dominion profile selection.

The included Python code is an authoring/reference tool, not the eventual JavaScript engine implementation. The JSON Schema can also be used with a full Draft 2020-12 validator. Neither tool certifies original Flash parity, balance, runtime sensor fidelity, save migration or laptop performance. No repository or remote branch was changed while producing this package.

## Sources and remaining choices

- **User-supplied `BM1-CLOUD-PROJECT-HANDOFF.md` and later corrections:** intended local/offline game, persistent events, strategic jumps, viable starts, Blender remnant and armed Vulcans.
- **[Retained BM1 world descriptions](https://github.com/Artemis2028/BM1-remastered/blob/87bfe46f4aab84de435a3b1436670d7960da3d61/data/planetData.json):** local societies, Delpi exploration, Blender survivors, Gorn history and the Imperial War setting. These are source anchors in the browser port, not an independent extraction of the original Flash binary.
- **[Retained BM2 opening](https://github.com/Quangoz/Broken-Mirror-2-remastered/blob/50a2015879bae6946b73b3f6db5d0a40120bb59c/src/main.js#L279)** and **[faction biographies](https://github.com/Quangoz/Broken-Mirror-2-remastered/blob/50a2015879bae6946b73b3f6db5d0a40120bb59c/src/main.js#L4299):** invasion fronts, proxy preparation and the Dominion's allies. This draft paraphrases those anchors; the conditional campaign and compartmented knowledge rules are newly authored.

Still open for scenario/balance work: exact warning/search durations; per-jump deadlines; force ratios and finite budgets; which minor profiles enter the default roster; initial treaty state and briefing recipients; Blender's disputed legal claim; real border/POI coordinates; and original Flash ship/loadout mapping. These choices do not block reviewing the doctrine now and do not imply approval for a weapon overhaul.
