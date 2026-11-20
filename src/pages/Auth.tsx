import { useState } from 'react';
import { supabase } from '../lib/supabase';
import { Logo } from '../components/Logo';
import { GetApp } from '../components/GetApp';
import { Button, Field, inputCls, errMsg, useToast } from '../components/ui';
import { MODES } from '../lib/modes';
import { NATIVE_AUTH_REDIRECT, isNative } from '../lib/native';

export default function AuthPage() {
  const toast = useToast();
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [sent, setSent] = useState(false);
  const [busy, setBusy] = useState<'guest' | 'email' | null>(null);

  const guest = async () => {
    setBusy('guest');
    const { error } = await supabase.auth.signInAnonymously({ options: { data: { username: name.trim() || undefined } } });
    setBusy(null);
    if (error) toast(errMsg(error.message), 'error');
  };
  const magic = async () => {
    if (!email.includes('@')) return toast('Enter a valid email', 'warn');
    setBusy('email');
    const { error } = await supabase.auth.signInWithOtp({ email, options: { emailRedirectTo: isNative ? NATIVE_AUTH_REDIRECT : window.location.origin + import.meta.env.BASE_URL, data: { username: name.trim() || undefined } } });
    setBusy(null);
    if (error) toast(errMsg(error.message), 'error'); else setSent(true);
  };

  return (
    <div className="min-h-full bg-grid relative overflow-hidden">
      <div className="absolute -top-40 -right-40 size-[520px] rounded-full border border-neon/10" />
      <div className="absolute -top-20 -right-20 size-[360px] rounded-full border border-neon/15" />
      <div className="absolute top-20 right-20 size-[200px] rounded-full sweep opacity-40" style={{ background: 'conic-gradient(from 0deg, transparent 75%, #2dffa055)' }} />
      <div className="relative max-w-5xl mx-auto px-5 safe-top pt-8 pb-16 grid lg:grid-cols-[1.2fr_1fr] gap-10 items-center min-h-full">
        <div className="rise">
          <Logo size={34} />
          <h1 className="mt-10 text-4xl sm:text-6xl font-bold leading-[0.95]">
            The city is<br />the <span className="text-neon glow">arena.</span>
          </h1>
          <p className="mt-5 text-lg max-w-md">Real-world multiplayer manhunt. Hunters close in on blurred GPS pings while the zone collapses. Shadows run, hide, and outlast.</p>
          <div className="mt-8 flex flex-wrap gap-2">
            {MODES.map((m) => <span key={m.id} className="font-mono text-[11px] px-2 py-1 border border-line text-mute">{m.name.toUpperCase()}</span>)}
          </div>
        </div>
        <div className="panel brackets chamfer p-6 space-y-4 rise" style={{ animationDelay: '.1s' }}>
          <h2 className="text-xl">Enlist</h2>
          <Field label="Callsign"><input className={inputCls} placeholder="e.g. Nightjar" maxLength={24} value={name} onChange={(e) => setName(e.target.value)} /></Field>
          <Button className="w-full" size="lg" onClick={guest} loading={busy === 'guest'}>Play as guest</Button>
          <div className="flex items-center gap-3 text-mute"><div className="h-px flex-1 bg-line" /><span className="label">or keep your progress</span><div className="h-px flex-1 bg-line" /></div>
          {sent ? (
            <p className="text-sm text-neon font-mono">Check your inbox — tap the sign-in link on this device.</p>
          ) : (
            <>
              <Field label="Email"><input className={inputCls} type="email" autoComplete="email" value={email} onChange={(e) => setEmail(e.target.value)} /></Field>
              <Button className="w-full" variant="ghost" onClick={magic} loading={busy === 'email'}>Send magic link</Button>
            </>
          )}
          <GetApp />
          <p className="text-[11px] text-mute">Play outdoors, in public spaces, with people you know. Stay aware of traffic.</p>
        </div>
      </div>
    </div>
  );
}
