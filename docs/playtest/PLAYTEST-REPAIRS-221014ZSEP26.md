# BM1 playtest repairs on top of `ae4ae4d`

DTG 221014ZSEP26

Parent: `ae4ae4d` (Patch 1, DTG 171325ZSEP26) — untouched. Nothing pushed, merged or deployed.
The commit count is in `CANDIDATE.json`, computed by the pack script rather than typed here.

## Read this first

**This round is the one §5 repair review named before closing it, on top of `31f40bc`: remote fleet
commands respect the relay system.** The movement behaviour of recall and rendezvous is accepted and
untouched — fixed recall destination, any charted rendezvous, cargo retained, the current leg completed
before breaking off, leg-by-leg travel, actual danger, observations on passage, holding on arrival,
save and load, change and cancel, and the automatic continuation of an unresolved order after repair.
§4 and the economy are not touched.

1. **An order to a fleet ship has to reach her.** Relays are the command link for distant fleets and a
   formation dispatch already waits for one; the trade orders, and the passage orders built on their
   convention, bypassed it. `sendFleetCommand(id, command)` is now the only way an order is given, from
   the panel or anywhere else: **same system, immediate; remote and relay-connected, immediate; remote
   with no link, queued** in the campaign book beside the formation orders, through the same
   `queueDistantOrder` / `acknowledgeQueuedOrders` machinery, and shown on her row (*Queued: Recall to
   Earth · no relay link to Promelli Drift · day 740*) and in the Empire panel's relay orders.
2. **Acknowledged against where she then is.** A queued command is addressed to the ship, not to the
   system she was in: each day it is re-addressed to her actual position, and when a link reaches that
   position — a relay, or the captain arriving — it is executed against her state on that day: standing
   still, the passage begins there; on a leg, it takes effect where the leg ends. The calendar now
   acknowledges after the day's arrivals so a ship that arrived today is where she is.
3. **Change and Cancel use the same rule. A newer untransmitted command replaces the older queued one.
   A ship that is lost drops hers.**
4. **Start trading, Stop trading and the danger setting go the same way.** They were an older
   inconsistency, not a precedent, and leaving them was a second door around the relays.
5. **Automatic resume after repair is kept**: an unresolved order remains authoritative until it is
   completed or cancelled.

`PASSAGE-RELAY`: a ship two legs away with no link is sent Start trading, then a recall — neither
reaches her, both are queued, the recall in place of the start, and three days on she has not moved;
her row says so; a ship standing with the captain takes a rendezvous at once; a newer rendezvous
replaces the queued recall; a ship that is lost drops her queued order; she then goes about a standing
trade order she already had, the queued command follows her from system to system, and when the
captain comes to where she then is it is acknowledged and executed from there, not from where it was
given, and she arrives. On `31f40bc`: *"Start trading reached a ship at system 2 with no relay link at
once: the trade orders bypass the command link."* The nine §5 checks pass unchanged.

**Recorded, not done:** the formation dispatch still moves a held fleet in one jump of
`Fleet.travelDays(route.distance)`. It is an existing fleet-movement debt, separate from §5, and this
repair does not turn into a rewrite of it.

**§5 closes on this candidate.** §6 fleet repair UX is next.

---

## The round before it: §5 recall and rendezvous

**That round was §5 recall and rendezvous, on top of `e9be30b`, as its own candidate.** §4 is closed
and nothing in it is touched: the economy, the planner, the danger settings, the payout, the holds,
turnover and the risk bands are as `e9be30b` left them.

The case is the one the tables kept finding: a Cautious heavy freighter held 1,626 days at Promelli
Drift because every world her setting allowed had nothing for her, and the captain had no order that
moved her. Now the captain has two, and they are what review specified:

1. **Recall** stops her trading and sends her to rendezvous with the captain — to the system the
   captain is in **when the order is given**, and that system if the captain moves on. A fixed
   rendezvous, not a pursuit; moving interception is a harder problem and is not attempted.
2. **Rendezvous** sends her to any charted system the captain chooses, held by anyone or nobody.
3. **Her hold stays hers.** What is aboard rides with her; nothing is sold on the way and no shipment
   is taken on after the order. A circuit she was on is broken off where the leg she is flying ends:
   what belongs at that call comes off, nothing new goes on, and a circuit not finished is not counted.
4. **The order is not subject to her setting, and it is not immunity.** The route is plotted whatever
   Safe or Cautious would say of it; she flies it leg by leg on the same calendar, each crossing rolled
   against the truth on the day she is there, filing the same conditions record a trading run files. A
   Cautious trader ordered through Klingon space goes, and can be attacked.
5. **Stopped on the way, she stays where she was stopped and the order stays unresolved.** The panel
   says so; she flies the rest of it from there once she is repaired.
6. **Arrival is holding, awaiting orders** — not trading. Save and load resume the leg, the destination,
   the cargo and the order exactly.
7. **A changed rendezvous is replotted from where she actually is**, at the end of the leg she is on;
   **cancel** ends the passage at the end of that leg and she holds there.
8. **The panel** shows the destination and the day she arrives, with Recall, Rendezvous, Change and
   Cancel; it states and does not explain.

Nine checks, every one reproducing on `e9be30b` with a reason (*"there is no order that brings a
trader to the captain"*), and among them two things this round found and fixed: a formation dispatch
could put a trading member in one jump at the formation's destination while her circuit still had her
somewhere else (it is refused until she is stopped, held or recalled); and the conditions record a
trader filed carried no source, where the bridge's carries `local` — it is `fleet` now.

**One decision made beyond the list, named for review:** the order reached her the way every trade
order did — without a relay link. Review rejected that: the relay is the command link, and the trade
orders bypassing it was an older inconsistency, not a precedent. The round above brings every fleet
command under it.

**Measured**, the same two freighters on the same seeds with the captain sending one home after sixty
idle days: see `ECONOMY-MEASUREMENTS-221014ZSEP26.md`, last table.

---

## The round before it: the leg-time repair

**That round was the one final §4 repair review named, on top of `acffccf`, and nothing else.** The
stale-flag repair, the time-aware planner and the 150-day turnover are accepted and untouched; the
payout, the holds, courier pay, Cautious and the risk bands are as they were.

1. **The planner reckons a route by the days she will really fly.** Circuit planning estimated a
   route with `Fleet.travelDays(route.distance)` — one rounding of the whole distance — while the
   calendar charges `routeLegDays(route)`, every leg rounded up on its own. The two differ by a day
   per hop or so, always in the same direction, so a many-hopped route looked faster than it flew and
   could be chosen over a straighter one that really was faster. There is now one
   `fleetTradeRouteDays(route)`, the sum of `routeLegDays(route)`, and it is the only reckoning of
   journey time in fleet trading: circuit insertion and ranking, expected profit per day, the
   reposition's days and its test of whether a shipment pays for its own voyage, and the two ranking
   gates. Gate `RANK-LEG-TIME`; on `acffccf`: *"Lappa is 6 hops and really takes 134 days, not the
   131 a distance reckoning gives it, and at 39 latinum a day it is worse than Alpha Centauri at 40 —
   the planner is reckoning days from distance, not from the legs she will fly."*
2. **Nothing is retuned.** Turnover, payout, holds, Cautious and the risk bands are not touched. The
   tables are rerun because the planner's arithmetic changed, and they move only where it bit: Safe
   128,943 and Cautious 195,464 against 128,877 and 195,298 (short routes, where the two reckonings
   agree — the 1,350-ton freighter is 196,384 in both passes to the latinum); Risky 134,966 and Any
   145,282 against 137,925 and 167,364, the many-hopped hauls now costing what they cost. Every
   loose setting still earns at least what Safe does and Cautious is still the best earner. The
   boxed-in trader at Promelli Drift is identical to the latinum, because she has no route to
   reckon (`ECONOMY-MEASUREMENTS-221014ZSEP26.md`).
3. **One reckoning left as it is, on purpose.** `dispatchFleetFormation` still moves a formation to
   its station in `Fleet.travelDays(route.distance)` of the whole route, in one jump. That is not
   fleet trading and this repair does not touch it; it is the first thing §5 recall/rendezvous will
   meet, since a recalled trader must fly leg by leg through the same crossings a trading one does.

**§4 closes on this candidate.** The next round is §5 recall/rendezvous, as its own candidate: the
tables in `acffccf` showed a Cautious heavy freighter boxed in at Promelli Drift for 1,626 days with two
worlds she may fly to — rationally nowhere profitable or allowed to go — and the captain had no way to
order her anywhere else. That is the behaviour §5 has to solve.

---

## The round before it: the two repairs

**That round was the two repairs review named as the conditions for closing §4, on top of `372f8a5`.**
The 150-day turnover is approved and untouched; the payout, the holds, courier pay and the twelve-day
regeneration are as they were.

1. **Cautious means what review approved, and judges by what the captain knows.** The first build of
   the proposed rule read `getSystemFaction`, the live controller, and called it the flag on the chart
   — so a conquest nobody had seen changed a Cautious trader's plans the day it happened. Judgement now
   comes from `knownSystemController`: the last conditions record if there is one, otherwise the flag
   the system was charted with, never the live truth. A trader arriving anywhere files a conditions
   record of what she finds, controller included, so the next plan knows. `CAUTIOUS-STALE-FLAG`:
   record non-hostile → the Romulans take the system with nobody told → planning unchanged → she
   crosses it and the record now says Romulan, and a shipment there is no longer offered to her. With
   that holding, the four settings ship: Safe reported routes only; Cautious may cross charted,
   unreported space unless known information says hostile, war or a known operation; Risky known
   danger through its band; Any anything. `TRADE the danger setting decides where a trader is willing
   to go` is updated to that meaning and still requires Cautious to refuse a crossing charted under a
   flag that refuses the captain.
2. **The planner is time-aware.** `score = expected net / circuit days`, expected net being known
   shipment payouts plus known commodity margin less upkeep; a circuit is built one call at a time by
   incremental net per added day, and a call that would lower the circuit's rate is not made. Nothing
   is claimed or bought until the circuit is decided. No combat-loss pricing — the setting already
   says what the captain permits. `RANK-TIME`: on `372f8a5`, *"letting her go anywhere, the trader
   chose a circuit worth 24 latinum a day (149 days) when the Alpha Centauri shipment alone was worth
   327 a day (9 days) and was still on the board."*
3. **The same tables, rerun.** Heavy freighter, five thousand days: Safe 128,877, **Cautious
   195,298, Risky 137,925, Any 167,364** — where `372f8a5` read 132,630 / 142,498 / 66,794 / 65,070.
   The loose settings doubled and now sit above Safe, which is the property asked for. Every hull earns
   more per day (a Cautious cruiser 184,254 against 136,255; the five-ton hull 24,663 against 10,958).
   The boards still turn over (oldest posting 148 days). Two things the tables show and the repairs do
   not touch: a five-ton hull under Safe or Cautious waits a third to a half of its days for work that
   covers its own upkeep, and one of two heavy freighters on one economy sat 1,626 days in a pocket
   from which a Cautious trader may fly to two worlds. Both are the case for §5.

**Three things the tables exposed and this round fixed:** a hold full of a shipment still to be
delivered was treated as a hold full of unsold cargo (a five-ton hull with a five-ton courier lot
bounced between buyers of a cargo that was never for sale, 138 moves and no money between days 2,758
and 5,000 — gate `CIRCUIT a hold full of a shipment is a delivery to fly`); a reposition's reason had
to be a profitable one; and a reposition no longer counts as a circuit.

**§4 closes on this candidate**, if the tables read to review as they read here. §5 recall/rendezvous
is next, and the tables make the case for it twice over.

---

## The round before it: shipment turnover

**That round was shipment turnover, on top of `6a33345`, and the comparison review asked for before
the danger settings change.** The six items in `6a33345` are accepted and untouched: the payout, the
holds, courier pay and the twelve-day regeneration are as they were. **§4 is open pending the tables.**

1. **A shipment claimed by the planner and put back is as old as it was.** `rebuildWorldJob` rebuilt a
   shipment without its date, so an abandoned plan made an old posting new. The date now travels with
   the shipment onto the manifest and back. Gate `JOB-ROLLBACK-AGE`; on `6a33345`: *"job-0-3 was posted
   on day 50, claimed on day 100 and put back dated nothing at all."*
2. **An unaccepted shipment has a lifetime.** `jobLifetimeDays: 150` — named, to test, not locked.
   After it the shipment leaves the board without a word, its slot is free, and the twelve-day
   generation fills it in time. Accepted shipments are contracts and are not touched. Nobody is paid
   and nothing is reported. Gate `JOB-TURNOVER`; on `6a33345`: *"an unaccepted shipment has no
   lifetime: it waits on the board for the rest of the campaign."*
3. **The same instrumentation, rerun** — occupancy, age, deliverable share, every rejection reason,
   shipments delivered, last delivery — at 300, 1,000 and 3,000 days for both hulls and all four
   settings. **The board turns over now**: the oldest posting on any board at any horizon is 146 days,
   where it was 2,999; under Cautious the heavy freighter's last shipment lands on day 2,799 of 3,000
   rather than day 365, with thirty delivered against six; the five-ton hull delivers couriers under
   Safe and Cautious where it delivered none. Shipment income is a live third of a trader's earnings
   again — a Cautious cruiser makes 136,255 over five thousand days against 100,369, with 63,383 of it
   shipments against a frozen 11,922. That is the consequence of unfreezing the boards, not a tuning,
   and it is what the 150-day number should be weighed against.
4. **Cautious is still confined, so the comparison is here.** The shipped rules are untouched and the
   game uses them. Beside them is a measurement-only reading of the four settings, selected by a
   playtest flag the script sets and nothing else, in which Cautious may cross charted, unreported
   space whose flag is not hostile and against which no known operation is under way. The same hull on
   the same seeds under both readings: the proposed Cautious earns 170,399 against 142,498 over five
   thousand days, delivers 80 shipments against 45, opens 31 worlds' books against 11 — and is crippled
   on a crossing nine times against five, which is the uncertainty being real. Every shipment it still
   refuses is on a system flagged by a power hostile to or at war with the captain. Safe, Risky and Any
   are identical under both readings.

**One thing turnover exposed, reported and not fixed:** with live boards the loose settings now earn
*less* than the tight ones — Risky 66,794 and Any 65,070 against Safe 132,630 and Cautious 142,498 —
because a Risky trader takes long hauls whose price does not pay for their days, and the planner ranks
a shipment by price over hold rather than over time. A ranking question for a later round.

**Nothing else changed.** If turnover reads cleanly to review, §4 closes on this candidate and §5
recall/rendezvous is next.

---

## The round before it: the six items

**That round was the six items review raised against `8ce4c4d`, and nothing else.** The economy is not
redesigned and the payout is not touched. The base is `8ce4c4d`. **§4 is open pending your reading of
the tables**; if nothing new is in them, this is the candidate to close it on.

1. **Failed-contract cargo is the shipper's**, not the captain's stock. It becomes a *return* entry
   addressed back to the world it came from, goes home ahead of new work, is handed back for nothing,
   and is never sold — however much the next port is paying. Gate `FAILED-CARGO-OWNER`; on `8ce4c4d`
   it reports *"New Switzerland is buying Corpses, and the trader sold the shipper's 30 tons of it
   there for 30 latinum."*
2. **The books of work are instrumented, not changed.** Regeneration stays at one shipment per world
   per twelve days. At 300, 1,000 and 3,000 days, for each danger setting and for two hulls, the
   measurements now report how many worlds' books have been opened, how full they are, how old what is
   on them is, and the first reason the trader would pass each open shipment over. The answer to "why
   does shipment work dry up" is in `ECONOMY-MEASUREMENTS-221014ZSEP26.md` §2, and it is not regeneration.
3. **The payout stands** at a route and hazard fee once plus twenty latinum a ton, for playtesting.
4. **The five-ton starter hull is in the danger-setting table** alongside the heavy freighter, with the
   shipments it actually delivered, before anyone decides whether courier fees need scaling.
5. **The Concord is 1,320 tons** as an authored civilian/commercial exception — the heavy-cargo tier
   for a battleship-class hull, recorded in both data files with the 10,000 it shipped with and the 308
   it was briefly cut to. The other thirteen reductions and every existing freight exception stand.
6. **The stale sentence is gone.** `CARGO-CAPACITY-221014ZSEP26.md` no longer says no ship data changed; it
   says which thirteen are at the derived default and which one is an authored exception.

**One thing not on the list**, found by item 4 and fixed: a reposition to a world with nothing at the
other end. The five-ton hull at Any risk made 192 circuits that moved no money, bouncing toward work
it could not hold. A move now needs a reason, and work counts only if it fits the hull.

**The headline finding.** Shipment work does not dry up because of regeneration — the books are
92–100% full at every horizon. Under Safe and Cautious, **93–97% of what is on them is on a route the
captain has no condition report for**, which those settings do not fly; deliverable work is 0% from day
1,000 and the last shipment lands on day 365–385. Under Risky and Any 93–94% is deliverable and the
limit is transit time. Nothing in the economy itself moved this round. If that is what review needed
to see, §4 can close on this candidate.

---

## Command delivery, in detail

### 1. One way in

```
sendFleetCommand(id, { command, destination?, risk? })
  command ∈ recall · rendezvous · cancel · trade-start · trade-stop · trade-risk
  reachable(f) = fleetShipSystem(f) === state.currentPlanet || isSystemRelayConnected(fleetShipSystem(f))
  reachable → executeFleetCommand(f, order)          (orderFleetPassage / cancelFleetPassage /
                                                       startFleetTrading / stopFleetTrading / setFleetTradeRisk)
  otherwise → replace any queued command for f, then
              Campaign.queueDistantOrder(book, { order: 'fleet', fleetId, systemIndex, label, ...order }, day, false)
```

`fleetShipSystem` is where she is — the captain's system for an escort, otherwise her `systemIndex`,
which on a leg is the system she left. That is the same position a formation dispatch tests. The
panel's six controls and the two formation trade buttons call nothing else; the functions
`executeFleetCommand` dispatches to are what an acknowledged order does, and the gates that test
movement call them as such.

### 2. The queue

`acknowledgeCampaignOrders`, run by the calendar after `completeFleetJourneys` and before
`advanceFleetTrading`, first re-addresses every queued fleet command to its ship's current position and
drops those whose ship is gone, then acknowledges every queued order whose system is in relay coverage
**or is the captain's own** — the same test `isSystemRelayConnected` applies when an order is given, and
which the dispatch queue was not applying — and executes each acknowledged fleet command against the
ship as she is: standing still, at once; on a leg, pending, taking effect where the leg ends. The
Empire panel's *Relay orders* names a queued fleet command as *Recall to Earth for Trader 2 at Promelli
Drift queued — no relay link*; her own row carries the same line.

### 3. What it does not change

Nothing in how a passage is flown, broken off, resumed, changed or cancelled; nothing in the economy or
the planner. The formation dispatch keeps its own relay check and its one-jump move. The measurement
harness's captain gives her rendezvous as acknowledged and does not fly to her; the table records
whether a link would have reached her where she stood.

### Gates

`PASSAGE-RELAY` is new and reproduces on `31f40bc`; on a tree with no passage orders it reports that
there is no order that brings a trader to the captain. The nine §5 checks are unchanged and pass. The
suite is 76 playtest reproductions.

---

## Recall and rendezvous, in detail

### 1. The order

`orderFleetRecall(id)` is `orderFleetPassage(id, state.currentPlanet, 'recall')`;
`orderFleetRendezvous(id, to)` is the same with a chosen system. The destination must be on the chart
and reachable by a plotted route from where she is; a disabled or destroyed ship is refused. Nothing
else is consulted — not her danger setting, not who holds the destination, not standing. The order is
written on her trade state as `t.order = { kind, to, from, day, pending, wasActive, arrivedDay }`, a
fact about the ship that a save carries; `ensureFleetTradeState` normalises it, and a stage of
`passage` with no order falls back to holding.

Standing still, the passage begins at once. On a leg — a trade leg or a passage leg — she cannot turn
round in warp: the order is `pending`, `t.active` is false so the call at the leg's end takes nothing
new aboard, and at that end `beginFleetTradePassage` runs from the system she has reached.

### 2. The passage

`beginFleetTradePassage(f, t, from, day)`: if she was on a circuit, `completeFleetTradeCircuit(f, t,
abandoned = true)` closes its books the usual way — what was sold is expensed, what is aboard keeps its
cost and loses its address, a shipment to a port that refuses her becomes the shipper's freight going
home — without counting a circuit worked. Then the plotted route from `from` becomes `t.path`, its
`routeLegDays` become `t.legDays`, `t.stops` is empty, `t.stage` is `passage`, and
`scheduleFleetTradeLeg` books the first hop exactly as a trade circuit does. Her actor leaves the
captain's system if that is where she was.

`advanceFleetTradePassage` at every leg's end is `crossFleetTradeSystem` — the system is recorded
(`fleetTradeObserve`, source `fleet`) and rolled (`resolveFleetTradeLegRisk`) — then the next hop, or
`arriveFleetTradePassage`: holding, not trading, `t.order.arrivedDay` set, one log line. A change of
order that reached her on a leg is replotted here, from the system reached.

`crossFleetTradeSystem` on a disabling hit already parks her where it happened and cancels the hops
beyond; now it also leaves the order on her, `pending`, with `from` set to that system, and appends
*"… unresolved"* to her note. Each day `advanceFleetTrading` sees a pending order on a ship that cannot
fly and holds; the day her condition is operational again, the passage resumes from where she lies. A
ship that is lost has no order.

`cancelFleetPassage`: under way, the passage ends at the end of the leg she is on (`t.path` is cut
there, the order becomes `kind: 'hold'`); not yet under way, the order is withdrawn and a circuit she
was on continues as it was, active if it was active.

`startFleetTrading` refuses a ship under orders and clears a completed order when she goes back to
work. `dispatchFleetFormation` refuses a formation with a member on a circuit or a passage.

### 3. What was not done

The formation dispatch still moves a formation in one jump of `Fleet.travelDays(route.distance)`. It
is not a trader's order and this round does not change it; it now refuses to include a trader under
way, which is the defect §5 exposed in it. Moving interception of a captain who has moved on is not
attempted. Evacuation and blockade are as unfinished as before.

### Gates

| check | on `e9be30b` |
| --- | --- |
| `RECALL a trader with nowhere to go can be ordered to the captain, whatever her setting allows` | *there is no order that brings a trader to the captain* |
| `RECALL is to where the captain was when the order was given, not to wherever the captain goes` | same |
| `RENDEZVOUS a trader can be sent to a chosen charted system the captain does not hold, keeping her hold` | *there is no order that sends a trader to a chosen system* |
| `PASSAGE an order given on a leg takes effect where the leg ends, and the circuit is broken off there` | same |
| `PASSAGE the order is not immunity: a passage through danger is rolled, a stopped ship stays stopped, the order stays unresolved` | same |
| `PASSAGE save and reload resume the leg, the destination, the cargo and the order` | *there is no order to save* |
| `PASSAGE a changed rendezvous is replotted from where she is, and a cancelled one ends where the leg ends` | *there is no rendezvous to change or cancel* |
| `PASSAGE a formation dispatch cannot pull a trader off her own route` | *the formation was dispatched to 2 with a trader on a leg to 1: she is now booked to 2 in one jump while her circuit still has her on the way to 1* |
| `PASSAGE the fleet manager offers recall, rendezvous, change and cancel, and shows destination and day` | *the fleet manager offers no way to recall or send a trader anywhere* |

The first builds the Promelli Drift shape deliberately: a Safe trader two legs from the captain, the
route home made unreported so her setting refuses it, the books cleared so the planner holds — and
requires the order to send her anyway, on the plotted route, arriving on the day the legs add to,
holding and awaiting orders, every system on the way carrying her `fleet` record. The fifth flies
forty ships with 14% hull through a pirate-held first system on different days until one is stopped,
and requires her at that system, the order still on her and unresolved, and the passage resumed from
there the day after she is repaired. The seventh plots the changed route from the system she reaches
and requires it to be that route, not the one from her departure.

---

## The leg-time repair, in detail

### 1. Two reckonings of the same route

A plotted route is a list of legs. When a trader flies it, `scheduleFleetTradeLeg` charges each leg
`Math.max(1, Fleet.travelDays(legDistance))` — that is `routeLegDays(route)` — so a route of six legs
costs six roundings-up. When the planner *estimated* the same route it asked
`Fleet.travelDays(route.distance)` once, of the total. The estimate is never more than the flight and
usually less, and the shortfall grows with the number of hops. So a shipment across a many-hopped route
was priced per day against fewer days than she would spend, and could outrank a shipment on a short
route that really earned more per day flown.

### 2. One reckoning

```js
function fleetTradeRouteDays(route) {
  const legs = routeLegDays(route);
  return legs.length ? legs.reduce((n, d) => n + d, 0) : (route ? 1 : null);
}
```

It is read in four places and nowhere else reasons about a trader's journey time:

- `planFleetTradeCircuit` — the memoised leg-days between two worlds that `insertion` uses to cost
  adding a call, and so the circuit's `days`, `expected` and `rate`;
- `planFleetTradeReposition` — the days of a candidate move;
- `planFleetTradeReposition` — whether a shipment at the candidate world pays more than the upkeep
  of carrying it to its destination, which is what makes it a reason to go;
- the ranking gates: `RANK-TIME` now measures near and far in flown days on a tree that has the
  function (and the way the tree reckons on one that does not), and `RANK-LEG-TIME` below.

The rounding in `routeLegDays` is unchanged; a route with no legs is a day, as it was.

### 3. `RANK-LEG-TIME`

The check walks the worlds a trader at the home world may deliver to and, for each, computes the days
the route really flies (sum of `routeLegDays`) and the days a distance reckoning gives it. It picks
world A, the nearest whose two reckonings agree, and world B, the one whose flight exceeds its
reckoning by the most (at least two days). It posts two ten-ton shipments at home: A's pays
`(40 + upkeep) × A.flown`, so it is worth 40 latinum a day net however you reckon it; B's pays
`(40 + upkeep) × (B.reckoned + B.flown) / 2`, which is worth *more* than 40 a day by the distance
reckoning and *less* than 40 a day by the days she will fly. The check requires that separation as a
precondition, then plans under Any and requires the circuit to include A and not B, and the plan's
expected rate to equal A's real rate. A planner that reckons from distance takes B — on `acffccf`, Lappa
at six hops, "134 days, not the 131 a distance reckoning gives it".

### Gates

`RANK-LEG-TIME` is new and reproduces on `acffccf`; on a tree with no circuit planner it reports that
there is no circuit to plan, never a `TypeError`. `RANK-TIME`
is unchanged in what it requires; its near/far selection now uses the same reckoning as the planner
where the tree has one, and it still reproduces on `372f8a5` (the same 24 against 327 latinum a day,
now over 150 flown days rather than 149 reckoned). The suite is 66 playtest reproductions; the
candidate reproduces none, `acffccf` fails exactly `RANK-LEG-TIME`.

---

## The two repairs, in detail

### 1. The stale flag

`unreportedSystemDoubt` asked `getSystemFaction(i)` — the live controller — whether an unreported
system's flag was hostile, while describing that as the flag the captain had on the chart. It now asks
`knownSystemController(i)`: the `controller` on the system's last conditions record if one exists (a
record is written whenever the captain's bridge, a fleet ship or a relay reads the system), otherwise
`getSystemControl(i).origin`, the authored flag the chart carried when the campaign began. A system
that is unreported has no record by definition, so in practice the charted flag decides — and a
conquest that nobody has observed cannot reach it.

What the trader finds is now recorded. `crossFleetTradeSystem` calls `fleetTradeObserve` at every
leg's end, which files the same conditions record the captain's own bridge files, through a
`readLiveConditions` extracted from `systemConditions` so the two cannot drift. That record carries the
controller she found. The chart's survey status is not touched. Prices are still not recorded until
the port deals with her.

The measurement seam from the previous round — `TRADE_RISK_RULES_PROPOSED` and the playtest flag — is
gone; `TRADE_RISK_RULES.cautious.acceptUnreported` is `'charted-quiet'` and there is one set of rules.

`CAUTIOUS-STALE-FLAG` finds a Cautious-acceptable route crossing a charted system nobody has reported
on, records what the captain believes it flies, overrides its live controller to Romulan (who refuse
the captain) with no observation, and requires the captain's belief, the trader's doubt and the
route's acceptability all unchanged; then has her cross it and requires the record to say Romulan and a
shipment to that system to be withdrawn from her. On `372f8a5` the proposed rule is behind a flag, so
the check reports that a Cautious trader never crosses unreported space at all.

### 2. The time-aware planner

`planFleetTradeCircuit` from step 1 onward is replaced. It evaluates without committing: for every
world she may go to, `valueOf(to, room, purse)` says what a call would load (shipments whole or not at
all, then lots at known prices, with shelf supply shared across candidates), and `insertion(order,
to)` says where the call fits best and how many days it adds. Calls the cargo aboard obliges her to
make go in first. Then the greedy loop adds the call with the highest resulting circuit rate, and stops
when the best remaining call would lower it or four calls are in. Only then are shipments taken and
lots bought; the plan carries `days`, `expected` and `rate`.

`RANK-TIME` posts two shipments at the home world — 50 tons to the nearest world, reported quiet, and
a one-ton courier to the farthest, across unreported space — plans under Safe (only the near one is
reachable), then under Any, and requires the Any circuit's known rate per day to be no worse than the
Safe one's while the near shipment is still on the board.

### 3. Three things the new planner's tables exposed, fixed in the same pass

**A hold full of a shipment was treated as a hold full of cargo nobody had bought.** The planner's
"hold full" dead end came before the calls the cargo aboard obliges her to make were read, so a
five-ton hull with a five-ton courier lot aboard was sent to find a buyer for a cargo that was never
for sale, sold nothing, and was sent again — 138 moves and no money between days 2,758 and 5,000. A
full hold is now a dead end only when nothing in it has somewhere to go; a shipment aboard is a circuit
waiting to be flown. A shipment aboard whose destination the captain's record says refuses her is
converted to the shipper's freight going home at planning time, the same conversion the end of a
circuit makes. Gate `CIRCUIT a hold full of a shipment is a delivery to fly, not cargo to get rid of`;
on `372f8a5` the trader repositions.

**A reposition's reason had to be a profitable one.** The reposition counted as "work" any fitting,
deliverable shipment; a courier lot that would not pay for its own voyage was reason enough to go, and
the time-aware planner then rightly refused it on arrival. Work now counts only if it pays more than
the upkeep of carrying it there, and the cargo a reposition looks for a buyer of is only cargo that is
actually for sale.

**A reposition is no longer counted as a circuit**, which had been making a bouncing trader look busy.

### 1. Age survives the rollback

The planner claims shipments off a world's book as it plans and puts them back when it abandons the
plan or drops a call. `rebuildWorldJob` wrote a fresh `createdAt` and no `createdDay`, so the restored
shipment had no age; with a lifetime in force that would have let any abandoned plan renew a posting
indefinitely, which is why review asked for it first. The manifest entry now carries `createdDay` when
a shipment is taken (both the planner's take and the freed-hold refill at a call), and the rollback
restores it. The captain's own decline path already put the original object back and was never
affected.

`JOB-ROLLBACK-AGE` posts a world's shipments on day 50, has the planner claim them on day 100, puts the
claimed entries back the way the planner does, and requires each to be dated day 50.

### 2. Turnover

`worldJobPool` now does three things before it generates: it dates any posting that has no date (a
save from before dates existed) with today, so it gets a whole lifetime from here; it strikes off every
posting older than `TRADE_ECONOMY.jobLifetimeDays`; and only then computes how many generations the
twelve-day clock owes and fills up to the world's capacity. Expiry is lazy — it happens when the book is
read, the same way shelves replenish — so a world nobody visits carries stale entries in the save
until somebody looks, and what they see when they look is the turned-over board. Nothing is logged and
nothing is paid. A shipment on a manifest or in the captain's contracts is not in the pool and is not
touched.

`JOB-TURNOVER` fills a world's book with shipments a one-ton hull can never carry, moves the calendar
thirty days past the lifetime, and requires every one of them gone, the book no larger than its
capacity, at least one genuinely new shipment posted with a new date, and the replacements not the
same unsuitable lots back again. It also requires the lifetime to be a named number between 120 and
180.

### 3. The comparison, and how it is wired

`TRADE_RISK_RULES` is unchanged and is what the game uses. `TRADE_RISK_RULES_PROPOSED` differs in one
line — Cautious accepts an unreported system when `unreportedSystemQuiet` says the captain has no
reason to doubt it: on the chart, flag not hostile to or at war with the captain, no known operation
against it. `fleetTradeRouteAcceptable` reads whichever set `state.playtest.tradeRuleSet` names, and
only the measurement script ever names the proposed one. No panel, no setting and no save reads it.
The crossing itself is unchanged: an unreported quiet system is still rolled against what is really
there on the day.

`unreportedSystemDoubt` also says *why* a system is not quiet, so the books table can report, for the
proposed Cautious, whether it was `uncharted`, `hostile-flag` or `known-operation` that kept a shipment
off the route.

### Gates

Two new checks, **62 in the playtest gate**. Both reproduce on `6a33345`; nothing else reproduces
there. No check was weakened and no baseline raises a `TypeError`.

(The round on top of this one takes the gate to 65: `CAUTIOUS-STALE-FLAG`, `RANK-TIME` and `CIRCUIT a
hold full of a shipment is a delivery to fly`, plus `TRADE the danger setting decides where a trader is
willing to go` updated to the approved Cautious meaning.)

---

## The six items, in detail

Raised against `8ce4c4d`, which stays the base. Changes are in `src/main.js`, the two ship data files,
`scripts/playtest-gate.cjs` and `scripts/economy-measure.cjs`.

### 1. Freight from a failed contract is the shipper's

A shipment addressed to a port that refused the ship became, at the end of the circuit, the captain's
own unaddressed cargo — carried at no cost and sold at the next world that was buying. That was the
open question in the previous round's design document, and review answered it: **the goods belong to
the employer.**

The entry is now a **`return`** on the manifest: the same tonnage, addressed back to the world the
shipment came from (`from` is recorded on every shipment when it is taken; an older manifest still
names its origin in the shipment id, `job-<origin>-<n>`), carrying the shipper's name, worth nothing.
Three rules follow, and each is what the trader does rather than what a note says:

- **Home first.** Return cargo aboard decides the first calls of the next circuit, ahead of new work.
  A trader with nothing else to do repositions to the shipper's world ahead of any world that buys or
  has work. Standing at the shipper's world at planning time — after a reload — hands it back before
  anything is planned.
- **For nothing.** At the shipper's world the tons come off, the purse does not move, and the log says
  *"returned N tons of undelivered freight to <shipper>; nothing owed."*
- **Never sold.** At any other world the entry stays aboard, whatever that world is paying. The panel
  line reads *"30 t Corpses → Earth (returning to Earth, nothing owed)"*.

`FAILED-CARGO-OWNER` ends a circuit at a refusing port with thirty tons of a shipper's freight aboard,
calls at a third world that is buying exactly that good, and requires the tons still aboard and the
purse unchanged; then requires the next plan to call at the shipper's world; then calls there and
requires an empty hold, an unchanged purse and the return in the log. On `8ce4c4d`: *"New Switzerland
is buying Corpses, and the trader sold the shipper's 30 tons of it there for 30 latinum: a failed
delivery became the captain's free merchandise."* `CIRCUIT a failed delivery loses the contract, not
the cargo` is updated to require the failed entry to be a return rather than unaddressed goods; its
conservation assertions are unchanged.

**Not built, on purpose:** any claim, fine, standing penalty or deadline on the return. A failed
contract costs the fee and the trip and nothing more until review says otherwise. If the shipper's own
world will not deal with the ship either, the freight stays aboard, and that is a hold the captain has
to solve by repairing standing.

### 2. The books of work are instrumented, not changed

Regeneration stays at one shipment per world per twelve days. What changed is that the measurements
can now say **why** a trader passes work over. At every horizon, for each danger setting and for both
the heavy freighter and the five-ton starter hull, the script reads every world whose book has been
opened — without opening any that have not — and records how full the books are, how old the open
shipments are (each shipment is now stamped with the campaign day it was generated), and the first
reason the trader standing on that world would pass each one over: `danger`, `unreported`, `no-route`,
`refusal`, `too-big` for the hull, or `no-room` in the hold as it is.

The answer is in `ECONOMY-MEASUREMENTS-221014ZSEP26.md` §2, and it is not regeneration. **The books are
92–100% full at every horizon and every setting.** Under Safe and Cautious the trader opens eight of
ninety worlds' books and **93–97% of what is on them is `unreported`** — the route crosses a system the
captain has no condition report for, which those settings do not fly — so deliverable work goes from
4% at day 300 to **0% from day 1,000**, and the last shipment is delivered on day 418 (Safe) or 345
(Cautious). Under Risky and Any 93–94% of open work is deliverable and the limit is transit time. For
the five-ton hull, 65–80% of open work is `too-big` and the rest `no-room`, because its hold is always
full of the last commodity lot.

### 3. The payout stands

A route and hazard fee paid once plus twenty latinum a ton, exactly as `8ce4c4d` left it. Not tuned.

### 4. The five-ton hull in the danger-setting table

Alongside the heavy freighter, at all four settings, with a column for the shipments it actually
delivered. It delivers none under Safe or Cautious at five thousand days and a handful under Risky and
Any — the courier lots it takes when its hold happens to be empty and one is on the board.

**One thing the table turned up, and one fix for it.** The five-ton hull at Any risk completed 192
circuits between days 1,136 and 5,000 and moved no money at all. A reposition whose destination has
nothing for her — no buyer, no work she could take, not the shipper's world — was a move for its own
sake, and repeated it became a trader bouncing between ports and counting circuits. The reposition now
counts as work only a shipment **her hull can hold**, and with no reason to go anywhere she holds where
she is and the panel says why. `CIRCUIT-IDLE` and `CIRCUIT-FULL-HOLD` still pass, because both give
her a reason.

### 5. The Concord is 1,320 tons

An authored civilian/commercial exception on review, in both data files, with `cargoReview` carrying
the ruling, the 10,000 it shipped with and the 308 it was briefly cut to. The heavy-cargo tier for a
battleship-class hull from the same table that judged every other hull; second largest hold in the
game behind the Isaac. Its text says so again: *"Its large commercial hold and long reach outweigh its
slower response."* The other thirteen reductions and every existing freight exception stand.

### 6. The stale sentence

`CARGO-CAPACITY-221014ZSEP26.md` said *"No ship data is changed in this candidate, as asked."* It now says
which thirteen hulls are at the derived default, which one is an authored exception, and that the
per-hull CSV is how an individual call gets overruled — which is exactly what happened with the
Concord.

### Gates

One new check, **60 in the playtest gate**. `FAILED-CARGO-OWNER` reproduces on `8ce4c4d` with the
message quoted above; nothing else reproduces there. `CIRCUIT a failed delivery loses the contract,
not the cargo` is updated for the return entry (its conservation assertions are unchanged) and still
reproduces on `4008e24`. No check was weakened and no baseline raises a `TypeError`.

---

## The round before it: the five pre-tuning repairs

**That round was the five repairs review asked for before the economy is tuned**, on top of `4008e24`.
**§4 is still open** until review reads the tables below. Nothing else was touched: the danger settings
are exactly as they were, the authorized cloak bypass stays, Tactical Cube plan and capture content
stays deferred, Gorn services and recovery stay behind the authored discovery requirement, and
evacuation and blockade remain explicitly unfinished.

Five items, in the order they were given:

1. **Refused shipment conservation — fixed, with a gate.** A shipment to a port that would not deal with
   the ship was struck off the manifest when the circuit ended and its tons ceased to exist: a full hold
   could empty itself by failing. The contract is lost and the goods stay aboard as ordinary cargo.
2. **Empty-world economies tightened.** "Population zero plus any installation" now reads the same
   resolved capabilities the docking port and the campaign read, and asks whether the site actually does
   economic, commercial or logistics work. Twenty-seven of thirty-six station roles do; nine do not. A
   defence platform or a relay on a bare rock no longer runs a market. It also closes a case nobody had
   noticed: **the Gorn world was trading off two stations that are dormant behind their authored
   discovery event**, and it no longer does.
3. **Contract payout rebuilt as a route and hazard fee paid once plus twenty latinum a ton**, and the
   300/1000/3000/5000-day tables rerun against it. The old formula charged the whole voyage again on
   every ton, so a 98-ton shipment paid 58,800 latinum — more than a Steamrunner costs.
4. **The danger settings are not tuned**, as instructed. The measurements still repair ships for free, so
   the four columns are reported for continuity and are explicitly not a net-profit comparison.
5. **The fourteen oversized warship holds are cut and nothing else is.** Every authored freight
   exception stands, the Isaac included, at 3,500 tons. The nine small holds keep what they shipped
   with; instead, every third shipment on a world's book is a one-to-five-ton courier lot, so the work
   comes down to the small hull. The design document is reconciled with the capacity table: the Isaac is
   3,500, in both, and the figure 840 appears nowhere.

Plus two planner stalls the measurements turned up, and two corrections to the measuring script — all
four described below, none of them on the list, none of them avoidable if the tables were to mean
anything.

**Two things were not on the list and are in here anyway, because the measurements could not be
produced without them.** Running the 5,000-day tables turned up **two permanent stalls in the trade
planner**: a trader standing at a world that deals with her but has nothing she can do was told "No
plottable route to those destinations" and left there for 4,342 of 5,000 days, and a trader whose hold
was full of cargo nobody nearby was buying could not plan, so never went anywhere, so nobody ever bought
it. Both are pre-existing on `4008e24`, both are gated, and both had to be fixed before any table meant
anything: the Any-risk column was reporting the day a ship stopped rather than what the payout does.
The measurements document also records a fault in the measuring instrument — "maintained" was not
actually repairing the trader — and corrects it.

**One thing needs a decision and one needs a second look.** Selling undelivered freight at a later port
is a disposal mechanic arrived at by default rather than by design (`ECONOMY-DESIGN-221014ZSEP26.md`, §E). And
the **Concord-class Grand Cruiser** is the only one of the fourteen whose other authored fields —
`marketRole: civilian`, an art note calling it a civilian megaship, and the previous balance review's own
"commercial role" — argue for its hold; the derivation never saw them because none of it is description
text. It is reduced to 308 as approved, and `CARGO-CAPACITY-221014ZSEP26.md` names 1,320 as the figure that
would follow if review would rather treat it as an authored exception.

**The headline numbers.** Like for like at a thousand days, one maintained trader on Cautious: net
**239,054 → 27,462** latinum, shipment income **223,760 → 11,922**, commodity income roughly unchanged
at **29,313 → 26,405**. The economy is now commodity-led. Payback runs 4,400 to 9,300 days against 357
to 752 before. The full tables, and four things worth asking about, are in
`ECONOMY-MEASUREMENTS-221014ZSEP26.md`.

---

## The five repairs, in detail

Raised against `4008e24`, which stays the base. Every change is in `src/main.js`, the two ship data
files, and `scripts/playtest-gate.cjs`; nothing else in the engine was touched.

### 1. A failed delivery loses the contract, not the cargo

`completeFleetTradeCircuit` filtered undeliverable shipments out of the manifest and dropped them. The
tons were simply gone. A trader that failed a delivery came home lighter than she left, which is the
opposite of what failing means.

Now the entry is **converted** rather than dropped: it becomes an ordinary `goods` line with the same
tonnage, no address and no cost basis, and the log says so — *"…will not take her cargo. The contract
is lost; the cargo is still aboard."* The contract pays nothing, and because the converted entry
carries `paid: 0` it does not distort the circuit's profit either.

`CIRCUIT a failed delivery loses the contract, not the cargo` loads forty tons of refused freight and
nine tons of ordinary cargo into a circuit and requires forty-nine tons to come out of it, the purse
unchanged, and the failed contract carried as goods with no address. On `4008e24` it reports *"49 tons
went into the circuit and 9 came out: 40 tons of undeliverable freight were destroyed by the end of the
circuit."*

**This needs a decision (see `ECONOMY-DESIGN-221014ZSEP26.md` §E).** Unaddressed cargo is sold wherever
somebody is buying, so the goods do eventually turn into money for a captain who was never entitled to
them. The alternative — tons that stay aboard and unsellable until an explicit claim, fine or discounted
salvage mechanic exists — quietly fills a hold with dead weight and stops the ship, so this candidate
takes the first and says so rather than deciding it silently.

### 2. An installation only makes an economy if it does economic work

`worldInstallationCount` counted **any** surviving station definition in the system. The new
`economicInstallationTally` resolves each definition through `StationRoles.resolveStationCapabilities`
— the same resolver the docking port and the campaign use — and counts it only if the resolved site
keeps a commodity board, carries passengers, sells hulls, earns revenue, clears freight through customs,
mines, farms or houses anyone. Nothing is named. Twenty-seven of the thirty-six authored roles qualify;
nine do not: defence platforms, advanced defence platforms, subspace comms, communication arrays,
wormhole generators, research labs, research stations, universities and command outposts.

Because the resolver is doing the work, **status counts too**: destroyed, unbuilt, abandoned and dormant
sites contribute nothing. That closes a case nobody had raised. **Gorn** has two Trade Stations and zero
population, and they are dormant behind the authored Gorn discovery event — so the world was running a
commodity market and handing out freight contracts off installations that have no services at all. It
no longer does, and it will start when the discovery event does, which is what the standing instruction
about Gorn services asks for. **Kardon**, whose only site is a wormhole generator, drops out for the
same reason.

Across the map, 86 of 270 surviving installations stop counting and 31 inhabited worlds lose at least
one; Earth goes from eighteen to nine. Resolving every definition is not free, so the per-system tally
is cached against a fingerprint of the roster, the campaign records the resolver reads and the day —
the fingerprint is a running sum over the station type ids, so swapping one kind of site for another is
not mistaken for no change.

`ECON an empty world trades only where something there does economic work` builds a defence platform on
an empty rock and requires it to stay dead, then a relay and requires the same, then a trade station and
requires the world to come alive with both a shelf and a book of work. On `4008e24` it reports *"a
defence platform was built on the empty rock at Denmark and the world now runs a market with 59 tons on
the shelf and 2 shipments waiting: a gun is not a trading post."*

### 3. The voyage is paid for once, and the tonnage by the ton

```
was:  payPerTon = 150 + min(350, distance x 3) + (20 asteroids | 30 nebula | 100 wartime)   x every ton
now:  fee       = 200 + min(2500, distance x 1.5) + (150 asteroids | 250 nebula | 800 wartime)  once
      plus        20 latinum per ton
```

Two things were wrong with the old formula. It **saturated**: the distance term capped at 117 route
units, and the shortest route on this map is 66 while the median is 640, so every shipment beyond the
next system over paid the same flat rate — the reason the measured band was a nearly uniform 416 to 620
latinum a ton. And it **charged the voyage again on every ton**: `job-0-1` on `4008e24` is 98 tons and
pays 58,800 latinum, which is more than a Steamrunner costs.

A shipment's price is now computed in one place (`jobPay`), and what a trader compares when choosing
between two of them is that price over the hold the shipment occupies (`jobPayPerHoldTon`) rather than a
flat rate. The contract record carries `fee` alongside `payPerTon`, `getContractTotal` is
`fee + payPerTon x tons`, and a contract saved before the fee existed has none — so an old save settles
for exactly what it always did. The captain's offer sheet reads *"920 for the run (250 hazard) + 20L/t"*
and the contract lists show the whole price rather than a rate.

`JOB the voyage is paid for once, and the tonnage by the ton` reads every open shipment on the map, asks
what each would pay at twice the load, and requires none of them to cost twice as much; it also requires
the worth of a ton of hold to vary by at least fourfold across a real board. On `4008e24` it reports
*"61 of 61 shipments cost twice as much for twice the load."*

**This is a first measurement pass, not a locked number.** The five constants are named in
`TRADE_ECONOMY`; the tables are in `ECONOMY-MEASUREMENTS-221014ZSEP26.md`.

### 4. The danger settings are not tuned

As instructed. The four columns are still reported for continuity, and the measurements document says
in the table itself that they repair ships for free and are therefore not a net-profit comparison.
Re-evaluating them needs real repair cost and downtime, which is §6.

### 5. Fourteen holds cut, nine left alone, and courier work instead

The fourteen challenged holds are reduced in **both** `data/starship_manifest.json` and
`bm-ships/ships.json` — the catalogue overlays the manifest at load, so changing one alone would have
left the game reading the old number. Each changed hull keeps its old figure as
`cargoReview.previousCargoCapacity`. Six of the fourteen carried description text that restated the
number (*"offering substantial freight capacity"*, and the Concord's *"immense cargo capacity"*); that
text is now false, so it was rewritten to say only what is still true. No other authored text was
touched, and no authored freight exception moved: Isaac 3,500, Delpin 1,600, Tarellian and Ferengi
1,500, Dominion Freighter 1,350.

The nine small holds keep what they shipped with. Rather than enlarging them, **every third shipment on
a world's book is a courier lot of one to five tons** (`courierEvery`, `courierTonsLow`,
`courierTonsHigh` in `TRADE_ECONOMY`) — 33 of the 136 shipments open across the map, so a five-ton hull
is no longer offered nothing anywhere.

**It does not change what a tiny hull earns, and the measurements say so rather than hiding it.** The
five-ton starter ship makes exactly what it made on `4008e24` — 850 latinum over a thousand days, all of
it commodity trading. What stops it is the **danger model**, not the size of the work: of the 64
shipments of five tons or less open on the map, one is on a route a Cautious trader will fly. The work
is now there for it to take; reaching it is the danger settings' problem, which is §6's.

`CARGO-CAPACITY-221014ZSEP26.md` is the table, reissued as applied rather than proposed, and it names the one
hull worth a second look — the **Concord**, whose `marketRole: civilian`, art note and previous balance
rationale all say commercial, none of which is description text and none of which the derivation saw.

### 6. Two permanent stalls in the planner, found by the measurements

Neither was asked for. Both had to be fixed, because the tables review asked for were reporting the day
a ship stopped rather than what the payout does.

**A world that deals with her and has nothing for her to do.** If no shipment on the board is one she
may deliver and no commodity lot is worth buying, the planner had no stops, reported *"No plottable
route to those destinations"* — which was not true, and was not the reason — and returned nothing. The
trader stood there. Measured at Any risk: income frozen from day 649, **4,342 idle days out of 5,000**.

**A hold full of cargo nobody nearby is buying.** With no room, the planner returned *"hold is full of
cargo nobody has bought"* and did nothing, so the ship never went anywhere, so nobody ever bought it.
Measured on the five-ton hull: frozen from day 443, idle for nine tenths of the campaign.

Both are the same situation as the refusing port that `4008e24` already handles, so they get the same
answer. **Every dead end in the planner now moves her on** rather than returning nothing, and the
reposition chooses by what actually frees her: a world that is **buying what is already in her hold**
first, then one with **work she could take**, and only then the nearest port. Two of those dead ends
also had to start **unwinding** what steps 1 and 2 had already committed — claimed shipments go back on
the world's book and bought cargo is refunded and put back on its shelf — or a planner that decided not
to go destroyed the work and the tons on its way out.

The effect on the tables is the whole difference between a measurement and an accident: **idle time is
now 0% for every hull at every horizon and for all four danger settings**, where the same runs before
the fix read 12%, 26%, 45% and 87%.

### Gates

Five new checks, **59 in the playtest gate**. All five reproduce on `4008e24` with behavioural messages,
and nothing else reproduces there. Five existing checks needed repair for reasons that are this round's
doing and are worth stating rather than burying:

- `TRADE a fleet ship ordered to trade buys, carries and sells on its own` ran for sixty days. A leg
  across this map runs to sixty-odd days on its own, and with the shipment sort now preferring value
  density the circuit it plans reaches its first call around day seventy-five. The window is 150 days;
  the assertions are unchanged.
- `TRADE the hold a ship actually has limits what it carries and earns` compared the median-capacity
  hull against the largest. With the economy tightened, a world's book no longer holds enough work to
  fill even the median hull, so both loaded the same and the check could not see the hold. It now names
  the small ship it wants — the smallest hull with at least twenty-five tons — so the hold is the
  binding constraint rather than the supply of work.
- `CIRCUIT cargo stays addressed…` and `CIRCUIT freed hold goes back to work…` both called at
  `stops[0]`. The new sort changed which world that is, and it landed on a Romulan port that refuses the
  captain — where, by design, nothing unloads and nothing is picked up. Both now call at the first stop
  that will actually deal with the ship; refusal is `TRADE-4`'s business.
- `TRADE a trader plans on prices the captain has read…` collapsed the price of one good at the
  destination and expected a loss. The circuit now carries more than one lot to that world, and the
  others paid for the failure. It collapses every good the manifest is carrying there.

Two probes outside the playtest gate read the old payout directly and were repaired the same way.
`captains-briefing-probe` asserted that every freight quote carried at least 150 latinum a ton, which
is now the fee's job; it reads the whole price instead. `briefing-cargo-probe` built its fixture by
spreading a live offer and overriding the tonnage and the rate, so the live offer's route fee came
along and the expected figure counted only the tonnage; the fixture now names `fee: 0` and pays exactly
what it says. Neither check is about pricing and neither assertion was weakened.

A trader being routed to a port that turns her away is **not** a new fault: deliverability is judged on
the controller the captain has *recorded*, so a world nobody has looked at is a world whose politics the
captain finds out about on arrival. That is the intended design from `75389f7`, and the reposition from
`4008e24` — extended here — is what keeps her from being stuck there.

One check needed a second pass of its own. `JOB the voyage is paid for once…` read a world's book of
work, which trees older than `4008e24` do not have, so on the older baselines it fell over with a
`TypeError` instead of saying what was wrong. It now reads whatever the tree quotes — the book where
there is one, the freight offers where there is not — and reproduces behaviourally on every baseline:
*"60 of 60 shipments cost twice as much for twice the load."* No baseline in this pack raises a
`TypeError`.

One note on running the baseline: the `LAYOUT` check measures rendered geometry at 1366px and it fails
on **any** tree, base or candidate, when the machine is busy enough to slow layout. The baseline run
quoted here was made with nothing else running, and on it exactly the five new checks reproduce and
nothing else does.

---

## The round before it: the economy

**This round is the economy**, on top of `54cd501`. **§4 is still open.** Finite commodity supply and
demand, finite sized cargo work, multi-stop circuits, and uninhabited worlds derived from population
and installations — all built. Cargo capacities are a table rather than a change, and **nothing has
been tuned**, both as asked.

Four things before the detail. **Contract pay is the whole economy** — 416 to 620 latinum a ton, eight
times what commodity trading contributes. **The hold is not what limits a trader**: a 220-ton cruiser
and a 3,500-ton freighter earn the same over a thousand days. **Risk is worth four times cargo
capacity.** And **a trader could strand itself for ever** at a port that refused it; that is fixed here.

The round before it, leg-by-leg traversal, is on top of `75389f7`. It is the first
section below; "Fleet trading" beneath it is the round that built it, and everything under that is the
record of the rounds before, newest first, unchanged.

Four things need saying before the detail. **A Safe trader could be routed through a system its own
records call dangerous**, because only the destination was examined — fixed, with a gate. **A trader
turned away at a port came home with its prices** — fixed, with a gate. **The pack's cover sheets
shipped describing the previous round**; the duplicated narrative is gone and the pack now refuses to
build when its stamps disagree with what is being packed. And the economy question is **costed rather
than tuned**: `ECONOMY-DESIGN-221014ZSEP26.md`, nothing implemented.

The foreign-market specification is amended twice, and one of those amendments reorders the work:
**persistent strategic vessel identity is now a prerequisite** before any offscreen operation may
produce a prize, which leaves two of its three shelves unshippable until it exists.

Sixth round, on top of `7767631`, from nine items raised off laptop playtest screenshots, plus the
three findings raised against `43938a7` and the four goals raised against `2316331`, all closed here. **All nine items are done**: the trade overlay, which was
half of what was asked in the sixth round, is completed by the seventh round's first goal. Three things in here were not asked for and need saying out
loud before the list:

**Two of this round's own fixes were wrong on first writing, and the screenshots caught them.** The
chart's objective route was drawn in the same blue the chart already uses for travel routes, so it was
invisible exactly where it mattered; and the marker labels were written beside the node, where the
chart already writes the system's own name, so they collided. Both were found by diffing a
layer-on/layer-off screenshot pair rather than by the gate, which had been counting the chart's own
dashed lines and crediting them to the overlay. The gate now counts only strokes in the overlay's own
colour, and carries a negative control that turns the layer off and requires the count to fall to zero.

**Giving 31 worlds a government closed nine shipyards, and one of them had been closed before this
round.** The engine already trims a world's hand-written hull lot to that government's own designs
plus neutral ones — Earth sells 2 of its 6, Andoria 1 of its 7 — which is fine as a shaping rule and
was never a closing one while these worlds had no government. It is now. Where the rule would empty an
authored lot the lot stands as written. What the captain can actually buy, measured against `7767631`:
**29 hull offers lost, 21 gained; 8 weapon offers lost, 13 gained**; the losses are foreign hulls at
worlds that now have a flag and the gains are those worlds' own designs. No system sells nothing.

**Two worlds the allegiance table got wrong, reverted.** Pirates Haven was recorded as independent on
the phrase "we pirates" — its text warns of "the rotting corpses of the poor traders caught in our
little haven" — which made it neutral and stopped it being hostile. Rigel's text says both "Rigel is an
independent planet" and "The Andorians however lay claim to this world and are quite willing to protect
it", and the engine has no protectorate level to express that, so nothing was authored and the shipped
table's `andorian` stands. That second one is **a gap, not a decision**.

## The economy round

Raised against `54cd501`, which stays the base. **§4 is still open**: the economy is built, the
measurements are in, and the cargo capacities are a table rather than a change, as asked.

### 1. Commodities are finite and visible

A board now carries a quantity: `Medical supplies — 82 t available · buying 66 t`. Buying takes it
away, selling fills a finite appetite, and both come back over campaign time at a rate derived from the
world's population, market strength and installations — `clamp(score × 6, 10, 220)` tons a good, back
in about twenty days.

**One economy.** `takeMarketSupply` and `fillMarketDemand` are the only two places stock moves, and the
captain's market screen and every fleet trader go through them. A trader that empties a shelf empties
it for the captain, and the captain can do the same to their own traders. Replenishment is caught up
lazily from the day a shelf was last touched, so a world nobody has visited for a hundred days is full
when somebody arrives and one emptied yesterday is still empty — no per-day sweep over a hundred and
one worlds.

Prices keep drifting ±2 a day and selling does not move them. The quantity is the whole of the
scarcity, because that is the part a player can read — which is what review asked for instead of the
slippage curve.

### 2. Cargo work is finite, sized, and does not reroll

A world keeps a book of open shipments, bounded by the same capability score — about two at a small
world, four to six at a major one — each with explicit tonnage drawn from what that world can move, and
each regenerating one at a time every twelve days rather than on demand. Taking one removes it.

The offer the captain is shown is **one of the world's own shipments that fits what is left of their
hold**, not a shipment invented to fit it. Asking again at the same system cycles the same board.
Standing at one system can no longer fill an arbitrarily large hold.

### 3. Multi-stop circuits

A trader plans a **circuit of two to four calls**: shipments first, best rate first, taken whole or not
at all; then commodity lots in whatever room is left, for a call whose prices the captain has actually
read. Cargo is addressed, comes off only at its own call, and space freed by a delivery goes straight
back to work on anything waiting at that world bound for a call still ahead.

A **shipment** needs a route the danger setting accepts and a port that will take her — it does not
need the captain to have read that world's prices. **Commodities** need the prices. Requiring market
knowledge for both turned most of every world's book into work no trader would touch, which is what
the first build did.

Every leg still uses the leg-by-leg danger from `54cd501`, and a stopped trader still stops where it
was stopped with the rest of the circuit cancelled.

### 4. Uninhabited worlds

No population and no surviving installation means no market, no appetite and no work — nine worlds on
the current map. Derived from the world, so an outpost built on an empty rock starts trading on its own
account, and the gate proves it by building one. That closes the open §3.5 item.

### 5. Two things the build turned up

**A trader could strand itself for ever.** A circuit ending at a world that refuses the captain left
her unable to plan, and she sat there for the rest of the campaign — the risk settings showed it as
*zero circuits and 98% idle from day 113*. Being turned away at a call is now a failed call: cargo
addressed there stays aboard, the rest of the circuit goes ahead, and a trader with nowhere to work
moves to the nearest port that will deal with her. That is not recall; §5 is still where the captain
says where a ship should go.

**Planning commits.** Choosing a circuit claims shipments and buys cargo in the same breath. That is
how two traders cannot take the same shipment, and it means a planner call is not a query.

### 6. The measurements, at 300, 1,000, 3,000 and 5,000 days

`ECONOMY-MEASUREMENTS-221014ZSEP26.md`, driven through the engine rather than modelled, with **nothing
tuned**. The four findings that matter:

- **Contract pay is the economy.** 416–620 latinum a ton. A cruiser books 223,760 of shipments against
  29,313 of commodities over a thousand days. If later builds made too much money, this is the number.
- **The hold is not what limits a trader.** At a thousand days a 220-ton cruiser, a 1,350-ton freighter
  and a 3,500-ton freighter all make about 239,000. Utilisation 73%, 12%, 6%.
- **Risk is worth four times cargo capacity.** At five thousand days Safe makes 284,063 and Any makes
  1,154,013 — not because danger pays, but because the looser settings reach more of the map.
- **Without repair a trader is finished by about day 1,089.** The maintained figures assume the captain
  repairs her, which is §6.

Competition behaves: one heavy freighter makes 330,550 over five thousand days, two make 174,635 each,
four make 108,824 each and idle 38% of the time.

### 7. Cargo capacity — a table, not a change

`CARGO-CAPACITY-221014ZSEP26.md`. **No ship data is changed.**

Defaults from `shipClass` and the authored `role`; a hull keeps what it shipped with unless its hold is
below the default (raised, so it can take a shipment at all) or more than six times it — and then the
authored text decides. The care went into what counts as the author meaning it: *"offering substantial
freight capacity"* appears verbatim on a bulk freighter, a Cardassian supercapital and a Borg cube, so
phrases that restate the number are stripped before the text is read.

| Hull | Shipped | What the text says | Outcome |
| --- | --- | --- | --- |
| Concord-class Grand Cruiser | 10,000 t | boilerplate, on a mass-6 battleship | challenged → 308 t |
| Delpin Luxury Liner | 1,600 t | "a **spacious** … **passenger liner**" | kept |
| Tholian Isaac Freighter | 3,500 t | role: "**bulk** interstellar freighter" | kept |

At the recommended threshold: **149 hulls untouched, 14 challenged, 9 raised, 2 kept as authored
exceptions**. The threshold is shown as a dial, and the per-hull CSV carries every description so an
individual call can be overruled without moving it.

### 8. Two gates changed, and one retired

`intelligence` carried a check that a hold with one ton free is offered a one-ton contract. That was
the old behaviour — a contract invented to fit whoever was asking. It now asserts the opposite, which
is the stronger claim: a sliver of hold is offered **nothing**, because a shipment has its own size,
and an empty hold is offered one of the world's own.

`fleet-trade-fixtures.cjs` is **retired**. It drove the single-run trader through `planFleetTradeRun`,
which no longer exists, and everything it covered is now either a gate — stale markets, access refusal,
hold limits, persistence — or in `economy-measure.cjs`, which covers risk levels, profit and loss and
competition at four horizons instead of one. The suite is 37 gates.

### 9. Eleven new checks

The playtest gate goes 44 → 55. All eleven reproduce behaviourally on `54cd501`, with no `TypeError`s.

| Check | Reproduces |
| --- | --- |
| `ECON a world sells what it has, and it comes back over time` | an infinite tap, a shelf that never moves, or one that refills instantly |
| `ECON the captain and their traders buy out of the same hold` | a trader with stock of its own |
| `ECON a world only buys what it wants` | a world absorbing any tonnage at its posted price |
| `ECON a world with no people and no installation has no economy` | an empty rock running a market — and a rule that reads names rather than installations |
| `JOB a shipment has a size, and a hold has to have room for it` | a contract invented to fit whoever is asking |
| `JOB a world has only so much work, and taking it does not make more` | rerolling a full hold at one system |
| `JOB several shipments ride in one freighter` | a trader that carries one thing at a time |
| `CIRCUIT two traders cannot take the same tons or the same shipment` | two traders drawing on nothing |
| `CIRCUIT cargo stays addressed, and comes off only at its own call` | one undifferentiated load delivered wherever the ship stops |
| `CIRCUIT freed hold goes back to work later in the circuit` | space freed by a delivery sitting empty |
| `CIRCUIT a reload resumes the route, the manifest and the economy` | a save that comes back with the route, the load and the shelves reset |

## Leg-by-leg traversal, and the economy papers

Raised against `75389f7`. **The only code change is the traversal fix.** Everything else in this round
is documents: the cargo-capacity proposal, the finite-economy design, the seeded measurements, the
strategic-identity round scope, and an amended foreign-market specification. §4 stays open.

### 1. A trader crosses its route leg by leg

The route was persisted and every system on it was checked, but the ship flew the **whole** travel
timer before any of those checks resolved. It was never anywhere in particular on the way, so an
encounter on the first leg was decided on the arrival day at the far end, and the legs beyond it were
rolled anyway.

Now one hop is scheduled at a time. At departure the planner records the path **and each leg's
duration**; the ship is put in transit to the first system only. The calendar moves it there, and on
the day it arrives that system is rolled against **the truth on that day**. If it survives, the next
hop is scheduled from where it now is. If it does not:

- it stops **at that system**, and `systemIndex` says so, which is what repair, recovery and — when
  §5 arrives — recall will read;
- the remaining travel is cancelled, because no further hop was ever booked;
- the systems beyond it are never crossed and never rolled.

`t.crossed` records the systems a trip actually crossed. A ship stopped on the second leg has two
entries and never acquires a third, which is the only way to see from outside that the later legs did
not happen.

The encounter seed moved with it. It used to include the projected arrival at the far end, which
changed every time a leg was flown — that would have reshuffled the odds of systems the ship had
already passed. It is now the trip and the day the ship is actually there.

**`TRADE a trader crosses its route leg by leg, and stops where it is stopped`** flies already-damaged
freighters through a pirate-held first leg until one is stopped, then asserts where it stopped, that
nothing is still booked, which systems it crossed, and — the assertion that names the defect — the day
it stopped. On `75389f7`: *"she was stopped on a 11-day first leg, but it took until day 22 of a
22-day journey to find out"*. The playtest gate goes 43 → 44.

### 2. Cargo capacity, proposed across the whole roster

`CARGO-CAPACITY-221014ZSEP26.md`, and `scripts/cargo-capacity-proposal.cjs` which derives it.
**No ship data is changed.**

A hull's hold comes from two things the catalogue already records and neither is its name: `shipClass`
for the size band, and the authored `role` for whether it is a cargo hull and whether it is a heavy
one. Within a class-and-tier bucket the ordering the roster already expresses is preserved, so a bucket
does not collapse to one number.

The 10,000-ton **mass-6** Concord-class becomes **308 t** — a warship with a hold. The 3,500-ton bulk
freighter becomes **840 t** and stays the largest hold in the game. Roster total falls from 112,955 t
to 25,616 t. Two corrections found while deriving it: a **liner carries passengers, not freight**, and
the heavy multiplier has to outweigh class or a capital-class cargo hull beats a dedicated freighter.

### 3. The economy design, rewritten to what was asked for

`ECONOMY-DESIGN-221014ZSEP26.md`, superseding the price-slippage proposal, which is deleted. Simple
visible scarcity instead: a world's board carries a **quantity** — `Medical supplies — 82 t available
@ 7 L/t` — consumed by buying and replenished over campaign time; finite demand in the other direction;
cargo jobs with explicit tonnage and a limited number open at once, so standing at one system cannot
reroll a full hold; and **one economy**, with the captain and every fleet trader drawing on the same
numbers. Uninhabited worlds are derived from population and installations, not named, which closes
§3.5.

### 4. The measurements, and the finding in them

`ECONOMY-MEASUREMENTS-221014ZSEP26.md`, from `scripts/economy-measure.cjs`, run against the real map.

Small worlds carry about 50 tons of a commodity and keep two jobs open; major worlds 110–220 and four
to six. Nine worlds have no economy at all. Four heavy freighters working the same map make 11,298
latinum each over 300 days against 16,772 for one alone — finite supply and demand doing their job.

**And a finding that needs a decision before the economy round starts: under this model a heavy
freighter is worse than an ordinary one.** It costs twice as much, earns less, and its hold sits 11%
full, because no single destination absorbs eight hundred tons. Making worlds bigger does not fix it.
Letting a trader work **several worlds in one circuit** does — −40% becomes +21%, and +40% with both.
So multi-stop circuits are not a nicety; without them the heavy freighter tier has no reason to exist
and the capacity proposal's top end is decoration.

The first calibration attempt is worth recording: reading the authored population figures at face
value — they run to 50,000 — swamped market strength and installations and put every world on the
ceiling, producing exactly the "2 contracts everywhere" outcome the measurements were asked to avoid.
They are read per thousand.

### 5. Strategic vessel identity, scoped as its own round

`STRATEGIC-VESSEL-IDENTITY-191921ZSEP26.md`. Nine fields that must persist, three invariants — two
ships of a class stay distinguishable, a strategic → tactical → strategic round trip does not
regenerate the vessel, legacy saves migrate deterministically — the five places it touches, and six
gates. It is a strategic-layer feature that foreign markets happen to need.

### 6. The foreign-market specification, amended again

Every approval stands. Three amendments now: the producer requires **disabled and taken/captured**,
never disabled alone; persistent strategic identity is a prerequisite; and that prerequisite is **its
own round**, scheduled before this one rather than being a step inside it. Until it lands an offscreen
operation must produce **nothing**, not a plausible-looking record.

## Fleet-trading repairs

Raised against `5d32b7c`, which stays the base. §4 is **not closed**.

### 1. Danger is the danger on the route, not at the far end

The risk test stopped at the destination, so a Safe trader could be routed straight through a system
its own records call dangerous as long as the world at the end looked quiet. Planning now takes the
**worst** planned risk band over every system on the plotted route, and a route with an unreported
system on it is refused by Safe and Cautious the same way an unreported destination is. Passing through
is not docking, so a government that refuses the captain is still only consulted at the destination.

The run is flown rather than teleported: every system on the path gets its own seeded roll against its
own truth, in the order the ship passes through them. The path is recorded at departure and persisted,
so a run is rolled against the route it actually flew even if the chart changes while it is out there.
A ship crippled part-way stops **where it happened** — `systemIndex` is set to that system rather than
to a destination she never reached, which is what repair and recovery need to be true.

`TRADE the danger on a run is the danger on the whole route` builds the case out of existing readings:
a destination the records call band 0 and that is quiet in fact, reached through a system those same
records already call dangerous. On `5d32b7c` it fails with *"a Safe trader will run to system 15 through
system 16, which its own records put at band 2"*, and 60 runs through a pirate-held system arrive
unmarked.

### 2. A port that turns a freighter away teaches it nothing

`completeFleetTradeSale` recorded the board and *then* checked whether the port would deal with the
captain, so a trader turned away at the dock came home with that week's prices and planned its next run
on them. The same order was wrong in the planner. Access is now established first, and the board is
read only once the port has agreed to deal — on arrival, after the refusal check and immediately before
the sale.

On `5d32b7c`: *"andorian turned the freighter away at system 10 and she came home with that week's
prices"*.

The captain's own market screen is unchanged. A board the captain can see is knowledge they actually
have, and the refusal still stops them trading on it — and stops a trader being sent there at all.

### 3. The pack's cover sheets stopped going stale

`README.template.md` was 482 lines carrying a hand-written round narrative, a hardcoded DTG and a
hardcoded base; `manifest.py` was 46KB of the same. Both shipped in the last pack describing the round
*before* it — `191546ZSEP26`, base `7767631` — beside counts and checksums that were correct, because
the numbers were computed and the prose beside them was not.

The prose is gone rather than corrected. It duplicated the change document, which is in the pack and is
rewritten every round; one telling is enough.

- **`CANDIDATE.json` records only what is computed**: commits and tree from git, the gate list and exit
  codes read from `gate-exit-codes.txt`, the playtest gate's totals and per-baseline reproduction counts
  read from the logs themselves, and `new_this_round` **derived** as the checks that still reproduce on
  `base_this_round` and pass on the candidate. It cannot describe a different round than the one packed.
- **`README.md` is a short cover sheet** filled from the same values, and `finalize.sh` refuses to write
  one that still carries a placeholder or any DTG but this round's.
- **`make-pack.sh` takes `BASE` as an argument** and refuses when it is not an ancestor of HEAD, when
  the change document does not exist, when its filename does not carry this round's DTG, when it is not
  stamped `DTG <this round>` at the top, or when `CANDIDATE.json`'s DTG, base or document name disagree
  with what is being packed.

### 4. The two gates

Both reproduce behaviourally on `5d32b7c` with no `TypeError`. The playtest gate goes 41 → 43.

| Check | Reproduces |
| --- | --- |
| `TRADE the danger on a run is the danger on the whole route` | only the destination is examined, so a Safe run is routed through a system the records call dangerous, and every ship arrives unmarked |
| `TRADE a port that turns a freighter away teaches it nothing` | a refused trader comes home with that port's prices, and a trader standing at a refusing port reads its board anyway |

### 5. The economy, costed rather than tuned

`ECONOMY-DESIGN-221014ZSEP26.md`. **Nothing implemented.** The short version: the fleet trader
did not break the economy, it was the first thing able to execute at a scale the market model never
priced. A world's board has no depth — 10,000 tons of one good clears at the same unit price as one
ton. Upkeep is charged on mass while profit is earned on cargo capacity, and the largest hold in the
game (10,000 tons) sits on a **mass-6** hull paying below-median upkeep. The cheapest route to the
problem is a **180,000-latinum** freighter with a 3,500-ton hold.

Four options are costed; the recommendation is **market depth**: a world absorbs `market * 25` tons of
a good at the posted price and moves one latinum against you per further block, symmetric on buying.
At market 11 that leaves a 110-ton run untouched, takes 8% off a 650-ton run, and turns a 10,000-ton
dump from 90,000 latinum into 19,900 — a loss against its own purchase. The captain's own 220-ton ship
is unaffected.

### 6. The foreign-market spec, amended twice

Two amendments, and the second reorders the work.

**The prize producer requires disabled *and* taken.** "A campaign operation whose target ends
`disabled`" was a producer on its own, which would have turned every derelict left floating after a
strategic engagement into stock — including hulls their own side recovered and hulls nobody went back
for. One predicate now requires the hull intact, possession changed, and the record naming who took it.

**Persistent strategic vessel identity is a prerequisite.** Decision 4 says a prize preserves the actual
vessel's identity and state. The engine has that primitive for *tactical* hulls. A **strategic** hull is
created as `{ id, shipId, hull, maxHull, crew, systemIndex, status, opId }` — no `name`, no `seed`, no
`vessel` snapshot. So an offscreen operation has nothing to make a prize out of, and any prize it
produced would have its identity invented at the moment of sale: the licence the whole specification
was written to avoid, wearing a name badge.

Until that exists, the only producer is a boarding capture by the captain. Which means **Hirogen Range's
shelf is empty and Pirates Haven's is one generic hull** — shipping either now ships an empty shop or an
inventing one. Suliban Helix is unaffected: it sells from the catalogue and never touches a prize. The
implementation order now puts Suliban Helix at step 5, the identity work at step 6, and the two prize
markets behind it, with a `PRIZE-INVENTED` check that requires a producer without persistent identity
to produce **nothing** rather than something plausible.

That work is not small — hull creation, strategic engagement resolution, hull pruning, and what a
campaign save contains — and it is arguably a strategic-layer feature that foreign markets happen to
need rather than a foreign-market feature.

## Fleet trading

Raised against `8b7d9b0`, which is closed. §4 only, plus the minimum it needs. **Recall and
rendezvous are deliberately not in here**; that is §5.

A fleet ship can be set to trade at a danger setting — Safe, Cautious, Risky or Any — from its row in
the Fleet panel, or for a whole formation at once. It buys where it stands, carries the cargo to a
world it remembers paying more, sells at whatever that world is actually paying when it arrives, and
starts the next run from there.

### What a trader is allowed to know

This is the part that decides whether any of the rest means anything, and it is where the round spent
its effort.

`getPlanetMarket()` creates a world's board the first time anything asks for it, and
`updatePlanetMarketVariance()` then drifts every board that exists by up to ±2 a day. A route planner
that called it would do two wrong things at once: price runs off markets the captain has never looked
at, and start prices moving on worlds nobody has ever visited. So planning reads a new record instead —
`state.marketLog[system] = { day, offers }`, written only where the captain can actually read a board,
which is the existing `commodityTradeBlock()` rule: close on the world or dock somewhere that trades.
Arriving in a system is not that, and does not record prices.

Danger is read the same way. A live threat reading is used where one exists; otherwise the captain's
last observation of **who was watching the place** decides, which is the same inference the live model
makes — a lane worth robbing that nobody is watching — read off a dated record. Protection and traffic
are carried forward by the observation record and the week's fighting deliberately is not, which is
exactly why a route can read quiet on paper and not be.

And the destination's **government** is read from the record too. A world that has changed hands since
the last look is still a candidate; the trader finds out when it gets there and is turned away, and the
captain reads that in a report. Testing the live controller would have quietly deleted the route
instead, which is the planner knowing something the captain does not.

The leg itself is rolled against the truth. `TRADE a route that looked quiet is flown against what is
actually there` builds that case: a destination the records call band 0, handed to pirates, still
chosen by a **Safe** trader, and 120 seeded legs into it produce attacks.

### The money

One debit when the cargo is bought, one credit when it is sold. The cargo lives on the fleet record and
never enters `state.cargoArray`, so it cannot be sold a second time from the market screen — the gate
asserts the captain's own hold is empty after a run. Upkeep goes on accruing through the travel days
exactly as before, through `Fleet.recordBill`, so travel time is paid for and nothing is billed twice.
The personal-ship exemption is untouched.

### Attacked, damaged, disabled, lost

One seeded roll per leg against the destination's true threat, relieved by its true protection. How
hard the hit lands follows how bad the place is: a quiet lane scratches the paint, a system with a
battle in it can leave a freighter adrift in one pass. A catastrophic hit on a healthy ship **disables**
rather than destroys her; only a hit on a ship already disabled finishes her. Without that rule the
disabled band is a tenth of the hull and a heavy bite steps straight over it, so a state the rest of the
game is built around — boarding, recovery, repair — never occurred out here at all.

A disabled or destroyed trader stops. So does one turned away at a port, one with nothing profitable to
run, and one the captain stops by hand.

### What it says and what it does not

Attacks, losses, exceptional profit and inability to continue are reported. Ordinary buys and sales are
not: they are in the panel. A trader's row carries its state, its cargo, its destination, its ETA, this
trip's expected profit or the last trip's realised one, and its cumulative total.

### Also fixed, unasked

**A new campaign inherited the previous one's market boards.** `state.planetMarkets` was saved and
loaded but never cleared on a new game, so a world the new captain had never seen already had a price
history drifting behind it. Found by the gate that checks a trader plans only on what has been read.

**A trader will not spend the captain's last 500 latinum.** Nobody asked for this. Without it a pair of
autonomous ships can empty the account between one repair and the next, which is not a trade-off the
captain ever chose. It is one constant, `TRADE_PURSE_RESERVE`.

### One thing that needs a decision, with numbers

**Fleet trading as specified prints money, and the fixtures show how much.** Over 180 days, one
Concord-class Grand Cruiser turned 100,000 latinum into 740,000 at Safe and 680,000 at Any. The cause
is in the data rather than in this round: a world's board prices goods at 1–20 latinum a ton, the
captain's own market screen trades **one ton at a time**, and that hull's hold is **10,000 tons**. The
margin is per ton, so a fleet trader makes ten thousand times what the captain makes by hand, and it
compounds every eleven days.

Nothing here was tuned to hide that, because tuning it is a design decision rather than an
implementation one. The smallest levers, neither of them taken: the purse reserve is already a single
constant, and a per-run ton cap would be a second. The full table is
`validation/fleet-trade-fixtures.json` and `validation/fleet-trade.log`.

The same fixtures show the danger setting doing its job — 14 destinations at Safe, 16 at Cautious, 17
at Risky and Any, and after 180 days the Safe trader is at 100% hull, the Risky one at 74% and the Any
one at 63%. In this seed all four settings picked the *same* run, because the most profitable route
available happened to be one Safe would take; the setting cost nothing here and the hull damage is what
separated them.

### Seeded fixtures

`scripts/fleet-trade-fixtures.cjs`, run as a gate, covering each danger setting, cargo-capacity scaling
across five hulls, stale-market decisions at five price outcomes including a realised loss, access
refusal across five standings, profit and loss over 180 days at each setting, and save/reload mid-run.
Same seed, same table.

### Seven adversarial checks

All seven reproduce on `8b7d9b0` with behavioural messages and no `TypeError`s. The playtest gate goes
34 → 41.

| Check | Reproduces |
| --- | --- |
| `TRADE a fleet ship ordered to trade buys, carries and sells on its own` | the order does nothing; the ship never leaves and the purse never moves; the cargo sits in the captain's hold |
| `TRADE the hold a ship actually has limits what it carries and earns` | capacity ignored, so profit does not scale with the ship sent |
| `TRADE the danger setting decides where a trader is willing to go` | every setting considers the same destinations, and a world nobody has reported on counts as quiet |
| `TRADE a trader plans on prices the captain has read, and sells at the ones that are there` | the planner reads worlds the captain has never looked at, and a collapsed market still books a profit |
| `TRADE a route that looked quiet is flown against what is actually there` | the leg is rolled against the captain's own records, so a quiet-looking route can never be anything else |
| `TRADE a government that refuses the captain refuses their freighters` | standing does not reach the trader; it runs cargo to a port that will not deal with the captain and sells it |
| `TRADE orders, cargo, profit and remembered prices survive a reload` | a saved campaign comes back with its traders parked and its price records blank |

## Closing the overlay and intelligence round

Raised against `cbf879a`. Two changes and a writing rule.

### The map stopped narrating its own design decisions

An unreported system printed *"Nothing has reported on this system. Treat it as unknown, not as safe."*
beneath four readings that already said "no report". A stale one carried *"unconfirmed, and late"* and
*"a garrison that old is not a reading"*. The legend counted unreported systems and then explained what
unreported meant. A footnote explained two marks. The question mark, the source and the date had
already said all of it.

What the readout says now:

```
Paso — Trade: ? · Patrols: ? · Threat: ? · Disruption: ?
No current intelligence

Orion — Trade: heavy · Patrols: light (est.) · Threat: none reported · Disruption: none
Traffic reports · observed day 20 · 60 days old
Trade: 9/21 powers trading · market 11 · 1 berth · 12 at war
```

Sources are labels — **Direct observation**, **Fleet report**, **Relay telemetry**, **Traffic
reports** — not sentences about what each is worth. A reading its source cannot fully make is marked
`(est.)`. The legend footer reads `91 unreported systems`. An indicator with no reading reads "none
reported", which is deliberately not the word a source actually observed.

**A correction that came out of writing it:** fleet *protection* was marked as an assessment while
being fed the exact count. A crew can count hulls; what they judge is what is happening. Only the
threat reading is an estimate now, and it is the one that goes through `assessIntel`.

### The rule, applied where the same habit had got in

> If the interface has already communicated uncertainty mechanically — a `?`, "unknown",
> "unconfirmed", a date, or a confidence indicator — it does not explain that uncertainty again in
> prose. Give the source, the confidence or age where it is relevant, and the reading. The player draws
> the conclusion.

Applied to the galaxy reports, which carry a confidence field and a date already: *"Information dated
day 14; conditions may have changed."* is now *"Dated day 14."*, *"Fleet assessment — mistakes
possible"* is *"Fleet assessment"*, and an identification no longer appends that it may be mistaken to
a report already marked unconfirmed. The identity-pool check followed the text.

Three gates that required the prose now require the shape instead, and two of them additionally
require that **no line narrates uncertainty a mark or a date has already carried**.

### Two amendments to the foreign-market proposal

- **A destroyed hull is wreckage, not merchandise.** The Hirogen section said a prize is created when
  an operation "destroys or disables" a hull, which would have let them sell ships they had blown
  apart. Only a hull disabled and then taken, or captured intact, becomes a prize — and the engine
  already draws that line at `hull <= disableThreshold(max)`, and already knows a prize stabilised from
  one scuttled.
- **A pirate shelf should hold what pirates took.** It was a weekly roll dressed as loot. It is now
  prize records held by `pirate` first, then hulls the captain themselves lost to them if `takenFrom`
  is built, then at most one generic hull and only when those are empty. Both market sections therefore
  depend on `book.prizes[]`, and the decision list says so.

**Nothing in the proposal is implemented.** With this, the overlay and intelligence work is the round
as it stands; foreign markets and fleet trading are the next pieces of work, not part of this one.

## The blocker repair, and the second proposal draft

Raised against `7dd9735`. The blocker was right, and it was the worst kind: the feature looked correct
and lied.

### The dated intelligence was reading current truth

`visitedDays` stored only the **day** of a visit. A stale reading then called the live
`trueTradeTraffic`, `trueProtection` and `trueDisruption` and printed today's answers under "as the
captain saw it on day X". Visit a world on day 20, leave, have its stations destroyed and its
government change on day 60, and on day 80 the chart showed the **day-80 reality with a 60-day-old date
on it**. That is not a stale reading; it is a leak wearing one's clothes, and it is exactly the model
this layer exists to implement.

A reading taken with a live source is now **written down** — the day, the source, the controller, the
market, the berths, and the four bands with the sentences that explain them — and a system with no live
source is displayed from that record and from nothing else. Change the world without telling the
captain and the map stays wrong, and dated, until somebody tells them. The record is saved and loaded;
a save written before it loads with none, which reads as never having looked rather than as having
looked today.

### The cache could not see what it was caching

`conditionsStamp` tracked counts. A station can be wrecked without changing how many are destroyed; an
operation can go from moving to engaged without changing how many there are; a ship can move without
changing how many there are. All three are things the captain can be standing there watching.

The key is now a **revision of the state the readings read**, not a tally of it: where every hull is and
whether it is flying, which system each live operation is against and what stage it is at, which
installations are lost and which are wrecked, where the captain's own ships are, and who is at war with
whom. A counter bumped by hand at every mutation site would be cheaper and would go wrong the first
time one of thirty sites forgot; this cannot.

### "Crews can be wrong" is now true

A ship on station fed exact truth while claiming fallibility. Its threat reading now goes through
`assessIntel` — the same seeded model the galaxy reports use, at own-ships accuracy — so it is usually
right and sometimes not, and it is marked as an assessment. An operation with a name and an arrival
date is a transponder fact rather than a judgement call, so a crew never talks one away; what they can
get wrong is the week's weather around it.

### Two adversarial gates, both of which run on `7dd9735`

Neither bails at a precondition: both execute against the reviewed candidate and fail there on the
numbers, which is the evidence.

- **STALE-TRUTH** observes a world, leaves, destroys its installations, collapses its market, changes
  its flag and engages a force at it, and requires the chart to keep showing what was seen — then
  saves, reloads and requires the record to survive, then goes back and requires it to refresh. On
  `7dd9735`: *"trade reads 2 after the market collapsed and the flag changed; it should still read what
  was seen (3)"*.
- **LIVE-INVALIDATION** wrecks a station, walks an operation from moving to engaged and moves a ship
  between systems, all without advancing the day, and requires the chart to move each time. On
  `7dd9735`: *"a station was wrecked in front of the captain and disruption stayed at 0"*.

### The foreign-market proposal, second draft

`FOREIGN-STOCK-PROPOSAL-191545ZSEP26.md` replaced the first, three of whose four sections were wrong.
It is itself superseded by `FOREIGN-MARKETS-SPEC-191921ZSEP26.md`, below.

- **Suliban Helix was called ungoverned.** This candidate's own world-identity evidence makes it a
  self-governed Suliban world, exactly as Hirogen Range is self-governed Hirogen. The fence is a
  Suliban service; Suliban standing is what opens it.
- **The Hirogen were selling a licence, not prizes.** Availability derived from designs they had once
  killed, which empties the shop when the record ages out. It is now a `book.prizes[]` collection
  created when a hunt takes a hull, living outside `history`, consumed on sale: three captured scouts
  are three scouts.
- **Pirates Haven charged everyone five Terran standing.** The cost now follows the party harmed — the
  hull's government always, the previous owner where known (which needs a `takenFrom` at capture and is
  marked as not tracked today), and any government policing that approach, named by its own checkpoint
  rather than by being Terran.

Discovery is settled as proposed: the Suliban fence findable normally, the Hirogen shelf only after the
captain has seen evidence of a hunt, Pirates Haven findable once charted with its current stock learned
only on contact. The document ends with the three decisions it asks for. **Nothing in it is
implemented.**

## The seventh round — the four goals from `2316331`

### 1. The trade and security overlay, built

What was asked for was trade conditions — known traffic, route activity, patrol and protection cover,
piracy, hostile activity, disruptions. What existed was navigation lines to the captain's own cargo,
which is a different thing wearing the same word. **The objective overlay is unchanged**; this sits
beside it as two layers of its own, `Trade lanes` and `Patrols & threats`, each selectable from the
legend.

**What is true** is assembled from what the engine already simulates and never showed: the traffic
model's own civilian weights against a world's market and berths; the campaign's garrison hulls and
armed installations; the authored checkpoints and border policies; the week's activity roll;
operations moving on a system or engaged there; installations destroyed or damaged; occupations.
Piracy is not a new roll — it is a lane worth robbing with nobody watching it, or a world a pirate
governs.

**What the captain knows** is a separate question, and it is the whole point:

| Source | What it can say | What it cannot |
| --- | --- | --- |
| Standing there | everything, now | — |
| A ship on station | everything, now, with "crews can be wrong" | — |
| Relay coverage | what is present, what has stopped answering | how hard a garrison would fight; the week's own activity |
| Having been there | the berths, the market, the flag, dated to the day they saw it | anything about now; a garrison over a fortnight old is capped to "light" |
| Nothing | **nothing** | — |

And a system nothing has reported on reads as **unknown, never as quiet**: its indicators are null
rather than zero, it is drawn as a dashed ring with a query, its lanes are drawn in their own colour
rather than not at all, the legend counts how many charted systems are in that state, and the readout
says in a sentence that unknown is not the same as safe. A lane is only as known as its worse end, so
one end reporting quiet contributes nothing to a lane whose other end nobody has looked at.

The chart's bottom-right carries the readout for the selected system: the four indicators, the source
and its caveat, the day the claim is from, its age, and what the readings are made of — with `*` for a
transponder reading whose strength is not readable and `†` for a dated claim rather than a current one.

**Underlying data implemented:** `markSystemVisited` now records *when*, not just whether, and that is
saved and loaded. A save written before this loads with no dates, which reads as "date unknown".

**Found doing it:** `drawMapLegend` — the pre-panel chart legend — has been dead code for some time.
The readout went in there first and appeared nowhere; it has its own panel now.

### 2. The map and hail overlap, fixed

The chart is a canvas at z-index 74 clipped to its own panel rect; the hail panel sat at 28. At every
width this game is played at the chart was painted across the left of that panel — **164px of it at
1920** — and neither of the hail's buttons answered a click at its own coordinates. Acknowledging the
hail first was not a fix.

The hail carries the controls that answer it and a clock; the chart is a map that can be smaller. So
the chart gives way: its rect pulls clear of the hail and slides left to keep its width, down to a
floor below which the window is simply too narrow for both. Its close control is positioned from that
rect and moves with it, and the viewport, the clip and the node positions follow because they read the
same rect. The panel's stacking order at 78 is the second line, so on a window too narrow to give way
the hail stays readable and the chart is the thing partly covered.

**Gate HAIL** puts the captain in a foreign checkpoint's approach with the arrival hail unanswered,
opens the chart on top of it, and at 1920, 1536, 1440 and 1280 requires that the chart's rect does not
reach the panel, that the close control does not sit on it, and that both of the hail's buttons and the
chart's own control answer a click at their own coordinates. `map-with-pending-hail.png` is that state.

### 3. The foreign-stock exceptions, withdrawn and proposed instead

"Trophy vaults" describes what the Hirogen keep. "Trading quietly" describes how the Suliban trade.
Neither says a shipyard sells a Romulan scout to a passing Terran captain, and authoring two worlds on
those phrases was the same mistake as reading a grey market out of an emptied shelf, one step further
back. The table is empty and **the gate holds it empty**: every world sells its own government's
designs and neutral ones, and no world anywhere sells a hull its government would not carry.

`FOREIGN-MARKETS-SPEC-191921ZSEP26.md` names three worlds chosen for what they are in the campaign
rather than for their prose — the Suliban Helix as a fence limited to small hulls at a premium and a
standing cost, Hirogen Range selling only designs the Hirogen have actually destroyed a hull of in this
campaign, Pirates Haven selling stolen hulls at a discount in poor condition and visibly — with the
seven worlds I would not do it to and why, and an open question about discovery. **Nothing in it is
implemented.**

### 4. Recovery, flown rather than assigned

The check set `m.step = 'deliver'` and asserted about the setting. It now flies the contract: out to the
wreck's system and nine thousand units short of it, requiring that arriving is not arriving; in to
transporter range, requiring the **engine** to notice and put the engineers aboard; a save and a reload,
requiring the step, the markers and the list to come back; then travel to a candidate yard and dock,
requiring the delivery to complete there. Then the design must be relocated to that yard, the yard must
actually offer it, the offer must carry the `recovered-archive` provenance, the chart must stop marking
it and the list must stop carrying it — and standing at the same dock twice more must pay nothing more.

**Found doing it:** the captain's position is the camera, not `state.ship`, so the obvious shape of that
test would have flown nowhere and passed anyway.

## The corrections to this round

Raised against `43938a7` and closed here. Three findings, and each one was right.

### 1. Recovery contracts were excluded from the list, and their marker never moved

`renderContractsPanel` filtered on `m.kind !== 'archive'`, so the engineer-rescue job in the screenshot
was **marked on the chart and listed nowhere**. Worse, the marker was wrong: every mission resolved to
its `systemIndex`, and a recovery contract is the one kind whose destination moves. At the moment the
engineers were aboard, the chart still pointed at the ground they had been picked up from.

`missionObjective` now answers what a mission is asking and where, per step:

| Step | What it asks | What the chart marks |
| --- | --- | --- |
| `lead` | pay the finder's fee at any bar or trade station | nothing — "any station" is not a place; the row says so and names where the lead leads |
| `recover` | reach the wreck | the wreck |
| `deliver` | deliver to a yard that can build the design | the three nearest charted candidates, with the full count in the row |

Candidates are found from each yard's own record — status, construction class, the hull's mass, and
whether that yard's trade culture may carry the design at all — across charted systems only, sorted
nearest first and memoised. Standing, clearance and docking are decided when the captain arrives, so
the row calls them candidates and says so rather than promising one. Eleven rings for one contract is
not a map.

**Gate RECOVER** follows the whole arc: listed at the wreck, marked at the wreck, re-marked at the
yards with the wreck dropped once the engineers are aboard, and all of it surviving a save and a
reload. It reproduces on `43938a7`, `7767631` and `ae4ae4d`.

### 2. The screenshots were taken through an open dialog, and that was a real bug

`panel-contracts.png` and the chart shots had Fleet & Shipyard open over them because the capture step
called `close()` on an element id the fleet manager does not have, and nothing checked. Underneath that
was a defect a captain can reach from the keyboard.

**Every dialog in this game is opened with `showModal()`**, and a modal swallows the pointer for
everything behind it but not the keyboard. Only the debug and game menus were guarded. So with Fleet &
Shipyard open, **M opened the star chart underneath it** and C and P opened the top-left panel
underneath it: a chart whose systems could not be clicked, behind a dialog the captain had to find and
close first. The guard is now general and sits below the pending-overlay branches, so Escape still
closes a purchase or contract overlay opened from inside a dialog.

Two more of the same family, found while fixing it. The fleet manager was the one modal that neither
paused the clock nor dropped held keys on open, so the ship flew and fired behind it and a key held as
it opened stayed stuck. And each close path resumed the clock after checking the dialogs it happened to
know about — the reports folder did not know about the Empire panel, and none of them knew about the
fleet manager — so closing one resumed the clock while another was still up.

**Gate MODAL** presses M and C with the fleet manager open and requires nothing to open behind it, then
closes it and requires the keyboard back.

`scripts/screens-capture.cjs` is committed rather than ad hoc, and does not trust itself: every panel is
opened by clicking its own dock button, every shot first asks whether any dialog is open and says so if
one is, and every control it presses is checked for having answered — "Show on map" must take the chart
to that system, a legend row must flip its layer. It presses **Acknowledge** on the standing hail before
the chart shots, because that panel and the chart share the same corner of a 1440-wide window. The run
prints either the problems or the sentence that there were none.

The chart shots are now the same populated map with each layer turned off in turn: `map-overlay.png`,
`map-overlay-cargo-off.png`, `map-overlay-routes-off.png`, `map-overlay-contracts-off.png`.

### 3. An emptied shelf is not evidence a world is a grey market

The previous repair let an authored hull lot that the government's own rule filtered to nothing stand
as written, reasoning that such a lot is the author saying the world is a grey market. It is not. It is
a lot written before that world had a government, and reading a claim into it produced an incoherent
rule: **a lot with one eligible hull sold one hull, and the same lot with none sold every foreign hull
in it.** Foreign availability turned on whether one compatible hull happened to survive a filter.

Two worlds say it in their own text, and they are authored with the sentence that says it, the way an
allegiance is:

| World | The phrase |
| --- | --- |
| Hirogen Range | "trophy vaults", beside repair docks for vessels returning from deep pursuit |
| Suliban Helix | "trading quietly", from a chain of cell docks and patched-together habitats |

Everywhere else the government's rule stands, and a lot it empties falls through to the ordinary
price-ranked shelf, which stocks what that government would actually sell. **Breen Anchorage now sells
a Breen Shuttle and neutral freighters** rather than a Cardassian Behemoth, and rather than nothing.

The seven worlds that fall through get a fuller shelf than their authored lot held, because the generic
shelf is what a world without an applicable lot gets. That is the trade for not inventing a claim, and
it is the reason the gained figure below is larger than the lost one.

**Measured against `7767631`: 41 hull offers lost and 71 gained; 8 weapon offers lost and 13 gained.**
No world with an authored shipyard sells nothing.

**Gate STOCK** holds four things: no authored shipyard is empty; no foreign hull is on sale at a world
whose text does not say it deals in them; each authored exception is justified by a phrase from its own
description and actually sells its lot; and stripping the last eligible hull out of an ordinary world's
lot does not put the foreign hulls in that same lot on sale. It reproduces on `43938a7` with **20
foreign hulls on sale at worlds whose text says nothing of the kind**.

### 4. Two claims corrected

- **The file count.** The previous handoff said 134 files, which was the archive's entry count including
  directories. The pack holds **130 files, of which `SHA256SUMS.txt` is one, covering the other 129**.
- **Item 9 is PARTIAL, not done.** What exists is contract and cargo destinations and routes to
  objectives, selectable, with a counting legend, gated on what the captain has charted. The broader
  trade-activity overlay §7 asks for — wider trade the captain has not contracted for, read through
  discovery and intelligence limits — is **not built**. Eight of the nine items are done; the ninth is
  half of what was asked.

## This round's nine items

### 1. One alert control

The three G/Y/R chips are gone. The posture pill in the strip — `FLIGHT · GREEN` — is now the control:
clicking it cycles green → yellow → red, and its tooltip says so. The combat restrictions are
unchanged and now *explain themselves*: setting an alert the ship cannot hold prints what is holding it
("Alert set to green, but the ship is at yellow because the fleet is engaging"), rather than silently
snapping back. `alertOverrideReason` is the single place that answers why.

### 2. EW once, and open

`renderEWPanel` returns a plain panel rather than a collapsed `<details>`, and the copy that was
printed a second time inside Power/Sensors is gone. The EW button opens the EW panel with its orders
already reachable. The panel's own redundant heading went with it — the panel's title row supplies it.

**Gate ew** holds all three: that OPS carries no second copy of the controls, that the panel's orders
are reachable without opening a disclosure, and that they still work. The first two fail on `7767631`.

### 3. Fleet and shipyard in the game's theme

`.fleet-manager` is re-themed onto the LCARS variables — background, borders, headings, buttons, close
control — and added to the `body[class*="ui-theme-"]` selector list so it follows the active theme
rather than sitting outside it. Its `display: flex` is scoped to `[open]`; without that it overrode the
user-agent rule that hides a closed `<dialog>` and the manager sat on screen over the HUD.

### 4. Contact reports, expanded and labelled

A labelled, always-open, scrollable list under Sensors & Communications, with "No contacts detected."
when there are none, in place of a collapsed `<details>` the captain reported never seeing. Fleet and
refit open by default for the same reason.

**Gate sensors** asks what was actually wanted: that after a live re-render the list is on screen, is
not inside a closed disclosure, carries its heading, and scrolls. Fails on `7767631`.

### 5. The Power panel's header

The top-left panel now has a real header row carrying the title and the close control, instead of a
decorative `::after` bar with the content scrolling underneath it. The panel remembers its scroll
position per tab, so it used to *reopen* already overlapping. Checked through open, scroll, close and
reopen.

### 6. Top-left shortcuts

Inventory and Power are gone from the top-left menu: both are reachable from the dock. Cheats & Debug
stays, having nowhere else to be. The grid dropped from ten slots to nine.

### 7. Contracts, and objectives on the map

CONTRACT used to open a negotiation. What the captain had already accepted lived inside the Empire
panel under "escort", and nothing on the chart said where any of it was.

CONTRACT now opens a contracts list carrying every live station contract and every delivery aboard,
each with its **name, destination and deadline**, a per-row **"Show on map"**, and the marker toggle
that used to be buried in the cargo card. Accepting goes through one helper whichever screen offered
it, so acceptance says which world was just marked and a list that is already open stops reading
"offered". Markers are derived live, so a contract marks its world the moment it is accepted and stops
marking it the moment it completes or expires.

*Found while writing it:* "Show on map" opened the chart on the wrong world, because `openMap()`
selects the system the captain is standing in. The selection is made after the chart opens.

**Gate MARK** accepts a contract by clicking the button in the panel, reads the marker back, clicks
"Show on map" and checks where the chart went, then completes one contract and lets another expire and
requires both markers gone.

### 8. Actual world allegiance

31 worlds are placed inside a power by their own description and 8 are recorded independent by a
sentence in their text that says who governs them — the answer being nobody. `getBaseSystemOrigin`
consults both before the shipped government table; player captures and `factionSystemOverrides` still
win over everything.

The five Tholian worlds are controlled by, fly the flag of, and are hostile on the same terms as Tholia
itself, and their stations are owned by `tholian` rather than an anonymous `polity:NN`.

| Measured against `7767631` | |
| --- | --- |
| Governments changed | **31** |
| Worlds that changed hostility to a Terran captain | **19** |
| Worlds that changed station ownership | **11** |
| Cultures changed | **0** — last round's work untouched |
| Planet-card readouts changed | **0** |

That last row is the point read backwards. The map's relation line reads "Tholian world ·
self-governed" **both** for a world the Assembly governs and for a world nobody governs, so it was
never evidence; what changed is underneath it. The gate therefore asks the map *who governs* the world,
which is the field that was empty, and surveys the worlds under test first because the map answers
"Unsurveyed" for everywhere else.

**Blender and Gorn were deliberately given nothing.** Handing Blender a world makes it a territorial
polity and the war ledger then holds `dominion_remnant:ferengi`, a war nobody wrote. The Gorn are
described as extinct; giving them worlds contradicts the worlds' own text. Gorn services and recovery
stay behind the existing authored discovery requirement.

Four worlds were dropped from the independent table — New Switzerland, Trill, Tepos, Flash. Their
descriptions say who lives there and what they sell and nothing at all about who governs them.
Independence recorded on the phrase "Trills" is not a fact about the world. The gate now requires every
entry to be a governance statement.

`validation/world-identity-report.md` prints all 101 worlds with controller, allegiance, governor,
origin source, hostility, station owners and map relation, before and after, generated from both trees
by one script.

### 9. Cargo and trade overlay on the chart — **now complete, in two parts**

The objective half of this (contract and cargo destinations, routes to them) is below and unchanged.
The trade-conditions half — which is what item 9 actually asked for — is the seventh round's first
goal, above.

Three selectable layers — contract objectives, cargo destinations, routes to them — with a legend at
the foot of the chart that counts each layer and doubles as the picker. A world that is both an
objective and a delivery gets a ring for each. Nothing is drawn for a system the captain has not
charted, so a delivery into the hidden region reveals nothing. The old hardcoded cargo ring is gone, so
nothing is drawn twice.

**Gate OVERLAY** paints the chart for real and reads back what was drawn — the cargo marker, the legend
with its counts, a dashed stroke in the overlay's own colour — then clicks the legend row with a real
pointer and requires the markers to go with the layer.

### Also fixed, unasked

The message readout in the status strip clipped mid-word with nothing to show it had been cut; at 1440
the captain read "Captain aboa". It ellipses now.

### Found while taking the screenshots, not fixed

**The incoming-hail panel and the star chart share the same corner.** At 1440 the chart panel's right
edge lands at x≈1324 and the hail panel runs from x≈1125 to x≈1420, so they overlap by some 200px, and
the chart's own close control — a DOM element positioned at the panel's corner — is painted on top of
the hail's prose. In the capture it sat over the word "declared". Answering the hail clears it, which
is what the capture script now does and what a captain would do, but a captain who opens the chart with
a hail standing gets both drawn over each other. Deciding which of the two should give way is a layout
question about those two panels rather than about the overlay, and it is not in this round's scope.
Measured and named rather than left for the next playtest.

## Still NOT DONE, and named

- **Foreign hull stock** is withdrawn, not designed. The third-draft proposal is
  `FOREIGN-MARKETS-SPEC-191921ZSEP26.md`, now approved rather than asking;
  until they are taken, every world sells its own government's designs.
- **A captured hull does not record who it was taken from.** The Pirates Haven section of that proposal
  degrades gracefully without it, but the field does not exist.
- **The lead step of a recovery contract has nothing to mark**, because "any bar or trade station" is
  not a place. The row says so; a set of *candidate* stations is not built.
- **Evacuation and blockade** remain unfinished mechanics. The design is
  `EVACUATION-BLOCKADE-DESIGN-180230ZSEP26.md`, unchanged and still unimplemented.
- **Rigel's protectorate.** The engine has no level between "independent" and "governed by", so a world
  whose text names a protector is indistinguishable from one the protector governs outright.
- **§4 fleet trading is built but not closed** — two repairs landed here and the cargo/economy
  question is open in front of the reviewer. **§9's fleet-trade fixtures are done**. **§5 recall and
  rendezvous is deliberately not**: a stopped trader finishes the leg it has already paid for, sells,
  and holds position, and there is no order to bring it home.
- **§3.3 bilateral peace, §3.4 cargo capacity and contract economy, §3.5 uninhabited worlds,** the rest
  of **§3.6** (modal sticky header, 44×44 close, scroll reset, multi-press close), **§5** recall and
  rendezvous, **§6** fleet repair UX, **§9's** seeded economy table — all still open.
- **The 1400px power-wrap breakpoint** is still parked pending a real `window.innerWidth` from the
  laptop.
- **The EW panel lies over the strip at ≤600px.** Named last round, still unfixed; laptop play is the
  target and this is a phone width.

## Evidence

- 35 of 35 gates pass from a clean tree bound to this commit; `validation/RUN.json` records the tree
  before the first gate ran.
- The playtest gate is 34 checks. All 34 reproduce on `ae4ae4d`, and each later base reproduces the
  findings raised against it: 8 on `43938a7`, 6 on `2316331`, and **2 on `7dd9735`** — STALE-TRUTH and
  LIVE-INVALIDATION, which run against that tree and fail on its numbers rather than on a missing
  function. Every failure message describes a wrong behaviour, and no check fails with a TypeError.
- `validation/screens/` — the HUD at 1920, 1536, 1440 and 1280; the Power, EW, Fleet and Contracts
  panels; and the same populated chart with the overlay on and with each of its three layers turned off
  in turn. All taken by `scripts/screens-capture.cjs` through the mouse, with every panel opened from
  its own dock button and every control it pressed checked for having answered.

## The fifth round and earlier, unchanged

Everything from here down is the previous five rounds and still stands. This round is above it. The
fifth round was DTG 181656ZSEP26, on `7767631`; its headings are one level lower here than they were in
its own document, and nothing in them has been edited.

### Read this first

This is the fifth round, on top of `7232dc6`. The evidence identity concern is closed and that base is
taken as given. Four gaps were named; all four are addressed, and the two that were asked for as
proposals rather than code are delivered as proposals.

**1. Power stays usable at every width the game is played at.** Three separate faults, one report. The
strip is `pointer-events: none` — it has always been a readout the captain looks past — and the alert
chips and power steppers added last round were put in it without pointer-events of their own. They
rendered, they reported as visible, and **they took no input at all**. The TOP gate passed them because
a scripted `element.click()` dispatches straight at a node and never asks what is on top of it. Nothing
in this HUD had needed hit testing before, so nothing tested it. Separately, power left the strip as
the window narrowed — the steppers at 1400px and the whole group at 1200px — so on a tablet held
upright there was nothing to press. What gives way now is the row, not the controls: below 1400 power
takes a line of its own inside the strip, four across or two and two, with full-size steppers. And
where the browser reports a coarse pointer, every control meets the 44pt floor; the alert chips were
26×26.

**2. Ownership removes the foreign gate everywhere, not just on the shelf.** Six purchase paths were
still ownership-blind: EW modules, sensor suites, seeker weapons, fleet refit and repair, fleet weapon
refit, and commissioning. The first three did not even waive the test at an owned holding — they
re-aimed it at the captain's own flag, so a captain whose flag faction disliked them was refused by the
yard they built. Price, stock, compatibility, mass, facility, arrears, clearance and the authored
discovery requirements are untouched, and the check proves it by emptying the purse at the captain's
own yard and watching it still say no.

**3. Identities are authored against the descriptions, and no government moved.** The old chain
guessed from the world's name and, when that failed, invented a people named after the planet. Eighty-
five worlds now carry an authored identity with the phrase from their own description that justifies
it; twelve are recorded uninhabited because their text says so; three are left to the local fallback
deliberately. **Thirty-two worlds changed their people and none changed its government** — the full
comparison of all 101, with before and after culture, controller, allegiance, origin and governor, is
`validation/world-identity-report.md`, generated from the shipped tree.

**4. Evacuation and blockade stay unfinished, and a save carrying one is not left holding it.**
Withdrawing them stopped them being issued; it did nothing for an existing save. A blockade contract
can never complete — its own completion test is written `() => false` — so left alone it runs to its
deadline and fails the captain for the game's omission. On load an offered one is taken off the board
and an accepted one is released without penalty. Both remain NOT DONE as mechanics; the design is in
`EVACUATION-BLOCKADE-DESIGN-180230ZSEP26.md` for review before either is built.

### This round's four items

### 1. Power and alert, operable rather than merely present

| Width | Before (`7232dc6`) | Now |
| --- | --- | --- |
| 1600 | chips present, **no control takes input** | one row, steppers, all reachable |
| 1360 | steppers gone | power on its own row, full-size steppers |
| 1200 and below | whole group gone | power on its own row, four across or two and two |
| 820 (tablet upright) | nothing to press | 2×2 power grid, 44pt steppers, 44pt alert chips |
| 640 and below | nothing to press | alert in the strip; power on the PWR button — see the limitation below |

The menu block's box was also capped at 52px while its six buttons overflowed it down to 152px, so
anything positioned "below the menu" was positioned below a box that was not where the menu ended.

**Gate LAYOUT** no longer asserts one row, which was only ever a proxy for "nothing collides and
nothing is clipped"; it asserts those directly at seven widths, and asserts that every alert and power
control is both on screen and hit-testable, naming whatever covers one when it is not. **Gate POWER**
opens a touch context, presses the controls at the coordinates they occupy, and reads the state back.
On `7232dc6` they report three of three alert settings covered by the canvas at every width, zero of
eight power controls from 1360 down, and red alert leaving the posture at green when pressed.

**Named limitation, below 641px.** Measured at 390×844 with the menu, the strip, an incoming hail and
the disabled-ship panel all up: the menu ends at 136, the disabled-ship panel begins at 372, and the
hail needs 150 of the 162px between them for its own two actions. A power row does not fit. Alert stays
in the strip; power stays one press away on the PWR button, which the gate requires at those widths.
Putting the power row there instead pushed the hail's buttons underneath the disabled-ship panel, and
those buttons are how a captain answers the thing threatening them. A phone is not a size this game is
played at; the tablet is, and it keeps both.

### 2. Every purchase and service at an owned holding

`vendorStanding` is now the single place that answers what a vendor thinks of the captain, and returns
full standing at a holding they own. Converted: EW modules, sensor suites, seeker weapons,
`fleetServiceAllowed` (which is what fleet repair, refit, sale and equipment transfer all hang off),
the second silent gate inside fleet weapon refit, and commissioning. The recovery yard's hand-rolled
`owner === PLAYER_SIDE ||` short-circuit becomes the same call, so there is one pattern rather than
three.

**Left deliberately blind: the flag market.** It asks whether a government will issue you its colours,
which is its decision and not the local vendor's. Owning Qonos does not make Starfleet hand you a
Terran flag. Said so at the call site rather than leaving it to look like an oversight.

**Gate OWN** stands at a yard that both refits and sells weapons, with twelve governments at floor
standing, and asks each path in turn — then empties the purse and requires the same yard to refuse on
price. On `7232dc6` it reports the EW shelf answering "Requires 15 Terran standing; yours -100" at the
captain's own dock.

### 3. World identities

| # | World | Was | Now | Government | Justified by its own text |
| --- | --- | --- | --- | --- | --- |
| 69 | New Bajor | Dominion | **Bajoran** | dominion (unchanged) | "bajorans are slaves to the dominion" |
| 28 | Blender | Blender | **Blender Remnant** | none (unchanged) | "conquering race called the Dominion" |
| 94–98 | Crystal Loom, Webheart, Lattice Hold, Spindle Reach, Facet Gate | each named after itself | **Tholian** ×5 | none (unchanged) | "Tholian" in each first sentence |
| 29 | Remus | Romulan | **Reman** | romulan (unchanged) | "home to the Remans" |
| 63 | Aldnas | *(none)* | **Romulan** | none (unchanged) | "Romulan colony" |
| 5 | New Switzerland | New Switzerland | **Terran** | none (unchanged) | "passivist humans" |
| 61 | Astron | Astron | **uninhabited** | none (unchanged) | "home to no one" |

Sonata was already resolving to Son'a by a name match; it is now authored, so it no longer depends on
a rule that the full-text matcher would have answered "Klingon" because its description mentions the
Klingons.

Peoples with no polity of their own get a `people:` id rather than a faction key — Remans, Karemma,
Dosi, T-Rogorans, Tellarites, Hupyrians, Orions, Rigelians, Lik, Lysians, Nausicaans, Flashians,
Trill, Teposians, Vexxians. A `people:` id is not a faction key and can never become one; the gate
asserts none of them is recognised as a polity and none governs anything.

**No world's government moved.** `validation/world-identity-report.md` prints all 101 worlds with
their culture, controller, allegiance, origin and governor before and after, generated from both trees
by one script so the two sides cannot be shaped differently. The four government columns are identical
on every row, and the gate proves it independently by comparing every world's origin against its own
authored `governmentId`. Thirty-two worlds changed their people; 41 planet-card readouts changed,
because a readout also moves when the government beside an unchanged people is printed differently.

Orilla is **not** among them: it stays the local fallback, "Orilla · self-governed", because its text
describes a refugee mixture with no people to name. An earlier draft of this document said otherwise;
the report is now generated from the shipped tree rather than an intermediate one.

New Bajor reads "Bajoran world · Dominion administration" and Remus "Reman world · Romulan
administration". New Switzerland's people are Terran and its government is still nobody's.

### 4. Evacuation and blockade

Still **NOT DONE as mechanics**. `migrateWithdrawnMissions` releases what a save is carrying: an
offered contract off the board, an accepted one released with no standing penalty and the reason said
out loud, an already-completed one untouched. It is self-guarded and idempotent, and runs outside the
initialise branch because a loaded save arrives with its book already initialised.

**Gate SAVE** builds a save carrying six of them — one of each kind offered, accepted and complete —
loads it, and requires none open, no standing lost, nothing paid out, the completed pair untouched, and
the migration to do nothing on a second run.

The design proposal is `EVACUATION-BLOCKADE-DESIGN-180230ZSEP26.md`: evacuation as evacuees carried as
cargo from a threatened world to a named refuge, paid per delivery, failing differently when the
captain is negligent than when the campaign outruns them; blockade as contacts turned back and counted,
costing standing with the party blockaded. It also names the piece that does not exist — nothing in the
traffic model can currently record that a departure was *caused* — which is why blockade is the one I
would not build first.

### Found while doing this, not fixed

At 600px and below the EW panel lies over the top strip, so a captain who opens EW in a fight loses the
power controls underneath it. That is a question about that panel rather than about whether the strip
fits, and it is not in this round's scope. Named here rather than left for the next playtest.

### The two corrections to the fifth round

Raised against `98ac2a2` and closed here. Laptop play is the target from this round on; the iPad is an
occasional convenience, so nothing further was spent on phone or tablet layouts — what was already
done for them stays.

**The world-identity report was generated from an intermediate tree.** It claimed Orilla became
"Orilla refugees", which the code and the gate do not do — Orilla stays the local fallback, because its
own text describes a refugee mixture with no people to name, and that entry had been dropped before the
candidate was committed. The count of 33 included it. The report is now generated from the shipped
tree, covers **all 101 worlds** with before and after culture, controller, allegiance, origin and
governor, and is stamped with both commits. Corrected counts: **32 cultures changed, 41 planet-card
readouts changed, 0 governments**. The generating scripts are committed so it can be rebuilt rather
than being a hand-made artefact.

**The SAVE check tested the helper, not the behaviour — and the behaviour was broken.** It called
`migrateWithdrawnMissions` directly. Rewritten to write a real save, strip the migration flag from the
stored JSON so it is genuinely from before the withdrawal, load it through `loadGame`, run the game,
save and load a second time, then run twenty days past the old deadlines. It failed at once: the
migration hung off `campaign()`, which runs on a fresh start, while the play path after a load goes
through `campaignBook()`, which does not migrate. **A loaded legacy save kept all four open contracts**,
and `advanceStationMissions` could have progressed an evacuation before anything noticed. It now runs
in `loadGame`, at the moment the save arrives. The check holds the captain's latinum and six faction
standings across all three stages, requires the two completed records untouched, requires nothing to
expire rather than release, and requires a relief contract in the same save to survive — so it cannot
pass by clearing the board.

**The HUD checks moved to laptop widths.** The sweep is now 1920, 1600, 1536, 1440, 1366 and 1280 — a
1920×1200 panel at 100, 125 and 150 percent scaling plus the two other common panels — with 820 and 600
kept only so the narrow work cannot silently regress. Adding those widths found real clipping: between
1400 and 1600 the base grid's minimums exceeded the strip, so at **1440 the standing readout ran 70px
past the right edge**, three others were cut and "CONTRACT" did not fit its button. That band has its
own tracks now. The operability check dropped the touch context and kept what it was for — the fault it
caught was never about touch, since `elementFromPoint` returned the canvas for a mouse exactly as it
did for a finger — so it presses with an ordinary pointer at three laptop widths, and now also checks a
stepper lowers as well as raises.

**The power breakpoint at 1400 is untouched and still open**, pending a real `window.innerWidth` from
the laptop.

### The earlier rounds, unchanged

Everything from here down is the previous four rounds and still stands. This round is above it.

### Read this first

This is the fourth round. Rounds one to three answered the independent reviews of `1fc0838`,
`f27dd56` and `c1c5843`, and all of that still stands unchanged below. This round answers a playtest
list of six items and the layout work that followed from it.

**The six items, as reported.** "The bottom menu still doesn't say fleet ew and the other stuff I
wanted"; "power should be shown while engaging maybe in the top in between the debug buttons and fleet
status also be able to change alert status from there"; "when you take an owned planet and you build a
station there you should be able to buy whatever you want from the planet and the station they're
yours you shouldn't need prestige for that"; "the evac missions and blockade still don't have anything
to do in the game"; "don't think that the IDs are set sonata says Unclaimed world · no government |
neutral | Nebula check the other worlds as well for that".

All six are done. Evacuation and blockade were **withdrawn rather than designed**, which is what was
asked for when the choice was put: they are no longer offered anywhere, and the debug command no longer
lists them. They remain NOT DONE as mechanics.

**The HUD then had to be made to fit.** Putting power and alert posture in the top strip was the
easy half; the strip had eight column tracks for ten slots, and it clipped its own posture pill and
wrapped the stats onto a second row across the menu block and the minimap. That is the complaint from
earlier in the playtest — "the words still don't fit or we have issues with it overlapping" — so it is
now measured rather than eyeballed: `LAYOUT` plays the HUD at six widths and reads back what is on
screen. On `ae4ae4d` it reports the posture pill cut at every width, a 250px overrun at 1000, and two
rows lying across both panels below 900.

Two things were found by gates while closing it, not by looking. The stylesheet's width blocks are
written in descending order but several base rules are written *after* them, so a media rule and a base
rule of equal weight resolve the wrong way round: the strip's new narrow-width rules had been appended
at the end of the file, where they overrode every block they were meant to defer to. And the hail
panel's height floor — the height at which it still shows every control it is offering — was
arithmetic that did not count the margins its prose carries, so the second hail action added in round
one settled three pixels below the panel's own bottom edge. The existing squeeze check caught it. The
floor is now measured rather than computed.

Most of the 17SEP specification is still **not** here — §3.3 bilateral peace, §3.4 cargo and contracts,
§3.5 uninhabited worlds, the rest of §3.6, §4 fleet trading, §5 recall, §6 repair UX, §7 overlay.
`CANDIDATE.json` lists every section under `spec_17sep` with DONE / PARTIAL / NOT DONE.

### The playtest batch

### P1. The quick-action bar carries what was asked for

The bar was eight buttons and had neither FLEET nor EW. It is ten, in the order the specification
gives: COMMS, TARGET, HAIL, MAP, CARGO, POWER, FLEET, EW, CONTRACT, SAVE. Each carries one label —
the duplicated expanded label the specification complains about is gone — and the labels shorten to
three letters below 1100px and fold onto two rows of five below 680px rather than overflowing.

**Gates HUD and HUD-2:** the bar carries all ten actions with one label each, and FLEET and EW open the
fleet manager and the EW panel respectively. On `ae4ae4d` the first reports the eight it has.

### P2. Power and alert posture, reachable in a fight

Both were behind a modal: the alert readout beside the ship opened the game menu, and power lived in a
panel that covers the view. Neither could be touched while engaged, which is the only time either
matters.

The top strip now carries an alert group — three chips, the active one lit, one press each, no dialog —
and a power group of four chips showing engines, weapons, shields and sensors with the level as the
chip's own underline. The bottom bar keeps its POWER button and the panel is unchanged, so nothing was
taken away.

Room is given up in stages as the window narrows: the power steppers go at 1400 and the readout stays,
the power group leaves the strip at 1200, three of the six stats go at 980, and **alert posture
survives to the narrowest width**, because it is what a captain reaches for first.

**Gate TOP:** with the ship under fire, red alert is set from the strip and weapon power is raised from
the strip, and the dialog count does not change. It plays at a width that offers the steppers and asks
whether the control it presses is on screen at all, rather than merely present in the markup.

### P3. Your own world and your own yard sell to you

A world the captain holds and a yard they built on it still asked what a foreign government thought of
them before selling anything. At floor standing their own yard answered "Terran ports refuse you.
Standing -100."

`isOwnHoldingVendor` decides it from the station's owner, or the system's control when there is no
station, and `purchaseStandings` presents full standing to a vendor that is the captain's own.
Every refusal path in purchase, market, weapon and hail now runs through `vendorRefusal`. Prestige is
how strangers decide whether to deal with you; there are no strangers at your own dock.

**Gate OWN:** at a real yard (a relay array sells nothing to anybody and would prove nothing), the
refusal reason changes from "Terran ports refuse you. Standing -100" to "Need N latinum". On `ae4ae4d`
the tree has no notion of a vendor being the captain's own, and says so.

### P4. Evacuation and blockade are withdrawn, not simulated

Both were offered and neither had anything behind it. Asked whether to design them or pull them, the
answer was to pull them until designed.

`WITHDRAWN_MISSION_KINDS` is `['evacuation', 'blockade']`; `offerStationMission` returns null for both;
the debug `mission` command lists only the four that work; and the escort-plus-blockade pairing is now
escort alone. Relief, reconnaissance, repair and escort are unchanged.

**They are NOT DONE as mechanics.** Withdrawing them is not implementing them.

**Gate MISSION:** a contract with nothing to pursue is not offered. On `ae4ae4d` an evacuation contract
is offered.

### P5. Every inhabited world has a people

Sonata read "Unclaimed world · no government | neutral | Nebula". Fifty-eight of the hundred and one
worlds had no culture at all, and the ones that did got it from a chain of name and description
heuristics that also read Blender as a Dominion world because its description mentions the Dominion,
and collapsed New Switzerland and Orilla into one identity.

`getSystemCulture(index)` resolves a world's people separately from its government: an authored origin
faction first, then the name table, then — for a populated world that answers to neither — the world
itself, as its own polity. `SYSTEM_NAME_RULES` replaces the heuristic chain with a data table of names,
text and special cases, and `matchSystemFactionByName` can be asked for a name match alone, so a
description can no longer assign a world to a power.

Fifty-eight worlds without a people became ten, and all ten have a population of zero. Sonata resolves
to the Son'a. New Switzerland and Orilla are distinct, each self-governing under its own name. Blender
is Blender. Earth is Terran.

**Gate CULT-2:** every inhabited world has a people, no empty world was given one, the named cases hold,
and the self-governing worlds have as many identities between them as there are worlds. On `ae4ae4d` no
world has a people it can name.

### P6. The top strip fits at the widths the game is played at

Covered under "Read this first". The strip's ten slots have ten tracks; the first three size to their
contents because they hold short fixed strings and controls, and the message slot is the one that gives
up room, because it is the one that can ellipsis. Below 640 the minimap moves to the corner above the
dock and the strip takes the line under the menu.

**Gate LAYOUT:** at 1600, 1280, 1100, 1000, 860 and 600 the strip is one row, nothing sticks out past
its own right edge, no readout is cut off, it is clear of the menu block and the minimap, and all three
alert settings are reachable on screen. Every width is judged before anything is asserted, so the
verdict names what is wrong with the HUD rather than whichever width was measured first.

### P7. The incoming hail has room for its second action

Not on the list, but caused by it. Round one gave the hail panel a STATION CHANNELS button beside
ACKNOWLEDGE HAIL. The panel sizes itself to a floor meant to be the height at which it still shows
every control it offers, and that floor was arithmetic — a flat 7px between children, 18px of padding,
34px for everything else — which did not count the default margins the prose carries. With two buttons
the panel settled three pixels short of its own last control.

The floor is now measured: clamp the prose to one line, read where the last control lands, put the
prose back. Measuring it honestly made the panel taller than the phone column has room for, between
the strip above and the disabled-ship panel below, so two things that were paying for that height were
fixed — the body spaces its children with `gap` and the paragraphs were also carrying their default
margins, spacing them a second time; and at phone widths the two actions now sit side by side. Both are
inside the panel and clear of the disabled-ship panel at 390x844.

**Gates HAIL (blocker suite) and the campaign probe's squeeze check** already existed and are what
caught this.

### The second and third rounds' findings

### A. The maturity gate could be satisfied by cycling one menu *(round 2)*

Every successful press of "request contract" incremented `contractsOffered`, and that counter was
simply added to the systems visited. Two hundred presses at one station cost nothing and carried the
whole gate.

It is now **categories, not a total**, and each one is a set or a capped tally of something that costs
the captain a journey, a docking or a destination:

| Category | What it counts | Needs |
| --- | --- | --- |
| `systemsVisited` | distinct worlds seen | 10 |
| `journeys` | journeys the fleet ledger accepted, capped at 400 | 25 |
| `issuers` | distinct stations or worlds that have offered the captain work | 6 |
| `contacts` | distinct powers whose service channel they have opened, by docking or by hail | 3 |

**Three of the four** must be met. Rerolling a destination at one station is the same issuer, so two
hundred presses move exactly one count by exactly one and never again.

The constraint on what may be counted here has not changed: only things the player does, and only
things a jump cannot change while it is running. Nothing the campaign itself increments is eligible,
which is why station missions stayed out.

**Gate DOM-7:** two hundred presses at one station, with no day passing, move the maturity counts by at
most two and satisfy fewer than the required number of kinds. **Matrix invariant:** each category is
pushed to a hundred times its own threshold *on its own*, and none of them alone opens the door.

### D. One warp counted as two journeys *(round 3)*

The journeys category counted calls to the calendar wrapper rather than journeys the fleet ledger
accepted. An ordinary warp calls it **twice with the same persisted id** — once when the mid-jump
briefing opens, once on arrival — and the second call correctly advances no day and charges nothing,
but the counter had already moved before asking. Thirteen warps recorded twenty-six journeys and passed
a threshold of twenty-five, halving the travel the gate was meant to require. A zero-day call counted
as a journey too, and the reload path makes one of those.

The increment now happens **after** `Fleet.advanceCalendar` returns, only when it accepted the journey
and only when days were actually requested. The category counts what the candidate said it counted.

**Gate DOM-8:** one id presented twice counts once; a zero-day call counts nothing; thirteen ordinary
warps — each presented the way the engine presents one, briefing then arrival — record thirteen
journeys and do not reach the threshold, with the days elapsed proving each warp advanced its own days
exactly once.

### B. The evidence did not name the tree it came from *(round 2, widened in round 3)*

`run-gates.sh` refuses to run against a dirty working tree, and writes `validation/RUN.json` and
`validation/RUN-FILES.txt` before the first gate. `RESULTS.json` takes its candidate from that file
rather than asking git when the manifest happens to be generated; `make-pack.sh` refuses to build a
pack whose `RUN.json` or `RESULTS.json` names a commit other than the one being shipped.

Round 2 hashed seven paths and the handoff described that as every file the suite exercises, which was
not true: the gates import dozens of tracked modules and serve hundreds of built files.
`RUN-FILES.txt` now hashes **every git-tracked file in the repository and every file under `dist/`**,
and `RUN.json` carries the counts and a digest of it.

`.commit-count` was a pack file sitting outside the checksum manifest. It is gone; the count is passed
to the cover sheets directly.

### C. The contender distance was a label, not a measurement *(round 2, completed in round 3)*

The matrix check asks the fixture's own route graph how far Romulus is from the entry, prints the
answer, and asserts the navy is a contender at exactly that hop count and is not one at one hop less.

Round 2 could only show the comparison working at four and three, because the authored galaxy is not
eight hops wide, and the shipped limit is eight. A second check now **builds a corridor of empty
systems** long enough to put a navy at exactly eight hops and at exactly nine, measures the result
rather than assuming it, and tests the shipped value where it actually decides: at eight the navy is a
contender and the opening closes; at nine it is not and the opening returns.

### The six findings from the first review round


### 1. A long jump could consume the whole arc

Reproduced: missing patrols on day 266, staging signatures on 306 and the invasion on 331, all inside
one calendar advance and all in the same mid-jump briefing.

A phase may now become **eligible** at any point during a jump, but only one may **commit** per beat. A
beat is the journey when the engine is running one, and the day itself otherwise — which is what keeps
stepped and bulk advancement identical, since a day-by-day run has one beat per day either way. The
engine puts the journey id on the campaign's world view for the duration of `advanceFleetCalendar`.

The check that decides this is re-read after every commit rather than captured once for the day. The
first implementation captured it once, and all three stages still cascaded inside a single call — the
gate caught it.

**Gate: DOM-6.** Four two-hundred-day jumps with every dwell set to zero advance the arc exactly one
stage each: `dormant→reconnaissance`, `reconnaissance→staging`, `staging→invasion`, `invasion→invasion`,
with at most one new Dominion warning per jump.

### 2. There was no player-opportunity gate

There is now, and it is what replaced the calendar floor rather than sitting beside it. The first
version of it was a single additive counter and the second review showed it was farmable; **see finding
A above for what it is now.** The principle is unchanged and was right: count chances the game put in
front of the captain, never anything they achieved, so a captain who takes none of it is protected
exactly as much as one who takes all of it.

Travel does not accumulate it. Visiting a **new** system counts once; flying back and forth between two
systems for four hundred days counts nothing.

### 3. Economic and industrial condition was not considered

Reproduced: identical factions at maximum treasury and at bankruptcy returned the same open
opportunity.

A war that cost hulls and nothing else is a war somebody can still fight. A worn-down power now has to
be strained where wars are actually won — **revenue**, **treasury** or **berths**, any one of them below
`dominionEconomicStrain` of that polity's own high-water mark. Three because a power can be broke, or
blockaded out of its revenue, or have lost its yards, and each is a different way of being unable to
replace what the expedition will take off it. The high-water marks are recorded daily alongside the
readiness one.

**Matrix evidence:** the `solvent` and `bankrupt` columns of every row. Identical fleets and identical
war history, one side broke and one rich, now decide differently, and the solvent row says why.

### 4. Contenders were a hand-written list, and resistance was not re-evaluated

Reproduced twice: an 18,000-strength Romulan power was excluded from the near-side set because it was
not one of the five names the model looked at; and a 6,300-strength player empire that appeared after
reconnaissance made `challengeable` false without standing the expedition down.

Membership is now **reach**: any polity holding ground within `dominionContenderHops` route-hops of the
entry system, plus the central belligerents because the war that made the opening is theirs, plus the
player on the same terms. And the stand-down now fires on `!challengeable` as well as on recovery and
on the corridor, so a contender that appears mid-arc sends the expedition home.

**Matrix evidence:** a `distant-romulan` column across every row; the contender set is printed.

### 5. The accumulated weight did not reject wobbling

The review's arithmetic is right: `+1 / −0.5` has positive growth whenever the condition holds more
than a third of the time, so an alternating condition reached 30 after 120 days.

It is now a **bounded rolling window**: the last `dominionOpeningWindowDays` days of eligibility, of
which `dominionOpeningSustainDays` must have been eligible. Alternating gives exactly half a window and
half is not enough; a case eligible two days in three passes. The window cannot accumulate past its own
length, and a near side that starts recovering walks the count down as the good days age out.

**Matrix evidence:** an invariant that runs 4,000 days of three patterns — alternating, two-in-three,
and always — through the same window arithmetic and asserts the first never unlocks, the second does,
and the count never exceeds the window.

### 6. "No date anywhere" was false

It was: `dominionEarliestDay` was 120, and the same strategic state was closed on day 119 and open on
day 120. The matrix sampled 200, 800 and 2,000 — all above the boundary — so the claim it printed was
untested where it could fail.

The floor is **removed**. Nothing in the expedition's rules is a campaign day. The matrix now samples
**1, 119, 120, 121, 800 and 2,000**, and asserts both that every history decides identically across all
six and, specifically, that the decision does not move across the boundary a floor used to sit on and
that a galaxy already in the opening state on **day 1** is not refused for being young.

The late-save migration no longer re-anchors anything, because there is nothing dated to re-anchor; it
records the shift for reference only.

### The changes

### 1. `df24878` — a power the captain has never met is not on their board

A fresh Terran start listed **Dominion · 0+ worlds · strength 3,119–5,199 · day 1** in the Other Powers
table with all eight of its systems uncharted, and the strength band was read from the Dominion's true
readiness. `campaignPowerContact(id)` now decides whether a power is on the captain's board at all:
controlled systems they can see on the chart, installations at a known system, a dated observation, or
a report that named it. A power with none of those is not listed, not named in the panel, and not the
subject of a public diplomatic report.

Where a power *is* known but only partly observed, the estimate says so: `at least N`, `(low
confidence)`, and a floor rather than a total, computed from `Campaign.observedReadiness` over the
systems actually observed rather than from global truth.

`CAMPAIGN_LOCKED_DIPLOMACY = ['dominion']` takes the expedition's war out of the ordinary neighbour
roll, in both sources of `diplomaticPairs()`.

**Not fixed by this:** every other power's strength band still derives from true readiness. That is the
named follow-up in the specification and it is not closed here.

### 2. `9c37aed` — Blender holds a Jem'Hadar garrison that is not Dominion Central

Blender (system 28) was an empty neutral system. It now holds `dominion_remnant`: its own diplomatic
identity, its own name (**Blender Remnant**), its own art and ship prefix, at war with Terran and
Romulan and at peace with everyone else, with an authored outpost (`28-901`, "Blender Garrison") and
four hulls standing on it. It controls no world, so it is not a territorial power.

Its opening garrison is authored in `CAMPAIGN_RULES.openingGarrisons`.

**Unproven:** that it actually raids Terran and Romulan forces and is raided back. The identity, the
outpost and the garrison are in and gated. The raiding behaviour is not gated and is not claimed.

### 3. `ec9872c` — the remnant flies two designs and can pay for itself

The garrison drew from the whole Dominion pool, so the opening four included a **Dominion Battleship**
and a **Dominion Scout** — hulls the captain is not meant to see before the wormhole. Every draw for
`dominion_remnant`, by every path (campaign hull, patrol, escort, raid, traffic), now comes from
`FACTION_DESIGN_POOL`: **Jem'Hadar Attack Ship (322)** and **Jem'Hadar Battlecruiser (48)**, nothing
else. Dominion Central still draws the whole catalogue; the restriction belongs to the remnant.

It also had no way to stand: ruling no world it earned nothing, paid upkeep from a fixed opening
treasury, and a hull lost to a raid was gone for good. Its outpost now pays it.

| Authored value | Setting | Why |
| --- | --- | --- |
| `revenuePerDay` | **120 latinum/day** | against 13–28/day of upkeep for four hulls (mass 2 and 7 at `hullUpkeepPerMass: 1`); 30% of one world's base revenue |
| `materialsPerDay` | **1 duranium/day** | the same as one controlled world's mining |
| `supply` | **0.6** | one outpost sustains more than the no-supply floor (0.35) and much less than a supplied power (1.0) |
| `replaceDays` | **60 days** | one hull at a time, never past the authored four, and it must pay the yard price (18,000 for an attack ship, 245,000 for a battlecruiser) |

All four are tied to the outpost: destroy station `28-901` and the income, the supply and the
replacements all stop. **These four numbers are for sign-off.**

### 4. the Dominion entry is an opening, not a date

Three commits now. The first moved the arc to a fixed 180/260/320 window, which stopped the reported
behaviour but is not what §3.1 asks for. The second removed the window. The third is the repair round
above. `dominionReconDay`, `dominionStagingDay`, `dominionInvasionDay` and `dominionEarliestDay` all no
longer exist: **there is no campaign day anywhere in the expedition's rules.**

`dominionOpportunity(book, world, day)` decides whether there is an opening, and reports why not. All
of the following must hold:

| Condition | Read from | Threshold |
| --- | --- | --- |
| a central war that has cost its belligerents something | a per-pair **war ledger** (`book.wars`) counting engagements that produced losses or a capture — kept because the operation list is trimmed | 20 engagements |
| a near-side power materially below its own capacity | `readiness / max(readinessBaseline, readinessPeak)`; the peak is recorded daily, so a player empire that started with nothing still has a capacity | ≤ 0.65 |
| ...and economically strained with it | the worst of `revenue`, `treasury` and `berths` against that polity's own high-water mark for each | ≤ 0.75 |
| a balance the expedition can exploit | either a costly stalemate — both belligerents worn down, bounded strength difference, and a front that has stopped moving — or a victor too weakened to hold the door | gap ≤ 0.5; victor ≤ 0.6 |
| nobody on this side still standing tall enough to make the crossing pointless | the strongest **contender** against what the Dominion can bring; contenders are every polity holding ground within 8 route-hops of the entry, the central belligerents, and the player | ≤ 1.5× its reach |
| a corridor nobody has closed | defence at the entry against the Dominion's own reach, never against the defender's size, so a garrison cannot inflate the yardstick it is judged by | ≥ 1.2× closes it |
| a captain who has been offered a game first | four bounded categories of chance offered — distinct worlds seen, completed journeys, distinct issuers of work, distinct powers dealt with — never achievements | 3 of 4 |

The case has to **hold**, not merely occur: a war's numbers move every day and one of those days will
clear every line at once. Eligibility is judged over a **bounded rolling window** — 60 of the last 90
days must have been eligible. Alternating gives half a window and half is not enough.

The stages are events, and each one has to reach the captain separately: at most one phase commits per
beat, a beat being the journey the engine is running or otherwise the day itself. Reconnaissance dwells
40 days, staging 25. At any point a near side that **recovers**, a contender that makes the crossing
unchallengeable, or a corridor somebody closes stands the expedition down where it is. Nothing expires
and nothing is forced through: there is no latest day either.

The debug phase override forces the opening rather than a timetable, so a forced phase is still entered
by the code that enters it in play.

**Tuning for sign-off:** 20 engagements, 0.65 capacity, 0.75 economic strain, 0.5 strength gap, 1.5
challenge ratio, 1.2 corridor ratio, 8 contender hops, 3 of 4 maturity categories (10 worlds, 25
journeys, 6 issuers, 3 contacts), 60 eligible days of the last 90, and 40/25-day dwells.

### 5. `0033450` — a station can be hailed without docking

A station could be *selected* as a target, but the HAIL control and the `H` key both went to the
ship-only path and answered "No ship selected to hail". The only ways into a station's channel were the
COMMS list and docking, which is what the playtest reported as "you still can't hail stations unless
docked".

Hail now opens a selected station's channel; with nothing selected it opens the nearest station's
channel list rather than refusing; a ship hail is unchanged. The security-clearance and standing
refusals still apply and still state their reason — `openRemoteStationShop` already did that.

### 6. `6d1cb6e` — a world's people and its government are two different facts

Bajor under a Dominion flag read as "Dominion space" on the planet card and "Dominion controlled" on
the map. `getSystemSovereignty(index)` reports both, on a ladder built from state the campaign already
keeps rather than a new mechanic:

| Level | What it means | What it is read from |
| --- | --- | --- |
| `independent` | governed by its own people | controller equals origin |
| `unclaimed` | no people and no government | neither |
| `colony` | a holding on a world with no people of its own | controller set, origin none |
| `occupied` | taken, and still suppressed | `book.occupations[i]` younger than `occupationIntegrationDays` |
| `administered` | taken, output recovered, industry not integrated | occupation older than that, or an authored foreign administration with no capture day |
| `annexed` | the holder has integrated the industry and taken the designs | `integrations[i].completedDay` |

`contested` is an orthogonal flag from an engaged operation over the system. The planet card and the
map readout both print people and government, and the map legend gives the line its own row.

**This is a first layer, not §3.2.** It reports culture and controller. It does not yet carry a separate
`sovereignId`, an `administration` record, an integration percentage, per-installation `assetOwnerId` /
`commandSideId`, the seven named control stages, or the multi-colour map symbology.

### 7. the model and in-game suites stop depending on when the expedition sails

Two commits' worth. Checks that had a schedule baked into their windows now either take the window from
the book's own rules or author the strategic state they need, so a tuning change moves the campaign
without moving the checks. Where a gate needs an expedition to exist inside a short window and is not
itself about the unlock, it says so in a comment and relaxes the opening deliberately.

### Gates

**35 of 35 green**, run from the committed tree this pack ships. `validation/RUN.json` and
`validation/RUN-FILES.txt` record which commit, which tree, and a hash of every git-tracked file and
every file under `dist/`, written before the first gate rather than inferred afterwards.

`playtest-gate` is 20 adversarial checks and **all twenty reproduce on `ae4ae4d`** — see
`validation/playtest-baseline-ae4ae4d.log`.

| Check | What it reproduces on `ae4ae4d` |
| --- | --- |
| DOM-1 | the Other Powers table listed the Dominion at a fresh start |
| DOM-2 | charting one hidden world presented the whole region's true strength as a total |
| DOM-3 | a near-side capture handed the expedition's war to the neighbour roll |
| DOM-4 | the expedition ran on a date, and sixty warp-days in it had already invaded |
| DOM-5 | 200 days of the roll settled the expedition's war with Earth |
| DOM-6 | one long jump carried the whole arc past the captain in a single briefing |
| DOM-7 | the maturity gate could be satisfied by cycling one menu at one station |
| DOM-8 | one warp counted as two journeys, and a zero-day call counted as one |
| REM-1 | there was no Blender remnant at all |
| REM-2 | the remnant drew from the whole Dominion pool |
| REM-3 | the remnant could not pay its upkeep and never replaced a loss |
| HAIL | a selected station answered "No ship selected to hail" |
| CULT | the planet card and map named only the controller |
| HUD | the quick-action bar carried eight actions and had neither FLEET nor EW |
| HUD-2 | there was no FLEET button to open the fleet manager |
| TOP | the alert readout opened the game menu and power was behind a panel that covers the view |
| OWN | the captain's own yard answered "Terran ports refuse you. Standing -100" |
| MISSION | an evacuation contract was offered with nothing behind it |
| CULT-2 | no world had a people it could name; Sonata read "Unclaimed world · no government" |
| LAYOUT | the posture pill cut at every width, 250px past the strip's edge at 1000, two rows across the menu and the minimap below 900 |

Nine of the twenty check something the parent tree has no notion of at all — the remnant, the entry
decision, the maturity gate, the journey count, a world's people, a vendor being the captain's own —
so on `ae4ae4d` they reproduce by reporting that absence rather than a wrong behaviour. **Every one of
the twenty says what is wrong in its own words**, and none of them fails as a TypeError: three still
did in `b26f97b` (`t.isDominionCoreSystem is not a function`, `t.getAlertStatus is not a function`),
which is a stack trace rather than evidence, and they now ask the tree whether it has the thing before
reaching for it. The other eleven reproduce the behaviour itself.

`LAYOUT`'s baseline is the whole complaint in measurements, which is why it is worth reading in full
in the baseline log: *"at 1100px the strip runs past its own right edge: LAT900 by 70px; STD20 by
150px; ... at 860px the strip wraps onto 2 rows; at 860px a readout is cut off: FLIGHT · RED cut by
10px; at 860px the strip sits across the menu block; at 860px the strip sits across the minimap"*.

`dominion-matrix` is the §9 evidence for the entry decision: **432 rows** varying calendar age (1, 119,
120, 121, 800, 2,000) independently of war history, corridor state, third-party power and war economy,
printing the decision and its reason for every row, with **13 invariants** checked. The whole table is
in `validation/dominion-matrix.log`; it does not run at all on `ae4ae4d`.

The invariants, named:

1. calendar age is not an input, at every age including where a floor used to be
2. a quiet galaxy never opens, however old it gets
3. fighting without cost is not an opening; fighting that wore both sides down is
4. a front that is still moving is not a stalemate
5. a victor that is still standing closes the opening; a wrecked one presents it
6. a fortified entry closes the corridor whatever the war did
7. a solvent war economy closes the opening that a bankrupt one presents
8. a strong power several jumps away is a contender, and closes the opening
9. a player empire that has become the strongest power here delays the opening
10. contender membership is decided at the configured hop count, not near it
11. at the shipped limit, a navy at eight hops is a contender and one at nine is not
12. the opening waits on chances offered to the captain, and no single action can supply them
13. a condition that alternates never unlocks the arc, however long it alternates

Four of the repairs in this candidate were caught by gates rather than by inspection: the beat check
was captured once per day instead of re-read after each commit, so all three stages still cascaded
(DOM-6); counting station missions into the maturity total made the same sixteen days decide
differently stepped and jumped (EQUIV); counting journeys put a per-journey number into the persisted
campaign digest, so forty one-day journeys and one forty-day journey produced different books (the
campaign probe's daily-versus-chunked check); and the matrix's own fixture stopped satisfying the new
category gate the moment it changed.

`validation/gate-exit-codes.txt` records each gate's root honestly: `src` means it imports the source
modules directly, `dist` means it loaded the built tree.

### Against the 17SEP specification, section by section

Where it says NOT DONE, nothing exists: no stub, no scaffolding.

**§3.3 faction-blind war goals and bilateral peace is still NOT DONE, and this matters more than it
did.** The premature Terran–Dominion peace is prevented by locking the expedition out of ordinary
diplomacy, which means the Dominion currently cannot negotiate the later, properly justified settlement
either. There is no bilateral acceptance, no persisted war goals, no minimum time and engagement gates
for negotiation, no economic exhaustion input, no protected capitals, and no distinction between
ceasefire, armistice, negotiated peace, withdrawal, capitulation and strategic victory. The war ledger
added for the Dominion opening — engagements, losses and captures per belligerent pair, surviving the
operation list being trimmed — is the input that section will need, and it is now there.

**§3.1 Dominion opening** — **done.** No date, no deadline, no floor; entry emerges from the central
war's engagement history, the economic damage it did, the balance it produced, who can still answer a
crossing, whether the corridor is held, and whether the captain has been offered a game. What is *not*
done from §3.1's list: player-intervention effects are only those that fall out of the general rules
(keeping the near side's capacity up, keeping its economy working, fortifying the corridor, becoming a
contender) rather than a separately modelled set; and the warning texts still say what they said,
though they no longer name Dominion Central as fact before contact.

**§3.1 identity split** — `shipFaction` and `diplomacyId` are not separated; `dominion_remnant` and
`dominion` are separate polities and separate diplomacy, but the split is not the general mechanism the
specification describes. Save migration of an ambiguous `dominion` peace is not handled.

**§3.2 sovereignty layers** — `sovereignId`, `administration`, `controlStage` with integration
percentage, `assetOwnerId`, `commandSideId`, the seven named stages, installation ownership through
occupation, incident-evidence jurisdiction, distinct independent polity identities (New Switzerland vs
Orilla), and the multi-colour map symbology. What is here is culture-plus-controller on one line.

**§3.3 faction-blind war goals and bilateral peace** — the whole section. No persisted war goals, no
willingness/settlement split, no two-sided acceptance, no time-plus-material gates, no distinct
ceasefire/armistice/peace/withdrawal/capitulation/strategic-victory outcomes. `resolveCentralWar` is
still the single authored Earth–Klingon resolution it was.

**§3.4 cargo capacity and contract economy** — no capacity ladder, no fit-to-free-capacity rule, no
per-ton curve, no before/after table.

**§3.5 uninhabited worlds** — zero-population planets still trade and still generate contracts. No
UNINHABITED badge. What did change: the ten worlds that now have no people all have a population of
zero, so the set this section will act on is at least identified.

**§3.6 bottom HUD and modals** — **partly done.** The bar is now ten buttons in the specified order
with FLEET and EW, one label each, and the duplicated expanded label is gone; power and alert posture
moved into the top strip where they can be reached in a fight; the strip is verified at six widths and
screenshots are in `validation/screens/` at 1600, 1000 and 600. Still untouched: the modal sticky
header, the 44×44 close target, scroll reset on open, and the multi-press close.

**§4 fleet trading, §5 recall and rendezvous, §6 fleet repair UX, §7 living trade-route overlay** — none
of it.

**§9 validation** — the campaign matrix for the entry decision is done (432 rows, 13 invariants) and
HUD screenshots at three widths and a planet card are in `validation/screens/`. Still missing: the
seeded economy table and the fleet-trade fixtures.

**Evacuation and blockade contracts** — NOT DONE as mechanics, and now withdrawn rather than offered
with nothing behind them. Pulling a contract that does nothing is not implementing it.
