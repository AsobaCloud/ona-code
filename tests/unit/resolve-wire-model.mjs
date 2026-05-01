#!/usr/bin/env node
/**
 * Unit Tests: resolveWireModel()
 * 
 * Validates Requirements: 1.1, 1.2, 3.1, 3.2, 3.3, 12.3, 12.4, 12.5
 * 
 * Tests:
 * - Custom_model_name takes precedence over WIRE map
 * - Fallback to WIRE map when custom_model_name absent
 * - Error thrown for unknown provider
 * - Error thrown for invalid model_id (no custom_model_name)
 * - lm_studio_local env var logic still works
 * - Empty custom_model_name falls back to WIRE map
 */

import { resolveWireModel } from '../../lib/modelConfig.mjs'
import assert from 'node:assert'

let testsPassed = 0
let testsFailed = 0

function test(name, fn) {
  try {
    fn()
    console.log(`✓ ${name}`)
    testsPassed++
  } catch (error) {
    console.error(`✗ ${name}`)
    console.error(`  ${error.message}`)
    testsFailed++
  }
}

console.log('Running unit tests for resolveWireModel()...\n')

// Test 1: Custom_model_name takes precedence over WIRE map
test('Custom_model_name takes precedence over WIRE map', () => {
  const config = {
    provider: 'ollama',
    model_id: 'deepseek_coder_v2',
    custom_model_name: 'my-custom-model'
  }
  
  const result = resolveWireModel(config)
  assert.strictEqual(result, 'my-custom-model', 'Should return custom_model_name')
})

// Test 2: Fallback to WIRE map when custom_model_name absent
test('Fallback to WIRE map when custom_model_name absent', () => {
  const config = {
    provider: 'ollama',
    model_id: 'deepseek_coder_v2'
  }
  
  const result = resolveWireModel(config)
  assert.strictEqual(result, 'deepseek-coder-v2', 'Should return WIRE map value')
})

// Test 3: Error thrown for unknown provider
test('Error thrown for unknown provider', () => {
  const config = {
    provider: 'unknown_provider',
    model_id: 'some_model'
  }
  
  assert.throws(
    () => resolveWireModel(config),
    /Unknown provider/,
    'Should throw error for unknown provider'
  )
})

// Test 4: Error thrown for invalid model_id (no custom_model_name)
test('Error thrown for invalid model_id without custom_model_name', () => {
  const config = {
    provider: 'ollama',
    model_id: 'nonexistent_model'
  }
  
  assert.throws(
    () => resolveWireModel(config),
    /Invalid model_id/,
    'Should throw error for invalid model_id'
  )
})

// Test 5: lm_studio_local env var logic still works
test('lm_studio_local uses LM_STUDIO_MODEL env var', () => {
  // Save original env var
  const originalEnv = process.env.LM_STUDIO_MODEL
  
  try {
    process.env.LM_STUDIO_MODEL = 'test-model-from-env'
    
    const config = {
      provider: 'lm_studio_local',
      model_id: 'lm_studio_server_routed'
    }
    
    const result = resolveWireModel(config)
    assert.strictEqual(result, 'test-model-from-env', 'Should return env var value')
  } finally {
    // Restore original env var
    if (originalEnv !== undefined) {
      process.env.LM_STUDIO_MODEL = originalEnv
    } else {
      delete process.env.LM_STUDIO_MODEL
    }
  }
})

// Test 6: lm_studio_local throws error when env var not set
test('lm_studio_local throws error when LM_STUDIO_MODEL not set', () => {
  // Save original env var
  const originalEnv = process.env.LM_STUDIO_MODEL
  
  try {
    delete process.env.LM_STUDIO_MODEL
    
    const config = {
      provider: 'lm_studio_local',
      model_id: 'lm_studio_server_routed'
    }
    
    assert.throws(
      () => resolveWireModel(config),
      /LM_STUDIO_MODEL not set/,
      'Should throw error when env var not set'
    )
  } finally {
    // Restore original env var
    if (originalEnv !== undefined) {
      process.env.LM_STUDIO_MODEL = originalEnv
    }
  }
})

// Test 7: Empty custom_model_name falls back to WIRE map
test('Empty custom_model_name falls back to WIRE map', () => {
  const config = {
    provider: 'ollama',
    model_id: 'deepseek_coder_v2',
    custom_model_name: ''
  }
  
  const result = resolveWireModel(config)
  assert.strictEqual(result, 'deepseek-coder-v2', 'Should fall back to WIRE map for empty string')
})

// Test 8: Whitespace-only custom_model_name falls back to WIRE map
test('Whitespace-only custom_model_name falls back to WIRE map', () => {
  const config = {
    provider: 'ollama',
    model_id: 'deepseek_coder_v2',
    custom_model_name: '   '
  }
  
  const result = resolveWireModel(config)
  assert.strictEqual(result, 'deepseek-coder-v2', 'Should fall back to WIRE map for whitespace')
})

// Test 9: Custom_model_name with whitespace is trimmed
test('Custom_model_name with whitespace is trimmed', () => {
  const config = {
    provider: 'ollama',
    model_id: 'deepseek_coder_v2',
    custom_model_name: '  my-model  '
  }
  
  const result = resolveWireModel(config)
  assert.strictEqual(result, 'my-model', 'Should trim whitespace from custom_model_name')
})

// Test 10: All claude_code_subscription models work
test('All claude_code_subscription models resolve correctly', () => {
  const models = [
    { model_id: 'claude_opus_4', expected: 'claude-opus-4-20250514' },
    { model_id: 'claude_sonnet_4', expected: 'claude-sonnet-4-20250514' },
    { model_id: 'claude_3_5_haiku', expected: 'claude-3-5-haiku-20241022' }
  ]
  
  for (const { model_id, expected } of models) {
    const config = { provider: 'claude_code_subscription', model_id }
    const result = resolveWireModel(config)
    assert.strictEqual(result, expected, `Should resolve ${model_id} correctly`)
  }
})

// Test 11: All openai_compatible models work
test('All openai_compatible models resolve correctly', () => {
  const models = [
    { model_id: 'gpt_4o', expected: 'gpt-4o' },
    { model_id: 'gpt_4o_mini', expected: 'gpt-4o-mini' },
    { model_id: 'o3', expected: 'o3' },
    { model_id: 'o3_mini', expected: 'o3-mini' }
  ]
  
  for (const { model_id, expected } of models) {
    const config = { provider: 'openai_compatible', model_id }
    const result = resolveWireModel(config)
    assert.strictEqual(result, expected, `Should resolve ${model_id} correctly`)
  }
})

// Test 12: All zhipu models work
test('All zhipu models resolve correctly', () => {
  const config = { provider: 'zhipu', model_id: 'glm_4_7_flash' }
  const result = resolveWireModel(config)
  assert.strictEqual(result, 'glm-4.7-flash', 'Should resolve glm_4_7_flash correctly')
})

// Test 13: All ollama models work
test('All ollama models resolve correctly', () => {
  const models = [
    { model_id: 'deepseek_coder_v2', expected: 'deepseek-coder-v2' },
    { model_id: 'codegemma_7b', expected: 'codegemma:7b' }
  ]
  
  for (const { model_id, expected } of models) {
    const config = { provider: 'ollama', model_id }
    const result = resolveWireModel(config)
    assert.strictEqual(result, expected, `Should resolve ${model_id} correctly`)
  }
})

// Test 14: Custom_model_name works for all providers
test('Custom_model_name works for all providers', () => {
  const providers = ['claude_code_subscription', 'openai_compatible', 'zhipu', 'ollama', 'lm_studio_local']
  
  for (const provider of providers) {
    const config = {
      provider,
      model_id: 'any_id',
      custom_model_name: 'custom-model-123'
    }
    
    const result = resolveWireModel(config)
    assert.strictEqual(result, 'custom-model-123', `Should use custom_model_name for ${provider}`)
  }
})

// Summary
console.log(`\n${'='.repeat(50)}`)
console.log(`Tests passed: ${testsPassed}`)
console.log(`Tests failed: ${testsFailed}`)
console.log(`${'='.repeat(50)}`)

if (testsFailed > 0) {
  console.error('\n✗ Some tests failed')
  process.exit(1)
}

console.log('\n✓ All unit tests passed!')
console.log('resolveWireModel() validated for Requirements 1.1, 1.2, 3.1, 3.2, 3.3, 12.3, 12.4, 12.5')
