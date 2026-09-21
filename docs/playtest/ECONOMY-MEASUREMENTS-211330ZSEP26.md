# Finite economy — long-horizon measurements

DTG 211330ZSEP26 · against this candidate · **driven through the engine, not modelled**

Review: *"Make route/circuit selection time-aware … Then rerun the same Safe/Cautious/Risky/Any
300/1000/3000/5000-day tables. If those two repairs are clean, close §4."*

Everything below is what the engine did. The script starts a campaign, learns thirty worlds, puts fleet
traders to work and advances the calendar day by day, reading the same shelves, the same books of work
and the same danger the captain would. `scripts/economy-measure.cjs`; the suite runs it to 1,200 days
for time, and the tables here are the full 5,000-day pass.

**What changed since the last tables:** the danger settings mean what review approved and judge by the
flag the captain knows; a trader reports what she finds where she arrives; the planner builds a circuit
by what each call earns per day; a full hold of a shipment is flown rather than got rid of; a
reposition needs a profitable reason and is no longer counted as a circuit. The payout, holds, courier
pay, regeneration and the 150-day lifetime are as `372f8a5` left them. The measurement-only rule set
from the previous round is gone; there is one Cautious now, the one in the tables.

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
| starter ship     | 5    | 500     | 3000 | 22,003  | 7     | 139      | 158       | 77%       | 18,911      | 5,053         | 3,000    | 14%  | 68           |
| starter ship     | 5    | 500     | 5000 | 24,663  | 5     | 190      | 130       | 80%       | 20,314      | 7,125         | 5,000    | 37%  | 101          |
| ordinary cruiser | 220  | 124,000 | 300  | 9,277   | 31    | 18       | 515       | 36%       | 5,827       | 8,657         | 1,500    | 0%   | 4010         |
| ordinary cruiser | 220  | 124,000 | 1000 | 30,537  | 31    | 79       | 387       | 40%       | 15,065      | 34,560        | 5,000    | 0%   | 4061         |
| ordinary cruiser | 220  | 124,000 | 3000 | 114,367 | 38    | 194      | 590       | 52%       | 30,827      | 154,804       | 15,000   | 0%   | 3253         |
| ordinary cruiser | 220  | 124,000 | 5000 | 184,254 | 37    | 288      | 640       | 58%       | 35,969      | 269,982       | 25,000   | 5%   | 3365         |
| normal freighter | 1350 | 85,000  | 300  | 8,523   | 28    | 4        | 2,131     | 8%        | 8,018       | 2,748         | 1,200    | 0%   | 2992         |
| normal freighter | 1350 | 85,000  | 1000 | 42,570  | 43    | 29       | 1,468     | 14%       | 22,814      | 31,049        | 4,000    | 0%   | 1997         |
| normal freighter | 1350 | 85,000  | 3000 | 123,252 | 41    | 130      | 948       | 12%       | 71,471      | 90,160        | 12,000   | 0%   | 2069         |
| normal freighter | 1350 | 85,000  | 5000 | 196,384 | 39    | 229      | 858       | 11%       | 79,965      | 201,870       | 20,000   | 0%   | 2164         |
| heavy freighter  | 3500 | 180,000 | 300  | 9,066   | 30    | 17       | 533       | 3%        | 5,827       | 8,653         | 1,800    | 0%   | 5956         |
| heavy freighter  | 3500 | 180,000 | 1000 | 32,121  | 32    | 75       | 428       | 3%        | 17,035      | 33,836        | 6,000    | 0%   | 5604         |
| heavy freighter  | 3500 | 180,000 | 3000 | 112,095 | 37    | 187      | 599       | 4%        | 33,222      | 146,841       | 18,000   | 0%   | 4817         |
| heavy freighter  | 3500 | 180,000 | 5000 | 195,706 | 39    | 304      | 644       | 4%        | 35,898      | 283,807       | 30,000   | 0%   | 4599         |


### The same heavy freighter with nobody repairing her

| days | net L  | circuits | hull left | idle | stopped on day |
| ---- | ------ | -------- | --------- | ---- | -------------- |
| 300  | 9,306  | 18       | 100%      | 0%   | still going    |
| 1000 | 34,684 | 66       | 30%       | 0%   | still going    |
| 3000 | 62,217 | 111      | 5%        | 43%  | 1725           |
| 5000 | 62,217 | 111      | 5%        | 66%  | 1725           |


### Danger setting, one maintained heavy freighter

| setting  | 300d net L | 1000d net L | 3000d net L | 5000d net L | circuits at 5000 | hull left | idle at 5000 |
| -------- | ---------- | ----------- | ----------- | ----------- | ---------------- | --------- | ------------ |
| safe     | 12,737     | 29,671      | 73,322      | 128,877     | 429              | 100%      | 1%           |
| cautious | 9,306      | 30,845      | 111,685     | 195,298     | 304              | 100%      | 0%           |
| risky    | 10,705     | 34,930      | 78,415      | 137,925     | 35               | 100%      | 0%           |
| any      | 10,705     | 34,930      | 95,438      | 167,364     | 64               | 100%      | 0%           |


### Danger setting, one maintained heavy freighter — shipments and cripplings

| setting  | 300d net L | 1000d net L | 3000d net L | 5000d net L | circuits at 5000 | shipments delivered | times crippled | idle at 5000 |
| -------- | ---------- | ----------- | ----------- | ----------- | ---------------- | ------------------- | -------------- | ------------ |
| safe     | 12,737     | 29,671      | 73,322      | 128,877     | 429              | 25                  | 7              | 1%           |
| cautious | 9,306      | 30,845      | 111,685     | 195,298     | 304              | 23                  | 5              | 0%           |
| risky    | 10,705     | 34,930      | 78,415      | 137,925     | 35               | 51                  | 8              | 0%           |
| any      | 10,705     | 34,930      | 95,438      | 167,364     | 64               | 69                  | 10             | 0%           |


### Danger setting, one maintained starter ship (5 t)

| setting  | 300d net L | 1000d net L | 3000d net L | 5000d net L | circuits at 5000 | shipments delivered | hull left | idle at 5000 |
| -------- | ---------- | ----------- | ----------- | ----------- | ---------------- | ------------------- | --------- | ------------ |
| safe     | 761        | 1,922       | 6,265       | 10,008      | 215              | 9                   | 100%      | 48%          |
| cautious | 3,109      | 7,668       | 15,708      | 23,557      | 247              | 21                  | 100%      | 25%          |
| risky    | 37         | 4,585       | 20,359      | 45,661      | 126              | 36                  | 42%       | 0%           |
| any      | 37         | 4,585       | 23,762      | 47,267      | 79               | 37                  | 55%       | 0%           |


### The books of work, by danger setting (seeded worlds only; a world nobody has looked at is not seeded)

| hull            | setting  | day  | seeded/trading | occupancy | full | empty | open | age med / p90 / max | ok  | danger | unreported | no-route | refusal | too-big | no-room | why unreported  | aboard/hold | delivered | last delivery |
| --------------- | -------- | ---- | -------------- | --------- | ---- | ----- | ---- | ------------------- | --- | ------ | ---------- | -------- | ------- | ------- | ------- | --------------- | ----------- | --------- | ------------- |
| heavy freighter | safe     | 300  | 8/90           | 90%       | 6    | 0     | 26   | 0 / 0 / 3           | 8%  | 0%     | 88%        | 0%       | 4%      | 0%      | 0%      | -               | 91/3500     | 4         | 137           |
| heavy freighter | safe     | 1000 | 9/90           | 100%      | 9    | 0     | 31   | 0 / 50 / 140        | 16% | 3%     | 68%        | 0%       | 13%     | 0%      | 0%      | -               | 76/3500     | 7         | 397           |
| heavy freighter | safe     | 3000 | 9/90           | 100%      | 9    | 0     | 31   | 0 / 99 / 139        | 0%  | 3%     | 94%        | 0%       | 3%      | 0%      | 0%      | -               | 192/3500    | 12        | 2945          |
| heavy freighter | cautious | 300  | 7/90           | 100%      | 7    | 0     | 20   | 0 / 134 / 134       | 5%  | 10%    | 80%        | 0%       | 5%      | 0%      | 0%      | hostile-flag 16 | 78/3500     | 3         | 125           |
| heavy freighter | cautious | 1000 | 12/90          | 100%      | 12   | 0     | 39   | 0 / 0 / 143         | 18% | 15%    | 56%        | 0%       | 10%     | 0%      | 0%      | hostile-flag 22 | 91/3500     | 9         | 514           |
| heavy freighter | cautious | 3000 | 25/90          | 99%       | 24   | 0     | 84   | 0 / 0 / 20          | 19% | 27%    | 48%        | 0%       | 6%      | 0%      | 0%      | hostile-flag 40 | 186/3500    | 20        | 2800          |
| heavy freighter | risky    | 300  | 42/90          | 100%      | 42   | 0     | 133  | 0 / 0 / 131         | 92% | 0%     | 0%         | 0%       | 8%      | 0%      | 0%      | -               | 140/3500    | 4         | 283           |
| heavy freighter | risky    | 1000 | 42/90          | 100%      | 42   | 0     | 133  | 0 / 0 / 65          | 81% | 0%     | 0%         | 0%       | 19%     | 0%      | 0%      | -               | 52/3500     | 13        | 739           |
| heavy freighter | risky    | 3000 | 42/90          | 100%      | 42   | 0     | 133  | 0 / 0 / 0           | 56% | 3%     | 0%         | 0%       | 41%     | 0%      | 0%      | -               | 235/3500    | 28        | 2841          |
| heavy freighter | any      | 300  | 42/90          | 100%      | 42   | 0     | 133  | 0 / 0 / 131         | 92% | 0%     | 0%         | 0%       | 8%      | 0%      | 0%      | -               | 140/3500    | 4         | 283           |
| heavy freighter | any      | 1000 | 42/90          | 100%      | 42   | 0     | 133  | 0 / 0 / 65          | 81% | 0%     | 0%         | 0%       | 19%     | 0%      | 0%      | -               | 52/3500     | 13        | 739           |
| heavy freighter | any      | 3000 | 42/90          | 100%      | 42   | 0     | 133  | 0 / 0 / 144         | 65% | 0%     | 0%         | 0%       | 35%     | 0%      | 0%      | -               | 219/3500    | 37        | 2927          |
| starter ship    | safe     | 300  | 10/90          | 100%      | 10   | 0     | 32   | 0 / 123 / 147       | 0%  | 3%     | 84%        | 0%       | 3%      | 9%      | 0%      | -               | 0/5         | 1         | 225           |
| starter ship    | safe     | 1000 | 10/90          | 100%      | 10   | 0     | 32   | 0 / 32 / 142        | 0%  | 0%     | 69%        | 0%       | 16%     | 13%     | 3%      | -               | 5/5         | 2         | 698           |
| starter ship    | safe     | 3000 | 10/90          | 100%      | 10   | 0     | 32   | 61 / 61 / 132       | 0%  | 3%     | 84%        | 0%       | 9%      | 3%      | 0%      | -               | 5/5         | 6         | 2718          |
| starter ship    | cautious | 300  | 24/90          | 100%      | 24   | 0     | 76   | 0 / 65 / 130        | 0%  | 11%    | 62%        | 0%       | 7%      | 20%     | 1%      | hostile-flag 47 | 5/5         | 3         | 293           |
| starter ship    | cautious | 1000 | 24/90          | 100%      | 24   | 0     | 76   | 0 / 0 / 65          | 0%  | 14%    | 62%        | 0%       | 4%      | 16%     | 4%      | hostile-flag 47 | 5/5         | 7         | 763           |
| starter ship    | cautious | 3000 | 27/90          | 100%      | 27   | 0     | 84   | 0 / 0 / 135         | 0%  | 17%    | 61%        | 0%       | 4%      | 12%     | 7%      | hostile-flag 51 | 5/5         | 12        | 2885          |
| starter ship    | risky    | 300  | 42/90          | 100%      | 42   | 0     | 133  | 44 / 44 / 100       | 0%  | 0%     | 0%         | 0%       | 10%     | 64%     | 26%     | -               | 5/5         | 0         | -             |
| starter ship    | risky    | 1000 | 42/90          | 100%      | 42   | 0     | 133  | 0 / 0 / 0           | 12% | 7%     | 0%         | 0%       | 26%     | 50%     | 5%      | -               | 2/5         | 4         | 919           |
| starter ship    | risky    | 3000 | 42/90          | 99%       | 41   | 0     | 132  | 32 / 32 / 104       | 5%  | 0%     | 0%         | 0%       | 31%     | 54%     | 10%     | -               | 2/5         | 15        | 2957          |
| starter ship    | any      | 300  | 42/90          | 100%      | 42   | 0     | 133  | 44 / 44 / 148       | 0%  | 0%     | 0%         | 0%       | 10%     | 64%     | 26%     | -               | 5/5         | 0         | -             |
| starter ship    | any      | 1000 | 42/90          | 100%      | 42   | 0     | 133  | 91 / 91 / 91        | 12% | 0%     | 0%         | 0%       | 26%     | 55%     | 7%      | -               | 2/5         | 4         | 923           |
| starter ship    | any      | 3000 | 42/90          | 99%       | 41   | 0     | 132  | 0 / 0 / 147         | 16% | 0%     | 0%         | 0%       | 30%     | 47%     | 8%      | -               | 1/5         | 16        | 2734          |


### Several heavy freighters on one economy

| traders | 300d each | 1000d each | 3000d each | 5000d each | circuits each at 5000 | idle each at 5000 |
| ------- | --------- | ---------- | ---------- | ---------- | --------------------- | ----------------- |
| 1       | 9,306     | 31,274     | 112,180    | 197,953    | 311                   | 0%                |
| 2       | 10,533    | 30,353     | 54,128     | 68,527     | 124                   | 49%               |
| 4       | 9,286     | 23,367     | 88,411     | 145,622    | 226                   | 6%                |

---

## What the numbers say

### 1. The inversion is gone: the loose settings earn at least what the tight ones do

Heavy freighter, five thousand days, same seeds as every previous pass:

| setting | `372f8a5` | this candidate | circuits | shipments | crippled |
| --- | --- | --- | --- | --- | --- |
| Safe | 132,630 | **128,877** | 429 | 25 | 7 |
| Cautious | 142,498 (old meaning) | **195,298** | 304 | 23 | 5 |
| Risky | 66,794 | **137,925** | 35 | 51 | 8 |
| Any | 65,070 | **167,364** | 64 | 69 | 10 |

Risky and Any doubled and now sit above Safe, which is the property review asked for: a trader
allowed to go further does not choose a worse day's pay than she could have had. They still make few
circuits — a Risky trader takes the long hauls that *do* pay for their days now, and those are long —
and they still deliver twice the shipments and take more cripplings, which is the setting doing what it
says. Cautious is the best earner because the approved rule opens it to three times the worlds while
its circuits stay short. Safe is a little lower than before (429 short circuits, and the planner now
refuses the lots whose margin does not cover their upkeep), which is honest money rather than gross.

### 2. Every hull earns more per day, and the tiny hull earns something

One maintained trader on Cautious, five thousand days: cruiser **184,254** (136,255 on `372f8a5`),
1,350-ton **196,384** (135,068), 3,500-ton **195,706** (144,760), five-ton **24,663** (10,958). Rates
of 37–40 latinum a day for the three real hulls against 27–29 before. Payback 3,100–4,600 days for the
big hulls and **101** for the five-ton one, which now takes the courier lots that pay for their voyage
and declines the ones that do not.

The five-ton hull's 37% idle under Cautious and 48% under Safe is the honest face of that: at the
settings a new captain would use it runs out of work that covers its own upkeep and waits, and the
panel says so — *"<world> has no work for Trader 1."* On `372f8a5` the same hull was never idle and
bounced instead, earning less. **This is the case for §5**: a trader with nothing to do where she is
needs the captain to be able to say where she should go.

### 3. The boards still turn over; the shape of the rejections changed

Maximum age on any board 148 days at any horizon (the lifetime is 150). Under the approved Cautious,
`unreported` refusals fell from 81–93% of the board to 48–62%, and every remaining one is
`hostile-flag` — a system charted under a flag that refuses the captain, which for a Terran captain
at standing zero is most of Klingon and Romulan space. `danger` refusals rose to 10–27% as the trader
reports the conditions she meets; that is her own eyes feeding the next plan. Under Risky and Any,
`refusal` rose to 30–41% — the trader's own observations now name the ports that will not deal with
her, where before she found out on arrival.

### 4. One trader boxed in, and what it means

Two heavy freighters on one economy earn 68,527 each at 49% idle, against 197,953 for one and 145,622
each for four. The second trader is not competing; she is parked. Traced: she crossed into a pocket,
recorded the flags around it as she came, and from there a Cautious trader has **two** worlds she may
fly to (fifty-four refused as `hostile-flag`, nineteen as band 2) against eighty-one for Any; neither
has profitable work or buys what she carries, so she holds — 1,626 days at Promelli Drift, the panel
reading *"Promelli Drift has no work for Trader 2."* On `372f8a5` she bounced between the two instead
and earned no more. That is the danger setting and the intelligence model doing exactly what they say,
and it is the second and stronger case for §5: the captain needs the order that moves her, or the
setting that lets her leave.

### 5. Nothing else moved

The unmaintained freighter is finished on day 1,725, later than before because the circuits are
shorter. Shipment income is a live third to two fifths of a trader's earnings at every horizon.

---

## What I would ask

1. The two repairs are clean on these tables. **§4 can close on this candidate.**
2. §2 and §4 are the same finding twice: a trader can be somewhere she has no reason to leave and no
   work to do, and the game has no way for the captain to say otherwise. That is §5.
