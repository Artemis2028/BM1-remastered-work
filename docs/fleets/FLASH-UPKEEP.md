# Original Flash upkeep evidence

Retrieved 14 September 2026 from https://archive.org/download/flashtrek-broken-mirror/BROKENMIRROR.swf (3,240,370 bytes; SHA-256 `fbfad07023221f239a16718b3db7ca7bcbb1c353663eb67939dd4cb28f433031`). Decompiled locally with JPEXS 26.3.0; the SWF and decompiler are research inputs, not shipped assets.

Verified paths in the exported ActionScript:

- `frame_155/DoAction.as`: fleet maintenance sums `itemdescArray[(hullId-1)*13+3] * floor(dist)` for extant fleet records, then debits the total on travel completion.
- `DefineSprite_766_commpanel/frame_25/DoAction.as`: the fleet screen labels the same field as Daily Maint. Cost.
- `DefineSprite_766_commpanel/frame_21/DoAction.as`: the ship screen identifies field 3 as mass (displayed in units of 1500 tons).

The remaster's typed `mass` field corresponds to that original field. Thus the implementation charges each extant fleet vessel its catalog mass in latinum per elapsed calendar day. This extends the rule to new catalog hulls and traveling escorts; the current personal vessel is exempt. It does not derive upkeep from retail price.

The recovered Flash code also defects ships when cash is at or below 20 before settlement, and has separate random local-prestige defection and mission events. Those are not represented as recovered debt mechanics. This patch applies the user's later **one financial book** decision: unpaid charges become itemized arrears rather than deleting owned ships. Optional purchases/training require clearing arrears. No interest is added. This is a disclosed adaptation of insolvency behavior, not byte-identical Flash behavior.

Calendar conversion remains separate first-playtest tuning: one travel day per ten plotted range units, rounded upward. Wormholes have zero days. Multi-day settlements use one day boundary at a time so mid-trip deliveries begin upkeep on the following day.
