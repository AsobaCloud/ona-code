#!/usr/bin/env bash
# §4.6 Plans - Plans table structure and status validation
set -euo pipefail

fresh_db plans_4_6

echo "Testing §4.6 Plans..."

# Test 1: plans table has required structure
PLANS_COLUMNS=$(db "PRAGMA table_info(plans)" | cut -d'|' -f2)

REQUIRED_COLUMNS=("id" "conversation_id" "file_path" "content" "hash" "status" "created_at" "approved_at" "completed_at")
for col in "${REQUIRED_COLUMNS[@]}"; do
  echo "$PLANS_COLUMNS" | grep -q "$col" || {
    echo "FAIL: plans missing required column: $col"
    exit 1
  }
done

# Test 2: status closed enum validation
VALID_STATUSES=("draft" "approved" "completed" "superseded")

# Insert conversation first for foreign key
db "INSERT INTO conversations(id, project_dir) VALUES ('test_conv', '/tmp')"

for status in "${VALID_STATUSES[@]}"; do
  db "INSERT INTO plans(conversation_id, content, hash, status) VALUES ('test_conv', 'test plan content', 'hash123', '$status')" || {
    echo "FAIL: Cannot insert valid status: $status"
    exit 1
  }
done

# Test 3: Authoritative plan body is plans.content
db "INSERT INTO plans(conversation_id, file_path, content, hash, status) VALUES ('test_conv', '/some/path/plan.md', 'This is the authoritative content', 'hash456', 'draft')"

PLAN_CONTENT=$(db "SELECT content FROM plans WHERE hash='hash456'")
test "$PLAN_CONTENT" = "This is the authoritative content" || {
  echo "FAIL: Cannot retrieve authoritative plan content"
  exit 1
}

# Test 4: file_path is non-authoritative hint
# The spec states file_path is "non-authoritative hint only"
# We test that content is independent of file_path
db "INSERT INTO plans(conversation_id, file_path, content, hash, status) VALUES ('test_conv', NULL, 'Content without file path', 'hash789', 'draft')"

CONTENT_WITHOUT_PATH=$(db "SELECT content FROM plans WHERE hash='hash789'")
test "$CONTENT_WITHOUT_PATH" = "Content without file path" || {
  echo "FAIL: Plan content should work without file_path"
  exit 1
}

# Test 5: Plan approval gate concept (status transitions)
# Insert a plan in draft status
db "INSERT INTO plans(conversation_id, content, hash, status) VALUES ('test_conv', 'Plan for approval', 'approval_test', 'draft')"

# Update to approved status
db "UPDATE plans SET status='approved', approved_at=datetime('now') WHERE hash='approval_test'"

APPROVED_STATUS=$(db "SELECT status FROM plans WHERE hash='approval_test'")
test "$APPROVED_STATUS" = "approved" || {
  echo "FAIL: Cannot transition plan to approved status"
  exit 1
}

# Test 6: Multiple plans per conversation allowed
db "INSERT INTO plans(conversation_id, content, hash, status) VALUES ('test_conv', 'Plan 1', 'plan1', 'draft')"
db "INSERT INTO plans(conversation_id, content, hash, status) VALUES ('test_conv', 'Plan 2', 'plan2', 'approved')"

PLAN_COUNT=$(db "SELECT COUNT(*) FROM plans WHERE conversation_id='test_conv'")
test "$PLAN_COUNT" -gt 1 || {
  echo "FAIL: Should allow multiple plans per conversation"
  exit 1
}

echo "✓ Plans structure validated"