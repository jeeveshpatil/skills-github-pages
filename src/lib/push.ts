import { supabase } from './supabase';

const VAPID = import.meta.env.VITE_VAPID_PUBLIC_KEY as string | undefined;

export const pushSupported = () =>
  !!VAPID && 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window;

function urlB64ToUint8Array(b64: string): Uint8Array<ArrayBuffer> {
  const pad = '='.repeat((4 - (b64.length % 4)) % 4);
  const raw = atob((b64 + pad).replace(/-/g, '+').replace(/_/g, '/'));
  const out = new Uint8Array(new ArrayBuffer(raw.length));
  for (let i = 0; i < raw.length; i++) out[i] = raw.charCodeAt(i);
  return out;
}

export async function currentSubscription(): Promise<PushSubscription | null> {
  if (!pushSupported()) return null;
  const reg = await navigator.serviceWorker.ready;
  return reg.pushManager.getSubscription();
}

/** Ask permission, subscribe this device and register it with the server. */
export async function enablePush(): Promise<void> {
  if (!pushSupported()) throw new Error('Push notifications are not available on this device/browser (iOS needs the app installed to the home screen).');
  if ((await Notification.requestPermission()) !== 'granted') throw new Error('Notification permission was not granted');
  const reg = await navigator.serviceWorker.ready;
  const sub = (await reg.pushManager.getSubscription()) ?? (await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: urlB64ToUint8Array(VAPID!) }));
  const j = sub.toJSON();
  const { error } = await supabase.rpc('save_push_subscription', { p_endpoint: sub.endpoint, p_p256dh: j.keys?.p256dh, p_auth: j.keys?.auth });
  if (error) throw new Error(error.message);
}

export async function disablePush(): Promise<void> {
  const sub = await currentSubscription();
  if (!sub) return;
  await supabase.rpc('delete_push_subscription', { p_endpoint: sub.endpoint });
  await sub.unsubscribe();
}
