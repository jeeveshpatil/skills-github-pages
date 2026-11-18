-- ShadowHunt Pro — core schema, RLS and realtime.
-- All match mutations go through SECURITY DEFINER RPCs (see 000002). Clients get
-- read access only, filtered by row level security.

create extension if not exists pgcrypto with schema extensions;

-- ---------------------------------------------------------------- tables
create table public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  username text not null check (char_length(username) between 2 and 24),
  xp integer not null default 0,
  matches_played integer not null default 0,
  wins integer not null default 0,
  total_captures integer not null default 0,
  total_distance_m double precision not null default 0,
  location_consent_at timestamptz,
  created_at timestamptz not null default now()
);

create table public.tournaments (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references public.profiles(id) on delete cascade,
  name text not null check (char_length(name) between 2 and 60),
  status text not null default 'open' check (status in ('open','closed')),
  created_at timestamptz not null default now()
);

create table public.maps (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references public.profiles(id) on delete cascade,
  name text not null check (char_length(name) between 2 and 60),
  center_lat double precision not null check (center_lat between -90 and 90),
  center_lng double precision not null check (center_lng between -180 and 180),
  radius_m integer not null check (radius_m between 50 and 20000),
  safe_zones jsonb not null default '[]'::jsonb,
  is_public boolean not null default false,
  created_at timestamptz not null default now()
);

create table public.rooms (
  id uuid primary key default gen_random_uuid(),
  code text not null unique,
  host_id uuid not null references public.profiles(id),
  name text not null default 'Operation',
  mode text not null default 'classic'
    check (mode in ('classic','battle_royale','team_vs_team','infection','last_shadow')),
  status text not null default 'lobby'
    check (status in ('lobby','headstart','active','paused','ended')),
  is_public boolean not null default false,
  max_players integer not null default 12,
  head_start_s integer not null default 120,
  duration_s integer not null default 1800,
  reveal_interval_s integer not null default 180,
  location_interval_s integer not null default 5,
  reveal_blur_m integer not null default 60,
  tag_radius_m integer not null default 15,
  zone_lat double precision,
  zone_lng double precision,
  zone_start_m integer not null default 800,
  zone_end_m integer not null default 200,
  zone_steps integer not null default 4,
  zone_grace_s integer not null default 60,
  max_speed_mps double precision not null default 12,
  safe_zones jsonb not null default '[]'::jsonb,
  rules jsonb not null default '{}'::jsonb,
  map_id uuid references public.maps(id) on delete set null,
  tournament_id uuid references public.tournaments(id) on delete set null,
  initial_prey integer not null default 0,
  referee_id uuid,  -- non-playing host pinned at match start (sees live positions)
  started_at timestamptz,
  headstart_ends_at timestamptz,
  ends_at timestamptz,
  paused_at timestamptz,
  paused_by uuid,
  ended_at timestamptz,
  last_reveal_at timestamptz,
  winner text,
  winner_player uuid,
  created_at timestamptz not null default now()
);
create index rooms_public_lobby on public.rooms (created_at desc) where is_public and status = 'lobby';

-- room passwords live apart from rooms so no client can ever select them
create table public.room_secrets (
  room_id uuid primary key references public.rooms(id) on delete cascade,
  password_hash text not null
);

create table public.players (
  room_id uuid not null references public.rooms(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade,
  display_name text not null,
  team text check (team in ('hunter','shadow','red','blue','spectator')),
  status text not null default 'alive' check (status in ('alive','captured','eliminated','left')),
  ready boolean not null default false,
  joined_at timestamptz not null default now(),
  last_seen_at timestamptz not null default now(),
  captured_at timestamptz,
  captured_by uuid,
  captures integer not null default 0,
  score integer not null default 0,
  distance_m double precision not null default 0,
  out_of_zone_since timestamptz,
  flags integer not null default 0,
  primary key (room_id, user_id)
);
create index players_user on public.players (user_id);

-- latest exact position (private: own team / self / referee only)
create table public.positions (
  room_id uuid not null references public.rooms(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade,
  lat double precision not null,
  lng double precision not null,
  accuracy double precision,
  heading double precision,
  speed double precision,
  suspect boolean not null default false,
  updated_at timestamptz not null default now(),
  history_at timestamptz,
  primary key (room_id, user_id)
);

-- coarse track for replays; readable only after the match ends; purged after 48h
create table public.location_history (
  id bigint generated always as identity primary key,
  room_id uuid not null references public.rooms(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade,
  lat double precision not null,
  lng double precision not null,
  recorded_at timestamptz not null default now()
);
create index location_history_room on public.location_history (room_id, recorded_at);
create index location_history_age on public.location_history (recorded_at);

-- server-generated, blurred location reveals
create table public.reveals (
  id bigint generated always as identity primary key,
  room_id uuid not null references public.rooms(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade,
  team text not null,
  lat double precision not null,
  lng double precision not null,
  radius_m integer not null,
  stale boolean not null default false,
  created_at timestamptz not null default now()
);
create index reveals_room on public.reveals (room_id, created_at desc);

create table public.captures (
  id bigint generated always as identity primary key,
  room_id uuid not null references public.rooms(id) on delete cascade,
  hunter_id uuid not null references public.profiles(id) on delete cascade,
  target_id uuid not null references public.profiles(id) on delete cascade,
  distance_m double precision not null,
  status text not null default 'pending' check (status in ('pending','disputed','confirmed','rejected')),
  created_at timestamptz not null default now(),
  resolved_at timestamptz
);
create index captures_room on public.captures (room_id);

create table public.events (
  id bigint generated always as identity primary key,
  room_id uuid not null references public.rooms(id) on delete cascade,
  type text not null,
  actor uuid,
  target uuid,
  payload jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);
create index events_room on public.events (room_id, id);

create table public.anomalies (
  id bigint generated always as identity primary key,
  room_id uuid not null references public.rooms(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade,
  kind text not null,
  speed_mps double precision,
  distance_m double precision,
  created_at timestamptz not null default now()
);
create index anomalies_room on public.anomalies (room_id);

create table public.match_results (
  room_id uuid not null references public.rooms(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade,
  team text not null,
  won boolean not null,
  xp integer not null,
  captures integer not null,
  survived_s integer not null,
  distance_m double precision not null,
  created_at timestamptz not null default now(),
  primary key (room_id, user_id)
);
create index match_results_user on public.match_results (user_id, created_at desc);

create table public.achievements (
  user_id uuid not null references public.profiles(id) on delete cascade,
  code text not null,
  unlocked_at timestamptz not null default now(),
  primary key (user_id, code)
);

-- ---------------------------------------------------------------- helpers
create or replace function public.is_member(p_room uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from players where room_id = p_room and user_id = auth.uid());
$$;

create or replace function public.my_team(p_room uuid)
returns text language sql stable security definer set search_path = public as $$
  select team from players where room_id = p_room and user_id = auth.uid();
$$;

create or replace function public.is_referee(p_room uuid)
returns boolean language sql stable security definer set search_path = public as $$
  -- pinned at start_match, so transferring host mid-match cannot hand live positions to anyone
  select exists (
    select 1 from rooms r where r.id = p_room and r.referee_id = auth.uid()
      and coalesce((r.rules->>'referee_live')::boolean, true)
  );
$$;

-- new auth user -> profile
create or replace function public.handle_new_user()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  insert into profiles (id, username)
  values (new.id, left(coalesce(nullif(trim(new.raw_user_meta_data->>'username'), ''),
                               'Agent-' || upper(substr(replace(new.id::text, '-', ''), 1, 5))), 24))
  on conflict (id) do nothing;
  return new;
end $$;
create trigger on_auth_user_created after insert on auth.users
  for each row execute function public.handle_new_user();

-- ---------------------------------------------------------------- RLS
alter table public.profiles enable row level security;
alter table public.tournaments enable row level security;
alter table public.maps enable row level security;
alter table public.rooms enable row level security;
alter table public.room_secrets enable row level security;
alter table public.players enable row level security;
alter table public.positions enable row level security;
alter table public.location_history enable row level security;
alter table public.reveals enable row level security;
alter table public.captures enable row level security;
alter table public.events enable row level security;
alter table public.anomalies enable row level security;
alter table public.match_results enable row level security;
alter table public.achievements enable row level security;

revoke all on all tables in schema public from anon, authenticated;
grant select on all tables in schema public to authenticated;
revoke select on public.room_secrets from authenticated;
grant update (username, location_consent_at) on public.profiles to authenticated;
grant insert, update, delete on public.maps to authenticated;

create policy profiles_read on public.profiles for select to authenticated using (true);
create policy profiles_update_own on public.profiles for update to authenticated
  using (id = auth.uid()) with check (id = auth.uid());

create policy tournaments_read on public.tournaments for select to authenticated using (true);

create policy maps_read on public.maps for select to authenticated using (is_public or owner_id = auth.uid());
create policy maps_insert on public.maps for insert to authenticated with check (owner_id = auth.uid());
create policy maps_update on public.maps for update to authenticated using (owner_id = auth.uid()) with check (owner_id = auth.uid());
create policy maps_delete on public.maps for delete to authenticated using (owner_id = auth.uid());

create policy rooms_read on public.rooms for select to authenticated
  using (is_member(id) or (is_public and status = 'lobby'));
create policy players_read on public.players for select to authenticated using (is_member(room_id));

-- Exact coordinates: self, own (non-spectator) team, or a non-playing referee host.
create policy positions_read on public.positions for select to authenticated using (
  user_id = auth.uid()
  or (is_member(room_id) and my_team(room_id) <> 'spectator'
      and my_team(room_id) = (select p.team from public.players p where p.room_id = positions.room_id and p.user_id = positions.user_id))
  or is_referee(room_id)
);
create policy history_read on public.location_history for select to authenticated using (
  user_id = auth.uid()
  or (is_member(room_id) and exists (select 1 from public.rooms r where r.id = room_id and r.status = 'ended'))
);
create policy reveals_read on public.reveals for select to authenticated using (is_member(room_id));
create policy captures_read on public.captures for select to authenticated using (is_member(room_id));
create policy events_read on public.events for select to authenticated using (is_member(room_id));
create policy anomalies_read on public.anomalies for select to authenticated using (
  user_id = auth.uid() or exists (select 1 from public.rooms r where r.id = room_id and r.host_id = auth.uid())
);
create policy results_read on public.match_results for select to authenticated using (true);
create policy achievements_read on public.achievements for select to authenticated using (true);

-- ---------------------------------------------------------------- realtime
do $$
begin
  if not exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    create publication supabase_realtime;
  end if;
  alter publication supabase_realtime add table public.rooms, public.players, public.positions,
    public.reveals, public.captures, public.events;
end $$;
alter table public.players replica identity full;
alter table public.positions replica identity full;
