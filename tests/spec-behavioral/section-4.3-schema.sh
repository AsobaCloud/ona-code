#!/usr/bin/env bash
# §4.3 Unified DDL - All required tables and virtual tables must exist
# Validates: Requirements 2.1, 2.2, 2.3 from bugfix.md
# Tests that all tables from §4.3 DDL are present and memories_fts virtual table exists
set -euo pipefail

SCRIPT_DIR=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)
REPO_ROOT=$(cd "$SCRIPT_DIR/../.." && pwd)
ONA="$REPO_ROOT/bin/agent.mjs"
SPEC_TMP="${SPEC_TMP:-$(mktemp -d "${TMPDIR:-/tmp}/spec-behavioral-4.3.XXXXXX")}"

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

db() {
  sqlite3 -cmd ".output /dev/null" -cmd "PRAGMA foreign_keys=ON;" -cmd "PRAGMA busy_timeout=30000;" -cmd ".output stdout" "$AGENT_SDLC_DB" "$@"
}

export -f fresh_db db

echo "Testing §4.3 Unified DDL..."

# ============================================================================
# Test: All tables from §4.3 DDL present
# ============================================================================
echo "  Testing all tables from §4.3 DDL present..."

# Create a fresh database
fresh_db schema_4_3
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

# Get list of existing tables
EXISTING_TABLES=$(db ".tables")

# Check each required table exists
for table in "${REQUIRED_TABLES[@]}"; do
  if ! echo "$EXISTING_TABLES" | grep -q "$table"; then
    echo "FAIL: Required table '$table' missing from database"
    exit 1
  fi
done

echo "  ✓ All required tables present"

# ============================================================================
# Test: memories_fts virtual table exists
# ============================================================================
echo "  Testing memories_fts virtual table exists..."

# Verify memories_fts is a virtual table
MEMORIES_FTS_TYPE=$(db "SELECT type FROM sqlite_master WHERE name='memories_fts'" 2>/dev/null || echo "")
if [ "$MEMORIES_FTS_TYPE" != "table" ]; then
  echo "FAIL: memories_fts table not found"
  exit 1
fi

# Verify memories_fts is an FTS5 virtual table
MEMORIES_FTS_SQL=$(db "SELECT sql FROM sqlite_master WHERE name='memories_fts'" 2>/dev/null || echo "")
if ! echo "$MEMORIES_FTS_SQL" | grep -q "fts5"; then
  echo "FAIL: memories_fts is not an FTS5 virtual table"
  exit 1
fi

# Verify memories_fts has the required columns
# Expected columns: title, content, keywords, anticipated_queries
MEMORIES_FTS_COLUMNS=$(db "PRAGMA table_info(memories_fts)" 2>/dev/null || echo "")

# For FTS5 tables, we can test by inserting and searching
db "INSERT INTO memories(id, type, title, content, keywords, anticipated_queries, created_at, updated_at) 
    VALUES ('test_mem_1', 'concept', 'Test Title', 'Test content', 'tag1,tag2', 'query1', 1000, 1000)"

# Rebuild FTS index
db "DELETE FROM memories_fts; 
    INSERT INTO memories_fts(title, content, keywords, anticipated_queries)
    SELECT title, content, keywords, anticipated_queries FROM memories"

# Verify we can search the FTS table
SEARCH_RESULT=$(db "SELECT COUNT(*) FROM memories_fts WHERE memories_fts MATCH 'Test'" 2>/dev/null || echo "0")
if [ "$SEARCH_RESULT" != "1" ]; then
  echo "FAIL: Cannot search memories_fts virtual table"
  exit 1
fi

echo "  ✓ memories_fts virtual table exists and is functional"

echo ""
echo "✓ All §4.3 unified DDL tests passed"
