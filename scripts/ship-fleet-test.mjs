import assert from 'node:assert/strict';
import * as F from '../src/ship-fleet.mjs';
let count = 0;
function test(name, fn) {
  fn();
  count++;
  console.log(`PASS ${name}`);
}
const book = () => F.createFleetBook(1, 'fixture');
test('threshold has absolute floor and upper guard', () => {
  assert.equal(F.disableThreshold(160), 32);
  assert.equal(F.disableThreshold(40), 10);
  assert.equal(F.disableThreshold(1800), 180);
});
test('damage may skip disable band and kill', () => {
  assert.equal(F.classifyDamage(11, 160), 'disabled');
  assert.equal(F.classifyDamage(-8, 160), 'destroyed');
  assert.equal(F.classifyDamage(50, 160), 'operational');
});
test('zero hull and explicit empty equipment survive restore', () => {
  const a = {
    combatHull: 0,
    combatShields: 0,
    power: { energy: 0 },
    weaponSlots: [null, null, null],
    weaponInventory: [],
    destroyed: true,
  };
  const s = F.snapshotVessel(a, { hull: 160, shields: 50, weapons: [1] }, 0),
    r = {};
  F.restoreVessel(r, s);
  assert.equal(r.combatHull, 0);
  assert.equal(r.power.energy, 0);
  assert.equal(r.destroyed, true);
  assert.deepEqual(r.weaponSlots, [null, null, null]);
});
test('capture stabilization and cargo do not initialize new equipment', () => {
  const s = F.snapshotVessel(
      {
        combatHull: 11,
        condition: 'operational',
        prizeStabilized: true,
        cargoArray: [{ tons: 2 }],
        weaponSlots: [2, null, 46],
      },
      { hull: 160, shields: 0 },
      0,
    ),
    r = {};
  F.restoreVessel(r, s);
  assert.equal(r.prizeStabilized, true);
  assert.equal(r.combatHull, 11);
  assert.deepEqual(r.cargoArray, [{ tons: 2 }]);
});
test('snapshot owns its arrays', () => {
  const a = { weaponSlots: [1], power: { energy: 5 } };
  const s = F.snapshotVessel(a, { hull: 160, shields: 5 });
  a.weaponSlots[0] = 2;
  a.power.energy = 0;
  assert.equal(s.weaponSlots[0], 1);
  assert.equal(s.power.energy, 5);
});
test('long route has more calendar days', () => {
  assert.equal(F.travelDays(5), 1);
  assert.equal(F.travelDays(42), 5);
});
test('plan tiers include explicit 100', () =>
  assert.deepEqual([0, 15, 30, 50, 75, 100].map(F.planStanding), [15, 30, 50, 75, 100, 100]));
test('repair costs scale with canonical hull price', () => {
  assert.equal(F.repairQuote(1000, 10, 100).amount, 450);
  assert.equal(F.repairQuote(100000, 10, 100).amount, 45000);
});
test('split and full repairs cost same cents', () => {
  const full = F.repairQuote(78903, 11, 160).amount,
    parts = F.repairQuote(78903, 11, 160, 83).amount + F.repairQuote(78903, 83, 160).amount;
  assert.ok(Math.abs(full - parts) < 1e-8);
});
test('repair then sale has no manufactured profit', () => {
  for (const price of [1000, 79000, 1050000]) {
    const damaged = F.saleQuote(price, 10, 100),
      fixed = F.saleQuote(price, 100, 100) - F.repairQuote(price, 10, 100).amount;
    assert.ok(fixed < damaged);
  }
});
test('one book pays available funds and retains arrears once', () => {
  const b = book(),
    a = { latinum: 20 };
  assert.equal(F.recordBill(b, a, 'x', 'upkeep', 30, 2), true);
  assert.equal(a.latinum, 0);
  assert.equal(b.debt, 10);
  assert.equal(F.recordBill(b, a, 'x', 'upkeep', 30, 2), false);
  a.latinum = 7;
  assert.equal(F.payDebt(b, a, 2), 7);
  assert.equal(b.debt, 3);
});
test('stock shares canonical system/hull quantity', () => {
  const b = book(),
    a = F.ensureStock(b, 4, 347, 1, 2, ['X-Base']);
  assert.equal(F.ensureStock(b, 4, 347, 1), a);
  assert.equal(F.consumeStock(b, 4, 347), true);
  assert.equal(F.consumeStock(b, 4, 347), true);
  assert.equal(F.consumeStock(b, 4, 347), false);
  assert.equal(a.quantity, 0);
});
test('restock schedules survive reload and visit', () => {
  const b = book();
  F.ensureStock(b, 4, 347, 1);
  F.consumeStock(b, 4, 347);
  const loaded = F.copy(b);
  F.advanceStock(b, 100);
  F.advanceStock(loaded, 100);
  assert.deepEqual(loaded, b);
  const before = F.copy(b);
  F.advanceStock(b, 100);
  assert.deepEqual(b, before);
});
test('long calendar advance equals daily processing', () => {
  const a = { day: 1, latinum: 100 },
    b = book(),
    c = { ...a },
    d = book();
  F.ensureStock(b, 1, 10, 1);
  F.ensureStock(d, 1, 10, 1);
  const hooks = (b, a) => ({ settle: (day) => F.recordBill(b, a, `d${day}`, 'upkeep', 3, day) });
  const trip = F.nextId(b, 'journey');
  F.advanceCalendar(b, a, 5, trip, hooks(b, a));
  for (let i = 0; i < 5; i++) F.advanceCalendar(d, c, 1, F.nextId(d, 'journey'), hooks(d, c));
  assert.deepEqual(a, c);
  assert.deepEqual(b.stock, d.stock);
  assert.deepEqual(b.ledger, d.ledger);
  assert.equal(F.advanceCalendar(b, a, 5, trip, hooks(b, a)), false);
});
test('zero-day transit runs no economic hooks', () => {
  const b = book(),
    a = { day: 1 };
  let ran = 0;
  F.advanceCalendar(b, a, 0, F.nextId(b, 'journey'), { settle: () => ran++, complete: () => ran++, market: () => ran++ });
  assert.equal(ran, 0);
  assert.equal(a.day, 1);
});
test('formation limit does not limit fleet ownership', () => {
  const b = book(),
    a = F.addFormation(b, 'A'),
    c = F.addFormation(b, 'B');
  for (let i = 0; i < 12; i++) assert.equal(F.assignFormation(b, `v${i}`, a.id), true);
  assert.equal(F.assignFormation(b, 'v12', a.id), false);
  assert.equal(F.assignFormation(b, 'v12', c.id), true);
  assert.equal(a.members.length, 12);
  assert.equal(c.members.length, 1);
});
test('removing flagship chooses existing deputy', () => {
  const b = book(),
    g = F.addFormation(b, 'A');
  F.assignFormation(b, 'a', g.id);
  F.assignFormation(b, 'b', g.id);
  F.removeVessel(b, 'a');
  assert.equal(g.flagship, 'b');
});
test('board chance matches agreed XP/resistance extremes', () => {
  assert.equal(F.boardingChance(0, 'exceptional'), 15);
  assert.equal(F.boardingChance(100, 'exceptional'), 55);
  assert.equal(F.boardingChance(100, 'light'), 90);
});
test('boarding saves preserve roll and remaining phase', () => {
  const b = book();
  F.beginBoarding(b, { targetId: 'v1', sourceId: 'p' });
  F.stepBoarding(b, 2);
  const c = F.copy(b);
  assert.deepEqual(F.stepBoarding(b, 13), F.stepBoarding(c, 13));
  assert.deepEqual(b, c);
});
test('boarding uses incarnation not reused role ID', () => {
  const a = book(),
    b = book();
  assert.notEqual(
    F.beginBoarding(a, { targetId: 'v1', sourceId: 'p' }).roll,
    F.beginBoarding(b, { targetId: 'v2', sourceId: 'p' }).roll,
  );
});
test('deployment may cancel but committed team cannot', () => {
  const b = book();
  F.beginBoarding(b, { targetId: 'x' });
  assert.equal(F.cancelBoarding(b), true);
  assert.equal(b.team.available, true);
  F.beginBoarding(b, { targetId: 'x' });
  F.stepBoarding(b, 3);
  assert.equal(F.cancelBoarding(b), false);
});
test('third-party destruction is terminal, with no duplicate scuttle', () => {
  const b = book();
  b.team.xp = 100;
  F.beginBoarding(b, { targetId: 'x' });
  F.stepBoarding(b, 3);
  assert.equal(F.stepBoarding(b, 1, { targetAlive: false }).outcome, 'target-lost');
  assert.equal(b.team.xp, 50);
  assert.equal(F.stepBoarding(b, 99), null);
});
test('loss keeps half XP and recruitment never buys earned XP', () => {
  const b = book(),
    a = { latinum: 5000 };
  b.team.xp = 100;
  const op = F.beginBoarding(b, { targetId: 'x' });
  op.roll = 99;
  assert.equal(F.stepBoarding(b, 15).outcome, 'scuttled');
  assert.equal(b.team.xp, 50);
  assert.equal(F.recruitTeam(b, a), true);
  assert.equal(a.latinum, 3000);
  assert.equal(F.trainTeam(b, a), false);
});
test('builds pause for owner loss and deliver once', () => {
  const b = book();
  b.orders.push({ id: 'o', stationId: 's', remainingDays: 2, status: 'building' });
  let deliveries = 0;
  F.progressBuilds(
    b,
    () => 'paused',
    () => deliveries++,
  );
  assert.equal(b.orders[0].remainingDays, 2);
  F.progressBuilds(
    b,
    () => 'owned',
    () => deliveries++,
  );
  F.progressBuilds(
    b,
    () => 'owned',
    () => deliveries++,
  );
  F.progressBuilds(
    b,
    () => 'owned',
    () => deliveries++,
  );
  assert.equal(deliveries, 1);
});
test('station destruction permanently loses unfinished work', () => {
  const b = book();
  b.orders.push({ id: 'o', stationId: 's', remainingDays: 2, status: 'building' });
  let delivered = false;
  F.progressBuilds(
    b,
    () => 'destroyed',
    () => (delivered = true),
  );
  F.progressBuilds(
    b,
    () => 'owned',
    () => (delivered = true),
  );
  assert.equal(b.orders[0].status, 'lost');
  assert.equal(delivered, false);
});
test('campaign ID supports LAN crypto without randomUUID', () => {
  const id=F.createCampaignId({getRandomValues(bytes){bytes.fill(171);return bytes;}});
  assert.equal(id,'ab'.repeat(16));
});
test('restore owns last-shot cooldown translation', () => {
  const defaults={hull:100,shields:0,cooldown:5000}, actor={};
  const snap=F.snapshotVessel({combatHull:50,lastShotAt:9000},defaults,10000);
  F.restoreVessel(actor,snap,100,defaults.cooldown);
  assert.equal(actor.lastShotAt+defaults.cooldown-100,4000);
  assert.equal(F.snapshotVessel(actor,defaults,100).shotCooldownMs,4000);
});
test('cancelled deployment cannot reroll the same incarnation and XP', () => {
  const b=book(),first=F.beginBoarding(b,{targetId:'target'}); F.cancelBoarding(b);
  const second=F.beginBoarding(b,{targetId:'target'});
  assert.notEqual(first.id,second.id);assert.equal(first.roll,second.roll);
  F.cancelBoarding(b);assert.notEqual(first.roll,F.beginBoarding(b,{targetId:'replacement'}).roll);
});
test('ledger compacts 600 jumps without losing totals or replay protection', () => {
  let b=book(),a={day:1,latinum:5000};const first=F.nextId(b,'journey');
  const settle=day=>{for(let ship=0;ship<12;ship++)F.recordBill(b,a,`upkeep:${day}:v${ship}`,'upkeep',3,day);};
  F.advanceCalendar(b,a,20,first,{settle});
  for(let j=1;j<600;j++){F.advanceCalendar(b,a,20,F.nextId(b,'journey'),{settle});if(j===60)b=F.copy(b);}
  const total=(b.ledgerArchive.byKind.upkeep?.amount||0)+b.ledger.filter(e=>e.kind==='upkeep').reduce((n,e)=>n+e.amount,0);
  assert.equal(total,600*20*12*3);assert.equal(b.debt,total-5000);assert.equal(a.latinum,0);
  assert.ok(b.ledger.length<=128);assert.equal(Object.keys(b.advances).length,0);assert.ok(JSON.stringify(b).length<25000);
  assert.equal(F.advanceCalendar(b,a,20,first,{settle}),false);assert.equal(F.recordBill(b,a,'upkeep:2:v0','upkeep',3,2),false);
  const debt=b.debt;a.latinum=100;F.payDebt(b,a,a.day);assert.equal(b.debt,debt-100);
  b=F.copy(b);assert.equal(F.recordBill(b,a,`upkeep:${a.day}:v0`,'upkeep',3,a.day),false);
});
test('legacy financial migration preserves totals and journey watermark', () => {
  const b=book();delete b.financialVersion;delete b.ledgerArchive;b.counter=44;b.settledDay=200;b.debt=12;
  b.advances={'fixture:journey:7':{days:2,endDay:3}};
  b.ledger=Array.from({length:200},(_,i)=>({id:`upkeep:${i+1}:v`,day:i+1,kind:'upkeep',amount:5,paid:4}));
  F.prepareFinancialBook(b);assert.equal(b.debt,12);assert.equal(b.journeyCounter,7);
  assert.equal(b.ledgerArchive.byKind.upkeep.amount+b.ledger.reduce((n,e)=>n+e.amount,0),1000);
  assert.equal(F.advanceCalendar(b,{day:200},2,'fixture:journey:7',{}),false);
  assert.equal(F.recordBill(b,{latinum:100},'upkeep:1:v','upkeep',5,1),false);
});
test('same-day financial event cannot replay after reload', () => {
  let b=book();const a={latinum:1},id=F.nextId(b,'rescue');F.recordBill(b,a,id,'rescue',10,1);b=F.copy(b);
  assert.equal(F.recordBill(b,a,id,'rescue',10,1),false);assert.equal(b.debt,9);
});
console.log(`${count}/${count} fleet model checks passed`);
