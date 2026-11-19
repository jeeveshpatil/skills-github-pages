import { useEffect, useState } from 'react';
import { Shell } from '../components/Shell';
import { GameMap } from '../components/GameMap';
import { Button, Field, Panel, Slider, Toggle, errMsg, inputCls, useToast } from '../components/ui';
import { useAuth } from '../hooks/useAuth';
import { supabase } from '../lib/supabase';
import { formatDistance } from '../lib/geo';
import type { GameMap as GM, LatLng, SafeZone } from '../lib/types';

/** Custom arena editor: boundary (centre + radius) and up to 10 safe zones, reusable across matches. */
export default function Maps() {
  const { profile } = useAuth();
  const toast = useToast();
  const [maps, setMaps] = useState<GM[]>([]);
  const [editId, setEditId] = useState<string | null>(null);
  const [name, setName] = useState('');
  const [center, setCenter] = useState<[number, number] | null>(null);
  const [radius, setRadius] = useState(600);
  const [safe, setSafe] = useState<SafeZone[]>([]);
  const [boundary, setBoundary] = useState<LatLng[]>([]);
  const [pub, setPub] = useState(false);
  const [tool, setTool] = useState<'center' | 'safe' | 'boundary'>('center');
  const [fit, setFit] = useState(0);

  const load = () => supabase.from('maps').select('*').order('created_at', { ascending: false }).then(({ data }) => setMaps((data ?? []) as GM[]));
  useEffect(() => { void load(); }, []);

  const reset = () => { setEditId(null); setName(''); setCenter(null); setSafe([]); setBoundary([]); setRadius(600); setPub(false); };
  const edit = (m: GM) => { setEditId(m.id); setName(m.name); setCenter([m.center_lat, m.center_lng]); setRadius(m.radius_m); setSafe(m.safe_zones); setBoundary(m.boundary ?? []); setPub(m.is_public); setFit((f) => f + 1); };
  const save = async () => {
    if (!center) return toast('Tap the map to set the arena centre', 'warn');
    const row = { owner_id: profile!.id, name: name.trim(), center_lat: center[0], center_lng: center[1], radius_m: radius, safe_zones: safe, boundary: boundary.length >= 3 ? boundary : null, is_public: pub };
    const { error } = editId ? await supabase.from('maps').update(row).eq('id', editId) : await supabase.from('maps').insert(row);
    if (error) return toast(errMsg(error.message), 'error');
    toast('Map saved', 'success'); reset(); void load();
  };
  const del = async (id: string) => { const { error } = await supabase.from('maps').delete().eq('id', id); if (error) toast(error.message, 'error'); else void load(); };

  return (
    <Shell wide>
      <h1 className="text-3xl font-bold">Arena maps</h1>
      <p className="text-mute mt-1">Design reusable boundaries and safe zones. Choose public arenas carefully: open spaces, low traffic, public land.</p>
      <div className="grid lg:grid-cols-[1.4fr_1fr] gap-4 mt-5">
        <Panel title={editId ? 'Edit arena' : 'New arena'} right={
          <div className="flex gap-1">{(['center', 'safe', 'boundary'] as const).map((k) => <button key={k} onClick={() => setTool(k)} className={`font-mono text-[10px] px-2 py-1 border ${tool === k ? 'border-cyan text-cyan' : 'border-line text-mute'}`}>{k === 'center' ? 'CENTRE' : k === 'safe' ? 'SAFE ZONE' : 'BOUNDARY'}</button>)}</div>}>
          <div className="relative h-80 sm:h-[440px] chamfer-sm overflow-hidden border border-line">
            <GameMap center={center} zone={center ? { lat: center[0], lng: center[1], radius } : null} safeZones={safe} boundary={boundary} fitKey={fit}
              markers={center ? [{ id: 'c', lat: center[0], lng: center[1], kind: 'pin', color: '#2dffa0' }] : []}
              onClick={(lat, lng) => tool === 'center' ? setCenter([lat, lng]) : tool === 'boundary' ? setBoundary((b) => [...b, { lat, lng }].slice(0, 50)) : safe.length < 10 && setSafe([...safe, { name: `Safe ${safe.length + 1}`, lat, lng, r: 25 }])} />
          </div>
          <div className="grid sm:grid-cols-2 gap-4 mt-4">
            <Field label="Name"><input className={inputCls} maxLength={60} value={name} onChange={(e) => setName(e.target.value)} /></Field>
            <Slider label="Boundary radius" value={radius} min={50} max={5000} step={50} onChange={setRadius} format={formatDistance} />
          </div>
          {safe.length > 0 && (
            <ul className="mt-3 space-y-1.5">{safe.map((z, i) => (
              <li key={i} className="flex items-center gap-2 text-xs">
                <input className={`${inputCls} !h-8 flex-1`} value={z.name} onChange={(e) => setSafe(safe.map((x, j) => (j === i ? { ...x, name: e.target.value } : x)))} />
                <input type="range" min={5} max={200} value={z.r} onChange={(e) => setSafe(safe.map((x, j) => (j === i ? { ...x, r: Number(e.target.value) } : x)))} />
                <span className="font-mono w-10 text-cyan">{z.r}m</span>
                <button className="font-mono text-danger" onClick={() => setSafe(safe.filter((_, j) => j !== i))}>✕</button>
              </li>
            ))}</ul>
          )}
          <Toggle label="Share publicly" desc="Other hosts can load this arena" checked={pub} onChange={setPub} />
          <div className="flex gap-2 mt-2">
            <Button onClick={save} disabled={name.trim().length < 2}>{editId ? 'Update' : 'Save arena'}</Button>
            {editId && <Button variant="ghost" onClick={reset}>Cancel</Button>}
            {boundary.length > 0 && <Button variant="subtle" onClick={() => setBoundary([])}>Clear boundary</Button>}
            <Button variant="subtle" onClick={() => navigator.geolocation?.getCurrentPosition((p) => { setCenter([p.coords.latitude, p.coords.longitude]); setFit((f) => f + 1); })}>My location</Button>
          </div>
        </Panel>
        <Panel title="Arenas">
          {maps.length === 0 ? <p className="text-sm text-mute">No arenas yet.</p> : (
            <ul className="divide-y divide-line">{maps.map((m) => (
              <li key={m.id} className="flex items-center justify-between py-2.5 gap-2">
                <span className="min-w-0"><span className="block text-white text-sm truncate">{m.name}</span><span className="font-mono text-[10px] text-mute">{formatDistance(m.radius_m)} · {m.safe_zones.length} safe{m.boundary ? ' · boundary' : ''} · {m.is_public ? 'public' : 'private'}</span></span>
                {m.owner_id === profile!.id ? <span className="flex gap-2 font-mono text-[10px]"><button className="text-cyan" onClick={() => edit(m)}>EDIT</button><button className="text-danger" onClick={() => del(m.id)}>DEL</button></span> : <span className="font-mono text-[10px] text-mute">SHARED</span>}
              </li>
            ))}</ul>
          )}
        </Panel>
      </div>
    </Shell>
  );
}
