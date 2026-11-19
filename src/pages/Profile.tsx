import { useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { Shell } from '../components/Shell';
import { Button, Field, Panel, Toggle, errMsg, inputCls, useToast } from '../components/ui';
import { useAuth } from '../hooks/useAuth';
import { supabase } from '../lib/supabase';
import { api } from '../lib/api';
import { currentSubscription, disablePush, enablePush, pushSupported } from '../lib/push';
import { ACHIEVEMENTS, RANKS, rankFor } from '../lib/ranks';
import { formatClock, formatDistance } from '../lib/geo';
import { modeInfo } from '../lib/modes';
import type { MatchResult, Profile as P, Room } from '../lib/types';

type Row = MatchResult & { rooms: Pick<Room, 'name' | 'mode' | 'winner'> | null };

export default function Profile() {
  const { id } = useParams();
  const { profile: me, refreshProfile, signOut, session } = useAuth();
  const toast = useToast();
  const own = !id || id === me!.id;
  const [p, setP] = useState<P | null>(own ? me : null);
  const [ach, setAch] = useState<{ code: string; unlocked_at: string }[]>([]);
  const [hist, setHist] = useState<Row[]>([]);
  const [name, setName] = useState(me!.username);
  const [push, setPush] = useState<boolean | null>(null);
  useEffect(() => { if (own) currentSubscription().then((s) => setPush(!!s)).catch(() => setPush(false)); }, [own]);
  const togglePush = async (on: boolean) => {
    try { if (on) await enablePush(); else await disablePush(); setPush(on); toast(on ? 'Match alerts enabled on this device' : 'Match alerts disabled', 'success'); }
    catch (e) { toast(errMsg(e), 'error'); }
  };
  const uid = own ? me!.id : id!;

  useEffect(() => {
    if (!own) supabase.from('profiles').select('*').eq('id', uid).maybeSingle().then(({ data }) => setP(data as P));
    else setP(me);
    supabase.from('achievements').select('code, unlocked_at').eq('user_id', uid).then(({ data }) => setAch(data ?? []));
    supabase.from('match_results').select('*, rooms(name, mode, winner)').eq('user_id', uid).order('created_at', { ascending: false }).limit(30).then(({ data }) => setHist((data ?? []) as Row[]));
  }, [uid, own, me]);

  if (!p) return <Shell><p className="text-mute">Loading…</p></Shell>;
  const rank = rankFor(p.xp);
  const winRate = p.matches_played ? Math.round((p.wins / p.matches_played) * 100) : 0;

  const saveName = async () => {
    const { error } = await supabase.from('profiles').update({ username: name.trim() }).eq('id', me!.id);
    if (error) toast(errMsg(error.message), 'error'); else { toast('Callsign updated', 'success'); await refreshProfile(); }
  };

  return (
    <Shell>
      <section className="panel brackets chamfer p-6 relative overflow-hidden">
        <div className="absolute right-0 top-0 font-display text-[140px] leading-none text-white/[0.03] select-none">{String(rank.index + 1).padStart(2, '0')}</div>
        <div className="flex items-center gap-4">
          <div className="size-16 chamfer bg-panel-2 border border-neon/50 grid place-items-center font-display text-2xl text-neon">{p.username.slice(0, 2).toUpperCase()}</div>
          <div>
            <h1 className="text-3xl font-bold">{p.username}</h1>
            <div className="font-mono text-xs text-neon">{rank.name.toUpperCase()} · {p.xp} XP</div>
          </div>
        </div>
        <div className="mt-5 max-w-md">
          <div className="flex gap-1">{RANKS.map((r, i) => <div key={r.name} className={`h-1.5 flex-1 ${i < rank.index ? 'bg-neon' : i === rank.index ? 'bg-line' : 'bg-line/50'}`}>{i === rank.index && <div className="h-full bg-neon" style={{ width: `${rank.progress * 100}%` }} />}</div>)}</div>
          <div className="font-mono text-[10px] text-mute mt-1">{rank.next ? `${rank.toNext} XP to ${rank.next}` : 'Maximum rank reached'}</div>
        </div>
        <div className="grid grid-cols-2 sm:grid-cols-5 gap-2 mt-5">
          {[['Matches', p.matches_played], ['Wins', p.wins], ['Win rate', `${winRate}%`], ['Captures', p.total_captures], ['Distance', formatDistance(p.total_distance_m)]].map(([k, v]) => (
            <div key={k} className="bg-ink-2 border border-line p-3 chamfer-sm"><div className="label">{k}</div><div className="font-display text-xl text-white">{v}</div></div>
          ))}
        </div>
      </section>

      <Panel title={`Achievements · ${ach.length}/${Object.keys(ACHIEVEMENTS).length}`} className="mt-4">
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-2">
          {Object.entries(ACHIEVEMENTS).map(([code, a]) => {
            const got = ach.find((x) => x.code === code);
            return (
              <div key={code} className={`chamfer-sm border p-3 ${got ? 'border-amber/50 bg-amber/5' : 'border-line opacity-50'}`}>
                <div className={`font-display text-sm ${got ? 'text-amber' : 'text-soft'}`}>{got ? '★ ' : '☆ '}{a.name}</div>
                <div className="text-[11px] text-mute mt-0.5">{a.desc}</div>
              </div>
            );
          })}
        </div>
      </Panel>

      <Panel title="Match history" className="mt-4">
        {hist.length === 0 ? <p className="text-sm text-mute">No matches yet.</p> : (
          <ul className="divide-y divide-line">
            {hist.map((h) => (
              <li key={h.room_id}><Link to={`/room/${h.room_id}`} className="flex items-center gap-3 py-2.5 hover:bg-white/[0.02]">
                <span className={`font-mono text-xs w-8 ${h.won ? 'text-neon' : 'text-danger'}`}>{h.won ? 'WIN' : 'LOSS'}</span>
                <span className="flex-1 min-w-0"><span className="block text-white text-sm truncate">{h.rooms?.name}</span>
                  <span className="font-mono text-[10px] text-mute">{h.rooms ? modeInfo(h.rooms.mode).name : ''} · {new Date(h.created_at).toLocaleDateString()}</span></span>
                <span className="font-mono text-[11px] text-mute hidden sm:block">{h.captures} caps · {formatDistance(h.distance_m)} · {formatClock(h.survived_s * 1000)}</span>
                <span className="font-mono text-xs text-cyan">+{h.xp}</span>
              </Link></li>
            ))}
          </ul>
        )}
      </Panel>

      {own && (
        <div className="grid md:grid-cols-2 gap-4 mt-4">
          <Panel title="Identity">
            <Field label="Callsign"><div className="flex gap-2"><input className={inputCls} maxLength={24} value={name} onChange={(e) => setName(e.target.value)} /><Button onClick={saveName} disabled={name.trim().length < 2}>Save</Button></div></Field>
            <p className="text-xs text-mute mt-3">{session?.user.is_anonymous ? 'Guest account — progress is tied to this browser. Sign in with email on a new device to keep progress.' : `Signed in as ${session?.user.email}`}</p>
            <Button variant="subtle" className="mt-3" onClick={signOut}>Sign out</Button>
          </Panel>
          <Panel title="Privacy">
            <p className="text-sm">Live positions are deleted when a match ends. Replay tracks are kept for 48 hours, visible only to that match's players.</p>
            {pushSupported() ? (
              <div className="mt-3 border-t border-line pt-2"><Toggle label="Match alerts (push)" desc="Reveals, hunt start, tags, SOS — even when the app is in the background" checked={!!push} onChange={togglePush} /></div>
            ) : <p className="text-xs text-mute mt-3">Push alerts unavailable here (not configured, or on iOS install the app to the home screen first).</p>}
            <Button variant="ghost" className="mt-3" onClick={() => api.deleteMyLocationData().then(() => toast('Location history deleted', 'success')).catch((e) => toast(errMsg(e), 'error'))}>Delete my location history now</Button>
          </Panel>
        </div>
      )}
    </Shell>
  );
}
