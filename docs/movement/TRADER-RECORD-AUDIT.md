# Trader record audit (ARCHITECTURE-CLEANUP §1)

DTG 031416ZOCT26 · stacked on 1f2da30.

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

## Debug

Cheats & Debug → **Trade records**:
- one row per trading vessel: vid, schema, stage, route and path, leg n/m with leg days, the leg in flight, trip, cargo/contracts, risk and ETA;
- the model's active doctrine deliveries, with their cargo and contract.

## Not done (deferred)

Fleet trade routes do not consult treaty terms. A trader's circuit is planned and flown without DMZ or inspection checks, because those apply to formations, journeys and the captain's own course. This is new in the carry-forward list.
