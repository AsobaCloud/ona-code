import fs from 'node:fs'
import path from 'node:path'
import { withTransaction } from './store.mjs'

const DEFAULT_EFFECTIVE = {
  model_config: {
    provider: 'zhipu',
    model_id: 'glm_4_7_flash',
  },
  permissions: { defaultMode: 'default', allow: [], deny: [], ask: [] },
  hooks: [],
  apiKeyHelper: null,
  mcp_servers: {},
}

/** §4.4 — bootstrap once at process start. */
export function bootstrapSettings(db, projectRoot) {
  const candidates = [
    path.join(projectRoot, '.ona', 'settings.json'),
    path.join(projectRoot, '.claude', 'settings.local.json'),
    path.join(projectRoot, 'settings.json'),
  ]
  let merged = structuredClone(DEFAULT_EFFECTIVE)
  for (const p of candidates) {
    if (!fs.existsSync(p)) continue
    try {
      merged = deepMerge(merged, JSON.parse(fs.readFileSync(p, 'utf8')))
    } catch { /* skip invalid */ }
  }
  const json = JSON.stringify(merged)
  withTransaction(db, () => {
    db.prepare(
      `INSERT OR REPLACE INTO settings_snapshot(scope, json, updated_at) VALUES ('effective', ?, datetime('now'))`,
    ).run(json)
  })
  return merged
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
