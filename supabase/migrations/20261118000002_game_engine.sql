-- ShadowHunt Pro — authoritative game engine.
-- Every state change is validated here. Clients call these via supabase.rpc().

-- ---------------------------------------------------------------- pure helpers
create or replace function public.geo_dist(lat1 double precision, lng1 double precision,
  lat2 double precision, lng2 double precision)
returns double precision language sql immutable as $$
  select 2 * 6371000 * asin(sqrt(
    power(sin(radians(lat2 - lat1) / 2), 2) +
    cos(radians(lat1)) * cos(radians(lat2)) * power(sin(radians(lng2 - lng1) / 2), 2)));
$$;

-- prey = players that can be captured / are subject to zone + disconnect elimination
create or replace function public.is_prey(p_mode text, p_team text)
returns boolean language sql immutable as $$
  select case when p_mode = 'team_vs_team' then p_team in ('red','blue') else p_team = 'shadow' end;
$$;

create or replace function public.can_tag(p_mode text, p_tagger text, p_target text)
returns boolean language sql immutable as $$
  select case when p_mode = 'team_vs_team'
    then p_tagger in ('red','blue') and p_target in ('red','blue') and p_tagger <> p_target
    else p_tagger = 'hunter' and p_target = 'shadow' end;
$$;

create or replace function public.rule_bool(r public.rooms, k text, d boolean)
returns boolean language sql immutable as $$ select coalesce((r.rules->>k)::boolean, d); $$;
create or replace function public.rule_int(r public.rooms, k text, d integer)
returns integer language sql immutable as $$ select coalesce((r.rules->>k)::integer, d); $$;

-- Zone radius at time t. Mirrored in src/lib/geo.ts (zoneRadiusAt) — keep in sync.
create or replace function public.zone_radius(r public.rooms, t timestamptz)
returns double precision language plpgsql immutable as $$
declare p double precision; total double precision;
begin
  if r.headstart_ends_at is null or r.ends_at is null then return r.zone_start_m; end if;
  if r.status = 'paused' and r.paused_at is not null then t := r.paused_at; end if;
  total := extract(epoch from r.ends_at - r.headstart_ends_at);
  if total <= 0 then return r.zone_end_m; end if;
  p := greatest(0, least(1, extract(epoch from t - r.headstart_ends_at) / total));
  if r.zone_steps > 0 then p := floor(p * r.zone_steps) / r.zone_steps; end if;
  return r.zone_start_m - (r.zone_start_m - r.zone_end_m) * p;
end $$;

create or replace function public.in_safe_zone(r public.rooms, lat double precision, lng double precision)
returns boolean language sql immutable as $$
  select exists (
    select 1 from jsonb_array_elements(coalesce(r.safe_zones, '[]'::jsonb)) z
    where geo_dist(lat, lng, (z->>'lat')::float8, (z->>'lng')::float8) <= (z->>'r')::float8);
$$;

create or replace function public.log_event(p_room uuid, p_type text, p_actor uuid default null,
  p_target uuid default null, p_payload jsonb default '{}'::jsonb)
returns void language sql security definer set search_path = public as $$
  insert into events (room_id, type, actor, target, payload) values (p_room, p_type, p_actor, p_target, p_payload);
$$;

create or replace function public.gen_room_code()
returns text language plpgsql volatile as $$
declare alphabet text := 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; c text; i int;
begin
  loop
    c := '';
    for i in 1..6 loop
      c := c || substr(alphabet, 1 + floor(random() * length(alphabet))::int, 1);
    end loop;
    exit when not exists (select 1 from rooms where code = c);
  end loop;
  return c;
end $$;

create or replace function public.require_uid()
returns uuid language plpgsql stable as $$
begin
  if auth.uid() is null then raise exception 'Not authenticated' using errcode = '28000'; end if;
  return auth.uid();
end $$;

create or replace function public.require_host(p_room uuid)
returns public.rooms language plpgsql security definer set search_path = public as $$
declare r rooms;
begin
  select * into r from rooms where id = p_room for update;
  if not found then raise exception 'Room not found'; end if;
  if r.host_id <> require_uid() then raise exception 'Only the host can do that'; end if;
  return r;
end $$;

-- ---------------------------------------------------------------- settings
-- NULL-preserving clamps (least/greatest ignore NULLs, which would clobber unset settings)
create or replace function public.clampi(v text, lo int, hi int)
returns int language sql immutable as $$ select case when v is null then null else least(hi, greatest(lo, round(v::numeric)::int)) end; $$;
create or replace function public.clampf(v text, lo float8, hi float8)
returns float8 language sql immutable as $$ select case when v is null then null else least(hi, greatest(lo, v::float8)) end; $$;
create or replace function public._apply_settings(p_room uuid, s jsonb)
returns void language plpgsql security definer set search_path = public as $$
declare clamp_end int;
begin
  if s ? 'tournament_id' and s->>'tournament_id' is not null and not exists (
    select 1 from tournaments where id = (s->>'tournament_id')::uuid and owner_id = auth.uid() and status = 'open') then
    raise exception 'You can only add rooms to your own open tournaments';
  end if;
  if s ? 'map_id' and s->>'map_id' is not null and not exists (
    select 1 from maps where id = (s->>'map_id')::uuid and (is_public or owner_id = auth.uid())) then
    raise exception 'Map not available';
  end if;
  update rooms set
    name = coalesce(left(nullif(trim(s->>'name'), ''), 40), name),
    mode = coalesce(s->>'mode', mode),
    is_public = coalesce((s->>'is_public')::boolean, is_public),
    max_players = coalesce(clampi(s->>'max_players', 2, 50), max_players),
    head_start_s = coalesce(clampi(s->>'head_start_s', 0, 1800), head_start_s),
    duration_s = coalesce(clampi(s->>'duration_s', 120, 14400), duration_s),
    reveal_interval_s = coalesce(clampi(s->>'reveal_interval_s', 30, 1800), reveal_interval_s),
    location_interval_s = coalesce(clampi(s->>'location_interval_s', 2, 60), location_interval_s),
    reveal_blur_m = coalesce(clampi(s->>'reveal_blur_m', 0, 300), reveal_blur_m),
    tag_radius_m = coalesce(clampi(s->>'tag_radius_m', 3, 50), tag_radius_m),
    zone_lat = case when s ? 'zone_lat' then clampf(s->>'zone_lat', -90, 90) else zone_lat end,
    zone_lng = case when s ? 'zone_lng' then clampf(s->>'zone_lng', -180, 180) else zone_lng end,
    zone_start_m = coalesce(clampi(s->>'zone_start_m', 100, 20000), zone_start_m),
    zone_end_m = coalesce(clampi(s->>'zone_end_m', 20, 20000), zone_end_m),
    zone_steps = coalesce(clampi(s->>'zone_steps', 0, 20), zone_steps),
    zone_grace_s = coalesce(clampi(s->>'zone_grace_s', 0, 600), zone_grace_s),
    max_speed_mps = coalesce(clampf(s->>'max_speed_mps', 3, 60), max_speed_mps),
    safe_zones = case when jsonb_typeof(s->'safe_zones') = 'array'
      then (select coalesce(jsonb_agg(jsonb_build_object(
              'name', left(coalesce(z->>'name', 'Safe zone'), 30),
              'lat', (z->>'lat')::float8, 'lng', (z->>'lng')::float8,
              'r', least(200, greatest(5, (z->>'r')::float8)))), '[]'::jsonb)
            from (select z from jsonb_array_elements(s->'safe_zones') z limit 10) q)
      else safe_zones end,
    rules = case when jsonb_typeof(s->'rules') = 'object' then rules || (s->'rules') else rules end,
    map_id = case when s ? 'map_id' then (s->>'map_id')::uuid else map_id end,
    tournament_id = case when s ? 'tournament_id' then (s->>'tournament_id')::uuid else tournament_id end
  where id = p_room;
  -- end radius can never exceed start radius
  update rooms set zone_end_m = least(zone_end_m, zone_start_m) where id = p_room;
  if s ? 'password' then
    if coalesce(s->>'password', '') = '' then
      delete from room_secrets where room_id = p_room;
    else
      insert into room_secrets (room_id, password_hash)
      values (p_room, extensions.crypt(s->>'password', extensions.gen_salt('bf')))
      on conflict (room_id) do update set password_hash = excluded.password_hash;
    end if;
  end if;
end $$;

-- ---------------------------------------------------------------- lobby RPCs
create or replace function public.create_room(p_settings jsonb, p_display_name text default null)
returns uuid language plpgsql security definer set search_path = public as $$
declare uid uuid := require_uid(); rid uuid; nm text;
begin
  select coalesce(nullif(trim(p_display_name), ''), username) into nm from profiles where id = uid;
  if nm is null then raise exception 'Profile missing'; end if;
  insert into rooms (code, host_id) values (gen_room_code(), uid) returning id into rid;
  perform _apply_settings(rid, coalesce(p_settings, '{}'::jsonb));
  insert into players (room_id, user_id, display_name, team)
  values (rid, uid, left(nm, 24), case when coalesce((p_settings->>'host_spectates')::boolean, false) then 'spectator' end);
  perform log_event(rid, 'room_created', uid);
  return rid;
end $$;

create or replace function public.update_settings(p_room uuid, p_settings jsonb)
returns void language plpgsql security definer set search_path = public as $$
declare r rooms := require_host(p_room);
begin
  if r.status <> 'lobby' then raise exception 'Settings are locked once the match starts'; end if;
  perform _apply_settings(p_room, p_settings);
  if (p_settings ? 'mode') and p_settings->>'mode' <> r.mode then
    -- team names differ between modes: reset non-spectator teams
    update players set team = null, ready = false where room_id = p_room and team <> 'spectator';
  end if;
  perform log_event(p_room, 'settings_changed', r.host_id);
end $$;

create or replace function public.join_room(p_code text, p_password text default null,
  p_display_name text default null, p_spectator boolean default false)
returns uuid language plpgsql security definer set search_path = public as $$
declare uid uuid := require_uid(); r rooms; nm text; cnt int; pw text;
begin
  select * into r from rooms where code = upper(trim(p_code)) for update;
  if not found then raise exception 'No room with that code'; end if;
  -- reconnect
  if exists (select 1 from players where room_id = r.id and user_id = uid) then
    update players set last_seen_at = now(), status = case when status = 'left' and r.status = 'lobby' then 'alive' else status end
      where room_id = r.id and user_id = uid;
    perform log_event(r.id, 'player_reconnected', uid);
    return r.id;
  end if;
  if r.status = 'ended' then raise exception 'That match has ended'; end if;
  select password_hash into pw from room_secrets where room_id = r.id;
  if pw is not null and (p_password is null or extensions.crypt(p_password, pw) <> pw) then
    raise exception 'Wrong room password';
  end if;
  if not p_spectator and r.status <> 'lobby' then
    raise exception 'Match already in progress — join as spectator';
  end if;
  if p_spectator and not rule_bool(r, 'spectators_allowed', true) then
    raise exception 'Spectators are disabled for this room';
  end if;
  select count(*) into cnt from players where room_id = r.id and team is distinct from 'spectator' and status <> 'left';
  if not p_spectator and cnt >= r.max_players then raise exception 'Room is full'; end if;
  select coalesce(nullif(trim(p_display_name), ''), username) into nm from profiles where id = uid;
  insert into players (room_id, user_id, display_name, team)
  values (r.id, uid, left(nm, 24), case when p_spectator then 'spectator' end);
  perform log_event(r.id, 'player_joined', uid, null, jsonb_build_object('spectator', p_spectator));
  return r.id;
end $$;

create or replace function public.list_public_rooms()
returns table (id uuid, code text, name text, mode text, max_players int, players bigint,
  host_name text, has_zone boolean, created_at timestamptz)
language sql stable security definer set search_path = public as $$
  select r.id, r.code, r.name, r.mode, r.max_players,
    (select count(*) from players p where p.room_id = r.id and p.team is distinct from 'spectator'),
    pr.username, r.zone_lat is not null, r.created_at
  from rooms r join profiles pr on pr.id = r.host_id
  where r.is_public and r.status = 'lobby' and r.created_at > now() - interval '6 hours'
    and not exists (select 1 from room_secrets s where s.room_id = r.id)
  order by r.created_at desc limit 50;
$$;

create or replace function public.quick_match(p_mode text default null, p_display_name text default null)
returns uuid language plpgsql security definer set search_path = public as $$
declare c text;
begin
  select l.code into c from list_public_rooms() l
  where l.players < l.max_players and (p_mode is null or l.mode = p_mode)
  order by l.players desc, l.created_at desc limit 1;
  if c is null then return null; end if;
  return join_room(c, null, p_display_name, false);
end $$;

create or replace function public.set_ready(p_room uuid, p_ready boolean)
returns void language sql security definer set search_path = public as $$
  update players set ready = p_ready, last_seen_at = now()
  where room_id = p_room and user_id = auth.uid()
    and exists (select 1 from rooms where id = p_room and status = 'lobby');
$$;

create or replace function public.set_team(p_room uuid, p_user uuid, p_team text)
returns void language plpgsql security definer set search_path = public as $$
declare uid uuid := require_uid(); r rooms;
begin
  select * into r from rooms where id = p_room for update;
  if r.status <> 'lobby' then raise exception 'Teams are locked'; end if;
  if uid <> r.host_id and not (uid = p_user and rule_bool(r, 'self_team_pick', true)) then
    raise exception 'Only the host can assign teams';
  end if;
  if p_team is not null and p_team <> 'spectator' and
     not ((r.mode = 'team_vs_team' and p_team in ('red','blue')) or (r.mode <> 'team_vs_team' and p_team in ('hunter','shadow'))) then
    raise exception 'Invalid team for this mode';
  end if;
  update players set team = p_team, ready = false where room_id = p_room and user_id = p_user;
  if not found then raise exception 'Player not in room'; end if;
end $$;

create or replace function public._auto_assign(p_room uuid, p_force boolean)
returns void language plpgsql security definer set search_path = public as $$
declare r rooms; n int; hunters int; rec record; i int := 0;
begin
  select * into r from rooms where id = p_room;
  if p_force then
    update players set team = null where room_id = p_room and team is distinct from 'spectator';
  end if;
  select count(*) into n from players where room_id = p_room and team is distinct from 'spectator' and status <> 'left';
  if r.mode = 'team_vs_team' then
    for rec in select user_id, team from players where room_id = p_room and team is distinct from 'spectator'
               and status <> 'left' order by team nulls last, random() loop
      if rec.team is null then
        update players set team = case when (select count(*) from players where room_id = p_room and team = 'red')
                                          <= (select count(*) from players where room_id = p_room and team = 'blue')
                                       then 'red' else 'blue' end
        where room_id = p_room and user_id = rec.user_id;
      end if;
    end loop;
  else
    hunters := case when r.mode = 'infection' then 1 else greatest(1, round(n * 0.3)::int) end;
    hunters := hunters - (select count(*) from players where room_id = p_room and team = 'hunter');
    for rec in select user_id from players where room_id = p_room and team is null and status <> 'left' order by random() loop
      i := i + 1;
      update players set team = case when i <= hunters then 'hunter' else 'shadow' end
      where room_id = p_room and user_id = rec.user_id;
    end loop;
  end if;
end $$;

create or replace function public.shuffle_teams(p_room uuid)
returns void language plpgsql security definer set search_path = public as $$
declare r rooms := require_host(p_room);
begin
  if r.status <> 'lobby' then raise exception 'Teams are locked'; end if;
  perform _auto_assign(p_room, true);
  perform log_event(p_room, 'teams_shuffled', r.host_id);
end $$;

create or replace function public.kick_player(p_room uuid, p_user uuid)
returns void language plpgsql security definer set search_path = public as $$
declare r rooms := require_host(p_room);
begin
  if p_user = r.host_id then raise exception 'Host cannot kick themselves'; end if;
  delete from players where room_id = p_room and user_id = p_user;
  delete from positions where room_id = p_room and user_id = p_user;
  perform log_event(p_room, 'player_kicked', r.host_id, p_user);
  if r.status in ('headstart','active','paused') then perform check_win(p_room); end if;
end $$;

create or replace function public.transfer_host(p_room uuid, p_user uuid)
returns void language plpgsql security definer set search_path = public as $$
declare r rooms := require_host(p_room);
begin
  if not exists (select 1 from players where room_id = p_room and user_id = p_user and status <> 'left') then
    raise exception 'Player not in room';
  end if;
  update rooms set host_id = p_user where id = p_room;
  perform log_event(p_room, 'host_changed', r.host_id, p_user);
end $$;

create or replace function public.leave_room(p_room uuid)
returns void language plpgsql security definer set search_path = public as $$
declare uid uuid := require_uid(); r rooms; nxt uuid;
begin
  select * into r from rooms where id = p_room for update;
  if not found then return; end if;
  if r.status in ('lobby','ended') then
    delete from players where room_id = p_room and user_id = uid;
  else
    update players set status = 'left', out_of_zone_since = null where room_id = p_room and user_id = uid;
  end if;
  delete from positions where room_id = p_room and user_id = uid;
  perform log_event(p_room, 'player_left', uid);
  if r.host_id = uid then
    select user_id into nxt from players where room_id = p_room and user_id <> uid and status <> 'left'
      order by joined_at limit 1;
    if nxt is null then
      if r.status = 'lobby' then delete from rooms where id = p_room; return; end if;
    else
      update rooms set host_id = nxt where id = p_room;
      perform log_event(p_room, 'host_changed', uid, nxt);
    end if;
  end if;
  if r.status in ('headstart','active','paused') then perform check_win(p_room); end if;
end $$;

-- ---------------------------------------------------------------- match lifecycle
create or replace function public.start_match(p_room uuid)
returns void language plpgsql security definer set search_path = public as $$
declare r rooms := require_host(p_room); n int; a int; b int; hp positions;
begin
  if r.status <> 'lobby' then raise exception 'Match already started'; end if;
  perform _auto_assign(p_room, false);
  select count(*) into n from players where room_id = p_room and team <> 'spectator' and status <> 'left';
  if n < 2 then raise exception 'Need at least 2 players'; end if;
  if r.mode = 'team_vs_team' then
    select count(*) filter (where team = 'red'), count(*) filter (where team = 'blue') into a, b
      from players where room_id = p_room and status <> 'left';
  else
    select count(*) filter (where team = 'hunter'), count(*) filter (where team = 'shadow') into a, b
      from players where room_id = p_room and status <> 'left';
  end if;
  if a = 0 or b = 0 then raise exception 'Both sides need at least one player'; end if;
  if r.zone_lat is null then
    select * into hp from positions where room_id = p_room and user_id = r.host_id;
    if not found then raise exception 'Set a zone centre (or share your location) before starting'; end if;
    update rooms set zone_lat = hp.lat, zone_lng = hp.lng where id = p_room;
  end if;
  delete from players where room_id = p_room and status = 'left';
  update players set status = 'alive', captures = 0, score = 0, distance_m = 0, flags = 0,
    captured_at = null, captured_by = null, out_of_zone_since = null where room_id = p_room;
  update rooms set
    status = case when head_start_s > 0 then 'headstart' else 'active' end,
    started_at = now(),
    headstart_ends_at = now() + make_interval(secs => head_start_s),
    ends_at = now() + make_interval(secs => head_start_s + duration_s),
    last_reveal_at = null,
    initial_prey = (select count(*) from players p where p.room_id = p_room and is_prey(r.mode, p.team))
  where id = p_room;
  perform log_event(p_room, 'match_started', r.host_id, null, jsonb_build_object('mode', r.mode));
  if r.head_start_s = 0 then perform log_event(p_room, 'hunt_started'); end if;
end $$;

create or replace function public.finish_match(p_room uuid, p_winner text, p_winner_player uuid default null)
returns void language plpgsql security definer set search_path = public as $$
declare r rooms; rec record; won boolean; surv int; xpv int; ach text[];
begin
  select * into r from rooms where id = p_room;
  if r.status = 'ended' then return; end if;
  update rooms set status = 'ended', ended_at = now(), winner = p_winner, winner_player = p_winner_player,
    paused_at = null where id = p_room;
  perform log_event(p_room, 'match_ended', null, p_winner_player, jsonb_build_object('winner', p_winner));
  delete from positions where room_id = p_room;  -- exact live positions are not retained after a match
  if p_winner = 'aborted' then return; end if;

  for rec in select * from players where room_id = p_room and team <> 'spectator' loop
    won := case
      when p_winner = 'draw' then false
      when p_winner_player is not null then rec.user_id = p_winner_player
      when r.mode in ('last_shadow','infection') and p_winner = 'shadow' then rec.team = 'shadow' and rec.status = 'alive'
      else rec.team = p_winner end;
    surv := greatest(0, extract(epoch from coalesce(rec.captured_at, now()) - r.headstart_ends_at))::int;
    xpv := 50 + case when won then 150 else 0 end + rec.captures * 40
         + case when is_prey(r.mode, rec.team) then (surv / 60) * 3 else 0 end
         + least(200, floor(rec.distance_m / 100)::int);
    insert into match_results (room_id, user_id, team, won, xp, captures, survived_s, distance_m)
    values (p_room, rec.user_id, rec.team, won, xpv, rec.captures, surv, rec.distance_m)
    on conflict do nothing;
    update profiles set xp = xp + xpv, matches_played = matches_played + 1, wins = wins + won::int,
      total_captures = total_captures + rec.captures, total_distance_m = total_distance_m + rec.distance_m
    where id = rec.user_id;

    ach := array['first_match'];
    if won then ach := array_append(ach, 'first_win'); end if;
    if rec.captures >= 1 then ach := array_append(ach, 'first_blood'); end if;
    if rec.captures >= 3 then ach := array_append(ach, 'hat_trick'); end if;
    if rec.distance_m >= 3000 then ach := array_append(ach, 'marathon'); end if;
    if rec.team = 'shadow' and rec.status = 'alive' and p_winner <> 'hunter' then ach := array_append(ach, 'ghost'); end if;
    if won and r.mode = 'last_shadow' and rec.team = 'shadow' then ach := array_append(ach, 'last_standing'); end if;
    if won and r.mode = 'infection' and rec.team = 'hunter' then ach := array_append(ach, 'outbreak'); end if;
    if won and r.mode = 'team_vs_team' then ach := array_append(ach, 'squad_goals'); end if;
    if won and r.mode = 'battle_royale' then ach := array_append(ach, 'zone_master'); end if;
    if rec.flags = 0 and won then ach := array_append(ach, 'clean_play'); end if;
    if (select matches_played from profiles where id = rec.user_id) >= 10 then ach := array_append(ach, 'veteran'); end if;
    if (select wins from profiles where id = rec.user_id) >= 10 then ach := array_append(ach, 'champion'); end if;
    insert into achievements (user_id, code) select rec.user_id, unnest(ach) on conflict do nothing;
  end loop;
end $$;

-- Win detection. Returns true if the match ended.
create or replace function public.check_win(p_room uuid)
returns boolean language plpgsql security definer set search_path = public as $$
declare r rooms; alive_shadow int; alive_red int; alive_blue int; last_one uuid; cap_red int; cap_blue int;
begin
  select * into r from rooms where id = p_room;
  if r.status not in ('headstart','active','paused') then return false; end if;
  if r.mode = 'team_vs_team' then
    select count(*) filter (where team = 'red' and status = 'alive'),
           count(*) filter (where team = 'blue' and status = 'alive'),
           coalesce(sum(captures) filter (where team = 'red'), 0),
           coalesce(sum(captures) filter (where team = 'blue'), 0)
      into alive_red, alive_blue, cap_red, cap_blue from players where room_id = p_room;
    if alive_red = 0 and alive_blue = 0 then perform finish_match(p_room, 'draw'); return true; end if;
    if alive_red = 0 then perform finish_match(p_room, 'blue'); return true; end if;
    if alive_blue = 0 then perform finish_match(p_room, 'red'); return true; end if;
    if r.status <> 'paused' and now() >= r.ends_at then
      perform finish_match(p_room, case
        when alive_red > alive_blue then 'red' when alive_blue > alive_red then 'blue'
        when cap_red > cap_blue then 'red' when cap_blue > cap_red then 'blue' else 'draw' end);
      return true;
    end if;
    return false;
  end if;

  select count(*) into alive_shadow from players where room_id = p_room and team = 'shadow' and status = 'alive';
  if alive_shadow = 0 then perform finish_match(p_room, 'hunter'); return true; end if;
  if r.mode = 'last_shadow' and r.initial_prey >= 2 and alive_shadow = 1 then
    select user_id into last_one from players where room_id = p_room and team = 'shadow' and status = 'alive';
    perform finish_match(p_room, 'shadow', last_one); return true;
  end if;
  if r.status <> 'paused' and now() >= r.ends_at then perform finish_match(p_room, 'shadow'); return true; end if;
  return false;
end $$;

create or replace function public.end_match(p_room uuid)
returns void language plpgsql security definer set search_path = public as $$
declare r rooms := require_host(p_room);
begin
  if r.status = 'lobby' or r.status = 'ended' then raise exception 'No match in progress'; end if;
  perform finish_match(p_room, 'aborted');
end $$;


create or replace function public.emergency_stop(p_room uuid, p_reason text default null)
returns void language plpgsql security definer set search_path = public as $$
declare uid uuid := require_uid(); r rooms;
begin
  select * into r from rooms where id = p_room for update;
  if not is_member(p_room) then raise exception 'Not in this room'; end if;
  if r.status not in ('headstart','active') then return; end if;
  update rooms set status = 'paused', paused_at = now(), paused_by = uid where id = p_room;
  perform log_event(p_room, 'emergency_stop', uid, null, jsonb_build_object('reason', left(coalesce(p_reason, ''), 140)));
end $$;

create or replace function public.resume_match(p_room uuid)
returns void language plpgsql security definer set search_path = public as $$
declare r rooms := require_host(p_room); d interval;
begin
  if r.status <> 'paused' then raise exception 'Match is not paused'; end if;
  d := now() - r.paused_at;
  update rooms set started_at = started_at + d, headstart_ends_at = headstart_ends_at + d,
    ends_at = ends_at + d, last_reveal_at = last_reveal_at + d, paused_at = null, paused_by = null,
    status = case when now() < headstart_ends_at + d then 'headstart' else 'active' end
  where id = p_room;
  update players set out_of_zone_since = null, last_seen_at = greatest(last_seen_at, now() - interval '30 seconds')
    where room_id = p_room;
  perform log_event(p_room, 'resumed', r.host_id);
end $$;

-- ---------------------------------------------------------------- captures
create or replace function public._confirm_capture(p_capture bigint)
returns void language plpgsql security definer set search_path = public as $$
declare c captures; r rooms;
begin
  select * into c from captures where id = p_capture for update;
  if c.status not in ('pending','disputed') then return; end if;
  select * into r from rooms where id = c.room_id;
  update captures set status = 'confirmed', resolved_at = now() where id = p_capture;
  update players set captures = captures + 1, score = score + 100 where room_id = c.room_id and user_id = c.hunter_id;
  if r.mode = 'infection' then
    update players set team = 'hunter', captured_at = now(), captured_by = c.hunter_id, out_of_zone_since = null
      where room_id = c.room_id and user_id = c.target_id;
    perform log_event(c.room_id, 'infected', c.hunter_id, c.target_id);
  else
    update players set status = 'captured', captured_at = now(), captured_by = c.hunter_id, out_of_zone_since = null
      where room_id = c.room_id and user_id = c.target_id;
    perform log_event(c.room_id, 'capture_confirmed', c.hunter_id, c.target_id,
      jsonb_build_object('distance_m', round(c.distance_m::numeric, 1)));
  end if;
  perform check_win(c.room_id);
end $$;

create or replace function public.tag_player(p_room uuid, p_target uuid)
returns jsonb language plpgsql security definer set search_path = public as $$
declare uid uuid := require_uid(); r rooms; me players; tg players; a positions; b positions;
  d double precision; tol double precision; fresh interval; cid bigint;
begin
  select * into r from rooms where id = p_room for update;
  if r.status <> 'active' then raise exception 'Tagging is only possible during the hunt'; end if;
  select * into me from players where room_id = p_room and user_id = uid;
  select * into tg from players where room_id = p_room and user_id = p_target;
  if me.user_id is null or tg.user_id is null then raise exception 'Player not in room'; end if;
  if me.status <> 'alive' then raise exception 'You are out of the game'; end if;
  if tg.status <> 'alive' then raise exception 'Target is already out'; end if;
  if not can_tag(r.mode, me.team, tg.team) then raise exception 'You cannot tag that player'; end if;
  if exists (select 1 from captures where room_id = p_room and target_id = p_target and status in ('pending','disputed')) then
    raise exception 'A capture on this player is already pending';
  end if;
  fresh := make_interval(secs => greatest(20, r.location_interval_s * 3));
  select * into a from positions where room_id = p_room and user_id = uid;
  select * into b from positions where room_id = p_room and user_id = p_target;
  if a.user_id is null or a.updated_at < now() - fresh then raise exception 'Your GPS fix is too old — move to open sky'; end if;
  if b.user_id is null or b.updated_at < now() - fresh then raise exception 'Target GPS signal is stale — get closer and retry'; end if;
  if a.suspect then raise exception 'Your location was flagged as anomalous; wait for a clean fix'; end if;
  d := geo_dist(a.lat, a.lng, b.lat, b.lng);
  tol := r.tag_radius_m + least(20, coalesce(a.accuracy, 0) * 0.5 + coalesce(b.accuracy, 0) * 0.5);
  if d > tol then
    perform log_event(p_room, 'tag_missed', uid, null, '{}'::jsonb);  -- distance not disclosed
    return jsonb_build_object('ok', false, 'reason', 'Out of range');
  end if;
  if in_safe_zone(r, b.lat, b.lng) then return jsonb_build_object('ok', false, 'reason', 'Target is inside a safe zone'); end if;
  insert into captures (room_id, hunter_id, target_id, distance_m) values (p_room, uid, p_target, d) returning id into cid;
  if rule_bool(r, 'capture_confirm', true) then
    perform log_event(p_room, 'capture_pending', uid, p_target, jsonb_build_object('capture_id', cid));
  else
    perform _confirm_capture(cid);
  end if;
  return jsonb_build_object('ok', true, 'capture_id', cid);
end $$;

create or replace function public.respond_capture(p_capture bigint, p_accept boolean)
returns void language plpgsql security definer set search_path = public as $$
declare c captures;
begin
  select * into c from captures where id = p_capture;
  if c.target_id <> require_uid() then raise exception 'Not your capture to respond to'; end if;
  if c.status <> 'pending' then return; end if;
  if p_accept then perform _confirm_capture(p_capture);
  else
    update captures set status = 'disputed' where id = p_capture;
    perform log_event(c.room_id, 'capture_disputed', c.target_id, c.hunter_id, jsonb_build_object('capture_id', p_capture));
  end if;
end $$;

create or replace function public.resolve_capture(p_capture bigint, p_accept boolean)
returns void language plpgsql security definer set search_path = public as $$
declare c captures; r rooms;
begin
  select * into c from captures where id = p_capture;
  if not found then raise exception 'Capture not found'; end if;
  r := require_host(c.room_id);
  if c.status not in ('pending','disputed') then return; end if;
  if p_accept then perform _confirm_capture(p_capture);
  else
    update captures set status = 'rejected', resolved_at = now() where id = p_capture;
    perform log_event(c.room_id, 'capture_rejected', r.host_id, c.target_id);
  end if;
end $$;

-- ---------------------------------------------------------------- tick (idempotent; any member may call)
create or replace function public.tick(p_room uuid)
returns jsonb language plpgsql security definer set search_path = public as $$
declare r rooms; rad double precision; rec record; disc int; c record; blur double precision; ang double precision; rr double precision;
begin
  if not is_member(p_room) then raise exception 'Not in this room'; end if;
  select * into r from rooms where id = p_room for update skip locked;
  if not found then return jsonb_build_object('busy', true); end if;

  if r.status = 'headstart' and now() >= r.headstart_ends_at then
    update rooms set status = 'active' where id = p_room returning * into r;
    perform log_event(p_room, 'hunt_started');
  end if;

  if r.status = 'active' then
    -- unanswered capture requests auto-confirm after 30s (disputes wait for the host)
    for c in select id from captures where room_id = p_room and status = 'pending' and created_at < now() - interval '30 seconds' loop
      perform _confirm_capture(c.id);
    end loop;
    select * into r from rooms where id = p_room;
    if r.status <> 'active' then return jsonb_build_object('status', r.status); end if;

    rad := zone_radius(r, now());
    for rec in select p.user_id, p.out_of_zone_since, p.last_seen_at, pos.lat, pos.lng
               from players p left join positions pos on pos.room_id = p.room_id and pos.user_id = p.user_id
               where p.room_id = p_room and p.status = 'alive' and is_prey(r.mode, p.team) loop
      if rec.lat is not null and r.zone_lat is not null then
        if geo_dist(rec.lat, rec.lng, r.zone_lat, r.zone_lng) > rad then
          if rec.out_of_zone_since is null then
            update players set out_of_zone_since = now() where room_id = p_room and user_id = rec.user_id;
            perform log_event(p_room, 'zone_warning', rec.user_id);
          elsif rule_bool(r, 'zone_elimination', r.mode = 'battle_royale')
                and now() - rec.out_of_zone_since > make_interval(secs => r.zone_grace_s) then
            update players set status = 'eliminated' where room_id = p_room and user_id = rec.user_id;
            perform log_event(p_room, 'zone_eliminated', null, rec.user_id);
          end if;
        elsif rec.out_of_zone_since is not null then
          update players set out_of_zone_since = null where room_id = p_room and user_id = rec.user_id;
        end if;
      end if;
      disc := rule_int(r, 'disconnect_elim_s', 300);
      if disc > 0 and rec.last_seen_at < now() - make_interval(secs => disc) then
        update players set status = 'eliminated' where room_id = p_room and user_id = rec.user_id and status = 'alive';
        perform log_event(p_room, 'disconnect_eliminated', null, rec.user_id);
      end if;
    end loop;

    -- scheduled reveals (blurred; exact position is always inside the circle)
    if now() >= coalesce(r.last_reveal_at, r.headstart_ends_at) + make_interval(secs => r.reveal_interval_s) then
      blur := r.reveal_blur_m;
      for rec in select p.user_id, p.team, pos.lat, pos.lng, pos.updated_at
                 from players p join positions pos on pos.room_id = p.room_id and pos.user_id = p.user_id
                 where p.room_id = p_room and p.status = 'alive'
                   and (is_prey(r.mode, p.team) or (p.team = 'hunter' and rule_bool(r, 'reveal_hunters', false))) loop
        ang := random() * 2 * pi(); rr := blur * sqrt(random());
        insert into reveals (room_id, user_id, team, lat, lng, radius_m, stale)
        values (p_room, rec.user_id, rec.team,
          rec.lat + (rr * cos(ang)) / 111320.0,
          rec.lng + (rr * sin(ang)) / (111320.0 * greatest(0.01, cos(radians(rec.lat)))),
          greatest(blur, 5)::int, rec.updated_at < now() - interval '2 minutes');
      end loop;
      update rooms set last_reveal_at = now() where id = p_room;
      perform log_event(p_room, 'reveal');
    end if;
  end if;

  perform check_win(p_room);
  select * into r from rooms where id = p_room;
  return jsonb_build_object('status', r.status, 'zone_radius', zone_radius(r, now()));
end $$;

-- ---------------------------------------------------------------- location
create or replace function public.update_location(p_room uuid, p_lat double precision, p_lng double precision,
  p_accuracy double precision default null, p_heading double precision default null, p_speed double precision default null)
returns jsonb language plpgsql security definer set search_path = public as $$
declare uid uuid := require_uid(); r rooms; me players; prev positions; dt double precision; d double precision := 0;
  spd double precision; suspicious boolean := false; rad double precision; zd double precision;
  near double precision; bucket text; res jsonb;
begin
  if p_lat is null or p_lng is null or p_lat not between -90 and 90 or p_lng not between -180 and 180 then
    raise exception 'Invalid coordinates';
  end if;
  select * into r from rooms where id = p_room;
  select * into me from players where room_id = p_room and user_id = uid;
  if me.user_id is null then raise exception 'Not in this room'; end if;
  if r.status = 'ended' or me.team = 'spectator' then return jsonb_build_object('status', r.status); end if;
  if (select location_consent_at from profiles where id = uid) is null then
    raise exception 'Location consent required';
  end if;

  select * into prev from positions where room_id = p_room and user_id = uid;
  if prev.user_id is not null then
    dt := extract(epoch from now() - prev.updated_at);
    if dt < 1 then return jsonb_build_object('throttled', true); end if;
    d := geo_dist(prev.lat, prev.lng, p_lat, p_lng);
    spd := d / dt;
    -- Heuristic anomaly detection. NOT foolproof: GPS jitter, tunnels and vehicles cause false positives,
    -- and a careful spoofer can stay under the thresholds. The host makes the final call.
    if dt <= 300 and d > greatest(60, coalesce(p_accuracy, 0) * 2 + coalesce(prev.accuracy, 0)) and spd > r.max_speed_mps then
      suspicious := true;
      insert into anomalies (room_id, user_id, kind, speed_mps, distance_m)
      values (p_room, uid, case when d > 1000 and spd > r.max_speed_mps * 3 then 'teleport' else 'speed' end, spd, d);
      update players set flags = flags + 1 where room_id = p_room and user_id = uid returning * into me;
      if me.flags = rule_int(r, 'flag_threshold', 3) then
        perform log_event(p_room, 'anomaly_flag', null, uid, jsonb_build_object('flags', me.flags));
      end if;
    end if;
  end if;
  if p_accuracy is not null and p_accuracy > 150 then suspicious := true; end if;

  insert into positions (room_id, user_id, lat, lng, accuracy, heading, speed, suspect, updated_at)
  values (p_room, uid, p_lat, p_lng, p_accuracy, p_heading, p_speed, suspicious, now())
  on conflict (room_id, user_id) do update set lat = excluded.lat, lng = excluded.lng, accuracy = excluded.accuracy,
    heading = excluded.heading, speed = excluded.speed, suspect = excluded.suspect, updated_at = now();

  update players set last_seen_at = now(),
    distance_m = distance_m + case when not suspicious and r.status in ('headstart','active') and me.status = 'alive'
                                    and d > greatest(5, coalesce(p_accuracy, 0) * 0.5) then d else 0 end
  where room_id = p_room and user_id = uid;

  if r.status in ('headstart','active') and coalesce(rule_bool(r, 'record_replay', true), true)
     and (prev.history_at is null or prev.history_at < now() - make_interval(secs => greatest(r.location_interval_s, 5))) then
    insert into location_history (room_id, user_id, lat, lng) values (p_room, uid, p_lat, p_lng);
    update positions set history_at = now() where room_id = p_room and user_id = uid;
  end if;

  res := jsonb_build_object('status', r.status, 'suspect', suspicious);
  if r.zone_lat is not null then
    rad := zone_radius(r, now());
    zd := geo_dist(p_lat, p_lng, r.zone_lat, r.zone_lng);
    res := res || jsonb_build_object('zone_radius', rad, 'zone_dist', zd, 'outside', zd > rad,
      'in_safe_zone', in_safe_zone(r, p_lat, p_lng));
  end if;

  -- proximity: only a coarse band, never coordinates or bearing
  if r.status = 'active' and me.status = 'alive' and rule_bool(r, 'proximity_alerts', true) then
    select min(geo_dist(p_lat, p_lng, pos.lat, pos.lng)) into near
    from players o join positions pos on pos.room_id = o.room_id and pos.user_id = o.user_id
    where o.room_id = p_room and o.status = 'alive' and o.user_id <> uid
      and (can_tag(r.mode, me.team, o.team) or can_tag(r.mode, o.team, me.team))
      and pos.updated_at > now() - interval '1 minute';
    bucket := case when near is null then null when near < 50 then 'danger' when near < 150 then 'close'
                   when near < 300 then 'near' else 'far' end;
    res := res || jsonb_build_object('proximity', bucket);
  end if;
  return res;
end $$;

create or replace function public.heartbeat(p_room uuid)
returns void language sql security definer set search_path = public as $$
  update players set last_seen_at = now() where room_id = p_room and user_id = auth.uid();
$$;


-- rematch: host clones the room (settings + password) and announces it to everyone in the old one
create or replace function public.rematch(p_room uuid)
returns uuid language plpgsql security definer set search_path = public as $$
declare r rooms := require_host(p_room); rid uuid; nm text;
begin
  if r.status <> 'ended' then raise exception 'Match is not over'; end if;
  insert into rooms (code, host_id, name, mode, is_public, max_players, head_start_s, duration_s, reveal_interval_s,
    location_interval_s, reveal_blur_m, tag_radius_m, zone_lat, zone_lng, zone_start_m, zone_end_m, zone_steps,
    zone_grace_s, max_speed_mps, safe_zones, rules, map_id, tournament_id)
  select gen_room_code(), r.host_id, r.name, r.mode, r.is_public, r.max_players, r.head_start_s, r.duration_s,
    r.reveal_interval_s, r.location_interval_s, r.reveal_blur_m, r.tag_radius_m, r.zone_lat, r.zone_lng,
    r.zone_start_m, r.zone_end_m, r.zone_steps, r.zone_grace_s, r.max_speed_mps, r.safe_zones, r.rules, r.map_id,
    case when exists (select 1 from tournaments t where t.id = r.tournament_id and t.status = 'open') then r.tournament_id end
  returning id into rid;
  insert into room_secrets (room_id, password_hash) select rid, password_hash from room_secrets where room_id = p_room;
  select display_name into nm from players where room_id = p_room and user_id = r.host_id;
  insert into players (room_id, user_id, display_name, team)
  select rid, r.host_id, coalesce(nm, 'Host'), case when team = 'spectator' then 'spectator' end
  from players where room_id = p_room and user_id = r.host_id;
  perform log_event(p_room, 'rematch', r.host_id, null, jsonb_build_object('code', (select code from rooms where id = rid)));
  return rid;
end $$;

-- rematch joins skip the password for players of the previous match
create or replace function public.join_rematch(p_old_room uuid, p_code text)
returns uuid language plpgsql security definer set search_path = public as $$
declare uid uuid := require_uid(); rid uuid; nm text;
begin
  if not exists (select 1 from events e where e.room_id = p_old_room and e.type = 'rematch' and e.payload->>'code' = upper(p_code))
     or not exists (select 1 from players where room_id = p_old_room and user_id = uid) then
    raise exception 'Not eligible for this rematch';
  end if;
  select id into rid from rooms where code = upper(p_code) and status = 'lobby';
  if rid is null then raise exception 'Rematch lobby closed'; end if;
  if exists (select 1 from players where room_id = rid and user_id = uid) then return rid; end if;
  if (select count(*) from players where room_id = rid and team is distinct from 'spectator') >= (select max_players from rooms where id = rid) then
    raise exception 'Room is full';
  end if;
  select display_name into nm from players where room_id = p_old_room and user_id = uid;
  insert into players (room_id, user_id, display_name) values (rid, uid, nm);
  perform log_event(rid, 'player_joined', uid);
  return rid;
end $$;

-- ---------------------------------------------------------------- tournaments
create or replace function public.create_tournament(p_name text)
returns uuid language plpgsql security definer set search_path = public as $$
declare tid uuid;
begin
  insert into tournaments (owner_id, name) values (require_uid(), left(trim(p_name), 60)) returning id into tid;
  return tid;
end $$;

create or replace function public.close_tournament(p_id uuid)
returns void language sql security definer set search_path = public as $$
  update tournaments set status = 'closed' where id = p_id and owner_id = auth.uid();
$$;

create or replace function public.tournament_standings(p_id uuid)
returns table (user_id uuid, username text, matches bigint, wins bigint, captures bigint, points bigint)
language sql stable security definer set search_path = public as $$
  select mr.user_id, pr.username, count(*), count(*) filter (where mr.won), sum(mr.captures),
    sum(case when mr.won then 3 else 0 end + mr.captures + case when mr.survived_s >= 600 then 1 else 0 end)
  from match_results mr join rooms r on r.id = mr.room_id join profiles pr on pr.id = mr.user_id
  where r.tournament_id = p_id
  group by mr.user_id, pr.username
  order by 6 desc, 4 desc;
$$;

create or replace function public.tournament_matches(p_id uuid)
returns table (id uuid, name text, mode text, status text, winner text, ended_at timestamptz, players bigint)
language sql stable security definer set search_path = public as $$
  select r.id, r.name, r.mode, r.status, r.winner, r.ended_at,
    (select count(*) from players p where p.room_id = r.id and p.team <> 'spectator')
  from rooms r where r.tournament_id = p_id order by r.created_at desc;
$$;

-- ---------------------------------------------------------------- privacy
create or replace function public.delete_my_location_data()
returns void language plpgsql security definer set search_path = public as $$
declare uid uuid := require_uid();
begin
  delete from location_history where user_id = uid;
  delete from positions p where p.user_id = uid
    and not exists (select 1 from rooms r where r.id = p.room_id and r.status in ('headstart','active','paused'));
end $$;

create or replace function public.purge_location_history()
returns void language sql security definer set search_path = public as $$
  delete from location_history where recorded_at < now() - interval '48 hours';
  delete from positions where updated_at < now() - interval '6 hours';
  delete from rooms where status = 'lobby' and created_at < now() - interval '24 hours';
$$;

-- schedule purge if pg_cron is available (Supabase: enable "pg_cron" extension first)
do $$
begin
  if exists (select 1 from pg_extension where extname = 'pg_cron') then
    perform cron.schedule('shadowhunt-purge', '17 * * * *', 'select public.purge_location_history()');
  end if;
exception when others then
  raise notice 'pg_cron scheduling skipped: %', sqlerrm;
end $$;

-- ---------------------------------------------------------------- grants
revoke execute on all functions in schema public from public, anon;
grant execute on function
  public.create_room(jsonb, text), public.update_settings(uuid, jsonb), public.join_room(text, text, text, boolean),
  public.list_public_rooms(), public.quick_match(text, text), public.set_ready(uuid, boolean),
  public.set_team(uuid, uuid, text), public.shuffle_teams(uuid), public.kick_player(uuid, uuid),
  public.transfer_host(uuid, uuid), public.leave_room(uuid), public.start_match(uuid), public.end_match(uuid),
  public.emergency_stop(uuid, text), public.resume_match(uuid), public.tag_player(uuid, uuid),
  public.respond_capture(bigint, boolean), public.resolve_capture(bigint, boolean), public.tick(uuid),
  public.update_location(uuid, double precision, double precision, double precision, double precision, double precision),
  public.heartbeat(uuid), public.rematch(uuid), public.join_rematch(uuid, text), public.create_tournament(text), public.close_tournament(uuid),
  public.tournament_standings(uuid), public.tournament_matches(uuid), public.delete_my_location_data(),
  public.is_member(uuid), public.my_team(uuid), public.is_referee(uuid), public.geo_dist(float8, float8, float8, float8)
to authenticated;
-- internal-only functions stay non-executable for clients:
revoke execute on function public.finish_match(uuid, text, uuid), public.check_win(uuid),
  public._confirm_capture(bigint), public._apply_settings(uuid, jsonb), public._auto_assign(uuid, boolean),
  public.log_event(uuid, text, uuid, uuid, jsonb), public.purge_location_history(), public.require_host(uuid)
from authenticated;
