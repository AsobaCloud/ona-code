#!/usr/bin/env bash
# §4.2 Schema version - Schema metadata validation
set -euo pipefail

fresh_db schema_version_4_2

echo "Testing §4.2 Schema version..."

# Test 1: schema_meta table exists
SCHEMA_META_EXISTS=$(db "SELECT name FROM sqlite_master WHERE type='table' AND name='schema_meta'")
test "$SCHEMA_META_EXISTS" = "schema_meta" || {
  echo "FAIL: schema_meta table missing"
  exit 1
}

# Test 2: schema_meta has correct structure
SCHEMA_META_STRUCTURE=$(db "PRAGMA table_info(schema_meta)")

# Check for key column (TEXT PRIMARY KEY)
echo "$SCHEMA_META_STRUCTURE" | grep -q "key.*TEXT.*0.*.*1" || {
  echo "FAIL: schema_meta missing key TEXT PRIMARY KEY column"
  exit 1
}

# Check for value column (TEXT NOT NULL)
echo "$SCHEMA_META_STRUCTURE" | grep -q "value.*TEXT.*1.*0" || {
  echo "FAIL: schema_meta missing value TEXT NOT NULL column"
  exit 1
}

# Test 3: schema_version key exists and has correct value
SCHEMA_VERSION=$(db "SELECT value FROM schema_meta WHERE key='schema_version'" 2>/dev/null || echo "")
test "$SCHEMA_VERSION" = "1" || {
  echo "FAIL: schema_version should be '1', got '$SCHEMA_VERSION'"
  exit 1
}

# Test 4: Can insert/update schema_meta entries
db "INSERT OR REPLACE INTO schema_meta(key, value) VALUES ('test_key', 'test_value')"
TEST_VALUE=$(db "SELECT value FROM schema_meta WHERE key='test_key'")
test "$TEST_VALUE" = "test_value" || {
  echo "FAIL: Cannot insert/retrieve from schema_meta"
  exit 1
}

# Test 5: Primary key constraint works
db "INSERT OR REPLACE INTO schema_meta(key, value) VALUES ('test_key', 'new_value')"
UPDATED_VALUE=$(db "SELECT value FROM schema_meta WHERE key='test_key'")
test "$UPDATED_VALUE" = "new_value" || {
  echo "FAIL: Primary key constraint not working (should replace existing key)"
  exit 1
}

# Test 6: NOT NULL constraint on value
if db "INSERT INTO schema_meta(key, value) VALUES ('null_test', NULL)" 2>/dev/null; then
  echo "FAIL: Should not allow NULL values in value column"
  exit 1
fi

echo "✓ Schema version mechanism validated"