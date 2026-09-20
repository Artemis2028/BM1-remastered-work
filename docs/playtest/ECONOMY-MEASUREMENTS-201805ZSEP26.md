# Finite economy — long-horizon measurements

DTG 201805ZSEP26 · against this candidate · **driven through the engine, not modelled**

Review: *"Contract payout: replace the current 416-620 L/ton behavior with `route/hazard fee once +
~20 L/ton` as the first measurement pass. Rerun the same 300/1000/3000/5000-day tables before locking
it. Do not tune Safe/Cautious/Risky/Any yet."*

Everything below is what the engine did. The script starts a campaign, learns thirty worlds, puts fleet
traders to work and advances the calendar day by day, reading the same shelves, the same books of work
and the same danger the captain would. `scripts/economy-measure.cjs`; the suite runs it to 1,200 days
for time, and the tables here are the full 5,000-day pass.

**What changed since the last tables:** the contract payout's shape, the fourteen reduced warship holds,
and the narrowed rule for which installations give a world an economy. **Nothing else is tuned** — no
margin, no replenishment rate, no ship price, and none of the four danger settings.

## Two corrections to the measuring instrument itself

Both were found by these runs and both are fixed here, because without them the tables would have been
reporting something other than what they claim.

**"Maintained" was not maintaining.** The repair loop restored the trader's fleet record and not its
local actor, and the engine reads the local actor first — so a disabled trader stayed disabled while the
run went on calling her maintained. Her circuits and income froze on the day she was hit and her idle
time climbed to ninety per cent. Fixed; the maintained runs now sit at **0% idle** across every hull and
every horizon, which is what "maintained" was always supposed to mean.

**Two permanent stalls in the planner, found by the long horizons and fixed in this candidate.** A
trader standing at a world that deals with her but has nothing she can do was told "No plottable route
to those destinations" and left there — 4,342 idle days out of 5,000 at Any risk. And a trader whose
hold was full of cargo nobody nearby was buying could not plan, so never went anywhere, so nobody ever
bought it — nine tenths of a campaign, for the five-ton hull. Every dead end in the planner now moves
her on to a world where she can work, preferring one that is buying what she is already carrying. Both
are gated (`CIRCUIT-6`, `CIRCUIT-7`).

---

## The tables
Driven through the engine, not modelled. 101 worlds: **90 with an economy**, **11 without one** (Gorn, Denmark, Iconia, Konael, Harman, Kardon, Aldnas, Elderea, Xindus, Sato, Nexus). Population across the living worlds (min / p25 / median / p75 / max): **500 / 3900 / 5400 / 7600 / 50000**.

### What a world carries and hires for (min / median / max)

| size   | worlds | example         | tons per good   | demand per good | replenish t/day | open jobs |
| ------ | ------ | --------------- | --------------- | --------------- | --------------- | --------- |
| small  | 31     | T-Rogoran Annex | 10 / 53 / 70    | 8 / 42 / 56     | 1 / 3 / 4       | 1 / 2 / 3 |
| medium | 30     | Iritum          | 71 / 83 / 99    | 57 / 66 / 79    | 4 / 4 / 5       | 3 / 3 / 4 |
| major  | 29     | Hof-Maso        | 100 / 117 / 220 | 80 / 94 / 176   | 5 / 6 / 11      | 4 / 4 / 6 |

Shipments on the board (n / min / p25 / median / p75 / max): tonnage **136 / 1 / 5 / 33 / 56 / 154**, whole price **505 / 1528 / 2035 / 2702 / 5561 L**, of which the once-paid route and hazard fee is **421 / 925 / 1358 / 1803 / 2780 L**. What a trader actually compares — price over the hold it takes — is **24 / 42 / 60 / 212 / 1680 L per ton of hold**. 33 of 136 are courier lots.

### One maintained trader, Cautious

| hull             | hold | price   | days | net L   | L/day | circuits | L/circuit | hold used | shipments L | commodities L | upkeep L | idle | payback days |
| ---------------- | ---- | ------- | ---- | ------- | ----- | -------- | --------- | --------- | ----------- | ------------- | -------- | ---- | ------------ |
| starter ship     | 5    | 500     | 300  | 270     | 1     | 12       | 23        | 97%       | 0           | 440           | 300      | 0%   | 556          |
| starter ship     | 5    | 500     | 1000 | 800     | 1     | 39       | 21        | 98%       | 0           | 1,410         | 1,000    | 0%   | 625          |
| starter ship     | 5    | 500     | 3000 | 2,370   | 1     | 111      | 21        | 99%       | 0           | 4,065         | 3,000    | 0%   | 633          |
| starter ship     | 5    | 500     | 5000 | 4,095   | 1     | 182      | 23        | 99%       | 0           | 6,955         | 5,000    | 0%   | 611          |
| ordinary cruiser | 220  | 124,000 | 300  | 13,977  | 47    | 9        | 1,553     | 46%       | 11,922      | 4,110         | 1,500    | 0%   | 2662         |
| ordinary cruiser | 220  | 124,000 | 1000 | 27,462  | 27    | 32       | 858       | 55%       | 11,922      | 26,405        | 5,000    | 0%   | 4515         |
| ordinary cruiser | 220  | 124,000 | 3000 | 65,298  | 22    | 104      | 628       | 54%       | 11,922      | 90,356        | 15,000   | 0%   | 5697         |
| ordinary cruiser | 220  | 124,000 | 5000 | 100,369 | 20    | 173      | 580       | 56%       | 11,922      | 150,691       | 25,000   | 0%   | 6177         |
| normal freighter | 1350 | 85,000  | 300  | 12,600  | 42    | 9        | 1,400     | 9%        | 10,086      | 4,798         | 1,200    | 0%   | 2024         |
| normal freighter | 1350 | 85,000  | 1000 | 26,645  | 27    | 33       | 807       | 9%        | 11,922      | 25,577        | 4,000    | 0%   | 3190         |
| normal freighter | 1350 | 85,000  | 3000 | 61,704  | 21    | 107      | 577       | 9%        | 11,922      | 85,908        | 12,000   | 0%   | 4133         |
| normal freighter | 1350 | 85,000  | 5000 | 96,514  | 19    | 178      | 542       | 9%        | 11,922      | 145,680       | 20,000   | 0%   | 4404         |
| heavy freighter  | 3500 | 180,000 | 300  | 12,721  | 42    | 10       | 1,272     | 3%        | 10,086      | 5,127         | 1,800    | 0%   | 4245         |
| heavy freighter  | 3500 | 180,000 | 1000 | 24,976  | 25    | 36       | 694       | 3%        | 11,922      | 23,788        | 6,000    | 0%   | 7207         |
| heavy freighter  | 3500 | 180,000 | 3000 | 62,494  | 21    | 103      | 607       | 4%        | 11,922      | 87,948        | 18,000   | 0%   | 8641         |
| heavy freighter  | 3500 | 180,000 | 5000 | 96,926  | 19    | 172      | 564       | 4%        | 11,922      | 147,545       | 30,000   | 0%   | 9285         |


### The same heavy freighter with nobody repairing her

| days | net L  | circuits | hull left | idle | stopped on day |
| ---- | ------ | -------- | --------- | ---- | -------------- |
| 300  | 14,298 | 9        | 37%       | 0%   | still going    |
| 1000 | 19,233 | 20       | 2%        | 42%  | 580            |
| 3000 | 19,233 | 20       | 2%        | 81%  | 580            |
| 5000 | 19,233 | 20       | 2%        | 88%  | 580            |


### Danger setting, one maintained heavy freighter

| setting  | 300d net L | 1000d net L | 3000d net L | 5000d net L | circuits at 5000 | hull left | idle at 5000 |
| -------- | ---------- | ----------- | ----------- | ----------- | ---------------- | --------- | ------------ |
| safe     | 13,095     | 23,645      | 51,887      | 81,137      | 196              | 100%      | 0%           |
| cautious | 12,456     | 26,138      | 59,779      | 95,618      | 179              | 25%       | 0%           |
| risky    | 8,274      | 19,427      | 61,649      | 109,567     | 34               | 55%       | 0%           |
| any      | 8,274      | 21,306      | 60,828      | 116,591     | 32               | 82%       | 0%           |


### Several heavy freighters on one economy

| traders | 300d each | 1000d each | 3000d each | 5000d each | circuits each at 5000 | idle each at 5000 |
| ------- | --------- | ---------- | ---------- | ---------- | --------------------- | ----------------- |
| 1       | 10,780    | 26,459     | 56,377     | 91,084     | 189                   | 0%                |
| 2       | 9,446     | 21,752     | 53,935     | 91,458     | 182                   | 0%                |
| 4       | 6,922     | 15,568     | 40,902     | 72,042     | 178                   | 0%                |

---

## What the numbers say

### 1. The payout is cut by about nine times, and the shape is right

Like for like at a thousand days, one maintained trader on Cautious, same script, same seeds:

| hull | `4008e24` net | this candidate | shipments then | shipments now | commodities then | commodities now |
| --- | --- | --- | --- | --- | --- | --- |
| ordinary cruiser (220 t) | 239,054 | **27,462** | 223,760 | **11,922** | 29,313 | 26,405 |
| normal freighter (1,350 t) | 238,136 | **26,645** | 223,760 | **11,922** | 28,041 | 25,577 |
| heavy freighter (3,500 t) | 239,507 | **24,976** | 223,760 | **11,922** | 30,063 | 23,788 |

Shipment income falls by **nineteen times**; commodity income is barely touched. The number of
shipments actually delivered did not change much — about six to eight in a thousand days, then and now
— so this is a price change, not a scarcity change. **The economy is now commodity-led**: at a thousand
days a cruiser books 26,405 of commodities against 11,922 of shipments, where on `4008e24` it was
223,760 against 29,313.

A shipment's whole price now runs 505 to 5,561 latinum (median 2,035), of which the once-paid route and
hazard fee is 421 to 2,780. On `4008e24` the same board read 2,500 to 95,480 — a single 98-ton job paid
58,800, which is more than a Steamrunner costs.

### 2. Shipment income still saturates, exactly as it did before

11,922 latinum of shipment income, and then nothing more, for every hull at every horizon past a
thousand days. That is not new and it is not the payout: `4008e24` saturated at 223,760 in the same
way. A world's book regenerates one shipment every twelve days and a trader works a handful of worlds,
so the pool empties and stays empty while commodity shelves keep replenishing. **Everything above about
a thousand days is a commodity hauler's income.** If shipments are meant to stay a live part of a
long campaign, the regeneration rate is the number to look at, not the payout.

### 3. The hold is still not what limits a trader

At five thousand days the 220-ton cruiser makes 100,369, the 1,350-ton freighter 96,514 and the
3,500-ton freighter 96,926. Utilisation: 56%, 9%, 4%. The fourteen hold reductions therefore change
nothing about the balance, which is what the capacity table predicted.

### 4. Payback is long, and that is the point

2,024 to 4,245 days at three hundred days' rate, settling at 4,400 to 9,300 days over five thousand.
On `4008e24` the same hulls paid for themselves in 156 to 752 days. Review's instruction was *"do not
target 25-70k profit in 300 days"* and *"later builds made too much money"*; this is a long way the
other side of that line, and it is a number to set deliberately rather than to discover.

### 5. The five-ton hull works now, and the courier lots are only half the reason

4,095 latinum over five thousand days, 182 circuits, 99% of its hold used, 0% idle — against 1,780 and
58% idle on `4008e24`. The gain is the stall fix, not the courier work: the starter ship's shipment
income is **zero** at every horizon, because of the 64 shipments of five tons or less open on the map,
one is on a route a Cautious trader will fly. The courier lots put the work on the board; the danger
model is what keeps a small hull from reaching it.

### 6. The danger settings — reported, not tuned

Safe 81,137, Cautious 95,618, Risky 109,567, Any 116,591 at five thousand days: a spread of **1.4x**,
where `4008e24` measured four times. Two things narrowed it, neither of them a tuning decision: the
payout no longer rewards the long hauls that loose settings unlock, and the two stalls that used to
freeze Risky and Any are gone.

**These four columns are still not a net-profit comparison**, exactly as review said: the runs repair
the trader for nothing. The unmaintained row is the standing reminder — nobody maintaining her and she
is finished on day 580 with 2% hull. Real repair cost and downtime are §6, and the settings should be
judged after that exists.

### 7. Competition

One heavy freighter makes 91,084 over five thousand days; two make 91,458 **each**; four make 72,042
each, all of them at 0% idle. Two traders barely crowd one another now, where on `4008e24` a second
trader halved the first's income — because the income is commodity trading against shelves that
replenish, rather than a fixed pool of shipments to race for. Four still bite.

---

## What I would ask about

Nothing here is tuned beyond the payout's shape, which is what review asked for as a first pass.

1. **Is a nine-times cut the right size?** It is a first pass and the five constants are named in
   `TRADE_ECONOMY`. Payback at four to nine thousand days is a long way from "too much money".
2. **Shipment regeneration, not shipment pay,** is why contract income stops mattering after about a
   thousand days. One job per world per twelve days.
3. **A courier lot is worth 1,680 latinum a ton of hold** where a bulk lot is worth 24, because the
   voyage fee is paid once whatever the load. That is arguably right — a parcel charters a trip — but
   it means a tight hold should always prefer couriers, and review may want the fee scaled for very
   small shipments.
4. **The danger model, not the hold, is what shuts a small hull out.** One of 64 small shipments is on
   a route a Cautious trader will fly.

The suite regenerates these tables on every run, so any change to these numbers can be measured the same
way before it is accepted.
