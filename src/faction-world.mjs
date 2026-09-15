// Remaster simulation tuning, grounded in the game's faction/starting-background lore.
// Civilian travel and military deployment are separate decisions.
export const FACTION_TRAFFIC = Object.freeze({
  romulan: {
    foreignTrade: 0.02,
    warDeployment: 1.4,
    description:
      'Secretive and territorial; rare overseas civilian traffic, military sorties during war.',
  },
  klingon: {
    foreignTrade: 0.18,
    warDeployment: 1.6,
    description: 'Warrior patrols and raids; limited civilian commerce.',
  },
  terran: {
    foreignTrade: 0.45,
    warDeployment: 1.25,
    description: 'Imperial supply routes and wartime military deployments.',
  },
  vulcan: {
    foreignTrade: 0.4,
    warDeployment: 0.75,
    description: 'Measured diplomatic, science and trade journeys.',
  },
  andorian: {
    foreignTrade: 0.35,
    warDeployment: 1.2,
    description: 'Regional commerce with strong defensive patrols.',
  },
  cardassian: {
    foreignTrade: 0.22,
    warDeployment: 1.3,
    description: 'Controlled trade routes and occupation forces.',
  },
  dominion: {
    foreignTrade: 0.06,
    warDeployment: 1.6,
    description: 'Core worlds remain isolated; foreign fleets require an authorized invasion.',
  },
  breen: {
    foreignTrade: 0.03,
    warDeployment: 1.1,
    description: 'Reclusive regional traffic and wartime expeditions.',
  },
  tholian: {
    foreignTrade: 0.8,
    warDeployment: 0.55,
    description: 'Civilian shipbuilders and traders rebuilding their economy.',
  },
  ferengi: {
    foreignTrade: 1.5,
    warDeployment: 0.25,
    description: 'Commerce-heavy traffic; rarely a military expedition.',
  },
  bajoran: {
    foreignTrade: 0.5,
    warDeployment: 0.65,
    description: 'Regional reconstruction and civilian supply routes.',
  },
  gorn: {
    foreignTrade: 0.15,
    warDeployment: 1.0,
    description: 'Territorial patrols with limited outside commerce.',
  },
  hirogen: {
    foreignTrade: 0,
    warDeployment: 1.3,
    description: 'Hunting expeditions, not civilian merchant traffic.',
  },
  suliban: {
    foreignTrade: 0.04,
    warDeployment: 0.8,
    description: 'Small, covert deployments and little open trade.',
  },
  neutral: {
    foreignTrade: 1.8,
    warDeployment: 0,
    description: 'Independent merchants connect peaceful markets.',
  },
});
export const DIPLOMACY_RULES = Object.freeze({
  crisisThreshold: 70,
  warThreshold: 100,
  treatyDays: 14,
  minimumWarDays: 10,
  eventEveryDays: 3,
});
export function pairKey(a, b) {
  return [a, b].sort().join(':');
}
export function randomFor(text) {
  let h = 2166136261;
  for (const c of String(text)) {
    h ^= c.charCodeAt(0);
    h = Math.imul(h, 16777619);
  }
  return (h >>> 0) / 4294967296;
}
export function createDiplomacy(seed, day = 1) {
  return { version: 1, seed: String(seed), lastDay: day, pairs: {}, history: [] };
}
export function relation(book, a, b, baseWar = false) {
  if (a === b) return { status: 'allied', tension: 0 };
  return (
    book?.pairs?.[pairKey(a, b)] || {
      status: baseWar ? 'war' : 'peace',
      tension: baseWar ? 100 : 15,
      since: 1,
      treatyUntil: 0,
    }
  );
}
function record(book, a, b, day, entry, reason) {
  book.pairs[pairKey(a, b)] = { ...entry, a, b };
  book.history.push({ day, a, b, status: entry.status, tension: entry.tension, reason });
  book.history = book.history.slice(-120);
  return book.pairs[pairKey(a, b)];
}
export function setDiplomacy(
  book,
  a,
  b,
  status,
  day,
  baseWar = false,
  reason = 'Captain debug control',
) {
  if (!a || !b || a === b || ['neutral', 'borg', 'pirate'].some((x) => x === a || x === b))
    throw new Error(
      'Choose two different diplomatic factions. Borg, pirates and independent traffic do not sign treaties.',
    );
  if (!['peace', 'crisis', 'war'].includes(status)) throw new Error('Choose peace, crisis or war.');
  const previous = relation(book, a, b, baseWar);
  return record(
    book,
    a,
    b,
    day,
    {
      ...previous,
      status,
      tension: { peace: 10, crisis: 85, war: 100 }[status],
      since: day,
      treatyUntil: status === 'peace' ? day + DIPLOMACY_RULES.treatyDays : 0,
    },
    reason,
  );
}
export function spikeCrisis(book, a, b, amount, day, baseWar = false, reason = 'Border incident') {
  const old = relation(book, a, b, baseWar);
  if (old.status === 'war' || day < old.treatyUntil) return old;
  const tension = Math.max(0, Math.min(100, old.tension + amount));
  const status = tension >= 100 ? 'war' : tension >= 70 ? 'crisis' : 'peace';
  return record(
    book,
    a,
    b,
    day,
    { ...old, tension, status, since: status === old.status ? old.since : day },
    reason,
  );
}
export function advanceDiplomacy(book, day, pairs, baseWar) {
  // Calendar replay is deterministic and exactly once, including multiday travel and reload.
  for (let d = book.lastDay + 1; d <= day; d++) {
    if (d % DIPLOMACY_RULES.eventEveryDays === 0 && pairs.length) {
      const [a, b] = pairs[Math.floor(randomFor(`${book.seed}:${d}:pair`) * pairs.length)];
      const old = relation(book, a, b, baseWar(a, b));
      const roll = randomFor(`${book.seed}:${d}:${a}:${b}`);
      if (old.status === 'war') {
        const warAge = d - old.since;
        if (warAge >= DIPLOMACY_RULES.minimumWarDays && roll < Math.min(0.75, 0.2 + warAge / 150))
          setDiplomacy(book, a, b, 'peace', d, true, 'War exhaustion and negotiated peace');
      } else if (d >= old.treatyUntil) {
        if (old.status === 'crisis' && roll < 0.32)
          setDiplomacy(book, a, b, 'peace', d, false, 'Mediation resolves the crisis');
        else
          spikeCrisis(
            book,
            a,
            b,
            roll > 0.65 ? 45 : roll < 0.3 ? -25 : 8,
            d,
            false,
            roll > 0.65
              ? 'A border incident spikes tensions'
              : roll < 0.3
                ? 'Diplomatic talks reduce tensions'
                : 'Rival claims raise tensions',
          );
      }
    }
    book.lastDay = d;
  }
  return book;
}
export function civilianWeight(faction, host, atWar) {
  if (faction === host) return 2;
  if (atWar) return 0;
  return FACTION_TRAFFIC[faction]?.foreignTrade ?? 0.2;
}
