#!/usr/bin/env bash
# spec-parser.sh - Extract normative requirements from CLEAN_ROOM_SPEC.md
#
# Purpose: Parse CLEAN_ROOM_SPEC.md for normative keywords (must/shall/required/forbidden)
# and extract section IDs and requirement text, outputting a structured mapping.
#
# Per §0.1 of CLEAN_ROOM_SPEC.md:
#   "must" / "shall" / "required" / "forbidden" denote hard conformance
#
# Output format (JSON lines):
#   {"section_id": "X.Y", "requirement_text": "...", "capability_id": "...", "line_number": N}
#
# Usage:
#   ./spec-parser.sh [path/to/CLEAN_ROOM_SPEC.md]
#
# If no path provided, defaults to claude-code/CLEAN_ROOM_SPEC.md relative to repo root.

set -euo pipefail

# Determine script location and repo root
SCRIPT_DIR=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)
REPO_ROOT=$(cd "$SCRIPT_DIR/../../.." && pwd)

# Default spec file location
SPEC_FILE="${1:-$REPO_ROOT/claude-code/CLEAN_ROOM_SPEC.md}"

# Verify spec file exists
if [[ ! -f "$SPEC_FILE" ]]; then
    echo "ERROR: CLEAN_ROOM_SPEC.md not found at $SPEC_FILE" >&2
    exit 1
fi

# Keywords that denote normative requirements (per §0.1)
NORMATIVE_KEYWORDS="must|shall|required|forbidden"

# Track current section context
current_section_id=""
current_section_title=""
current_capability_id=""

# Output array for JSON entries
declare -a REQUIREMENTS

# Function to escape JSON string values
json_escape() {
    local str="$1"
    # Escape backslashes first, then double quotes, then control characters
    str="${str//\\/\\\\}"
    str="${str//\"/\\\"}"
    str="${str//$'\n'/\\n}"
    str="${str//$'\r'/\\r}"
    str="${str//$'\t'/\\t}"
    echo "$str"
}

# Function to extract capability ID from text (e.g., A1, A2, O1, L1)
extract_capability_id() {
    local text="$1"
    # Match capability IDs like A1-A7, O1, L1 from authentication section
    if [[ "$text" =~ \*\*([A-Z][0-9]+)\*\* ]]; then
        echo "${BASH_REMATCH[1]}"
    elif [[ "$text" =~ \|[\ ]*\*\*([A-Z][0-9]+)\*\* ]]; then
        echo "${BASH_REMATCH[1]}"
    else
        echo ""
    fi
}

# Function to check if line contains a normative keyword
has_normative_keyword() {
    local line="$1"
    local line_lower=$(echo "$line" | tr '[:upper:]' '[:lower:]')
    
    if [[ "$line_lower" =~ (must|shall|required|forbidden) ]]; then
        return 0
    else
        return 1
    fi
}

# Function to clean requirement text (remove markdown formatting)
clean_requirement_text() {
    local text="$1"
    # Remove leading/trailing whitespace
    text="${text#"${text%%[![:space:]]*}"}"
    text="${text%"${text##*[![:space:]]}"}"
    # Remove markdown bold/italic markers
    text="${text//\*\*/}"
    text="${text//\*/}"
    # Remove markdown links but keep text
    text=$(echo "$text" | sed -E 's/\[([^\]]+)\]\([^)]+\)/\1/g')
    echo "$text"
}

# Parse the spec file
line_number=0
in_code_block=0
while IFS= read -r line || [[ -n "$line" ]]; do
    line_number=$((line_number + 1))
    
    # Track code blocks to skip them
    if [[ "$line" =~ ^\`\`\` ]]; then
        in_code_block=$((1 - in_code_block))
        continue
    fi
    [[ $in_code_block -eq 1 ]] && continue
    
    # Match section headers: ## N. Title or ### N.M Title
    if [[ "$line" =~ ^#{2,3}[[:space:]]+([0-9]+)(\.([0-9]+))?[[:space:]]+(.+) ]]; then
        major="${BASH_REMATCH[1]}"
        minor="${BASH_REMATCH[3]}"
        title="${BASH_REMATCH[4]}"
        
        # Clean title
        title=$(clean_requirement_text "$title")
        
        if [[ -n "${minor:-}" ]]; then
            current_section_id="${major}.${minor}"
        else
            current_section_id="$major"
        fi
        current_section_title="$title"
        current_capability_id=""
        continue
    fi
    
    # Check for capability ID patterns in table rows (e.g., | **A1** |)
    if [[ "$line" =~ ^\|[[:space:]]*\*\*([A-Z][0-9]+)\*\*[[:space:]]*\| ]]; then
        current_capability_id="${BASH_REMATCH[1]}"
    fi
    
    # Check if line contains normative keyword
    if has_normative_keyword "$line"; then
        # Skip if this is just a section header (already processed)
        [[ "$line" =~ ^#{2,3}[[:space:]] ]] && continue
        
        # Skip if this is a code block marker
        [[ "$line" =~ ^\`\`\` ]] && continue
        
        # Skip if this is a table separator
        [[ "$line" =~ ^\|[-[:space:]]+\|$ ]] && continue
        
        # Skip if we don't have a section context yet
        [[ -z "$current_section_id" ]] && continue
        
        # Extract requirement text
        req_text=$(clean_requirement_text "$line")
        
        # Skip empty or very short requirements
        [[ ${#req_text} -lt 10 ]] && continue
        
        # Extract capability ID if present in this line
        cap_id=$(extract_capability_id "$line")
        [[ -z "$cap_id" ]] && cap_id="$current_capability_id"
        
        # Escape for JSON
        section_escaped=$(json_escape "$current_section_id")
        text_escaped=$(json_escape "$req_text")
        cap_escaped=$(json_escape "$cap_id")
        title_escaped=$(json_escape "$current_section_title")
        
        # Output JSON entry
        printf '{"section_id":"%s","section_title":"%s","requirement_text":"%s","capability_id":"%s","line_number":%d}\n' \
            "$section_escaped" "$title_escaped" "$text_escaped" "$cap_escaped" "$line_number"
    fi
done < "$SPEC_FILE"
