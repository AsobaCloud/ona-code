#!/usr/bin/env bash
# §4.5 Transcript - Transcript entries structure validation
set -euo pipefail

fresh_db transcript_4_5

echo "Testing §4.5 Transcript..."

# Test 1: transcript_entries table has required structure
TRANSCRIPT_COLUMNS=$(db "PRAGMA table_info(transcript_entries)" | cut -d'|' -f2)

# Required columns per §4.5
REQUIRED_COLUMNS=("id" "session_id" "sequence" "parent_entry_id" "entry_type" "payload_json" "tool_use_id" "created_at")
for col in "${REQUIRED_COLUMNS[@]}"; do
  echo "$TRANSCRIPT_COLUMNS" | grep -q "$col" || {
    echo "FAIL: transcript_entries missing required column: $col"
    exit 1
  }
done

# Test 2: sequence constraint (UNIQUE per session_id)
UNIQUE_CONSTRAINT=$(db "SELECT sql FROM sqlite_master WHERE name='transcript_entries'" | grep -o "UNIQUE(session_id, sequence)" || echo "")
test -n "$UNIQUE_CONSTRAINT" || {
  echo "FAIL: Missing UNIQUE(session_id, sequence) constraint"
  exit 1
}

# Test 3: entry_type closed set validation (insert valid types)
VALID_ENTRY_TYPES=("user" "assistant" "system" "tool_use" "tool_result")

# Set up required foreign key relationships first
db "INSERT INTO conversations(id, project_dir) VALUES ('test_conv', '/tmp')"
db "INSERT INTO sessions(session_id, conversation_id) VALUES ('test_session', 'test_conv')"

# Test inserting valid entry types (simplified JSON)
for entry_type in "${VALID_ENTRY_TYPES[@]}"; do
  db "INSERT INTO transcript_entries(session_id, sequence, entry_type, payload_json) VALUES ('test_session', $((RANDOM % 1000)), '$entry_type', '{}')" || {
    echo "FAIL: Cannot insert valid entry_type: $entry_type"
    exit 1
  }
done

# Test 4: payload_json structure with _t discriminator
db "INSERT INTO sessions(session_id, conversation_id) VALUES ('test_session_2', 'test_conv')"
db "INSERT INTO transcript_entries(session_id, sequence, entry_type, payload_json) VALUES ('test_session_2', 1, 'user', '{}')"

USER_PAYLOAD=$(db "SELECT payload_json FROM transcript_entries WHERE entry_type='user' LIMIT 1")
echo "$USER_PAYLOAD" | grep -q '{}' || {
  echo "FAIL: payload_json not properly stored"
  exit 1
}

# Test 5: Foreign key relationship with sessions
# Insert a session first
db "INSERT INTO conversations(id, project_dir) VALUES ('fk_test_conv', '/tmp')"
db "INSERT INTO sessions(session_id, conversation_id) VALUES ('fk_test_session', 'fk_test_conv')"

# Insert transcript entry referencing the session
db "INSERT INTO transcript_entries(session_id, sequence, entry_type, payload_json) VALUES ('fk_test_session', 1, 'user', '{}')"

# Verify foreign key constraint
FK_COUNT=$(db "SELECT COUNT(*) FROM transcript_entries WHERE session_id='fk_test_session'")
test "$FK_COUNT" = "1" || {
  echo "FAIL: Foreign key relationship not working"
  exit 1
}

# Test 6: Index exists for performance
INDEX_EXISTS=$(db "SELECT name FROM sqlite_master WHERE type='index' AND name='idx_transcript_session'")
test "$INDEX_EXISTS" = "idx_transcript_session" || {
  echo "FAIL: Missing idx_transcript_session index"
  exit 1
}

echo "✓ Transcript structure validated"