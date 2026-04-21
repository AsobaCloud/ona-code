#!/usr/bin/env bash
# coverage-matrix.sh - Compare spec requirements against existing tests
#
# Purpose: Generate a gap report showing uncovered requirements by comparing
# the output of spec-parser.sh against existing test files in tests/spec-behavioral/
#
# Usage:
#   ./coverage-matrix.sh [--format json|text|markdown]
#
# Output:
#   - Gap report showing uncovered requirements
#   - Coverage statistics
#   - Section-by-section breakdown
#
# Exit codes:
#   0 - All requirements covered
#   1 - Coverage gaps found
#   2 - Error (missing dependencies, etc.)

set -euo pipefail

# Determine script location and repo root
SCRIPT_DIR=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)
REPO_ROOT=$(cd "$SCRIPT_DIR/../../.." && pwd)
TEST_DIR="$REPO_ROOT/tests/spec-behavioral"
SPEC_FILE="$REPO_ROOT/claude-code/CLEAN_ROOM_SPEC.md"
PARSER_SCRIPT="$SCRIPT_DIR/spec-parser.sh"

# Output format (default: text)
OUTPUT_FORMAT="${1:-text}"
[[ "$OUTPUT_FORMAT" =~ ^--format= ]] && OUTPUT_FORMAT="${OUTPUT_FORMAT#--format=}"

# Colors for text output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# Verify dependencies
if [[ ! -f "$PARSER_SCRIPT" ]]; then
    echo "ERROR: spec-parser.sh not found at $PARSER_SCRIPT" >&2
    exit 2
fi

if [[ ! -f "$SPEC_FILE" ]]; then
    echo "ERROR: CLEAN_ROOM_SPEC.md not found at $SPEC_FILE" >&2
    exit 2
fi

if [[ ! -d "$TEST_DIR" ]]; then
    echo "ERROR: Test directory not found at $TEST_DIR" >&2
    exit 2
fi

# Arrays to track coverage
declare -A SECTION_REQUIREMENTS     # section_id -> count of requirements
declare -A SECTION_CAPABILITIES     # section_id -> comma-separated capability IDs
declare -A COVERED_SECTIONS         # section_id -> 1 if covered
declare -A UNCOVERED_SECTIONS       # section_id -> 1 if uncovered
declare -A SECTION_TEST_FILES       # section_id -> test file path
declare -a ALL_REQUIREMENTS         # All parsed requirements (JSON lines)

# Function to extract section number from test filename
# e.g., test_section_4_3_database_schema.sh -> 4.3
extract_section_from_test() {
    local filename="$1"
    # Match pattern: test_section_N_M_... or test_section_N_
    if [[ "$filename" =~ test_section_([0-9]+)(_[0-9]+)? ]]; then
        local major="${BASH_REMATCH[1]}"
        local minor="${BASH_REMATCH[2]}"
        if [[ -n "$minor" ]]; then
            # Remove leading underscore
            minor="${minor#_}"
            echo "${major}.${minor}"
        else
            echo "$major"
        fi
    fi
}

# Parse existing test files to determine covered sections
parse_existing_tests() {
    local test_files
    test_files=$(find "$TEST_DIR" -name "test_*.sh" -type f 2>/dev/null | sort)
    
    while IFS= read -r test_file; do
        [[ -z "$test_file" ]] && continue
        
        local filename
        filename=$(basename "$test_file")
        
        local section
        section=$(extract_section_from_test "$filename")
        
        if [[ -n "$section" ]]; then
            COVERED_SECTIONS["$section"]=1
            SECTION_TEST_FILES["$section"]="$test_file"
        fi
    done <<< "$test_files"
}

# Parse spec requirements using spec-parser.sh
parse_spec_requirements() {
    local requirements
    requirements=$("$PARSER_SCRIPT" "$SPEC_FILE" 2>/dev/null)
    
    while IFS= read -r req_line; do
        [[ -z "$req_line" ]] && continue
        
        ALL_REQUIREMENTS+=("$req_line")
        
        # Extract section_id from JSON
        local section_id
        if [[ "$req_line" =~ \"section_id\":\"([^\"]+)\" ]]; then
            section_id="${BASH_REMATCH[1]}"
            
            # Increment requirement count for this section
            local count="${SECTION_REQUIREMENTS[$section_id]:-0}"
            SECTION_REQUIREMENTS["$section_id"]=$((count + 1))
            
            # Extract capability_id if present
            if [[ "$req_line" =~ \"capability_id\":\"([^\"]+)\" ]]; then
                local cap_id="${BASH_REMATCH[1]}"
                if [[ -n "$cap_id" ]]; then
                    local existing="${SECTION_CAPABILITIES[$section_id]:-}"
                    if [[ -z "$existing" ]]; then
                        SECTION_CAPABILITIES["$section_id"]="$cap_id"
                    elif [[ ! "$existing" =~ $cap_id ]]; then
                        SECTION_CAPABILITIES["$section_id"]="$existing,$cap_id"
                    fi
                fi
            fi
        fi
    done <<< "$requirements"
}

# Check if a section has coverage
has_coverage() {
    local section="$1"
    
    # Direct match
    [[ -n "${COVERED_SECTIONS[$section]:-}" ]] && return 0
    
    # Check for parent section coverage (e.g., test for 4 covers 4.1, 4.2, etc.)
    local major="${section%%.*}"
    [[ -n "${COVERED_SECTIONS[$major]:-}" ]] && return 0
    
    # Check for partial coverage (test covers multiple subsections)
    for covered in "${!COVERED_SECTIONS[@]}"; do
        # Check if covered section is a parent of this section
        if [[ "$section" == "$covered".* ]]; then
            return 0
        fi
    done
    
    return 1
}

# Generate text format output
output_text() {
    echo -e "${BLUE}=== Coverage Matrix: CLEAN_ROOM_SPEC.md ===${NC}"
    echo ""
    echo "Spec file: $SPEC_FILE"
    echo "Test directory: $TEST_DIR"
    echo ""
    
    # Summary statistics
    local total_sections=${#SECTION_REQUIREMENTS[@]}
    local covered_count=0
    local uncovered_count=0
    
    for section in "${!SECTION_REQUIREMENTS[@]}"; do
        if has_coverage "$section"; then
            covered_count=$((covered_count + 1))
        else
            uncovered_count=$((uncovered_count + 1))
            UNCOVERED_SECTIONS["$section"]=1
        fi
    done
    
    echo -e "${GREEN}=== Summary ===${NC}"
    echo "Total normative sections: $total_sections"
    echo "Sections with tests: $covered_count"
    echo "Sections without tests: $uncovered_count"
    
    if [[ $total_sections -gt 0 ]]; then
        local coverage_pct=$((covered_count * 100 / total_sections))
        echo "Coverage: ${coverage_pct}%"
    fi
    echo ""
    
    # Covered sections
    echo -e "${GREEN}=== Covered Sections ===${NC}"
    for section in "${!SECTION_REQUIREMENTS[@]}"; do
        if has_coverage "$section"; then
            local req_count="${SECTION_REQUIREMENTS[$section]}"
            local test_file="${SECTION_TEST_FILES[$section]:-}"
            local capabilities="${SECTION_CAPABILITIES[$section]:-}"
            
            echo -n "  §$section: $req_count requirements"
            [[ -n "$capabilities" ]] && echo -n " (capabilities: $capabilities)"
            echo ""
        fi
    done | sort -t. -k1,1n -k2,2n
    echo ""
    
    # Uncovered sections (gap report)
    echo -e "${RED}=== GAP REPORT: Uncovered Sections ===${NC}"
    if [[ ${#UNCOVERED_SECTIONS[@]} -eq 0 ]]; then
        echo "  (none - all sections covered)"
    else
        for section in "${!UNCOVERED_SECTIONS[@]}"; do
            local req_count="${SECTION_REQUIREMENTS[$section]}"
            local capabilities="${SECTION_CAPABILITIES[$section]:-}"
            
            echo -n "  §$section: $req_count requirements"
            [[ -n "$capabilities" ]] && echo -n " (capabilities: $capabilities)"
            echo ""
        done | sort -t. -k1,1n -k2,2n
    fi
    echo ""
    
    # Detailed requirements for uncovered sections
    if [[ ${#UNCOVERED_SECTIONS[@]} -gt 0 ]]; then
        echo -e "${YELLOW}=== Detailed Gap Analysis ===${NC}"
        
        for req_line in "${ALL_REQUIREMENTS[@]}"; do
            # Extract section_id
            local section_id
            if [[ "$req_line" =~ \"section_id\":\"([^\"]+)\" ]]; then
                section_id="${BASH_REMATCH[1]}"
                
                # Only show if uncovered
                if [[ -n "${UNCOVERED_SECTIONS[$section_id]:-}" ]]; then
                    # Extract fields
                    local req_text="" cap_id="" line_num=""
                    
                    if [[ "$req_line" =~ \"requirement_text\":\"([^\"]+)\" ]]; then
                        req_text="${BASH_REMATCH[1]}"
                    fi
                    if [[ "$req_line" =~ \"capability_id\":\"([^\"]+)\" ]]; then
                        cap_id="${BASH_REMATCH[1]}"
                    fi
                    if [[ "$req_line" =~ \"line_number\":([0-9]+) ]]; then
                        line_num="${BASH_REMATCH[1]}"
                    fi
                    
                    echo -n "  §$section_id"
                    [[ -n "$cap_id" ]] && echo -n " [$cap_id]"
                    echo ": ${req_text:0:80}..."
                fi
            fi
        done
        echo ""
    fi
    
    # Verdict
    echo -e "${BLUE}=== Verdict ===${NC}"
    if [[ ${#UNCOVERED_SECTIONS[@]} -eq 0 ]]; then
        echo -e "${GREEN}PASS: All normative sections have behavioral test coverage${NC}"
        return 0
    else
        echo -e "${RED}FAIL: ${#UNCOVERED_SECTIONS[@]} sections lack behavioral test coverage${NC}"
        return 1
    fi
}

# Generate JSON format output
output_json() {
    local covered_count=0
    local uncovered_count=0
    local total_sections=${#SECTION_REQUIREMENTS[@]}
    
    # Build arrays for covered/uncovered
    declare -a covered_arr
    declare -a uncovered_arr
    
    for section in "${!SECTION_REQUIREMENTS[@]}"; do
        if has_coverage "$section"; then
            covered_count=$((covered_count + 1))
            local req_count="${SECTION_REQUIREMENTS[$section]}"
            local test_file="${SECTION_TEST_FILES[$section]:-}"
            local capabilities="${SECTION_CAPABILITIES[$section]:-}"
            
            local entry="{\"section_id\":\"$section\",\"requirement_count\":$req_count"
            [[ -n "$test_file" ]] && entry+=",\"test_file\":\"$test_file\""
            [[ -n "$capabilities" ]] && entry+=",\"capabilities\":\"$capabilities\""
            entry+="}"
            covered_arr+=("$entry")
        else
            uncovered_count=$((uncovered_count + 1))
            UNCOVERED_SECTIONS["$section"]=1
            
            local req_count="${SECTION_REQUIREMENTS[$section]}"
            local capabilities="${SECTION_CAPABILITIES[$section]:-}"
            
            local entry="{\"section_id\":\"$section\",\"requirement_count\":$req_count"
            [[ -n "$capabilities" ]] && entry+=",\"capabilities\":\"$capabilities\""
            entry+="}"
            uncovered_arr+=("$entry")
        fi
    done
    
    local coverage_pct=0
    [[ $total_sections -gt 0 ]] && coverage_pct=$((covered_count * 100 / total_sections))
    
    # Output JSON
    echo "{"
    echo "  \"summary\": {"
    echo "    \"total_sections\": $total_sections,"
    echo "    \"covered_count\": $covered_count,"
    echo "    \"uncovered_count\": $uncovered_count,"
    echo "    \"coverage_percentage\": $coverage_pct"
    echo "  },"
    echo "  \"covered_sections\": ["
    local first=1
    for entry in "${covered_arr[@]}"; do
        [[ $first -eq 0 ]] && echo ","
        first=0
        echo -n "    $entry"
    done
    echo ""
    echo "  ],"
    echo "  \"uncovered_sections\": ["
    first=1
    for entry in "${uncovered_arr[@]}"; do
        [[ $first -eq 0 ]] && echo ","
        first=0
        echo -n "    $entry"
    done
    echo ""
    echo "  ],"
    echo "  \"verdict\": \"$([[ ${#UNCOVERED_SECTIONS[@]} -eq 0 ]] && echo "pass" || echo "fail")\""
    echo "}"
    
    [[ ${#UNCOVERED_SECTIONS[@]} -eq 0 ]] && return 0 || return 1
}

# Generate Markdown format output
output_markdown() {
    local covered_count=0
    local uncovered_count=0
    local total_sections=${#SECTION_REQUIREMENTS[@]}
    
    for section in "${!SECTION_REQUIREMENTS[@]}"; do
        if has_coverage "$section"; then
            covered_count=$((covered_count + 1))
        else
            uncovered_count=$((uncovered_count + 1))
            UNCOVERED_SECTIONS["$section"]=1
        fi
    done
    
    local coverage_pct=0
    [[ $total_sections -gt 0 ]] && coverage_pct=$((covered_count * 100 / total_sections))
    
    echo "# Coverage Matrix: CLEAN_ROOM_SPEC.md"
    echo ""
    echo "## Summary"
    echo ""
    echo "| Metric | Value |"
    echo "|--------|-------|"
    echo "| Total normative sections | $total_sections |"
    echo "| Sections with tests | $covered_count |"
    echo "| Sections without tests | $uncovered_count |"
    echo "| Coverage | ${coverage_pct}% |"
    echo ""
    
    echo "## Covered Sections"
    echo ""
    if [[ $covered_count -gt 0 ]]; then
        echo "| Section | Requirements | Test File | Capabilities |"
        echo "|---------|--------------|-----------|--------------|"
        
        for section in "${!SECTION_REQUIREMENTS[@]}"; do
            if has_coverage "$section"; then
                local req_count="${SECTION_REQUIREMENTS[$section]}"
                local test_file="${SECTION_TEST_FILES[$section]:-}"
                local capabilities="${SECTION_CAPABILITIES[$section]:-}"
                
                [[ -z "$test_file" ]] && test_file="-"
                [[ -z "$capabilities" ]] && capabilities="-"
                
                echo "| §$section | $req_count | $test_file | $capabilities |"
            fi
        done | sort -t'|' -k2 -n
    else
        echo "(none)"
    fi
    echo ""
    
    echo "## Gap Report: Uncovered Sections"
    echo ""
    if [[ ${#UNCOVERED_SECTIONS[@]} -gt 0 ]]; then
        echo "| Section | Requirements | Capabilities |"
        echo "|---------|--------------|--------------|"
        
        for section in "${!UNCOVERED_SECTIONS[@]}"; do
            local req_count="${SECTION_REQUIREMENTS[$section]}"
            local capabilities="${SECTION_CAPABILITIES[$section]:-}"
            [[ -z "$capabilities" ]] && capabilities="-"
            
            echo "| §$section | $req_count | $capabilities |"
        done | sort -t'|' -k2 -n
    else
        echo "(none - all sections covered)"
    fi
    echo ""
    
    echo "## Verdict"
    echo ""
    if [[ ${#UNCOVERED_SECTIONS[@]} -eq 0 ]]; then
        echo "**PASS**: All normative sections have behavioral test coverage."
        return 0
    else
        echo "**FAIL**: ${#UNCOVERED_SECTIONS[@]} sections lack behavioral test coverage."
        return 1
    fi
}

# Main execution
parse_existing_tests
parse_spec_requirements

# Output in requested format
case "$OUTPUT_FORMAT" in
    json)
        output_json
        ;;
    markdown|md)
        output_markdown
        ;;
    text|*)
        output_text
        ;;
esac
