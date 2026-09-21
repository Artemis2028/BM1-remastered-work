# Finite economy — long-horizon measurements

DTG 211624ZSEP26 · against this candidate · **driven through the engine, not modelled**

Review: *"Add one shared `fleetTradeRouteDays(route)` that sums `routeLegDays(route)`, and use that
same value everywhere fleet trading reasons about journey time … Do not retune turnover, payout, holds,
Cautious, or the risk bands in this repair. If that passes with the existing 37 gates/65 playtest
checks, close §4."*

Everything below is what the engine did. The script starts a campaign, learns thirty worlds, puts fleet
traders to work and advances the calendar day by day, reading the same shelves, the same books of work
and the same danger the captain would. `scripts/economy-measure.cjs`; the suite runs it to 1,200 days
for time, and the tables here are the full 5,000-day pass.

**What changed since the last tables:** only the planner's reckoning of a route's days — the sum of
its legs, each rounded up, as the calendar charges them, instead of one rounding of the total
distance. Nothing is retuned: the danger settings, the payout, the holds, courier pay, regeneration and
the 150-day lifetime are exactly as `acffccf` left them. The tables are rerun because the arithmetic
the planner ranks by changed, and what moved is reported in §6 below against the `acffccf` figures.

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
| starter ship     | 5    | 500     | 300  | 2,908   | 10    | 6        | 485       | 60%       | 2,818       | 115           | 300      | 12%  | 52           |
| starter ship     | 5    | 500     | 1000 | 8,532   | 9     | 35       | 244       | 76%       | 7,785       | 1,145         | 1,000    | 11%  | 59           |
| starter ship     | 5    | 500     | 3000 | 21,357  | 7     | 137      | 156       | 78%       | 18,267      | 5,049         | 3,000    | 16%  | 70           |
| starter ship     | 5    | 500     | 5000 | 23,362  | 5     | 161      | 145       | 80%       | 19,670      | 6,021         | 5,000    | 42%  | 107          |
| ordinary cruiser | 220  | 124,000 | 300  | 9,277   | 31    | 18       | 515       | 36%       | 5,827       | 8,657         | 1,500    | 0%   | 4010         |
| ordinary cruiser | 220  | 124,000 | 1000 | 31,979  | 32    | 76       | 421       | 40%       | 17,035      | 33,289        | 5,000    | 0%   | 3878         |
| ordinary cruiser | 220  | 124,000 | 3000 | 110,323 | 37    | 191      | 578       | 51%       | 30,403      | 150,964       | 15,000   | 0%   | 3372         |
| ordinary cruiser | 220  | 124,000 | 5000 | 196,334 | 39    | 309      | 635       | 58%       | 34,332      | 295,350       | 25,000   | 2%   | 3158         |
| normal freighter | 1350 | 85,000  | 300  | 8,523   | 28    | 4        | 2,131     | 8%        | 8,018       | 2,748         | 1,200    | 0%   | 2992         |
| normal freighter | 1350 | 85,000  | 1000 | 42,570  | 43    | 29       | 1,468     | 14%       | 22,814      | 31,049        | 4,000    | 0%   | 1997         |
| normal freighter | 1350 | 85,000  | 3000 | 123,252 | 41    | 130      | 948       | 12%       | 71,471      | 90,160        | 12,000   | 0%   | 2069         |
| normal freighter | 1350 | 85,000  | 5000 | 196,384 | 39    | 229      | 858       | 11%       | 79,965      | 201,870       | 20,000   | 0%   | 2164         |
| heavy freighter  | 3500 | 180,000 | 300  | 9,066   | 30    | 17       | 533       | 3%        | 5,827       | 8,653         | 1,800    | 0%   | 5956         |
| heavy freighter  | 3500 | 180,000 | 1000 | 32,187  | 32    | 75       | 429       | 3%        | 17,035      | 34,133        | 6,000    | 0%   | 5592         |
| heavy freighter  | 3500 | 180,000 | 3000 | 112,412 | 37    | 187      | 601       | 3%        | 33,222      | 147,389       | 18,000   | 0%   | 4804         |
| heavy freighter  | 3500 | 180,000 | 5000 | 196,011 | 39    | 304      | 645       | 4%        | 35,898      | 284,343       | 30,000   | 0%   | 4592         |


### The same heavy freighter with nobody repairing her

| days | net L  | circuits | hull left | idle | stopped on day |
| ---- | ------ | -------- | --------- | ---- | -------------- |
| 300  | 9,306  | 18       | 100%      | 0%   | still going    |
| 1000 | 24,931 | 49       | 5%        | 30%  | 697            |
| 3000 | 24,931 | 49       | 5%        | 77%  | 697            |
| 5000 | 24,931 | 49       | 5%        | 86%  | 697            |


### Danger setting, one maintained heavy freighter

| setting  | 300d net L | 1000d net L | 3000d net L | 5000d net L | circuits at 5000 | hull left | idle at 5000 |
| -------- | ---------- | ----------- | ----------- | ----------- | ---------------- | --------- | ------------ |
| safe     | 12,803     | 29,737      | 73,388      | 128,943     | 429              | 100%      | 1%           |
| cautious | 9,306      | 31,011      | 111,851     | 195,464     | 305              | 100%      | 0%           |
| risky    | 10,705     | 30,785      | 62,061      | 134,966     | 44               | 38%       | 0%           |
| any      | 10,705     | 40,236      | 81,417      | 145,282     | 36               | 55%       | 0%           |


### Danger setting, one maintained heavy freighter — shipments and cripplings

| setting  | 300d net L | 1000d net L | 3000d net L | 5000d net L | circuits at 5000 | shipments delivered | times crippled | idle at 5000 |
| -------- | ---------- | ----------- | ----------- | ----------- | ---------------- | ------------------- | -------------- | ------------ |
| safe     | 12,803     | 29,737      | 73,388      | 128,943     | 429              | 25                  | 7              | 1%           |
| cautious | 9,306      | 31,011      | 111,851     | 195,464     | 305              | 23                  | 4              | 0%           |
| risky    | 10,705     | 30,785      | 62,061      | 134,966     | 44               | 50                  | 6              | 0%           |
| any      | 10,705     | 40,236      | 81,417      | 145,282     | 36               | 54                  | 9              | 0%           |


### Danger setting, one maintained starter ship (5 t)

| setting  | 300d net L | 1000d net L | 3000d net L | 5000d net L | circuits at 5000 | shipments delivered | hull left | idle at 5000 |
| -------- | ---------- | ----------- | ----------- | ----------- | ---------------- | ------------------- | --------- | ------------ |
| safe     | 761        | 1,922       | 6,265       | 10,008      | 215              | 9                   | 100%      | 48%          |
| cautious | 3,109      | 7,668       | 15,708      | 23,557      | 247              | 21                  | 100%      | 25%          |
| risky    | 37         | 4,585       | 15,984      | 42,453      | 113              | 35                  | 100%      | 0%           |
| any      | 37         | 4,585       | 21,431      | 45,689      | 71               | 38                  | 33%       | 0%           |


### The books of work, by danger setting (seeded worlds only; a world nobody has looked at is not seeded)

| hull            | setting  | day  | seeded/trading | occupancy | full | empty | open | age med / p90 / max | ok  | danger | unreported | no-route | refusal | too-big | no-room | why unreported  | aboard/hold | delivered | last delivery |
| --------------- | -------- | ---- | -------------- | --------- | ---- | ----- | ---- | ------------------- | --- | ------ | ---------- | -------- | ------- | ------- | ------- | --------------- | ----------- | --------- | ------------- |
| heavy freighter | safe     | 300  | 8/90           | 90%       | 6    | 0     | 26   | 0 / 0 / 3           | 8%  | 0%     | 88%        | 0%       | 4%      | 0%      | 0%      | -               | 91/3500     | 4         | 137           |
| heavy freighter | safe     | 1000 | 9/90           | 100%      | 9    | 0     | 31   | 0 / 50 / 140        | 16% | 3%     | 68%        | 0%       | 13%     | 0%      | 0%      | -               | 76/3500     | 7         | 397           |
| heavy freighter | safe     | 3000 | 9/90           | 100%      | 9    | 0     | 31   | 0 / 99 / 139        | 0%  | 3%     | 94%        | 0%       | 3%      | 0%      | 0%      | -               | 192/3500    | 12        | 2945          |
| heavy freighter | cautious | 300  | 7/90           | 100%      | 7    | 0     | 20   | 0 / 134 / 134       | 5%  | 10%    | 80%        | 0%       | 5%      | 0%      | 0%      | hostile-flag 16 | 78/3500     | 3         | 125           |
| heavy freighter | cautious | 1000 | 13/90          | 100%      | 13   | 0     | 41   | 0 / 0 / 143         | 17% | 15%    | 59%        | 0%       | 10%     | 0%      | 0%      | hostile-flag 24 | 91/3500     | 9         | 515           |
| heavy freighter | cautious | 3000 | 25/90          | 99%       | 24   | 0     | 84   | 0 / 0 / 20          | 20% | 27%    | 46%        | 0%       | 6%      | 0%      | 0%      | hostile-flag 39 | 186/3500    | 20        | 2800          |
| heavy freighter | risky    | 300  | 42/90          | 100%      | 42   | 0     | 133  | 0 / 0 / 131         | 92% | 0%     | 0%         | 0%       | 8%      | 0%      | 0%      | -               | 140/3500    | 4         | 283           |
| heavy freighter | risky    | 1000 | 42/90          | 100%      | 42   | 0     | 133  | 0 / 0 / 148         | 77% | 0%     | 0%         | 0%       | 23%     | 0%      | 0%      | -               | 99/3500     | 13        | 852           |
| heavy freighter | risky    | 3000 | 42/90          | 97%       | 40   | 0     | 129  | 107 / 107 / 121     | 51% | 4%     | 0%         | 0%       | 45%     | 0%      | 0%      | -               | 76/3500     | 25        | 2968          |
| heavy freighter | any      | 300  | 42/90          | 100%      | 42   | 0     | 133  | 0 / 0 / 131         | 92% | 0%     | 0%         | 0%       | 8%      | 0%      | 0%      | -               | 140/3500    | 4         | 283           |
| heavy freighter | any      | 1000 | 42/90          | 100%      | 42   | 0     | 133  | 0 / 0 / 88          | 73% | 0%     | 0%         | 0%       | 27%     | 0%      | 0%      | -               | 57/3500     | 15        | 912           |
| heavy freighter | any      | 3000 | 42/90          | 100%      | 42   | 0     | 133  | 0 / 0 / 0           | 59% | 0%     | 0%         | 0%       | 41%     | 0%      | 0%      | -               | 66/3500     | 29        | 2968          |
| starter ship    | safe     | 300  | 10/90          | 100%      | 10   | 0     | 32   | 0 / 123 / 147       | 0%  | 3%     | 84%        | 0%       | 3%      | 9%      | 0%      | -               | 0/5         | 1         | 225           |
| starter ship    | safe     | 1000 | 10/90          | 100%      | 10   | 0     | 32   | 0 / 32 / 142        | 0%  | 0%     | 69%        | 0%       | 16%     | 13%     | 3%      | -               | 5/5         | 2         | 698           |
| starter ship    | safe     | 3000 | 10/90          | 100%      | 10   | 0     | 32   | 61 / 61 / 132       | 0%  | 3%     | 84%        | 0%       | 9%      | 3%      | 0%      | -               | 5/5         | 6         | 2718          |
| starter ship    | cautious | 300  | 24/90          | 100%      | 24   | 0     | 76   | 0 / 65 / 130        | 0%  | 11%    | 62%        | 0%       | 7%      | 20%     | 1%      | hostile-flag 47 | 5/5         | 3         | 293           |
| starter ship    | cautious | 1000 | 24/90          | 100%      | 24   | 0     | 76   | 0 / 0 / 65          | 0%  | 14%    | 62%        | 0%       | 4%      | 16%     | 4%      | hostile-flag 47 | 5/5         | 7         | 763           |
| starter ship    | cautious | 3000 | 27/90          | 100%      | 27   | 0     | 84   | 0 / 0 / 135         | 0%  | 17%    | 61%        | 0%       | 4%      | 12%     | 7%      | hostile-flag 51 | 5/5         | 12        | 2885          |
| starter ship    | risky    | 300  | 42/90          | 100%      | 42   | 0     | 133  | 44 / 44 / 100       | 0%  | 0%     | 0%         | 0%       | 10%     | 64%     | 26%     | -               | 5/5         | 0         | -             |
| starter ship    | risky    | 1000 | 42/90          | 100%      | 42   | 0     | 133  | 0 / 0 / 0           | 12% | 7%     | 0%         | 0%       | 26%     | 50%     | 5%      | -               | 2/5         | 4         | 919           |
| starter ship    | risky    | 3000 | 42/90          | 100%      | 42   | 0     | 133  | 0 / 0 / 107         | 0%  | 0%     | 0%         | 0%       | 38%     | 38%     | 24%     | -               | 5/5         | 12        | 2941          |
| starter ship    | any      | 300  | 42/90          | 100%      | 42   | 0     | 133  | 44 / 44 / 148       | 0%  | 0%     | 0%         | 0%       | 10%     | 64%     | 26%     | -               | 5/5         | 0         | -             |
| starter ship    | any      | 1000 | 42/90          | 100%      | 42   | 0     | 133  | 91 / 91 / 91        | 12% | 0%     | 0%         | 0%       | 26%     | 55%     | 7%      | -               | 2/5         | 4         | 923           |
| starter ship    | any      | 3000 | 42/90          | 100%      | 42   | 0     | 133  | 0 / 0 / 140         | 0%  | 0%     | 0%         | 0%       | 33%     | 43%     | 24%     | -               | 5/5         | 15        | 2897          |


### Several heavy freighters on one economy

| traders | 300d each | 1000d each | 3000d each | 5000d each | circuits each at 5000 | idle each at 5000 |
| ------- | --------- | ---------- | ---------- | ---------- | --------------------- | ----------------- |
| 1       | 9,306     | 37,320     | 93,769     | 177,045    | 291                   | 0%                |
| 2       | 10,533    | 30,353     | 68,855     | 106,675    | 174                   | 40%               |
| 4       | 9,513     | 21,302     | 74,084     | 124,267    | 181                   | 13%               |

## What the numbers say

Everything here is read against the `acffccf` tables, which were the same seeds on the same script.
The only change between the two passes is the planner's arithmetic for a route's days.

### 1. Where the two reckonings agree, nothing moved; where they differ, the long routes cost what they cost

Heavy freighter, five thousand days:

| setting | `acffccf` | this candidate | circuits | shipments | crippled | idle |
| --- | --- | --- | --- | --- | --- | --- |
| Safe | 128,877 | **128,943** | 429 | 25 | 7 | 1% |
| Cautious | 195,298 | **195,464** | 305 | 23 | 4 | 0% |
| Risky | 137,925 | **134,966** | 44 | 50 | 6 | 0% |
| Any | 167,364 | **145,282** | 36 | 54 | 9 | 0% |

Safe and Cautious fly short routes of a hop or two, where one rounding of the distance and the sum
of the rounded legs are the same number, and they moved by 66 and 166 latinum in five thousand days
— the noise of one circuit ending on a different day. The 1,350-ton freighter on Cautious is
196,384 in both passes to the latinum. Risky and Any fly the many-hopped routes where the two
reckonings part company by a day a hop, and there the planner now prices a long shipment against the
days it will really spend: Any is 13% lower and Risky 2%, with fewer circuits and fewer shipments
delivered, because some hauls that looked worth the voyage were not. The order review asked for still
holds — every loose setting earns at least what Safe does, and Cautious, short routes over three
times the worlds, is the best earner — and it holds on honest arithmetic now.

### 2. Every hull, on Cautious

Cruiser **196,334** (184,254 on `acffccf`), 1,350-ton **196,384** (196,384), 3,500-ton **196,011**
(195,706), five-ton **23,362** (24,663). The three real hulls sit within 400 latinum of each other at
39 a day, which is the finding of every pass since the boards began turning over: what is scarce is
open shipments, not hold. The five-ton hull is 5% lower and idle 42% of its days rather than 37% —
a courier lot across several hops is now seen to cost its flight, and is declined where it would not
pay for it. That is the same §5 case as before, a little sharper: at the settings a new captain
would use, a small trader runs out of work that covers its upkeep and waits where she is.

### 3. The boards still turn over

Oldest posting on any board at any horizon 148 days (the lifetime is 150), as before. The rejection
shape is unchanged in kind: under Cautious every `unreported` refusal is `hostile-flag`; under Risky
and Any it is `danger` and the ports the trader has learned refuse her.

### 4. One trader boxed in, unchanged — the §5 case

Two heavy freighters on one economy: the second is **identical to the last pass to the latinum** —
40,824 over five thousand days, 48 circuits, 4,018 days idle, the last 1,626 of them holding at
Promelli Drift with two worlds a Cautious trader may fly to and nothing at either. The change in the
planner's arithmetic could not reach her because she has no route to reckon. The first trader earned
172,525 against 96,229, having been crippled three times instead of five — a different order of
routes draws a different sequence of encounters, and that is variance, not a tuning. The "each"
figures (106,675 against 68,527) are the average of one trader working and one parked; four traders
124,267 each against 145,622, for the same reason in the other direction.

### 5. One thing that moved a lot, and why it is not a finding

The heavy freighter with nobody repairing her is finished on day **697** with 24,931, where the last
pass had her going until day 1,725 with 62,217. Same seeds, same setting, same hull: the planner chose
a different circuit early, and the encounter she met on it left her at 5% hull with nobody to mend
her. A single unmaintained ship is one life: the same table read day 452, 453 and 580 on the three
passes before `acffccf`, and 1,725 was the long one. It measures what happens to a trader nobody
repairs, which is that she does not last, and it still says so.

---

## What I would ask

1. The repair is arithmetic, not tuning, and the tables move only where the arithmetic bit. **§4
   closes on this candidate.**
2. §2 and §4 are the same finding a third time: a trader can be somewhere she has no reason to
   leave and no work to do, and the captain cannot say otherwise. That is §5, and it starts next.
