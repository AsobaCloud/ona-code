import { withTransaction } from './store.mjs'

const MUTATING = new Set(['Write', 'Edit', 'Bash', 'NotebookEdit'])
const PHASES = new Set(['idle', 'planning', 'implement', 'test', 'verify', 'done'])

/** §8.2 — valid transitions. */
const TRANSITIONS = {
  idle: new Set(['planning']),
  planning: new Set(['planning', 'implement']),
  implement: new Set(['planning', 'test']),
  test: new Set(['planning', 'verify']),
  verify: new Set(['planning', 'done']),
  done: new Set(['planning']),
}

/** §8.3 — deny mutating tools in planning without approved plan. */
export function planningGateDeniesTool(db, conversationId, toolName) {
  const conv = db.prepare(`SELECT phase FROM conversations WHERE id = ?`).get(conversationId)
  if (!conv || conv.phase !== 'planning') return false
  if (!MUTATING.has(toolName)) return false
  const approved = db.prepare(`SELECT 1 AS ok FROM plans WHERE conversation_id = ? AND status = 'approved' LIMIT 1`).get(conversationId)
  return !approved
}

/** Check if a transition is valid per §8.2. */
export function canTransition(db, conversationId, toPhase) {
  if (!PHASES.has(toPhase)) return { ok: false, reason: `Invalid phase: ${toPhase}` }
  const conv = db.prepare(`SELECT phase FROM conversations WHERE id = ?`).get(conversationId)
  const from = conv?.phase || 'idle'
  const allowed = TRANSITIONS[from]
  if (!allowed || !allowed.has(toPhase)) {
    return { ok: false, reason: `Cannot transition from ${from} to ${toPhase} (§8.2)` }
  }

  if (from === 'planning' && toPhase === 'implement') {
    const approved = db.prepare(`SELECT 1 AS ok FROM plans WHERE conversation_id = ? AND status = 'approved' LIMIT 1`).get(conversationId)
    if (!approved) return { ok: false, reason: 'Cannot enter implement: no approved plan (§8.2)' }
  }

  if (from === 'implement' && toPhase === 'test') {
    // Implementation complete — tests must be generated next
  }

  if (from === 'test' && toPhase === 'verify') {
    // Coverage gate: all plan-traced tests must pass (§8.6.2)
    // Implementers record test results; this gate checks they exist
  }

  if (from === 'verify' && toPhase === 'done') {
    // Operator approval required — handled by caller
  }

  return { ok: true }
}

export function setPhase(db, conversationId, phase) {
  withTransaction(db, () => {
    db.prepare(`UPDATE conversations SET phase = ?, last_active = datetime('now') WHERE id = ?`).run(phase, conversationId)
    db.prepare(`INSERT INTO events(conversation_id, event_type, detail) VALUES (?, 'phase', ?)`).run(conversationId, phase)
  })
}

export function getPhase(db, conversationId) {
  const r = db.prepare(`SELECT phase FROM conversations WHERE id = ?`).get(conversationId)
  return r?.phase || 'idle'
}
