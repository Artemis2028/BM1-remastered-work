# Finite economy — long-horizon measurements

DTG 210824ZSEP26 · against this candidate · **driven through the engine, not modelled**

Review: *"Give an unaccepted board shipment a named lifetime. Start by testing something around
120–180 campaign days; don't silently lock the final number yet. … Then rerun the exact
instrumentation. The important question is whether the board is now changing over time rather than
containing 2,900-day-old freight. … If Cautious is still effectively trapped in the same handful of
systems, then give me a comparison."*

Everything below is what the engine did. The script starts a campaign, learns thirty worlds, puts fleet
traders to work and advances the calendar day by day, reading the same shelves, the same books of work
and the same danger the captain would. `scripts/economy-measure.cjs`; the suite runs it to 1,200 days
for time, and the tables here are the full 5,000-day pass.

**What changed since the last tables:** an unaccepted shipment now expires after
`jobLifetimeDays = 150`, and a shipment the planner puts back keeps its date. Nothing else in the
economy: the payout, the holds, courier pay and the twelve-day regeneration are as `6a33345` left
them. The books table is read the way a visitor reads a book — expiry and regeneration are lazy and
happen on the read — so the board reported is the board anyone arriving would see; one consequence is
that a snapshot regenerates many boards at once and the *median* age often reads zero, so the **max**
age is the column that answers review's question. A second, measurement-only reading of the four
danger settings is run beside the shipped one (§4); the game does not use it.

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
| starter ship     | 5    | 500     | 1000 | 2,327   | 2     | 37       | 63        | 99%       | 1,463       | 1,448         | 1,000    | 1%   | 215          |
| starter ship     | 5    | 500     | 3000 | 5,552   | 2     | 107      | 52        | 100%      | 3,052       | 4,243         | 3,000    | 2%   | 270          |
| starter ship     | 5    | 500     | 5000 | 10,958  | 2     | 182      | 60        | 99%       | 6,833       | 6,928         | 5,000    | 1%   | 228          |
| ordinary cruiser | 220  | 124,000 | 300  | 16,819  | 56    | 10       | 1,682     | 45%       | 14,331      | 4,110         | 1,500    | 0%   | 2212         |
| ordinary cruiser | 220  | 124,000 | 1000 | 35,764  | 36    | 37       | 967       | 41%       | 24,111      | 19,937        | 5,000    | 1%   | 3467         |
| ordinary cruiser | 220  | 124,000 | 3000 | 88,564  | 30    | 111      | 798       | 48%       | 44,223      | 75,456        | 15,000   | 1%   | 4200         |
| ordinary cruiser | 220  | 124,000 | 5000 | 136,255 | 27    | 188      | 725       | 51%       | 63,383      | 127,647       | 25,000   | 0%   | 4550         |
| normal freighter | 1350 | 85,000  | 300  | 10,805  | 36    | 9        | 1,201     | 9%        | 8,291       | 4,798         | 1,200    | 0%   | 2360         |
| normal freighter | 1350 | 85,000  | 1000 | 32,555  | 33    | 36       | 904       | 9%        | 22,316      | 18,305        | 4,000    | 0%   | 2611         |
| normal freighter | 1350 | 85,000  | 3000 | 83,030  | 28    | 114      | 728       | 9%        | 42,201      | 72,952        | 12,000   | 0%   | 3071         |
| normal freighter | 1350 | 85,000  | 5000 | 135,068 | 27    | 191      | 707       | 9%        | 63,622      | 127,891       | 20,000   | 0%   | 3147         |
| heavy freighter  | 3500 | 180,000 | 300  | 13,206  | 44    | 11       | 1,201     | 3%        | 10,700      | 4,820         | 1,800    | 0%   | 4089         |
| heavy freighter  | 3500 | 180,000 | 1000 | 33,281  | 33    | 39       | 853       | 3%        | 22,316      | 19,315        | 6,000    | 1%   | 5408         |
| heavy freighter  | 3500 | 180,000 | 3000 | 87,753  | 29    | 114      | 770       | 3%        | 44,004      | 75,277        | 18,000   | 1%   | 6154         |
| heavy freighter  | 3500 | 180,000 | 5000 | 144,760 | 29    | 190      | 762       | 3%        | 72,829      | 126,801       | 30,000   | 1%   | 6217         |


### The same heavy freighter with nobody repairing her

| days | net L  | circuits | hull left | idle | stopped on day |
| ---- | ------ | -------- | --------- | ---- | -------------- |
| 300  | 17,140 | 10       | 37%       | 0%   | still going    |
| 1000 | 22,540 | 15       | 5%        | 55%  | 452            |
| 3000 | 22,540 | 15       | 5%        | 85%  | 452            |
| 5000 | 22,540 | 15       | 5%        | 91%  | 452            |


### Danger setting, one maintained heavy freighter

| setting  | 300d net L | 1000d net L | 3000d net L | 5000d net L | circuits at 5000 | hull left | idle at 5000 |
| -------- | ---------- | ----------- | ----------- | ----------- | ---------------- | --------- | ------------ |
| safe     | 12,432     | 33,933      | 78,723      | 132,630     | 192              | 100%      | 1%           |
| cautious | 12,087     | 36,963      | 93,287      | 142,498     | 180              | 100%      | 4%           |
| risky    | 6,236      | 23,039      | 41,801      | 66,794      | 23               | 100%      | 0%           |
| any      | 6,236      | 21,648      | 40,967      | 65,070      | 28               | 19%       | 0%           |


### The four settings as shipped and as proposed, one maintained heavy freighter, same seeds (comparison only; the game uses the shipped rules)

| setting  | rules    | 300d net L | 1000d net L | 3000d net L | 5000d net L | circuits at 5000 | shipments delivered | times disabled | idle at 5000 |
| -------- | -------- | ---------- | ----------- | ----------- | ----------- | ---------------- | ------------------- | -------------- | ------------ |
| safe     | shipped  | 12,432     | 33,933      | 78,723      | 132,630     | 192              | 41                  | 7              | 1%           |
| safe     | proposed | 12,432     | 33,933      | 78,723      | 132,630     | 192              | 41                  | 7              | 1%           |
| cautious | shipped  | 12,087     | 36,963      | 93,287      | 142,498     | 180              | 45                  | 5              | 4%           |
| cautious | proposed | 9,752      | 40,531      | 107,635     | 170,399     | 105              | 80                  | 9              | 0%           |
| risky    | shipped  | 6,236      | 23,039      | 41,801      | 66,794      | 23               | 32                  | 10             | 0%           |
| risky    | proposed | 6,236      | 23,039      | 41,801      | 66,794      | 23               | 32                  | 10             | 0%           |
| any      | shipped  | 6,236      | 21,648      | 40,967      | 65,070      | 28               | 27                  | 5              | 0%           |
| any      | proposed | 6,236      | 21,648      | 40,967      | 65,070      | 28               | 27                  | 5              | 0%           |


### Danger setting, one maintained starter ship (5 t)

| setting  | 300d net L | 1000d net L | 3000d net L | 5000d net L | circuits at 5000 | shipments delivered | hull left | idle at 5000 |
| -------- | ---------- | ----------- | ----------- | ----------- | ---------------- | ------------------- | --------- | ------------ |
| safe     | 275        | 1,528       | 4,098       | 8,281       | 180              | 7                   | 100%      | 2%           |
| cautious | 265        | 2,327       | 5,482       | 9,853       | 189              | 9                   | 100%      | 1%           |
| risky    | 10         | 3,697       | 15,775      | 32,309      | 81               | 27                  | 100%      | 0%           |
| any      | 10         | 3,769       | 11,739      | 15,889      | 114              | 13                  | 21%       | 0%           |


### The books of work, by danger setting (seeded worlds only; a world nobody has looked at is not seeded)

| hull                             | setting  | day  | seeded/trading | occupancy | full | empty | open | age med / p90 / max | ok  | danger | unreported | no-route | refusal | too-big | no-room | why unreported (proposed) | aboard/hold | delivered | last delivery |
| -------------------------------- | -------- | ---- | -------------- | --------- | ---- | ----- | ---- | ------------------- | --- | ------ | ---------- | -------- | ------- | ------- | ------- | ------------------------- | ----------- | --------- | ------------- |
| heavy freighter                  | safe     | 300  | 8/90           | 100%      | 8    | 0     | 29   | 0 / 30 / 140        | 3%  | 0%     | 93%        | 0%       | 3%      | 0%      | 0%      | -                         | 81/3500     | 5         | 191           |
| heavy freighter                  | safe     | 1000 | 8/90           | 100%      | 8    | 0     | 29   | 0 / 85 / 121        | 14% | 0%     | 86%        | 0%       | 0%      | 0%      | 0%      | -                         | 2/3500      | 11        | 984           |
| heavy freighter                  | safe     | 3000 | 10/90          | 100%      | 10   | 0     | 32   | 0 / 84 / 105        | 6%  | 0%     | 81%        | 0%       | 13%     | 0%      | 0%      | -                         | 179/3500    | 24        | 2662          |
| heavy freighter                  | cautious | 300  | 8/90           | 100%      | 8    | 0     | 29   | 0 / 133 / 142       | 10% | 0%     | 86%        | 0%       | 3%      | 0%      | 0%      | -                         | 81/3500     | 5         | 211           |
| heavy freighter                  | cautious | 1000 | 11/90          | 100%      | 11   | 0     | 35   | 0 / 69 / 134        | 6%  | 0%     | 83%        | 0%       | 11%     | 0%      | 0%      | -                         | 148/3500    | 15        | 888           |
| heavy freighter                  | cautious | 3000 | 11/90          | 100%      | 11   | 0     | 35   | 0 / 124 / 146       | 9%  | 0%     | 86%        | 0%       | 6%      | 0%      | 0%      | -                         | 133/3500    | 30        | 2799          |
| heavy freighter                  | risky    | 300  | 42/90          | 100%      | 42   | 0     | 133  | 127 / 127 / 127     | 94% | 0%     | 0%         | 0%       | 6%      | 0%      | 0%      | -                         | 90/3500     | 2         | 90            |
| heavy freighter                  | risky    | 1000 | 42/90          | 98%       | 41   | 1     | 130  | 0 / 0 / 72          | 94% | 0%     | 0%         | 0%       | 6%      | 0%      | 0%      | -                         | 136/3500    | 9         | 1000          |
| heavy freighter                  | risky    | 3000 | 42/90          | 100%      | 42   | 0     | 133  | 143 / 143 / 143     | 84% | 8%     | 0%         | 0%       | 8%      | 0%      | 0%      | -                         | 127/3500    | 19        | 2930          |
| heavy freighter                  | any      | 300  | 42/90          | 100%      | 42   | 0     | 133  | 127 / 127 / 127     | 94% | 0%     | 0%         | 0%       | 6%      | 0%      | 0%      | -                         | 90/3500     | 2         | 90            |
| heavy freighter                  | any      | 1000 | 42/90          | 99%       | 41   | 1     | 132  | 27 / 27 / 60        | 95% | 0%     | 0%         | 0%       | 5%      | 0%      | 0%      | -                         | 59/3500     | 8         | 940           |
| heavy freighter                  | any      | 3000 | 42/90          | 100%      | 42   | 0     | 133  | 76 / 76 / 76        | 98% | 0%     | 0%         | 0%       | 2%      | 0%      | 0%      | -                         | 109/3500    | 16        | 2652          |
| starter ship                     | safe     | 300  | 5/90           | 100%      | 5    | 0     | 21   | 80 / 102 / 102      | 0%  | 0%     | 90%        | 0%       | 5%      | 5%      | 0%      | -                         | 5/5         | 0         | -             |
| starter ship                     | safe     | 1000 | 9/90           | 100%      | 9    | 0     | 31   | 132 / 132 / 132     | 0%  | 0%     | 94%        | 0%       | 3%      | 3%      | 0%      | -                         | 5/5         | 1         | 414           |
| starter ship                     | safe     | 3000 | 9/90           | 100%      | 9    | 0     | 31   | 0 / 108 / 108       | 0%  | 10%    | 71%        | 0%       | 16%     | 3%      | 0%      | -                         | 5/5         | 2         | 2935          |
| starter ship                     | cautious | 300  | 5/90           | 100%      | 5    | 0     | 21   | 80 / 102 / 102      | 0%  | 0%     | 90%        | 0%       | 5%      | 5%      | 0%      | -                         | 5/5         | 0         | -             |
| starter ship                     | cautious | 1000 | 9/90           | 100%      | 9    | 0     | 31   | 0 / 98 / 119        | 0%  | 0%     | 77%        | 0%       | 13%     | 10%     | 0%      | -                         | 5/5         | 2         | 795           |
| starter ship                     | cautious | 3000 | 9/90           | 100%      | 9    | 0     | 31   | 0 / 109 / 131       | 0%  | 0%     | 77%        | 0%       | 19%     | 3%      | 0%      | -                         | 5/5         | 4         | 2934          |
| starter ship                     | risky    | 300  | 42/90          | 100%      | 42   | 0     | 133  | 30 / 30 / 110       | 0%  | 0%     | 0%         | 0%       | 5%      | 66%     | 29%     | -                         | 5/5         | 0         | -             |
| starter ship                     | risky    | 1000 | 42/90          | 99%       | 41   | 0     | 132  | 0 / 0 / 64          | 0%  | 6%     | 0%         | 0%       | 2%      | 61%     | 30%     | -                         | 5/5         | 3         | 677           |
| starter ship                     | risky    | 3000 | 42/90          | 100%      | 42   | 0     | 133  | 46 / 46 / 131       | 0%  | 0%     | 0%         | 0%       | 3%      | 73%     | 24%     | -                         | 5/5         | 12        | 2869          |
| starter ship                     | any      | 300  | 42/90          | 100%      | 42   | 0     | 133  | 30 / 30 / 110       | 0%  | 0%     | 0%         | 0%       | 5%      | 66%     | 29%     | -                         | 5/5         | 0         | -             |
| starter ship                     | any      | 1000 | 42/90          | 100%      | 42   | 0     | 133  | 89 / 89 / 89        | 0%  | 0%     | 0%         | 0%       | 7%      | 69%     | 24%     | -                         | 5/5         | 3         | 701           |
| starter ship                     | any      | 3000 | 42/90          | 100%      | 42   | 0     | 133  | 0 / 0 / 31          | 15% | 0%     | 0%         | 0%       | 2%      | 64%     | 19%     | -                         | 3/5         | 10        | 2877          |
| heavy freighter (proposed rules) | safe     | 300  | 8/90           | 100%      | 8    | 0     | 29   | 0 / 30 / 140        | 3%  | 0%     | 93%        | 0%       | 3%      | 0%      | 0%      | -                         | 81/3500     | 5         | 191           |
| heavy freighter (proposed rules) | safe     | 1000 | 8/90           | 100%      | 8    | 0     | 29   | 0 / 85 / 121        | 14% | 0%     | 86%        | 0%       | 0%      | 0%      | 0%      | -                         | 2/3500      | 11        | 984           |
| heavy freighter (proposed rules) | safe     | 3000 | 10/90          | 100%      | 10   | 0     | 32   | 0 / 84 / 105        | 6%  | 0%     | 81%        | 0%       | 13%     | 0%      | 0%      | -                         | 179/3500    | 24        | 2662          |
| heavy freighter (proposed rules) | cautious | 300  | 8/90           | 100%      | 8    | 0     | 27   | 0 / 101 / 142       | 11% | 7%     | 70%        | 0%       | 11%     | 0%      | 0%      | hostile-flag 19           | 25/3500     | 4         | 261           |
| heavy freighter (proposed rules) | cautious | 1000 | 23/90          | 100%      | 23   | 0     | 75   | 0 / 103 / 146       | 21% | 12%    | 59%        | 0%       | 8%      | 0%      | 0%      | hostile-flag 44           | 225/3500    | 19        | 965           |
| heavy freighter (proposed rules) | cautious | 3000 | 31/90          | 100%      | 31   | 0     | 100  | 0 / 0 / 123         | 21% | 11%    | 63%        | 0%       | 5%      | 0%      | 0%      | hostile-flag 63           | 272/3500    | 51        | 2921          |
| heavy freighter (proposed rules) | risky    | 300  | 42/90          | 100%      | 42   | 0     | 133  | 127 / 127 / 127     | 94% | 0%     | 0%         | 0%       | 6%      | 0%      | 0%      | -                         | 90/3500     | 2         | 90            |
| heavy freighter (proposed rules) | risky    | 1000 | 42/90          | 98%       | 41   | 1     | 130  | 0 / 0 / 72          | 94% | 0%     | 0%         | 0%       | 6%      | 0%      | 0%      | -                         | 136/3500    | 9         | 1000          |
| heavy freighter (proposed rules) | risky    | 3000 | 42/90          | 100%      | 42   | 0     | 133  | 143 / 143 / 143     | 84% | 8%     | 0%         | 0%       | 8%      | 0%      | 0%      | -                         | 127/3500    | 19        | 2930          |
| heavy freighter (proposed rules) | any      | 300  | 42/90          | 100%      | 42   | 0     | 133  | 127 / 127 / 127     | 94% | 0%     | 0%         | 0%       | 6%      | 0%      | 0%      | -                         | 90/3500     | 2         | 90            |
| heavy freighter (proposed rules) | any      | 1000 | 42/90          | 99%       | 41   | 1     | 132  | 27 / 27 / 60        | 95% | 0%     | 0%         | 0%       | 5%      | 0%      | 0%      | -                         | 59/3500     | 8         | 940           |
| heavy freighter (proposed rules) | any      | 3000 | 42/90          | 100%      | 42   | 0     | 133  | 76 / 76 / 76        | 98% | 0%     | 0%         | 0%       | 2%      | 0%      | 0%      | -                         | 109/3500    | 16        | 2652          |


### Several heavy freighters on one economy

| traders | 300d each | 1000d each | 3000d each | 5000d each | circuits each at 5000 | idle each at 5000 |
| ------- | --------- | ---------- | ---------- | ---------- | --------------------- | ----------------- |
| 1       | 13,575    | 32,374     | 87,905     | 139,722    | 184                   | 0%                |
| 2       | 10,276    | 26,607     | 73,064     | 118,313    | 181                   | 1%                |
| 4       | 7,846     | 19,999     | 55,496     | 89,954     | 172                   | 2%                |

---

## What the numbers say

### 1. The board turns over now

The previous tables read *"age med / p90 / max: 2903 / 2999 / 2999"* at day 3,000. These read a
**maximum of 146 days** on every board, at every horizon, under every setting and for both hulls —
never a day past the lifetime. Books are still full (occupancy 98–100%), which is the twelve-day
generation doing its job; what is on them is new.

**Last delivery** tells the rest. Under Cautious the heavy freighter's last shipment used to land on
day 365 and nothing after; it now lands on day 2,799 at the 3,000-day snapshot, with thirty delivered
against six. Under Safe, 2,662 and twenty-four against six. The five-ton hull, which delivered nothing
under Safe or Cautious in five thousand days, delivers seven and nine. Deliverable work under Safe and
Cautious is 3–14% of the board at every horizon rather than 0% from day 1,000 — small, because the
intelligence model is unchanged, but live, because the small deliverable fraction is regenerated
rather than exhausted.

### 2. What turnover did to the economy, without touching the payout

Shipment income is a live share of a trader's earnings again. One maintained cruiser on Cautious,
five thousand days:

| | `6a33345` | this candidate |
| --- | --- | --- |
| net | 100,369 | **136,255** |
| shipments | 11,922 (frozen from day ~400) | **63,383**, still growing |
| commodities | 150,691 | 127,647 |
| payback | 6,177 days | **4,550** |

The 1,350-ton and 3,500-ton freighters read 135,068 and 144,760 (from 96,514 and 96,926); the
five-ton hull 10,958 from 4,095, with 6,833 of it shipments. About a third of a trader's income is
now shipments, where before it was a tenth and then nothing. **This is a consequence of unfreezing
the boards, not a tuning change**, and it is the number review should weigh the 150-day lifetime
against: a longer lifetime moves it back toward the old tables, a shorter one further from them.

### 3. One thing turnover exposed: the loose settings now earn less than the tight ones

Heavy freighter, shipped rules, five thousand days: Safe 132,630, Cautious 142,498, **Risky 66,794,
Any 65,070** — where on `6a33345` they read 91,439 / 98,416 / 92,222 / 86,352. Risky and Any went
*down*. With live boards, a Risky or Any trader takes long-haul shipments to the far side of the map —
twenty-three to twenty-eight circuits in five thousand days against a hundred and eighty to a hundred
and ninety — and the price of a shipment does not pay for the days it takes. The planner ranks
shipments by price over the hold they occupy, not over the days they cost; with dead boards that never
mattered. It is a ranking question, not a payout question, and it is reported here rather than fixed,
because review said not to touch the economy in this round. Not tuned.

### 4. Cautious is still confined, so here is the comparison

Under the shipped rules a Cautious heavy freighter opens the books of eight worlds in three thousand
days, eleven by the end, and 81–93% of what is on them is on a route the captain has no report for.
The same hull on the same seeds under the proposed reading — Cautious may cross an unreported system
that is charted, whose flag is not hostile to or at war with the captain, and against which no known
operation is under way:

| | shipped Cautious | proposed Cautious |
| --- | --- | --- |
| net at 5,000 days | 142,498 | **170,399** |
| circuits | 180 | 105 |
| shipments delivered | 45 | **80** |
| times crippled on a crossing | 5 | **9** |
| books opened by day 3,000 | 11 of 90 | **31 of 90** |
| deliverable share of the board | 6–10% | 11–21% |
| still refused as unreported | 83–86% | 59–70%, **every one of them `hostile-flag`** |

Safe, Risky and Any are identical under both readings, as they should be. The proposed Cautious
earns a fifth more, delivers nearly twice the shipments, opens three times as many worlds — and is
crippled nearly twice as often, which is the uncertainty being real: she crosses space nobody reported
on and meets what is there. What still stops her is entirely the chart's flags: every remaining
`unreported` refusal is a system flagged by a power hostile to or at war with the captain. `uncharted`
and `known-operation` never came up, because the captain in these runs has the chart and no operations
are reported against the systems in question.

**Nothing about the settings has changed.** The game uses the shipped rules. The proposed reading
exists as `TRADE_RISK_RULES_PROPOSED`, selected by a playtest flag the measurement script sets and
nothing else.

### 5. Everything else

The unmaintained heavy freighter is finished on day 452. Competition: 139,722 / 118,313 / 89,954 each
for one, two and four traders, all at 0–2% idle. The four settings still repair for free and are still
not a net-profit comparison.

---

## What I would ask about

1. **Is 150 days the lifetime?** It is named, it is the middle of the range review gave, and the
   tables show what it does. The number to weigh it against is §2.
2. **Whether the proposed Cautious is the one to ship.** §4 is the comparison review asked for. The
   trade-off is legible: a fifth more income and twice the shipments for nearly twice the cripplings.
3. **The loose settings earning less than the tight ones** (§3) is a shipment-ranking question that
   turnover made visible. Not for this round.
