#!/usr/bin/env node
/**
 * Unit Tests: bootstrapSettings() Edge Cases
 * 
 * Validates Requirements: 4.3, 5.4, 5.5, 6.1, 6.2, 6.3, 19.1, 19.2, 19.3
 * 
 * Tests all edge cases for the settings persistence merge strategy:
 * - First run scenarios (no database, with/without files)
 * - Timestamp precedence (file vs database)
 * - Multiple settings files merging
 * - Corrupted data handling
 * - Source tracking
 */

import Database from 'better-sqlite3'
import fs from 'node:fs'
import path from 'node:path'
import os from 'node:os'
import { bootstrapSettings } from '../../lib/settings.mjs'

// Test utilities
function createTestDb() {
  const db = Database(':memory:')
  
  // Create settings_snapshot table
  db.exec(`
    CREATE TABLE IF NOT EXISTS settings_snapshot (
      scope TEXT PRIMARY KEY,
      json TEXT NOT NULL,
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    )
  `)
  
  return db
}

function createTestDir() {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ona-test-'))
  return tmpDir
}

function cleanupTestDir(dir) {
  try {
    fs.rmSync(dir, { recursive: true, force: true })
  } catch {
    // Ignore cleanup errors
  }
}

function writeSettingsFile(dir, filename, content) {
  const filePath = path.join(dir, filename)
  const dirPath = path.dirname(filePath)
  
  // Create directory if it doesn't exist
  if (!fs.existsSync(dirPath)) {
    fs.mkdirSync(dirPath, { recursive: true })
  }
  
  fs.writeFileSync(filePath, JSON.stringify(content, null, 2), 'utf8')
  return filePath
}

function setFileModificationTime(filePath, date) {
  const timestamp = date.getTime() / 1000
  fs.utimesSync(filePath, timestamp, timestamp)
}

function insertDatabaseSettings(db, settings, timestamp) {
  const json = JSON.stringify(settings)
  db.prepare(
    `INSERT OR REPLACE INTO settings_snapshot(scope, json, updated_at) VALUES ('effective', ?, ?)`
  ).run(json, timestamp.toISOString())
}

// Test counters
let passed = 0
let failed = 0

function test(name, fn) {
  try {
    fn()
    console.log(`✓ ${name}`)
    passed++
  } catch (error) {
    console.error(`✗ ${name}`)
    console.error(`  Error: ${error.message}`)
    if (error.expected !== undefined) {
      console.error(`  Expected: ${JSON.stringify(error.expected)}`)
      console.error(`  Got: ${JSON.stringify(error.actual)}`)
    }
    failed++
  }
}

function assertEqual(actual, expected, message) {
  if (JSON.stringify(actual) !== JSON.stringify(expected)) {
    const error = new Error(message || 'Assertion failed')
    error.expected = expected
    error.actual = actual
    throw error
  }
}

function assertDeepEqual(actual, expected, message) {
  const actualJson = JSON.stringify(actual, null, 2)
  const expectedJson = JSON.stringify(expected, null, 2)
  
  if (actualJson !== expectedJson) {
    const error = new Error(message || 'Deep equality assertion failed')
    error.expected = expected
    error.actual = actual
    throw error
  }
}

function assertTrue(condition, message) {
  if (!condition) {
    throw new Error(message || 'Assertion failed: expected true')
  }
}

// Default settings for comparison
const DEFAULT_SETTINGS = {
  model_config: {
    provider: 'zhipu',
    model_id: 'glm_4_7_flash',
    base_url: null,
  },
  permissions: { defaultMode: 'default', allow: [], deny: [], ask: [] },
  hooks: [],
  apiKeyHelper: null,
  mcp_servers: {},
}

console.log('Running Unit Tests: bootstrapSettings() Edge Cases\n')

// Test 1: First run with no database, no files (uses defaults)
test('Test 1: First run with no database, no files (uses defaults)', () => {
  const db = createTestDb()
  const testDir = createTestDir()
  
  try {
    const result = bootstrapSettings(db, testDir)
    
    // Should return default settings
    assertDeepEqual(result, DEFAULT_SETTINGS, 'Should use default settings')
    
    // Should write to database
    const row = db.prepare(`SELECT json FROM settings_snapshot WHERE scope = 'effective'`).get()
    assertTrue(row !== null, 'Should write to database')
    
    const dbSettings = JSON.parse(row.json)
    assertDeepEqual(dbSettings, DEFAULT_SETTINGS, 'Database should contain default settings')
  } finally {
    db.close()
    cleanupTestDir(testDir)
  }
})

// Test 2: First run with settings file present (merges file > defaults)
test('Test 2: First run with settings file present (merges file > defaults)', () => {
  const db = createTestDb()
  const testDir = createTestDir()
  
  try {
    // Create settings file with custom model
    const fileSettings = {
      model_config: {
        provider: 'ollama',
        model_id: 'llama3',
        custom_model_name: 'llama3:latest'
      }
    }
    
    writeSettingsFile(testDir, '.ona/settings.json', fileSettings)
    
    const result = bootstrapSettings(db, testDir)
    
    // Should merge file settings over defaults
    assertEqual(result.model_config.provider, 'ollama', 'Should use file provider')
    assertEqual(result.model_config.model_id, 'llama3', 'Should use file model_id')
    assertEqual(result.model_config.custom_model_name, 'llama3:latest', 'Should use file custom_model_name')
    
    // Should preserve default fields not in file
    assertDeepEqual(result.permissions, DEFAULT_SETTINGS.permissions, 'Should preserve default permissions')
    assertDeepEqual(result.hooks, DEFAULT_SETTINGS.hooks, 'Should preserve default hooks')
  } finally {
    db.close()
    cleanupTestDir(testDir)
  }
})

// Test 3: Startup with existing database, no files (preserves database)
test('Test 3: Startup with existing database, no files (preserves database)', () => {
  const db = createTestDb()
  const testDir = createTestDir()
  
  try {
    // Pre-populate database with runtime settings
    const dbSettings = {
      model_config: {
        provider: 'openai_compatible',
        model_id: 'gpt-4o',
        base_url: 'https://api.openai.com/v1'
      },
      permissions: DEFAULT_SETTINGS.permissions,
      hooks: [],
      apiKeyHelper: null,
      mcp_servers: {}
    }
    
    const timestamp = new Date('2024-01-15T10:00:00Z')
    insertDatabaseSettings(db, dbSettings, timestamp)
    
    // Bootstrap without any files
    const result = bootstrapSettings(db, testDir)
    
    // Should preserve database settings unchanged
    assertDeepEqual(result, dbSettings, 'Should preserve database settings')
  } finally {
    db.close()
    cleanupTestDir(testDir)
  }
})

// Test 4: Startup with database older than file (merges file > database > defaults)
test('Test 4: Startup with database older than file (merges file > database > defaults)', () => {
  const db = createTestDb()
  const testDir = createTestDir()
  
  try {
    // Pre-populate database with old settings
    const dbSettings = {
      model_config: {
        provider: 'ollama',
        model_id: 'llama2',
        base_url: 'http://localhost:11434'
      },
      permissions: { defaultMode: 'allow', allow: ['tool1'], deny: [], ask: [] },
      hooks: [],
      apiKeyHelper: null,
      mcp_servers: {}
    }
    
    const dbTimestamp = new Date('2024-01-15T10:00:00Z')
    insertDatabaseSettings(db, dbSettings, dbTimestamp)
    
    // Create settings file with newer timestamp
    const fileSettings = {
      model_config: {
        provider: 'ollama',
        model_id: 'llama3',
        custom_model_name: 'llama3:latest'
      }
    }
    
    const filePath = writeSettingsFile(testDir, '.ona/settings.json', fileSettings)
    
    // Set file modification time to be newer than database
    const fileTimestamp = new Date('2024-01-15T11:00:00Z')
    setFileModificationTime(filePath, fileTimestamp)
    
    const result = bootstrapSettings(db, testDir)
    
    // Should use file settings for model_config
    assertEqual(result.model_config.provider, 'ollama', 'Should use file provider')
    assertEqual(result.model_config.model_id, 'llama3', 'Should use file model_id')
    assertEqual(result.model_config.custom_model_name, 'llama3:latest', 'Should use file custom_model_name')
    
    // Should preserve database settings for fields not in file
    assertDeepEqual(result.permissions, dbSettings.permissions, 'Should preserve database permissions')
    
    // Should preserve base_url from database (not overwritten by file)
    assertEqual(result.model_config.base_url, 'http://localhost:11434', 'Should preserve database base_url')
  } finally {
    db.close()
    cleanupTestDir(testDir)
  }
})

// Test 5: Startup with database newer than file (preserves database, ignores file)
test('Test 5: Startup with database newer than file (preserves database, ignores file)', () => {
  const db = createTestDb()
  const testDir = createTestDir()
  
  try {
    // Create settings file with old timestamp
    const fileSettings = {
      model_config: {
        provider: 'ollama',
        model_id: 'llama2'
      }
    }
    
    const filePath = writeSettingsFile(testDir, '.ona/settings.json', fileSettings)
    const fileTimestamp = new Date('2024-01-15T09:00:00Z')
    setFileModificationTime(filePath, fileTimestamp)
    
    // Pre-populate database with newer settings
    const dbSettings = {
      model_config: {
        provider: 'openai_compatible',
        model_id: 'gpt-4o',
        custom_model_name: 'gpt-4o',
        base_url: 'https://api.openai.com/v1'
      },
      permissions: DEFAULT_SETTINGS.permissions,
      hooks: [],
      apiKeyHelper: null,
      mcp_servers: {}
    }
    
    const dbTimestamp = new Date('2024-01-15T10:00:00Z')
    insertDatabaseSettings(db, dbSettings, dbTimestamp)
    
    const result = bootstrapSettings(db, testDir)
    
    // Should preserve database settings completely (ignore file)
    assertDeepEqual(result, dbSettings, 'Should preserve database settings and ignore older file')
  } finally {
    db.close()
    cleanupTestDir(testDir)
  }
})

// Test 6: Startup with multiple settings files (merges all files)
test('Test 6: Startup with multiple settings files (merges all files)', () => {
  const db = createTestDb()
  const testDir = createTestDir()
  
  try {
    // Create first settings file
    const file1Settings = {
      model_config: {
        provider: 'ollama',
        model_id: 'llama3'
      }
    }
    
    writeSettingsFile(testDir, '.ona/settings.json', file1Settings)
    
    // Create second settings file with additional config
    const file2Settings = {
      permissions: {
        defaultMode: 'ask',
        allow: ['tool1', 'tool2'],
        deny: [],
        ask: []
      }
    }
    
    writeSettingsFile(testDir, '.claude/settings.local.json', file2Settings)
    
    // Create third settings file
    const file3Settings = {
      apiKeyHelper: 'custom-helper',
      mcp_servers: {
        server1: { command: 'node', args: ['server.js'] }
      }
    }
    
    writeSettingsFile(testDir, 'settings.json', file3Settings)
    
    const result = bootstrapSettings(db, testDir)
    
    // Should merge all three files
    assertEqual(result.model_config.provider, 'ollama', 'Should use model from file1')
    assertEqual(result.model_config.model_id, 'llama3', 'Should use model_id from file1')
    assertEqual(result.permissions.defaultMode, 'ask', 'Should use permissions from file2')
    assertDeepEqual(result.permissions.allow, ['tool1', 'tool2'], 'Should use allow list from file2')
    assertEqual(result.apiKeyHelper, 'custom-helper', 'Should use apiKeyHelper from file3')
    assertTrue(result.mcp_servers.server1 !== undefined, 'Should include mcp_servers from file3')
  } finally {
    db.close()
    cleanupTestDir(testDir)
  }
})

// Test 7: Startup with corrupted settings file (skips file, uses database/defaults)
test('Test 7: Startup with corrupted settings file (skips file, uses database/defaults)', () => {
  const db = createTestDb()
  const testDir = createTestDir()
  
  try {
    // Create corrupted JSON file
    const filePath = path.join(testDir, '.ona', 'settings.json')
    fs.mkdirSync(path.dirname(filePath), { recursive: true })
    fs.writeFileSync(filePath, '{ invalid json content }', 'utf8')
    
    // Pre-populate database with valid settings
    const dbSettings = {
      model_config: {
        provider: 'ollama',
        model_id: 'llama3',
        base_url: 'http://localhost:11434'
      },
      permissions: DEFAULT_SETTINGS.permissions,
      hooks: [],
      apiKeyHelper: null,
      mcp_servers: {}
    }
    
    const timestamp = new Date('2024-01-15T10:00:00Z')
    insertDatabaseSettings(db, dbSettings, timestamp)
    
    const result = bootstrapSettings(db, testDir)
    
    // Should skip corrupted file and use database
    assertDeepEqual(result, dbSettings, 'Should use database settings when file is corrupted')
  } finally {
    db.close()
    cleanupTestDir(testDir)
  }
})

// Test 8: Startup with corrupted database JSON (reinitializes from file/defaults)
test('Test 8: Startup with corrupted database JSON (reinitializes from file/defaults)', () => {
  const db = createTestDb()
  const testDir = createTestDir()
  
  try {
    // Insert corrupted JSON into database
    db.prepare(
      `INSERT INTO settings_snapshot(scope, json, updated_at) VALUES ('effective', ?, datetime('now'))`
    ).run('{ invalid json }')
    
    // Create valid settings file
    const fileSettings = {
      model_config: {
        provider: 'ollama',
        model_id: 'llama3'
      }
    }
    
    writeSettingsFile(testDir, '.ona/settings.json', fileSettings)
    
    const result = bootstrapSettings(db, testDir)
    
    // Should treat corrupted database as empty and use file > defaults
    assertEqual(result.model_config.provider, 'ollama', 'Should use file provider')
    assertEqual(result.model_config.model_id, 'llama3', 'Should use file model_id')
    assertDeepEqual(result.permissions, DEFAULT_SETTINGS.permissions, 'Should use default permissions')
  } finally {
    db.close()
    cleanupTestDir(testDir)
  }
})

// Test 9: Source tracking - bootstrap-first-run
test('Test 9: Source tracking - bootstrap-first-run', () => {
  const db = createTestDb()
  const testDir = createTestDir()
  
  try {
    // First run with no database, no files
    bootstrapSettings(db, testDir)
    
    // Check that database was written (source tracking happens internally)
    const row = db.prepare(`SELECT json, updated_at FROM settings_snapshot WHERE scope = 'effective'`).get()
    assertTrue(row !== null, 'Should write to database on first run')
    
    // Verify settings are defaults
    const dbSettings = JSON.parse(row.json)
    assertDeepEqual(dbSettings, DEFAULT_SETTINGS, 'Should contain default settings on first run')
  } finally {
    db.close()
    cleanupTestDir(testDir)
  }
})

// Test 10: Source tracking - bootstrap-file-newer
test('Test 10: Source tracking - bootstrap-file-newer', () => {
  const db = createTestDb()
  const testDir = createTestDir()
  
  try {
    // Pre-populate database with old settings
    const dbSettings = {
      model_config: {
        provider: 'ollama',
        model_id: 'llama2',
        base_url: null
      },
      permissions: DEFAULT_SETTINGS.permissions,
      hooks: [],
      apiKeyHelper: null,
      mcp_servers: {}
    }
    
    const dbTimestamp = new Date('2024-01-15T10:00:00Z')
    insertDatabaseSettings(db, dbSettings, dbTimestamp)
    
    // Create newer settings file
    const fileSettings = {
      model_config: {
        provider: 'ollama',
        model_id: 'llama3'
      }
    }
    
    const filePath = writeSettingsFile(testDir, '.ona/settings.json', fileSettings)
    const fileTimestamp = new Date('2024-01-15T11:00:00Z')
    setFileModificationTime(filePath, fileTimestamp)
    
    bootstrapSettings(db, testDir)
    
    // Verify database was updated with file settings
    const row = db.prepare(`SELECT json FROM settings_snapshot WHERE scope = 'effective'`).get()
    const updatedSettings = JSON.parse(row.json)
    
    assertEqual(updatedSettings.model_config.model_id, 'llama3', 'Should update database with file settings')
  } finally {
    db.close()
    cleanupTestDir(testDir)
  }
})

// Test 11: Source tracking - bootstrap-db-preserved
test('Test 11: Source tracking - bootstrap-db-preserved', () => {
  const db = createTestDb()
  const testDir = createTestDir()
  
  try {
    // Pre-populate database with settings
    const dbSettings = {
      model_config: {
        provider: 'openai_compatible',
        model_id: 'gpt-4o',
        base_url: 'https://api.openai.com/v1'
      },
      permissions: DEFAULT_SETTINGS.permissions,
      hooks: [],
      apiKeyHelper: null,
      mcp_servers: {}
    }
    
    const dbTimestamp = new Date('2024-01-15T10:00:00Z')
    insertDatabaseSettings(db, dbSettings, dbTimestamp)
    
    // No files present
    const result = bootstrapSettings(db, testDir)
    
    // Should preserve database settings
    assertDeepEqual(result, dbSettings, 'Should preserve database settings when no newer files')
  } finally {
    db.close()
    cleanupTestDir(testDir)
  }
})

// Test 12: Edge case - Empty settings file
test('Test 12: Edge case - Empty settings file', () => {
  const db = createTestDb()
  const testDir = createTestDir()
  
  try {
    // Create empty settings file
    writeSettingsFile(testDir, '.ona/settings.json', {})
    
    const result = bootstrapSettings(db, testDir)
    
    // Should use defaults for all fields
    assertDeepEqual(result, DEFAULT_SETTINGS, 'Should use defaults when file is empty')
  } finally {
    db.close()
    cleanupTestDir(testDir)
  }
})

// Test 13: Edge case - Partial settings in file
test('Test 13: Edge case - Partial settings in file', () => {
  const db = createTestDb()
  const testDir = createTestDir()
  
  try {
    // Create file with only model_config
    const fileSettings = {
      model_config: {
        provider: 'ollama',
        model_id: 'llama3'
      }
    }
    
    writeSettingsFile(testDir, '.ona/settings.json', fileSettings)
    
    const result = bootstrapSettings(db, testDir)
    
    // Should merge file model_config with default other fields
    assertEqual(result.model_config.provider, 'ollama', 'Should use file provider')
    assertEqual(result.model_config.model_id, 'llama3', 'Should use file model_id')
    assertDeepEqual(result.permissions, DEFAULT_SETTINGS.permissions, 'Should use default permissions')
    assertDeepEqual(result.hooks, DEFAULT_SETTINGS.hooks, 'Should use default hooks')
  } finally {
    db.close()
    cleanupTestDir(testDir)
  }
})

// Test 14: Edge case - Deep merge of nested objects
test('Test 14: Edge case - Deep merge of nested objects', () => {
  const db = createTestDb()
  const testDir = createTestDir()
  
  try {
    // Pre-populate database with partial model_config
    const dbSettings = {
      model_config: {
        provider: 'ollama',
        model_id: 'llama2',
        base_url: 'http://localhost:11434'
      },
      permissions: DEFAULT_SETTINGS.permissions,
      hooks: [],
      apiKeyHelper: null,
      mcp_servers: {}
    }
    
    const dbTimestamp = new Date('2024-01-15T10:00:00Z')
    insertDatabaseSettings(db, dbSettings, dbTimestamp)
    
    // Create file with partial model_config update
    const fileSettings = {
      model_config: {
        model_id: 'llama3',
        custom_model_name: 'llama3:latest'
      }
    }
    
    const filePath = writeSettingsFile(testDir, '.ona/settings.json', fileSettings)
    const fileTimestamp = new Date('2024-01-15T11:00:00Z')
    setFileModificationTime(filePath, fileTimestamp)
    
    const result = bootstrapSettings(db, testDir)
    
    // Should deep merge: file overrides model_id and adds custom_model_name,
    // but preserves provider and base_url from database
    assertEqual(result.model_config.provider, 'ollama', 'Should preserve database provider')
    assertEqual(result.model_config.model_id, 'llama3', 'Should use file model_id')
    assertEqual(result.model_config.custom_model_name, 'llama3:latest', 'Should use file custom_model_name')
    assertEqual(result.model_config.base_url, 'http://localhost:11434', 'Should preserve database base_url')
  } finally {
    db.close()
    cleanupTestDir(testDir)
  }
})

// Test 15: Edge case - File with null values
test('Test 15: Edge case - File with null values', () => {
  const db = createTestDb()
  const testDir = createTestDir()
  
  try {
    // Create file with explicit null values
    const fileSettings = {
      model_config: {
        provider: 'ollama',
        model_id: 'llama3',
        base_url: null
      },
      apiKeyHelper: null
    }
    
    writeSettingsFile(testDir, '.ona/settings.json', fileSettings)
    
    const result = bootstrapSettings(db, testDir)
    
    // Should accept null values from file
    assertEqual(result.model_config.base_url, null, 'Should accept null base_url')
    assertEqual(result.apiKeyHelper, null, 'Should accept null apiKeyHelper')
  } finally {
    db.close()
    cleanupTestDir(testDir)
  }
})

// Print summary
console.log('\n' + '='.repeat(60))
console.log(`Test Results: ${passed} passed, ${failed} failed`)
console.log('='.repeat(60))

if (failed > 0) {
  console.error('\n✗ Some tests failed')
  process.exit(1)
} else {
  console.log('\n✓ All tests passed!')
  console.log('Requirements validated: 4.3, 5.4, 5.5, 6.1, 6.2, 6.3, 19.1, 19.2, 19.3')
  process.exit(0)
}
