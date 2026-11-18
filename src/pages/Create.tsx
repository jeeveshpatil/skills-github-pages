import { useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { Shell } from '../components/Shell';
import { SettingsForm, defaultSettings, toPayload, type Settings } from '../components/SettingsForm';
import { errMsg, useToast } from '../components/ui';
import { api } from '../lib/api';
import { MODES } from '../lib/modes';
import type { Mode } from '../lib/types';

export default function Create() {
  const [params] = useSearchParams();
  const nav = useNavigate();
  const toast = useToast();
  const [busy, setBusy] = useState(false);
  const init = (() => {
    const d = defaultSettings();
    const m = MODES.find((x) => x.id === (params.get('mode') as Mode));
    const t = params.get('tournament');
    const withMode: Settings = m ? ({ ...d, mode: m.id, ...m.preset, rules: { ...d.rules, ...m.preset.rules } } as Settings) : d;
    return t ? { ...withMode, tournament_id: t } : withMode;
  })();

  const submit = async (s: Settings) => {
    setBusy(true);
    try { nav(`/room/${await api.createRoom(toPayload(s))}`, { replace: true }); }
    catch (e) { toast(errMsg(e), 'error'); setBusy(false); }
  };
  return (
    <Shell wide>
      <h1 className="text-3xl font-bold mb-1">New operation</h1>
      <p className="text-mute mb-6">Everything here is enforced server-side once the match starts.</p>
      <SettingsForm initial={init} onSubmit={submit} submitLabel="Create room" busy={busy} />
    </Shell>
  );
}
