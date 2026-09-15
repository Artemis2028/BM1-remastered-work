# BM1 campaign war, markets and station roles — proposal

15 September 2026. Based on the actual catalog: 36 station types, 269 placements. All numbers below are initial tuning proposals, not measured balance. Only the protection against random Terran–Klingon peace is implemented in this candidate. Economy, production, strategic readiness, campaign invasion, stock rotation, recovery contracts and the station service changes described here need implementation.

## The campaign spine

Earth and the Klingons begin in a sustained war. Stalemate means the front has stopped moving; it does not mean peace. Other powers may join, withdraw or negotiate separately. The central war can end through a strategic settlement or conquest, rather than the ordinary calendar's random war-exhaustion roll. Dominion arrival does not automatically end it or force the existing factions into an alliance.

Give the Klingons more ready combat power at the start and Earth more replacement capacity. A starting ratio around 1.2–1.3 Klingon ready strength to 1.0 Terran strength is worth testing, with Terran production around 1.2 times Klingon production. This produces pressure without scripting which worlds must fall. Those ratios must come from actual hulls, facilities and resources; avoid invisible combat bonuses.

Track three quantities separately:

| Measure | What contributes | What the player can change |
| --- | --- | --- |
| Economic capacity | Treasury, recurring tax/trade revenue, mined materials, imports and upkeep burden | Deliver cargo, protect trade, raid convoys, repair mines, relieve blockades |
| Production capacity | Operational yard berths, industrial workforce, feedstock and energy | Rescue engineers, supply yards, rebuild facilities, capture industry |
| Ready military strength | Surviving hulls, weapons, condition, trained crews, fuel and supply access | Win fights, repair ships, escort replacements, cut supply, rescue crews |

Do not reduce these to one victory score. A rich faction with wrecked yards cannot replace a fleet; a large fleet with no fuel cannot exploit a victory. Display our faction's known values and estimates/ranges for others. Readiness is derived from real vessels; production queues consume real resources and produce those vessels once.

Suggested bookkeeping: operating income minus upkeep changes treasury; mines/imports change material stocks; each yard advances work by its berth capacity multiplied by condition, workforce availability and supply factor. A completed order deducts reserved inputs once and creates a persistent hull. Repair ties up capacity that could otherwise build replacements. Refugees and damaged housing affect workforce gradually, not as instantaneous population switches.

## Six possible campaign stories

| Scenario | Conditions | Events and player choices |
| --- | --- | --- |
| Klingon advance, Terran line holds | Klingons take border worlds; surviving Terran yards replace enough losses to deny Earth | Escort material shipments or raid the Klingon repair chain. Both sides grind down; scouts and missing convoys foreshadow Dominion intervention. |
| Terran industrial recovery | Earth protects heavy yards and supply while Klingon losses outpace repairs | A Terran counteroffensive threatens Qonos as an independent Dominion invasion opens another front. The Klingons fight for their own survival; Earth must decide how much force to divert from its offensive. The player can back any contender or pursue separate goals. |
| Victory leaves a hollow empire | One side wins territory but loses crews, treasury and supply depth | New possessions revolt or require garrisons. Dominion forces strike a newly stretched corridor. Conquest matters, but is not instant economic integration. |
| The brokers' war | Ferengi supply both sides; a third faction's entry changes the balance | Contract profits rise, embargoes split routes, allies make demands. Romulans can intervene after sufficient tension or a deliberate diplomatic plot, then negotiate their own exit. |
| Communications blackout | A chain of relays is captured or destroyed during a major offensive | Orders arrive late; fleets execute standing instructions. Rescue a courier, rebuild a relay or investigate a forged stand-down message before a real Dominion incursion. |
| Player breaks the expected cycle | The player preserves both sides' strength, exposes infiltration or forces a credible settlement | The Dominion still invades, but meets stronger, better prepared opponents. Its staging and attack axis can adapt to the actual front. Do not manufacture losses to force a collapse; preparation should pay off. |

The normal route is the first scenario, with the others emerging from the same state. A faction can win a battle while its campaign position deteriorates.

Suggested resolution gates: a sustained and supplied advantage, decisive objectives held long enough to matter, and political willingness. Test a 1.7:1 ready-strength advantage held for 20 days with a major industrial/capital objective; treat this as an offer/decision threshold, not an automatic surrender. Mutual exhaustion plus a verified outside threat can make a negotiated ceasefire attractive, but neither a ceasefire nor a coalition is compulsory. A frozen front alone never ends the war.

## Dominion intervention with warning and agency

Use phases: dormant → reconnaissance/infiltration → staging → intervention. Keep the hidden core hidden until its existing discovery rule permits disclosure. Naming the Dominion in a rumor is not discovery or activation.

The invasion is the campaign transition, not an optional protection offer. Use a scheduled staging window and actual reachable invasion routes. Terran/Klingon losses, production damage and supply disruption affect the Dominion's opportunity, target selection and likely success; low combined readiness must not be a mandatory trigger that lets a strong player prevent the campaign transition indefinitely. Timing still needs tuning against travel and production rates. If the player disrupts one staging route, the Dominion must rebuild or find another real route rather than teleport an invasion force.

There must be at least two actionable warnings before the first major assault: missing patrols, unexplained supply purchases, unfamiliar warship signatures or a colony requesting help. Subsequent stages require resources, routes and actual staging fleets. The Dominion cannot spawn arbitrary ships beside an unreachable world. Destroying its staging logistics reduces or delays the invasion. Rumors remain fallible; campaign triggers read actual persistent events, not generated report text.

Special events can deliberately raise tensions with any faction. An allegation alone has no automatic diplomatic effect; a separate political reaction must be authored and recorded. This retains the reviewed distinction between intelligence text and simulated reality. Star Trek's use of deception to draw the Romulans into war provides a useful story reference; our triggers and mechanics would be original BM1 design. [StarTrek.com on In the Pale Moonlight](https://www.startrek.com/news/this-classic-ds9-episode-tackles-the-finer-points-of-morality).

## After arrival: an open war

The Dominion enters as an independent belligerent with a powerful, finite expedition. Klingon Houses do not accept Dominion protection as the setup for its entry. There is no scripted Dominion victory, compulsory Terran–Klingon alliance or chosen player side.

Any active faction can win through surviving forces, economic resources, production and captured territory. The Dominion can exploit the exhausted powers and conquer them, lose its expedition to determined resistance, or become one of several enduring contenders. Other belligerents can join or leave wars according to their interests. A victorious pre-invasion faction faces the Dominion with the strength it actually preserved.

The player can serve the Dominion, fight it, remain loyal to another faction, change allegiance, trade across the conflict or build an independent power. The campaign does not assign a side or require participation in a final battle. Existing access, reputation and ownership consequences still apply to the player's actions; choosing a side never grants ownership of all its worlds.

Invasion arrival and each major capture change the strategic situation, not the rules of combat or production. Do not create replacement fleets solely to rescue a preferred story outcome. Strategic victory should be recognized from control and the ability to sustain opposition; let the player continue afterward if they want. Exact victory thresholds remain a design task.

## Planets changing hands

Use the existing ownership transfer and capture/reclaim protections. Strategic AI should choose reachable objectives, commit real forces, defeat the defending force and hold the objective through a capture period. Abstract offscreen combat must reconcile with exactly those forces when the player enters. Never simulate a second offscreen fight alongside a loaded battle.

Distinguish controller, original culture and individual station owner. Capturing a Cardassian world gives access to its surviving industry; it does not make every local facility Terran-owned or erase private concessions. Damaged yards need repairs, workers and secure supply before contributing. A contested world starts at reduced output; peaceful integration is faster than repeated occupation. Populations need housing and relief as well as garrisons.

## Rotating stock without faction soup

Keep each vendor's currently eligible catalog as its base pool. On a saved calendar schedule, choose a changing subset of that pool. Initial tuning: every 10 campaign days, staggered by vendor, with 3–5 available designs and limited quantities. Opening a menu, saving, loading or making a short jump must not reroll stock. If a pool has fewer designs than slots, all may remain available while quantities change.

Earth's ordinary market remains Terran and its already authorized independent designs. Cardassian designs can be added only after Earth's controller holds a Cardassian-origin world with a surviving/recovered production license and a secure supply link. Being allied to Cardassia, owning a lone captured ship or hearing a rumor is insufficient. Private concessions keep their own provenance; a foreign-owned vendor on Earth is distinguishable from Earth's planetary stock.

Purchases reduce quantity immediately; production and replenishment fill it on calendar ticks. Stable prices and existing purchase eligibility/standing gates should stay until separately balanced. Keep a catalog/commission option so rare designs are discoverable even when temporarily out of stock. Advertise the next resupply estimate if known. Previously accepted cargo contracts keep their prices.

Represent provenance explicitly: vendor id, native pool, temporary captured-industry additions, eligible license ids, last replenishment cycle, next due day and remaining quantities. The transaction must recheck quantity, control, access and range, not trust a rendered button. Bound records by existing vendors/designs, and seed migration once from current campaign state.

## Destroyed stations must not erase a ship design forever

A design license is a durable registry entry distinct from physical stock and individual hulls. Losing its sole vendor creates a recovery path, with costs and time:

1. Surviving engineers relocate to a compatible friendly yard. A rescue/escort mission speeds this up.
2. Recover the archive from the wreck or a data courier; then fund retooling at a suitable yard.
3. If all original sites are gone, a neutral broker offers a lead to a surviving archive. This remains a bounded campaign contract, not an infinite respawn loop.

Make the fallback visible in the catalog: “Original yard lost — locate engineering archive.” Ship ownership is unchanged, and buying the recovered design still costs money and obeys eligibility. Heavy designs require heavy berths. Secret, dormant, prototype and authored discovery gates survive relocation. In particular, Gorn survivors are not unlocked by a random allegation or an ordinary stock refresh. An already known legal design always has at least one recoverable route; the fallback must not teleport free hulls or reveal undiscovered worlds.

## Stations as places with distinct jobs

Replace service inference from names/models with explicit role and service data. A station's visual hull describes its appearance; a named installation can have a different function. The accompanying STATION-ROLE-AUDIT.csv maps all 269 placements, retains their authored stock ids and flags proposed exceptions. Those flags are design proposals, not data changes in this patch.

The tables below are proposed gameplay roles, grounded in the existing station descriptions. They are not claims that every mechanic is Star Trek canon. Shared rule: ships are sold through real shipyards, licensed depots or explicitly authored private lots; a relay, defense platform or residential habitat has no generic ship shop.

| ID / existing type | Proposed role and services | Why its survival matters / mission |
| --- | --- | --- |
| 70 Human Starbase | Fleet headquarters, full repairs, licensed reserve sales and stores | Supports local readiness and defense; relief a besieged base |
| 71 Human Research Lab | Weapon development, analysis and prototype trials; no general hull sales | Rescue researchers and recover archives after attack |
| 72 Vulcan University | Officer/scientist education, training, analysis and mediation | Preserve skilled crews; evacuate students; licensed surplus annex is a named exception |
| 73 Human Heavy Shipyard | Capital construction, heavy overhaul, reserve commissions | Losing a berth reduces replacement capacity; escort reactor components |
| 74 Human Shipyard | Small/medium hull construction and refits | Replenishes patrols and escorts; provide hull plating |
| 75 Trade Station | Freight brokerage, commodities, warehousing and authorized civilian lots | Generates trade revenue and supplies; break a blockade |
| 76 Bar | Crew leave, recruitment, paid rumors and underworld contacts; no normal hull shop | Recover morale or find a smuggling lead; rumors remain uncertain |
| 77 Delpin Waterpark | Tourism, recreation, refugee respite and civilian passenger contracts | Supports revenue and morale; rescue stranded visitors |
| 78 Ore Station | Extract/refine minerals when local deposits exist; sell feedstock | Supplies yards; repair drills or escort ore convoys |
| 79 Klingon Starbase | House fleet seat, warship support and licensed reserve sales | Maintains territorial defense; relieve a besieged House |
| 80 Klingon Shipyard | Birds-of-Prey and other small/medium warship work | Replaces raiders; recover experienced engineers |
| 81 Klingon Heavy Shipyard | Heavy warships, major repairs and House reserve commissions | Controls heavy replacement throughput; protect a keel under construction |
| 82 Dyson Sphere | Exceptional habitat, energy/industry and an authored megaproject | Large finite output with upkeep and staged repair; never literally unlimited strength |
| 83 Maintenance Station | Discount repairs, salvage refits, towing and explicitly licensed used small hulls | Gets damaged fleets back into service; recover a disabled ship |
| 84 Habitat Station | Housing, workforce, refugees and passenger logistics; no hull shop | Population capacity limits recovery; evacuation and relief missions |
| 85 Wormhole Generator | Regulated transit, navigation research and gate maintenance | Strategic route with energy demand and disruption risk; stabilize the aperture |
| 86 Defense Platform | Local beam defense and checkpoint fire support; no commerce | Protects approach routes; resupply/repair under pressure |
| 87 Advanced Defense Platform | Heavy torpedoes and layered defense; no commerce | Defends key yards; intercept attackers before its magazines run low |
| 88 Cardassian Starbase | Sector administration, defense and the catalog's established Galor/Keldon construction | Occupation and industry hub; sabotage or capture intact facilities |
| 89 Subspace Comm | Sector fleet command relay; orders, distress and intelligence subscriptions only | Cut or restore command links; no hulls, weapons or commodity shop |
| 90 Romulan Starbase | Concealed fleet support, intelligence, repairs and authorized reserves | Local defense and covert logistics; intelligence recovery missions |
| 106 Tholian Starbase | Web-defense citadel and protected trade anchorage | Shields a route/yard network; rescue ships caught near a damaged lattice |
| 107 Tholian Light Shipyard | Small lattice hulls and commercial transport construction | Sustains trade and light patrols; supply fabrication material |
| 108 Tholian Heavy Shipyard | Heavy cargo and combat lattice frames | Industrial backbone; defend a major construction berth |
| 109 Dominion Starbase | Military command, supply distribution and occupation administration | Invasion coordination; destroying it disrupts an actual deployed force |
| 110 Dominion Shipyard | Jem'Hadar/light hull assembly with crew/supply dependencies | Replacement rate depends on maintained logistics; intercept supplies |
| 111 Dominion Heavy Shipyard | Capital warship construction and heavy refit | Limits the scale of sustained intervention; sabotage a staging yard |
| 112 Breen Station | Cryogenic support, listening post and electronic warfare refit | Specialized crew/hull support; recover a captured signal package |
| 113 Tholian Research Station | Web/shield research, analysis and specialist refits | Unlocks research through real work; escort an experimental module |
| 119 Casino Station | Gambling, intelligence brokers, financing and passenger contracts | Revenue and influence; a named private lot may sell its existing authorized hulls |
| 200 Command Outpost | Frontier command, convoy routing and local fleet logistics | Maintains a small forward deployment; defend the courier route |
| 201 Communication Array | Regional relay, navigation updates and contract messages | Overlaps relay coverage and improves report timeliness; no generic weapons shop |
| 202 Heavy Starbase | Sector fortress, capital repairs and fleet stores | Keeps a major front supplied; sustained siege/relief operations |
| 203 K Series Station | Modular frontier yard, patrol refit and small construction | Low-cost expansion support; deliver modules to commission a berth |
| 204 T19 Station | Cargo terminal, transshipment, customs and convoy assembly | Trade/supply throughput; clear a backed-up convoy queue |
| 205 Biodome Station | Food, agriculture, refugees and biological research | Food/workforce resilience; outbreak response and crop delivery |

## Make the communicator worth protecting

Ships retain onboard short-range communication. A relay provides authenticated subspace routing, message storage and synchronization across systems. This gives a reason to need infrastructure without making a lost relay delete the fleet menu.

Connected: issue distant fleet orders immediately; receive timely acknowledgements; request task-group support; prioritize personal reports. Disconnected: queue new orders with an ETA/connection explanation; fleets continue their last acknowledged orders and standing doctrine. Couriers or another relay can restore communication. Local orders and immediate defense always work. Relays do not create omniscience or remove the six-background-report cap.

There are two sector arrays in the data, Alpha Array and Qonos Array (type 89). Swiss Relay Array is type 201 and currently carries weapons 23 and 24. Before removing its market, relocate those authored offers to a suitable existing vendor and retain their access conditions. This is why a global “delete all non-yard stock” change would be premature.

Useful missions: escort replacement relay cores; verify a corrupted order; restore a sabotaged link; route a refugee distress call; capture an enemy relay to learn dated routing information; evacuate code custodians before capture. Intelligence interception gives bounded, sometimes stale observations, not the enemy's full state.

## Named exceptions and lore cleanup

- Vortara cloning Facility uses a trade-station model and offers ship 345. Treat it as personnel/clone logistics with a specifically documented attached transport depot, or relocate that offer. Do not invent a generic market inside a cloning plant.
- Kpec Prison: detention and prisoner exchange, with rescue/extraction missions. Its habitat model does not imply ordinary residential benefits.
- VSU Dorms: university-linked housing and training capacity. Losing either dorms or the university reduces throughput; their bonuses must not duplicate one another.
- Vulcan Surplus Annex: a licensed depot attached to education infrastructure, preserving its authored hull pool.
- Imperial Mothball Vaults, House/Obsidian/Cryo/Lattice reserves and independent salvage vaults: decommissioned inventories and design archives. These are the main special-design recovery sources, with costly recommissioning instead of arbitrary rarity rerolls.
- Gorn Muster Dock and Gorn Hegemony Clutch Yard: attach the existing dormant/discovery requirement to services, stock and any recovery contract. Neither proves a living Gorn population before the discovery event.
- Silent Collective Reclamation Node: a derelict/salvage expedition until an authored activation. Do not apply Dyson habitat population bonuses to it by model alone.
- Sites marked abandoned: exploration, restoration and salvage; normal services stay offline until rebuilt and staffed. Existing access/discovery restrictions must remain.
- Son'a Private Hangar, Nausican Chop Shop, Hirogen Trophy Exchange/Dock and Suliban Cell Dock/Cabal Slip: explicit specialist depots retaining catalog provenance, with distinct salvage, hunting or covert contracts.

## Implementation order and acceptance

1. Adopt explicit station roles/services and audit current offers; migrate every affected special item before closing inappropriate shops.
2. Add saved stock rotation/quantities inside existing pools, with transaction checks and a permanent catalog/commission path.
3. Add the three strategic books and resource-consuming production; reconcile offscreen and local vessels by persistent id.
4. Add reachable objectives, occupation and supply, then strategic settlements and the Dominion phase controller.
5. Add station missions and archive recovery using one bounded contract per lost license/source event.

Required checks: menu/save/jump reads cannot reroll; every currently obtainable design stays obtainable under its existing gates; Earth gains no unauthorized Cardassian stock; loss/reclaim never changes foreign/private owners; days advanced daily, in chunks and once produce identical books; no double-produced hull or double-resolved battle; no unknown-location report leak; connected/disconnected fleet orders acknowledge once; losing a relay never resets standing orders; central-war settlement only follows explicit campaign/debug action; intervention staging obeys discovery and reach; invasion arrival neither forces an alliance nor assigns the player a faction; a prepared faction can defeat the Dominion without a scripted reversal; player support for any active side remains available.

The immediate reports/cargo candidate deliberately leaves these proposed systems out of runtime. That keeps the next implementation tied to reviewed gameplay decisions rather than silently inventing an economic campaign.
