#!/usr/bin/env node
/**
 * Property Test: Flexible Providers Accept Custom Models
 * 
 * Validates Requirements: 1.4, 2.1, 2.4
 * 
 * Property 7: Flexible Providers Accept Custom Models
 * - ollama, openai_compatible, lm_studio_local accept arbitrary model names
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
const flexibleProviders = ['ollama', 'openai_compatible', 'lm_studio_local']
const customModelNameArbitrary = fc.string({ minLength: 1, maxLength: 50 })
  .filter(s => s.trim().length > 0 && !s.includes('/'))

// Property 7: Flexible providers accept arbitrary custom models
console.log('Running Property 7: Flexible providers accept arbitrary custom models...')

const property7 = fc.property(
  fc.constantFrom(...flexibleProviders),
  customModelNameArbitrary,
  (provider, modelName) => {
    const arg = `${provider}/${modelName}`
    const result = resolveModelArg(arg)
    
    // Should not return error
    if (result && result.error) {
      console.error('Flexible provider rejected custom model!')
      console.error('Provider:', provider)
      console.error('Model:', modelName)
      console.error('Error:', result.error)
      return false
    }
    
    // Should return a valid config
    if (!result || !result.provider || !result.model_id) {
      console.error('Invalid result for flexible provider!')
      console.error('Provider:', provider)
      console.error('Model:', modelName)
      console.error('Result:', result)
      return false
    }
    
    // Should have custom_model_name set
    if (result.custom_model_name !== modelName) {
      console.error('custom_model_name not set correctly!')
      console.error('Expected:', modelName)
      console.error('Got:', result.custom_model_name)
      return false
    }
    
    return true
  }
)

try {
  fc.assert(property7, { numRuns: 200, verbose: true })
  console.log('✓ Property 7 passed: Flexible providers accept arbitrary custom models')
} catch (error) {
  console.error('✗ Property 7 failed:', error.message)
  process.exit(1)
}

// Property 7b: Flexible providers accept models with special characters
console.log('\nRunning Property 7b: Flexible providers accept models with special characters...')

const specialCharModelArbitrary = fc.string({ minLength: 1, maxLength: 30 })
  .map(s => s.replace(/\//g, '-')) // Remove slashes
  .filter(s => s.trim().length > 0)

const property7b = fc.property(
  fc.constantFrom(...flexibleProviders),
  specialCharModelArbitrary,
  (provider, modelName) => {
    const arg = `${provider}/${modelName}`
    const result = resolveModelArg(arg)
    
    // Should not return error
    if (result && result.error) {
      console.error('Special character model rejected!')
      console.error('Provider:', provider)
      console.error('Model:', modelName)
      console.error('Error:', result.error)
      return false
    }
    
    // Should have custom_model_name set
    return result && result.custom_model_name === modelName
  }
)

try {
  fc.assert(property7b, { numRuns: 100, verbose: true })
  console.log('✓ Property 7b passed: Flexible providers accept models with special characters')
} catch (error) {
  console.error('✗ Property 7b failed:', error.message)
  process.exit(1)
}

// Property 7c: Flexible providers work with freeform names (no provider prefix)
console.log('\nRunning Property 7c: Freeform names default to openai_compatible...')

const property7c = fc.property(
  customModelNameArbitrary,
  (modelName) => {
    // Check if this is a known model_id in WIRE map
    const allModels = allModelIds()
    const isKnownModel = allModels.some(m => m.model_id === modelName)
    
    if (isKnownModel) {
      // Skip known models - they should match WIRE map
      return true
    }
    
    const result = resolveModelArg(modelName)
    
    // Should not return error
    if (result && result.error) {
      console.error('Freeform name rejected!')
      console.error('Model:', modelName)
      console.error('Error:', result.error)
      return false
    }
    
    // Should default to openai_compatible
    if (result.provider !== 'openai_compatible') {
      console.error('Freeform name did not default to openai_compatible!')
      console.error('Model:', modelName)
      console.error('Provider:', result.provider)
      return false
    }
    
    // Should have custom_model_name set
    if (result.custom_model_name !== modelName) {
      console.error('custom_model_name not set for freeform name!')
      console.error('Expected:', modelName)
      console.error('Got:', result.custom_model_name)
      return false
    }
    
    return true
  }
)

try {
  fc.assert(property7c, { numRuns: 100, verbose: true })
  console.log('✓ Property 7c passed: Freeform names default to openai_compatible')
} catch (error) {
  console.error('✗ Property 7c failed:', error.message)
  process.exit(1)
}

console.log('\n✓ All property tests passed!')
console.log('Flexible provider custom model support validated for Requirements 1.4, 2.1, 2.4')
