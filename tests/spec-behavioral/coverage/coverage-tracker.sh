#!/usr/bin/env bash
# coverage-tracker.sh - Generate coverage matrix: requirement → test file → pass/fail
#
# Purpose: Create a comprehensive coverage matrix showing which normative requirements
# from CLEAN_ROOM_SPEC.md have corresponding behavioral tests and their pass/fail status.
#
# Output: tests/spec-behavioral/coverage/matrix.json
#
# Usage:
#   ./coverage-tracker.sh [--output path/to/matrix.json]
#
# Exit codes:
#   0 - Matrix generated successfully
#   1 - Error during generation

set -euo pipefail

# Determine script location and repo root
SCRIPT_DIR=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)
REPO_ROOT=$(cd "$SCRIPT_DIR/../../.." && pwd)
TEST_DIR="$REPO_ROOT/tests/spec-behavioral"
SPEC_FILE="$REPO_ROOT/.claude-code/CLEAN_ROOM_SPEC.md"
PARSER_SCRIPT="$TEST_DIR/lib/spec-parser.sh"
COVERAGE_DIR="$SCRIPT_DIR"

# Output file location
OUTPUT_FILE="${1:-$COVERAGE_DIR/matrix.json}"
if [[ "$OUTPUT_FILE" =~ ^--output ]]; then
    if [[ "$OUTPUT_FILE" =~ ^--output= ]]; then
        OUTPUT_FILE="${OUTPUT_FILE#--output=}"
    else
        # Next argument is the file
        OUTPUT_FILE="$2"
    fi
fi

# Verify dependencies
if [[ ! -f "$PARSER_SCRIPT" ]]; then
    echo "ERROR: spec-parser.sh not found at $PARSER_SCRIPT" >&2
    exit 1
fi

if [[ ! -f "$SPEC_FILE" ]]; then
    echo "ERROR: CLEAN_ROOM_SPEC.md not found at $SPEC_FILE" >&2
    exit 1
fi

if [[ ! -d "$TEST_DIR" ]]; then
    echo "ERROR: Test directory not found at $TEST_DIR" >&2
    exit 1
fi

# Temporary files
TEMP_DIR=$(mktemp -d "${TMPDIR:-/tmp}/coverage-tracker.XXXXXX")
trap 'rm -rf "$TEMP_DIR"' EXIT

REQUIREMENTS_FILE="$TEMP_DIR/requirements.jsonl"
TEST_RESULTS_FILE="$TEMP_DIR/test_results.jsonl"
SECTION_TESTS_FILE="$TEMP_DIR/section_tests.txt"
MATRIX_FILE="$TEMP_DIR/matrix.json"

# Function to escape JSON string values
json_escape() {
    local str="$1"
    str="${str//\\/\\\\}"
    str="${str//\"/\\\"}"
    str="${str//$'\n'/\\n}"
    str="${str//$'\r'/\\r}"
    str="${str//$'\t'/\\t}"
    echo "$str"
}

# Function to run a single test and capture result
run_test() {
    local test_file="$1"
    local test_name
    test_name=$(basename "$test_file" .sh)
    
    # Run test with timeout
    local output
    local exit_code
    
    output=$(timeout 30 bash "$test_file" 2>&1) || exit_code=$?
    
    # Determine status
    local status="fail"
    if [[ $exit_code -eq 0 ]]; then
        status="pass"
    elif [[ $exit_code -eq 124 ]]; then
        status="timeout"
    fi
    
    # Output result as JSON line
    local output_escaped
    output_escaped=$(json_escape "$output")
    printf '{"test_file":"%s","test_name":"%s","status":"%s","exit_code":%d,"output":"%s"}\n' \
        "$test_file" "$test_name" "$status" "$exit_code" "$output_escaped"
}

# Function to extract section from test filename
extract_section_from_test() {
    local filename="$1"
    # Match patterns: test_section_N_M_... or section-N.M-...
    if [[ "$filename" =~ test_section_([0-9]+)(_[0-9]+)? ]]; then
        local major="${BASH_REMATCH[1]}"
        local minor="${BASH_REMATCH[2]}"
        if [[ -n "$minor" ]]; then
            minor="${minor#_}"
            echo "${major}.${minor}"
        else
            echo "$major"
        fi
    elif [[ "$filename" =~ section-([0-9]+)\.([0-9]+)- ]]; then
        echo "${BASH_REMATCH[1]}.${BASH_REMATCH[2]}"
    elif [[ "$filename" =~ section-([0-9]+)\. ]]; then
        echo "${BASH_REMATCH[1]}"
    fi
}

# Parse spec requirements
echo "Parsing CLEAN_ROOM_SPEC.md..." >&2
"$PARSER_SCRIPT" "$SPEC_FILE" > "$REQUIREMENTS_FILE" 2>/dev/null || {
    echo "ERROR: Failed to parse spec requirements" >&2
    exit 1
}

# Count total requirements
TOTAL_REQUIREMENTS=$(wc -l < "$REQUIREMENTS_FILE")
echo "Found $TOTAL_REQUIREMENTS normative requirements" >&2

# Build mapping of section to test files (first pass - no subshell)
echo "Mapping test files to sections..." >&2
declare -A SECTION_TO_TESTS
declare -A SECTION_TO_REQUIREMENTS

# Map requirements to sections
while IFS= read -r req_line; do
    [[ -z "$req_line" ]] && continue
    
    # Extract section_id
    if [[ "$req_line" =~ \"section_id\":\"([^\"]+)\" ]]; then
        section_id="${BASH_REMATCH[1]}"
        count="${SECTION_TO_REQUIREMENTS[$section_id]:-0}"
        SECTION_TO_REQUIREMENTS["$section_id"]=$((count + 1))
    fi
done < "$REQUIREMENTS_FILE"

# Find all test files and map them to sections
find "$TEST_DIR" -maxdepth 1 -name "*.sh" -type f ! -name "run-all.sh" ! -name "bug-condition-coverage-gap-analysis.sh" ! -name "preservation-existing-tests.sh" | sort | while read -r test_file; do
    filename=$(basename "$test_file")
    section=$(extract_section_from_test "$filename")
    
    if [[ -n "$section" ]]; then
        echo "$section|$test_file"
    fi
done > "$SECTION_TESTS_FILE"

# Build the SECTION_TO_TESTS map from the file
while IFS='|' read -r section test_file; do
    if [[ -z "${SECTION_TO_TESTS[$section]:-}" ]]; then
        SECTION_TO_TESTS["$section"]="$test_file"
    else
        SECTION_TO_TESTS["$section"]="${SECTION_TO_TESTS[$section]}|$test_file"
    fi
done < "$SECTION_TESTS_FILE"

# Run behavioral tests
echo "Running behavioral tests..." >&2
while IFS='|' read -r section test_file; do
    run_test "$test_file" >> "$TEST_RESULTS_FILE"
done < "$SECTION_TESTS_FILE"

# Build coverage matrix JSON
echo "Building coverage matrix..." >&2

# Calculate summary statistics
covered_count=0
passing_count=0
failing_count=0

# Count passing/failing tests
while IFS= read -r result_line; do
    [[ -z "$result_line" ]] && continue
    
    if [[ "$result_line" =~ \"status\":\"pass\" ]]; then
        passing_count=$((passing_count + 1))
    else
        failing_count=$((failing_count + 1))
    fi
done < "$TEST_RESULTS_FILE"

# Count covered sections (sections with at least one test)
for section in "${!SECTION_TO_REQUIREMENTS[@]}"; do
    if [[ -n "${SECTION_TO_TESTS[$section]:-}" ]]; then
        covered_count=$((covered_count + 1))
    fi
done

coverage_pct=0
[[ ${#SECTION_TO_REQUIREMENTS[@]} -gt 0 ]] && coverage_pct=$((covered_count * 100 / ${#SECTION_TO_REQUIREMENTS[@]}))

# Start JSON output
{
    echo "{"
    echo "  \"timestamp\": \"$(date -u +'%Y-%m-%dT%H:%M:%SZ')\","
    echo "  \"spec_file\": \"$SPEC_FILE\","
    echo "  \"test_directory\": \"$TEST_DIR\","
    echo "  \"summary\": {"
    echo "    \"total_requirements\": $TOTAL_REQUIREMENTS,"
    echo "    \"total_sections\": ${#SECTION_TO_REQUIREMENTS[@]},"
    echo "    \"covered_sections\": $covered_count,"
    echo "    \"passing_tests\": $passing_count,"
    echo "    \"failing_tests\": $failing_count,"
    echo "    \"coverage_percentage\": $coverage_pct"
    echo "  },"
    
    # Build requirements array
    echo "  \"requirements\": ["
    
    first_req=1
    while IFS= read -r req_line; do
        [[ -z "$req_line" ]] && continue
        
        # Extract fields from requirement
        section_id="" req_text="" cap_id=""
        
        if [[ "$req_line" =~ \"section_id\":\"([^\"]+)\" ]]; then
            section_id="${BASH_REMATCH[1]}"
        fi
        if [[ "$req_line" =~ \"requirement_text\":\"([^\"]+)\" ]]; then
            req_text="${BASH_REMATCH[1]}"
        fi
        if [[ "$req_line" =~ \"capability_id\":\"([^\"]+)\" ]]; then
            cap_id="${BASH_REMATCH[1]}"
        fi
        
        [[ -z "$section_id" ]] && continue
        
        # Check if this section has tests
        has_tests=0
        test_files_json="[]"
        
        if [[ -n "${SECTION_TO_TESTS[$section_id]:-}" ]]; then
            has_tests=1
            
            # Build test files array
            test_files_arr=()
            IFS='|' read -ra test_list <<< "${SECTION_TO_TESTS[$section_id]}"
            
            for test_file in "${test_list[@]}"; do
                # Find result for this test
                while IFS= read -r result_line; do
                    [[ -z "$result_line" ]] && continue
                    
                    if [[ "$result_line" =~ \"test_file\":\"$test_file\" ]]; then
                        test_files_arr+=("$result_line")
                        break
                    fi
                done < "$TEST_RESULTS_FILE"
            done
            
            # Format as JSON array
            if [[ ${#test_files_arr[@]} -gt 0 ]]; then
                test_files_json="["
                first_test=1
                for test_result in "${test_files_arr[@]}"; do
                    [[ $first_test -eq 0 ]] && test_files_json+=","
                    first_test=0
                    test_files_json+="$test_result"
                done
                test_files_json+="]"
            fi
        fi
        
        # Output requirement entry
        [[ $first_req -eq 0 ]] && echo ","
        first_req=0
        
        echo -n "    {"
        echo -n "\"section_id\":\"$section_id\","
        echo -n "\"requirement_text\":\"$req_text\","
        echo -n "\"capability_id\":\"$cap_id\","
        echo -n "\"test_files\":$test_files_json,"
        echo -n "\"coverage_status\":\"$([[ $has_tests -eq 1 ]] && echo "covered" || echo "uncovered")\""
        echo -n "}"
    done < "$REQUIREMENTS_FILE"
    
    echo ""
    echo "  ]"
    echo "}"
} > "$MATRIX_FILE"

# Write output file
mkdir -p "$(dirname "$OUTPUT_FILE")"
cp "$MATRIX_FILE" "$OUTPUT_FILE"

echo "Coverage matrix written to: $OUTPUT_FILE" >&2
exit 0
