# BM1 briefing/cargo — independent review of 5461f55, plus the campaign/stations proposal

Reviewed 15 September 2026. Candidate not modified, nothing pushed, nothing merged.
Prior reviews: `claude/BM1-INTELLIGENCE-REVIEW-FIXES-REVIEW-6ee0c2f.md`,
`claude/BM1-INTELLIGENCE-FOLLOWUP-REVIEW-b81d9a5.md`,
`claude/BM1-CAPTAINS-BRIEFING-REVIEW-72b4cfa.md`.

**Verdict on the code: no blockers.** Every claim reproduces, all twelve gates pass, and the
four fixture changes are genuine repairs rather than weakened assertions — I proved one of them
load-bearing by deleting it and watching the suite fail. One decision is worth registering (the
cloaked-delivery bypass) and one small inconsistency is worth a line of code.

**Verdict on the proposal: sound and unusually well grounded** — the 269-row station audit matches
the shipped data with zero discrepancies and uses the corrected index convention. Its migration
list is incomplete in one direction and over-broad in another, and two points sit against settled
decisions on file.

---

# Part A — the code candidate

## 1. Identity and integrity — 0 discrepancies

| Check Result                  |                                                                                                     |
| ----------------------------- | --------------------------------------------------------------------------------------------------- |
| `sha256sum -c SHA256SUMS.txt` | 28/28 OK; only `SHA256SUMS.txt` itself uncovered                                                    |
| `git bundle verify`           | okay; contains `5461f55`, requires `04abbfc`                                                        |
| Candidate / tree              | `5461f55228965fa250d369c833b5b8d2f10eb7cb` / `006826b5fe5f6dae0ca10f073f47019fbbcd0b71` — as stated |
| Parent / parent tree          | `6ee0c2f…` / `196c7712…` — as stated                                                                |
| Patch replay on `6ee0c2f`     | produces tree `006826b5…` exactly                                                                   |
| Commits added                 | exactly one                                                                                         |
| Eight `unchanged_ancestors`   | all present as ancestors at the stated ids                                                          |

## 2. Build and gates — all twelve reproduced

All **seven** runtime files hash-match `RESULTS.json` byte for byte.

| Gate Claimed Reproduced Exit  |               |           |   |
| ----------------------------- | ------------- | --------- | - |
| Briefing/cargo (new)          | 7 groups      | 7 groups  | 0 |
| World model (pure)            | 7 groups      | 7 groups  | 0 |
| Intelligence model (pure)     | 5,901 / 8,786 | identical | 0 |
| Intelligence follow-up        | 11            | 11        | 0 |
| Captain briefing              | 13            | 13        | 0 |
| Behavior                      | 79            | 79        | 0 |
| Fleets                        | 91            | 91        | 0 |
| Playtest                      | 22 groups     | 22 groups | 0 |
| Sensors                       | 54            | 54        | 0 |
| Hull merges                   | 23            | 23        | 0 |
| Electronic warfare            | 33            | 33        | 0 |
| Anti-jam seeker               | 38            | 38        | 0 |

No page errors. Host: Chromium 141, 2-core Xeon. Functional only.

## 3. The fixture changes — examined individually

The security radius moved from 560–1,100 to 1,400–2,600, which is exactly the kind of change that
can quietly loosen a suite. All four edits hold up:

- **`ship-sensors-probe.mjs`** **— restoring the observer after the geometry tour.** I deleted the added `B.setCamera(at.x, at.y)` line in a scratch worktree and reran: the suite **fails**. The line is a load-bearing repair for the new arrival distances, not a mask.
- **`behavior-probe.mjs`** **S1d —** **`escort.heading = 90`****.** The assertion is untouched, and the outcome is byte-identical to the parent: `shotOwner: npc`, `shotCredit: playerEscort`, `lastDamageSource: playerEscort`, `latinumDelta: 34`, `standingDelta: -4`. The fixture restored the original result rather than changing what is proved.
- **`behavior-probe.mjs`** **S5.5 — moving the escort next to the visitor.** The wider perimeter had put the visitor beyond weapon range, so the aggression precondition could no longer occur. Repositioning restores it; the "stale evidence grants nothing" half is unaffected by position.
- **`behavior-probe.mjs`** **S5.0 — radius bounds 560–1,100 → 1,400–2,600.** Tracks the shipped constants; the rest of the assertion is unchanged. Observed radius 2,600, hold 2,080 (0.8×).
- **`captains-briefing-probe.cjs`** **— approaching the world before the debug transport.** Matches a shipped rule (away missions now need 600 units) and still asserts `docked === false`.

## 4. Behaviour verified independently

| Property Measured                      |                                                                                                           |
| -------------------------------------- | --------------------------------------------------------------------------------------------------------- |
| Background reports per jump            | capped at **6** with 30 eligible                                                                          |
| Personal reports per jump              | **12 of 12** shown — uncapped                                                                             |
| Second jump after reading the first    | 6 **different** background reports, no repeats, overflow reached                                          |
| Cargo drop-off boundary                | ok at 599 and at exactly **600**; refused at 601 and 2,400 (inclusive, like the 2,500 transporter gate)   |
| Checkpoint zones                       | 35 (unchanged count); radii 1,400 / 1,460 / 1,660 / 1,860 / 1,866 / 2,060 / 2,460 / 2,600 — all in bounds |
| Arrival, unzoned                       | 66 systems, **all exactly 1,800** (unchanged)                                                             |
| Arrival, zoned                         | **2,000–3,200**, every one outside its own perimeter and above the 600-unit drop-off                      |
| New per-frame delivery poll            | **0.82 µs** per call with 22 cargo pods — 0.005% of a 60 fps frame                                        |
| Discovery leaks over 200 campaign days | **0** (see the note below)                                                                                |

**A correction to my own first pass.** A crude substring check reported one "text leak". It was an
artifact of my test: eight faction display names contain a planet name as a substring — Vulcan,
Cardassian, Tholian, Bajoran, Delpin, Tarellian, Andorian, Gorn. Re-run with that accounted for,
**zero** report texts across 200 days contain an unvisited system's name, explained or otherwise.
There is no leak.

**The covert delivery is tightly scoped.** At wartime Qonos (Klingon Orbital Authority, radius
2,600, docking blocked), uncloaked delivery is refused; cloaked delivery succeeds, pays **4,000
once**, and a second attempt pays **0**. Afterwards the docking block is still present, no
clearance was granted, station service is still blocked and no security order was opened. The
bypass really is delivery-only, exactly as documented.

The expanded radio coverage is correspondingly narrow: `coverage` is non-zero only for the
checkpoint's own anchor station and equals anchor-to-centre distance + radius + 200, so it matches
the tracking footprint rather than widening reception generally. Cloaked senders are still excluded.

## 5. Findings

### A1 — the cloak bypass is a real economy decision, not just a security one (design)

A cloak now defeats a closed border for freight. Wartime destinations carry a **+100/ton hazard
supplement** precisely because "access is not guaranteed" — with a cloak it is guaranteed. At up to
20 tons that is +2,000 per run on top of base pay, with the checkpoint left intact and no other
consequence. The cloak is a device item with a duration, so it is not free, but it converts the
riskiest, best-paying contracts into the safest ones.

Worth noting too that the refusal message advertises the route: "A cloaked cargo drop-off is
possible at the world." That is a defensible UX choice, but it is the game telling the player how
to beat the blockade.

Not a defect — you asked for the bypass. It belongs on the ledger alongside the freight rates,
because the two multiply.

### A2 — the two "Deliver" affordances now diverge (small)

The top-left HUD "Deliver" was changed to call `deliverDestinationCargoAtCurrentPlanet({manual:true})`;
the docked planet-menu "Deliver" still calls `tradeAtPlanet()`. Verified: with ordinary
(non-contract) cargo aboard and the ship 100 units from the world, the HUD path answers "No cargo
is due at this world" and sells nothing, while the docked path would sell it. One line either way.

## 6. Ledger (non-blocking)

- `spawnFleetAttack`'s guard still compares `Number(systemIndex) !== state.currentPlanet`, coercing one side only (carried over from the last candidate).
- `renderGalaxyReports` marks whatever it renders as read, so paging through the archive consumes reports from the next jump's briefing. Defensible, but it means browsing has a cost the UI does not state.
- The incoming-hail layout overlap remains open, as stated.
- The playtest recovery assertion still uses a fixed 5,500 ms sleep against a 5,000 ms deadline. Running it isolated is a sound workaround; polling for `personalCondition` would remove the need.

---

# Part B — the campaign and stations proposal

## 7. The station audit is exact

I compared all 269 CSV rows against `data/stationData.json`:

| Field Mismatches    |           |
| ------------------- | --------- |
| station id present  | 0 missing |
| system index        | **0**     |
| type id             | **0**     |
| name                | **0**     |
| authored ship ids   | **0**     |
| authored weapon ids | **0**     |

36 distinct station types across 69 systems, matching the proposal's "36 station types, 269
placements". Every named claim checks out: exactly two type-89 arrays (Alpha Array at system 0,
Qonos Array at system 37); Vortara cloning Facility is a Trade Station model offering ship 345;
Swiss Relay Array is type 201 at system 5 carrying weapons 23 and 24.

**The index convention is right.** X-Base sits at system 4 with hulls 49 and 347, and Swiss Relay
Array at system 5 — matching the corrected zero-based `systemIndex` finding on file. The off-by-one
that bit an earlier review is not present here.

## 8. The migration list needs both a correction and an addition

The proposal's step 1 is "migrate every affected special item before closing inappropriate shops",
and it names Swiss Relay Array. Checking that against today's runtime rule
(`sell: !defense && (yard || maintenance || !!station.stockIds?.length)`):

**Already inert — no migration needed.** Defense platforms already sell nothing, so these authored
offers are dead data today and closing their shops changes nothing:

- TS-293 (system 8, Advanced Defense Platform) — hull 343
- Nova Yard Defence (system 54, Defense Platform) — hulls 228, 227, 230, 232

**Live hull vendors the proposal would close, which it does not enumerate — 5 stations, 13 offers:**

| Station System Type Hulls  |    |                 |                            |
| -------------------------- | -- | --------------- | -------------------------- |
| The Arboretum              | 3  | Habitat Station | 343, 237                   |
| Kathy's Pub                | 5  | Bar             | 1                          |
| Nausica Orbital            | 15 | Bar             | 11                         |
| Nova Bar                   | 54 | Bar             | 33, 326, 327, 328, 64, 228 |
| Brea Bar                   | 57 | Bar             | 60, 48, 238                |

These are authored per-station offers, which the v0.5 review established take priority over the
price-ranked fallback, so closing the shops removes reachable content unless the offers move first.

**On the weapon side the proposal is exactly right:** Swiss Relay Array (23, 24) is the only live
weapon vendor among the types it strips. Research labs keep weapon sales under its own table, and
the Subspace Comm arrays carry no stock at all.

## 9. Two points against settled decisions on file

- **"One ship market per system"** was settled on 14 September, and the corrected two-layer audit concluded the per-system pool must be the union of `planetData.shipStockIds` and each station's `stock.shipIds`. The proposal instead keeps "each vendor's currently eligible catalog as its base pool" and rotates "staggered by vendor". Those are different models; pick one before implementation, because the rotation bookkeeping differs.
- **"Vendor ship stock replenishes at random intervals"** was also settled; the proposal specifies "every 10 campaign days, staggered by vendor", which is a fixed schedule with a per-vendor phase offset. That may well be the better mechanic — it is testable and cannot be save-scummed — but it is a change to a recorded decision and should be re-confirmed rather than assumed.

Separately, the licence-recovery path says a recovered design "still costs money and obeys
eligibility" without naming the settled rule that hull plans cost **4× the hull price** and require
**one standing tier above the purchase gate**. Worth pinning so recovery cannot undercut it.

## 10. What the proposal gets right and should keep

It respects the decisions that matter most: Gorn services, stock and recovery contracts stay behind
the existing dormant/discovery gate ("Neither proves a living Gorn population before the discovery
event"); controller, original culture and individual station owner stay distinct; conquest gives
access to surviving industry without erasing private concessions; and campaign triggers read
persistent events rather than generated report text, which preserves the intelligence/reality
boundary from the last three rounds. Its own acceptance list — no menu/save/jump reroll, every
currently obtainable design stays obtainable, no unknown-location report leak, identical books for
daily and bulk advances — is the right shape and matches what these reviews have been testing.

The three-book split (economic capacity, production capacity, ready military strength) with an
explicit refusal to collapse them into one score is the strongest idea in the document, and the
warning that "a rich faction with wrecked yards cannot replace a fleet" is the sentence to build the
acceptance tests around.

## 11. Not verified

- No native iPad/Safari run, no duel win-rate study, no economy campaign, no EW performance campaign — as stated.
- The proposal's tuning numbers (1.2–1.3 : 1.0 strength ratio, 1.7 : 1 for 20 days, 60-day and 65% invasion gates, 10-day rotation, 3–5 designs) are unmeasured by construction; nothing in this review tests them.
- Chromium 141 on a 2-core host, not Chromium 153. Functional gates only.