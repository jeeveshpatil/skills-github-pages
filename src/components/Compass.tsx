import { cardinal, formatDistance } from '../lib/geo';

/**
 * Tactical compass. `heading` = device heading (null => north-up), `targetBearing` = absolute bearing
 * to the selected objective (last reveal, zone centre...).
 */
export function Compass({ heading, targetBearing, targetLabel, targetDistance, color = '#2dffa0', size = 116 }: {
  heading: number | null; targetBearing: number | null; targetLabel?: string; targetDistance?: number | null; color?: string; size?: number;
}) {
  const rot = heading != null ? -heading : 0;
  const rel = targetBearing != null ? targetBearing + rot : null;
  return (
    <div className="flex flex-col items-center gap-1">
      <div className="relative rounded-full bg-ink/85 border border-line-2 backdrop-blur" style={{ width: size, height: size }}>
        <svg viewBox="0 0 100 100" className="absolute inset-0 transition-transform duration-300" style={{ transform: `rotate(${rot}deg)` }}>
          {Array.from({ length: 36 }).map((_, i) => (
            <line key={i} x1="50" y1="4" x2="50" y2={i % 9 === 0 ? 12 : 8} stroke={i === 0 ? '#ff4d6d' : '#2a3d47'} strokeWidth={i % 9 === 0 ? 2 : 1} transform={`rotate(${i * 10} 50 50)`} />
          ))}
          {['N', 'E', 'S', 'W'].map((d, i) => (
            <text key={d} x="50" y="22" textAnchor="middle" fontSize="9" fontFamily="Chakra Petch" fontWeight="700" fill={d === 'N' ? '#ff4d6d' : '#6f8591'} transform={`rotate(${i * 90} 50 50)`}>{d}</text>
          ))}
        </svg>
        {rel != null && (
          <svg viewBox="0 0 100 100" className="absolute inset-0 transition-transform duration-300" style={{ transform: `rotate(${rel}deg)` }}>
            <path d="M50 14 L58 50 L50 44 L42 50 Z" fill={color} style={{ filter: `drop-shadow(0 0 6px ${color})` }} />
          </svg>
        )}
        <div className="absolute inset-0 flex items-center justify-center">
          <div className="size-2 rounded-full bg-white/80" />
        </div>
      </div>
      {targetBearing != null && (
        <div className="font-mono text-[10px] text-center leading-tight">
          <div style={{ color }}>{targetLabel}</div>
          <div className="text-soft">{cardinal(targetBearing)} · {Math.round(targetBearing)}°{targetDistance != null && ` · ${formatDistance(targetDistance)}`}</div>
        </div>
      )}
    </div>
  );
}
