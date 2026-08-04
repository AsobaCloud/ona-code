/** OpenAI Chat Completions–compatible streaming HTTP client (§2.1 lm_studio_local + openai_compatible). */

/**
 * Strip thinking traces emitted by reasoning-capable models (Nehanda, DeepSeek-R1, Qwen3).
 * Handles:
 *   - Tagged blocks: <think>...</think>
 *   - Prose header: "Here's a thinking process: ..."
 *   - Numbered planning list that ends before the actual answer (```code or plain prose)
 */
function stripThinkingTraces(text) {
  // Tagged blocks
  text = text.replace(/<think>[\s\S]*?<\/think>/g, '')
  text = text.replace(/<think>[\s\S]*/g, '')

  // Prose thinking header
  text = text.replace(/^Here's a thinking process:[\s\S]*?(?=\n\n(?!\n)|\n(?=[A-Z0-9`#]))/m, '')

  // Numbered planning lists: lines starting with "1." or "1.  **" that precede a code block
  // or a clean paragraph. We detect: text starts with a numbered step AND contains a code fence.
  const hasCodeFence = text.includes('```')
  const startsWithStep = /^\s*1\.\s/.test(text)
  if (startsWithStep && hasCodeFence) {
    // Keep only from the first code block onward
    const fenceIdx = text.indexOf('```')
    text = text.slice(fenceIdx)
  }

  return text.trim()
}

export async function streamOpenAIChatCompletion({ baseUrl, apiKey, model, messages, tools, io, maxTokens = 8192, bufferOutput = true, num_ctx: numCtx, omitToolChoice: skipToolChoice = false }) {
  const url = `${String(baseUrl).replace(/\/$/, '')}/chat/completions`
  const body = { model, messages, stream: true, max_tokens: maxTokens }
  // Suppress tool_choice:"auto" for providers that do not support it (e.g. Nehanda
  // vLLM without --enable-auto-tool-choice). When omitToolChoice is true we still
  // send the tools schema so the model can call them — we just omit the directive.
  if (tools?.length) { body.tools = tools; if (!skipToolChoice) body.tool_choice = 'auto' }
  if (numCtx) body.num_ctx = numCtx

  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` },
    body: JSON.stringify(body),
  })

  if (!res.ok) {
    const t = await res.text()
    throw new Error(`OpenAI-compat ${res.status}: ${t.slice(0, 2000)}`)
  }
  if (!res.body) throw new Error('OpenAI-compat: empty response body')

  const reader = res.body.getReader()
  const decoder = new TextDecoder()
  let buffer = '', fullText = '', finishReason = null, firstToken = true, usage = null
  const toolAcc = new Map()

  while (true) {
    const { done, value } = await reader.read()
    if (done) break
    buffer += decoder.decode(value, { stream: true })
    const parts = buffer.split('\n')
    buffer = parts.pop() ?? ''

    for (const line of parts) {
      const trimmed = line.trim()
      if (!trimmed.startsWith('data:')) continue
      const data = trimmed.slice(5).trim()
      if (data === '[DONE]') continue
      let json
      try { json = JSON.parse(data) } catch { continue }
      const choice = json.choices?.[0]
      const delta = choice?.delta
      if (delta?.content) {
        if (firstToken) {
          firstToken = false
          // Only stop spinner and write newline when streaming directly to output.
          // When buffering, the caller owns the spinner — don't touch it here.
          if (!bufferOutput) { if (io.spinner) io.spinner.stop(); io.write('\n') }
        }
        fullText += delta.content
        if (!bufferOutput) {
          io.write(delta.content)
        }
      }
      if (delta?.tool_calls) {
        if (firstToken) {
          firstToken = false
          // Tool calls are always handled by the caller — don't stop spinner here.
        }
        for (const tc of delta.tool_calls) {
          const idx = tc.index ?? 0
          if (!toolAcc.has(idx)) toolAcc.set(idx, { id: '', name: '', arguments: '' })
          const acc = toolAcc.get(idx)
          if (tc.id) acc.id = tc.id
          if (tc.function?.name) acc.name = tc.function.name
          if (tc.function?.arguments != null) acc.arguments += String(tc.function.arguments)
        }
      }
      if (choice?.finish_reason) finishReason = choice.finish_reason
      if (json.usage) usage = json.usage
    }
  }

  const toolCalls = [...toolAcc.keys()].sort((a, b) => a - b).map(idx => {
    const acc = toolAcc.get(idx)
    if (!acc.name) return null
    let input = {}
    try { input = acc.arguments.trim() ? JSON.parse(acc.arguments) : {} } catch { input = { _parseError: true, _raw: acc.arguments.slice(0, 500) } }
    return { id: acc.id || `call_${idx}_${Date.now()}`, name: acc.name, input }
  }).filter(Boolean)

  // Strip thinking traces before returning — applies to buffered and non-buffered paths.
  // Non-buffered (live streaming) will have printed raw tokens already; the stripped
  // version is used for the transcript and any downstream processing.
  const strippedText = stripThinkingTraces(fullText)

  const assistantBlocks = []
  if (strippedText) assistantBlocks.push({ type: 'text', text: strippedText })
  for (const tc of toolCalls) assistantBlocks.push({ type: 'tool_use', id: tc.id, name: tc.name, input: tc.input })

  return {
    assistantBlocks,
    finishReason: finishReason || (toolCalls.length > 0 ? 'tool_calls' : 'stop'),
    bufferedText: bufferOutput ? strippedText : null,
    usage,
  }
}
