import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import type { RoomProps } from '../Room';
import { GameMap, type MapMarker } from '../../components/GameMap';
import { SettingsForm, settingsFromRoom, toPayload, type Settings } from '../../components/SettingsForm';
import { Button, Panel, errMsg, useToast } from '../../components/ui';
import { Logo } from '../../components/Logo';
import { api } from '../../lib/api';
import { distance, formatDistance } from '../../lib/geo';
import { TEAM_META, modeInfo } from '../../lib/modes';
import { describeEvent, toneClass } from '../../lib/events';
import type { Player, Team } from '../../lib/types';
import { useNow } from '../../hooks/useNow';

export default function Lobby({ room: r, players, positions, events, me, uid, loop }: RoomProps) {
  const room = r!;
  const nav = useNavigate();
  const toast = useToast();
  const now = useNow(5000);
  const [editing, setEditing] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const isHost = room.host_id === uid;
  const mi = modeInfo(room.mode);
  const teams: (Team | null)[] = [...mi.teams, null, 'spectator'];
  const fighters = players.filter((p) => p.team !== 'spectator');
  const nameOf = (id: string | null) => players.find((p) => p.user_id === id)?.display_name ?? 'Someone';
  const online = (p: Player) => now - Date.parse(p.last_seen_at) < 60000;

  const run = async (key: string, fn: () => Promise<unknown>) => {
    setBusy(key);
    try { await fn(); } catch (e) { toast(errMsg(e), 'error'); } finally { setBusy(null); }
  };
  const share = async () => {
    const url = `${location.origin}${import.meta.env.BASE_URL}join/${room.code}`;
    try {
      if (navigator.share) await navigator.share({ title: 'ShadowHunt Pro', text: `Join my manhunt — code ${room.code}`, url });
      else { await navigator.clipboard.writeText(url); toast('Invite link copied', 'success'); }
    } catch { /* cancelled */ }
  };
  const saveSettings = (s: Settings) => run('settings', async () => { await api.updateSettings(room.id, toPayload(s, true)); setEditing(false); toast('Settings updated', 'success'); });

  const markers: MapMarker[] = Object.values(positions).map((p) => ({
    id: p.user_id, lat: p.lat, lng: p.lng, kind: p.user_id === uid ? 'me' : 'ally',
    color: p.user_id === uid ? '#22e3ff' : TEAM_META[players.find((x) => x.user_id === p.user_id)?.team ?? 'spectator'].color,
    label: p.user_id === uid ? undefined : nameOf(p.user_id),
  }));
  if (loop.fix && !positions[uid]) markers.push({ id: uid, lat: loop.fix.lat, lng: loop.fix.lng, kind: 'me', color: '#22e3ff' });

  const zone = room.zone_lat != null && room.zone_lng != null ? { lat: room.zone_lat, lng: room.zone_lng, radius: room.zone_start_m, next: room.zone_end_m } : null;
  const startBlock = fighters.length < 2 ? 'Need at least 2 players' : !zone && !positions[room.host_id] ? 'Set a zone centre or share host GPS' : null;

  if (editing) {
    return (
      <div className="min-h-full bg-grid">
        <div className="max-w-7xl mx-auto px-4 py-6 safe-top">
          <div className="flex items-center justify-between mb-4"><h1 className="text-2xl">Edit settings</h1><Button variant="ghost" size="sm" onClick={() => setEditing(false)}>Cancel</Button></div>
          <SettingsForm lobby initial={settingsFromRoom(room)} onSubmit={saveSettings} submitLabel="Save settings" busy={busy === 'settings'} />
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-full bg-grid">
      <header className="border-b border-line bg-ink/80 backdrop-blur safe-top sticky top-0 z-20">
        <div className="max-w-6xl mx-auto px-4 h-14 flex items-center justify-between">
          <Link to="/"><Logo size={24} withText={false} /></Link>
          <span className="font-mono text-xs text-mute">LOBBY · {mi.name.toUpperCase()}</span>
          <Button size="sm" variant="subtle" onClick={() => run('leave', async () => { await api.leave(room.id); nav('/'); })}>Leave</Button>
        </div>
      </header>

      <main className="max-w-6xl mx-auto px-4 py-5 pb-32 grid lg:grid-cols-[1fr_380px] gap-4">
        <div className="space-y-4">
          <section className="panel brackets chamfer p-5 flex flex-wrap items-end justify-between gap-4">
            <div>
              <span className="label">{room.is_public ? 'Public' : 'Private'} operation</span>
              <h1 className="text-2xl sm:text-3xl font-bold">{room.name}</h1>
            </div>
            <button onClick={share} className="text-right group">
              <span className="label">Room code · tap to share</span>
              <span className="block font-mono text-4xl sm:text-5xl text-neon glow tracking-[0.25em] group-hover:text-white transition-colors">{room.code}</span>
            </button>
          </section>

          <div className="grid sm:grid-cols-2 gap-3">
            {teams.map((t) => {
              const list = players.filter((p) => p.team === t);
              if (t === 'spectator' && !list.length) return null;
              if (t === null && !list.length) return null;
              const meta = t ? TEAM_META[t] : { label: 'Unassigned', color: '#6f8591' };
              return (
                <Panel key={String(t)} title={<span style={{ color: meta.color }}>{meta.label} · {list.length}</span>}
                  right={me && t && t !== me.team && t !== 'spectator' && (isHost || room.rules.self_team_pick !== false) &&
                    <button className="font-mono text-[10px] text-cyan" onClick={() => run('team', () => api.setTeam(room.id, uid, t))}>JOIN SIDE</button>}>
                  {list.length === 0 && <p className="text-xs text-mute">{t === null ? '' : 'Nobody yet — auto-assigned at start'}</p>}
                  <ul className="space-y-1.5">
                    {list.map((p) => (
                      <li key={p.user_id} className="flex items-center gap-2 bg-ink-2 border border-line px-2.5 py-2 chamfer-sm">
                        <span className={`size-2 rounded-full ${online(p) ? 'bg-neon' : 'bg-line-2'}`} title={online(p) ? 'Online' : 'Offline'} />
                        <span className="flex-1 min-w-0 truncate text-white text-sm">{p.display_name}{p.user_id === uid && <span className="text-mute"> (you)</span>}</span>
                        {p.user_id === room.host_id && <span className="font-mono text-[10px] text-amber">HOST</span>}
                        {positions[p.user_id] && <span className="font-mono text-[10px] text-cyan" title="GPS lock">GPS</span>}
                        {p.ready && <span className="font-mono text-[10px] text-neon">READY</span>}
                        {isHost && p.user_id !== uid && (
                          <select aria-label="Player actions" className="bg-ink border border-line text-[11px] font-mono h-7 px-1" value=""
                            onChange={(e) => {
                              const v = e.target.value;
                              if (v === 'kick') void run('kick', () => api.kick(room.id, p.user_id));
                              else if (v === 'host') void run('host', () => api.transferHost(room.id, p.user_id));
                              else if (v) void run('team', () => api.setTeam(room.id, p.user_id, v === 'none' ? null : v));
                            }}>
                            <option value="">⋯</option>
                            {[...mi.teams, 'spectator' as Team].filter((x) => x !== p.team).map((x) => <option key={x} value={x}>→ {TEAM_META[x].label}</option>)}
                            <option value="host">Make host</option>
                            <option value="kick">Kick</option>
                          </select>
                        )}
                      </li>
                    ))}
                  </ul>
                </Panel>
              );
            })}
          </div>

          <Panel title="Comms">
            <ul className="space-y-1 font-mono text-xs max-h-40 overflow-auto">
              {events.slice(-12).reverse().map((e) => { const d = describeEvent(e, nameOf); return d && <li key={e.id} className={toneClass[d.tone]}>› {d.text}</li>; })}
            </ul>
          </Panel>
        </div>

        <aside className="space-y-4">
          <div className="relative h-64 panel chamfer overflow-hidden">
            <GameMap center={zone ? [zone.lat, zone.lng] : loop.fix ? [loop.fix.lat, loop.fix.lng] : null} zone={zone} safeZones={room.safe_zones} markers={markers} fitKey={`${room.zone_lat},${room.zone_start_m}`} />
          </div>
          <div className="font-mono text-[11px] flex justify-between">
            <span className={loop.fix ? 'text-neon' : 'text-amber'}>{me?.team === 'spectator' ? 'SPECTATING · GPS OFF' : loop.gpsError ? loop.gpsError : loop.fix ? `GPS LOCK ±${Math.round(loop.fix.accuracy)}m` : 'ACQUIRING GPS…'}</span>
            {zone && loop.fix && <span className="text-mute">{formatDistance(distance(loop.fix.lat, loop.fix.lng, zone.lat, zone.lng))} to centre</span>}
          </div>

          <Panel title="Rules of engagement">
            <dl className="grid grid-cols-2 gap-y-2 text-sm">
              {[
                ['Head start', `${Math.round(room.head_start_s / 60)} min`], ['Duration', `${Math.round(room.duration_s / 60)} min`],
                ['Reveal every', `${Math.round(room.reveal_interval_s / 60 * 10) / 10} min`], ['Reveal blur', `±${room.reveal_blur_m} m`],
                ['Tag radius', `${room.tag_radius_m} m`], ['Zone', `${formatDistance(room.zone_start_m)} → ${formatDistance(room.zone_end_m)}`],
                ['GPS interval', `${room.location_interval_s}s`], ['Players', `${fighters.length}/${room.max_players}`],
              ].map(([k, v]) => <div key={k}><dt className="label">{k}</dt><dd className="text-white font-display">{v}</dd></div>)}
            </dl>
            <div className="flex flex-wrap gap-1.5 mt-3">
              {room.rules.zone_elimination && <TagPill>Zone kills</TagPill>}
              {room.rules.capture_confirm !== false && <TagPill>Tag confirm</TagPill>}
              {room.rules.proximity_alerts !== false && <TagPill>Proximity</TagPill>}
              {room.rules.reveal_hunters && <TagPill>Hunters revealed</TagPill>}
              {room.safe_zones.length > 0 && <TagPill>{room.safe_zones.length} safe zones</TagPill>}
            </div>
            {isHost && <Button size="sm" variant="ghost" className="w-full mt-4" onClick={() => setEditing(true)}>Edit settings</Button>}
          </Panel>
        </aside>
      </main>

      <div className="fixed bottom-0 inset-x-0 z-30 bg-ink/95 backdrop-blur border-t border-line safe-bottom">
        <div className="max-w-6xl mx-auto px-4 pt-3 flex gap-2">
          {me && me.team !== 'spectator' && (
            <Button variant={me.ready ? 'subtle' : 'cyan'} className="flex-1" onClick={() => run('ready', () => api.setReady(room.id, !me.ready))}>{me.ready ? 'Not ready' : 'Ready up'}</Button>
          )}
          {isHost && (
            <>
              <Button variant="ghost" onClick={() => run('shuffle', () => api.shuffleTeams(room.id))} loading={busy === 'shuffle'}>Shuffle</Button>
              <Link to={`/room/${room.id}/host`} className="hidden md:block"><Button variant="ghost">Dashboard</Button></Link>
              <Button className="flex-1" disabled={!!startBlock} title={startBlock ?? ''} loading={busy === 'start'} onClick={() => run('start', () => api.start(room.id))}>
                {startBlock ?? `Start · ${players.filter((p) => p.ready).length}/${fighters.length} ready`}
              </Button>
            </>
          )}
        </div>
      </div>
    </div>
  );
}

function TagPill({ children }: { children: React.ReactNode }) {
  return <span className="font-mono text-[10px] px-2 py-0.5 border border-cyan/40 text-cyan">{children}</span>;
}
