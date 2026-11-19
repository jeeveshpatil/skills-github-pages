import { useEffect, useRef, useState } from 'react';
import { useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { Shell } from '../components/Shell';
import { Button, Field, Panel, Toggle, errMsg, inputCls } from '../components/ui';
import { api } from '../lib/api';

export default function Join() {
  const { code: codeParam } = useParams();
  const [params] = useSearchParams();
  const nav = useNavigate();
  const [code, setCode] = useState(codeParam ?? '');
  const [password, setPassword] = useState('');
  const [spectate, setSpectate] = useState(params.get('spectate') === '1');
  const [needPw, setNeedPw] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const tried = useRef(false);

  const join = async (c = code, pw = password, spec = spectate) => {
    setBusy(true); setErr(null);
    try { nav(`/room/${await api.joinRoom(c, { password: pw, spectator: spec })}`, { replace: true }); }
    catch (e) {
      const m = errMsg(e);
      if (m.includes('password')) setNeedPw(true);
      if (m.includes('in progress')) setSpectate(true);
      setErr(m);
    } finally { setBusy(false); }
  };

  useEffect(() => {
    // deep link (/join/CODE) tries immediately; asks for a password only if the room needs one
    if (codeParam && !tried.current) { tried.current = true; void join(codeParam, '', params.get('spectate') === '1'); }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [codeParam]);

  return (
    <Shell>
      <div className="max-w-md mx-auto">
        <Panel title="Join operation">
          <form className="space-y-4" onSubmit={(e) => { e.preventDefault(); void join(); }}>
            <Field label="Room code"><input className={`${inputCls} font-mono text-2xl tracking-[0.35em] uppercase !h-14 text-center`} maxLength={6} value={code} onChange={(e) => setCode(e.target.value.toUpperCase())} autoFocus={!codeParam} /></Field>
            {needPw && <Field label="Password"><input className={inputCls} type="password" value={password} onChange={(e) => setPassword(e.target.value)} autoFocus /></Field>}
            <Toggle label="Join as spectator" desc="Watch blurred reveals and the event feed without playing" checked={spectate} onChange={setSpectate} />
            {err && <p className="text-sm text-danger font-mono">{err}</p>}
            <Button type="submit" className="w-full" size="lg" loading={busy} disabled={code.length < 6}>{spectate ? 'Spectate' : 'Deploy'}</Button>
          </form>
        </Panel>
      </div>
    </Shell>
  );
}
