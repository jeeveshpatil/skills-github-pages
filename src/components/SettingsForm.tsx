import { useEffect, useState } from 'react';
import { supabase } from '../lib/supabase';
import { MODES, modeInfo } from '../lib/modes';
import { formatDistance } from '../lib/geo';
import type { GameMap as GameMapT, LatLng, Mode, Room, Rules, SafeZone, Tournament } from '../lib/types';
import { useAuth } from '../hooks/useAuth';
import { GameMap } from './GameMap';
import { Button, Field, Panel, Slider, Toggle, inputCls } from './ui';

export interface Settings {
  name: string; mode: Mode; is_public: boolean; password: string; max_players: number;
  head_start_s: number; duration_s: number; reveal_interval_s: number; location_interval_s: number;
  reveal_blur_m: number; tag_radius_m: number; zone_lat: number | null; zone_lng: number | null;
  zone_start_m: number; zone_end_m: number; zone_steps: number; zone_grace_s: number; max_speed_mps: number;
  safe_zones: SafeZone[]; boundary: LatLng[] | null; rules: Rules; map_id: string | null; tournament_id: string | null; host_spectates: boolean;
}

export const defaultSettings = (): Settings => ({
  name: 'Night Op', mode: 'classic', is_public: false, password: '', max_players: 12,
  head_start_s: 120, duration_s: 1800, reveal_interval_s: 180, location_interval_s: 5,
  reveal_blur_m: 60, tag_radius_m: 15, zone_lat: null, zone_lng: null, zone_start_m: 800, zone_end_m: 300,
  zone_steps: 3, zone_grace_s: 60, max_speed_mps: 12, safe_zones: [], boundary: null, map_id: null, tournament_id: null, host_spectates: false,
  rules: { capture_confirm: true, zone_elimination: false, reveal_hunters: false, proximity_alerts: true, disconnect_elim_s: 300, self_team_pick: true, spectators_allowed: true, flag_threshold: 3, referee_live: true, record_replay: true, voice_enabled: true, zone_moves: false },
});

export function settingsFromRoom(r: Room): Settings {
  const d = defaultSettings();
  return { ...d, ...r, password: '', host_spectates: false, rules: { ...d.rules, ...r.rules } } as Settings;
}

const mins = (s: number) => (s >= 3600 ? `${(s / 3600).toFixed(s % 3600 ? 1 : 0)} h` : s >= 60 ? `${Math.round(s / 60)} min` : `${s}s`);

/** Full match configuration. Used for room creation and for the host editing a lobby. */
export function SettingsForm({ initial, onSubmit, submitLabel, busy, lobby }: {
  initial: Settings; onSubmit: (s: Settings) => void; submitLabel: string; busy?: boolean; lobby?: boolean;
}) {
  const { session } = useAuth();
  const [s, setS] = useState<Settings>(initial);
  const [pickMode, setPickMode] = useState<'center' | 'safe' | 'boundary'>('center');
  const [maps, setMaps] = useState<GameMapT[]>([]);
  const [tours, setTours] = useState<Tournament[]>([]);
  const [fit, setFit] = useState(0);
  const set = <K extends keyof Settings>(k: K, v: Settings[K]) => setS((x) => ({ ...x, [k]: v }));
  const rule = <K extends keyof Rules>(k: K, v: Rules[K]) => setS((x) => ({ ...x, rules: { ...x.rules, [k]: v } }));

  useEffect(() => {
    supabase.from('maps').select('*').order('created_at', { ascending: false }).limit(50).then(({ data }) => setMaps((data ?? []) as GameMapT[]));
    if (session) supabase.from('tournaments').select('*').eq('owner_id', session.user.id).eq('status', 'open').then(({ data }) => setTours((data ?? []) as Tournament[]));
  }, [session]);

  const chooseMode = (m: Mode) => {
    const p = modeInfo(m).preset;
    setS((x) => ({ ...x, mode: m, ...p, rules: { ...x.rules, ...p.rules } } as Settings));
  };

  const useMyLocation = () => navigator.geolocation?.getCurrentPosition(
    (p) => { setS((x) => ({ ...x, zone_lat: p.coords.latitude, zone_lng: p.coords.longitude })); setFit((f) => f + 1); },
    () => {}, { enableHighAccuracy: true, timeout: 10000 },
  );

  const applyMap = (id: string) => {
    const m = maps.find((x) => x.id === id);
    if (!m) return set('map_id', null);
    setS((x) => ({ ...x, map_id: m.id, zone_lat: m.center_lat, zone_lng: m.center_lng, zone_start_m: m.radius_m, zone_end_m: Math.min(x.zone_end_m, m.radius_m), safe_zones: m.safe_zones, boundary: m.boundary }));
    setFit((f) => f + 1);
  };

  const onMapClick = (lat: number, lng: number) => {
    if (pickMode === 'center') setS((x) => ({ ...x, zone_lat: lat, zone_lng: lng }));
    else if (pickMode === 'boundary') setS((x) => ({ ...x, boundary: [...(x.boundary ?? []), { lat, lng }].slice(0, 50) }));
    else if (s.safe_zones.length < 10) set('safe_zones', [...s.safe_zones, { name: `Safe ${s.safe_zones.length + 1}`, lat, lng, r: 25 }]);
  };

  const hasZone = s.zone_lat != null && s.zone_lng != null;

  return (
    <form className="space-y-4" onSubmit={(e) => { e.preventDefault(); onSubmit(s); }}>
      <Panel title="01 · Game mode">
        <div className="grid grid-cols-2 lg:grid-cols-5 gap-2">
          {MODES.map((m) => (
            <button type="button" key={m.id} onClick={() => chooseMode(m.id)}
              className={`chamfer-sm text-left p-3 border transition-colors ${s.mode === m.id ? 'border-neon bg-neon/10' : 'border-line hover:border-line-2 bg-ink-2'}`}>
              <span className={`font-mono text-[10px] ${s.mode === m.id ? 'text-neon' : 'text-mute'}`}>{m.tag}</span>
              <span className="block font-display text-white text-sm mt-1">{m.name}</span>
            </button>
          ))}
        </div>
        <p className="text-sm text-mute mt-3">{modeInfo(s.mode).blurb}</p>
      </Panel>

      <div className="grid lg:grid-cols-[1.25fr_1fr] gap-4">
        <Panel title="02 · Arena" right={
          <div className="flex gap-1">
            {(['center', 'safe', 'boundary'] as const).map((k) => (
              <button type="button" key={k} onClick={() => setPickMode(k)} className={`font-mono text-[10px] px-2 py-1 border ${pickMode === k ? 'border-cyan text-cyan' : 'border-line text-mute'}`}>
                {k === 'center' ? 'CENTRE' : k === 'safe' ? 'SAFE ZONE' : 'BOUNDARY'}
              </button>
            ))}
          </div>
        }>
          <div className="relative h-72 sm:h-80 chamfer-sm overflow-hidden border border-line">
            <GameMap
              center={hasZone ? [s.zone_lat!, s.zone_lng!] : null}
              zone={hasZone ? { lat: s.zone_lat!, lng: s.zone_lng!, radius: s.zone_start_m, next: s.zone_end_m } : null}
              safeZones={s.safe_zones}
              boundary={s.boundary}
              markers={hasZone ? [{ id: 'c', lat: s.zone_lat!, lng: s.zone_lng!, color: '#2dffa0', kind: 'pin' }] : []}
              onClick={onMapClick}
              fitKey={fit}
            />
            {pickMode === 'boundary' && <div className="absolute inset-x-0 top-3 text-center pointer-events-none"><span className="font-mono text-[10px] bg-ink/90 px-2 py-1 text-amber">Tap to add boundary corners (min 3)</span></div>}
            {!hasZone && <div className="absolute inset-x-0 bottom-3 text-center pointer-events-none"><span className="font-mono text-xs bg-ink/90 px-3 py-1.5 text-cyan">Tap the map or use your location to place the zone</span></div>}
          </div>
          <div className="flex flex-wrap gap-2 mt-3">
            <Button type="button" size="sm" variant="ghost" onClick={useMyLocation}>Use my location</Button>
            {maps.length > 0 && (
              <select className={`${inputCls} !h-8 !w-auto text-xs`} value={s.map_id ?? ''} onChange={(e) => applyMap(e.target.value)}>
                <option value="">Load saved map…</option>
                {maps.map((m) => <option key={m.id} value={m.id}>{m.name}{m.is_public ? ' (public)' : ''}</option>)}
              </select>
            )}
            {s.safe_zones.length > 0 && <Button type="button" size="sm" variant="subtle" onClick={() => set('safe_zones', [])}>Clear {s.safe_zones.length} safe zones</Button>}
            {(s.boundary?.length ?? 0) > 0 && <Button type="button" size="sm" variant="subtle" onClick={() => set('boundary', null)}>Clear boundary ({s.boundary!.length} pts)</Button>}
          </div>
          <div className="grid sm:grid-cols-2 gap-4 mt-4">
            <Slider label="Start radius" value={s.zone_start_m} min={100} max={5000} step={50} onChange={(v) => setS((x) => ({ ...x, zone_start_m: v, zone_end_m: Math.min(x.zone_end_m, v) }))} format={formatDistance} />
            <Slider label="Final radius" value={s.zone_end_m} min={20} max={s.zone_start_m} step={10} onChange={(v) => set('zone_end_m', v)} format={formatDistance} />
            <Slider label="Shrink steps" value={s.zone_steps} min={0} max={10} onChange={(v) => set('zone_steps', v)} format={(v) => (v === 0 ? 'Continuous' : `${v} steps`)} />
            <div className="sm:col-span-2 -my-2"><Toggle label="Moving zone" desc="The circle drifts to a random final position as it shrinks" checked={!!s.rules.zone_moves} onChange={(v) => rule('zone_moves', v)} /></div>
            <Slider label="Out-of-zone grace" value={s.zone_grace_s} min={0} max={300} step={15} onChange={(v) => set('zone_grace_s', v)} format={mins} />
          </div>
        </Panel>

        <div className="space-y-4">
          <Panel title="03 · Timing">
            <div className="space-y-4">
              <Slider label="Head start" value={s.head_start_s} min={0} max={900} step={30} onChange={(v) => set('head_start_s', v)} format={mins} />
              <Slider label="Match duration" value={s.duration_s} min={300} max={10800} step={300} onChange={(v) => set('duration_s', v)} format={mins} />
              <Slider label="Location reveal every" value={s.reveal_interval_s} min={30} max={900} step={30} onChange={(v) => set('reveal_interval_s', v)} format={mins} />
              <Slider label="GPS update interval" value={s.location_interval_s} min={2} max={30} onChange={(v) => set('location_interval_s', v)} format={(v) => `${v}s`} />
            </div>
          </Panel>
          <Panel title="04 · Engagement">
            <div className="space-y-4">
              <Slider label="Tag radius" value={s.tag_radius_m} min={3} max={50} onChange={(v) => set('tag_radius_m', v)} format={(v) => `${v} m`} />
              <Slider label="Reveal blur" value={s.reveal_blur_m} min={0} max={300} step={10} onChange={(v) => set('reveal_blur_m', v)} format={(v) => `±${v} m`} />
              <Slider label="Max players" value={s.max_players} min={2} max={50} onChange={(v) => set('max_players', v)} />
            </div>
          </Panel>
        </div>
      </div>

      <div className="grid lg:grid-cols-2 gap-4">
        <Panel title="05 · Rules">
          <div className="divide-y divide-line">
            <Toggle label="Capture confirmation" desc="Target confirms or disputes; auto-confirms after 30s" checked={!!s.rules.capture_confirm} onChange={(v) => rule('capture_confirm', v)} />
            <Toggle label="Zone elimination" desc="Out of zone past the grace period = eliminated" checked={!!s.rules.zone_elimination} onChange={(v) => rule('zone_elimination', v)} />
            <Toggle label="Reveal hunters too" desc="Shadows also receive blurred hunter pings" checked={!!s.rules.reveal_hunters} onChange={(v) => rule('reveal_hunters', v)} />
            <Toggle label="Proximity alerts" desc="Coarse 'enemy nearby' bands — never coordinates" checked={!!s.rules.proximity_alerts} onChange={(v) => rule('proximity_alerts', v)} />
            <Toggle label="Players pick their own team" checked={!!s.rules.self_team_pick} onChange={(v) => rule('self_team_pick', v)} />
            <Toggle label="Team voice chat" checked={!!s.rules.voice_enabled} onChange={(v) => rule('voice_enabled', v)} />
            <Toggle label="Record replay tracks" desc="Kept 48h, visible to players after the match" checked={!!s.rules.record_replay} onChange={(v) => rule('record_replay', v)} />
          </div>
          <div className="grid grid-cols-2 gap-4 mt-3">
            <Slider label="Offline elimination" value={s.rules.disconnect_elim_s ?? 300} min={0} max={900} step={60} onChange={(v) => rule('disconnect_elim_s', v)} format={(v) => (v ? mins(v) : 'Off')} />
            <Slider label="Anti-cheat speed cap" value={s.max_speed_mps} min={4} max={40} onChange={(v) => set('max_speed_mps', v)} format={(v) => `${Math.round(v * 3.6)} km/h`} />
          </div>
        </Panel>
        <Panel title="06 · Access">
          <div className="space-y-4">
            <Field label="Operation name"><input className={inputCls} maxLength={40} value={s.name} onChange={(e) => set('name', e.target.value)} /></Field>
            <Toggle label="Public matchmaking" desc="Listed for anyone to join (rooms with passwords are never listed)" checked={s.is_public} onChange={(v) => set('is_public', v)} />
            <Field label="Room password" hint={lobby ? 'leave blank to keep' : 'optional'}>
              <input className={inputCls} type="password" autoComplete="new-password" value={s.password} onChange={(e) => set('password', e.target.value)} />
            </Field>
            <Toggle label="Allow spectators" checked={!!s.rules.spectators_allowed} onChange={(v) => rule('spectators_allowed', v)} />
            {!lobby && <Toggle label="I'm the referee (don't play)" desc="Referee host sees live positions on the dashboard" checked={s.host_spectates} onChange={(v) => set('host_spectates', v)} />}
            {!lobby && tours.length > 0 && (
              <Field label="Tournament">
                <select className={inputCls} value={s.tournament_id ?? ''} onChange={(e) => set('tournament_id', e.target.value || null)}>
                  <option value="">None</option>
                  {tours.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
                </select>
              </Field>
            )}
          </div>
        </Panel>
      </div>

      <div className="sticky bottom-20 md:bottom-4 z-20">
        <Button type="submit" size="lg" className="w-full" loading={busy}>{submitLabel}</Button>
      </div>
    </form>
  );
}

/** Convert form state to the JSON accepted by the create_room / update_settings RPCs. */
export function toPayload(s: Settings, lobby = false): Record<string, unknown> {
  const { password, host_spectates, ...rest } = s;
  const out: Record<string, unknown> = { ...rest };
  if (!lobby || password) out.password = password;
  if (!lobby) out.host_spectates = host_spectates;
  if (lobby) delete out.tournament_id;
  return out;
}
