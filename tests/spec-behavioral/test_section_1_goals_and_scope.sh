#!/usr/bin/env bash
# §1 Goals and scope - Core system architecture validation
set -euo pipefail

fresh_db goals_and_scope_1

echo "Testing §1 Goals and scope..."

# Test 1: Auditability tables exist (hook_invocations, transcript_entries, events)
AUDIT_TABLES=$(db ".tables" | grep -E "(hook_invocations|transcript_entries|events)" | wc -l)
test "$AUDIT_TABLES" -eq 3 || {
  echo "FAIL: Missing auditability tables (hook_invocations, transcript_entries, events)"
  exit 1
}

# Test 2: SDLC phase enforcement via conversations.phase
PHASE_COLUMN=$(db "PRAGMA table_info(conversations)" | grep "phase")
test -n "$PHASE_COLUMN" || {
  echo "FAIL: conversations table missing phase column for SDLC enforcement"
  exit 1
}

# Test 3: Determinism - SQLite authority (no authoritative JSONL files in codebase)
JSONL_COUNT=$(find . -name "*.jsonl" -not -path "./node_modules/*" 2>/dev/null | wc -l)
test "$JSONL_COUNT" -eq 0 || {
  echo "FAIL: Found $JSONL_COUNT JSONL files - violates SQLite authority requirement"
  exit 1
}

# Test 4: Model orchestration spine - provider/model config structure
db "INSERT OR REPLACE INTO settings_snapshot(scope, json, updated_at) VALUES ('effective', '{\"model_config\":{\"provider\":\"claude_code_subscription\",\"model_id\":\"claude_sonnet_4\"}}', datetime('now'))"
MODEL_CONFIG=$(db "SELECT json FROM settings_snapshot WHERE scope='effective'" | grep -o '"model_config":{[^}]*}')
test -n "$MODEL_CONFIG" || {
  echo "FAIL: Cannot store model orchestration config in settings_snapshot"
  exit 1
}

echo "✓ Goals and scope architecture validated"