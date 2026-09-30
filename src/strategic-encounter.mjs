// The one strategic ↔ tactical encounter record (STRATEGIC-TACTICAL-HANDOFF). When a strategically decided
// contact happens where the captain actually is, it is handed to the loaded tactical scene instead of being
// resolved abstractly — and from that moment this record, and only this record, owns its resolution:
//
//   strategic ─► pending ─► tactical_active ─► resolved            (the scene fought it)
//                  │               │
//                  │               └────────► resolved (disengaged: the captain left mid-fight; what the
//                  │                           scene did is written back, the strategic layer carries on)
//                  └──────────────────────────► fallback           (no scene could be made, or the captain
//                                                                    left before it was: the family's
//                                                                    strategic resolver runs exactly once)
//                  └──────────────────────────► aborted            (the contact vanished before it was
//                                                                    fought: a ceasefire, the ship gone)
//
//   { id, key, system, type: blockade | operation | raid | predation | enforcement,
//     createdDay, status, captain (the captain himself is a party), playerHostile,
//     participants[{ ref, hullId, vid, polity, side, role, shipId, spawn, engineOwned, pirateGroupId,
//                    before{hull, maxHull, crew, status, systemIndex}, after, fate }],
//     sides{ a, b }, objective{ kind, ref }, authority, journeys[], contact{…},
//     result | null, continuation | null, fallback{ used, reason, day } | null, history[], resolvedDay }
//
// Nothing here reads a world: what a contact is, and what an outcome does to the book, belong to the
// family that registered the type (campaign-strategy.mjs for blockades and operations, doctrine-campaign.mjs
// for raids, predation and enforcement). While an encounter is live every participating hull carries its
// id (`encounterId`), which keeps it out of every other strategic selection and resolver.

export const ENCOUNTER_TYPES = Object.freeze(['blockade', 'operation', 'raid', 'predation', 'enforcement']);
export const LIVE = Object.freeze(['pending', 'tactical_active']);
// What one tactical participant can come back as (§5 of the handoff rules).
export const FATES = Object.freeze(['survived', 'damaged', 'disabled', 'destroyed', 'surrendered', 'escaped']);

const FAMILIES = {};
const HOOKS = { applyFate: null, surrender: null };
export function registerEncounterFamily(type, family) { FAMILIES[type] = family; }
export function encounterFamily(type) { return FAMILIES[type] || null; }
// The book-level consequences of one fate on a strategic hull (lose it, strand it, write its hull):
// campaign-strategy registers it; doctrine registers the surrender (Phase 4 rules live there).
export function registerFateHooks(hooks) { Object.assign(HOOKS, hooks); }
export function fateHooks() { return HOOKS; }

export function encounterBook(book) {
  book.encounters ||= [];
  book.encounterCounter ||= 0;
  book.stats ||= {};
  book.stats.encounters ||= { opened: 0, byType: {}, activated: 0, resolved: 0, fallbacks: 0, aborted: 0, duplicatesPrevented: 0, sameVidRoundTrips: 0,
    lossesWrittenBack: 0, journeysResumed: 0, objectivesClosed: 0, staleSuppressed: 0, abstractSuppressed: 0, disengaged: 0 };
  return book.encounters;
}
export function encounterStats(book) { encounterBook(book); return book.stats.encounters; }
export function bumpEncounterStat(book, key, n = 1) { const st = encounterStats(book); st[key] = (st[key] || 0) + n; }
export function isLive(enc) { return Boolean(enc) && LIVE.includes(enc.status); }
export function encounterById(book, id) { return (book.encounters || []).find((e) => e.id === id) || null; }
export function encounterByKey(book, key) { return (book.encounters || []).find((e) => e.key === key) || null; }
export function liveEncounters(book, system = null) {
  return (book.encounters || []).filter((e) => isLive(e) && (system == null || Number(e.system) === Number(system)));
}
// The live encounter that owns an objective (an operation, a blockade crossing, a raid, a predation, an
// enforcement): while there is one, that objective's strategic resolver does nothing.
export function liveEncounterFor(book, kind, ref) {
  return (book.encounters || []).find((e) => isLive(e) && e.objective?.kind === kind && String(e.objective.ref) === String(ref)) || null;
}
export function liveEncounterOfHull(book, hullId) {
  return (book.encounters || []).find((e) => isLive(e) && e.participants.some((p) => p.hullId != null && String(p.hullId) === String(hullId))) || null;
}
// A resolver that finds a live encounter owning what it was about to resolve counts it here: the guard is
// explicit, never timing luck, and the count is how duplicate resolution would show.
export function suppressAbstract(book, enc, what) {
  bumpEncounterStat(book, 'abstractSuppressed');
  if (enc) { enc.suppressed = (enc.suppressed || 0) + 1; enc.lastSuppressed = what; }
  return true;
}
function note(enc, day, event, detail = null) {
  enc.history.push({ day, event, ...(detail ? { detail } : {}) });
  if (enc.history.length > 24) enc.history = enc.history.slice(-24);
}
// Open (or find) the encounter for one contact. `key` names the contact itself (this blockade, this runner,
// this crossing; this operation's engagement; this raid's strike day…): a second call for the same contact
// returns the record already there — whatever its status — so no contact is ever handed off twice or
// resolved twice. `participants` are hull records (or pirate groups) as they stand now; their state is
// copied into `before` and each hull is marked with the encounter's id.
export function openEncounter(book, spec, day, lookup) {
  encounterBook(book);
  const had = encounterByKey(book, spec.key);
  if (had) { bumpEncounterStat(book, 'duplicatesPrevented'); return { enc: had, fresh: false }; }
  book.encounterCounter++;
  const id = `${book.seed}:enc:${book.encounterCounter}`;
  // A hull already in another live encounter is not a party to this one: one vessel, one engagement.
  const busy = (rec) => Boolean(rec?.encounterId) && isLive(encounterById(book, rec.encounterId));
  const participants = (spec.participants || []).filter((p) => { const rec = p.record || (lookup ? lookup(p) : null); return !(p.hullId != null && !p.engineOwned && busy(rec)); }).map((p) => {
    const rec = p.record || (lookup ? lookup(p) : null);
    const before = rec ? { hull: Number(rec.hull), maxHull: Number(rec.maxHull), crew: rec.crew ?? null, status: rec.status ?? null, systemIndex: rec.systemIndex ?? null } : (p.before || null);
    const out = { ref: p.ref || p.hullId || p.pirateGroupId, hullId: p.hullId ?? null, vid: p.vid ?? rec?.identity?.vid ?? rec?.vid ?? null, polity: p.polity ?? null, side: p.side, role: p.role || null,
      shipId: p.shipId ?? rec?.shipId ?? null, name: p.name ?? rec?.identity?.name ?? rec?.name ?? null, spawn: p.spawn !== false, engineOwned: Boolean(p.engineOwned),
      pirateGroupId: p.pirateGroupId ?? null, faction: p.faction ?? p.polity ?? null, cloak: p.cloak ?? null, cargo: p.cargo ?? null, before, after: null, fate: null };
    if (rec && p.hullId != null && !p.engineOwned) rec.encounterId = id;
    return out;
  });
  const enc = { id, key: spec.key, system: Number(spec.system), type: spec.type, createdDay: day, status: 'pending', captain: Boolean(spec.captain), playerHostile: Boolean(spec.playerHostile),
    participants, sides: spec.sides || null, objective: spec.objective || null, authority: spec.authority || null, journeys: spec.journeys || [], contact: spec.contact || null,
    result: null, continuation: null, fallback: null, history: [], resolvedDay: null, activatedDay: null, spawned: [] };
  note(enc, day, 'pending', spec.reason || null);
  book.encounters.push(enc);
  const st = encounterStats(book);
  st.opened++; st.byType[spec.type] = (st.byType[spec.type] || 0) + 1;
  return { enc, fresh: true };
}
// The engine made the scene: these participants are now ships in it.
export function activateEncounter(book, id, day, spawnedVids = []) {
  const enc = encounterById(book, id);
  if (!enc || enc.status !== 'pending') return enc;
  enc.status = 'tactical_active'; enc.activatedDay = day; enc.spawned = [...spawnedVids];
  note(enc, day, 'tactical_active', `${spawnedVids.length} ship(s) in the scene`);
  bumpEncounterStat(book, 'activated');
  return enc;
}
function unmark(book, enc, lookup) {
  for (const p of enc.participants) {
    if (p.hullId == null || p.engineOwned) continue;
    const h = lookup ? lookup(p) : null;
    if (h && h.encounterId === enc.id) delete h.encounterId;
  }
}
// The tactical outcome, once. `report` = { result: { outcome, … }, participants: { [ref]: { fate, hull, crew } } }.
// Every participant's fate is written onto the same record it came from (its vid unchanged); then the
// family decides what the strategic layer does next (a journey goes on or turns back, an operation ends,
// a raid strikes or withdraws, a pirate group recovers or is gone).
export function resolveEncounter(book, world, id, report, day, effects = [], lookup = null) {
  const enc = encounterById(book, id);
  if (!enc || !isLive(enc)) return { ok: false, reason: enc ? `encounter already ${enc.status}` : 'no such encounter' };
  const fam = FAMILIES[enc.type];
  unmark(book, enc, lookup);
  const by = report?.participants || {};
  for (const p of enc.participants) {
    const r = by[p.ref] || by[p.hullId] || null;
    if (!r) { p.fate = p.fate || (p.spawn && !p.engineOwned ? 'survived' : null); continue; }
    p.fate = r.fate || 'survived';
    p.after = { hull: r.hull ?? null, crew: r.crew ?? null, maxHull: p.before?.maxHull ?? null };
    if (p.engineOwned) continue;
    if (p.vid && r.vid && r.vid !== p.vid) p.vidMismatch = r.vid; // never expected: the scene spoke for another ship
    if (!p.pirateGroupId && p.hullId != null && HOOKS.applyFate) {
      const w = HOOKS.applyFate(book, world, p, r, enc, day, effects);
      if (w) bumpEncounterStat(book, 'lossesWrittenBack', w.lost ? 1 : 0);
    }
    if (p.vid && r.vid === p.vid) bumpEncounterStat(book, 'sameVidRoundTrips');
  }
  enc.result = { ...(report?.result || {}) };
  enc.status = 'resolved'; enc.resolvedDay = day;
  const cont = fam?.resolve ? fam.resolve(book, world, enc, report || {}, day, effects) : null;
  enc.continuation = cont?.continuation || cont || enc.continuation || null;
  if (cont?.journeyResumed) bumpEncounterStat(book, 'journeysResumed');
  if (cont?.objectiveClosed) bumpEncounterStat(book, 'objectivesClosed');
  if (report?.result?.outcome === 'disengaged') bumpEncounterStat(book, 'disengaged');
  note(enc, day, 'resolved', `${enc.result.outcome || 'resolved'}${enc.continuation ? ` → ${typeof enc.continuation === 'string' ? enc.continuation : enc.continuation.continuation || ''}` : ''}`);
  bumpEncounterStat(book, 'resolved');
  effects.push({ type: 'encounterResolved', id: enc.id, encounterType: enc.type, system: enc.system, day, outcome: enc.result.outcome || null, captain: enc.captain,
    participants: enc.participants.map((p) => ({ ref: p.ref, vid: p.vid, polity: p.polity, side: p.side, shipId: p.shipId, fate: p.fate, spawned: enc.spawned.includes(p.vid) || enc.spawned.includes(p.ref) })),
    continuation: typeof enc.continuation === 'string' ? enc.continuation : enc.continuation?.continuation || null, objective: enc.objective });
  prune(book);
  return { ok: true, enc };
}
// No tactical scene could be made (or the captain left before it was): the family's own strategic resolver
// runs for this contact exactly once, and this contact is never handed off again (the objective behind it
// may be handed off on a later day, as a new contact, if the captain is there again).
export function fallbackEncounter(book, world, id, day, effects = [], reason = 'no tactical scene', lookup = null) {
  const enc = encounterById(book, id);
  if (!enc || !isLive(enc)) return { ok: false, reason: enc ? `encounter already ${enc.status}` : 'no such encounter' };
  unmark(book, enc, lookup);
  enc.status = 'fallback'; enc.resolvedDay = day; enc.fallback = { used: true, reason, day };
  const fam = FAMILIES[enc.type];
  const cont = fam?.fallback ? fam.fallback(book, world, enc, day, effects) : null;
  enc.continuation = cont?.continuation || cont || 'strategic resolver';
  note(enc, day, 'fallback', reason);
  bumpEncounterStat(book, 'fallbacks');
  effects.push({ type: 'encounterFallback', id: enc.id, encounterType: enc.type, system: enc.system, day, reason });
  prune(book);
  return { ok: true, enc };
}
// The contact vanished before it was fought (a ceasefire before contact, the runner gone): nothing is
// resolved either way.
export function abortEncounter(book, id, day, reason, lookup = null) {
  const enc = encounterById(book, id);
  if (!enc || !isLive(enc)) return false;
  unmark(book, enc, lookup);
  enc.status = 'aborted'; enc.resolvedDay = day; enc.result = { outcome: 'aborted', reason };
  note(enc, day, 'aborted', reason);
  bumpEncounterStat(book, 'aborted');
  const fam = FAMILIES[enc.type];
  fam?.abort?.(book, enc, day, reason);
  prune(book);
  return true;
}
function prune(book) {
  const list = book.encounters || [];
  if (list.length <= 80) return;
  const live = list.filter(isLive);
  const done = list.filter((e) => !isLive(e));
  const keep = Math.max(0, 80 - live.length);
  book.encounters = (keep ? done.slice(-keep) : []).concat(live);
}
