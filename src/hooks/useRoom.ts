import { useCallback, useEffect, useRef, useState } from 'react';
import { supabase } from '../lib/supabase';
import type { Capture, GameEvent, Player, Position, Reveal, Room } from '../lib/types';

export interface RoomState {
  room: Room | null; players: Player[]; positions: Record<string, Position>;
  reveals: Reveal[]; captures: Capture[]; events: GameEvent[];
  loading: boolean; error: string | null; connected: boolean;
}

const initial: RoomState = { room: null, players: [], positions: {}, reveals: [], captures: [], events: [], loading: true, error: null, connected: false };

/**
 * Live room state. Initial snapshot via REST, then Supabase Realtime postgres_changes
 * (RLS-filtered server side, so each client only receives rows it may see).
 * Re-syncs on reconnect and when the tab becomes visible again.
 */
export function useRoom(roomId: string | undefined) {
  const [state, setState] = useState<RoomState>(initial);
  const alive = useRef(true);

  const load = useCallback(async () => {
    if (!roomId) return;
    const [room, players, positions, reveals, captures, events] = await Promise.all([
      supabase.from('rooms').select('*').eq('id', roomId).maybeSingle(),
      supabase.from('players').select('*').eq('room_id', roomId).order('joined_at'),
      supabase.from('positions').select('*').eq('room_id', roomId),
      supabase.from('reveals').select('*').eq('room_id', roomId).order('id', { ascending: false }).limit(200),
      supabase.from('captures').select('*').eq('room_id', roomId).order('id'),
      supabase.from('events').select('*').eq('room_id', roomId).order('id', { ascending: false }).limit(80),
    ]);
    if (!alive.current) return;
    if (room.error || !room.data) {
      setState((s) => ({ ...s, loading: false, error: room.error?.message ?? 'Room not found or you are not a member' }));
      return;
    }
    setState((s) => ({
      ...s, loading: false, error: null, room: room.data as Room,
      players: (players.data ?? []) as Player[],
      positions: Object.fromEntries(((positions.data ?? []) as Position[]).map((p) => [p.user_id, p])),
      reveals: ((reveals.data ?? []) as Reveal[]).reverse(),
      captures: (captures.data ?? []) as Capture[],
      events: ((events.data ?? []) as GameEvent[]).reverse(),
    }));
  }, [roomId]);

  useEffect(() => {
    alive.current = true;
    if (!roomId) return;
    setState(initial);
    void load();
    const f = `room_id=eq.${roomId}`;
    let wasDown = false;
    const ch = supabase
      .channel(`room-db:${roomId}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'rooms', filter: `id=eq.${roomId}` }, (p) => {
        if (p.eventType === 'DELETE') setState((s) => ({ ...s, room: null, error: 'Room closed' }));
        else setState((s) => ({ ...s, room: { ...(s.room ?? {}), ...(p.new as Room) } }));
      })
      .on('postgres_changes', { event: '*', schema: 'public', table: 'players', filter: f }, (p) => {
        setState((s) => {
          if (p.eventType === 'DELETE') {
            const old = p.old as Partial<Player>;
            return { ...s, players: s.players.filter((x) => x.user_id !== old.user_id) };
          }
          const n = p.new as Player;
          const exists = s.players.some((x) => x.user_id === n.user_id);
          return { ...s, players: exists ? s.players.map((x) => (x.user_id === n.user_id ? n : x)) : [...s.players, n] };
        });
      })
      .on('postgres_changes', { event: '*', schema: 'public', table: 'positions', filter: f }, (p) => {
        setState((s) => {
          const positions = { ...s.positions };
          if (p.eventType === 'DELETE') delete positions[(p.old as Position).user_id];
          else positions[(p.new as Position).user_id] = p.new as Position;
          return { ...s, positions };
        });
      })
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'reveals', filter: f }, (p) => {
        const n = p.new as Reveal;
        setState((s) => (s.reveals.some((x) => x.id === n.id) ? s : { ...s, reveals: [...s.reveals.slice(-199), n] }));
      })
      .on('postgres_changes', { event: '*', schema: 'public', table: 'captures', filter: f }, (p) => {
        const n = p.new as Capture;
        setState((s) => ({ ...s, captures: s.captures.some((c) => c.id === n.id) ? s.captures.map((c) => (c.id === n.id ? n : c)) : [...s.captures, n] }));
      })
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'events', filter: f }, (p) => {
        const n = p.new as GameEvent;
        setState((s) => (s.events.some((x) => x.id === n.id) ? s : { ...s, events: [...s.events.slice(-79), n] }));
      })
      .subscribe((status) => {
        if (status === 'SUBSCRIBED') {
          setState((s) => ({ ...s, connected: true }));
          if (wasDown) void load();
        } else if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT' || status === 'CLOSED') {
          wasDown = true;
          setState((s) => ({ ...s, connected: false }));
        }
      });
    const onVis = () => { if (document.visibilityState === 'visible') void load(); };
    document.addEventListener('visibilitychange', onVis);
    window.addEventListener('online', onVis);
    return () => {
      alive.current = false;
      document.removeEventListener('visibilitychange', onVis);
      window.removeEventListener('online', onVis);
      void supabase.removeChannel(ch);
    };
  }, [roomId, load]);

  return { ...state, reload: load };
}
