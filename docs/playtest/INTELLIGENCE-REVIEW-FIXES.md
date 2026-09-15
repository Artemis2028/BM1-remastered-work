# Intelligence review corrections

Parent: `b81d9a5fc955e0db28251c9ff88a8329f2d14c85`, tree `8530f4ad794d6ebe9ed08a782927c0f8b566f6b2`. This follow-up addresses the independent review and Rafael's subsequent instruction that a mistaken attribution can name anyone, regardless of reach or current diplomacy. Prepared for review; nothing pushed or merged.

## Disable-grace repair regression

The floating-point adjustment at the disable threshold now uses a local `crossedDisableBand` flag for this hit. An old grace timer cannot clamp a repaired operational ship back into the band. The timer, normal three-second disabled protection, paid recovery path and ordinary damage conversion remain unchanged.

The regression first disables the actual player ship, then calls each shipped debug control (`repair` and `hull 100`) while the original timer is still running, removes shields and applies one combat damage unit. In both cases the Miranda remains operational at **99.89989989989989%** hull, matching the no-clamp expected result. The existing small-hull band, save/load and post-grace destruction tests remain intact.

## Any faction can be falsely accused

The geographical mistaken-identity filter has been removed, superseding the initial proposal to repair its route lookup and add recent incursion history. `intelIdentityCandidates()` supplies all **20 named faction keys**, including peaceful, allied, distant and dormant factions. Generic neutral traffic is not a named faction and is excluded.

The pool does not depend on travel routes, current wars or spawnable hulls. It works before the map is opened and remains identical after routes are built. This resolves the empty initial pool by eliminating the dependency. No incursion-history storage or two-hop reach rule was added.

This changes allegations, not deployment permission. A report can incorrectly accuse the Borg, Gorn, a trading partner or the player's own faction. It cannot spawn their ships, activate a dormant faction, change standing or start a war. Existing crisis/war events still govern diplomacy. Turning accusations into investigations, protests or escalation is a possible later feature, not implemented here.

The discovery gate remains on **locations**: faction names can appear even when their homeworld is unvisited, but no unknown system location, index or governor is disclosed. Existing field reports keep their saved claims. Report timing, reliability distributions, age penalty, fleet-presence advantage and save/load repeatability are unchanged. The seeded model still produces **5,901 civilian / 8,786 fleet** correct classifications out of 10,000 observations per source.

## Local encounter facts and field assessments

Immediate local attack entries now use **Local fleet attack / Local encounter record**, with the number of ships actually spawned, the attacking faction and the current system. They explicitly leave wider objectives unconfirmed. The archive therefore agrees with the existing live arrival herald and local encounter instead of randomly relabeling that attack as reconnaissance.

Delayed civilian and fleet assessments remain fallible, including assessments from player fleet presence. This distinction preserves uncertain intelligence without making the encounter log contradict the attack just generated. The browser regression drives 40 real local attack spawns and verifies each archived count and record category.

`spawnFleetAttack` now rejects an explicit non-current system index, because its runtime actor creation operates only in the loaded system. Missing observations in `makeIntelReport` return `null`; the collection caller skips missing reports. No offscreen battle simulation was added.

## Smaller review corrections

- Fleet-manager plans now use the open service channel for browsing, so stock remains visible beyond transporter range. Purchase eligibility still checks transfer range; plan status gives the actual range message. No funds are spent by browsing.
- The intelligence PRNG wraps its state to signed 32 bits on every draw. Existing short seeded sequences and the 20,000-observation sample remain unchanged.
- Local scout lookup calculates the prefix once per call and avoids converting each NPC identifier to a new string.
- Cache version advances to `20260915-intelligence-review-v3`.

The incoming-hail panel overlap noted in the non-blocking ledger remains open; this patch does not claim a HUD layout correction. Arrival spacing, freight rates, transporter radius, repair prices and NPC deployment rules are unchanged.

## Validation

Chromium 153.0.8010.0, Linux. Browser test exports remain injected only into served responses.

| Gate | Passing checks/groups | Runtime |
| --- | ---: | --- |
| Intelligence follow-up | **11** (previous 7 plus 4 regressions) | Built release |
| Captain briefing | 13 | Built release |
| Behavior | 79 | Built release |
| Fleets | 91 | Built release |
| Playtest | 22 | Built release |
| Sensors | 54 | Built release |
| Hull merges | 23 | Built release |
| EW | 33 | Source, hash-matched to release |
| Anti-jam seeker | 38 | Source, hash-matched to release |
| Intelligence model | 20,000 seeded assessments | Pure module |

All ten commands must exit 0 **and** produce their expected passing counts/completion markers before packaging. The four added browser groups cover debug repair with a live timer; global identity availability before routes, missing observations and unchanged diplomacy; 40 factual local attack records; and distant fleet-plan browsing with range refusal. The existing regional-pool expectation was updated to the explicitly approved global pool; discovery and hidden-region assertions remain.

All final gates meet those criteria. One initial parallel playtest run failed its fixed 5.5-second recovery assertion (the ship was still disabled); the full unmodified suite passed all 22 groups when run alone. Both logs are retained. The specific cause of that non-reproduced failure is not established; the isolated pass is not a timing-performance claim.

Build, diff checks, bundle verification, incremental patch replay, unchanged ancestor pins and source/release runtime hashes are included in the handoff. No native iPad/Safari, duel win-rate study, long economy session or EW performance campaign is claimed.
