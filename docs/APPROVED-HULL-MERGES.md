# Approved BM1 / BM2 hull merges

Historical merge record. Artwork/identity decisions remain in force; numerical
values and price exceptions are superseded by the later requested
[full-roster balance](ship-balance/BALANCE-REVIEW.md).

Implemented 13 September 2026 against the reviewed economy commit
`3b2c2a9703bf17791a3ea36393df18d7267ff95a`.

## Result

The roster now has **172 active hulls**, plus the two existing retired records
(#26 and #63). The 38 merged records no longer exist as separate ships. Their
old IDs resolve to the selected survivor for starting ships, NPC construction,
yard stock and personal/escort/garrison purchases. All 152 BM2 source IDs remain
mapped. There is no new saved-game migration requirement.

`bm-ships/ships.json` is the authored roster. The compatibility file
`data/starship_manifest.json` is generated from it. Run
`node scripts/sync-ship-roster.mjs` after editing the roster and
`npm run check:ship-manifest` to detect drift.

## Approved merges

The arrow identifies the discarded record and retained record. The artwork
column is independent of the survivor's identity and balance. Unless listed
below, the survivor keeps its existing stats, price and faction-standing tier.

| Old ID → survivor | Retained hull | Artwork from reviewed record |
|---|---|---|
| 304 → 2 | Excelsior Class | #304 |
| 3 → 305 | Miranda Long-Range Frigate | #305 |
| 5 → 306 | Nova Surveyor | #306 |
| 6 → 307 | Saber Planetary Defender | #307 |
| 7 → 308 | Danube Utility Runabout | #308 |
| 8 → 309 | Deforest Armed Freighter | #8 |
| 12 → 310 | Aries Multipurpose Vessel | #310 |
| 13 → 311 | Mozart Civilian Explorer | #311 |
| 14 → 312 | Centaur Reserve Cruiser | #312 |
| 16 → 314 | Cardassian Hideki Shuttle | #314 |
| 17 → 315 | Ferengi Marauder Refit | #315 |
| 18 → 316 | Ferengi Cargo Shuttle | #316 |
| 19 → 317 | Ferengi Vagabond | #317 |
| 20 → 318 | Tholian Isaac Freighter | #318 |
| 21 → 319 | Delpin Long-Range Cruiser | #319 |
| 27 → 320 | D'deridex Warbird | #320 |
| 28 → 321 | Norexan Warbird | #321 |
| 30 → 322 | Jem'Hadar Attack Ship | #322 |
| 31 → 323 | Galor Cruiser | #323 |
| 32 → 324 | Keldon War Cruiser | #324 |
| 34 → 326 | Defiant Escort | #326 |
| 36 → 327 | Intrepid Explorer | #327 |
| 37 → 328 | Prometheus Tactical Cruiser | #328 |
| 39 → 330 | B'rel Scout | #330 |
| 40 → 331 | K't'inga Cargo Cruiser | #331 |
| 41 → 332 | K'Vort Patrol Ship | #332 |
| 43 → 334 | Vor'cha Attack Cruiser | #334 |
| 45 → 335 | Akuzi Explorer | #335 |
| 46 → 336 | New Orleans Civilian Refit | #336 |
| 52 → 338 | Tarellian Quantum Cruiser | #338 |
| 339 → 55 | Alien Bioship | #339 |
| 56 → 340 | Constitution Utility Tug | #340 |
| 57 → 341 | Constellation Cargo Tug | #341 |
| 58 → 342 | Olympic Support Ship | #342 |
| 59 → 343 | Vulcan C'Thia Defense Cruiser | #343 |
| 23 → 345 | Bajoran Solar Sailor | #345 |
| 44 → 346 | Borg Assimilation Cube | #346 |
| 337 → 47 | Oberth Tug | #337 |

## Price exceptions and retained variants

- Excelsior #2 keeps its 12,000-latinum price and stats with #304's image.
  The 6,000,001-latinum duplicate is removed.
- Defiant #326 keeps the user-selected art/name and #34's **62,500-latinum price**.
- Akira prices are swapped: standard #33 **72,000**, upgraded #325 **94,000**.
- Alien Bioship #55 keeps its stats and 195,050-latinum price with #339's art.
- Oberth #47 absorbs #337: 6,500 latinum, 100 hull, 100 shields, #337 artwork.
  Keeping #47's balance and #337's art is the implementation choice for the
  approved Oberth merge, which did not specify those details.

Five pairs remain separate. Their starting fits are concrete initial tuning
chosen to implement the user's civilian/military and standard/upgraded distinctions.
No global weapon stats or NPC firing algorithm are changed.

| Pair | Treatment | Starting weapon slots |
|---|---|---|
| Ambassador #15 / #313 | #15 civilian; #313 Terran Imperial service with stronger armament | #15: Type X / empty / empty. #313: Particle Beam / Pulse Turret / Photon. |
| Akira #33 / #325 | #325 is the upgraded strike cruiser; descriptions and prices reflect this | #33: Type X / Photon / empty. #325: Particle Beam / Quantum / Quantum. |
| Sovereign #38 / #329 | Both approved versions remain | Existing fits retained. |
| Negh'Var #42 / #333 | Both versions remain; #333 description describes fleet command, without assuming a Dominion victory | Existing fits retained. |
| Steamrunner #1 / #344 | #344 has a distinct strike-frigate fit | #1 unchanged. #344: Dual Pulse Phasers / Quantum / Photon. |

The existing NPC AI fires its primary default weapon. The new primary beams
make the Imperial Ambassador and strike Akira stronger in that path too; this
patch does not claim multi-slot NPC firing.

The new Klingon Bird of Prey #351 stays the second early combat step. The
selected B'rel #330 and K'Vort #332 have different durability from the removed
BM1 records, so #351 is adjusted to **75 hull / 60 shields**, retaining its
**9,000-latinum price**, weapon fit and size. This places its durability and
price between #330 (20/5, 2,500) and #332 (100/110, 21,000).

## Artwork and sizes

- Vega #11 uses the audited `cargoship3.gif` artwork. No separate Cargo Ship 3
  is added; Kingston's `cargo3.gif` remains a different ship asset.
- Vulcan Explorer #211 uses the audited `vulcancruiser.gif` art and its 64.5 ×
  130.5 world-unit envelope (65 × 131 after the renderer's pixel rounding).
- D'deridex #320 uses the image explicitly selected in the duplicate review.
- Concord #60 uses the exact embedded artwork from Claude's HTML hull register.
  Its approved 1,050,000-latinum price, 6,500 hull and 8,000 shields stay intact.
- Remaining merged ships use the image and proportional envelope of the
  selected artwork record. No newly generated or upscaled imagery is included.

Only referenced pack art is listed for offline caching and copied into web or
extension releases. Unused source files remain in the Git tree for recovery;
they do not ship in those builds. This is not a complete image-size optimization:
the full-resolution renders the user selected remain part of the release.

## Preserved gameplay and remaining work

Faction-wide standing, six purchase tiers, contract rewards, the trading cap,
shared purchase gates, Dominion core/remnant restrictions, reserved Gorn/Cube
content, Paso and Remus vendors, and empty-but-armable three-slot loadouts stay
in place. Phase 3 checkpoint and political-side behavior remains covered by the
existing behavior suite.

This patch implements the reviewed merges and named variant changes. Other
surviving imported prices and stats still require broader balance review; a
passing regression suite is not a claim that every ship is economically balanced.
Boarding, utility credentials, weapon-description consolidation, station repair
capabilities, scaffolds/workbees, civil wars and recoverable Reman access remain
separate roadmap work.

## Verification

Run the existing content, integration, live catalog, live economy and behavior
suites, plus `npm run test:ships:merges` and `npm run check:ship-manifest`.
The merge probe exercises real starts, construction, all three purchase paths,
stock deduplication, variant fits and render sizes. Test shims are injected only
by the local probe server. Delivery receipts record the actual run results.
