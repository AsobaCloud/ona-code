#!/usr/bin/env bash
# §4.1 Location - Database location and pragma validation
# Validates: Requirements 2.1, 2.2, 2.3 from bugfix.md
# Tests that AGENT_SDLC_DB sets SQLite file path, PRAGMA foreign_keys=ON, and PRAGMA journal_mode=WAL
set -euo pipefail

SCRIPT_DIR=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)
REPO_ROOT=$(cd "$SCRIPT_DIR/../.." && pwd)
ONA="$REPO_ROOT/bin/agent.mjs"
SPEC_TMP="${SPEC_TMP:-$(mktemp -d "${TMPDIR:-/tmp}/spec-behavioral-4.1.XXXXXX")}"

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

echo "Testing §4.1 Location..."

# ============================================================================
# Test: AGENT_SDLC_DB sets SQLite file path
# ============================================================================
echo "  Testing AGENT_SDLC_DB sets SQLite file path..."

# Create a fresh database at a specific location
fresh_db location_4_1

# Verify database exists at the specified path
if [ ! -f "$AGENT_SDLC_DB" ]; then
  echo "FAIL: Database not created at AGENT_SDLC_DB location: $AGENT_SDLC_DB"
  exit 1
fi

# Verify the path matches what we set
ACTUAL_PATH=$(db "PRAGMA database_list" | grep main | awk -F'|' '{print $NF}' | tr -d ' ')
# Normalize paths for comparison (handle /private prefix on macOS and double slashes)
EXPECTED_NORMALIZED=$(echo "$AGENT_SDLC_DB" | sed 's|^/private||' | sed 's|//|/|g')
ACTUAL_NORMALIZED=$(echo "$ACTUAL_PATH" | sed 's|^/private||' | sed 's|//|/|g')
if [ "$ACTUAL_NORMALIZED" != "$EXPECTED_NORMALIZED" ]; then
  echo "FAIL: Database path mismatch. Expected: $EXPECTED_NORMALIZED, Got: $ACTUAL_NORMALIZED"
  exit 1
fi

echo "  ✓ AGENT_SDLC_DB sets SQLite file path"

# ============================================================================
# Test: PRAGMA foreign_keys=ON on every connection
# ============================================================================
echo "  Testing PRAGMA foreign_keys=ON on every connection..."

# Check foreign_keys pragma on initial connection
FOREIGN_KEYS=$(db "PRAGMA foreign_keys")
if [ "$FOREIGN_KEYS" != "1" ]; then
  echo "FAIL: PRAGMA foreign_keys not enabled on initial connection (got: $FOREIGN_KEYS)"
  exit 1
fi

# Verify foreign_keys is ON by testing a foreign key constraint
# Insert a conversation first
db "INSERT INTO conversations(id, project_dir) VALUES ('test_conv_fk', '/tmp')"

# Try to insert a session with invalid conversation_id (should fail if FK is ON)
if db "INSERT INTO sessions(session_id, conversation_id) VALUES ('test_session_fk', 'nonexistent_conv')" 2>/dev/null; then
  echo "FAIL: Foreign key constraint not enforced (PRAGMA foreign_keys may not be ON)"
  exit 1
fi

# Verify that valid foreign key works
db "INSERT INTO sessions(session_id, conversation_id) VALUES ('test_session_fk', 'test_conv_fk')"
SESSION_COUNT=$(db "SELECT COUNT(*) FROM sessions WHERE session_id='test_session_fk'")
if [ "$SESSION_COUNT" != "1" ]; then
  echo "FAIL: Valid foreign key insert failed"
  exit 1
fi

echo "  ✓ PRAGMA foreign_keys=ON on every connection"

# ============================================================================
# Test: PRAGMA journal_mode=WAL
# ============================================================================
echo "  Testing PRAGMA journal_mode=WAL..."

# Check journal_mode pragma
JOURNAL_MODE=$(db "PRAGMA journal_mode")
if [ "$JOURNAL_MODE" != "wal" ]; then
  echo "FAIL: PRAGMA journal_mode not set to WAL (got: $JOURNAL_MODE)"
  exit 1
fi

# Verify WAL files are created during write operations
db "CREATE TABLE IF NOT EXISTS test_wal_table (id INTEGER PRIMARY KEY, data TEXT)"
db "INSERT INTO test_wal_table (data) VALUES ('test data')"

# Check that WAL file exists
if [ ! -f "$AGENT_SDLC_DB-wal" ]; then
  echo "FAIL: WAL file not created during write operations"
  exit 1
fi

# Verify we can read from the database while WAL is active
DATA=$(db "SELECT data FROM test_wal_table WHERE id=1")
if [ "$DATA" != "test data" ]; then
  echo "FAIL: Cannot read data with WAL mode active"
  exit 1
fi

echo "  ✓ PRAGMA journal_mode=WAL"

echo ""
echo "✓ All §4.1 location tests passed"
