# Reviewed roster integration and ship economy

The faction-wide economy rules below remain in force. For the latest per-hull
prices, capabilities, standing gates and equipment, use the
[full-roster balance review](ship-balance/BALANCE-REVIEW.md).

12 September 2026. Built on PR #2 head `e869e0b97bf5429758e541d7c5fa8f9be3301d63`,
whose base is the pushed Phase 3 head `c0fbcb59d0a35d673a307ca2bcda5253cf21d778`.

The 13 September roster revision is documented in `APPROVED-HULL-MERGES.md`.
It consolidates 38 duplicates, preserves the economy rules below and updates the
Bird of Prey to 75 hull / 60 shields to fit the retained early Klingon progression.
The bundle comparison below records the original 12 September review.

## Review of Claude's bundle

The supplied bundle points to `8441e9cc41e878f2f82d1e3ad468e1c5abcd002b`.
It imports cleanly with the real c0fbcb5 prerequisite. The supplied range has
11 commits, 128 changed paths, and no additional Phase 3 behavior-probe changes.
It is useful source material, but applying its roster over ours would undo
decisions in this conversation.

| Area | Claude's bundle | This integration |
|---|---|---|
| Dominion Cruiser | Present as 192; it is not missing | Keep our 216 and core-region availability |
| BM2 variants | Imports 94 BM2-only hulls, merges 58 shared hulls | Keep our distinct reviewed BM2 variants and all 152 source mappings |
| Vulcan Explorer | Retains 26 | Retire new use of 26; retain 211 |
| Excalibur / extra hull IDs | 197–199; Bird of Prey 152 | Keep our 347–351; no duplicate hulls |
| Independent megaship | Latest bundle correctly calls 60 Concord | Keep separate Concord 60, Galaxy Dreadnaught 49 and Excalibur 347 |
| Purchase trust | Adds `requiredStanding` only to the personal purchase check | Common faction-standing gate for personal, escort and garrison purchases |
| Art / scale | Native Flash sizing multiplied by 0.75; many PSD replacements | Keep our approved art and existing envelopes; borrow the faithful nose-up Bird of Prey PSD master for 351 |
| Gorn | Manifest imports mark the three Gorn hulls traffic eligible | Keep our reserved Gorn availability; no routine spawns or sales |
| Station stock | Rewrites stock through its own ID map | Translate stock into our IDs, retaining original BM1 stock where intended |
| Station effects | Documents scaffold, bees and repair rules as queued | Still queued; no station service/effect changes implied |

Claude's c0fbcb5 fast-forward history is valid. The concern is conflicting
content choices, not a broken Git bundle. Its test claim does not validate our
different IDs, stock, prices or equipment semantics.

## Purchase model — revised by the user

Faction standing follows the captain across regions. A Terran design uses
Terran standing wherever it is sold. Raising a flag does not grant trust, and
holding a system does not grant an exemption. Local yards still determine
which designs are stocked. Existing port hostility, checkpoint clearance,
funds, cargo and fleet capacity checks still apply.

Independent designs use the existing `neutral` standing entry, labelled
**independent trade standing** in the purchase UI. This is a commercial trust
score, not a shared political side for independent ships or worlds.

| Tier | Standing |
|---|---:|
| Open | 0 |
| Trusted | 15 |
| Respected | 30 |
| Military | 50 |
| Strategic | 75 |
| Excalibur / Concord | 100 |

The first five thresholds and earning rates are initial tuning, not final
difficulty balance. New games start with 20 standing with the chosen faction.
Other factions start at zero. Completed cargo contracts grant +5 with the
destination's controlling faction and +2 with the issuer when different.
Player holdings use their origin faction for this reward; private sellers build
independent trade trust. Foreign concessions record their own employer faction
when the contract is created. Custom governments are not silently mapped to
independent trade standing. A consumed contract cannot award again. Ordinary buy/sell trading
only builds standing up to 15, preventing same-shop trade cycling from buying
access to capital ships. Existing attributed-combat standing remains in place.

The local-world-prestige placeholder from PR #2 is removed. No parallel prestige
ledger or legacy-save migration is introduced.

## Approved balance figures

The price, threshold, hull, shields and cargo figures below carry forward the
accepted proposal; the thresholds now mean faction standing.

| ID | Hull | Latinum | Standing | Hull | Shields | Cargo |
|---|---|---:|---:|---:|---:|---:|
| 60 | Concord-class Grand Cruiser | 1,050,000 | 100 independent trade | 6,500 | 8,000 | 10,000 |
| 347 | Excalibur Class | 1,500,000 | 100 Terran | 9,000 | 12,000 | 5,000 |
| 348 | Andorian Cargo Shuttle | 3,200 | 0 Andorian | 60 | 75 | 80 |
| 349 | Utility Shuttle | 2,200 | 0 independent trade | 40 | 60 | 35 |
| 350 | Basic Shuttle | 900 | 0 independent trade | 25 | 25 | 20 |
| 351 | Klingon Bird of Prey | 9,000 | 15 Klingon | 75 | 60 | 35 |

Handling, fuel use, starter equipment and the five previously unset drawing
envelopes are first-pass tuning. The existing reviewed envelopes remain exact.
The Bird of Prey uses a 40-unit long side; Excalibur 210; the three shuttles
34/20/18. Aspect ratios follow their art. The utility shuttle's original design
origin remains unknown; independent service is provisional.

The rest of the roster retains its imported combat and price baseline. This
patch does not claim a complete economic rebalance of every imported hull.

## Equipment and availability

- Three weapon/device slots remain. The Andorian Cargo, Utility and Basic
  shuttles start with three empty slots and can buy/equip compatible weapons.
- Normalization, rendering and loading a save do not create free weapons or
  refill an intentionally empty slot. Existing inventory can remain in storage.
- An unarmed NPC cannot shoot or create firing evidence. It does not count as
  an armed fleet defender. Imported BM2 loadouts use BM2 source IDs.
- X-Base at Paso stocks Galaxy Dreadnaught 49 and Excalibur 347.
- Free Swiss Reserve Exchange stocks Concord 60. Swiss Miss also sells the
  two basic independent shuttles; Andorian yards stock the cargo shuttle.
- The new Klingon Bird of Prey joins starter yards, between B'rel and K'Vort.
- Blender's planetary stock is only the catalog's Dominion scouts/fighters.
  Heavy Dominion designs are available in the Dominica core, including
  battlecruiser 48 without visiting Blender. Core-region purchases work at
  Vortara and the other recognized core systems.
- Reman Starbase in Remus can sell 53 through the real restricted-vendor path.
  The recoverable blueprint/mission route is still future work.
- Generic stock fallback cannot introduce forbidden-region ships. Locked
  designs remain visible at the proper vendor; money cannot bypass standing.

## Validation

Verified on this delivery:

| Check | Result |
|---|---:|
| Catalog/content helpers | 14/14 |
| Catalog integration | 11/11 |
| Live catalog smoke | 16/16 |
| Live purchase/equipment economy | 30/30 |
| Existing S1–S5 behavior probe | 79/79 |
| JavaScript syntax / patch whitespace | Clean |
| Web release / Chrome extension build | Passed |

The exact PR #2 baseline also passed the existing 79-case probe before the
integration changes. Browser probes were run in headless Chromium with the
available local Playwright runtime; no test-only dependency change is included.

```sh
node --check src/main.js
npm run validate:ships
npm run test:ships
npm run test:ships:ingame
npm run test:ships:economy
npm run probe
npm run build
```

The live economy probe exercises actual purchases, empty-slot preservation,
buying/equipping/firing a weapon, cargo delivery, repeat-reward prevention,
regional stock, faction-wide trust, save/reload and purchase UI. It adds no
export shim to the shipped engine; the test server injects it in transit.

S1d's projectile-credit fixture now pins the victim at its launch position.
That acceptance case checks attribution, while S2 independently covers pursuit
and range; incidental evasive movement should not turn a credit test into a miss.

## Still separate work

Boarding/capture and fleet command transfer; away-team XP and losses; utility
slots for flags/passes; the consolidated weapon data update; repair capability
rules and repair-arm overlays; construction scaffolds/workbees; independent
worlds/civil wars; and recoverable Reman access. These are not silently included
in the roster integration.
