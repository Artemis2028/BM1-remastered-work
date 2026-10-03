# DMZ presence state matrix (ARCHITECTURE-CLEANUP §4, §6, §7)

DTG 031416ZOCT26 · stacked on 1f2da30.

A DMZ restricts two different things, and they are kept apart:

- **transit:** entering or crossing the zone. This is `TT.dmzRestrictsTransit`, read by route plotting and crossings. A transit guarantee from a DMZ party lifts it, for the classes it names.
- **stationing:** staying in the zone. This is `TT.dmzRestrictsStationing`, read by the zone's daily pass `dmzDay`. Only a **staging** basing right from a DMZ party lifts it. A transit guarantee never does.

A clause may restrict both (the default), or stationing only (`restrict: { transit: false }`). In that case the term headline reads "Military stationing prohibited; transit permitted".

## Persistent state: `term.withdrawal.hulls[id]`

The `id` is the hull id, `pf:<fleet id>` for the captain's fleet ships, or `captain`.

| field | meaning |
|---|---|
| `polity`, `vid`, `systemIndex` | who and where |
| `since` | entry day of **this** presence: the day it was first seen stopped in the zone |
| `presence` | `transit` (moving, on its way out) · `docked` (the captain at a dock) · `loitering` (stopped) · `staged` (under a staging right) |
| `state` | `pending` · `stranded` · `breach` · `staged` · `withdrawn` · `withdrawn_late` |
| `dueDay` | grace deadline = max(the zone's own due day, `since` + `graceDays`) |
| `orderedDay`, `withdrawalOrdered` | when an AI withdrawal journey was last ordered. It is retried at most every 3 days. |
| `incidentId`, `breachDay` | the one breach for this presence |
| `termId` | the staging term that lifts it, when staged |
| `returned` | how many times it has come back after leaving |

All of this is saved with the term (pure R24: the same breach day after a reload).

## States and transitions (each daily pass)

| from | condition | to | effect |
|---|---|---|---|
| none | moving through, never stopped | none | **legal transit leaves no record** (pure R14b; in-game CG-1) |
| none | stopped in the zone, not a warship of a restricted party | none | — |
| none | stopped, restricted warship, no staging right | `pending` (`loitering`) | grace starts. AI with no order: an ordinary withdrawal journey is ordered (never a teleport). The captain gets a warning and **Leave DMZ**. |
| none / any open | stopped, a staging right from a DMZ party covers it | `staged` | no grace, no breach. An earlier breach is resolved (pure R3/R20; CG-4). |
| `pending` | disabled or surrendered (AI hulk, or the captain's own ship disabled) | `stranded` | never a breach while disabled (CG-12). Once repaired where it lies it goes back to `pending`. |
| `pending` | left the zone | `withdrawn` | counted as a compliant withdrawal; no breach (pure R15/R16; DMZ-TRANSIT-VS-STAGING B1) |
| `pending` | day > `dueDay`, still there | `breach` | **one** `dmz_stationing` incident, keyed `term|stationed|id|since` (pure R17; CG-3) |
| `breach` | still there, any number of days | `breach` | nothing new (pure R18; CG-3 "ten more days") |
| `breach` | left the zone | `withdrawn_late` | the incident is resolved: "the ship has left the zone" (CG-3) |
| `withdrawn` / `withdrawn_late` | moving through again | unchanged | still transit, no new presence (pure R14c) |
| `withdrawn` / `withdrawn_late` / `staged` | stopped in the zone again | new `pending` | a **new presence**, with its own grace and possibly its own **distinct** breach (pure R19) |
| `staged` | the staging right ends while it is still there | new `pending` | grace from that day |
| any | the DMZ term ends | — | the record goes with the term. No breach after the end, and staging is permitted again (pure R23). |
| any | the DMZ term begins with it already inside | `pending` | grace from the start day (pure R22) |
| any | a recovery tow carrying it | skipped | a tow is recovery traffic, not a warship (TOWING-SALVAGE §2) |
| `pending` | becomes civilian (the captain changed ships) | removed | nothing to withdraw |

## The captain (§6)

The captain's own ship is not a model hull. `buildCampaignWorld().captain` gives `dmzDay` his system, whether he is moving (warp or wormhole), whether he is docked or disabled, his vid and his traffic class. He is held to the same term, and DMZs that bind the empire (`player`) apply to him.

- **Warning:** fleet manager, `[data-captain-dmz]`: "DMZ — military stationing prohibited · Withdrawal required by day N", with a **Leave DMZ** button.
- **Leave DMZ:** opens the chart with the nearest lawful exit outside the zone selected. It **never moves him** and never starts a course (CG-2). He can still choose to stay.
- **Breach:** "DMZ — military stationing prohibited · in breach since day N" (CG-3).
- **Staged:** "Staging permitted under treaty at Oce Nu", with no Leave button (CG-4).
- The arrival log appends the DMZ line, and the obligations list uses his presence's own due day.

## The AI (§7)

| situation | behaviour | check |
|---|---|---|
| legal transit (guarantee or stationing-only zone) | flies on; no presence | pure R25, R1, R14b |
| its order ended inside, no other order | an ordinary `return` journey (`purpose: 'withdraw'`, authority `treaty`) to the nearest lawful system **outside the zone**. On this round's first cut the "nearest" could be the zone itself, when a guarantee left it open; fixed. | pure R25/R26 |
| kept there by an order of its own (an operation or a doctrine job) | stays, and past the grace records the breach. Never teleported. A doctrine job is stood down only where the zone bars **transit**. | pure R25/R27; doctrine `treatyStandDown` |
| no lawful way out | it stays, and the attempt is retried every 3 days (no daily churn) | — |

Treaties never move a ship by fiat. Every departure is a journey that flies its legs.

## Debug

Treaty section:
- the header adds "withdrawals ordered" and "stationing breaches";
- the **Access** table gives one row per open presence, plus the captain where he is, plus each basing term. Its columns are party, system, vessel, class, transit, docking, staging, repair, presence, deadline, breach, and the exact term(s) that granted or denied each (CG-11).

## Integrated: DMZ-TRANSIT-VS-STAGING (pure)

The setup: a DMZ at Border and a Klingon guarantee of military transit, with no staging.

- Fleet A flies Vega → Border → Qonos: no presence, no breach.
- Fleet B stops at Border and gets the grace.
- Branch B1 leaves before its due day: `withdrawn`, no breach.
- Branch B2 stays and records exactly one breach.

1f2da30 fails this on its own assertion ("B has no grace"), because there the guarantee lifted the whole zone.
