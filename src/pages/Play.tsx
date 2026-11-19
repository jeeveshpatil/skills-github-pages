import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Shell } from '../components/Shell';
import { Button, Panel, errMsg, inputCls, useToast } from '../components/ui';
import { api } from '../lib/api';
import { MODES, modeInfo } from '../lib/modes';
import type { Mode } from '../lib/types';

type Pub = Awaited<ReturnType<typeof api.listPublicRooms>>[number];

export default function Play() {
  const nav = useNavigate();
  const toast = useToast();
  const [rooms, setRooms] = useState<Pub[] | null>(null);
  const [mode, setMode] = useState<Mode | ''>('');
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let live = true;
    const load = () => api.listPublicRooms().then((r) => live && setRooms(r)).catch(() => live && setRooms([]));
    load();
    const t = setInterval(load, 8000);
    return () => { live = false; clearInterval(t); };
  }, []);

  const quick = async () => {
    setBusy(true);
    try {
      const id = await api.quickMatch(mode || undefined);
      if (id) nav(`/room/${id}`);
      else toast('No open lobbies right now — host one and it will appear here for others', 'info');
    } catch (e) { toast(errMsg(e), 'error'); } finally { setBusy(false); }
  };
  const join = async (c: string) => {
    try { nav(`/room/${await api.joinRoom(c)}`); } catch (e) { toast(errMsg(e), 'error'); }
  };

  const shown = (rooms ?? []).filter((r) => !mode || r.mode === mode);
  return (
    <Shell>
      <h1 className="text-3xl font-bold">Matchmaking</h1>
      <p className="text-mute mt-1">Jump into a public lobby, join with a code, or spectate a live match.</p>

      <div className="grid md:grid-cols-[1.4fr_1fr] gap-4 mt-6">
        <Panel title="Quick match">
          <div className="flex flex-wrap gap-2">
            <Chip on={mode === ''} onClick={() => setMode('')}>Any mode</Chip>
            {MODES.map((m) => <Chip key={m.id} on={mode === m.id} onClick={() => setMode(m.id)}>{m.name}</Chip>)}
          </div>
          <Button size="lg" className="w-full mt-4" onClick={quick} loading={busy}>Find a lobby</Button>
        </Panel>
        <Panel title="Private room / spectate">
          <input className={`${inputCls} font-mono tracking-[0.3em] uppercase text-lg`} placeholder="ROOM CODE" maxLength={6} value={code} onChange={(e) => setCode(e.target.value.toUpperCase())} />
          <div className="grid grid-cols-2 gap-2 mt-3">
            <Button variant="ghost" onClick={() => code && nav(`/join/${code}`)}>Join</Button>
            <Button variant="subtle" onClick={() => code && nav(`/join/${code}?spectate=1`)}>Spectate</Button>
          </div>
        </Panel>
      </div>

      <div className="flex items-center justify-between mt-8 mb-3">
        <h2 className="label">Open lobbies {rooms && `(${shown.length})`}</h2>
        <span className="flex items-center gap-2 font-mono text-[10px] text-neon"><span className="size-1.5 rounded-full bg-neon flash" />LIVE</span>
      </div>
      {rooms === null ? <p className="text-mute text-sm">Scanning…</p> : shown.length === 0 ? (
        <div className="panel chamfer p-8 text-center">
          <p className="text-mute">No public lobbies are open{mode && ' for this mode'}.</p>
          <Button className="mt-4" onClick={() => nav('/create')}>Host one</Button>
        </div>
      ) : (
        <div className="grid sm:grid-cols-2 gap-3">
          {shown.map((r) => (
            <div key={r.id} className="panel chamfer p-4 flex items-center justify-between gap-3 rise">
              <div className="min-w-0">
                <div className="font-mono text-[10px] text-neon">{modeInfo(r.mode as Mode).tag} · {r.code}</div>
                <div className="font-display text-white truncate">{r.name}</div>
                <div className="text-xs text-mute">Host {r.host_name} · {r.players}/{r.max_players} players</div>
              </div>
              <Button size="sm" disabled={r.players >= r.max_players} onClick={() => join(r.code)}>Join</Button>
            </div>
          ))}
        </div>
      )}
    </Shell>
  );
}

function Chip({ on, onClick, children }: { on: boolean; onClick: () => void; children: React.ReactNode }) {
  return <button onClick={onClick} className={`chamfer-sm px-3 h-8 text-xs font-mono uppercase border ${on ? 'border-neon text-neon bg-neon/10' : 'border-line text-mute'}`}>{children}</button>;
}
