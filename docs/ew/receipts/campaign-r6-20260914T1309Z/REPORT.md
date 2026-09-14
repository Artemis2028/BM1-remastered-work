# r6 finite EW campaign report — SUPPLEMENTARY

**Authority label: SUPPLEMENTARY. Not Platinum. Measurement only. Do not merge to main.**

Stamp: `campaign-r6-20260914T1309Z`  
Directory: `docs/ew/receipts/campaign-r6-20260914T1309Z/`  
PR: https://github.com/Artemis2028/BM1-remastered-work/pull/11  
Branch: `cursor/campaign-r6-receipts-20260914-e760` (receipts only; based on r6 tip `347a78a`)

---

## 1. Frozen identity (verified before any run; re-checked after)

| Item | Expected | Actual | Match |
| --- | --- | --- | --- |
| Tag | `ew-fable-protocol-20260914-r6` (annotated) | tag object `ebd6766259f3da848137fe3e192666d976847df4` | yes |
| Tag peels to | `347a78abc4f7dfae8aca5f7e0f8297fbb3d89ae8` | same | yes |
| Tree | `41abdd62a0ea61f4fcddcb94d04295468f03cd88` | same | yes |
| Harness sha256 | `1015baad1ba3163fbc556dc0c56cfcac4c169368603e1b9beee002b289d4e079` | same before and after | yes |
| Helper sha256 | `2de68639769e47c8c7c793e2ea3531aef784e47247bfbe72465475102e42ad57` | same before and after | yes |
| Plan A | `6958f08e73aff55efbf48bae3f9433e5acc270e8` | same | yes |
| Plan B | `e7aa3c594e4799c54d48e2eeac37a2a1acf36b9b` | same | yes |
| Plan C1 | `74caf837c7882a86e3bd7c74f083029453953c1a` | same | yes |
| Plan C2 | `51738caf3a1d88492c4fc48a7c0125d4a7e2a355` | same | yes |

Protocol, engine, and freeze tags were not moved. `347a78a` was not amended. No retag.

Prior freeze peels (unchanged): r5 `b76547d`, r4 `70f47cc`, r3 `c0b42b0`, r2 `6d4c01d`, historical protocol `e556a380`, candidate `077a9ced`, correctness `ff0c4c9`.

---

## 2. Host environment — SUPPLEMENTARY

This host is **not** the Platinum 8573C reference (8 logical CPUs / `hardwareConcurrency` ~9). Label the entire campaign **SUPPLEMENTARY**. Do not cite it as authoritative Platinum.

| Field | This host | Platinum reference |
| --- | --- | --- |
| CPU model | `Intel(R) Xeon(R) Processor` (GenuineIntel family 6 model 207, KVM) | Intel 8573C class |
| Logical CPUs | **4** | 8 |
| `navigator.hardwareConcurrency` | **4** | ~9 historically |
| Browser | Chromium / HeadlessChrome **153.0.8010.12** (Playwright 1.63.0, chrome-headless-shell) | (reference family) |
| Viewport | 1280 × 850 | 1280 × 850 |
| Concurrency | 1 browser process per run; sequences serial | — |
| `launch.extraArgs` | `[]` on every receipt | `[]` |
| `launch.recordedArgv` | verified Chromium argv (Playwright preload flags present) | — |
| `launch.verified` | **true** on all 12 receipts | required for acceptance |
| `WITH_FREEZE` | 0 | 0 |
| Diagnostics / GC / profiling / expose-gc | none | none |
| Harness `environment.hostnameClass` | `supplementary-not-platinum` | `platinum-8573C-reference` |

Playwright-injected Chromium flags appear in `launch.recordedArgv` / `preloadInjectedFlags` and are **not** `extraArgs`.

---

## 3. Exact commands run

Approved defaults only. No `TREE_*` / sample / tick overrides, no `--diagnostics`, no `--gc-placement`, no expose-gc, no profiling, no favourable reruns, no threshold changes.

```
EW_CAMPAIGN_CONFIRMED=1 EW_RECEIPT_STAMP=campaign-r6-20260914T1309Z \
  scripts/ew-campaign.sh --execute --sequence 1 \
  docs/ew/receipts/campaign-r6-20260914T1309Z
# 2026-09-14T13:11:39Z → 13:22:29Z  driver_exit=1  (incomplete report; seq 2–3 not yet run)

EW_CAMPAIGN_CONFIRMED=1 EW_RECEIPT_STAMP=campaign-r6-20260914T1309Z \
  scripts/ew-campaign.sh --execute --sequence 2 \
  docs/ew/receipts/campaign-r6-20260914T1309Z
# 2026-09-14T13:24:04Z → 13:34:48Z  driver_exit=1  (incomplete report; seq 3 not yet run)
# worktrees reused clean at expected SHAs; seq1 receipts resume-skipped

EW_CAMPAIGN_CONFIRMED=1 EW_RECEIPT_STAMP=campaign-r6-20260914T1309Z \
  scripts/ew-campaign.sh --execute --sequence 3 \
  docs/ew/receipts/campaign-r6-20260914T1309Z
# 2026-09-14T13:35:28Z → 13:46:13Z  driver_exit=0
# worktrees reused clean; seq1+seq2 resume-skipped
```

Independent post-campaign `node scripts/ew-bench-report.mjs docs/ew/receipts/campaign-r6-20260914T1309Z campaign-r6-20260914T1309Z` → **report_rc=0**.

---

## 4. Receipt pack + sha256

Canonical hashes for every receipt, summary, plan, and interruptions log are in `SHA256SUMS` in this directory (generated after the summary authority annotation). Compact driver progress/exit files are hashed there too.

All 12 receipts are complete, `acceptanceEligible=true`, `launch.verified=true`, empty `errors`, 1000 pass samples (B/C1/C2) or N/A passes (A), 3600 tick samples. No malformed receipts. No rerolls.

Local tee duplicates `sequence-N-driver.log` (~2.1 MiB each, harness JSON duplicated) were kept on the runner disk and hashed in `SHA256SUMS.local-tee` but not committed; the JSON receipts are the canonical pack.

---

## 5. Per-run electronicsPass vs 2/4, plus detection / updateMs / projectile / tick

p95 / p99 in milliseconds. Gate is electronicsPass **p95 ≤ 2 and p99 ≤ 4**. A is N/A for sensor-pass series. B/C1 `updateMs` is N/A null (r6 contract). Values use the receipt summaries (Chromium ~0.1 ms steps).

| Seq | Tree | electronicsPass p95/p99 | vs 2/4 | detection | updateMs | projectile | tick |
| --- | --- | ---: | --- | ---: | ---: | ---: | ---: |
| 1 | A | N/A | N/A | N/A | N/A | N/A | 0.400 / 0.500 |
| 1 | B | 1.200 / 1.700 | **PASS** | 1.100 / 1.400 | N/A | 0.100 / 0.100 | 1.200 / 1.400 |
| 1 | C1 | 1.700 / 2.100 | **PASS** | 1.500 / 1.900 | N/A | 0.100 / 0.100 | 1.300 / 1.600 |
| 1 | C2 | 1.700 / 2.800 | **PASS** | 1.500 / 2.600 | 1.500 / 2.600 | 0.200 / 0.300 | 1.300 / 1.700 |
| 2 | A | N/A | N/A | N/A | N/A | N/A | 0.400 / 0.500 |
| 2 | B | 1.300 / 1.700 | **PASS** | 1.100 / 1.500 | N/A | 0.100 / 0.100 | 1.200 / 1.400 |
| 2 | C1 | 1.700 / 2.300 | **PASS** | 1.500 / 2.100 | N/A | 0.100 / 0.100 | 1.400 / 1.600 |
| 2 | C2 | 1.600 / 2.300 | **PASS** | 1.400 / 2.100 | 1.400 / 2.100 | 0.200 / 0.200 | 1.300 / 1.700 |
| 3 | A | N/A | N/A | N/A | N/A | N/A | 0.500 / 0.600 |
| 3 | B | 1.300 / 1.700 | **PASS** | 1.200 / 1.600 | N/A | 0.100 / 0.100 | 1.200 / 1.400 |
| 3 | C1 | 1.600 / 2.000 | **PASS** | 1.400 / 1.800 | N/A | 0.100 / 0.100 | 1.300 / 1.600 |
| 3 | C2 | 1.600 / 2.500 | **PASS** | 1.400 / 2.300 | 1.400 / 2.300 | 0.200 / 0.200 | 1.300 / 1.600 |

---

## 6. Increments on every matched block (EW−sensors and EW−pre-sensor)

From the generated summary (tick p95 unless noted). Pre-sensor electronicsPass is N/A.

| Seq | tick EW−sensors | tick EW−pre-sensor | tick cumulative ≤2 ms | electronicsPass EW−sensors | electronicsPass EW−pre-sensor |
| --- | ---: | ---: | --- | ---: | --- |
| 1 | 0.1 | 0.9 | **PASS** | 0.5 | N/A |
| 2 | 0.1 | 0.9 | **PASS** | 0.3 | N/A |
| 3 | 0.1 | 0.8 | **PASS** | 0.3 | N/A |

---

## 7. Campaign-level verdicts

| Verdict | Result |
| --- | --- |
| `campaignElectronicsPass.allRunsPassed` | **true** (worst C2 p95 1.7, worst C2 p99 2.8) |
| `campaignCumulativeFrame.allRunsPassed` | **true** (worst EW−pre-sensor tick p95 0.9 ms) |
| `campaignStatus` | **passed** |
| `campaignPassed` | **true** |
| missing / ineligible / invalid | none |
| Host authority | **SUPPLEMENTARY — not Platinum** |

A passing C2 electronics result on this quieter 4-CPU host is **not** Platinum authority and does not replace Astra’s Platinum 51738ca failures (3.70/9.20 and 2.00/4.30).

---

## 8. Driver exit codes vs `campaignPassed` / `report_rc`

| Sequence | Driver exit | Harness events | Report at that time |
| --- | ---: | --- | --- |
| 1 | **1** | A/B/C1/C2 `run-complete` (no `run-fail`) | incomplete (seq 2–3 missing); `campaignPassed` false |
| 2 | **1** | A/B/C1/C2 `run-complete`; seq1 resume-skipped | incomplete (seq 3 missing); `campaignPassed` false |
| 3 | **0** | A/B/C1/C2 `run-complete`; seq1+2 resume-skipped | complete; `campaignPassed` true |
| Independent report after all 12 | **report_rc=0** | — | `campaignPassed` true / `campaignStatus` passed |

Seq 1 and seq 2 non-zero driver exits are the campaign script OR-ing `report_rc` after an incomplete receipt set (`--sequence N` leaves the other sequences missing). They are **not** harness/IO errors.

**Known baseline-failure discrepancy: did not appear.** The harness sets `process.exitCode = 1` when `electronicsPass.applicable && electronicsPass.passed === false` (any sensor-bearing tree, including B/C1). Campaign electronics is C2-only. On Platinum, B (sensor baseline) failing p99 can therefore yield a non-zero harness/driver exit while `campaignPassed` still follows C2. On **this** supplementary host, B and C1 also passed 2/4, every harness process exited 0, and after sequence 3 the driver exit, `report_rc`, and `campaignPassed` all agree (0 / 0 / true). Unrelated harness/IO errors would look like `run-fail` / malformed receipts; none occurred.

---

## 9. PR URL

https://github.com/Artemis2028/BM1-remastered-work/pull/11

Receipts-only PR. Base is `cursor/ew-benchmark-protocol-0d05` (r6 tip). The annotated tag name is not a GitHub base branch.

---

## 10. Measurement only — no main merge

This pack does not authorize merging to main, engine changes, budget changes, threshold changes, retagging, amending `347a78a`, or touching Artemis2028/BM1-remastered. Keep protocol / engine / freeze tags unchanged.
