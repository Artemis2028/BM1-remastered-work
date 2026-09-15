# Follow-up to the independent review of 5461f55

The supplied review reports no code blockers and reproduces all twelve gates. This follow-up changes documentation only; the reviewed runtime candidate remains 5461f55 and no new runtime-test results are claimed.

## Proposal corrections made

- One shared system/hull quantity ledger, formed from both planetary and station-authored sources, with canonical ids and source provenance. Vendors retain their service/access restrictions; shared supply does not expose a secret vendor's stock everywhere.
- Randomized persisted replenishment is retained. Current Fleet.ensureStock / advanceStock already implement deterministic 3–7-day intervals; the fixed ten-day proposal is removed. Proposed variety and captured-industry access extend that existing mechanism.
- The five live hull vendors and all 13 offers are enumerated for preservation before service changes: The Arboretum, Kathy's Pub, Nausica Orbital, Nova Bar and Brea Bar. Swiss Relay Array's weapons 23/24 are also explicit.
- TS-293 and Nova Yard Defence are distinguished as already inactive hull-sale sources. Their authored ids stay in the exact audit, but are not automatically activated or classified as lost live shops.
- Hull plans retain 4× canonical hull price and the next standing tier, capped at 100. Already owned license recovery does not charge again; an unowned archive is not a free license.
- Player empires, all-faction competition, Bajoran-wormhole preference and major-world population OR station-count qualification remain. The named-exception section and all 36 station-role rows are preserved verbatim, as is the 269-row CSV.

## Code/design ledger retained

- Cloaked delivery is the user's explicit choice. The wartime freight supplement remains unchanged. The combined cloak/freight reward deserves campaign balance testing; it is not a reason to remove the authorized delivery bypass silently.
- A2 remains open: HUD Deliver handles destination cargo; planet-menu Deliver can also sell ordinary cargo through tradeAtPlanet. Proposed cleanup is explicit labels/actions for Deliver contract cargo and Sell ordinary cargo, preserving both capabilities and their gates. No runtime fix is claimed here.
- Archive browsing currently marks displayed reports as read. A future UI clarification should state that read reports are omitted from later automatic briefings while remaining in the archive.
- Incoming-hail overlap, symmetric index coercion in spawnFleetAttack and replacing the fixed recovery-test sleep with bounded state polling remain follow-up items.

## Small correction to the review text

The captain transport fixture approaches the world, but away missions still use TRANSPORTER_RANGE (2,500 units), with the existing docked exception. The new 600-unit requirement applies to world cargo drop-off. The review's successful fixture result stands; its accompanying range description conflates these two actions.

The review also lists 60-day / 65% invasion gates from an earlier proposal. The current proposal had already removed those fixed gates in favor of the independent invasion, all-power readiness and physically valid entry rules. None of the campaign tuning is presented as measured balance.
