#!/usr/bin/env node
// Pinned four-tree CPU fixture. The 2/4 ms gate is the original full-workload
// timer: updatePowerSystems(12) + updateSensorSystems(12) after the seeker
// window. Current Platinum evidence for 51738ca is Astra's rerun family
// (C2 3.70/9.20 and 2.00/4.30, both failures). Historical performance-*.json
// 2.50/6.90 is an older tip, kept as evidence, not as current 51738ca results.
// Do not invent a replacement gate. Report detection-pass, updateMs,
// electronicsPass and whole-frame separately. Pre-sensor + --passes writes
// those series as not applicable, never zero. Optional --profile times
// funding / snapshots / detection / sharing / scan separately and must
// stay off the unprofiled gate run so instrumentation overhead is visible.
import {spawnSync} from 'node:child_process';
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
import {
  deriveGcSummary,
  PLATINUM_EVIDENCE,
  preloadInjectedFlags,
  PROTOCOL,
  selectRecordedArgv,
  sha256File
} from './ew-bench-lib.mjs';
const harnessPath = fileURLToPath(import.meta.url);
const harnessHash = createHash('sha256').update(fs.readFileSync(harnessPath)).digest('hex');
const argv = process.argv;
const argValue = (name, fallback = null) => {
  const i = argv.indexOf(name);
  return i < 0 || i + 1 >= argv.length ? fallback : argv[i + 1];
};
const argInt = (name, fallback) => {
  const raw = argValue(name, null);
  if (raw == null) return fallback;
  const n = Number(raw);
  if (!Number.isInteger(n) || n < 0) throw new Error(`${name} requires a non-negative integer`);
  return n;
};
const root = path.resolve(argValue('--root', fileURLToPath(new URL('../', import.meta.url))));
const withPasses = argv.includes('--passes');
const starved = argv.includes('--starved');
const withProfile = argv.includes('--profile');
const diagnostics = argv.includes('--diagnostics');
const gcPlacement = argValue('--gc-placement', diagnostics ? 'between-blocks' : 'none');
if (!['none', 'between-blocks', 'inside-window'].includes(gcPlacement)) {
  throw new Error('--gc-placement must be none | between-blocks | inside-window');
}
if (gcPlacement !== 'none' && !diagnostics) {
  throw new Error('--gc-placement other than none requires --diagnostics');
}
const passWarmup = argInt('--pass-warmup', withPasses ? 50 : 0);
const passSamples = argInt('--pass-samples', withPasses ? 300 : 0);
const tickWarmup = argInt('--tick-warmup', 600);
const tickSamples = argInt('--tick-samples', 3600);
const treeLabel = argValue('--tree-label', null);
const sequence = argInt('--sequence', null);
const shim =
  `window.__bench={createHojFlight:typeof createHojFlight==='function'?createHojFlight:null,hojEmitterKey:typeof hojEmitterKey==='function'?hojEmitterKey:null,liveJammerSignal:typeof liveJammerSignal==='function'?liveJammerSignal:null,sampleHojIfDue:typeof sampleHojIfDue==='function'?sampleHojIfDue:null,sampleDueHojSeekers:typeof sampleDueHojSeekers==='function'?sampleDueHojSeekers:null,ensureActorEW:typeof ensureActorEW==='function'?ensureActorEW:null,state,startWithFaction,applySystemState,getSystemIndexByName,createNpcShip,ensureNpcCombatStats,playerWorldPosition,tick,render,updatePowerSystems,updateProjectiles,updateSensorSystems:typeof updateSensorSystems==='function'?updateSensorSystems:null,sensorWorld:typeof sensorWorld==='undefined'?null:sensorWorld,freeze:()=>new Promise(resolve=>{requestAnimationFrame=cb=>{if(cb.name==='loop')resolve(true);return 0;};})};`;
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
// Acceptance: no extra flags (same chromium.launch() as the pinned helper).
// Forced GC needs Chromium --js-flags=--expose-gc; that flag is diagnostics-only.
const launchExtraArgs = gcPlacement === 'none' ? [] : ['--js-flags=--expose-gc'];
const launchOptions = launchExtraArgs.length ? {args: launchExtraArgs} : {};
let browser;
try {
  browser = await chromium.launch(launchOptions);
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
  const result = await page.evaluate(async ({withPasses,starved,withProfile,gcPlacement,passWarmup,passSamples,tickWarmup,tickSamples}) => {
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
    const originMs = performance.now();
    const originEpochMs = Date.now();
    const gcState = {
      placement: gcPlacement,
      gcFunctionPresent: typeof gc === 'function',
      calledBeforeMeasuredWindow: false,
      calledAfterMeasuredWindow: false,
      calledInsideMeasuredWindow: false
    };
    const forceGc = where => {
      if (typeof gc !== 'function') return false;
      gc();
      gcState[where] = true;
      return true;
    };
    for (let i = 0; i < tickWarmup; i++){scene();B.tick(1);}
    const times = [];
    const tickAt = [];
    for (let i = 0; i < tickSamples; i++) {
      scene();
      const t = performance.now();
      B.tick(1);
      times.push(performance.now() - t);
      tickAt.push(t - originMs);
    }
    const rendering = [];
    for (let i = 0; i < 300; i++) {
      const t = performance.now();
      B.render();
      rendering.push(performance.now() - t);
    }
    const stats = a => {
      const sorted = a.slice().sort((x, y) => x - y);
      const n = sorted.length;
      return {
        samples: n,
        p50: n ? sorted[Math.floor(n * .5)] : null,
        p95: n ? sorted[Math.floor(n * .95)] : null,
        p99: n ? sorted[Math.floor(n * .99)] : null
      };
    };
    const na = reason => ({
      applicable: false,
      samples: null,
      p50: null,
      p95: null,
      p99: null,
      passed: null,
      series: 'not applicable',
      reason
    });
    const hasSensors = !!(B.updateSensorSystems && B.sensorWorld);
    let detectionPass = null, electronicsPass = null, updateMs = null, seekerCPU = null, instrumented = null, detailProfile = null;
    let passRecords = null;
    if (withPasses && !hasSensors) {
      detectionPass = na('pre-sensor tree has no detection pass');
      electronicsPass = na('pre-sensor tree has no power+sensors full-workload timer');
      updateMs = na('pre-sensor tree has no updateSensorSystems');
      seekerCPU = na('pre-sensor tree has no sensor-pass seeker window');
      instrumented = na('pre-sensor tree has no sensorWorld.metrics');
      detailProfile = na(withProfile ? 'pre-sensor tree has no sensor slices' : 'run without --profile');
    } else if (withPasses) {
      // Same order as the Platinum receipts: projectiles, then power+sensors.
      for (let i = 0; i < passWarmup; i++) {
        scene();
        B.updateProjectiles(1);
        B.updatePowerSystems(12);
        B.updateSensorSystems(12);
        await new Promise(r => setTimeout(r, 200));
      }
      const electronics = [], detectionOnly = [], updates = [], seekers = [];
      const seekerOutliers = [], seekerHist = {lt0_25: 0, lt0_5: 0, lt1: 0, lt2: 0, lt4: 0, ge4: 0};
      const sliceKeys = ['fundMs', 'snapshotMs', 'passMs', 'scanMs', 'jamSetupMs', 'detectMs', 'shareMs'];
      const slices = Object.fromEntries(sliceKeys.map(k => [k, []]));
      let seekerHits = 0, seekerDeaths = 0, seekerMax = 0;
      window.__ewSeekProf = {player: 0, station: 0, ship: 0};
      passRecords = [];
      // Diagnostic hygiene: forced GC *outside* the measured window, after warmup.
      if (gcPlacement === 'between-blocks') forceGc('calledBeforeMeasuredWindow');
      for (let i = 0; i < passSamples; i++) {
        scene();
        const effectsBefore = s.weaponEffects ? s.weaponEffects.length : 0, projBefore = s.projectiles.length;
        if (withProfile) window.__ewProfile = {fundMs:0,snapshotMs:0,passMs:0,scanMs:0,jamSetupMs:0,detectMs:0,shareMs:0};
        else window.__ewProfile = null;
        const tEpochMs = Date.now();
        const t = performance.now();
        B.updateProjectiles(1);
        const afterSeekers = performance.now();
        B.updatePowerSystems(12);
        B.updateSensorSystems(12);
        const afterElectronics = performance.now();
        if (withProfile) {
          const p = window.__ewProfile || {};
          for (const k of sliceKeys) slices[k].push(Number(p[k]) || 0);
        }
        seekers.push(afterSeekers - t);
        electronics.push(afterElectronics - afterSeekers);
        const m = B.sensorWorld.metrics || {};
        const detectionMs = Number.isFinite(m.detectionMs) ? m.detectionMs : (Number.isFinite(m.elapsedMs) ? m.elapsedMs : null);
        if (detectionMs != null) detectionOnly.push(detectionMs);
        if (Number.isFinite(m.updateMs)) updates.push(m.updateMs);
        const dt = seekers[seekers.length - 1];
        const died = projBefore - s.projectiles.length, newEffects = (s.weaponEffects ? s.weaponEffects.length : 0) - effectsBefore;
        seekerHits += Math.max(0, newEffects);
        seekerDeaths += Math.max(0, died);
        if (dt > seekerMax) seekerMax = dt;
        if (dt < 0.25) seekerHist.lt0_25++;
        else if (dt < 0.5) seekerHist.lt0_5++;
        else if (dt < 1) seekerHist.lt1++;
        else if (dt < 2) seekerHist.lt2++;
        else if (dt < 4) seekerHist.lt4++;
        else seekerHist.ge4++;
        if (dt >= 1 || newEffects > 0 || died > 0) seekerOutliers.push({i, dt, died, newEffects, live: s.projectiles.length});
        passRecords.push({
          i,
          tEpochMs,
          tRelMs: t - originMs,
          electronicsMs: electronics[electronics.length - 1],
          detectionMs,
          updateMs: Number.isFinite(m.updateMs) ? m.updateMs : null,
          projectileMs: dt,
          observers: m.observers ?? null,
          actors: m.actors ?? null,
          pairs: m.pairs ?? null,
          jammerPairs: m.jammerPairs ?? null,
          liveProjectiles: s.projectiles.length,
          died,
          newEffects,
          activeJammers: s.npcShips.filter(n => n.ew?.strength > 0).length
        });
        // Diagnostic suppression: forced GC *inside* the measured window, between samples.
        if (gcPlacement === 'inside-window') forceGc('calledInsideMeasuredWindow');
        await new Promise(r => setTimeout(r, Math.max(0, 200 - (performance.now() - t))));
      }
      if (gcPlacement === 'between-blocks') forceGc('calledAfterMeasuredWindow');
      electronicsPass = {
        applicable: true,
        ...stats(electronics),
        series: 'electronicsPass = updatePowerSystems + updateSensorSystems',
        sameSeriesAsPlatinumDetectionPass: true,
        includes: ['power', 'electronics', 'snapshots', 'sensing', 'sharing', 'scan'],
        excludes: ['projectile-movement', 'collision', 'damage', 'fx'],
        gate: {p95Ms: 2, p99Ms: 4},
        gateAuthority: 'electronicsPass',
        thresholdsRecalibrated: false
      };
      electronicsPass.passed = electronicsPass.p95 <= 2 && electronicsPass.p99 <= 4;
      detectionPass = detectionOnly.length ? {
        applicable: true,
        ...stats(detectionOnly),
        series: 'detection-pass = engine elapsedMs/detectionMs (detection+sharing; not the 2/4 gate)',
        gateAuthority: 'none'
      } : na('this tree does not record a detection-pass elapsedMs');
      updateMs = updates.length ? {
        applicable: true,
        ...stats(updates),
        series: 'updateMs = complete updateSensorSystems (not the 2/4 gate)'
      } : na('this tree does not record updateMs');
      seekerCPU = {
        applicable: true,
        ...stats(seekers),
        series: 'seekerCPU = full updateProjectiles (guidance, movement, collision, damage, FX)',
        profile: {
          max: seekerMax,
          hits: seekerHits,
          deaths: seekerDeaths,
          hist: seekerHist,
          hitKinds: window.__ewSeekProf || null,
          outliers: seekerOutliers.sort((a, b) => b.dt - a.dt).slice(0, 12)
        }
      };
      const last = B.sensorWorld.metrics || {};
      instrumented = {
        applicable: true,
        elapsedMs: Number.isFinite(last.elapsedMs) ? last.elapsedMs : null,
        detectionMs: Number.isFinite(last.detectionMs) ? last.detectionMs : null,
        passMs: Number.isFinite(last.passMs) ? last.passMs : null,
        updateMs: Number.isFinite(last.updateMs) ? last.updateMs : null,
        observers: last.observers ?? null,
        actors: last.actors ?? null,
        pairs: last.pairs ?? null,
        jammerPairs: last.jammerPairs ?? null,
        note: 'elapsedMs/detectionMs are detection+sharing only and are not the 2/4 gate'
      };
      detailProfile = withProfile ? {
        applicable: true,
        series: 'optional instrumentation; not the 2/4 gate',
        slices: Object.fromEntries(sliceKeys.map(k => [k, stats(slices[k])])),
        note: 'fundMs = power/electronics funding; snapshotMs = actor snapshots; jamSetupMs + detectMs + shareMs = SensorWorld.pass; scanMs = scan advancement. Keep this run separate from the unprofiled gate.'
      } : {
        applicable: false,
        reason: 'run without --profile'
      };
    }
    return {
      electronicsPass,
      detectionPass,
      updateMs,
      seekerCPU,
      instrumented,
      detailProfile,
      profiled: !!withProfile,
      gc: gcState,
      sensorOnlyCPU: updateMs,
      activeJammers: s.npcShips.filter(n => n.ew?.strength > 0).length,
      mixedEmitterSides: [...new Set(s.npcShips.slice(0, 6).map(n => n.faction))],
      ewEnabled: !!B.ensureActorEW,
      starved,
      projectileCount: s.projectiles.length,
      projectileModel: B.createHojFlight ? 'home-on-jam' : 'ordinary torpedo',
      warmupSeconds: (withPasses ? passWarmup : 0) * 0.2,
      simulationSeconds: (withPasses ? passSamples : 0) * 0.2,
      contacts: s.npcShips.length,
      stations: s.stations.length,
      frameCPU: stats(times),
      renderCPU: stats(rendering),
      samples: {
        originEpochMs,
        ticks: {tRelMs: tickAt, dtMs: times},
        passes: passRecords
      },
      viewport: {
        width: innerWidth,
        height: innerHeight
      },
      hardwareConcurrency: navigator.hardwareConcurrency,
      deviceMemory: navigator.deviceMemory,
      userAgent: navigator.userAgent
    };
  }, {withPasses,starved,withProfile,gcPlacement,passWarmup,passSamples: withPasses ? passSamples : 0,tickWarmup,tickSamples});
  const git = (cwd, args) => {
    const r = spawnSync('git', ['-C', cwd, ...args], {encoding: 'utf8'});
    return r.status === 0 ? (r.stdout || '').trim() : null;
  };
  const recordedArgv = (() => {
    const found = [];
    try {
      for (const pid of fs.readdirSync('/proc')) {
        if (!/^\d+$/.test(pid)) continue;
        try {
          const cmd = fs.readFileSync(`/proc/${pid}/cmdline`, 'utf8').split('\0').filter(Boolean);
          if (/chrome/i.test(cmd[0] || '')) found.push({pid: Number(pid), argv: cmd});
        } catch { /* raced */ }
      }
    } catch { /* no /proc */ }
    return selectRecordedArgv(found);
  })();
  const helperPath = path.join(path.dirname(harnessPath), 'ew-bench-lib.mjs');
  const helperSha256 = fs.existsSync(helperPath) ? sha256File(helperPath) : null;
  const injectedFlags = preloadInjectedFlags(recordedArgv, launchExtraArgs);
  const payload = {
    root,
    treeLabel,
    sequence,
    diagnostics,
    acceptanceEligible: withPasses && passWarmup === 50 && passSamples >= 1000 && tickWarmup === 600 && tickSamples === 3600 && !withProfile && !diagnostics && !starved && gcPlacement === 'none',
    measuredTree: {
      cwd: root,
      commit: git(root, ['rev-parse', 'HEAD']),
      tree: git(root, ['rev-parse', 'HEAD^{tree}']),
      dirty: git(root, ['status', '--porcelain']) || ''
    },
    harness: {
      file: 'scripts/ew-frame-benchmark.mjs',
      sha256: harnessHash,
      helperFile: 'scripts/ew-bench-lib.mjs',
      helperSha256,
      gate: 'electronicsPass (original full-workload timer) p95<=2ms p99<=4ms',
      sameSeriesAsPlatinum: 'electronicsPass is the power+sensors wall-clock (historical performance-*.json named that series detectionPass)',
      platinumEvidence: PLATINUM_EVIDENCE,
      cumulativeFrameGate: 'whole-frame tick p95 vs pre-sensor baseline <=2ms',
      increments: ['EW−sensors', 'EW−pre-sensor'],
      order: 'updateProjectiles(1) → updatePowerSystems(12) → updateSensorSystems(12)',
      percentile: PROTOCOL.percentile,
      timer: PROTOCOL.timer,
      measurementBoundary: 'electronicsPass is the unchanged 2/4 full-workload timer. detectionPass, updateMs and whole-frame tick are reported separately and are not substitute gates. SeekerCPU is the full projectile update and stays in whole-frame measurements. --profile is optional and is not the gate.',
      thresholdsRecalibrated: false,
      profiled: withProfile,
      diagnostics,
      gcPlacement,
      previousHarness: {
        commit: 'e02235caea7e23296f827d8519330c664e84e241',
        file: 'docs/ew/receipts/harness-e02235c.mjs',
        sha256: 'e79876004ea9b8846ed6f31ca040fc1ff2452db43f77ba744837d9fb6b8b115d',
        note: 'Preserved old helper. This file is the new harness; freeze it only after Fable reviews the diff. Unchanged means measurement boundaries and thresholds, not the entire file.'
      }
    },
    sources: Object.fromEntries(['src/main.js', 'src/ship-sensors.mjs', 'src/ship-ew.mjs', 'src/ship-hoj.mjs'].filter(f =>
      fs.existsSync(path.join(root, f))).map(f => [f, createHash('sha256').update(fs.readFileSync(path.join(root, f))).digest('hex')])),
    browser: await browser.version(),
    launch: {
      extraArgs: launchExtraArgs,
      options: launchOptions,
      exposeGcFlag: launchExtraArgs.includes('--js-flags=--expose-gc'),
      recordedArgv,
      preloadInjectedFlags: injectedFlags,
      preloadInjectedFlagsNote: PROTOCOL.preloadInjectedFlags.note,
      argv: process.argv.slice(),
      execPath: process.execPath,
      node: process.version
    },
    environment: {
      platform: os.platform(),
      arch: os.arch(),
      cpu: os.cpus()[0]?.model,
      logicalCPUs: os.availableParallelism(),
      hostnameClass: /8573C/i.test(os.cpus()[0]?.model || '') ? 'platinum-8573C-reference' : 'supplementary-not-platinum'
    },
    workload: {
      system: 'Earth',
      contacts: 20,
      stations: result.stations,
      projectiles: 6,
      warmupTicks: tickWarmup,
      measuredTicks: tickSamples,
      passWarmup: withPasses ? passWarmup : 0,
      passSamples: withPasses ? passSamples : 0,
      passCadenceMs: 200,
      renderSamples: 300
    },
    measurementConfig: {
      passWarmup: withPasses ? passWarmup : 0,
      passSamples: withPasses ? passSamples : 0,
      tickWarmup,
      tickSamples,
      passCadenceMs: 200,
      profiled: withProfile,
      diagnostics,
      starved,
      gcPlacement
    },
    ...result,
    errors
  };
  payload.gc = deriveGcSummary(result.gc || {}, {
    diagnostics,
    exposeGcFlag: launchExtraArgs.includes('--js-flags=--expose-gc'),
    gcPlacement
  });
  console.log(JSON.stringify(payload, null, 2));
  if (errors.length || result.ewEnabled && !result.starved && result.activeJammers < 6 || result.electronicsPass?.applicable && result.electronicsPass.passed === false) process.exitCode = 1;
} finally {
  if (browser) await browser.close();
  server.close();
}
