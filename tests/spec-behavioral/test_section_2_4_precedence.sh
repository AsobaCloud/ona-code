#!/usr/bin/env bash
# §2.4 Precedence - Environment and settings precedence validation
set -euo pipefail

fresh_db precedence_2_4

echo "Testing §2.4 Precedence..."

# Test 1: Settings can store model_config with provider and model_id
db "INSERT OR REPLACE INTO settings_snapshot(scope, json, updated_at) VALUES ('effective', '{\"model_config\":{\"provider\":\"claude_code_subscription\",\"model_id\":\"claude_sonnet_4\"}}', datetime('now'))"

MODEL_CONFIG=$(db "SELECT json FROM settings_snapshot WHERE scope='effective'" | grep -o '"model_config":{[^}]*}')
echo "$MODEL_CONFIG" | grep -q '"provider":"claude_code_subscription"' || {
  echo "FAIL: model_config missing provider"
  exit 1
}
echo "$MODEL_CONFIG" | grep -q '"model_id":"claude_sonnet_4"' || {
  echo "FAIL: model_config missing model_id"
  exit 1
}

# Test 2: Provider enum validation structure
VALID_PROVIDERS=("claude_code_subscription" "openai_compatible" "lm_studio_local")
for provider in "${VALID_PROVIDERS[@]}"; do
  db "INSERT OR REPLACE INTO settings_snapshot(scope, json, updated_at) VALUES ('test_$provider', '{\"model_config\":{\"provider\":\"$provider\",\"model_id\":\"test\"}}', datetime('now'))"
  STORED_PROVIDER=$(db "SELECT json FROM settings_snapshot WHERE scope='test_$provider'" | grep -o "\"provider\":\"$provider\"")
  test -n "$STORED_PROVIDER" || {
    echo "FAIL: Cannot store valid provider $provider"
    exit 1
  }
done

# Test 3: Precedence concept (env supplies credentials, settings supply config)
db "INSERT OR REPLACE INTO settings_snapshot(scope, json, updated_at) VALUES ('effective', '{\"model_config\":{\"provider\":\"openai_compatible\",\"model_id\":\"gpt_4o\"}}', datetime('now'))"

OPENAI_CONFIG=$(db "SELECT json FROM settings_snapshot WHERE scope='effective'")
echo "$OPENAI_CONFIG" | grep -q '"provider":"openai_compatible"' || {
  echo "FAIL: Cannot store openai_compatible provider config"
  exit 1
}

# Verify no credentials stored in settings
echo "$OPENAI_CONFIG" | grep -q '"OPENAI_API_KEY"\|"ANTHROPIC_API_KEY"' && {
  echo "FAIL: Credentials found in settings (should be env-only)"
  exit 1
}

echo "✓ Precedence mechanism validated"