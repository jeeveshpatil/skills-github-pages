/**
 * Native (Capacitor) integrations with web fallbacks, so the same code runs in the browser PWA and the
 * Android/iOS apps. Plugins are imported lazily so the web bundle never loads native-only code paths.
 */
import { Capacitor, registerPlugin } from '@capacitor/core';
import type { BackgroundGeolocationPlugin } from '@capacitor-community/background-geolocation';

export const isNative = Capacitor.isNativePlatform();
export const platform = Capacitor.getPlatform(); // 'web' | 'android' | 'ios'

const BackgroundGeolocation = registerPlugin<BackgroundGeolocationPlugin>('BackgroundGeolocation');

export interface NativeFix { lat: number; lng: number; accuracy: number; heading: number | null; speed: number | null; at: number; simulated: boolean }

/**
 * Continuous location that keeps running with the screen off / app backgrounded (Android shows a
 * persistent "match in progress" notification, iOS uses the location background mode).
 * Returns a stop function.
 */
export async function watchNativeLocation(onFix: (f: NativeFix) => void, onError: (msg: string) => void): Promise<() => void> {
  await ensureNotificationPermission(); // Android 13+: needed for the foreground-service notification
  const id = await BackgroundGeolocation.addWatcher(
    { backgroundTitle: 'ShadowHunt match in progress', backgroundMessage: 'Sharing your location with the game. Leave the match to stop.', requestPermissions: true, stale: false, distanceFilter: 0 },
    (loc, err) => {
      if (err) {
        if (err.code === 'NOT_AUTHORIZED') {
          onError('Location permission denied — tap here to open settings');
        } else onError(err.message || 'GPS unavailable');
        return;
      }
      if (loc) onFix({ lat: loc.latitude, lng: loc.longitude, accuracy: loc.accuracy, heading: loc.bearing, speed: loc.speed, at: loc.time ?? Date.now(), simulated: !!loc.simulated });
    },
  );
  return () => { void BackgroundGeolocation.removeWatcher({ id }); };
}

export const openAppSettings = () => (isNative ? BackgroundGeolocation.openSettings() : Promise.resolve());

/** Vibration patterns: navigator.vibrate on Android web, native haptics in the apps (works on iOS too). */
export async function vibrate(pattern: number | number[]) {
  if (!isNative) { navigator.vibrate?.(pattern); return; }
  const { Haptics, NotificationType } = await import('@capacitor/haptics');
  const total = (Array.isArray(pattern) ? pattern : [pattern]).filter((_, i) => i % 2 === 0).reduce((a, b) => a + b, 0);
  if (total >= 400) await Haptics.notification({ type: NotificationType.Error });
  else if (total >= 150) await Haptics.notification({ type: NotificationType.Warning });
  else await Haptics.vibrate({ duration: Math.max(30, total) });
}

export async function setKeepAwake(on: boolean) {
  if (!isNative) return false;
  const { KeepAwake } = await import('@capacitor-community/keep-awake');
  if (on) await KeepAwake.keepAwake(); else await KeepAwake.allowSleep();
  return true;
}

async function ensureNotificationPermission() {
  if (!isNative) return;
  const { LocalNotifications } = await import('@capacitor/local-notifications');
  const p = await LocalNotifications.checkPermissions();
  if (p.display !== 'granted') await LocalNotifications.requestPermissions();
}

let notifId = 1;
/** Local notification for match events while the app is in the background (native apps only). */
export async function localNotify(title: string, body: string, roomId: string) {
  if (!isNative) return;
  const { LocalNotifications } = await import('@capacitor/local-notifications');
  await LocalNotifications.schedule({ notifications: [{ id: notifId++, title, body, extra: { url: `/room/${roomId}` } }] });
}

/** App chrome + deep links: status bar, splash, notification taps and auth callback URLs. */
export async function initNative(navigate: (path: string) => void, onAuthUrl: (url: string) => void) {
  if (!isNative) return;
  const [{ App }, { SplashScreen }, { StatusBar, Style }, { LocalNotifications }] = await Promise.all([
    import('@capacitor/app'), import('@capacitor/splash-screen'), import('@capacitor/status-bar'), import('@capacitor/local-notifications'),
  ]);
  try { await StatusBar.setStyle({ style: Style.Dark }); } catch { /* not supported */ }
  await SplashScreen.hide();
  await LocalNotifications.addListener('localNotificationActionPerformed', (a) => {
    const url = a.notification.extra?.url as string | undefined;
    if (url) navigate(url);
  });
  await App.addListener('appUrlOpen', ({ url }) => {
    if (url.includes('auth-callback')) onAuthUrl(url);
    else {
      const path = url.replace(/^[a-z.]+:\/\/[^/]*/i, '');
      if (path.startsWith('/')) navigate(path);
    }
  });
}

/** Custom-scheme URL used as the email magic-link redirect inside the native apps. */
export const NATIVE_AUTH_REDIRECT = 'io.github.jeeveshpatil.shadowhunt://auth-callback';
