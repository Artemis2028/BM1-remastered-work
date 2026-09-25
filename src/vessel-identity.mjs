// Persistent strategic vessel identity.
//
// A strategic vessel is one the game keeps a record of between scenes: a faction hull in the campaign
// books, a ship in the captain's fleet, or the captain's own ship. Its identity is what makes it *that*
// vessel rather than another of the same class, and it is carried by the vessel from the moment it
// enters the books until it leaves them — through purchase, capture, command transfer, formation
// assignment, travel, disablement, repair, save/load and flag changes. Who owns it and whose flag it
// flies are separate facts, held by whichever record holds the vessel; they never rewrite the identity.
//
// The identity is a plain object so it can live on any record and survive JSON:
//   vid       stable unique id; never reused, never reassigned
//   shipId    the design (class)
//   name      the vessel's own name
//   seed      its generated appearance/behaviour seed
//   origin    { builder, via, day, systemIndex, legacy } — who built it and how it entered the books;
//             written once, never rewritten by ownership or allegiance
//   history   bounded provenance log: { day, event, from, to, systemIndex }
//
// Vessels that leave the books (destroyed, scuttled, sold, replaced) are *retired* in a registry kept
// in the campaign book. The contract:
//   - a vid is never reused (it is derived from ids that are unique by construction, not from this
//     registry, so pruning the registry cannot free one);
//   - an active vessel's identity is persistent for as long as it is active;
//   - retired history is BOUNDED: only the newest RETIRED_LIMIT entries are kept, oldest dropped
//     first. A lookup of a long-retired vid can return null;
//   - later readers (foreign markets) must not rely on very old retired entries still being there.
//     Anything that must outlive that window has to be pinned in its own record (e.g. a prize record
//     that copies the identity it needs) rather than looked up here later.
export const IDENTITY_VERSION = 1;
export const HISTORY_LIMIT = 24;
export const RETIRED_LIMIT = 600;

export function vesselHash(value) {
  let h = 2166136261;
  for (const c of String(value)) h = Math.imul(h ^ c.charCodeAt(0), 16777619);
  return h >>> 0;
}
// A short, stable registry mark for display: the same vid always reads the same.
export function registryMark(vid) {
  return `R-${vesselHash(vid).toString(36).toUpperCase().padStart(7, '0').slice(-7)}`;
}
export function makeIdentity({ vid, shipId, name = null, seed = null, builder = null, via = 'unrecorded', day = null, systemIndex = null, legacy = false } = {}) {
  if (!vid) throw Error('A vessel identity needs a vid');
  const num = (v) => (v === null || v === undefined || v === '' || !Number.isFinite(Number(v)) ? null : Number(v));
  return {
    version: IDENTITY_VERSION,
    vid: String(vid),
    shipId: num(shipId),
    name: name == null ? null : String(name),
    seed: num(seed) ?? vesselHash(vid),
    origin: { builder: builder == null ? null : String(builder), via: String(via), day: num(day), systemIndex: num(systemIndex), legacy: Boolean(legacy) },
    history: [],
  };
}
// Accepts anything shaped like an identity and returns a normalised one, or null. Never invents a vid.
export function normalizeIdentity(identity) {
  if (!identity || typeof identity !== 'object' || !identity.vid) return null;
  const out = makeIdentity({ vid: identity.vid, shipId: identity.shipId, name: identity.name, seed: identity.seed,
    builder: identity.origin?.builder ?? null, via: identity.origin?.via ?? 'unrecorded', day: identity.origin?.day ?? null,
    systemIndex: identity.origin?.systemIndex ?? null, legacy: identity.origin?.legacy ?? false });
  out.history = Array.isArray(identity.history) ? identity.history.filter((h) => h && typeof h === 'object').slice(-HISTORY_LIMIT) : [];
  return out;
}
export function recordProvenance(identity, { day = null, event, from = null, to = null, systemIndex = null } = {}) {
  if (!identity || !event) return identity;
  identity.history ||= [];
  identity.history.push({ day: Number.isFinite(Number(day)) ? Number(day) : null, event: String(event), from: from ?? null, to: to ?? null, systemIndex: Number.isFinite(Number(systemIndex)) ? Number(systemIndex) : null });
  if (identity.history.length > HISTORY_LIMIT) identity.history = identity.history.slice(-HISTORY_LIMIT);
  return identity;
}
// Who the vessel was last taken from, if it was ever taken: the provenance entry, not a guess.
export function takenFrom(identity) {
  const e = [...(identity?.history || [])].reverse().find((h) => h.event === 'captured');
  return e ? e.from : null;
}
export function sameVessel(a, b) {
  return Boolean(a && b && a.vid && a.vid === b.vid);
}

// ---- the registry of vessels that have left the books ----
export function ensureRegistry(book) {
  if (!book.vesselRegistry || typeof book.vesselRegistry !== 'object') book.vesselRegistry = { version: 1, retired: {}, order: [] };
  const r = book.vesselRegistry;
  r.retired ||= {}; if (!Array.isArray(r.order)) r.order = Object.keys(r.retired);
  return r;
}
export function retireVessel(book, identity, { day = null, cause, holder = null, systemIndex = null } = {}) {
  if (!identity?.vid) return null;
  const r = ensureRegistry(book);
  if (r.retired[identity.vid]) return r.retired[identity.vid];
  const entry = { vid: identity.vid, shipId: identity.shipId, name: identity.name, origin: { ...(identity.origin || {}) },
    cause: String(cause || 'unknown'), day: Number.isFinite(Number(day)) ? Number(day) : null, holder, systemIndex,
    takenFrom: takenFrom(identity) };
  r.retired[identity.vid] = entry;
  r.order.push(identity.vid);
  while (r.order.length > RETIRED_LIMIT) delete r.retired[r.order.shift()];
  return entry;
}
export function retiredVessel(book, vid) {
  return book?.vesselRegistry?.retired?.[vid] || null;
}
