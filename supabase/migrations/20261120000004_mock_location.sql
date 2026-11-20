-- Native apps can see when Android delivers a location from a mock-location app (Location.isMock).
-- The client reports it; this records an anomaly for the host. Client-reported => a hint, not proof:
-- a modified app can simply not report it. At most one record per player per minute.
create or replace function public.report_mock_location(p_room uuid)
returns void language plpgsql security definer set search_path = public as $$
declare uid uuid := require_uid(); r rooms; me players;
begin
  select * into r from rooms where id = p_room;
  select * into me from players where room_id = p_room and user_id = uid;
  if me.user_id is null then raise exception 'Not in this room'; end if;
  if r.status not in ('headstart','active','paused') then return; end if;
  if exists (select 1 from anomalies where room_id = p_room and user_id = uid and kind = 'mock_location'
             and created_at > now() - interval '1 minute') then return; end if;
  insert into anomalies (room_id, user_id, kind) values (p_room, uid, 'mock_location');
  update positions set suspect = true where room_id = p_room and user_id = uid;
  update players set flags = flags + 1 where room_id = p_room and user_id = uid returning * into me;
  if me.flags = rule_int(r, 'flag_threshold', 3) then
    perform log_event(p_room, 'anomaly_flag', null, uid, jsonb_build_object('flags', me.flags, 'kind', 'mock_location'));
  end if;
end $$;
revoke execute on function public.report_mock_location(uuid) from public, anon;
grant execute on function public.report_mock_location(uuid) to authenticated;
