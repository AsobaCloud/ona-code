#!/usr/bin/env bash
# §4.1 Location - Database location and pragma validation
set -euo pipefail

fresh_db location_4_1

echo "Testing §4.1 Location..."

# Test 1: Database exists at expected location
test -f "$AGENT_SDLC_DB" || {
  echo "FAIL: Database not created at AGENT_SDLC_DB location"
  exit 1
}

# Test 2: Required pragmas are set correctly
# Check foreign_keys pragma
FOREIGN_KEYS=$(db "PRAGMA foreign_keys")
test "$FOREIGN_KEYS" = "1" || {
  echo "FAIL: PRAGMA foreign_keys not enabled (got: $FOREIGN_KEYS)"
  exit 1
}

# Check journal_mode pragma  
JOURNAL_MODE=$(db "PRAGMA journal_mode")
test "$JOURNAL_MODE" = "wal" || {
  echo "FAIL: PRAGMA journal_mode not set to WAL (got: $JOURNAL_MODE)"
  exit 1
}

# Test 3: Database is valid SQLite file
SQLITE_VERSION=$(db "SELECT sqlite_version()" 2>/dev/null || echo "")
test -n "$SQLITE_VERSION" || {
  echo "FAIL: Database is not a valid SQLite file"
  exit 1
}

# Test 4: Database file permissions and accessibility
test -r "$AGENT_SDLC_DB" || {
  echo "FAIL: Database file not readable"
  exit 1
}
test -w "$AGENT_SDLC_DB" || {
  echo "FAIL: Database file not writable"
  exit 1
}

# Test 5: WAL files can be created (test write capability)
db "CREATE TABLE IF NOT EXISTS test_wal (id INTEGER PRIMARY KEY)"
db "INSERT INTO test_wal (id) VALUES (1)"
test -f "$AGENT_SDLC_DB-wal" || {
  echo "FAIL: WAL file not created during write operations"
  exit 1
}

echo "✓ Database location and pragmas validated"