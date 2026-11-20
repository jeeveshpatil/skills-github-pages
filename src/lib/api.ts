import { CapacitorHttp } from '@capacitor/core';
import { supabase, supabaseUrl, supabaseKey } from './supabase';
import { isNative } from './native';
import type { LocationFeedback } from './types';

async function rpc<T = unknown>(fn: string, args: Record<string, unknown> = {}): Promise<T> {
  const { data, error } = await supabase.rpc(fn, args);
  if (error) throw new Error(error.message);
  return data as T;
}

/**
 * Native apps: send through the OS HTTP stack (CapacitorHttp). Android throttles WebView requests after
 * ~5 minutes in the background, which would freeze a player's position mid-match.
 */
async function nativeRpc<T>(fn: string, args: Record<string, unknown>): Promise<T> {
  const { data: s } = await supabase.auth.getSession();
  const res = await CapacitorHttp.post({
    url: `${supabaseUrl}/rest/v1/rpc/${fn}`,
    headers: { apikey: supabaseKey, Authorization: `Bearer ${s.session?.access_token ?? supabaseKey}`, 'Content-Type': 'application/json' },
    data: args,
  });
  if (res.status >= 400) throw new Error((res.data && (res.data.message as string)) || `HTTP ${res.status}`);
  return res.data as T;
}

/** Thin, typed wrappers around the server-side game engine (supabase/migrations/*_game_engine.sql). */
export const api = {
  createRoom: (settings: Record<string, unknown>, displayName?: string) =>
    rpc<string>('create_room', { p_settings: settings, p_display_name: displayName ?? null }),
  updateSettings: (room: string, settings: Record<string, unknown>) => rpc('update_settings', { p_room: room, p_settings: settings }),
  joinRoom: (code: string, opts: { password?: string; displayName?: string; spectator?: boolean } = {}) =>
    rpc<string>('join_room', { p_code: code, p_password: opts.password || null, p_display_name: opts.displayName || null, p_spectator: !!opts.spectator }),
  listPublicRooms: () => rpc<{ id: string; code: string; name: string; mode: string; max_players: number; players: number; host_name: string; has_zone: boolean; created_at: string }[]>('list_public_rooms'),
  quickMatch: (mode?: string, displayName?: string) => rpc<string | null>('quick_match', { p_mode: mode ?? null, p_display_name: displayName ?? null }),
  setReady: (room: string, ready: boolean) => rpc('set_ready', { p_room: room, p_ready: ready }),
  setTeam: (room: string, user: string, team: string | null) => rpc('set_team', { p_room: room, p_user: user, p_team: team }),
  shuffleTeams: (room: string) => rpc('shuffle_teams', { p_room: room }),
  kick: (room: string, user: string) => rpc('kick_player', { p_room: room, p_user: user }),
  transferHost: (room: string, user: string) => rpc('transfer_host', { p_room: room, p_user: user }),
  leave: (room: string) => rpc('leave_room', { p_room: room }),
  start: (room: string) => rpc('start_match', { p_room: room }),
  end: (room: string) => rpc('end_match', { p_room: room }),
  emergencyStop: (room: string, reason?: string) => rpc('emergency_stop', { p_room: room, p_reason: reason ?? null }),
  resume: (room: string) => rpc('resume_match', { p_room: room }),
  tag: (room: string, target: string) => rpc<{ ok: boolean; reason?: string; capture_id?: number }>('tag_player', { p_room: room, p_target: target }),
  respondCapture: (id: number, accept: boolean) => rpc('respond_capture', { p_capture: id, p_accept: accept }),
  resolveCapture: (id: number, accept: boolean) => rpc('resolve_capture', { p_capture: id, p_accept: accept }),
  tick: (room: string) => rpc<{ status?: string; zone_radius?: number }>('tick', { p_room: room }),
  updateLocation: (room: string, c: { lat: number; lng: number; accuracy?: number | null; heading?: number | null; speed?: number | null }) => {
    const args = { p_room: room, p_lat: c.lat, p_lng: c.lng, p_accuracy: c.accuracy ?? null, p_heading: c.heading ?? null, p_speed: c.speed ?? null };
    return isNative ? nativeRpc<LocationFeedback>('update_location', args) : rpc<LocationFeedback>('update_location', args);
  },
  reportMockLocation: (room: string) => rpc('report_mock_location', { p_room: room }),
  heartbeat: (room: string) => rpc('heartbeat', { p_room: room }),
  createTournament: (name: string) => rpc<string>('create_tournament', { p_name: name }),
  closeTournament: (id: string) => rpc('close_tournament', { p_id: id }),
  tournamentStandings: (id: string) => rpc<{ user_id: string; username: string; matches: number; wins: number; captures: number; points: number }[]>('tournament_standings', { p_id: id }),
  tournamentMatches: (id: string) => rpc<{ id: string; name: string; mode: string; status: string; winner: string | null; ended_at: string | null; players: number }[]>('tournament_matches', { p_id: id }),
  rematch: (room: string) => rpc<string>('rematch', { p_room: room }),
  joinRematch: (oldRoom: string, code: string) => rpc<string>('join_rematch', { p_old_room: oldRoom, p_code: code }),
  deleteMyLocationData: () => rpc('delete_my_location_data'),
};
