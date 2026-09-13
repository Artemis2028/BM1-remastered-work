# Sensors and scouting implementation

This patch applies after **34c1827abe059b43951f62354968a2c6bccce621** on the reviewed BM1 ship/power tree. It implements the accepted sensors proposal, including the final transponder and Unknown-checkpoint revisions. It does not replace the roster or change the reviewed hull prices, standing gates, artwork, combat statistics or three weapon slots. The only ship-data additions are native sensor traits and their design notes.

## Applying the complete patch

Start from a clean checkout containing the base above. Use `git am BM1-SENSORS-AND-SCOUTING-COMPLETE.patch`. On a newer branch, apply the commit normally and review conflicts; do not replace `main.js` wholesale or reset the branch to this base. This patch is incremental source code, not a standalone game distribution. No remote push is included.

## Player controls

OPS now has Engines, Weapons, Shields and Sensors, sharing a 20-point allocation. Engines affect speed, Weapons affect damage and energy cost (not reload time), Shields affect recharge, and Sensors affect range and power draw. Unallocated points do not multiply generation. Legacy saves always receive five sensor points; the other three consumers are normalized to fifteen only when necessary, using deterministic largest-remainder rounding. A deliberate zero in a new sensor save remains zero.

The sensor controls provide passive reception, active sweep, focused scan and **Transponder On/Off**. An active sweep can discover a contact without selecting it first. Focus requires a track: hull analysis takes two processing-adjusted seconds, then equipment analysis takes another six. Both require real power. Reports distinguish declared identity, observed hull, runtime equipment, dated intelligence and uncertain foreign crew assessment. Own crew skill is exact. Unsupported cargo information stays unavailable.

Installed suites occupy a dedicated sensor upgrade position, not a weapon slot. Each replaces the previous suite; bonuses do not stack or produce extra reactor power. Installation requires an eligible planet/service, sufficient faction-wide standing and funds. Local commanded fleet ships may also be refitted through this check.

| Suite | Latinum | Standing tier | Passive / active range multiplier | Processing multiplier |
| --- | ---: | --- | --- | ---: |
| Native | Included | Open | 1.00 / 1.00 | 1.00 |
| Enhanced | 8,000 | Trusted (15 by default) | 1.15 / 1.10 | 1.20 |
| Survey | 22,000 | Respected (30 by default) | 1.35 / 1.25 | 1.50 |
| Advanced reconnaissance | 55,000 | Strategic (75 by default) | 1.55 / 1.40 | 1.80 |

The existing economy configuration supplies the actual tier thresholds. Native sensitivity, aperture, processing, efficiency and signature distinguish the reviewed hulls. A cargo ship can buy better sensors while retaining its power and hull tradeoffs.

## Contacts, AI and checkpoints

Baseline passive/active ranges are 1,200/1,800 units at five sensor points, modified by native hardware, suite and funded allocation. Passive acquisition takes one second. An uncloaked visible sprite receives a positional track even with sensors at zero: the world-space viewport floor includes corners and sprite edges and applies to every observer. A remote camera is not an extra observer. Normal active scanning does not defeat cloak.

A fresh declaration can be heard within 2,400 units independently of sensor allocation. It expires after three seconds without reception and gives no firing solution. Ordinary traffic, government patrols, escorts and the player transmit by default; pirates and authored covert actors default dark. Explicit authored settings win. A declaration is deliberately an **unverified claim**. Spoofing consequences/authentication belong to later incident policy; this patch does not add a player identity-forging editor.

Unknown access is now settable and enforceable as Open, Challenge or Closed. Its default remains Open. A checkpoint can address a tracked but unidentified visitor. Running dark does not bypass a closed Unknown policy; the same rules apply to the player at foreign checkpoints, including authorities flying the player's flag. Own-side exemption uses actual side identity. Fresh declarations reclassify incomplete checks without granting endlessly reset deadlines.

Operational stations use 1,200-unit passive reception; named shipyard/science/university/maintenance/starbase installations use 1,500. An active checkpoint issuer also covers the moving issuer-to-zone-centre distance plus the zone radius plus 200 units, never less than its base array. Destroyed/incomplete issuers provide no such coverage. Cloak remains outside ordinary checkpoint detection.

Player and NPC sides share direct positional reports symmetrically within 2,400 units, using exact side membership. There is no allied concession sharing, transponder-based membership or relay. Reports stay usable for at most 0.4 seconds: one missed 5 Hz pass is tolerated, two are not. Explicit source loss or leaving sharing range invalidates a shared track immediately. Reports retain their observed position rather than following the hidden entity.

Every shooter needs its own track or a valid direct report for new targeted fire. Losing the player's track does not blind an escort that still has a local track. Existing projectiles continue. All four AI skill profiles can search a last-known position for a bounded interval; they cannot steer toward current hidden coordinates. The existing real-energy/reserve behavior remains in force.

## Hit-origin counterfire

A hit carries the original launch position and produces a three-second cue for the victim. The cue is a frozen position, not identification or a homing lock; moving the shooter does not move it. Same-side direct sharing preserves the original expiry and cannot relay. Repeated ticks from one effect event do not refresh it.

Point beams perform a finite segment/body collision against what is physically there. Point torpedoes travel ballistically to the cue. They can miss a moved shooter or strike an intervening vessel. Range, firing arc, cooldown, available energy, crew reserve and damage scaling still apply. Damage and aggression are attributed to the actual victim and original shooter through the existing credit path. Player, NPC, escort and station fire use the same mechanism. Cloaking does not erase a projectile already flying to a point.

## Persistence and scope

Sensor suites, allocation, mode, explicit transponder state and dated reports persist with stable player/fleet actors. Reports use relative ages and return stale until observations revalidate them; loading grants neither battery refill nor free scan completion. Incarnation keys include system and spawn identity, so a reused ambient ID does not inherit another ship's intelligence. Captured observers discard their old side's private reports.

No EW/jamming, protect-all ROE, new incident penalties, boarding system or economy rebalance is included. The native traits and contact model provide a base for those later increments.

## Verification

See `VALIDATION.md` for the exact final results and benchmark environment. Run:

```sh
npm run test:sensors
npm run test:sensors:ingame
npm run test:sensors:performance
npm run test:power
npm run test:power:ingame
npm run probe
npm run validate:ships
npm run test:ships
npm run test:ships:economy
npm run test:ships:merges
npm run test:ships:balance
npm run test:ships:ingame
npm run check:ship-manifest
npm run build
npm run build:python
```

Browser suites require Playwright plus a compatible Chromium (`npx playwright install chromium` in a normal checkout). `scripts/sensor-frame-benchmark.mjs --root /path/to/base` runs the identical frame fixture against the pre-sensor tree. `scripts/ship-sensors-probe.mjs --screenshots /path/to/output` captures OPS/contact states and adds the touch-viewport smoke check.
