#!/usr/bin/env bash
# §4.3 Unified DDL - All required tables must exist with correct structure
set -euo pipefail

fresh_db database_schema_4_3

echo "Testing §4.3 Database schema requirements..."

# Test 1: All required tables exist
REQUIRED_TABLES=(
  "schema_meta"
  "conversations" 
  "sessions"
  "state"
  "plans"
  "summaries"
  "events"
  "task_ratings"
  "memories"
  "memories_fts"
  "transcript_entries"
  "hook_invocations"
  "tool_permission_log"
  "settings_snapshot"
)

EXISTING_TABLES=$(db ".tables")
for table in "${REQUIRED_TABLES[@]}"; do
  echo "$EXISTING_TABLES" | grep -q "$table" || {
    echo "FAIL: Required table '$table' missing"
    exit 1
  }
done

# Test 2: schema_meta has correct initial value
SCHEMA_VERSION=$(db "SELECT value FROM schema_meta WHERE key='schema_version'" 2>/dev/null || echo "")
test "$SCHEMA_VERSION" = "1" || {
  echo "FAIL: schema_version should be '1', got '$SCHEMA_VERSION'"
  exit 1
}

# Test 3: Foreign keys are enabled
FK_STATUS=$(db "PRAGMA foreign_keys")
test "$FK_STATUS" = "1" || {
  echo "FAIL: Foreign keys not enabled"
  exit 1
}

# Test 4: Journal mode is WAL
JOURNAL_MODE=$(db "PRAGMA journal_mode")
test "$JOURNAL_MODE" = "wal" || {
  echo "FAIL: Journal mode should be 'wal', got '$JOURNAL_MODE'"
  exit 1
}

# Test 5: Busy timeout is set correctly
BUSY_TIMEOUT=$(db "PRAGMA busy_timeout")
test "$BUSY_TIMEOUT" = "30000" || {
  echo "FAIL: Busy timeout should be 30000, got '$BUSY_TIMEOUT'"
  exit 1
}

# Test 6: Key table structures have required columns
# conversations table
CONV_COLUMNS=$(db "PRAGMA table_info(conversations)" | cut -d'|' -f2)
echo "$CONV_COLUMNS" | grep -q "id" || { echo "FAIL: conversations missing id column"; exit 1; }
echo "$CONV_COLUMNS" | grep -q "phase" || { echo "FAIL: conversations missing phase column"; exit 1; }

# transcript_entries table  
TRANSCRIPT_COLUMNS=$(db "PRAGMA table_info(transcript_entries)" | cut -d'|' -f2)
echo "$TRANSCRIPT_COLUMNS" | grep -q "entry_type" || { echo "FAIL: transcript_entries missing entry_type"; exit 1; }
echo "$TRANSCRIPT_COLUMNS" | grep -q "payload_json" || { echo "FAIL: transcript_entries missing payload_json"; exit 1; }

echo "✓ Database schema matches §4.3 requirements"