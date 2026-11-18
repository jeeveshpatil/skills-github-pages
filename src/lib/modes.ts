import type { Mode, Room, Rules, Team } from './types';

export interface ModeInfo {
  id: Mode; name: string; tag: string; blurb: string; teams: [Team, Team];
  preset: Partial<Room> & { rules?: Rules };
}

export const MODES: ModeInfo[] = [
  {
    id: 'classic', name: 'Classic Hunt', tag: 'CLS', teams: ['hunter', 'shadow'],
    blurb: 'Hunters track Shadows through timed, blurred location pings. Survive the clock or get caught.',
    preset: { reveal_interval_s: 180, zone_start_m: 800, zone_end_m: 300, zone_steps: 3, rules: { zone_elimination: false } },
  },
  {
    id: 'battle_royale', name: 'Battle Royale', tag: 'BR', teams: ['hunter', 'shadow'],
    blurb: 'An aggressive shrinking zone. Shadows caught outside it for too long are eliminated.',
    preset: { reveal_interval_s: 120, zone_start_m: 1000, zone_end_m: 80, zone_steps: 6, zone_grace_s: 45, rules: { zone_elimination: true } },
  },
  {
    id: 'team_vs_team', name: 'Team vs Team', tag: 'TVT', teams: ['red', 'blue'],
    blurb: 'Red vs Blue. Everyone hunts, everyone hides. Wipe the other squad or outlast them.',
    preset: { reveal_interval_s: 150, zone_start_m: 700, zone_end_m: 200, zone_steps: 4, rules: { reveal_hunters: true } },
  },
  {
    id: 'infection', name: 'Infection', tag: 'INF', teams: ['hunter', 'shadow'],
    blurb: 'One patient zero. Every Shadow tagged turns Hunter. The horde grows until no one is left.',
    preset: { reveal_interval_s: 150, zone_start_m: 600, zone_end_m: 200, zone_steps: 4, rules: { zone_elimination: false } },
  },
  {
    id: 'last_shadow', name: 'Last Shadow Standing', tag: 'LSS', teams: ['hunter', 'shadow'],
    blurb: 'Every Shadow for themselves. The final survivor takes the win alone.',
    preset: { reveal_interval_s: 120, zone_start_m: 800, zone_end_m: 120, zone_steps: 5, rules: { zone_elimination: true } },
  },
];

export const modeInfo = (m: Mode) => MODES.find((x) => x.id === m) ?? MODES[0];

export const TEAM_META: Record<Team, { label: string; color: string; short: string }> = {
  hunter: { label: 'Hunters', short: 'HNT', color: '#ff4d6d' },
  shadow: { label: 'Shadows', short: 'SHD', color: '#2dffa0' },
  red: { label: 'Red Squad', short: 'RED', color: '#ff5a5a' },
  blue: { label: 'Blue Squad', short: 'BLU', color: '#4da3ff' },
  spectator: { label: 'Spectators', short: 'SPC', color: '#8b98a5' },
};

export function isPrey(mode: Mode, team: Team | null): boolean {
  return mode === 'team_vs_team' ? team === 'red' || team === 'blue' : team === 'shadow';
}
export function canTag(mode: Mode, tagger: Team | null, target: Team | null): boolean {
  if (mode === 'team_vs_team') return (tagger === 'red' || tagger === 'blue') && (target === 'red' || target === 'blue') && tagger !== target;
  return tagger === 'hunter' && target === 'shadow';
}

export function winnerLabel(room: Pick<Room, 'winner' | 'mode'>): string {
  switch (room.winner) {
    case 'hunter': return room.mode === 'infection' ? 'The infection wins' : 'Hunters win';
    case 'shadow': return room.mode === 'last_shadow' ? 'Last Shadow standing' : 'Shadows survive';
    case 'red': return 'Red Squad wins';
    case 'blue': return 'Blue Squad wins';
    case 'draw': return 'Draw';
    case 'aborted': return 'Match aborted';
    default: return 'Match over';
  }
}
