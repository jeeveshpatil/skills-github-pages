import { useState } from 'react';
import { supabase } from '../lib/supabase';
import { useAuth } from '../hooks/useAuth';
import { Button, Modal, errMsg, useToast } from './ui';

/** Location-sharing consent + real-world safety briefing. Required before any GPS data is sent. */
export function SafetyGate({ children }: { children: React.ReactNode }) {
  const { profile, refreshProfile } = useAuth();
  const toast = useToast();
  const [busy, setBusy] = useState(false);
  const [checks, setChecks] = useState([false, false, false]);
  if (!profile || profile.location_consent_at) return <>{children}</>;
  const items = [
    'I consent to sharing my live location with this game while a match I joined is running. Opponents only ever see blurred, scheduled reveals.',
    'I will stay aware of traffic, never cross roads while looking at my phone, and respect private property and local laws.',
    'I know the SOS button pauses the match for everyone, and that I can leave at any time.',
  ];
  const accept = async () => {
    setBusy(true);
    const { error } = await supabase.from('profiles').update({ location_consent_at: new Date().toISOString() }).eq('id', profile.id);
    setBusy(false);
    if (error) return toast(errMsg(error.message), 'error');
    await refreshProfile();
  };
  return (
    <>
      {children}
      <Modal open title="Field briefing">
        <p className="text-sm text-mute mb-4">ShadowHunt is played in the real world. Before your location is shared:</p>
        <div className="space-y-3">
          {items.map((t, i) => (
            <label key={i} className="flex gap-3 items-start text-sm cursor-pointer">
              <input type="checkbox" className="mt-1 accent-[#2dffa0] size-4 shrink-0" checked={checks[i]} onChange={(e) => setChecks((c) => c.map((v, j) => (j === i ? e.target.checked : v)))} />
              <span className="text-soft">{t}</span>
            </label>
          ))}
        </div>
        <p className="text-xs text-mute mt-4">Location tracks are kept for 48 hours for replays, then deleted. You can wipe them sooner from your profile.</p>
        <Button className="w-full mt-5" disabled={!checks.every(Boolean)} loading={busy} onClick={accept}>I understand — deploy</Button>
      </Modal>
    </>
  );
}
