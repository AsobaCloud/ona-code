#!/usr/bin/env bash
set -euo pipefail
# TEMPLATE: phase_transition
# PLAN_REQ: <filled by generator — exact text from plan success criteria>
# SURFACE: db_state

export AGENT_SDLC_DB="${AGENT_SDLC_DB:-/tmp/sdlc_test_$$.db}"
trap 'rm -f "$AGENT_SDLC_DB" "$AGENT_SDLC_DB-wal" "$AGENT_SDLC_DB-shm"' EXIT

# ══ SETUP ══
# <filled by generator — initialize DB and seed conversation at starting phase>
# ona --init-db
# sqlite3 "$AGENT_SDLC_DB" \
#   "INSERT INTO conversations(id, project_dir, phase) VALUES ('<CONV_ID>', '/tmp', '<FROM_PHASE>')"

# ══ EXERCISE ══
# <filled by generator — attempt phase transition via CLI>
# ona --transition <TO_PHASE> --conversation <CONV_ID> 2>&1; TRANSITION_EXIT=$?

# ══ ASSERT ══
# <filled by generator — verify phase changed or was blocked>
# PHASE=$(sqlite3 "$AGENT_SDLC_DB" "SELECT phase FROM conversations WHERE id='<CONV_ID>'")
# test "$PHASE" = "<EXPECTED_PHASE>" || { echo "FAIL: expected <EXPECTED_PHASE>, got $PHASE"; exit 1; }
