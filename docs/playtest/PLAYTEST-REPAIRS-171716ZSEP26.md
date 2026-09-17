# BM1 playtest repairs on top of `ae4ae4d`

DTG 171716ZSEP26

Parent: `ae4ae4d` (Patch 1, DTG 171325ZSEP26) — untouched. Nothing pushed, merged or deployed.
The commit count is in `CANDIDATE.json`, computed by the pack script rather than typed here: the two
previous packs each stated a count that was wrong.

## Read this first

This is the third repair round. The review of `c1c5843` kept it as the base, confirmed the farm, the
stale evidence identity and the wrong hop label all closed, and raised one material finding and two
validation gaps. All three are closed here.

**One warp counted as two journeys.** The journeys category counted calls to the calendar wrapper
rather than journeys the fleet ledger accepted. An ordinary warp calls it twice with the same persisted
id, and the counter moved before the ledger was asked, so thirteen warps recorded twenty-six and passed
a threshold of twenty-five. The review's arithmetic was exact. The increment now happens after the
ledger accepts, and only for a positive-day call.

**The shipped eight-hop boundary was untested.** The previous round proved the comparison at four and
three because the authored galaxy is not eight hops wide. A corridor of empty systems is now built to
put a navy at exactly eight hops and exactly nine, and the shipped value is tested where it decides.

**The evidence claim was overstated.** `RUN.json` hashed seven paths while the handoff said it hashed
every file the suite exercises. It now hashes every git-tracked file and every file under `dist/`, and
the claim matches the mechanism.

Most of the 17SEP specification is still **not** here — §3.3 bilateral peace, §3.4 cargo and contracts,
§3.5 uninhabited worlds, §3.6 HUD and modals, §4 fleet trading, §5 recall, §6 repair UX, §7 overlay.
`CANDIDATE.json` lists every section under `spec_17sep` with DONE / PARTIAL / NOT DONE.

## The second and third rounds' findings

### A. The maturity gate could be satisfied by cycling one menu *(round 2)*

Every successful press of "request contract" incremented `contractsOffered`, and that counter was
simply added to the systems visited. Two hundred presses at one station cost nothing and carried the
whole gate.

It is now **categories, not a total**, and each one is a set or a capped tally of something that costs
the captain a journey, a docking or a destination:

| Category | What it counts | Needs |
| --- | --- | --- |
| `systemsVisited` | distinct worlds seen | 10 |
| `journeys` | journeys the fleet ledger accepted, capped at 400 | 25 |
| `issuers` | distinct stations or worlds that have offered the captain work | 6 |
| `contacts` | distinct powers whose service channel they have opened, by docking or by hail | 3 |

**Three of the four** must be met. Rerolling a destination at one station is the same issuer, so two
hundred presses move exactly one count by exactly one and never again.

The constraint on what may be counted here has not changed: only things the player does, and only
things a jump cannot change while it is running. Nothing the campaign itself increments is eligible,
which is why station missions stayed out.

**Gate DOM-7:** two hundred presses at one station, with no day passing, move the maturity counts by at
most two and satisfy fewer than the required number of kinds. **Matrix invariant:** each category is
pushed to a hundred times its own threshold *on its own*, and none of them alone opens the door.

### D. One warp counted as two journeys *(round 3)*

The journeys category counted calls to the calendar wrapper rather than journeys the fleet ledger
accepted. An ordinary warp calls it **twice with the same persisted id** — once when the mid-jump
briefing opens, once on arrival — and the second call correctly advances no day and charges nothing,
but the counter had already moved before asking. Thirteen warps recorded twenty-six journeys and passed
a threshold of twenty-five, halving the travel the gate was meant to require. A zero-day call counted
as a journey too, and the reload path makes one of those.

The increment now happens **after** `Fleet.advanceCalendar` returns, only when it accepted the journey
and only when days were actually requested. The category counts what the candidate said it counted.

**Gate DOM-8:** one id presented twice counts once; a zero-day call counts nothing; thirteen ordinary
warps — each presented the way the engine presents one, briefing then arrival — record thirteen
journeys and do not reach the threshold, with the days elapsed proving each warp advanced its own days
exactly once.

### B. The evidence did not name the tree it came from *(round 2, widened in round 3)*

`run-gates.sh` refuses to run against a dirty working tree, and writes `validation/RUN.json` and
`validation/RUN-FILES.txt` before the first gate. `RESULTS.json` takes its candidate from that file
rather than asking git when the manifest happens to be generated; `make-pack.sh` refuses to build a
pack whose `RUN.json` or `RESULTS.json` names a commit other than the one being shipped.

Round 2 hashed seven paths and the handoff described that as every file the suite exercises, which was
not true: the gates import dozens of tracked modules and serve hundreds of built files.
`RUN-FILES.txt` now hashes **every git-tracked file in the repository and every file under `dist/`**,
and `RUN.json` carries the counts and a digest of it.

`.commit-count` was a pack file sitting outside the checksum manifest. It is gone; the count is passed
to the cover sheets directly.

### C. The contender distance was a label, not a measurement *(round 2, completed in round 3)*

The matrix check asks the fixture's own route graph how far Romulus is from the entry, prints the
answer, and asserts the navy is a contender at exactly that hop count and is not one at one hop less.

Round 2 could only show the comparison working at four and three, because the authored galaxy is not
eight hops wide, and the shipped limit is eight. A second check now **builds a corridor of empty
systems** long enough to put a navy at exactly eight hops and at exactly nine, measures the result
rather than assuming it, and tests the shipped value where it actually decides: at eight the navy is a
contender and the opening closes; at nine it is not and the opening returns.

## The six findings from the first review round


### 1. A long jump could consume the whole arc

Reproduced: missing patrols on day 266, staging signatures on 306 and the invasion on 331, all inside
one calendar advance and all in the same mid-jump briefing.

A phase may now become **eligible** at any point during a jump, but only one may **commit** per beat. A
beat is the journey when the engine is running one, and the day itself otherwise — which is what keeps
stepped and bulk advancement identical, since a day-by-day run has one beat per day either way. The
engine puts the journey id on the campaign's world view for the duration of `advanceFleetCalendar`.

The check that decides this is re-read after every commit rather than captured once for the day. The
first implementation captured it once, and all three stages still cascaded inside a single call — the
gate caught it.

**Gate: DOM-6.** Four two-hundred-day jumps with every dwell set to zero advance the arc exactly one
stage each: `dormant→reconnaissance`, `reconnaissance→staging`, `staging→invasion`, `invasion→invasion`,
with at most one new Dominion warning per jump.

### 2. There was no player-opportunity gate

There is now, and it is what replaced the calendar floor rather than sitting beside it. The first
version of it was a single additive counter and the second review showed it was farmable; **see finding
A above for what it is now.** The principle is unchanged and was right: count chances the game put in
front of the captain, never anything they achieved, so a captain who takes none of it is protected
exactly as much as one who takes all of it.

Travel does not accumulate it. Visiting a **new** system counts once; flying back and forth between two
systems for four hundred days counts nothing.

### 3. Economic and industrial condition was not considered

Reproduced: identical factions at maximum treasury and at bankruptcy returned the same open
opportunity.

A war that cost hulls and nothing else is a war somebody can still fight. A worn-down power now has to
be strained where wars are actually won — **revenue**, **treasury** or **berths**, any one of them below
`dominionEconomicStrain` of that polity's own high-water mark. Three because a power can be broke, or
blockaded out of its revenue, or have lost its yards, and each is a different way of being unable to
replace what the expedition will take off it. The high-water marks are recorded daily alongside the
readiness one.

**Matrix evidence:** the `solvent` and `bankrupt` columns of every row. Identical fleets and identical
war history, one side broke and one rich, now decide differently, and the solvent row says why.

### 4. Contenders were a hand-written list, and resistance was not re-evaluated

Reproduced twice: an 18,000-strength Romulan power was excluded from the near-side set because it was
not one of the five names the model looked at; and a 6,300-strength player empire that appeared after
reconnaissance made `challengeable` false without standing the expedition down.

Membership is now **reach**: any polity holding ground within `dominionContenderHops` route-hops of the
entry system, plus the central belligerents because the war that made the opening is theirs, plus the
player on the same terms. And the stand-down now fires on `!challengeable` as well as on recovery and
on the corridor, so a contender that appears mid-arc sends the expedition home.

**Matrix evidence:** a `distant-romulan` column across every row; the contender set is printed.

### 5. The accumulated weight did not reject wobbling

The review's arithmetic is right: `+1 / −0.5` has positive growth whenever the condition holds more
than a third of the time, so an alternating condition reached 30 after 120 days.

It is now a **bounded rolling window**: the last `dominionOpeningWindowDays` days of eligibility, of
which `dominionOpeningSustainDays` must have been eligible. Alternating gives exactly half a window and
half is not enough; a case eligible two days in three passes. The window cannot accumulate past its own
length, and a near side that starts recovering walks the count down as the good days age out.

**Matrix evidence:** an invariant that runs 4,000 days of three patterns — alternating, two-in-three,
and always — through the same window arithmetic and asserts the first never unlocks, the second does,
and the count never exceeds the window.

### 6. "No date anywhere" was false

It was: `dominionEarliestDay` was 120, and the same strategic state was closed on day 119 and open on
day 120. The matrix sampled 200, 800 and 2,000 — all above the boundary — so the claim it printed was
untested where it could fail.

The floor is **removed**. Nothing in the expedition's rules is a campaign day. The matrix now samples
**1, 119, 120, 121, 800 and 2,000**, and asserts both that every history decides identically across all
six and, specifically, that the decision does not move across the boundary a floor used to sit on and
that a galaxy already in the opening state on **day 1** is not refused for being young.

The late-save migration no longer re-anchors anything, because there is nothing dated to re-anchor; it
records the shift for reference only.

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

Three commits now. The first moved the arc to a fixed 180/260/320 window, which stopped the reported
behaviour but is not what §3.1 asks for. The second removed the window. The third is the repair round
above. `dominionReconDay`, `dominionStagingDay`, `dominionInvasionDay` and `dominionEarliestDay` all no
longer exist: **there is no campaign day anywhere in the expedition's rules.**

`dominionOpportunity(book, world, day)` decides whether there is an opening, and reports why not. All
of the following must hold:

| Condition | Read from | Threshold |
| --- | --- | --- |
| a central war that has cost its belligerents something | a per-pair **war ledger** (`book.wars`) counting engagements that produced losses or a capture — kept because the operation list is trimmed | 20 engagements |
| a near-side power materially below its own capacity | `readiness / max(readinessBaseline, readinessPeak)`; the peak is recorded daily, so a player empire that started with nothing still has a capacity | ≤ 0.65 |
| ...and economically strained with it | the worst of `revenue`, `treasury` and `berths` against that polity's own high-water mark for each | ≤ 0.75 |
| a balance the expedition can exploit | either a costly stalemate — both belligerents worn down, bounded strength difference, and a front that has stopped moving — or a victor too weakened to hold the door | gap ≤ 0.5; victor ≤ 0.6 |
| nobody on this side still standing tall enough to make the crossing pointless | the strongest **contender** against what the Dominion can bring; contenders are every polity holding ground within 8 route-hops of the entry, the central belligerents, and the player | ≤ 1.5× its reach |
| a corridor nobody has closed | defence at the entry against the Dominion's own reach, never against the defender's size, so a garrison cannot inflate the yardstick it is judged by | ≥ 1.2× closes it |
| a captain who has been offered a game first | four bounded categories of chance offered — distinct worlds seen, completed journeys, distinct issuers of work, distinct powers dealt with — never achievements | 3 of 4 |

The case has to **hold**, not merely occur: a war's numbers move every day and one of those days will
clear every line at once. Eligibility is judged over a **bounded rolling window** — 60 of the last 90
days must have been eligible. Alternating gives half a window and half is not enough.

The stages are events, and each one has to reach the captain separately: at most one phase commits per
beat, a beat being the journey the engine is running or otherwise the day itself. Reconnaissance dwells
40 days, staging 25. At any point a near side that **recovers**, a contender that makes the crossing
unchallengeable, or a corridor somebody closes stands the expedition down where it is. Nothing expires
and nothing is forced through: there is no latest day either.

The debug phase override forces the opening rather than a timetable, so a forced phase is still entered
by the code that enters it in play.

**Tuning for sign-off:** 20 engagements, 0.65 capacity, 0.75 economic strain, 0.5 strength gap, 1.5
challenge ratio, 1.2 corridor ratio, 8 contender hops, 3 of 4 maturity categories (10 worlds, 25
journeys, 6 issuers, 3 contacts), 60 eligible days of the last 90, and 40/25-day dwells.

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

**35 of 35 green**, run from the committed tree this pack ships. `validation/RUN.json` and
`validation/RUN-FILES.txt` record which commit, which tree, and a hash of every git-tracked file and
every file under `dist/`, written before the first gate rather than inferred afterwards.

`playtest-gate` is 13 adversarial checks and **all thirteen reproduce on `ae4ae4d`** — see
`validation/playtest-gate-baseline-ae4ae4d.log`.

| Check | What it reproduces on `ae4ae4d` |
| --- | --- |
| DOM-1 | the Other Powers table listed the Dominion at a fresh start |
| DOM-2 | charting one hidden world presented the whole region's true strength as a total |
| DOM-3 | a near-side capture handed the expedition's war to the neighbour roll |
| DOM-4 | the expedition ran on a date, and sixty warp-days in it had already invaded |
| DOM-5 | 200 days of the roll settled the expedition's war with Earth |
| DOM-6 | one long jump carried the whole arc past the captain in a single briefing |
| DOM-7 | the maturity gate could be satisfied by cycling one menu at one station |
| DOM-8 | one warp counted as two journeys, and a zero-day call counted as one |
| REM-1 | there was no Blender remnant at all |
| REM-2 | the remnant drew from the whole Dominion pool |
| REM-3 | the remnant could not pay its upkeep and never replaced a loss |
| HAIL | a selected station answered "No ship selected to hail" |
| CULT | the planet card and map named only the controller |

Five of the thirteen check something the parent tree has no notion of at all — the remnant, the entry
decision, the maturity gate, the journey count, a world's people — so on `ae4ae4d` they reproduce by
reporting that absence rather than a wrong behaviour. Each of them says so in its own words ("this tree
has no entry decision to ask: the expedition runs on dominionReconDay, dominionStagingDay,
dominionInvasionDay"), not as a TypeError: an earlier version of this pack let three of them fail on
`undefined is not a function`, which is a stack trace rather than evidence. The other eight reproduce
the behaviour itself.

`dominion-matrix` is the §9 evidence for the entry decision: **432 rows** varying calendar age (1, 119,
120, 121, 800, 2,000) independently of war history, corridor state, third-party power and war economy,
printing the decision and its reason for every row, with **13 invariants** checked. The whole table is
in `validation/dominion-matrix.log`; it does not run at all on `ae4ae4d`.

The invariants, named:

1. calendar age is not an input, at every age including where a floor used to be
2. a quiet galaxy never opens, however old it gets
3. fighting without cost is not an opening; fighting that wore both sides down is
4. a front that is still moving is not a stalemate
5. a victor that is still standing closes the opening; a wrecked one presents it
6. a fortified entry closes the corridor whatever the war did
7. a solvent war economy closes the opening that a bankrupt one presents
8. a strong power several jumps away is a contender, and closes the opening
9. a player empire that has become the strongest power here delays the opening
10. contender membership is decided at the configured hop count, not near it
11. at the shipped limit, a navy at eight hops is a contender and one at nine is not
12. the opening waits on chances offered to the captain, and no single action can supply them
13. a condition that alternates never unlocks the arc, however long it alternates

Four of the repairs in this candidate were caught by gates rather than by inspection: the beat check
was captured once per day instead of re-read after each commit, so all three stages still cascaded
(DOM-6); counting station missions into the maturity total made the same sixteen days decide
differently stepped and jumped (EQUIV); counting journeys put a per-journey number into the persisted
campaign digest, so forty one-day journeys and one forty-day journey produced different books (the
campaign probe's daily-versus-chunked check); and the matrix's own fixture stopped satisfying the new
category gate the moment it changed.

`validation/gate-exit-codes.txt` records each gate's root honestly: `src` means it imports the source
modules directly, `dist` means it loaded the built tree.

## Against the 17SEP specification, section by section

Where it says NOT DONE, nothing exists: no stub, no scaffolding.

**§3.3 faction-blind war goals and bilateral peace is still NOT DONE, and this matters more than it
did.** The premature Terran–Dominion peace is prevented by locking the expedition out of ordinary
diplomacy, which means the Dominion currently cannot negotiate the later, properly justified settlement
either. There is no bilateral acceptance, no persisted war goals, no minimum time and engagement gates
for negotiation, no economic exhaustion input, no protected capitals, and no distinction between
ceasefire, armistice, negotiated peace, withdrawal, capitulation and strategic victory. The war ledger
added for the Dominion opening — engagements, losses and captures per belligerent pair, surviving the
operation list being trimmed — is the input that section will need, and it is now there.

**§3.1 Dominion opening** — **done.** No date, no deadline, no floor; entry emerges from the central
war's engagement history, the economic damage it did, the balance it produced, who can still answer a
crossing, whether the corridor is held, and whether the captain has been offered a game. What is *not*
done from §3.1's list: player-intervention effects are only those that fall out of the general rules
(keeping the near side's capacity up, keeping its economy working, fortifying the corridor, becoming a
contender) rather than a separately modelled set; and the warning texts still say what they said,
though they no longer name Dominion Central as fact before contact.

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
