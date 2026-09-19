# Cargo and market economy — proposal

DTG 191746ZSEP26 · against `5d32b7c` · **nothing here is implemented**

Raised by review of the fleet-trading round: *"the current 10,000t trader can overwhelm the entire
campaign economy in a handful of runs."* This is the measurement, the diagnosis, and four options with
a recommendation. It is a design decision, so it is a document rather than a patch.

## The measurement

One Concord-class Grand Cruiser, seeded fixtures, 180 days:

| setting | purse before | purse after | realised |
| --- | --- | --- | --- |
| Safe | 100,000 | 740,000 | 690,000 |
| Cautious | 100,000 | 450,000 | 360,000 |
| Risky | 100,000 | 680,000 | 600,000 |
| Any | 100,000 | 680,000 | 600,000 |

A single run: 10,000 tons bought at 2 and sold at 9 is **70,000 latinum in 11 days**, about 6,360 a day.
Fleet upkeep on that hull is **6 latinum a day**.

For scale: the captain's own ship holds **220 tons** and starts the game with **900 latinum**, and the
market screen buys and sells **one ton per click**.

## The diagnosis, which is not "the trader is too fast"

Three facts in the existing data, none of them introduced by fleet trading:

**1. A world's board has no depth.** `getPlanetMarket()` gives eight goods at 1–20 latinum a ton and
will take any quantity at that price. Dumping 10,000 tons of one good on a world clears at exactly the
same unit price as dumping one ton. Nothing in the engine says a market can be saturated.

**2. Upkeep is priced on mass; profit is earned on cargo capacity; the two are unrelated.** Across the
174 hulls: median hold 300 tons, p75 650, p90 1,100, and 23 hulls at 1,000 or more. The largest hold in
the game, 10,000 tons, belongs to a **mass-6** hull, so it pays *below-median* upkeep. The cheapest
route to the problem is not even the Concord: the **Tholian Isaac Freighter** holds 3,500 tons and costs
**180,000 latinum**, which a single margin pays back in eight runs.

**3. Nothing ever moves against the captain.** Prices drift ±2 a day at random, symmetric, with no
memory of what was bought or sold there.

So the fleet trader did not break the economy. It is the first thing in the game able to execute at a
scale the market model was never asked to price, and it exposed that the model has no notion of volume
at all. **The captain has exactly the same exploit today, by hand, at 220 tons and one click a ton** —
it is merely too tedious to be worth doing.

## Four options

### A. Price the hold, not just the mass

`upkeepPerDay` becomes `mass + cargoCapacity / k`. At k=100 the Concord pays 106 a day against 6,360
gross — nothing. At k=10 it pays 1,006, which bites.

*Against:* a tax, not a correction. It does not stop the compounding, it punishes a big hull standing
still, and the right value of k is a number nobody can defend.

### B. Market depth — **recommended**

A world's board absorbs a finite quantity at its posted price, and moves against you past that. Derive
the depth from what the world already has: `depth = market * 25` tons per good, where `market` is the
existing 4–18 per-world strength. That is 100–450 tons at the posted price.

Then: **the first `depth` tons trade at the board price; every further `depth` tons trades at one
latinum worse, floored at 1.** Symmetric — buying out a world raises the price the same way selling
into it lowers it.

What that does, at market 11 (depth 275) and a board price of 9:

| hull | tons | flat revenue | with depth | haircut |
| --- | --- | --- | --- | --- |
| Penine Class | 110 | 990 | 990 | none |
| Breen Warship | 320 | 2,880 | 2,835 | 2% |
| Classic Warbird | 650 | 5,850 | 5,375 | 8% |
| Tholian Isaac Freighter | 3,500 | 31,500 | 13,400 | 57% |
| Concord-class | 10,000 | 90,000 | **19,900** | 78% |

At 10,000 tons the run *loses money against a 20,000-latinum purchase* — which is the correct answer to
"can I sell ten thousand tons of one commodity to a world of eleven market strength". A 275-ton run is
untouched. The captain's own 220-ton ship is untouched.

*For:* it is economically honest, it scales with the world rather than with a constant, it leaves cargo
capacity meaningful instead of capping it, it fixes the captain's own bulk hauling by the same rule, and
it is one sentence to explain. A trader's planner already computes an expected unit price, so it can
compute the depth-adjusted one and stop choosing runs that do not fit the destination.

*Against:* it is a real change to the market model, so contract payouts and existing balance want
re-checking against it, and the fleet panel needs to show the effective price rather than the posted
one.

### C. Cap the tons per run

A flat cap — 500 tons, say — whatever the hull.

*Against:* it makes cargo capacity meaningless above the cap, which contradicts the thing this round was
asked to implement. A 10,000-ton hull and a 500-ton hull become the same trader.

### D. Leave the scale and raise the floor

Treat the real defect as the market screen's one-ton-per-click, let the captain trade in bulk, and let
the whole economy run at this scale.

*Against:* every price, payout, ship cost and upkeep number in the game was set for the old scale. This
is the largest change of the four and the hardest to reverse.

## What I would do

**B, with A as an optional companion at a mild k.** B is the only one that fixes the cause rather than
the symptom, and it is the only one that leaves the sentence "actual cargo capacity limits cargo and
therefore profit" true.

If B is approved, the round it lands in should carry:

- `marketDepth(systemIndex)` derived from the world's `market` strength, and a `marketQuote(index,
  goods, tons, side)` that returns the effective total and the average unit price;
- every buy and sell — the captain's screen, the fleet trader, and contract delivery if it prices off
  the board — routed through that one quote, so there is no path that still trades flat;
- the trader's planner scoring on the depth-adjusted price, so it stops choosing runs the destination
  cannot absorb, rather than discovering it on arrival;
- the market screen and the fleet panel showing the effective unit price for the quantity being traded;
- gates: `DEPTH-SATURATION` (10,000 tons into a small world must not clear at the posted price),
  `DEPTH-SYMMETRY` (buying out a world raises its price the same way), `DEPTH-SMALL-TRADER` (a run
  inside the depth is unaffected, so this does not quietly tax ordinary play), and
  `DEPTH-ONE-PATH` (no buy or sell anywhere reaches a flat price).

## What this does not touch

The purse reserve, the danger model, the intelligence model, and the personal-ship upkeep exemption are
all unaffected. Foreign markets are a separate specification and are unaffected except that a prize is
a hull, not cargo, and is not priced off a board.
