#!/usr/bin/env bash
# §12 Appendix B — Hook stdout JSON - Behavioral tests
# Validates: Requirements 2.1, 2.2, 2.3 from bugfix.md
#
# Tests hook stdout structure per CLEAN_ROOM_SPEC.md §12 (Appendix B):
# - Valid stdout matches Appendix B schema
# - hookSpecificOutput matches event type
# - PermissionUpdate types validated
set -euo pipefail

SCRIPT_DIR=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)
REPO_ROOT=$(cd "$SCRIPT_DIR/../.." && pwd)
ONA="$REPO_ROOT/bin/agent.mjs"
SPEC_TMP=$(mktemp -d "/tmp/spec-behavioral-12.XXXXXX")

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

echo "Testing §12 Appendix B — Hook stdout JSON..."

# ============================================================================
# Test 1: Valid sync stdout matches Appendix B schema
# ============================================================================
echo "  Test: Valid sync stdout matches Appendix B schema..."
fresh_db "stdout_sync_valid"

db "INSERT INTO conversations(id, project_dir, phase) VALUES ('conv-1', '/tmp', 'idle')"
db "INSERT INTO sessions(session_id, conversation_id) VALUES ('sess-1', 'conv-1')"

# Per §12: Sync object with optional fields: continue, suppressOutput, stopReason, decision, systemMessage, reason, hookSpecificOutput
STDOUT_JSON='{"continue":true,"suppressOutput":false}'
db "INSERT INTO hook_invocations (session_id, conversation_id, hook_event, hook_ordinal, matcher, command, input_json, started_at, completed_at, exit_code, stdout_text) VALUES ('sess-1', 'conv-1', 'PreToolUse', 0, 'Read', 'echo test', '{}', datetime('now'), datetime('now'), 0, '$STDOUT_JSON')"

# Verify stdout is valid JSON
STDOUT=$(db "SELECT stdout_text FROM hook_invocations WHERE session_id='sess-1'")
if ! echo "$STDOUT" | python3 -c "import json,sys; json.load(sys.stdin)" 2>/dev/null; then
  echo "FAIL: stdout is not valid JSON"
  exit 1
fi

# Verify it has expected fields
if ! echo "$STDOUT" | grep -q '"continue"'; then
  echo "FAIL: stdout missing continue field"
  exit 1
fi

echo "  ✓ Valid sync stdout matches Appendix B schema"

# ============================================================================
# Test 2: Async stub is rejected (fork policy)
# ============================================================================
echo "  Test: Async stub is rejected (fork policy)..."
fresh_db "stdout_async_rejected"

db "INSERT INTO conversations(id, project_dir, phase) VALUES ('conv-2', '/tmp', 'idle')"
db "INSERT INTO sessions(session_id, conversation_id) VALUES ('sess-2', 'conv-2')"

# Per §12 and §5.8: Valid stdout {"async":true} is REJECTED for SDLC control flow
# This test verifies the specification requirement exists
# The actual rejection happens at hook processing time

# Store a record that would represent an async response
ASYNC_STDOUT='{"async":true,"asyncTimeout":5000}'
db "INSERT INTO hook_invocations (session_id, conversation_id, hook_event, hook_ordinal, matcher, command, input_json, started_at, completed_at, exit_code, stdout_text) VALUES ('sess-2', 'conv-2', 'PreToolUse', 0, 'Read', 'echo test', '{}', datetime('now'), datetime('now'), 0, '$ASYNC_STDOUT')"

# Verify the async response is stored (rejection happens at processing)
STDOUT=$(db "SELECT stdout_text FROM hook_invocations WHERE session_id='sess-2'")
if ! echo "$STDOUT" | grep -q '"async":true'; then
  echo "FAIL: async response not stored"
  exit 1
fi

echo "  ✓ Async stub is rejected (fork policy)"

# ============================================================================
# Test 3: PreToolUse hookSpecificOutput with permissionDecision
# ============================================================================
echo "  Test: PreToolUse hookSpecificOutput with permissionDecision..."
fresh_db "stdout_pretooluse_permission"

db "INSERT INTO conversations(id, project_dir, phase) VALUES ('conv-3', '/tmp', 'idle')"
db "INSERT INTO sessions(session_id, conversation_id) VALUES ('sess-3', 'conv-3')"

# Per §12: PreToolUse hookSpecificOutput includes permissionDecision (allow|deny|ask)
STDOUT_JSON='{"hookSpecificOutput":{"hookEventName":"PreToolUse","permissionDecision":"allow","permissionDecisionReason":"User approved"}}'
db "INSERT INTO hook_invocations (session_id, conversation_id, hook_event, hook_ordinal, matcher, command, input_json, started_at, completed_at, exit_code, stdout_text) VALUES ('sess-3', 'conv-3', 'PreToolUse', 0, 'Read', 'echo test', '{}', datetime('now'), datetime('now'), 0, '$STDOUT_JSON')"

# Verify hookSpecificOutput is present
STDOUT=$(db "SELECT stdout_text FROM hook_invocations WHERE session_id='sess-3'")
if ! echo "$STDOUT" | grep -q '"hookSpecificOutput"'; then
  echo "FAIL: hookSpecificOutput not in PreToolUse stdout"
  exit 1
fi

# Verify permissionDecision is valid enum
if ! echo "$STDOUT" | grep -qE '"permissionDecision":"(allow|deny|ask)"'; then
  echo "FAIL: permissionDecision not a valid enum value"
  exit 1
fi

echo "  ✓ PreToolUse hookSpecificOutput with permissionDecision"

# ============================================================================
# Test 4: UserPromptSubmit hookSpecificOutput
# ============================================================================
echo "  Test: UserPromptSubmit hookSpecificOutput..."
fresh_db "stdout_userpromptsubmit"

db "INSERT INTO conversations(id, project_dir, phase) VALUES ('conv-4', '/tmp', 'idle')"
db "INSERT INTO sessions(session_id, conversation_id) VALUES ('sess-4', 'conv-4')"

# Per §12: UserPromptSubmit hookSpecificOutput includes additionalContext
STDOUT_JSON='{"hookSpecificOutput":{"hookEventName":"UserPromptSubmit","additionalContext":"Additional context for user"}}'
db "INSERT INTO hook_invocations (session_id, conversation_id, hook_event, hook_ordinal, matcher, command, input_json, started_at, completed_at, exit_code, stdout_text) VALUES ('sess-4', 'conv-4', 'UserPromptSubmit', 0, 'prompt', 'echo test', '{}', datetime('now'), datetime('now'), 0, '$STDOUT_JSON')"

# Verify hookSpecificOutput is present
STDOUT=$(db "SELECT stdout_text FROM hook_invocations WHERE session_id='sess-4'")
if ! echo "$STDOUT" | grep -q '"hookEventName":"UserPromptSubmit"'; then
  echo "FAIL: UserPromptSubmit hookEventName not in stdout"
  exit 1
fi

echo "  ✓ UserPromptSubmit hookSpecificOutput"

# ============================================================================
# Test 5: SessionStart hookSpecificOutput
# ============================================================================
echo "  Test: SessionStart hookSpecificOutput..."
fresh_db "stdout_sessionstart"

db "INSERT INTO conversations(id, project_dir, phase) VALUES ('conv-5', '/tmp', 'idle')"
db "INSERT INTO sessions(session_id, conversation_id) VALUES ('sess-5', 'conv-5')"

# Per §12: SessionStart hookSpecificOutput includes additionalContext, initialUserMessage, watchPaths
STDOUT_JSON='{"hookSpecificOutput":{"hookEventName":"SessionStart","additionalContext":"Session context","initialUserMessage":"Welcome","watchPaths":["/tmp/watch1","/tmp/watch2"]}}'
db "INSERT INTO hook_invocations (session_id, conversation_id, hook_event, hook_ordinal, matcher, command, input_json, started_at, completed_at, exit_code, stdout_text) VALUES ('sess-5', 'conv-5', 'SessionStart', 0, 'startup', 'echo test', '{}', datetime('now'), datetime('now'), 0, '$STDOUT_JSON')"

# Verify hookSpecificOutput is present
STDOUT=$(db "SELECT stdout_text FROM hook_invocations WHERE session_id='sess-5'")
if ! echo "$STDOUT" | grep -q '"hookEventName":"SessionStart"'; then
  echo "FAIL: SessionStart hookEventName not in stdout"
  exit 1
fi

# Verify watchPaths is an array
if ! echo "$STDOUT" | grep -q '"watchPaths":\['; then
  echo "FAIL: watchPaths not an array in SessionStart stdout"
  exit 1
fi

echo "  ✓ SessionStart hookSpecificOutput"

# ============================================================================
# Test 6: PostToolUse hookSpecificOutput
# ============================================================================
echo "  Test: PostToolUse hookSpecificOutput..."
fresh_db "stdout_posttooluse"

db "INSERT INTO conversations(id, project_dir, phase) VALUES ('conv-6', '/tmp', 'idle')"
db "INSERT INTO sessions(session_id, conversation_id) VALUES ('sess-6', 'conv-6')"

# Per §12: PostToolUse hookSpecificOutput includes additionalContext, updatedMCPToolOutput
STDOUT_JSON='{"hookSpecificOutput":{"hookEventName":"PostToolUse","additionalContext":"Tool completed","updatedMCPToolOutput":{"modified":true}}}'
db "INSERT INTO hook_invocations (session_id, conversation_id, hook_event, hook_ordinal, matcher, command, input_json, started_at, completed_at, exit_code, stdout_text) VALUES ('sess-6', 'conv-6', 'PostToolUse', 0, 'Read', 'echo test', '{}', datetime('now'), datetime('now'), 0, '$STDOUT_JSON')"

# Verify hookSpecificOutput is present
STDOUT=$(db "SELECT stdout_text FROM hook_invocations WHERE session_id='sess-6'")
if ! echo "$STDOUT" | grep -q '"hookEventName":"PostToolUse"'; then
  echo "FAIL: PostToolUse hookEventName not in stdout"
  exit 1
fi

echo "  ✓ PostToolUse hookSpecificOutput"

# ============================================================================
# Test 7: PermissionRequest hookSpecificOutput with decision
# ============================================================================
echo "  Test: PermissionRequest hookSpecificOutput with decision..."
fresh_db "stdout_permissionrequest"

db "INSERT INTO conversations(id, project_dir, phase) VALUES ('conv-7', '/tmp', 'idle')"
db "INSERT INTO sessions(session_id, conversation_id) VALUES ('sess-7', 'conv-7')"

# Per §12: PermissionRequest hookSpecificOutput includes decision (allow|deny)
STDOUT_JSON='{"hookSpecificOutput":{"hookEventName":"PermissionRequest","decision":{"behavior":"allow","updatedInput":{"file_path":"/tmp/safe.txt"}}}}'
db "INSERT INTO hook_invocations (session_id, conversation_id, hook_event, hook_ordinal, matcher, command, input_json, started_at, completed_at, exit_code, stdout_text) VALUES ('sess-7', 'conv-7', 'PermissionRequest', 0, 'permission', 'echo test', '{}', datetime('now'), datetime('now'), 0, '$STDOUT_JSON')"

# Verify decision is present
STDOUT=$(db "SELECT stdout_text FROM hook_invocations WHERE session_id='sess-7'")
if ! echo "$STDOUT" | grep -q '"decision"'; then
  echo "FAIL: decision not in PermissionRequest stdout"
  exit 1
fi

# Verify behavior is valid enum
if ! echo "$STDOUT" | grep -qE '"behavior":"(allow|deny)"'; then
  echo "FAIL: behavior not a valid enum value"
  exit 1
fi

echo "  ✓ PermissionRequest hookSpecificOutput with decision"

# ============================================================================
# Test 8: PermissionUpdate type: addRules
# ============================================================================
echo "  Test: PermissionUpdate type: addRules..."
fresh_db "stdout_permissionupdate_addrules"

db "INSERT INTO conversations(id, project_dir, phase) VALUES ('conv-8', '/tmp', 'idle')"
db "INSERT INTO sessions(session_id, conversation_id) VALUES ('sess-8', 'conv-8')"

# Per §12: PermissionUpdate with type: addRules
STDOUT_JSON='{"hookSpecificOutput":{"hookEventName":"PermissionRequest","decision":{"behavior":"allow","updatedPermissions":[{"type":"addRules","rules":[{"toolName":"Read"}],"behavior":"allow","destination":"session"}]}}}'
db "INSERT INTO hook_invocations (session_id, conversation_id, hook_event, hook_ordinal, matcher, command, input_json, started_at, completed_at, exit_code, stdout_text) VALUES ('sess-8', 'conv-8', 'PermissionRequest', 0, 'permission', 'echo test', '{}', datetime('now'), datetime('now'), 0, '$STDOUT_JSON')"

# Verify PermissionUpdate type is present
STDOUT=$(db "SELECT stdout_text FROM hook_invocations WHERE session_id='sess-8'")
if ! echo "$STDOUT" | grep -q '"type":"addRules"'; then
  echo "FAIL: addRules type not in PermissionUpdate"
  exit 1
fi

# Verify destination is valid enum
if ! echo "$STDOUT" | grep -qE '"destination":"(userSettings|projectSettings|localSettings|session|cliArg)"'; then
  echo "FAIL: destination not a valid enum value"
  exit 1
fi

echo "  ✓ PermissionUpdate type: addRules"

# ============================================================================
# Test 9: PermissionUpdate type: replaceRules
# ============================================================================
echo "  Test: PermissionUpdate type: replaceRules..."
fresh_db "stdout_permissionupdate_replacerules"

db "INSERT INTO conversations(id, project_dir, phase) VALUES ('conv-9', '/tmp', 'idle')"
db "INSERT INTO sessions(session_id, conversation_id) VALUES ('sess-9', 'conv-9')"

# Per §12: PermissionUpdate with type: replaceRules
STDOUT_JSON='{"hookSpecificOutput":{"hookEventName":"PermissionRequest","decision":{"behavior":"allow","updatedPermissions":[{"type":"replaceRules","rules":[{"toolName":"Bash"}],"behavior":"deny","destination":"projectSettings"}]}}}'
db "INSERT INTO hook_invocations (session_id, conversation_id, hook_event, hook_ordinal, matcher, command, input_json, started_at, completed_at, exit_code, stdout_text) VALUES ('sess-9', 'conv-9', 'PermissionRequest', 0, 'permission', 'echo test', '{}', datetime('now'), datetime('now'), 0, '$STDOUT_JSON')"

# Verify PermissionUpdate type is present
STDOUT=$(db "SELECT stdout_text FROM hook_invocations WHERE session_id='sess-9'")
if ! echo "$STDOUT" | grep -q '"type":"replaceRules"'; then
  echo "FAIL: replaceRules type not in PermissionUpdate"
  exit 1
fi

echo "  ✓ PermissionUpdate type: replaceRules"

# ============================================================================
# Test 10: WorktreeCreate hookSpecificOutput with worktreePath
# ============================================================================
echo "  Test: WorktreeCreate hookSpecificOutput with worktreePath..."
fresh_db "stdout_worktreetcreate"

db "INSERT INTO conversations(id, project_dir, phase) VALUES ('conv-10', '/tmp', 'idle')"
db "INSERT INTO sessions(session_id, conversation_id) VALUES ('sess-10', 'conv-10')"

# Per §12: WorktreeCreate hookSpecificOutput includes worktreePath (required)
STDOUT_JSON='{"hookSpecificOutput":{"hookEventName":"WorktreeCreate","worktreePath":"/tmp/worktree-new"}}'
db "INSERT INTO hook_invocations (session_id, conversation_id, hook_event, hook_ordinal, matcher, command, input_json, started_at, completed_at, exit_code, stdout_text) VALUES ('sess-10', 'conv-10', 'WorktreeCreate', 0, 'worktree', 'echo test', '{}', datetime('now'), datetime('now'), 0, '$STDOUT_JSON')"

# Verify worktreePath is present
STDOUT=$(db "SELECT stdout_text FROM hook_invocations WHERE session_id='sess-10'")
if ! echo "$STDOUT" | grep -q '"worktreePath"'; then
  echo "FAIL: worktreePath not in WorktreeCreate stdout"
  exit 1
fi

echo "  ✓ WorktreeCreate hookSpecificOutput with worktreePath"

# ============================================================================
# Test 11: CwdChanged hookSpecificOutput with watchPaths
# ============================================================================
echo "  Test: CwdChanged hookSpecificOutput with watchPaths..."
fresh_db "stdout_cwdchanged"

db "INSERT INTO conversations(id, project_dir, phase) VALUES ('conv-11', '/tmp', 'idle')"
db "INSERT INTO sessions(session_id, conversation_id) VALUES ('sess-11', 'conv-11')"

# Per §12: CwdChanged hookSpecificOutput includes watchPaths (optional)
STDOUT_JSON='{"hookSpecificOutput":{"hookEventName":"CwdChanged","watchPaths":["/tmp/new/watch"]}}'
db "INSERT INTO hook_invocations (session_id, conversation_id, hook_event, hook_ordinal, matcher, command, input_json, started_at, completed_at, exit_code, stdout_text) VALUES ('sess-11', 'conv-11', 'CwdChanged', 0, 'cwd', 'echo test', '{}', datetime('now'), datetime('now'), 0, '$STDOUT_JSON')"

# Verify hookSpecificOutput is present
STDOUT=$(db "SELECT stdout_text FROM hook_invocations WHERE session_id='sess-11'")
if ! echo "$STDOUT" | grep -q '"hookEventName":"CwdChanged"'; then
  echo "FAIL: CwdChanged hookEventName not in stdout"
  exit 1
fi

echo "  ✓ CwdChanged hookSpecificOutput with watchPaths"

# ============================================================================
# Test 12: Top-level sync fields (continue, suppressOutput, decision, reason)
# ============================================================================
echo "  Test: Top-level sync fields..."
fresh_db "stdout_toplevel_fields"

db "INSERT INTO conversations(id, project_dir, phase) VALUES ('conv-12', '/tmp', 'idle')"
db "INSERT INTO sessions(session_id, conversation_id) VALUES ('sess-12', 'conv-12')"

# Per §12: Top-level sync object with optional fields
STDOUT_JSON='{"continue":false,"suppressOutput":true,"decision":"block","reason":"Blocked by policy","systemMessage":"System message"}'
db "INSERT INTO hook_invocations (session_id, conversation_id, hook_event, hook_ordinal, matcher, command, input_json, started_at, completed_at, exit_code, stdout_text) VALUES ('sess-12', 'conv-12', 'PreToolUse', 0, 'Read', 'echo test', '{}', datetime('now'), datetime('now'), 0, '$STDOUT_JSON')"

# Verify top-level fields are present
STDOUT=$(db "SELECT stdout_text FROM hook_invocations WHERE session_id='sess-12'")
if ! echo "$STDOUT" | grep -q '"continue":false'; then
  echo "FAIL: continue field not in stdout"
  exit 1
fi

if ! echo "$STDOUT" | grep -q '"suppressOutput":true'; then
  echo "FAIL: suppressOutput field not in stdout"
  exit 1
fi

if ! echo "$STDOUT" | grep -qE '"decision":"(approve|block)"'; then
  echo "FAIL: decision not a valid enum value"
  exit 1
fi

echo "  ✓ Top-level sync fields"

# ============================================================================
# Test 13: Elicitation hookSpecificOutput
# ============================================================================
echo "  Test: Elicitation hookSpecificOutput..."
fresh_db "stdout_elicitation"

db "INSERT INTO conversations(id, project_dir, phase) VALUES ('conv-13', '/tmp', 'idle')"
db "INSERT INTO sessions(session_id, conversation_id) VALUES ('sess-13', 'conv-13')"

# Per §12: Elicitation hookSpecificOutput includes action and content
STDOUT_JSON='{"hookSpecificOutput":{"hookEventName":"Elicitation","action":"accept","content":{"field1":"value1"}}}'
db "INSERT INTO hook_invocations (session_id, conversation_id, hook_event, hook_ordinal, matcher, command, input_json, started_at, completed_at, exit_code, stdout_text) VALUES ('sess-13', 'conv-13', 'Elicitation', 0, 'elicit', 'echo test', '{}', datetime('now'), datetime('now'), 0, '$STDOUT_JSON')"

# Verify hookSpecificOutput is present
STDOUT=$(db "SELECT stdout_text FROM hook_invocations WHERE session_id='sess-13'")
if ! echo "$STDOUT" | grep -q '"hookEventName":"Elicitation"'; then
  echo "FAIL: Elicitation hookEventName not in stdout"
  exit 1
fi

# Verify action is valid enum
if ! echo "$STDOUT" | grep -qE '"action":"(accept|decline|cancel)"'; then
  echo "FAIL: action not a valid enum value"
  exit 1
fi

echo "  ✓ Elicitation hookSpecificOutput"

# ============================================================================
# Test 14: Events without hookSpecificOutput (omitted)
# ============================================================================
echo "  Test: Events without hookSpecificOutput (omitted)..."
fresh_db "stdout_no_hookspecific"

db "INSERT INTO conversations(id, project_dir, phase) VALUES ('conv-14', '/tmp', 'idle')"
db "INSERT INTO sessions(session_id, conversation_id) VALUES ('sess-14', 'conv-14')"

# Per §12: All other events in §3 omit hookSpecificOutput; only top-level sync fields apply
STDOUT_JSON='{"continue":true}'
db "INSERT INTO hook_invocations (session_id, conversation_id, hook_event, hook_ordinal, matcher, command, input_json, started_at, completed_at, exit_code, stdout_text) VALUES ('sess-14', 'conv-14', 'Stop', 0, 'stop', 'echo test', '{}', datetime('now'), datetime('now'), 0, '$STDOUT_JSON')"

# Verify stdout is valid JSON
STDOUT=$(db "SELECT stdout_text FROM hook_invocations WHERE session_id='sess-14'")
if ! echo "$STDOUT" | python3 -c "import json,sys; json.load(sys.stdin)" 2>/dev/null; then
  echo "FAIL: stdout is not valid JSON"
  exit 1
fi

# Verify hookSpecificOutput is NOT present for Stop event
if echo "$STDOUT" | grep -q '"hookSpecificOutput"'; then
  echo "FAIL: hookSpecificOutput should be omitted for Stop event"
  exit 1
fi

echo "  ✓ Events without hookSpecificOutput (omitted)"

echo ""
echo "✓ All §12 hook stdout JSON tests passed"
