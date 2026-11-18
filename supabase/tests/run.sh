#!/usr/bin/env bash
# Spins up a throwaway Postgres 16, applies migrations, runs game_flow.sql. Requires postgres binaries.
set -euo pipefail
DIR="$(cd "$(dirname "$0")" && pwd)"; ROOT="$DIR/../.."
PGBIN="${PGBIN:-$(ls -d /usr/lib/postgresql/*/bin 2>/dev/null | tail -1)}"
TMP="$(mktemp -d)"; PORT="${PGPORT_TEST:-54329}"
trap '"$PGBIN/pg_ctl" -D "$TMP/data" stop -m fast >/dev/null 2>&1 || true; rm -rf "$TMP"' EXIT
if [ "$(id -u)" = "0" ]; then RUN="runuser -u postgres --"; chown postgres "$TMP"; else RUN=""; fi
$RUN "$PGBIN/initdb" -D "$TMP/data" -U postgres -A trust >/dev/null
$RUN "$PGBIN/pg_ctl" -D "$TMP/data" -o "-p $PORT -k $TMP -c listen_addresses=''" -l "$TMP/log" start >/dev/null
PSQL="psql -h $TMP -p $PORT -U postgres -v ON_ERROR_STOP=1 -q"
$PSQL -c "create database t" >/dev/null
$PSQL -d t -f "$DIR/stub_supabase.sql"
for f in "$ROOT"/supabase/migrations/*.sql; do $PSQL -d t -f "$f"; done
$PSQL -d t -o /dev/null -f "$DIR/game_flow.sql"
echo "DB TESTS PASSED"
