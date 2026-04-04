import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

export function onaHome() {
  const h = process.env.ONAHOME || path.join(os.homedir(), '.ona')
  fs.mkdirSync(h, { recursive: true, mode: 0o700 })
  return h
}

export function defaultDbPath() {
  return path.join(onaHome(), 'agent.db')
}

/** §2.8 — secrets outside AGENT_SDLC_DB */
export function secureAuthPath() {
  const d = path.join(onaHome(), 'secure')
  fs.mkdirSync(d, { recursive: true, mode: 0o700 })
  return path.join(d, 'anthropic.json')
}
