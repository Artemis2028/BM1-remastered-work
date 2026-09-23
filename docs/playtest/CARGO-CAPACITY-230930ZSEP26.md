# Cargo capacity — derived defaults, challenged outliers, authored exceptions

DTG 230930ZSEP26 · against `cf52b49` · supersedes `CARGO-CAPACITY-221332ZSEP26.md`
· **the fourteen reductions are applied; the nine raises are not**

Review: *"Do not blindly replace all 174 cargo capacities with a formula. Use ship class and authored
role to establish sensible defaults and identify obvious outliers, but preserve deliberately
exceptional capacities when the ship's lore/role supports them."* Then, on this table: *"approve the 14
obvious oversized-warship reductions and preserve genuine authored freight exceptions such as the
Isaac. Do not automatically raise the nine small holds just to make every ship freight-capable. Keep
their authored capacities; if needed, allow occasional 1-5t courier jobs."*

## What was applied

**The fourteen challenged holds were reduced**, in both `data/starship_manifest.json` and
`bm-ships/ships.json`, with the old figure kept on each hull as `cargoReview.previousCargoCapacity` so
the change is legible in the data rather than only in this document. **One of the fourteen, the
Concord, was then restored to 1,320 tons** as an authored civilian/commercial exception on review — see
the section on it below — so thirteen are at the derived default. **The nine raises were not
applied**: those hulls keep exactly what they shipped with. **Every authored freight exception stands** —
the Tholian Isaac Freighter at 3,500 tons (the largest hold in the game), the Delpin Luxury Liner at
1,600, the Tarellian and Ferengi hulls at 1,500, the Dominion Freighter at 1,350. **149 hulls are
untouched.**

Six of the fourteen carried description text that restated the old number — *"offering substantial
freight capacity"*, and the Concord's *"immense cargo capacity"*. That text is now false, so it was
rewritten to say what is still true of the hull (reach, protection) and nothing about the hold. No
other authored text was touched.

Small holds are not shut out of the work. Instead of enlarging them, **every third shipment on a
world's book is a courier lot of one to five tons**: 33 of the 136 shipments open across the map, so a
five-ton hull is no longer offered nothing anywhere.

**This is necessary and not sufficient, and the measurements say so.** The five-ton starter ship earns
exactly what it earned before — 850 latinum over a thousand days, all of it commodity trading — because
what stops it is not the size of the work but the **danger model**: of the 64 shipments of five tons or
less open on the map, one is on a route a Cautious trader will fly. The courier lots are there and a
small hull can take one; reaching them is a separate question, and it belongs with the danger settings
in §6 rather than here.

## The one hull that was looked at again: the Concord, 1,320 tons

The **Concord-class Grand Cruiser** is the only one of the fourteen whose *other* authored fields argue
for the hold. Its `role` reads "independent supercapital", which is what the derivation read, but its
`marketRole` is **civilian**, its art note calls it a "separate civilian megaship identity", and the
previous balance review's own rationale says it "preserves approved endgame values and **commercial
role**". None of that is description text, so the derivation never saw it.

Review ruled it an **authored civilian/commercial exception**. It is **1,320 tons** — a battleship-class
hull at the heavy-cargo tier, `220 x 6`, the same table that judged every other hull — which makes it
the second largest hold in the game behind the Isaac's 3,500, rather than the 10,000 it shipped with,
which nothing authored explains. Its own text says so again: *"Its large commercial hold and long
reach outweigh its slower response."* Both data files carry the ruling as `cargoReview`, with the
shipped figure and the 308 it was briefly cut to. The other thirteen reductions stand, and so does every
existing freight exception.

## How a hull is judged

Two fields the catalogue already carries give a **default**: `shipClass` for the size band, and the
authored `role` for whether the hull hauls and whether it hauls heavy. No hull is named anywhere.

```js
CLASS_BASE = { shuttle: 12, escort: 45, lightCruiser: 70, cruiser: 140, battleship: 220, capital: 300 }
TIER       = { warship: 1, cargo: 3, heavyCargo: 6 }
derived    = clamp(CLASS_BASE[class] * TIER[tier] * spread, 5, 1500)   // spread 0.7-1.4 within a bucket
```

The default is a **reference**, not a replacement. A hull keeps exactly what it shipped with unless one
of two things is true:

- its hold is **below** the default — raised, because a hold under about ten tons cannot accept even
  the smallest shipment on any world's book and the ship is shut out of the economy entirely;
- its hold is **more than six times** the default (twelve times, for a hull whose role already says it
  hauls) — then, and only then, the authored text is asked whether the volume is deliberate.

## The part that needed care: what counts as the author meaning it

Much of the roster's description text is generated from the stats. The phrase *"offering substantial
freight capacity, long interstellar reach, strong protection"* appears verbatim on a bulk freighter, a
Cardassian supercapital and a Borg cube. It restates the number; it does not justify it. So phrases of
the form *immense / substantial / large / vast cargo or freight capacity* are **stripped** before the
text is read.

What survives is language about what the volume is **for** — passengers, a liner, colonists, refugees,
bulk, a tanker, a tender, a depot, expedition or generous supplies, a tractor. That is treated as the
author saying the hold is deliberate, and the hull keeps it.

This is exactly the distinction review drew:

| Hull | Shipped | Authored text | Outcome |
| --- | --- | --- | --- |
| Concord-class Grand Cruiser | 10,000 t | "an independent endgame flagship. Its ~~immense cargo capacity~~ and long reach…" | **challenged** → 308 t |
| Delpin Luxury Liner | 1,600 t | "A **spacious** Delpin **passenger liner** with protective shields" | **kept at 1,600 t** |
| Tholian Isaac Freighter | 3,500 t | role: "**bulk** interstellar freighter" | **kept at 3,500 t** |

The Concord's description does mention cargo — and that mention is the boilerplate, on a mass-6
battleship whose role says "independent supercapital". Strip the restatement and there is nothing
left saying why it holds ten thousand tons. The Delpin's is not boilerplate: a passenger liner is
spacious because of what it is.

### Buckets

| tier       | class        | hulls | current median | proposed median | current max | proposed max |
| ---------- | ------------ | ----- | -------------- | --------------- | ----------- | ------------ |
| warship    | shuttle      | 21    | 40             | 40              | 110         | 95           |
| warship    | escort       | 22    | 140            | 100             | 500         | 280          |
| warship    | lightCruiser | 26    | 250            | 240             | 800         | 800          |
| warship    | cruiser      | 41    | 350            | 350             | 950         | 950          |
| warship    | battleship   | 15    | 3000           | 286             | 10000       | 850          |
| warship    | capital      | 16    | 650            | 650             | 1600        | 1600         |
| cargo      | shuttle      | 8     | 65             | 65              | 90          | 90           |
| cargo      | escort       | 2     | 150            | 150             | 620         | 620          |
| cargo      | lightCruiser | 14    | 1000           | 1000            | 1350        | 1350         |
| cargo      | cruiser      | 5     | 950            | 950             | 1500        | 1500         |
| heavyCargo | escort       | 1     | 500            | 500             | 500         | 500          |
| heavyCargo | lightCruiser | 2     | 650            | 650             | 1000        | 1000         |
| heavyCargo | cruiser      | 1     | 3500           | 3500            | 3500        | 3500         |


### The fourteen largest holds today, and what happens to them

| hull                        | class        | role                        | tier       | current | derived | proposed | outcome    | authored phrase |
| --------------------------- | ------------ | --------------------------- | ---------- | ------- | ------- | -------- | ---------- | --------------- |
| Concord-class Grand Cruiser | battleship   | independent supercapital    | warship    | 10000   | 308     | 308      | challenged | -               |
| Cardassian Behemoth         | battleship   | Cardassian supercapital     | warship    | 6000    | 286     | 286      | challenged | -               |
| Borg Assimilation Cube      | battleship   | Borg assimilation cube      | warship    | 6000    | 297     | 297      | challenged | -               |
| Excalibur Class             | battleship   | Project X supercapital      | warship    | 5000    | 275     | 275      | challenged | -               |
| Tholian Conquest            | battleship   | Tholian supercapital        | warship    | 4500    | 264     | 264      | challenged | -               |
| Romulan Warhawk             | battleship   | Romulan supercapital        | warship    | 4000    | 242     | 242      | challenged | -               |
| Tactical Cube               | battleship   | mission tactical cube       | warship    | 4000    | 253     | 253      | challenged | -               |
| Tholian Isaac Freighter     | cruiser      | bulk interstellar freighter | heavyCargo | 3500    | 840     | 3500     | kept       | bulk            |
| Dominion Battleship         | battleship   | Dominion supercapital       | warship    | 3000    | 231     | 231      | challenged | -               |
| Klingon Qonos               | battleship   | Klingon supercapital        | warship    | 2500    | 220     | 220      | challenged | -               |
| Delpin Luxury Liner         | capital      | luxury liner                | warship    | 1600    | 420     | 1600     | kept       | liner           |
| Tarellian Freighter         | cruiser      | quantum-drive freighter     | cargo      | 1500    | 515     | 1500     | kept       | freighter       |
| Ferengi Marauder Refit      | cruiser      | armed merchant cruiser      | cargo      | 1500    | 588     | 1500     | kept       | -               |
| Dominion Freighter          | lightCruiser | Dominion logistics ship     | cargo      | 1350    | 294     | 1350     | kept       | supply ship     |


### Challenged: a hold far above its class and role, with nothing authored to explain it (14)

| hull                        | class        | role                     | current | proposed | description                                                                                |
| --------------------------- | ------------ | ------------------------ | ------- | -------- | ------------------------------------------------------------------------------------------ |
| Concord-class Grand Cruiser | battleship   | independent supercapital | 10000   | 308      | The Concord-class Grand Cruiser is an independent endgame flagship. Its immense cargo capa |
| Cardassian Behemoth         | battleship   | Cardassian supercapital  | 6000    | 286      | A Cardassian supercapital offering substantial freight capacity, long interstellar reach,  |
| Borg Assimilation Cube      | battleship   | Borg assimilation cube   | 6000    | 297      | A Borg assimilation cube offering substantial freight capacity, long interstellar reach, s |
| Excalibur Class             | battleship   | Project X supercapital   | 5000    | 275      | Project X’s exceptional Terran supercapital. Heavy weapons, immense protection and long re |
| Tholian Conquest            | battleship   | Tholian supercapital     | 4500    | 264      | A Tholian supercapital offering substantial freight capacity, long interstellar reach, str |
| Romulan Warhawk             | battleship   | Romulan supercapital     | 4000    | 242      | A Romulan supercapital offering substantial freight capacity, long interstellar reach, str |
| Tactical Cube               | battleship   | mission tactical cube    | 4000    | 253      | A mission tactical cube offering substantial freight capacity, long interstellar reach, st |
| Dominion Battleship         | battleship   | Dominion supercapital    | 3000    | 231      | A Dominion supercapital reserved for the core fleet and authorized deployments. Heavy prot |
| Klingon Qonos               | battleship   | Klingon supercapital     | 2500    | 220      | A Klingon supercapital offering substantial freight capacity, long interstellar reach, str |
| Reliant Class               | lightCruiser | modern utility cruiser   | 600     | 94       | A modern utility cruiser offering long interstellar reach, strong protection. Three equipm |
| Orion Science Ship          | escort       | Orion science vessel     | 500     | 63       | An Orion science vessel offering long interstellar reach. Three equipment slots support it |
| Aries Multipurpose Vessel   | escort       | civilian generalist      | 430     | 62       | A civilian generalist offering a practical balance of travel, protection and cargo. Three  |
| Mozart Civilian Explorer    | escort       | civilian explorer        | 380     | 60       | A civilian explorer offering long interstellar reach. Three equipment slots support its su |
| Sovereign Yacht             | shuttle      | premium command yacht    | 110     | 17       | A premium command yacht offering fast impulse response. Supplied without combat weapons; c |


### Authored exceptions kept, because the text says what the volume is for (2)

| hull             | class        | role                       | kept | derived would be | authored phrase   |
| ---------------- | ------------ | -------------------------- | ---- | ---------------- | ----------------- |
| California Class | lightCruiser | operations support cruiser | 800  | 98               | tractor           |
| Luna Class       | lightCruiser | deep-space survey cruiser  | 650  | 96               | generous supplies |


### Raised toward the class default (9)

| hull                  | class        | role                      | current | proposed |
| --------------------- | ------------ | ------------------------- | ------- | -------- |
| Vulcan Lifeform       | battleship   |                           | 100     | 154      |
| Drayton Class         | lightCruiser | Drayton service craft     | 100     | 147      |
| Klingon Bird of Prey  | lightCruiser | light Bird of Prey        | 35      | 49       |
| Gorn Interceptor      | escort       | reserved Gorn interceptor | 25      | 31       |
| Speeder               | shuttle      | fast courier              | 20      | 25       |
| Delpin Warship        | escort       | compact warship           | 30      | 33       |
| Lysian Fighter        | shuttle      | budget light craft        | 5       | 8        |
| Jem'Hadar Attack Ship | lightCruiser | JemHadar attack ship      | 50      | 53       |
| Alien Bioship         | lightCruiser | alien combat bioship      | 50      | 51       |


### The twelve largest holds afterwards

| hull                    | class        | role                        | tier       | current | proposed | price  |
| ----------------------- | ------------ | --------------------------- | ---------- | ------- | -------- | ------ |
| Tholian Isaac Freighter | cruiser      | bulk interstellar freighter | heavyCargo | 3500    | 3500     | 180000 |
| Delpin Luxury Liner     | capital      | luxury liner                | warship    | 1600    | 1600     | 98000  |
| Tarellian Freighter     | cruiser      | quantum-drive freighter     | cargo      | 1500    | 1500     | 72000  |
| Ferengi Marauder Refit  | cruiser      | armed merchant cruiser      | cargo      | 1500    | 1500     | 142000 |
| Dominion Freighter      | lightCruiser | Dominion logistics ship     | cargo      | 1350    | 1350     | 85000  |
| Romulan Freighter       | lightCruiser | Romulan convoy freighter    | cargo      | 1250    | 1250     | 74000  |
| Constellation Cargo Tug | lightCruiser | Constellation cargo tug     | cargo      | 1150    | 1150     | 49000  |
| Tholian Cargo Ship      | lightCruiser | Tholian cargo cruiser       | cargo      | 1100    | 1100     | 79000  |
| Klingon Cargo Ship      | lightCruiser | Klingon armed hauler        | cargo      | 1100    | 1100     | 89000  |
| Sagan Class             | capital      | capital explorer            | warship    | 1100    | 1100     | 235000 |
| K't'inga Cargo Cruiser  | lightCruiser | armed cargo conversion      | cargo      | 1050    | 1050     | 76000  |
| Salcombe class          | lightCruiser | heavy cargo frame           | heavyCargo | 1000    | 1000     | 56000  |


### Every heavy freight hull in the game

| hull                    | class        | role                        | current | proposed | price  |
| ----------------------- | ------------ | --------------------------- | ------- | -------- | ------ |
| Tholian Isaac Freighter | cruiser      | bulk interstellar freighter | 3500    | 3500     | 180000 |
| Salcombe class          | lightCruiser | heavy cargo frame           | 1000    | 1000     | 56000  |
| Tug Class II            | lightCruiser | heavy tug                   | 650     | 650      | 31000  |
| Kingston Class          | escort       | long-haul freighter         | 500     | 500      | 28000  |


### A representative hull from every bucket

| class        | tier       | hull                      | role                        | current | proposed | price   |
| ------------ | ---------- | ------------------------- | --------------------------- | ------- | -------- | ------- |
| shuttle      | warship    | Warp Delta                | early warp patrol craft     | 40      | 40       | 9000    |
| shuttle      | cargo      | Vulcan Warpship           | Vulcan transport            | 65      | 65       | 6500    |
| escort       | warship    | Thawn Class               | Thawn frontier escort       | 140     | 140      | 44000   |
| escort       | cargo      | Oberth Tug                | entry utility tug           | 150     | 150      | 16000   |
| escort       | heavyCargo | Kingston Class            | long-haul freighter         | 500     | 500      | 28000   |
| lightCruiser | warship    | Vulcan Light Cruiser      | Vulcan fast cruiser         | 250     | 250      | 93000   |
| lightCruiser | cargo      | Cardassian Transport Ship | Cardassian convoy transport | 1000    | 1000     | 67000   |
| lightCruiser | heavyCargo | Tug Class II              | heavy tug                   | 650     | 650      | 31000   |
| cruiser      | warship    | Independent Warbird       | independent militia warbird | 350     | 350      | 112000  |
| cruiser      | cargo      | Romulan Miltek            | Miltek military transport   | 950     | 950      | 119000  |
| cruiser      | heavyCargo | Tholian Isaac Freighter   | bulk interstellar freighter | 3500    | 3500     | 180000  |
| battleship   | warship    | Dominion Battleship       | Dominion supercapital       | 3000    | 231      | 1350000 |
| capital      | warship    | Sovereign Command Cruiser | command battlecruiser       | 650     | 650      | 230000  |


Total hold across the roster: **112,955 t** today, **68,743 t** proposed.
Largest hold: **10,000 t** today, **3,500 t** proposed.
Cargo hulls: **33** of 174, of which **4** are heavy.

### Where the line is drawn: the threshold as a dial

| warship factor | cargo factor | challenged | untouched | roster total t | largest hold |
| -------------- | ------------ | ---------- | --------- | -------------- | ------------ |
| 1.5            | 3            | 127        | 47        | 44,755         | 3500         |
| 2              | 4            | 115        | 59        | 46,951         | 3500         |
| 3              | 6            | 56         | 118       | 60,017         | 3500         |
| 4              | 8            | 28         | 146       | 64,367         | 3500         |
| 6              | 12           | 14         | 160       | 68,743         | 3500         |
| 8              | 16           | 9          | 165       | 70,467         | 3500         |

Outcomes as the derivation tabled them: **149 left exactly as shipped**, **9 raised to a hold that can take the smallest shipment**, **14 challenged and reduced**, **2 kept because the text says what the volume is for**. As **applied**: 13 reductions to the derived default, the Concord at an authored 1,320, and nothing else — 160 hulls are untouched and the 9 raises were declined in favour of courier work.

Full roster with every hull's derived default, proposal, outcome and authored phrase: `validation/cargo-capacity-proposal.csv`.

## What this changes, and what it does not

**It does not change the balance.** The long-horizon measurements
(`ECONOMY-MEASUREMENTS-230930ZSEP26.md`) say the hold is not what limits a trader: a 220-ton cruiser
and a 3,500-ton freighter both earn about the same, because what is scarce is the
number of shipments a world has open, not the room to carry them. Hold utilisation at the top of the
roster still runs at three to seven per cent after the reductions.

So this proposal is about **plausibility** — a mass-6 warship should not be the largest hold in the
game — and about **the bottom end**, where a five-ton hold cannot accept any shipment on any world's
book and the ship is simply shut out.

**It is applied.** The ship data is changed in this candidate, as approved: thirteen holds are at the
derived default, one — the Concord — is at an authored exception figure, and everything else is as it
shipped. The threshold remains a dial and the table above shows where each setting puts the line; the
per-hull CSV carries every hull's description so an individual call can be overruled without moving
the dial, which is exactly what happened with the Concord.
