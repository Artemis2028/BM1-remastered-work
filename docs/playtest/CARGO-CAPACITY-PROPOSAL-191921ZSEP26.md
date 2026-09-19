# Proposed cargo capacity by role and size

DTG 191921ZSEP26 · against `75389f7` · **nothing here is implemented; no ship data is changed**

Asked for by review before the economy round: *"Run the entire hull roster and propose a role/size-based
cargo-capacity table before changing the data."*

## The rule

Two things the catalogue already records decide a hull's hold, and neither of them is its name:

- **`shipClass`** — `shuttle`, `escort`, `lightCruiser`, `cruiser`, `battleship`, `capital` — gives the
  size band;
- **`role`**, the authored one-line description of what the hull is for, decides whether it is a cargo
  hull at all, and whether it is a heavy one.

```js
CLASS_BASE = { shuttle: 12, escort: 45, lightCruiser: 70, cruiser: 140, battleship: 220, capital: 300 }
CARGO = /freighter|hauler|cargo|transport|tug|logistics|merchant|convoy|supply|courier|runabout|service craft|commerce/i
HEAVY = /bulk|heavy|long-haul|grand|interstellar|frame/i
TIER  = { warship: 1, cargo: 3, heavyCargo: 6 }
proposed = clamp(CLASS_BASE[class] * TIER[tier] * spread, 5, 1500)
```

`spread` runs 0.7 to 1.4 across the hulls inside one class-and-tier bucket, ordered by the capacity the
roster gives them today — so the differences the authors already expressed survive the rescale instead
of a bucket collapsing to one number.

**A liner is not a freighter.** "Luxury liner" matched `liner` in an earlier pass and put a pleasure
ship at the top of the cargo table with 900 tons. It carries passengers. The word is gone, and the
Delpin Luxury Liner is a `capital`-class warship-tier hull at 420 tons.

**The heavy multiplier has to outweigh class.** At ×5 the largest freight hull in the game lost to a
capital-class cargo hull, because a capital's size band is more than twice a cruiser's. At ×6 a
dedicated heavy freighter tops the table, which is the ordering that was asked for.

## What it does to the outliers

The two that prompted this:

- **Concord-class Grand Cruiser**, 10,000 t on a **mass-6** hull paying below-median upkeep, becomes
  **308 t**. It is a `battleship`-class warship with no cargo role: a warship with a hold, not a
  freighter. Nothing in its authored role says otherwise.
- **Tholian Isaac Freighter**, 3,500 t for 180,000 latinum, becomes **840 t** — and stays the largest
  hold in the game, because its role is "bulk interstellar freighter". It is the one hull the
  `heavyCargo` tier is really for.

Across the roster the total hold falls from **112,955 t** to **25,616 t**, and the largest from
**10,000 t** to **840 t**. **33** of 174 hulls are cargo hulls; **4** of those are heavy.

### Buckets

| tier       | class        | hulls | current median | proposed median | current max | proposed max |
| ---------- | ------------ | ----- | -------------- | --------------- | ----------- | ------------ |
| warship    | shuttle      | 21    | 40             | 13              | 110         | 17           |
| warship    | escort       | 22    | 140            | 46              | 500         | 63           |
| warship    | lightCruiser | 26    | 250            | 73              | 800         | 98           |
| warship    | cruiser      | 41    | 350            | 147             | 950         | 196          |
| warship    | battleship   | 15    | 3000           | 231             | 10000       | 308          |
| warship    | capital      | 16    | 650            | 308             | 1600        | 420          |
| cargo      | shuttle      | 8     | 65             | 36              | 90          | 50           |
| cargo      | escort       | 2     | 150            | 95              | 620         | 189          |
| cargo      | lightCruiser | 14    | 1000           | 215             | 1350        | 294          |
| cargo      | cruiser      | 5     | 950            | 441             | 1500        | 588          |
| heavyCargo | escort       | 1     | 500            | 270             | 500         | 270          |
| heavyCargo | lightCruiser | 2     | 650            | 294             | 1000        | 588          |
| heavyCargo | cruiser      | 1     | 3500           | 840             | 3500        | 840          |


### The twelve largest holds today, and what they become

| hull                        | class      | role                        | tier       | current | proposed |
| --------------------------- | ---------- | --------------------------- | ---------- | ------- | -------- |
| Concord-class Grand Cruiser | battleship | independent supercapital    | warship    | 10000   | 308      |
| Cardassian Behemoth         | battleship | Cardassian supercapital     | warship    | 6000    | 286      |
| Borg Assimilation Cube      | battleship | Borg assimilation cube      | warship    | 6000    | 297      |
| Excalibur Class             | battleship | Project X supercapital      | warship    | 5000    | 275      |
| Tholian Conquest            | battleship | Tholian supercapital        | warship    | 4500    | 264      |
| Romulan Warhawk             | battleship | Romulan supercapital        | warship    | 4000    | 242      |
| Tactical Cube               | battleship | mission tactical cube       | warship    | 4000    | 253      |
| Tholian Isaac Freighter     | cruiser    | bulk interstellar freighter | heavyCargo | 3500    | 840      |
| Dominion Battleship         | battleship | Dominion supercapital       | warship    | 3000    | 231      |
| Klingon Qonos               | battleship | Klingon supercapital        | warship    | 2500    | 220      |
| Delpin Luxury Liner         | capital    | luxury liner                | warship    | 1600    | 420      |
| Tarellian Freighter         | cruiser    | quantum-drive freighter     | cargo      | 1500    | 515      |


### The twelve largest holds afterwards

| hull                          | class        | role                        | tier       | current | proposed | price  |
| ----------------------------- | ------------ | --------------------------- | ---------- | ------- | -------- | ------ |
| Tholian Isaac Freighter       | cruiser      | bulk interstellar freighter | heavyCargo | 3500    | 840      | 180000 |
| Salcombe class                | lightCruiser | heavy cargo frame           | heavyCargo | 1000    | 588      | 56000  |
| Ferengi Marauder Refit        | cruiser      | armed merchant cruiser      | cargo      | 1500    | 588      | 142000 |
| Tarellian Freighter           | cruiser      | quantum-drive freighter     | cargo      | 1500    | 515      | 72000  |
| Romulan Miltek                | cruiser      | Miltek military transport   | cargo      | 950     | 441      | 119000 |
| Delpin Luxury Liner           | capital      | luxury liner                | warship    | 1600    | 420      | 98000  |
| Sagan Class                   | capital      | capital explorer            | warship    | 1100    | 406      | 235000 |
| Vulcan Expeditionary Explorer | capital      | expeditionary capital       | warship    | 900     | 392      | 165000 |
| Galaxy Class                  | capital      | multipurpose capital        | warship    | 900     | 378      | 158000 |
| Nebula Class                  | cruiser      | survey logistics refit      | cargo      | 900     | 368      | 69000  |
| Galaxy Command Variant        | capital      | Galaxy command capital      | warship    | 800     | 364      | 195000 |
| D'deridex Warbird             | capital      | heavy cloaked warbird       | warship    | 700     | 350      | 225000 |


### Every heavy freight hull in the game

| hull                    | class        | role                        | current | proposed | price  |
| ----------------------- | ------------ | --------------------------- | ------- | -------- | ------ |
| Tholian Isaac Freighter | cruiser      | bulk interstellar freighter | 3500    | 840      | 180000 |
| Salcombe class          | lightCruiser | heavy cargo frame           | 1000    | 588      | 56000  |
| Tug Class II            | lightCruiser | heavy tug                   | 650     | 294      | 31000  |
| Kingston Class          | escort       | long-haul freighter         | 500     | 270      | 28000  |


### A representative hull from every bucket

| class        | tier       | hull                      | role                        | current | proposed | price   |
| ------------ | ---------- | ------------------------- | --------------------------- | ------- | -------- | ------- |
| shuttle      | warship    | Warp Delta                | early warp patrol craft     | 40      | 13       | 9000    |
| shuttle      | cargo      | Vulcan Warpship           | Vulcan transport            | 65      | 36       | 6500    |
| escort       | warship    | Thawn Class               | Thawn frontier escort       | 140     | 46       | 44000   |
| escort       | cargo      | Oberth Tug                | entry utility tug           | 150     | 95       | 16000   |
| escort       | heavyCargo | Kingston Class            | long-haul freighter         | 500     | 270      | 28000   |
| lightCruiser | warship    | Vulcan Light Cruiser      | Vulcan fast cruiser         | 250     | 73       | 93000   |
| lightCruiser | cargo      | Cardassian Transport Ship | Cardassian convoy transport | 1000    | 215      | 67000   |
| lightCruiser | heavyCargo | Tug Class II              | heavy tug                   | 650     | 294      | 31000   |
| cruiser      | warship    | Independent Warbird       | independent militia warbird | 350     | 147      | 112000  |
| cruiser      | cargo      | Romulan Miltek            | Miltek military transport   | 950     | 441      | 119000  |
| cruiser      | heavyCargo | Tholian Isaac Freighter   | bulk interstellar freighter | 3500    | 840      | 180000  |
| battleship   | warship    | Dominion Battleship       | Dominion supercapital       | 3000    | 231      | 1350000 |
| capital      | warship    | Sovereign Command Cruiser | command battlecruiser       | 650     | 308      | 230000  |


Total hold across the roster: **112,955 t** today, **25,616 t** proposed.
Largest hold: **10,000 t** today, **840 t** proposed.
Cargo hulls: **33** of 174, of which **4** are heavy.

(Full roster: `validation/cargo-capacity-proposal.csv`, one row per hull.)

## What this does not decide

The capacities above are only half the answer. Whether a 840-ton hold is worth 180,000 latinum depends
entirely on whether anything will fill it, and the measurements in
`ECONOMY-MEASUREMENTS-191921ZSEP26.md` say that under the finite-commodity model **it is not**, unless
a trader can work several worlds in one circuit. That is a live question, and it is in that document
rather than settled here.
