# Blocker repairs on top of `fa7de12`

This patch closes the blocking defects found in the independent review of the campaign/stations
candidate. It is deliberately a repair patch: it does not add the architectural work the review and
the master gap register queue behind it (the doctrine adapter, central campaign time, distinct
independent polities, the six missing factions, player-empire diplomacy, persistent hull identity).
Those stay out on purpose, and the blockers that remain open are listed at the end.

`fa7de12` is untouched. This work is a separate commit on top of it.

Nine review rounds have since been run over the repair itself, and every one of them found something:

| Round | Marker | What it found |
| --- | --- | --- |
| Adversarial self-review | **[verification round]** | nine defects the repair had introduced or left, and three false claims in its own change document |
| First independent | **[second review]** | eight more (three others it raised were already closed) |
| Second independent | **[third review]** | three material gaps and two documentation errors |
| Third independent | **[fourth review]** | three more, a documentation error, and two gate checks that reported PASS after silently skipping |
| Fourth independent | **[fifth review]** | two more and a stale metadata file — and gating them turned up two defects of mine that no review had seen |
| Fifth independent | **[sixth review]** | one more, in the source reduction the round before it added — and gating it turned up the half that review had not reached |
| Sixth independent | **[seventh review]** | one more, in the same reduction again |
| Seventh independent | **[eighth review]** | one more, in the last part of that reduction still driven by an effect, and an unverified reachability claim of mine |
| Eighth independent | **[ninth review]** | one more: ownership and observation were the same question, so a wreck went on reporting |

Everything all nine rounds found is fixed here, each with a gate. The markers are there so a reviewer
can see exactly which claims in this document have been wrong before, and weigh the rest accordingly —
several of them were, in every round so far.

## How to check the claims in this document

Two new gates exist for exactly this purpose. Both are adversarial: every check is a reproduction of a
wrong behaviour, written so that it **fails on `fa7de12`** and passes only once the defect is really
gone. Neither asserts that a feature exists.

```sh
npm run test:campaign:blockers                                   # 27 model checks
BM1_TEST_ROOT="$PWD/dist" npm run test:campaign:blockers:ingame  # 40 engine checks
```

Against `fa7de12`: `0/27` and `1/40`. The single check that passes there is the one asking whether a
report about a world the captain has lost stays theirs — `fa7de12` flagged every campaign report as
personal, so it gets that one right by being omniscient rather than by being correct.

Against the candidate the third review saw (`52e2d3e`): `23/24` and `19/26` on the gates as they stood
then, so the eight third-review findings reproduced with behavioural messages —
`a convoy at an unwatched system was reported the moment it arrived`,
`2 of 40 relay accounts named one power in the text and filed another`,
`an unobserved conquest moved terran's displayed holdings from 8 to 9`,
`capturing a Terran world granted the Paso-only Galaxy Dreadnaught`, and
`the two books disagree` for the yard-bearing conquest. Logs: `blockers-*-round2.log`.

Against the candidate the ninth review saw (`4209e77`): `27/27` and `39/40`. The reproduction added
this round fails there:

```
a destroyed installation was still classed as a "relay" source
```

Logs: `blockers-*-round8.log`. It fails on `fa7de12` too, on a precondition, because that tree keeps no
observation record at all.

Against the candidate the eighth review saw (`760f1b5`): `27/27` and `38/39`. The reproduction added
this round fails there:

```
an outbound hull kept a dead crew's station reporting: last observed day 7 jumped, 5 stepped
```

Logs: `blockers-*-round7.log`. The second check added with it is a guard rather than a reproduction and
passes on `760f1b5`: a crew that survives damaged went on reporting there too, for a different reason,
and nothing held that in place.

Against the candidate the seventh review saw (`c4d02aa`): `27/27` and `36/37`. The one check added this
round reproduces there:

```
a jump kept treating the hub as enemy infrastructure after the settlement: 87 was never observed, where stepping observed it on day 4
```

Logs: `blockers-*-round6.log`. It fails on `fa7de12` too, on a precondition, because that tree keeps no
observation record at all.

Against the candidate the sixth review saw (`45b73ea`): `27/27` and `35/36`. The one check added this
round reproduces there:

```
a jump never noticed the hub come back: 87 was never observed, where stepping observed it on day 3
```

Logs: `blockers-*-round5.log`. It fails on `fa7de12` too, on a precondition rather than a wrong value,
because that tree keeps no observation record at all.

Against the candidate the fifth review saw (`a621d4e`): `26/27` and `31/35`. All five checks added in
this round reproduce there, with behavioural messages:

```
a caller's own id still advanced the model's counter from 49 to 50
the table counted a fleet under andorian, which the captain's only account does not mention (it blames ferengi)
an unreported resolution took the fleet off the map the captain has been told about
a jump went on watching a world the captain had lost: last observed day 17 jumped, 6 stepped
plain: a 16-day jump produced a different book: polities, operations, missions, history, stats
```

Logs: `blockers-*-round4.log`. All five fail on `fa7de12` as well, though two of them fail there on a
precondition rather than a wrong value, because `fa7de12` keeps no observation record at all and its
fleet tier cannot be wrong; the tree those two indict is `a621d4e`, where both fail on behaviour.

Against the candidate the fourth review saw (`22ffaf9`): `24/26` and `26/31` on the gates as they stood
then. All seven checks added that round reproduced there, with behavioural messages —
`stepping 40 days settled the engine's day 0 time(s)` (twice, for two different claims about the hook),
`the panel printed the campaign record for a battle at Orion that a ship on station had not yet reported`
(and the same for an installation of the captain's own),
`a conquest nobody reported moved andorian's holdings from 0 to 1`,
`capturing Gorn industry after the discovery still grants nothing, out of 3 active Gorn designs`, and
`a 6-day jump left 0.55 damage on 0-9 where stepping left 0.3`. Logs: `blockers-*-round3.log`.
Those seven fail on `fa7de12` too, and on behaviour rather than on a missing symbol: the checks work
out the captain's best source at a system for themselves, from primitives every tree has, rather than
asking the runtime for the judgement under test.

One check is a guard rather than a reproduction: `FOREIGNYARD` passes on `52e2d3e`, because that
candidate's integration fix was already correct — the third review's point was that nothing protected
it. It measures the retooling *rate* now, not just that integration finishes.
The in-game harness binds each runtime symbol separately and tolerantly so it loads against the older
tree — a gate that cannot start against the candidate it indicts is not evidence.

Three reproductions do not fail with a wrong value and are worth knowing about:

- `B12` wedges the page. `campaign readiness <faction> 1e999` became `Infinity` and appended hulls
  until the tab died, so that check runs last and is raced against a 25-second deadline.
- `B1` needs the expedition to have sailed before the reserve exists, so the gate reinforces the
  Dominion core on the launch effect and then watches for a near-side capture. On `fa7de12` it
  reports `the Dominion took Minor without a bridgehead` — the reviewer's own reproduction.
- `B9` compares two otherwise identical galaxies, one with a Klingon yard placed at Earth. On
  `fa7de12`: `the host gained 1 berths from a yard it does not own`.

Two checks assert on fields this patch introduces (`standDownPending`, `maxLiveRecoveries`), so on
`fa7de12` they fail on an absent field rather than on a wrong value. The defects behind them are real
— `fa7de12` leaves a battle running after peace, and its recovery cap is a slice that only trims
completed records — but those two messages are weaker evidence than the rest.

## The economy gate's last check

**[tenth review]** For nine rounds this document carried `ships-economy` at 29/30 as a known failure,
on the reading that its "completed delivery earns destination trust" check assumed docking implied
proximity to the world while the 600-unit drop-off rule from `5461f55` does not grant that. That
reading was half right: the rule is deliberate, and the check was wrong to assume otherwise — but the
conclusion drawn from it, that the check could not pass without changing the mechanic, was not.

The fixture is what needed fixing, and it now does what a captain does: it undocks, flies to within the
drop-off rule of the world, and delivers there. The contract also names its issuer
(`employerFaction: 'neutral'`) rather than leaving the issuing faction to be inferred, so the check
measures the two standings it is named for. Nothing about the delivery mechanic changed: cargo still
has to reach the world, docking alone still does not deliver it, a security checkpoint still blocks an
uncloaked delivery, and cloaking still permits a covert drop-off — all of which `briefing-cargo-probe`
covers separately.

`ships-economy` is 30/30, and all 33 gates pass.

## The ninth review

An eighth independent review held the candidate for one finding, found by auditing the subsystem the
last three rounds have been about rather than by re-reading the last repair. It is a live defect in
ordinary daily play, not only in a bulk call.

### F6 — a wreck is still yours, and it is not your eyes

Destroying an installation records the wreck and **keeps** the definition and its owner, which is right:
the loss, the salvage and the reconstruction are all the captain's business. But the source map asked
only who owned the installation, so a destroyed one kept its system on the map. A wreck went on filing
dated, relay-grade controller observations indefinitely, and campaign events there were still
classified as dependable relay dispatches rather than late, fallible rumour.

The station-role model already had the right answer and was not being asked: a destroyed installation
is `status: 'destroyed'` with every service and effect cleared, and `Campaign.relayConnectivity` excludes
it. Only the ownership shortcut leaked.

Two questions that had one answer now have two:

- `ownsReportLocation` — **the captain's business.** Unchanged, ownership only. A report about a world
  where they own a wreck is still theirs, which is what makes the loss and its reconstruction matter.
- `watchesReportLocation` — **the captain's eyes.** Ground they hold, or an installation of theirs that
  is still standing: `stationIsLiveSource`, which accepts `operational`, `damaged` and `unstaffed` — the
  same three the campaign model already uses for an installation it will draw on at all, so the two
  cannot drift apart. A skeleton crew still reads the traffic; a wreck has no receivers, and neither
  has a hull still under construction.

One predicate, used in all three places that decide it: the frozen context builder, the daily
re-derivation, and the no-context fallback. The Dominion interdiction line, which asks whether the
captain has anything at the wormhole entry that can see the convoys, now asks the eyes question too.

`F6` walks the whole arc — a standing installation observing a world, the same installation destroyed,
the world changing hands unobserved, the report still personal, and a rebuilt installation reporting
again. The gate decides for itself whether an installation is standing, from the resolved capability,
because the helper it used before carried the same ownership-only rule the runtime did and would have
certified the defect. [ninth review]

## The eighth review

A seventh independent review held the candidate for one finding and one correction to this document.
The finding is in the last part of the source reduction that was still driven by an effect rather than
derived — which, after the last two rounds, is exactly where to look.

### F5 — an outbound hull kept a dead crew's station reporting

Three rules disagreed. The source map excludes a vessel that is already in transit, because a crew on
its way somewhere is not watching the place it left. The strategic book still files that vessel at its
departure system until it arrives, and marks it `assigned`, so the resolver never counts it as a
defender and it survives every battle there. And the survivor test — the one part of the reduction that
read the day's effects — asked whether *any* hull of the captain's was still at that index.

So when the crew that was actually watching was killed, the outbound hull answered yes, and the system
went on filing dated observations for the rest of the call. The reviewer's reproduction: stepping
observes on days 2 and 3, a single call through day 6 observes on 2, 3, 4, 5 and 6.

The survivor test now uses the same rule as the builder, which is the only way two rules cannot drift
apart. The context no longer records *that* a system has ships; it records *which crews are watching
there*, by fleet id. `defenderLosses` names the vessels it destroyed, and those ids are struck off; a
system stops being a source when the last crew that was watching it dies. A vessel the builder excluded
was never in the set, so it cannot keep one alive, and a crew reported as damaged rather than destroyed
is left exactly where it is — which the second new check holds in place.

### The Andreas claim was mine, and it was wrong

The previous round's write-up offered Andreas — an independent world carrying a Terran-owned command
outpost — as the ordinary instance of F4. The reviewer checked it: that outpost carries relay strength
1, which covers only Andreas itself, and a captain who has taken Andreas already observes it through
holding it. It does not produce the neighbour divergence F4 is about.

The F4 gate does not depend on that claim — it constructs the configuration by taking a sector hub and
leaving it in enemy hands — but the sentence in this document was an assertion of reachability I had
not verified, one round after I corrected a reviewer for the same thing. The authored galaxy has two
sector hubs, at Earth and Qo'noS, and taking either world moves its hub to the captain with the rest of
the displaced sovereign's installations, so the natural configuration does not currently exist in it.
F4's gate is a guard on the general rule, and this document now says so. After the seventh round's
repair the question is moot for correctness in any case: the map is re-derived every internal day, so
no path has to be reachable for it to be handled.

## The seventh review

A sixth independent review held the candidate for one finding, in the same reduction as the round
before it — which is the third round running that this one function has been wrong.

### F4 — a settlement changes who a relay answers to, and the map did not notice

`refreshCampaignShadow` writes a settled war into the shadow as peace before the source map is reduced,
which is the ordering the sixth review's repair established. But the reducer decided whether to rebuild
the map from a *list* of things that could change it: an installation whose condition changed, or a
conquest. A settlement was on neither list.

That matters because relay eligibility is not only about who owns a hub. A foreign installation
standing in a world the captain holds is theirs to read as long as they are not at war with its owner,
so a war ending inside a bulk call should bring such a hub on side — and it did not, for the rest of
the call.

**[eighth review]** This section originally offered Andreas, an independent world carrying a
Terran-owned command outpost, as the ordinary instance of that. It is not one: that outpost carries
relay strength 1, which covers only Andreas itself, and a captain who holds Andreas already observes it
by holding it. See *The Andreas claim was mine, and it was wrong* above. The `F4` gate constructs the
configuration instead, and is a guard on the general rule rather than a reproduction of an authored
one.

### The repair is to stop keeping a list

Adding `warResolved` to that list would have closed this one. It would also have been the third patch
to the same list, after the repair tick (**[sixth review]**) and this one, so the list is the defect.

The captain's standing and relay reach are now re-derived from the day's world **every internal day**,
with no trigger at all. What that derivation reads is exactly what `Campaign.relayConnectivity` reads:
controllers, installation ownership, each installation's condition, and the relation between the
captain's colours and each owner. Nothing that changes any of those can be forgotten, because nothing
has to be remembered. The one part still driven by an effect is the loss of a ship on station, because
a hull is only ever lost through `defenderLosses`.

It costs one sweep of the chart per internal day. Measured on the bound that matters — a 2,000-day
catch-up, the largest jump the model will take in one call — the whole per-day hook now runs in 4.1 s
against the 6.4 s that tree spent before any of this existed, so the sweep is inside the noise of what
the round-4 hook already removed.

## The sixth review

A fifth independent review held the candidate for one finding, in the reduction the round before it
added — the same shape as every round of this repair.

### F3 — the source map was reduced before the day's installations were written down

`settleCampaignEngineDay` recomputed relay reach from the day's world view and only *afterwards* wrote
the day's station records into that view. The recomputation therefore read every installation at the
strength it had the day before. The reviewer executed the two functions directly and printed the gap:
a sector hub at half condition whose correct record covers system 0 alone, while the cached map still
carried systems 0 and 1.

The hook's five steps are now in the order their meanings require, and the comments say why:

1. the day's repair, then the day's fresh damage, land in the ledger;
2. the day's observations are recorded with the sources the captain had **while the day happened** —
   a relay wrecked in the fighting files that day's account and nothing after it;
3. the shadow catches up: what an installation whose condition changed can now do, what a conquest did
   to ownership, what a settlement did to a relation;
4. **then** the source map is reduced, reading step 3's records;
5. the captain's model-side account takes the day's income.

### And the half of it the review did not reach

The reducer ran on the day's *effects*, and it recomputed for a conquest or a `stationDamaged`. Repair
is a tick rather than an effect, so it was not in that set at all: a sector hub repaired back over the
threshold inside a jump never re-entered the captain's coverage for the rest of the call, however many
days followed. It now recomputes whenever any installation's condition changed that day, in either
direction.

That matters for which half is reachable. The reviewer's example was a type-89 Subspace Comm relay
damaged by offscreen battle resolution, but the model damages only installations that mount a defence
(`(s.cap.effects.defense || 0) > 0`), and the only station type carrying sector reach — type 89, relay
2 — mounts none. No battle can damage it. The direction that *is* reachable inside a strategic day is
the repair tick putting a damaged hub back on the air, which is the half the proposed repair would have
left open, and it is what `F3` reproduces: a hub at 0.05 damage, one day of repair, and a neighbour
that stepping observes on day 3 and a jump never observes at all.

## The fifth review

A fourth independent review held the candidate for two findings and a stale metadata file. Both
findings sit inside the behaviour the round before claimed to close, at the next reader along — which
is the shape every round of this repair has had.

### F1 — the panel read the report and then counted the fleet

The fourth round made `campaignOperationKnowledge` return only delivered accounts for a remote
operation. Its two callers then filtered and counted the *operation*:

- the Other Powers table counted active operations with `o.faction === id && o.status !== 'resolved'`,
  so an account that blamed Romulus for a Klingon fleet incremented the Klingon row and not the
  Romulan one;
- "Fleets in motion" and "Recent battles" were separated by `o.status`, so an operation that ended
  before its completion account arrived jumped from one list to the other while the sentence beside it
  still said the fleet was on its way. The wording was fallible and the folder it sat in was not.

The record is now the whole interface. Reports carry `claimedAttacker` — who that account blames,
kept apart from everyone it merely involves, and preserved through delivery — and
`campaignOperationKnowledge` returns `{ level, reports, latest, phase, claimant }` where `phase` comes
from the newest delivered account (by day, then by how far along it says the operation is) and
`claimant` from what that account blames. `campaignKnownOperations` filters on that record and never on
the operation. Presence keeps its exception: standing in a system with a battle engaged in it still
reads the campaign record, because the captain is watching it happen.

### F2 — a jump kept using sources that were lost inside it

`advanceCampaign` built the captain's source map once and reused it for every internal day, on the
premise that ownership and relay reach cannot change while those days settle. They can: that is what a
conquest *is*. A world taken on internal day three went on reporting its new owner to its old owner
for the rest of the interval, so a jump recorded an observation on day seventeen that stepping stopped
recording on day six, and the books diverged.

The context is now reduced by each day's effects, and the order is the point: the reduction runs
**after** that day's observations are recorded, because a source destroyed in the fighting was there
while the fighting happened. It files that day's account and nothing after it — which is exactly what
stepping produces, since the engine rebuilds the map between calls. A conquest or installation damage
re-derives ownership and relay reach from the day's world view; hulls the strategic resolver killed
are dropped from the map for that system when the book says none of the captain's are left there.

### F3 — the machine-readable summary was a round out of date

`validation/RESULTS.json` still carried the previous round's suite shape and named a candidate that no
longer existed, while `CANDIDATE.json` beside it was correct. It is now generated by
`validation/make-results.py` from the logs in that directory — gate counts, suite scores, baselines and
the source/`dist` comparison are all read back out of the run rather than typed — and `run-gates.sh`
calls it as its last step, so it cannot drift from the run it describes again.

### And two defects of my own, found while gating F2

Writing the F2 reproduction meant comparing a stepped and a jumped book field by field for the first
time *in the engine* rather than in the model. They did not match, and the reason had nothing to do
with intelligence:

- **The engine spent the model's ids.** Contracts the engine offers between model days took their ids
  from `nextCampaignId`, so a jump — which offers them after sixteen days of model allocations instead
  of after one — handed different ids to every hull and operation created later. Ids seed rolls, so
  battles then resolved differently: same counter total, same entity counts, different books. The
  engine now allocates from a counter of its own (`book.engineCounter`), and `offerMission` accepts a
  caller's id without consuming the model's. `IDSPACE` is that reproduction.
- **The captain's account stood still in a jump.** The model leaves the player's treasury alone and
  emits the day's income as an effect; a stepped caller refreshes the model's copy from the captain's
  real latinum on the next call's `syncPlayerPolity`. A jump has no next call, so the copy stayed at
  the value it was synced with. The per-day hook now advances that copy by the day's income — the
  model's copy only. The captain's real latinum is still credited exactly once, by
  `applyCampaignEffects`, after the call returns.

With both closed, a sixteen-day jump and sixteen one-day steps produce byte-identical books in the
engine, with and without the captain holding a world of their own. `EQUIV` compares every top-level
field of the book and the digest, and names the fields that differ when they do.

## The fourth review

A third independent review of the candidate held it again, for three material gaps, one documentation
error, and gaps in the gates themselves. All of them are about the same thing in different clothes:
the difference between a source and a fact, and the difference between a day and a call.

### I1R — "direct" was a category, and it should have been a place

The third review's repair built four tiers for what the captain is *told*, and then the Empire panel's
own reader ignored them. `campaignOperationKnowledge` returned `direct` — the campaign record: true
faction, exact status, arrival day, hulls present, both sides' losses, labelled "observed in your
space" — for any operation at a system the captain owned an installation in or had a ship at. So the
pipeline delayed and fuzzed the account, and the panel printed the truth beside it.

The same mistake in the other half of the panel. Holdings for the Other Powers table were counted as
`world.systems.filter((s) => s.controller === id && isReportSystemKnown(s.index))` — the *live*
controller of every system the captain had ever visited. A world they flew through on day 3 and never
saw again reported its current owner for the rest of the campaign. The previous round's fix removed
the uncharted half of that error and left the visited half in place.

Both are now the same rule. Only presence is direct, and only of a fight that is actually there:

- `campaignOperationKnowledge` returns `direct` when `campaignIntelSource` says `local` **and** the
  operation is engaged at that system. A crew on station and an installation of the captain's own are
  sources, not eyes: what they know is what they have sent, and what they have sent is a delivered
  report. A fleet still in transit is not visible from its destination either. An operation with no
  delivered report does not appear in the panel at all, and a resolved battle is always read from the
  account of it — a local account *is* the campaign record, so nothing is lost by reading it that way.
- Holdings come from `book.observations`: a dated record, per system, of who held it the last time the
  captain could actually see it — standing there, a ship on station, or their own relays and
  installations reading its traffic. Rumour does not write it. A conquest nobody reported leaves the
  captain's books exactly as they were, stale and honest, still showing the last holder and still
  dated to the day they saw it.

Observations are written from the per-internal-day hook below, so a jump and a walk record the same
observations on the same days, and the panel stamps the current day's observations when it is opened
on a day the model has not settled.

### I2R — the Gorn reserve was left out of the recoverable set

The third review's repair narrowed industrial recoverability to `general`, `dominion-core` and
`dominion-all`. That was right about secrecy and wrong about the Gorn: `reserved-gorn` is regional
restriction, not a named vendor, so capturing Gorn industry granted nothing at all — not before the
authored discovery, which is correct, and not after it, which is not.

`recoverableDesignRegions()` now adds `reserved-gorn` when `getCampaignDiscoveries().gorn` is true.
The authored discovery requirement is untouched and still gates everything Gorn: before it,
`isNamedDesignException` refuses every Gorn hull anyway, and the region is not recoverable either.

### I3R — damage advanced once per day, repair once per call

Station damage was applied inside the strategic day. Station repair was a loop in `advanceCampaign`,
which runs once per call. Stepping 40 days therefore healed 40 days' worth; jumping 40 days healed
one. The reviewer's reproduction: a Klingon assault on Vega from a seeded start, days 2–40, leaving
platform damage at `0` when stepped and `0.9` when jumped, with different checksums.

Damage and repair are two halves of one ledger, so the strategic day now advances both. The model
calls `world.settleDay(view, day, dayEffects)` once per internal day, after it settles that day, with
that day's effects and the view it stepped against — the private shadow on a multi-day call, the real
world on a single-day one. `main.js` implements it: repair first (a day's healing applies to the
damage standing at the start of that day, which is the order daily stepping always had), then that
day's fresh damage lands in the book, then the shadow's station records, relations and captured
installations are refreshed for the next day. Because the book itself is written there rather than
after the call returns, the day after a battle opens with the same capabilities either way.

Two consequences worth stating. The `stationDamaged` case in `applyCampaignEffects` no longer writes
damage — effects settled by the hook carry a mark, and the case only reports, so the fraction is never
debited twice; damage raised outside the strategic day (a local battle, the debug menu) is still
settled on its way through. And repair now ticks once per *settled day* rather than once per call, so
a caller that advances the same day twice no longer heals twice.

A third consequence, found while gating this: every call now steps against the private shadow, not
only a multi-day one. The first cut of the hook handed the caller's own snapshot to a single-day call,
so on the day a world changed hands the engine was handed the new holder when jumping and the old one
when stepping — and anything the engine records from that view, the observations above included,
diverged on exactly the day it mattered. `DAYVIEW` is that reproduction, and it failed on the first
cut of this round's own repair.

### The documentation error

The change document said `campaignEventStake` is read before control transfers, and the comment in the
code said so too. The code did the transfer first. The claim was the correct design — a world the
captain has just lost is still theirs as far as the report is concerned, however late the account
arrives — so the code was reordered to match rather than the sentence softened.

### And the gates themselves

The reviewer's last point was about the evidence, not the code. Two checks — the relay-account check
and the unobserved-conquest check — returned `{ skipped: true }` when they could not find a galaxy to
set themselves up in, and a skipped check printed `PASS`. A check that reports success because it
never ran is worse than no check. Both now fail with the reason they could not be set up.

Seven new reproductions were added — two in the model gate, five in the engine gate — all of them
failing on `22ffaf9` and on `fa7de12`:

| Check | Reproduces |
| --- | --- |
| `DAYHOOK` (model) | the engine's day is settled once per internal day, with that day's effects, stepped or jumped |
| `DAYVIEW` (model) | the view the engine is handed on the day of a conquest already holds it, stepped or jumped |
| `I1R a ship on station is a source, not the captain's own eyes` | the panel printed the campaign record for an unreported battle |
| `I1R an installation of your own is a source…` | the same, through an owned installation |
| `I1R a world you visited once is a memory, not a live feed` | an unreported conquest moved a power's displayed holdings |
| `I2R Gorn industry is recoverable after the authored discovery, and not before` | both halves: nothing before, something after |
| `I3R a jump across damage and repair produces the book that stepping produces` | final damage, live condition, status, history and checksum |

## The third review

A second independent review of the candidate produced by the round above held it again, for three
material gaps and two documentation errors.

### I1 — campaign intelligence still had truth and classification bypasses

The source model introduced in the second review was right but incomplete. Five holes:

- **The Dominion convoy never went through it.** `dominionConvoy` still called `campaignReport`
  directly: real identity, exact reinforcement count, published on sight, gated only on the wormhole
  system having been visited once. Exactly the defect the pipeline exists to remove. Routed.
- **Relay accounts said one thing and filed another.** The text printed the true attacker while the
  stored `factions` held the assessor's guess; sampled over 1,000 assessments, 111 filed a different
  power or none while every one of them *said* Klingon. Resolved by deciding what a relay is: the
  captain's own network reading transponders, so identity and place are dependable and strength is
  not. Relay accounts are now authoritative on who and silent on how many, and the record says the
  same thing the sentence does. Where a claim *is* fallible, the text and the metadata both come from
  the same assessment.
- **A remote crew was treated as the captain's own eyes.** Standing in the system, having a ship on
  station, and owning an installation were one infallible tier. They are now four: `local` (a fact),
  `fleet` (the seeded assessor at fleet accuracy — better than hearsay, not certain), `relay`
  (authoritative identity, no numbers), `rumour` (late, no numbers, can name the wrong power).
- **Involvement was thrown away with attribution.** The delayed branch discarded `playerRelated` and
  the involved factions, so a world the captain had just lost, or an attack on the faction whose
  colours they fly, could fall into the six background slots. Being wrong about *who did it* does not
  make an event stop involving the people it involved: `campaignEventStake` now captures the harmed
  party and the captain's stake at event time — before control transfers — and carries them separately
  from the claimed attacker.
- **The Other Powers table read live truth.** Strength was banded and dated; the world count was
  copied exactly from live campaign state, so an unobserved conquest corrected the captain's books on
  the next refresh. Holdings are now counted from charted space only, dated, and shown as `N+` — what
  you have seen, as of when you saw it.

### I2 — captured industry was unlocking secrets, not just regional designs

Separating retail eligibility from industrial recoverability was the right repair for the Dominion's
region-tagged hulls, but the new predicate admitted every active priced hull of the culture. Capturing
any qualifying Terran world therefore granted the Paso-only Galaxy Dreadnaught and Excalibur, and any
Romulan world granted the Remus-secret Reman Warbird.

Regional restriction and secrecy are not the same thing. A hull a culture builds throughout its own
space is ordinary industry. A hull that exists at one authored place under one named vendor is not,
and that gate is per design and survives relocation. `isRecoverableIndustrialDesign` now admits only
`general`, `dominion-core` and `dominion-all` regions and refuses anything carrying a `specialVendor`
— so the six ordinary Dominion designs stay recoverable while Paso, Remus, the independent endgame
vendor, undiscovered Gorn material, the Tactical Cube and Borg material do not.

### I3 — the bulk shadow only shadowed half the world

The shadow updated the captured system's controller but not the installations that change hands with
it, so a conquest of a world with a government yard produced different berths, yards, repair capacity
and checksum when jumped than when stepped. Station condition and settlements were not reduced at all.

The shadow now overrides controllers, installation ownership, individual station records and
relations. Conquest it reduces itself — the displaced government's installations change hands, foreign
and private owners keep theirs — and for anything only the engine can interpret it asks through a
hook. Effects nobody reduces are the documented limit of bulk equivalence rather than a silent one.

**[fourth review]** That hook was `world.reduceEffects(shadow, effects)`, called only on a multi-day
call and only to update the shadow. It has been replaced by `world.settleDay(view, day, dayEffects)`,
called once per internal day on every call — see I3R below for why the distinction mattered.

### Two documentation errors

- The change document said B2 emits an `operationStoodDown` effect. The second review's duplicate fix
  deliberately removed it; there is one terminal effect, `operationResolved` with outcome
  `stood-down`. Corrected throughout.
- The handoff claimed foreign-yard integration was gated. The test only checked that integration
  *finished*, which it would have done even if the foreign yard were driving it. It now measures the
  rate against a yard the holder owns.

### And a wording defect

A settlement can arrive after the shooting starts. Every `stood-down` outcome was reported as a
withdrawal "without a fight", contradicting the history entry beside it when the operation was already
engaged with losses on the record. An operation that had fought now "broke off the action under the
settlement"; only one that never made contact withdrew without a fight.

## The second review

An independent review of the first candidate produced eleven findings. What each one led to:

| # | Finding | Repair |
| --- | --- | --- |
| R1 | An `fa7de12` save does not receive the new configuration | Already closed by the verification round; the gate now loads a **genuinely serialized `fa7de12` book** (`scripts/fixtures/fa7de12-campaign-book.json`, initialized and advanced 60 days on that build) instead of a candidate book with keys deleted |
| R2 | The Empire panel reads observations, but the effect pipeline publishes perfect truth | Campaign events now go through a source-aware assessment — see below |
| R3 | A bulk call diverges from daily stepping once a capture changes the world | The day loop steps against a private world copy whose controllers update as captures happen |
| R4 | The checksum still omits `seed`, `resolutions`, `relocatedOffers`, `assessments`, `migratedBudgets` | The digest is now the whole book, key-sorted, so nothing can drift out of it |
| R5 | One peace stand-down produces two effects and two reports | One terminal effect for every way an operation ends: `operationResolved` with outcome `stood-down`, and no separate `operationStoodDown` |
| R6 | A full fleet floods history with the same completion message | Already closed by the verification round |
| R7 | Captured Dominion industry grants no Dominion designs | Retail eligibility and industrial recoverability are now different questions |
| R8 | Ownership leaks into integration and station repair | Both now use the same ownership rule as production |
| R9 | Phase cheats leave dangling or contradictory state | Operations are stood down through the ordinary path; `advance` rejects non-finite input |
| R10 | A mixed-origin raid returns every survivor to one origin | Each hull remembers where it set out from |
| R11 | The archive says 29/30, its own log says 27/30 | Already closed by the verification round, including the nondeterminism behind it |

### R2 — a system you once flew through is not a listening post

This was the serious one, and the first candidate's own B13 gate could not see it: it inserted an
operation directly and deleted any matching report, so it tested the panel's reader and never the
writer. The panel was right; the pipeline feeding it was not.

`applyCampaignEffects` turned every `operationLaunched`, `operationArrived`, `operationResolved`,
`captureSystem`, `stationDamaged` and `integrationComplete` effect into a report carrying the campaign's
own truth — real faction, real target, exact hull count, exact losses, exact design counts — gated only
on `addGalaxyReport`'s check that the system had been visited once. Labelling the text "Fleet
assessment — mistakes possible" did not make it fallible; it was copied from the effect.

Those effects now go through `reportCampaignEvent`, which asks `campaignIntelSource` how the captain
could have known:

- **direct** — standing there, a ship on station, or an installation of their own: the campaign record,
  immediately, `Confirmed local observation`. *(Superseded twice: the third review split this into four
  tiers, and the **[fourth review]** cut "direct" back to presence alone. What the tiers are now is in
  the third-review section above and in I1R below; this row is what the second review's repair did.)*
- **relay** — the system is inside the captain's relay coverage: a timely dispatch with the right
  faction and place but no numbers, delayed by the assessment's own delay.
- **rumour** — anything else, including a system merely visited once: a late, second-hand account with
  no numbers, whose attribution can be wrong, `Unconfirmed civilian report`.

Non-direct accounts are queued into the existing `news.pending` pipeline and delivered by
`collectRegionalIntel` when their delay elapses, and their claims come from `assessIntel` — the same
seeded, fallible assessor the rest of the intelligence model already uses. A foreign power's industry
integration produces no rumour at all; it is not the sort of thing travellers notice.

### R7 — retail eligibility and industrial recoverability are different questions

Every active Dominion hull carries a `dominion-core` or `dominion-all` region tag, so filtering a
captured culture's catalogue through the market's stocking rule granted a conqueror **nothing**. The
first candidate documented that as intended; it is not — the settled rule is that taking a culture's
major populated or heavily stationed world lets you build that culture's ships, apart from named
exceptions.

There are now two predicates. `isGeneralProductionDesign` answers "may a general yard stock and lay
this down with no licence behind it", and keeps the market's rule. `isRecoverableIndustrialDesign`
answers "can a captured yard go on building what it was building", and excludes only the named
exceptions: the Tactical Cube, and Gorn material until the authored discovery event. A licence is
judged by the second; an unlicensed native design still has to clear the first.

## What was repaired

### B2 — a settlement now ends the operations it makes illegal

`enforceRelations` runs every campaign day, before planning. Any live operation whose objective is no
longer a legal target — peace, an alliance, or the world changing hands to a power the attacker is not
at war with — is stood down that day through the same terminal effect every other ending uses:
`operationResolved` with outcome `stood-down`, one history entry and one report. The force is released to where it set out from; no further losses are taken.

An operation the loaded scene has claimed is left alone, so a battle in progress is never yanked out
from under the player. `releaseOperationFromScene` clears `resolvedBy`, and the next day's pass stands
the operation down for the same reason it could not that day. `standDownPending` records that pending
state for the engine and the gates to read; it is not what drives the stand-down.

Reproduced before: launched day 1, peace day 3, still `engaged` on day 25 with five losses.

### B1 — the Dominion cannot fight past a bridgehead it does not hold

The entry constraint is expressed in the map rather than in a faction name. `nearSideSystems` walks
outward from the wormhole's near terminus without ever crossing the wormhole itself, and
`dominionPlanningBounds` applies the result:

- With **no** Dominion-held world on the near side, the entry system is the only legal objective, and
  the force must come from the far side — that is, through the wormhole.
- With a bridgehead, near-side objectives are open, and only forces at a near-side world the Dominion
  **controls**, or at the staging terminus, may be committed. A Dominion hull parked at a near-side
  world it does not control is not available; the rule is stricter than "already on the near side".

Two other routes into the near side are closed with it. `launchBudgetedAmbientRaid` used to take
globally ready hulls and rewrite `h.systemIndex` to the loaded system — a literal teleport. It now
draws only on hulls already in the system or one route away (`campaignRaidForce`), and
`campaignCanRaid` uses the same test, so a power with nothing within reach is not offered as an
attacker. The debug event controls keep working through a forced override that *relocates a real
squadron* of an actual belligerent to a neighbouring system and then runs the ordinary path; they
never fabricate hulls, and the control's own result line says so when it had to stage a force.

**Late saves.** A book created on an old save emitted the warnings and the invasion together. The
Dominion phase days are offsets from the first campaign day, so `initializeCampaign` re-anchors them
once (`book.dominion.anchorDay`). A campaign that first runs on day 200 still gets the whole arc.

### B3 — the fleet cap counts standing hulls, and a delivery means a hull

`maxHullsPerPolity` counted destroyed records, so a polity that had fought a war could never build
again. It now counts living hulls, and `pruneLostHulls` clears destroyed records once no unresolved
operation still names them.

Worse than the cap itself: when `addHull` returned null the order was still marked `delivered`, with
`deliveredHullId: null`, and `builtHulls` and `stats.hullsBuilt` were incremented. Reproduced:
104,915 L and 79,994 materials spent for zero live hulls. A completed order that cannot be commissioned
now holds at `awaiting-commission`, is retried, is never announced, never counted, and never re-charged;
a loss frees the berth and it commissions.

**[verification round]** Two follow-on defects in that repair: the "announce once" guard was dead
(`status` was overwritten eight lines above the test for it), so the notice fired every few days and
evicted the entire campaign history — it is now keyed on `awaitingSince`, once per order. And the AI
kept ordering hulls it had no room to commission, paying for each one, because the replacement target
was not clamped to the fleet cap. It now orders only into real remaining capacity.

### B6 — a captured licence is used, and eligibility is not bypassed by one

AI production called `world.pickHull`, which only ever returns the polity's native pool, so a Romulan
polity holding a Terran licence and a rich yard built only Romulan hulls over 200 days. `pickBuildDesign`
keeps the native pool's lore weighting and draws `foreignDesignShare` (0.35) of orders from the
licensed catalogue, through a second seeded draw so determinism is unchanged.

Eligibility is asked of the engine through a new `world.designEligible(shipId, polityId)` hook, backed
by `isGeneralProductionDesign` in `main.js` — the same rule the market uses (`eligibleForStock`), so
retired, prototype, priceless, Tactical Cube, non-shipyard, special-vendor and region-restricted hulls
stay out of general production whoever holds the licence. `nativeDesigns` applies the same filter, and
integration only grants licences for designs the acquirer could actually build.

**[second review]** The first cut of this filtered captured catalogues through the retail rule, which
granted a conqueror nothing at all for a region-tagged culture — every Dominion hull, and Borg and Gorn
material besides. See R7 above: a licence is now judged by whether the yard could build it, not by
whether a shop may stock it. Gorn material stays out until the discovery event, and the Tactical Cube
stays out permanently.

### B8 — everything that defends can be lost, and nothing is counted that cannot

One list, `defendingPolityIds`, decides both how strong a world's defence is and who takes the losses:

- An allied squadron parked at a world raises its defence **and** takes attrition. Before, only the
  controller's hulls could be lost, so an allied Romulan fleet at Earth raised the number and paid
  nothing over thirty days.
- The captain's vessels stand with any holder they are not at war with — their own worlds, allies, and
  neutral hosts such as Bajora against the Dominion. That is the rule the removed `extraDefense` hook
  encoded and it is kept, except that now those ships can also be lost. Whether an AI third power joins
  someone else's defence is a planning question (FD-15), not a repair, so it is not granted here.
- `world.extraDefense` is **gone**. The captain's vessels are the player polity's hulls, synchronised
  from the real fleet by `syncPlayerPolity`, so they were being counted twice at a world the player
  held (355 → 535 for one 180-strength ship). They are counted once.
- Losses reach the real fleet through a `defenderLosses` effect and `applyPlayerDefenderLosses`, with a
  report naming what was damaged or destroyed.

**[verification round]** The first cut of this removed the neutral-host case entirely, which silently
disabled the wormhole blockade for every captain whose flag is not on Bajora's friendly list — the
interdiction check reads `localDefenseStrength` at the entry system. Restored above, with a gate.

**[verification round]** A vessel instantiated in the loaded scene was still counted as a strategic
defender. The losses assigned to it were dropped on the way back (the live actor owns that hull) and
`syncPlayerPolity` restored it to full strength the next day, so the resolver booked a fresh kill every
day against a ship that was never scratched — reachable by jumping out of a system with a battle
running, because `world.localSystem` is null during warp. `syncPlayerPolity` now marks scene-owned
vessels `assigned`, which keeps them out of both the defence total and the attrition pass.

Ships you leave on station are genuinely at risk. That is the point of them counting.

### B9 — a foreign yard in your space is not your yard

`stationEffects` credited every installation in a controlled system to its controller, so a
Klingon-owned heavy yard placed at Earth raised **Terran** berths 5 → 6 and heavy berths 1 → 2. It now
counts only installations the polity owns, plus unowned infrastructure. Revenue, materials, berths,
heavy berths, workforce, energy and repair capacity all follow ownership. Morale is deliberately left
open to any operational station in the system: shore leave is a place, not an asset.

`queueBuild` also required only that the polity own an operational yard there, while production
capacity is only ever gathered from systems it controls — so an order accepted at a foreign-held
system was silently marked `lost` the next day. Ordering and building now agree.

**Known consequence:** a foreign or private station in another power's system now contributes to
nobody's strategic accounts. Host taxation of foreign installations is a real question and is left to
the economy pass (CE-14) rather than guessed at here.

### B10 — station roles are enforced at the cited bypasses

- **Plans** are gated on `services.plans`. A vendor that sells hulls but issues no plans now says so.
  (Sales are still required as well, on a separate line with its own message; a site that issues plans
  but sells no hulls refuses too.)
- **Heavy hulls** need a heavy berth. `fleetBuildMassBlock` holds the player's own yard to the rule the
  strategic model has always applied to AI production.
- **Build sites** must actually build. `fleetBuildStationStatus` returns `unsuitable` for a site with no
  construction service and `paused` for one that is not operational or damaged; owning a relay does not
  make it a shipyard. `Fleet.progressBuilds` already treats anything other than `owned` as paused.
- **Recruiting** a boarding crew needs `services.recruit`, exactly as training needs `services.training`.
- **Plan stock tiers** come from resolved capabilities — research effect, construction service, berths,
  heavy berths — instead of substrings in the installation type's name.
- **Commodity trade** needs a site that does commerce of some kind, or the world itself within cargo
  range. The target is the site that does none at all: a relay, a subspace communicator, a defence
  platform, which were exposing the world's market simply because they could be hailed.

**[verification round]** The first cut of that last item gated on `services.commodities` alone, which
also blocked starbases, shipyards and bars — roles that plainly trade but do not carry that flag. The
gate now checks both halves: a no-commerce site must refuse, and a trading site must not.

**[verification round]** `fleetStationServices(null)` — the world dock — returned a four-key object, so
`plans` and `recruit` read as `undefined`. Combined with the two new gates above, that withdrew ship
plans and boarding-crew recruitment at every planet dock, services a world had always offered. Every
key is now stated explicitly, and a gate asserts none is left undefined.

### B11 — strategic damage reaches live services

`campaign.stationDamage` was recorded and never read by the live resolver. `stationConditionFraction`
now takes the lower of the local combat condition and the strategic damage, so a facility wrecked in an
offscreen battle is wrecked when you dock at it, and its services, defence and production degrade with
it.

### B12 — the debug controls do what they say

- `campaign phase <stage>` re-anchors the expedition timetable so every phase up to the requested one
  is due, then advances one day through the ordinary calendar, so the phase is entered by the same code
  that enters it in play. `dormant` resets the expedition and pushes the timetable out of reach.
  Previously the control computed a sentence and changed nothing.
- Every numeric control is finite-checked, floored and clamped. `campaign readiness <f> 1e999` is
  rejected instead of looping; `2.7` lands on a whole number of hulls; `treasury` is clamped to the
  campaign treasury cap; `advance` is clamped to 1–60.
- `advanceCampaignDay` bounds absurd input: non-finite days are refused, and a jump beyond
  `maxCatchUpDays` (2,000) steps that many days and records the remainder as unobserved time.

### B13 / IM-02 — the Empire panel and the report model

The operations tab read the book directly, printing the true attacker, status, arrival day, committed
hulls, losses, outcome and resolver for every operation in the galaxy. It now reads
`campaignOperationKnowledge`:

- **Direct** — the captain holds the system, owns a station there, or has a ship on station: the
  campaign record, marked as observed in your space.
- **Reported** — a galaxy report about that operation exists: the report's own text, date and
  confidence, and nothing else.
- **Neither** — the operation is not shown at all, because a panel that lists it has already told the
  player it exists.

The "other powers" table counts only operations the captain knows of, and the Dominion section reports
what the captain has *heard* rather than the expedition's own phase; the interdiction line needs
someone at the entry system to see it.

Report classification: galaxy-wide Dominion warnings and settlements between two other powers are no
longer flagged `playerRelated`, so they compete for the six background slots like any other news. They
become personal automatically when a belligerent is the captain's own faction. Recovery offers are
personal when the captain holds the system or flies, owns or holds the plan for that design.

**[verification round]** Campaign reports built their ids from the *outer* day of
`applyCampaignEffects`, not the effect's own day, so in any multi-day catch-up every day's capture,
station damage, convoy, settlement or fleet-loss report at one site collapsed onto a single id and all
but the first were dropped. They now use `e.day`.

### The hail panel — the fix that made things worse

`hail-layout-desktop.png` in the previous validation pack showed the incoming hail collapsed to about
96 px with the message cut mid-sentence and **both action buttons gone**. The earlier fix had removed
an overlap by shrinking the panel, and the gate could not see it because it asserted bounding-box
separation only. The gate now reproduces that exact configuration on `fa7de12`:
`2 of 2 hail actions were clipped or unclickable (panel 122px)`.

The layout works to a stated order of priority: the panel never crosses the disabled-ship panel, which
owns critical controls of its own; it never slides under the status strip or the top-left menu, which
would hide its own heading; it never shrinks below what its head, status line and buttons actually
measure; and on a screen too short for all of that, the **map thumbnail stands down** for as long as
the hail is on screen and returns when it clears. Only the message scrolls.

Gate M now also asserts that every button in the panel is inside it, on screen, and hit-testable — not
merely that two rectangles do not intersect.

### Secondary findings

- **[third review] Bulk equivalence has a stated scope.** A multi-day call reduces controller changes,
  installation ownership, station condition and settlements into its private shadow. Anything else an
  engine may apply to its own world is not reduced, and that is the limit of the claim.
- **Determinism.** Every "mode" in the old gate looped adjacent days, so a real jump was never
  exercised; a single call at day 10 from `settled = 1` skipped days 2–9. `advanceCampaignDay` now
  settles every intervening day, so a long warp, a debug skip and a migrated save produce the book that
  stepping produces — **for any gap up to `maxCatchUpDays`**. Past that bound the remainder is
  deliberately recorded as unobserved time rather than stepped, so two callers whose gap exceeds 2,000
  days do *not* agree. That is a documented limit, not an equivalence.
  **[second review]** The first cut of that loop ran every day against one immutable world snapshot, so
  a capture on an internal day was invisible to the days after it: the same world was taken again and
  again (18 captures where stepping produced 1) and the final book differed. A multi-day call now steps
  against a private copy of the world whose controllers are updated as captures happen; the caller's
  snapshot is untouched. The gate exercises a seed that actually captures something, rather than
  requiring that none does.
- **Checksum.** The digest omitted history, designs, recoveries, missions, orders and discoveries, so
  replay equivalence proved nothing about any of them.
  **[second review]** The second cut still omitted `seed`, `resolutions`, `relocatedOffers`,
  `assessments` and `migratedBudgets`, because it was an enumerated list and enumerated lists drift. It
  is now a key-sorted serialisation of the entire book, so anything added later is covered without
  anyone remembering, and a book that has been through storage hashes the same as one stepped in
  memory. The gate mutates **every** key in turn.
- **Bounds.** `fa7de12` capped recoveries and missions with a slice that only trimmed *finished*
  records, so open ones grew without limit (the gate drives 120 sole-vendor losses through it). The
  bounds are now named in `CAMPAIGN_RULES` and enforced where the records are created, on the entries a
  player can still act on. **[verification round]** `slice(-0)` returns the whole array, so the archive
  was not trimmed at exactly the boundary; handled explicitly.
- **Recovery lifecycle.** A recovery pursued through a mission that expired stayed `active` for ever and
  the design stayed permanently lost. It now returns to the offer pool with its lapse clock running,
  raises a `recoveryReleased` effect and a report, and can be attempted again. **[verification round]**
  `startDesignRecovery` reported "Recovery already under way" for both of `offerMission`'s refusals; the
  contract-cap refusal now says so.
- **[verification round] Old saves lost the new bounds.** A book is persisted with its rule set inline,
  and `CAMPAIGN_VERSION` is only bumped when the book must be rebuilt — so a save written by an earlier
  build arrived with none of the keys added since. That silently removed the recovery, mission and order
  bounds, reduced `maxCatchUpDays` to 1, and turned off the B6 foreign-design repair.
  `Campaign.upgradeCampaignBook` now backfills missing rules and collections on every access, leaving
  every value the save already carries untouched.

### Evidence

- **Root labels.** `RESULTS.json` previously labelled every gate `"root": "dist"`. Thirteen are pure
  suites that import source directly and ignore `BM1_TEST_ROOT`; they are labelled `src`. **[verification
  round]** Six browser probes — `ew`, `seeker`, `power`, `ships-ingame`, `ships-balance`,
  `ships-economy` — hard-coded the repository root and ignored `BM1_TEST_ROOT`, so labelling them
  `dist` was wrong in the first pack *and* in the first cut of this one. They now honour
  `BM1_TEST_ROOT`, so the label is true and those gates actually test the built artifact.
- **[verification round] `ships-economy` was a coin toss.** Per-system stock capacity is seeded from
  the campaign id, which is a random UUID at a fresh start, so buying the last Excalibur at Paso left
  the shelf empty about a third of the time and two later checks failed with "Out of stock" — nothing
  to do with what they are named for. Measured across six runs: 29/30 twice, 27/30 four times. The gate
  now pins the campaign id and restocks the shelf before the checks that are about purchase gates, and
  is stable. The first draft of this document reported a 27/30 run as "29/30, unchanged", which was
  wrong twice over. **[tenth review]** Its last failing check is now fixed as well — see below — so the
  gate is 30/30 and every gate in the suite passes.

## Tuning values introduced or changed

| Key | Value | Meaning |
| --- | --- | --- |
| `maxHullsPerPolity` | 120 (unchanged) | now standing hulls, not hulls ever built |
| `maxLiveRecoveries` | 40 | open recovery contracts, enforced at creation |
| `maxLiveMissions` | 60 | open contracts, enforced at creation |
| `maxOrders` | 40 | queued distant orders |
| `maxCatchUpDays` | 2000 | days a single advancement call will step before recording unobserved time |
| `foreignDesignShare` | 0.35 | share of AI build orders drawn from licensed foreign designs |

All of these are first-pass tuning, not measured balance.

## Behaviour changes a reviewer should look for

1. Allied polities defend each other's worlds **and** take losses there. The player polity stands with
   any holder it is not at war with, so the captain's stationed ships can be damaged or destroyed
   offscreen. This is new player-visible risk.
2. Foreign and private installations contribute to nobody's strategic accounts, and a foreign or
   private repair slip no longer heals a rival's damaged installation.
3. Ambient raids require a force within reach, so quiet corners of the map are quieter and the choice
   of attacker is narrower.
4. Commodity trade is refused at sites that do no commerce at all when the captain is far from the
   world.
5. The map thumbnail can disappear while an incoming hail is on screen on short viewports.
6. The Empire panel shows fewer operations than before, by design — and **[fourth review]** fewer
   again: an operation appears only once an account of it has been delivered, and only a battle the
   captain is standing in is shown from the campaign record.
7. An AI polity at its fleet cap stops ordering hulls instead of paying for ships it cannot commission.
8. Capturing a culture's major world grants that culture's ordinary designs, including region-tagged
   ones — but not designs that exist at one authored place under one named vendor, and not the
   Tactical Cube or Borg material. **[fourth review]** Gorn industry is included once the authored
   Gorn discovery has happened, and grants nothing before it.
9. Reports about operations at systems you are not standing in arrive **late** and carry no numbers.
   A ship on station reports well but can be mistaken; a relay gets the identity right and the numbers
   never; a rumour can name the wrong power entirely. Only being there gives the campaign record.
10. The Other Powers table shows what you have seen, dated to when you saw it, not a live total.
    **[fourth review]** "Seen" now means a system you were watching at the time — being there, a ship
    on station, or your own relays and installations. A world you flew through once keeps reporting
    the holder you last saw there, however long ago that was, until something of yours sees it again.
    **[fifth review]** A world you lose during a long warp stops reporting from the day you lose it,
    not from the end of the warp.
11. **[sixth review]** A relay of yours repaired during a long warp starts covering its neighbours
    again on the day it comes back on the air, not at the end of the warp. **[seventh review]** So does
    a foreign relay in a world of yours whose owner makes peace with you mid-warp.
12. **[fifth review]** The "Active operations" column counts fleets by the power your accounts *blame*.
    A mistaken account puts that fleet under the wrong power's name, which is what being mistaken
    means; the power that really sailed is not credited with a fleet you have had no word of.
13. **[ninth review]** An installation of yours that is destroyed stops being a listening post the
    moment it is wrecked — its system goes back to rumour until you rebuild it — while its loss, and
    everything that happens at that world afterwards, stays your business.
14. **[fifth review]** A fleet stays under "Fleets in motion" until an account of how it ended reaches
    you. A battle that finished out of your sight does not move itself into your history.

## Not fixed here, and why

- **B4 — the six missing factions** (Breen, Son'a, Tarellian, Promelli, Hirogen, Suliban) are still not
  strategic actors. FD-01 in the master register; Patch 4.
- **B5 — the player empire has no diplomacy of its own.** `relation` still maps the player to the flag
  they fly. FD-04; Patch 4. Everything here that needed a player relation uses that mapping, so it
  inherits the limitation rather than entrenching a second one.
- **B7 — hulls are not equipped persistent vessels.** Strength is still price × condition × crew, and
  scene NPCs are still seeded from the wave index rather than the hull id. CE-06; Patch 4 or later.
- **[fifth review] A bulk call classifies its reports at the end.** Effects are applied — and so
  reports are written and their source tier decided — after the whole call returns, using the sources
  the captain has then. The *book* is now identical either way, including the observation record, but
  an account of something that happened on internal day three is filed as though the captain's sources
  on the last day were the ones that heard it. Closing that means emitting reports per internal day,
  which is the central-campaign-time work in Patch 2, not a repair. In normal play the calendar steps
  one day at a time, so this affects catch-up paths: a debug skip, a migrated save, a long warp.
- **The relay tier is coarse.** A relayed dispatch gets the faction and the place right and withholds
  numbers; it does not yet model interception, coverage gaps or staleness. IM-09.
- **Food and housing remain inert.** They are accumulated in `settleEconomy` and never read. ST-10.
  (Research is no longer inert: it now sets a site's plan-stock tier. That is the whole of its effect.)
- **`getShipyardStockContext` still uses name substrings** for its `isHeavy` / `isShipyard` tiers. Same
  defect class as the plan-stock context, but it decides which hulls appear at which vendor, and
  changing it would churn the committed station-offer baseline `station-offer-gate.cjs` compares
  against. Left for ST-01, when that baseline is next regenerated deliberately.
- **Host taxation of foreign installations** is an open economy question (CE-14), noted under B9.
- **An in-flight build order at a site that loses its capability pauses indefinitely** with its inputs
  already spent. That is pre-existing `paused` semantics, newly reachable through `unsuitable`.

## Files

| File | Change |
| --- | --- |
| `src/campaign-strategy.mjs` | relationship enforcement, bridgehead bounds, standing-fleet cap, awaiting-commission orders, licensed production, shared defender list with losses, owner-scoped station effects, recovery lifecycle, real bounds, full checksum, gap-stepping advancement, `upgradeCampaignBook` |
| `src/main.js` | `designEligible` / `isGeneralProductionDesign`, `extraDefense` removed, `defenderLosses` applied to the real fleet, scene-owned vessels excluded from the resolver, raid reach, station-role enforcement at six sites, stated world-dock services, campaign damage in `stationConditionFraction`, debug controls, observation-backed Empire panel, report classification and per-effect report ids, hail layout |
| `styles.css` | hail panel: controls pinned, message scrolls, thumbnail stand-down |
| `index.html` | cache version `20260916-campaign-blocker-fixes-v1` |
| `scripts/campaign-blocker-gate.mjs` | new: 27 model checks |
| `scripts/campaign-blocker-probe.cjs` | new: 40 engine checks |
| `scripts/fixtures/fa7de12-campaign-book.json` | new: a real `fa7de12` campaign book, initialized and advanced 60 days on that build, for the migration gate |
| `scripts/campaign-world-fixture.mjs` | new: the synthetic galaxy, shared by both pure suites |
| `scripts/probe-harness.cjs` | new: Playwright harness with tolerant symbol binding, used by the blocker probe |
| `scripts/campaign-probe.cjs` | ambient-raid gate rewritten for reach; gate M asserts button reachability |
| `scripts/campaign-strategy-test.mjs` | uses the shared fixture; the lost-hull check asserts capacity is freed |
| `scripts/ship-economy-probe.mjs` | honours `BM1_TEST_ROOT`; pins the campaign id and restocks before the purchase-gate checks, so the gate is not a coin toss |
| `scripts/ship-ew-probe.mjs`, `ship-hoj-probe.mjs`, `ship-power-probe.mjs`, `ship-catalog-ingame-smoke.mjs`, `ship-balance-probe.mjs` | honour `BM1_TEST_ROOT`, so `"root": "dist"` is true of them |
| `package.json` | `test:campaign:blockers`, `test:campaign:blockers:ingame` |
