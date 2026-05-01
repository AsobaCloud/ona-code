#!/usr/bin/env node
/**
 * Unit Tests: formatModelList()
 * 
 * Validates Requirements: 8.1-8.5, 22.1-22.5
 */

import { formatModelList } from '../../lib/modelDiscovery.mjs'
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

console.log('Running unit tests for formatModelList()...\n')

const sampleModels = [
  { name: 'llama3:latest', size: 4661224676, modified_at: '2024-01-15T10:30:00Z' },
  { name: 'mistral:latest', size: 3825819519, modified_at: '2024-01-14T09:00:00Z' },
  { name: 'codellama:7b', size: 3791725696, modified_at: '2024-01-16T14:20:00Z' }
]

// Test 1: Formatting with multiple models
test('Formatting with multiple models', () => {
  const result = formatModelList(sampleModels)
  assert.ok(result.includes('llama3:latest'))
  assert.ok(result.includes('mistral:latest'))
  assert.ok(result.includes('codellama:7b'))
  assert.ok(result.includes('Usage:'))
})

// Test 2: Formatting with empty models array
test('Formatting with empty models array', () => {
  const result = formatModelList([])
  assert.ok(result.includes('No models found'))
  assert.ok(result.includes('ollama pull'))
})

// Test 3: Sorting by modification date (default)
test('Sorting by modification date (newest first)', () => {
  const result = formatModelList(sampleModels)
  const lines = result.split('\n').filter(l => l.trim().length > 0)
  // Filter for lines that contain model names (have colons in model names like "llama3:latest")
  const modelLines = lines.filter(l => 
    (l.includes('llama3') || l.includes('mistral') || l.includes('codellama')) &&
    !l.includes('Usage:') && !l.includes('Example:')
  )
  
  // codellama (2024-01-16) should be first
  assert.ok(modelLines[0].includes('codellama'), `First line should be codellama, got: ${modelLines[0]}`)
  // llama3 (2024-01-15) should be second
  assert.ok(modelLines[1].includes('llama3'), `Second line should be llama3, got: ${modelLines[1]}`)
  // mistral (2024-01-14) should be last
  assert.ok(modelLines[2].includes('mistral'), `Third line should be mistral, got: ${modelLines[2]}`)
})

// Test 4: Sorting by name
test('Sorting by name', () => {
  const result = formatModelList(sampleModels, { sortBy: 'name' })
  const lines = result.split('\n').filter(l => l.trim().length > 0)
  const modelLines = lines.filter(l => 
    (l.includes('llama3') || l.includes('mistral') || l.includes('codellama')) &&
    !l.includes('Usage:') && !l.includes('Example:')
  )
  
  assert.ok(modelLines[0].includes('codellama'), `First should be codellama, got: ${modelLines[0]}`)
  assert.ok(modelLines[1].includes('llama3'), `Second should be llama3, got: ${modelLines[1]}`)
  assert.ok(modelLines[2].includes('mistral'), `Third should be mistral, got: ${modelLines[2]}`)
})

// Test 5: Sorting by size
test('Sorting by size (largest first)', () => {
  const result = formatModelList(sampleModels, { sortBy: 'size' })
  const lines = result.split('\n').filter(l => l.trim().length > 0)
  const modelLines = lines.filter(l => 
    (l.includes('llama3') || l.includes('mistral') || l.includes('codellama')) &&
    !l.includes('Usage:') && !l.includes('Example:')
  )
  
  // llama3 (4.6GB) should be first
  assert.ok(modelLines[0].includes('llama3'), `First should be llama3, got: ${modelLines[0]}`)
  // mistral (3.8GB) should be second
  assert.ok(modelLines[1].includes('mistral'), `Second should be mistral, got: ${modelLines[1]}`)
  // codellama (3.7GB) should be last
  assert.ok(modelLines[2].includes('codellama'), `Third should be codellama, got: ${modelLines[2]}`)
})

// Test 6: Verbose mode with details
test('Verbose mode with details', () => {
  const modelsWithDetails = [{
    name: 'llama3:latest',
    size: 4661224676,
    modified_at: '2024-01-15T10:30:00Z',
    details: {
      parameter_size: '7B',
      quantization_level: 'Q4_0'
    }
  }]
  
  const result = formatModelList(modelsWithDetails, { verbose: true })
  assert.ok(result.includes('7B'))
  assert.ok(result.includes('Q4_0'))
  assert.ok(result.includes('Parameters:'))
  assert.ok(result.includes('Quantization:'))
})

// Test 7: Byte size formatting (B)
test('Byte size formatting (B)', () => {
  const models = [{ name: 'tiny', size: 512, modified_at: '2024-01-15T10:30:00Z' }]
  const result = formatModelList(models)
  assert.ok(result.includes('512 B'))
})

// Test 8: Byte size formatting (KB)
test('Byte size formatting (KB)', () => {
  const models = [{ name: 'small', size: 5120, modified_at: '2024-01-15T10:30:00Z' }]
  const result = formatModelList(models)
  assert.ok(result.includes('5.0 KB'))
})

// Test 9: Byte size formatting (MB)
test('Byte size formatting (MB)', () => {
  const models = [{ name: 'medium', size: 5242880, modified_at: '2024-01-15T10:30:00Z' }]
  const result = formatModelList(models)
  assert.ok(result.includes('5.0 MB'))
})

// Test 10: Byte size formatting (GB)
test('Byte size formatting (GB)', () => {
  const models = [{ name: 'large', size: 5368709120, modified_at: '2024-01-15T10:30:00Z' }]
  const result = formatModelList(models)
  assert.ok(result.includes('5.0 GB'))
})

// Test 11: Usage instructions included
test('Usage instructions included', () => {
  const result = formatModelList(sampleModels)
  assert.ok(result.includes('Usage:'))
  assert.ok(result.includes('/model ollama/'))
  assert.ok(result.includes('Example:'))
})

// Test 12: Models without modified_at
test('Models without modified_at', () => {
  const models = [
    { name: 'model1', size: 1000, modified_at: null },
    { name: 'model2', size: 2000, modified_at: '2024-01-15T10:30:00Z' }
  ]
  
  const result = formatModelList(models)
  assert.ok(result.includes('model1'))
  assert.ok(result.includes('model2'))
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
console.log('formatModelList() validated for Requirements 8.1-8.5, 22.1-22.5')
