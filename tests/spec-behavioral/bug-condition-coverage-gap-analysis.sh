#!/usr/bin/env bash
set -euo pipefail
# Bug Condition Exploration Test: Missing Behavioral Test Coverage
# Property 1: Bug Condition - Missing Behavioral Test Coverage
#
# This test MUST FAIL on unfixed code - failure confirms the bug exists
# DO NOT attempt to fix the test or the code when it fails
# GOAL: Surface counterexamples demonstrating missing test coverage
#
# Validates: Requirements 2.1, 2.2, 2.3 from bugfix.md
#
# Method:
# 1. Parse CLEAN_ROOM_SPEC.md for normative keywords (must/shall/required/forbidden)
# 2. Extract section IDs
# 3. Cross-reference against existing test files in tests/spec-behavioral/
# 4. Generate a coverage gap report
#
# Expected counterexamples:
# - §2.7-2.8: No behavioral tests for A1-A7, O1, L1 authentication capabilities
# - §5: No behavioral tests for 24 hook events, ordinal ordering, permission merge
# - §7: No behavioral tests for 21 built-in tools, error classification
# - §8.2-8.8: No behavioral tests for phase transitions, epistemic isolation, coverage gates
#
# EXPECTED OUTCOME: Analysis FAILS (proves coverage gaps exist)

set -euo pipefail

SCRIPT_DIR=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)
REPO_ROOT=$(cd "$SCRIPT_DIR/../.." && pwd)
SPEC_FILE="$REPO_ROOT/claude-code/CLEAN_ROOM_SPEC.md"
TEST_DIR="$REPO_ROOT/tests/spec-behavioral"

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

echo "=== Bug Condition Exploration: Behavioral Test Coverage Analysis ==="
echo ""
echo "Spec file: $SPEC_FILE"
echo "Test directory: $TEST_DIR"
echo ""

# Verify spec file exists
if [[ ! -f "$SPEC_FILE" ]]; then
    echo -e "${RED}ERROR: CLEAN_ROOM_SPEC.md not found at $SPEC_FILE${NC}"
    exit 1
fi

# Verify test directory exists
if [[ ! -d "$TEST_DIR" ]]; then
    echo -e "${RED}ERROR: Test directory not found at $TEST_DIR${NC}"
    exit 1
fi

# Arrays to track coverage
declare -a NORMATIVE_SECTIONS=()
declare -a COVERED_SECTIONS=()
declare -a UNCOVERED_SECTIONS=()
declare -A SECTION_REQUIREMENTS=()

# Get list of existing test files (both old and new naming patterns)
EXISTING_TESTS=$(find "$TEST_DIR" -maxdepth 1 \( -name "test_*.sh" -o -name "section-*.sh" \) -type f 2>/dev/null | sort)

echo "=== Existing Behavioral Tests ==="
for test_file in $EXISTING_TESTS; do
    basename "$test_file"
done
echo ""

# Function to extract section number from test filename
# e.g., test_section_4_3_database_schema.sh -> 4.3
# or section-4.3-database-schema.sh -> 4.3
# or section-6.0-hook-stdin.sh -> 6
extract_section_from_test() {
    local filename="$1"
    
    # Match new pattern: section-N.M-description.sh or section-N-description.sh or section-N.0-description.sh
    if [[ "$filename" =~ section-([0-9]+)(\.([0-9]+))?- ]]; then
        local major="${BASH_REMATCH[1]}"
        local minor="${BASH_REMATCH[3]}"
        if [[ -n "$minor" && "$minor" != "0" ]]; then
            echo "${major}.${minor}"
        else
            echo "$major"
        fi
        return 0
    fi
    
    # Match old pattern: test_section_N_M_... or test_section_N_
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
        return 0
    fi
}

# Build set of covered sections from existing tests
declare -A COVERED_SECTION_MAP
for test_file in $EXISTING_TESTS; do
    filename=$(basename "$test_file")
    section=$(extract_section_from_test "$filename")
    if [[ -n "$section" ]]; then
        COVERED_SECTION_MAP["$section"]=1
    fi
done

echo "=== Covered Sections from Existing Tests ==="
for section in "${!COVERED_SECTION_MAP[@]}"; do
    echo "  §$section"
done | sort -t. -k1,1n -k2,2n
echo ""

# Parse CLEAN_ROOM_SPEC.md for normative sections
# Look for section headers and normative keywords
echo "=== Parsing CLEAN_ROOM_SPEC.md for Normative Requirements ==="
echo ""

# Extract all section headers with normative content
# Sections are marked with ## N. Title or ### N.M Title
declare -A SECTION_HAS_NORMATIVE
declare -A SECTION_NORMATIVE_COUNT

# Parse the spec file
current_section=""
while IFS= read -r line; do
    # Match section headers: ## N. Title or ### N.M Title
    if [[ "$line" =~ ^#{2,3}[[:space:]]+([0-9]+)(\.([0-9]+))?[[:space:]]+(.+) ]]; then
        current_section_major="${BASH_REMATCH[1]}"
        current_section_minor="${BASH_REMATCH[3]}"
        current_section_title="${BASH_REMATCH[4]}"
        
        if [[ -n "$current_section_minor" ]]; then
            current_section="${current_section_major}.${current_section_minor}"
        else
            current_section="$current_section_major"
        fi
    fi
    
    # Check for normative keywords in the line
    line_lower=$(echo "$line" | tr '[:upper:]' '[:lower:]')
    if [[ "$line_lower" =~ (must|shall|required|forbidden) ]]; then
        if [[ -n "${current_section:-}" ]]; then
            SECTION_HAS_NORMATIVE["$current_section"]=1
            # Increment count safely
            current_count="${SECTION_NORMATIVE_COUNT[$current_section]:-0}"
            SECTION_NORMATIVE_COUNT["$current_section"]=$((current_count + 1))
        fi
    fi
done < "$SPEC_FILE"

echo "=== Sections with Normative Requirements ==="
for section in "${!SECTION_HAS_NORMATIVE[@]}"; do
    count="${SECTION_NORMATIVE_COUNT[$section]:-0}"
    echo "  §$section: $count normative statements"
done | sort -t. -k1,1n -k2,2n
echo ""

# Define expected test coverage based on spec analysis
# These are the sections that SHOULD have behavioral tests
declare -A EXPECTED_TESTS

# Section 1: Goals and scope - has normative requirements
EXPECTED_TESTS["1"]="Goals and scope - core architecture"

# Section 2: Model providers, credentials, and turn loop
EXPECTED_TESTS["2.1"]="Provider enum (closed, case-sensitive)"
EXPECTED_TESTS["2.2"]="model_config structure"
EXPECTED_TESTS["2.3"]="Environment variables (credentials and endpoints)"
EXPECTED_TESTS["2.4"]="Precedence"
EXPECTED_TESTS["2.5"]="Canonical turn loop"
EXPECTED_TESTS["2.6"]="SessionStart hook field model"
EXPECTED_TESTS["2.7"]="Operator authentication & credential UX (A1-A7, O1, L1)"
EXPECTED_TESTS["2.8"]="Credential storage & prohibition"
EXPECTED_TESTS["2.9"]="REPL operator surface"
EXPECTED_TESTS["2.10"]="Provider backends"

# Section 3: Hook events
EXPECTED_TESTS["3"]="Hook events (closed set, 24 events)"
EXPECTED_TESTS["4.1"]="DB location"
EXPECTED_TESTS["4.2"]="Schema version"
EXPECTED_TESTS["4.3"]="Unified DDL"
EXPECTED_TESTS["4.4"]="Bootstrap import"
EXPECTED_TESTS["4.5"]="Transcript"
EXPECTED_TESTS["4.6"]="Plans"
EXPECTED_TESTS["4.7"]="Memories"
EXPECTED_TESTS["4.8"]="Concurrency and transaction boundaries"

# Section 5: Hook plane
EXPECTED_TESTS["5.1"]="Matcher logic"
EXPECTED_TESTS["5.2"]="Hook ordinal (total order)"
EXPECTED_TESTS["5.3"]="Sequential execution"
EXPECTED_TESTS["5.4"]="Exit codes"
EXPECTED_TESTS["5.5"]="JSON stdout validation"
EXPECTED_TESTS["5.6"]="Blocking and permission merge"
EXPECTED_TESTS["5.7"]="PreToolUse then permission dialog"
EXPECTED_TESTS["5.8"]="Async hooks"
EXPECTED_TESTS["5.9"]="Timeouts"
EXPECTED_TESTS["5.10"]="Trust gates"
EXPECTED_TESTS["5.11"]="Hook command execution environment"
EXPECTED_TESTS["5.12"]="Permission rules after PreToolUse"

# Section 6: Hook stdin
EXPECTED_TESTS["6"]="Hook stdin - SDLC base"

# Section 7: Tool taxonomy
EXPECTED_TESTS["7.1"]="Built-in tool execution contract"
EXPECTED_TESTS["7.2"]="Built-in tools - no partial implementations"

# Section 8: SDLC workflow state
EXPECTED_TESTS["8.1"]="conversations.phase (closed enum)"
EXPECTED_TESTS["8.2"]="Phase transitions"
EXPECTED_TESTS["8.3"]="Built-in tool denial during planning"
EXPECTED_TESTS["8.4"]="Operator workflow hooks"
EXPECTED_TESTS["8.5"]="Behavioral test generation - epistemic isolation"
EXPECTED_TESTS["8.6"]="Plan traceability and coverage gate"
EXPECTED_TESTS["8.7"]="Verify phase - coverage reporting"
EXPECTED_TESTS["8.8"]="Behavioral test templates"

# Section 11: Appendix A - Hook stdin JSON
EXPECTED_TESTS["11"]="Appendix A - Hook stdin JSON (every event)"

# Section 12: Appendix B - Hook stdout JSON
EXPECTED_TESTS["12"]="Appendix B - Hook stdout JSON"

# Section 15: Appendix E - permissions
EXPECTED_TESTS["15"]="Appendix E - settings_snapshot.permissions"

echo "=== Coverage Gap Analysis ==="
echo ""

GAPS_FOUND=0
GAP_DETAILS=""

# Check each expected section for coverage
for section in "${!EXPECTED_TESTS[@]}"; do
    description="${EXPECTED_TESTS[$section]}"
    
    # Check if this section has a test
    has_coverage=0
    
    # Direct match
    if [[ -n "${COVERED_SECTION_MAP[$section]:-}" ]]; then
        has_coverage=1
    fi
    
    # Check for parent section coverage (e.g., test for 4 covers 4.1, 4.2, etc.)
    major="${section%%.*}"
    if [[ -n "${COVERED_SECTION_MAP[$major]:-}" ]]; then
        has_coverage=1
    fi
    
    # Check for partial coverage (test covers multiple subsections)
    for covered in "${!COVERED_SECTION_MAP[@]}"; do
        if [[ "$covered" == "$section" ]]; then
            has_coverage=1
            break
        fi
        # Check if covered section is a parent of this section
        if [[ "$section" == "$covered"* ]]; then
            has_coverage=1
            break
        fi
    done
    
    # Special case: Section 3 (hook events) is covered by section 11 (Appendix A)
    if [[ "$section" == "3" && -n "${COVERED_SECTION_MAP[11]:-}" ]]; then
        has_coverage=1
    fi
    
    if [[ $has_coverage -eq 0 ]]; then
        GAPS_FOUND=$((GAPS_FOUND + 1))
        GAP_DETAILS+="  §$section: $description\n"
        UNCOVERED_SECTIONS+=("$section")
    else
        COVERED_SECTIONS+=("$section")
    fi
done

# Sort and display results
echo -e "${YELLOW}=== UNCOVERED NORMATIVE SECTIONS ===${NC}"
if [[ $GAPS_FOUND -gt 0 ]]; then
    echo -e "$GAP_DETAILS" | sort -t. -k1,1n -k2,2n
else
    echo "  (none - all sections covered)"
fi
echo ""

echo -e "${GREEN}=== COVERED NORMATIVE SECTIONS ===${NC}"
for section in "${COVERED_SECTIONS[@]}"; do
    echo "  §$section: ${EXPECTED_TESTS[$section]}"
done | sort -t. -k1,1n -k2,2n
echo ""

# Summary
echo "=== Summary ==="
TOTAL_EXPECTED=${#EXPECTED_TESTS[@]}
TOTAL_COVERED=${#COVERED_SECTIONS[@]}
TOTAL_UNCOVERED=${#UNCOVERED_SECTIONS[@]}

echo "Total normative sections requiring tests: $TOTAL_EXPECTED"
echo "Sections with behavioral tests: $TOTAL_COVERED"
echo "Sections WITHOUT behavioral tests: $TOTAL_UNCOVERED"
echo ""

# Calculate coverage percentage
if [[ $TOTAL_EXPECTED -gt 0 ]]; then
    COVERAGE_PCT=$((TOTAL_COVERED * 100 / TOTAL_EXPECTED))
    echo "Coverage: $COVERAGE_PCT%"
fi
echo ""

# Specific counterexamples as required by the task
echo "=== Expected Counterexamples (from task specification) ==="
echo ""

# Check §2.7-2.8: Authentication capabilities
AUTH_COVERAGE=0
for section in "2.7" "2.8"; do
    if [[ -n "${COVERED_SECTION_MAP[$section]:-}" ]]; then
        AUTH_COVERAGE=$((AUTH_COVERAGE + 1))
    fi
done
if [[ $AUTH_COVERAGE -eq 0 ]]; then
    echo -e "${RED}COUNTEREXAMPLE 1: §2.7-2.8${NC}"
    echo "  No behavioral tests for A1-A7, O1, L1 authentication capabilities"
    echo "  Missing tests for:"
    echo "    - A1: API key via environment"
    echo "    - A2: Bearer via environment"
    echo "    - A3: Interactive Claude.ai OAuth"
    echo "    - A4: Logout"
    echo "    - A5: Auth status"
    echo "    - A6: apiKey helper script"
    echo "    - A7: Bare / hermetic mode"
    echo "    - O1: OpenAI compatible API key + base URL"
    echo "    - L1: LM Studio local endpoint + model id"
    echo ""
fi

# Check §5: Hook plane
HOOK_COVERAGE=0
for section in "5.1" "5.2" "5.3" "5.4" "5.5" "5.6" "5.7" "5.8" "5.9" "5.10" "5.11" "5.12"; do
    if [[ -n "${COVERED_SECTION_MAP[$section]:-}" ]]; then
        HOOK_COVERAGE=$((HOOK_COVERAGE + 1))
    fi
done
if [[ $HOOK_COVERAGE -eq 0 ]]; then
    echo -e "${RED}COUNTEREXAMPLE 2: §5 Hook Plane${NC}"
    echo "  No behavioral tests for 24 hook events, ordinal ordering, permission merge"
    echo "  Missing tests for:"
    echo "    - §5.1: Matcher logic"
    echo "    - §5.2: Hook ordinal (total order)"
    echo "    - §5.3: Sequential execution"
    echo "    - §5.4: Exit codes"
    echo "    - §5.5: JSON stdout validation"
    echo "    - §5.6: Blocking and permission merge"
    echo "    - §5.7: PreToolUse then permission dialog"
    echo "    - §5.8: Async hooks"
    echo "    - §5.9: Timeouts"
    echo "    - §5.10: Trust gates"
    echo "    - §5.11: Hook command execution environment"
    echo "    - §5.12: Permission rules after PreToolUse"
    echo ""
fi

# Check §7: Tool taxonomy
TOOL_COVERAGE=0
for section in "7.1" "7.2"; do
    if [[ -n "${COVERED_SECTION_MAP[$section]:-}" ]]; then
        TOOL_COVERAGE=$((TOOL_COVERAGE + 1))
    fi
done
if [[ $TOOL_COVERAGE -eq 0 ]]; then
    echo -e "${RED}COUNTEREXAMPLE 3: §7 Tool Taxonomy${NC}"
    echo "  No behavioral tests for 21 built-in tools, error classification"
    echo "  Missing tests for:"
    echo "    - §7.1: Built-in tool execution contract"
    echo "    - §7.2: Built-in tools - no partial implementations"
    echo "  Tools requiring tests:"
    echo "    Read, Write, Edit, NotebookEdit, Bash, Glob, Grep, WebFetch, WebSearch,"
    echo "    AskUserQuestion, TodoWrite, TaskOutput, Agent, Skill, EnterPlanMode,"
    echo "    ExitPlanMode, ListMcpResources, ReadMcpResource, ToolSearch, Brief, TaskStop"
    echo ""
fi

# Check §8.2-8.8: Workflow state
WORKFLOW_COVERAGE=0
for section in "8.2" "8.3" "8.4" "8.5" "8.6" "8.7" "8.8"; do
    if [[ -n "${COVERED_SECTION_MAP[$section]:-}" ]]; then
        WORKFLOW_COVERAGE=$((WORKFLOW_COVERAGE + 1))
    fi
done
if [[ $WORKFLOW_COVERAGE -lt 7 ]]; then
    echo -e "${RED}COUNTEREXAMPLE 4: §8.2-8.8 Workflow State${NC}"
    echo "  No behavioral tests for phase transitions, epistemic isolation, coverage gates"
    echo "  Missing tests for:"
    echo "    - §8.2: Phase transitions"
    echo "    - §8.3: Built-in tool denial during planning"
    echo "    - §8.4: Operator workflow hooks"
    echo "    - §8.5: Behavioral test generation - epistemic isolation"
    echo "    - §8.6: Plan traceability and coverage gate"
    echo "    - §8.7: Verify phase - coverage reporting"
    echo "    - §8.8: Behavioral test templates"
    echo ""
fi

# Final verdict
echo "=== VERDICT ==="
if [[ $GAPS_FOUND -gt 0 ]]; then
    echo -e "${RED}FAIL: Coverage gaps detected${NC}"
    echo ""
    echo "Found $GAPS_FOUND normative sections without behavioral test coverage."
    echo "This confirms the bug condition: missing behavioral test coverage allows"
    echo "specification violations to slip through undetected."
    echo ""
    echo "Per bugfix.md requirements 2.1, 2.2, 2.3:"
    echo "  - Every normative requirement SHALL have corresponding behavioral tests"
    echo "  - Authentication requirements (§2.7-2.8) SHALL have behavioral tests"
    echo "  - All normative requirement violations SHALL be detected by tests"
    exit 1
else
    echo -e "${GREEN}PASS: All normative sections have behavioral test coverage${NC}"
    echo ""
    echo "All $TOTAL_EXPECTED normative sections have corresponding behavioral tests."
    exit 0
fi
