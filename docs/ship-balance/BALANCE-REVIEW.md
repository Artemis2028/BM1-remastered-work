# BM1 / BM2 — full ship balance, v2

Reviewed 13 September 2026, based on the approved merged roster at
`d2c6f94d7f3e194f3684ab8cf479cdaab97479ce`.

All **172 active content records** were reviewed individually. Two retired
records remain retired; the 38 approved aliases, five retained variant pairs,
artwork, crop rectangles, factions and display sizes are preserved. Active content
includes restricted and reserved hulls; it does not mean every ship is for sale.
The old four-price exception policy is superseded by this requested full balance pass.

## Progression

| Faction standing | Intended access |
|---:|---|
| 0 | Basic shuttles, stripped-down scouts and entry cargo craft |
| 15 | Working ships, runabouts, small escorts and modest civilian explorers |
| 30 | Capable civilian trade/survey ships, older cruisers and local defense |
| 50 | Military cruisers, advanced explorers and strongly armed commerce hulls |
| 75 | Frontline capitals, strategic warships and rare heavy combat designs |
| 100 | Exceptional supercapitals; money alone never substitutes for trust |

Standing follows the captain faction-wide. Local yards still determine stock.
Independent civilian purchases use independent trade standing; this is not a
claim that all neutral ships share one political owner. Trading's standing cap
and the existing contract rewards are unchanged.

| Example | New price | Standing | Why |
|---|---:|---:|---|
| Oberth utility conversion #47 | 16,000 | 15 | Tractor, cargo and working range; slower than Aeroshuttle |
| Aeroshuttle #281 | 14,500 | 15 | Fast armed auxiliary; smaller hold and shorter reach |
| Miranda #305 | 39,000 | 30 | Lower protection than Excelsior; slightly longer travel leg |
| Excelsior #2 | 48,000 | 30 | Better protection/cargo; removes cheap cruiser inversion |
| Steamrunner #1 | 42,000 | 30 | Reserve cruiser with useful hold and basic combat fit |
| Thawn #301 | 44,000 | 30 | Faster response and pulse cannon, less cargo/protection |
| Steamrunner strike #344 | 65,000 | 50 | Stronger defenses, handling and three combat slots |
| Akira #33 / strike #325 | 72,000 / 94,000 | 50 / 50 | Retains approved price ordering and two quantum launchers on strike |
| Defiant #326 | 62,500 | 50 | Keeps approved price; armor, pulse/quantum weapons, tiny cargo, short range |
| D'deridex #320 | 225,000 | 75 | Heavy protection, cargo and cloak; much less agile than Defiant |
| Concord #60 | 1,050,000 | 100 independent | Commercial supercapital with a 10,000 cargo hold |
| Excalibur #347 | 1,500,000 | 100 Terran | Project X flagship; 9,000 hull and 12,000 shields |

## Capability and equipment decisions

Prices account for protection, useful freight, travel range, handling, compatible
equipment mass and the supplied fit. Every hull has a specific role and written
rationale; there is no blanket multiplier on BM2's raw table. The late imports no
longer share identical placeholder profiles.

Every hull has three explicit weapon/device slots, with empty slots retained.
A ship delivered unarmed can be armed later. Each supplied weapon is checked
against the existing weapon definition and minimum hull mass. Devices occupy the
same three slots here; separate credential/utility slots remain future work.

This also removes accidental weapon inheritance through reused BM1/BM2 IDs.
For example, an ordinary Excelsior no longer inherits a Cutting Beam. The
Olympic's tractor and tachyon devices do not make it an armed military spawn.

The player speed adapter previously capped nearly all imported speeds at the
same value. Authored impulse and turning fields now preserve deliberate fast
scout/slow hauler differences. Warp range is explicit, so a price adjustment no
longer silently changes propulsion. Fuel reserves are explicit as well.

Global weapon damage, cooldowns, energy costs, power distribution and NPC firing
AI are unchanged. NPCs still use the first compatible combat weapon; the player
can use the three slots. Reported reload-limited damage potential is a comparison
aid and excludes energy exhaustion, missed shots, range and device effects.

## Setting and availability

- Blender retains Dominion scouts and Jem'Hadar attack ships. The cruiser,
  battlecruiser, supply ship and battleship remain in the Dominica core except
  for authorized missions/invasions. Battlecruiser access is available at core
  yards without visiting Blender.
- Gorn designs remain reserved. The Tactical Cube remains mission-only; the
  ordinary Borg Cube is not general civilian stock.
- Excalibur and Galaxy Dreadnaught retain Project X stock in Paso. Reman Warbird
  retains its Remus vendor, and Concord its independent endgame vendor.
- Exceptional flagships and the rare bioship are excluded from routine ambient
  traffic. This does not change ownership or erase a player-owned fleet ship.
- The approved artwork is copied unchanged. No duplicate Cargo Ship 3 is added.

Lore research and adaptation boundaries are documented in [LORE-SOURCES.md](LORE-SOURCES.md).
The Oberth's tug role, K't'inga cargo conversion and civilian Imperial hulls are
explicit BM refits. Canon-inspired labels do not promise absent mechanics such
as medical healing, spore drive, multi-vector assault or passive refueling.

## Validation scope

The new probe instantiates all 172 hulls in the real game, verifies stats and fits,
poisons legacy weapon rows to catch fallback leaks, checks that noncombat craft
can be armed, and verifies price-independent range. It also checks explicit
standing boundaries and progression within the retained families.

A same-market comparison rejects a cheaper hull with no higher standing gate
that matches or exceeds another in hull, shields, cargo, mass compatibility,
actual impulse/turning, range, reserve, reload-limited fitted damage and included
devices. This detects obvious dominated purchases; it does not prove equal
campaign efficiency, account for every local stock combination, or replace playtesting.

The full reviewed values and per-hull rationales follow in the generated table.
