import { useEffect, useState } from 'react';
import { isNative, setKeepAwake, watchNativeLocation } from '../lib/native';

export interface Fix { lat: number; lng: number; accuracy: number; heading: number | null; speed: number | null; at: number; simulated?: boolean }

/**
 * Continuous high-accuracy GPS watch. Only active while `enabled`.
 * In the native apps this uses a background-capable watcher so tracking survives screen-off.
 */
export function useGeolocation(enabled: boolean) {
  const [fix, setFix] = useState<Fix | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    if (!enabled || !isNative) return;
    let stop: (() => void) | null = null, cancelled = false;
    watchNativeLocation((f) => { setError(null); setFix(f); }, setError)
      .then((s) => { if (cancelled) s(); else stop = s; })
      .catch((e) => setError(e instanceof Error ? e.message : String(e)));
    return () => { cancelled = true; stop?.(); };
  }, [enabled]);
  useEffect(() => {
    if (!enabled || isNative) return;
    if (!('geolocation' in navigator)) { setError('Geolocation is not supported on this device'); return; }
    const id = navigator.geolocation.watchPosition(
      (p) => {
        setError(null);
        setFix({ lat: p.coords.latitude, lng: p.coords.longitude, accuracy: p.coords.accuracy, heading: p.coords.heading, speed: p.coords.speed, at: p.timestamp });
      },
      (e) => setError(e.code === e.PERMISSION_DENIED ? 'Location permission denied — enable it in your browser settings' : e.message || 'GPS unavailable'),
      { enableHighAccuracy: true, maximumAge: 2000, timeout: 20000 },
    );
    return () => navigator.geolocation.clearWatch(id);
  }, [enabled]);
  return { fix, error };
}

/** Device compass heading (degrees from north) where supported. iOS needs a user-gesture permission. */
export function useHeading() {
  const [heading, setHeading] = useState<number | null>(null);
  const [needsPermission, setNeedsPermission] = useState(false);
  useEffect(() => {
    type IOSEvent = DeviceOrientationEvent & { webkitCompassHeading?: number };
    const handler = (e: DeviceOrientationEvent) => {
      const ios = (e as IOSEvent).webkitCompassHeading;
      if (typeof ios === 'number') setHeading(ios);
      else if (e.absolute && e.alpha != null) setHeading((360 - e.alpha) % 360);
    };
    const DOE = window.DeviceOrientationEvent as unknown as { requestPermission?: () => Promise<string> } | undefined;
    if (DOE?.requestPermission) setNeedsPermission(true);
    window.addEventListener('deviceorientationabsolute', handler as EventListener);
    window.addEventListener('deviceorientation', handler);
    return () => {
      window.removeEventListener('deviceorientationabsolute', handler as EventListener);
      window.removeEventListener('deviceorientation', handler);
    };
  }, []);
  const request = async () => {
    const DOE = window.DeviceOrientationEvent as unknown as { requestPermission?: () => Promise<string> };
    try { if ((await DOE.requestPermission?.()) === 'granted') setNeedsPermission(false); } catch { /* user declined */ }
  };
  return { heading, needsPermission, request };
}

/** Keeps the screen awake during a match (Screen Wake Lock API, where supported). */
export function useWakeLock(enabled: boolean) {
  useEffect(() => {
    if (!enabled || !isNative) return;
    void setKeepAwake(true);
    return () => { void setKeepAwake(false); };
  }, [enabled]);
  useEffect(() => {
    if (!enabled || isNative || !('wakeLock' in navigator)) return;
    let lock: WakeLockSentinel | null = null;
    const acquire = async () => { try { lock = await navigator.wakeLock.request('screen'); } catch { /* ignore */ } };
    void acquire();
    const onVis = () => { if (document.visibilityState === 'visible') void acquire(); };
    document.addEventListener('visibilitychange', onVis);
    return () => { document.removeEventListener('visibilitychange', onVis); void lock?.release(); };
  }, [enabled]);
}
