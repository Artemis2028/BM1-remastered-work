# Trader record audit (ARCHITECTURE-CLEANUP §1)

DTG 031416ZOCT26 · stacked on 1f2da30. Updated 031713ZOCT26 for ARCHITECTURE-CLEANUP-FINAL (stacked on 79bc258): the record now meets the treaties.

This round consolidated the record's data model only. Journey movement was not rewritten: every leg below still moves the way it did on 1f2da30.

## The canonical shape: `trade/1`

A trading vessel's work lives on the vessel itself, in `f.trade`. `ensureFleetTradeState` normalises it in two places, whenever it is used and at the end of every `loadGame`, so a saved record and a live one cannot differ.

| field | meaning |
|---|---|
| `schema` | `'trade/1'` |
| `vid` | the vessel's persistent strategic identity, the same `vid` used everywhere else (`ensureFleetVesselIdentity`) |
| `origin`, `destination` | where the circuit began and its last stop. The destination is *derived* from `stops` while outbound, so the two can never disagree. |
| `stops`, `path`, `legDays`, `legIndex` | the route and the current leg |
| `crossed` | the systems actually crossed and rolled on this circuit |
| `tripId` | the circuit's identity (`origin:destination:day`) |
| `manifest` | cargo and contracts. Each line keeps its `jobId` (the contract) and `goods`/`tons`. |
| `risk` | risk posture (`safe` … `any`) |
| `stage`, `active`, `order`, `repositioning` | circuit / holding / passage state, and the captain's passage order |
| `paid`, `revenue`, `etaDay`, `legEtaDay`, `note` | money, ETA and the last event |
| `treatyHold` | FINAL: `{ at, since, system, to }` while she holds for want of a lawful way on; otherwise null |
| `treatyReroutes` | FINAL: how many times her route was re-plotted round a treaty |
| `lastInspection` | FINAL: `{ id, state, at, day, tripId }`, the last inspection she met (the record itself is in the campaign book's `treatyInspections`) |

**The leg in flight** is `f.transit = { from, to, arrivalDay, kind: 'trade', tripId, leg }`. It now names its trip and leg, just as a formation member's leg names its travel. On 1f2da30 the leg was untagged.

**Cargo as an inspection reads it** comes from `tradeCargoLines(manifest)`, which gives `{ cargoId, quantity, contractId?, concealed }`. This is the one shape a treaty inspection reads, whoever is carrying the cargo.

## Every record shape found

| # | shape | where | classification | notes |
|---|---|---|---|---|
| T1 | captain's fleet trader: `f.trade` + `f.transit` | main.js `ensureFleetTradeState`, `beginFleetTradeCircuit`, `scheduleFleetTradeLeg`, `crossFleetTradeSystem` | **canonical** | Gained `schema`, `vid` and `repositioning`. The destination is derived from the stops. The leg is tagged `kind/tripId/leg`. Normalised on load. |
| T2 | passage orders (recall / rendezvous / hold): `f.trade.order` with `stage: 'passage'` | `orderFleetPassage`, `normalizeFleetPassageOrder` | **adapted** | Lives inside the canonical record, not beside it. Unchanged except for the normalisation it now shares. |
| T3 | formation travel carrying trade cargo: `formation.travel` | `runFormationTreaty` | **adapted** | A formation's travel stays the formation's record (FORMATION-ROUTE rules). Its members' cargo is read through `tradeCargoLines` from their own `trade/1` records, so nothing is duplicated. |
| T4 | doctrine / Ferengi delivery: `book.doctrine.assignments[kind:'delivery'].cargo.manifest` with a `doctrine` journey | doctrine-campaign.mjs `issueDelivery`, kind hooks | **intentionally separate** (adapted at the boundary) | This is an AI model job, not a captain's vessel. It keeps its own assignment record. **Defect fixed:** the doctrine journey kind had no `cargo` hook, so every treaty inspection saw an empty hold. The hook now returns the manifest in the canonical cargo-line shape (pure DELIVERY-CARGO). |
| T5 | world job postings: `state.worldJobs[i].jobs[]` | `worldJobPool`, `buildWorldJob`, `normalizeWorldJob` | **adapted** | **Defect fixed:** a reload ran postings through `normalizeContract`, which dropped `courier`, `createdDay` and `hazards`, and re-dated every posting to the reload day. `normalizeWorldJob` keeps all three (in-game CG-9). |
| T6 | the captain's own contracts: `state.openContracts` / `activeContract` | `normalizeContract` | **intentionally separate** | This is the captain's personal hold, not a vessel's trade record. When a contract job is put on a trader, its identity travels as `manifest[].jobId`. |
| T7 | evacuation convoy: `book.evacuations[]` with `evacuation` journeys | campaign-strategy.mjs | **intentionally separate** | It moves people, not cargo, as civilian traffic under the EVACUATION-BLOCKADE rules. There are no cargo lines to consolidate. |
| T8 | AI economy trade | campaign-strategy.mjs revenue | **intentionally separate** | The AI's trade is abstract revenue. It has no per-vessel record, and the model has no `trade` journey kind. |
| T9 | single-run planner `planFleetTradeRun` / `beginFleetTradeLeg` | (pre-circuit builds) | **removed** (before this round) | Not present in 1f2da30. The names stay in the probe harness, which binds each name tolerantly, so older trees still load. |
| T10 | untagged trade leg `f.transit = { from, to, arrivalDay }` | 1f2da30 | **removed** (replaced) | Every new leg is tagged. On a pre-round save, an untagged leg in flight still arrives, because completion keys on `arrivalDay`. The next leg it books is tagged. |

## What is preserved (checked)

- **Persistent vid:** the same `vid` throughout a circuit, across save/load and across a blockade run (in-game CG-10, pure R32).
- **Route, current leg, origin/destination:** the record is byte-identical across save/load mid-leg (CG-10 `same`).
- **Cargo/contract identity:** `manifest[].jobId` is kept and shown as `contractId` in the cargo lines and in the debug view.
- **Risk posture:** unchanged (`risk`).
- **Blockade behaviour:** the trader runs a blockade ahead of her through the same engine (`resolveBlockadeRun`), under her key `id:tripId:leg`. CG-10 recorded a `trade` run that "slipped through" at Lik Prime.
- **Arrival/completion:** the circuit completes and the next one starts with a new `tripId` on the same record (CG-10).
- **No legacy duplicate:** one fleet entry, and no `tradeRun`/`tradeRoute`/`cargoRun`/`route` keys beside the record (CG-10).

## Treaties (ARCHITECTURE-CLEANUP-FINAL §2)

There is no trader-specific engine. The trader meets the same three things every other mover does.

**Her class.** `shipTrafficClass(shipId, vessel)` is the same rule the captain's own course uses:
- a freighter or cargo shuttle with **no combat weapon fitted** is **civilian**;
- any armed ship — a military freighter included, whatever its name says — is **military**.

The weapons are counted. The name-scaled combat value could not tell an armed "Freighter" from an unarmed one. Her mirror hull in the model (`pf:<id>`) carries the class, so a civilian freighter standing in a DMZ is not counted as a stationed warship (pure CIVILIAN-HULL-CLASS). A hull on a strategic operation keeps the operation's class instead.

**Lawful routes.** Every route the trade planner takes goes through `fleetTradeRoute(f, a, b)`, which is `playerLawfulRoute` for her class. That function is `Campaign.treatyBarred`, less the transit guarantees that cover *her party, her class and that system*. This covers:
- the circuit's legs and the planner's day estimates;
- the risk check (`plannedRouteRisk`);
- re-positioning;
- passage orders.

With no treaty in force, it is exactly `getPlottedRoute`, and trading is unchanged.

**The crossing.** Each system she reaches is crossed in a fixed order:
1. the trade risk roll;
2. a blockade, run through `resolveBlockadeRun`, once, under her key (unchanged);
3. then, unless she was stopped or turned back, `Campaign.treatyCrossing` with:
   - her class;
   - her canonical cargo lines (`tradeCargoLines(manifest)`, with `contractId` on contract lines);
   - her vid, her hull category and whether anyone aboard can receive.

An inspection regime there asks her once per trip per system. She complies. The inspection sees only what the regime reveals, and **a concealed line is never seen**. The contract identities stay on her record.

**At each boundary** (`fleetTradeTreatyBoundary`), before the next leg is booked, she checks whether the rest of her route is still lawful under the terms in force now:
- **Still lawful:** she goes on.
- **Blocked** (a DMZ began, a guarantee ended): the rest is re-plotted lawfully to the same calls. For a circuit, the new route must also fit her **risk setting**.
- **No lawful (or acceptable) way on:** she **holds where she is**. The record, trip, cargo and contracts are kept, and nothing is cancelled.

While she holds:
- the way on is tried again each day;
- an order given meanwhile is flown as an ordinary passage;
- if she is disabled where she holds, she books nothing;
- a passage cut short during the hold ends where she is.

She never teleports and never flies through a zone that bars her.

| brief test | check | 79bc258 |
|---|---|---|
| 1 civilian crosses a civilian-permitted DMZ | in-game T-1 | passes (preservation) |
| 2 military freighter refused/rerouted | T-2 (re-plotted at Orion round Lik Prime to Proxima Yard; trip, vid, cargo unchanged) | **fails**: flew through |
| 3 applicable guarantee lets her through · 4 unrelated guarantee does not | T-3/4 | **fails** on 4 |
| 5 inspected · 6 canonical manifest · 7 concealed stays hidden | T-5/6/7 (three declared lines seen; the concealed spice not) | **fails**: never inspected |
| 8 same vid / trade/1 / tripId | T-2, T-8/9 | — |
| 9 save/load while held | T-8/9 (held at Orion; byte-identical across reload; one entry; she completes the same circuit once the DMZ ends) | **fails**: never held |
| 10 blockade + treaty: resolver once | T-10/11 | passes |
| 11 no legacy duplicate | T-8/9, T-10/11, long run | passes |
| hold edge cases (disabled, order during hold) | T-12 | **fails**: never held |

Long run (`measure:cleanup:final`, 240 days): four traders (two unarmed, two armed) trading freely from Earth under a DMZ at Lik Prime, an inspection regime at Orion, and a second DMZ that begins and ends mid-run:
- 5 inspections, all completed;
- 0 days with an armed trader standing in a barred DMZ;
- no vid change, no duplicate, no legacy record;
- trading still profitable.

## Debug

Cheats & Debug → **Trade records**:
- one row per trading vessel: vid, schema, stage, route and path, leg n/m with leg days, the leg in flight, trip, cargo/contracts, risk, ETA, and (FINAL) **Treaty**: her class, a hold (where, to what, blocked at, since), the re-plots and the last inspection;
- the model's active doctrine deliveries, with their cargo and contract.

## Not done (deferred)

- **Fleet traders under treaty:** done in ARCHITECTURE-CLEANUP-FINAL (above).
- **A military trader caught inside a zone:** if a DMZ begins mid-leg and her next call has no lawful route, she holds in place rather than first leaving the zone. Her stationing grace then runs as for any warship there. This is carried forward.
- **Passage order notes:** `fleetPassageRouteNote` still describes the chart route, not the lawful one. This is cosmetic.
