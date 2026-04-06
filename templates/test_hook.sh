#!/usr/bin/env bash
set -euo pipefail
# TEMPLATE: hook_contract
# PLAN_REQ: <filled by generator — exact text from plan success criteria>
# SURFACE: hook_record

export AGENT_SDLC_DB="${AGENT_SDLC_DB:-/tmp/sdlc_test_$$.db}"
trap 'rm -f "$AGENT_SDLC_DB" "$AGENT_SDLC_DB-wal" "$AGENT_SDLC_DB-shm"' EXIT

# ══ SETUP ══
# <filled by generator — configure hook via settings_snapshot>
# ona --init-db
# sqlite3 "$AGENT_SDLC_DB" \
#   "INSERT OR REPLACE INTO settings_snapshot(scope, json, updated_at)
#    VALUES ('effective',
#    '{\"hooks\":[{\"hook_event_name\":\"<EVENT>\",\"matcher\":\"<MATCHER>\",\"command\":\"<COMMAND>\"}]}',
#    datetime('now'))"

# ══ EXERCISE ══
# <filled by generator — trigger the hook event via ona CLI>

# ══ ASSERT ══
# <filled by generator — verify hook_invocations row>
# ROW=$(sqlite3 "$AGENT_SDLC_DB" \
#   "SELECT exit_code FROM hook_invocations
#    WHERE hook_event='<EVENT>' ORDER BY id DESC LIMIT 1")
# test "$ROW" = "<EXPECTED_EXIT_CODE>" || { echo "FAIL: exit_code=$ROW, expected <EXPECTED>"; exit 1; }
