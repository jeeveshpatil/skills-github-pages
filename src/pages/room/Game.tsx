import { useEffect, useMemo, useRef, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import type { RoomProps } from '../Room';
import { GameMap, type MapCircle, type MapMarker } from '../../components/GameMap';
import { Compass } from '../../components/Compass';
import { VoiceChat } from '../../components/VoiceChat';
import { Button, Modal, errMsg, inputCls, useToast } from '../../components/ui';
import { api } from '../../lib/api';
import { bearing, distance, formatClock, formatDistance, nextShrinkAt, zoneRadiusAt } from '../../lib/geo';
import { TEAM_META, canTag, isPrey, modeInfo } from '../../lib/modes';
import { describeEvent, toneClass } from '../../lib/events';
import type { Reveal } from '../../lib/types';
import { useNow } from '../../hooks/useNow';
import { useHeading } from '../../hooks/useGeolocation';

const PROX = {
  danger: { label: 'DANGER CLOSE', sub: '< 50 m', color: '#ff4d6d' },
  close: { label: 'CLOSE', sub: '< 150 m', color: '#ffb020' },
  near: { label: 'NEARBY', sub: '< 300 m', color: '#22e3ff' },
  far: { label: 'CLEAR', sub: '> 300 m', color: '#2dffa0' },
} as const;

export default function Game({ room: r, players, positions, reveals, captures, events, me, uid, loop }: RoomProps) {
  const room = r!;
  const nav = useNavigate();
  const toast = useToast();
  const now = useNow(500);
  const { heading, needsPermission, request } = useHeading();
  const [tagOpen, setTagOpen] = useState(false);
  const [sosOpen, setSosOpen] = useState(false);
  const [sosReason, setSosReason] = useState('');
  const [menu, setMenu] = useState(false);
  const [target, setTarget] = useState<string | null>(null);
  const [follow, setFollow] = useState(true);
  const [busy, setBusy] = useState(false);

  const isHost = room.host_id === uid;
  const spectator = !me || me.team === 'spectator';
  const out = !!me && me.status !== 'alive';
  const nameOf = (id: string | null) => players.find((p) => p.user_id === id)?.display_name ?? 'Someone';
  const teamOf = (id: string) => players.find((p) => p.user_id === id)?.team ?? null;
  const myPos = loop.fix ?? (positions[uid] ? { ...positions[uid], accuracy: positions[uid].accuracy ?? 0 } : null);

  // ---- timers & zone (computed locally from server timestamps; server is authoritative)
  const hsEnd = Date.parse(room.headstart_ends_at ?? '');
  const end = Date.parse(room.ends_at ?? '');
  const t = room.status === 'paused' && room.paused_at ? Date.parse(room.paused_at) : now;
  const phase = room.status === 'paused' ? 'PAUSED' : t < hsEnd ? 'HEAD START' : 'HUNT';
  const clock = t < hsEnd ? hsEnd - t : end - t;
  const radius = zoneRadiusAt(room, t);
  const shrinkAt = nextShrinkAt(room, t);
  const nextRadius = shrinkAt ? zoneRadiusAt({ ...room, status: 'active' }, shrinkAt + 1) : null;
  const nextReveal = (room.last_reveal_at ? Date.parse(room.last_reveal_at) : hsEnd) + room.reveal_interval_s * 1000;
  const zone = room.zone_lat != null && room.zone_lng != null ? { lat: room.zone_lat, lng: room.zone_lng, radius, next: nextRadius } : null;

  // ---- latest reveal per player (older ones fade)
  const latestReveals = useMemo(() => {
    const m = new Map<string, Reveal>();
    for (const rv of reveals) m.set(rv.user_id, rv);
    return [...m.values()].filter((rv) => {
      const p = players.find((x) => x.user_id === rv.user_id);
      return p && p.status === 'alive' && (spectator || rv.team !== me?.team);
    });
  }, [reveals, players, spectator, me?.team]);

  const markers: MapMarker[] = [];
  const circles: MapCircle[] = [];
  for (const rv of latestReveals) {
    const age = (now - Date.parse(rv.created_at)) / 1000;
    const color = TEAM_META[teamOf(rv.user_id) ?? rv.team].color;
    const fade = Math.max(0.25, 1 - age / (room.reveal_interval_s * 2));
    circles.push({ id: `c${rv.id}`, lat: rv.lat, lng: rv.lng, r: rv.radius_m, color, opacity: 0.14 * fade });
    markers.push({ id: `r${rv.user_id}`, lat: rv.lat, lng: rv.lng, color, kind: 'reveal', dim: fade < 0.6, label: `${nameOf(rv.user_id)} · ${Math.round(age / 60)}m${rv.stale ? ' ⚠' : ''}` });
  }
  for (const p of Object.values(positions)) {
    if (p.user_id === uid) continue;
    const pl = players.find((x) => x.user_id === p.user_id);
    if (!pl || pl.status === 'left') continue;
    markers.push({ id: `a${p.user_id}`, lat: p.lat, lng: p.lng, kind: 'ally', color: TEAM_META[pl.team ?? 'spectator'].color, dim: pl.status !== 'alive' || now - Date.parse(p.updated_at) > 60000, label: pl.display_name });
  }
  if (myPos && !spectator) markers.push({ id: 'me', lat: myPos.lat, lng: myPos.lng, kind: 'me', color: '#22e3ff', heading: heading ?? loop.fix?.heading ?? null });
  if (myPos) circles.push({ id: 'acc', lat: myPos.lat, lng: myPos.lng, r: Math.min(myPos.accuracy ?? 0, 100), color: '#22e3ff', opacity: 0.06 });

  // ---- compass target: chosen reveal, else nearest enemy reveal, else zone centre
  const targets = latestReveals.map((rv) => ({ id: rv.user_id, lat: rv.lat, lng: rv.lng, d: myPos ? distance(myPos.lat, myPos.lng, rv.lat, rv.lng) : Infinity }));
  targets.sort((a, b) => a.d - b.d);
  const outside = !!(zone && myPos && distance(myPos.lat, myPos.lng, zone.lat, zone.lng) > radius);
  const tgt = outside || !targets.length ? (zone ? { id: 'zone', lat: zone.lat, lng: zone.lng } : null) : targets.find((x) => x.id === target) ?? targets[0];
  const tgtBearing = tgt && myPos ? bearing(myPos.lat, myPos.lng, tgt.lat, tgt.lng) : null;
  const tgtDist = tgt && myPos ? distance(myPos.lat, myPos.lng, tgt.lat, tgt.lng) : null;

  // ---- team counts
  const mi = modeInfo(room.mode);
  const counts = mi.teams.map((tm) => ({ tm, alive: players.filter((p) => p.team === tm && p.status === 'alive').length, total: players.filter((p) => p.team === tm).length }));

  // ---- capture against me / mine
  const pendingOnMe = captures.find((c) => c.target_id === uid && c.status === 'pending');
  const myPending = captures.find((c) => c.hunter_id === uid && (c.status === 'pending' || c.status === 'disputed'));
  const canTagAnyone = !out && !spectator && room.status === 'active' && players.some((p) => p.status === 'alive' && canTag(room.mode, me!.team, p.team));
  const tagList = players.filter((p) => p.status === 'alive' && me && canTag(room.mode, me.team, p.team))
    .map((p) => { const rv = latestReveals.find((x) => x.user_id === p.user_id); return { p, d: rv && myPos ? distance(myPos.lat, myPos.lng, rv.lat, rv.lng) : null }; })
    .sort((a, b) => (a.d ?? 1e9) - (b.d ?? 1e9));

  // ---- haptics + alerts
  const prox = loop.feedback?.proximity ?? null;
  const lastProx = useRef<string | null>(null);
  useEffect(() => {
    if (prox && prox !== lastProx.current && (prox === 'danger' || prox === 'close')) navigator.vibrate?.(prox === 'danger' ? [200, 80, 200, 80, 200] : [150]);
    lastProx.current = prox;
  }, [prox]);
  const lastEvt = events[events.length - 1];
  useEffect(() => {
    if (!lastEvt) return;
    if (lastEvt.type === 'reveal') navigator.vibrate?.([60, 40, 60]);
    if (lastEvt.type === 'emergency_stop') navigator.vibrate?.([400, 100, 400]);
    if ((lastEvt.type === 'capture_confirmed' || lastEvt.type === 'infected') && lastEvt.target === uid) navigator.vibrate?.([600]);
  }, [lastEvt?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  const doTag = async (id: string) => {
    setBusy(true);
    try {
      const res = await api.tag(room.id, id);
      if (res.ok) { toast(room.rules.capture_confirm === false ? 'Capture confirmed!' : 'Tag sent — awaiting confirmation', 'success'); setTagOpen(false); navigator.vibrate?.([80]); }
      else toast(res.reason ?? 'Tag failed', 'warn');
    } catch (e) { toast(errMsg(e), 'error'); } finally { setBusy(false); }
  };
  const sos = async () => {
    try { await api.emergencyStop(room.id, sosReason || undefined); setSosOpen(false); setSosReason(''); } catch (e) { toast(errMsg(e), 'error'); }
  };

  const outsideSince = me?.out_of_zone_since ? Date.parse(me.out_of_zone_since) : null;
  const pausedBy = room.paused_by ? nameOf(room.paused_by) : null;
  const sosEvent = [...events].reverse().find((e) => e.type === 'emergency_stop');
  const feed = events.slice(-5).map((e) => ({ e, d: describeEvent(e, nameOf) })).filter((x) => x.d && x.e.type !== 'zone_warning');

  return (
    <div className="fixed inset-0 bg-ink overflow-hidden select-none">
      <GameMap controls={false} zone={zone} safeZones={room.safe_zones} markers={markers} circles={circles} fitKey={room.id}
        follow={follow && myPos && !spectator ? [myPos.lat, myPos.lng] : null} />
      <div className="absolute inset-0 pointer-events-none" style={{ background: 'radial-gradient(ellipse at center, transparent 55%, #05080acc 100%)' }} />

      {/* ---- top HUD */}
      <div className="absolute top-0 inset-x-0 safe-top px-3 pointer-events-none">
        <div className="flex items-start justify-between gap-2">
          <div className="panel chamfer-sm px-3 py-2 pointer-events-auto">
            <div className={`font-mono text-[10px] tracking-widest ${phase === 'HUNT' ? 'text-danger' : phase === 'PAUSED' ? 'text-amber' : 'text-cyan'}`}>{phase}</div>
            <div className="font-display text-3xl text-white leading-none tabular-nums mt-0.5">{formatClock(clock)}</div>
          </div>
          <div className="flex flex-col items-center gap-1.5 pointer-events-auto">
            <div className="panel chamfer-sm px-2 py-1.5 flex gap-3">
              {counts.map((c) => (
                <div key={c.tm} className="text-center">
                  <div className="font-mono text-[9px]" style={{ color: TEAM_META[c.tm].color }}>{TEAM_META[c.tm].short}</div>
                  <div className="font-display text-lg text-white leading-none tabular-nums">{c.alive}<span className="text-mute text-xs">/{c.total}</span></div>
                </div>
              ))}
            </div>
            {me && !spectator && <span className="font-mono text-[10px] px-2 py-0.5 border" style={{ color: TEAM_META[me.team!].color, borderColor: TEAM_META[me.team!].color + '55', background: '#05080acc' }}>YOU · {TEAM_META[me.team!].label.toUpperCase()}{out ? ' · OUT' : ''}</span>}
            {spectator && <span className="font-mono text-[10px] px-2 py-0.5 border border-line-2 text-soft bg-ink/80">SPECTATOR</span>}
          </div>
          <div className="panel chamfer-sm px-3 py-2 text-right pointer-events-auto">
            <div className="font-mono text-[10px] text-neon tracking-widest">ZONE</div>
            <div className="font-display text-lg text-white leading-none tabular-nums">{formatDistance(radius)}</div>
            {shrinkAt && <div className="font-mono text-[10px] text-cyan mt-0.5">→ {formatDistance(nextRadius!)} in {formatClock(shrinkAt - t)}</div>}
            {room.status === 'active' && <div className="font-mono text-[10px] text-amber">PING {formatClock(nextReveal - t)}</div>}
          </div>
        </div>

        {/* alerts */}
        <div className="mt-2 flex flex-col items-center gap-1.5">
          {outside && !out && !spectator && (
            <div className="chamfer-sm bg-danger/90 text-white px-4 py-2 font-display text-sm uppercase tracking-wider flash pointer-events-auto">
              Outside zone{room.rules.zone_elimination && isPrey(room.mode, me?.team ?? null) && outsideSince ? ` · eliminated in ${formatClock(outsideSince + room.zone_grace_s * 1000 - now)}` : ' · return to the circle'}
            </div>
          )}
          {loop.feedback?.in_safe_zone && <div className="chamfer-sm bg-cyan/90 text-ink px-3 py-1 font-mono text-xs">IN SAFE ZONE · CANNOT BE TAGGED</div>}
          {loop.gpsError && !spectator && <div className="chamfer-sm bg-amber/90 text-ink px-3 py-1 font-mono text-xs pointer-events-auto">{loop.gpsError}</div>}
          {loop.sendError && !spectator && <div className="chamfer-sm bg-amber/90 text-ink px-3 py-1 font-mono text-xs">Uplink: {loop.sendError}</div>}
          {loop.feedback?.suspect && <div className="chamfer-sm bg-ink/90 border border-amber text-amber px-3 py-1 font-mono text-[10px]">GPS JUMP DETECTED — WAIT FOR A STABLE FIX</div>}
          {out && <div className="chamfer-sm bg-ink/90 border border-line-2 text-soft px-3 py-1 font-mono text-xs">YOU ARE OUT — SPECTATING YOUR TEAM</div>}
        </div>
      </div>

      {/* ---- left: proximity + feed */}
      <div className="absolute left-3 bottom-40 sm:bottom-32 max-w-[62vw] sm:max-w-sm space-y-2 pointer-events-none">
        {prox && !out && !spectator && (
          <div className="panel chamfer-sm px-3 py-2 inline-flex items-center gap-2.5" style={{ borderColor: PROX[prox].color + '88' }}>
            <span className={`size-2.5 rounded-full ${prox === 'danger' ? 'flash' : ''}`} style={{ background: PROX[prox].color, boxShadow: `0 0 12px ${PROX[prox].color}` }} />
            <span>
              <span className="block font-display text-sm leading-none" style={{ color: PROX[prox].color }}>{PROX[prox].label}</span>
              <span className="block font-mono text-[9px] text-mute mt-0.5">ENEMY {PROX[prox].sub}</span>
            </span>
          </div>
        )}
        <ul className="space-y-1">
          {feed.map(({ e, d }) => (
            <li key={e.id} className={`rise font-mono text-[11px] bg-ink/80 px-2 py-1 border-l-2 ${toneClass[d!.tone]}`} style={{ borderColor: 'currentColor' }}>
              <span className="text-soft">{d!.text}</span>
            </li>
          ))}
        </ul>
      </div>

      {/* ---- right: compass */}
      <div className="absolute right-3 bottom-40 sm:bottom-32 flex flex-col items-end gap-2">
        <button onClick={() => { if (needsPermission) void request(); else if (targets.length) { const i = targets.findIndex((x) => x.id === tgt?.id); setTarget(targets[(i + 1) % targets.length].id); } }} aria-label="Compass — tap to cycle target">
          <Compass heading={heading} targetBearing={tgtBearing} targetDistance={tgtDist}
            targetLabel={tgt ? (tgt.id === 'zone' ? 'ZONE CENTRE' : `LAST PING · ${nameOf(tgt.id).toUpperCase()}`) : undefined}
            color={tgt?.id === 'zone' ? '#2dffa0' : '#ff4d6d'} />
        </button>
        {needsPermission && <span className="font-mono text-[9px] text-cyan">TAP TO ENABLE COMPASS</span>}
        <button onClick={() => setFollow(!follow)} className={`pointer-events-auto font-mono text-[10px] px-2 py-1 border ${follow ? 'border-cyan text-cyan' : 'border-line-2 text-mute'} bg-ink/80`}>{follow ? 'FOLLOWING' : 'FREE CAM'}</button>
      </div>

      {/* ---- bottom action bar */}
      <div className="absolute bottom-0 inset-x-0 safe-bottom px-3">
        <div className="flex items-end gap-2">
          <HoldButton onFire={() => setSosOpen(true)} />
          <div className="flex-1">
            {canTagAnyone ? (
              <Button size="lg" variant="danger" className="w-full !h-16 text-lg" onClick={() => setTagOpen(true)} disabled={!!myPending}>
                {myPending ? 'Tag pending…' : 'Tag'}
              </Button>
            ) : (
              <div className="h-16 panel chamfer-sm grid place-items-center font-mono text-xs text-mute">
                {room.status === 'headstart' ? (isPrey(room.mode, me?.team ?? null) ? 'HIDE — HUNTERS RELEASE SOON' : 'HOLD POSITION — HEAD START') : room.status === 'paused' ? 'MATCH PAUSED' : out ? 'ELIMINATED' : spectator ? 'SPECTATING' : 'EVADE · STAY IN THE ZONE'}
              </div>
            )}
          </div>
          <button onClick={() => setMenu(true)} className="size-16 chamfer-sm panel grid place-items-center text-soft" aria-label="Menu">
            <svg viewBox="0 0 24 24" className="size-6" fill="none" stroke="currentColor" strokeWidth="1.8"><path d="M4 7h16M4 12h16M4 17h16" /></svg>
          </button>
        </div>
        {room.rules.voice_enabled !== false && me && !spectator && <div className="mt-2 flex justify-center"><VoiceChat roomId={room.id} team={me.team!} userId={uid} /></div>}
      </div>

      {/* ---- tag sheet */}
      <Modal open={tagOpen} onClose={() => setTagOpen(false)} title="Confirm tag">
        <p className="text-sm text-mute mb-3">The server checks both live GPS fixes. You must be within {room.tag_radius_m} m (+ GPS tolerance). Distances below are to each target's last blurred ping.</p>
        <ul className="space-y-2">
          {tagList.map(({ p, d }) => (
            <li key={p.user_id}>
              <button disabled={busy} onClick={() => doTag(p.user_id)} className="w-full flex items-center justify-between chamfer-sm border border-line hover:border-danger bg-ink-2 px-3 py-3">
                <span className="text-white">{p.display_name}</span>
                <span className="font-mono text-xs text-mute">{d != null ? `~${formatDistance(d)}` : 'no ping yet'}</span>
              </button>
            </li>
          ))}
        </ul>
      </Modal>

      {/* ---- capture confirmation for target */}
      <Modal open={!!pendingOnMe}>
        <h2 className="text-2xl text-danger">You've been tagged</h2>
        <p className="mt-2 text-sm">{nameOf(pendingOnMe?.hunter_id ?? null)} tagged you at {Math.round(pendingOnMe?.distance_m ?? 0)} m. Accept if they reached you; dispute and the host decides. Auto-accepts in 30s.</p>
        <div className="grid grid-cols-2 gap-2 mt-5">
          <Button variant="ghost" onClick={() => pendingOnMe && api.respondCapture(pendingOnMe.id, false).catch((e) => toast(errMsg(e), 'error'))}>Dispute</Button>
          <Button variant="danger" onClick={() => pendingOnMe && api.respondCapture(pendingOnMe.id, true).catch((e) => toast(errMsg(e), 'error'))}>Accept</Button>
        </div>
      </Modal>

      {/* ---- SOS */}
      <Modal open={sosOpen} onClose={() => setSosOpen(false)} title="Emergency stop">
        <p className="text-sm mb-3">Pauses the match for every player immediately. Use it for traffic, injury, or anything unsafe.</p>
        <input className={inputCls} placeholder="Reason (optional)" maxLength={140} value={sosReason} onChange={(e) => setSosReason(e.target.value)} />
        <Button variant="danger" size="lg" className="w-full mt-4" onClick={sos}>Pause match for everyone</Button>
        <a href="tel:112" className="block text-center font-mono text-xs text-mute mt-3 underline">Call emergency services (112 / 911)</a>
      </Modal>

      {/* ---- paused overlay */}
      {room.status === 'paused' && (
        <div className="absolute inset-0 z-40 bg-ink/85 backdrop-blur grid place-items-center p-6">
          <div className="text-center max-w-sm">
            <div className="font-mono text-danger tracking-[0.3em] text-xs flash">EMERGENCY STOP</div>
            <h2 className="text-4xl mt-2">Match paused</h2>
            <p className="mt-3">Called by {pausedBy}{sosEvent?.payload.reason ? ` — “${String(sosEvent.payload.reason)}”` : ''}. Everyone stop moving and check in. Timers and the zone are frozen.</p>
            {isHost ? (
              <div className="grid gap-2 mt-6">
                <Button size="lg" onClick={() => api.resume(room.id).catch((e) => toast(errMsg(e), 'error'))}>Resume match</Button>
                <Button variant="ghost" onClick={() => api.end(room.id).catch((e) => toast(errMsg(e), 'error'))}>End match</Button>
              </div>
            ) : <p className="font-mono text-xs text-mute mt-6">Waiting for the host to resume…</p>}
            <Button variant="subtle" size="sm" className="mt-4" onClick={async () => { await api.leave(room.id).catch(() => {}); nav('/'); }}>Leave match</Button>
          </div>
        </div>
      )}

      {/* ---- menu */}
      <Modal open={menu} onClose={() => setMenu(false)} title={room.name}>
        <div className="font-mono text-xs text-mute mb-4">{mi.name} · code {room.code}</div>
        <div className="grid gap-2">
          {isHost && <Link to={`/room/${room.id}/host`}><Button className="w-full" variant="cyan">Host dashboard</Button></Link>}
          {isHost && <Button variant="ghost" onClick={() => { if (confirm('End the match for everyone? No XP is awarded.')) api.end(room.id).catch((e) => toast(errMsg(e), 'error')); }}>Abort match</Button>}
          <Button variant="subtle" onClick={async () => { if (!confirm('Leave the match? You will count as eliminated.')) return; await api.leave(room.id).catch(() => {}); nav('/'); }}>Leave match</Button>
        </div>
        <p className="text-[11px] text-mute mt-4">GPS: {loop.fix ? `±${Math.round(loop.fix.accuracy)} m` : 'no fix'} · updates every {room.location_interval_s}s · anomaly detection is heuristic and can produce false positives.</p>
      </Modal>
    </div>
  );
}

/** Hold-to-activate SOS to prevent pocket presses. */
function HoldButton({ onFire }: { onFire: () => void }) {
  const [p, setP] = useState(0);
  const timer = useRef<number | null>(null);
  const start = () => {
    const t0 = Date.now();
    timer.current = window.setInterval(() => {
      const v = Math.min(1, (Date.now() - t0) / 900);
      setP(v);
      if (v >= 1) { stop(); navigator.vibrate?.(200); onFire(); }
    }, 30);
  };
  const stop = () => { if (timer.current) clearInterval(timer.current); timer.current = null; setP(0); };
  return (
    <button onPointerDown={start} onPointerUp={stop} onPointerLeave={stop} onContextMenu={(e) => e.preventDefault()}
      className="relative size-16 chamfer-sm bg-ink/90 border border-danger/60 text-danger font-display font-bold text-sm overflow-hidden" aria-label="Hold for emergency stop">
      <span className="absolute inset-x-0 bottom-0 bg-danger/40" style={{ height: `${p * 100}%` }} />
      <span className="relative">SOS</span>
    </button>
  );
}
