import type { GameEvent } from './types';

/** Human-readable event line, or null for events that shouldn't be shown in feeds. */
export function describeEvent(e: GameEvent, name: (id: string | null) => string): { text: string; tone: 'info' | 'good' | 'bad' | 'warn' } | null {
  const a = name(e.actor), t = name(e.target);
  switch (e.type) {
    case 'player_joined': return { text: `${a} joined${e.payload.spectator ? ' as spectator' : ''}`, tone: 'info' };
    case 'player_reconnected': return { text: `${a} reconnected`, tone: 'info' };
    case 'player_left': return { text: `${a} left`, tone: 'warn' };
    case 'player_kicked': return { text: `${t} was removed by the host`, tone: 'warn' };
    case 'host_changed': return { text: `${t} is now host`, tone: 'info' };
    case 'teams_shuffled': return { text: 'Teams shuffled', tone: 'info' };
    case 'match_started': return { text: 'Match started — head start running', tone: 'good' };
    case 'hunt_started': return { text: 'The hunt is on', tone: 'bad' };
    case 'reveal': return { text: 'Location reveal broadcast', tone: 'warn' };
    case 'capture_pending': return { text: `${a} tagged ${t} — awaiting confirmation`, tone: 'warn' };
    case 'capture_confirmed': return { text: `${a} captured ${t}`, tone: 'bad' };
    case 'capture_disputed': return { text: `${a} disputes the tag — host to resolve`, tone: 'warn' };
    case 'capture_rejected': return { text: `Tag on ${t} rejected`, tone: 'info' };
    case 'infected': return { text: `${t} was infected by ${a}`, tone: 'bad' };
    case 'zone_warning': return { text: `${t} is outside the zone`, tone: 'warn' };
    case 'zone_eliminated': return { text: `${t} was eliminated by the zone`, tone: 'bad' };
    case 'disconnect_eliminated': return { text: `${t} went dark too long — eliminated`, tone: 'bad' };
    case 'anomaly_flag': return { text: `GPS anomalies flagged for ${t}`, tone: 'warn' };
    case 'emergency_stop': return { text: `SOS from ${a}${e.payload.reason ? `: ${e.payload.reason}` : ''} — match paused`, tone: 'bad' };
    case 'resumed': return { text: 'Match resumed', tone: 'good' };
    case 'match_ended': return { text: 'Match over', tone: 'good' };
    case 'rematch': return { text: `Rematch lobby ${String(e.payload.code)} opened`, tone: 'good' };
    default: return null;
  }
}

export const toneClass = { info: 'text-cyan', good: 'text-neon', bad: 'text-danger', warn: 'text-amber' } as const;
