import { receiverEW } from './ship-ew.mjs';
// Observer-scoped knowledge. This module receives physical snapshots, never game globals.
export const SENSOR_RULES = Object.freeze({
  version: 1,
  cadence: .2,
  comms: 2400,
  trackAge: .4,
  broadcastAge: 3,
  lostAge: 3,
  cueAge: 3,
  visual: 600
});
export const SENSOR_SUITES = Object.freeze([{
  id: 0,
  name: 'Native',
  price: 0,
  tier: 'open',
  passive: 1,
  active: 1,
  processing: 1,
  draw: 1
}, {
  id: 1,
  name: 'Enhanced',
  price: 8000,
  tier: 'trusted',
  passive: 1.15,
  active: 1.1,
  processing: 1.2,
  draw: 1.15
}, {
  id: 2,
  name: 'Survey',
  price: 22000,
  tier: 'respected',
  passive: 1.35,
  active: 1.25,
  processing: 1.5,
  draw: 1.4
}, {
  id: 3,
  name: 'Advanced reconnaissance',
  price: 55000,
  tier: 'strategic',
  passive: 1.55,
  active: 1.4,
  processing: 1.8,
  draw: 1.75
}, ]);
const clamp = (n, a, b) => Math.max(a, Math.min(b, n));
const num = (v, f) => typeof v === 'number' && Number.isFinite(v) ? v : f;
export const sensorDistance = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);
export function migrateSensorDistribution(raw = {}) {
  const keys = ['engines', 'weapons', 'shields', 'sensors'];
  const old = !Number.isFinite(raw?.sensors);
  const d = Object.fromEntries(keys.map(k => [k, clamp(Math.round(num(raw?.[k], 5)), 0, 10)]));
  const ks = old ? keys.slice(0, 3) : keys,
    budget = old ? 15 : 20,
    total = ks.reduce((n, k) => n + d[k], 0);
  if (total > budget) {
    const scaled = ks.map((k, i) => ({
      k,
      i,
      v: d[k] * budget / total
    }));
    for (const x of scaled) d[x.k] = Math.floor(x.v);
    let left = budget - ks.reduce((n, k) => n + d[k], 0);
    for (const x of scaled.sort((a, b) => (b.v % 1 - a.v % 1) || a.i - b.i))
      if (left-- > 0) d[x.k]++;
  }
  return d;
}
export function sensorProfile(stats = {}, suiteId = 0) {
  const a = stats.sensorProfile || {},
    u = SENSOR_SUITES[suiteId] || SENSOR_SUITES[0];
  return {
    passive: 1200 * clamp(num(a.sensitivity, 1), .5, 2) * u.passive,
    active: 1800 * clamp(num(a.aperture, 1), .5, 2) * u.active,
    processing: clamp(num(a.processing, 1), .5, 2) * u.processing,
    draw: clamp(num(a.efficiency, 1), .5, 2) * u.draw,
    signature: clamp(num(a.signature, 1), .35, 2)
  };
}
export function ensureSensorEquipment(raw = {}, defaults = {}) {
  const d = raw && typeof raw === 'object' ? raw : {};
  return {
    version: 1,
    suite: clamp(Math.floor(num(d.suite, 0)), 0, 3),
    transponder: typeof d.transponder === 'boolean' ? d.transponder : defaults.on !== false,
    declaration: typeof d.declaration === 'string' && d.declaration.trim() ? d.declaration.trim() : String(defaults
      .declaration || 'neutral'),
    commandDefault: typeof d.commandDefault === 'boolean' ? d.commandDefault : !!defaults.commandDefault,
    mode: ['sweep', 'focus'].includes(d.mode) ? d.mode : 'passive',
    target: typeof d.target === 'string' ? d.target : null,
    progress: clamp(num(d.progress, 0), 0, 8),
    untracked: clamp(num(d.untracked, 0), 0, 5),
    funded: 0,
    emitting: false
  };
}
export function fundSensors(power, equipment, profile, seconds, cloaked = false) {
  const dt = clamp(num(seconds, 0), 0, 1),
    points = migrateSensorDistribution(power.dist).sensors;
  const active = equipment.mode !== 'passive' && !cloaked;
  const demand = points > 0 ? profile.draw * points / 5 * (active ? 4 : 1) * dt : 0;
  const paid = Math.min(Math.max(0, power.energy), demand);
  power.energy -= paid;
  equipment.funded = demand > 0 ? paid / demand : 0;
  equipment.emitting = active && equipment.funded >= 1 - 1e-9 && points > 0;
  const draw = dt ? paid / dt : 0;
  power.telemetry = {
    ...power.telemetry,
    sensors: draw,
    consumption: (power.telemetry?.consumption || 0) + draw,
    net: (power.telemetry?.net || 0) - draw
  };
  return {
    paid,
    active: equipment.emitting,
    rate: points / 5 * equipment.funded * profile.processing
  };
}
export function defaultTransponder({
  faction = 'neutral',
  side = faction,
  role = 'traffic',
  broadcastSource,
  broadcastFaction,
  command = false,
  flag = 'neutral'
} = {}) {
  if (broadcastSource === 'none') return {
    on: false,
    declaration: broadcastFaction || faction,
    commandDefault: false
  };
  if (broadcastSource === 'declared' && broadcastFaction) return {
    on: true,
    declaration: broadcastFaction,
    commandDefault: false
  };
  if (command) return {
    on: true,
    declaration: flag,
    commandDefault: true
  };
  return {
    on: !(faction === 'pirate' || ['smuggler', 'covert'].includes(role)),
    declaration: side && !side.startsWith('ship:') && !side.startsWith('private:') ? side : faction,
    commandDefault: false
  };
}
export function visualReach(width = 960, height = 540, radius = 0) {
  return Math.max(600, Math.hypot(width / 2, height / 2) + Math.max(0, radius));
}
export function freshTrack(c, now) {
  return !!c?.position && now - c.observedAt <= .400001 && c.valid !== false;
}
export function receivedDeclaration(c, now) {
  return c?.declaration && now - c.declaredAt <= 3.000001 ? c.declaration : null;
}

function record(map, key) {
  let c = map.get(key);
  if (!c) {
    c = {
      key,
      observedAt: -1e9,
      declaredAt: -1e9,
      acquire: 0,
      valid: false
    };
    map.set(key, c);
  }
  return c;
}
// Spatial buckets avoid quadratic detection against far-away objects; sharing never relays.
export class SensorWorld {
  constructor() {
    this.contacts = new Map();
    this.observerSides = new Map();
    this.now = 0;
    this.system = null;
    this.metrics = {};
  }
  map(key) {
    if (!this.contacts.has(key)) this.contacts.set(key, new Map());
    return this.contacts.get(key);
  }
  contact(observer, target) {
    return this.contacts.get(observer)?.get(target) || null;
  }
  clear(system) {
    this.contacts.clear();
    this.observerSides.clear();
    this.system = system;
  }
  observe(o, t, now, source = 'visual') {
    const c = record(this.map(o.key), t.key);
    c.position ||= {
      x: 0,
      y: 0
    };
    c.position.x = t.x;
    c.position.y = t.y;
    c.observedAt = now;
    c.valid = true;
    c.source = source;
    c.sourceObserver = o.key;
    return c;
  }
  pass(actors, now, dt = .2) {
    this.now = now;
    let pairs = 0;
    const cell = 2400,
      buckets = new Map();
    for (const a of actors) {
      const k = `${Math.floor(a.x/cell)},${Math.floor(a.y/cell)}`;
      if (!buckets.has(k)) buckets.set(k, []);
      buckets.get(k).push(a);
    }
    const maxSignature = Math.max(1, ...actors.map(a => a.signature)),
      maxRadius = Math.max(0, ...actors.map(a => a.radius || 0)),
      maxEmission = Math.max(0, ...actors.filter(a => a.emitting).map(a => a.active * 2));
    const direct = new Map(),
      directCues = new Map();
    const byKey = new Map(actors.map(a => [a.key, a]));
    const jammers=actors.filter(a=>a.jammerStrength>0).sort((a,b)=>a.key.localeCompare(b.key));
    const jamBuckets=new Map(), maxJamRadius=Math.max(0,...jammers.map(a=>a.jammerRadius));
    const jamEmissionReach=Math.max(0,...actors.filter(a=>a.jammerEmitting).map(a=>a.jammerRadius*2));
    for(const j of jammers){const k=`${Math.floor(j.x/cell)},${Math.floor(j.y/cell)}`;if(!jamBuckets.has(k))jamBuckets.set(k,[]);jamBuckets.get(k).push(j);}
    let jammerPairs=0;
    for (const o of actors) {
      if (this.observerSides.has(o.key) && this.observerSides.get(o.key) !== o.side) this.contacts.delete(o.key);
      this.observerSides.set(o.key, o.side);
      const nearby=[];
      if(jammers.length)for(let x=Math.floor((o.x-maxJamRadius)/cell);x<=Math.floor((o.x+maxJamRadius)/cell);x++)
        for(let y=Math.floor((o.y-maxJamRadius)/cell);y<=Math.floor((o.y+maxJamRadius)/cell);y++)nearby.push(...(jamBuckets.get(`${x},${y}`)||[]));
      nearby.sort((a,b)=>a.key.localeCompare(b.key));jammerPairs+=nearby.length;
      o.ewReception=receiverEW(o,nearby);
      const quality=o.ewReception.quality, rf=Math.sqrt(quality);
      const map = this.map(o.key);
      if (!o.observer) continue;
      const found = new Set(), eligible = new Set(), jamEligible = new Set();
      const range = Math.max(o.visual + maxRadius, o.passive * maxSignature, o.active, o.coverage || 0, 2400,
        maxEmission * (o.passive / 1200), jamEmissionReach*(o.passive/1200));
      const x0 = Math.floor((o.x - range) / cell),
        x1 = Math.floor((o.x + range) / cell),
        y0 = Math.floor((o.y - range) / cell),
        y1 = Math.floor((o.y + range) / cell);
      for (let x = x0; x <= x1; x++)
        for (let y = y0; y <= y1; y++)
          for (const t of buckets.get(`${x},${y}`) || []) {
            if (o.key === t.key) continue;
            pairs++;
            const dist = sensorDistance(o, t),
              c = record(map, t.key);
            if (t.broadcast && !t.cloaked && dist <= 2400) {
              if (now - (c.declaredAt ?? -1e9) >= .999999) {
                c.declaration = t.declaration;
                c.declaredAt = now;
              }
            }
            if (t.cloaked) {
              c.acquire = 0;
              continue;
            }
            const visual = dist <= o.visual + (t.radius || 0),
              coverage = o.coverage > 0 && dist <= o.coverage;
            const passive = o.passive > 0 && dist <= o.passive * t.signature * rf;
            const active = o.emitting && dist <= o.active * rf;
            const emission = t.emitting && o.passive > 0 && dist <= t.active * 2 * (o.passive / 1200) * rf;
            const jamEmission=t.jammerEmitting&&o.passive>0&&dist<=t.jammerRadius*2*(o.passive/1200);
            if(jamEmission){jamEligible.add(t.key);c.jamAcquire=(c.jamAcquire||0)+dt;}
            if (visual || coverage || passive || active || emission || jamEmission) {
              eligible.add(t.key); c.acquire += dt;
              if (visual || coverage || active || (jamEmission && c.jamAcquire>=.999999) || ((passive||emission) && quality>0 && c.acquire >= 1/quality)) {
                this.observe(o, t, now, visual ? 'visual' : coverage ? 'checkpoint' : active ? 'active' : jamEmission?'jammer':'passive');
                if(jamEmission&&c.jamAcquire>=.999999)c.jammerAt=now;
                found.add(t.key);
              }
            } else c.acquire = 0;
          }
      for (const [key, c] of map) {
        if (!found.has(key) && c.sourceObserver === o.key) {
          c.valid = false;
          if(!eligible.has(key))c.acquire = 0;
        }
      }
      directCues.set(o.key, [...map.values()].filter(c => c.cue && c.cue.victimKey === o.key && c.cue.expiresAt >=
        now).map(c => ({
        ...c.cue
      })));
      for(const [key,c] of map)if(!jamEligible.has(key))c.jamAcquire=0;
      const local = new Map();
      for (const key of found) local.set(key, map.get(key));
      direct.set(o.key, local);
    }
    for (const o of actors) {
      if (!o.observer) continue;
      const map = this.map(o.key);
      const peers = actors.filter(source => source.observer && source.key !== o.key &&
        source.side === o.side && sensorDistance(o, source) <= 2400);
      for (const source of peers) {
        for (const cue of directCues.get(source.key) || []) {
          if (cue.sourceKey === o.key) continue;
          const c = record(map, cue.sourceKey);
          if (!c.cue || cue.impactAt > c.cue.impactAt) c.cue = {
            ...cue
          };
        }
      }
      // Local observations already have this pass's newest position. For each missing
      // target, the first direct peer report suffices; shared reports never relay.
      const ownReports = direct.get(o.key);
      for (const target of actors) {
        if (target.key === o.key || ownReports.has(target.key)) continue;
        for (const source of peers) {
          const report = direct.get(source.key)?.get(target.key);
          if (!report) continue;
          const c = record(map, target.key);
          c.position ||= {
            x: 0,
            y: 0
          };
          c.position.x = report.position.x;
          c.position.y = report.position.y;
          c.observedAt = report.observedAt;
          c.valid = true;
          c.jammerAt = report.jammerAt;
          c.source = 'shared';
          c.sourceObserver = source.key;
          break;
        }
      }
      for (const [key, c] of map) {
        if (c.source === 'shared') {
          const source = byKey.get(c.sourceObserver);
          if (!source || source.side !== o.side || sensorDistance(o, source) > 2400 || !direct.get(source.key)?.has(
              key)) c.valid = false;
        }
        if (!c.acquire && now - c.observedAt > 300 && !c.report && !receivedDeclaration(c, now) && (!c.cue || c.cue
            .expiresAt < now)) map.delete(key);
      }
    }
    this.metrics = {
      observers: actors.filter(a => a.observer).length,
      actors: actors.length,
      pairs, jammerPairs
    };
    return this.metrics;
  }
  hit(victim, attack, now) {
    if (!attack || attack.system !== this.system) return;
    const c = record(this.map(victim), attack.key);
    if (attack.eventId && c.lastHitEvent === attack.eventId) return;
    c.lastHitEvent = attack.eventId;
    c.cue = {
      victimKey: victim,
      x: attack.x,
      y: attack.y,
      sourceKey: attack.key,
      sourceSide: attack.side,
      launchedAt: attack.time,
      impactAt: now,
      expiresAt: now + 3,
      system: attack.system
    };
  }
  snapshot(observer, now) {
    return [...this.map(observer)].map(([key, c]) => ({
      key,
      position: c.position ? {
        ...c.position
      } : null,
      age: Math.max(0, now - c.observedAt),
      declaration: c.declaration || null,
      declarationAge: Math.max(0, now - c.declaredAt),
      report: c.report ? {
        ...c.report,
        assessedAge: Math.max(0, now - (c.report.assessedAt || 0)),
        assessedAt: undefined
      } : null
    }));
  }
  restore(observer, records, now) {
    const map = this.map(observer);
    for (const r of Array.isArray(records) ? records : []) {
      if (typeof r.key !== 'string') continue;
      const c = record(map, r.key);
      Object.assign(c, {
        position: r.position && Number.isFinite(r.position.x) && Number.isFinite(r.position.y) ? {
          ...r.position
        } : null,
        observedAt: now - Math.max(.401, num(r.age, 1e9)),
        declaration: typeof r.declaration === 'string' ? r.declaration : null,
        declaredAt: now - Math.max(3.001, num(r.declarationAge, 1e9)),
        report: r.report && typeof r.report === 'object' ? {
          ...r.report,
          assessedAt: now - Math.max(0, num(r.report.assessedAge, 0))
        } : null,
        valid: false
      });
    }
  }
}
// Segment/circle entry, rather than endpoint overlap (fast ballistic shots cannot tunnel).
export function pointImpact(from, to, targets, excludeKey = null) {
  const dx = to.x - from.x,
    dy = to.y - from.y,
    a = dx * dx + dy * dy;
  if (!a) return null;
  let best = null;
  for (const t of targets) {
    if(excludeKey!==null&&t.key===excludeKey||t.entity?.destroyed)continue;
    const fx = from.x - t.x,
      fy = from.y - t.y,
      b = 2 * (fx * dx + fy * dy),
      c = fx * fx + fy * fy - t.radius * t.radius,
      disc = b * b - 4 * a * c;
    if (disc < 0) continue;
    const q = (-b - Math.sqrt(disc)) / (2 * a),
      u = c <= 0 ? 0 : q;
    if (u < 0 || u > 1 || best && u >= best.u) continue;
    best = {
      target: t,
      u,
      x: from.x + u * dx,
      y: from.y + u * dy
    };
  }
  return best;
}
