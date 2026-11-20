import { lazy, Suspense, useEffect } from 'react';
import { Navigate, Route, Routes, useNavigate } from 'react-router-dom';
import { initNative } from './lib/native';
import { supabase } from './lib/supabase';
import { useAuth } from './hooks/useAuth';
import { isConfigured } from './lib/supabase';
import { Spinner } from './components/ui';
import { SafetyGate } from './components/SafetyGate';
import AuthPage from './pages/Auth';
import SetupPage from './pages/Setup';
import Home from './pages/Home';

const Play = lazy(() => import('./pages/Play'));
const Create = lazy(() => import('./pages/Create'));
const Join = lazy(() => import('./pages/Join'));
const RoomPage = lazy(() => import('./pages/Room'));
const HostDashboard = lazy(() => import('./pages/HostDashboard'));
const Profile = lazy(() => import('./pages/Profile'));
const Leaderboard = lazy(() => import('./pages/Leaderboard'));
const Tournaments = lazy(() => import('./pages/Tournaments'));
const TournamentDetail = lazy(() => import('./pages/TournamentDetail'));
const Maps = lazy(() => import('./pages/Maps'));

export default function App() {
  const { session, profile, loading } = useAuth();
  const navigate = useNavigate();
  useEffect(() => {
    void initNative(navigate, async (url) => {
      // magic-link callback: tokens arrive in the fragment (implicit) or as ?code= (PKCE)
      const u = new URL(url.replace('#', '?'));
      const code = u.searchParams.get('code');
      const at = u.searchParams.get('access_token'), rt = u.searchParams.get('refresh_token');
      if (code) await supabase.auth.exchangeCodeForSession(code);
      else if (at && rt) await supabase.auth.setSession({ access_token: at, refresh_token: rt });
    });
  }, [navigate]);
  if (!isConfigured) return <SetupPage />;
  if (loading) return <div className="h-full grid place-items-center"><Spinner label="Establishing uplink" /></div>;
  if (!session) return <AuthPage />;
  if (!profile) return <div className="h-full grid place-items-center"><Spinner label="Loading agent profile" /></div>;
  return (
    <SafetyGate>
      <Suspense fallback={<div className="h-full grid place-items-center"><Spinner /></div>}>
        <Routes>
          <Route path="/" element={<Home />} />
          <Route path="/play" element={<Play />} />
          <Route path="/create" element={<Create />} />
          <Route path="/join/:code?" element={<Join />} />
          <Route path="/room/:id" element={<RoomPage />} />
          <Route path="/room/:id/host" element={<HostDashboard />} />
          <Route path="/profile/:id?" element={<Profile />} />
          <Route path="/leaderboard" element={<Leaderboard />} />
          <Route path="/tournaments" element={<Tournaments />} />
          <Route path="/tournaments/:id" element={<TournamentDetail />} />
          <Route path="/maps" element={<Maps />} />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </Suspense>
    </SafetyGate>
  );
}
