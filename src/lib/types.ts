export type Mode = 'classic' | 'battle_royale' | 'team_vs_team' | 'infection' | 'last_shadow';
export type RoomStatus = 'lobby' | 'headstart' | 'active' | 'paused' | 'ended';
export type Team = 'hunter' | 'shadow' | 'red' | 'blue' | 'spectator';
export type PlayerStatus = 'alive' | 'captured' | 'eliminated' | 'left';

export interface SafeZone { name: string; lat: number; lng: number; r: number }

export interface Rules {
  capture_confirm?: boolean;
  zone_elimination?: boolean;
  reveal_hunters?: boolean;
  proximity_alerts?: boolean;
  disconnect_elim_s?: number;
  self_team_pick?: boolean;
  spectators_allowed?: boolean;
  flag_threshold?: number;
  referee_live?: boolean;
  record_replay?: boolean;
  voice_enabled?: boolean;
}

export interface Room {
  id: string; code: string; host_id: string; name: string; mode: Mode; status: RoomStatus;
  is_public: boolean; max_players: number; head_start_s: number; duration_s: number;
  reveal_interval_s: number; location_interval_s: number; reveal_blur_m: number; tag_radius_m: number;
  zone_lat: number | null; zone_lng: number | null; zone_start_m: number; zone_end_m: number;
  zone_steps: number; zone_grace_s: number; max_speed_mps: number; safe_zones: SafeZone[]; rules: Rules;
  map_id: string | null; tournament_id: string | null; initial_prey: number;
  started_at: string | null; headstart_ends_at: string | null; ends_at: string | null;
  paused_at: string | null; paused_by: string | null; ended_at: string | null; last_reveal_at: string | null;
  winner: string | null; winner_player: string | null; created_at: string;
}

export interface Player {
  room_id: string; user_id: string; display_name: string; team: Team | null; status: PlayerStatus;
  ready: boolean; joined_at: string; last_seen_at: string; captured_at: string | null; captured_by: string | null;
  captures: number; score: number; distance_m: number; out_of_zone_since: string | null; flags: number;
}

export interface Position {
  room_id: string; user_id: string; lat: number; lng: number; accuracy: number | null;
  heading: number | null; speed: number | null; suspect: boolean; updated_at: string;
}

export interface Reveal { id: number; room_id: string; user_id: string; team: Team; lat: number; lng: number; radius_m: number; stale: boolean; created_at: string }
export interface Capture { id: number; room_id: string; hunter_id: string; target_id: string; distance_m: number; status: 'pending' | 'disputed' | 'confirmed' | 'rejected'; created_at: string; resolved_at: string | null }
export interface GameEvent { id: number; room_id: string; type: string; actor: string | null; target: string | null; payload: Record<string, unknown>; created_at: string }
export interface Anomaly { id: number; room_id: string; user_id: string; kind: string; speed_mps: number | null; distance_m: number | null; created_at: string }
export interface Profile { id: string; username: string; xp: number; matches_played: number; wins: number; total_captures: number; total_distance_m: number; location_consent_at: string | null; created_at: string }
export interface MatchResult { room_id: string; user_id: string; team: Team; won: boolean; xp: number; captures: number; survived_s: number; distance_m: number; created_at: string }
export interface GameMap { id: string; owner_id: string; name: string; center_lat: number; center_lng: number; radius_m: number; safe_zones: SafeZone[]; is_public: boolean; created_at: string }
export interface Tournament { id: string; owner_id: string; name: string; status: 'open' | 'closed'; created_at: string }

export interface LocationFeedback {
  status?: RoomStatus; throttled?: boolean; suspect?: boolean; zone_radius?: number; zone_dist?: number;
  outside?: boolean; in_safe_zone?: boolean; proximity?: 'danger' | 'close' | 'near' | 'far' | null;
}
