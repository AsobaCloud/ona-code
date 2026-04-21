#!/usr/bin/env bash
set -euo pipefail
# validate-coverage.sh - Validate that all normative requirements have passing tests
#
# Purpose: Ensure complete behavioral test coverage of CLEAN_ROOM_SPEC.md normative
# requirements. Exits 0 iff all normative requirements have ≥1 passing test.
# Exits 1 with report if any requirement lacks coverage or has failing tests.
#
# Per §F.2 of CLEAN_ROOM_SPEC.md:
#   "CI must execute scripts/sdlc-acceptance.sh on every change intended for release;
#    forbidden merge to the delivery branch if exit code ≠ 0."
#
# This script is integrated into sdlc-acceptance.sh to enforce coverage gates.
#
# Usage:
#   ./validate-coverage.sh [--matrix path/to/matrix.json] [--format text|json]
#
# Exit codes:
#   0 - All normative requirements have passing tests
#   1 - Coverage gaps or failing tests detected
#   2 - Error (missing dependencies, invalid matrix, etc.)

set -euo pipefail

# Determine script location and repo root
SCRIPT_DIR=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)
REPO_ROOT=$(cd "$SCRIPT_DIR/../../.." && pwd)
TEST_DIR="$REPO_ROOT/tests/spec-behavioral"
SPEC_FILE="$REPO_ROOT/claude-code/CLEAN_ROOM_SPEC.md"
PARSER_SCRIPT="$TEST_DIR/lib/spec-parser.sh"
TRACKER_SCRIPT="$SCRIPT_DIR/coverage-tracker.sh"
COVERAGE_DIR="$SCRIPT_DIR"

# Parse arguments
MATRIX_FILE=""
OUTPUT_FORMAT="text"

while [[ $# -gt 0 ]]; do
    case "$1" in
        --matrix)
            MATRIX_FILE="$2"
            shift 2
            ;;
        --format)
            OUTPUT_FORMAT="$2"
            shift 2
            ;;
        *)
            echo "ERROR: Unknown option: $1" >&2
            exit 2
            ;;
    esac
done

# If no matrix file specified, generate one
if [[ -z "$MATRIX_FILE" ]]; then
    MATRIX_FILE="$COVERAGE_DIR/matrix.json"
    
    # Generate matrix if it doesn't exist or is stale
    if [[ ! -f "$MATRIX_FILE" ]] || [[ "$SPEC_FILE" -nt "$MATRIX_FILE" ]]; then
        echo "Generating coverage matrix..." >&2
        "$TRACKER_SCRIPT" --output "$MATRIX_FILE" || {
            echo "ERROR: Failed to generate coverage matrix" >&2
            exit 2
        }
    fi
fi

# Verify matrix file exists
if [[ ! -f "$MATRIX_FILE" ]]; then
    echo "ERROR: Matrix file not found: $MATRIX_FILE" >&2
    exit 2
fi

# Colors for text output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# Function to extract JSON value
json_get() {
    local json="$1"
    local key="$2"
    echo "$json" | grep -o "\"$key\":[^,}]*" | cut -d: -f2- | tr -d '"' || echo ""
}

# Function to extract JSON array
json_get_array() {
    local json="$1"
    local key="$2"
    # Extract array content between [ and ]
    echo "$json" | sed -n "s/.*\"$key\":\[\(.*\)\].*/\1/p"
}

# Read matrix file
MATRIX_JSON=$(cat "$MATRIX_FILE")

# Extract summary
TOTAL_REQUIREMENTS=$(echo "$MATRIX_JSON" | grep -o '"total_requirements":[^,]*' | cut -d: -f2 | tr -d ' ')
TOTAL_SECTIONS=$(echo "$MATRIX_JSON" | grep -o '"total_sections":[^,]*' | cut -d: -f2 | tr -d ' ')
COVERED_SECTIONS=$(echo "$MATRIX_JSON" | grep -o '"covered_sections":[^,]*' | cut -d: -f2 | tr -d ' ')
PASSING_TESTS=$(echo "$MATRIX_JSON" | grep -o '"passing_tests":[^,]*' | cut -d: -f2 | tr -d ' ')
FAILING_TESTS=$(echo "$MATRIX_JSON" | grep -o '"failing_tests":[^,]*' | cut -d: -f2 | tr -d ' ')
COVERAGE_PCT=$(echo "$MATRIX_JSON" | grep -o '"coverage_percentage":[^,]*' | cut -d: -f2 | tr -d ' ')

# Validate coverage
UNCOVERED_SECTIONS=0
UNCOVERED_DETAILS=()

# Parse requirements to find uncovered ones
while IFS= read -r line; do
    if [[ "$line" =~ \"coverage_status\":\"uncovered\" ]]; then
        UNCOVERED_SECTIONS=$((UNCOVERED_SECTIONS + 1))
        
        # Extract section_id and requirement_text
        if [[ "$line" =~ \"section_id\":\"([^\"]+)\" ]]; then
            section_id="${BASH_REMATCH[1]}"
            req_text=""
            if [[ "$line" =~ \"requirement_text\":\"([^\"]+)\" ]]; then
                req_text="${BASH_REMATCH[1]}"
            fi
            UNCOVERED_DETAILS+=("§$section_id: ${req_text:0:80}...")
        fi
    fi
done < <(echo "$MATRIX_JSON" | grep -o '{[^}]*"coverage_status"[^}]*}')

# Output validation report
output_text() {
    echo -e "${BLUE}=== Coverage Validation Report ===${NC}"
    echo ""
    echo "Spec file: $SPEC_FILE"
    echo "Matrix file: $MATRIX_FILE"
    echo ""
    
    echo -e "${BLUE}=== Summary ===${NC}"
    echo "Total normative requirements: $TOTAL_REQUIREMENTS"
    echo "Total specification sections: $TOTAL_SECTIONS"
    echo "Sections with tests: $COVERED_SECTIONS"
    echo "Passing tests: $PASSING_TESTS"
    echo "Failing tests: $FAILING_TESTS"
    echo "Coverage: ${COVERAGE_PCT}%"
    echo ""
    
    if [[ $UNCOVERED_SECTIONS -gt 0 ]]; then
        echo -e "${RED}=== COVERAGE GAPS ===${NC}"
        echo "Uncovered sections: $UNCOVERED_SECTIONS"
        echo ""
        
        for detail in "${UNCOVERED_DETAILS[@]}"; do
            echo "  $detail"
        done
        echo ""
    fi
    
    if [[ $FAILING_TESTS -gt 0 ]]; then
        echo -e "${RED}=== FAILING TESTS ===${NC}"
        echo "Number of failing tests: $FAILING_TESTS"
        echo ""
        
        # Extract failing test details
        while IFS= read -r line; do
            if [[ "$line" =~ \"status\":\"fail\" ]]; then
                if [[ "$line" =~ \"test_name\":\"([^\"]+)\" ]]; then
                    test_name="${BASH_REMATCH[1]}"
                    echo "  - $test_name"
                fi
            fi
        done < <(echo "$MATRIX_JSON" | grep -o '{[^}]*"status":"fail"[^}]*}')
        echo ""
    fi
    
    # Verdict
    echo -e "${BLUE}=== Verdict ===${NC}"
    if [[ $UNCOVERED_SECTIONS -eq 0 ]] && [[ $FAILING_TESTS -eq 0 ]]; then
        echo -e "${GREEN}PASS: All normative requirements have passing tests${NC}"
        return 0
    else
        if [[ $UNCOVERED_SECTIONS -gt 0 ]]; then
            echo -e "${RED}FAIL: $UNCOVERED_SECTIONS sections lack test coverage${NC}"
        fi
        if [[ $FAILING_TESTS -gt 0 ]]; then
            echo -e "${RED}FAIL: $FAILING_TESTS tests are failing${NC}"
        fi
        return 1
    fi
}

output_json() {
    verdict="pass"
    [[ $UNCOVERED_SECTIONS -gt 0 ]] && verdict="fail"
    [[ $FAILING_TESTS -gt 0 ]] && verdict="fail"
    
    echo "{"
    echo "  \"verdict\": \"$verdict\","
    echo "  \"summary\": {"
    echo "    \"total_requirements\": $TOTAL_REQUIREMENTS,"
    echo "    \"total_sections\": $TOTAL_SECTIONS,"
    echo "    \"covered_sections\": $COVERED_SECTIONS,"
    echo "    \"passing_tests\": $PASSING_TESTS,"
    echo "    \"failing_tests\": $FAILING_TESTS,"
    echo "    \"coverage_percentage\": $COVERAGE_PCT"
    echo "  },"
    echo "  \"uncovered_sections\": $UNCOVERED_SECTIONS,"
    echo "  \"uncovered_details\": ["
    
    first=1
    for detail in "${UNCOVERED_DETAILS[@]}"; do
        [[ $first -eq 0 ]] && echo ","
        first=0
        echo -n "    \"$detail\""
    done
    echo ""
    echo "  ]"
    echo "}"
    
    [[ "$verdict" == "pass" ]] && return 0 || return 1
}

# Output in requested format
case "$OUTPUT_FORMAT" in
    json)
        output_json
        ;;
    text|*)
        output_text
        ;;
esac
