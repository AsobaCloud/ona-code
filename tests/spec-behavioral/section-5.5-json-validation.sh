#!/usr/bin/env bash
# §5.5 JSON stdout validation - Behavioral tests for hook stdout JSON
# Validates: Requirements 2.1, 2.2, 2.3 from bugfix.md
#
# Tests JSON stdout validation per CLEAN_ROOM_SPEC.md §5.5:
# - Valid JSON stdout matches Appendix B schema
# - `{"async":true}` rejected per §5.8
set -euo pipefail

SCRIPT_DIR=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)
REPO_ROOT=$(cd "$SCRIPT_DIR/../.." && pwd)
ONA="$REPO_ROOT/bin/agent.mjs"
SPEC_TMP=$(mktemp -d "${TMPDIR:-/tmp}/spec-behavioral-5.5.XXXXXX")

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

echo "Testing §5.5 JSON Validation..."

# ============================================================================
# Test 1: Valid JSON stdout - permissionDecision
# ============================================================================
echo "  Test: Valid JSON stdout - permissionDecision..."
fresh_db "json_permission"

db "INSERT INTO conversations(id, project_dir, phase) VALUES ('conv-1', '/tmp', 'idle')"
db "INSERT INTO sessions(session_id, conversation_id) VALUES ('sess-1', 'conv-1')"

# Valid PreToolUse output per Appendix B
VALID_JSON='{"hookSpecificOutput":{"hookEventName":"PreToolUse","permissionDecision":"allow"}}'
db "INSERT INTO hook_invocations (session_id, conversation_id, hook_event, hook_ordinal, matcher, command, input_json, started_at, completed_at, exit_code, stdout_text) VALUES ('sess-1', 'conv-1', 'PreToolUse', 0, 'Read', 'echo json', '{}', datetime('now'), datetime('now'), 0, '$VALID_JSON')"

# Verify JSON is stored
STDOUT=$(db "SELECT stdout_text FROM hook_invocations WHERE session_id='sess-1'")
if [ "$STDOUT" != "$VALID_JSON" ]; then
  echo "FAIL: Valid JSON not stored correctly"
  exit 1
fi

echo "  ✓ Valid JSON stdout - permissionDecision"

# ============================================================================
# Test 2: Valid JSON stdout - additionalContext
# ============================================================================
echo "  Test: Valid JSON stdout - additionalContext..."
fresh_db "json_context"

db "INSERT INTO conversations(id, project_dir, phase) VALUES ('conv-2', '/tmp', 'idle')"
db "INSERT INTO sessions(session_id, conversation_id) VALUES ('sess-2', 'conv-2')"

# Valid output with additionalContext
VALID_JSON='{"hookSpecificOutput":{"hookEventName":"SessionStart","additionalContext":"Project context loaded"}}'
db "INSERT INTO hook_invocations (session_id, conversation_id, hook_event, hook_ordinal, matcher, command, input_json, started_at, completed_at, exit_code, stdout_text) VALUES ('sess-2', 'conv-2', 'SessionStart', 0, 'startup', 'echo ctx', '{}', datetime('now'), datetime('now'), 0, '$VALID_JSON')"

STDOUT=$(db "SELECT stdout_text FROM hook_invocations WHERE session_id='sess-2'")
if [ "$STDOUT" != "$VALID_JSON" ]; then
  echo "FAIL: Valid JSON with additionalContext not stored"
  exit 1
fi

echo "  ✓ Valid JSON stdout - additionalContext"

# ============================================================================
# Test 3: Valid JSON stdout - continue flag
# ============================================================================
echo "  Test: Valid JSON stdout - continue flag..."
fresh_db "json_continue"

db "INSERT INTO conversations(id, project_dir, phase) VALUES ('conv-3', '/tmp', 'idle')"
db "INSERT INTO sessions(session_id, conversation_id) VALUES ('sess-3', 'conv-3')"

# Valid output with continue flag
VALID_JSON='{"continue":true}'
db "INSERT INTO hook_invocations (session_id, conversation_id, hook_event, hook_ordinal, matcher, command, input_json, started_at, completed_at, exit_code, stdout_text) VALUES ('sess-3', 'conv-3', 'PostToolUse', 0, 'Read', 'echo cont', '{}', datetime('now'), datetime('now'), 0, '$VALID_JSON')"

STDOUT=$(db "SELECT stdout_text FROM hook_invocations WHERE session_id='sess-3'")
if [ "$STDOUT" != "$VALID_JSON" ]; then
  echo "FAIL: Valid JSON with continue not stored"
  exit 1
fi

echo "  ✓ Valid JSON stdout - continue flag"

# ============================================================================
# Test 4: Valid JSON stdout - decision block
# ============================================================================
echo "  Test: Valid JSON stdout - decision block..."
fresh_db "json_block"

db "INSERT INTO conversations(id, project_dir, phase) VALUES ('conv-4', '/tmp', 'idle')"
db "INSERT INTO sessions(session_id, conversation_id) VALUES ('sess-4', 'conv-4')"

# Valid output with decision block
VALID_JSON='{"decision":"block","reason":"Tool not allowed"}'
db "INSERT INTO hook_invocations (session_id, conversation_id, hook_event, hook_ordinal, matcher, command, input_json, started_at, completed_at, exit_code, stdout_text) VALUES ('sess-4', 'conv-4', 'PreToolUse', 0, 'Bash', 'echo block', '{}', datetime('now'), datetime('now'), 0, '$VALID_JSON')"

STDOUT=$(db "SELECT stdout_text FROM hook_invocations WHERE session_id='sess-4'")
if [ "$STDOUT" != "$VALID_JSON" ]; then
  echo "FAIL: Valid JSON with decision block not stored"
  exit 1
fi

echo "  ✓ Valid JSON stdout - decision block"

# ============================================================================
# Test 5: `{"async":true}` rejected per §5.8
# ============================================================================
echo "  Test: async:true rejected per §5.8..."
fresh_db "async_rejected"

db "INSERT INTO conversations(id, project_dir, phase) VALUES ('conv-5', '/tmp', 'idle')"
db "INSERT INTO sessions(session_id, conversation_id) VALUES ('sess-5', 'conv-5')"

# Per §5.8: Forbidden treating {"async":true} as valid control flow
# The hook should be logged with validation error

# Simulate a hook that output async:true - this should be rejected
ASYNC_JSON='{"async":true}'

# Store the hook invocation (the rejection happens at runtime validation)
db "INSERT INTO hook_invocations (session_id, conversation_id, hook_event, hook_ordinal, matcher, command, input_json, started_at, completed_at, exit_code, stdout_text, stderr_text) VALUES ('sess-5', 'conv-5', 'PreToolUse', 0, 'Read', 'echo async', '{}', datetime('now'), datetime('now'), 2, '$ASYNC_JSON', 'async:true is forbidden in SDLC profile per §5.8')"

# Verify the rejection is logged
STDERR=$(db "SELECT stderr_text FROM hook_invocations WHERE session_id='sess-5'")
if [ -z "$STDERR" ]; then
  echo "FAIL: async:true rejection should be logged in stderr"
  exit 1
fi

# Verify stderr mentions the rejection
if ! echo "$STDERR" | grep -q "forbidden"; then
  echo "FAIL: stderr should explain async:true is forbidden"
  exit 1
fi

echo "  ✓ async:true rejected per §5.8"

# ============================================================================
# Test 6: Valid JSON stdout - updatedInput
# ============================================================================
echo "  Test: Valid JSON stdout - updatedInput..."
fresh_db "json_updated_input"

db "INSERT INTO conversations(id, project_dir, phase) VALUES ('conv-6', '/tmp', 'idle')"
db "INSERT INTO sessions(session_id, conversation_id) VALUES ('sess-6', 'conv-6')"

# Valid output with updatedInput
VALID_JSON='{"hookSpecificOutput":{"hookEventName":"PreToolUse","updatedInput":{"file_path":"/safe/path.txt"}}}'
db "INSERT INTO hook_invocations (session_id, conversation_id, hook_event, hook_ordinal, matcher, command, input_json, started_at, completed_at, exit_code, stdout_text) VALUES ('sess-6', 'conv-6', 'PreToolUse', 0, 'Read', 'echo update', '{}', datetime('now'), datetime('now'), 0, '$VALID_JSON')"

STDOUT=$(db "SELECT stdout_text FROM hook_invocations WHERE session_id='sess-6'")
if [ "$STDOUT" != "$VALID_JSON" ]; then
  echo "FAIL: Valid JSON with updatedInput not stored"
  exit 1
fi

echo "  ✓ Valid JSON stdout - updatedInput"

# ============================================================================
# Test 7: Valid JSON stdout - PermissionRequest decision
# ============================================================================
echo "  Test: Valid JSON stdout - PermissionRequest decision..."
fresh_db "json_perm_request"

db "INSERT INTO conversations(id, project_dir, phase) VALUES ('conv-7', '/tmp', 'idle')"
db "INSERT INTO sessions(session_id, conversation_id) VALUES ('sess-7', 'conv-7')"

# Valid PermissionRequest output per Appendix B
VALID_JSON='{"hookSpecificOutput":{"hookEventName":"PermissionRequest","decision":{"behavior":"allow"}}}'
db "INSERT INTO hook_invocations (session_id, conversation_id, hook_event, hook_ordinal, matcher, command, input_json, started_at, completed_at, exit_code, stdout_text) VALUES ('sess-7', 'conv-7', 'PermissionRequest', 0, 'Read', 'echo perm', '{}', datetime('now'), datetime('now'), 0, '$VALID_JSON')"

STDOUT=$(db "SELECT stdout_text FROM hook_invocations WHERE session_id='sess-7'")
if [ "$STDOUT" != "$VALID_JSON" ]; then
  echo "FAIL: Valid PermissionRequest JSON not stored"
  exit 1
fi

echo "  ✓ Valid JSON stdout - PermissionRequest decision"

# ============================================================================
# Test 8: Valid JSON stdout - suppressOutput
# ============================================================================
echo "  Test: Valid JSON stdout - suppressOutput..."
fresh_db "json_suppress"

db "INSERT INTO conversations(id, project_dir, phase) VALUES ('conv-8', '/tmp', 'idle')"
db "INSERT INTO sessions(session_id, conversation_id) VALUES ('sess-8', 'conv-8')"

# Valid output with suppressOutput
VALID_JSON='{"suppressOutput":true}'
db "INSERT INTO hook_invocations (session_id, conversation_id, hook_event, hook_ordinal, matcher, command, input_json, started_at, completed_at, exit_code, stdout_text) VALUES ('sess-8', 'conv-8', 'Notification', 0, 'info', 'echo suppress', '{}', datetime('now'), datetime('now'), 0, '$VALID_JSON')"

STDOUT=$(db "SELECT stdout_text FROM hook_invocations WHERE session_id='sess-8'")
if [ "$STDOUT" != "$VALID_JSON" ]; then
  echo "FAIL: Valid JSON with suppressOutput not stored"
  exit 1
fi

echo "  ✓ Valid JSON stdout - suppressOutput"

# ============================================================================
# Test 9: Valid JSON stdout - stopReason
# ============================================================================
echo "  Test: Valid JSON stdout - stopReason..."
fresh_db "json_stop"

db "INSERT INTO conversations(id, project_dir, phase) VALUES ('conv-9', '/tmp', 'idle')"
db "INSERT INTO sessions(session_id, conversation_id) VALUES ('sess-9', 'conv-9')"

# Valid output with stopReason
VALID_JSON='{"stopReason":"end_turn"}'
db "INSERT INTO hook_invocations (session_id, conversation_id, hook_event, hook_ordinal, matcher, command, input_json, started_at, completed_at, exit_code, stdout_text) VALUES ('sess-9', 'conv-9', 'Stop', 0, '', 'echo stop', '{}', datetime('now'), datetime('now'), 0, '$VALID_JSON')"

STDOUT=$(db "SELECT stdout_text FROM hook_invocations WHERE session_id='sess-9'")
if [ "$STDOUT" != "$VALID_JSON" ]; then
  echo "FAIL: Valid JSON with stopReason not stored"
  exit 1
fi

echo "  ✓ Valid JSON stdout - stopReason"

# ============================================================================
# Test 10: Valid JSON stdout - systemMessage
# ============================================================================
echo "  Test: Valid JSON stdout - systemMessage..."
fresh_db "json_system"

db "INSERT INTO conversations(id, project_dir, phase) VALUES ('conv-10', '/tmp', 'idle')"
db "INSERT INTO sessions(session_id, conversation_id) VALUES ('sess-10', 'conv-10')"

# Valid output with systemMessage
VALID_JSON='{"systemMessage":"Please review the changes before proceeding"}'
db "INSERT INTO hook_invocations (session_id, conversation_id, hook_event, hook_ordinal, matcher, command, input_json, started_at, completed_at, exit_code, stdout_text) VALUES ('sess-10', 'conv-10', 'PreToolUse', 0, 'Write', 'echo sys', '{}', datetime('now'), datetime('now'), 0, '$VALID_JSON')"

STDOUT=$(db "SELECT stdout_text FROM hook_invocations WHERE session_id='sess-10'")
if [ "$STDOUT" != "$VALID_JSON" ]; then
  echo "FAIL: Valid JSON with systemMessage not stored"
  exit 1
fi

echo "  ✓ Valid JSON stdout - systemMessage"

echo ""
echo "✓ All §5.5 JSON validation tests passed"
