import { createContext, useCallback, useContext, useState, type ButtonHTMLAttributes, type ReactNode } from 'react';
import { TEAM_META } from '../lib/modes';
import type { Team } from '../lib/types';

type Variant = 'primary' | 'ghost' | 'danger' | 'cyan' | 'subtle';
const variants: Record<Variant, string> = {
  primary: 'bg-neon text-ink hover:bg-white shadow-[0_0_24px_-6px_#2dffa0]',
  cyan: 'bg-cyan text-ink hover:bg-white shadow-[0_0_24px_-6px_#22e3ff]',
  danger: 'bg-danger text-white hover:bg-[#ff6b85] shadow-[0_0_24px_-6px_#ff4d6d]',
  ghost: 'bg-transparent text-white border border-line-2 hover:border-neon hover:text-neon',
  subtle: 'bg-panel-2 text-soft border border-line hover:text-white hover:border-line-2',
};

export function Button({ variant = 'primary', size = 'md', className = '', loading, children, ...rest }:
  ButtonHTMLAttributes<HTMLButtonElement> & { variant?: Variant; size?: 'sm' | 'md' | 'lg'; loading?: boolean }) {
  const sz = size === 'sm' ? 'h-8 px-3 text-xs' : size === 'lg' ? 'h-14 px-6 text-base' : 'h-11 px-4 text-sm';
  return (
    <button
      {...rest}
      disabled={rest.disabled || loading}
      className={`chamfer-sm inline-flex items-center justify-center gap-2 font-display font-semibold uppercase tracking-wider transition-all active:scale-[.97] disabled:opacity-40 disabled:pointer-events-none ${sz} ${variants[variant]} ${className}`}
    >
      {loading && <span className="size-3 border-2 border-current border-r-transparent rounded-full animate-spin" />}
      {children}
    </button>
  );
}

export function Panel({ children, className = '', title, right }: { children: ReactNode; className?: string; title?: ReactNode; right?: ReactNode }) {
  return (
    <section className={`panel brackets chamfer p-4 ${className}`}>
      {(title || right) && (
        <header className="flex items-center justify-between mb-3 gap-2">
          {title && <h3 className="label !text-soft">{title}</h3>}
          {right}
        </header>
      )}
      {children}
    </section>
  );
}

export function Field({ label, hint, children }: { label: string; hint?: ReactNode; children: ReactNode }) {
  return (
    <label className="block">
      <span className="label flex justify-between"><span>{label}</span>{hint && <span className="text-cyan normal-case tracking-normal">{hint}</span>}</span>
      <div className="mt-1.5">{children}</div>
    </label>
  );
}

export const inputCls = 'w-full h-11 bg-ink-2 border border-line px-3 text-white placeholder:text-mute/60 focus:border-neon outline-none transition-colors chamfer-sm';

export function Slider({ label, value, min, max, step = 1, onChange, format }: {
  label: string; value: number; min: number; max: number; step?: number; onChange: (v: number) => void; format?: (v: number) => string;
}) {
  return (
    <Field label={label} hint={format ? format(value) : String(value)}>
      <input type="range" className="w-full" min={min} max={max} step={step} value={value} onChange={(e) => onChange(Number(e.target.value))} />
    </Field>
  );
}

export function Toggle({ label, desc, checked, onChange }: { label: string; desc?: string; checked: boolean; onChange: (v: boolean) => void }) {
  return (
    <button type="button" onClick={() => onChange(!checked)} className="w-full flex items-center justify-between gap-3 text-left py-2">
      <span>
        <span className="block text-sm text-white">{label}</span>
        {desc && <span className="block text-xs text-mute">{desc}</span>}
      </span>
      <span className={`shrink-0 w-11 h-6 rounded-full p-0.5 transition-colors ${checked ? 'bg-neon' : 'bg-line-2'}`}>
        <span className={`block size-5 rounded-full bg-ink transition-transform ${checked ? 'translate-x-5' : ''}`} />
      </span>
    </button>
  );
}

export function TeamBadge({ team }: { team: Team | null }) {
  if (!team) return <span className="font-mono text-[10px] px-1.5 py-0.5 border border-line text-mute">UNASSIGNED</span>;
  const m = TEAM_META[team];
  return <span className="font-mono text-[10px] px-1.5 py-0.5 border" style={{ color: m.color, borderColor: m.color + '66', background: m.color + '14' }}>{m.short}</span>;
}

export function Modal({ open, onClose, title, children }: { open: boolean; onClose?: () => void; title?: string; children: ReactNode }) {
  if (!open) return null;
  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-ink/80 backdrop-blur-sm p-3" onClick={onClose}>
      <div className="panel brackets chamfer w-full max-w-md max-h-[90vh] overflow-auto p-5 rise" onClick={(e) => e.stopPropagation()} role="dialog" aria-modal>
        {title && <h2 className="text-xl mb-4">{title}</h2>}
        {children}
      </div>
    </div>
  );
}

export function Spinner({ label }: { label?: string }) {
  return (
    <div className="flex flex-col items-center justify-center gap-3 py-16 text-mute">
      <div className="relative size-14">
        <div className="absolute inset-0 rounded-full border border-neon/30" />
        <div className="absolute inset-0 rounded-full sweep" style={{ background: 'conic-gradient(from 0deg, transparent 70%, #2dffa088)' }} />
      </div>
      {label && <span className="label">{label}</span>}
    </div>
  );
}

// ---------------------------------------------------------------- toasts
type ToastKind = 'info' | 'error' | 'success' | 'warn';
const ToastCtx = createContext<(msg: string, kind?: ToastKind) => void>(() => {});
export const useToast = () => useContext(ToastCtx);

export function ToastProvider({ children }: { children: ReactNode }) {
  const [items, setItems] = useState<{ id: number; msg: string; kind: ToastKind }[]>([]);
  const push = useCallback((msg: string, kind: ToastKind = 'info') => {
    const id = Date.now() + Math.random();
    setItems((x) => [...x.slice(-3), { id, msg, kind }]);
    setTimeout(() => setItems((x) => x.filter((t) => t.id !== id)), 4200);
  }, []);
  const color = { info: 'border-cyan text-cyan', error: 'border-danger text-danger', success: 'border-neon text-neon', warn: 'border-amber text-amber' };
  return (
    <ToastCtx.Provider value={push}>
      {children}
      <div className="fixed top-0 inset-x-0 z-[60] flex flex-col items-center gap-2 safe-top px-3 pointer-events-none">
        {items.map((t) => (
          <div key={t.id} className={`rise chamfer-sm bg-ink/95 border-l-2 ${color[t.kind]} px-4 py-2.5 text-sm font-mono max-w-md w-full shadow-xl`}>{t.msg}</div>
        ))}
      </div>
    </ToastCtx.Provider>
  );
}

export function errMsg(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}
