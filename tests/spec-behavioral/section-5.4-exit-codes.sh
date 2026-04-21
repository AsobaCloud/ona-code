#!/usr/bin/env bash
# §5.4 Exit codes (command hooks) - Behavioral tests for hook exit codes
# Validates: Requirements 2.1, 2.2, 2.3 from bugfix.md
#
# Tests hook exit codes per CLEAN_ROOM_SPEC.md §5.4:
# - Exit 0 = success, parse JSON if stdout starts with `{`
# - Exit 2 = blocking (PreToolUse/UserPromptSubmit)
# - Other exit = non-blocking failure, continue chain
set -euo pipefail

SCRIPT_DIR=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)
REPO_ROOT=$(cd "$SCRIPT_DIR/../.." && pwd)
ONA="$REPO_ROOT/bin/agent.mjs"
SPEC_TMP=$(mktemp -d "${TMPDIR:-/tmp}/spec-behavioral-5.4.XXXXXX")

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

echo "Testing §5.4 Exit Codes..."

# ============================================================================
# Test 1: Exit 0 = success
# ============================================================================
echo "  Test: Exit 0 = success..."
fresh_db "exit_0_success"

db "INSERT INTO conversations(id, project_dir, phase) VALUES ('conv-1', '/tmp', 'idle')"
db "INSERT INTO sessions(session_id, conversation_id) VALUES ('sess-1', 'conv-1')"

# Simulate hook with exit code 0
db "INSERT INTO hook_invocations (session_id, conversation_id, hook_event, hook_ordinal, matcher, command, input_json, started_at, completed_at, exit_code, stdout_text) VALUES ('sess-1', 'conv-1', 'PreToolUse', 0, 'Read', 'echo success', '{}', datetime('now'), datetime('now'), 0, 'success')"

# Verify exit code 0 is recorded
EXIT_CODE=$(db "SELECT exit_code FROM hook_invocations WHERE session_id='sess-1' AND hook_ordinal=0")
if [ "$EXIT_CODE" != "0" ]; then
  echo "FAIL: Exit code 0 not recorded correctly, got $EXIT_CODE"
  exit 1
fi

echo "  ✓ Exit 0 = success"

# ============================================================================
# Test 2: Exit 0 with JSON stdout (starts with `{`)
# ============================================================================
echo "  Test: Exit 0 with JSON stdout..."
fresh_db "exit_0_json"

db "INSERT INTO conversations(id, project_dir, phase) VALUES ('conv-2', '/tmp', 'idle')"
db "INSERT INTO sessions(session_id, conversation_id) VALUES ('sess-2', 'conv-2')"

# Simulate hook with exit code 0 and JSON stdout
JSON_OUTPUT='{"permissionDecision":"allow"}'
db "INSERT INTO hook_invocations (session_id, conversation_id, hook_event, hook_ordinal, matcher, command, input_json, started_at, completed_at, exit_code, stdout_text) VALUES ('sess-2', 'conv-2', 'PreToolUse', 0, 'Read', 'echo json', '{}', datetime('now'), datetime('now'), 0, '$JSON_OUTPUT')"

# Verify JSON stdout is stored
STDOUT=$(db "SELECT stdout_text FROM hook_invocations WHERE session_id='sess-2' AND hook_ordinal=0")
if [ "$STDOUT" != "$JSON_OUTPUT" ]; then
  echo "FAIL: JSON stdout not stored correctly"
  echo "Expected: $JSON_OUTPUT"
  echo "Got: $STDOUT"
  exit 1
fi

# Verify it starts with `{`
if [ "${STDOUT:0:1}" != "{" ]; then
  echo "FAIL: JSON stdout should start with '{'"
  exit 1
fi

echo "  ✓ Exit 0 with JSON stdout parsed"

# ============================================================================
# Test 3: Exit 2 = blocking (PreToolUse)
# ============================================================================
echo "  Test: Exit 2 = blocking (PreToolUse)..."
fresh_db "exit_2_blocking"

db "INSERT INTO conversations(id, project_dir, phase) VALUES ('conv-3', '/tmp', 'idle')"
db "INSERT INTO sessions(session_id, conversation_id) VALUES ('sess-3', 'conv-3')"

# Simulate hook with exit code 2 (blocking)
db "INSERT INTO hook_invocations (session_id, conversation_id, hook_event, hook_ordinal, matcher, command, input_json, started_at, completed_at, exit_code, stderr_text) VALUES ('sess-3', 'conv-3', 'PreToolUse', 0, 'Bash', 'echo block', '{}', datetime('now'), datetime('now'), 2, 'Tool blocked by policy')"

# Verify exit code 2 is recorded
EXIT_CODE=$(db "SELECT exit_code FROM hook_invocations WHERE session_id='sess-3' AND hook_ordinal=0")
if [ "$EXIT_CODE" != "2" ]; then
  echo "FAIL: Exit code 2 not recorded correctly, got $EXIT_CODE"
  exit 1
fi

# Verify stderr is captured for blocking message
STDERR=$(db "SELECT stderr_text FROM hook_invocations WHERE session_id='sess-3' AND hook_ordinal=0")
if [ -z "$STDERR" ]; then
  echo "FAIL: Blocking hook should have stderr_text"
  exit 1
fi

echo "  ✓ Exit 2 = blocking (PreToolUse)"

# ============================================================================
# Test 4: Exit 2 = blocking (UserPromptSubmit)
# ============================================================================
echo "  Test: Exit 2 = blocking (UserPromptSubmit)..."
fresh_db "exit_2_userprompt"

db "INSERT INTO conversations(id, project_dir, phase) VALUES ('conv-4', '/tmp', 'idle')"
db "INSERT INTO sessions(session_id, conversation_id) VALUES ('sess-4', 'conv-4')"

# Simulate UserPromptSubmit hook with exit code 2
db "INSERT INTO hook_invocations (session_id, conversation_id, hook_event, hook_ordinal, matcher, command, input_json, started_at, completed_at, exit_code, stderr_text) VALUES ('sess-4', 'conv-4', 'UserPromptSubmit', 0, '', 'echo block', '{}', datetime('now'), datetime('now'), 2, 'Prompt blocked')"

# Verify exit code 2 is recorded for UserPromptSubmit
EXIT_CODE=$(db "SELECT exit_code FROM hook_invocations WHERE session_id='sess-4' AND hook_event='UserPromptSubmit'")
if [ "$EXIT_CODE" != "2" ]; then
  echo "FAIL: Exit code 2 not recorded for UserPromptSubmit"
  exit 1
fi

echo "  ✓ Exit 2 = blocking (UserPromptSubmit)"

# ============================================================================
# Test 5: Other exit = non-blocking failure
# ============================================================================
echo "  Test: Other exit = non-blocking failure..."
fresh_db "exit_other_nonblocking"

db "INSERT INTO conversations(id, project_dir, phase) VALUES ('conv-5', '/tmp', 'idle')"
db "INSERT INTO sessions(session_id, conversation_id) VALUES ('sess-5', 'conv-5')"

# Simulate hook with exit code 1 (non-blocking failure)
db "INSERT INTO hook_invocations (session_id, conversation_id, hook_event, hook_ordinal, matcher, command, input_json, started_at, completed_at, exit_code, stderr_text) VALUES ('sess-5', 'conv-5', 'PreToolUse', 0, 'Read', 'echo fail', '{}', datetime('now'), datetime('now'), 1, 'Hook failed')"

# Verify exit code 1 is recorded
EXIT_CODE=$(db "SELECT exit_code FROM hook_invocations WHERE session_id='sess-5' AND hook_ordinal=0")
if [ "$EXIT_CODE" != "1" ]; then
  echo "FAIL: Exit code 1 not recorded correctly, got $EXIT_CODE"
  exit 1
fi

echo "  ✓ Other exit = non-blocking failure"

# ============================================================================
# Test 6: Non-blocking failure continues chain
# ============================================================================
echo "  Test: Non-blocking failure continues chain..."
fresh_db "continue_chain"

db "INSERT INTO conversations(id, project_dir, phase) VALUES ('conv-6', '/tmp', 'idle')"
db "INSERT INTO sessions(session_id, conversation_id) VALUES ('sess-6', 'conv-6')"

# Simulate multiple hooks: first fails (exit 1), second succeeds (exit 0)
db "INSERT INTO hook_invocations (session_id, conversation_id, hook_event, hook_ordinal, matcher, command, input_json, started_at, completed_at, exit_code) VALUES ('sess-6', 'conv-6', 'PreToolUse', 0, 'Read', 'echo fail', '{}', datetime('now'), datetime('now'), 1)"
db "INSERT INTO hook_invocations (session_id, conversation_id, hook_event, hook_ordinal, matcher, command, input_json, started_at, completed_at, exit_code) VALUES ('sess-6', 'conv-6', 'PreToolUse', 1, 'Write', 'echo success', '{}', datetime('now'), datetime('now'), 0)"

# Verify both hooks executed (chain continued)
HOOK_COUNT=$(db "SELECT COUNT(*) FROM hook_invocations WHERE session_id='sess-6'")
if [ "$HOOK_COUNT" != "2" ]; then
  echo "FAIL: Chain should continue after non-blocking failure"
  echo "Expected 2 hooks, got $HOOK_COUNT"
  exit 1
fi

echo "  ✓ Non-blocking failure continues chain"

# ============================================================================
# Test 7: Exit code null for skipped hooks
# ============================================================================
echo "  Test: Exit code null for skipped hooks..."
fresh_db "skipped_hook"

db "INSERT INTO conversations(id, project_dir, phase) VALUES ('conv-7', '/tmp', 'idle')"
db "INSERT INTO sessions(session_id, conversation_id) VALUES ('sess-7', 'conv-7')"

# Simulate skipped hook (per §5.6: skipped_reason = 'prior_block_or_deny')
db "INSERT INTO hook_invocations (session_id, conversation_id, hook_event, hook_ordinal, matcher, command, input_json, started_at, exit_code, skipped_reason) VALUES ('sess-7', 'conv-7', 'PreToolUse', 1, 'Edit', 'echo skip', '{}', datetime('now'), NULL, 'prior_block_or_deny')"

# Verify skipped_reason is set
SKIPPED=$(db "SELECT skipped_reason FROM hook_invocations WHERE session_id='sess-7' AND hook_ordinal=1")
if [ "$SKIPPED" != "prior_block_or_deny" ]; then
  echo "FAIL: skipped_reason not set correctly, got $SKIPPED"
  exit 1
fi

# Verify exit_code is NULL
EXIT_CODE=$(db "SELECT exit_code FROM hook_invocations WHERE session_id='sess-7' AND hook_ordinal=1")
if [ "$EXIT_CODE" != "" ]; then
  echo "FAIL: Skipped hook should have NULL exit_code"
  exit 1
fi

echo "  ✓ Exit code null for skipped hooks"

# ============================================================================
# Test 8: Plain stdout (not JSON) on exit 0
# ============================================================================
echo "  Test: Plain stdout on exit 0..."
fresh_db "plain_stdout"

db "INSERT INTO conversations(id, project_dir, phase) VALUES ('conv-8', '/tmp', 'idle')"
db "INSERT INTO sessions(session_id, conversation_id) VALUES ('sess-8', 'conv-8')"

# Simulate hook with plain text stdout (not JSON)
db "INSERT INTO hook_invocations (session_id, conversation_id, hook_event, hook_ordinal, matcher, command, input_json, started_at, completed_at, exit_code, stdout_text) VALUES ('sess-8', 'conv-8', 'PostToolUse', 0, 'Read', 'echo plain', '{}', datetime('now'), datetime('now'), 0, 'Hook completed successfully')"

# Verify plain stdout is stored
STDOUT=$(db "SELECT stdout_text FROM hook_invocations WHERE session_id='sess-8' AND hook_ordinal=0")
if [ "$STDOUT" != "Hook completed successfully" ]; then
  echo "FAIL: Plain stdout not stored correctly"
  exit 1
fi

echo "  ✓ Plain stdout on exit 0"

echo ""
echo "✓ All §5.4 exit code tests passed"
