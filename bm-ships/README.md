# BM1 / BM2 — standalone ships content pack

Exported 12 September 2026 from integrated snapshot `030155d`, with the later
approved hull/art review applied. This is an **additive, engine-independent
content patch**, not a replacement game or a ready-wired engine update.

## Install in a separate project

Unzip the deliverable outside your project. At the destination project root:

```sh
git apply --check /path/to/BM1-BM2-SHIPS-ONLY.patch
git apply /path/to/BM1-BM2-SHIPS-ONLY.patch
node bm-ships/validate.mjs
```

The patch adds only `bm-ships/`. It requires no BM1/Claude commit or history and
can be applied to an empty Git repository. It never overwrites `src/main.js`,
world data, stations, weapons, saves, service workers or checkpoint code.
Stop if that folder already exists; do not force an overwrite. Numeric IDs are
pack-local: use `bm-ship:<id>` keys or explicitly remap them in another engine.

## Contents

- **212 records:** the 207-record combined roster plus five retained candidates.
- **205 active baseline records**, two retired compatibility records, five
  unbalanced prototypes. “Active” means usable content, not unrestricted stock.
- All **152 BM2 source IDs** map to a record. Distinct BM2 variants remain distinct.
- **204 unique images**, approximately 259 MB of image bytes. Byte-identical art
  shares a content-addressed asset; this does not merge distinct hull records.
- Descriptions, explicit factions, imported stats, game-size envelopes, crop
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
| Ferengi Shuttle 18 | Approved high-quality BM2 shuttle art replaces the generic grey shuttle. |
| Galaxy Dreadnaught 49 | Correct three-nacelle BM2 art; BM2 source 49 now maps to 49, not 60. Paso Project X stock metadata. |
| Independent capital 60 | Separate `civmega.gif` identity, neutral/civilian; proposed name Concord-class Grand Cruiser. |
| Excalibur 347 | Separate authentic Excalibur image, Terran, Paso Project X, 100 world prestige; final combat stats, price and size remain unset. |
| Additional candidates 348–351 | Andorian Cargo Shuttle, unassigned utility shuttle, Basic Shuttle, second-step Klingon Bird of Prey. Kept but disabled until balancing. |
| Cargo Ship 3 | No additional hull: its art belongs to the existing Vega identity. Kingston's `cargo3.gif` is separate. |
| Klingon Cargo Ship 239 | Approved ship artwork retained. |
| Dominion Cruiser 216 | Present; based around Dominica/Gamma, not routine Blender traffic. |

The new Klingon hull is above B'rel in the intended early progression; its exact
class name, values and size are still open. The utility/basic shuttle factions
are not fabricated from filenames. Station art previously mistaken for ships
is not added as pilotable hulls.

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
integrated ladder is retained. Prototypes return `null` until a size is chosen.

For NPC spawning, use `spawnPool(context, faction)`; an empty legal pool remains
empty. Pass `{systemName: 'Blender', role: 'patrol'}` for remnant traffic,
`{region: 'dominion-core', role: 'patrol'}` for other Gamma systems. Invasions or
authored missions require `authorizedDeployment: true`; the target engine must
provide this only for a real mission/attack. Reserved Gorn ships stay disabled.
The Dominion Battleship retains its no-ambient-traffic flag even in its core.

The helper does **not** mutate ownership, side IDs or raised flags. Region is a
content availability rule, not a claim about who politically holds a system.

## Purchases and balancing

`getPurchaseDecision` takes real `worldPrestige`, credits, vendor and region.
Money alone never substitutes for prestige. Excalibur's threshold is 100.
Other `purchaseTier` thresholds must be supplied by the destination project in
`tierThresholds`; missing thresholds refuse the sale rather than inventing an
economy. Examples in tests use fixture thresholds, not balance recommendations.

Special vendor checks do not create a vendor, mission or UI. Other faction,
docking, ownership, capacity and quest restrictions still belong in the engine.
The imported Reman Warbird access-recovery quest is not implemented here.
Excalibur remains a prototype even with 100 prestige because price/stats are unset.

## Save compatibility

Keep `getShip` distinct from `resolveNewShipId`: existing owned ships must not
be deleted or silently refitted when new-spawn lists change. For 26→211, preserve
the instance, owner, equipment and damage and explicitly decide how changed
maximum hull/shields are migrated. For retired 63, preserve the legacy instance.

An old save containing `shipId: 60` is ambiguous if it was created by the faulty
Excalibur=60 export. Use save-version provenance or ask the player; do not
automatically convert every independent capital into an Excalibur.

## Not included

Claude Phase 3 security/checkpoint logic; station/weapon rosters; repair arms;
scaffolding/workbees; capture/boarding; ship-to-ship player transfer; away-team
XP; civil wars; prestige UI; world/shipyard stock rewriting. These are separate
engine features, not implied by adding the content folder.

## Validation and rights

Run `node bm-ships/validate.mjs` with a modern Node release. It checks hashes,
paths, crops, IDs, mappings, retirement, regional restrictions, sizing and
prestige-helper behavior. This export was also checked by decoding every image
and applying the binary patch into a clean test repository. It has **not** been
integrated or playtested in your unspecified separate project.

See `SOURCE-NOTICE.md`. Original game/assets are attributed to Vexxiang; remaster
assets retain their source provenance. This export does not grant additional
rights to publish or redistribute third-party artwork.
