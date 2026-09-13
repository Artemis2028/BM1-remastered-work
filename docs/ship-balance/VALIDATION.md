# Validation — full-roster-v2

13 September 2026. **192/192 checks passed**, across seven suites:

| Suite | Result |
|---|---:|
| Existing behavior acceptance probe (S1–S5) | 79/79 |
| Live faction economy and purchase paths | 30/30 |
| Approved hull merges and alias resolution | 23/23 |
| Live catalog smoke checks | 16/16 |
| Content, assets, regions and standalone helpers | 14/14 |
| Catalog integration helpers | 11/11 |
| New full-roster balance contracts and live measurements | 19/19 |

The new suite instantiates **all 172 active hulls** using actual engine code.
It verifies physical values, explicit slots, first NPC combat weapon, empty
and utility-only behavior, armability, price-independent range and progression.
The same-market dominance comparison found zero dominated designs under its
documented criteria. These are mechanical consistency checks, not a claim that
every encounter or campaign difficulty has been exhaustively playtested.

The authored identity, faction, name, artwork, crop, rendered envelope, class,
alias, retirement and regional/vendor fields were also compared with `d2c6f94`:
no changes. Retired #26/#63 records are byte-equivalent as parsed data. Only the
documented additional no-ambient flags on exceptional hulls changed deployment eligibility.

Both Node and Python release builders produced the browser and Chrome-extension
releases. JavaScript syntax, generated-manifest consistency and `git diff --check`
passed. The purchase dialog and the searchable standalone review were rendered
and inspected; the review's filter ran without page errors.

## Probe maintenance

The existing behavioral projectile and beam fixtures now temporarily set the
explicit runtime catalog slots, because legacy item rows no longer override
authored loadouts. Their attribution/range assertions are unchanged.

Former “missing tier” fixtures now distinguish a record with an explicit
standing requirement from a synthetic record missing both sources. The latter
still fails closed. Price-specific merge fixtures use this pass's revised values;
Defiant and the approved Akira price ordering remain pinned. The capital economy
fixture now earns 75 standing before testing cross-region access.

## Reproduction

With Node, Python, Playwright and Chromium available:

```sh
npm run validate:ships
npm run test:ships
npm run test:ships:ingame
npm run test:ships:economy
npm run test:ships:merges
npm run test:ships:balance
npm run probe
npm run check:ship-manifest
npm run build
npm run build:python
```

The review documents can be regenerated with
`node scripts/export-ship-balance-review.mjs`. The runtime manifest is generated
with `node scripts/sync-ship-roster.mjs`. `bm-ships/ships.json` is authoritative.
