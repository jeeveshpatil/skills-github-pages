import { useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { Shell } from '../components/Shell';
import { GetApp } from '../components/GetApp';
import { Button, Panel, inputCls } from '../components/ui';
import { useAuth } from '../hooks/useAuth';
import { MODES, winnerLabel } from '../lib/modes';
import { rankFor } from '../lib/ranks';
import { supabase } from '../lib/supabase';
import type { Mode, Room } from '../lib/types';
import { formatDistance } from '../lib/geo';

type Recent = { room_id: string; won: boolean; xp: number; created_at: string; rooms: Pick<Room, 'name' | 'mode' | 'winner'> | null };

export default function Home() {
  const { profile } = useAuth();
  const nav = useNavigate();
  const [code, setCode] = useState('');
  const [active, setActive] = useState<Pick<Room, 'id' | 'name' | 'status' | 'code'>[]>([]);
  const [recent, setRecent] = useState<Recent[]>([]);
  const rank = rankFor(profile!.xp);

  useEffect(() => {
    // rooms I'm still in (reconnect)
    supabase.from('players').select('room_id, rooms!inner(id,name,status,code)').eq('user_id', profile!.id).neq('rooms.status', 'ended').neq('status', 'left')
      .then(({ data }) => setActive(((data ?? []) as unknown as { rooms: Pick<Room, 'id' | 'name' | 'status' | 'code'> }[]).map((d) => d.rooms)));
    supabase.from('match_results').select('room_id, won, xp, created_at, rooms(name, mode, winner)').eq('user_id', profile!.id).order('created_at', { ascending: false }).limit(5)
      .then(({ data }) => setRecent((data ?? []) as unknown as Recent[]));
  }, [profile]);

  return (
    <Shell>
      {active.length > 0 && (
        <div className="mb-5 space-y-2">
          {active.map((r) => (
            <Link key={r.id} to={`/room/${r.id}`} className="flex items-center justify-between chamfer-sm border border-amber/50 bg-amber/10 px-4 py-3 rise">
              <span><span className="label !text-amber">Reconnect</span><span className="block text-white font-display">{r.name} · {r.code}</span></span>
              <span className="font-mono text-xs text-amber uppercase">{r.status} →</span>
            </Link>
          ))}
        </div>
      )}

      <section className="relative panel brackets chamfer overflow-hidden p-6 sm:p-8 scan">
        <div className="absolute -right-24 -top-24 size-80 rounded-full border border-neon/15" />
        <div className="absolute -right-10 -top-10 size-52 rounded-full sweep" style={{ background: 'conic-gradient(from 0deg, transparent 78%, #2dffa040)' }} />
        <div className="relative">
          <span className="label">Agent {profile!.username} · {rank.name}</span>
          <h1 className="text-3xl sm:text-5xl font-bold mt-2 leading-tight">Ready for <span className="text-neon glow">deployment</span>?</h1>
          <div className="mt-4 max-w-sm">
            <div className="h-1.5 bg-line"><div className="h-full bg-neon" style={{ width: `${rank.progress * 100}%` }} /></div>
            <div className="font-mono text-[10px] text-mute mt-1">{rank.next ? `${rank.toNext} XP to ${rank.next}` : 'Max rank'}</div>
          </div>
          <div className="mt-6 grid sm:grid-cols-[auto_auto_1fr] gap-2 max-w-2xl">
            <Button size="lg" onClick={() => nav('/create')}>Host a game</Button>
            <Button size="lg" variant="cyan" onClick={() => nav('/play')}>Matchmaking</Button>
            <form className="flex gap-2" onSubmit={(e) => { e.preventDefault(); if (code.trim()) nav(`/join/${code.trim().toUpperCase()}`); }}>
              <input className={`${inputCls} !h-14 font-mono text-lg tracking-[0.3em] uppercase`} placeholder="CODE" maxLength={6} value={code} onChange={(e) => setCode(e.target.value.toUpperCase())} />
              <Button size="lg" variant="ghost" type="submit">Join</Button>
            </form>
          </div>
        </div>
      </section>

      <GetApp className="mt-4" />

      <h2 className="label mt-8 mb-3">Game modes</h2>
      <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-3">
        {MODES.map((m, i) => (
          <button key={m.id} onClick={() => nav(`/create?mode=${m.id}`)} className="text-left panel chamfer p-4 hover:border-neon/60 transition-colors group rise" style={{ animationDelay: `${i * 0.05}s` }}>
            <div className="flex items-center justify-between">
              <span className="font-mono text-xs text-neon">{m.tag}</span>
              <ModeGlyph mode={m.id} />
            </div>
            <h3 className="text-lg mt-2 group-hover:text-neon transition-colors">{m.name}</h3>
            <p className="text-sm text-mute mt-1">{m.blurb}</p>
          </button>
        ))}
      </div>

      <div className="grid lg:grid-cols-2 gap-4 mt-8">
        <Panel title="Recent operations" right={<Link to="/profile" className="font-mono text-[10px] text-cyan">ALL →</Link>}>
          {recent.length === 0 ? <p className="text-sm text-mute">No matches yet. Your history and replays will appear here.</p> : (
            <ul className="divide-y divide-line">
              {recent.map((r) => (
                <li key={r.room_id}><Link to={`/room/${r.room_id}`} className="flex items-center justify-between py-2.5 hover:text-white">
                  <span><span className="block text-white text-sm">{r.rooms?.name}</span><span className="font-mono text-[10px] text-mute">{r.rooms ? winnerLabel(r.rooms) : ''}</span></span>
                  <span className={`font-mono text-xs ${r.won ? 'text-neon' : 'text-danger'}`}>{r.won ? 'WIN' : 'LOSS'} · +{r.xp}</span>
                </Link></li>
              ))}
            </ul>
          )}
        </Panel>
        <Panel title="Service record">
          <div className="grid grid-cols-2 gap-3">
            {[['Matches', profile!.matches_played], ['Wins', profile!.wins], ['Captures', profile!.total_captures], ['Distance', formatDistance(profile!.total_distance_m)]].map(([k, v]) => (
              <div key={k} className="bg-ink-2 border border-line p-3 chamfer-sm"><div className="label">{k}</div><div className="font-display text-2xl text-white mt-1">{v}</div></div>
            ))}
          </div>
        </Panel>
      </div>

      <Panel title="Field safety" className="mt-4">
        <ul className="text-sm space-y-1.5 list-disc pl-5 marker:text-neon">
          <li>Never run across roads or play near traffic, water, railways or construction.</li>
          <li>Any player can hit <span className="text-danger font-mono">SOS</span> to pause the match for everyone instantly.</li>
          <li>Opponents never see your exact position — only blurred, scheduled reveals generated by the server.</li>
        </ul>
      </Panel>
    </Shell>
  );
}

function ModeGlyph({ mode }: { mode: Mode }) {
  const p: Record<Mode, string> = {
    classic: 'M12 3v4M12 17v4M3 12h4M17 12h4M12 8a4 4 0 100 8 4 4 0 000-8z',
    battle_royale: 'M12 2a10 10 0 100 20 10 10 0 000-20zM12 7a5 5 0 100 10 5 5 0 000-10z',
    team_vs_team: 'M4 5l7 7-7 7M20 5l-7 7 7 7',
    infection: 'M12 4a8 8 0 100 16 8 8 0 000-16zM12 1v3M12 20v3M1 12h3M20 12h3M4 4l2 2M18 18l2 2M4 20l2-2M18 6l2-2',
    last_shadow: 'M12 3l3 6 6 1-4.5 4.5L18 21l-6-3-6 3 1.5-6.5L3 10l6-1z',
  };
  return <svg viewBox="0 0 24 24" className="size-6 text-cyan" fill="none" stroke="currentColor" strokeWidth="1.5"><path d={p[mode]} /></svg>;
}
