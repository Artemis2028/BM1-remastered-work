# BM1 — Fleets, boarding, and ship economy

**Version 0.7 · 14 September 2026 · Consolidated proposal for review**

This revision replaces v0.1–v0.6 and the subsequent twenty-question discussion. It is a design deliverable, not an implemented patch or permission to merge. Work only in `Artemis2028/BM1-remastered-work`; leave `Artemis2028/BM1-remastered` untouched.

### Changes in v0.7

Finite system pools explicitly combine planetary and station-specific authored offers. Vendor lists remain separate filters; population and market cannot erase authored supply. A follow-up review's location claim was checked against the exact pinned GitHub data and runtime name/parser paths: X-Base remains in Paso, and the Swiss exchanges/salvage vault are in New Switzerland. No station is relocated by this proposal.

### Changes introduced in v0.6

Narrow review corrections: preserve authored station-stock precedence under service filters; require condition- and hull-scaled paid repair rather than retaining the flat percentage charge; correct the cap audit's counting units; state the disable floor's intended risk and its interaction with the upper guard; and cite each traffic row to actual planet fields. No new ownership limit, clock, upkeep rate, or boarding-policy change is introduced.

## 1. Authority and scope

Rafael's latest answers govern this proposal. In this document, **prestige means faction-wide standing** for hull/plan access, consistent with the earlier economy decision; it does not mean earning separate favor at every planet. Top-tier hull plans require **100 with the relevant faction**, with no extra tier above 100. Authored mission restrictions remain separate; the Tactical Cube is deferred.

Engine grounding is the reviewed `04abbfc7e1d28e5178ba353a781aaa9e53dcc4d9` integration candidate, whose engine matches `51738ca`. Verify the real implementation base before coding. Fable's engine reviews informed the structural requirements; named hooks and selected critical paths were checked against the reviewed source. No current-main or new performance result is asserted here.

### Accepted decisions

| Area | Required behavior |
|---|---|
| Economic time | Calendar advances by a journey's travel days, not a fixed day per jump or a continuous idle timer |
| Wormholes | Zero travel days; no time-driven upkeep, restock, market drift, or construction progress |
| Fleet ownership | No total ownership, escort-total, or per-system defense ownership cap |
| Formations | Each formation has a size limit and a flagship; any number of formations may be commanded |
| System activity | Background traffic varies by BM planet lore; Earth is busier than Paso |
| Upkeep | Use original Flash upkeep rules/rates; charge fleet vessels only, not the current personal vessel |
| Debt | One book, with separately identified upkeep and rescue entries |
| Disablement | Approximately 10% hull with an absolute minimum disable band; disabling remains an attempt |
| Boarding | Success captures; failure scuttles the target and loses the team |
| Captured mobility | A boarded prize can jump with the fleet without a repair-to-20% gate; repair is still paid |
| Team XP | Keep 50% XP retention on loss for now |
| Boarding chance | Keep the proposed base/XP/resistance formula for first tuning |
| Capture consequences | Equivalent destruction standing consequence under the same witness/evidence rules; no duplicate outcome penalties |
| Ship sales | In scope; damaged vessels are valued by condition rather than undamaged retail price |
| Ship stock | One shared finite ship market per system, with randomized calendar-based replenishment |
| Plans | Four times canonical hull purchase price; one standing tier higher, capped at 100 |
| Construction | Player stations can build licensed hulls; major starbases and shipyards are appropriate facilities |
| Station roles | Maintenance yards sell smaller ships; defense stations do not sell ships, but may sell appropriate weapons |
| Build loss | Destruction loses unfinished orders/committed inputs; loss of ownership pauses orders for possible recovery |
| Delivery loadout | Authored base-game weapons and basic systems; deliberately unarmed designs stay unarmed but armable |
| Fleet refitting | Players can customize fleet weapons and equipment; choices persist |

### Explicitly proposed, not yet settled

The numerical disable floor, formation size, journey-days conversion, stock quantities/intervals, ship-build recipes/durations, resale formula, repair pricing changes, and exact arrears restrictions remain tuning work. The team prices remain proposals. Original Flash upkeep is a required research dependency, not permission to silently replace it with an invented percentage.

## 2. Travel calendar and event ordering

### Existing foundations

On the reviewed engine, `completeWarpTravel` increments `state.day` by one. Wormhole transit does not increment it. `completeDueStationConstructions` and `updatePlanetMarketVariance` already consume the day counter. Retain a calendar model and extend its advancement; do not introduce the previously proposed ten-minute economic day.

### Journey duration

Calculate and show `travelDays` when quoting a route. It must reflect route length and the chosen travel model rather than always being one. The exact conversion from map distance and any permitted warp-speed modifier must be documented and tested before implementation is accepted; no recovered Flash duration formula is claimed here.

Snapshot quoted route inputs when travel starts. At successful travel completion, commit the corresponding days exactly once. A failed/aborted jump advances no days or charges unless an explicit partial-travel rule is later approved. Keep the existing visual transit duration separate from calendar days: a five-second animation may represent several travel days.

A five-day journey advances all due economic events by five days throughout the map. It charges applicable fleet upkeep for those five days, applies scheduled restock events, advances station/ship builds, and updates day-based markets. Process every due interval in order, not one update using only the final day. If a newly completed ship becomes fleet property partway through the interval, charge it only for subsequent eligible days.

Centralize this in an idempotent calendar-advance transaction with a saved journey/advance ID. Proposed day-boundary convention: settle upkeep for the day just elapsed using its ownership/control state, then complete builds and restock events due at the new boundary. Newly delivered ships start liability for the following day. Document the convention so test harnesses do not guess it.

Zero-day wormholes still perform physical departure/arrival and related security cleanup, but do not run time-driven economic events or reroll markets. The same applies to idle play, pause, and real-world offline time: no calendar advancement. Action timers for movement, shots, boarding, and visual effects continue normally during active local gameplay. A player may deliberately use wormholes to avoid travel days; that is an accepted consequence, not a loophole to close silently.

### Migration

Keep saved `state.day` and existing station build due-days intact. Add new scheduling/last-settlement fields without charging invented historical upkeep or instantly finishing old projects. Migrate once and version it. Inspect other day-dependent systems, including contracts and events, for multi-day jumps; preserve their intended expiry/reward semantics.

## 3. Persistent physical ships — first implementation foundation

Fleet records currently reconstruct NPC ships on entry. `getPlayerFleetNpcShips` and `getPlayerEscortNpcShips` call `createNpcShip`, followed by `restoreFleetPower`; that is insufficient for condition/loadout conservation.

Add one versioned owned-vessel authority. Each vessel needs a stable physical ID/incarnation, catalog hull ID, owner, name, fleet/formation membership, location/system, absolute maximum/current hull and shields, operational condition, damage seed, weapon slots/inventory, cargo, installed equipment, power/energy/crew, cooldowns, sensor/transponder state, and upkeep reference/accounting state. Runtime NPCs and global player fields are adapters to this authority, not separate competing inventories.

Write back before save, departure, capture, command transfer, refit, sale, and any runtime rebuild. Restore before AI, damage, rendering, or catalog defaults can overwrite physical state. Preserve valid zeros and explicit empty slots. An unauthored NPC cargo hold starts empty; do not infer loot from its trading dialogue or role. Authored cargo must be consumed/persisted through the actual inventory transaction.

New purchases/builds receive their authored default systems once. Legacy records missing snapshots get one documented migration initialization. New-format empty loadouts, zero shields, and zero energy are not missing legacy data.

`ensureNpcCombatStats` currently treats non-positive hull as uninitialized and restores it. Correct that: zero hull and terminal condition stay destroyed. Initialize genuinely absent stats only. Repeated normalization, power restore, render, and damage calls must not revive a wreck.

### Safe persistent storage

Economic records must never live in `state.systemStates`, a runtime cache invalidated by multiple rebuild paths. Extend saved `planetMarkets` through a versioned per-system record/adapter for ship quantities without breaking its existing trade-offer arrays. Extend existing saved station/plan structures for production. Store fleet physical records and financial ledgers in explicit saved state.

## 4. Fleet ownership, formations, and local activity

Remove the existing `MAX_PLAYER_ESCORT_SHIPS = 6` and `MAX_PLAYER_FLEET_SHIPS_PER_SYSTEM = 8` ownership/assignment gates. The checked source has **14 matching lines: two declarations, two enforcement gates, and ten display lines**. Excluding declarations gives twelve use-site lines; counting identifiers gives sixteen occurrences because two display lines each mention both constants. Use those units explicitly rather than treating them as conflicting gate counts. The two enforcing helpers are `canBuyFleetShip` and `canBuyEscortShip`; audit their callers and all equivalent paths on the implementation base. Do not merely enlarge constants or delete the wording. No ship may be lost, excluded from restoration, or rejected by purchase/capture because a player-owned roster is full.

### Formations and flagships

A formation is a command group, not an ownership container. Proposed first size: **12 ships including its flagship**, subject to formation testing. Rafael approved a formation cap, not this exact number. Players may create multiple formations, designate each flagship, and direct several formations to the same engagement.

Commands include move/rendezvous, defend, patrol, attack, attempt to disable, withdraw, and hold. Formation intent inherits from the flagship/group order, with clearly displayed per-ship overrides. Existing Shift+1–8 controls should remain useful; a new fleet roster/group UI provides selection beyond shortcut slots.

A formation at capacity cannot take another member, but the ship remains owned and can join another formation or remain independently assigned. Formations maneuver as groups into usable engagement positions instead of adding unlimited rings around the personal vessel. Losing a flagship uses a deterministic deputy selection among surviving operational members, with a visible notification; if none can command, hold the surviving group rather than delete or scatter ownership records.

Use existing communication/knowledge boundaries for tactical targets and shared observations. A flagship order does not grant its members hidden coordinates, live global hull values, or relay privileges absent from the sensor model. Strategic destination orders and tactical fire authorization are distinct.

### Background traffic versus owned presence

Author an activity profile for every system using the game's own descriptions, facilities, economy, faction state, and authored encounters. Prefer BM's alternate-history lore over incompatible prime-universe assumptions. Existing numeric population fields sometimes conflict with descriptions, so population alone cannot set traffic.

Initial source-grounded interpretations, not final counts:

| System | Proposed profile | Original planet fields and rationale |
|---|---|---|
| Earth | High mixed traffic; patrols and war logistics dominate | `population: 5700`, `market: 5`, six raw ship-list entries; government center under wartime strain. [Earth record][planet-data] |
| Paso | Very sparse normal traffic; localized X-Base activity | `population: 2300`, `market: 0`, empty planetary ship list; description says strip-mined and uninhabitable. The conflicting population field must not create a busy civilian hub. [Paso record][planet-data] |
| New Switzerland | Independent exchange/salvage traffic concentrated around its brokers; exact density to author | Ten stations, four with explicit ship lists totaling thirteen distinct raw hull IDs; includes Kathy’s Pub, Swiss Miss, Free Swiss Reserve Exchange and Independent Salvage Vault Alpha. [Station records][station-data] |
| Ferenginar | High merchant traffic and commercial escorts | `population: 7000`, `market: 8`, six raw ship-list entries; trading homeworld. [Ferenginar record][planet-data] |
| Vulcan | Research/civilian activity; modest military presence | `population: 6000`, `market: 6`, six raw ship-list entries; research and education with a small lightly armed fleet. [Vulcan record][planet-data] |
| Blender | Sparse, controlled remnant activity | `population: 9000`, `market: 0`, two raw ship-list entries; surviving Dominion forces rebuilding, so raw population alone would mislead. [Blender record][planet-data] |
| Denmark | Sparse visitors rather than a busy inhabited hub | `population: 0`, `market: 0`, empty ship list; no present civilization described. [Denmark record][planet-data] |
| Gorn | Dormant/sparse, preserving reserved-faction rules | `population: 0`, `market: 0`, raw ship list `[11,31,11]`; depopulated description. Legacy stock entries do not activate the reserved faction. [Gorn record][planet-data] |

[station-data]: https://github.com/Artemis2028/BM1-remastered-work/blob/04abbfc7e1d28e5178ba353a781aaa9e53dcc4d9/data/stationData.json

[planet-data]: https://github.com/Artemis2028/BM1-remastered-work/blob/04abbfc7e1d28e5178ba353a781aaa9e53dcc4d9/data/planetData.json

These numeric fields are source values, not independently interpreted population units or proposed spawn counts. Raw ship-list entries are eligibility/authoring evidence, not available stock quantities or unique modern hull counts; resolve aliases/duplicates through the existing catalog. Paso's empty planetary list does not remove authored X-Base station offerings. Keep planetary, station-specific, and faction/region eligibility distinct while sharing system quantity. Each of the remaining system profiles must cite its own source record and explain conflicts between description and numeric fields.

#### Verified system mapping — do not subtract twice

`planetData.index`/`systemNumber` are one-based labels; runtime `systemIndex` and `state.planets` use zero-based indexing. `parseStationData` uses an explicit `systemIndex` directly, and only subtracts one when falling back from `systemNumber`. `normalizeMapNames` and planet construction preserve the JSON name array order.

| Runtime systemIndex | One-based systemNumber | Runtime name | Checked station evidence |
|---:|---:|---|---|
| 3 | 4 | Alpha Centauri | Alpha Yard/Beta Yard and other facilities; not X-Base |
| 4 | 5 | Paso | X-Base (`shipIds: [49,347]`) and three abandoned XR stations |
| 5 | 6 | New Switzerland | Ten stations; four authored ship sellers, thirteen distinct raw hull IDs |

Sources: [station records][station-data], [planet records][planet-data], [map names](https://github.com/Artemis2028/BM1-remastered-work/blob/04abbfc7e1d28e5178ba353a781aaa9e53dcc4d9/data/mapnames.json), and the reviewed main.js parser. X-Base also carries `shipVendor: paso-project-x`. Its empty planetary ship list does not make Paso a market with no ships.

The follow-up's “Paso has thirteen hulls and X-Base is in Alpha Centauri” is not supported at the specified pin; it matches interpreting zero-based station indices as one-based system numbers. Do not use its all-system availability count without regenerating the two-layer audit with the correct mapping. Also distinguish original legacy entries from later added brokers: some station records explicitly describe themselves as additions, so their current presence is not proof of original Flash provenance.

This changes ambient life, not player deployment. If thirty owned ships arrive at Paso, preserve and represent those thirty ships even though its normal traffic is sparse. Audit the current arrival path, which creates one live NPC per local fleet ship and escort. Test current-system concentrations as well as distant ownership. Optimize scheduling/rendering and off-screen work without silently imposing a battle-participation cap or removing defenses.

## 5. Upkeep and one financial book

### Required Flash source verification

Use the original BM1 Flash upkeep rules/rates. The current reviewed main.js has a fleet purchase-price helper, not an identified recurring upkeep charge. The available `data/fla_actions_index.json` contains 56 symbols of selected excerpts, including fleet purchase/order snippets; the focused search did not locate an upkeep formula. A manual lookup at vexxiang.com/bible.html did not return usable content. This does not prove Flash lacks upkeep.

**Status: exact Flash formula, charged inputs, and unpaid-upkeep behavior remain unverified.** Retrieve the original ActionScript/SWF/FLA or a trustworthy contemporary manual, record the version/source, and reproduce example charges before completing this part of implementation. Do not ship the previously suggested 0.1% placeholder or claim it is Flash behavior. If the original rate refers to legacy hull fields, document the mapping to the reviewed roster rather than blindly using new retail prices.

### Charged vessels

Charge fleet ships in every system, including captured prizes, whether locally instantiated or not. Exempt the current personal vessel. Command transfer changes which ship is exempt for future elapsed days; it does not erase accrued debt. A journey quote displays travel days and projected fleet upkeep, including why future construction completion may affect the actual total.

Captured ships enter the fleet and begin eligibility at capture. No upkeep for unclaimed NPCs. Sale/destruction ends future liability; old debt remains. No per-menu/per-frame billing. Settle once through calendar advancement, with stable event IDs and preserved rounding/remainder rules. Do not reset accrual through warp, reload, refitting, reassignment, or flagship changes.

### One book

Use a single balance/arrears mechanism with itemized entries: upkeep, rescue, payment, and any explicitly supported adjustment. Avoid a separate rescue-debt pool. Show amounts and reasons. Proposed first insolvency rule: unpaid bills remain visible and optional purchases/training are blocked until settled; no interest, automatic confiscation, or deletion of fleets. This restriction is a proposal, not a verified Flash rule. Reconcile it with the original evidence before acceptance. Keep emergency recovery available.

Repair and refit are separate paid services, not silently included in upkeep. Do not use debt to grant free repairs or equipment.

### Hull-scaled repair pricing — required change

The current `repairHull` charges 2 latinum per missing hull percentage point and 1 per missing shield percentage point. Thus hull-only repair from 10% to full costs 180 latinum regardless of hull class; shields are an additional charge. Retaining that flat basis does not support the intended damaged-prize economics.

Replace that hull-independent price with one authoritative repair quotation and transaction shared by player and fleet service paths. It must account for actual repaired fraction and an authored hull repair basis that scales with the vessel's canonical value/class. The exact coefficients and station modifiers are tuning, but changing the flat basis is a requirement of this increment, not an optional future note. A proposed model family is `cost = repairedFraction × hullRepairBasis × serviceModifier`, with paid parts/resources and minimum fees only if explicitly authored. Do not quietly bake an invented coefficient into defaults.

Player percentage fields and fleet absolute pools must produce the same quote for the same physical hull and condition. Apply partial repair only to the paid extent, retain fractional accounting safely, and never refill shields/equipment for free through a hull repair. Review shield restoration charges explicitly alongside this change. Command transfer must not open a cheaper legacy repair path.

Fixtures must compare shuttle, mid-size freighter, and capital hulls at equal damage fractions; they must also check full versus split repairs, inability to pay, capture stabilization with no hull repair, and damaged-sale versus paid-repair-then-sale proceeds. Paid repair is necessary but not sufficient evidence of balanced capture profit. Choose the repair and resale schedules together and report the resulting margins.

## 6. Disabled condition, capture readiness, and recovery

### Band and floor

The user requires an absolute floor in addition to the percentage threshold. **Proposed initial tuning for review** in canonical absolute hull units:

`disableThreshold = min(0.25 × maxHull, max(0.10 × maxHull, 32))`

Here 32 is the candidate floor; the 25% upper guard prevents very tiny/modded hulls becoming disabled almost undamaged. Both constants need catalog tests and are not claimed approved Flash values. For a hull maximum of 160, the candidate threshold is 32 (20%); for 1,800 it remains 180 (10%). Player hull percentages convert through that vessel's canonical maximum before this comparison.

The candidate 32-unit floor is intended to make band entry more forgiving for small hulls while leaving little or no margin for another default 33-damage phaser hit. If that subsequent shot deals 33 effective hull damage and the victim remains at 32 or less, it destroys the victim. However 32/33 is not a measured 97% success rate: fixed starting hull, shield absorption, scaled weapon damage, firing cadence, crew reaction and concurrent projectiles determine actual entry and overkill. Controlled-fire fixtures must include those paths, not assume a crew can react between any two impacts.

Test an alternative floor near 66 as well, but **test it together with the upper guard**. On a 160-unit hull, the present formula with a 66 floor yields only 40 because of the 25% guard; it cannot promise a 66-unit band or one-shot cushion. Even a 66-unit band only permits another 33-unit hit when actual remaining hull exceeds 33. Rafael approved adding a floor, not either numerical candidate. Compare 32 and 66 with explicit guard variants and record reliable entry, survival after committed follow-up shots, and how early small hulls become disabled. Do not silently raise the final constants on the strength of this review.

Apply existing damage rules first, including existing player-only per-hit caps, then classify the living target. A hit leaving hull at/below the threshold disables it; a hit reaching zero destroys it. No special damage clamp, invulnerability, or cancellation of paid shots. Band divided by damage is only a rough reliability estimate under varying starting offsets, not a universal probability for a deterministic loadout.

Disabled ships stop movement and firing, cannot initiate warp/cloak/jamming, and display small intermittent surface explosions and missing sections. End sustained attacks; already launched projectiles and independent damage clouds continue with existing credit. Proposed: shields collapse, emergency communications and funded sensors remain available. Disabled effects are cosmetic, bounded, and saved by a stable damage seed; they never cause periodic damage or aggression.

Make disablement a permanent sibling of temporary engine disruption, not a long fake timer. Disruptor expiry and stat initialization cannot revive it.

### Successful boarding stabilizes the prize

Rafael's decision overrides the old repair-to-20% condition for captured ships. Successful boarding restores fleet mobility, allowing the prize to jump with the fleet; it does **not** restore full hull, replace missing equipment, or remove repair cost.

Proposed representation: persist `condition: operational` with `prizeStabilized: true` after capture while retaining real low hull. Evaluate re-disablement on subsequent damage events, not continuously from a static threshold each frame; otherwise it would immediately re-disable. A fresh damaging hit can disable it again. Reload, rebuild, and travel preserve stabilization. Normal propulsion/energy requirements apply, but no artificial 20% repair gate prevents following the fleet. Restoration of other combat systems should follow this operational state and the actual installed equipment, with no free reload/refuel.

Other disabled owned vessels may use repair or rescue. Proposed non-capture recovery remains repair to 20% followed by a five-second restart; interruption and costs need review. A disabled player must have accessible transfer/rescue/load-save options, not a softlock. A captured ship's hull repair quote and resale quote use its actual damage, even though its emergency propulsion works.

### Unclaimed ships vacate on departure

Same-system save/reload restores a disabled unclaimed ship and any boarding operation. Ambient replacement must not overwrite it during the visit. On committed departure, retire the unclaimed disabled incarnation with no kill, reward, salvage, or capture. Returning may generate new traffic, but must not restore that prize.

Use the actual departure boundary and restoration hooks, including the top of `applySystemState` where appropriate. Pass explicit transition context so reload, station rebuild, or same-system refresh is not mistaken for departure. A denied warp does not retire anything.

A permanent retired-ship marker is unnecessary if all old participant/runtime restore paths are cleared at departure. Coordinate prize participants with security participants keyed by `securityInstanceId` and physical incarnation; restore one actor on reload and close/clear stale security restoration on departure. Preserve historical incidents without resurrecting a target. Owned captured vessels are never retired by this rule.

## 7. Controlled fire and boarding

### Engagement intent

**Attempt to disable** uses smaller commitments as observed hull weakens, holds weapons likely to overkill, and stops new fire on observed disablement. **Destroy ships** continues through disablement until the eligible target is destroyed. Neither setting overrides ROE, existing hostility, or explicit attack permissions.

Use the existing four crew profiles to vary reaction/estimation. Proposed intervals remain 1.0/0.7/0.4/0.2 seconds from lowest to highest skill. Decisions use observer-scoped hull assessments, visible disabled cues, and known own shots. Fleet-wide shot accounting requires actual authorized reports; no hidden global projectile census. Contact loss follows the sensor model. A cease-fire order never recalls already launched torpedoes or prevents overlapping volleys from destroying a prize.

### Launch, timing, and chance

Boarding is a separate explicit order with a confirmation warning. Proposed starting parameters:

| Parameter | Value/status |
|---|---|
| Range | 250 world units, proposed |
| Deployment / onboard phase | 3 / 12 active simulation seconds, proposed |
| Base chance | 40%, accepted for first tuning |
| Team contribution | +0.4 percentage points per XP, accepted for first tuning |
| Resistance | light +10; standard 0; hardened −15; exceptional −25 points |
| Clamp | 5–90%; current inputs actually yield 15–90% |
| Maxed team against exceptional | 55% |
| Success XP | +8, proposed |
| Completed surviving away mission XP | +3 once per unique completion, proposed |

Require an available team, operational source, valid disabled target incarnation, fresh positional track, range, and allowed capture policy. One operation per team/target at a time. Resistance is authored, not inferred from reactor strength or price. Assessed scans may disclose it; otherwise show an honest chance range, not hidden exact resistance.

Use a saved campaign ID, operation counter, target incarnation, algorithm version, and deterministic roll derived from a stable hash/seeded helper. No saved global RNG stream exists to assume. Persist the locked XP/resistance/roll and remaining phase time. Same saved state and same next operation must reproduce its outcome. UI actions and load cannot reroll it.

Before deployment, cancellation/range loss/source disablement/target recovery returns the team without XP. After deployment, the team is committed. Proposed rule: block warp, wormholes, and rescue relocation while either phase is pending, before any travel cost, calendar advance, or departure cleanup. The deployment phase can be explicitly cancelled; the onboard phase cannot. Local movement is allowed. This reconciles boarding with the user's departure rule; the warp guard itself remains proposed.

### Outcomes and capture policy

Success atomically converts the same physical target into an owned stabilized prize, preserving hull, cargo, loadout, equipment, energy, and identity, clearing incompatible old orders/sharing, and returning the surviving team. No ambient duplicate or fresh default equipment.

Failure scuttles once and loses the team. A third-party projectile destroying it during boarding retains its own attribution. Guard competing scuttle/damage events against duplicate death, rewards, XP, or penalties. No kill bounty automatically follows a capture.

Hostile capture incurs the equivalent destruction standing consequence through the same witness/evidence rules; record boarding aggression and one terminal capture/scuttle outcome without duplicate outcome penalties. Historical attacker/side evidence stays immutable. Add explicit capture contract support; do not silently satisfy kill-only contracts.

Add a validated `capture` policy to the existing hull catalog: allowed, forbidden, or authored unlock required. Ordinary capture does not require paying the vendor purchase price/standing gate. The Tactical Cube's future capture/plan content remains deferred, unavailable until deliberately authored. Do not generalize this exception to top-tier normal hulls requiring 100 standing.

## 8. Away teams and training

One captain-associated team initially, separate from the ship's engineering/combat crew. Transfer moves the captain's team; it does not overwrite the vessel's own crew.

Keep 50% pre-operation XP on team loss, rounded down, as institutional experience for replacements. Proposed prices remain 2,000 latinum to recruit and 1,000 for +5 XP training. Purchased training stops at 50 XP; field XP can reach 100. A lost maxed team leaves 50 XP that cannot be purchased back above the ceiling. No XP for cancelling, repeated completion, or a dead team.

Training is offered only by authored appropriate planets/universities/training facilities. Prices were explained but not explicitly confirmed by Rafael; keep them labelled proposed. Persist availability, roster, and event IDs so death, recruitment, training and mission completion charge/reward once.

## 9. Finite system markets and ship sales

### Stock

One shared ship-stock pool per system across personal, escort, and defense purchase routes. Different stations filter the available hulls by their services/faction, but share remaining quantity for the same hull.

Preserve the existing authoring path: `getShipyardStock` takes a nonempty `station.stockIds` list before its generic price-ranking branch, resolving aliases and applying existing catalog eligibility, exclusions, deduplication and display-size handling. Service capabilities are an additional filter on that authored result, not permission to replace it with a newly ranked catalog. Use generic ranking only when the existing fallback is genuinely intended. If all authored ships are filtered out, return no ship offering rather than falling back to unrelated hulls. An explicit no-ship service rule must also stop the generic fallback.

Keep mixed legacy stock decoding intact. Raw legacy entries of 106 and above map to weapon IDs by subtracting 105; explicit modern `stock.shipIds` and `stock.weaponIds` already have their own typed paths. Never apply that legacy numeric split to modern hull IDs, which may legitimately exceed 105. A defense station can retain its authored weapon offerings while showing no ships; its service filter must not erase the weapon stock. Add fixtures for mixed legacy input, modern high-number hull IDs, authored order/selection, and a filtered-to-empty station.

Finite quantities are applied after determining what a vendor is authorized to offer. Depletion does not change the authored list or trigger a generic replacement assortment. Build the system's authored hull set as the union of its planetary `shipStockIds` and the normalized ship offerings of every station actually assigned to that system. Resolve catalog aliases, deduplicate canonical hull IDs, and keep each contribution's source/vendor provenance. Shared quantity belongs to the canonical hull/system pair, not to a vendor page. A plan/ship/weapon ID must never enter this union through the wrong decoding path.

The union does not make every vendor sell every hull: each vendor still exposes only its own authored/fallback offerings, filtered by service capability and existing access/region rules. A secret broker's hull stays available through that broker, not through every planetary shop. The planet list may be empty while a station contributes real supply. Existing generic fallback rules must be identified separately and explicitly integrated where still intended; a fallback must not overwrite an authored list or create stock for a forbidden service.

Initial stock capacity and replenishment policy must start from these actual eligible offers. Author a positive initial capacity for each ordinary available offer (or an explicit sold-out/story exception). Use population/market/activity only as bounded modifiers, not as a multiplier that sets supply permanently to zero on a sparse or uninhabitable world. Scarce specialist stock can coexist with sparse traffic. Merchant capability, access, stock quantity, and traffic density are four separate concepts.

Show Out of stock rather than Fleet full. Purchases atomically validate access, money, stock, and ownership creation before debiting one unit.

Extend the saved `planetMarkets` pattern with versioned per-hull quantity, local maximum, due-day, event counter, seed, and stock profile. Existing trade-offer arrays must continue to load correctly. Current shipyard stock is selection/price eligibility, not a depleting quantity; quantity is genuinely new work.

Restock at randomized calendar-day intervals. Persist schedules; repeated visits and reloads cannot refill or reroll. Advance due events chronologically for long journeys using the existing deterministic day-keyed market pattern. Zero-day wormholes do nothing economic. Do not grant a free refill on conquest or a station rebuild. Market access and eligible replenishable hulls are still constrained by authored region/faction/mission policy.

### Selling ships — now in scope

Add a sale flow at eligible ship-buying facilities; the reviewed engine has no ship-resale path. Require the vessel's physical presence and ownership, no boarding/transfer/build transaction lock, and no live combat involving the vessel. Selling the current personal ship requires first taking command of another eligible ship; do not delete the only player vessel through a sale.

The quote itemizes damaged hull value, included installed/loose equipment, cargo disposition, fees if authored, and final proceeds. Use actual condition. A damaged captured hull is not valued as an intact 79,000-latinum retail ship, and repairs must be paid. However low repair prices can still permit profitable resale: test the combined repair/resale loop rather than assuming damage alone balances it.

Resale multiplier, condition curve, vendor buying rules and repair price adjustments remain proposed tuning. Derive the quote from one authoritative snapshot, confirm it, then atomically pay once, remove the owned vessel, release its formation membership, end future upkeep, and clear live references. Never duplicate included equipment into player storage. No automatic repair/restock laundering: a sold damaged ship must not silently become a pristine retail stock unit. Initial proposal: sales are a market sink; authored used-ship buyback can come later.

Keep the new sale system's scope explicit in economy fixtures: capture → sell damaged, capture → pay repair → sell, build → sell, equip/strip → sell, and attempted repeated confirmation/load replay.

## 10. Faction plans, station construction, and equipped delivery

### Plan price and standing — confirmed

Plan price is **4 × the authoritative catalog hull purchase price**, before market discounts, commission discounts, or damage depreciation. Never calculate it from the player's current damaged example or a resale quote.

One tier above hull purchase access, capped at 100 faction standing:

| Hull purchase tier/requirement | Plan requirement |
|---|---:|
| Open / 0 | 15 |
| Trusted / 15 | 30 |
| Respected / 30 | 50 |
| Military / 50 | 75 |
| Strategic / 75 | 100 |
| Top-tier / 100 | **100** |

The reviewed named tier table ends at strategic/75; some hull rules use an explicit 100 threshold. Handle that explicitly rather than looking up a nonexistent higher tier. For nonstandard overrides, derive the next threshold from the effective purchase requirement, capped at 100, and validate the authored result. Do not introduce planet-by-planet prestige or an extra top-tier approval requirement.

Example: a hull with canonical purchase price 79,000 has plans priced at 316,000. Its plan standing requirement depends on its purchase tier, not that price alone. Restricted/secret vendors remain authored; the Cube is deferred. Purchased plans are a reusable faction-issued license for the exact hull/variant, not a free product of capture or buying a ship.

Use `state.stationPlans` and its vendor/owned-filter pattern as the model for a separately typed ship-plan collection. Station IDs and hull-plan IDs must not collide. Persist purchases and filter Already owned. Proposed: ordinary license ownership survives later standing loss; future purchases remain gated. Plan purchase does not consume a retail ship-stock unit.

### Station services

| Facility | Intended role |
|---|---|
| Major starbase | Broad suitable ship sales, fleet service/refitting, authored ship construction capability |
| Shipyard | Ship sales and construction for its supported hull classes, refitting |
| Maintenance yard | Smaller ship sales and maintenance/refitting; construction only if explicitly equipped for it |
| Defense station/platform | No ship sales/construction; optional appropriate weapon vendor |
| University/research facility | Authored plans/training/scientific equipment; not automatically a general shipyard |

Apply faction/lore and hull-class capabilities per station rather than relying solely on substring matches. One system market still supplies their retail hull stock. Player construction is independent of retail stock and requires a licensed hull and capable owned station.

### Build orders

Reuse `playerBuiltStations`/`completeDueStationConstructions` persistence and due-day patterns for a typed ship-order queue, not a second station simulator. Construction uses **latinum and duranium**, already existing resources. Exact per-hull recipe and calendar duration require authored tuning. Show plan, station capability, recipe, due-day, and included loadout before committing resources.

Persist order ID, physical station identity, hull/plan version, committed inputs, progress/due-day, owner, and delivery status outside `systemStates`. Process calendar days in unloaded systems too. At completion create one persistent physical vessel with a new incarnation, and mark delivery in the same transaction. Upkeep begins only after delivery under the day-boundary convention.

No numerical ownership or arbitrary global queue cap. Station throughput/build time is a production constraint, not a limit on how many ships the player may own. Destruction loses unfinished builds and committed inputs. Loss of ownership pauses orders and retains them at the station for recapture; the enemy receives neither the player's plans nor auto-completed ships. While paused, remaining work does not advance even across a large travel-day jump. On recapture resume remaining work without recharging already committed inputs. Voluntary cancellation/refund policy remains to author.

### Delivered ships are equipped

New purchases for the player/fleet and newly constructed hulls receive the **authored base-game weapon slots and basic systems**, reflected in the quoted price/recipe. Preserve deliberate unarmed records. Never add a generic phaser to an empty authored slot. No free premium jammer, sensor upgrade, or cargo unless explicitly included in that hull's package.

Apply defaults once on creation only. Capture, re-entry, refit, command transfer, and save restoration never apply new-ship defaults over a customized loadout.

## 11. Fleet equipment customization

Add a Refit view for each owned vessel. Show all three weapon slots, onboard inventory, sensor suite, dedicated jammer slot and supported equipment, compatibility, current power/energy constraints, and costs. Allow paid purchase/install/remove/swap using existing equipment models instead of a separate fleet-only weapon database.

Proposed first service rule: purchases and external equipment transfers require the vessel at a suitable friendly/owned service station and out of combat. Existing freely adjustable power allocation remains available. Internal weapon-slot changes may reuse current locker rules, but must not bypass cooldowns or create ammunition/energy. Author station offerings and standing restrictions, including limited maintenance-yard services.

Each refit transaction has one inventory owner: removing a weapon places it in the displayed vessel/station inventory exactly once; installing consumes that item once. Transferring equipment between two co-located ships is an explicit transaction. No remote duplication into the personal locker. Show changes to funded power and available systems, without silently refueling or repairing.

Persist results in the physical vessel snapshot. Re-entry, switching flagships, taking personal command, and reloading preserve the refit. Upkeep uses the verified Flash rule; equipment affects it only if that rule or a separately approved adaptation says so.

## 12. Command transfer

Require an eligible operational owned destination in the same system, proposed range 250, no boarding operation or conflicting transaction. The source may be disabled to permit escape. Move captain identity, account/standing/permits and captain-associated team; leave hull, cargo, equipment, name, energy, cooldowns and ship crew with the physical vessel.

Player condition is percentage-based; NPC condition is absolute combat units. Before committing, snapshot both vessels and convert with each vessel's own effective maximum: absolute = percent / 100 × maximum, percent = absolute / maximum × 100. Zero-capacity shields map to zero. Round only for display; repeated transfers cannot heal through rounding.

Prepare both representations, then simultaneously remap old player → former personal vessel and destination NPC → new personal representation. Audit projectile target/source/exclusion bindings, `sensorKey`, HOJ incarnation/sample caches, cooldown keys, tractor and lingering-effect links, targeting, security participant references, and existing fleet IDs. Do not sequentially rewrite role strings so both ships collapse onto one identity.

A transfer is not a new physical incarnation. Already launched weapons follow their original physical targets in both directions; private seeker samples and their age do not refresh. Preserve historical attack attribution separately from live source-position lookup. No new sensor knowledge is granted from hostile/private snapshots.

Proposed damage policy remains the existing one: player-only hit caps apply to the player-controlled representation at impact. This can change protection after transfer, but never reroutes the shot or repairs condition. Uniform damage is a separate balance change. Tests must distinguish that policy from target identity conservation.

The former personal vessel becomes a fleet asset and starts future upkeep eligibility; the new personal vessel becomes exempt. Exactly two ships exist before/after, with one captain, no duplicated cargo or plan purchases. Commit atomically or make no change.

## 13. Implementation sequence and evidence

1. **Calendar and persistent physical state:** travel-day quote/advance, legacy schedule preservation, owned snapshots/restore, zero-hull guard, safe saved-state locations, current-visit prize lifecycle.
2. **Fleet management and finance:** remove ownership gates/UI, formations/flagships and group commands, verified Flash upkeep, one ledger, basic fleet roster.
3. **Condition and controlled fire:** floor tuning fixtures, disabled visuals, observable cease-fire behavior, stabilization/recovery distinctions.
4. **Ship economy and production:** shared stock, faction plans, station capabilities, duranium/latinum builds, equipped delivery, and condition-aware ship sales.
5. **Fleet refitting and command transfer:** inventory/physical conservation, role-reference mapping, upkeep exemption change.
6. **Boarding and teams:** deterministic phases, capture policy, stabilization, scuttle/XP/standing transactions, travel guard and complete playtest.

Grok implements and runs the model/live checks; Fable independently reviews a frozen delivery and may author measurement fixtures against the same catalog. Fixtures are repeatable scenarios, not additional gameplay: weapon-versus-hull disable outcomes and capture/repair/resale/upkeep economics. No claim of delegated work or completed tests is made by this proposal.

### Required acceptance matrix

| Area | Minimum evidence |
|---|---|
| Travel | One-, multi-, and zero-day transitions; quote/charged days agree; aborts and replays cannot double-advance |
| Economic scheduling | Long trip equals ordered daily processing; no idle/wormhole/offline progress; old station due-days preserved |
| Upkeep | Verified Flash examples; all distant fleet ships billed; personal exempt; capture/sale/transfer/build day boundaries correct |
| Ledger | One balance with itemized charges; no duplicate rescue debt; arrears and recovery behavior tested |
| Ownership/formation | More than 6 escorts and 8 local defense ships owned/restored; per-formation limit only; multiple flagships command one engagement |
| Traffic | All system profiles cite population/market/description/ship-list fields and explain conflicts; Earth/Paso differ without deleting station exceptions or owned ships |
| Disable floor | Small/mid/capital hulls; 32/66 candidates with upper-guard variants; real shot timing/damage and follow-up survival; zero never resurrects |
| Controlled fire | Four crew profiles, observed information only, overlapping volleys and already-paid projectiles remain dangerous |
| Boarding | Every save phase, deterministic retry, same-object replacement, target lock, duplicate confirmation, scuttle versus third-party damage |
| Stabilization | Successful low-hull prize follows fleet without free repair; reload preserves readiness; subsequent damage can re-disable |
| Departure | Unclaimed disabled NPC survives same-system load but vacates on departure; security restoration cannot resurrect it |
| XP/training | 50% retention, earned-XP ceiling behavior, one-time mission/course rewards and real prices shown |
| Standing | Capture equivalent to destruction using witnesses; no omniscient penalty, double outcome, or automatic kill bounty |
| Stock | Planet/station union and canonical deduplication; correct zero-based station mapping; vendor-specific access preserved; authored lists and typed IDs survive; last-unit and restock tests |
| Plans | Price exactly 4× canonical hull price; tier table including 100/100; no license from capture; Cube stays deferred |
| Builds | Real duranium/latinum debit; unloaded completion once; pause on station loss/recapture; destruction loses committed work |
| Repairs/sales | Hull-scaled quote shared by player/fleet paths; full/partial and transferred-hull pricing agree; damage-aware sale and repair-profit loops measured; no repeated payout |
| Refit | Compatible purchases and swaps conserve inventory; all customized slots/systems survive travel and transfer |
| Transfer | Hull-unit conversion both ways; incoming/outgoing HOJ and ordinary shots remain with physical ships; sensor/cooldown bindings audited |
| Regression/performance | Existing suites/builds; served playtest; large local fleets and distant accounting measured without changing accepted EW gates |

Served playtest: disable → cease fire → board → travel with damaged prize → pay repair/refit → transfer command or sell. Also demonstrate boarding failure, a zero-day wormhole, a long trip that completes a build/restocks a system, multiple formations in one battle, and capture/save/reload. Report actual counts and frozen hashes, not projected passes.

### Two-layer stock regression cases

- Verify X-Base maps to Paso (4/5), and Swiss Miss/Free Swiss Reserve Exchange/Independent Salvage Vault Alpha map to New Switzerland (5/6), using real parser inputs rather than hand-labelled fixtures.
- A planet-only seller, station-only seller, and system with both layers all initialize their intended shared stock. Include Paso's empty planet list with X-Base's two authored hull IDs.
- A hull listed by two vendors or aliased in a planet list consumes one shared last unit; deduplication does not multiply supply.
- Sparse/zero raw market fields do not erase explicitly authored offers. A vendor forbidden from ship service cannot expose the system union through a fallback.
- Shared stock does not bypass secret-vendor, standing, or region access; high modern ship IDs are not misdecoded as legacy weapons.

## 14. Remaining review decisions and research

This proposal is ready for review, with these specific unresolved values visible rather than invented:

1. Original Flash upkeep formula/rates and unpaid-bill behavior, including how legacy hull fields map to the reviewed roster.
2. Route-distance/speed conversion to travel days; visual transit time remains separate.
3. Disable floor and upper guard (32 units/25% proposed), and formation size (12 proposed).
4. Per-system stock quantities, random interval ranges and event batch sizes, plus all-system lore profiles.
5. Per-hull construction recipes/durations, station capabilities, voluntary cancellation refunds, repair-basis coefficients and resale curve (the hull-scaled repair change itself is required).
6. Team recruitment/training prices and remaining timing/recovery choices, where Rafael asked for explanation without explicitly accepting the numeric proposal.
7. Active-boarding travel guard and exact arrears restrictions, both proposed policies.

There is no unresolved top-tier plan rule: **four times hull price, 100 faction standing for the top tier**. There is no continuous economic clock, no player-vessel upkeep, no unlimited formation membership, no empty-weapon delivery blanket rule, and no post-capture repair threshold hiding elsewhere in this revision.

## 15. Source notes

- [Reviewed main.js](https://github.com/Artemis2028/BM1-remastered-work/blob/04abbfc7e1d28e5178ba353a781aaa9e53dcc4d9/src/main.js): calendar, fleet reconstruction, damage caps/normalization, station plans/builds, market drift, and integration hooks.
- [Purchase standing tiers](https://github.com/Artemis2028/BM1-remastered-work/blob/04abbfc7e1d28e5178ba353a781aaa9e53dcc4d9/src/ship-economy.mjs): named thresholds 0/15/30/50/75; explicit 100-tier policy is handled above.
- [BM planet descriptions](https://github.com/Artemis2028/BM1-remastered-work/blob/04abbfc7e1d28e5178ba353a781aaa9e53dcc4d9/data/planetData.json) and [station records](https://github.com/Artemis2028/BM1-remastered-work/blob/04abbfc7e1d28e5178ba353a781aaa9e53dcc4d9/data/stationData.json): activity interpretations and existing facility context.
- [Extracted Flash action index](https://github.com/Artemis2028/BM1-remastered-work/blob/04abbfc7e1d28e5178ba353a781aaa9e53dcc4d9/data/fla_actions_index.json): selected excerpts, not a full recovered Flash source or verified upkeep formula.
- Fable's v0.2/v0.4 structural/balance findings and Rafael's subsequent answers in this discussion. User decisions take priority over earlier draft proposals.

All changes require implementation review. Preserve existing tags/receipts and the separately accepted EW milestone. This proposal changes no repository branch and authorizes no merge.
