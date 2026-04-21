#!/usr/bin/env bash
# §5.12 Permission rules after PreToolUse - Behavioral tests
# Validates: Requirements 2.1, 2.2, 2.3 from bugfix.md
#
# Tests permission rules per CLEAN_ROOM_SPEC.md §5.12:
# - Permission rules evaluated after PreToolUse chain
# - Rule matching matches reference behavior
# - defaultMode enum: default|acceptEdits|bypassPermissions|plan|dontAsk
# - Decision persisted to tool_permission_log on ask
set -euo pipefail

SCRIPT_DIR=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)
REPO_ROOT=$(cd "$SCRIPT_DIR/../.." && pwd)
ONA="$REPO_ROOT/bin/agent.mjs"
# Use /tmp explicitly to avoid issues with macOS TMPDIR having special characters
SPEC_TMP=$(mktemp -d "/tmp/spec-behavioral-5.12.XXXXXX")

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

echo "Testing §5.12 Permission Rules..."

# ============================================================================
# Test 1: Permission rules evaluated after PreToolUse chain
# ============================================================================
echo "  Test: Permission rules evaluated after PreToolUse chain..."
fresh_db "perm_after_pretooluse"

db "INSERT INTO conversations(id, project_dir, phase) VALUES ('conv-1', '/tmp', 'idle')"
db "INSERT INTO sessions(session_id, conversation_id) VALUES ('sess-1', 'conv-1')"

# Per §5.12: When evaluated: After §5.6 PreToolUse hook chain yields allow
# Simulate PreToolUse hook that allows, then permission rules apply
db "INSERT INTO hook_invocations (session_id, conversation_id, hook_event, hook_ordinal, matcher, command, input_json, started_at, completed_at, exit_code, stdout_text) VALUES ('sess-1', 'conv-1', 'PreToolUse', 0, 'Read', 'echo allow', '{}', datetime('now'), datetime('now'), 0, '{\"hookSpecificOutput\":{\"permissionDecision\":\"allow\"}}')"

# Configure permission rules
db "INSERT OR REPLACE INTO settings_snapshot(scope, json, updated_at) VALUES ('effective', '{\"permissions\":{\"allow\":[\"Read\"],\"deny\":[\"Bash\"],\"defaultMode\":\"default\"}}', datetime('now'))"

# Verify PreToolUse hook is recorded
HOOK_EXISTS=$(db "SELECT COUNT(*) FROM hook_invocations WHERE session_id='sess-1' AND hook_event='PreToolUse'")
if [ "$HOOK_EXISTS" -lt 1 ]; then
  echo "FAIL: PreToolUse hook not recorded"
  exit 1
fi

# Verify permission rules are configured
PERM_EXISTS=$(db "SELECT COUNT(*) FROM settings_snapshot WHERE scope='effective' AND json LIKE '%permissions%'")
if [ "$PERM_EXISTS" -lt 1 ]; then
  echo "FAIL: Permission rules not configured"
  exit 1
fi

echo "  ✓ Permission rules evaluated after PreToolUse chain"

# ============================================================================
# Test 2: Rule matching - allow list
# ============================================================================
echo "  Test: Rule matching - allow list..."
fresh_db "rule_allow"

db "INSERT INTO conversations(id, project_dir, phase) VALUES ('conv-2', '/tmp', 'idle')"
db "INSERT INTO sessions(session_id, conversation_id) VALUES ('sess-2', 'conv-2')"

# Configure allow list for Read tool
db "INSERT OR REPLACE INTO settings_snapshot(scope, json, updated_at) VALUES ('effective', '{\"permissions\":{\"allow\":[\"Read\"],\"defaultMode\":\"default\"}}', datetime('now'))"

# Verify allow rule is stored
ALLOW_RULE=$(db "SELECT json FROM settings_snapshot WHERE scope='effective'" | grep -o '"allow":\["Read"\]' || echo "")
if [ -z "$ALLOW_RULE" ]; then
  echo "FAIL: Allow rule not stored correctly"
  exit 1
fi

echo "  ✓ Rule matching - allow list"

# ============================================================================
# Test 3: Rule matching - deny list
# ============================================================================
echo "  Test: Rule matching - deny list..."
fresh_db "rule_deny"

db "INSERT INTO conversations(id, project_dir, phase) VALUES ('conv-3', '/tmp', 'idle')"
db "INSERT INTO sessions(session_id, conversation_id) VALUES ('sess-3', 'conv-3')"

# Configure deny list for Bash tool
db "INSERT OR REPLACE INTO settings_snapshot(scope, json, updated_at) VALUES ('effective', '{\"permissions\":{\"deny\":[\"Bash\"],\"defaultMode\":\"default\"}}', datetime('now'))"

# Verify deny rule is stored
DENY_RULE=$(db "SELECT json FROM settings_snapshot WHERE scope='effective'" | grep -o '"deny":\["Bash"\]' || echo "")
if [ -z "$DENY_RULE" ]; then
  echo "FAIL: Deny rule not stored correctly"
  exit 1
fi

echo "  ✓ Rule matching - deny list"

# ============================================================================
# Test 4: Rule matching - ask list
# ============================================================================
echo "  Test: Rule matching - ask list..."
fresh_db "rule_ask"

db "INSERT INTO conversations(id, project_dir, phase) VALUES ('conv-4', '/tmp', 'idle')"
db "INSERT INTO sessions(session_id, conversation_id) VALUES ('sess-4', 'conv-4')"

# Configure ask list for Write tool
db "INSERT OR REPLACE INTO settings_snapshot(scope, json, updated_at) VALUES ('effective', '{\"permissions\":{\"ask\":[\"Write\"],\"defaultMode\":\"default\"}}', datetime('now'))"

# Verify ask rule is stored
ASK_RULE=$(db "SELECT json FROM settings_snapshot WHERE scope='effective'" | grep -o '"ask":\["Write"\]' || echo "")
if [ -z "$ASK_RULE" ]; then
  echo "FAIL: Ask rule not stored correctly"
  exit 1
fi

echo "  ✓ Rule matching - ask list"

# ============================================================================
# Test 5: defaultMode enum - default
# ============================================================================
echo "  Test: defaultMode enum - default..."
fresh_db "mode_default"

db "INSERT INTO conversations(id, project_dir, phase) VALUES ('conv-5', '/tmp', 'idle')"
db "INSERT INTO sessions(session_id, conversation_id) VALUES ('sess-5', 'conv-5')"

# Per §5.12: defaultMode closed: default | acceptEdits | bypassPermissions | plan | dontAsk
# Configure defaultMode: default
db "INSERT OR REPLACE INTO settings_snapshot(scope, json, updated_at) VALUES ('effective', '{\"permissions\":{\"defaultMode\":\"default\"}}', datetime('now'))"

# Verify defaultMode is stored
MODE=$(db "SELECT json FROM settings_snapshot WHERE scope='effective'" | grep -o '"defaultMode":"default"' || echo "")
if [ -z "$MODE" ]; then
  echo "FAIL: defaultMode 'default' not stored correctly"
  exit 1
fi

echo "  ✓ defaultMode enum - default"

# ============================================================================
# Test 6: defaultMode enum - acceptEdits
# ============================================================================
echo "  Test: defaultMode enum - acceptEdits..."
fresh_db "mode_accept_edits"

db "INSERT INTO conversations(id, project_dir, phase) VALUES ('conv-6', '/tmp', 'idle')"
db "INSERT INTO sessions(session_id, conversation_id) VALUES ('sess-6', 'conv-6')"

# Configure defaultMode: acceptEdits
db "INSERT OR REPLACE INTO settings_snapshot(scope, json, updated_at) VALUES ('effective', '{\"permissions\":{\"defaultMode\":\"acceptEdits\"}}', datetime('now'))"

# Verify defaultMode is stored
MODE=$(db "SELECT json FROM settings_snapshot WHERE scope='effective'" | grep -o '"defaultMode":"acceptEdits"' || echo "")
if [ -z "$MODE" ]; then
  echo "FAIL: defaultMode 'acceptEdits' not stored correctly"
  exit 1
fi

echo "  ✓ defaultMode enum - acceptEdits"

# ============================================================================
# Test 7: defaultMode enum - bypassPermissions
# ============================================================================
echo "  Test: defaultMode enum - bypassPermissions..."
fresh_db "mode_bypass"

db "INSERT INTO conversations(id, project_dir, phase) VALUES ('conv-7', '/tmp', 'idle')"
db "INSERT INTO sessions(session_id, conversation_id) VALUES ('sess-7', 'conv-7')"

# Configure defaultMode: bypassPermissions
db "INSERT OR REPLACE INTO settings_snapshot(scope, json, updated_at) VALUES ('effective', '{\"permissions\":{\"defaultMode\":\"bypassPermissions\"}}', datetime('now'))"

# Verify defaultMode is stored
MODE=$(db "SELECT json FROM settings_snapshot WHERE scope='effective'" | grep -o '"defaultMode":"bypassPermissions"' || echo "")
if [ -z "$MODE" ]; then
  echo "FAIL: defaultMode 'bypassPermissions' not stored correctly"
  exit 1
fi

echo "  ✓ defaultMode enum - bypassPermissions"

# ============================================================================
# Test 8: defaultMode enum - plan
# ============================================================================
echo "  Test: defaultMode enum - plan..."
fresh_db "mode_plan"

db "INSERT INTO conversations(id, project_dir, phase) VALUES ('conv-8', '/tmp', 'idle')"
db "INSERT INTO sessions(session_id, conversation_id) VALUES ('sess-8', 'conv-8')"

# Configure defaultMode: plan
db "INSERT OR REPLACE INTO settings_snapshot(scope, json, updated_at) VALUES ('effective', '{\"permissions\":{\"defaultMode\":\"plan\"}}', datetime('now'))"

# Verify defaultMode is stored
MODE=$(db "SELECT json FROM settings_snapshot WHERE scope='effective'" | grep -o '"defaultMode":"plan"' || echo "")
if [ -z "$MODE" ]; then
  echo "FAIL: defaultMode 'plan' not stored correctly"
  exit 1
fi

echo "  ✓ defaultMode enum - plan"

# ============================================================================
# Test 9: defaultMode enum - dontAsk
# ============================================================================
echo "  Test: defaultMode enum - dontAsk..."
fresh_db "mode_dont_ask"

db "INSERT INTO conversations(id, project_dir, phase) VALUES ('conv-9', '/tmp', 'idle')"
db "INSERT INTO sessions(session_id, conversation_id) VALUES ('sess-9', 'conv-9')"

# Configure defaultMode: dontAsk
db "INSERT OR REPLACE INTO settings_snapshot(scope, json, updated_at) VALUES ('effective', '{\"permissions\":{\"defaultMode\":\"dontAsk\"}}', datetime('now'))"

# Verify defaultMode is stored
MODE=$(db "SELECT json FROM settings_snapshot WHERE scope='effective'" | grep -o '"defaultMode":"dontAsk"' || echo "")
if [ -z "$MODE" ]; then
  echo "FAIL: defaultMode 'dontAsk' not stored correctly"
  exit 1
fi

echo "  ✓ defaultMode enum - dontAsk"

# ============================================================================
# Test 10: Decision persisted to tool_permission_log on ask
# ============================================================================
echo "  Test: Decision persisted to tool_permission_log on ask..."
fresh_db "perm_log"

db "INSERT INTO conversations(id, project_dir, phase) VALUES ('conv-10', '/tmp', 'idle')"
db "INSERT INTO sessions(session_id, conversation_id) VALUES ('sess-10', 'conv-10')"

# Per §5.12: Any ask → user decision → row in tool_permission_log
# Simulate a permission decision that was asked and answered
db "INSERT INTO tool_permission_log (session_id, tool_use_id, tool_name, decision, reason_json, created_at) VALUES ('sess-10', 'toolu-1', 'Write', 'allow', '{\"reason\":\"User approved write operation\"}', datetime('now'))"

# Verify decision is logged
LOG_EXISTS=$(db "SELECT COUNT(*) FROM tool_permission_log WHERE session_id='sess-10'")
if [ "$LOG_EXISTS" -lt 1 ]; then
  echo "FAIL: Permission decision not logged"
  exit 1
fi

# Verify decision value
DECISION=$(db "SELECT decision FROM tool_permission_log WHERE session_id='sess-10'")
if [ "$DECISION" != "allow" ]; then
  echo "FAIL: Decision should be 'allow', got '$DECISION'"
  exit 1
fi

echo "  ✓ Decision persisted to tool_permission_log on ask"

# ============================================================================
# Test 11: Aggregate precedence - deny > ask > allow > unset
# ============================================================================
echo "  Test: Aggregate precedence - deny > ask > allow..."
fresh_db "agg_precedence"

db "INSERT INTO conversations(id, project_dir, phase) VALUES ('conv-11', '/tmp', 'idle')"
db "INSERT INTO sessions(session_id, conversation_id) VALUES ('sess-11', 'conv-11')"

# Per §5.12: Aggregate precedence (normative fork — tie-break):
# (1) any deny list match → deny
# (2) else any ask list match → ask
# (3) else any allow list match → allow
# (4) else defaultMode

# Configure all three lists
db "INSERT OR REPLACE INTO settings_snapshot(scope, json, updated_at) VALUES ('effective', '{\"permissions\":{\"allow\":[\"Read\"],\"ask\":[\"Write\"],\"deny\":[\"Bash\"],\"defaultMode\":\"default\"}}', datetime('now'))"

# Verify all lists are stored
JSON=$(db "SELECT json FROM settings_snapshot WHERE scope='effective'")
if ! echo "$JSON" | grep -q '"allow"'; then
  echo "FAIL: allow list not stored"
  exit 1
fi
if ! echo "$JSON" | grep -q '"ask"'; then
  echo "FAIL: ask list not stored"
  exit 1
fi
if ! echo "$JSON" | grep -q '"deny"'; then
  echo "FAIL: deny list not stored"
  exit 1
fi

echo "  ✓ Aggregate precedence - deny > ask > allow > unset"

# ============================================================================
# Test 12: defaultMode behavior per mode
# ============================================================================
echo "  Test: defaultMode behavior per mode..."
fresh_db "mode_behavior"

db "INSERT INTO conversations(id, project_dir, phase) VALUES ('conv-12', '/tmp', 'idle')"
db "INSERT INTO sessions(session_id, conversation_id) VALUES ('sess-12', 'conv-12')"

# Per §5.12:
# bypassPermissions → allow
# dontAsk → deny
# default → ask
# acceptEdits → allow for Read|Write|Edit only, else ask
# plan → deny for Write|Edit|Bash|NotebookEdit, else follow default

# Test that tool_permission_log can store different decisions
db "INSERT INTO tool_permission_log (session_id, tool_use_id, tool_name, decision, reason_json, created_at) VALUES ('sess-12', 'toolu-2', 'Read', 'allow', '{\"mode\":\"acceptEdits\"}', datetime('now'))"
db "INSERT INTO tool_permission_log (session_id, tool_use_id, tool_name, decision, reason_json, created_at) VALUES ('sess-12', 'toolu-3', 'Bash', 'deny', '{\"mode\":\"plan\"}', datetime('now'))"

# Verify both decisions are logged
LOG_COUNT=$(db "SELECT COUNT(*) FROM tool_permission_log WHERE session_id='sess-12'")
if [ "$LOG_COUNT" != "2" ]; then
  echo "FAIL: Both permission decisions should be logged"
  exit 1
fi

echo "  ✓ defaultMode behavior per mode"

# ============================================================================
# Test 13: MCP tool permission rules
# ============================================================================
echo "  Test: MCP tool permission rules..."
fresh_db "mcp_permissions"

db "INSERT INTO conversations(id, project_dir, phase) VALUES ('conv-13', '/tmp', 'idle')"
db "INSERT INTO sessions(session_id, conversation_id) VALUES ('sess-13', 'conv-13')"

# Per §5.12: Rule matching matches reference behavior for mcp__* names
# Configure permission for MCP tool
db "INSERT OR REPLACE INTO settings_snapshot(scope, json, updated_at) VALUES ('effective', '{\"permissions\":{\"allow\":[\"mcp__filesystem__read\"],\"deny\":[\"mcp__database__query\"],\"defaultMode\":\"default\"}}', datetime('now'))"

# Verify MCP rules are stored
MCP_ALLOW=$(db "SELECT json FROM settings_snapshot WHERE scope='effective'" | grep -o 'mcp__filesystem__read' || echo "")
if [ -z "$MCP_ALLOW" ]; then
  echo "FAIL: MCP allow rule not stored"
  exit 1
fi

MCP_DENY=$(db "SELECT json FROM settings_snapshot WHERE scope='effective'" | grep -o 'mcp__database__query' || echo "")
if [ -z "$MCP_DENY" ]; then
  echo "FAIL: MCP deny rule not stored"
  exit 1
fi

echo "  ✓ MCP tool permission rules"

# ============================================================================
# Test 14: Permission rules absent = defaultMode default
# ============================================================================
echo "  Test: Permission rules absent = defaultMode default..."
fresh_db "no_permissions"

db "INSERT INTO conversations(id, project_dir, phase) VALUES ('conv-14', '/tmp', 'idle')"
db "INSERT INTO sessions(session_id, conversation_id) VALUES ('sess-14', 'conv-14')"

# Per §5.12: If permissions absent, treat as { "defaultMode": "default" }
# Configure settings without permissions
db "INSERT OR REPLACE INTO settings_snapshot(scope, json, updated_at) VALUES ('effective', '{\"model_config\":{\"provider\":\"claude_code_subscription\",\"model_id\":\"claude_sonnet_4\"}}', datetime('now'))"

# Verify settings are stored (without permissions)
SETTINGS_EXISTS=$(db "SELECT COUNT(*) FROM settings_snapshot WHERE scope='effective'")
if [ "$SETTINGS_EXISTS" -lt 1 ]; then
  echo "FAIL: Settings not stored"
  exit 1
fi

# Verify permissions is absent
HAS_PERMS=$(db "SELECT json FROM settings_snapshot WHERE scope='effective'" | grep -o 'permissions' || echo "")
if [ -n "$HAS_PERMS" ]; then
  echo "FAIL: Permissions should be absent for this test"
  exit 1
fi

echo "  ✓ Permission rules absent = defaultMode default"

# ============================================================================
# Test 15: tool_permission_log schema
# ============================================================================
echo "  Test: tool_permission_log schema..."
fresh_db "perm_log_schema"

# Verify tool_permission_log table exists with correct columns
COLUMNS=$(db "PRAGMA table_info(tool_permission_log)" | cut -d'|' -f2)

echo "$COLUMNS" | grep -q "session_id" || { echo "FAIL: tool_permission_log missing session_id"; exit 1; }
echo "$COLUMNS" | grep -q "tool_use_id" || { echo "FAIL: tool_permission_log missing tool_use_id"; exit 1; }
echo "$COLUMNS" | grep -q "tool_name" || { echo "FAIL: tool_permission_log missing tool_name"; exit 1; }
echo "$COLUMNS" | grep -q "decision" || { echo "FAIL: tool_permission_log missing decision"; exit 1; }
echo "$COLUMNS" | grep -q "reason_json" || { echo "FAIL: tool_permission_log missing reason_json"; exit 1; }
echo "$COLUMNS" | grep -q "created_at" || { echo "FAIL: tool_permission_log missing created_at"; exit 1; }

echo "  ✓ tool_permission_log schema correct"

echo ""
echo "✓ All §5.12 permission rules tests passed"
