# Foreign hull markets — approved specification

DTG 191921ZSEP26 · supersedes `FOREIGN-MARKETS-SPEC-191746ZSEP26.md` and the drafts before it · **nothing here is implemented**

Base: `8b7d9b0` (`191546ZSEP26`), closed as the overlay/intelligence round. **Foreign markets remain
unimplemented**; this is the document the round that implements them works from.

**Amendments from review. Every approval in the table above stands; these are additions.**

| # | Amendment | Where |
| --- | --- | --- |
| 9 | The prize producer requires **disabled *and* taken/captured**, never disabled alone | §2 |
| 10 | **Persistent strategic vessel identity is a prerequisite** before any offscreen campaign operation may produce a prize | §0, §6 |
| 11 | That prerequisite is **its own round**, scoped separately and scheduled before this one | §0, §6 |

Amendment 11 means the prerequisite in §0 is no longer a step inside the foreign-market round. It is
`STRATEGIC-VESSEL-IDENTITY-191921ZSEP26.md`, a round of its own, and foreign markets wait behind it.
Until it lands, an offscreen campaign operation **must not invent a fully equipped prize ship that
never existed** — it must produce nothing.

This is no longer a proposal. The eight decisions below were made by the reviewer and are recorded here
as requirements, not options.

| # | Decision | Where it lives |
| --- | --- | --- |
| 1 | Foreign markets approved | §3 |
| 2 | Suliban standing is a **gate** | §3.1 |
| 3 | `book.prizes[]` and `takenFrom` approved | §1 |
| 4 | Prize records preserve **actual vessel identity and state** | §1.1 |
| 5 | Destroyed/scuttled ships never become prizes | §2 |
| 6 | Pirates preferentially sell **real** prizes | §3.3 |
| 7 | Standing penalties deduplicated | §4.2 |
| 8 | All standing deltas explicit | §4.1, §4.4 |

---

## 0. Prerequisite: strategic hulls have no identity to preserve

Decision 4 says a prize preserves the **actual vessel's identity and state**. §1.1 shows the engine has
the primitive for that — `Fleet.snapshotVessel()` plus the `name` and `seed` the capture path records.
But that is the *tactical* representation, and it exists only for hulls that have been in a scene.

The **strategic** representation is different. A campaign polity's hull is created at
`campaign-strategy.mjs:379`:

```js
const hull = { id: nextCampaignId(book, 'hull'), shipId: Number(id), hull: maxHull, maxHull,
               crew: 1, systemIndex: Number(systemIndex), status: 'ready', opId: null };
```

No `name`. No `seed`. No `vessel`. It is a design, a hull fraction and a location — which is exactly the
shape decision 4 rejected. So an offscreen Hirogen operation that disables and takes something has
nothing to make a prize *out of*. Any prize it produced would have to have its identity **invented at
the moment of sale**, which is the "the Hirogen may now sell Romulan Scouts" licence wearing a name
badge. Worse than the licence, in fact: the licence was honest about being a licence.

**Therefore.** Before any offscreen producer exists, strategic hulls must carry persistent identity —
a name and a seed assigned at `addHull` and stable for the hull's life, a vessel snapshot maintained
across strategic engagements, and both surviving the hull's normal lifecycle including
`pruneLostHulls`. The full list, the invariants and the migration are in
`STRATEGIC-VESSEL-IDENTITY-191921ZSEP26.md`, which is a round of its own.

Until that round exists, **the only producer is a boarding capture by the captain**, which does have identity
(`main.js:23341`). That has two consequences, and neither should be discovered after the fact:

1. **Hirogen Range's shelf is empty.** Its prizes come from Hirogen hunts, which are campaign
   operations. Shipping §3.2 before that round ships a shop with nothing in it, or a shop with invented
   merchandise.
2. **Pirates Haven's shelf is one generic hull.** Its prize tier needs pirate-held prizes (campaign
   operations, same problem) or `takenFrom: 'player'` records, which §1.2 already says cannot occur.

So §6's order changes: the identity round first, or those two markets wait. Suliban Helix is
unaffected — it sells from the catalogue and never touches a prize record.

The prerequisite is scoped in full in `STRATEGIC-VESSEL-IDENTITY-191921ZSEP26.md`: what must persist
(name, seed, vessel snapshot, hull and shield condition, weapons and equipment, cargo, sensors and EW,
crew state, damage and repair state), the three invariants, and deterministic migration for legacy
saves. It is not a step in this specification any more.

---

## 1. The two new records

### 1.1 `book.prizes[]` — a vessel, not a design

The third draft proposed `{ id, holder, shipId, condition, takenDay, takenFrom, atSystem, status }`.
Decision 4 rejects that shape: `shipId + condition` is a design and a scalar, which is exactly the
"the Hirogen may now sell Romulan Scouts" licence the draft was written to avoid.

The engine already has the right primitive. `Fleet.snapshotVessel(actor, defaults, now)`
(`ship-fleet.mjs:76`) copies a running hull's own state — `PHYSICAL_FIELDS` at `ship-fleet.mjs:55`:

```
condition, prizeStabilized, damageSeed, weaponSlots, weaponInventory, cargoArray, equipment,
sensorInventory, jammerInventory, antimatter, fuelCap, power, crewSkill, crewTemperament,
sensors, ew, physicalId, securityInstanceId, weaponCooldowns
```

plus `hull`, `shields`, `maxHull`, `maxShields` and the cooldown timers. That is the vessel's state.
Its **identity** is the `name` and `seed` the capture path already records alongside it
(`main.js:23341`). A prize therefore carries both:

```js
book.prizes[] = {
  id,            // nextCampaignId(book, 'prize')
  holder,        // 'hirogen' | 'pirate' | any faction key — who has it
  takenFrom,     // faction key of the party that lost it, or 'player'; null if unknown
  shipId,        // the design, for pricing and the catalogue lookup
  name,          // the vessel's own name — "Tal'Vek", not "Romulan Scout"
  seed,          // its generated identity; reused so the same hull looks the same
  vessel,        // Fleet.snapshotVessel(...) at the moment it was taken
  takenDay,
  atSystem,
  status,        // 'held' | 'sold'
}
```

**Which book.** The campaign book (`campaign-strategy.mjs`), beside `designs`, `recoveries` and
`polities`. The Hirogen take hulls through campaign operations; that is where the producing code sits.

**What it must not be stored in, and why:**

- **not `book.history`** — trimmed to `book.config.historyLimit` at `campaign-strategy.mjs:219`. A shelf
  derived from history empties when history is trimmed.
- **not `book.ledger`** — compacted to 128 recent entries plus open-day items
  (`compactFinancialBook`, `ship-fleet.mjs:203`).
- **not `book.stock`** — `advanceStock` (`ship-fleet.mjs:253`) *refills* `quantity` toward `capacity`
  every few days. A prize put through that machinery grows back. The defining property of a prize is
  that selling it is subtractive.

**Bound.** At most 12 `status: 'held'` prizes per holder. When a thirteenth arrives the oldest held
record is deleted outright — deleted, not marked sold, so nothing ever shows a sale that did not
happen. Same discipline as `trimRecoveries` (`campaign-strategy.mjs:1448`), and it keeps save size
bounded.

**Consequence for purchase — this is the part with teeth.** Buying a prize cannot go through
`buyFleetShip` (`main.js:13054`). That function checks membership by design id
(`getShipyardStock().some(s => s.id === shipId)`), calls `Fleet.consumeStock` (which regenerates), and
pushes a fleet record with **no `vessel`** — a fresh, undamaged hull. Two Romulan Scouts on the same
shelf are indistinguishable to it.

Prizes need their own entry, `buyPrize(prizeId)`, which:

1. resolves the prize by `id`, not by `shipId`;
2. sets `status: 'sold'` on that record (no `consumeStock`);
3. pushes a `state.playerFleet` record carrying the prize's `name`, `seed` and `vessel`;
4. restores that state onto the spawned actor with `Fleet.restoreVessel(actor, prize.vessel, ...)`.

The captain buys **that ship**, at the hull fraction the fight left it, with whatever was in its
weapon slots and cargo hold. A prize is never in better shape than when it was taken.

### 1.2 `takenFrom` — recorded where the identity is currently overwritten

At `main.js:23341` a successful boarding builds the fleet record with `faction: state.playerFaction`.
The original operator's faction is overwritten in the same statement that preserves the hull. So
`takenFrom` has to be read from `target.faction` **before** that assignment, and kept on the fleet
record as well as on any prize.

**Honest scope note.** `takenFrom: 'player'` cannot occur today. There is no path by which an NPC takes
a player hull intact: player fleet ships are only destroyed (`main.js:17260`, which snapshots the
vessel at the moment of destruction and removes it). The buy-your-own-ship-back case therefore stays
**unavailable** until a "your escort was disabled and taken" path exists. This spec does not invent
one. The field is still worth recording now, because it is the field that makes every other
previous-owner rule work, and because retrofitting provenance onto hulls captured before it existed is
impossible.

---

## 2. What never becomes a prize

A prize is created only where a hull was **left intact and then taken**. Disabled is where a hull *can*
be taken; it is not evidence that anyone took it. The previous revision treated "a campaign operation
whose target ends `disabled`" as a producer on its own, which would have turned every derelict left
floating after a strategic engagement into stock on a shelf — including hulls whose own side recovered
them, and hulls nobody ever went back for.

**Both conditions, together:**

- the hull is `disabled` and not `destroyed` — `classifyDamage` (`ship-fleet.mjs:37`) draws that line at
  `hull <= disableThreshold(max)` with `hull > 0`; **and**
- somebody **took** it: possession changed, and the record says who.

A boarding that ends `outcome: 'captured'` (`ship-fleet.mjs:375`) satisfies both in one step — it can
only begin against a `disabled` target and `captured` is the taking, which is also the only path that
sets `prizeStabilized`. An offscreen operation satisfies the first and must state the second
explicitly; see §0 for why it cannot do so yet.

Nothing else. In particular:

- `condition === 'destroyed'` (`hull <= 0`) produces nothing;
- `outcome: 'scuttled'` produces nothing — the boarding failed and the crew took the ship with them;
- `outcome: 'cancelled'` and `'target-lost'` produce nothing;
- **a hull left disabled and not taken produces nothing**, however the engagement ended.

One predicate, written once, called from both producers:

```js
function prizeEligible(result) {
  // Disabled is where a hull can be taken. Taken is what makes it a prize.
  return result.condition === 'disabled'
    && result.hull > 0
    && result.taken === true          // possession changed hands
    && result.takenBy != null;        // and the record says to whom
}
```

A boarding maps onto it as `{ condition: 'disabled', hull, taken: outcome === 'captured', takenBy: 'player' }`.

The Borg are excluded from prize generation entirely, and any hull the ordinary shelf refuses
(`rosterState: 'retired' | 'prototype'`, `isUnbalancedPrototype`) is refused here too, so a prize can
never hand the captain something the game does not sell. **Tactical Cube plan and capture content stays
deferred**; this spec does not touch it.

---

## 3. The three markets

| World | Government | Shelf | Shown | Price | Gate | Discovery |
| --- | --- | --- | --- | --- | --- | --- |
| Suliban Helix | suliban | catalogue, mass ≤ 3, any power the Suliban are not at war with | 3 | +35% | Suliban standing ≥ 15 | charted |
| Hirogen Range | hirogen | `prizes` where `holder === 'hirogen'` | 4 | condition-scaled | evidence of a hunt | see §3.2 |
| Pirates Haven | pirate | `prizes` where `holder === 'pirate'`, then ≤ 1 generic | 2 | condition-scaled −20% | none | shelf learned on contact |

The authored economics support the shapes rather than contradicting them: `faction-world.mjs` gives the
Hirogen `foreignTrade: 0` and the Suliban `foreignTrade: 0.04`. Neither runs open civilian commerce —
which is why the Hirogen sell **objects they took** rather than stock they ordered, and why the Suliban
fence is a **relationship** rather than a shop counter.

### 3.1 Suliban Helix — a gated fence

A service the Suliban run, at a Suliban world, under Suliban rules. Not a lawless vacuum: a
self-governed world that has decided this is a line of business.

- **Stock.** Up to three hulls at a time, mass ≤ 3, drawn from the ordinary catalogue, excluding any
  power the Suliban are themselves at war with. No capital hulls.
- **Price.** 35% over the design's ordinary price.
- **Gate (decision 2).** Suliban standing **≥ 15**, checked before anything foreign is shown. Below the
  gate the yard sells Suliban and neutral hulls like any other world, with no hint that more exists.
  This is a gate, not a surcharge: there is no price at which a stranger is served.
  15 is not a new number — it is the ceiling the existing trade-goodwill rule already stops at
  (`main.js:14165`, `+1 while standing < 15`), so the gate is reachable by deliberately trading with
  the Suliban and by nothing passive.
- **Discovery.** Findable normally once the system is charted.

Implementation: this is the one market the existing `WORLD_FOREIGN_STOCK` hook
(`main.js:10711`) can carry, but the hook must stop being a boolean. It becomes a descriptor:
`{ maxMass, markup, standingGate, excludeAtWar }`. A bare truthy value must not relax
`isFactionShipStockEligible` (`main.js:10651`) on its own.

### 3.2 Hirogen Range — prizes, which are objects

Not "the Hirogen may now sell Romulan Scouts" but "the *Tal'Vek* is here, a Romulan Scout at 41% hull,
taken on day 214, with an empty forward mount".

- **Stock.** The held prizes, up to four shown, newest first. If they take three Scouts there are
  three; selling one leaves two; selling all three leaves an empty shelf until the next hunt.
- **Price.** Ordinary design price × `hull / maxHull`, floored at `FLEET_RULES.resaleBasis` (0.35) so a
  barely-intact hull still costs more than its scrap. The Hirogen do not haggle; scarcity is the
  constraint.
- **Discovery.** Offered only once the captain has **evidence of a hunt** — a Hirogen campaign
  operation observed directly, or named in a galaxy report. Recorded as a persisted day stamp and
  read like any other piece of intelligence; the overlay/intelligence work this round closed is what
  makes that a real gate rather than a flag. Before it, the yard is a repair dock like any other.

The real cost of a Hirogen prize is the repair, not the purchase: `repairQuote` with
`FLEET_RULES.repairBasis` (0.5) is already the balance lever, and it needs no new code.

### 3.3 Pirates Haven — stolen hulls, and who minds

- **Stock (decision 6).** Prize records with `holder === 'pirate'`, **ordered with
  `takenFrom === 'player'` first**, then the rest newest-first. A generic fallback of at most one hull,
  mass ≤ 5, appears **only when no pirate prize is held**, so a newly-started campaign does not show a
  bare shelf.

  *This is also a deduplication.* The third draft listed "pirate prizes" and "hulls the captain lost to
  them" as two separate tiers. Once `takenFrom` exists they are one collection with a sort order —
  a hull the captain lost to pirates *is* a pirate-held prize with `takenFrom: 'player'`. Two shelves
  where one belongs is the same defect as two penalties where one belongs.
- **Two at a time**, refreshed as prizes arrive, not weekly. No warranty.
- **Price.** Condition-scaled as above, then −20%.
- **Discovery.** The world is findable once charted, but **what is on the shelf is learned only by
  making contact** — hailing or docking. Knowing the market exists without knowing whether it is worth
  the trip is the right shape for a place like that.
- **Reachability — an implementation catch.** Pirates Haven is hostile by default, and
  `serviceRefusal` (`main.js:4420`) refuses hostile ports outright, so the shelf as specified would be
  permanently unreachable. Rule: **the pirate ship shelf, and only the ship shelf, is exempt from
  `serviceRefusal` at that world.** Every other service there keeps the ordinary refusal. Getting in is
  still a fight or a bluff; being shot at is not the same as being told to leave.

### 3.4 What is explicitly not a market

**Sonata, Goralis, Brea, Breen Anchorage, Promelus, Promelli Drift, Anorez.** Their authored lots are
foreign hulls, which is what started this, but nothing about any of them makes them a market. They are
homeworlds, refineries and anchorages, and their lots read like data entered before those worlds had
governments. They sell what their government sells.

---

## 4. Standing

### 4.1 The deltas, in one table

Every diplomatic consequence of every foreign market is here. There is no other table and no per-market
paragraph carrying its own number.

| Row | Party charged | Δ | Applies at |
| --- | --- | --- | --- |
| A | the hull's government (`getShipFaction(shipId)`) | **−3** | Suliban Helix |
| B | the hull's government | **−4** | Hirogen Range |
| C | the hull's government | **−5** | Pirates Haven |
| D | the previous owner (`takenFrom`), when known | **−2** | all three |
| E | a government policing the approach | **−2** | Pirates Haven only |
| F | the market's own government (suliban, hirogen) | **0** | Suliban Helix, Hirogen Range |
| G | pirate, as ordinary trade | **+1 while pirate standing < 15** | Pirates Haven |

Row G is not a new rule: it is the existing trade-goodwill rule (`main.js:14165`) applied where the
captain trades. Row E means a government whose authored checkpoint or border policy covers a system
adjacent to Pirates Haven. No faction is named in any row — if the Terrans police that approach they
mind, and if they do not, they never hear about it.

### 4.2 Deduplication (decision 7)

One function, `applyForeignMarketStanding(market, prize)`, builds a `Map<factionKey, delta>` from the
rows above, and:

1. where a faction qualifies under more than one row, it takes **the largest single penalty, not the
   sum** — the Romulans do not lose 5 and then 2 more for being both the hull's government and the
   previous owner;
2. applies `adjustFactionStanding` **once per key**;
3. charges **nothing** to the captain's own faction — buying a Terran hull back as a Terran captain
   costs nothing and gains nothing, and the previous-owner row may still apply if the previous owner
   was someone else;
4. does **not** re-charge the capture. `applyCaptureStanding` (`main.js:23364`) already charges
   −2 (−4 for a patrol) plus −2 to each patrol witness within 1600 units at the moment a hull is taken.
   The market charges for the *purchase*. Taking a hull and later seeing it sold is one grievance
   billed at each event, not the same event billed twice.

### 4.3 No propagation

These deltas go through `adjustFactionStanding` directly, **not** `applyKillStanding`
(`main.js:4380`), which also awards `+ceil(|Δ|/2)` to every faction hostile to the victim and −1 to
every friend. That propagation models a kill the region notices. A quiet purchase at a fence is not
that, and routing a market through it would hand the captain free standing with nine factions for
buying one Scout.

### 4.4 Why these numbers

The engine's existing scale, so the new rows can be read against something:

| Existing act | Δ | Site |
| --- | --- | --- |
| destroy a ship | −2 (+ propagation) | `main.js:17277` |
| destroy a patrol | −4 | `main.js:17277` |
| capture a hull | −2 / −4, + −2 per patrol witness | `main.js:23367` |
| destroy a station | −6 | `main.js:17357` |
| plant a flag on a sovereign world | −8 sovereign, +12 flag faction | `main.js:4453` |
| trade at a world | +1 while standing < 15 | `main.js:14165` |

The third draft's "−10, always" was **five times the cost of destroying one of that government's
warships** and nearly twice the cost of destroying one of their stations. Rows A–C instead sit inside
the existing kill band and are ordered by how public the venue is: a deniable fence (−3), a people who
sell your war dead openly (−4), an outright pirate market (−5). Row D matches the existing witness
penalty, which is the right scale for a personal grievance sitting below a state one. Nothing here
exceeds the −6 a station costs.

Standing stays clamped to ±100 with hostility at −25 (`main.js:4358`), so a captain who shops at
Pirates Haven five times has made an enemy — which is the intended pressure.

### 4.5 Explicit at the point of sale (decision 8)

The table above is the spec's obligation; the purchase confirmation is the player's. Before the captain
commits, the prompt names **every** faction that will move and by how much — "Romulan Star Empire −5 ·
Cardassian Union −2" — with no aggregate wording and no surprise afterwards.

Per the UI writing rule: state the faction and the number. Do not explain what losing standing means.

---

## 5. Validation the implementing round owes

Nine adversarial checks, each reproducing a specific wrong behaviour and failing behaviourally (never
with a `TypeError`) on a tree that has the defect.

| Gate | Reproduces |
| --- | --- |
| `PRIZE-WRECK` | a destroyed hull, or a `scuttled` boarding, becoming merchandise |
| `PRIZE-TAKEN` | a hull left disabled and never taken appearing on a shelf — the engagement ends with a derelict and nobody claims it, and it must produce nothing |
| `PRIZE-INVENTED` | a prize whose `name` or `seed` was generated at the moment it was offered rather than carried from the vessel — any producer without persistent identity must produce nothing at all, not a plausible-looking record |
| `PRIZE-IDENTITY` | a purchased prize arriving as a fresh full-hull spawn instead of that vessel — asserts `name`, `seed` and `vessel.hull` survive the purchase |
| `PRIZE-CONSUMED` | two prizes of one design; buying one must leave exactly one, and 30 days must not restore it (guards `advanceStock`) |
| `PRIZE-DURABLE` | prizes vanishing when `book.history` passes `config.historyLimit` |
| `STANDING-ONCE` | a purchase where one faction is the hull's government *and* the previous owner *and* polices the approach — must move exactly once, by the largest single row, with no other faction touched |
| `GATE-SULIBAN` | foreign stock visible at Suliban standing 14; must appear at 15 and not before |
| `CONTACT-PIRATE` | the pirate shelf being readable without contact |

**One existing gate changes.** `HOLD` currently asserts `WORLD_FOREIGN_STOCK` is empty. The implementing
round replaces that assertion with one requiring exactly the three authored entries and no others — the
table stops being empty by design, and the gate must go on holding the boundary rather than being
deleted.

---

## 6. Implementation order

1. `prizeEligible` — disabled **and** taken — and the `book.prizes[]` record, with its bound and its
   persistence. No producer and no market yet. `PRIZE-WRECK`, `PRIZE-TAKEN`, `PRIZE-DURABLE`.
2. `takenFrom` at the capture site, before the faction is overwritten.
3. `buyPrize` and `restoreVessel` on purchase. `PRIZE-IDENTITY`, `PRIZE-CONSUMED`. At this point the
   captain's own boarding captures are the only things that can become prizes, which is correct.
4. `applyForeignMarketStanding` and the confirmation prompt. `STANDING-ONCE`.
5. Suliban Helix: the `WORLD_FOREIGN_STOCK` descriptor and the gate. `GATE-SULIBAN`, `HOLD` update.
   **This market is shippable without the identity round** — it sells from the catalogue and never
   touches a prize record.
6. **The persistent strategic vessel identity round**, which is not part of this specification:
   `STRATEGIC-VESSEL-IDENTITY-191921ZSEP26.md`. `PRIZE-INVENTED` is what keeps the boundary honest —
   until that round lands, an offscreen producer must produce **nothing**, not a record with a
   generated name on it.
7. Hirogen Range: the prize shelf and the hunt-evidence gate. **Requires the identity round.**
8. Pirates Haven: the ordered shelf, the fallback, the contact rule, the shelf-only refusal exemption.
   `CONTACT-PIRATE`. **Requires the identity round** for anything but the single generic fallback hull.

Steps 1–4 are the engine, 5 is a market that needs nothing else, and 6 is the gate on the other two.
If the round is cut short it should be cut after 5: one market working, the engine in place, and the
two prize markets unshipped rather than shipped empty or shipped inventing their merchandise.

**That round is not small**, and it is scoped separately for that reason: hull creation, strategic
engagement resolution, hull pruning, and what a campaign save contains. It is a strategic-layer feature
that foreign markets happen to need, not a foreign-market feature.

## 7. Unchanged constraints

Gorn services and recovery stay behind the existing authored discovery requirement. The authorized
cloak bypass stays. The personal-ship upkeep exemption is untouched, and no purchase here debits an
expense twice or creates a second spendable copy of the captain's money. Evacuation and blockade remain
unfinished. Nothing in this spec is pushed, merged or deployed.
