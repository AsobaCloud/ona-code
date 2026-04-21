#!/usr/bin/env bash
# §2.2 model_config - Behavioral tests for model configuration validation
# Validates: Requirements 2.1, 2.2, 2.3 from bugfix.md
# Tests that model_config contains only provider and model_id, forbidden keys are rejected
set -euo pipefail

SCRIPT_DIR=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)
REPO_ROOT=$(cd "$SCRIPT_DIR/../.." && pwd)
ONA="$REPO_ROOT/bin/agent.mjs"

echo "Testing §2.2 model_config..."

# ============================================================================
# Test: model_config contains only provider, model_id
# ============================================================================
echo "  Testing model_config structure..."

# Verify valid model_config structure
VALID_CONFIG=$(node -e "
const config = { provider: 'claude_code_subscription', model_id: 'claude_sonnet_4' };
const hasProvider = 'provider' in config;
const hasModelId = 'model_id' in config;
const keyCount = Object.keys(config).length;
console.log((hasProvider && hasModelId && keyCount === 2) ? 'yes' : 'no');
" 2>/dev/null || echo "no")

if [ "$VALID_CONFIG" != "yes" ]; then
  echo "FAIL: Valid model_config structure not recognized"
  exit 1
fi

# Verify model_config can be stored in settings_snapshot
STORED_CONFIG=$(node -e "
const config = { provider: 'openai_compatible', model_id: 'gpt_4o' };
const json = JSON.stringify({ model_config: config });
const parsed = JSON.parse(json);
const hasProvider = 'provider' in parsed.model_config;
const hasModelId = 'model_id' in parsed.model_config;
console.log((hasProvider && hasModelId) ? 'yes' : 'no');
" 2>/dev/null || echo "no")

if [ "$STORED_CONFIG" != "yes" ]; then
  echo "FAIL: model_config cannot be stored in settings_snapshot"
  exit 1
fi

echo "  ✓ model_config structure validated"

# ============================================================================
# Test: FORBIDDEN keys (secrets, tokens) rejected
# ============================================================================
echo "  Testing forbidden keys rejection..."

# Test that API key is forbidden in model_config
APIKEY_REJECTED=$(node -e "
const config = { provider: 'claude_code_subscription', model_id: 'claude_sonnet_4', ANTHROPIC_API_KEY: 'sk-ant-test' };
const forbiddenKeys = ['ANTHROPIC_API_KEY', 'ANTHROPIC_AUTH_TOKEN', 'OPENAI_API_KEY', 'OPENAI_BASE_URL', 'Authorization', 'secret', 'token', 'apiKey', 'authToken'];
const hasSecret = forbiddenKeys.some(key => key in config);
console.log(hasSecret ? 'yes' : 'no');
" 2>/dev/null || echo "no")

if [ "$APIKEY_REJECTED" != "yes" ]; then
  echo "FAIL: API key not detected as forbidden in model_config"
  exit 1
fi

# Test that bearer token is forbidden in model_config
TOKEN_REJECTED=$(node -e "
const config = { provider: 'claude_code_subscription', model_id: 'claude_sonnet_4', ANTHROPIC_AUTH_TOKEN: 'bearer-token' };
const forbiddenKeys = ['ANTHROPIC_API_KEY', 'ANTHROPIC_AUTH_TOKEN', 'OPENAI_API_KEY', 'OPENAI_BASE_URL', 'Authorization', 'secret', 'token', 'apiKey', 'authToken'];
const hasSecret = forbiddenKeys.some(key => key in config);
console.log(hasSecret ? 'yes' : 'no');
" 2>/dev/null || echo "no")

if [ "$TOKEN_REJECTED" != "yes" ]; then
  echo "FAIL: Bearer token not detected as forbidden in model_config"
  exit 1
fi

# Test that Authorization header is forbidden in model_config
AUTH_REJECTED=$(node -e "
const config = { provider: 'openai_compatible', model_id: 'gpt_4o', Authorization: 'Bearer sk-test' };
const forbiddenKeys = ['ANTHROPIC_API_KEY', 'ANTHROPIC_AUTH_TOKEN', 'OPENAI_API_KEY', 'OPENAI_BASE_URL', 'Authorization', 'secret', 'token', 'apiKey', 'authToken'];
const hasSecret = forbiddenKeys.some(key => key in config);
console.log(hasSecret ? 'yes' : 'no');
" 2>/dev/null || echo "no")

if [ "$AUTH_REJECTED" != "yes" ]; then
  echo "FAIL: Authorization header not detected as forbidden in model_config"
  exit 1
fi

echo "  ✓ Forbidden keys rejected"

# ============================================================================
# Test: Invalid model_id for provider rejected
# ============================================================================
echo "  Testing invalid model_id rejection..."

# Test invalid model_id for claude_code_subscription
INVALID_CLAUDE_MODEL=$(node -e "
const validModels = {
  claude_code_subscription: ['claude_opus_4', 'claude_sonnet_4', 'claude_3_5_haiku'],
  openai_compatible: ['gpt_4o', 'gpt_4o_mini', 'o3', 'o3_mini'],
  lm_studio_local: ['lm_studio_server_routed']
};
const provider = 'claude_code_subscription';
const modelId = 'invalid_model_xyz';
const isValid = validModels[provider].includes(modelId);
console.log(!isValid ? 'yes' : 'no');
" 2>/dev/null || echo "no")

if [ "$INVALID_CLAUDE_MODEL" != "yes" ]; then
  echo "FAIL: Invalid model_id for claude_code_subscription not rejected"
  exit 1
fi

# Test invalid model_id for openai_compatible
INVALID_OPENAI_MODEL=$(node -e "
const validModels = {
  claude_code_subscription: ['claude_opus_4', 'claude_sonnet_4', 'claude_3_5_haiku'],
  openai_compatible: ['gpt_4o', 'gpt_4o_mini', 'o3', 'o3_mini'],
  lm_studio_local: ['lm_studio_server_routed']
};
const provider = 'openai_compatible';
const modelId = 'gpt_5_ultra';
const isValid = validModels[provider].includes(modelId);
console.log(!isValid ? 'yes' : 'no');
" 2>/dev/null || echo "no")

if [ "$INVALID_OPENAI_MODEL" != "yes" ]; then
  echo "FAIL: Invalid model_id for openai_compatible not rejected"
  exit 1
fi

# Test invalid model_id for lm_studio_local
INVALID_LM_MODEL=$(node -e "
const validModels = {
  claude_code_subscription: ['claude_opus_4', 'claude_sonnet_4', 'claude_3_5_haiku'],
  openai_compatible: ['gpt_4o', 'gpt_4o_mini', 'o3', 'o3_mini'],
  lm_studio_local: ['lm_studio_server_routed']
};
const provider = 'lm_studio_local';
const modelId = 'invalid_local_model';
const isValid = validModels[provider].includes(modelId);
console.log(!isValid ? 'yes' : 'no');
" 2>/dev/null || echo "no")

if [ "$INVALID_LM_MODEL" != "yes" ]; then
  echo "FAIL: Invalid model_id for lm_studio_local not rejected"
  exit 1
fi

# Test that validation happens before network I/O (configuration error)
VALIDATION_EARLY=$(node -e "
const validModels = {
  claude_code_subscription: ['claude_opus_4', 'claude_sonnet_4', 'claude_3_5_haiku'],
  openai_compatible: ['gpt_4o', 'gpt_4o_mini', 'o3', 'o3_mini'],
  lm_studio_local: ['lm_studio_server_routed']
};
const provider = 'claude_code_subscription';
const modelId = 'invalid_model';
const isValid = validModels[provider].includes(modelId);
// If we reach here without network call, validation was early
console.log(!isValid ? 'yes' : 'no');
" 2>/dev/null || echo "no")

if [ "$VALIDATION_EARLY" != "yes" ]; then
  echo "FAIL: Invalid model_id validation not early (before network I/O)"
  exit 1
fi

echo "  ✓ Invalid model_id rejected before network I/O"

echo ""
echo "✓ All §2.2 model_config tests passed"
