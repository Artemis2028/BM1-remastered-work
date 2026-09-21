# Finite economy — long-horizon measurements

DTG 211926ZSEP26 · against this candidate · **driven through the engine, not modelled**

Review: *"The existing Promelli Drift case is exactly the behavior §5 needs to solve: an autonomous
trader may rationally have nowhere profitable/allowed to go, but the captain must be able to order her
somewhere else."*

Everything below is what the engine did. The script starts a campaign, learns thirty worlds, puts fleet
traders to work and advances the calendar day by day, reading the same shelves, the same books of work
and the same danger the captain would. `scripts/economy-measure.cjs`; the suite runs it to 1,200 days
for time, and the tables here are the full 5,000-day pass.

**What changed since the last tables:** nothing in the economy or the planner — §4 is closed and this
candidate is §5. The tables above the last one are the `e9be30b` tables rerun and should read the
same. **The last table is new**: the same two heavy freighters on the same seeds, once as before and
once with the captain playing one policy — a trader that has stood idle with nothing to do for sixty
days is sent to rendezvous at the home world, and put back to work when she arrives. The policy is the
harness's, stated there and nowhere in the game; it exists to show what the order does to the one case
these tables kept finding.

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


### Two heavy freighters on one economy, with and without the captain moving an idle one

| captain                      | trader   | 5000d net L | circuits | shipments | idle | times ordered home | days on passage | times crippled |
| ---------------------------- | -------- | ----------- | -------- | --------- | ---- | ------------------ | --------------- | -------------- |
| nobody moves her             | Trader 1 | 172,525     | 300      | 49        | 0%   | 0                  | 0               | 3              |
| nobody moves her             | Trader 2 | 40,824      | 48       | 19        | 80%  | 0                  | 0               | 1              |
| sent home after 60 idle days | Trader 1 | 159,750     | 306      | 54        | 0%   | 0                  | 0               | 3              |
| sent home after 60 idle days | Trader 2 | 201,605     | 264      | 22        | 3%   | 1                  | 91              | 4              |

## What the numbers say

### 1–5. Nothing moved

Every table above the last is identical to the `e9be30b` pass to the latinum: the same seeds, the
same planner, the same economy. §4 is closed and this candidate does not touch it. The readings of
those tables are in `ECONOMY-MEASUREMENTS-211624ZSEP26.md` and are not repeated.

### 6. The boxed-in trader, with the captain able to move her

The last table is the same two heavy freighters on the same seeds, run twice. In the first run nobody
moves them, and it is the pair from every pass since `acffccf`: the second trader crosses into a
pocket, holds — 4,018 of 5,000 days idle, the last 1,626 at Promelli Drift with two worlds a Cautious
trader may fly to and nothing at either — and ends with 40,824. In the second run the harness plays
one policy for the captain: a trader that has stood idle with nothing to do for sixty days is sent to
rendezvous at the home world, and put back to work when she arrives.

| captain | trader | 5,000-day net | circuits | idle | ordered home | days on passage |
| --- | --- | --- | --- | --- | --- | --- |
| nobody moves her | Trader 1 | 172,525 | 300 | 0% | – | – |
| nobody moves her | Trader 2 | **40,824** | 48 | **80%** | – | – |
| sent home after 60 idle days | Trader 1 | 159,750 | 306 | 0% | 0 | 0 |
| sent home after 60 idle days | Trader 2 | **201,605** | 264 | **3%** | 1 | 91 |

She was ordered once. She had stood sixty days with nothing to do, before day 1,000; the passage home
was 91 days, leg by leg through the space that had boxed her in; she arrived holding, was sent back
to work, and worked 264 circuits over the rest of the campaign,
idle 156 days in five thousand — the sixty she waited, the ninety-one she flew, and five. The first
trader earned 12,775 less, sharing the worlds near home with her; the pair together made 361,355
against 213,349.

The idle column counts every day not on a circuit, passage days included. The policy is the
harness's — sixty days, home, straight back to work — and nothing in the game plays it for the
captain; what the table shows is the order doing what it is for, on the case the earlier passes
found.

---

## What I would ask

1. The order moves the trader the tables kept finding parked, and nothing else in the tables moved.
2. Whether an unresolved order should resume on its own after repair, or wait for the captain, is
   named in the change document; the tables do not bear on it.
