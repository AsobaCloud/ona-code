#!/usr/bin/env bash
set -euo pipefail
# Validates that a generated test file conforms to a shipped template.
# Usage: templates/validate_test.sh <test_file>
# Exits 0 if valid, 1 with descriptive error if not.

FILE="${1:?Usage: validate_test.sh <test_file>}"

if [ ! -f "$FILE" ]; then
  echo "FAIL: file not found: $FILE" >&2; exit 1
fi

CONTENT=$(cat "$FILE")

# 1. Template header present
if ! echo "$CONTENT" | grep -qE '^# TEMPLATE: (tool_contract|phase_transition|hook_contract|e2e_workflow|process_output|file_state|http_response)$'; then
  echo "FAIL: missing or invalid # TEMPLATE: header" >&2
  echo "  Must be one of: tool_contract, phase_transition, hook_contract, e2e_workflow, process_output, file_state, http_response" >&2
  exit 1
fi

# 2. Plan traceability — PLAN_REQ is non-empty
PLAN_REQ=$(echo "$CONTENT" | grep '^# PLAN_REQ:' | sed 's/^# PLAN_REQ: *//')
if [ -z "$PLAN_REQ" ] || echo "$PLAN_REQ" | grep -qE '^<|^$'; then
  echo "FAIL: PLAN_REQ is empty or still has placeholder <...>" >&2
  exit 1
fi

# 3. EXERCISE section contains ona CLI invocation
EXERCISE=$(echo "$CONTENT" | sed -n '/^# ══ EXERCISE ══/,/^# ══ ASSERT ══/p')
if ! echo "$EXERCISE" | grep -q 'ona '; then
  echo "FAIL: EXERCISE section must contain an 'ona' CLI invocation" >&2
  exit 1
fi

# 4. No internal imports or test frameworks
if echo "$CONTENT" | grep -qE '^\s*(import |require\(|from '\''|from ")'; then
  echo "FAIL: file contains import/require — tests must not import implementation modules" >&2
  exit 1
fi

if echo "$CONTENT" | grep -qiE '\b(jest|vitest|mocha|describe\(|it\(|expect\()\b'; then
  echo "FAIL: file contains test framework keywords — use bash assertions only" >&2
  exit 1
fi

# 5. Has all three sections
for section in "SETUP" "EXERCISE" "ASSERT"; do
  if ! echo "$CONTENT" | grep -q "^# ══ ${section} ══"; then
    echo "FAIL: missing section: # ══ ${section} ══" >&2
    exit 1
  fi
done

echo "PASS: $FILE conforms to template $(echo "$CONTENT" | grep '^# TEMPLATE:' | sed 's/^# TEMPLATE: //')"
