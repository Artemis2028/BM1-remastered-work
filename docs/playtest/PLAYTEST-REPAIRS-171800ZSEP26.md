# BM1 playtest repairs on top of `ae4ae4d`

DTG 171800ZSEP26

Parent: `ae4ae4d` (Patch 1, DTG 171325ZSEP26) — untouched. Nine commits on top of it, first-parent chain
through `ae4ae4d`. Nothing pushed, merged or deployed.

## Read this first: what this candidate is not

The 17SEP specification ("BM1 playtest repairs and fleet-trade goals") is much larger than what is here.
Its §3.1 was answered in full — the Dominion arc is now a strategic opening with no date anywhere in it
— but §3.3 (faction-blind war goals and bilateral peace), §3.4 (cargo and contracts), §3.5 (uninhabited
worlds), §3.6 (HUD and modals), §4 (fleet trading), §5 (recall), §6 (repair UX) and §7 (overlay) are
**not implemented at all**. §3.2 is a first layer only. The list at the end of this document is item by
item, and `CANDIDATE.json` carries the same list under `not_implemented` so it can be checked
mechanically rather than read for.

An earlier draft of this candidate moved the expedition to a fixed day 180/260/320 window. The
specification rejects fixed windows, and that commit has been superseded: there is no invasion date in
the rules any more.

## The changes

### 1. `df24878` — a power the captain has never met is not on their board

A fresh Terran start listed **Dominion · 0+ worlds · strength 3,119–5,199 · day 1** in the Other Powers
table with all eight of its systems uncharted, and the strength band was read from the Dominion's true
readiness. `campaignPowerContact(id)` now decides whether a power is on the captain's board at all:
controlled systems they can see on the chart, installations at a known system, a dated observation, or
a report that named it. A power with none of those is not listed, not named in the panel, and not the
subject of a public diplomatic report.

Where a power *is* known but only partly observed, the estimate says so: `at least N`, `(low
confidence)`, and a floor rather than a total, computed from `Campaign.observedReadiness` over the
systems actually observed rather than from global truth.

`CAMPAIGN_LOCKED_DIPLOMACY = ['dominion']` takes the expedition's war out of the ordinary neighbour
roll, in both sources of `diplomaticPairs()`.

**Not fixed by this:** every other power's strength band still derives from true readiness. That is the
named follow-up in the specification and it is not closed here.

### 2. `9c37aed` — Blender holds a Jem'Hadar garrison that is not Dominion Central

Blender (system 28) was an empty neutral system. It now holds `dominion_remnant`: its own diplomatic
identity, its own name (**Blender Remnant**), its own art and ship prefix, at war with Terran and
Romulan and at peace with everyone else, with an authored outpost (`28-901`, "Blender Garrison") and
four hulls standing on it. It controls no world, so it is not a territorial power.

Its opening garrison is authored in `CAMPAIGN_RULES.openingGarrisons`.

**Unproven:** that it actually raids Terran and Romulan forces and is raided back. The identity, the
outpost and the garrison are in and gated. The raiding behaviour is not gated and is not claimed.

### 3. `ec9872c` — the remnant flies two designs and can pay for itself

The garrison drew from the whole Dominion pool, so the opening four included a **Dominion Battleship**
and a **Dominion Scout** — hulls the captain is not meant to see before the wormhole. Every draw for
`dominion_remnant`, by every path (campaign hull, patrol, escort, raid, traffic), now comes from
`FACTION_DESIGN_POOL`: **Jem'Hadar Attack Ship (322)** and **Jem'Hadar Battlecruiser (48)**, nothing
else. Dominion Central still draws the whole catalogue; the restriction belongs to the remnant.

It also had no way to stand: ruling no world it earned nothing, paid upkeep from a fixed opening
treasury, and a hull lost to a raid was gone for good. Its outpost now pays it.

| Authored value | Setting | Why |
| --- | --- | --- |
| `revenuePerDay` | **120 latinum/day** | against 13–28/day of upkeep for four hulls (mass 2 and 7 at `hullUpkeepPerMass: 1`); 30% of one world's base revenue |
| `materialsPerDay` | **1 duranium/day** | the same as one controlled world's mining |
| `supply` | **0.6** | one outpost sustains more than the no-supply floor (0.35) and much less than a supplied power (1.0) |
| `replaceDays` | **60 days** | one hull at a time, never past the authored four, and it must pay the yard price (18,000 for an attack ship, 245,000 for a battlecruiser) |

All four are tied to the outpost: destroy station `28-901` and the income, the supply and the
replacements all stop. **These four numbers are for sign-off.**

### 4. the Dominion entry is an opening, not a date

Two commits. The first moved the arc to a fixed 180/260/320 window, which stopped the reported
behaviour but is not what §3.1 asks for. The second removes the window: `dominionReconDay`,
`dominionStagingDay` and `dominionInvasionDay` no longer exist.

`dominionOpportunity(book, world, day)` decides whether there is an opening, and reports why not. All
of the following must hold:

| Condition | Read from | Threshold |
| --- | --- | --- |
| a central war that has cost its belligerents something | a new per-pair **war ledger** (`book.wars`) counting engagements that produced losses or a capture — kept because the operation list is trimmed | 20 engagements |
| a near-side power materially below its own capacity | `readiness / max(readinessBaseline, readinessPeak)`; `readinessPeak` is recorded daily so a player empire that started with nothing still has a capacity | ≤ 0.65 |
| a balance the expedition can exploit | either a costly stalemate — both belligerents worn down, bounded strength difference, and a front that has stopped moving — or a victor too weakened to hold the door | gap ≤ 0.5; victor ≤ 0.6 |
| nobody on this side still standing tall enough to make the crossing pointless | the strongest near-side power against what the Dominion can bring | ≤ 1.5× its reach |
| a corridor nobody has closed | defence at the entry against the Dominion's own reach, never against the defender's size, so a garrison cannot inflate the yardstick it is judged by | ≥ 1.2× closes it |
| a floor, and only a floor | campaign day | 120 |

The case has to **hold**, not merely occur: a war's numbers move every day and one of those days will
clear every line at once. The opening accumulates a day's weight when the case holds and loses half a
day's when it does not, and unlocks at 30. A war that is deepening gets there; a war that wobbles
around the line never does.

The stages are events. Reconnaissance dwells 40 days, staging 25, and at any point a near side that
**recovers** — every near-side power back above the capacity line — or a corridor somebody closes
stands the expedition down where it is. Nothing expires and nothing is forced through: there is no
latest day.

Measured on the shipped galaxy: dormant through roughly day 280 while the war builds its engagements,
reconnaissance around 340, the crossing around 390 — and different for every galaxy and every player.

The debug phase override forces the opening rather than a timetable, so a forced phase is still entered
by the code that enters it in play.

**Tuning for sign-off:** 20 engagements, 0.65 capacity, 0.5 strength gap, 1.5 challenge ratio, 1.2
corridor ratio, 30 days of accumulated weight, a 120-day floor, and 40/25-day dwells.

### 5. `0033450` — a station can be hailed without docking

A station could be *selected* as a target, but the HAIL control and the `H` key both went to the
ship-only path and answered "No ship selected to hail". The only ways into a station's channel were the
COMMS list and docking, which is what the playtest reported as "you still can't hail stations unless
docked".

Hail now opens a selected station's channel; with nothing selected it opens the nearest station's
channel list rather than refusing; a ship hail is unchanged. The security-clearance and standing
refusals still apply and still state their reason — `openRemoteStationShop` already did that.

### 6. `6d1cb6e` — a world's people and its government are two different facts

Bajor under a Dominion flag read as "Dominion space" on the planet card and "Dominion controlled" on
the map. `getSystemSovereignty(index)` reports both, on a ladder built from state the campaign already
keeps rather than a new mechanic:

| Level | What it means | What it is read from |
| --- | --- | --- |
| `independent` | governed by its own people | controller equals origin |
| `unclaimed` | no people and no government | neither |
| `colony` | a holding on a world with no people of its own | controller set, origin none |
| `occupied` | taken, and still suppressed | `book.occupations[i]` younger than `occupationIntegrationDays` |
| `administered` | taken, output recovered, industry not integrated | occupation older than that, or an authored foreign administration with no capture day |
| `annexed` | the holder has integrated the industry and taken the designs | `integrations[i].completedDay` |

`contested` is an orthogonal flag from an engaged operation over the system. The planet card and the
map readout both print people and government, and the map legend gives the line its own row.

**This is a first layer, not §3.2.** It reports culture and controller. It does not yet carry a separate
`sovereignId`, an `administration` record, an integration percentage, per-installation `assetOwnerId` /
`commandSideId`, the seven named control stages, or the multi-colour map symbology.

### 7. the model and in-game suites stop depending on when the expedition sails

Two commits' worth. Checks that had a schedule baked into their windows now either take the window from
the book's own rules or author the strategic state they need, so a tuning change moves the campaign
without moving the checks. Where a gate needs an expedition to exist inside a short window and is not
itself about the unlock, it says so in a comment and relaxes the opening deliberately.

## Gates

**35 of 35 green**: the 33 Patch 1 gates, unchanged and still green, plus `playtest-gate` and the new
`dominion-matrix`.

`playtest-gate` is 10 adversarial checks and **all ten reproduce on `ae4ae4d`** — see
`validation/playtest-gate-baseline-ae4ae4d.log`.

| Check | What it reproduces on `ae4ae4d` |
| --- | --- |
| DOM-1 | the Other Powers table listed the Dominion at a fresh start |
| DOM-2 | charting one hidden world presented the whole region's true strength as a total |
| DOM-3 | a near-side capture handed the expedition's war to the neighbour roll |
| DOM-4 | the expedition ran on a date, and sixty warp-days in it had already invaded |
| DOM-5 | 200 days of the roll settled the expedition's war with Earth |
| REM-1 | there was no Blender remnant at all |
| REM-2 | the remnant drew from the whole Dominion pool |
| REM-3 | the remnant could not pay its upkeep and never replaced a loss |
| HAIL | a selected station answered "No ship selected to hail" |
| CULT | the planet card and map named only the controller |

`dominion-matrix` is the §9 evidence for the entry decision: **72 rows** varying calendar age (200, 800,
2,000 days) independently of war history, corridor state and player power, printing the decision and the
reason for every row, with seven invariants checked — among them *the same history decides the same way
at 200, 800 and 2,000 days*, *a quiet galaxy never opens however old it gets*, *fighting without cost is
not an opening*, *a front that is still moving is not a stalemate*, *a fortified entry closes the
corridor whatever the war did*, and *a player empire that has become the strongest power here delays the
opening*. The whole table is in `validation/dominion-matrix.log`; it does not run at all on `ae4ae4d`
(`validation/dominion-matrix-baseline-ae4ae4d.log`).

`validation/gate-exit-codes.txt` records each gate's root honestly: `src` means it imports the source
modules directly, `dist` means it loaded the built tree.

## Against the 17SEP specification, section by section

Where it says NOT DONE, nothing exists: no stub, no scaffolding.

**§3.1 Dominion opening** — **done.** No date, no deadline; entry emerges from the central war's
history, the balance it produced, the corridor and the player's own weight. What is *not* done from
§3.1's list: player-intervention effects are only those that fall out of the general rule (protecting
the near side's capacity, fortifying the corridor) rather than a modelled set; the warning texts still
say what they said, though they no longer name Dominion Central as fact before contact.

**§3.1 identity split** — `shipFaction` and `diplomacyId` are not separated; `dominion_remnant` and
`dominion` are separate polities and separate diplomacy, but the split is not the general mechanism the
specification describes. Save migration of an ambiguous `dominion` peace is not handled.

**§3.2 sovereignty layers** — `sovereignId`, `administration`, `controlStage` with integration
percentage, `assetOwnerId`, `commandSideId`, the seven named stages, installation ownership through
occupation, incident-evidence jurisdiction, distinct independent polity identities (New Switzerland vs
Orilla), and the multi-colour map symbology. What is here is culture-plus-controller on one line.

**§3.3 faction-blind war goals and bilateral peace** — the whole section. No persisted war goals, no
willingness/settlement split, no two-sided acceptance, no time-plus-material gates, no distinct
ceasefire/armistice/peace/withdrawal/capitulation/strategic-victory outcomes. `resolveCentralWar` is
still the single authored Earth–Klingon resolution it was.

**§3.4 cargo capacity and contract economy** — no capacity ladder, no fit-to-free-capacity rule, no
per-ton curve, no before/after table.

**§3.5 uninhabited worlds** — zero-population planets still trade and still generate contracts. No
UNINHABITED badge.

**§3.6 bottom HUD and modals** — the bar is still eight buttons without FLEET and EW; the duplicated
expanded labels, sticky header, 44×44 close target, scroll reset and multi-press close are all
untouched. No screenshots at three widths.

**§4 fleet trading, §5 recall and rendezvous, §6 fleet repair UX, §7 living trade-route overlay** — none
of it.

**§9 validation** — no seeded campaign matrices varying calendar age against engagements, losses,
economy and player power; no seeded economy table; no fleet-trade fixtures; no planet-card or map
screenshots.
