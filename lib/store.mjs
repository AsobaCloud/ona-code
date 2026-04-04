import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import Database from 'better-sqlite3'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const SCHEMA_PATH = path.resolve(__dirname, '..', 'schema.sql')

const byPath = new Map()

/** §4.8 — single writer connection per DB path; pragmas on open. */
export function openStore(dbPath) {
  const abs = path.resolve(dbPath)
  if (byPath.has(abs)) return byPath.get(abs)
  const dir = path.dirname(abs)
  fs.mkdirSync(dir, { recursive: true })
  const db = new Database(abs)
  db.pragma('foreign_keys = ON')
  db.pragma('journal_mode = WAL')
  db.pragma('busy_timeout = 30000')
  const ddl = fs.readFileSync(SCHEMA_PATH, 'utf8')
  db.exec(ddl)
  const row = db.prepare(`SELECT value FROM schema_meta WHERE key = 'schema_version'`).get()
  if (!row) {
    db.prepare(`INSERT INTO schema_meta(key,value) VALUES ('schema_version','1')`).run()
  }
  byPath.set(abs, db)
  return db
}

/** Run fn inside a single immediate transaction (writer serialization). */
export function withTransaction(db, fn) {
  return db.transaction(fn)()
}
