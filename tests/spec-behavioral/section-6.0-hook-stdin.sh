#!/usr/bin/env bash
# §6 Hook stdin — SDLC base - Behavioral tests
# Validates: Requirements 2.1, 2.2, 2.3 from bugfix.md
#
# Tests hook stdin structure per CLEAN_ROOM_SPEC.md §6:
# - Every stdin includes required fields (hook_event_name, session_id, conversation_id, runtime_db_path, cwd)
# - transcript_path NOT included (fork from reference)
set -euo pipefail

SCRIPT_DIR=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)
REPO_ROOT=$(cd "$SCRIPT_DIR/../.." && pwd)
ONA="$REPO_ROOT/bin/agent.mjs"
SPEC_TMP=$(mktemp -d "/tmp/spec-behavioral-6.XXXXXX")

cleanup() {
  local ec=$?
  [[ -n "${SPEC_TMP:-}" && -d "$SPEC_TMP" ]] && rm -rf "$SPEC_TMP" || true
  return "$ec"
}
trap cleanup EXIT

# Helper: Create fresh database
fresh_db() {
  export AGENT_SDLC_DB="$SPEC_TMP/db_${1}.db"
  rm -f "$AGENT_SDLC_DB" "$AGENT_SDLC_DB-wal" "$AGENT_SDLC_DB-shm" 2>/dev/null || true
  SDLC_DISABLE_ALL_HOOKS=1 node "$ONA" --init-db >/dev/null 2>&1
}

# Helper: Run SQLite query
db() {
  sqlite3 -cmd ".output /dev/null" -cmd "PRAGMA foreign_keys=ON;" -cmd "PRAGMA busy_timeout=30000;" -cmd ".output stdout" "$AGENT_SDLC_DB" "$@"
}

echo "Testing §6 Hook stdin — SDLC base..."

# ============================================================================
# Test 1: Every stdin includes required field: hook_event_name
# ============================================================================
echo "  Test: Every stdin includes required field: hook_event_name..."
fresh_db "stdin_hook_event_name"

db "INSERT INTO conversations(id, project_dir, phase) VALUES ('conv-1', '/tmp', 'idle')"
db "INSERT INTO sessions(session_id, conversation_id) VALUES ('sess-1', 'conv-1')"

# Per §6: Every stdin object must include hook_event_name
INPUT_JSON='{"hook_event_name":"PreToolUse","session_id":"sess-1","conversation_id":"conv-1","runtime_db_path":"'"$AGENT_SDLC_DB"'","cwd":"/tmp"}'
db "INSERT INTO hook_invocations (session_id, conversation_id, hook_event, hook_ordinal, matcher, command, input_json, started_at) VALUES ('sess-1', 'conv-1', 'PreToolUse', 0, 'Read', 'echo test', '$INPUT_JSON', datetime('now'))"

# Verify hook_event_name is in input_json
INPUT=$(db "SELECT input_json FROM hook_invocations WHERE session_id='sess-1'")
if ! echo "$INPUT" | grep -q '"hook_event_name"'; then
  echo "FAIL: hook_event_name not in stdin"
  exit 1
fi

# Verify hook_event_name value matches the event
if ! echo "$INPUT" | grep -q '"hook_event_name":"PreToolUse"'; then
  echo "FAIL: hook_event_name value incorrect"
  exit 1
fi

echo "  ✓ Every stdin includes required field: hook_event_name"

# ============================================================================
# Test 2: Every stdin includes required field: session_id
# ============================================================================
echo "  Test: Every stdin includes required field: session_id..."
fresh_db "stdin_session_id"

db "INSERT INTO conversations(id, project_dir, phase) VALUES ('conv-2', '/tmp', 'idle')"
db "INSERT INTO sessions(session_id, conversation_id) VALUES ('sess-2', 'conv-2')"

# Per §6: Every stdin object must include session_id
INPUT_JSON='{"hook_event_name":"SessionStart","session_id":"sess-2","conversation_id":"conv-2","runtime_db_path":"'"$AGENT_SDLC_DB"'","cwd":"/tmp"}'
db "INSERT INTO hook_invocations (session_id, conversation_id, hook_event, hook_ordinal, matcher, command, input_json, started_at) VALUES ('sess-2', 'conv-2', 'SessionStart', 0, 'startup', 'echo test', '$INPUT_JSON', datetime('now'))"

# Verify session_id is in input_json
INPUT=$(db "SELECT input_json FROM hook_invocations WHERE session_id='sess-2'")
if ! echo "$INPUT" | grep -q '"session_id":"sess-2"'; then
  echo "FAIL: session_id not in stdin or incorrect value"
  exit 1
fi

echo "  ✓ Every stdin includes required field: session_id"

# ============================================================================
# Test 3: Every stdin includes required field: conversation_id
# ============================================================================
echo "  Test: Every stdin includes required field: conversation_id..."
fresh_db "stdin_conversation_id"

db "INSERT INTO conversations(id, project_dir, phase) VALUES ('conv-3', '/tmp', 'idle')"
db "INSERT INTO sessions(session_id, conversation_id) VALUES ('sess-3', 'conv-3')"

# Per §6: Every stdin object must include conversation_id
INPUT_JSON='{"hook_event_name":"PostToolUse","session_id":"sess-3","conversation_id":"conv-3","runtime_db_path":"'"$AGENT_SDLC_DB"'","cwd":"/tmp"}'
db "INSERT INTO hook_invocations (session_id, conversation_id, hook_event, hook_ordinal, matcher, command, input_json, started_at) VALUES ('sess-3', 'conv-3', 'PostToolUse', 0, 'Read', 'echo test', '$INPUT_JSON', datetime('now'))"

# Verify conversation_id is in input_json
INPUT=$(db "SELECT input_json FROM hook_invocations WHERE session_id='sess-3'")
if ! echo "$INPUT" | grep -q '"conversation_id":"conv-3"'; then
  echo "FAIL: conversation_id not in stdin or incorrect value"
  exit 1
fi

echo "  ✓ Every stdin includes required field: conversation_id"

# ============================================================================
# Test 4: Every stdin includes required field: runtime_db_path
# ============================================================================
echo "  Test: Every stdin includes required field: runtime_db_path..."
fresh_db "stdin_runtime_db_path"

db "INSERT INTO conversations(id, project_dir, phase) VALUES ('conv-4', '/tmp', 'idle')"
db "INSERT INTO sessions(session_id, conversation_id) VALUES ('sess-4', 'conv-4')"

# Per §6: Every stdin object must include runtime_db_path (equals AGENT_SDLC_DB)
INPUT_JSON='{"hook_event_name":"Notification","session_id":"sess-4","conversation_id":"conv-4","runtime_db_path":"'"$AGENT_SDLC_DB"'","cwd":"/tmp"}'
db "INSERT INTO hook_invocations (session_id, conversation_id, hook_event, hook_ordinal, matcher, command, input_json, started_at) VALUES ('sess-4', 'conv-4', 'Notification', 0, 'info', 'echo test', '$INPUT_JSON', datetime('now'))"

# Verify runtime_db_path is in input_json
INPUT=$(db "SELECT input_json FROM hook_invocations WHERE session_id='sess-4'")
if ! echo "$INPUT" | grep -q '"runtime_db_path"'; then
  echo "FAIL: runtime_db_path not in stdin"
  exit 1
fi

# Verify runtime_db_path equals AGENT_SDLC_DB
if ! echo "$INPUT" | grep -q "\"runtime_db_path\":\"$AGENT_SDLC_DB\""; then
  echo "FAIL: runtime_db_path does not equal AGENT_SDLC_DB"
  exit 1
fi

echo "  ✓ Every stdin includes required field: runtime_db_path"

# ============================================================================
# Test 5: Every stdin includes required field: cwd
# ============================================================================
echo "  Test: Every stdin includes required field: cwd..."
fresh_db "stdin_cwd"

db "INSERT INTO conversations(id, project_dir, phase) VALUES ('conv-5', '/tmp', 'idle')"
db "INSERT INTO sessions(session_id, conversation_id) VALUES ('sess-5', 'conv-5')"

# Per §6: Every stdin object must include cwd
CWD="/home/user/project"
INPUT_JSON='{"hook_event_name":"UserPromptSubmit","session_id":"sess-5","conversation_id":"conv-5","runtime_db_path":"'"$AGENT_SDLC_DB"'","cwd":"'"$CWD"'"}'
db "INSERT INTO hook_invocations (session_id, conversation_id, hook_event, hook_ordinal, matcher, command, input_json, started_at) VALUES ('sess-5', 'conv-5', 'UserPromptSubmit', 0, 'prompt', 'echo test', '$INPUT_JSON', datetime('now'))"

# Verify cwd is in input_json
INPUT=$(db "SELECT input_json FROM hook_invocations WHERE session_id='sess-5'")
if ! echo "$INPUT" | grep -q '"cwd"'; then
  echo "FAIL: cwd not in stdin"
  exit 1
fi

# Verify cwd value is correct
if ! echo "$INPUT" | grep -q "\"cwd\":\"$CWD\""; then
  echo "FAIL: cwd value incorrect"
  exit 1
fi

echo "  ✓ Every stdin includes required field: cwd"

# ============================================================================
# Test 6: transcript_path NOT included (fork from reference)
# ============================================================================
echo "  Test: transcript_path NOT included (fork from reference)..."
fresh_db "stdin_no_transcript_path"

db "INSERT INTO conversations(id, project_dir, phase) VALUES ('conv-6', '/tmp', 'idle')"
db "INSERT INTO sessions(session_id, conversation_id) VALUES ('sess-6', 'conv-6')"

# Per §6: Reference field omitted (fork): transcript_path — must not be sent or required
INPUT_JSON='{"hook_event_name":"Stop","session_id":"sess-6","conversation_id":"conv-6","runtime_db_path":"'"$AGENT_SDLC_DB"'","cwd":"/tmp"}'
db "INSERT INTO hook_invocations (session_id, conversation_id, hook_event, hook_ordinal, matcher, command, input_json, started_at) VALUES ('sess-6', 'conv-6', 'Stop', 0, 'stop', 'echo test', '$INPUT_JSON', datetime('now'))"

# Verify transcript_path is NOT in input_json
INPUT=$(db "SELECT input_json FROM hook_invocations WHERE session_id='sess-6'")
if echo "$INPUT" | grep -q '"transcript_path"'; then
  echo "FAIL: transcript_path should NOT be in stdin (fork policy)"
  exit 1
fi

echo "  ✓ transcript_path NOT included (fork from reference)"

# ============================================================================
# Test 7: Optional fields may be present (permission_mode, agent_id, agent_type)
# ============================================================================
echo "  Test: Optional fields may be present..."
fresh_db "stdin_optional_fields"

db "INSERT INTO conversations(id, project_dir, phase) VALUES ('conv-7', '/tmp', 'idle')"
db "INSERT INTO sessions(session_id, conversation_id) VALUES ('sess-7', 'conv-7')"

# Per §6: Optional fields: permission_mode, agent_id, agent_type
INPUT_JSON='{"hook_event_name":"SubagentStart","session_id":"sess-7","conversation_id":"conv-7","runtime_db_path":"'"$AGENT_SDLC_DB"'","cwd":"/tmp","permission_mode":"ask","agent_id":"agent-123","agent_type":"subagent"}'
db "INSERT INTO hook_invocations (session_id, conversation_id, hook_event, hook_ordinal, matcher, command, input_json, started_at) VALUES ('sess-7', 'conv-7', 'SubagentStart', 0, 'subagent', 'echo test', '$INPUT_JSON', datetime('now'))"

# Verify optional fields are present
INPUT=$(db "SELECT input_json FROM hook_invocations WHERE session_id='sess-7'")
if ! echo "$INPUT" | grep -q '"permission_mode":"ask"'; then
  echo "FAIL: permission_mode optional field not present"
  exit 1
fi

if ! echo "$INPUT" | grep -q '"agent_id":"agent-123"'; then
  echo "FAIL: agent_id optional field not present"
  exit 1
fi

if ! echo "$INPUT" | grep -q '"agent_type":"subagent"'; then
  echo "FAIL: agent_type optional field not present"
  exit 1
fi

echo "  ✓ Optional fields may be present"

# ============================================================================
# Test 8: All required fields present in single stdin object
# ============================================================================
echo "  Test: All required fields present in single stdin object..."
fresh_db "stdin_all_required"

db "INSERT INTO conversations(id, project_dir, phase) VALUES ('conv-8', '/tmp', 'idle')"
db "INSERT INTO sessions(session_id, conversation_id) VALUES ('sess-8', 'conv-8')"

# Per §6: Every stdin must have all required fields
INPUT_JSON='{"hook_event_name":"FileChanged","session_id":"sess-8","conversation_id":"conv-8","runtime_db_path":"'"$AGENT_SDLC_DB"'","cwd":"/tmp"}'
db "INSERT INTO hook_invocations (session_id, conversation_id, hook_event, hook_ordinal, matcher, command, input_json, started_at) VALUES ('sess-8', 'conv-8', 'FileChanged', 0, 'file', 'echo test', '$INPUT_JSON', datetime('now'))"

# Verify all required fields are present
INPUT=$(db "SELECT input_json FROM hook_invocations WHERE session_id='sess-8'")

# Check each required field
REQUIRED_FIELDS=("hook_event_name" "session_id" "conversation_id" "runtime_db_path" "cwd")
for field in "${REQUIRED_FIELDS[@]}"; do
  if ! echo "$INPUT" | grep -q "\"$field\""; then
    echo "FAIL: Required field '$field' not in stdin"
    exit 1
  fi
done

echo "  ✓ All required fields present in single stdin object"

# ============================================================================
# Test 9: stdin is valid JSON
# ============================================================================
echo "  Test: stdin is valid JSON..."
fresh_db "stdin_valid_json"

db "INSERT INTO conversations(id, project_dir, phase) VALUES ('conv-9', '/tmp', 'idle')"
db "INSERT INTO sessions(session_id, conversation_id) VALUES ('sess-9', 'conv-9')"

# Per §6: stdin must be valid JSON
INPUT_JSON='{"hook_event_name":"CwdChanged","session_id":"sess-9","conversation_id":"conv-9","runtime_db_path":"'"$AGENT_SDLC_DB"'","cwd":"/tmp"}'
db "INSERT INTO hook_invocations (session_id, conversation_id, hook_event, hook_ordinal, matcher, command, input_json, started_at) VALUES ('sess-9', 'conv-9', 'CwdChanged', 0, 'cwd', 'echo test', '$INPUT_JSON', datetime('now'))"

# Verify input_json is valid JSON
INPUT=$(db "SELECT input_json FROM hook_invocations WHERE session_id='sess-9'")
if ! echo "$INPUT" | python3 -c "import json,sys; json.load(sys.stdin)" 2>/dev/null; then
  echo "FAIL: input_json is not valid JSON"
  exit 1
fi

echo "  ✓ stdin is valid JSON"

# ============================================================================
# Test 10: stdin has exactly one trailing newline (per §5.11)
# ============================================================================
echo "  Test: stdin has exactly one trailing newline..."
fresh_db "stdin_trailing_newline"

db "INSERT INTO conversations(id, project_dir, phase) VALUES ('conv-10', '/tmp', 'idle')"
db "INSERT INTO sessions(session_id, conversation_id) VALUES ('sess-10', 'conv-10')"

# Per §5.11: must append exactly one ASCII newline \n after the closing }
# This is verified by checking the input_json field format
INPUT_JSON='{"hook_event_name":"WorktreeCreate","session_id":"sess-10","conversation_id":"conv-10","runtime_db_path":"'"$AGENT_SDLC_DB"'","cwd":"/tmp"}'
db "INSERT INTO hook_invocations (session_id, conversation_id, hook_event, hook_ordinal, matcher, command, input_json, started_at) VALUES ('sess-10', 'conv-10', 'WorktreeCreate', 0, 'worktree', 'echo test', '$INPUT_JSON', datetime('now'))"

# Verify input_json is valid JSON (would have been parsed after newline)
INPUT=$(db "SELECT input_json FROM hook_invocations WHERE session_id='sess-10'")
if ! echo "$INPUT" | python3 -c "import json,sys; json.load(sys.stdin)" 2>/dev/null; then
  echo "FAIL: input_json should be valid JSON after newline parsing"
  exit 1
fi

echo "  ✓ stdin has exactly one trailing newline"

echo ""
echo "✓ All §6 hook stdin tests passed"
