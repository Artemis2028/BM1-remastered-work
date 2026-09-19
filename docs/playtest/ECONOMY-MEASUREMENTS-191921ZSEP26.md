# Proposed economy — seeded measurements

DTG 191921ZSEP26 · against `75389f7` · **nothing here is implemented**

Asked for by review: *"Give me the economy measurements before locking the numbers. I don't want
arbitrary capacities or '2 contracts everywhere'."*

Everything below is modelled, not built. The model reads the **real** map — the authored populations,
market strengths, installations, routes and board prices — applies the proposed cargo capacities and
the proposed finite supply, demand and contract rules, and reports what falls out. It is seeded, so it
reproduces. `scripts/economy-measure.cjs`.

## The model's parameters, and why they are these

```
score(world)      = population/1000 · 1.0  +  (market − 4) · 0.6  +  installations · 1.5
tonsPerGood       = clamp(score · 6, 10, 220)
replenish         = tonsPerGood / 20 per day        (a full shelf in about three weeks)
demandPerGood     = tonsPerGood · 0.8
openCargoJobs     = clamp(score · 0.22, 1, 6)
jobTonnage        = tonsPerGood · U(0.1, 0.8)
jobPayPerTon      = 3 + 0.8 · travel days
jobRespawn        = one new job every 12 days, up to the cap
lotsPerTrip       = ceil(hold / 110), capped at 8
```

**Population is read per thousand.** The authored figures run from 3,800 to 50,000, and at face value
that one term swamped market strength and installations and put every world on the ceiling — every
world offering 260 tons of everything and six jobs, which is exactly the "2 contracts everywhere"
outcome this was asked to avoid.

**A world with no population and no surviving installation has no economy at all**: no goods, no
demand, no jobs. Nine worlds qualify — Denmark, Iconia, Konael, Harman, Aldnas, Elderea, Xindus, Sato,
Nexus. That is derived from population and installations, not from a name list, which is what §3.5
asked for.

### World capability by size (min / p25 / median / p75 / max)

| size   | worlds | example         | score                            | tons per good               | replenish t/day    | demand per good           | open jobs         |
| ------ | ------ | --------------- | -------------------------------- | --------------------------- | ------------------ | ------------------------- | ----------------- |
| small  | 31     | Biakisch        | 2.3 / 7.8 / 8.9 / 10.7 / 11.5    | 14 / 47 / 53 / 64 / 69      | 1 / 2 / 3 / 3 / 3  | 11 / 38 / 42 / 51 / 55    | 1 / 2 / 2 / 2 / 3 |
| medium | 31     | Rigel           | 11.6 / 12.7 / 14.4 / 16.7 / 18.2 | 70 / 76 / 86 / 100 / 109    | 4 / 4 / 4 / 5 / 5  | 56 / 61 / 69 / 80 / 87    | 3 / 3 / 3 / 4 / 4 |
| major  | 30     | New Switzerland | 18.5 / 19.2 / 22.7 / 26.7 / 58.4 | 111 / 115 / 136 / 160 / 220 | 6 / 6 / 7 / 8 / 11 | 89 / 92 / 109 / 128 / 176 | 4 / 4 / 5 / 6 / 6 |


### Cargo contract tonnage

| band    | jobs |
| ------- | ---- |
| <25     | 80   |
| 100-149 | 20   |
| 150-199 | 1    |
| 25-49   | 115  |
| 50-99   | 102  |

318 cargo jobs open across the map at once; tonnage min / p25 / median / p75 / max = **6 / 24 / 42 / 65 / 172**.

| 50-99   | 102  |

318 cargo jobs open across the map at once; tonnage min / p25 / median / p75 / max = **6 / 24 / 42 / 65 / 172**.

Small worlds carry about 50 tons of a commodity and keep two jobs open; major worlds carry 110–220 and
keep four to six. That is a real spread rather than one number everywhere, and it comes from the map.

### The four hulls measured

| role in the test | hull                    | class        | authored role               | current hold | proposed hold | price  |
| ---------------- | ----------------------- | ------------ | --------------------------- | ------------ | ------------- | ------ |
| starter shuttle  | Lysian Fighter          | shuttle      | budget light craft          | 5            | 8             | 500    |
| ordinary cruiser | Suliban Cruiser         | cruiser      | Suliban raiding cruiser     | 220          | 110           | 124000 |
| normal freighter | Dominion Freighter      | lightCruiser | Dominion logistics ship     | 1350         | 294           | 85000  |
| heavy freighter  | Tholian Isaac Freighter | cruiser      | bulk interstellar freighter | 3500         | 840           | 180000 |


### Profit, one trader alone

| hull             | hold | lots/trip | price  | 100 days | per day | trips | 300 days | per day | trips | hold filled | jobs carried | stops/trip | days/circuit |
| ---------------- | ---- | --------- | ------ | -------- | ------- | ----- | -------- | ------- | ----- | ----------- | ------------ | ---------- | ------------ |
| starter shuttle  | 8    | 1         | 500    | 398      | 4       | 5     | 1234     | 4       | 16    | 96%         | 1            | 1.0        | 17           |
| ordinary cruiser | 110  | 1         | 124000 | 2683     | 27      | 6     | 8215     | 27      | 16    | 39%         | 3            | 1.1        | 17           |
| normal freighter | 294  | 3         | 85000  | 3609     | 36      | 5     | 11887    | 40      | 15    | 31%         | 5            | 1.1        | 18           |
| heavy freighter  | 840  | 8         | 180000 | 3774     | 38      | 5     | 12142    | 40      | 15    | 12%         | 5            | 1.1        | 18           |


### Does a hold beyond a few hundred tons have anything to put in it? (300 days)

| model                        | freighter 294t | heavy 840t | heavy advantage | heavy hold filled | heavy stops/trip |
| ---------------------------- | -------------- | ---------- | --------------- | ----------------- | ---------------- |
| as modelled                  | 12295          | 7373       | -40%            | 11%               | 1.2              |
| longer circuits (80 days)    | 14207          | 17144      | 21%             | 22%               | 2.0              |
| bigger worlds (ceiling 400t) | 10140          | 7373       | -27%            | 11%               | 1.2              |
| both                         | 12395          | 17292      | 40%             | 22%               | 2.0              |


### Heavy freighters competing for the same markets, 300 days

| traders | total profit | each  | trips each | idle days each | loads that would not fit demand |
| ------- | ------------ | ----- | ---------- | -------------- | ------------------------------- |
| 1       | 16772        | 16772 | 9          | 0              | 1                               |
| 2       | 28825        | 14413 | 13         | 0              | 0                               |
| 4       | 45192        | 11298 | 14         | 0              | 8                               |





## The finding that matters

**Under this model a heavy freighter is worse than an ordinary one.** It costs 180,000 latinum against
85,000, and over 300 days it earns less, because no single destination will absorb eight hundred tons
and a board only ever shows eight commodities of which two or three have a spread worth flying. Its
hold sits 11% full.

The sensitivity table says which lever fixes that, and it is not the one I would have guessed:

- making worlds bigger **does not help** — the binding constraint is not how much a world holds;
- letting a trader work **several worlds in one circuit** does: at an 80-day circuit the heavy
  freighter goes from −40% against the ordinary one to **+21%**, and its hold to 22% full;
- doing both gives **+40%**.

So the thing that makes a large hold worth its price is exactly what review already said it should be:
*"Large freighters should be able to combine multiple compatible shipments/routes if their hold allows
it."* Without multi-stop circuits, the heavy freighter tier has no reason to exist and the capacity
proposal's top end is decoration.

**This needs a decision before the economy round starts**, because it changes what the round builds: a
single-destination trader with finite stock is a much smaller piece of work than a trader that plans a
circuit, takes several shipments, and delivers them in sequence.

## Competition is real under this model

Four heavy freighters working the same map make **11,298 latinum each** over 300 days against
**16,772** for one working alone, and eight loads arrive somewhere that cannot absorb them. That is
finite supply and finite demand doing their job, with one shared economy and no separate trader stock
anywhere in the simulation.

## What the model does not simulate

- **Intra-circuit sequencing.** A circuit's days are charged and its revenue credited on completion;
  the ship is not tracked stop by stop inside it. The fleet-trading engine does track legs, so an
  implementation would be more granular than this, not less.
- **Danger.** No encounters, no losses. Real profit is lower.
- **The captain.** Only autonomous traders are simulated; the captain's own hauling would draw on the
  same shelves.
- **Price reactions.** Board prices drift exactly as they do today, ±2 a day. Selling does not move a
  price — only the finite quantity stops the trade. That is deliberate: review rejected price slippage
  as more complicated than BM1 needs.

## Open questions for review

1. **Multi-stop circuits: in or out of the economy round?** The heavy-freighter tier depends on it.
2. **Job pay.** `3 + 0.8 × travel days` makes contracts the main income for a freighter and commodity
   arbitrage the fallback. Is that the intended relationship?
3. **Replenishment at 20 days.** Faster makes the map forgiving; slower makes traders idle.
4. **Are these totals the right size?** One ordinary cruiser nets about 8,000 latinum over 300 days,
   an ordinary freighter about 12,000, a heavy one about 12,000–17,000 depending on the circuit rule.
   Against a 180,000-latinum freighter that is a long payback. Say if it should be shorter.
