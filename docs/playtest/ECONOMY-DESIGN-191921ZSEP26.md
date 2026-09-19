# Finite commodity and cargo economy — design

DTG 191921ZSEP26 · supersedes `CARGO-ECONOMY-PROPOSAL-191746ZSEP26.md` · **nothing here is implemented**

The previous proposal recommended price slippage — a world absorbing `market × 25` tons at its posted
price and moving a latinum against you per further block. **Review rejected it** as more complicated
than BM1 needs, and asked instead for simple, visible scarcity. That is right: slippage is an invisible
curve the player has to infer, where a quantity on a shelf is a number they can read.

Four parts, and they share one economy.

## A. Cargo capacity, rebalanced

`CARGO-CAPACITY-PROPOSAL-191921ZSEP26.md`. Derived from the catalogue's own `shipClass` and `role`,
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

## Validation the implementing round owes

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
| `CAPACITY-ROLE` | a hull's hold not matching its class and role derivation |

`DEAD-WORLD` must fail on a tree that special-cases worlds by name as well as on one that ignores
population, so that the derivation is what is being tested.
