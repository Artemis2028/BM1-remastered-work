#!/usr/bin/env node
// Three-tree cumulative CPU fixture: 20 contacts, Earth stations, six emitters and six projectiles.
import fs from 'node:fs';
import {createHash} from 'node:crypto';
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
  `window.__bench={createHojFlight:typeof createHojFlight==='function'?createHojFlight:null,hojEmitterKey:typeof hojEmitterKey==='function'?hojEmitterKey:null,ensureActorEW:typeof ensureActorEW==='function'?ensureActorEW:null,state,startWithFaction,applySystemState,getSystemIndexByName,createNpcShip,ensureNpcCombatStats,playerWorldPosition,tick,render,updatePowerSystems,updateProjectiles,updateSensorSystems:typeof updateSensorSystems==='function'?updateSensorSystems:null,sensorWorld:typeof sensorWorld==='undefined'?null:sensorWorld,freeze:()=>new Promise(resolve=>{requestAnimationFrame=cb=>{if(cb.name==='loop')resolve(true);return 0;};})};`;
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
  const result = await page.evaluate(async ({withPasses,starved}) => {
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
    let shotSequence=0;const pins=[];
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
      n.combatHull=n.combatMaxHull=1e9;n.combatShields=n.combatMaxShields=1e9;
      n.lastShotAt=performance.now()+1e9;n.waitUntil=performance.now()+1e9;
      pins.push({x:n.x,y:n.y});
      // Identical hulls/allocations on A/B/C. EW C alone mounts the six paid modules.
      n.power ||= {};n.power.dist={engines:0,weapons:0,shields:0,sensors:5};n.power.energy=200;
      if(i<6&&B.ensureActorEW){const e=B.ensureActorEW(n);e.module=3;e.jammerOrder='on';}

      s.npcShips.push(n);
    }
    const scene=()=>{
      s.npcShips.forEach((n,i)=>{n.x=pins[i].x;n.y=pins[i].y;n.waitUntil=performance.now()+1e9;n.lastShotAt=performance.now()+1e9;});
      if(starved&&B.ensureActorEW)s.npcShips.slice(0,6).forEach(n=>{n.power.energy=0;n.power.dist={engines:0,weapons:0,shields:0,sensors:20};});
      while(s.projectiles.length<6){const target=s.npcShips[shotSequence++%6],x=p.x+300,y=p.y-900;
        const flight=B.createHojFlight?B.createHojFlight({key:B.hojEmitterKey(target),system:s.currentPlanet,x,y,aim:target}):
          {x,y,heading:Math.atan2(target.x-x,-(target.y-y))*180/Math.PI,speed:10,turnRate:1.8};
        const r=flight.heading*Math.PI/180;
        s.projectiles.push({...flight,vx:Math.sin(r)*10,vy:-Math.cos(r)*10,owner:'npc',creditSource:'npc',damage:0,color:'#fff',
          targetId:target.id,targetType:'ship',weaponId:15,kind:'torpedo',born:performance.now(),ttl:3000,
          attack:{key:'benchmark-source',side:'ferengi',system:s.currentPlanet,x,y,time:0,eventId:`benchmark:${shotSequence}`}});
      }
    };
    for (let i = 0; i < 600; i++){scene();B.tick(1);}
    const times = [];
    for (let i = 0; i < 3600; i++) {
      scene();
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
    let detectionPass = null, seekerCPU = null, sensorOnlyCPU = null;
    if (withPasses) {
      if (!B.sensorWorld) throw new Error('Use --passes on sensor/EW trees only');
      // A fresh browser/seeded scene avoids carrying polymorphic test fixtures into the reference benchmark.
      // Use actual 5 Hz scheduling so GC/render/idle opportunities match the production cadence.
      for (let i = 0; i < 50; i++) {
        scene();B.updateProjectiles(1);
        B.updatePowerSystems(12);
        B.updateSensorSystems(12);
        await new Promise(r => setTimeout(r, 200));
      }
      const passes = [],seekers = [],sensorOnly=[];
      const seekerOutliers=[],seekerHist={lt0_25:0,lt0_5:0,lt1:0,lt2:0,lt4:0,ge4:0};
      let seekerHits=0,seekerDeaths=0,seekerMax=0;
      window.__ewSeekProf={player:0,station:0,ship:0};
      for (let i = 0; i < 300; i++) {
        scene();
        const effectsBefore=s.weaponEffects?s.weaponEffects.length:0, projBefore=s.projectiles.length;
        const t = performance.now();
        B.updateProjectiles(1);
        const seekerDone=performance.now();
        seekers.push(seekerDone-t);
        B.updatePowerSystems(12);
        B.updateSensorSystems(12);
        passes.push(performance.now()-seekerDone);
        sensorOnly.push(B.sensorWorld.metrics.elapsedMs);
        const dt=seekers[seekers.length-1];
        const died=projBefore-s.projectiles.length, newEffects=(s.weaponEffects?s.weaponEffects.length:0)-effectsBefore;
        seekerHits+=Math.max(0,newEffects);seekerDeaths+=Math.max(0,died);
        if(dt>seekerMax)seekerMax=dt;
        if(dt<0.25)seekerHist.lt0_25++;else if(dt<0.5)seekerHist.lt0_5++;else if(dt<1)seekerHist.lt1++;
        else if(dt<2)seekerHist.lt2++;else if(dt<4)seekerHist.lt4++;else seekerHist.ge4++;
        if(dt>=1||newEffects>0||died>0)seekerOutliers.push({i,dt,died,newEffects,live:s.projectiles.length});
        await new Promise(r => setTimeout(r, Math.max(0, 200 - (performance.now() - t))));
      }
      detectionPass = {
        ...stats(passes),
        ...B.sensorWorld.metrics
      };
      seekerCPU=stats(seekers);sensorOnlyCPU=stats(sensorOnly);
      detectionPass.passed = detectionPass.p95 <= 2 && detectionPass.p99 <= 4;
      seekerCPU.profile={max:seekerMax,hits:seekerHits,deaths:seekerDeaths,hist:seekerHist,
        hitKinds:window.__ewSeekProf||null,
        outliers:seekerOutliers.sort((a,b)=>b.dt-a.dt).slice(0,12)};
    }
    return {
      detectionPass,seekerCPU,sensorOnlyCPU,
      activeJammers:s.npcShips.filter(n=>n.ew?.strength>0).length,
      mixedEmitterSides:[...new Set(s.npcShips.slice(0,6).map(n=>n.faction))],
      ewEnabled:!!B.ensureActorEW,starved,
      projectileCount:s.projectiles.length,
      projectileModel:B.createHojFlight?'home-on-jam':'ordinary torpedo',
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
  }, {withPasses:process.argv.includes('--passes'),starved:process.argv.includes('--starved')});
  console.log(JSON.stringify({
    root,
    sources:Object.fromEntries(['src/main.js','src/ship-sensors.mjs','src/ship-ew.mjs','src/ship-hoj.mjs'].filter(f=>fs.existsSync(path.join(root,f))).map(f=>[f,createHash('sha256').update(fs.readFileSync(path.join(root,f))).digest('hex')])),
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
  if (errors.length || result.ewEnabled&&!result.starved&&result.activeJammers<6 || result.detectionPass && !result.detectionPass.passed) process.exitCode = 1;
} finally {
  if (browser) await browser.close();
  server.close();
}
