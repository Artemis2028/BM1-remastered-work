import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.resolve(scriptDir, '..');
const distDir = path.join(rootDir, 'dist');
const extensionDistDir = path.join(rootDir, 'dist-chrome-extension');
const releaseVersion = '0.1.1';

const includeNames = new Set([
  'index.html',
  'styles.css',
  'app.webmanifest',
  'sw.js',
  'offline-assets.json',
  'src',
  'data',
  'assets',
  'bm-ships'
]);

const excludedNames = new Set([
  '.DS_Store',
  'dist',
  'dist-chrome-extension',
  'tmp',
  'asset-backups',
  'scripts'
]);

const excludedExtensions = new Set([
  '.psd',
  '.ai',
  '.xcf'
]);

async function pathExists(filePath) {
  try {
    await fs.access(filePath);
    return true;
  } catch {
    return false;
  }
}

async function copyFiltered(source, target) {
  const stat = await fs.stat(source);
  const name = path.basename(source);

  if (excludedNames.has(name) || excludedExtensions.has(path.extname(name).toLowerCase())) return;

  if (stat.isDirectory()) {
    await fs.mkdir(target, { recursive: true });
    const entries = await fs.readdir(source);
    for (const entry of entries) {
      await copyFiltered(path.join(source, entry), path.join(target, entry));
    }
    return;
  }

  await fs.mkdir(path.dirname(target), { recursive: true });
  await fs.copyFile(source, target);
}

async function releaseAssetPaths() {
  const assets = [];
  async function walk(directory) {
    const entries = await fs.readdir(directory, { withFileTypes: true });
    for (const entry of entries) {
      const filePath = path.join(directory, entry.name);
      if (excludedNames.has(entry.name) || excludedExtensions.has(path.extname(entry.name).toLowerCase())) continue;
      if (entry.isDirectory()) {
        await walk(filePath);
      } else if (entry.isFile()) {
        assets.push(`./${path.relative(distDir, filePath).split(path.sep).join('/')}`);
      }
    }
  }
  await walk(distDir);
  if (!assets.includes('./offline-assets.json')) assets.push('./offline-assets.json');
  return assets.sort();
}

function extensionManifest() {
  const icons = {
    16: 'assets/app-icons/extension-16.png',
    32: 'assets/app-icons/extension-32.png',
    48: 'assets/app-icons/extension-48.png',
    128: 'assets/app-icons/extension-128.png'
  };
  return {
    manifest_version: 3,
    name: 'Broken Mirror 2',
    short_name: 'BM2',
    version: releaseVersion,
    description: 'A self-contained Broken Mirror 2 game package.',
    action: {
      default_title: 'Open Broken Mirror 2',
      default_icon: icons,
      default_popup: 'extension-popup.html'
    },
    icons
  };
}

async function writeChromeExtensionRelease() {
  if (await pathExists(extensionDistDir)) await fs.rm(extensionDistDir, { recursive: true, force: true });
  await fs.cp(distDir, extensionDistDir, { recursive: true });

  const popupHtml = `<!doctype html>
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
`;
  const launcher = `const GAME_URL = chrome.runtime.getURL('index.html');
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
`;
  await fs.writeFile(path.join(extensionDistDir, 'extension-popup.html'), popupHtml);
  await fs.writeFile(path.join(extensionDistDir, 'extension-launcher.js'), launcher);
  await fs.writeFile(
    path.join(extensionDistDir, 'manifest.json'),
    `${JSON.stringify(extensionManifest(), null, 2)}\n`
  );
}

async function main() {
  if (await pathExists(distDir)) await fs.rm(distDir, { recursive: true, force: true });
  await fs.mkdir(distDir, { recursive: true });

  const entries = await fs.readdir(rootDir);
  for (const entry of entries) {
    if (!includeNames.has(entry)) continue;
    await copyFiltered(path.join(rootDir, entry), path.join(distDir, entry));
  }

  const marker = [
    'Broken Mirror 2 release build',
    `Built: ${new Date().toISOString()}`,
    'Serve this directory over HTTPS or localhost to enable PWA installation.'
  ].join('\n');
  await fs.writeFile(path.join(distDir, 'RELEASE.txt'), `${marker}\n`);
  const offlineManifest = {
    version: '20260617-offline-release',
    generatedAt: new Date().toISOString(),
    assets: await releaseAssetPaths(),
  };
  await fs.writeFile(
    path.join(distDir, 'offline-assets.json'),
    `${JSON.stringify(offlineManifest, null, 2)}\n`,
  );
  await writeChromeExtensionRelease();

  console.log(`Release written to ${distDir}`);
  console.log(`Chrome extension app written to ${extensionDistDir}`);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
