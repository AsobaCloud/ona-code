import { randomUUID } from 'node:crypto'

function nextSeq(db, sessionId) {
  const r = db
    .prepare(`SELECT COALESCE(MAX(sequence), -1) AS m FROM transcript_entries WHERE session_id = ?`)
    .get(sessionId)
  return (r?.m ?? -1) + 1
}

export function appendEntry(db, sessionId, entryType, payload, toolUseId = null) {
  const seq = nextSeq(db, sessionId)
  const payloadJson = JSON.stringify(payload)
  const info = db
    .prepare(
      `INSERT INTO transcript_entries(session_id, sequence, entry_type, payload_json, tool_use_id)
       VALUES (?, ?, ?, ?, ?)`,
    )
    .run(sessionId, seq, entryType, payloadJson, toolUseId)
  return info.lastInsertRowid
}

/** Build Anthropic Messages API messages array from transcript (§2.5). */
export function transcriptToAnthropicMessages(db, sessionId) {
  const rows = db
    .prepare(
      `SELECT entry_type, payload_json FROM transcript_entries WHERE session_id = ? ORDER BY sequence ASC`,
    )
    .all(sessionId)
  const messages = []
  let pendingToolResults = []

  const flushToolResults = () => {
    if (!pendingToolResults.length) return
    messages.push({ role: 'user', content: pendingToolResults })
    pendingToolResults = []
  }

  for (const row of rows) {
    let payload
    try { payload = JSON.parse(row.payload_json) } catch { continue }

    if (row.entry_type === 'user') {
      flushToolResults()
      const text = extractTextContent(payload)
      if (text) messages.push({ role: 'user', content: text })
    } else if (row.entry_type === 'assistant') {
      flushToolResults()
      const content = assistantPayloadToApiContent(payload)
      if (content.length) messages.push({ role: 'assistant', content })
    } else if (row.entry_type === 'tool_result') {
      pendingToolResults.push({
        type: 'tool_result',
        tool_use_id: payload.tool_use_id,
        content: typeof payload.content === 'string' ? payload.content : JSON.stringify(payload.content),
        is_error: Boolean(payload.is_error),
      })
    }
  }
  flushToolResults()
  return messages
}

/** Build OpenAI /v1/chat/completions messages. */
export function transcriptToOpenAIMessages(db, sessionId) {
  const rows = db
    .prepare(
      `SELECT entry_type, payload_json FROM transcript_entries WHERE session_id = ? ORDER BY sequence ASC`,
    )
    .all(sessionId)
  const messages = []

  for (const row of rows) {
    let payload
    try { payload = JSON.parse(row.payload_json) } catch { continue }

    if (row.entry_type === 'user') {
      const text = extractTextContent(payload)
      if (text) messages.push({ role: 'user', content: text })
    } else if (row.entry_type === 'assistant') {
      const blocks = payload.content
      if (!Array.isArray(blocks)) continue
      const textParts = []
      const toolUses = []
      for (const b of blocks) {
        if (b?.type === 'text' && typeof b.text === 'string') textParts.push(b.text)
        else if (b?.type === 'tool_use' && b.id && b.name) {
          toolUses.push({
            id: b.id,
            type: 'function',
            function: {
              name: b.name,
              arguments: JSON.stringify(b.input && typeof b.input === 'object' ? b.input : {}),
            },
          })
        }
      }
      if (toolUses.length) {
        messages.push({
          role: 'assistant',
          content: textParts.length ? textParts.join('\n') : null,
          tool_calls: toolUses,
        })
      } else if (textParts.length) {
        messages.push({ role: 'assistant', content: textParts.join('\n') })
      }
    } else if (row.entry_type === 'tool_result') {
      const id = payload.tool_use_id
      const s = typeof payload.content === 'string' ? payload.content : JSON.stringify(payload.content ?? '')
      if (id) messages.push({ role: 'tool', tool_call_id: id, content: s })
    }
  }
  return messages
}

function extractTextContent(payload) {
  const blocks = payload.content
  if (!Array.isArray(blocks)) return ''
  return blocks.filter(b => b?.type === 'text' && typeof b.text === 'string').map(b => b.text).join('\n')
}

function assistantPayloadToApiContent(payload) {
  const blocks = payload.content
  if (!Array.isArray(blocks)) return []
  const out = []
  for (const b of blocks) {
    if (b?.type === 'text' && typeof b.text === 'string') out.push({ type: 'text', text: b.text })
    else if (b?.type === 'tool_use') out.push({ type: 'tool_use', id: b.id, name: b.name, input: b.input && typeof b.input === 'object' ? b.input : {} })
  }
  return out
}

export function makeUserPayload(text) {
  return { _t: 'user', uuid: randomUUID(), content: [{ type: 'text', text }] }
}

export function makeAssistantPayload(contentBlocks) {
  return { _t: 'assistant', uuid: randomUUID(), content: contentBlocks }
}

export function makeToolResultPayload(toolUseId, content, isError) {
  return { _t: 'tool_result', tool_use_id: toolUseId, content, is_error: isError }
}
