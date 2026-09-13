#!/usr/bin/env node
/**
 * Boots the remaster over HTTP and checks that the live game loaded the
 * bm-ships catalog into spawn, draw, purchase, and save-identity paths.
 */
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SHIM = `
window.__bm1 = {
  state, startWithFaction, getShipStats, getShipVisualProfile, getShipPreviewSrc,
  getNpcShipId, getNpcShipIdForFaction, getShipPurchaseStatus, resolveShipId,
  getSystemIndexByName, applySystemState, renderTopLeftPanel, getGodModeShips,
};
`;

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.webmanifest': 'application/manifest+json',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.webp': 'image/webp',
  '.gif': 'image/gif',
};

function startServer() {
  const server = http.createServer((req, res) => {
    const rel = decodeURIComponent((req.url || '/').split('?')[0]).replace(/^\/+/, '') || 'index.html';
    const file = path.resolve(ROOT, rel);
    if (!file.startsWith(ROOT) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) {
      res.writeHead(404); res.end('not found'); return;
    }
    res.setHeader('Content-Type', MIME[path.extname(file).toLowerCase()] || 'application/octet-stream');
    res.setHeader('Cache-Control', 'no-store');
    if (rel.replace(/\\/g, '/') === 'src/main.js') {
      res.end(fs.readFileSync(file, 'utf8') + SHIM);
      return;
    }
    fs.createReadStream(file).pipe(res);
  });
  return new Promise((resolve) => {
    server.listen(0, '127.0.0.1', () => resolve({ server, port: server.address().port }));
  });
}

async function run() {
  const { chromium } = await import('playwright');
  const { server, port } = await startServer();
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
  const failures = [];
  const note = (ok, msg) => {
    if (!ok) failures.push(msg);
    console.log(`${ok ? 'PASS' : 'FAIL'} ${msg}`);
  };
  try {
    await page.goto(`http://127.0.0.1:${port}/`, { waitUntil: 'domcontentloaded', timeout: 30000 });
    await page.waitForFunction(() => window.__bm1?.state, { timeout: 20000 });
    await page.waitForFunction(() => window.__bm1.state.shipCatalog, { timeout: 30000 });
    await page.evaluate(() => window.__bm1.startWithFaction('ferengi'));
    await page.waitForFunction(() => window.__bm1.state.gameStarted && window.__bm1.state.shipCatalog, { timeout: 15000 });

    const report = await page.evaluate(() => {
      const B = window.__bm1;
      const catalog = B.state.shipCatalog;
      const blenderIdx = B.getSystemIndexByName('Blender');
      const dominicaIdx = B.getSystemIndexByName('Dominica');
      const earthIdx = B.getSystemIndexByName('Earth');
      const savedPlanet = B.state.currentPlanet;
      const probe = {};

      probe.catalogLoaded = Boolean(catalog && catalog.getShip(216));
      probe.imageUrl = catalog.imageUrl(1);
      probe.owned26 = catalog.getShip(26)?.id;
      probe.new26 = catalog.resolveNewShipId(26);
      probe.owned63 = catalog.getShip(63)?.id;
      probe.new63 = catalog.resolveNewShipId(63);
      probe.ship60 = catalog.getShip(60)?.name;
      probe.excalibur = catalog.getShip(347)?.rosterState;
      const size = B.getShipVisualProfile(1);
      probe.draw = size;
      probe.previewIsPack = String(B.getShipPreviewSrc(1) || '').includes('/bm-ships/assets/');

      B.state.currentPlanet = blenderIdx;
      probe.blenderRemnant = [30, 206, 322].every((id) => catalog.eligibleForSpawn(id, {
        systemName: 'Blender', role: 'patrol',
      }));
      probe.blenderHeavyBlocked = [48, 65, 216, 238].every((id) => !catalog.eligibleForSpawn(id, {
        systemName: 'Blender', role: 'patrol',
      }));

      B.state.currentPlanet = dominicaIdx;
      probe.dominicaCruiser = catalog.eligibleForSpawn(216, { systemName: 'Dominica', role: 'patrol' });
      probe.dominicaBattleshipAmbient = catalog.eligibleForSpawn(65, { systemName: 'Dominica', role: 'patrol' });

      B.state.currentPlanet = earthIdx;
      probe.earthGornEmpty = catalog.spawnPool({ systemName: 'Earth', role: 'traffic' }, 'gorn').length === 0;
      probe.unauthorizedInvasionEmpty = catalog.spawnPool({
        systemName: 'Earth', role: 'fleetAttack',
      }, 'dominion').length === 0;
      probe.authorizedInvasion = catalog.eligibleForSpawn(216, {
        systemName: 'Earth', role: 'fleetAttack', authorizedDeployment: true,
      });

      B.state.latinum = 1e9;
      B.state.shipPurchaseTierThresholds = null;
      const rich = catalog.getPurchaseDecision(206, {
        systemName: 'Blender', credits: 1e9, standings: {terran:100,dominion:100},
      });
      probe.authoredThreshold = rich.reason;
      const excalibur = catalog.getPurchaseDecision(347, {
        systemName: 'Paso', vendor: 'paso-project-x', credits: 1e9, standings: {terran:100,dominion:100},
      });
      probe.excaliburAt100 = excalibur.reason;
      B.state.playership = 26;
      probe.resolvedOwned26 = B.resolveShipId(26);
      B.state.currentPlanet = savedPlanet;
      return probe;
    });

    note(report.catalogLoaded, 'in-game catalog loaded (includes Dominion Cruiser 216)');
    note(/\/bm-ships\/assets\//.test(report.imageUrl || ''), `imageUrl uses pack assets (${report.imageUrl})`);
    note(report.previewIsPack, 'preview/src uses pack image URL');
    note(report.owned26 === 26 && report.new26 === 211, 'getShip(26) stays 26; resolveNewShipId(26) is 211');
    note(report.owned63 === 63 && report.new63 == null, 'retired 63 stays loadable and is not a new reference');
    note(String(report.ship60 || '').includes('Concord'), `ship 60 remains independent capital (${report.ship60})`);
    note(report.excalibur === 'active', 'Excalibur is an active balanced hull');
    note(report.draw?.scale === 1 && report.draw.width > 0, `draw profile uses pack size with scale 1 (${JSON.stringify(report.draw)})`);
    note(report.blenderRemnant && report.blenderHeavyBlocked, 'Blender remnant traffic only');
    note(report.dominicaCruiser && report.dominicaBattleshipAmbient === false, 'Dominica core cruiser yes, battleship no ambient');
    note(report.earthGornEmpty, 'Earth Gorn pool stays empty');
    note(report.unauthorizedInvasionEmpty && report.authorizedInvasion, 'invasions require authorizedDeployment');
    note(report.authoredThreshold === 'eligible', `explicit authored standing works without host tier configuration (${report.authoredThreshold})`);
    note(report.excaliburAt100 === 'eligible', `Excalibur is eligible at 100 Terran standing at Project X (${report.excaliburAt100})`);
    note(report.resolvedOwned26 === 26, 'resolveShipId does not remake owned 26');

    const godCount = await page.evaluate(() => {
      const B = window.__bm1;
      B.state.godMode = true;
      B.state.topLeftTab = 'settings';
      B.state.topLeftPanelOpen = true;
      B.renderTopLeftPanel();
      const intro = document.getElementById('intro-story');
      if (intro) intro.classList.add('hidden');
      const start = document.getElementById('start-menu');
      if (start) start.style.display = 'none';
      return B.getGodModeShips().length;
    });
    note(godCount > 66, `God Mode ship list includes catalog hulls (${godCount})`);
    await page.waitForTimeout(200);
    const screenshot = path.join(ROOT, 'tmp-ship-catalog-ingame.png');
    await page.screenshot({ path: screenshot, fullPage: true });
    const switcher = page.locator('.god-ship-switcher');
    if (await switcher.count()) {
      await switcher.evaluate((el) => { el.scrollTop = 0; });
      const switcherShot = path.join(ROOT, 'tmp-ship-catalog-god-switcher.png');
      await switcher.screenshot({ path: switcherShot });
      console.log(`screenshot ${switcherShot}`);
    }
    console.log(`screenshot ${screenshot}`);
    if (failures.length) {
      throw new Error(`${failures.length} in-game catalog checks failed`);
    }
    console.log('in-game catalog smoke passed');
  } finally {
    await browser.close();
    await new Promise((resolve) => server.close(resolve));
  }
}

run().catch((error) => {
  console.error(error);
  process.exit(1);
});
