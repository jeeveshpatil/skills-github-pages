// Edge Function: fan out match events to players' Web Push subscriptions.
// Secrets: PUSH_WEBHOOK_SECRET, VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY, VAPID_SUBJECT (mailto: or https: URL).
// Deploy: supabase functions deploy push --no-verify-jwt   (auth is the shared x-push-secret header)
import { createClient } from 'npm:@supabase/supabase-js@2';
import webpush from 'npm:web-push@3.6.7';

const admin = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!);
webpush.setVapidDetails(Deno.env.get('VAPID_SUBJECT') ?? 'mailto:admin@example.com', Deno.env.get('VAPID_PUBLIC_KEY')!, Deno.env.get('VAPID_PRIVATE_KEY')!);

type Evt = { event_id: number; room_id: string; type: string; actor: string | null; target: string | null; payload: Record<string, unknown> };
type P = { user_id: string; display_name: string; team: string | null; status: string };

function timingSafeEqual(a: string, b: string) {
  if (a.length !== b.length) return false;
  let r = 0;
  for (let i = 0; i < a.length; i++) r |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return r === 0;
}

/** Who gets notified, and with what text. Never includes coordinates. */
function plan(e: Evt, players: P[]): { to: string[]; title: string; body: string } | null {
  const name = (id: string | null) => players.find((p) => p.user_id === id)?.display_name ?? 'Someone';
  const all = players.filter((p) => p.status !== 'left').map((p) => p.user_id);
  switch (e.type) {
    case 'hunt_started': return { to: all, title: 'The hunt is on', body: 'Head start is over. Move!' };
    case 'reveal': {
      // hunters (and TvT squads) want pings; shadows want to know they were exposed
      return { to: all.filter((id) => { const p = players.find((x) => x.user_id === id)!; return p.status === 'alive' || p.team === 'spectator'; }),
        title: 'Location reveal', body: 'New blurred positions are on the map.' };
    }
    case 'emergency_stop': return { to: all, title: 'EMERGENCY STOP', body: `${name(e.actor)} paused the match${e.payload?.reason ? `: ${String(e.payload.reason)}` : ''}` };
    case 'resumed': return { to: all, title: 'Match resumed', body: 'Timers and zone are running again.' };
    case 'capture_pending': return e.target ? { to: [e.target], title: "You've been tagged", body: `${name(e.actor)} tagged you — confirm or dispute within 30s.` } : null;
    case 'capture_confirmed': case 'infected': return { to: all.filter((id) => id !== e.actor), title: e.type === 'infected' ? 'Infection spreads' : 'Capture', body: `${name(e.actor)} ${e.type === 'infected' ? 'infected' : 'captured'} ${name(e.target)}` };
    case 'match_ended': return { to: all, title: 'Match over', body: 'See the debrief and replay.' };
    case 'rematch': return { to: all.filter((id) => id !== e.actor), title: 'Rematch', body: `Lobby ${String(e.payload?.code ?? '')} is open.` };
    default: return null;
  }
}

Deno.serve(async (req) => {
  const secret = Deno.env.get('PUSH_WEBHOOK_SECRET') ?? '';
  if (req.method !== 'POST' || !secret || !timingSafeEqual(req.headers.get('x-push-secret') ?? '', secret)) {
    return new Response('forbidden', { status: 403 });
  }
  const e = (await req.json()) as Evt;
  const [{ data: room }, { data: players }] = await Promise.all([
    admin.from('rooms').select('id').eq('id', e.room_id).maybeSingle(),
    admin.from('players').select('user_id, display_name, team, status').eq('room_id', e.room_id),
  ]);
  if (!room || !players) return new Response('room gone', { status: 200 });
  const p = plan(e, players as P[]);
  if (!p || !p.to.length) return new Response('nothing to send', { status: 200 });
  const { data: subs } = await admin.from('push_subscriptions').select('*').in('user_id', p.to);
  const payload = JSON.stringify({ title: p.title, body: p.body, tag: `${e.room_id}:${e.type}`, url: `/room/${e.room_id}`, urgent: e.type === 'emergency_stop' || e.type === 'capture_pending' });
  let sent = 0, failed = 0, pruned = 0;
  await Promise.all((subs ?? []).map(async (s) => {
    try {
      await webpush.sendNotification({ endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth } }, payload, { TTL: 120, urgency: 'high' });
      sent++;
    } catch (err) {
      failed++;
      const code = (err as { statusCode?: number }).statusCode;
      // expired / unsubscribed endpoints are removed; transient errors are kept for the next event
      if (code === 404 || code === 410) { pruned++; await admin.from('push_subscriptions').delete().eq('endpoint', s.endpoint); }
    }
  }));
  return Response.json({ sent, failed, pruned });
});
