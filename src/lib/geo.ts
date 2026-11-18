import type { Room } from './types';

const R = 6371000;
const rad = (d: number) => (d * Math.PI) / 180;

/** Great-circle distance in metres (haversine). Mirrors public.geo_dist. */
export function distance(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const a = Math.sin(rad(lat2 - lat1) / 2) ** 2 + Math.cos(rad(lat1)) * Math.cos(rad(lat2)) * Math.sin(rad(lng2 - lng1) / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(a));
}

/** Initial bearing from point 1 to point 2, degrees clockwise from north. */
export function bearing(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const y = Math.sin(rad(lng2 - lng1)) * Math.cos(rad(lat2));
  const x = Math.cos(rad(lat1)) * Math.sin(rad(lat2)) - Math.sin(rad(lat1)) * Math.cos(rad(lat2)) * Math.cos(rad(lng2 - lng1));
  return ((Math.atan2(y, x) * 180) / Math.PI + 360) % 360;
}

/** Zone radius at time t (ms). Mirrors public.zone_radius — keep in sync. */
export function zoneRadiusAt(room: Pick<Room, 'headstart_ends_at' | 'ends_at' | 'zone_start_m' | 'zone_end_m' | 'zone_steps' | 'status' | 'paused_at'>, t: number): number {
  if (!room.headstart_ends_at || !room.ends_at) return room.zone_start_m;
  if (room.status === 'paused' && room.paused_at) t = Date.parse(room.paused_at);
  const start = Date.parse(room.headstart_ends_at);
  const total = Date.parse(room.ends_at) - start;
  if (total <= 0) return room.zone_end_m;
  let p = Math.max(0, Math.min(1, (t - start) / total));
  if (room.zone_steps > 0) p = Math.floor(p * room.zone_steps) / room.zone_steps;
  return room.zone_start_m - (room.zone_start_m - room.zone_end_m) * p;
}

/** Time (ms) of the next zone shrink step, or null. */
export function nextShrinkAt(room: Pick<Room, 'headstart_ends_at' | 'ends_at' | 'zone_steps'>, now: number): number | null {
  if (!room.headstart_ends_at || !room.ends_at || room.zone_steps <= 0) return null;
  const start = Date.parse(room.headstart_ends_at);
  const step = (Date.parse(room.ends_at) - start) / room.zone_steps;
  if (now < start) return start + step;
  const k = Math.floor((now - start) / step) + 1;
  return k >= room.zone_steps ? null : start + k * step;
}

/** GeoJSON polygon approximating a circle. */
export function circlePolygon(lat: number, lng: number, radiusM: number, steps = 64): GeoJSON.Feature<GeoJSON.Polygon> {
  const coords: [number, number][] = [];
  for (let i = 0; i <= steps; i++) {
    const a = (i / steps) * 2 * Math.PI;
    const dLat = (radiusM * Math.cos(a)) / 111320;
    const dLng = (radiusM * Math.sin(a)) / (111320 * Math.max(0.01, Math.cos(rad(lat))));
    coords.push([lng + dLng, lat + dLat]);
  }
  return { type: 'Feature', properties: {}, geometry: { type: 'Polygon', coordinates: [coords] } };
}

export function formatDistance(m: number): string {
  if (!Number.isFinite(m)) return '—';
  return m >= 1000 ? `${(m / 1000).toFixed(m >= 10000 ? 0 : 1)} km` : `${Math.round(m)} m`;
}

export function formatClock(ms: number): string {
  const s = Math.max(0, Math.round(ms / 1000));
  const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), sec = s % 60;
  const mm = String(m).padStart(2, '0'), ss = String(sec).padStart(2, '0');
  return h ? `${h}:${mm}:${ss}` : `${mm}:${ss}`;
}

export function cardinal(deg: number): string {
  return ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW'][Math.round(deg / 45) % 8];
}
