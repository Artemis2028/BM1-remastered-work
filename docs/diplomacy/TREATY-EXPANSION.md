# Treaty expansion: DMZs, inspections, tribute, reparations, basing rights, transit guarantees

This round is stacked on d5b50b5 (TOWING-SALVAGE-RECOVERY). Nothing has been pushed to main, merged or deployed.

A treaty term is a persistent record. Each one names its parties and its scope, carries its days and its knowledge
state, and holds its own breach history. It acts only through systems that already exist:

- the shared journey: its routing, its crossings and its leg boundaries;
- the blockade engine;
- the yards;
- doctrine enforcement;
- the treasuries.

There is no second movement engine and no treaty "mode". A breach is an incident with a response state. Nothing in
this round declares a war, resumes one, or reactivates a war objective.

Where the code lives:

| Part | File |
|---|---|
| Pure rules | `src/treaty-terms.mjs` |
| Integration | `src/campaign-strategy.mjs`, the **TREATY TERMS** section and the hooks listed in TREATY-AUTHORITY-AUDIT.md |
| Doctrine | `src/doctrine-campaign.mjs` |
| The captain's formations, basing, UI and debug | `src/main.js` |

## 1. Term schema (`book.treatyTerms[]`)

| field | meaning |
|---|---|
| `id` | stable, from the book's own counter: `<seed>:term:<n>` |
| `type` | `dmz` · `transit` · `basing` · `inspection` · `tribute` · `reparations` · `blockade_lift` |
| `parties` | the named parties (polity ids; the captain's empire is `player`) |
| role fields | the parties' roles, depending on `type` (see the list below) |
| `systems` | the scope, as explicit system indices. For a transit guarantee this is the route or chokepoint; `route` is kept as authored. |
| `startDay`, `endDay` | start; expiry (`null` = open-ended). `durationDays` is accepted when the term is authored. |
| `endCondition` | `paid_in_full` for reparations, otherwise `null` |
| `status` | `pending` → `active` → `ended`, or `suspended` (the war it settled resumed). The UI shows `breached` while an open breach of the term stands. |
| `secret`, `knownTo` | knowledge (§10) |
| `enforcers` | who polices the term. Defaults: the DMZ's parties, the beneficiary, the host, the inspector, the recipient. A named monitor may be added. |
| `authority`, `settlementSource` | where the term came from: `{ warKey, warId, instance, to, day }` for a settlement, `{ kind: 'authored' }` otherwise |
| `compliance` | an authored per-party response (`comply` / `refuse`) used by fixtures and story beats. It is never inferred. |
| `breaches` | the ids of the breach incidents filed under this term |
| DMZ only | `restricted`, `restrict{transit,stationing,reinforcement,blockade,offensive}`, `civilian`, `recovery`, `graceDays`, `withdrawal{dueDay, hulls{}}` |
| payments only | `amount` / `total`, `installment`, `cadenceDays`, `nextDue`, `arrears`, `remaining`, `paidTotal`, `paidCount`, `missedCount` |

Role fields by type:

- `dmz`: `restricted`
- `transit`: `grantor`, `beneficiary`
- `basing`: `host`, `guest`
- `inspection`: `inspector`, `inspected`
- `tribute` and `reparations`: `payer`, `recipient`

The book also holds `treatyIncidents[]`, `treatyLedger[]` and `treatyInspections[]`, plus the counters in
`stats.treaty`. `upgradeCampaignBook` backfills all of them, so an older save loads with empty lists. Everything is
plain JSON; save and load keep ids and states exactly (pure 20, gate SAVE-LOAD).

## 2. DMZ matrix

What a DMZ means for the parties it binds (`restricted`, by default all of its parties):

| traffic / act | restricted party | another power |
|---|---|---|
| military transit (route enters or crosses) | refused: routed round it, or refused if no route avoids it | unaffected |
| military destination inside | refused (`treaty: no lawful route`) | unaffected |
| stationing (standing inside) | withdraw within `graceDays`; after that, a `dmz_stationing` breach | unaffected |
| reinforcement / offensive operation into it | refused, through the same routing (a planner never plots it) | unaffected |
| blockade inside | `startBlockade` is refused; one already there is closed when the term starts (§12) | unaffected |
| civilian traffic (evacuations, doctrine deliveries/transport/construction/exploration/rescue/investigation, trade) | allowed unless `civilian: 'prohibited'` | — |
| recovery and tow (journey kind `recovery`) | allowed unless `recovery: 'prohibited'`; a tow is not an offensive fleet | — |
| a disabled or surrendered hull inside | listed `stranded`, never a breach; it may be towed out | — |

How a journey is classed: the kind `recovery` is recovery traffic. An evacuation is civilian whatever escorts it.
Doctrine work, formations and trade are civilian when their purpose is civilian. Everything else is military.

When a DMZ starts, ships already inside are not ejected. A restricted AI warship standing in the zone is sent out
by an ordinary `return` journey to the nearest world its side holds outside the zone. That route is lawful: it may
cross the zone's own systems on the way out (the departure prefix), but it never re-enters the zone. The captain's
ships are his to move: the Wars & Treaties panel shows "Withdraw N ships from the DMZ by day X".

Each hull's record moves through these states:

- `pending`
- `withdrawn` (compliant)
- `stranded` (disabled; unresolved but not a breach)
- `breach` (still inside after its grace period; an observed `dmz_stationing` incident)
- `withdrawn_late` (left after that; the incident is resolved)

A hull that leaves and later comes back is a new presence, with its own grace period (R3). A military doctrine job
whose ship stands inside a DMZ binding its own side is stood down, so the ship can withdraw (§13).

## 3. Transit guarantee matrix

A guarantee covers a grantor, a beneficiary, systems and traffic classes. It is distinct from friendship, from
basing, from ownership and from alliance.

| what the guarantee changes | when |
|---|---|
| a DMZ is lifted for the beneficiary at the covered systems | only if the grantor is a party to that DMZ |
| the grantor's blockade lets the beneficiary through (`blockadeApplies` is false) | the guarantee covers the runner's class (R4) |
| the grantor's border authority classes the vessel `exempt` (doctrine `accessClassOf`) | likewise: the grantor's own term, so always known to it |
| a static hostility or a formal war | does **not** override it (pure 28) |
| basing, repair, market access, ownership | never (pure 7) |
| a same-flag third party (the captain flying the guaranteed power's flag) | never: terms bind polity ids, not flags (pure 29) |

If a blockade is explicitly ordered to stop guaranteed traffic anyway (`orderBlockadeObstruction`, or the debug
code `treaty obstruct <blockade>`; no AI gives this order), its runs go through the blockade engine. Each run is a
`transit_obstructed` breach by the blockading power, known to the ships it stopped. It is never silent hostility
(pure 26).

## 4. Basing matrix

Basing rights are scoped to a host, a guest, the host's facilities (`systems`, optionally `stations`) and named
purposes. They apply only while the host still holds the system.

| purpose | what it opens | through |
|---|---|---|
| `repair` | AI: a share (`repairShare`, default ½) of the host yard's daily repair capacity, and the yard counts as a repair destination. The captain: the yard's Repair hull for his ships and his own ship, paid as any repair. | `advanceRepairs`, repair-journey `valid`; `fleetServiceAllowed(…, 'repair')`, `requireDocked('repair')` |
| `resupply` | the captain's antimatter refuel there | `requireServiceConnection('resupply')` |
| `recovery` | the yard counts as a recovery yard for tows and stranded hulls | `towYardOk`, `recoveryYardAt` |
| `staging`, `docking` | recorded for authored use; nothing else reads them this round | — |

Basing never grants:

- sales, purchases, refits or equipment transfers (`fleetServiceAllowed` with no named service is unchanged; gate BASING-REPAIR);
- ownership of the system or its stations;
- vendor stock;
- licences or production (no yard or berth in the guest's production account; pure 9 and 10);
- war participation, shared command or shared intelligence.

Yard provenance and the foreign-market rules are untouched.

## 5. Inspection lifecycle

An inspection regime names who inspects whom, where, which traffic classes (and optionally hull categories, such
as `freighter`), what may be revealed (`reveals`: `manifest`, `hulls`), and what a refusal means (`deny_passage`,
the default, or `record_only`).

```
crossing into a covered system ─ inspector knows the regime and is present (holds it or has a ship there)?
   no  → nothing (counted: inspectionsUnenforced)
   yes → REQUESTED   (communicated; the request alone reveals nothing — observed: null)
            ├─ not received (no one aboard can answer) → stays REQUESTED; never a refusal
            ├─ comply → COMPLETED: observed = the declared, non-concealed hold (cargoId, quantity) in the
            │           categories the regime reveals — never concealed items, destinations or prices
            └─ refuse → REFUSED: an `inspection_refused` breach known to the inspector;
                        deny_passage → turned back the way it came (the shared forced-back path)
```

Going back the way it came is not inspected again. A repeat refusal by the same ships at the same point within 30
days is the same incident (R2). A doctrine job turned back under a treaty is stood down rather than retried every
day. A refusal is an incident, never war (pure 14).

## 6–7. Tribute and reparations ledger rules

- The money comes from existing treasuries. An AI payer's `treasury` moves directly. The captain's money moves
  once, by a `treatyPayment` effect applied to `state.latinum`. The model only updates its own copy (refreshed
  from the real account by `syncPlayerPolity`), so a bulk jump and a daily step agree.
- Each day: arrears are paid first whenever the funds allow; this resolves the open `payment_missed` incidents.
- On the due day the installment is paid if the funds cover it. Otherwise it is **missed**: the installment is
  added to arrears, and a `payment_missed` breach is filed (evidence: the recipient's ledger; known to the
  recipient). There is no war, no seizure and no other consequence.
- Tribute: `amount` every `cadenceDays`, open-ended, or until `installments × amount` has been paid (late payments
  count once paid; R6).
- Reparations are finite. `remaining` goes down only on an actual payment, and the term ends `paid in full` with
  the last one. Nothing is taken after that (pure 19).
- Every payment and every miss is a `treatyLedger` entry `{day, termId, type, payer, recipient, amount,
  arrearsPaid, status}`.

## 8. Relationships

Terms sit beside the war, ceasefire and peace state, standing and static attitude. They never replace these and
never reduce them to "hostile = false":

- a ceasefire can carry a DMZ;
- a peace can carry reparations;
- a war can carry a humanitarian guarantee.

A term created by a settlement keeps its `settlementSource`. If that war resumes (a new instance, or war again
after the settlement), the term is **suspended**. The treaty never resumes the war itself.

## 9. Breach incident lifecycle (`book.treatyIncidents[]`)

Each incident records:

- `{id, termId, termType, kind, breaching, against, systemIndex, assets (vids)}`
- `evidence[]` and `knownTo`
- `severity`, `state`, `responses[]`
- `warDeclared: false`, always

Incident kinds: `dmz_entry`, `dmz_stationing`, `inspection_refused`, `payment_missed`, `transit_obstructed`,
`blockade_in_dmz` (reserved).

```
WARNED ──comply──▶ COMPLIED (turned back / escorted out)
   └──refuse───▶ BREACH ──(left the zone / arrears paid)──▶ RESOLVED
(unobserved)  BREACH, knownTo = the breaching party only
```

No motive is inferred. Escalation goes only through an explicit authority (the breaching party's response, an
authored order). A breach adds to `term.breaches` and to `stats.treaty.breaches`. It reaches the captain as a
report only if he is in `knownTo`.

## 10. Known / secret visibility matrix

| record | who sees it |
|---|---|
| public term | everyone (it is a published treaty) |
| secret term | only `knownTo` (its parties, and anyone later told) |
| history entry of a term (`secretTerm`) | whoever may see the term (`historyVisibleTo`) |
| incident | only `knownTo`: the breaching party plus those with evidence (an enforcer who knows the term and holds the system or a neighbour, or has a ship there; the recipient's ledger; the inspector; the obstructed ships) |
| inspection | the inspector and the inspected |
| ledger entry | the payer, the recipient, and anyone who can see the term |
| the debug view | everything |

Using a secret term leaks nothing. A ship passing under a secret guarantee files no incident and no report. A
third-party watcher learns neither the term nor the reason (pure 21). An enforcer that does not know a term does
not act on it (pure 27). The secret Dominion pact (`book.treaties`) is a separate record and is unchanged
(pure 31).

## 11. Movement

There is one engine. `plotJourney` reads the terms in force (`world.treatyBook`) for the polity and class it is
given: it routes round a barred system and never ends in one. Every planner that plans by route therefore plans
lawfully: operations, returns, repairs, blockades, recovery, Dominion movement, and doctrine through
`routeBetween`.

`startJourney` checks a plan made by its caller. A doctrine plan is refused (the job is stood down); any other plan
is re-plotted lawfully. A mover explicitly sent through in defiance (`treatyDefy`) is plotted without restriction,
and each crossing is an incident (§9).

At **every leg boundary** the rest of the route is re-checked. A treaty that started, ended or changed while the
leg was in flight is handled where the leg ends:

- re-plotted lawfully, with the blockades it avoids carried over;
- or halted, for a doctrine job or an evacuation, whose owner then re-plans.

There is no teleport; the legs already flown are never touched (pure 24).

The captain's formations follow the same rules through `playerLawfulRoute`:

- a refused dispatch reads "DMZ — Military transit prohibited: …";
- a boundary re-plot happens in `crossFormationLeg`;
- crossings go through the same `treatyCrossing`;
- `treaty defy <formation>` sends one through in defiance.

## 12. Blockades

- A DMZ that binds a power refuses its `startBlockade` there, and the AI planner never chooses such a target.
- A blockade already inside when the term starts is closed at once, with "closed under treaty".
- A `blockade_lift` clause, such as a ceasefire requiring named blockades lifted, closes them through `endBlockade`
  and forbids new ones there (R5).
- No illegal blockade is left running (pure 25).

## 13. Doctrine (execution only)

Doctrine may:

- route lawfully;
- stand down its own military job inside its own side's DMZ, so the ship can withdraw;
- treat a vessel the authority itself guaranteed as `exempt`;
- warn and escort out at a DMZ crossing (the shared `treatyCrossing` warning: the observer is an enforcer who
  knows the term);
- request an inspection and record a refusal.

Doctrine never:

- invents a term;
- assumes a secret one;
- declares a war;
- treats a breach as casus belli.

## 14–15. UI

- The fleet manager uses concise lines on formations and dispatches:
  - "DMZ — Military transit prohibited: Oce Nu is inside a demilitarised zone (Your empire–Klingon DMZ)."
  - "Transit guaranteed under treaty through Oce Nu"
  - "Inspection required at Oce Nu"
  - "Turned back at Oce Nu by a DMZ warning (complied)"
- **Empire → Wars & treaties → Treaty terms** shows, per relationship (with its war, ceasefire or peace status):
  - each known term with its headline ("DMZ — Military transit prohibited", "Tribute due: 5,000 L every 30 days",
    "Reparations remaining: 15,000 L of 20,000 L") and its status (active / breached / ended / suspended);
  - scope, expiry or what is due, and the captain's own obligations;
  - the breaches he knows of, his inspections, and his ledger.
- Secret terms are hidden unless known.
- Debug → **Treaty terms (debug)** shows the counters and every term, incident (with "War: no"), inspection,
  payment and DMZ withdrawal record.
- Debug codes:
  - `treaty <by> <to> <clause>`
  - `treaty end <n>`
  - `treaty defy <formation>`
  - `treaty obstruct <blockade>`

## 16. Settlement authoring

`applyWarTransitionInModel` accepts `t.treaty`. `forceWarTransition(…, opts.treaty)` and an offer's `treaty`
carry it. There is no negotiation AI: the terms are whatever the settlement code passes. Each item is one of:

- a full term spec;
- a clause string, read with `by` = the loser and `to` = the winner;
- `{ clause, by, to }`.

In a settlement with no winner, a bare clause string may only be symmetric (a DMZ or a blockade lift). A payer or
grantor must be named, never picked by key order (R7). A follower's inherited war is bound to the ceasefire but
receives none of its government's terms (pure 30).

Clause fixtures (`parseClause`):

- `add DMZ systems A/B`
- `grant transit route X/Y/Z`
- `grant basing at Y [for repair/resupply]`
- `tribute 5000 every 30 days`
- `reparations 20000 over 4 payments [every N days]`
- `inspection regime on military freighters [at A/B]`
- `lift blockades at A`

## Measurements

### Fixture campaign

`npm run measure:treaty` runs the treaty fixture galaxy for 360 days with AI planning, operations, blockades and
tows on. It is compared with a twin that has the same settlement but no terms. The terms in force:

- a Terran–Klingon ceasefire with a DMZ at Border/Archanis;
- a Klingon guarantee through Archanis/Khitomer;
- basing at Qonos;
- an inspection regime on freighters at Khitomer;
- tribute and reparations;
- a Cardassian–Klingon DMZ.

Traffic during the run:

- a freighter through Khitomer every 15 days;
- a warship sent through the DMZ in defiance every 25 days, alternately complying and refusing;
- a damaged warship left at Qonos every 60 days.

| measure | with terms | twin |
|---|---|---|
| active terms (max) | 7 | 0 |
| DMZ crossings / warnings | 14 / 14 | 0 |
| compliant withdrawals (zone start, warnings heeded, withdrawals completed) | 42 (22 withdrawal journeys ordered) | 0 |
| breaches | 14 (7 `dmz_entry`, 7 `inspection_refused`) | 0 |
| inspections requested / completed / refused | 23 / 16 / 7 | 0 |
| tribute paid / missed | 11 / 0 | 0 |
| reparations paid / completed | 6 / 1 | 0 |
| basing repair-days | 27 | 0 |
| treaty-related blockade refusals (AI planner) | 0 (it never plans one) | 0 |
| **war declarations** | **0** | **0** (accidental: **0**) |
| Terran–Klingon war state at the end | peace (the ceasefire settled; instance unchanged) | peace |
| ms/day | 2.2 | 2.3 |
| treaty state in the book | 35 KB of 164 KB | — |

### Real game

`npm run measure:treaty:ingame` runs the default campaign for 300 days with the empire–Klingon ceasefire and seven
terms. The baseline has no terms.

| measure | with terms | baseline |
|---|---|---|
| ms/day (both run concurrently) | 157 | 153 |
| page errors | 0 | — |
| tribute paid | 10 | — |
| reparations completed | 1 | — |
| AI warships withdrawn from Oce Nu | 25 | — |
| war declarations reported | 0 | 0 |
| empire–Klingon status at the end | ceasefire | war |

Treaty-related blockade closures in the fixture run: 0, because no blockade was ever laid where a term forbids
one. The closure path is exercised by pure 25 and R5.

## Still deferred

1. Individual or class-specific strategic speed refinement. The lookup it needs:
   - explicit per-class overrides;
   - exceptions such as the Sovereign class being faster than many smaller ships;
   - the category only as a fallback;
   - damage and engine-condition penalties later.
2. Consolidating the trader record's shape.
3. NPC tactical-scene persistence.
4. Autonomous war declarations. None are made here: a breach is never a declaration.
5. Doctrine invasion or occupation.
6. Broad covert doctrine.
7. Hirogen hunting.
8. Borg assimilation.
9. Gorn activation.
10. Tactical Cube.

Towing limitations carried forward from d5b50b5:

- no allied recovery;
- no tactical visualisation of a hulk under tow;
- one tug per hulk;
- no crew clock for the captain's own vessels.

Treaty limitations this round:

- Basing `staging` and `docking` are recorded but not yet read by any system.
- There is no negotiation AI. Terms come only from settlement code, authored beats or debug.
- An AI warship busy on another order inside a DMZ is not ordered out until it is free. Kept there past its grace
  period, it becomes a stationing breach.
- A bulk calendar jump past `maxCatchUpDays` catches payments up one installment per day afterwards. This follows
  the existing jump bound.
