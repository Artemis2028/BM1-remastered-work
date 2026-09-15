// Persistent fleet/boarding rules. Runtime actors are adapters, never inventory authorities.
// Numerical values here are first-playtest tuning from proposal v0.7, not recovered Flash rules.
export const FLEET_RULES = Object.freeze({
  version: 1,
  formationSize: 12,
  disableFraction: 0.1,
  disableFloor: 32,
  disableCeiling: 0.25,
  boardingRange: 250,
  deploymentSeconds: 3,
  boardingSeconds: 12,
  recruitCost: 2000,
  trainingCost: 1000,
  trainingXP: 5,
  repairBasis: 0.5,
  resaleBasis: 0.35,
  routeUnitsPerDay: 10,
});
// randomUUID is secure-context-only; getRandomValues also works over LAN HTTP.
export function createCampaignId(cryptoApi = globalThis.crypto) {
  if (typeof cryptoApi?.randomUUID === 'function') return cryptoApi.randomUUID();
  return Array.from(cryptoApi.getRandomValues(new Uint8Array(16)), byte => byte.toString(16).padStart(2, '0')).join('');
}
export const copy = (value) => (value === undefined ? undefined : JSON.parse(JSON.stringify(value)));
export const bounded = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
export function stableHash(value) {
  let h = 2166136261;
  for (const c of String(value)) h = Math.imul(h ^ c.charCodeAt(0), 16777619);
  return h >>> 0;
}
export function disableThreshold(max) {
  return Math.min(
    max * FLEET_RULES.disableCeiling,
    Math.max(max * FLEET_RULES.disableFraction, FLEET_RULES.disableFloor),
  );
}
export function classifyDamage(hull, max) {
  return hull <= 0 ? 'destroyed' : hull <= disableThreshold(max) ? 'disabled' : 'operational';
}
export function boardingChance(xp, resistance = 'standard') {
  return bounded(
    40 +
      0.4 * bounded(xp, 0, 100) +
      ({ light: 10, standard: 0, hardened: -15, exceptional: -25 }[resistance] ?? 0),
    5,
    90,
  );
}
export function planStanding(required = 0) {
  return [15, 30, 50, 75, 100].find((t) => t > required) ?? 100;
}
export function travelDays(distance) {
  return Math.max(1, Math.ceil(Math.max(0, Number(distance) || 0) / FLEET_RULES.routeUnitsPerDay));
}
const PHYSICAL_FIELDS = [
  'condition',
  'prizeStabilized',
  'damageSeed',
  'weaponSlots',
  'weaponInventory',
  'cargoArray',
  'equipment',
  'sensorInventory',
  'jammerInventory',
  'antimatter',
  'fuelCap',
  'power',
  'crewSkill',
  'crewTemperament',
  'sensors',
  'ew',
  'physicalId',
  'securityInstanceId',
  'weaponCooldowns',
];
export function snapshotVessel(actor, defaults, now = 0) {
  const maxHull =
    Number.isFinite(actor.maxCombatHull) && actor.maxCombatHull > 0 ? actor.maxCombatHull : defaults.hull;
  const maxShields =
    Number.isFinite(actor.maxCombatShields) && actor.maxCombatShields >= 0
      ? actor.maxCombatShields
      : defaults.shields;
  const result = {
    version: 1,
    maxHull,
    maxShields,
    hull: Number.isFinite(actor.combatHull) ? bounded(actor.combatHull, 0, maxHull) : maxHull,
    shields: Number.isFinite(actor.combatShields) ? bounded(actor.combatShields, 0, maxShields) : maxShields,
    shotCooldownMs: Math.max(0, (actor.lastShotAt || 0) + (defaults.cooldown || 0) - now),
    readyMs: Math.max(0, (actor.weaponReadyAt || 0) - now),
    recoveryMs: actor.recoveryAt ? Math.max(1, actor.recoveryAt - now) : 0,
  };
  for (const key of PHYSICAL_FIELDS) if (actor[key] !== undefined) result[key] = copy(actor[key]);
  result.condition = actor.destroyed || result.hull === 0 ? 'destroyed' : actor.condition || 'operational';
  // Explicit empty arrays and zero energy are valid new-format state.
  if (!Array.isArray(result.weaponSlots)) result.weaponSlots = copy(defaults.weapons || [null, null, null]);
  if (!Array.isArray(result.weaponInventory)) result.weaponInventory = result.weaponSlots.filter(Boolean);
  if (!Array.isArray(result.cargoArray)) result.cargoArray = [];
  return result;
}
export function restoreVessel(actor, snapshot, now = 0, cooldown = 0) {
  if (!snapshot || snapshot.version !== 1) return false;
  Object.assign(actor, {
    maxCombatHull: snapshot.maxHull,
    combatHull: snapshot.hull,
    maxCombatShields: snapshot.maxShields,
    combatShields: snapshot.shields,
    weaponReadyAt: now + Math.max(0, snapshot.readyMs || 0),
    recoveryAt: snapshot.recoveryMs ? now + snapshot.recoveryMs : 0,
    lastShotAt: now + Math.max(0, snapshot.shotCooldownMs || 0) - cooldown,
    destroyed: snapshot.condition === 'destroyed' || snapshot.hull === 0,
  });
  for (const key of PHYSICAL_FIELDS) if (snapshot[key] !== undefined) actor[key] = copy(snapshot[key]);
  return true;
}
// Shared player/NPC quotation in canonical hull units; cumulative cent pricing prevents split-repair discounts.
export function repairQuote(price, hull, maxHull, desired = maxHull) {
  if (
    !Number.isFinite(price) ||
    price < 0 ||
    !Number.isFinite(hull) ||
    !Number.isFinite(maxHull) ||
    maxHull <= 0 ||
    !Number.isFinite(desired)
  )
    throw Error('Invalid repair pools');
  const from = bounded(hull / maxHull, 0, 1),
    to = bounded(desired / maxHull, from, 1);
  const basis = Math.max(0, price) * FLEET_RULES.repairBasis;
  return {
    hull: to * maxHull,
    amount: Math.max(0, Math.round(to * basis * 100) - Math.round(from * basis * 100)) / 100,
  };
}
export function saleQuote(price, hull, maxHull) {
  return Math.floor(Math.max(0, price) * FLEET_RULES.resaleBasis * bounded(hull / maxHull, 0, 1));
}
export function createFleetBook(day = 1, campaignId = 'campaign') {
  return {
    version: 1,
    campaignId,
    counter: 0,
    settledDay: day,
    advances: {}, // only pre-migration nonstandard IDs
    journeyCounter: 0,
    financialCounter: 0,
    financialVersion: 2,
    ledgerClosedThrough: day - 1,
    ledgerArchive: { entries: 0, byKind: {} },
    ledger: [],
    debt: 0,
    stock: {},
    shipPlans: [],
    orders: [],
    formations: [],
    team: { available: true, xp: 0, retainedXP: 0 },
    boarding: null,
    visit: null,
    personalId: `${campaignId}:personal`,
    personalCondition: 'operational',
  };
}
export function nextId(book, type) {
  return `${book.campaignId}:${type}:${++book.counter}`;
}
// Retain 128 recent entries plus all open-day items. Closed-day replay is
// blocked by a saved watermark; current/recent IDs use a Set rebuilt once/load.
const financialIndexes = new WeakMap();
const RECENT_LEDGER_ITEMS = 128;
function eventSequence(book, id, types) {
  const prefix = `${book.campaignId}:`;
  if (typeof id !== 'string' || !id.startsWith(prefix)) return 0;
  const tail = id.slice(prefix.length), split = tail.lastIndexOf(':');
  if (!types.includes(tail.slice(0, split))) return 0;
  const n = Number(tail.slice(split + 1));
  return Number.isSafeInteger(n) && n > 0 ? n : 0;
}
export function prepareFinancialBook(book) {
  if (book.financialVersion === 2) return book;
  book.ledger ||= []; book.advances ||= {};
  book.journeyCounter = 0; book.financialCounter = 0;
  book.ledgerClosedThrough = (book.settledDay || 1) - 1;
  book.ledgerArchive = { entries: 0, byKind: {} };
  for (const id of Object.keys(book.advances)) {
    const seq = eventSequence(book, id, ['journey', 'legacy-journey']);
    if (seq) { book.journeyCounter = Math.max(book.journeyCounter, seq); delete book.advances[id]; }
  }
  for (const entry of book.ledger)
    book.financialCounter = Math.max(book.financialCounter, eventSequence(book, entry.id, ['rescue', 'payment']));
  book.counter = Math.max(book.counter || 0, book.journeyCounter, book.financialCounter);
  book.financialVersion = 2;
  compactFinancialBook(book);
  return book;
}
function financialIndex(book) {
  let index = financialIndexes.get(book);
  if (!index || index.ledger !== book.ledger) {
    index = { ledger: book.ledger, ids: new Set(book.ledger.map(e => e.id)) };
    financialIndexes.set(book, index);
  }
  return index.ids;
}
export function compactFinancialBook(book) {
  prepareFinancialBook(book);
  book.ledgerClosedThrough = Math.max(book.ledgerClosedThrough, book.settledDay - 1);
  if (book.ledger.length <= RECENT_LEDGER_ITEMS) return book;
  const retained = [], cutoff = book.ledger.length - RECENT_LEDGER_ITEMS;
  for (let i = 0; i < book.ledger.length; i++) {
    const e = book.ledger[i];
    if (i >= cutoff || e.day > book.ledgerClosedThrough) { retained.push(e); continue; }
    const total = (book.ledgerArchive.byKind[e.kind] ||= { amount: 0, paid: 0, entries: 0 });
    total.amount += e.amount; total.paid += e.kind === 'payment' ? e.amount : (e.paid || 0);
    total.entries++; book.ledgerArchive.entries++;
  }
  book.ledger = retained; financialIndexes.delete(book);
  return book;
}
export function recordBill(book, account, eventId, kind, amount, day) {
  prepareFinancialBook(book);
  if (!Number.isFinite(amount) || amount < 0 || !Number.isInteger(day)) throw Error('Invalid bill');
  const seq = eventSequence(book, eventId, ['rescue', 'payment']), ids = financialIndex(book);
  if (day <= book.ledgerClosedThrough || ids.has(eventId) || (seq && seq <= book.financialCounter)) return false;
  const paid = Math.min(Math.max(0, account.latinum), amount);
  account.latinum -= paid; book.debt += amount - paid;
  book.ledger.push({ id: eventId, kind, amount, paid, day }); ids.add(eventId);
  if (seq) book.financialCounter = seq;
  return true;
}
export function payDebt(book, account, day) {
  prepareFinancialBook(book);
  const amount = Math.min(book.debt, Math.max(0, account.latinum));
  if (amount <= 0) return 0;
  account.latinum -= amount; book.debt -= amount;
  const id = nextId(book, 'payment'); book.financialCounter = book.counter;
  financialIndex(book).add(id); book.ledger.push({ id, kind: 'payment', amount, day });
  return amount;
}
export function ensureStock(book, system, hull, day, capacity = 2, sources = []) {
  const key = `${system}:${hull}`;
  if (!book.stock[key])
    book.stock[key] = {
      system,
      hull,
      quantity: capacity,
      capacity,
      seed: stableHash(`${book.campaignId}:${key}`),
      nextDay: day + 3 + (stableHash(key) % 5),
      event: 0,
      sources: copy(sources),
    };
  return book.stock[key];
}
export function advanceStock(book, day) {
  for (const item of Object.values(book.stock))
    while (item.nextDay <= day) {
      item.quantity = Math.min(item.capacity, item.quantity + 1);
      item.event++;
      item.nextDay += 3 + (stableHash(`${item.seed}:${item.event}`) % 5);
    }
}
export function consumeStock(book, system, hull) {
  const item = book.stock[`${system}:${hull}`];
  if (!item || item.quantity < 1) return false;
  item.quantity--;
  return true;
}
export function addFormation(book, name) {
  const f = {
    id: nextId(book, 'formation'),
    name: String(name).slice(0, 60) || 'Fleet',
    members: [],
    flagship: null,
    order: 'follow',
    intent: 'destroy',
    destination: null,
  };
  book.formations.push(f);
  return f;
}
export function assignFormation(book, vesselId, formationId) {
  const to = book.formations.find((f) => f.id === formationId);
  if (
    formationId &&
    (!to || (!to.members.includes(vesselId) && to.members.length >= FLEET_RULES.formationSize))
  )
    return false;
  for (const f of book.formations) {
    f.members = f.members.filter((id) => id !== vesselId);
    if (f.flagship === vesselId) f.flagship = f.members[0] || null;
  }
  if (to) {
    to.members.push(vesselId);
    to.flagship ||= vesselId;
  }
  return true;
}
export function removeVessel(book, vesselId) {
  assignFormation(book, vesselId, null);
}
// The caller supplies the verified Flash upkeep policy. No invented default percentage.
export function advanceCalendar(book, account, days, id, hooks) {
  prepareFinancialBook(book);
  // Engine journeys are monotonic. The persisted high-water mark recognizes
  // old completed journeys even after their verbose history is compacted.
  if (Object.hasOwn(book.advances, id)) return false;
  const seq = eventSequence(book, id, ['journey', 'legacy-journey']);
  if (!seq) throw Error('Calendar requires an ID from nextId(book, "journey")');
  if (seq <= book.journeyCounter) return false;
  if (!Number.isInteger(days) || days < 0) throw Error('Calendar days must be nonnegative integers');
  for (let i = 0; i < days; i++) {
    const day = account.day + 1;
    hooks.settle?.(day); account.day = day; book.settledDay = day;
    hooks.complete?.(day); advanceStock(book, day); hooks.market?.(day);
    compactFinancialBook(book);
  }
  book.journeyCounter = seq;
  return true;
}
export function beginBoarding(book, { targetId, sourceId, resistance = 'standard' }) {
  if (book.boarding || !book.team.available) return null;
  const id = nextId(book, 'boarding'),
    xp = book.team.xp;
  const operation = {
    id,
    targetId,
    sourceId,
    phase: 'deployment',
    remaining: FLEET_RULES.deploymentSeconds,
    xp,
    resistance,
    chance: boardingChance(xp, resistance),
    roll: (stableHash(`${book.campaignId}:${targetId}:${xp}:v2`) / 4294967296) * 100,
    algorithm: 2,
  };
  book.boarding = operation;
  book.team.available = false;
  return operation;
}
export function cancelBoarding(book) {
  if (book.boarding?.phase !== 'deployment') return false;
  book.boarding = null;
  book.team.available = true;
  return true;
}
export function stepBoarding(book, seconds, { targetAlive = true, ready = true } = {}) {
  const op = book.boarding;
  if (!op) return null;
  if (!targetAlive && op.phase === 'deployment') {
    cancelBoarding(book);
    return { ...op, outcome: 'cancelled' };
  }
  if (!targetAlive) {
    book.team.retainedXP = Math.floor(op.xp * 0.5);
    book.team.xp = book.team.retainedXP;
    book.team.available = false;
    book.boarding = null;
    return { ...op, outcome: 'target-lost' };
  }
  if (op.phase === 'deployment' && !ready) {
    cancelBoarding(book);
    return { ...op, outcome: 'cancelled' };
  }
  op.remaining -= Math.max(0, seconds);
  if (op.remaining > 0) return null;
  if (op.phase === 'deployment') {
    op.phase = 'onboard';
    op.remaining += FLEET_RULES.boardingSeconds;
    if (op.remaining > 0) return null;
  }
  const success = op.roll < op.chance;
  book.team.available = success;
  book.team.xp = success ? Math.min(100, op.xp + 8) : Math.floor(op.xp * 0.5);
  if (!success) book.team.retainedXP = book.team.xp;
  book.boarding = null;
  return { ...op, outcome: success ? 'captured' : 'scuttled' };
}
export function recruitTeam(book, account) {
  if (book.team.available || book.boarding || book.debt > 0 || account.latinum < FLEET_RULES.recruitCost)
    return false;
  account.latinum -= FLEET_RULES.recruitCost;
  book.team.available = true;
  book.team.xp = book.team.retainedXP;
  return true;
}
export function trainTeam(book, account) {
  if (
    !book.team.available ||
    book.boarding ||
    book.debt > 0 ||
    book.team.xp >= 50 ||
    account.latinum < FLEET_RULES.trainingCost
  )
    return false;
  account.latinum -= FLEET_RULES.trainingCost;
  book.team.xp = Math.min(50, book.team.xp + 5);
  return true;
}
export function buildRecipe(price, mass = 1) {
  return {
    latinum: Math.round(price * 0.82),
    duranium: Math.max(1, Math.ceil(mass * 2)),
    days: Math.max(2, Math.ceil(Math.sqrt(Math.max(1, mass)) * 2)),
  };
}
export function progressBuilds(book, stationState, deliver) {
  const busy = new Set();
  for (const order of book.orders) {
    if (order.status === 'delivered' || order.status === 'lost') continue;
    const status = stationState(order.stationId, order.system);
    if (status === 'destroyed') {
      order.status = 'lost';
      continue;
    }
    if (status !== 'owned') {
      order.status = 'paused';
      continue;
    }
    if (busy.has(order.stationId)) {
      order.status = 'queued';
      continue;
    }
    busy.add(order.stationId);
    order.status = 'building';
    order.remainingDays--;
    if (order.remainingDays <= 0) {
      deliver(order);
      order.status = 'delivered';
    }
  }
}
