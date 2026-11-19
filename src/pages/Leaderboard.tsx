import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { Shell } from '../components/Shell';
import { useAuth } from '../hooks/useAuth';
import { supabase } from '../lib/supabase';
import { rankFor } from '../lib/ranks';
import type { Profile } from '../lib/types';

const SORTS = [['xp', 'XP'], ['wins', 'Wins'], ['total_captures', 'Captures'], ['total_distance_m', 'Distance']] as const;

export default function Leaderboard() {
  const { profile } = useAuth();
  const [sort, setSort] = useState<(typeof SORTS)[number][0]>('xp');
  const [rows, setRows] = useState<Profile[]>([]);
  useEffect(() => {
    supabase.from('profiles').select('*').gt('matches_played', 0).order(sort, { ascending: false }).limit(100).then(({ data }) => setRows((data ?? []) as Profile[]));
  }, [sort]);
  return (
    <Shell>
      <h1 className="text-3xl font-bold">Global ranks</h1>
      <div className="flex gap-2 mt-4">
        {SORTS.map(([k, l]) => <button key={k} onClick={() => setSort(k)} className={`chamfer-sm px-3 h-8 text-xs font-mono uppercase border ${sort === k ? 'border-neon text-neon bg-neon/10' : 'border-line text-mute'}`}>{l}</button>)}
      </div>
      <div className="panel chamfer mt-4 divide-y divide-line">
        {rows.length === 0 && <p className="p-6 text-mute text-sm">No ranked agents yet — finish a match to appear here.</p>}
        {rows.map((p, i) => (
          <Link key={p.id} to={`/profile/${p.id}`} className={`flex items-center gap-3 px-4 py-3 hover:bg-white/[0.02] ${p.id === profile?.id ? 'bg-cyan/5' : ''}`}>
            <span className={`font-display text-lg w-8 ${i < 3 ? 'text-neon glow' : 'text-mute'}`}>{i + 1}</span>
            <span className="flex-1 min-w-0"><span className="block text-white truncate">{p.username}</span><span className="font-mono text-[10px] text-mute">{rankFor(p.xp).name} · {p.matches_played} matches</span></span>
            <span className="font-mono text-sm text-cyan tabular-nums">
              {sort === 'total_distance_m' ? `${(p.total_distance_m / 1000).toFixed(1)} km` : p[sort]}
            </span>
          </Link>
        ))}
      </div>
    </Shell>
  );
}
