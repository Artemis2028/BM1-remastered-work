# Towing, salvage and stranded-hull recovery

Stacked on the frozen 78cd8fa (SHIP-DEPENDENT-STRATEGIC-SPEED).

**The rule: a disabled hull is physically recovered, or it stays where it lies.** A ship disabled several
systems from home never teleports to a yard. Recovery takes all of these, in order:

1. a real recovery-capable vessel;
2. a real route to the hulk, flown in actual travel time at the tug's strategic speed;
3. arrival at the hulk's system;
4. the on-scene checks and the decision to attach (recovery or salvage);
5. a real, slower tow journey back to a suitable yard.

The hulk is the same persistent vessel throughout: the same record and the same vid. Salvage changes its
owner, never its origin.

Before this round (78cd8fa), the only way a hulk reached a yard was to lie in its owner's own yard system.
`recoverStrandedHull` refused anywhere else ("no own yard here: it waits for a tow"), and nothing ever
towed it.
- The pure check BEFORE/AFTER fails on 78cd8fa on its own assertion: "after 200 days the hulk still lies
  at Minor (awaiting_recovery)".
- The in-game STRANDED-THEN-RECOVERED fails there too: "no towing on this build: after 30 days she still
  lies at Tellar with no way to send a tug".

Code:
- `src/strategic-recovery.mjs` holds the pure parts: states, capability and claim rules.
- `src/campaign-strategy.mjs` holds the mission, the journey kind `recovery`, the tow in the shared
  journey and blockade engines, the AI, the derelicts and the write-off.
- `src/main.js` holds the captain's controls, the effects, the salvage adoption and the debug section.

## 1. The mission record (book.hullRecoveries)

There is one persistent record per mission, with a stable id (`<seed>:tow:<n>`). It is created once, by a
request, and never re-created per tick. A hulk with a live mission is claimed: no second mission can be
made for it.

| field | what it holds |
|---|---|
| `id`, `kind` | the mission id; `recovery` (the owner wants it back) or `salvage` (claimed from someone else, or from nobody) |
| `target { hullId, vid, shipId, origin, crewAtRequest }` | the hulk: its record id and vid; `origin` is the identity's builder |
| `tug { hullId, vid, shipId, capacity }`, `escorts[]` | the recovery vessel and the ships flying with it |
| `targetSystem`, `yard` | where the hulk lay, and the destination yard (re-chosen at a boundary if needed) |
| `state`, `history[]` | the current state; every transition with its day and a note (bounded to 24) |
| `outbound { journeyId, route, legDays, speed, departDay, eta }` | the tug's journey to the hulk |
| `inbound { journeyId, route, legDays, towSpeed, departDay, eta }` | the tow journey to the yard |
| `journeyIds[]`, `attachment { day, at, salvagedFrom? }` | every journey the mission flew; when and where the hulk was made fast |
| `crew` | the hulk's crew state (aboard / rescued / lost), kept separately from the hull |
| `claim { authority, kind, since }`, `owner`, `sponsor` | who claims it and on what authority; the owner when it was claimed; who runs the mission |
| `plan { outboundDays, towDays, towSpeed, groupSpeed, arriveDay, deliverDay }` | what the request said (the ETA the captain was shown) |
| `waitingSince`, `waitReason`, `avoid[]` | holding with no way on; the systems to route around (a blockade that turned it back) |
| `createdDay`, `endedDay`, `reason`, `losses[]` | the completion or failure reason; the ships it lost |

### State matrix

| state | entered when | leaves to |
|---|---|---|
| `requested` | a request passes the plan (a request that fails the plan is refused outright and no record is kept) | `assigned`, the same day |
| `assigned` | the tug (and escorts) are committed (`opId` = mission) | `en_route_to_hulk`, or `on_scene` if the tug is already there |
| `en_route_to_hulk` | the outbound journey (kind `recovery`, leg `outbound`) departs | `on_scene` on arrival; `aborted` if cancelled, or if the hulk is gone at a boundary; `failed` if the tug is lost on the way |
| `on_scene` | the tug reaches the hulk's system | `attached` if every on-scene check passes; otherwise `aborted` |
| `attached` | the hulk is made fast (and, for salvage, changes hands) | `towing`, the same day; for the captain's salvage, once the engine has adopted the vessel |
| `towing` | the tow journey (leg `inbound`) departs, or is holding for a way on | `delivered_to_yard`; `failed` (tug lost, hulk destroyed under tow, no way on for `recoveryWaitDays`) |
| `delivered_to_yard` | the tow arrives at a usable yard | closed |
| `aborted` / `failed` | as above | closed |

Two rules hold across every state:
- **Cancel** works only in `requested`, `assigned`, `en_route_to_hulk` or `on_scene`. Once the hulk is in
  tow, it is refused ("already in tow: it cannot be called off now").
- **Watchdog.** An open mission whose journey was ended by a path that tells nobody (a forced reset) is
  closed the next day, with the hulk let go where it stands.

## 2. Recovery-capable assets

Capability is explicit. Each class in `bm-ships/ships.json` (and the manifest) carries `recoveryCapacity`:
the heaviest hull, by catalogue mass 1–10, that it can take in tow alone.
- The values are assigned once by `scripts/assign-recovery-capacity.mjs` from the class's role (tug,
  support) and its size category. The basis is recorded (`recoveryCapacityBasis`), and a hand-set value
  (`authored`) is kept.
- Combat stats never decide capacity.
- The target's requirement is its class mass. A tug tows a target only if `capacity ≥ mass`.
- Several ships towing one big hull together is deferred. The first model is one tug per hulk.

| Category | recoveryCapacity (heaviest mass it tows alone) | Classes | Examples |
|---|---|---|---|
| heavyTug | 10 | 1 | Tug Class II (m3) |
| tug | 8 | 3 | Oberth Tug (m2), Constitution Utility Tug (m4), Constellation Cargo Tug (m4) |
| support | 7 | 4 | California Class (m5), Parliament Class (m6), Sutherland Class (m6), Olympic Support Ship (m5) |
| battleship | 6 | 15 | Neg'Var Warship (m7), Galaxy Dreadnaught (m8), Concord-class Grand Cruiser (m6), Klingon Qonos (m9), Cardassian Behemoth (m10) |
| capital | 5 | 16 | Vulcan Explorer (m5), Galaxy Class (m6), Sovereign Class (m6), Jem'Hadar Battlecruiser (m7), Delpin Luxury Liner (m5) |
| freighter | 4 | 14 | Kingston Class (m3), Sentient Lifeform (m5), Tarellian Freighter (m6), Tholian Cargo Ship (m4), Salcombe class (m4) |
| cruiser | 3 | 38 | Excelsior Class (m4), Nebula Class (m5), Ambassador Civilian Refit (m4), Akira Class (m4), Tamarian Warship (m4) |
| lightCruiser | 2 | 22 | Steamrunner Class (m4), Alien Bioship (m6), Orion Starbridge (m3), Promelli Skiff (m4), Aurelius Patrol Frigate (m3) |
| fastCruiser | 2 | 10 | sydney Class (m3), Vulcan Light Cruiser (m4), Belfast Class (m4), Kaplan F17 Freighter (m4), Norexan Warbird (m6) |
| escort | 1 | 22 | Vega Class (m4), Delpin Warship (m3), Nausican Raider (m3), Freedom Class (m2), Human Bird of Prey (m4) |
| shuttle | 0 | 29 | Lysian Fighter (m1), Vulcan Warpship (m1), Romulan Scout (m1), Dominion Scout (m1), Venture Class (m1) |
| **total** | | **174** | |

Target requirement = the towed class's mass (1–10). Masses in the catalogue: shuttles 1–2, escorts 2–4, light cruisers 2–6, cruisers 4–7, capitals 5–8, battleships 6–10.

| id | Class | Faction | mass | recoveryCapacity | basis |
|---|---|---|---|---|---|
| 10 | Tug Class II | terran | 3 | 10 | category:heavyTug |
| 47 | Oberth Tug | terran | 2 | 8 | category:tug |
| 340 | Constitution Utility Tug | neutral | 4 | 8 | category:tug |
| 341 | Constellation Cargo Tug | neutral | 4 | 8 | category:tug |
| 264 | California Class | terran | 5 | 7 | category:support |
| 271 | Parliament Class | terran | 6 | 7 | category:support |
| 300 | Sutherland Class | terran | 6 | 7 | category:support |
| 342 | Olympic Support Ship | neutral | 5 | 7 | category:support |
| 42 | Neg'Var Warship | klingon | 7 | 6 | category:battleship |
| 49 | Galaxy Dreadnaught | terran | 8 | 6 | category:battleship |
| 60 | Concord-class Grand Cruiser | neutral | 6 | 6 | category:battleship |
| 61 | Klingon Qonos | klingon | 9 | 6 | category:battleship |
| 62 | Cardassian Behemoth | cardassian | 10 | 6 | category:battleship |
| 63 | Vulcan Lifeform | vulcan | 6 | 6 | category:battleship |
| 64 | Romulan Warhawk | romulan | 9 | 6 | category:battleship |
| 65 | Dominion Battleship | dominion | 10 | 6 | category:battleship |
| 66 | Tholian Conquest | tholian | 10 | 6 | category:battleship |
| 224 | Son'a Battleship | sona | 9 | 6 | category:battleship |
| 232 | Tholian Battleship | tholian | 8 | 6 | category:battleship |
| 261 | Tactical Cube | borg | 10 | 6 | category:battleship |
| 333 | Negh'Var Command Ship | klingon | 8 | 6 | category:battleship |
| 346 | Borg Assimilation Cube | borg | 10 | 6 | category:battleship |
| 347 | Excalibur Class | terran | 10 | 6 | category:battleship |
| 26 | Vulcan Explorer | vulcan | 5 | 5 | category:capital |
| 35 | Galaxy Class | terran | 6 | 5 | category:capital |
| 38 | Sovereign Class | terran | 6 | 5 | category:capital |
| 48 | Jem'Hadar Battlecruiser | dominion | 7 | 5 | category:capital |
| 51 | Delpin Luxury Liner | delpin | 5 | 5 | category:capital |
| 53 | Reman Warbird | romulan | 7 | 5 | category:capital |
| 211 | Vulcan Expeditionary Explorer | vulcan | 7 | 5 | category:capital |
| 213 | Imperial Class | terran | 7 | 5 | category:capital |
| 221 | Galaxy Command Variant | terran | 7 | 5 | category:capital |
| 246 | Classic Warbird | romulan | 8 | 5 | category:capital |
| 254 | Hirogen Warship | hirogen | 8 | 5 | category:capital |
| 289 | Inquiry Class | terran | 7 | 5 | category:capital |
| 299 | Sagan Class | terran | 7 | 5 | category:capital |
| 320 | D'deridex Warbird | romulan | 8 | 5 | category:capital |
| 324 | Keldon War Cruiser | cardassian | 6 | 5 | category:capital |
| 329 | Sovereign Command Cruiser | terran | 7 | 5 | category:capital |
| 9 | Kingston Class | neutral | 3 | 4 | category:freighter |
| 50 | Sentient Lifeform | neutral | 5 | 4 | category:freighter |
| 215 | Tarellian Freighter | neutral | 6 | 4 | category:freighter |
| 223 | Tholian Cargo Ship | tholian | 4 | 4 | category:freighter |
| 236 | Salcombe class | terran | 4 | 4 | category:freighter |
| 238 | Dominion Freighter | dominion | 4 | 4 | category:freighter |
| 239 | Klingon Cargo Ship | klingon | 4 | 4 | category:freighter |
| 244 | Beijing Class | terran | 4 | 4 | category:freighter |
| 277 | Romulan Freighter | romulan | 4 | 4 | category:freighter |
| 278 | Romulan Miltek | romulan | 6 | 4 | category:freighter |
| 292 | Cardassian Transport Ship | cardassian | 4 | 4 | category:freighter |
| 309 | Deforest Armed Freighter | neutral | 3 | 4 | category:freighter |
| 318 | Tholian Isaac Freighter | tholian | 6 | 4 | category:freighter |
| 331 | K't'inga Cargo Cruiser | klingon | 4 | 4 | category:freighter |
| 2 | Excelsior Class | terran | 4 | 3 | category:cruiser |
| 4 | Nebula Class | terran | 5 | 3 | category:cruiser |
| 15 | Ambassador Civilian Refit | neutral | 4 | 3 | category:cruiser |
| 33 | Akira Class | terran | 4 | 3 | category:cruiser |
| 54 | Tamarian Warship | neutral | 4 | 3 | category:cruiser |
| 216 | Dominion Cruiser | dominion | 6 | 3 | category:cruiser |
| 218 | Breen Warship | breen | 5 | 3 | category:cruiser |
| 219 | Son'a Warship | sona | 6 | 3 | category:cruiser |
| 220 | Azuki | terran | 5 | 3 | category:cruiser |
| 227 | Promelli Manitee | promelli | 7 | 3 | category:cruiser |
| 231 | Manticore Class | terran | 6 | 3 | category:cruiser |
| 242 | Austin Class | terran | 6 | 3 | category:cruiser |
| 248 | Eisenhower Class | neutral | 6 | 3 | category:cruiser |
| 251 | Gorn Cruiser | gorn | 6 | 3 | category:cruiser |
| 253 | Hirogen Hunter | hirogen | 6 | 3 | category:cruiser |
| 255 | K'tra Class | klingon | 6 | 3 | category:cruiser |
| 256 | Renux Class | romulan | 6 | 3 | category:cruiser |
| 257 | Suliban Cruiser | suliban | 5 | 3 | category:cruiser |
| 260 | T'Pral Class | vulcan | 6 | 3 | category:cruiser |
| 262 | Terra Class | terran | 7 | 3 | category:cruiser |
| 265 | Crossfield Class | terran | 5 | 3 | category:cruiser |
| 268 | Independent Warbird | neutral | 6 | 3 | category:cruiser |
| 270 | Onyx Class | neutral | 5 | 3 | category:cruiser |
| 279 | Romulan Warbird | romulan | 7 | 3 | category:cruiser |
| 280 | Terran Constitution | terran | 4 | 3 | category:cruiser |
| 283 | Cheyenne Class | terran | 5 | 3 | category:cruiser |
| 284 | Constitution III Class | terran | 6 | 3 | category:cruiser |
| 285 | Duderstadt Class | terran | 5 | 3 | category:cruiser |
| 286 | Excelsior II Class | terran | 6 | 3 | category:cruiser |
| 287 | Gagarin Class | terran | 6 | 3 | category:cruiser |
| 293 | Kumari Class | andorian | 5 | 3 | category:cruiser |
| 313 | Ambassador Imperial Cruiser | terran | 5 | 3 | category:cruiser |
| 315 | Ferengi Marauder Refit | ferengi | 5 | 3 | category:cruiser |
| 319 | Delpin Long-Range Cruiser | delpin | 4 | 3 | category:cruiser |
| 323 | Galor Cruiser | cardassian | 5 | 3 | category:cruiser |
| 328 | Prometheus Tactical Cruiser | terran | 5 | 3 | category:cruiser |
| 334 | Vor'cha Attack Cruiser | klingon | 6 | 3 | category:cruiser |
| 343 | Vulcan C'Thia Defense Cruiser | vulcan | 5 | 3 | category:cruiser |
| 1 | Steamrunner Class | neutral | 4 | 2 | category:lightCruiser |
| 55 | Alien Bioship | neutral | 6 | 2 | category:lightCruiser |
| 209 | sydney Class | terran | 3 | 2 | category:fastCruiser |
| 225 | Orion Starbridge | neutral | 3 | 2 | category:lightCruiser |
| 226 | Promelli Skiff | promelli | 4 | 2 | category:lightCruiser |
| 230 | Aurelius Patrol Frigate | terran | 3 | 2 | category:lightCruiser |
| 234 | Breen Light Cruiser | breen | 4 | 2 | category:lightCruiser |
| 237 | Vulcan Light Cruiser | vulcan | 4 | 2 | category:fastCruiser |
| 240 | Andorian Patrol Cruiser | andorian | 4 | 2 | category:lightCruiser |
| 241 | Astrid Class | terran | 4 | 2 | category:lightCruiser |
| 245 | Belfast Class | terran | 4 | 2 | category:fastCruiser |
| 247 | Drayton Class | neutral | 2 | 2 | category:lightCruiser |
| 249 | Ford Class | neutral | 4 | 2 | category:lightCruiser |
| 266 | Diana Class | terran | 4 | 2 | category:lightCruiser |
| 276 | Helios Class | neutral | 4 | 2 | category:lightCruiser |
| 282 | Althinas Class | neutral | 4 | 2 | category:lightCruiser |
| 290 | Intrepid Frigate | neutral | 2 | 2 | category:lightCruiser |
| 291 | Kaplan F17 Freighter | neutral | 4 | 2 | category:fastCruiser |
| 294 | Luna Class | terran | 5 | 2 | category:lightCruiser |
| 295 | Norway Class | terran | 4 | 2 | category:lightCruiser |
| 298 | Reliant Class | terran | 5 | 2 | category:lightCruiser |
| 302 | Trieste Class | neutral | 4 | 2 | category:lightCruiser |
| 312 | Centaur Reserve Cruiser | neutral | 3 | 2 | category:lightCruiser |
| 317 | Ferengi Vagabond | ferengi | 4 | 2 | category:lightCruiser |
| 321 | Norexan Warbird | romulan | 6 | 2 | category:fastCruiser |
| 322 | Jem'Hadar Attack Ship | dominion | 2 | 2 | category:fastCruiser |
| 325 | Akira Strike Cruiser | terran | 4 | 2 | category:fastCruiser |
| 327 | Intrepid Explorer | terran | 4 | 2 | category:lightCruiser |
| 336 | New Orleans Civilian Refit | neutral | 4 | 2 | category:lightCruiser |
| 338 | Tarellian Quantum Cruiser | tarellian | 6 | 2 | category:fastCruiser |
| 344 | Steamrunner Strike Frigate | terran | 4 | 2 | category:fastCruiser |
| 351 | Klingon Bird of Prey | klingon | 2 | 2 | category:fastCruiser |
| 11 | Vega Class | terran | 4 | 1 | category:escort |
| 22 | Delpin Warship | delpin | 3 | 1 | category:escort |
| 207 | Nausican Raider | neutral | 3 | 1 | category:escort |
| 214 | Freedom Class | neutral | 2 | 1 | category:escort |
| 217 | Human Bird of Prey | terran | 4 | 1 | category:escort |
| 252 | Gorn Patrol Ship | gorn | 3 | 1 | category:escort |
| 259 | Suliban Cell Ship | suliban | 2 | 1 | category:escort |
| 269 | NX Class | neutral | 2 | 1 | category:escort |
| 274 | Daedalus Class | terran | 2 | 1 | category:escort |
| 275 | Falcon Class | terran | 3 | 1 | category:escort |
| 288 | Gorn Interceptor | gorn | 2 | 1 | category:escort |
| 296 | Orion Science Ship | neutral | 4 | 1 | category:escort |
| 297 | Penine Class | neutral | 2 | 1 | category:escort |
| 301 | Thawn Class | neutral | 3 | 1 | category:escort |
| 305 | Miranda Long-Range Frigate | terran | 3 | 1 | category:escort |
| 306 | Nova Surveyor | terran | 2 | 1 | category:escort |
| 307 | Saber Planetary Defender | terran | 2 | 1 | category:escort |
| 310 | Aries Multipurpose Vessel | neutral | 4 | 1 | category:escort |
| 311 | Mozart Civilian Explorer | neutral | 3 | 1 | category:escort |
| 326 | Defiant Escort | terran | 3 | 1 | category:escort |
| 332 | K'Vort Patrol Ship | klingon | 3 | 1 | category:escort |
| 335 | Akuzi Explorer | neutral | 2 | 1 | category:escort |
| 24 | Lysian Fighter | neutral | 1 | 0 | category:shuttle |
| 25 | Vulcan Warpship | vulcan | 1 | 0 | category:shuttle |
| 29 | Romulan Scout | romulan | 1 | 0 | category:shuttle |
| 206 | Dominion Scout | dominion | 1 | 0 | category:shuttle |
| 208 | Venture Class | neutral | 1 | 0 | category:shuttle |
| 210 | Vulcan shuttle | vulcan | 1 | 0 | category:shuttle |
| 212 | Romulan Courier | romulan | 1 | 0 | category:shuttle |
| 222 | Tholian Shuttle | tholian | 1 | 0 | category:shuttle |
| 228 | Peregrin Fighter | terran | 2 | 0 | category:shuttle |
| 229 | Sovereign Yacht | terran | 2 | 0 | category:shuttle |
| 233 | Breen Shuttle | breen | 1 | 0 | category:shuttle |
| 235 | Son'a Shuttle | sona | 1 | 0 | category:shuttle |
| 243 | Avon Class | terran | 1 | 0 | category:shuttle |
| 250 | Galaxy Yacht | terran | 2 | 0 | category:shuttle |
| 258 | Suliban Pod | suliban | 1 | 0 | category:shuttle |
| 263 | Type 7 Shuttle | terran | 1 | 0 | category:shuttle |
| 267 | Hirogen Shuttle | hirogen | 1 | 0 | category:shuttle |
| 272 | Speeder | terran | 1 | 0 | category:shuttle |
| 273 | Type 11 Shuttle | terran | 1 | 0 | category:shuttle |
| 281 | Aeroshuttle | terran | 2 | 0 | category:shuttle |
| 303 | Warp Delta | neutral | 1 | 0 | category:shuttle |
| 308 | Danube Utility Runabout | terran | 1 | 0 | category:shuttle |
| 314 | Cardassian Hideki Shuttle | cardassian | 1 | 0 | category:shuttle |
| 316 | Ferengi Cargo Shuttle | ferengi | 1 | 0 | category:shuttle |
| 330 | B'rel Scout | klingon | 1 | 0 | category:shuttle |
| 345 | Bajoran Solar Sailor | bajoran | 1 | 0 | category:shuttle |
| 348 | Andorian Cargo Shuttle | andorian | 1 | 0 | category:shuttle |
| 349 | Utility Shuttle | neutral | 1 | 0 | category:shuttle |
| 350 | Basic Shuttle | neutral | 1 | 0 | category:shuttle |


## 3. Outbound

The tug flies to the hulk through the shared journey engine (`startJourney`, kind `recovery`, purpose
`recovery`). It flies:
- at its group's strategic speed, the slowest of tug and escorts;
- leg by leg, crossing every intermediate system once;
- running every applicable blockade through the shared engine, with a turned-back retreat replotted
  around the blockade;
- through save/load mid-leg, keeping its vids.

At every boundary, the journey's `valid` hook re-checks that the mission is still open and the hulk still
lies where it did. There is no other path.

## 4. On scene

On arrival the mission checks, again and here:
- the hulk still exists;
- it is still in that system;
- it is still disabled and not already in a yard;
- the claim still holds (the claim matrix, §10);
- the tug is operational and still capable.

If the hulk was destroyed, broken up, captured, recovered or taken by someone else, the mission closes
`aborted`, and the hulk is never duplicated.

## 5. Towing

The towing group sets out with the **hulk as a member** of the same journey record. The journey carries
`tow { targets[hullId], penalty, need, recoveryId }`. The hulk:
- has `stranded.recovery = 'under_tow'` and `towedBy` = the mission;
- is never detached as "disabled" at a crossing; it is carried where the group goes;
- does not operate independently: it is disabled, in warp or held, so `hullUnavailable`, evacuation and
  journey starts all refuse it;
- gives no combat strength (not an operational runner);
- runs blockades with the group and can be hit, even destroyed (§8).

Its crew, if aboard, are kept alive by the tug: the life-support clock stops at attachment
(`crewSupportedBy`) and resumes with what was left of it only if the tow is lost or the yard is lost
before the repair.

## 6. Tow speed

```
towSpeed = clamp( min(towing group speed, towed frame speed) × 0.7 , 0.4 , 1.0 )
```

- **Towing group speed:** the slowest able member, escorts included, so escorts can only slow it.
- **Towed frame speed:** the hulk's class strategic speed. A fast scout cannot tow a heavy hull at scout
  speed, and it has no capacity to tow one anyway.
- **Penalty:** `towPenalty` 0.7, one constant. The bounds are `JOURNEY_SPEED_MIN` 0.4 and
  `TOW_SPEED_MAX` 1.0. Class speeds are still authored within [0.6, 1.5]; only a journey may go below 0.6.
- Legs are `max(1, round(chart days / towSpeed))`, as for every journey, so a tow is never instant and
  never 0 days.
- The tow speed is re-applied at every boundary, on replot and on retreat (`journeySpeed`).

Examples:

| tug | towed | towSpeed | an 11-day chart leg |
|---|---|---|---|
| utility tug 0.8× | escort 1.2× | min(0.8, 1.2) × 0.7 = 0.56× | 20 days (the tug alone: 14) |
| utility tug 0.8× + escort 1.2× | escort 1.2× | 0.56× (the escort does not hurry it) | 20 days |
| heavy tug 0.8× | battleship 0.85× | 0.56× | 20 days |
| cruiser 1.0× | shuttle 1.15× | 0.7× | 16 days |
| support cruiser 1.0× | capital 0.9× | 0.63× | 17 days |
| any | any | never above 1.0×, never below 0.4× | — |

**Special routes.**
- A wormhole-only edge (`world.legFixed`, the Bajoran wormhole) is **unavailable to a tow**. Tow routes
  are plotted without fixed traversals (`plotJourney(…, { noFixed: true })`), and `startJourney` refuses a
  tow plan that includes one. This is unavailable rather than invented.
- An outbound tug may still use the wormhole.
- No other route type is special.

## 7. Formation towing

A mission can carry escorts with the tug, all from the same system.
- **Speed:** escorts are part of the towing group, so they can only slow the tow (§6).
- **Survival:** they add their fighting value to the blockade run, so they improve its odds (pure 14).
- **The hulk stays in tow only while a member able to tow it is with it:** the tug, or another operational
  ship whose capacity covers the hulk.
- **When the last capable towing ship is lost or disabled** (in warp, at a crossing, in a run or in a
  tactical fight), the hulk is **let go where the towing group last stood**:
  - lost in warp: the leg's start;
  - lost at a crossing: that system.

  It is never dragged onward. The journey ends there, any escorts left go free where they stand, and the
  mission closes `failed`. The hulk is stranded again (`awaiting_recovery`) and a new mission can be sent
  for it (RECOVERY-TUG-LOSS).

## 8. Blockades and interception

There is no separate tow resolver. A tow group crossing a blockade is run once through the same engine
(`runJourneyBlockades` → `resolveBlockadeRun`), as a `recovery` journey's runner. The hulk is in the runner
(`towed: true`) and the group is:

| | effect |
|---|---|
| **slower** | the runner dashes at its tow speed (`runner.towSpeed`), not its tug's: the existing `(runner ÷ blockade)²` term |
| **easier to see** | the hulk's mass counts in the signature, plus `towSignature` 0.2; a tow also spoils any cloak |
| **more vulnerable** | the hulk takes an unarmed ship's share of any fight's damage, so it can be finished off; the existing escort cover still applies |
| **better with escorts** | the escorts' fighting value enters the existing deterrence and cover terms |

**Where the captain is,** an interception goes through the accepted strategic ↔ tactical handoff. The
same tug and escorts are in the scene, their fates are written back, and the crossing is held and released
once. The hulk is a participant with `spawn: false, towed: true`:
- it is **not rendered in the scene**;
- its strategic record stands;
- if its tug is lost there, it is let go at that system.

This is a documented visual limitation: drawing a towed hulk in tactical space would need a new scene
object, so none is cloned.

## 9. Crew rescue and hull recovery are separate

| crew | what a recovery does |
|---|---|
| **aboard** | It recovers people and hull together. The tug supports them from attachment (no life-support loss under tow). Delivered, they are ashore at the yard. Repaired, she is back with her own crew. |
| **rescued** (taken off earlier, `rescueStrandedCrew`) | It tows her in empty. Repaired, she enters **repaired-awaiting-crew** (`recrew`) and stays out of action until the ordinary crew recovery reaches `minOperatingCrew`. Arriving at a yard never recreates a crew. |
| **lost** | The same: towed in empty, repaired, awaiting crew. A salvaged hull is always crewless (salvage requires it). |

The captain's own vessels have no crew clock in the model (the engine keeps them). Their crew are
reported as aboard, and his repair path is unchanged.

## 10. Recovery vs salvage, and the claim matrix

Recovery: the owner wants its own hull back. Salvage: someone else's, or nobody's, hull is claimed. The
rules are in `claimVerdict`, checked when requested and again on scene:

| claimant vs hulk | crew aboard | crew rescued / lost | abandoned (written-off derelict) |
|---|---|---|---|
| its own owner | **recovery** | **recovery** | **recovery** (a reclaimed derelict, back on its books) |
| a power at war with the owner | refused: crewed (a capture, not a salvage) | **salvage**, unless protected | **salvage**, unless protected |
| a power not at war with the owner | refused | refused: not abandoned, and its owner is not at war with you | **salvage** |
| anyone, on the captain's vessels | refused: the captain's vessels are not salvage | refused | — (they are never written off) |

**Protection** applies on top of the table to any salvage, even of a derelict whose abandoner still holds
the system:
- the hulk lies in its owner's space ("protected");
- an operational ship of its owner's stands in the system ("guarded");
- another live mission already claims it ("already claimed").

A surrendered hull follows the Phase 4 surrender rules and is never salvage.

On attachment, a salvaged hulk **changes hands as the same record**:
- the same vid, class, damage and equipment;
- the same `identity.origin.builder`;
- a `salvaged` provenance entry (from → to);
- `salvagedFrom` on the record;
- the new owner's write-off clock starts then.

The old owner counts it as lost. Allied recovery is not modelled: the model has no alliance relation that
would grant it.

## 11. Prize integration

The captain's salvage of an AI hulk works like this:
1. At attachment the model takes the hull off its owner's books (`transferHullOut`, event `salvaged`) and
   emits `hullSalvagedToPlayer` with its identity.
2. The engine adopts **that identity** into the captain's fleet (`adoptSalvagedToPlayer`), disabled, at
   the hulk's system, with `takenFrom` set and the same class and damage.
3. The tow then sets out with the adopted vessel.

This is the accepted persistent-hull path. Nothing goes on a prize shelf and no stock ship is minted. The
PLAYER-SALVAGE gate checks that the vid is unchanged, the origin is Klingon, exactly one vessel joined,
the Klingon books no longer hold it, and the prize shelf is unchanged.

## 12. Destination

A yard is usable when it is:
- for an AI power, its own system with repair capacity;
- for the captain, his own yard or a yard in a system whose holder is not at war with him;
- in either case, not under an applicable blockade.

It is chosen by the days the tow will actually fly (tow speed, no fixed edges), not by jumps. At every
boundary of the tow the yard is re-checked:
- **No longer usable** (it changed hands or is blockaded): the tow re-chooses from where it is and replots
  there (pure 23).
- **Nothing is reachable:** it holds where it is, retrying daily, and after `recoveryWaitDays` (20) lets
  the hulk go there.

It never delivers into a hostile yard.

## 13. Delivery and repair

Arriving delivers nothing repaired.
- **AI hulk:** it enters the yard's ordinary recovery (`recovering` → `in_yard` after
  `strandedRecoveryDays`, 2), then the ordinary yard repair at the yard's capacity, over days. On
  completion the Phase 3 rules apply unchanged: back with its crew, or `recrew` until crewed.
- **Captain's vessel:** she lies at the yard, still disabled ("Disabled — awaiting repair"), until the
  captain docks there and pays for the repair, the existing §6 production repair path.

## 14. Stranded-hull lifecycle

```
disabled ──▶ stranded: awaiting_recovery ──(own yard here)──▶ recovering ─▶ in_yard ─▶ repaired ─▶ (recrew) ─▶ operational
                 │                                                ▲
                 │ mission claims it                              │ delivered (tow arrives)
                 ▼                                                │
           claimed ──tug arrives──▶ under_tow ──────────────────────┘
                 │                    │ tug lost: let go where it stood ─▶ awaiting_recovery (a new mission may come)
                 │ cancelled/aborted ─▶ awaiting_recovery (untouched, where it lay)
                 ▼
  crewless + unclaimed for derelictWriteOffDays (90) ─▶ written off: off the owner's books, the WRECK STAYS
                 (book.derelicts, salvageable, identity intact) ─▶ breaks up after derelictLifeDays (365),
                 or the oldest beyond maxDerelicts (60): only then is its identity retired
```

**Write-off (§17 of the brief).**
- A hulk with a live recovery or salvage claim (a mission under way, in tow) is **never written off**
  while the claim lasts. The captain's own vessels are never written off.
- A written-off hull keeps `fate: 'written_off'` and status `lost`: it is removed from its owner's fleet
  and accounting, and counted lost.
- The physical wreck persists in `book.derelicts` with:
  - the same record (class, damage, identity, stranded crew state);
  - `derelict { since, systemIndex, abandonedBy, until }`.
- It is salvageable by anyone (§10), or reclaimable by its former owner, until it breaks up.
- A failed recovery restarts the owner's write-off clock. A hulk whose yard was lost after delivery is out
  in the open again with its crew clock running.

## 15. The captain's controls

- **Fleet & Shipyard, each disabled vessel's row:**
  - with no mission: **Request recovery**, with one line saying what it would take: "Recovery possible —
    Tug Atlas · tug arrives in 15 days · Vulcan day 77", or "No recovery vessel free that can tow her
    (needs tow capacity 2)";
  - assigned: "Recovery assigned — Tug Atlas · tug arrives day 46", with **Cancel recovery** until the
    hulk is made fast;
  - towing: "Under tow → Vulcan · tow ETA day 77", or "Under tow — holding at X: …".
- **Hulks in sight** (the captain's system and systems where his ships are stationed): each hulk with its
  claim verdict and, when claimable and a ship of his can tow it, **Salvage**.
- **Reports:** Recovery assigned / Under tow / Recovered to yard / Recovery failed / Recovery called off.
- A tug must be free: stationed, not escorting, not trading, not held, not in the loaded scene.

## 16. The AI

Every `aiRecoveryIntervalDays` (5), each power with a capable tug free may send it for its most worthwhile
hulk: its own first, then salvage at a higher bar. Never more than `aiRecoveryMaxPerPolity` (2) at once.

It skips, and records why (`stats.recovery.skipped`), a hulk that is:
- worth less than `aiRecoveryMinValue` (60,000), or for salvage `aiSalvageMinValue` (90,000);
- out of reach of any of its vessels able to tow it;
- more than `aiRecoveryMaxDays` (70) away, outbound plus tow;
- below `aiRecoveryValuePerDay` (1,500) per day of the tug's time;
- behind a blockade on the way out or back, or lying in an enemy-held system;
- reachable only by a tug that would leave a world it holds with fewer than `recoveryGarrisonFloor` (1)
  ready hulls.

It never builds, spawns or conjures a tug. With none free, the hulk waits, or is written off by the usual
rule.

## 17. Save / load

Everything is on the campaign book and the shared journey records:
- the hulk (its stranded state, `under_tow`, `towedBy`, claim);
- the mission (state, routes, attachment, tow destination, claim, crew, plan, waiting);
- the tug and escorts (`opId`);
- the journeys: route, legs, `legBase`, `tow`, speed, leg timing and crossings.

A reload restores the mission exactly:
- the same leg ETA, the same tow speed and route, no re-plot from the origin;
- no duplicated hulk, no respawned tug, no hulk teleported to the tug, nothing repaired early;
- no crossing repeated (pure 3 and 30/31/32; the gate's player missions are on the same records).

`upgradeCampaignBook` adds `hullRecoveries` and `derelicts` to an older save; an older save has neither,
and its hulks simply wait as before.

## 18. Debug

The **Recovery & salvage (debug)** section (`[data-recovery-section]`) shows:
- **Totals:** missions, launched, delivered, failed, aborted, tug losses, salvage claims, derelicts and AI
  skips.
- **Each mission:**
  - target vid and class;
  - owner and origin;
  - system and crew;
  - recovery state, holding or not;
  - tug or formation;
  - **capability vs needed**;
  - route out and back, with the leg in flight;
  - **tow speed**;
  - destination yard;
  - claim;
  - completion or failure, and after delivery what became of the hull (in the yard, repaired, or
    repaired — awaiting crew).
- **Stranded, no recovery assigned:** every disabled hull nobody is coming for, plus the derelicts, each
  with its tow requirement.

## 19. Gates

| gate | candidate | 78cd8fa (baseline reproduction) |
|---|---|---|
| towing pure (`test:towing`) | **29/29** (baseline-defect 4/4, new-feature 23/23, preservation 2/2) | 2/29. The four baseline-defect checks fail, BEFORE/AFTER on its own assertion: "after 200 days the hulk still lies at Minor (awaiting_recovery)". Preservation 2/2: the stranded hulk stays put; the existing suites run green. |
| towing in-game (`test:towing:ingame`) | **4/4** (baseline-defect 1/1, new-feature 3/3) | 0/4: "no towing on this build: after 30 days she still lies at Tellar with no way to send a tug". |
| disabled hulls / crewless repaired (`test:disabled-hulls`, `:crew`) | 6/6 · 7/7 (unchanged) | — |
| doctrine Phase 3 pure / in-game | 30 · 16/16 (unchanged) | — |
| movement / time-scale / speed / handoff pure | 27/27 · 21/21 · 25/25 · 29/29 (run as-is by the towing suite's check 33/34) | — |
| movement / time-scale / speed / handoff in-game | pass (unchanged) | — |
| **full normal suite, clean worktree** | **81/81 exit 0** (build + 80 scripts; `logs/suite/GATE-SUMMARY.txt`) | — |

No existing test or gate had to be changed for this round.

**The 34 required regressions, mapped to the pure suite** (in-game coverage in brackets):

| # | check |
|---|---|
| 1 | 1 |
| 2, 4 | 2/4 [STRANDED-THEN-RECOVERED] |
| 3 | 3 |
| 5, 6 | 5/6 |
| 7, 8 | 7/8 [STRANDED-THEN-RECOVERED: tow slower than the tug] |
| 9, 10 | 9/10 |
| 11, 12, 26 | 11/12/26/RECOVERY-TUG-LOSS, 12b, 15 |
| 13 | 13 [TOW-BLOCKADE] |
| 14 | 14 |
| 15 | 15 |
| 16 | 16 [STRANDED-THEN-RECOVERED, CREWLESS-AWAITING-CREW] |
| 17, 19 | 17/19 [CREWLESS-AWAITING-CREW] |
| 18 | 18, 18b |
| 20, 21 | 20/21/ENEMY-SALVAGE [PLAYER-SALVAGE] |
| 22 | 22 |
| 23 | 23 |
| 24 | 24, 24b |
| 25 | 25 |
| 27 | 27 |
| 28 | 28 |
| 29 | 29 [STRANDED-THEN-RECOVERED: delivered on the requested day] |
| 30, 31, 32 | 30/31/32 |
| 33, 34 | 33/34, plus the full suite |

**Integrated scenarios:** STRANDED-HULL-RECOVERY, RECOVERY-TUG-LOSS, ENEMY-SALVAGE (pure), and
PLAYER-SALVAGE (in game).

**Independent review.** A separate reviewer read the change. Ten findings, all fixed:

1. A tow could go on after its tug was lost, pulled by escorts that could not tow. It now needs a capable
   towing ship (pure 12b).
2. A delivered hulk's crew became immortal if the yard was lost before repair. The clock now resumes
   (pure 18b).
3. The write-off clock was not restarted on change of owner, reclaim or failed recovery.
4. A mission whose journey was halted silently stayed open for ever. There is now a watchdog (pure 24b).
5. Ships that dropped out were held until the mission closed. They are now freed where they drop out.
6. A tow turned back after the mission closed still retreated as a tow.
7. The captain's salvage of a live hull was recorded as a capture. It is now a `salvaged` provenance
   entry.
8. A player hulk held by another operation could be taken for a tow.
9. Closed mission records were never pruned. The newest 60 are now kept.
10. A dropped tow ended without its `journeyEnded` effect.

## 20. Measurements

The default campaign advanced 400 days on one seed (`fresh('tow-longrun')`), the candidate against 78cd8fa
(`npm run measure:towing`; the baseline with `BM1_TEST_ROOT=<78cd8fa>/dist BM1_LONGRUN_LABEL=baseline`). It
is not a balance claim, and the two histories diverge after the first tow.

| measure | candidate | 78cd8fa |
|---|---|---|
| hulls ever stranded (AI powers) | 10 | 14 |
| stranded at once, max / mean per day | 4 / 1.7 | 5 / 2.3 |
| stranded at the end, by state | {"awaiting_recovery":2} | {"awaiting_recovery":5} |
| recovery requests / refused | 7 / 0 | 0 / 0 |
| missions launched | 7 | 0 |
| successful (delivered to a yard) | 6 | 0 |
| failed / aborted | 0 / 0 | 0 / 0 |
| tug losses / hulks lost under tow | 0 / 0 | 0 / 0 |
| missions by kind | {"salvage":2,"recovery":5} | {} |
| missions by sponsor | {"terran":5,"klingon":2} | {} |
| mean outbound ETA (days) | 29.4 | null |
| mean tow ETA (days) | 33.8 | null |
| mean / max request → delivery (days) | 43.17 / 68 | null / null |
| tow speeds: n, mean, min–max | 4, 0.65, 0.6–0.7 | 0, null, null–null |
| salvage claims / salvaged | 2 / 2 | 0 / 0 |
| hull value recovered (class price) | 959000 | 0 |
| AI recoveries skipped (by reason) | 63 {"too far":54,"no vessel able to tow it":5,"too dangerous":4} | 0 {} |
| written off / derelicts now / max / broken up | 1 / 1 / 1 / 0 | (not counted on 78cd8fa) / 0 / 0 / 0 |
| open recoveries at once (max) | 2 | 0 |
| tugs busy at once, by power (max) | {"terran":2,"klingon":1} | {} |
| crewless repaired hulls back in action | 0 | 0 |
| duplicate identities | 0 | 0 |
| save size / campaign book (bytes) | 952460 / 831152 | 910613 / 791637 |
| recovery state in the book (bytes) | 10435 | 4 |
| ms per campaign day | 101.15 | 99.01 |
| hulls lost / battles | 35 / 33 | 45 / 34 |

Lowest number of ready, uncommitted hulls per power over the run (candidate / 78cd8fa): terran 19/19, andorian 9/9, vulcan 12/12, ferengi 6/6, tholian 16/16, klingon 23/22, delpin 5/5, romulan 19/19, borg 1/1, cardassian 34/34, bajoran 6/6, sona 1/2, tarellian 6/6, promelli 6/6, breen 8/8, dominion 29/29, hirogen 3/3, suliban 2/5, dominion_remnant 4/4.

**Watch items**

| watch for | what the run shows |
|---|---|
| every AI hull getting a tug | No. 7 missions for 10 stranded hulls over 400 days. 63 candidate tows were skipped and recorded: 54 too far, 5 with no vessel able to tow, 4 too dangerous. At most 2 tugs were busy at once for any power. |
| recovery fleets draining garrisons | No. The lowest ready count per power is unchanged within ±1, except the Suliban (2 against 5). The Suliban had no recovery mission, so that comes from the different history, not from tugs. |
| missions taking absurdly long | Mean 43 days from request to delivery, at most 68. The outbound legs average 29 days and the tow 34. `aiRecoveryMaxDays` (70) bounds the AI. |
| abandoned hulls accumulating without bounds | 1 derelict at the end. They are bounded by `derelictLifeDays` (365) and `maxDerelicts` (60). Stranded hulls at the end: 2 (5 on 78cd8fa). |
| duplicate prize hulls | 0 duplicate identities. Salvage moved the same records (2 salvaged); the player-side check is the PLAYER-SALVAGE gate. |
| tow speed too fast | The tows flew at 0.60–0.70× (mean 0.65×), always below the tug's own speed. The formula caps them at 1.0×. |
| recovered zero-crew vessels returning to combat | 0. No repaired hull with `recrew` was ready or assigned at any point. |
| save-state impact | The recovery and derelict records are 10 KB; the save is 952 KB against 911 KB. Time per day is unchanged within noise (101 against 99 ms). |

## 21. Carry-forward: individual / class-specific strategic speed refinement

The category speeds of SHIP-DEPENDENT-STRATEGIC-SPEED (0.8× freighter, 0.85× battleship, 0.9× capital,
1.0× cruiser, 1.1×/1.2× light/fast, 1.3× scout) are **accepted as a good first implementation, not the
final speed model**. Size category should not decide speed by itself.
- A Sovereign-class should be strategically faster than many smaller ships despite being a large capital.
- Some scouts are fast, but not automatically faster than every cruiser or capital.
- Old or low-performance small ships may be slower than modern large ones.

Role and size give a default only; explicit class capability takes precedence. The future lookup is:

```
explicit class strategic speed  →  class / family fallback  →  role / category default  →  safe global default (1.0)
```

The field and its basis already allow this. `strategicSpeedBasis: "authored"` is kept by the assignment
script; what is missing is the per-class lore pass and the family layer. That pass was **not done in this
round**.

Damage-based (engine-condition) strategic speed penalties stay on this same future list, unless a proper
engine-condition model is added first. The tow penalty of this round is a property of towing, not of
damage.

## 22. Still deferred

1. **individual / class-specific strategic speed refinement**:
   - Sovereign-style explicit overrides;
   - category only as a fallback;
   - damage and engine-condition penalties later.
2. trader record-shape consolidation
3. treaty expansion: DMZs, inspection regimes, tribute, reparations, basing rights, transit guarantees
4. NPC tactical-scene persistence
5. autonomous war declarations
6. doctrine invasion/occupation
7. broad covert doctrine
8. Hirogen hunting
9. Borg assimilation
10. Gorn activation
11. Tactical Cube

**Known limits of this round:**
- one tug per hulk (no multi-ship tows of the heaviest hulls);
- a towed hulk is not drawn in the tactical scene (§8);
- no allied recovery (there is no alliance relation in the model);
- the captain's vessels have no crew clock and are never written off or salvaged by the AI;
- a pre-round save's contracts and missions are unchanged.

Towing/salvage and stranded-hull recovery movement, deferred since DOCTRINE-RUNTIME-PHASE3, is done and off
the list.
