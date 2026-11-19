export function Logo({ size = 28, withText = true }: { size?: number; withText?: boolean }) {
  return (
    <span className="inline-flex items-center gap-2.5 select-none">
      <svg width={size} height={size} viewBox="0 0 64 64" aria-hidden>
        <circle cx="32" cy="32" r="22" fill="none" stroke="#2dffa0" strokeOpacity=".35" strokeWidth="2.5" />
        <circle cx="32" cy="32" r="12" fill="none" stroke="#2dffa0" strokeWidth="3" />
        <path d="M32 4v12M32 48v12M4 32h12M48 32h12" stroke="#22e3ff" strokeWidth="3" strokeLinecap="round" />
        <circle cx="32" cy="32" r="3.5" fill="#2dffa0" />
      </svg>
      {withText && (
        <span className="font-display font-bold text-white tracking-[0.12em] leading-none">
          SHADOW<span className="text-neon">HUNT</span>
          <span className="ml-1.5 align-top font-mono text-[9px] text-cyan border border-cyan/40 px-1 py-px">PRO</span>
        </span>
      )}
    </span>
  );
}
