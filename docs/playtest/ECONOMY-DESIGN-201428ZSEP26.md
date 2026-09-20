# Finite commodity and cargo economy — design

DTG 201428ZSEP26 · supersedes `ECONOMY-DESIGN-191921ZSEP26.md` · **built in this candidate, except where marked**

The previous proposal recommended price slippage — a world absorbing `market × 25` tons at its posted
price and moving a latinum against you per further block. **Review rejected it** as more complicated
than BM1 needs, and asked instead for simple, visible scarcity. That is right: slippage is an invisible
curve the player has to infer, where a quantity on a shelf is a number they can read.

Four parts, and they share one economy.

## What is built, and what is not

**Built in this candidate:** B, C and D below — finite commodity supply and demand with replenishment,
cargo contracts with explicit tonnage drawn from a bounded per-world book, one economy shared by the
captain and every fleet trader, uninhabited worlds derived from population and installations, and
multi-stop circuits carrying several shipments at once.

**Not built, on purpose:** A, the cargo-capacity rebalance. Review asked for the roster table first, so
the ship data is untouched and the table is `CARGO-CAPACITY-PROPOSAL-201428ZSEP26.md`. And **no payout,
margin, replenishment rate or ship price has been tuned** — the measurements come first.

## A. Cargo capacity, rebalanced — proposed, not built

`CARGO-CAPACITY-PROPOSAL-201428ZSEP26.md`. Derived from the catalogue's own `shipClass` and `role`,
never from a hull's name. Fighters and scouts tiny, escorts small, cruisers moderate, large combat
ships larger but below freighter capacity, freighters substantially larger, heavy dedicated freighters
the largest in the game at 840 tons. The 10,000-ton mass-6 warship becomes 308; the 3,500-ton bulk
freighter becomes 840 and stays the biggest hold there is.

## B. Commodities are finite and visible

A world's board stops being an infinite tap. Each good it trades carries a quantity:

```
Medical supplies — 82 t available @ 7 L/t
```

- **Supply** is consumed by buying and comes back over campaign time, at a rate derived from the
  world's population, market strength and installations. A world that has just been cleaned out is
  visibly cleaned out.
- **Demand** is the same shape in the other direction: a world will absorb a finite quantity of a good
  before it stops paying for more. A 1,000-ton hold means the ship can carry 1,000 tons; it does not
  mean a world has 1,000 profitable tons waiting.
- **One economy.** The captain's market screen and every fleet trader draw on the same numbers. There
  is no separate AI economy and no infinite fleet-trader stock. A trader that empties a shelf empties
  it for the captain too, and the captain can do the same to their own traders.
- **Prices keep drifting as they do today**, ±2 a day. Selling does not move a price. The quantity is
  the whole of the scarcity, because that is the part a player can see.

The number a world can hold is `clamp(score × 6, 10, 220)` tons per good, where `score` is derived from
population, market strength and installations. Measured against the real map that gives about 50 tons
at a small world and 110–220 at a major one.

## C. Cargo contracts carry explicit tonnage, and there are only so many

A job says what it is:

```
18 t medical supplies — Earth → Vulcan
140 t industrial equipment — Earth → Cardassia
```

- **A ship must have the remaining hold to accept it.** A shipment is taken whole or not at all.
- **A world keeps a limited number of jobs open at once**, derived from the same capability score —
  about two at a small world, four to six at a major one. Taking one does not instantly produce
  another; a world generates new demand over time. **A captain cannot stand at one system rerolling
  jobs until an arbitrarily large hold is full.**
- **Large freighters combine compatible shipments.** Several jobs, and commodity lots for whatever hold
  is left, carried together. This is the thing that makes a large hold worth its price — see the
  finding in the measurements document, which is unambiguous about it.

## D. Uninhabited worlds do not trade

A world with **no population and no surviving installation** generates no commodities, no demand and no
cargo jobs. It is not on any trader's list and it has no board.

Derived from the world's population and its installations, not from its name and not from an exception
table. Against the current map that is nine worlds. A zero-population world that *does* have a station,
outpost or colony trades at whatever that installation supports, because the installation is the
authored economic reason.

This closes the open §3.5 item, which is why it is in here rather than waiting for its own round.

## What this replaces, and what it leaves alone

**Replaces:** price slippage, depth blocks, and the `market × 25` curve. None of it survives.

**Leaves alone:** the ±2 daily price drift, the board's eight commodities, contract hazard pay, the
purse reserve, the danger model, the intelligence model, and the personal-ship upkeep exemption.
Foreign markets are unaffected: a prize is a hull, not cargo, and is not priced off a board.

## Two things the build turned up

**A trader could strand itself for ever.** A circuit that ended at a world which refuses the captain —
one that changed hands while she was out, or one with no economy — left her unable to plan, and she sat
there for the rest of the campaign. Being turned away at a call is now a failed **call**: the cargo
addressed there stays aboard, the rest of the circuit goes ahead, and a trader with nowhere to work
moves to the nearest world that will deal with her. That is not recall — she is continuing her own
business, and §5 is still where the captain gets to say where she should go.

**Planning commits.** Choosing a circuit claims shipments off a world's book and buys cargo off its
shelf in the same breath. That is deliberate — it is how two traders cannot take the same shipment —
but it means a planner call is not a query, and anything that wants to compare two plans has to do it
against the same world twice, not once after the other.

## Validation

| Gate | Reproduces |
| --- | --- |
| `SUPPLY-FINITE` | a world selling more of a good than it has, or a shelf that does not go down when it is bought from |
| `SUPPLY-SHARED` | a fleet trader buying from stock the captain cannot see, or the captain's purchase not reducing what a trader can take |
| `DEMAND-FINITE` | a world absorbing an arbitrary tonnage at its posted price |
| `SUPPLY-REPLENISH` | a shelf that never comes back, or one that refills instantly |
| `JOB-TONNAGE` | a cargo job a ship has no room for being accepted |
| `JOB-FINITE` | a world producing unlimited jobs on demand — standing at one system must not reroll a full hold |
| `JOB-COMBINE` | a freighter unable to carry two shipments its hold has room for |
| `DEAD-WORLD` | a world with no people and no installation offering goods, demand or jobs |

`CAPACITY-ROLE` — a hull's hold not matching its class and role derivation — belongs to the round that
changes the ship data, and is not in this candidate because that data is unchanged.

Eleven checks are in the suite, covering those eight plus the circuit behaviour review asked for: two
traders cannot take the same tons or the same shipment; cargo stays addressed and comes off only at its
own call; freed hold goes back to work later in the circuit; and a reload resumes the route, the leg,
the manifest, the shelves and the books of work exactly. Intermediate danger and a stopped trader never
flying the rest of its route are already held by the leg-by-leg check from the previous round.

`DEAD-WORLD` fails on a tree that special-cases worlds by name as well as on one that ignores
population: the check builds an outpost on an empty world and requires it to start trading.
