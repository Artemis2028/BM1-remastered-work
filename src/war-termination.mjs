// How a war ends. Pure: given what the war has cost each side and where the front stands, say whether it
// goes on, is suspended by a ceasefire, or is settled — and on what territorial terms.
// Rules: docs/playtest/BILATERAL-WAR-PEACE-RULES-260130ZSEP26.md §3–§4.
//
// No single number ends a war. Every outcome needs several conditions at once, and none of them is a
// date: the age of a war is a floor under a stalemate, never a reason for one.
export const WAR_RULES = Object.freeze({
  decisiveCapacity: 0.35,       // the loser's ready strength at or below this share of its own best...
  decisiveWorldShare: 1 / 3,    // ...and it has lost its home world or this share of the worlds it held at the start...
  decisiveStrengthRatio: 2,     // ...and the winner fields at least this multiple of the loser's strength
  stalemateMinDays: 90,         // a war this young is not a stalemate however quiet it is
  stalemateStallDays: 60,       // no capture either way for this long
  stalemateMinEngagements: 20,  // consequential engagements in this war instance (the Dominion's own bar for a war that has cost something)
  stalemateMinCapacity: 0.3,    // both still field at least this share of their best: continuing is costly, not impossible
  stalemateMaxRatio: 2.5,       // the stronger side is at most this multiple of the weaker: no near-term decisive path
  exhaustionCapacity: 0.5,      // at or below this share of its best a side is exhausted...
  exhaustionStrain: 0.6,        // ...or when revenue, treasury or yards fall to this share of its best
  ceasefireSettleDays: 30,      // a ceasefire this long without a hostile act settles into peace
  offerExpiryDays: 20,          // an offer to the player lapses after this long unanswered
  offerCooldownDays: 45,        // after a refusal or lapse, no new offer to the player for this long
  refusalStanding: -5,          // what refusing an offer costs with the power that made it
});

// sides: { [id]: { strength, capacity, capShare, strain, worldsNow, worldsAtStart, worldsLost, homeLost, losses } }
// war:   { age, daysSinceFront, engagements, status, ceasefireDays, quietSinceCeasefire }
// Returns { outcome: 'continue'|'ceasefire'|'peace', basis, winner, loser, reason, reasons[] }.
export function evaluateWar(a, b, sides, war, rules = WAR_RULES) {
  const A = sides[a], B = sides[b];
  const reasons = [];
  const name = (id) => sides[id]?.name || id;
  if (war.status === 'ceasefire') {
    if (war.quietSinceCeasefire && war.ceasefireDays >= rules.ceasefireSettleDays)
      return { outcome: 'peace', basis: 'settlement', winner: null, loser: null, reason: `the ceasefire held for ${war.ceasefireDays} days`, reasons };
    reasons.push(war.quietSinceCeasefire ? `ceasefire ${war.ceasefireDays}/${rules.ceasefireSettleDays} days` : 'hostile acts since the ceasefire began');
    return { outcome: 'continue', basis: null, reasons };
  }
  // Decisive: somebody can no longer credibly continue.
  const beaten = (L, W) => {
    const l = sides[L], w = sides[W];
    if (!l || !w) return null;
    // An expeditionary side is beaten when its expedition can no longer sustain the war and the other
    // side clearly outmatches what is left of it. Its home realm is never the question.
    if (l.expedition) {
      const outmatchedExp = w.strength >= Math.max(1, l.strength) * rules.decisiveStrengthRatio;
      return l.expedition.unsustainable && outmatchedExp
        ? `${name(L)}'s expedition can no longer sustain the war: ${(l.expedition.reasons || []).join('; ')}`
        : null;
    }
    // A party that held no world when the war began (the captain's empire, an outpost garrison) cannot
    // lose one; holding nothing is decisive only for a power that had ground to lose.
    if (l.worldsAtStart > 0 && l.worldsNow === 0) return `${name(L)} holds no world`;
    const worn = l.capShare != null && l.capShare <= rules.decisiveCapacity;
    const lostGround = l.homeLost || (l.worldsAtStart > 0 && l.worldsLost / l.worldsAtStart >= rules.decisiveWorldShare);
    const outmatched = w.strength >= Math.max(1, l.strength) * rules.decisiveStrengthRatio;
    if (worn && lostGround && outmatched)
      return l.homeLost ? `${l.homeName || 'its home world'} has fallen and ${name(L)} cannot contest it` : `${name(L)} has lost ${l.worldsLost} of its ${l.worldsAtStart} worlds and cannot contest them`;
    return null;
  };
  const lossA = beaten(a, b), lossB = lossA ? null : beaten(b, a);
  if (lossA) return { outcome: 'peace', basis: 'decisive', winner: b, loser: a, reason: lossA, reasons };
  if (lossB) return { outcome: 'peace', basis: 'decisive', winner: a, loser: b, reason: lossB, reasons };

  // Stalemate, with exhaustion shortening the windows. Exhaustion alone never ends a war.
  const exhausted = [a, b].filter((id) => {
    const s = sides[id];
    return (s.capShare != null && s.capShare <= rules.exhaustionCapacity) || (s.strain != null && s.strain <= rules.exhaustionStrain);
  });
  const scale = exhausted.length ? 0.5 : 1;
  const minDays = Math.ceil(rules.stalemateMinDays * scale), stall = Math.ceil(rules.stalemateStallDays * scale);
  if (war.age < minDays) { reasons.push(`war ${war.age}/${minDays} days old`); return { outcome: 'continue', basis: null, reasons, exhausted }; }
  if (war.daysSinceFront < stall) { reasons.push(`the front moved ${war.daysSinceFront} days ago`); return { outcome: 'continue', basis: null, reasons, exhausted }; }
  const paid = war.engagements >= rules.stalemateMinEngagements && (A.losses || 0) > 0 && (B.losses || 0) > 0;
  if (!paid) { reasons.push(`not yet costly: ${war.engagements} engagements, losses ${A.losses || 0}/${B.losses || 0}`); return { outcome: 'continue', basis: null, reasons, exhausted }; }
  const capable = [A, B].every((s) => s.capShare == null || s.capShare >= rules.stalemateMinCapacity);
  if (!capable) { reasons.push('one side is below the stalemate floor but not yet beaten'); return { outcome: 'continue', basis: null, reasons, exhausted }; }
  const hi = Math.max(A.strength, B.strength), lo = Math.max(1, Math.min(A.strength, B.strength));
  if (hi / lo > rules.stalemateMaxRatio) { reasons.push(`strength ratio ${(hi / lo).toFixed(1)} leaves a path to victory`); return { outcome: 'continue', basis: null, reasons, exhausted }; }
  const basis = exhausted.length ? 'exhaustion' : 'stalemate';
  const reason = basis === 'exhaustion'
    ? `${exhausted.map(name).join(' and ')} ${exhausted.length > 1 ? 'are' : 'is'} exhausted and the front has not moved for ${war.daysSinceFront} days`
    : `the front has not moved for ${war.daysSinceFront} days and neither side can force a decision`;
  return { outcome: 'ceasefire', basis, winner: null, loser: null, reason, reasons, exhausted };
}

// Terms for the worlds the pair took from each other. occupied: [{ systemIndex, holder, claimant, claimantPeople }]
// where claimantPeople says the world's people are the claimant's own. strengths: { [id]: ready strength }.
export function settlementTerms(basis, winner, occupied, strengths) {
  const out = [];
  for (const w of occupied) {
    let term;
    if (basis === 'decisive') term = w.holder === winner ? 'retained_by_occupier' : 'returned_to_previous_controller';
    else if (w.claimantPeople) term = (strengths[w.claimant] || 0) >= (strengths[w.holder] || 0) ? 'returned_to_previous_controller' : 'disputed';
    else term = 'retained_by_occupier';
    out.push({ systemIndex: w.systemIndex, holder: w.holder, claimant: w.claimant, term });
  }
  return out;
}
