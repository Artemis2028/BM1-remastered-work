// The one strategic journey record (STRATEGIC-MOVEMENT-UNIFICATION). It is the formation route record of
// FORMATION-ROUTE-TRAVERSAL-RULES §1, generalised: the same fields describe a player formation, an AI war
// operation, an evacuation convoy, a blockade force taking station, a hull sailing to a yard, a doctrine
// vessel on its errand. What each kind of mover does at a crossing or on arrival is its owner's business;
// where the ships are, which leg they are on and when it ends is this record's, and only this record's.
//
//   { id, seq, kind, ref, sponsor, origin, plotFrom, from, destination, path[], legDays[], legIndex,
//     legDepartDay, legArrivalDay, startDay, etaDay,
//     members[], vids{id → vid}, purpose, war (authority stamp) | null, authority { kind, ref, … } | null,
//     crossed[{system, day, leg, seq}], encounters[…], detached[{id, vid, system, day, reason}],
//     replots[…], pending { destination, purpose, war, day } | null,
//     status: underway | arrived | halted | superseded, endDay, endReason, arrivedDay, note,
//     waiting?, retreatFrom?, warLapsedDay? }
//
// Nothing here reads a world or a book: plotting and the consequences of a crossing are the caller's.

export const JOURNEY_STATUSES = Object.freeze(['underway', 'arrived', 'halted', 'superseded']);

export function legLength(tr, i) {
  return Math.max(1, Math.round(Number(tr?.legDays?.[i]) || 1));
}
// The day the journey reaches its destination if nothing stops it: the end of the leg in flight plus
// every leg still to fly.
export function journeyEta(tr) {
  let eta = Number(tr.legArrivalDay ?? tr.legDepartDay ?? tr.startDay);
  for (let i = tr.legIndex + 1; i < tr.path.length; i++) eta += legLength(tr, i);
  return eta;
}
// A new journey from `from`, beginning on `day`. `prior` is the record it replaces (a replot, a forced
// return): the sequence goes up by one and the history (origin, start, crossings, encounters,
// detachments, replots) carries over, so a crossing is never repeated under a new plot.
export function createJourney({ id, kind, ref = null, sponsor = null, from, destination, path, legDays, day, members = [], vids = {}, purpose = 'move', war = null, authority = null, prior = null, meta = null }) {
  const origin = Number(from);
  const tr = {
    id,
    seq: (prior?.seq ?? 0) + 1,
    kind: kind || prior?.kind || 'move',
    ref: ref ?? prior?.ref ?? null,
    sponsor: sponsor ?? prior?.sponsor ?? null,
    origin: prior ? Number(prior.origin) : origin,
    plotFrom: origin,
    from: origin,
    destination: Number(destination),
    path: (path || []).map(Number),
    legDays: (legDays || []).map((d) => Math.max(1, Math.round(Number(d) || 1))),
    legIndex: 0,
    legDepartDay: Number(day),
    legArrivalDay: Number(day),
    startDay: prior ? Number(prior.startDay) : Number(day),
    etaDay: Number(day),
    members: [...members],
    vids: { ...vids },
    purpose,
    war: war || null,
    authority: authority || null,
    crossed: prior ? prior.crossed : [],
    encounters: prior ? prior.encounters : [],
    detached: prior ? prior.detached : [],
    replots: prior ? [...(prior.replots || []), { day: Number(day), at: origin, from: Number(prior.destination), to: Number(destination) }] : [],
    pending: null,
    status: 'underway',
    endDay: null,
    endReason: null,
    arrivedDay: null,
    note: '',
  };
  if (meta) tr.meta = { ...meta };
  return tr;
}
// Put the journey on leg `legIndex`, departing today.
export function scheduleLeg(tr, day) {
  tr.legDepartDay = Number(day);
  tr.legArrivalDay = Number(day) + legLength(tr, tr.legIndex);
  tr.etaDay = journeyEta(tr);
  return tr.legArrivalDay;
}
// Is the leg in flight over by `day`?
export function legDue(tr, day) {
  return Boolean(tr) && tr.status === 'underway' && !tr.waiting && tr.legArrivalDay != null && Number(tr.legArrivalDay) <= Number(day) && tr.legIndex < tr.path.length;
}
// The crossing at the end of the leg in flight, recorded once per (seq, leg). A second call for the same
// leg (the same day processed again, a reload) returns `fresh: false` and changes nothing.
export function markCrossed(tr) {
  const day = Number(tr.legArrivalDay), at = Number(tr.path[tr.legIndex]);
  if (tr.crossed.some((c) => c.seq === tr.seq && c.leg === tr.legIndex)) return { at, day, fresh: false };
  tr.crossed.push({ system: at, day, leg: tr.legIndex, seq: tr.seq });
  tr.from = at;
  return { at, day, fresh: true };
}
export function hasMoreLegs(tr) { return tr.legIndex + 1 < tr.path.length; }
export function advanceLeg(tr, day) {
  tr.legIndex += 1;
  return scheduleLeg(tr, day);
}
export function detachMember(tr, id, at, day, reason) {
  if (!tr.members.includes(id)) return false;
  tr.members = tr.members.filter((x) => x !== id);
  tr.detached.push({ id, vid: tr.vids?.[id] ?? null, system: Number(at), day: Number(day), reason });
  return true;
}
// Arrival happens once: `underway` → `arrived`.
export function arriveJourney(tr, at, day, note = '') {
  if (tr.status !== 'underway') return false;
  tr.status = 'arrived'; tr.endDay = Number(day); tr.arrivedDay = Number(day); tr.endReason = 'arrived';
  tr.from = Number(at);
  tr.note = note;
  return true;
}
export function haltJourney(tr, at, day, reason, note = '') {
  if (tr.status !== 'underway') return false;
  tr.status = 'halted'; tr.endDay = Number(day); tr.endReason = reason; tr.from = Number(at);
  tr.note = note;
  return true;
}
export function supersedeJourney(tr, day, reason = 'superseded') {
  if (tr.status !== 'underway') return false;
  tr.status = 'superseded'; tr.endDay = Number(day); tr.endReason = reason;
  return true;
}
// Where the journey is on `today`: standing in a system (the day a leg starts, or waiting), or in warp
// towards the end of its leg.
export function journeyPosition(tr, today) {
  if (!tr) return null;
  if (tr.status !== 'underway') return { standing: true, system: Number(tr.from), legEnd: null, arrivalDay: null };
  const standing = Boolean(tr.waiting) || Number(tr.legDepartDay) === Number(today);
  return { standing, system: standing ? Number(tr.from) : null, legEnd: Number(tr.path[tr.legIndex]), arrivalDay: tr.legArrivalDay == null ? null : Number(tr.legArrivalDay) };
}
// A short, stable description for debug tables and logs.
export function journeySummary(tr, nameOf = (i) => String(i)) {
  if (!tr) return '';
  const crossed = tr.crossed.filter((c) => c.seq === tr.seq).map((c) => nameOf(c.system));
  if (tr.status === 'underway') {
    return `${tr.purpose} → ${nameOf(tr.destination)} · leg ${tr.legIndex + 1}/${tr.path.length} ${nameOf(tr.from)} → ${nameOf(tr.path[tr.legIndex])}, day ${tr.legDepartDay}–${tr.legArrivalDay} · eta day ${tr.etaDay}${crossed.length ? ` · crossed ${crossed.join(', ')}` : ''}${tr.waiting ? ' · waiting' : ''}`;
  }
  return `${tr.status}${tr.endReason && tr.endReason !== tr.status ? ` (${tr.endReason})` : ''} at ${nameOf(tr.from)} day ${tr.endDay}${crossed.length ? ` via ${crossed.join(', ')}` : ''}`;
}
