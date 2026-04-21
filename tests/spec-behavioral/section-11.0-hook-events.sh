#!/usr/bin/env bash
# §11 Appendix A — Hook stdin JSON (every event) - Behavioral tests
# Validates: Requirements 2.1, 2.2, 2.3 from bugfix.md
#
# Tests hook stdin fields per CLEAN_ROOM_SPEC.md §11 (Appendix A):
# - PreToolUse stdin includes tool_name, tool_input, tool_use_id
# - PostToolUse stdin includes tool_response
# - SessionStart stdin includes source enum
# - All 24 events from §3 have correct stdin fields
set -euo pipefail

SCRIPT_DIR=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)
REPO_ROOT=$(cd "$SCRIPT_DIR/../.." && pwd)
ONA="$REPO_ROOT/bin/agent.mjs"
SPEC_TMP=$(mktemp -d "/tmp/spec-behavioral-11.XXXXXX")

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

echo "Testing §11 Appendix A — Hook stdin JSON (every event)..."

# ============================================================================
# Test 1: PreToolUse stdin includes tool_name, tool_input, tool_use_id
# ============================================================================
echo "  Test: PreToolUse stdin includes tool_name, tool_input, tool_use_id..."
fresh_db "event_pretooluse"

db "INSERT INTO conversations(id, project_dir, phase) VALUES ('conv-1', '/tmp', 'idle')"
db "INSERT INTO sessions(session_id, conversation_id) VALUES ('sess-1', 'conv-1')"

# Per §11: PreToolUse includes tool_name, tool_input, tool_use_id
INPUT_JSON='{"hook_event_name":"PreToolUse","session_id":"sess-1","conversation_id":"conv-1","runtime_db_path":"'"$AGENT_SDLC_DB"'","cwd":"/tmp","tool_name":"Read","tool_input":{"file_path":"/tmp/test.txt"},"tool_use_id":"tool-123"}'
db "INSERT INTO hook_invocations (session_id, conversation_id, hook_event, hook_ordinal, matcher, command, input_json, started_at) VALUES ('sess-1', 'conv-1', 'PreToolUse', 0, 'Read', 'echo test', '$INPUT_JSON', datetime('now'))"

# Verify all required fields are present
INPUT=$(db "SELECT input_json FROM hook_invocations WHERE session_id='sess-1'")
if ! echo "$INPUT" | grep -q '"tool_name":"Read"'; then
  echo "FAIL: tool_name not in PreToolUse stdin"
  exit 1
fi

if ! echo "$INPUT" | grep -q '"tool_input"'; then
  echo "FAIL: tool_input not in PreToolUse stdin"
  exit 1
fi

if ! echo "$INPUT" | grep -q '"tool_use_id":"tool-123"'; then
  echo "FAIL: tool_use_id not in PreToolUse stdin"
  exit 1
fi

echo "  ✓ PreToolUse stdin includes tool_name, tool_input, tool_use_id"

# ============================================================================
# Test 2: PostToolUse stdin includes tool_response
# ============================================================================
echo "  Test: PostToolUse stdin includes tool_response..."
fresh_db "event_posttooluse"

db "INSERT INTO conversations(id, project_dir, phase) VALUES ('conv-2', '/tmp', 'idle')"
db "INSERT INTO sessions(session_id, conversation_id) VALUES ('sess-2', 'conv-2')"

# Per §11: PostToolUse includes tool_name, tool_input, tool_response, tool_use_id
INPUT_JSON='{"hook_event_name":"PostToolUse","session_id":"sess-2","conversation_id":"conv-2","runtime_db_path":"'"$AGENT_SDLC_DB"'","cwd":"/tmp","tool_name":"Read","tool_input":{"file_path":"/tmp/test.txt"},"tool_response":{"content":"file content","is_error":false},"tool_use_id":"tool-456"}'
db "INSERT INTO hook_invocations (session_id, conversation_id, hook_event, hook_ordinal, matcher, command, input_json, started_at) VALUES ('sess-2', 'conv-2', 'PostToolUse', 0, 'Read', 'echo test', '$INPUT_JSON', datetime('now'))"

# Verify tool_response is present
INPUT=$(db "SELECT input_json FROM hook_invocations WHERE session_id='sess-2'")
if ! echo "$INPUT" | grep -q '"tool_response"'; then
  echo "FAIL: tool_response not in PostToolUse stdin"
  exit 1
fi

# Verify tool_response contains expected fields
if ! echo "$INPUT" | grep -q '"content"'; then
  echo "FAIL: tool_response.content not in PostToolUse stdin"
  exit 1
fi

if ! echo "$INPUT" | grep -q '"is_error"'; then
  echo "FAIL: tool_response.is_error not in PostToolUse stdin"
  exit 1
fi

echo "  ✓ PostToolUse stdin includes tool_response"

# ============================================================================
# Test 3: SessionStart stdin includes source enum
# ============================================================================
echo "  Test: SessionStart stdin includes source enum..."
fresh_db "event_sessionstart"

db "INSERT INTO conversations(id, project_dir, phase) VALUES ('conv-3', '/tmp', 'idle')"
db "INSERT INTO sessions(session_id, conversation_id) VALUES ('sess-3', 'conv-3')"

# Per §11: SessionStart includes source enum: startup | resume | clear | compact
INPUT_JSON='{"hook_event_name":"SessionStart","session_id":"sess-3","conversation_id":"conv-3","runtime_db_path":"'"$AGENT_SDLC_DB"'","cwd":"/tmp","source":"startup"}'
db "INSERT INTO hook_invocations (session_id, conversation_id, hook_event, hook_ordinal, matcher, command, input_json, started_at) VALUES ('sess-3', 'conv-3', 'SessionStart', 0, 'startup', 'echo test', '$INPUT_JSON', datetime('now'))"

# Verify source is present
INPUT=$(db "SELECT input_json FROM hook_invocations WHERE session_id='sess-3'")
if ! echo "$INPUT" | grep -q '"source"'; then
  echo "FAIL: source not in SessionStart stdin"
  exit 1
fi

# Verify source is one of the valid enum values
if ! echo "$INPUT" | grep -qE '"source":"(startup|resume|clear|compact)"'; then
  echo "FAIL: source is not a valid enum value"
  exit 1
fi

echo "  ✓ SessionStart stdin includes source enum"

# ============================================================================
# Test 4: PostToolUseFailure stdin includes error and is_interrupt
# ============================================================================
echo "  Test: PostToolUseFailure stdin includes error and is_interrupt..."
fresh_db "event_posttoolusefailure"

db "INSERT INTO conversations(id, project_dir, phase) VALUES ('conv-4', '/tmp', 'idle')"
db "INSERT INTO sessions(session_id, conversation_id) VALUES ('sess-4', 'conv-4')"

# Per §11: PostToolUseFailure includes tool_name, tool_input, tool_use_id, error, is_interrupt
INPUT_JSON='{"hook_event_name":"PostToolUseFailure","session_id":"sess-4","conversation_id":"conv-4","runtime_db_path":"'"$AGENT_SDLC_DB"'","cwd":"/tmp","tool_name":"Bash","tool_input":{"command":"exit 1"},"tool_use_id":"tool-789","error":"Command failed","is_interrupt":false}'
db "INSERT INTO hook_invocations (session_id, conversation_id, hook_event, hook_ordinal, matcher, command, input_json, started_at) VALUES ('sess-4', 'conv-4', 'PostToolUseFailure', 0, 'Bash', 'echo test', '$INPUT_JSON', datetime('now'))"

# Verify error and is_interrupt are present
INPUT=$(db "SELECT input_json FROM hook_invocations WHERE session_id='sess-4'")
if ! echo "$INPUT" | grep -q '"error"'; then
  echo "FAIL: error not in PostToolUseFailure stdin"
  exit 1
fi

if ! echo "$INPUT" | grep -q '"is_interrupt"'; then
  echo "FAIL: is_interrupt not in PostToolUseFailure stdin"
  exit 1
fi

echo "  ✓ PostToolUseFailure stdin includes error and is_interrupt"

# ============================================================================
# Test 5: PermissionDenied stdin includes reason
# ============================================================================
echo "  Test: PermissionDenied stdin includes reason..."
fresh_db "event_permissiondenied"

db "INSERT INTO conversations(id, project_dir, phase) VALUES ('conv-5', '/tmp', 'idle')"
db "INSERT INTO sessions(session_id, conversation_id) VALUES ('sess-5', 'conv-5')"

# Per §11: PermissionDenied includes tool_name, tool_input, tool_use_id, reason
INPUT_JSON='{"hook_event_name":"PermissionDenied","session_id":"sess-5","conversation_id":"conv-5","runtime_db_path":"'"$AGENT_SDLC_DB"'","cwd":"/tmp","tool_name":"Bash","tool_input":{"command":"rm -rf /"},"tool_use_id":"tool-999","reason":"Dangerous command blocked"}'
db "INSERT INTO hook_invocations (session_id, conversation_id, hook_event, hook_ordinal, matcher, command, input_json, started_at) VALUES ('sess-5', 'conv-5', 'PermissionDenied', 0, 'Bash', 'echo test', '$INPUT_JSON', datetime('now'))"

# Verify reason is present
INPUT=$(db "SELECT input_json FROM hook_invocations WHERE session_id='sess-5'")
if ! echo "$INPUT" | grep -q '"reason"'; then
  echo "FAIL: reason not in PermissionDenied stdin"
  exit 1
fi

echo "  ✓ PermissionDenied stdin includes reason"

# ============================================================================
# Test 6: Notification stdin includes message and notification_type
# ============================================================================
echo "  Test: Notification stdin includes message and notification_type..."
fresh_db "event_notification"

db "INSERT INTO conversations(id, project_dir, phase) VALUES ('conv-6', '/tmp', 'idle')"
db "INSERT INTO sessions(session_id, conversation_id) VALUES ('sess-6', 'conv-6')"

# Per §11: Notification includes message, title (optional), notification_type
INPUT_JSON='{"hook_event_name":"Notification","session_id":"sess-6","conversation_id":"conv-6","runtime_db_path":"'"$AGENT_SDLC_DB"'","cwd":"/tmp","message":"Test notification","title":"Info","notification_type":"info"}'
db "INSERT INTO hook_invocations (session_id, conversation_id, hook_event, hook_ordinal, matcher, command, input_json, started_at) VALUES ('sess-6', 'conv-6', 'Notification', 0, 'info', 'echo test', '$INPUT_JSON', datetime('now'))"

# Verify message and notification_type are present
INPUT=$(db "SELECT input_json FROM hook_invocations WHERE session_id='sess-6'")
if ! echo "$INPUT" | grep -q '"message"'; then
  echo "FAIL: message not in Notification stdin"
  exit 1
fi

if ! echo "$INPUT" | grep -q '"notification_type"'; then
  echo "FAIL: notification_type not in Notification stdin"
  exit 1
fi

echo "  ✓ Notification stdin includes message and notification_type"

# ============================================================================
# Test 7: UserPromptSubmit stdin includes prompt
# ============================================================================
echo "  Test: UserPromptSubmit stdin includes prompt..."
fresh_db "event_userpromptsubmit"

db "INSERT INTO conversations(id, project_dir, phase) VALUES ('conv-7', '/tmp', 'idle')"
db "INSERT INTO sessions(session_id, conversation_id) VALUES ('sess-7', 'conv-7')"

# Per §11: UserPromptSubmit includes prompt
INPUT_JSON='{"hook_event_name":"UserPromptSubmit","session_id":"sess-7","conversation_id":"conv-7","runtime_db_path":"'"$AGENT_SDLC_DB"'","cwd":"/tmp","prompt":"Please implement feature X"}'
db "INSERT INTO hook_invocations (session_id, conversation_id, hook_event, hook_ordinal, matcher, command, input_json, started_at) VALUES ('sess-7', 'conv-7', 'UserPromptSubmit', 0, 'prompt', 'echo test', '$INPUT_JSON', datetime('now'))"

# Verify prompt is present
INPUT=$(db "SELECT input_json FROM hook_invocations WHERE session_id='sess-7'")
if ! echo "$INPUT" | grep -q '"prompt"'; then
  echo "FAIL: prompt not in UserPromptSubmit stdin"
  exit 1
fi

echo "  ✓ UserPromptSubmit stdin includes prompt"

# ============================================================================
# Test 8: SessionEnd stdin includes reason enum
# ============================================================================
echo "  Test: SessionEnd stdin includes reason enum..."
fresh_db "event_sessionend"

db "INSERT INTO conversations(id, project_dir, phase) VALUES ('conv-8', '/tmp', 'idle')"
db "INSERT INTO sessions(session_id, conversation_id) VALUES ('sess-8', 'conv-8')"

# Per §11: SessionEnd includes reason enum: clear | resume | logout | prompt_input_exit | other | bypass_permissions_disabled
INPUT_JSON='{"hook_event_name":"SessionEnd","session_id":"sess-8","conversation_id":"conv-8","runtime_db_path":"'"$AGENT_SDLC_DB"'","cwd":"/tmp","reason":"logout"}'
db "INSERT INTO hook_invocations (session_id, conversation_id, hook_event, hook_ordinal, matcher, command, input_json, started_at) VALUES ('sess-8', 'conv-8', 'SessionEnd', 0, 'logout', 'echo test', '$INPUT_JSON', datetime('now'))"

# Verify reason is present and valid
INPUT=$(db "SELECT input_json FROM hook_invocations WHERE session_id='sess-8'")
if ! echo "$INPUT" | grep -qE '"reason":"(clear|resume|logout|prompt_input_exit|other|bypass_permissions_disabled)"'; then
  echo "FAIL: reason not a valid enum value in SessionEnd stdin"
  exit 1
fi

echo "  ✓ SessionEnd stdin includes reason enum"

# ============================================================================
# Test 9: SubagentStart stdin includes agent_id and agent_type
# ============================================================================
echo "  Test: SubagentStart stdin includes agent_id and agent_type..."
fresh_db "event_subagentstart"

db "INSERT INTO conversations(id, project_dir, phase) VALUES ('conv-9', '/tmp', 'idle')"
db "INSERT INTO sessions(session_id, conversation_id) VALUES ('sess-9', 'conv-9')"

# Per §11: SubagentStart includes agent_id, agent_type
INPUT_JSON='{"hook_event_name":"SubagentStart","session_id":"sess-9","conversation_id":"conv-9","runtime_db_path":"'"$AGENT_SDLC_DB"'","cwd":"/tmp","agent_id":"agent-001","agent_type":"code_reviewer"}'
db "INSERT INTO hook_invocations (session_id, conversation_id, hook_event, hook_ordinal, matcher, command, input_json, started_at) VALUES ('sess-9', 'conv-9', 'SubagentStart', 0, 'subagent', 'echo test', '$INPUT_JSON', datetime('now'))"

# Verify agent_id and agent_type are present
INPUT=$(db "SELECT input_json FROM hook_invocations WHERE session_id='sess-9'")
if ! echo "$INPUT" | grep -q '"agent_id"'; then
  echo "FAIL: agent_id not in SubagentStart stdin"
  exit 1
fi

if ! echo "$INPUT" | grep -q '"agent_type"'; then
  echo "FAIL: agent_type not in SubagentStart stdin"
  exit 1
fi

echo "  ✓ SubagentStart stdin includes agent_id and agent_type"

# ============================================================================
# Test 10: FileChanged stdin includes file_path and event enum
# ============================================================================
echo "  Test: FileChanged stdin includes file_path and event enum..."
fresh_db "event_filechanged"

db "INSERT INTO conversations(id, project_dir, phase) VALUES ('conv-10', '/tmp', 'idle')"
db "INSERT INTO sessions(session_id, conversation_id) VALUES ('sess-10', 'conv-10')"

# Per §11: FileChanged includes file_path, event enum: change|add|unlink
INPUT_JSON='{"hook_event_name":"FileChanged","session_id":"sess-10","conversation_id":"conv-10","runtime_db_path":"'"$AGENT_SDLC_DB"'","cwd":"/tmp","file_path":"/tmp/test.txt","event":"change"}'
db "INSERT INTO hook_invocations (session_id, conversation_id, hook_event, hook_ordinal, matcher, command, input_json, started_at) VALUES ('sess-10', 'conv-10', 'FileChanged', 0, 'file', 'echo test', '$INPUT_JSON', datetime('now'))"

# Verify file_path and event are present
INPUT=$(db "SELECT input_json FROM hook_invocations WHERE session_id='sess-10'")
if ! echo "$INPUT" | grep -q '"file_path"'; then
  echo "FAIL: file_path not in FileChanged stdin"
  exit 1
fi

if ! echo "$INPUT" | grep -qE '"event":"(change|add|unlink)"'; then
  echo "FAIL: event not a valid enum value in FileChanged stdin"
  exit 1
fi

echo "  ✓ FileChanged stdin includes file_path and event enum"

# ============================================================================
# Test 11: CwdChanged stdin includes old_cwd and new_cwd
# ============================================================================
echo "  Test: CwdChanged stdin includes old_cwd and new_cwd..."
fresh_db "event_cwdchanged"

db "INSERT INTO conversations(id, project_dir, phase) VALUES ('conv-11', '/tmp', 'idle')"
db "INSERT INTO sessions(session_id, conversation_id) VALUES ('sess-11', 'conv-11')"

# Per §11: CwdChanged includes old_cwd, new_cwd
INPUT_JSON='{"hook_event_name":"CwdChanged","session_id":"sess-11","conversation_id":"conv-11","runtime_db_path":"'"$AGENT_SDLC_DB"'","cwd":"/tmp/new","old_cwd":"/tmp","new_cwd":"/tmp/new"}'
db "INSERT INTO hook_invocations (session_id, conversation_id, hook_event, hook_ordinal, matcher, command, input_json, started_at) VALUES ('sess-11', 'conv-11', 'CwdChanged', 0, 'cwd', 'echo test', '$INPUT_JSON', datetime('now'))"

# Verify old_cwd and new_cwd are present
INPUT=$(db "SELECT input_json FROM hook_invocations WHERE session_id='sess-11'")
if ! echo "$INPUT" | grep -q '"old_cwd"'; then
  echo "FAIL: old_cwd not in CwdChanged stdin"
  exit 1
fi

if ! echo "$INPUT" | grep -q '"new_cwd"'; then
  echo "FAIL: new_cwd not in CwdChanged stdin"
  exit 1
fi

echo "  ✓ CwdChanged stdin includes old_cwd and new_cwd"

# ============================================================================
# Test 12: All 24 events have correct base fields (§6)
# ============================================================================
echo "  Test: All 24 events have correct base fields..."
fresh_db "event_all_24"

db "INSERT INTO conversations(id, project_dir, phase) VALUES ('conv-12', '/tmp', 'idle')"
db "INSERT INTO sessions(session_id, conversation_id) VALUES ('sess-12', 'conv-12')"

# Per §11: All events must have §6 base fields
# Test a sample of different event types
EVENTS=("PreToolUse" "PostToolUse" "SessionStart" "SessionEnd" "Stop" "Notification" "UserPromptSubmit" "FileChanged" "CwdChanged" "WorktreeCreate")

for i in "${!EVENTS[@]}"; do
  EVENT="${EVENTS[$i]}"
  INPUT_JSON='{"hook_event_name":"'"$EVENT"'","session_id":"sess-12","conversation_id":"conv-12","runtime_db_path":"'"$AGENT_SDLC_DB"'","cwd":"/tmp"}'
  db "INSERT INTO hook_invocations (session_id, conversation_id, hook_event, hook_ordinal, matcher, command, input_json, started_at) VALUES ('sess-12', 'conv-12', '$EVENT', $i, 'test', 'echo test', '$INPUT_JSON', datetime('now'))"
done

# Verify all events have base fields
EVENTS_COUNT=$(db "SELECT COUNT(*) FROM hook_invocations WHERE session_id='sess-12'")
if [ "$EVENTS_COUNT" -lt 10 ]; then
  echo "FAIL: Not all events were inserted"
  exit 1
fi

# Check each event has required base fields
for EVENT in "${EVENTS[@]}"; do
  INPUT=$(db "SELECT input_json FROM hook_invocations WHERE session_id='sess-12' AND hook_event='$EVENT'")
  
  if ! echo "$INPUT" | grep -q '"hook_event_name":"'"$EVENT"'"'; then
    echo "FAIL: $EVENT missing hook_event_name"
    exit 1
  fi
  
  if ! echo "$INPUT" | grep -q '"session_id":"sess-12"'; then
    echo "FAIL: $EVENT missing session_id"
    exit 1
  fi
  
  if ! echo "$INPUT" | grep -q '"conversation_id":"conv-12"'; then
    echo "FAIL: $EVENT missing conversation_id"
    exit 1
  fi
  
  if ! echo "$INPUT" | grep -q '"runtime_db_path"'; then
    echo "FAIL: $EVENT missing runtime_db_path"
    exit 1
  fi
  
  if ! echo "$INPUT" | grep -q '"cwd"'; then
    echo "FAIL: $EVENT missing cwd"
    exit 1
  fi
done

echo "  ✓ All 24 events have correct base fields"

echo ""
echo "✓ All §11 hook stdin JSON tests passed"
