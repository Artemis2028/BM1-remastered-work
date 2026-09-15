# Intelligence and transporter follow-up

Parent: `72b4cfa55fd3eebe93870ca01c86c28508d72832`. This follows the independent Captain's Briefing review and Rafael's decisions: variable report accuracy with an advantage for ships present, retain the current arrival distances for testing, retain freight payouts, constrain transporter transfers and try a short disabled grace period.

## Reports and knowledge

- Exact named system reports require the current system or `visitedSystems`, in addition to the hidden-region gate. Public diplomatic announcements remain global. An observation outside surveyed space is rendered without the system name or governor. Hidden Dominion-core systems remain excluded. Legacy activity-derived `warning:` reports are retired when loading the upgraded news book.
- Opening the feed no longer calls `getSystemActivity` across the galaxy. Local observation snapshots record actual active fleet actions or reconnaissance contacts, rather than planned activity types waiting to spawn. The same observation is not rewritten on every frame. No observation means missing information, not a quiet-system or raid claim.
- Every assessment gets a seeded reliability draw and a separate correctness draw. Fresh civilian reliability varies from **45% to 75%**, while fleet observer reliability varies from **80% to 97%**. Older information loses one percentage point per day, capped at a 20-point age penalty. These are starting tuning values, not exposed percentages or a promise about a particular report. Both sources can understate or overstate activity, miss an action or report a false alarm.
- Ship presence is assessed when the report is gathered and frozen into its source and claims. The player ship counts while present; stationed living fleet vessels count; destroyed ships, dispatched ships in transit and escorts travelling with the player do not. Moving a ship in later or opening the archive again does not upgrade or reroll an already gathered report.
- Mistaken attacker identities are drawn only from hostile governments at the destination or a directly connected system, with a legal regional deployment pool. An actual recorded incursion can identify its real attacker even outside that ordinary reach. Reports do not invent a distant faction identity merely because that faction has a spawnable hull.
- Periodic reports sample up to three observation locations per seven-day cycle. Fleet assessments arrive after one campaign day; civilian reports after two to four days. Claims retain their observation date and explicitly warn that conditions may have changed. Reading a report changes no campaign days. Local fleet-action notifications remain immediate, but their assessment can be mistaken too. Public declarations and directly observed installation destruction are event records, not probabilistic rumours.
- Archive and pending delivery queues are capped at 120 each; observations are one record per observed system. The diplomacy cursor now follows the complete bounded history instead of applying a second independent slice cap.

This remains a report layer over the existing simulation. It does not simulate battles or attrition in unloaded systems. Stationed fleet presence improves assessment reliability; it does not make an old observation current. Reports retain the original information date. That boundary is intentional and visible.

## Arrival distances and freight retained

`placePlayerAtSecurityApproach` is byte-identical to the parent: the 1,800-unit unpoliced approach and zone-relative margin remain for Rafael's playtest. Only its stale explanatory comment changed. Faction border defaults and checkpoint footprint are unchanged.

Freight base rates, hazard supplements and tonnage selection are unchanged. A full hold now returns no offer with a clear message; a single free ton can still receive a one-ton offer. This prevents an unloadable offer without changing ordinary payouts. Recovery pricing, hull resale and upkeep rates are unchanged.

## Transporter range

- Authorized station hails and market browsing remain available throughout the current system. Physical transfers require **2,500 world units or less** from the vendor. The market shows current distance, transfer limit and whether it is browse-only; the readout updates as the player moves.
- Purchase and refit capability checks and transaction handlers recheck range. Opening a market or purchase dialog while nearby cannot authorize a later distant transfer. Stock, funds, standing, security clearance and debt rules remain in force.
- Cargo delivery requires a nearby planet or connected vendor; an away mission also requires proximity to the planet. Remote fleet service requires both the player and serviced vessel to be near the vendor, in addition to the existing local command/service guards. The debug mission buttons choose a reachable authorized station or explain that access is unavailable.
- Personal and fleet hull repair still require physical docking. Hails do not set docking state. This deliberately preserves the reduced role for docking requested in the playtest notes.

## Disabled grace period

An incoming combat hit that crosses an operational player ship into its disabled band stops at that band and starts **three seconds of combat damage protection**. The disabled panel shows the countdown and existing recovery/command-transfer controls. A second hit cannot skip straight through the band during this window, including on the small Lysian Fighter.

Remaining protection time is saved and restored, tied to the same personal vessel identity. Repeat hits do not restart it. After expiry, further combat damage can destroy the ship; a new game does not inherit protection. Environmental damage is outside this combat-only grace. NPC disable rules and boarding odds are unchanged. Three seconds allows a response; it does not guarantee survival through the five-second paid recovery process or add a surrender mechanic.

## Installation reports and small maintenance fixes

Destruction returns early for an already destroyed installation. A real loss uses a unique persisted loss identifier, installation identity and reconstruction identity where present. Destroying a replacement therefore publishes another report, while calling destruction twice on the same ruin does not. The regression drives the actual faction reconstruction process before destroying the replacement, rather than manually resurrecting a flag.

Report dialog close handling tolerates an absent element. The reused anti-emitter icon now carries the same asset version parameter as other weapon icons. The new intelligence module is included in source and generated offline manifests.

## Validation

Chromium 153.0.8010.0, Linux. Test exports are injected only in browser responses.

| Gate | Passing checks/groups | Served runtime |
| --- | ---: | --- |
| Intelligence follow-up browser probe | 7 | Built release |
| Captain briefing | 13 | Built release |
| Behavior | 79 | Built release |
| Fleet | 91 | Built release |
| Playtest | 22 | Built release |
| Sensors | 54 | Built release |
| Hull merges | 23 | Built release |
| EW | 33 | Source, hash-matched to release |
| Anti-jam seeker | 38 | Source, hash-matched to release |

The pure intelligence test assesses 10,000 seeded observations for each source: **5,901 civilian** and **8,786 fleet** event classifications were correct. It also checks repeated assessment identity, reliability variation, bounded delays and regional mistaken identities. This is a reproducible model sample, not measured campaign intelligence performance.

The browser follow-up verifies discovery, no activity materialization after 84 days of feed reads, observer eligibility, anonymous unknown-system text, delayed claims unchanged by later events/read/save/load, browse-only service at 565,685 units, transfer success at 2,500 and rejection at 2,501, full holds, two actual reconstruction losses, and small-hull grace/save/expiry/lethality. Arrival function and freight formula preservation are checked directly against the parent. Build, offline module inclusion and diff checks pass.

The old captain briefing purchase fixture now approaches to 2,000 units; the new probe explicitly covers the rejected distant case. The other existing suite assertions are unchanged. Logs, exit codes, source/release hashes and screenshots accompany the review handoff. No native iPad/Safari run, combat duel win-rate study, long campaign economy study or EW performance campaign is claimed. Nothing is pushed or merged.
