#!/usr/bin/env bash
set -euo pipefail
# TEMPLATE: tool_contract
# PLAN_REQ: <filled by generator — exact text from plan success criteria>
# SURFACE: tool_result

export AGENT_SDLC_DB="${AGENT_SDLC_DB:-/tmp/sdlc_test_$$.db}"
trap 'rm -f "$AGENT_SDLC_DB" "$AGENT_SDLC_DB-wal" "$AGENT_SDLC_DB-shm"' EXIT

# ══ SETUP ══
# <filled by generator — create input fixtures: files, directories, env vars>
# Example: echo -e "line1\nline2" > /tmp/sdlc_test_input.txt

# ══ EXERCISE ══
# <filled by generator — invoke tool through ona CLI>
# ona --eval '{"tool": "<TOOL_NAME>", "input": {<TOOL_INPUT_JSON>}}'

# ══ ASSERT ══
# <filled by generator — check tool_result in transcript_entries>
# RESULT=$(sqlite3 "$AGENT_SDLC_DB" \
#   "SELECT payload_json FROM transcript_entries
#    WHERE entry_type='tool_result' ORDER BY sequence DESC LIMIT 1")
# echo "$RESULT" | grep '"is_error":false' || { echo "FAIL: unexpected is_error"; exit 1; }
# echo "$RESULT" | grep '<EXPECTED_PATTERN>' || { echo "FAIL: content mismatch"; exit 1; }
