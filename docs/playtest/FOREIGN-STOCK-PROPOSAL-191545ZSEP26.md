# Foreign hull stock — proposal for review, third draft

DTG 191545ZSEP26 · against the candidate on top of `7767631` · **nothing here is implemented**

Every world's shipyard sells its own government's designs and neutral ones, and nothing else. This
document proposes where that should stop being true. It is a third draft: the first was reviewed and
three of its four sections were wrong in ways worth recording.

## Why the original two entries were withdrawn

Two worlds were authored as dealing in other powers' hulls, each on a phrase from its own description:

| World | The phrase | What the phrase actually says |
| --- | --- | --- |
| Hirogen Range | "trophy vaults" | what the Hirogen **keep** — a vault is not a showroom |
| Suliban Helix | "trading quietly" | **how** the Suliban trade, not **what** |

Neither says a shipyard sells a Romulan Scout to a passing Terran captain. Reading an inventory out of
them was making a description carry a gameplay decision it does not contain. Both are gone, the table
they were in is empty, and the gate holds it empty.

## What was wrong with the first draft

- **It called Suliban Helix ungoverned.** It justified the fence on "no government" and "no standing to
  lose" — and this candidate's own world-identity evidence makes Suliban Helix a **self-governed
  Suliban world**, exactly as Hirogen Range is self-governed Hirogen. The fence can still exist; it is a
  Suliban service, and Suliban standing is what it costs.
- **It let the Hirogen sell a design because they had once killed one.** Availability was derived from
  the campaign's record of losses, which means the merchandise vanishes when that record ages out.
  Trimming history should not empty a shop. What the Hirogen have is *prizes* — specific hulls, in
  specific condition — not a licence.
- **It charged everyone five Terran standing.** A flat "−10 with the hull's government, −5 Terran
  always" is a Terran-shaped exception inside a system this candidate has spent three rounds making
  faction-blind.

## The proposal

Three worlds, each with a bounded inventory, a price, and a diplomatic consequence that follows the
party actually harmed.

### 1. Suliban Helix — a Suliban fence

**What it is.** A service the Suliban run, at a Suliban world, under Suliban rules. Not a lawless
vacuum: a government that has decided this is a line of business.

**Stock.** Up to three hulls at a time, mass ≤ 3, of any power the Suliban are not themselves at war
with. No capital hulls.

**Price.** 35% over the design's ordinary price.

**Standing.** Requires Suliban standing at or above a threshold to be offered at all — this is the part
the first draft got backwards, and it is what makes the fence a relationship rather than a vending
machine. Buying costs 5 standing with the **hull's own government**, and nothing with anyone else.
Being refused here should be a consequence of how the captain has treated the Suliban.

**Discovery.** Findable normally, once the system is charted. A captain who goes there can see what is
on offer.

### 2. Hirogen Range — prizes, which are objects

**What it is.** A hunt produces a hull. The hull is the merchandise. Not "the Hirogen may now sell
Romulan Scouts" but "there is a Romulan Scout here, at 68%, taken on day 214".

**A destroyed hull is wreckage, not merchandise.** The first draft said "destroys or disables", which
would have let the Hirogen sell ships they had blown apart. Only two things become a prize:

- a hull **disabled** and then taken — the engine already draws that line, at
  `hull <= disableThreshold(max)` in `ship-fleet.mjs`, and already has the notion of a prize being
  stabilised rather than scuttled (`prizeStabilized`, `outcome: 'captured' | 'scuttled'`);
- a hull **captured** intact.

A hull whose `condition` reaches `destroyed`, or a boarding that ends `scuttled`, produces nothing to
sell. That is the difference between a hunt and a kill, and the Hirogen sections of this proposal only
work if the distinction is kept.

**What this needs that does not exist.** A prize record, created at the moment a Hirogen operation
takes a hull that was disabled rather than destroyed. Proposed shape:

```
book.prizes[] = { id, holder: 'hirogen', shipId, condition, takenDay, takenFrom, atSystem, status }
```

It lives in its own collection, **not** in `history`, and nothing that trims the campaign's records may
touch it. Selling one sets `status: 'sold'` and removes it from the shelf. If the Hirogen take three
Romulan Scouts, there are three, and selling one leaves two.

**Stock.** Whatever prizes are on the shelf, up to four shown. Condition is whatever the hull was at
when it was taken — a prize is never in better shape than the fight left it — and it rides on the hull
the captain buys. This is the one place in the game a damaged hull is the point rather than a problem.

**Price.** Ordinary price scaled by condition. The Hirogen do not haggle; the scarcity is the constraint.

**Standing.** 5 with the hull's own government, who are watching their dead being sold.

**Discovery.** The shelf is only offered once the captain has **evidence of a Hirogen hunt** — a
Hirogen operation they observed, or a galaxy report of one. Before that the yard is a repair dock like
any other.

### 3. Pirates Haven — stolen hulls, and who minds

**What it is.** A pirate-held, hostile world the captain must fight or bluff their way into. A market
behind a threat is a different thing from a shop.

**Stock — actual stolen hulls first.** A pirate market should be selling things pirates took, not a
weekly roll dressed as loot. The shelf is, in order:

1. **prize records held by `pirate`** — the same collection the Hirogen use, filled the same way: a
   hull disabled or captured by pirates, in the condition the fight left it, consumed when sold. This
   should be the normal case, and it makes the market a consequence of what the pirates have actually
   been doing;
2. **hulls the captain sold or lost to them**, if the `takenFrom` field below exists — buying your own
   ship back from the people who took it is the best thing this market could offer;
3. **a generic fallback** of at most one hull, mass ≤ 5, only when the first two are empty, so a
   newly-started campaign does not show a bare shelf.

Two hulls at a time, refreshed as prizes arrive rather than weekly. Condition from the prize record; no
warranty.

**Price.** 20% under ordinary.

**Standing — the part the first draft got wrong.** The cost follows the party actually harmed, in this
order:

1. the hull's own government loses 10, always;
2. **the previous owner, when it is known** — which needs a `takenFrom` recorded on a hull at the moment
   it is captured, and **is not tracked today**. That field is the second thing this proposal asks for;
3. any government that **polices this market** — that is, one whose authored checkpoint or border
   policy covers a system adjacent to Pirates Haven — loses 5.

No faction is named in the rule. If the Terrans police that approach they mind; if they do not, they do
not hear about it.

**Discovery.** The world is findable once charted, but **what is on the shelf this week is only learned
by making contact** — hailing or docking. A captain can know the market exists and not know whether it
is worth the trip, which is the right shape for a place like that.

## What I would not do

- **Sonata, Goralis, Brea, Breen Anchorage, Promelus, Promelli Drift, Anorez.** Their authored lots are
  foreign hulls, which is what started this, but nothing about any of these worlds makes them a market.
  They are homeworlds, refineries and anchorages, and their lots read like data entered before those
  worlds had governments. The right answer is the one in place: sell what their government sells.
- **Any of this without the standing cost.** A foreign market with no diplomatic consequence is a
  bigger shop, and it would quietly remove the reason to care whose space the captain is in.
- **Any of this without the prize records.** A shelf derived from a statistic is a shelf that empties
  when the statistic is pruned — and a shelf rolled weekly is not loot, it is a shop with a theme.

## What this asks the reviewer to decide

1. Whether foreign markets should exist at all, given that without them the designs of every power the
   captain is at war with are unreachable except by capture and the recovery contracts. That may be the
   intended shape of the game.
2. Whether the two new records — `book.prizes[]` and `takenFrom` on a captured hull — are worth their
   weight. **Both of the market sections now depend on the first**, since a pirate shelf of actual
   stolen hulls is the same collection under a different holder; the Pirates Haven section degrades
   gracefully without the second, falling back to the hull's government alone, and loses only the
   buy-your-own-ship-back case.
3. Whether the Suliban standing threshold is a gate or a price. As written it is a gate: below it,
   nothing is offered.
