// Multi-client end-to-end test against a running Supabase stack (default: `npx supabase start`).
// Usage: SUPABASE_URL=... SUPABASE_ANON_KEY=... DB_URL=... node scripts/e2e.mjs
// DB_URL (service connection) is only used to fast-forward timers instead of waiting minutes.
import { createClient } from '@supabase/supabase-js';
import { execFileSync } from 'node:child_process';
import assert from 'node:assert/strict';

const URL = process.env.SUPABASE_URL ?? 'http://127.0.0.1:54321';
const KEY = process.env.SUPABASE_ANON_KEY;
const DB = process.env.DB_URL ?? 'postgresql://postgres:postgres@127.0.0.1:54322/postgres';
if (!KEY) throw new Error('SUPABASE_ANON_KEY required');
const sql = (q) => execFileSync('psql', [DB, '-qtAc', q], { encoding: 'utf8' }).trim();
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const step = (m) => console.log(`✓ ${m}`);

async function agent(name) {
  const c = createClient(URL, KEY, { auth: { persistSession: false } });
  const { data, error } = await c.auth.signInAnonymously({ options: { data: { username: name } } });
  if (error) throw error;
  await c.from('profiles').update({ location_consent_at: new Date().toISOString() }).eq('id', data.user.id);
  const rpc = async (fn, args) => { const r = await c.rpc(fn, args); if (r.error) throw new Error(`${fn}: ${r.error.message}`); return r.data; };
  return { c, id: data.user.id, rpc, name };
}

const H = await agent('E2E-Hunter'), S1 = await agent('E2E-Shade'), S2 = await agent('E2E-Ghost');
step('3 anonymous agents signed in, profiles created by trigger');

const room = await H.rpc('create_room', { p_settings: { name: 'E2E Op', mode: 'classic', password: 'secret', head_start_s: 30, duration_s: 600, reveal_interval_s: 60, reveal_blur_m: 40, zone_lat: 51.5, zone_lng: -0.1, zone_start_m: 800, zone_end_m: 200 } });
const code = sql(`select code from rooms where id='${room}'`);
await assert.rejects(S1.rpc('join_room', { p_code: code, p_password: 'bad' }), /Wrong room password/);
await S1.rpc('join_room', { p_code: code, p_password: 'secret' });
await S2.rpc('join_room', { p_code: code, p_password: 'secret' });
step(`room ${code} created; password enforced; 2 players joined`);

// realtime: each client records the position rows it receives
const seen = { H: new Set(), S1: new Set() };
const statusSeen = [];
const subscribe = (a, key) => new Promise((res) => {
  a.c.channel(`t-${key}`)
    .on('postgres_changes', { event: '*', schema: 'public', table: 'positions', filter: `room_id=eq.${room}` }, (p) => seen[key].add(p.new.user_id))
    .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'rooms', filter: `id=eq.${room}` }, (p) => key === 'S1' && statusSeen.push(p.new.status))
    .subscribe((s) => s === 'SUBSCRIBED' && res());
});
await subscribe(H, 'H'); await subscribe(S1, 'S1');
await sleep(5000); // postgres_changes needs a moment after SUBSCRIBED on a cold stack

await H.rpc('set_team', { p_room: room, p_user: H.id, p_team: 'hunter' });
await H.rpc('set_team', { p_room: room, p_user: S1.id, p_team: 'shadow' });
await H.rpc('set_team', { p_room: room, p_user: S2.id, p_team: 'shadow' });
await assert.rejects(S1.rpc('start_match', { p_room: room }), /Only the host/);
await H.rpc('start_match', { p_room: room });
step('host assigned teams and started; non-host start rejected');

await H.rpc('update_location', { p_room: room, p_lat: 51.5, p_lng: -0.1, p_accuracy: 5 });
await S1.rpc('update_location', { p_room: room, p_lat: 51.50008, p_lng: -0.1, p_accuracy: 5 });
await S2.rpc('update_location', { p_room: room, p_lat: 51.503, p_lng: -0.1, p_accuracy: 5 });
await sleep(2500);
assert.ok(!seen.H.has(S1.id) && !seen.H.has(S2.id), 'hunter must NOT receive shadow positions over realtime');
assert.ok(seen.S1.has(S2.id), 'shadow should receive teammate position');
assert.ok(!seen.S1.has(H.id), 'shadow must NOT receive hunter position');
const { data: hpos } = await H.c.from('positions').select('user_id').eq('room_id', room);
assert.deepEqual(hpos.map((p) => p.user_id), [H.id]);
step('RLS: exact positions only reach teammates (REST + Realtime)');

await assert.rejects(H.rpc('tag_player', { p_room: room, p_target: S1.id }), /only possible during the hunt/);
sql(`update rooms set headstart_ends_at = now() - interval '61 seconds', started_at = now() - interval '2 minutes' where id='${room}'`);
await H.rpc('tick', { p_room: room });
await sleep(5000); // postgres_changes needs a moment after SUBSCRIBED on a cold stack
assert.ok(statusSeen.includes('active'), 'status change should arrive over realtime');
const { data: rv } = await H.c.from('reveals').select('*').eq('room_id', room);
assert.equal(rv.length, 2);
step('head start → hunt via server tick; 2 blurred reveals visible to hunter');

const miss = await H.rpc('tag_player', { p_room: room, p_target: S2.id });
assert.equal(miss.ok, false);
await sleep(1100);
const hit = await H.rpc('tag_player', { p_room: room, p_target: S1.id });
assert.equal(hit.ok, true);
await assert.rejects(S2.rpc('respond_capture', { p_capture: hit.capture_id, p_accept: true }), /Not your capture/);
await S1.rpc('respond_capture', { p_capture: hit.capture_id, p_accept: true });
step('out-of-range tag refused; in-range tag confirmed by target');

const { error: hack } = await S2.c.from('players').update({ status: 'alive', team: 'hunter' }).eq('room_id', room).eq('user_id', S2.id);
const stillShadow = sql(`select team from players where room_id='${room}' and user_id='${S2.id}'`);
assert.equal(stillShadow, 'shadow', `direct table write must be blocked (${hack?.message ?? 'silently filtered'})`);
step('direct table writes blocked');

// S2 moves 30m then is caught -> hunters win
sql(`update positions set lat = 51.50012, updated_at = now() - interval '3 seconds' where room_id='${room}' and user_id='${S2.id}'`);
await sleep(1100);
const hit2 = await H.rpc('tag_player', { p_room: room, p_target: S2.id });
assert.equal(hit2.ok, true);
await S2.rpc('respond_capture', { p_capture: hit2.capture_id, p_accept: false });
await H.rpc('resolve_capture', { p_capture: hit2.capture_id, p_accept: true });
const [status, winner] = sql(`select status || '|' || winner from rooms where id='${room}'`).split('|');
assert.equal(status, 'ended'); assert.equal(winner, 'hunter');
const xp = Number(sql(`select xp from profiles where id='${H.id}'`));
assert.ok(xp > 200, 'winner XP awarded');
const { data: hist } = await S1.c.from('location_history').select('id').eq('room_id', room);
assert.ok(hist.length >= 2, 'replay tracks readable after match');
step(`dispute → host ruling → hunters win; winner XP ${xp}; replay data available`);

const re = await H.rpc('rematch', { p_room: room });
await sleep(800);
const re2 = await S1.rpc('join_rematch', { p_old_room: room, p_code: sql(`select code from rooms where id='${re}'`) });
assert.equal(re, re2);
step('rematch lobby created and joined without re-entering password');

for (const a of [H, S1, S2]) await a.c.removeAllChannels();
console.log('\nE2E PASSED');
process.exit(0);
