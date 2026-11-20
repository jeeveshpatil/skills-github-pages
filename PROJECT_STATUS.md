# Project status

## Done
- Schema + RLS + realtime (`supabase/migrations/…01_schema.sql`); authoritative engine RPCs (`…02_game_engine.sql`)
- Client: auth (guest/magic link), home, matchmaking, create/settings, join, lobby, in-game HUD, results/replay, host dashboard, profile, leaderboard, tournaments, arena maps, consent gate, voice
- Tests: unit (vitest), DB engine (`supabase/tests`), multi-client E2E (`scripts/e2e.mjs`); UI flows verified in headless Chromium against local Supabase
- CI workflow (`app-ci.yml`), manual Pages deploy workflow
- Moving zone (`rules.zone_moves`, end centre picked server-side at start), polygon play-area boundary (rooms/maps `boundary`, `in_polygon`/`outside_area` in SQL, `inPolygon` in TS)
- Web Push: `push_subscriptions` + `events` trigger → pg_net → `supabase/functions/push` (verified locally end to end); PNG icons; TURN via `VITE_ICE_SERVERS_JSON`

- Native apps via Capacitor 8: background geolocation, native HTTP for location, haptics, keep-awake, local notifications, mock-location reporting (`report_mock_location`), auth deep link; CI builds Android APK (+ signed AAB with secrets) and compiles iOS for simulator

## Key decisions
- Reference site (shadowhunt.fun) was unreachable from the build sandbox; features derived from the brief and the genre. No code/assets copied.
- Game clock advances via idempotent `tick()` RPC called by clients (no cron/edge function needed); `for update skip locked` serialises it.
- Zone math is duplicated in SQL (`zone_radius`) and TS (`zoneRadiusAt`) — keep in sync (unit-tested).
- Opponent visibility only through blurred server reveals; proximity is a coarse band.
- MapLibre worker URL set explicitly (`GameMap.tsx`); map element positioned inline because maplibre CSS overrides Tailwind layers.

## Pending / ideas
- Native push (FCM/APNs) for the apps — currently local notifications only while the app runs in background
- Play Store / App Store listings (needs developer accounts)
- Self-hosted TURN deployment guide; short-lived TURN credentials minted server-side
- Notification preferences per event type
