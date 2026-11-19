import { useEffect, useRef, useState } from 'react';
import { api } from '../lib/api';
import type { LocationFeedback, Player, Room } from '../lib/types';
import { useGeolocation, useWakeLock } from './useGeolocation';

/**
 * Client side of the game loop:
 *  - streams GPS to the server at the room's configured interval (server validates + rate-limits),
 *  - calls the idempotent server `tick` so timers/reveals/zone eliminations advance even without cron,
 *  - heartbeats spectators so presence stays accurate.
 */
export function useGameLoop(room: Room | null, me: Player | undefined) {
  const live = !!room && room.status !== 'ended' && !!me && me.status !== 'left';
  const sharing = live && me!.team !== 'spectator';
  const { fix, error } = useGeolocation(sharing);
  const [feedback, setFeedback] = useState<LocationFeedback | null>(null);
  const [sendError, setSendError] = useState<string | null>(null);
  const fixRef = useRef(fix);
  fixRef.current = fix;
  useWakeLock(!!room && ['headstart', 'active', 'paused'].includes(room.status));

  const roomId = room?.id;
  const interval = Math.max(2, room?.location_interval_s ?? 5) * 1000;

  useEffect(() => {
    if (!sharing || !roomId) return;
    let stop = false;
    const send = async () => {
      const f = fixRef.current;
      if (!f || stop) return;
      try {
        const fb = await api.updateLocation(roomId, { lat: f.lat, lng: f.lng, accuracy: f.accuracy, heading: f.heading, speed: f.speed });
        if (!stop && !fb.throttled) { setFeedback(fb); setSendError(null); }
      } catch (e) { if (!stop) setSendError(e instanceof Error ? e.message : String(e)); }
    };
    void send();
    const t = setInterval(send, interval);
    return () => { stop = true; clearInterval(t); };
  }, [sharing, roomId, interval]);

  // push the first fix immediately instead of waiting a full interval
  const hadFix = useRef(false);
  useEffect(() => {
    if (fix && !hadFix.current && sharing && roomId) {
      hadFix.current = true;
      api.updateLocation(roomId, fix).then(setFeedback).catch(() => {});
    }
  }, [fix, sharing, roomId]);

  const status = room?.status;
  useEffect(() => {
    if (!roomId || !live || !status || !['headstart', 'active'].includes(status)) return;
    const t = setInterval(() => api.tick(roomId).catch(() => {}), 5000 + Math.random() * 1500);
    return () => clearInterval(t);
  }, [roomId, live, status]);

  useEffect(() => {
    if (!roomId || !live || sharing) return;
    const beat = () => api.heartbeat(roomId).catch(() => {});
    beat();
    const t = setInterval(beat, 20000);
    return () => clearInterval(t);
  }, [roomId, live, sharing]);

  return { fix, feedback, gpsError: error, sendError };
}
