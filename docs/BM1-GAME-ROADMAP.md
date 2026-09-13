# BM1 Remastered — game plan and feature roadmap

Updated: 13 September 2026

Project: [Artemis2028/BM1-remastered-work](https://github.com/Artemis2028/BM1-remastered-work)

Purpose: preserve the decisions from our BM1/BM2 discussion and show what is built, what comes next, and what still needs a decision.

## 1. What we are making

A remaster that keeps BM1's exploration, trading, faction politics and ship progression, with the broader BM2 galaxy and our reviewed hull collection. Civilian careers, military careers and independent play should all have useful ships and meaningful progression.

Combat should offer more than destruction: eventually a damaged enemy can become a boarding opportunity, a captured fleet asset, or the captain's next ship. Politics should distinguish a world's government, its original faction, the flag it flies, and who owns the installations inside it.

We prefer faithful, higher-quality existing art. An image being available is not sufficient reason to create a duplicate hull or assign it to a faction without evidence.

## 2. Status key and version boundary

- **Built baseline:** present in the Phase 3 base used for this delivery, `c0fbcb5`.
- **In this delivery:** implemented locally on top of ships-wiring PR #2, `e869e0b`; included in the reviewed ships/economy patch. This does not mean it has been pushed or merged.
- **Agreed next:** requested behavior whose implementation is still ahead of us.
- **Proposed / open:** a suggested mechanism or balance choice requiring further review.

The supplied Claude roster bundle ends at `8441e9c`. We reviewed it as source material. Our reviewed `bm-ships` catalog remains the authority for hull IDs, roster decisions, and availability. We retain compatible improvements without installing a competing ID map.

The 13 September revision adds the approved duplicate merges on reviewed economy base `3b2c2a9`. See `APPROVED-HULL-MERGES.md` for the implemented decisions and the delivery README for exact patch bases. Use one matching patch route, not both.

The ship-power follow-up is based on pushed main `302639a`. It adds shared ship energy accounting and four crew skill profiles; see [Power and crews](power/POWER-AND-CREWS.md). Earlier delivery labels below describe the historical ship integration.

## 3. The main work packages

| Area | Status | Goal / remaining work |
|---|---|---|
| Attribution and firing range | Built baseline | NPC kills do not give player rewards; escort credit and pursuit versus firing range are tested. |
| Phase 1 political authority | Built baseline | Stable sides, distinct control and flag, independent station ownership, explicit conquest transfers. |
| Phase 2 security policies | Built baseline | Two ROEs, empire defaults and holding overrides, authority-gated UI. |
| Phase 3 checkpoints | Built baseline | Holding zones, two-way checkpoint encounters, compliance, and authority-specific service access. |
| Reviewed BM1/BM2 ships | In this delivery | Catalog wired into the engine; our roster, source mappings and approved drawing envelopes retained. |
| Ship trust and purchase rules | In this delivery | Faction-wide standing, regional/vendor stock, shared gates for personal and fleet purchases. |
| Empty but armable ships | In this delivery | Three weapon/device slots; an empty loadout stays empty and can be equipped. |
| Ship power and crew skill | Power follow-up patch | Per-hull reactors/reserves; paid movement, shield recovery and shots; four AI skills with separate temperament. |
| Passive/active sensors and EW | Agreed next | Detection, identification and tracking; upgradeable suites permit cargo-to-recon refits with power/capacity tradeoffs. |
| Complete weapon source audit | Agreed next | Merge identical BM1/BM2 definitions, preserve real variants, add supplied descriptions. |
| Flags, passes and utility inventory | Agreed next | Separate credentials from the three weapon/device slots. Capacity and activation rules remain open. |
| Boarding and fleet command transfer | Agreed next | Capture damaged ships, develop away teams, switch the player's ship with a fleet ship. |
| Station capability rules and effects | Agreed next | Correct repair access; repair arms, scaffolds and construction workbees. |
| Broader economy / difficulty | Agreed next | Review remaining imported costs and combat stats; make tuning adjustable. |
| Recoverable Reman access | Agreed next | Destruction of one secret base must not permanently remove access to the Reman Warbird. |
| Incident escalation and alerts | Planned continuation | Distinguish aggression from retaliation, then build consequences and alert behavior. |
| Independence and civil wars | Desired feature | Worlds can become independent and conflicts can split governments; triggers and campaign rules are open. |

## 4. Political identity and security rules we must preserve

### Phase 1: ownership is not a flag

- The player's side is stable. Raising a Terran, Klingon or independent flag changes allegiance, not ownership.
- A foreign world flying the player's flag is still foreign. Shared faction access does not grant control.
- A system's origin, current controller, polity identity and gameplay allegiance are separate values.
- Custom governments retain their identities. Unknown governments stay unknown. Separate independent worlds do not become one universal neutral empire.
- Government conquest transfers the previous holder's installations explicitly. A foreign concession or private dock keeps its own owner.
- Foreign ships keep their identities and commanders on return visits and after a change of holder.
- An allied flag does not excuse a witnessed attack. Defenders classify attackers relative to the side being attacked.
- Fleet accounting uses the same combat rule: a peaceful visitor does not prevent capture; a concession actively opposing the raiders can hold it off.
- Arrival protection protects the player temporarily; it does not erase hostile fleets, their orders, or the local government.

### Phase 2: two rules of engagement

| ROE | Player-side behavior |
|---|---|
| Return fire only | Answer attributable attacks on the player's side in this system, and an active raid on the player's holding. Mere hostility or a war flag is insufficient. |
| Defend | Keep that response and the existing engagement of ships hostile to the player or at war with the player's flag. |

The empire default applies as standing orders outside holdings. Local overrides apply only where the player's side has authority; loss makes them inactive and reclamation restores them. Flags do not rewrite policies. Foreign ships and turrets retain their own rules.

Explicit escort orders override ROE, but player-owned installations are never legitimate escort targets. Evidence is scoped to the system where it happened. A stale `attackId` is not a current raid.

**Protect-all is deferred.** We need to distinguish an initial aggressor from someone returning fire before policing every observed shot in a holding.

### Phase 3: checkpoints with consequences

Keep the implemented geometry and encounter fixes:

- Planet-centred zones use the authority's own installations, with the station acting as issuer. Traffic-lane clamp dimensions are not the dimensions of the whole system.
- Markers move with the relevant geometry; a visitor should not fail a hold because its issuing station moved.
- Checkpoint movement owns its state instead of depending on fields also rewritten by traffic, arrivals or tractor beams.
- The player can encounter a foreign checkpoint as well as operate one in a holding.
- Pending or noncompliant visitors can lose docking/service access at the authority's installations. Concessions keep their separate ownership and access rules.
- Arrival at an active foreign checkpoint uses its approach rather than spawning past the encounter.
- Tightening an access policy reconsiders a visitor already inside during the same visit.
- Player aggression can revoke the player's clearance, just as NPC aggression can revoke an NPC's clearance.
- Declared broadcast identity survives save/reload. Replacement ambient ships inherit no prior ship's aggression or orders.

Do not infer an unidentified-transponder system from hull art. Sensors, unknown contacts, and more elaborate identity verification need their own design.

## 5. Ships, art and regional availability

### Catalog policy

**In this delivery:** 174 canonical catalog records, 172 active records and two retired records; all 152 BM2 source mappings are retained. The 38 approved duplicates are merged; five approved variant pairs remain. Details are in `APPROVED-HULL-MERGES.md`. An active record can still be reserved from routine traffic and sales, as with the Gorn designs.

Keep meaningful BM2 variants with different approved art. Merge actual duplicates deliberately. Retired IDs remain documented rather than being silently reassigned to unrelated ships.

Our approved existing drawing envelopes stay intact. Higher-resolution source art should improve a hull's appearance without unexpectedly changing its gameplay size. Newly activated hulls have initial sizes and handling values that we can tune in game.

### Important roster decisions

| Record / art | Decision |
|---|---|
| BM1 26 / retained 211 | Retire 26 as a separate active Vulcan Explorer; retain Vulcan Expeditionary Explorer 211. |
| BM1 63 | Remove/reserve the Vulcan Lifeform. |
| Nebula 4 | Use the actual Nebula-class ship, not a nebula cloud. |
| Kingston 9 / Tug II 10 | Keep the reviewed identities and art. |
| Ferengi Cargo Shuttle 316 (formerly 18) | Retain #316 and its selected artwork; #18 is an alias. |
| Delpin Warship 22 | Keep the corrected hull; prefer the approved higher-quality faithful art. |
| Jem'Hadar Battlecruiser 48 | Keep the corrected battlecruiser art. |
| Galaxy Dreadnaught 49 | Keep its separate identity and Project X / X-Base availability in Paso. |
| Delpin Luxury Liner 51 | Use the liner artwork, not an unrelated ship. |
| Reman Warbird 53 | Keep the Scimitar artwork and special access identity. |
| Concord-class Grand Cruiser 60 | Independent endgame megaship, separate from Excalibur. |
| Dominion Battleship 65 | Keep; does not belong in Blender's routine remnant inventory. |
| Dominion Cruiser 216 | Keep our record and Dominion-core placement. Claude's bundle also contains this design under a different ID. |
| Excalibur 347 | Separate Terran endgame capital at Project X / X-Base; 100 standing and a very high price. |
| Andorian Cargo Shuttle 348 | `andcargo.gif`; cargo shuttle, not an anonymous freighter. |
| Utility Shuttle 349 | Keep the additional design; independent service is provisional, original identity still unknown. |
| Basic Shuttle 350 | Keep as the inexpensive basic shuttle. |
| Klingon Bird of Prey 351 | Second combat step after B'rel, below K'Vort; larger and more war-oriented than a shuttle. Uses the faithful nose-up PSD master. |
| Klingon cargo ship | Its approved image is correct; keep it as a ship. |
| `cargoship3.gif` | Vega-class artwork. Do not create a separate Cargo Ship 3 using that same image. `cargo3.gif` for Kingston is a different asset. |
| Human Bird of Prey PSD | Keep its correct human identity and orientation; do not confuse it with the Klingon hull. |
| Gorn source 131, 132, 169 | Keep available for future design work; their regional/campaign use is still to be settled. |
| BM2 141 major threat | Reserve for missions or a major raid event, not ordinary civilian traffic. |

Everything the user left untouched in the reviewed roster remains approved. This table records the important exceptions and corrections, rather than replacing the full catalog.

### Dominion distribution

- Blender contains remnants of the invasion fleet, not the Dominion's entire industrial and military strength.
- Routine starting access there stays with the catalog's scout/fighter/attack-ship group. A cruiser is not silently added as a normal starter sale.
- Most heavy Dominion strength belongs across the wormhole, around Dominica and its core systems.
- The player can eventually obtain a Jem'Hadar Battlecruiser without travelling to Blender; appropriate core shipyards provide that route.
- Missions, deployments and real invasions may deliberately bring core ships elsewhere. That must be explicit activity, not an ambient spawn loophole.

### Reman access that can survive a lost base

The original secret Remus base remains a meaningful discovery and vendor. We also want recovery access if it is destroyed.

**Proposed implementation:** a discovered design, recovered blueprint, or mission unlock can authorize production at an appropriate surviving yard. This should preserve secrecy, cost and standing requirements. The exact recovery mission and alternate yard are not implemented or settled yet.

## 6. Economy and progression

### Current decision: faction-wide standing

A captain trusted by the Terrans should carry that trust to Terran vendors in other regions. We are replacing the per-world ship-purchase prestige requirement with faction standing.

Money and trust are separate requirements. A wealthy new captain cannot buy a top-end warship simply by changing flags or finding a distant yard. Local stock, political access, checkpoint clearance, cargo capacity and fleet capacity still matter.

Independent ships currently use **independent trade standing**, stored in the existing neutral standing entry. It is a commercial progression score; independent governments and ships still have distinct political identities.

### Initial tuning in this delivery

| Purchase tier | Required standing |
|---|---:|
| Open | 0 |
| Trusted | 15 |
| Respected | 30 |
| Military | 50 |
| Strategic | 75 |
| Excalibur / Concord | 100 |

- A new character begins with 20 standing with the selected faction and zero with others.
- Routine buying and selling builds familiarity only up to 15, preventing trade cycling from unlocking capitals.
- Completed cargo contracts grant +5 destination-faction standing and +2 issuer-faction standing when different. A completed contract cannot pay again.
- Concessions credit their actual employer; custom governments are not silently treated as neutral. Player-held destinations use their original faction for this reward.
- Existing attributed-combat standing remains part of progression.
- The same ship requirements apply to personal, escort and garrison purchases.

Thresholds and earning rates are a **first balance pass**. Wider progression pacing, mission rewards and difficulty remain adjustable.

### Reviewed price and durability targets

| Ship | Latinum | Required standing | Hull | Shields | Cargo |
|---|---:|---|---:|---:|---:|
| Concord-class Grand Cruiser | 1,050,000 | 100 independent trade | 6,500 | 8,000 | 10,000 |
| Excalibur | 1,500,000 | 100 Terran | 9,000 | 12,000 | 5,000 |
| Andorian Cargo Shuttle | 3,200 | 0 Andorian | 60 | 75 | 80 |
| Utility Shuttle | 2,200 | 0 independent trade | 40 | 60 | 35 |
| Basic Shuttle | 900 | 0 independent trade | 25 | 25 | 20 |
| Klingon Bird of Prey | 9,000 | 15 Klingon | 75 | 60 | 35 |

The rest of the roster still uses its imported combat and price baseline. We have not completed a hull-by-hull rebalance of all 174 canonical records.

### Further balancing work

- Compare civilian cargo capacity, operating cost and survivability against comparable military hulls.
- Review high-end civilian ships and their availability separately from military equipment restrictions.
- Keep beginner purchases attainable, while capitals require sustained progress.
- Review imported prices, speeds, power, shields, weapons and cargo for obvious outliers.
- Consider a difficulty setting for economy, combat and boarding risk. Exact presets and multipliers are not chosen.
- Preserve political identity and ownership rules at every difficulty.

## 7. Weapons, devices, flags and passes

### Slot rules

**In this delivery:** three weapon/device slots remain. Unarmed means initially unequipped, not prohibited from carrying weapons. Buying, saving or loading an empty ship must not invent a free phaser. An unarmed NPC cannot fire or produce firing evidence.

**Agreed next:** flags and credentials such as mining passes need their own utility/inventory treatment. They should not consume one of the three combat/device slots. The number of utility slots and which items must be actively fitted remain open.

The original notes explicitly put the Tractor Beam in a weapon/device slot. Do not move every non-damaging device into the pass category just because it is useful rather than destructive.

### Weapon data work

1. Audit BM1, BM2 and the supplied descriptions into one source ledger.
2. Merge identical definitions while retaining source IDs and provenance.
3. Preserve real variants: the single forward Disrupter Canon, dual Disrupter Cannon and Disrupter Turret are not interchangeable duplicates.
4. Distinguish original descriptions from player notes, later-version references and new balance changes.
5. Check actual engine behavior against descriptions: direction, projectile count, tracking, range, recharge, power and effects.
6. Present descriptions with weapon/station review entries so the user can sort them on an iPad without running Flash.

### User-supplied Flash weapon reference

These are supplied source prices, **not a claim that all are implemented or final remaster prices**. Preserve the full supplied descriptions in the eventual weapon ledger.

| Weapon / device | Source type | Source base price | Distinction to preserve |
|---|---|---:|---|
| Phaser Cannon | Pulse | 1,300 | Small, rapid-firing forward pulse weapon. |
| Type VII Phaser | Pulse | 1,500 | Short phaser bursts; not a continuous beam. |
| Disrupter Canon | Disrupter | 1,500 | Single forward bolt. |
| Quantum Pulse Cannon | Pulse | 2,000 | Small Teposian cannon. |
| Photon Torpedo | Torpedo | 2,500 | Low-yield matter/antimatter charge, slow reload. |
| Disrupter Cannon | Disrupter | 3,000 | Dual forward bolts; distinct from the single cannon. |
| Type X Phaser | Beam | 3,000 | Common warp-core-powered beam; source notes describe scaling with ship capability. |
| Tractor Beam | Special | 3,400 | Temporary target hold; interacts with movement and checkpoint orders. |
| Plasma Phaser | Beam | 3,800 | Short-range beam with quick recharge. |
| Bajoran Sail | Passive | 5,000 | Collects antimatter. |
| Engine Disrupter | Special | 5,000 | Area engine-disabling pulse. |
| Polaron Phaser | Beam | 5,000 | Heavy dual beam. |
| Polaron Torpedo | Torpedo | 5,300 | Polarized explosive device. |
| Quantum Torpedo | Torpedo | 6,700 | High-yield quantum singularity charge. |
| Dual Pulse Phasers | Pulse | 7,500 | Dual forward-firing pulses. |
| Disrupter Turret | Disrupter | 7,800 | Dual disruptors with all-direction aiming. |
| Tachyon Field Generator | Special | 8,000 | Forces nearby cloaked ships to decloak. |
| Pulse Turret | Pulse | 8,500 | Dual pulses with all-direction aiming. |
| Gravimetric Torpedo | Torpedo | 9,000 | Slow but strongly tracking, with fast recharge. |
| Warp Core | Passive | 12,000 | Source describes doubling power output; final energy balance needs review. |
| Transphasic Torpedo | Torpedo | 12,500 | Very high yield, very slow recharge. |
| Cloaking Device | Special | 13,500 | Energy-consuming concealment with re-use timing. |
| Thaleron Generator | Special | 15,500 | Persistent radiation cloud and legal/standing consequences. |
| Cutting Beam | Beam | 30,000 | High-end alien cutting weapon. |
| Plasma Torpedo | Torpedo | Not supplied | Concentrated plasma burst; devastating impact and slow recharge. |

The source notes also describe a **Thaleron Test Facility pass** at the Nausica Orbital Bar for 90,000 Latinum. Record that as source material to verify when implementing passes. Its eventual jurisdiction and exemptions need a clear rule; do not accidentally make it blanket permission for every hostile act.

Additional references to evaluate, not automatically import:

- [Broken Mirror 2 remastered source](https://github.com/Quangoz/Broken-Mirror-2-remastered)
- [Vexxiang Flash Trek reference](https://www.vexxiang.com/bible.html)

## 8. Boarding, capture and changing the player's ship

### Agreed behavior

- A ship reduced to **10% hull or below** can become a boarding target, following the remembered BM1 mechanic.
- Successful boarding can capture it for the player's fleet.
- Failed boarding causes the target to scuttle and the deployed away team to be lost.
- The player can transfer command into an owned fleet ship and make it the active player ship.
- Boarding, away missions and training contribute to away-team experience.
- Training can be purchased at selected planets and university stations.
- A failed boarding loses **some** away-team XP while **some** experience is retained. The split has not been chosen.

These are requested rules based on the user's Flash experience, not a claim that the current engine already implements them.

### Proposed implementation rules

- Use a fraction of maximum hull for eligibility; settle shield, transporter range and other preconditions separately.
- Preserve the captured ship's actual damage and equipment. Capture should not grant a free restored capital ship.
- Keep capture ownership explicit. Capturing one ship does not capture its planet or the rest of its faction.
- Preserve the previous player ship as a fleet asset when capacity permits. Define an explicit alternative when the fleet is full.
- Treat retained XP as institutional knowledge and lost XP as experience tied to the deployed team, if that model proves useful.
- Award experience once per meaningful encounter/attempt outcome; avoid repeatedly boarding the same inert target for unlimited training.
- Make chance, casualties and costs visible enough for the player to make an informed decision.

### Decisions still needed before balancing

Boarding success formula; retained XP percentage; replacement crew costs; training prices and locations; shield/range/tractor requirements; repeat-attempt rules; fleet-full handling; transfer restrictions during combat; and cargo/equipment overflow behavior.

## 9. Stations, construction and repair

### Catalog and classification

Review all BM1/BM2 stations and merge identical entries. Keep role variants where services, ownership or art differ. Include descriptions wherever source files provide them.

| Asset / correction | Intended use |
|---|---|
| Maintenance Starbase / sheet L1 | Station, not a tug with cargo containers. |
| `klingonheavyship.gif` | Klingon heavy shipyard, not a combat ship. |
| Sheet L3 and L4 | Defense platforms. |
| Gold four-pod L10 | Station art; exact identity still unresolved. |
| `stationconstructing.gif` | Station scaffolding / construction site. |
| `workbee.gif` | Small construction support craft. |
| `repairarms.gif` | Repair gantry overlay on the player's ship. |

### Repair services

**User decision:** repair arms go over the ship being repaired. They are not an image replacement for the maintenance station.

Planets and repair-capable main stations, shipyards and maintenance stations can repair. **Defense platforms cannot repair.** Audit remaining research, industrial, commercial and special station types before assigning capabilities universally.

**Proposed implementation:** an explicit capability table drives both the service UI and the action checks. A hidden button alone must not be the only thing preventing repairs at a platform.

### Construction visuals

- Draw the actual scaffolding at an appropriate station size while construction is underway.
- Animate small workbees around it.
- Blue beams striking scaffolding represent construction work. They do not cause damage, record aggression or trigger security incidents.
- Keep repair arms and construction scaffolds as separate activities and assets.
- Retain construction progress and make completion replace the scaffold with the finished station.

The supplied originals are small Flash sprites; scale faithfully and prefer better matching originals if found. Avoid inventing high-resolution replacements without a review.

## 10. Politics, incidents and longer-term content

### Incident escalation and alerts

Build on the existing security policy record. The future alert layer can use `all`, `incidents` and `silent`, with useful incident records, witness reports and FLASH-level warnings.

First distinguish initial aggression, legitimate retaliation, orders, and collateral effects. Then attach standing consequences and broader interventions. Returning fire should not automatically make someone the original offender.

Area devices, tractor effects, radiation and construction effects need explicit classification. Visual effects alone are not sufficient evidence of an attack.

### Independence and civil wars

The user remembers Flash worlds declaring independence and triggering civil war. We want a version of this feature, but have not verified the exact original trigger rules or chosen remaster mechanics.

The existing controller/polity/ownership separation provides a foundation. A political change should preserve origin history and foreign concessions, while changing only the government and assets that actually transfer.

Still open: causes of independence, player intervention, loyalty or unrest measures, civil-war sides, mission chains, economic disruption, peace/reunification outcomes and difficulty scaling. Do not add arbitrary rebellion timers without reviewing the gameplay.

### Missions and regional content

- Explicit Dominion deployments and invasions can use heavy core-region ships away from home.
- Major-threat hulls belong in authored missions or major raid events.
- Gorn space and the three reserved Gorn designs need their own placement and identity decisions.
- Rare hull recovery, including the Reman access route, can make exploration and mission completion matter after a unique vendor is lost.

## 11. Suggested build order

This is a work order, not a claim that later phases have already been approved in detail.

1. **Land and verify this reviewed ships/economy integration.** Keep Phase 3, our roster and PR #2 wiring together; use the correct patch base.
2. **Finish the equipment source ledger and slot rules.** Consolidate weapon descriptions, preserve real variants, define flags/passes separately from combat devices.
3. **Add boarding and fleet command transfer.** Include the minimum away-team/training and station capability support required for a complete playable loop.
4. **Complete station capabilities and activity visuals.** Repair restrictions, arm overlays, scaffolds and workbees; finish the station review catalog.
5. **Add durable rare-ship access and broader balance.** Reman recovery route, remaining hull economy audit, progression pacing and difficulty presets.
6. **Build incident escalation and alerts.** Only then reconsider protect-all security behavior.
7. **Develop independence, civil wars and regional mission content.** Use the established identity, ownership and incident rules.

An art or data task can move earlier when it does not depend on unfinished mechanics. Keep engine behavior and acceptance cases together.

## 12. Acceptance gates

| Work package | Evidence required |
|---|---|
| Roster integration | IDs resolve, stock points to the right hulls, approved art/size retained, forbidden-region ships stay out of ordinary stock/traffic. |
| Purchase economy | The same faction standing works across regions; money or a flag cannot bypass trust; self/escort/garrison checks agree. |
| Equipment | Empty ships stay empty across save/reload; compatible weapons can be bought, equipped and fired; unarmed NPCs cannot shoot. |
| Boarding | Real hull threshold, success and scuttle paths, team losses/retained XP, ownership transfer and full-fleet cases. |
| Command transfer | Actual ship condition, equipment and cargo survive; former flagship disposition is explicit; no duplicated ships. |
| Station services | Repair-capable stations work; platforms reject repairs through the real action path; visual effects do not create combat evidence. |
| Security | Existing attribution, political authority and Phase 3 probes remain green; policy, evidence and identity survive intended transitions. |
| Politics | Changes of holder preserve concessions and origin history; independent polities stay distinct; save/reload preserves outcomes. |

No existing-save migration project is required for the current development stage. Newly created saves still need to preserve the features we ship.

## 13. Working agreement

- Preserve the user's reviewed catalog as the content source of truth.
- Recommend an available writer for each substantial new task, as requested; separate implementation and review roles where useful. Do not silently delegate work.
- Use Claude's findings and assets when they fit the approved decisions. Compare actual code and data rather than assuming one branch has everything.
- Report the exact base and tested result with each delivery. A passing older probe does not prove new ship content, prices or equipment rules.
- Keep requested fixes already included in the delivered patch. Clearly state what remains future work.
- Supply reviewable files that work without needing to run Flash, including HTML catalogs and Markdown plans.
- Do not treat a local patch, a pushed branch and a merged release as the same status.

For this delivery's code-specific review, balance details and validation notes, see [SHIP-ECONOMY-REVIEW.md](SHIP-ECONOMY-REVIEW.md).
