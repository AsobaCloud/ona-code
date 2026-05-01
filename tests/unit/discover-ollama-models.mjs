#!/usr/bin/env node
/**
 * Unit Tests: discoverOllamaModels()
 * 
 * Validates Requirements: 7.1-7.5, 15.1-15.4, 16.1-16.5, 21.1-21.5, 23.1-23.5
 * 
 * Tests all scenarios for Ollama model discovery
 */

import { discoverOllamaModels } from '../../lib/modelDiscovery.mjs'
import assert from 'node:assert'

const originalFetch = global.fetch

let testsPassed = 0
let testsFailed = 0

function test(name, fn) {
  return (async () => {
    try {
      await fn()
      console.log(`✓ ${name}`)
      testsPassed++
    } catch (error) {
      console.error(`✗ ${name}`)
      console.error(`  ${error.message}`)
      testsFailed++
    } finally {
      global.fetch = originalFetch
    }
  })()
}

console.log('Running unit tests for discoverOllamaModels()...\n')

// Test 1: Successful discovery with valid response
await test('Successful discovery with valid response', async () => {
  global.fetch = async () => ({
    ok: true,
    status: 200,
    json: async () => ({
      models: [
        {
          name: 'llama3:latest',
          modified_at: '2024-01-15T10:30:00Z',
          size: 4661224676,
          digest: 'abc123',
          details: { format: 'gguf', family: 'llama', parameter_size: '7B' }
        },
        {
          name: 'mistral:latest',
          modified_at: '2024-01-14T09:00:00Z',
          size: 3825819519,
          digest: 'def456'
        }
      ]
    })
  })
  
  const result = await discoverOllamaModels('http://localhost:11434')
  
  assert.strictEqual(result.success, true)
  assert.strictEqual(result.models.length, 2)
  assert.strictEqual(result.models[0].name, 'llama3:latest')
  assert.strictEqual(result.models[1].name, 'mistral:latest')
})

// Test 2: Connection error handling (server unreachable)
await test('Connection error handling (server unreachable)', async () => {
  global.fetch = async () => {
    const error = new Error('fetch failed')
    error.code = 'ECONNREFUSED'
    throw error
  }
  
  const result = await discoverOllamaModels('http://localhost:11434')
  
  assert.strictEqual(result.success, false)
  assert.ok(result.error.includes('Cannot connect'), 'Error should mention connection failure')
  assert.ok(result.error.includes('localhost:11434'), 'Error should include URL')
})

// Test 3: Timeout handling (slow server)
await test('Timeout handling (slow server)', async () => {
  global.fetch = async (url, options) => {
    // Wait for the abort signal
    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        resolve({ ok: true, json: async () => ({ models: [] }) })
      }, 10000)
      
      if (options.signal) {
        options.signal.addEventListener('abort', () => {
          clearTimeout(timeout)
          const error = new Error('The operation was aborted')
          error.name = 'AbortError'
          reject(error)
        })
      }
    })
  }
  
  const startTime = Date.now()
  const result = await discoverOllamaModels('http://localhost:11434', { timeout: 100 })
  const elapsed = Date.now() - startTime
  
  assert.strictEqual(result.success, false)
  assert.ok(result.error.toLowerCase().includes('timed out') || result.error.toLowerCase().includes('timeout'), 'Error should mention timeout')
  assert.ok(elapsed < 300, `Should timeout quickly (elapsed: ${elapsed}ms)`)
})

// Test 4: Malformed response handling (missing models array)
await test('Malformed response handling (missing models array)', async () => {
  global.fetch = async () => ({
    ok: true,
    status: 200,
    json: async () => ({ data: [] }) // Wrong structure
  })
  
  const result = await discoverOllamaModels('http://localhost:11434')
  
  assert.strictEqual(result.success, false)
  assert.ok(result.error.includes('models'), 'Error should mention missing models array')
})

// Test 5: Malformed response handling (invalid model objects)
await test('Malformed response handling (invalid model objects)', async () => {
  global.fetch = async () => ({
    ok: true,
    status: 200,
    json: async () => ({
      models: [
        { name: 'valid-model', size: 1000 },
        { size: 2000 }, // Missing name
        null, // Null entry
        { name: '', size: 3000 }, // Empty name
        { name: 'another-valid-model', size: 4000 }
      ]
    })
  })
  
  const result = await discoverOllamaModels('http://localhost:11434')
  
  assert.strictEqual(result.success, true)
  assert.strictEqual(result.models.length, 2, 'Should filter out invalid models')
  assert.strictEqual(result.models[0].name, 'valid-model')
  assert.strictEqual(result.models[1].name, 'another-valid-model')
})

// Test 6: Empty models array handling
await test('Empty models array handling', async () => {
  global.fetch = async () => ({
    ok: true,
    status: 200,
    json: async () => ({ models: [] })
  })
  
  const result = await discoverOllamaModels('http://localhost:11434')
  
  assert.strictEqual(result.success, true)
  assert.strictEqual(result.models.length, 0)
})

// Test 7: HTTP error status codes (404)
await test('HTTP error status code 404', async () => {
  global.fetch = async () => ({
    ok: false,
    status: 404,
    statusText: 'Not Found'
  })
  
  const result = await discoverOllamaModels('http://localhost:11434')
  
  assert.strictEqual(result.success, false)
  assert.ok(result.error.includes('404'), 'Error should mention 404')
  assert.ok(result.error.toLowerCase().includes('not found'), 'Error should mention not found')
})

// Test 8: HTTP error status codes (500)
await test('HTTP error status code 500', async () => {
  global.fetch = async () => ({
    ok: false,
    status: 500,
    statusText: 'Internal Server Error'
  })
  
  const result = await discoverOllamaModels('http://localhost:11434')
  
  assert.strictEqual(result.success, false)
  assert.ok(result.error.includes('500'), 'Error should mention 500')
  assert.ok(result.error.toLowerCase().includes('server error'), 'Error should mention server error')
})

// Test 9: URL construction (trailing slash handling)
await test('URL construction with trailing slash', async () => {
  let capturedUrl = null
  
  global.fetch = async (url) => {
    capturedUrl = url
    return {
      ok: true,
      status: 200,
      json: async () => ({ models: [] })
    }
  }
  
  await discoverOllamaModels('http://localhost:11434/')
  assert.strictEqual(capturedUrl, 'http://localhost:11434/api/tags', 'Should remove trailing slash')
  
  await discoverOllamaModels('http://localhost:11434')
  assert.strictEqual(capturedUrl, 'http://localhost:11434/api/tags', 'Should work without trailing slash')
  
  await discoverOllamaModels('http://localhost:11434///')
  assert.strictEqual(capturedUrl, 'http://localhost:11434/api/tags', 'Should remove multiple trailing slashes')
})

// Test 10: Invalid JSON response
await test('Invalid JSON response', async () => {
  global.fetch = async () => ({
    ok: true,
    status: 200,
    json: async () => {
      throw new Error('Unexpected token')
    }
  })
  
  const result = await discoverOllamaModels('http://localhost:11434')
  
  assert.strictEqual(result.success, false)
  assert.ok(result.error.toLowerCase().includes('json'), 'Error should mention JSON')
})

// Test 11: Model information extraction
await test('Model information extraction', async () => {
  global.fetch = async () => ({
    ok: true,
    status: 200,
    json: async () => ({
      models: [{
        name: 'test-model',
        modified_at: '2024-01-15T10:30:00Z',
        size: 1234567890,
        digest: 'abc123def456',
        details: {
          format: 'gguf',
          family: 'llama',
          parameter_size: '7B',
          quantization_level: 'Q4_0'
        }
      }]
    })
  })
  
  const result = await discoverOllamaModels('http://localhost:11434')
  
  assert.strictEqual(result.success, true)
  const model = result.models[0]
  assert.strictEqual(model.name, 'test-model')
  assert.strictEqual(model.modified_at, '2024-01-15T10:30:00Z')
  assert.strictEqual(model.size, 1234567890)
  assert.strictEqual(model.digest, 'abc123def456')
  assert.deepStrictEqual(model.details, {
    format: 'gguf',
    family: 'llama',
    parameter_size: '7B',
    quantization_level: 'Q4_0'
  })
})

// Test 12: Custom timeout
await test('Custom timeout', async () => {
  global.fetch = async (url, options) => {
    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        resolve({ ok: true, json: async () => ({ models: [] }) })
      }, 5000)
      
      if (options.signal) {
        options.signal.addEventListener('abort', () => {
          clearTimeout(timeout)
          const error = new Error('The operation was aborted')
          error.name = 'AbortError'
          reject(error)
        })
      }
    })
  }
  
  const startTime = Date.now()
  const result = await discoverOllamaModels('http://localhost:11434', { timeout: 50 })
  const elapsed = Date.now() - startTime
  
  assert.strictEqual(result.success, false)
  assert.ok(elapsed < 200, `Should respect custom timeout (elapsed: ${elapsed}ms)`)
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
console.log('discoverOllamaModels() validated for Requirements 7.1-7.5, 15.1-15.4, 16.1-16.5, 21.1-21.5, 23.1-23.5')
