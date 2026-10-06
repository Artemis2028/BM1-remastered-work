# Persistent strategic vessel identity — round scope

DTG 191921ZSEP26 · against `75389f7` · **nothing here is implemented**

Review: *"Persistent strategic vessel identity is its own round. Do not fold it into the foreign-market
implementation. Scope a separate round after the fleet/economy work."*

## The goal, in one line

A strategic hull remains **the same physical vessel** through strategic simulation, tactical
materialisation, save, load, and back again.

## Why it does not today

A campaign polity's hull is created at `campaign-strategy.mjs:379`:

```js
const hull = { id: nextCampaignId(book, 'hull'), shipId: Number(id), hull: maxHull, maxHull,
               crew: 1, systemIndex: Number(systemIndex), status: 'ready', opId: null };
```

A design, a hull fraction and a location. No name, no seed, no vessel state. The tactical side has the
whole thing — `Fleet.snapshotVessel()` (`ship-fleet.mjs:76`) copies condition, damage seed, weapon
slots and inventory, cargo, equipment, sensors, EW, antimatter, fuel, power, crew skill and
temperament, physical id and cooldowns, and the player-fleet record carries `name` and `seed` beside it
(`main.js:23341`).

So a strategic hull that materialises is a fresh spawn wearing the right class, and when it
dematerialises everything it acquired is lost. Two ships of the same class are indistinguishable, and a
hull that fought yesterday arrives today undamaged.

## What the round must make persistent

| | Field | Where it exists today |
| --- | --- | --- |
| 1 | **name** | tactical only, generated per spawn |
| 2 | **seed / identity** | tactical only |
| 3 | **physical vessel snapshot** | `Fleet.snapshotVessel`, tactical only |
| 4 | **hull and shield condition** | strategic has `hull`/`maxHull`; no shields, no `condition` |
| 5 | **weapons and equipment** | tactical only |
| 6 | **cargo** | tactical only |
| 7 | **sensors and EW** | tactical only |
| 8 | **crew state** | strategic has `crew: 1`; tactical has skill and temperament |
| 9 | **damage and repair state** | strategic hull fraction only; no repair history |

## The three invariants

1. **Two ships of the same class stay distinguishable.** Name and seed are assigned once, at
   `addHull`, and never regenerated.
2. **Strategic → tactical → strategic does not regenerate the vessel.** Materialising restores the
   snapshot onto the actor; dematerialising writes it back. A round trip with no events in between is
   a no-op, and that is the cheapest possible gate.
3. **Legacy saves migrate deterministically.** A save written before this exists has hulls with no
   identity. They get one, derived from data the save already carries — the hull's campaign id, its
   `shipId` and its polity — so the same save always migrates to the same fleet, and a hull does not
   change its name because the player loaded twice.

## Where it touches

- `addHull` and hull creation, for identity at birth;
- strategic engagement resolution, for the snapshot surviving a fight rather than a hull fraction
  standing in for it;
- `pruneLostHulls`, which today clears destroyed hulls once no operation names them — identity has to
  outlive that or a hull's history vanishes mid-campaign;
- materialisation and dematerialisation, both directions;
- the save format, and its migration.

## Gates the round owes

| Gate | Reproduces |
| --- | --- |
| `IDENTITY-STABLE` | two hulls of one class that cannot be told apart |
| `IDENTITY-ROUNDTRIP` | a hull that materialises damaged and dematerialises whole, or vice versa |
| `IDENTITY-NO-REGEN` | a strategic → tactical → strategic round trip that changes name, seed or state with nothing happening in between |
| `IDENTITY-PERSIST` | identity lost across save and load |
| `IDENTITY-MIGRATE` | a legacy save producing different identities on two loads of the same file |
| `IDENTITY-PRUNE` | a hull losing its identity to the ordinary lost-hull pruning |

## Why it comes before foreign markets

A prize is required to preserve the actual vessel's identity and state. An offscreen campaign operation
has none to preserve, so it would have to invent one at the moment of sale — a licence to sell any
class, wearing a name badge. Until this round lands, the only producer with real identity is a boarding
capture by the captain, which leaves two of the three foreign markets with nothing to sell.

This is a strategic-layer feature that foreign markets happen to need, not a foreign-market feature.
