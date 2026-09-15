# Captain's briefing playtest changes

Incremental candidate on `7c86a4d669ff98f49d3f1d3b01c9c4bf7cbff8a7`. Prepared for review; no push, merge or deployment.

## Combat: fix the units before increasing weapon damage

Incoming combat damage was subtracted directly from the player's 100-point shield/hull percentages. NPCs instead used ship-specific durability pools. That discarded the Sovereign's durability advantage when the player flew it. All four combat impact paths now convert canonical weapon damage through the same ship pools used for NPCs; environmental percentage penalties retain their existing units. Saves still store player condition as percentages, and existing per-hit caps remain.

Measured with a 100-unit impact, full shields, no God Mode:

| Ship | Shield pool | Shield percentage lost | Hull pool | Hull percentage lost when unshielded |
| --- | ---: | ---: | ---: | ---: |
| Miranda Long-Range Frigate | 818 | 12.225% | 999 | 10.010% |
| Tholian Cargo Ship | 1,700 | 5.882% | 1,804 | 5.543% |
| Sovereign | 4,624 | 2.163% | 3,814 | 2.622% |

The Sovereign already starts with Particle Beam, Quantum Torpedo and Transphasic Torpedo; the cargo ship has a Type X Phaser and a non-damaging tractor beam. This patch changes neither loadouts nor weapon damage. These checks establish durability conversion, not a duel win rate. Next combat ideas: weapon-group autofire, clear warnings when power cannot sustain the selected weapons, and a post-combat damage breakdown. Run repeated healthy-capital-versus-freighter duels before setting a numerical win-rate target or further tuning weapons; damaged or poorly powered capitals should still be vulnerable.

## Trade, boarding and station access

- New cargo offers carry up to 20 tons, constrained by free capacity. Base payment per ton is `150 + min(350, route distance × 3)`, rounded; hazard supplements are 20 for asteroids, 30 for nebulae and 100 for wartime endpoints. Offers warn that wartime access is not guaranteed. A final 120-offer Miranda sample ranged from 1,000 to 12,000 L, averaging 6,234 L. This is a random sample, not a universal minimum or earnings-per-hour claim. Existing accepted contracts keep their original rates. Ordinary commodity prices and repair pricing are unchanged.
- Boarding resolves immediately after the native Yes/No confirmation. Eligibility, deterministic odds, team loss, scuttling, physical prize conversion and ownership rules remain. No cancels without mutation; Yes resolves success or failure immediately. Legacy saved staged boarding operations still finish through the old timer path.
- Station hails open a transporter market across the current system. Purchases retain stock, faction, standing, ownership, funds and clearance checks. The connection does not set physical docking. Personal and fleet hull repairs still require docking. System changes and closing the market discard the remote connection.
- The anti-emitter torpedo shop icon now uses the existing photon torpedo sprite, matching its in-flight fallback. It is a working asset reference, not newly commissioned artwork.

## Borders and galaxy awareness

- Added faction border defaults while preserving authored policies and player checkpoint configuration. Klingon, Romulan, Cardassian and other restrictive governments can challenge foreigners or close access during war. A Terran arriving at wartime Qonos is hailed and barred; after peace, the visitor must follow the holding/inspection process before commerce.
- Foreign checkpoint arrivals begin at least 600 units outside the perimeter and receive an incoming hail with policy instructions. Crossing a challenge perimeter activates the existing holding marker and dwell checks. Closed borders block automatic arrival cargo delivery as well as station purchases; arrival no longer silently bypasses clearance.
- A mid-jump subspace briefing pauses travel and shows recent diplomatic reports, mobilization warnings and confirmed local action. Continue jump resumes travel. Saving in transit and loading the briefing preserves elapsed travel and charges campaign days once. Reports can also be opened from the HUD.
- Public diplomacy distinguishes updates, new wars, crises and actual war-to-peace transitions. Repeated reading does not duplicate reports or lose separate same-day changes. Civilian warnings are explicitly unconfirmed, refer only to charted systems and factions with legal regional deployment pools, and claim no verified losses. Actual local fleet actions and destroyed installations create confirmed reports. The saved archive is capped at 120 entries; the display shows the latest 18 visible entries.
- This does **not** introduce an offscreen battle/attrition simulator. An unloaded system's warning is not evidence of a completed raid or destroyed station. Future report/mission ideas include convoy diversions, embargoes, missing patrols, refugee evacuations, distress calls, ceasefire corridors and reconstruction supply requests.

## Public debug menu

Existing standing, resources, ship, crisis, war and peace controls remain. New local controls deploy reconnaissance, minor fleet actions, raids and major fleet actions, or destroy the selected live installation. Combat deployments require a legal enemy at war with the local governor and cannot stack an already active fleet action. Faction selection now excludes empty legal ship pools, fixing random event failures without spawning prohibited hulls.

Cargo contract and planet away-mission buttons call the existing mission systems and respect border access. Close Cheats & Debug to interact with the opened offer/market. Escort, rescue and investigation contracts remain proposals. Codes: `event scout`, `event skirmish`, `event raid`, `event battle`, `event station-loss`, `mission cargo`, `mission transport`.

## Validation

Chromium 153.0.8010.0 on Linux; browser test exports are injected by the harness, not shipped.

| Gate | Result | Runtime |
| --- | --- | --- |
| New captain briefing probe | 13 groups, no page errors | Built release |
| Behavior probe | 79 passed, 0 failed | Built release |
| Hull merges | 23/23 | Built release |
| Sensors | 54/54 | Built release |
| Fleets | 91/91 | Built release |
| Playtest | 22 groups | Built release |
| Electronic warfare | 33/33 | Source, verified identical to release |
| Anti-jam seeker | 38/38 | Source, verified identical to release |
| Release/extension build | Passed | Both generated |

The new probe covers unit conversion, freight quotes and preserved old rates, remote weapon/ship purchases and repair rejection, wartime Qonos and peacetime holding clearance, icon loading, boarding No/Yes/success/failure/save, real raid deployment and station-loss reports, existing mission triggers, same-day diplomatic report deduplication, paused briefing save/load/calendar behavior and a 390px report layout.

Fixture changes retain the meaningful protections: occupation must remove **player** checkpoint authority, but can install the occupier's faction checkpoint; legacy timed boarding fixtures explicitly create legacy operations; hailing a station now expects remote commerce with no enabled repair action and no physical docking. Foreign ownership, capture/reclaim, checkpoint persistence and remote-installation geometry assertions remain exercised.

Included screenshots show the arrival hail, jump briefing and narrow-screen report archive. No native iPad/Safari validation, duel win-rate study or broader EW performance campaign is claimed. Other open decisions from the previous review, including emergency recovery pricing, remain open.
