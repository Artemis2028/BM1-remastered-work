# Campaign, stations, markets and review fixes

One reviewable candidate on `d629143` (docs-only on top of runtime `5461f55`). It turns the
CAMPAIGN-STATIONS-PROPOSAL into shipped mechanics: every faction and the player empire are strategic
actors with separate economy, production and readiness accounts; operations are persistent and
finite; battles resolve once; captured worlds are occupied and integrated; the Dominion invades
through the real Bajoran wormhole; stations have explicit roles; markets share one per-system stock
ledger with commissions and design recovery; relays are command links; the review ledger from
`5461f55` is closed. Nothing here is pushed, merged or deployed.

The strategic model is `src/campaign-strategy.mjs` (pure, effect-driven, seeded). Station roles are
`src/station-roles.mjs` (data plus resolution). `src/main.js` carries the engine adapter: it builds a
world snapshot, applies the model's effects, materialises operations in the loaded scene and renders
the Empire panel. Every numeric rule lives in named data (`CAMPAIGN_RULES`, `STATION_ROLES`,
`STATION_EXCEPTIONS`, `OFFER_MIGRATIONS`) and is first-pass tuning, not measured balance.

## Goals and where each is proven

| # | Goal | Shipped as | Evidence |
| --- | --- | --- | --- |
| 1 | Every faction and the player empire as strategic actors with three separate accounts | `book.polities[id]` with `treasury/materials` (economy), berths/workforce/repair derived from owned stations (production) and persistent `hulls` (readiness). The player's treasury **is** `state.latinum`; the player's readiness is derived from `state.playerFleet`; player production is the existing fleet build order book. No second copy of money, no second simulation. | model group "three accounts are separate"; gate A; gate B (income credited once, never re-credited on reload) |
| 2 | Opening Earth–Klingon war retained, resolved strategically | `advanceDiplomacy` still cannot roll the war away (`5461f55`). `resolveCentralWar` ends it exactly once when a belligerent holds no world, or its home world (`Earth`/`Qonos`) has fallen and its ready strength is below 25 % of the winner's. The settlement is applied through the ordinary diplomacy record, reported, and logged. | model group "war resolves strategically, once"; `test:world` group 7 |
| 3 | Persistent finite AI operations, single-resolution battles, capture = defeat + hold, occupation and integration | Operations commit real hull records (`status: assigned`), move by route hops, engage, and either grind (attrition scaled by the strength ratio), storm (attackers ≥ 4× the local defence) or withdraw. A world is captured after `captureHoldDays` of unopposed hold. An engaged operation at the captain's system is **claimed by the scene** and materialised as real NPC hulls in waves of ≤ 6 (`CAMPAIGN_WAVE_SIZE`); the model never resolves it offscreen while the captain is present; the scene reports survivors once. Leaving hands the survivors back. Captures record an occupation (output 50 % → 100 % over 20 days) and start the integration clock. | model groups "single resolution", "scene claim"; gates C, D, E, F |
| 4 | Dominion as an independent invader through the real wormhole | `dominion` phases dormant → reconnaissance (day 25) → staging (day 45) → invasion (day 60, or up to 30 days later if the expedition is outmatched). Entry and staging systems are resolved from `bajora-dominica-wormhole` (Bajora idx 46 → Dominica idx 58) at run time. Two warnings precede the expedition. Reinforcement convoys are finite (8) and interdicted while the entry system holds ≥ 600 defence strength under non-Dominion control. Before the invasion the Dominion launches no operation and is never picked as an ambient attacker. No hull is spawned anywhere except at its staging system or bridgehead. | model group "Dominion"; gate G; `campaignCanRaid` |
| 5 | Shared per-system/hull stock ledger, retained replenishment, availability variety, out-of-stock and commission visibility | The per-system union (planet `shipStockIds` ∪ station effective offers ∪ current vendor fallback) feeds one `Fleet.ensureStock` record per system/hull. Replenishment stays the reviewed randomized saved 3–7-day schedule. New records get a seeded capacity of 1–3 (mean 2, the previous constant); existing records keep theirs. Ship cards show quantity, next resupply day and the design registry line; Buy is disabled when out of stock and **Commission** reserves the next unit for the full price, delivered to the fleet at that system with the next resupply (lost with the vendor, like a build order). | gate J; fleets 91/91; merges 23/23 |
| 6 | Universal captured-world design access | `majorWorldQualification`: population ≥ 4,000 **or** ≥ 5 operational non-platform stations. Any conqueror — every faction pairing and the player — starts a 30-day retooling clock on capture (half speed without a working yard); completion licenses the source culture's native designs with provenance (`licenses[id] = {source:'integration', from, systemIndex, acquiredDay}`). Minor worlds grant nothing. For the player the designs become licensable and buildable at the player's own yards there (commission only, never shelf stock); plan price and standing rules are unchanged. | model groups "qualification", "integration matrix incl. player"; gate L |
| 7 | Recoverable special designs | The design registry records every authored vendor per hull. Losing the last one offers one recovery contract (engineers or archive, seeded); an unpursued contract lapses after 400 days and a broker offers a last lead once (fee at a bar or trade station). Steps: rescue/recover at the lost site → deliver to a compatible yard (construction for the mass, trade culture allowed to sell it, catalog-eligible). Completion relocates lawful access once; the recovered design is a real offer at the new yard (exempt from the eight-entry display limit). Plans: 4× hull price, next standing tier (0→15→30→50→75→100, capped) via `Campaign.planQuote`; an owned licence is never charged again. Catalog shows "Original yard lost — locate engineering archive." | model group "design recovery"; gate H |
| 8 | Explicit 36 station roles, named exceptions, transaction-level enforcement | `STATION_ROLES` for every audited type; `resolveStationCapabilities` narrows by status (destroyed, construction, damaged, unstaffed, dormant, abandoned). Ship sales, weapon sales, refit, build, plans, training and relay are read from capabilities at transaction time (`getShipyardStock`, `getStationWeaponStock`, `buyWeapon`, `orderFleetBuild`, `fleetPlanStatus`). Personal hull/shield repair remains available at every dockable station (reviewed rule). | `test:stations:roles` 6/6; `test:stations:offers` 14 checks |
| 9 | Offer migration before closing services | Named destinations below; sources retain their unrelated weapons; inactive platform offers stay inactive. | `test:stations:offers` compares purchasable (system, hull/weapon) pairs against the committed baseline `OFFER-BASELINE-d629143.json` |
| 10 | Relays as command links | `relayConnectivity`: systems with an operational relay you own (or the holder is not at war with you and the system is yours) are connected; a sector array (`relay: 2`) also connects its neighbours. Dispatching a formation whose ships sit in an unconnected system queues the order; it is acknowledged exactly once on the next calendar day a link exists and then dispatched. Local orders never need a relay. | model group "relays"; gate I |
| 11 | Persistent mission flows and debug controls | Contracts: relief, escort, evacuation, repair, recon, blockade and archive (recovery). They are offered by real events (a hostile operation engaging your or a partner's world → escort/blockade; damage to your installation → repair; the first Dominion warning → recon) and by the debug controls; they persist, expire after 40 days and complete against real state. | model group "missions"; gate P (completion and expiry); gate N (debug) |
| 12 | Campaign/empire UI and reports | Empire button in the top-left tabs opens the Empire & campaign panel: Your empire (economy, production, readiness, worlds and integration, relay orders), Other powers (dated estimates with an error band; exact for partners), Fleets & battles, Contracts & recovery, Campaign log. Uncharted systems are masked. Campaign events are galaxy reports in a new Campaign folder; Dominion warnings are galaxy-wide rumours. | gate N; screenshots |
| 13 | §11 review fixes | Deliver contract cargo / Sell cargo are separate everywhere (planet menu, HUD action, keys `E` and `G`; `tradeAtPlanet` remains as the combined legacy action). The incoming-hail panel is laid out around the map thumbnail and the recovery panel. `spawnFleetAttack` coerces both sides of its guard. The playtest recovery assertion polls (bounded) instead of sleeping. The reports dialog states that browsing marks reports as read. The cloak delivery bypass is untouched. | gate M; playtest 22 |
| 14 | Reviewed runtime rules preserved | 600-unit world drop-off, 2,500-unit transporter gate, docking for repair, 1,400–2,600 security zones, arrival geometry, disabled grace, upkeep exemption for the personal vessel, capture/prize rules: not modified. | all existing gates rerun on `dist` |
| 15 | Versioned save migration, deterministic replay, bounded history | The campaign book carries `version`; an older save without one gets a book at its current day and legacy faction budgets fold into the single treasury once (private ledgers stay). Daily, chunked, bulk and reloaded advances give identical checksums (2,000 synthetic days; 40 in-engine days). History ≤ 300 entries, operations ≤ 60 (resolved ones trimmed), missions ≤ 60, recoveries ≤ 40, orders ≤ 40, income ledger ≤ 400 days. | model group 1; gates B, O |
| 16 | Acceptance evidence | This document, the gate logs, three seeded 300-day unattended runs (`test:campaign:balance`), screenshots. | `validation/` |
| 17 | Packaging | Patch on `d629143`, identity-preserving bundle, SHA256SUMS, CANDIDATE.json. Nothing pushed or merged. | handoff README |

## Decisions a reviewer should look at first

**One account per faction.** Faction reconstruction (`advanceFactionReconstruction`) now spends the
campaign polity treasury through `reconstructionFunds(owner)`; the legacy `factionBudgets` entries for
recognised factions are migrated once (max of the two) and deleted, so a faction is never funded
twice. Private businesses (`private:*`) are not strategic actors and keep their own legacy ledger.
The opening treasury is `max(120,000, 15,000 × worlds)`: the floor is the reviewed reconstruction
budget, so a faction can still rebuild a lost installation on day 2 (playtest and intelligence gates).

**Capture is recorded by the ownership hooks.** `transferSystemControlToPlayer/Faction` call
`campaignRecordControlChange`, so a claim, a local seizure and an offscreen capture all leave the same
occupation and integration record. A local campaign win records the capture in the model first (with
the defender still on record) and then transfers control with the hook suppressed, so nothing is
recorded twice (gate D asserts exactly one capture).

**Single resolution with waves.** A claimed operation materialises at most six hulls at a time; when a
wave is wiped out the next wave arrives instead of "repelled". Spawned hull ids are tracked on the
operation, so save/load mid-battle restores the same hulls and unspawned hulls are alive when the
battle is reconciled. Leaving the system releases the operation with the survivors' condition; the
snapshot never keeps a campaign attack, so returning re-materialises what is left.

**Ambient raids are budgeted.** `updateSystemActivity` draws the raid from the attacker's ready pool
through a zero-hop operation; a power with no ready hull (or the Dominion before its invasion) is not
a candidate attacker. `spawnFleetAttack` remains the direct debug/test path and is labelled as such.

**The hidden Dominion region stays hidden.** Only the Dominion routes through the wormhole until the
far side has been charted, so no other power "discovers" it by strategic accident; panel text and
reports mask uncharted systems; reports about unknown systems are not stored at all.

**Strength is price-based and explicit.** A hull's strength is `price / 1000 × condition × crew ×
supply`. A station's defence effect × 35 is its garrison (a platform ≈ one escort, a starbase ≈ three).
There are no hidden combat multipliers; the loaded scene uses the ordinary NPC combat path.

## Station roles and named exceptions

All 36 audited types have an explicit role with services, effects (units in
`STATION_EFFECT_UNITS`) and mission hooks. Ships are sold through real shipyards (general), licensed
depots (authored offers only), small-hull maintenance stations (mass ≤ 4) or documented attached lots;
relays, defence platforms, habitats and bars have no generic hull shop. Two model changes were needed
so that every active faction can build: **Romulan Starbase (90)** gets heavy construction (1 standard,
1 heavy berth) and **Breen Station (112)** standard construction (1 berth), because neither culture has
a native yard type.

Named exceptions (`STATION_EXCEPTIONS`): Vortara cloning Facility (`69-200`) sells only its documented
transport depot (hull 345); Kpec (`30-106`) is a detention facility with no habitat benefits; the VSU
Dorms (`11-58`) house students without duplicating university bonuses; the Vulcan surplus depot stays
licensed; the fourteen `egg-shipyard-*` vaults are archives; the Gorn dock and clutch yard are dormant
until the authored discovery; the Borg node is a derelict with no Dyson bonuses; Son'a, pirate, Hirogen
and Suliban sites are specialists; the Arboretum keeps its two Vulcan hulls as an attached licensed
lot; the three Tholian research stations keep their lattice slips; the casino, T19, Dyson and Biodome
security lots keep their single authored weapons.

Offer migrations (every moved item keeps provenance; sources keep their unrelated weapons):

| From | To | Moved | Kept at source |
| --- | --- | --- | --- |
| Kathy's Pub (`5-43`, Bar) | Swiss Miss (`5-42`) | hull 1 | weapon 14 |
| Nausica Orbital (`15-71`, Bar) | Nausican Chop Shop (`egg-shipyard-pirate-1`) | hull 11 | weapon 36 |
| Nova Bar (`54-180`, Bar) | Nova Yard Beta (`54-169`) | hulls 33, 326, 327, 328, 64, 228 | — |
| Brea Bar (`57-184`, Bar) | Brea Base (`57-185`) | hulls 60, 48, 238 | — |
| Swiss Relay Array (`import-201-5`) | Free Swiss Exchange (`5-45`) | weapons 23, 24 | relay only |

TS-293 (`8-47`, hull 343) and Nova Yard Defence (`54-171`, hulls 228, 227, 230, 232) remain inactive
platform data, as before.

Measured consequences (offer gate, all standings 100): purchasable (system, hull) pairs 720 → 715 —
the eight lost pairs are the price-ranked fallback at **SB-203 (abandoned)** in Lysia, which is now
offline until restored; no authored hull access is lost. Purchasable (system, weapon) pairs 361 → 305:
one authored loss (weapon 3 at the dormant Gorn Muster Dock, behind discovery) and 56 fallback-only
offers at 31 no-commerce placements. Seven systems lose their only weapon vendor because their only
installation is a habitat, ore station, wormhole generator, abandoned base or dormant Gorn site:
Lik Prime, Gorn, Lysia, Kardon, Hos'Ichu, Erasariel, Pirates Haven. A root cause to know about:
`getTradeStandingFaction` is `null` for neutral polities (`polity:N`), so factioned authored hulls at
stations in independently governed systems were never purchasable on the parent either; the gate
measures actual access, not the CSV's "live" column.

## Tuning values (first pass, `CAMPAIGN_RULES`)

| Rule | Value | Meaning |
| --- | ---: | --- |
| worldRevenueBase / worldRevenuePerPopulation | 400 / 0.05 | latinum per controlled world per day, plus population × 0.05 (Earth ≈ 685) |
| materialsPerWorld | 1 | duranium per world per day (mining effects add more) |
| hullUpkeepPerMass | 1 | same basis as the personal fleet bill |
| openingTreasuryPerWorld / floor | 15,000 / 120,000 | opening treasury = max(floor, per-world × worlds) |
| openingStrengthPerWorld / openingMaxHullsPerWorld | 500 / 6 | garrison budget per world, best-fit from three seeded legal-pool draws |
| openingStrengthMultiplier | klingon 1.0, terran 1.3 | Klingons hold more worlds; Earth's garrisons are denser |
| openingReserveHulls | klingon 6, terran 4 | extra hulls at the home world |
| homeGarrisonPerWorld | 2 | ready hulls an AI keeps back per held world before committing an offensive |
| planningIntervalDays / attackCommitFraction | 6 / 0.45 | one plan per interval, committing 45 % of spare ready hulls (min 3) |
| minReadinessRatioToAttack | 1.6 | committed strength vs local defence needed to launch |
| suppressionRatio / captureHoldDays | 4 / 4 | ≥ 4× the defence storms the world; otherwise attrition; capture after 4 unopposed days |
| attritionPerDay | 0.15 | share of the weaker side's hull points lost per day of even fighting (× ratio, seeded swing) |
| retreatFraction | 0.4 | attackers withdraw below 40 % of committed strength |
| garrisonStrengthPerDefense | 35 | station defence effect → abstract garrison |
| strengthPerPrice / supplyFloor | 0.001 / 0.35 | hull strength basis; strength multiplier with no supply |
| aiWarChest | 250,000 | growth builds beyond the opening count above this treasury |
| buildLatinumFactor / buildMaterialsPerMass / buildDaysPerSqrtMass | 0.82 / 2 / 2 | `Fleet.buildRecipe` basis; heavy hulls (mass ≥ 6) need a heavy berth |
| repairPointsPerBerthDay | 200 | repairing this many hull points occupies a berth for a day |
| occupationOutputFactor / occupationIntegrationDays | 0.5 / 20 | output of a freshly captured world and the ramp |
| majorWorldPopulation / majorWorldStations / integrationDays | 4,000 / 5 / 30 | qualification and retooling |
| dominionReconDay / StagingDay / InvasionDay | 25 / 45 / 60 | phase eligibility days |
| dominionExpeditionStrengthRatio / MinStrength / MaxHulls | 0.8 / 3,000 / 40 | expedition sized against the strongest power at staging time |
| dominionReinforcementEveryDays / Hulls / MaxConvoys | 12 / 2 / 8 | finite reinforcement through the wormhole |
| dominionBlockadeStrength | 600 | defence at the entry system (non-Dominion held) that interdicts convoys (≈ a starbase plus escorts; the captain's fleet vessels there count) |
| dominionOpportunityRatio | 0.9 | expedition vs strongest power needed to invade on day 60; otherwise by day 90 |
| centralWar / homeWorlds / resolutionStrengthRatio | terran–klingon / Earth, Qonos / 0.25 | strategic settlement rule |
| recoveryOfferDays | 400 | an unpursued recovery contract lapses; one broker lead follows |
| historyLimit / maxOperations / maxQueuePerPolity / maxHullsPerPolity | 300 / 60 / 12 / 120 | bounds |

Population threshold 4,000 qualifies 66 of 101 worlds by population alone; the 75th percentile
(7,000) would be more selective. Left at the proposal's value.

## Measured balance (unattended, captain parked at Denmark)

`test:campaign:balance` — three seeds, 300 days, no captain involvement (Chromium 141 on a
2-core host; ms per day is the whole calendar step, not the model alone):

| Seed | Opening K:T strength ratio | Day 100 worlds T / K / D | Day 300 worlds T / K / D | Captures | Built / lost | War settled | Book size |
| --- | ---: | --- | --- | ---: | --- | --- | ---: |
| balance-1 | 1.12 | 10 / 9 / 10 | 10 / 8 / 14 | 60 | 105 / 118 | no | 167 KB |
| balance-2 | 1.42 | 10 / 9 / 9 | 14 / 6 / 11 | 56 | 82 / 88 | no | 177 KB |
| balance-3 | 1.20 | 10 / 7 / 12 | 6 / 9 / 16 | 73 | 114 / 117 | no | 177 KB |

The Dominion always reaches its invasion on day 60 after two warnings, takes Bajora, and grows from 8
to 11–16 worlds in 300 days; convoys stop at 8. The central war grinds without settling in these
runs (with the previous 2.6:1 opening it settled by day ~95 with Earth's fall). Border worlds still
change hands often (56–73 captures per 300 days). The whole campaign step costs 9–16 ms per calendar
day in this environment; a ten-day jump is well under a frame budget's worth of work but is not free.
These are the numbers the tuning table produces, not a balance claim.

## Saves, migration and size

`state.playtest` keeps version 1; the campaign book at `playtest.campaign` carries its own version
and is rebuilt (discoveries and station status maps preserved) if the shape is older. Reservations
live in the fleet book. Encounter snapshots carry `campaignHullId`. Loading a save from `5461f55`
creates the book at the saved day, initialises opening forces from the saved ownership map and folds
faction budgets into the treasuries once (gate O). After 300 unattended days the book is ~170–190 KB
and the whole playtest record ~250–270 KB per save slot.

## Debug controls

Cheats & Debug gains a *Campaign & empire* section: advance 1/10/30 days (normal calendar path);
Dominion phase (forced override, labelled); damage/restore an installation (normal effect path; takes
a station id or the tracked target); deplete/replenish a stock record (normal ledger); offer any of the
six station contracts; Gorn discovery (override); set a power's treasury or ready hulls (override);
open the Empire panel. Codes: `campaign advance 10`, `campaign phase staging`, `campaign treasury
klingon 500000`, `campaign readiness romulan 30`, `campaign damage <id>`, `campaign restore <id>`,
`campaign stock <hull id|current> deplete|replenish`, `campaign mission relief`, `campaign discover
gorn`. Wars still come from the diplomacy controls.

## Validation

New: `test:campaign` (13 model groups; 2,000-day daily/chunked/bulk/reloaded equivalence),
`test:campaign:ingame` (16 browser groups), `test:stations:roles` (6), `test:stations:offers` (14
checks against the committed offer baseline), `test:campaign:balance` (evidence runner).

Existing, all rerun against `dist`: playtest 22, captain briefing 13, intelligence follow-up 11,
briefing/cargo 7, fleets 91, sensors 54, EW 33, seeker 38, power 29, hull merges 23, behavior
probe, debug menu, station defence, ships integration and in-game smoke, balance 19, plus the pure
suites (world 7, intelligence 5,901/8,786, fleets 31, sensors 26, EW 20, seeker 14, power 21). One
pre-existing failure, unchanged from `d629143`: `test:ships:economy` 29/30 — its delivery check
assumes docking implies proximity to the world, which the 600-unit drop-off rule from `5461f55` does
not grant. It fails identically on the base build.

Fixture changes: the playtest recovery assertion polls for `personalCondition === 'operational'`
(bounded 12 s) instead of sleeping 5.5 s.

Screenshots (validation/screens): Empire panel desktop and mobile, Other powers, hail layout desktop
and mobile (no overlap with the map thumbnail or the recovery panel), plus the existing playtest,
briefing and report fixtures.

## Not implemented, deferred, or worth knowing

- **Tactical Cube** plan/capture content stays deferred (excluded from native designs, integration
  offers and plans). **Gorn** services and recovery stay behind the authored discovery flag; the
  debug override marks the discovery complete but no discovery event is authored here.
- Independent (neutral) governments and pirate havens are not strategic actors: they neither raise
  hulls nor become objectives. The player can still claim them through the existing rules.
- AI production is throttled to two concurrent growth orders per polity above the war chest; a rich
  polity therefore banks latinum rather than building without limit. Deliberate, and tunable.
- Station damage from offscreen battles reduces output and heals 5 %/day where the owner has repair
  capacity; it never destroys a station. Only the loaded scene destroys installations.
- Occupation NPC fleets that remain in a scene after a local capture are the ordinary ambient
  occupation ships; campaign hull records are not kept in sync with their later fate.
- The broker recovery tier is reached only after an engineers/archive contract lapses (400 days); the
  proposal's "all original sites gone" trigger is folded into that lapse.
- Balance is first-pass: border worlds change hands often unattended; the Dominion is a credible but
  beatable invader in three seeds only. Longer or seeded-with-player runs are not claimed.
- Estimates in *Other powers* are ±25 % (±10 % for partners), refreshed weekly; there is no espionage
  mechanic beyond that.
- The 14–70 SB-203 fallback offers, the seven weapon-vendorless systems and the neutral-polity trade
  faction behaviour listed above are documented consequences, not fixes.
- No native Safari/iPad run, no duel win-rate study, no EW performance campaign.
