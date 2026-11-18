-- End-to-end engine test: lobby -> classic match -> capture -> win; plus security checks.
\set H '''11111111-1111-1111-1111-111111111111'''
\set S1 '''22222222-2222-2222-2222-222222222222'''
\set S2 '''33333333-3333-3333-3333-333333333333'''
\set X '''44444444-4444-4444-4444-444444444444'''
insert into auth.users (id, raw_user_meta_data) values
  (:H, '{"username":"Hunter"}'), (:S1, '{"username":"Shade"}'), (:S2, '{}'), (:X, '{}');
update profiles set location_consent_at = now();
create table t_ctx (k text primary key, v text); grant all on t_ctx to authenticated;

-- host creates a password-protected classic room
select set_config('request.jwt.claim.sub', :H, false); set role authenticated;
insert into t_ctx select 'room', create_room('{"name":"Op Night","mode":"classic","password":"pw1","head_start_s":60,"duration_s":600,"reveal_interval_s":60,"zone_lat":51.5,"zone_lng":-0.1,"zone_start_m":800,"zone_end_m":200}'::jsonb)::text;
insert into t_ctx select 'code', code from rooms where id = (select v::uuid from t_ctx where k='room');
reset role;

-- wrong password rejected, right one accepted
select set_config('request.jwt.claim.sub', :S1, false); set role authenticated;
do $$ begin perform join_room((select v from t_ctx where k='code'), 'nope'); raise exception 'should fail';
exception when others then assert sqlerrm = 'Wrong room password', sqlerrm; end $$;
select join_room((select v from t_ctx where k='code'), 'pw1');
-- direct writes are blocked
do $$ begin update rooms set status='ended'; raise exception 'should fail';
exception when insufficient_privilege then null; end $$;
do $$ begin perform 1 from room_secrets; raise exception 'should fail';
exception when insufficient_privilege then null; end $$;
reset role;
select set_config('request.jwt.claim.sub', :S2, false); set role authenticated;
select join_room((select v from t_ctx where k='code'), 'pw1', 'Ghost');
reset role;

-- outsider sees nothing
select set_config('request.jwt.claim.sub', :X, false); set role authenticated;
do $$ begin assert (select count(*) from rooms) = 0, 'outsider sees private room';
assert (select count(*) from players) = 0, 'outsider sees players'; end $$;
do $$ begin perform start_match((select v::uuid from t_ctx where k='room')); raise exception 'should fail';
exception when others then assert sqlerrm like 'Only the host%', sqlerrm; end $$;
reset role;

-- assign teams and start
select set_config('request.jwt.claim.sub', :H, false); set role authenticated;
select set_team((select v::uuid from t_ctx where k='room'), :H, 'hunter');
select set_team((select v::uuid from t_ctx where k='room'), :S1, 'shadow');
select set_team((select v::uuid from t_ctx where k='room'), :S2, 'shadow');
select start_match((select v::uuid from t_ctx where k='room'));
do $$ begin assert (select status from rooms) = 'headstart'; assert (select initial_prey from rooms) = 2; end $$;
do $$ begin perform update_settings((select v::uuid from t_ctx where k='room'), '{"duration_s":900}'); raise exception 'should fail';
exception when others then assert sqlerrm like 'Settings are locked%', sqlerrm; end $$;
reset role;

-- positions: hunter at centre, S1 ~10m away, S2 ~300m away
select set_config('request.jwt.claim.sub', :H, false); set role authenticated;
select update_location((select v::uuid from t_ctx where k='room'), 51.5, -0.1, 5);
reset role;
select set_config('request.jwt.claim.sub', :S1, false); set role authenticated;
select update_location((select v::uuid from t_ctx where k='room'), 51.50009, -0.1, 5);
reset role;
select set_config('request.jwt.claim.sub', :S2, false); set role authenticated;
select update_location((select v::uuid from t_ctx where k='room'), 51.5027, -0.1, 5);
-- shadow can see shadow teammate but not the hunter
do $$ begin assert (select count(*) from positions) = 2, 'shadow should see 2 shadow positions';
assert not exists (select 1 from positions where user_id = '11111111-1111-1111-1111-111111111111'); end $$;
reset role;
select set_config('request.jwt.claim.sub', :H, false); set role authenticated;
do $$ begin assert (select count(*) from positions) = 1, 'hunter must only see own exact position'; end $$;
-- tagging during head start fails
do $$ begin perform tag_player((select v::uuid from t_ctx where k='room'), '22222222-2222-2222-2222-222222222222'); raise exception 'should fail';
exception when others then assert sqlerrm like 'Tagging is only%', sqlerrm; end $$;
reset role;

-- fast-forward past head start
update rooms set headstart_ends_at = now() - interval '61 seconds', started_at = now() - interval '2 minutes',
  ends_at = now() + interval '9 minutes';
select set_config('request.jwt.claim.sub', :H, false); set role authenticated;
select tick((select v::uuid from t_ctx where k='room'));
do $$ begin assert (select status from rooms) = 'active', 'should be active';
assert (select count(*) from reveals) = 2, 'two shadows revealed';
end $$;
-- hunter sees blurred reveals; S1 reveal within blur radius of the truth
reset role;
do $$ declare rv record; begin
  for rv in select r.*, p.lat plat, p.lng plng from reveals r join positions p using (room_id, user_id) loop
    assert geo_dist(rv.lat, rv.lng, rv.plat, rv.plng) <= rv.radius_m + 0.5, 'reveal outside blur radius';
  end loop; end $$;
-- out of range tag
select set_config('request.jwt.claim.sub', :H, false); set role authenticated;
do $$ begin assert (select tag_player((select v::uuid from t_ctx where k='room'), '33333333-3333-3333-3333-333333333333')->>'ok') = 'false'; end $$;
-- in range tag -> pending
do $$ begin assert (select tag_player((select v::uuid from t_ctx where k='room'), '22222222-2222-2222-2222-222222222222')->>'ok') = 'true'; end $$;
reset role;
-- S1 disputes, host resolves accept
select set_config('request.jwt.claim.sub', :S1, false); set role authenticated;
select respond_capture((select id from captures limit 1), false);
reset role;
select set_config('request.jwt.claim.sub', :H, false); set role authenticated;
select resolve_capture((select id from captures limit 1), true);
do $$ begin assert (select status from players where user_id = '22222222-2222-2222-2222-222222222222') = 'captured'; end $$;
reset role;

-- anti-cheat: S2 teleports 5km in ~2s
update positions set updated_at = now() - interval '2 seconds' where user_id = :S2;
select set_config('request.jwt.claim.sub', :S2, false); set role authenticated;
select update_location((select v::uuid from t_ctx where k='room'), 51.545, -0.1, 5);
reset role;
do $$ begin assert (select count(*) from anomalies where kind='teleport') = 1, 'teleport not detected';
assert (select suspect from positions where user_id='33333333-3333-3333-3333-333333333333'); end $$;

-- emergency stop / resume shifts timers
select set_config('request.jwt.claim.sub', :S2, false); set role authenticated;
select emergency_stop((select v::uuid from t_ctx where k='room'), 'car');
reset role;
do $$ begin assert (select status from rooms) = 'paused'; end $$;
update rooms set paused_at = now() - interval '30 seconds';
select set_config('request.jwt.claim.sub', :H, false); set role authenticated;
select resume_match((select v::uuid from t_ctx where k='room'));
reset role;
do $$ begin assert (select status from rooms) = 'active';
assert (select ends_at from rooms) > now() + interval '9 minutes 20 seconds'; end $$;

-- zone elimination off by default in classic; time runs out -> shadows win
update rooms set ends_at = now() - interval '1 second';
select set_config('request.jwt.claim.sub', :H, false); set role authenticated;
select tick((select v::uuid from t_ctx where k='room'));
reset role;
do $$ begin
  assert (select status from rooms) = 'ended';
  assert (select winner from rooms) = 'shadow', 'shadows should win on time';
  assert (select count(*) from match_results) = 3;
  assert (select won from match_results where user_id='33333333-3333-3333-3333-333333333333');
  assert not (select won from match_results where user_id='11111111-1111-1111-1111-111111111111');
  assert (select count(*) from positions) = 0, 'live positions purged at end';
  assert (select xp from profiles where id='11111111-1111-1111-1111-111111111111') > 0;
  assert exists (select 1 from achievements where code='first_blood');
end $$;
-- replay history visible to members after end
select set_config('request.jwt.claim.sub', :H, false); set role authenticated;
do $$ begin assert (select count(*) from location_history) >= 3, 'history visible after end'; end $$;
reset role;

-- infection mode: capture converts shadow to hunter; last conversion ends match
select set_config('request.jwt.claim.sub', :H, false); set role authenticated;
update t_ctx set v = create_room('{"mode":"infection","head_start_s":0,"zone_lat":51.5,"zone_lng":-0.1,"rules":{"capture_confirm":false}}'::jsonb)::text where k = 'room';
update t_ctx set v = (select code from rooms where id = (select v::uuid from t_ctx where k='room')) where k = 'code';
reset role;
select set_config('request.jwt.claim.sub', :S1, false); set role authenticated;
select join_room((select v from t_ctx where k='code'));
reset role;
select set_config('request.jwt.claim.sub', :H, false); set role authenticated;
select start_match((select v::uuid from t_ctx where k='room'));
do $$ begin assert (select count(*) from players where room_id = (select v::uuid from t_ctx where k='room') and team='hunter') = 1; end $$;
reset role;
insert into positions (room_id, user_id, lat, lng, accuracy) values
  ((select v::uuid from t_ctx where k='room'), :H, 51.5, -0.1, 3),
  ((select v::uuid from t_ctx where k='room'), :S1, 51.50005, -0.1, 3);
-- make sure the hunter is the host-assigned hunter for the test
update players set team = case when user_id = :H then 'hunter' else 'shadow' end where room_id = (select v::uuid from t_ctx where k='room');
select set_config('request.jwt.claim.sub', :H, false); set role authenticated;
select tag_player((select v::uuid from t_ctx where k='room'), :S1);
reset role;
do $$ begin
  assert (select team from players where user_id='22222222-2222-2222-2222-222222222222' and room_id=(select v::uuid from t_ctx where k='room')) = 'hunter';
  assert (select winner from rooms where id=(select v::uuid from t_ctx where k='room')) = 'hunter';
end $$;
-- public matchmaking excludes this private/ended room
select set_config('request.jwt.claim.sub', :X, false); set role authenticated;
do $$ begin assert (select count(*) from list_public_rooms()) = 0; end $$;
reset role;
