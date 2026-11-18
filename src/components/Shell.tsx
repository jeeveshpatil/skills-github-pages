import { NavLink, Link } from 'react-router-dom';
import type { ReactNode } from 'react';
import { Logo } from './Logo';
import { useAuth } from '../hooks/useAuth';
import { rankFor } from '../lib/ranks';

const nav = [
  { to: '/', label: 'Base', icon: 'M3 11l9-8 9 8v10H3z' },
  { to: '/play', label: 'Play', icon: 'M6 4l14 8-14 8z' },
  { to: '/leaderboard', label: 'Ranks', icon: 'M4 20V10M10 20V4M16 20v-7M22 20H2' },
  { to: '/tournaments', label: 'Events', icon: 'M7 4h10v5a5 5 0 01-10 0zM12 14v4M8 21h8' },
  { to: '/profile', label: 'Agent', icon: 'M12 12a4 4 0 100-8 4 4 0 000 8zM4 21a8 8 0 0116 0' },
];

/** App chrome for non-game screens: top bar on desktop, bottom tab bar on mobile. */
export function Shell({ children, wide }: { children: ReactNode; wide?: boolean }) {
  const { profile } = useAuth();
  const rank = profile ? rankFor(profile.xp) : null;
  return (
    <div className="min-h-full bg-grid">
      <header className="sticky top-0 z-30 bg-ink/85 backdrop-blur border-b border-line safe-top">
        <div className={`mx-auto ${wide ? 'max-w-7xl' : 'max-w-5xl'} px-4 h-14 flex items-center justify-between gap-4`}>
          <Link to="/"><Logo size={26} /></Link>
          <nav className="hidden md:flex items-center gap-1">
            {nav.map((n) => (
              <NavLink key={n.to} to={n.to} end={n.to === '/'} className={({ isActive }) => `px-3 h-9 inline-flex items-center font-display text-sm uppercase tracking-wider ${isActive ? 'text-neon' : 'text-mute hover:text-white'}`}>{n.label}</NavLink>
            ))}
            <NavLink to="/maps" className={({ isActive }) => `px-3 h-9 inline-flex items-center font-display text-sm uppercase tracking-wider ${isActive ? 'text-neon' : 'text-mute hover:text-white'}`}>Maps</NavLink>
          </nav>
          {profile && rank && (
            <Link to="/profile" className="flex items-center gap-2 text-right">
              <span className="hidden sm:block">
                <span className="block text-sm text-white font-display leading-none">{profile.username}</span>
                <span className="block font-mono text-[10px] text-neon mt-1">{rank.name.toUpperCase()} · {profile.xp} XP</span>
              </span>
              <span className="size-9 chamfer-sm bg-panel-2 border border-line-2 grid place-items-center font-display text-neon">{profile.username.slice(0, 2).toUpperCase()}</span>
            </Link>
          )}
        </div>
      </header>
      <main className={`mx-auto ${wide ? 'max-w-7xl' : 'max-w-5xl'} px-4 pt-6 pb-28 md:pb-12`}>{children}</main>
      <nav className="md:hidden fixed bottom-0 inset-x-0 z-30 bg-ink/95 backdrop-blur border-t border-line safe-bottom">
        <div className="grid grid-cols-5">
          {nav.map((n) => (
            <NavLink key={n.to} to={n.to} end={n.to === '/'} className={({ isActive }) => `flex flex-col items-center gap-1 pt-2 pb-1 text-[10px] font-mono uppercase ${isActive ? 'text-neon' : 'text-mute'}`}>
              <svg viewBox="0 0 24 24" className="size-5" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinejoin="round" strokeLinecap="round"><path d={n.icon} /></svg>
              {n.label}
            </NavLink>
          ))}
        </div>
      </nav>
    </div>
  );
}
