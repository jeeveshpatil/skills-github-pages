export const RANKS = [
  { name: 'Recruit', xp: 0 }, { name: 'Scout', xp: 300 }, { name: 'Tracker', xp: 800 },
  { name: 'Operative', xp: 1600 }, { name: 'Phantom', xp: 3000 }, { name: 'Wraith', xp: 5000 },
  { name: 'Apex', xp: 8000 }, { name: 'Legend', xp: 12000 },
];

export function rankFor(xp: number) {
  let i = 0;
  while (i + 1 < RANKS.length && xp >= RANKS[i + 1].xp) i++;
  const cur = RANKS[i], next = RANKS[i + 1];
  const progress = next ? (xp - cur.xp) / (next.xp - cur.xp) : 1;
  return { index: i, name: cur.name, next: next?.name ?? null, toNext: next ? next.xp - xp : 0, progress };
}

export const ACHIEVEMENTS: Record<string, { name: string; desc: string }> = {
  first_match: { name: 'Boots on the Ground', desc: 'Finish your first match' },
  first_win: { name: 'First Blood Moon', desc: 'Win a match' },
  first_blood: { name: 'Contact', desc: 'Make your first capture' },
  hat_trick: { name: 'Hat Trick', desc: '3 captures in one match' },
  marathon: { name: 'Marathon', desc: 'Cover 3 km in a single match' },
  ghost: { name: 'Ghost', desc: 'Survive a full match as a Shadow' },
  last_standing: { name: 'Last One Out', desc: 'Win Last Shadow Standing' },
  outbreak: { name: 'Outbreak', desc: 'Win Infection as the horde' },
  squad_goals: { name: 'Squad Goals', desc: 'Win Team vs Team' },
  zone_master: { name: 'Zone Master', desc: 'Win Battle Royale' },
  clean_play: { name: 'Clean Signal', desc: 'Win with zero GPS anomalies' },
  veteran: { name: 'Veteran', desc: 'Play 10 matches' },
  champion: { name: 'Champion', desc: 'Win 10 matches' },
};
