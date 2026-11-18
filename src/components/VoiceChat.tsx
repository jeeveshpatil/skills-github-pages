import { useEffect, useRef, useState } from 'react';
import type { RealtimeChannel } from '@supabase/supabase-js';
import { supabase } from '../lib/supabase';

const ICE: RTCIceServer[] = ((import.meta.env.VITE_ICE_SERVERS as string | undefined) || 'stun:stun.l.google.com:19302')
  .split(',').map((u) => ({ urls: u.trim() })).filter((s) => s.urls);

type Signal = { from: string; to?: string; kind: 'hello' | 'offer' | 'answer' | 'ice' | 'bye'; data?: unknown };

/**
 * Optional team push-to-talk / open-mic voice. Peer-to-peer WebRTC mesh (DTLS-SRTP encrypted),
 * signalled over a Supabase Realtime broadcast channel scoped to room + team. Best for small teams (<= 6).
 */
export function VoiceChat({ roomId, team, userId }: { roomId: string; team: string; userId: string }) {
  const [on, setOn] = useState(false);
  const [muted, setMuted] = useState(false);
  const [peers, setPeers] = useState(0);
  const [err, setErr] = useState<string | null>(null);
  const stream = useRef<MediaStream | null>(null);
  const pcs = useRef(new Map<string, RTCPeerConnection>());
  const chan = useRef<RealtimeChannel | null>(null);

  useEffect(() => {
    if (!on) return;
    let cancelled = false;
    const send = (s: Omit<Signal, 'from'>) => chan.current?.send({ type: 'broadcast', event: 'sig', payload: { ...s, from: userId } });
    const peer = (id: string) => {
      let pc = pcs.current.get(id);
      if (pc) return pc;
      pc = new RTCPeerConnection({ iceServers: ICE });
      stream.current?.getTracks().forEach((t) => pc!.addTrack(t, stream.current!));
      pc.onicecandidate = (e) => e.candidate && send({ to: id, kind: 'ice', data: e.candidate.toJSON() });
      pc.ontrack = (e) => {
        let a = document.getElementById(`voice-${id}`) as HTMLAudioElement | null;
        if (!a) { a = document.createElement('audio'); a.id = `voice-${id}`; a.autoplay = true; document.body.appendChild(a); }
        a.srcObject = e.streams[0];
      };
      pc.onconnectionstatechange = () => {
        if (['failed', 'closed', 'disconnected'].includes(pc!.connectionState)) drop(id);
        setPeers([...pcs.current.values()].filter((p) => p.connectionState === 'connected').length);
      };
      pcs.current.set(id, pc);
      return pc;
    };
    const drop = (id: string) => {
      pcs.current.get(id)?.close(); pcs.current.delete(id);
      document.getElementById(`voice-${id}`)?.remove();
    };
    (async () => {
      try {
        stream.current = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true } });
      } catch { setErr('Microphone permission denied'); setOn(false); return; }
      if (cancelled) return;
      const ch = supabase.channel(`voice:${roomId}:${team}`, { config: { broadcast: { self: false } } });
      ch.on('broadcast', { event: 'sig' }, async ({ payload }: { payload: Signal }) => {
        if (payload.to && payload.to !== userId) return;
        const from = payload.from;
        if (payload.kind === 'hello') {
          // deterministic initiator avoids glare
          if (userId < from) { const pc = peer(from); const o = await pc.createOffer(); await pc.setLocalDescription(o); send({ to: from, kind: 'offer', data: o }); }
          else send({ to: from, kind: 'hello' });
        } else if (payload.kind === 'offer') {
          const pc = peer(from); await pc.setRemoteDescription(payload.data as RTCSessionDescriptionInit);
          const a = await pc.createAnswer(); await pc.setLocalDescription(a); send({ to: from, kind: 'answer', data: a });
        } else if (payload.kind === 'answer') {
          await pcs.current.get(from)?.setRemoteDescription(payload.data as RTCSessionDescriptionInit);
        } else if (payload.kind === 'ice') {
          try { await pcs.current.get(from)?.addIceCandidate(payload.data as RTCIceCandidateInit); } catch { /* late candidate */ }
        } else if (payload.kind === 'bye') drop(from);
      });
      ch.subscribe((st) => { if (st === 'SUBSCRIBED') send({ kind: 'hello' }); });
      chan.current = ch;
    })();
    const map = pcs.current;
    return () => {
      cancelled = true;
      chan.current?.send({ type: 'broadcast', event: 'sig', payload: { from: userId, kind: 'bye' } });
      if (chan.current) void supabase.removeChannel(chan.current);
      chan.current = null;
      map.forEach((pc, id) => { pc.close(); document.getElementById(`voice-${id}`)?.remove(); });
      map.clear();
      stream.current?.getTracks().forEach((t) => t.stop());
      stream.current = null;
      setPeers(0);
    };
  }, [on, roomId, team, userId]);

  useEffect(() => { stream.current?.getAudioTracks().forEach((t) => (t.enabled = !muted)); }, [muted, on]);

  return (
    <div className="flex items-center gap-1.5">
      <button onClick={() => { setErr(null); setOn(!on); }} title={err ?? 'Team voice'}
        className={`h-10 px-3 chamfer-sm font-mono text-[11px] uppercase border ${on ? 'border-neon text-neon bg-neon/10' : 'border-line-2 text-soft bg-ink/80'}`}>
        {on ? `Voice · ${peers}` : err ? 'Mic blocked' : 'Voice'}
      </button>
      {on && (
        <button onClick={() => setMuted(!muted)} className={`h-10 px-3 chamfer-sm font-mono text-[11px] uppercase border ${muted ? 'border-danger text-danger' : 'border-line-2 text-soft'} bg-ink/80`}>
          {muted ? 'Muted' : 'Mic'}
        </button>
      )}
    </div>
  );
}
