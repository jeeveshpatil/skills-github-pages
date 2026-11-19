import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from 'react';
import type { Session } from '@supabase/supabase-js';
import { isConfigured, supabase } from '../lib/supabase';
import type { Profile } from '../lib/types';

interface AuthCtx {
  session: Session | null; profile: Profile | null; loading: boolean;
  refreshProfile: () => Promise<void>; signOut: () => Promise<void>;
}
const Ctx = createContext<AuthCtx>(null as unknown as AuthCtx);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<Session | null>(null);
  const [profile, setProfile] = useState<Profile | null>(null);
  const [loading, setLoading] = useState(isConfigured);

  const loadProfile = useCallback(async (uid: string | undefined) => {
    if (!uid) return setProfile(null);
    // the profile row is created by a trigger; retry briefly right after sign-up
    for (let i = 0; i < 5; i++) {
      const { data } = await supabase.from('profiles').select('*').eq('id', uid).maybeSingle();
      if (data) return setProfile(data as Profile);
      await new Promise((r) => setTimeout(r, 400));
    }
  }, []);

  useEffect(() => {
    if (!isConfigured) return;
    supabase.auth.getSession().then(async ({ data }) => {
      setSession(data.session);
      await loadProfile(data.session?.user.id);
      setLoading(false);
    });
    const { data: sub } = supabase.auth.onAuthStateChange((_e, s) => {
      setSession(s);
      void loadProfile(s?.user.id);
    });
    return () => sub.subscription.unsubscribe();
  }, [loadProfile]);

  const value: AuthCtx = {
    session, profile, loading,
    refreshProfile: () => loadProfile(session?.user.id),
    signOut: async () => { await supabase.auth.signOut(); setProfile(null); },
  };
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export const useAuth = () => useContext(Ctx);
