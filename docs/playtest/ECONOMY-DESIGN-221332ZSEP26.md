# Finite commodity and cargo economy — design

DTG 221332ZSEP26 · supersedes `ECONOMY-DESIGN-221153ZSEP26.md` · **built**

Changed in this revision: **§H, two cross-domain rules** — Stop trading controls autonomous trading
only and leaves a movement order whole, and an order received by a ship that cannot fly is hers,
unresolved, and resumes after repair. Nothing else in §H moves, and nothing in the economy: A–G are as
`ab7d775` left them, §4 is closed, and §5 closes on this revision.

Unchanged and still in force: the four danger settings as review approved them (§F), judged from the
flag the captain knows and never the live truth; the time-aware planner (§G); the payout, a route and
hazard fee once plus twenty latinum a ton; every hold, the Concord's 1,320 included; the twelve-day
regeneration; the 150-day lifetime of an unaccepted shipment, approved and named for later playtesting;
freight from a failed contract is the shipper's and goes home for nothing; only an installation that
does economic, commercial or logistics work gives a world an economy; every dead end in the trade
planner is a move, with a reason, or a hold.

The previous proposal recommended price slippage — a world absorbing `market × 25` tons at its posted
price and moving a latinum against you per further block. **Review rejected it** as more complicated
than BM1 needs, and asked instead for simple, visible scarcity. That is right: slippage is an invisible
curve the player has to infer, where a quantity on a shelf is a number they can read.

Four parts, and they share one economy.

## What is built, and what is not

**Built:** A, B, C and D below — the fourteen approved hold reductions, finite commodity supply and
demand with replenishment, cargo contracts with explicit tonnage drawn from a bounded per-world book,
one economy shared by the captain and every fleet trader, uninhabited worlds that trade only where
something there does economic work, and multi-stop circuits carrying several shipments at once.

**Tuned, for the first time, and only here:** the contract payout's *shape*. Nothing else — no margin,
no replenishment rate, no ship price, and none of the four danger settings, which cannot be compared
honestly while repairs are free (see §6).

## A. Cargo capacity — the fourteen reductions, applied

`CARGO-CAPACITY-211330ZSEP26.md`. Derived from the catalogue's own `shipClass` and `role`, never from a hull's
name. Fighters and scouts tiny, escorts small, cruisers moderate, large combat ships larger but below
freighter capacity, freighters substantially larger, and the heavy dedicated freighters largest of all.

Review approved the fourteen challenged holds and rejected the nine raises, then on a second reading
ruled the Concord an authored civilian/commercial exception. So: **thirteen oversized warship holds are
cut to the derived default**, the **Concord is 1,320 tons** — the heavy-cargo tier for a battleship-class
hull, not the 10,000 it shipped with — and **every authored freight exception stands untouched**. The
Tholian Isaac Freighter keeps **3,500 tons** and remains the largest hold in the game; the Concord is
second; the Delpin Luxury Liner keeps 1,600; the Tarellian and Ferengi hulls keep 1,500; the Dominion
Freighter keeps 1,350. The nine small holds keep the capacities they shipped with. They are not shut out
of the *work*: every third shipment on a world's book is a courier lot of one to five tons, so the work
comes down to the small hull rather than the hull being enlarged to meet it. It does not follow that a
tiny hull earns more — the measurements say it earns exactly what it earned before, because what stops
it is the danger model rather than the size of the work.

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
- **A shipment nobody accepts does not wait for ever.** After `jobLifetimeDays` — **150** to start —
  it is gone: somebody else carried it, or the need passed. Nothing is said about it and nobody is paid
  for it. Its slot is free from that moment and the twelve-day generation fills it in its own time, so
  a book that was full of work a trader could never take turns over into work it might. A shipment
  that has been **accepted** — by the captain or a trader — is a contract, and this rule never touches
  it. The instrumentation that found the problem measured books 92–100% full at three thousand days
  with a median posting from around day one hundred; the tables in `ECONOMY-MEASUREMENTS-211330ZSEP26.md`
  show what the same boards look like now.
- **A shipment put back is as old as it was.** The planner claims shipments as it plans and puts them
  back when it abandons a plan; rebuilding them without their date made every abandoned plan a fresh
  posting, which is one way a shipment nobody will take lives for ever. The date travels with the
  shipment onto the manifest and back.
- **Large freighters combine compatible shipments.** Several jobs, and commodity lots for whatever hold
  is left, carried together. This is the thing that makes a large hold worth its price — see the
  finding in the measurements document, which is unambiguous about it.
- **Every third shipment is a courier lot** of one to five tons, so a shuttle, a fighter or a scout has
  work it can take without any small hold being enlarged.

### What a shipment pays

A shipment is a **job of work**, not a per-ton bounty:

```
fee paid once  = 200 + distance x 1.5  (capped at 2,500)
               + 150 asteroids + 250 nebula + 800 wartime destination
plus            20 latinum per ton
```

The old formula was `150 + min(350, distance x 3) + hazard`, charged **on every ton**. Two things were
wrong with it. The distance term saturated at 117 route units, and the shortest route on this map is
66 while the median is 640 — so every shipment beyond the next system over paid the same flat rate, and
the measured band was a nearly uniform 416 to 620 latinum a ton. And because the voyage's whole price
was multiplied by the tonnage, one full hold was worth more than a warship: contract income ran to
223,760 latinum per thousand days against 29,313 from commodity trading.

Priced once, the distance term can carry the real range without a ceiling doing all the work — it binds
only past 1,533 units. What a shipment is worth is now `fee + 20 x tons`, in one place
(`jobPay`), and what a trader compares when choosing between two of them is that price over the hold
the shipment occupies (`jobPayPerHoldTon`), which is the question a hauler actually asks.

**This is a first measurement pass, not a locked number.** The five constants are named in
`TRADE_ECONOMY` and the resulting tables are in `ECONOMY-MEASUREMENTS-211330ZSEP26.md`.

## D. Uninhabited worlds trade only where something there does economic work

A world with **no population and no installation that does economic, commercial or logistics work**
generates no commodities, no demand and no cargo jobs. It is not on any trader's list and it has no
board.

"No population and no installation at all" was too broad, because it counted anything that had been
built. A gun platform on a bare rock kept a commodity shelf and a book of freight contracts. The test
now reads the **same resolved capabilities** the docking port and the campaign read, and asks whether
the site keeps a commodity board, carries passengers, sells hulls, earns revenue, clears freight through
customs, mines, farms or houses anyone. Nothing is named:

| counts as an economy | does not |
| --- | --- |
| starbases, shipyards, trade stations, ore stations, habitats, waterparks, casinos, cargo terminals, biodomes, maintenance stations, bars, the Dyson Sphere | defence platforms, advanced defence platforms, subspace comms, communication arrays, wormhole generators, research labs, research stations, universities, command outposts |

Twenty-seven of the thirty-six authored station roles do economic work and nine do not. Because the
test reads the resolved capabilities rather than the type alone, a **destroyed, unbuilt, abandoned or
dormant** site contributes nothing either, which closes a case the old rule got wrong: the two Gorn
trade stations are dormant behind their authored discovery event, and the Gorn world was running a
market off them regardless. It no longer does, and it starts when the discovery event does.

Against the current map: 86 of 270 surviving installations stop counting, Earth goes from eighteen to
nine, and two more worlds (Gorn, and Kardon with only a wormhole generator on it) drop out of the
economy altogether. A zero-population world that *does* have a trading post, a mine or a habitat trades
at whatever that installation supports, because the installation is the authored economic reason.

This closes the open §3.5 item, which is why it is in here rather than waiting for its own round.

## E-1. A trader that cannot plan where she stands moves on

Turned away at a port has moved a trader on since `4008e24`. Two other dead ends did not, and the
long-horizon runs found both: a world that deals with her and has no work she can take, and a hold full
of cargo nobody nearby is buying. In each the planner returned nothing, so she stood there — measured at
4,342 idle days out of 5,000, and nine tenths of a campaign for the five-ton hull.

Every dead end in the planner is now a move. The reposition chooses by what actually frees her: a world
**buying what is already in her hold** first, then one with **work she could take**, and only then the
nearest port. Two of those dead ends also unwind what the planning steps had already committed —
claimed shipments go back on the world's book, bought cargo is refunded and put back on its shelf —
because a planner that decides not to go must not destroy the work and the tons on its way out.

## E. A failed delivery loses the contract; the cargo stays the shipper's

A shipment addressed to a port that will not deal with the ship used to be struck off the manifest when
the circuit ended, and its tons ceased to exist — a full hold could empty itself by failing. The first
repair kept the tons and carried them as the captain's own unaddressed stock, to be sold wherever
somebody was buying, and left the question of whose they were open. Review closed it: **the freight is
the shipper's.**

So a failed shipment becomes a **return** entry on the manifest: the same tonnage, addressed back to
the world it came from, carrying the shipper's name, worth nothing to the captain. Three rules follow
from that and each is what the trader actually does:

- **It goes home first.** Return cargo aboard decides the first calls of the next circuit, ahead of new
  work, and if the trader has nothing else to do the reposition prefers the shipper's world over one
  that is buying or one that has work.
- **It is handed back for nothing.** At the shipper's world the tons come off, the purse does not move,
  and the log says *"returned N tons of undelivered freight to <shipper>; nothing owed."* Standing at
  that world at planning time — after a reload, say — hands it back before anything is planned.
- **It is never sold.** At any other world, however much that world is paying for the good, the entry
  stays in the hold. The captain has no stock to sell.

The shipment id names its origin (`job-<origin>-<n>`), so a manifest saved before the origin was
recorded on it still goes home.

**What is still not built, on purpose:** any claim, fine, penalty to standing, or deadline on the
return. A failed contract costs the captain the fee and the trip, and nothing more, until review says
otherwise. And if the shipper's own world will not deal with the ship either, the freight stays aboard;
that is a hold the captain has to solve by repairing standing, and it is reported on the panel as such.

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
business; where the captain says she should go is §H.

**Planning commits.** Choosing a circuit claims shipments off a world's book and buys cargo off its
shelf in the same breath. That is deliberate — it is how two traders cannot take the same shipment —
but it means a planner call is not a query, and anything that wants to compare two plans has to do it
against the same world twice, not once after the other.

## F. The four danger settings

| setting | meaning |
| --- | --- |
| **Safe** | reported routes only: refuses any route with a system nobody has reported on |
| **Cautious** | may cross charted space nobody has reported on, **unless what the captain knows says it is hostile**: the flag the system is known under is hostile to or at war with the captain, or an operation the captain has heard of is aimed at it; accepts known danger up to band 1 |
| **Risky** | accepts known danger up to band 2, and unreported space |
| **Any** | accepts anything |

**What the captain knows** is `knownSystemController`: the controller written on the last conditions
record of the system if there is one, and otherwise the flag the system was **charted with** when the
campaign began — never the live controller. A conquest nobody has seen does not change what a trader
is allowed to assume. The first build of this rule read `getSystemFaction`, which is the live truth,
and so a Cautious trader's plans changed the day a system was secretly taken; review caught it and
`CAUTIOUS-STALE-FLAG` holds it.

**What the trader finds is written down.** Arriving in a system — every leg's end, a crossing or a call
— a trader files the same dated, sourced conditions record the captain's own bridge files
(`fleetTradeObserve`, through the same `readLiveConditions` the captain's readout uses), and the
controller she found is on it. So the plan she flies is made on the flag the captain knew, she meets
whatever is actually there when she crosses, and the next plan knows what she saw. Prices are still not
recorded until the port deals with her. The chart's own "surveyed" marking is not touched by this: her
record feeds the planner and the conditions readout, not the survey status of the map.

Measured under these rules on the same hull and seeds, Cautious opens three times as many worlds'
books as before, delivers nearly twice the shipments, and is crippled on a crossing nearly twice as
often — the uncertainty being real. The tables are in `ECONOMY-MEASUREMENTS-211330ZSEP26.md`.

## G. A circuit is built by what each call earns per day

The planner ranked a shipment by its price over the hold it occupied and took every deliverable one
that fitted. With dead boards that never mattered; with live boards it sent a Risky trader across the
map for a shipment whose price did not pay for the voyage, and the loose settings earned half what the
tight ones did.

A circuit is now built one call at a time. Every call the cargo already aboard obliges her to make —
the shipper's freight going home, a shipment still to be delivered — goes in first, at the cheapest
point in the route, whatever it is worth. Then, repeatedly, the planner asks of every world she may go
to: what would a call there load, within the room and purse left — shipments to it, whole or not at
all, then commodity lots for it at known prices — and how many days would it add, inserted where it
fits best? The call's **incremental net** is those payouts and margins less the upkeep of the added
days; its worth is that net **per added day**. The call that most raises the circuit's earnings per
day is made, and **no call that would lower them is made** — a shipment that pays less per day than
the circuit already earns is left on the board for somebody else, or for later.

```
score(circuit)        = expected net / total circuit days
expected net          = known shipment payouts + known commodity margin − upkeep × days
add a call only if    incremental net / added days  ≥  circuit net / circuit days
```

**Days are the days she will fly.** A route is flown leg by leg and the calendar charges each leg
rounded up to a whole day, `routeLegDays(route)`; the planner first reckoned the same route from its
total distance in one rounding, which is never more and usually less, by about a day a hop. So a
six-hop shipment was priced per day against fewer days than it cost and could outrank a two-hop one
that really paid better. `fleetTradeRouteDays(route)` — the sum of `routeLegDays(route)` — is now the
one reckoning of journey time in fleet trading: the insertion cost of a call, the circuit's days and
rate, a reposition's days, and whether a shipment at a candidate world pays for its own voyage. The
formation dispatch that moves a fleet to its station in one jump is not fleet trading and is left as it
is; §5 will meet it. `RANK-LEG-TIME` holds the property: two shipments priced so that the far one wins
by the distance reckoning and loses by the flown one, and the planner must take the near one at its
real rate. On `acffccf`: *"Lappa is 6 hops and really takes 134 days, not the 131 a distance reckoning
gives it, and at 39 latinum a day it is worse than Alpha Centauri at 40."*

Nothing is claimed or bought until the circuit is decided, so an abandoned plan has nothing to put
back. Danger is not priced: the setting already says what the captain permits, and a Risky trader's
losses can legitimately leave her behind a Safe one over a campaign. `RANK-TIME` holds the property
that matters: letting a trader go further can never make her choose a circuit worth less per day than
one she could already have had. On `372f8a5` it reports *"the trader chose a circuit worth 24 latinum
a day (149 days) when the Alpha Centauri shipment alone was worth 327 a day (9 days) and was still on
the board."*

## H. Recall and rendezvous

A trader can rationally have nowhere to go. Under Cautious, from a pocket whose neighbours are flagged
by powers hostile to the captain, she may fly to two worlds; if neither has work she holds, and the
setting, the planner and the captain's records are all doing exactly what they say. Measured: 1,626
days at Promelli Drift. The captain needs an order that moves her, and it has to be an order, not a
tuning of the setting.

**Recall** stops her trading and sends her to rendezvous with the captain: the system the captain is
in when the order is given, fixed at issuance. A captain who moves on is not pursued; the order still
names the system it named. **Rendezvous** sends her to any charted system the captain chooses,
whoever holds it. Both:

- keep her hold as it is — nothing is sold on the way, no shipment is taken on after the order; a
  circuit she was on is broken off where the leg she is flying ends, with what belongs at that call
  unloaded and nothing new loaded, and is not counted as a circuit worked;
- plot the route without asking her danger setting — the order is the captain's, and the captain can
  read what the route crosses (the log line says what the records call it) before giving it;
- are flown leg by leg on the same calendar as a trading run, each crossing rolled against the truth
  on the day she is there, each system recorded as she passes (source `fleet`, dated) by the same
  rule a trading run uses — the order overrides her tolerance, not the danger;
- leave her where she was stopped if a crossing disables her, with the order **unresolved** on her; she
  flies the rest from there once repaired;
- end in **holding, awaiting orders**, never in trading; the captain sends her back to work;
- survive a save: the leg, the destination, the cargo and the order;
- can be **changed** en route, replotted from the system she actually reaches next, or **cancelled**,
  which ends the passage at the end of the leg she is on.

The panel shows the destination and the day she arrives, and the controls: Recall to captain,
Rendezvous at system, Change rendezvous, Cancel. A formation dispatch no longer moves a trader who is
under way on a route of her own.

**The order has to reach her.** Relays are the command link for distant fleets, as they already are
for a formation dispatch. Every order to a fleet ship — recall, rendezvous, change, cancel, and Start
trading, Stop trading and the danger setting, which bypassed the rule before and were an older
inconsistency rather than a precedent — goes through one delivery: a ship in the captain's system, or
in a system a relay connects, takes it at once; otherwise it is queued in the campaign book beside the
formation orders, shown on her row and in the Empire panel's relay orders, and acknowledged when a link
reaches her — a relay, or the captain arriving where she is — against her actual position and state on
that day. A queued command follows the ship, not the system she was in. Commands are in domains —
passage (recall, rendezvous, cancel), trade-mode (start, stop), trade-risk (the setting) — and a newer
untransmitted command supersedes only an older one in its own domain; the domains coexist and are
delivered in the order they were given, and a command that can be delivered at once drops the stale
one of its domain still queued before it executes. A ship that is lost drops hers. Stop trading
controls autonomous trading only: a ship under a movement order keeps it, with its stage, transit
and ETA, and only trading is off. An order that reaches a ship that cannot fly — queued and finally
delivered, or given to her where she lies — has been received: it is hers, unresolved, and resumes
from her system after repair under the rule above. An unresolved order on a ship that was
stopped remains authoritative until completed or cancelled, and resumes on its own once she can fly.

**Recorded, not done:** the formation dispatch still moves a held fleet in one jump of
`Fleet.travelDays(route.distance)`; an existing fleet-movement debt, separate from §5.

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
| `DEAD-WORLD` | a world with no people and nothing that trades offering goods, demand or jobs — and, now, a defence platform or a relay on a bare rock creating an economy |
| `CIRCUIT-CONSERVE` | tons of undeliverable freight destroyed at the end of a circuit |
| `FAILED-CARGO-OWNER` | the shipper's freight sold at the next port that is buying, or not routed home, or paid for on return |
| `JOB-TURNOVER` | a shipment nobody takes holding its slot for the rest of the campaign |
| `JOB-ROLLBACK-AGE` | a shipment claimed by the planner and put back coming back without its date |
| `CAUTIOUS-STALE-FLAG` | a Cautious trader's plans changing the day a system is secretly taken, or a trader crossing a system and reporting nothing about who holds it |
| `RANK-TIME` | a wider permitted route set making a trader choose a circuit worth less per day than one still available to her |
| `RANK-LEG-TIME` | a circuit chosen by days reckoned from a route's distance rather than the rounded days of every leg she will fly |
| `RECALL` ×2 | a trader with nowhere her setting lets her go and no order that moves her; a recall that follows a captain who moved on |
| `RENDEZVOUS` | no order to a chosen system; a hold sold or a shipment taken on the way; days reckoned other than by the legs |
| `PASSAGE` ×6 | an order turning her round in warp or not breaking off her circuit; a passage made safe by the order, or a stopped ship's order dropped; a save losing the leg, the cargo or the order; a change plotted from her departure rather than where she is; a formation dispatch moving a trader off her route in one jump; a panel with no way to move her |
| `PASSAGE-RELAY` | an order reaching a ship beyond relay reach at once — Start trading, recall or rendezvous — or not being queued visibly, or a queued command not replaced by a newer one, not dropped for a lost ship, or acknowledged against the system it was given in rather than where she then is; a ship with the captain not taking an order at once |
| `COMMAND-DOMAINS` | a queued danger change deleting a queued recall or the reverse; a newer rendezvous not replacing a queued recall, or replacing the queued danger change with it; the two not both delivered when a link reaches her |
| `COMMAND-OVERTAKE` | a stale queued recall firing on the next tick over a rendezvous given the moment a link returned |
| `COMMAND-CROSS-DOMAIN` | a Stop trading delivered with a recall turning the passage into holding under a live transit and order, in either order of delivery, or putting her back to trading on arrival |
| `COMMAND-DISABLED-RECEIPT` | a queued recall that reaches a disabled ship being refused and lost, or moving her, or not flying from her system after repair |
| `CIRCUIT-FULL-OF-SHIPMENT` | a trader whose hold is full of a shipment still to be delivered repositioning to sell it instead of flying it |
| `CIRCUIT-IDLE` | a trader left standing at a world that will deal with her and has nothing for her to do |
| `CIRCUIT-FULL-HOLD` | a trader stopped for good by a hold full of cargo nobody nearby is buying |
| `JOB-FEE` | a shipment costing twice as much for twice the load, so the voyage is charged again on every ton |

Thirty-five checks are in the suite, covering those eight plus the circuit behaviour review asked for: two
traders cannot take the same tons or the same shipment; cargo stays addressed and comes off only at its
own call; freed hold goes back to work later in the circuit; and a reload resumes the route, the leg,
the manifest, the shelves and the books of work exactly. Intermediate danger and a stopped trader never
flying the rest of its route are already held by the leg-by-leg check from the previous round.

`DEAD-WORLD` fails on a tree that special-cases worlds by name, on one that ignores population, and on
one that counts any installation: the check builds a defence platform on an empty world and requires it
to stay dead, then a relay and requires the same, then a trade station and requires the world to come
alive with a shelf and a book of work.

`CIRCUIT-CONSERVE` loads a trader with forty tons of freight addressed to a port that refuses the
captain and nine tons of ordinary cargo, completes the circuit, and requires forty-nine tons still
aboard, the captain's purse unchanged, and the failed contract carried as goods with no address and no
cost basis.

`FAILED-CARGO-OWNER` ends a circuit at a refusing port with thirty tons of a shipper's freight aboard,
calls at a third world that is buying exactly that good, and requires the tons still aboard and the
purse unchanged; then requires the next plan to call at the shipper's world; then calls there and
requires an empty hold, an unchanged purse, and the return in the log. On `8ce4c4d` it reports the
freight sold at the third world for latinum.

`CIRCUIT-IDLE` empties a world's book and leaves the captain knowing no other world's prices, so there
is nothing to plan; the world itself still trades and still deals with the ship. It requires a plan
that is a **move**, with a route to fly and a note that says why she left. `CIRCUIT-FULL-HOLD` fills a
twenty-five-ton hull with cargo the world it is standing at has stopped buying, and requires a move to a
world that is buying that good.
