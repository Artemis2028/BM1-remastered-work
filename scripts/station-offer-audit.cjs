// Enumerates every purchasable (system, hull) and (system, weapon) pair through every outlet, so a
// service migration can be proved access-preserving by diffing two builds. Writes JSON to stdout.
//   BM1_TEST_ROOT=dist node scripts/station-offer-audit.cjs > offers.json
const { chromium } = require('playwright');
const http = require('node:http'), fs = require('node:fs'), path = require('node:path');
const root = path.resolve(process.env.BM1_TEST_ROOT || path.join(__dirname, '..'));
const server = http.createServer((req, res) => {
  const rel = decodeURIComponent(req.url.split('?')[0]).replace(/^\/+/, '') || 'index.html';
  const file = path.resolve(root, rel);
  if (!file.startsWith(root + path.sep) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) { res.writeHead(404); res.end(); return; }
  res.setHeader('Content-Type', { '.js':'text/javascript','.mjs':'text/javascript','.css':'text/css','.html':'text/html','.json':'application/json','.png':'image/png','.svg':'image/svg+xml' }[path.extname(file)] || 'application/octet-stream');
  fs.createReadStream(file).pipe(res);
});
const EXPORTS = 'window.testBM1={state,startWithFaction,applySystemState,getShipyardStock,getStationWeaponStock,getShipStats,getStationOwner,fleetStationServices,getSystemFaction};';
async function auditOffers() {
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const browser = await chromium.launch({ headless: true, executablePath: process.env.BM1_CHROMIUM_PATH,
    args: ['--single-process', '--no-zygote', '--no-sandbox', '--disable-dev-shm-usage', '--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
  const page = await browser.newPage({ viewport: { width: 1280, height: 800 }, serviceWorkers: 'block' });
  const errors = []; page.on('pageerror', (e) => errors.push(e.message));
  await page.route('**/src/main.js*', async (route) => { const r = await route.fetch(); await route.fulfill({ response: r, body: (await r.text()) + '\n' + EXPORTS }); });
  await page.goto(`http://127.0.0.1:${server.address().port}`);
  await page.waitForFunction(() => window.testBM1 && testBM1.state.shipCatalog && testBM1.state.planets.length > 10);
  await page.evaluate(async () => { testBM1.startWithFaction('terran'); await new Promise((res) => { requestAnimationFrame = (cb) => { if (cb.name === 'loop') res(); return 0; }; }); });
  const out = await page.evaluate(() => {
    const t = testBM1, s = t.state, offers = [];
    // Neutral, maximally-trusting captain so standing gates do not hide authored offers.
    for (const f of Object.keys(s.factionStanding || {})) s.factionStanding[f] = 100;
    for (let i = 0; i < s.planets.length; i++) {
      s.currentPlanet = i; t.applySystemState(i);
      for (const st of s.stations.filter((x) => !x.destroyed && !x.underConstruction)) {
        let ships = [], weapons = [];
        try { ships = t.getShipyardStock(st).map((x) => Number(x.id)); } catch (e) { ships = ['ERR:' + e.message]; }
        try { weapons = t.getStationWeaponStock(st).map((x) => Number(x.id)); } catch (e) { weapons = ['ERR:' + e.message]; }
        offers.push({ system: i, station: st.id, name: st.name, type: st.stationTypeId, ships, weapons, sell: !!t.fleetStationServices(st).sell });
      }
      try { offers.push({ system: i, station: null, name: 'planet', type: null, ships: t.getShipyardStock(null).map((x) => Number(x.id)), weapons: [], sell: true }); } catch (e) { /* no planet market */ }
    }
    return offers;
  });
  await browser.close(); server.close();
  return { root: path.basename(root), errors, offers: out };
}
module.exports = { auditOffers };
if (require.main === module) auditOffers().then((r) => console.log(JSON.stringify(r)));
