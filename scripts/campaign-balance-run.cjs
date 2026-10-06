// Seeded unattended campaign runs: the captain parks at an independent world and the calendar
// advances N days. Prints a JSON summary per seed (worlds, hulls, strength, treasury, captures,
// Dominion timeline, war resolution, book size, ms per day). Evidence, not balance claims.
//   BM1_TEST_ROOT=dist node scripts/campaign-balance-run.cjs [days=300] [seeds=balance-1,balance-2,balance-3]
const { chromium } = require('playwright');
const http = require('node:http'), fs = require('node:fs'), path = require('node:path');
const root = path.resolve(process.env.BM1_TEST_ROOT || path.join(__dirname, '..'));
const days = Number(process.argv[2]) || 300;
const seeds = (process.argv[3] || 'balance-1,balance-2,balance-3').split(',');
const server = http.createServer((req, res) => {
  const rel = decodeURIComponent(req.url.split('?')[0]).replace(/^\/+/, '') || 'index.html';
  const file = path.resolve(root, rel);
  if (!file.startsWith(root + path.sep) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) { res.writeHead(404); res.end(); return; }
  res.setHeader('Content-Type', { '.js': 'text/javascript', '.mjs': 'text/javascript', '.css': 'text/css', '.html': 'text/html', '.json': 'application/json', '.png': 'image/png', '.svg': 'image/svg+xml' }[path.extname(file)] || 'application/octet-stream');
  fs.createReadStream(file).pipe(res);
});
const EXPORTS = 'window.testBM1={state,startWithFaction,advanceFleetCalendar,fleetBook,Fleet,Campaign,campaign,buildCampaignWorld,ensurePlaytestState,applySystemState,getSystemControl};';
(async () => {
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const browser = await chromium.launch({ headless: true, executablePath: process.env.BM1_CHROMIUM_PATH, args: ['--single-process', '--no-zygote', '--no-sandbox', '--disable-dev-shm-usage', '--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
  const page = await browser.newPage({ viewport: { width: 1280, height: 800 }, serviceWorkers: 'block' });
  const errors = []; page.on('pageerror', (e) => errors.push(e.message));
  await page.route('**/src/main.js*', async (route) => { const r = await route.fetch(); await route.fulfill({ response: r, body: (await r.text()) + '\n' + EXPORTS }); });
  await page.goto(`http://127.0.0.1:${server.address().port}`);
  await page.waitForFunction(() => window.testBM1 && testBM1.state.shipCatalog && testBM1.state.planets.length > 10);
  await page.evaluate(async () => { testBM1.startWithFaction('terran'); await new Promise((res) => { requestAnimationFrame = (cb) => { if (cb.name === 'loop') res(); return 0; }; }); });
  const runs = [];
  for (const seed of seeds) {
    const r = await page.evaluate(({ seed, days }) => {
      const t = testBM1, s = t.state;
      t.startWithFaction('terran'); const p = t.ensurePlaytestState(); delete p.diplomacy; delete p.campaign; t.fleetBook().campaignId = seed;
      const book = t.campaign();
      let world = t.buildCampaignWorld(true);
      const park = world.systems.find((x) => !x.controller && !world.stationsBySystem(x.index).length)?.index ?? 0;
      s.currentPlanet = park; s.myplanet = park + 1; t.applySystemState(park);
      const snap = () => { world = t.buildCampaignWorld(true); const o = {}; for (const id of Object.keys(book.polities)) { const pol = book.polities[id]; o[id] = { worlds: world.systems.filter((x) => x.controller === id).length, hulls: pol.hulls.filter((h) => h.status !== 'lost').length, strength: Math.round(t.Campaign.polityReadiness(book, world, id).strength), treasury: Math.round(pol.treasury), built: pol.builtHulls, lost: pol.lostHulls }; } return o; };
      const opening = snap();
      const t0 = performance.now();
      const timeline = {};
      for (let d = 0; d < days; d += 25) { const n = Math.min(25, days - d); t.advanceFleetCalendar(n, t.Fleet.nextId(t.fleetBook(), 'journey')); if ((d + n) % 100 === 0 || d + n === days) timeline[s.day] = Object.fromEntries(['terran', 'klingon', 'romulan', 'cardassian', 'dominion'].map((id) => [id, snap()[id]])); }
      const ms = performance.now() - t0;
      const dom = book.dominion;
      return { seed, days, parkedAt: s.planets[park]?.name, msPerDay: Number((ms / days).toFixed(1)), opening: { terran: opening.terran, klingon: opening.klingon, dominion: opening.dominion, ratioKlingonTerran: Number((opening.klingon.strength / Math.max(1, opening.terran.strength)).toFixed(2)) }, timeline,
        dominion: { phase: dom.phase, warnings: dom.warnings.map((w) => [w.day, w.id]), invasionDay: dom.phaseDay, convoys: dom.convoys, reinforcementCut: dom.reinforcementCut, entryController: world.systems[dom.entrySystem]?.controller },
        captures: book.stats.captures, battles: book.stats.battlesResolved, built: book.stats.hullsBuilt, lost: book.stats.hullsLost, resolutions: book.resolutions || {}, bookBytes: JSON.stringify(book).length, playtestBytes: JSON.stringify(t.ensurePlaytestState()).length, saveBytes: (() => { try { return JSON.stringify(s.playtest).length + JSON.stringify(s.fleetBook).length; } catch (e) { return null; } })() };
    }, { seed, days });
    runs.push(r);
    console.log(JSON.stringify(r));
  }
  console.log('BALANCE_RUNS', JSON.stringify({ days, seeds: runs.length, errors }));
  if (errors.length) { console.error(errors); process.exit(1); }
  await browser.close(); server.close();
})().catch((e) => { console.error(e); process.exit(1); });
