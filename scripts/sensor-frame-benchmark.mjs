#!/usr/bin/env node
 // Paired whole-frame CPU benchmark. Use identical --root scenes before/after the sensor patch.
import fs from 'node:fs';
import os from 'node:os';
import http from 'node:http';
import path from 'node:path';
import {
  fileURLToPath
} from 'node:url';
import {
  chromium
} from 'playwright';
const root = path.resolve(process.argv.includes('--root') ? process.argv[process.argv.indexOf('--root') + 1] :
  fileURLToPath(new URL('../', import.meta.url)));
const shim =
  `window.__bench={state,startWithFaction,applySystemState,getSystemIndexByName,createNpcShip,ensureNpcCombatStats,playerWorldPosition,tick,render,updatePowerSystems,updateSensorSystems:typeof updateSensorSystems==='function'?updateSensorSystems:null,sensorWorld:typeof sensorWorld==='undefined'?null:sensorWorld,freeze:()=>new Promise(resolve=>{requestAnimationFrame=cb=>{if(cb.name==='loop')resolve(true);return 0;};})};`;
const mime = {
  '.html': 'text/html',
  '.js': 'text/javascript',
  '.mjs': 'text/javascript',
  '.json': 'application/json',
  '.css': 'text/css',
  '.png': 'image/png',
  '.gif': 'image/gif',
  '.webp': 'image/webp'
};
const server = http.createServer((req, res) => {
  const rel = decodeURIComponent((req.url || '/').split('?')[0]).replace(/^\/+/, '') || 'index.html',
    file = path.resolve(root, rel);
  if (!file.startsWith(root + path.sep) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) {
    res.writeHead(404);
    res.end();
    return;
  }
  res.setHeader('Content-Type', mime[path.extname(file)] || 'application/octet-stream');
  res.setHeader('Cache-Control', 'no-store');
  if (rel === 'src/main.js') res.end(fs.readFileSync(file, 'utf8') + shim);
  else fs.createReadStream(file).pipe(res);
});
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
let browser;
try {
  browser = await chromium.launch();
  const page = await browser.newPage({
    viewport: {
      width: 1280,
      height: 850
    }
  });
  const errors = [];
  page.on('pageerror', e => errors.push(e.message));
  await page.goto(`http://127.0.0.1:${server.address().port}/`);
  await page.waitForFunction(() => window.__bench?.state.shipCatalog && window.__bench.state.planets.length > 10);
  const result = await page.evaluate(async (withPasses) => {
    const B = window.__bench,
      s = B.state;
    B.startWithFaction('terran');
    await B.freeze();
    s.currentPlanet = B.getSystemIndexByName('Earth');
    B.applySystemState(s.currentPlanet);
    s.npcShips = [];
    s.projectiles = [];
    s.factionStanding = {};
    s.activeFleetAttack = null;
    s.nextFleetAttackAt = performance.now() + 1e9;
    s.spawnProtectionUntil = performance.now() + 1e9;
    s.ship.velocity = 0;
    const p = B.playerWorldPosition();
    for (let i = 0; i < 20; i++) {
      const n = B.createNpcShip({
        id: 9700 + i,
        seed: 9700 + i,
        shipId: 1,
        faction: i % 2 ? 'terran' : 'ferengi',
        role: 'traffic',
        hostile: false,
        attitude: 'neutral',
        from: {
          x: p.x + Math.cos(i) * ((i + 1) * 80),
          y: p.y + Math.sin(i) * ((i + 1) * 80)
        }
      });
      B.ensureNpcCombatStats(n);
      n.trafficWarp = null;
      s.npcShips.push(n);
    }
    for (let i = 0; i < 600; i++) B.tick(1);
    const times = [];
    for (let i = 0; i < 3600; i++) {
      const t = performance.now();
      B.tick(1);
      times.push(performance.now() - t);
    }
    const rendering = [];
    for (let i = 0; i < 300; i++) {
      const t = performance.now();
      B.render();
      rendering.push(performance.now() - t);
    }
    const stats = a => {
      a.sort((a, b) => a - b);
      return {
        samples: a.length,
        p50: a[Math.floor(a.length * .5)],
        p95: a[Math.floor(a.length * .95)],
        p99: a[Math.floor(a.length * .99)]
      };
    };
    let detectionPass = null;
    if (withPasses) {
      if (!B.sensorWorld) throw new Error('This checkout has no sensor module');
      // A fresh browser/seeded scene avoids carrying polymorphic test fixtures into the reference benchmark.
      // Use actual 5 Hz scheduling so GC/render/idle opportunities match the production cadence.
      for (let i = 0; i < 50; i++) {
        B.updatePowerSystems(12);
        B.updateSensorSystems(12);
        await new Promise(r => setTimeout(r, 200));
      }
      const electronics = [], detectionOnly = [], sensorUpdates = [];
      for (let i = 0; i < 300; i++) {
        const t = performance.now();
        B.updatePowerSystems(12);
        B.updateSensorSystems(12);
        electronics.push(performance.now() - t);
        detectionOnly.push(B.sensorWorld.metrics.passMs ?? B.sensorWorld.metrics.elapsedMs);
        if (Number.isFinite(B.sensorWorld.metrics.updateMs)) sensorUpdates.push(B.sensorWorld.metrics.updateMs);
        await new Promise(r => setTimeout(r, Math.max(0, 200 - (performance.now() - t))));
      }
      const electronicsPass = {
        ...stats(electronics),
        series: 'power+sensors wall-clock'
      };
      electronicsPass.passed = electronicsPass.p95 <= 2 && electronicsPass.p99 <= 4;
      detectionPass = {
        ...stats(detectionOnly),
        series: 'detection passMs/elapsedMs',
        ...B.sensorWorld.metrics,
        electronicsPass,
        sensorUpdate: sensorUpdates.length ? { ...stats(sensorUpdates), series: 'sensor updateMs' } : null,
        gateAuthority: 'electronicsPass'
      };
    }
    return {
      detectionPass,
      electronicsPass: detectionPass?.electronicsPass || null,
      sensorUpdate: detectionPass?.sensorUpdate || null,
      warmupSeconds: 10,
      simulationSeconds: 60,
      contacts: s.npcShips.length,
      stations: s.stations.length,
      frameCPU: stats(times),
      renderCPU: stats(rendering),
      viewport: {
        width: innerWidth,
        height: innerHeight
      },
      hardwareConcurrency: navigator.hardwareConcurrency,
      deviceMemory: navigator.deviceMemory,
      userAgent: navigator.userAgent
    };
  }, process.argv.includes('--passes'));
  console.log(JSON.stringify({
    root,
    browser: await browser.version(),
    environment: {
      platform: os.platform(),
      arch: os.arch(),
      cpu: os.cpus()[0]?.model,
      logicalCPUs: os.availableParallelism()
    },
    ...result,
    errors
  }, null, 2));
  if (errors.length || result.electronicsPass && !result.electronicsPass.passed) process.exitCode = 1;
} finally {
  if (browser) await browser.close();
  server.close();
}
