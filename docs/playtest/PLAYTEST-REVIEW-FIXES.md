# Playtest review follow-up

Incremental correction of `d4079c4db4b996aad9f711b9ce0c1ceb79dd192b` (tree `10dbf1efca52e8118f35909677248f4b4a389442`). The accepted fleet/debug ancestors and prior candidate remain unchanged. This is a local review handoff, not a push or merge.

## Production fixes

- **Remote installation geometry:** only the ordinary local installation cluster participates in PT-17 role rings. Definitions whose authored offset exceeds 5,000 units retain the original orbit inference; explicit orbits and player-built placements are also preserved. Remote sites are excluded from local ring spacing. This restores X-Base at Paso, Reman Starbase at Remus, X-8, K21, K298 and The Sludge. Their authored offset lengths are approximately 14,142; 8,485; 7,071; 6,451; 6,630; and 6,578 units respectively. Those are source offsets, not constant distances to the moving player/planet.
- **Station construction:** remove the unused index argument from the shared ring helper. The two incremental station constructors previously referenced an undefined `i` when creating a non-player-built station. Both constructors now work with remote sites and preserve explicit orbits, including reconstruction definitions.
- **Default-start source leak:** remove the FLA hint lookup/log replacement from faction starts. All four starts keep the ordinary captain/ship/faction greeting. The regression waits for the actual FLA index to load before checking each start, so a slow or absent hint load cannot hide the leak. The diagnostic index itself still ships; its distribution policy is not changed here.
- **Player property targeting:** hostility toward the player, including independent attackers and opposition to the player's flag, can target player-owned stations. That hostility does not authorize attacks on unrelated foreign stations. The existing side/alignment guards remain.
- **Checkpoint persistence:** restore world visitors and prize participants before reconciling checkpoint orders. Reconciliation reapplies the saved participant details even when the restored visitor already has the matching incarnation. This retains the original order, objective, broadcast, physical state, approach time and dwell progress. Previously orders could be closed as lost contacts before the visitors were restored, or their restored details could be overwritten afterward.
- **Offline update:** cache version advances to `20260915-playtest-review-v2`.

The last two gameplay defects emerged after correcting the blocked fixtures. These failures were not all stale tests.

## Fixture corrections; existing assertions retained

- Behavior S3 explicitly acquires the government installations before creating foreign/private concessions. Fresh starts continue to own nothing. The custom polity participant is registered in the live encounter as well as the old scene cache.
- Behavior S5 creates controlled civilian participants through the real NPC constructor and exercises the real encounter/save restoration path, rather than requiring a quiet/depleted system to contain unused ambient slots. The operator fixture positions the ship at the actual planet before docking, so ordinary distance checks do not immediately undock it.
- Hull-merge purchases use an explicitly acquired X-Base at Paso, an existing designated Terran vendor permitted to carry mixed authored stock. This keeps all alias, price, standing, purchase and fleet assertions intact under local-market rules.
- The sensor suite's Paso/Remus **greater than 5,000** assertion is unchanged. Its only harness edit permits selecting a built release root.
- Added regression coverage checks all six authored remote sites through scene generation and both station constructors, checks explicit/player-built orbits, and checks player-hostile independents cannot target foreign Terran stations. Existing local-ring motion and silhouette-separation checks remain.

## Validation of this follow-up

Chromium `153.0.8010.0`, Linux x64, real browser engine. Test-only exports are injected into served responses; none are shipped in the game. Release tests serve the freshly generated `dist` tree.

| Gate | Result |
| --- | --- |
| `npm run probe` against source | **79 passed, 0 failed** |
| `npm run probe -- --root dist` | **79 passed, 0 failed**, no page errors |
| `BM1_TEST_ROOT=.../dist npm run test:ships:merges` | **23/23**, no page errors |
| `BM1_TEST_ROOT=.../dist npm run test:sensors:ingame` | **54/54**, no page errors |
| `npm run test:fleets:ingame -- --root dist` | **91/91** |
| `BM1_TEST_ROOT=.../dist npm run test:playtest` | **22 scenario groups**, no page errors |
| `BM1_TEST_ROOT=.../dist npm run test:stations` | Passed; only platforms 86/87 differ from baseline, 34 other profiles unchanged |
| `npm run build` | Passed; release and Chrome extension generated |
| `git diff --check` | Passed |

All three previously omitted suites were exercised on the final built runtime. The behavior assertions cover foreign ownership, raid capture/reclaim, custom identities, checkpoint approach/dwell persistence, replacement identity, authority changes, operator clicks and player compliance. Ship merge and sensor suites also ran during source diagnosis; the release results above are the final gate. Broader historical EW/model campaign totals are not being claimed as rerun evidence.

## Recovery pricing remains an open design decision

No pricing change is included. The Miranda Long-Range Frigate's canonical cost is 39,000 L. The existing repair basis is 50% of hull price; recovering from 5% to 20% therefore costs `39,000 × 0.5 × 0.15 = 2,925 L`. Against the Terran start's 900 L, that leaves **2,025 L debt**. Arrears continue to block upgrade purchases. Recovery remains available without cash or docking, takes five seconds, and cannot double bill.

The included recovery screenshot deliberately uses the probe's zero-cash fixture to exercise debt. It confirms the 2,925 L quote; it is not a screenshot of untouched starting funds. Whether emergency recovery should have a distinct affordable tow fee instead of ordinary hull-repair pricing remains undecided.

Other carried review items (calendar rounding, confirmation-dialog branches, fleet-manager polish, remaining scale work, native iPad/Safari, zero-hull station handling, cheated-save marking and the EW review ledger) are not closed by this patch. Diplomacy simulation and tuning are unchanged.
