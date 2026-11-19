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

type ZoneRoom = Pick<Room, 'headstart_ends_at' | 'ends_at' | 'zone_start_m' | 'zone_end_m' | 'zone_steps' | 'status' | 'paused_at'>;

/** Shrink progress 0..1 at time t (ms). Mirrors public.zone_progress — keep in sync. */
export function zoneProgressAt(room: Omit<ZoneRoom, 'zone_start_m' | 'zone_end_m'>, t: number): number {
  if (!room.headstart_ends_at || !room.ends_at) return 0;
  if (room.status === 'paused' && room.paused_at) t = Date.parse(room.paused_at);
  const start = Date.parse(room.headstart_ends_at);
  const total = Date.parse(room.ends_at) - start;
  if (total <= 0) return 1;
  let p = Math.max(0, Math.min(1, (t - start) / total));
  if (room.zone_steps > 0) p = Math.floor(p * room.zone_steps) / room.zone_steps;
  return p;
}

/** Zone radius at time t (ms). Mirrors public.zone_radius. */
export function zoneRadiusAt(room: ZoneRoom, t: number): number {
  return room.zone_start_m - (room.zone_start_m - room.zone_end_m) * zoneProgressAt(room, t);
}

/** Zone centre at time t (moving zone slides toward zone_end_*). Mirrors public.zone_center_lat/lng. */
export function zoneCenterAt(room: ZoneRoom & Pick<Room, 'zone_lat' | 'zone_lng' | 'zone_end_lat' | 'zone_end_lng'>, t: number): { lat: number; lng: number } | null {
  if (room.zone_lat == null || room.zone_lng == null) return null;
  const p = zoneProgressAt(room, t);
  return {
    lat: room.zone_lat + ((room.zone_end_lat ?? room.zone_lat) - room.zone_lat) * p,
    lng: room.zone_lng + ((room.zone_end_lng ?? room.zone_lng) - room.zone_lng) * p,
  };
}

/** Ray-casting point-in-polygon. Mirrors public.in_polygon (fewer than 3 points = no boundary). */
export function inPolygon(poly: { lat: number; lng: number }[] | null | undefined, lat: number, lng: number): boolean {
  if (!poly || poly.length < 3) return true;
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const { lng: xi, lat: yi } = poly[i], { lng: xj, lat: yj } = poly[j];
    if (yi > lat !== yj > lat && lng < ((xj - xi) * (lat - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
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
