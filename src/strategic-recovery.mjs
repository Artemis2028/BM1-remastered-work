// Towing, salvage and stranded-hull recovery (TOWING-SALVAGE-RECOVERY). The pure parts: who can tow what,
// the mission's states, and the claim rules. Nothing here reads a world, a book or the engine; the
// mission itself — its journeys, its crossings, its arrival — is the shared strategic journey's
// (campaign-strategy.mjs, journey kind `recovery`).
//
// A disabled hull never moves by itself. It is recovered only when a real recovery-capable vessel flies
// to where it lies, takes it in tow, and flies it — slower — to a yard. The hull is the same persistent
// vessel throughout (the same record, the same vid).

// ---- the mission ----
export const RECOVERY_STATES = Object.freeze([
  'requested',          // created; a tug is being matched (a request with none is refused, not kept)
  'assigned',           // a tug (and any escorts) is committed to it
  'en_route_to_hulk',   // the outbound journey is under way
  'on_scene',           // the tug is at the hulk's system; the on-scene checks run
  'attached',           // the hulk is made fast (and, for salvage, has changed hands)
  'towing',             // the inbound tow journey is under way (or waiting for a way through)
  'delivered_to_yard',  // the hulk is at the yard: the yard's ordinary recovery and repair take over
  'aborted',            // called off (cancelled, the hulk gone or no longer claimable, no yard, no way)
  'failed',             // lost the tug, or the hulk itself was destroyed under tow
]);
export const RECOVERY_OPEN = Object.freeze(['requested', 'assigned', 'en_route_to_hulk', 'on_scene', 'attached', 'towing']);
export const RECOVERY_CANCELLABLE = Object.freeze(['requested', 'assigned', 'en_route_to_hulk', 'on_scene']);
export function recoveryOpen(rec) { return Boolean(rec) && RECOVERY_OPEN.includes(rec.state); }

// ---- the lifecycle in the brief's terms (TOWING-SALVAGE-RULES §2) ----
// One phase per record, from the request to the hull back in service (or the end that stopped it). The
// mission states above drive the tow; after delivery the record keeps following the same hull through the
// yard (`rec.after`, advanced daily by advanceHullRecoveries) until it is back in service or lost.
export const RECOVERY_PHASES = Object.freeze([
  'requested',                // waiting for a recovery vessel (none free yet)
  'recovery_asset_en_route',  // assigned; the vessel is flying out
  'on_scene',
  'tow_attached',
  'towing',
  'in_yard',                  // delivered: the yard's recovery has it, not yet repaired
  'repairing',                // the yard is repairing it
  'recrew_if_required',       // structurally repaired, waiting for a crew (crew rescued or lost)
  'complete',                 // back in service: same hull, same vid
  'aborted', 'failed', 'lost_after_delivery',
  'left_yard',                // out of this yard's hands before repair (yard lost): this record ends; a new recovery takes over
]);
export function recoveryPhase(rec) {
  if (!rec) return null;
  switch (rec.state) {
    case 'requested': return rec.awaitingAsset != null ? 'requested' : 'recovery_asset_en_route';
    case 'assigned': case 'en_route_to_hulk': return 'recovery_asset_en_route';
    case 'on_scene': return 'on_scene';
    case 'attached': return 'tow_attached';
    case 'towing': return 'towing';
    case 'delivered_to_yard': return rec.after?.phase || 'in_yard';
    default: return rec.state;
  }
}
// The yard phase of a delivered hull, read off the hull itself. hull: its record (or null if gone);
// facts: { disabled, inYard (the yard's recovery has it), awaitingCrew, lost, startHull }.
export const YARD_FINAL = Object.freeze(['complete', 'lost_after_delivery', 'left_yard']);
export function yardPhase(f) {
  if (f.lost) return 'lost_after_delivery';
  // Still disabled and no longer in the yard's hands (the yard lost, back in the open; or another recovery
  // has her): this delivery is over. A later recovery's record follows her from here, not this one.
  if (f.disabled && (!f.inYard || f.otherClaim)) return 'left_yard';
  if (f.awaitingCrew) return 'recrew_if_required';
  if (!f.disabled) return 'complete';
  if (f.inYard && Number(f.hull) > Number(f.startHull)) return 'repairing';
  return 'in_yard';
}

// ---- capability: who can tow what ----
// A class's recoveryCapacity is the heaviest hull (by the catalogue's mass, 1–10) it can take in tow alone.
// It is explicit in bm-ships/ships.json (scripts/assign-recovery-capacity.mjs), assigned once from the
// class's role and size category; a hand-set value (basis "authored") is kept. Combat stats never decide it.
export const CATEGORY_RECOVERY = Object.freeze({
  heavyTug: 10,     // a heavy tug: anything up to a battleship
  tug: 8,           // a utility / service tug
  support: 7,       // engineering, repair, salvage, operations-support frames
  battleship: 6,
  capital: 5,
  freighter: 4,     // a cargo frame with tractor gear: light hulls
  cruiser: 3,
  lightCruiser: 2,
  fastCruiser: 2,
  escort: 1,
  shuttle: 0,       // shuttles, scouts and runabouts tow nothing
});
const has = (s, ...words) => words.some((w) => s.includes(w));
// speedCategory: the class's strategic-speed category (strategic-speed.mjs), for the size default.
export function recoveryCategory(ship, speedCategory = null) {
  const role = String(ship?.role || '').toLowerCase();
  const name = String(ship?.name || '').toLowerCase();
  if (has(role, 'tug') || has(name, ' tug')) return has(role, 'heavy') ? 'heavyTug' : 'tug';
  if (has(role, 'support', 'engineering', 'repair', 'tender', 'salvage')) return 'support';
  const cat = speedCategory || 'cruiser';
  if (['scout', 'shuttle', 'cargoShuttle'].includes(cat)) return 'shuttle';
  return CATEGORY_RECOVERY[cat] != null ? cat : 'cruiser';
}
export function authoredRecoveryCapacity(ship, speedCategory = null) { return CATEGORY_RECOVERY[recoveryCategory(ship, speedCategory)] ?? 0; }
// From a stats record (a catalogue entry or world.shipStats()): the explicit field, else nothing.
export function classRecoveryCapacity(stats) {
  const n = Number(stats?.recoveryCapacity);
  return Number.isFinite(n) && n > 0 ? Math.min(10, Math.floor(n)) : 0;
}
// What towing a hull needs: its class's mass (1–10).
export function towRequirement(stats) { return Math.max(1, Math.min(10, Math.round(Number(stats?.mass) || 3))); }
export function canTow(tugStats, targetStats) {
  const cap = classRecoveryCapacity(tugStats), need = towRequirement(targetStats);
  return { ok: cap >= need, capacity: cap, need, reason: cap >= need ? null : cap <= 0 ? 'cannot take anything in tow' : `can tow a hull of mass ${cap}; this one needs ${need}` };
}

// ---- claims: who may recover or salvage whom ----
// facts: { claimant, owner, abandoned (written off by its owner), crew ('aboard'|'rescued'|'lost'|null),
//   surrendered, atWar (claimant and owner formally at war), ownerHoldsSystem, ownerGuards (an operational
//   hull of the owner's standing in the system), otherClaim (another live claim on it), engineOwned
//   (a vessel of the captain's, whose books the engine keeps), claimantIsPlayer }
// Returns { ok, kind: 'recovery'|'salvage', authority, reason }.
export function claimVerdict(f) {
  if (f.otherClaim) return { ok: false, kind: null, authority: null, reason: `already claimed (${f.otherClaim})` };
  if (f.claimant === f.owner) return { ok: true, kind: 'recovery', authority: f.abandoned ? 'own (reclaimed derelict)' : 'own hull', reason: null };
  if (f.engineOwned) return { ok: false, kind: 'salvage', authority: null, reason: 'the captain\'s vessels are not salvage' };
  if (f.surrendered) return { ok: false, kind: 'salvage', authority: null, reason: 'surrendered: held under the surrender rules, not salvage' };
  if (!f.abandoned && f.crew === 'aboard') return { ok: false, kind: 'salvage', authority: null, reason: 'crewed: her people are aboard (a capture, not a salvage)' };
  if (!f.abandoned && !f.atWar) return { ok: false, kind: 'salvage', authority: null, reason: 'not abandoned, and its owner is not at war with you' };
  if (f.ownerHoldsSystem) return { ok: false, kind: 'salvage', authority: null, reason: 'protected: it lies in its owner\'s space' };
  if (f.ownerGuards) return { ok: false, kind: 'salvage', authority: null, reason: 'guarded: its owner has ships on station there' };
  return { ok: true, kind: 'salvage', authority: f.abandoned ? 'abandoned derelict' : 'enemy hulk, crew gone (war)', reason: null };
}
