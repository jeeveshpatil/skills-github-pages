import { useEffect, useRef, useState } from 'react';
import * as maplibregl from 'maplibre-gl';
import type { GeoJSONSource, Map as MLMap } from 'maplibre-gl';
import workerUrl from 'maplibre-gl/dist/maplibre-gl-worker.mjs?url';

// MapLibre resolves its worker relative to its own module URL, which bundling breaks; point it at the emitted asset.
maplibregl.setWorkerUrl(workerUrl);
import { circlePolygon } from '../lib/geo';
import type { SafeZone } from '../lib/types';

export interface MapMarker {
  id: string; lat: number; lng: number; color: string; label?: string;
  kind: 'me' | 'ally' | 'enemy' | 'reveal' | 'pin'; heading?: number | null; dim?: boolean;
}
export interface MapCircle { id: string; lat: number; lng: number; r: number; color: string; opacity?: number }
export interface MapTrack { id: string; color: string; coords: [number, number][] }

interface Props {
  center?: [number, number] | null;
  zone?: { lat: number; lng: number; radius: number; next?: number | null } | null;
  safeZones?: SafeZone[];
  markers?: MapMarker[];
  circles?: MapCircle[];
  tracks?: MapTrack[];
  onClick?: (lat: number, lng: number) => void;
  follow?: [number, number] | null;
  fitKey?: string | number;
  className?: string;
  interactive?: boolean;
  controls?: boolean;
}

const TILE = (import.meta.env.VITE_TILE_URL as string | undefined) || 'https://tile.openstreetmap.org/{z}/{x}/{y}.png';
const empty: GeoJSON.FeatureCollection = { type: 'FeatureCollection', features: [] };

function worldWithHole(lat: number, lng: number, r: number): GeoJSON.Feature {
  // hole must wind opposite to the outer ring or MapLibre treats it as a separate polygon
  const ring = circlePolygon(lat, lng, r).geometry.coordinates[0];
  return { type: 'Feature', properties: {}, geometry: { type: 'Polygon', coordinates: [[[-180, -85], [180, -85], [180, 85], [-180, 85], [-180, -85]], ring] } };
}

/** Tactical full-bleed map: MapLibre GL + OSM raster tiles with a dark/neon treatment. */
export function GameMap({ center, zone, safeZones = [], markers = [], circles = [], tracks = [], onClick, follow, fitKey, className = '', interactive = true, controls = true }: Props) {
  const el = useRef<HTMLDivElement>(null);
  const map = useRef<MLMap | null>(null);
  const htmlMarkers = useRef(new Map<string, maplibregl.Marker>());
  const [ready, setReady] = useState(false);
  const clickRef = useRef(onClick);
  clickRef.current = onClick;

  useEffect(() => {
    if (!el.current) return;
    const m = new maplibregl.Map({
      container: el.current,
      style: {
        version: 8,
        sources: { osm: { type: 'raster', tiles: [TILE], tileSize: 256, maxzoom: 19, attribution: '© OpenStreetMap contributors' } },
        layers: [
          { id: 'bg', type: 'background', paint: { 'background-color': '#05080a' } },
          { id: 'osm', type: 'raster', source: 'osm', paint: { 'raster-saturation': -0.85, 'raster-brightness-max': 0.42, 'raster-contrast': 0.25, 'raster-hue-rotate': 160 } },
        ],
      },
      center: center ? [center[1], center[0]] : [0, 20],
      zoom: center ? 15 : 1.5,
      attributionControl: { compact: true },
      interactive,
    });
    if (controls) m.addControl(new maplibregl.NavigationControl({ showCompass: true, visualizePitch: false }), 'bottom-right');
    m.on('load', () => {
      const add = (id: string) => m.addSource(id, { type: 'geojson', data: empty });
      ['outside', 'zone', 'next', 'safe', 'circles', 'tracks'].forEach(add);
      m.addLayer({ id: 'outside', type: 'fill', source: 'outside', paint: { 'fill-color': '#ff2a4a', 'fill-opacity': 0.13 } });
      m.addLayer({ id: 'zone-line', type: 'line', source: 'zone', paint: { 'line-color': '#2dffa0', 'line-width': 2.5, 'line-blur': 0.5 } });
      m.addLayer({ id: 'zone-glow', type: 'line', source: 'zone', paint: { 'line-color': '#2dffa0', 'line-width': 12, 'line-opacity': 0.12, 'line-blur': 6 } });
      m.addLayer({ id: 'next-line', type: 'line', source: 'next', paint: { 'line-color': '#22e3ff', 'line-width': 1.5, 'line-dasharray': [3, 3] } });
      m.addLayer({ id: 'safe-fill', type: 'fill', source: 'safe', paint: { 'fill-color': '#22e3ff', 'fill-opacity': 0.12 } });
      m.addLayer({ id: 'safe-line', type: 'line', source: 'safe', paint: { 'line-color': '#22e3ff', 'line-width': 1.5 } });
      m.addLayer({ id: 'circles-fill', type: 'fill', source: 'circles', paint: { 'fill-color': ['get', 'color'], 'fill-opacity': ['get', 'opacity'] } });
      m.addLayer({ id: 'circles-line', type: 'line', source: 'circles', paint: { 'line-color': ['get', 'color'], 'line-width': 1.5, 'line-opacity': ['*', ['get', 'opacity'], 3] } });
      m.addLayer({ id: 'tracks', type: 'line', source: 'tracks', layout: { 'line-cap': 'round', 'line-join': 'round' }, paint: { 'line-color': ['get', 'color'], 'line-width': 3, 'line-opacity': 0.85 } });
      setReady(true);
    });
    m.on('click', (e) => clickRef.current?.(e.lngLat.lat, e.lngLat.lng));
    map.current = m;
    const markersMap = htmlMarkers.current;
    return () => { markersMap.forEach((mk) => mk.remove()); markersMap.clear(); m.remove(); map.current = null; };
    // map is created once; later prop changes are applied by the effects below
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const set = (id: string, data: GeoJSON.FeatureCollection | GeoJSON.Feature) => (map.current?.getSource(id) as GeoJSONSource | undefined)?.setData(data);

  useEffect(() => {
    if (!ready) return;
    if (zone) {
      set('zone', circlePolygon(zone.lat, zone.lng, zone.radius));
      set('outside', worldWithHole(zone.lat, zone.lng, zone.radius));
      set('next', zone.next && zone.next < zone.radius ? circlePolygon(zone.lat, zone.lng, zone.next) : empty);
    } else { set('zone', empty); set('outside', empty); set('next', empty); }
  }, [ready, zone?.lat, zone?.lng, zone?.radius, zone?.next]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (!ready) return;
    set('safe', { type: 'FeatureCollection', features: safeZones.map((z) => circlePolygon(z.lat, z.lng, z.r)) });
  }, [ready, JSON.stringify(safeZones)]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (!ready) return;
    set('circles', { type: 'FeatureCollection', features: circles.map((c) => ({ ...circlePolygon(c.lat, c.lng, c.r, 48), properties: { color: c.color, opacity: c.opacity ?? 0.15 } })) });
  }, [ready, circles]);

  useEffect(() => {
    if (!ready) return;
    set('tracks', { type: 'FeatureCollection', features: tracks.filter((t) => t.coords.length > 1).map((t) => ({ type: 'Feature', properties: { color: t.color }, geometry: { type: 'LineString', coordinates: t.coords } })) });
  }, [ready, tracks]);

  // HTML markers (no glyph server needed)
  useEffect(() => {
    const m = map.current;
    if (!m) return;
    const store = htmlMarkers.current;
    const seen = new Set<string>();
    for (const mk of markers) {
      seen.add(mk.id);
      let marker = store.get(mk.id);
      if (!marker) {
        const node = document.createElement('div');
        marker = new maplibregl.Marker({ element: node, anchor: 'center' }).setLngLat([mk.lng, mk.lat]).addTo(m);
        store.set(mk.id, marker);
      }
      marker.setLngLat([mk.lng, mk.lat]);
      marker.getElement().innerHTML = markerHtml(mk);
    }
    for (const [id, marker] of store) if (!seen.has(id)) { marker.remove(); store.delete(id); }
  }, [markers]);

  // fit to zone when fitKey changes
  useEffect(() => {
    if (!ready || !map.current) return;
    if (zone) {
      const b = circlePolygon(zone.lat, zone.lng, zone.radius * 1.1).geometry.coordinates[0];
      const bounds = b.reduce((acc, c) => acc.extend(c as [number, number]), new maplibregl.LngLatBounds(b[0] as [number, number], b[0] as [number, number]));
      map.current.fitBounds(bounds, { padding: 40, duration: 0 });
    } else if (center) {
      map.current.jumpTo({ center: [center[1], center[0]], zoom: 15 });
    }
  }, [ready, fitKey]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (!ready || !follow || !map.current) return;
    // follow-cam keeps a street-level zoom so nearby players don't collapse into one point
    map.current.easeTo({ center: [follow[1], follow[0]], zoom: Math.max(map.current.getZoom(), 16), duration: 500 });
  }, [ready, follow?.[0], follow?.[1]]); // eslint-disable-line react-hooks/exhaustive-deps

  // inline position: maplibre-gl.css (unlayered) sets .maplibregl-map{position:relative}, which beats Tailwind layers
  return <div ref={el} className={className} style={{ position: "absolute", inset: 0 }} />;
}

function esc(s: string) { return s.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`); }

function markerHtml(m: MapMarker): string {
  const label = m.label ? `<div style="position:absolute;top:100%;left:50%;transform:translate(-50%,4px);white-space:nowrap;font:600 10px 'IBM Plex Mono',monospace;color:${m.color};background:#05080acc;padding:1px 5px;border:1px solid ${m.color}55">${esc(m.label)}</div>` : '';
  const op = m.dim ? 0.45 : 1;
  if (m.kind === 'me') {
    const cone = m.heading != null ? `<div style="position:absolute;left:50%;top:50%;width:0;height:0;border-left:9px solid transparent;border-right:9px solid transparent;border-bottom:22px solid ${m.color}55;transform:translate(-50%,-100%) rotate(${m.heading}deg);transform-origin:50% 100%"></div>` : '';
    return `<div style="position:relative;width:22px;height:22px">${cone}<div class="animate-ping-slow" style="position:absolute;inset:-6px;border-radius:50%;background:${m.color}33"></div><div style="position:absolute;inset:0;border-radius:50%;background:${m.color};border:3px solid #05080a;box-shadow:0 0 16px ${m.color}"></div>${label}</div>`;
  }
  if (m.kind === 'reveal') {
    return `<div style="position:relative;width:14px;height:14px;opacity:${op}"><div style="position:absolute;inset:0;transform:rotate(45deg);border:2px solid ${m.color};background:${m.color}33"></div>${label}</div>`;
  }
  if (m.kind === 'pin') {
    return `<div style="position:relative;width:18px;height:18px"><div style="position:absolute;inset:0;border:2px solid ${m.color};border-radius:50%"></div><div style="position:absolute;inset:6px;background:${m.color};border-radius:50%"></div>${label}</div>`;
  }
  return `<div style="position:relative;width:16px;height:16px;opacity:${op}"><div style="position:absolute;inset:0;border-radius:50%;background:${m.color};border:2px solid #05080a;box-shadow:0 0 10px ${m.color}"></div>${label}</div>`;
}
