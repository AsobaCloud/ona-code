#!/usr/bin/env node
/**
 * Property Test: Model Discovery Response Validation
 * 
 * Validates Requirements: 7.2, 16.1, 16.2, 16.3
 * 
 * Property 11: Model Discovery Returns Valid Models
 * - All returned models have non-empty name fields
 */

import fc from 'fast-check'
import { discoverOllamaModels } from '../../lib/modelDiscovery.mjs'

// Mock fetch for testing
const originalFetch = global.fetch

// Arbitrary generators for Ollama API responses
const validModelArbitrary = fc.record({
  name: fc.string({ minLength: 1, maxLength: 100 }).filter(s => s.trim().length > 0),
  modified_at: fc.date().map(d => d.toISOString()),
  size: fc.nat({ max: 10_000_000_000 }),
  digest: fc.string({ minLength: 64, maxLength: 64 }),
  details: fc.option(fc.record({
    format: fc.constantFrom('gguf', 'safetensors'),
    family: fc.string(),
    parameter_size: fc.constantFrom('7B', '13B', '70B'),
    quantization_level: fc.constantFrom('Q4_0', 'Q5_1', 'Q8_0')
  }), { nil: null })
})

const validResponseArbitrary = fc.record({
  models: fc.array(validModelArbitrary, { minLength: 1, maxLength: 20 }) // Always at least 1 model
})

// Property 11: All returned models have non-empty name fields
console.log('Running Property 11: All returned models have non-empty name fields...')

const property11 = fc.asyncProperty(
  validResponseArbitrary,
  async (response) => {
    // Mock fetch to return our generated response
    global.fetch = async () => ({
      ok: true,
      status: 200,
      json: async () => response
    })
    
    try {
      const result = await discoverOllamaModels('http://localhost:11434')
      
      // Discovery should succeed
      if (!result.success) {
        return false
      }
      
      // All models should have non-empty names
      for (const model of result.models) {
        if (!model.name || typeof model.name !== 'string' || model.name.trim().length === 0) {
          return false
        }
      }
      
      // Count should match valid input models
      const validInputModels = response.models.filter(m => 
        m && m.name && typeof m.name === 'string' && m.name.trim().length > 0
      )
      
      return result.models.length === validInputModels.length
    } finally {
      global.fetch = originalFetch
    }
  }
)

try {
  await fc.assert(property11, { numRuns: 50 })
  console.log('✓ Property 11 passed: All returned models have valid names')
} catch (error) {
  console.error('✗ Property 11 failed:', error.message)
  process.exit(1)
}

// Property 11b: Invalid models are filtered out
console.log('\nRunning Property 11b: Invalid models are filtered out...')

const invalidModelArbitrary = fc.oneof(
  fc.constant(null),
  fc.constant(undefined),
  fc.record({ name: fc.constant('') }),
  fc.record({ name: fc.constant('   ') }),
  fc.record({ name: fc.constant(null) }),
  fc.record({ size: fc.nat() }) // Missing name field
)

const mixedResponseArbitrary = fc.record({
  models: fc.array(
    fc.oneof(validModelArbitrary, invalidModelArbitrary),
    { minLength: 1, maxLength: 10 }
  )
})

const property11b = fc.asyncProperty(
  mixedResponseArbitrary,
  async (response) => {
    global.fetch = async () => ({
      ok: true,
      status: 200,
      json: async () => response
    })
    
    try {
      const result = await discoverOllamaModels('http://localhost:11434')
      
      if (!result.success) {
        return false
      }
      
      // All returned models should have valid names
      for (const model of result.models) {
        if (!model.name || model.name.trim().length === 0) {
          return false
        }
      }
      
      return true
    } finally {
      global.fetch = originalFetch
    }
  }
)

try {
  await fc.assert(property11b, { numRuns: 50 })
  console.log('✓ Property 11b passed: Invalid models are filtered out')
} catch (error) {
  console.error('✗ Property 11b failed:', error.message)
  process.exit(1)
}

console.log('\n✓ All property tests passed!')
console.log('Discovery response validation validated for Requirements 7.2, 16.1, 16.2, 16.3')
