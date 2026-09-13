# BM1 / BM2 — standalone ships content pack

Full roster balance reviewed 13 September 2026 (`full-roster-v2`). This folder remains an engine-independent content
pack. The surrounding remaster now wires it into spawning, rendering, stock,
equipment and faction-standing purchase checks. See `../docs/SHIP-ECONOMY-REVIEW.md`.

To reuse it in another project, copy the **whole `bm-ships/` folder** and call
its helpers over HTTP. Numeric IDs are pack-local; use the stable `bm-ship:<id>`
keys when mapping to another engine. The folder alone does not implement gameplay.

## Contents

- **174 canonical records:** 38 approved duplicate pairs merged; five variant pairs retained.
- **172 active records** and two retired compatibility records. “Active” means usable content, not unrestricted stock.
- All **152 BM2 source IDs** map to a record. Distinct BM2 variants remain distinct.
- Content-addressed images with checksums in `assets.json`. Byte-identical art
  shares a content-addressed asset; this does not merge distinct hull records.
- Descriptions, explicit factions, reviewed stats, game-size envelopes, crop
  rectangles, regional/market metadata, review decisions and source provenance.
- Dependency-free JavaScript helpers and a Node validation suite.

The PNGs retain the supplied remaster quality; the added Flash-source candidates
and independent megaship use the faithful embedded WebP previews from the review.
Those previews are not editable GIF/PSD masters. No AI-generated replacements,
resampling or sprite rotations were performed for this export.

## Corrections included

| Item | Export behavior |
|---|---|
| Vulcan Explorer 26 | Retired for new references; `resolveNewShipId(26)` returns 211. Record remains loadable. |
| Vulcan Lifeform 63 | Retired/reserved; no new traffic or sales; old record preserved. |
| Ferengi Shuttle 316 (formerly 18) | Approved high-quality BM2 shuttle art replaces the generic grey shuttle. |
| Galaxy Dreadnaught 49 | Correct three-nacelle BM2 art; BM2 source 49 now maps to 49, not 60. Paso Project X stock metadata. |
| Independent capital 60 | Separate `civmega.gif` identity, neutral/civilian; Concord-class Grand Cruiser; 100 independent trade standing. |
| Excalibur 347 | Separate authentic Excalibur image, Terran, Paso Project X, 100 Terran standing; 1,500,000 latinum, with approved hull/shields/cargo. |
| Additional hulls 348–351 | Andorian Cargo Shuttle, unassigned utility shuttle, Basic Shuttle, second-step Klingon Bird of Prey. Balanced and enabled; utility/basic shuttles are in independent service. |
| Cargo Ship 3 | No additional hull: its art belongs to the existing Vega identity. Kingston's `cargo3.gif` is separate. |
| Klingon Cargo Ship 239 | Approved ship artwork retained. |
| Dominion Cruiser 216 | Present; based around Dominica/Gamma, not routine Blender traffic. |

The new Klingon hull is above B'rel and below K'Vort in price and durability.
Its faithful nose-up PSD master is borrowed from Claude's bundle without changing
our hull ID. The other reviewed art and existing draw envelopes remain intact.
The utility shuttle's original design/faction remains unidentified; independent
service is provisional, not a claim based on its filename. Station artwork is
not added as pilotable ships.

## Using it in a browser game

Serve the project over HTTP; fetching JSON through `file://` is browser-dependent.

```js
import {loadShipCatalog} from './bm-ships/catalog.mjs';
const catalog = await loadShipCatalog();
const ship = catalog.getShip(216);
const image = new Image();
image.src = catalog.imageUrl(ship.id);
await image.decode();
const b = ship.trimBounds;
const size = catalog.getDrawSize(ship.id);
ctx.drawImage(image, b.sx, b.sy, b.sw, b.sh,
  x - size.width / 2, y - size.height / 2, size.width, size.height);
```

Draw dimensions are final baseline dimensions; **do not multiply them by the
class scale again**. `getDrawSize` can apply a requested class-scale ratio.
Reviewed register envelopes are preferred where mapped; otherwise the compact
integrated ladder is retained. The five newly balanced hulls now have explicit envelopes too.

For NPC spawning, use `spawnPool(context, faction)`; an empty legal pool remains
empty. Pass `{systemName: 'Blender', role: 'patrol'}` for remnant traffic,
`{region: 'dominion-core', role: 'patrol'}` for other Gamma systems. Invasions or
authored missions require `authorizedDeployment: true`; the target engine must
provide this only for a real mission/attack. Reserved Gorn ships stay disabled.
The Dominion Battleship retains its no-ambient-traffic flag even in its core.

The helper does **not** mutate ownership, side IDs or raised flags. Region is a
content availability rule, not a claim about who politically holds a system.

## Purchases and balancing

`getPurchaseDecision` takes `standings` (an object keyed by faction), credits,
vendor and region. The required faction is the hull's faction unless explicitly
overridden in `purchaseRequirements.faction`. An explicit
`purchaseRequirements.factionStanding` overrides the tier threshold.

The remaster's initial tier ladder (`src/ship-economy.mjs`) is open 0, trusted 15,
respected 30, military 50, strategic 75. Excalibur and Concord require 100.
All 172 active records now have explicit standing requirements, so another host
does not need to invent tier thresholds. A future record with neither an explicit
requirement nor a configured tier still refuses the sale.
`eligibleForStock` checks content availability separately so a locked design
remains visible in its proper shop. Neither helper changes ownership or flags.

World locations still determine stock: Project X in Paso carries 49/347, the
Free Swiss Reserve Exchange carries Concord, and the Reman Starbase in Remus
carries the Reman Warbird. Dominion heavy stock stays in the core region.

Every active record has exactly three `defaultWeaponSlots`, including explicit
nulls. Civilian shuttles and several transports begin empty; the Olympic carries
utility devices but no combat weapon. That is an armable loadout, not a ban on weapons. The host
must preserve those slots and permit compatible weapons to be installed later.

`getShip` retains exact identity; `resolveNewShipId` follows only new-reference
aliases. No legacy save migration was added for this integration.

## Not included

Claude Phase 3 security/checkpoint logic; station/weapon rosters; repair arms;
scaffolding/workbees; capture/boarding; ship-to-ship player transfer; away-team
XP; civil wars; Reman access-recovery quest. Those are separate features. The
remaster integration contains standing UI and station stock updates; copying
this content folder alone does not copy that engine code.

## Validation and rights

Run `node bm-ships/validate.mjs` with a modern Node release. It checks hashes,
paths, crops, IDs, mappings, retirement, regional restrictions, sizing and
standing-helper behavior. This export was also checked by decoding every image
in the source audit. It has **not** been
integrated or playtested in your unspecified separate project.

See `SOURCE-NOTICE.md`. Original game/assets are attributed to Vexxiang; remaster
assets retain their source provenance. This export does not grant additional
rights to publish or redistribute third-party artwork.

## Approved duplicate merges (13 September 2026)

`ships.json` is the authored source for hulls. `data/starship_manifest.json` is
generated by `node scripts/sync-ship-roster.mjs`; do not tune a second copy.
The 38 old IDs are aliases, not extra ships in stock, traffic or the ship selector.
Both variants remain for Ambassador, Akira, Sovereign, Negh’Var and Steamrunner.
See `../docs/APPROVED-HULL-MERGES.md` for artwork, price and loadout choices.

## Full roster balance v2

`ships.json` remains the single authored runtime roster. The compatibility
manifest is generated; the TSV in `docs/ship-balance/` is the dated review ledger,
not another database loaded by the engine. Future tuning belongs in `ships.json`.
This pass supersedes the older price exceptions where they broke progression.
Defiant remains 62,500, Excalibur 1,500,000 and Concord 1,050,000 latinum.

- `role` and the current description explain the configured ship. Original
  wording, former values, rationale and lore source keys are in `balanceReview`.
- `cost`, `purchaseRequirements.factionStanding`, hull, shields, cargo, mass,
  speed, turning, range, reserve and starting fit are individually reviewed.
- `topSpeed` is the displayed/NPC cruise rating. `impulseSpeed` is the base player
  speed in BM engine units, before power distribution; it avoids the old /4 cap.
- `handlingTurnRate` is the authored turn base before existing mass/visual-size
  penalties. `warpRange` is explicit and does not change when a ship is repriced.
- `fuelCapacity` is the tank capacity used when a hull is installed. It is not
  the misleading legacy `antimatterUse` field and does not imply fuel generation.
- `armedByDefault` distinguishes combat weapons from devices. Utility craft can
  travel but do not populate armed patrol/invasion pools. Existing NPC combat
  fires the first compatible combat weapon; it does not fire all three slots.
- Ordinary huge flagships are removed from ambient traffic. Their authorized
  fleet deployment and purchase restrictions remain separate.

The remaster needs the accompanying engine patch for the new impulse, handling
and fuel fields. Other projects must adapt these fields to their own units and
honor the three slots and weapon mass requirements. This content pack does not
itself implement weapons, boarding, construction or checkpoint AI.

See `../docs/ship-balance/BALANCE-REVIEW.md` and `LORE-SOURCES.md`. Validation now
includes `npm run test:ships:balance`, which exercises all 172 hulls through the
actual engine and checks progression and same-market capability dominance.
Numbers are a coherent first balance pass, not a substitute for campaign playtesting.
