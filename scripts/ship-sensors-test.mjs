import assert from 'node:assert/strict';
import {
  SENSOR_SUITES,
  SensorWorld,
  migrateSensorDistribution,
  sensorProfile,
  ensureSensorEquipment,
  defaultTransponder,
  fundSensors,
  visualReach,
  freshTrack,
  receivedDeclaration,
  pointImpact
} from '../src/ship-sensors.mjs';
let count = 0;
const check = (n, f) => {
  f();
  count++;
  console.log('PASS ' + n);
};
const actor = (key, over = {}) => ({
  key,
  side: key,
  x: 0,
  y: 0,
  observer: true,
  visual: 600,
  passive: 1200,
  active: 1800,
  signature: 1,
  broadcast: true,
  declaration: key,
  ...over
});
const pair = (a, b) => {
  const w = new SensorWorld();
  w.clear(0);
  return {
    w,
    a: actor('a', a),
    b: actor('b', {
      x: 1000,
      ...b
    })
  };
};
check('old reserve 0/5/10 always migrates to five sensor points', () => {
  for (const reserve of [0, 5, 10]) assert.deepEqual(migrateSensorDistribution({
    engines: 5,
    weapons: 5,
    shields: 5,
    reserve
  }), {
    engines: 5,
    weapons: 5,
    shields: 5,
    sensors: 5
  });
});
check('largest remainder allocation is deterministic', () => assert.deepEqual(migrateSensorDistribution({
  engines: 10,
  weapons: 10,
  shields: 0
}), {
  engines: 8,
  weapons: 7,
  shields: 0,
  sensors: 5
}));
check('new zero sensors survives and malformed totals stay bounded', () => {
  assert.equal(migrateSensorDistribution({
    sensors: 0
  }).sensors, 0);
  assert.equal(Object.values(migrateSensorDistribution({
    sensors: 10,
    engines: 10,
    weapons: 10,
    shields: 10
  })).reduce((a, b) => a + b), 20);
});
check('upgrades multiply native science hardware and use economy tiers', () => {
  const a = sensorProfile({
      sensorProfile: {
        sensitivity: 1.2
      }
    }, 3),
    b = sensorProfile({}, 3);
  assert(a.passive > b.passive);
  assert.deepEqual(SENSOR_SUITES.slice(1).map(x => x.tier), ['trusted', 'respected', 'strategic']);
});
check('ordinary roles broadcast, pirate/covert default dark, authored overrides win', () => {
  for (const role of ['traffic', 'patrol', 'fleetAttack', 'occupationFleet']) assert(defaultTransponder({
    role,
    faction: 'terran'
  }).on);
  assert(!defaultTransponder({
    faction: 'pirate'
  }).on);
  assert(!defaultTransponder({
    role: 'smuggler'
  }).on);
  assert(defaultTransponder({
    faction: 'pirate',
    broadcastSource: 'declared',
    broadcastFaction: 'terran'
  }).on);
});
check('commanded captured pirate gets command identity, custom polity stays exact', () => {
  assert.equal(defaultTransponder({
    command: true,
    faction: 'pirate',
    flag: 'vulcan'
  }).declaration, 'vulcan');
  assert.equal(defaultTransponder({
    side: 'Zzyx-Council'
  }).declaration, 'Zzyx-Council');
});
check('passive detection acquires after one second without emission', () => {
  const {
    w,
    a,
    b
  } = pair();
  for (let i = 1; i <= 5; i++) w.pass([a, b], i * .2);
  assert(freshTrack(w.contact('a', 'b'), 1));
  assert(!a.emitting);
});
check('quiet contact evades passive at same distance', () => {
  const {
    w,
    a,
    b
  } = pair({}, {
    signature: .35,
    broadcast: false
  });
  for (let i = 1; i <= 6; i++) w.pass([a, b], i * .2);
  assert(!freshTrack(w.contact('a', 'b'), 1.2));
});
check('transponder heard at zero sensors gives identity not a track', () => {
  const {
    w,
    a,
    b
  } = pair({
    passive: 0
  }, {
    x: 2300
  });
  w.pass([a, b], 0);
  assert.equal(receivedDeclaration(w.contact('a', 'b'), 0), 'b');
  assert(!freshTrack(w.contact('a', 'b'), 0));
  b.broadcast = false;
  w.pass([a, b], 3.2);
  assert.equal(receivedDeclaration(w.contact('a', 'b'), 3.2), null);
});
check('viewport floor includes corners and sprite edges, not just 250 units', () => {
  assert(visualReach(960, 540) >= 600);
  assert(visualReach(1280, 850, 50) >= Math.hypot(640, 425) + 50);
});
check('visual track works with zero sensors and no broadcast', () => {
  const {
    w,
    a,
    b
  } = pair({
    passive: 0
  }, {
    x: 400,
    broadcast: false
  });
  w.pass([a, b], 0);
  assert(freshTrack(w.contact('a', 'b'), 0));
  assert(!receivedDeclaration(w.contact('a', 'b'), 0));
});
check('active sweep discovers selected-nothing and emits beyond passive range', () => {
  const {
    w,
    a,
    b
  } = pair({
    emitting: true
  }, {
    x: 1700,
    broadcast: false
  });
  w.pass([a, b], 0);
  assert(freshTrack(w.contact('a', 'b'), 0));
  for (let i = 1; i <= 5; i++) w.pass([a, b], i * .2);
  assert(freshTrack(w.contact('b', 'a'), 1));
});
check('cloak blocks visual, ordinary active, broadcasts and checkpoint array', () => {
  const {
    w,
    a,
    b
  } = pair({
    emitting: true,
    coverage: 2000
  }, {
    x: 100,
    cloaked: true
  });
  w.pass([a, b], 0);
  assert(!freshTrack(w.contact('a', 'b'), 0));
  assert(!receivedDeclaration(w.contact('a', 'b'), 0));
});
check('all sides share directly but allied/spoofed different sides do not', () => {
  const w = new SensorWorld(),
    issuer = actor('i', {
      side: 'vulcan',
      coverage: 1900
    }),
    patrol = actor('p', {
      x: -1000,
      side: 'vulcan',
      passive: 0
    }),
    t = actor('t', {
      x: 1800,
      broadcast: false
    }),
    foreign = actor('f', {
      x: -1000,
      side: 'terran',
      declaration: 'vulcan',
      passive: 0
    });
  w.pass([issuer, patrol, t, foreign], 0);
  assert(freshTrack(w.contact('p', 't'), 0));
  assert(!freshTrack(w.contact('f', 't'), 0));
});
check('one missed pass age 0.4 accepted, two missed age 0.6 rejected', () => {
  assert(freshTrack({
    position: {
      x: 0,
      y: 0
    },
    observedAt: 0
  }, .4));
  assert(!freshTrack({
    position: {
      x: 0,
      y: 0
    },
    observedAt: 0
  }, .6));
});
check('source loss invalidates shared track, retains frozen last position', () => {
  const w = new SensorWorld(),
    a = actor('a', {
      side: 'team'
    }),
    p = actor('p', {
      side: 'team',
      x: -1000,
      passive: 0
    }),
    t = actor('t', {
      x: 500,
      broadcast: false
    });
  w.pass([a, p, t], 0);
  const c = w.contact('p', 't');
  assert(freshTrack(c, 0));
  t.x = 5000;
  w.pass([a, p, t], .2);
  assert(!freshTrack(c, .2));
  assert.equal(c.position.x, 500);
});
check('power is paid, shortage pauses active emissions and zero remains zero', () => {
  const e = ensureSensorEquipment({
      mode: 'sweep'
    }),
    p = {
      energy: 0,
      dist: {
        engines: 5,
        weapons: 5,
        shields: 5,
        sensors: 5
      }
    };
  const r = fundSensors(p, e, sensorProfile(), 1);
  assert.equal(r.paid, 0);
  assert(!e.emitting);
  p.energy = 10;
  fundSensors(p, e, sensorProfile(), 1);
  assert.equal(p.energy, 6);
  assert(e.emitting);
});
check('restored intelligence is stale, not free track/broadcast refresh', () => {
  const {
    w,
    a,
    b
  } = pair();
  w.pass([a, b], 0);
  const data = w.snapshot('a', 1);
  const r = new SensorWorld();
  r.restore('a', data, 0);
  assert(!freshTrack(r.contact('a', 'b'), 0));
  assert(!receivedDeclaration(r.contact('a', 'b'), 0));
});
check('hit cue uses launch origin, expires and cannot cross systems', () => {
  const w = new SensorWorld();
  w.clear(4);
  const attack = {
    key: 's',
    system: 4,
    x: 1000,
    y: 0,
    time: 0
  };
  w.hit('v', attack, 5);
  attack.x = 9000;
  assert.equal(w.contact('v', 's').cue.x, 1000);
  assert.equal(w.contact('v', 's').cue.expiresAt, 8);
  assert(!freshTrack(w.contact('v', 's'), 5));
  w.hit('v', {
    ...attack,
    key: 'other',
    system: 5
  }, 5);
  assert(!w.contact('v', 'other'));
});
check('point beam/projectile collision selects nearest physical body and misses empty space', () => {
  const from = {
      x: 0,
      y: 0
    },
    to = {
      x: 1000,
      y: 0
    };
  const a = {
      x: 400,
      y: 0,
      radius: 20,
      id: 'near'
    },
    b = {
      x: 900,
      y: 0,
      radius: 20,
      id: 'far'
    };
  assert.equal(pointImpact(from, to, [b, a]).target.id, 'near');
  assert(!pointImpact(from, to, [{
    ...a,
    y: 100
  }]));
});
check('unidentified passive acquisition survives multiple passes without a radio report', () => {
  const {
    w,
    a,
    b
  } = pair({
    passive: 3500
  }, {
    x: 3000,
    broadcast: false
  });
  for (let i = 1; i <= 5; i++) w.pass([a, b], i * .2);
  assert(freshTrack(w.contact('a', 'b'), 1));
});
check('first same-side peer in actor order donates the shared report', () => {
  const w = new SensorWorld(),
    t = actor('t', {
      x: 400,
      broadcast: false
    }),
    a = actor('a', {
      side: 'team'
    }),
    b = actor('b', {
      side: 'team',
      x: 80
    }),
    p = actor('p', {
      side: 'team',
      x: -1000,
      passive: 0,
      visual: 0
    });
  w.pass([a, b, t, p], 0);
  assert.equal(w.contact('p', 't').source, 'shared');
  assert.equal(w.contact('p', 't').sourceObserver, 'a');
  w.pass([b, a, t, p], .2);
  assert.equal(w.contact('p', 't').sourceObserver, 'b');
});
check('comms declaration is heard at 2400 and not beyond', () => {
  const w = new SensorWorld(),
    a = actor('a', {
      passive: 0,
      visual: 0,
      active: 0
    }),
    edge = actor('edge', {
      x: 2400,
      broadcast: true,
      declaration: 'edge'
    }),
    beyond = actor('beyond', {
      x: 2401,
      broadcast: true,
      declaration: 'beyond'
    });
  w.pass([a, edge, beyond], 0);
  assert.equal(receivedDeclaration(w.contact('a', 'edge'), 0), 'edge');
  assert.equal(receivedDeclaration(w.contact('a', 'beyond'), 0), null);
});
check('shared hit origins keep their original expiry and cannot relay', () => {
  const w = new SensorWorld();
  w.clear(0);
  const a = actor('a', {
      side: 'team',
      passive: 0
    }),
    b = actor('b', {
      side: 'team',
      x: 2000,
      passive: 0
    }),
    c = actor('c', {
      side: 'team',
      x: 4000,
      passive: 0
    });
  w.hit('a', {
    key: 'dark',
    side: 'enemy',
    system: 0,
    x: 8000,
    y: 0,
    time: 0
  }, 1);
  w.pass([a, b, c], 1.2);
  assert.equal(w.contact('b', 'dark').cue.expiresAt, 4);
  assert(!freshTrack(w.contact('b', 'dark'), 1.2));
  assert(!w.contact('c', 'dark')?.cue);
  w.pass([a, b, c], 2);
  assert.equal(w.contact('b', 'dark').cue.expiresAt, 4);
});
check('a captured observer cannot inherit the previous side’s private reports', () => {
  const w = new SensorWorld(),
    a = actor('a'),
    b = actor('b', {
      x: 500
    });
  w.pass([a, b], 0);
  w.contact('a', 'b').report = {
    hull: 'Private assessment'
  };
  a.side = 'captor';
  w.pass([a, b], .2);
  assert(!w.contact('a', 'b').report);
});
check('one damage event cannot refresh an origin cue every effect tick', () => {
  const w = new SensorWorld();
  w.clear(0);
  const attack = {
    key: 'source',
    eventId: 'launch-1',
    system: 0,
    x: 1000,
    y: 0,
    time: 0
  };
  w.hit('victim', attack, 1);
  w.hit('victim', attack, 4);
  assert.equal(w.contact('victim', 'source').cue.expiresAt, 4);
  w.hit('victim', {
    ...attack,
    eventId: 'launch-2',
    time: 4
  }, 4);
  assert.equal(w.contact('victim', 'source').cue.expiresAt, 7);
});
console.log(`${count}/${count} sensor model checks passed`);
