import fs from 'node:fs'
import path from 'node:path'

/** Search for Ona.md in cwd and parent directories. Returns content or empty string. */
export function loadInstructions(cwd) {
  const names = ['Ona.md', '.ona/Ona.md', 'ONA.md', '.ona/ONA.md']
  let dir = cwd
  const visited = new Set()
  while (dir && !visited.has(dir)) {
    visited.add(dir)
    for (const name of names) {
      const full = path.join(dir, name)
      if (fs.existsSync(full)) {
        try { return { content: fs.readFileSync(full, 'utf8'), path: full } }
        catch { /* unreadable */ }
      }
    }
    const parent = path.dirname(dir)
    if (parent === dir) break
    dir = parent
  }
  return { content: '', path: null }
}
