# Briefings, security perimeter and world cargo delivery

Incremental candidate on 6ee0c2f. The later campaign request adds one bounded rule: automatic war-exhaustion rolls cannot end the Terran–Klingon war. Explicit debug/story diplomacy remains available. Saves already at peace are not forcibly changed; use the existing debug war control to resume that conflict if desired. The strategic campaign, rotating stock and station-role overhaul are proposals in CAMPAIGN-STATIONS-PROPOSAL.md, not shipped simulations.

## Shipped behavior

- Each jump selects up to six unread background reports, plus every retained unread report involving the captain, fleet, faction or personally owned world/station. These sections are separate. Personal reports consume no background slots.
- Selection persists with the journey through save/load and folder browsing. Read reports do not automatically repeat on the next jump; unread background overflow remains eligible. The existing 120-report archive and 120-pending-report bounds remain.
- Archive folders: Your affairs, Diplomacy, Battles & losses, Field reports and All reports. Archive pages contain six entries; This jump restores the fixed briefing selection. Folders are views of one archive, not duplicated records.
- Discovery gates, fallible delayed intelligence, unrestricted mistaken attribution and factual immediate local-attack records remain. Report metadata does not change standing, diplomacy or actual deployments.
- Security radius is 1,400–2,600 units, calculated from owned orbital installation geometry plus a 600-unit margin. The previous values were 560–1,100 and a 260-unit margin. Authority, access policy and ownership rules are retained.
- Checkpoint radio reception covers the new perimeter, matching the existing checkpoint tracking footprint. The ordinary transporter transaction gate remains 2,500 units. Cloaking still prevents checkpoint tracking; transmitting a false declaration still does not change actual ownership.
- Zoned arrival remains radius plus 600 units, now 2,000–3,200 depending on geometry. Unzoned arrival remains 1,800. Remote installation orbits are untouched.
- Freight is delivered only within 600 units of the destination world's center. Entering the system, hailing a remote station or docking at a station farther from the world cannot deliver it.
- Delivery retries after movement/security updates. Uncloaked ships need applicable clearance. An active cloak permits a covert cargo drop despite a pending/closed checkpoint. This bypass applies only to delivery: it neither clears the inspection nor enables station purchases/repairs. Cargo is removed and payment made once, including across save/load.
- Contracts explain the world drop-off and offer a manual delivery action. A world-centered flight ring marks the delivery radius while cargo is due there. The actual distance is tested; orbital motion can carry a vessel sitting exactly on the boundary just outside it.
- Freight rates, ship prices, repair pricing and paid recovery are unchanged.

## Validation and fixture changes

New browser probe: seven groups covering six-plus-personal selection/overflow; relevance; folders/paging/save-load/mobile fit; expanded arrival geometry; remote-station refusal; cloaked automatic payment once; real inspection dwell followed by automatic uncloaked delivery.

World model adds a seventh group: the central war remains active through 2,000 days in either argument order; daily and bulk advances match; explicit strategic/debug peace remains possible after serialization.

Existing fixture updates preserve their original assertions: behavior uses the new radius bounds, places the aggression target within weapon range and points its projectile-credit fixture toward the victim; captain debug transport approaches the world; sensors restores its observer position after visiting the system/holding-marker fixtures. The expanded radio footprint fixed an actual perimeter reception gap exposed by the behavior probe.

The handoff includes final logs, exact gate counts, runtime hashes, bundle prerequisite and patch replay tree. No native Safari/iPad validation or long economy/battle-balance campaign is claimed. The incoming-hail layout overlap remains open. The legacy playtest recovery assertion still uses a fixed sleep; its final run is isolated from other browsers.
