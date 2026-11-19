import { useEffect, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { Shell } from '../components/Shell';
import { Button, Panel, errMsg, useToast } from '../components/ui';
import { useAuth } from '../hooks/useAuth';
import { api } from '../lib/api';
import { supabase } from '../lib/supabase';
import { modeInfo, winnerLabel } from '../lib/modes';
import type { Mode, Tournament } from '../lib/types';

export default function TournamentDetail() {
  const { id } = useParams();
  const { profile } = useAuth();
  const nav = useNavigate();
  const toast = useToast();
  const [t, setT] = useState<Tournament | null>(null);
  const [standings, setStandings] = useState<Awaited<ReturnType<typeof api.tournamentStandings>>>([]);
  const [matches, setMatches] = useState<Awaited<ReturnType<typeof api.tournamentMatches>>>([]);
  const load = () => {
    supabase.from('tournaments').select('*').eq('id', id!).maybeSingle().then(({ data }) => setT(data as Tournament));
    api.tournamentStandings(id!).then(setStandings).catch(() => {});
    api.tournamentMatches(id!).then(setMatches).catch(() => {});
  };
  useEffect(load, [id]);
  if (!t) return <Shell><p className="text-mute">Loading…</p></Shell>;
  const owner = t.owner_id === profile!.id;
  return (
    <Shell>
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div><div className={`font-mono text-xs ${t.status === 'open' ? 'text-neon' : 'text-mute'}`}>{t.status.toUpperCase()} TOURNAMENT</div><h1 className="text-3xl font-bold">{t.name}</h1></div>
        {owner && t.status === 'open' && (
          <div className="flex gap-2">
            <Button onClick={() => nav(`/create?tournament=${t.id}`)}>New match</Button>
            <Button variant="ghost" onClick={() => api.closeTournament(t.id).then(load).catch((e) => toast(errMsg(e), 'error'))}>Close</Button>
          </div>
        )}
      </div>
      <div className="grid lg:grid-cols-2 gap-4 mt-5">
        <Panel title="Standings">
          {standings.length === 0 ? <p className="text-sm text-mute">No completed matches yet.</p> : (
            <table className="w-full text-sm"><thead><tr className="label text-left"><th className="font-normal pb-2">#</th><th className="font-normal">Agent</th><th className="font-normal text-right">M</th><th className="font-normal text-right">W</th><th className="font-normal text-right">Caps</th><th className="font-normal text-right">Pts</th></tr></thead>
              <tbody className="divide-y divide-line">{standings.map((s, i) => (
                <tr key={s.user_id}><td className={`py-2 font-display ${i === 0 ? 'text-neon' : 'text-mute'}`}>{i + 1}</td><td className="text-white">{s.username}</td><td className="text-right font-mono">{s.matches}</td><td className="text-right font-mono">{s.wins}</td><td className="text-right font-mono">{s.captures}</td><td className="text-right font-mono text-cyan">{s.points}</td></tr>
              ))}</tbody></table>
          )}
        </Panel>
        <Panel title="Matches">
          {matches.length === 0 ? <p className="text-sm text-mute">{owner ? 'Create a match — it will be linked to this tournament.' : 'No matches yet.'}</p> : (
            <ul className="divide-y divide-line">{matches.map((m) => (
              <li key={m.id}><Link to={`/room/${m.id}`} className="flex justify-between py-2.5"><span><span className="block text-white text-sm">{m.name}</span><span className="font-mono text-[10px] text-mute">{modeInfo(m.mode as Mode).name} · {m.players} players</span></span>
                <span className="font-mono text-xs text-soft">{m.status === 'ended' ? winnerLabel({ winner: m.winner, mode: m.mode as Mode }) : m.status.toUpperCase()}</span></Link></li>
            ))}</ul>
          )}
        </Panel>
      </div>
    </Shell>
  );
}
