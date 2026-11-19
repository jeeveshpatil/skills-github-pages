-- ShadowHunt Pro — Web Push for key match events (reveals, hunt start, SOS, tags, match end).
-- Delivery path: events INSERT -> trigger -> pg_net POST -> Edge Function `push` -> Web Push services.
-- Configure once (SQL editor, as postgres):
--   insert into private.app_config values ('push_url', 'https://<ref>.supabase.co/functions/v1/push'),
--                                         ('push_secret', '<long random string, same as PUSH_WEBHOOK_SECRET>')
--   on conflict (key) do update set value = excluded.value;
-- Without that config (or without pg_net) the trigger is a no-op.

create schema if not exists private;
revoke all on schema private from public, anon, authenticated;
create table if not exists private.app_config (key text primary key, value text not null);

create table public.push_subscriptions (
  endpoint text primary key,
  user_id uuid not null references public.profiles(id) on delete cascade,
  p256dh text not null,
  auth text not null,
  created_at timestamptz not null default now()
);
create index push_subscriptions_user on public.push_subscriptions (user_id);
alter table public.push_subscriptions enable row level security;
revoke all on public.push_subscriptions from anon, authenticated;
grant select, delete on public.push_subscriptions to authenticated;
create policy push_own_read on public.push_subscriptions for select to authenticated using (user_id = auth.uid());
create policy push_own_delete on public.push_subscriptions for delete to authenticated using (user_id = auth.uid());

create or replace function public.save_push_subscription(p_endpoint text, p_p256dh text, p_auth text)
returns void language plpgsql security definer set search_path = public as $$
begin
  if p_endpoint !~ '^https://' or length(p_endpoint) > 1000 then raise exception 'Invalid push endpoint'; end if;
  insert into push_subscriptions (endpoint, user_id, p256dh, auth)
  values (p_endpoint, require_uid(), left(p_p256dh, 200), left(p_auth, 100))
  on conflict (endpoint) do update set user_id = excluded.user_id, p256dh = excluded.p256dh, auth = excluded.auth;
end $$;

create or replace function public.delete_push_subscription(p_endpoint text)
returns void language sql security definer set search_path = public as $$
  delete from push_subscriptions where endpoint = p_endpoint and user_id = auth.uid();
$$;

-- Only metadata is forwarded (event id/type/room); the Edge Function decides recipients with the
-- service role and never sends coordinates in notifications.
create or replace function private.forward_event_to_push()
returns trigger language plpgsql security definer set search_path = public, private as $$
declare url text; secret text;
begin
  if new.type not in ('hunt_started','reveal','emergency_stop','resumed','capture_pending','capture_confirmed','infected','match_ended','rematch') then
    return new;
  end if;
  select value into url from private.app_config where key = 'push_url';
  select value into secret from private.app_config where key = 'push_secret';
  if url is null or secret is null or not exists (select 1 from pg_extension where extname = 'pg_net') then
    return new;
  end if;
  execute 'select net.http_post(url := $1, body := $2, headers := $3)'
    using url,
      jsonb_build_object('event_id', new.id, 'room_id', new.room_id, 'type', new.type, 'actor', new.actor, 'target', new.target, 'payload', new.payload),
      jsonb_build_object('content-type', 'application/json', 'x-push-secret', secret);
  return new;
exception when others then
  raise warning 'push forward failed: %', sqlerrm;  -- never block gameplay on notifications
  return new;
end $$;

create trigger events_push after insert on public.events
  for each row execute function private.forward_event_to_push();

grant execute on function public.save_push_subscription(text, text, text), public.delete_push_subscription(text) to authenticated;
