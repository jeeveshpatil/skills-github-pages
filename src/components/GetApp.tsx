import { isNative } from '../lib/native';

const APK = import.meta.env.VITE_ANDROID_APK_URL as string | undefined;

/** Web-only banner pointing phones at the native app (Android APK) or home-screen install (iOS). */
export function GetApp({ className = '' }: { className?: string }) {
  if (isNative) return null;
  const ua = navigator.userAgent;
  const ios = /iPhone|iPad|iPod/i.test(ua);
  if (ios) {
    return (
      <div className={`chamfer-sm border border-cyan/40 bg-cyan/5 px-4 py-3 text-sm ${className}`}>
        <span className="label !text-cyan">iPhone</span>
        <p className="mt-1 text-soft">Tap <b className="text-white">Share</b> → <b className="text-white">Add to Home Screen</b> to install ShadowHunt as an app.</p>
      </div>
    );
  }
  if (!APK || !/Android/i.test(ua)) return null;
  return (
    <a href={APK} className={`flex items-center gap-3 chamfer-sm border border-neon/50 bg-neon/10 px-4 py-3 hover:bg-neon/20 transition-colors ${className}`}>
      <svg viewBox="0 0 24 24" className="size-7 text-neon shrink-0" fill="currentColor" aria-hidden><path d="M17.6 9.48l1.84-3.18a.38.38 0 00-.66-.38l-1.87 3.23a11.4 11.4 0 00-9.82 0L5.22 5.92a.38.38 0 00-.66.38l1.84 3.18A10.8 10.8 0 001 18h22a10.8 10.8 0 00-5.4-8.52zM7 15.25a1.25 1.25 0 110-2.5 1.25 1.25 0 010 2.5zm10 0a1.25 1.25 0 110-2.5 1.25 1.25 0 010 2.5z" /></svg>
      <span className="flex-1">
        <span className="block font-display text-white">Get the Android app</span>
        <span className="block text-xs text-mute">Background GPS, alerts & haptics · direct APK download</span>
      </span>
      <span className="font-mono text-xs text-neon">↓ APK</span>
    </a>
  );
}
