import fs from 'node:fs'
import path from 'node:path'
import { withTransaction } from './store.mjs'

const DEFAULT_EFFECTIVE = {
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

/**
 * Get file modification time or null if file doesn't exist.
 * @param {string} filePath - Path to the file
 * @returns {Date | null} File modification time or null
 */
function getFileModificationTime(filePath) {
  try {
    const stats = fs.statSync(filePath)
    return stats.mtime
  } catch {
    return null
  }
}

/** §4.4 — bootstrap once at process start. */
export function bootstrapSettings(db, projectRoot) {
  const candidates = [
    path.join(projectRoot, '.ona', 'settings.json'),
    path.join(projectRoot, '.claude', 'settings.local.json'),
    path.join(projectRoot, 'settings.json'),
  ]
  
  // Step 1: Load settings from files (if they exist)
  let fileSettings = null
  let newestFileTime = null
  
  for (const p of candidates) {
    if (!fs.existsSync(p)) continue
    try {
      const content = fs.readFileSync(p, 'utf8')
      const parsed = JSON.parse(content)
      fileSettings = deepMerge(fileSettings || {}, parsed)
      
      // Track newest file modification time
      const modTime = getFileModificationTime(p)
      if (modTime && (!newestFileTime || modTime > newestFileTime)) {
        newestFileTime = modTime
      }
    } catch {
      // Skip invalid JSON files
      continue
    }
  }
  
  // Step 2: Load existing settings from database
  const row = db.prepare(`SELECT json, updated_at FROM settings_snapshot WHERE scope = 'effective'`).get()
  
  let dbSettings = null
  let dbTimestamp = null
  
  if (row) {
    try {
      dbSettings = JSON.parse(row.json)
      dbTimestamp = new Date(row.updated_at)
    } catch {
      // Database has invalid JSON, treat as empty
      dbSettings = null
    }
  }
  
  // Step 3: Determine merge strategy based on timestamps
  let shouldUpdateDatabase = false
  let finalSettings = null
  let source = null
  
  if (!dbSettings) {
    // Case A: Database is empty (first run)
    // Merge: File > Defaults
    finalSettings = deepMerge(structuredClone(DEFAULT_EFFECTIVE), fileSettings || {})
    shouldUpdateDatabase = true
    source = 'bootstrap-first-run'
  } else if (fileSettings && newestFileTime && newestFileTime > dbTimestamp) {
    // Case B: File was manually edited after last database update
    // Merge: File > Database > Defaults
    finalSettings = deepMerge(structuredClone(DEFAULT_EFFECTIVE), dbSettings)
    finalSettings = deepMerge(finalSettings, fileSettings)
    shouldUpdateDatabase = true
    source = 'bootstrap-file-newer'
  } else {
    // Case C: Database has settings and is newer than (or equal to) file
    // Keep database settings unchanged (preserves runtime changes)
    finalSettings = dbSettings
    shouldUpdateDatabase = false
    source = 'bootstrap-db-preserved'
  }
  
  // Step 4: Update database if needed
  if (shouldUpdateDatabase) {
    const json = JSON.stringify(finalSettings)
    withTransaction(db, () => {
      db.prepare(
        `INSERT OR REPLACE INTO settings_snapshot(scope, json, updated_at) VALUES ('effective', ?, datetime('now'))`,
      ).run(json)
    })
  }
  
  return finalSettings
}

export function getEffectiveSettings(db) {
  const row = db.prepare(`SELECT json FROM settings_snapshot WHERE scope = 'effective'`).get()
  if (!row) return structuredClone(DEFAULT_EFFECTIVE)
  try { return JSON.parse(row.json) } catch { return structuredClone(DEFAULT_EFFECTIVE) }
}

export function updateEffectiveSettings(db, patch) {
  const current = getEffectiveSettings(db)
  const merged = deepMerge(current, patch)
  const json = JSON.stringify(merged)
  withTransaction(db, () => {
    db.prepare(
      `INSERT OR REPLACE INTO settings_snapshot(scope, json, updated_at) VALUES ('effective', ?, datetime('now'))`,
    ).run(json)
  })
  return merged
}

function deepMerge(a, b) {
  if (!b || typeof b !== 'object') return a
  const out = Array.isArray(a) ? [...a] : { ...a }
  for (const k of Object.keys(b)) {
    const bv = b[k]
    if (bv === undefined) continue
    if (bv && typeof bv === 'object' && !Array.isArray(bv) && typeof out[k] === 'object' && !Array.isArray(out[k])) {
      out[k] = deepMerge(out[k] || {}, bv)
    } else {
      out[k] = bv
    }
  }
  return out
}
