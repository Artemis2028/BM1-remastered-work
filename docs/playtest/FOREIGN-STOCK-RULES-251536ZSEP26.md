# Foreign stock and captured markets — rules

DTG 251536ZSEP26 · base `125e55c` · written before any code in this round was changed

This round stops cross-faction ship availability from feeling magical. A shipyard sells what the world's own industry makes; a foreign hull appears only for a campaign reason that can be named, and a specific captured vessel stays that vessel. The approved spec (`FOREIGN-MARKETS-SPEC-191921ZSEP26.md`) still governs the three NPC-run markets (Suliban Helix, Hirogen Range, Pirates Haven); they are **not** implemented here. This round uses the same `book.prizes[]` idea and the persistent vessel identity from `150edb3`.

---

## 0. Two concepts that must not be conflated

| | **Prize hull** (specific vessel inventory) | **Captured industry** (design access) |
|---|---|---|
| What is offered | one vessel: a vid, with its name, seed, origin, provenance and physical state (hull, weapons, cargo) | a design (`shipId`) the yard can turn out, as ordinary shelf stock |
| Where it comes from | a vessel the captain captured, then sold to a yard | the holder has integrated a captured major world's industry (campaign `integrations`) |
| How many | exactly one; buying it empties the slot | ordinary stock quantities, resupplied like any other hull |
| Record | `campaign.prizes[]` entry, keyed by vid | `campaign.polities[holder].integrations[system].designs` (existing) |
| Identity | the vessel's own; origin and provenance never change | a new hull with a new vid, minted at purchase like any other purchased hull (builder = the design's culture, via `purchased`, at that system) |
| Ends when | bought back (moves to the fleet as the same vid), or pushed off the shelf (retired `sold-on`), or its yard is destroyed (retired `lost-with-yard`) | the holder loses the world (access at that world ends at once), or the world is retaken and must be re-integrated |
| Never | duplicated; re-created after it is retired or destroyed; turned into a generic design licence | a way to resurrect a specific vessel; granted by capturing one ship; granted by a flag |

A prize is **not** a licence. Capturing a Romulan Scout gives you *that* Scout; it does not teach any yard to build Scouts. A licence is **not** a prize: a Romulan design bought at an integrated yard is a new hull with a new vid and no capture in its provenance.

## 1. Normal markets

1. **A yard sells its world's stock.** At a world whose holder is its own people's government (holder = origin), the shelf is unchanged from `125e55c`: the faction's own hulls, independent (neutral) hulls, and what the world's authored lot lists.
2. **No global mixing.** Nothing in this round adds any faction's hulls to any other faction's ordinary shelf.
3. **Variation within a faction** is the existing behaviour: planet market size, station type (shipyard, heavy shipyard, starbase, maintenance, trade) and authored lots already give different Terran worlds different Terran selections. This round keeps that and guards it with a test; it does not rewrite authored lots.
4. **Special stations are not dealers.** A station whose role has no ship sales (subspace comm, research lab, habitat, bar, defence platform, ore station) sells no hulls and cannot take a prize, whoever's flag is over it.

## 2. Occupied worlds

A world is **occupied** when its holder is not its origin government: an origin that is a recognized faction, held by the player or by another faction. The player always holds as the player's polity, never as a government, so a player-held faction world is always occupied — the same rule the campaign already applies when it opens an integration record for every capture the player makes.

At an occupied world, every vendor in the system (planet market, the holder's stations, surviving private yards) sells only:

* **independent hulls** (faction `neutral`, or none);
* **local civilian designs** of the origin culture: the people's own shuttles, couriers, freighters and tugs. The test is the design's role (freighter, hauler, cargo, shuttle, transport, courier, tender, tug, liner, yacht, utility, runabout, civilian) with no military role word, at mass 4 or less. The occupation does not rewrite the local civilian industry into the occupier's culture, and it does not end it;
* **integrated designs**, only when the *current holder* has completed integration of that world (§3);
* a design **recovered to that yard from an engineering archive** (the campaign's design-recovery mission). That is its own named campaign reason, and the recovered offer stays on sale there whoever holds the world. *(Added after the first full-suite run: `test:campaign:ingame` relocates a recovered design to such a yard.)*

It does **not** sell:

* the origin culture's military hulls before integration — a captured outpost does not hand over a government's warship production;
* the occupier's own hulls — Klingon ships are not built at a Terran world because Klingons now hold it;
* anything else foreign.

**Consequence to note.** A Terran captain who takes a Terran-origin world holds it as the player's polity too. Its yards sell Terran civilian and independent hulls until the captain integrates the world. After that they sell its Terran designs, with the own-holding standing waiver. Every *Terran-held* world still sells Terran hulls to that captain in the ordinary way. The alternative, treating a same-culture captain as the world's government, would need a stable record of the captain's own culture that no flag can change, and the game doesn't keep one. `hull-merge-probe` held Paso to test alias purchases at the captain's own yard, so its fixture now completes that integration first.

The market's **controller** (whose standing, licence, prestige and security rules apply, and whose own-holding waiver applies) is the holder, exactly as before.

### 2a. Holder-built yards (correction, DTG 251930ZSEP26)

The occupied-market rule covers the **local and captured industry** of the system: the planet market, the former government's yards, and surviving local or private yards. It does **not** cover infrastructure the current holder built there. That kind of yard sells its **builder's normal pool**, under its usual vendor size, price, standing and security limits.

What counts as holder-built comes from stable records, never from the flag:

* **the captain's own construction:** `builtByPlayer`, plus `builtCulture`, the captain's flag at the moment construction was ordered. It is written once. `faction` on the same record follows later flag changes (`realignPlayerAssetsToFaction`), but `builtCulture` does not. It counts only while the yard still belongs to the captain;
* **a faction's paid replacement:** `builtBy`, the faction that paid for a reconstruction order. It counts only while that faction still owns the yard.

A captured and reflagged yard records neither, so it stays local industry: independent hulls, local civilian designs, and integrated designs once integrated. A holder-built yard is not where captured industry is sold. After integration, the former owner's designs appear at the local vendors, and the holder-built yard's own stock is unchanged. The captain's plans-and-build route (`campaignIntegrationOffers`) at the captain's own yards is unaffected.

Legacy saves: a player-built station saved before `builtCulture` existed gets it on load, once, from its own `faction` record.

## 3. Captured industry: the threshold

Captured industry reuses the campaign's existing rule; it defines no new one:

* **Major world** (`majorWorldQualification`): population ≥ 4,000, **or** ≥ 5 operational, non-abandoned, non-platform stations.
* **Integration:** 30 days of retooling while the holder keeps the world, at full speed with a working yard in the system that belongs to the holder (or to nobody), at half speed on population alone.
* **Designs:** the origin culture's designs that pass `isRecoverableIndustrialDesign`. That excludes retired, prototype and pending-balance hulls, the named design exceptions, special-vendor hulls (Project X, for example) and anything outside the general or recoverable regions. The Tactical Cube is excluded as before.

When integration completes, those designs become available at vendors **in that system only**, through the ordinary shelf. That means the same stock size, the same vendor ceiling and mass limit by yard type, and the same standing and security tests. A small trade station at an integrated world does not start selling capital ships, because its context ceiling does not change.

**Losing the world** ends that access at once: the market asks who holds the world *now*. **Retaking** it (by the origin government) returns the world to a normal market. **Recapturing** it later starts a fresh integration: the campaign's `recordCapture` replaces the old record, so the access is not restored from the earlier one.

**Flags.** Raising a flag changes whose flag you fly, not who holds a world. A captain flying the Romulan flag gets no Romulan production anywhere they don't hold an integrated Romulan world. A world held by the government whose flag the captain flies is that government's world, not the captain's: it keeps its normal market and its normal standing tests.

## 4. Prize hulls

1. **Entry.** When the captain sells a fleet vessel whose identity records a capture (`takenFrom`), at a vendor that sells ships, the vessel goes onto that vendor's prize shelf instead of being retired. It carries its identity (vid, design, name, seed, origin, provenance), its physical snapshot (`Fleet.snapshotVessel`: hull, weapons, cargo, equipment) and the day it was shelved. Proceeds are the ordinary sale quote.
2. **Faction rules don't apply to a prize.** A Romulan prize sold at a Terran yard is offered there as a Romulan-origin vessel. It is not production, so the faction-pool rule doesn't apply. The design restrictions do: a hull the ordinary shelf would refuse (retired, prototype, unbalanced, special-vendor, Borg) can't be shelved. It's sold as a sink and retired `sold`, as before.
3. **Purchase.** A prize is bought by its record, never by design. Buying it:
   * removes the shelf record;
   * adds a fleet record carrying the **same identity object** and the same physical snapshot;
   * records a `purchased` provenance entry;
   * charges the condition-scaled price (design price × hull fraction, floored at the resale basis).

   There is no `consumeStock`, and stock doesn't resupply it. The captain gets that ship in the condition it was sold in.
4. **One place at a time.** A vid is in the fleet, on one shelf, in the registry as retired, or nowhere. The shelf refuses a vid that is already active or retired.
5. **Bounds.** At most 6 prizes per vendor. The oldest pushed off is retired `sold-on`, meaning sold to someone the books don't follow. A prize whose vendor is destroyed is retired `lost-with-yard`. Neither is ever `destroyed`.
5a. **Physical state is always the vessel's own.** `sellFleetVessel` refuses a sale unless the vessel has a live actor alongside (`fleetLocalActor` plus `fleetServiceAllowed`). A vessel that exists only as its fleet record is materialised from its persisted `record.vessel` (`Fleet.restoreVessel`) before it can be sold. The shelf snapshot is therefore always taken from the live vessel. `PRIZE-PHYSICAL` checks that hull, weapons, cargo, equipment and jammers are identical from saved record to shelf to the hull bought back.
6. **Durability.** Prizes live in the campaign book beside `designs` and `recoveries`, not in history, the ledger or stock, so nothing trims or regrows them. They round-trip through save/load.
7. **Provenance.** `findStrategicVessel(vid)` reports a shelved prize as active, kind `prize`, held by the vendor's current owner. `vesselProvenance(vid)` reads it like any other active vessel.
8. **Standing.** No new standing deltas. The spec's §4 table belongs to the NPC-run markets and waits for them. Buying at a vendor uses that vendor's existing access, standing and security tests.

## 5. Not in this round

* the Suliban, Hirogen and Pirate markets (the spec's §3) and their standing table (§4);
* NPC capture of player hulls (`takenFrom: 'player'`);
* economy rebalance, bilateral peace, evacuation and blockade, one-jump formation routing, Tactical Cube, Gorn, ship balance, starter ships.
