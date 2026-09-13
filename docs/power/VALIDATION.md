# Power patch validation — 13 September 2026

Base: `302639ac62c615406d0222063685bf969ff38b88`.

| Suite | Result |
|---|---:|
| Shared power accounting and crew policy | 20/20 |
| Live power engine and persistence | 23/23 |
| Behavior S1–S5 | 79/79 |
| Hull balance | 19/19 |
| Faction economy | 30/30 |
| Approved hull merges | 23/23 |
| Live ship catalog | 16/16 |
| Content/helper contracts | 14/14 |
| Catalog integration | 11/11 |
| **Total** | **235/235** |

`src/main.js`, `src/ship-power.mjs` and probe syntax checked; generated ship manifest is current. Node and Python release builders completed. Both browser and extension release trees contain the exact new engine/module, and the offline list includes `src/ship-power.mjs`. The OPS screenshot was captured from the real browser probe, not a mockup.

The environment used Playwright with Chromium supplied through an external preload. The preload and temporary dependencies are not part of this patch. Ordinary installations can run the documented npm/Playwright commands.

The final behavior probe includes the S1d fixture correction explained in POWER-AND-CREWS.md. No acceptance assertion was relaxed. The submitted patch is an increment on the pushed reviewed-ships tree, with no art binaries or Phase 3 replacement.

The 180-second crew experiment exercises actual engine functions with a frozen renderer and explicit simulation steps. It is a controlled acceptance scenario, not a full campaign balance study. NPC primary-weapon selection, legacy difficulty scales and station energy behavior remain the boundaries described in the implementation notes.
