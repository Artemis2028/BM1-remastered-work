// Focused measurement, not a gate: the cost of one interstellar-map frame (drawInterstellarMapOverlay:
// the chart canvas plus the side rails) at normal and high display density, at three viewports.
// Same tree, same seed, same selected system; 20 warm-up frames then 150 timed frames per cell.
// Also counts canvas backing-store resizes during the timed frames, which should be zero.
//
// Usage: node scripts/map-render-bench.cjs [--out file.json]
const fs = require('node:fs');
const { startProbe } = require('./probe-harness.cjs');

const VIEWPORTS = [{ width: 1280, height: 800 }, { width: 1920, height: 1080 }, { width: 3440, height: 1440 }];
const DENSITIES = [1, 2];
const WARM = 20, FRAMES = 150;

(async () => {
  const rows = [];
  for (const dpr of DENSITIES) {
    const probe = await startProbe({ pageOptions: { deviceScaleFactor: dpr } });
    const { page, ev, fresh } = probe;
    for (const vp of VIEWPORTS) {
      await page.setViewportSize(vp);
      await page.waitForFunction((w) => document.getElementById('game').width === w, vp.width);
      await fresh('bench');
      const r = await ev(({ WARM, FRAMES }) => {
        const t = testBM1, s = t.state;
        s.selectedPlanet = s.planets.findIndex((p, i) => i !== Number(s.currentPlanet) && t.isChartSystemVisible(i));
        t.openMap();
        for (let i = 0; i < WARM; i++) t.drawInterstellarMapOverlay();
        const c = document.getElementById('interstellar-map-canvas');
        let resizes = 0;
        const obs = new MutationObserver((m) => { resizes += m.filter((x) => x.attributeName === 'width' || x.attributeName === 'height').length; });
        obs.observe(c, { attributes: true });
        const times = [];
        for (let i = 0; i < FRAMES; i++) { const a = performance.now(); t.drawInterstellarMapOverlay(); times.push(performance.now() - a); }
        return new Promise((res) => setTimeout(() => { obs.disconnect(); t.closeMap(); times.sort((x, y) => x - y);
          res({ backing: `${c.width}x${c.height}`, median: times[Math.floor(times.length / 2)], p95: times[Math.floor(times.length * 0.95)], mean: times.reduce((n, x) => n + x, 0) / times.length, resizes, mode: t.getStarChartLayout ? t.getStarChartLayout().mode : 'n/a' }); }, 50));
      }, { WARM, FRAMES });
      rows.push({ viewport: `${vp.width}x${vp.height}`, dpr, ...r });
      console.log(JSON.stringify(rows[rows.length - 1]));
    }
    await Promise.race([probe.close(), new Promise((r) => setTimeout(r, 15000))]);
  }
  console.log('\n| viewport | dpr | backing | layout | median ms | p95 ms | mean ms | resizes during timed frames |');
  console.log('| --- | --- | --- | --- | --- | --- | --- | --- |');
  for (const r of rows) console.log(`| ${r.viewport} | ${r.dpr} | ${r.backing} | ${r.mode} | ${r.median.toFixed(2)} | ${r.p95.toFixed(2)} | ${r.mean.toFixed(2)} | ${r.resizes} |`);
  const outArg = process.argv.indexOf('--out');
  if (outArg > -1) fs.writeFileSync(process.argv[outArg + 1], JSON.stringify(rows, null, 2));
  process.exit(0);
})().catch((e) => { console.error(e); process.exit(1); });
