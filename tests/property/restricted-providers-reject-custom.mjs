#!/usr/bin/env node
/**
 * Property Test: Restricted Providers Reject Custom Models
 * 
 * Validates Requirements: 2.2, 2.3
 * 
 * Property 8: Restricted Providers Reject Custom Models
 * - claude_code_subscription, zhipu reject unknown model names
 * - Verify null/error is returned for invalid custom models
 */

import fc from 'fast-check'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

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

// Arbitrary generators
const restrictedProviders = ['claude_code_subscription', 'zhipu']
const customModelNameArbitrary = fc.string({ minLength: 1, maxLength: 50 })
  .filter(s => s.trim().length > 0 && !s.includes('/'))
  .filter(s => {
    // Filter out known model_ids to ensure we're testing custom models
    const allModels = allModelIds()
    return !allModels.some(m => m.model_id === s)
  })

// Property 8: Restricted providers reject unknown custom models
console.log('Running Property 8: Restricted providers reject unknown custom models...')

const property8 = fc.property(
  fc.constantFrom(...restrictedProviders),
  customModelNameArbitrary,
  (provider, modelName) => {
    const arg = `${provider}/${modelName}`
    const result = resolveModelArg(arg)
    
    // Should return error or null
    if (!result || result.error) {
      return true // Correctly rejected
    }
    
    console.error('Restricted provider accepted custom model!')
    console.error('Provider:', provider)
    console.error('Model:', modelName)
    console.error('Result:', result)
    return false
  }
)

try {
  fc.assert(property8, { numRuns: 100, verbose: true })
  console.log('✓ Property 8 passed: Restricted providers reject unknown custom models')
} catch (error) {
  console.error('✗ Property 8 failed:', error.message)
  process.exit(1)
}

// Property 8b: Restricted providers accept known models
console.log('\nRunning Property 8b: Restricted providers accept known models...')

const allModels = allModelIds()
const restrictedModels = allModels.filter(m => restrictedProviders.includes(m.provider))

let testCount = 0
let passCount = 0

for (const model of restrictedModels) {
  testCount++
  const arg = `${model.provider}/${model.model_id}`
  const result = resolveModelArg(arg)
  
  if (result && !result.error && result.provider === model.provider && result.model_id === model.model_id) {
    passCount++
  } else {
    console.error(`✗ Restricted provider rejected known model: ${arg}`)
    console.error('Result:', result)
  }
}

if (passCount === testCount) {
  console.log(`✓ Property 8b passed: All ${testCount} known models accepted by restricted providers`)
} else {
  console.error(`✗ Property 8b failed: ${passCount}/${testCount} tests passed`)
  process.exit(1)
}

// Property 8c: Error messages are descriptive for restricted providers
console.log('\nRunning Property 8c: Error messages are descriptive for restricted providers...')

const property8c = fc.property(
  fc.constantFrom(...restrictedProviders),
  customModelNameArbitrary,
  (provider, modelName) => {
    const arg = `${provider}/${modelName}`
    const result = resolveModelArg(arg)
    
    // Should have an error
    if (!result || !result.error) {
      console.error('No error returned for invalid custom model!')
      console.error('Provider:', provider)
      console.error('Model:', modelName)
      return false
    }
    
    // Error should mention the provider
    if (!result.error.includes(provider)) {
      console.error('Error message does not mention provider!')
      console.error('Provider:', provider)
      console.error('Error:', result.error)
      return false
    }
    
    // Error should mention "does not support custom models" or similar
    if (!result.error.toLowerCase().includes('does not support custom')) {
      console.error('Error message does not explain restriction!')
      console.error('Error:', result.error)
      return false
    }
    
    return true
  }
)

try {
  fc.assert(property8c, { numRuns: 50, verbose: true })
  console.log('✓ Property 8c passed: Error messages are descriptive')
} catch (error) {
  console.error('✗ Property 8c failed:', error.message)
  process.exit(1)
}

console.log('\n✓ All property tests passed!')
console.log('Restricted provider validation validated for Requirements 2.2, 2.3')
