import { useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { useRoom } from '../hooks/useRoom';
import { useAuth } from '../hooks/useAuth';
import { useNow } from '../hooks/useNow';
import { GameMap, type MapCircle, type MapMarker } from '../components/GameMap';
import { Button, Panel, Spinner, TeamBadge, errMsg, useToast } from '../components/ui';
import { Logo } from '../components/Logo';
import { api } from '../lib/api';
import { supabase } from '../lib/supabase';
import { formatClock, formatDistance, zoneCenterAt, zoneRadiusAt } from '../lib/geo';
import { TEAM_META, modeInfo } from '../lib/modes';
import { describeEvent, toneClass } from '../lib/events';
import type { Anomaly, Reveal } from '../lib/types';

/** Desktop command centre for the host: live map, roster with controls, disputes, anti-cheat, stats. */
export default function HostDashboard() {
  const { id } = useParams();
  const { session } = useAuth();
  const toast = useToast();
  const s = useRoom(id);
  const now = useNow(1000);
  const [anoms, setAnoms] = useState<Anomaly[]>([]);
  const uid = session!.user.id;

  useEffect(() => {
    if (!id) return;
    const load = () => supabase.from('anomalies').select('*').eq('room_id', id).order('id', { ascending: false }).limit(100).then(({ data }) => setAnoms((data ?? []) as Anomaly[]));
    load();
    const t = setInterval(load, 10000);
    return () => clearInterval(t);
  }, [id]);

  if (s.loading) return <div className="h-full grid place-items-center"><Spinner label="Opening command centre" /></div>;
  if (!s.room) return <div className="p-6 text-danger font-mono">{s.error}</div>;
  const room = s.room;
  if (room.host_id !== uid) return <div className="p-6"><p className="text-danger font-mono">Host only.</p><Link to={`/room/${room.id}`} className="text-cyan">Back to room</Link></div>;

  const run = (fn: () => Promise<unknown>) => fn().catch((e) => toast(errMsg(e), 'error'));
  const nameOf = (pid: string | null) => s.players.find((p) => p.user_id === pid)?.display_name ?? '—';
  const live = ['headstart', 'active', 'paused'].includes(room.status);
  const t = room.status === 'paused' && room.paused_at ? Date.parse(room.paused_at) : now;
  const radius = zoneRadiusAt(room, t);
  const hsEnd = Date.parse(room.headstart_ends_at ?? '') || 0;
  const end = Date.parse(room.ends_at ?? '') || 0;
  const zc = zoneCenterAt(room, t);
  const zone = zc ? { ...zc, radius } : null;
  const mi = modeInfo(room.mode);

  const latest = new Map<string, Reveal>();
  s.reveals.forEach((r) => latest.set(r.user_id, r));
  const markers: MapMarker[] = []; const circles: MapCircle[] = [];
  for (const p of Object.values(s.positions)) {
    const pl = s.players.find((x) => x.user_id === p.user_id);
    if (!pl) continue;
    markers.push({ id: `p${p.user_id}`, lat: p.lat, lng: p.lng, kind: p.user_id === uid ? 'me' : 'ally', color: TEAM_META[pl.team ?? 'spectator'].color, label: pl.display_name, dim: pl.status !== 'alive' });
  }
  for (const r of latest.values()) {
    if (s.positions[r.user_id]) continue;
    const c = TEAM_META[r.team].color;
    circles.push({ id: `c${r.id}`, lat: r.lat, lng: r.lng, r: r.radius_m, color: c });
    markers.push({ id: `r${r.user_id}`, lat: r.lat, lng: r.lng, kind: 'reveal', color: c, label: nameOf(r.user_id) });
  }
  const disputes = s.captures.filter((c) => c.status === 'disputed' || c.status === 'pending');
  const fighters = s.players.filter((p) => p.team !== 'spectator');
  const totalDist = fighters.reduce((a, p) => a + p.distance_m, 0);
  const confirmed = s.captures.filter((c) => c.status === 'confirmed').length;

  return (
    <div className="h-full flex flex-col bg-ink">
      <header className="h-14 shrink-0 border-b border-line flex items-center justify-between px-4 gap-4">
        <div className="flex items-center gap-4">
          <Logo size={22} />
          <span className="hidden sm:block font-mono text-xs text-mute">COMMAND · {room.name} · {room.code}</span>
        </div>
        <div className="flex items-center gap-2">
          <span className={`font-mono text-xs px-2 py-1 border ${room.status === 'active' ? 'border-danger text-danger' : room.status === 'paused' ? 'border-amber text-amber' : 'border-cyan text-cyan'}`}>{room.status.toUpperCase()}</span>
          <span className={`size-2 rounded-full ${s.connected ? 'bg-neon' : 'bg-danger flash'}`} title={s.connected ? 'Realtime connected' : 'Reconnecting'} />
          <Link to={`/room/${room.id}`}><Button size="sm" variant="subtle">Player view</Button></Link>
        </div>
      </header>

      <div className="flex-1 min-h-0 grid lg:grid-cols-[1fr_420px]">
        <div className="relative min-h-[45vh]">
          <GameMap zone={zone} boundary={room.boundary} safeZones={room.safe_zones} markers={markers} circles={circles} fitKey={room.id} center={zone ? [zone.lat, zone.lng] : null} />
          <div className="absolute top-3 left-3 grid grid-cols-2 sm:grid-cols-4 gap-2">
            {[
              [room.status === 'headstart' ? 'Head start' : 'Time left', live ? formatClock((room.status === 'headstart' ? hsEnd : end) - t) : '—'],
              ['Zone', formatDistance(radius)],
              ['Captures', String(confirmed)],
              ['Distance', formatDistance(totalDist)],
            ].map(([k, v]) => <div key={k} className="panel chamfer-sm px-3 py-2"><div className="label">{k}</div><div className="font-display text-xl text-white tabular-nums">{v}</div></div>)}
          </div>
          <div className="absolute bottom-3 left-3 font-mono text-[10px] text-mute bg-ink/80 px-2 py-1 max-w-sm">
            {s.players.find((p) => p.user_id === uid)?.team === 'spectator' && room.rules.referee_live !== false ? 'REFEREE MODE · live positions visible' : 'Playing host · you only see your team live + blurred reveals'}
          </div>
        </div>

        <aside className="border-l border-line overflow-auto p-3 space-y-3 bg-ink-2">
          <Panel title="Match control">
            <div className="grid grid-cols-2 gap-2">
              {room.status === 'lobby' && <Button className="col-span-2" onClick={() => run(() => api.start(room.id))}>Start match</Button>}
              {(room.status === 'active' || room.status === 'headstart') && <Button variant="danger" onClick={() => run(() => api.emergencyStop(room.id, 'Host pause'))}>Pause all</Button>}
              {room.status === 'paused' && <Button onClick={() => run(() => api.resume(room.id))}>Resume</Button>}
              {live && <Button variant="ghost" onClick={() => confirm('Abort the match? No XP is awarded.') && run(() => api.end(room.id))}>Abort</Button>}
              {room.status === 'lobby' && <Button variant="ghost" className="col-span-2" onClick={() => run(() => api.shuffleTeams(room.id))}>Shuffle teams</Button>}
            </div>
            <p className="font-mono text-[10px] text-mute mt-2">{mi.name} · reveal every {Math.round(room.reveal_interval_s / 60)}m ±{room.reveal_blur_m}m · tag {room.tag_radius_m}m</p>
          </Panel>

          {disputes.length > 0 && (
            <Panel title={<span className="text-amber">Captures awaiting ruling · {disputes.length}</span>}>
              <ul className="space-y-2">
                {disputes.map((c) => (
                  <li key={c.id} className="bg-ink border border-line p-2.5 chamfer-sm">
                    <div className="text-sm text-white">{nameOf(c.hunter_id)} → {nameOf(c.target_id)}</div>
                    <div className="font-mono text-[10px] text-mute">{c.status.toUpperCase()} · {Math.round(c.distance_m)} m apart at tag time</div>
                    <div className="grid grid-cols-2 gap-2 mt-2">
                      <Button size="sm" variant="ghost" onClick={() => run(() => api.resolveCapture(c.id, false))}>Reject</Button>
                      <Button size="sm" variant="danger" onClick={() => run(() => api.resolveCapture(c.id, true))}>Confirm</Button>
                    </div>
                  </li>
                ))}
              </ul>
            </Panel>
          )}

          <Panel title={`Roster · ${fighters.length}`}>
            <table className="w-full text-xs">
              <thead><tr className="label text-left"><th className="pb-2 font-normal">Agent</th><th className="font-normal">State</th><th className="font-normal text-right">Seen</th><th className="font-normal text-right">⚑</th><th /></tr></thead>
              <tbody className="divide-y divide-line">
                {s.players.map((p) => {
                  const seen = Math.round((now - Date.parse(p.last_seen_at)) / 1000);
                  return (
                    <tr key={p.user_id}>
                      <td className="py-2 pr-1"><div className="flex items-center gap-1.5"><TeamBadge team={p.team} /><span className="text-white truncate max-w-[110px]">{p.display_name}</span></div>
                        <div className="font-mono text-[10px] text-mute mt-0.5">{p.captures} caps · {formatDistance(p.distance_m)}</div></td>
                      <td className={`font-mono text-[10px] ${p.status === 'alive' ? (p.out_of_zone_since ? 'text-amber' : 'text-neon') : 'text-danger'}`}>{p.out_of_zone_since && p.status === 'alive' ? 'OUT ZONE' : p.status.toUpperCase()}</td>
                      <td className={`font-mono text-[10px] text-right ${seen > 60 ? 'text-danger' : 'text-mute'}`}>{seen > 3600 ? '—' : `${seen}s`}</td>
                      <td className={`font-mono text-[10px] text-right ${p.flags ? 'text-amber' : 'text-mute'}`}>{p.flags}</td>
                      <td className="text-right">{p.user_id !== uid && <button className="font-mono text-[10px] text-danger hover:underline" onClick={() => confirm(`Remove ${p.display_name}?`) && run(() => api.kick(room.id, p.user_id))}>KICK</button>}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </Panel>

          <Panel title="GPS anomalies">
            <p className="text-[11px] text-mute mb-2">Heuristic speed/teleport checks. GPS drift, tunnels and vehicles cause false positives; a careful spoofer can evade them. Use judgement before removing anyone.</p>
            {anoms.length === 0 ? <p className="font-mono text-xs text-neon">No anomalies detected</p> : (
              <ul className="space-y-1 font-mono text-[11px] max-h-40 overflow-auto">
                {anoms.map((a) => <li key={a.id} className="text-amber">{new Date(a.created_at).toLocaleTimeString()} · {nameOf(a.user_id)} · {a.kind} · {Math.round((a.speed_mps ?? 0) * 3.6)} km/h over {formatDistance(a.distance_m ?? 0)}</li>)}
              </ul>
            )}
          </Panel>

          <Panel title="Event log">
            <ul className="space-y-1 font-mono text-[11px] max-h-64 overflow-auto">
              {[...s.events].reverse().map((e) => { const d = describeEvent(e, nameOf); return d && <li key={e.id} className={toneClass[d.tone]}><span className="text-mute">{new Date(e.created_at).toLocaleTimeString()} </span>{d.text}</li>; })}
            </ul>
          </Panel>
        </aside>
      </div>
    </div>
  );
}
