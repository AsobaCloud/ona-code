#!/usr/bin/env bash
set -euo pipefail
# TEMPLATE: e2e_workflow
# PLAN_REQ: <filled by generator — exact text from plan success criteria>
# SURFACE: db_state

export AGENT_SDLC_DB="${AGENT_SDLC_DB:-/tmp/sdlc_test_$$.db}"
trap 'rm -f "$AGENT_SDLC_DB" "$AGENT_SDLC_DB-wal" "$AGENT_SDLC_DB-shm"' EXIT

# ══ SETUP ══
# <filled by generator — initialize clean DB>
# ona --init-db

# ══ EXERCISE ══
# <filled by generator — step through workflow phases via CLI>
# ona --enter-plan --conversation <CONV_ID>
# ona --approve-plan --conversation <CONV_ID>
# ona --transition implement --conversation <CONV_ID>
# ona --transition test --conversation <CONV_ID>
# ona --transition verify --conversation <CONV_ID>
# ona --transition done --conversation <CONV_ID>

# ══ ASSERT ══
# <filled by generator — verify final and intermediate phases>
# PHASE=$(sqlite3 "$AGENT_SDLC_DB" \
#   "SELECT phase FROM conversations ORDER BY created_at DESC LIMIT 1")
# test "$PHASE" = "<EXPECTED_FINAL_PHASE>" || { echo "FAIL: expected <EXPECTED>, got $PHASE"; exit 1; }
#
# PHASES=$(sqlite3 "$AGENT_SDLC_DB" \
#   "SELECT detail FROM events WHERE event_type='phase' ORDER BY id")
# echo "$PHASES" | grep 'planning' || { echo "FAIL: missing planning phase"; exit 1; }
# echo "$PHASES" | grep 'implement' || { echo "FAIL: missing implement phase"; exit 1; }
