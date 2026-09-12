#!/usr/bin/env python3
from __future__ import annotations

from datetime import datetime, timezone
from pathlib import Path
import json
import shutil

ROOT = Path(__file__).resolve().parents[1]
DIST = ROOT / "dist"
EXTENSION_DIST = ROOT / "dist-chrome-extension"
RELEASE_VERSION = "0.1.1"

INCLUDE_NAMES = {
    "index.html",
    "styles.css",
    "app.webmanifest",
    "sw.js",
    "offline-assets.json",
    "src",
    "data",
    "assets",
    "bm-ships",
}

EXCLUDED_NAMES = {
    ".DS_Store",
    "dist",
    "dist-chrome-extension",
    "tmp",
    "asset-backups",
    "scripts",
}

EXCLUDED_EXTENSIONS = {
    ".psd",
    ".ai",
    ".xcf",
}


def should_skip(path: Path) -> bool:
    return path.name in EXCLUDED_NAMES or path.suffix.lower() in EXCLUDED_EXTENSIONS


def copy_filtered(source: Path, target: Path) -> None:
    if should_skip(source):
        return

    if source.is_dir():
        target.mkdir(parents=True, exist_ok=True)
        for child in source.iterdir():
            copy_filtered(child, target / child.name)
        return

    target.parent.mkdir(parents=True, exist_ok=True)
    shutil.copy2(source, target)


def release_asset_paths() -> list[str]:
    assets: list[str] = []
    for path in DIST.rglob("*"):
        if not path.is_file() or should_skip(path):
            continue
        relative = path.relative_to(DIST).as_posix()
        assets.append(f"./{relative}")
    if "./offline-assets.json" not in assets:
        assets.append("./offline-assets.json")
    return sorted(assets)


def extension_manifest() -> dict:
    icons = {
        "16": "assets/app-icons/extension-16.png",
        "32": "assets/app-icons/extension-32.png",
        "48": "assets/app-icons/extension-48.png",
        "128": "assets/app-icons/extension-128.png",
    }
    return {
        "manifest_version": 3,
        "name": "Broken Mirror 2",
        "short_name": "BM2",
        "version": RELEASE_VERSION,
        "description": "A self-contained Broken Mirror 2 game package.",
        "action": {
            "default_title": "Open Broken Mirror 2",
            "default_icon": icons,
            "default_popup": "extension-popup.html",
        },
        "icons": icons,
    }


def write_chrome_extension_release() -> None:
    if EXTENSION_DIST.exists():
        shutil.rmtree(EXTENSION_DIST)
    shutil.copytree(DIST, EXTENSION_DIST)

    popup_html = """<!doctype html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <title>Broken Mirror 2 Launcher</title>
    <style>
      :root {
        color-scheme: dark;
        font-family: Arial, Helvetica, sans-serif;
        background: #05070b;
        color: #ffe1ad;
      }
      body {
        width: 260px;
        margin: 0;
        padding: 14px;
        background: #05070b;
      }
      h1 {
        margin: 0 0 10px;
        font-size: 18px;
        letter-spacing: 0;
      }
      button {
        width: 100%;
        min-height: 44px;
        border: 0;
        border-radius: 0;
        background: #ff9f43;
        color: #100805;
        font: 800 15px Arial, Helvetica, sans-serif;
        cursor: pointer;
      }
      p {
        margin: 10px 0 0;
        color: #c9b7aa;
        font-size: 12px;
        line-height: 1.35;
      }
    </style>
  </head>
  <body>
    <h1>Broken Mirror 2</h1>
    <button id="open-game" type="button">Open Game</button>
    <p id="status">Opening the self-contained app...</p>
    <script src="extension-launcher.js"></script>
  </body>
</html>
"""
    launcher = """const GAME_URL = chrome.runtime.getURL('index.html');
const openButton = document.getElementById('open-game');
const statusText = document.getElementById('status');

function openGame() {
  chrome.tabs.create({
    url: GAME_URL,
    active: true
  }, () => {
    if (chrome.runtime.lastError) {
      statusText.textContent = chrome.runtime.lastError.message || 'Chrome could not open the game.';
      return;
    }
    statusText.textContent = 'Game opened.';
    window.close();
  });
}

openButton.addEventListener('click', openGame);
window.addEventListener('DOMContentLoaded', () => {
  setTimeout(openGame, 50);
});
"""
    (EXTENSION_DIST / "extension-popup.html").write_text(popup_html, encoding="utf-8")
    (EXTENSION_DIST / "extension-launcher.js").write_text(launcher, encoding="utf-8")
    (EXTENSION_DIST / "manifest.json").write_text(
        f"{json.dumps(extension_manifest(), indent=2)}\n",
        encoding="utf-8",
    )


def main() -> None:
    if DIST.exists():
        shutil.rmtree(DIST)
    DIST.mkdir(parents=True, exist_ok=True)

    for entry in ROOT.iterdir():
        if entry.name not in INCLUDE_NAMES:
            continue
        copy_filtered(entry, DIST / entry.name)

    marker = "\n".join(
        [
            "Broken Mirror 2 release build",
            f"Built: {datetime.now(timezone.utc).isoformat()}",
            "Serve this directory over HTTPS or localhost to enable PWA installation.",
        ]
    )
    (DIST / "RELEASE.txt").write_text(f"{marker}\n", encoding="utf-8")
    offline_manifest = {
        "version": "20260617-offline-release",
        "generatedAt": datetime.now(timezone.utc).isoformat(),
        "assets": release_asset_paths(),
    }
    (DIST / "offline-assets.json").write_text(
        f"{json.dumps(offline_manifest, indent=2)}\n",
        encoding="utf-8",
    )
    write_chrome_extension_release()
    print(f"Release written to {DIST}")
    print(f"Chrome extension app written to {EXTENSION_DIST}")


if __name__ == "__main__":
    main()
