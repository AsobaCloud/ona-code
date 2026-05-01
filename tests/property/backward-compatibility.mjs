#!/usr/bin/env node
/**
 * Property Test: Backward Compatibility
 * 
 * Validates Requirements: 3.1, 3.2, 10.4
 * 
 * Property 6: Backward Compatibility Preserved
 * - Configurations without custom_model_name produce same output as before
 * - Compare new implementation against expected WIRE map results
 */

import fc from 'fast-check'
import { resolveWireModel, allModelIds } from '../../lib/modelConfig.mjs'

// Get all valid model configurations from WIRE map
const allModels = allModelIds()

// Expected WIRE map results (hardcoded for validation)
const EXPECTED_WIRE = {
  claude_code_subscription: {
    claude_opus_4: 'claude-opus-4-20250514',
    claude_sonnet_4: 'claude-sonnet-4-20250514',
    claude_3_5_haiku: 'claude-3-5-haiku-20241022',
  },
  openai_compatible: {
    gpt_4o: 'gpt-4o',
    gpt_4o_mini: 'gpt-4o-mini',
    o3: 'o3',
    o3_mini: 'o3-mini',
  },
  zhipu: {
    glm_4_7_flash: 'glm-4.7-flash',
  },
  ollama: {
    deepseek_coder_v2: 'deepseek-coder-v2',
    codegemma_7b: 'codegemma:7b',
  },
}

// Property 6: Backward Compatibility - All WIRE map entries work correctly
console.log('Running Property 6: Backward Compatibility for WIRE map entries...')

let testCount = 0
let passCount = 0

for (const model of allModels) {
  // Skip lm_studio_local as it requires env var
  if (model.provider === 'lm_studio_local') {
    continue
  }
  
  testCount++
  
  const modelConfig = {
    provider: model.provider,
    model_id: model.model_id
    // No custom_model_name - testing backward compatibility
  }
  
  try {
    const resolved = resolveWireModel(modelConfig)
    const expected = EXPECTED_WIRE[model.provider][model.model_id]
    
    if (resolved === expected) {
      passCount++
    } else {
      console.error(`✗ Backward compatibility broken for ${model.provider}/${model.model_id}`)
      console.error(`  Expected: ${expected}`)
      console.error(`  Got: ${resolved}`)
    }
  } catch (error) {
    console.error(`✗ Error resolving ${model.provider}/${model.model_id}:`, error.message)
  }
}

if (passCount === testCount) {
  console.log(`✓ Property 6 passed: All ${testCount} WIRE map entries work correctly`)
} else {
  console.error(`✗ Property 6 failed: ${passCount}/${testCount} tests passed`)
  process.exit(1)
}

// Property 6b: Configurations without custom_model_name never return custom values
console.log('\nRunning Property 6b: Configurations without custom_model_name use WIRE map...')

const property6b = fc.property(
  fc.constantFrom(...allModels.filter(m => m.provider !== 'lm_studio_local')),
  (model) => {
    const modelConfig = {
      provider: model.provider,
      model_id: model.model_id
      // No custom_model_name
    }
    
    try {
      const resolved = resolveWireModel(modelConfig)
      const expected = EXPECTED_WIRE[model.provider][model.model_id]
      
      const result = resolved === expected
      
      if (!result) {
        console.error('WIRE map lookup failed!')
        console.error('Config:', modelConfig)
        console.error('Expected:', expected)
        console.error('Got:', resolved)
      }
      
      return result
    } catch (error) {
      console.error('Unexpected error:', error.message)
      console.error('Config:', modelConfig)
      return false
    }
  }
)

try {
  fc.assert(property6b, { numRuns: 100, verbose: true })
  console.log('✓ Property 6b passed: WIRE map lookups are consistent')
} catch (error) {
  console.error('✗ Property 6b failed:', error.message)
  process.exit(1)
}

// Property 6c: Adding optional fields doesn't break backward compatibility
console.log('\nRunning Property 6c: Optional fields don\'t break backward compatibility...')

const property6c = fc.property(
  fc.constantFrom(...allModels.filter(m => m.provider !== 'lm_studio_local')),
  fc.option(fc.webUrl(), { nil: null }),
  (model, base_url) => {
    const modelConfig = {
      provider: model.provider,
      model_id: model.model_id,
      base_url // Optional field
      // No custom_model_name
    }
    
    try {
      const resolved = resolveWireModel(modelConfig)
      const expected = EXPECTED_WIRE[model.provider][model.model_id]
      
      const result = resolved === expected
      
      if (!result) {
        console.error('Optional field broke backward compatibility!')
        console.error('Config:', modelConfig)
        console.error('Expected:', expected)
        console.error('Got:', resolved)
      }
      
      return result
    } catch (error) {
      console.error('Unexpected error:', error.message)
      return false
    }
  }
)

try {
  fc.assert(property6c, { numRuns: 100, verbose: true })
  console.log('✓ Property 6c passed: Optional fields don\'t affect resolution')
} catch (error) {
  console.error('✗ Property 6c failed:', error.message)
  process.exit(1)
}

console.log('\n✓ All property tests passed!')
console.log('Backward compatibility validated for Requirements 3.1, 3.2, 10.4')
