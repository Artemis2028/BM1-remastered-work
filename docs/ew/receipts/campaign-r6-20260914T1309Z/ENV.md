# r6 finite EW campaign — environment notes

**Authority label: SUPPLEMENTARY (not Platinum).**

This host does not match the documented Platinum reference (Intel 8573C class,
8 logical CPUs / hardwareConcurrency ~9 historically). Do not present these
receipts as authoritative Platinum.

## Frozen identity (verified before any run)

| Item | Expected | Actual | Match |
| --- | --- | --- | --- |
| Tag | `ew-fable-protocol-20260914-r6` (annotated) | annotated tag object `ebd6766259f3da848137fe3e192666d976847df4` | yes |
| Tag peels to commit | `347a78abc4f7dfae8aca5f7e0f8297fbb3d89ae8` | `347a78abc4f7dfae8aca5f7e0f8297fbb3d89ae8` | yes |
| Tree | `41abdd62a0ea61f4fcddcb94d04295468f03cd88` | `41abdd62a0ea61f4fcddcb94d04295468f03cd88` | yes |
| Harness sha256 (`scripts/ew-frame-benchmark.mjs`) | `1015baad1ba3163fbc556dc0c56cfcac4c169368603e1b9beee002b289d4e079` | same | yes |
| Helper sha256 (`scripts/ew-bench-lib.mjs`) | `2de68639769e47c8c7c793e2ea3531aef784e47247bfbe72465475102e42ad57` | same | yes |
| Plan tree A | `6958f08e73aff55efbf48bae3f9433e5acc270e8` | same | yes |
| Plan tree B | `e7aa3c594e4799c54d48e2eeac37a2a1acf36b9b` | same | yes |
| Plan tree C1 | `74caf837c7882a86e3bd7c74f083029453953c1a` | same | yes |
| Plan tree C2 | `51738caf3a1d88492c4fc48a7c0125d4a7e2a355` | same | yes |

Protocol / engine / freeze tags were not moved. Commit `347a78a` was not amended.

## Host (this run)

| Field | Value |
| --- | --- |
| Authority | **SUPPLEMENTARY — not Platinum** |
| CPU model | `Intel(R) Xeon(R) Processor` (GenuineIntel family 6 model 207, KVM) |
| Logical CPUs (`nproc` / `os.availableParallelism`) | 4 |
| `navigator.hardwareConcurrency` | 4 |
| Hypervisor | KVM |
| OS | Linux 6.12.94+ x86_64 (`cursor`) |
| RAM | 15 GiB |
| Node | v22.14.0 |
| Playwright | 1.63.0 |
| Browser name | Chromium (Chrome for Testing / HeadlessChrome) |
| Browser version | `153.0.8010.12` |
| Viewport | 1280 × 850 (harness `newPage` default) |
| Campaign concurrency | 1 browser process per run; sequences serial; trees A→B→C1→C2 |
| `launch.extraArgs` | `[]` (acceptance; no extra Chromium args) |
| `launch.recordedArgv` / `verified` | recorded per receipt after each run (must be `verified: true` for acceptance) |
| `WITH_FREEZE` | 0 |
| Diagnostics / GC / profiling | none (`gcPlacement=none`, no `--diagnostics`, no `--gc-placement`, no expose-gc, no `--profile`) |
| Worktrees | `/tmp/ew-campaign-trees` (`EW_WORKTREE_ROOT` default) |
| Stamp | `campaign-r6-20260914T1309Z` |
| Receipt directory | `docs/ew/receipts/campaign-r6-20260914T1309Z/` |

Platinum reference (for contrast only): Intel 8573C class, 8 logical CPUs,
hardwareConcurrency ~9 historically. This host is 4/4 and is therefore
**SUPPLEMENTARY**.

## Commands (approved defaults only)

```
EW_CAMPAIGN_CONFIRMED=1 EW_RECEIPT_STAMP=campaign-r6-20260914T1309Z \
  scripts/ew-campaign.sh --execute --sequence 1 \
  docs/ew/receipts/campaign-r6-20260914T1309Z

EW_CAMPAIGN_CONFIRMED=1 EW_RECEIPT_STAMP=campaign-r6-20260914T1309Z \
  scripts/ew-campaign.sh --execute --sequence 2 \
  docs/ew/receipts/campaign-r6-20260914T1309Z

EW_CAMPAIGN_CONFIRMED=1 EW_RECEIPT_STAMP=campaign-r6-20260914T1309Z \
  scripts/ew-campaign.sh --execute --sequence 3 \
  docs/ew/receipts/campaign-r6-20260914T1309Z
```

No `TREE_*` / sample / tick overrides. No favourable reruns.

## Launch flags (from receipts; all 12 agree)

- `launch.extraArgs`: `[]`
- `launch.verified`: true
- `launch.recordedArgv.verified`: true
- Browser process: Playwright `chromium_headless_shell` 153.0.8010.12
- Preload-injected flags (not extraArgs): Playwright Chromium defaults including `--headless`, `--no-sandbox`, `--disable-dev-shm-usage`, etc.

## Campaign outcome (SUPPLEMENTARY)

All 12 receipts complete and acceptance-eligible. `campaignPassed` true on this host.
**Still not Platinum.** Do not merge to main.

## Measurement only

This pack does not authorize a main merge, engine changes, budget changes, or
edits to Artemis2028/BM1-remastered. Keep every raw receipt, including valid
gate failures. Do not retag.
