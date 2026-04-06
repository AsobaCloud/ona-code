import { appendEntry } from './transcript.mjs'
import { withTransaction } from './store.mjs'
import { runHooks } from './hookplane.mjs'

/**
 * Compact a conversation by summarizing old messages into a collapse_commit entry.
 * Old entries are NOT deleted — they remain for full recall.
 * The transcript builders detect collapse_commit and skip prior entries.
 */
export async function compactConversation(db, rt, summarize, log) {
  const hookRt = {
    sessionId: rt.sessionId, conversationId: rt.conversationId,
    runtimeDbPath: rt.runtimeDbPath, cwd: rt.cwd,
    permissionMode: rt.settings?.permissions?.defaultMode ?? 'default',
    settings: rt.settings,
  }

  // Find entries to compact (everything before the latest collapse_commit, or all)
  const lastCollapse = db.prepare(
    `SELECT sequence FROM transcript_entries WHERE session_id = ? AND entry_type = 'collapse_commit' ORDER BY sequence DESC LIMIT 1`
  ).get(rt.sessionId)
  const startSeq = lastCollapse ? lastCollapse.sequence + 1 : 0

  const entries = db.prepare(
    `SELECT entry_type, payload_json FROM transcript_entries WHERE session_id = ? AND sequence >= ? ORDER BY sequence ASC`
  ).all(rt.sessionId, startSeq)

  if (entries.length < 4) {
    log('Not enough messages to compact.')
    return null
  }

  // Build text for summarization
  const text = entries.map(e => {
    try {
      const p = JSON.parse(e.payload_json)
      if (e.entry_type === 'user') return `User: ${extractText(p)}`
      if (e.entry_type === 'assistant') return `Assistant: ${extractText(p)}`
      if (e.entry_type === 'tool_result') return `Tool result: ${p.content?.slice?.(0, 200) || ''}`
      return ''
    } catch { return '' }
  }).filter(Boolean).join('\n')

  await runHooks(db, hookRt, 'PreCompact', { trigger: 'manual' })

  log('Compacting conversation...')
  const summary = await summarize(text)

  // Insert collapse_commit entry — old entries remain untouched
  withTransaction(db, () => {
    appendEntry(db, rt.sessionId, 'collapse_commit', {
      _t: 'collapse_commit',
      summary,
      compacted_count: entries.length,
      compacted_from_sequence: startSeq,
    })

    // Also store in summaries table
    db.prepare(
      `INSERT OR REPLACE INTO summaries(conversation_id, content, word_count) VALUES (?, ?, ?)`
    ).run(rt.conversationId, summary, summary.split(/\s+/).length)
  })

  await runHooks(db, hookRt, 'PostCompact', { trigger: 'manual', compact_summary: summary })

  log(`Compacted ${entries.length} entries.`)
  return summary
}

function extractText(payload) {
  const blocks = payload.content
  if (!Array.isArray(blocks)) return ''
  return blocks.filter(b => b?.type === 'text' && typeof b.text === 'string').map(b => b.text).join('\n')
}
