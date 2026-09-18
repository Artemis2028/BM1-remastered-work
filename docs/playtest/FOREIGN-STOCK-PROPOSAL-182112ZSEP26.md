# Foreign hull stock — proposal for review

DTG 182112ZSEP26 · against the candidate on top of `7767631` · **nothing here is implemented**

Every world's shipyard now sells its own government's designs and neutral ones, and nothing else. This
document proposes where that should stop being true, and asks for a decision rather than making one.

## Why the previous two entries were withdrawn

Two worlds were authored as dealing in other powers' hulls, each on a phrase from its own description:

| World | The phrase | What the phrase actually says |
| --- | --- | --- |
| Hirogen Range | "trophy vaults" | what the Hirogen **keep** — a vault is not a showroom |
| Suliban Helix | "trading quietly" | **how** the Suliban trade, not **what** |

Neither sentence says a shipyard sells a Romulan Scout to a passing Terran captain. Reading an
inventory out of them was the same mistake as reading a grey market out of an emptied shelf, one step
further back: a description was made to carry a gameplay decision it does not contain. Both are gone,
and the table they were in is empty and gate-held at empty.

## What the decision actually is

Selling foreign hulls is not a fact about a world's text. It is a choice about **where a captain may
buy what**, and it has consequences the descriptions say nothing about:

1. **It is the only way to fly a hull whose government will not sell to you.** With no foreign market,
   the designs of every power the captain is at war with are unreachable except by capture and the
   recovery contracts. That may be the intended shape of the game; it should be chosen, not fallen into.
2. **It sets a price floor on piracy and salvage.** A world that will buy and resell a foreign hull is
   also a world that will buy a captured one. The boarding and capture rules already exist; a grey
   market is where their output goes.
3. **It is a standing lever.** A vendor that sells what its own government forbids is a vendor that can
   be refused to a captain whose flag it dislikes, or opened up as a reward.

## The proposal

Three worlds, chosen for what they are in the campaign rather than for what their prose says, each with
a named and bounded inventory rather than "whatever was in the authored lot".

### 1. Suliban Helix — a fence, small hulls only

**Why this world.** It is a chain of cell docks with no government, no berths worth the name and no
standing to lose. It is the one place on the chart where a transaction nobody will admit to is in
character for the *situation*, not for a turn of phrase.

**Proposed stock.** Up to three hulls at a time, drawn only from designs of mass ≤ 3 belonging to
powers the Suliban are not themselves at war with. No capital hulls, ever.

**Proposed cost.** A 35% premium over the design's ordinary price, and standing with the hull's own
government falls by 5 on purchase. Buying a Romulan scout here should be something the Romulans find
out about.

### 2. Hirogen Range — prizes, and only ones the Hirogen took

**Why this world.** The Hirogen hunt, and the campaign already tracks hulls lost in operations. A
Hirogen prize yard is the natural sink for what the hunt produces.

**Proposed stock.** Only designs the Hirogen have actually destroyed a hull of in this campaign —
`book.stats` and the operation records already carry the losses — capped at two, and cleared when the
campaign's record of that loss ages out. This is the option that needs new bookkeeping: a per-polity
"what have you killed" list. It is also the only one of the three that would make the market a
consequence of play rather than a fixture.

**Proposed cost.** Ordinary price. The Hirogen do not haggle, and the scarcity is the constraint.

### 3. Pirates Haven — stolen hulls, with the risk attached

**Why this world.** It is already pirate-held and hostile, and the captain must fight or bluff their
way in. A market that exists behind a threat is a different thing from a shop.

**Proposed stock.** Up to two hulls, any faction, mass ≤ 5, refreshed weekly.

**Proposed cost.** A 20% discount, no warranty — the hull arrives at 60–80% condition — and buying here
is visible: standing with the hull's own government falls by 10, and with the Terran Empire by 5
whatever the hull.

## What I would not do

- **Sonata, Goralis, Brea, Breen Anchorage, Promelus, Promelli Drift, Anorez.** Their authored lots are
  foreign hulls, which is what started this, but nothing about any of these worlds makes them a market.
  They are homeworlds, refineries and anchorages. Their lots read like data entered before those worlds
  had governments, and the right answer is the one in place: sell what their government sells.
- **Any of this without the standing cost.** A foreign market with no diplomatic consequence is just a
  bigger shop, and it would quietly remove the reason to care whose space the captain is in.

## Open question for the reviewer

Should a foreign market be *discovered* rather than listed — the Suliban fence only offering to a
captain who has already done business with them, the Hirogen yard only after the captain has seen a
Hirogen hunt? That would make all three of these a reward for play rather than a line on a map, at the
cost of the captain never knowing they exist until they do. I lean towards yes for the Hirogen and
Pirates Haven, and no for the Suliban, who should be findable by anyone willing to go there.
