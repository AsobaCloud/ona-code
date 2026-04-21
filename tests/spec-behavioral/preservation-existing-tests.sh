#!/usr/bin/env bash
set -euo pipefail
# Property 2: Preservation - Existing Test Functionality
#
# This test validates that existing behavioral tests continue to pass
# and validate their respective requirements.
#
# Validates: Requirements 3.1, 3.2, 3.3, 3.4 from bugfix.md
#
# Method:
# 1. Observe: Run existing tests in tests/spec-behavioral/ and record all passing tests
# 2. Document: Which sections are currently covered (1, 2.4, 4.*, 8.1 per design)
# 3. Write property: For each existing test file, assert it continues to pass
# 4. Run tests on UNFIXED code
#
# EXPECTED OUTCOME: Tests PASS (confirms baseline behavior to preserve)
#
# Covered Sections (as of baseline):
# - §1: Goals and scope (test_section_1_goals_and_scope.sh)
# - §2.4: Precedence (test_section_2_4_precedence.sh)
# - §4.1: DB location (test_section_4_1_location.sh)
# - §4.2: Schema version (test_section_4_2_schema_version.sh)
# - §4.3: Database schema (test_section_4_3_database_schema.sh)
# - §4.5: Transcript (test_section_4_5_transcript.sh)
# - §4.6: Plans (test_section_4_6_plans.sh)
# - §8.1: conversations.phase (test_section_8_1_conversations_phase.sh)

set -euo pipefail

SCRIPT_DIR=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)
REPO_ROOT=$(cd "$SCRIPT_DIR/../.." && pwd)
export ONA="$REPO_ROOT/bin/agent.mjs"

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

# Setup temp directory
SPEC_TMP=$(mktemp -d "${TMPDIR:-/tmp}/spec-behavioral-preservation.XXXXXX")
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

echo "=== Preservation Property Test: Existing Behavioral Tests ==="
echo ""
echo "This test validates that all existing behavioral tests continue to pass."
echo "Per bugfix.md requirements 3.1, 3.2, 3.3, 3.4:"
echo "  - 3.1: Existing tests SHALL CONTINUE TO pass and validate their requirements"
echo "  - 3.2: Test runner run-all.sh SHALL CONTINUE TO execute all tests correctly"
echo "  - 3.3: Existing test infrastructure SHALL CONTINUE TO function as designed"
echo "  - 3.4: Integration with broader testing framework SHALL CONTINUE TO work"
echo ""
echo "TMP: $SPEC_TMP"
echo ""

# Define the expected tests and their behaviors
# This is the baseline that must be preserved
declare -A EXPECTED_TESTS
EXPECTED_TESTS["test_section_1_goals_and_scope.sh"]="§1: Goals and scope - Core system architecture validation"
EXPECTED_TESTS["test_section_2_4_precedence.sh"]="§2.4: Precedence - Environment and settings precedence validation"
EXPECTED_TESTS["test_section_4_1_location.sh"]="§4.1: Location - Database location and pragma validation"
EXPECTED_TESTS["test_section_4_2_schema_version.sh"]="§4.2: Schema version - Schema metadata validation"
EXPECTED_TESTS["test_section_4_3_database_schema.sh"]="§4.3: Database schema - All required tables must exist"
EXPECTED_TESTS["test_section_4_5_transcript.sh"]="§4.5: Transcript - Transcript entries structure validation"
EXPECTED_TESTS["test_section_4_6_plans.sh"]="§4.6: Plans - Plans table structure and status validation"
EXPECTED_TESTS["test_section_8_1_conversations_phase.sh"]="§8.1: conversations.phase - Phase enum validation"

# Track results
PASS=0
FAIL=0
TOTAL=0
declare -a PASSED_TESTS=()
declare -a FAILED_TESTS=()

echo "=== Running Each Existing Test File ==="
echo ""

for test_file in "${!EXPECTED_TESTS[@]}"; do
    description="${EXPECTED_TESTS[$test_file]}"
    test_path="$SCRIPT_DIR/$test_file"
    TOTAL=$((TOTAL + 1))
    
    echo -n "Running $test_file ($description)... "
    
    if [[ ! -f "$test_path" ]]; then
        FAIL=$((FAIL + 1))
        FAILED_TESTS+=("$test_file (FILE NOT FOUND)")
        echo -e "${RED}FAIL (file not found)${NC}"
        continue
    fi
    
    if bash "$test_path" >/dev/null 2>&1; then
        PASS=$((PASS + 1))
        PASSED_TESTS+=("$test_file")
        echo -e "${GREEN}PASS${NC}"
    else
        FAIL=$((FAIL + 1))
        FAILED_TESTS+=("$test_file")
        echo -e "${RED}FAIL${NC}"
    fi
done

echo ""
echo "=== Preservation Test Results ==="
echo ""
echo "PASS: $PASS"
echo "FAIL: $FAIL"
echo "TOTAL: $TOTAL"
echo ""

# Show passed tests
if [[ ${#PASSED_TESTS[@]} -gt 0 ]]; then
    echo -e "${GREEN}Passed Tests:${NC}"
    for test in "${PASSED_TESTS[@]}"; do
        echo "  ✓ $test"
    done
    echo ""
fi

# Show failed tests
if [[ ${#FAILED_TESTS[@]} -gt 0 ]]; then
    echo -e "${RED}Failed Tests:${NC}"
    for test in "${FAILED_TESTS[@]}"; do
        echo "  ✗ $test"
    done
    echo ""
fi

# Verify run-all.sh continues to work (Requirement 3.2)
echo "=== Verifying run-all.sh Integration (Requirement 3.2) ==="
echo ""

RUN_ALL_PATH="$SCRIPT_DIR/run-all.sh"
if [[ ! -f "$RUN_ALL_PATH" ]]; then
    echo -e "${RED}FAIL: run-all.sh not found at $RUN_ALL_PATH${NC}"
    FAIL=$((FAIL + 1))
else
    echo -n "Running run-all.sh... "
    if bash "$RUN_ALL_PATH" >/dev/null 2>&1; then
        echo -e "${GREEN}PASS${NC}"
        echo "  run-all.sh executes all tests in correct order"
    else
        echo -e "${RED}FAIL${NC}"
        FAIL=$((FAIL + 1))
    fi
fi

echo ""

# Final verdict
echo "=== VERDICT ==="
if [[ $FAIL -gt 0 ]]; then
    echo -e "${RED}FAIL: Preservation property violated${NC}"
    echo ""
    echo "One or more existing behavioral tests failed."
    echo "This indicates a regression in existing test functionality."
    echo ""
    echo "Per bugfix.md requirements 3.1, 3.2, 3.3, 3.4:"
    echo "  - Existing tests MUST continue to pass"
    echo "  - Test runner MUST continue to execute all tests correctly"
    echo "  - Test infrastructure MUST continue to function as designed"
    echo "  - Integration MUST continue to work seamlessly"
    exit 1
else
    echo -e "${GREEN}PASS: Preservation property satisfied${NC}"
    echo ""
    echo "All $TOTAL existing behavioral tests passed."
    echo "The run-all.sh test runner executed successfully."
    echo ""
    echo "This confirms baseline behavior to preserve:"
    echo "  - §1: Goals and scope architecture validated"
    echo "  - §2.4: Precedence mechanism validated"
    echo "  - §4.1: Database location and pragmas validated"
    echo "  - §4.2: Schema version mechanism validated"
    echo "  - §4.3: Database schema matches requirements"
    echo "  - §4.5: Transcript structure validated"
    echo "  - §4.6: Plans structure validated"
    echo "  - §8.1: conversations.phase enum validated"
    echo ""
    echo "Requirements 3.1, 3.2, 3.3, 3.4 are satisfied."
    exit 0
fi
