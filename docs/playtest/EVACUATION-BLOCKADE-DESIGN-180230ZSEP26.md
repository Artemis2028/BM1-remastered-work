# Evacuation and blockade contracts — design for review

DTG 180230ZSEP26 · against candidate on top of `7232dc6` · **nothing here is implemented**

This is the proposal asked for before either mission is built. It exists because withdrawing the two
contracts stopped them being offered but did not make them playable, and that was never the request.

## Why they were withdrawn

Neither had an objective.

**Evacuation** paid 3,500 latinum for holding station within 600 units of a world for twenty seconds
while no hostile fleet was engaged. Nothing was carried, nobody was moved, nowhere was a destination.
Flying to a quiet world and waiting is not an evacuation; it is a timer.

**Blockade** paid 7,000 and its completion test is written `check: () => false`. It could only ever
complete through the escort branch of the advance loop — if a hostile operation happened to engage at
that system while the captain stood by, and was repelled. The captain could not cause it, and at a
quiet world the contract was unwinnable by construction and ran to its deadline.

Both are marked NOT DONE and stay that way until the below is agreed and built.

---

## 1. Evacuation

**The fiction.** A world under threat needs its civilians taken off. Hulls are what it lacks.

**What the captain does.** Dock or hold transporter range at the source world, take evacuees aboard as
cargo, carry them to a named refuge, and set them down. Evacuees occupy cargo capacity, so the contract
is a real call on the ship: a courier does one run, a freighter does it in one lift, and a warship
carrying evacuees is a warship that cannot also carry trade.

**The objective.** Move `N` evacuees from the source world to the refuge, where `N` scales with the
source world's population and the refuge is an authored, reachable world under a government not
hostile to the source's.

| Element | Proposal |
| --- | --- |
| Source | The contract's `systemIndex`, population > 0 |
| Refuge | Nearest world, by route hops, that is inhabited, not the source, not contested, and whose governor is not at war with the source's governor. Named in the contract text. |
| Load | 1 ton of cargo capacity per 100 evacuees; `N` = `min(population / 20, 400)` rounded to 10 |
| Trips | Allowed. Progress persists in the mission record. |
| Reward | 2,500 base + 12 per evacuee delivered, paid per delivery rather than only on completion |

**Completion.** The full `N` are set down at the refuge. Partial deliveries pay as they land, so a
captain who can only lift half is paid for half and the contract stays open for the rest.

**Failure.**
- The deadline passes with evacuees still on the source world → contract fails, the undelivered
  remainder is lost, standing with the source's governor falls by 5.
- The source world is captured while evacuees remain there → contract fails, **no standing penalty**;
  the captain was outrun by a campaign event, not negligent.
- Evacuees aboard when the ship is destroyed → they are lost with the ship; standing with the source's
  governor falls by 10. This is the one place the contract can cost more than it pays, and it should.

**Refusals that must stay.** Cargo capacity, docking and security clearance, and the refuge's own
willingness to receive — a refuge whose government refuses the captain is not a refuge, and the
contract should name a different one rather than strand them.

**Open question for the reviewer.** Should evacuees be a distinct cargo kind that cannot be sold? I
think yes: a market that will buy evacuees is a different game than this one.

---

## 2. Blockade

**The fiction.** A power wants traffic in and out of a system stopped for a period, without the system
itself being taken.

**What the captain does.** Hold the system and turn contacts back: intercept arriving traffic and
force it to leave, by hail, by threat, or by fire. The contract counts hulls turned, not seconds
elapsed.

**The objective.** Turn back or destroy `M` arriving contacts belonging to the blockaded party within
the contract window, while keeping a presence in the system.

| Element | Proposal |
| --- | --- |
| Blockaded party | The system's governor at the time of offer, recorded as `controllerAtOffer` (the field already exists) |
| `M` | 6 contacts, or 4 at a world with population under 3,000 |
| Turned back | A contact that enters the system and leaves without docking, after being hailed with a demand or having taken fire from the captain or their fleet |
| Presence | The captain or at least one fleet ship in-system; a lapse of more than two in-game days voids the window |
| Reward | 7,000, unchanged |

**Completion.** `M` contacts turned back or destroyed within the window, with presence maintained.

**Failure.**
- The window closes with fewer than `M` → contract fails, standing with the issuer falls by 5.
- Presence lapses beyond two days → contract fails, no additional penalty beyond the above.
- The captain docks at a station of the blockaded party during the contract → contract fails
  immediately for bad faith, standing with the issuer falls by 15.

**The cost that makes it a choice.** A blockade is an act against the blockaded party, so it should
move diplomacy: standing with the blockaded governor falls by 20 on completion, and their attitude
toward the captain hardens for the rest of the campaign. Accepting a blockade should be a decision
about who the captain is willing to make an enemy of, not free money for loitering.

**What this needs that does not exist yet.** A way to record that a contact was turned back. The
engine tracks arrivals and departures through `ensureSystemState` and the traffic model, but nothing
currently marks a departure as *caused*. That is the real work in this mission and the reason it is not
a small job.

---

## What I would build first

Evacuation. It reuses cargo, docking and delivery, all of which exist and are already gated; its
failure conditions are readable; and it gives the captain something to do at a world that is losing a
war, which the campaign now produces on its own. Blockade needs a new notion — a contact turned back —
and should wait until that is designed on its own terms rather than bolted onto the traffic model.

Neither should ship as a timer with a payout.
