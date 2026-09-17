# BM1 playtest repairs on top of `ae4ae4d`

DTG 171540ZSEP26

Parent: `ae4ae4d` (Patch 1, DTG 171325ZSEP26) — untouched. Six commits on top of it, first-parent chain
through `ae4ae4d`. Nothing pushed, merged or deployed.

## Read this first: what this candidate is not

The 17SEP specification ("BM1 playtest repairs and fleet-trade goals") arrived while this candidate was
being packed. It is larger than what is here, and on one point it explicitly rejects what is here:

> Replacing the old day-25/day-45/day-60 arc with another fixed window — even day 180–300 — does not
> solve this. Dominion entry must emerge from the Earth–Klingon war and the quadrant's actual strategic
> condition, not campaign age.

**Commit 4 of this candidate moves the arc to day 180 / 260 / 320.** That is a fixed window. It is a
stopgap that stops the invasion landing in the captain's first hour; it is **not** the condition-driven
opening the specification requires, and it must not be signed off as that. Section "Not in this
candidate" below lists everything else the specification asks for that is not here.

Everything else in this candidate stands on its own and was reported from the playtest directly.

## The six changes

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

### 4. `218e836` — the expedition is moved out of the captain's first afternoon

Campaign days pass only when the captain warps, so the schedule is counted in jumps. At 25/45/60 the
first warning arrived inside the opening hour and the invasion landed before a captain had a second
ship. Now 180 / 260 / 320.

**See the warning at the top of this document.** This is a fixed window and the specification rejects
fixed windows. It is here to stop the reported behaviour, not to satisfy §3.1.

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

### 7. `f8b02a5` — three model checks stop depending on when the expedition sails

Moving the schedule broke three checks that had 25/45/60 baked into their windows. The arc test now
takes its window from the book's own `dominionInvasionDay`; `GAP` and `DAYHOOK` author an early
expedition in their own fixtures. None of the three is about the schedule.

## Gates

34 of 34 green (the 33 Patch 1 gates plus `playtest-gate`). `playtest-gate` is 10 adversarial checks,
**all ten reproducing on `ae4ae4d`** — see `validation/playtest-gate-baseline-ae4ae4d.log`.

| Check | What it reproduces on `ae4ae4d` |
| --- | --- |
| DOM-1 | the Other Powers table listed the Dominion at a fresh start |
| DOM-2 | charting one hidden world presented the whole region's true strength as a total |
| DOM-3 | a near-side capture handed the expedition's war to the neighbour roll |
| DOM-4 | sixty warp-days in, the expedition was already at "invasion" |
| DOM-5 | 200 days of the roll settled the expedition's war with Earth |
| REM-1 | there was no Blender remnant at all |
| REM-2 | the remnant drew from the whole Dominion pool |
| REM-3 | the remnant could not pay its upkeep and never replaced a loss |
| HAIL | a selected station answered "No ship selected to hail" |
| CULT | the planet card and map named only the controller |

## Not in this candidate

From the 17SEP specification, none of the following is implemented. No stub, no scaffolding.

**§3.1 Dominion opening** — the condition-driven opening: central-war engagement history, material
weakening as a share of opening and recoverable capacity, exploitable balance, corridor viability,
player-intervention effects, event-stage warnings instead of dates, and the removal of any fixed day.
Commit 4 is a fixed window and is not this.

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
