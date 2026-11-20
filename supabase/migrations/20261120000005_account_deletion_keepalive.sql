-- Google Play requires in-app account deletion for apps that create accounts.
-- Deletes the caller's auth user; profiles, matches they played in (their rows), maps, achievements,
-- location data and push subscriptions cascade. Rooms they host are handed to another player
-- (so other people's match history survives) or deleted if nobody else was in them.
create or replace function public.delete_my_account()
returns void language plpgsql security definer set search_path = public, auth as $$
declare uid uuid := require_uid(); r record; nxt uuid;
begin
  for r in select id from rooms where host_id = uid loop
    select user_id into nxt from players where room_id = r.id and user_id <> uid order by joined_at limit 1;
    if nxt is null then delete from rooms where id = r.id;
    else update rooms set host_id = nxt where id = r.id;
    end if;
  end loop;
  update rooms set referee_id = null where referee_id = uid;
  delete from auth.users where id = uid;
end $$;
revoke execute on function public.delete_my_account() from public, anon;
grant execute on function public.delete_my_account() to authenticated;

-- Keep-alive: Supabase pauses free projects after a week without activity. A scheduled GitHub Action
-- calls this (with the public key) once a day. Returns nothing sensitive.
create or replace function public.ping()
returns timestamptz language sql stable as $$ select now(); $$;
grant execute on function public.ping() to anon, authenticated;
