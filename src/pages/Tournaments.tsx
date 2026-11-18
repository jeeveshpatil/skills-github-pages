import { useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { Shell } from '../components/Shell';
import { Button, Panel, errMsg, inputCls, useToast } from '../components/ui';
import { api } from '../lib/api';
import { supabase } from '../lib/supabase';
import type { Tournament } from '../lib/types';

export default function Tournaments() {
  const nav = useNavigate();
  const toast = useToast();
  const [list, setList] = useState<Tournament[]>([]);
  const [name, setName] = useState('');
  useEffect(() => { supabase.from('tournaments').select('*').order('created_at', { ascending: false }).limit(50).then(({ data }) => setList((data ?? []) as Tournament[])); }, []);
  const create = async () => {
    try { nav(`/tournaments/${await api.createTournament(name)}`); } catch (e) { toast(errMsg(e), 'error'); }
  };
  return (
    <Shell>
      <h1 className="text-3xl font-bold">Tournaments</h1>
      <p className="text-mute mt-1">Group matches into a series. Points: win 3 · capture 1 · survive 10+ min 1.</p>
      <Panel title="New tournament" className="mt-5">
        <div className="flex gap-2"><input className={inputCls} placeholder="e.g. Friday Night Hunt S1" maxLength={60} value={name} onChange={(e) => setName(e.target.value)} /><Button onClick={create} disabled={name.trim().length < 2}>Create</Button></div>
      </Panel>
      <div className="grid sm:grid-cols-2 gap-3 mt-4">
        {list.map((t) => (
          <Link key={t.id} to={`/tournaments/${t.id}`} className="panel chamfer p-4 hover:border-neon/50">
            <div className={`font-mono text-[10px] ${t.status === 'open' ? 'text-neon' : 'text-mute'}`}>{t.status.toUpperCase()}</div>
            <div className="font-display text-white text-lg">{t.name}</div>
            <div className="text-xs text-mute">{new Date(t.created_at).toLocaleDateString()}</div>
          </Link>
        ))}
      </div>
    </Shell>
  );
}
