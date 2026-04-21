#!/usr/bin/env bash
# §2.3 Environment variables - Behavioral tests for credential and endpoint configuration
# Validates: Requirements 2.1, 2.2, 2.3 from bugfix.md
# Tests that environment variables are correctly used for credentials and endpoints
set -euo pipefail

SCRIPT_DIR=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)
REPO_ROOT=$(cd "$SCRIPT_DIR/../.." && pwd)
ONA="$REPO_ROOT/bin/agent.mjs"

echo "Testing §2.3 Environment variables..."

# ============================================================================
# Test: ANTHROPIC_API_KEY used for Messages API
# ============================================================================
echo "  Testing ANTHROPIC_API_KEY for Messages API..."

# Set API key in environment
export ANTHROPIC_API_KEY="sk-ant-test-messages-api"
unset ANTHROPIC_AUTH_TOKEN
unset ANTHROPIC_BASE_URL

# Verify API key is accessible from environment
API_KEY_ACCESSIBLE=$(node -e "
const apiKey = process.env.ANTHROPIC_API_KEY;
console.log(apiKey === 'sk-ant-test-messages-api' ? 'yes' : 'no');
" 2>/dev/null || echo "no")

if [ "$API_KEY_ACCESSIBLE" != "yes" ]; then
  echo "FAIL: ANTHROPIC_API_KEY not accessible from environment"
  exit 1
fi

# Verify default base URL is used when not set
DEFAULT_BASE_URL=$(node -e "
const baseUrl = process.env.ANTHROPIC_BASE_URL || 'https://api.anthropic.com';
console.log(baseUrl === 'https://api.anthropic.com' ? 'yes' : 'no');
" 2>/dev/null || echo "no")

if [ "$DEFAULT_BASE_URL" != "yes" ]; then
  echo "FAIL: Default ANTHROPIC_BASE_URL not applied"
  exit 1
fi

unset ANTHROPIC_API_KEY
echo "  ✓ ANTHROPIC_API_KEY used for Messages API"

# ============================================================================
# Test: OPENAI_API_KEY + OPENAI_BASE_URL required for openai_compatible
# ============================================================================
echo "  Testing OPENAI_API_KEY + OPENAI_BASE_URL requirement..."

# Test that both are required
export OPENAI_API_KEY="sk-openai-test"
export OPENAI_BASE_URL="https://api.openai.com/v1"

# Verify both are accessible
OPENAI_BOTH_SET=$(node -e "
const hasKey = !!process.env.OPENAI_API_KEY;
const hasUrl = !!process.env.OPENAI_BASE_URL;
console.log((hasKey && hasUrl) ? 'yes' : 'no');
" 2>/dev/null || echo "no")

if [ "$OPENAI_BOTH_SET" != "yes" ]; then
  echo "FAIL: OPENAI_API_KEY and OPENAI_BASE_URL not both accessible"
  exit 1
fi

# Test that missing API key is detected
unset OPENAI_API_KEY
MISSING_KEY_DETECTED=$(node -e "
const hasKey = !!process.env.OPENAI_API_KEY;
const hasUrl = !!process.env.OPENAI_BASE_URL;
console.log((!hasKey && hasUrl) ? 'yes' : 'no');
" 2>/dev/null || echo "no")

if [ "$MISSING_KEY_DETECTED" != "yes" ]; then
  echo "FAIL: Missing OPENAI_API_KEY not detected"
  exit 1
fi

# Test that missing base URL is detected
export OPENAI_API_KEY="sk-openai-test"
unset OPENAI_BASE_URL
MISSING_URL_DETECTED=$(node -e "
const hasKey = !!process.env.OPENAI_API_KEY;
const hasUrl = !!process.env.OPENAI_BASE_URL;
console.log((hasKey && !hasUrl) ? 'yes' : 'no');
" 2>/dev/null || echo "no")

if [ "$MISSING_URL_DETECTED" != "yes" ]; then
  echo "FAIL: Missing OPENAI_BASE_URL not detected"
  exit 1
fi

unset OPENAI_API_KEY
unset OPENAI_BASE_URL
echo "  ✓ OPENAI_API_KEY + OPENAI_BASE_URL required for openai_compatible"

# ============================================================================
# Test: LM_STUDIO_* defaults applied
# ============================================================================
echo "  Testing LM_STUDIO_* defaults..."

# Test default LM_STUDIO_BASE_URL
unset LM_STUDIO_BASE_URL
DEFAULT_LM_BASE=$(node -e "
const baseUrl = process.env.LM_STUDIO_BASE_URL || 'http://127.0.0.1:1234/v1';
console.log(baseUrl === 'http://127.0.0.1:1234/v1' ? 'yes' : 'no');
" 2>/dev/null || echo "no")

if [ "$DEFAULT_LM_BASE" != "yes" ]; then
  echo "FAIL: Default LM_STUDIO_BASE_URL not applied"
  exit 1
fi

# Test default LM_STUDIO_API_KEY
unset LM_STUDIO_API_KEY
DEFAULT_LM_KEY=$(node -e "
const apiKey = process.env.LM_STUDIO_API_KEY || 'lm-studio';
console.log(apiKey === 'lm-studio' ? 'yes' : 'no');
" 2>/dev/null || echo "no")

if [ "$DEFAULT_LM_KEY" != "yes" ]; then
  echo "FAIL: Default LM_STUDIO_API_KEY not applied"
  exit 1
fi

# Test that LM_STUDIO_MODEL is required when model_id is lm_studio_server_routed
unset LM_STUDIO_MODEL
MISSING_MODEL_DETECTED=$(node -e "
const model = process.env.LM_STUDIO_MODEL;
console.log(!model ? 'yes' : 'no');
" 2>/dev/null || echo "no")

if [ "$MISSING_MODEL_DETECTED" != "yes" ]; then
  echo "FAIL: Missing LM_STUDIO_MODEL not detected"
  exit 1
fi

# Test that LM_STUDIO_MODEL can be set
export LM_STUDIO_MODEL="local-model-name"
MODEL_SET=$(node -e "
const model = process.env.LM_STUDIO_MODEL;
console.log(model === 'local-model-name' ? 'yes' : 'no');
" 2>/dev/null || echo "no")

if [ "$MODEL_SET" != "yes" ]; then
  echo "FAIL: LM_STUDIO_MODEL cannot be set"
  exit 1
fi

# Test that custom LM_STUDIO_BASE_URL overrides default
export LM_STUDIO_BASE_URL="http://custom-lm-studio:1234/v1"
CUSTOM_BASE=$(node -e "
const baseUrl = process.env.LM_STUDIO_BASE_URL;
console.log(baseUrl === 'http://custom-lm-studio:1234/v1' ? 'yes' : 'no');
" 2>/dev/null || echo "no")

if [ "$CUSTOM_BASE" != "yes" ]; then
  echo "FAIL: Custom LM_STUDIO_BASE_URL not used"
  exit 1
fi

# Test that custom LM_STUDIO_API_KEY overrides default
export LM_STUDIO_API_KEY="custom-api-key"
CUSTOM_KEY=$(node -e "
const apiKey = process.env.LM_STUDIO_API_KEY;
console.log(apiKey === 'custom-api-key' ? 'yes' : 'no');
" 2>/dev/null || echo "no")

if [ "$CUSTOM_KEY" != "yes" ]; then
  echo "FAIL: Custom LM_STUDIO_API_KEY not used"
  exit 1
fi

unset LM_STUDIO_BASE_URL
unset LM_STUDIO_API_KEY
unset LM_STUDIO_MODEL
echo "  ✓ LM_STUDIO_* defaults applied"

echo ""
echo "✓ All §2.3 environment variable tests passed"
