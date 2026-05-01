#!/usr/bin/env node
/**
 * Unit Tests: resolveModelArg()
 * 
 * Validates Requirements: 1.4, 2.3, 2.4, 17.1-17.5, 18.1-18.5
 * 
 * Tests all scenarios for model argument resolution
 */

import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import assert from 'node:assert'

// Read resolveModelArg from bin/agent.mjs
const __dirname = dirname(fileURLToPath(import.meta.url))
const agentCode = readFileSync(join(__dirname, '../../bin/agent.mjs'), 'utf8')

// Extract resolveModelArg function
const resolveModelArgMatch = agentCode.match(/function resolveModelArg\(arg\) \{[\s\S]*?\n\}/m)
if (!resolveModelArgMatch) {
  throw new Error('Could not find resolveModelArg function in bin/agent.mjs')
}

// Create a minimal context to evaluate the function
const { allModelIds, supportsCustomModels } = await import('../../lib/modelConfig.mjs')
const resolveModelArg = eval(`(${resolveModelArgMatch[0]})`)

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

console.log('Running unit tests for resolveModelArg()...\n')

// Test 1: Exact match in hardcoded map (with provider prefix)
test('Exact match in hardcoded map with provider prefix', () => {
  const result = resolveModelArg('ollama/deepseek_coder_v2')
  assert.strictEqual(result.provider, 'ollama')
  assert.strictEqual(result.model_id, 'deepseek_coder_v2')
  assert.strictEqual(result.custom_model_name, undefined)
})

// Test 2: Exact match in hardcoded map (model_id only)
test('Exact match in hardcoded map with model_id only', () => {
  const result = resolveModelArg('gpt_4o')
  assert.strictEqual(result.provider, 'openai_compatible')
  assert.strictEqual(result.model_id, 'gpt_4o')
})

// Test 3: Custom model with flexible provider (openai_compatible)
test('Custom model with flexible provider (openai_compatible)', () => {
  const result = resolveModelArg('openai_compatible/my-custom-model')
  assert.strictEqual(result.provider, 'openai_compatible')
  assert.strictEqual(result.model_id, 'my-custom-model')
  assert.strictEqual(result.custom_model_name, 'my-custom-model')
})

// Test 4: Custom model with flexible provider (ollama)
test('Custom model with flexible provider (ollama)', () => {
  const result = resolveModelArg('ollama/llama3')
  assert.strictEqual(result.provider, 'ollama')
  assert.strictEqual(result.model_id, 'llama3')
  assert.strictEqual(result.custom_model_name, 'llama3')
})

// Test 5: Custom model with flexible provider (lm_studio_local)
test('Custom model with flexible provider (lm_studio_local)', () => {
  const result = resolveModelArg('lm_studio_local/my-model')
  assert.strictEqual(result.provider, 'lm_studio_local')
  assert.strictEqual(result.model_id, 'my-model')
  assert.strictEqual(result.custom_model_name, 'my-model')
})

// Test 6: Custom model rejected for restricted provider (claude_code_subscription)
test('Custom model rejected for restricted provider (claude_code_subscription)', () => {
  const result = resolveModelArg('claude_code_subscription/my-custom-model')
  assert.ok(result.error, 'Should return error')
  assert.ok(result.error.includes('claude_code_subscription'), 'Error should mention provider')
  assert.ok(result.error.toLowerCase().includes('does not support custom'), 'Error should explain restriction')
})

// Test 7: Custom model rejected for restricted provider (zhipu)
test('Custom model rejected for restricted provider (zhipu)', () => {
  const result = resolveModelArg('zhipu/my-custom-model')
  assert.ok(result.error, 'Should return error')
  assert.ok(result.error.includes('zhipu'), 'Error should mention provider')
})

// Test 8: Freeform name defaults to openai_compatible
test('Freeform name defaults to openai_compatible', () => {
  const result = resolveModelArg('my-random-model-123')
  assert.strictEqual(result.provider, 'openai_compatible')
  assert.strictEqual(result.model_id, 'my-random-model-123')
  assert.strictEqual(result.custom_model_name, 'my-random-model-123')
})

// Test 9: Provider/model parsing (split on first "/" only)
test('Provider/model parsing splits on first "/" only', () => {
  const result = resolveModelArg('ollama/model/with/slashes')
  assert.strictEqual(result.provider, 'ollama')
  // The model_id and custom_model_name should be everything after first "/"
  assert.strictEqual(result.model_id, 'model/with/slashes')
  assert.strictEqual(result.custom_model_name, 'model/with/slashes')
})

// Test 10: Empty string returns error
test('Empty string returns error', () => {
  const result = resolveModelArg('')
  assert.ok(result.error, 'Should return error for empty string')
  assert.ok(result.error.toLowerCase().includes('empty'), 'Error should mention empty')
})

// Test 11: Whitespace-only string returns error
test('Whitespace-only string returns error', () => {
  const result = resolveModelArg('   ')
  assert.ok(result.error, 'Should return error for whitespace')
})

// Test 12: Unknown provider returns error
test('Unknown provider returns error', () => {
  const result = resolveModelArg('unknown_provider/model')
  assert.ok(result.error, 'Should return error')
  assert.ok(result.error.includes('Unknown provider'), 'Error should mention unknown provider')
  assert.ok(result.error.includes('unknown_provider'), 'Error should include provider name')
})

// Test 13: Empty provider name returns error
test('Empty provider name returns error', () => {
  const result = resolveModelArg('/model-name')
  assert.ok(result.error, 'Should return error')
  assert.ok(result.error.toLowerCase().includes('provider'), 'Error should mention provider')
  assert.ok(result.error.toLowerCase().includes('empty'), 'Error should mention empty')
})

// Test 14: Empty model name returns error
test('Empty model name returns error', () => {
  const result = resolveModelArg('ollama/')
  assert.ok(result.error, 'Should return error')
  assert.ok(result.error.toLowerCase().includes('model'), 'Error should mention model')
  assert.ok(result.error.toLowerCase().includes('empty'), 'Error should mention empty')
})

// Test 15: All hardcoded models work with provider prefix
test('All hardcoded models work with provider prefix', () => {
  const allModels = allModelIds()
  for (const model of allModels) {
    if (model.provider === 'lm_studio_local') continue // Skip lm_studio_local
    
    const arg = `${model.provider}/${model.model_id}`
    const result = resolveModelArg(arg)
    
    assert.ok(!result.error, `Should not error for ${arg}`)
    assert.strictEqual(result.provider, model.provider, `Provider should match for ${arg}`)
    assert.strictEqual(result.model_id, model.model_id, `Model ID should match for ${arg}`)
  }
})

// Test 16: Error message includes valid models list for restricted providers
test('Error message includes valid models list for restricted providers', () => {
  const result = resolveModelArg('claude_code_subscription/invalid-model')
  assert.ok(result.error, 'Should return error')
  assert.ok(result.error.includes('claude_opus_4') || result.error.includes('Valid models'), 'Error should list valid models')
})

// Test 17: Error message suggests flexible providers
test('Error message suggests flexible providers for restricted providers', () => {
  const result = resolveModelArg('zhipu/invalid-model')
  assert.ok(result.error, 'Should return error')
  assert.ok(result.error.includes('ollama') || result.error.includes('openai_compatible'), 'Error should suggest flexible providers')
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
console.log('resolveModelArg() validated for Requirements 1.4, 2.3, 2.4, 17.1-17.5, 18.1-18.5')
