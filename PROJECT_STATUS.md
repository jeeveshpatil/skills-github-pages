# Project status

## Done
- Schema + RLS + realtime (`supabase/migrations/…01_schema.sql`); authoritative engine RPCs (`…02_game_engine.sql`)
- Client: auth (guest/magic link), home, matchmaking, create/settings, join, lobby, in-game HUD, results/replay, host dashboard, profile, leaderboard, tournaments, arena maps, consent gate, voice
- Tests: unit (vitest), DB engine (`supabase/tests`), multi-client E2E (`scripts/e2e.mjs`); UI flows verified in headless Chromium against local Supabase
- CI workflow (`app-ci.yml`), manual Pages deploy workflow

## Key decisions
- Reference site (shadowhunt.fun) was unreachable from the build sandbox; features derived from the brief and the genre. No code/assets copied.
- Game clock advances via idempotent `tick()` RPC called by clients (no cron/edge function needed); `for update skip locked` serialises it.
- Zone math is duplicated in SQL (`zone_radius`) and TS (`zoneRadiusAt`) — keep in sync (unit-tested).
- Opponent visibility only through blurred server reveals; proximity is a coarse band.
- MapLibre worker URL set explicitly (`GameMap.tsx`); map element positioned inline because maplibre CSS overrides Tailwind layers.

## Pending / ideas
- Push notifications for reveals when app is backgrounded (browsers throttle background GPS; players should keep the app open)
- TURN server for voice behind strict NATs (`VITE_ICE_SERVERS`)
- Polygon (non-circular) boundaries; moving zone centre
- PNG icons for older iOS home-screen support
