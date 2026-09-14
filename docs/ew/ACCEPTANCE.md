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

## Integration-tip validation (14 September 2026)

Run on this integration branch after the acceptance documentation commit.
Engine `src/` still matches `51738ca`. Harness/scripts still match
`347a78a`. Campaign JSON still matches PR #11. **Remeasurement: no.**

| Suite | Result |
| --- | --- |
| `test:ew` | **20/20** |
| `test:ew:ingame` | **33/33** |
| `test:ew:seeker` | **14/14** |
| `test:ew:seeker:ingame` | **38/38** |
| EW/seeker total | **105/105** |
| `test:sensors` / `test:sensors:ingame` | **26/26** · **54/54** |
| `test:power` / `test:power:ingame` | **21/21** · **29/29** |
| `probe` (S1–S5) | **79/79** |
| `test:ships` | **11/11** |
| `validate:ships` | **14/14** |
| `check:ship-manifest` | passed |
| `test:ships:ingame` | passed |
| `test:ships:economy` | **30/30** |
| `test:ships:merges` | **23/23** |
| `test:ships:balance` | **19/19** |
| `test:ew:bench-lib` / resume / astra / r5 / r6 | **79** · **81** · **19** · **29** · **30** (all ok) |
| `npm run build` (node) | passed → `/workspace/dist` and `dist-chrome-extension` |
| `npm run build:python` | passed → same `dist/` convention |

### Playable build

Both builders write the playable tree to **`dist/`** (node first, then
python; both succeeded). `dist/src/ship-ew.mjs`, `ship-hoj.mjs`, and
`ship-sensors.mjs` match source. Also `dist-chrome-extension/`.

```sh
python3 -m http.server 8001 --directory dist
# or: npm run release:serve
# open http://127.0.0.1:8001/
```

### Smoke checklist (release `dist/`, 14 September 2026)

Exercised headed Chromium against `dist/` on localhost:8001:

1. Load `/` — title and start menu render (skip intro crawl if shown).
2. Play Game → Terran Rebel → Start Game — Earth orbit, HUD, minimap, no page/console errors.
3. Bottom dock **PWR** → POWER (OPS): engines/weapons/shields/sensors sliders; Sensors & Communications (transponder, sweep, scans).
4. Expand **Electronic warfare**: captain slot empty / Off; Jammer Off/On/Auto; ECCM Off/Boost/Auto; interference Clear.
5. HOJ is weapon 46 (Anti-emitter Torpedo) at respected standing — not on the starter Miranda; live HOJ is covered by **38/38** `test:ew:seeker:ingame`, not this visual start-game path.
6. No page errors, no console errors on that path.

### Known limitations

- Actual iPad/Safari performance remains unverified.
- Visual smoke did not buy a jammer or fire a HOJ (live suites did).
- r6 campaign remains SUPPLEMENTARY host-class evidence; historical Platinum failures keep their original fail labels.
- This tree is **not** merged to `main`. Freeze tags were not moved. `Artemis2028/BM1-remastered` was not touched.
