#!/usr/bin/env bash
# Test runner for CLEAN_ROOM_SPEC.md behavioral tests
# Executes all tests in correct order: section-2 → section-4 → section-5 → section-6 → section-7 → section-8
# Includes new tests for sections: 2.6, 4.7, 5.3, 5.7, 5.8, 5.9, 8.4, 8.8
# Validates: Requirements 3.1, 3.2, 3.3, 3.4 from bugfix.md
# Integrates: Coverage tracking and validation
set -euo pipefail

SCRIPT_DIR=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)
REPO_ROOT=$(cd "$SCRIPT_DIR/../.." && pwd)
export ONA="$REPO_ROOT/bin/agent.mjs"

PASS=0
FAIL=0
TOTAL=0
FAILED_TESTS=()

# Setup temp directory
SPEC_TMP=$(mktemp -d "${TMPDIR:-/tmp}/spec-behavioral.XXXXXX")
export SPEC_TMP

cleanup() {
  local ec=$?
  [[ -n "${SPEC_TMP:-}" && -d "$SPEC_TMP" ]] && rm -rf "$SPEC_TMP" || true
  return "$ec"
}
trap cleanup EXIT

# Check dependencies
command -v node >/dev/null 2>&1 || { echo "ERROR: node required" >&2; exit 2; }
command -v sqlite3 >/dev/null 2>&1 || { echo "ERROR: sqlite3 required" >&2; exit 2; }
[[ -f "$ONA" ]] || { echo "ERROR: ONA not found: $ONA" >&2; exit 2; }

# Helper functions for tests
fresh_db() {
  export AGENT_SDLC_DB="$SPEC_TMP/db_${1}.db"
  rm -f "$AGENT_SDLC_DB" "$AGENT_SDLC_DB-wal" "$AGENT_SDLC_DB-shm" 2>/dev/null || true
  SDLC_DISABLE_ALL_HOOKS=1 node "$ONA" --init-db >/dev/null 2>&1
}

db() {
  sqlite3 -cmd ".output /dev/null" -cmd "PRAGMA foreign_keys=ON;" -cmd "PRAGMA busy_timeout=30000;" -cmd ".output stdout" "$AGENT_SDLC_DB" "$@"
}

export -f fresh_db db
export ONA SPEC_TMP REPO_ROOT

echo "=== Behavioral Tests for CLEAN_ROOM_SPEC.md ==="
echo "TMP: $SPEC_TMP"
echo ""

# Run test files in section order
# Order: section-2 → section-4 → section-5 → section-6 → section-7 → section-8

run_test_file() {
  local test_file="$1"
  [[ -f "$test_file" ]] || return 0
  
  local test_name=$(basename "$test_file" .sh)
  TOTAL=$((TOTAL + 1))
  
  echo -n "Running $test_name... "
  
  if bash "$test_file" >/dev/null 2>&1; then
    PASS=$((PASS + 1))
    echo "PASS"
  else
    FAIL=$((FAIL + 1))
    FAILED_TESTS+=("$test_name")
    echo "FAIL"
  fi
}

# Track which tests have been run to avoid duplicates
declare -A TESTS_RUN

run_test_file_once() {
  local test_file="$1"
  [[ -f "$test_file" ]] || return 0
  
  local test_name=$(basename "$test_file" .sh)
  
  # Skip if already run
  if [[ -n "${TESTS_RUN[$test_name]:-}" ]]; then
    return 0
  fi
  TESTS_RUN[$test_name]=1
  
  run_test_file "$test_file"
}

# ============================================================================
# Section 1: Goals and scope (legacy tests)
# ============================================================================
echo "--- Section 1: Goals and scope ---"
run_test_file_once "$SCRIPT_DIR/test_section_1_goals_and_scope.sh"

# ============================================================================
# Section 2: Model providers, credentials, and turn loop
# ============================================================================
echo "--- Section 2: Model providers, credentials, and turn loop ---"

# New section-2.*.sh pattern tests
for test_file in "$SCRIPT_DIR"/section-2.1-provider-enum.sh \
                 "$SCRIPT_DIR"/section-2.2-model-config.sh \
                 "$SCRIPT_DIR"/section-2.3-env-variables.sh \
                 "$SCRIPT_DIR"/section-2.5-turn-loop.sh \
                 "$SCRIPT_DIR"/section-2.6-sessionstart-hook.sh \
                 "$SCRIPT_DIR"/section-2.9-repl-commands.sh \
                 "$SCRIPT_DIR"/section-2.10-provider-backends.sh; do
  run_test_file_once "$test_file"
done

# Legacy test_section_2_*.sh pattern tests
for test_file in "$SCRIPT_DIR"/test_section_2_4_precedence.sh \
                 "$SCRIPT_DIR"/test_section_2_7_auth_capabilities.sh \
                 "$SCRIPT_DIR"/test_section_2_8_credential_storage.sh; do
  run_test_file_once "$test_file"
done

# ============================================================================
# Section 4: Storage
# ============================================================================
echo "--- Section 4: Storage ---"

# New section-4.*.sh pattern tests
for test_file in "$SCRIPT_DIR"/section-4.1-db-location.sh \
                 "$SCRIPT_DIR"/section-4.3-schema.sh \
                 "$SCRIPT_DIR"/section-4.4-bootstrap.sh \
                 "$SCRIPT_DIR"/section-4.5-transcript.sh \
                 "$SCRIPT_DIR"/section-4.6-plans.sh \
                 "$SCRIPT_DIR"/section-4.7-memory-ranking.sh \
                 "$SCRIPT_DIR"/section-4.8-concurrency.sh; do
  run_test_file_once "$test_file"
done

# Legacy test_section_4_*.sh pattern tests
for test_file in "$SCRIPT_DIR"/test_section_4_1_location.sh \
                 "$SCRIPT_DIR"/test_section_4_2_schema_version.sh \
                 "$SCRIPT_DIR"/test_section_4_3_database_schema.sh \
                 "$SCRIPT_DIR"/test_section_4_5_transcript.sh \
                 "$SCRIPT_DIR"/test_section_4_6_plans.sh; do
  run_test_file_once "$test_file"
done

# ============================================================================
# Section 5: Hook plane
# ============================================================================
echo "--- Section 5: Hook plane ---"

for test_file in "$SCRIPT_DIR"/section-5.1-matcher-logic.sh \
                 "$SCRIPT_DIR"/section-5.2-ordinal-order.sh \
                 "$SCRIPT_DIR"/section-5.3-hook-ordering.sh \
                 "$SCRIPT_DIR"/section-5.4-exit-codes.sh \
                 "$SCRIPT_DIR"/section-5.5-json-validation.sh \
                 "$SCRIPT_DIR"/section-5.6-permission-merge.sh \
                 "$SCRIPT_DIR"/section-5.7-permission-dialog.sh \
                 "$SCRIPT_DIR"/section-5.8-async-hooks.sh \
                 "$SCRIPT_DIR"/section-5.9-hook-timeouts.sh \
                 "$SCRIPT_DIR"/section-5.11-hook-execution.sh \
                 "$SCRIPT_DIR"/section-5.12-permission-rules.sh; do
  run_test_file_once "$test_file"
done

# ============================================================================
# Section 6: Hook stdin
# ============================================================================
echo "--- Section 6: Hook stdin ---"

for test_file in "$SCRIPT_DIR"/section-6.0-hook-stdin.sh; do
  run_test_file_once "$test_file"
done

# ============================================================================
# Section 7: Tool taxonomy
# ============================================================================
echo "--- Section 7: Tool taxonomy ---"

for test_file in "$SCRIPT_DIR"/section-7.1-tool-contracts.sh \
                 "$SCRIPT_DIR"/section-7.2-tool-completeness.sh; do
  run_test_file_once "$test_file"
done

# ============================================================================
# Section 8: Workflow state
# ============================================================================
echo "--- Section 8: Workflow state ---"

for test_file in "$SCRIPT_DIR"/section-8.1-phase-enum.sh \
                 "$SCRIPT_DIR"/section-8.2-phase-transitions.sh \
                 "$SCRIPT_DIR"/section-8.3-planning-gate.sh \
                 "$SCRIPT_DIR"/section-8.4-operator-hooks.sh \
                 "$SCRIPT_DIR"/section-8.5-epistemic-isolation.sh \
                 "$SCRIPT_DIR"/section-8.5.2-observable-assertions.sh \
                 "$SCRIPT_DIR"/section-8.5.3-anti-mock.sh \
                 "$SCRIPT_DIR"/section-8.6-coverage-gate.sh \
                 "$SCRIPT_DIR"/section-8.7-verify-reporting.sh \
                 "$SCRIPT_DIR"/section-8.8-test-templates.sh; do
  run_test_file_once "$test_file"
done

# Legacy test_section_8_*.sh pattern tests
for test_file in "$SCRIPT_DIR"/test_section_8_1_conversations_phase.sh; do
  run_test_file_once "$test_file"
done

# ============================================================================
# Section 11: Appendix A — Hook stdin JSON (every event)
# ============================================================================
echo "--- Section 11: Hook events ---"

for test_file in "$SCRIPT_DIR"/section-11.0-hook-events.sh; do
  run_test_file_once "$test_file"
done

# ============================================================================
# Section 12: Appendix B — Hook stdout JSON
# ============================================================================
echo "--- Section 12: Hook stdout ---"

for test_file in "$SCRIPT_DIR"/section-12.0-hook-stdout.sh; do
  run_test_file_once "$test_file"
done

# ============================================================================
# Coverage and analysis tests (run last)
# ============================================================================
echo "--- Coverage and analysis ---"

for test_file in "$SCRIPT_DIR"/bug-condition-coverage-gap-analysis.sh \
                 "$SCRIPT_DIR"/preservation-existing-tests.sh; do
  run_test_file_once "$test_file"
done

# ============================================================================
# Coverage tracking and validation
# ============================================================================
echo ""
echo "--- Coverage Tracking ---"

# Generate coverage matrix
echo -n "Generating coverage matrix... "
if bash "$SCRIPT_DIR/coverage/coverage-tracker.sh" >/dev/null 2>&1; then
  echo "OK"
else
  echo "WARNING: Coverage matrix generation failed"
fi

# Validate coverage
echo -n "Validating coverage... "
if bash "$SCRIPT_DIR/coverage/validate-coverage.sh" >/dev/null 2>&1; then
  echo "OK (100% coverage)"
else
  echo "WARNING: Coverage validation failed or incomplete"
fi

echo ""
echo "=== Results ==="
echo "PASS: $PASS"
echo "FAIL: $FAIL"
echo "TOTAL: $TOTAL"

if [[ $FAIL -gt 0 ]]; then
  echo ""
  echo "Failed tests:"
  for test_name in "${FAILED_TESTS[@]}"; do
    echo "  - $test_name"
  done
  echo ""
  echo "FAILED: $FAIL tests failed"
  exit 1
else
  echo "SUCCESS: All tests passed"
  exit 0
fi