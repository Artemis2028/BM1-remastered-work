# Finite economy — long-horizon measurements

DTG 202006ZSEP26 · against this candidate · **driven through the engine, not modelled**

Review: *"Do not change the 12-day shipment regeneration yet. Instrument job-book occupancy, age and
rejection reasons by risk level at 300/1000/3000 days so we know why shipment work dries up. Keep the
current route/hazard fee once + 20 L/t payout for actual playtesting. Add the 5t starter hull to
Safe/Cautious/Risky/Any measurements before deciding whether courier fees need scaling."*

Everything below is what the engine did. The script starts a campaign, learns thirty worlds, puts fleet
traders to work and advances the calendar day by day, reading the same shelves, the same books of work
and the same danger the captain would. `scripts/economy-measure.cjs`; the suite runs it to 1,200 days
for time, and the tables here are the full 5,000-day pass.

**What changed since the last tables:** nothing in the economy. The payout, the holds (bar the
Concord, now an authored 1,320) and the regeneration are as `8ce4c4d` left them. The script now reads
the books of work, runs the five-ton hull through the four danger settings, and a reposition with
nothing at the other end no longer happens. Two things in the numbers moved because of that last one
and are called out where they appear.

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
| starter ship     | 5    | 500     | 300  | 275     | 1     | 11       | 25        | 100%      | 0           | 455           | 300      | 3%   | 545          |
| starter ship     | 5    | 500     | 1000 | 850     | 1     | 36       | 24        | 100%      | 0           | 1,470         | 1,000    | 2%   | 588          |
| starter ship     | 5    | 500     | 3000 | 2,560   | 1     | 106      | 24        | 100%      | 0           | 4,345         | 3,000    | 1%   | 586          |
| starter ship     | 5    | 500     | 5000 | 4,155   | 1     | 177      | 23        | 100%      | 0           | 7,100         | 5,000    | 1%   | 602          |
| ordinary cruiser | 220  | 124,000 | 300  | 13,977  | 47    | 9        | 1,553     | 46%       | 11,922      | 4,110         | 1,500    | 0%   | 2662         |
| ordinary cruiser | 220  | 124,000 | 1000 | 27,462  | 27    | 32       | 858       | 55%       | 11,922      | 26,405        | 5,000    | 0%   | 4515         |
| ordinary cruiser | 220  | 124,000 | 3000 | 65,034  | 22    | 103      | 631       | 54%       | 11,922      | 90,059        | 15,000   | 0%   | 5720         |
| ordinary cruiser | 220  | 124,000 | 5000 | 101,700 | 20    | 228      | 446       | 62%       | 11,922      | 159,516       | 25,000   | 0%   | 6096         |
| normal freighter | 1350 | 85,000  | 300  | 12,600  | 42    | 9        | 1,400     | 9%        | 10,086      | 4,798         | 1,200    | 0%   | 2024         |
| normal freighter | 1350 | 85,000  | 1000 | 26,645  | 27    | 33       | 807       | 9%        | 11,922      | 25,577        | 4,000    | 0%   | 3190         |
| normal freighter | 1350 | 85,000  | 3000 | 62,558  | 21    | 104      | 602       | 9%        | 11,922      | 87,236        | 12,000   | 1%   | 4076         |
| normal freighter | 1350 | 85,000  | 5000 | 98,491  | 20    | 175      | 563       | 9%        | 11,922      | 148,357       | 20,000   | 1%   | 4315         |
| heavy freighter  | 3500 | 180,000 | 300  | 12,721  | 42    | 10       | 1,272     | 3%        | 10,086      | 5,127         | 1,800    | 0%   | 4245         |
| heavy freighter  | 3500 | 180,000 | 1000 | 25,563  | 26    | 34       | 752       | 3%        | 11,922      | 24,301        | 6,000    | 2%   | 7041         |
| heavy freighter  | 3500 | 180,000 | 3000 | 61,905  | 21    | 105      | 590       | 3%        | 11,922      | 87,107        | 18,000   | 1%   | 8723         |
| heavy freighter  | 3500 | 180,000 | 5000 | 100,325 | 20    | 173      | 580       | 3%        | 11,922      | 151,585       | 30,000   | 1%   | 8971         |


### The same heavy freighter with nobody repairing her

| days | net L  | circuits | hull left | idle | stopped on day |
| ---- | ------ | -------- | --------- | ---- | -------------- |
| 300  | 14,298 | 9        | 37%       | 0%   | still going    |
| 1000 | 16,729 | 14       | 5%        | 55%  | 453            |
| 3000 | 16,729 | 14       | 5%        | 85%  | 453            |
| 5000 | 16,729 | 14       | 5%        | 91%  | 453            |


### Danger setting, one maintained heavy freighter

| setting  | 300d net L | 1000d net L | 3000d net L | 5000d net L | circuits at 5000 | hull left | idle at 5000 |
| -------- | ---------- | ----------- | ----------- | ----------- | ---------------- | --------- | ------------ |
| safe     | 12,432     | 25,586      | 58,521      | 91,439      | 180              | 100%      | 2%           |
| cautious | 12,087     | 26,803      | 60,144      | 98,416      | 173              | 67%       | 1%           |
| risky    | 6,236      | 20,173      | 56,707      | 92,222      | 32               | 18%       | 0%           |
| any      | 6,236      | 15,625      | 58,165      | 86,352      | 29               | 100%      | 0%           |


### Danger setting, one maintained starter ship (5 t)

| setting  | 300d net L | 1000d net L | 3000d net L | 5000d net L | circuits at 5000 | shipments delivered | hull left | idle at 5000 |
| -------- | ---------- | ----------- | ----------- | ----------- | ---------------- | ------------------- | --------- | ------------ |
| safe     | 275        | 755         | 2,295       | 3,900       | 177              | 0                   | 84%       | 1%           |
| cautious | 265        | 805         | 2,415       | 4,075       | 177              | 0                   | 100%      | 1%           |
| risky    | 47         | 168         | 4,999       | 11,392      | 90               | 8                   | 100%      | 0%           |
| any      | 47         | 4,300       | 9,670       | 13,257      | 87               | 9                   | 100%      | 0%           |


### The books of work, by danger setting (seeded worlds only; a world nobody has looked at is not seeded)

| hull            | setting  | day  | seeded/trading | occupancy | full | empty | open | age med / p90 / max | ok  | danger | unreported | no-route | refusal | too-big | no-room | aboard/hold | delivered | last delivery |
| --------------- | -------- | ---- | -------------- | --------- | ---- | ----- | ---- | ------------------- | --- | ------ | ---------- | -------- | ------- | ------- | ------- | ----------- | --------- | ------------- |
| heavy freighter | safe     | 300  | 8/90           | 97%       | 7    | 0     | 28   | 191 / 299 / 299     | 4%  | 0%     | 93%        | 0%       | 4%      | 0%      | 0%      | 81/3500     | 5         | 191           |
| heavy freighter | safe     | 1000 | 8/90           | 100%      | 8    | 0     | 29   | 891 / 999 / 999     | 0%  | 0%     | 97%        | 0%       | 3%      | 0%      | 0%      | 148/3500    | 6         | 385           |
| heavy freighter | safe     | 3000 | 8/90           | 100%      | 8    | 0     | 29   | 2891 / 2999 / 2999  | 0%  | 0%     | 97%        | 0%       | 3%      | 0%      | 0%      | 56/3500     | 6         | 385           |
| heavy freighter | cautious | 300  | 8/90           | 97%       | 7    | 0     | 28   | 191 / 299 / 299     | 4%  | 0%     | 93%        | 0%       | 4%      | 0%      | 0%      | 81/3500     | 5         | 211           |
| heavy freighter | cautious | 1000 | 8/90           | 100%      | 8    | 0     | 29   | 891 / 999 / 999     | 0%  | 0%     | 97%        | 0%       | 3%      | 0%      | 0%      | 48/3500     | 6         | 365           |
| heavy freighter | cautious | 3000 | 8/90           | 100%      | 8    | 0     | 29   | 2891 / 2999 / 2999  | 0%  | 0%     | 97%        | 0%       | 3%      | 0%      | 0%      | 81/3500     | 6         | 365           |
| heavy freighter | risky    | 300  | 42/90          | 98%       | 41   | 0     | 130  | 127 / 127 / 299     | 94% | 0%     | 0%         | 0%       | 6%      | 0%      | 0%      | 90/3500     | 2         | 90            |
| heavy freighter | risky    | 1000 | 42/90          | 97%       | 40   | 2     | 129  | 827 / 827 / 999     | 93% | 0%     | 0%         | 0%       | 7%      | 0%      | 0%      | 31/3500     | 7         | 943           |
| heavy freighter | risky    | 3000 | 42/90          | 92%       | 37   | 0     | 123  | 2827 / 2827 / 2932  | 82% | 9%     | 0%         | 0%       | 9%      | 0%      | 0%      | 161/3500    | 23        | 2994          |
| heavy freighter | any      | 300  | 42/90          | 98%       | 41   | 0     | 130  | 127 / 127 / 299     | 94% | 0%     | 0%         | 0%       | 6%      | 0%      | 0%      | 90/3500     | 2         | 90            |
| heavy freighter | any      | 1000 | 42/90          | 97%       | 40   | 0     | 129  | 827 / 827 / 999     | 94% | 0%     | 0%         | 0%       | 6%      | 0%      | 0%      | 81/3500     | 5         | 758           |
| heavy freighter | any      | 3000 | 42/90          | 98%       | 41   | 1     | 130  | 2827 / 2827 / 2999  | 93% | 0%     | 0%         | 0%       | 7%      | 0%      | 0%      | 149/3500    | 24        | 2987          |
| starter ship    | safe     | 300  | 5/90           | 100%      | 5    | 0     | 21   | 274 / 299 / 299     | 0%  | 0%     | 71%        | 0%       | 5%      | 24%     | 0%      | 5/5         | 0         | -             |
| starter ship    | safe     | 1000 | 9/90           | 100%      | 9    | 0     | 31   | 952 / 999 / 999     | 0%  | 0%     | 81%        | 0%       | 3%      | 16%     | 0%      | 5/5         | 0         | -             |
| starter ship    | safe     | 3000 | 9/90           | 100%      | 9    | 0     | 31   | 2952 / 2999 / 2999  | 0%  | 10%    | 81%        | 0%       | 3%      | 6%      | 0%      | 5/5         | 0         | -             |
| starter ship    | cautious | 300  | 5/90           | 100%      | 5    | 0     | 21   | 274 / 299 / 299     | 0%  | 0%     | 71%        | 0%       | 5%      | 24%     | 0%      | 5/5         | 0         | -             |
| starter ship    | cautious | 1000 | 9/90           | 100%      | 9    | 0     | 31   | 952 / 999 / 999     | 0%  | 0%     | 81%        | 0%       | 3%      | 16%     | 0%      | 5/5         | 0         | -             |
| starter ship    | cautious | 3000 | 9/90           | 100%      | 9    | 0     | 31   | 2952 / 2999 / 2999  | 0%  | 0%     | 81%        | 0%       | 3%      | 16%     | 0%      | 5/5         | 0         | -             |
| starter ship    | risky    | 300  | 42/90          | 99%       | 41   | 0     | 132  | 253 / 253 / 299     | 0%  | 0%     | 0%         | 0%       | 6%      | 71%     | 23%     | 5/5         | 0         | -             |
| starter ship    | risky    | 1000 | 42/90          | 100%      | 42   | 0     | 133  | 953 / 953 / 999     | 0%  | 8%     | 0%         | 0%       | 6%      | 65%     | 20%     | 5/5         | 0         | -             |
| starter ship    | risky    | 3000 | 42/90          | 100%      | 42   | 0     | 133  | 2953 / 2953 / 2999  | 0%  | 0%     | 0%         | 0%       | 6%      | 77%     | 17%     | 5/5         | 3         | 1883          |
| starter ship    | any      | 300  | 42/90          | 99%       | 41   | 0     | 132  | 253 / 253 / 299     | 0%  | 0%     | 0%         | 0%       | 6%      | 71%     | 23%     | 5/5         | 0         | -             |
| starter ship    | any      | 1000 | 42/90          | 98%       | 39   | 0     | 130  | 953 / 953 / 999     | 0%  | 0%     | 0%         | 0%       | 6%      | 74%     | 20%     | 5/5         | 3         | 832           |
| starter ship    | any      | 3000 | 42/90          | 100%      | 42   | 0     | 133  | 2953 / 2953 / 2999  | 0%  | 0%     | 0%         | 0%       | 6%      | 80%     | 14%     | 5/5         | 6         | 1950          |


### Several heavy freighters on one economy

| traders | 300d each | 1000d each | 3000d each | 5000d each | circuits each at 5000 | idle each at 5000 |
| ------- | --------- | ---------- | ---------- | ---------- | --------------------- | ----------------- |
| 1       | 10,780    | 26,459     | 62,027     | 99,683     | 179                   | 1%                |
| 2       | 9,446     | 22,220     | 54,075     | 84,444     | 171                   | 1%                |
| 4       | 7,083     | 17,063     | 43,965     | 70,394     | 166                   | 1%                |

---

## What the numbers say

### 1. Nothing new in the economy itself

One maintained trader on Cautious is where it was: a cruiser makes 27,462 at a thousand days and about
100,000 at five thousand; the 1,350-ton and 3,500-ton freighters about the same; shipment income
11,922 for all three and then nothing more. Payback four to nine thousand days. The Concord's hold
does not appear in these runs (the heavy freighter is the Isaac), and utilisation at 56% / 9% / 3–4%
says a 1,320-ton hold would not change them either.

### 2. Why shipment work dries up — it is not regeneration

The books are **92–100% full at every horizon and every setting**, and what is on them is old: the
median open shipment at day 3,000 was generated around day 100. The regeneration rate is not the limit,
because the books are never short of work. The trader is passing it over, and the instrument says
why:

**Safe and Cautious.** The trader opens the books of **eight of ninety** worlds over five thousand
days, and **93–97% of what is on them is `unreported`** — the route to the destination crosses a
system the captain has no condition report for, and those two settings do not fly such a route.
Deliverable work is 4% of the open board at day 300 and **0% from day 1,000**. The last shipment is
delivered on **day 385** (Safe) or **365** (Cautious), and everything a Cautious trader earns after
that is commodity trading. This is why shipment income froze at 11,922 in every Cautious run in the
previous round: after about a year there was nothing left that a Cautious trader was allowed to carry.

**Risky and Any.** Forty-two worlds' books opened; **93–94% of open work is deliverable**. Twenty-three
or twenty-four shipments delivered by day 3,000, against six under Cautious. The limit here is
**transit time**: a leg across this map runs to sixty-odd days, a four-call circuit to a hundred and
eighty, and the heavy freighter completes twenty-nine to thirty-two circuits in five thousand days
under these settings against a hundred and seventy-three to a hundred and eighty under Safe and
Cautious, whose circuits are short commodity runs between the same eight worlds. `refusal` accounts
for the other 6–9%.

**So the reason is the intelligence model, not the books.** Safe and Cautious traders can only carry
shipments along routes the captain has reports on, and the captain in these runs has reports on very
little. A captain who reads the conditions of more of the map would open more of it to their traders.
That is a design fact worth knowing before anyone touches the regeneration rate or the payout, and it
is not a fault: it is the danger setting doing what it says.

### 3. The five-ton hull

| setting | 5,000d net | circuits | shipments delivered | what stops it |
| --- | --- | --- | --- | --- |
| Safe | 3,900 | 177 | 0 | 71–81% of open work `unreported`, the rest `too-big` |
| Cautious | 4,075 | 177 | 0 | the same |
| Risky | 11,392 | 90 | 8 | 65–80% `too-big`, 14–23% `no-room` |
| Any | 13,257 | 87 | 9 | 71–80% `too-big`, 14–23% `no-room` |

Under Safe and Cautious it never delivers a shipment and earns what it earned before, all of it
commodity trading. Under Risky and Any it delivers eight or nine over five thousand days and earns three
times as much — those are the courier lots, taken when the hold happens to be empty and one is on the
board. The rest of the board is either physically too big for the hull or blocked by the five tons of
the last commodity lot still aboard (`aboard/hold` reads `5/5` at every snapshot).

**On whether courier fees need scaling:** the five-ton hull's problem is not what a courier lot pays.
It is that, at the settings a new captain would use, there is nothing on any reachable board it may
carry, and at the settings where there is, its hold is full of the last thing it bought. A courier lot
at 1,680 latinum a ton of hold is not distorting anything here, because the hull that would take it
takes nine in five thousand days.

### 4. A trader that bounced

The previous round's rule — every dead end in the planner is a move — had a hole: a move to a world
with nothing at the other end. The five-ton hull at Any risk showed it — **192 circuits between days
1,136 and 5,000 that moved no money**, as it repositioned toward "work" that its hull could not hold
and then repositioned again. The reposition now counts as work only a shipment her hull can hold, and
with no reason to go anywhere — no shipper's world, no buyer, no work — she holds where she is and the
panel says why. The same run now reads 87 circuits, nine shipments, 13,257 latinum and 0% idle. The
heavy freighter under Safe and Cautious picked up one to two per cent idle from the same rule, which
is what a trader holding for a reason looks like.

### 5. The danger settings, still not tuned

Heavy freighter at five thousand days: Safe 91,439, Cautious 98,416, Risky 92,222, Any 86,352 — a
spread of **1.14×**, flat. The runs still repair the trader for free, so this remains not a net-profit
comparison; the unmaintained row is the standing reminder (stopped on day 580). Nothing to decide here
until §6 gives repair a cost.

### 6. Competition

One heavy freighter makes 99,683 over five thousand days; two make 84,444 each; four make 70,394 each,
all at about 1% idle. Two traders crowd one another a little now that neither can bounce.

---

## What I would ask about

1. **Whether a Safe or Cautious trader should be able to carry a shipment along a route the captain
   has not reported on.** That single rule is why shipment work is 0% deliverable for them after a
   year. It is the intelligence model working as designed; it may also be more restrictive than a
   player expects from a dropdown that says "Cautious".
2. **Regeneration is not the limit** and there is no reason in these tables to change it.
3. **Courier fees need no scaling on this evidence.** The five-ton hull is limited by what it may reach
   and by its own leftover cargo, not by what a courier pays.
4. **Nothing in the economy moved this round**, and if that is what review needed to see, §4 can close
   on this candidate.
