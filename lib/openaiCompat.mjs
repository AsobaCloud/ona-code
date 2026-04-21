/** OpenAI Chat Completions–compatible streaming HTTP client (§2.1 lm_studio_local + openai_compatible). */

export async function streamOpenAIChatCompletion({ baseUrl, apiKey, model, messages, tools, io, maxTokens = 8192 }) {
  const url = `${String(baseUrl).replace(/\/$/, '')}/chat/completions`
  const body = { model, messages, stream: true, max_tokens: maxTokens }
  if (tools?.length) { body.tools = tools; body.tool_choice = 'auto' }

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
  let buffer = '', fullText = '', finishReason = null, firstToken = true
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
        if (firstToken) { firstToken = false; if (io.spinner) io.spinner.stop(); io.write('\n') }
        fullText += delta.content; io.write(delta.content)
      }
      if (delta?.tool_calls) {
        if (firstToken) { firstToken = false; if (io.spinner) io.spinner.stop() }
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
    }
  }

  const toolCalls = [...toolAcc.keys()].sort((a, b) => a - b).map(idx => {
    const acc = toolAcc.get(idx)
    if (!acc.name) return null
    let input = {}
    try { input = acc.arguments.trim() ? JSON.parse(acc.arguments) : {} } catch { input = { _parseError: true, _raw: acc.arguments.slice(0, 500) } }
    return { id: acc.id || `call_${idx}_${Date.now()}`, name: acc.name, input }
  }).filter(Boolean)

  const assistantBlocks = []
  if (fullText) assistantBlocks.push({ type: 'text', text: fullText })
  for (const tc of toolCalls) assistantBlocks.push({ type: 'tool_use', id: tc.id, name: tc.name, input: tc.input })

  return { assistantBlocks, finishReason: finishReason || (toolCalls.length > 0 ? 'tool_calls' : 'stop') }
}
