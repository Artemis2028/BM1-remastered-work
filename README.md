# FlashTrek: Broken Mirror 1 - Remastered

A self-contained remastered browser version of Vexxiang's `FlashTrek: Broken Mirror 1`, rebuilt on the Broken Mirror 2 HTML5 engine.

The game runs as static files: no backend, install step, or npm dependencies are required for ordinary play.

BM1 systems ported in: Episode 1 Imperial War intro crawl, reviewed BM1/BM2 fleet, OPS power distribution, faction prestige and flag-claiming, fleet orders (Shift+1..8), alert status, ship scanning, bottom control dock, and BM1 keyboard shortcuts.

See [the ship integration and balance review](docs/SHIP-ECONOMY-REVIEW.md) for faction-standing gates, the added hulls and the current validation commands.

The [ship power and crew review](docs/power/POWER-AND-CREWS.md) documents per-hull reactors, shared energy costs and the four AI power-management skills.

The [game roadmap](docs/BM1-GAME-ROADMAP.md) records implemented features, agreed next work, and open design decisions across ships, boarding, equipment, stations, security and politics.

## Play Locally

```bash
python3 -m http.server 8001
```

Open `http://127.0.0.1:8001/`.

You can also use:

```bash
npm run serve
```

## Build A Release Folder

```bash
python3 scripts/build_release.py
```

The build writes:

- `dist/`: clean static PWA release
- `dist-chrome-extension/`: unpacked Chrome extension package

If Node/npm is installed, `npm run build` runs the same release builder.

To test the release build:

```bash
python3 -m http.server 8001 --directory dist
```

Open `http://127.0.0.1:8001/`.

## GitHub Pages

This repository can be published directly from the repository root because `index.html` is already at the top level. In GitHub:

1. Open the repo settings.
2. Go to Pages.
3. Set the source to the default branch and root folder.

The included `.nojekyll` file prevents GitHub Pages from applying Jekyll processing.

## Notes For Repo Hosting

- Generated folders such as `dist/` and `dist-chrome-extension/` are ignored.
- The largest assets are under `assets/game/`; no file in this clean package is over GitHub's 100 MB per-file limit.
- Binary assets are marked in `.gitattributes` so Git will not try to text-diff them.

## Controls

The game is mouse-driven with keyboard shortcuts (WASD/arrows fly, H hail, M map, Tab/Left-Ctrl targeting, Shift+1..8 fleet orders, Q/C/P panels). Use the in-game panels for navigation, inventory, power distribution, settings, docking, ship purchase, missions, and the interstellar map.

## Behavioral Probes

`scripts/behavior-probe.mjs` boots the real game in headless Chromium and checks handoff acceptance scenarios. Dev-only.

```bash
npm i -D playwright && npx playwright install chromium
npm run probe
npm run probe -- --shots ./probe-shots   # also stage and capture the checkpoint operator panel and the incoming player order
```
