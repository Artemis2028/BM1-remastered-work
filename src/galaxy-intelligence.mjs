// Seed each observation once. Reopening or loading a report never rerolls its claims.
export const INTEL_KINDS = Object.freeze(['quiet', 'scout', 'skirmish', 'raid', 'battle']);
export function intelRandom(seed) {
  let value = 2166136261;
  for (const c of String(seed)) value = Math.imul(value ^ c.charCodeAt(0), 16777619);
  return () => {
    value = (value + 0x6D2B79F5) | 0;
    let t = value;
    t = Math.imul(t ^ t >>> 15, t | 1);
    t ^= t + Math.imul(t ^ t >>> 7, t | 61);
    return ((t ^ t >>> 14) >>> 0) / 4294967296;
  };
}
export function assessIntel(observation, {seed, ownShips = false, candidates = [], age = 0}) {
  const random = intelRandom(seed);
  // Reliability varies from report to report, even with our own observers.
  const accuracy = Math.max(0.3, (ownShips ? 0.80 + random() * 0.17 : 0.45 + random() * 0.30)
    - Math.min(0.2, Math.max(0, age) * 0.01));
  const truth = INTEL_KINDS.includes(observation.kind) ? observation.kind : 'quiet';
  const correct = random() < accuracy;
  const alternatives = INTEL_KINDS.filter(kind => kind !== truth);
  const kind = correct ? truth : alternatives[Math.floor(random() * alternatives.length)];
  // An actual recorded incursion can be identified far from its home territory.
  // Mistaken identities can name any faction supplied by the report adapter.
  const attacker = ['skirmish', 'raid', 'battle'].includes(kind)
    ? (correct && observation.attacker ? observation.attacker : candidates[Math.floor(random() * candidates.length)] || null)
    : null;
  return {kind, attacker, accuracy, correct, delay: ownShips ? 1 : 2 + Math.floor(random() * 3)};
}
