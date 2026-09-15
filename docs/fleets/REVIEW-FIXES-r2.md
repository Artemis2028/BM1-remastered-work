# Fleet review fixes after f418161

Status: candidate for independent review, not merged. Base: EW integration
`04abbfc7e1d28e5178ba353a781aaa9e53dcc4d9`. Prior fleet review:
`f418161b1d0f84aff668c7e5c421a61a66468e73`. Historical bundle pins stay unchanged.

## Changes and regression coverage

- Campaign IDs use `crypto.randomUUID` when available and a 128-bit
  `crypto.getRandomValues` fallback on insecure HTTP origins. The release-build
  probe starts the game with native `isSecureContext === false`, no randomUUID,
  and an available getRandomValues. No crypto API is mocked in that check.
- Station completion updates definitions on the actual economic due day, while
  the live system rebuild waits for arrival. Completed-project notices accumulate
  during transit and appear once on arrival. Fleet deliveries and journeys also
  avoid spawning origin-system actors during the player's warp.
- Planet-authored hull lists retain all canonical, eligible entries. Existing
  station-specific lists and their existing eight-entry display limit are
  preserved. Shared system quantities do not broaden a vendor's authored list.
  The five audited raw lists contain 18/16/15/14/10 IDs; canonicalization and
  existing eligibility rules yield 9/6/9/9/7 hulls. The test compares those full
  eligible sets, rather than promising that every raw ID is a distinct saleable
  hull. The curated `[49, 347]` station regression remains green.
- EW and sensor purchases report arrears or unavailable local refit explicitly,
  without spending funds on refusal.
- A finite nonpositive NPC hull enters the existing destruction transition once.
  Damage, targeting, power and AI callers stop processing the destroyed actor.
  The separate station initialization path is unchanged.
- Vessel restoration applies remaining weapon cooldown through the shared
  helper, including ordinary restore, prize restore and command transfer.
- Cancelling a boarding deployment cannot reroll the same target incarnation
  with the same team XP. New operations use the campaign, target and XP for the
  deterministic roll. Already-saved operations retain their recorded outcome.
- Smoke-test `tmp-*.png` files are ignored rather than committed.

## Financial history and saves

The book retains 128 recent entries plus every entry in the current open day.
Older closed-day entries become totals by kind, retaining amount, paid amount
and entry count. Compaction does not change cash, arrears, owned vessels or
orders. Thus current-day size can still grow with fleet activity; this is not an
ownership limit.

A saved closed-day watermark rejects replay of old bills. Recent IDs use a Set
rebuilt after load or compaction. Generated journey IDs use a saved monotonic
counter instead of one permanent record per jump. Existing nonstandard legacy
journey IDs remain in a read-only compatibility set. New calendar calls require
an ID from `nextId(book, 'journey')` (the engine's existing convention).

Migration retains balances and debt, summarizes old entries, and raises counters
past recorded events. Model checks exercise 600 jumps, accounting conservation,
old-journey replay, reload, same-day financial replay and legacy migration. The
serialized book in the 600-jump fixture stays below 25 KB.

Slot 1 now writes one canonical payload. Legacy saves remain readable; the old
duplicate key is removed only after the canonical write succeeds. Failed writes
return false and report a storage failure while preserving the previous slot.
The live suite checks both quota failure and legacy-only loading.

## Validation on the recovered source tree

All 20 validation commands passed, including both release builders:

| Suite | Result |
| --- | --- |
| Fleet model / live | 31/31 / 91/91 |
| EW model / live | 20/20 / 33/33 |
| Seeker model / live | 14/14 / 38/38 |
| Sensors model / live | 26/26 / 54/54 |
| Power model / live | 21/21 / 29/29 |
| Ships validate / integration / live smoke | 14/14 / 11/11 / 16 pass |
| Ship merges / balance / economy | 23/23 / 19/19 / 30/30 |
| Behavior probe | 79/79 |
| Manifest | Clean |
| Node / Python build | Both passed |
| Release-build insecure-HTTP fleet probe | 91/91 |

The execution environment was recovered from the saved f418161 bundle, then
these changes and all listed validation were rerun. Evidence contains the new
logs; no result from the lost working session is substituted.

Browser runs used a disclosed external Playwright preload and serverless
Chromium 153.0.8010.0 on an AMD EPYC 9V74 host (9 logical CPUs/concurrency 9).
The insecure-origin probe uses `http://bm1-lan.test` with request transport
forwarded by Playwright to the local static server. This exercises native
browser origin security, not a physical LAN connection or iPad/Safari. It is
not a performance acceptance run, and makes no Platinum claim.

## Decisions and limitations still open

Personal hull repair pricing is deliberately unchanged from f418161: a full
repair costs 50% of hull purchase price (19,500 L for the starter Miranda).
Shield service remains 1 L per percentage point, with the combined service's
guards, feedback and stats refresh covered. The user has not separately chosen
a personal-repair rebalance. Making only the commanded ship cheap to repair
would also allow a damaged prize to be transferred into command, repaired
cheaply, then sold; any pricing change must address that path explicitly.

The recovered Flash mass-based daily upkeep rule is retained. The proposed
route conversion `ceil(distance / 10)` remains tuning, rather than an exact
reproduction of Flash's `floor(distance)` calendar; it can produce roughly a
tenfold difference on long routes. No new rate is silently adopted here.

Native confirmation-dialog UX, fleet-manager visual polish, wider fleet scaling,
iPad/Safari playtest and the separate station-zero-hull initialization issue
remain review/playtest items. This follow-up does not authorize a main merge.
