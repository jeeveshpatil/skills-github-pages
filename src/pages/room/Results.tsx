import { useEffect, useMemo, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import type { RoomProps } from '../Room';
import { GameMap, type MapMarker, type MapTrack } from '../../components/GameMap';
import { Button, Panel, TeamBadge, errMsg, useToast } from '../../components/ui';
import { Logo } from '../../components/Logo';
import { api } from '../../lib/api';
import { supabase } from '../../lib/supabase';
import { formatClock, formatDistance } from '../../lib/geo';
import { TEAM_META, modeInfo, winnerLabel } from '../../lib/modes';
import { ACHIEVEMENTS } from '../../lib/ranks';
import { describeEvent, toneClass } from '../../lib/events';
import type { MatchResult } from '../../lib/types';

type Pt = { user_id: string; lat: number; lng: number; recorded_at: string };

export default function Results({ room: r, players, events, uid }: RoomProps) {
  const room = r!;
  const nav = useNavigate();
  const toast = useToast();
  const [results, setResults] = useState<MatchResult[]>([]);
  const [history, setHistory] = useState<Pt[]>([]);
  const [newAch, setNewAch] = useState<string[]>([]);
  const [t, setT] = useState(1);
  const [playing, setPlaying] = useState(false);
  const isHost = room.host_id === uid;
  const nameOf = (id: string | null) => players.find((p) => p.user_id === id)?.display_name ?? 'Unknown';
  const teamOf = (id: string) => results.find((x) => x.user_id === id)?.team ?? players.find((p) => p.user_id === id)?.team ?? 'spectator';

  useEffect(() => {
    supabase.from('match_results').select('*').eq('room_id', room.id).then(({ data }) => setResults((data ?? []) as MatchResult[]));
    // page through history (replay tracks)
    (async () => {
      const all: Pt[] = [];
      for (let from = 0; from < 20000; from += 1000) {
        const { data } = await supabase.from('location_history').select('user_id,lat,lng,recorded_at').eq('room_id', room.id).order('recorded_at').range(from, from + 999);
        all.push(...((data ?? []) as Pt[]));
        if (!data || data.length < 1000) break;
      }
      setHistory(all);
    })();
    if (room.ended_at) {
      supabase.from('achievements').select('code').eq('user_id', uid).gte('unlocked_at', new Date(Date.parse(room.ended_at) - 5000).toISOString())
        .then(({ data }) => setNewAch((data ?? []).map((a) => a.code)));
    }
  }, [room.id, room.ended_at, uid]);

  // ---- replay timeline
  const t0 = history.length ? Date.parse(history[0].recorded_at) : 0;
  const t1 = history.length ? Date.parse(history[history.length - 1].recorded_at) : 0;
  const at = t0 + (t1 - t0) * t;
  useEffect(() => {
    if (!playing) return;
    const id = setInterval(() => setT((v) => { if (v >= 1) { setPlaying(false); return 1; } return Math.min(1, v + 0.004); }), 50);
    return () => clearInterval(id);
  }, [playing]);

  const { tracks, markers } = useMemo(() => {
    const by = new Map<string, Pt[]>();
    for (const p of history) { if (Date.parse(p.recorded_at) > at) continue; (by.get(p.user_id) ?? by.set(p.user_id, []).get(p.user_id)!).push(p); }
    const tracks: MapTrack[] = []; const markers: MapMarker[] = [];
    for (const [id, pts] of by) {
      const color = TEAM_META[teamOf(id) ?? 'spectator'].color;
      tracks.push({ id, color, coords: pts.map((p) => [p.lng, p.lat]) });
      const last = pts[pts.length - 1];
      markers.push({ id, lat: last.lat, lng: last.lng, color, kind: 'ally', label: nameOf(id) });
    }
    return { tracks, markers };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [history, at, results]);

  const mine = results.find((x) => x.user_id === uid);
  const sorted = [...results].sort((a, b) => Number(b.won) - Number(a.won) || b.xp - a.xp);
  const maxDist = Math.max(1, ...results.map((x) => x.distance_m));
  const timeline = events.filter((e) => ['capture_confirmed', 'infected', 'zone_eliminated', 'disconnect_eliminated', 'hunt_started', 'emergency_stop', 'match_ended'].includes(e.type));
  const zone = room.zone_lat != null && room.zone_lng != null ? { lat: room.zone_lat, lng: room.zone_lng, radius: room.zone_start_m, next: room.zone_end_m, nextLat: room.zone_end_lat ?? undefined, nextLng: room.zone_end_lng ?? undefined } : null;
  const dur = room.ended_at && room.headstart_ends_at ? Date.parse(room.ended_at) - Date.parse(room.headstart_ends_at) : 0;

  const rematch = async () => {
    try { nav(`/room/${await api.rematch(room.id)}`); } catch (e) { toast(errMsg(e), 'error'); }
  };

  return (
    <div className="min-h-full bg-grid pb-16">
      <header className="border-b border-line bg-ink/80 backdrop-blur safe-top">
        <div className="max-w-6xl mx-auto px-4 h-14 flex items-center justify-between">
          <Link to="/"><Logo size={24} /></Link>
          <span className="font-mono text-xs text-mute">DEBRIEF · {room.code}</span>
        </div>
      </header>
      <main className="max-w-6xl mx-auto px-4 py-6 space-y-4">
        <section className="relative panel brackets chamfer p-6 sm:p-8 overflow-hidden scan">
          <div className="label">{modeInfo(room.mode).name} · {room.name} · {formatClock(Math.max(0, dur))} of hunting</div>
          <h1 className={`text-4xl sm:text-6xl font-bold mt-2 ${room.winner === 'aborted' ? 'text-mute' : 'text-neon glow'}`}>{winnerLabel(room)}</h1>
          {room.winner_player && <p className="text-xl text-white mt-1">{nameOf(room.winner_player)} is the last one standing</p>}
          {mine && (
            <div className="mt-5 flex flex-wrap items-center gap-3">
              <span className={`font-display text-2xl ${mine.won ? 'text-neon' : 'text-danger'}`}>{mine.won ? 'VICTORY' : 'DEFEAT'}</span>
              <span className="font-mono text-cyan">+{mine.xp} XP</span>
              {newAch.map((c) => <span key={c} className="font-mono text-[11px] px-2 py-1 border border-amber/60 text-amber bg-amber/10">★ {ACHIEVEMENTS[c]?.name ?? c}</span>)}
            </div>
          )}
          <div className="flex flex-wrap gap-2 mt-6">
            {isHost && <Button onClick={rematch}>Rematch</Button>}
            <Button variant="ghost" onClick={() => nav('/')}>Back to base</Button>
          </div>
        </section>

        <div className="grid lg:grid-cols-[1.3fr_1fr] gap-4">
          <Panel title="Replay" right={<span className="font-mono text-[10px] text-mute">{history.length} track points</span>}>
            <div className="relative h-80 sm:h-[420px] chamfer-sm overflow-hidden border border-line">
              <GameMap zone={zone} boundary={room.boundary} safeZones={room.safe_zones} tracks={tracks} markers={markers} fitKey={room.id} center={zone ? [zone.lat, zone.lng] : null} />
              {history.length === 0 && <div className="absolute inset-0 grid place-items-center pointer-events-none"><span className="font-mono text-xs bg-ink/90 px-3 py-1.5 text-mute">No replay data (disabled or already purged)</span></div>}
            </div>
            {history.length > 0 && (
              <div className="flex items-center gap-3 mt-3">
                <Button size="sm" variant="cyan" onClick={() => { if (t >= 1) setT(0); setPlaying(!playing); }}>{playing ? 'Pause' : 'Play'}</Button>
                <input type="range" className="flex-1" min={0} max={1} step={0.001} value={t} onChange={(e) => { setPlaying(false); setT(Number(e.target.value)); }} />
                <span className="font-mono text-xs text-soft tabular-nums w-14 text-right">{formatClock(at - t0)}</span>
              </div>
            )}
          </Panel>

          <Panel title="Scoreboard">
            <ul className="space-y-1.5">
              {sorted.map((x, i) => (
                <li key={x.user_id} className={`flex items-center gap-2 px-2.5 py-2 chamfer-sm border ${x.user_id === uid ? 'border-cyan/50 bg-cyan/5' : 'border-line bg-ink-2'}`}>
                  <span className="font-mono text-xs text-mute w-4">{i + 1}</span>
                  <TeamBadge team={x.team} />
                  <Link to={`/profile/${x.user_id}`} className="flex-1 truncate text-white text-sm hover:text-neon">{nameOf(x.user_id)}</Link>
                  <span className="font-mono text-[11px] text-mute">{x.captures}⨯</span>
                  <span className={`font-mono text-[11px] w-10 text-right ${x.won ? 'text-neon' : 'text-danger'}`}>{x.won ? 'W' : 'L'}</span>
                  <span className="font-mono text-[11px] text-cyan w-12 text-right">+{x.xp}</span>
                </li>
              ))}
              {results.length === 0 && <li className="text-sm text-mute">{room.winner === 'aborted' ? 'Aborted matches award no XP.' : 'Tallying…'}</li>}
            </ul>
          </Panel>
        </div>

        <div className="grid lg:grid-cols-2 gap-4">
          <Panel title="Analytics · distance covered">
            <ul className="space-y-2">
              {[...results].sort((a, b) => b.distance_m - a.distance_m).map((x) => (
                <li key={x.user_id}>
                  <div className="flex justify-between text-xs"><span className="text-soft">{nameOf(x.user_id)}</span><span className="font-mono text-mute">{formatDistance(x.distance_m)} · survived {formatClock(x.survived_s * 1000)}</span></div>
                  <div className="h-1.5 bg-line mt-1"><div className="h-full" style={{ width: `${(x.distance_m / maxDist) * 100}%`, background: TEAM_META[x.team].color }} /></div>
                </li>
              ))}
            </ul>
          </Panel>
          <Panel title="Timeline">
            <ul className="space-y-1 font-mono text-xs max-h-64 overflow-auto">
              {timeline.map((e) => {
                const d = describeEvent(e, nameOf);
                const rel = room.headstart_ends_at ? Date.parse(e.created_at) - Date.parse(room.headstart_ends_at) : 0;
                return d && <li key={e.id} className="flex gap-3"><span className="text-mute tabular-nums w-12">{rel < 0 ? '-' : ''}{formatClock(Math.abs(rel))}</span><span className={toneClass[d.tone]}>{d.text}</span></li>;
              })}
            </ul>
          </Panel>
        </div>
      </main>
    </div>
  );
}
