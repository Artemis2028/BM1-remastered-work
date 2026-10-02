// Treaty terms (TREATY-EXPANSION): DMZs, transit guarantees, basing rights, inspection regimes, tribute,
// reparations and blockade-lifting clauses. The pure parts: the term record and its validation, who a term
// binds and what it covers, the payment ledger arithmetic, the breach-incident record, who may see what, and
// the concise lines the UI shows. Nothing here reads a world or moves a ship; the systems that already exist
// (the shared journey, the blockade engine, the yards, doctrine enforcement, the economy) call these
// predicates and act through their own code paths (campaign-strategy.mjs §TREATY TERMS).
//
// A term is never a label. Each one carries named parties, an explicit scope, a start and an end, a status,
// who knows of it, an enforcement authority, its breach history and where it came from — and it is persisted
// with the campaign book like every other record.

export const TERM_TYPES = Object.freeze(['dmz', 'transit', 'basing', 'inspection', 'tribute', 'reparations', 'blockade_lift']);
export const TERM_STATUS = Object.freeze(['pending', 'active', 'suspended', 'ended']);
// Traffic classes a term can name. A journey is exactly one of them (trafficClassOf in campaign-strategy).
export const TRAFFIC = Object.freeze(['military', 'civilian', 'recovery']);
// What a DMZ restricts for the parties it binds (all on unless the term says otherwise).
export const DMZ_RESTRICTIONS = Object.freeze(['transit', 'stationing', 'reinforcement', 'blockade', 'offensive']);
export const BASING_PURPOSES = Object.freeze(['repair', 'resupply', 'staging', 'docking', 'recovery']);
// What an inspection may reveal. Concealed items are never in it: a request reveals nothing, an inspection
// sees the declared hold and only what the regime names.
export const INSPECTION_REVEALS = Object.freeze(['manifest', 'hulls']);
export const INCIDENT_KINDS = Object.freeze(['dmz_entry', 'dmz_stationing', 'inspection_refused', 'payment_missed', 'transit_obstructed', 'blockade_in_dmz']);
export const INCIDENT_STATES = Object.freeze(['warned', 'complied', 'breach', 'resolved']);
export const INSPECTION_STATES = Object.freeze(['requested', 'completed', 'refused']);

const uniq = (xs) => [...new Set((xs || []).filter((x) => x != null && x !== ''))];
const nums = (xs) => uniq((xs || []).map(Number).filter(Number.isFinite)).sort((a, b) => a - b);
const posInt = (n, d) => (Number.isFinite(Number(n)) && Number(n) > 0 ? Math.round(Number(n)) : d);

// ---- the record ----
// spec → { ok, term } | { ok:false, reason }. `id` and `day` come from the caller (the book's own counter).
export function makeTerm(spec, id, day) {
  const s = spec || {};
  const type = s.type;
  if (!TERM_TYPES.includes(type)) return { ok: false, reason: `unknown term type ${type}` };
  const startDay = s.startDay == null ? Number(day) : Number(s.startDay);
  if (!Number.isFinite(startDay)) return { ok: false, reason: 'no start day' };
  const endDay = s.endDay == null ? (s.durationDays ? startDay + posInt(s.durationDays, 0) : null) : Number(s.endDay);
  const base = {
    id, type, startDay, endDay, endCondition: s.endCondition || null,
    status: startDay <= Number(day) ? 'active' : 'pending', createdDay: Number(day), endedDay: null, endReason: null,
    secret: Boolean(s.secret), knownTo: [], authority: s.authority || { kind: 'authored' }, settlementSource: s.settlementSource || null,
    enforcers: [], compliance: { ...(s.compliance || {}) }, breaches: [], label: s.label || null,
  };
  let t;
  switch (type) {
    case 'dmz': {
      const parties = uniq(s.parties);
      const systems = nums(s.systems);
      if (parties.length < 2 && !(s.restricted || []).length) return { ok: false, reason: 'a DMZ binds named parties' };
      if (!systems.length) return { ok: false, reason: 'a DMZ covers named systems' };
      const restricted = uniq(s.restricted?.length ? s.restricted : parties);
      const restrict = Object.fromEntries(DMZ_RESTRICTIONS.map((k) => [k, s.restrict?.[k] !== false]));
      t = { ...base, parties: uniq([...parties, ...restricted]), systems, restricted, restrict,
        civilian: s.civilian === 'prohibited' ? 'prohibited' : 'allowed', recovery: s.recovery === 'prohibited' ? 'prohibited' : 'allowed',
        graceDays: posInt(s.graceDays, 10), corridor: systems.length > 1, withdrawal: null };
      break;
    }
    case 'transit': {
      if (!s.grantor || !s.beneficiary || s.grantor === s.beneficiary) return { ok: false, reason: 'a transit guarantee names a grantor and a beneficiary' };
      const systems = nums(s.systems);
      if (!systems.length) return { ok: false, reason: 'a transit guarantee covers named systems, a route or a chokepoint' };
      t = { ...base, parties: [s.grantor, s.beneficiary], grantor: s.grantor, beneficiary: s.beneficiary, systems,
        route: Array.isArray(s.route) ? s.route.map(Number) : null, traffic: uniq(s.traffic?.length ? s.traffic : ['civilian', 'military']).filter((x) => TRAFFIC.includes(x)) };
      break;
    }
    case 'basing': {
      if (!s.host || !s.guest || s.host === s.guest) return { ok: false, reason: 'basing rights name a host and a guest' };
      const systems = nums(s.systems);
      if (!systems.length) return { ok: false, reason: 'basing rights name the host facilities (systems)' };
      const purposes = uniq(s.purposes?.length ? s.purposes : ['repair', 'resupply']).filter((x) => BASING_PURPOSES.includes(x));
      if (!purposes.length) return { ok: false, reason: 'basing rights name what they are for' };
      t = { ...base, parties: [s.host, s.guest], host: s.host, guest: s.guest, systems, stations: uniq(s.stations), purposes,
        repairShare: Math.max(0.05, Math.min(1, Number(s.repairShare) || 0.5)) };
      break;
    }
    case 'inspection': {
      if (!s.inspector || !s.inspected || s.inspector === s.inspected) return { ok: false, reason: 'an inspection regime names who inspects whom' };
      const systems = nums(s.systems);
      if (!systems.length) return { ok: false, reason: 'an inspection regime names where it applies' };
      t = { ...base, parties: [s.inspector, s.inspected], inspector: s.inspector, inspected: s.inspected, systems,
        traffic: uniq(s.traffic?.length ? s.traffic : ['military']).filter((x) => TRAFFIC.includes(x)), hullCategories: uniq(s.hullCategories),
        reveals: uniq(s.reveals?.length ? s.reveals : ['manifest']).filter((x) => INSPECTION_REVEALS.includes(x)), onRefusal: s.onRefusal === 'record_only' ? 'record_only' : 'deny_passage' };
      break;
    }
    case 'tribute': {
      if (!s.payer || !s.recipient || s.payer === s.recipient) return { ok: false, reason: 'tribute names a payer and a recipient' };
      const amount = posInt(s.amount, 0);
      if (!amount) return { ok: false, reason: 'tribute names an amount' };
      const cadenceDays = posInt(s.cadenceDays, 30);
      t = { ...base, parties: [s.payer, s.recipient], payer: s.payer, recipient: s.recipient, amount, cadenceDays,
        nextDue: s.firstDue != null ? Number(s.firstDue) : startDay + cadenceDays, arrears: 0, paidTotal: 0, paidCount: 0, missedCount: 0, installments: s.installments ? posInt(s.installments, null) : null };
      break;
    }
    case 'reparations': {
      if (!s.payer || !s.recipient || s.payer === s.recipient) return { ok: false, reason: 'reparations name a payer and a recipient' };
      const total = posInt(s.total, 0);
      if (!total) return { ok: false, reason: 'reparations name a finite total' };
      const payments = posInt(s.payments, null);
      const installment = posInt(s.installment, payments ? Math.ceil(total / payments) : 0);
      if (!installment) return { ok: false, reason: 'reparations name an installment or a number of payments' };
      const cadenceDays = posInt(s.cadenceDays, 30);
      t = { ...base, parties: [s.payer, s.recipient], payer: s.payer, recipient: s.recipient, total, installment, cadenceDays, remaining: total,
        nextDue: s.firstDue != null ? Number(s.firstDue) : startDay + cadenceDays, arrears: 0, paidTotal: 0, paidCount: 0, missedCount: 0, endCondition: 'paid_in_full' };
      break;
    }
    case 'blockade_lift': {
      const parties = uniq(s.parties);
      if (parties.length < 2) return { ok: false, reason: 'a blockade clause binds named parties' };
      const blockadeIds = uniq(s.blockadeIds), systems = nums(s.systems);
      if (!blockadeIds.length && !systems.length) return { ok: false, reason: 'a blockade clause names the blockades (or systems) to lift' };
      t = { ...base, parties, blockadeIds, systems, lifted: [] };
      break;
    }
    default: return { ok: false, reason: `unknown term type ${type}` };
  }
  // Who knows: the parties always; a public term is known to everyone (termVisibleTo), a secret one only to
  // those named. Who enforces: the parties the term protects (never a third power).
  t.knownTo = uniq([...t.parties, ...(s.knownTo || [])]);
  t.enforcers = uniq(s.enforcers?.length ? s.enforcers : defaultEnforcers(t));
  return { ok: true, term: t };
}
function defaultEnforcers(t) {
  switch (t.type) {
    case 'dmz': return t.parties;               // each party polices the other's compliance
    case 'transit': return [t.beneficiary];      // the beneficiary reports obstruction
    case 'basing': return [t.host];
    case 'inspection': return [t.inspector];
    case 'tribute': case 'reparations': return [t.recipient];
    default: return t.parties;
  }
}

// ---- status ----
export function termActive(t, day) {
  return Boolean(t) && t.status === 'active' && Number(day) >= Number(t.startDay) && (t.endDay == null || Number(day) <= Number(t.endDay));
}
// What the record shows: 'breached' while an open (unresolved) breach of it stands.
export function displayStatus(t, incidents = []) {
  if (t.status !== 'active') return t.status;
  return incidents.some((x) => x.termId === t.id && x.state === 'breach') ? 'breached' : 'active';
}
export function bindsParty(t, polity) { return Boolean(t) && (t.parties || []).includes(polity); }

// ---- knowledge ----
// A public term is known to everyone; a secret one only to those named in knownTo (and the debug view).
export function termVisibleTo(t, viewer) {
  if (!t) return false;
  if (viewer === 'debug') return true;
  return !t.secret || (t.knownTo || []).includes(viewer);
}
export function termKnownTo(t, polity) { return termVisibleTo(t, polity); }
// An incident is known only to those it names (the party that did it, and those with evidence).
export function incidentVisibleTo(x, viewer) { return viewer === 'debug' || (x?.knownTo || []).includes(viewer); }

// ---- scope predicates ----
// Does this DMZ restrict this party's traffic of this class?
export function dmzRestricts(t, polity, cls) {
  if (!t || t.type !== 'dmz' || !(t.restricted || []).includes(polity)) return false;
  if (cls === 'recovery') return t.recovery === 'prohibited';
  if (cls === 'civilian') return t.civilian === 'prohibited';
  return t.restrict?.transit !== false || t.restrict?.stationing !== false;
}
export function transitCovers(t, polity, systemIndex, cls) {
  return Boolean(t) && t.type === 'transit' && t.beneficiary === polity && (t.systems || []).includes(Number(systemIndex)) && (t.traffic || []).includes(cls === 'recovery' ? 'military' : cls);
}
export function guaranteeBinds(t, grantor, beneficiary, systemIndex, cls = null) {
  return Boolean(t) && t.type === 'transit' && t.grantor === grantor && t.beneficiary === beneficiary && (t.systems || []).includes(Number(systemIndex))
    && (cls == null || (t.traffic || []).includes(cls === 'recovery' ? 'military' : cls));
}
export function basingAllows(t, guest, systemIndex, purpose) {
  return Boolean(t) && t.type === 'basing' && t.guest === guest && (t.systems || []).includes(Number(systemIndex)) && (t.purposes || []).includes(purpose);
}
export function inspectionApplies(t, polity, systemIndex, cls, categories = []) {
  if (!t || t.type !== 'inspection' || t.inspected !== polity || !(t.systems || []).includes(Number(systemIndex))) return false;
  if (!(t.traffic || []).includes(cls)) return false;
  if ((t.hullCategories || []).length && !categories.some((c) => t.hullCategories.includes(c))) return false;
  return true;
}
export function dmzBansBlockade(t, power, systemIndex) {
  return Boolean(t) && t.type === 'dmz' && t.restrict?.blockade !== false && (t.restricted || []).includes(power) && (t.systems || []).includes(Number(systemIndex));
}

// ---- inspection: what it may observe ----
// manifest: [{ cargoId, quantity, concealed }] — the declared hold. A request observes nothing; a completed
// inspection observes the non-concealed items, and only the categories the regime reveals.
export function inspectionObservation(t, { manifest = [], hulls = [] } = {}) {
  const out = {};
  if ((t.reveals || []).includes('manifest')) out.manifest = (manifest || []).filter((m) => m && !m.concealed).map((m) => ({ cargoId: m.cargoId, quantity: m.quantity ?? null }));
  if ((t.reveals || []).includes('hulls')) out.hulls = (hulls || []).map((h) => ({ vid: h.vid, shipId: h.shipId }));
  return out;
}

// ---- the ledger: tribute and reparations ----
export function installmentAmount(t) {
  if (t.type === 'tribute') return t.installments != null ? Math.max(0, Math.min(t.amount, t.amount * t.installments - t.paidTotal - t.arrears)) : t.amount;
  if (t.type === 'reparations') return Math.min(t.installment, Math.max(0, t.remaining - t.arrears));
  return 0;
}
// One day of a payment term for a payer holding `funds`. Pure: returns what happens; the caller moves the money.
// Arrears are cleared first whenever the funds allow; on a due day the installment is paid or it is missed.
// A miss adds the installment to the arrears and is a breach; it is never anything more.
export function settlePaymentDay(t, funds, day) {
  const out = { arrearsPaid: 0, paid: 0, missed: 0, due: false, completed: false };
  let f = Math.max(0, Number(funds) || 0);
  if (t.arrears > 0 && f >= t.arrears) { out.arrearsPaid = t.arrears; f -= t.arrears; }
  if (Number(day) >= Number(t.nextDue)) {
    out.due = true;
    const amt = installmentAmount({ ...t, arrears: t.arrears - out.arrearsPaid });
    if (amt > 0) { if (f >= amt) out.paid = amt; else out.missed = amt; }
  }
  return out;
}
// Apply a settlePaymentDay result to the term (mutates). Returns the term's completion state.
export function applyPaymentDay(t, r) {
  t.arrears = Math.max(0, t.arrears - r.arrearsPaid);
  const paidNow = r.arrearsPaid + r.paid;
  t.paidTotal += paidNow;
  if (t.type === 'reparations') t.remaining = Math.max(0, t.remaining - paidNow);
  if (r.paid > 0) t.paidCount++;
  if (r.missed > 0) { t.arrears += r.missed; t.missedCount++; }
  if (r.due) t.nextDue = Number(t.nextDue) + t.cadenceDays;
  // A fixed run of tribute is complete when the whole of it has been paid (late installments count once paid).
  const completed = t.type === 'reparations' ? t.remaining <= 0 : (t.installments != null && t.paidTotal >= t.amount * t.installments && t.arrears <= 0);
  return { completed };
}

// ---- breach incidents ----
export function makeIncident(id, { term, kind, breaching, systemIndex = null, assets = [], evidence = [], knownTo = [], severity = 'minor', state = 'breach', day, detail = null }) {
  return { id, termId: term.id, termType: term.type, kind, breaching, against: (term.parties || []).filter((p) => p !== breaching),
    systemIndex: systemIndex == null ? null : Number(systemIndex), assets: uniq(assets), evidence: evidence.slice(), knownTo: uniq([breaching, ...knownTo]),
    severity, state, day: Number(day), resolvedDay: null, detail, responses: [{ day: Number(day), state, detail }], warDeclared: false };
}
export function noteIncident(x, day, state, detail) {
  x.state = state; x.responses.push({ day: Number(day), state, detail });
  if (state === 'resolved' || state === 'complied') x.resolvedDay = Number(day);
  if (x.responses.length > 12) x.responses = x.responses.slice(-12);
}

// ---- settlement authoring: bounded clause fixtures ----
// A clause string for a settlement (no negotiation AI): who grants or pays is `ctx.by`, who benefits or receives
// is `ctx.to`; systems are resolved by name or index through ctx.system(name). Returns a term spec or { error }.
export function parseClause(text, ctx) {
  const s = String(text || '').trim();
  if (!ctx?.by || !ctx?.to) return { error: `"${s}" names no granting/paying and benefiting/receiving party (give { clause, by, to })` };
  if (ctx.symmetric) { const r = parseClause(s, { ...ctx, symmetric: false }); return r.error || ['dmz', 'blockade_lift'].includes(r.type) ? r : { error: `"${s}" needs a named payer or grantor in a settlement with no winner (give { clause, by, to })` }; }
  const sys = (list) => list.split(/[\/,]| and /).map((x) => x.trim()).filter(Boolean).map((x) => (/^\d+$/.test(x) ? Number(x) : ctx.system?.(x))).filter((x) => x != null && Number.isFinite(Number(x)));
  let m;
  if ((m = s.match(/^add\s+dmz\s+systems?\s+(.+)$/i))) {
    const systems = sys(m[1]);
    return systems.length ? { type: 'dmz', parties: [ctx.by, ctx.to], systems } : { error: `no systems in "${s}"` };
  }
  if ((m = s.match(/^grant\s+transit\s+(?:route|through)\s+(.+)$/i))) {
    const systems = sys(m[1]);
    return systems.length ? { type: 'transit', grantor: ctx.by, beneficiary: ctx.to, systems, route: systems } : { error: `no systems in "${s}"` };
  }
  if ((m = s.match(/^grant\s+basing\s+at\s+(.+?)(?:\s+for\s+(.+))?$/i))) {
    const systems = sys(m[1]);
    const purposes = m[2] ? m[2].split(/[\/,]| and /).map((x) => x.trim().toLowerCase()).filter(Boolean) : ['repair', 'resupply'];
    return systems.length ? { type: 'basing', host: ctx.by, guest: ctx.to, systems, purposes } : { error: `no systems in "${s}"` };
  }
  if ((m = s.match(/^tribute\s+([\d,]+)\s+every\s+(\d+)\s+days?$/i))) return { type: 'tribute', payer: ctx.by, recipient: ctx.to, amount: Number(m[1].replace(/,/g, '')), cadenceDays: Number(m[2]) };
  if ((m = s.match(/^reparations\s+([\d,]+)\s+over\s+(\d+)\s+payments?(?:\s+every\s+(\d+)\s+days?)?$/i))) return { type: 'reparations', payer: ctx.by, recipient: ctx.to, total: Number(m[1].replace(/,/g, '')), payments: Number(m[2]), cadenceDays: m[3] ? Number(m[3]) : 30 };
  if ((m = s.match(/^inspection\s+regime\s+on\s+(military|civilian)\s+(freighters?|traffic|ships?)(?:\s+at\s+(.+))?$/i))) {
    const systems = m[3] ? sys(m[3]) : (ctx.systems || []);
    const cats = /^freighter/i.test(m[2]) ? ['freighter'] : [];
    return systems.length ? { type: 'inspection', inspector: ctx.to, inspected: ctx.by, systems, traffic: [m[1].toLowerCase()], hullCategories: cats } : { error: `no systems for "${s}"` };
  }
  if ((m = s.match(/^lift\s+blockades?\s+(?:at\s+)?(.+)$/i))) {
    const systems = sys(m[1]);
    return systems.length ? { type: 'blockade_lift', parties: [ctx.by, ctx.to], systems } : { error: `no systems in "${s}"` };
  }
  return { error: `unrecognised clause "${s}"` };
}

// ---- concise lines (the UI) ----
const L = (n) => `${Math.round(Number(n) || 0).toLocaleString('en-US')} L`;
export function termHeadline(t, name = (x) => x) {
  switch (t.type) {
    case 'dmz': return `DMZ — ${t.restrict?.transit !== false ? 'Military transit prohibited' : 'Military stationing prohibited'}${t.civilian === 'allowed' ? '; civilian traffic allowed' : '; civilian traffic prohibited'}`;
    case 'transit': return `Transit guaranteed under treaty (${name(t.grantor)} → ${name(t.beneficiary)})`;
    case 'basing': return `Basing rights: ${t.purposes.join(', ')} (${name(t.host)} hosts ${name(t.guest)})`;
    case 'inspection': return `Inspection required: ${t.traffic.join('/')}${t.hullCategories.length ? ` ${t.hullCategories.join('/')}` : ''} traffic of ${name(t.inspected)} (by ${name(t.inspector)})`;
    case 'tribute': return `Tribute due: ${L(t.amount)} every ${t.cadenceDays} days (${name(t.payer)} → ${name(t.recipient)})`;
    case 'reparations': return `Reparations remaining: ${L(t.remaining)} of ${L(t.total)} (${name(t.payer)} → ${name(t.recipient)})`;
    case 'blockade_lift': return `Blockades lifted under treaty${t.lifted?.length ? ` (${t.lifted.length})` : ''}`;
    default: return t.type;
  }
}
export function termObligationLine(t, day) {
  if (t.type === 'tribute' || t.type === 'reparations') {
    const parts = [];
    if (t.status === 'active') parts.push(`next ${L(installmentAmount(t))} due day ${t.nextDue}${Number(t.nextDue) - Number(day) >= 0 ? ` (in ${Number(t.nextDue) - Number(day)} d)` : ''}`);
    if (t.arrears > 0) parts.push(`arrears ${L(t.arrears)}`);
    parts.push(`paid ${L(t.paidTotal)} in ${t.paidCount}`);
    if (t.missedCount) parts.push(`missed ${t.missedCount}`);
    return parts.join(' · ');
  }
  if (t.type === 'dmz' && t.withdrawal && t.status === 'active' && Number(day) <= t.withdrawal.dueDay) return `withdrawal due by day ${t.withdrawal.dueDay}`;
  return null;
}
export function termExpiryLine(t) {
  if (t.status === 'ended') return `ended day ${t.endedDay}${t.endReason ? ` (${t.endReason})` : ''}`;
  if (t.status === 'pending') return `from day ${t.startDay}`;
  if (t.endDay != null) return `until day ${t.endDay}`;
  if (t.endCondition === 'paid_in_full') return 'until paid in full';
  return 'open-ended';
}
export function incidentLine(x, name = (p) => p) {
  const what = { dmz_entry: 'entered the DMZ', dmz_stationing: 'kept ships in the DMZ', inspection_refused: 'refused inspection', payment_missed: 'missed a payment', transit_obstructed: 'obstructed guaranteed transit', blockade_in_dmz: 'blockaded inside the DMZ' }[x.kind] || x.kind;
  return `Day ${x.day}: ${name(x.breaching)} ${what} — ${x.state}${x.assets?.length ? ` (${x.assets.slice(0, 3).join(', ')}${x.assets.length > 3 ? '…' : ''})` : ''}`;
}
