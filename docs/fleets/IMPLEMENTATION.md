# Fleets, disabled ships, boarding and ship economy — review candidate

Based on `04abbfc7e1d28e5178ba353a781aaa9e53dcc4d9` in Artemis2028/BM1-remastered-work. Implements the consolidated v0.7 proposal for independent review. No main merge or publishing is part of this delivery. The source patch is intended to be applied in full.

## What changes

- Fleet records have versioned physical vessel snapshots: real hull/shields, condition, cargo, weapons and loose inventory, stored sensors/jammers, power, crew, cooldowns, recovery time and physical identity. Saves, scene rebuilds and command transfer preserve valid zeros and empty loadouts. Legacy records initialize from the authored fit once.
- Living ships below the disable threshold stop flight/fire/cloak/jamming; shields collapse and the renderer shows missing sections and small cosmetic surface explosions. Zero hull stays destroyed. Already-paid projectiles remain live and synchronous. Recovery and capture do not give a full repair.
- Unclaimed disabled vessels survive a same-system save, but vacate when the player leaves. There is no permanent retired-spawn marker. A boarding operation prevents departure until deployment is cancelled or the committed operation concludes.
- One captain-associated team boards with deterministic saved rolls, a deployment phase and an onboard phase. Capture converts the same damaged physical vessel into a mobile fleet prize. Failure loses the team and scuttles the ship without a salvage payout. Third-party destruction is resolved once. Capture receives the kill-equivalent standing/witness consequence. Exact resistance is disclosed only by an assessment; otherwise the confirmation shows a chance range.
- No owned-ship count cap. The roster supports multiple formations with individual flagships, group intent and per-vessel intent overrides. Follow, rendezvous, hold, defend, patrol, attack and withdraw are available. A disabled/destroyed flagship yields to an operational member. Strategic dispatch changes arrival by calendar day; local tactical targeting still requires sensor knowledge.
- Attempt to disable uses observed disabled cues or assessments, crew reaction intervals and the weakest installed weapon when a target is assessed critical. It also waits on that observer's own outstanding critical-target projectile; it does not inspect other fleets' hidden shot information. No damage clamp guarantees a prize.
- Warp advances a quoted route-dependent number of days. An in-flight save retains the journey ID/duration and resumes settlement exactly once. Zero-day wormholes perform no economy work. Upkeep, station completion, ship production, stock replenishment and market drift advance chronologically.
- Fleet upkeep is the recovered Flash catalog-mass rate per elapsed day. The personal vessel is exempt. Unpaid upkeep and recovery charges share one itemized financial book. See `FLASH-UPKEEP.md` for source provenance and the explicit adaptation from Flash's defection behavior to arrears.
- Ship quantities share one canonical hull/system pool across personal, escort and defense purchases. Both typed planet lists and typed station lists contribute, with provenance. Vendor assortment and service/region/standing restrictions remain separate from quantity. Authored high-number hull IDs are not decoded as legacy weapon IDs. Sales do not replenish pristine retail stock.
- Ship plans cost four times canonical hull price, one standing tier higher with a ceiling of 100. The Tactical Cube's new plan/capture content remains deferred. Owned capable yards/starbases build equipped ships with latinum and duranium. One order per station progresses per day; ownership loss pauses, destruction loses the remaining orders and inputs, delivery is idempotent.
- Repairs cost a hull-price-scaled amount for the actual repaired fraction, including partial repairs. Sales quote damaged hull and explicitly include equipment/cargo for no additional credit. Refit exposes weapon slots, onboard loose items, sensor/jammer replacement/storage and physical equipment transfer between co-located serviced vessels. No inventory is copied into the personal locker.
- Command transfer converts hull units both ways, preserves crew/equipment/energy/cooldowns and remaps live projectile targets/exclusions, HOJ keys, sensor/focus references, tractors/effects and active checkpoint participants. Historical launch credit is not rewritten. Player-only damage caps continue to apply at impact to the player-controlled representation.
- `data/fleet-traffic.json` has a source/rationale entry for every one of the 101 systems. Counts govern ambient population only. Paso remains sparse with X-Base activity; New Switzerland is the independent exchange/salvage hub. No owned vessels disappear because a system has low ambient traffic.

## First-playtest tuning, not newly approved Flash facts

| Setting | Candidate value |
|---|---|
| Formation size | 12 including flagship; unlimited formations/ownership |
| Disable threshold | `min(25% maxHull, max(10% maxHull, 32))` |
| Boarding | 250 range; 3 seconds deployment, 12 seconds onboard |
| Boarding chance | 40 + 0.4 × XP + resistance modifier; clamp 5–90 |
| Resistance | light +10, standard 0, hardened −15, exceptional −25 |
| Team | 2,000 replacement; 1,000 per +5 purchased XP up to 50; success +8 up to 100; loss retains half |
| Travel calendar | ceil(plotted range / 10), minimum one warp day; wormholes zero |
| Repair | 50% of canonical intact price per full hull fraction; cumulative-cent rounding |
| Sale | 35% of intact price × remaining hull fraction; equipment/cargo add zero |
| New-stock capacity | 2 per eligible canonical hull/system |
| Replenishment | one unit at deterministic saved intervals of 3–7 calendar days |
| Ship construction | 82% price + ceil(mass × 2) duranium; ceil(sqrt(mass) × 2) days, minimum two |
| Owned disabled recovery | repair to at least 20%, then five seconds; captured prizes stabilize immediately at actual remaining hull |

These values remain tuning candidates. The comparison report includes floor 32, floor 66 with the same 25% guard, and floor 66 without that guard. It is a deterministic damage table, not an asserted disable probability. The live test covers actual damage, paid follow-up impacts and crew reaction behavior separately.

## Boundaries and remaining playtest work

- This is an implementation/review candidate, not release performance acceptance. A 36-owned-ship concentrated scene has been measured separately and is materially more expensive than the historical small EW fixture. The delivery includes the actual raw stress samples and host record. No threshold was raised and no actor/projectile cap was introduced to hide that cost.
- Distant fleets use persistent records and scheduled arrival. There is no new off-screen tactical battle simulator. Strategic fleet logistics use the existing fleet abstraction; this patch does not invent independent antimatter purchasing for distant NPC vessels.
- Boarding supplies earned team XP. A separate away-mission generator/completion path is not present in this engine and is not invented here; the proposed +3 award requires a genuine unique mission-completion integration later.
- Traffic counts and generic station service inference are first authored candidates, not claims of independent lore approval for all 101 rows. Explicit services override inference. Brokers with authored hull lists remain vendors; defense services do not become shipyards. Stock capacity is deliberately independent of population.
- Old saves with no physical vessel snapshot receive one legacy initialization. New saves with explicit empty gear or zero hull are preserved. Older application versions do not understand these added systems; keep a backup of the pre-patch save.
- iPad/Safari and actual gameplay on the user's Flow Z13/Helios remain playtest work. No hosted build is created by this patch.

## Files and review focus

`src/ship-fleet.mjs` holds pure financial/calendar/boarding/physical-state rules. `src/main.js` connects them to real damage, save/load, departure, purchases, services, tactical updates and UI; fleet adapters are grouped at the end. `bm-ships/ships.json` authors capture policy, and `data/starship_manifest.json` is regenerated from that catalog. `data/fleet-traffic.json` retains each original planet description and the correctly indexed facility IDs. `styles.css` supplies the roster dialog; `sw.js` includes the new runtime and data.

Review especially command transfer in both directions, canonical stock/provenance at unusual brokers, no free equipment on repeated rebuilds, one financial settlement per elapsed day, and ownership-preserving formation scaling.

Two existing probe setups were adjusted for the intentional stock/service changes: the hull-merge fixture supplies enough stock for its multiple purchases; the EW hull-purchase fixture selects a station that actually sells ships. Their original behavior assertions remain intact.

## Reproduce

Use the exact delivered commit on a separate checkout. Install Node/npm and Python 3, then:

```bash
npm ci
npx playwright install chromium
npm run test:fleets
npm run test:fleets:ingame
npm run test:ew
npm run test:ew:ingame
npm run test:ew:seeker
npm run test:ew:seeker:ingame
npm run test:sensors
npm run test:sensors:ingame
npm run test:power
npm run test:power:ingame
npm run validate:ships
npm run check:ship-manifest
npm run test:ships
npm run test:ships:ingame
npm run test:ships:merges
npm run test:ships:balance
npm run test:ships:economy
npm run probe
npm run build
npm run build:python
node scripts/ship-fleet-probe.mjs --root dist --screenshot
node scripts/ship-fleet-probe.mjs --balance --balance-output fleet-balance.json
npm run release:serve
```

The optional screenshot is written in the tested root as `tmp-fleet-manager.png`. The optional balance report uses real runtime hull maxima and damage helpers with its assumptions recorded in JSON. Generated reports are review evidence, not inputs to gameplay.

For this execution, Playwright used an external preload with a serverless Chromium binary because the container did not supply the standard browser installation. The preload, environment and logs are included in the review evidence; it is not a shipped source dependency and does not change the timed game functions.

## Playtest route

Start Terran Rebel at Earth. Open PWR/OPS → Fleet. Buy a fleet ship at an eligible vendor, open its roster row, and inspect the existing weapons and systems. Remove/reinstall a weapon, transfer a loose item between local serviced ships, and check that no inventory is duplicated. Form two groups and give them different orders.

Use Attempt to disable in an engagement. Expect overkill from committed shots. Board a surviving disabled target; inspect damaged hull, preserved equipment and immediate prize mobility. Save/reload during both phases. Leave an unclaimed disabled target, then return: that incarnation should be gone. Take personal command of a prize and check the old ship remains a separate fleet vessel.

At an owned yard, buy a faction plan and queue an equipped hull. Check the displayed costs/days, make journeys of different lengths and verify day-by-day upkeep and delivery. Sell a damaged prize and compare the paid repair quote; no free repair or equipment duplication should make resale profitable.

## Repair-service follow-up to 759eded

For the subsequent fixes and current validation after Fable's f418161 review,
see [REVIEW-FIXES-r2.md](REVIEW-FIXES-r2.md). The paragraphs below describe the
historical repair-service follow-up.

The original candidate accidentally replaced the personal combined hull/shield repair action with hull-only service. The follow-up restores shield repairs at the existing 1 L per percent after hull spending, the game-start/game-over and docking guards, both failure messages, the `uiConfirm` sound with the existing repair cooldown key, and final stats/legacy-state refresh. Hull repairs retain the new price-scaled basis. Fleet hull service remains separate.

The live suite adds combined hull/shield spending, shield-only partial spending, insufficient funds, full condition, game-over, pre-start and undocked cases. A stock regression checks that Paso X-Base still offers exactly `[49, 347]` after initializing the system-wide supply pool. `759eded` and its evidence remain the original review record; this correction is a separate commit.
