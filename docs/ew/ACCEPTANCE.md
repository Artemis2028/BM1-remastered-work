# EW milestone acceptance (14 September 2026)

This note records an explicit user decision. It does **not** merge to `main`,
retag freeze tags, amend `347a78a`, rewrite generated receipt JSON, or
recalibrate thresholds.

## Decision

**Date:** 14 September 2026.

The completed, independently audited r6 campaign in
[PR #11](https://github.com/Artemis2028/BM1-remastered-work/pull/11) is
**accepted as sufficient performance evidence for this milestone**.

- Pack: `docs/ew/receipts/campaign-r6-20260914T1309Z/` (landed on
  `cursor/campaign-r6-receipts-20260914-e760`, tip
  `74c2b11d90315cbe3a2bf14ab752cc07b27c3a68`).
- Protocol tip / tag: `347a78abc4f7dfae8aca5f7e0f8297fbb3d89ae8` /
  `ew-fable-protocol-20260914-r6`.
- Measured engine tree: `51738caf3a1d88492c4fc48a7c0125d4a7e2a355`.
- Host class on those receipts remains **SUPPLEMENTARY**
  (`environment.hostnameClass`: `supplementary-not-platinum`). That label
  is not rewritten. The user has accepted this supplementary host-class
  evidence for **this milestone**.

The **Platinum-only requirement is removed** for this milestone. A Platinum
8573C rerun is **not** required to accept this evidence pack.

This integration PR **prepares** the reviewed EW implementation, r6
validation tooling, and the accepted receipt pack for `main`. **Merge to
`main` is a separate later decision.** This note does not authorize that
merge, a retag, or any change to `Artemis2028/BM1-remastered`.

## Thresholds (unchanged)

Do not recalibrate. The gates remain:

| Gate | Series | Limit |
| --- | --- | ---: |
| Electronics | `electronicsPass` (original full-workload timer) | **2 ms p95 / 4 ms p99** |
| Cumulative frame | whole-frame tick p95, EW minus pre-sensor | **≤ 2 ms** |

Generated campaign JSON is left as written. Explanations live in
documentation only.

## Historical Platinum failures — original labels retained

Earlier Platinum failures stay labeled as failures. This acceptance does
**not** relabel them as passes, rewrite their JSON, or treat quieter-host
numbers as Platinum.

Cite, do not mutate:

- Astra Platinum evidence for measured tree `51738ca`: C2
  `electronicsPass` **3.70 / 9.20** and **2.00 / 4.30**, both failures
  (sensor baseline also failed p99; cumulative frame increments passed).
- Older `docs/ew/receipts/performance-*.json` family (and
  `prior-attempt-performance-*.json`): Platinum 8573C **2.50 / 6.90
  failed** on an **older** EW tip, not `51738ca`.
- Other historical families (`review-20260913-*`, `fix-20260913-*`,
  `passms-20260913-*`, `authority-20260913-*`,
  `perf-followup-20260914-*`) keep their original filenames, numbers, and
  host-class labels.

## Frozen tags remain immutable

Do not move, delete, or retag. Annotated objects and peels at the time of
this note:

| Tag | Annotated object | Peels to |
| --- | --- | --- |
| `ew-fable-candidate-20260913` | `a60f76a9d68c855693a0b7c9c734936fc6503546` | `077a9cedaa5a6cb858b200addb115d862ab238e6` |
| `ew-correctness-freeze-20260913` | `fabf9e638a459263174ff35d3ba722928e110291` | `ff0c4c9450c0cc59a535c4a8f083aaf9c897fd0a` |
| `ew-fable-protocol-20260914` | `ae744b9ac9704b08c924eadfa888bf38ae486dc2` | `e556a3801848d85062ccecc1dcfec4d8c56620fd` |
| `ew-fable-protocol-20260914-r2` | `aae8dabcb14521c9cbedf8678e6ec57bad355aee` | `6d4c01d7b8af4bf69878c8bf22d63b3bfdfa14dc` |
| `ew-fable-protocol-20260914-r3` | `fd82cecca32964441c4fd3a0c3c68a5d952ddfc5` | `c0b42b06b0b782a0b7525398600a4a2dcfa9023d` |
| `ew-fable-protocol-20260914-r4` | `43977091a5ea640576249c048bbc4b577f7a2372` | `70f47cc96bf37f6df3625a1bcc00f089dfccbb1e` |
| `ew-fable-protocol-20260914-r5` | `47a2bce4adab8a3cdaddde4ca9b024f4ccaf511b` | `b76547d509ae69fc955966d2c3473263ab41c3c8` |
| `ew-fable-protocol-20260914-r6` | `ebd6766259f3da848137fe3e192666d976847df4` | `347a78abc4f7dfae8aca5f7e0f8297fbb3d89ae8` |

`347a78a` was not amended.

## What this integration brings

Branched from current `main` `e7aa3c594e4799c54d48e2eeac37a2a1acf36b9b`
(sensors / transponders / counterfire). Re-compared before edit: `main`
had **0 commits ahead** of `51738ca`. The EW stack is a linear descendant
of that `main` tip (~17 engine commits through `51738ca`, then protocol
through `347a78a`, then PR #11 receipts through `74c2b11`).

Integration method: fast-forward that linear history onto a branch from
`main`, then add this acceptance documentation. No conflict resolution
was required. Engine `src/` (and `styles.css` / `sw.js`) on the
integration tip match `51738ca`. Harness / campaign scripts match r6
`347a78a`. The campaign receipt pack matches PR #11 as landed.

Not in scope for this PR: merge to `main`, retagging, touching
`Artemis2028/BM1-remastered`, threshold changes, or re-running the long
r6 campaign.
