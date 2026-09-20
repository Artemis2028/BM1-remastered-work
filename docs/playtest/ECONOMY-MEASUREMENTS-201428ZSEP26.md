# Finite economy — long-horizon measurements

DTG 201428ZSEP26 · against this candidate · **driven through the engine, not modelled**

Review: *"Implement scarcity first. Do not increase contract pay yet. Show the long-horizon results
before changing payouts, margins, replenishment or ship prices."*

Everything below is what the engine did. The script starts a campaign, learns thirty worlds, puts fleet
traders to work and advances the calendar day by day, reading the same shelves, the same books of work
and the same danger the captain would. **Nothing is tuned**: cargo capacities are still the shipped
ones and contract pay is still the engine's own `150 + min(350, distance × 3) + hazard`.

`scripts/economy-measure.cjs`. The suite runs it to 1,200 days for time; the tables here are the full
5,000-day pass.

The map it runs on: 101 worlds: **92 with an economy**, **9 without one** (Denmark, Iconia, Konael, Harman, Aldnas, Elderea, Xindus, Sato, Nexus). Population across the living worlds (min / p25 / median / p75 / max): **0 / 3800 / 5200 / 7600 / 50000**.

### What a world carries and hires for (min / median / max)

| size   | worlds | example     | tons per good   | demand per good | replenish t/day | open jobs |
| ------ | ------ | ----------- | --------------- | --------------- | --------------- | --------- |
| small  | 31     | New Romulus | 14 / 53 / 69    | 11 / 42 / 55    | 1 / 3 / 3       | 1 / 2 / 3 |
| medium | 31     | Tarellia    | 70 / 86 / 109   | 56 / 69 / 87    | 4 / 4 / 5       | 3 / 3 / 4 |
| major  | 30     | Du'Qot      | 111 / 136 / 220 | 89 / 109 / 176  | 6 / 7 / 11      | 4 / 5 / 6 |

Shipments on the board (n / min / p25 / median / p75 / max): tonnage **151 / 5 / 32 / 52 / 77 / 165**, pay per ton **416 / 500 / 520 / 600 / 620 L** — the engine's shipped rate, untouched.

### One maintained trader, Cautious

| hull             | hold | price   | days | net L   | L/day | circuits | L/circuit | hold used | shipments L | commodities L | upkeep L | idle | payback days |
| ---------------- | ---- | ------- | ---- | ------- | ----- | -------- | --------- | --------- | ----------- | ------------- | -------- | ---- | ------------ |
| starter ship     | 5    | 500     | 300  | 275     | 1     | 11       | 25        | 100%      | 0           | 455           | 300      | 3%   | 545          |
| starter ship     | 5    | 500     | 1000 | 850     | 1     | 36       | 24        | 100%      | 0           | 1,470         | 1,000    | 2%   | 588          |
| starter ship     | 5    | 500     | 3000 | 1,780   | 1     | 75       | 24        | 100%      | 0           | 3,050         | 3,000    | 31%  | 843          |
| starter ship     | 5    | 500     | 5000 | 1,780   | 0     | 75       | 24        | 100%      | 0           | 3,050         | 5,000    | 58%  | 1404         |
| ordinary cruiser | 220  | 124,000 | 300  | 137,335 | 458   | 9        | 15,259    | 52%       | 133,280     | 6,656         | 1,500    | 0%   | 271          |
| ordinary cruiser | 220  | 124,000 | 1000 | 239,054 | 239   | 33       | 7,244     | 73%       | 223,760     | 29,313        | 5,000    | 0%   | 519          |
| ordinary cruiser | 220  | 124,000 | 3000 | 263,655 | 88    | 80       | 3,296     | 81%       | 223,760     | 77,090        | 15,000   | 22%  | 1411         |
| ordinary cruiser | 220  | 124,000 | 5000 | 263,655 | 53    | 80       | 3,296     | 81%       | 223,760     | 77,090        | 25,000   | 53%  | 2352         |
| normal freighter | 1350 | 85,000  | 300  | 163,570 | 545   | 10       | 16,357    | 7%        | 160,840     | 4,634         | 1,200    | 0%   | 156          |
| normal freighter | 1350 | 85,000  | 1000 | 238,136 | 238   | 35       | 6,804     | 12%       | 223,760     | 28,041        | 4,000    | 0%   | 357          |
| normal freighter | 1350 | 85,000  | 3000 | 266,094 | 89    | 81       | 3,285     | 14%       | 223,760     | 80,703        | 12,000   | 24%  | 958          |
| normal freighter | 1350 | 85,000  | 5000 | 266,094 | 53    | 81       | 3,285     | 14%       | 223,760     | 80,703        | 20,000   | 54%  | 1597         |
| heavy freighter  | 3500 | 180,000 | 300  | 148,382 | 495   | 12       | 12,365    | 3%        | 145,840     | 5,365         | 1,800    | 0%   | 364          |
| heavy freighter  | 3500 | 180,000 | 1000 | 239,507 | 240   | 35       | 6,843     | 5%        | 223,760     | 30,063        | 6,000    | 1%   | 752          |
| heavy freighter  | 3500 | 180,000 | 3000 | 285,081 | 95    | 107      | 2,664     | 6%        | 223,760     | 114,814       | 18,000   | 1%   | 1894         |
| heavy freighter  | 3500 | 180,000 | 5000 | 330,938 | 66    | 176      | 1,880     | 6%        | 223,760     | 199,898       | 30,000   | 1%   | 2720         |


### The same heavy freighter with nobody repairing her

| days | net L   | circuits | hull left | idle | stopped on day |
| ---- | ------- | -------- | --------- | ---- | -------------- |
| 300  | 135,904 | 9        | 100%      | 0%   | still going    |
| 1000 | 239,192 | 34       | 51%       | 1%   | still going    |
| 3000 | 241,451 | 37       | 5%        | 64%  | 1089           |
| 5000 | 241,451 | 37       | 5%        | 78%  | 1089           |


### Danger setting, one maintained heavy freighter

| setting  | 300d net L | 1000d net L | 3000d net L | 5000d net L | circuits at 5000 | hull left | idle at 5000 |
| -------- | ---------- | ----------- | ----------- | ----------- | ---------------- | --------- | ------------ |
| safe     | 121,596    | 239,135     | 274,105     | 284,063     | 135              | 100%      | 29%          |
| cautious | 116,196    | 240,791     | 282,443     | 305,314     | 147              | 100%      | 18%          |
| risky    | 164,848    | 270,508     | 769,089     | 1,076,356   | 33               | 33%       | 0%           |
| any      | 164,848    | 270,508     | 855,329     | 1,154,013   | 35               | 100%      | 8%           |


### Several heavy freighters on one economy

| traders | 300d each | 1000d each | 3000d each | 5000d each | circuits each at 5000 | idle each at 5000 |
| ------- | --------- | ---------- | ---------- | ---------- | --------------------- | ----------------- |
| 1       | 163,197   | 238,394    | 284,293    | 330,550    | 175                   | 1%                |
| 2       | 115,561   | 131,847    | 154,547    | 174,635    | 115                   | 36%               |
| 4       | 59,444    | 70,516     | 93,455     | 108,824    | 106                   | 38%               |




---

## What the numbers say

### 1. Contract pay is the economy. Everything else is a rounding error.

A shipment pays **416 to 620 latinum a ton** and runs 5 to 165 tons. Over a thousand days an ordinary
cruiser books **223,760 latinum of shipments** against **29,313 of commodity trading** — eight to one.
Every hull in the test converges on the same 223,760, because what is scarce is the number of
shipments the worlds it can reach have open, not anything about the ship.

That number is the engine's shipped rate, untouched, as instructed. **It is the lever.** Nothing else
in this economy moves the totals much.

### 2. The hold is not what limits a trader

At a thousand days a **220-ton cruiser** makes 239,054, a **1,350-ton freighter** 238,136 and a
**3,500-ton freighter** 239,507. Hold utilisation runs **73%**, **12%** and **6%**.

So the cargo-capacity rebalance is about plausibility, not balance — with one exception at the bottom:
the **five-ton starter hull earns 1,780 latinum in five thousand days**, because it cannot accept any
shipment on any world's board and is left arbitraging commodities a ton at a time. That end of the
roster does need raising, and the capacity proposal raises nine hulls for exactly that reason.

### 3. A large hold pays off only over a very long horizon, and through commodities

The heavy freighter passes the others at about three thousand days and reaches **330,938** at five
thousand. The extra comes from **commodities (199,898)**, not shipments: the shipment pool saturates
and stays saturated, while commodity supply keeps replenishing, so only a hull with room to carry a lot
of low-margin cargo can keep growing. That is a coherent reason for a big hold to exist, and it is a
slow one — which fits "a 180,000 L freighter does not need to recover a large fraction of its purchase
price in three hundred days".

### 4. Risk is worth far more than cargo capacity

At five thousand days: **Safe 284,063**, **Cautious 305,314**, **Risky 1,076,356**, **Any 1,154,013** —
close to **four times** for accepting danger. Not because dangerous lanes pay more per ton, but because
the looser settings reach far more of the map, and reaching more worlds means more shipments.

This is the largest single multiplier in the economy, and it is a design question rather than a bug:
the danger setting is currently the most consequential choice a captain makes about a trader.

### 5. Without repair a trader is finished in about a thousand days

Nobody maintaining her: still going at 1,000 days on 51% hull, **stopped on day 1,089**, idle for 78%
of five thousand days. The maintained runs above assume the captain repairs her. §6, fleet repair UX,
is what makes that a thing the player can actually do; until then the long horizons are optimistic.

### 6. Competition does what it should

One heavy freighter makes 330,550 over five thousand days. Two make **174,635 each**. Four make
**108,824 each**, and sit idle 38% of the time. One economy, finite shelves, finite books of work, and
traders genuinely taking work from one another.

---

## What I have not changed, and what I would ask about

Nothing has been tuned. No payout, no margin, no replenishment rate, no ship price, no cargo capacity.

1. **Contract pay.** 416–620 L/ton is where all the money is. One cruiser at 239,000 latinum per
   thousand days, and one trader at Any risk at 1.15 million over five thousand, both come from there.
   If later builds made too much money, this is the number.
2. **The danger multiplier.** Four times for Any over Safe is a big spread for one dropdown.
3. **Replenishment at twenty days** and **a book of work that regenerates one job per twelve days** set
   how fast a saturated map recovers. They are why the per-day rate falls from 458 to 53 as horizons
   lengthen.
4. **Whether the heavy tier should pay off faster than three thousand days.** As it stands it is a
   long-horizon commodity hauler, which is defensible but is a choice.

The suite regenerates these tables on every run, so any change to those numbers can be measured the
same way before it is accepted.
