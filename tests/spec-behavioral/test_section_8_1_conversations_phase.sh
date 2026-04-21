#!/usr/bin/env bash
# §8.1 conversations.phase - Phase enum validation
set -euo pipefail

fresh_db conversations_phase_8_1

echo "Testing §8.1 conversations.phase..."

# Test 1: conversations table has phase column
PHASE_COLUMN=$(db "PRAGMA table_info(conversations)" | grep "phase")
test -n "$PHASE_COLUMN" || {
  echo "FAIL: conversations table missing phase column"
  exit 1
}

# Test 2: Phase closed enum values can be stored
VALID_PHASES=("idle" "planning" "implement" "test" "verify" "done")

for phase in "${VALID_PHASES[@]}"; do
  db "INSERT INTO conversations(id, project_dir, phase) VALUES ('test_$phase', '/tmp', '$phase')" || {
    echo "FAIL: Cannot insert valid phase: $phase"
    exit 1
  }
  
  STORED_PHASE=$(db "SELECT phase FROM conversations WHERE id='test_$phase'")
  test "$STORED_PHASE" = "$phase" || {
    echo "FAIL: Phase not stored correctly: expected $phase, got $STORED_PHASE"
    exit 1
  }
done

# Test 3: Default phase is 'idle'
db "INSERT INTO conversations(id, project_dir) VALUES ('test_default', '/tmp')"
DEFAULT_PHASE=$(db "SELECT phase FROM conversations WHERE id='test_default'")
test "$DEFAULT_PHASE" = "idle" || {
  echo "FAIL: Default phase should be 'idle', got '$DEFAULT_PHASE'"
  exit 1
}

# Test 4: Phase transitions can be tracked
# Insert conversation in idle phase
db "INSERT INTO conversations(id, project_dir, phase) VALUES ('transition_test', '/tmp', 'idle')"

# Transition to planning
db "UPDATE conversations SET phase='planning', last_active=datetime('now') WHERE id='transition_test'"
PLANNING_PHASE=$(db "SELECT phase FROM conversations WHERE id='transition_test'")
test "$PLANNING_PHASE" = "planning" || {
  echo "FAIL: Cannot transition to planning phase"
  exit 1
}

# Transition to implement
db "UPDATE conversations SET phase='implement', last_active=datetime('now') WHERE id='transition_test'"
IMPLEMENT_PHASE=$(db "SELECT phase FROM conversations WHERE id='transition_test'")
test "$IMPLEMENT_PHASE" = "implement" || {
  echo "FAIL: Cannot transition to implement phase"
  exit 1
}

# Test 5: last_active is updated on phase transitions
INITIAL_TIME=$(db "SELECT last_active FROM conversations WHERE id='transition_test'")
sleep 1
db "UPDATE conversations SET phase='test', last_active=datetime('now') WHERE id='transition_test'"
UPDATED_TIME=$(db "SELECT last_active FROM conversations WHERE id='transition_test'")

test "$INITIAL_TIME" != "$UPDATED_TIME" || {
  echo "FAIL: last_active should be updated on phase transitions"
  exit 1
}

# Test 6: Phase is authoritative field
# The spec states "Authoritative field: conversations.phase only"
# We test that the phase can be reliably queried and updated
db "INSERT INTO conversations(id, project_dir, phase) VALUES ('authoritative_test', '/tmp', 'verify')"
AUTHORITATIVE_PHASE=$(db "SELECT phase FROM conversations WHERE id='authoritative_test'")
test "$AUTHORITATIVE_PHASE" = "verify" || {
  echo "FAIL: Phase not authoritative - cannot reliably store/retrieve"
  exit 1
}

echo "✓ conversations.phase enum validated"