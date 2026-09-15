// Run with Playwright installed. Starts its own static server; BM1_TEST_ROOT can select dist.
// Test-only exports are appended in the browser response, never to game source.
const { chromium } = require('playwright');
const assert = require('node:assert/strict');
const http = require('node:http'), fs = require('node:fs'), path = require('node:path');
const root = path.resolve(process.env.BM1_TEST_ROOT || path.join(__dirname, '..'));
const server=http.createServer((req,res)=>{
 const rel=decodeURIComponent(req.url.split('?')[0]).replace(/^\/+/, '') || 'index.html';
 const file=path.resolve(root,rel);
 if(!file.startsWith(root+path.sep) || !fs.existsSync(file) || fs.statSync(file).isDirectory()){res.writeHead(404);res.end();return;}
 res.setHeader('Content-Type',({'.js':'text/javascript','.mjs':'text/javascript','.css':'text/css','.html':'text/html','.json':'application/json','.png':'image/png','.svg':'image/svg+xml'})[path.extname(file)] || 'application/octet-stream');
 fs.createReadStream(file).pipe(res);
});
(async () => {
 await new Promise(r=>server.listen(0,'127.0.0.1',r));
 const browser = await chromium.launch({headless:true, executablePath:process.env.BM1_CHROMIUM_PATH, args:['--single-process','--no-zygote','--no-sandbox','--disable-dev-shm-usage','--use-gl=angle','--use-angle=swiftshader','--enable-unsafe-swiftshader']});
 const page = await browser.newPage({viewport:{width:1280,height:800},serviceWorkers:'block'});
 const errors=[];
 page.on('pageerror', e=>errors.push(e.message));
 await page.route('**/src/main.js*', async route=>{
  const r=await route.fetch();
  await route.fulfill({response:r,body:await r.text()+`\nwindow.testBM1={state,startWithFaction,applyDebugCommand,getFactionStanding,saveGame,loadGame,keys,heldWeaponInputs,updateStats,fleetBook,applyVesselDisablement};`});
 });
 await page.goto(`http://127.0.0.1:${server.address().port}`);
 await page.waitForFunction(()=>window.testBM1 && testBM1.state.shipCatalog && testBM1.state.planets.length > 10);
 await page.evaluate(()=>testBM1.startWithFaction('klingon',{captainName:'Debug Tester'}));
 await page.getByRole('button',{name:'Cheats & Debug',exact:true}).click();
 assert.equal(await page.locator('#cheats-debug').evaluate(e=>e.open),true);
 const ownership=await page.evaluate(()=>JSON.stringify([testBM1.state.playerFaction,testBM1.state.controlledSystems,testBM1.state.factionSystemOverrides]));
 await page.locator('[name="faction"]').selectOption('romulan');
 await page.locator('[name="standing"]').fill('50');
 await page.getByRole('button',{name:'Set standing',exact:true}).click();
 assert.equal(await page.evaluate(()=>testBM1.getFactionStanding('romulan')),50);
 await page.getByRole('button',{name:'−10',exact:true}).click();
 assert.equal(await page.evaluate(()=>testBM1.getFactionStanding('romulan')),40);
 await page.getByRole('button',{name:'Maximum',exact:true}).click();
 await page.getByRole('button',{name:'+10',exact:true}).click();
 assert.equal(await page.evaluate(()=>testBM1.getFactionStanding('romulan')),100);
 await page.getByRole('button',{name:'Minimum',exact:true}).click();
 await page.getByRole('button',{name:'−10',exact:true}).click();
 assert.equal(await page.evaluate(()=>testBM1.getFactionStanding('romulan')),-100);
 assert.equal(await page.evaluate(()=>JSON.stringify([testBM1.state.playerFaction,testBM1.state.controlledSystems,testBM1.state.factionSystemOverrides])),ownership);
 const input=page.locator('[name="code"]');
 await input.fill(''); await input.pressSequentially('standing romulan 50');
 assert.deepEqual(await page.evaluate(()=>({keys:[...testBM1.keys],held:[...testBM1.heldWeaponInputs],map:testBM1.state.mapOpen})),{keys:[],held:[],map:false});
 // Periodic HUD refresh must not erase the code or its keyboard focus.
 await page.evaluate(()=>testBM1.updateStats());
 assert.equal(await input.inputValue(),'standing romulan 50');
 assert.equal(await input.evaluate(el=>el===document.activeElement),true);
 await input.press('Enter');
 assert.equal(await page.evaluate(()=>testBM1.getFactionStanding('romulan')),50);
 await input.fill('standing madeup 70'); await input.press('Enter');
 assert.match(await page.locator('[data-debug-status]').textContent(),/Unknown faction/);
 const invalid=await page.evaluate(()=>{
  const bad=['standing romulan 101','standing romulan NaN','latinum -1','latinum Infinity','latinum 1.5','latinum','hull 0','antimatter 99999999','god maybe','ship 99999999','window.alert(1)','feat nonsense on'];
  return bad.map(code=>{try{testBM1.applyDebugCommand(code);return false;}catch{return true;}});
 });
 assert.ok(invalid.every(Boolean));
 await page.evaluate(()=>{
  testBM1.applyDebugCommand('latinum 12345');
  testBM1.applyDebugCommand('duranium 345');
  testBM1.applyDebugCommand('antimatter 0');
  testBM1.applyDebugCommand('hull 57');
  testBM1.applyDebugCommand('shields 33');
  testBM1.applyDebugCommand('feat vexBorgDown on');
 });
 assert.equal(await page.evaluate(()=>testBM1.state.godMode),false);
 await page.evaluate(()=>{
  const b=testBM1.fleetBook();b.debt=123;
  testBM1.applyDebugCommand('hull 5');
 });
 assert.equal(await page.evaluate(()=>testBM1.fleetBook().personalCondition),'disabled');
 await page.evaluate(()=>testBM1.applyDebugCommand('repair'));
 assert.equal(await page.evaluate(()=>testBM1.fleetBook().personalCondition),'operational');
 assert.equal(await page.evaluate(()=>testBM1.fleetBook().debt),123);
 const boardingBlocked=await page.evaluate(()=>{
  const b=testBM1.fleetBook();b.boarding={phase:'test'};
  const before=testBM1.state.playership;let blocked=false;
  try{testBM1.applyDebugCommand('ship 18');}catch{blocked=true;}
  b.boarding=null;return blocked&&testBM1.state.playership===before;
 });
 assert.equal(boardingBlocked,true);
 const roundtrip=await page.evaluate(()=>{
  const t=testBM1;
  const values=()=>({standing:t.getFactionStanding('romulan'),latinum:t.state.latinum,duranium:t.state.duranium,antimatter:t.state.antimatter,hull:t.state.hull,shields:t.state.shields,feat:t.state.feats.vexBorgDown});
  const before=values(); t.saveGame(3);t.applyDebugCommand('latinum 1');t.loadGame(3);
  return {before,after:values()};
 });
 assert.deepEqual(roundtrip.before,roundtrip.after);
 await page.getByRole('button',{name:'Repair hull & shields',exact:true}).click();
 await page.getByRole('button',{name:'Refill antimatter',exact:true}).click();
 assert.deepEqual(await page.evaluate(()=>[testBM1.state.hull,testBM1.state.shields,testBM1.state.antimatter===testBM1.state.fuelCap,testBM1.state.godMode]),[100,100,true,false]);
 await page.evaluate(()=>{testBM1.applyDebugCommand('god on');testBM1.applyDebugCommand('god off');});
 assert.equal(await page.evaluate(()=>testBM1.state.godMode),false);
 const chosenShip = Number(await page.locator('[name="ship"] option').first().getAttribute('value'));
 await page.evaluate(id=>testBM1.applyDebugCommand(`ship ${id}`),chosenShip);
 assert.deepEqual(await page.evaluate(()=>[testBM1.state.playership,testBM1.state.godMode]),[chosenShip,true]);
 await page.evaluate(()=>testBM1.applyDebugCommand('god off'));
 await page.keyboard.press('Escape');
 assert.equal(await page.locator('#cheats-debug').evaluate(e=>e.open),false);
 await page.getByRole('button',{name:'Cheats & Debug',exact:true}).click();
 if (process.env.BM1_TEST_OUTPUT) { fs.mkdirSync(process.env.BM1_TEST_OUTPUT,{recursive:true}); await page.screenshot({path:path.join(process.env.BM1_TEST_OUTPUT,'debug-desktop.png')}); }
 await page.setViewportSize({width:390,height:844});
 if (process.env.BM1_TEST_OUTPUT) await page.screenshot({path:path.join(process.env.BM1_TEST_OUTPUT,'debug-mobile.png')});
 assert.equal(await page.locator('#cheats-debug').evaluate(e=>e.scrollWidth<=e.clientWidth),true);
 await page.getByRole('button',{name:'Close Cheats & Debug',exact:true}).click();
 assert.equal(await page.locator('#cheats-debug').evaluate(e=>e.open),false);
 assert.deepEqual(errors,[]);
 console.log('PASS: visible menu, standing bounds, ownership isolation, keyboard isolation, retained input, validation, save/load, repair/refill, disable/recovery, boarding guard, debt preservation, God toggle, ship switch, Escape/Close, 390px layout; no page errors.');
 await browser.close();server.close();
})().catch(e=>{console.error(e);process.exit(1);});
