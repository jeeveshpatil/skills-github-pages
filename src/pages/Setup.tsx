import { Logo } from '../components/Logo';

export default function SetupPage() {
  return (
    <div className="min-h-full bg-grid grid place-items-center p-6">
      <div className="panel brackets chamfer max-w-lg p-6 space-y-4">
        <Logo />
        <h1 className="text-2xl">Backend not configured</h1>
        <p className="text-sm">Copy <code className="text-neon">.env.example</code> to <code className="text-neon">.env</code>, set <code className="text-cyan">VITE_SUPABASE_URL</code> and <code className="text-cyan">VITE_SUPABASE_ANON_KEY</code>, apply the SQL migrations in <code>supabase/migrations</code>, then restart the dev server. See README.</p>
      </div>
    </div>
  );
}
