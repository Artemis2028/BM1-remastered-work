# Treaty authority audit (TREATY-EXPANSION)

This audit is stacked on d5b50b5. The rules are in `TREATY-EXPANSION.md`. For each system that could act against
a treaty term, it asks whether that system checks the treaty authority now, and how.

A term in force is one `termActive` reports active on the day in question. A term the actor knows is one
`termKnownTo` reports known: public terms are known to everyone, secret ones only to `knownTo`.

| # | system | checks treaty authority? | how / where | tests |
|---|---|---|---|---|
| 1 | **movement: model journeys** | **YES** | `plotJourney` (`world.treatyBook`) routes round systems barred to the polity's traffic class and refuses a destination inside one. `startJourney` checks a caller's plan: it re-plots it lawfully, or for doctrine refuses it. A mover in defiance (`treatyDefy`) is plotted without restriction, and each of its crossings is an incident. `settleCrossing` re-checks the rest of the route at every boundary. | pure 2, 3, 6, 24, R1; scenario DMZ-SETTLEMENT |
| 2 | **movement: planners** (operations, returns, repair runs, blockade forces, Dominion movement, withdrawals, recovery, evacuations) | **YES** (they all plot through `plotJourney`) | Military class by default. Recovery plots pass `cls: 'recovery'`; evacuation plans pass `cls: 'civilian'`. A planner never scores a route a treaty forbids. | pure 2, 5; measure (0 routes refused at start) |
| 3 | **movement: doctrine** | **YES** | `routeBetween` is treaty-aware for the job's class. `stepAssignment` stands a job down on a treaty refusal. `treatyStandDown` stands down a military job inside its own side's DMZ. `onForcedBack` stands down a job turned back under a treaty. | pure 3, 27; R2 |
| 4 | **movement: the captain's formations** | **YES** | `playerLawfulRoute` / `playerTreatyRouteRefusal` at dispatch. A boundary re-plot happens in `crossFormationLeg`. `runFormationTreaty` runs the same `treatyCrossing` at every system. `treaty defy` sends a formation through in defiance. | gate DMZ-SETTLEMENT, DMZ-WARNING-COMPLIANCE, TRANSIT-GUARANTEE, INSPECTION |
| 5 | **movement: the captain's own warp** | NO (unchanged) | The captain's personal course is not bound by DMZs this round. The DMZ binds fleets and stationing; his own ship is not a fleet in the model. Recorded as a gap. | — |
| 6 | **local security (border policy, doctrine enforcement)** | **YES**, for guarantees | `accessClassOf` classes a vessel the authority itself guaranteed, at that world, for its class, as `exempt`, whatever the relation. DMZ warnings at crossings require an observer who knows the term. Doctrine never acts on an unknown or secret term. | pure 6, 27, 28, R4 |
| 7 | **blockades** | **YES** | `startBlockade` refuses inside a DMZ binding the power, and where a `blockade_lift` clause applies. The AI planner skips such targets. `dmzDay` and `liftTreatyBlockades` close existing ones through `endBlockade`. `blockadeApplies` honours a guarantee for its class. A run ordered to obstruct anyway is a `transit_obstructed` breach (`resolveBlockadeRun`). | pure 25, 26, 28, R4, R5 |
| 8 | **repair / basing** | **YES** | AI: `advanceRepairs` gives the guest a share of the host's capacity at a basing yard, and the repair journey's `valid` accepts it. The captain: `fleetServiceAllowed(…, 'repair')`, `requireDocked('repair')`, `requireServiceConnection('resupply')`. Recovery: `towYardOk` and `recoveryYardAt` (purpose `recovery`). Only the named purposes, and only while the host holds the system. | pure 7, 8, 9; scenario TRANSIT-AND-BASING; gate BASING-REPAIR |
| 9 | **production** | **YES** (by not granting it) | Production uses only a polity's own yards. A basing term adds no yard or berth to the guest's account and queues nothing at the host. | pure 10 |
| 10 | **market access / sales / refits / stock** | **YES** (by not granting it) | `fleetServiceAllowed` with no named service (sales, refits, equipment) ignores basing. Vendor stock, licences, design records and station ownership are never touched by any term. | pure 9; gate BASING-REPAIR (`saleAllowed: false`) |
| 11 | **economy: tribute / reparations** | **YES** | `paymentDay` in `advanceTreaties` moves AI treasuries directly. The captain's money moves once, via the `treatyPayment` effect. Arrears are paid first; a miss is a breach; reparations end paid in full. | pure 15–19, R6; scenario TRIBUTE-REPARATIONS; gate TRIBUTE-REPARATIONS |
| 12 | **war / ceasefire / peace** | **YES**: terms never change them | Settlement terms are created only in `applyWarTransitionInModel`, and are not copied to inherited wars. A resumed war only suspends a settlement's terms. No treaty path calls a declaration. | pure 14, 17, 30; scenarios; measure (0 accidental wars) |
| 13 | **doctrine enforcement decisions** | **YES** | Execution only: no term is invented, a secret one is never assumed, there is no casus belli. | pure 27 |
| 14 | **reports / intelligence** | **YES** | Term, incident, inspection and payment reports reach the captain only if he may know them: a public term with a party he has contact with, a term he is party to, or `knownTo` / evidence. History is filtered by `historyVisibleTo` (`secretTerm`, `secret` / `knownTo`). | pure 21; gate SECRET-AND-DEBUG |
| 15 | **the Dominion pact** | unchanged | `book.treaties` is a separate record. Treaty terms neither read nor write it. | pure 31 |
| 16 | **save / load** | **YES** | All treaty state is plain JSON in the book. `upgradeCampaignBook` backfills it. A reloaded book steps to the same checksum. | pure 20; gate SAVE-LOAD |
| 17 | **the captain's mirror** | **YES** | `syncPlayerPolity` passes a formation leg's end (`legTo`), so a formation leaving the zone is not mistaken for one stationed in it. | gate DMZ-WARNING-COMPLIANCE (`stationing: 0`) |

## Gaps, recorded rather than invented

- **Row 5:** the captain's personal warp ignores DMZs.
- **Basing `staging` and `docking`:** recorded on the term, but no system reads them yet.
- **AI warships busy on another order inside a DMZ:** these are not ordered out until they are free. After the
  grace period they are stationing breaches. Doctrine jobs are stood down, so in practice this means operation or
  blockade hulls, and those are closed by the ceasefire or the blockade ban.
