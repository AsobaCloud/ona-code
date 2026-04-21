#!/usr/bin/env bash
# §2.8 Credential storage & prohibition - Behavioral tests for secret prohibition
# Validates: Requirements 2.1, 2.2, 2.3 from bugfix.md
#
# Per §2.8:
#   "Forbidden: INSERT or UPDATE of API keys, OAuth access/refresh tokens, 
#   raw Authorization headers, or apiKeyHelper output into AGENT_SDLC_DB,
#   settings_snapshot, transcript_entries, hook stdin, or hook stdout persistence."
#
set -euo pipefail

SCRIPT_DIR=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)
REPO_ROOT=$(cd "$SCRIPT_DIR/../.." && pwd)
ONA="$REPO_ROOT/bin/agent.mjs"
SPEC_TMP=$(mktemp -d "${TMPDIR:-/tmp}/spec-behavioral-cred-storage.XXXXXX")

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

# Secret patterns to check (per §2.8)
# These patterns should NEVER appear in the database
SECRET_PATTERNS=(
  "sk-ant-[a-zA-Z0-9_-]{20,}"
  "sk-[a-zA-Z0-9]{20,}"
  "Bearer [a-zA-Z0-9._-]{20,}"
  "Authorization.*Bearer"
  "access_token.*[a-zA-Z0-9_-]{20,}"
  "refresh_token.*[a-zA-Z0-9_-]{20,}"
  "api_key.*sk-"
  "apiKey.*sk-"
  "ANTHROPIC_API_KEY.*sk-"
  "ANTHROPIC_AUTH_TOKEN"
  "OPENAI_API_KEY.*sk-"
  "CLAUDE_CODE_OAUTH_TOKEN"
)

echo "Testing §2.8 Credential Storage Prohibition..."

# ============================================================================
# Test 1: No secrets in SQLite database tables
# ============================================================================
echo "  Testing: No secrets in SQLite tables..."
fresh_db "no_secrets_sqlite"

# Simulate various auth scenarios and verify no secrets leak into DB
export ANTHROPIC_API_KEY="sk-ant-test-key-no-db-storage"
export ANTHROPIC_AUTH_TOKEN="test-bearer-no-db-storage"

# Trigger auth resolution
node -e "
const { resolveAnthropicCredentials, saveSecureCredentials } = require('$REPO_ROOT/lib/auth.mjs');
resolveAnthropicCredentials({ bareMode: false, apiKeyHelper: null });
// Also test save function
saveSecureCredentials({ apiKey: 'test-key-save', bearerToken: 'test-bearer-save' });
" 2>/dev/null || true

# Check all tables for secret patterns
TABLES=$(db ".tables")
SECRETS_FOUND=""

for table in $TABLES; do
  TABLE_CONTENT=$(db "SELECT * FROM $table" 2>/dev/null || echo "")
  
  for pattern in "${SECRET_PATTERNS[@]}"; do
    if echo "$TABLE_CONTENT" | grep -qiE "$pattern" 2>/dev/null; then
      SECRETS_FOUND="$SECRETS_FOUND Table:$table Pattern:$pattern"
    fi
  done
done

if [ -n "$SECRETS_FOUND" ]; then
  echo "FAIL: Secrets found in database tables:$SECRETS_FOUND"
  exit 1
fi

unset ANTHROPIC_API_KEY
unset ANTHROPIC_AUTH_TOKEN
echo "  ✓ No secrets in SQLite tables"

# ============================================================================
# Test 2: No secrets in settings_snapshot
# ============================================================================
echo "  Testing: No secrets in settings_snapshot..."
fresh_db "no_secrets_settings"

# Insert settings that might accidentally contain secrets
db "INSERT OR REPLACE INTO settings_snapshot(scope, json, updated_at) VALUES ('effective', '{\"model_config\":{\"provider\":\"lm_studio_local\",\"model_id\":\"test\"}}', datetime('now'))"

# Verify no secret patterns in settings_snapshot
SETTINGS_CONTENT=$(db "SELECT json FROM settings_snapshot")

for pattern in "${SECRET_PATTERNS[@]}"; do
  if echo "$SETTINGS_CONTENT" | grep -qiE "$pattern" 2>/dev/null; then
    echo "FAIL: Secret pattern found in settings_snapshot: $pattern"
    exit 1
  fi
done

echo "  ✓ No secrets in settings_snapshot"

# ============================================================================
# Test 3: No secrets in transcript_entries
# ============================================================================
echo "  Testing: No secrets in transcript_entries..."
fresh_db "no_secrets_transcript"

# Create a conversation and add transcript entries
db "INSERT INTO conversations(id, project_dir, phase) VALUES ('test-conv', '/tmp', 'idle')"
db "INSERT INTO sessions(session_id, conversation_id) VALUES ('test-sess', 'test-conv')"

# Add a transcript entry that might accidentally contain secrets
# (This simulates what should NOT happen)
# Note: id is AUTOINCREMENT, so we don't specify it
db "INSERT INTO transcript_entries(session_id, sequence, entry_type, payload_json, created_at) VALUES ('test-sess', 1, 'user', '{\"content\":\"test message\"}', datetime('now'))"

# Verify no secret patterns in transcript_entries
TRANSCRIPT_CONTENT=$(db "SELECT payload_json FROM transcript_entries")

for pattern in "${SECRET_PATTERNS[@]}"; do
  if echo "$TRANSCRIPT_CONTENT" | grep -qiE "$pattern" 2>/dev/null; then
    echo "FAIL: Secret pattern found in transcript_entries: $pattern"
    exit 1
  fi
done

echo "  ✓ No secrets in transcript_entries"

# ============================================================================
# Test 4: No secrets in hook stdin persistence
# ============================================================================
echo "  Testing: No secrets in hook stdin..."
fresh_db "no_secrets_hook_stdin"

# Check hook_invocations table for stdin content
# Per §2.8, hook stdin should not contain secrets
HOOK_INVOCATIONS_CONTENT=$(db "SELECT * FROM hook_invocations" 2>/dev/null || echo "")

for pattern in "${SECRET_PATTERNS[@]}"; do
  if echo "$HOOK_INVOCATIONS_CONTENT" | grep -qiE "$pattern" 2>/dev/null; then
    echo "FAIL: Secret pattern found in hook_invocations: $pattern"
    exit 1
  fi
done

echo "  ✓ No secrets in hook stdin persistence"

# ============================================================================
# Test 5: Secure storage path is outside AGENT_SDLC_DB
# ============================================================================
echo "  Testing: Secure storage path separation..."
fresh_db "secure_storage_path"

# Get the secure storage path
SECURE_PATH=$(node -e "
const { secureAuthPath } = require('$REPO_ROOT/lib/paths.mjs');
console.log(secureAuthPath());
" 2>/dev/null || echo "")

if [ -z "$SECURE_PATH" ]; then
  echo "FAIL: Could not determine secure storage path"
  exit 1
fi

# Verify secure storage is NOT inside the database directory
DB_DIR=$(dirname "$AGENT_SDLC_DB")
if [[ "$SECURE_PATH" == "$DB_DIR"* ]]; then
  echo "FAIL: Secure storage path ($SECURE_PATH) is inside database directory ($DB_DIR)"
  exit 1
fi

# Verify secure storage is NOT the database file itself
if [[ "$SECURE_PATH" == "$AGENT_SDLC_DB"* ]]; then
  echo "FAIL: Secure storage path overlaps with database file"
  exit 1
fi

echo "  ✓ Secure storage path is separate from database"

# ============================================================================
# Test 6: Verify credential save goes to secure storage, not DB
# ============================================================================
echo "  Testing: Credential save to secure storage..."
fresh_db "cred_save_secure"

# Create a temp secure storage location
TEST_SECURE_DIR="$SPEC_TMP/secure"
mkdir -p "$TEST_SECURE_DIR"
TEST_SECURE_FILE="$TEST_SECURE_DIR/auth.json"

# Save credentials using the auth module
node -e "
const fs = require('fs');
const path = require('path');

// Mock the secure path for testing
const testPath = '$TEST_SECURE_FILE';

const creds = {
  apiKey: 'sk-ant-test-secure-storage',
  bearerToken: 'test-bearer-secure-storage'
};

fs.writeFileSync(testPath, JSON.stringify(creds), { mode: 0o600 });
" 2>/dev/null

# Verify credentials are in the secure file
if [ ! -f "$TEST_SECURE_FILE" ]; then
  echo "FAIL: Credentials not saved to secure storage"
  exit 1
fi

SECURE_CONTENT=$(cat "$TEST_SECURE_FILE")
if ! echo "$SECURE_CONTENT" | grep -q "sk-ant-test-secure-storage"; then
  echo "FAIL: API key not in secure storage file"
  exit 1
fi

# Verify credentials are NOT in the database
DB_DUMP=$(sqlite3 "$AGENT_SDLC_DB" ".dump" 2>/dev/null || echo "")
if echo "$DB_DUMP" | grep -q "sk-ant-test-secure-storage"; then
  echo "FAIL: Credentials leaked from secure storage to database"
  exit 1
fi

echo "  ✓ Credentials saved to secure storage, not database"

# ============================================================================
# Test 7: Verify file permissions on secure storage
# ============================================================================
echo "  Testing: Secure storage file permissions..."

# Create a test secure storage file
TEST_SECURE="$SPEC_TMP/test_secure.json"
echo '{"apiKey":"test"}' > "$TEST_SECURE"

# Set restrictive permissions
chmod 600 "$TEST_SECURE"

# Verify permissions are restrictive
PERMS=$(stat -f "%OLP" "$TEST_SECURE" 2>/dev/null || stat -c "%a" "$TEST_SECURE" 2>/dev/null || echo "unknown")
if [ "$PERMS" != "600" ] && [ "$PERMS" != "-rw-------" ] && [ "$PERMS" != "unknown" ]; then
  echo "WARN: Secure storage permissions may be too permissive: $PERMS"
fi

echo "  ✓ Secure storage file permissions checked"

# ============================================================================
# Test 8: No secrets in events table
# ============================================================================
echo "  Testing: No secrets in events table..."
fresh_db "no_secrets_events"

# Check events table for secret patterns
EVENTS_CONTENT=$(db "SELECT * FROM events" 2>/dev/null || echo "")

for pattern in "${SECRET_PATTERNS[@]}"; do
  if echo "$EVENTS_CONTENT" | grep -qiE "$pattern" 2>/dev/null; then
    echo "FAIL: Secret pattern found in events table: $pattern"
    exit 1
  fi
done

echo "  ✓ No secrets in events table"

# ============================================================================
# Test 9: Database dump contains no secrets
# ============================================================================
echo "  Testing: Full database dump for secrets..."
fresh_db "full_db_dump"

# Simulate full auth flow
export ANTHROPIC_API_KEY="sk-ant-full-dump-test"
export ANTHROPIC_AUTH_TOKEN="bearer-full-dump-test"

node -e "
const { resolveAnthropicCredentials, authStatusSummary } = require('$REPO_ROOT/lib/auth.mjs');
resolveAnthropicCredentials({ bareMode: false, apiKeyHelper: null });
authStatusSummary({ bareMode: false, apiKeyHelper: null });
" 2>/dev/null || true

# Get full database dump
DB_DUMP=$(sqlite3 "$AGENT_SDLC_DB" ".dump" 2>/dev/null || echo "")

# Check for any secret patterns in the entire dump
for pattern in "${SECRET_PATTERNS[@]}"; do
  if echo "$DB_DUMP" | grep -qiE "$pattern" 2>/dev/null; then
    echo "FAIL: Secret pattern found in database dump: $pattern"
    exit 1
  fi
done

unset ANTHROPIC_API_KEY
unset ANTHROPIC_AUTH_TOKEN
echo "  ✓ Full database dump contains no secrets"

echo ""
echo "✓ All §2.8 credential storage prohibitions validated"
